"""Released-workspace retirement, fixed endpoints and private credential export."""
from dataclasses import replace
import json

import pytest

from sparkie_sparks.operations import NotDispatched
from sparkie_sparks.workspace_types import ComputeNode
from test_workspace_worker import IMAGE, NODE, REQUEST, SCOPE, rig


def released(tmp_path):
    store, docker, worker, leases = rig(tmp_path)
    lease = leases.acquire(SCOPE, REQUEST)
    hint = leases.idle(SCOPE, lease)
    return store, docker, worker, leases, lease, hint.operation_id


def retire(leases, worker, release):
    return leases.retire(SCOPE, REQUEST.task_id, release, activity=worker.idle_activity, stop=worker.retire)


def test_released_empty_workspace_stops_once_retains_storage_and_resumes_exact_identity(tmp_path):
    store, docker, worker, leases, lease, release = released(tmp_path)
    docker.process_state = 'idle'
    result = retire(leases, worker, release)
    assert result.state == 'stopped' and docker.count(['stop']) == 1
    assert retire(leases, worker, release) == result and docker.count(['stop']) == 1
    assert not leases.get(SCOPE, REQUEST.task_id).resources_held
    assert leases.reservations()['spark4'].disk_mb == REQUEST.disk_mb
    assert leases.acquire(SCOPE, REQUEST) == lease
    assert docker.count(['create']) == 1 and docker.count(['start']) == 2
    assert leases.get(SCOPE, REQUEST.task_id).release_id is None
    with pytest.raises(ValueError, match='reused'):
        retire(leases, worker, release)


@pytest.mark.parametrize('activity', ['busy', 'unknown', 'unexpected'])
def test_detached_sessions_and_unknown_processes_keep_workspace_and_resources(tmp_path, activity):
    store, docker, worker, leases, lease, release = released(tmp_path)
    docker.process_state = activity
    assert retire(leases, worker, release).state == ('running' if activity == 'busy' else 'unknown')
    assert docker.count(['stop']) == 0 and leases.get(SCOPE, REQUEST.task_id).resources_held
    with store._db() as db:
        assert db.execute('SELECT COUNT(*) FROM workspace_retirements').fetchone()[0] == 0


def test_new_process_after_eligibility_refuses_before_stop(tmp_path):
    store, docker, worker, leases, lease, release = released(tmp_path)
    def eligibility(allocation):
        return []  # The worker's independent probe still sees the busy process.
    assert leases.retire(SCOPE, REQUEST.task_id, release, activity=eligibility, stop=worker.retire).state == 'running'
    assert docker.count(['stop']) == 0
    with store._db() as db:
        assert not db.execute('SELECT * FROM claims').fetchall()
        refused = db.execute('SELECT id FROM workspace_retirements').fetchone()[0]
    docker.process_state = 'idle'
    assert retire(leases, worker, release).state == 'stopped'
    with store._db() as db:
        assert db.execute('SELECT retry_of FROM workspace_retirements WHERE state=?', ('succeeded',)).fetchone()[0] == refused
    assert docker.count(['stop']) == 1


@pytest.mark.parametrize('apply', [False, True])
def test_lost_stop_reply_is_observed_without_another_stop(tmp_path, apply):
    store, docker, worker, leases, lease, release = released(tmp_path)
    docker.process_state, docker.lost_stop, docker.apply_stop = 'idle', True, apply
    result = retire(leases, worker, release)
    assert result.state == ('stopped' if apply else 'unknown')
    assert retire(leases, worker, release) == result
    assert docker.count(['stop']) == 1
    if not apply:
        with pytest.raises(RuntimeError, match='another change'):
            leases.acquire(SCOPE, REQUEST)
        docker.container['State'].update(Running=False, Status='exited')
        docker.server = False
        assert retire(leases, worker, release).state == 'stopped'
        assert docker.count(['stop']) == 1


def test_retirement_claim_and_allocation_lock_exclude_other_work(tmp_path):
    store, docker, worker, leases, lease, release = released(tmp_path)
    docker.process_state = 'idle'
    def stop(allocation, operation):
        with pytest.raises(RuntimeError, match='already being checked'):
            leases.acquire(SCOPE, REQUEST)
        with store._db() as db:
            assert db.execute('SELECT operation FROM claims').fetchone()[0] == operation
            assert db.execute('SELECT state FROM workspace_retirements').fetchone()[0] == 'dispatching'
        worker.retire(allocation, operation)
    assert leases.retire(SCOPE, REQUEST.task_id, release, activity=worker.idle_activity, stop=stop).state == 'stopped'


def test_foreign_claim_prevents_idle_send(tmp_path):
    store, docker, worker, leases, lease, release = released(tmp_path)
    docker.process_state = 'idle'
    with store._db() as db:
        db.execute('INSERT INTO claims VALUES (?,?)', ('spark4', 'f' * 32))
    assert retire(leases, worker, release).state == 'unknown'
    assert docker.count(['stop']) == 0


def test_no_idle_hint_or_unrecorded_retirement_can_stop(tmp_path):
    store, docker, worker, leases = rig(tmp_path)
    leases.acquire(SCOPE, REQUEST)
    docker.process_state = 'idle'
    allocation = leases.get(SCOPE, REQUEST.task_id)
    with pytest.raises(ValueError):
        worker.retire(allocation, 'f' * 32)
    with pytest.raises(ValueError):
        retire(leases, worker, 'f' * 32)
    assert docker.count(['stop']) == 0


def test_sandbox_credentials_are_only_exported_for_exact_saved_object(tmp_path):
    store, docker, worker, leases = rig(tmp_path)
    lease = leases.acquire(SCOPE, REQUEST)
    allocation = leases.get(SCOPE, REQUEST.task_id)
    result = worker.export_credentials(allocation)
    assert result['private_key'] == 'synthetic-private-key'
    assert result['known_hosts'].startswith(lease.host_key_alias + ' ssh-ed25519 ')
    with pytest.raises(ValueError):
        worker.export_credentials(replace(allocation, allocation_id='f' * 32))


@pytest.mark.parametrize('host', ['0.0.0.0', '8.8.8.8', '192.168.1.2', '100.128.0.1', '::1', 'example.test'])
def test_workspace_endpoint_never_binds_public_wildcard_or_unenrolled_network(tmp_path, host):
    with pytest.raises(ValueError):
        rig(tmp_path, node=replace(NODE, host=host))


def test_enrolled_endpoint_must_be_local_before_any_docker_or_key_effect(tmp_path):
    store, docker, worker, leases = rig(tmp_path, node=replace(NODE, host='100.64.0.4'), interface='eth1', local_addresses=lambda: set())
    with pytest.raises(RuntimeError, match='not verified ready'):
        leases.acquire(SCOPE, REQUEST)
    assert docker.calls == []


def test_trusted_remote_authorizer_cannot_bypass_physical_identity(tmp_path):
    calls = []
    store, docker, worker, leases = rig(tmp_path, identity=lambda: '1' * 32,
                                      authorize=lambda *args, **kwargs: calls.append(args) or True)
    with pytest.raises(RuntimeError):
        leases.acquire(SCOPE, REQUEST)
    assert calls == [] and docker.calls == []


def test_remote_authorizer_must_explicitly_accept_exact_action(tmp_path):
    store, docker, worker, leases = rig(tmp_path, authorize=lambda *args, **kwargs: None)
    with pytest.raises(RuntimeError):
        leases.acquire(SCOPE, REQUEST)
    assert docker.calls == []


def test_wake_preflight_retries_same_reservation_without_claiming_a_container_was_created(tmp_path):
    store, docker, worker, leases = rig(tmp_path)
    attempts = []
    def awake(allocation):
        attempts.append(allocation)
        assert allocation.state == 'reserved'
        return len(attempts) == 2
    leases.ensure_awake = awake
    with pytest.raises(RuntimeError, match='No workspace creation was sent'):
        leases.acquire(SCOPE, REQUEST)
    saved = leases.get(SCOPE, REQUEST.task_id)
    assert saved.state == 'reserved' and saved.resources_held and saved.lease is None
    assert docker.calls == []
    with pytest.raises(RuntimeError, match='Wake preflight'):
        leases.abandon_uncreated(SCOPE, REQUEST.task_id)
    lease = leases.acquire(SCOPE, REQUEST)
    assert attempts[0] == attempts[1]
    assert lease.workspace_id == saved.allocation_id and docker.count(['create']) == 1


def test_stopped_workspace_wake_retry_preserves_one_operation_and_saved_files(tmp_path):
    store, docker, worker, leases, lease, release = released(tmp_path)
    docker.process_state = 'idle'
    assert retire(leases, worker, release).state == 'stopped'
    calls = []
    def awake(allocation):
        calls.append(allocation)
        return len(calls) > 1
    leases.ensure_awake = awake
    with pytest.raises(RuntimeError, match='not verified awake'):
        leases.acquire(SCOPE, REQUEST)
    assert leases.get(SCOPE, REQUEST.task_id).state == 'stopped'
    assert leases.acquire(SCOPE, REQUEST) == lease
    assert calls[0] == calls[1] and calls[0].lease == lease
    assert docker.count(['create']) == 1 and docker.count(['start']) == 2


def test_native_release_only_records_hint_and_never_claims_or_observes_stop(tmp_path):
    store, docker, worker, leases = rig(tmp_path)
    lease = leases.acquire(SCOPE, REQUEST)
    calls = len(docker.calls)
    first = leases.release(SCOPE, lease)
    assert first.state == 'unknown'
    assert leases.release(SCOPE, lease) == first
    assert len(docker.calls) == calls and leases.get(SCOPE, REQUEST.task_id).resources_held
    assert leases.released()[0].release_id == first.operation_id
    with pytest.raises(ValueError):
        leases.release('wrong-profile', lease)
    with store._db() as db:
        assert not db.execute('SELECT * FROM claims').fetchall()


def test_release_cannot_race_allocation_acquire(tmp_path):
    store, docker, worker, leases = rig(tmp_path)
    lease = leases.acquire(SCOPE, REQUEST)
    with store._lock(lease.workspace_id) as acquired:
        assert acquired
        assert leases.release(SCOPE, lease).state == 'unknown'
    assert leases.get(SCOPE, REQUEST.task_id).release_id is None


@pytest.mark.parametrize('auto_remove', [True, None, 'false'])
def test_retirement_keeps_workspace_with_unverified_retention_running(tmp_path, auto_remove):
    _, docker, worker, leases, _, release = released(tmp_path)
    docker.process_state = 'idle'
    docker.container['HostConfig']['AutoRemove'] = auto_remove
    retire(leases, worker, release)
    assert docker.container['State']['Running']
    assert docker.count(['stop']) == 0 and leases.get(SCOPE, REQUEST.task_id).resources_held
