# Add a known start failure and its fix

A model start that fails in a way seen before gets a fix and a retry, by code.

## Touch

- `START_FAILURES` (`17-changes.mjs`); first match wins.

## Also update

- Where fixes apply: `withoutRejected`, `fixFlags`, `clusterEnv`.
- A test in `workflows.test.mjs`.
- Both start workflows change version (a lock run, then a validation run).
- Its `id` and `title` are among the words the brain reads (`BRAIN_WORDS`, `21-guide.mjs`), so the tested mark changes:
  the brain eval before the install (`docs/how/run-the-brain-eval.md`, R52).

## Never

- Drop a flag the console sets.
- Pass 3 attempts or 30 minutes.

## Rules

- R16: failure puts back exactly what the start stopped; fixes retry 3 times at most.
- R18: the start workflows' `code()` lists every function they run.

## Tests

- `workflows.test.mjs` (“done means it answers, and known problems are fixed”).

## Copy from

- The out-of-memory entry in `START_FAILURES` and its test, `workflows.test.mjs` (“out of memory with a long
  context”).
