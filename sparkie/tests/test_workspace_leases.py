"""Durable reservation/reconciliation with injected effects; no host mutations."""
from dataclasses import replace
from threading import Event, Thread

import pytest

from sparkie_sparks.authority import Owner
from sparkie_sparks.operations import OperationStore
from sparkie_sparks.workspace_leases import ResourceBudget, WorkspaceLeases, WorkspaceObservation
from sparkie_sparks.workspace_types import ComputeNode, WorkspaceLease, WorkspaceRequest

IMAGE = 'sha256:' + 'a' * 64
HUB = '1' * 32
NODES = (ComputeNode('spark2', '2' * 32, '192.0.2.2'), ComputeNode('spark3', '3' * 32, '192.0.2.3'))
SCOPE = 'owner-runtime:personal-profile'
REQUEST = WorkspaceRequest('native-task', IMAGE, 2, 4096, 60000, True)


class Effects:
    def __init__(self, store):
        self.store, self.calls, self.reads = store, [], []
        self.outcomes, self.blockers, self.lose_reply, self.apply = {}, [], False, True
        self.entered = self.resume = None

    @staticmethod
    def lease(allocation):
        return allocation.lease or WorkspaceLease(
            allocation.request, allocation.allocation_id, allocation.node.spark_id, allocation.node.machine_id,
            allocation.node.host, 2222, 'sandbox', allocation.allocation_id * 2, IMAGE,
            '/private/' + allocation.allocation_id + '/client', '/private/' + allocation.allocation_id + '/hosts',
            'sparkie-workspace-' + allocation.allocation_id, 'ssh-ed25519 AAAAFixture')

    def provision(self, allocation):
        # The callback sees a real committed dispatch record and resource claim.
        with self.store._db() as db:
            row = db.execute('SELECT state,operation_id FROM workspace_leases WHERE allocation_id=?',
                             (allocation.allocation_id,)).fetchone()
            assert tuple(row) == ('dispatching', allocation.operation_id)
            assert db.execute('SELECT operation FROM claims WHERE spark=?', (allocation.node.spark_id,)).fetchone()[0] == allocation.operation_id
        self.calls.append(allocation)
        if self.entered:
            self.entered.set()
            assert self.resume.wait(5), 'Fixture provision was not released'
        if self.apply:
            self.outcomes[allocation.allocation_id] = WorkspaceObservation(allocation.allocation_id, 'ready', self.lease(allocation))
        if self.lose_reply:
            raise TimeoutError('synthetic lost reply')

    def observe(self, allocation):
        self.reads.append(allocation.allocation_id)
        return self.outcomes.get(allocation.allocation_id, WorkspaceObservation(allocation.allocation_id, 'unknown'))

    def activity(self, allocation):
        return self.blockers

    def stop(self, lease):
        self.outcomes[lease.workspace_id] = WorkspaceObservation(lease.workspace_id, 'stopped', lease)


def manager(store, effects, *, nodes=NODES, budgets=None, candidate_order=None):
    return WorkspaceLeases(store, nodes=nodes, hub_machine_id=HUB, image=IMAGE,
        budgets=budgets or {node.spark_id: ResourceBudget(2, 4096, 100000) for node in nodes},
        provision=effects.provision, observe=effects.observe, activity=effects.activity, candidate_order=candidate_order)


def rig(tmp_path, **kwargs):
    store = OperationStore(tmp_path / 'operations.sqlite')
    effects = Effects(store)
    return store, effects, manager(store, effects, **kwargs)


def test_exact_task_survives_allocator_restart_and_scope_is_part_of_identity(tmp_path):
    store, effects, leases = rig(tmp_path)
    first = leases.acquire(SCOPE, REQUEST)
    assert leases.acquire(SCOPE, REQUEST) == first
    reopened = OperationStore(store.path)
    restored = manager(reopened, effects)
    assert restored.acquire(SCOPE, REQUEST) == first
    second = restored.acquire('owner-runtime:other-profile', REQUEST)
    assert second.workspace_id != first.workspace_id and second.spark_id != first.spark_id
    assert len(effects.calls) == 2
    with store._db() as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 2
        assert db.execute('SELECT version FROM workspace_lease_schema').fetchone()[0] == 1
        assert db.execute('SELECT COUNT(*) FROM operations').fetchone()[0] == 0


def test_lost_success_reply_is_observed_without_another_create(tmp_path):
    _, effects, leases = rig(tmp_path)
    effects.lose_reply = True
    lease = leases.acquire(SCOPE, REQUEST)
    assert leases.acquire(SCOPE, REQUEST) == lease
    assert len(effects.calls) == 1


def test_unknown_creation_retains_id_and_claim_until_restart_reconciles(tmp_path):
    store, effects, leases = rig(tmp_path)
    effects.apply, effects.lose_reply = False, True
    for current in (leases, manager(OperationStore(store.path), effects)):
        with pytest.raises(RuntimeError, match='not verified ready'):
            current.acquire(SCOPE, REQUEST)
    allocation = leases.get(SCOPE, REQUEST.task_id)
    assert allocation.state == 'uncertain' and allocation.resources_held
    with store._db() as db:
        assert db.execute('SELECT operation FROM claims WHERE spark=?', (allocation.node.spark_id,)).fetchone()[0] == allocation.operation_id
    lease = effects.lease(allocation)
    effects.outcomes[allocation.allocation_id] = WorkspaceObservation(allocation.allocation_id, 'ready', lease)
    assert leases.acquire(SCOPE, REQUEST) == lease
    assert len(effects.calls) == 1
    with store._db() as db:
        assert db.execute('SELECT COUNT(*) FROM claims').fetchone()[0] == 0


def test_concurrent_same_task_has_one_dispatch_and_reserved_capacity_is_visible(tmp_path):
    _, effects, leases = rig(tmp_path, nodes=NODES[:1])
    effects.entered, effects.resume = Event(), Event()
    results, failures = [], []
    def acquire():
        try:
            results.append(leases.acquire(SCOPE, REQUEST))
        except Exception as exc:
            failures.append(exc)
    worker = Thread(target=acquire)
    worker.start()
    try:
        assert effects.entered.wait(5)
        with pytest.raises(RuntimeError, match='already being checked'):
            leases.acquire(SCOPE, REQUEST)
        with pytest.raises(RuntimeError, match='room'):
            leases.acquire(SCOPE, replace(REQUEST, task_id='second-task'))
        assert leases.reservations()['spark2'] == ResourceBudget(2, 4096, 60000)
    finally:
        effects.resume.set()
        worker.join(5)
    assert not worker.is_alive() and not failures and len(results) == len(effects.calls) == 1


@pytest.mark.parametrize('change', [{'cpu': 2.1}, {'memory_mb': 4097}, {'disk_mb': 100001}])
def test_each_resource_budget_is_checked_before_recording_or_dispatch(tmp_path, change):
    _, effects, leases = rig(tmp_path)
    with pytest.raises(RuntimeError, match='room'):
        leases.acquire(SCOPE, replace(REQUEST, **change))
    assert leases.get(SCOPE, REQUEST.task_id) is None and effects.calls == []


@pytest.mark.parametrize('blockers,state,expected', [
    (None, 'stopped', 'unknown'), (['detached process'], 'stopped', 'running'),
    ([], 'ready', 'running'), ([], 'unknown', 'unknown'), ([], 'missing', 'unknown'),
])
def test_release_hint_does_not_release_running_unknown_or_unchecked_work(tmp_path, blockers, state, expected):
    _, effects, leases = rig(tmp_path)
    lease = leases.acquire(SCOPE, REQUEST)
    effects.blockers = blockers
    effects.outcomes[lease.workspace_id] = WorkspaceObservation(lease.workspace_id, state, lease)
    observed = leases.idle(SCOPE, lease)
    assert observed.state == expected and observed.operation_id
    assert leases.get(SCOPE, REQUEST.task_id).resources_held
    assert leases.reservations()['spark2'] == ResourceBudget(2, 4096, 60000)
    assert len(effects.calls) == 1


def test_stopped_workspace_keeps_disk_and_resumes_only_same_lease_after_capacity_returns(tmp_path):
    _, effects, leases = rig(tmp_path, nodes=NODES[:1])
    first = leases.acquire(SCOPE, REQUEST)
    effects.stop(first)
    idle = leases.idle(SCOPE, first)
    assert idle.state == 'stopped'
    assert leases.reservations()['spark2'] == ResourceBudget(0, 0, 60000)
    with pytest.raises(RuntimeError, match='room'):
        leases.acquire(SCOPE, replace(REQUEST, task_id='second', disk_mb=40001))
    second_request = replace(REQUEST, task_id='second', disk_mb=40000)
    second = leases.acquire(SCOPE, second_request)
    with pytest.raises(RuntimeError, match='cannot resume'):
        leases.acquire(SCOPE, REQUEST)
    assert len(effects.calls) == 2
    assert leases.get(SCOPE, REQUEST.task_id).resources_held is False
    effects.stop(second)
    assert leases.idle(SCOPE, second).state == 'stopped'
    assert leases.acquire(SCOPE, REQUEST) == first
    assert effects.calls[-1].lease == first
    assert effects.calls[-1].operation_id != effects.calls[0].operation_id
    assert leases.reservations()['spark2'] == ResourceBudget(2, 4096, 100000)


@pytest.mark.parametrize('change', [{'spark_id': 'spark1'}, {'machine_id': HUB}, {'container_id': 'b' * 64},
                                  {'host': 'another-host'}, {'key_path': '/private/other-key'}])
def test_reconciliation_cannot_replace_enrolled_identity(tmp_path, change):
    _, effects, leases = rig(tmp_path)
    lease = leases.acquire(SCOPE, REQUEST)
    effects.outcomes[lease.workspace_id] = WorkspaceObservation(lease.workspace_id, 'ready', replace(lease, **change))
    with pytest.raises(RuntimeError, match='not verified ready'):
        leases.acquire(SCOPE, REQUEST)
    saved = leases.get(SCOPE, REQUEST.task_id)
    assert saved.lease == lease and saved.resources_held
    assert len(effects.calls) == 1


def test_wrong_observation_id_cannot_release_a_workspace(tmp_path):
    _, effects, leases = rig(tmp_path)
    lease = leases.acquire(SCOPE, REQUEST)
    effects.outcomes[lease.workspace_id] = WorkspaceObservation('f' * 32, 'stopped', lease)
    assert leases.idle(SCOPE, lease).state == 'unknown'
    assert leases.get(SCOPE, REQUEST.task_id).resources_held
    with pytest.raises(ValueError):
        leases.idle('different-scope', lease)


@pytest.mark.parametrize('change', [{'cpu': 1}, {'image': 'sha256:' + 'b' * 64}, {'persistent': False}])
def test_existing_request_cannot_widen_or_replace_its_allocation(tmp_path, change):
    _, effects, leases = rig(tmp_path)
    first = leases.acquire(SCOPE, REQUEST)
    with pytest.raises(ValueError):
        leases.acquire(SCOPE, replace(REQUEST, **change))
    assert leases.get(SCOPE, REQUEST.task_id).lease == first and len(effects.calls) == 1


def test_hub_cannot_be_relabelled_as_a_compute_node(tmp_path):
    store = OperationStore(tmp_path / 'operations.sqlite')
    with pytest.raises(ValueError, match='Spark 1'):
        manager(store, Effects(store), nodes=(replace(NODES[0], machine_id=HUB),))


def test_existing_fleet_claim_prevents_allocation_and_unknown_allocation_blocks_other_effects(tmp_path):
    store, effects, leases = rig(tmp_path, nodes=NODES[:1])
    owner = Owner('owner-generation', 'web')
    row = store.prepare(owner, request_key='wake', request_ref='fixture', action='wake', spark='spark2')
    store.run(owner, row['id'], approval_digest=row['digest'], dispatch=lambda *args: None, observe=lambda *args: 'unknown')
    with pytest.raises(RuntimeError, match='room'):
        leases.acquire(SCOPE, REQUEST)
    assert effects.calls == []
    store.reconcile(row['id'], observe=lambda *args: 'succeeded')
    effects.apply = False
    with pytest.raises(RuntimeError, match='not verified ready'):
        leases.acquire(SCOPE, REQUEST)
    other = store.prepare(owner, request_key='stop', request_ref='fixture', action='stop_workload', spark='spark2', container='b' * 64)
    with pytest.raises(RuntimeError, match='must finish'):
        store.run(owner, other['id'], approval_digest=other['digest'], dispatch=lambda *args: pytest.fail('Unexpected effect'), observe=lambda *args: 'succeeded')
    assert store.get(other['id'])['state'] == 'pending'


def test_unsupported_lease_schema_is_preserved_without_changing_owner_operations(tmp_path):
    store, effects, leases = rig(tmp_path)
    first = leases.acquire(SCOPE, REQUEST)
    with store._db() as db:
        db.execute('UPDATE workspace_lease_schema SET version=99')
    with pytest.raises(ValueError, match='Unsupported workspace ledger'):
        manager(store, effects)
    assert leases.get(SCOPE, REQUEST.task_id).lease == first
    with store._db() as db:
        assert db.execute('SELECT version FROM workspace_lease_schema').fetchone()[0] == 99
        assert db.execute('PRAGMA user_version').fetchone()[0] == 2


def test_trusted_placement_can_prefer_awake_compute_without_retargeting_existing_work(tmp_path):
    placements = []
    def prefer_awake(scope, request):
        placements.append((scope, request.task_id))
        return ['spark3', 'spark2']
    _, effects, leases = rig(tmp_path, candidate_order=prefer_awake)
    first = leases.acquire(SCOPE, REQUEST)
    assert first.spark_id == 'spark3'
    assert leases.acquire(SCOPE, REQUEST) == first
    assert placements == [(SCOPE, REQUEST.task_id)] and len(effects.calls) == 1


@pytest.mark.parametrize('order', [['spark1'], ['spark2', 'spark2'], ['unknown'], 'spark2'])
def test_placement_cannot_introduce_unknown_or_ambiguous_targets(tmp_path, order):
    _, effects, leases = rig(tmp_path, candidate_order=lambda *args: order)
    with pytest.raises(ValueError, match='verified compute candidates'):
        leases.acquire(SCOPE, REQUEST)
    assert effects.calls == [] and leases.get(SCOPE, REQUEST.task_id) is None


@pytest.mark.parametrize('state,operation_id', [('missing', None), ('unknown', None), ('never_created', 'wrong')])
def test_missing_or_stale_absence_proof_cannot_release_unknown_creation(tmp_path, state, operation_id):
    _, effects, leases = rig(tmp_path)
    effects.apply = False
    with pytest.raises(RuntimeError):
        leases.acquire(SCOPE, REQUEST)
    allocation = leases.get(SCOPE, REQUEST.task_id)
    effects.outcomes[allocation.allocation_id] = WorkspaceObservation(allocation.allocation_id, state, operation_id=operation_id)
    with pytest.raises(RuntimeError, match='not been proved'):
        leases.abandon_uncreated(SCOPE, REQUEST.task_id)
    assert leases.get(SCOPE, REQUEST.task_id).resources_held
    assert leases.reservations()['spark2'] == ResourceBudget(2, 4096, 60000)


def test_exact_finished_uncreated_proof_releases_without_deleting_or_reusing_identity(tmp_path):
    store, effects, leases = rig(tmp_path, nodes=NODES[:1])
    effects.apply = False
    with pytest.raises(RuntimeError):
        leases.acquire(SCOPE, REQUEST)
    allocation = leases.get(SCOPE, REQUEST.task_id)
    effects.outcomes[allocation.allocation_id] = WorkspaceObservation(
        allocation.allocation_id, 'never_created', operation_id=allocation.operation_id)
    ended = leases.abandon_uncreated(SCOPE, REQUEST.task_id)
    assert ended.state == 'uncreated' and not ended.resources_held
    assert leases.reservations()['spark2'] == ResourceBudget(0, 0, 0)
    assert leases.abandon_uncreated(SCOPE, REQUEST.task_id) == ended
    with pytest.raises(RuntimeError, match='new native request identity'):
        leases.acquire(SCOPE, REQUEST)
    with store._db() as db:
        assert db.execute('SELECT COUNT(*) FROM claims').fetchone()[0] == 0
    effects.apply = True
    new = leases.acquire(SCOPE, replace(REQUEST, task_id='new-task'))
    assert new.workspace_id != allocation.allocation_id and len(effects.calls) == 2


def test_recorded_workspace_cannot_use_uncreated_storage_release(tmp_path):
    _, effects, leases = rig(tmp_path)
    lease = leases.acquire(SCOPE, REQUEST)
    effects.stop(lease)
    assert leases.idle(SCOPE, lease).state == 'stopped'
    with pytest.raises(ValueError, match='saved objects'):
        leases.abandon_uncreated(SCOPE, REQUEST.task_id)
    assert leases.reservations()['spark2'].disk_mb == REQUEST.disk_mb


def test_competing_fleet_change_blocks_reconnect_and_idle_resource_release(tmp_path):
    store, effects, leases = rig(tmp_path)
    lease = leases.acquire(SCOPE, REQUEST)
    owner = Owner('owner-generation', 'web')
    row = store.prepare(owner, request_key='wake', request_ref='fixture', action='wake', spark='spark2')
    store.run(owner, row['id'], approval_digest=row['digest'], dispatch=lambda *args: None, observe=lambda *args: 'unknown')
    with pytest.raises(RuntimeError, match='another change'):
        leases.acquire(SCOPE, REQUEST)
    effects.stop(lease)
    assert leases.idle(SCOPE, lease).state == 'unknown'
    assert leases.get(SCOPE, REQUEST.task_id).resources_held
    store.reconcile(row['id'], observe=lambda *args: 'succeeded')
    assert leases.idle(SCOPE, lease).state == 'stopped'
    assert len(effects.calls) == 1


def test_external_restart_is_accounted_for_even_when_budget_is_already_taken(tmp_path):
    _, effects, leases = rig(tmp_path, nodes=NODES[:1])
    first = leases.acquire(SCOPE, REQUEST)
    effects.stop(first)
    assert leases.idle(SCOPE, first).state == 'stopped'
    second = leases.acquire(SCOPE, replace(REQUEST, task_id='other-task', disk_mb=40000))
    effects.outcomes[first.workspace_id] = WorkspaceObservation(first.workspace_id, 'ready', first)
    with pytest.raises(RuntimeError, match='beyond the configured resource budget'):
        leases.acquire(SCOPE, REQUEST)
    assert leases.get(SCOPE, REQUEST.task_id).resources_held
    assert leases.get(SCOPE, second.request.task_id).resources_held
    assert leases.reservations()['spark2'] == ResourceBudget(4, 8192, 100000)
    assert len(effects.calls) == 2
