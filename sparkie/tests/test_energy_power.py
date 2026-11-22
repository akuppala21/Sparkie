from sparkie_sparks.energy import read_energy, record, record_power


def test_power_readings_integrate_to_kwh_and_are_labelled_estimates(tmp_path):
    path = tmp_path / 'energy.sqlite'
    for at in ('2026-11-19T10:00:00Z', '2026-11-19T10:10:00Z'):
        record_power(path, spark='spark2', meter='plug2', at=at, watts=120)
    result = read_energy(path=path, now='2026-11-19T10:11:00Z')
    assert result['recorded_kwh'] == 0.02
    assert result['estimated_from_power'] is True
    assert 'estimate' in result['message']


def test_changing_from_power_to_counter_does_not_double_count(tmp_path):
    path = tmp_path / 'energy.sqlite'
    record_power(path, spark='spark2', meter='plug2', at='2026-11-19T10:00:00Z', watts=120)
    record(path, spark='spark2', meter='plug2', at='2026-11-19T10:05:00Z', kwh=10)
    record(path, spark='spark2', meter='plug2', at='2026-11-19T10:10:00Z', kwh=10.01)
    result = read_energy(path=path, now='2026-11-19T10:11:00Z')
    assert result['recorded_kwh'] == 0.01
    assert result['sparks'][1]['meter_changes'] == 1


def test_power_ramp_is_split_at_local_month_boundary(tmp_path):
    path = tmp_path / 'energy.sqlite'
    record_power(path, spark='spark2', meter='plug2', at='2026-12-01T07:55:00Z', watts=0)
    record_power(path, spark='spark2', meter='plug2', at='2026-12-01T08:05:00Z', watts=120)
    old = read_energy(path=path, month='2026-11', now='2026-12-01T08:06:00Z')
    new = read_energy(path=path, month='2026-12', now='2026-12-01T08:06:00Z')
    assert old['recorded_kwh'] == 0.0025
    assert new['recorded_kwh'] == 0.0075
