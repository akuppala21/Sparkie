"""Offline public enrollment checks. These values have no route or hardware lease."""
import copy
import json
from pathlib import Path
import runpy

import pytest

ROOT = Path(__file__).resolve().parents[1]
substitutions = runpy.run_path(str(ROOT/'tools/prepare_site.py'))['substitutions']
EXAMPLE = json.loads((ROOT/'config/site.example.json').read_bytes())


def fixture():
    site = {'account': 'testowner', 'dashboard_host': 'test-hub.example.test', 'nodes': {}}
    for number in range(1, 5):
        node = {'hostname': f'test-node-{number}', 'machine_id': str(number) * 32}
        if number > 1:
            node['address'] = f'100.64.1.{number}'
        site['nodes'][f'spark{number}'] = node
    return site


def test_distinct_explicit_enrollment():
    values = substitutions(EXAMPLE, fixture())
    assert values[EXAMPLE['nodes']['spark1']['machine_id']] == '1' * 32
    assert len(values) == 13


@pytest.mark.parametrize('node,key,value', [
    ('spark2', 'machine_id', '1' * 32), ('spark2', 'machine_id', '0' * 32),
    ('spark2', 'hostname', 'test-node-1'), ('spark2', 'hostname', 'spark1'),
    ('spark4', 'address', '100.64.1.3'), ('spark4', 'address', '127.0.0.1'),
    ('spark3', 'hostname', 'bad;command'), ('spark1', 'machine_id', 'unpinned'),
])
def test_wrong_enrollment_refused(node, key, value):
    site = fixture()
    site['nodes'][node][key] = value
    with pytest.raises(ValueError):
        substitutions(EXAMPLE, site)


def test_example_credentials_and_root_are_rejected():
    for site in (copy.deepcopy(EXAMPLE), dict(fixture(), token='forbidden'), dict(fixture(), account='root')):
        with pytest.raises(ValueError):
            substitutions(EXAMPLE, site)


def test_site_accepts_distinct_private_lan_addresses():
    site = fixture()
    for number, address in enumerate(('10.1.2.4', '172.20.2.4', '192.168.2.4'), 2):
        site['nodes'][f'spark{number}']['address'] = address
    values = substitutions(EXAMPLE, site)
    for number in range(2, 5):
        spark = f'spark{number}'
        assert values[EXAMPLE['nodes'][spark]['address']] == site['nodes'][spark]['address']


@pytest.mark.parametrize('address', ['0.0.0.0', '8.8.8.8', '172.32.4.1', '169.254.1.1',
                                      '224.0.0.1', '192.0.2.3', '::1', 'bad-host', 167772161])
def test_site_refuses_non_lan_endpoints(address):
    site = fixture()
    site['nodes']['spark3']['address'] = address
    with pytest.raises(ValueError, match='private compute'):
        substitutions(EXAMPLE, site)
