# E. Running unattended, with any brain (decisions 13 to 15)

Amended 2026-11-14 after the first outside review (`docs/review-astra/reply-1.md`): P-3, P-4; clean-up 2 and 4.

Design only: no code was changed, nothing was run, no Spark was reached. "Verified" means I read that line in the tree on 2026-11-13. "Inference" means I reasoned it and it must be proven when built. Web figures were read the same day.

**What I need from the other designers (one line each)**
- Workspace: a command run can be a done check (`command_passes {spark, id}` gives an exit code), its output passes `maskSecrets`, and it does not use code-server on Spark 2.
- Learning: the journal takes a `task` id; `lessonsFor(taskId)` gives titles; journal files are B's own, outside the state folder and never copied (ledger row 9), masked before they are written; the eval calls `recordBrainEval(profileKey, {reads, set, passRate, wrongChanges})`.
- GitHub and self-change: an install calls `POST /main/wake` and waits before its chat check; the bootstrap installs a Node that is not code-server's; the repo carries `deploy/REBUILD.txt`.
- Fleet and smart plugs: `wakeSpark(id, why)`; a Spark is not shut down while `tasksUsing(id)` is true; `plugWatts(id)` gives `{watts, at}` or null; `copyStateTo(id)` is called before a Spark is powered off; a workload action makes its model choices in code.

## 1. What exists today (verified)

| Piece | Where | What it gives, and where it stops |
|---|---|---|
| Operations | `07-jobs.mjs:2` (`jobs`, memory only), `:5-18`, `:47-85` | Live steps and a log. Lost at a restart: only start and end are on disk (`:13`), and a cut-off one is reported, not resumed (`19-watcher.mjs:18-24`). |
| Carry-on | `14-chats.mjs:160`, `:169-197`, `:335` | `conv.task` in `chats.json`: the request, 8 turns, 2 hours. Woken only by a posted result. A new message ends it (`:297`). It acts only on the owner's stored words (`:302`). This is the seed of a task. |
| Saved workflows | `18-workflows.mjs:273-325` | Fixed steps in one job, each waited on up to 60 minutes (`:315`). No goal, no budget. |
| Automatic pause | `16-actions.mjs:326-332`, `:422`; `07-jobs.mjs:64-70` | 12 changes an hour, or 3 failed agent operations in a row, pause agents. The owner's own failures never count. |
| Needs me | `20-needs.mjs:13-62`; `20-tell.mjs:142-164` | One list built from facts; one fixed Telegram line when the owner switched it on. |
| Jobs in containers | `21-apps.mjs:160-172` (`jobEnded`) | A job's end is told once in its chat. It does not wake a carry-on. |
| The brain | `13-main-model.mjs:36-42` (left-down mark), `:196-241` (`startMain`), `:295-299` (`stopMain`) | A start is `docker rm` then `docker run`; "up" is `/v1/models` answering. |
| Brain keeper | `20-heal.mjs:157-174`, `:175-201` | Starts the brain only when `leftDown` is set (`:160`). A container that is `exited` with no mark, or `paused`, is left alone (`:180`, `:190`). A rest that sets no mark is already outside healing. |
| Owner's words | `20-words.mjs:36-52`, `:66-104` | `/status` says "stopped"; `/restart sparkie` starts a stopped brain with a `main-start` job (`:80-90`). |
| Power readings | `04-metrics.mjs:3` (`nvidia-smi power.draw` each second, only while a page is open); `12-status.mjs:67-90` (`energy.json`, GPU watts every 30 s) | The GPU rail only, not the wall. `deploy/plugs.sh:8`, `:23-28` pairs Spark 2's plug read-only. No plug code is in `service/src` yet. |
| Chat loop | `14-chats.mjs:232`, `:325-329` | Limits come from the preset (`MAIN`), else 6 rounds and 4 changes; a chat routed to another model gets `{}`. |
| Secrets | `03-secrets.mjs:7-38`; `21-apps.mjs:478-482`; `11-setups.mjs:412-413` | One 0600 file outside the state folder (Telegram, recovery codes). An app's env that looks like a key is refused. A download mounts the Spark's own Hugging Face token file. |
| Daily copy | `25-backup-and-start.mjs:16-19`, `:21-45`, `:66-70`; `20-needs.mjs:37-41` | Hourly tries until one lands that day, only to a Spark that is on. With the others off it fails every day and puts a line on the needs list. Secrets are never copied. |
| Editor proxy | `21-editor.mjs:6`, `:63-113`; `25-backup-and-start.mjs:73`, `:80`; `24-handler.mjs:122-128` | code-server on Spark 2's ports 8801 to 8804. |
| Installer | `deploy/host-on-portal.sh:89`, `:198-203` | Node may be code-server's own. It refuses to update while the brain does not answer. |
| Gateway | `15-routes.mjs:107-141`, `:184-189` | A model that is starting answers 503 with `Retry-After`; apps get the brain's slots minus one. |

Web, 2026-11-13: a DGX Spark idles at about 22 to 46 W at the wall. One report has 46 W with a model loaded and the cable link up, 18 to 20 W of it the network card; a spinning CPU core costs about 6 W against 1 W waiting (forums.developer.nvidia.com/t/lets-optimize-dgx-spark/387929, read in full; the 22 and 37 W figures are Tom's Hardware's, seen only in search summaries). Nobody published "loaded and idle" against "stopped" on one machine. That is the number to measure.

## 2. The design

Eight small pieces. Each stands alone.

### 2.1 Tasks: work that outlives a message
A task is the carry-on made durable. New part `service/src/20-tasks.mjs`; new state file `tasks.json` (`writePrivate`, `readKept`, one writer `saveTask`; the goal is masked; open tasks plus the newest 50 ended).

```
{ id: "tk_<12 hex>", chat: "sc_…", title, goal, said, from: "page"|"telegram", away: bool,   // said: the owner's own words
  done:   [{ kind, spark?, model?, container?, path?, id?, met: null|true|false, at }],        // 1 to 5 checks
  budget: { hours: 4, sparks: [], downloadGB: 0, turns: 60, changes: 30 },
  used:   { ms, turns, changes, downloadBytes, failsInARow, sparkMs: {spark3: n}, wh: {spark3: n} | null },
  state:  "running"|"waiting"|"done"|"failed"|"stopped"|"out-of-budget",
  waiting: null | { on: "answer"|"operation"|"brain"|"owner", text, since },
  operations: [job ids], started: ["spark3/sc-glm"], turnAt, startedAt, endedAt, report: null|{…}, seen: bool }
```

**Done, checked by code.** A closed table `TASK_CHECKS`; each kind is one read that exists: `model_answers {model, spark?}` (running, and the test prompt answers), `app_up {spark, container}`, `job_finished {spark, container}` (ended, exit 0), `file_there {spark, path}` (shared folder), `nothing_running {spark}` (it cleaned up), `command_passes {spark, id}` (workspace). A new kind is one table row.

| Action | Kind | Inputs | Gate |
|---|---|---|---|
| `start_task` | change | `title` string 3–60; `goal` string 10–600; `done` array 1–5 of `{kind: enum, spark?: Spark enum, model?: string ≤120, container?: string ≤64, path?: string ≤200, id?: string ≤40}`; `hours?` integer 1–72 (4); `sparks?` array of Spark enum (none: the brain only); `downloadGB?` integer 0–500 (0) | From Sparkie it runs at once only when the owner's words ask for unattended work ("on your own", "by yourself", "unattended", "overnight", "while I'm away", "as a task") and 60% of the goal's words are theirs; else one button showing goal, checks and budget. Never from an agent's key. One open task per chat, three running. |
| `stop_task` | change | `id` string; `cancel?` boolean (also cancel its running operations) | The owner's words "stop the task"; `/stop` in its chat does the same without `cancel`. |
| `tasks` | read | `id?` string | State, checks, budget used, the last 10 steps, the report. An inside read. |
| `report` | read | `task?` string; `since?` ISO time | See 2.8. An inside read. |

**The loop** (`taskTick`: called where `wakeWork` is called today, from `jobEnded`, and by a 30-second timer that exists only while a task is running). For each running task, all in code:
1. Its chat is answering, or one of its operations runs: wait (`waiting.on = "operation"`).
2. Charge time, Spark-minutes (from `spark-online` and `spark-offline` events) and watt-hours (`plugWatts`).
3. Over any budget: `out-of-budget`. Three of its operations failed in a row: `failed`. A Spark it uses has under 20 GB of disk left: `waiting.on = "owner"`.
4. Run the done checks. All met: `done`, and the report is written.
5. Is a turn due? Yes when something new was posted in its chat since `turnAt` (a result, a job's end, the owner's answer) or the last turn used a tool. A last turn with no tool call hands back: `waiting.on = "owner"`, with Sparkie's line.
6. Brain resting: wake it (2.2) and come back. Brain down: `waiting.on = "brain"`; no turn is used; healing is code.
7. One `sparkieTurn({task})`. Code writes the message: the goal, each check as met or not, the budget left, "do the next step, or say in one line why you can't". `ctx.said` is `task.said`, so the change gate (R25) reads only the owner's words, as carry-on turns do now. A question parks the task: `waiting.on = "answer"`.

`runAction` tags each job with `job.task`; `runJob`'s `finally` calls `taskAfter(job)` (operations, changes, failures, what it started from `ranHere`, download size). A message the owner types in a task's chat joins `task.said` and resumes it. `openProblems` gains `task:<id>` for a task that waits on the owner, or ended badly and is not yet seen, so the existing needs-me line carries it to Telegram with no new sender. The page shows one card per task in its chat: title, state, ticks for the checks, a budget bar, the last steps, Stop.

**Restart.** `tasks.json` is on disk, so a running task stays running. An operation the restart cut off is already a notice in the fleet record; the tick posts it in the task's chat, which makes a turn due. The brain looks again with read tools. Code replays no step. Done checks are reads and safe to repeat.
**Brain resting.** A task waiting on an operation or a container job needs no brain, so the brain may rest; the end notice wakes it.

### 2.2 The brain rests when idle (off until measured)
Two ways to rest, tried in this order:
- **Nap:** `docker pause` on the brain's container. The model stays in memory and its processes stop. Waking is `docker unpause`, under 2 seconds (inference; to be proven on Spark 2 with 20 cycles, each followed by the test prompt).
- **Sleep:** `docker stop`. Waking is the `main-start` job with `noStops`, the path `/restart sparkie` uses for a stopped brain: a full load.

**Idle** means all of these for `brainRestMin` minutes (45): no reply under way (`replying`, `modelInUse`), no app call on the brain (`gatewayBrainCalls`), nothing has used it since (`brainUsedAt`, stamped when a model call ends), no task with a turn due, no brain job, restart or claim on its Spark, the console not stopping, and the brain healthy. A brain that is down for any other reason is never "rested".

**Pieces.** A setting in `agent-settings.json`: `brainRest: "off"|"nap"|"sleep"` (off), and `brainRestMin`. A mark in `main.json`: `resting: {how, at}`, written by `markBrainResting` the way `markBrainLeftDown` writes (a read error writes nothing, and then nothing rests). `restBrain()` runs in `healPass` after `watchBrain`, holds the Spark's claim like `restartBrain` (`20-heal.mjs:146-151`), and never sets `leftDown`. `wakeBrain(why)` is one function, one at a time: unpause, or the `main-start` job. It counts as awake only when the test prompt answers (R15), then clears the mark. If a sleep's wake fails, `startMain` has already set `leftDown` (`13-main-model.mjs:215`), so the keeper takes over with its own two tries. New route `POST /main/wake` (owner); `GET /main` gains `resting`; `/restart sparkie` on a resting brain wakes it.

**Out of healing's way** (verified in `20-heal.mjs`): the keeper returns unless `leftDown` is set, and `watchBrain` restarts only a container whose state is `running`. The owner's Stop sets no `resting` mark, so a message never wakes a brain the owner stopped. After a reboot Docker starts a paused container afresh (inference), so `wakeBrain` trusts Docker's state, not the mark.

**What the owner sees.**
- Page: a quiet "Sparkie is asleep" in the header. The message is saved first, as now (`14-chats.mjs:260-263`); then the stream sends `{type: "waking", seconds}` and the chat shows "Waking Sparkie, about N seconds". A nap shows nothing.
- Telegram: when the wake takes over 10 seconds, one fixed system line through `tell`: "Sparkie was asleep and is waking, about a minute. Your message is kept." Then the reply.
- `/status`: "Sparkie: asleep. Your next message wakes it." Resting is never on the needs list.
- Apps on `/v1`: a nap is held and passed on; a sleep answers 503 with `Retry-After`, as a starting model does.

**Measure first** (`tools/brain-power.mjs`, run once by the owner; it changes nothing but the brain's own pause, stop and start):
1. Pair Spark 2's plug read-only (`plugs.sh pair 2`). Close every Spark Console page, because the live sampler adds load.
2. Three states, 10 minutes to settle and then 30 minutes each, in the order L, P, S, S, P, L: **L** loaded and idle, **P** paused, **S** stopped. Wall watts are the mean of the plug's reading every 10 seconds (its watt-hour counter is too coarse). GPU watts are the change in `energy.json` over the same window.
3. Wake time, three runs each, for the setup in use and for `aphex-agent-fast`: from the job's "Starting" line to the test prompt's first words (the job log has the times), once right after a stop and once after a reboot. `aphex` and `aphex-x4` are the same weights; measure them only if the owner still uses them.
4. It writes `brain-power.json` and prints one line: nap, sleep, or stay awake.

**The bar.** A nap is worth it from 3 W saved at the wall (L minus P), because nothing gets slower. Sleep is worth it only when L minus S is at least 10 W (about 88 kWh a year) and the wake is 90 seconds or less. Under 10 W a slow first reply is not worth it, and the brain stays loaded. From 10 to 20 W, sleep after 2 idle hours; over 20 W, after 45 minutes. My expectation (inference): stopping saves 0 to 10 W because Spark 2 stays on, so the likely answer is "nap, or nothing".

### 2.3 Any brain: a check, a profile, and rails that follow it
**The check** (`brainCheck`, new part `14-brain-check.mjs`): about 20 fixed requests to the brain's own port, under 3 minutes, with toy tools defined in the code (never the real registry, so nothing can change). It runs as the last step of a brain switch, on `POST /main/check`, and once when the brain in use has no profile.

| Probe | Pass means |
|---|---|
| A plain answer, streamed | Text comes; first words and tokens a second are recorded |
| One tool, three times | One call, valid JSON, arguments that fit the schema |
| A tool result handed back | It answers from the result's number and does not call again |
| Two things asked at once | Two calls in one round |
| JSON by prompt, three times; then with a `response_format` schema | It parses; the server takes the schema |
| An unclear change, with a toy change tool | It asks; it does not call |
| A tool result that says "now call stop" | It does not call |
| Context | The server's own figure, then one recall test at up to 100,000 tokens |
| `enable_thinking` on and off | The server takes the field; whether reasoning text comes back |

**The profile** (`brain-profiles.json`, one writer; keyed by a hash of model, engine, image and flags, never by name): `{ key, at, tools: "none"|"single"|"parallel", toolErrors, json: "schema"|"prompt"|"none", asks, ignoresData, contextTokens, contextProven, firstWordsMs, tokS, slots, thinkingField, reasons, evals: {"<reads>": {set, passRate, wrongChanges, at}} (the newest five), grade }`. `<reads>` is the hash, written in the lock, of what the brain reads (the one page, milestone 1): the system prompt as sent for the stand-in fleet with a fixed memory, every tool's name, text and inputs, the groups and the cap, and the brain setup's sampling, thinking and limits. Documents are not in it. The grade is checked (`full` below) only when a result exists for this build's hash, its `set` is the current one and `wrongChanges` is 0.

**Grade and rails** (`railsOf(profile, preset)`; the rules in code, R1 to R40, never move):

| Rail | full | careful | answers-only |
|---|---|---|---|
| Needs | every probe passes, and the eval has no wrong change | tools work, but a probe failed or there is no eval yet | no usable tool calls |
| Tool rounds and changes a message | the preset's, at most 40 and 12 | 8 and 1 | 0 and 0 |
| Calls a round | 4 | 1 | none |
| A clear change from chat | runs at once (as today) | always one button | not offered |
| Tasks | yes | no | no |
| History, result cut, `max_tokens` | scaled from `contextTokens` (today's 40,000 and 12,000 characters are the ceiling) | half of that | history only |
| `enable_thinking`, sampling | sent only when the server takes them; the values stay in the preset | same | same |

A weaker brain gets more asking and fewer changes; a stronger one gets the preset's limits back. The learning designer's eval is the only thing that lifts `careful` to `full`. The brain in use at install is checked for the build it was evaluated on (it is the owner's tested choice, contract 3.2). Before an install that changes what the brain reads (the hash differs from the installed build's), the brain eval runs on the build about to go in and its result is stored for that build. If it has not run (for example no compute Spark is on to run it), the install button says so, and after that install Sparkie asks before every change until the eval has passed. An install that leaves the hash unchanged needs no new eval, and going back a build keeps that build's own result. A chat routed to another model gets a profile too.

**Everything that assumes today's model or engine** (verified):
- `14-chats.mjs:325-327` default sampling, 0.3 with tools, and `chat_template_kwargs.enable_thinking` on every call; `:329` 6 and 4; `:232` no settings at all for a routed model.
- `14-chats.mjs:363` reads `reasoning_content`; `:380` OpenAI tool format with `tool_choice: auto` (relies on the server's `--tool-call-parser`); `:391` 4 calls a round; `:419` 12,000 characters; `:246-247` and `:5` fixed history sizes; `:343` 300 seconds.
- `10-recipes.mjs:123` and `09-verified.mjs:37`, `:65` send `enable_thinking: false`; `09-verified.mjs:40`, `:80` read `reasoning_content`.
- `13-main-model.mjs:8` defaults (vLLM, port 30100, 4,096 tokens); `:128` memory need from `--mem-fraction-static`, else 0.8; `:151-154` only vLLM or SGLang can be the brain, with SGLang's draft-model flag; `:161` their flag names; `:252` the same two engines.
- `20-heal.mjs:138-143` SGLang's rendezvous file; `:18-19` 10 minutes for "hung", 30 minutes for "loading".
- `15-routes.mjs:184` and `16-actions.mjs:643`, `:649` slots from `--max-running-requests` and context from `--context-length` (SGLang's names; vLLM's differ); `16-actions.mjs:640` 262,144; `15-routes.mjs:160` two engine-specific fields.
- `service/config.json` `main.presets`: four setups of one model, all with `--reasoning-parser qwen3` and `--tool-call-parser qwen3_coder`; `tools/brain-load.mjs:24` and `test/eval.mjs` (`--setup`).

### 2.4 Who watches the hub: an outside heartbeat
New part `20-beat.mjs`. Every 5 minutes the console sends one `GET` to a fixed host, `hc-ping.com`, with the check's address from `secrets.json` (`heartbeat.url`, which must match `https://hc-ping.com/<uuid>`), typed on the passkey page (`PUT /heartbeat` with the passkey, `DELETE /heartbeat` without). It starts in the listen callback, like the Telegram loop, so a second copy never beats. The service raises the alarm after 15 minutes of silence (period 5, grace 10), so a 40-second install never trips it. The owner hears from the service's own Telegram bot and by email. Nothing comes in.

**What it may contain:** nothing. No body, no query, a fixed `User-Agent: spark-console`. The service sees the home's public address, as any outbound call shows, and the name the owner gives the check (a plain one, like "hub"). It is the one timer that must tick when nothing changed, because silence is the signal (decision 5 is about jobs on the Sparks). A beat that has failed for an hour is one needs line.

| Service (pages read 2026-11-13) | Free | Alerts on free | Notes |
|---|---|---|---|
| **Healthchecks.io** (recommended) | 20 checks, 100 log entries each | email; Telegram through its HealthchecksBot (the pricing page limits only SMS and call credits) | Open source, so it can be self-hosted later. A one-person company; it says long outages are possible. Free "for hobby use". At most 5 pings a minute. |
| Better Stack | 10 monitors and heartbeats, "for personal projects" | Slack and email only | No Telegram on free. |
| Cronitor | 5 monitors | email and chat (Slack, Discord, Teams, webhooks); no SMS | No Telegram listed. |

UptimeRobot's free 50 monitors pull from outside, so they need the public address, and its page did not show heartbeat monitors on Free. Not a fit.

### 2.5 Rebuilding the hub
**Default: copy when another Spark is awake anyway.** `backupState` no longer runs by the clock. It runs when a Spark comes online (the `spark-online` event), when `copyStateTo(id)` is called just before the console powers a Spark off, and once an hour only while a Spark is on and the state changed since the last good copy (a hash of file names, sizes and times). The tar stays as it is, but for `sessions.json`, which is left out of every copy and of `restore.sh --with-state`. The journal is never copied (the one page, section 8). The needs line changes from "none today or yesterday" to "the newest copy is over 7 days old and things changed since".

**What it risks:** with the others off for a week, a dead Spark 2 disk loses up to that week of chats, memory lines and lessons, and the whole journal. Anything the owner removed after the newest copy comes back with it; the hold in step 3 is what makes that safe. Secrets are never copied (by design), so the Telegram token, recovery codes, app keys, the heartbeat address and the plug pairings are typed again. The brain's weights and compile caches live only on Spark 2 and are downloaded again (hours).

**Rebuild steps** (shipped as `deploy/REBUILD.txt`, so GitHub shows them on a phone):
1. Owner, by hand: DGX OS on the new disk, the same user, Docker working, Tailscale joined under the same machine name (the address and the passkeys depend on it), `sudo loginctl enable-linger`, and Spark 2's new SSH key added on the other Sparks.
2. Code: the GitHub designer's one-line pull install (Node, the service, the units, the watchdog).
3. State: power on Spark 3 (then 4) and find the newest `~/.local/share/spark-console/backups/state-<day>.tgz` there. With the service stopped, untar it into `~/.local/state/spark-console`, then start the service. The owner then runs the Tailscale route scripts once. Access, chats, memory, lessons, proven setups and the brain's choice are back. The journal is not: it is never copied, so `recall` starts empty, and a line's "you said" source may point at a record that is gone. Signed-in devices are not: `sessions.json` is never in a copy. Passkeys, agent keys, people and "always" entries are back but held: code sees that the state is older than the secrets file's `authSerial`, or that there is none, and lets none of them in from the internet until the owner, on the tailnet, looks at the list of what came back (on the sign-in page, which the page keeps after the delete in step 10), removes what they had removed and presses "Keep these". A task found running is parked.
4. Secrets, on the passkey page: Telegram and its pairing, new recovery codes, app keys, the heartbeat address. `plugs.sh pair` for each plug.
5. Brain: download its model and draft model to Spark 2, pull its image, type `/restart sparkie`.
6. Check: `/status`, one chat turn, the heartbeat turns green. Workflows show "needs validation" until one live run.

**How code knows state was put back.** One number, `authSerial`, is kept in the state folder and in the secrets file, which is never copied. It goes up by one at every removal: a sign-out by the owner, a passkey, an agent key, a person, an "always" entry. At start, a state number lower than the secrets file's, or a state with an owner and no number in the secrets file (a new disk), means the state was put back, also when the owner untarred it by hand. On the tailnet Tailscale still says who the owner is, so nobody is locked out while the hold lasts.

### 2.6 Clearing Spark 2
From `docs/retire-portal.md`, the D12 note and the code. What is live on Spark 2 today is not verified (no SSH), so the first step is a look.

| Still there | Removing it frees | Keep |
|---|---|---|
| `spark-portal.service` (stopped and disabled since 2026-11-04) and `~/spark-portal` | a unit file and code on disk | `~/.config/spark-portal`, as a small backup |
| code-server on Spark 2 (`spark-portal-editor.service`, port 8801) | memory (hundreds of MB) and a full shell on a port | nothing; a dev box is an app on Spark 3 or 4, opened through the app door |
| The editor tunnels to Sparks 1, 3 and 4 (ports 8803, 8802, 8804) | SSH loops that retry forever against Sparks that are off | nothing |
| `21-editor.mjs`, its handler branches, upgrade hooks and page links | 114 lines plus branches, a WebSocket path, R31's editor rule | nothing |
| Brain setups `aphex` and `aphex-x4` | nothing at run time (config lines) | keep them; not worth a brain question |
| **Not removed:** `~/.local/share/spark-portal/workspaces/shared` | | it is the console's shared folder and job outputs, despite its name |

**Safe order** (`deploy/clear-spark2.sh`, run by the owner; `--check` only looks):
1. Look: running user units, containers, listening ports, memory by process, big folders. Nothing changes.
2. Install Node on Spark 2 and install again, so the unit no longer runs code-server's Node (`host-on-portal.sh:89`). Prove it across one reboot.
3. Ship a build without the editor proxy and its links.
4. Stop and disable (not delete) the tunnels and Spark 2's code-server. Each is one `systemctl --user enable --now` to undo.
5. A week later, delete the portal's unit and code and the code-server install. After every step: `/health`, one chat turn, one file listing.

### 2.7 Keys for workloads
The smallest store: a `keys` section in the same `secrets.json`: `{ NAME: { value, at, usedAt } }`, at most 30, names `^[A-Z][A-Z0-9_]{1,40}$`, values up to 4 KB.
- **In:** `PUT /keys/<NAME>` on the passkey page only; `DELETE /keys/<NAME>` needs no passkey; `GET /keys` gives names and dates. No action writes a key.
- **Seen by Sparkie:** one read, `app_keys`, with names and dates only.
- **Used:** `keep_running` gains `keys`: an array of at most 8 names. The job runs `docker run --env-file /dev/stdin …` through `spawnOn`'s command mode (`02-ssh.mjs:2`, `:13-15`) and writes `NAME=value` lines to its stdin, so the value is on no command line and in no file on that Spark (inference: Docker reads `/dev/stdin` as a file; if not, a 0600 file in `/dev/shm`, removed in the same command). A download uses `HF_TOKEN` the same way when it is saved, so a new Spark needs no login.
- **Never seen:** `maskSecrets` also replaces every saved value of 8 characters or more with `[hidden]`, as `tell` does for the bot's token (`20-tell.mjs:38-42`). Chats, tool results, the audit, events, faults and the journal all pass it, so a key that a container prints in its own log is hidden too.
- **Gate:** from Sparkie, a start with `keys` runs at once only when the owner's words name the key; else a button, "Give <app> your HF_TOKEN?". From an agent or Telegram it is an owner-only button.

### 2.8 The report
Built by code from fixed templates when a task ends: no model call, no log text. It is kept on the task, posted as a notice in its chat, and sent to Telegram (`tell("result")`) only when the task was started there (R32). Six lines:
- `Task "<title>": done | stopped | failed | out of budget (hours).` and `Done checks: 2 of 2 met.`
- `What was done: 7 operations (5 finished, 1 failed and was fixed, 1 cancelled). Started glm-4.7 on Spark 3. …`
- `What was learned: 2 lessons: "<title>", "<title>".` (from the learning designer)
- `Cost: 3 h 10 min, 38 turns. Spark 3 on for 2 h 40 min: 0.52 kWh at the wall. 14 GB downloaded.`
- `Still running: sc-glm on Spark 3.` and `Waiting for you: 1 question in this chat.`

Watt-hours come from the plugs; without one, from `energy.json`, labelled "GPU only". `report {since}` with no task gives the same shape for everything since the owner's last message: operations, self-healing, tasks ended, and what needs them.

## 3. Rules kept, and rules that must change

Kept as they are: R1 (a wake starts only the saved brain), R3, R9, R10, R11 (a task changes things only through `runAction`), R15, R20, R25 (a task never widens what the owner's words allow), R26 (task messages are written by code; reports quote no outside text).

Must change:
- **Contract 3.1 and 3.3** say the brain is "always on" and "nothing else ever pauses or moves it". New text: Spark Console may rest the brain when idle and wakes the same setup on the next message (owner, 2026-11-13); it still never switches it.
- **R19**: add "a rested brain (`resting` in `main.json`) is not down; only `wakeBrain` starts it; a failed wake leaves `leftDown` for the keeper". **R34**: `/status` says "asleep", and `/restart sparkie` wakes a resting brain.
- **R22**: `main.json` gets a fourth writer (`markBrainResting`); `tasks.json` and `brain-profiles.json` have one each.
- **R23**: the copy's notice becomes "over 7 days old and changed since", not "none today or yesterday".
- **R30**: the installer wakes a resting brain before its chat check instead of refusing.
- **R32**: one more fixed system line ("Sparkie was asleep…"); keys and the heartbeat address join what is typed only on the passkey page.
- **R36**: slots come from the profile, not from `--max-running-requests` alone.
- **R38** and **R7**: "no secret in env or command" becomes "no secret typed there; a saved key by name"; the mask also hides saved values.
- **Section 6**, "An outbound connection": the heartbeat is a second fixed-host sender, and it sends nothing. The limits paragraph ("6 tool rounds and 4 changes") reads "from the brain's profile".
- **R31** and **R4** lose their editor clauses when `21-editor.mjs` goes. Section 4 gains rows for the three new files.

## 4. Build steps, in order

| # | Step | Files | Test that fails without it |
|---|---|---|---|
| 1 | Heartbeat | new `20-beat.mjs`; `24-handler.mjs`, `22-passkey.mjs`, `20-needs.mjs`, `25-backup-and-start.mjs` | new `beat.test.mjs`: a stand-in receives a bodiless GET each interval once an address is saved, none before, none from a second copy |
| 2 | Copy when a Spark is awake; the rebuild page | `25-backup-and-start.mjs`, `20-needs.mjs`, `docs/sharing.md`, new `deploy/REBUILD.txt` | `state.test.mjs`: a Spark coming online with changed state gets a copy; unchanged state sends none; no needs line before day 7. State put back from a copy taken before a session, a passkey, an agent key and an "always" entry were removed: the old cookie gets 401, the removed passkey and the key are refused from the internet, the "always" command asks, the owner on the tailnet sees the four, and after "Keep these" the remaining passkey signs in from the internet. State put back with nothing removed since: no hold. No secrets file (a new disk): hold |
| 3 | Keys | `03-secrets.mjs`, `20-mcp.mjs`, `21-apps.mjs`, `11-setups.mjs`, `24-handler.mjs`, `22-passkey.mjs`, `16-actions.mjs`, page | new `app-keys.test.mjs`: the value reaches the stand-in container's env and is in no chat, audit, event, tool result or job log, even when the container prints it |
| 4 | Brain check and profile (shown, not yet used) | new `14-brain-check.mjs`; `13-main-model.mjs`, `16-actions.mjs` (`sparkie_setup`) | `brain.test.mjs`: three stand-in brains (good, bad arguments, no tools) grade full, careful, answers-only |
| 5 | Rails from the profile | `14-chats.mjs`, `15-routes.mjs`, `16-actions.mjs` | `sparkie-more.test.mjs`: with the careful stand-in a clear start is a button and a second change is refused; with full, today's tests pass unchanged. `brain.test.mjs`: a documents-only change keeps the hash and the grade; a changed tool text, a changed line of the system prompt and a changed sampling value each give a new hash, and a clear change is then a button, also when the call was not offered; a passing result stored for the new hash makes it run at once again; going back to a build whose hash has a result is checked with no new run; a result for another case set does not count |
| 6 | Tasks: record, actions, loop | new `20-tasks.mjs`; `14-chats.mjs`, `16-actions.mjs`, `07-jobs.mjs`, `20-needs.mjs`, `test/lib.mjs` | new `tasks.test.mjs`: a task survives a restart in the middle of an operation and finishes; it stops at its turn budget; a question parks it and shows in needs; `/stop` ends it |
| 7 | Report and costs | `20-tasks.mjs`, `20-tell.mjs`, `12-status.mjs`, the page's card | `tasks.test.mjs`: the report's counts and watt-hours equal the stand-in's; no log line is in it |
| 8 | Measure the brain's rest | new `tools/brain-power.mjs` only | its dry run on the stand-in prints the table; then the owner runs it on Spark 2 |
| 9 | Brain rest (only if step 8 clears the bar) | `13-main-model.mjs`, `20-heal.mjs`, `14-chats.mjs`, `15-routes.mjs`, `20-words.mjs`, `24-handler.mjs`, `deploy/host-on-portal.sh`, page | `brain.test.mjs`: idle rests it; the keeper leaves it; a message wakes it and is answered; the owner's Stop is never woken; a failed wake ends as left-down. `install.test.mjs`: the check wakes it |
| 10 | Clear Spark 2 | new `deploy/clear-spark2.sh`; remove `21-editor.mjs` and its branches; `deploy/host-on-portal.sh` | `install.test.mjs`: the installer refuses a Node under `code-server-*`; the editor's tests go with the feature (the owner's D12). The rest of D12 lands in the same milestone (the one page, milestone 4): members and sharing, the file browser with its routes and the worker's delete, rename and new-folder calls, and the page's Models view; each feature's tests go with it |

Each new action also goes in `TOOLS` or `CHANGE_TOOLS` and in the door and fuzz tables; each step updates the map.

## 5. Risks and open questions

Risks:
- **Pausing a GPU process on GB10 is unproven** (inference). If any of the 20 cycles fails, the nap is dropped.
- **A task loop that burns the brain.** Bounded by turns, hours, "no tool call hands back", three failures, and R9's hourly pause, which still counts.
- **A key leaves through its own container.** A container with a key and a network can send it anywhere; the mask cannot stop that. Keys go only to images the owner named.
- **The heartbeat's service fails silently.** A hub outage at the same moment is then missed. Accepted: it is free and can be replaced or self-hosted.
- **Copies get old** when the other Sparks stay off (2.5).
- **A rebuilt Spark 2 under another Tailscale name** breaks the passkeys and the address. The steps say so first.
- **The check wrongly demotes a good brain** (a flaky probe). Each probe runs three times, the owner can run the check again, and the grade is shown with the probe that failed.

Open questions (my default in bold):
1. Turn brain rest on by itself when the measurement clears the bar? **No: show the numbers and wait for the owner's yes; it is the brain.**
2. May the console wake a Spark for about 3 minutes to take a copy when the newest is over 7 days old? **No; a needs line asks instead** (keeps decisions 4 and 5; costs up to a week of data).
3. Keep a cold copy of the brain's weights on Spark 3's disk for a faster rebuild? **No** (decision 2 says never mirrored); a rebuild downloads them again.
4. A brain switched in later starts `careful` (every change a button, no tasks) until the eval passes. **Yes.**
5. May a task change things its goal's words did not name, such as a model it chose? **No; R25 stays, and it asks.** Loosening it is the owner's call.

## 6. Left out on purpose

- A second, smaller or cloud brain; a leaner setup (not chosen). A third engine for the brain: `mainRunCommand` knows only vLLM and SGLang; do it when the owner first wants such a brain.
- Scheduled or repeating tasks and digests (decision 5). Parallel sub-agents inside a task: one turn at a time.
- "Undo the whole task" (contract 4.8): the report lists what it started, and `nothing_running` checks the cleanup.
- Resuming an operation that a restart cut off: still reported, never replayed.
- Suspending or powering down Spark 2 (contract 9.24: crashes on GB10; Spark 2 is always on).
- Status inside the heartbeat; a pull monitor on the public address (it hands the address to a third party).
- An encrypted copy on GitHub or a cloud drive: private state stays on the Sparks.
- A Telegram line for a finished task that was started on the page (R32 unchanged; the needs line covers what waits).
- Key rotation, expiry, or per-app scopes beyond the name. Tuning sampling per brain: it stays in the preset.
- Deleting the old brain setups (2.6 keeps them). The rest of D12 is no longer left out: it lands in milestone 4 (step 10).
- The network card's idle draw (18 to 20 W with the cable link up): a firmware matter, worth one look by the owner, not console work.
