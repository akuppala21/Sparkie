"""Selected brain crash/restart/readiness plus one native self-work task on Spark 2.

Runs only a labelled disposable Docker instance; never installs a system unit,
uses the bot, accesses the live owner application or changes the model pins.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--weights', type=Path, required=True)
    parser.add_argument('--cache', type=Path, required=True)
    args = parser.parse_args()
    args.out = args.out.resolve()
    if socket.gethostname() != 'compute2-host.invalid':
        parser.error('This qualification is reserved for compute Spark 2')
    args.out.mkdir(parents=True, exist_ok=False)
    root = Path(__file__).resolve().parents[2]
    record = root / 'models/main-model.json'
    spec = importlib.util.spec_from_file_location('model_unit', root / 'deploy/model_unit.py')
    unit = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(unit)
    name = 'sparkie-brain-recovery-20261119'
    docker_config = args.out / 'docker-config'
    docker_config.mkdir(mode=0o700)
    argv = unit.command(record, weights=args.weights, cache=args.cache, name=name, attached=False,
                        docker_config=docker_config)
    assert not subprocess.check_output(['docker', 'ps', '-q'], text=True).strip()
    report = {'host': socket.gethostname(), 'started_at': datetime.now(timezone.utc).isoformat(),
              'scope': 'Fixed selected-model recipe, real container crash/restart and readiness; syntax check only for systemd unit; native self-work in isolated compute Docker.',
              'command': argv, 'record_sha256': hashlib.sha256(record.read_bytes()).hexdigest(),
              'model_unit_sha256': hashlib.sha256((root / 'deploy/model_unit.py').read_bytes()).hexdigest(),
              'eval_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    def save():
        (args.out / 'summary.json').write_text(json.dumps(report, indent=2) + '\n')
    container = None
    started = time.monotonic()
    save()
    try:
        report['preflight'] = unit.preflight(record, weights=args.weights, cache=args.cache, name=name)
        service = args.out / 'sparkie-brain.service'
        service.write_text(unit.render(record, weights=args.weights, cache=args.cache))
        syntax = subprocess.run(['systemd-analyze', 'verify', str(service)], capture_output=True, text=True, timeout=30)
        (args.out / 'unit-verification.txt').write_text(syntax.stdout + syntax.stderr)
        assert syntax.returncode == 0, syntax.stderr
        report['unit_syntax_verified'] = True
        container = subprocess.check_output(argv, env=unit.docker_environment(), text=True, timeout=90).strip()
        report['container'] = container
        report['initial_readiness'] = unit.wait_ready(record, name=name)
        save()
        print('Initial selected model ready; testing its isolated crash and restart.', flush=True)
        subprocess.run(['docker', 'kill', '--signal', 'KILL', container], check=True, capture_output=True, timeout=30)
        try:
            unit.wait_ready(record, name=name, timeout=1)
        except RuntimeError as exc:
            report['stopped_reported_unavailable'] = True
            report['stopped_message'] = str(exc)
        else:
            raise AssertionError('A crashed model must never report ready')
        subprocess.run(['docker', 'start', container], check=True, capture_output=True, timeout=30)
        report['recovery_readiness'] = unit.wait_ready(record, name=name)
        save()
        print('Selected model recovered; running one native self-work task.', flush=True)
        with (args.out / 'self-work.log').open('w') as log:
            result = subprocess.run([sys.executable, str(root / 'tests/behavior/self_work.py'),
                                     '--out', str(args.out / 'self-work')], env=dict(os.environ),
                                    stdout=log, stderr=subprocess.STDOUT, timeout=540)
        report['self_work_returncode'] = result.returncode
        report['passed'] = result.returncode == 0
    except Exception as exc:
        report.update(passed=False, error=str(exc))
    finally:
        if container:
            with (args.out / 'server.log').open('w') as log:
                subprocess.run(['docker', 'logs', container], stdout=log, stderr=subprocess.STDOUT, timeout=30)
            actual = json.loads(subprocess.check_output(['docker', 'inspect', container], text=True))[0]
            assert actual['Config']['Labels']['sparkie.model-manifest-sha256'] == report['record_sha256']
            report['cleanup_returncode'] = subprocess.run(['docker', 'rm', '-f', container], capture_output=True, timeout=45).returncode
        report['seconds'] = round(time.monotonic() - started, 3)
        report['finished_at'] = datetime.now(timezone.utc).isoformat()
        save()
        print(json.dumps(report), flush=True)
    return 0 if report.get('passed') and report.get('cleanup_returncode') == 0 else 1


if __name__ == '__main__':
    raise SystemExit(main())
