"""Connect native Hermes workspaces to the existing private fleet controller."""
from dataclasses import asdict, replace
import hashlib
from pathlib import Path
import uuid

from .workspace_leases import ResourceBudget, WorkspaceLeases
from .workspace_remote import RemoteWorkspaceWorker
from .workspace_types import ComputeNode, IdleObservation, WorkspaceLease, WorkspaceRequest
from .release_hints import ID, ReleaseHints


class ComputeService:
    def __init__(self, store, config, *, transport_factory=RemoteWorkspaceWorker,
                 ensure_awake=None, candidate_order=None):
        if (not isinstance(config, dict) or set(config) != {
                'schema', 'scope', 'controller', 'hub_machine_id', 'image', 'credentials_dir', 'nodes'}
                or config['schema'] != 1 or not isinstance(config['scope'], str)
                or not 0 < len(config['scope']) <= 256
                or not isinstance(config['nodes'], list) or not 1 <= len(config['nodes']) <= 3):
            raise ValueError('Configure the protected compute fleet and native runtime scope.')
        self.scope, self.config = config['scope'], config
        self.store = store
        self.release_hints = ReleaseHints(Path(config['credentials_dir']) / 'release-hints')
        with store._db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS workspace_connection_generations '
                       '(allocation TEXT PRIMARY KEY, generation TEXT NOT NULL)')
        nodes, budgets, self.workers = [], {}, {}
        for row in config['nodes']:
            if not isinstance(row, dict) or set(row) != {'identity', 'budget', 'user', 'executable', 'config'}:
                raise ValueError('Configure each fixed compute-worker endpoint.')
            node = ComputeNode(**row['identity'])
            nodes.append(node)
            budgets[node.spark_id] = ResourceBudget(**row['budget'])
            if node.spark_id in self.workers:
                raise ValueError('A compute Spark cannot have two worker identities.')
            self.workers[node.spark_id] = transport_factory(store, node=node, user=row['user'],
                executable=row['executable'], config_path=row['config'], controller_id=config['controller'],
                credentials_dir=str(Path(config['credentials_dir']) / node.spark_id))
        self.leases = WorkspaceLeases(store, nodes=nodes, hub_machine_id=config['hub_machine_id'],
            image=config['image'], budgets=budgets,
            provision=lambda allocation: self.workers[allocation.node.spark_id].provision(allocation),
            observe=lambda allocation: self.workers[allocation.node.spark_id].observe(allocation),
            activity=lambda allocation: self.workers[allocation.node.spark_id].activity(allocation),
            candidate_order=candidate_order, **({'ensure_awake': ensure_awake} if ensure_awake is not None else {}))

    def configuration(self):
        return {'nodes': [asdict(node) for node in self.leases.nodes.values()],
                'hub_machine_id': self.config['hub_machine_id'], 'image': self.config['image'],
                'release_queue': str(self.release_hints.path)}

    def _connection_lock(self, task_id):
        if not isinstance(task_id, str) or not 0 < len(task_id) <= 512 or any(ord(c) < 32 for c in task_id):
            raise ValueError('Use the exact native task identity.')
        return self.store._lock(hashlib.sha256(('native-connection:' + self.scope + '\0' + task_id).encode()).hexdigest()[:32])

    @staticmethod
    def _generation(generation):
        if not isinstance(generation, str) or not ID.fullmatch(generation):
            raise ValueError('Use the exact native connection generation.')

    def acquire(self, request, generation):
        # Scope is set by protected launch configuration, never by model args.
        self._generation(generation)
        request = WorkspaceRequest(**request)
        with self._connection_lock(request.task_id) as acquired:
            if not acquired:
                raise RuntimeError('This native workspace is reconnecting. Check the same request before retrying.')
            lease = self.leases.acquire(self.scope, request)
            with self.store._db() as db:
                db.execute('INSERT INTO workspace_connection_generations VALUES (?,?) '
                    'ON CONFLICT(allocation) DO UPDATE SET generation=excluded.generation',
                    (lease.workspace_id, generation))
            return asdict(replace(lease, connection_generation=generation))

    def _cleanup(self, task_id, workspace_id, generation, *, observe):
        self._generation(generation)
        with self._connection_lock(task_id) as acquired:
            if not acquired:
                raise RuntimeError('This native workspace is reconnecting; its cleanup hint is retained.')
            allocation = self.leases.get(self.scope, task_id)
            if allocation is None or allocation.lease is None or allocation.allocation_id != workspace_id:
                raise ValueError('Use the exact saved native workspace.')
            with self.store._db() as db:
                row = db.execute('SELECT generation FROM workspace_connection_generations WHERE allocation=?',
                                 (workspace_id,)).fetchone()
            if row is None or row[0] != generation:
                # A durable cleanup replay cannot release a resumed connection.
                return asdict(IdleObservation('unknown', generation))
            action = self.leases.idle if observe else self.leases.release
            return asdict(action(self.scope, allocation.lease))

    def idle(self, task_id, workspace_id, generation):
        return self._cleanup(task_id, workspace_id, generation, observe=True)

    def release(self, task_id, workspace_id, generation):
        return self._cleanup(task_id, workspace_id, generation, observe=False)

    def retry_releases(self):
        for hint in self.release_hints.pending():
            try:
                self.release(**hint)
            except (ValueError, RuntimeError):
                continue
            self.release_hints.remove(hint)

    def scan(self):
        self.retry_releases()
        outcomes = []
        for allocation in self.leases.released():
            worker = self.workers[allocation.node.spark_id]
            try:
                result = self.leases.retire(self.scope, allocation.request.task_id, allocation.release_id,
                                           activity=worker.idle_activity, stop=worker.retire)
                outcomes.append({'workspace': allocation.allocation_id, **asdict(result)})
            except (ValueError, RuntimeError):
                outcomes.append({'workspace': allocation.allocation_id, 'state': 'unknown'})
        return outcomes


class RemoteWorkspaces:
    def __init__(self, path):
        from .broker import RemoteControls
        self.remote = RemoteControls(path, timeout=240)
        self.release_hints = None

    def configuration(self):
        config = self.remote._call('workspace_config')
        self.release_hints = ReleaseHints(config['release_queue'])
        return config

    def acquire(self, request):
        if self.release_hints is None:
            self.configuration()
        generation = uuid.uuid4().hex
        row = dict(self.remote._call('workspace_acquire', request=asdict(request), generation=generation))
        if row.get('connection_generation') != generation:
            raise RuntimeError('The native connection generation did not match.')
        row['request'] = WorkspaceRequest(**row['request'])
        return WorkspaceLease(**row)

    def idle(self, lease):
        return self._cleanup(lease, observe=True)

    def release(self, lease):
        return self._cleanup(lease, observe=False)

    def _cleanup(self, lease, *, observe):
        hint = {'task_id': lease.request.task_id, 'workspace_id': lease.workspace_id,
                'generation': lease.connection_generation}
        if self.release_hints is None:
            raise RuntimeError('The native cleanup cache was not configured before acquiring a workspace.')
        self.release_hints.save(hint)
        result = IdleObservation(**self.remote._call('workspace_idle' if observe else 'workspace_release', **hint))
        self.release_hints.remove(hint)
        return result


def configured_provider():
    """Register unavailable when private composition is absent; no host fallback."""
    import os
    from .sandbox_provider import LazySparkComputeProvider, SparkComputeProvider
    def configure():
        path = os.environ.get('SPARKIE_CONTROL_SOCKET')
        if not path:
            raise RuntimeError('No private compute controller is configured.')
        remote = RemoteWorkspaces(path)
        config = remote.configuration()
        return SparkComputeProvider(nodes=[ComputeNode(**node) for node in config['nodes']],
            hub_machine_id=config['hub_machine_id'], image=config['image'],
            acquire=remote.acquire, idle=remote.idle, release=remote.release)
    return LazySparkComputeProvider(configure)
