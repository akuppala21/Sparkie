"""Small typed Docker stop/observe worker; no shell, sudo, arbitrary command or delete.

The private adapter supplies the exact container and verified machine identity.
The worker is also sent as source to Python over strict SSH. Its output never
includes container environment variables or raw Docker errors.
"""
import json
import os
import re
import socket
import subprocess
import sys
import tempfile

FORMAT = '{{json .Id}}\n{{json .Name}}\n{{json .State.Running}}\n{{json (index .Config.Labels "sparkie.protected")}}\n{{json .HostConfig.AutoRemove}}'


def _docker(runner, *arguments, timeout=8):
    # Typed operations target this verified host's daemon, never an inherited
    # Docker context/host. An empty private config excludes proxy/credential setup.
    environment = {key: value for key, value in os.environ.items() if not key.startswith('DOCKER_')}
    with tempfile.TemporaryDirectory(prefix='sparkie-docker-workload-') as config:
        return runner(['docker', '--config', config, '--host', 'unix:///var/run/docker.sock', *arguments],
                      env=environment, capture_output=True, text=True, timeout=timeout, check=False)


def handle(request, *, hostname=None, runner=subprocess.run):
    enrolled_hub = 'hub-host.invalid'
    if hostname is None and enrolled_hub.endswith('.invalid'):
        return {'status': 'refused', 'hostname': socket.gethostname()}
    hostname = hostname or socket.gethostname()
    refused = {'status': 'refused', 'hostname': hostname}
    if not isinstance(request, dict) or set(request) != {'mode', 'hostname', 'container', 'protected'}:
        return refused
    if hostname in (enrolled_hub, 'spark1') or request['hostname'] != hostname:
        return refused
    container, protected = request['container'], request['protected']
    if request['mode'] not in ('stop', 'observe') or not isinstance(container, str) or not re.fullmatch('[a-f0-9]{64}', container):
        return refused
    if not isinstance(protected, list) or len(protected) > 100 or any(not isinstance(name, str) for name in protected):
        return refused
    try:
        info = _docker(runner, 'inspect', '--format', FORMAT, container)
        if info.returncode or len(info.stdout) > 8192:
            return {'status': 'unknown', 'hostname': hostname}
        lines = info.stdout.strip().splitlines()
        if len(lines) not in (4, 5):
            return {'status': 'unknown', 'hostname': hostname}
        identity, name, running, protected_label = [json.loads(line) for line in lines[:4]]
        if identity != container or not isinstance(name, str) or type(running) is not bool:
            return refused
        if request['mode'] == 'observe':
            return {'status': 'running' if running else 'stopped', 'hostname': hostname, 'container': identity}
        if name.removeprefix('/') in protected or str(protected_label).lower() in ('true', '1', 'yes'):
            return refused
        if not running:
            return {'status': 'stopped', 'hostname': hostname, 'container': identity}
        # Docker's immutable removal setting belongs to this exact container ID.
        # Only the JSON boolean false establishes that stopping it retains it.
        if lines[4:] != ['false']:
            status = 'auto_remove' if lines[4:] == ['true'] else 'retention_unknown'
            return {'status': status, 'hostname': hostname, 'container': identity}
        # From here any timeout/error is uncertain. Never report "refused" after
        # Docker may have received a stop. The caller must inspect the exact ID.
        try:
            _docker(runner, 'stop', '--time', '10', container, timeout=20)
        except (OSError, subprocess.TimeoutExpired):
            pass
        return {'status': 'sent', 'hostname': hostname, 'container': identity}
    except (OSError, subprocess.TimeoutExpired, ValueError, TypeError):
        return {'status': 'unknown', 'hostname': hostname}


if __name__ == '__main__':
    try:
        request = json.loads(sys.argv[1]) if len(sys.argv) == 2 and len(sys.argv[1]) <= 16384 else None
        print(json.dumps(handle(request)))
    except (ValueError, TypeError):
        print(json.dumps({'status': 'refused'}))
