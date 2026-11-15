# Land a step on main

One small change at a time onto `main`: its affected tests on a compute Spark, then a fast-forward. The whole suite
runs after, in the background, and an install still needs it on that exact build (R29).

## Touch

- Nothing in the service. Work on a branch in its own work folder (`git worktree add ../spark-console-<name> -b
  <name> main`), commit, merge or rebase `main` into it, then from any work folder: `node tools/land.mjs <name>`.
- `SPARK_TEST_OUT=<folder>` chooses whose queue (`spark-test-runs` or `spark-test-runs-4` beside the work folders),
  for the tests and for the whole run after.
- To see a pick first: `node tools/affected.mjs pick` (the files on stdout, why on stderr), then
  `bash tools/test-on-spark.sh --ask <files>`.
- `node tools/land.mjs --status`: the last landings and whole runs of `main`; it records whole runs that have ended.

## Also update

- Nothing by hand. The map (`test/affected-map.json`, or `<name>.affected-map.json` beside a runner's lock) is
  recorded by a whole run with `SPARK_TEST_MAP=1`, which the runner's watcher asks for (restart a watcher started
  before this card to turn it on). Until a map is there, every pick of a code change is the whole suite.
- A test file every step must run joins `SHORT_CHECK`, and a path that must always run everything joins `ALWAYS`, in
  `tools/affected.mjs` (`SHORT_CHECK`, `ALWAYS`), with a case in `affected.test.mjs`.

## Never

- Merge into `main` by hand, push, or install from `land.mjs`: it does none of these.
- Install a build whose whole suite hasn't passed: the installer refuses a build without its lock.
- Edit a test or the map to get a step through.
- Batch steps to save runs: a pick costs minutes, and a missed file shows up in the whole run after.

## Rules

- R29: a step lands on its affected tests and the short check; an install needs the whole suite on that build.
- R22: the lock and the map have one writer each.

## Tests

- `affected.test.mjs`, `land.test.mjs`.

## Copy from

- `tools/test-on-spark.sh`: how a request is asked, queued and answered.
