"""Independent inert regressions: real TCP classifier, fake meter/time/dispatch."""
from copy import deepcopy
import errno
from types import SimpleNamespace

import pytest

from sparkie_sparks.operations import NotDispatched
from sparkie_sparks.power import PowerTransport
from sparkie_sparks.power_maintenance import advance_power
from test_power import NODE, OWNER, request, run
from test_power_sequence import Q, rig, progress, low


def tcp(error=errno.EHOSTUNREACH, cls=PowerTransport):
    def connect(address, *, timeout):
        assert address == (NODE['address'], 22) and 0 < timeout <= 3
        raise OSError(error, 'Injected socket result')
    return cls(connect=connect).reachable


def prepared(tmp_path):
    store, meter, transport, power, tick, make = rig(tmp_path)
    profile = deepcopy(Q)
    profile['spark2'].update(hold_seconds=60, off_seconds=10)
    power = make(profile)
    transport.reachable = tcp()
    row = request(store, 'sleep')
    assert run(store, power, row)['state'] == 'uncertain'
    low(meter, transport)
    return store, meter, transport, power, tick, make, row


@pytest.mark.parametrize('code, expected', [
    (errno.EHOSTUNREACH, False), (errno.ECONNREFUSED, False), (errno.ETIMEDOUT, False),
    (errno.ENETUNREACH, None), (errno.EACCES, None), (errno.EPERM, None),
    (errno.ENETDOWN, None), (errno.EADDRNOTAVAIL, None), (errno.EMFILE, None),
    (errno.EIO, None), (9999, None),
])
def test_real_classifier_has_narrow_absence_result(code, expected):
    assert tcp(code)(NODE) is expected


def test_reachable_connection_is_not_absent():
    from contextlib import nullcontext
    assert PowerTransport(connect=lambda *a, **kw: nullcontext()).reachable(NODE) is True


def test_errno113_requires_entire_continuous_hold_and_records_before_cut(tmp_path):
    store, meter, transport, power, tick, make, row = prepared(tmp_path)
    original_off = meter.off_after_shutdown
    def checked(spark):
        record = power.sequence._get(row['id'])
        assert record['phase'] == 'cut_sent' and record['cut_sent_at'] is not None
        assert record['last_sample'] - record['low_since'] == 60 and record['samples'] == 7
        assert transport.calls.count('sleep') == 1
        original_off(spark)
    meter.off_after_shutdown = checked
    for _ in range(6):
        assert progress(store, power, row)['state'] == 'uncertain'
        assert meter.sent == []
        tick(10)
    assert progress(store, power, row)['state'] == 'succeeded'
    assert meter.sent == [('off', 'spark2')]


@pytest.mark.parametrize('case', ['high', 'unknown', 'stale', 'wrong_plug', 'cached',
    'network', 'denied', 'permission', 'unknown_error'])
def test_errno113_or_other_socket_error_does_not_replace_shutdown_evidence(tmp_path, case):
    store, meter, transport, power, tick, make, row = prepared(tmp_path)
    if case == 'high': meter.row['watts'] = 40
    if case == 'unknown': meter.row['watts'] = None
    if case == 'wrong_plug': meter.row['id'] = 'spark3'
    if case == 'cached': meter.row['source'] = 'Matter controller report'
    error = {'network': errno.ENETUNREACH, 'denied': errno.EACCES,
        'permission': errno.EPERM, 'unknown_error': errno.EIO}.get(case)
    if error is not None: transport.reachable = tcp(error)
    for _ in range(9):
        assert progress(store, power, row)['state'] == 'uncertain'
        tick(10, fresh=case != 'stale')
    assert meter.sent == [] and transport.calls.count('sleep') == 1


def test_host_unreachable_without_authorized_shutdown_never_cycles(tmp_path):
    store, meter, transport, power, tick, make = rig(tmp_path)
    transport.reachable = tcp()
    low(meter, transport)
    assert run(store, power, request(store))['state'] == 'failed'
    assert meter.sent == [] and 'sleep' not in transport.calls


def test_prepared_but_unapproved_request_cannot_dispatch(tmp_path):
    store, meter, transport, power, tick, make = rig(tmp_path)
    transport.reachable = tcp()
    row = request(store, 'sleep')
    with pytest.raises(NotDispatched): power.dispatch(row['id'], row['intent'])
    assert transport.calls == [] and meter.sent == []


@pytest.mark.parametrize('kind', ['cancelled', 'revoked', 'claim_lost'])
def test_authority_is_checked_again_after_errno113_standby(tmp_path, kind):
    store, meter, transport, power, tick, make, row = prepared(tmp_path)
    for _ in range(7):
        power.observe(row['id'], row['intent'])
        tick(10)
    assert power.sequence._get(row['id'])['phase'] == 'standby'
    if kind == 'cancelled': store.cancel(OWNER, row['id'])
    if kind == 'revoked': power.owner_authorizer = lambda row: False
    if kind == 'claim_lost':
        with store._db() as db: db.execute('DELETE FROM claims WHERE operation=?', (row['id'],))
    with pytest.raises(NotDispatched): power.advance(row['id'], row['intent'])
    assert meter.sent == [] and transport.calls.count('sleep') == 1


def test_repeated_sample_does_not_extend_hold_or_observe_send_off(tmp_path):
    store, meter, transport, power, tick, make, row = prepared(tmp_path)
    for _ in range(100): power.observe(row['id'], row['intent'])
    assert power.sequence._get(row['id'])['samples'] == 1
    assert meter.sent == []


@pytest.mark.parametrize('applied', [False, True])
def test_lost_cut_reply_restarts_without_duplicate_dispatch(tmp_path, applied):
    store, meter, transport, power, tick, make, row = prepared(tmp_path)
    for _ in range(6):
        progress(store, power, row)
        tick(10)
    meter.apply_off, meter.lose_off = applied, True
    with pytest.raises(TimeoutError): power.advance(row['id'], row['intent'])
    profile = deepcopy(Q)
    profile['spark2'].update(hold_seconds=60, off_seconds=10)
    power = make(profile)
    for _ in range(3):
        state = store.reconcile(row['id'], observe=power.observe)['state']
        if state == 'uncertain': progress(store, power, row)
        tick(10)
    assert state == ('succeeded' if applied else 'uncertain')
    assert meter.sent == [('off', 'spark2')] and transport.calls.count('sleep') == 1


def test_existing_maintenance_finishes_errno113_hold_without_new_operation(tmp_path):
    store, meter, transport, power, tick, make, row = prepared(tmp_path)
    controls = SimpleNamespace(store=store, binding=lambda: SimpleNamespace(generation=OWNER.generation))
    started = store.clock()
    results = advance_power(controls, power, clock=store.clock, sleep=tick)
    assert results == [{'id': row['id'], 'state': 'succeeded'}]
    assert store.clock() - started == 60 and meter.sent == [('off', 'spark2')]
    assert transport.calls.count('sleep') == 1
