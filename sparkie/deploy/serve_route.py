"""Scoped8443 changes through the installed Tailscale native LocalAPI.

The method/ETag contract is verified against Tailscale v1.104.7 client/local/serve.go.
This module never changes routes on import. Callers require concrete live approval.
"""
from copy import deepcopy
import http.client
import json
import socket

HOST = 'hub.example.invalid:8443'
SOCKET = '/var/run/tailscale/tailscaled.sock'
SERVICES_HOST = 'hub.example.invalid:10000'


class ServeAPI:
    def __init__(self, socket_path=SOCKET):
        self.socket_path = socket_path

    def _request(self, method, value=None, etag=None):
        connection = http.client.HTTPConnection('local-tailscaled.sock', timeout=10)
        connection.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        connection.sock.settimeout(10)
        connection.sock.connect(self.socket_path)
        headers = {'Content-Type': 'application/json'}
        if etag:
            headers['If-Match'] = etag
        try:
            connection.request(method, '/localapi/v0/serve-config',
                               body=None if value is None else json.dumps(value), headers=headers)
            response = connection.getresponse()
            raw = response.read(1048577)
            if response.status != 200 or len(raw) > 1048576:
                raise RuntimeError('Tailscale rejected the conditional route change or observation; inspect before retrying.')
            if method == 'GET':
                tag = response.getheader('ETag')
                if not tag:
                    raise RuntimeError('The installed Tailscale did not supply a configuration version.')
                return json.loads(raw), tag
        finally:
            connection.close()

    def read(self):
        return self._request('GET')

    def write(self, config, etag):
        if not isinstance(etag, str) or not etag or '\n' in etag or '\r' in etag:
            raise ValueError('A freshly read Tailscale configuration version is required.')
        self._request('POST', config, etag)


def route(config):
    if config.get('TCP', {}).get('8443') != {'HTTPS': True} or HOST not in config.get('Web', {}):
        raise ValueError('The expected Spark1 HTTPS8443 route is absent or changed.')
    return deepcopy(config['Web'][HOST])


def replacement(port):
    if type(port) is not int or not 1024 <= port <= 65535:
        raise ValueError('Use the reviewed unprivileged loopback gateway port.')
    return {'Handlers': {'/': {'Proxy': f'http://127.0.0.1:{port}'}}}


def change(api, *, expected, target):
    current, etag = api.read()
    active = route(current)
    if active == target:
        return {'changed': False, 'already_observed': True}
    if active != expected:
        raise RuntimeError('The8443 handlers changed outside this candidate; no route was overwritten.')
    updated = deepcopy(current)
    updated['Web'][HOST] = deepcopy(target)
    # ETag is the native compare-and-swap gate for any intervening edit.
    try:
        api.write(updated, etag)
    except Exception:
        # A lost HTTP reply is not evidence that the write failed. Observe once;
        # never retry a conditional write blindly or overwrite concurrent edits.
        observed, _ = api.read()
        if route(observed) == target:
            return {'changed': True, 'already_observed': True}
        raise RuntimeError('The conditional route write was not confirmed; inspect before retrying.') from None
    observed, _ = api.read()
    if route(observed) != target:
        raise RuntimeError('The route result is uncertain. Reconcile it before another write.')
    return {'changed': True, 'already_observed': False}


def services_route(config):
    """Only the separate workload origin; absence is an explicit rollback state."""
    return deepcopy({'tcp': config.get('TCP', {}).get('10000'),
                     'web': config.get('Web', {}).get(SERVICES_HOST),
                     'funnel': config.get('AllowFunnel', {}).get(SERVICES_HOST)})


def services_replacement(port):
    return {'tcp': {'HTTPS': True}, 'web': replacement(port), 'funnel': True}


def change_services(api, *, expected, target):
    if any(not isinstance(value, dict) or set(value) != {'tcp', 'web', 'funnel'} for value in (expected, target)):
        raise ValueError('Review the complete service-origin route before changing it.')
    current, etag = api.read()
    active = services_route(current)
    if active == target:
        return {'changed': False, 'already_observed': True}
    if active != expected:
        raise RuntimeError('The workload route changed outside this candidate; nothing was overwritten.')
    updated = deepcopy(current)
    for section, key, part in (('TCP', '10000', 'tcp'), ('Web', SERVICES_HOST, 'web'),
                               ('AllowFunnel', SERVICES_HOST, 'funnel')):
        if target[part] is None:
            updated.setdefault(section, {}).pop(key, None)
        else:
            updated.setdefault(section, {})[key] = deepcopy(target[part])
    try:
        api.write(updated, etag)
    except Exception:
        observed, _ = api.read()
        if services_route(observed) == target:
            return {'changed': True, 'already_observed': True}
        raise RuntimeError('The workload route write was not confirmed. Inspect it before retrying.') from None
    if services_route(api.read()[0]) != target:
        raise RuntimeError('The workload route result is uncertain. Reconcile before another write.')
    return {'changed': True, 'already_observed': False}


class LegacyRoutes:
    """Read schema-1 route records while recovering an existing installation."""

    def __init__(self, api=None):
        self.api = ServeAPI() if api is None else api

    def current(self, route_id):
        from caddy_routes import DASHBOARD
        config, _ = self.api.read()
        return route(config) if route_id == DASHBOARD else services_route(config)

    def target(self, route_id, port):
        from caddy_routes import DASHBOARD
        return replacement(port) if route_id == DASHBOARD else services_replacement(port)

    def change(self, route_id, expected, target):
        from caddy_routes import DASHBOARD
        switch = change if route_id == DASHBOARD else change_services
        return switch(self.api, expected=expected, target=target)
