# F. Structure: easy to find your way in, and documents that stay true

Amended 2026-11-14 after the first outside review (`docs/review-astra/reply-1.md`): item 10.
Amended again the same day, for the build map's unclear items 5, 9 and 12: the names and groups of the update and compare actions (2.4).

Design only; no file under `spark-console/` was changed and no test, server or build was run. "Verified" means read in the tree on 2026-11-13, or counted there by a read-only script. "Inference" means reasoned, not run. Paths are under `spark-console/`. Pointers are by name, never by line (2.2 says why).

**In short.**
1. One front door, then small pieces: a rule per file, a card per task, generated registries. Limits are in bytes, because the map is "300 lines" and 115 KB.
2. The contract keeps the ids it has. One status table gives every rule its proof, and one checker fails when a proof, a pointer, an id or an action no longer resolves.
3. The code stays one joined file. Each part gets a standard header, a generated "who uses what", and a size ceiling.
4. The brain is offered 12 core tools and at most two groups of six: 24 at most, out of 68. Hidden is not forbidden.
5. One glossary, six registries (five made from the code), and one check of a few seconds that GitHub runs on every push.

## 1. What exists today (verified)

| Thing | What I found |
|---|---|
| Front door | `AGENTS.md`: 69 lines, 5 KB. Step 2 of its reading order is `docs/architecture.md`: 300 lines but 114,814 bytes (30,000 to 45,000 tokens, by two counts). The rule rows alone are 62 KB; R38 is one line of 7,005 characters. A brain with a 32,768-token context cannot read step 2. |
| Pointers | The map holds 223 line pointers (`16-actions.mjs:286`). Of 15 I checked by name, 13 are wrong today (`runAction`, `sparkieTurn`, `ACTION_KIND`, `startModel`, …). Of its 352 code names in backticks, 341 are in the parts; the other 11 are test, deploy and page names. Names hold; lines don't. |
| Counts typed by hand | The map says "26 reads, 15 changes" (true: 41 actions). "27 and 42" are the agent door's two lists with `ask_sparkie` added (`DOOR_READ`, `DOOR_ACT` in `test/lib.mjs`), typed as numbers in `test/change.test.mjs`. Designs A and D already give different new totals (29 and 48; 27 and 47). |
| Contract | 1,480 lines, 139 KB. It already has ids: 108 rules (`2.1` to `10.4`), 119 acceptance tests (T1 to T119, each naming its rules), O1 to O4. It has no status per id: status is spread over 228 version marks, §12, §14 and §17. §12 still says Sparkie "can't search the web" and has "no memory" (both built); §17's newest entry is 2026-11-09. §15 carries 250 lines (25 KB) of dated build notes. One comment in the whole suite cites a T id (`change.test.mjs`, T54). |
| Who wins | Three sentences disagree: the contract ("if code and this contract disagree, the code is wrong"), `AGENTS.md` ("fix the one that is wrong"), the map ("this map reports the code"). |
| Plans | Five places: contract §12, §14, §17; `docs/sparkie-actions.md` (its own build order; names five tools that don't exist); `docs/reviews-2026-11-11.md` ("Next, in order"); `docs/analysis-2026-11-11/14-trimmed-plan.md`; `REVIEW-GUIDE.md` §6. `README.md` (15 KB) is a third account of how the service works. |
| Documents checked by a test | One: `test/build.test.mjs` fails when `docs/code-map.md` (from `tools/code-map.mjs`) or `server.mjs` is stale. The code map lists the state files a part names, not who writes them, and `setInterval` timers only. |
| Hand-kept lists | `docs/agent-door.md`'s action tables miss 13 of 41 actions. `test/README.md` (49 KB) misses 7 of 47 test files. R31 to R40 sit under the heading "Shipping". |
| Code shape | 37 parts, 10,934 lines. `16-actions.mjs` is 1,109 lines and 100 KB; `17-changes` 68 KB; `24-handler` 54 KB. A rough count: 949 top-level names, none declared twice; 1,321 uses of a name from another part, over 420 pairs of parts; 262 of them reach a later part; 9 shared variables are assigned from another part (`NODES`, `agents`, `draining`, `doorOn`, …). The build id and the installer both read the one joined file (`buildOf` in `01-setup.mjs`; the `cat … cmp` line in `deploy/host-on-portal.sh`). |
| Tool list | `sparkieTools` (`14-chats.mjs`) offers every action on every owner turn; the agent door lists every action in the key's scope (`mcpDoor`). Names, descriptions and inputs are about 32,000 characters in the source (`keep_running` alone 4,462), beside a prompt of about 4,000. The eval's 24 cases name 8 of the 41 actions. `workflowVersion` (`18-workflows.mjs`) hashes an action's `run`, `input` and `description`: rewording a workflow's tool text forces a validation run; a new field on the action does not. |
| The five designs | They add 26 actions (10 lookups, 16 changes: 67 in all), 9 parts and about 12 state files. Clashes found: A and B both claim R41; B and E each add a "brain check" part and file; E expects daily journal files in the state folder, B writes monthly ones outside it; four names for "may this Spark be shut down" (`workBusy`, `sparkNeeded`, `holdSpark`, `tasksUsing`); A answers `needs-spark` where D wakes one. |

## 2. The design

### 2.1 The front door and the reading paths

**Rule: a document an agent must read fits in one read** (8 KB, about 2,000 tokens; the `files` lookup returns 8,000 characters). A bigger subject is an index plus small files. Limits are bytes, and no hand-written line passes 400 characters.

| Document | What it is for | Written | Limit |
|---|---|---|---|
| `AGENTS.md` | The front door, read first and alone: what this is; the never-break list; the layout; how to work (one command, `node tools/make.mjs`); the task table ("I want to …" → one card); "before you say done" | hand | 8 KB |
| `docs/how/<task>.md` | One card per kind of work, from the map's section 6 and a few "find out why" cards. Fixed headings: Touch, Also update, Never, Rules, Tests, Copy from | hand | 4 KB each |
| `docs/rules/R<nn>.md` | One rule per file. Fixed headings: Rule, Why, Today (where the code falls short), Where (part and names), Checked by (test file and test name) | hand; the Rule paragraph is the owner's | 8 KB each |
| `docs/rules.md` | One line per rule | generated | none |
| `docs/architecture.md` | The map only: one paragraph, the diagram, one sentence from chat to a running model, known traps | hand | 24 KB |
| `docs/contract.md` | The one plan: what the product must do (rules, acceptance tests), open choices, and the order of the next phase (§14) | hand; meaning is the owner's | 120 KB; a new rule 1,500 characters (ten are longer today and may only shrink) |
| `docs/status.md` | Every contract rule's status and proof (2.2) | hand rows, checked | 24 KB |
| `docs/glossary.md` | The words (2.5) | hand; meanings are the owner's | 8 KB |
| `docs/code-map.md` | Every part: purpose, area, what it owns, actions, rules, tests, uses, used by, functions | generated | none |
| `docs/registry.md` | The lists of 2.6 | generated | none |
| `service/guide.json` | All of the above cut by id, for the `guide` lookup | generated | 6,000 characters an answer |
| `docs/agent-door.md`, `recipes.md`, `sharing.md`, `multi-spark.md` | How one feature works, for a person. A status line; no action tables, no plan | hand | 16 KB each |
| `README.md`, `test/README.md` | What it is and where to start; how to run tests and how the stand-in fleet works | hand | 4 KB; 12 KB |
| `docs/history/` | Dated records. Never edited, never checked, never on a reading path | moved text | none |

- **Split:** `docs/architecture.md` keeps sections 1, 2, 3 and 8 (24 KB today). Section 5 becomes `docs/rules/` (text moved whole). Section 6 becomes `docs/how/`. Section 4 and the "Not drawn" paragraph become generated registries (2.6). Section 7 becomes checks (2.7), and what is left of it is `AGENTS.md`'s "before you say done".
- **Merged into the one plan:** `REVIEW-GUIDE.md` §6, the reviews' "Next, in order" and the old build orders become rows in `docs/status.md` and contract §14. No second plan document.
- **To `docs/history/`:** `docs/sparkie-actions.md`, `docs/reviews-2026-11-11.md`, `docs/analysis-2026-11-11/`, `REVIEW-GUIDE.md`, contract §15's dated notes, §17 and the version preamble; `docs/retire-portal.md` once design E has cleared Spark 2. `README.md` and `test/README.md` are cut to their limits (the test-file table moves to the registry, from each file's first comment).

**Paths** (each is the front door, one card, then only what the card names):
- *Add an action:* `AGENTS.md` → `docs/how/add-an-action.md` → R11, R25, R29 → copy from `search_web` in `21-web.mjs` → `door.test.mjs`, `fuzz.test.mjs`, the part's own test file.
- *Why did this start fail:* `AGENTS.md` → `docs/how/find-why-a-start-failed.md`: the lookups in order (`operation_log`, `recall`, `lessons`, `container_logs`, `host_look`), then `START_FAILURES` and `startWithFixes` in `17-changes.mjs`, R15, R16, `workflows.test.mjs`.
- *Change how healing works:* `AGENTS.md` → `docs/how/change-an-area.md` → the code map's area index → the `20-heal.mjs` entry (rules R19 and R21, `heal-tries.json`, the heal test files, uses and used by) → the contract rules 6.9 to 6.13 with their status rows.

**In chat, the same door is one lookup: `guide`** (new; a read; in the core group of 2.4). `guide {}` returns the front door. `guide {rule: "R38"}`, `{req: "6.11"}` (text, status, proof), `{how: "add-an-action"}`, `{word: "pipeline"}`, `{part: "20-heal"}` and `{tools: "dig"}` return one piece each. It reads `service/guide.json`, shipped with the build as a service file outside the build id. Today Sparkie cannot read its own rules at all: the documents are not in any shared folder. This is the console's own half of contract 6.19. The text is the app's own, like the `workflows` lookup; it authorizes nothing, since the change gate reads only the owner's words (R25).

### 2.2 The contract, kept aligned always

1. **Ids.** Keep the 108 rule ids, T1 to T119 and O1 to O4. An id is never reused or renumbered. A withdrawn rule keeps its number and one line saying when. New rules take the next number in their section; new tests start at T120.
2. **One status table, `docs/status.md`:** one row per rule id: `id | status | proof | note`. Four statuses: `built`, `partly` (the note says what is missing), `not built`, `left out` (the owner's decision and its date). A proof is `test/<file>.test.mjs: "<part of the test's name>"`. `built` needs one. The first fill is honest: a built rule that no test names is `partly`.
3. **The contract states each rule once, as it must hold now.** The 228 marks go. §12 becomes three lines that point at `docs/status.md`. §17, §15's notes and the version preamble move to history. §14 holds only the next phase.
4. **Pointers are names, not line numbers.** A pointer is `` `16-actions.mjs` (`runAction`, `sparkieCheck`) `` or a test file with part of a test's name. The checker fails on any `.mjs:<number>` in a hand-written document, and on a name that is not a top-level name (or action) in the part it is given with.
5. **The checker, `tools/check-docs.mjs`** (file reads only; the list is in 2.7). It fails when: a rule id has no status row, or two; a `built` or `partly` proof names a test that is gone, skipped or marked to-do; an R, contract or T id cited anywhere (documents, parts, tests) is not defined; a named part, function, test or document is gone; an action named in a hand-written document does not exist; a generated document is stale (so every action in code is in the documents).
6. **Lists leave the rules.** A rule states what must hold; the list lives in a registry made from the code. R20 and R22 stop naming files and writers, R29 stops naming counts, R32 stops naming the page-only actions. Designs B, C, D and E then declare their files in their own part's header instead of all editing R22.

**Mechanical edits** (any agent, no question): a status row moved toward what its proof shows; a pointer fixed after a rename; generated files; a rule file's Today, Where and Checked by; moving text into `docs/history/` once the owner has approved the move list; spelling.
**The owner's word:** adding, removing or rewording a contract rule or acceptance test; a rule file's Rule paragraph; a glossary meaning; setting `left out`; any change to the checker, the limits or `service/hub.json`.
Code tells the two apart: `check-docs --meaning <base>` prints the ids whose meaning text differs between two trees. Design C's proposal button shows that list, and C's protected paths become: the contract, `docs/rules/`, `docs/glossary.md`, `AGENTS.md`, the checker, `service/hub.json`.

**How the next phase goes in** (no new layer): each design's changed rules are rewritten in place and its new rules appended with new ids, in the present tense, with a `not built` row. When a step ships, only its row changes.

| Design | Contract rules it rewrites or adds to | Map rules whose text changes (their list edits become header lines and registry rows) |
|---|---|---|
| A workspace | 6.6, 8.5; T16, T18 | new R41; one line each in R9, R11, R13, R26, R37, R38 |
| B learning | 5.8, 5.10, 6.9 to 6.11; T23, T24 | new R42 (B called it R41); R18, R26 |
| C GitHub and self-change | 6.3, 6.15, 6.16; 8.11 and 8.13 (the Keeper) become `left out` | R29, R30, R31 |
| D fleet and pipelines | 9.1, 9.10, 9.11, 9.13, 9.14, 9.22, 9.23, 9.25 | R1, R3, R19, R23, R25, R36, R37, R38 |
| E unattended | 3.1, 3.3, 4.7, 4.8, 9.15; 9.16 (schedules) becomes `left out` by decision 5 | R4, R7, R19, R23, R30, R31, R32, R36, R38 |
| F this design | the preamble, §12, §14, §15, §17; 6.19 | new R43; R20, R22, R28, R29 |

A new map rule takes the next free number when it merges (R41 the workspace, R42 learning, R43 documents and parts). An addition that would push a rule file past 8 KB becomes a new rule, so R38 stops growing.

### 2.3 The code's shape

| Path | Cost | Risk to the gate | Verdict |
|---|---|---|---|
| (a) Keep one joined file; add a standard header and a generated "who uses what" | About a day. Comments only | The build id changes (one gate run). Workflow versions don't: `workflowVersion` hashes function text, and a header sits outside every function (inference; prove it by comparing the lock's versions before and after) | **Yes** |
| (b) Folders by area | The part filter in `build-server.mjs`, the installer's glob, the third build-id copy in `fleet.test.mjs`, design C's test groups, every pointer | A wrong glob makes the installer refuse a good build or miss a part | No. The number band and an `Area:` line give the grouping |
| (c) Real modules with imports | About 1,300 imported names; cycles (262 uses reach a later part); setters for 9 shared variables; a new build id, installer, snapshot and rollback shape. Setters change the text of the functions that assign those variables, which can change workflow versions (a validation run on the real Sparks) | It touches every part at once and cannot ship in small steps | No. (a) gives the same knowledge for a day's work |

**The header** (read by the generator; a part without one fails the check):
```
/* ───────── pipelines: a saved plan of steps, placed when it runs ───────── */
// Area: workloads        Rules: R1, R38         Tests: pipelines.test.mjs
// Owns: pipelines.json (writers: savePipeline, pipelineRun)
// Timers: none           Wakes: a compute Spark, only inside pipeline-run
```
Declared by hand: area, rules, tests, state files with their writers, timers, what it may wake. Made from the code: actions, functions, lines, and **uses / used by** (a name counts as used when it is a top-level name of exactly one other part). The checker compares what it can: the tests and rules exist; the functions that write a state file are exactly the declared writers; every repeating timer is declared.

**Numbering and naming.** The two digits are a band, and they set load order only:
- 01–09 ground (setup, SSH, identity, library, jobs); no actions.
- 10–15 knowledge and the brain.
- 16–19 the action core (registry, gate, changes, workflows, watcher).
- 20 record and safety, called by the core (desired, heal, memory, needs, tell; new: `20-journal`, `20-lessons`, `20-tasks`, `20-beat`).
- 21 features with their own actions (apps, web, Telegram; new: `21-work`, `21-pipelines`, `21-updates`, `21-brain-check`, `21-brain-trial`).
- 22–24 ways in. 25 start-up, always last.

A part's name is one glossary word, and the same word names its state file, its actions and its test file (`21-work.mjs`, `work.json`, `work_*`, `work.test.mjs`). A number is never picked to sit beside a related part: E's brain check goes in band 21, not 13.

**Size.** A new part is at most 400 lines and 40 KB. The eight parts over that today get a ceiling at their present size, which may only go down; new code for them goes in a new part. `16-actions.mjs` is split first, into `16-actions.mjs` (registry, inputs, the gate, `runAction`) and `16-reads.mjs` (the lookups), because every design adds to it. Moving whole functions between parts changes no behaviour: the proof is the full suite with no test edited and the same workflow versions in the lock.

### 2.4 The brain's tool list

Evidence (web): OpenAI's function-calling guide says "aim for fewer than 20 functions available at the start of a turn", as a soft figure. One six-model test saw choice get worse between 25 and 50 tools; it tested hosted models only. I found no measured figure for a local 27B model, so the cap is a setting that the brain trial measures.

- **Every action has one `group`** (a new field on the action; not part of any workflow version). The checker fails on an action with none.
- **Core, always offered (12):** `fleet_status`, `running_models`, `workloads`, `should_be_running`, `sparkie_setup`, `start_model`, `stop_model`, `restart_model`, `keep_running`, `remember`, `search_web`, `guide`. These are the eight actions the eval uses today, the two the prompt tells the brain to use unasked (remember what the owner says; look up what is new), restart, and the guide.
- **Eleven groups of at most six** (a first cut; the invariants are tested, the membership is tuned by the eval):

| Group | Actions | Opened by code when |
|---|---|---|
| `find` | `find_recipes`, `recipe_detail`, `search_huggingface`, `models_on_disk`, `where_it_fits`, `find_setups` | the words ask which model, or what fits |
| `sparks` | `deploy_plan`, `cluster_plan`, `linked_sparks`, `spark_detail`, `change_sparks`, `remove_copy` | the words are about a Spark, a cable, disk or a plan |
| `dig` | `operation_log`, `recent_operations`, `container_logs`, `service_logs`, `spark_diagnostics`, `host_look` | the words ask why; or this chat's last operation failed |
| `past` | `fleet_events`, `recall`, `lessons`, `learn`, `forget_lesson`, `report` | the words ask what happened, or what was learned |
| `reading` | `read_page`, `whats_new`, `files`, `save_file` | this turn called `search_web`; the words name a page or a file |
| `work` | `workspace`, `work_run`, `work_read`, `work_write`, `work_edit` | A's work words; the four `work_*` only while a workspace is open |
| `routines` | `workflows`, `save_workflow`, `run_workflow`, `forget_workflow`, `save_pipeline`, `pipeline` | the words name a workflow, a pipeline or a workload |
| `control` | `cancel_operation`, `undo_last_change`, `wait_operation`, `start_task`, `stop_task`, `tasks` | an operation or task of this chat is running; cancel, undo or task words |
| `memory` | `memory`, `forget_memory`, `app_keys` | the words ask what is remembered, to forget, or about keys |
| `updates`, `checks` | `check_update`, `install_update`, `undo_update`, `propose_update`, `update_status`; `self_test`, `test_changes`, `try_brain` | update words; test words |

- **Names and groups settled on 2026-11-14.** The table above is the first cut, and it names actions that are cut. R46 holds the table as built. Three things are settled for the steps still to come:
  - `updates` holds `check_update`, `install_update` (design C, step 5) and `propose_update` (C, step 8): three of six seats. There is no `update_status` and no `change_*`: `check_update` also answers for the open proposal (C 2.5). `undo_update` stays in `control`, beside `undo_last_change` (R46).
  - `compare_models` goes in `routines`, its fifth seat (design D, 2.5). There is no `save_pipeline`, `pipeline` or `remove_copy`.
  - `test_changes` stays in `checks` until the owner answers whether the self-test replaces it (design D, 2.9).
- **The cap: 24 a round** (core and two groups; today every round carries 41). `TOOL_CAP` is one constant; a brain's setup may lower it. The list is built each round (design A needs that already). One table, `GROUP_WORDS`, beside `CHANGE_WORDS`, opens groups from the owner's words; state opens `work`, `control`, `dig` and `reading`. With a third group, the oldest one opened by words closes. Groups last for the request and its carry-on turns.
- **Hidden is not forbidden.** A call to an action that exists but was not offered runs through `runAction` as always and opens its group. Permission stays where it is: `runAction`, `PAGE_ONLY`, the gates. So nothing that works today can stop working; a wrong guess by the word table costs one round. A test proves it for the three calls a stuck owner needs: `undo_last_change`, `cancel_operation` and `undo_update` each run when they were not offered. Two eval cases need tools from three groups, so the cap's cost shows in the eval.
- **Prompt lines follow the tools.** A line that names a tool belongs to that tool's group and is sent only with it. The core prompt stays under 2,500 characters and names only core tools.
- **Discovering the rest.** `guide`'s description lists the group names with a few words each. `guide {tools: "dig"}` returns that group's tools and opens it.
- **At the agent door** nothing is hidden: `tools/list` shows every action in the key's scope, as today. The agent's instructions gain one line, "call `guide` first", and `GET /actions` gains `group`. An agent talking through `ask_sparkie` gets Sparkie's groups.
- **Not done:** shortening today's tool descriptions. The five workflow actions' text is part of their version.

### 2.5 One vocabulary

`docs/glossary.md`: word, meaning, name in code, and what not to say. The documents, the prompt, action titles and descriptions, and the page use the word; the code keeps its name where a rename would cost a validation run.

| Word | Means | In code | Don't say |
|---|---|---|---|
| hub | The Spark that runs the console and the brain. Spark 2 today | `brainSparks()` | portal host; "Spark 2" for the role |
| compute Spark | Every other Spark on the list | `computeSparks()` (D's new helper) | "Spark 3 or 4" for the role |
| workload | Anything that runs on a Spark: a model, an app, a job. What `workloads` lists | `knowledge.workloads` | workload for a pipeline |
| app; dev box | A container that isn't a model and is kept running; an app that is an editor or notebook | `keep_running`, `spark.app=1` | service |
| job | A container that runs once to its end | `once`, `spark.job=1` | job for an operation |
| operation | Long work the console tracks and posts a result for | `newJob`, `runJob` (the code says job) | task |
| workflow | A tested, versioned change in code (five today) | `WORKFLOWS` | "every change is a workflow" |
| saved workflow | The owner's ordered action calls on named Sparks | `saved-workflows.json` | routine, stack |
| pipeline | A saved plan of steps, placed and waited on when it runs. The owner's "do this workload" | `pipelines.json`, label `spark.pipeline` (not D's `spark.workload`) | workload |
| shared folder | The one folder per Spark that files and jobs use | `sharedFolder` (the path says `workspaces/shared`) | workspace |
| workspace; work box | A named work folder on a compute Spark; the throwaway container one command runs in | `work.json`, `workBoxCommand`, `spark.work` | box alone; sandbox |
| carry-on | Sparkie continuing one request after its operations end | `conv.task` today | task |
| task | A goal with done checks and a budget that outlives a message (E) | `tasks.json`, `tk_…` | work queue; A's "task" and "task card" (say carry-on, work summary) |
| memory | The owner's own words, 40 lines | `memory.json` | memory for lessons |
| journal; lesson; note; card | Everything that happened; a typed fact code drew from it; one line Sparkie wrote, never applied; one lesson as a line for the brain | `journal()`, `lessons.json` | skill, learned fix (say shipped fix for one in the repo) |
| proven run | A start that answered its test prompt, as recorded | `verified.json` | verified |
| asleep | Powered down or paused on purpose; wakes by itself when needed. For a Spark and for the brain (nap: paused in memory; full sleep: stopped) | D's `planned: true`; E's mark, named `asleep`, not `resting` | off, dark, resting; paused for a nap |
| not answering; down | Should be on and isn't: an outage | `spark-offline` without `planned` | offline, in words the owner reads |
| held | On the should-run list, not running, and not coming back by itself | `desiredNow` | D's `holdSpark` (say keep awake: `keepAwake`) |
| needed | Why a Spark may not be shut down. One function for A, D and E | `sparkNeeded(id)` | `workBusy`, `tasksUsing` |
| paused | Agents' changes are stopped, by the owner or the breaker | `agent-settings.json` | paused for anything else |
| tested; validated | The whole suite passed for this tree; one real run passed on the Sparks | the lock; `validations.json` | verified |
| brain check; brain trial | E's three-minute probe that sets a brain's grade; B's comparison of a candidate with the brain in use | `21-brain-check.mjs`; `21-brain-trial.mjs`, `brain-trials.json` | two things called brain check |
| update; proposed update | A new build installed; a change Sparkie offers as a pull request | `install_update`; `propose_update` (not C's `change_…`: change is a kind of action). No `update_status`: `check_update` answers for it (settled 2026-11-14, C 2.5) | change for a code change |
| agent door; app door | `/mcp`; port 10000 | `mcpDoor`; `doorHandler` | the door |

What checks it: each row may carry a pattern; the checker fails when a "don't say" pattern is found in a hand-written document outside history, in an action's title or description, or in a prompt line, and when an "in code" name is not in the code. Two things for the other designers to settle, since they are rules and not words: the journal's place (B's wins: outside the state folder, monthly), and whether an owner's request for a workspace wakes a Spark (D's rule says yes).

### 2.6 The registries

All are sections of the generated `docs/registry.md`, made by the code-map tool from the parts and their headers, and served by `guide`.

| Registry | Today | Missing | Made from, and checked by |
|---|---|---|---|
| Actions | Name, kind, title, part (code map); the two hand lists in `test/lib.mjs` | Group; page-only; may be a saved step; inside or outside text; the change kinds it answers to; its test file | The registry and the tables `ACTION_KIND`, `PAGE_ONLY`, `NOT_A_STEP`, `INSIDE_READS`, read as text. `test/lib.mjs` stays as the second, hand-typed entry; the typed numbers go |
| State files and their writers | The map's section 4, R20 and R22, all by hand | A checked writer; whether it rides in the daily copy; whether `readKept` reads it | Each part's `Owns:` line, against the functions that really write the file. A writer nobody declared fails |
| Timers, and what may wake | The map's "Not drawn" paragraph; `setInterval` names in the code map | Period; what each may wake | `Timers:` and `Wakes:` lines. A wake takes a reason from one closed list in code (owner asked, task, pipeline, a call to `/v1`, self-test, state copy), and no timer function is on it. D's "nothing wakes by itself" test is the live proof |
| Events and operation types | `EVENT_TYPES` (12); 14 `newJob` types, repeated by hand in six places | Who emits each; which hold a claim | A scan of `fleetEvent` and `newJob`. An emitted type that is not listed fails |
| Limits | A paragraph in section 6, and numbers inside rules | One list | Named constants with a `// limit:` comment. Rules name the constant, not the number |
| What runs on the hub | Nowhere as a list | Units, containers, ports and folders allowed on Spark 2 | `service/hub.json`, the one hand-kept list, because it states intent (decision 3). Checked two ways: every unit and folder the installer makes is on it; and a read-only look at start and in the self-test puts "Spark 2 runs something that is not on its list" on the needs-you list |

### 2.7 The checks

`node tools/make.mjs` is the one command: rebuild `server.mjs`, regenerate the four generated files, run the checker. `--check` changes nothing.

| # | Check | Reads | The drift it catches |
|---|---|---|---|
| 1 | Built and generated files are current | parts, generated files | A part edited with no rebuild; an action in code but not in the documents |
| 2 | Sizes | documents, parts | A document or part past its limit; a 7,000-character line |
| 3 | Pointers resolve; no line numbers | hand-written documents, comments in parts and tests | A renamed function, a deleted test, a rule or contract id that is gone |
| 4 | Status | contract, `docs/status.md`, test files | A "built" rule with no living test; a rule with no row; a version mark |
| 5 | Actions | parts, documents, `test/lib.mjs` | A document naming a tool that isn't there; an action with no group; a group over six; core over twelve |
| 6 | Headers | parts | A new state-file writer, timer or wake nobody declared; a part outside its band |
| 7 | Glossary | documents, titles, descriptions, prompt lines | An old or clashing word coming back |
| 8 | Hub list | `service/hub.json`, the installer | Something new installed on Spark 2 without saying so |
| 9 | Front door | `AGENTS.md`, `docs/how/` | A card that isn't on the task table, or a row with no card |
| 10 | Tool list | a running stand-in console | More tools offered than the cap; the wrong group for a request; a hidden action refused |
| 11 | `guide` | a running stand-in console | A rule, requirement, card, word or part it cannot return, or an answer over 6,000 characters |
| 12 | Hub look | the stand-in hub with an extra unit | The needs line not appearing |
| 13 | Meaning diff | two trees | A contract rule, a Rule paragraph or a glossary meaning changed without the owner seeing it |

- **The quick job** (GitHub, every push): checks 1 to 9, as `node tools/make.mjs --check`. No server and a few seconds, so it runs first inside design C's `quick` job and adds no billed minute. A push that touches only documents runs it too (C skips the tests for those).
- **In the suite**, so the lock covers them: checks 1 to 9 again as `test/docs.test.mjs` (the same code, called from a test), and 10 to 12 in `test/tools.test.mjs`, `test/guide.test.mjs` and `needs.test.mjs`.
- **On pull requests:** check 13, shown on the owner's button (design C).
- **In the brain trial, not the lock:** one eval case per tool group, and one that answers from `guide`.

## 3. Rules it keeps, and what must change

Kept: what every existing rule requires. R18 (no workflow version changes in any step here), R25 and R26 (`guide` text and tool groups authorize nothing), R28's "edit parts, never `server.mjs`", R30 (the installer's file lists gain `guide.json` and `hub.json`).

Must change:
- **R28:** add the bands, the header, the ceilings, and "one word names the part, its state file, its actions and its test file".
- **R20, R22:** keep the invariant; the lists of files and writers move to the registry.
- **R29:** "every action is in `TOOLS` or `CHANGE_TOOLS`" gains "and has one group"; the counts are no longer typed anywhere.
- **New R43, documents and parts:** the limits of 2.1, pointers by name, the status table, generated files never edited by hand, and "a change is not done until `node tools/make.mjs --check` passes".
- **The map's section 6 "An action"** becomes `docs/how/add-an-action.md`, and gains "give it a group".
- **`AGENTS.md`:** the reading order becomes "this page, then one card" (items 2 to 5 go). Step 2 becomes `node tools/make.mjs`. Step 5's "tool counts" goes. Step 6 becomes "update the rule file, the part's header and the status row". Add one sentence on who wins, and delete the other two: *the contract says what must be true; the rules say how; code that falls short is recorded as a `partly` row or a Today line, never fixed by quietly editing either.*
- **`test/change.test.mjs`:** the literals 27 and 42 become the lengths of `DOOR_READ` and `DOOR_ACT`. This edits an existing test without weakening it: the exact name-by-name comparison beside each literal stays.

## 4. Build steps, in order

**P** marks a step that should come before any feature work. Each ships alone.

| # | Step | Files | The test that fails without it |
|---|---|---|---|
| 1 P | The checker with its first checks: ids resolve; named parts and tests exist; no document names an action that doesn't exist. Old plans go to history | new `tools/check-docs.mjs`, `test/docs.test.mjs`; move `docs/sparkie-actions.md`, the reviews, the analysis folder and `REVIEW-GUIDE.md`; `AGENTS.md` | `docs/sparkie-actions.md` names `propose_start` and four more tools that don't exist |
| 2 P | Names, not line numbers, in the map | `docs/architecture.md`, the checker | 223 line pointers match the forbidden pattern |
| 3 P | Counts no longer typed | `test/change.test.mjs`, `docs/architecture.md`, the checker | The map says "26 reads, 15 changes"; the check refuses a typed count of actions, parts or rules |
| 4 P | Rules, cards and limits: one file per rule, one card per task, the generated index, the size check | `docs/rules/`, `docs/how/`, `docs/rules.md`, `docs/architecture.md`, `AGENTS.md`, new `tools/make.mjs` | The map is 115 KB against 24; a script shows the 40 rule texts are byte for byte the same after the move |
| 5 P | Headers, who uses what, the registries | every part (comments), `tools/code-map.mjs`, new `docs/registry.md`; R20 and R22 shortened | A part with no header; `desired.json`'s six writers are found and must be declared |
| 6 P | Ceilings, and `16-actions.mjs` split in two (one gate run together with step 5) | `16-actions.mjs`, new `16-reads.mjs`, the checker | A new part over 400 lines; `16-actions.mjs` over its new ceiling. The lock's workflow versions are unchanged |
| 7 P | The contract made flat, and the status table (the owner approves the move list; no rule's words change) | `docs/contract.md`, new `docs/status.md`, `docs/history/` | A rule id with no row; a `built` row with no test; a version mark still in the contract |
| 8 P | The next phase written into the contract (the owner's word, once, on the list of changed rules) | `docs/contract.md`, `docs/status.md` | Every new rule id has a `not built` row |
| 9 P | The glossary, and the renames in designs A to E before their code exists | new `docs/glossary.md`, the checker; `README.md` and `test/README.md` cut down | A "don't say" word in a document, a title or a prompt line |
| 10 | Tool groups and the cap; before the first design adds a tool | `14-chats.mjs`, `16-actions.mjs` and later parts (`group`), `test/lib.mjs`, new `test/tools.test.mjs`, `test/eval/cases.json` (two cases that need tools from three groups) | The stand-in brain is sent 41 tools today; a "why did it fail" request must list core and `dig` only; an `undo_last_change`, `cancel_operation` or `undo_update` call that was not offered still runs |
| 11 | `guide`; before design C's self-change | new `service/guide.json`, a small part `21-guide.mjs`, the installer's file list, new `test/guide.test.mjs` | `guide {rule: "R38"}` returns the rule; nothing returns it today |
| 12 | The hub list; with design E's clearing of Spark 2 | new `service/hub.json`, `20-needs.mjs`, the checker | A stand-in hub with an extra unit gives one needs line |
| 13 | The quick job and the meaning diff; with design C's steps 1 and 8 | `.github/workflows/full-run.yml`, the checker | A push that changes a Rule paragraph is listed by id |

## 5. Risks, and open questions

- **The move itself changes a meaning.** Steps 4 and 7 move text; they do not rewrite it. A script proves the rule texts equal, and the owner sees the list of what moved.
- **An agent quiets a check instead of fixing the cause** (flips a row to `partly`, deletes a pointer). Every such edit shows in the meaning diff or the status diff on the owner's button, and the checker itself is a protected path.
- **The word table hides the right tool.** Cost: one extra round. Whether the brain's server lets a model call a function that was not in its list is not verified; if it does not, `guide {tools}` is the way, and a setup can raise its cap.
- **Reading code with patterns, not a parser.** Odd code could be misread. The scanner fails closed ("can't tell who writes X: declare it"), and top-level names start at column 0, as they do today.
- **Generated files clash between branches** while five designs are built. They are never merged by hand: `make` rebuilds them, and the quick job refuses a stale one.
- **Steps 5 and 6 change the build id**, so they need one full gate run. That workflow versions stay the same is inference until the lock is compared.
- **The first status table will show many `partly` rows.** That is the present truth, not a failure.

Defaults chosen without asking (decision 16): one file per rule; bytes, not lines; names, not line numbers; hand-typed tool lists kept as the second entry; the door hides nothing; a cap of 24; B's journal place and D's wake rule win the two clashes.

Questions, because the contract's meaning is the owner's:
1. **May the contract be made flat** (marks removed; §12 a pointer; §15's notes, §17 and the version history moved to `docs/history/`; status only in `docs/status.md`), with no rule's words changed in that step? Recommended: yes.
2. **Rules the decisions of 2026-11-13 replaced** (the Keeper, 8.11 and 8.13; git on Spark 2 and nightly commits of memory, 6.15 and 6.16; "any command on any Spark", 6.6; the brain "always on", 3.1; schedules, 9.16): rewrite them in place to the new decision, with the old words in history, or keep the old text marked `left out`? Recommended: rewrite where a decision replaces the rule; `left out` only where nothing replaces it (8.11, 8.13, 9.16).
3. **May Sparkie make the mechanical edits of 2.2 in its own proposed updates without the passkey**, while every meaning edit needs it? Recommended: yes. It keeps documents true without a passkey tap for each status row, and tightens what counts as a protected change.

## 6. Left out on purpose

- Real modules, folders for parts, types, a parser, or any npm package.
- Moving the per-action tables (`ACTION_KIND`, `PAGE_ONLY`, `NOT_A_STEP`, `INSIDE_READS`) onto the actions: it rewrites the gate for no new behaviour. The registry shows them side by side instead.
- Renaming code that works (`job` for operation, `conv.task`, the `spark-portal` folder name): the glossary records the code's name.
- Renumbering rules or contract ids; a status row for each acceptance test; mapping every T test to an automated test.
- Checking numbers written in prose against the code; a registry of the 48 test switches; checking web links.
- A documents site, a search index or embeddings over the documents: `guide` finds by id and by word.
- Hiding tools at the agent door, or any tool-search tool beyond `guide`.
- Sparkie rewriting documents by itself; a second plan document; a decision-record format (history holds dated records as they are).

Web pages read for 2.4: developers.openai.com/api/docs/guides/function-calling; dev.to/craigtracey/we-gave-llms-150-tools-heres-what-broke-2jaj. For 2.1, search results only (write-ups of a study of agent context files that favour short files and task cards; the paper itself not read).
