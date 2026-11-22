"""Controlled-time controller scans; no physical power changes."""
from datetime import datetime, timezone
import hashlib

import pytest

from sparkie_sparks.idle import IdlePower
from sparkie_sparks.operations import NotDispatched
from sparkie_sparks.power import FleetPower
from test_power import NOW, NODE, HUB, MAPPING, Meter, Transport, rig as power_rig
from test_workspace_worker import rig as workspace_rig, REQUEST, SCOPE


def rig(tmp_path, *, qualified=True):
    blockers = [[]]
    clock = [NOW.timestamp()]
    def clean(operation, node):
        return {'operation': operation, 'machine_id': node['machine_id'], 'state': 'clean_shutdown',
                'observed_at': datetime.fromtimestamp(clock[0], timezone.utc).isoformat()}
    settings = dict(activity=lambda node: blockers[0], shutdown_observer=clean, recovery_ready=('spark2',)) if qualified else {}
    store, meter, transport, power = power_rig(tmp_path, **settings)
    store.clock = lambda: clock[0]
    power.clock = lambda: datetime.fromtimestamp(clock[0], timezone.utc)
    meter.row['on'] = True
    policy = IdlePower(store, power, revision='owner-policy-1', idle_seconds=10, max_observation_gap=20)
    def advance(seconds):
        clock[0] += seconds
        stamp = datetime.fromtimestamp(clock[0], timezone.utc).isoformat()
        meter.row.update(measured_at=stamp, observed_at=stamp)
    return store, meter, transport, power, policy, blockers, advance


def test_auto_idle_uses_durable_policy_receipt_and_same_checked_power_path(tmp_path):
    store, meter, transport, power, policy, blockers, advance = rig(tmp_path)
    assert policy.scan() == []
    advance(10)
    result = policy.scan()
    assert len(result) == 1 and result[0]['state'] == 'succeeded'
    assert transport.calls.count('sleep') == 1 and meter.sent == []
    with store._db() as db:
        assert db.execute('SELECT COUNT(*) FROM operations').fetchone()[0] == 0
        assert db.execute('SELECT COUNT(*) FROM claims').fetchone()[0] == 0
        assert db.execute('SELECT revision FROM power_policy_operations').fetchone()[0] == 'owner-policy-1'


def test_unqualified_sleep_cannot_be_enabled_by_an_idle_timer(tmp_path):
    store, meter, transport, power, policy, blockers, advance = rig(tmp_path, qualified=False)
    for _ in range(4):
        policy.scan()
        advance(10)
    assert 'sleep' not in transport.calls and meter.sent == []


@pytest.mark.parametrize('interruption', ['busy', 'unknown', 'gap', 'clock', 'revision'])
def test_idle_interval_restarts_after_unknown_activity_gap_or_policy_change(tmp_path, interruption):
    store, meter, transport, power, policy, blockers, advance = rig(tmp_path)
    policy.scan()
    advance(8)
    if interruption == 'busy': blockers[0] = ['Detached build']
    if interruption == 'unknown': blockers[0] = None
    if interruption == 'gap': advance(30)
    if interruption == 'clock': advance(-20)
    if interruption == 'revision': policy = IdlePower(store, power, revision='owner-policy-2', idle_seconds=10)
    policy.scan()
    blockers[0] = []
    advance(3)
    assert policy.scan() == [] and 'sleep' not in transport.calls


def test_pending_shutdown_is_only_observed_after_restart_never_sent_again(tmp_path):
    store, meter, transport, power, policy, blockers, advance = rig(tmp_path)
    power.shutdown_observer = lambda *args: None
    policy.scan()
    advance(10)
    first = policy.scan()[0]
    assert first['state'] == 'uncertain'
    restarted = IdlePower(store, power, revision='owner-policy-1', idle_seconds=10)
    advance(10)
    assert restarted.scan()[0]['id'] == first['id']
    assert transport.calls.count('sleep') == 1
    with store._db() as db:
        assert db.execute('SELECT operation FROM claims').fetchone()[0] == first['id']


def test_power_policy_rejects_unknown_receipts_and_cannot_target_host(tmp_path):
    store, meter, transport, power, policy, blockers, advance = rig(tmp_path)
    with pytest.raises(NotDispatched):
        power.dispatch_policy('f' * 32, {'action': 'sleep', 'spark': 'spark2'})
    with pytest.raises(ValueError):
        power.dispatch_policy('f' * 32, {'action': 'sleep', 'spark': 'spark1'})
    assert transport.calls == [] and meter.sent == []


def test_new_or_held_claim_blocks_automatic_shutdown(tmp_path):
    store, meter, transport, power, policy, blockers, advance = rig(tmp_path)
    policy.scan()
    with store._db() as db:
        db.execute('INSERT INTO claims VALUES (?,?)', ('spark2', 'f' * 32))
    advance(10)
    assert policy.scan() == [] and 'sleep' not in transport.calls


def test_admitted_wake_reconciles_before_provision_without_duplicate_on(tmp_path):
    store, docker, worker, leases = workspace_rig(tmp_path)
    node = {'id': 'spark4', 'hostname': 'compute-fixture', 'address': '192.0.2.4', 'user': 'owner', 'machine_id': '4' * 32}
    meter, transport = Meter(), Transport()
    meter.row['id'] = 'spark4'
    transport.inspection['machine_id'] = node['machine_id']
    meter.lose_reply, meter.apply_on = True, False
    power = FleetPower(store, [node], {'spark4': MAPPING['spark2']}, hub_machine_id=HUB,
                       matter=meter, transport=transport, clock=lambda: NOW)
    policy = IdlePower(store, power, revision='owner-policy-1', idle_seconds=10)
    leases.ensure_awake = lambda allocation: policy.wake(allocation)['state'] == 'succeeded'
    with pytest.raises(RuntimeError, match='No workspace creation was sent'):
        leases.acquire(SCOPE, REQUEST)
    allocation = leases.get(SCOPE, REQUEST.task_id)
    assert allocation.state == 'reserved' and docker.count(['create']) == 0
    assert meter.sent == [('on', 'spark4')]
    meter.row['on'] = True
    lease = leases.acquire(SCOPE, REQUEST)
    assert lease.workspace_id == allocation.allocation_id
    assert len(meter.sent) == 1 and docker.count(['create']) == 1
    with store._db() as db:
        assert not db.execute('SELECT * FROM claims').fetchall()


def test_unadmitted_allocation_cannot_wake(tmp_path):
    store, docker, worker, leases = workspace_rig(tmp_path)
    allocation = leases._reserve(SCOPE, REQUEST)
    node = {'id': 'spark4', 'hostname': 'compute-fixture', 'address': '192.0.2.4', 'user': 'owner', 'machine_id': '4' * 32}
    meter = Meter()
    power = FleetPower(store, [node], {'spark4': MAPPING['spark2']}, hub_machine_id=HUB, matter=meter)
    policy = IdlePower(store, power, revision='owner-policy-1', idle_seconds=10)
    with pytest.raises(ValueError, match='admission'):
        policy.wake(allocation)
    assert meter.sent == []


def test_previously_successful_wake_must_still_be_physically_ready_before_provision(tmp_path):
    store, docker, worker, leases = workspace_rig(tmp_path)
    node = {'id': 'spark4', 'hostname': 'compute-fixture', 'address': '192.0.2.4', 'user': 'owner', 'machine_id': '4' * 32}
    meter, transport = Meter(), Transport()
    meter.row['id'] = 'spark4'
    transport.inspection['machine_id'] = node['machine_id']
    power = FleetPower(store, [node], {'spark4': MAPPING['spark2']}, hub_machine_id=HUB,
                       matter=meter, transport=transport, clock=lambda: NOW)
    policy = IdlePower(store, power, revision='owner-policy-1', idle_seconds=10)
    def interrupted(allocation):
        assert policy.wake(allocation)['state'] == 'succeeded'
        transport.unreachable = True
        assert policy.wake(allocation)['state'] == 'uncertain'
        return False
    leases.ensure_awake = interrupted
    with pytest.raises(RuntimeError, match='not verified awake'):
        leases.acquire(SCOPE, REQUEST)
    assert docker.count(['create']) == 0 and len(meter.sent) == 1
    transport.unreachable = False
    leases.ensure_awake = lambda allocation: policy.wake(allocation)['state'] == 'succeeded'
    leases.acquire(SCOPE, REQUEST)
    assert docker.count(['create']) == 1 and len(meter.sent) == 1


def test_power_inventory_must_match_allocation_physical_machine(tmp_path):
    store, docker, worker, leases = workspace_rig(tmp_path)
    node = {'id': 'spark4', 'hostname': 'compute-fixture', 'address': '192.0.2.4', 'user': 'owner', 'machine_id': '3' * 32}
    meter = Meter()
    power = FleetPower(store, [node], {'spark4': MAPPING['spark2']}, hub_machine_id=HUB, matter=meter)
    policy = IdlePower(store, power, revision='owner-policy-1', idle_seconds=10)
    def refused(allocation):
        with pytest.raises(ValueError, match='exact admitted'):
            policy.wake(allocation)
        return False
    leases.ensure_awake = refused
    with pytest.raises(RuntimeError, match='not verified awake'):
        leases.acquire(SCOPE, REQUEST)
    assert meter.sent == [] and docker.calls == []
