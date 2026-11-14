# Fast gate plan for Spark Console

Nothing was run or edited. Savings are estimated wall seconds at 2 files at once on a quiet Mac. The relayed request says "all but 6"; that list is not visible to me, so nothing here is excluded on its account.

## 1. Where the time goes

- **Runs:** quiet, 1066 s of wall time for 2034 s of test time; loaded, 2442 s for 4750 s; the best run on record, 569 s (gate9).
- **Four files are 57%:** across 329 s, workflows 304 s, validate 271 s, change 259 s.
- **Fleet scans are about 54% quiet, 77% loaded:** a scan starts about 430 processes and costs 4.1 s quiet, 11 s loaded. A start makes four, a stop two.
- **Fixed waits are 690 to 940 s of quiet test time:** a 5 s sleep before each of 50 to 64 load checks, two 60 s stalls in across, 40 to 62 s timeouts in ask and state.
- **Fleet start-up is under 1%:** 0.3 s per file quiet, at most 3 s loaded.

## 2. The cuts, in order

Each cut ships with the test changes it needs, so every batch leaves the suite passing.

| # | Cut | Files | Saves | Risk |
|---|---|---|---|---|
| | **Batch 1: no workflow version changes** | | | |
| 1 | The across stall limit is a fixed 6 s, not 20 s x SLOW | `test/across.test.mjs:22` | 50 s | Low |
| 2 | `lock.mjs` runs the files itself, longest first | `test/lock.mjs:25` | 44 s | Low |
| 3 | Stand-in commands start fewer processes: docker without `mkdir` and `touch` on every call, `du` without python3 | `test/mock/bin/docker:13`, `test/mock/bin/du` | 45 s, not measured | Low |
| 4 | `wait_operation` and `waitJob` wake when the operation moves | `service/src/18-workflows.mjs:228`, `20-desired.mjs:113` | 20 s | Low |
| 5 | Stand-in-only settings for four fixed waits: first cable test, first watcher look, scan cache, `ask_sparkie` wait | `06-links.mjs:97`, `19-watcher.mjs:178`, `16-actions.mjs:391`, `20-mcp.mjs:101` | 25 s | Low; set per file |
| 6 | Stand-in downloads in 0.2 s steps, held by a file; no watcher in cli, fuzz, internet, passkey | `test/mock/bin/hf:6,20` | 25 s | Medium: two download tests need the hold |
| | **Batch 2: one build; start, start-across, stop, restart get new versions** | | | |
| 7 | One scan per step: `deploy` and `clusterDeploy` scan once and hand it to the plan; `stopContainer` takes its caller's scan | `07-jobs.mjs:123-130,185`, `08-cluster.mjs:325-333`, `17-changes.mjs:529`, `24-handler.mjs:464` | 170 s (470 s loaded) | Medium: a stop trusts a scan a few seconds old |
| 8 | Load poll setting: 1 s on the stand-in fleet, 5 s on the Sparks; stand-in models load in 1 s; a download's progress wait ends with the download | `07-jobs.mjs:158`, `08-cluster.mjs:426`, `17-changes.mjs:599`, `11-setups.mjs:380`, `test/mock/bin/curl:13,21` | 95 s | Medium: three tests need holds |
| | **Batch 3: Mac only; skip it if Spark 2 becomes the gate** | | | |
| 9 | The scan script starts fewer processes | `05-library.mjs:6-55` | 70 s, not measured | Medium: it runs on the real Sparks |

| After | Mac, quiet | Spark 2 (estimate) |
|---|---|---|
| Today | 20 min | cannot pass; 5 min at 4 files once it can |
| Batch 1 | 17 min | 3 min at 8 files |
| Batch 2 | 12 min | 2 min |
| Batch 3 | 11 min | no change |

My check of the five biggest:

- **Cut 7 holds.** `deploy` scans in `plan`, then again at line 130 only to look the model up; `plan` and `clusterPlan` already accept a scan, so that half adds no staleness.
- **Cut 8 holds.** The sleeps are in `deploy`, `clusterParts` and `restartJob`, all fingerprinted.
- **Cut 1 is safe.** The stop needs both parts to log no loading line (`08-cluster.mjs:452-455`); the stand-in's default log has one.
- **Cut 3** grew: the stand-in `du` starts python3 about 22 times per scan.

Batch 2 costs one validation round on the real Sparks: the one tap, plus one start across Spark 3 and 4.

## 3. Flaky tests

- **Agent-door calls that plan first** (workflows, validate, change, pause, heal): the door gives up after a fixed 50 s (`20-mcp.mjs:213`) that SLOW cannot stretch. Cut 7 removes most; also follow the operation through `recent_operations`, as `across.test.mjs:31` does.
- **`sparkie.test.mjs:362-378`, `ask.test.mjs:171-187`:** timed answers must overlap. Hold the stand-in answer on a file, wait for `replying` in `/health`, assert, release.
- **`state.test.mjs:143`:** 300 ms after SIGTERM. Add `stopping` to `/health` and wait for it.
- **`state.test.mjs:227`:** sleeps until 22 s after start. Turn that fleet's first cable test off.
- **`state.test.mjs:81-88`:** fails once a second state copy begins (gate26). Give that fleet a one-day copy interval.
- **`change.test.mjs:426-437`, `sparkie.test.mjs:229-235`:** need the start still loading. Write `serve-down` first; remove it after the assertions.
- **`change.test.mjs:562-570`, `617-635`:** need the download still running. Hold it and wait for the step "Downloading".
- **`heal.test.mjs:128`:** use the 60 s wait. **`:186`:** write the start time just before the crash.
- **`pause.test.mjs:49`, `internet.test.mjs:147`, the 400 ms clock sleeps:** wait for halted, for the stream to answer 200, and for `clock.mjs` to confirm its offset.
- **`sparkie.test.mjs:87`:** two tool results race (gate19). Script them as two rounds.
- **Battery and sleep** (gate22, 56 failures): run `lock.mjs` under `caffeinate -i`; warn on battery.

## 4. A quick check for development

A new `test/quick.mjs` that never writes the lock: build, door, passkey, internet, cli, api, agent-setup, fuzz and sparkie. That is 516 of 659 tests in about 1.5 minutes on a quiet Mac. Optionally add the heavy files for the part being edited (`17-changes`: change, desired; `08-cluster`: across, heal-more; `18-workflows`: workflows, validate). It can pass where the gate fails, so only `node test/lock.mjs` writes the lock.

## 5. Running the gate on Spark 2

1. **Stand-in memory.** Linux has `/proc/meminfo`, so `05-library.mjs:52` and `:335` would give every stand-in Spark the real memory. With ALL_LOCAL, read only `~/.mock/meminfo`, also at `13-main-model.mjs:105`.
2. **Real home.** `18-workflows.mjs:361` reads the real releases folder; `start-mock.mjs:145` should set HOME to the fleet folder.
3. **Ports.** `freePorts` releases a port before the service binds it, and cable checks listen on random 40000 to 59999 (`08-cluster.mjs:76`). Give each fleet a reserved block.
4. **Offline stand-in.** Its `sleep 1` (`02-ssh.mjs:7`) becomes the floor of every scan; use 0.1 s.
5. **The holds from section 3,** or tests that lean on a slow start race.
6. **The whole tree.** The installer copies seven service files (`deploy/host-on-portal.sh:22`); the gate needs `test/`, `tools/` and `service/src`. Then 8 files at once, SLOW=1, under `nice`.

## 6. What not to do

- Share one fleet between files: start-up is under 1%.
- Run more than 2 files at once on the Mac (gate8 took 5479 s).
- Raise SPARK_TEST_SLOW to cure flakiness: it lengthens real waits.
- Scale every service sleep, or cache scans only on the stand-in fleet: tests would stop running the code the Sparks run.
- Let the quick check write the lock, or mark a slow test todo.

### Critical Files for Implementation
- /Users/akuppala/Documents/26aiRAG/spark-console/test/lock.mjs
- /Users/akuppala/Documents/26aiRAG/spark-console/service/src/07-jobs.mjs
- /Users/akuppala/Documents/26aiRAG/spark-console/service/src/08-cluster.mjs
- /Users/akuppala/Documents/26aiRAG/spark-console/test/start-mock.mjs
- /Users/akuppala/Documents/26aiRAG/spark-console/test/mock/bin/docker
