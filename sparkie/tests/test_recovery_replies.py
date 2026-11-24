"""Only a completed, opted-in, same-turn Spark check can finish a native reply."""
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event
import shutil

import pytest

from sparkie_sparks.authority import Owner
from sparkie_sparks.recovery_replies import RecoveryReplies
from sparkie_sparks import proposals
from test_proposals import rig
from test_proposal_reconciliation import uncertain

pytestmark = pytest.mark.integration


def turn(prompt, calls):
    messages = [{'role': 'user', 'content': prompt}]
    for name, args, call_id in calls:
        messages.append({'role': 'assistant', 'tool_calls': [{'id': call_id, 'function': {
            'name': name, 'arguments': json.dumps(args)}}]})
        messages.append({'role': 'tool', 'tool_call_id': call_id, 'content': 'untrusted replay text'})
    return {'messages': messages}


def test_native_bridge_carries_the_same_identity_to_the_following_provider_round(rig, tmp_path, monkeypatch):
    from hermes_cli.plugins import get_plugin_manager
    from hermes_cli.middleware import run_llm_execution_middleware
    from model_tools import handle_function_call
    controls, effects, *_ = rig
    home = tmp_path / 'profile'
    shutil.copytree(Path(__file__).resolve().parents[1] / 'plugin', home / 'plugins' / 'sparkie-sparks')
    (home / 'config.yaml').write_text('plugins:\n  enabled: [sparkie-sparks]\nagent:\n  defer_tools: all\n')
    monkeypatch.setenv('HERMES_HOME', str(home))
    get_plugin_manager().discover_and_load()
    row = uncertain(controls, action='stop_workload', container='a' * 64)
    controls.observe = lambda *_: 'unknown'
    args = {'calls': [{'name': 'spark_check_change', 'arguments': {'operation': row['id'], 'final_reply': True}}]}
    ids = {'session_id': 'session-A', 'turn_id': 'turn-A', 'task_id': 'task-A'}
    data = json.loads(handle_function_call('tool_call', args, tool_call_id='call-A',
                                           enabled_toolsets=['sparks'], **ids))
    assert data['available'] and data['request']['state'] == 'uncertain'
    request = turn('Still waiting for ' + row['id'], [('tool_call', args, 'call-A')])
    result = run_llm_execution_middleware(request, lambda _req: pytest.fail('Unnecessary model request'),
                                          api_mode='chat_completions', model='local', platform='telegram', **ids)
    text = result.choices[0].message.content
    assert row['id'] in text and 'Recorded state: uncertain' in text and 'Do not retry or replace' in text
    assert 'untrusted replay' not in text and not effects

    # An opted-in check must still hand the original receipt to the native
    # provider when the owner or client asks for structured output.
    checked_call = ('tool_call', args, 'call-A')
    prompt = f"We lost the acknowledgement for my request {row['id']}. Please check that same request. Did it stop?"
    structured = turn(prompt + ' I need the result for my log as JSON with receipt_id, state, stopped and next_step.',
                      [checked_call])
    for formatted in (structured,
                      dict(turn(prompt, [checked_call]), response_format={'type': 'json_object'}),
                      dict(turn(prompt, [checked_call]), extra_body={'response_format': {
                          'type': 'json_schema', 'json_schema': {'name': 'receipt', 'schema': {'type': 'object'}}}})):
        formatted['messages'][-1]['content'] = json.dumps(data)
        forwarded = []
        def native(request):
            forwarded.append(request)
            return 'provider response'
        assert run_llm_execution_middleware(formatted, native, api_mode='chat_completions',
                                            model='local', platform='telegram', **ids) == 'provider response'
        assert forwarded == [formatted]
        assert json.loads(forwarded[0]['messages'][-1]['content']) == data
    assert controls.store.get(row['id'])['state'] == 'uncertain' and not effects
    for platform in ('api_server', '', 'external'):
        assert run_llm_execution_middleware(request, lambda _req: 'normal stream', api_mode='chat_completions',
                                            model='local', platform=platform, **ids) == 'normal stream'


@pytest.mark.parametrize('observer, contender', [
    (('first', 'a'), ('second', 'b')),
    (('second', 'b'), ('first', 'a')),
])
def test_session_turn_call_id_and_actual_tool_bind_receipts(rig, observer, contender):
    controls, effects, *_ = rig
    row = uncertain(controls)
    args = {'operation': row['id'], 'final_reply': True}
    req = turn('Check request ' + row['id'], [('spark_check_change', args, 'call')])
    replies = RecoveryReplies()
    normal = lambda: 'continue normally'
    def arrange(session, turn_id):
        return replies.checked('spark_check_change', args, lambda: proposals.check_tool(args),
                               session_id=session, turn_id=turn_id, tool_call_id='call')
    def render(session, turn_id):
        return replies.reply(req, normal, session_id=session, turn_id=turn_id, api_mode='chat_completions', model='local', platform='cli')
    # Hold the observation lock while the other session reads the pending row.
    observing, release = Event(), Event()
    def observe(*_):
        observing.set()
        assert release.wait(timeout=10)
        return 'succeeded'
    controls.observe = observe
    with ThreadPoolExecutor(max_workers=2) as pool:
        active = pool.submit(arrange, *observer)
        try:
            assert observing.wait(timeout=10)
            pending = pool.submit(arrange, *contender).result(timeout=10)
        finally:
            release.set()
        completed = active.result(timeout=10)
    for identity, raw, state in ((observer, completed, 'succeeded'), (contender, pending, 'uncertain')):
        result = json.loads(raw)
        assert result['available'] and result['change_dispatched'] is False
        assert result['request']['id'] == row['id'] and result['request']['state'] == state
        text = render(*identity).choices[0].message.content
        assert text.splitlines()[0] == 'Recorded state: ' + state and row['id'] in text
    assert controls.store.get(row['id'])['state'] == 'succeeded' and not effects
    assert render('first', 'b') == render('second', 'a') == 'continue normally'
    replies.clear('first', 'a')
    assert render('first', 'a') == 'continue normally'
    assert row['id'] in render('second', 'b').choices[0].message.content
    replies.checked('read_file', args, lambda: proposals.check_tool(args), 'first', 'a', 'call')
    assert render('first', 'a') == 'continue normally'
    for bad in ('broken', '{}', '[1]', '{"available": true, "change_dispatched": false, "request": {}}'):
        assert replies.checked('spark_check_change', args, lambda: bad, 'first', 'a', 'call') == bad
        assert render('first', 'a') == 'continue normally'
    replies.checked('spark_check_change', args, lambda: proposals.check_tool(args), 'first', 'a', 'other-call')
    assert render('first', 'a') == 'continue normally'


@pytest.mark.parametrize(('observed', 'state', 'stopped'), [
    ('unknown', 'uncertain', None), ('failed', 'failed', None), ('succeeded', 'succeeded', True),
])
def test_json_stop_receipt_uses_checked_outcome_on_the_same_request(rig, observed, state, stopped):
    controls, effects, *_ = rig
    row = uncertain(controls, action='stop_workload', container='a' * 64)
    controls.observe = lambda *_: observed
    controls.result_view = lambda _: 'A separate observation says the workload is running.'
    replies = RecoveryReplies()
    args = {'operation': row['id'], 'reply_format': 'stop_receipt_json'}
    actual = json.loads(replies.checked('spark_check_change', args, lambda: proposals.check_tool(args),
                                        session_id='owner', turn_id='turn', tool_call_id='read'))
    expected = {'receipt_id': row['id'], 'state': state, 'stopped': stopped, 'next_step': actual['request']['recovery']['message']}
    assert actual['change_dispatched'] is False and actual['stop_receipt'] == expected
    assert json.loads(proposals.check_tool({'operation': row['id']}))['stop_receipt'] == expected
    prompt = f"We lost the acknowledgement for my request {row['id']}. Check that same request. Did it stop?"
    fields = ' I need the result for my log as JSON with receipt_id, state, stopped and next_step.'
    call = ('spark_check_change', args, 'read')
    def answer(question, platform='telegram', calls=(call,)):
        return replies.reply(turn(question, calls), lambda: 'native answer', session_id='owner', turn_id='turn',
                             api_mode='chat_completions', model='local', platform=platform)
    for platform in ('cli', 'telegram'):
        assert json.loads(answer(prompt + fields, platform).choices[0].message.content) == expected
        with_target = prompt.replace(row['id'], row['id'] + ' to stop the workload on Spark 2')
        assert json.loads(answer(with_target + fields, platform).choices[0].message.content) == expected
        assert answer(with_target.replace('Spark 2', 'Spark 3') + fields, platform) == 'native answer'
        assert answer('Explain electricity too. ' + prompt + fields, platform) == 'native answer'
        assert answer(prompt + fields.replace('state, stopped', 'state, state, stopped'), platform) == 'native answer'
        assert answer(prompt + fields + '}}}).', platform) == 'native answer'
    from gateway.session_policy import SURFACES
    web = SURFACES['gui']
    short = f"Check stop request {row['id']} as JSON with receipt_id, state, stopped and next_step."
    assert json.loads(answer(short, web).choices[0].message.content) == expected
    for question in (
        'Explain kWh as well. ' + short,
        short + ' Also tell me whether the workload is running.',
        short.replace('as JSON', 'as a list in JSON'),
        short.replace('stopped and next_step', 'machine and next_step'),
        short.replace('state, stopped', 'state: [stopped]'),
        f"Check stop request {row['id']}.",
    ):
        assert answer(question, web) == 'native answer'
    for platform in ('tui', 'tool', 'api_server'):
        assert answer(short, platform) == 'native answer'
    assert answer(prompt + fields, 'tool') == 'native answer'
    assert answer(prompt + fields + ' Also tell me what is running now.') == 'native answer'
    assert answer(prompt + fields.replace('and next_step', 'next_step and hostname')) == 'native answer'
    assert answer(prompt + fields, calls=(('terminal', {}, 'extra'), call)) == 'native answer'
    assert not effects and len(controls.recent(Owner('one', 'web'))) == 1


def test_checked_receipt_excludes_unavailable_mismatched_and_nonstop_operations(rig, monkeypatch):
    controls, effects, *_ = rig
    wake = uncertain(controls)
    args = {'operation': wake['id'], 'reply_format': 'stop_receipt_json'}
    assert 'stop_receipt' not in json.loads(proposals.check_tool(args))
    missing = json.loads(proposals.check_tool(dict(args, operation='f' * 32)))
    assert missing['available'] is False and 'stop_receipt' not in missing
    mismatched = {'id': '0' * 32, 'intent': {'action': 'stop_workload'}, 'state': 'succeeded'}
    monkeypatch.setattr(controls, 'proposal_check', lambda **_: mismatched)
    assert json.loads(proposals.check_tool(args)) == missing and not effects


@pytest.mark.parametrize('platform', ['cli', 'telegram'])
def test_extra_checked_operation_cannot_finish_a_different_owner_request(rig, platform):
    controls, effects, *_ = rig
    replies = RecoveryReplies()
    ids = {'session_id': 'owner', 'turn_id': 'status'}
    calls = []
    operations = []
    for key in ('first', 'second'):
        row = uncertain(controls, request_key=key)
        args = {'operation': row['id'], 'final_reply': True}
        result = replies.checked('spark_check_change', args, lambda: proposals.check_tool(args),
                                 tool_call_id=key, **ids)
        assert json.loads(result)['request']['state'] == 'succeeded'
        operations.append(row['id'])
        calls.append(('spark_check_change', args, key))

    def answer(prompt, history):
        return replies.reply(turn(prompt, history), lambda: 'continue in Hermes',
                             api_mode='chat_completions', model='local', platform=platform, **ids)

    first, second = operations
    for prompt in ('Check ' + first, 'Check ' + second.upper(), 'Check that request'):
        assert answer(prompt, calls) == 'continue in Hermes'
    assert answer('Check ' + second.upper(), calls[:1]) == 'continue in Hermes'
    assert first in answer('Check ' + first.upper(), calls[:1]).choices[0].message.content
    assert answer('Check that request', calls[:1]) == 'continue in Hermes'
    # Both genuine records are wake operations. The owner's wording cannot
    # turn either of them into a stop receipt.
    for prompt in ('Check stop request ' + first, 'Retry the stop request ' + first + '?'):
        assert answer(prompt, calls[:1]) == 'continue in Hermes'
    for prompt in ('Check ' + first[:-1], f'Check {first} and {second[:-1]}',
                   f'Check {first} and explain what a kWh is', 'Show that receipt and restart it'):
        assert answer(prompt, calls[:1]) == 'continue in Hermes'
    both = answer(f'Check {first} and {second}', calls).choices[0].message.content
    assert first in both and second in both and not effects


def test_all_explicit_requests_are_required_and_mixed_work_continues(rig):
    controls, *_ = rig
    first = uncertain(controls)
    second = controls.store.prepare(Owner('one', 'web'),
                                    request_key='second', request_ref='fixture', action='wake', spark='spark3')
    replies = RecoveryReplies()
    one = {'operation': first['id'], 'final_reply': True}
    two = {'operation': second['id'], 'final_reply': True}
    ids = {'session_id': 'session', 'turn_id': 'turn'}
    def run(req):
        return replies.reply(req, lambda: 'ordinary answer', api_mode='chat_completions', model='local', platform='cli', **ids)
    def checked(args, call_id):
        return replies.checked('spark_check_change', args, lambda: proposals.check_tool(args), tool_call_id=call_id, **ids)
    checked(one, 'one')
    prompt = 'Check ' + first['id'] + ' and ' + second['id']
    calls = [('spark_check_change', one, 'one')]
    assert run(turn(prompt, calls)) == 'ordinary answer'
    checked(two, 'two')
    calls.append(('spark_check_change', two, 'two'))
    assert run(turn(prompt, calls)) == 'ordinary answer'  # The second request still needs confirmation.
    controls.store.run(Owner('one', 'web'), second['id'], approval_digest=second['digest'],
                       dispatch=lambda *_: None, observe=lambda *_: 'succeeded')
    checked(two, 'settled')
    calls.append(('spark_check_change', two, 'settled'))
    assert all(v in run(turn(prompt, calls)).choices[0].message.content for v in (first['id'],second['id']))
    assert run(turn(prompt, [('terminal', {}, 'other'), *calls])) == 'ordinary answer'
    wrapped = {'calls': [{'name': 'spark_electricity', 'arguments': {}}]}
    assert run(turn(prompt, [('tool_call', wrapped, 'energy'), *calls])) == 'ordinary answer'
    mixed = turn(prompt, calls)
    mixed['messages'].append({'role': 'tool', 'tool_call_id': 'unrelated-sibling', 'content': 'another result'})
    assert run(mixed) == 'ordinary answer'
    mixed['messages'].append({'role': 'user', 'content': 'Also explain what a kWh measures.'})
    assert run(mixed) == 'ordinary answer'
    args = {'operation': first['id'], 'final_reply': False}
    checked(args, 'three')
    assert run(turn('Check and explain electricity', [('spark_check_change', args, 'three')])) == 'ordinary answer'
    assert run({'messages': [{'role':'user','content':'What is a kWh?'}]}) == 'ordinary answer'


@pytest.mark.parametrize(('outcome', 'policy'), [
    ('unknown', 'keep_request'), ('failed', 'review_required'), ('succeeded', 'no_retry'),
])
def test_request_to_repeat_stop_returns_only_its_checked_disposition(rig, outcome, policy):
    controls, effects, *_ = rig
    row = uncertain(controls, action='stop_workload', container='a' * 64)
    controls.observe = lambda *_: outcome
    controls.result_view = lambda _: 'A separate observation shows the container running.'
    args = {'operation': row['id'], 'final_reply': True}
    ids = {'session_id': 'owner-session', 'turn_id': 'retry-question'}
    replies = RecoveryReplies()
    actual = json.loads(replies.checked('spark_check_change', args, lambda: proposals.check_tool(args),
                                        tool_call_id='observed', **ids))
    req = turn('Can you repeat stop request ' + row['id'] + '?', [('spark_check_change', args, 'observed')])
    checked = actual['request']
    assert checked['recovery']['retry_policy'] == policy
    reply = replies.reply(req, lambda: 'continue requested review', api_mode='chat_completions',
                          model='local', platform='telegram', **ids)
    if outcome == 'failed':
        assert reply == 'continue requested review'
    else:
        assert checked['recovery']['message'] in reply.choices[0].message.content
    assert checked['id'] == row['id'] and actual['change_dispatched'] is False and effects == []
    assert len(controls.recent(Owner('one', 'web'))) == 1
