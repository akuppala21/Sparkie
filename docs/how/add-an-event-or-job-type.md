# Add an event type or a job type

An event is a line in the fleet's record (`fleetEvent`); a job type is a kind of operation (`newJob`). From the
map's "Where new things go", row "An event type or a job type".

## Touch

- A `fleetEvent` type (`19-watcher.mjs`); a `newJob` type (`07-jobs.mjs`).

## Also update

- `EVENT_TYPES` (`16-actions.mjs`) for an event type; `docs/rules/R13.md` names a job type and says whether it takes a
  claim. `node tools/make.mjs` fails on a type sent or started that isn't there, and `docs/registry.md` lists who
  sends or starts each.
- `describeEvent` (`19-watcher.mjs`); the last 10 events go to Sparkie with every owner message (`fleetNotes`).
- The page's `SVC_LABEL` (`public/app.js`); `OP_WORDS` (`14-chats.mjs`); `TELL_OPS` (`20-tell.mjs`); `CHANGES_MODELS`
  (`20-desired.mjs`); `startingNow` (`17-changes.mjs`). A job type that holds no claim and changes no model itself,
  only through steps that are jobs of their own (`self-test`, `workflow-run`), stays out of `CHANGES_MODELS`,
  `startingNow` and the busy checks below.
- The by-type busy checks: `handler` in `24-handler.mjs` (`/deploy`, `/deploy/cluster`) and `checkSparkAction` in
  `12-status.mjs`.
- Nothing for the journal (R43): each event and each operation's end and log go in by themselves (`journalEvent`,
  `journalOp`). A new kind of journal record: `JOURNAL_KINDS` (`20-journal.mjs`, also `recall`'s list), one call of
  `journal` where it happens, outside every function a workflow's `code()` lists (a line inside one changes its
  version), and `jView` if `recall` should show a new field. Give it long text as something iterable, never whole.
- A job type's Sparks go on the job as `node` (and `nodes`, for more than one) when `newJob` makes it: its end line's
  energy (`wh`, `20-op-energy.mjs`) is for those Sparks; with neither it says “it ran on no Spark” (R43).

## Never

- Frequent events (healing reads a 500-event window).

## Rules

- R23: event types and `knowledge.workloads` fields keep their meaning; events stay rare.
- R13: one change per Spark; a new job type says whether it takes a claim.
- R7: event text is masked.

## Tests

- `state.test.mjs` (“the fleet's record of operations”), `fleet.test.mjs` (“the watcher”).
- `docs.test.mjs` (“an event type EVENT_TYPES doesn’t list”, “an operation type R13 doesn’t name”).

## Copy from

- The `notice` an app's ending job posts once: `jobEnded` (`21-apps.mjs`).
