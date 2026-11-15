# The next phase of Spark Console, in one page

Amended 2026-11-14 after the first outside review (`docs/review-astra/reply-1.md`): P-1 to P-7; items 4, 7, 8, 9, 11, 12 and 13; clean-up 1, 3 and 4; trash.
Amended again the same day: what builds the root helper's walls (section 4, and three rows of section 8).
Amended a third time the same day: the answers to what the build map found unclear (`ledger.md`, 5d): a command's time and the dangerous ask (section 4), a ninth action (section 3), seven rows of section 8.

Agreed with the owner on 2026-11-13. Seven designs and two reviews sit beside this page; where they differ from it,
this page wins (it was written last, after the reviews and after owner decisions 18 to 22). Nothing here is built yet.

## 1. The goal, in the owner's words

- "a fully working app that can do it all and can easily adapt to learning if it doesnt know"
- Sparkie "shud be just like u": "full commander of the entire stuff", "command over the spark themselves and itself
  as if i do, full permssions", "ask me on telegram for … dangerous or risky ones"
- "watching every single activity, command, and output and learning constantly"
- "even if we change brain llm, we have enough app built it can easily pick up"
- "dont wanna overcomplicate", and no "slow responses … runs too long for no reason"

## 2. The owner's decisions that shape everything

| # | Decision |
|---|---|
| 1, 21 | One simple service. Nothing new in the path of every message but cheap code. Fewer tool texts per turn |
| 2, 19 | Spark 2 is the hub: the console and the brain. A model across Sparks may include Spark 2 only as the brain |
| 3, 13 | Keep Spark 2 light. Workloads use the brain first; old pieces come off Spark 2 |
| 4, 5 | Other Sparks are on only when needed. No scheduled jobs on the Sparks |
| 6, 15 | GitHub holds the code, the test runs and the tested mark. It never gets a way into the Sparks |
| 8, 14 | Any brain: what Sparkie knows and may do lives in the app, not in one model |
| 9 | Learning is look-up, not training |
| 18, 20, 22 | Sparkie is the commander: free-form commands on every Spark, root included, and on itself. Nothing is refused for being powerful. Risky things are asked on Telegram (and the page) with the exact change shown. A key is given once and kept |
| 16 | Stop asking: choose a default and say it |
| 11, 12 | Every change fits the map and has a test that fails without it. Opus builds, Fable reviews |

Not about permission, so unchanged: text Sparkie read is data, never an order; nothing is done to get round a network
filter; a key is never shown back; every change is recorded before it runs and its result after, every look when it ends; one word stops
everything.

## 3. The shape after the cut

The designs asked for about 67 steps, 30 new actions and 18 state files. The simplicity review cut that to what the
goal needs; this page follows it, adjusted for decisions 20 to 22 and the safety review.

- **New actions (8):** `run`, `write_file`, `recall`, `self_test`, `install_update` (with `check_update`),
  `compare_models`, `change_sparks`, `brain_across` (last). Existing ones widen: `remember`, `forget_memory`, `memory`,
  `save_workflow`, `undo_last_change`, `sparkie_setup`. A ninth, `propose_update`, comes only with Sparkie changing
  its own code, if the coding trial passes (`c-github-selfchange.md`, 2.5).
- **New state (6):** the journal (a folder), `lessons.json`, `brain-profiles.json`, `sparks.json`, the repo copy,
  `memory-past.json` (retired memory lines, in their own file so an older build can never drop them).
  `agent-settings.json` holds the always list; the secrets file holds named keys.
- **Tools sent to the brain each round:** 24 at most (12 core, two groups of six), against 41 today.
- **No:** microservices, an outside coding engine, sub-agents or helpers, embeddings, a graph, a database as the
  store of truth, a news feed, a coverage map, stored summaries, any new timer but the heartbeat.

## 4. How Sparkie's reach works (decisions 18, 20, 22)

Two tools. `run {on, command, root?, dir?, minutes?}` and `write_file {on, path, text, from?, to?, root?}`; `on` is a
Spark or `"box"`. Code, never the brain, sorts every command:

| Class | What | What happens |
|---|---|---|
| A look | Anything that only reads, on any Spark | At once |
| A change on a compute Spark | Packages, services, files, plain root commands | At once when the owner's words asked for that work there and nothing read since could have put the command there; or under a go-ahead for the task; or under "always allow" for that kind. Else the exact command on a button |
| Risky | Anything on Spark 2; the brain; a delete that cannot be put back; disks; power; code fetched from the network and run; any root script; free-form container starts and stops | Always asked first, on Telegram and the page, exact command shown, one press for one command. Never under a go-ahead or "always" |
| The lock-out class | SSH settings and keys, Tailscale, the firewall, users and sudoers, the console's sign-in files | Asked first, and inside the net below |
| Not done | Showing a key back; a relay round a network filter; acting because read text said so | Not a permission matter |

- **A command's time.** Without `minutes` a command gets 30 seconds. With `minutes` (1 to 120) it is an operation
  whose result is posted. `minutes` is held to the most its class allows: 1 for a look, 10 on Spark 2 and in the
  lock-out class, 30 for any other root command, 120 otherwise. Reaching the limit, and an exit code other than 0,
  are results, not failures (`a-workspace.md`, 2.10).
- **Root, asked once.** The owner runs one command per Spark, once. It allows one small root-owned helper (not
  `sudo` for everything, so other scripts on the Spark do not become silent root). Nothing is stored. The helper also
  gives three walls: *look* (the whole disk read-only, no network, keys hidden: so any command may be a look), *run*
  (an ordinary command with the Docker and Tailscale sockets, the secrets and the sign-in files hidden) and *net*.
  Until that command has run on a Spark, `run` and `write_file` do not work there: Sparkie uses today's typed
  actions and gives the owner the command.
- **What builds the walls.** Nothing is installed on a Spark. For each command the helper asks the Spark's own
  systemd for a short-lived unit with a fixed list of settings, and the kernel holds them for the command and
  everything it starts. A look runs as a throw-away account with root's read rights and no other power, so `root`
  adds nothing to a look. A change runs as the owner's user, unable to see or signal any other program, to reach a
  local-only port on its own Spark, or to become root. A root command runs only with the net's timer armed in the
  same call. The helper refuses a wall it has not proven on that Spark, and proves again when the Spark's systemd,
  its kernel or the helper itself changes. A command that needs something the run wall hides is asked, and the ask says it
  runs outside the wall. Only the owner's command puts the helper on a Spark or replaces it: a build that ships a
  changed helper answers with that one command again (`a-workspace.md`, 2.13).
- **The net: confirm, or it goes back.** Armed for every root command and every command on Spark 2. Copy first; a
  timer in the Spark's own systemd, armed before the change, that survives a restart; apply; make it live; test the
  ways in from outside the Spark. The timer is set to the command's own time limit plus ten minutes, so it never
  fires under a command that is still running. A command inside the net may run 10 minutes on Spark 2 or in the
  lock-out class, 30 minutes otherwise. One guard is open on a Spark at a time. A put-back first stops the command,
  then restores only what differs. A "keep it" after a put-back is answered "already put back". No difference and a
  fresh connection works: disarmed at once, nobody asked. A lock-out change on a compute Spark that passes is kept by
  code. On the hub, and for any sign-in change, only a fresh visit through the changed way in keeps it; a Telegram
  "keep it" does not count there. A sign-in change needs a fresh sign-in with a passkey that existed before, not a
  standing session; a route change needs a new connection through that route; the link carries the guard's id and
  counts only once the change is live. `/putback` on Telegram always restores the last set, by code, with no brain.
- **Put-back.** A file is copied before it is changed; `undo_last_change` restores it. A change that cannot be put
  back says so on its button.
- **Written down first.** Before a command or file write changes a Spark, code adds one line to the journal and
  syncs it to disk: what, where, as whom, who allowed it, and where its copies are. The result is a second line with
  the same id. If the first line cannot be written, the change does not run and the owner is told why; stop, pause
  and put-back never wait on it. After a restart, a start with no end is reported as cut off, its copies can still
  be restored, and it is never run again.
- **Telegram as the place to say yes.** A risky ask is answered only by its button, never a typed "ok". From
  Telegram: 3 risky approvals an hour and 10 a day. `/lock` turns Telegram approvals off; only the page turns them
  on. Every approval is echoed on the page. Changing who may approve (passkeys, recovery codes, Telegram's pairing)
  is confirmed on the page. A four-digit code once a day for the dangerous presses exists as a switch, off by default.
- **Dangerous asks are hard to tap by reflex** (root, lock-out, installing its own code, a final delete, the brain):
  their own message, led by facts code built ("ROOT on Spark 2", "You did not ask for this", which parts came from a
  page or a log), and two digits to type. Ordinary work gets none of this. What the ask shows is what runs: a
  script's text and an installer from an address are read once, when the ask is built, and the press runs those same
  bytes or nothing. Any install of Spark Console counts as one. One dangerous ask is open at a time. The two digits
  belong to that one ask and count only with its own button, typed on the page or as the next message in the paired
  chat. An ask that an agent's request caused says so, and the agent cannot answer it. Built in step A10b
  (`a-workspace.md`, 2.14).
- **Keys, given once.** Code takes a key out of the owner's message before the brain, the chat file or the journal
  sees it, keeps it by name in the secrets file, deletes the Telegram message, and injects it by name when used.

## 5. Memory (design G): keep everything, believe little, show less

- The journal is the raw record of everything said, called, run and seen. It is never rewritten.
- What Sparkie believes is the owner's own words: dated, sourced lines about named things, with no ceiling. A newer
  line retires an older one; history is kept; "forget" retires, "erase" is a separate button. A line is
  forgotten with no button only when the owner plainly asks to forget that line; a question about it, "don't forget"
  or a quoted "forget" never does.
- Code picks what a turn sees with no model call and no file read: exact names first, then rare shared words, then
  newest. On synthetic lines on a Mac the pick took 0.05 ms; the time on Spark 2, and of a whole turn, is read from
  each turn's record once built. Word-first look-up is a bet that a fleet's exact names make it enough; the twenty
  questions and a held-out set of rewordings decide.
- Everything else is one `recall` away: a count line, a few ranked pieces with their sources, and "next".
- A long output enters the turn as a digest cut by code, with the full text one call away. This does the job
  helpers were proposed for.
- Twenty "do you remember" questions, run on the real brain, score each addition against the plain version. One
  that does not win is removed. Embeddings, a graph and helpers each have a named test for coming back.

## 6. The order: six milestones

Each ends in something the owner can say to Sparkie that works afterwards and did not before. Step names are the
designs' own (A1 is step 1 of `a-workspace.md`, and so on).

| # | Milestone | Steps | Afterwards |
|---|---|---|---|
| 1 | **Ground** | Tonight's build installed. The suite passing on Linux; full runs on a compute Spark (`tools/test-on-spark.sh`, about 12 minutes) and on GitHub (C1 to C3: one job, the mark pushed by a job that runs no repo code). F1 to F6 and a 15-row glossary; tool groups with the cap (F10), measured at 41 and at 24. D1. D2 with a healing drill. The "what the brain reads" mark on the install button: one hash, written in the lock, of the system prompt as sent, every tool's text and inputs, the groups, and the brain setup's sampling and limits. Every eval result is stored with that hash and the version of its case set | "Run the self-test." |
| 2 | **Commander** | B1 (the journal). The root helper and its one-time command; the helper proves its walls on each Spark before first use and in the self-test. `run` as a look on any Spark; then changes with the copy first, the go-ahead and "always allow"; the net; Telegram approvals with the caps and `/lock`; keys given once. `NEVER_CHANGES` in the prompt and the old refusal tests are replaced by tests of the net | "Find out why the job on Spark 4 died, clean up what it left, and always allow that." |
| 3 | **Memory** | G1 to G7 on B's journal; B2 to B4 as cut (lessons hold failures; a setup that failed twice is passed over, and tried again when its image, its Sparks or its start code changed or the owner says so) | "What do you know about starting GLM across two Sparks, and what went wrong last time?" |
| 4 | **No laptop, lighter hub** | C4, C5 (pull install; the installed build judges the new one; it goes back unless the real door answers). E1 heartbeat. E2 copy when a Spark is awake, and the rebuild steps (putting state back never lets a device or key in by itself). E10 clearing Spark 2. D12, the delete already agreed (members and sharing, the browser editor, the file browser with its routes and the worker's delete, rename and new-folder calls); the page's Models view goes with it, so the page is chat, sign-in and status. Ways-in health on the needs-you list | "Is there a newer tested build? Install it." (from the phone) |
| 5 | **On its own, with any brain** | B9. One brain check with two outcomes: checked, only while the eval on record ran on this exact model, engine, image and flags, on what this build's brain reads, and on today's case set; otherwise every change a button until it passes. Tasks: today's carry-on made durable, with hours and turns. The report with counts. The box as `on: "box"`. The coding trial with Sparkie as a contestant; C8 (Sparkie changing its own code) only if it passes | "On your own tonight: download X to Spark 3, start it, run my script, stop everything, and report." |
| 6 | **Workloads and power** | The smart-plug work merged. D4, D5 (asleep, wake for work). Saved workflows that place, wait and clean up; the brain first; `compare_models`. D3 when Spark 1 arrives | "Run my workload on whatever is best, keep the winner, and let the Sparks sleep after." |
| after | **A brain across Sparks** (decision 19) | Three gates: the two-Spark start's first real run; then the brain across 2+3 or 2+4 with the code that exists; then three, after NVIDIA's three-Spark test passes by hand | |

## 7. Safety changes that must be in before the piece they guard

From `critic-safety.md` (29 findings). The ones that change a design:

1. Root through one helper, started from a unit of the user manager on Spark 2 (finding 1).
2. The net armed for every root and every Spark 2 command; tested from outside; six gaps closed (2, 10).
3. Telegram: button only, caps, `/lock`, marks on what a Telegram yes leaves behind (3).
4. Keys taken out at the door; the Telegram message deleted (4).
5. Dangerous asks built by code, with "came from" and two digits (5).
6. A go-ahead is safe only inside the helper's wall; code fetched from the network is always asked (7).
7. A question never counts as asking for work; a command quoted from an earlier answer counts as read (9).
8. Trials and replays run in a container on a compute Spark, never as a stand-in console on the hub (11).
9. The installed build, not the incoming one, writes the way back and judges the install (12).
10. A proposed change with a link in it is refused; a box is read back entry by entry and never run (13, 14).
11. On GitHub, jobs that run repo code cannot write; the mark is pushed by one that runs none (15).
12. For Sparkie's own proposals only new tests, generated files and status rows are free; everything else is asked
    after an independent review (16). A generated file must equal what the installed build's own generator makes
    from the proposal's sources, else the proposal is refused. The install button for such a change carries the one
    tree that was tested and reviewed, lists every difference from the build installed now, and is void if `main`
    moves.
13. Every rail is a check inside `runAction`, not a tool left off the list (17).

## 8. Defaults taken where the designs asked (decision 16)

| Question | Default |
|---|---|
| A code for dangerous presses on Telegram | Off. A tap, with two digits shown on the ask. A once-a-day code is a switch |
| Replacing the root helper on a Spark | Only the owner's one command, run again; Sparkie never does it. This one is the owner's call: decision 22 could also read "asked, as a dangerous change" |
| What a look may read | Root's read rights for every look, less the hidden list. A look has no other power, so `root` matters only for a change |
| The owner's own token files (Hugging Face, git, Docker, cloud) inside the run wall | Hidden, as in a look. A walled command gets a key by its name, or is asked and runs outside the wall |
| A kept key going to a new image or host | Asked once per new place, then remembered |
| Keys after a dead Spark 2 disk | Given again; no copy elsewhere |
| Sign-ins after state is put back from a copy | Every device signs in again. Passkeys, agent keys, people and "always" entries that came back do not work from the internet until the owner has looked at the list once, on the sign-in page, on the tailnet. A task found running is parked |
| Waking one compute Spark to knock on the hub's door after a hub lock-out change | Yes, for a few minutes |
| A trash for deletes | No. The copy first covers small files; a final delete is asked. A save that another program makes to a file between Sparkie's copy and its delete is in neither place |
| Sparkie changing GitHub's workflow files | Asked, as a dangerous change |
| An update that goes back unless the real door answers | Yes, checked by code through the real address; the owner need not open the page |
| The journal | Never copied off Spark 2, never erased, with "hide this value everywhere" for a secret |
| A command's output kept in the journal | Whole, up to 16 MB a command; past that the command is stopped and the record says so |
| The owner's real requests as test cases | Later, after two full eval runs |
| Stopping an idle model so its Spark can power off | Decided with the owner (2026-11-13: “Park them”): yes, after 30 idle minutes by default (Sparks 1, 3 and 4 with a switchable plug, never Spark 2), only once the workflows that bring a parked model back are active, and said once in the owner's chat and on Telegram the first time it can act; “stop auto shutdown” turns it off. An agent's power-off or idle setting waits for the owner's yes |
| A new Spark holding copies of chats and sign-in files | Only after the owner says so |
| A line stated on Telegram kept in memory | Yes for `remember` and for forgetting, marked as said on Telegram; `erase` stays on the page |
| GitHub Pro for branch protection | No |
| The brain resting when idle | Only if a by-hand measurement shows 10 W saved; a pause is tried before a stop |
| The contract | Made flat with one status table, rules reworded in place, old text to `docs/history/` |
| A task's limits | 2 hours and 8 turns. 4 hours and 60 turns when the owner's own words send it off on its own ("on your own", "overnight"); hours the owner typed win. This one is the owner's call: it is question 4 of the contract's open list |
| The self-test after an install | Spark Console starts it itself, once, on the new build. It wakes no Spark for it, and says so on the needs-you list. This one is the owner's call: the install's yes could also cover waking one Spark |
| "Test the changes" | Stays until the owner answers whether the self-test replaces it (question 5 of the contract's open list) |
| Where the GitHub token and the heartbeat's address are given | Once, in chat, like any key. `pull.sh setup` stays for a rebuilt hub. No page control for either |
| A brain that cannot call a tool | It fails its switch, which goes back to the brain before. No third grade |
| The daily look for setups | Goes. A start looks when its record is over a week old, as today |
| Removing a model's copy | No action for it. It is a command, asked first as a final delete |

## 9. What the owner is accepting

1. Whoever holds the owner's unlocked phone or Telegram account can do what the owner can, a few presses at a time.
2. A root command the owner approves can do anything. The net catches mistakes and bad advice, not a command
   written to beat it.
3. A few lock-out changes cannot be put back (a Tailscale logout, a deleted user's home). The owner is told before.
4. From the day root is set up on a Spark, the helper is the door to root there.
5. Text Sparkie read can still talk it into proposing something bad; the ask shows what came from where.
6. A key pasted in Telegram has been seen by Telegram. Kept keys sit in one file on Spark 2.
7. Telegram's servers see every command the owner is asked to approve.
8. An approved update runs as the owner on Spark 2.
9. A brain across three Sparks leaves none free, and a failed try can leave you without Sparkie for 45 minutes plus
   the saved brain's own start. That is the planned limit, not a measured one.

## 10. How it is built and checked

- Opus 5.5 builds each step; Fable 5.2 reviews it; every step has a test that fails without it.
- A full run on a compute Spark before every install (about 12 minutes), and on GitHub on every push.
- Before an install that changes what the brain reads (the hash differs from the installed build's), the brain eval
  runs on the build about to go in and its result is stored for that build. If it has not run (for example no
  compute Spark is on to run it), the install button says so, and after that install Sparkie asks before every
  change until the eval has passed (from milestone 5, when the brain check is built). An install that leaves the
  hash unchanged needs no new eval.
- After every install, the self-test on real hardware.
- The contract and the map change in the same step as the code; a checker fails when they drift.

## 11. The files beside this page

`owner-decisions.md` (the 22 decisions in the owner's words), `ledger.md` (how the designs join), `a-workspace.md`,
`b-learning.md`, `c-github-selfchange.md`, `d-fleet-workloads.md`, `e-unattended.md`, `f-structure.md`,
`g-memory.md`, `critic-simplicity.md`, `critic-safety.md`.

**Rule numbers (2026-11-13, late).** The smart-plug work already uses R41 for its plug and power rule. The next phase's new rules therefore take R42 (Sparkie's reach), R43 (learning), R44 (documents and parts) and R45 (memory), one higher than the designs say.
