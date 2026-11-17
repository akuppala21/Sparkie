# Add a state file

A JSON file the console keeps in its state folder (`~/.local/state/spark-console` on the hub).

## Touch

- `writePrivate` and `readKept` (`03-identity.mjs`) in `STATE_DIR` (R20).

## Also update

- `docs/state.md`: a row for the new fact. (A fact kept anywhere but the state folder, or only in memory, has its
  row in `docs/state-outside.md` instead.)
- The state copy's exclude list (`sendCopy`, `25-backup-and-start.mjs`), if no copy may carry it. An install snapshot
  takes every file but `*.sock` and `*.tmp` (`save` in `deploy/host-on-portal.sh`); one that must not come back with
  `restore.sh --with-state` joins the `rm -f` lines of `restore.sh`, written in that script.
- `COPY_IGNORES` (`20-state-copy.mjs`), if Spark Console rewrites it by itself as it watches or logs: a change to it
  alone then sends no copy to a Spark that is awake (it still rides in the next one).
- Its part's header: `Owns: <file> (writers: …)`, naming every function that writes it, wherever it is (R22, R28).
  `node tools/make.mjs` lists it in `docs/registry.md` and fails on a writer the header doesn't name.
- `WORDS` or `SIGNIN` in `deploy/spark-console-root` (then `HELPER_SHA256`, `docs/how/call-the-root-helper.md`), if it
  holds what the owner or Sparkie said, or sign-in material: a look or a change on the hub reads every other file in
  the folder (`test/root-helper.test.mjs`, “a look and a change on the hub”).

## Never

- Put a secret in it: everything in the folder is copied into every install snapshot (but `*.sock` and `*.tmp`)
  and to another Spark (but `*.sock` and the few files `sendCopy` names). A secret goes in `~/.config/spark-console/secrets.json` through `secretsWrite`
  (`03-secrets.mjs`): typed on the passkey page (R32), or given once in the owner's chat as `/key NAME …` (R51).
- Keep an owner's setting in `config.json` (replaced on every install).
- Put an `await` between reading and writing it.

## Rules

- R20: `writePrivate` to write, `readKept` to read-then-rewrite, no `await` between; one process.
- R22: one writer each, or the few the header declares.
- R7: nothing in it holds a key.

## Tests

- `state.test.mjs` (“unreadable state files”, “a state file that isn't JSON”).

## Copy from

- `heal-tries.json`: `HEAL_FILE` and `saveHealTries` (`18-workflows.mjs`).
