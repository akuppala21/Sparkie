# Spark Console build plan

**Start from `GET /health`, not the brief.** The review notes record build `c0789b85fa67` as installed, carry-on and `POST /actions` included. The tree (`4f371d567af6`) is one build ahead of its test lock and the installer accepts that, so an install today would switch every workflow off.

## 1. Verdict

Spark Console is about halfway there. The model side is strong, with one action list behind chat and the API. Three promises are not yet true on the installed build: a multi-step request can stop half-way, healing can stop a newer model to bring back an older one, and a brain that is down stays down. It still needs the Mac to change, test or install anything. The single biggest gap is that every action is about a model server, so "set up search" or "run this script" has no first step and nothing to learn or repeat.

## 2. Is the tuned brain preset the next best thing?

No. It changes four flags at once on the machine everything depends on, and speed is not what stands between you and the goal. The brain lead also read an unfixed upstream report of wrong answers under parallel load on this exact model and draft (no skeptic re-checked it). Two cheap things come first: a script comparing answers at 4 at once with one at a time (step 0), and a fix so a missing saved setup cannot fall back to `aphex`, the old one-at-a-time setup (phase 1). The preset comes after phase 5, one flag at a time, and only if your agents are seen to wait.

## 3. What is missing

|Gap|Why it matters|Size|Phase|
|---|---|---|---|
|A multi-step request stops half-way|"Stop X, then start Y" ends after the stop|S|1|
|Healing can go against your latest wish|Trust in self-healing|S|1|
|A stopped or missing brain stays down|Chat is your only door|S|1|
|A saved workflow runs on any "start" word; its steps skip every check|A way round the gate|S|1|
|Undoing an update can leave the console stopped|Accidental lock-out|S|1|
|Your API call counts as an agent's; your chat queues behind agents|You cannot cancel or resume; replies wait|S|2|
|Nothing lists what is open|No notifications; Sparkie's reply is the only channel|S|2|
|Code only on the Mac; no tests or updates on Spark 2|Not independent|L|3|
|No settings on a start; a failed change loses the working model|Changeable configs|M|4|
|An off Spark vanishes; pair sentences fail|Wrong refusals, a second download|M|4|
|"Save that as X" rebuilds steps from prose|Learn once, repeat|M|4|
|Only model servers can be started|"Do anything I tell it"|L|5|
|The eval sees one message at a time|No proof the 27B can do the loop|S|0 on|

## 4. Build order

Five to six weeks for one builder. Each batch: a day of work, the whole test gate, install, then twelve fixed sentences on the real Sparks. Limits: seven new actions, about 30 tools visible to Sparkie, one new state file, no new background loop. Files are under `service/src/`.

**Step 0, no install.** Add the lock check at `deploy/host-on-portal.sh:26`; `git init` the Mac folder; measure Spark 2's free memory with the brain warm, the brain at 4 at once, and twelve multi-message eval cases (`test/eval.mjs`).

### Phase 1: finish what it starts, never heal against you

**Afterwards:** "stop gemma on 4, then start it again" does both steps; "coding mode" alone runs a saved workflow; `POST /actions/start_sparkie`.

**Build:**
- Carry-on (`14-chats.mjs`): continue when nothing is still running as the reply ends; keep the task through a typed "yes"; say so when it cannot.
- Healing (`20-heal.mjs`, `20-desired.mjs`): a bring-back never stops anything; a newer start replaces older should-run entries; a crash skipped for a passing reason is retried.
- Brain keeper (`20-heal.mjs`, `13-main-model.mjs`): same setup only, twice in 6 hours, when the container is missing or a failed switch left it down. Safety skeptic over four leads: a hand-stopped brain stays down and chat offers one restart button; Docker already restarts every other exit.
- Saved workflows (`16-actions.mjs`, `18-workflows.mjs`): run only when the whole title is in your words; steps get the starter's rights; then names go into Sparkie's prompt.
- `restore.sh` (written by `deploy/host-on-portal.sh`) swaps by rename and always restarts the service; pause counts go to disk; `undo_update` leaves the agent door.

**Guards:** no start code changes; the title rule ships before the names.

**Checks:** with GLM listed and both Sparks off, start gemma on 3, then power on 4: gemma keeps running. Remove the brain's container: back within 5 minutes.

### Phase 2: chat and the API are the whole way in

**Afterwards:** "anything I need to do?"; "resume"; "cancel the GLM download", whoever started it.

**Build:**
- Your API call counts as your hand for cancel, stop and pause (`16-actions.mjs`, `17-changes.mjs`, `07-jobs.mjs`, `24-handler.mjs`).
- Open problems from live state (`19-watcher.mjs`), first in Sparkie's notes and in `fleet_status`: held models, brain down, paused, stale backup, linger off, a Tailscale key near expiry, low disk.
- `pause_changes`; "resume" typed alone is handled by code.
- One brain slot of four kept for your chat; a length cap on `/v1` calls (`14-chats.mjs`, `15-routes.mjs`).
- Machinery tools hidden from Sparkie; failures carry cause, tried and next.
- The first deletions in section 7 (simplicity wanted all now, feasibility last; the REST copies wait for phase 5).

**Guards:** Sparkie never passes a pause; your own pause keeps the passkey.

**Checks:** with a model held, any reply opens with it; first words within 3 seconds under 16 agent calls.

### Phase 3: no Mac needed

**Afterwards:** "test your own code"; "update yourself"; "undo the last update".

**Build:**
- `deploy/install.sh` with a `self` mode; the source on Spark 2 becomes a git checkout, tagged per install, bundled into the daily copy (`25-backup-and-start.mjs`).
- `deploy/gate.sh`: the suite in a container with no network; fix the stand-in Sparks reading the real `/proc/meminfo` (`05-library.mjs:52`, `:335`).
- `update_console` (`18-workflows.mjs`): gate, wait until idle, install, four checks (new build, still the owner, keyless request refused, a chat turn ends), put back on failure, result posted in chat.
- A gate check for Tailscale, firewall, user or SSH-key commands in the code; a recovery card, drilled once.

**Guards:** your chat words or tailnet API call only; never an agent, workflow step or patch; committed code only; `self` mode never touches the service unit, watchdog, Tailscale or sudo.

**Checks:** three drills: a comment-only change installs; a crash at start is put back; a change that breaks only chat is put back.

### Phase 4: say how it runs, combine Sparks, repeat by name

**Afterwards:** "run GLM across 3 and 4 with a 64k context, 8 at once"; "download X to Spark 3, don't start it"; "save that as coding mode".

**Build:**
- Batch A (`07-jobs.mjs`, `08-cluster.mjs`, `17-changes.mjs`, `09-verified.mjs`, `20-desired.mjs`): pull and copy before any stop; the old container is set aside until the new one answers; `context` and `parallel` on `start_model`; what you asked for becomes the usual setup, which healing and undo bring back; the out-of-memory fix stops at 16k.
- Batch B (`17-changes.mjs`, `19-watcher.mjs`, `15-routes.mjs`, `18-workflows.mjs`): remember what an off Spark holds; pairs answer "already", restart, and stop as a pair when a start names their Spark; `download_model`; `stop_model` forgets a held entry; `find_setups` adds a repo you named; `linked_sparks {test:true}`; an answer test for embedding models; after a failed start Sparkie names the cause and a retry with one setting changed is one button; `save_workflow {from:'last'}` builds its steps from `audit.jsonl`.

**Guards:** a number not in your words is a button; one real GLM start validates each batch.

**Checks:** a context that cannot fit leaves the old model answering; with Spark 3 off, a model only there downloads nothing without a tap; "coding mode" runs from chat and the API.

### Phase 5: anything that isn't a model

**Afterwards:** "set up searxng"; "ask the running model these 20 questions and save the answers"; `POST /actions/run_workload`.

**Build:**
- `19-workloads.mjs`: one spec store, `run_workload`, `stop_workload` (three leads designed three runners; one is built). Services first, CPU only; then jobs: script as a list of lines, time and disk limits, exit code and last lines reported.
- `read_page`; the 29 NVIDIA guides from `find_recipes` as title and link.
- Last: remove the REST copies (tests ported, never dropped); cut the contract to what is built.

**Guards:** never the model label; its own Docker network; no host paths, Docker socket, secrets, or GPU on Spark 2; network off, and no image pulled, until your first-run yes, which is tied to the exact image, command and network for every caller. The fence is proven on Spark 3, then hand-checked on Spark 2. Ten spec-writing eval prompts pass before jobs are built. The reader refuses private and tailnet addresses.

**Checks:** searxng never shows in `running_models` or `/v1/models`; the second "set up searxng" asks nothing; a job cut off by a console restart still reports.

## 5. How "learn it once, then repeat it" will work

1. You ask in chat, or your agent calls the API. A saved name in your words runs by code: no thinking, no question.
2. Otherwise Sparkie uses the typed actions. For something that is not a model it reads a guide as data and fills in a spec: image, command, port, check, memory, network.
3. The first run of anything new asks you once, showing exactly what will run.
4. Code judges it: a model answers a test prompt, a service answers its check, a job exits cleanly. A failure returns to Sparkie with the output, for up to three fixes inside the request's budget.
5. Code records what passed: a model's setup in `verified.json`; a workload in `workload-specs.json` with your approval; a chain of actions in `saved-workflows.json`, built from `audit.jsonl` when you say "save that as X".
6. Saved names sit at the end of Sparkie's prompt and in the lookups your agents read.
7. Next time the name, in chat, on `POST /actions` or as a workflow step, repeats it with no call to the brain.
8. Where Sparkie cannot compose something, your outside agent teaches it once through the same API.

## 6. How self-healing ends up

Without the brain, the console recovers from: its own crash or hang; a failed update; a brain that crashed, went silent, went missing or was left down by a failed switch; a crashed model, including one skipped earlier; a pair that lost a part; a power-on, bringing back the setup you chose without stopping anything newer or shortening a context; a crashed service; a stalled download. The rest opens Sparkie's next reply and sits in `fleet_status`.

Still yours:
- a frozen or powered-off Spark;
- a model held after running out of memory;
- a brain you stopped by hand, or that failed twice in six hours (one tap);
- Tailscale keys, linger, SSH and the firewall;
- a full disk;
- a new kind of start failure (Sparkie names the cause, you tap the retry);
- rebuilding Spark 2 after its disk dies.

## 7. What NOT to build, and what to delete

Not built:
- A host shell, a Keeper, a skill store, a workflow language, a durable job engine: the fenced runner and typed steps do the job without the lock-out surface.
- `try_fix` and a learned-fixes file (skeptics over the healing lead): a retry is `start_model` with one setting changed, and one that works becomes that model's setup.
- Chains that save themselves (skeptics over two leads): names you would never say. Model setups and workloads already keep themselves on their first passing run.
- An update with a patch in the request; Sparkie changing its own code, until the engine trial passes 2 of 3.
- Until a real request: schedules, power and plugs, GPU services, a port per model, a settings table, delete actions, healing that stops half a pair.

Delete (none of it serves a chat-and-API owner): members and sharing, the short address, the workers.dev push, the editor and file browser, chat routing, hand-started recipe approval (phase 2); `local` installer mode (phase 3); about 40 REST copies and most of the page (phase 5); with your yes, three old presets, the YaRN overlay, and Spark 1 in `config.json` while it is locked out. The scratchpad apps draft is never applied: it labels an app as a model.

## 8. Decisions only you can make

1. CPU-only, memory-capped services and jobs on Spark 2, GPU work never? **Yes**, after the memory reading and two hand checks.
2. Your newer request wins over an older should-run entry; a hand-stopped brain waits for one tap; one pause switch replaces the separate self-healing switch; a workflow you saved and run may stop an in-use model without asking? **Yes to all.**
3. Deletions that tests pin: members and sharing, the old presets, and the "validated on these Sparks" gate with `test_changes` (nearly every caller already counts as its run)? **Yes**; the "tested" lock stays.
4. A download of about 1 GB on Spark 2 for the gate image; updates you asked for install without a button once the gate passes? **Yes.**
5. If the brain answers wrongly at 4 at once, does speed or parallel work give way? **Speed**: run without the draft, once the numbers confirm it.
6. By hand: linger, Tailscale key expiry off, a firewall rule per Spark before any workload gets the network, delete the Cloudflare Worker. **Linger and key expiry now.**

## 9. Risks

1. **An update or undo leaves the console stopped.** Guards: `restore.sh` fixed first; updates by your hand only, from committed code; `self` mode cannot touch the service unit, Tailscale or sudo; the recovery card.
2. **Code a 27B wrote runs on your Sparks.** Guards: the fixed fence, no secrets inside, network off by default, your yes checked for every caller; GPU jobs wait, because one can freeze a Spark.
3. **The 27B cannot reliably carry on or write a spec, or answers wrongly at 4 at once.** Guards: an eval pass bar before each promise, steps built by code from the record, your outside agent as the fallback teacher.

### Critical Files for Implementation
- /Users/akuppala/Documents/26aiRAG/spark-console/service/src/14-chats.mjs
- /Users/akuppala/Documents/26aiRAG/spark-console/service/src/20-heal.mjs
- /Users/akuppala/Documents/26aiRAG/spark-console/service/src/17-changes.mjs
- /Users/akuppala/Documents/26aiRAG/spark-console/service/src/18-workflows.mjs
- /Users/akuppala/Documents/26aiRAG/spark-console/deploy/host-on-portal.sh