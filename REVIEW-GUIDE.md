# Review guide for Astra

This is the whole Spark Console folder as of 2026-11-16, with nothing left out. Please review the commit named in the
owner's message, for bugs, gaps and suggestions. This page says what to read, what changed, what was left out on
purpose, how it was checked, and how it gets installed.

**Our own final read is in this commit.** The phase was complete at commit `36db95e` on 2026-11-15. Then eight
reviewers of ours read it, one area each: the root helper, the sorter, the lock-out net, the chat, keys, the box and
updates, round 1's fixes, and whether the tests and documents say what the code does. They found about a hundred
faults in the code, tests that still passed with their guard taken out, three loosened assertions and 165 stale
sentences. The commits after `36db95e` are the fixes, to code, tests and documents: about 170 as this guide was
written, merges not counted (`git log --no-merges 36db95e..`). What was not fixed is in the rules' "Today" notes
and in section 6. The reviewers' reports are not in the repository: ask, and we send them. If you report something
a later commit has closed, we answer with that commit.

Two things are new since your first review:

- **Round 1 is answered.** Every finding in `docs/review-astra/findings-1.md` has its answer in
  `docs/review-astra/reply-1.md`, and `docs/review-astra/open.md` has one row per id with who moves next. The
  accepted fixes have been on `main` since commit `f060fff`. Our final read went over them again: what it changed
  is marked "Since" in the reply, and where the build does less than the reply first promised (P-5), it says so.
- **The next phase is built.** Section 10 used to hand you a plan. All six milestones of that plan are now code on
  `main`: more than 700 commits since `f060fff`, the service grown from 37 parts to about 100, the suite from 49
  test files to about 150. Please review it as code, as hard as the first build.

Sections 1 to 9 keep their numbers, so round 1's references still work.

## 1. What Spark Console is

The owner has several NVIDIA DGX Sparks. Spark Console is one hub for all of them: one Node service on Spark 2, with
one address, reached on the owner's tailnet or from the internet behind a passkey sign-in. The owner is its only
user: members and sharing were taken out (`docs/sharing.md`).

The owner uses it in two ways: by talking to **Sparkie** and through the **APIs**. Sparkie is the console's chat
brain, a Qwen model on Spark 2, and the owner talks to it on the page or on Telegram. The page is now the chat,
sign-in and status. Home, Models, Files and Access are off it (`test/page.test.mjs`); only Home's and Models' routes
stay, and Files' and Access's are gone.

What Sparkie and the APIs do:

- **As before:** start, stop and heal models with their best setup; keep GPU apps and dev boxes running; run one-off
  jobs and small stacks; look things up on the web.
- **New:** run a command on any Spark, or write a file on a compute Spark (`run`, `write_file`), with code deciding
  what runs at once, what waits for a button and what waits for a dangerous ask; try code in a box; carry a long
  task on within limits and report at its end; keep a journal and a memory; power compute Sparks off when idle and
  on for work; check for and install its own updates.

Spark 2 runs only the console and the brain. Workloads run on the compute Sparks (Spark 3, Spark 4, any added
later). The owner's own agents reach Sparkie through the agent door (MCP), one key per agent.

## 2. Reading order

1. **`AGENTS.md`.** The front door: the layout, how to work, the rules that are never broken, one card per task.
2. **`docs/architecture.md`.** The diagram (the root helper, the box, the ladder and the lock-out net are on it),
   one sentence followed from chat to a running model, one command followed to a Spark, and the known traps.
3. **`docs/rules.md`.** One line per rule, R1 to R74 (there is no R44). Each rule's file in `docs/rules/` says why,
   where the code falls short today, where it lives and what checks it. Start with the newest: R42, R51, R52, R54,
   R55 and R60 to R74.
4. **`docs/how/`.** One card per kind of work. For this review: `docs/how/call-the-root-helper.md`,
   `docs/how/raise-a-dangerous-ask.md`, `docs/how/find-why-a-change-was-refused.md`,
   `docs/how/run-the-brain-eval.md`, `docs/how/land-a-step.md`.
5. **`docs/code-map.md`, `docs/registry.md`, `docs/status.md`.** Generated from the code: every part and function;
   every action, state file and timer; one row per rule and contract requirement with the test that holds it.
6. **`docs/contract.md`.** What the product must do and why. It is the owner's text. It is long, so search it;
   its section 8 is what this build is about.
7. **`docs/design-2026-11-13/README.md`.** The plan that was built, in one page, with the owner's 22 decisions in
   `docs/design-2026-11-13/owner-decisions.md`. It is a dated record and still says "Nothing here is built yet".
8. **`docs/review-astra/`.** The procedure (`README.md`), your round 1, our reply, and the open list.
9. **`test/README.md`, `test/stand-in-fleet.md`, `test/covers.md`.** How the suite runs, what no test reaches, and
   one row per test file.

Other documents: `docs/sharing.md` (sign-in), `docs/agent-door.md` (MCP), `docs/recipes.md`, `docs/multi-spark.md`,
`docs/state.md` and `docs/state-outside.md` (who holds each fact), `docs/glossary.md`, `docs/history/` (dated).

**Some documents may still lag the code.** The code is what runs; please tell us where a document is wrong. The 165
stale sentences our final read listed were each checked against the code and corrected. What we know is left:
`docs/contract.md`, where the build differs from it (section 6); the dated records, which are never edited; one
comment in the root helper that still calls the net "dark" (changing it would change the helper's pinned hash); and
the name of one test in `test/danger.test.mjs`, which still says only the stand-in hook raises a dangerous ask.

## 3. Where the code is

| Path | What it is |
|---|---|
| `service/src/NN-*.mjs` | The service, in about 100 parts. **This is the code to review.** Each part's first lines name its rules and tests. |
| `service/server.mjs` | Generated: the parts joined in order. The installer and tests refuse a copy that doesn't match the parts. |
| `service/dig.mjs`, `service/passkey.mjs`, `service/worker.py` | Reading setups from recipes and model cards; passkeys (WebAuthn); the worker run on each Spark. |
| `service/config.json`, `service/catalog.json` | The Sparks, images, the box's image and the brain's setups; the Recipes catalog. |
| `deploy/spark-console-root`, `deploy/root-for-sparkie.sh` | The root helper (about 3,000 lines of bash and Python; it runs as root on a Spark), and the owner's one-time command that puts it there. The console pins the helper's SHA-256 (`HELPER_SHA256` in `service/src/21-work.mjs`) and runs nothing through a helper with another. |
| `deploy/host-on-portal.sh`, `deploy/pull.sh`, `deploy/update-guard.sh` | Install from the Mac; install pulled by Spark 2; the guard that puts the old build back. |
| `deploy/go-back.sh`, `deploy/RECOVERY.txt`, `deploy/REBUILD.txt` | The way back by hand, and rebuilding the hub. |
| `public/` | The page: plain JavaScript, no build step. |
| `tools/` | `make.mjs` (build and check), `land.mjs` and `affected.mjs` (landing a step), `test-on-spark.sh`, `console.mjs`, `spark.mjs`. |
| `test/` | The suite (about 150 files), the stand-in fleet (`test/mock/`, `test/start-mock.mjs`), the gate (`test/lock.mjs`), the brain eval (`test/eval.mjs`, `test/eval/cases.json`). |
| `agentbar/` | The coding trial (`agentbar/trial.mjs`) and an older benchmark of coding agents. Not part of the running console. |

`service/workflows.lock.json` is no longer kept in git: the full gate writes it, and on GitHub only a `tested/` tag
carries it (R29; section 7 says why the newest commits have none yet).

## 4. What changed

### 4.1 Built since round 1: what the owner can now do

Each group names its rules, its parts in `service/src/` and its main tests in `test/` (a part's first lines name the
rest). Nothing that goes through the root helper has run on a real Spark yet (section 7).

**Look at anything, on any Spark.** `run` with a command that only reads runs at once, Spark 2 included, inside the
helper's look wall: the disk read-only, no network, keys hidden. Nine exact forms such as `docker ps` run as code's
own fixed text outside it. What a look prints is outside text. Rules R42, R43. Parts `21-work.mjs`,
`21-work-shown.mjs`, `20-journal.mjs`. Tests `work.test.mjs`, `root-helper.test.mjs`.

**Change a compute Spark by command.** Code sorts every command: a look, a change, risky, the lock-out class, or not
done. Where it cannot tell, it takes the stricter class: a container that reaches the host is the lock-out class; a
command aimed at Spark 2 from another Spark, or one that stops or enters the brain's container, is not done. A plain
change of Sparkie's runs at once only when the owner's own words asked for work on that Spark and nothing was read
since (the owner's own API call needs no words). Only the owner's own sentences count: not text they pasted or
quoted, not an agent's message; a later "never mind" calls the work off. It runs in the run wall for 30 seconds,
with the files it touches copied first so undo can put them back. Anything else is one button with the exact
command, or the dangerous ask: its own message, built by code, with two digits to type after the press. A command
that removes or overwrites a file that could not be copied first is the dangerous ask too. A press says what
really happened: "done" only for a command that ran and ended with exit 0. Changes in one round run one after
another, in order. `/undo` puts back only the chat's newest change. Rules R55, R64 (the sorter), R61 (the ladder,
the runner), R72 (the press), R63 (the walls), R54 (the ask), R25 and R74 (whose words), R34. Parts: `20-sort.mjs`,
`20-shell.mjs`, `20-shape.mjs`, `20-options.mjs`, `20-places.mjs`, `20-programs.mjs`, `20-tools.mjs`,
`20-remote.mjs`, `20-tables.mjs`, `20-uses.mjs`; `21-ladder.mjs`, `21-runner.mjs`, `21-copies.mjs`,
`21-copies-prune.mjs`, `20-danger.mjs`, `20-came-from.mjs`, `16-actions.mjs`, `14-rounds.mjs`. Tests
`sort.test.mjs`, `sort-close.test.mjs`, `ladder.test.mjs`, `runner.test.mjs`, `runner-fixes.test.mjs`,
`danger.test.mjs`, `pressed.test.mjs`, `intent-own.test.mjs`, `fix-intent.test.mjs`, `rounds.test.mjs`.

**Write a file.** `write_file` writes one text file on a compute Spark, whole or by lines, through the same ladder
and runner. On Spark 2 it is refused. Rule R68. Part `21-write.mjs`. Test `write.test.mjs`.

**Long commands and long tasks, with a report.** `run` with `minutes` (1 to 120) is an operation whose result is
posted. A task carries on in fresh turns within limits the owner's words set (2 hours and 8 turns; 4 hours and 60
when sent off "on your own"; 120 work steps), and code writes one report at its end. Rules R61, R66. Parts
`21-long.mjs`, `14-tasks.mjs`. Tests `long.test.mjs`, `tasks.test.mjs`, `tasks-more.test.mjs`,
`task-report.test.mjs`, `turn-budgets.test.mjs`.

**Be asked less.** A button may answer "Run it, and don't ask again for this task", for one kind of command: a tool,
a folder, a Spark. "Always allow" keeps a kind across tasks: page only, with the passkey; `/allowed` lists them.
Owner-only asks can also be pressed in the paired Telegram chat, 3 an hour and 10 a day; `/lock` turns that off.
Rules R65, R32. Parts `21-ahead.mjs`, `20-tg-approve.mjs`. Tests `ahead.test.mjs`, `allowed.test.mjs`,
`tg-approve.test.mjs`.

**Give a key once.** `/key NAME value` is taken out of the owner's words before the brain, the chat file or the
journal sees it, and kept by name; a value typed earlier is then hidden in every stored chat. `run` hands a key to
a command by name; such a command is always asked. Rule R51. Parts `20-keys.mjs`, `21-run-keys.mjs`,
`03-secrets.mjs`. Tests `app-keys.test.mjs`, `run-keys.test.mjs`.

**Change SSH, Tailscale, the firewall or users on a compute Spark.** Only as root. As the owner such a change can
change nothing (the run wall keeps `~/.ssh` and the shell's start files read-only, and `ufw`, `usermod` and
`tailscale` need root), so one asked as the owner is answered "set root", and nothing is asked or run. As root:
only when one sentence of the owner's newest message tells it to, with nothing read since; otherwise refused, not
asked. What the net cannot put back (a Tailscale sign-out, a package the ways in need) is not done. Always the
dangerous ask. The press copies the ways in, arms a timer in that Spark's own systemd, runs the change, then tries
the ways in from outside: all still work, kept; one doesn't, put back at once; no answer, the timer puts it back.
`/putback` puts the newest open one back by code. Rules R60, R71, R70, R3. Parts `21-net.mjs`, `21-root.mjs`,
`21-guard.mjs`. Tests `net.test.mjs`, `root.test.mjs`, `root-helper.test.mjs`.

**Change Spark 2.** Every change there is asked, one command a press, inside the net, with the console's own ways in
checked after it. Refused by code, before any ask: `write_file`, a command given a key, `minutes`, root, a lock-out
change, anything touching the brain's container or model files, any workload, the console's own unit, state,
secrets and repository copy, and Spark 2's power. Rules R1, R61. Part `21-hub.mjs`. Tests `hub-change.test.mjs`,
`never-on.test.mjs`.

**Root.** `run` with `root: true`, on a compute Spark where the owner turned root on. Always the dangerous ask,
always inside the net; never a script or other code the command does not show, never a mount, never with a key,
`minutes`, another Spark or the GPU. Rule R70. Part `21-root.mjs`. Tests `root.test.mjs`, `root-helper.test.mjs`.

**Try code in a box.** `run` and `write_file` with `on: "box"` act in a throw-away container on a compute Spark: no
network, no keys, only its own folder, 4 GB, two hours, 30 seconds a command. Opening one is a change. With several
boxes on one Spark, the memory free beyond the 8 GB kept must hold 4 GB for each. Rule R62. Parts `21-box.mjs`,
`21-box-fill.mjs`. Tests `box.test.mjs`, `box-more.test.mjs`, `box-fill.test.mjs`.

**Sparkie proposing changes to its own code: built, switched off.** `propose_update` would fill a box with the
source, read the result back as data and open a pull request. It is refused for everyone: `SELF_CHANGE_ON` is
`false`, and it also needs a pass of the coding trial that the owner keeps with a passkey press. Rules R69, R67.
Parts `21-selfchange.mjs`, `21-brain-trial.mjs`; `agentbar/trial.mjs`, `agentbar/trial-lib.mjs`. Tests
`selfchange.test.mjs`, `trial.test.mjs`.

**Updates from chat.** `check_update` says whether a newer tested build is out, and how to install it. It never
offers a build that is not newer than the installed one; when it cannot tell which commit is installed it says so,
offers nothing, and an install is refused. `install_update` installs after a dangerous ask: Spark 2 pulls the
build, and it goes back unless the real address answers with the new build. Rules R58, R29, R30. Part
`21-updates.mjs`; `deploy/pull.sh`, `deploy/update-guard.sh`. Tests `check-update.test.mjs`,
`install-update.test.mjs`, `pull.test.mjs`.

The rest of the phase, in one table:

| What | Rules | Parts and files | Main tests |
|---|---|---|---|
| **Memory and learning.** A journal of everything said, called, run and seen, never rewritten. Memory keeps every line and believes only the owner's words. `recall` looks back. A long output enters a turn as a digest cut by code. Code writes a lesson when an operation fails; a setup that failed twice the same way is passed over. | R43, R45, R48, R59 | `20-journal.mjs`, `20-recall.mjs`, `20-memory.mjs`, `20-memory-names.mjs`, `20-memory-said.mjs`, `20-memory-time.mjs`, `20-memory-tg.mjs`, `20-digest.mjs`, `20-lessons.mjs` | `journal.test.mjs`, `recall.test.mjs`, `memory.test.mjs`, `memory-reads.test.mjs`, `digest.test.mjs`, `lessons.test.mjs`, `passed-over.test.mjs` |
| **Any brain, and only a checked one changes things by itself.** At most 24 tools a round. An eval result belongs to the brain, what this build's brain reads, and the case set it ran on. Sparkie's change runs at once only while its brain is checked: a passing eval on record for this exact brain and what this build's brain reads, kept with the owner's passkey press. Otherwise every change is a button. | R46, R47, R50, R52 | `13-ask.mjs`, `21-guide.mjs`, `21-brain-check.mjs`, `21-brain-eval.mjs`, `21-brain-rail.mjs` | `tools.test.mjs`, `brain.test.mjs`, `brain-check.test.mjs`, `brain-eval.test.mjs`, `brain-rail.test.mjs`, `eval-commands.test.mjs` |
| **A hub that needs no laptop.** An outside heartbeat; a copy of the state taken when another Spark is awake; state put back from a copy lets no device or key in by itself; the ways in watched ahead; a script that clears old pieces off Spark 2. Members and sharing, the browser editor and the file browser are gone. | R32, R23, R33, R49, R37 | `20-beat.mjs`, `20-state-copy.mjs`, `22-putback.mjs`, `20-ways-in.mjs`; `deploy/clear-spark2.sh` | `beat.test.mjs`, `copy.test.mjs`, `putback.test.mjs`, `ways-in.test.mjs`, `clear-spark2.test.mjs`, `no-editor.test.mjs`, `no-file-browser.test.mjs` |
| **Workloads and power.** Smart plugs; idle compute Sparks parked and powered off, and woken for work; saved workflows that place steps, wait for jobs and clean up; `compare_models`; an operation's energy at the wall. | R41, R56, R57 | `12-plugs.mjs`, `21-power.mjs`, `21-power-pair.mjs`, `18-step-jobs.mjs`, `18-run-record.mjs`, `18-job-model.mjs`, `18-saved-from.mjs`, `18-saved-yes.mjs`, `21-compare.mjs`, `20-op-energy.mjs` | `power.test.mjs`, `plugs.test.mjs`, `asleep.test.mjs`, `power-wake.test.mjs`, `workloads.test.mjs`, `compare.test.mjs` |
| **Ground.** The self-test on real hardware (`self_test`); the suite run on a compute Spark and on GitHub; a step lands on the tests its change affects; one rule per file, and a checker that fails when documents drift. | R29 | `21-selftest.mjs`; `tools/land.mjs`, `tools/affected.mjs`, `tools/test-on-spark.sh`, `tools/check-docs.mjs` | `selftest.test.mjs`, `land.test.mjs`, `affected.test.mjs`, `spark-runner.test.mjs`, `docs.test.mjs` |

### 4.2 Round 1's fixes (2026-11-14)

Eight app findings (A-1, A-2, A-3, A-4, A-5, A-7, A-8, A-9) and two harness faults (T-1, T-2) were fixed, each with
a test that fails without it. Our own read of the fixes found five more things, fixed too. The tables at the end of
`docs/review-astra/reply-1.md` name each commit and test, what is later and what was not accepted. Since then,
milestone 4 took out the page views behind A-10, A-11 and A-12, and the file delete behind A-6 (R37). The final
read closed eight more things around those fixes (the reply's third table): a saved workflow whose agent is
removed (A-1), changes in one round (A-2), a restart checked again inside its claim (A-2b), more error text masked
(A-5), a call-off in a later sentence, old state bringing back an allowed kind (P-3), tests for a full journal
(P-2), and the script check at the press (P-5).

### 4.3 The build-out of 2026-11-12 and 13 (what you reviewed in round 1)

Unchanged in substance. The ids are those of `docs/history/analysis-2026-11-11/14-trimmed-plan.md` (A13 is in
`docs/history/analysis-2026-11-11/19-any-workload-spec.json`): everyday additions (A7, A8, A12); the installer
that checks the new build and goes back by itself, and by-hand recovery (F4, H1, S5); web lookup (R39); chat that
never stays stuck and a brain that comes back (F2, F3, F7, F8, F13, F25, H2, H3, A1); the app door (R40); the
fleet fixes (F6, F12, F16, F17, S1, S2, H4, A2, H5); starts and any workload (A9, A13, F9, F10, F11, F18, F20, A3,
A5); and three races found by full runs (`test/heal-power.test.mjs`, `test/desired-look.test.mjs`,
`test/heal-displaced.test.mjs`).

## 5. Owner decisions that shape the code

These are the owner's choices, not oversights. Please question how they are met, and say plainly if one carries a
risk the owner has not been told about.

- **Sparkie is the commander** (decisions 18, 20, 22). It may do everything the owner can on the Sparks, root and
  the lock-out class included. Nothing is refused for being powerful; the question is at once, or ask first.
- **Never lock the owner out.** This is now the reason for a net, not a ban (contract 8.3). SSH, Tailscale, the
  firewall and users change only as root, on the owner's own words, after a dangerous ask, inside the net.
- **Root** goes only through the one helper. It is off on each Spark until the owner's `--with-root` there, and
  through the console it is always the dangerous ask.
- **Keys** are given once and kept in one file on Spark 2. A key is never shown back.
- **Spark 2 is the hub:** the console and the brain, nothing else. Every change there is asked. Nothing starts a
  workload there or powers it off.
- **Sparkie changing its own code stays off** until the coding trial passes and the owner turns it on. Turning it
  on is a code change, so it needs a new build.
- **The three new switches are on in this build** (`NET_ON`, `HUB_ON`, `ROOT_ON`), by decision 22. What gates each
  is the helper on that Spark, the owner's press on the ask, and `--with-root` for root.
- **One brain.** Qwen on Spark 2, no fallback; only the owner swaps in another. A brain that is not checked gets a
  button for every change.
- **One simple service, one address, one user.** Open to the internet only behind a passkey. The app door on port
  10000 is the one approved exception, for apps only. Dev boxes run with no second password.
- **Telegram is a place to say yes.** Whoever holds the owner's unlocked phone can do what the owner can, a few
  presses at a time. The caps and `/lock` are the bound the owner chose.
- **No trash.** A file is copied before a change, and a delete that cannot be put back is always asked.
- **As before.** `qwen-recipe-*` containers and anything labelled `spark.protect=true` are never stopped. The owner
  approves updates. GitHub holds the code and the tested mark, and never gets a way into the Sparks.
- **The contract is the owner's text.** Builders never edit it. Where the build differs from it (section 6), the
  owner decides which moves.

## 6. Left for later on purpose

The lists are in five places: each rule's "Today" (what that piece does not do yet; the longest are R30, R52, R70,
R50, R51, R69 and R45); `docs/history/later-2026-11-15.md` (Later lines moved out of full rule files: R60, R70, R55,
R63); `docs/review-astra/reply-1.md` ("Later, in one place"); `docs/review-astra/open.md`; and below.

**The build does not match these contract sentences.** The owner has agreed to change the first four, but
`docs/contract.md` has not been edited yet, so every row still stands. The build is stricter or different; the
contract is the owner's to change. The code named is in `service/src/`.

| The contract says | The build does | Code |
|---|---|---|
| 8.11, T131: on Spark 2 only a fresh visit through the changed way in keeps a change | Keeps it by code once the console's own ways in still answer. No fresh-visit check is built, for the hub or for sign-in | `hubChange` in `21-hub.mjs`, `netGuarded` in `21-net.mjs` |
| 8.11: a command may run 10 minutes on Spark 2 | 30 seconds | `RUNNER_SECONDS` in `21-runner.mjs`, used by `hubChange` |
| 8.14: plain root commands are among the changes that run at once | Root is always the dangerous ask | `rootChange` in `21-root.mjs` |
| 8.15: one command for each Spark, once | Root also needs `--with-root` | `deploy/root-for-sparkie.sh`; `root_off` in the helper |
| 8.14's lock-out bullet, T15, T74: a lock-out change is asked first and runs inside the net | As the owner's own command on a compute Spark it is answered "set root": nothing is asked or run. Asked, and run inside the net, only with `root: true` where root is on | `netChange` in `21-net.mjs`, `rootChange` |
| 8.15: a net wall beside the look and run walls | On a compute Spark nothing runs in one: a lock-out change runs as root, which has no wall. Only Spark 2's change runs walled inside the net | `netGuarded`; R70 |
| 8.11 ("every command on Spark 2"), 6.6, T74's last sentence, T51, T91 | On Spark 2 a look is not armed and runs at once; a lock-out change and root are refused, not asked; a command on the console's own state, unit or socket is refused before any ask | `21-work.mjs`; `hubChange`, `hubRefuses`; `rootChange` |
| 8.14's risky list, T127: a root script is asked first | A root command that runs a script, or other code it does not show, is refused | `rootUnseen` in `21-root.mjs` |
| 8.14: a command in the box runs at once | Opening a box is a change: Sparkie's call is refused while changes are paused, and a brain not checked gets one button | `boxGate` in `21-box.mjs` |
| 8.15: until the owner's command has run for a Spark, the two tools do not work there | The box works without the helper | `boxOpen` in `21-box.mjs` |
| 8.18: "ROOT on Spark 2"; "the press runs those same bytes or nothing" | Nothing runs as root on Spark 2. The ask shows a script's SHA-256, not its text; the press and the unit's first lines check it again; the script runs by its path. No installer is downloaded once and held | `workScripts` in `21-ladder.mjs`, `runnerPins` in `21-runner.mjs` |
| 8.14: services change at once | By our reading, not run: the run wall hides `/run`, so a plain change cannot reach a user service, and a system service needs root | R63 |

**Trades the owner has been told.**

- A look counts as outside text, so a change after a look in the same request is asked. The go-ahead answers that.
- No change runs at once while any Spark has Tailscale SSH on, or while something other than sshd and the
  console's own listens on every address of that Spark.
- A change that runs after a yes with `--open` keeps the owner's groups, Docker's among them: as good as root.
- A change that runs after a yes with `--home` can leave files that run at the owner's next terminal on that Spark.
- A command given a key needs a press, and can still show, save or send that key.
- With root on, the net puts back the ways in, and nothing else a root command changes.

**Left by the final read's fixes.** Each is in its rule's Today or in the reply. The ones that matter most:

- The press checks a script by its hash and runs it by its path; a script is pinned only where its folder can be
  told (R72). Holding the bytes the ask saw, showing a script's text, and fetching an installer once are not built.
- A failed operation started in the paired Telegram chat, by a press or `/undo`, counts toward the three failures
  that pause agents, though R9 says the owner's own failed work never counts. No test covers it.
- `wait_operation` hands an operation's raw error and log lines to the owner's own API call (Sparkie's and an
  agent's copies are masked, R7). Four of the five places newly masked have no test of their own.
- A `write_file` whose old file could not be copied is told nothing ran, not asked (R72). A dangerous ask does not
  park a task (R66). After a console restart an open box is off the record until it ends by itself (R62).
- No test types `/putback` while the journal cannot be written, and none points a link elsewhere between the ask
  and the press (the reply, P-2 and P-5).

**Not done yet, because it needs the owner or the real Sparks** (section 8 has the order): the install of this
build; the helper's one-time command on each Spark, and so the proof of the walls on a real systemd and kernel; the
brain eval on the real Qwen for this build; the coding trial; the first real run of each changed start, stop and
restart workflow; and what only a real Spark shows (a change kept by the net and one left to go back, a restart
inside the net's window, the box's check on a real Docker, Spark 2's call through its service manager, real plugs).

**Not built.** The fresh-visit proof for the hub and for sign-in changes; a lock-out change on Spark 2; `minutes`
on Spark 2; a root script on input; adding a Spark from chat (it waits for Spark 1); a brain across Sparks (it
waits for real runs); a reviewer for Sparkie's own proposals; removing a kept key from chat.

**Judgements that stay.** Three places decide by word lists, and a word list is never complete: the sorter (R55,
R64), whether the owner's words ask for work (`changeIntent`, R25), and whether they ask for a lock-out change
(`netAsks`, R71). Where one cannot tell, it takes the stricter side: a risky class, a button, a refusal that says
how to ask ("set PasswordAuthentication no in sshd_config on Spark 3" is refused so). The misses the other way
are what section 9 asks you to find (items 2, 3 and 4).

**Existing tests changed.** Where behaviour changed on purpose, the tests that held the old behaviour changed with
it: "root is refused on every Spark" became "refused until the owner turns it on". Every such line shows in
`git diff f060fff -- test/` on the commit you were given. Our final read went through them: 124 removed or edited
lines held a check (74 `assert.`, 50 through helpers); each was replaced by one as strong or changed for a named
decision, and none was loosened. The fixes since edited two more, in `abilities.test.mjs`, on purpose. The read
also found three assertions loosened inside the phase, in test files newer than `f060fff`, which that diff does
not show. One, in `compare.test.mjs`, is strict again. One, in `write.test.mjs`, is back in full in a new test that
reaches its guard. One, in `memory.test.mjs` (the picker's speed, the best of fifteen rounds), is kept wide on
purpose, with the numbers and the reason in the test. Please check that nothing else was loosened.

### Older lists

As written on 2026-11-13 and 14, shortened. Marked where this build closed one; the rest were not rechecked.

**Chat.** A carry-on retry, and a notice when it gives up (now R66). A `/resume` word (the contract now says
resuming is not a word). `/stop` on Telegram right after `/new`.

**Web lookup.** SearXNG and real DuckDuckGo results were tested only with stand-ins. No page cache. Brotli
decompression keeps running after the size cut.

**App door.** One app per browser at a time; an old tab's saves go to the newly opened app. No fresh-passkey rule
for the door (the owner's choice). The door ticket also reaches the app on `:443`. No-cors GETs can reach read
routes. (The editor's guard went with the browser editor.)

**Fleet.** `running_models` and `container_logs` still read a Spark whose Docker is down as empty. No fsync yet for
chats, `main.json`, energy and secrets. Backups don't include a copy of the source. The needs-me list isn't in
`sparkie_setup`. Checks for Tailscale key expiry, linger and Funnel being off: built since (R49). `healPass` in
`20-heal.mjs` can still use a shared look from just before an operation ended (a narrow window: a start only ends
after the model answers). From the two-healers fix: when the newer model leaves the list, the older one may start
by itself within one pass, and during an undo it can take the Spark between the undo's stop and its restart; a GPU
app or job the owner started since is not counted as "newer"; the old guard is no longer tested for self-healing on
its own; a two-Spark entry started again on one Spark keeps both Sparks and can hold back a model on the other;
when the newer model is down for good, the older one waits for the owner.

**Power (smart plugs), from the 2026-11-14 review of the power work** (its "Later" list). The asleep and
wake-for-work steps since (R56) may have closed some of these.
- With the plug controller down while a Spark is off, nothing can be woken, and no needs-me line says so.
- A shutdown slower than 4 minutes ends as "the plug may not be on Spark N" (wrong words, a needs-me line) and
  isn't looked at again; the next power-on clears it.
- `sudo` not set up on a Spark with a plug: every idle try is refused before anything stops, said only in the
  service log, while `fleet_status` says idle Sparks are powered off.
- After a refused or failed shutdown, `nvidia-persistenced` stays stopped until the next boot.
- Idle time is counted on the wall clock; a clock step forward on Spark 2 can make minutes count as the whole time.
- A person at the Spark's own screen and keyboard isn't seen (`who` counts only remote `pts` lines).
- `restart_model` and `stop_model` on a Spark that Spark Console powered off say "isn't one of Spark Console's
  models"; a parked model can't be taken off the list from chat while its Spark is off.
- `power.wake` runs as via `wake`, which counts as an agent (12 an hour; three failed wakes pause agents), and
  waits for everything parked there to come back before the caller's own work.
- `keepAwake` is checked in `power_off`'s action but not again inside its operation.
- A cancel after the shutdown was sent is ignored; a stop then waits its 2 minutes; an operation failing for
  another reason then says "what it had changed was put back".
- When no Spark is named and nothing fits, a start turns on every Spark that Spark Console powered off, and
  everything parked there comes back after it.
- The idle-setting words also match "Set up Qwen with automatic tool choice", so that request counts as two kinds
  of change and gets a carry-on turn.
- With every compute Spark asleep for a day, the daily copy posts its "no copy" notice each day.
- A crash within 30 minutes of any power-on isn't restarted by itself ("was offline in the last half hour").
- Plug readings need Node 22 or newer (the built-in WebSocket). Closed: the installer refuses an older one.
- The suite runs a path whose real form is `sudo systemctl poweroff`; only the stand-in `sudo` being first on the
  path keeps it from the test machine.
- The controller runs with debug logging; whether a 15-minute pairing code lands in its log is unknown.
- No test, as listed then, for: an asked power-off parking a kept app and `power_on` bringing it back;
  `keep_running` waking a Spark; a power step in a saved workflow; the question when a parked model answers
  Sparkie; a cancel between the stops and the shutdown; two Sparks where one refuses; the low-watts branch of
  `plugUnproven`; the last look before the cut; `power.wake`, `keepAwake`, `doneWith`.
- `fleet_status` and the brain's prompt grow for every fleet, plugs or not.
- `stop_model` cancels a power operation on its Sparks, but its version doesn't move: the fingerprint hashes
  `String(CHANGES_MODELS)`, which is `[object Set]` whatever is in it.
- TensorRT-LLM gives no `/metrics` counter the idle power-off reads, so a Spark running one never sleeps by itself.
- The controller's direct attribute read (matterjs-server's `read_attribute`) wasn't checked against a real plug;
  the one-minute hold (`POWER_HOLD_MS`) on its cached values stands in for a fresh reading.

**Start and any workload.** No `run_job` tool; no "then do Y when the job ends"; no model and GPU app on one Spark;
no app secrets; no compose or Docker networks. `--auth none` is stored masked in saved chats. A Node of its own on
Spark 2: the installer now needs one (Node 22, not under the home).

**Skipped in the trimmed plan:** H6 to H10, S3, S4, S6 to S12, F14, F15, F19, F21, F22, F24, A4, A6, A10, A11 and
D9 to D11.

## 7. How it was checked

- **Unit and flow tests.** Every change has a test that fails without it. The suite runs against a stand-in fleet:
  scripts that act like Docker, `nvidia-smi`, SSH, `sudo`, systemd and Tailscale on each Spark. It never touches a
  real Spark. `test/stand-in-fleet.md` lists what no test reaches.
- **No test proves a wall.** The real helper script runs as a rehearsal under a stand-in home
  (`test/rehearsal.mjs`), with stand-ins for `systemd-run`, `systemctl`, `unshare`, `setpriv`, `sshd` and `visudo`
  in `test/mock/bin/`. Each test shows that the helper asked the stand-in for a wall; the stand-in builds none, and
  the box's check is answered from the flags its run asked for. Two exceptions: the net's put-back runs for real
  on the rehearsal's files, and one group runs the proof's own attempts with no wall, to show each gets through.
  Only a real Spark shows that systemd and the kernel hold a wall: `test/README.md` ("The root helper's tests")
  lists what that covers, and section 8, step 4, has the lines to run. These tests need Linux with GNU tools and
  bash 5; on macOS about 200 of them fail.
- **Tests that still passed with their guard out.** Our final read took guards out of the code and ran the tests
  that name them. Many still passed. Those were rewritten, and each guard test the fixes added was run by its
  builder against the code without its guard, and failed there. This was not done for every older test.
- **Landing.** Each step landed on `main` alone, on the tests its change affects (`tools/land.mjs`, R29); the whole
  suite of the new tip follows. That order has a cost: on 2026-11-15 tests in `selfchange.test.mjs` and
  `turn-budgets.test.mjs` had to be fixed on `main` after steps that had landed apart met there (commits `214e50d`
  and `58d6b2b`).
- **The full gate.** `node test/lock.mjs` runs every test file strictly and writes the lock only if all pass. It
  runs in a container on a compute Spark, with no network and no access to Docker (`tools/test-on-spark.sh`), and
  on GitHub on every push (`.github/workflows/full-run.yml`: the job that runs the code can only read; a second
  job that runs none of it pushes the `tested/` tag). That second job refused every lock from the commit of
  2026-11-14 that added the lock's `evalSet` key until the final read's fix, so the commits since then got no tag
  from it; tags resume when this build is pushed. `test/lock.test.mjs` now holds the job's key list equal to the
  lock's. The installer refuses a lock that doesn't match the code.
- **The result.**
  The whole suite is run on the exact commit that is sent, in a container on a Spark, before that commit is pushed.
  Its result (how many tests, the date, how long it took) is in the owner's message, because a commit cannot hold
  the result of its own run. That message also says what the whole runs made during the final read's fixes showed.
  A test skips itself where a program it needs is missing; in the runs we have seen, the one skipped was the zsh
  case in `test/state.test.mjs`.
- **Reviews.** Opus 5.5 built the steps and Fable 5.2 read them. The dangerous pieces were read more than once
  before they were switched on: R64's Why names a sixth review of the sorter, R60's Today a third read of the
  net's helper half, R70's a fourth read of root. Then came the final read by eight reviewers (the top of this
  page). Findings were fixed with a test or written into a rule's "Today" or "Later" lines.
- **The brain eval.** `test/eval.mjs` runs 33 cases, 3 runs each; six are command cases for `run`
  (`test/eval-commands.test.mjs` checks their grading on the stand-in). It has not run on the real Qwen for this
  build.
- **The page.** On 2026-11-15 the page was checked in a browser on a stand-in fleet, at desktop and phone width: it
  loads, a chat and a button ask work, a change ask shows its lines above its buttons, and the dangerous ask shows
  its lines, the exact command and the two-digit box. The change ask and the dangerous ask were sample messages put
  into the page, because a stand-in fleet on a Mac has no helper. We have no record of a browser check since.
- **Not checked: the live run.** No real Spark has this build's root helper, and no Spark has root on (R42 and R70
  say so). So no look, change, lock-out change, Spark 2 change or root command of this build has run on real
  hardware, and the walls' proof has never run on a real systemd and kernel. Section 8 says what is installed; what
  is not has not run on a real Spark either.

**How to run the tests yourself** (Node 22 or newer, Python 3, bash, tar; tests bind local ports):

```bash
cd spark-console
node tools/make.mjs --check
SPARK_TEST_STRICT=1 SPARK_TEST_SLOW=3 node --test test/sort.test.mjs
SPARK_TEST_SLOW=3 SPARK_TEST_CONCURRENCY=1 node test/lock.mjs
```

The whole suite is run on Linux. On the owner's Mac it takes hours (`test/README.md`), so there run one file at a
time. After changing a part, run `node tools/make.mjs`.

## 8. Install and the checks after it

Spark 2 runs build `32cfab4f06fa`, installed on 2026-11-14, after round 1's reply was written. Nothing built since
then is installed: not the phase that was a plan, and not the final read's fixes.

The install runs from the owner's Mac, with a note of what changed:

```bash
NOTE='what changed, in plain words' bash spark-console/deploy/host-on-portal.sh
```

Two things must be there first: on Spark 2 a Node of its own, version 22 or newer and not under the owner's home;
and `service/workflows.lock.json` from a whole-suite run of this exact code. The installer stops without either.
It saves the current build and its state, installs the new one, waits for it to stay up for 40 seconds, checks the
ways in, the agent door, the model address and one chat turn, and on any miss puts the old build back. If the
console ever stops answering: `bash ~/.local/share/spark-console/go-back.sh` on Spark 2.

**The first install of this build has to come from the Mac.** Later builds can come from chat (`install_update`),
once `deploy/pull.sh` is set up on Spark 2 with a read-only GitHub token. But the lock installed on Spark 2 today
names no tree, so `pull.sh check` cannot tell which commit is installed: it says so, offers nothing, and an
install from chat is refused. After one install from the Mac, with the final whole run's lock, `check` works.

After the install, in this order. Each step is the owner's.

1. **The brain eval on the real Qwen, and its result kept** with the passkey press
   (`docs/how/run-the-brain-eval.md`). Until then Sparkie asks before every change (R52).
2. **"Approve from Telegram".** It reads as off for a pairing made before the switch existed; the owner turns it
   on once, on the page, with the passkey.
3. **The helper's one-time command, per Spark.** First `bash spark-console/deploy/root-for-sparkie.sh --check 3`,
   which changes nothing. Then each compute Spark, then Spark 2 last with `--hub`; `--with-root` only where the
   owner wants root. Each run prints the proof of the walls, and must say every attempt was blocked; a failed
   proof removes the helper again. Until it has run on a Spark, `run` and `write_file` answer with that command and
   run nothing there. The box does not wait for it: it needs only Docker on a compute Spark.
4. **What only a real Spark shows.** Inside a plain change (`run` with each of these as its command), the first
   must print nothing and the other two must fail:

   ```bash
   ls -A /dev/pts
   echo > /dev/udp/224.0.0.251/5353
   test -w /sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/cgroup.procs
   ```

   Also by hand inside a plain change: the top of the home read-only, no GPU, names resolve, the tailnet and the
   home network out of reach. One lock-out change kept and one left to go back. A restart inside the net's window.
   A root command kept and one left to go back. The box's check. On Spark 2, the call through the owner's service
   manager (the card says it needs systemd 254).
5. **One real run of each changed workflow:** a start, check, restart and stop of a small model on Spark 3 or 4; a
   start across Spark 3 and 4; "find setups for a model". Then a Jupyter box and one short job, as before.
6. **The self-test** (`self_test`), which also proves the walls again on every Spark that has the helper.
7. **The coding trial** (`agentbar/trial-on-spark.sh`). Self-change stays off whatever it says.

To turn on the app door (optional): `bash spark-console/deploy/open-apps-to-internet.sh`; `--undo` closes it.

## 9. What would help most from a review

The most dangerous paths first. Each names the files and what we most want attacked. Our final read attacked the
same paths; an item says what it closed, so you can start where it stopped.

**1. The root helper and its one-time command.** `deploy/spark-console-root`, `deploy/root-for-sparkie.sh`; R42,
R63; `test/root-helper.test.mjs`.
- The sudo line lets any program running as the owner call the helper, not only the console. What does such a
  caller gain with `run --open`, `--home`, `--asked` or `--net`, with `keep`, `putback` or `stop --id`, and, where
  root is on, with `root --net` and no ask at all?
- The walls are systemd settings. The final read added three: a look and a plain change get no terminal of the
  Spark (`/dev/pts`), read-only control groups, and no multicast or broadcast; and more is hidden from a look.
  Name a setting that DGX OS (Ubuntu 24.04) accepts and does not hold, or a way out the proof's 31 attempts do not
  try. The proof counts a "blocked" only when the same attempt worked outside the wall: find one where that is
  wrong. No test can settle this (section 7).
- The one-time command: something that can write the owner's home changes what root installs, between the check
  and the move. It now proves the sudo line without the password sudo cached.

**2. The sorter.** `service/src/20-sort.mjs` and the nine parts beside it (section 4.1); R55, R64;
`test/sort.test.mjs`, `test/sort-close.test.mjs`.
- Where it cannot tell, it now takes the stricter class (the last part of R64's Rule): a container that reaches
  the host, a way-in process killed by a pattern, a host that may be Spark 2, a container named only by an id or
  a `$` (it may be the brain's). Its lists of programs and words can never be complete. Find a command it calls a
  plain change that changes a way in, runs code fetched by the same command, or writes what a program outside the
  wall later runs. R55's and R64's Today list the misses we know (an interpreter's one-liner is a change by design).
- A string its reader (`shellLex`, `shellParse` in `20-shell.mjs`) and real bash read differently.
- A "look" that is not one. A look has root's read rights: find a secret the hidden list (R63) misses. What a look
  prints goes to the brain and the journal.

**3. The ladder and the runner: at once, a button, or the dangerous ask.** `service/src/21-work.mjs`,
`21-ladder.mjs`, `21-runner.mjs`, `21-copies.mjs`, `20-danger.mjs`, `20-came-from.mjs`; R61, R72, R54;
`test/ladder.test.mjs`, `test/runner.test.mjs`, `test/runner-fixes.test.mjs`, `test/danger.test.mjs`,
`test/pressed.test.mjs`.
- `run` and `write_file` are registered as lookups, so `runAction` in `16-actions.mjs` hands them on before its
  checks for a change; afterwards it counts one that ran toward the hour's 12 changes (`hourCounted`, R9). The
  ladder makes its own checks: who may, the pause, the rail, the claim, the journal. They write no audit line; the
  journal is their record. Is anything `runAction` holds for a change lost?
- "Nothing read since": only a call that ran counts as a read. Find text from outside that reaches the brain
  without counting (a lookup in `INSIDE_READS` that carries a container's name, a label or a file name someone
  else chose), then a change at once.
- Whose words count (`changeIntent`, `ownSentences`, `calledOff`, `workOrder` in `16-actions.mjs`; R25;
  `test/intent-own.test.mjs`, `test/fix-intent.test.mjs`, `test/agent-words.test.mjs`). The final read ran a
  change at once from a pasted code block, and found an agent's message taken for the owner's. Both are closed,
  by rules about what a sentence of the owner's looks like: a judgement. A miss one way costs a button. The other
  way it is a plain change at once that the owner did not ask for: find words that are no order and still count.
- The press sorts the command again, takes the Spark's claim, then reads each script's hash again; the unit's
  first lines check it once more, and the script runs by its path (R72). The ask shows the hash, not the text, and
  a write between the unit's check and the command's own read is not seen. Find a change between the ask and the
  run that these miss. And the copy first: a command that removes or overwrites a file the sorter did not place,
  where undo then says everything is back.

**4. The lock-out net and its put-back.** `net_arm`, `net_after`, `restore_sh`, `guard_py`, `boot_unit`, `do_keep`
and `do_putback` in the helper; `service/src/21-net.mjs`, `21-guard.mjs`; R60, R71; `test/net.test.mjs`;
`docs/history/later-2026-11-15.md`.
- A change that passes the check right after it and locks the owner out later: a unit disabled, a network file not
  applied until a restart. Live firewall rules are said, not put back.
- "The owner's own words" is decided by `netWhose` and `netAsks` in `21-net.mjs` (R71). One sentence of the
  owner's newest message must name the Spark, name a way in as what a change verb acts on, and be an instruction.
  Only their own sentences are read: not a code block, a quote or a pasted log, not the message before. That is
  word lists, so a judgement: a true ask it misses is refused, never run, and told how to ask; a sentence that
  only looks like an ask ("set the hostname in config.yaml on Spark 3") passes to the dangerous ask, and nothing
  runs before the owner's press with its two digits. Find a sentence that is not an ask and passes.
- The timer: a way for the change to stop, delay or outlive it; a power cut at each step of arming and put-back.

**5. Changes on Spark 2.** `service/src/21-hub.mjs`; R1; `test/hub-change.test.mjs`.
- `hubRefuses` reads the command's words; the wall is what holds. A walled command still reaches, at 127.0.0.53,
  whatever listens on every address (R63). On Spark 2, does the brain's port or the console's answer there?
- A put-back on Spark 2 stops and starts the console itself. Find the order of events that leaves it down.

**6. Root.** `service/src/21-root.mjs`; `root_off` and `root_named` in the helper; R70; `test/root.test.mjs`.
- Root has no wall, and the check on names is not one (R70 says so). Spell a command that removes the net's timer,
  root's switch or the sudo line past it.
- A root command that runs a script, or other code it does not show, is refused now (`rootUnseen`), and so is a
  mount. Find code that runs unseen and passes. And what a root command prints comes back to the brain and the
  journal, masked only by shape.

**7. Keys.** `service/src/20-keys.mjs`, `21-run-keys.mjs`, `03-secrets.mjs`; R51; `test/app-keys.test.mjs`,
`test/run-keys.test.mjs`.
- Only the owner's press stands before a command given a key. Get a press for a command whose leak the button does
  not show: a host the sorter does not read as one, a file the command writes.
- Where a key can still land: the held file on the Spark, a core dump, the journal, memory, a Telegram message, a
  copy of the chats made before the key was given. The stored chats are cleaned now (`hideKeptInChats`); R51's
  Today lists what is not.

**8. `write_file`.** `service/src/21-write.mjs`; R68; `test/write.test.mjs`.
- It is sorted as a plain `cat > path`. Find a path where the real write does more than that says: a file a
  program outside the wall runs later, a name that means something else to the shell.
- Lines `from` to `to`: the file changes between the read and the move. An old line shown on the ask is masked
  now; find one that still shows a key or a password.

**9. The box.** `service/src/21-box.mjs`, `21-box-fill.mjs`; R62; `test/box.test.mjs`, `test/box-more.test.mjs`,
`test/box-fill.test.mjs`.
- It does not use the helper: the console starts it with Docker over SSH, as the owner. One wrong flag in
  `workBoxCommand`, or a line of `BOX_CHECK` that passes when it cannot tell, and code from a web page runs with
  more than its own folder. In tests the stand-in answers the check from the flags.
- `tarRead`: an entry that gets a path, a link or extra bytes past the reader. And what a box command prints is
  outside text: can it lead to a change on a Spark in the same request, unasked?
- Several boxes on one Spark must each fit in the memory free beyond the 8 GB kept (`boxRoom`): find two that don't.

**10. Sparkie changing its own code (off), and updates.** `service/src/21-selfchange.mjs`, `21-brain-trial.mjs`,
`21-updates.mjs`, `deploy/pull.sh`, `deploy/update-guard.sh`, `agentbar/trial-lib.mjs`; R67, R69, R58;
`test/selfchange.test.mjs`, `test/trial.test.mjs`, `test/pull.test.mjs`, `test/install-update.test.mjs`.
- Reach `selfStart` or `selfSend` on a real console while `SELF_CHANGE_ON` is `false`. The tests turn it on with a
  file in the state folder, on the stand-in fleet only.
- If it were on: a proposal that gets a protected path or a weakened test merged under "Nobody else reviewed
  this."; a file whose contents hold a key; a file that makes the installed generator do more than read it.
- `install_update`: a `tested/` tag that names a tree that was not tested; an install that passes its checks and
  still breaks sign-in. The final read found `check` offering an older build as newer; it now offers only a build
  whose commit is after the installed one, and nothing when it cannot tell (`installed_on_main` in
  `deploy/pull.sh`). Find another way to go backwards.

**11. The go-ahead and "Always allow".** `service/src/21-ahead.mjs`; R65; `test/ahead.test.mjs`,
`test/allowed.test.mjs`. A kind is a tool, a folder and a Spark. Find a tool that may have a kind and that, with
other arguments in that folder, runs code or reaches further than the command the owner pressed for.

**Still wanted, as in round 1:** anything that could lock the owner out through sign-in, recovery codes, the
installer's go-back or the internet switches; anything that could stop or remove a healthy model or lose data; keys
in chat, logs, the page or Telegram; Sparkie saying something happened when no tool said so; whether the page and
Sparkie's words stay plain and calm.

## 10. The phase that was a plan is now code

The plan is `docs/design-2026-11-13/README.md`: one page, six milestones, the owner's 22 decisions, seven designs
beside it. It was left as written. The rules are the record of what was built.

| Milestone | Became | Not built, or held back |
|---|---|---|
| 1 Ground | R29, R46, R47; `21-selftest.mjs`, `21-guide.mjs`, `21-brain-eval.mjs`; the tools in section 3 | |
| 2 Commander | R42, R43, R51, R54, R55, R60, R61, R63, R64, R65, R68, R70, R71, R72, and R1 for Spark 2; the helper; the groups of section 4.1 from "Look" to "Root" | The fresh visit for the hub and for sign-in changes |
| 3 Memory | R45, R48, R59; `20-memory.mjs` and the four parts beside it, `20-recall.mjs`, `20-digest.mjs`, `20-lessons.mjs` | |
| 4 No laptop, lighter hub | R58, R32, R23, R33, R49, R37; `21-updates.mjs`, `20-beat.mjs`, `20-state-copy.mjs`, `22-putback.mjs` | Clearing Spark 2 is a script the owner runs (`deploy/clear-spark2.sh`) |
| 5 On its own, any brain | R50, R52, R66, R62, R67, R69; `14-tasks.mjs`, `21-brain-rail.mjs`, `21-box.mjs`, `21-selfchange.mjs` | Self-change is off; the coding trial waits for the owner |
| 6 Workloads and power | R41, R56, R57; `21-power.mjs`, `18-step-jobs.mjs`, `21-compare.mjs` | Adding a Spark from chat (waits for Spark 1) |
| After | | A brain across Sparks |

**Where the code differs from the plan, and why.** Mostly the code is stricter.

- **Root is always asked, and never a script.** The plan let a plain root command run at once on the owner's
  words. With the helper's sudo line in place, any program running as the owner could become root before the
  console's ask exists (R70's Why). So root is off on a Spark until `--with-root`, and through the console it is
  always the dangerous ask. A script's text is not on the button and can change before the press: it is refused.
- **A lock-out change is refused unless a sentence of the owner's newest message asks for it,** with nothing read
  since. The plan asked about any of them. Contract 8.3 says "never because an agent, a page or a fix suggested
  it". **And it runs only as root.** The plan let one run as the owner inside the net. In the run wall the owner's
  user can change none of the ways in, so that path changed nothing and cost a dangerous press: now "set root".
- **Spark 2.** The plan kept a hub change only after a fresh visit through the changed way in. That proof is not
  built. So a lock-out change on Spark 2 is refused, and any other change is kept by code once the console's own
  ways in still answer.
- **The press checks a script's hash; it does not hold its bytes.** The contract (8.18) and our reply to P-5 said
  a script is read once, shown, and those bytes run. The build shows the SHA-256, checks it again at the press and
  as the unit starts, and runs the script by its path (R72).
- **"At once" is narrower.** Not while a Spark has Tailscale SSH on; not while something else listens on every
  address; not into the model store, the Hugging Face cache or the shared folder; not with the GPU, another Spark,
  `--home` or `--open`; not after a look in the same request; not on words the owner only pasted or quoted.
- **Times are shorter.** A change at once has 30 seconds, or up to 10 minutes with `minutes`; more is asked. A
  change on Spark 2 has 30 seconds, where the plan allowed 10 minutes. As root: 10 minutes for a lock-out change,
  30 for anything else.
- **A command given a key is always asked.** The plan asked once per new place. A command can show a key in a form
  no mask knows, so only the press stands before it (R51).
- **Smaller points.** The go-ahead comes only from a button, never from the owner's words. Opening a box is a
  change, so the pause and the rail apply. The coding trial has three tasks, each a one-line slip in memory's code.

**What we ask.** The same hard review as the first build, on the code, in the order of section 9. For P-1 to P-6,
say whether the code now does what you asked: P-1 in the helper's timer (R60), P-2 in the journal's start line
(R43, R61), P-3 in `22-putback.mjs`, P-4 in the eval's record (R47, R52), P-5 in the hashes a press checks (R72,
R54, R70; less than our reply first promised, as the reply now says), P-6 in the install ask for a proposal (R69).
P-7 was about the wording of `docs/design-2026-11-13/g-memory.md`.

**How to report.** `docs/review-astra/README.md` has the procedure, as in round 1. Put round 2 in a new file,
`findings-2.md`, beside round 1's. Old ids keep their numbers: for each row of `open.md`, agree or rebut. New
findings on the code continue from A-13. For each: how bad, the concrete way it goes wrong (who does what, what
happens), where (the file and the function or test), the smallest change that closes it, and what you ran against
what you only read. For "how bad", everything is built now, so please use: blocks the install; must change before
the helper's command runs on a real Spark; must change before root is turned on; later; or a suggestion. End with
what is over-built for one owner and four machines, and what is missing.
