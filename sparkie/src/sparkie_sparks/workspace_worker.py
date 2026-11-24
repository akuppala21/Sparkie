"""Fixed local Docker workspace provisioner; production routing is disconnected.

Runs only on its physically verified compute Spark. The sole published endpoint
is loopback or an enrolled private LAN address into a non-root container. There is no owner shell/exec RPC,
arbitrary Docker configuration, host mount, deletion, power or privilege setup.
"""
from contextlib import contextmanager
from dataclasses import asdict
import fcntl
import hashlib
from ipaddress import IPv4Interface
import json
import math
import os
from pathlib import Path
import re
import shutil
import socket
import stat
import subprocess
import time

from .workspace_leases import Allocation, WorkspaceLeases, WorkspaceObservation
from .operations import NotDispatched
from .worker_network import worker_interface
from .workspace_types import ComputeNode, WorkspaceLease

LABEL = 'sparkie.workspace'
IDLE_PROBE = r'''
import json, os, pathlib, re
try:
    own = os.getpid()
    entries = [p for p in pathlib.Path('/proc').iterdir() if p.name.isdecimal()]
    if len(entries) > 256:
        raise ValueError('process limit')
    sleep = listener = 0
    busy = False
    for p in entries:
        pid = int(p.name)
        if pid == own:
            continue
        status = (p / 'status').read_text()
        if re.search(r'^State:\s+Z\b', status, re.M):
            continue
        exe = str((p / 'exe').resolve(strict=True))
        argv = (p / 'cmdline').read_bytes().rstrip(b'\0').replace(b'\0', b' ').decode('utf-8')
        if pid == 1 and exe in ('/usr/bin/sleep', '/bin/sleep') and argv == 'sleep infinity':
            sleep += 1
        elif exe == '/usr/sbin/sshd' and re.fullmatch(
                r'sshd: /usr/sbin/sshd -D -e -E /tmp/sshd.log -f /run/ssh/sshd_config \[listener\] 0 of \d+-\d+ startups', argv):
            listener += 1
        else:
            busy = True
    print(json.dumps({'state': 'idle' if sleep == listener == 1 and not busy else 'busy'}))
except Exception:
    print(json.dumps({'state': 'unknown'}))
'''
SSHD = ('Port 2222\nListenAddress 0.0.0.0\nHostKey /run/ssh/host_key\n'
        'AuthorizedKeysFile /run/ssh/authorized_keys\nPidFile /run/ssh/sshd.pid\n'
        'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPubkeyAuthentication yes\n'
        'AuthenticationMethods publickey\nPermitRootLogin no\nUsePAM no\nAllowUsers sandbox\n'
        'AllowTcpForwarding no\nAllowAgentForwarding no\nX11Forwarding no\nPermitTunnel no\n'
        'PermitUserEnvironment no\nStrictModes yes\nSubsystem sftp internal-sftp\n')


def machine_identity():
    return Path('/etc/machine-id').read_text().strip()


def _private_dir(path):
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
        raise ValueError('Use an owner-only workspace state directory.')


def _read(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077 or info.st_size > 32768:
            raise ValueError('Workspace identity files must be small and owner-only.')
        return stream.read(32769)


def _write(path, text):
    temp = path.with_suffix(path.suffix + '.tmp')
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(text)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


class DockerWorkspaceWorker:
    """Provision/observe callbacks for one local compute node and pinned image.

    The lease database supplies admission reservations; fresh host checks add a
    system memory/disk reserve. Disk is reserved, not claimed to be a Docker
    quota. Saved volumes and identity files are never deleted by this worker.
    """

    def __init__(self, store, *, node, hub_machine_id, image_id, state_dir,
                 runner=subprocess.run, identity=machine_identity, capacity=None,
                 ready=None, local_addresses=None, interface=None, authorize=None,
                 memory_reserve_mb=8192, disk_reserve_mb=8192, ready_wait=8):
        if (not isinstance(node, ComputeNode) or node.spark_id not in ('spark2', 'spark3', 'spark4')
                or not re.fullmatch('[a-f0-9]{32}', node.machine_id)
                or not isinstance(hub_machine_id, str) or not re.fullmatch('[a-f0-9]{32}', hub_machine_id)
                or node.machine_id == hub_machine_id
                or not isinstance(image_id, str) or not re.fullmatch('sha256:[a-f0-9]{64}', image_id)):
            raise ValueError('Use one verified local compute identity and exact sandbox image ID.')
        if (type(memory_reserve_mb) is not int or memory_reserve_mb < 0
                or type(disk_reserve_mb) is not int or disk_reserve_mb < 0
                or type(ready_wait) not in (int, float) or not 0 <= ready_wait <= 30):
            raise ValueError('Use bounded trusted resource reserves and readiness time.')
        self.interface = worker_interface(node.host, interface)
        self.store, self.node, self.hub_machine_id, self.image_id = store, node, hub_machine_id, image_id
        self.root = Path(state_dir)
        if not self.root.is_absolute():
            raise ValueError('Use an absolute private workspace state directory.')
        _private_dir(self.root)
        self.docker_config = self.root / 'docker-client'
        _private_dir(self.docker_config)
        configuration = self.docker_config / 'config.json'
        if not configuration.exists():
            _write(configuration, '{}\n')
        if json.loads(_read(configuration)) != {}:
            raise ValueError('The workspace Docker client must have an empty private configuration.')
        self.runner, self.identity = runner, identity
        if authorize is not None and not callable(authorize):
            raise ValueError('Workspace authorization must be a trusted execution-boundary callback.')
        self.authorize = authorize
        self.local_addresses = local_addresses or self._local_addresses
        self.capacity, self.ready = capacity or self._capacity, ready or self._ready
        self.memory_reserve_mb, self.disk_reserve_mb, self.ready_wait = memory_reserve_mb, disk_reserve_mb, ready_wait

    def _run(self, args, *, input=None, timeout=30):
        environment = {key: value for key, value in os.environ.items() if not key.startswith('DOCKER_')}
        result = self.runner(args, input=input, capture_output=True, text=True, timeout=timeout, check=False, env=environment)
        if result.returncode or len(result.stdout) > 1048576:
            raise RuntimeError('The fixed workspace command did not return a verified result.')
        return result.stdout

    def _docker(self, *args, **kwargs):
        if json.loads(_read(self.docker_config / 'config.json')) != {}:
            raise RuntimeError('The private Docker client configuration changed.')
        return self._run(['docker', '--config', str(self.docker_config), '--host', 'unix:///var/run/docker.sock', *args], **kwargs)

    def _local_addresses(self):
        data = json.loads(self._run(['ip', '-j', '-4', 'address', 'show', 'dev', self.interface], timeout=5))
        if not isinstance(data, list) or len(data) != 1 or not isinstance(data[0], dict):
            raise RuntimeError('The enrolled LAN interface is unavailable.')
        link = data[0]
        flags = link.get('flags', [])
        if (link.get('ifname') != self.interface or 'UP' not in flags or 'LOOPBACK' in flags
                or link.get('operstate') not in ('UP', 'UNKNOWN')):
            raise RuntimeError('The enrolled LAN interface is unavailable.')
        addresses = set()
        for item in link.get('addr_info', []):
            if (item.get('family') != 'inet' or item.get('scope') != 'global'
                    or item.get('tentative') or item.get('dadfailed') or item.get('deprecated')):
                continue
            local = IPv4Interface((item['local'], item['prefixlen']))
            if local.network.prefixlen < 31 and local.ip in (local.network.network_address, local.network.broadcast_address):
                continue
            addresses.add(str(local.ip))
        return addresses

    def _verify(self, allocation, *, dispatch=False, retirement=None):
        if (not isinstance(allocation, Allocation) or allocation.node != self.node
                or not re.fullmatch('[a-f0-9]{32}', allocation.allocation_id)
                or allocation.request.image != self.image_id or self.identity() != self.node.machine_id):
            raise ValueError('This worker cannot use that physical Spark or allocation.')
        if self.node.host != '127.0.0.1' and self.node.host not in self.local_addresses():
            raise ValueError('The enrolled sandbox endpoint is not assigned to this Spark.')
        if self.authorize is not None:
            if self.authorize(allocation, dispatch=dispatch, retirement=retirement) is not True:
                raise ValueError('The private controller did not authorize this exact workspace request.')
            return
        with self.store._db() as db:
            row = db.execute('SELECT * FROM workspace_leases WHERE allocation_id=?', (allocation.allocation_id,)).fetchone()
            current = WorkspaceLeases._decode(row) if row else None
            if current != allocation:
                raise ValueError('Use the exact current durable workspace allocation.')
            if dispatch:
                claim = db.execute('SELECT operation FROM claims WHERE spark=?', (self.node.spark_id,)).fetchone()
                if allocation.state != 'dispatching' or claim is None or claim[0] != allocation.operation_id:
                    raise ValueError('The workspace has no active recorded dispatch and Spark claim.')
            if retirement is not None:
                receipt = db.execute('SELECT * FROM workspace_retirements WHERE id=?', (retirement,)).fetchone()
                claim = db.execute('SELECT operation FROM claims WHERE spark=?', (self.node.spark_id,)).fetchone()
                if (receipt is None or receipt['allocation_id'] != allocation.allocation_id
                        or receipt['release_id'] != allocation.release_id or receipt['state'] != 'dispatching'
                        or not allocation.release_id or claim is None or claim[0] != retirement):
                    raise ValueError('The workspace has no exact recorded retirement and Spark claim.')

    @contextmanager
    def _lock(self, allocation):
        fd = os.open(self.root / (allocation.allocation_id + '.lock'), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            yield
        finally:
            os.close(fd)

    def _paths(self, allocation):
        folder = self.root / allocation.allocation_id
        name = 'sparkie-ws-' + allocation.allocation_id
        return folder, name, (name + '-home', name + '-workspace')

    def _labels(self, allocation):
        spec = json.dumps({'scope': allocation.scope, 'request': asdict(allocation.request), 'node': asdict(allocation.node)},
                          sort_keys=True, separators=(',', ':'))
        return {LABEL: allocation.allocation_id, 'sparkie.machine': self.node.machine_id,
                'sparkie.spec': hashlib.sha256(spec.encode()).hexdigest()}

    def _journal(self, allocation):
        folder, _, _ = self._paths(allocation)
        info = folder.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
            raise ValueError('The workspace enrollment directory is not private.')
        record = json.loads(_read(folder / 'record.json'))
        if (not isinstance(record, dict) or record.get('schema') != 1 or record.get('labels') != self._labels(allocation)
                or type(record.get('port')) is not int or not 1024 <= record['port'] <= 65535
                or record.get('phase') not in ('prepared', 'effects_possible', 'finished', 'never_created')
                or not isinstance(record.get('host_key'), str)
                or not re.fullmatch(r'ssh-ed25519 [A-Za-z0-9+/]+={0,2}', record['host_key'])):
            raise ValueError('The saved workspace enrollment is incomplete or changed.')
        return record

    def _save(self, allocation, record):
        folder, _, _ = self._paths(allocation)
        _write(folder / 'record.json', json.dumps(record, sort_keys=True) + '\n')

    def _enroll(self, allocation):
        folder, _, _ = self._paths(allocation)
        if folder.exists():
            return self._journal(allocation)
        _private_dir(folder)
        for name in ('client', 'host'):
            self._run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-C', 'sparkie-sandbox-only', '-f', str(folder / name)])
            (folder / (name + '.pub')).chmod(0o600)
        host_key = ' '.join(_read(folder / 'host.pub').split()[:2])
        with socket.socket() as reservation:
            reservation.bind((self.node.host, 0))
            port = reservation.getsockname()[1]
        alias = 'sparkie-workspace-' + allocation.allocation_id
        _write(folder / 'known_hosts', alias + ' ' + host_key + '\n')
        record = {'schema': 1, 'labels': self._labels(allocation), 'port': port, 'host_key': host_key,
                  'phase': 'prepared', 'operation_id': allocation.operation_id}
        self._save(allocation, record)
        return record

    def _objects(self, allocation):
        _, name, volumes = self._paths(allocation)
        ids = set(self._docker('ps', '-aq', '--no-trunc', '--filter', 'name=^/' + name + '$').split())
        ids.update(self._docker('ps', '-aq', '--no-trunc', '--filter', 'label=' + LABEL + '=' + allocation.allocation_id).split())
        found = set(self._docker('volume', 'ls', '-q', '--filter', 'label=' + LABEL + '=' + allocation.allocation_id).split())
        for volume in volumes:
            found.update(self._docker('volume', 'ls', '-q', '--filter', 'name=^' + volume + '$').split())
        return ids, found

    def _inspect(self, allocation, record):
        ids, found = self._objects(allocation)
        _, name, volumes = self._paths(allocation)
        if not ids and not found:
            return None
        if len(ids) != 1 or found != set(volumes):
            raise RuntimeError('The workspace is only partly created or its identities are ambiguous.')
        container_id = next(iter(ids))
        if not re.fullmatch('[a-f0-9]{64}', container_id):
            raise RuntimeError('The exact workspace container identity is unavailable.')
        inspected = json.loads(self._docker('inspect', container_id))
        if not isinstance(inspected, list) or len(inspected) != 1:
            raise RuntimeError('The workspace container could not be inspected.')
        item = inspected[0]
        config, host = item['Config'], item['HostConfig']
        image = self._image()
        labels = self._labels(allocation)
        expected_mounts = {(volumes[0], '/home/sandbox'), (volumes[1], '/workspace'), (volumes[1], '/opt/sparkie')}
        build_alias = [m for m in host.get('Mounts', []) if m.get('Target') == '/opt/sparkie']
        mounts = item.get('Mounts', [])
        if (item['Id'] != container_id or item['Name'] != '/' + name or item['Image'] != self.image_id
                or any(config.get('Labels', {}).get(key) != value for key, value in labels.items())
                or config.get('User') != 'sandbox' or config.get('WorkingDir') != '/workspace'
                or config.get('Cmd') != ['sleep', 'infinity'] or config.get('Entrypoint') not in (None, [])
                or (config.get('Env') or []) != (image['Config'].get('Env') or [])
                or host.get('Privileged') is not False or host.get('ReadonlyRootfs') is not True
                or host.get('NetworkMode') != 'bridge' or host.get('CapDrop') != ['ALL'] or host.get('CapAdd')
                or host.get('SecurityOpt') != ['no-new-privileges']
                or host.get('Memory') != allocation.request.memory_mb * 1024**2
                or host.get('MemorySwap') != allocation.request.memory_mb * 1024**2
                or host.get('NanoCpus') != round(allocation.request.cpu * 1000000000) or host.get('PidsLimit') != 128
                or host.get('Binds') or host.get('Devices') or host.get('DeviceRequests')
                or host.get('PortBindings') != {'2222/tcp': [{'HostIp': self.node.host, 'HostPort': str(record['port'])}]}
                or len(mounts) != len(expected_mounts) or len(build_alias) != 1
                or (build_alias[0].get('VolumeOptions') or {}).get('NoCopy') is not True
                or any(m.get('Type') != 'volume' or m.get('RW') is not True for m in mounts)
                or {(m.get('Name'), m.get('Destination')) for m in mounts} != expected_mounts):
            raise RuntimeError('The workspace runtime differs from its exact enrolled limits or isolation.')
        for volume in volumes:
            result = json.loads(self._docker('volume', 'inspect', volume))
            if (not isinstance(result, list) or len(result) != 1 or result[0].get('Name') != volume
                    or result[0].get('Driver') != 'local' or result[0].get('Options')
                    or any(result[0].get('Labels', {}).get(key) != value for key, value in labels.items())):
                raise RuntimeError('The workspace volume identity or backing changed.')
        lease = self._lease(allocation, record, container_id)
        if allocation.lease is not None and allocation.lease != lease:
            raise RuntimeError('The workspace cannot change its saved container or endpoint.')
        return item

    def _lease(self, allocation, record, container_id):
        folder, _, _ = self._paths(allocation)
        return WorkspaceLease(allocation.request, allocation.allocation_id, self.node.spark_id, self.node.machine_id,
                              self.node.host, record['port'], 'sandbox', container_id, self.image_id,
                              str(folder / 'client'), str(folder / 'known_hosts'),
                              'sparkie-workspace-' + allocation.allocation_id, record['host_key'])

    def _capacity(self):
        memory = {line.split(':')[0]: line.split(':')[1].strip() for line in Path('/proc/meminfo').read_text().splitlines()}
        root = self._docker('info', '--format', '{{.DockerRootDir}}').strip()
        if not Path(root).is_absolute():
            raise RuntimeError('The Docker storage location could not be checked.')
        return {'cpu': os.cpu_count() or 0, 'memory_mb': int(memory['MemAvailable'].split()[0]) // 1024,
                'disk_mb': shutil.disk_usage(root).free // 1024**2}

    def _image(self):
        image = json.loads(self._docker('image', 'inspect', self.image_id))
        if (not isinstance(image, list) or len(image) != 1 or image[0].get('Id') != self.image_id
                or image[0].get('Config', {}).get('User') != 'sandbox'):
            raise RuntimeError('The pinned non-root sandbox image is not present.')
        return image[0]

    def _admit(self, allocation):
        self._image()
        if self._docker('info', '--format', '{{.Name}}').strip() != socket.gethostname():
            raise RuntimeError('The Docker daemon does not match this local compute host.')
        capacity = self.capacity()
        request = allocation.request
        if (not isinstance(capacity, dict) or type(capacity.get('cpu')) not in (int, float)
                or not math.isfinite(capacity['cpu'])
                or type(capacity.get('memory_mb')) is not int or type(capacity.get('disk_mb')) is not int
                or capacity['cpu'] < request.cpu or capacity['memory_mb'] < request.memory_mb + self.memory_reserve_mb
                or capacity['disk_mb'] < request.disk_mb + self.disk_reserve_mb):
            raise RuntimeError('The compute Spark lacks verified free capacity beyond its system reserve.')

    def _ready(self, lease):
        try:
            result = self._run(['ssh', '-F', '/dev/null', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
                '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none', '-o', 'ForwardAgent=no',
                '-o', 'ClearAllForwardings=yes', '-o', 'ControlMaster=no', '-o', 'ControlPath=none',
                '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'UserKnownHostsFile=' + lease.known_hosts,
                '-o', 'HostKeyAlias=' + lease.host_key_alias, '-o', 'ConnectTimeout=2',
                '-i', lease.key_path, '-p', str(lease.port), 'sandbox@' + self.node.host, '/usr/bin/id', '-u'], timeout=4)
            return result.strip() == '12001'
        except Exception:
            return False

    def _start_server(self, allocation, record, container_id):
        lease = self._lease(allocation, record, container_id)
        if self.ready(lease):
            return
        folder, _, _ = self._paths(allocation)
        self._docker('exec', container_id, 'mkdir', '-p', '/run/ssh', '/run/sshd')
        values = [('host_key', _read(folder / 'host')), ('authorized_keys', 'restrict ' + _read(folder / 'client.pub')),
                  ('sshd_config', SSHD)]
        for name, value in values:
            self._docker('exec', '-i', container_id, 'sh', '-c', 'umask 077; cat > /run/ssh/' + name, input=value)
        self._docker('exec', '-d', container_id, '/usr/sbin/sshd', '-D', '-e', '-E', '/tmp/sshd.log', '-f', '/run/ssh/sshd_config')
        deadline = time.monotonic() + self.ready_wait
        while not self.ready(lease):
            if time.monotonic() >= deadline:
                raise RuntimeError('The exact sandbox SSH endpoint did not become ready.')
            time.sleep(.1)

    def provision(self, allocation):
        self._verify(allocation, dispatch=True)
        with self._lock(allocation):
            record = self._enroll(allocation)
            item = self._inspect(allocation, record)
            if record['operation_id'] == allocation.operation_id and record['phase'] != 'prepared':
                return  # A repeated/lost attempt is observed, never blindly sent again.
            if allocation.lease is None and item is not None:
                raise RuntimeError('Existing workspace objects need reconciliation before provisioning.')
            if allocation.lease is not None and (item is None or item['State'].get('Running') is not False):
                raise RuntimeError('Only the exact observed stopped workspace can resume.')
            try:
                self._admit(allocation)
            except Exception:
                if item is None and self._objects(allocation) == (set(), set()):
                    record.update(phase='never_created', operation_id=allocation.operation_id)
                    self._save(allocation, record)
                raise
            self._verify(allocation, dispatch=True)
            record.update(phase='effects_possible', operation_id=allocation.operation_id)
            self._save(allocation, record)  # Durable before the first possible Docker effect.
            _, name, volumes = self._paths(allocation)
            if item is None:
                labels = [part for key, value in self._labels(allocation).items() for part in ('--label', key + '=' + value)]
                for volume in volumes:
                    self._docker('volume', 'create', '--driver', 'local', *labels, volume)
                memory = str(allocation.request.memory_mb) + 'm'
                container_id = self._docker('create', '--name', name, *labels,
                    '--read-only', '--user', 'sandbox', '--workdir', '/workspace', '--network', 'bridge',
                    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--cpus', str(allocation.request.cpu),
                    '--memory', memory, '--memory-swap', memory, '--pids-limit', '128',
                    '--tmpfs', '/run:rw,noexec,nosuid,size=16m,uid=12001,gid=12001,mode=0700',
                    '--tmpfs', '/tmp:rw,nosuid,size=512m,mode=1777',
                    '--mount', 'type=volume,src=' + volumes[0] + ',dst=/home/sandbox',
                    '--mount', 'type=volume,src=' + volumes[1] + ',dst=/workspace',
                    # The package's final absolute prefix is private to this compute lease.
                    '--mount', 'type=volume,src=' + volumes[1] + ',dst=/opt/sparkie,volume-nocopy',
                    '-p', self.node.host + ':' + str(record['port']) + ':2222', self.image_id, 'sleep', 'infinity').strip()
                if not re.fullmatch('[a-f0-9]{64}', container_id):
                    raise RuntimeError('Container creation needs reconciliation by allocation label.')
                item = self._inspect(allocation, record)
                if item is None or item['Id'] != container_id:
                    raise RuntimeError('Container creation did not match its exact allocation.')
            container_id = item['Id']
            self._verify(allocation, dispatch=True)
            self._docker('start', container_id)
            self._start_server(allocation, record, container_id)
            record['phase'] = 'finished'
            self._save(allocation, record)

    def observe(self, allocation):
        try:
            self._verify(allocation)
            with self._lock(allocation):
                record = self._journal(allocation)
                item = self._inspect(allocation, record)
                if item is None:
                    state = 'never_created' if record['phase'] == 'never_created' and record['operation_id'] == allocation.operation_id else 'missing'
                    return WorkspaceObservation(allocation.allocation_id, state, operation_id=allocation.operation_id)
                lease = self._lease(allocation, record, item['Id'])
                state = item['State']
                if state.get('Running') is False and state.get('Status') in ('created', 'exited') and not state.get('Dead'):
                    return WorkspaceObservation(allocation.allocation_id, 'stopped', lease)
                if state.get('Running') is True and not state.get('Paused') and not state.get('Restarting') and self.ready(lease):
                    return WorkspaceObservation(allocation.allocation_id, 'ready', lease)
        except Exception:
            pass
        return WorkspaceObservation(allocation.allocation_id, 'unknown')

    def activity(self, allocation):
        # Conservative until a separately qualified idle/stop policy exists.
        # A detached process and an idle SSH server both keep a running container
        # protected; only an actual stopped container supplies an empty list.
        state = self.observe(allocation).state
        return [] if state == 'stopped' else ['The workspace container is running.'] if state == 'ready' else None

    def _idle_activity(self, allocation, item):
        if item['State'].get('Running') is False and item['State'].get('Status') in ('created', 'exited'):
            return []
        if (item['State'].get('Running') is not True or item['State'].get('Paused')
                or item['State'].get('Restarting') or item['State'].get('Dead')):
            return None
        result = json.loads(self._docker('exec', item['Id'], 'python3', '-I', '-c', IDLE_PROBE, timeout=8))
        if result == {'state': 'idle'}:
            return []
        return ['The workspace has active sessions or processes.'] if result == {'state': 'busy'} else None

    def idle_activity(self, allocation):
        """Read actual sandbox processes; never infer idle from SSH disconnect."""
        try:
            self._verify(allocation)
            with self._lock(allocation):
                record = self._journal(allocation)
                item = self._inspect(allocation, record)
                return self._idle_activity(allocation, item) if item is not None else None
        except Exception:
            return None

    def retire(self, allocation, operation):
        """Stop only a released empty workspace, retaining its volumes and keys."""
        self._verify(allocation, retirement=operation)
        if not allocation.release_id or allocation.lease is None:
            raise NotDispatched('The native workspace has not been released.')
        with self._lock(allocation):
            record = self._journal(allocation)
            item = self._inspect(allocation, record)
            if item is None or self._idle_activity(allocation, item) != []:
                raise NotDispatched('Workspace activity is present or unknown; nothing was stopped.')
            if item['State'].get('Running') is False:
                return
            if record.get('retirement_id') == operation:
                return  # The prior stop may still be finishing. Reconcile only.
            self._verify(allocation, retirement=operation)
            # A second process observation catches a session opened during the
            # inspection. The allocation lock excludes admitted reacquisition.
            if self._idle_activity(allocation, item) != []:
                raise NotDispatched('The workspace became active; nothing was stopped.')
            record['retirement_id'] = operation
            self._save(allocation, record)
            self._docker('stop', '--time', '10', item['Id'], timeout=15)

    def export_credentials(self, allocation):
        """Private controller transport only: export the exact sandbox credentials.

        The caller must keep this response off model paths, reports and logs.
        No caller-supplied path or host credential is accepted.
        """
        self._verify(allocation)
        with self._lock(allocation):
            record = self._journal(allocation)
            item = self._inspect(allocation, record)
            if (item is None or (allocation.lease is not None
                    and allocation.lease != self._lease(allocation, record, item['Id']))
                    or (allocation.lease is None and (record['phase'] not in ('effects_possible', 'finished')
                        or record['operation_id'] != allocation.operation_id))):
                raise ValueError('Only the exact saved workspace can export its sandbox identity.')
            folder, _, _ = self._paths(allocation)
            return {'private_key': _read(folder / 'client'), 'known_hosts': _read(folder / 'known_hosts')}
