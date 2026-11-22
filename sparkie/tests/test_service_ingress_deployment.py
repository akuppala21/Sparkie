"""Scoped workload route, native gate-before-publication and exact rollback."""
from copy import deepcopy
from pathlib import Path
import subprocess
import sys

import pytest

DEPLOY = Path(__file__).parents[1] / 'deploy'
sys.path.insert(0, str(DEPLOY))
import installation
import promote
import serve_route
import service_ingress
sys.path.remove(str(DEPLOY))
from test_serve_route import API as RouteAPI, OTHER
from test_promote import setup, Host


def test_workload_route_roundtrip_preserves_both_existing_origins_and_new_external_edit():
    api = RouteAPI()
    before = deepcopy(api.config)
    original = serve_route.services_route(before)
    target = serve_route.services_replacement(32390)
    assert serve_route.change_services(api, expected=original, target=target)['changed']
    assert api.config['Web'][serve_route.HOST] == before['Web'][serve_route.HOST]
    assert api.config['Web'][OTHER] == before['Web'][OTHER]
    assert api.config['AllowFunnel'][serve_route.SERVICES_HOST] is True
    api.config['Web'][OTHER]['Handlers']['/']['Proxy'] = 'http://127.0.0.1:8101'
    serve_route.change_services(api, expected=target, target=original)
    assert serve_route.services_route(api.config) == original
    assert api.config['Web'][OTHER]['Handlers']['/']['Proxy'].endswith('8101')
    assert '10000' not in api.config['TCP']


def test_workload_route_lost_reply_reconciles_without_resending():
    api = RouteAPI()
    original = serve_route.services_route(api.config)
    api.fail = 'lost'
    result = serve_route.change_services(api, expected=original, target=serve_route.services_replacement(32390))
    assert result['already_observed'] and api.writes == 1
    assert not serve_route.change_services(api, expected=original, target=serve_route.services_replacement(32390))['changed']
    assert api.writes == 1


def test_concurrent_route_edit_and_existing_unreviewed_origin_fail_closed():
    api = RouteAPI()
    original = serve_route.services_route(api.config)
    api.fail = 'stale'
    with pytest.raises(RuntimeError, match='not confirmed'):
        serve_route.change_services(api, expected=original, target=serve_route.services_replacement(32390))
    assert api.writes == 1 and serve_route.services_route(api.config) == original
    api.fail = None
    api.config.setdefault('TCP', {})['10000'] = {'TCPForward': 'unrelated:22'}
    with pytest.raises(RuntimeError, match='outside this candidate'):
        serve_route.change_services(api, expected=original, target=serve_route.services_replacement(32390))
    assert api.writes == 1


def ingress_setup(tmp_path):
    plan, journal, api = setup(tmp_path)
    plan['settings']['service_ingress'] = {'origin': 'https://hub.example.invalid:10000',
        'port': 32390, 'expected_route': serve_route.services_route(api.config)}
    host = Host()
    host.private_service_ingress = lambda: host.event('workload-gate')
    return plan, journal, api, host


def test_full_promotion_gates_workload_origin_and_rolls_it_back_separately(tmp_path):
    plan, journal, api, host = ingress_setup(tmp_path)
    promote.promote(plan, 'a' * 64, journal, host=host, api=api)
    phases = [row['phase'] for row in journal.data['events']]
    assert phases.index('verify-private-owner-gate') < phases.index('publish-authenticated-workload-origin')
    assert phases.index('verify-private-workload-gate') < phases.index('publish-authenticated-workload-origin')
    assert api.config['AllowFunnel'][serve_route.SERVICES_HOST] is True
    api.config['Web']['other:443'] = {'external-change': True}
    promote.rollback(plan, journal, host=host, api=api)
    assert serve_route.services_route(api.config) == plan['settings']['service_ingress']['expected_route']
    assert api.config['Web']['other:443'] == {'external-change': True}
    assert ('stop', (service_ingress.UNIT,), False) in host.events


def test_failed_workload_gate_never_publishes_and_remains_recoverable(tmp_path):
    plan, journal, api, host = ingress_setup(tmp_path)
    host.fail = 'workload-gate'
    with pytest.raises(RuntimeError):
        promote.promote(plan, 'a' * 64, journal, host=host, api=api)
    assert serve_route.services_route(api.config) == plan['settings']['service_ingress']['expected_route']
    assert journal.data['events'][-1]['state'] == 'dispatching'
    host.fail = None
    promote.rollback(plan, journal, host=host, api=api)
    assert api.config['Web'][serve_route.HOST] == plan['settings']['expected_route']


def test_changed_workload_route_refuses_before_stopping_anything(tmp_path):
    plan, journal, api, host = ingress_setup(tmp_path)
    api.config['TCP']['10000'] = {'HTTPS': True}
    with pytest.raises(RuntimeError, match='no service was stopped'):
        promote.promote(plan, 'a' * 64, journal, host=host, api=api)
    assert host.events == []


@pytest.mark.parametrize('origin', ['https://other.invalid:10000', 'https://fixture.invalid:8443',
    'http://fixture.invalid:10000', 'https://owner:secret@fixture.invalid:10000', 'https://fixture.invalid:10000/evil'])
def test_ingress_rejects_main_origin_or_ambiguous_unreviewed_route(origin):
    with pytest.raises(ValueError):
        service_ingress.render(dashboard_origin='https://fixture.invalid:8443', services_origin=origin,
                               dashboard_port=32131, listen_port=32390)


def test_real_systemd_parser_accepts_nonroot_pinned_ingress_unit(tmp_path):
    unit = tmp_path / service_ingress.UNIT
    unit.write_text(service_ingress.render_unit('fixture', 1000, 1000))
    result = subprocess.run(['/usr/bin/systemd-analyze', 'verify', str(unit)],
                            capture_output=True, text=True, timeout=15)
    assert result.returncode == 0, result.stderr
    assert not result.stderr.strip()


def test_optional_ingress_files_join_installation_identity():
    normal = installation.installation_files({})
    ingress = installation.installation_files({'service_ingress': {}})
    assert set(ingress) - set(normal) == {service_ingress.UNIT, 'service-ingress.Caddyfile'}


def test_workload_private_gate_rejects_anonymous_success(monkeypatch):
    from types import SimpleNamespace
    host = object.__new__(promote.Host)
    host.settings = {'service_ingress': {'port': 32390}}
    host.unit_state = lambda _: {'active': 'active'}
    client = SimpleNamespace(open=lambda *a, **k: SimpleNamespace(close=lambda: None))
    monkeypatch.setattr(promote.urllib.request, 'build_opener', lambda *a: client)
    with pytest.raises(RuntimeError, match='anonymous'):
        host.private_service_ingress()
