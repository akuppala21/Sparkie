"""Fixed compute-worker requests over the fleet's existing authenticated SSH.

The controller keeps allocation authority. Each compute host keeps only a
monotonic command receipt and its existing container journal. Neither endpoint
offers arbitrary commands or accepts model-supplied credentials. Sandbox keys
travel only on this private connection and are never returned by a model tool.
"""
import argparse
from dataclasses import asdict, replace
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys

from .collector import HOST, USER
from .operations import NotDispatched
from .io_budget import remaining_io
from .workspace_leases import Allocation, WorkspaceObservation
from .workspace_types import ComputeNode, WorkspaceLease, WorkspaceRequest
from .workspace_worker import DockerWorkspaceWorker, _private_dir, _read, _write

LIMIT = 65536
IDENTITY = re.compile(r'[a-f0-9]{32}\Z')
METHODS = {'provision', 'observe', 'activity', 'idle_activity', 'retire'}


def decode_allocation(value):
    if not isinstance(value, dict):
        raise ValueError('Use a recorded compute allocation.')
    data = dict(value)
    data['request'] = WorkspaceRequest(**data['request'])
    data['node'] = ComputeNode(**data['node'])
    if data['lease'] is not None:
        lease = dict(data['lease'])
        lease['request'] = WorkspaceRequest(**lease['request'])
        data['lease'] = WorkspaceLease(**lease)
    allocation = Allocation(**data)
    request = allocation.request
    if (not isinstance(allocation.allocation_id, str) or not IDENTITY.fullmatch(allocation.allocation_id)
            or not isinstance(allocation.operation_id, str) or not IDENTITY.fullmatch(allocation.operation_id)
            or allocation.state not in ('reserved', 'dispatching', 'ready', 'stopped', 'uncertain')
            or type(allocation.resources_held) is not bool
            or allocation.release_id is not None and (not isinstance(allocation.release_id, str)
                or not IDENTITY.fullmatch(allocation.release_id))
            or any(not isinstance(text, str) or not 0 < len(text) <= maximum
                or any(ord(c) < 32 for c in text)
                for text, maximum in ((allocation.scope, 256), (request.task_id, 512)))
            or request.persistent is not True or type(request.cpu) not in (int, float)
            or not math.isfinite(request.cpu) or request.cpu <= 0
            or type(request.memory_mb) is not int or request.memory_mb <= 0
            or type(request.disk_mb) is not int or request.disk_mb <= 0):
        raise ValueError('Invalid compute allocation or limits.')
    if allocation.lease is not None:
        lease = allocation.lease
        if (lease.request != request or lease.workspace_id != allocation.allocation_id
                or (lease.spark_id, lease.machine_id, lease.host) != (
                    allocation.node.spark_id, allocation.node.machine_id, allocation.node.host)):
            raise ValueError('The saved workspace does not match this allocation.')
    return allocation


class RemoteWorkspaceWorker:
    """Controller-side transport, with fixed operator configuration only."""
    def __init__(self, store, *, node, user, executable, config_path, controller_id,
                 credentials_dir, runner=subprocess.run):
        if (not isinstance(node, ComputeNode) or node.spark_id not in ('spark2', 'spark3', 'spark4')
                or not HOST.fullmatch(node.host) or not IDENTITY.fullmatch(node.machine_id)
                or not isinstance(user, str) or not USER.fullmatch(user)
                or not isinstance(controller_id, str) or not IDENTITY.fullmatch(controller_id)):
            raise ValueError('Configure the verified remote compute identity.')
        if any(not isinstance(path, str) or not Path(path).is_absolute() or '\n' in path
               for path in (executable, config_path)):
            raise ValueError('Use fixed absolute worker and configuration paths.')
        self.store, self.node, self.user, self.controller_id = store, node, user, controller_id
        self.command = shlex.join(['python3', '-I', executable, '--config', config_path])
        self.root, self.runner = Path(credentials_dir), runner
        if not self.root.is_absolute():
            raise ValueError('Use a private absolute sandbox credential directory.')
        _private_dir(self.root)
        with store._db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS workspace_remote_sequence '
                       '(allocation TEXT PRIMARY KEY, sequence INTEGER NOT NULL)')

    def _call(self, method, allocation, *, retirement=None):
        if allocation.node != self.node or method not in METHODS:
            raise ValueError('Use this exact configured compute worker.')
        with self.store._db() as db:
            row = db.execute('SELECT sequence FROM workspace_remote_sequence WHERE allocation=?',
                             (allocation.allocation_id,)).fetchone()
            sequence = (row[0] if row else 0) + 1
            db.execute('INSERT INTO workspace_remote_sequence VALUES (?,?) '
                       'ON CONFLICT(allocation) DO UPDATE SET sequence=excluded.sequence',
                       (allocation.allocation_id, sequence))
        request = {'schema': 1, 'controller': self.controller_id, 'sequence': sequence,
                   'method': method, 'allocation': asdict(allocation), 'retirement': retirement}
        payload = json.dumps(request, allow_nan=False)
        if len(payload.encode()) > LIMIT:
            raise ValueError('The compute request is too large.')
        args = ['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
                '-o', 'ConnectTimeout=5', '-o', 'ConnectionAttempts=1', '-o', 'ForwardAgent=no',
                '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=1',
                self.user + '@' + self.node.host, self.command]
        try:
            result = self.runner(args, input=payload + '\n', capture_output=True, text=True,
                                 timeout=remaining_io(55), check=False)
            if result.returncode or len(result.stdout.encode()) > LIMIT:
                raise ValueError('Invalid worker reply.')
            response = json.loads(result.stdout)
            if not isinstance(response, dict) or set(response) != {'sequence', 'result'} or response['sequence'] != sequence:
                raise ValueError('Invalid worker reply.')
            value = response['result']
            if isinstance(value, dict) and value == {'not_dispatched': True} and method in ('provision', 'retire'):
                raise NotDispatched('The exact compute change was refused before dispatch.')
            return value
        except (OSError, subprocess.TimeoutExpired, ValueError, TypeError):
            raise RuntimeError('The compute result is unverified. Reconcile this allocation before retrying.') from None

    def provision(self, allocation):
        self._call('provision', allocation)

    def observe(self, allocation):
        result = self._call('observe', allocation)
        if not isinstance(result, dict) or set(result) != {'observation', 'credentials'}:
            raise RuntimeError('The compute observation is invalid.')
        row = dict(result['observation'])
        if row.get('lease') is not None:
            value = dict(row['lease'])
            value['request'] = WorkspaceRequest(**value['request'])
            lease = WorkspaceLease(**value)
            if (lease.request != allocation.request or lease.workspace_id != allocation.allocation_id
                    or (lease.spark_id, lease.machine_id, lease.host) != (
                        self.node.spark_id, self.node.machine_id, self.node.host)):
                raise RuntimeError('The remote workspace identity changed.')
            credentials = result['credentials']
            if (not isinstance(credentials, dict) or set(credentials) != {'private_key', 'known_hosts'}
                    or any(not isinstance(v, str) or not 0 < len(v) <= 16384 for v in credentials.values())
                    or credentials['known_hosts'].strip() != lease.host_key_alias + ' ' + lease.expected_host_key):
                raise RuntimeError('The sandbox identity could not be enrolled.')
            folder = self.root / allocation.allocation_id
            _private_dir(folder)
            for name, value in (('client', credentials['private_key']), ('known_hosts', credentials['known_hosts'])):
                path = folder / name
                if path.exists():
                    if _read(path) != value:
                        raise RuntimeError('The saved sandbox credentials changed. No key was replaced.')
                else:
                    _write(path, value)
            row['lease'] = replace(lease, key_path=str(folder / 'client'), known_hosts=str(folder / 'known_hosts'))
        elif result['credentials'] is not None:
            raise RuntimeError('Unexpected sandbox credentials.')
        return WorkspaceObservation(**row)

    def _activity(self, method, allocation):
        result = self._call(method, allocation)
        if result is not None and (not isinstance(result, list) or len(result) > 100
                or any(not isinstance(v, str) or len(v) > 512 for v in result)):
            raise RuntimeError('The workspace activity could not be checked.')
        return result

    def activity(self, allocation):
        return self._activity('activity', allocation)

    def idle_activity(self, allocation):
        return self._activity('idle_activity', allocation)

    def retire(self, allocation, retirement):
        return self._call('retire', allocation, retirement=retirement)


class WorkerEndpoint:
    """One fixed local worker, reached only through operator-authenticated SSH."""
    def __init__(self, config, *, factory=DockerWorkspaceWorker):
        if (not isinstance(config, dict) or set(config) != {
                'schema', 'controller', 'node', 'hub_machine_id', 'image_id', 'state_dir', 'maximum'}
                or config['schema'] != 1 or not IDENTITY.fullmatch(config['controller'])):
            raise ValueError('Invalid protected compute-worker configuration.')
        self.config, self.node, self.factory = config, ComputeNode(**config['node']), factory
        self.root = Path(config['state_dir'])
        if not self.root.is_absolute():
            raise ValueError('Use an absolute private worker state directory.')
        _private_dir(self.root)
        _private_dir(self.root / 'requests')

    def handle(self, request):
        config = self.config
        if (not isinstance(request, dict) or set(request) != {
                'schema', 'controller', 'sequence', 'method', 'allocation', 'retirement'}
                or request['schema'] != 1 or request['controller'] != config['controller']
                or type(request['sequence']) is not int or not 0 < request['sequence'] < 2**63
                or request['method'] not in METHODS):
            raise ValueError('Invalid private compute request.')
        allocation = decode_allocation(request['allocation'])
        maximum = config['maximum']
        if (allocation.node != self.node or allocation.request.image != config['image_id']
                or any(getattr(allocation.request, key) > maximum[key] for key in ('cpu', 'memory_mb', 'disk_mb'))):
            raise ValueError('This worker cannot admit that machine, image or resource request.')
        method, retirement = request['method'], request['retirement']
        if method == 'retire':
            if not isinstance(retirement, str) or not IDENTITY.fullmatch(retirement):
                raise ValueError('Use the exact recorded retirement receipt.')
        elif retirement is not None:
            raise ValueError('Unexpected retirement receipt.')
        if method == 'provision' and (allocation.state != 'dispatching' or not allocation.resources_held):
            raise ValueError('Provisioning needs a recorded active allocation.')
        # Gateway-local key paths are never followed on a compute host.
        if allocation.lease is not None:
            folder = self.root / allocation.allocation_id
            allocation = replace(allocation, lease=replace(allocation.lease,
                key_path=str(folder / 'client'), known_hosts=str(folder / 'known_hosts')))
        fingerprint = hashlib.sha256(json.dumps({
            'scope': allocation.scope, 'node': asdict(allocation.node), 'request': asdict(allocation.request)
        }, sort_keys=True, allow_nan=False).encode()).hexdigest()
        record = self.root / 'requests' / (allocation.allocation_id + '.json')
        lock_path = self.root / 'requests' / (allocation.allocation_id + '.lock')
        fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if record.exists():
                old = json.loads(_read(record))
                if old['fingerprint'] != fingerprint or request['sequence'] <= old['sequence']:
                    raise ValueError('A stale or changed compute request was refused.')
            _write(record, json.dumps({'sequence': request['sequence'], 'fingerprint': fingerprint,
                'method': method, 'operation': allocation.operation_id, 'retirement': retirement}) + '\n')

            def authorize(value, *, dispatch=False, retirement=None):
                return (value == allocation and (not dispatch or method == 'provision')
                        and (retirement is None or method == 'retire' and retirement == request['retirement']))

            worker = self.factory(None, node=self.node, hub_machine_id=config['hub_machine_id'],
                image_id=config['image_id'], state_dir=self.root, authorize=authorize)
            if method == 'observe':
                observation = worker.observe(allocation)
                credentials = worker.export_credentials(allocation) if observation.lease is not None else None
                result = {'observation': asdict(observation), 'credentials': credentials}
            elif method == 'retire':
                try:
                    result = worker.retire(allocation, retirement)
                except NotDispatched:
                    result = {'not_dispatched': True}
            else:
                try:
                    result = getattr(worker, method)(allocation)
                except NotDispatched:
                    if method != 'provision':
                        raise
                    result = {'not_dispatched': True}
        return {'sequence': request['sequence'], 'result': result}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    paths = parser.add_mutually_exclusive_group(required=True)
    paths.add_argument('--config')
    paths.add_argument('--service-config')
    args = parser.parse_args()
    from .broker import private_json
    try:
        raw = sys.stdin.buffer.read(LIMIT + 1)
        if len(raw) > LIMIT:
            raise ValueError('Oversized request.')
        request = json.loads(raw)
        if args.service_config:
            if os.geteuid() == 0:
                raise ValueError('Run service requests as the enrolled non-root compute account.')
            from .service_worker import ServiceWorker
            try:
                value = ServiceWorker(private_json(args.service_config)).handle(request)
            except NotDispatched:
                value = {'not_dispatched': True}
            result = {'operation': request['operation'], 'result': value}
        else:
            result = WorkerEndpoint(private_json(args.config)).handle(request)
        payload = json.dumps(result, allow_nan=False)
        if len(payload.encode()) > LIMIT:
            raise ValueError('Oversized reply.')
        print(payload)
        return 0
    except Exception:
        # Never print a request, key, SSH stderr, filesystem detail or exception.
        print('{"error":"The compute result could not be verified."}')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
