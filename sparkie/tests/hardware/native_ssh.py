"""Real native Hermes tools through SSH into a disposable compute container.

This does not install SSH on a Spark or change any host account/credential. The
only listener is the container's high port, published on host loopback. All keys,
volumes, files and work are synthetic fixtures. The maintained native execution,
sync, Python and stream implementation is reused without a command RPC layer.
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
    parser.add_argument('--image', required=True, help='Digest or ID of the isolated ssh-sandbox.Dockerfile build.')
    args = parser.parse_args()
    if socket.gethostname() not in ('compute4-host.invalid', 'compute2-host.invalid', 'compute3-host.invalid'):
        parser.error('Run this fixture only on a verified compute Spark.')
    args.out.mkdir(parents=True, mode=0o700, exist_ok=False)
    nonce = uuid.uuid4().hex
    label, alias = 'sparkie.ssh-proof=' + nonce, 'sparkie-workspace-' + nonce
    home, private = args.out / 'hermes-home', args.out / 'private'
    home.mkdir(mode=0o700)
    private.mkdir(mode=0o700)
    for name in ('client', 'host', 'wrong'):
        subprocess.run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-C', 'fixture-only',
                        '-f', str(private / name)], check=True)
    host_key = ' '.join((private / 'host.pub').read_text().split()[:2])
    hosts = private / 'known_hosts'
    hosts.write_text(alias + ' ' + host_key + '\n')
    hosts.chmod(0o600)
    sentinel = 'synthetic-host-canary-' + nonce
    canary = private / 'fleet-credential.txt'
    canary.write_text(sentinel)
    canary.chmod(0o600)
    fleet_socket = private / 'fleet.sock'
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.bind(str(fleet_socket))
    sock.listen(1)
    skill = home / 'skills' / 'ssh-proof'
    skill.mkdir(parents=True)
    (skill / 'SKILL.md').write_text('---\nname: ssh-proof\ndescription: Synthetic fixture.\n---\nFixture skill marker.\n')
    (home / '.env').write_text('SPARKIE_SSH_TEST_SECRET=' + sentinel + '\n')
    (home / '.env').chmod(0o600)
    (home / 'config.yaml').write_text(
        'terminal:\n  backend: spark_compute\n  cwd: /workspace\n  credential_files: []\n'
        '  container_cpu: 1\n  container_memory: 4096\n'
        '  env_passthrough: []\nplugins:\n  isolation: in_process\n'
        'telemetry:\n  shared_metrics:\n    enabled: false\n    send: false\n')
    os.environ.update(HERMES_HOME=str(home), HERMES_DISABLE_LAZY_INSTALLS='1',
                      TERMINAL_ENV='spark_compute', TERMINAL_CWD='/workspace',
                      SPARKIE_SSH_TEST_SECRET=sentinel)
    from hermes_cli.plugins import PluginContext, PluginManager, PluginManifest
    from sparkie_sparks.sandbox_ssh import PinnedSandboxSSH
    from sparkie_sparks.sandbox_provider import ComputeNode, SparkComputeProvider, WorkspaceLease, IdleObservation
    from tools import terminal_tool as terminal
    from tools.terminal_tool_lifecycle import cleanup_vm
    from tools.file_tools import read_file_tool, write_file_tool, patch_tool
    from tools.code_execution_tool import execute_code
    from tools.environments import streams
    from tools.terminal_tool_backends import _create_environment

    def docker(*command, input=None, timeout=45, check=True):
        return subprocess.run(['docker', *command], input=input, capture_output=True, text=True,
                              timeout=timeout, check=check)

    report = {'scope': 'Native SSH tools into a disposable local-loopback compute container; no real fleet SSH or application install.',
              'host': socket.gethostname(), 'hermes': 'v0.23.2', 'checks': [],
              'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    container, volumes, envs, tasks = None, [], [], []
    started = time.monotonic()
    try:
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', 0))
            port = reservation.getsockname()[1]
        # Explicit fixed port across this fixture's restart. A racing bind makes
        # docker run fail; it never selects another endpoint silently.
        for suffix in ('home', 'workspace'):
            volume = 'sparkie-ssh-proof-' + nonce + '-' + suffix
            docker('volume', 'create', '--label', label, volume)
            volumes.append(volume)
        container = docker('run', '-d', '--name', 'sparkie-ssh-proof-' + nonce, '--label', label,
            '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
            '--cpus', '1', '--memory', '4g', '--pids-limit', '128',
            '--tmpfs', '/run:rw,noexec,nosuid,size=16m,uid=12001,gid=12001,mode=0700',
            '--tmpfs', '/tmp:rw,nosuid,size=512m,mode=1777',
            '--mount', 'type=volume,src=' + volumes[0] + ',dst=/home/sandbox',
            '--mount', 'type=volume,src=' + volumes[1] + ',dst=/workspace',
            '-p', '127.0.0.1:' + str(port) + ':2222', args.image).stdout.strip()
        assert len(container) == 64

        def start_server():
            docker('exec', container, 'mkdir', '-p', '/run/ssh', '/run/sshd')
            config = ('Port 2222\nListenAddress 0.0.0.0\nHostKey /run/ssh/host_key\n'
                      'AuthorizedKeysFile /run/ssh/authorized_keys\nPidFile /run/ssh/sshd.pid\n'
                      'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPubkeyAuthentication yes\n'
                      'AuthenticationMethods publickey\nPermitRootLogin no\nUsePAM no\nAllowUsers sandbox\n'
                      'AllowTcpForwarding no\nAllowAgentForwarding no\nX11Forwarding no\nPermitTunnel no\n'
                      'PermitUserEnvironment no\nStrictModes yes\nSubsystem sftp internal-sftp\n')
            for name, value in [('host_key', (private / 'host').read_text()),
                                ('authorized_keys', 'restrict ' + (private / 'client.pub').read_text()),
                                ('sshd_config', config)]:
                docker('exec', '-i', container, 'sh', '-c', 'umask 077; cat > /run/ssh/' + name, input=value)
            docker('exec', '-d', container, '/usr/sbin/sshd', '-D', '-e', '-E', '/tmp/sshd.log', '-f', '/run/ssh/sshd_config')

        start_server()
        inspected = json.loads(docker('inspect', container).stdout)[0]
        binding = inspected['NetworkSettings']['Ports']['2222/tcp']
        assert len(binding) == 1 and binding[0]['HostIp'] == '127.0.0.1'
        assert int(binding[0]['HostPort']) == port
        options = dict(host='127.0.0.1', user='sandbox', port=port, key_path=str(private / 'client'),
                       known_hosts=str(hosts), host_key_alias=alias, expected_host_key=host_key)
        def wait_server():
            deadline = time.monotonic() + 8
            while True:
                try:
                    with socket.create_connection(('127.0.0.1', port), timeout=1) as channel:
                        assert channel.recv(256).startswith(b'SSH-')
                    return
                except (OSError, AssertionError):
                    if time.monotonic() >= deadline:
                        raise RuntimeError('The isolated SSH server did not start: ' + docker('exec', container, 'cat', '/tmp/sshd.log').stdout)
                    time.sleep(0.1)
        wait_server()

        allocations, idle_calls, detached = [], [], {}
        machine_id = Path('/etc/machine-id').read_text().strip()

        def acquire(request):
            actual = json.loads(docker('inspect', container).stdout)[0]
            assert actual['Id'] == container and actual['Image'] == args.image
            assert actual['Config']['Labels']['sparkie.ssh-proof'] == nonce
            allocations.append(request)
            return WorkspaceLease(request, nonce, 'spark4', machine_id, '127.0.0.1', port,
                                  'sandbox', container, actual['Image'], str(private / 'client'),
                                  str(hosts), alias, host_key)

        def idle(lease):
            assert lease.container_id == container
            idle_calls.append(lease.workspace_id)
            running = detached.get('pid') and docker('exec', container, 'kill', '-0', str(detached['pid']), check=False).returncode == 0
            return IdleObservation('running' if running else 'unknown', 'fixture-idle-' + nonce)

        provider = SparkComputeProvider(nodes=[ComputeNode('spark4', machine_id, '127.0.0.1')],
                                        hub_machine_id='0' * 32, image=args.image, acquire=acquire, idle=idle)
        context = PluginContext(PluginManifest(name='sparkie-ssh-fixture'), PluginManager(scope_key=str(home)))
        assert context.register_terminal_environment_provider(provider) is not None
        task = 'sparkie-ssh-proof-' + nonce
        tasks.append(task)
        probe = ('import json,os,pathlib,socket\n'
                 's=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)\n'
                 'try:\n s.connect(' + repr(str(fleet_socket)) + '); connected=True\n'
                 'except OSError:\n connected=False\n'
                 'finally:\n s.close()\n'
                 'print(json.dumps({"uid":os.getuid(),"container":pathlib.Path("/.dockerenv").exists(),'
                 '"host_canary":pathlib.Path(' + repr(str(canary)) + ').exists(),'
                 '"client_key":pathlib.Path(' + repr(str(private / "client")) + ').exists(),'
                 '"docker_socket":pathlib.Path("/var/run/docker.sock").exists(),'
                 '"fleet_socket":connected,"host_env":bool(os.getenv("SPARKIE_SSH_TEST_SECRET"))}))')
        native = json.loads(terminal.terminal_tool('python3 -c ' + shlex.quote(probe), task_id=task, timeout=45))
        (args.out / 'terminal.json').write_text(json.dumps(native, indent=2))
        assert native.get('exit_code') == 0, native
        observed = json.loads(native['output'].strip())
        assert observed == {'uid': 12001, 'container': True, 'host_canary': False, 'client_key': False,
                            'docker_socket': False, 'fleet_socket': False, 'host_env': False}, observed
        report['checks'].append('Native terminal runs as a non-root container user without host credentials, keys, Docker or fleet socket')
        env = terminal._active_environments[terminal._resolve_container_task_id(task)]
        envs.append(env)
        assert len(allocations) == 1 and env._hermes_backend_name == 'spark_compute'
        assert env.lease.container_id == container and env.lease.spark_id == 'spark4'
        report['checks'].append('Actual SparkComputeProvider registers through PluginContext and the native factory uses its exact compute lease')
        synced = env.execute('cat /home/sandbox/.hermes/skills/ssh-proof/SKILL.md', timeout=15)
        assert 'Fixture skill marker.' in synced['output'], synced
        report['checks'].append('Native SSH file sync transfers the synthetic skill without a host mount')
        written = json.loads(write_file_tool('/workspace/proof.txt', 'native file v1\n', task_id=task))
        assert not written.get('error'), written
        assert 'native file v1' in json.dumps(json.loads(read_file_tool('/workspace/proof.txt', task_id=task)))
        patched = json.loads(patch_tool(path='/workspace/proof.txt', old_string='v1', new_string='v2', task_id=task))
        assert not patched.get('error'), patched
        forbidden = json.loads(read_file_tool(str(canary), task_id=task))
        assert forbidden.get('error') and sentinel not in json.dumps(forbidden)
        code = json.loads(execute_code(probe + '\nsparkie_persisted = 40 + 2', task_id=task, enabled_tools=[]))
        (args.out / 'python.json').write_text(json.dumps(code, indent=2))
        assert code.get('status') == 'success' and code.get('tool_calls_made') == 0, code
        assert json.loads(code['output'].strip()) == observed, code
        again = json.loads(execute_code('print(sparkie_persisted)', task_id=task, enabled_tools=[]))
        assert again.get('status') == 'success' and again['output'].strip() == '42', again
        report['checks'].append('Native read/write/patch and persistent execute_code use the same remote container')
        stream = streams.open_stream(env, ['python3', '-u', '-c', 'import sys; print(sys.stdin.readline().strip().upper())'])
        output, _ = stream.communicate(input=b'native-stream\n', timeout=15)
        assert stream.returncode == 0 and output.strip() == b'NATIVE-STREAM'
        fetched = args.out / 'artifact.txt'
        assert env.fetch_realpath('/workspace/proof.txt') == '/workspace/proof.txt'
        env.fetch_file('/workspace/proof.txt', fetched, max_bytes=1024)
        assert fetched.read_text() == 'native file v2\n'
        report['checks'].append('Native bidirectional process streams and bounded artifact fetch work')
        wrong_key = ' '.join((private / 'wrong.pub').read_text().split()[:2])
        wrong_hosts = private / 'wrong_known_hosts'
        wrong_hosts.write_text(alias + ' ' + wrong_key + '\n')
        wrong_hosts.chmod(0o600)
        for change in ({'known_hosts': str(wrong_hosts), 'expected_host_key': wrong_key},
                       {'key_path': str(private / 'wrong')}):
            try:
                PinnedSandboxSSH(**(options | change), probe_only=True)
            except Exception:
                pass
            else:
                raise AssertionError('Wrong sandbox identity was accepted')
        report['checks'].append('Changed server key and incorrect client key fail closed')
        job = env.execute("python3 -c " + shlex.quote(
            "import subprocess; p=subprocess.Popen(['sleep','300'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True); print(p.pid)"))
        pid = int(job['output'].strip())
        detached['pid'] = pid
        env.cleanup()
        assert not idle_calls, 'SSH cleanup must not release compute resources'
        report['cleanup_detached_job_still_running'] = docker('exec', container, 'kill', '-0', str(pid), check=False).returncode == 0
        assert report['cleanup_detached_job_still_running'], 'Native SSH cleanup behavior changed; review lifecycle policy'
        try:
            env.stop_idle()
        except RuntimeError as exc:
            assert 'resources remain held' in str(exc)
        else:
            raise AssertionError('Provider claimed an idle stop while detached work remained')
        assert env.idle_observation.state == 'running' and idle_calls == [nonce]
        assert docker('exec', container, 'kill', '-0', str(pid), check=False).returncode == 0
        report['checks'].append('Native cleanup never releases the lease; observed detached work blocks idle stop without a success claim')
        docker('exec', container, 'kill', '-TERM', str(pid))
        report['limitations'] = ['Native SSH cleanup closes its connections; a detached job can remain. Power/idle policy must observe jobs separately.',
                                 'The server host key belongs to this disposable non-root sandbox; it grants no host or fleet authority.',
                                 'This loopback proof does not qualify cross-Spark routing, wake/placement, browser desktop or a production allocator.']
        docker('restart', container)
        start_server()
        wait_server()
        restored_ports = json.loads(docker('inspect', container).stdout)[0]['NetworkSettings']['Ports']['2222/tcp']
        assert restored_ports == binding, 'Restart changed the saved sandbox endpoint'
        recovered = _create_environment('spark_compute', args.image, '/workspace', 30,
            task_id=env.lease.request.task_id,
            container_config={'container_cpu': 1, 'container_memory': 4096, 'container_disk': 51200})
        envs.append(recovered)
        assert recovered.lease == env.lease and len(allocations) == 2
        result = recovered.execute('cat /workspace/proof.txt')
        assert result['output'].strip() == 'native file v2', result
        report['checks'].append('Restarting the isolated container preserves workspace files and exact host-key identity')
        actual = json.loads(docker('inspect', container).stdout)[0]
        runtime = actual['HostConfig']
        assert runtime['Privileged'] is False and runtime['NetworkMode'] != 'host'
        assert runtime['ReadonlyRootfs'] and runtime['CapDrop'] == ['ALL']
        assert runtime['Memory'] == 4 * 1024 ** 3 and runtime['NanoCpus'] == 1000000000
        assert any(option.startswith('no-new-privileges') for option in runtime['SecurityOpt'])
        assert actual['Config']['User'] == 'sandbox'
        assert all(mount['Type'] == 'volume' for mount in actual['Mounts'])
        report['runtime'] = {'image_id': actual['Image'], 'user': actual['Config']['User'],
                             'cpu_nanos': runtime['NanoCpus'], 'memory_bytes': runtime['Memory'],
                             'bind_host': '127.0.0.1', 'host_mounts': [], 'cap_drop': runtime['CapDrop'],
                             'read_only_root': runtime['ReadonlyRootfs'], 'security_opt': runtime['SecurityOpt']}
        report['checks'].append('Actual runtime has one CPU, 4 GiB, no host mounts, read-only root and dropped capabilities')
        report['passed'] = True
    except Exception as exc:
        report['passed'] = False
        report['error'] = str(exc).replace(sentinel, '[synthetic canary]')
        if container:
            report['server_log'] = docker('exec', container, 'cat', '/tmp/sshd.log', check=False).stdout[-5000:]
    finally:
        for env in envs:
            try:
                env.cleanup()
                # This fixture destroys the server next. Native cleanup already
                # synced; a later destructor must not try that retired endpoint.
                env._sync_manager = None
            except Exception:
                pass
        for task in tasks:
            try:
                cleanup_vm(terminal._resolve_container_task_id(task))
            except Exception:
                pass
        sock.close()
        fleet_socket.unlink(missing_ok=True)
        if container:
            labels = json.loads(docker('inspect', '--format', '{{json .Config.Labels}}', container).stdout)
            assert labels.get('sparkie.ssh-proof') == nonce, 'Refuse cleanup of an unrelated container'
            docker('rm', '-f', container)
            report['container_removed'] = docker('inspect', container, check=False).returncode != 0
        for volume in volumes:
            info = json.loads(docker('volume', 'inspect', volume).stdout)[0]
            assert info['Labels'].get('sparkie.ssh-proof') == nonce
            docker('volume', 'rm', volume)
        report['fixture_volumes_removed'] = True
        report['elapsed_seconds'] = round(time.monotonic() - started, 3)
        (args.out / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report))
    return 0 if report.get('passed') and report.get('container_removed') else 1


if __name__ == '__main__':
    raise SystemExit(main())
