# The next phase of Spark Console, in one page

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
filter; a key is never shown back; every command and result is recorded; one word stops everything.

## 3. The shape after the cut

The designs asked for about 67 steps, 30 new actions and 18 state files. The simplicity review cut that to what the
goal needs; this page follows it, adjusted for decisions 20 to 22 and the safety review.

- **New actions (8):** `run`, `write_file`, `recall`, `self_test`, `install_update` (with `check_update`),
  `compare_models`, `change_sparks`, `brain_across` (last). Existing ones widen: `remember`, `forget_memory`, `memory`,
  `save_workflow`, `undo_last_change`, `sparkie_setup`.
- **New state (5):** the journal (a folder), `lessons.json`, `brain-profiles.json`, `sparks.json`, the repo copy.
  `memory.json` gains `past`; `agent-settings.json` holds the always list; the secrets file holds named keys.
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

- **Root, asked once.** The owner runs one command per Spark, once. It allows one small root-owned helper (not
  `sudo` for everything, so other scripts on the Spark do not become silent root). Nothing is stored. The helper also
  gives three walls: *look* (the whole disk read-only, no network, keys hidden: so any command may be a look), *run*
  (an ordinary command with the Docker and Tailscale sockets, the secrets and the sign-in files hidden) and *net*.
- **The net: confirm, or it goes back.** Armed for every root command and every command on Spark 2. Copy first; a
  timer in the Spark's own systemd, armed before the change, that survives a restart; apply; make it live; test the
  ways in from outside the Spark. No difference and a fresh connection works: disarmed at once, nobody asked. A
  lock-out change on a compute Spark that passes is kept by code. On the hub, and for any sign-in change, only a fresh
  visit through the changed way in keeps it; a Telegram "keep it" does not count there. `/putback` on Telegram
  always restores the last set, by code, with no brain.
- **Put-back.** A file is copied before it is changed; `undo_last_change` restores it. A change that cannot be put
  back says so on its button.
- **Telegram as the place to say yes.** A risky ask is answered only by its button, never a typed "ok". From
  Telegram: 3 risky approvals an hour and 10 a day. `/lock` turns Telegram approvals off; only the page turns them
  on. Every approval is echoed on the page. Changing who may approve (passkeys, recovery codes, Telegram's pairing)
  is confirmed on the page. A four-digit code once a day for the dangerous presses exists as a switch, off by default.
- **Dangerous asks are hard to tap by reflex** (root, lock-out, installing its own code, a final delete, the brain):
  their own message, led by facts code built ("ROOT on Spark 2", "You did not ask for this", which parts came from a
  page or a log), and two digits to type. Ordinary work gets none of this.
- **Keys, given once.** Code takes a key out of the owner's message before the brain, the chat file or the journal
  sees it, keeps it by name in the secrets file, deletes the Telegram message, and injects it by name when used.

## 5. Memory (design G): keep everything, believe little, show less

- The journal is the raw record of everything said, called, run and seen. It is never rewritten.
- What Sparkie believes is the owner's own words: dated, sourced lines about named things, with no ceiling. A newer
  line retires an older one; history is kept; "forget" retires, "erase" is a separate button.
- Code picks what a turn sees in well under a millisecond: exact names first, then rare shared words, then newest.
  No model call, no file read.
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
| 1 | **Ground** | Tonight's build installed. The suite passing on Linux; full runs on a compute Spark (`tools/test-on-spark.sh`, about 12 minutes) and on GitHub (C1 to C3: one job, the mark pushed by a job that runs no repo code). F1 to F6 and a 15-row glossary; tool groups with the cap (F10), measured at 41 and at 24. D1. D2 with a healing drill. The "what the brain reads" mark on the install button | "Run the self-test." |
| 2 | **Commander** | B1 (the journal). The root helper and its one-time command. `run` as a look on any Spark; then changes with the copy first, the go-ahead and "always allow"; the net; Telegram approvals with the caps and `/lock`; keys given once. `NEVER_CHANGES` in the prompt and the old refusal tests are replaced by tests of the net | "Find out why the job on Spark 4 died, clean up what it left, and always allow that." |
| 3 | **Memory** | G1 to G7 on B's journal; B2 to B4 as cut (lessons hold failures; a setup that failed twice is passed over) | "What do you know about starting GLM across two Sparks, and what went wrong last time?" |
| 4 | **No laptop, lighter hub** | C4, C5 (pull install; the installed build judges the new one; it goes back unless the real door answers). E1 heartbeat. E2 copy when a Spark is awake, and the rebuild steps. E10 clearing Spark 2. Ways-in health on the needs-you list | "Is there a newer tested build? Install it." (from the phone) |
| 5 | **On its own, with any brain** | B9. One brain check with two outcomes (checked, or every change a button until the eval passes). Tasks: today's carry-on made durable, with hours and turns. The report with counts. The box as `on: "box"`. The coding trial with Sparkie as a contestant; C8 (Sparkie changing its own code) only if it passes | "On your own tonight: download X to Spark 3, start it, run my script, stop everything, and report." |
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
    after an independent review (16).
13. Every rail is a check inside `runAction`, not a tool left off the list (17).

## 8. Defaults taken where the designs asked (decision 16)

| Question | Default |
|---|---|
| A code for dangerous presses on Telegram | Off. A tap, with two digits shown on the ask. A once-a-day code is a switch |
| A kept key going to a new image or host | Asked once per new place, then remembered |
| Keys after a dead Spark 2 disk | Given again; no copy elsewhere |
| Waking one compute Spark to knock on the hub's door after a hub lock-out change | Yes, for a few minutes |
| A trash for deletes | No. The copy first covers small files; a final delete is asked |
| Sparkie changing GitHub's workflow files | Asked, as a dangerous change |
| An update that goes back unless the real door answers | Yes, checked by code through the real address; the owner need not open the page |
| The journal | Never copied off Spark 2, never erased, with "hide this value everywhere" for a secret |
| The owner's real requests as test cases | Later, after two full eval runs |
| Stopping an idle model so its Spark can power off | Never by itself; the smart-plug work decides with the owner |
| A new Spark holding copies of chats and sign-in files | Only after the owner says so |
| A line stated on Telegram kept in memory | Yes for `remember`; `erase` stays on the page |
| GitHub Pro for branch protection | No |
| The brain resting when idle | Only if a by-hand measurement shows 10 W saved; a pause is tried before a stop |
| The contract | Made flat with one status table, rules reworded in place, old text to `docs/history/` |

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
9. A brain across three Sparks leaves none free, and a failed try can mean up to 45 minutes without Sparkie.

## 10. How it is built and checked

- Opus 5.5 builds each step; Fable 5.2 reviews it; every step has a test that fails without it.
- A full run on a compute Spark before every install (about 12 minutes), and on GitHub on every push.
- After every install, the self-test on real hardware.
- The contract and the map change in the same step as the code; a checker fails when they drift.

## 11. The files beside this page

`owner-decisions.md` (the 22 decisions in the owner's words), `ledger.md` (how the designs join), `a-workspace.md`,
`b-learning.md`, `c-github-selfchange.md`, `d-fleet-workloads.md`, `e-unattended.md`, `f-structure.md`,
`g-memory.md`, `critic-simplicity.md`, `critic-safety.md`.
