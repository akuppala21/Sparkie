"""The initial network-facing site serves a maintenance response until cutover."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'deploy'))
from caddy_site import render


def test_dedicated_site_has_only_two_closed_https_routes_and_local_admin():
    host = 'fleet.example.org'
    config = render('https://' + host)
    assert config['admin'] == {'listen': 'unix//run/sparkie-caddy/admin.sock|0600'}
    servers = config['apps']['http']['servers']
    assert set(servers) == {'dashboard', 'workloads'}
    for name, port in [('dashboard', 443), ('workloads', 10000)]:
        server = servers[name]
        assert server['listen'] == [f':{port}']
        assert server['tls_connection_policies']
        assert server['automatic_https']['disable_redirects']
        enrolled, other = server['routes']
        assert enrolled == {'@id': 'sparkie-' + name, 'match': [{'host': [host]}],
                            'handle': [{'handler': 'static_response', 'status_code': 503}], 'terminal': True}
        assert other == {'handle': [{'handler': 'static_response', 'status_code': 404}], 'terminal': True}
    policy, = config['apps']['tls']['automation']['policies']
    assert policy['subjects'] == [host]
    assert policy['issuers'][0]['challenges']['http']['disabled']


@pytest.mark.parametrize('origin', ['http://fleet.example.org', 'https://user@fleet.example.org',
                                    'https://fleet.example.org/private', 'https://fleet.example.org:8443'])
def test_bootstrap_rejects_an_origin_outside_the_dashboard_enrollment(origin):
    with pytest.raises(ValueError):
        render(origin)
