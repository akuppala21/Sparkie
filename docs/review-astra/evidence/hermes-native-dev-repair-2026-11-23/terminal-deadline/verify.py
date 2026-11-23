"""Exercise the evaluator deadline through the pinned Hermes Docker terminal on a compute Spark."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import uuid


def record(case, event, **details):
    with (case / 'events.jsonl').open('a') as stream:
        stream.write(json.dumps(dict(event=event, at=time.time(), **details)) + '\n')


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True, timeout=15).strip()


def inspect_owned(case):
    owned = {}
    for cid in docker('ps', '-aq', '--no-trunc', '--filter', 'label=hermes-agent=1').splitlines():
        row = json.loads(docker('inspect', cid))[0]
        if any(m['Type'] == 'bind' and Path(m['Source']).is_relative_to(case / 'home/sandboxes/docker')
               for m in row['Mounts']):
            owned[cid] = row
    return owned


def worker(release, case, duration):
    from native_docker_fixture import configure_compute_docker
    from ruamel.yaml import YAML

    home = case / 'home'
    home.mkdir(mode=0o700)
    os.environ.update(HERMES_HOME=str(home), HERMES_DISABLE_LAZY_INSTALLS='1', HF_HUB_OFFLINE='1',
                      HERMES_ENABLE_PROJECT_PLUGINS='0')
    configure_compute_docker(home, release / 'extension/config/hermes.example.yaml', network=False)
    cfg = home / 'config.yaml'
    yaml = YAML()
    config = yaml.load(cfg)
    config['terminal']['docker_persist_across_processes'] = False
    with cfg.open('w') as stream:
        yaml.dump(config, stream)
    from hermes_cli.config import apply_terminal_config_to_env, load_config_readonly
    from gateway.session_context import set_session_vars
    from tools.terminal_tool import terminal_tool
    from tools.terminal_tool_lifecycle import ensure_task_env

    def deny_network(event, _args):
        if event == 'socket.connect':
            raise PermissionError('The deadline control runs without a provider or network.')
    sys.addaudithook(deny_network)
    apply_terminal_config_to_env(config=load_config_readonly(), override=True)
    session = uuid.uuid4().hex
    set_session_vars(session_key=session, platform='cli')
    ensure_task_env(session)
    ((cid, row),) = inspect_owned(case).items()
    (case / 'owned-container').write_text(cid)
    assert row['HostConfig']['NetworkMode'] == 'none' and not row['HostConfig']['DeviceRequests']
    workspace = next(Path(m['Source']) for m in row['Mounts'] if m['Destination'] == '/workspace')
    marker = workspace / 'deadline-probe.done'
    # Observe a group interrupt while the native client waits, as in the incident.
    signal.signal(signal.SIGINT, lambda *_: record(case, 'SIGINT'))
    record(case, 'first_call', duration=duration)
    result = json.loads(terminal_tool(task_id=session, command=(
        f'echo CHECK_STARTED; sleep {duration}; echo done > /workspace/deadline-probe.done; echo CHECK_COMPLETE')))
    record(case, 'terminal_result', output=result.get('output'), code=result.get('exit_code'), marker=marker.exists())
    if 'CHECK_COMPLETE' not in result.get('output', ''):
        # A provider stand-in makes any continuation observable without model traffic.
        record(case, 'provider_continuation_stub')
        follow = json.loads(terminal_tool(command='echo FOLLOWUP', task_id=session))
        record(case, 'second_tool', output=follow.get('output'))
    until = time.monotonic() + duration + 2
    while not marker.exists() and time.monotonic() < until:
        time.sleep(0.1)
    assert marker.exists()
    record(case, 'container_marker', written_at=marker.stat().st_mtime)


def run_case(release, case, mode):
    case.mkdir()
    duration = 1 if mode == 'normal' else 9
    deadline = '20s' if mode == 'normal' else '6s'
    if mode == 'original':
        command = ['timeout', '--signal=INT', '--kill-after=15s', deadline]
    else:
        command = ['sh', str(Path(__file__).with_name('run-before-deadline.sh')), deadline]
    try:
        run = subprocess.run([*command, sys.executable, __file__, 'worker', str(release), str(case), str(duration)],
                             start_new_session=True, timeout=30)
        events = [json.loads(line) for line in (case / 'events.jsonl').read_text().splitlines()]
    finally:
        containers = inspect_owned(case)
        for cid in containers:
            assert cid in inspect_owned(case)
            docker('rm', '-f', cid)
        captured = (case / 'owned-container').read_text()
        assert not (set(containers) - {captured}) and not inspect_owned(case)
        assert not docker('ps', '-aq', '--no-trunc', '--filter', 'id=' + captured)
    tags = [row['event'] for row in events]
    result = next((row for row in events if row['event'] == 'terminal_result'), None)
    if mode == 'original':
        assert run.returncode == 124 and tags == [
            'first_call', 'SIGINT', 'terminal_result', 'provider_continuation_stub', 'second_tool', 'container_marker']
        assert result['code'] == 0 and result['output'] == 'CHECK_STARTED' and not result['marker']
        assert events[-1]['written_at'] > result['at']
    elif mode == 'hard':
        assert run.returncode in (-signal.SIGKILL, 137) and tags == ['first_call']
    else:
        assert run.returncode == 0 and tags == ['first_call', 'terminal_result', 'container_marker']
        assert result['code'] == 0 and result['output'].splitlines() == ['CHECK_STARTED', 'CHECK_COMPLETE']
        assert result['marker']
    return {'mode': mode, 'exit': run.returncode, 'events': events, 'captured_containers': 1,
            'outer_cleanup_removed': len(containers),
            'remaining_owned': 0, 'provider_http_requests': 0}


if __name__ == '__main__':
    mode, arg = sys.argv[1:3]
    release = Path(arg).resolve()
    sys.path[:0] = [str(release / 'extension/tests'), str(release / 'extension/src'), str(release / 'hermes')]
    if mode == 'worker':
        worker(release, Path(sys.argv[3]), int(sys.argv[4]))
    elif mode == 'verify':
        root = Path(tempfile.mkdtemp(prefix='sparkie-terminal-deadline-', dir=Path.cwd()))
        result = [run_case(release, root / name, name) for name in ('original', 'hard', 'normal')]
        (root / 'results.json').write_text(json.dumps(result, indent=2) + '\n')
        print(root / 'results.json', flush=True)
    else:
        raise SystemExit('Use verify RELEASE_DIRECTORY.')
