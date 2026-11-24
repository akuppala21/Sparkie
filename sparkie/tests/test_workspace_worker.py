"""Fixed worker policy and uncertain effects against a small fake Docker daemon."""
from copy import deepcopy
from dataclasses import replace
import json
from pathlib import Path
import socket
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from sparkie_sparks.operations import OperationStore
from sparkie_sparks.workspace_leases import ResourceBudget, WorkspaceLeases
from sparkie_sparks.workspace_types import ComputeNode, WorkspaceRequest
from sparkie_sparks.workspace_worker import DockerWorkspaceWorker, LABEL

IMAGE = 'sha256:' + 'a' * 64
NODE = ComputeNode('spark4', '4' * 32, '127.0.0.1')
REQUEST = WorkspaceRequest('native-task', IMAGE, 1, 1024, 4096, True)
SCOPE = 'fixture-runtime'


class Docker:
    def __init__(self):
        self.calls, self.environments, self.volumes = [], [], {}
        self.container, self.server, self.partial, self.lost_create = None, False, False, False
        self.capacity = {'cpu': 20, 'memory_mb': 64000, 'disk_mb': 1000000}
        self.process_state, self.lost_stop, self.apply_stop = 'busy', False, True

    def run(self, args, **kwargs):
        self.calls.append((args, kwargs.get('input')))
        self.environments.append(kwargs['env'])
        if args[0] == 'ssh-keygen':
            key = Path(args[-1])
            key.write_text('synthetic-private-key')
            key.chmod(0o600)
            key.with_suffix('.pub').write_text('ssh-ed25519 AAAAFixture fixture\n')
            return SimpleNamespace(returncode=0, stdout='', stderr='')
        if args[0] == 'ssh':
            return SimpleNamespace(returncode=0, stdout='12001\n', stderr='')
        assert args[:2] == ['docker', '--config'] and args[3:5] == ['--host', 'unix:///var/run/docker.sock']
        assert json.loads((Path(args[2]) / 'config.json').read_text()) == {}
        command = args[5:]
        result = ''
        if command[:2] == ['image', 'inspect']:
            result = json.dumps([{'Id': IMAGE, 'Config': {'User': 'sandbox', 'Env': ['HOME=/home/sandbox']}}])
        elif command == ['info', '--format', '{{.Name}}']:
            result = socket.gethostname()
        elif command[0] == 'ps':
            result = self.container['Id'] if self.container else ''
        elif command[:2] == ['volume', 'ls']:
            selector = command[-1]
            if selector.startswith('name=^'):
                name = selector[6:-1]
                result = name if name in self.volumes else ''
            else:
                result = '\n'.join(self.volumes)
        elif command[:2] == ['volume', 'create']:
            labels = dict(command[index + 1].split('=', 1) for index, value in enumerate(command) if value == '--label')
            name = command[-1]
            self.volumes[name] = {'Name': name, 'Driver': 'local', 'Options': None, 'Labels': labels}
            if self.partial:
                raise TimeoutError('First volume exists, acknowledgement was lost')
            result = name
        elif command[:2] == ['volume', 'inspect']:
            result = json.dumps([self.volumes[command[-1]]])
        elif command[0] == 'create':
            labels = dict(command[index + 1].split('=', 1) for index, value in enumerate(command) if value == '--label')
            name = command[command.index('--name') + 1]
            port = command[command.index('-p') + 1].split(':')[1]
            endpoint = command[command.index('-p') + 1].split(':')[0]
            self.container = {'Id': 'c' * 64, 'Name': '/' + name, 'Image': IMAGE,
                'Config': {'User': 'sandbox', 'WorkingDir': '/workspace', 'Cmd': ['sleep', 'infinity'], 'Entrypoint': None,
                           'Labels': labels, 'Env': ['HOME=/home/sandbox']},
                'HostConfig': {'Mounts': [{'Type':'volume','Source':name+'-workspace','Target':'/opt/sparkie','VolumeOptions':{'NoCopy':True}}], 'Privileged': False, 'ReadonlyRootfs': True, 'NetworkMode': 'bridge', 'CapDrop': ['ALL'],
                    'CapAdd': None, 'SecurityOpt': ['no-new-privileges'], 'Memory': REQUEST.memory_mb * 1024**2,
                    'MemorySwap': REQUEST.memory_mb * 1024**2, 'NanoCpus': 1000000000, 'PidsLimit': 128,
                    'Binds': None, 'Devices': [], 'DeviceRequests': None,
                    'PortBindings': {'2222/tcp': [{'HostIp': endpoint, 'HostPort': port}]}},
                'Mounts': [{'Type': 'volume', 'Name': name + '-home', 'Destination': '/home/sandbox', 'RW': True},
                           {'Type': 'volume', 'Name': name + '-workspace', 'Destination': '/workspace', 'RW': True},
                           {'Type': 'volume', 'Name': name + '-workspace', 'Destination': '/opt/sparkie', 'RW': True}],
                'State': {'Running': False, 'Status': 'created', 'Dead': False, 'Paused': False, 'Restarting': False}}
            if self.lost_create:
                raise TimeoutError('Container exists, acknowledgement was lost')
            result = self.container['Id']
        elif command[0] == 'inspect':
            result = json.dumps([self.container])
        elif command[0] == 'start':
            self.container['State'].update(Running=True, Status='running')
            self.server = False
        elif command[0] == 'stop':
            if self.apply_stop:
                self.container['State'].update(Running=False, Status='exited')
                self.server = False
            if self.lost_stop:
                raise TimeoutError('The stop reply was lost')
        elif command[0] == 'exec' and command[2:5] == ['python3', '-I', '-c']:
            result = json.dumps({'state': self.process_state})
        elif command[:2] == ['exec', '-d']:
            self.server = True
        else:
            assert command[0] == 'exec', command
        return SimpleNamespace(returncode=0, stdout=result, stderr='')

    def count(self, command):
        return sum(args[0] == 'docker' and args[5:5 + len(command)] == list(command) for args, _ in self.calls)


def rig(tmp_path, *, identity=lambda: NODE.machine_id, node=NODE, **options):
    store, docker = OperationStore(tmp_path / 'operations.sqlite'), Docker()
    worker = DockerWorkspaceWorker(store, node=node, hub_machine_id='1' * 32, image_id=IMAGE,
        state_dir=tmp_path / 'private', runner=docker.run, identity=identity, capacity=lambda: docker.capacity,
        ready=lambda lease: docker.server, ready_wait=0, **options)
    manager = WorkspaceLeases(store, nodes=[node], hub_machine_id='1' * 32, image=IMAGE,
        budgets={'spark4': ResourceBudget(2, 8192, 100000)}, provision=worker.provision,
        observe=worker.observe, activity=worker.activity)
    return store, docker, worker, manager


def test_recipe_is_fixed_local_nonroot_and_sandbox_keys_never_enter_arguments_or_mounts(tmp_path, monkeypatch):
    monkeypatch.setenv('DOCKER_HOST', 'ssh://owner@hub')
    monkeypatch.setenv('DOCKER_CONTEXT', 'unrelated')
    monkeypatch.setenv('DOCKER_CONFIG', str(tmp_path / 'host-docker-config'))
    ambient = tmp_path / 'host-docker-config'
    ambient.mkdir()
    (ambient / 'config.json').write_text(json.dumps({'proxies': {'default': {'httpProxy': 'https://owner:synthetic-secret@proxy'}}}))
    _, docker, worker, manager = rig(tmp_path)
    lease = manager.acquire(SCOPE, REQUEST)
    assert lease.user == 'sandbox' and lease.host == '127.0.0.1'
    assert docker.count(['create']) == docker.count(['start']) == 1
    create = next(args for args, _ in docker.calls if args[0] == 'docker' and args[5] == 'create')
    assert '--privileged' not in create and '--device' not in create and '--env' not in create and '--rm' not in create
    assert '--read-only' in create and '--cap-drop' in create and '--security-opt' in create
    assert any(v.endswith(',dst=/opt/sparkie,volume-nocopy') for v in create)
    assert all(value.startswith('type=volume,src=sparkie-ws-') for index, value in enumerate(create) if create[index - 1] == '--mount')
    assert all('synthetic-private-key' not in ' '.join(args) for args, _ in docker.calls)
    assert any(value == 'synthetic-private-key' for _, value in docker.calls)
    assert all(not any(key.startswith('DOCKER_') for key in env) for env in docker.environments)
    assert all('synthetic-secret' not in ' '.join(args) for args, _ in docker.calls)
    assert docker.container['Config']['Env'] == ['HOME=/home/sandbox']
    assert worker._ready(lease)
    ssh = docker.calls[-1][0]
    assert 'StrictHostKeyChecking=yes' in ssh and 'IdentityAgent=none' in ssh and 'ControlPath=none' in ssh
    assert manager.acquire(SCOPE, REQUEST) == lease and docker.count(['create']) == 1


def test_wrong_physical_machine_never_touches_docker_or_keys(tmp_path):
    _, docker, _, manager = rig(tmp_path, identity=lambda: '1' * 32)
    with pytest.raises(RuntimeError, match='not verified ready'):
        manager.acquire(SCOPE, REQUEST)
    assert docker.calls == []


@pytest.mark.parametrize('change', [{'cpu': .5}, {'memory_mb': 1024}, {'disk_mb': 4096}, {'cpu': float('nan')}])
def test_capacity_refusal_before_effects_has_exact_never_created_proof(tmp_path, change):
    _, docker, worker, manager = rig(tmp_path)
    docker.capacity.update(change)
    with pytest.raises(RuntimeError, match='not verified ready'):
        manager.acquire(SCOPE, REQUEST)
    allocation = manager.get(SCOPE, REQUEST.task_id)
    proof = worker.observe(allocation)
    assert proof.state == 'never_created' and proof.operation_id == allocation.operation_id
    assert docker.count(['volume', 'create']) == docker.count(['create']) == 0
    assert manager.abandon_uncreated(SCOPE, REQUEST.task_id).state == 'uncreated'


def test_partial_volume_creation_stays_unknown_and_never_retries_or_deletes(tmp_path):
    _, docker, worker, manager = rig(tmp_path)
    docker.partial = True
    for _ in range(2):
        with pytest.raises(RuntimeError, match='not verified ready'):
            manager.acquire(SCOPE, REQUEST)
    allocation = manager.get(SCOPE, REQUEST.task_id)
    assert worker.observe(allocation).state == 'unknown'
    with pytest.raises(RuntimeError, match='not been proved'):
        manager.abandon_uncreated(SCOPE, REQUEST.task_id)
    assert docker.count(['volume', 'create']) == 1 and docker.count(['create']) == 0
    assert len(docker.volumes) == 1 and allocation.resources_held
    assert not any('rm' in args for args, _ in docker.calls)


def test_lost_create_reply_is_observed_stopped_then_resumes_same_container_and_keys(tmp_path):
    _, docker, worker, manager = rig(tmp_path)
    docker.lost_create = True
    with pytest.raises(RuntimeError, match='not verified ready'):
        manager.acquire(SCOPE, REQUEST)
    saved = manager.get(SCOPE, REQUEST.task_id)
    assert saved.state == 'stopped' and saved.lease.container_id == 'c' * 64
    lease = manager.acquire(SCOPE, REQUEST)
    assert lease == saved.lease
    assert docker.count(['create']) == docker.count(['start']) == 1
    assert docker.count(['volume', 'create']) == 2


def test_running_work_stays_protected_and_observed_stop_can_resume_without_recreation(tmp_path):
    _, docker, worker, manager = rig(tmp_path)
    first = manager.acquire(SCOPE, REQUEST)
    assert manager.idle(SCOPE, first).state == 'running'
    assert manager.get(SCOPE, REQUEST.task_id).resources_held
    docker.container['State'].update(Running=False, Status='exited')
    docker.server = False
    assert manager.idle(SCOPE, first).state == 'stopped'
    assert manager.reservations()['spark4'] == ResourceBudget(0, 0, REQUEST.disk_mb)
    assert manager.acquire(SCOPE, REQUEST) == first
    assert docker.count(['create']) == 1 and docker.count(['start']) == 2


@pytest.mark.parametrize('section,key,value', [
    ('HostConfig', 'Mounts', []), ('HostConfig', 'Privileged', True), ('HostConfig', 'Memory', 0), ('HostConfig', 'NetworkMode', 'host'),
    ('HostConfig', 'Binds', ['/var/run/docker.sock:/var/run/docker.sock']), ('Config', 'User', 'root'),
    ('Config', 'Env', ['HOME=/home/sandbox', 'HTTP_PROXY=https://owner:synthetic-secret@proxy']),
    ('HostConfig', 'PortBindings', {'2222/tcp': [{'HostIp': '0.0.0.0', 'HostPort': '2222'}]}),
])
def test_changed_runtime_cannot_be_reconnected_or_released(tmp_path, section, key, value):
    _, docker, worker, manager = rig(tmp_path)
    lease = manager.acquire(SCOPE, REQUEST)
    docker.container[section][key] = value
    with pytest.raises(RuntimeError, match='not verified ready'):
        manager.acquire(SCOPE, REQUEST)
    assert manager.idle(SCOPE, lease).state == 'unknown'
    assert manager.get(SCOPE, REQUEST.task_id).resources_held
    assert docker.count(['create']) == 1


def test_wrong_volume_identity_and_host_backing_are_not_adopted(tmp_path):
    _, docker, worker, manager = rig(tmp_path)
    lease = manager.acquire(SCOPE, REQUEST)
    original = deepcopy(docker.volumes)
    for mutation in ('labels', 'options'):
        docker.volumes = deepcopy(original)
        volume = next(iter(docker.volumes.values()))
        if mutation == 'labels':
            volume['Labels'][LABEL] = 'f' * 32
        else:
            volume['Options'] = {'device': '/home/owner', 'o': 'bind'}
        assert worker.observe(manager.get(SCOPE, REQUEST.task_id)).state == 'unknown'
    assert len(docker.volumes) == 2 and manager.get(SCOPE, REQUEST.task_id).lease == lease


def test_ssh_readiness_failure_cannot_claim_ready_or_repeat_container_creation(tmp_path):
    _, docker, worker, manager = rig(tmp_path)
    worker.ready = lambda lease: False
    for _ in range(2):
        with pytest.raises(RuntimeError, match='not verified ready'):
            manager.acquire(SCOPE, REQUEST)
    assert docker.count(['create']) == docker.count(['start']) == 1
    assert manager.get(SCOPE, REQUEST.task_id).resources_held


def test_worker_refuses_unrecorded_or_changed_dispatch_before_any_effect(tmp_path):
    store, docker, worker, manager = rig(tmp_path)
    allocation = manager._reserve(SCOPE, REQUEST)
    with pytest.raises(ValueError, match='active recorded dispatch'):
        worker.provision(allocation)
    with pytest.raises(ValueError, match='exact current'):
        worker.provision(replace(allocation, operation_id='f' * 32))
    assert docker.calls == []


def test_changed_private_docker_config_refuses_commands_and_never_uses_host_defaults(tmp_path):
    _, docker, worker, manager = rig(tmp_path)
    (worker.docker_config / 'config.json').write_text(json.dumps({'proxies': {'default': {'httpProxy': 'synthetic-private-proxy'}}}))
    with pytest.raises(RuntimeError, match='not verified ready'):
        manager.acquire(SCOPE, REQUEST)
    assert docker.count(['create']) == docker.count(['volume', 'create']) == 0


@pytest.mark.parametrize(('address', 'interface'), [
    ('10.42.1.5', None), ('100.111.1.5', None), ('192.168.3.5', 'lo'),
    ('192.168.3.5', '-all'), ('192.168.3.5', '../wlan0'), ('8.8.8.8', 'eth0'),
])
def test_worker_requires_an_explicit_enrolled_lan_interface(tmp_path, address, interface):
    with pytest.raises(ValueError, match='interface|private IPv4'):
        rig(tmp_path, node=replace(NODE, host=address), interface=interface)
    assert not (tmp_path / 'private').exists()


@pytest.mark.parametrize(('name', 'address', 'state', 'available'), [
    ('enp2s0', '192.168.8.21', 'UP', True),
    ('enp2s0', '192.168.8.20', 'UP', False),
    ('wlan0', '192.168.8.21', 'UP', False),
    ('enp2s0', '192.168.8.21', 'DOWN', False),
])
def test_lan_binding_requires_the_exact_active_address_and_interface(tmp_path, monkeypatch, name, address, state, available):
    node = replace(NODE, host='192.168.8.21')
    _, docker, worker, leases = rig(tmp_path, node=node, interface='enp2s0')
    def run(args, **kwargs):
        if args[0] == 'ip':
            assert args == ['ip', '-j', '-4', 'address', 'show', 'dev', 'enp2s0']
            link = {'ifname': name, 'operstate': state, 'flags': ['UP', 'LOWER_UP'],
                    'addr_info': [{'family': 'inet', 'scope': 'global', 'local': address, 'prefixlen': 24}]}
            return SimpleNamespace(returncode=0, stdout=json.dumps([link]), stderr='')
        return docker.run(args, **kwargs)
    worker.runner = run
    if available:
        reservation = MagicMock()
        reservation.__enter__.return_value = reservation
        reservation.getsockname.return_value = (node.host, 34123)
        monkeypatch.setattr(socket, 'socket', lambda: reservation)
        lease = leases.acquire(SCOPE, REQUEST)
        reservation.bind.assert_called_once_with((node.host, 0))
        assert lease.host == node.host
        assert docker.container['HostConfig']['PortBindings']['2222/tcp'] == [
            {'HostIp': node.host, 'HostPort': str(lease.port)}]
    else:
        with pytest.raises(RuntimeError, match='not verified ready'):
            leases.acquire(SCOPE, REQUEST)
        assert docker.calls == []
