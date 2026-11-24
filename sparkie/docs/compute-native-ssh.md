# Use native SSH tools inside a compute container

**Recommended implementation direction, supported by an isolated Spark 4 proof.**
Hermes keeps its gateway, memory and local model on Spark 1. Its native terminal,
file tools, Python kernel, streams and artifact transport connect by SSH to a
dedicated non-root container on a compute Spark. That SSH key opens the container
only; it has no access to a Spark owner's shell or fleet administration.

This replaces the custom exec/stream transport proposed in
[the earlier workspace plan](compute-workspaces-plan.md). The small fleet
addition still needs to allocate, identify, wake and retire workspaces, but
Hermes already handles their actual commands and files.

## What is implemented and checked

`src/sparkie_sparks/sandbox_ssh.py` subclasses native `SSHEnvironment` only to
strengthen identity options. Hermes v0.23.2 has no configurable SSH-options or
known-hosts setting and defaults to `accept-new`. The subclass instead:

- Requires an enrolled Ed25519 host key and matching owner-only known-hosts file.
- Uses strict host checking, one dedicated client key, no SSH agent or ambient
  owner SSH configuration, and no agent/port forwarding. Both SSH and SCP use
  these options. Missing, changed or unrecognized keys fail closed.
- Gives ControlMaster connections a workspace/host-key/client-key identity.
  A recycled port or rotated key cannot reuse an older authenticated connection.
- Refuses a root login or host port 22. Its inputs come from trusted workspace
  setup, not a model-supplied address or arbitrary shell request.

The subclass adds no command execution loop, file-sync engine, Python runner,
session store or artifact protocol. `sandbox_provider.py` registers the supported
`spark_compute` backend, but its default instance reports unavailable: no real
allocator is configured. The runtime template still selects native Docker.

`workspace_types.py` defines immutable request, lease, compute identity and idle
observation values. The provider takes trusted `acquire(request)` and `idle(lease)`
callbacks. It validates the requested resources, pinned image, exact compute
identity, host, container and workspace key; the hub machine ID is excluded even
if relabelled. Reconnecting a task cannot change its allocation or identity. A
failed SSH connection retains that binding for reconciliation. This small binding
cache is not a durable allocation record; the private allocator supplies that.

The maintained pinned sandbox image contains OpenSSH client but not `sshd`.
The isolated test overlay in `tests/hardware/ssh-sandbox.Dockerfile` adds
`openssh-server=1:10.0p1-7+deb13u4`. Its server and shell both run as UID 12001
(`sandbox`) on container port 2222. Authentication is key-only and forwarding is
disabled. No real host SSH configuration, account or credential changes.

The initial Spark 4 proof passed four identity checks in 0.09 seconds and the
native tool proof in 14.009 seconds. The follow-up using the actual
`SparkComputeProvider` passed **29 focused checks in 0.60 seconds** and the real
native tool proof in **14.369 seconds**. It covered:

- Terminal commands, read/write/patch and native skill synchronization.
- Persistent `execute_code`: a variable survived between Python calls.
- Bidirectional process stdin/stdout and bounded artifact extraction.
- Wrong server and client key rejection, with no host credential, client key,
  Docker socket, fleet socket or synthetic secret visible to the tools.
- Container restart preserving project files and the enrolled SSH identity.
- Actual `PluginContext` registration and native factory routing through the
  exact compute lease, including reconnect after restart.
- Connection cleanup never invokes the idle callback. An observed detached job
  prevents the provider's idle stop from reporting success or releasing work.
- Actual one-CPU/4-GiB limits, dropped capabilities, no-new-privileges, read-only
  root and dedicated named volumes. No host bind mount was used.

The listener was published only on Spark 4 loopback. The fixture container and
volumes were removed. See receipts and the preserved first-run failure (private record).

## Small production connection still needed

The plugin uses Hermes's supported `PluginContext.register_terminal_environment_provider`
hook. After qualifying its allocator composition, select
`terminal.backend: spark_compute`. The provider classifies itself as remote and
container-backed, keeps normal approval checks, and returns a native SSH subclass.
The trusted provider configuration owns the sandbox image pin. Native Hermes
passes an empty image string when no plugin-specific override exists; any nonempty
override must match the configured pin exactly.

Its only fleet-specific work is obtaining a trusted fixed workspace lease:

1. The private executor records or finds the allocation by native task/workspace
   identity before changing anything. It selects only Sparks 2–4, checks actual
   capacity and existing work, wakes the selected machine for requested work,
   and waits for readiness.
2. It creates/reconnects an exact labelled container and dedicated project/home
   volumes. The lease binds Spark identity, container ID, image, resource limits,
   endpoint, host-key fingerprint and narrow sandbox client key. Endpoint and
   identity do not change beneath a running task.
3. `create_environment(...)` returns native SSH with that lease. Hermes owns all
   command, file, Python, process and stream calls. New independent workspaces
   may choose other Sparks; there is no process-global `DOCKER_HOST` switching.
4. Reconnect checks the saved lease and key. An uncertain container creation is
   reconciled by operation ID and labels before another create is sent.
5. Native cleanup closes connections and synchronizes supported files. The
   private executor determines whether actual work remains before stopping an
   idle container, releasing its resource claim or allowing Spark shutdown.

Provider glue accepts trusted `acquire(WorkspaceRequest)` and `idle(WorkspaceLease)`
callbacks. Those belong to the existing checked fleet operation path. They must
not accept owner approval, arbitrary Docker flags, host mounts or fleet commands
from model arguments. The registered provider stays unavailable until that
composition is configured and qualified. The idle callback returns an operation
ID plus `stopped`, `running` or `unknown`. Only an observed `stopped` returns
normally; unknown or continuing work raises and retains the task binding.

The sandbox login key may be held by the trusted Hermes process: it is a narrow
container capability, not a fleet key. Keep it outside prompts, memory, skills,
synced credentials, shell environment and logs. The non-root proof server owns
its host private key inside its own sandbox; this does not grant host or fleet
authority. Production endpoint enrollment must still bind that key to the
executor-observed container and resource lease.

## Lifecycle facts and limits

**SSH cleanup does not mean a remote job stopped.** The proof deliberately
started a detached `sleep`, cleaned up native SSH, then observed it still alive.
It explicitly terminated that synthetic job before removing the fixture.
Hermes's idle reaper protects native foreground calls and registered background
processes, but an unregistered detached process is outside that activity record.
The fleet executor must observe workspace processes too; unknown work prevents
automatic shutdown. Cancellation should use native process controls and report
their observations, never infer success from a disconnected client.

The pinned reaper removes its environment-cache entry before teardown, and does
not restore it when `stop_idle()` raises. A subsequent call must reacquire the
same durable lease. Moreover, it uses `stop_idle()` only for hosted/workspace
keys; normal remote `session:` keys receive plain `cleanup()`. The provider alone
therefore does not enable automatic container stop or Spark sleep. The allocator
still needs an observed idle integration through Hermes's maintained lifecycle
hooks, with reservations retained until both stop and remaining-work checks pass.

The native SSH sync manager transfers skills/caches and configured credential
files. Production leaves `credential_files` and environment passthrough empty
unless a specific narrow task requires otherwise. Never synchronize the whole
Hermes home, fleet credentials or owner data by default. Project repositories
live in their dedicated compute volume; requested artifacts use native bounded
fetching. Deleting saved volumes requires the owner's exact confirmation.

The proof does not qualify cross-Spark transport, automatic wake/allocation,
idle shutdown, GPU devices, browser/desktop tools, remote process cancellation,
multiple concurrent workspaces, disk quotas or a live deployment. The underlying
Spark Docker storage still lacks an enforced per-container disk quota; actual
capacity policy remains necessary. The next acceptance slice should connect one
fixed lease through the real private allocator and exercise a native coding task.

## Pinned references

- [Native SSH backend and sync](https://github.com/NousResearch/hermes-agent/blob/v0.23.2/tools/environments/ssh.py)
- [Supported terminal provider hook](https://github.com/NousResearch/hermes-agent/blob/v0.23.2/agent/terminal_env_provider.py)
- [Native process and stream routing](https://github.com/NousResearch/hermes-agent/blob/v0.23.2/tools/environments/streams.py)
- [Native idle and background-process checks](https://github.com/NousResearch/hermes-agent/blob/v0.23.2/tools/terminal_tool_lifecycle.py)


## Private LAN worker enrollment

Read the Linux machine ID, SSH host-key fingerprint, LAN address and interface name on each compute Spark using a trusted connection. On Spark 1, enroll the host key under that exact numeric address in the controller account’s `~/.ssh/known_hosts` file. Use the verified individual host key. The controller checks the key on every physical SSH connection. Sandbox SSH uses its own verified per-workspace key.

Set the compute identity’s `host` to the private address on both sides. In the worker’s protected `/etc/sparkie/worker.json`, set the top-level `interface` field to the Ethernet or Wi-Fi device that owns that address. Existing non-loopback worker files need this field before staging the updated worker. The public site input accepts distinct RFC 1918 or operator-managed shared-range IPv4 addresses. The worker probes only its enrolled interface, verifies the address and machine identity, and publishes the authenticated sandbox SSH port on that address. Reachability between Spark 1 and the enrolled LAN is required.
