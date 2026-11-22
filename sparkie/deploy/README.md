# Prepare a native Hermes candidate

These commands prepare and test a candidate on a compute Spark. They do not
install it, take over Telegram or change the existing Spark 1 page.

`candidate.py` verifies the upstream archive and commit in
`../upstream.lock.json`, builds the native locked dependency environment with
`uv sync --frozen`, copies the maintained Webapp and dashboard bundles, and
prepares the protected plugin collection. The full native feature collection
is retained; only stock dashboard-auth discovery manifests are replaced by the
owner-filtered native Nous provider. The native auth implementation stays intact.
`candidate.py` applies the reviewed sealed-home restore patch to the two native
web routers with Git before environment assembly. It verifies the patch digest
and both router digests before and after application. The manifest's
`native_patches` records the change separately from the upstream base commit.
Packaged direct web import and transfer restore return HTTP 409 and direct the
owner to staged recovery. Native backup and export remain available.
`workspace-worker.pyz` packages the same extension for the checked compute path.
The candidate virtualenv includes a plain `sparkie-extension.pth` pointing at its
sealed extension source. The generated native launcher uses Python isolated
mode, and the package check exercises plugin registration with that mode.

Build the two native frontend bundles with upstream's build tooling first. The
Webapp build uses `hermes_cli.webapp.prepare_webapp_renderer(..., explicit=True)`;
it must be an actual successful build of the pinned source, not a placeholder.
Then use the reviewed base Python and the aarch64 GNU uv binary identified in
`build-tools.json` on the compute Spark. The builder checks the SHA-256, seals
that executable as `tools/uv` in the candidate, and uses it for the frozen sync.
Supply the previous release's `tools/uv` when preparing a compatible successor.

The builder also installs the JSON Schema validator and its four dependencies
from the wheel hashes in the same upstream lock. The native structured-response
parser uses this package to reject values of the wrong type.

```sh
python sparkie/deploy/candidate.py prepare \
  --archive /path/to/hermes-v0.23.2.tar.gz \
  --destination /path/to/new-versioned-candidate \
  --webapp /path/to/pinned-hermes/apps/desktop/dist-webapp \
  --dashboard /path/to/pinned-hermes/hermes_cli/web_dist \
  --uv /path/to/uv --python /path/to/python
```

The destination must be new. The manifest hashes source, both UIs, plugin code,
dependencies, symlink targets and the external base interpreter. Its own hash
identifies the package for review. The native installation stamp records the
real upstream commit and Sparkie's external package stewardship, so native
in-place application updates refuse this sealed installation. OS ownership,
protected profiles/plugin roots and the checked candidate approval still need
to enforce the installation boundary.

The prepared virtualenv is **not relocatable**. Prepare it at the final
versioned path and qualify that result. The final packaging fixture uses
Ubuntu24.04 on a compute Spark and builds under the exact final `/opt/sparkie`
paths inside an ordinary disposable container. Its output includes the pinned
standalone Python runtime and hashes its standard library too. An archive may
be unpacked at those identical absolute paths; a development-path virtualenv
must never be relabelled as the installed release. `UV_LINK_MODE=copy` prevents
shared writable dependency inodes with the operator cache.

## Fresh loopback staging

Use the candidate's interpreter for preparation and launch. It has the locked
native dependencies; the development Mac does not run these checks.

```sh
/path/to/candidate/hermes/.venv/bin/python sparkie/deploy/stage.py prepare-home \
  --candidate /path/to/candidate --home /path/to/new-staging-home --port 32129
/path/to/candidate/hermes/.venv/bin/python sparkie/deploy/stage.py run \
  --candidate /path/to/candidate --home /path/to/new-staging-home
```

The launcher uses the native gateway, scrubs inherited provider and bot
credentials, keeps Telegram disabled and permits only the recorded loopback
binding. It copies the canonical `SOUL.md` into the native home and fingerprints
it with the candidate. It refuses enrolled credentials and reused state. It
does not prove a real owner browser callback, Telegram pairing or compute power.

For an intentional staging shutdown, use the native gateway CLI with the same
candidate interpreter, `HERMES_HOME` and module paths, or the native supervisor
planned-stop marker followed by SIGTERM for the exact process just launched.
Unmarked SIGTERM deliberately reports an unexpected stop in the pinned runtime.
The integration test follows the generated native unit's planned-stop path and
requires a clean exit and unchanged package hashes.

```sh
SPARKIE_TEST_CANDIDATE=/path/to/candidate \
  /path/to/qualified-test-python -m pytest sparkie/tests/test_deployment.py -q
```

The test Python needs pytest and the native dependencies. The package's live
dependency environment is built without development extras.

## Service definitions and collection

`service_unit.py` runs under the candidate interpreter/source and renders the
maintained native system unit. It preserves native planned stops, drain,
restart and child cleanup. It adds package paths, `NoNewPrivileges` and a
private file mask. It writes to stdout and never installs a unit.

`--kind collector-service` renders one fixed collector invocation with
`--inventory`, `--output`, `--plugs`, `--energy-database` and `--control-socket`.
`--kind collector-timer` renders a standard systemd timer: first pass 30 seconds
after boot, then 60 seconds after the preceding pass completes. The oneshot
cannot overlap itself. The current trusted gateway, broker and collector must
run under the same UID: the private socket is owner-only and checks that UID.
This is a process boundary, not separate-account isolation. Model execution
stays in compute containers without their files, keys or socket. No model call or agent schedule supplies
this cadence. The collector publishes observations and requests the same
checked maintenance path; missing physical power validation keeps those
actions unavailable.

The unit renderer requires the candidate, native home and actual service user.
Use the same trusted application user for the collector and broker. Qualification checks generated
unit syntax with `systemd-analyze verify` without enabling anything. Final
account permissions, directory ownership and gateway hardening still need
qualification with native workers and browser/Telegram paths.

## Cutover and recovery

The selected inference service is prepared separately by `model_unit.py`; see
[`brain-service-recovery.md`](../docs/brain-service-recovery.md). It renders the
fixed selected Docker recipe and bounded systemd lifecycle, and provides a
model-independent readiness check. It does not install a service or approve a
model switch. Keep the native gateway accessible while that service recovers.

`cutover.json` records the observed Spark 1 identity, old user service, existing
8443 URL and unaffected443 route. Before live approval, bind this plan to a
concrete immutable candidate, reviewed diff, full applicable checks, expected
interruption, protected state archive and saved routing/service rollback.
Archive old assistant state outside active retrieval; do not delete it.

Native Nous owner enrollment is private host state, outside package/evidence.
Use a separate staging OAuth client for actual browser verification. Never
copy account tokens or the Telegram token into a candidate. Only one process
may own the real Telegram poller during cutover or rollback.

No command in this directory grants installation approval. Every live candidate
needs the owner's exact approval and verification through the actual owner path.

## Concrete operator staging and cutover

`installation.py render` binds a candidate to protected private configuration
hashes, the exact Spark1 machine and retained old model, and five rendered
units. `stage` requires root-owned non-writable code/config ancestry, a fresh
protected Hermes home and fresh private controller/cache paths. It verifies
unit syntax before creating runtime files, and installs no running service.
All controller, gateway and collector processes use the same trusted account.
Root-owned0640 files are readable only by that account's primary group; the
runtime cannot rewrite owner authority, executable roots or the native managed
policy. Its ordinary native `config.yaml` stays runtime-owned0600 so theme,
font and other unpinned settings save normally through Hermes.

`managed_config.py` uses Hermes's supported `HERMES_MANAGED_DIR` overlay. It pins
the reviewed local-model, access, plugin, compute and cloud-disabled settings;
it does not freeze all upstream defaults or introduce a second settings store.
The native service's pre-start check rejects missing, changed or writable policy
before Hermes can fall back to unmanaged settings. `SOUL.md`, `.env`, scripts,
plugins and the empty shell-hook approval file remain protected. Native model
file/terminal tools operate in the checked compute workspace, not this home.
Changing protected policy or adding host hooks requires a reviewed update.

The preview preference import copies only listed appearance scalars, validated
native theme YAML and the native UI-preference document from a paused snapshot.
Other preview configuration, credentials, code, chats and memory are excluded.
The exact snapshot remains archived, and new state is retained for rollback.

`worker_stage.py` stages the immutable worker zipapp and protected fixed config
on each explicitly enrolled compute Spark, with private runtime state. It
checks the actual machine and local sandbox image before writing, does not
alter SSH/accounts/firewalls, and starts no listener or workload.

Optional reviewed model/app services use `service_enrollment.py` to render their
catalog and per-worker fixed configuration from the existing compute identities.
`service_worker_stage.py` stages those files and the same packaged worker under
protected content-addressed paths. The reviewed data directories and model
weights remain external to the candidate. See [recipe services](../docs/recipe-services.md).

An installation with `service_ingress` adds the pinned standard Caddy unit and
configuration to the exact installation hash. The proposed workload origin uses
10000; it does not replace the application on 8443 or the unrelated service on
443. Promotion verifies the private native authentication gate before publishing
the workload route. Same-journal rollback restores its previous observed route
independently, preserving unrelated changes. These prepared paths still require
candidate qualification and owner approval. See [service access](../docs/service-access.md).

After the owner approves the concrete candidate, `promote.py` requires its
exact plan hash and a fresh root-owned operation directory. Every effect is
recorded before dispatch. It stops the old watchdog timer, its actual triggered
oneshot and the API/Telegram poller; archives old assistant state privately;
retains the exact old model container for rollback; and starts native services.
It observes the owner sign-in/API gate before conditionally replacing the whole
8443 handler set through Tailscale's native versioned LocalAPI. Unrelated443
routes and Funnel settings are preserved. Interrupted promotion cannot be
repeated blindly; the same journal supplies rollback and diagnosis.

The concrete approval also retires the unused old editor connections:
Spark2's `spark-portal-spark4-tunnel.service` and Spark4's
`spark-portal-editor.service`, plus Spark3's `spark-portal-editor.service`.
Their files stay intact and prior enabled/running states are recorded for
rollback. These services can keep an otherwise idle compute Spark awake.
Spark3's earlier retired tunnel on Spark2 is separate and is not changed.

Rollback stops the new poller first, restores only8443, restores the old model's
actual previous running state, restores the old editor connections and the old
API/watchdog boot policy. It preserves new state/logs. The operation remains
labelled as awaiting actual owner browser/WebSocket/Telegram verification;
neither a successful shell command nor these isolated fixtures claims a live
owner path has passed.

The native UI preview is also a retained predecessor. The plan identifies its
exact container, image and settings home. While the model and controller start,
the preview remains available and the owner can still edit appearance. The final
swap stops the preview, archives its paused home, imports the latest validated
appearance, and starts the completed gateway on a different loopback port. The
page is briefly unavailable while the private gateway gate and route are checked.
If that final swap fails before switching the route, the preview is restored.
Rollback returns the preview to its prior running state and retains the new
gateway's state and preferences. The new home starts with fresh chats, memory
and reviewed access configuration.

Plans with the UI5 observation reader can set `preview_dashboard.energy_database`
to the existing database and use that same absolute path for
`settings.energy_database`. The gateway, controller and collector share this
database. It stays outside the directories created for the fresh installation.
Promotion verifies the preview's read-only mount, the runtime owner and its
private SQLite database, then records the fixed observation timer and service.
After warmup it stops and disables that timer and joins the old collector before
archiving a SQLite backup as the runtime user. The backup is retained in the
private operation journal. A rollback stops the new collector, restores the
old timer's previous boot and running settings and continues using the same
database with any samples taken after promotion. A captured in-progress oneshot
can finish through the timer's next normal run.

Plans with fresh metering state still archive the old console's electricity
file with its state and import validated monthly totals before the collector
starts. This retains monthly usage and coverage. Day and week views use their
own recorded samples. A failed history or preference import holds promotion
and leaves the journal and private archives for recovery.

## Owner-approved application updates after the first cutover

The reviewed first installation may enable `application_updates: true` in both its settings and its private controller configuration. This requires the reviewed Spark 1 controller at `/etc/sparkie/controller.json`, runtime UID/GID 1000, gateway on loopback 32131 and a candidate directly under `/opt/sparkie/releases`. When native notices are configured, their interpreter and source fields use `/opt/sparkie/current/hermes/.venv/bin/python` and `/opt/sparkie/current/hermes`.

On the initial administrator-approved stage, the installer creates the protected `/opt/sparkie/current` selector and copies the fixed steward to `/opt/sparkie/steward/upgrade.py`. The original native unit generator still provides the gateway lifecycle. The non-root gateway, controller and periodic collector load application code through the selector. The root-managed model and ingress keep their reviewed bindings. The protected native home keeps SOUL.md and the installed skills as regular files so Hermes can synchronize them to SSH workspaces. During activation and rollback, the steward pauses the gateway and atomically refreshes only the originally enrolled guidance files. Existing preferences, learned skills, conversations, memory, databases and credentials stay in the native home. Protected review journals live in `/var/lib/sparkie-updates` and prepared offers enter through the unprivileged `/var/lib/sparkie-update-inbox`.

First promotion enables a single systemd socket on `/run/sparkie-update.sock`. Each connection runs the fixed steward for that request. The socket can admit only the installed controller UID and its running systemd MainPID. Mutating requests must also match the current owner enrollment and the stored operation approval. First-cutover recovery serializes with any application update and disables the socket. The steward never executes a candidate program as administrator.

Build and qualify a compatible successor at its own final absolute path on a compute Spark. Prepare the submission with the existing baseline manifest, full new package and a JSON object containing `diff`, `checks`, `interruption` and `rollback`. Keep the durable check receipts with that review.

```sh
mkdir -p prepared-offers
python3 sparkie/deploy/upgrade.py prepare --candidate /opt/sparkie/releases/RELEASE \
  --baseline /opt/sparkie/releases/PREVIOUS --details reviewed-change.json --destination prepared-offers
```

The resulting digest names a directory containing `review.json` and `release.tar`. The proposal binds the exact archive, new manifest, predecessor manifest and review. The steward validates them and enforces its application-change scope. This path handles UI assets, existing protected prompts and skill content including the sandbox-only forum-reading helper. Changes to trusted Python modules, including the proposal handler, require a separate administrator plan. A different Hermes revision, base interpreter, dependency, model, worker-side execution, database schema, existing protected skill roster, privilege or sign-in policy requires a separate reviewed plan.

After the verified owner approves, the steward records one operation, independently validates and seals the release, switches the selector, and restarts the native gateway and fleet service. A failed health check restores the retained predecessor and checks its owner gate. A successful basic health check leaves the release waiting for the owner's actual changed-behavior check. The owner may keep it or restore the previous release through the same operation. A lost connection is reconciled by operation ID. An uncertain handover never triggers a second installation. [Steward implementation](upgrade.py) · [First-install integration](upgrade_installation.py)
