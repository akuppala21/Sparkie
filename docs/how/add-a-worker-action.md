# Add a worker.py action

`service/worker.py` runs on each Spark for status and file work.

## Touch

- The allowed table in `main` (`service/worker.py`).
- A stub in `test/mock/worker.py`.

## Also update

- A new lock run: any `worker.py` edit changes every workflow version but not the build (R29).

## Never

- Add one when a probe script through `run` would do.

## Rules

- R29: the lock is for this exact tree; a `worker.py`-only edit installs with every workflow untested.
- R37: `files` and `save_file` reach only a Spark's shared folder, through the worker. (`run` and `write_file` reach
  other files through the root helper: R61, R68.)

## Tests

- `files.test.mjs`, `fleet.test.mjs` (“what the Sparks report”).

## Copy from

- The `workspace-files` entry in `main` (`service/worker.py`), called through `workerCall` (`12-status.mjs`).
