# Selected brain service and recovery

`deploy/model_unit.py` prepares a service for the exact selected Huihui target,
calibrated DFlash2 draft, SGLang image digest and launch arguments recorded in
`models/main-model.json`. It does not install or start that service. The sealed
candidate includes this renderer; render from its final versioned path before
presenting a concrete live update.

The systemd unit owns one attached Docker process. Its health wait checks the
container's candidate label, image digest, loopback health endpoint and served
model alias. It allows three starts in thirty minutes and waits fifteen seconds
before a restart after failure. A health timeout or stopped/wrong container fails
startup. There is no hosted fallback, second inference instance or model-driven
recovery loop.

The recipe keeps the tested 100 GiB container limit, leaving the rest of Spark 1
for the OS, Hermes and management. The selected recipe uses host IPC/network,
but the model server binds only 127.0.0.1:32202. This is trusted inference
infrastructure, not the model's coding sandbox. The weights mount is read-only;
the compilation cache is a separate writable directory. Heavy code execution
continues on compute Sparks through native Hermes tools.

Before rendering, provision the reviewed target/draft root and its existing
`verified.json`, plus the compilation cache. Preflight checks recorded repository
revisions, target/draft configuration files, cached engine image, free loopback
port and unused container name. It does not rehash tens of gigabytes at every
restart. The installation review must verify the weight provenance and protect
these paths from model-run code. A stopped or unexpected container is not deleted
automatically: inspect its identity and reason for stopping first.

```sh
python3 /candidate/extension/deploy/model_unit.py render \
  --record /candidate/extension/models/main-model.json \
  --weights /reviewed/model-root --cache /reviewed/model-cache
```

For the installed service, model-independent inspection is `systemctl status
sparkie-main-brain.service`, `journalctl -u sparkie-main-brain.service` and the renderer's
`wait-ready` command. The dashboard, native owner controls and recorded operation
status must remain accessible while inference is down. Keep the gateway lifecycle
separate: it must not stop merely because the brain is unavailable.

For a failed ordinary model process, systemd retries the same reviewed recipe
within the stated limit. After that limit, report the failure and inspect the
service, container logs, available memory and weights/image presence. Do not
download replacements, change model pins or cut Spark 1 power to make it start.
An authorized operator may restart the unchanged service after fixing the known
cause; model or application changes still require a concrete candidate approval.

For a failed approved model/configuration switch, retain the prior service
definition, sealed candidate, weight roots and cache. Stop only the attempted
brain, restore the saved prior service definition, reload systemd and start the
previous brain. Verify its alias, readiness and an actual Hermes answer. A single
running model means this interval is visible downtime. This document does not
claim that an actual alternative-model switch or live rollback has been run.

Docker calls are pinned to the local Unix socket. The unit launches with a clean
environment and a private empty runtime configuration; inspection and stop use
fresh private empty Docker configurations and discard ambient Docker settings.
Stop checks the candidate image and manifest label, then targets the exact
inspected container ID. An absent container is harmless; a different occupant of
the reserved name is refused rather than stopped.

Compute qualification distinguishes the real Docker crash/restart/readiness
check from systemd syntax validation. It does not install a service on Spark 1 or
prove boot behavior there. The concrete live approval must include those remaining
host-specific checks and the measured restart interval.

The November 19 compute run observed initial readiness in 216.83 seconds,
correctly rejected the deliberately killed test container as unavailable, and
observed the unchanged model ready again in 171.68 seconds. Final native
edit/test/diff acceptance completed in 31.64 seconds inside a disposable compute
sandbox. These are bounded qualification cases, not guarantees for arbitrary
changes or proof of a live Spark 1 install. Raw evidence is under
`docs/review-astra/evidence/hermes-brain-recovery-2026-11-19/` at repository root.

## Operator-applied checkpoint change

A release with both sealed model records preserves one loopback provider,
model alias and 65,536-token context across the handover. Native Hermes keeps
its existing home, user settings, sessions and operation records. The model's
repository and revision appear in the operation result. Changing the native
conversation picker still controls that conversation's inference route.

Prepare a root-owned JSON review file under protected ancestry. The plan binds
the installed release's `candidate.json` SHA-256, a unique operation ID beginning
with `brain-`, the installed runtime GID, and the exact previous/replacement
recipes. Each recipe has `record`, `weights` and `cache` fields. The allowed
sealed records are `main-model.json` and `alternate-model.json`. For the
alternative, put the two verified GGUF files in the exact reviewed weights
directory. The same installed release must contain both recipes and the
operator script. Use absolute directories and retain both sets of weights and
caches until recovery is complete.

```json
{
  "schema": 1,
  "operation_id": "brain-reviewed-change",
  "candidate_sha256": "EXACT_INSTALLED_MANIFEST_HASH",
  "group": 1000,
  "previous": {
    "record": "main-model.json",
    "weights": "/reviewed/huihui/weights",
    "cache": "/reviewed/huihui/cache"
  },
  "replacement": {
    "record": "alternate-model.json",
    "weights": "/reviewed/dealignai/weights",
    "cache": "/reviewed/dealignai/cache"
  }
}
```

Show the owner the two exact records, the plan hash, the documented service
interruption and rollback. Obtain their exact confirmation through Telegram or
the web. The administrator executes from the immutable installed release. The
plan hash binds the operator action to the reviewed bytes. It does not obtain
owner approval or expose a privileged action to the chat model.

Run `brain_switch.py switch --plan PATH --approved-plan-sha256 HASH` with the
release's Python on Spark 1. The operation checks the exact installed unit and
running container, preflights both recipes, saves the journal under
`/var/lib/sparkie/cutover-operations`, stops the old brain, and replaces only
`sparkie-main-brain.service`. The gateway stays available. The command confirms
the replacement by container identity, loopback server readiness and an actual
local inference response. Verify an owner tool request and context after the
switch. A 65,536-token configuration requires proof of the actual effective
context on both engines during qualification.

If the command is interrupted, use `reconcile` with the same approved plan.
Repeated delivery of `switch` only reports the recorded status. A pending
systemd job must settle before reconciliation can report an outcome. Use
`rollback` with the same plan to restore the previous recipe after a failed
owner check. If reconciling reports an unverified restoration start or unit
drift, inspect the unit and journal jointly before sending another systemd
command. Preserve both model records, caches and Hermes state.
