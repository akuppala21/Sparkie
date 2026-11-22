"""Qualify the private broker with native owner transports and a remote fixture.

Run on Spark 4. The only mutation is creating/stopping/removing one labelled
disposable container on the selected compute Spark. Spark 4 uses a local worker;
other targets require existing strict SSH access. Telegram transport is a
stand-in; its real Update, Application and extension handlers run without a bot.
No live application, existing workload, access setting or credential is changed.
"""
import argparse
import asyncio
from dataclasses import asdict
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shlex
import socket
import subprocess
import sys
import time
import uuid

TARGETS = {
    'spark2': ('compute2-endpoint.invalid', 'compute2-host.invalid'),
    'spark3': ('compute3-endpoint.invalid', 'compute3-host.invalid'),
    'spark4': ('127.0.0.1', 'compute4-host.invalid'),
}
IMAGE = 'node@sha256:b7087bc4d973034b30854b378ba107f9fab622b47514cb7e2592e41b8bab8d49'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--target', choices=TARGETS, required=True)
    args = parser.parse_args()
    if socket.gethostname() != 'compute4-host.invalid':
        parser.error('Run this isolated check on Spark 4.')
    args.out = args.out.resolve()
    args.out.mkdir(parents=True, exist_ok=False, mode=0o700)
    address, hostname = TARGETS[args.target]
    ssh = ['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
           '-o', 'ConnectTimeout=5', '-o', 'ConnectionAttempts=1', 'exampleuser@' + address]

    def remote(*command):
        argv = list(command) if args.target == 'spark4' else ssh + [shlex.join(command)]
        return subprocess.check_output(argv, text=True, timeout=50).strip()

    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from hermes_cli.dashboard_auth import clear_providers, register_provider
    from hermes_cli.dashboard_auth.middleware import gated_auth_middleware
    from plugins.dashboard_auth.basic import BasicAuthProvider, hash_password
    from sparkie_sparks import controls
    from sparkie_sparks.authority import OwnerBinding
    from sparkie_sparks.broker import RemoteControls
    from sparkie_sparks.telegram_controls import register
    from sparkie_sparks.web_controls import router
    from telegram import Update

    # Use the same no-network Telegram transport as the native integration tests.
    fixture_file = Path(__file__).resolve().parents[1] / 'test_native_controls.py'
    spec = importlib.util.spec_from_file_location('native_control_fixture', fixture_file)
    fixture_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fixture_module)

    nonce = uuid.uuid4().hex
    binding = OwnerBinding('hardware-' + nonce, 'fixture-owner', 'basic', '', 12345, 12345)
    setup = {
        'binding': asdict(binding),
        'inventory': {'schema': 1, 'nodes': [{'id': args.target, 'hostname': hostname,
                                             'address': address, 'user': 'exampleuser', 'local': args.target == 'spark4'}]},
        'config': {'schema': 1, 'owner_binding': str(args.out / 'binding.json'),
                   'inventory': str(args.out / 'inventory.json'),
                   'operations': str(args.out / 'operations.sqlite'),
                   'socket': str(args.out / 'private/fleet.sock'), 'gateway_uid': os.geteuid()},
    }
    for name, value in setup.items():
        path = args.out / (name + '.json')
        path.write_text(json.dumps(value))
        path.chmod(0o600)
    transport = 'local worker on Spark 4' if args.target == 'spark4' else 'strict cross-Spark SSH'
    report = {'scope': f'Native authenticated web preparation and stand-in Telegram owner confirmation through a separate broker process and {transport}; real disposable container only.',
              'runner': socket.gethostname(), 'target': args.target, 'checks': [],
              'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    started, container, broker = time.monotonic(), None, None
    log = (args.out / 'broker.log').open('w')

    def start_broker():
        process = subprocess.Popen([sys.executable, '-m', 'sparkie_sparks.broker', '--config', str(args.out / 'config.json')],
                                   stdout=log, stderr=log)
        until = time.monotonic() + 10
        while not Path(setup['config']['socket']).exists():
            if process.poll() is not None or time.monotonic() > until:
                process.terminate()
                process.wait(timeout=5)
                raise RuntimeError('Private broker did not start.')
            time.sleep(.02)
        return process

    try:
        assert remote('hostname') == hostname, 'Compute identity does not match the inventory'
        container = remote('docker', 'run', '-d', '--name', 'sparkie-broker-check-' + nonce,
                           '--label', 'sparkie.test=' + nonce, '--network', 'none', '--read-only',
                           '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--cpus', '0.25',
                           '--memory', '64m', IMAGE, 'sleep', '600')
        assert len(container) == 64
        broker = start_broker()
        controls._controls = None
        os.environ['SPARKIE_CONTROL_SOCKET'] = setup['config']['socket']
        assert isinstance(controls.configured(), RemoteControls)
        clear_providers()
        password = secrets.token_urlsafe(24)
        provider = BasicAuthProvider(username='fixture-owner', password_hash=hash_password(password),
                                     secret=secrets.token_bytes(32))
        register_provider(provider)
        signed = provider.complete_password_login(username='fixture-owner', password=password)
        app = FastAPI()
        app.state.auth_required = True
        app.middleware('http')(gated_auth_middleware)
        app.include_router(router, prefix='/api/plugins/sparkie-sparks')
        prefix = '/api/plugins/sparkie-sparks/operations'
        with TestClient(app, base_url='https://fixture.invalid') as client:
            body = {'request_id': nonce, 'action': 'stop_workload', 'spark': args.target, 'container': container}
            assert client.post(prefix, json=body).status_code == 401
            client.headers['Authorization'] = 'Bearer ' + signed.access_token
            response = client.post(prefix, json=body)
            assert response.status_code == 200, response.text
            row = response.json()
            assert row['state'] == 'pending'
            assert client.post(prefix, json=body).json()['id'] == row['id']
            assert remote('docker', 'inspect', '--format', '{{.State.Running}}', container) == 'true'
            report['checks'].append('Authenticated native web preparation is idempotent and leaves the exact remote container running')
            # A process restart must preserve the prepared operation for Telegram.
            broker.terminate()
            assert broker.wait(timeout=5) == 0
            broker = start_broker()
            assert client.get(prefix + '/' + row['id']).json() == row
            report['checks'].append('A real private broker restart preserves the operation and its exact digest')

            async def confirm_from_telegram():
                tg, wire = fixture_module.telegram_fixture()
                register(tg, None)
                errors = []
                async def error(update, context): errors.append(str(context.error))
                tg.add_error_handler(error)
                async with tg:
                    await tg.process_update(Update.de_json({'update_id': 1, 'message': {
                        'message_id': 1, 'date': 1, 'chat': {'id': 12345, 'type': 'private'},
                        'from': {'id': 12345, 'is_bot': False, 'first_name': 'Fixture'},
                        'text': '/spark show ' + row['id'],
                        'entities': [{'type': 'bot_command', 'offset': 0, 'length': 6}]}}, tg.bot))
                    card = wire.messages[-1]
                    button = card['reply_markup']['inline_keyboard'][0][0]['callback_data']
                    async def click(user):
                        await tg.process_update(Update.de_json({'update_id': 2, 'callback_query': {
                            'id': uuid.uuid4().hex, 'chat_instance': 'fixture', 'data': button,
                            'from': {'id': user, 'is_bot': False, 'first_name': 'Fixture'}, 'message': card}}, tg.bot))
                    await click(54321)
                    assert remote('docker', 'inspect', '--format', '{{.State.Running}}', container) == 'true'
                    await click(12345)
                    assert not errors, errors
                    assert 'The requested result was observed.' in wire.messages[-1]['text']
                    await click(12345)
                    assert wire.calls[-1][1]['text'] == 'Owner access or this confirmation is no longer valid.'
                    assert wire.calls[-1][1]['show_alert'] is True

            asyncio.run(confirm_from_telegram())
            result = client.get(prefix + '/' + row['id']).json()
            assert result['state'] == 'succeeded'
            assert remote('docker', 'inspect', '--format', '{{.State.Running}}', container) == 'false'
            assert client.post(prefix + '/' + row['id'] + '/confirm', json={'digest': row['digest']}).status_code == 403
            report['operation'] = result
            report['checks'] += ['Wrong Telegram sender cannot stop the remote container',
                                 'Native Telegram owner confirmation reaches the separate broker and ' + transport,
                                 'A separate Docker observation confirms stopped state and the web sees the same receipt',
                                 'Both Telegram and web reject the consumed confirmation']
        report['passed'] = True
    except Exception as exc:
        report['passed'] = False
        report['error'] = str(exc)
    finally:
        if broker:
            broker.terminate()
            broker.wait(timeout=5)
        log.close()
        if container:
            label = remote('docker', 'inspect', '--format', '{{index .Config.Labels "sparkie.test"}}', container)
            if label != nonce:
                raise RuntimeError('Fixture identity changed. Refusing cleanup.')
            remote('docker', 'rm', '-f', container)
            report['fixture_removed'] = True
        report['elapsed_seconds'] = round(time.monotonic() - started, 3)
        (args.out / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report))
    return 0 if report.get('passed') and report.get('fixture_removed') else 1


if __name__ == '__main__':
    raise SystemExit(main())
