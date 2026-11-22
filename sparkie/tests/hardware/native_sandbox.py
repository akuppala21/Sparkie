"""Exercise the configured native terminal and file tools in a real compute container.

Only synthetic canaries are used. No real credentials, workload or host setting is
read or changed. Native cleanup removes only this check's sandbox container.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import socket
import subprocess
import sys
import time
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    args.out = args.out.resolve()
    args.out.mkdir(parents=True, exist_ok=False)
    root = Path(__file__).resolve().parents[2]
    home = args.out / 'hermes-home'
    home.mkdir(mode=0o700)
    config_source = root / 'config/hermes.example.yaml'
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from native_docker_fixture import configure_compute_docker
    from sandbox_cleanup import NativeSandboxCleanup
    configure_compute_docker(home, config_source, network=False)
    private = args.out / 'host-private'
    private.mkdir(mode=0o700)
    sentinel = 'fixture-canary-' + uuid.uuid4().hex
    secret = private / 'fleet-credential.txt'
    secret.write_text(sentinel)
    os.chmod(secret, 0o600)
    fleet_socket = private / 'fleet.sock'
    socket_probe = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    socket_probe.bind(str(fleet_socket))
    socket_probe.listen(1)
    os.chmod(fleet_socket, 0o600)
    (home / '.env').write_text('SPARKIE_BOUNDARY_TEST_SECRET=' + sentinel + '\n')
    os.chmod(home / '.env', 0o600)
    os.environ.update(HERMES_HOME=str(home), HERMES_DISABLE_LAZY_INSTALLS='1', HF_HUB_OFFLINE='1',
                      SPARKIE_BOUNDARY_TEST_SECRET=sentinel)
    from hermes_cli.config import load_config_readonly, apply_terminal_config_to_env
    config = load_config_readonly()
    apply_terminal_config_to_env(config=config, override=True)
    from tools import terminal_tool as terminal
    from tools.file_tools import read_file_tool, write_file_tool
    from tools.code_execution_tool import execute_code
    from tools.environments.docker import DockerEnvironment
    task = 'sparkie-isolation-' + uuid.uuid4().hex
    report = {'scope': 'Real native Docker terminal and file tools with synthetic host canaries; not complete executor isolation.',
              'host': socket.gethostname(), 'hermes': 'v0.23.2', 'checks': [],
              'source_config_sha256': hashlib.sha256(config_source.read_bytes()).hexdigest(),
              'config_sha256': hashlib.sha256((home / 'config.yaml').read_bytes()).hexdigest(),
              'fixture_config_sha256': hashlib.sha256((root / 'tests/native_docker_fixture.py').read_bytes()).hexdigest(),
              'cleanup_sha256': hashlib.sha256((root / 'tests/sandbox_cleanup.py').read_bytes()).hexdigest(),
              'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    started = time.monotonic()
    cleanup = NativeSandboxCleanup(home)
    try:
        probe = ('import json,os,pathlib,socket\n'
                 's=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)\n'
                 'try:\n s.connect(' + repr(str(fleet_socket)) + '); fleet_socket_reachable=True\n'
                 'except OSError:\n fleet_socket_reachable=False\n'
                 'finally:\n s.close()\n'
                 'print(json.dumps({'
                 '"in_container":pathlib.Path("/.dockerenv").exists(),'
                 '"host_file_visible":pathlib.Path(' + repr(str(secret)) + ').exists(),'
                 '"docker_socket_visible":pathlib.Path("/var/run/docker.sock").exists(),'
                 '"fleet_socket_reachable":fleet_socket_reachable,'
                 '"host_secret_in_environment":bool(os.environ.get("SPARKIE_BOUNDARY_TEST_SECRET"))}))')
        raw = terminal.terminal_tool('python3 -c ' + shlex.quote(probe), task_id=task, timeout=90)
        result = json.loads(raw)
        (args.out / 'terminal.json').write_text(json.dumps(result, indent=2))
        with terminal._env_lock:
            environments = list(terminal._active_environments.values())
        matches = [env for env in environments if isinstance(env, DockerEnvironment)]
        assert len(matches) == 1
        container = matches[0]._container_id
        cleanup.capture()
        assert result.get('exit_code') == 0, result
        observed = json.loads(result['output'].strip())
        assert observed == {'in_container': True, 'host_file_visible': False, 'docker_socket_visible': False,
                            'fleet_socket_reachable': False, 'host_secret_in_environment': False}, observed
        report['checks'].append('Native terminal runs inside Docker without host canary, Docker socket or secret environment')
        code = json.loads(execute_code(probe, task_id=task, enabled_tools=[]))
        (args.out / 'execute-code.json').write_text(json.dumps(code, indent=2))
        assert code.get('status') == 'success' and code.get('tool_calls_made') == 0, code
        assert json.loads(code['output'].strip()) == observed, code
        report['checks'].append('Native execute_code uses the same isolated container instead of the host Python process')
        report['checks'].append('Native terminal and execute_code cannot connect to the private host fleet socket')
        read = json.loads(read_file_tool(str(secret), task_id=task))
        assert sentinel not in json.dumps(read) and read.get('error'), read
        written = json.loads(write_file_tool('/workspace/isolation-check.txt', 'fixture work\n', task_id=task))
        assert not written.get('error'), written
        reread = json.loads(read_file_tool('/workspace/isolation-check.txt', task_id=task))
        assert 'fixture work' in json.dumps(reread), reread
        assert secret.read_text() == sentinel
        report['checks'].append('Native file tools cannot read the host canary and can write/read the sandbox workspace')
        inspected = json.loads(subprocess.check_output(['docker', 'inspect', container], text=True))[0]
        host = inspected['HostConfig']
        assert host['Privileged'] is False and host['NetworkMode'] == 'none'
        assert 'ALL' in host['CapDrop']
        assert any(value.startswith('no-new-privileges') for value in host['SecurityOpt'])
        assert sentinel not in json.dumps(inspected)
        assert all(not str(secret).startswith(mount['Source'].rstrip('/') + '/') for mount in inspected['Mounts'])
        assert host['Memory'] == 4096 * 1024 * 1024
        assert host['NanoCpus'] == 1000000000
        report['runtime'] = {'image': inspected['Config']['Image'], 'network': host['NetworkMode'],
                             'memory_bytes': host['Memory'], 'nano_cpus': host['NanoCpus'],
                             'cap_drop': host['CapDrop'], 'security_opt': host['SecurityOpt'],
                             'mount_destinations': [mount['Destination'] for mount in inspected['Mounts']]}
        report['checks'].append('Actual container has one CPU, 4 GiB limit, dropped capabilities and no-new-privileges')
        report['passed'] = True
    except Exception as exc:
        report['passed'] = False
        report['error'] = str(exc).replace(sentinel, '[fixture canary]')
    finally:
        socket_probe.close()
        fleet_socket.unlink(missing_ok=True)
        report['sandbox_cleanup'] = cleanup.finish()
        report['container_removed'] = report['sandbox_cleanup']['verified']
        report['passed'] = bool(report.get('passed') and report['container_removed'])
        report['elapsed_seconds'] = round(time.monotonic() - started, 3)
        (args.out / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report))
    return 0 if report.get('passed') and report.get('container_removed') else 1


if __name__ == '__main__':
    raise SystemExit(main())
