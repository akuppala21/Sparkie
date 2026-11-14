# Add a state file

A JSON file the console keeps in its state folder (`~/.local/state/spark-console` on Spark 2). From the map's "Where
new things go", row "A state file".

## Touch

- `writePrivate` and `readKept` (`03-identity.mjs`) in `STATE_DIR` (R20).

## Also update

- `docs/state.md`: a row for the new fact.
- The daily copy's exclude list (`sendCopy`, `25-backup-and-start.mjs`) and the install snapshot (`on_exit` and its
  `save` in `deploy/host-on-portal.sh`), if it must be left out.
- Its one writer (R22), named in the rule if it is one of the listed files.

## Never

- Put a secret in it: everything in the folder except `*.sock` is copied daily to another Spark and into every
  install snapshot. A secret goes in `~/.config/spark-console/secrets.json` through `secretsWrite`
  (`03-secrets.mjs`), typed only on the passkey page (R32).
- Keep an owner's setting in `config.json` (replaced on every install).
- Put an `await` between reading and writing it.

## Rules

- R20: `writePrivate` to write, `readKept` to read-then-rewrite, no `await` between; one process.
- R22: one writer each.
- R7: nothing in it holds a key.

## Tests

- `state.test.mjs` (“unreadable state files”, “a state file that isn't JSON”).

## Copy from

- `heal-tries.json`: `HEAL_FILE` and `saveHealTries` (`18-workflows.mjs`).
