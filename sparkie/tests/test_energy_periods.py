"""Calendar and cost history regressions: controlled readings, no real plugs."""
from datetime import datetime, timedelta
import sqlite3

import pytest

from sparkie_sparks.energy import ZONE, read_energy, record, record_power


def sample(path, when, value):
    record(path, spark='spark2', meter='plug2', at=when, kwh=value)


def test_day_week_month_year_clip_intervals_without_resetting_history(tmp_path):
    path = tmp_path / 'energy.sqlite'
    edge = datetime(2026, 12, 1, tzinfo=ZONE)
    sample(path, edge - timedelta(minutes=5), 1)
    sample(path, edge + timedelta(minutes=5), 3)
    now = edge + timedelta(minutes=6)
    day = read_energy(path=path, period='day', selected='2026-11-30', now=now)
    assert day['recorded_kwh'] == 1
    assert day['periods'] == ['2026-12-01', '2026-11-30']
    assert read_energy(path=path, period='week', now=now)['recorded_kwh'] == 2
    assert read_energy(path=path, period='month', now=now)['recorded_kwh'] == 1
    assert read_energy(path=path, period='year', now=now)['recorded_kwh'] == 2
    assert read_energy(path=path, month='2026-11', now=now)['recorded_kwh'] == 1


def test_week_uses_iso_year_and_monday(tmp_path):
    path = tmp_path / 'energy.sqlite'
    edge = datetime(2027, 1, 4, tzinfo=ZONE)  # First Monday of 2027.
    sample(path, edge - timedelta(minutes=5), 2)
    sample(path, edge + timedelta(minutes=5), 4)
    result = read_energy(path=path, period='week', now=edge + timedelta(minutes=6))
    assert result['selected'] == '2027-W01'
    assert result['periods'] == ['2027-W01', '2026-W53']
    assert result['recorded_kwh'] == 1
    assert read_energy(path=path, period='week', selected='2026-W53', now=edge)['recorded_kwh'] is None


@pytest.mark.parametrize('day,next_day,hours', [('2026-03-08', '2026-03-09', 23), ('2026-11-01', '2026-11-02', 25)])
def test_day_duration_tracks_dst(tmp_path, day, next_day, hours):
    path = tmp_path / 'energy.sqlite'
    start = datetime.fromisoformat(day).replace(tzinfo=ZONE)
    sample(path, start, 1)
    sample(path, start + timedelta(minutes=5), 1)
    result = read_energy(path=path, period='day', selected=day, now=datetime.fromisoformat(next_day).replace(tzinfo=ZONE))
    assert result['sparks'][1]['missing_seconds'] == hours * 3600 - 300


def test_changing_rate_recalculates_old_usage_without_any_write(tmp_path):
    path = tmp_path / 'energy.sqlite'
    start = datetime(2025, 11, 19, tzinfo=ZONE)
    sample(path, start, 1)
    sample(path, start + timedelta(minutes=10), 3)
    original = path.read_bytes()
    first = read_energy(path=path, period='year', selected='2025', rate=0.4, now='2026-11-19T12:00:00Z')
    second = read_energy(path=path, period='year', selected='2025', rate=0.6, now='2026-11-19T12:00:00Z')
    assert first['recorded_kwh'] == second['recorded_kwh'] == 2
    assert first['cost_usd'] == 0.8 and second['cost_usd'] == 1.2
    assert second['sparks'][1]['cost_usd'] == 1.2
    assert first['partial'] and second['partial']
    assert path.read_bytes() == original, 'Cost calculation cannot write stored usage or prices.'
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall() == [('readings',)]


def test_no_rate_no_cost_and_known_zero_rate_is_distinct(tmp_path):
    path = tmp_path / 'energy.sqlite'
    start = datetime(2026, 11, 19, tzinfo=ZONE)
    sample(path, start, 1)
    sample(path, start + timedelta(minutes=5), 2)
    result = read_energy(path=path, now=start + timedelta(minutes=5))
    assert result['cost_usd'] is None and result['rate_usd_per_kwh'] is None
    result = read_energy(path=path, rate=0, now=start + timedelta(minutes=5))
    assert result['cost_usd'] == 0 and result['rate_usd_per_kwh'] == 0
    assert result['sparks'][0]['cost_usd'] is None, 'Unknown usage stays unknown even at a zero rate.'


def test_power_cost_uses_integrated_usage(tmp_path):
    path = tmp_path / 'energy.sqlite'
    start = datetime(2026, 11, 19, tzinfo=ZONE)
    record_power(path, spark='spark2', meter='plug2', at=start, watts=0)
    record_power(path, spark='spark2', meter='plug2', at=start + timedelta(minutes=10), watts=1200)
    result = read_energy(path=path, rate=0.4, now=start + timedelta(minutes=10))
    assert result['recorded_kwh'] == 0.1
    assert result['cost_usd'] == 0.04
    assert result['estimated_from_power']


@pytest.mark.parametrize('value', [-1, 11, True, '0.4', float('nan'), float('inf')])
def test_invalid_rate_does_not_create_storage(tmp_path, value):
    path = tmp_path / 'energy.sqlite'
    with pytest.raises(ValueError):
        read_energy(path=path, rate=value, now='2026-11-19T00:00:00Z')
    assert not path.exists()


@pytest.mark.parametrize('period,selected', [('day', '2026-02-30'), ('week', '2026-W54'), ('year', '2027'), ('hour', '2026-11-19')])
def test_bad_or_future_period_is_refused(period, selected):
    with pytest.raises(ValueError):
        read_energy(period=period, selected=selected, now='2026-11-19T00:00:00Z')


@pytest.mark.parametrize('field', ['selected', 'month'])
def test_current_period_requires_an_omitted_selector(tmp_path, field):
    missing_database = tmp_path / 'missing.sqlite'
    now = '2026-11-19T12:00:00Z'
    assert read_energy(path=missing_database, now=now)['selected'] == '2026-11'
    with pytest.raises(ValueError, match='Choose a valid'):
        read_energy(path=missing_database, now=now, **{field: ''})
