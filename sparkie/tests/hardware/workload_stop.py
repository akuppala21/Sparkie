"""Stop one disposable container through native owner-authenticated control routes.

Runs only on a compute Spark. It never touches existing containers or live app
state. The stand-in owner has no account or credentials outside this process.
"""
import argparse
import hashlib
import json
from pathlib import Path
import secrets
import socket
import subprocess
import time
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    host = socket.gethostname()
    targets = {'compute4-host.invalid': 'spark4', 'compute2-host.invalid': 'spark2', 'compute3-host.invalid': 'spark3'}
    if host not in targets:
        parser.error('Run this check on a verified compute Spark, never the hub.')
    args.out.mkdir(parents=True, exist_ok=False)
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from hermes_cli.dashboard_auth import clear_providers, register_provider
    from hermes_cli.dashboard_auth.middleware import gated_auth_middleware
    from plugins.dashboard_auth.basic import BasicAuthProvider, hash_password
    from sparkie_sparks import controls
    from sparkie_sparks.authority import OwnerBinding
    from sparkie_sparks.controls import Controls
    from sparkie_sparks.operations import OperationStore
    from sparkie_sparks.workloads import StopWorkload
    from sparkie_sparks.web_controls import router
    nonce = uuid.uuid4().hex
    label = 'sparkie.test=' + nonce
    image = 'node@sha256:b7087bc4d973034b30854b378ba107f9fab622b47514cb7e2592e41b8bab8d49'
    report = {'scope': 'Native authenticated HTTP confirms a real stop of one disposable container; no existing workload or live application is changed.',
              'host': host, 'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'checks': []}
    container = None
    started = time.monotonic()
    try:
        container = subprocess.check_output(['docker', 'run', '-d', '--name', 'sparkie-stop-check-' + nonce,
            '--label', label, '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
            '--cpus', '0.25', '--memory', '64m', image, 'sleep', '300'], text=True).strip()
        assert len(container) == 64
        binding = OwnerBinding('hardware-fixture-' + nonce, 'fixture-owner', 'basic', '', 12345, 12345)
        store = OperationStore(args.out / 'operations.sqlite')
        adapter = StopWorkload([{'id': targets[host], 'hostname': host, 'address': '127.0.0.1', 'user': 'exampleuser', 'local': True}])
        controls._controls = Controls(store, binding=lambda: binding, dispatch=adapter.dispatch, observe=adapter.observe)
        clear_providers()
        password = secrets.token_urlsafe(24)
        provider = BasicAuthProvider(username='fixture-owner', password_hash=hash_password(password), secret=secrets.token_bytes(32))
        register_provider(provider)
        signed = provider.complete_password_login(username='fixture-owner', password=password)
        app = FastAPI()
        app.state.auth_required = True
        app.middleware('http')(gated_auth_middleware)
        app.include_router(router, prefix='/api/plugins/sparkie-sparks')
        with TestClient(app, base_url='https://fixture.invalid') as client:
            client.headers['Authorization'] = 'Bearer ' + signed.access_token
            row = client.post('/api/plugins/sparkie-sparks/operations', json={'request_id': nonce, 'action': 'stop_workload',
                                                                           'spark': targets[host], 'container': container}).json()
            assert row['state'] == 'pending'
            running = subprocess.check_output(['docker', 'inspect', '--format', '{{.State.Running}}', container], text=True).strip()
            assert running == 'true', 'Preparation must not stop the container'
            url = '/api/plugins/sparkie-sparks/operations/' + row['id'] + '/confirm'
            result = client.post(url, json={'digest': row['digest']})
            assert result.status_code == 200, result.text
            assert result.json()['state'] == 'succeeded', result.json()
            stopped = subprocess.check_output(['docker', 'inspect', '--format', '{{.State.Running}}', container], text=True).strip()
            assert stopped == 'false'
            assert client.post(url, json={'digest': row['digest']}).status_code == 403
            report['operation'] = result.json()
            report['checks'] = ['Preparing the exact stop leaves the fixture running', 'Native verified owner confirmation stops that exact container',
                                'A fresh Docker observation confirms it stopped', 'Replayed confirmation is refused']
        report['passed'] = True
    except Exception as exc:
        report['passed'] = False
        report['error'] = str(exc)
    finally:
        if container:
            saved_label = subprocess.check_output(['docker', 'inspect', '--format', '{{index .Config.Labels "sparkie.test"}}', container], text=True).strip()
            if saved_label != nonce:
                raise RuntimeError('Fixture identity changed. Refusing cleanup.')
            subprocess.run(['docker', 'rm', '-f', container], check=True, stdout=subprocess.DEVNULL)
            report['container_removed'] = subprocess.run(['docker', 'inspect', container], capture_output=True).returncode != 0
        report['elapsed_seconds'] = round(time.monotonic() - started, 3)
        (args.out / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report))
    return 0 if report.get('passed') and report.get('container_removed') else 1


if __name__ == '__main__':
    raise SystemExit(main())
