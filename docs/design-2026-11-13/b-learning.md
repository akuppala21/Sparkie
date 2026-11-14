# B. Learn from everything, and a brain that can be swapped

Amended 2026-11-14 after the first outside review (`docs/review-astra/reply-1.md`): P-2; item 11; clean-up 1.

Design only; no code was changed. Covers gap 5 and decisions 8, 9, 13 to 16. "Verified" means read in the code on 2026-11-13.

## 1. What exists today

| What | Where (verified) | What it keeps, and what it misses |
|---|---|---|
| Fleet events | `19-watcher.mjs:27-35` `fleetEvent`; `07-jobs.mjs:13, 81-82` | Last 500 in memory; `events.jsonl` rotates at 5 MB, one old file. An operation's end keeps its error cut to 300 characters. |
| Audit lines | `20-mcp.mjs:126-140` `audit`; `16-actions.mjs:447, 452` | One line per change through `runAction`, arguments masked. Lookups return at `16-actions.mjs:353` before any line. Nothing in the service reads the file. |
| Operations | `07-jobs.mjs:2-24` | In memory only: the last 50, each log's last 300 lines. After a restart `operation_log` says "expired" (`16-actions.mjs:895-896`). |
| Tool calls in a chat | `14-chats.mjs:412-420` | The saved message keeps name, ok, time, outcome. Arguments and results go to the model and are gone. |
| Watcher's knowledge | `19-watcher.mjs:109-127, 202-218, 250` | How each container was started (400 rows). A hand-started model server becomes a candidate recipe that nothing offers. |
| Proven setups | `09-verified.mjs:91-114` `recordVerified` | Successes only: model, engine, image, Spark count, flags, runs, best speed. Written and replayed with no button. |
| Known failures and fixes | `17-changes.mjs:243-287` `START_FAILURES` (9), `:322-354` `startWithFixes` | Each start begins with no fix. What worked last time is only on `job.fixed` (`:331`) and in the lost log. |
| Memory | `20-memory.mjs:10, 83-96`; system prompt (`14-chats.mjs:73`) | 40 lines, 4,000 characters, the owner's words only. |
| Saved workflows | `18-workflows.mjs:144-158, 239-272` | Saved when the owner asks. The prompt asks the model to offer it (`14-chats.mjs:62`): a habit, not code. |
| Embeddings | `15-routes.mjs:142-144, 163-189` | `/v1/embeddings` is passed to whatever model the call names. The console has no embedding model. |
| Brain setups | `service/config.json` `main.presets`; `14-chats.mjs:232, 325-329`; `13-main-model.mjs:265-293` | Four, all Qwen 3.8 27B on SGLang. Switching falls back by itself. |
| Brain checks | `test/eval.mjs` (24 cases, bar at `:138`), `tools/brain-load.mjs`, `agentbar/` | Three tools run by hand. The eval saves a results file; nothing compares two brains or gives one verdict. |
| Contract | 5.10, 6.10, 6.11, tests T23, T24 | Skills, problem records and learned fixes are written down, not built (lines 1041, 1122). |

So: no output survives a restart, nothing is written from Sparkie's own runs, and nothing is looked up before a plan. A start that needed a fix yesterday fails the same way first today.

## 2. The design

One service, no new process, no database, no schedule. A **journal** (everything, append-only), **lessons** (short typed facts drawn from it), a **learn pass** (after work, before sleep), and **look-up** (code uses lessons itself and shows the brain the few that matter). All of it behaves the same whichever model is the brain.

### 2.1 The journal: a new store, written where things already pass

A new store, because nothing kept today holds outputs. The old stores stay (healing and the gates read them).

- **Home:** `~/.local/share/spark-console/journal/` on Spark 2 (0700; files 0600), outside the state folder, which is tarred whole every day and into every install snapshot (`25-backup-and-start.mjs:24`). Never in the repo.
- **Files:** two per month. `journal-2026-11.jsonl`: one short line per record, 1,500 bytes at most. `journal-2026-11.out`: the long text (a log, an output, a tool result). A record's long text is kept whole. It is written to the `.out` file in pieces as it arrives and never held whole in memory. Each piece is masked before it is written, with an overlap so a key that falls across two pieces is still caught. Past 16 MB (a default) reading stops, the command is ended, and the record says so. The digest's size is a separate number.
- **One writer:** `journal(kind, fields, body)` in a new part `20-journal.mjs`. It masks first (`maskDeep`, `maskSecrets`, before the cut, as `audit` does), appends and returns the id. It never throws for a look, a result or an event. For the start line of a change it syncs the file and returns nothing on failure, and the caller then runs nothing. At start-up a start line with no end is marked cut off once: one notice in the chat that asked and one needs-you line.
- **A record:** `{id:"j_<12 hex>", at, k, chat, turn, op, via, actor, brain, act, args, ok, outcome, err, ms, sub:[…], o:[offset,length]}`. `sub` holds the names it is about (model, engine, Spark, container, failure id), for search.

| `k` | Written at (existing code) | Holds |
|---|---|---|
| `said` | `sparkieTurn`, where the message is saved masked (`14-chats.mjs:259`) | The owner's words, the channel |
| `tool` | `runOne` (`14-chats.mjs:394-424`) | Each tool call of a turn; its result as the body |
| `call` | `runAction`, beside `audit`; lookups too when an agent, the API or a workflow step asks | Action, arguments, outcome, error. The owner's corrections are these: `remember`, `forget_memory`, `undo_last_change` |
| `attempt` | `startWithFixes` catch (`17-changes.mjs:335-352`) | Attempt number, failure id or `unknown`, the fix tried next |
| `op` | `runJob` finally (`07-jobs.mjs:71-83`) | The operation's end, `fixed`, speed; its whole log as the body |
| `cmd` | The command runner of gap 1 calls `journal` itself | Spark, command, exit code; output as the body |
| `event` | `fleetEvent` | A copy of each event (crash, heal, Spark off) |
| `turn`, `pass` | `sparkieTurn` finish; the learn pass | Brain, tool rounds, tool errors, tokens; what a pass read and wrote |

- **Not recorded:** the sensing loops (fixed read-only scripts, over 95% of the volume; what they notice already becomes events) and apps' own calls to `/v1` (their content is the app's).
- **Size:** about 400 records on a busy day: some 60 MB of short lines a year. The long text grows with the outputs, now kept whole; its size is read from the folder once built. **Default: nothing is deleted.** Past 20 GB it becomes one line on the needs-you list. No copy off Spark 2 at first.

### 2.2 Lessons

A lesson is a typed record in `lessons.json` (state folder, `writePrivate` and `readKept`, so it is in the daily copy). One per subject and failure; a repeat adds to its counts.

```json
{"id":"l_4c1d9e0a","kind":"start","by":"console",
 "subject":{"model":"zai-org/GLM-5.3-Flash","engine":"sglang","image":"sha256:f832…","sparks":2},
 "tried":{"setup":"nvidia-glm-flash","flags":"a1b2c3"},
 "happened":{"failure":"never-connected","evidence":["j_9f3a01c2d4e5"]},
 "fix":{"sockets":true}, "when":{"pair":"spark3+spark4","freeGB":null},
 "state":"proven","worked":3,"failed":0,"firstAt":"2026-11-10T…","lastAt":"2026-11-12T…"}
```

- **Shape.** Tried and where: `subject`, `tried`, `when`. What happened: a `START_FAILURES` id, or `unknown` with the journal id of the log. What fixed it: only shapes the code already knows (`contextCap`, `dropFlags`, `sockets`), or null. How sure: `state` and the counts. Last confirmed: `lastAt`.
- **Code writes it, from facts.** `learnFrom(op)` reads only typed fields the console itself set: checked inputs, the failure id its own patterns matched, the fix its own table applied, whether the answer test passed (R15). It runs in `runJob`'s finally, so the lesson exists before the next start. Kinds: `start`, `heal`, `app`, `command`, `chain`.
- **Sparkie's notes** are a separate kind, `note`: one line of 240 characters, the names it is about, and journal ids that code checks are passed checks (a completed operation, a command that exited 0). Contract 5.10's "skill".
- **Proven before trusted.** `seen`: once; a hint only. `proven`: the fix was followed by a start that answered its test prompt on the real Sparks (6.11). `stale`: 90 days unconfirmed or a new image; shown with its date, not applied. `retired`: never shown or applied.
- **Wrong lessons correct themselves.** A proven fix that fails the same way drops to `seen`. A setup marked failing that later starts as it is retires the lesson. A fix that gives something up (a shorter context) is applied only when free memory is within 8 GB of when it failed; otherwise the full setup goes first. A memory line of the owner's wins over a lesson; the live system wins over both.
- **Short enough for a 27B model.** Never a list in the prompt. Code picks at most 6, as one-line cards from a template: "GLM-5.3-Flash across 2 Sparks (SGLang): the parts never connected over RoCE. Plain sockets fixed it, 3 times, last 2026-11-12. Applied by itself."

### 2.3 The learn pass: learn, then sleep

`learnPass()` turns the journal into lessons for what one operation alone cannot show.

- **When.** The brain-sleep code calls it just before the brain sleeps. It also runs two minutes after the last operation and reply end (a one-shot timer armed by that end, cleared by any new message; not a schedule).
- **Reads.** Journal short lines after its bookmark (5,000 a pass at most), `lessons.json`, `verified.json`.
- **Code part** (always; no brain; about 5 seconds, in slices): pairs across operations (setup A failed, setup B then answered; a failed command, then the same tool exiting 0); counts repeated chains (2.7); marks `stale`; retires what a later success or the owner's memory contradicts; counts tool errors per brain.
- **Brain part** (at most 5 items, one call each of 60 seconds and 300 tokens, 3 minutes in all; skipped when the brain is busy or down). For an unknown failure later followed by a success, the brain gets a digest built by code (typed fields and 4,000 masked characters of the log, labelled as data) **with no tools**, and returns `{text, about}`. Code checks it (one line, no address, `about` only names from the digest) and saves a `note` in state `seen`.
- **Writes.** Lessons and notes; the bookmark (only past what finished); one `pass` record; and, only when something new was learned, one notice in the owner's page chat. Nothing goes to Telegram. A new message from the owner ends it.
- **For the sleep design:** a running operation, a brain check and this pass count as "not idle". Sleep waits at most 3 minutes for it. Lessons and their replay need no brain, so healing learns and applies while the brain sleeps.

### 2.4 Look-up: code first, a tool second

- **Before a change runs (code, any brain, any way in).** `lessonsFor(action, input)` matches the exact subject. A proven fix whose `when` matches becomes the first attempt's settings in `startWithFixes`. A setup that failed twice the same way with no success is passed over by `bestHow` when another exists; if it is the only one, healing skips it and Sparkie or an agent gets a question. The owner's own explicit request still runs. A passed-over setup is tried again when its image, its Sparks or its start code changed, or when the owner says so; the result always says that a setup was passed over. The result carries the cards.
- **At the start of a turn (code).** `cardsFor(words)` matches the owner's words to lesson subjects (the gates' `tokensOf`) and adds up to 6 cards (900 characters) to the record block beside the fleet notes, never the system prompt. Notes are not added: one line says how many there are, and `lessons` returns them.
- **On a failure (code).** The result notice gets one fixed line: "Seen before: 2 times; a context of 32,768 fixed it" or "First time seen here", so the carry-on turn starts from it.
- **`recall`** for "have we tried this?", "what happened on Tuesday?", "why did it fail?".
- **Plain text search, no embeddings.** Nothing serves embeddings unless the owner starts such a model on Spark 3 or 4, and look-up must work with only Spark 2 on. Records are found by exact names, where word match is the right tool. `recall` reads month files newest first, skips lines without a query word before parsing, scores by words matched (three times in `sub`), and yields every 5,000 lines. Fifty thousand lines are about 20 MB: under a second.

### 2.5 Safety

1. **A lesson informs, never authorizes.** The change gate reads only the owner's words (R25).
2. **Cards carry no outside text.** Every value is checked when written (names: the model-name pattern, no spaces; flags: `^--?[a-z0-9-]+$`; numbers; enums) or stored as null. The words around them are templates in the code.
3. **Raw text only through `recall`**, masked, labelled as data and counted as outside text (`readOutside`). Notes too.
4. **What a lesson does by itself is fixed:** apply a fix `START_FAILURES` defines, pass over a setup, or ask. Never an image, Spark, command, environment variable or port (6.14).
5. **The owner, in chat:** "what have you learned about GLM?" (`lessons`), "forget that one" (`forget_lesson`), "that's wrong, RoCE works now" (a memory line, which wins and retires the lesson).

### 2.6 What is private, and how a lesson becomes a shared, tested skill

**The line: what happened here is private; what is true for any DGX Spark may be shared.**

| Private: Spark 2 only | Shared: in the repo |
|---|---|
| The journal; `lessons.json` (subjects, counts, dates, evidence, notes); memory; chats; `verified.json`; `brain-checks.json`; `saved-workflows.json` (the owner's words and Spark names) | Known failures and fixes (`START_FAILURES`); recipes (`service/catalog.json`); new: `service/learned-fixes.json`; later, shipped workflows (steps with the Spark as an input) |

A shared item holds only public names (Hugging Face repos that are in Recipes, images from trusted sources, engines, flags), numbers, failure ids and words written by code. Never the owner's words, any output, a Spark's name or address, a path, a container name, a journal id, a count, or a date finer than the month.

1. A private lesson is proven with three successes and no failure since: `lessons {ready: true}` lists it.
2. `lessons {id}` returns its **share card**, built by code through a whitelist: `{id, kind, model, engine, image, sparks, failure, fix, since: "2026-11"}`. It is withheld if `maskSecrets` or `hideFleet` (`21-web.mjs:251`) would change one character, or the model is not a public repo in Recipes.
3. The card enters the repo as an ordinary update (the update design's path): the owner's yes, as for any update.
4. **The check, free on GitHub:** (a) only whitelisted keys; the failure id exists; the fix is one of the three shapes; (b) no `ts.net` name, private address, home path, Spark id or key shape; (c) on the stand-in fleet, with the engine made to fail that way, a start runs one attempt with the shipped fix and two without it.
5. Installed, a shipped fix loads as a lesson `by: "shipped"`, so a new Spark 2 after a dead disk starts with it. The local record wins: a shipped fix that fails here the same way is set aside here, and the owner is told.

A saved workflow can move the same way later (its Spark names become inputs; the check is `save_workflow`'s own, `checkSteps` on the stand-in fleet, and the same privacy scan). Notes are free text and are never shared as they are.

### 2.7 Growth

- At the end of a request, code records the chain of changes that all succeeded (two steps or more). The second time the same chain succeeds, the result carries one button built by code with `stepWords`: "Save as a workflow: 1. Stop … 2. Start …". Sparkie only suggests the name. A "no" is kept. The prompt line asking the model to offer this goes.
- `lessons {ready: true}` also lists an unknown failure seen three times with the same log line: a candidate for a new `START_FAILURES` entry, which is an update.
- Needs the owner's yes: saving a workflow, anything entering the repo. Needs none: typed lessons and their replay.

### 2.8 "Try this brain"

**Tied to one model's habits today (verified):**

- `chat_template_kwargs.enable_thinking` on every call (`14-chats.mjs:327`, `10-recipes.mjs` `searchTerms`, `09-verified.mjs:37, 65`); Qwen's sampling as the default (`14-chats.mjs:325`).
- Thinking is seen only as `delta.reasoning_content` (`:363`); tool calls are trusted as the server parses them. Both rest on `--reasoning-parser qwen3` and `--tool-call-parser qwen3_coder` in the setup. With the wrong parser a call arrives as text and is saved as the answer.
- Notices go as `user` messages (`:250`), so two `user` messages in a row are normal; stricter chat templates refuse that (inference).
- Every action's schema goes with every turn (`:79-83`). The loop counts characters, never tokens (`:243-247, 419`): 40 rounds of 4 results of 12,000 characters can outgrow any context.
- The brain's start knows SGLang and vLLM and reads SGLang's flag names (`13-main-model.mjs:128, 151-154`); a setup made from the Library carries no ask settings (`:244-259`).

**The check** is contract 3.2's bake-off as one command: `tools/try-brain.mjs`, then a `try_brain` action that runs it as a job in its own unit on Spark 2 and posts the result. The candidate runs as an ordinary model on a Spark other than the brain's (3 or 4 today), started the usual way. `try_brain` never starts, stops or switches anything, and it keeps the current brain awake.

| Stage | Runs | Out at once on |
|---|---|---|
| 1. Speaks the tools (2 min) | 8 new eval cases, real prompt and tools, stand-in fleet | A malformed call or invalid arguments (read from the stand-in's journal), a refused message order, thinking in the answer, prompt and tools over a quarter of its context |
| 2. Everyday requests | `test/eval.mjs`: the 24 cases plus learning cases (uses `recall`; ignores an instruction planted in a journal record), 3 runs | Any wrong change |
| 3. Speed and memory | `tools/brain-load.mjs` at 1 and 4 at once; first words with the real prompt; memory, below | First words over 10 s (p95) |
| 4. Coding (optional) | `agentbar/` on Spark 3 or 4 | Reported; never decides alone |

- **Memory reserved:** the setup's share times the Spark's memory, then what the server took once loaded and idle (`nvidia-smi` per process as in `gpuUsersScript`; `MemAvailable` before and after, as `memNow`).
- **Memory used:** how full the server's token pool gets, sampled every 5 s through stages 2 and 3 (SGLang's `sglang:token_usage` at `/metrics`; every setup has `--enable-metrics`; names differ by release, so read on the server first), and the lowest `MemAvailable` seen. Both figures are reported for the current brain too.
- **Compared against** the same stages on the current brain with the same build, cases and ask settings (10.3), kept in `brain-checks.json`. **Reports** one verdict: *unsafe*; *not yet* (under the 10.1 bar, or fewer passes than the current brain); *good enough* (meets the bar and beats the current brain, or ties and is faster). Then both rows side by side and the cases only the candidate failed. Switching stays the owner's own step (3.3).

### 2.9 New actions

| Action | Kind | Inputs |
|---|---|---|
| `lessons` | read (inside; outside text when it returns notes) | `about` string ≤80; `id` `^l_[0-9a-f]{8}$`; `kind` enum start, heal, app, command, note, chain; `state` enum proven, seen, stale, retired; `ready` boolean |
| `recall` | read, outside text | `about` string 2–120; `id` `^j_[0-9a-f]{12}$` (that record's text, 8,000 characters at a time); `kind` enum of 2.1; `spark`; `since` ISO date; `limit` integer 1–20 |
| `learn` | change, page only, never a step | `text` string 10–240; `about` array of 1–5 names; `evidence` array of 1–5 journal ids |
| `forget_lesson` | change, page only, never a step | `id` `^l_[0-9a-f]{8}$` (retires it; the journal keeps what happened) |
| `try_brain` | change, starts a job | `model` (running on a Spark that isn't the brain's); `quick` boolean |

### 2.10 Beside what exists

- **`20-memory.mjs`:** untouched. The owner's words only; its lines win over lessons; no lesson is ever written there.
- **`START_FAILURES` and the fix code:** still the only place a fix is defined. A lesson records which known failure met which subject, and replays that same fix first. An unknown failure gets a lesson with no fix.
- **`09-verified.mjs`:** untouched, one writer. It stays the record of what worked; lessons add what failed and point at it.
- **The watcher:** its `learned` events and recipe candidates are unchanged; every event is also copied into the journal.
- **Saved workflows:** format untouched. Growth only offers the existing `save_workflow`, with steps built by code.
- **`audit.jsonl`, `events.jsonl`:** stay as they are (`test/eval.mjs`, healing and the gates read them).

## 3. Rules

**Kept:** R1 and decision 2 (nothing new runs on Spark 2 but files and one short check job). R7 (masked before written). R10, R11. R20. R23 (no new event type). R25 (only the owner's words cause a change). R32 (nothing unasked to Telegram). Decision 5 (no schedule). Decision 6 (journal, lessons and memory never leave Spark 2).

**Must change:**

- **Contract 5.8**, "Outside text never becomes memory, a correction, a learned fix or a change input on its own": keep, and add what is *not* outside text: Spark Console's own record of its own run (checked inputs, the failure id its code matched, the fix its code applied, the verify result). This sentence is what lets Sparkie learn from its runs. Output quoted in the journal stays outside text.
- **Contract 5.10**, "Sparkie writes a short how-to for itself … on the Memory page": becomes typed lessons by code, plus notes; seen and forgotten in chat. **5.5 and 6.16**, "committed to git every night": not for lessons or the journal. **6.11**, "tried automatically, before Sparkie works out anything new": becomes "applied to the first attempt when its conditions match". **6.10**, "in memory": becomes "in lessons and the journal".
- **Architecture R26:** add that cards are built by code from checked values and may go in the record block, and that journal text and notes reach the brain only through `recall` and `lessons`, as outside text. **R22:** one writer each, `journal` and `recordLesson`. **R32:** `learn` and `forget_lesson` join `PAGE_ONLY`. **R18:** the lesson functions join the start workflows' `code()` (a new version and one validation run each). **R29, R30:** `learned-fixes.json` joins `SERVICE_FILES` and, like `START_FAILURES`, the start workflows' version, so a new shipped fix means one validation run. **New R41** states 2.5 and 2.6. Section 4 gets rows for the journal, lessons and brain checks.

**Stays owner-only:** memory lines; saving a workflow; forgetting a lesson; anything entering the repo; the brain switch.

## 4. Build steps

Each ships alone. A new action also goes in `test/lib.mjs`, the counts in `test/change.test.mjs`, and the door and fuzz tables.

1. **Journal and `recall`.** New `20-journal.mjs`; one call each in `07-jobs`, `16-actions`, `14-chats`, `17-changes`, `19-watcher`; `01-setup` (folder switch, `readSync`). Test (`journal.test.mjs`): after a failed start and a console restart, `recall` returns that operation's log (today: "expired"); a key in the arguments is `[hidden]` in the file; after `recall`, `remember` needs a button. With the append made to fail as a full disk does, a changing `run` answers "couldn't write the record, nothing was changed" and nothing runs, while a look, `/stop`, `/putback` and `stop_model` still work. A console killed between a start line and its end leaves, after the restart, one "cut off" notice and no second run. A look writes one line and syncs nothing. A 3,000-line output is in the `.out` file whole; a key that falls across two pieces is `[hidden]`; past 16 MB reading stops and the record says so.
2. **Typed lessons, `lessons`, `forget_lesson`.** New `20-lessons.mjs`; `07-jobs`; `17-changes` (failure and fix on the job); `16-actions`; `18-workflows` (`NOT_A_STEP`). Test (`lessons.test.mjs`): a start that fails on a rejected flag, then works, leaves one proven lesson; again adds to its count; a crafted name with spaces is stored as null; from Telegram, forgetting is a page button.
3. **Lessons applied at start.** `17-changes` (`startWithFixes`, `bestHow`), `18-workflows` (`START_CODE`), `20-heal`. Test (`workflows.test.mjs`): the second start runs `docker run` once, not twice; a learned fix that fails drops to `seen` and the plain path runs; with more free memory than recorded, the context lesson is not applied; a setup passed over for failing twice is tried again after its image, its Sparks or its start code changed, and when the owner asks for it, and the result says it was passed over.
4. **Cards in the chat.** `14-chats` (`sparkieTurn`, `postResult`), `20-lessons`. Test (`sparkie-more.test.mjs`): the request the stand-in brain receives has the card in the labelled record block, not the system message; never more than 6; `remember` still saves with no button after cards alone.
5. **The learn pass, code part.** `20-lessons` (`learnPass`, bookmark), `07-jobs` and `14-chats` (arm the one-shot). Test: setup A fails, setup B answers, and after the pass one lesson says so; a new message ends a pass and the bookmark stays; a second pass with nothing new writes nothing.
6. **`learn` and the pass's brain part.** `20-lessons`, `16-actions` (`sparkieCheck`). Test: failed evidence is refused; an agent gets a button; the pass's call to the stand-in brain carries no tools; an answer with an address or a name not in the digest is dropped.
7. **Growth.** `14-chats`, `20-lessons`, `18-workflows`. Test (`steps.test.mjs`): the same two-step request twice gives one button listing the steps; a chain with a failed step gives none; a "no" is not asked again.
8. **Shipped fixes and the share card.** `service/learned-fixes.json`, `20-lessons`, `01-setup` and the installer's file lists. Test (runs on GitHub): the three checks of 2.6; a card naming a Spark or holding a `ts.net` name fails.
9. **Brain habits out of the chat loop.** `14-chats` (same-role messages merged; `reasoning` read too and an unparsed thinking block removed; tokens from `usage`; a token budget), `13-main-model` (an `ask` block a Library setup keeps). Test (`brain.test.mjs`): a stand-in brain that refuses two `user` messages in a row gets none; one that prints its thinking leaves none in the saved answer.
10. **`tools/try-brain.mjs`, then `try_brain`.** `test/eval.mjs` (cases may seed lessons; a candidate's served name), `test/eval/cases.json`, `tools/brain-load.mjs`, new `21-brain-check.mjs`. Test (`try-brain.test.mjs`, stand-in brain only): a malformed tool call gives *unsafe* and names the case; a clean run gives *good enough* with both memory figures; the action starts and stops nothing.

## 5. Risks, defaults and the one question

- **A fix that gives something up gets locked in.** Held by `when`, and every result says what it runs with.
- **Secrets the mask misses** in command output. The journal is 0600 on Spark 2, out of the repo and the daily copy.
- **More in the prompt confuses a small model.** Six cards at most; the eval runs with and without them.
- **A note carries a log's words in the brain's phrasing.** So notes are never applied by code, never put in the prompt by code, and count as outside text when read.
- **Two workflows need a new validation run** after step 3 (R18). **The eval says little about long agent work** (stage 4 only).

**Defaults chosen (decision 16), no question raised:** nothing in the journal is deleted; the journal is not copied off Spark 2; `learn` saves at once in the owner's page chat when its evidence passed, and is a page button from Telegram or an agent; notes from the pass are saved as hints; a candidate brain runs on Spark 3 or 4; plain text search.

**One question, because the wrong guess would loosen decision 10** ("the owner approves every change Sparkie makes to itself"): may a lesson written by code change how the next start runs, with no yes? It only replays a fix already in tested code, or passes over a setup that failed twice, as proven setups are replayed today. **Recommended: yes.** If no, steps 3 and 5 become "ask first", and the same failure is met once more before each question.

## 6. Left out on purpose

- Embeddings, a vector index, a database, any new process on Spark 2; a page for the journal or lessons.
- Recording the sensing loops; capturing each command inside existing operations (their log is the body).
- Fixes invented by the brain and replayed by code; sharing notes; anything entering the repo without the owner.
- Shipped workflows, until one learned fix has gone the whole path of 2.6.
- Workflows with inputs worked out from near-repeats (exact repeats first); erasing one journal record from chat.
- A leaner brain setup and any use of Spark 2's memory by anything else (not chosen, decision 13).
- Chat summaries (5.3), work and home spaces (5.11), standing rules (6.21), fine-tuning; coding tasks in the default check.
