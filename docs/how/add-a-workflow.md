# Add a workflow

A workflow is a tested, versioned change in code: it runs only when the lock names this build and its version, and
its first real run on the Sparks validates it. From the map's "Where new things go", row "A workflow".

## Touch

- A `WORKFLOWS` entry (`18-workflows.mjs`) whose `code()` lists every function it runs.
- `workflowFor` (`18-workflows.mjs`): which action call it is.

## Also update

- `validateChanged` (`18-workflows.mjs`).
- The id lists in `test/workflows.test.mjs` (“every workflow, with its version”) and `test/validate.test.mjs`.
- The ids typed in `maybeHeal` (`18-workflows.mjs`), `bringBack` (`20-heal.mjs`), the bring-back route
  (`handler` in `24-handler.mjs`, `/desired/bring-back`) and the page (`workflowsFold` in `public/app.js`).
- A page button goes through `pageWorkflow` (`18-workflows.mjs`).
- A lock run (`node test/lock.mjs`: a new id is untested until then), then a validation run on the real Sparks.

## Never

- Hand-edit the lock (`service/workflows.lock.json`) or `validations.json`.

## Rules

- R18: a workflow runs only tested; a tested but unvalidated version runs as its validation run.
- R15: done means verified (a start answers a test prompt; a stop is confirmed by Docker).
- R29: the lock is for this exact tree; editing `worker.py` changes every workflow version.

## Tests

- `workflows.test.mjs`, `validate.test.mjs`; `change.test.mjs` for the action behind it.

## Copy from

- `stop_model`'s entry in `WORKFLOWS` (`18-workflows.mjs`), the smallest one.
