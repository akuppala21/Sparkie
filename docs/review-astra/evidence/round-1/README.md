# Round 1 reproduction evidence

These files support the current-source app findings in the round 1 review. They were collected against commit
`03866c09cf3edc0529ae8316c9356f44edb87dfd`. They support the 12 app findings, with supplemental checks for explicit
memory refusal, `/stop` after a truncated response, and platform-qualified backup behavior. Finding IDs and severity
belong to the review report, not this evidence bundle.

The thirteen archived result files are byte-for-byte copies of the original runs. The twelve scripts have the
portability, output-routing, and source-parity checks listed in [manifest.json](manifest.json). The manifest records SHA-256 hashes
of each original script before those edits, every packaged file, and the source files used by these checks. The
original worker harness was named `worker-delete-race-repro.py`; its packaged default now targets this repository's
`service/worker.py`, and only its **current-source** result is included.

[Sanitized build provenance](live-build-verification.json) records the saved service/UI identifiers, SHA-256
fingerprints, and exact frontend-byte equality after normalizing only the injected `BUILD` value. It was prepared
from existing snapshots without another network request. It does not establish complete deployed-file equality
or test live workflows. [The generated-server check](build-check.txt) records a successful read-only
`node tools/build-server.mjs --check` against the reviewed commit. [The review baseline](review-baseline.json)
records 338 tracked-file hashes and the clean tracked diff; it is a source inventory, not a claim that every file
was exhaustively reviewed. These provenance files are separate from the original reproduction artifacts listed
in the manifest.

## Full-suite and targeted verification

The completed macOS run of all 47 test files reported **996 tests: 995 passed, 1 failed**, with no canceled,
skipped or todo tests, in **39 minutes 52 seconds**. It used `SPARK_TEST_STRICT=1 SPARK_TEST_SLOW=3`
and `node --test --test-concurrency=4 test/*.test.mjs` against the reviewed commit. The runner sorted the same
47-file list explicitly. [Full log](full-suite.log) and [run status](full-suite-status.json) are unchanged copies
of the original completed run. [Verification hashes](test-verification-manifest.json) cover these artifacts
and the targeted results separately from the reproduction manifest.

The reporter surfaced `ENOTEMPTY` from `test/start-mock.mjs:188` during `withService` cleanup for the
“a new build: one record…” case at `test/updates.test.mjs:62`. Because cleanup runs in `finally`, it could mask an earlier error; the log
does not establish that all that case's assertions passed. The exact writer or cleanup interleaving is not
established. The unchanged update-record file passed **6/6** in a separate isolated strict run with slow factor 3
in **19.8 seconds**: [log](updates-targeted.log), [status](updates-targeted.status.json),
[source-based analysis](updates-targeted.analysis.json). The full run remains failed and the cleanup issue open.

In the first targeted attempt, five service-dependent cases failed during setup before their assertions
because the sandbox rejected localhost binding (`EPERM`); the source-only case passed (1/6 overall). Its
[log](updates-targeted.sandbox.log) and [status](updates-targeted.sandbox.status.json) are retained as an
environment failure, not a product failure reproduction. The targeted runner and driver logs preserve the
execution provenance; they include original machine paths. An earlier serial full-suite attempt was deliberately
interrupted in favor of the completed concurrent run and is not presented as a pass or failure.

For a new targeted run, run `SPARK_TEST_STRICT=1 SPARK_TEST_SLOW=3 node --test test/updates.test.mjs` from the
repository root and send output to a new temporary file. The archived targeted runner writes beside itself;
do not rerun it in this evidence directory because it would replace the original logs/status.

This bundle does not contain the older portal findings, raw responses from the live console, bootstrap data,
screenshots, or live credentials. The token-shaped string in the chat script is a deliberately fake fixture; the
archived result replaces it with `[FAKE TEST TOKEN]`. Agent IDs and chat IDs in the revocation output belong to the
temporary stand-in service. Source paths and timestamps in archived output are preserved as provenance.

## What each check establishes

| Script | Archived output | Scope and limitation |
| --- | --- | --- |
| `current-stopped-gpu-claim-check.mjs` | `current-stopped-gpu-claim-evidence.json` | Real app action and claim functions in a VM, with inventory/memory/commands stubbed. Inserts another model start between the check and claim; no real GPU or model is started. |
| `current-first-job-end-check.mjs` | `current-first-job-end-evidence.json` | Real watcher functions with captured inventory output. Shows the first short job after an empty inventory being marked told without its completion callback; no external commands. |
| `current-worker-delete-race-repro.py` | `current-worker-delete-race-evidence.json` | Imports the real worker, redirects its workspace to a temporary directory, and inserts a same-inode edit between the revision and unlink checks. All subprocess creation is forbidden. |
| `current-agent-revocation-repro.mjs` | `current-agent-revocation-results.txt` | Real service and HTTP agent door, stand-in model and fleet. An already-running turn starts a future model-stop action after the agent is removed; the stopped container is a fixture. |
| `current-body-unicode-repro.mjs` | `current-body-unicode-results.txt` | Extracts the exact `readBody` function and emits two Buffer chunks splitting a UTF-8 character. No server or network. |
| `current-body-unicode-http-repro.mjs` | `current-body-unicode-http-results.txt` | Real local HTTP request and service, followed by the real file worker under the stand-in Spark's temporary HOME. Confirms that the corrupted text is saved with a successful response. |
| `current-chat-repros.mjs` | `current-chat-repros.json`, `current-chat-repros.log` | Real local service with controlled model replies: memory deletion without approval, a chat stuck after a truncated non-200 response, and a fake secret persisted in an error. The two output files contain the same original JSON. |
| `current-memory-negation-gate-repro.mjs` | `current-memory-negation-gate-results.json` | Supplemental A-3 check using the exact intent parser, action gate, and memory action in a VM with in-memory persistence. “Do not remember that Spark 4 is on Wi-Fi only” is recognized as negated `remember`, yet the gate clears the proposed write and the action stores the fact. No real model, HTTP service, or Spark is used. |
| `current-truncated-stop-repro.mjs` | `current-truncated-stop-results.json` | Supplemental real local HTTP check: `/stop` answers successfully but does not free the chat after the truncated-response failure; the next turn still receives 409. |
| `current-frontend-race-repros.cjs` | `current-frontend-race-repros.log` | Real frontend code in headless Chrome, with `capi` stubbed and browser requests aborted. Demonstrates stale files across Spark changes, a multi-file upload switching destinations, and a late pair plan replacing a single-Spark plan. No backend or live upload/deploy is called. |
| `current-backup-source-failure-repro.mjs` | `current-backup-source-failure-results.json` | Exact `sendCopy` snapshot with stderr/status instrumentation, local bash standing in for the receiver, and a temporary fake HOME. Actual BSD tar permission failure returns 1 while a valid incomplete archive replaces an existing good archive and the copy is accepted. This is a macOS observation, not a Linux result. |
| `current-backup-fatal-source-repro.mjs` | `current-backup-fatal-source-results.json` | Same isolated source/receiver setup, with a wrapper mapping the real BSD tar failure to fatal exit 2 to model GNU semantics. The copy returns false, but the good archive has already been replaced. The exit-status mapping is simulated; no actual GNU tar run is claimed. |

Most checks intentionally assert the **observed bug**. For those, exit status 0 means that the described failure reproduced;
an assertion failure after a fix needs interpretation and is not itself a new product failure. These are review
reproductions, not replacement regression tests or proof that the full suite passes. Dates, temporary paths, ports,
and generated fixture IDs may differ on a new run.

The backup scripts print observations without asserting their outcomes; inspect the JSON fields. A parity guard
compares their copied `sendCopy` function with the selected checkout before any temporary files or processes are
created, allowing only the documented instrumentation differences. If the function changes, the guard stops the
script instead of silently reproducing old code. The direct call deliberately uses an existing same-day archive;
ordinary scheduling skips a successful day, so overwriting that archive requires a retry after the success record
was lost, failed to persist, or was restored from an older state. On a new day, the premature promotion can instead
leave an incomplete final-name archive. The run did not exercise scheduling, restoration, or retention pruning.

## Run

Use Node 20 or newer (the repository was tested on Node 26), Python 3, bash, and tar. The HTTP checks need permission
to bind local ports and start the repository's stand-in processes. See [the test harness documentation](../../../../test/README.md).
No package installation is needed except a separately available Playwright module for the browser script.

From the repository root, enter this directory:

```sh
cd docs/review-astra/evidence/round-1
```

Every script infers the repository root from its own location, so the current shell directory is otherwise
irrelevant. Set `SPARK_REVIEW_ROOT=/absolute/path/to/checkout` to review a different checkout. The two VM scripts
also retain their optional positional repository argument; the worker retains `--portal-root /path/to/service`.
The worker's `--scope` option changes only the label in its output.
The VM scripts retain their original `sourceCommit` label; their computed source hashes identify the actual files
read. When overriding the checkout, record its real commit separately and compare those hashes.

The small deterministic checks do not start a server or browser:

```sh
node current-stopped-gpu-claim-check.mjs
node current-first-job-end-check.mjs
node current-body-unicode-repro.mjs
node current-memory-negation-gate-repro.mjs
PYTHONDONTWRITEBYTECODE=1 python3 current-worker-delete-race-repro.py
```

The backup checks run local `tar`, `gzip`, and bash against temporary fixtures; they need a non-root user so mode
`000` causes a read failure. Original results were collected with BSD tar on macOS. No SSH or actual remote HOME is
used. A GNU tar run may produce different exit codes and archive entries; the fatal variant explicitly models the
failure status, as described above.

```sh
node current-backup-source-failure-repro.mjs
node current-backup-fatal-source-repro.mjs
```

Run individual local HTTP checks as needed. Each creates and removes its own temporary fleet and service state:

```sh
node current-agent-revocation-repro.mjs
node current-body-unicode-http-repro.mjs
node current-chat-repros.mjs
node current-truncated-stop-repro.mjs
```

The revocation check deliberately waits for a delayed model reply. Host security scanning can make these checks
slower; a harness startup timeout is different from reproducing the reported behavior. The service checks use
`test/start-mock.mjs`, with separate temporary HOME/state, loopback HTTP ports, and stand-ins for SSH, Tailscale, and
Docker. Their cleanup stops only the process group created for that temporary fleet. They do not install a build,
change the repository's app files, access the owner's files, or operate the real Sparks.

The frontend check requires Google Chrome (`channel: 'chrome'`) and Playwright. It resolves Playwright from
`PLAYWRIGHT_MODULE` when set, then normal Node module resolution, then the existing Codex runtime installation at
`~/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`. The fallback is optional
and is not downloaded or installed by this script. For another installation:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/node_modules/playwright node current-frontend-race-repros.cjs
```

All repros print their results to stdout; they never write over the archived results. To capture a rerun, select a
new temporary destination, for example:

```sh
review_run_dir=$(mktemp -d)
node current-chat-repros.mjs > "$review_run_dir/current-chat-repros.json"
```

## Verify the package without running the HTTP or browser checks

Check JavaScript syntax and Python syntax without writing bytecode:

```sh
for script in *.mjs *.cjs; do node --check "$script" || exit; done
python3 - <<'PY'
from pathlib import Path
p = Path('current-worker-delete-race-repro.py')
compile(p.read_text(), str(p), 'exec')
print('Python syntax OK')
PY
```

Verify hashes for the packaged scripts and the unchanged original outputs:

```sh
python3 - <<'PY'
import hashlib, json
from pathlib import Path
manifest = json.loads(Path('manifest.json').read_text())
for item in manifest['files']:
    digest = hashlib.sha256(Path(item['packaged_filename']).read_bytes()).hexdigest()
    assert digest == item['packaged_sha256'], item['packaged_filename']
    if item['kind'] == 'archived_result':
        assert digest == item['original_sha256'], item['packaged_filename']
print('All packaged hashes match; archived results are unchanged.')
PY
```

The packaging smoke check records syntax, path/module resolution, hash integrity, and reruns of the five
small deterministic checks and the two isolated backup variants in `packaging-verification.json`. The HTTP and browser outputs above remain the
original observed runs. The completed full-suite and targeted results are linked above; the review is in
[`../../findings-1.md`](../../findings-1.md).
