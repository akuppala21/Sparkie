# Land a step on main

One small change at a time onto `main`: its affected tests on a compute Spark, then a fast-forward. The whole suite of
`main` runs after every landing, in the background, and an install still needs it on that exact build (R29).

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
- To see a pick first: `node tools/affected.mjs pick --landing` (the files on stdout, why on stderr).
- To see what the step rewords that is the owner's (a contract requirement or acceptance test, a Rule paragraph, a
  glossary meaning): `node tools/check-docs.mjs --meaning main`, by id with the old and new words (`--json` for a
  button); it exits 1 when there is any.

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

- `affected.test.mjs`, `land.test.mjs`.

## Copy from

- `tools/test-on-spark.sh`: how a request is asked, queued and answered.
