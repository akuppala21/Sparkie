"""Execute an enrolled Compose service with a local Docker socket and durable identity."""

import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import shutil
import socket
import stat
import subprocess

from .operations import NotDispatched, require_retained_container
from .recipe_services import COMPUTE, INSTANCE, REVISION
from .service_definitions import ARTIFACTS, DEFINITIONS, GLM, MODEL, compose_file, recipe
from .workspace_worker import _private_dir, _read, _write, machine_identity


def _run(args, *, env, cwd, timeout=15, text_input=None):
    result = subprocess.run(
        args,
        input=text_input,
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if result.returncode or len(result.stdout) > 131072:
        raise RuntimeError('The service runtime did not confirm the requested step.')
    return ((result.stdout + result.stderr) if args[1] == 'logs' else result.stdout).strip()


def _probe(name, port, instance):
    conn = http.client.HTTPConnection('127.0.0.1', port, timeout=3)
    try:
        conn.request('GET', '/v1/models' if name == GLM else '/__sparkie_health')
        response = conn.getresponse()
        data = response.read(32769)
        if response.status != 200 or len(data) > 32768:
            return False
        if name == ARTIFACTS:
            return data == instance.encode()
        return [item['id'] for item in json.loads(data)['data']] == [MODEL]
    finally:
        conn.close()


class ServiceWorker:
    def __init__(self, config, *, identity=machine_identity, run=_run, probe=_probe):
        if (
            set(config) != {'schema', 'controller', 'spark', 'machine', 'hub_machine', 'state_dir', 'data'}
            or config['schema'] != 1
            or config['spark'] not in COMPUTE
            or any(
                not isinstance(config[k], str) or not INSTANCE.fullmatch(config[k])
                for k in ('controller', 'machine', 'hub_machine')
            )
            or config['machine'] == config['hub_machine']
            or config['machine'] != identity()
            or not isinstance(config['data'], dict)
            or not set(config['data']) <= DEFINITIONS.keys()
        ):
            raise ValueError('The service worker configuration does not match this compute Spark.')
        self.config, self.run, self.probe = config, run, probe
        self.root = Path(config['state_dir'])
        if not self.root.is_absolute() or self.root.resolve() != self.root:
            raise ValueError('Use a private absolute service state directory.')
        _private_dir(self.root)
        self.env = {
            'PATH': '/usr/bin:/bin',
            'HOME': str(self.root),
            'DOCKER_CONFIG': str(self.root / 'docker'),
            'DOCKER_HOST': 'unix:///var/run/docker.sock',
            'COMPOSE_DISABLE_ENV_FILE': '1',
        }
        _private_dir(self.root / 'docker')

    def _docker(self, *args, timeout=15, text_input=None):
        return self.run(
            ['/usr/bin/docker', *args], env=self.env, cwd=self.root, timeout=timeout, text_input=text_input
        )

    def _identities(self, workload):
        return self._docker(
            'ps', '-a', '--no-trunc', '--filter', 'name=^/' + workload + '$', '--format', '{{.ID}}'
        ).splitlines()

    def _container(self, record):
        workload = record['workload']
        ids = self._identities(workload)
        if not ids:
            return None
        if len(ids) != 1 or not REVISION.fullmatch(ids[0]) or record.get('container') not in (None, ids[0]):
            raise RuntimeError('The recorded service identity changed.')
        (item,) = json.loads(self._docker('inspect', '--type', 'container', ids[0]))
        labels = item['Config']['Labels']
        name, instance = record['recipe'], record['instance']
        d = DEFINITIONS[name]
        if (
            item['Id'] != ids[0]
            or item['Name'] != '/' + workload
            or item['Image'] != record['image']
            or any(
                labels.get(key) != val
                for key, val in {
                    'sparkie.instance': instance,
                    'sparkie.machine': self.config['machine'],
                    'sparkie.recipe': name,
                    'sparkie.revision': record['revision'],
                    'com.docker.compose.project': workload,
                    'com.docker.compose.service': 'service',
                }.items()
            )
            or labels.get('sparkie.protected') != 'true'
            or item['HostConfig']['Privileged']
            or not item['HostConfig']['ReadonlyRootfs']
            or item['HostConfig']['PortBindings']
            != {'8000/tcp': [{'HostIp': '127.0.0.1', 'HostPort': str(d['port'])}]}
        ):
            raise RuntimeError('The service container differs from its approved placement.')
        return item

    def _preflight(self, name, data):
        if not data.is_absolute() or data.resolve() != data or not data.is_dir():
            raise ValueError('The enrolled service data is unavailable.')
        image = self._docker('image', 'inspect', '--format', '{{.Id}}', DEFINITIONS[name]['image'])
        available = re.search(r'^MemAvailable:\s+(\d+) kB$', Path('/proc/meminfo').read_text(), re.M)
        required_mb = DEFINITIONS[name]['memory_mb'] + 2048
        if (
            not re.fullmatch(r'sha256:[a-f0-9]{64}', image)
            or not available
            or int(available[1]) < required_mb * 1024
            or shutil.disk_usage(self.root).free < 2 * 2**30
        ):
            raise ValueError('The cache image or reserved compute capacity is unavailable.')
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', DEFINITIONS[name]['port']))
        if name == GLM:
            procs = self.run(
                ['/usr/bin/nvidia-smi', '--query-compute-apps=pid', '--format=csv,noheader,nounits'],
                cwd=self.root,
                env=self.env,
            )
            if procs or self._docker('ps', '-q'):
                raise ValueError('The GPU recipe requires an otherwise unused compute Spark.')
            self._weights(data)
        return image

    def _weights(self, data):
        cache = self.root / 'verified-weights.json'
        previous = json.loads(_read(cache)) if cache.exists() else {}
        current = {}
        for name, expected in DEFINITIONS[GLM]['files'].items():
            path = data / name
            with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as stream:

                def stamp():
                    st = os.fstat(stream.fileno())
                    if not stat.S_ISREG(st.st_mode):
                        raise ValueError('Weights must be regular files.')
                    return [st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns, expected]

                signature = stamp()
                if (
                    previous.get(name) != signature
                    and hashlib.file_digest(stream, 'sha256').hexdigest() != expected
                ):
                    raise ValueError('A model weight differs from the enrolled revision.')
                if stamp() != signature:
                    raise ValueError('The local model changed during verification.')
                current[name] = signature
        _write(cache, json.dumps(current))

    def handle(self, request):
        config = self.config
        if (
            not isinstance(request, dict)
            or set(request)
            != {
                'controller',
                'machine',
                'spark',
                'method',
                'instance',
                'operation',
                'recipe',
                'revision',
                'workload',
            }
            or any(request[k] != config[k] for k in ('controller', 'machine', 'spark'))
            or request['method'] not in ('start', 'stop', 'observe', 'logs')
            or any(
                not isinstance(request[k], str) or not INSTANCE.fullmatch(request[k])
                for k in ('instance', 'operation')
            )
            or request['method'] == 'start'
            and request['operation'] != request['instance']
            or request['recipe'] not in config['data']
            or request['revision'] != recipe(request['recipe'], ()).revision
            or request['workload'] != 'sparkie-' + request['instance']
        ):
            raise ValueError('Use an exact enrolled service instance and worker identity.')
        name, method, instance = request['recipe'], request['method'], request['instance']
        folder = self.root / instance
        if not folder.exists() and method in ('observe', 'logs'):
            return (
                {'state': 'unknown', 'workload': request['workload'], 'port': None}
                if method == 'observe'
                else []
            )
        _private_dir(folder)
        with (folder / 'lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            path = folder / 'receipt.json'
            record = json.loads(_read(path)) if path.exists() else None
            if record and any(
                record[k] != request[k]
                for k in ('instance', 'recipe', 'revision', 'workload', 'machine', 'spark', 'controller')
            ):
                raise ValueError('The worker receipt belongs to a different service.')
            if method == 'start':
                if record:
                    return None  # Never resume or replace a prior launch from a repeated message.
                data = Path(config['data'][name])
                record = {
                    k: request[k]
                    for k in (
                        'instance',
                        'recipe',
                        'revision',
                        'workload',
                        'machine',
                        'spark',
                        'controller',
                    )
                }
                try:
                    image = self._preflight(name, data)
                    cache = self.root / ('cache-' + request['revision'])
                    _private_dir(cache)
                    if name == GLM and cache.stat().st_uid != 1000:
                        raise ValueError(
                            'The private runtime cache needs the enrolled nonroot container identity.'
                        )
                    record.update(phase='creating', image=image)
                    if self._container(record) is not None:
                        raise ValueError('An existing service already has this identity.')
                    definition = json.dumps(compose_file(name, instance, config['machine'], data, cache))
                except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
                    record['phase'] = 'refused'
                    _write(path, json.dumps(record))
                    raise NotDispatched('The enrolled service failed compute preflight.') from None
                _write(path, json.dumps(record))
                # Create without starting. Persist Docker's immutable identity before
                # a launch can execute, even if the create reply or process is lost.
                self._docker(
                    'compose',
                    '--project-name',
                    request['workload'],
                    '-f',
                    '-',
                    'create',
                    '--pull',
                    'never',
                    '--no-build',
                    '--no-recreate',
                    'service',
                    text_input=definition,
                    timeout=45,
                )
                item = self._container(record)
                if not item:
                    raise RuntimeError('Compose creation could not be verified.')
                record.update(container=item['Id'], phase='starting')
                _write(path, json.dumps(record))
                self._docker('start', item['Id'], timeout=35)
                return None
            if method == 'stop' and (
                not record
                or record.get('phase') == 'creating'
                and not self._identities(request['workload'])
            ):
                # The lock excludes a concurrent worker. Earlier creation can
                # only produce a dormant container. A delayed start is fenced by
                # this durable receipt and cannot run the named instance.
                if not record:
                    if self._identities(request['workload']):
                        raise NotDispatched('An unrecorded container occupies the service identity.')
                    record = {
                        k: request[k]
                        for k in (
                            'instance',
                            'recipe',
                            'revision',
                            'workload',
                            'machine',
                            'spark',
                            'controller',
                        )
                    }
                record.update(phase='fenced', stop=request['operation'])
                _write(path, json.dumps(record))
                return None
            if not record or record.get('phase') in ('refused', 'fenced'):
                if method == 'stop':
                    raise NotDispatched('The service has no observed workload.')
                if method == 'logs':
                    return ['Compute preflight refused the service.'] if record else []
                return {
                    'state': 'stopped' if record else 'unknown',
                    'workload': request['workload'],
                    'port': None,
                }
            item = self._container(record)
            if item and not record.get('container'):
                record['container'] = item['Id']
                _write(path, json.dumps(record))
            if method == 'stop':
                if not item:
                    raise NotDispatched('The exact container could not be identified.')
                if record.get('stop'):
                    if record['stop'] == request['operation']:
                        return None
                    raise NotDispatched('The service already has a different stop request.')
                require_retained_container(item)
                record['stop'] = request['operation']
                _write(path, json.dumps(record))
                self._docker('stop', '--time', '15', item['Id'], timeout=25)
                return None
            if method == 'logs':
                if not item:
                    return ['The identified container is unavailable.']
                return self._logs(item)
            state, port = 'unknown', None
            if item and item['State']['Status'] in ('created', 'exited', 'dead') and record.get('stop'):
                state = 'stopped'
            elif (
                item
                and item['State']['Status'] == 'running'
                and item['NetworkSettings']['Ports'].get('8000/tcp')
                == item['HostConfig']['PortBindings']['8000/tcp']
            ):
                candidate = DEFINITIONS[name]['port']
                try:
                    if self.probe(name, candidate, instance):
                        after = self._container(record)
                        if (
                            after
                            and after['Id'] == item['Id']
                            and after['State']['Status'] == 'running'
                            and after['State']['StartedAt'] == item['State']['StartedAt']
                            and after['NetworkSettings']['Ports'] == item['NetworkSettings']['Ports']
                        ):
                            state, port = 'ready', candidate
                except (OSError, ValueError, KeyError, TypeError, http.client.HTTPException):
                    pass
            return {'state': state, 'workload': request['workload'], 'port': port}

    def _logs(self, item):
        # User prompts, HTTP query strings, tokens and arbitrary process output
        # must not reenter the dashboard or model context. Report runtime events
        # using allowlisted signatures and Docker's bounded event fields.
        result = [
            'Container ' + item['State']['Status'] + '.',
            'Restart count ' + str(item['RestartCount']) + '.',
        ]
        raw = self._docker('logs', '--tail', '80', item['Id'])
        for marker, message in [
            ('Loading safetensors', 'Loading model weights.'),
            ('CUDA graph', 'Preparing CUDA graphs.'),
            ('Application startup complete', 'Model HTTP server started.'),
            ('Traceback (most recent call last)', 'The service reported a Python exception.'),
        ]:
            if marker in raw:
                result.append(message)
        if item['State']['Status'] in ('exited', 'dead'):
            result.append('Exit code ' + str(item['State']['ExitCode']) + '.')
        return result
