# D. Any number of Sparks, and whole workloads

Design only; no code was changed and nothing was run. Checked by reading the parts named below (build 47e9cc08562e). "Hub" is Spark 2: the console and the brain. "Compute Spark" is every other Spark on the list. The owner says "workload"; the code and tools say **pipeline**, because `workloads` is already the read that lists containers. Every default below is chosen and stated (decision 16); section 5 asks only two questions.

## 1. What exists today

| Thing | Where (read and checked) | What it does, and where it stops |
|---|---|---|
| The Spark list | `01-setup.mjs:63`, `:68-70`; `03-identity.mjs:113`, `:251-277`; `architecture.md` §4 "Which Sparks exist"; `retire-portal.md` step 5 | `NODES` starts from `config.json` (replaced on every install), then follows `nodes` in `access.json`, copied once from the old portal; read again every 60 s. **Nothing writes `nodes`.** Adding or removing a Spark is a hand edit of the file that also says who the owner is. |
| What follows the list by itself | `16-actions.mjs:18`, `:73`; `12-status.mjs:97`; `19-watcher.mjs:256`; `06-links.mjs:28-97`; `05-library.mjs:81`, `:264`; R40 | Names, the Spark choices agents see, status, watcher, cable test, library, placement, linked pairs, the app door. A listed Spark needs no code change. |
| Fixed Spark names left | `01-setup.mjs:37`; `25-backup-and-start.mjs:17`; `18-workflows.mjs:435`; `21-editor.mjs:6`; `16-actions.mjs:89`; `deploy/host-on-portal.sh:478-488`; `deploy/power-setup.sh:19`; `deploy/plugs.sh:38` | `spark3` first for copies and the daily copy (both fall back), `spark1` last for test runs, editor ports for four ids, bare numbers of one digit, the installer's reach check reads `config.json`, the power scripts name Sparks 1, 3 and 4. None stops a new Spark working. |
| One model across Sparks | `08-cluster.mjs:7`, `:11`, `:196`, `:256`, `:315`, `:319`; `16-actions.mjs:30`; `05-library.mjs:138-139`; `17-changes.mjs:176-210`, `:411`; `10-recipes.mjs:79`; `dig.mjs:311`, `:319` | Exactly two, everywhere: "Pick two Sparks", one cable, `-part2`, `--nnodes 2`, a two-member engine check, `sparks` of 2 to 2. An engine only says `pairs: true`. Versions needing 3 or 4 Sparks are listed, never started. The current across-two version still waits for its validation run (`architecture.md` §8). |
| Apps and jobs | `21-apps.mjs:297`, `:116`, `:145`, `:160`, `:524-528`; `19-watcher.mjs:175`; R38 | `keep_running`: any container that isn't a model; with `gpu`, one GPU thing per Spark; with `once`, a job that reads the shared folder at `/in` and writes `jobs/<name>` at `/out`. Its operation **ends when the container starts**; the watcher tells the job's end later, as a chat line. |
| Saved workflows | `18-workflows.mjs:189`, `:240-333` (`:310`, `:315`); `21-apps.mjs:487-492` | Ordered action calls with the Sparks written in. No placement, no waiting for a job's end, nothing handed on, no clean-up. A step that needs a new image fails: steps run as `workflow`, and a new image wants the owner on the tailnet or an owner-only button. |
| Shared folder | `architecture.md` §4 and R37 | One per Spark. A step on Spark 4 can't see what a step wrote on Spark 3. |
| The model address | `15-routes.mjs:107-141`, `:164-168`, `:183-189`; `24-handler.mjs:36-47`, `:107-112`; `config.json` `main.presets` | Every running model by name; a stopped one starts on a call. Calls to the brain are capped at `--max-running-requests` minus one (the setups allow 1 or 4). A call from a Spark's own address is let in on `/v1` only and starts nothing. |
| Choosing a model | `16-actions.mjs:685-745`, `:791`; `17-changes.mjs:213-231`; `11-setups.mjs:140`, `:235`, `:258`; `09-verified.mjs:60-113` | `find_recipes` orders by the catalog's `rank`; `bestHow` takes the fastest run recorded here, else the most credible setup; each start is timed on one 256-token answer and the highest figure is kept. Nothing measures the owner's own task, compares models or records a winner. Contract 9.10, 9.11, 9.14 and 9.25 aren't built. |
| Power | no power code in `service/src`; `deploy/plugs.sh`, `power-setup.sh`, `power-check.sh`; `12-status.mjs:69-90`; `20-heal.mjs:27-37`, `:79-85`; `20-desired.mjs:74-99`, `:104` | The plug controller and its scripts are there; the service never reads or switches a plug. `energy.json` is GPU watts only. A Spark that is off reads "not answering", and anything on the desired list there is "held", with a notice. |
| A test on the real Sparks | `18-workflows.mjs:404-476`, `:545`; `deploy/host-on-portal.sh:547-549` | "Test the changes" starts, stops, restarts and stops a small model, only for workflows that need a validation run; the installer runs it. No app, no job. |
| The brain's start and switch | `13-main-model.mjs:137`, `:196`, `:265-292`; `20-heal.mjs:159`, `:175`; `24-handler.mjs:571` | One Spark, one container with Docker's restart policy, reached at `127.0.0.1`. A switch plans, stops the brain in use, then copies, pulls and starts; it keeps the new choice once it answers, else it starts the previous one again. The keeper starts `MAIN` again when Spark Console itself left it down. The switch is a page route, not an action. |
| The hub guard | `17-changes.mjs:436-441`; called at `:469`, `:644`, `21-apps.mjs:315`, `24-handler.mjs:434`, `:462`; gaps at `17-changes.mjs:194`, `:201`, `:408` | `notBrainsSpark` refuses the brain's Spark and the console's own for every named start, restart and app verb. Placement that names no Spark leaves out only `MAIN.node` (R1's "Today"); on the real fleet that is the same Spark. |

## 2. The design

Small pieces, all inside the one service, and one verdict (2.2). Everything that starts work does it through actions that exist (`start_model`, `stop_model`, `keep_running`), so the rails, claims and checks come with them.

### 2.1 The Spark list (`03-identity.mjs`, action in `17-changes.mjs`)
- **Data.** New state file `sparks.json`: `{ sparks: [{ id, name, ip, user, local, addedAt, by }] }`. `refreshNodes` reads it first; missing or unreadable, it uses `access.json`'s `nodes` as now and says so once. The first change copies the list in use into it. `access.json` is never written for this, so a bad Spark list can't touch sign-in.
- **Add.** "Add Spark 1 at 100.x.y.z." Code checks, changing nothing there: the id is `spark1` to `spark9` and free; the address is a tailnet one, not listed, not this machine; then one read-only look over `spawnOn`: sign-in without a password works, Docker answers, `nvidia-smi` lists the GPU, `python3` is there, memory and disk, and its own tailnet address matches. Then it saves. Status, library, cables and placement pick the Spark up within a minute. The answer says what it found and what is missing (no plug paired, no cable, no editor).
- **By hand, once, by the owner** (the console never does these): join it to Tailscale; on the hub, `ssh-copy-id <user>@<address>` (key and host key in one step); put the user in the `docker` group; for one model across Sparks, cable it and run NVIDIA's network setup; for power, `deploy/plugs.sh pair N` and `deploy/power-setup.sh <address>`. A look that fails names the one step that is missing.
- **Remove.** "Remove Spark 4" refuses the hub, a Spark an operation holds, and a Spark with anything on the desired list or a console container running (it names them: stop or forget first). If the Spark holds the only copy of a model, or the daily copies, it says so and offers the copy first (2.8). It changes only the list: the Spark and its record are untouched. Off is not removed: a Spark that sleeps stays on the list (2.7).
- **Gate.** At once only for the owner on their tailnet whose own words carry the Spark's number and, for add, the whole address. Anyone else, and Telegram, gets an owner-only button on the page.
- New helper `computeSparks()`: the list without `brainSparks()`. All new code places with it.

### 2.2 One model across Sparks: more than two, and the brain's own (decision 19)
- **The rule now.** An ordinary model never touches the hub: `notBrainsSpark` and the placement guard stay exactly as they are. A model across Sparks that includes Spark 2 is allowed only as the brain, through a brain switch the owner asks for.
- **Today's cables under that rule.** Sparks 2, 3 and 4 are a triangle. Ordinary model: the pair 3 + 4, as now. Brain across two: 2 + 3 or 2 + 4, with the two-Spark code that exists. Brain across three: 2 + 3 + 4, which needs the cluster code to take N members. Four needs Spark 1 cabled. NVIDIA's cluster guide says direct cables carry two or three Sparks and four need a switch (one cable from each). `docs/multi-spark.md` shows a ring of four as NVIDIA's; in a ring the two opposite Sparks share no cable, and nothing I read shows one model served that way. So: a switch for four, or a ring only after NVIDIA's four-Spark NCCL test passes on it. Without a switch, Spark 1 stays uncabled and the triangle keeps the across brain possible.
- **Reuse, not a fork.** A brain setup gains `sparks`, the hub first (it answers). `startMain` (`13-main-model.mjs:196`), given a setup with more than one Spark, calls the across-Sparks start (`clusterDeploy`, `08-cluster.mjs:324`) where it calls `mainRunCommand` today; a one-Spark setup is untouched. The across start takes four options and nothing else in it changes: the hub is allowed (from `startMain` only); the names are `sparkie-main` and `sparkie-main-part<k>`; every part carries `spark.role=main` and `spark.protect=true`; the head answers on `127.0.0.1` at the brain's port, so chat, `/v1` and the health check find it where they find the brain now, and it isn't opened on the tailnet. It gets no Docker restart policy (one part can't rejoin alone). As for any pair: only a model from Recipes, on a pinned image from a trusted source. It also brings what the brain's start lacks today: memory measured on every Spark, the cable test, the connection check and the engine check.
- **The switch** is `switchMain` (`:265`) with one change of order. Today it stops the brain, then copies and pulls. For a setup across Sparks, all that can be done while the usual brain still answers comes first: the plan and fit on every Spark (the usual brain's memory on Spark 2 counted as freed), the stops the owner approved on the other Sparks, model copies, image pulls, the cable test and the connection check. Only then: the left-down mark, stop the usual brain, the engine check, start the parts, and wait until it answers a test prompt and one chat turn that calls a tool (the installer's chat check). The saved choice in `main.json` is **not** changed: a new `away` record holds the across setup, and `MAIN` follows it, also after a console restart. "The saved brain" is always the one-Spark setup the owner chose.
- **Asking for it.** New action `brain_across`: always an owner-only button on the page, naming the model, the Sparks, what stops on each, and how long Sparkie is away. `brain_across {do: "end"}` and the owner's word `/restart sparkie` both go home: stop every part, start the saved brain. `start_model` with the hub among its Sparks is still refused, and says to use this.
- **While it runs.** The usual brain isn't loaded: Spark 2's memory is the big model's. Sparkie's chat, Telegram, agents and the model address all use the big model, with its own cap and `can` list (2.4). The other Sparks that hold a part take no new model, GPU app or job (`brainHolds(spark)`, checked beside `notBrainsSpark` on starts only, so an app kept there can still be stopped); they count as needed and never sleep (2.6); placement leaves them out. It isn't on the desired list: `watchBrain` looks after it.
- **When a part or a Spark goes down.** `watchBrain` (`20-heal.mjs:175`, each minute) acts when Docker says a part stopped, a part's Spark has been off 90 s, or the head hasn't answered its health check for 3 minutes. It doesn't try the big model again. It stops what is left, clears `away`, and starts the saved brain through the brain keeper's job (`keepBrain`, `:159`, now always the saved setup, twice in 6 hours at most). The owner is told once: a notice, and a line on the needs-you list. The big model starts again only when the owner asks.

| Case | The owner is without a brain for |
|---|---|
| The switch works | the big model's load: minutes, 45 at most (the across start's limit) |
| The parts never connect | 1 minute (the engine check) to 10 (the stall check), then the saved brain's own start |
| It fails while loading | up to 45 minutes, then the saved brain's start |
| A part or a Spark dies while it runs | 1 to 4 minutes to notice and stop the rest, then the saved brain's start |
| Going home on purpose | the stop (under a minute), then the saved brain's start |

- The saved brain's start takes a few minutes and is timed at every start. `/status`, `/restart sparkie` and `/help` answer through all of it, because code answers them (R34).
- **More than two members**, for the brain or an ordinary model, means N members in `clusterPlan`, `clusterNet`, `cableCheck`, `engineCheck`, `clusterEnv` and `clusterRunCommand`, names `-part<k>`, `sparksArg`, `pickVersion`, `dig.vetSetup`, healing and the desired list.
- **To be proven on the real Sparks, in this order.** (1) The two-Spark start's validation run on 3 + 4. (2) A brain across 2 + 3: copies and checks done while the usual brain answers, the head on `127.0.0.1` with host networking, the load time, and the way home. (3) For three: NVIDIA's three-Spark NCCL test on the triangle; a meeting address all three reach (the parts meet on the head's cable address, and each worker sees the head on a different cable); NCCL's routing by subnet; whether the pinned images do it or only community builds with NCCL built from source; and the speed. Community runs report that the fast way of splitting needs head counts that divide by three (few do), and the other way ran slower than one Spark. Four divides most models.
- **Verdict.** Build the brain across two right after (1): it needs no new cluster code and proves the switch and the way home. Build three when (3) passes and the owner names a model too big for two (over about 210 GB). Four waits for Spark 1 and a switch.
- **"Across 3 or 4" for ordinary work** is unchanged: a pipeline's steps on different Sparks (the brain for text, a pair for one big model, another Spark for a GPU job), the same job on several Sparks at once (step 11), and any cabled compute pair, which `pairOptions` already offers.

### 2.3 Pipelines (new part `21-pipelines.mjs`)
A pipeline is the smallest thing that is more than a saved workflow. It adds six things: placement when it runs, one approval for the whole plan (new images too), waiting for a job's end, results handed on, clean-up, and a record with numbers.
- **Data.** `pipelines.json`: `{ pipelines: [{ id, title, inputs, steps, approved: { fingerprint, at, by }, chosen: { <step>: { model, setup, score, seconds, tokS, wh, at } }, lastRun, running }] }`. A step is `{ id, kind, uses[], reads[], spark?, keep?, maxMinutes? }` plus, for `model`: `model` (`sparkie`, `best`, or a name as `start_model` takes), `needs` (`chat`, `vision`, `embedding`, `other`), `sparks` (1 or 2, only when the owner said); for `app` and `job`: `keep_running`'s own `image`, `port`, `volumes`, `env`, `memoryGB`, `gpu` and `command`, with its patterns.
- **Save.** Code checks every step the way its action would, does a dry placement, and shows one owner-only button listing the steps as code built them. The yes stores a fingerprint of the steps. A run may then create exactly those containers without another question; a changed step asks again.
- **Run.** One operation, `pipeline-run`. For each step in order, code places it (2.6), wakes a Spark if it must, calls the step's action through `runAction` as `workflow` (so the pause, the audit, claims, the 8 GB rule and one GPU thing per Spark all hold), and waits. A model or app step is done when its own operation is: it answers. A job step is done when its container has ended: one fixed `docker inspect` every 10 s through `run`; exit 0 goes on, anything else ends the run and names the step. A step waits 6 hours at most unless `maxMinutes` says otherwise.
- **Handing results on.** Addresses: a step that `uses` a model or app gets `SPARK_MODEL_URL`, `SPARK_MODEL_NAME` and `SPARK_MODEL_PARALLEL` (or `SPARK_<ID>_URL`) in its settings, written by code: the one address for models, the tailnet address and port for apps. Files: a job that `reads` another job runs on that job's Spark and is told its folder (`SPARK_<ID>_FILES`, under `/in/jobs/`); `reads` of a path puts it on the Spark that has that file. Numbers: a job may write `/out/result.json` (`ok`, `items`, `score` from 0 to 1); code reads it through the worker as `files` does, uses only the numbers, and shows any text as data. Between Sparks: not in the first version (step 11).
- **Stop and clean up.** The run writes what it started into `running` before each start. At the end, on a failure, on `do: "stop"` (which cancels the operation) and after a console restart, code stops in reverse order what this run started and no step marked `keep`: models with `stop_model`, apps with `keep_running` stop. What ran before the run is left alone. Each run's job containers (`<pipeline>-<step>-r<n>`, label `spark.workload`) and `jobs/` folders stay; `do: "clean"` lists this pipeline's ended containers in one owner-only button and removes only those. Files are the owner's: listed with sizes, never removed.

| The brain fills in (typed and checked) | Code decides (never the brain) |
|---|---|
| The steps and their order; images and commands (looked up when unknown); what a step needs (`needs`, `gpu`, `memoryGB`); which step uses which; the candidates to try; the words of the report | Which Spark; whether it fits; waking; names; addresses; waiting and time limits; whether a job passed; which model won; what to stop; the energy figures; what is saved |

### 2.4 The brain first (decision 13a)
- A `model` step that names no other model, needs only `chat` and fits 262,144 tokens is given `sparkie`: no start, no wake. Code checks the setup's `can` list (a new field on `main.presets`, default `["chat"]`, so any new brain states what it can do), that the brain is healthy, and that it answers at least 2 requests at once.
- **The cap.** All apps and jobs together get the brain's `--max-running-requests` minus one calls at a time: 3 with today's 4-at-once setups. Over that the caller gets 429 with `Retry-After` (R36, unchanged). A pipeline's job is told `SPARK_MODEL_PARALLEL`: the slots minus two (2 today, at least 1), which leaves a place for another app, and it must wait and try again on 429 and 503. With a 1-at-a-time setup the brain isn't used for steps. The cap keeps a place for the owner, not speed: the owner's chat slows while a job runs on the brain, and the report says how long that was.
- **Good enough** is three checks, all by code: it can (the list above); it passes (the job ends with `ok`, and in a compare no candidate beats it by the margin in 2.5); it is fast enough (a sample says the whole run fits the step's time limit at that many calls at once). A different model, a GPU job, a miss on any of the three, or the owner asking for speed sends the step to a compute Spark.
- If the brain sleeps when idle (decision 13b), a step's first call wakes it like any message.

### 2.5 Choosing what's best
- **Candidates**, by code: from `find_recipes` and the names the owner gave. Out: one that doesn't fit the compute Sparks with 8 GB to spare, has no setup that may run, or needs a download the owner didn't name. Order: on a Spark that is awake, proven here, published speed (free to read, so the Sparks only measure the top ones), less memory, fewer Sparks. The brain goes first whenever it can do the step. At most the brain and 3 more.
- **The loop**: `pipeline {do: "compare"}`, and the first run of a step whose model is `best`. For each candidate: start it with `start_model` (which finds its best setup and times it), run the job step on a sample (`SPARK_SAMPLE`, 10 items unless said), read `result.json`, the seconds and the energy, stop it. One hour in all (contract 9.25). A candidate that fails is listed with why and the loop goes on. Everything it started is stopped.
- **The winner**, by code: it passes; then the best `score`, by more than 5% and more than the spread between repeats (9.11); then the faster; then the one that used less energy. With no score, or too close to call, the owner picks from buttons that show each candidate's sample file and numbers (9.14). The winner and its numbers go in `chosen`. "Keep the best" means remember it, not leave it running.

### 2.6 Power on need, and electricity as a number
- **From the power part** (another design) this needs four calls: `power.state(id)` (`on`, `off`, `waking`, or `unknown` when no plug is paired, which behaves as today); `power.wake(id, why)` (done when SSH and Docker answer and the settle time has passed; refuses the hub); `power.wallWh(id)` (the plug's energy counter, which only rises; null without a plug) and `power.wallW(id)`.
- **To the power part** it gives `sparkNeeded(id)`, the reasons a Spark may not be shut down: an operation or claim there; a hold (`holdSpark(id, why)`, taken by a pipeline, a compare and the self-test for their whole run); anything on the desired list; any container running there, or a GPU process outside Docker; a job whose end hasn't been told yet; a model called through `/v1` in the last 30 minutes; a download or copy. An empty list means it may sleep. `doneWith(id)` drops a hold and says "it was woken only for this". Whether an idle model on the list is stopped first, so its Spark can sleep, is the power part's rule; a later call starts it again (2.7).
- **Placement order** (`placeStep`, used by pipelines and by `start_model` when no Spark is named): the brain; a model already running; an awake Spark with room and nothing to stop; an awake Spark where only Spark Console's own idle model would stop (today's rails and questions); a sleeping Spark that has the model on disk; a sleeping Spark that needs a copy. Never the hub. A Spark that is off is an empty Spark: its room is its last known memory less 8 GB, and its disk and models come from `library.json` (2.8). Once the figures below exist, the cheaper of the last four wins when both meet the time limit.
- **A change the owner asked for wakes what it needs. A read never does:** it answers from the last record and says how old that is.
- **The figures** (definitions only; the report belongs to another design):

| Figure | How it is measured | Where it is kept |
|---|---|---|
| Per Spark: `idleW`, `bootWh`, `bootSeconds`; per day `kWh`, `onHours`, `wakes` | the usual wall watts with nothing running; the counter's rise from plug-on to ready; the counter per UTC day | `energy.json`, a `wall` block beside today's GPU figure |
| Per operation: `wh` (the counter's rise on its Sparks, start to end), `whAboveIdle` (`wh` less `idleW` times the time), `wakeWh` (the boot, when it woke the Spark), `seconds`, `coverage` (how much of the time had readings), `source` (`plug`, `gpu`, `none`) | two counter reads, in `runJob` | on the operation; the journal's end line carries it |
| Per model setup: `loadW`, `whPer1kTokens` | the timed answer at each start, and compare samples | its `verified.json` entry, written by `recordVerified` |
| Per pipeline run: the sum of its steps, and the brain's share (`whAboveIdle` on the hub; GPU watts when the hub's plug isn't paired) | at the end of the run | `lastRun` |

  The estimate for a choice: an awake Spark costs its rate above idle times the time; a sleeping one costs `bootWh` plus (`idleW` plus that rate) times the time; the brain costs its rate times the time. With a figure missing, the fixed order above decides.

### 2.7 Sparks that are usually off

| What assumes a Spark is up | Where | Default |
|---|---|---|
| Status check, every 30 s | `12-status.mjs:97` | Awake Sparks only. One the console put to sleep reads "asleep", not "not answering", in `fleet_status`, the fleet notes and `/status`. Never wakes. |
| Watcher, every 60 s; library scan every fifth round | `19-watcher.mjs:256`, `:219` | Awake only. The watcher tells a job's end, so a Spark stays needed until that is told. |
| Cable test, every 10 min | `06-links.mjs:93-97` | Among awake Sparks only; a pair keeps its last result (already so, `:81-83`). A start across two tests the cable again once both are awake. |
| The daily copy of the state | `25-backup-and-start.mjs:16-18`, `:66-70` | Taken when a compute Spark is awake anyway and the last good copy is over a day old. If the state changed and no copy has landed for 3 days, wake one Spark for the few minutes it takes. The "no copy" notice waits the same 3 days. |
| Validation runs, "Test the changes" | `18-workflows.mjs:404`; `host-on-portal.sh:547` | Wake one Spark right after an install, inside the self-test (2.9). Otherwise the next real start is the validation run, as now. |
| Self-healing and "held" notices | `20-heal.mjs:204`; `20-desired.mjs:104` | Never wake. Nothing on the desired list is ever put to sleep, so "held" still means a real outage. A planned wake is marked, so crash restarts aren't paused for 30 minutes after it (`18-workflows.mjs:379`). |
| A call to `/v1` for a stopped model | `15-routes.mjs:107` | May wake one Spark, under today's limits (in Recipes, on that Spark's disk, nothing stops, 3 in 10 minutes). The caller gets 503 and `Retry-After`. |
| Model copies between Sparks | `05-library.mjs:204-207`; `07-jobs.mjs:91` | Run the work where the model already is. Wake a sleeping source for a copy only when the work must be elsewhere. |
| Live metrics, files, logs, the editor | `04-metrics.mjs:45`; the read actions | Reads never wake. `save_file` and opening an editor are the owner's own ask for that Spark: wake it. |
| The installer's reach check | `host-on-portal.sh:478-488` | Say "asleep" for a Spark its plug says is off. |
| The daily look for setups | `11-setups.mjs:258` | Needs no other Spark (the hub reads the web). Left as it is here. |

### 2.8 Storage upkeep
- **One record**, `library.json`: for each Spark and model, `{ bytes, how: "download" | "copy" | "seen", for, at, lastUsedAt, lastSeenAt }`. A job writes `how` when its download or copy ends; the watcher's library scan refreshes sizes and `lastSeenAt` while a Spark is awake. It is also how placement knows what a sleeping Spark holds.
- **Always kept:** the last copy of any model in the fleet; anything Spark Console didn't put there (`seen`); the brain's model and its draft; anything named by the desired list, a pipeline, a saved workflow, a `chosen` record, or that runs; `jobs/` folders, volumes, and containers started by hand.
- **May go by itself** (question 1): a copy Spark Console made (`copy`) while another whole copy was seen on a listed Spark in the last 30 days; an engine image Spark Console pulled that no config, recipe on disk, proven run or pipeline names and no start used for 30 days; its own kernel caches for images that are gone; a download that stopped half-way over 7 days ago with no operation on it. Least recently used first, and only as much as is needed.
- **When:** never on a timer. Before a download or copy onto a Spark (`makeRoom` keeps 60 GB or 10% free, whichever is more), and when a Spark is removed. Each removal is a job that holds the Spark's claim, checks again inside the job that nothing mounts the folder, and says what went and how much.
- **Everything else is the owner's:** `remove_copy` is always an owner-only button that names the size and says when it is the last copy. A full disk still ends with the list and a question (contract 9.12).
- **Downloads** happen only inside work the owner asked for, on a Spark that is awake for that work; the download holds it awake. One copy of a model by default, where it last ran; nothing is copied ahead to every Spark.

### 2.9 Self-test on the real Sparks
`self_test`: asked for in words ("self-test", "test the Sparks") and run by the installer in place of today's call. Never on a timer. One operation built from actions that exist; each step is run and waited on the way "Test the changes" does it (`run1` in `18-workflows.mjs`, lifted out as `stepRun`), as Spark Console itself, because its image and commands are fixed by code, not chosen by the caller.
1. Pick one compute Spark: awake, free, with a small chat model on disk (the picker in `validateChanged`). Else wake the one that holds such a model. With no plug and none awake, say so and stop. Hold it.
2. `start_model` there, stopping nothing (it must answer a test prompt, and is timed), then `stop_model`; and `restart_model` when that workflow needs its run. These carry the validation mark, so this is also "Test the changes".
3. `keep_running`: a tiny web page from one small image pinned in `config.json` (`images.selftest`, about 50 MB, pulled the first time); wait for its link; stop it.
4. `keep_running` with `once` and `gpu`: the same image runs `nvidia-smi`, writes `/out/gpu.txt`, and asks the model address for its list from inside the container (the check nobody has made yet). Wait for its end.
5. Report five plain lines (model, stop, app, job, model address from a container), each with its seconds, plus the measured speed, the energy when a plug is paired, and what was left: two stopped containers, used again next time. A step that fails doesn't stop the later ones.

It wakes at most one Spark, for about 10 to 15 minutes (30 at most), then calls `doneWith`. "Self-test all" does each compute Spark in turn.

### 2.10 The hub stays light
- Every start here goes through `start_model` or `keep_running`, which call `notBrainsSpark` first. New placement uses `computeSparks()`. Step 1 makes the three placement spots that test only `MAIN.node` use `brainSparks()`. `power.wake` and upkeep refuse the hub.
- New on the hub: three small state files, and one look every 10 s while a job step runs. Calls to the brain and to models pass through the console as they do today. No container, model, job or file store is added there, with one exception: a part of the brain's own model (2.2). More calls on the brain are the owner's decision 13(a).

### 2.11 New actions and main flows

| Action | Kind | Inputs |
|---|---|---|
| `change_sparks` | change; page only; never a step | `do`: `add` or `remove`; `spark`: `^spark[1-9]$` ("Spark 5" works); `address`: a tailnet IPv4 (add only); `user`: `^[a-z_][a-z0-9_-]{0,31}$` (optional) |
| `self_test` | change | `spark` (optional, a compute Spark); `all` (boolean) |
| `save_pipeline` | change; page only; never a step | `title` 2 to 80 characters; `when` up to 300; `inputs`: name to words; `steps`: 1 to 8, as in 2.3 |
| `pipeline` | change | `name`; `do`: `run`, `compare`, `stop`, `clean`, `forget`; `inputs`; for compare: `step`, `candidates` (1 to 3 model names), `sample` 1 to 200 |
| `remove_copy` | change; page only; never a step | `spark`; `model` |
| `brain_across` | change; page only; never a step; owner-only button always | `model`; `sparks`: 2 to 4, the hub among them; or `do`: `end` |

No new reads: `workflows` also lists pipelines with `chosen` and the last run; `fleet_status` gains each Spark's power state; `models_on_disk` gains the upkeep view. Tool counts go from 27 and 42 to 27 and 48.

- **"Do this workload."** Sparkie reads the folder, looks up what it doesn't know, and calls `save_pipeline`. The owner presses one button. `pipeline run` places, wakes, runs, waits, cleans up, and reports where each step ran, the numbers and the energy. A step marked `best` compares first and keeps the winner.
- **"Add Spark 1."** The owner does the by-hand steps, then says it. One look, one save; a minute later Sparkie can place work there.
- **After an install.** The installer asks for the self-test. One Spark wakes, proves model, app and job, validates the changed workflows, and sleeps again.

## 3. Rules it keeps, and rules that change

Kept as they are: decision 2 as decision 19 reads it, and 3, 5 and 10; R2, R9, R10, R12, R16, R21, R24, R26, R27, R35, R39, R40. Every step that changes a Spark still goes through `runAction`, a claim, a job and `run`.

Changes to `docs/architecture.md`:
- **R1:** drop the "Today" about placement that names no Spark (step 1). Add: workload steps may call the brain through `/v1`; that starts nothing on its Spark. Add the one exception: a part of the brain's own model, started only by a brain switch; while it runs, nothing else starts on any Spark that holds a part.
- **R8, R17:** every part of a brain across Sparks is the brain's container (`sparkie-main-part<k>`, role main, protected), on whichever Spark, and is never stopped by a plan or `stop_model`.
- **R14, R15:** a switch to a setup across Sparks also copies, pulls and checks the cable before it stops the brain in use; it is done when it answers a test prompt and one chat turn that calls a tool.
- **R3 and section 4, "Which Sparks exist":** the list is `sparks.json`, else `access.json`'s `nodes`; changed only by `change_sparks`, which reads a new Spark and never touches SSH, Tailscale, the firewall, users or `access.json`.
- **R11, R13:** `pipeline-run` and `self-test` hold no claim themselves (their steps do), like `workflow-run`. `change_sparks` and `save_pipeline` change only state, so no job.
- **R19, R34:** the brain keeper starts the saved setup, never the one across Sparks; a lost part sends Sparkie home with no second try; `/restart sparkie` while away goes home. Section 4, "Brain setup and routes": `main.json` gains `away` (writer `markAway`).
- **R19, R23:** a planned sleep and wake are `spark-offline` and `spark-online` carrying `planned: true`. Healing never wakes a Spark and doesn't count a planned wake as an outage. No new event type.
- **R20, R22:** new files `sparks.json` (writer `changeSparks`), `pipelines.json` (`savePipeline`, `pipelineRun`), `library.json` (`libraryPut`, `librarySeen`); `energy.json` gains a `wall` block. All through `readKept` and `writePrivate`; no secret in any.
- **R25:** own target checks. `change_sparks`: the number and the whole address in the owner's words. `pipeline` run: every word of its name, as `run_workflow`. `self_test`: the owner's "test" word is enough.
- **R32:** `change_sparks`, `save_pipeline`, `remove_copy` and `brain_across` join `PAGE_ONLY`.
- **R36:** the cap is unchanged. Add `SPARK_MODEL_PARALLEL`, and that a 1-at-a-time brain isn't used for steps.
- **R37:** add: code reads a job's `result.json` through the worker, as data. Step 11 adds one writer, `carryFolder`, between two Sparks' `jobs/` folders.
- **R38:** add the label `spark.workload`. The owner's yes to a saved pipeline is the yes for its images on later runs of the same steps. The self-test's image is fixed in `config.json`; no caller can name another. `clean` removes one pipeline's ended containers after one owner-only yes. "A stack" becomes a pipeline, since a saved workflow can't create a container.
- **Section 6:** two new rows, "a pipeline step kind" and "something that needs a Spark awake" (use `placeStep` and a hold).
- **Contract:** 9.1 "across Spark 3 and Spark 4" becomes "across any cabled pair of compute Sparks"; 9.23 one copy, not one on every Spark; 9.25 "one to three Sparks" waits for the proof in 2.2.

## 4. Build steps, in order

Each ships alone. A new action also goes in `test/lib.mjs`, the counts, the door and fuzz tables, `ACTION_KIND`, `CHANGE_WORDS` and `changeLabel`. Steps 1 and 2 change the start workflows' versions, so one lock and one live run cover both.
1. **Hub guard for unnamed placement; `computeSparks()`.** `17-changes.mjs`. Test (`change.test.mjs`): with the brain's setup on another Spark than the console's, a start that names no Spark never lands on the console's Spark. Fails today.
2. **Self-test.** `18-workflows.mjs` (`stepRun`, `selfTest`), `21-apps.mjs` (`waitJobEnd`), `24-handler.mjs` (the installer's route), `config.json`. Test (`selftest.test.mjs`): the stand-in fleet shows model, stop, app, job in order, nothing left running, nothing on the hub; with the stand-in GPU broken the job line fails and the other four still report. Fails today: no action, and nothing waits for a job.
3. **The Spark list.** `03-identity.mjs`, `17-changes.mjs`, `16-actions.mjs`. Test (`sparks.test.mjs`): add a fifth stand-in Spark and start a model on it; one that refuses sign-in is refused with the by-hand line and nothing saved; the hub, and a Spark with a desired entry, can't be removed; `access.json` is byte for byte the same; a damaged `sparks.json` falls back.
4. **Usually off: words and waits.** `12-status.mjs`, `19-watcher.mjs`, `20-desired.mjs` (`sparkNeeded`, holds), `25-backup-and-start.mjs`, `16-actions.mjs`; a stand-in for the four power calls in `test/mock`. Test (`asleep.test.mjs`): an asleep Spark reads "asleep" and raises no notice; `sparkNeeded` names a running job until its end is told; the copy is taken when a Spark wakes, and after 3 days with changes one wake is asked for.
5. **Wake for work.** `library.json` and its writers; `17-changes.mjs` (`placeStep` in `startModel`), `21-apps.mjs`, `15-routes.mjs`. Test: with one Spark awake and fitting, the sleeping one isn't woken; with the model only on the sleeping one, it is woken, waited for, and the model starts; a read never wakes. Fails today ("no online Spark has it").
6. **Pipelines: save, run, stop, clean.** New `21-pipelines.mjs`; `21-apps.mjs` (the label, the approval); `18-workflows.mjs` (`workflows` lists them). Test (`pipelines.test.mjs`): a model, a job, then a job that reads the first; the second job starts only after the first ended; a non-zero exit ends the run, names the step, and stops what the run started but not what ran before; a restart mid-run cleans up; a new image runs after the one approval, and a changed step asks again.
7. **The brain first.** `21-pipelines.mjs`, `config.json` (`can`). Test: a chat step starts no model and wakes nothing, and the job's settings carry the one address and 2 calls at once; with a 1-at-a-time setup or `needs: vision`, a compute model is placed.
8. **Compare and keep.** `21-pipelines.mjs`, `09-verified.mjs`. Test: scores 0.6 and 0.9 keep the second with its numbers; 0.80 and 0.81 give buttons; a candidate that won't start is listed and the loop goes on; the hour limit keeps the best so far; nothing is left running.
9. **Electricity figures.** `07-jobs.mjs` (`runJob`), `12-status.mjs`, `09-verified.mjs`, `placeStep`. Test: with stand-in counters an operation ends with `wh`, `whAboveIdle` and `coverage`; with no plug `source` is `none` and placement keeps the fixed order.
10. **Upkeep.** `makeRoom`, `remove_copy`. Test: a download that needs room removes only a second copy Spark Console made, never a last copy; a copy that is the owner's gives a button.
11. **Several Sparks at once.** A step's `copies`, and `carryFolder`. Test: three stand-in Sparks each take a part, and the results come back to one folder.
12. **The brain across two Sparks.** After the two-Spark start's validation run. `13-main-model.mjs` (`sparks`, `away`, the order in `switchMain`), `08-cluster.mjs` (the four options), `20-heal.mjs` (`watchBrain`, `keepBrain`), `20-words.mjs`, `17-changes.mjs` (`brainHolds`), the action. Test (`brain-across.test.mjs`): copies and checks finish before the usual brain stops; chat and `/v1` answer from the big model; a start on Spark 3 is refused, and `start_model` with the hub still is; stopping a part brings the saved brain back with one notice; a failed switch ends with the saved brain answering; the saved choice in `main.json` never changes.
13. **More than two members.** The cluster code for N, for the brain and for ordinary models. After the three-Spark proof in 2.2; four after Spark 1 and a switch.

## 5. Risks and open questions

- **A container may not reach the one address** (name lookup, or sign-in from inside Docker). Nothing proves it yet; the self-test's job checks it on its first run. If it fails, brain-first steps wait for a fix decided then.
- **Jobs on the brain slow the owner's chat** and Sparkie's own tool rounds. The cap protects a place only. The run reports the time, and a compare can move the step off the brain.
- **A job that ignores `SPARK_SAMPLE` or writes no `result.json`** is run whole for each candidate and can only be ranked by time; the hour limit bounds it.
- **Plug readings.** The plugs report energy over Matter only on newer firmware, and power may be missing, so the design asks only for the energy counter. Idle watts, boot time and what a clean shutdown leaves in Docker are guesses until the power part runs on the Sparks.
- **A wake by a call** wastes power if an app keeps asking for a stopped model; today's limits (3 in 10 minutes, none for 5 minutes after a failure) bound it.
- **A console restart mid-run** forgets its operations. The `running` record lets the next start clean up, but the run isn't resumed.
- **Up to 3 days between state copies** when every compute Spark sleeps. A second disk in the hub would end the need to wake a Spark for it.
- **Job folders and ended containers pile up** between `clean` runs; job files count toward the shared folder's limit (R37).
- **`docs/multi-spark.md` and NVIDIA's guide disagree** on four Sparks without a switch. Read on the web, not tried.
- **A brain across Sparks** puts a privileged container with host networking on the hub, can't be tried first the way an ordinary candidate brain is, and may drive Sparkie's tools badly. One tool-calling turn is checked at the switch; after that the owner's `/restart sparkie` is the way home. Every failure costs minutes without a brain (2.2).

Questions (only where a wrong guess deletes data or loosens a rule):
1. May Spark Console remove, without asking, what 2.8 lists under "may go by itself", and replace a pipeline's own ended job containers older than its last two runs? **Recommended: yes.** Until answered it removes nothing: `makeRoom` lists and asks.
2. Does one yes to a saved pipeline cover every later run of exactly those steps, new images included, from the page or Telegram? **Recommended: yes**, and an agent's run of such a pipeline still gets an owner-only button.

## 6. Left out on purpose

| Left out of the last build ("any workload") | Needed by pipelines? |
|---|---|
| A `run_job` tool | No. The `job` step kind is the typed form; `keep_running` with `once` stays for one-offs. |
| "Then do Y when the job ends" | **Yes.** It is the job wait: built in step 2, used by steps 6 and 8. |
| A model and a GPU app on one Spark | No. The brain or another Spark takes the model; a pipeline that needs more GPU things than there are compute Sparks is refused in plain words. Still waits on measuring whether `--memory` bounds GPU memory. |
| App secrets | No. Steps reach models with no key. A step that needs a token waits for the secrets store. |
| Compose and Docker networks | No. Code hands each step the addresses it needs; the one live check is in the self-test. |

- An ordinary model on the hub, in any form. A brain across Sparks that restarts itself or is tried again by itself after going home; the usual brain kept loaded beside it.
- Changing saved workflows: they stay routines on named Sparks. A script inside a step: scripts are saved with `save_file` first.
- bench-1 (9.11), recipe variants (9.1), a model that judges answers, blind picks on the phone, the render queue (9.19), budgets and project records (9.8).
- Mirroring the brain; any other work on the hub; sleeping the hub.
- The idle time, the shutdown itself, plug pairing, the owner's "wake" and "sleep" words, prices in money and the electricity report: other designs. This one names only the calls and figures it needs.
- Editor ports and tunnels for a new Spark; a page for pipelines (chat and the API only).

Web pages read for 2.2 and 2.6: docs.nvidia.com/sync/latest/cluster-assistant.html; build.nvidia.com/spark/vllm-cluster/advanced.md; forums.developer.nvidia.com/t/365296 (three Sparks without a switch) and /t/373387 (three-way split); community.home-assistant.io/t/736975 (plug energy over Matter).
