"""Qualified physical power stages in the existing private operation boundary.

An observed stage may advance only through ``advance`` with the original exact
authorization and Spark claim. ``observe`` samples evidence and never sends a
shutdown, Off or On. Unknown sent effects are never repeated.
"""
import hashlib
from datetime import datetime
import json
import math

from .operations import NotDispatched


class PowerSequence:
    def __init__(self, power, qualification):
        if not isinstance(qualification, dict) or not qualification or not set(qualification) <= set(power.nodes):
            raise ValueError('Qualify only configured compute Sparks.')
        self.power, self.store, self.qualification = power, power.store, {}
        for spark, value in qualification.items():
            if (not isinstance(value, dict) or set(value) != {'revision', 'machine_id', 'plug_fingerprint',
                    'running_min_watts', 'standby_max_watts', 'hold_seconds', 'max_gap_seconds', 'off_seconds'}
                    or not isinstance(value['revision'], str) or not 1 <= len(value['revision']) <= 128
                    or any(ord(c) < 33 for c in value['revision'])
                    or value['machine_id'] != power.nodes[spark]['machine_id']
                    or spark not in power.mapping or power.mapping[spark].get('read_only', False)
                    or value['plug_fingerprint'] != power.mapping[spark]['fingerprint']):
                raise ValueError('Bind qualification to the exact physical Spark, plug and protected revision.')
            numbers = [value[key] for key in ('running_min_watts', 'standby_max_watts', 'hold_seconds', 'max_gap_seconds', 'off_seconds')]
            if (any(type(v) not in (int, float) or not math.isfinite(v) for v in numbers)
                    or not 0 < value['standby_max_watts'] < value['running_min_watts'] <= 3000
                    or value['running_min_watts'] < 2 * value['standby_max_watts']
                    or not 30 <= value['hold_seconds'] <= 180
                    or not 5 <= value['max_gap_seconds'] <= min(30, value['hold_seconds'])
                    or not 5 <= value['off_seconds'] <= 60):
                raise ValueError('Use measured distinct power ranges and bounded standby/off intervals.')
            self.qualification[spark] = dict(value)
        with self.store._db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS power_sequences ('
                'id TEXT PRIMARY KEY, spark TEXT NOT NULL, action TEXT NOT NULL, revision TEXT NOT NULL, '
                'phase TEXT NOT NULL, baseline REAL, baseline_at REAL, low_since REAL, last_sample REAL, '
                'samples INTEGER NOT NULL, changed REAL NOT NULL, shutdown_operation TEXT, '
                'cut_sent_at REAL, off_observed_at REAL, on_sent_at REAL)')

    def exists(self, operation):
        with self.store._db() as db:
            return bool(db.execute('SELECT 1 FROM power_sequences WHERE id=?', (operation,)).fetchone())

    def _lock(self, operation):
        return self.store._lock(hashlib.sha256(('physical-power:' + operation).encode()).hexdigest()[:32])

    def _get(self, operation):
        with self.store._db() as db:
            row = db.execute('SELECT * FROM power_sequences WHERE id=?', (operation,)).fetchone()
        return dict(row) if row is not None else None

    def _set(self, operation, **changes):
        changes['changed'] = self.store.clock()
        with self.store._db() as db:
            db.execute('UPDATE power_sequences SET ' + ','.join(key + '=?' for key in changes) + ' WHERE id=?',
                       (*changes.values(), operation))
        return self._get(operation)

    def _qualified(self, row, target):
        q = self.qualification.get(target['spark'])
        return (q is not None and row['spark'] == target['spark'] and row['action'] == target['action']
                and row['revision'] == self._version(target['spark']))

    def _version(self, spark):
        configuration = {'qualification': self.qualification[spark],
            'activity_policy': getattr(self.power.transport, 'activity_policies', {}).get(spark)}
        return hashlib.sha256(json.dumps(configuration, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

    def _cancelled(self, operation):
        try:
            return self.store.get(operation)['cancel_requested']
        except ValueError:
            return False

    def _watts(self, plug):
        value = plug.get('watts')
        return value if type(value) in (int, float) and math.isfinite(value) and value >= 0 else None

    def _prepare(self, operation, target, authorize):
        spark, action = target['spark'], target['action']
        q, node = self.qualification[spark], self.power.nodes[spark]
        authorize(operation, target)
        try:
            plug = self.power._plug(spark)
        except Exception:
            raise NotDispatched('The verified plug has no fresh device reading.') from None
        now, baseline, source, phase = self.store.clock(), None, None, None
        if action == 'sleep':
            try:
                machine, blockers = self.power._machine(node), self.power.activity(node)
            except Exception:
                raise NotDispatched('Physical identity or activity is not verified; nothing was shut down.') from None
            watts = self._watts(plug)
            if (plug['on'] is not True or watts is None or watts < q['running_min_watts']
                    or machine.get('docker_ready') is not True or machine.get('workloads') != []
                    or not isinstance(blockers, list) or blockers):
                raise NotDispatched('The Spark is busy, unknown or lacks the qualified running-power baseline.')
            baseline, phase = watts, 'prepared_shutdown'
        elif plug['on'] is False:
            phase = 'off'
        else:
            try:
                machine = self.power._machine(node)
            except Exception:
                machine = None
            if machine is not None and machine.get('docker_ready') is True:
                phase = 'ready'
            else:
                # Never turn mere silence into authority for Off. An earlier
                # exact normal-shutdown operation must already have been proven.
                with self.store._db() as db:
                    prior = db.execute("SELECT * FROM power_sequences WHERE spark=? AND action='sleep' "
                        "AND revision=? AND phase IN ('standby','cut_sent','off') ORDER BY changed DESC LIMIT 1",
                        (spark, self._version(spark))).fetchone()
                if prior is None:
                    raise NotDispatched('The powered but unavailable Spark has no qualified shutdown record; no cycle was sent.')
                baseline, source, phase = prior['baseline'], prior['id'], 'waiting_standby'
        authorize(operation, target)
        with self.store._db() as db:
            db.execute('INSERT INTO power_sequences VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                (operation, spark, action, self._version(spark), phase, baseline, now if baseline is not None else None,
                 None, None, 0, now, source, None, now if phase == 'off' else None, None))
        return self._get(operation)

    def _sample(self, row):
        """Update observed evidence only; never a device or shutdown command."""
        q, spark = self.qualification[row['spark']], row['spark']
        try:
            plug = self.power._plug(spark)
        except Exception:
            phase = row['phase']
            if phase == 'standby':
                phase = 'shutdown_sent' if row['action'] == 'sleep' else 'waiting_standby'
            return self._set(row['id'], phase=phase, low_since=None, last_sample=None, samples=0, off_observed_at=None)
        phase, now = row['phase'], self.store.clock()
        if phase in ('cut_sent', 'off'):
            if plug['on'] is False:
                stamp = datetime.fromisoformat(plug['measured_at']).timestamp()
                continuous = row['last_sample'] is not None and 0 <= stamp - row['last_sample'] <= q['max_gap_seconds']
                since = row['off_observed_at'] if continuous and row['off_observed_at'] is not None else stamp
                return self._set(row['id'], phase='off', off_observed_at=since, last_sample=stamp)
            if row['action'] == 'wake':
                try:
                    machine = self.power._machine(self.power.nodes[spark])
                except Exception:
                    machine = None
                if machine is not None and machine.get('docker_ready') is True:
                    return self._set(row['id'], phase='ready')
            # A prior Off observation must not survive an external On. No new
            # cut follows: the old Off was already sent and may be uncertain.
            return self._set(row['id'], off_observed_at=None, last_sample=None)
        if phase in ('on_sent', 'ready'):
            try:
                machine = self.power._machine(self.power.nodes[spark]) if plug['on'] else None
            except Exception:
                machine = None
            if machine is not None and machine.get('docker_ready') is True:
                return self._set(row['id'], phase='ready')
            return row if phase == 'on_sent' else self._set(row['id'], phase='on_sent')
        if phase not in ('shutdown_sent', 'waiting_standby', 'standby'):
            return row
        if row['action'] == 'wake':
            try:
                machine = self.power._machine(self.power.nodes[spark]) if plug['on'] else None
            except Exception:
                machine = None
            if machine is not None and machine.get('docker_ready') is True:
                return self._set(row['id'], phase='ready')
        watts = self._watts(plug)
        # A refused login, changed host key or wrong physical identity is still
        # a reachable host. Only independently checked TCP absence qualifies.
        absent = self.power.transport.reachable(self.power.nodes[spark]) is False
        if plug['on'] is not True or watts is None or watts > q['standby_max_watts'] or not absent:
            return self._set(row['id'], phase='shutdown_sent' if row['action'] == 'sleep' else 'waiting_standby',
                             low_since=None, last_sample=None, samples=0)
        stamp = datetime.fromisoformat(plug['measured_at']).timestamp()
        if row['last_sample'] == stamp:
            return row  # Re-reading an old sample cannot extend or complete a hold.
        continuous = row['last_sample'] is not None and 0 < stamp - row['last_sample'] <= q['max_gap_seconds']
        since = row['low_since'] if continuous else stamp
        count = row['samples'] + 1 if continuous else 1
        qualified = stamp - since >= q['hold_seconds'] and count >= 3
        return self._set(row['id'], phase='standby' if qualified else
                         'shutdown_sent' if row['action'] == 'sleep' else 'waiting_standby',
                         low_since=since, last_sample=stamp, samples=count)

    def advance(self, operation, target, authorize):
        with self._lock(operation) as acquired:
            if not acquired:
                return
            row = self._get(operation) or self._prepare(operation, target, authorize)
            if not self._qualified(row, target):
                raise NotDispatched('The physical power qualification changed; no further effect was sent.')
            row = self._sample(row)
            phase, node = row['phase'], self.power.nodes[target['spark']]
            if phase == 'prepared_shutdown':
                # Recheck immediately before the recorded shutdown dispatch.
                machine, blockers = self.power._machine(node), self.power.activity(node)
                if machine.get('docker_ready') is not True or machine.get('workloads') != [] or blockers != []:
                    self._set(operation, phase='refused')
                    raise NotDispatched('The Spark became active; no shutdown was sent.')
                authorize(operation, target)
                self._set(operation, phase='shutdown_sent')
                result = self.power.transport.request(node, self.power.hub_machine_id, 'sleep')
                if result.get('status') == 'refused':
                    self._set(operation, phase='refused')
                    raise NotDispatched('The Spark refused before shutdown dispatch.')
            elif phase == 'standby':
                # _sample just repeated the fresh meter and TCP checks. A cached
                # old low interval is insufficient after a gap or renewed use.
                authorize(operation, target)
                self._set(operation, phase='cut_sent', cut_sent_at=self.store.clock())
                self.power.matter.off_after_shutdown(target['spark'])
            elif phase == 'off' and target['action'] == 'wake':
                q = self.qualification[target['spark']]
                if (row['off_observed_at'] is None or row['last_sample'] is None
                        or row['last_sample'] - row['off_observed_at'] < q['off_seconds']):
                    return
                authorize(operation, target)
                self._set(operation, phase='on_sent', on_sent_at=self.store.clock())
                self.power.matter.on(target['spark'])

    def observe(self, operation, target):
        unknown = {'outcome': 'unknown', 'plug_off_sent': False,
                   'message': 'The exact power operation is still being observed.'}
        with self._lock(operation) as acquired:
            row = self._get(operation)
            if not acquired or row is None or not self._qualified(row, target):
                return unknown
            try:
                row = self._sample(row)
            except Exception:
                return unknown
            cut = row['cut_sent_at'] is not None
            if row['phase'] == 'refused':
                return {'outcome': 'failed', 'plug_off_sent': False, 'message': 'Shutdown was refused before sending it.'}
            if row['action'] == 'sleep' and row['phase'] == 'off' and row['off_observed_at'] is not None:
                return {'outcome': 'succeeded', 'plug_off_sent': cut, 'ac_power_on': False,
                        'message': 'Normal shutdown and sustained standby were verified; the plug is now off.'}
            if row['action'] == 'wake' and row['phase'] == 'ready':
                return {'outcome': 'succeeded', 'plug_off_sent': cut, 'ac_power_on': True,
                        'message': 'The expected Spark answers with Docker ready after its verified power sequence.'}
            if self._cancelled(operation) and row['phase'] in ('standby', 'off'):
                return {'outcome': 'failed', 'plug_off_sent': cut, 'ac_power_on': row['phase'] == 'standby',
                        'message': 'Power continuation was cancelled; the observed shutdown state was retained.'}
            return {**unknown, 'plug_off_sent': cut, 'phase': row['phase']}
