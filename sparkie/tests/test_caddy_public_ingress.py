"""New-packet owner routes and retained-predecessor recovery."""

from copy import deepcopy
from pathlib import Path
import sys

import pytest

DEPLOY = Path(__file__).parents[1] / 'deploy'
sys.path.insert(0, str(DEPLOY))
import caddy_routes
import installation
import promote
sys.path.remove(str(DEPLOY))

from test_service_ingress_deployment import ingress_setup


HOST = 'fleet.example.org'
DASH = caddy_routes.DASHBOARD
WORK = caddy_routes.WORKLOADS


class RouteTransport:
    def __init__(self):
        self.routes = {key: caddy_routes.site_route(HOST, key, None) for key in (DASH, WORK)}
        self.routes['other'] = {'retained': 1}
        self.versions = {DASH: 1, WORK: 1}
        self.changes = []
        self.failure = None
        self.listener_edits = {}

    def __call__(self, method, route_id, value=None, etag=None):
        assert route_id in (DASH, WORK)
        if method == 'GET':
            port = 443 if route_id == DASH else 10000
            server = {'listen': [f':{port}'], 'tls_connection_policies': [{}],
                      'automatic_https': {'disable_redirects': True},
                      'routes': [deepcopy(self.routes[route_id])]}
            return {**server, **self.listener_edits.get(route_id, {})}, str(self.versions[route_id])
        assert method == 'PATCH'
        self.changes.append(route_id)
        if self.failure == 'concurrent':
            self.routes[route_id] = caddy_routes.site_route(HOST, route_id, 4567)
            self.versions[route_id] += 1
        if str(self.versions[route_id]) != etag:
            raise RuntimeError('Caddy refused the version.')
        self.routes[route_id] = deepcopy(value)
        self.versions[route_id] += 1
        if self.failure == 'lost':
            raise TimeoutError('The successful reply was lost.')


def setup_caddy(tmp_path):
    plan, journal, _, host = ingress_setup(tmp_path)
    settings = plan['settings']
    settings.update(expected_route=None, public_ingress={'origin': 'https://' + HOST,
                                                        'admin_socket': caddy_routes.ADMIN_SOCKET})
    settings['service_ingress'].update(expected_route=None, origin='https://' + HOST + ':10000')
    return plan, journal, RouteTransport(), host


def test_cutover_and_rollback_only_change_enrolled_routes(tmp_path, monkeypatch):
    plan, journal, transport, host = setup_caddy(tmp_path)
    monkeypatch.setattr(promote, 'LegacyRoutes', lambda *_: pytest.fail('New packet tried Tailscale.'))
    host.private_service_ingress = lambda: host.event('private-workload-owner-gate')
    gate = installation.validate_ingress(plan['settings'])
    assert f'https://{HOST}/login?' in gate and f'header_up Host {HOST}' in gate
    promote.promote(plan, 'a'*64, journal, host=host, api=transport)
    assert transport.changes == [DASH, WORK]
    assert transport.routes[DASH] == caddy_routes.site_route(HOST, DASH, plan['settings']['gateway_port'])
    assert transport.routes[WORK] == caddy_routes.site_route(HOST, WORK, plan['settings']['service_ingress']['port'])
    transport.routes['other'] = {'retained': 2}
    assert promote.rollback(plan, journal, host=host, api=transport) == promote.ROLLBACK_COMPLETE
    assert transport.changes == [DASH, WORK, WORK, DASH]
    assert transport.routes == {DASH: caddy_routes.site_route(HOST, DASH, None),
                                WORK: caddy_routes.site_route(HOST, WORK, None), 'other': {'retained': 2}}


def test_recovery_after_lost_reply_and_conflicting_conditional_write(tmp_path):
    plan, _, transport, _ = setup_caddy(tmp_path)
    routes = promote.ingress_routes(plan['settings'], transport)
    transport.failure = 'lost'
    routes.change(DASH, None, 32131)
    routes.change(DASH, None, 32131)
    assert transport.changes == [DASH]
    transport.failure = 'concurrent'
    with pytest.raises(RuntimeError, match='not confirmed'):
        routes.change(DASH, 32131, None)
    assert routes.current(DASH) == 4567 and transport.changes == [DASH, DASH]


def test_host_match_and_handler_are_verified_before_any_service_change(tmp_path):
    plan, journal, transport, host = setup_caddy(tmp_path)
    transport.routes[WORK]['match'][0]['host'] = ['different.example.org']
    with pytest.raises(RuntimeError, match='exact enrolled host'):
        promote.promote(plan, 'a'*64, journal, host=host, api=transport)
    assert not host.events and not transport.changes


@pytest.mark.parametrize('edit', [
    {'listen': [':443']},
    {'tls_connection_policies': []},
    {'listener_wrappers': [{'wrapper': 'http_redirect'}]},
    {'routes': [{'handle': [{'handler': 'static_response', 'status_code': 200}]},
                caddy_routes.site_route(HOST, WORK, None)]},
])
def test_wrong_or_shadowed_workload_listener_stops_before_cutover(tmp_path, edit):
    plan, journal, transport, host = setup_caddy(tmp_path)
    transport.listener_edits[WORK] = edit
    with pytest.raises(RuntimeError, match='enrolled'):
        promote.promote(plan, 'a'*64, journal, host=host, api=transport)
    assert not host.events and not transport.changes


@pytest.mark.parametrize('invalid', ['https://example.org:8443', 'https://x@y.example.org',
                                    'https://example.org/', 'https://127.0.0.1', 'https://a\nb.example.org'])
def test_new_owner_route_rejects_unreviewed_or_ambiguous_origins(invalid):
    with pytest.raises(ValueError):
        caddy_routes.site_origin(invalid)


def test_packet_requires_explicit_workload_origin_and_loopback_target(tmp_path):
    plan, _, _, _ = setup_caddy(tmp_path)
    selected = plan['settings']['service_ingress']
    selected['origin'] = 'https://other.example.org:10000'
    with pytest.raises(ValueError, match='same public hostname'):
        installation.validate_ingress(plan['settings'])
    selected['origin'] = f'https://{HOST}:10000'
    selected['expected_route'] = 'https://10.1.2.3:8080'
    with pytest.raises(ValueError, match='loopback backend'):
        installation.validate_ingress(plan['settings'])


def test_rollback_refuses_a_subsequent_owner_backend_edit(tmp_path):
    plan, journal, transport, host = setup_caddy(tmp_path)
    promote.promote(plan, 'a'*64, journal, host=host, api=transport)
    transport.routes[WORK] = caddy_routes.site_route(HOST, WORK, 6789)
    with pytest.raises(RuntimeError, match='outside this operation'):
        promote.rollback(plan, journal, host=host, api=transport)
    assert transport.routes[WORK] == caddy_routes.site_route(HOST, WORK, 6789)
    assert transport.changes == [DASH, WORK]


def test_existing_funnel_site_keeps_its_own_origin_and_adapter(tmp_path):
    from serve_route import HOST
    plan, _, api, _ = ingress_setup(tmp_path)
    settings = plan['settings']
    assert installation.dashboard_origin(settings) == 'https://' + HOST
    assert isinstance(promote.ingress_routes(settings, api), promote.LegacyRoutes)
    settings.pop('expected_route')
    with pytest.raises(ValueError, match='current Funnel dashboard handler'):
        installation.dashboard_origin(settings)


def test_explicit_edge_never_falls_back_to_funnel(tmp_path):
    plan, _, _, _ = setup_caddy(tmp_path)
    assert installation.dashboard_origin(plan['settings']) == 'https://' + HOST
    plan['settings']['public_ingress'] = None
    with pytest.raises(ValueError, match='public HTTPS origin'):
        installation.dashboard_origin(plan['settings'])
