# Spark Console: final report before handoff (revised)

Source tree: `/Users/akuppala/Documents/26aiRAG/spark-console`. Read-only review. Nothing was changed, nothing was run against the Sparks or the live console.

**What I re-checked in the code for this revision**
- True: `test/mock/bin` has 14 stand-ins and none for `systemctl`, `systemd-run`, `journalctl` or `sudo`. `test/start-mock.mjs:146` puts the real PATH behind them and never sets HOME.
- True: the brain starts with `--restart unless-stopped` (`service/src/13-main-model.mjs:128`). So Docker already brings back a crashed brain. The keeper in the draft was too wide.
- True: `adoptRunning` (`service/src/09-verified.mjs:117-139`) records only a model that answers, once (`onlyIfNew`). It records the recipe's args, not the running container's. The draft's F22 was worded wrong.
- True: no `.git`, no `agentbar/results`, no `test/quick.mjs`. The words are four (`service/src/20-words.mjs:7`). The map goes to R36, its header still says 32 parts; there are 33. `public/app.js` is 5,382 lines.
- True: `test/lock.mjs:25` passes a glob to node. The installer may use code-server's Node (`deploy/host-on-portal.sh:75`) and asks a terminal when busy (`:322`).
- Not true as the builder judge wrote it: tests do not spawn the real `systemd-run`. The call is behind `if (!ALL_LOCAL)` (`service/src/18-workflows.mjs:474`). `sudo` appears only in advice text. The fail-closed stand-ins are still worth adding.

Ids: F = fix, S = sticky, H = self-heal, A = add, D = docs, G = groundwork, M = milestone. Every id has one batch in section 9, or sits in the backlog, or is cut.

## 1. Verdict

Not ready yet, and the handoff comes in two stages. Everyday fleet work is solid: starts, stops, pair starts, the intent gate, sign-in, recovery codes, Telegram, the stand-in suite. Stage A (hand over fleet work) is blocked by four things: a stopped brain or a full disk closes the chat; an install can strand the console with no way back by chat; no gate can pass on Linux; Spark 2 has no confirmed Node. Stage B (Sparkie changes itself) is blocked by one unknown: nobody has measured whether Qwen can write a passing patch, because the engine trial has never run. After Stage A Sparkie operates and heals the fleet; every code change still comes from Claude Code until Stage B's proof run passes.

## 2. Fix first (confirmed broken, worst first)

| Id | What breaks | Fix | Test |
|---|---|---|---|
| F1 | No gate can pass or run safely on Spark 2. Stand-in Sparks read real memory (`05-library.mjs:52`, `:335`, `13-main-model.mjs:105`). The fleet keeps the real HOME, so it reads real snapshots (`18-workflows.mjs:454`) and could `rm -rf` under real model folders. `lock.mjs:25` needs Node 21+. | Pick the memory file when the script text is built: ALL_LOCAL uses `$HOME/.mock/meminfo`, else `/proc/meminfo`. Real Sparks' command is unchanged. `start-mock.mjs` sets HOME to the fleet folder, an empty releases folder, and a port block away from 30100 and 8000. Add fail-closed stand-ins for `systemctl`, `systemd-run`, `journalctl`, `sudo`. `lock.mjs` lists files itself and names the Node it needs. Clean stale `sct-*` folders at start. | Stand-in Spark 3 and 4 show 64 and 46 GiB with a fake real total. "No earlier build" holds with real snapshots present. One test proves nothing is written outside the fleet folder. |
| F2 | Chat dies. A throw between `14-chats.mjs:212` and `:308` leaves the chat "still answering" until restart. A full disk fails every turn, `/status` and Telegram (`14-chats.mjs:24-29`, `:211`). | Start the `try` right after `replying.add`. `saveChats` never throws; it sets one "can't save" flag. A memory read error gives a turn without memory. | Unreadable `memory.json`: five turns answer, none 409 or 429. Read-only state folder: a chat turn and `/status` answer. |
| F3 | A stopped or missing brain stays down. `/restart sparkie` refuses (`20-words.mjs:54`). Telegram says it restarts by itself (`21-telegram.mjs:18`). A switch stops the brain before checking the new one, then says "back on" when it is not (`13-main-model.mjs:249-260`). | `/restart sparkie` runs `docker start` on an exited brain container; on a missing one it runs the existing main-start job. Fixed lines say what is true. `switchMain` plans first and reports the real outcome. | Exited stand-in brain plus the word leaves it running. Bad switch target leaves the brain untouched. Failed fallback never says "back on". |
| F4 | An install can leave the console broken or stopped. No put-back on a failed copy (`host-on-portal.sh:172-180`). `restore.sh` can leave the unit stopped (`:138-142`). First `/health` counts as good (`:207-220`). Sign-in and chat are never checked. The watchdog skips `activating` (`:257-262`). Undo can restore the running build (`18-workflows.mjs:364-370`). | Bash only. Free-space check. `trap` to restore. `restore.sh` always starts the unit. 40 s settle on the same `startedAt`. Ways-in checks on the socket: `/whoami` with the owner's login read from `access.json` says owner; `/mcp` with no key answers "needs a key" (fail only on 5xx or silence); `/v1/models` lists. One canary turn: ask for fleet status, expect a tool call and an answer. Telegram loop age is fresh. Any miss goes back. If the brain is down before the install starts, refuse and say so. Each snapshot gets a `build` file; undo skips same-build and half-made snapshots. Watchdog counts `activating`; it only restarts. | `test/install.test.mjs`, Linux only, stub systemctl, real curl kept on PATH: healthy install; never healthy, old files back; copy fails, old files back and unit started; canary fails, old files back. |
| F5 | "Tested" covers three files. Page, `worker.py`, `config.json`, `catalog.json` install untested (`01-setup.mjs:17-21`, `host-on-portal.sh:48`, `:56-57`). A config `ownerLogin` can change the owner (`03-identity.mjs:43`). A deleted test still gets a lock. | Lock gains `ships` (hash of every shipped file), a hash of `test/`, `deploy/`, `tools/`, and per-test-file counts with skipped files named. `node test/lock.mjs --check`. Installer refuses a mismatch and a foreign `ownerLogin`. `node --check` on the page files. | Change one byte of `config.json` or `app.js` in a temp copy: `--check` exits 1. A removed test shows in the count line. |
| F6 | Docker not answering reads as "every container removed" and can stop a healthy pair part (`05-library.mjs:36-39`, `19-watcher.mjs:97`, `:161-166`, `20-heal.mjs:81`). | One `docker ok` marker line. Watcher, inventory, healing and `container_logs` treat a missing marker as "couldn't read". | Stand-in `docker-down` switch: no `removed` events, no heal try used, one notice. |
| F7 | A carry-on turn forgets the request came from an internet sign-in, so "then undo the update" runs with no passkey (`14-chats.mjs:369`, `:151-154`, `18-workflows.mjs:495`). | Task keeps `away: true`; the carry-on viewer carries a session marker. | `internet.test.mjs`: no `undo_update` outcome other than `question`. |
| F8 | "Do X, then Y" stalls; a reply that fails after its tools ran is treated as nothing (`14-chats.mjs:136`, `:148`, `:194`, `:208`, `:369-378`). | One `wakeWork` called from result post, turn end and the minute loop. Keep the task on a failed reply with tools. Typed yes keeps the task. One give-up notice. | Job ends before the reply; brain fails once; give-up notice appears. |
| F9 | A one-Spark start over a running copy removes the working container (`07-jobs.mjs:133-134`). | Set it aside as the two-Spark path does (`08-cluster.mjs:349-357`). | Failed restart leaves the old container running. |
| F10 | A second run of a routine restarts a model already running where the step names it (`17-changes.mjs:426`). About 11 minutes down for GLM. | Answer `already` when it runs on the named Spark or Sparks. | Run a one-step routine twice: no second deploy. |
| F11 | Pair start with a hand-started holder: the owner's Yes starts a one-Spark model (`17-changes.mjs:152-153`, `:439`). | Yes button carries `sparks`; auto-placement returns the pair's question. | `across.test.mjs` with an outside container on Spark 4. |
| F12 | Writers save over `desired.json` and `validations.json` after a failed read (`20-desired.mjs:9-13`, `18-workflows.mjs:78`). | Writers read strictly and skip the write. | File swapped for a folder during a stop: both entries survive. |
| F13 | Telegram's loop ends for good on one bad secrets read (`21-telegram.mjs:123`). | Wait 60 s and continue; one notice. | Break the file, restore it, get a reply with no restart. |
| F16 | A powered-off Spark's containers read as running with a fresh time (`16-actions.mjs:808`). Every console restart logs a false "went offline" (`19-watcher.mjs:204-215`). | View-only "unknown, Spark off" with per-Spark time. Save on an online flip. | Offline Spark lists nothing running; one offline event across a restart. |
| F17 | Daily copy: one try, silent when Spark 3 and 4 are off, forgotten at restart, can replace a good copy with a cut one (`25-backup-and-start.mjs:5-34`). It holds no code. | Keep last try and last good in a file. Never pick Spark 1. Retry when a Spark returns. `gzip -t` before the move. One notice a day. Add a source bundle to the same copy. | All other Sparks off gives a notice; the record survives a restart. |
| F18 | Recovery code hidden when no passkey is on file (`24-handler.mjs:69`, `app.js:5199`). | `whoami` adds `recovery: true`; the page shows the button. Fix the last-passkey wording. | Service half: test. Page half: owner checks by hand on the phone. |
| F19 | Page: a locked phone loses the answer (`app.js:4036`); a failed send wipes the words; one missed poll marks a job failed (`app.js:2411`). | Keep the partial reply and poll the saved one; restore the text; keep polling. | Owner checks by hand. Not counted as proven until the page harness exists (backlog). |
| F20 | `save_workflow` saves brain-written steps unseen, also after reading outside text (`16-actions.mjs:285`). The secret mask misses `SECRET_KEY=`, `MASTER_KEY=`, `_PASS=` (`20-mcp.mjs:273`). | Per-step word check, else a button listing the steps. Widen the label rule; mask saved chat text. | Scripted brain reads a log then saves: outcome is a question. Fixture lines are hidden. |
| F23 | Docs and tools state false things: `architecture.md:3`, `:254`; `contract.md:13`; the actions header promises a `confirm` kind (`16-actions.mjs:5-8`); a misnamed part is skipped silently (`build-server.mjs:15`); tool counts are literals (`change.test.mjs:105,120,142`). | See section 7. | `build.test.mjs` checks: map names exist, no 12-hex build id in hand-kept docs, misnamed part throws. |
| F25 | The owner's own failed work pauses everything; only the page resumes (`07-jobs.mjs:62`, `16-actions.mjs:313`). Route errors log nothing (`24-handler.mjs:696-699`). | Exclude `api` and the owner's chat from the failure count. `/resume` for automatic pauses, page chat only. Log every 500. | Three failed owner starts do not pause. |

Moved to the backlog as Sparkie's first tasks (each already has a test described): F14 (`/v1` loose names), F15 (embedding starts), F21 (recipe source), F22, F24, and the rest of the old F10 (a step that asks; `already-starting`).

**F22, rewritten.** `adoptRunning` saves a hand- or recipe-started model as proven under the recipe's args (`09-verified.mjs:133`), not the args it runs with. Fix: read the running container's own command, or adopt only when it equals the recipe's. Test: start with a setup, restart the service, no entry with the recipe's args.

**F24, corrected.** A cleanly stopped pair is started again (`20-heal.mjs:76-81`). Skip on exit 0 or 143. Skip on 137 only when Docker's OOMKilled flag is false; a memory kill keeps today's "ran out of memory" words. Test: `Exited (143)` is left alone; `Exited (1)` still heals.

## 3. Make it sticky (in order)

| Id | Lost or stale today | Fix |
|---|---|---|
| S1 | A power cut can leave an empty state file (`03-identity.mjs:27-32`, no fsync). | fsync, remove the temp file on failure, keep `.prev` for `readKept` files, fall back to it with an honest notice. Drop "nothing was lost". |
| S2 | `access.json` unreadable means no owner anywhere. | `access.json.good`, written only after a valid write. Changes are refused while the file is bad. |
| S3 | A state restore revives signed-out devices and removed keys. | Leave `sessions.json` out of copies and snapshots. `restore.sh --with-state` keeps live sign-in files when they parse. |
| S4 | Which brain setup runs is known only by an id that installs can change. | Save the full running setup in `main.json`; one notice on a mismatch. Never restart the brain for it. |
| S5 | An update leaves no record. | One update record (`at, build, previousBuild, stamp, note, result`). A start notice "now build X, was Y". Last five in `sparkie_setup`. |
| S6 | What was learned lives in Claude's notes on the Mac. | `docs/changes.md`, appended by code at each install: what, why, tests added, gate result, undone or not. Read before each self-change. |
| S7 | An unwatched power cycle is never healed. | Keep boot time per Spark; write the missing offline/online pair. |
| S8 | A start cut by a restart never joins the should-run list (`19-watcher.mjs:19-26`). | Join it once it answers. |
| S9 | A chat stops at 200 messages. | Move the oldest 100 to `chats-archive.jsonl`. |
| S10 | Page loses the draft; shows dead buttons; says nothing after a restart. | Draft in `localStorage`; expired buttons shown as expired; each open chat gets "send it again". Owner checks by hand. |
| S11 | The source on Spark 2 is wiped by each install and not restored by undo. | Skip the swap in `local` mode. Snapshot and restore the source. `console_code` says when the source does not hash to the running build. |
| S12 | Going back a build may meet state it cannot read. | Rule: state shapes only grow. One Linux test starts the previous build's `server.mjs` (from the newest snapshot) on state written by the new build and gets `/health` ok and the owner signed in. |

## 4. Make it fix itself (in order of human steps removed)

| Id | Addition |
|---|---|
| H1 | **Installer goes back by itself** (F4), plus a fixed-path `go-back.sh` and `RECOVERY.txt`, and `/undo update` as a code-matched word on the signed-in page. On the tailnet it runs; from an internet sign-in it shows the passkey button. Never on Telegram. |
| H2 | **Brain keeper, narrowed.** The console writes a mark when it leaves the brain down itself (a failed switch or start). With that mark and no brain job, it starts the same setup, twice in 6 hours. A brain stopped by hand gets one notice and waits for `/restart sparkie`. A missing container gets one notice naming the word. Never a different model. |
| H3 | **Fault record.** `recordFault` on every 500 and uncaught error; `last-crash.json` before exit; watchdog restarts read at start. Shown in `sparkie_setup`. |
| H4 | **One open-problems list**, built by code, at most 8 lines: held models, failed saves, old copy, set-aside files, last crash, unreadable secrets, Funnel off, Tailscale key expiry, linger off, Spark 2 disk under 10 GB. Said in `/status`, Sparkie's notes and `fleet_status`. |
| H5 | **Tell the owner unasked.** A change in the open-problems list sends one fixed line on Telegram, at most 3 a day, switched on by the owner on the page. |
| H6 | **Tool-call probe on a brain swap**; go back if the new brain cannot call a tool. |
| H7 | **Log size caps** on the three `docker run` builders. |
| H8 | **Disk-full and GPU-runtime rows** in `START_FAILURES`; healing skips both. |
| H9 | **Stuck line.** When self-change stops at its limit: one standing open-problems line with the fault, the failing tests, the go-back command and `RECOVERY.txt`'s path, sent once by Telegram. |
| H10 | **Weekly self-test**, lowest priority: `self_check`, the real-brain eval, a restore check of the latest copy. Results go in the open-problems list. |

Backlog: clean power-off bring-back (first read one real exit code), silent model noticed (tell only), loop ages on `/health`, named download container.

**When the brain is down.** Sparkie cannot heal itself without its brain; that is the cost of one brain. These still work by code alone: `/status`, `/restart sparkie`, `/pause`, `/undo update`, the keeper, the installer's go-back, the watchdog. Write this list in `AGENTS.md` and `/help`.

## 5. What to add (smallest and most valuable first)

| # | Id | Add | Size | The owner can then say |
|---|---|---|---|---|
| 1 | A1 | `/pause`, `/restart sparkie`, `/help` on Telegram. `/stop` on the page and Telegram: it ends Sparkie's current reply and any carry-on in that chat. It never cancels an operation and never stops a model. | S | "/stop", "/restart sparkie" from the phone |
| 2 | A2 | "Anything need me?" from the open-problems list | S | "Anything need me?" |
| 3 | A3 | "What can you do?" answered from the live action list, with the limits | S | "What can you do?" |
| 4 | A4 | Lookup routines return their results (`18-workflows.mjs:283`) | S | "Morning check." |
| 5 | A5 | Access read on `sparkie_setup`, owner only | S | "Who is signed in? How many recovery codes are left?" |
| 6 | A6 | Approve from the phone: the Telegram line carries the chat link and the code-built summary; the result comes back there after the restart | S | Tap the link, passkey, press |
| 7 | A7 | `running_models {detail}` | S | "What is GLM running with?" |
| 8 | A8 | `files` and `save_file` over the existing workspace worker (`worker.py:326-372`) | S | "What's in my shared folder on Spark 3?" |
| 9 | A9 | A model started by name joins Recipes; setups from its model card | S+M | "Start nvidia/<new model> with its best setup." |
| 10 | A10 | Brain swap by chat: download the candidate, serve it on Spark 3 or 4 for a trial only, run the eval and the tool-call probe against it, show the score, then the owner's passkey swap; a word to go back | M | "Try the new Qwen and tell me if it is as good." |
| 11 | A11 | One allow-listed read for design work: Hugging Face model cards, the engines' docs, NVIDIA's playbooks. Text is data. | M | "Read the vLLM notes for this flag." |
| 12 | A12 | `keep_running`, `restart_workload`, workload addresses and a check | M | "Keep Open WebUI on Spark 3 running. Give me its link." |

A1 to A5 land before the handoff of fleet work. A6 to A12 go to the backlog in this order. After every batch that adds a tool: rerun the real-brain eval and add cases for the new tool. Prefer a new argument on an existing action over a new tool.

## 6. Sparkie builds itself

**The loop that ships, stated once.** Sparkie's patches are written by a coding engine (the one the trial picks) in a no-network, no-keys container on Spark 3 or 4, as `agentbar` already runs (`agentbar/README.md:9`). The engine drives the brain on Spark 2. The patched tree's tests also run in that container. Nothing the brain wrote runs as the owner's user on Spark 2 before the owner's yes. Reasons: a chat turn has 6 rounds and 4,096 tokens (`14-chats.mjs:255-259`) and cannot write a patch; brain-written test code is arbitrary Node, and the owner's user holds `api.sock`, the SSH keys and the secrets file; and nothing but the brain may run on Spark 2. Cost, stated plainly: **Sparkie cannot change itself while Spark 3 and 4 are both off.** It can still operate, diagnose, read its code, install a build you approved and go back.

**Milestones**

1. **M1 Groundwork (owner steps).** A real Node 22 or newer under the owner's home on Spark 2, no sudo; the unit and all tools use that one binary. Linger on. A second device can SSH to Spark 2.
2. **M2 Trial, run now, beside Batch 1.** Fix `agentbar/run.mjs` (dead `/get_server_info` call; refuse under 2 brain slots; write the live setup into the result). Prove each grader on a known-good tree. Add three checks: the new test fails on the old code; no existing test line is removed; the code map is current. Add one replay of a real fix on a long line. Bar: three code tasks at 2 of 3 on the Agent setup. It changes nothing in the console. **If Qwen misses the bar:** Sparkie still operates, diagnoses, tests and installs; code patches keep coming from an outside helper you choose; no second model is added quietly. Stage B stops at M5.
3. **M3 A gate on Linux** (F1, F5, fast gate). Proof: one full run on Spark 2 writes the lock; a quick set (`test/quick.mjs`, about 1.5 minutes) never writes it.
4. **M4 Installs are safe unattended** (F4, H1, S11, S12). Proof: `install.test.mjs` and one by-hand drill of a build that dies at start.
5. **M5 Sparkie reads and checks itself.** `console_code` (find, function, line range; fixed root; under 12,000 characters). `server.parts.json` maps a crash line to a part. `run_tests {files}` on the installed, owner-approved tree only, from a fixed list, in its own capped, niced unit. `self_check` runs the read actions live.
6. **M6 Sparkie installs with the owner's yes.** `update_console {show|install}`. The approval lives in `approvals.json`, is tied to the `ships` hash plus the `test/`, `deploy/`, `tools/` hash, and is pressed on the page with the passkey. The install starts outside the console's unit with `systemd-run`, as undo does (`18-workflows.mjs:476`), with `ASSUME_YES` only when the one busy item is the asking chat. A pending-install file carries the result across the restart. First use: a docs-only change through the whole path.
7. **M7 Sparkie patches itself.** `change_console`: one job that copies the source to a work folder, starts the engine container on Spark 3 or 4, keeps its place in a state file across console restarts, and has a budget (40 minutes per try, 3 gate runs). No git: the change report is `diff -ru` against the installed source. Then closest tests, the quick set, the full gate, the report, the owner's yes. `/status` shows "changing itself: step, minutes, gate run 2 of 3". The owner's chat keeps one brain slot.
8. **M8 Proof run and practice week.** One real small change (F24) made end to end by Sparkie with the Mac lid shut: read, patch, test, gate, approval, install, live check, doc update. Then one week with Claude Code reachable and a list of every time the Mac was opened and why. Then the Mac is retired.

**Stays code, never model judgment**
- The build, which tests run, the gate, the lock, all hash checks.
- Where a brain-written tree runs (the container; never Spark 2).
- The change report: files, lines, tests added or gone, protected paths, whether the map and code map changed when actions, state files, routes or rules did.
- Fails-first: the new test fails on the old build and passes on the new one. No existing test or lock file changed.
- Refused outright in the first version, lifted only by the owner by hand: `test/lock.mjs`, `deploy/`, the approval and install code, `22-passkey`, `22-sessions`, `03-identity`, `03-secrets`, the report builder, the protected list, and `public/` until page tests exist.
- The approval text, the install, the canary and ways-in checks, going back, the stop count, secret masking.

**Model judgment:** diagnosis, design, the patch, the new test, a plain-words summary beside the code-built report, and one fresh-conversation review turn on the same brain that sees only the diff, the rules and the checklist; its answers sit on the approval card.

**Still needs an outside helper after all of this:** page changes until a page harness exists; changes to the installer, watchdog and sign-in parts; anything needing sudo; a failed go-back with the console down; a change while Spark 3 and 4 are off.

## 7. Docs and structure

- **D1 `AGENTS.md`**: the owner's standing rules, dated. Six lines on how to edit (replace tool; never open `service/server.mjs`; keep curly apostrophes; the root `server.mjs` is a different file). "When Sparkie is stuck". "When the brain is down". A row for `agentbar`.
- **D2 `docs/contract.md`**: a v3.2 note correcting line 13 and section 12; mark unbuilt memory promises "not built".
- **D3 `docs/architecture.md`**: delete the build id, part count, "not locked" trap and the Mac-path tail; cite part plus function name. One written Spark 2 rule: what may run there (the brain; node and bash tests of an approved tree in a capped, niced unit; no containers) and what may not (any brain-written code, any workload).
- **D4 Rules to rewrite in the same change as the code**: R1 (Spark 2 rule), R9 (F25), R19 (keeper), R22 (new writers of `main.json`), R29 (`ships`), R32 and R34 (Telegram words, `/stop`, `/undo update`, the needs-me line), and `AGENTS.md`'s "never edit an existing test" for the count literals.
- **D5 `tools/code-map.mjs --check`**: every part and backticked function named in the map exists; every state file in code is in section 4; no 12-hex build id in hand-kept docs; the rule count in `AGENTS.md` matches the map. The code map gains routes and top-level tables, generated only.
- **D6 `tools/build-server.mjs`**: throw on a misnamed part; run `node --check`; write the code map and `server.parts.json` in one command; a schema check for `config.json` (every Spark has an address, brain setups name Spark 2, images pinned). The installer calls `--check`.
- **D7 `16-actions.mjs:12`**: `action()` throws unless kind is `read` or `change`; fix the header.
- **D8 Tests**: replace the three count literals with list lengths (owner's yes once). Every change action has an `ACTION_KIND` entry and a label. Every `newJob` type has plain words. A static page test: page files parse, every page API path is answered, loaded files are in `UI_FILES`.
- **D9 `docs/handoff.md`**: what lives only on the Mac and where it now lives; fleet facts the console cannot read; the drills with dates.
- **D10 `docs/backlog.md`**: one ordered list for after the handoff, so Sparkie has a "what next".
- **D11 `docs/runbooks/`**: one page each: fix a failed start, the console will not start, a gate file fails, add an action, bump an image, swap the brain, add a Spark. Read through `console_code`.
- **D12 Slim the code** (the delete you already agreed to, pending one final yes): members and sharing, the short address, the browser editor and file browser, old brain setups. Node must be installed first, because the editor may be where Node comes from. Fewer lines is the cheapest way to make self-change work.
- **D13 Images and the worker**: an engine image change is a `config.json` change through the same loop, covered by `ships`, undone by going back a build. Confirm how `worker.py` reaches a Spark that was off during an install, and check it when the Spark comes online.

## 8. Handoff checklist

**Stage A: before you talk only to Sparkie for fleet work**

| Must be true | Checked how |
|---|---|
| Real Node on Spark 2; the unit does not point into code-server | `/health` shows the version; the installer prints the path |
| Linger on; Spark 2 comes back alone, with SSH to Spark 3 and 4, Funnel and Telegram | Owner runs the linger command, `sudo reboot`, then `/status` from Telegram |
| Full gate passes on Spark 2, from a tree sent there without an install | `node test/lock.mjs` there; `--check` agrees; no file skipped |
| Chat stays fast while the gate runs | Time to first words in your chat during a full gate; write the number down |
| Installed build is the locked build, page included | `/health` build equals the lock; `ships` matches |
| One install done with `host-on-portal.sh local`, end to end | Owner runs it once |
| A bad install goes back by itself | Drill: a build that exits at start; old build answers within 2 minutes |
| Going back works by chat and by word | "Undo the update" in chat; `/undo update` with the brain stopped |
| Brain comes back | Stop the brain container by hand; `/restart sparkie` from Telegram |
| Chat survives a bad file and a full state folder | The two F2 tests pass; `/status` shows the save flag |
| Ten recovery codes exist, one works, a copy is kept off the Sparks | Sign in from a phone with Tailscale off |
| A second device can SSH to Spark 2 | Owner adds the key; the console never does |
| State and source were copied in the last day, and the copy restores | Unpack the copy into a scratch folder; a stand-in console starts on it and answers `/status` |
| Spark 2 can be rebuilt from nothing | `RECOVERY.txt` has the steps; owner reads them once |
| Spark 2 disk above 10 GB free; snapshot count sane | `/status` |
| The needs-me line arrives | Seen once on Telegram |
| Real-brain eval run in full | `test/eval.mjs`, 16 cases x 3; the result names the brain and build; a miss exits 1 |
| Fleet drill | Start, stop, diagnose a small model on Spark 3 by Telegram |
| Standing rules confirmed | Owner reads the `AGENTS.md` list once |
| Mac-only items moved | `docs/handoff.md` rows all "done"; agent keys reissued or moved |

**Stage B: before the Mac is retired**

| Must be true | Checked how |
|---|---|
| Trial bar met | `agentbar` summary saved in the tree: three code tasks at 2 of 3 |
| A docs-only self-change went through the whole path | M6 |
| The proof run passed | M8, Mac lid shut |
| Practice week done | The list of Mac openings is empty or accepted |
| The Mac tree is read-only only after the restore drill passed | Owner renames it by hand |

## 9. Build order

Each batch passes the gate and installs on its own. For every batch: print the five workflow versions before and after. If any changed, Spark 3 or 4 must be on for one live start-check-stop of a small model, with your yes, before the batch counts as installed. Until Batch 2 the Mac's gate is the authority; from Batch 2 on, the Linux gate on Spark 2 is.

**Before Batch 1 (owner steps, no install)**
1. G1 Node 22+ on Spark 2 under the home folder (S)
2. G2 Linger, reboot drill, second SSH device, recovery codes (S)

**Beside Batch 1, on Spark 3**
3. M2 Trial runner fixes, grader checks, one replay, then the run (M)

**Batch 1: the gate and the map (no behaviour change)**
4. F1 safe stand-in fleet on Linux (M)
5. Fast gate: the cuts and flaky-test holds from `docs/analysis-2026-11-11/07-fast-gate-plan.md`, plus `test/quick.mjs` (M)
6. F5 lock `ships`, per-file counts, `--check`, `test/last-gate.json` (S)
7. "Send source only" mode in the installer: copy the tree to Spark 2, install nothing (S)
8. D5, D6, D7, D8 (S each)
9. D1, D2, D3, F23 (M)

**Batch 2: installs that cannot strand the console**
10. F4 with canary turn and ways-in checks (M)
11. `test/install.test.mjs` (M)
12. H1 `go-back.sh`, `RECOVERY.txt`, `/undo update` (S)
13. S11 source kept and restored; S12 previous build on new state (S, S)
14. S5 update record; S6 change log (S)

**Batch 3: chat never dies**
15. F2 (S)
16. F3, then H2 (M)
17. F8 (M)
18. F7, F13, F25 (S each)
19. H3 fault record; "send it again" notice (S)
20. A1 Telegram words and `/stop` (S)
21. H6 probe on swap; S4 running setup saved (S)
22. A "Now" line at the top of Sparkie's record, and dates on old notices in history (S)

**Batch 4: fleet truth and stores**
23. F6, F16, F12 (S each)
24. F17 copy with source bundle; restore script and drill (M)
25. S1, S2, S3 (S)
26. H4 open-problems list; A2; H5 needs-me line (M)
27. S7, S8 (S, M)

**Batch 5: start code, one lock run**
28. F9, F10, F11 (S each)
29. H7 log caps; H8 failure rows (S)
30. Drop the "validated on these Sparks" refusal; keep `test_changes` as the live drill you ask for (S)

**Batch 6: slim, access, page**
31. D12 delete, after your final yes (M)
32. F18, F20 (S each)
33. F19, S9, S10, page wording fixes: checked by hand (S each)
34. A3, A4, A5 (S each)
35. D9, D10, D11 first three runbooks (M)

**Stage A drills (section 8). You now talk only to Sparkie for fleet work. Code changes still come from Claude Code.**

**Batch 7: Sparkie reads and checks itself**
36. `console_code`, `server.parts.json`, `run_tests`, `self_check`, remaining runbooks (M)

**Batch 8: Sparkie installs**
37. `update_console`, `approvals.json`, change report, pending-install file, A6 (L)
38. Docs-only practice change (S)

**Batch 9: Sparkie patches itself** (only if M2 met the bar)
39. `change_console` job, container run, code checks, protected paths, review turn, H9 (L)
40. M8 proof run and practice week (M)

**After: `docs/backlog.md`, in order.** F24 (the proof run), F22, F14, F21, F15, rest of F10, A7 to A12, H10, page harness and page split into parts, clean power-off, silent model, named download container, a timer store (reminders and timed routines on one clock), Spark hold, `remove_model`, `run_script`.

## 10. Cut, and why

- Rerun of a failed test file before the lock: it weakens the gate just before handing it over. Fix the flaky tests.
- Watchdog going back a build: a second untested path that can loop. The installer's go-back and your word cover it.
- Git on Spark 2: a copied work folder and `diff -ru` give the report with nothing new to install.
- Splitting `16-actions.mjs`: no owner gain, moves every citation, risks the other agent's edits.
- A hand-kept `docs/fleet.md`: it goes stale. Facts the console cannot read go in `docs/handoff.md`.
- Code-map extras for page sections and tests per part: upkeep that drifts.
- `ask_model`: it invites chat routing back in.
- Five validated versions per workflow, and the "one validation run" framing: the validation refusal goes in Batch 5.
- In-use guard after restart, held reasons, per-version failure count, unsent Telegram lines, audit shows the device, recipe dates: small value now; not in the backlog's top.
- An in-console patch loop on Spark 2: it would run brain-written code as you, next to your keys.
- A general settings action; a restore action by chat; page-error route; `?ask=` links; live chips; clock-drift sensing; automatic restart of a silent model; durable job engine; generic stand-in docker before the first workload action; light-thinking request shape before a measurement; `build-catalog.py` revival; chat routing to another model.
- `test_changes` polish: it stays only as the drill you ask for.

## 11. Decisions only the owner can make

**Owner, 2026-11-11: all 11 accepted as recommended.** Node 24 LTS on Spark 2 under the home folder (no sudo) approved; linger and the reboot drill started the same night.

| # | Question | Recommendation |
|---|---|---|
| 1 | May tests of an approved tree run on Spark 2 beside the brain? | Yes: node and bash stand-ins, capped and niced, no container, GPU or model. Written as one rule; proven by the chat-speed number. |
| 2 | Where does brain-written code run before your yes? | Only in the no-network, no-keys container on Spark 3 or 4. So no self-change while both are off. |
| 3 | If Qwen misses the trial bar? | Sparkie operates and installs; patches come from a helper you pick; revisit after a brain swap. No second model. |
| 4 | Does a brain the console itself left down come back alone? | Yes, same setup, twice in 6 hours. One you stopped waits for your word. |
| 5 | Owner words on Telegram (`/pause`, `/restart sparkie`, `/stop`)? | Yes. Resume and `/undo update` never from Telegram. |
| 6 | One standing "needs me" Telegram line? | Yes, at most 3 a day, switched on by you on the page. |
| 7 | Which changes need the passkey tap? | Every install. Removed tests are named first on the card. Protected files are refused, not just named. |
| 8 | Final yes to delete members, sharing, short address, editor, old brain setups? | Yes, after Node is installed. |
| 9 | Where does a second copy go when Spark 3 and 4 are off for days? | A USB disk path on Spark 2 that you pick once. No network path. |
| 10 | After the last Mac install, is Spark 2 the only source? | Yes, but only after the restore drill passes. |
| 11 | May Sparkie set a restart policy on, or restart, containers you started by hand on Spark 3 and 4? | Yes, only after you say "keep this running". Backlog item. |
| 12 | Approve the standing-rules wording and contract v3.2. | Approve once before Batch 1 installs. |

**Decided as recommended unless you object:** the eval must pass before a prompt change or after a brain swap, for self-changes only; the existing workspace is the one data home; the 180-day sign-out stays and the page says so; models keep taking free memory as today; the trial runs on Spark 3 with the brain on the Agent setup; chat is always the brain (chat routing is removed, the apps' route stays); the "validated on these Sparks" refusal is dropped; weights are never deleted by Sparkie for now.

**Key files:** `/Users/akuppala/Documents/26aiRAG/spark-console/deploy/host-on-portal.sh`, `/Users/akuppala/Documents/26aiRAG/spark-console/test/start-mock.mjs`, `/Users/akuppala/Documents/26aiRAG/spark-console/test/lock.mjs`, `/Users/akuppala/Documents/26aiRAG/spark-console/service/src/14-chats.mjs`, `/Users/akuppala/Documents/26aiRAG/spark-console/service/src/13-main-model.mjs`, `/Users/akuppala/Documents/26aiRAG/spark-console/service/src/20-heal.mjs`, `/Users/akuppala/Documents/26aiRAG/spark-console/agentbar/run.mjs`, `/Users/akuppala/Documents/26aiRAG/spark-console/docs/analysis-2026-11-11/07-fast-gate-plan.md`.