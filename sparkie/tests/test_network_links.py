from datetime import datetime, timezone
import json
from types import SimpleNamespace

from sparkie_sparks.probe import network_links
from sparkie_sparks.collector import collect_one, write_snapshot
from sparkie_sparks.fleet import read_status


def test_only_physical_ports_are_read_and_down_or_unknown_does_not_claim_speed(tmp_path):
    for name, carrier, speed in (('connectx0', '1', '200000'), ('ethernet0', '0', '10000'),
                                 ('wifi0', '1', '-1'), ('ethernet1', 'unknown', '1000')):
        path = tmp_path / name
        (path / 'device').mkdir(parents=True)
        (path / 'carrier').write_text(carrier)
        (path / 'speed').write_text(speed)
        if name == 'wifi0': (path / 'wireless').mkdir()
    (tmp_path / 'tailscale0').mkdir()
    rows = network_links(tmp_path)
    assert [row['name'] for row in rows] == ['connectx0', 'ethernet0', 'ethernet1', 'wifi0']
    assert rows[0] == {'name': 'connectx0', 'kind': 'ethernet', 'state': 'up', 'speed_mbps': 200000}
    assert [row['speed_mbps'] for row in rows[1:]] == [None, None, None]
    assert rows[2]['state'] == 'unknown' and rows[3]['kind'] == 'wifi'
    assert all('peer' not in row for row in rows)
    assert network_links(tmp_path / 'missing') is None


def test_verified_collector_to_native_read_preserves_links_but_never_untrusted_peer_claims(tmp_path):
    now = datetime.now(timezone.utc)
    node = {'id': 'spark2', 'hostname': 'compute2', 'address': '192.0.2.2', 'user': 'owner'}
    data = {'hostname': 'compute2', 'network_links': [
        {'name': 'connectx0', 'kind': 'ethernet', 'state': 'up', 'speed_mbps': 200000,
         'peer': 'unverified-spark4', 'token': 'private'}]}
    row = collect_one(node, runner=lambda *args, **kw: SimpleNamespace(returncode=0, stdout=json.dumps(data)), clock=lambda: now)
    path = tmp_path / 'snapshot.json'
    write_snapshot(path, {'schema': 1, 'sparks': [row]})
    result = read_status(path=path, now=now)
    assert result['sparks'][0]['network_links'] == [
        {'name': 'connectx0', 'kind': 'ethernet', 'state': 'up', 'speed_mbps': 200000}]
    assert 'unverified-spark4' not in json.dumps(result) and 'private' not in json.dumps(result)


def test_invalid_link_data_is_unknown_not_fabricated_topology(tmp_path):
    now = datetime.now(timezone.utc)
    path = tmp_path / 'snapshot.json'
    path.write_text(json.dumps({'schema': 1, 'sparks': [{'id': 'spark2', 'state': 'online',
        'observed_at': now.isoformat(), 'network_links': [
            {'name': '<script>injection</script>', 'kind': 'ethernet', 'state': 'up', 'speed_mbps': 200000}]}]}))
    result = read_status(path=path, now=now)
    assert result['sparks'][0]['network_links'] is None
    assert '<script>' not in json.dumps(result)
