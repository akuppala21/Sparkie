"""One synchronous power-policy pass in the existing private controller cycle.

No scheduler or model calls. Operator settings, exact admitted allocations and
fresh activity are authority; a native cleanup hint alone is not proof of idle.
"""
import json
import hashlib
import math
import sqlite3
import uuid

from .operations import NotDispatched, intent
from .recipe_services import service_holds_node
from .workspace_leases import Allocation, WorkspaceLeases


class IdlePower:
    def __init__(self, store, power, *, revision, idle_seconds, max_observation_gap=120, allow_sleep=True):
        if (not isinstance(revision, str) or not 1 <= len(revision) <= 128
                or any(ord(c) < 33 for c in revision)
                or type(idle_seconds) is not int or not 1 <= idle_seconds <= 86400
                or type(max_observation_gap) is not int or not 1 <= max_observation_gap <= 600
                or type(allow_sleep) is not bool):
            raise ValueError('Use a fixed operator policy revision and bounded idle settings.')
        self.store, self.power, self.revision = store, power, revision
        self.idle_seconds, self.max_gap = idle_seconds, max_observation_gap
        self.allow_sleep = allow_sleep
        with store._db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS power_idle_observations ('
                       'spark TEXT PRIMARY KEY, revision TEXT NOT NULL, since REAL, seen REAL NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS power_policy_operations ('
                       'id TEXT PRIMARY KEY, request_key TEXT UNIQUE NOT NULL, target TEXT NOT NULL, '
                       'revision TEXT NOT NULL, allocation_id TEXT, state TEXT NOT NULL, '
                       'created REAL NOT NULL, updated REAL NOT NULL)')
        power.policy_authorizer = self.authorize

    @staticmethod
    def _held(db, spark):
        if service_holds_node(db, spark):
            return True
        if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='workspace_leases'").fetchone():
            return False
        return any(json.loads(row['node'])['spark_id'] == spark for row in
                   db.execute('SELECT node FROM workspace_leases WHERE held=1'))

    def authorize(self, operation, target, *, continuing=False):
        with self.store._db() as db:
            row = db.execute('SELECT * FROM power_policy_operations WHERE id=?', (operation,)).fetchone()
            if (row is None or row['state'] not in (('dispatching', 'uncertain') if continuing else ('dispatching',))
                    or row['revision'] != self.revision
                    or json.loads(row['target']) != target):
                return False
            if target['action'] == 'wake':
                if row['allocation_id'].startswith('service:'):
                    return self._service_authorized(db, operation, target['spark'])
                allocation = db.execute('SELECT * FROM workspace_leases WHERE allocation_id=?',
                                        (row['allocation_id'],)).fetchone()
                return bool(allocation and allocation['state'] in ('reserved', 'stopped')
                            and allocation['operation_id'] == operation
                            and json.loads(allocation['node'])['spark_id'] == target['spark'])
            return self.allow_sleep and target['action'] == 'sleep' and not self._held(db, target['spark'])

    def _get(self, operation):
        with self.store._db() as db:
            row = db.execute('SELECT * FROM power_policy_operations WHERE id=?', (operation,)).fetchone()
        if row is None:
            raise ValueError('That power-policy receipt does not exist.')
        result = dict(row)
        result['target'] = json.loads(result['target'])
        return result

    def _lock(self, operation):
        # The initial allocation's operation ID equals its allocation ID. Wake
        # preflight runs inside that allocation lock, so use a separate stable
        # policy lock while retaining the same durable operation and Spark claim.
        key = hashlib.sha256(('power-policy:' + operation).encode()).hexdigest()[:32]
        return self.store._lock(key)

    def _finish(self, operation, outcome):
        row = self._get(operation)
        state = outcome if outcome in ('succeeded', 'failed') else 'uncertain'
        with self.store._db() as db:
            db.execute('UPDATE power_policy_operations SET state=?,updated=? WHERE id=?',
                       (state, self.store.clock(), operation))
            # An admitted workspace still owns its claim after wake; allocation
            # completion, never the power helper, releases that claim.
            if state in ('succeeded', 'failed') and row['allocation_id'] is None:
                db.execute('DELETE FROM claims WHERE operation=?', (operation,))
        return self._get(operation)

    def reconcile(self, operation):
        with self._lock(operation) as acquired:
            row = self._get(operation)
            if not acquired or row['state'] not in ('dispatching', 'uncertain'):
                return row
            return self._finish(operation, self.power.observe(operation, row['target']))

    def advance(self, operation):
        """Continue a qualified stage; reconcile remains observation-only."""
        with self._lock(operation) as acquired:
            row = self._get(operation)
            if not acquired or row['state'] not in ('dispatching', 'uncertain'):
                return row
            try:
                self.power.advance(operation, row['target'])
            except Exception:
                pass
            return self._finish(operation, self.power.observe(operation, row['target']))

    def _send(self, operation):
        with self._lock(operation) as acquired:
            if not acquired:
                return self._get(operation)
            row = self._get(operation)
            if row['state'] != 'pending':
                return (self._finish(operation, self.power.observe(operation, row['target']))
                        if row['state'] in ('dispatching', 'uncertain')
                        or (row['state'] == 'succeeded' and row['target']['action'] == 'wake') else row)
            with self.store._db() as db:
                db.execute('UPDATE power_policy_operations SET state=?,updated=? WHERE id=?',
                           ('dispatching', self.store.clock(), operation))
            try:
                self.power.dispatch_policy(operation, row['target'])
            except NotDispatched:
                return self._finish(operation, 'failed')
            except Exception:
                pass  # Unknown effect is observed. Never replay a send.
            return self._finish(operation, self.power.observe(operation, row['target']))

    def _service_authorized(self, db, operation, spark):
        reserved = db.execute('SELECT * FROM recipe_service_instances WHERE id=? AND spark=? '
                              "AND held=1 AND phase='reserved'", (operation, spark)).fetchone()
        saved = db.execute('SELECT * FROM operations WHERE id=?', (operation,)).fetchone()
        claim = db.execute('SELECT operation FROM claims WHERE spark=?', (spark,)).fetchone()
        if not reserved or not saved or not claim or claim[0] != operation:
            return False
        row = self.store._view(dict(saved))
        target = row['intent']
        return bool(target == {'action':'start_service','spark':spark,'recipe':reserved['name'],'revision':reserved['revision']}
                    and row['state'] == 'dispatching' and row['approved_at'] is not None and not row['cancel_requested']
                    and reserved['machine'] == self.power.nodes[spark]['machine_id']
                    and self.power.owner_authorizer and self.power.owner_authorizer(row))

    def wake_service(self, operation, node):
        target, now = intent('wake', node.spark_id), self.store.clock()
        with self.store._db() as db:
            if node.spark_id not in self.power.nodes or not self._service_authorized(db, operation, node.spark_id):
                raise NotDispatched('The service has no current owner admission for this Spark.')
            db.execute('INSERT OR IGNORE INTO power_policy_operations VALUES (?,?,?,?,?,?,?,?)',
                       (operation, 'wake:' + operation, json.dumps(target, sort_keys=True), self.revision,
                        'service:' + operation, 'pending', now, now))
        return self._send(operation)

    def wake(self, allocation):
        """Wake for one committed allocation. Subsequent calls only reconcile.

        The allocation's caller retains its dispatch claim and waits for ready
        before provisioning. A timed-out wake must not create another allocation.
        """
        if (not isinstance(allocation, Allocation) or allocation.node.spark_id not in self.power.nodes
                or allocation.node.machine_id != self.power.nodes[allocation.node.spark_id]['machine_id']):
            raise ValueError('Use the exact admitted compute allocation.')
        target = intent('wake', allocation.node.spark_id)
        operation, now = allocation.operation_id, self.store.clock()
        with self.store._db() as db:
            saved = db.execute('SELECT * FROM workspace_leases WHERE allocation_id=?', (allocation.allocation_id,)).fetchone()
            claim = db.execute('SELECT operation FROM claims WHERE spark=?', (allocation.node.spark_id,)).fetchone()
            if (saved is None or WorkspaceLeases._decode(saved) != allocation or allocation.state not in ('reserved', 'stopped')
                    or claim is None or claim[0] != operation):
                raise ValueError('The workspace has no current exact admission and Spark claim.')
            old = db.execute('SELECT * FROM power_policy_operations WHERE id=?', (operation,)).fetchone()
            if old is None:
                db.execute('INSERT INTO power_policy_operations VALUES (?,?,?,?,?,?,?,?)',
                           (operation, 'wake:' + operation, json.dumps(target, sort_keys=True), self.revision,
                            allocation.allocation_id, 'pending', now, now))
        return self._send(operation)

    def scan(self):
        """Call once per collector cadence; no sleep, thread or background loop."""
        results = []
        with self.store._db() as db:
            pending = [row[0] for row in db.execute(
                "SELECT id FROM power_policy_operations WHERE state IN ('pending','dispatching','uncertain')")]
        for operation in pending:
            results.append(self._send(operation) if self._get(operation)['state'] == 'pending' else self.advance(operation))
        for spark, capabilities in self.power.capabilities().items():
            observation = self.power.idle_observation(spark)
            now = self.store.clock()
            if not math.isfinite(now):
                raise ValueError('Idle observation time is invalid.')
            with self.store._db() as db:
                previous = db.execute('SELECT * FROM power_idle_observations WHERE spark=?', (spark,)).fetchone()
                blocked = self._held(db, spark) or db.execute('SELECT 1 FROM claims WHERE spark=?', (spark,)).fetchone()
                idle = (self.allow_sleep and capabilities.get('sleep') is True and not blocked
                        and observation == {'state': 'awake', 'blockers': []})
                continuous = (previous is not None and previous['revision'] == self.revision
                              and 0 <= now - previous['seen'] <= self.max_gap)
                since = (previous['since'] if continuous and previous['since'] is not None else now) if idle else None
                db.execute('INSERT OR REPLACE INTO power_idle_observations VALUES (?,?,?,?)',
                           (spark, self.revision, since, now))
                if since is None or now - since < self.idle_seconds:
                    continue
                operation = uuid.uuid4().hex
                try:
                    db.execute('INSERT INTO claims VALUES (?,?)', (spark, operation))
                except sqlite3.IntegrityError:
                    continue
                target = intent('sleep', spark)
                db.execute('INSERT INTO power_policy_operations VALUES (?,?,?,?,?,?,?,?)',
                           (operation, 'idle:' + operation, json.dumps(target, sort_keys=True), self.revision,
                            None, 'pending', now, now))
                db.execute('UPDATE power_idle_observations SET since=NULL WHERE spark=?', (spark,))
            results.append(self._send(operation))
        return results
