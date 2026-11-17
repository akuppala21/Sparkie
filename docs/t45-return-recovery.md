# Finishing a failed model start’s put-back

T45: if a Spark stops answering during a model start, the attempt fails. Independent earlier work on a healthy
Spark returns first. Earlier work on the other Spark returns when it answers, including after Spark Console restarts.
An earlier model across two Sparks returns as a whole pair. Spark Console says when a Spark may need a power cycle.

## Before anything changes

`rollbackPrepare` in `service/src/17-rollback.mjs` expands the fresh stop list to complete earlier pairs and claims
all their Sparks. The existing target claims stay held. Its strict `start-rollback` entry in the existing
`saved-runs.json` runs map records the original container IDs and start times, desired entries and their `since`,
planned aside names, whether each original was running, its memory need, the source operation and its chat.
A container that was already stopped is preserved too. Returning it never starts it. If every part of its historical
pair is stopped, only the copy being replaced is recorded; its former peer is not claimed. A fresh look that finds
that copy running instead refuses before any change. Running or unknown pairs still require all their Sparks.

The primary file must pass its full shape check. There is no `.prev` fallback, empty replacement or swallowed save
failure. The file and its containing directory are synced before any remote mutation is issued. Write failure
means that mutation does not run. Saved-workflow entries keep their existing format. Copies and state restores
exclude both `saved-runs.json` and its previous copy, so an old copy cannot revive cleanup authority.

## A missing reply does not mean a command ended

Every model mutation and the two-Spark engine check gets a command intent on the hub first. The detached target helper in `service/src/17-rollback-target.mjs` then holds an attempt lock while its actual Docker client runs. The command’s issued marker and final receipt
are written privately, synced and replaced atomically. Ordinary model launches retain `docker run`; their source
operation, attempt and command labels join the exact container ID and start time in the receipt. Receipt observation
and reconciliation use elapsed time, so wall-clock changes cannot shorten or extend their limits. Context approval
expiry still follows the original wall-clock deadline.

Rollback fences every source attempt before restoring anything on that Spark. A late launcher consults that same
persistent fence under that same lock and cannot run. An active client, an issued command with no final proof, or a
failed receipt write keeps restoration held. Container labels or repeated missing-container looks do not settle it.
A verified different boot ends old local clients and daemon requests, but survivors are still listed and stopped by
proved identity. A reboot by itself never means a container stopped. A changed running identity with no exact
receipt stays held for the owner.

A failed create client can still return the full container ID. That is positive proof of a created container only
when Docker inspects that exact ID under the expected name with this operation, attempt and command's labels.
The final receipt keeps the client's nonzero code and failure. Compensation can then stop that proved container.
A missing, short, mixed or mismatched ID is not that proof; a generic client failure stays held.

The final fence includes commands issued by the put-back itself. If a stop or forget arrived while an earlier
container’s restart was unanswered, its exact completed start is stopped again before the obligation can retire.
That debt survives another console restart too. Old issued commands are never replayed.

## Returning earlier work

The same coordinator handles immediate and later rollback. It stops only proved failed-attempt containers, verifies
that they stopped, and checks each original by ID and start time under its normal or recorded aside name. It never
stops unrelated or replacement work. A fresh memory and GPU check must leave 8 GB free; changed conditions hold the
restore. The target checks a job's named shared folder while holding the attempt lock, then checks the original
identity again before starting its exact ID. A link, or a missing guard, never starts the job. Independent originals return separately. A previous pair
waits for both Sparks; a failed second start checked-stops the first part again.

Owner stops and forgets write strict supersession marks, even if the container was already stopped or no desired row
remains. `stopWishes` keeps stops of newly created names even when no original unit exists. A positive owner wish
replaces only its matching stop. An ask before the first create joins that command's strict intent before dispatch;
engine checks never gain adoption. A newer desired generation, changed identity or owner wish supersedes the old restore. A stop on an
old pair’s mate can see and cancel the full claim even if the new placement requested only its other Spark.
Saved-workflow cleanup revokes restoration of its own exact resources, and a successful return transfers their
receipts strictly before releasing claims. An owner adopting a model while its start is loading keeps that exact
wish with the parent workflow's pending receipt before the source recovery record retires. A failed save retains
the source note. The first automatic desired-list seed waits through unfinished recovery: observation is not a new
owner request. Work the run never owned remains untouched.

An owner can run a stopped job again, or adopt one already running, through `keep_running`. This positive wish
supersedes its old recovery intent without putting the job on the desired list. After a successful rerun, or under
a claim for the already-running job, `rollbackRetireSuperseded` may retire the old note only when every original
has a positive supersession, all its target Sparks are claimed, its source operation is inactive, every attempt
fences and a fresh look proves no unsettled survivor. A remaining engine-check container also keeps the note.
Waiting mates, negative stop/forget marks, other targets and unknown receipts stay held. The final strict write
reads the current intent again; no start, stop or container removal happens on this retirement path.

Cleanup checks the current owner wish again after each inventory look and before dispatching a stop or removal.
A newer adoption leaves that work alone, including either half of a pair and an original just restored. Once a
stop or removal is already issued, adoption waits for its final receipt. A settled cleanup that stopped the
container cannot be adopted from an old running look. A successful explicit job rerun can supply its exact new
start receipt under the existing claim; it still cannot override an unfinished stop or removal. The rerun also
checks for any unanswered recovery command on its Spark under its claim before Docker receives the new start.

Startup recovery and the existing healing pass dispatch continuation through the existing `restart_model` action,
using a private in-process token, a tested workflow, claims, a job and `run`. No new public action, timer or service
is added. Pending targets stay out of ordinary healing, even with an empty desired list. The owner’s pause holds
later starts; settling issued commands and stopping this attempt’s own work remains compensation for the earlier
request. Cancelling the failed start does not replay it. Recovery wakes, downloads and deletes no owner files.

An obligation retires only after verified restoration or supersession and settlement of every issued command.
Unknown cases remain visible in open problems and the source operation’s cleanup words. Forty recorded attempts
are the safety bound; reaching it leaves a visible request for the owner to check the Sparks.

Recovery reports name a refused restoration only from its latest terminal, exact-ID start receipt and a stopped
post-check. Unanswered commands or changed identities keep the uncertainty warning. A proven removal excludes
only that exact new container from the warning; it never clears another command's debt.

The model-start observer still gives up after 120 seconds and reports `(timed out)`. Before deciding which Sparks
can restore earlier work, compensation gives a still-active producer at most 90 more seconds to provide its exact
receipt and a free persistent fence. Normal completed receipts add no wait. The engine check also treats the
adapter's nonzero timeout result as failure, never as proof that its test ran.

An uncertain stop can be disposed of only when every old producer on that Spark is inactive and fenced, every
remaining uncertain command is a stop, and each stop targets a full new-container ID proved by an earlier create
receipt with this operation, attempt and command's labels. An original ID, changed identity, missing receipt,
other unresolved action or owner's newer adoption blocks this path. Under the existing claims a fresh attempt
stops and removes those exact IDs; it never addresses a replacement by name. Only a later terminal zero-exit
removal receipt with `seen: null` settles that stop's target. The old stop receipt remains nonterminal, as evidence
of what was never answered. Failed removal and an active producer retain the obligation. The same bounded check
handles a cleanup stop that outlives its observer; no new scheduler, store or authority is added.
A fresh exact-ID look after a stop timeout can report that the same container still runs. It cannot settle the
unanswered receipt or claim a successful stop, even when that look finds no running container.
Cluster cleanup rereads owner wishes after its Docker look and just before dispatch, and leaves a changed ID or
start time alone even if the container carries the earlier attempt’s labels.

## Checks

- `test/t45-late-outcome.test.mjs`: late create timeout, fenced exact-ID disposal, active producers, original IDs,
  changed labels, missing receipts, other unresolved actions, owner adoption and failed stop/removal.

- `test/t45-recovery-words.test.mjs`: exact owed-work text, stable ordering, proved removal and refused-restoration
  details; incomplete, mismatched, newer or nonterminal evidence never becomes a claimed result.

- `test/t45-return.test.mjs`: strict writes/shapes, whole-unit claims, independent and paired return, replacement
  identity, owner supersession, late restoration receipts, saved-workflow receipts, current memory/GPU use and a
  same-name original that was already stopped.
- `test/t45-target.test.mjs`: the actual temporary-target helper with a fake Docker executable; active client,
  persistent late-launch fence, same-boot uncertainty, old-boot nonterminal receipt and a look that writes nothing.
- `test/t45-created-receipt.test.mjs`: the actual target's full returned create ID, exact labels and failure code;
  missing, short, extra, renamed and mismatched evidence stays held.
- `test/t45-job-folder.test.mjs`: the actual target's named-folder guard, a symlink refusal, a real folder and the old
  ID-as-folder mistake as a negative control.
- `test/t45-adopt-job.test.mjs`: positive owner adoption under complete claims; unresolved, negative, live and changed
  recovery state keeps its note, including a failed strict retirement save.
- `test/t45-mock-reference.test.mjs`: full returned Docker IDs and named failure knobs reached through ID references.
- `test/t45-engine-boundary.test.mjs`: a delayed engine-check peer finishes before a sibling failure can begin rollback.
- `test/t45-fleet.test.mjs`: the real stand-in service loses Spark 4 during an across start, restores Spark 3 first,
  then restores Spark 4 without rerunning that model; repeats across a console kill and restart.

These checks use stand-ins. They do not establish an installed build or a successful run on the owner’s Sparks.

Model builders mark the launch boundary before Docker. A completed preflight that never crossed it records a terminal `notIssued` receipt; live or unanswered commands stay unknown. Cache refusals retain only bounded file and model names, never target paths or raw stderr. Startup recovery keeps its proved exact self-test stop with `self-test.json`, so the later notice reports that action.
