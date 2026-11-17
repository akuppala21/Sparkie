# Land a step on main

Land one small change at a time on `main`, with its affected checks. The complete suite must still pass on the
exact installed build (R29).

Until the owner says compute Sparks are available, run development checks with GitHub's **Focused checks** manual
workflow and name the affected `test/*.test.mjs` files. A focused pass never qualifies an install. Use **Full run**
for the final complete check; it runs three strict shards and the browser check, and only a complete passing run on
`main` creates the tested tag. Final release qualification stays on GitHub after compute Sparks return. No nightly
schedule is enabled. If a full run needs another attempt, rerun all jobs so every receipt belongs to that attempt.
The Spark-based `land.mjs` commands below still require a compute Spark; do not call them while none is available.

## Touch

- Nothing in the service. Work on a branch in its own work folder (`git worktree add ../spark-console-<name> -b
  <name> main`) and commit. Then, from any work folder:
  - `node tools/land.mjs --catch-up <name>`: merges `main` in, makes the generated files again (never merged by
    hand), commits; it stops only on a conflict in a file written by hand (resolve, `git add`, run it again).
  - `node tools/land.mjs <name>`: the landing pick on a Spark, then `main` moves. `--whole` runs the whole suite
    first instead, for a step that must be read whole.
  - `node tools/land.mjs --status`: the last landings and whole runs of `main`; it records whole runs that ended.
- `SPARK_TEST_OUT=<folder>` chooses whose queue runs the step's tests (the `spark-test-runs*` folders beside the work
  folders); `SPARK_LAND_TIP_OUT` the queue for the whole run after (the main queue when not set).
- UI-only edits use page, API and access checks even before a service coverage map exists. New functions and functions with no measured coverage still require a whole run.
- To see a pick first: `node tools/affected.mjs pick --landing` (the files on stdout, why on stderr).
- To see what the step rewords that is the owner's (a contract requirement or acceptance test, a Rule paragraph, a
  glossary meaning): `node tools/check-docs.mjs --meaning main`, by id with the old and new words (`--json` for a
  button); it exits 1 when there is any.

[Update recovery](../update-recovery.md).

## Also update

- Nothing by hand. The map (`test/affected-map.json`, or `<name>.affected-map.json` beside a runner's lock) is
  recorded by a whole run with `SPARK_TEST_MAP=1`, which the runner's watcher asks for (restart a watcher started
  before this card to turn it on). Until a map is there, every pick of a code change is the whole suite.
- A test file every step must run joins `SHORT_CHECK`; a path that must always run everything joins `ALWAYS` (the
  plain pick) or `LANDING_ALWAYS` (a landing), in `tools/affected.mjs`, with a case in `affected.test.mjs`.

## Never

- Merge into `main` by hand, push, or install from `land.mjs`: it does none of these.
- Install a build whose whole suite hasn't passed: the installer refuses a build without its lock.
- Edit a test or the map to get a step through.
- Batch steps to save runs: a pick costs minutes, and a missed file shows up in the whole run after.
- Land a change under `tools/` on a few files run by hand: `tools/` is on both always-lists, so its pick is the whole
  suite. What the tools may do is held by `selfchange.test.mjs` (what `make.mjs` loads in the box), `trial`, `box`,
  `box-fill`, `pull`, `docs`, `build`, `affected` and `land`.

## Rules

- R29: a step lands on its affected tests and the short check; an install needs the whole suite on that build.
- R22: the lock and the map have one writer each.

## Tests

- `affected.test.mjs`, `land.test.mjs`, `update-guard.test.mjs`.

## Copy from

- `tools/test-on-spark.sh`: how a request is asked, queued and answered.
