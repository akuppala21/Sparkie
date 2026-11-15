# Find out why a model start failed

A start that did not end with the model answering its test prompt. Look first, change nothing until the cause is
named.

## Touch

Look in this order, each a read through Sparkie, `POST /console/api/actions/<name>` or the agent door:
1. `recent_operations`: the failed start, its error, its operation id.
2. `operation_log` with that id: the operation's own lines (each fix it tried, what it stopped and put back). After a
   restart it says expired: `recall` with the id finds the operation's record, and `recall` with that record's id
   gives its log.
3. `container_logs` for the container on that Spark (it may be gone if the start was put back).
4. `fleet_events`: crashes, out of memory, a Spark going dark during the start.
5. `spark_diagnostics` when the Spark itself looks wrong; `service_logs` (`console`) for the console's own errors.
6. On Spark 2, `lessons.json` in the state folder (R48): whether this setup failed the same known way before, and
   how often (`proven` from the second time).

Then the code: `startModel`, `startWithFixes`, `START_FAILURES`, `knownStartFailure`, `causeLines` and `putBack`
(`17-changes.mjs`); `deploy` (`07-jobs.mjs`); across two Sparks, `clusterDeploy` and `asideBack` (`08-cluster.mjs`).

## Also update

- A cause seen before that has a fix: a new entry in `START_FAILURES` (`docs/how/add-a-known-failure.md`).
- A cause in the console's code: a test that fails without the fix, in the test file closest to it.

## Never

- Start it again by hand to see what happens: a start stops things to make room.
- Edit `verified.json`, `found-setups.json` or the lock by hand.
- Say a cause is found before a log line or a test shows it.

## Rules

- R15: done means it answers a test prompt. R16: a failure puts back exactly what the start stopped; fixes retry 3
  times at most. R2: 8 GB stays free. R14: the job plans again and aborts on an unapproved stop.

## Tests

- `workflows.test.mjs` (“done means it answers, and known problems are fixed”), `across.test.mjs`,
  `change.test.mjs` (“a start over a running copy of the same model”).

## Copy from

- `workflows.test.mjs` (“a model that loads but can't answer a test prompt fails”): a failure reproduced on the
  stand-in fleet.
