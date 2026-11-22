"""Only a completed, opted-in, same-turn Spark check can finish a native reply."""
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
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
    for platform in ('api_server', '', 'external'):
        assert run_llm_execution_middleware(request, lambda _req: 'normal stream', api_mode='chat_completions',
                                            model='local', platform=platform, **ids) == 'normal stream'


def test_session_turn_call_id_and_actual_tool_bind_receipts(rig):
    controls, *_ = rig
    row = uncertain(controls)
    args = {'operation': row['id'], 'final_reply': True}
    req = turn('Check this request', [('spark_check_change', args, 'call')])
    replies = RecoveryReplies()
    normal = lambda: 'continue normally'
    def arrange(session, turn_id):
        return replies.checked('spark_check_change', args, lambda: proposals.check_tool(args),
                               session_id=session, turn_id=turn_id, tool_call_id='call')
    def render(session, turn_id):
        return replies.reply(req, normal, session_id=session, turn_id=turn_id, api_mode='chat_completions', model='local', platform='cli')
    with ThreadPoolExecutor(max_workers=2) as pool:
        jobs = [pool.submit(arrange, s, t) for s, t in [('first', 'a'), ('second', 'b')]]
        for job in jobs:
            assert json.loads(job.result())['available']
    assert 'succeeded' in render('first', 'a').choices[0].message.content
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
