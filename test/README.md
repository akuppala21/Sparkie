# Spark Console tests

The real service (`service/server.mjs`) and the `spark` CLI (`tools/spark.mjs`), run against a stand-in fleet on this
machine. **They never touch a real Spark:** every Spark is a folder, `ssh` and `scp` are stubs that refuse, and nothing
is installed or changed outside a temporary folder.

## Run

From `spark-console/`:

```bash
SPARK_TEST_STRICT=1 node --test --test-concurrency=4 'test/*.test.mjs'
```

- Node 22 or newer (run on 26; the service needs Node's built-in WebSocket client, as the installer checks), Python 3,
  bash, tar, git, curl. No `npm install`: only `node:test` and `fetch`.
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
  just made: after one timeout and odd failures in the same file, fix the timeout first. Some files wait on
  purpose: `state.test.mjs` freezes a stand-in Spark until commands time out (20–45 s each), `ask.test.mjs` waits out
  a 45 s answer, `change.test.mjs` follows real deploys on the stand-ins (the service checks a new model 5 s after
  starting it), `pause.test.mjs` runs a dozen operations, `heal.test.mjs` / `fleet.test.mjs` wait for the watcher
  (its first look is 15 s in). The longest files today are others (`root-helper`, `power`, `apps` and `pull`: 8 to 11
  minutes each on a Spark); the end of the suite's log lists every file's seconds.
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
  there and runs `node test/lock.mjs` in a container with no network: about 46 minutes on a compute Spark (2026-11-15: 2,353 tests, the map
  recorded). The lock comes
  back to `../spark-test-runs/`, naming the tree that was copied (`SPARK_TEST_TREE`), so `pull.sh` on Spark 2 can find
  its commit on `main` (R58). Never on Spark 2.
- **GitHub, on every push to `main` and every pull request** (`.github/workflows/full-run.yml`): one job runs the build
  check and `node test/lock.mjs` two files at a time (`SPARK_TEST_SLOW=2`; the runner has 2 cores) and can only read.
  On `main` a second job, which runs none of this folder's code, checks the lock names that commit, tree, run and build
  and holds only the keys `lockFor` writes, and pushes it on top of the tested commit as the tag
  `tested/<first 12 hex of the tree>`. From the commit that gave the lock `evalSet` (2026-11-14) until the job's list of
  keys was fixed (2026-11-15) the job refused every lock, so no tree between those two has a tag; a `main` that holds the
  fix is marked again when its full run passes. `lock.test.mjs` (“the mark job takes the lock lockFor writes on GitHub”)
  now holds the job's keys to `lockFor`'s. The lock is no longer kept on `main`. Its minutes are not measured yet: the
  end of the suite's log lists the seconds each file took. If the job is over 30 minutes, split it into jobs side by
  side.
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

## The root helper's tests

`root-helper.test.mjs`, and every file that rehearses the helper (`rehearsal.mjs`), need Linux with GNU tools and
bash 5: on macOS about 200 of its tests fail, so run them on a Spark. **No test proves a wall:** each shows the helper
asked the stand-in `systemd-run` for it, and the stand-in builds none; the proof's verdicts are lines the stand-in
prints. The exceptions: the lock-out net's put-back (`restore.sh`, `guard.py`) runs for real on the rehearsal's files,
and the last group runs the proof's own attempts with no wall, to show each one a plain account can try gets through.
What only a real Spark proves, with the lines to run there (R63's Today points here):

- that systemd and the kernel grant each wall: the proof the one-time command runs (each attempt blocked), and the checks
  inside a plain change: `ls -A /dev/pts` prints nothing, and these fail: `echo > /dev/udp/224.0.0.251/5353`,
  `test -w /sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/cgroup.procs` (R63);
- attempts 15 to 18, 20 and 22 (they need root, sudo or a network); a Spark's proof says "not controlled" for 15 to 18,
  27 and 28, which nothing outside the walls can show working;
- the owner of a file put back, and the home's owner (the tests are not root), and every line the helper runs only as
  root;
- that a stopped change ends on a real systemd (the stand-in `systemctl` only marks a stop unless told otherwise);
- the lock-out net's put-back on a real systemd (R60): a change that disables ssh, then a restart inside its window,
  brings ssh back running (A-15: the start it queues runs after the restart unit, and its look, `sw-guard-look-<id>`,
  90 s on finds ssh running, or starts it, before the result is written; `systemctl list-timers` shows the look, gone
  once it ran); a change whose unit will not end is
  still put back and its guard stays open (P-1); and the real answers of a failed reload, `ufw` and a console start
  each leave the guard open (A-14), while a reload of a unit that is not there (`sshd.service`) does not;
- what a pinned script (`--script`) holds (P-5, R63): a change runs `bash` on a script that sleeps; an append to it from
  outside meanwhile is not run (the bytes it started from are the hashed copy). Then the same with a rename over the
  path from outside (`mv new.sh s.sh`) and a second `bash s.sh` in the change: record what the Spark shows (the kernel
  lifts the bind, since Linux 3.18, so the second run reads the new file; the stand-in does that too). And a pinned
  `./x.sh` (the owner may run it) runs: the copy is root's, mode 0550, in `/var/lib/spark-console/pins`, not `noexec`;
- after a restart inside the net's window, the restart unit ends within seconds (its look is armed with `--no-block`),
  and `systemctl list-timers` lists `sw-guard-look-<id>` until it has looked, gone after.

## How it's put together

The harness (`startMock`, `useFleet`, `request`), the stand-in fleet, the stand-in commands and models, and the main
`.mock/` files a test sets to change what they do: `test/stand-in-fleet.md`. The others are in each stand-in's own
comments.
