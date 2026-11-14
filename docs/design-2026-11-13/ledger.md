# Merge ledger: joining the six designs into one architecture (working notes, 2026-11-13)

Status: A (workspace), B (learning), D (fleet and workloads) read. C (GitHub and self-change), E (unattended, any
brain), F (structure and contract alignment) still to come. Fill the gaps marked `[C]`, `[E]`, `[F]` when they land.

## 1. Shared pieces: one owner each

| Piece | Owner | Used by | Note |
|---|---|---|---|
| `journal(kind, fields, body)` | B (`20-journal.mjs`) | A (`cmd`), D (operation end carries energy), E (queue, sleep), C (updates) | Build first, so A needs no audit fallback |
| Lessons, cards, `recall` | B | A (task card sits beside them), D (compare results could become lessons later) | Cards go in the record block, never the system prompt |
| The box (`workBoxCommand`) | A | C (Sparkie edits its own code in a box), D (a job may read a workspace) | Never on Spark 2; no network |
| Job wait (`waitJobEnd`) | D step 2 | D pipelines and compare, E queue | Closes "then do Y when the job ends" |
| Holds: may this Spark sleep (`sparkNeeded`, `holdSpark`, `doneWith`) | D | A (`workBusy`), B (learn pass), E (queue, brain sleep), power part | One function per question: a Spark, and the brain |
| Power calls (`power.state`, `wake`, `wallWh`, `wallW`) | the smart-plug session | D, E | Not in this tree yet: merge first |
| Brain profile | `[E]` | A (`workSteps`, `contextTokens`, `work`), B (`ask` block, memory figures), D (`can` list) | One object per setup; limits come from it, not from the model's name |
| Work queue / task | `[E]` | A (one workspace task = one item), D (a pipeline run = one item) | D says a run is not resumed after a restart: E decides |
| Tool offering and the cap | `[F]` | A (work tools only with an open workspace), all | 27 reads and 42 changes today; A, B, D add 4 reads and 12 changes |
| Glossary | `[F]` | all | box, workspace, pipeline, lesson, note, card, hold, asleep, hub, compute Spark |
| State-file registry | `[F]` | all | New: `work.json`, journal folder, `lessons.json`, `brain-checks.json`, `learned-fixes.json` (shipped), `sparks.json`, `pipelines.json`, `library.json`, `energy.json` wall block, `[E]` queue and secrets |

## 2. Conflicts and how they are settled

| # | Conflict | Settled as |
|---|---|---|
| 1 | A and B both name a new rule R41 | R41 workspace (A), R42 learning (B); later designs take R43 on |
| 2 | Tool counts: each design counts from 27 and 42 alone | One count after the merge; the cap and offering rule come from F |
| 3 | A: no engine, extend the console's own loop. Contract (owner, 2026-11-08): adopt an open engine after a trial | Follow A. It reverses an owner choice, so it is on the decision list. The trial stays as a measurement with Sparkie as a third contestant |
| 4 | D: after 3 days with no copy, wake one Spark for the state copy. Owner was told: copy only when a Spark is awake anyway, never wake one just for a backup | Keep what the owner was told. Add one line on the needs-you list after 7 days with changes and no copy. A second disk in the hub is the real fix (owner's hardware call) |
| 5 | B: the journal is outside the state folder and never copied. E owns rebuild | Accept: a dead disk loses the journal, not the lessons (in the state folder). Say so in the rebuild steps |
| 6 | D: pipeline run not resumed after a console restart. E: tasks survive restarts | `[E]` decides; default: the queue resumes a pipeline at the step that was running, after clean-up |
| 7 | D adds `can` to brain setups, A adds `workSteps`, `contextTokens`, `work`; B adds an `ask` block | One brain profile (E) |
| 8 | B step 3 and D steps 1 and 2 each change the start workflows' versions | Land them in one build so one lock and one live run cover all |

### Added after C and E landed

| # | Conflict | Settled as |
|---|---|---|
| 9 | Journal home: B puts it outside the state folder, two files a month, never copied. E expects `STATE_DIR/journal/<day>.jsonl` and copies its segments with the state | B owns the journal: its home and files stand. It is not copied at first; lessons are (state folder). E's rebuild text says the journal is lost with the disk |
| 10 | Brain facts in four places: A (`workSteps`, `contextTokens`, `work`), B (`ask` block, `try_brain`, memory figures), D (`can`), E (`brainCheck`, profile, grade, rails) | One profile (E's `brain-profiles.json`). E's 3-minute check runs at a switch and sets the grade. B's `try_brain` is the long comparison before a switch and writes the eval into the same profile. `can`, `workSteps`, `contextTokens`, `work` are profile fields |
| 11 | Three kinds of ongoing work: today's carry-on, A's workspace task (120 steps, 2 hours, 8 turns), E's durable task with a budget, D's pipeline run | One ladder. In a chat: carry-on with A's limits. Unattended: E's task (the same loop made durable). A pipeline run is one operation a task may wait on |
| 12 | State copy: D wakes a Spark after 3 days; E asks on the needs list after 7 days and never wakes one | E's default (matches what the owner was told) |
| 13 | Self-change needs the box to hold the console's source (A left it out; C asks for it) | A's box gains "filled by code from a tar stream, read back as one". GitHub's quick job is the test bench |
| 14 | E removes the editor proxy (`21-editor.mjs`); D notes a new Spark has no editor | The editor goes (owner's D12). A dev box is an app on a compute Spark through the app door |
| 15 | C's `mark` writes the lock on GitHub; a fast run on a Spark in a container is also wanted while building | `node test/lock.mjs` on one machine stays valid (C keeps it as the by-hand path). The Spark run uses it; GitHub's tag is the mark for installs |

| 16 | **Owner decision 20 (full permissions; ask on Telegram for risky or final changes)** against A ("Spark 2: a page button, never Telegram"; "always allow: only a page press"; host changes from Telegram wait for the page), C ("yes on the page only, never Telegram" for installing an update; protected paths need the passkey), E (keys and the heartbeat address typed only on the passkey page) | Telegram's paired chat is an approval channel, equal to the page, for: a host change on Spark 2, a delete that cannot be put back, installing an update (Sparkie's own included), anything touching the brain, an "always allow" answer, a task parked at a question. Each button shows the exact command or change, works once, and expires. Still page-only: what proves who the owner is (passkeys, recovery codes, pairing Telegram) and typing a secret (a key never goes through a chat). Still refused or handed over: `sudo`, and the lock-out class, until the owner says otherwise. The owner-question list (rows 11 and 13) is answered by this: yes to changes on Spark 2 and to the delete rule, with the button on Telegram |

| 17 | **Owner decision 22 ("literally everything"; keys given once)** against decision 20's three fixed things, A's "always refused" list, E's "keys typed only on the passkey page", C's "protected paths need the passkey" | Nothing is refused for being powerful. Three classes: runs under the ladder; risky (always asked on Telegram and the page, exact change shown, never under "always" or a go-ahead); and a short "not done" list that is not about permission (read text is never an instruction; no way round a network filter; a key is never shown back). Root: asked for once (recommend passwordless `sudo` set up by the owner, nothing stored). The lock-out class: allowed, inside a confirm-or-put-back net that code arms before the change. A key given in chat is taken out by code before the brain, the chat file or the journal sees it, kept in the secrets file, and used by name. A is being revised; the safety critic reviews the net |

C: the suite will not pass on Linux as written (seven risks, C 2.2). The first Linux run (tonight, in a container on
Spark 3) is C's "measuring run". Its fixes (C step 2) come before anything else on GitHub.

## 3. Order that the designs force

1. Before any feature: tonight's build installed; the repo on GitHub with its test run; a fast place for full runs
   (Spark 3 in a container, if tonight's trial works); F's "before feature work" checks.
2. D1 hub guard for unnamed placement (a real gap today: R1's "Today").
3. D2 self-test with the job wait: it proves model, app and job on real hardware after every install.
4. B1 journal and `recall`, then A1 `host_look`, A2 to A6 the box.
5. B2 to B4 lessons, applied at start, cards.
6. B9 brain habits out of the loop, `[E]` brain profile, B10 "try this brain".
7. `[E]` work queue, heartbeat, secrets, brain sleep (measure first).
8. `[C]` self-change loop and pull-based install.
9. Power merge, D3 Spark list, D4 and D5 asleep and wake-for-work.
10. D6 to D8 pipelines, brain first, compare. D9 electricity. D10 upkeep.
11. Later: B7 growth, B8 shipped fixes, D11 several Sparks at once, A9 internet for a box. Not scheduled: one model
    across three Sparks (needs Spark 1 cabled and a model that needs it).

## 4. Decisions only the owner can make (each loosens a rule or reverses a choice)

| # | Question | Recommended |
|---|---|---|
| 1 | Allow free-form commands, only inside a locked container on a compute Spark (new rule R41, with exceptions in R11, R13, R37, R38)? | Yes: without it Sparkie cannot dig |
| 2 | Extend the console's own chat loop and adopt no outside coding engine (reverses the 2026-11-08 choice)? | Yes: an engine would bypass the checks and the record |
| 3 | May a lesson written by code change how the next start runs, with no yes (it only replays a fix already in tested code, or passes over a setup that failed twice)? | Yes |
| 4 | May Spark Console remove, without asking, extra copies and images it made itself when a download needs room? | Yes; never a last copy, never anything the owner put there |
| 5 | Does one yes to a saved pipeline cover later runs of exactly those steps, new images included? | Yes; an agent's run still gets an owner-only button |
| later | Internet for a box, through a gate, after the box has passed its check on a real Spark | Decide then |
| 6 | (E) Let the brain rest when idle? The contract says it is "always on" (3.1, 3.3). Owner picked this on 2026-11-13, with "measure first" | Yes, but only switched on by the owner after the numbers are shown; nap (`docker pause`) before sleep |
| 7 | (E) A brain switched in later starts "careful" (every change a button, no tasks) until the eval passes | Yes |
| 8 | (C) A read-only GitHub token on Spark 2 so it can pull the tested build (typed once on the passkey page). Later a write token limited to `sparkie/*` branches for Sparkie's own changes | Yes to read now; write when the self-change step is built |
| 9 | (C) Sparkie may not change sign-in, safety, its own rules, the contract, the map or an existing test without the passkey on the page; `.github/` never | Yes |
| 10 | (E) Keys for workloads typed only on the passkey page; a container gets a key by name | Yes |
| not asked | (C) GitHub Pro for branch protection: stay free. (E) Never wake a Spark just for a state copy. (E) No cold copy of the brain's weights on another Spark. (E) A task never widens what the owner's words allow | defaults taken |
| 11 | (A revised, decision 18) Host changes on Spark 2 at all? Recommended form: always an owner-only button on the page, one command a press, a check of the ways in after, put-back on a miss. The other choice is looks only on Spark 2 | Yes, in that form |
| 12 | (A revised) Accept that the owner's user has Docker, and Docker is root: a command built to get round the refused list could reach it. What holds: the gate reads only the owner's words, the ways-in check with put-back, the record. The only real wall would be a second user without Docker, which "full commander" rules out | Yes, said plainly |
| 13 | (A revised) A delete that cannot be put back is always a button; owner-only for models, app data, images and the shared folder; never on the always list | Yes |
| 14 | (F) May the contract be made flat (version marks removed, status only in one table, dated notes moved to history), with no rule's words changed in that step? | Yes |
| 15 | (F) Rules that the 2026-11-13 decisions replaced (the Keeper, git on Spark 2 with nightly commits of memory, the brain "always on", schedules): rewrite in place with the old words kept in history | Yes; "left out" only where nothing replaces the rule |
| 16 | (F) May Sparkie make mechanical document edits (a status row, a pointer after a rename) in its own proposed updates without the passkey, while every change of meaning needs it? | Yes |
| defaults taken (A revised) | An always-allowed kind also runs from Telegram and in an unattended task; a go-ahead lasts one task; containers stay typed (no free-form `docker run` or `stop`) | |

## 5. Facts the owner should hear (they change what "one huge cluster" can mean)

- One model across all four Sparks is ruled out while the hub never holds a part: the most is three (Sparks 1, 3, 4).
- Three needs Spark 1 cabled; the two cable ends now in Spark 2 would move to Spark 1. Four would need a switch.
- Three Sparks buy room for a model too big for two (over about 210 GB), not speed. Community runs report the split
  across three ran slower than one Spark unless the model's head counts divide by three.
- "Across 3 or 4" until then means a pipeline whose steps sit on different Sparks, or the same job on several Sparks
  at once.
- A container reaching the one model address from inside Docker has never been checked on a real Spark; the self-test
  checks it on its first run.

## 5b. Additions from the architect (owner asked "what else to make it even better", 2026-11-13)

Each is a small join of pieces the designs already have. The simplicity critic should cut any that do not earn their place.

| # | Addition | Why | Lands in |
|---|---|---|---|
| 1 | **"Always allow."** When a button shows a command or a kind of change, the owner can answer "always" for that kind on that Spark. The standing list is kept, shown and revocable in chat. The always-refused list can never be allowed this way | The owner's biggest complaint is being asked. Asking should shrink with use, as it does with a coding agent's allow rules | A (host commands) |
| 2 | **Put-back for host changes.** Before Sparkie edits or replaces a file on a Spark, code keeps a copy; each task or request has a change set, and "put it back" restores the files | Makes "full commander" safe to use: a wrong edit is one sentence to undo | A |
| 3 | **The owner's real requests become the brain's test.** The journal already holds what the owner said and what was done and kept. Those pairs become private test cases on Spark 2, replayed against a candidate brain on the stand-in fleet | "Any brain" is then judged on this owner's actual use, not only 24 written cases | B (brain trial) |
| 4 | **A behaviour gate for updates.** A change that touches the prompt, tool texts, tool groups or the rails must not lower the everyday-request score: the trial runs on the brain in use before the owner's button | Code tests cannot see Sparkie getting worse at understanding; this can | C (self-change), B |
| 5 | **A healing drill on real hardware.** Part of the self-test, on request: crash a small test model on purpose and watch self-healing bring it back | Every healing test today runs on the stand-in fleet; healing is what the owner cares about most | D (self-test) |
| 6 | **Ways-in health, weeks ahead.** Read-only looks on the hub: the Tailscale key's expiry, linger, Funnel on, disk space, the token for GitHub. A needs-you line 14 days before trouble | A lapsed Tailscale key takes every way in with it; today nothing warns | E (needs list) |
| 7 | **Health trends from the journal.** The brain's speed per turn and each Spark's temperature and power while it works. A drop to half the usual speed, or a GPU stuck at low power, becomes one notice with what is known about it | An always-on brain that slowly degrades is otherwise noticed only by feel | B (journal), E (report) |
| 8 | **News leads to a try.** When the owner next talks about models, Sparkie can say "a newer model that fits your Sparks came out; try it against your current pick?", from the news feed and the kept winners. Only on the owner's turn, never by itself | Keeps the fleet current without a schedule | C (news), D (compare) |
| 9 | **A track record.** The report carries Sparkie's own score: tasks finished, wrong changes (must be zero), corrections, undos. A wrong change drops the brain's grade to "careful" until the owner lifts it | Trust that is earned and can be lost, by code | E (grade, report) |

### "Just like you": the parity check (owner, 2026-11-13: "shud be just like u")

What makes a coding agent effective, and where each piece sits in the designs.

| A coding agent has | Sparkie has (design) | Gap |
|---|---|---|
| Read, edit, run commands, search and read the web | Looks on any host, the work box, host changes, `search_web`, `read_page` (A revised) | none after A's revision |
| A permission model: allow rules that grow, a sandbox, a short refused list | "Always allow", buttons, the refused list (A revised, addition 1) | none |
| A visible task list and a wrap-up | Live steps (A), tasks with checks and a budget, the report (E) | none |
| Project instructions loaded at the start; skills for kinds of work | `AGENTS.md`, `guide`, one card per kind of work (F) | none |
| Memory that grows: an index always in view, notes fetched when needed | 40 lines of the owner's words, plus lessons and the journal (B) | **Addition 10** |
| Sub-agents: a fresh context to read widely and bring back a summary; an independent reviewer | A reviewer only for Sparkie's own code changes (C) | **Addition 11** |
| Background work with a notice when it ends | Operations, carry-on, tasks, the needs-you line, Telegram | none |
| Checks its own work before saying done | Done checks, the self-test, the behaviour gate, the reviewer | none |
| Undo | Put-back, undo of list changes, `/undo update` | none |

| # | Addition | Why | Lands in |
|---|---|---|---|
| 10 | **Memory that grows like a coding agent's.** The 40 lines become an index (one line per note, always in the prompt); the notes themselves are files on Spark 2, fetched with `recall` or `guide` when a line is relevant. Still only the owner's words add or change a note | "Memory is not an issue and we want to make this the super brain": 40 lines is a ceiling the owner will hit | B (beside `20-memory.mjs`) |
| 10b | **Owner on addition 10 (2026-11-13): "SOUNDS GOOD BUT WOULD PREFER A BETTER MEMORY METHOD INSTEAD."** The index-plus-notes idea is withdrawn. A seventh design, `g-memory.md`, researches current agent-memory methods and designs the store, the truth-keeping over time, the ranking and the budget. Helpers (11) stay | The owner wants a super brain, not a coding agent's file memory | G |
| 11 (open) | **Owner, a minute later: "or whats the best way, im no expert, run fable to figure out."** Not fixed either way. Design G decides on evidence: memory alone, memory with a narrow helper, or memory first and a helper only if a measured need appears. Until G reports, plan for memory alone. Earlier words, for the record: | | |
| 11 (earlier) | **Owner, 2026-11-13: "would prefer avoid helpers and have it straight to memory."** Helpers are cut. What they were for (reading widely without filling a small model's context, and a second look) falls to the memory design: retrieval that returns ranked, short pieces within a budget. Do not build `look_into`. The original text follows for the record only | | |
| 11 (was) | **Helpers: a fresh context for reading.** One lookup, `look_into {question}`: a separate short turn with read tools only, on one of the brain's free places, that returns a summary of at most 1,500 characters. Used to read widely (logs, the journal, pages) without filling the main turn, and as a second look at a plan before a risky change | A 27B model's context is its scarcest thing; this is how a coding agent stays sharp on long work. It also gives an independent check for everyday work, not only for code | A (the loop), E (slots from the profile) |

## 6. For the two critics (after all six are in)

- Safety critic: the box wall, the pull-based install, the journal (secrets the mask misses), lessons as a steering
  path, anything that could lock the owner out, anything that wakes or stops something by itself.
- Simplicity critic: about 60 build steps across six designs. What is the smallest set that delivers the owner's
  goal? What can a 27B model actually drive? Which state files, actions and rules could be one instead of two?

**Rule numbers (2026-11-13, late).** The smart-plug work already uses R41 for its plug and power rule. The next phase's new rules therefore take R42 (Sparkie's reach), R43 (learning), R44 (documents and parts) and R45 (memory), one higher than the designs say.
