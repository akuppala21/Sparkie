from types import SimpleNamespace
import json
import sys

from sparkie_sparks.collector import collect_one


def test_local_collection_still_requires_expected_machine_identity():
    node = {'id': 'spark1', 'local': True, 'user': 'owner', 'address': 'localhost', 'hostname': 'hub'}
    calls = []
    def run(args, **kwargs):
        calls.append(args)
        return SimpleNamespace(returncode=0, stdout=json.dumps({'hostname': 'compute', 'metrics': {}}))
    result = collect_one(node, runner=run)
    assert calls == [[sys.executable, '-']]
    assert result['state'] == 'unknown'
    assert result['issue'] == 'identity_mismatch'
