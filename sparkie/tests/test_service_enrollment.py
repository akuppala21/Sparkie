"""Private enrollment uses the existing cluster authority and preserves artifact directories."""

import hashlib
import json
from pathlib import Path
import sys

import pytest

DEPLOY = Path(__file__).parents[1] / 'deploy'
sys.path.insert(0, str(DEPLOY))
from service_enrollment import render

sys.path.remove(str(DEPLOY))
from sparkie_sparks.service_definitions import ARTIFACTS, GLM, recipe


def test_private_worker_archive_and_manifest_bind_exact_code_identity_and_per_node_data(tmp_path):
    archive = tmp_path / 'worker.pyz'
    archive.write_bytes(b'sealed test archive')
    compute = {
        'schema': 1,
        'controller': '0' * 32,
        'hub_machine_id': '1' * 32,
        'nodes': [{'user': 'operator', 'identity': {'spark_id': 'spark4', 'machine_id': '4' * 32}}],
    }
    root = tmp_path / 'enrolled'
    enrollment = {'spark4': {ARTIFACTS: '/srv/artifacts', GLM: '/srv/reviewed-weights'}}
    report = render(archive, compute, enrollment, root)
    catalog = json.loads((root / 'services.json').read_bytes())
    config = json.loads((root / 'spark4-services.json').read_bytes())
    node = catalog['nodes'][0]
    assert node['executable'].endswith(report['archive_sha256'] + '/worker.pyz')
    assert node['config'].endswith(report['files']['spark4-services.json'] + '/worker.json')
    assert (
        node['machine'] == config['machine'] == '4' * 32 and catalog['controller'] == compute['controller']
    )
    assert catalog['services'][GLM] == {'sparks': ['spark4'], 'revision': recipe(GLM, ()).revision}
    assert (
        config['data'] == enrollment['spark4'] and (root / 'services.json').stat().st_mode & 0o777 == 0o600
    )
    assert (
        report['files']['services.json']
        == hashlib.sha256((root / 'services.json').read_bytes()).hexdigest()
    )
    with pytest.raises(FileExistsError):
        render(archive, compute, enrollment, root)


@pytest.mark.parametrize(
    'names',
    [
        {'spark1': {ARTIFACTS: '/srv/data'}},
        {'spark4': {'unreviewed': '/srv/data'}},
        {'spark4': {ARTIFACTS: '../../private'}},
    ],
)
def test_malformed_enrollment_never_writes_authority(tmp_path, names):
    archive = tmp_path / 'worker.pyz'
    archive.write_bytes(b'fixture')
    output = tmp_path / 'output'
    compute = {
        'schema': 1,
        'controller': '0' * 32,
        'hub_machine_id': '1' * 32,
        'nodes': [{'user': 'operator', 'identity': {'spark_id': 'spark4', 'machine_id': '4' * 32}}],
    }
    with pytest.raises(ValueError):
        render(archive, compute, names, output)
    assert not output.exists()
