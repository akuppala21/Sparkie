"""The ordinary collector invocation can finish holds without a new scheduler."""
from types import SimpleNamespace
from copy import deepcopy
import pytest

from sparkie_sparks.power_maintenance import advance_power
from sparkie_sparks.controls import Controls
from sparkie_sparks.composition import compose
from sparkie_sparks.operations import NotDispatched
from test_power import OWNER, NODE, request, run
from test_power_sequence import rig, low, Q


@pytest.mark.parametrize('phase', ['shutdown', 'off', 'on'])
def test_generation_revoked_during_activity_or_meter_check_sends_no_next_effect(tmp_path, phase):
    store, meter, transport, power, tick, make = rig(tmp_path)
    generation = [OWNER.generation]
    controls = compose(store, [NODE], binding=lambda: SimpleNamespace(generation=generation[0]), power=power)
    row = request(store, 'sleep' if phase != 'on' else 'wake')
    if phase == 'shutdown':
        def activity(node):
            generation[0] = 'replacement-owner'
            return []
        power.activity = activity
        assert controls.confirm(OWNER, row['id'], row['digest'])['state'] == 'failed'
        assert 'sleep' not in transport.calls
    else:
        if phase == 'on':
            meter.row.update(on=False, watts=0)
        controls.confirm(OWNER, row['id'], row['digest'])
        if phase == 'off':
            low(meter, transport)
            for _ in range(3):
                power.observe(row['id'], row['intent'])
                tick(10)
        else:
            tick(5)
        observe = meter.observe
        def revoked(spark):
            generation[0] = 'replacement-owner'
            return observe(spark)
        meter.observe = revoked
        with pytest.raises(NotDispatched): power.advance(row['id'], row['intent'])
    assert meter.sent == []


def test_bounded_maintenance_supplies_fresh_hold_samples_and_completes_shutdown(tmp_path):
    store, meter, transport, power, tick, make = rig(tmp_path)
    row = request(store, 'sleep')
    run(store, power, row)
    low(meter, transport)
    controls = SimpleNamespace(store=store, binding=lambda: SimpleNamespace(generation=OWNER.generation))
    started = store.clock()
    results = advance_power(controls, power, budget_seconds=45, interval=10, clock=store.clock, sleep=tick)
    assert results == [{'id': row['id'], 'state': 'succeeded'}]
    assert store.clock() - started == 30 and meter.sent == [('off', 'spark2')]


@pytest.mark.parametrize('hold', [60, 180])
def test_one_collector_invocation_completes_long_hold_before_sixty_second_inactive_gap(tmp_path, hold):
    store, meter, transport, power, tick, make = rig(tmp_path)
    profile = deepcopy(Q)
    profile['spark2']['hold_seconds'] = hold
    power = make(profile)
    row = request(store, 'sleep')
    run(store, power, row)
    low(meter, transport)
    controls = SimpleNamespace(store=store, binding=lambda: SimpleNamespace(generation=OWNER.generation))
    started = store.clock()
    results = advance_power(controls, power, clock=store.clock, sleep=tick)
    assert results == [{'id': row['id'], 'state': 'succeeded'}]
    assert store.clock() - started == hold and meter.sent == [('off', 'spark2')]


def test_total_maintenance_deadline_includes_io_and_aborts_before_expired_effect(tmp_path):
    from sparkie_sparks.io_budget import io_budget, remaining_io
    store, meter, transport, power, tick, make = rig(tmp_path)
    row = request(store, 'sleep')
    run(store, power, row)
    low(meter, transport)
    controls = SimpleNamespace(store=store, binding=lambda: SimpleNamespace(generation=OWNER.generation))
    observed = meter.observe
    def slow(spark):
        tick(remaining_io(8))
        remaining_io(1)
        return observed(spark)
    meter.observe = slow
    start = store.clock()
    with io_budget(20, clock=store.clock):
        result = advance_power(controls, power, clock=store.clock, sleep=tick)
    assert store.clock() - start <= 20
    assert result == [{'id': row['id'], 'state': 'uncertain'}] and meter.sent == []


def test_deadline_expiring_during_final_standby_read_cannot_send_off(tmp_path):
    from sparkie_sparks.io_budget import io_budget
    store, meter, transport, power, tick, make = rig(tmp_path)
    row = request(store, 'sleep')
    run(store, power, row)
    low(meter, transport)
    for _ in range(4):
        power.observe(row['id'], row['intent'])
        tick(10)
    observed = meter.observe
    def expiring(spark):
        tick(1)
        return observed(spark)
    meter.observe = expiring
    with io_budget(1, clock=store.clock), pytest.raises(TimeoutError):
        power.advance(row['id'], row['intent'])
    assert meter.sent == []


def test_maintenance_observes_cancelled_work_without_continuing_effects(tmp_path):
    store, meter, transport, power, tick, make = rig(tmp_path)
    row = request(store, 'sleep')
    run(store, power, row)
    low(meter, transport)
    store.cancel(OWNER, row['id'])
    controls = SimpleNamespace(store=store, binding=lambda: SimpleNamespace(generation=OWNER.generation))
    results = advance_power(controls, power, budget_seconds=45, interval=10, clock=store.clock, sleep=tick)
    assert results == [{'id': row['id'], 'state': 'failed'}] and meter.sent == []


def test_revoked_generation_cannot_continue_and_status_does_no_live_io(tmp_path):
    store, meter, transport, power, tick, make = rig(tmp_path)
    row = request(store, 'sleep')
    run(store, power, row)
    low(meter, transport)
    controls = SimpleNamespace(store=store, binding=lambda: SimpleNamespace(generation='replacement-owner'))
    assert advance_power(controls, power, clock=store.clock, sleep=tick) == []
    assert meter.sent == []
    controls = Controls(store, binding=lambda: SimpleNamespace(generation=OWNER.generation),
        dispatch=power.dispatch, observe=power.observe, result_view=power.cached_message, action_description=power.description)
    meter.observe = lambda spark: (_ for _ in ()).throw(AssertionError('Status must not perform IO'))
    view = controls.get(OWNER, row['id'])
    assert 'switch its plug off' in view['description']
    assert 'Standby is still being checked' in view['message']


def test_success_label_uses_recorded_plug_off_instead_of_old_ac_on_wording(tmp_path):
    store, meter, transport, power, tick, make = rig(tmp_path)
    row = request(store, 'sleep')
    run(store, power, row)
    low(meter, transport)
    controls = Controls(store, binding=lambda: SimpleNamespace(generation=OWNER.generation),
        dispatch=power.dispatch, observe=power.observe, result_view=power.cached_message, action_description=power.description)
    advance_power(controls, power, interval=10, clock=store.clock, sleep=tick)
    meter.observe = lambda spark: (_ for _ in ()).throw(AssertionError('Status must not perform IO'))
    view = controls.get(OWNER, row['id'])
    assert 'plug off were verified' in view['message'] and 'stays on' not in view['message']
