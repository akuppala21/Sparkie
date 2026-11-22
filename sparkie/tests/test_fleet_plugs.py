from datetime import datetime, timezone

from sparkie_sparks.collector import collect, write_snapshot
from sparkie_sparks.fleet import read_status

NOW = datetime(2026, 11, 19, 10, tzinfo=timezone.utc)
NODE = {'id': 'spark2', 'hostname': 'compute2-host.invalid', 'user': 'owner', 'address': '192.0.2.2'}


def test_confirmed_plug_off_skips_ssh_and_preserves_source(tmp_path):
    def no_command(*args, **kwargs):
        raise AssertionError('A powered-off Spark must not be contacted by a status read.')
    result = collect([NODE], runner=no_command, clock=lambda: NOW, plug_readings=[{
        'id': 'spark2', 'available': True, 'on': False, 'watts': 0,
        'cumulative_kwh': 10, 'observed_at': NOW.isoformat(), 'source': 'Matter controller report',
    }])
    path = tmp_path / 'fleet.json'
    write_snapshot(path, result)
    row = read_status(path=path, now=NOW)['sparks'][0]
    assert row['observed_state'] == 'off'
    assert row['wall']['watts'] == 0
    assert row['wall']['source'] == 'Matter controller report'
    assert row['metrics'] == {}


def test_unavailable_plug_is_not_evidence_that_the_spark_is_off():
    from types import SimpleNamespace
    calls = []
    def run(args, **kwargs):
        calls.append(args)
        return SimpleNamespace(returncode=255, stdout='')
    result = collect([NODE], runner=run, clock=lambda: NOW, plug_readings=[{
        'id': 'spark2', 'available': False, 'on': False, 'observed_at': NOW.isoformat(),
    }])
    assert len(calls) == 1
    assert result['sparks'][0]['state'] == 'unreachable'
    assert 'wall' not in result['sparks'][0]


def test_verified_device_measurement_source_survives_the_fleet_reader(tmp_path):
    def no_command(*args, **kwargs):
        raise AssertionError('A confirmed powered-off Spark stays asleep.')
    result = collect([NODE], runner=no_command, clock=lambda: NOW, plug_readings=[{
        'id': 'spark2', 'available': True, 'on': False, 'watts': 0,
        'cumulative_kwh': 10, 'observed_at': NOW.isoformat(), 'source': 'Matter device read',
    }])
    path = tmp_path / 'fleet.json'
    write_snapshot(path, result)
    row = read_status(path=path, now=NOW)['sparks'][0]
    assert row['observed_state'] == 'off'
    assert row['wall']['source'] == 'Matter device read'
    assert row['wall']['observed_at'] == NOW.isoformat()


def test_missing_device_measurement_is_not_a_new_wall_reading():
    from types import SimpleNamespace
    calls = []
    def run(args, **kwargs):
        calls.append(args)
        return SimpleNamespace(returncode=255, stdout='')
    result = collect([NODE], runner=run, clock=lambda: NOW, plug_readings=[{
        'id': 'spark2', 'available': False, 'on': None, 'watts': None,
        'observed_at': None, 'measured_at': None, 'source': 'Matter device read',
    }])
    assert len(calls) == 1
    assert result['sparks'][0]['state'] == 'unreachable'
    assert 'wall' not in result['sparks'][0]
