from datetime import datetime, timedelta, timezone
import json

import pytest

from sparkie_sparks.placement import AwakeFirst


def test_fresh_awake_compute_precedes_powering_another_without_remote_probes(tmp_path):
    path = tmp_path / 'snapshot.json'
    now = datetime.now(timezone.utc)
    rows = [{'id': spark, 'state': state, 'observed_at': now.isoformat()}
            for spark, state in [('spark1', 'online'), ('spark2', 'off'), ('spark3', 'off'), ('spark4', 'online')]]
    path.write_text(json.dumps({'schema': 1, 'sparks': rows}))
    pick = AwakeFirst(['spark2', 'spark3', 'spark4'], snapshot=path)
    assert pick('native', None) == ('spark4', 'spark2', 'spark3')
    rows[-1]['observed_at'] = (now - timedelta(hours=1)).isoformat()
    path.write_text(json.dumps({'schema': 1, 'sparks': rows}))
    assert pick('native', None) == ('spark2', 'spark3', 'spark4')


def test_missing_snapshot_keeps_fixed_candidates_and_does_not_probe_or_include_hub(tmp_path):
    pick = AwakeFirst(['spark4', 'spark2'], snapshot=tmp_path / 'missing')
    assert pick('native', None) == ('spark4', 'spark2')
    with pytest.raises(ValueError):
        AwakeFirst(['spark1', 'spark2'], snapshot=None)


def test_identity_mismatch_never_gets_awake_preference():
    pick = AwakeFirst(['spark2', 'spark4'], snapshot='unused', reader=lambda **kwargs: {
        'available': True, 'sparks': [
            {'id': 'spark2', 'observed_state': 'online', 'stale': False, 'issue': 'wrong identity'},
            {'id': 'spark4', 'observed_state': 'online', 'stale': False}]})
    assert pick('native', None) == ('spark4', 'spark2')
