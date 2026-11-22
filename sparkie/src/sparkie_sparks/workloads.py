"""Typed stop adapter for the private execution boundary, not a model shell.

Inventory and credentials come only from trusted composition. Strict host keys
plus a remote hostname check precede mutation. A successful SSH exit alone never
means the workload stopped. No live transport is enabled on import.
"""
import json
from pathlib import Path
import shlex
import subprocess
import sys

from .operations import NotDispatched, intent
from .collector import HOST, USER, NAME, SPARK_IDS


class StopWorkload:
    def __init__(self, nodes, *, runner=subprocess.run):
        if not isinstance(nodes, list) or not 1 <= len(nodes) <= 4:
            raise ValueError('Use a verified fleet inventory.')
        for node in nodes:
            if not isinstance(node, dict) or node.get('id') not in SPARK_IDS or type(node.get('local', False)) is not bool:
                raise ValueError('Use a verified Spark identity.')
            for key, pattern in (('hostname', HOST), ('address', HOST), ('user', USER)):
                if not isinstance(node.get(key), str) or not pattern.fullmatch(node[key]):
                    raise ValueError('Use a verified hostname, address and owner account.')
            protected = node.get('infrastructure', [])
            if not isinstance(protected, list) or len(protected) > 100 or any(not isinstance(name, str) or not NAME.fullmatch(name) for name in protected):
                raise ValueError('Use verified supporting-service names.')
        if len({node['id'] for node in nodes}) != len(nodes):
            raise ValueError('A Spark cannot have two execution identities.')
        self.nodes = {node['id']: dict(node) for node in nodes}
        self.runner = runner

    def _request(self, target, mode):
        target = intent(target['action'], target['spark'], container=target.get('container'))
        if target['action'] != 'stop_workload':
            raise ValueError('This adapter only stops an exact workload.')
        node = self.nodes[target['spark']]
        payload = json.dumps({'mode': mode, 'hostname': node['hostname'], 'container': target['container'],
                              'protected': node.get('infrastructure', [])})
        source = Path(__file__).with_name('workload_worker.py').read_text()
        if node.get('local', False):
            args = [sys.executable, '-c', source, payload]
        else:
            args = ['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=5',
                    '-o', 'ConnectionAttempts=1', '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=1',
                    node['user'] + '@' + node['address'], 'python3 -c ' + shlex.quote(source) + ' ' + shlex.quote(payload)]
        result = self.runner(args, capture_output=True, text=True, timeout=40 if mode == 'stop' else 15, check=False)
        if result.returncode or len(result.stdout) > 16384:
            raise RuntimeError('The workload result could not be checked.')
        row = json.loads(result.stdout)
        if not isinstance(row, dict) or row.get('hostname') != node['hostname']:
            raise RuntimeError('The Spark identity could not be verified.')
        if row.get('status') not in ('refused', 'unknown') and row.get('container') != target['container']:
            raise RuntimeError('The workload identity could not be verified.')
        return row['status']

    def dispatch(self, operation, target):
        if self._request(target, 'stop') == 'refused':
            raise NotDispatched('The exact workload was refused before any stop was sent.')

    def observe(self, operation, target):
        return 'succeeded' if self._request(target, 'observe') == 'stopped' else 'unknown'
