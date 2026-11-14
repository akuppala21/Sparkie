# Simplicity review of the merged design (critic, 2026-11-13)

Read: `owner-decisions.md` (with decisions 18 and 19), `ledger.md` (with section 5b, its eleven additions and the owner's later words on 10 and 11), designs A to F. A as revised at 22:53 (seven actions, twelve steps), D as revised for decision 19, F as of 22:40. Design G (memory) was not written. Step numbers below are the designs' own as of those times. Nothing was run or changed. "Checked" means I read that code today.

**In short.** The six designs ask for about 67 build steps, about 30 new actions (41 today, about 71 after), about 18 new state files and three new rules. The owner's sentences need about 40 steps, 8 new actions (about 47 for Sparkie, 24 at most offered at once) and 5 new state files. Five merges do most of it: two command tools in place of seven; saved workflows that wait and place, in place of pipelines; the carry-on made durable, in place of a task store; one brain check in place of three; failed starts kept beside proven runs. Of the architect's eleven additions, six stay as small joins, two wait, two go, and one (memory) becomes a piece of its own, early. Order: ground, commander, memory, no laptop, on its own with any brain, workloads and power.

## 1. The goal test

| | The owner's sentence | Smallest set of steps that makes it true |
|---|---|---|
| G1 | "a fully working app that can do it all and can easily adapt to learning if it doesnt know" | No step of its own: what exists (any workload, web lookup), proven on real Sparks by D2, then G2 and G3 |
| G2, 18 | "reason and dig and use internet … do a task … edit env stuff or spark cluster stuff"; "full commander" | B1 (the record first); A1 (looks); A5's command button; A7, A9, A10 (changes on a Spark), as two tools (section 3). Web lookup exists. A as first written gave "edit env stuff or spark cluster stuff" no step at all; decision 18 closed that. Still untrue, by decision 10: anything that needs `sudo` (the owner is handed the command) |
| G3 | "simple or complex workload across 4, 3 or 2 … workflows … so it doesnt repeat … watching every activity, command, and output" | B1 (watching); B2, B3, B4 cut down, with the owner's lines, as one memory (not repeating; section 4); D2's job wait; D6 cut down to saved workflows that wait, place and clean up. "Across 4" as one model is D13: after the phase |
| G4 | "spinning up and deciding models … decide whats best" | `find_recipes` and `bestHow` exist; D5 (wake for work, after the power merge); D8 cut down to one compare action |
| G5 | "even if we change brain llm … it can easily pick up" | B9; E4 and E5 as one check with two outcomes |
| G6 | "dont wanna overcomplicate … so it has all the guidelines" | F1 to F6, F9's glossary, F10; and the cut list in section 4 |
| G7 | "want this elite" | No step. It is a bar: D2 after every install, C1 to C3, and the eval run in full once. It never has been: the only result on disk is one case, one run (`test/eval/results-2026-11-08-partial.json`) |
| 13a | workloads use the brain first | D7 cut down: a job is handed the one model address and Sparkie's name unless a model was named. Proven first by D2's fifth line |
| 13b | the brain sleeps, if measuring shows a saving | Three plug readings by hand (loaded, paused, stopped). E9 only if they clear E's bar; E expects they will not |
| 13c | old pieces off Spark 2 | E10 |
| 14 | "let off by itself or any LLM i use as brain" | E6 cut down (the carry-on made durable), E7 cut down (the report), E1, E2; plus G5 |
| 15 | "testing on github" | C1 to C3; C4, C5; E1 (an outside service watches the hub) |
| 19 | Spark 2 may hold a part, as the brain | D12, then D13: after the phase, behind three gates (section 5) |

- **Serve no owner sentence:** A5's folded rows on the page; B8 (fixes shared "for any DGX Spark": there is one fleet); C6; C9; most of D9; F11; F12; C8's reviewer step; E8 as a tool; additions 8 and 11.
- **Serve a sentence already served:** B5, B6, B7 (after B2 to B4); B10 as an action (after E4 and the eval); C7 (web lookup answers "what's new"); D6 as a new format; D10's own removals; A6's long commands (`keep_running` with `once`); A8's change sets (the copy in A7 and the journal already hold them); A11's "a job may read a box" (`save_file` and `/in`); E6's done checks (R15 already checks every operation); F7's full status table; E3 until a workload needs a key.

## 2. Duplicates: what should be one thing

| These | Should be | Why, and what I checked |
|---|---|---|
| carry-on, A's task (120 steps), E's task, D's pipeline run | Two words. **Operation**: code runs it to an end (a pipeline run is one). **Task**: Sparkie carrying one request across operations. The task is today's `conv.task` with a budget, kept in `chats.json` as now. No `tasks.json`, no `start_task`, no 30-second tick | Checked `14-chats.mjs`: `conv.task` is already on disk; its limits are two constants (`CONTINUE_MAX` 8, `CONTINUE_HOURS` 2); `wakeWork` has two callers. `jobEnded` (`21-apps.mjs`) posts its line and wakes nothing: one call closes that. The owner's words ("on your own", "overnight") pick the long budget, as `multiStep` picks a carry-on today |
| saved workflow, pipeline | Saved workflows, with four additions: a step may leave the Spark out (code places it); a `once` step waits for the job's end; the yes at save covers its images; the run stops what it started | Checked `run_workflow` (`18-workflows.mjs`): it already checks every step before step 1, waits on each operation, records the last run and can be cancelled. D is right that a step cannot start a new image today (`keep_running`'s `ownerHere` test, `21-apps.mjs`). That is one branch, not a new part, file, step grammar and two actions |
| `verified.json`, start lessons, `library.json` | Proven runs stay as they are. A lesson holds what failed (subject, failure id, count, journal id) and no `fix` for starts. `library.json` waits with D10 | I disagree with B's "a start that needed a fix yesterday fails the same way first today". Checked `deploy` (`07-jobs.mjs`: `withoutRejected`, `fixFlags`, then `recordVerified` with those arguments), `clusterParts` (`08-cluster.mjs`: `NCCL_IB_DISABLE` goes into the recorded env) and `bestHow` (`17-changes.mjs`: the fastest proven run first). A start that worked with a fix is replayed with it today, so B3 as written adds a second replay path. What is really missing: failures are not kept, and a shortened context is locked in. B3 becomes: pass over a setup that failed twice with no success, and try the full context first when memory allows |
| `self_test`, `test_changes`, the box's self-check, addition 5's drill | One action, `self_test`; `test_changes` goes; the healing drill and, later, the box wall are lines of it | Checked `validateChanged` (`18-workflows.mjs`): D lifts its picker and `run1` anyway. F's `checks` group still lists both |
| E's brain check, B's "try this brain", the eval, F's "brain trial" | One check, two depths, one file (`brain-profiles.json`). Quick: E's probes, at a switch. Full: `test/eval.mjs` by hand, writing into the same profile. No `try_brain` action, no second part or file | B's stage 1 (8 new cases) and E's 20 probes test the same thing twice. Run the eval that exists before building around it |
| journal, `audit.jsonl`, `events.jsonl`; B's `tool`, `call`, `cmd` kinds | `audit()` calls `journal()`. One record per action call, written in `runAction` for every way in; a command is a call of `run`. Events stay | Checked: nothing in the service reads `audit.jsonl`; tests and `test/eval.mjs` do, so the record keeps the audit's fields. As written, one change by Sparkie is written four times (audit, `tool`, `call`, `op`) |
| A's seven actions | `run` and `write_file` (section 3) | A's own table says a command that fits the look grammar "runs as a look" in `work_run`, and that `work_read` on a Spark "is a look" |
| `put_back`, `undo_last_change`, `undo_update`; `changes.json` (A's change sets) and `changes.json` (C's open proposals) | Two undo tools: `undo_last_change` (a model, an app, or a file Sparkie wrote) and `undo_update`. Neither `changes.json` | A's record already carries each file's path, hash and copy (A 2.11), so the journal is the change set; open proposals are GitHub's pull requests. Two designs gave two files one name |
| The go-ahead, the always list (addition 1) | One allow list with two lifetimes: this task (in memory), or standing (in `agent-settings.json`, where the owner's other switches live). No `allowed.json` | A builds both in one step (A9) and they answer one question |
| `lessons`, `recall`, `report`, `learn`, `forget_lesson`; `check_update`, `update_status`, `tasks`, `app_keys`; `guide` | `recall`: lessons first, then journal lines. `sparkie_setup {about}` for the four status reads. `guide`: a look reads the documents on Spark 2 | A memory line of the owner's already retires a lesson (B 2.5). Checked: `sparkie_setup` has `about` with one value; `AGENTS.md` says every install copies the tree to `~/spark-console-src` |
| A's `check_ways`, addition 6; four key routes; `workBusy`, `sparkNeeded`, `holdSpark`, `tasksUsing` | One ways-in function with two callers. One route for named keys (all four land in `secrets.json`). `sparkNeeded` (the ledger and F agree) | |
| Timers (learn pass, task tick, pipeline look); energy kept in four places | No new timer but the heartbeat: the task's time limit rides `needsMeTick`, which runs each minute. One energy number, on the operation's journal line | |

## 3. What a small local model can drive

**The count.** Sparkie is sent all 41 actions every turn (`sparkieTools`, `14-chats.mjs`): about 37,000 characters of names, descriptions and inputs by my count of the parts (F counts 32,000); `keep_running` alone is 4,600 with 11 inputs. The designs add 30: A 7, B 5, C 6, D 6 (with `brain_across`), E 5, F 1.

| Action as designed | Inputs | Where it asks too much, and what replaces it |
|---|---|---|
| `save_pipeline` | 4; `steps` is 1 to 8 objects of up to 15 fields | The largest thing asked of the brain: a typed plan whose `uses` and `reads` must name other steps. Code builds it instead. Sparkie does the work once with the tools it knows; "save that as X" saves the chain the journal recorded (the one part of B7 worth keeping): `save_workflow {title, from: "this request"}` |
| `start_task` | 6; `done` is 1 to 5 typed checks | Exact container names and paths; a wrong check ends a task early or never. Code derives it: the report lists what the task started, what answered and what is left |
| `work_edit` | `find` of up to 8,000 characters, matched exactly once | Small models miss on spacing, and the console's own lines run to 2,400 characters. One `write_file {on, path, text, from?, to?}`: the whole file, or lines `from` to `to` as the last look numbered them; refused if the file changed since. A11's "fix it with an edit" eval case picks between the two before either is built |
| `install_update` | `tree` (12 hex), or `pr` and `head` | No input: "the newest tested build". The button carries the tree |
| `learn`; `put_back` | 1 to 5 journal ids of 12 hex; a set id | Cut; folded into `undo_last_change`, which takes no id |
| `keep_running` (exists) | 11, and the designs add `keys`, `work` and pipeline fields | Add none |
| `host_look` 3, `workspace` 5, `work_run` 5, `work_read` 4, `recall` 6, `lessons` 5, `pipeline` 7, `change_sparks` 4 | | Each is fine alone; together they are 8 more tools |

**Decision 18: A's seven tools become two.** A's ladder (looks; the box; a compute Spark; Spark 2; the refused list) stays as A wrote it. Only the tools change.
- `run {on, command, dir?, minutes?}`. `on` is a Spark, or `"box"`. Code, never the brain, sorts each command: a look runs at once on any host; in the box at once; a change on a compute Spark at once under A's `hostClear`, a go-ahead or an always entry, else the exact command on a button; on Spark 2 always the page button; the refused list.
- `write_file`, as above. No read tool (a look reads: `cat -n`, `sed -n`). No `workspace` tool: the box opens on the first `on: "box"` with A's defaults, and removing it is an ordinary deleting change. No `host_look`, no `put_back`.
- **Unknown means change** (A says the same). So the look list only has to be safe, never complete. Start it short: what it leaves out costs one button, then an always entry.
- The box is then a place, not a tool. It can come later and adds no tool when it does.
- Why two suit a small model: the official SWE-bench "bash only" track gives every model one command tool (swebench.com/bash-only.html), and shell is what these models have seen most.

**The smallest first version, as three installs:** (1) A1, looks on any host; (2) A5's button, A7, A9 and A10: changes on a Spark, with the copy first; (3) the box (A2 to A4), in milestone 5. The coordinator guessed looks, box, host changes. I put the box last, and A now says its steps 7 to 10 can be built before it. It is the largest piece of A; the owner said a box alone does not meet the need; nothing in milestones 2 to 4 needs it; and what it is for (a script from a web page, long work with no clicks, the console's own source) first appears in milestone 5. The safety critic may want it earlier. That changes only the order, not the tools.

**The cap: 24 tools a round** (F's figure: a core of 12 and two groups of six). Hold it, with three changes.
1. Cut the total first. About 47 tools make 7 groups, not 11, so the word table has less to get wrong.
2. Put `run` and `recall` in the core, in place of `guide` and `should_be_running`. With `run` always there, a wrong group costs a round, never the answer.
3. Measure before trusting it: the eval at 41 tools and at 24, on the real brain. Checked: `docs/analysis-2026-11-11/02-tools-and-freshness.json` (gap 9) asked for "at most 36 tools" held in code and a measurement; neither happened and the list grew to 41. The web gives no measured figure for a local model this size; one paper finds fewer tools improve tool choice on small devices (arxiv.org/abs/2411.15399).

## 4. The cut list

| Step | Verdict | What the owner loses | Add back when |
|---|---|---|---|
| A2 to A4, the box | Later (milestone 5), as a place for `run` | Until then, work that is neither a look nor allowed costs a click | Milestone 5 |
| A5; A6 | Keep the command button and the line on the `tool` event, cut the folded rows. Cut long commands (a long run is a job); carrying on joins the task | A tidier step list; a 30-minute command inside the box | The chat is noisy; a real case a job cannot do |
| A8 | Cut down to the copy first (in A7) and `undo_last_change`. No `changes.json`, package lists, `find -newer` sweep, `unseen`, or put-back of a put-back | A list of what a script changed without naming it | The owner asks "what did that script change?" and the journal cannot say |
| A11; A12 | Eval cases ship with milestone 2; the `agentbar` contestant only as C8's go or no-go; a job reading a box, and the internet in a box, later | Box code on the GPU without `save_file`; packages inside the box | First real need; A12 after the box passes on a real Spark (A says so too) |
| B5, B6 | Cut | Lessons that need two operations to see (setup A failed, B worked); Sparkie's own notes | The journal shows a mistake made twice that B2 to B4 missed |
| B7; B8 | Cut the offer made by itself, keep "save what just worked". Cut shared fixes | A button on the second repeat; fixes carried in the repo to a rebuilt hub (lessons are in the state copy anyway) | Never; a second owner or fleet |
| B10 | A script only; no action, no coding stage | "Try this brain" as a sentence; the owner runs one command | A second brain is really being tried |
| C3's shards | Only if C1 measures one job at over 30 minutes | A longer wait for GitHub's mark; the Spark run (10 min 26 s) is the fast path | Measured |
| C6; C9 | Cut | A picked subset of tests when no Spark is awake; a ready Codespace | GitHub minutes pass 1,500 a month; someone wants one (it is one file) |
| C7 | Cut; delete the daily timer (decision 5) | Setups looked up before anyone asks; a prepared "what's new" list. Checked: `startModel` already refreshes a stale look (`refreshSetups`, `17-changes.mjs`) | The owner asks weekly |
| C8 | Last, behind the trial; no reviewer step, no minute budget, one open change | Self-change waits; a second opinion is asked by hand | Sparkie passes 2 of 3 runs on each `agentbar` task |
| D3 | Later | Adding a Spark by a sentence | Spark 1 is on the desk |
| D6; D7; D8 | D6 replaced (section 2). D7 cut to the address rule. D8 is one action, `compare_models {workflow, candidates, sample}`; the owner picks when scores are close | The brain passed over by itself when it is slow | A workload is slow on the brain |
| D9; D10 | One energy number per operation. The `remove_copy` button only | A cheapest-Spark guess among sleeping Sparks; room made by itself before a download | Four compute Sparks and real figures; a download is refused for room twice |
| D11, D12, D13 | After the phase (section 5) | One model across three; the brain across Sparks | The gates in section 5 |
| E3 | Later | Keys for workloads | The first workload that needs one |
| E6's done checks, three of five budget fields, `tasks`, `stop_task`, `report` | Cut | A tick list on the task's card | A task says done when it is not |
| E8 as a tool; E9 | By hand; E9 only on the numbers | Nothing | The readings clear E's bar |
| F5's timer, event and limit registries; F7's full table; F9's "don't say" check; F11; F12; F13's meaning diff | Cut or later | A status for all 108 old rules now; `guide` in chat before milestone 2 | The meaning diff with C8; status rows as rules are touched |

**The architect's eleven additions (ledger 5b), judged the same way.**

| # | Addition | Verdict | Why, in one line | Where |
|---|---|---|---|---|
| 1 | "Always allow" | **Keep, as A9 has it**, with two trims | Asking is the owner's biggest complaint, and this is how asking shrinks. Trims: one list with the go-ahead (section 2); no use counters (the journal has them). Commands only: typed actions stay under R25 | Milestone 2 |
| 2 | Put-back for host changes | **Keep the copy first; merge the rest into `undo_last_change`** | A8 grew it into change sets, package lists and a sweep. The copy is the safety; the journal is the set. A change that cannot be put back says so on its button (A has this) | Milestone 2 |
| 3 | The owner's requests as the brain's test | **Put off** | A replay needs the stand-in fleet in the state the real one was in, and the 24 written cases have not been run in full once. Cheaper later: list the commonest request shapes from the journal and write cases by hand | After two full eval runs |
| 4 | A behaviour gate for updates | **Keep as a fact on the install button; the automatic run waits for C8** | Every milestone changes what the brain reads. The lock records a hash of the prompt, tool texts and groups; the button says "what the brain reads changed" and the eval score for it, or "not run". Needs the eval runnable from a compute Spark (`--brain-url` exists) | Milestone 1; automatic in 5 |
| 5 | A healing drill | **Keep, merge into D2** as a sixth line, always run (no new input) | Healing has only ever run on the stand-in fleet, and the map lists a heal path found by reading that was never run | Milestone 1 |
| 6 | Ways-in health | **Keep, merge into `openProblems`** | A lapsed Tailscale key is the lock-out case, and `REVIEW-GUIDE.md` section 6 lists the check as missing. `checkRoute` reads Tailscale each minute; disk is on the list already. No new timer or file | Milestone 4 |
| 7 | Health trends | **Put off; keep the data** | The journal's turn records hold speed, so "has Sparkie got slower?" is a `recall`. A threshold set before there is data makes false alarms, and brain-first jobs will halve the speed on purpose | After one felt slowdown |
| 8 | News leads to a try | **Cut** | It stands on the news feed (C7, cut); unasked suggestions are more words in a small model's prompt; `search_web` answers "anything newer?" | With C7, if ever |
| 9 | A track record | **Merge the counts into the report; cut the automatic drop to "careful"** | Code cannot tell a wrong change from a change of mind, and the penalty is more buttons, which addition 1 exists to remove. The owner can say "ask me first" | Milestone 5 |
| 10 | Memory as an index and notes | **Withdrawn by the owner** for a better method (design G) | See "Memory, first class" below | Milestone 3 |
| 11 | Helpers (`look_into`) | **Dropped from the plan; I agree** (the owner first said to avoid helpers, then left "the best way" to design G) | It is a second loop inside the first (its own limits, stop, brain place and record), which A and E both left out on purpose. `recall` within a budget does the reading; a second look by the same brain is not an independent check. If G reopens it, ask for a measured need: tasks that end at the output budget, not by finishing | |

After these verdicts the parity table reads "none" in every row but memory (below) and helpers: instructions are `AGENTS.md` and the cards, read by a look; the wrap-up is the report; undo is the copy and `undo_last_change`.

**Memory, first class (design G is not written; this is the smallest first version, and the bar to hold G to).** One memory is one look-up over three stores, each with its own writer: the owner's lines (their words only), lessons (code, from its own runs) and the journal (everything). Nothing else is stored. Four changes make it better, all in code, with no model and nothing new on Spark 2:
1. **No ceiling.** `remember` never refuses for room. Today it does at 40 lines (`MEMORY_MAX`, `20-memory.mjs`).
2. **One picker before every turn**, for lines and lessons alike (B4's `cardsFor`): exact names first (model, Spark, container, failure id), then shared words, then the newest. The owner's preferences and corrections are always in view. One budget in characters: today's 4,000 at first, the brain's profile later.
3. **Truth over time**, by three plain rules that exist in pieces: the owner's newest line on a subject retires the older one (`remember` has `replaces`); the live system beats memory (the prompt says so today); a lesson that a later run contradicts drops (B 2.2). Retired, never deleted: the journal keeps what was.
4. **One tool, `recall`**, returns ranked short pieces within the same budget: lines and lessons first, then journal lines. This is the job helpers were for.

Left out of the first version, each with its test for coming back: embeddings or a vector index (no embedding model runs on Spark 2, look-up must work with only Spark 2 on, and the names here are exact, where word match is the right tool: B 2.4 says the same); a graph; notes the brain writes by itself from what it read (the steering path R26 closes: they stay behind a button); a pass that rewrites memory while idle (B5, B6). **The bar for G:** write 20 "do you remember" questions from real use into the eval; anything G adds must beat this version on them, on the real brain.

## 5. The milestone plan

1. **Ground: every later step faster and safer.** Tonight's build installed. C1, C2 (the Linux failures the Spark 3 run showed), C3 (one job, the mark as a tag). A by-hand script for the full suite, and the eval, in a container on a compute Spark (the suite took 10 min 26 s there). F1 to F6, F9's glossary, F10 with the eval at 41 and at 24. D1. D2 on real Sparks, with the healing drill (addition 5). The "what the brain reads" hash (addition 4). *"Run the self-test."*
2. **Commander (decision 18).** B1. A1. Then A5's button, A7, A9, A10, with A3's budgets and without the box: `run`, `write_file`, the copy first, the go-ahead and "always" (additions 1 and 2). Five eval cases: a look; a change asked for; a change that becomes a button; a refused command; an instruction planted in a log that is not obeyed. *"Find out why the job on Spark 4 died last night, clean up what it left in my project folder there, and always allow that."*
3. **Memory.** B2, B3, B4 as cut down, and the owner's lines with no ceiling: one picker, one budget, `recall` over all three stores (section 4, "Memory, first class"). Its base, B1, is already in from milestone 2. Design G's additions land here only if they clear the bar. *"What do you know about starting GLM across two Sparks, and what went wrong last time?"* (and the next start passes over what failed)
4. **No laptop, lighter hub.** C4, C5, E10, E1, E2, ways-in health (addition 6). *"Is there a newer tested build? Install it."* (from the phone, with the laptop closed)
5. **On its own, with any brain (decision 14).** B9. E4 and E5 as one check; the memory budget moves into the profile. E6 and E7 as cut down, with A6's carrying on and the report's counts (addition 9). The box (A2 to A4) as `on: "box"`. A11's trial with Sparkie as a contestant; C8 with the automatic eval (addition 4) only if it passes. *"On your own tonight: download X to Spark 3, start it, run my script against it, stop everything, and report."*
6. **Workloads and power.** The power merge. D4, D5. D6, D7, D8 as cut down. D3 when Spark 1 arrives. *"Run my workload on whatever is best: try yourself and two other models on ten samples, keep the winner, and let the Sparks sleep after."*

**Where this differs from the order the ledger gives (its section 3), and why.**
- Item 4 puts the box straight after the looks. Decision 18 moves host changes ahead of it (section 3 above).
- Item 5 (lessons and cards) moves up to milestone 3, straight after the commander: the owner made memory first class, and it needs only B1.
- Item 8 ties the pull install to self-change. They share only GitHub: C4 and C5 need C1 to C3 and a Node on Spark 2; C8 needs the box and the trial. Split, every install after milestone 4 needs no laptop.
- Conflict 8 lands D1, D2 and B3 in one build to share one live run. The self-test makes a live run one sentence, so B3 need not wait for D1.
- F marks nine steps "before any feature". F7 and F8 can follow the work: write a milestone's rules when it starts, and give a rule its status row when a step touches it.
- Kept: D1 and D2 first; B1 before any command tool; B2 to B4 after B1; the brain check before long tasks; the power merge before D4 and D5; workflows that place, and compare, last.

**Decision 19 belongs after milestone 6**, as the designer's verdict had it. Three gates, in order: the two-Spark start has its first real run (ask for it as an extra line of the self-test when Sparks 3 and 4 are both free); then D12, the brain across two with the code that exists, when the owner names a model too big for Spark 2 alone; then D13, only after NVIDIA's three-Spark test passes by hand on the 2-3-4 triangle and one by-hand start shows the speed is worth having. Why last: it changes the brain switch and the brain's healing, where D's own table shows up to 45 minutes with no brain; it holds Sparks 3 and 4 awake and closed to other work while it runs; it is one more action; and nothing in milestones 1 to 6 depends on it. Free now: write `sparkNeeded` and placement for a list of members, never a pair.

## 6. Navigability: the three things most likely to confuse a small agent

1. **Names.** For "work that goes on" the merged design has operation, job (the code's word for an operation and also a run-once container), task (A's), task (E's), carry-on, workflow, saved workflow, pipeline and workload (the owner's word, and the action that lists containers). "Workspace" is already the shared folder (its path says `workspaces/shared`, the worker's action is `workspace-files`) and would also be A's folder and tool. "Lesson" is already a kind of memory line (`MEMORY_KINDS`). Two designs each add a `changes.json`. F answers with 26 glossary rows and a "don't say" checker. **Cheapest fix: fewer things.** After section 2: operation, job, task, saved workflow, box. Then a 15-row glossary needs no checker. Keep F's rule that one word names a part, its state file, its actions and its test file.
2. **Where state lives.** Four homes on Spark 2 (the state folder; `~/.local/share/spark-console` for snapshots, the journal and the repo copy; the secrets file; `~/spark-console-src`), then each Spark (`~/models`, the shared folder under the old `spark-portal` name, backups, the copies taken before a change, later boxes), GitHub (tags, branches) and Docker's labels. **Cheapest fix:** five new state files, not eighteen (the journal, `lessons.json`, `brain-profiles.json`, `sparks.json`, the repo copy); F5's one generated table (file, home, writer, copied daily or not); one line in `AGENTS.md` naming the four homes.
3. **Which gate applies.** "Does this run now, become a button, or get refused?" will depend on R25's words, the page-only list, owner-only buttons, the passkey, A's ladder with its go-ahead and always list, the brain's grade, the task's budget, the pause and protected paths, spread over six parts. **Cheapest fix:** A's record already names the gate that decided (`gate`, A 2.11). Show that same word in every button and refusal ("a button: your words did not name Spark 3"), and do it for typed actions too, since `runAction` already decides in one order. The actions registry gets one generated row per action: at once for whom, a button for whom, never. The look list, the never-read list and the refused list sit as tables at the top of one part and nowhere else.

## 7. Over-built for one owner and four machines

- **Brain grade** (full, careful, answers-only) with a rails table. Two states do: checked, or "every change is a button until the eval passes". A brain that cannot call a tool fails the last step of its switch, and a failed switch already goes back to the last brain.
- **Task budget** of five limits and seven counters. Hours and turns: downloads and Sparks are gated by the owner's words already.
- **Lessons:** four states, six kinds, a share card with a privacy list and a GitHub check. Two states (seen, proven), two kinds (start, app), nothing shared.
- **Put-back:** change sets, package lists before and after, a sweep after every command, three size limits and three keep limits. The copy first, and the newest 20.
- **Electricity:** ten figures and a cost guess for placement. One number per operation; D's fixed order places.
- **Storage:** `library.json` with how, for and last use, and removal by age. A list and a question (it exists) and a button.
- **Pipelines:** step kinds, `uses`, `reads`, a fingerprint, `chosen`, `result.json`, `SPARK_SAMPLE`. A saved workflow; a job may write a score, read only by compare.
- **Testing:** the coverage map and its `missed` list (the whole suite takes 10 minutes on a Spark); three more brain measuring tools (`try-brain`, `brain-power`, the `agentbar` contestant) on top of three never run in full.
- **GitHub:** a news branch, a reviewer app, protected paths with a meaning diff, 6 pushes, 3 open changes, 1,000 minutes. Keep the tag, `sparkie/*`, one open change, `.github/` refused, and the owner's yes on a diff built by code.
- **F:** forty rule files are fine (the text moves whole). Over-built: a status row and proof for each of 108 old rules; "don't say" patterns; six registries where two earn their keep (actions, state files); `hub.json` with a two-way check (E10's look is the check, and the self-test can print it); `guide.json`; thirteen checks, where 1 to 6 and 10 catch the drift found today.
- **The journal's nine kinds:** five do (said, call, operation, event, turn).
- **Design G, before it is written:** the risk is a vector index, a graph, an embedding model and a pass in which a model decides what to remember, for one owner's few hundred facts. Hold it to the bar in section 4.
- **Not over-built, though large:** A's host ladder (five conditions, a go-ahead, an always list, nine refused classes, a never-read list). On a host, code is the only wall. Keep it in one part.
- **Fine as designed:** the heartbeat (one request, nothing sent), `change_sparks`, the tag as the tested mark, B's monthly journal files, D1, D2, A's seven limits.
