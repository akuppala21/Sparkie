# Native Hermes tools on a compute Spark

Source review of pinned Hermes v0.23.2, November 19, 2026. This is a concrete
implementation plan. Its proposed custom exec/stream transport is superseded by
[the implemented native SSH-container integration](compute-native-ssh.md), whose
isolated proof and remaining deployment limits are recorded separately. No SSH
configuration, credentials, Docker daemon settings or live application changed.

**Follow-up:** [native SSH inside a non-root compute container](compute-native-ssh.md)
has now passed an isolated proof. Use that simpler direction for execution,
file sync, Python, streams and artifacts. It supersedes the custom exec/stream
transport below; the fixed placement, resource and lifecycle requirements remain.

## Why a remote Docker environment variable is insufficient

The native Docker backend runs the Docker CLI, so its subprocesses inherit
`DOCKER_HOST=ssh://...`. Docker itself can use that transport. But the backend
assumes its daemon and host files belong to the same machine:

- `DockerEnvironment._mount_args` creates persistent `/root` and `/workspace`
  bind sources with **hub-local** `os.makedirs`. A remote Docker engine resolves
  those source paths on the compute Spark, not on the hub.
- `_readonly_skill_mount_args` similarly passes local skills, caches and any
  configured credential paths as bind mounts. Matching path strings do not make
  the files present or current on another machine.
- `FileSyncManager` documents Docker as a bind-mount backend and does not sync
  those paths. Automatic bind-directory cleanup also acts on the hub filesystem.
- Docker CLI selection, daemon capability probes and environment inheritance are
  process-wide. Changing `DOCKER_HOST` between concurrent tasks can redirect
  existing container operations or use a capability result from another Spark.
- A daemon SSH key outside a container is not itself an isolation proof. The
  completed sandbox test did not exercise remote mounts, artifacts, remote
  cancellation or the credential-bearing remote transport.

Therefore do not publish a config-only remote-Docker recipe as a working fleet
backend, mirror the owner's whole home to make paths match, or switch daemon
environment variables while requests are running.

## Smallest supported integration

Register one `TerminalEnvironmentProvider` named `spark_compute` using the native
`PluginContext.register_terminal_environment_provider` API. It adapts Hermes's
existing terminal, file tools, `execute_code`, process tracking and artifact
fetching to a sandbox allocated by the private fleet boundary. It does not plan
tasks, maintain another chat queue, provide a new shell tool or run a second agent.

Use one configured backend for the gateway process. Its `create_environment`
receives the native `task_id` and resolves that task to one fixed workspace lease.
The lease records a verified compute Spark, exact container ID, workspace volume,
image digest and resource limits. **Never change that target underneath a running
session.** A new independent task may allocate another Spark; moving an existing
workspace is a separate, explicit stopped-work transfer with verified files.
Spark 1 is never eligible for a compute lease. Native delegated work inherits the
parent environment unless a separate, explicit workspace was allocated.

### Provider and environment interfaces

| Native interface | Implementation boundary |
| --- | --- |
| `TerminalEnvironmentProvider` | `is_remote=True`, `is_container=True`, `skip_container_guards=False`, `default_cwd='/workspace'`, `cache_path_base='/root/.hermes'`. No host filesystem fast path. |
| `is_available()` / `probe()` | Cheap local configuration/state checks. Never wake a Spark during a picker paint. Report sleeping/unavailable distinctly. |
| `create_environment(cwd, timeout, task_id, image, container_config, **kwargs)` | Obtain/reuse an exact workspace lease through the private executor. Validate requested resources against policy. Fixed approved image; no arbitrary Docker flags, host mounts or devices. |
| `BaseEnvironment._run_bash(cmd_string, login, timeout, stdin_data)` | Return a process handle for a trusted local stream client. That client sends the script only to the allocated container's shell, through the private executor. Never interpolate it into a host SSH shell. |
| Inherited `execute`, native file tools and `execute_code` | Keep upstream quoting, output collection, working-directory and environment persistence. The tools see only the same container filesystem. |
| `exec_prefix(user, interactive)` | A local argument vector for that fixed stream client and workspace. Declare `supports_streams=True` only once stdin/stdout, native background processes and cancellation are demonstrated. No host user override. |
| Inherited `fetch_realpath` / `fetch_file(max_bytes)` | Use native bounded extraction through the same execution channel. Check allowed artifact roots and symlink resolution before returning owner-visible files. |
| `stop_idle()` / `cleanup()` | Release active work only after it is stopped/observed. Preserve project volume. A connection close must not claim a remote process stopped. Declare `cleanup_stops_processes` consistently with the actual behavior. |

The provider must load in process: v0.23.2's plugin-host isolation cannot return
usable environment objects. This does **not** grant it fleet credentials. The
provider communicates with the existing private executor; credentials and Docker
host access stay on the executor side and never enter model tools, volumes or
environment variables.

### Private executor boundary

Extend the existing boundary with a bounded workspace API, not another service
per feature. Keep ordinary fleet owner confirmations separate from the narrow
capability that lets an admitted task use its own container.

| Request | Required behavior |
| --- | --- |
| `create` | Durable operation ID before provisioning. Check Spark identity, wake only for requested work, wait for readiness, claim measured CPU/RAM/disk, create/reuse a labelled container with a dedicated volume. Lost reply resolves to the same lease. |
| `exec` | Lease + unique execution ID + bounded script/stdin. Accept only the exact container recorded in that lease. Dispatch through strict SSH to fixed trusted code, then argument-safe `docker exec`; host shell never evaluates model text. Return real stdout/stderr/exit state. |
| `inspect` / `cancel` | Inspect an uncertain execution before any retry. Cancellation must reach and observe its container process, including descendants, rather than merely kill the local SSH client. Unknown stays unknown. |
| `close` / `idle` | Quiesce only this workspace, retain its volume and artifact metadata, release its claim after observation. Running user work and shared infrastructure prevent power-down. Removing saved project data needs its own confirmation. |
| `fetch` | Native file fetching over the exec channel with size limits, fixed roots and symlink checks. No general host-file read/download verb. |

The current broker's small JSON request/reply framing is not a streaming process
transport. Before adding `exec`, specify bounded framing, stdin closure,
backpressure, disconnect/cancellation behavior and reconciliation. Use one small
trusted client to present ordinary pipes to native `BaseEnvironment`, retaining
upstream process handling. Do not reimplement a job scheduler or Python kernel.

## Files, resources and lifecycle

- Keep project content in a compute-local named volume or a dedicated checkout
  root selected by trusted configuration. No hub-home or Docker-socket mount.
  Separate concurrently edited projects/tasks; do not share an arbitrary writable
  directory across independent builds.
- Transfer the requested repository revision and selected attachments explicitly.
  Export only approved read-only skills and required public cache inputs, with a
  hash manifest. Never sync `.env`, SSH keys, broker sockets or whole Hermes state.
  The model performs edits with the native file tools inside its workspace.
- Use measured resource claims and container CPU/memory limits. The existing
  Spark storage driver did not enforce Docker disk quota; reserve/check capacity
  and report that limitation. Do not claim an unenforced quota is a hard limit.
- Keep one local inference endpoint on Spark 1. Moving shell execution does not
  start another model or send reasoning to a cloud provider.
- Retain saved project volumes across chat/gateway restarts. Recover leases by
  immutable Spark/container identity and labels. Do not auto-delete an unfamiliar
  container or rerun a command whose acknowledgement was lost.
- Idle sandbox reclamation and Spark power policy use the same observed resource
  state. A sleeping machine does not wake for status or artifact listings; an
  actual request for a missing artifact can state that it needs the machine.

## Focused qualification before enabling the backend

| Contract requirement | Necessary check; current evidence |
| --- | --- |
| Heavy execution stays off Spark 1 | Real native terminal + file edit + `execute_code` on a disposable Spark 2–4 workspace; verify machine/container identity and hub protection. **Not yet run.** |
| All native tools see one workspace | Write/patch/read, interpreter import and result download agree on content hashes and cwd. **Local Docker isolation passed earlier; remote route unqualified.** |
| No fleet credentials in model execution | Host canary, SSH key/socket, Docker socket, environment and sibling-workspace access probes fail through terminal, files, Python and stream tools. **Remote route unqualified.** |
| Concurrent tasks cannot redirect each other | Two independent native task IDs keep fixed Sparks/containers while interleaved calls, cleanup and restart happen. No ambient `DOCKER_HOST` mutation. **Not yet run.** |
| Lost reply/cancel/restart reports facts | Lose the exec acknowledgement and kill the client; observe the same execution, send no duplicate, cancel descendants or report still-running/unknown. **Existing fleet stop receipts do not qualify this path.** |
| Sleep and resume save power safely | Idle keeps files, active processes block sleep, requested work wakes only the leased Spark, and artifact hashes survive. **Not yet run.** |
| Self-work prepares a reviewable update | Native coding edits an isolated extension checkout, runs the affected checks and exports a candidate diff/results; no live install. **Not yet run.** |

Implement and qualify that single vertical path first. Later GPU devices, app
publication and cross-Spark workspace moves get their own small additions and
targeted checks; they do not require changing Hermes's agent loop.

## Pinned source references

- [Supported terminal provider interface](https://github.com/NousResearch/hermes-agent/blob/v0.23.2/agent/terminal_env_provider.py)
- [Provider guide and file/process semantics](https://github.com/NousResearch/hermes-agent/blob/v0.23.2/website/docs/developer-guide/terminal-environment-plugin.md)
- [Native factory](https://github.com/NousResearch/hermes-agent/blob/v0.23.2/tools/terminal_tool_backends.py)
- [Docker mounts, reuse and cleanup](https://github.com/NousResearch/hermes-agent/blob/v0.23.2/tools/environments/docker.py)
- [Native environment and bounded artifacts](https://github.com/NousResearch/hermes-agent/blob/v0.23.2/tools/environments/base.py)
- [Native stream adapter](https://github.com/NousResearch/hermes-agent/blob/v0.23.2/tools/environments/streams.py)
- [File sync scope](https://github.com/NousResearch/hermes-agent/blob/v0.23.2/tools/environments/file_sync.py)
