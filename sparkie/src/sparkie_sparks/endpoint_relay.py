"""Private, loopback-only SSH forwarding for enrolled service instances.

The controller owns these child processes; there is no new daemon, public
listener, model-selected destination or shell command. A forward is useful only
after RecipeServices has freshly verified the exact service. Stopping a forward
does not stop a workload or release its resource reservation.
"""
import math
import os
from pathlib import Path
import re
import socket
import subprocess
import threading
import time

from .collector import HOST, USER


class EndpointRelay:
    def __init__(self, config, nodes, *, popen=subprocess.Popen, runner=subprocess.run, clock=time.time,
                 monotonic=time.monotonic, sleep=time.sleep, connect=socket.create_connection):
        if (not isinstance(config, dict) or set(config) != {'ports', 'directory'}
                or not isinstance(config['ports'], dict) or not config['ports']
                or len(config['ports']) > 32):
            raise ValueError('Configure fixed loopback ports for enrolled services.')
        self.ports = dict(config['ports'])
        self.directory = Path(config['directory'])
        if not self.directory.is_absolute() or len(str(self.directory)) > 50:
            raise ValueError('Use a short private absolute directory for SSH control sockets.')
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        permissions = self.directory.lstat()
        if self.directory.is_symlink() or permissions.st_uid != os.geteuid() or permissions.st_mode & 0o077:
            raise ValueError('The SSH control directory must be private to the controller.')
        if (any(not isinstance(name, str) or not re.fullmatch('[a-z][a-z0-9-]{0,47}', name)
                or type(port) is not int or not 1024 <= port <= 65535
                for name, port in self.ports.items())
                or len(set(self.ports.values())) != len(self.ports)):
            raise ValueError('Each service needs its own reviewed loopback port.')
        self.nodes = {}
        for node in nodes:
            if (node['id'] not in ('spark2', 'spark3', 'spark4')
                    or not HOST.fullmatch(node['address']) or not USER.fullmatch(node['user'])
                    or node['id'] in self.nodes):
                raise ValueError('Use enrolled compute hosts for service forwards.')
            self.nodes[node['id']] = dict(node)
        self.popen, self.runner, self.clock, self.monotonic = popen, runner, clock, monotonic
        self.sleep, self.connect = sleep, connect
        self.children, self.lock = {}, threading.Lock()

    @staticmethod
    def _stop(process):
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)

    def _discard(self, recipe):
        saved = self.children.pop(recipe, None)
        if saved is not None:
            self._stop(saved[1])

    def discard(self, recipe, instance=None):
        with self.lock:
            saved = self.children.get(recipe)
            if saved is not None and (instance is None or saved[0][3] == instance):
                self._discard(recipe)

    def prune(self, active_instances):
        """Use durable active instance IDs, without querying or waking a Spark."""
        active = set(active_instances)
        with self.lock:
            for name, (identity, process) in list(self.children.items()):
                if identity[3] not in active or process.poll() is not None:
                    self._discard(name)

    def close(self):
        with self.lock:
            for name in list(self.children):
                self._discard(name)

    def ensure(self, endpoint):
        required = {'recipe', 'revision', 'spark', 'instance', 'kind', 'host', 'port',
                    'backend_host', 'ready', 'observed_at'}
        if not isinstance(endpoint, dict) or set(endpoint) != required:
            raise ValueError('A verified service endpoint is required.')
        node = self.nodes.get(endpoint['spark'])
        observed = endpoint['observed_at']
        if (endpoint['recipe'] not in self.ports or node is None
                or endpoint['host'] != node['address'] or endpoint['backend_host'] != '127.0.0.1'
                or endpoint['ready'] is not True or endpoint['kind'] not in ('model', 'app')
                or not isinstance(endpoint['instance'], str) or not re.fullmatch('[a-f0-9]{32}', endpoint['instance'])
                or not isinstance(endpoint['revision'], str) or not re.fullmatch('[a-f0-9]{64}', endpoint['revision'])
                or type(endpoint['port']) is not int or not 1024 <= endpoint['port'] <= 65535
                or type(observed) not in (float, int) or not math.isfinite(observed)
                or not 0 <= self.clock() - observed <= 5):
            raise ValueError('The service identity or fresh observation could not be verified.')
        identity = tuple(endpoint[k] for k in ('recipe', 'revision', 'spark', 'instance', 'host', 'port'))
        name, port = endpoint['recipe'], self.ports[endpoint['recipe']]
        with self.lock:
            saved = self.children.get(name)
            if saved is not None and (saved[0] != identity or saved[1].poll() is not None):
                self._discard(name)
                saved = None
            if saved is None:
                control = self.directory / name
                if control.exists() or control.is_symlink():
                    raise RuntimeError('A previous service connection needs controller recovery.')
                args = ['ssh', '-N', '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
                        '-o', 'ConnectTimeout=5', '-o', 'ConnectionAttempts=1', '-o', 'ForwardAgent=no',
                        '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=10',
                        '-o', 'ServerAliveCountMax=2', '-o', 'ControlPersist=no',
                        '-o', 'ForkAfterAuthentication=no', '-M', '-S', str(control),
                        '-L', f'127.0.0.1:{port}:127.0.0.1:{endpoint["port"]}',
                        node['user'] + '@' + node['address']]
                process = self.popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                     stderr=subprocess.DEVNULL)
                self.children[name] = (identity, process)
                deadline = self.monotonic() + 6
                try:
                    while True:
                        if process.poll() is not None:
                            raise RuntimeError('The private service connection could not be opened.')
                        try:
                            # The private control socket appears only after SSH authentication
                            # and the checked forward setup. A random listener on the port is
                            # not proof that our SSH child owns it.
                            ready = self.runner(['ssh', '-S', str(control), '-O', 'check',
                                                 node['user'] + '@' + node['address']],
                                                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                                stderr=subprocess.DEVNULL, timeout=1, check=False)
                            if ready.returncode:
                                raise OSError('SSH has not completed forwarding setup.')
                            with self.connect(('127.0.0.1', port), timeout=0.2):
                                pass
                            if process.poll() is not None:
                                raise RuntimeError('The private service connection was not established.')
                            break
                        except (OSError, subprocess.TimeoutExpired):
                            if self.monotonic() >= deadline:
                                raise RuntimeError('The private service connection did not become ready.') from None
                            self.sleep(0.05)
                except BaseException:
                    self._discard(name)
                    raise
        return {'port': port, 'kind': endpoint['kind'], 'instance': endpoint['instance']}
