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
