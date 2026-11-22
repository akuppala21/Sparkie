from datetime import datetime, timedelta
import sqlite3

import pytest

from sparkie_sparks.energy import ZONE, read_energy, record


def add(path, at, value, **kwargs):
    record(path, spark='spark2', at=at, meter=kwargs.get('meter', 'plug2'), kwh=value)


def test_month_switch_preserves_previous_month_and_marks_allocation_estimate(tmp_path):
    path = tmp_path / 'energy.sqlite'
    edge = datetime(2026, 12, 1, tzinfo=ZONE)
    add(path, edge - timedelta(minutes=5), 100)
    add(path, edge + timedelta(minutes=5), 101)
    now = edge + timedelta(minutes=6)
    old = read_energy(path=path, month='2026-11', now=now)
    new = read_energy(path=path, now=now)
    assert old['recorded_kwh'] == new['recorded_kwh'] == 0.5
    assert new['months'] == ['2026-12', '2026-11']
    assert old['estimated_boundary'] is True
    assert new['partial'] is True  # Other Sparks and unobserved intervals are not zero.


def test_counter_reset_gap_and_meter_change_never_become_spikes(tmp_path):
    path = tmp_path / 'energy.sqlite'
    start = datetime(2026, 11, 10, tzinfo=ZONE)
    for minute, value, meter in [(0, 100, 'a'), (5, 101, 'a'), (10, 0, 'a'), (15, 1, 'a'),
                                  (60, 30, 'a'), (65, 200, 'b'), (70, 201, 'b')]:
        add(path, start + timedelta(minutes=minute), value, meter=meter)
    result = read_energy(path=path, now=start + timedelta(minutes=71))
    assert result['recorded_kwh'] == 3
    spark = result['sparks'][1]
    assert spark['counter_resets'] == 1
    assert spark['meter_changes'] == 1
    assert spark['covered_seconds'] == 900
    assert spark['missing_seconds'] > 0


def test_duplicate_readings_are_idempotent_and_conflicts_are_refused(tmp_path):
    path = tmp_path / 'energy.sqlite'
    start = datetime(2026, 11, 10, tzinfo=ZONE)
    add(path, start, 1)
    add(path, start, 1)
    with pytest.raises(ValueError):
        add(path, start, 2)
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT count(*) FROM readings').fetchone()[0] == 1


def test_missing_data_and_measured_zero_are_distinct(tmp_path):
    path = tmp_path / 'energy.sqlite'
    start = datetime(2026, 11, 10, tzinfo=ZONE)
    assert read_energy(path=path, now=start)['recorded_kwh'] is None
    assert not path.exists(), 'A display read must not create storage.'
    add(path, start, 2)
    assert read_energy(path=path, now=start)['recorded_kwh'] is None
    add(path, start + timedelta(minutes=5), 2)
    result = read_energy(path=path, now=start + timedelta(minutes=5))
    assert result['recorded_kwh'] == 0
    assert result['sparks'][0]['recorded_kwh'] is None


def test_dst_fallback_uses_elapsed_time_not_repeated_wall_clock(tmp_path):
    path = tmp_path / 'energy.sqlite'
    # LA repeats 01:00 when daylight saving ends; these are ten minutes apart.
    add(path, '2026-11-01T01:55:00-07:00', 10)
    add(path, '2026-11-01T01:05:00-08:00', 11)
    result = read_energy(path=path, now='2026-11-01T01:06:00-08:00')
    assert result['recorded_kwh'] == 1
    assert result['sparks'][1]['covered_seconds'] == 600


@pytest.mark.parametrize('value', [float('nan'), float('inf'), -1, True, '3'])
def test_invalid_meter_counter_cannot_enter_history(tmp_path, value):
    with pytest.raises(ValueError):
        add(tmp_path / 'energy.sqlite', '2026-11-19T00:00:00Z', value)


@pytest.mark.parametrize('month', ['2026-13', '../../secret', '2026-1', '2027-01'])
def test_invalid_or_future_month_is_refused(month):
    with pytest.raises(ValueError):
        read_energy(month=month, now='2026-11-19T00:00:00Z')


def test_history_can_arrive_out_of_order_without_double_counting(tmp_path):
    path = tmp_path / 'energy.sqlite'
    start = datetime(2026, 11, 10, tzinfo=ZONE)
    add(path, start + timedelta(minutes=10), 3)
    add(path, start, 1)
    add(path, start + timedelta(minutes=5), 2)
    result = read_energy(path=path, now=start + timedelta(minutes=10))
    assert result['recorded_kwh'] == 2
