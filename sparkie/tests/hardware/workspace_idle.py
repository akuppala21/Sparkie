"""Disposable native SSH workspace idle/retire/resume proof on Spark 4 only.

No host power, privilege, network, live application or model changes.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
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
        parser.error('This fixture is restricted to Spark 4.')
    args.out.mkdir(mode=0o700, parents=True, exist_ok=False)
    os.environ['HERMES_HOME'] = str(args.out / 'hermes')
    from sparkie_sparks.operations import OperationStore
    from sparkie_sparks.sandbox_provider import SparkComputeProvider
    from sparkie_sparks.workspace_leases import ResourceBudget, WorkspaceLeases
    from sparkie_sparks.workspace_types import ComputeNode
    from sparkie_sparks.workspace_worker import DockerWorkspaceWorker, LABEL

    started, nonce = time.monotonic(), uuid.uuid4().hex
    scope, task = 'idle-proof:' + nonce, 'idle-task:' + nonce
    store = OperationStore(args.out / 'operations.sqlite')
    hub = args.hub_machine_id_file.read_text().strip()
    node = ComputeNode('spark4', Path('/etc/machine-id').read_text().strip(), '127.0.0.1')
    worker = DockerWorkspaceWorker(store, node=node, hub_machine_id=hub, image_id=args.image,
                                   state_dir=args.out / 'private')
    leases = WorkspaceLeases(store, nodes=[node], hub_machine_id=hub, image=args.image,
        budgets={'spark4': ResourceBudget(1, 1024, 8192)}, provision=worker.provision,
        observe=worker.observe, activity=worker.activity)
    provider = SparkComputeProvider(nodes=[node], hub_machine_id=hub, image=args.image,
        acquire=lambda request: leases.acquire(scope, request), idle=lambda lease: leases.idle(scope, lease))
    settings = {'container_cpu': 1, 'container_memory': 1024, 'container_disk': 4096, 'container_persistent': True}
    environments, report = [], {'checks': [], 'passed': False, 'host_power_actions': 0,
                                'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    def connect():
        env = provider.create_environment(cwd='/workspace', timeout=20, task_id=task, container_config=settings)
        environments.append(env)
        return env
    def close(env):
        env.cleanup()
        env._sync_manager = None
    def current():
        return leases.get(scope, task)
    try:
        env = connect()
        lease = env.lease
        assert env.execute("printf 'retained project\n' > /workspace/idle-proof.txt")['returncode'] == 0
        process = env.execute('python3 -c ' + shlex.quote(
            "import subprocess; print(subprocess.Popen(['sleep','90'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True).pid)"))
        pid = int(process['output'].strip())
        close(env)
        hint = leases.idle(scope, lease)
        assert worker.idle_activity(current()), 'Detached work was not protected'
        result = leases.retire(scope, task, hint.operation_id, activity=worker.idle_activity, stop=worker.retire)
        assert result.state == 'running' and current().resources_held
        report['checks'].append('Detached process remains running and reserved after native SSH cleanup')
        env = connect()
        assert env.execute('kill ' + str(pid))['returncode'] == 0
        close(env)
        hint = leases.idle(scope, lease)
        deadline = time.monotonic() + 8
        while worker.idle_activity(current()) != [] and time.monotonic() < deadline:
            time.sleep(.1)
        assert worker.idle_activity(current()) == [], 'Empty sandbox process state was not verified'
        result = leases.retire(scope, task, hint.operation_id, activity=worker.idle_activity, stop=worker.retire)
        assert result.state == 'stopped' and not current().resources_held
        assert leases.reservations()['spark4'] == ResourceBudget(0, 0, 4096)
        assert leases.retire(scope, task, hint.operation_id, activity=worker.idle_activity, stop=worker.retire) == result
        report['checks'].append('Released empty workspace stops once; exact stopped observation frees CPU/RAM and retains disk')
        env = connect()
        assert env.lease == lease
        assert env.execute('cat /workspace/idle-proof.txt')['output'].strip() == 'retained project'
        close(env)
        report['checks'].append('Native resume uses the same container, keys, port and retained project')
        report['passed'] = True
    except Exception as exc:
        report['error'] = str(exc)
    finally:
        for env in environments:
            try: close(env)
            except Exception: pass
        try:
            allocation = current()
            if allocation:
                ids, volumes = worker._objects(allocation)
                for container in ids:
                    row = json.loads(worker._docker('inspect', container))[0]
                    assert row['Config']['Labels'][LABEL] == allocation.allocation_id
                    worker._docker('rm', '-f', container)
                for volume in volumes:
                    assert volume in worker._paths(allocation)[2]
                    worker._docker('volume', 'rm', volume)
                assert worker._objects(allocation) == (set(), set())
            report['fixture_objects_removed'] = True
        except Exception as exc:
            report['fixture_objects_removed'] = False
            report['cleanup_error'] = str(exc)
            report['passed'] = False
        report['elapsed_seconds'] = round(time.monotonic() - started, 3)
        (args.out / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
