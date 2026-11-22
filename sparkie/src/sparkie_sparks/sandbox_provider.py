"""Native Hermes execution over a lease from the private compute allocator.

The callbacks are trusted application composition, never model tool arguments.
They must use the checked fleet operation path and persist/reconcile allocation
before dispatch. This module does not create containers or implement commands.
"""
import math
from pathlib import PurePosixPath
import re
import threading

from agent.terminal_env_provider import TerminalEnvironmentProvider

from .sandbox_ssh import PinnedSandboxSSH
from .workspace_types import ComputeNode, IdleObservation, WorkspaceLease, WorkspaceRequest


class LeasedSandboxSSH(PinnedSandboxSSH):
    """Native cleanup remains connection cleanup; idle stop needs observation."""

    def __init__(self, lease, idle, *, release=None, **kwargs):
        self.lease, self._idle, self._release = lease, idle, release
        self.idle_observation = None
        super().__init__(host=lease.host, user=lease.user, port=lease.port,
                         key_path=lease.key_path, known_hosts=lease.known_hosts,
                         host_key_alias=lease.host_key_alias,
                         expected_host_key=lease.expected_host_key, **kwargs)

    def cleanup(self):
        try:
            super().cleanup()
        finally:
            # This is only a durable hint to the private scanner, even when
            # native SSH cleanup fails. Fresh activity checks still protect any
            # session or job that remains; the hint releases no capacity.
            if self._release is not None:
                self._release(self.lease)
                self._release = None

    def stop_idle(self):
        # Native cleanup syncs supported files and closes SSH. Detached jobs may
        # remain. Only the private executor can observe those and stop/release.
        super().cleanup()
        result = self._idle(self.lease)
        if (not isinstance(result, IdleObservation)
                or result.state not in ('stopped', 'running', 'unknown')
                or not isinstance(result.operation_id, str) or not result.operation_id):
            raise RuntimeError('Compute idle result is unverified; its resources remain held.')
        self.idle_observation = result
        if result.state != 'stopped':
            # Native reaper treats a normal return as success. Do not let it
            # report cleanup completed when remote work remains or is unknown.
            raise RuntimeError('Compute work remains running or unverified; its resources remain held.')
        return result


class SparkComputeProvider(TerminalEnvironmentProvider):
    name = 'spark_compute'
    display_name = 'Spark compute workspace'
    is_remote = True
    is_container = True
    supports_streams = True
    skip_container_guards = False
    default_cwd = '/workspace'
    cache_path_base = '/home/sandbox/.hermes'
    # Persistent identity belongs to the allocator. Do not promise hosted tenant
    # isolation or ephemeral sandbox destruction that this integration lacks.
    serves_hosted_scopes = False
    session_isolated_when_nonpersistent = False

    def __init__(self, *, nodes=(), hub_machine_id=None, image=None, acquire=None, idle=None, release=None):
        nodes = tuple(nodes)
        if nodes and (not isinstance(hub_machine_id, str)
                      or not re.fullmatch(r'[a-f0-9]{32}', hub_machine_id)):
            raise ValueError('Verify the permanent host identity before configuring compute.')
        if any(not isinstance(node, ComputeNode) for node in nodes):
            raise ValueError('Use the verified compute Spark inventory.')
        self._nodes = {node.spark_id: node for node in nodes}
        if (len(self._nodes) != len(nodes) or any(
                not isinstance(node, ComputeNode) or node.spark_id not in ('spark2', 'spark3', 'spark4')
                or not re.fullmatch(r'[a-f0-9]{32}', node.machine_id)
                or node.machine_id == hub_machine_id
                or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9.:-]{0,252}', node.host)
                for node in nodes)
                or len({node.machine_id for node in nodes}) != len(nodes)
                or len({node.host for node in nodes}) != len(nodes)):
            raise ValueError('Use the verified, distinct compute Spark inventory; Spark 1 is excluded.')
        if image is not None and not re.fullmatch(r'(?:[a-zA-Z0-9._/:\-]+@)?sha256:[a-f0-9]{64}', image):
            raise ValueError('Pin the qualified compute sandbox image by digest.')
        self._image, self._acquire, self._idle = image, acquire, idle
        if release is not None and not callable(release):
            raise ValueError('Use a trusted native cleanup hint callback.')
        self._release, self._connections = release, {}
        self._bindings, self._locks, self._lock = {}, {}, threading.Lock()

    def is_available(self):
        return bool(self._nodes and self._image and callable(self._acquire) and callable(self._idle))

    def probe(self):
        return ('ready', 'Compute allocator configured; readiness is checked on use.') if self.is_available() else (
            'unavailable', 'Compute allocator is not configured and qualified. No compute commands will run.')

    def _validate_lease(self, lease, request):
        node = self._nodes.get(lease.spark_id) if isinstance(lease, WorkspaceLease) else None
        if (node is None or lease.request != request
                or lease.machine_id != node.machine_id or lease.host != node.host
                or lease.user != 'sandbox' or type(lease.port) is not int or not 1024 <= lease.port <= 65535
                or not re.fullmatch(r'[a-f0-9]{32}', lease.workspace_id)
                or lease.host_key_alias != 'sparkie-workspace-' + lease.workspace_id
                or not re.fullmatch(r'[a-f0-9]{64}', lease.container_id)
                or not re.fullmatch(r'sha256:[a-f0-9]{64}', lease.image_id)):
            raise ValueError('Compute allocation does not match its exact request and verified identity.')

    def create_environment(self, *, cwd, timeout, task_id='default', image=None, container_config=None, **kwargs):
        if not self.is_available():
            raise RuntimeError(self.probe()[1])
        if kwargs.get('scope') is not None or kwargs.get('sandbox') is not None:
            raise ValueError('Hosted agent scopes are not qualified for this backend.')
        if not isinstance(task_id, str) or not task_id or len(task_id) > 512 or any(ord(c) < 32 for c in task_id):
            raise ValueError('Use the native Hermes task identity.')
        # Hermes passes an empty string when no plugin-specific per-task image
        # override exists. The trusted provider's pinned image remains in force.
        if image not in (None, '', self._image):
            raise ValueError('The requested image does not match the qualified compute sandbox.')
        path = PurePosixPath(cwd) if isinstance(cwd, str) else None
        if path is None or not path.is_absolute() or '..' in path.parts or not path.is_relative_to('/workspace'):
            raise ValueError('Start compute work in its dedicated /workspace directory.')
        cc = container_config or {}
        if any(cc.get(key) for key in ('docker_volumes', 'docker_mount_cwd_to_workspace', 'docker_forward_env',
                                       'docker_env', 'docker_run_as_host_user', 'docker_extra_args')):
            raise ValueError('Host mounts, inherited credentials and arbitrary container options are not allowed.')
        cpu, memory, disk = cc.get('container_cpu', 1), cc.get('container_memory', 4096), cc.get('container_disk', 51200)
        persistent = cc.get('container_persistent', True)
        if (type(cpu) not in (int, float) or not math.isfinite(cpu) or cpu <= 0
                or type(memory) is not int or memory <= 0 or type(disk) is not int or disk <= 0
                or persistent is not True):
            raise ValueError('Compute resources must be positive and project storage must be retained.')
        request = WorkspaceRequest(task_id, self._image, cpu, memory, disk, persistent)
        with self._lock:
            task_lock = self._locks.setdefault(task_id, threading.RLock())
        with task_lock:
            previous = self._bindings.get(task_id)
            if previous is not None and previous.request != request:
                raise ValueError('An existing task cannot change its image or resource allocation.')
            lease = self._acquire(request)
            self._validate_lease(lease, request)
            if previous is not None and previous != lease:
                raise ValueError('An existing task cannot silently move to a different workspace or identity.')
            # Retain identity even if SSH fails: retry reconciles this same lease,
            # and cannot silently allocate another workspace after uncertain work.
            self._bindings[task_id] = lease
            connection = object()
            self._connections[task_id] = connection
            def release(current):
                # A late cleanup from an old environment cannot release a more
                # recently acquired connection for the same native task.
                with task_lock:
                    if self._connections.get(task_id) is connection:
                        self._release(current)
            return LeasedSandboxSSH(lease, self._idle,
                                    release=release if self._release is not None else None,
                                    cwd=str(path), timeout=timeout,
                                    persistent=True)


class LazySparkComputeProvider(SparkComputeProvider):
    """Retry trusted startup configuration after a late/restarted controller.

    A successful composition is retained. There is no periodic probe or host
    fallback, and no extra configuration round trip on ordinary tool calls.
    """
    def __init__(self, configure):
        super().__init__()
        self._configure, self._delegate = configure, None
        self._configuration_lock = threading.Lock()

    def _configured(self):
        with self._configuration_lock:
            if self._delegate is None:
                try:
                    value = self._configure()
                    if isinstance(value, SparkComputeProvider) and value.is_available():
                        self._delegate = value
                except (OSError, KeyError, TypeError, ValueError, RuntimeError):
                    pass
            return self._delegate

    def is_available(self):
        return self._configured() is not None

    def probe(self):
        provider = self._configured()
        return provider.probe() if provider is not None else (
            'unavailable', 'Compute controller is not configured or is unavailable. No compute commands will run; retry after it recovers.')

    def create_environment(self, **kwargs):
        provider = self._configured()
        if provider is None:
            raise RuntimeError('Compute controller is not configured or is unavailable. No compute commands will run; retry after it recovers.')
        return provider.create_environment(**kwargs)
