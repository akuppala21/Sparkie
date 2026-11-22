"""Fixed compute-node inspection and normal shutdown; no plug or root setup.

The private broker supplies verified identities. The worker independently checks
the physical machine and Docker again immediately before a shutdown. Wider task,
session and inhibitor eligibility is the trusted broker's responsibility. This
worker alone does not establish complete idleness or successful shutdown.
"""
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import tempfile

COMPUTE = ('spark2', 'spark3', 'spark4')
MACHINE_ID = re.compile(r'[a-f0-9]{32}\Z')
UNIT = re.compile(r'[A-Za-z0-9_.@:-]{1,128}\.(?:service|scope)\Z')


def host_activity(*, runner=subprocess.run, proc=Path('/proc'), allowed_user_units=(), protected_units=()):
    """Conservative local work inventory, with no process arguments in output."""
    try:
        if (any(not isinstance(v, str) or not UNIT.fullmatch(v) for v in (*allowed_user_units, *protected_units))
                or len(allowed_user_units) > 32 or len(protected_units) > 32):
            return None
        def call(args):
            reply = runner(args, capture_output=True, text=True, timeout=5, check=False)
            if reply.returncode or len(reply.stdout) > 65536:
                raise ValueError('Unavailable activity source')
            return reply.stdout
        def login(method, signature):
            row = json.loads(call(['busctl', '--json=short', 'call', 'org.freedesktop.login1',
                '/org/freedesktop/login1', 'org.freedesktop.login1.Manager', method]))
            if row.get('type') != signature or len(row.get('data', [])) != 1 or not isinstance(row['data'][0], list):
                raise ValueError('Malformed session source')
            return row['data'][0]
        own_group = (proc / 'self/cgroup').read_text()
        own_session = re.search(r'/session-([^/]+)\.scope(?:/|$)', own_group.strip())
        own_session = own_session[1] if own_session else None
        sessions = login('ListSessions', 'a(susso)')
        blockers = []
        if any(len(row) != 5 or type(row[1]) is not int for row in sessions):
            return None
        if any((row[1] == 0 or row[1] >= 1000) and row[0] != own_session for row in sessions):
            blockers.append('Another owner or administrator session is open.')
        inhibitors = login('ListInhibitors', 'a(ssssuu)')
        if any(len(row) != 6 or not isinstance(row[0], str) or not isinstance(row[3], str) for row in inhibitors):
            return None
        if any(('shutdown' in row[0].split(':') or 'sleep' in row[0].split(':') and row[3] == 'block')
               for row in inhibitors):
            blockers.append('A system shutdown or sleep inhibitor is active.')
        gpu = call(['nvidia-smi', '--query-compute-apps=pid', '--format=csv,noheader,nounits']).strip()
        if gpu:
            if any(not re.fullmatch(r'\d+', line.strip()) for line in gpu.splitlines()):
                return None
            blockers.append('A GPU process is running.')
        for unit in protected_units:
            state = call(['systemctl', 'show', '--property=ActiveState', '--value', unit]).strip()
            if state not in ('inactive', 'failed'):
                blockers.append('A protected system service is active or unknown.')
        ancestors, pid = set(), os.getpid()
        for _ in range(64):
            ancestors.add(pid)
            if pid <= 1:
                break
            status = (proc / str(pid) / 'status').read_text()
            match = re.search(r'^PPid:\s+(\d+)$', status, re.M)
            if match is None:
                return None
            pid = int(match[1])
        else:
            return None
        unknown = False
        for path in proc.iterdir():
            if not path.name.isdecimal() or int(path.name) in ancestors:
                continue
            try:
                status = (path / 'status').read_text()
                uid = re.search(r'^Uid:\s+(\d+)', status, re.M)
                if uid is None:
                    return None
                if not 1000 <= int(uid[1]) < 60000 or re.search(r'^State:\s+Z\b', status, re.M):
                    continue
                groups = (path / 'cgroup').read_text()
                units = re.findall(r'/([^/]+\.(?:service|scope))(?=/|$)', groups.strip())
                unit = units[-1] if units else None
                if unit in allowed_user_units:
                    continue
                if unit not in ('init.scope', 'dbus.service'):
                    unknown = True
                    continue
                # Native user service managers and D-Bus are harmless baseline
                # processes only under their exact systemd scopes/executables.
                try:
                    exe = str((path / 'exe').resolve(strict=True))
                except PermissionError:
                    # The native user manager may be non-dumpable even to its
                    # own UID. Verify the kernel PID against systemd's system
                    # unit, never merely the process name or an arbitrary scope.
                    manager = (call(['systemctl', 'show', '--property=MainPID', '--value',
                        'user@' + uid[1] + '.service']).strip() if unit == 'init.scope' else '')
                    parent = re.search(r'^PPid:\s+(\d+)$', status, re.M)
                    native_pam = (manager.isdecimal() and parent is not None and parent[1] == manager
                        and (path / 'comm').read_text().strip() == '(sd-pam)')
                    if manager.isdecimal() and (manager == path.name or native_pam):
                        continue
                    return None
                baseline = ((unit == 'init.scope' and exe in ('/usr/lib/systemd/systemd', '/lib/systemd/systemd'))
                    or (unit == 'dbus.service' and exe in ('/usr/bin/dbus-daemon', '/usr/bin/dbus-broker', '/usr/bin/dbus-broker-launch')))
                if not baseline:
                    unknown = True
            except FileNotFoundError:
                # Ignore only a process that actually exited. A missing exe or
                # field on a still-live PID is unknown, not proof of idleness.
                if path.exists():
                    return None
                continue
        if unknown:
            blockers.append('An unapproved user process or detached host job is running.')
        return blockers
    except Exception:
        return None


def _docker(runner, *arguments):
    # A different daemon's idle state cannot authorize local shutdown. Ignore
    # ambient contexts, proxy/credential config and every Docker environment knob.
    environment = {key: value for key, value in os.environ.items() if not key.startswith('DOCKER_')}
    with tempfile.TemporaryDirectory(prefix='sparkie-docker-read-') as config:
        return runner(['docker', '--config', config, '--host', 'unix:///var/run/docker.sock', *arguments],
                      env=environment, capture_output=True, text=True, timeout=8, check=False)


def handle(request, *, hostname=None, read_text=None, runner=subprocess.run):
    hostname = hostname or socket.gethostname()
    read_text = read_text or (lambda path: Path(path).read_text())
    refused = {'status': 'refused'}
    required = {'mode', 'spark', 'hostname', 'machine_id', 'hub_machine_id'}
    if not isinstance(request, dict) or set(request) - required not in (set(), {'activity_policy'}) or not required <= set(request):
        return refused
    if request['mode'] not in ('inspect', 'sleep', 'activity') or request['spark'] not in COMPUTE:
        return refused
    if hostname in ('hub-host.invalid', 'spark1') or request['hostname'] != hostname:
        return refused
    expected, hub = request['machine_id'], request['hub_machine_id']
    if any(not isinstance(value, str) or not MACHINE_ID.fullmatch(value) for value in (expected, hub)) or expected == hub:
        return refused
    try:
        actual = read_text('/etc/machine-id').strip()
    except (OSError, ValueError):
        return refused
    if actual != expected or actual == hub:
        return refused
    identity = {'hostname': hostname, 'machine_id': actual}
    policy = request.get('activity_policy')
    if policy is not None and (not isinstance(policy, dict) or set(policy) != {'allowed_user_units', 'protected_units'}
            or not all(isinstance(v, list) for v in policy.values())):
        return {**refused, **identity}
    if request['mode'] == 'activity':
        blockers = host_activity(runner=runner, **(policy or {}))
        return {'status': 'observed', **identity, 'blockers': blockers}
    try:
        reply = _docker(runner, 'ps', '--no-trunc', '--format', '{{.ID}}')
        workloads = reply.stdout.splitlines() if reply.returncode == 0 and len(reply.stdout) <= 8192 else None
        if workloads is not None and (len(workloads) > 100 or any(not re.fullmatch('[a-f0-9]{64}', row) for row in workloads)):
            workloads = None
    except (OSError, subprocess.TimeoutExpired, ValueError, TypeError):
        workloads = None
    if request['mode'] == 'inspect':
        return {'status': 'observed', **identity, 'docker_ready': workloads is not None, 'workloads': workloads}
    if workloads is None or workloads:
        return {**refused, **identity}
    if policy is not None and host_activity(runner=runner, **policy) != []:
        return {**refused, **identity}
    try:
        allowed = runner(['sudo', '-n', '-l', '/usr/bin/systemctl', 'poweroff'],
                         capture_output=True, text=True, timeout=5, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return {**refused, **identity}
    if allowed.returncode != 0:
        return {**refused, **identity}
    try:
        allowed = runner(['sudo', '-n', '-l', '/usr/bin/systemctl', 'stop', 'nvidia-persistenced'],
                         capture_output=True, text=True, timeout=5, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return {**refused, **identity}
    if allowed.returncode != 0:
        return {**refused, **identity}
    # From here an error may follow a dispatched shutdown. Never call it refused
    # or completed; only the independent configured observer can establish that.
    try:
        stopped = runner(['sudo', '-n', '/usr/bin/systemctl', 'stop', 'nvidia-persistenced'],
                         capture_output=True, text=True, timeout=20, check=False)
        if stopped.returncode != 0:
            return {'status': 'uncertain', **identity}
        runner(['sudo', '-n', '/usr/bin/systemctl', 'poweroff'],
               capture_output=True, text=True, timeout=8, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return {'status': 'uncertain', **identity}
    return {'status': 'sent', **identity}


if __name__ == '__main__':
    try:
        request = json.loads(sys.argv[1]) if len(sys.argv) == 2 and len(sys.argv[1]) <= 4096 else None
        print(json.dumps(handle(request)))
    except (ValueError, TypeError):
        print(json.dumps({'status': 'refused'}))
