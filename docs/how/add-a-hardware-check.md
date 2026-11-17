# Add a check of the real hardware

A line of the self-test (`self_test`): one more thing it proves on a compute Spark, leaving the fleet as it was.

## Touch

- A line of `self_test` in `21-selftest.mjs` (`selfTest`): a step through `stepRun` with the self-test's ctx
  (`selfTestCtx`), a line built by `say` from code, and what it leaves stopped in "Left behind".
- What the step starts goes into `self-test.json` as it starts (`keep`), so `selfTestRecover` stops it after a restart.

## Also update

- The stand-in in `test/mock/bin`, with an opt-in switch a test turns on (as `jobs-run`, `stamp-starts`, `gpu-broken`).
- `test/selftest.test.mjs`: the new line, in its place, with its seconds.
- A new job type: `OP_WORDS` (`14-chats.mjs`), `TELL_OPS` (`20-tell.mjs`), the page's `SVC_LABEL`; `postResult` and
  `wait_operation` already carry a job's `report` lines.

## Never

- Stop anything that was running.
- Start anything on the hub (R1).
- Leave anything running.
- Build a line from a log or a program's words: numbers only.

## Rules

- R1: its model, app and job on a compute Spark only, checked again by each step. The Walls line alone reaches every
  Spark, the hub too: the root helper's `prove` (`selfTestWalls`, `21-work.mjs`, R42).
- R11: every step through `runAction`; outside it are only the drill's kill and the fixed reads (direct `run` calls)
  and the Walls line's `helperCall`.
- R13: the self-test job takes no claim; its steps do.
- R19: the drill asks healing's own rules before it kills.
- R22: the self-test's own model never joins the list of what should be running.

## Tests

- `selftest.test.mjs`, `selftest-cleanup.test.mjs`.

## Copy from

- The Job line: `keep_running` once with the GPU, waited on with `waitJobEnd` (`21-apps.mjs`), its numbers read from
  its log.
