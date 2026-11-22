"""Narrow immutable values shared by native execution and private allocation."""
from dataclasses import dataclass, field


@dataclass(frozen=True)
class ComputeNode:
    spark_id: str
    machine_id: str
    host: str


@dataclass(frozen=True)
class WorkspaceRequest:
    task_id: str
    image: str
    cpu: float
    memory_mb: int
    disk_mb: int
    persistent: bool


@dataclass(frozen=True)
class WorkspaceLease:
    request: WorkspaceRequest
    workspace_id: str
    spark_id: str
    machine_id: str
    host: str
    port: int
    user: str
    container_id: str
    image_id: str
    key_path: str = field(repr=False)
    known_hosts: str = field(repr=False)
    host_key_alias: str
    expected_host_key: str
    # Current native connection use, not the persistent workspace identity.
    # The controller stores this fence separately from the saved Docker lease.
    connection_generation: str = field(default='', compare=False)


@dataclass(frozen=True)
class IdleObservation:
    state: str  # stopped, running, or unknown; only an observed stop is success
    operation_id: str
