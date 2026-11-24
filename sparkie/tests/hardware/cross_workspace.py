"""Disposable Spark 2 controller -> Spark 4 workspace via native Hermes tools.

Uses existing SSH access only. No live service, host SSH, account, firewall,
power, bot or model changes. Cleanup is restricted to this run's labelled data.
"""
import argparse
from dataclasses import asdict
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import socket
import subprocess
import threading
import time
import uuid
import zipfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--image', required=True)
    parser.add_argument('--worker-interface', required=True, help='Verified interface on Spark 4 that owns the enrolled private address.')
    parser.add_argument('--hub-machine-id-file', type=Path, required=True)
    parser.add_argument('--compute-machine-id-file', type=Path, required=True)
    parser.add_argument('--power-config', type=Path, help='Explicit private physical-test profile; absent means zero power actions')
    args = parser.parse_args()
    if socket.gethostname() != 'compute2-host.invalid':
        parser.error('This cross-Spark fixture runs only from the verified Spark 2.')
    args.out.mkdir(parents=True, mode=0o700, exist_ok=False)
    nonce, start = uuid.uuid4().hex, time.monotonic()
    remote_host = 'compute4-endpoint.invalid'
    remote_root = '/home/exampleuser/work/sparkie-cross-proof-' + nonce
    source = Path(__file__).resolve().parents[2]
    home, private = args.out / 'hermes-home', args.out / 'private'
    home.mkdir(mode=0o700)
    private.mkdir(mode=0o700)
    socket_root = Path('/tmp/sparkie-cross-' + nonce[:12])
    socket_root.mkdir(mode=0o700)
    socket_path = socket_root / 'fleet.sock'
    ssh = ['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
           '-o', 'ConnectTimeout=5', 'exampleuser@' + remote_host]

    def remote(code, *, check=True):
        return subprocess.run(ssh + ['python3 -I -c ' + shlex.quote(code)], capture_output=True,
                              text=True, timeout=45, check=check)

    def upload(path, name):
        subprocess.run(['scp', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
                        '-o', 'ConnectTimeout=5', str(path), 'exampleuser@' + remote_host + ':' + remote_root + '/' + name],
                       capture_output=True, text=True, timeout=30, check=True)

    from sparkie_sparks.authority import OwnerBinding
    from sparkie_sparks.broker import FleetServer
    from sparkie_sparks.controls import Controls
    from sparkie_sparks.operations import OperationStore
    from sparkie_sparks.workspace_service import ComputeService
    from sparkie_sparks.workspace_types import ComputeNode
    from sparkie_sparks.workspace_leases import ResourceBudget

    node = ComputeNode('spark4', args.compute_machine_id_file.read_text().strip(), remote_host)
    hub = args.hub_machine_id_file.read_text().strip()
    identity = remote('import pathlib,socket,json; print(json.dumps({"host":socket.gethostname(),"id":pathlib.Path("/etc/machine-id").read_text().strip()}))')
    assert json.loads(identity.stdout) == {'host': 'compute4-host.invalid', 'id': node.machine_id}
    remote('from pathlib import Path; Path(' + repr(remote_root) + ').mkdir(mode=0o700)')
    archive = private / 'worker.pyz'
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as bundle:
        for path in sorted((source / 'src/sparkie_sparks').glob('*.py')):
            bundle.write(path, 'sparkie_sparks/' + path.name)
        bundle.writestr('__main__.py', 'from sparkie_sparks.workspace_remote import main\nraise SystemExit(main())\n')
    worker_config = {'schema': 1, 'controller': nonce, 'node': asdict(node), 'hub_machine_id': hub,
        'interface': args.worker_interface, 'image_id': args.image, 'state_dir': remote_root + '/state',
        'maximum': {'cpu': 2, 'memory_mb': 8192, 'disk_mb': 16384}}
    config_path = private / 'worker.json'
    config_path.write_text(json.dumps(worker_config))
    config_path.chmod(0o600)
    upload(archive, 'worker.pyz')
    upload(config_path, 'worker.json')
    compute_config = {'schema': 1, 'scope': 'cross-proof:' + nonce, 'controller': nonce,
        'hub_machine_id': hub, 'image': args.image, 'credentials_dir': str(private / 'sandbox-keys'),
        'nodes': [{'identity': asdict(node), 'budget': {'cpu': 2, 'memory_mb': 8192, 'disk_mb': 16384},
                  'user': 'exampleuser', 'executable': remote_root + '/worker.pyz', 'config': remote_root + '/worker.json'}]}
    store = OperationStore(private / 'operations.sqlite')
    binding = OwnerBinding('fixture-generation', 'fixture-owner', 'fixture-provider', 'fixture-issuer', 12, 12)
    controls = Controls(store, binding=lambda: binding, dispatch=lambda *a: None, observe=lambda *a: 'unknown')
    power_check = None
    if args.power_config:
        from power_cycle import PowerQualification
        power_check = PowerQualification(args.power_config, store, binding, node, args.out)
        # Stage the fixture while awake; the first admitted native operation must
        # then prove the actual requested-work wake path from verified plug off.
        power_check.sleep_before_work()
        controls = power_check.controls
    service = ComputeService(store, compute_config,
                             ensure_awake=power_check.ensure_awake if power_check else None)
    server = FleetServer(socket_path, controls, gateway_uid=os.getuid(), workspaces=service)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    config = {'terminal': {'backend': 'spark_compute', 'cwd': '/workspace', 'credential_files': [],
              'env_passthrough': [], 'container_cpu': 1, 'container_memory': 4096, 'container_disk': 8192},
              'plugins': {'enabled': ['sparkie-sparks']},
              'telemetry': {'shared_metrics': {'enabled': False, 'send': False}}}
    (home / 'config.yaml').write_text(json.dumps(config))
    shutil.copytree(source / 'plugin', home / 'plugins/sparkie-sparks')
    os.environ.update(HERMES_HOME=str(home), HERMES_DISABLE_LAZY_INSTALLS='1',
        SPARKIE_CONTROL_SOCKET=str(socket_path), TERMINAL_ENV='spark_compute', TERMINAL_CWD='/workspace',
        TERMINAL_CONTAINER_CPU='1', TERMINAL_CONTAINER_MEMORY='4096', TERMINAL_CONTAINER_DISK='8192')
    from hermes_cli.plugins import PluginManager
    from tools import terminal_tool as terminal
    from tools.terminal_tool_lifecycle import cleanup_vm, get_active_env
    from tools.file_tools import read_file_tool, write_file_tool, patch_tool
    from tools.code_execution_tool import execute_code
    from tools.environments import streams
    manager = PluginManager(scope_key=str(home))
    manager.discover_and_load()
    task = 'cross-native:' + nonce
    sends = []
    actual_runner = service.workers['spark4'].runner

    def lost_first_reply(command, **kwargs):
        payload = json.loads(kwargs['input'])
        result = actual_runner(command, **kwargs)
        if payload['method'] == 'provision':
            sends.append(payload['allocation']['operation_id'])
            if len(sends) == 1 and result.returncode == 0:
                raise subprocess.TimeoutExpired(command, kwargs['timeout'])
        return result

    service.workers['spark4'].runner = lost_first_reply
    report = {'scope': 'Actual Spark 2 native Hermes -> private broker -> existing SSH -> Spark 4 container.',
              'checks': [], 'passed': False, 'host': socket.gethostname(), 'hermes': 'v0.23.2'}
    lease = None
    environments = []
    try:
        probe = json.loads(terminal.terminal_tool("python3 -c " + shlex.quote(
            "import os,pathlib,json; print(json.dumps({'uid':os.getuid(),'container':pathlib.Path('/.dockerenv').exists(),'docker':pathlib.Path('/var/run/docker.sock').exists()}))"),
            task_id=task, timeout=60))
        assert probe.get('exit_code') == 0, probe
        assert json.loads(probe['output'].strip()) == {'uid': 12001, 'container': True, 'docker': False}
        env = get_active_env(task)
        environments.append(env)
        lease = env.lease
        assert lease.host == remote_host and lease.machine_id == node.machine_id and lease.spark_id == 'spark4'
        assert len(sends) == 1
        report['checks'].append('Native terminal crossed Sparks with pinned sandbox identity; lost provisioning reply reconciled after exactly one dispatch')
        assert not json.loads(write_file_tool('/workspace/proof/app.py', 'answer = 41\n', task_id=task)).get('error')
        assert not json.loads(patch_tool(path='/workspace/proof/app.py', old_string='41', new_string='42', task_id=task)).get('error')
        assert 'answer = 42' in json.dumps(json.loads(read_file_tool('/workspace/proof/app.py', task_id=task)))
        python = json.loads(execute_code("import runpy\nanswer=runpy.run_path('/workspace/proof/app.py')['answer']\nprint(answer)", task_id=task, enabled_tools=[]))
        assert python.get('status') == 'success' and python['output'].strip() == '42'
        stream = streams.open_stream(env, ['python3', '-u', '-c', 'import sys; print(sys.stdin.readline().strip().upper())'])
        output, _ = stream.communicate(input=b'cross-spark\n', timeout=15)
        assert stream.returncode == 0 and output.strip() == b'CROSS-SPARK'
        env.fetch_file('/workspace/proof/app.py', args.out / 'app.py', max_bytes=1024)
        assert (args.out / 'app.py').read_text() == 'answer = 42\n'
        report['checks'].append('Native files, patch, Python, bidirectional streams and bounded artifact fetching use the actual remote workspace')
        job = env.execute("python3 -c " + shlex.quote("import subprocess; print(subprocess.Popen(['sleep','300'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True).pid)"))
        pid = int(job['output'].strip())
        cleanup_vm(task)
        env._sync_manager = None
        assert service.leases.idle(service.scope, lease).state == 'running'
        assert service.leases.get(service.scope, lease.request.task_id).resources_held
        report['checks'].append('Native cleanup leaves detached work protected and keeps the resource reservation')
        server.shutdown(); server.server_close(); thread.join(timeout=5)
        service = ComputeService(store, compute_config,
                                 ensure_awake=power_check.ensure_awake if power_check else None)
        server = FleetServer(socket_path, controls, gateway_uid=os.getuid(), workspaces=service)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        result = json.loads(terminal.terminal_tool('cat /workspace/proof/app.py', task_id=task, timeout=30))
        assert result.get('exit_code') == 0 and result['output'].strip() == 'answer = 42'
        resumed = get_active_env(task)
        environments.append(resumed)
        assert resumed.lease == lease
        assert resumed.execute('kill -0 ' + str(pid))['returncode'] == 0
        with store._db() as db:
            assert db.execute('SELECT count(*) FROM workspace_leases').fetchone()[0] == 1
        report['checks'].append('Private broker restart and native reconnect preserve exact container, host key, lease and saved project')
        report['passed'] = True
    except Exception as exc:
        report['error'] = str(exc)[:1800]
    finally:
        for env in environments:
            try:
                env.cleanup(); env._sync_manager = None
            except Exception:
                pass
        try:
            cleanup_vm(task)
        except Exception:
            pass
        server.shutdown(); server.server_close(); thread.join(timeout=5)
        # Only this nonce's scope labels authorize synthetic cleanup.
        with store._db() as db:
            ids = [row[0] for row in db.execute('SELECT allocation_id FROM workspace_leases WHERE scope=?', (service.scope,))]
        code = '''import json,pathlib,shutil,subprocess
def docker(*args):
 return subprocess.check_output(['docker','--host','unix:///var/run/docker.sock',*args],text=True).strip()
for allocation in IDS:
 expected='sparkie.workspace='+allocation
 for container in docker('ps','-aq','--no-trunc','--filter','label='+expected).split():
  item=json.loads(docker('inspect',container))[0]
  assert item['Config']['Labels']['sparkie.workspace']==allocation
  docker('rm','-f',container)
 for volume in docker('volume','ls','-q','--filter','label='+expected).split():
  item=json.loads(docker('volume','inspect',volume))[0]
  assert item['Labels']['sparkie.workspace']==allocation
  docker('volume','rm',volume)
 assert not docker('ps','-aq','--filter','label='+expected)
 assert not docker('volume','ls','-q','--filter','label='+expected)
shutil.rmtree(ROOT)
print(json.dumps({'removed':True}))
'''.replace('IDS', repr(ids)).replace('ROOT', repr(remote_root))
        try:
            report['fixture_objects_removed'] = json.loads(remote(code).stdout)['removed']
            shutil.rmtree(private)
            shutil.rmtree(socket_root)
        except Exception:
            report['fixture_objects_removed'] = False
            report['passed'] = False
        report['elapsed_seconds'] = round(time.monotonic() - start, 3)
        report['provision_dispatches'] = len(sends)
        report['limitations'] = ['No production sign-in/bot, GPU workload or live update qualification.']
        if power_check:
            report['physical_power'] = {'spark':'spark4','sleep_operation':power_check.operation,
                'wake_receipts':sorted(power_check.wake_receipts), 'commands':power_check.sent}
        else:
            report['limitations'].append('No physical power qualification.')
        (args.out / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
