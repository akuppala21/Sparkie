# Compute wake and idle handling

This is a controller integration, not a scheduler or another agent loop. The
existing collector/controller cadence calls `IdlePower.scan()` once, then a
bounded `advance_power()` loop supplies fresh samples for pending stages. It has
a 210-second scheduling budget and five-second polling interval; individual fixed
remote reads share the existing maintenance request's 225-second I/O deadline,
inside its 240-second caller timeout. It adds no timer, thread or service and makes
no model calls. Spark 1 is excluded by both logical and physical identity.

## Requested work

`WorkspaceLeases(..., ensure_awake=callback)` records and holds the allocation
and Spark claim before asking for wake. The callback receives the exact durable
allocation while it is still `reserved` or `stopped`; only literal `True` lets
container provisioning begin. A timeout preserves that same allocation and
claim. Retrying the native task repeats preflight, without claiming a container
create was sent or allocating another machine.

`IdlePower.wake(allocation)` creates a private power-policy receipt for that
allocation's operation ID. The controller can wait for its observed result
within a bounded request budget. After an uncertain send, subsequent calls
observe the same operation; they do not send another On command. Physical
identity, Docker readiness and fresh verified Matter readings establish wake
success. The default adapter sends one typed On to an off plug and never cycles
an already-on but unreachable machine. An explicitly qualified profile adds a
fresh off dwell before On and can finish a prior recorded shutdown cycle.
Silence without that exact prior shutdown record never permits a cut.

The policy uses a separate lock namespace because the initial workspace
operation ID equals its allocation ID. Reusing the allocation lock inside wake
would deadlock preflight. The combined regression preserves that observed
failure and checks the fixed path.

The trusted controller configures `FleetPower.policy_authorizer`. This verifier
accepts only its persisted operation and the exact held Spark claim. It does
not create an `Owner`, reuse an owner confirmation, or accept model text as
authority. Existing web and Telegram operations keep their exact owner checks.

## Released workspaces

Native connection cleanup supplies `leases.release(scope, lease)` after upstream
cleanup. This writes only the exact release hint: it performs no SSH, stops no
process and releases no resources. It is not evidence that detached work stopped.
`leases.released()` exposes private candidates to the controller; it calls
`leases.retire(scope, task_id, release_id, activity=..., stop=...)` with the
worker's `idle_activity` and `retire` callbacks.

Retirement holds the same allocation lock used by acquire, records its receipt,
and claims the Spark before stopping anything. A stale release hint cannot stop
a reconnected workspace. The fixed worker verifies exact container, image,
limits, volumes, endpoint, physical host and current receipt. Its process probe
allows only the pinned workspace's PID 1 sleep and one idle SSH listener.
Active SSH sessions, detached processes, Python kernels and unavailable or
ambiguous observations keep the workspace alive. Terminated zombie processes
do not represent active work. A second process observation precedes stop.

The stopped container, project volumes, port and SSH keys remain for resume.
CPU/RAM are released only after observing that exact container stopped; disk
remains reserved. A lost stop acknowledgement retains the claim and is only
observed on later scans. A proved pre-dispatch refusal may get a newly recorded
attempt linked by `retry_of`, after fresh empty activity; uncertain sends are
never retried that way. No deletion is part of retirement.

## Whole-machine idle policy

Configure a fixed protected policy revision, an idle interval and maximum gap
between observations. The timer resets after active work, unknown state, a long
observation gap, a backward clock or policy revision change. Held workspace
resources and any other Spark claim block shutdown. Running containers always
block it, including infrastructure. Fresh host activity must separately include
owner sessions, detached host work and shutdown inhibitors; an empty Docker list
alone is insufficient.

Sleep stays unavailable by default. `power_sequence.py` implements an opt-in
profile bound to a measured machine, plug and configuration: normal shutdown,
sustained fresh standby readings and independently observed TCP absence, then
one Off. Wake waits for a verified off interval before one On and confirms the
exact machine and Docker. Each effect is recorded before sending. Unknown sent
effects are observed, never repeated. Cancellation or owner-generation revocation
prevents further stages, including revocation during an activity or meter read.

`power_worker.py` reads native login sessions, inhibitors, GPU processes and
non-system user processes. Unknown sources, other owner/admin sessions, detached
jobs, GPU work and protected services block shutdown. Only exact reviewed user
services and the verified native user-systemd/D-Bus baseline are ignored. Root
login sessions and GPU jobs block; arbitrary root CPU services require explicit
`protected_units`. The inventory does not detect every root-owned task. Docker
and activity are rechecked before the existing sudo commands. Both permissions
are verified before stopping `nvidia-persistenced`, then requesting normal
poweroff. Either effect's uncertain result stays uncertain.

An SSH disconnect or successful `systemctl` call is not completed shutdown proof.
The profile must be physically qualified before inclusion in a live candidate.
The example has neither a qualification profile nor automatic shutdown enabled.
Preserve independent recovery. New privilege or network setup belongs in the
concrete approved cutover. See `power-configuration.md` for protected settings.

## Private cross-Spark endpoint

The fixed sandbox worker can publish SSH on loopback or one explicitly enrolled
Tailscale IPv4 address in `100.64.0.0/10`. It checks that address is assigned to
its local `tailscale0` before provision and observation, and uses that exact
address for bind, inspection and readiness. Public, LAN and wildcard bindings
are refused. This does not change host SSH or network settings.

The optional trusted `authorize(allocation, dispatch=False, retirement=None)`
callback supports the existing authenticated SSH controller transport without
copying the controller's allocation database onto compute hosts. It must return
literal `True`. Physical/image/address verification always remains local.
Default local execution keeps the original database and claim checks.
`export_credentials(allocation)` exports only the exact verified sandbox key
and host-key row to that private transport. Those values never belong in model
results, logs or evidence packages.

## Evidence and integration gates

Spark 4 passed 160 focused checks and native registration smoke in 13.31 seconds.
The native-release and fresh wake-readiness follow-up passed 113 affected checks
in 9.82 seconds. The actual disposable native SSH fixture passed detached-job protection,
retirement and exact resume in 15.942 seconds. It performed zero host power
actions and removed its labelled container and volumes. The first integrated
wake test exposed the nested-lock defect; that failed receipt remains alongside
the repair. Source snapshots and reports are in
`docs/review-astra/evidence/hermes-power-idle-2026-11-19/`.

The subsequent physical-policy preparation passed 167 focused cases and native
registration smoke on Spark 4 in 13.28 seconds. These used stand-in physical
effects. A subsequent real Spark 2-to-4 test passed normal shutdown, sustained
standby, one Off, admitted-work wake with one On, and native tools in 301.526 seconds
(including operator review waiting). The exact machine and prior boot's orderly
shutdown journal were verified, and labelled fixture data was removed.
The v6 fixture/optional-interface failures remain with the corrected v7 receipt.
Before enabling automatic shutdown, prove the real paths, preserve active owner
work, coordinate a single power writer and retain independent recovery. The final
deadline/cadence repair passed 182 affected checks on Spark 2 in 14.19 seconds;
60- and 180-second holds now complete within one maintenance invocation. The
hardware sequence/worker did not change, so that physical receipt was reused.
This qualifies only the recorded Spark 4 setup, not other machines or a live update.
