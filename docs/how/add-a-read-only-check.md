# Add a read-only check on the Sparks

A look at a Spark that changes nothing: a probe script, its parsed output, shared with the other readers.

## Touch

- A probe script run with `run`, parsed with `fields` (`02-ssh.mjs`); the pattern to follow is `gpuUsersScript`, run
  and parsed in `plan` (`05-library.mjs`).
- Shared through `recent` (`16-actions.mjs`), a short-lived read cache.
- A loop copies the watcher's start: `watchFleet` in `19-watcher.mjs` (a delayed first round, then `setInterval`),
  and goes on its part's `Timers:` line (R28).
- A look at a way in on Spark 2 itself (Tailscale, linger, Funnel) needs no loop: it rides on `checkRoute` or
  `refreshBlocked` (`23-http.mjs`), keeps what it read in `20-ways-in.mjs`, and `waysInNeeds` puts it on the needs-you
  list, with "couldn't check" for an answer it can't read (R49).

## Also update

- A stub in `test/mock/bin` that keeps its calls (`tailscale` and `loginctl` do), so a test can see they are reads.
- The interval switch in `test/start-mock.mjs`.

## Never

- Open your own ssh.
- Change anything on a Spark, or name a bare Tailscale command that drops a route as the fix in a needs-you line.

## Rules

- R10: every command on a Spark goes through `spawnOn`; `run` never rejects, so test `code`.
- R24: sensing only reads; loops start on delayed timers, one round at a time.
- R21: a look Docker didn't answer is not a look.
- R49: the ways in, watched ahead.

## Tests

- `fleet.test.mjs` (“the watcher”), `docker-down.test.mjs`, `dark.test.mjs`, `ways-in.test.mjs`.

## Copy from

- `readingsScript` and `watchScript` in `19-watcher.mjs`.
