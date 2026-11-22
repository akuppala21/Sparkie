"""Native gate, pinned Caddy, and actual artifact recipe in a private browser container."""

import hashlib
import json
import os
from pathlib import Path
import runpy
import secrets
import subprocess
import sys
import threading
import time
from types import SimpleNamespace

from fastapi import FastAPI, Request
from hermes_cli.dashboard_auth import clear_providers, register_provider
from hermes_cli.dashboard_auth.middleware import gated_auth_middleware
import httpx
from plugins.dashboard_auth.basic import BasicAuthProvider, hash_password
from sparkie_sparks import controls
from sparkie_sparks.authority import OwnerBinding
from sparkie_sparks.service_definitions import ARTIFACTS, DEFINITIONS, GLM
from sparkie_sparks.web_controls import router
import uvicorn


def main():
    root = Path(__file__).resolve().parents[2]
    ingress = root / 'deploy/service_ingress.py'
    render = runpy.run_path(str(ingress))['render']
    proxy, native, api = 32490, 32491, 32492
    origin = 'https://localhost:10000'
    os.environ['SPARKIE_SERVICES_ORIGIN'] = origin
    output = Path(os.environ['SPARKIE_BROWSER_OUTPUT'])
    auth_rows, model_calls = [], []
    binding = OwnerBinding('fixture-generation', 'fixture-owner', 'basic', '', 12345, 12345)
    config = Path.cwd() / 'Caddyfile'
    config.write_text(render(dashboard_origin='https://localhost:8443', services_origin=origin,
                            dashboard_port=native, listen_port=proxy) + f'''
https://localhost:10000 {{
    bind 127.0.0.1
    tls /source/localhost.crt /source/localhost.key
    reverse_proxy 127.0.0.1:{proxy}
}}
''')

    def route(_owner, recipe, instance=None):
        if recipe == ARTIFACTS:
            return {'kind': 'app', 'port': 8000}
        if recipe == GLM:
            return {'kind': 'model', 'port': api}
        raise ValueError('Choose an enrolled fixture service.')

    controls._controls = SimpleNamespace(binding=lambda: binding, service_route=route)
    clear_providers()
    password = secrets.token_urlsafe(25)
    provider = BasicAuthProvider(username='fixture-owner', password_hash=hash_password(password),
                                 secret=secrets.token_bytes(32))
    register_provider(provider)
    signed = provider.complete_password_login(username='fixture-owner', password=password)
    login = Path.cwd() / 'browser-session.json'
    with os.fdopen(os.open(login, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as file:
        json.dump({'__Host-hermes_session_at': signed.access_token,
                   '__Host-hermes_session_provider': 'basic'}, file)

    dashboard, model = FastAPI(), FastAPI()
    dashboard.state.auth_required = True
    dashboard.middleware('http')(gated_auth_middleware)
    dashboard.include_router(router, prefix='/api/plugins/sparkie-sparks')

    @dashboard.middleware('http')
    async def trace(request: Request, call_next):
        response = await call_next(request)
        if request.url.path.endswith('/authorize'):
            headers = ('origin', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest',
                       'sec-fetch-user', 'x-sparkie-method', 'x-sparkie-path')
            auth_rows.append({'headers': {name: request.headers.get(name) for name in headers},
                              'has_owner_cookie': '__Host-hermes_session_at' in request.cookies,
                              'status': response.status_code})
        return response

    @model.get('/v1/models')
    @model.post('/v1/chat/completions')
    async def stand_in_model(request: Request):
        model_calls.append({'method': request.method, 'path': request.url.path})
        return {'model': 'synthetic-model-result'}

    servers, processes = [], []
    try:
        for app, port in ((dashboard, native), (model, api)):
            server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=port,
                                                  log_level='error', access_log=False))
            thread = threading.Thread(target=server.run, daemon=True)
            thread.start()
            servers.append((server, thread))
        for name, command, extra in (
            ('artifact', [sys.executable, '-I', '-u', '-c', DEFINITIONS[ARTIFACTS]['command'][0]],
             {'SPARKIE_INSTANCE': 'a' * 32}),
            ('caddy', ['/browser-caddy', 'run', '--config', str(config)], {}),
        ):
            with (output / f'{name}.log').open('x') as log:
                processes.append(subprocess.Popen(command, stdout=log, stderr=log, env=os.environ | extra))
        with httpx.Client(timeout=1, verify=False, trust_env=False) as client:
            deadline = time.monotonic() + 15
            while True:
                try:
                    if client.get(origin + '/').status_code == 404:
                        break
                except httpx.TransportError:
                    pass
                if time.monotonic() >= deadline:
                    raise RuntimeError('The private TLS fixture did not start.')
                time.sleep(.1)
        browser = subprocess.run([os.environ['SPARKIE_TEST_NODE'], str(Path(__file__).with_name('artifact_ingress.mjs'))],
                                 env=os.environ | {'SPARKIE_ARTIFACT_SESSION': str(login)}, check=False, timeout=60)
        opaque_model_attempts = [row for row in auth_rows if row['headers']['origin'] == 'null'
                                 and (row['headers']['x-sparkie-path'] or '').startswith('/services/glm-flash/')]
        signed_controls = {('GET', '/v1/models'), ('POST', '/v1/chat/completions')}
        denied = {(row['headers']['x-sparkie-method'], row['headers']['x-sparkie-path'].removeprefix('/services/glm-flash'))
                  for row in opaque_model_attempts if row['status'] in (401, 403)}
        checks = {
            'native_denied_both_opaque_model_requests': len(opaque_model_attempts) == 2 and denied == signed_controls,
            'model_received_only_the_two_signed_controls': len(model_calls) == 2
                and {(row['method'], row['path']) for row in model_calls} == signed_controls,
        }
        (output / 'native-checks.json').write_text(json.dumps(checks, indent=2) + '\n')
        return browser.returncode or int(not all(checks.values()))
    finally:
        for process in reversed(processes):
            process.terminate()
            process.wait(timeout=10)
        for server, thread in servers:
            server.should_exit = True
            thread.join(timeout=5)
        controls._controls = None
        clear_providers()
        (output / 'native-auth-requests.json').write_text(json.dumps(auth_rows, indent=2) + '\n')
        (output / 'model-backend-requests.json').write_text(json.dumps(model_calls, indent=2) + '\n')
        (output / 'source.sha256.json').write_text(json.dumps({str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in (ingress, root / 'src/sparkie_sparks/service_access.py', root / 'src/sparkie_sparks/web_controls.py',
                         root / 'src/sparkie_sparks/service_definitions.py', Path(__file__),
                         Path(__file__).with_name('artifact_ingress.mjs'))}, indent=2) + '\n')


if __name__ == '__main__':
    raise SystemExit(main())
