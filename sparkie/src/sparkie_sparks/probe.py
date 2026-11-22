"""Small read-only Linux observation, sent over SSH stdin by the collector.

This file is standalone: no installation, agent state, credentials or mutations.
"""

import csv
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import re
import shutil
import socket
import subprocess


def network_links(root=Path('/sys/class/net')):
    """Read physical link state, without guessing which Spark is at the far end."""
    try:
        interfaces = sorted(root.iterdir())
    except OSError:
        return None
    links = []
    for interface in interfaces:
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}', interface.name) or not (interface / 'device').exists():
            continue  # Exclude loopback, tunnels, bridges and container interfaces.
        if len(links) >= 16:
            return None
        def read(name):
            try:
                return (interface / name).read_text().strip()
            except OSError:
                return None
        carrier = read('carrier')
        value = read('speed')
        speed = int(value) if value and value.isdecimal() and 0 < int(value) <= 1600000 else None
        links.append({'name': interface.name,
                      'kind': 'wifi' if (interface / 'wireless').exists() else 'ethernet',
                      'state': 'up' if carrier == '1' else 'down' if carrier == '0' else 'unknown',
                      'speed_mbps': speed if carrier == '1' else None})
    return links


def command(args):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=5, check=False)
        if result.returncode == 0 and len(result.stdout) <= 262144:
            return result.stdout
    except (OSError, subprocess.TimeoutExpired, UnicodeError):
        pass
    return None


def observe():
    metrics = {}
    try:
        memory = {line.split(':', 1)[0]: int(line.split()[1]) * 1024
                  for line in Path('/proc/meminfo').read_text().splitlines()
                  if line.startswith(('MemTotal:', 'MemAvailable:'))}
        metrics.update(memory_total_bytes=memory['MemTotal'], memory_available_bytes=memory['MemAvailable'])
        metrics['uptime_seconds'] = float(Path('/proc/uptime').read_text().split()[0])
    except (OSError, ValueError, KeyError, IndexError):
        pass
    disk = shutil.disk_usage('/')
    metrics.update(disk_total_bytes=disk.total, disk_free_bytes=disk.free)
    gpu = command(['nvidia-smi', '--query-gpu=utilization.gpu,temperature.gpu,power.draw',
                   '--format=csv,noheader,nounits'])
    if gpu:
        try:
            values = next(csv.reader(io.StringIO(gpu)))
            for key, value in zip(('gpu_utilization_percent', 'gpu_temperature_c', 'gpu_power_watts'), values):
                try:
                    metrics[key] = float(value.strip())
                except ValueError:
                    pass  # Unsupported readings are unknown, never zero.
        except (StopIteration, csv.Error):
            pass
    containers = command(['docker', 'ps', '--no-trunc', '--format', '{{json .}}'])
    workloads = None
    if containers is not None:
        try:
            workloads = []
            for line in containers.splitlines():
                row = json.loads(line)
                workloads.append({'id': row['ID'], 'name': row['Names'], 'image': row['Image']})
                if len(workloads) > 100:
                    workloads = None
                    break
        except (KeyError, TypeError, ValueError):
            workloads = None
    return {'hostname': socket.gethostname(), 'observed_at': datetime.now(timezone.utc).isoformat(),
            'metrics': metrics, 'workloads': workloads, 'network_links': network_links()}


if __name__ == '__main__':
    print(json.dumps(observe(), allow_nan=False))
