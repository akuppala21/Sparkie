# Spark Console tests

The real service (`service/server.mjs`) and the `spark` CLI (`tools/spark.mjs`), run against a stand-in fleet on this
machine. **They never touch a real Spark:** every Spark is a folder, `ssh` and `scp` are stubs that refuse, and nothing
is installed or changed outside a temporary folder.

## Run

From `spark-console/`:

```bash
SPARK_TEST_STRICT=1 node --test --test-concurrency=4 'test/*.test.mjs'
```

- Node 20 or newer (tested on 26), Python 3, bash, tar. No `npm install`: only `node:test` and `fetch`.
- Quote the glob: `node --test test/` fails on recent Node (a folder isn't a pattern), and a bare `node --test`
  also loads the helpers and stand-ins in `test/` (they do nothing then).
- It binds to `127.0.0.1` on free ports; a sandbox that blocks local listening has to allow it.
- Each file starts its own service, so files run side by side (`--test-concurrency=4`); how long the whole suite takes
  on each machine is under "Where the full run happens". On a slow machine, use `SPARK_TEST_SLOW=3`, not one-off bigger
  limits: it multiplies every test's limit, every `waitFor`, the request timeouts and the operation waits (`SLOW` in
  `lib.mjs`; 1 by default). The owner's work laptop is one: its security software checks every process the stand-in
  fleet starts, so one look at the fleet takes about 20 s, and `SPARK_TEST_SLOW=3 node test/lock.mjs` is what passes
  there. `SPARK_TEST_CONCURRENCY=n` changes how many files `lock.mjs` runs at once.
- A test that times out keeps running in the background, and its `finally` can undo a stand-in setting the next test
  just made: after one timeout and odd failures in the same file, fix the timeout first. The long poles wait on
  purpose: `state.test.mjs` freezes a stand-in Spark until commands time out (20–45 s each), `ask.test.mjs` waits out
  a 45 s answer, `change.test.mjs` follows real deploys on the stand-ins (the service checks a new model 5 s after
  starting it), `pause.test.mjs` runs a dozen operations, `heal.test.mjs` / `fleet.test.mjs` wait for the watcher
  (its first look is 15 s in).
- Smoke (the agent door, the CLI, passkeys, Sparkie's chats and the fuzzer; about a minute, the chats the longest):

  ```bash
  SPARK_TEST_STRICT=1 node --test --test-concurrency=5 test/door.test.mjs test/cli.test.mjs test/passkey.test.mjs test/sparkie.test.mjs test/fuzz.test.mjs
  ```

- One file: `node --test test/door.test.mjs`.
- Mark a product bug found later with `bug('file:line what')` from `lib.mjs` (it shows as `todo`, so the suite stays
  a regression signal; with other options, `{ ...bug('…'), timeout }`); `SPARK_TEST_STRICT=1` makes them failures.
- `node test/lock.mjs` runs the whole suite strictly and, if it all passes, marks this build's workflows as tested
  (`service/workflows.lock.json`). The installer won't install a build without it.
  `SPARK_TEST_SEED=n` changes the fuzz strings; `SPARK_TEST_FINDINGS=file.json` saves every fuzz finding.
- To poke at the service by hand: `node test/start-mock.mjs` prints its address (signed in as `owner@test`); Ctrl-C
  stops it; `--keep` keeps its folder.

## Where the full run happens

- **A compute Spark** (the fast way, before an install): `tools/test-on-spark.sh akuppala@<spark>` copies this folder
  there and runs `node test/lock.mjs` in a container with no network: about 13 minutes on Spark 3. The lock comes
  back to `../spark-test-runs/`. Never on Spark 2.
- **GitHub, on every push to `main` and every pull request** (`.github/workflows/full-run.yml`): one job runs the build
  check and `node test/lock.mjs` two files at a time (`SPARK_TEST_SLOW=2`; the runner has 2 cores) and can only read.
  On `main` a second job, which runs none of this folder's code, checks the lock names that commit, tree, run and build,
  and pushes it on top of the tested commit as the tag `tested/<first 12 hex of the tree>`. The lock is no longer kept
  on `main`. Its minutes are not measured yet: the end of the suite's log lists the seconds each file took. If the job
  is over 30 minutes, split it into jobs side by side.
- **A step onto `main`**: `node tools/land.mjs <branch>` runs only the files its change needs (R29). Recording the
  map (`SPARK_TEST_MAP=1`) on `workflows.test.mjs` here: 452 and 425 s without, 434 and 436 s with.
- **This Mac, by hand, one file at a time**: `SPARK_TEST_STRICT=1 SPARK_TEST_SLOW=3 node --test test/<file>.test.mjs`.
  Its security software makes the whole suite take about 2.8 hours, so don't run all of it here.

What the lock (`service/workflows.lock.json`) holds: R29, `docs/rules/R29.md`; `test/lock.test.mjs` checks it.

## What it covers

`test/covers.md` has a row for each test file, made by `node tools/make.mjs` from the comment at the top of that
file (`// Covers: …`). A new test file needs only that comment; `node tools/make.mjs --check` fails without it.

Hugging Face is never reached: `start-mock.mjs` points `SPARK_CONSOLE_HF_FIXTURE` at `mock/hf-fixture.json`, a few
made-up repos that searches and look-ups answer from (only with `SPARK_CONSOLE_ALL_LOCAL=1`; any other repo is not found).

## How it's put together

The harness (`startMock`, `useFleet`, `request`), the stand-in fleet, every stand-in command and model, and the
`.mock/` files a test sets to change what they do: `test/stand-in-fleet.md`.
