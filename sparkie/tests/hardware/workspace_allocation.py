"""Real disposable allocator -> fixed worker -> native Hermes provider proof.

Spark 4 only. No host SSH/user/firewall/root setup, model traffic, bot traffic or
live application change. Cleanup removes only this fixture's labelled objects.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import socket
import subprocess
import time
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--image', required=True)
    parser.add_argument('--hub-machine-id-file', type=Path, required=True)
    args = parser.parse_args()
    if socket.gethostname() != 'compute4-host.invalid':
        parser.error('This disposable qualification is restricted to Spark 4.')
    hub = args.hub_machine_id_file.read_text().strip()
    machine = Path('/etc/machine-id').read_text().strip()
    if not re.fullmatch('[a-f0-9]{32}', hub) or not re.fullmatch('[a-f0-9]{32}', machine) or hub == machine:
        parser.error('Verify the physical compute and permanent-host identities first.')
    args.out.mkdir(parents=True, mode=0o700, exist_ok=False)
    nonce, started = uuid.uuid4().hex, time.monotonic()
    scope, task = 'allocation-proof:' + nonce, 'native-proof:' + nonce
    home, private = args.out / 'hermes-home', args.out / 'private'
    home.mkdir(mode=0o700)
    private.mkdir(mode=0o700)
    sentinel = 'synthetic-workspace-canary-' + nonce
    canary = private / 'fleet-secret.txt'
    canary.write_text(sentinel)
    canary.chmod(0o600)
    fleet_socket = private / 'fleet.sock'
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.bind(str(fleet_socket))
    sock.listen(1)
    ambient = private / 'ambient-docker'
    ambient.mkdir(mode=0o700)
    (ambient / 'config.json').write_text(json.dumps({'proxies': {'default': {'httpProxy': 'https://fixture:' + sentinel + '@invalid.example'}}}))
    (home / 'config.yaml').write_text(
        'terminal:\n  backend: spark_compute\n  cwd: /workspace\n  credential_files: []\n'
        '  env_passthrough: []\n  container_cpu: 1\n  container_memory: 4096\n  container_disk: 8192\n'
        'plugins:\n  isolation: in_process\ntelemetry:\n  shared_metrics:\n    enabled: false\n    send: false\n')
    (home / '.env').write_text('SPARKIE_WORKSPACE_PROOF_SECRET=' + sentinel + '\n')
    (home / '.env').chmod(0o600)
    os.environ.update(HERMES_HOME=str(home), HERMES_DISABLE_LAZY_INSTALLS='1', TERMINAL_ENV='spark_compute',
                      TERMINAL_CWD='/workspace', TERMINAL_CONTAINER_CPU='1', TERMINAL_CONTAINER_MEMORY='4096',
                      TERMINAL_CONTAINER_DISK='8192', SPARKIE_WORKSPACE_PROOF_SECRET=sentinel,
                      DOCKER_HOST='ssh://invalid-fixture.example', DOCKER_CONTEXT='invalid-fixture-context', DOCKER_CONFIG=str(ambient))
    from agent.terminal_env_registry import register_provider
    from sparkie_sparks.operations import OperationStore
    from sparkie_sparks.sandbox_provider import SparkComputeProvider
    from sparkie_sparks.workspace_leases import ResourceBudget, WorkspaceLeases
    from sparkie_sparks.workspace_types import ComputeNode
    from sparkie_sparks.workspace_worker import DockerWorkspaceWorker, LABEL
    from tools import terminal_tool as terminal
    from tools.terminal_tool_lifecycle import cleanup_vm, get_active_env
    from tools.file_tools import read_file_tool, write_file_tool, patch_tool
    from tools.code_execution_tool import execute_code
    from tools.environments import streams

    mutations = {'create': 0, 'start': 0, 'volume_create': 0}
    def run(command, **kwargs):
        if command[0] == 'docker':
            assert command[1] == '--config' and command[3:5] == ['--host', 'unix:///var/run/docker.sock']
            verb = command[5:]
            if verb[0] in ('create', 'start'):
                mutations[verb[0]] += 1
            if verb[:2] == ['volume', 'create']:
                mutations['volume_create'] += 1
        return subprocess.run(command, **kwargs)

    store = OperationStore(private / 'operations.sqlite')
    node = ComputeNode('spark4', machine, '127.0.0.1')
    worker = DockerWorkspaceWorker(store, node=node, hub_machine_id=hub, image_id=args.image,
                                    state_dir=private / 'worker', runner=run)
    leases = WorkspaceLeases(store, nodes=[node], hub_machine_id=hub, image=args.image,
        budgets={'spark4': ResourceBudget(2, 8192, 20000)}, provision=worker.provision,
        observe=worker.observe, activity=worker.activity, candidate_order=lambda scope, request: ['spark4'])
    provider = SparkComputeProvider(nodes=[node], hub_machine_id=hub, image=args.image,
        acquire=lambda request: leases.acquire(scope, request), idle=lambda lease: leases.idle(scope, lease))
    register_provider(provider, scope=str(home))
    report = {'scope': 'One disposable local-loopback Spark 4 workspace through durable allocation and actual native Hermes tools; production disconnected.',
              'host': socket.gethostname(), 'hermes': 'v0.23.2', 'hub_physical_identity_excluded': True, 'checks': [],
              'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    envs = []
    lease = None
    def docker(*command, check=True):
        environment = {key: value for key, value in os.environ.items() if not key.startswith('DOCKER_')}
        return subprocess.run(['docker', '--config', str(worker.docker_config), '--host', 'unix:///var/run/docker.sock', *command],
                              capture_output=True, text=True, timeout=30, check=check, env=environment)

    try:
        probe = ('import json,os,pathlib,socket\n'
                 's=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)\n'
                 'try:\n s.connect(' + repr(str(fleet_socket)) + '); connected=True\n'
                 'except OSError:\n connected=False\n'
                 'finally:\n s.close()\n'
                 'print(json.dumps({"uid":os.getuid(),"container":pathlib.Path("/.dockerenv").exists(),'
                 '"host_canary":pathlib.Path(' + repr(str(canary)) + ').exists(),'
                 '"worker_state":pathlib.Path(' + repr(str(worker.root)) + ').exists(),'
                 '"docker_socket":pathlib.Path("/var/run/docker.sock").exists(),"fleet_socket":connected,'
                 '"host_env":bool(os.getenv("SPARKIE_WORKSPACE_PROOF_SECRET")),"proxy_env":bool(os.getenv("HTTP_PROXY") or os.getenv("http_proxy"))}))')
        result = json.loads(terminal.terminal_tool('python3 -c ' + shlex.quote(probe), task_id=task, timeout=60))
        (args.out / 'terminal.json').write_text(json.dumps(result, indent=2))
        assert result.get('exit_code') == 0, result.get('error', result)
        expected = {'uid': 12001, 'container': True, 'host_canary': False, 'worker_state': False,
                    'docker_socket': False, 'fleet_socket': False, 'host_env': False, 'proxy_env': False}
        assert json.loads(result['output'].strip()) == expected
        env = get_active_env(task)
        envs.append(env)
        lease = env.lease
        assert lease.spark_id == 'spark4'
        report['checks'].append('Actual native terminal acquires a durable workspace and runs non-root without host/fleet credentials or proxy leakage')
        assert mutations == {'create': 1, 'start': 1, 'volume_create': 2}
        code = 'def answer():\n    return 41\n'
        assert not json.loads(write_file_tool('/workspace/candidate/app.py', code, task_id=task)).get('error')
        assert not json.loads(patch_tool(path='/workspace/candidate/app.py', old_string='return 41', new_string='return 42', task_id=task)).get('error')
        assert 'return 42' in json.dumps(json.loads(read_file_tool('/workspace/candidate/app.py', task_id=task)))
        check = json.loads(terminal.terminal_tool("python3 -c " + shlex.quote("import runpy; assert runpy.run_path('/workspace/candidate/app.py')['answer']() == 42; print('coding check passed')"), task_id=task, timeout=30))
        assert check.get('exit_code') == 0 and 'coding check passed' in check['output']
        python = json.loads(execute_code("import runpy\nanswer = runpy.run_path('/workspace/candidate/app.py')['answer']()\nprint(answer)", task_id=task, enabled_tools=[]))
        assert python.get('status') == 'success' and python['output'].strip() == '42'
        (args.out / 'python.json').write_text(json.dumps(python, indent=2))
        again = json.loads(execute_code('print(answer)', task_id=task, enabled_tools=[]))
        assert again.get('status') == 'success' and again['output'].strip() == '42'
        stream = streams.open_stream(env, ['python3', '-u', '-c', 'import sys; print(sys.stdin.readline().strip().upper())'])
        output, _ = stream.communicate(input=b'allocated-workspace\n', timeout=15)
        assert stream.returncode == 0 and output.strip() == b'ALLOCATED-WORKSPACE'
        artifact = args.out / 'app.py'
        env.fetch_file('/workspace/candidate/app.py', artifact, max_bytes=1024)
        expected_source = code.replace('41', '42')
        assert artifact.read_text() == expected_source
        report['checks'].append('Native write/read/patch, coding check, persistent Python, bidirectional streams and bounded artifact fetch use the same allocated volume')
        job = env.execute('python3 -c ' + shlex.quote("import subprocess; print(subprocess.Popen(['sleep','300'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True).pid)"))
        pid = int(job['output'].strip())
        cleanup_vm(task)
        env._sync_manager = None
        assert docker('exec', lease.container_id, 'kill', '-0', str(pid)).returncode == 0
        assert leases.idle(scope, lease).state == 'running'
        assert leases.get(scope, lease.request.task_id).resources_held
        report['checks'].append('Native connection cleanup leaves detached work observed running; reservation remains held')
        config = {'container_cpu': lease.request.cpu, 'container_memory': lease.request.memory_mb,
                  'container_disk': lease.request.disk_mb, 'container_persistent': True}
        reconnected = provider.create_environment(cwd='/workspace', timeout=30, task_id=lease.request.task_id, container_config=config)
        envs.append(reconnected)
        assert reconnected.lease == lease and mutations['create'] == 1
        assert reconnected.execute('cat /workspace/candidate/app.py')['output'].rstrip('\n') == expected_source.rstrip('\n')
        reconnected.cleanup()
        reconnected._sync_manager = None
        # This explicit stop affects only the synthetic fixture, never a real
        # owner workload or the automatic power/idle policy.
        current = json.loads(docker('inspect', lease.container_id).stdout)[0]
        assert current['Config']['Labels'][LABEL] == lease.workspace_id
        docker('stop', '--time', '2', lease.container_id)
        assert leases.idle(scope, lease).state == 'stopped'
        assert leases.reservations()['spark4'] == ResourceBudget(0, 0, lease.request.disk_mb)
        resumed = provider.create_environment(cwd='/workspace', timeout=30, task_id=lease.request.task_id, container_config=config)
        envs.append(resumed)
        assert resumed.lease == lease and mutations == {'create': 1, 'start': 2, 'volume_create': 2}
        build_path = '/opt/sparkie/releases/workspace-fixture'
        result = resumed.execute('set -eu; test "$(id -u)" = 12001; mkdir -p '+build_path+
            '; printf checked > '+build_path+'/seal; test /workspace/releases/workspace-fixture/seal -ef '+
            build_path+'/seal; test "$(realpath '+build_path+')" = '+build_path)
        assert result['returncode'] == 0, result
        report['checks'].append('Unprivileged final release path and workspace share only the enrolled private volume')
        assert resumed.execute('sha256sum /workspace/candidate/app.py')['output'].split()[0] == hashlib.sha256(expected_source.encode()).hexdigest()
        assert worker.observe(leases.get(scope, lease.request.task_id)).state == 'ready'
        report['checks'].append('Observed stop releases CPU/RAM but retains disk; resume reuses exact container, volumes, endpoint and host key with project content intact')
        inspected = json.loads(docker('inspect', lease.container_id).stdout)[0]
        report['runtime'] = {'image_id': inspected['Image'], 'user': inspected['Config']['User'],
                             'cpu_nanos': inspected['HostConfig']['NanoCpus'], 'memory_bytes': inspected['HostConfig']['Memory'],
                             'host_mounts': [], 'bind_host': '127.0.0.1', 'workspace_id': lease.workspace_id}
        report['mutations'] = mutations
        report['passed'] = True
    except Exception as exc:
        report['passed'] = False
        report['error'] = str(exc).replace(sentinel, '[synthetic canary]')
    finally:
        for env in envs:
            try:
                env.cleanup()
                env._sync_manager = None
            except Exception:
                pass
        try:
            cleanup_vm(task)
        except Exception:
            pass
        try:
            with store._db() as db:
                allocations = [WorkspaceLeases._decode(row) for row in db.execute('SELECT * FROM workspace_leases WHERE scope=?', (scope,))]
            for allocation in allocations:
                labels = worker._labels(allocation)
                ids = docker('ps', '-aq', '--no-trunc', '--filter', 'label=' + LABEL + '=' + allocation.allocation_id).stdout.split()
                for container in ids:
                    inspected = json.loads(docker('inspect', container).stdout)[0]
                    assert all(inspected['Config']['Labels'].get(key) == value for key, value in labels.items())
                    docker('rm', '-f', container)
                names = docker('volume', 'ls', '-q', '--filter', 'label=' + LABEL + '=' + allocation.allocation_id).stdout.split()
                assert set(names).issubset(set(worker._paths(allocation)[2]))
                for name in names:
                    volume = json.loads(docker('volume', 'inspect', name).stdout)[0]
                    assert all(volume['Labels'].get(key) == value for key, value in labels.items())
                    docker('volume', 'rm', name)
                assert not docker('ps', '-aq', '--filter', 'label=' + LABEL + '=' + allocation.allocation_id).stdout.strip()
                assert not docker('volume', 'ls', '-q', '--filter', 'label=' + LABEL + '=' + allocation.allocation_id).stdout.strip()
            report['fixture_objects_removed'] = True
        except Exception as exc:
            report['fixture_objects_removed'] = False
            report['cleanup_error'] = str(exc).replace(sentinel, '[synthetic canary]')
            report['passed'] = False
        sock.close()
        if report.get('fixture_objects_removed'):
            shutil.rmtree(private)
            report['synthetic_private_files_removed'] = True
        report['elapsed_seconds'] = round(time.monotonic() - started, 3)
        report['limitations'] = ['Local-loopback qualification only; cross-Spark transport and production admission remain disconnected.',
                                 'No automatic idle stop, wake, GPU, disk quota, live deployment or model-behavior qualification.']
        (args.out / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report))
    return 0 if report.get('passed') else 1


if __name__ == '__main__':
    raise SystemExit(main())
