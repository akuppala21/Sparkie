# Add a read-only check on the Sparks

A look at a Spark that changes nothing: a probe script, its parsed output, shared with the other readers. From the
map's "Where new things go", row "A read-only check".

## Touch

- A probe script run with `run`, parsed with `fields` (`02-ssh.mjs`); the pattern to follow is `gpuUsersScript`, run
  and parsed in `plan` (`05-library.mjs`).
- Shared through `recent` (`16-actions.mjs`), a short-lived read cache.
- A loop copies the watcher's start: `watchFleet` in `19-watcher.mjs` (a delayed first round, then `setInterval`),
  and goes on its part's `Timers:` line (R28).

## Also update

- A stub in `test/mock/bin`.
- The interval switch in `test/start-mock.mjs`.

## Never

- Open your own ssh.
- Change anything on a Spark.

## Rules

- R10: every command on a Spark goes through `spawnOn`; `run` never rejects, so test `code`.
- R24: sensing only reads; loops start on delayed timers, one round at a time.
- R21: a look Docker didn't answer is not a look.

## Tests

- `fleet.test.mjs` (“the watcher”), `docker-down.test.mjs`, `dark.test.mjs`.

## Copy from

- `readingsScript` and `watchScript` in `19-watcher.mjs`.
