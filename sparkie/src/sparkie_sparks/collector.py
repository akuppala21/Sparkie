"""Collect observations without starting or waking machines for a status read.

Run separately from the model with an operator-owned inventory and SSH identity.
Neither native tools nor dashboard routes accept collector commands or targets.
An optional protected controller socket runs its configured maintenance pass;
that pass can retire released empty workspaces and apply an enabled idle policy.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

from .worker_network import physical_ssh_options
from .fleet import read_status

SPARK_IDS = frozenset({'spark1', 'spark2', 'spark3', 'spark4'})
HOST = re.compile(r'[A-Za-z0-9][A-Za-z0-9.:-]{0,252}\Z')
USER = re.compile(r'[a-z_][a-z0-9_-]{0,31}\Z')
NAME = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\Z')


def load_inventory(path):
    data = Path(path).read_bytes()
    if len(data) > 16384:
        raise ValueError('Fleet inventory is too large.')
    config = json.loads(data)
    if not isinstance(config, dict) or config.get('schema') != 1:
        raise ValueError('Unsupported fleet inventory.')
    nodes = config.get('nodes')
    if not isinstance(nodes, list) or not 1 <= len(nodes) <= 4:
        raise ValueError('The inventory needs one to four Sparks.')
    seen = set()
    for node in nodes:
        if not isinstance(node, dict):
            raise ValueError('Invalid Spark entry.')
        spark = node.get('id')
        if not isinstance(spark, str) or spark not in SPARK_IDS or spark in seen:
            raise ValueError('Invalid or repeated Spark identity.')
        seen.add(spark)
        if type(node.get('local', False)) is not bool:
            raise ValueError('The local flag must be true or false.')
        for key, pattern in (('hostname', HOST), ('address', HOST), ('user', USER)):
            if not isinstance(node.get(key), str) or not pattern.fullmatch(node[key]):
                raise ValueError('Each Spark needs its verified hostname, address and user.')
        infrastructure = node.get('infrastructure', [])
        if not isinstance(infrastructure, list) or len(infrastructure) > 100 or any(
            not isinstance(name, str) or not NAME.fullmatch(name) for name in infrastructure
        ):
            raise ValueError('Invalid infrastructure names.')
    return nodes


def collect_one(node, *, runner=subprocess.run, clock=None):
    clock = clock or (lambda: datetime.now(timezone.utc))
    row = {'id': node['id'], 'observed_at': clock().isoformat(), 'state': 'unreachable'}
    args = ['ssh', *physical_ssh_options(node['address']),
            node['user'] + '@' + node['address'], 'python3', '-']
    if node.get('local', False):
        args = [sys.executable, '-']
    try:
        result = runner(args, input=Path(__file__).with_name('probe.py').read_text(),
                        capture_output=True, text=True, timeout=20, check=False)
        row['observed_at'] = clock().isoformat()
        if result.returncode != 0 or len(result.stdout) > 262144:
            return row
        data = json.loads(result.stdout)
        if not isinstance(data, dict) or data.get('hostname') != node['hostname']:
            return {**row, 'state': 'unknown', 'issue': 'identity_mismatch'}
        row.update(state='online', metrics=data.get('metrics'), workloads=data.get('workloads'),
                   network_links=data.get('network_links'))
        if isinstance(row['workloads'], list):
            for item in row['workloads']:
                if isinstance(item, dict):
                    item['kind'] = 'infrastructure' if item.get('name') in node.get('infrastructure', []) else 'workload'
        return row
    except (OSError, subprocess.TimeoutExpired, UnicodeError, ValueError, TypeError):
        return row


def collect(nodes, *, runner=subprocess.run, clock=None, plug_readings=()):
    # These are four bounded reads, not four inference workers or a persistent scheduler.
    plugs = {row['id']: row for row in plug_readings if row.get('available') is True}
    def observe(node):
        plug = plugs.get(node['id'])
        if plug and plug.get('on') is False:
            row = {'id': node['id'], 'state': 'off', 'observed_at': plug['observed_at']}
        else:
            row = collect_one(node, runner=runner, clock=clock)
        if plug:
            row['wall'] = {key: plug.get(key) for key in ('on', 'watts', 'cumulative_kwh', 'observed_at', 'source')}
        return row
    with ThreadPoolExecutor(max_workers=min(4, max(1, len(nodes)))) as pool:
        rows = list(pool.map(observe, nodes))
    return {'schema': 1, 'sparks': sorted(rows, key=lambda row: row['id'])}


def write_snapshot(path, snapshot):
    """Replace a complete snapshot atomically; partial observations never appear as JSON."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o750)
    payload = json.dumps(snapshot, allow_nan=False).encode()
    if len(payload) > 65536:
        raise ValueError('Fleet observation is too large to publish.')
    with tempfile.NamedTemporaryFile(dir=target.parent, prefix='.fleet-', delete=False) as stream:
        temporary = Path(stream.name)
        try:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
            os.chmod(temporary, 0o640)
            if not read_status(path=temporary)['available']:
                raise ValueError('Fleet observation could not be validated.')
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description='Read Spark status without waking machines.')
    parser.add_argument('--inventory', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--plugs', help='Operator-owned mapping of Sparks to verified Matter plug identities.')
    parser.add_argument('--energy-database', help='Append plug measurements to this private SQLite database.')
    parser.add_argument('--control-socket', help='Run the private controller maintenance pass after collecting.')
    args = parser.parse_args()
    try:
        nodes = load_inventory(args.inventory)
        plugs = []
        plug_problem = None
        if args.plugs:
            from .matter import MatterReader, save_readings
            try:
                mapping_bytes = Path(args.plugs).read_bytes()
                if len(mapping_bytes) > 16384:
                    raise ValueError('Plug mapping is too large.')
                mapping = json.loads(mapping_bytes)
                plugs = MatterReader().measurements(mapping)
                if any(row.get('available') is not True for row in plugs):
                    plug_problem = 'Some plugs could not supply fresh readings. No new electricity sample was recorded for them.'
                if args.energy_database:
                    save_readings(args.energy_database, plugs, mapping)
            except Exception:
                # Do not publish controller details or credentials. Fleet reads still work.
                plug_problem = 'Plug readings or electricity history could not be updated.'
        elif args.energy_database:
            raise ValueError('Electricity collection needs a verified plug mapping.')
        snapshot = collect(nodes, plug_readings=plugs)
        write_snapshot(args.output, snapshot)
    except (OSError, ValueError, TypeError):
        print('Fleet observations could not be collected. Check the inventory and access.', file=sys.stderr)
        return 1
    maintenance_problem = None
    if args.control_socket:
        try:
            from .broker import RemoteControls
            RemoteControls(args.control_socket, timeout=240)._call('maintenance')
        except (ValueError, RuntimeError):
            maintenance_problem = 'Some idle work could not be checked. Its resources remain protected.'
    print(json.dumps({'observed': len(snapshot['sparks']),
                      'online': sum(row['state'] == 'online' for row in snapshot['sparks']),
                      'plug_problem': plug_problem, 'maintenance_problem': maintenance_problem}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
