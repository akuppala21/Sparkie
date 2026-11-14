# Add an event type or a job type

An event is a line in the fleet's record (`fleetEvent`); a job type is a kind of operation (`newJob`). From the
map's "Where new things go", row "An event type or a job type".

## Touch

- A `fleetEvent` type (`19-watcher.mjs`); a `newJob` type (`07-jobs.mjs`).

## Also update

- `EVENT_TYPES` (`16-actions.mjs`).
- `describeEvent` (`19-watcher.mjs`); the last 10 events go to Sparkie with every owner message (`fleetNotes`).
- The page's `SVC_LABEL` (`public/app.js`); `OP_WORDS` (`14-chats.mjs`); `CHANGES_MODELS` (`20-desired.mjs`);
  `startingNow` (`17-changes.mjs`).
- The by-type busy checks: `handler` in `24-handler.mjs` (`/deploy`, `/deploy/cluster`) and `checkSparkAction` in
  `12-status.mjs`.

## Never

- Frequent events (healing reads a 500-event window).

## Rules

- R23: event types and `knowledge.workloads` fields keep their meaning; events stay rare.
- R13: one change per Spark; a new job type says whether it takes a claim.
- R7: event text is masked.

## Tests

- `state.test.mjs` (“the fleet's record of operations”), `fleet.test.mjs` (“the watcher”).

## Copy from

- The `notice` an app's ending job posts once: `jobEnded` (`21-apps.mjs`).
