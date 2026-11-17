# Find out why a model or app stopped, or did not come back

Something that should be running is not: it crashed, a start or a stop moved it, its Spark went dark, or healing
passed it over.

## Touch

Look in this order:
1. `should_be_running`: is it on the owner's list, and how is it now (running, changing, parked with its Spark off, or held with a reason)?
2. `fleet_events`: stopped, crashed (exit code, out of memory), removed, a Spark offline or back, healing and
   `heal-skipped` lines with their reason.
3. `recent_operations` and `operation_log`: an operation that stopped it on purpose (a start making room, an undo, a
   cancel).
4. `container_logs` for its last lines; `spark_diagnostics` if the Spark went dark (its dark periods).
5. `sparkie_setup`: whether agents are paused or self-healing is off (the owner's switches).

A failed model start may still owe an earlier container its name or its running state. `openProblems` shows that
obligation even when the desired list is empty. Read its source operation and the strict `start-rollback` entry in
`saved-runs.json`; `docs/t45-return-recovery.md` explains each hold. A Spark that stays silent may need a power
cycle. Never clear the note to make the warning disappear. If the job folder is a link, restore the real folder
before asking to run that job again. An explicit owner rerun or adoption can settle only its fully fenced positive
recovery debt; other pending work stays held.

Then the code: `healReason`, `bringBack` and `healPass` (`20-heal.mjs`) for why healing skipped it; `maybeHeal` and
`healTries` (`18-workflows.mjs`) for crash restarts; `rollbackReturn`, `rollbackFence`, `rollbackSupersede` and `rollbackRetireSuperseded` (`17-rollback.mjs`) for unfinished failed-start compensation; `desiredNow`, `seedDesired` and `watchHeld` (`20-desired.mjs`; the
power-off job also seeds a missing list before its first stop); `watchSpark` (`19-watcher.mjs`) for what the watcher saw; for apps, `healApp` (`21-apps.mjs`).

## Also update

- A power-off before the first watcher round: keep the fresh look’s seed before stops and the saved parked-state
  guard before shutdown; cover missing state and failed saves in `power.test.mjs`.
- A wrong skip or a wrong bring-back: a test in the closest heal test file that fails without the fix.

## Never

- Bring it back by hand before knowing why it stopped: the cause may still be there (a Spark that froze, out of
  memory).
- Raise a healing bound to make it come back.
- Edit `desired.json`, `heal-tries.json` or `saved-runs.json` by hand. A saved put-back grants narrow authority over exact containers; discarding its uncertainty is unsafe.

## Rules

- R19: healing is bounded. R21: Docker is the truth; a look Docker didn't answer is not a look. R8: protected
  containers and the brain's are never stopped by a plan. R23: events keep their meaning.

## Tests

- `t45-created-receipt.test.mjs`, `t45-job-folder.test.mjs`, `t45-adopt-job.test.mjs`.
- `t45-return.test.mjs`, `t45-target.test.mjs`, `t45-fleet.test.mjs`.
- `heal.test.mjs`, `heal-more.test.mjs`, `heal-displaced.test.mjs`, `heal-newer.test.mjs`, `heal-power.test.mjs`,
  `desired.test.mjs`, `dark.test.mjs`, `docker-down.test.mjs`, `apps.test.mjs`.

## Copy from

- `heal-more.test.mjs` (“a Spark that goes down again within 30 minutes”): a skip with its reason, on the stand-in
  fleet.
