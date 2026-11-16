# The agent bar

Real tasks the owner uses Claude Code for, done by an agent engine driving the brain, alone, from one request
(`docs/contract.md` 10.4). It's how the engine trial picks between opencode and Qwen Code (3.8), and later how
Sparkie's progress toward "no Claude or Codex needed" is measured.

## Run it

On a Spark with Docker (Spark 3 or 4, not Spark 2: the trial's containers are workloads), with the brain in its agent
setup (Models → Sparkie → "Qwen 3.8 27B · Agent"). A Spark needs only Docker: `run-on-spark.sh` builds the trial image
and runs the runner in it.

```bash
bash agentbar/run-on-spark.sh
```

With Node.js 24 on the machine, `node agentbar/run.mjs` does the same directly. Either way it runs both engines on
every task, 3 times each, taking turns so the brain's load is the same for both. For the hours-long full run, leave it
going after logging out: `nohup bash agentbar/run-on-spark.sh > agentbar/trial.log 2>&1 &`. Options:
- `--engines opencode` or `--engines qwen` for one engine;
- `--tasks diagnose-crash,fix-model-list` for some tasks;
- `--runs 1` for a quick try;
- `--brain …/v1` and `--model …` for the brain's address (the default is the one model address through Spark
  Console, `https://akspark2.tailab9aa9.ts.net:8443/console/api/v1`, model `sparkie`);
- `--keep` keeps each run's workspace;
- `--no-build` uses the trial image as it is;
- `--dry` checks the kit without Docker or the brain: every run is prepared (its engine configured, its exact command
  in `command.json`) and the untouched workspace is graded, which must fail.

The whole thing takes several hours. Results land in `agentbar/results/<time>/`:
- `summary.md`: per task, how many runs passed, the median minutes, and the winner;
- `results.jsonl`: one line per run, with every check;
- `runs/<engine>-<task>-<n>/`: the prompt, the engine's transcript, and its error output.

## How a run works

1. A fresh copy of this repository (without `agentbar/`, so the checks stay hidden) gets the task planted in it by
   `tasks/<task>/seed.mjs`.
2. The engine runs in a container from `Dockerfile`, with that copy at `/work`. The container has no Docker socket,
   no SSH keys and no home folder, so it can't touch the Sparks. It does have the network, to reach the brain. It
   gets the task's minutes, then it's stopped.
3. The checks (`grade.mjs`, `grade-lib.mjs`, `tasks/<task>/grade.mjs` and `hidden/`) are copied in only then, and run
   against what the engine left. A run passes when every check passes.

## The tasks

| Task | What the engine is asked | How it's checked |
|---|---|---|
| `fix-model-list` | `/v1/models` lists no model on the Sparks: find the bug in Spark Console, fix it, add a test. (The bug: `d.status` for `d.state`.) | `server.mjs` matches its parts; a hidden test lists the models and calls one; a new or changed test covers it. |
| `add-disk-tool` | Add a read-only `disk_free` tool for agents, with tests. | `server.mjs` matches its parts; a hidden test calls it through the agent door; the door's own tests still pass (they compare the tool list exactly); a test covers it. |
| `diagnose-crash` | A model crashed: find why from the saved log and fix its setup, as little as possible. (vLLM ran out of KV cache at 131,072 tokens, with ComfyUI holding 38 GB.) | Only the context changed, to between 32,768 and 47,104; REPORT.md names the KV cache and ComfyUI. |
| `brain-chat-app` | Build a small chat page wired to the brain, with no npm packages, and leave it running. | The page loads; `POST /api/chat` returns the brain's reply. |

To add a task, make `tasks/<id>/` with `task.json` (`id`, `title`, `minutes`), `prompt.md` (written the way the owner
talks; `{{BRAIN_URL}}`, `{{BRAIN_MODEL}}` and `{{APP_PORT}}` are filled in), `seed.mjs` (plants it in the workspace
given as its argument), and `grade.mjs` (returns a list of `{ name, pass, detail }`). Check the grader first: it must
fail on the untouched task and pass on a correct solution.

## The engines

`engines.mjs` says how each engine is installed (pinned versions, in `Dockerfile`), pointed at the brain, told to
work without asking, and asked for a machine-readable transcript. Telemetry and auto-update are off for both.

## The coding trial (R67)

Whether the brain in use can change Spark Console's own code: until a trial passes for this brain and build, Sparkie
can't propose a change to its own code (`trialPassed()`, contract 10.4, T100). Each task is a one-line slip planted in a
fresh copy of the repository, with a failing test that shows it (`trial/tasks/<task>/`). The brain works alone with the
loop and the two tools Sparkie will have in its box, `run` and `write_file` with `on: "box"`. The box isn't built yet
(A4), so `trial.mjs` has its own loop and two stand-in tools of the same shapes. Each run's box is a container with no
network; only the runner talks to the brain. It starts only with 16 GB free beyond the 8 GB kept for the system, ends
by itself after its task's time and the grade's, and goes when the runner is stopped. Code grades each run: no
protected path touched, no line of an existing test changed and none added that skips, exits or returns early, the
generated files are the build's, the task's test (byte for byte as planted) passes, and the short check passes. The bar
is every task passing at least 2 of 3 runs.

Run it on a compute Spark with Docker, from a copy of this repository at the build Spark Console runs, with Sparkie's
model up:

```bash
bash agentbar/trial-on-spark.sh
```

It prints one line a run, then the verdict:

```
Building the trial's runner image …
Marking what this build’s brain reads (one stand-in console of this copy) …
Coding trial: Qwen/Qwen3.8-27B (aphex) at https://akspark2.tailab9aa9.ts.net:8443/console/api/v1, model qwen-aphex. Build 0fe7d52a1793, task set 834bea86aab0: day-words, numbers-as-written, sparks-in-words, 3 runs each. Box: node:26-bookworm, no network.
pass  day-words            run 1   14 rounds    6.2 min
FAIL  numbers-as-written   run 1   31 rounds   30.0 min (its time ran out)  the task's test passes (test/trial-numbers-as-written.test.mjs)
…
The bar (contract 10.4, T100): every task passes at least 2 of 3 runs.
  day-words              3 of 3
  numbers-as-written     2 of 3
  sparks-in-words        3 of 3

GO: every task met the bar.
Saved …/agentbar/results/trial-2026-11-16T09-00-00/record.json
sha256 3f1c…
To keep it, from your own device on the tailnet (not from a Spark): node agentbar/trial.mjs --store agentbar/results/trial-2026-11-16T09-00-00/record.json
then press “Keep it (sha256 3f1c…)” in the chat “The coding trial’s result” in Spark Console, with your passkey.
```

It exits 0 on GO, 2 on NO-GO or a partial run. Copy the record to your own device and send it from there: Spark
Console refuses a record from a Spark's own address, and keeps one that met the bar only when you press its button,
with your passkey, on the page. The button names the record's sha256: check it is the one printed here.
`node agentbar/trial.mjs --dry` checks the kit with no brain and no Docker: every untouched task must fail.
