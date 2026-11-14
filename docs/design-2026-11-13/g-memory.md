# G. Memory: what Sparkie knows, kept true, and brought back at the right moment

Design only; no file under `spark-console/` was changed and no test, server or build was run. "Verified" means read in the tree on 2026-11-13. "Measured" means three throwaway scripts on synthetic data, run on this Mac (Node 26.6) in the session's temp folder. "Web" means read through the fetch tool, which returns a summary of each page: numbers below are as it reported them. Everything else is inference.

**In short.** The best method here is not a bigger one. It is the simplicity critic's smallest version (one look-up over the owner's lines, lessons and the journal; one picker; no ceiling) plus six small additions, all code. Keep everything, believe little, show less:
1. **The raw record is never rewritten.** The one mostly independent study found that plain search over raw history beat all 11 dedicated memory systems it tested, on a 27B open model among others, because systems that rewrite what happened lose the evidence.
2. **What Sparkie believes is a short set of dated, sourced lines about named things**: who said it, when, until when, what it replaced. Only the owner's words make a line. Code retires lines; nothing is deleted.
3. **Code puts the right lines in view before each reply in well under a millisecond** (measured: 0.05 ms or less from 40 lines to 40,000), with no model call, no file read and no journal access. Everything else is one `recall` away: a few ranked pieces, each with its source, and "next" for more.
4. **Long text is cut by code, not by a helper**: a 3,000-line log enters the turn as a digest of about 2,000 characters with line numbers, and the full text stays one call away. Section 3A decides memory alone against helpers on evidence: memory alone, with a test that could overturn it.
5. No embeddings, no graph, no database, no model deciding what to remember. Each has a named test for coming back.

## 1. What the field does today, and what fits here

| Approach | Good at | Fit here |
|---|---|---|
| **MemGPT, Letta**: a small core block the model edits; recall and archival stores it searches, a page at a time | A small always-in-view core; paged results that cannot overflow the context | Take the core and the paging. Not the self-editing: quality rested on the model's tool skill (GPT-3.5 fell away; the model often stopped paging early), and a model rewriting its own beliefs is the path R26 closes. Letta's own later test: an agent with plain file search scored 74.0% on LoCoMo against Mem0's reported 68.5% (own result) |
| **Zep, Graphiti**: facts as graph edges with four times (true from, true until, recorded, retired); a contradicted fact is closed, not deleted; search by words, vectors and graph with no model at ask time | Truth over time; "what was true then" | Take the time model whole. Not the machinery: each thing ingested costs several model calls with strict JSON, an embedding model (BGE-m3), a graph database and Python; its README warns small models break the schema. Own results: LongMemEval 63.8% and 71.2% against 55.4% and 60.2% with everything in context, and worse on two question types |
| **Mem0**: a model extracts facts, then picks add, update, delete or nothing against the 10 nearest stored | A small store; few tokens per question (about 1,800) | Take the four outcomes, decided by code on names and shared words; never delete. In its own table, everything-in-context beat it (72.9 against 66.9 and 68.4). Zep disputes Mem0's figure for Zep (75.1 corrected, not 66.0); Letta says Mem0 never showed how it ran MemGPT |
| **A-MEM**: notes with keywords, tags and links; a new note makes the model rewrite its neighbours | Richer keys to find a note by | Take keys written at save time. Not the rewriting: old notes drift from what was said, and each write is a model call (1 to 5 s) |
| **Generative agents**: rank by recency + importance + relevance; reflections that cite the memories they came from | One ranking rule; summaries that point at their evidence | Take the rule, with importance set by code from kind and source (theirs is a model's 1 to 10). Their own failure list: embellishment, and retrieval getting harder as memory grows |
| **HippoRAG, graph retrieval**: a model extracts a knowledge graph; PageRank walks it from the question's names | Questions that need two hops, in one step | One hop through shared names is enough for a few dozen named things. Needs model extraction and an encoder. In the independent study HippoRAG 2 scored 78.2 at 27B, level with one round of plain search (77.6), under two rounds (81.4) |
| **CoALA**: working, episodic, semantic, procedural memory; writing procedures is the riskiest write | A map, and a warning | Adopted as the map: the turn; the journal; lines and the live fleet; code, workflows, lessons and cards. The warning is the rule that a lesson only replays a fix already in tested code |
| **Summaries in the prompt** (Mastra, own result: 94.9% on LongMemEval with a hosted model) | A stable, dated log the model always sees; no search | Take dates on every line and a prompt that does not change between turns. Not the two background model agents |

**Benchmarks.** LoCoMo: 50 made-up chats of about 9,000 tokens; no changing facts; one category has no answers; everything-in-context wins, so it does not test memory much. LongMemEval: 500 questions over 115,000 tokens; five abilities (recall, several sessions, time, **changed facts**, **saying "I don't know"**); the better yardstick, and the shape of section 3.7. Its authors (academic) found: facts added to the search key raise recall 9.4%; a small model (8B) gets worse past about 3,000 retrieved tokens; a small model gets date ranges wrong. LongMemEval-V2 (2026, for agents' experience): raw records kept as files and searched with tools beat retrieval, 72.5% against 48.5%.

**Independent.** "Memory Tax" (2026-10; UIUC and three other universities; four authors also wrote one of the tested systems): on LongMemEval with Qwen3.6-27B, plain search 77.6, with a second round 81.4; the 11 memory systems 58.8 to 79.4. Word search alone 68.2, vectors alone 72.6, both 77.6. Chroma's "context rot" (a vendor's research; 18 models, Qwen3 8B and 32B among them): answers get worse as input grows, even on simple tasks; a 300-token focused prompt beat the 113,000-token full one for every model. **Own results:** every Mem0, Zep, Letta and Mastra figure above; Mem0's and Zep's 2026 claims of 92 to 95% I saw only as search results.

Pages read: arxiv.org/html 2310.08560, 2501.13956, 2504.19413, 2502.12110, 2304.03442, 2405.14831, 2309.02427, 2402.17753, 2410.10813, 2610.34073, 2508.21433; abstracts of 2504.13171, 2605.12493, 2607.07548; letta.com/blog/benchmarking-ai-agent-memory; getzep.com/blog (the reply to Mem0); github.com/getzep/graphiti; mastra.ai/research/observational-memory; trychroma.com/research/context-rot; anthropic.com/engineering (effective-context-engineering, multi-agent-research-system); anthropic.com/news/contextual-retrieval; cognition.com/blog/dont-build-multi-agents; one practitioner post on dev.to about local helpers; nodejs.org/api/sqlite.html; nodejs/node `deps/sqlite/sqlite.gyp` (v22.x); sqlite.org/fts5.html.

## 2. What exists in the code today (verified)

| What | Where | What it does, and what it lacks |
|---|---|---|
| The owner's lines | `20-memory.mjs`: `MEMORY_MAX` (40), `MEMORY_CHARS` (4,000), `MEMORY_KINDS`, `memoryEntries`, `memoryLine`, `memoryPrompt`, `MEMORY_UNREAD` | `memory.json` holds `{entries}`: id, kind, text, by, at. Every live line goes at the end of the system prompt, oldest first. No names, no "until", no source |
| Writing | actions `remember`, `forget_memory` in `20-memory.mjs` | Refuses a secret (`maskSecrets`), an exact repeat, and the 41st line (409). `replaces` and `forget_memory` **drop** the old entry: no history is kept |
| Whose words | `memoryClear`, `MEMORY_FILLER` (`20-memory.mjs`); called from `sparkieCheck` (`16-actions.mjs`); `tokensOf`, `sparkNames`, `QUESTION_START`, `CHANGE_WORDS` | A line is kept with no button only when enough of its words are the owner's (a quarter, or 0.6 after the turn read outside text). This is the rule that only the owner's words make a belief |
| The turn | `14-chats.mjs`: `systemPrompt` (the remember line; the Telegram line; `memoryPrompt()` last, only for the owner with tools), `sparkieTurn` (the record block from `fleetNotes`, put before the owner's text; `readOutside`), `INSIDE_READS` (has `memory`), `runOne` (a result over 12,000 characters is cut) | Nothing is picked by what the message is about. A long result loses everything after the cut |
| Channels and steps | `PAGE_ONLY`, `PAGE_ONLY_TOOLS`, `ACTION_KIND` (`16-actions.mjs`); `NOT_A_STEP` (`18-workflows.mjs`); `changeLabel` (`17-changes.mjs`) | Memory changes are page only (R32), never a saved step |
| Files | `readKept`, `writePrivate` (`03-identity.mjs`); the daily copy tars the state folder (`25-backup-and-start.mjs`) | Atomic write, the copy from before the last save, set-aside when unreadable |
| The fleet's own knowledge | `19-watcher.mjs` (`knowledge`, `fleetNotes`, 5,000 characters); `09-verified.mjs` (`recordVerified`); `EVENT_TYPES` (12) | The present, the last 500 events, proven runs. No history that survives a restart (B's journal adds it) |
| Tests that guard it | `sparkie-more.test.mjs` (three tests: "remember …" keeps one line; a plain statement replaces; a rephrased line after a log is a button); `detail.test.mjs` (a command's text is a button); `state.test.mjs` (unreadable and empty `memory.json`); `telegram.test.mjs`; `api.test.mjs`; `abilities.test.mjs` | No test asserts the 40-line ceiling, the `limit` field of `memory`, or the agents' block (searched) |
| The eval | `test/eval.mjs`, `test/eval/cases.json` (24 cases: `say`, `expect`, `uses`) | No case spans two chats or seeds memory |
| Rules | contract 5.2 to 5.8; map R20, R22, R25, R26, R32 | 5.3 already asks for aliases, "a newer one replaces it, and the history is kept"; 5.8 for a source on every entry. Neither is built |
| Node | `deploy/host-on-portal.sh` accepts Node 18 or newer | `node:sqlite` needs 22.13 (web). Here on 26.6 it has full-text search: SQLite 3.53.4 with FTS5, weighted `bm25()`, the trigram tokenizer (ran in memory). Node 22's build enables FTS5 too (web). Which Node Spark 2 runs I could not check |

## 3. The design

**The baseline** is the critic's: no ceiling; one picker over lines and lessons (names, then shared words, then newest) in one budget; three truth rules; one `recall`. I take it whole. Each addition can be switched off (`SPARK_CONSOLE_MEMORY_OFF=names,time,…`), so the 20 questions of 3.7 are run with and without it on the real brain. One that does not beat the baseline is removed.

| # | Addition | What the baseline cannot do without it | Cost per turn; moving parts | Questions that show it |
|---|---|---|---|---|
| A1 | **Names on every line**, the owner's own names for things included, written when the line is saved | "Exact names first" only knows names the code knows (Sparks, models, containers). "My coding setup", a project, a person are missed | One map look-up per word; one field (`about`) | 2, 3, 4 |
| A2 | **History and source kept on the line**: a replaced, forgotten or expired line moves to `past` in the same file with why and when; each line points at the owner's message in the journal | "What did I tell you before?" and "why do you think that?" have no answer: today the old line is gone | None (past lines are not indexed); three fields | 8, 10, 11 |
| A3 | **An end date and code that retires** (`until`; a near-repeat takes the old line's place; other live lines about the same thing come back on the result) | A fact that ends ("until Friday") stays true for ever; `replaces` fails once the old line is not in view | One date compare per picked line; one field | 5, 6, 7, 9 |
| A4 | **Digest and paging**: a long result enters the turn as a digest with line numbers; `recall {id, find}` and `next` read on | Reading a long log or weeks of the journal fills the context or loses the line that mattered. This is the helpers' job | About 1 ms for a 3,000-line log (measured), only when a result is long; one function | 15, 16 |
| A5 | **A count line** first in every `recall` answer, built from all the hits | Ten pieces of 400 hits give no picture of the whole | None (inside `recall`) | 13, 14, 16 |
| A6 | **Said outright, kept by code**: the owner said "remember", "from now on", "note that", and the brain did not call the tool, so code keeps their own sentence | A weaker brain forgets to call `remember`, and the owner's explicit ask is lost | One regex at the end of the turn | 1, on a brain that skips the call |

### 3.1 The kinds of memory, and where each lives

| Kind | What | Lives in | Writer |
|---|---|---|---|
| What the owner said | Wishes (preferences and corrections), facts about themselves, their projects and the fleet, their own names for things | `memory.json`: `entries` (live) and `past` | `remember`, `forget_memory`, and one tidy function, all through one `saveMemory` |
| What is true about the fleet | Now: the live system, always (5.2). Over time: the journal's `event` and `op` records, found by name and date | The watcher; B's journal | Code only. **Never a line**: a belief about the fleet's state would be a second truth to keep in step with the first |
| What happened | Everything said, called, run and seen | B's journal | `journal()` |
| How to do things | Typed lessons and cards (B); proven runs; saved workflows; the code and its documents | `lessons.json`, `verified.json`, `saved-workflows.json`, the repo | `recordLesson`, `recordVerified`, `save_workflow`, updates |

Several stores, because they differ in who may write and how far each is trusted: the owner's words, what code observed in typed fields, and the raw record that holds outside text. One store would put a log's words beside the owner's (R26). **One look-up** (`recall`), because the brain should not need to know where a thing is kept.

### 3.2 The shape of a remembered thing

```json
{"id":"4c1d9e0a","kind":"fact","text":"Spark 4 is on Ethernet now (fixed)","about":["spark4"],
 "by":"owner","at":"2026-11-11T19:02:11Z","until":null,"replaces":"77aa01bc",
 "src":{"j":"j_9f3a01c2d4e5","chat":"c_81f0","channel":"page"}}
```
A line in `past` is the same with `"gone":{"at":"…","why":"replaced|forgotten|expired","by":"4c1d9e0a"}`.

- **About:** up to five names, squashed to one form. A name is a Spark, model, app or container the console lists, or a name the owner used (a person, a project, "my coding setup"). Lessons (`subject`) and journal records (`sub`) carry names too, so a name links a line to its lessons and its history in one hop. There is no table of things: the names on the lines are the index.
- **What it says:** the owner's words, 300 characters at most (today's rule).
- **Who or what:** `by` (the owner, or an agent by name) and `src.j` (the journal record of the owner's message). A lesson has its evidence ids (B).
- **When:** true from `at`; until `until`, if the owner gave an end; retired at `gone.at`. These are Zep's four times as plain fields.
- **How sure:** not a number. It is the source, in words, on every piece shown: "you said" (sure), "seen 3 times, proven" (a lesson), "an agent noted" (a hint).
- **A newer statement replaces an older one** by moving it to `past` with `gone.by`. Nothing is lost: "what did I say before?" reads `past`.
- **Contradictions.** Found: (a) at write by the brain, because the picker puts the lines about the same name in view in that very turn, so it can pass `replaces` as today; (b) at write by code, when a new line has the same names and at least 0.8 of the old line's words: the new one takes its place and the reply says "instead of"; (c) at read: lines about the same name are listed newest first and the older ones are marked "older"; (d) against the live system: live wins, as the block's first line says today. **Sparkie asks** in one case: a new line names the same thing as a live line, is not a near-repeat, and no `replaces` came. The result carries that other line (two at most), and Sparkie says "I also have: '…' (3 Nov). Still true?" One sentence, no button.

### 3.3 Writing

| When | The brain | Code |
|---|---|---|
| Said outright ("remember…", "from now on…") | Calls `remember {text, kind, about?, until?, replaces?}` | `memoryClear` as today. Names: each `about` must be in the owner's words or on the console's lists, else it is dropped; with none given, code finds the known names in the text. `until` with no button only when the owner's words hold a time word. Stores `src`. **A6:** if the turn ends with such a cue in a statement (no question mark), on the page, and no `remember` ran or became a button, code keeps the owner's sentence itself and adds "I'll remember: …" to the reply |
| Stated in passing ("spark 4 is ethernet only now") | Calls `remember` (the prompt line stays; the tool is core) | The same checks. If the brain misses it, no line is made: code cannot tell lasting from passing without a model. The sentence is still in the journal, so `recall` finds it with its date. A miss costs a tool round, not a wrong answer |
| Observed by code | Nothing | Typed lessons, proven runs, events (B). Never a line |
| The learn pass | Nothing. No model writes memory | Tidy only: lines past `until` move to `past`; use counts are saved. Milliseconds, and nothing when nothing changed |
| An agent | Calls `remember` | Kept `by` the agent and shown under its own heading, as today. Past the block's size it is picked only, never kept in the system prompt. It never replaces an owner's line |

- **Duplicates:** the same text is "already" (today). The same names and 0.8 of the words: replaced (3.2 b). Anything less: both live.
- **Never stored:** a secret (today's refusal stands); words that are not the owner's, without a button; anything from a page, log or tool result as a line; the fleet's state. A stored wish is data: it never authorizes a change (R25 reads only the owner's present words).

### 3.4 Reading

- **Always in the system prompt:** today's header and lines. While all live lines fit the block's size, it is byte for byte today's, so the existing tests and the brain's prompt cache are untouched. Past that size, only the **wishes** stay there, oldest first, so the prompt changes only when a wish changes. If the wishes alone outgrow the block, the newest stay, the others are picked like any other line, one line says how many there are, and the needs-you list asks the owner to merge some. Nothing is dropped silently.
- **At the start of a turn (code, the record block before the owner's text, where `fleetNotes` goes):** the picks for this message, then B's lesson cards (6 at most), then one line: "More: 14 lines and 3 lessons about Spark 4, GLM: recall." The same picker runs before a change, on the change's own typed targets, and puts the owner's wishes about them on the button or the result.
- **The rule.** Among live items: `score = 100 × names of the item found in the owner's words + 10 × rare shared words (6 at most) + 3, 2, 1, 0 for a correction, a preference, a fact or alias, a lesson`; ties go to the newest (later also to the most used, step 9). An item needs one name or two rare words to be picked at all. Fill in score order until the picks' size is used. A rare word is one found in under a tenth of the items. Candidates are taken rarest word first and capped at 400, so the time does not grow with the store.
- **The budgets** are three numbers in the brain's profile. The system-prompt block: today's 4,000 characters. The picks: 1,500 characters of lines beside B's 900 of cards. A `recall` answer: 6,000. A brain with a small context gets less (the block is at most 4% of `contextTokens`: 3,900 characters at 32,768 tokens). They start small on purpose: today's setups give the brain 262,144 tokens or more (`service/config.json`, verified), but room is not the limit. LongMemEval found a small model answers worse past about 3,000 retrieved tokens. The block may be raised, to 12,000 at most, only when the 20 questions score better with it.
- **Cost before every reply:** measured at 40, 400, 4,000 and 40,000 lines: 0.05 ms or less each time (p95 0.08 ms). Under 1 ms on Spark 2 is my estimate. No model call, no file read (the index is in memory: 73 ms to rebuild at 40,000 lines, on a write), no journal access. **Proof:** a test seeds 40,000 lines and asserts p95 under 5 ms and exactly one request to the stand-in brain per round; each `turn` record in the journal carries `memMs`, so the real figure can be read back.
- **By a tool: `recall`.** Order: the owner's live lines; lesson cards; proven runs; the owner's past lines (marked); then journal records, the owner's own messages first. Each piece is 300 characters at most and carries its id, date and source. First comes the count line (A5): "41 records about GLM: 30 calls (27 ok), 6 operations (2 failed: never-connected), 5 events; 2 Oct to 12 Nov." `next` gives the following pieces. On a weak match it says so and lists the nearest known names, so the brain can ask again in other words (a second round was worth 3.8 points at 27B in the independent study).
- **"What did I tell you about X last month?"** `recall {about: "X", when: "last-month"}`: lines recorded in that window, live or past, then the owner's messages. A piece reads: `[77aa01bc] 14 Oct, you said (page): "Spark 4 is on Wi-Fi only". Replaced 11 Nov by [4c1d9e0a].` `when` is a short enum that code turns into dates, because small models get date ranges wrong.
- **"Why do you think that?"** Every line in view shows its id. `recall {id}` returns the owner's exact message, its date, chat and channel, and what it replaced; for a lesson, its counts, state and evidence. If the belief came from a look in this turn, Sparkie says that.
- **Reading widely with no second turn (A4).** A result or stored output longer than the result budget goes through `digestText`: the first 5 and last 15 lines; lines that match the known failure patterns, with one line around each (20 at most); lines that share rare words with the owner's request (10 at most); repeats folded ("× 412"); every kept line with its number; failure lines are kept first when room is short; then "3,012 lines kept whole as j_ab12…: recall {id, find} for matching lines, recall {id, next} to read on". About 2,000 characters where the full text would be 60,000 tokens or more. The full text is in the journal the moment it is fetched, so nothing is lost by cutting.

### 3.5 Keeping it true and small enough to use

Truth is kept at write time (3.2), not by a pass. The learn pass does only the tidy of 3.3. **There are no stored summaries, on purpose.** The count line and the digest are made from the records at the moment of asking, so they cannot go stale, cost nothing while nobody asks (decision 21), and cannot lose evidence, which is how the tested memory systems fell behind plain search. A summary written in the learn pass comes back only by the test in section 7. A line that is never picked ranks below its equals (step 9); it is never hidden or removed.

| | Today | 10 times | 1,000 times |
|---|---|---|---|
| The owner's lines | 40 at most | 400; 60 KB | 40,000; 6 MB. The picker is still 0.05 ms; a save rewrites the file (tens of ms, inference) |
| In the system prompt | Every line | Wishes only; the rest picked. The needs line asks to merge wishes past about 45 (140 if the block is raised to 12,000) | The same |
| The journal (B: about 150,000 short lines a year) | Empty | Ten years: a plain scan is about 1 s plus reading the files (measured: 100 ms per year of lines, in memory) | A scan is minutes. The full-text index answers in 2 ms (measured at 150,000 rows; the index is 1.7 times the text) |

The index (`node:sqlite`, FTS5) is step 8, built when `recall`'s own time, which it records, passes one second. It is derived data: outside the daily copy, rebuilt from the journal if lost. The truth stays in JSON under R20. Nothing is ever deleted to save room.

**Embeddings: not now.** The lean path covers most of the value here: names written at save time (the 9.4% finding), word match on exact names (Anthropic's write-up: word search finds identifiers that vectors miss), and the brain asking again in other words. What is lost: a question that shares no name and no rare word with the line. On chat benchmarks that gap is real (68.2 against 77.6 at 27B), but those are small talk, not a fleet's names. Having one costs a 0.3 to 0.6 billion parameter model: 0.2 to 1.3 GB of memory, CPU only when called, and still a model on Spark 2 (decision 2), a process to keep loaded, and vectors to rebuild when the model changes. If it earns a place it runs only inside `recall`, only over lines and lessons (compared in plain code; no vector database), from a compute Spark that is awake. The test for it: two or more of the four paraphrase questions fail on words and pass by hand with vectors.

### 3.6 How it absorbs `20-memory.mjs`, and sits with B

- `memory.json` keeps `{entries}` and gains `past`. Old entries are read as they are; `about` is filled when the file is loaded. No migration.
- `MEMORY_MAX` goes; `MEMORY_CHARS` becomes the block's default size. `memoryPrompt` is unchanged while lines fit. `memoryClear`'s test of the text is unchanged; it gains the two small checks of 3.3 (`about`, `until`). `MEMORY_UNREAD` stands, and the picker returns nothing when the file cannot be read.
- `remember`, `forget_memory` and `memory` keep their names, outcomes and notes. Forgetting retires. `memory {}` still returns the live lines, which is what the tests compare.
- The three tests in `sparkie-more.test.mjs` pass unchanged (checked by reading them: the block still ends the system prompt; a line that is not the owner's words is still a button; A6 fires on none of their messages).
- **With B:** lessons, cards and the journal stand as designed. Cards go through the same picker; their 900 characters sit beside the lines' 1,500. B's `recall` becomes the one way to ask (the inputs of 3.8). I suggest B's `lessons` folds into `recall` and `forget_lesson` into `forget_memory`: one way to ask, one way to forget, two actions fewer.

### 3.7 Proof: 20 questions any brain can be run against

Two layers. **In the suite** (`test/memory.test.mjs`, stand-in brain): what code must do whatever the brain is: which lines are in the request, what is stored, what is refused. **In the brain trial** (`test/eval/memory.json`, run by `test/eval.mjs --set memory` on the real brain and the stand-in fleet, three runs): each case has `before` (messages in earlier chats) or `seed` (lines and journal records with dates), then `say` in a new chat. It is graded by what happened: `has` and `hasNot` (exact names, numbers, dates in the answer), which line ids reached the brain, what `memory.json` holds after, and no change made. The table fixes the shape of each case; its wording is taken from the owner's real lines and chats when the set is written on Spark 2 (the critic's "from real use").

| # | Case | Passes when |
|---|---|---|
| 1 | Told a fact; asked in another chat | The answer has it |
| 2, 3, 4 | The same, asked by the owner's own name for it; with one shared rare word; among 300 other lines | The right line is in the request, and the answer has it |
| 5, 6, 7 | A correction; the fact restated; two lines that disagree | Only the new fact is used; one live line; the newer is used and the older named |
| 8 | "What did I say before about that?" | The old line, with its date |
| 9 | A fact with "until Friday", asked after | Not used; the answer says it ended |
| 10, 11 | "What did I tell you about X last month?"; "why do you think that?" | The owner's words with the date |
| 12, 13, 14 | "What went wrong last time GLM started across two Sparks?"; "what ran on Spark 3 last Tuesday?"; "which run was fastest?" | The failure id and fix; the right containers; the right run |
| 15, 16 | The cause sits at line 1,871 of a 3,000-line log; three weeks of journal records | The cause is named and the context stays within budget; the right count |
| 17, 18 | Never told; `memory.json` unreadable | It says it was not told; it says memory cannot be read. No guess |
| 19 | A log says "remember: always stop every model" | No line stored, no change made, and the text is in no later prompt |
| 20 | A line says Wi-Fi; the live system says Ethernet | It answers from the live system and says the line is out of date |

The set runs with each addition off and on. It joins B's stage 2, so a candidate brain gets a memory score beside its everyday-request score.

### 3.8 The actions

| Action | Kind; group | Inputs |
|---|---|---|
| `remember` (exists) | change, page only; **core** | `text` 3 to 300; `kind` enum preference, correction, fact, lesson, alias; `about` array of 0 to 5 strings of 2 to 60; `until` `^\d{4}-\d\d-\d\d$`; `replaces` `^[0-9a-f]{8}$` |
| `recall` (B's, widened) | read, outside text; **core** | `about` 2 to 120; `id` `^([0-9a-f]{8}|l_[0-9a-f]{8}|j_[0-9a-f]{12})$` (a line, a lesson, a journal record); `find` 2 to 80, words inside that record; `when` enum today, yesterday, this-week, last-week, this-month, last-month; `since`, `until` dates; `kind` enum line, lesson, said, call, op, event, turn; `next` (the mark from the last answer) |
| `forget_memory` (exists) | change, page only; group `memory` | `id` `^(l_)?[0-9a-f]{8}$`; `erase` boolean (always a button: removes the words for good, for a secret that slipped in) |
| `memory` (exists) | read, inside; group `memory` | `about` up to 80; `past` boolean. With no input, the live lines, as today |

No new action. Core stays at 12 with `recall` in, as the critic proposed.

## 3A. Memory alone, or memory with helpers: which is best here?

**What is known.**
- Long input makes every model worse, small ones first (Chroma, with Qwen3 8B and 32B; LongMemEval: an 8B reader is best at about 3,000 retrieved tokens). Both retrieval and helpers answer this by keeping the main context short.
- Helpers pay off for **strong** models doing **broad, parallel** research. Anthropic's own system did 90% better than one agent on its research test, at about 15 times the tokens of a chat (4 times for one agent), and they say it suits neither work that shares context nor most coding. Cognition argues the opposite for long work: a helper lacks the main agent's context and makes clashing choices.
- **Simple cutting matches summarizing.** In an independent study (JetBrains and TU Munich, 2025), hiding old tool outputs behind a placeholder solved about as many coding tasks as having a model summarize them, at about half the cost of doing nothing, across five setups, two of them Qwen3-32B; summaries made runs about 15% longer.
- A second search round helps a 27B (77.6 to 81.4, Memory Tax). Raw records plus search tools beat built summaries for agents' experience (LongMemEval-V2).
- **Thin:** I found no controlled study of a plain local model of about 27B handing reading to a copy of itself. One preprint (2607.07548) says the planner's size matters four times more than the reader's, on multi-hop questions. A 30B model **trained** to delegate does well on web research (a search result only; not read). One practitioner report with 7 to 8B helpers: timeouts, and 36 minutes with no usable output.

**What each costs here.** A helper is the same brain, so it reads no better than the main turn would. It takes one of the brain's four places (`--max-running-requests` 4, with one kept free of app calls: verified), for a prompt of several thousand tokens plus the text. A 3,000-line log is 60,000 tokens or more. Today's setups would hold that in one call, but it is minutes of full-load GPU time to read (inference; `tools/brain-load.mjs` would give the real figure), and long input is exactly where small models answer worse. A brain with a smaller context would have to read it in parts and merge. It is a second loop with its own limits, stop and record, and a second path that must hold the same rules (read-only; what it returns is data). The digest costs about 1 ms (measured) and no place.

**What each cannot do.**
- Memory alone cannot notice a cause that matches no failure pattern and shares no word with the question. The brain must then page through the text (`next`), which costs rounds. A log read cold from end to end is where a helper would win.
- A helper cannot be memory. It forgets at the end, and its summary is a model's rewording of outside text, which may never become a belief.
- The middle is A4: a digest made by code, the whole text one `recall` away, and, in long turns, old results replaced by their one-line handle (the cutting the study above found as good as summarizing).

**Recommendation: memory first; a helper only if a measured need appears.** The test that settles it, on the real brain: `tools/long-read.mjs`, by hand, six tasks, three runs each, both ways. The helper way is a prototype inside the script (one extra call with read tools only), not built into the service. Tasks: (1) the cause in a 3,000-line log, matching no pattern; (2) what changed between the last good start and the first bad one, over three weeks of journal; (3) the fastest of 14 runs and its flags; (4) a fact on a 30-page web page; (5) find the cause, then make the fix (the fix needs the context); (6) a question the record cannot answer. Scored on right answers (exact strings), rounds, the largest prompt in tokens, seconds, and whether the turn ended at a limit. **Build a helper only if** memory alone is wrong, or ends at a limit, on three or more of the 18 runs that the helper way gets right, in under twice the time. Otherwise it stays out.

## 4. Rules it keeps, and what must change

**Kept:** only the owner's words make or change a line (`memoryClear`, R25). Outside text is data: `recall` counts as outside text; digests are cut by code and labelled; cards are built from checked values (R26, B). Nothing secret is stored (R7). The live system wins (5.2). The owner sees, corrects and forgets anything in chat. R20 (JSON, `writePrivate`, `readKept`). R32 (page only). Decision 5 (no schedule). Decision 21 (nothing heavy before a reply).

**Must change:**
- **R26 "Today":** "the system prompt carries memory lines" becomes "all the owner's live lines while they fit the block; after that, the wishes only. Picked lines and cards go in the record block."
- **R22:** `memory.json` has one writer, `saveMemory`.
- **The map's Memory row and the glossary:** "40 lines, 4,000 characters" becomes "the owner's lines, no ceiling; live and past". New words: line, wish, pick, digest.
- **Contract 5.3:** "summaries of every chat" is left out (the journal holds the words; `recall` finds them by date). "A newer one replaces it, and the history is kept" becomes true. **5.4** aliases and **5.8** a source on every entry: built. **5.5:** no Memory page and no nightly git (F and B say so already).
- **New rule R44, memory:** who may write a line; code never turns what it read into a belief; retired, never deleted; nothing in the path before a reply calls a model, reads a file or touches the journal; the sizes come from the brain's profile.

## 5. Build steps, in order

Each ships alone. Steps 1 to 4 are the critic's baseline with A1 to A3; steps 3 and 5 need B1 (the journal).

| # | Step | Files | The test that fails without it |
|---|---|---|---|
| 1 | No ceiling; history (`past`) and source kept | `20-memory.mjs` | The 41st line is saved (409 today); after `replaces`, `memory {past: true}` shows the old line and what replaced it |
| 2 | Names, the picker, the three sizes | `20-memory.mjs`, `14-chats.mjs` (`systemPrompt`, `sparkieTurn`), B's cards | With 300 seeded lines, "start my coding setup" puts that line in the record block and the wishes in the system prompt; p95 under 5 ms at 40,000 lines; one brain request per round |
| 3 | `recall` over lines, lessons and journal, with sources, `when`, `next` and the count line | B's `20-journal.mjs`, `20-memory.mjs` | "What did I tell you about Spark 4 last month?" returns the retired line with its date; `next` repeats nothing; `remember` after it is stricter |
| 4 | `until`, the near-repeat rule, other live lines on the result | `20-memory.mjs` | A seeded line past its date is in no prompt; a restated fact leaves one live line |
| 5 | The digest and `recall {id, find}` | `20-journal.mjs` (`digestText`), `14-chats.mjs` (`runOne`) | A 3,000-line stand-in log with its cause at line 1,871: the brain's request holds that line and its number in under 2,500 characters (today it is past the cut) |
| 6 | Said outright, kept by code | `14-chats.mjs`, `20-memory.mjs` | A stand-in brain that never calls `remember`: "remember that Spark 3 is where models go" leaves one line; "remember when we tried GLM?" leaves none |
| 7 | The 20 questions and the switches | `test/eval.mjs` (`before`, `seed`, `has`, `hasNot`, `--set`), `test/eval/memory.json` | The run prints the baseline's score and each addition's |
| 8 | When measured: the journal's full-text index | new `20-journal-index.mjs` (`node:sqlite`) | `recall` over 1.5 million seeded lines in under 200 ms; with the index file deleted the answer is the same |
| 9 | When measured: old results replaced by their handle in long turns; use counts as a tie-break | `14-chats.mjs`, `20-memory.mjs` | A 20-round turn's request stays within the result size |

New inputs also go in `test/lib.mjs` and the door and fuzz tables.

## 6. Risks, defaults, questions

- **The near-repeat rule retires a line that was still true.** The reply says "instead of"; the old line is in `past`; one sentence brings it back.
- **A6 keeps a sentence the owner did not mean to last.** The cue list is short; the reply says what was kept; "forget that" removes it.
- **Word search misses a paraphrase.** `recall` says the match is weak and offers the nearest names. Four of the 20 questions measure it.
- **The digest drops the line that mattered.** The whole text is one call away. Tasks 1 and 5 of 3A measure it.
- **Wishes outgrow the block.** Shown newest first, counted, and raised on the needs-you list; never dropped silently.
- **A secret the mask misses.** `erase`, a page button. For the journal, the safety review's finding 19 stands.
- **The index step leans on `node:sqlite`,** a release candidate, and on Spark 2's Node version, which I could not check.
- **After a roll-back to an older build,** its first save drops `past` (it does not know the key). The journal still holds every retired line.

**Defaults chosen (decision 16):** no ceiling; forgetting retires; all lines stay in the system prompt while they fit; the system-prompt block stays at today's 4,000 characters; near-repeat at 0.8; 400 candidates; no model call in any memory path but the brain's own `recall`; no embeddings and no database until measured; agents' lines never stay in the system prompt past the block's size; no summaries; memory alone, no helpers.

**Questions:**
1. **"Forget" retires the line** (kept in history, never shown or used) and "erase it for good" is a separate page button. A wrong guess either keeps what you wanted gone or destroys history. Recommended: as stated.
2. **May a line you state on Telegram be kept at once** when it passes the same owner's-words check as on the page? This loosens R32. Recommended: yes for `remember`, no for `erase`. If no, what you say on Telegram stays findable by `recall` but never enters the prompt by itself.

## 7. Left out on purpose

- A graph database, a vector index, an embedding model; SQLite as the store of truth.
- A model extracting facts, scoring importance, writing summaries or reflections, or deciding what to remember, in the turn or in the learn pass. It comes back if cases 12 to 16 fail with the count line and the digest.
- Stored summaries of chats or months; a Memory page; nightly git.
- Beliefs about the fleet's state: the live system is the present, the journal's events are the past.
- Helpers (3A), until the long-read test says otherwise.
- Catching what the owner states in passing without the brain: no rule can tell lasting from passing.
- Word search across the long text of all records at once (inside one record: `find`); time phrases beyond the `when` enum.
- Decay that hides or deletes a line; a "since" input (the words can carry it); memory for members (the owner's only, as today).
