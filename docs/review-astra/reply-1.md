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

**Added in Astra's final text, and true (read; Astra ran the functions):** "Do not remember that Spark 4 is on Wi-Fi
only". The parser gets it right (`negated: ['remember']`), but `memoryClear`'s `remember` path ends with "asked, or
not a question", so a refusal the parser recognised is overridden by the owner's-statement fallback and the line is
saved. The fix: when this message's intent has `remember` negated or mixed, `remember` is a button and nothing is
saved. "Don't forget that …" is a request to remember, and still saves at once; a test holds both.

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

## Astra's own test run

### T-1. One clean-up failure in the Mac run (995 of 996): accepted, as a fault in the test harness

**What it was.** Not an assertion: `ENOTEMPTY` from `rmSync` in the stand-in fleet's `stop()` (`test/start-mock.mjs`),
reached from a `finally`. The same file passed 6 of 6 alone, as Astra records. On Linux the suite has passed whole on
every gate run of this build (996 of 996, then 1,029 of 1,029 with the documents tests).

**Why it can happen (read).** `stop()` removes the temporary folder as soon as the guard process has exited, or right
after a last-resort SIGKILL without waiting. The guard removes the same folder itself just before it exits, its
children's exit handlers append to a file in it, and anything that outlives the guard for a moment can still write
there. `force` does not cover `ENOTEMPTY`. Astra's reading of the code is right, including the missing wait.

**Astra's second point is also right:** a clean-up error thrown from `finally` replaces the body's own error, so the
log cannot prove no assertion failed first.

**What changes,** in `stop()` only: it waits for the guard after the last-resort kill, removes with retries, and
never throws for a leftover temporary folder (one plain line on stderr instead). So clean-up can neither fail a test
nor hide a failed assertion. No test's assertions change, and nothing under `service/` changes.

### T-2. A second harness fault, found in our own run (not in Astra's report)

The whole-suite run of `main` on Linux on 2026-11-14 (four files at once) failed one test, again not on an
assertion: the stand-in fleet chose a port, and another test file's fleet took it before the service listened ("Port
41455 is in use: Spark Console is already running"). `startMock` then waited out its 30 seconds, because it watches
the guard process and not the service. The product's refusal to start twice is right and unchanged.

**What changes,** in `startMock` only: an attempt that fails because a port was taken is thrown away whole (stopped,
its temporary folder removed) and a clean one starts with new ports, up to three times; and a service that has
already exited is noticed at once. Any other start failure behaves as before.

## The plan (part 2)

How these were checked: the one page, the owner's decisions, designs A to G, both critics and the ledger were read
whole; the code each finding names was read; the three papers were opened. Nothing was run: the pieces are not built.
Every accepted change is written into the one page first, then the design, with a row in the ledger's new section 5c.

| Id | Answer | Lands in |
|---|---|---|
| P-1 | Accepted | Milestone 2, with the net |
| P-2 | Accepted, with the block scoped to free-form changes | Milestone 2, with the journal |
| P-3 | Accepted in part: open sign-ins and asks are never on disk; a smaller mechanism than "recovery candidates" | Milestone 4, with the rebuild steps |
| P-4 | Accepted, with a rider so it does not bring back asking | Milestone 1 (the hash) and 5 (the grade) |
| P-5 | Accepted: today's button fixes the arguments only | Milestone 2 |
| P-6 | Accepted | Milestone 5, with Sparkie changing its own code |
| P-7 | Accepted; one correction to the correction | Now (words only) |

### P-1. The put-back timer can fire under a command that is still running: accepted

**Right about the plan.** A 2.8 arms a fixed ten-minute timer. Safety finding 2 then put every root command and every
Spark 2 command under it, and A 2.10 lets a command run 120 minutes. Neither safety finding 2 nor 10 changes a
duration or says what happens to a command still running when the timer ends; they made the case easier to reach. On
the hub the limit and the timer were both ten minutes, with the timer armed first, so a command that used its time
was still running when the put-back began. One more gap read in the same place: a "keep it" pressed after the timer
had fired stopped nothing, and nothing said so.

**The change, with nothing new invented.**
- The timer is the command's own time limit plus ten minutes. systemd already ends the unit at its limit, so the
  timer cannot fire under a live command.
- A command inside the net may run 10 minutes on Spark 2 or in the lock-out class, 30 minutes otherwise. Longer work
  is a job. The ask says the time.
- A put-back first stops the command's unit and waits until it is gone, then restores only what differs and reloads
  only what it put back. (That last part is ours: a put-back on a Spark where nothing was wrong should not restart
  Docker under a healthy model.)
- One guard is open on a Spark at a time: the copy script refuses while another guard's `pending` file is there, and
  the Spark's claim is held until the guard is kept or put back. The file is on the Spark, so a console restart cannot
  forget it.
- A "keep it" counts only if the timer was still waiting and its stop worked; otherwise the answer is "already put
  back".

It is Astra's fix in other words: no "transaction" and no new kind of claim; A's `pending` and result files are the
kept state. **Test:** a stand-in systemd with a clock the test moves: the timer is the limit plus 600 s; a command
that rewrites `sshd_config` every second is stopped before the first copy back and the restored bytes stay; a second
root command during an open guard runs nothing; "keep it" after the timer says "already put back"; an expiry where
nothing differs reloads nothing. Then once on a real compute Spark.

### P-2. A change can run with no record on disk: accepted

**Right about the plan.** A 2.11 recorded a command "once, when it ends"; B's journal "never throws"; and the
simplicity review made that one record the only pointer to the copy taken first. So a console killed by the command
it was running, or between the copy and the return, left no record and an orphaned copy; and a full disk let root
commands run unrecorded. Today's code already does the right thing for operations (`newJob` writes a start line
before the work, and a start with no end is reported as cut off at the next start, never replayed); the new `run` and
`write_file` would not have.

**The change.** Before a command or file write changes a Spark, code adds one line to the journal and syncs it: what,
where, as whom, who allowed it, where its copies are. The result is a second line with the same id. If the first line
cannot be written, the change does not run and the owner is told why. After a restart, a start with no end is
reported as cut off, its copies can still be restored, and it is never run again.

**One point made exact.** "Blocks a new mutation" applies to free-form commands that change something, `write_file`,
and anything inside the net. Typed actions keep today's behaviour, so "stop the model on Spark 3" still works when
the hub's disk is full; blocking those would leave the console stuck. `/stop`, `/pause`, `/putback`, `/undo update`
and the way back by hand never wait on the journal. The cost is one append and one sync before a change, and nothing
for a look or an ordinary reply.

**Test:** the journal's append made to fail as a full disk does: a changing `run` answers "couldn't write the record,
nothing was changed" and nothing ran; `/stop`, `/putback`, a look and `stop_model` still work. The console killed
after a file write: the start line is there, one "cut off" notice, `undo_last_change` restores the file, the command
ran once.

### P-3. Putting old state back can let a removed device or passkey in again: accepted in part

**Right for sessions, passkeys, agent keys, people and "always" entries.** `sessions.json`, `passkeys.json` and
`agents.json` are in the state copy; `sessionFor` accepts any stored hash that has not aged out; fourteen dated copies
are kept; `restore.sh --with-state` puts a snapshot's state back the same way. The builders already held this view
for one thing (recovery codes live in the secrets file "so no backup, install snapshot or rollback can bring a used
one back") and did not extend it. Astra is also right that the "copy when a Spark is awake" default makes the newest
copy older, so the window is wider than today's.

**Not right for open sign-ins and open asks.** `deviceCodes`, `challenges` and `pendingChoices` are each a `Map` in
memory, and a go-ahead is in memory only. None is ever in a copy, and all end at a restart. Nothing to reset.

**A smaller mechanism than "recovery candidates the owner selects".**
- Sessions never come back: `sessions.json` leaves the copy and the snapshot's state. Every device signs in again.
- One number, kept in the state folder and in the secrets file (which is never copied, by design). It goes up at
  every removal: a sign-out by the owner, a passkey, an agent key, a person, an "always" entry. At start, a state
  number lower than the secrets file's, or state with an owner and no number in the secrets file (a new disk), means
  the state was put back. It works when the owner untars by hand.
- While that holds: nothing that came back signs in from the internet, "always" entries are off (the trigger safety
  finding 24 lacked), and a task found running is parked (ours; Astra did not ask for it). On the tailnet Tailscale
  still says who the owner is, so nobody is locked out. The sign-in page there shows what came back, with dates; the owner
  removes what they had removed and presses "Keep these".

**Also true of the app as built today.** A restore by hand from an old copy would bring back anything removed since.
It has never been done, and it is a step the owner takes with the steps in front of them, so it is not a fix for
this install; it is on the later list as P-3a, and the owner has been told in plain words: after putting state back,
open Access and remove again what you had removed since that copy.

**Test:** seed a session, two passkeys, an agent key and an "always" entry; copy; remove some; untar by hand; start.
The old cookie gets 401; the removed passkey and key are refused from the internet with the "confirm on your tailnet"
line; the "always" command asks; after "Keep these" the remaining passkey signs in. State put back with nothing
removed since: no hold. No secrets file: hold.

### P-4. A "checked" grade must belong to what the brain reads now: accepted

**Right about the plan.** The grade's key is model, engine, image and flags. The hash of what the brain reads (the
prompt, tool texts, groups) is a separate fact on the install button. No sentence joined them, and sampling is in
neither. So a build that changes three tool texts would truthfully say "not run" on the button and still act unasked
on the old grade. The gates in code are unchanged, so it is not a hole in a wall; but the grade is the one thing that
says "this brain may act unasked".

**The change.** Checked means: an eval on record for this exact model, engine, image and flags, on what this build's
brain reads, on today's case set. Otherwise every change is a button until it passes. The hash covers the system
prompt as sent, every tool's name, text and inputs, the groups and the cap, and the brain setup's sampling and
limits; not documents.

**Two riders, ours, so the fix does not bring back the asking the owner complained about (decisions 10 and 16).**
The profile keeps the newest five results by hash, so going back a build keeps that build's own grade. And before an
install that changes what the brain reads, the eval runs on the build about to go in and its result is stored for it;
if it has not run, the button says so, and Sparkie then asks before every change until it has. An install that leaves
the hash unchanged needs no new eval.

**Test:** a documents-only change keeps the hash and the grade. A changed tool text, prompt line or sampling value
(same model, engine, image, flags) gives a new hash and a clear change is then a button. A passing result for the new
hash restores it. Going back to a build with a result is checked with no new run. A result for another case set does
not count.

### P-5. The press must run the script text the ask showed: accepted

**Right, and the existing button does not already guarantee it.** A button keeps its arguments (`pendingChoices`),
is used once, and runs as kept, so the command's words cannot change. Nothing ties the press to the bytes of a file
those words name. And the plan's own tools can change that file with no ask while the button waits: a box command,
or a `write_file` under a go-ahead, both steerable by text Sparkie read. A fetched installer is downloaded once to
show and again to run. So this needs no outside attacker.

**The change, still one button.** When the ask is built, code reads each script file the command runs (links
followed, once) and keeps its hash with the button; the text shown is those bytes. At the press the runner opens
each file once, hashes what it opened, and runs that open file, not the path. A different hash: nothing runs and a
new ask shows the new text. An installer from an address is downloaded once, when the ask is built, into a folder
ordinary commands and the box cannot write; the press runs that copy. The limit is said on the button: what a script
itself reads or downloads while it runs is not checked.

**Test:** the file changed after the ask: no run, a new ask. A link pointed elsewhere after the ask: the same. A
server that answers A then B: the press runs A and the server saw one request. The file rewritten after the runner
opened it: what ran is what was shown.

### P-6. Sparkie's own change must install the tree the owner approved: accepted

**Right, and half covered.** For an ordinary update the button already carries one tree and `pull.sh install <tree>`
refuses any other. C 2.5 step 6 was the one sentence that waited for the mark of `main`'s new tree and went on. With
`main` moved, the owner approved four files and got those plus whatever else had landed. Every line came from the
owner's computers and passed the tests, so it is not a break-in; but "the owner approves every update" was met for
the proposal only.

**The change removes a case:** Sparkie's Yes becomes the same button as any update. It carries the one tree that was
tested and reviewed. Yes merges only if the head is still the one shown and `main` is still the commit the run was
made on, then installs that tree; if `main` moved, nothing is merged or installed and the ask is built again. The
file list is every difference from the build installed now, in two parts: Sparkie's change, and anything else already
on `main`. A review counts only if it is of that head. No extra press unless `main` moved.

**Test:** a commit pushed to the stand-in `main` after the ask: no merge, no install, a new ask. `main` not moved:
exactly the tree on the button is installed. An installed build one commit behind: that commit is listed under "also
in this build". A review of an older head does not count.

### P-7. The memory research wording says more than the papers do: accepted

**Right on all three papers** (opened; the numbers asked for twice). In the cited study, one round of search over
raw chunks (77.6) is behind three of the eleven memory systems; only with a second round (81.4) is it ahead of all
of them, and that baseline is word search and vectors together, reranked. The baselines nearest our picker scored
68.2 (word search alone) and 46.2 (the query's two rarest words). LoCoMo is dated, linked events checked by people,
and does test memory; LongMemEval's 9.4% is a model's extracted facts on a vector search, not names on a word match.

**One correction to the correction.** G's "50" is the LoCoMo paper's benchmark count, not the 50 unfiltered chats of
its training experiment. The fair fix is that vendors' later numbers use the public release of ten chats, and G now
says so.

**The change is words only; nothing is added to the first version.** G's opening no longer says plain search "beat
all": it names the retriever, the rounds, the model and the scores, and says "it does not test a picker like ours".
The one page calls word-first look-up "a bet that a fleet's exact names make it enough", says the 0.05 ms was the
picker alone on synthetic lines on a Mac, and names what decides: the twenty questions and a held-out set of
rewordings. Not checked by either side: LongMemEval-V2, Chroma, and the vendors' own figures in G.

## The broader answers

Astra's section "Answers to the review guide's broader questions" was read against the plan point by point.

**Adopted (fourteen), each written where it belongs:**

| # | What | Where |
|---|---|---|
| 1 | A line carrying a name from the owner's words is taken before the 400-candidate cap, with a test | G 3.4, step 2 |
| 2 | A middle log line in neither digest list is found by `recall` after a restart (needs clean-up point 1 first) | G step 5 |
| 3 | Quoted, negated, supposed and past-tense "remember" and "forget", A-3's question, an agent's `replaces` aimed at an owner's line | G steps 1 and 6 |
| 4 | Retired lines (`past`) live in their own file, so going back a build cannot drop them | The one page section 3; G |
| 5 | A wish left out of the block is still picked with its source; a remembered line that holds change words causes no change | G step 2 |
| 6 | Held-out rewordings and logs never seen before; results by case and kind, with rounds and seconds | G step 7 |
| 7 | On a Spark without the helper, `run` and `write_file` do not work: Sparkie uses today's typed actions and gives the owner the one command. This removes the interim look grammar | The one page section 4; A 2.3 |
| 8 | The helper proves its own walls on each Spark before first use and in `self_test` | Milestone 2, the helper's step |
| 9 | What counts as the confirming visit: a fresh sign-in with a passkey that existed before, or a new connection through the changed route, tied to that guard and only after the change is live | The one page's net bullet; A 2.8 |
| 10 | Two eval cases that need tools from three groups; a test that an unoffered `undo_last_change`, `cancel_operation` or `undo_update` still runs | Milestone 1, the tool groups |
| 11 | A setup passed over for failing twice is tried again when its image, its Sparks or its start code changed, or when the owner says so | B3 |
| 12 | "Up to 45 minutes" becomes "45 minutes plus the saved brain's own start; the planned limit, not a measured one" | The one page section 9 |
| 13 | Generated files in Sparkie's proposal must equal what the installed build's own generator makes from the proposal's sources | C step 8 |
| 14 | An ask is void after a restart and after Telegram is paired again; the "read outside text" mark survives a restart; a made-up key is searched for in error fields, the state copy and after a restart | Test rows in A and B |

**Already in the plan (eleven), no change:** Docker is root and the sockets are hidden; Telegram's caps limit pace,
not harm, and two digits are not a secret; asks are one-use, expire and are built by code; read text never allows a
change; any wrong change fails a brain and is never averaged into a score; "failed twice" counts known failure ids
only; test jobs cannot write and the installed build judges the new one; the three gates for a brain across Sparks,
with the code words answering with no brain; every rail is a check in `runAction`, and `run` and `recall` are always
offered; task authority; no embeddings, helpers, new scheduler or second service until measured.

## Design clean-up: all four accepted

1. **Output caps.** A and B capped kept output at 1 MB and 64 KB; the one page says the journal is the raw record and
   G says a long log is kept whole. The designs now say: a record's long text is kept whole, written to the `.out`
   file in pieces as it arrives and never held whole in memory; each piece is masked before it is written, with an
   overlap so a key across two pieces is still caught; past 16 MB (a default) reading stops, the command is ended,
   and the record says so. The digest's size is a separate number.
2. **The journal in E.** E copied and restored journal segments; the one page says the journal never leaves Spark 2.
   E now says so, and says what it costs: after a dead hub disk `recall` starts empty, and a line's "you said" source
   may point at a record that is gone.
3. **G's page-only wording and `memoryClear`.** `remember` and forgetting work from the page and the paired Telegram
   chat, marked as said on Telegram; `erase` stays on the page. G 3.6 carries A-3's rule.
4. **The guide's description of the page.** This one is the guide against the app, not a design against the one
   page. The guide now says: "The owner uses chat and the APIs. The page still shows Home, Models, Files and Access
   from earlier builds, and they still work." And the plan now names when they go: milestone 4 gains the delete
   already agreed (members and sharing, the browser editor, the file browser with its routes and the worker's delete,
   rename and new-folder calls), and the Models view goes with it. That closes A-10, A-11 and A-12 and removes A-6's
   only caller.

## The "no trash" default: kept, with one sentence added

**Not accepted as a change of default.** The default is about Sparkie's own deletes in the next phase, and those
already keep a copy first (A 2.6: a bounded place to get a small file back from, kept 7 days). A-6's path is the
page's delete through the worker, which the next phase does not use and the milestone-4 delete removes. A trash would
add its own keep rules, a count against the shared folder, a way to get things back, and "permanently deletes" would
stop being true.

**Accepted: the copy must be of what was removed.** Copy-then-command has A-6's shape with a wider gap. A 2.6 now
lists, under what cannot be put back, "what another program wrote to a file between the copy and the command"; and a
typed remove, if one is ever added, moves the file into the set (a rename on the same disk) so the kept copy is
exactly what was removed. The owner has been told this limit in plain words.
