from datetime import datetime, timedelta, timezone
import hashlib
import json

import pytest

from sparkie_sparks.energy import read_energy
from sparkie_sparks.matter import MatterReader, readings, save_readings, validate_mapping

NOW = datetime(2026, 11, 19, 10, tzinfo=timezone.utc)
UID = 'fixture-physical-plug'
FINGERPRINT = hashlib.sha256(UID.encode()).hexdigest()
MAPPING = {'spark2': {'node': 12, 'fingerprint': FINGERPRINT}}


def node(**attributes):
    return {'node_id': 12, 'available': True, 'attributes': {
        '0/40/18': UID, '1/6/0': True, '1/144/8': 42018, '1/145/1': {'0': 7774000}, **attributes}}


def test_matter_units_and_counter_take_precedence_over_power_estimates(tmp_path):
    path = tmp_path / 'energy.sqlite'
    first = readings([node()], MAPPING, now=NOW)
    assert first[0]['watts'] == 42.018
    assert first[0]['cumulative_kwh'] == 7.774
    save_readings(path, first, MAPPING)
    save_readings(path, readings([node(**{'1/145/1': {'0': 7775000}})], MAPPING,
                               now=NOW + timedelta(minutes=1)), MAPPING)
    result = read_energy(path=path, now=NOW + timedelta(minutes=2))
    assert result['recorded_kwh'] == 0.001
    assert result['estimated_from_power'] is False


def test_reused_controller_number_cannot_become_a_different_sparks_plug():
    row = readings([node(**{'0/40/18': 'replacement'})], MAPPING, now=NOW)[0]
    assert row['available'] is False
    assert row['on'] is None
    assert row['cumulative_kwh'] is None


def test_unavailable_plug_does_not_repeat_cached_measurements():
    row = readings([{**node(), 'available': False}], MAPPING, now=NOW)[0]
    assert row['available'] is False and row['watts'] is None


def test_spark_one_mapping_must_remain_read_only():
    mapping = {'spark1': {'node': 10, 'fingerprint': FINGERPRINT}}
    with pytest.raises(ValueError):
        validate_mapping(mapping)
    mapping['spark1']['read_only'] = True
    assert readings([{**node(), 'node_id': 10}], mapping, now=NOW)[0]['read_only'] is True


def test_two_sparks_cannot_share_a_plug_identity():
    with pytest.raises(ValueError):
        validate_mapping({**MAPPING, 'spark3': {'node': 13, 'fingerprint': FINGERPRINT}})


@pytest.mark.parametrize('url', ['ws://192.0.2.1:5580/ws', 'https://localhost', 'ws://owner:secret@localhost/ws'])
def test_controller_address_is_private_and_not_an_external_destination(url):
    with pytest.raises(ValueError):
        MatterReader(url)


def test_reader_uses_only_get_nodes_and_ignores_unrelated_messages():
    class Socket:
        def __init__(self): self.sent = []; self.count = 0
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def send(self, message): self.sent.append(json.loads(message))
        def recv(self, **kwargs):
            self.count += 1
            if self.count == 1: return '{}'
            if self.count == 2: return '{"event":"node_updated"}'
            return json.dumps({'message_id': self.sent[0]['message_id'], 'result': [node()]})
    socket = Socket()
    assert MatterReader(connect=lambda *args, **kwargs: socket).nodes() == [node()]
    assert len(socket.sent) == 1
    assert socket.sent[0]['command'] == 'get_nodes'
    assert socket.sent[0]['args'] == {}


def controller(respond, *, clock=lambda: NOW):
    requests = []
    class Socket:
        def __init__(self): self.first = True; self.request = None
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def send(self, message):
            self.request = json.loads(message)
            requests.append(self.request)
        def recv(self, **kwargs):
            if self.first:
                self.first = False
                return '{"schema_version":14}'
            result = respond(self.request)
            return json.dumps({'message_id': self.request['message_id'], **result})
    return MatterReader(connect=lambda *args, **kwargs: Socket(), clock=clock), requests


def test_meter_samples_use_completed_device_reads_and_never_inventory_cache():
    now = [NOW]
    def respond(request):
        assert request['command'] == 'read_attribute'
        assert request['args'] == {'node_id': 12, 'attribute_path': ['0/40/18', '*/6/0', '*/144/8', '*/145/1']}
        now[0] += timedelta(seconds=2)
        return {'result': node(**{'1/144/8': 51000})['attributes']}
    reader, requests = controller(respond, clock=lambda: now[0])
    row = reader.measurements(MAPPING)[0]
    assert row['available'] and row['watts'] == 51
    assert row['observed_at'] == row['measured_at'] == now[0].isoformat()
    assert row['source'] == 'Matter device read'
    assert len(requests) == 1


def test_cached_available_node_cannot_supply_energy_when_device_read_fails(tmp_path):
    def respond(request):
        return {'result': [node()]} if request['command'] == 'get_nodes' else {'error_code': 6, 'details': 'device offline'}
    reader, requests = controller(respond)
    assert reader.nodes()[0]['available'] is True
    row = reader.measurements(MAPPING)[0]
    assert row['available'] is False
    assert row['observed_at'] is None and row['measured_at'] is None
    assert row['watts'] is None and row['cumulative_kwh'] is None and row['on'] is None
    path = tmp_path / 'energy.sqlite'
    save_readings(path, [row], MAPPING)
    assert not path.exists()
    assert [request['command'] for request in requests] == ['get_nodes', 'read_attribute']


def test_one_missing_device_does_not_drop_other_devices_or_invent_samples(tmp_path):
    import sqlite3
    other_uid = 'second-physical-plug'
    mapping = {**MAPPING, 'spark3': {'node': 13, 'fingerprint': hashlib.sha256(other_uid.encode()).hexdigest()}}
    def respond(request):
        if request['args']['node_id'] == 12:
            raise TimeoutError('No device reply')
        return {'result': node(**{'0/40/18': other_uid})['attributes']}
    reader, requests = controller(respond)
    rows = reader.measurements(mapping)
    assert rows[0]['available'] is False and rows[1]['available'] is True
    path = tmp_path / 'energy.sqlite'
    save_readings(path, rows, mapping)
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT spark,value,kind FROM readings').fetchall() == [('spark3', 7.774, 'counter')]
    assert len(requests) == 2


@pytest.mark.parametrize('attributes', [
    {'0/40/18': UID},
    {'0/40/18': 'different-plug', '1/6/0': True},
    {'0/40/18': UID, '1/6/0': True, '2/6/0': False},
    {'0/40/18': UID, '1/6/0': True, '1/144/8': 10, '2/144/8': 20},
    {'0/40/18': UID, '1/6/0': True, '1/145/1': {'0': 1}, '2/145/1': {'0': 2}},
    {'0/40/18': UID, '1/6/0': 'true'},
    None, [],
])
def test_missing_wrong_or_ambiguous_device_identity_and_endpoints_fail_unavailable(attributes):
    reader, _ = controller(lambda request: {'result': attributes})
    row = reader.measurements(MAPPING)[0]
    assert row['available'] is False and row['observed_at'] is None
    assert row['watts'] is None and row['cumulative_kwh'] is None


def test_unique_reported_endpoints_are_used_and_unsupported_meters_stay_missing():
    reader, _ = controller(lambda request: {'result': {'0/40/18': UID, '2/6/0': False, '4/144/8': 3000}})
    row = reader.measurements(MAPPING)[0]
    assert row['available'] is True and row['on'] is False
    assert row['watts'] == 3 and row['cumulative_kwh'] is None
