"""Private remote request fencing, credential boundaries and lost replies."""
from dataclasses import asdict, replace
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace

import pytest

from sparkie_sparks.operations import NotDispatched, OperationStore
from sparkie_sparks.workspace_leases import Allocation, WorkspaceObservation
from sparkie_sparks.workspace_remote import RemoteWorkspaceWorker, WorkerEndpoint
from sparkie_sparks.workspace_types import ComputeNode, WorkspaceLease, WorkspaceRequest

NODE = ComputeNode('spark4', '4' * 32, '100.64.0.4')
IMAGE = 'sha256:' + 'd' * 64
REQUEST = WorkspaceRequest('native:task', IMAGE, 1, 4096, 8192, True)
ALLOCATION = Allocation('a' * 32, 'main-runtime', REQUEST, NODE, 'dispatching', 'a' * 32, None, None, True)
HOST_KEY = 'ssh-ed25519 AAAAfixture'
PRIVATE_KEY = 'synthetic-sandbox-only-private-key'


@pytest.fixture
def rig(tmp_path):
    calls = []
    config = {'schema': 1, 'controller': 'b' * 32, 'node': asdict(NODE),
              'hub_machine_id': '1' * 32, 'image_id': IMAGE, 'state_dir': str(tmp_path / 'worker'),
              'maximum': {'cpu': 4, 'memory_mb': 8192, 'disk_mb': 16384}}

    class Worker:
        def __init__(self, store, *, authorize, **kwargs):
            self.authorize = authorize
            self.root = Path(kwargs['state_dir'])

        def provision(self, allocation):
            assert self.authorize(allocation, dispatch=True)
            assert not self.authorize(replace(allocation, scope='other'), dispatch=True)
            calls.append(('provision', allocation))

        def observe(self, allocation):
            assert self.authorize(allocation)
            path = self.root / allocation.allocation_id
            lease = WorkspaceLease(allocation.request, allocation.allocation_id,
                NODE.spark_id, NODE.machine_id, NODE.host, 32401, 'sandbox', 'c' * 64, IMAGE,
                str(path / 'client'), str(path / 'known_hosts'),
                'sparkie-workspace-' + allocation.allocation_id, HOST_KEY)
            return WorkspaceObservation(allocation.allocation_id, 'ready', lease)

        def export_credentials(self, allocation):
            lease = self.observe(allocation).lease
            return {'private_key': PRIVATE_KEY, 'known_hosts': lease.host_key_alias + ' ' + HOST_KEY + '\n'}

        def activity(self, allocation):
            assert self.authorize(allocation)
            return ['A detached job remains.']

        idle_activity = activity

        def retire(self, allocation, receipt):
            assert self.authorize(allocation, retirement=receipt)
            assert not self.authorize(allocation, retirement='f' * 32)
            calls.append(('retire', receipt))

    endpoint = WorkerEndpoint(config, factory=Worker)
    store = OperationStore(tmp_path / 'controller.sqlite')
    def runner(args, *, input, **kwargs):
        assert args[0] == 'ssh' and 'StrictHostKeyChecking=yes' in args
        assert 'ForwardAgent=no' in args and kwargs['timeout'] == 55
        assert PRIVATE_KEY not in input and PRIVATE_KEY not in ' '.join(args)
        result = endpoint.handle(json.loads(input))
        return SimpleNamespace(returncode=0, stdout=json.dumps(result), stderr='')
    remote = RemoteWorkspaceWorker(store, node=NODE, user='owner', executable='/fixed/worker.pyz',
        config_path='/fixed/worker.json', controller_id=config['controller'],
        credentials_dir=str(tmp_path / 'gateway-keys'), runner=runner)
    def request(sequence, *, method='provision', allocation=ALLOCATION, retirement=None):
        return {'schema': 1, 'controller': config['controller'], 'sequence': sequence,
                'method': method, 'allocation': asdict(allocation), 'retirement': retirement}
    return SimpleNamespace(endpoint=endpoint, worker=Worker, remote=remote, runner=runner,
                           request=request, calls=calls, config=config)


def test_remote_request_is_durable_before_effect_and_replay_is_refused(rig):
    rig.endpoint.handle(rig.request(1))
    receipt = Path(rig.config['state_dir']) / 'requests' / (ALLOCATION.allocation_id + '.json')
    assert json.loads(receipt.read_text())['sequence'] == 1
    for sequence in (1, 0):
        with pytest.raises(ValueError):
            rig.endpoint.handle(rig.request(sequence))
    assert len(rig.calls) == 1


def test_later_observation_fences_a_delayed_old_mutation(rig):
    rig.endpoint.handle(rig.request(2, method='observe'))
    with pytest.raises(ValueError, match='stale'):
        rig.endpoint.handle(rig.request(1))
    assert rig.calls == []


@pytest.mark.parametrize('change', [
    {'scope': 'different-runtime'},
    {'request': replace(REQUEST, cpu=2)},
])
def test_allocation_identity_cannot_change_with_a_new_sequence(rig, change):
    rig.endpoint.handle(rig.request(1, method='observe'))
    with pytest.raises(ValueError, match='changed'):
        rig.endpoint.handle(rig.request(2, allocation=replace(ALLOCATION, **change)))
    assert rig.calls == []


@pytest.mark.parametrize('change', [
    {'node': ComputeNode('spark1', '1' * 32, NODE.host)},
    {'request': replace(REQUEST, cpu=100)},
    {'request': replace(REQUEST, image='sha256:' + 'e' * 64)},
    {'request': replace(REQUEST, memory_mb=True)},
    {'request': replace(REQUEST, cpu=float('inf'))},
    {'state': 'ready'},
    {'resources_held': False},
])
def test_remote_effect_requires_exact_machine_image_limits_and_dispatch(rig, change):
    with pytest.raises(ValueError):
        rig.endpoint.handle(rig.request(1, allocation=replace(ALLOCATION, **change)))
    assert rig.calls == []


def test_unrelated_controller_and_extra_request_fields_are_refused(rig):
    for request in (rig.request(1) | {'controller': 'f' * 32}, rig.request(1) | {'command': 'arbitrary'}):
        with pytest.raises(ValueError):
            rig.endpoint.handle(request)
    assert rig.calls == []


def test_only_the_sandbox_key_is_enrolled_at_a_fixed_private_gateway_path(rig):
    result = rig.remote.observe(ALLOCATION)
    lease = result.lease
    assert result.state == 'ready' and lease.host == NODE.host
    assert Path(lease.key_path).read_text() == PRIVATE_KEY
    assert Path(lease.key_path).stat().st_mode & 0o077 == 0
    assert Path(lease.key_path).parent == rig.remote.root / ALLOCATION.allocation_id
    assert Path(lease.known_hosts).read_text().strip() == lease.host_key_alias + ' ' + HOST_KEY
    assert PRIVATE_KEY not in repr(lease)
    incoming = replace(ALLOCATION, state='ready', lease=replace(lease, key_path='/etc/shadow', known_hosts='/etc/passwd'))
    # Caller paths are replaced from trusted local worker configuration and never read.
    assert rig.remote.observe(incoming).lease == lease


def test_changed_sandbox_key_is_not_silently_overwritten(rig):
    lease = rig.remote.observe(ALLOCATION).lease
    Path(lease.key_path).write_text('previously-enrolled-key')
    with pytest.raises(RuntimeError, match='No key was replaced'):
        rig.remote.observe(ALLOCATION)
    assert Path(lease.key_path).read_text() == 'previously-enrolled-key'


def test_lost_reply_is_reconciled_without_another_provision(rig):
    def lost(args, **kwargs):
        rig.runner(args, **kwargs)
        raise subprocess.TimeoutExpired(args, 55, output=PRIVATE_KEY)
    rig.remote.runner = lost
    with pytest.raises(RuntimeError) as error:
        rig.remote.provision(ALLOCATION)
    assert PRIVATE_KEY not in str(error.value)
    rig.remote.runner = rig.runner
    assert rig.remote.observe(ALLOCATION).state == 'ready'
    assert len(rig.calls) == 1


def test_remote_activity_and_exact_retirement_receipt(rig):
    assert rig.remote.activity(ALLOCATION) == ['A detached job remains.']
    assert rig.remote.idle_activity(ALLOCATION) == ['A detached job remains.']
    rig.remote.retire(ALLOCATION, 'e' * 32)
    assert rig.calls == [('retire', 'e' * 32)]


def test_proved_refusal_is_distinct_from_unknown_transport_failure(rig, monkeypatch):
    def refused(self, allocation, receipt):
        raise NotDispatched('synthetic-private-detail')
    monkeypatch.setattr(rig.worker, 'retire', refused)
    with pytest.raises(NotDispatched) as error:
        rig.remote.retire(ALLOCATION, 'e' * 32)
    assert 'synthetic-private-detail' not in str(error.value)


def test_worker_stderr_and_malformed_replies_do_not_reach_model_errors(rig):
    rig.remote.runner = lambda *args, **kwargs: SimpleNamespace(returncode=1, stdout=PRIVATE_KEY, stderr=PRIVATE_KEY)
    with pytest.raises(RuntimeError) as error:
        rig.remote.observe(ALLOCATION)
    assert PRIVATE_KEY not in str(error.value)
