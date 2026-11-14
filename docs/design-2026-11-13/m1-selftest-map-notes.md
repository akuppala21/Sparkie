# Map notes for milestone 1: the hub guard (D1) and the self-test (D2)

For the coordinator to merge into `docs/architecture.md`. Only what branch `m1-selftest` built. Wording follows the map:
"Today:" marks a gap that is still there.

## R1 (replace the row's text)

**R1.** No new workload starts on the hub (the brain's Spark and the console's own), named or not. A named Spark is
checked by `notBrainsSpark` against both (`brainSparks()`). Placement that names no Spark picks only among
`computeSparks()` (every Spark on the list but the hub): `placeModel`'s single Spark and its pairs, and `pickVersion`'s
download target. The self-test picks from `computeSparks()` too, and each of its steps checks again. Today: the brain
switch can start any library model there as the brain. `keep_running` refuses the brain's Spark for every verb (R38).

- Where: 17-changes.mjs (`brainSparks`, `computeSparks`, `notBrainsSpark`, `placeModel`, `pickVersion`); 21-selftest.mjs
  (`selfTestPlace`); 24-handler.mjs and 21-apps.mjs as before.
- Check: test: change.test.mjs (as before); hub.test.mjs (the brain's setup on Spark 4: a model on disk and a download
  with no Spark named never land on Spark 2).

## R11 (add to the row)

`self_test` runs through `runAction` and starts one `self-test` job, which holds no claim itself; each of its steps is
an action run through `runAction` (start_model, stop_model, keep_running) with its own claim and job, as Spark Console
(via `page`, actor `Self-test`, a fixed owner viewer, `healOwner()`), the same way "Test the changes" runs its steps
(`stepRun`, 18-workflows.mjs, shared by both). Two direct `run` calls are in it: the healing drill's
`docker kill --signal KILL <id>` (under a claim on that Spark, released at once; the id is the 64-hex id of the
container the test itself started), and fixed reads (`docker inspect`, `docker logs --tail 20` of the job, parsed for
numbers only). Neither may be copied for anything that starts or deletes.

## R13 (add to the row)

`self-test` jobs take no claim (their steps do), like `workflow-run`. One self-test runs at a time.

## R19 (add to the row)

The self-test's healing drill (`healDrills`, 18-workflows.mjs): the one container it killed, by `<spark>/<id>`, counts
as a crash in the watcher (exit 137 is otherwise someone's stop; its `crashed` event carries `drill: true`), and
`maybeHeal` doesn't apply the 10-minute rule to it. Every other rule holds (the owner's switch, two restarts an hour,
offline in the last half hour, out of memory, the workflow's state). The heal's restart is restart_model's run, so it
validates that workflow when it waits for its first run. A drill that doesn't come back marks the container stopped on
purpose (`consoleStopped`), so no late restart brings it back after the test.

## R22 (add to `desired.json`'s writers' note)

`desiredAfter` skips a job marked `selfTest` (the self-test's own model start, marked in `launch` from `ctx.selfTest`):
that model never joins the list. Its heal restart and its stop go through the list as any restart and stop do.

## R25 (add to the row)

`self_test` has its own check in `sparkieCheck`: the owner's words asking for it ("run the self-test", "test the
Sparks", "test Spark 3": kind `selftest` in `CHANGE_WORDS`) are enough, since what it runs is fixed by code; a `spark`
stays only when the owner named it. From an agent (its own call, its key, or `ask_sparkie`) it is an owner-only question
inside the action, as a new image in `keep_running` is.

## R30 (add to the switches)

`SPARK_CONSOLE_SELFTEST_PORT` (the web page's port; needs `SPARK_CONSOLE_ALL_LOCAL=1`). `SPARK_CONSOLE_JOB_WAIT_MS`,
`SPARK_CONSOLE_SELFTEST_JOB_MS` and `SPARK_CONSOLE_SELFTEST_HEAL_MS` work without it.

## R38 (add to the row)

The self-test's web page and job are ordinary `keep_running` apps (spark.app=1; the job once, with the GPU), from
`config.json`'s `selfTestImage` (a key of its own, not under `images`, so it is never counted as a model engine's
image), with fixed commands and fixed names `spark-selftest-web-<hash>` and `spark-selftest-job-<hash>` (the hash of what
they run). They stay stopped and are started again by the next self-test. `waitJobEnd` (21-apps.mjs) waits for a job's
end: one fixed `docker inspect` every 10 s through `run`, with a time limit; it changes nothing.

## Section 6, "Where new things go": the new action's row (or a line in the Action row's examples)

| To add | Touch | Also update | Never |
|---|---|---|---|
| A check of the real hardware | a line of `self_test` (21-selftest.mjs): a step through `stepRun` with the self-test's ctx, a line built by `say` from code, and what it leaves stopped in "Left behind" | the stand-in in `test/mock/bin` (opt-in switches such as `jobs-run`, `stamp-starts`, `gpu-broken`); `test/selftest.test.mjs` | stop anything that was running; start anything on the hub; leave anything running; a line built from a log or a program's words |

## Section 4, "Who holds the truth" (a row, if the map lists config keys)

`config.json` `selfTestImage`: the one image the self-test runs (pinned by digest), replaced on every install like the
rest of `config.json`.

## Section 8, "Known traps" (one line)

- **The self-test's crash is a kill.** No engine crashes on demand from outside (a signal to a container's first process
  is ignored unless it handles it), so the drill kills its own container by id and marks that one exit as a crash. It
  proves the watcher, self-healing and restart_model on the real Spark, not how one engine dies.

## Tool counts

Change tools 15 → 16; a key that can act sees 43 (was 42). A look-only key still sees 27.
