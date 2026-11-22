"""Qualified stages with controlled meters/transport; no hardware power actions."""
from copy import deepcopy
from datetime import datetime, timezone

import pytest

from sparkie_sparks.operations import NotDispatched
from sparkie_sparks.power import FleetPower
from test_power import HUB, MAPPING, NODE, NOW, OWNER, Meter, Transport, request, rig as base_rig, run

Q = {'spark2': {'revision': 'physical-trial-1', 'machine_id': NODE['machine_id'],
    'plug_fingerprint': MAPPING['spark2']['fingerprint'], 'running_min_watts': 30,
    'standby_max_watts': 8, 'hold_seconds': 30, 'max_gap_seconds': 15, 'off_seconds': 5}}


def rig(tmp_path):
    clock = [NOW.timestamp()]
    store, meter, transport, unused = base_rig(tmp_path)
    store.clock = lambda: clock[0]
    meter.row.update(on=True, watts=45)
    meter.apply_off, meter.lose_off = True, False
    def off(spark):
        meter.sent.append(('off', spark))
        if meter.apply_off: meter.row['on'] = False
        if meter.lose_off: raise TimeoutError('Lost Off acknowledgement')
    meter.off_after_shutdown = off
    transport.reachable = lambda node: not transport.unreachable
    def make(qualification=Q):
        return FleetPower(store, [NODE], MAPPING, hub_machine_id=HUB, matter=meter, transport=transport,
            activity=lambda node: [], qualification=qualification,
            clock=lambda: datetime.fromtimestamp(clock[0], timezone.utc))
    power = make()
    def tick(seconds=10, *, fresh=True):
        clock[0] += seconds
        if fresh:
            stamp = datetime.fromtimestamp(clock[0], timezone.utc).isoformat()
            meter.row.update(measured_at=stamp, observed_at=stamp)
    return store, meter, transport, power, tick, make


def progress(store, power, row):
    power.advance(row['id'], row['intent'])
    return store.reconcile(row['id'], observe=power.observe)


def low(meter, transport):
    meter.row['watts'] = 2
    transport.unreachable = True


def test_sleep_records_before_each_effect_and_waits_for_sustained_fresh_standby(tmp_path):
    store, meter, transport, power, tick, make = rig(tmp_path)
    row = request(store, 'sleep')
    assert run(store, power, row)['state'] == 'uncertain'
    assert transport.calls.count('sleep') == 1 and meter.sent == []
    low(meter, transport)
    for elapsed in (0, 10, 10):
        tick(elapsed)
        assert progress(store, power, row)['state'] == 'uncertain'
        assert meter.sent == []
    original = meter.off_after_shutdown
    def checked_off(spark):
        saved = power.sequence._get(row['id'])
        assert saved['phase'] == 'cut_sent' and saved['cut_sent_at'] is not None
        with store._db() as db:
            assert db.execute('SELECT operation FROM claims').fetchone()[0] == row['id']
        original(spark)
    meter.off_after_shutdown = checked_off
    tick(10)
    assert progress(store, power, row)['state'] == 'succeeded'
    assert meter.sent == [('off', 'spark2')]
    result = power.result(row['id'], row['intent'])
    assert result['ac_power_on'] is False and result['plug_off_sent'] is True
    assert 'plug is now off' in result['message']


@pytest.mark.parametrize('kind', ['high_watts', 'unknown_watts', 'reachable', 'stale_meter', 'wrong_plug'])
def test_silence_or_unverified_meter_never_authorizes_cut(tmp_path, kind):
    store, meter, transport, power, tick, make = rig(tmp_path)
    row = request(store, 'sleep')
    run(store, power, row)
    low(meter, transport)
    if kind == 'high_watts': meter.row['watts'] = 40
    if kind == 'unknown_watts': meter.row['watts'] = None
    if kind == 'reachable': transport.reachable = lambda node: True
    if kind == 'wrong_plug': meter.row['id'] = 'spark3'
    for _ in range(5):
        tick(10, fresh=kind != 'stale_meter')
        assert progress(store, power, row)['state'] == 'uncertain'
    assert meter.sent == []


def test_gap_after_proved_standby_requires_a_new_hold_before_cut(tmp_path):
    store, meter, transport, power, tick, make = rig(tmp_path)
    row = request(store, 'sleep')
    run(store, power, row)
    low(meter, transport)
    for _ in range(4):
        power.observe(row['id'], row['intent'])
        tick(10)
    assert power.sequence._get(row['id'])['phase'] == 'standby'
    tick(30)
    assert progress(store, power, row)['state'] == 'uncertain'
    assert meter.sent == []
    assert power.sequence._get(row['id'])['phase'] == 'shutdown_sent'


@pytest.mark.parametrize('applied', [False, True])
def test_lost_cut_reply_is_observed_never_repeated_after_restart(tmp_path, applied):
    store, meter, transport, power, tick, make = rig(tmp_path)
    row = request(store, 'sleep')
    run(store, power, row)
    low(meter, transport)
    meter.apply_off, meter.lose_off = applied, True
    for _ in range(3):
        progress(store, power, row)
        tick(10)
    with pytest.raises(TimeoutError):
        power.advance(row['id'], row['intent'])
    power = make()
    for _ in range(2):
        state = store.reconcile(row['id'], observe=power.observe)['state']
        if state == 'uncertain': progress(store, power, row)
        tick(10)
    assert state == ('succeeded' if applied else 'uncertain')
    assert meter.sent == [('off', 'spark2')] and transport.calls.count('sleep') == 1


def test_cancelled_shutdown_observes_standby_but_never_sends_off(tmp_path):
    store, meter, transport, power, tick, make = rig(tmp_path)
    row = request(store, 'sleep')
    run(store, power, row)
    store.cancel(OWNER, row['id'])
    low(meter, transport)
    for _ in range(4):
        with pytest.raises(NotDispatched): power.advance(row['id'], row['intent'])
        state = store.reconcile(row['id'], observe=power.observe)['state']
        tick(10)
    assert state == 'failed' and meter.sent == []
    assert power.result(row['id'], row['intent'])['ac_power_on'] is True


def test_wake_from_verified_off_records_on_once_then_waits_for_exact_machine(tmp_path):
    store, meter, transport, power, tick, make = rig(tmp_path)
    meter.row.update(on=False, watts=0)
    transport.unreachable = True
    row = request(store)
    assert run(store, power, row)['state'] == 'uncertain'
    assert meter.sent == []
    tick(5)
    assert progress(store, power, row)['state'] == 'uncertain'
    assert meter.sent == [('on', 'spark2')]
    power = make()
    tick(10)
    assert progress(store, power, row)['state'] == 'uncertain'
    assert meter.sent == [('on', 'spark2')]
    transport.unreachable = False
    assert progress(store, power, row)['state'] == 'succeeded'


def test_undefined_powered_unreachable_machine_is_never_cycled(tmp_path):
    store, meter, transport, power, tick, make = rig(tmp_path)
    low(meter, transport)
    assert run(store, power, request(store))['state'] == 'failed'
    assert meter.sent == []


def test_same_revision_with_changed_qualification_stops_continuation(tmp_path):
    store, meter, transport, power, tick, make = rig(tmp_path)
    row = request(store, 'sleep')
    run(store, power, row)
    changed = deepcopy(Q)
    changed['spark2']['standby_max_watts'] = 9
    power = make(changed)
    low(meter, transport)
    tick(30)
    with pytest.raises(NotDispatched): power.advance(row['id'], row['intent'])
    assert power.observe(row['id'], row['intent']) == 'unknown'
    assert meter.sent == []


@pytest.mark.parametrize('change', [{'workloads': ['a' * 64]}, {'machine_id': 'f' * 32}, {'docker_ready': False}])
def test_active_or_wrong_machine_cannot_start_shutdown(tmp_path, change):
    store, meter, transport, power, tick, make = rig(tmp_path)
    transport.inspection.update(change)
    assert run(store, power, request(store, 'sleep'))['state'] == 'failed'
    assert 'sleep' not in transport.calls and meter.sent == []


def test_observe_never_sends_next_effect_even_when_standby_is_ready(tmp_path):
    store, meter, transport, power, tick, make = rig(tmp_path)
    row = request(store, 'sleep')
    run(store, power, row)
    low(meter, transport)
    for _ in range(6):
        power.observe(row['id'], row['intent'])
        tick(10)
    assert meter.sent == []
    assert power.sequence._get(row['id'])['phase'] == 'standby'


def test_unknown_meter_interval_cannot_count_toward_off_dwell_before_wake(tmp_path):
    store, meter, transport, power, tick, make = rig(tmp_path)
    meter.row.update(on=False, watts=0)
    transport.unreachable = True
    row = request(store)
    run(store, power, row)
    meter.row['available'] = False
    tick(10)
    progress(store, power, row)
    meter.row['available'] = True
    tick(10)
    progress(store, power, row)
    assert meter.sent == []
    tick(5)
    progress(store, power, row)
    assert meter.sent == [('on', 'spark2')]


def test_repeated_cached_off_sample_does_not_establish_a_fresh_dwell(tmp_path):
    store, meter, transport, power, tick, make = rig(tmp_path)
    meter.row.update(on=False, watts=0)
    transport.unreachable = True
    row = request(store)
    run(store, power, row)
    tick(10, fresh=False)
    progress(store, power, row)
    assert meter.sent == []


def test_missing_meter_invalidates_already_qualified_standby_before_cut(tmp_path):
    store, meter, transport, power, tick, make = rig(tmp_path)
    row = request(store, 'sleep')
    run(store, power, row)
    low(meter, transport)
    for _ in range(4):
        power.observe(row['id'], row['intent'])
        tick(10)
    assert power.sequence._get(row['id'])['phase'] == 'standby'
    meter.row['available'] = False
    power.advance(row['id'], row['intent'])
    assert meter.sent == [] and power.sequence._get(row['id'])['phase'] == 'shutdown_sent'
