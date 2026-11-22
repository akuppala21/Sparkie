"""Model checks use the owner observation path, with no action authority."""
import json
from pathlib import Path
import shutil
from types import SimpleNamespace

import pytest

from sparkie_sparks.authority import Owner, OwnerBinding
from sparkie_sparks.broker import dispatch_request
from sparkie_sparks.composition import compose
from sparkie_sparks.controls import Controls
from sparkie_sparks.operations import OperationStore
from sparkie_sparks import proposals, telegram_controls
from test_proposals import rig


def uncertain(controls, *, action='wake', container=None, request_key='original-private-reference'):
    owner = Owner(controls.binding().generation, 'web')
    row = controls.store.prepare(owner, request_key=request_key, request_ref='private original conversation',
                                 action=action, spark='spark2', container=container)
    controls.store.run(owner, row['id'], approval_digest=row['digest'],
                       dispatch=lambda *_: None, observe=lambda *_: 'unknown')
    return row


def test_cached_status_then_explicit_observation_reconciles_same_id_and_releases_claim(rig):
    controls, effects, *_ = rig
    row = uncertain(controls)
    reads = []
    controls.observe = lambda operation, target: reads.append((operation, target)) or 'succeeded'
    cached = json.loads(proposals.status_tool({'operation': row['id']}))['request']
    assert cached['state'] == 'uncertain' and reads == []
    checked = json.loads(proposals.check_tool({'operation': row['id']}))
    assert checked['available'] and checked['change_dispatched'] is False
    assert checked['request']['id'] == row['id'] and checked['request']['state'] == 'succeeded'
    assert reads == [(row['id'], row['intent'])] and effects == []
    assert 'digest' not in checked['request'] and 'private original' not in json.dumps(checked)
    assert controls.store.get(row['id'])['approved_channel'] == 'web'
    with controls.store._db() as db:
        assert db.execute('SELECT * FROM claims').fetchall() == []


def test_unresolved_proposal_returns_original_target_without_drafting_or_rerouting(rig, monkeypatch):
    controls, effects, _, route = rig
    row = uncertain(controls, action='stop_workload', container='a' * 64)
    controls.observe = lambda *_: 'unknown'
    route['session'] = 'a-different-owner-conversation'
    monkeypatch.setattr(telegram_controls, 'deliver_proposal', lambda *_: pytest.fail('Do not rebind the original conversation'))
    response = json.loads(proposals.draft_tool({'request_id': 'new-request', 'action': 'sleep', 'spark': 'spark2'}))
    assert response['available'] and response['ran'] is False and response['prepared'] is False
    assert response['request']['id'] == row['id'] and response['request']['intent'] == row['intent']
    assert response['request']['replacement_prepared'] is False
    assert 'No new request' in response['message'] and 'confirmation' not in response
    assert 'original-private-reference' not in json.dumps(response) and 'private original conversation' not in json.dumps(response)
    assert len(controls.recent(Owner('one', 'web'))) == 1 and effects == []
    assert json.loads(proposals.check_tool({'operation': row['id']}))['request']['state'] == 'uncertain'
    with controls.store._db() as db:
        assert db.execute('SELECT operation FROM claims').fetchone()[0] == row['id']


def test_checked_unknown_result_does_not_instruct_repeated_polling(rig):
    controls, effects, *_ = rig
    row = uncertain(controls)
    observations = []
    controls.observe = lambda *args: observations.append(args) or 'unknown'
    cached = json.loads(proposals.status_tool({'operation': row['id']}))['request']
    assert 'Call spark_check_change' in cached['next_step'] and observations == []
    checked = json.loads(proposals.check_tool({'operation': row['id']}))
    assert checked['request']['state'] == 'uncertain' and len(observations) == 1
    assert 'Call spark_check_change' not in checked['request']['next_step']
    assert 'Do not repeat status or check' in checked['request']['next_step']
    assert checked['message'] == 'This check sent no change. The request shows the recorded result.'
    assert 'ran' not in checked and checked['change_dispatched'] is False and effects == []
    assert controls.store.get(row['id'])['state'] == 'uncertain'


def test_failed_result_does_not_establish_current_workload_state(rig):
    controls, effects, *_ = rig
    row = uncertain(controls, action='stop_workload', container='a' * 64)
    controls.observe = lambda *_: 'failed'
    checked = json.loads(proposals.check_tool({'operation': row['id']}))
    assert checked['request']['state'] == 'failed'
    assert 'does not establish the current workload state' in checked['request']['next_step']
    assert 'currently running or stopped' in checked['request']['next_step']
    cached = json.loads(proposals.status_tool({'operation': row['id']}))['request']
    assert cached['next_step'] == checked['request']['next_step'] and effects == []


@pytest.mark.parametrize('separate_observation', ['The container is running.', 'The container is stopped.'])
def test_recovery_disposition_comes_from_operation_not_separate_workload_observation(rig, separate_observation):
    controls, effects, *_ = rig
    row = uncertain(controls, action='stop_workload', container='a' * 64)
    owner = Owner('one', 'web')
    controls.result_view = lambda _: separate_observation
    reads = []
    controls.observe = lambda *args: reads.append(args) or 'unknown'
    before = controls.get(owner, row['id'])
    assert before['message'] == separate_observation
    assert before['recovery']['operation_terminal'] is False
    assert before['recovery']['retry_policy'] == 'keep_request'
    assert reads == [] and effects == []
    checked = json.loads(proposals.check_tool({'operation': row['id']}))['request']
    assert checked['recovery'] == before['recovery'] and len(reads) == 1
    assert 'does not complete this operation' in checked['recovery']['message']
    assert 'digest' not in checked and 'can_confirm' not in checked
    cancelled = controls.cancel(owner, row['id'])
    assert cancelled['state'] == 'uncertain' and cancelled['recovery'] == before['recovery']
    replacement = controls.propose(request_key='replacement-after-manual-read', request_ref='fixture',
                                   action='stop_workload', spark='spark2', container='a' * 64)
    assert replacement['id'] == row['id'] and replacement['replacement_prepared'] is False
    assert effects == []
    with controls.store._db() as db:
        assert db.execute('SELECT operation FROM claims').fetchone()[0] == row['id']

    # Only reconciliation closes the operation. Failure still does not establish
    # present container state or grant authority to execute another request.
    controls.observe = lambda *_: 'failed'
    failed = json.loads(proposals.check_tool({'operation': row['id']}))['request']
    assert failed['recovery']['operation_terminal'] is True
    assert failed['recovery']['retry_policy'] == 'review_required'
    assert 'does not establish the current workload state' in failed['recovery']['message']
    assert failed['recovery'] == controls.get(owner, row['id'])['recovery']
    new = controls.propose(request_key='owner-new-attempt', request_ref='fixture',
                           action='stop_workload', spark='spark2', container='a' * 64)
    assert new['id'] != row['id'] and new['state'] == 'pending'
    assert controls.store.get(new['id'])['approved_at'] is None and effects == []


def test_failed_recovery_review_does_not_release_an_existing_service_claim(tmp_path):
    from test_recipe_services import rig as service_rig, prepare, confirm, NODE, GLM
    from sparkie_sparks.recipe_services import service_holds_node
    controls, services, effects = service_rig(tmp_path)
    original = prepare(controls)
    assert confirm(controls, original)['state'] == 'succeeded'
    refused = confirm(controls, prepare(controls, GLM))
    assert refused['state'] == 'failed'
    assert refused['recovery']['operation_terminal'] is True
    assert refused['recovery']['retry_policy'] == 'review_required'
    with controls.store._db() as db:
        assert service_holds_node(db, NODE.spark_id)
    assert confirm(controls, prepare(controls, GLM))['state'] == 'failed'
    assert effects.calls == [('start', original['id'])]


def test_new_draft_after_observed_terminal_result_still_needs_owner_confirmation(rig):
    controls, effects, *_ = rig
    row = uncertain(controls)
    assert json.loads(proposals.check_tool({'operation': row['id']}))['request']['state'] == 'succeeded'
    result = json.loads(proposals.draft_tool({'request_id': 'new-request', 'action': 'sleep', 'spark': 'spark2'}))
    new = controls.store.get(result['request']['id'])
    assert new['id'] != row['id'] and new['state'] == 'pending' and new['approved_at'] is None
    assert effects == []


@pytest.mark.parametrize('outcome', ['succeeded', 'failed'])
def test_model_guidance_preserves_the_owner_disposition_across_reconciliation(rig, outcome):
    controls, effects, *_ = rig
    row = uncertain(controls, action='stop_workload', container='a' * 64)
    controls.observe = lambda *_: 'unknown'
    unknown = proposals.check(controls, operation=row['id'])
    assert unknown['recovery']['retry_policy'] == 'keep_request'
    assert 'Do not retry or replace it' in unknown['recovery']['message']
    assert 'does not complete this operation' in unknown['recovery']['message']
    assert 'After a failure' not in unknown['recovery']['message']
    assert 'fresh confirmation' not in unknown['recovery']['message']
    controls.observe = lambda *_: outcome
    settled = proposals.check(controls, operation=row['id'])
    owner_row = controls.get(Owner('one', 'web'), row['id'])
    assert settled['id'] == row['id'] and settled['recovery'] == owner_row['recovery']
    assert owner_row['recovery']['message'] in settled['next_step']
    if outcome == 'succeeded':
        assert settled['recovery']['retry_policy'] == 'no_retry'
        assert 'No retry or replacement is needed' in settled['next_step']
        assert 'does not establish when a connection dropped or why a reply was missing' in settled['next_step']
    else:
        assert settled['recovery']['retry_policy'] == 'review_required'
        assert 'currently running or stopped' in settled['next_step']
        assert 'fresh confirmation and all resource checks' in settled['next_step']
        guidance = settled['next_step']
        assert guidance.index('prepare a new request') < guidance.index('confirm that exact new request ID')
    assert not effects


def test_dispatch_in_progress_keeps_original_request_without_observation_or_new_draft(rig):
    controls, effects, *_ = rig
    row = uncertain(controls)
    with controls.store._db() as db:
        db.execute('UPDATE operations SET state=? WHERE id=?', ('dispatching', row['id']))
    controls.observe = lambda *_: pytest.fail('The original dispatcher holds this operation')
    with controls.store._lock(row['id']) as acquired:
        assert acquired
        checked = json.loads(proposals.check_tool({'operation': row['id']}))
        replacement = json.loads(proposals.draft_tool({'request_id': 'new-request', 'action': 'sleep', 'spark': 'spark2'}))
    assert checked['request']['state'] == 'dispatching'
    assert 'Do not repeat status or check' in checked['request']['next_step']
    assert checked['message'] == 'This check sent no change. The request shows the recorded result.'
    assert 'observed' not in checked
    assert replacement['request']['id'] == row['id'] and replacement['prepared'] is False
    assert len(controls.recent(Owner('one', 'web'))) == 1 and effects == []


@pytest.mark.parametrize('state', ['pending', 'approved', 'succeeded', 'failed', 'cancelled'])
def test_check_non_inflight_state_does_not_observe_dispatch_or_approve(rig, state):
    controls, effects, *_ = rig
    row = controls.propose(request_key='fixture', request_ref='fixture', action='wake', spark='spark2')
    with controls.store._db() as db:
        db.execute('UPDATE operations SET state=? WHERE id=?', (state, row['id']))
    before = controls.store.get(row['id'])
    controls.observe = lambda *_: pytest.fail('Only an in-flight operation needs observation')
    assert json.loads(proposals.check_tool({'operation': row['id']}))['request']['state'] == state
    assert controls.store.get(row['id']) == before and effects == []


@pytest.mark.parametrize('args', [None, [], {}, {'operation': '../escape'}, {'operation': 'A' * 32},
    {'operation': 'a' * 31}, {'operation': 'a' * 32 + '\n'}, {'operation': ['a' * 32]},
    {'operation': 'a' * 32, 'owner': 'owner'}, {'operation': 'a' * 32, 'digest': 'b' * 64},
    {'operation': 'a' * 32, 'dispatch': True}])
def test_check_malformed_or_authority_arguments_cannot_observe(rig, args):
    controls, effects, *_ = rig
    controls.observe = lambda *_: pytest.fail('Invalid input must not observe')
    result = json.loads(proposals.check_tool(args))
    assert not result['available'] and result['change_dispatched'] is False and effects == []


def test_owner_reenrollment_hides_old_claim_and_blocks_observation(rig):
    controls, effects, binding, _ = rig
    row = uncertain(controls)
    binding[0] = OwnerBinding('two', 'owner', 'basic', '', 12345, 12345)
    controls.observe = lambda *_: pytest.fail('Revoked generation must not observe')
    checked = json.loads(proposals.check_tool({'operation': row['id']}))
    drafted = json.loads(proposals.draft_tool({'request_id': 'new-request', 'action': 'wake', 'spark': 'spark2'}))
    assert not checked['available'] and not drafted['available']
    assert row['id'] not in json.dumps(drafted) and effects == []
    assert controls.recent(Owner('two', 'web')) == []


def test_private_rpc_has_observation_but_no_model_approval_and_strict_parameters(rig):
    controls, effects, *_ = rig
    row = uncertain(controls)
    request = {'method': 'proposal_check', 'owner': None, 'params': {'operation': row['id']}}
    for changes in ({'owner': {'generation': 'one', 'channel': 'web'}},
                    {'params': {'operation': row['id'], 'digest': row['digest']}}, {'params': {}}):
        with pytest.raises(ValueError):
            dispatch_request(controls, request | changes)
    assert dispatch_request(controls, request)['state'] == 'succeeded' and effects == []


def test_remote_model_check_crosses_actual_private_socket_without_resending(tmp_path):
    from test_broker import serve, OWNER
    with serve(tmp_path) as (remote, controls, effects, outcomes, _, _):
        row = remote.prepare(OWNER, request_key='original', request_ref='original', action='stop_workload',
                             spark='spark2', container='a' * 64)
        outcomes[0] = 'unknown'
        remote.confirm(OWNER, row['id'], row['digest'])
        blocked = remote.propose(request_key='replacement', request_ref='replacement', action='stop_workload',
                                 spark='spark2', container='b' * 64)
        assert blocked['id'] == row['id'] and blocked['intent']['container'] == 'a' * 64
        checked_unknown = remote.proposal_check(operation=row['id'])
        assert checked_unknown['state'] == 'uncertain'
        assert 'Do not repeat status or check' in checked_unknown['next_step']
        assert 'Call spark_check_change' not in checked_unknown['next_step']
        outcomes[0] = 'succeeded'
        assert remote.proposal_status(operation=row['id'])['state'] == 'uncertain'
        assert remote.proposal_check(operation=row['id'])['state'] == 'succeeded'
        assert len(effects) == 1


def test_real_stop_adapter_only_sends_observe_with_exact_container(tmp_path):
    from sparkie_sparks.workloads import StopWorkload
    calls = []
    def runner(args, **kwargs):
        payload = json.loads(args[-1])
        calls.append(payload)
        assert payload['mode'] == 'observe'
        return SimpleNamespace(returncode=0, stdout=json.dumps({'hostname': 'compute-fixture',
            'container': payload['container'], 'status': 'stopped'}))
    nodes = [{'id': 'spark2', 'hostname': 'compute-fixture', 'address': '192.0.2.2', 'user': 'owner', 'local': True}]
    controls = compose(OperationStore(tmp_path / 'operations.sqlite'), nodes,
        binding=lambda: OwnerBinding('one', 'owner', 'basic', '', 12345, 12345),
        workloads=StopWorkload(nodes, runner=runner))
    row = uncertain(controls, action='stop_workload', container='c' * 64)
    assert controls.proposal_check(operation=row['id'])['state'] == 'succeeded'
    assert len(calls) == 1 and calls[0]['container'] == 'c' * 64


@pytest.mark.parametrize('action', ['wake', 'sleep'])
def test_real_qualified_power_observation_never_advances_or_sends_effects(tmp_path, monkeypatch, action):
    from test_power_sequence import rig as power_rig, NODE, low
    store, meter, transport, power, tick, _ = power_rig(tmp_path)
    controls = compose(store, [NODE], binding=lambda: OwnerBinding('one', 'owner', 'basic', '', 12345, 12345), power=power)
    owner = Owner('one', 'web')
    row = controls.prepare(owner, request_key='power', request_ref='power', action=action, spark='spark2')
    if action == 'wake':
        meter.row.update(on=False, watts=0)
        transport.unreachable = True
    assert controls.confirm(owner, row['id'], row['digest'])['state'] == 'uncertain'
    if action == 'sleep': low(meter, transport)
    effects = (list(meter.sent), transport.calls.count('sleep'))
    monkeypatch.setattr(power, 'advance', lambda *_: pytest.fail('Model check cannot advance'))
    monkeypatch.setattr(power.sequence, 'advance', lambda *_: pytest.fail('Model check cannot advance a sequence'))
    monkeypatch.setattr(power, 'dispatch', lambda *_: pytest.fail('Model check cannot dispatch'))
    for _ in range(5):
        tick(10)
        assert controls.proposal_check(operation=row['id'])['state'] == 'uncertain'
    assert (meter.sent, transport.calls.count('sleep')) == effects
    assert meter.sent == []


@pytest.mark.parametrize('action', ['wake', 'sleep'])
def test_power_without_ac_cut_profile_only_observes_existing_result(tmp_path, action):
    from test_power import rig as power_rig, sleep_rig, NODE
    store, meter, transport, power = (sleep_rig if action == 'sleep' else power_rig)(tmp_path)
    controls = compose(store, [NODE], binding=lambda: OwnerBinding('one', 'owner', 'basic', '', 12345, 12345), power=power)
    row = uncertain(controls, action=action)
    meter.row['on'] = True
    assert controls.proposal_check(operation=row['id'])['state'] == 'succeeded'
    assert meter.sent == [] and set(transport.calls) <= {'inspect'}


def test_uncertain_memory_check_never_erases_or_exposes_plan(tmp_path, monkeypatch):
    from sparkie_sparks import memory_erase
    controls = compose(OperationStore(tmp_path / 'operations.sqlite'), [],
        binding=lambda: OwnerBinding('one', 'owner', 'basic', '', 12345, 12345),
        workloads=SimpleNamespace(nodes={}), memory_home=tmp_path)
    owner = Owner('one', 'web')
    plan = {'target': 'user', 'memory_entries': 1, 'message_rows': 2, 'session_rows': 1, 'private': 'canary-secret'}
    row = controls.store.prepare_memory(owner, request_key='erase', request_ref='erase', plan=plan)
    controls.store.run(owner, row['id'], approval_digest=row['digest'], dispatch=lambda *_: None, observe=lambda *_: 'unknown')
    monkeypatch.setattr(memory_erase, 'apply', lambda *_: pytest.fail('Observation cannot erase'))
    result = controls.proposal_check(operation=row['id'])
    assert result['state'] == 'uncertain' and result['intent'] == {'action': 'erase_memory'}
    assert 'canary-secret' not in json.dumps(result) and 'digest' not in result
    with controls.store._db() as db:
        assert db.execute('SELECT operation FROM claims WHERE spark=?', ('memory',)).fetchone()[0] == row['id']


@pytest.mark.integration
def test_native_plugin_registers_actual_check_handler_and_narrow_schema(rig, tmp_path, monkeypatch):
    from hermes_cli.plugins import PluginManager
    from tools.registry import registry
    home = tmp_path / 'native'
    shutil.copytree(Path(__file__).resolve().parents[1] / 'plugin', home / 'plugins/sparkie-sparks')
    (home / 'config.yaml').write_text('plugins:\n  enabled:\n    - sparkie-sparks\n')
    monkeypatch.setenv('HERMES_HOME', str(home))
    manager = PluginManager(scope_key=str(home))
    manager.discover_and_load()
    entry = registry.get_entry('spark_check_change', scope=manager.scope_key)
    assert entry is not None
    assert entry.schema['parameters']['required'] == ['operation']
    assert set(entry.schema['parameters']['properties']) == {'operation', 'final_reply'}
    assert entry.schema['parameters']['properties']['final_reply']['type'] == 'boolean'
    assert entry.schema['parameters']['additionalProperties'] is False
    row = uncertain(rig[0])
    checked = json.loads(entry.handler({'operation': row['id']}))
    assert checked['request']['state'] == 'succeeded' and checked['change_dispatched'] is False
    assert rig[1] == []
