"""Switch only the two pre-enrolled Sparkie routes using Caddy's local admin API."""

import http.client
import json
from pathlib import Path
import pwd
import re
import socket
import stat
from urllib.parse import urlsplit


DASHBOARD = 'sparkie-dashboard'
WORKLOADS = 'sparkie-workloads'
LISTENERS = {DASHBOARD: ('dashboard', 443), WORKLOADS: ('workloads', 10000)}
ADMIN_SOCKET = '/run/sparkie-caddy/admin.sock'
DNS_LABEL = r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'


def site_origin(origin):
    if not isinstance(origin, str):
        raise ValueError('Choose the public dashboard HTTPS origin.')
    host = urlsplit(origin).hostname or ''
    if (origin != 'https://' + host or len(host) > 253
            or not re.fullmatch(DNS_LABEL + r'(?:\.' + DNS_LABEL + r')+', host)
            or host.split('.')[-1].isdigit()):
        raise ValueError('Use a DNS hostname with HTTPS on its default port.')
    return host


def backend(port):
    if port is not None and (type(port) is not int or not 1024 <= port <= 65535):
        raise ValueError('Choose an unprivileged loopback backend port or a disabled route.')
    return port


def site_route(host, route_id, port):
    site_origin('https://' + host)
    if route_id not in (DASHBOARD, WORKLOADS):
        raise ValueError('Use one of the two enrolled Sparkie routes.')
    backend(port)
    handler = ({'handler': 'static_response', 'status_code': 503} if port is None else
               {'handler': 'reverse_proxy', 'upstreams': [{'dial': f'127.0.0.1:{port}'}]})
    return {'@id': route_id, 'match': [{'host': [host]}], 'handle': [handler], 'terminal': True}


def check_settings(settings):
    edge = settings.get('public_ingress')
    if not isinstance(edge, dict) or set(edge) != {'origin', 'admin_socket'} or edge['admin_socket'] != ADMIN_SOCKET:
        raise ValueError('Review the public HTTPS origin and the private Caddy admin socket.')
    host = site_origin(edge['origin'])
    service = settings.get('service_ingress')
    if not isinstance(service, dict) or service.get('origin') != f'https://{host}:10000':
        raise ValueError('Workload links need the same public hostname on port 10000.')
    backend(settings['expected_route'])
    backend(service['expected_route'])
    return host


def local_socket():
    path = Path(ADMIN_SOCKET)
    trusted = {0}
    try:
        trusted.add(pwd.getpwnam('caddy').pw_uid)
    except KeyError:
        pass  # A separately provisioned root-owned socket needs no caddy account.
    for directory in reversed(path.parents):
        info = directory.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid not in trusted or info.st_mode & 0o022:
            raise PermissionError('The Caddy admin socket needs protected ancestry.')
    info = path.lstat()
    if not stat.S_ISSOCK(info.st_mode) or info.st_uid not in trusted or info.st_mode & 0o077:
        raise PermissionError('The Caddy admin socket must be private to its service account.')
    return path


def request(method, route_id, *, value=None, etag=None):
    if route_id not in LISTENERS:
        raise ValueError('Unrecognized Caddy route.')
    name, _ = LISTENERS[route_id]
    server_path = '/config/apps/http/servers/' + name
    version_pattern = '"' + server_path + r' [0-9a-f]{16}"'
    path = server_path
    headers = {'Content-Type': 'application/json'}
    if method == 'PATCH':
        if not isinstance(etag, str) or not re.fullmatch(version_pattern, etag):
            raise ValueError('A freshly observed version of the enrolled Caddy listener is required.')
        headers['If-Match'] = etag
        path += '/routes/0'
    elif method != 'GET':
        raise ValueError('Unsupported Caddy operation.')
    connection = http.client.HTTPConnection('localhost', timeout=8)
    try:
        connection.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        connection.sock.settimeout(8)
        connection.sock.connect(str(local_socket()))
        connection.request(method, path, body=None if value is None else json.dumps(value), headers=headers)
        response = connection.getresponse()
        data = response.read(65537)
        if response.status != 200 or len(data) > 65536:
            raise RuntimeError('Caddy did not confirm the enrolled route operation.')
        if method == 'GET':
            version = response.getheader('ETag')
            if not version or not re.fullmatch(version_pattern, version):
                raise RuntimeError('Caddy did not supply the enrolled listener version.')
            return json.loads(data), version
    finally:
        connection.close()


class CaddyRoutes:
    def __init__(self, settings, transport=request):
        self.host = check_settings(settings)
        self.transport = transport

    def _read(self, route_id):
        server, version = self.transport('GET', route_id)
        _, port = LISTENERS[route_id]
        if (not isinstance(server, dict) or server.get('listen') != [f':{port}']
                or server.get('tls_connection_policies') != [{}]
                or server.get('automatic_https') != {'disable_redirects': True}
                or 'listener_wrappers' in server
                or not isinstance(server.get('routes'), list) or not server['routes']):
            raise RuntimeError('The enrolled Caddy listener or TLS policy changed.')
        row = server['routes'][0]
        if row == site_route(self.host, route_id, None):
            return None, version
        try:
            dial = row['handle'][0]['upstreams'][0]['dial']
            match = re.fullmatch(r'127\.0\.0\.1:(\d{4,5})', dial)
            if match:
                port = int(match[1])
                if row == site_route(self.host, route_id, port):
                    return port, version
        except (TypeError, KeyError, IndexError, ValueError):
            pass
        raise RuntimeError('Caddy no longer has the exact enrolled host, handler and loopback backend.')

    def current(self, route_id):
        return self._read(route_id)[0]

    def target(self, route_id, port):
        return backend(port)

    def change(self, route_id, expected, target):
        backend(expected)
        desired = site_route(self.host, route_id, target)
        old, etag = self._read(route_id)
        if old == target:
            return
        if old != expected:
            raise RuntimeError('The enrolled route changed outside this operation.')
        try:
            self.transport('PATCH', route_id, value=desired, etag=etag)
        except (OSError, http.client.HTTPException, RuntimeError):
            if self.current(route_id) == target:
                return
            raise RuntimeError('The conditional Caddy change was not confirmed. Reconcile the same operation.') from None
        if self.current(route_id) != target:
            raise RuntimeError('The enrolled route did not reach its reviewed target.')
