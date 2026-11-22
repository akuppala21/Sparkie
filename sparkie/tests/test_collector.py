from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace

import pytest

from sparkie_sparks.collector import collect, collect_one, load_inventory, write_snapshot
from sparkie_sparks.fleet import read_status

NOW = datetime(2026, 11, 19, 10, tzinfo=timezone.utc)
NODE = {'id': 'spark4', 'hostname': 'compute4-host.invalid', 'address': '192.0.2.4', 'user': 'owner',
        'infrastructure': ['assistant-model']}


def reply(**changes):
    return {'hostname': 'compute4-host.invalid', 'observed_at': NOW.isoformat(),
            'metrics': {'memory_total_bytes': 128 * 1024**3, 'memory_available_bytes': 52 * 1024**3,
                        'gpu_utilization_percent': 12, 'private_key': 'must-not-be-displayed'},
            'workloads': [{'id': 'a' * 64, 'name': 'assistant-model', 'image': 'example/model:1'},
                          {'id': 'b' * 64, 'name': 'project-job', 'image': 'example/job:1'}], **changes}


def runner(data, returncode=0):
    return lambda *args, **kwargs: SimpleNamespace(returncode=returncode, stdout=json.dumps(data), stderr='private-error')


def test_fixed_read_command_and_verified_identity(tmp_path):
    calls = []
    def run(args, **kwargs):
        calls.append((args, kwargs))
        return runner(reply())()
    result = collect([NODE], runner=run, clock=lambda: NOW)
    path = tmp_path / 'snapshot.json'
    write_snapshot(path, result)
    row = read_status(path=path, now=NOW)['sparks'][0]
    assert row['observed_state'] == 'online'
    assert row['metrics']['memory_available_bytes'] == 52 * 1024**3
    assert row['workloads'][0]['kind'] == 'infrastructure'
    assert row['workloads'][1]['kind'] == 'workload'
    assert 'private_key' not in json.dumps(row)
    assert calls[0][0][-3:] == ['owner@192.0.2.4', 'python3', '-']
    assert 'StrictHostKeyChecking=yes' in calls[0][0]
    assert calls[0][1]['input'] == Path(__import__('sparkie_sparks.probe', fromlist=['']).__file__).read_text()
    assert len(calls) == 1


def test_ssh_failure_is_not_evidence_of_power_off():
    result = collect_one(NODE, runner=runner({}, 255), clock=lambda: NOW)
    assert result == {'id': 'spark4', 'state': 'unreachable', 'observed_at': NOW.isoformat()}


def test_timeout_is_a_finished_unreachable_observation():
    def fail(*args, **kwargs):
        raise subprocess.TimeoutExpired('ssh', 20)
    result = collect_one(NODE, runner=fail, clock=lambda: NOW)
    assert result['state'] == 'unreachable'


def test_wrong_machine_cannot_supply_workloads_or_metrics():
    result = collect_one(NODE, runner=runner(reply(hostname='another-machine')), clock=lambda: NOW)
    assert result['state'] == 'unknown'
    assert result['issue'] == 'identity_mismatch'
    assert 'metrics' not in result and 'workloads' not in result


@pytest.mark.parametrize('change', [
    {'address': '-oProxyCommand=bad'}, {'address': 'host; reboot'}, {'user': 'root@other'},
    {'id': ['spark4']}, {'hostname': None}, {'infrastructure': ['bad\nname']},
])
def test_inventory_rejects_targets_that_can_alter_the_command(tmp_path, change):
    path = tmp_path / 'inventory.json'
    path.write_text(json.dumps({'schema': 1, 'nodes': [{**NODE, **change}]}))
    with pytest.raises(ValueError):
        load_inventory(path)


def test_repeated_identity_is_not_two_machines(tmp_path):
    path = tmp_path / 'inventory.json'
    path.write_text(json.dumps({'schema': 1, 'nodes': [NODE, NODE]}))
    with pytest.raises(ValueError):
        load_inventory(path)


def test_missing_docker_read_is_unknown_workload_state(tmp_path):
    path = tmp_path / 'snapshot.json'
    write_snapshot(path, collect([NODE], runner=runner(reply(workloads=None)), clock=lambda: NOW))
    row = read_status(path=path, now=NOW)['sparks'][0]
    assert row['workloads'] is None
    write_snapshot(path, collect([NODE], runner=runner(reply(workloads=[])), clock=lambda: NOW))
    assert read_status(path=path, now=NOW)['sparks'][0]['workloads'] == []


def test_invalid_refresh_preserves_previous_complete_observation(tmp_path):
    path = tmp_path / 'snapshot.json'
    write_snapshot(path, collect([NODE], runner=runner(reply()), clock=lambda: NOW))
    before = path.read_bytes()
    with pytest.raises(ValueError):
        write_snapshot(path, {'schema': 1, 'sparks': [{'id': 'spark9', 'state': 'off'}]})
    assert path.read_bytes() == before
    assert not list(tmp_path.glob('.fleet-*'))


def test_invalid_measurements_do_not_become_zero_or_leak_fields(tmp_path):
    path = tmp_path / 'snapshot.json'
    result = collect([NODE], runner=runner(reply(metrics={
        'gpu_utilization_percent': 101, 'gpu_power_watts': True,
        'memory_available_bytes': -1, 'disk_free_bytes': 123, 'token': 'private',
    })), clock=lambda: NOW)
    write_snapshot(path, result)
    assert read_status(path=path, now=NOW)['sparks'][0]['metrics'] == {'disk_free_bytes': 123}


def test_container_text_is_bounded_before_reaching_ui(tmp_path):
    path = tmp_path / 'snapshot.json'
    result = collect([NODE], runner=runner(reply(workloads=[{
        'id': 'a' * 64, 'name': '<script>bad</script>', 'image': 'image',
    }])), clock=lambda: NOW)
    write_snapshot(path, result)
    row = read_status(path=path, now=NOW)['sparks'][0]
    assert row['workloads'] is None
    assert '<script>' not in json.dumps(row)


def test_collector_uses_device_measurements_and_reports_unavailable_samples(tmp_path, monkeypatch, capsys):
    from sparkie_sparks import collector, matter
    mapping = {'spark4': {'node': 14, 'fingerprint': 'a' * 64}}
    inventory, plugs = tmp_path / 'inventory.json', tmp_path / 'plugs.json'
    inventory.write_text(json.dumps({'schema': 1, 'nodes': [NODE]}))
    plugs.write_text(json.dumps(mapping))
    calls = []
    class DeviceReader:
        def measurements(self, configured):
            calls.append(configured)
            return [{'id': 'spark4', 'available': False, 'on': None, 'watts': None,
                     'cumulative_kwh': None, 'observed_at': None, 'source': 'Matter device read'}]
        def nodes(self):
            raise AssertionError('Inventory cache cannot supply meter samples.')
    monkeypatch.setattr(matter, 'MatterReader', DeviceReader)
    monkeypatch.setattr(collector, 'collect_one', lambda node, **kwargs: {
        'id': node['id'], 'state': 'unreachable', 'observed_at': NOW.isoformat()})
    database = tmp_path / 'energy.sqlite'
    monkeypatch.setattr('sys.argv', ['collector', '--inventory', str(inventory), '--plugs', str(plugs),
                                   '--output', str(tmp_path / 'fleet.json'), '--energy-database', str(database)])
    assert collector.main() == 0
    assert calls == [mapping]
    assert 'could not supply fresh readings' in json.loads(capsys.readouterr().out)['plug_problem']
    assert not database.exists()
