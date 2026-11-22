"""Bounded continuation inside the existing collector maintenance invocation."""
import json
import time
from .io_budget import io_budget, remaining_io


def advance_power(controls, power, policy=None, *, budget_seconds=210, interval=5,
                  clock=time.monotonic, sleep=time.sleep):
    # One uninterrupted hold can be 180s. The collector's next invocation is
    # 60s after exit, which cannot preserve the required <=30s sample gap.
    with io_budget(budget_seconds, clock=clock):
        return _advance_power(controls, power, policy, budget_seconds=budget_seconds,
                              interval=interval, clock=clock, sleep=sleep)


def _advance_power(controls, power, policy, *, budget_seconds, interval, clock, sleep):
    if power is None:
        return []
    if not 0 < budget_seconds <= 210 or not 1 <= interval <= 10:
        raise ValueError('Power maintenance must stay bounded.')
    deadline, results = clock() + budget_seconds, {}
    while True:
        active = False
        generation = controls.binding().generation
        with controls.store._db() as db:
            owners = [dict(row) for row in db.execute("SELECT * FROM operations WHERE generation=? "
                "AND state IN ('dispatching','uncertain')", (generation,))]
            policies = ([row[0] for row in db.execute("SELECT id FROM power_policy_operations "
                "WHERE state IN ('dispatching','uncertain')")] if policy is not None else [])
        for row in owners:
            target = json.loads(row['intent'])
            if target['action'] not in ('sleep', 'wake'):
                continue
            # Re-read current ownership and cancellation before every effect.
            current = controls.store.get(row['id'])
            if current['generation'] != controls.binding().generation:
                continue
            if not current['cancel_requested']:
                try:
                    power.advance(row['id'], target)
                except Exception:
                    pass
            outcome = controls.store.reconcile(row['id'], observe=power.observe)
            results[row['id']] = {'id': row['id'], 'state': outcome['state']}
            active |= outcome['state'] in ('dispatching', 'uncertain')
        for operation in policies:
            outcome = policy.advance(operation)
            results[operation] = {'id': operation, 'state': outcome['state']}
            active |= outcome['state'] in ('dispatching', 'uncertain')
        try:
            available = remaining_io(interval)
        except TimeoutError:
            return list(results.values())
        if not active or clock() + interval > deadline or available < interval:
            return list(results.values())
        sleep(interval)
