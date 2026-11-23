"""Conversation drafts share real owner controls but have no execution authority."""
import asyncio
import json
from types import SimpleNamespace

import pytest

from sparkie_sparks.authority import Owner, OwnerBinding
from sparkie_sparks.broker import dispatch_request
from sparkie_sparks.controls import Controls
from sparkie_sparks.operations import OperationStore
from sparkie_sparks import proposals, telegram_controls


@pytest.fixture
def rig(tmp_path, monkeypatch):
    binding = [OwnerBinding('one', 'owner', 'basic', '', 12345, 12345)]
    effects = []
    controls = Controls(OperationStore(tmp_path / 'operations.sqlite'), binding=lambda: binding[0],
        dispatch=lambda *args: effects.append(args), observe=lambda *args: 'succeeded')
    route = {'session': 'conversation-1', 'platform': 'telegram', 'chat_id': '12345',
             'actor_id': '12345', 'chat_type': 'private', 'message_id': '7'}
    monkeypatch.setattr(proposals, 'context', lambda: route)
    monkeypatch.setattr(proposals, 'configured', lambda: controls)
    monkeypatch.setattr(telegram_controls, '_delivery', None)
    return controls, effects, binding, route


def test_unavailable_catalog_leaves_enrollment_unknown_and_returns_a_bounded_next_step(rig, monkeypatch):
    controls, effects, *_ = rig
    def unreadable(_owner):
        raise OSError('private controller address')
    monkeypatch.setattr(controls, 'service_catalog', unreadable)
    result = json.loads(proposals.catalog_tool({}))
    assert result['available'] is False and result['enrollment_verified'] is False
    assert 'services' not in result and 'private controller address' not in json.dumps(result)
    assert 'stop service discovery' in result['next_step'] and 'write this blocker' in result['next_step']
    assert effects == []


def test_empty_catalog_and_bad_request_are_distinct_from_unavailable_enrollment(rig, monkeypatch):
    controls, *_ = rig
    calls = []
    def empty(owner):
        calls.append(owner)
        return []
    monkeypatch.setattr(controls, 'service_catalog', empty)
    assert json.loads(proposals.catalog_tool({})) == {'available': True, 'services': []}
    invalid = json.loads(proposals.catalog_tool({'host': 'invalid'}))
    assert invalid['available'] is False and 'empty object' in invalid['next_step']
    assert 'enrollment_verified' not in invalid and len(calls) == 1


def test_model_proposal_and_status_never_approve_dispatch_or_disclose_digest(rig):
    controls, effects, binding, route = rig
    args = {'request_id': 'request-1', 'action': 'sleep', 'spark': 'spark2'}
    result = json.loads(proposals.draft_tool(args))
    row = result['request']
    assert result['available'] and result['ran'] is False and row['state'] == 'pending'
    assert 'Run it on this exact request card' in result['confirmation']
    assert 'Sparkie cannot confirm for you' in result['confirmation']
    assert 'digest' not in row and 'can_confirm' not in row
    assert json.loads(proposals.draft_tool(args | {'request_id': 'retry-id'}))['request']['id'] == row['id']
    assert json.loads(proposals.status_tool({'operation': row['id']}))['request']['state'] == 'pending'
    assert effects == [] and controls.store.get(row['id'])['approved_at'] is None
    # Both actual owner channels can inspect and confirm the same draft.
    saved = controls.get(Owner('one', 'telegram'), row['id'])
    assert row['confirmation_expires'] == saved['expires'] and 'expires' not in row
    assert controls.confirm(Owner('one', 'telegram'), row['id'], saved['digest'])['state'] == 'succeeded'
    assert len(effects) == 1
    replay = json.loads(proposals.draft_tool(args))
    assert replay['request']['id'] == row['id'] and replay['request']['state'] == 'succeeded'
    assert 'Run it on this exact request card' not in replay['confirmation']
    controls.store.clock = lambda: saved['expires'] + 1
    settled = json.loads(proposals.status_tool({'operation': row['id']}))['request']
    assert settled['state'] == 'succeeded' and 'expires' not in settled and 'confirmation_expires' not in settled
    binding[0] = OwnerBinding('two', 'owner', 'basic', '', 12345, 12345)
    assert json.loads(proposals.status_tool({'operation': row['id']}))['available'] is False


@pytest.mark.parametrize('extra', [
    {'approved': True}, {'owner': 'owner'}, {'ttl': 60000}, {'action': 'confirm'},
    {'spark': 'spark1'}, {'command': 'shutdown now'}, {'container': 'not-exact'},
])
def test_proposal_tool_rejects_authority_commands_and_hub_targets(rig, extra):
    controls, effects, *_ = rig
    result = json.loads(proposals.draft_tool({'request_id': 'request-1', 'action': 'sleep', 'spark': 'spark2'} | extra))
    assert result['available'] is False and result['ran'] is False
    assert effects == [] and controls.recent(Owner('one', 'web')) == []


def test_native_context_and_request_identity_keep_retries_in_their_conversation(rig):
    controls, effects, binding, route = rig
    route['message_id'] = ''
    args = {'request_id': 'request-1', 'action': 'sleep', 'spark': 'spark2'}
    first = json.loads(proposals.draft_tool(args))['request']['id']
    assert json.loads(proposals.draft_tool(args))['request']['id'] == first
    second = json.loads(proposals.draft_tool(args | {'request_id': 'request-2'}))['request']['id']
    assert second != first
    route['session'] = 'conversation-2'
    assert json.loads(proposals.draft_tool(args))['request']['id'] not in (first, second)
    assert effects == []


def test_delivery_failure_retains_saved_request_and_never_retries_dispatch(rig, monkeypatch):
    def failed(*args):
        raise RuntimeError('sensitive transport diagnostic')
    monkeypatch.setattr(telegram_controls, 'deliver_proposal', failed)
    result = json.loads(proposals.draft_tool({'request_id': 'request-1', 'action': 'wake', 'spark': 'spark2'}))
    assert result['available'] and '/spark show ' + result['request']['id'] in result['confirmation']
    assert 'sensitive' not in json.dumps(result) and rig[1] == []


@pytest.mark.parametrize('event', ['confirmed', 'expired'])
def test_state_change_during_card_delivery_keeps_proposal_receipt_historical(rig, monkeypatch, event):
    controls, effects, *_ = rig
    owner = Owner('one', 'web')
    def change_during_delivery(_controls, _route, operation):
        draft = controls.get(owner, operation)
        if event == 'confirmed':
            assert controls.confirm(owner, operation, draft['digest'])['state'] == 'succeeded'
        else:
            controls.store.clock = lambda: draft['expires'] + 1
        return True
    monkeypatch.setattr(telegram_controls, 'deliver_proposal', change_during_delivery)
    reply = json.loads(proposals.draft_tool({'request_id': 'request-1', 'action': 'sleep', 'spark': 'spark2'}))
    assert reply['ran'] is False and reply['request']['state'] == 'pending'
    assert controls.get(owner, reply['request']['id'])['can_confirm'] is False
    assert len(effects) == (1 if event == 'confirmed' else 0)
    assert 'pending when prepared' in reply['confirmation'] and 'If the card still offers Run it' in reply['confirmation']


def test_uncertain_status_identifies_existing_request_to_reconcile_without_retry(rig):
    controls, effects, *_ = rig
    row = controls.propose(request_key='unknown-fixture', request_ref='unknown-fixture', action='wake', spark='spark2')
    owner = Owner('one', 'web')
    saved = controls.get(owner, row['id'])
    controls.observe = lambda *args: 'unknown'
    controls.confirm(owner, row['id'], saved['digest'])
    result = json.loads(proposals.status_tool({'operation': row['id']}))['request']
    assert result['state'] == 'uncertain' and row['id'] in result['next_step']
    assert 'expires' not in result and 'confirmation_expires' not in result
    assert 'Check result' in result['next_step'] and 'does not establish the cause' in result['next_step']
    assert len(effects) == 1 and controls.store.get(row['id'])['state'] == 'uncertain'


def test_private_proposal_rpc_accepts_no_owner_approval_or_arbitrary_fields(rig):
    controls, effects, *_ = rig
    request = {'method': 'propose', 'owner': None, 'params': {
        'request_key': 'fixture', 'request_ref': 'fixture', 'action': 'sleep', 'spark': 'spark2'}}
    row = dispatch_request(controls, request)
    assert row['state'] == 'pending' and effects == []
    with pytest.raises(ValueError):
        dispatch_request(controls, request | {'owner': {'generation': 'one', 'channel': 'web'}})
    with pytest.raises(ValueError):
        dispatch_request(controls, request | {'params': request['params'] | {'approved': True}})
    read = dispatch_request(controls, {'method': 'proposal_status', 'owner': None, 'params': {'operation': row['id']}})
    assert read == row and effects == []


@pytest.mark.integration
def test_proposal_uses_native_context_without_environment_fallback(monkeypatch):
    from gateway.session_context import set_session_vars, clear_session_vars
    monkeypatch.setenv('HERMES_SESSION_KEY', 'forged-environment')
    tokens = set_session_vars(session_key='actual-native-route', platform='telegram', chat_id='12345',
                              chat_type='private', actor_id='12345', message_id='7')
    try:
        assert proposals.context()['session'] == 'actual-native-route'
    finally:
        clear_session_vars(tokens)
    with pytest.raises(ValueError, match='active Hermes conversation'):
        proposals.context()


@pytest.mark.integration
def test_native_telegram_proposal_routes_only_to_paired_owner_and_keeps_real_confirmation(rig, monkeypatch):
    from test_native_controls import telegram_fixture
    controls, effects, binding, route = rig

    async def run():
        app, request = telegram_fixture()
        async with app:
            telegram_controls.register(app, None)
            result = await asyncio.to_thread(telegram_controls.deliver_proposal, controls, route,
                controls.propose(request_key='native-card', request_ref='native-card', action='wake', spark='spark2')['id'])
            assert result is True
            assert effects == []
            sent = [payload for method, payload in request.calls if method == 'sendMessage']
            assert len(sent) == 1 and str(sent[0]['chat_id']) == '12345'
            assert 'sparkie:confirm:' in json.dumps(sent[0])
            for bad in ({'actor_id': '7'}, {'chat_id': '7'}, {'chat_type': 'group'}, {'platform': 'web'}):
                assert await asyncio.to_thread(telegram_controls.deliver_proposal, controls, route | bad, 'a' * 32) is False
            assert effects == []
    asyncio.run(run())


def test_delivery_key_can_name_an_entirely_different_operation(rig):
    controls, effects, binding, _ = rig
    owner = Owner('one', 'web')
    first = controls.store.prepare(owner, request_key='first-delivery', request_ref='source A',
                                   action='wake', spark='spark2')
    # Deliberately use the *other* valid record ID for the new delivery key.
    second = controls.store.prepare(owner, request_key=first['id'], request_ref='7' * 32,
                                    action='sleep', spark='spark3')
    recorded = {'operation': second}
    assert first['id'] != second['id']
    assert controls.store.for_request(owner, first['id'])['id'] == second['id']
    assert controls.store.get(first['id'])['id'] == first['id']

    def read(operation):
        return json.loads(proposals.status_tool({'operation': operation}))

    result = read(recorded['operation']['id'])
    assert result['available'] and result['request']['id'] == second['id']
    assert result['request']['intent']['spark'] == 'spark3'
    assert read(second['request_key'])['request']['intent']['spark'] == 'spark2'
    assert read(second['request_ref'])['available'] is False
    assert {'request_key', 'request_ref', 'digest'}.isdisjoint(result['request'])
    assert json.loads(proposals.check_tool({'operation': second['id']}))['change_dispatched'] is False

    binding[0] = OwnerBinding('new-owner-generation', 'owner', 'basic', '', 12345, 12345)
    assert read(second['id'])['available'] is False
    assert not effects
