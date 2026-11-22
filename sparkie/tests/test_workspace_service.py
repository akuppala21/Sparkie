"""Native workspace broker wiring keeps caller identity out of model arguments."""
from dataclasses import asdict
from types import SimpleNamespace

import pytest

from sparkie_sparks.broker import dispatch_request
from sparkie_sparks.operations import OperationStore
from sparkie_sparks.workspace_service import ComputeService, RemoteWorkspaces, configured_provider
from sparkie_sparks.workspace_types import ComputeNode, WorkspaceLease, WorkspaceRequest
from sparkie_sparks.workspace_leases import WorkspaceObservation


def test_native_workspace_calls_are_separate_from_owner_confirmation():
    calls = []
    service = SimpleNamespace(configuration=lambda: {'available': True},
        acquire=lambda request, generation: calls.append(request) or {'workspace': 'fixed'},
        idle=lambda task_id, workspace_id: {'state': 'running'},
        release=lambda task_id, workspace_id: {'state': 'unknown'})
    request = {'method': 'workspace_acquire', 'owner': None,
               'params': {'request': {'task_id': 'native-task'}, 'generation': 'a' * 32}}
    assert dispatch_request(None, request, workspaces=service) == {'workspace': 'fixed'}
    assert calls == [{'task_id': 'native-task'}]
    with pytest.raises(ValueError):
        dispatch_request(None, request | {'owner': {'generation': 'forged', 'channel': 'web'}}, workspaces=service)
    with pytest.raises(ValueError):
        dispatch_request(None, request | {'params': {'request': {}, 'scope': 'other-owner'}}, workspaces=service)
    with pytest.raises(RuntimeError):
        dispatch_request(None, request)


def test_maintenance_is_only_an_explicit_private_controller_call():
    calls = []
    request = {'method': 'maintenance', 'owner': None, 'params': {}}
    assert dispatch_request(None, request, maintenance=lambda: calls.append('scan') or {'workspaces': []}) == {'workspaces': []}
    assert calls == ['scan']
    with pytest.raises(ValueError):
        dispatch_request(None, request | {'params': {'command': 'anything'}}, maintenance=lambda: calls.append('bad'))
    with pytest.raises(ValueError):
        dispatch_request(None, request | {'owner': {'generation': 'forged', 'channel': 'web'}}, maintenance=lambda: calls.append('bad'))
    assert calls == ['scan']


def test_missing_controller_registers_unavailable_provider_without_host_execution(monkeypatch):
    monkeypatch.delenv('SPARKIE_CONTROL_SOCKET', raising=False)
    provider = configured_provider()
    assert not provider.is_available()
    with pytest.raises(RuntimeError, match='No compute commands'):
        provider.create_environment(cwd='/workspace', timeout=10)


def test_fixed_scope_and_verified_nodes_are_exported_without_fleet_credentials(tmp_path):
    store = OperationStore(tmp_path / 'operations.sqlite')
    node = ComputeNode('spark4', '4' * 32, '100.64.0.4')
    image = 'sha256:' + 'a' * 64
    config = {'schema': 1, 'scope': 'native-main', 'controller': 'b' * 32,
        'hub_machine_id': '1' * 32, 'image': image, 'credentials_dir': str(tmp_path / 'private'),
        'nodes': [{'identity': asdict(node), 'budget': {'cpu': 2, 'memory_mb': 8192, 'disk_mb': 16384},
                   'user': 'owner', 'executable': '/fixed/worker.pyz', 'config': '/private/worker.json'}]}
    service = ComputeService(store, config)
    assert service.configuration() == {'nodes': [asdict(node)], 'hub_machine_id': '1' * 32, 'image': image,
                                       'release_queue': str(tmp_path / 'private/release-hints')}
    with pytest.raises(ValueError, match='exact saved'):
        service.idle('unknown-task', 'c' * 32, 'd' * 32)
    with pytest.raises(TypeError):
        service.acquire({'task_id': 'native', 'scope': 'other'}, 'd' * 32)


@pytest.fixture
def connected(tmp_path):
    store = OperationStore(tmp_path / 'operations.sqlite')
    node = ComputeNode('spark4', '4' * 32, '100.64.0.4')
    image = 'sha256:' + 'a' * 64
    config = {'schema': 1, 'scope': 'native-main', 'controller': 'b' * 32,
        'hub_machine_id': '1' * 32, 'image': image, 'credentials_dir': str(tmp_path / 'private'),
        'nodes': [{'identity': asdict(node), 'budget': {'cpu': 2, 'memory_mb': 8192, 'disk_mb': 16384},
                   'user': 'owner', 'executable': '/fixed/worker.pyz', 'config': '/private/worker.json'}]}
    effects = []
    class Worker:
        def __init__(self, *args, **kwargs): pass
        def provision(self, allocation): effects.append(('provision', allocation.allocation_id))
        def observe(self, allocation):
            lease = allocation.lease or WorkspaceLease(allocation.request, allocation.allocation_id,
                node.spark_id, node.machine_id, node.host, 2222, 'sandbox', 'c' * 64, image,
                '/private/key', '/private/known_hosts', 'sparkie-workspace-' + allocation.allocation_id,
                'ssh-ed25519 AAAAfixture')
            return WorkspaceObservation(allocation.allocation_id, 'ready', lease)
        def activity(self, allocation): return ['Background task remains.']
        idle_activity = activity
        def retire(self, *args): effects.append(('retire', None))
    service = ComputeService(store, config, transport_factory=Worker)
    remote = RemoteWorkspaces(str(tmp_path / 'broker.sock'))
    state = {'service': service, 'offline': False}
    def call(method, owner=None, **params):
        if state['offline']:
            raise RuntimeError('Synthetic controller outage')
        return dispatch_request(None, {'method': method, 'owner': None, 'params': params}, workspaces=state['service'])
    remote.remote._call = call
    request = WorkspaceRequest('native-task', image, 1, 4096, 8192, True)
    return SimpleNamespace(store=store, config=config, worker=Worker, service=service, remote=remote,
                           state=state, request=request, effects=effects)


def test_failed_cleanup_hint_survives_controller_restart_and_retries_without_stopping(connected):
    rig = connected
    lease = rig.remote.acquire(rig.request)
    rig.state['offline'] = True
    with pytest.raises(RuntimeError, match='outage'):
        rig.remote.release(lease)
    pending = list(rig.remote.release_hints.pending())
    assert pending == [{'task_id': lease.request.task_id, 'workspace_id': lease.workspace_id,
                        'generation': lease.connection_generation}]
    assert rig.service.leases.get(rig.service.scope, rig.request.task_id).release_id is None
    restarted = ComputeService(rig.store, rig.config, transport_factory=rig.worker)
    restarted.scan()
    allocation = restarted.leases.get(restarted.scope, rig.request.task_id)
    assert allocation.release_id and allocation.resources_held and allocation.state == 'ready'
    assert list(restarted.release_hints.pending()) == []
    assert rig.effects == [('provision', lease.workspace_id)]


def test_queued_old_cleanup_cannot_release_a_resumed_connection(connected):
    rig = connected
    first = rig.remote.acquire(rig.request)
    rig.state['offline'] = True
    with pytest.raises(RuntimeError): rig.remote.release(first)
    rig.state['offline'] = False
    second = rig.remote.acquire(rig.request)
    assert first == second  # Persistent workspace is retained.
    assert first.connection_generation != second.connection_generation
    rig.service.retry_releases()
    allocation = rig.service.leases.get(rig.service.scope, rig.request.task_id)
    assert allocation.release_id is None and allocation.resources_held
    assert list(rig.service.release_hints.pending()) == []
    rig.remote.idle(first)
    assert rig.service.leases.get(rig.service.scope, rig.request.task_id).release_id is None
    rig.remote.release(second)
    assert rig.service.leases.get(rig.service.scope, rig.request.task_id).release_id is not None
    assert rig.effects == [('provision', first.workspace_id)]


def test_cleanup_retry_during_reconnect_retains_hint_until_generation_can_be_checked(connected):
    rig = connected
    lease = rig.remote.acquire(rig.request)
    rig.state['offline'] = True
    with pytest.raises(RuntimeError): rig.remote.release(lease)
    with rig.service._connection_lock(rig.request.task_id) as locked:
        assert locked
        rig.service.retry_releases()
        assert list(rig.service.release_hints.pending())
        assert rig.service.leases.get(rig.service.scope, rig.request.task_id).release_id is None
    rig.service.retry_releases()
    assert list(rig.service.release_hints.pending()) == []
    assert rig.service.leases.get(rig.service.scope, rig.request.task_id).release_id is not None
