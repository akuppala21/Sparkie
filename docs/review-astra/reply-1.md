# Reply to round 1

Date: 2026-11-14. From the builders: Fable 5.2 checks each finding against the code and writes this; Opus 5.5 builds
what is accepted. This answers `findings-1.md` under [the agreed procedure](README.md).

**Status: part 1 of 2.** This part answers A-1 to A-12. The fixes it describes are being built now on the branches
`astra-chat` and `astra-fleet`; they are not on `main` yet. Each lands with a test that fails without it, then the
whole suite runs on Linux, and a table of commits and tests is added at the end of this file. Part 2 answers P-1 to
P-7 and the design clean-up list, in this same file. Nothing here is closed: [`open.md`](open.md) has one row per id.

How each finding was checked: a checker read the code paths named, then reproduced the fault with its own scripts on
the repository's stand-in fleet (the real service, a scripted model) or on the function's own text. Astra's evidence
was read as a report; its scripts were not run. Where we ran something, it says "ran". Where we only read, "read".

| Id | Answer | When |
|---|---|---|
| A-1 | Accepted in part: changes inside a reply under way, after removal and after a downgrade. Buttons and carry-on turns are not live for the agent | Fix now |
| A-2 | Accepted in part: the missing re-check is real; the path as told (a model start inside the gap) does not fit | Fix now (three lines); the restart path later |
| A-3 | Accepted, and wider than reported | Fix now |
| A-4 | Accepted | Fix now |
| A-5 | Accepted, with two more places found | Fix now |
| A-6 | Accepted in part: the race is real; "blocks install" is not | Later, with the next `worker.py` change |
| A-7 | Accepted; the byte-count limit is not taken | Fix now |
| A-8 | Accepted in part: the cause is real; "don't mark before telling" is not taken | Fix now (one line) |
| A-9 | Accepted; the macOS run does not carry over, and the stronger harm is the pruning | Fix now |
| A-10 | Accepted | Later (page) |
| A-11 | Accepted | Later (page) |
| A-12 | Accepted, and reachable one more way | Later (page) |
| "No trash" default | Not accepted as a change of default; one sentence accepted for design A 2.6 | With part 2 |
| P-1 to P-7, design clean-up | Being checked. The four clean-up points are confirmed as real disagreements between the one page and the designs | Part 2 |

## The app as built

### A-1. Removing an agent leaves changes in its reply allowed: accepted in part

**True for changes inside a reply already under way.** `askSparkie` reads the key's rights once; `sparkieTurn` keeps
them for the whole reply as a yes or no; `runAction` checks only that copy and never reads the keys again. Astra ran
the removal. We ran the half Astra read but did not run: "can change things" switched off while the model's first
answer was pending, and `stop_model` still ran 12 seconds later and stopped the stand-in container.

**Not true for buttons and carry-on turns.** After removal the door refuses the key on every request (`mcpDoor` →
`agentFor`), so the agent can't press anything. After a downgrade `askSparkie` reads the rights again for a press and
`runChoice` → `runAction` refuses and uses the button up. Carry-on turns don't exist for agents (`keepTask` sets
`conv.task` only when there is no agent). So "pending approval/continuation paths" is not accepted.

**What changes.** The turn's context carries the agent's id. `runAction`, at the existing `canChange` check and for
changes only, reads the key as it is now: gone, or may only look, is a 403 with a plain sentence, and nothing runs. It
fails closed when the keys file can't be read. The owner's own turns read nothing extra.

**Already-running operations: the policy, written down.** They keep running and post their result. Removing an agent
cancels nothing, the same rule as `/stop` (R34), because cancelling a start half-way stops models and puts others
back, which is the bigger surprise. This includes the remaining steps of a saved workflow the agent started; the owner
cancels it in Activity. The sentence is now in R9 and beside the route.

**Rating: medium, fix now.** One reply, at most four changes, each asked for in the agent's own words while it was
allowed; `/pause` already stops an agent's very next change mid-reply. But it is the moment an owner removes an agent
to stop it, and a healthy model can be stopped after the owner said no.

**Later (A-1b):** the removed agent still receives the answer of the request that was open (looked-up data, up to
40 seconds). Not on the bar.

### A-3. A question about memory can make Sparkie forget: accepted, and wider than reported

**True.** In `memoryClear` the forget line is `asked || about >= 0.3` and returns before the question test, which only
`remember` reaches. And `asked` does not mean "asked to forget": `forget_memory` and `remember` share one kind, whose
words include "remember", "note that" and "don't forget". With `asked` true the topic test is skipped altogether.

**Ran.** With the model scripted to call `forget_memory` on "Spark 4 is on Wi-Fi only", each of these deleted the line
with no button: Astra's question; "Is Spark 4 on Wi-Fi only?"; "Don't forget that Spark 4 is on Wi-Fi only."; "Never
forget that …"; a quoted "forget that …" from the owner's notes; and "Remember that I like short answers.", which has
nothing to do with the line. "How hot is Spark 3?" gave a button. "forget that Spark 4 is on Wi-Fi" forgot it at once,
as it should.

**What changes,** in `memoryClear` only. Forgetting runs at once only when all three hold; anything else is the
existing button:

1. the line exists;
2. this message says to forget, in a sentence that is not a question, not after don't, do not or never, not after if,
   whether or should, and not inside quotes;
3. the line is what they are talking about (`about >= 0.3`), never skipped, even when the owner did say forget.

A bare "forget it" is not a forget (it means never mind). A plain statement still corrects through
`remember {replaces}`, unchanged.

**On the plan:** G 3.6 said `memoryClear`'s test stays unchanged; it now carries this rule, and G's "an agent never
replaces an owner's line" also says "or forgets one". G's "forgetting retires the line" makes a wrong forget
recoverable; it does not replace this gate.

**Rating: medium, fix now.** It loses the owner's data without a word, on the mistake the gate exists to catch.

**Known and unchanged (not new):** an agent that may change things can call `forget_memory` over the agent door with
no owner's-words gate. That is R26's "Today" note; G closes it.

### A-4. A model error cut off part-way leaves the chat stuck: accepted

**True, as reported.** `modelStep`'s branch for an answer other than 200 listens only for `data` and `end`. Node gives
a cut-off response an `error` only when something listens for it; otherwise it closes and `end` never comes, and the
request's own `error` doesn't fire because the response had begun. Nothing settles, so the turn's cleanup never runs.

**Ran, and it is worse than one chat.** Four chats each given a cut-off 503: `/health` said `replying: 4` and
`ok: true`; each chat answered 409; `/stop` answered "Stopped" and freed nothing; deleting the chat was refused; a
fifth chat anywhere, Telegram included, got 429. Because `/health` stays ok the watchdog never restarts the service,
so the only cure was a restart by hand over SSH. A cut-off 200 is already handled (that branch listens for `error`).

**What changes.** One `settle` in `modelStep` that every way of ending uses and that runs once; `error` and `close`
on the response in both branches; `/stop` now settles the step itself, whatever state the connection is in.

**Rating: fix now.** The trigger is rare (the model process dying between an error's headers and its body), but it
leaves the console stuck, and the owner's word for exactly this says it worked when it did not.

### A-5. A key in an error's text is saved in the chat file: accepted, with two neighbours

**True.** `sparkieTurn`'s catch masks the answer but saves `error: why` as it came. Ran: a 500 whose body held a fake
key put it in `chats.json` in clear. The audit, the events file, the log and an agent's copy of the same failure were
clean.

**Two more places, found while checking every spot an error's text is kept:**

- **Button labels (ran).** The "Remember: …" label is built from the model's argument unmasked and saved with the
  message. A scripted `remember` holding a fake key reached `chats.json` that way. `run_workflow`'s label shows input
  values unmasked too. This one is more likely in real use than the reported one: the owner types a key and the brain
  offers to remember the sentence.
- **Operation errors (read).** `runJob`'s `operation` event and the two `heal-skipped` lines write error text to the
  events file unmasked, while the chat's copy of the same text is masked.

**What changes.** The catch masks before saving and before the event. `changeLabel` masks the `remember` text and
`run_workflow`'s values (not every label: `keep_running`'s must read as typed, and a test holds that). The operation
event and the two healing lines mask, then cut. `runAction`'s catch masks before its 200-character cut, so a key
across the cut can't leave a piece. R7's "Today" note for operation errors closes.

**Rating: fix now, low likelihood.** A key at rest in a file that is copied off Spark 2 every day.

### A-2. A stopped GPU app starts on checks made before its claim: accepted in part

**The missing re-check is real (read, not run).** In `keep_running`'s "there but stopped" branch the GPU-alone check
and the memory check run before the claim, and nothing is looked at again inside it. Its two sibling branches (a new
app, a job run again) do both again inside the claim. Nothing downstream would refuse.

**The path as told does not fit.** A model start holds its claim from before `docker run` until the model has
answered a test prompt (`deploy`: a first look after 5 seconds, the load, then `answers`). While it holds, the app
start is refused with 409. To slip through, a whole model start would have to begin and finish inside the second or
two between the app's look and its claim; a load takes half a minute at the least. Astra's harness completes a start
inside a stubbed memory read, which shows the order of the code, not that real timing allows it. What can fit is a GPU
job, whose claim ends right after `docker run`: two GPU starts on one Spark in the same second from separate callers.
Sparkie runs changes one after another, and healing skips a claimed Spark. So: not "high", and not a blocker.

**What changes anyway.** The same two re-checks the siblings run, inside the claim, before `docker start` (and before
the `try`, so a refusal doesn't run the put-back for a container that was never started). The checks before the claim
stay: they give the caller the plain refusal. It is three lines, no workflow version changes, and the harm if it ever
happened (two GPU workloads on one Spark's shared memory) is on the bar.

**Not taken now (A-2b, later):** `restartChecked`/`restartJob` have the same shape and the same low odds. They are in
`restart_model`'s code list, so a fix is a new workflow version with its own validation run on the Sparks; it goes
with the next change to that workflow. Re-checking identity and protection inside the claim is not taken: neither
sibling does it, and a swap needs a hand `docker rm` and `run` in that same second.

### A-7. A character split across two pieces of a request body is spoiled: accepted

**True, as reported.** `readBody` adds each piece to a string by itself. Ran: a 42-byte body split at each of its 41
places gave wrong text at 10 of them; over real HTTP, two writes split inside `€` were read as `���10` and the route
answered normally. It needs no race, only a body in more than one piece with a non-ASCII character on the join: a
saved file or a long paste, an agent's long call, an app's prompt on `/v1`.

**What changes.** A streaming decoder in `readBody`, nothing else. Ran: 0 of 41 splits wrong, with the limits, the
drain-then-413 behaviour and the byte-order-mark refusal all as before.

**Not taken: counting the limit in bytes.** Today it counts characters. Changing it would refuse bodies accepted today
(multi-byte text between the limit and three times it) and is not needed to stop the damage; memory stays bounded
either way.

**Later (A-7b):** the same `+=` on raw pieces in three places that are much less likely to split a character:
`modelStep` (the brain's stream), `run` in `02-ssh.mjs` (command output), `servedModel`.

**Rating: medium, fix now.** Quiet damage to the owner's text, reported as success.

### A-8. The first short job on a Spark the watcher has only seen empty is never told: accepted in part

**True, for exactly that case.** `sawContainers` is set only by a look that lists a container, so on a Spark that has
only ever been seen empty the next look still counts as the first, and a job seen already ended is marked told and
never told. Ran with the real `watchSpark` and scripted looks. It is kept in `knowledge.json`, so it applies once per
Spark that has never shown a container; Sparks 2, 3 and 4 are past it. The same `first` also hides the created,
started and crashed events (and a crash restart) for the first container on such a Spark.

**What changes.** `sawContainers` is set on every look Docker answered, and that first look counts as a change so the
mark is saved. A look Docker did not answer already returns earlier, so an empty list here means "no containers", not
"couldn't read".

**Not taken: "don't mark it told before the notice succeeds".** Marking first is what keeps "once" true (R23): if the
notice failed after its event was written, a retry would repeat it every round.

**Rating: low; taken now.** "Blocks install" is not supported: one missing line, once, on a Spark never used before,
and nothing is lost. It is taken now because adding Sparks is the next phase, and the first container on a new Spark
is where it bites.

### A-9. A failed backup sender can replace a good copy: accepted

**True: the order is as reported.** The far side checks the stream, moves it under the day's name and prunes, all in
one command that cannot know how `tar` ended on this side. Ran: a sender that wrote a whole valid archive missing one
file and ended 2 made `sendCopy` return false, yet the day's file was replaced and the oldest of 14 was removed.

**Two corrections to the evidence.** The macOS run (tar ends 1, accepted) does not carry over: the service runs only
on Linux, where GNU tar ends 2 for a file it cannot read, and the code already refuses 2. So on the Sparks an archive
missing a file is never counted good; the fault is only that it is moved into place and pruned before being refused.
And the stronger harm is not the same-day overwrite (which needs the record of today's success to be lost, as Astra
says) but the slow one: a disk that starts giving read errors is exactly when tar ends 2, and each failing day then
adds a refused archive and drops the oldest good one, while the notice still names a good copy. After 14 such days no
accepted copy is left.

**What changes.** Two steps. The stream stops at the checked `.part`. Once both exit codes are known, a second command
either moves it into place and keeps the newest 14, or removes it. A copy counts only when that second step answered.

**Rating: medium, fix now.** It needs a fault first, but the daily copy is the only thing between a failing disk on
Spark 2 and losing people, passkeys, agent keys and chats.

### A-6. A file delete can remove a save that lands at the same moment: accepted in part, later

**The interleaving is real (ran).** After the worker has hashed the file, nothing looks at its bytes again; a write
into the same file between that and the unlink is deleted with it.

**One part of the story is not how the page works.** The owner never holds a revision R: `remove` asks first, then
reads the file again and sends that fresh revision. So the check covers everything from that read to the unlink, the
passkey step included, and the unguarded stretch is its last 40 to 150 millionths of a second (measured with a
byte-identical copy of the worker; 99 in 100 under 0.6 ms). Only the page can delete: Sparkie and agents have no
delete (R37). What can write without the lock is an editor or a shell on that very file in that instant.

**Why later, not a blocker.** The owner asked for that file to go; the window is far below what a person can hit; no
key, model or sign-in is involved. And the fix has a real price: `worker.py` is part of every workflow's version
(R29), so any edit to it is a new gate and every workflow validated again on the Sparks.

**The fix, when `worker.py` next changes:** rename first to a reserved name beside it, read that file again, and
unlink only if inode, size, change time and hash still match; otherwise put it back under its name and answer the
conflict. Ran on a copy: every save by name is either refused with the bytes back at the name or lands as a new file
that stays. One case remains under any design but a trash: a program that already has the file open and writes after
the last check. So the closing test needs one word changed: "remain or are recoverable" can hold only for a writer
that opens the file by name.

**Accepted as written:** when the file browser is removed (D12), `delete`, `rename` and `mkdir` leave `FILE_OPS` and
the worker too, not only the page.

### A-10. A pair's plan that arrives late replaces the plan of the Spark picked since: accepted, later

**True, as reported (ran in `node:vm` with the page's own code).** `pick` returns for a cached single Spark before
`++token`, so a pair's answer still on its way takes over the plan while the radio stays on the single Spark.

**The impact limit is correct, and we ran it:** with the real `unapprovedStops`, the service made Spark 4's own plan
again and stopped only what was a ticked row on screen naming Spark 4; nothing on Spark 3. What can go wrong is a
start that fails and is put back, or a refusal with a misleading line, or a start on one Spark under text that said
both.

**Later.** Nothing unseen stops, nothing is lost. The fix is the one line moved plus a check at submit that the plan
is for the choice.

### A-11. A listing still on its way shows under the next Spark: accepted, later

**True, as reported (ran).** `filesBrowser` does not reset `busy` or `epoch` on a Spark change, so the new Spark is
never asked and the old list shows under it on the next redraw.

**No action goes to the wrong Spark.** Each request names the panel's own Spark, the one in the heading and in the
dialog; ran from the wrong list: a file only on Spark 3 was "not found" on Spark 4, a folder's revision was refused.
A wrong delete needs the same name on both Sparks and two confirmations that both name Spark 4.

**Later.** One line (`busy: false`, `epoch + 1` when the Spark differs). "An explicit entry context for every
operation" is not needed: operations already use the panel's own Spark. It goes away with the file browser in D12.

### A-12. A batch of uploads follows the area switch: accepted, later, and reachable one more way

**True, as reported (ran).** `fileApi` reads the area at each call, so the second file of a batch follows the switch.

**Astra missed one path.** The area buttons also show in the owner's own "Preview as a member", and uploads there are
real: a file meant for the owner's own folder lands in the shared one, which Sparkie's `files`, read-only agent keys,
jobs and members can read. Whether any member can write both areas is in `access.json` on Spark 2, not in the
repository.

**Later.** Three lines in `uploadFiles` (keep the area with the folder for the whole batch). It needs a multi-file
upload and an area switch inside one file's upload. D12 removes the file browser.

**On testing A-10 to A-12:** the suite never runs `public/app.js` today. The honest test is a new `test/page.test.mjs`
that runs the real functions in `node:vm` with drawing stood in (about 100 lines, no dependency). It is written with
the first of these three fixes.
