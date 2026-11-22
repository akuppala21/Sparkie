# Minimal power adapter design

Preparation design, November 19, 2026. No power, root, SSH or controller change is authorized by
this document. It implements the active contract's already approved product direction; exact
installation and policy scope still belong in the concrete owner-reviewed candidate.

## Reuse maintained mechanisms

- Keep the existing maintained Matter controller and its pairing store as infrastructure.
  Its container name or old data-directory name does not make Hermes depend on the old app.
  Pin its actual image and preserve the enrolled fabric and Spark 1's device-enforced View ACL.
  Do not re-pair plugs or grant the hub switch rights during migration.
- Use the controller's native `read_attribute` and `device_command` On/Off interfaces. The model
  never receives arbitrary Matter commands, node numbers, commissioning APIs or controller access.
- Use systemd's normal clean poweroff and existing, separately verified narrow sudo permissions.
  The former installer's two-command sudoers file is operating-system configuration, not an app
  dependency. Its existence, exact commands and applicability must be checked on each compute Spark.
- Use Hermes for scheduled owner tasks and completion delivery. A deterministic, model-free idle
  check can run from an ordinary systemd timer in the same private boundary. No new scheduler,
  agent loop, daemon per feature or recreation of the old desired-work framework is needed.

## Small extension surface

Add `power.py` behind the existing private broker, with typed `wake` and `sleep` operations and
observations. Extend the existing operation record only with the few durable stages/evidence needed
to distinguish shutdown sent, shutdown observed, plug command sent and result observed. Every
potential effect is recorded before dispatch. Timeout/restart reconciliation reads current state;
it never blindly repeats an unknown shutdown or switches the plug again.

Keep the first sleep behavior conservative: any running workload, protected service, active resource
claim, unknown workload inventory or active owner session blocks shutdown. It does not implicitly
stop or park models. Explicitly requested workload stops use their existing exact operations first.
This avoids introducing a second workload scheduler just to save standby electricity.

Protect Spark 1 at every boundary: typed operation target, trusted machine identity and plug identity.
Use the verified machine ID and saved SSH host key as well as the display hostname. Keep the hub
plug device-enforced read-only. Never rely only on the label `spark2` in a mutable mapping.

## Wake and sleep behavior

**Wake:** if the exact machine is already reachable and ready, return that observation. If the
verified plug is freshly observed off, send On once, verify On, and wait for the expected machine
identity and workload runtime. Do not call it ready because the plug switched. If the plug is on
but the machine cannot be reached, report that uncertainty; do not infer that cycling power is safe.
An off/on cycle for a cleanly shut-down machine with AC still present needs the saved shutdown
evidence and current verified standby observations before its Off step.

**Sleep:** acquire the Spark's operation claim, recheck activity and protected work, confirm the
plug's physical identity and ability to wake the machine, and record the exact approved scope.
Request normal clean systemd shutdown, without force. The old `nvidia-persistenced` workaround
must be checked against the current kernel/driver before retaining it; its old comment is not
current evidence. A lost SSH connection is an uncertain acknowledgement, not proof of shutdown.

Hard plug-off requires fresh device measurements consistent with a qualified transition from
running power to that Spark's measured standby state, plus the expected machine no longer
answering. Check again immediately before switching. Cached controller attributes and an SSH
timeout alone never permit Off. Unknown readings, ambiguous identity, missing shutdown evidence
or renewed activity leave the plug on and report the incomplete result. The old fixed 15 W
threshold must not be transplanted without physical qualification on these machines.

Long boot/shutdown checks must not hold Telegram's event loop. Use the native plugin's supervised
async task support for progress/completion delivery, with the existing broker operation as the
durable fact. A 65-second RPC deadline is currently shorter than some real boot/shutdown sequences;
do not treat that deadline as action failure or resend. Inspect the operation until its observed
outcome settles, and reconnect pending owner-visible operations after restart.

## Idle policy and prerequisites

Persist the owner-approved idle timeout, enabled Sparks and protected workload/service choices.
The timer evaluates those facts without inference. Only a full idle interval with fresh observations
qualifies; unknown state resets or holds eligibility. Check claims, running containers, native task
activity, interactive sessions and systemd inhibitors. Low GPU usage alone is never idleness.
Where workload execution can use native systemd inhibition, reuse it. A scheduled check has no
authority beyond the explicit owner-approved policy; do not fabricate an `Owner` event for a timer.

The contract requires exact confirmation for root actions while also requiring automatic idle
shutdown. The concrete candidate must state whether the owner's policy confirmation covers only
the enumerated clean-shutdown commands on named compute Sparks. If this scope is not already
approved, retain per-action confirmation until the owner decides it; a cron entry cannot grant root.

Before enabling each machine, verify these real prerequisites:

1. Existing restricted Spark 1-to-compute transport and pinned host identity; no copied private key
   or new access exception merely to make a test pass.
2. Correct physically verified plug, stable UniqueID fingerprint and switch endpoint; hub View ACL
   remains effective. Fresh native reads work and unsupported attributes remain unknown.
3. Firmware AC-return behavior actually boots that Spark; a failed power-on has a manual recovery.
4. Exact existing shutdown privilege, known current shutdown behavior, measured standby draw and
   preserved workload files. Root/network changes, if needed, receive their required approval.
5. One writer owns the power policy. Disable the old app's power writer at the approved cutover so
   old and new systems cannot race while preserving the maintained controller itself.

Unit checks use fake time/devices for expiry, stale readings, hub protection, identity changes,
busy work, uncertain replies and restart stages. Native adapter smoke checks keep web and Telegram
on the same path. Initial release qualification needs a real safe sleep/wake cycle per distinct
hardware/firmware configuration; repeat physical cycles only when that behavior or its dependencies
change. Electricity layout edits do not repeat those cycles.

The old application's `runAction`, recovery net, desired-work records, power timers, approval
objects and workflow locks cannot be called from this product without creating an old-app
dependency. Use them only to maintain the old live app during transition, and retain their proven
failure scenarios as requirements for the new thin adapter.

## Implemented preparation core

`src/sparkie_sparks/power.py` now provides `FleetPower`, `PowerMatter` and `PowerTransport`;
`power_worker.py` is the standalone fixed-command compute worker. They are not installed or
enabled by importing the package. `FleetPower.actions_for(spark)` exposes availability from
trusted configuration. Every included compute node requires its verified `machine_id`, and
the constructor independently requires Spark 1's `hub_machine_id`.

The adapter checks the existing operation's exact intent, recorded owner approval and Spark
claim before dispatch; it does not accept a new approval boolean from a caller. Wake uses
fresh device readings and exactly one native Matter On request, verifies the physical Spark
and Docker, and reconciles a lost reply without sending again. The default adapter never
cycles an on-but-unreachable machine. The optional qualified sequence below can complete
an exact recorded shutdown using fresh standby evidence.

Sleep is absent from `actions_for` unless the composition supplies all three prerequisites:
`activity(node)` returning an empty list only for known idle work, a qualified recovery path
named in `recovery_ready`, and `shutdown_observer(operation, node)` returning a fresh exact
operation/machine proof with `state: clean_shutdown`. Missing or conflicting evidence blocks
success. The worker independently rechecks physical identity, Docker and configured activity,
verifies both existing narrow sudo permissions before any effect, stops `nvidia-persistenced`,
then requests normal systemd poweroff. Its response is
acceptance/uncertainty, never a claim that shutdown completed.

For this initial core, successful sleep means **verified clean OS shutdown with AC left on**.
`result()` says so explicitly and reports `plug_off_sent: false`. Hard cut and automatic idle
policy remain unavailable in that unqualified configuration. A configured recovery path is required before sleep is advertised,
because plug On alone cannot start a shut-down machine whose AC already remains on.

The power-core receipt (private record)
records 69 passing stand-in checks on Spark 4. No hardware action, privilege setup or live
application update was part of that preparation.

## Qualified continuation implementation

`power_sequence.py` supplies the optional staged shutdown/Off/On path in the same
operation database. It binds to full protected thresholds, physical identities
and activity policy; changes invalidate continuation. Standby uses distinct fresh
device timestamps. Missing readings, resumed TCP reachability, high watts or
sampling gaps discard the interval. Off dwell also resets after a missing or
discontinuous observation. Every sent stage is durable and never automatically
repeated after an uncertain acknowledgement.

`composition.py` checks current owner generation before initial dispatch and wires
the same check into the power adapter before each later effect. Private idle and
requested-work receipts retain their existing policy verifier and held claim.
The existing controller can poll stages for a bounded 210-second scheduling budget;
no extra scheduler is introduced. See `power-configuration.md` for configuration.

The v7 preparation passed 167 focused and native integration checks on Spark 4 in
13.28 seconds with injected physical effects. It does not qualify actual hardware,
automatic shutdown policy or installation. The broker example stays wake-only.
