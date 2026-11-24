"""Run only inside an isolated networkless compute container with a disposable /run."""
import argparse
import http.client
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "deploy"))
import caddy_routes as edge
from caddy_site import render
from service_ingress import VERSION


def selector(path, method='GET', value=None):
    conn = http.client.HTTPConnection('localhost', timeout=5)
    try:
        conn.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        conn.sock.connect(str(edge.local_socket()))
        conn.request(method, path, body=json.dumps(value) if value is not None else None,
                     headers={'Content-Type': 'application/json'})
        response = conn.getresponse()
        assert response.status == 200, (path, response.status)
        data = response.read()
        return json.loads(data) if data else None
    finally:
        conn.close()


def run(binary, root):
    assert Path('/.dockerenv').is_file() and not Path('/var/run/docker.sock').exists()
    assert os.listdir('/sys/class/net') == ['lo']
    print(subprocess.check_output([binary, 'version'], text=True).strip(), flush=True)
    assert subprocess.check_output([binary, 'version'], text=True).startswith('v' + VERSION + ' ')
    host = 'fleet.example.test'
    origin = 'https://' + host
    settings = {'expected_route': None, 'public_ingress': {'origin': origin, 'admin_socket': edge.ADMIN_SOCKET},
                'service_ingress': {'origin': origin + ':10000', 'expected_route': None}}
    routes = edge.CaddyRoutes(settings)
    config = render(origin)
    config['apps']['tls']['automation']['policies'][0]['issuers'] = [{'module': 'internal'}]
    config['apps']['pki'] = {'certificate_authorities': {'local': {'install_trust': False}}}
    cfg = root / 'fixture.json'
    cfg.write_text(json.dumps(config))
    Path(edge.ADMIN_SOCKET).parent.mkdir(mode=0o700)
    env = {**os.environ, 'XDG_DATA_HOME': str(root/'data'), 'XDG_CONFIG_HOME': str(root/'config')}
    for first in (True, False):
        cmd = [binary, 'run', *(['--config', str(cfg)] if first else ['--resume'])]
        process = subprocess.Popen(cmd, env=env)
        try:
            for _ in range(100):
                assert process.poll() is None, 'Caddy exited before readiness'
                try:
                    routes.current(edge.DASHBOARD)
                    break
                except OSError:
                    time.sleep(.05)
            else:
                raise TimeoutError('Caddy admin socket')
            route_ids = ((edge.DASHBOARD, 32131), (edge.WORKLOADS, 32390))
            if first:
                _, stale_tag = edge.request('GET', edge.WORKLOADS)
                for rid, port in route_ids:
                    routes.change(rid, None, port)
                try:
                    edge.request('PATCH', edge.WORKLOADS, value=edge.site_route(host, edge.WORKLOADS, None), etag=stale_tag)
                except RuntimeError:
                    assert routes.current(edge.WORKLOADS) == 32390
                else:
                    raise AssertionError('Caddy accepted a stale listener ETag')
                selector('/config/apps/http/servers/workloads/routes/1/handle/0', 'PATCH',
                         {'handler': 'static_response', 'status_code': 404, 'body': 'retained'})
            for rid, port in route_ids:
                assert routes.current(rid) == port
                assert selector('/id/' + rid) == edge.site_route(host, rid, port)
            if not first:
                for rid, port in reversed(route_ids):
                    routes.change(rid, port, None)
                    assert routes.current(rid) is None
                assert selector('/config/apps/http/servers/workloads/routes/1/handle/0/body') == 'retained'
        finally:
            process.terminate()
            process.wait(timeout=10)
    print('Both routes read by ID; conditional update, stale rejection, resume, rollback and unrelated route verified.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('caddy', help='Path to the pinned Caddy binary in the test container')
    with tempfile.TemporaryDirectory() as directory:
        run(parser.parse_args().caddy, Path(directory))
