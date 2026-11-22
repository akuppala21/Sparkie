"""Durable node reservations for owner-requested, enrolled model and app services.

The existing OperationStore owns authority, dispatch claims and reconciliation.
A service reservation outlives the launch operation, including an uncertain start.
The backend owns the service. Only its fresh, identity-checked observation can
supply an endpoint or prove the reserved workload has stopped.
"""

from dataclasses import dataclass
import json
import re
import sqlite3

from .operations import NotDispatched


SERVICE_ID = re.compile(r'[a-z][a-z0-9-]{0,47}')
REVISION = re.compile(r'[0-9a-f]{64}')
INSTANCE = re.compile(r'[0-9a-f]{32}')
COMPUTE = ('spark2', 'spark3', 'spark4')


def service_intent(action, spark, recipe, revision, instance=None):
    if (
        action not in ('start_service', 'stop_service')
        or spark not in COMPUTE
        or not isinstance(recipe, str)
        or not SERVICE_ID.fullmatch(recipe)
        or not isinstance(revision, str)
        or not REVISION.fullmatch(revision)
    ):
        raise ValueError('Choose an enrolled service revision and compute Spark.')
    target = {'action': action, 'spark': spark, 'recipe': recipe, 'revision': revision}
    if action == 'stop_service' and isinstance(instance, str) and INSTANCE.fullmatch(instance):
        return {**target, 'instance': instance}
    if action != 'start_service' or instance is not None:
        raise ValueError('Stop requires the exact start operation for this service.')
    return target


def service_holds_node(db, spark):
    # Older installations and workspaces do not need a service configuration.
    return bool(
        db.execute(
            "SELECT 1 FROM sqlite_master WHERE name='recipe_service_instances' AND type='table'"
        ).fetchone()
        and db.execute(
            "SELECT 1 FROM recipe_service_instances WHERE spark=? AND held=1", (spark,)
        ).fetchone()
    )


@dataclass(frozen=True)
class ServiceRecipe:
    name: str
    revision: str
    kind: str
    nodes: tuple[str, ...]
    port: int
    model: str | None = None


@dataclass(frozen=True)
class ServiceObservation:
    state: str  # ready, stopped, unknown
    workload: str
    port: int | None = None


class RecipeServices:
    def __init__(self, store, *, recipes, nodes, backends, authorize, wake=None):
        self.store, self.nodes, self.backends = store, dict(nodes), dict(backends)
        self.authorize, self.wake = authorize, wake
        self.recipes = {}
        for item in recipes:
            service_intent('start_service', item.nodes[0] if item.nodes else '', item.name, item.revision)
            if (
                item.name in self.recipes
                or item.kind not in ('model', 'app')
                or item.kind not in self.backends
                or not item.nodes
                or any(n not in COMPUTE or n not in self.nodes for n in item.nodes)
                or type(item.port) is not int
                or not 1024 <= item.port <= 65535
                or (item.kind == 'model') != bool(item.model)
            ):
                raise ValueError(
                    'Configure one reviewed backend, fixed port and eligible nodes per service.'
                )
            self.recipes[item.name] = item
        with store._db() as db:
            db.execute(
                'CREATE TABLE IF NOT EXISTS recipe_service_instances ('
                'id TEXT PRIMARY KEY, name TEXT NOT NULL, revision TEXT NOT NULL, spark TEXT NOT NULL, '
                'machine TEXT NOT NULL, workload TEXT, stop_id TEXT, phase TEXT NOT NULL, held INTEGER NOT NULL)'
            )
            for column in ('name', 'spark'):
                db.execute(
                    f'CREATE UNIQUE INDEX IF NOT EXISTS active_recipe_service_{column} '
                    f'ON recipe_service_instances({column}) WHERE held=1'
                )

    def catalog(self):
        from .service_definitions import DEFINITIONS, resources

        with self.store._db() as db:
            rows = {
                name: db.execute(
                    'SELECT id,spark,phase,held FROM recipe_service_instances '
                    'WHERE name=? ORDER BY rowid DESC LIMIT 12',
                    (name,),
                ).fetchall()
                for name in self.recipes
            }
        return [
            {
                'recipe': r.name,
                'revision': r.revision,
                'kind': r.kind,
                'sparks': list(r.nodes),
                'resources': resources(r.name) if r.name in DEFINITIONS else {},
                'instances': [
                    {
                        'instance': row['id'],
                        'spark': row['spark'],
                        'phase': row['phase'],
                        'held': bool(row['held']),
                    }
                    for row in rows[r.name]
                ],
            }
            for r in self.recipes.values()
        ]

    def validate(self, target):
        try:
            self._recipe(target)
        except (NotDispatched, KeyError) as exc:
            raise ValueError('The service revision is not enrolled on that compute Spark.') from exc
        if service_intent(**target) != target:
            raise ValueError('Use one exact enrolled service intent.')
        if target['action'] == 'stop_service':
            row = self._row(target['instance'])
            if (
                not row
                or not row['held']
                or row['name'] != target['recipe']
                or row['revision'] != target['revision']
                or row['spark'] != target['spark']
                or row['machine'] != self.nodes[row['spark']].machine_id
            ):
                raise ValueError('Select the current service instance on its enrolled compute Spark.')

    def logs(self, name, instance):
        row = self._row(instance)
        r = self.recipes.get(name)
        if (
            not row
            or not r
            or row['name'] != name
            or row['revision'] != r.revision
            or row['spark'] not in r.nodes
            or row['machine'] != self.nodes[row['spark']].machine_id
        ):
            raise ValueError('Select the recorded service instance on its enrolled worker.')
        if not row['workload']:
            return ['Service reservation ' + row['phase'] + '.']
        return self.backends[r.kind].logs(r, self.nodes[row['spark']], instance, row['workload'])

    def _recipe(self, target):
        recipe = self.recipes.get(target['recipe'])
        if recipe is None or recipe.revision != target['revision'] or target['spark'] not in recipe.nodes:
            raise NotDispatched('The reviewed service or compute placement changed.')
        return recipe

    def _row(self, instance):
        with self.store._db() as db:
            row = db.execute('SELECT * FROM recipe_service_instances WHERE id=?', (instance,)).fetchone()
            return dict(row) if row else None

    def _reserve(self, instance, recipe, node):
        with self.store._db() as db:
            claim = db.execute('SELECT operation FROM claims WHERE spark=?', (node.spark_id,)).fetchone()
            if not claim or claim[0] != instance:
                raise NotDispatched('The checked start has no current compute claim.')
            if db.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='workspace_leases'"
            ).fetchone():
                if any(
                    json.loads(row[0])['spark_id'] == node.spark_id
                    for row in db.execute('SELECT node FROM workspace_leases WHERE held=1')
                ):
                    raise NotDispatched('A native workspace already owns resources on this compute Spark.')
            try:
                db.execute(
                    'INSERT INTO recipe_service_instances VALUES (?,?,?,?,?,NULL,NULL,?,1)',
                    (instance, recipe.name, recipe.revision, node.spark_id, node.machine_id, 'reserved'),
                )
            except sqlite3.IntegrityError:
                raise NotDispatched(
                    'The service name or compute Spark already has a reservation.'
                ) from None

    def dispatch(self, operation, target):
        try:
            if not INSTANCE.fullmatch(operation):
                raise ValueError('Invalid operation.')
            self.validate(target)
        except (TypeError, ValueError, KeyError):
            raise NotDispatched('The service target is invalid.') from None
        recipe = self._recipe(target)
        node = self.nodes[target['spark']]
        backend = self.backends[recipe.kind]
        if not self.authorize(operation, target):
            raise NotDispatched('The service operation is no longer authorized.')
        if target['action'] == 'stop_service':
            with self.store._db() as db:
                claim = db.execute(
                    "SELECT operation FROM claims WHERE spark=?", (node.spark_id,)
                ).fetchone()
                if not claim or claim[0] != operation:
                    raise NotDispatched('The service stop does not hold its compute claim.')
                previous = db.execute(
                    'SELECT phase FROM recipe_service_instances WHERE id=?', (target['instance'],)
                ).fetchone()
                changed = db.execute(
                    "UPDATE recipe_service_instances SET phase='stopping',stop_id=? "
                    "WHERE id=? AND name=? AND revision=? AND spark=? AND machine=? "
                    "AND held=1 AND workload IS NOT NULL AND stop_id IS NULL",
                    (
                        operation,
                        target['instance'],
                        recipe.name,
                        recipe.revision,
                        node.spark_id,
                        node.machine_id,
                    ),
                ).rowcount
                if not changed:
                    raise NotDispatched('The exact service cannot be stopped by this operation.')
            row = self._row(target['instance'])
            try:
                if not self.authorize(operation, target):
                    raise NotDispatched('The stop was revoked before dispatch.')
                backend.stop(recipe, node, row['id'], row['workload'], operation=operation)
            except NotDispatched:
                with self.store._db() as db:
                    db.execute(
                        "UPDATE recipe_service_instances SET phase=?,stop_id=NULL WHERE id=? AND stop_id=?",
                        (previous['phase'], row['id'], operation),
                    )
                raise
            return
        self._reserve(operation, recipe, node)
        try:
            if self.wake is not None and self.wake(operation, node) is not True:
                raise NotDispatched('The compute Spark was not verified ready for this service.')
            # Planning is read-only. Bind the exact backend identity before start dispatch.
            workload = backend.plan(recipe, node, operation)
            if not isinstance(workload, str) or not re.fullmatch(
                r'[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}', workload
            ):
                raise ValueError('The backend did not return an exact workload identity.')
            if not self.authorize(operation, target):
                raise ValueError('The service start was revoked.')
        except Exception:
            with self.store._db() as db:
                db.execute(
                    "UPDATE recipe_service_instances SET held=0,phase='refused' WHERE id=? AND phase='reserved'",
                    (operation,),
                )
            raise NotDispatched('The service placement was refused before launching.') from None
        with self.store._db() as db:
            db.execute(
                "UPDATE recipe_service_instances SET workload=?,phase='starting' WHERE id=?",
                (workload, operation),
            )
        # A backend may have accepted the request if transport fails. Keep the reservation.
        try:
            backend.start(recipe, node, operation, workload)
        except NotDispatched:
            with self.store._db() as db:
                db.execute(
                    "UPDATE recipe_service_instances SET held=0,phase='refused' WHERE id=? AND phase='starting'",
                    (operation,),
                )
            raise

    def _observation(self, row, recipe):
        node = self.nodes[row['spark']]
        if node.machine_id != row['machine'] or recipe.revision != row['revision'] or not row['workload']:
            return None
        try:
            observed = self.backends[recipe.kind].observe(recipe, node, row['id'], row['workload'])
        except (OSError, RuntimeError, ValueError):
            return None
        if (
            not isinstance(observed, ServiceObservation)
            or observed.workload != row['workload']
            or observed.state not in ('ready', 'stopped')
            or observed.state == 'ready'
            and observed.port != recipe.port
        ):
            return None
        return observed

    def observe(self, operation, target):
        recipe = self._recipe(target)
        instance = target.get('instance', operation)
        row = self._row(instance)
        if row is None and target['action'] == 'start_service':
            # A start without a durable reservation cannot have reached a worker.
            return 'failed'
        if (
            not row
            or row['name'] != recipe.name
            or row['spark'] != target['spark']
            or target['action'] == 'stop_service'
            and row['stop_id'] != operation
        ):
            return 'unknown'
        if row['phase'] == 'reserved' and row['workload'] is None and target['action'] == 'start_service':
            # OperationStore holds the original operation lock while observing,
            # so no live dispatcher can still progress from this pre-send stage.
            with self.store._db() as db:
                changed = db.execute(
                    "UPDATE recipe_service_instances SET held=0,phase='refused' "
                    "WHERE id=? AND phase='reserved' AND workload IS NULL",
                    (instance,),
                ).rowcount
            return 'failed' if changed else 'unknown'
        if row['phase'] == 'refused':
            return 'failed'
        if row['phase'] == 'stopping' and target['action'] != 'stop_service':
            return 'unknown'
        if row['phase'] == 'stopped':
            return 'succeeded' if target['action'] == 'stop_service' else 'failed'
        observed = self._observation(row, recipe)
        if observed is None:
            return 'unknown'
        stopping = target['action'] == 'stop_service'
        if stopping and observed.state != 'stopped':
            return 'unknown'
        stopped = observed.state == 'stopped'
        with self.store._db() as db:
            if not db.execute(
                'UPDATE recipe_service_instances SET phase=?,held=? WHERE id=? AND phase=?',
                ('stopped' if stopped else 'ready', int(not stopped), instance, row['phase']),
            ).rowcount:
                return 'unknown'
        return 'succeeded' if stopping == stopped else 'failed'

    def reconcile_pending(self):
        with self.store._db() as db:
            pending = db.execute(
                "SELECT id FROM operations WHERE state IN ('dispatching','uncertain') "
                "AND json_extract(intent,'$.action') IN ('start_service','stop_service') ORDER BY updated LIMIT 6"
            ).fetchall()
        return [self.store.reconcile(r[0], observe=self.observe)['state'] for r in pending]

    def current_endpoint(self, value):
        row = self._row(value['instance'])
        return bool(
            row
            and row['held']
            and row['phase'] == 'ready'
            and row['revision'] == value['revision']
            and row['spark'] == value['spark']
            and row['name'] == value['recipe']
        )

    def endpoint(self, recipe, *, instance=None):
        selected = self.recipes.get(recipe)
        if selected is None:
            return None
        with self.store._db() as db:
            result = db.execute(
                "SELECT * FROM recipe_service_instances WHERE name=? AND phase='ready' AND held=1",
                (recipe,),
            ).fetchone()
        if result is None or instance is not None and instance != result['id']:
            return None
        row = dict(result)
        observation = self._observation(row, selected)
        if observation is None or observation.state != 'ready' or self._row(row['id']) != row:
            return None
        node = self.nodes[row['spark']]
        return {
            'recipe': recipe,
            'revision': selected.revision,
            'spark': node.spark_id,
            'instance': row['id'],
            'kind': selected.kind,
            'host': node.host,
            'port': observation.port,
            'backend_host': '127.0.0.1',
            'ready': True,
            'observed_at': self.store.clock(),
        }
