#!/usr/bin/env python3
"""Real pinned Caddy + native Hermes gate + disposable loopback app on a compute Spark.

No production route, credential, bot or fleet state is used. This qualifies
forwarding and native auth wiring; actual public login remains a release check.
"""
import argparse
import asyncio
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import runpy
import secrets
import subprocess
import threading
import time
from types import SimpleNamespace

import httpx
import uvicorn
from fastapi import FastAPI, Request, WebSocket
from fastapi.responses import JSONResponse, StreamingResponse
from hermes_cli.dashboard_auth import clear_providers, register_provider
from hermes_cli.dashboard_auth.middleware import gated_auth_middleware
from plugins.dashboard_auth.basic import BasicAuthProvider, hash_password
from sparkie_sparks import controls
from sparkie_sparks.authority import OwnerBinding
from sparkie_sparks.web_controls import router


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--port', type=int, default=32490)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=False)
    root = Path(__file__).resolve().parents[2]
    ingress = runpy.run_path(str(root / 'deploy/service_ingress.py'))
    ports = {'proxy': args.port, 'native': args.port + 1, 'app': args.port + 2}
    origin = 'https://fixture.invalid:10000'
    os.environ['SPARKIE_SERVICES_ORIGIN'] = origin
    os.environ['HERMES_HOME'] = str(args.out / 'hermes')
    (args.out / 'hermes').mkdir(mode=0o700)
    report = {'scope': 'Real Caddy/native gate with disposable backend; no live installation',
              'started': datetime.now(timezone.utc).isoformat(), 'image': ingress['IMAGE'], 'checks': []}
    report['inputs'] = {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
                        for path in (root / 'deploy/service_ingress.py', root / 'src/sparkie_sparks/service_access.py',
                                     root / 'src/sparkie_sparks/web_controls.py', Path(__file__))}
    started = time.monotonic()
    binding = [OwnerBinding('fixture-generation', 'fixture-owner', 'basic', '', 12345, 12345)]
    def route(owner, recipe, instance=None):
        if recipe not in ('artifact-browser', 'glm-flash'):
            raise ValueError('Choose an enrolled service.')
        return {'port': ports['app'], 'kind': 'model' if recipe == 'glm-flash' else 'app', 'instance': 'a' * 32}
    controls._controls = SimpleNamespace(binding=lambda: binding[0], service_route=route)
    clear_providers()
    provider = BasicAuthProvider(username='fixture-owner', password_hash=hash_password('isolated-fixture-only'),
                                 secret=secrets.token_bytes(32))
    register_provider(provider)
    signed = provider.complete_password_login(username='fixture-owner', password='isolated-fixture-only')
    native, backend = FastAPI(), FastAPI()
    native.state.auth_required = True
    native.middleware('http')(gated_auth_middleware)
    native.include_router(router, prefix='/api/plugins/sparkie-sparks')
    calls = []
    @backend.api_route('/echo', methods=['GET', 'POST'])
    @backend.post('/v1/chat/completions')
    async def echo(request: Request):
        body = await request.body()
        calls.append((request.method, request.url.path))
        return JSONResponse({'method': request.method, 'query': request.url.query,
                             'body': body.decode(), 'headers': dict(request.headers)},
                            headers={'Set-Cookie': '__Host-hermes_session_at=backend-must-not-set; Path=/; Secure',
                                     'Access-Control-Allow-Origin': '*'})
    @backend.get('/stream')
    def stream():
        async def chunks():
            for i in range(3):
                yield f'data: {i}\n\n'
                await asyncio.sleep(0.05)
        return StreamingResponse(chunks(), media_type='text/event-stream')
    @backend.websocket('/ws')
    async def ws(socket: WebSocket):
        await socket.accept()
        await socket.send_json({'headers': dict(socket.headers), 'received': await socket.receive_text()})
        await socket.close()
    servers, threads = [], []
    container = 'sparkie-ingress-fixture-' + secrets.token_hex(5)
    config = args.out / 'Caddyfile'
    config.write_text(ingress['render'](dashboard_origin='https://fixture.invalid:8443', services_origin=origin,
                                      dashboard_port=ports['native'], listen_port=ports['proxy']))
    try:
        for app, port in ((native, ports['native']), (backend, ports['app'])):
            server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=port, log_level='error', access_log=False))
            thread = threading.Thread(target=server.run, daemon=True)
            thread.start()
            servers.append(server); threads.append(thread)
        run = subprocess.run(['docker', 'run', '-d', '--rm', '--name', container, '--network', 'host',
                              '--read-only', '--user', '1000:1000', '--cap-drop=ALL', '--security-opt', 'no-new-privileges',
                              '--tmpfs', '/config:uid=1000,gid=1000', '--tmpfs', '/data:uid=1000,gid=1000',
                              '-v', str(config) + ':/etc/caddy/Caddyfile:ro', '--entrypoint', 'caddy',
                              ingress['IMAGE'], 'run', '--config', '/etc/caddy/Caddyfile'],
                             capture_output=True, text=True, timeout=30, check=True)
        base = f'http://127.0.0.1:{ports["proxy"]}/services/artifact-browser'
        model_url = f'http://127.0.0.1:{ports["proxy"]}/services/glm-flash/v1/chat/completions'
        with httpx.Client(timeout=15, trust_env=False) as client:
            deadline = time.monotonic() + 15
            while True:
                try:
                    unauth = client.get(base + '/echo')
                    break
                except httpx.TransportError:
                    if time.monotonic() > deadline: raise
                    time.sleep(0.1)
            assert unauth.status_code == 401 and not calls, 'No backend request without native sign-in'
            login = client.get(base + '/echo', headers={'Accept': 'text/html'}, follow_redirects=False)
            assert login.status_code == 303 and login.headers['location'] == (
                'https://fixture.invalid:8443/login?next=%2Fapi%2Fplugins%2Fsparkie-sparks%2Fservices%2Fartifact-browser%2Fopen')
            assert not calls
            headers = {'Authorization': 'Bearer ' + signed.access_token, 'Host': 'fixture.invalid:10000'}
            response = client.get(base + '/echo?x=1&x=two', headers=headers)
            assert response.status_code == 200, response.text
            row = response.json()
            assert row['query'] == 'x=1&x=two' and row['method'] == 'GET'
            assert 'authorization' not in row['headers'] and 'cookie' not in row['headers']
            assert not any(name.startswith('x-sparkie-') for name in row['headers'])
            assert not response.headers.get('set-cookie') and 'access-control-allow-origin' not in response.headers
            policy = response.headers['content-security-policy']
            assert 'sandbox' in policy and 'allow-same-origin' not in policy and "worker-src 'none'" in policy
            report['checks'].append('Native owner bearer gates stable prefix, strips workload credentials and forbids backend login cookies')
            response = client.post(model_url, content='fixture body π'.encode(), headers=headers)
            assert response.status_code == 200 and response.json()['body'] == 'fixture body π'
            before = len(calls)
            assert client.post(model_url, headers={**headers, 'Origin': 'https://wrong.invalid'}).status_code == 403
            assert len(calls) == before
            cookie = '__Host-hermes_session_at=' + signed.access_token + '; __Host-hermes_session_provider=basic'
            assert client.post(model_url, headers={'Cookie': cookie}).status_code == 403
            assert client.post(model_url, headers={'Cookie': cookie, 'Origin': origin}).status_code == 200
            before = len(calls)
            assert client.post(base + '/echo', headers=headers).status_code == 403
            for endpoint in ('sleep', 'wake_up', 'v1/load_lora_adapter'):
                assert client.post(model_url.replace('v1/chat/completions', endpoint), headers=headers).status_code == 403
            assert client.post(model_url.replace('v1/chat/completions', 'sleep'), headers={**headers,
                'X-Sparkie-Path': '/services/glm-flash/v1/chat/completions',
                'X-Sparkie-Method': 'POST'}).status_code == 403
            assert len(calls) == before
            binding[0] = OwnerBinding('fixture-generation', 'other-owner', 'basic', '', 12345, 12345)
            assert client.get(base + '/echo', headers=headers).status_code == 403
            binding[0] = OwnerBinding('fixture-generation', 'fixture-owner', 'basic', '', 12345, 12345)
            assert client.get(base.replace('artifact-browser', 'not-enrolled') + '/echo', headers=headers).status_code == 400
            report['checks'].append('Bodies survive auth precheck; foreign origins, unproven cookie writes, wrong owner and unknown recipes never reach backend')
            # Real native refresh: invalid AT plus the valid issued RT must rotate
            # through the pinned gate. Caddy must preserve every cookie, separately.
            expired = '__Host-hermes_session_at=expired-fixture; __Host-hermes_session_rt=' + signed.refresh_token + '; __Host-hermes_session_provider=basic'
            refreshed = client.get(base + '/echo', headers={'Cookie': expired})
            assert refreshed.status_code == 200, refreshed.text
            cookies = refreshed.headers.get_list('set-cookie')
            names = {value.split('=', 1)[0] for value in cookies}
            assert {'__Host-hermes_session_at', '__Host-hermes_session_rt', '__Host-hermes_session_provider'} <= names
            assert all('backend-must-not-set' not in value for value in cookies)
            refreshed_cookie = '; '.join(value.split(';', 1)[0] for value in cookies)
            assert client.get(base + '/echo', headers={'Cookie': refreshed_cookie}).status_code == 200
            report['checks'].append('All native rotated session cookies survive separately and the returned session works on the next request')
            navigation = {'Cookie': refreshed_cookie, 'Sec-Fetch-Site': 'cross-site',
                          'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document',
                          'Sec-Fetch-User': '?1'}
            assert client.get(base + '/echo', headers=navigation).status_code == 200
            before = len(calls)
            for change in ({'Origin': 'null'}, {'Sec-Fetch-Mode': 'cors'},
                           {'Sec-Fetch-Dest': 'iframe'}, {'Sec-Fetch-User': ''}):
                assert client.get(base + '/echo', headers=navigation | change).status_code == 403
            assert client.get(model_url.replace('chat/completions', 'models'), headers=navigation).status_code == 403
            assert len(calls) == before
            report['checks'].append('Sandboxed artifact document navigation works; opaque-origin scripts, frames and model navigation remain refused')
            with client.stream('GET', base + '/stream', headers={'Cookie': refreshed_cookie}) as response:
                assert response.status_code == 200
                lines = [line for line in response.iter_lines() if line]
                assert lines == ['data: 0', 'data: 1', 'data: 2']
            from websockets.sync.client import connect
            with connect(f'ws://127.0.0.1:{ports["proxy"]}/services/artifact-browser/ws',
                         origin=origin, additional_headers={'Cookie': refreshed_cookie}, proxy=None) as connection:
                connection.send('native-proxy-fixture')
                value = json.loads(connection.recv())
                assert value['received'] == 'native-proxy-fixture'
                assert 'cookie' not in value['headers'] and 'authorization' not in value['headers']
            report['checks'].append('Authenticated SSE and WebSocket exchange work through the same stable prefix')
            assert client.get(f'http://127.0.0.1:{ports["proxy"]}/not-a-service', headers=headers).status_code == 404
            report['passed'] = True
    except Exception as exc:
        # Never include credential-bearing request/response details in the receipt.
        report['passed'] = False
        report['failure_type'] = type(exc).__name__
        import traceback
        report['failure_location'] = [{'file': Path(frame.filename).name, 'line': frame.lineno}
                                      for frame in traceback.extract_tb(exc.__traceback__)]
        raise
    finally:
        subprocess.run(['docker', 'rm', '-f', container], capture_output=True, timeout=15)
        for server in servers: server.should_exit = True
        for thread in threads: thread.join(timeout=5)
        controls._controls = None
        clear_providers()
        report['elapsed_seconds'] = round(time.monotonic() - started, 3)
        (args.out / 'result.json').write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
