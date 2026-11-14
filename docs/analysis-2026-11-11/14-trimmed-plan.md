# The trimmed plan (owner's choice, 2026-11-11)

The final review (`13-final-handoff-report.md`) proposed 9 batches. The owner chose a trimmed plan: what they would use day
to day, what stops real breakage, and the everyday additions they would use. Sparkie patching its own code waits until a
cheap trial shows Qwen can write passing patches. The owner's 11 decisions (section 11 of the report) all stand.

Exact build specs come from the xhigh second pass (Fable 5.2, one agent per item, against the code as it is now); items
it finds already fixed or wrong are dropped. Builders: Opus 5.5 at xhigh, one batch at a time, each change with a test
that fails without it, each batch's diff reviewed by Fable 5.2 at xhigh, then the full gate, then the owner's yes.

## Build now

**Chat never gets stuck, and the brain comes back**
- F2: a throw or a full disk can leave a chat "still answering" for good; memory read errors kill the turn.
- F3 + H2: `/restart sparkie` also starts a stopped brain (a missing one through the brain-start job); a failed switch
  says what is true; a brain the console itself left down comes back alone (same setup, twice in 6 hours).
- F8: "do X, then Y" stalls; a reply that fails after its tools ran is lost.
- F7: a carry-on turn from an internet sign-in skips the passkey for undo.
- F13: Telegram's loop ends on one bad secrets read.
- F25 + H3: the owner's own failed work pauses agents; route errors and crashes leave no record Sparkie can read.
- A1: `/pause`, `/restart sparkie`, `/stop` on Telegram (never resume or undo there); `/stop` on the page.

**Updates can't leave the console dead**
- F4 + H1: the installer checks the new build (settle, ways in, one chat turn) and goes back by itself on a miss;
  `restore.sh` always starts the unit; undo skips the running build; `/undo update` as a word on the signed-in page.
- S5: one update record ("now build X, was Y"), last five in `sparkie_setup`.

**Fleet truth and the start bugs**
- F6: Docker not answering reads as "every container removed" and can stop a healthy part.
- F16: a powered-off Spark's containers read as running.
- F12: writers save over `desired.json` and `validations.json` after a failed read.
- F9: a one-Spark start over a running copy removes the working container.
- F10: a routine run twice restarts a model already running.
- F11: a pair start's yes can start a one-Spark model.
- S1, S2: state files survive a power cut (fsync, a previous copy); `access.json` keeps a last-good copy.

**Needs-me, backups, sign-in**
- H4 + A2 + H5: one open-problems list (at most 8 lines) for "Anything need me?", `/status` and Sparkie's notes; one
  "needs me" Telegram line, at most 3 a day, switched on by the owner.
- F17: the daily copy retries, never silently fails, checks the archive, and records the last good one.
- F18: the recovery-code button shows even when no passkey is on file.
- A3, A5: "What can you do?" from the live action list; "Who is signed in, how many recovery codes are left?"
- From the API review (`11-api-first-review.json`): an owner-only question from a direct call hands back no dead choice
  ids and says where to say yes.

**Everyday additions**
- A12: "Keep Open WebUI on Spark 3 running and give me its link" (any app or service, Spark 3 or 4 only).
- A8: files on a Spark: list, read, save one small text file in the workspace folder.
- A9: "Start nvidia/<new model> with its best setup": a model started by name joins Recipes with its setups.
- A7: "What is GLM running with?": `running_models {detail}`.

**Owner steps:** linger on Spark 2 and one reboot drill. **Done 2026-11-11 22:35 PST:** linger on; after `sudo reboot` the console answered in 111 s and the brain in 153 s, by themselves; the internet address, 3 Sparks online and GLM on Spark 3 all as before. One small fix found: right after boot `/health` said `internet: false` until Tailscale answered; it should say not known until then.

## Wait until proven

- Sparkie patching itself (Linux gate F1/F5, `console_code`, `run_tests`, `update_console`, `change_console`, the
  sandbox on Spark 3/4): first run the trial (three small coding tasks on the Agent setup, 2 of 3 each). If Qwen
  misses, Sparkie still operates, heals and installs builds the owner approves.
- Node on Spark 2 (`deploy/install-node.sh`, approved): needed for the Linux gate and before deleting the editor.
- D12 (delete members, sharing, editor, old brain setups): after Node is on Spark 2.

## Skipped for now

H6 tool-call probe on a brain swap, H7 log caps, H8 failure rows, H9 stuck line, H10 weekly self-test, S3, S4, S6-S12,
F19 and page polish, A4, A6, A10, A11, F14, F15, F21, F22, F24, D9-D11 runbooks and handoff docs. They stay in the report
for later.

## Build order (from the xhigh spec pass, `17-build-specs.json`, 2026-11-12)

All 27 "build now" items were checked against the code as it stood: every one still true (F16 partly fixed: only its
test and the view half are built). Two small items the planner added are kept: F20 (a routine saved from chat is a
button listing its steps unless the owner's own words named each step; a key typed in chat is hidden in the saved
chat) and H1's by-hand files (`go-back.sh`, `RECOVERY.txt`). The specs' default choices stand (a by-hand Docker line
in the "Docker isn't answering" notice that the console never runs; the "stopped carrying on" line also on Telegram
for a request made there; "who is signed in" also in the paired Telegram chat, never an address; a step naming one
Spark doesn't count a two-Spark model as running there; with no passkey on file a recovery code signs in, but the
first passkey is still set up on the tailnet).

One builder at a time (Opus 5.5, xhigh), each group's diff reviewed by Fable 5.2 at xhigh:
1. Everyday additions: A7, A8, A12 (built 2026-11-12, build a7e3a138603d; workflow versions unchanged). A9 moved to
   group 5: its edits sit inside the start_model, start_model_across and find_setups code, so it needs new workflow
   versions and a live run like F9-F11. Its tested patch is applied first in group 5
   (`patches/a9-model-card-and-join.patch`, notes in `patches/a9-notes.txt`; with it alone: start_model f74f1b24bb47, start_model_across
   355ef3e564e3, find_setups f807e08bdd5d).
2. Installs: F4, H1, S5.
3. Chat: F2, F8, F7, F3 + H2, H3, F25, A1, F13. F3 replaces the words test that said `/restart sparkie` never starts a
   stopped brain (the owner chose that it does, 2026-11-11).
4. Fleet: F6, F16, F12, S1, S2, F17, H4, A2, H5.
5. Start and page: A9 (the patch, first), F9, F10, F11, F18, A3, A5, F20. Its install needs Spark 3 or 4 on and the owner's yes to one live
   start-check-stop of a small model (both start workflows get new versions).
Then the full gate on the Mac, and the owner's yes before each install. Held for later (owner's go-ahead): the Linux
gate (F1, F5, F23), S3, S4, S6-S12, H6-H9, F19, F22, F24, A4.
