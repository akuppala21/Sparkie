"""Durable compute allocation behind the existing private fleet boundary.

Trusted native-provider callbacks supply scope and request identity. This is not
an owner-confirmation path or an execution transport. All physical effects are
injected; commands, files and streams remain native Hermes SSH operations.
"""
from dataclasses import asdict, dataclass
from decimal import Decimal
import json
import math
from pathlib import PurePosixPath
import re
import sqlite3
import uuid

from .workspace_types import ComputeNode, IdleObservation, WorkspaceLease, WorkspaceRequest
from .recipe_services import service_holds_node


@dataclass(frozen=True)
class ResourceBudget:
    cpu: float
    memory_mb: int
    disk_mb: int


@dataclass(frozen=True)
class Allocation:
    allocation_id: str
    scope: str
    request: WorkspaceRequest
    node: ComputeNode
    state: str
    operation_id: str
    lease: WorkspaceLease | None
    release_id: str | None
    resources_held: bool


@dataclass(frozen=True)
class WorkspaceObservation:
    allocation_id: str
    state: str  # ready, stopped, missing, unknown, or never_created
    lease: WorkspaceLease | None = None
    # never_created is a stronger trusted proof than missing: the exact attempt
    # finished, owns no container/volumes, and cannot still create them later.
    operation_id: str | None = None


def _text(value, maximum):
    return isinstance(value, str) and 0 < len(value) <= maximum and not any(ord(c) < 32 for c in value)


def _resources(value):
    return (type(value.cpu) in (int, float) and math.isfinite(value.cpu) and value.cpu > 0
            and type(value.memory_mb) is int and value.memory_mb > 0
            and type(value.disk_mb) is int and value.disk_mb > 0)


def _json(value):
    return json.dumps(asdict(value), sort_keys=True, separators=(',', ':'), allow_nan=False)


class WorkspaceLeases:
    """One fixed allocation per runtime/profile scope and native task identity.

    Budgets are trusted admission ceilings, not proof of live free memory or an
    enforced disk quota. The eventual provisioner must also check real capacity,
    exact identities and container limits. It receives a committed allocation
    before any effect. On resume, allocation.lease names the exact saved object;
    it must never create another container or silently move that workspace.
    """

    def __init__(self, store, *, nodes, hub_machine_id, image, budgets, provision, observe, activity,
                 candidate_order=None, ensure_awake=None):
        nodes = tuple(nodes)
        if (not isinstance(hub_machine_id, str) or not re.fullmatch('[a-f0-9]{32}', hub_machine_id)
                or not 1 <= len(nodes) <= 3 or any(not isinstance(node, ComputeNode) for node in nodes)):
            raise ValueError('Configure verified compute identities and the permanent host identity.')
        self.nodes = {node.spark_id: node for node in nodes}
        if (len(self.nodes) != len(nodes) or len({node.machine_id for node in nodes}) != len(nodes)
                or len({node.host for node in nodes}) != len(nodes) or any(
                    node.spark_id not in ('spark2', 'spark3', 'spark4')
                    or not isinstance(node.machine_id, str) or not re.fullmatch('[a-f0-9]{32}', node.machine_id)
                    or node.machine_id == hub_machine_id or not isinstance(node.host, str)
                    or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9.:-]{0,252}', node.host) for node in nodes)):
            raise ValueError('Compute allocations cannot target Spark 1 or ambiguous physical identities.')
        if not isinstance(image, str) or not re.fullmatch(r'(?:[a-zA-Z0-9._/:\-]+@)?sha256:[a-f0-9]{64}', image):
            raise ValueError('Pin the qualified workspace image by digest.')
        if (not isinstance(budgets, dict) or set(budgets) != set(self.nodes)
                or any(not isinstance(value, ResourceBudget) or not _resources(value) for value in budgets.values())
                or not all(callable(callback) for callback in (provision, observe, activity))
                or (ensure_awake is not None and not callable(ensure_awake))
                or (candidate_order is not None and not callable(candidate_order))):
            raise ValueError('Configure bounded compute resources and trusted allocation callbacks.')
        self.store, self.image, self.budgets = store, image, dict(budgets)
        self.provision, self.observe, self.activity = provision, observe, activity
        self.ensure_awake = ensure_awake
        # Composition can prefer awake machines using timestamped collector
        # state. This is requested-work placement, never a picker/status probe.
        self.candidate_order = candidate_order or (lambda scope, request: tuple(self.nodes))
        # Own schema marker: do not alter OperationStore's confirmation schema or
        # use its approval fields for an ordinary, admitted compute request.
        with store._db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS workspace_lease_schema '
                       '(singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL)')
            version = db.execute('SELECT version FROM workspace_lease_schema WHERE singleton=1').fetchone()
            if version is None:
                db.execute('CREATE TABLE workspace_leases ('
                           'allocation_id TEXT PRIMARY KEY, scope TEXT NOT NULL, task_id TEXT NOT NULL, '
                           'request TEXT NOT NULL, node TEXT NOT NULL, state TEXT NOT NULL, '
                           'operation_id TEXT NOT NULL, lease TEXT, release_id TEXT, held INTEGER NOT NULL, '
                           'created REAL NOT NULL, updated REAL NOT NULL, UNIQUE(scope,task_id))')
                db.execute('INSERT INTO workspace_lease_schema VALUES (1,1)')
            elif version[0] != 1:
                raise ValueError('Unsupported workspace ledger. Preserve it for recovery.')
            if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='workspace_leases'").fetchone():
                raise ValueError('The workspace ledger is incomplete. Preserve it for recovery.')
            db.execute('CREATE TABLE IF NOT EXISTS workspace_retirements ('
                       'id TEXT PRIMARY KEY, allocation_id TEXT NOT NULL, release_id TEXT NOT NULL, '
                       'state TEXT NOT NULL, created REAL NOT NULL, updated REAL NOT NULL, retry_of TEXT)')

    @staticmethod
    def _decode(row):
        saved = json.loads(row['lease']) if row['lease'] else None
        lease = None if saved is None else WorkspaceLease(**(saved | {'request': WorkspaceRequest(**saved['request'])}))
        return Allocation(row['allocation_id'], row['scope'], WorkspaceRequest(**json.loads(row['request'])),
                          ComputeNode(**json.loads(row['node'])), row['state'], row['operation_id'], lease,
                          row['release_id'], bool(row['held']))

    def _row(self, db, allocation_id):
        row = db.execute('SELECT * FROM workspace_leases WHERE allocation_id=?', (allocation_id,)).fetchone()
        if row is None:
            raise ValueError('That compute allocation does not exist.')
        return self._decode(row)

    def _current(self, allocation_id):
        with self.store._db() as db:
            return self._row(db, allocation_id)

    def get(self, scope, task_id):
        if not _text(scope, 256) or not _text(task_id, 512):
            raise ValueError('Use the trusted runtime scope and native task identity.')
        with self.store._db() as db:
            row = db.execute('SELECT * FROM workspace_leases WHERE scope=? AND task_id=?', (scope, task_id)).fetchone()
        return self._decode(row) if row is not None else None

    def _usage(self, db, spark_id, exclude=None):
        cpu, memory, disk = Decimal(0), 0, 0
        for row in db.execute('SELECT * FROM workspace_leases'):
            allocation = self._decode(row)
            if (allocation.node.spark_id != spark_id or allocation.allocation_id == exclude
                    or allocation.state == 'uncreated'):
                continue
            if allocation.resources_held:
                cpu += Decimal(str(allocation.request.cpu))
                memory += allocation.request.memory_mb
            # Stopped containers retain their project volumes. Never forget disk
            # reservations merely because a native SSH connection closed.
            disk += allocation.request.disk_mb
        return cpu, memory, disk

    def _fits(self, db, spark_id, request, exclude=None):
        if service_holds_node(db, spark_id):
            return False
        cpu, memory, disk = self._usage(db, spark_id, exclude)
        budget = self.budgets[spark_id]
        return (cpu + Decimal(str(request.cpu)) <= Decimal(str(budget.cpu))
                and memory + request.memory_mb <= budget.memory_mb and disk + request.disk_mb <= budget.disk_mb)

    def reservations(self):
        with self.store._db() as db:
            return {spark: ResourceBudget(float(cpu), memory, disk)
                    for spark in self.nodes for cpu, memory, disk in [self._usage(db, spark)]}

    def _request(self, scope, request):
        if (not _text(scope, 256) or not isinstance(request, WorkspaceRequest)
                or not _text(request.task_id, 512) or request.image != self.image
                or request.persistent is not True or not _resources(request)):
            raise ValueError('Use an exact native workspace request within the configured policy.')

    def _reserve(self, scope, request):
        def existing(row):
            allocation = self._decode(row)
            if allocation.request != request or self.nodes.get(allocation.node.spark_id) != allocation.node:
                raise ValueError('An existing task cannot change its resources, image or physical workspace.')
            return allocation
        with self.store._db() as db:
            old = db.execute('SELECT * FROM workspace_leases WHERE scope=? AND task_id=?', (scope, request.task_id)).fetchone()
            if old is not None:
                return existing(old)
        order = self.candidate_order(scope, request)
        if (not isinstance(order, (tuple, list)) or any(not isinstance(spark, str) or spark not in self.nodes for spark in order)
                or len(order) != len(set(order))):
            raise ValueError('Placement must name distinct verified compute candidates.')
        with self.store._db() as db:
            old = db.execute('SELECT * FROM workspace_leases WHERE scope=? AND task_id=?', (scope, request.task_id)).fetchone()
            if old is not None:
                return existing(old)
            node = next((self.nodes[spark] for spark in order if self._fits(db, spark, request)
                         and not db.execute('SELECT 1 FROM claims WHERE spark=?', (spark,)).fetchone()), None)
            if node is None:
                raise RuntimeError('No configured compute Spark has room for this workspace reservation.')
            allocation_id, now = uuid.uuid4().hex, self.store.clock()
            db.execute('INSERT INTO workspace_leases VALUES (?,?,?,?,?,?,?,NULL,NULL,1,?,?)',
                       (allocation_id, scope, request.task_id, _json(request), _json(node), 'reserved', allocation_id, now, now))
            return self._row(db, allocation_id)

    def _valid_lease(self, allocation, lease):
        if not isinstance(lease, WorkspaceLease):
            return False
        node = allocation.node
        values = (lease.workspace_id, lease.container_id, lease.image_id, lease.expected_host_key,
                  lease.key_path, lease.known_hosts)
        return (all(isinstance(value, str) for value in values) and lease.request == allocation.request
                and (lease.spark_id, lease.machine_id, lease.host) == (node.spark_id, node.machine_id, node.host)
                and lease.workspace_id == allocation.allocation_id and lease.user == 'sandbox'
                and type(lease.port) is int and 1024 <= lease.port <= 65535
                and re.fullmatch('[a-f0-9]{64}', lease.container_id) is not None
                and re.fullmatch('sha256:[a-f0-9]{64}', lease.image_id) is not None
                and lease.host_key_alias == 'sparkie-workspace-' + allocation.allocation_id
                and re.fullmatch(r'ssh-ed25519 [A-Za-z0-9+/]+={0,2}', lease.expected_host_key) is not None
                and PurePosixPath(lease.key_path).is_absolute() and PurePosixPath(lease.known_hosts).is_absolute()
                and (allocation.lease is None or allocation.lease == lease))

    def _observe(self, allocation):
        try:
            result = self.observe(allocation)
        except Exception:
            result = None
        if (not isinstance(result, WorkspaceObservation) or result.allocation_id != allocation.allocation_id
                or result.state not in ('ready', 'stopped', 'missing', 'unknown', 'never_created')
                or (result.state in ('ready', 'stopped') and not self._valid_lease(allocation, result.lease))
                or (result.state == 'never_created' and (result.operation_id != allocation.operation_id
                    or result.lease is not None or allocation.lease is not None))):
            return WorkspaceObservation(allocation.allocation_id, 'unknown')
        return result

    def _save_observation(self, allocation, result, *, release=False):
        with self.store._db() as db:
            current = self._row(db, allocation.allocation_id)
            state = result.state if result.state in ('ready', 'stopped') else 'uncertain'
            lease = result.lease if state in ('ready', 'stopped') else current.lease
            claim = db.execute('SELECT operation FROM claims WHERE spark=?', (current.node.spark_id,)).fetchone()
            conflicting = claim is not None and claim[0] != current.operation_id
            held = not (release and state == 'stopped' and not conflicting)
            # An externally restarted workspace is real occupied capacity even
            # when it exceeds policy. Record it before refusing further work.
            fits = current.resources_held or state != 'ready' or self._fits(db, current.node.spark_id, current.request, current.allocation_id)
            db.execute('UPDATE workspace_leases SET state=?,lease=?,held=?,updated=? WHERE allocation_id=?',
                       (state, _json(lease) if lease else None, int(held), self.store.clock(), current.allocation_id))
            if state in ('ready', 'stopped'):
                db.execute('DELETE FROM claims WHERE operation=?', (current.operation_id,))
        if not fits:
            raise RuntimeError('The workspace is running beyond the configured resource budget. No new work was sent.')
        return self._current(allocation.allocation_id)

    def _dispatch(self, allocation):
        with self.store._db() as db:
            current = self._row(db, allocation.allocation_id)
            if current.state not in ('reserved', 'stopped'):
                raise RuntimeError('Inspect this allocation before sending another change.')
            if not self._fits(db, current.node.spark_id, current.request, current.allocation_id):
                raise RuntimeError('This exact workspace cannot resume until its compute resources are free.')
            claim = db.execute('SELECT operation FROM claims WHERE spark=?', (current.node.spark_id,)).fetchone()
            if claim is not None and claim[0] != current.operation_id:
                raise RuntimeError('This Spark has another change that must finish or be checked first.')
            operation_id = current.operation_id if current.state == 'reserved' or claim is not None else uuid.uuid4().hex
            if claim is None:
                db.execute('INSERT INTO claims VALUES (?,?)', (current.node.spark_id, operation_id))
            db.execute('UPDATE workspace_leases SET state=?,operation_id=?,held=1,release_id=NULL,updated=? WHERE allocation_id=?',
                       (current.state if self.ensure_awake is not None else 'dispatching', operation_id,
                        self.store.clock(), current.allocation_id))
        if self.ensure_awake is not None:
            prepared = self._current(allocation.allocation_id)
            try:
                ready = self.ensure_awake(prepared)
            except Exception:
                ready = False
            if ready is not True:
                raise RuntimeError('The reserved Spark is not verified awake yet. No workspace creation was sent; retry this same task.')
            with self.store._db() as db:
                current = self._row(db, allocation.allocation_id)
                claim = db.execute('SELECT operation FROM claims WHERE spark=?', (current.node.spark_id,)).fetchone()
                if current != prepared or claim is None or claim[0] != operation_id:
                    raise RuntimeError('The admitted workspace changed before provisioning.')
                db.execute('UPDATE workspace_leases SET state=?,updated=? WHERE allocation_id=?',
                           ('dispatching', self.store.clock(), current.allocation_id))
        committed = self._current(allocation.allocation_id)
        try:
            self.provision(committed)
        except Exception:
            pass  # A lost reply is inspected; it never triggers a blind create.
        return self._save_observation(committed, self._observe(committed))

    def acquire(self, scope, request):
        self._request(scope, request)
        allocation = self._reserve(scope, request)
        with self.store._lock(allocation.allocation_id) as acquired:
            if not acquired:
                raise RuntimeError('This workspace is already being checked. Inspect the same request before retrying.')
            allocation = self._current(allocation.allocation_id)
            if allocation.state == 'uncreated':
                raise RuntimeError('This allocation ended without creating a workspace. Use a new native request identity.')
            with self.store._db() as db:
                claim = db.execute('SELECT operation FROM claims WHERE spark=?', (allocation.node.spark_id,)).fetchone()
                if claim is not None and claim[0] != allocation.operation_id:
                    raise RuntimeError('This Spark has another change that must finish or be checked first.')
            if allocation.state == 'reserved' or (allocation.state == 'stopped' and self.ensure_awake is not None):
                allocation = self._dispatch(allocation)
            else:
                result = self._observe(allocation)
                # A stopped reservation stays released while checking whether
                # it can resume. Unknown state immediately holds capacity again.
                was_released = not allocation.resources_held and result.state == 'stopped'
                allocation = self._save_observation(allocation, result, release=was_released)
                if allocation.state == 'stopped':
                    allocation = self._dispatch(allocation)
            if allocation.state != 'ready':
                raise RuntimeError('The exact workspace is not verified ready. Its reservation is retained; no duplicate allocation was sent.')
            with self.store._db() as db:
                claim = db.execute('SELECT operation FROM claims WHERE spark=?', (allocation.node.spark_id,)).fetchone()
                if claim is not None and claim[0] != allocation.operation_id:
                    raise RuntimeError('This Spark has another change that must finish or be checked first.')
                db.execute('UPDATE workspace_leases SET release_id=NULL,updated=? WHERE allocation_id=?',
                           (self.store.clock(), allocation.allocation_id))
            return allocation.lease

    def abandon_uncreated(self, scope, task_id):
        """Release a proved unused reservation, retaining its terminal identity.

        A plain missing observation is insufficient: a timed-out remote create
        may still finish. No recorded lease or saved project can use this path.
        """
        allocation = self.get(scope, task_id)
        if allocation is None:
            raise ValueError('That compute allocation does not exist.')
        with self.store._lock(allocation.allocation_id) as acquired:
            if not acquired:
                raise RuntimeError('Provisioning is still in progress. Its reservation remains held.')
            current = self._current(allocation.allocation_id)
            if current.state == 'uncreated':
                return current
            if current.lease is not None:
                raise ValueError('This workspace has saved objects. Its storage cannot be released here.')
            with self.store._db() as db:
                if current.state == 'reserved' and db.execute('SELECT 1 FROM claims WHERE spark=?',
                                                               (current.node.spark_id,)).fetchone():
                    raise RuntimeError('Wake preflight is still claimed. Reconcile it before releasing this reservation.')
            if current.state != 'reserved' and self._observe(current).state != 'never_created':
                raise RuntimeError('Provisioning has not been proved finished without objects. Its reservation remains held.')
            with self.store._db() as db:
                db.execute('UPDATE workspace_leases SET state=?,held=0,release_id=?,updated=? WHERE allocation_id=?',
                           ('uncreated', uuid.uuid4().hex, self.store.clock(), current.allocation_id))
                db.execute('DELETE FROM claims WHERE operation=?', (current.operation_id,))
            return self._current(current.allocation_id)

    def release(self, scope, lease):
        """Native cleanup hint only: no SSH, stop, observation or resource release."""
        if not isinstance(lease, WorkspaceLease):
            raise ValueError('Use the exact existing workspace lease.')
        allocation = self.get(scope, lease.request.task_id)
        if allocation is None or allocation.lease != lease:
            raise ValueError('Use the exact workspace belonging to this runtime and task.')
        with self.store._lock(allocation.allocation_id) as acquired:
            if not acquired:
                return IdleObservation('unknown', allocation.operation_id)
            with self.store._db() as db:
                current = self._row(db, allocation.allocation_id)
                if current.lease != lease:
                    raise ValueError('The workspace identity changed before release.')
                release_id = current.release_id or uuid.uuid4().hex
                db.execute('UPDATE workspace_leases SET release_id=?,updated=? WHERE allocation_id=?',
                           (release_id, self.store.clock(), current.allocation_id))
            return IdleObservation('unknown', release_id)

    def idle(self, scope, lease):
        """Record a release hint; never stop/delete anything or trust SSH cleanup."""
        if not isinstance(lease, WorkspaceLease):
            raise ValueError('Use the exact existing workspace lease.')
        allocation = self.get(scope, lease.request.task_id)
        if allocation is None or allocation.lease != lease:
            raise ValueError('Use the exact workspace belonging to this runtime and task.')
        with self.store._lock(allocation.allocation_id) as acquired:
            if not acquired:
                return IdleObservation('unknown', allocation.operation_id)
            with self.store._db() as db:
                current = self._row(db, allocation.allocation_id)
                release_id = current.release_id or uuid.uuid4().hex
                db.execute('UPDATE workspace_leases SET release_id=?,updated=? WHERE allocation_id=?',
                           (release_id, self.store.clock(), current.allocation_id))
            current = self._current(allocation.allocation_id)
            try:
                active = self.activity(current)
            except Exception:
                active = None
            if not isinstance(active, list) or active:
                return IdleObservation('running' if isinstance(active, list) and active else 'unknown', release_id)
            result = self._observe(current)
            saved = self._save_observation(current, result, release=result.state == 'stopped')
            return IdleObservation('stopped' if not saved.resources_held else
                                   'running' if saved.state == 'ready' else 'unknown', release_id)

    def released(self):
        """Private controller candidates; a hint alone never establishes idleness."""
        with self.store._db() as db:
            return [self._decode(row) for row in db.execute(
                'SELECT * FROM workspace_leases WHERE release_id IS NOT NULL AND held=1 ORDER BY updated,allocation_id')]

    def retire(self, scope, task_id, release_id, *, activity, stop):
        """Stop a released, independently empty sandbox once; retain its storage.

        Called by the controller's ordinary scan, never a model approval tool.
        The existing allocation lock excludes acquire/reconnect; the Spark claim
        excludes simultaneous fleet changes. A lost stop is observation-only on
        subsequent scans. Exact current release hints prevent stale teardown.
        """
        if not callable(activity) or not callable(stop) or not isinstance(release_id, str):
            raise ValueError('Use a current native release hint and trusted idle callbacks.')
        allocation = self.get(scope, task_id)
        if allocation is None:
            raise ValueError('That compute workspace does not exist.')
        with self.store._lock(allocation.allocation_id) as acquired:
            if not acquired:
                return IdleObservation('unknown', allocation.operation_id)
            current = self._current(allocation.allocation_id)
            if current.release_id != release_id or current.lease is None:
                raise ValueError('The workspace was reused or its release hint changed.')
            with self.store._db() as db:
                receipt = db.execute('SELECT * FROM workspace_retirements WHERE release_id=? ORDER BY created DESC,rowid DESC LIMIT 1',
                                     (release_id,)).fetchone()
            if receipt is None or receipt['state'] == 'refused':
                try:
                    blockers = activity(current)
                except Exception:
                    blockers = None
                if not isinstance(blockers, list) or blockers:
                    return IdleObservation('running' if isinstance(blockers, list) and blockers else 'unknown', release_id)
                operation, now = uuid.uuid4().hex, self.store.clock()
                with self.store._db() as db:
                    try:
                        db.execute('INSERT INTO claims VALUES (?,?)', (current.node.spark_id, operation))
                    except sqlite3.IntegrityError:
                        return IdleObservation('unknown', release_id)
                    db.execute('INSERT INTO workspace_retirements VALUES (?,?,?,?,?,?,?)',
                               (operation, current.allocation_id, release_id, 'dispatching', now, now,
                                receipt['id'] if receipt is not None else None))
                try:
                    stop(current, operation)
                except Exception as exc:
                    from .operations import NotDispatched
                    if isinstance(exc, NotDispatched):
                        with self.store._db() as db:
                            db.execute('UPDATE workspace_retirements SET state=?,updated=? WHERE id=?',
                                       ('refused', self.store.clock(), operation))
                            db.execute('DELETE FROM claims WHERE operation=?', (operation,))
                        return IdleObservation('running', operation)
            else:
                operation = receipt['id']
            result = self._observe(current)
            # Only an exact stopped observation releases CPU/RAM. A ready or
            # missing response after a sent stop keeps the claim until checked.
            stopped = result.state == 'stopped'
            with self.store._db() as db:
                if stopped:
                    db.execute('UPDATE workspace_leases SET state=?,lease=?,held=0,updated=? WHERE allocation_id=?',
                               ('stopped', _json(result.lease), self.store.clock(), current.allocation_id))
                    db.execute('DELETE FROM claims WHERE operation=?', (operation,))
                db.execute('UPDATE workspace_retirements SET state=?,updated=? WHERE id=?',
                           ('succeeded' if stopped else 'uncertain', self.store.clock(), operation))
            return IdleObservation('stopped' if stopped else 'unknown', operation)
