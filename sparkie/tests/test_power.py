"""Typed power behavior with stand-ins only; never sends a hardware command."""
from datetime import datetime, timedelta, timezone
import hashlib
import json
from types import SimpleNamespace

import pytest

from sparkie_sparks.authority import Owner
from sparkie_sparks.operations import NotDispatched, OperationStore
from sparkie_sparks.power import FleetPower, PowerMatter, PowerTransport

NOW = datetime(2026, 11, 19, 20, tzinfo=timezone.utc)
HUB = '1' * 32
NODE = {'id': 'spark2', 'hostname': 'compute-fixture', 'address': '192.0.2.2', 'user': 'owner', 'machine_id': '2' * 32}
UID = 'physical-plug-fixture'
MAPPING = {'spark2': {'node': 12, 'fingerprint': hashlib.sha256(UID.encode()).hexdigest()}}
OWNER = Owner('owner-generation', 'telegram')


class Meter:
    def __init__(self):
        self.row = {'id': 'spark2', 'available': True, 'on': False, 'source': 'Matter device read',
                    'measured_at': NOW.isoformat(), 'observed_at': NOW.isoformat()}
        self.sent, self.lose_reply, self.apply_on = [], False, True
    def observe(self, spark): return dict(self.row)
    def on(self, spark):
        self.sent.append(('on', spark))
        if self.apply_on: self.row['on'] = True
        if self.lose_reply: raise TimeoutError('lost reply')


class Transport:
    def __init__(self):
        self.calls = []
        self.inspection = {'status': 'observed', 'hostname': NODE['hostname'], 'machine_id': NODE['machine_id'],
                           'docker_ready': True, 'workloads': []}
        self.unreachable, self.sleep_status = False, 'sent'
    def request(self, node, hub_machine_id, mode):
        self.calls.append(mode)
        if self.unreachable: raise TimeoutError('SSH not reachable')
        return dict(self.inspection) if mode == 'inspect' else {'status': self.sleep_status}


def rig(tmp_path, **kwargs):
    store = OperationStore(tmp_path / 'operations.sqlite', clock=lambda: NOW.timestamp())
    meter, transport = Meter(), Transport()
    adapter = FleetPower(store, [NODE], MAPPING, hub_machine_id=HUB, matter=meter,
                         transport=transport, clock=lambda: NOW, **kwargs)
    return store, meter, transport, adapter


def request(store, action='wake'):
    return store.prepare(OWNER, request_key='test:' + action, request_ref='owner:' + action, action=action, spark='spark2')


def run(store, adapter, row):
    return store.run(OWNER, row['id'], approval_digest=row['digest'], dispatch=adapter.dispatch, observe=adapter.observe)


def clean(operation, node):
    return {'operation': operation, 'machine_id': node['machine_id'], 'state': 'clean_shutdown', 'observed_at': NOW.isoformat()}


def sleep_rig(tmp_path, **changes):
    settings = {'activity': lambda node: [], 'shutdown_observer': clean, 'recovery_ready': ('spark2',)}
    settings.update(changes)
    store, meter, transport, adapter = rig(tmp_path, **settings)
    meter.row['on'] = True
    return store, meter, transport, adapter


def test_wake_uses_exact_owner_operation_and_one_on_then_observes_machine_and_docker(tmp_path):
    store, meter, transport, adapter = rig(tmp_path)
    row = request(store)
    with pytest.raises(NotDispatched): adapter.dispatch(row['id'], row['intent'])
    assert meter.sent == []
    assert run(store, adapter, row)['state'] == 'succeeded'
    assert meter.sent == [('on', 'spark2')]
    assert transport.calls == ['inspect']
    assert adapter.result(row['id'], row['intent'])['plug_off_sent'] is False
    with pytest.raises(PermissionError): run(store, adapter, row)
    assert len(meter.sent) == 1


def test_lost_on_acknowledgement_is_reconciled_without_sending_again(tmp_path):
    store, meter, transport, adapter = rig(tmp_path)
    meter.lose_reply = True
    row = request(store)
    assert run(store, adapter, row)['state'] == 'succeeded'
    assert len(meter.sent) == 1


def test_unknown_wake_survives_restart_and_only_observes_until_ready(tmp_path):
    store, meter, transport, adapter = rig(tmp_path)
    meter.lose_reply, meter.apply_on = True, False
    row = request(store)
    assert run(store, adapter, row)['state'] == 'uncertain'
    reopened = OperationStore(store.path, clock=lambda: NOW.timestamp())
    restarted = FleetPower(reopened, [NODE], MAPPING, hub_machine_id=HUB, matter=meter, transport=transport, clock=lambda: NOW)
    assert reopened.reconcile(row['id'], observe=restarted.observe)['state'] == 'uncertain'
    meter.row['on'] = True
    assert reopened.reconcile(row['id'], observe=restarted.observe)['state'] == 'succeeded'
    assert len(meter.sent) == 1


@pytest.mark.parametrize('unreachable,docker_ready', [(True, True), (False, False)])
def test_powered_but_unready_machine_is_never_hard_cycled(tmp_path, unreachable, docker_ready):
    store, meter, transport, adapter = rig(tmp_path)
    meter.row['on'] = True
    transport.unreachable, transport.inspection['docker_ready'] = unreachable, docker_ready
    assert run(store, adapter, request(store))['state'] == 'failed'
    assert meter.sent == []


@pytest.mark.parametrize('change', [
    {'id': 'spark3'}, {'available': False}, {'source': 'Matter controller report'},
    {'measured_at': None}, {'on': 'false'},
    {'measured_at': (NOW - timedelta(minutes=1)).isoformat(), 'observed_at': (NOW - timedelta(minutes=1)).isoformat()},
])
def test_stale_cached_wrong_or_missing_plug_observation_cannot_send_power(tmp_path, change):
    store, meter, transport, adapter = rig(tmp_path)
    meter.row.update(change)
    assert run(store, adapter, request(store))['state'] == 'failed'
    assert meter.sent == [] and transport.calls == []


@pytest.mark.parametrize('change', [{'machine_id': '3' * 32}, {'hostname': 'another-machine'}, {'docker_ready': False}])
def test_plug_on_does_not_mean_wake_succeeded(tmp_path, change):
    store, meter, transport, adapter = rig(tmp_path)
    transport.inspection.update(change)
    assert run(store, adapter, request(store))['state'] == 'uncertain'
    assert len(meter.sent) == 1


@pytest.mark.parametrize('settings', [{}, {'activity': lambda node: []}, {'shutdown_observer': clean},
                                       {'activity': lambda node: [], 'shutdown_observer': clean}])
def test_sleep_is_not_advertised_without_complete_recovery_and_observation(tmp_path, settings):
    store, meter, transport, adapter = rig(tmp_path, **settings)
    assert adapter.actions_for('spark2') == ('wake',)
    assert adapter.actions_for('spark1') == ()
    assert adapter.capabilities()['spark2']['hard_cut'] is False
    assert run(store, adapter, request(store, 'sleep'))['state'] == 'failed'
    assert meter.sent == [] and transport.calls == []


@pytest.mark.parametrize('workloads,blockers', [(['a' * 64], []), (None, []), ([], None), ([], ['active owner session']), ([], False)])
def test_sleep_refuses_busy_or_unknown_work_without_stopping_it(tmp_path, workloads, blockers):
    store, meter, transport, adapter = sleep_rig(tmp_path, activity=lambda node: blockers)
    transport.inspection['workloads'] = workloads
    assert run(store, adapter, request(store, 'sleep'))['state'] == 'failed'
    assert 'sleep' not in transport.calls and meter.sent == []


def test_verified_sleep_explicitly_leaves_ac_on_and_never_calls_plug_off(tmp_path):
    store, meter, transport, adapter = sleep_rig(tmp_path)
    assert adapter.actions_for('spark2') == ('wake', 'sleep')
    row = request(store, 'sleep')
    assert run(store, adapter, row)['state'] == 'succeeded'
    result = adapter.result(row['id'], row['intent'])
    assert result['ac_power_on'] is True and result['plug_off_sent'] is False
    assert 'plug stays on' in result['message'] and 'unavailable' in result['message']
    assert transport.calls.count('sleep') == 1 and meter.sent == []


@pytest.mark.parametrize('proof', [None, {'state': 'clean_shutdown'},
    {'operation': 'wrong', 'machine_id': NODE['machine_id'], 'state': 'clean_shutdown', 'observed_at': NOW.isoformat()}])
def test_systemctl_acceptance_or_missing_shutdown_proof_cannot_claim_sleep_success(tmp_path, proof):
    store, meter, transport, adapter = sleep_rig(tmp_path, shutdown_observer=lambda *args: proof)
    row = request(store, 'sleep')
    assert run(store, adapter, row)['state'] == 'uncertain'
    assert 'not verified' in adapter.result(row['id'], row['intent'])['message']
    assert transport.calls.count('sleep') == 1 and meter.sent == []


def test_worker_refusal_after_last_activity_check_is_not_a_shutdown(tmp_path):
    store, meter, transport, adapter = sleep_rig(tmp_path)
    transport.sleep_status = 'refused'
    assert run(store, adapter, request(store, 'sleep'))['state'] == 'failed'
    assert meter.sent == []


@pytest.mark.parametrize('change', [{'id': 'spark1'}, {'machine_id': HUB}, {'machine_id': None}, {'hostname': 'hub-host.invalid'}, {'address': '-oBad=yes'}])
def test_physical_hub_and_unverified_inventory_cannot_enable_power(tmp_path, change):
    store = OperationStore(tmp_path / 'operations.sqlite')
    with pytest.raises(ValueError):
        FleetPower(store, [{**NODE, **change}], MAPPING, hub_machine_id=HUB)


def test_native_on_checks_device_identity_and_endpoint_then_sends_once_without_fallback():
    calls = []
    class Reader:
        def _ask(self, command, args):
            calls.append((command, args))
            if command == 'read_attribute': return {'0/40/18': UID, '2/6/0': False}
            raise TimeoutError('On reply was lost')
    with pytest.raises(TimeoutError): PowerMatter(MAPPING, reader=Reader()).on('spark2')
    assert calls[-1] == ('device_command', {'node_id': 12, 'endpoint_id': 2, 'cluster_id': 6, 'command_name': 'on', 'payload': {}})
    assert len(calls) == 2


@pytest.mark.parametrize('attrs', [{'0/40/18': 'wrong', '1/6/0': False},
                                 {'0/40/18': UID, '1/6/0': False, '2/6/0': False}])
def test_reassigned_or_ambiguous_plug_is_not_switched(attrs):
    calls = []
    class Reader:
        def _ask(self, command, args):
            calls.append(command)
            return attrs
    with pytest.raises(NotDispatched): PowerMatter(MAPPING, reader=Reader()).on('spark2')
    assert calls == ['read_attribute']


def test_transport_uses_strict_ssh_and_validates_remote_physical_identity():
    calls = []
    def runner(args, **kwargs):
        calls.append(args)
        return SimpleNamespace(returncode=0, stdout=json.dumps({'status': 'sent', 'hostname': NODE['hostname'], 'machine_id': '3' * 32}))
    with pytest.raises(RuntimeError, match='physical Spark identity'):
        PowerTransport(runner=runner).request(NODE, HUB, 'sleep')
    assert 'StrictHostKeyChecking=yes' in calls[0]
    assert calls[0][-1].startswith('python3 -I -c ')
