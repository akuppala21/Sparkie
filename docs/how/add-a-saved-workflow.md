# Add a saved workflow

No code: a saved workflow is the owner's ordered action calls on named Sparks, kept in `saved-workflows.json`.

## Touch

- Nothing in code: the owner's `save_workflow` writes `saved-workflows.json` from existing actions
  (`18-workflows.mjs`).
- `checkSteps` looks at every step before step 1 (R35).
- Steps run via `workflow`: uncounted by the breaker, each its own validation run.
- A stack (several apps that work together) is one of these: `keep_running` steps, one per piece with all its
  settings, and a second workflow that stops them (A13).
- A `keep_running` step that runs a job waits for the job's end before the next step (`jobStepEnd`,
  `18-step-jobs.mjs`); a job that ends badly ends the run and names the step (R35). A run that ends badly, or a run
  with a job that ends well, stops what its own steps started, except a step saved with `keep: true` (R35).
- A `keep_running` step may leave out its Spark: `pickSpark` places it when the run reaches it, waking one if it must.
- “Save that as X” is `save_workflow {title, from: "this request"}`: the request's changes, from the journal (R35).
- The owner's yes to a save covers the images its listed steps start (`approved`); a changed step asks again (R35, D6c).
- A Telegram history save keeps `from` on its request-only confirmation. Either owner channel can answer it, but
  saving history that lists no steps grants no image approval. Do not expand away that provenance in the intent check.
- `compare_models` runs one with each candidate model (a `model` input) and keeps the winner as `best` (R57).

## Also update

- `NOT_A_STEP` (`18-workflows.mjs`) when a new action must not be a step.
- From Sparkie's chat it is saved at once only under R25's step check; otherwise the owner presses a button that lists
  the steps (F20).

## Never

- Let a routine save routines or write memory.
- Run steps as trusted.
- Remove a completed run’s record only by unlink: first persist the primary without that entry, preserving other
  active runs. A failed retirement write must not fall through to unlink or claim restart safety (R57).

## Rules

- R35: a saved workflow is checked before step 1.
- R25: Sparkie's `save_workflow` runs at once only when every step traces to the owner's words.
- R26: outside text never reaches a saved workflow without a button that lists its steps.

## Tests

- `steps.test.mjs`; `change.test.mjs` (“saved workflows”); `sparkie-more.test.mjs` (“save_workflow from chat”).

## Copy from

- The steps in `change.test.mjs` (“saved from steps of existing actions”).
