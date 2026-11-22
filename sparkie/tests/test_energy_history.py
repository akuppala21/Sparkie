"""Preserve actual old monthly usage without manufacturing finer history."""
from copy import deepcopy
from datetime import datetime, timedelta
import json
import sqlite3

import pytest

from sparkie_sparks.energy import ZONE, read_energy, record_power
from sparkie_sparks.energy_history import import_monthly


def retained(tmp_path):
    since = datetime(2026, 11, 18, 12, tzinfo=ZONE)
    until = since + timedelta(hours=2)
    row = {'kWh': 0.4, 'coverageSeconds': 3600, 'since': since.timestamp()*1000, 'until': until.timestamp()*1000}
    state = {'wallMonthly': {'version': 1, 'timeZone': 'America/Los_Angeles', 'last': {},
                            'months': {'2026-11': {'expected': ['spark1', 'spark2', 'spark3', 'spark4'],
                                                   'nodes': {'spark2': row}}}}}
    source, destination = tmp_path/'old-energy.json', tmp_path/'energy.sqlite'
    source.write_text(json.dumps(state))
    return source, destination, state, until


def test_monthly_and_yearly_usage_and_cost_are_preserved_without_finer_detail(tmp_path):
    source, destination, _, until = retained(tmp_path)
    before = source.read_bytes()
    receipt = import_monthly(source, destination, now=until)
    assert receipt['monthly_totals'] == 1 and source.read_bytes() == before
    for period, selected in [('month', '2026-11'), ('year', '2026')]:
        result = read_energy(path=destination, period=period, selected=selected, rate=.5, now=until)
        assert result['recorded_kwh'] == .4 and result['cost_usd'] == .2
        assert result['sparks'][1]['covered_seconds'] == 3600
        assert result['sparks'][0]['recorded_kwh'] is None
        assert result['estimated_from_power'] and result['partial']
        assert 'monthly totals are included' in result['message']
    for period in ('day', 'week'):
        result = read_energy(path=destination, period=period, now=until)
        assert result['recorded_kwh'] is None and result['cost_usd'] is None
        assert 'detail was not recorded' in result['message']
    with sqlite3.connect(destination) as db:
        assert db.execute('SELECT COUNT(*) FROM readings').fetchone()[0] == 0
        assert db.execute('PRAGMA user_version').fetchone()[0] == 2


def test_import_repeats_without_double_counting_and_refuses_changed_totals(tmp_path):
    source, destination, state, until = retained(tmp_path)
    first = import_monthly(source, destination, now=until)
    assert import_monthly(source, destination, now=until) == first
    assert read_energy(path=destination, now=until)['recorded_kwh'] == .4
    state['wallMonthly']['months']['2026-11']['nodes']['spark2']['kWh'] = .5
    source.write_text(json.dumps(state))
    with pytest.raises(ValueError, match='different monthly history'):
        import_monthly(source, destination, now=until)
    assert read_energy(path=destination, now=until)['recorded_kwh'] == .4


def test_new_readings_continue_after_import_without_counting_old_time_twice(tmp_path):
    source, destination, _, until = retained(tmp_path)
    import_monthly(source, destination, now=until)
    for when in (until, until + timedelta(minutes=10)):
        record_power(destination, spark='spark2', meter='plug2', at=when, watts=120)
    now = until + timedelta(minutes=10)
    assert read_energy(path=destination, now=now)['recorded_kwh'] == .42
    assert read_energy(path=destination, period='day', now=now)['recorded_kwh'] == .02
    original = destination.read_bytes()
    assert read_energy(path=destination, rate=.25, now=now)['cost_usd'] == .105
    assert read_energy(path=destination, rate=.5, now=now)['cost_usd'] == .21
    assert destination.read_bytes() == original


def test_old_history_refuses_overlap_with_existing_detailed_data(tmp_path):
    source, destination, _, until = retained(tmp_path)
    for when in (until - timedelta(minutes=10), until):
        record_power(destination, spark='spark2', meter='plug2', at=when, watts=120)
    with pytest.raises(ValueError, match='overlap'):
        import_monthly(source, destination, now=until)
    assert read_energy(path=destination, now=until)['recorded_kwh'] == .02


@pytest.mark.parametrize('key,value', [('kWh', -1), ('kWh', True), ('kWh', 100),
                                     ('coverageSeconds', 100000), ('until', 0)])
def test_bad_history_never_creates_target_storage(tmp_path, key, value):
    source, destination, state, until = retained(tmp_path)
    state['wallMonthly']['months']['2026-11']['nodes']['spark2'][key] = value
    source.write_text(json.dumps(state))
    with pytest.raises(ValueError): import_monthly(source, destination, now=until)
    assert not destination.exists()


def test_multiple_months_and_missing_history_remain_distinct(tmp_path):
    source, destination, state, until = retained(tmp_path)
    october = deepcopy(state['wallMonthly']['months']['2026-11'])
    row = october['nodes']['spark2']
    start = datetime(2026, 10, 31, 22, tzinfo=ZONE)
    row.update(since=start.timestamp()*1000, until=(start+timedelta(hours=1)).timestamp()*1000, kWh=.1)
    state['wallMonthly']['months']['2026-10'] = october
    source.write_text(json.dumps(state))
    import_monthly(source, destination, now=until)
    assert read_energy(path=destination, period='year', now=until)['recorded_kwh'] == .5
    result = read_energy(path=destination, month='2026-10', now=until)
    assert result['recorded_kwh'] == .1 and result['months'] == ['2026-11', '2026-10']
    assert read_energy(path=destination, month='2026-09', now=until)['recorded_kwh'] is None


@pytest.mark.parametrize('document', [[], None, {'wallMonthly': {'version': 99}}])
def test_unsupported_history_is_left_intact(tmp_path, document):
    source, destination = tmp_path/'old.json', tmp_path/'new.sqlite'
    source.write_text(json.dumps(document))
    original = source.read_bytes()
    with pytest.raises(ValueError, match='format is unsupported'):
        import_monthly(source, destination)
    assert source.read_bytes() == original and not destination.exists()
