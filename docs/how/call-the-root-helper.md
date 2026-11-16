# Call the root helper on a Spark

Anything the console runs on a Spark through Sparkie's free work (a look, a change, root, the net) goes
through the root helper (`deploy/spark-console-root`, R42) and its two callers: `helperCall` in `21-work.mjs`, and
the net's `guardCall` in `21-guard.mjs` (`run --net`, `root --net`, `keep`, `putback`). Design:
`docs/design-2026-11-13/a-workspace.md`, 2.13.

## Touch

- `helperScript` (`21-work.mjs`) builds the one script a call runs, as the owner over ssh (local bash on Spark 2): the
  helper's SHA-256 against `HELPER_SHA256` first (an unknown helper is never called), then any check that must run on
  the Spark, then `sudo -n` of the helper with a fresh id. The brain's command is one word made with `q()`.
- `helperCall` runs it and gives back `{ id, code, out, cut, timedOut }`; it never rejects. It ends the call at its
  seconds and `LOOK_SLACK` more, or past `J_MAX` of output.
- `helperAnswer` reads the answer from the lines that begin with the id (a command can learn it); a look's or run's
  answer is its last line, `<id> end <code>` or `<id> end time`; before it only the helper's fixed sentences, whole,
  are `notes`. Map a new kind of answer there, never by searching the output.
- A change (`runChange`, R61): `--dir`, `--protect` (`helperProtect`), `--memory`, `--stdin` (a write's bytes, keys);
  after a yes only `--open`, `--home`, `--fleet`, `--gpu`, `--asked`. `state --id` (`runnerRunState`): what became of
  a call; `stop --id` (`longStop`) ends it.
- With no helper, not this build's, no sudo line or no current proof, an action answers `needsOwner` and runs nothing:
  the owner's command (`ownerCommand`; Spark 2's: `--hub`) once per Spark and reason while the console runs, then
  one line. While a proof holds its lock: "being proven right now".

## Also update

- `HELPER_SHA256` whenever `deploy/spark-console-root` changes (`work.test.mjs` holds them equal); the owner then runs
  the one-time command again on each Spark, so say so in the update's note.
- A new verb or flag of the helper: its own test in `test/root-helper.test.mjs`, and R42.
- A test of a call: `rehearse` (`test/work.test.mjs`) sets up the real helper under a stand-in Spark's home; the
  fleet's own: `test/rehearsal.mjs` (`run: true` for a change).

## Never

- Call `sudo` any other way, or run the command another way (plain ssh, `run`, no wall) when the helper is missing or
  refuses.
- Put a caller's text anywhere but the one quoted word. (On Spark 2 that word passes the owner's service manager, with
  `--expand-environment=no` so systemd leaves `${…}` alone; the helper's hash check catches any change.)
- Read an answer from anything but the id's lines.
- Call it from a child of the console on Spark 2 without the owner's service manager: `sudo` fails there.
- Mark a look as an inside read (`inside`, R26): its output is the outside world.

## Rules

- R42 and this call. `run` sorts each command (R61): a look's answer that ran begins with `look` (nothing changed or
  sent) and its step's outcome is `look`. Refused first: `sudo` as a command word, a key file (by name, link, `*`, or
  under a folder a walker reads whole), a third look at once. `LOOK_FORMS` run code's own text once `check` says
  ready. Who: the owner; an agent whose key may change things (`mayRun`, `recall` too). Not built: proving by itself,
  a failed proof told beyond the self-test or kept past a restart; the key check reads words, not what a script
  opens; Spark 2's call needs systemd 254.
- R43: a look writes one `cmd` record when it ends; a change (`runChange`) its start line before the call. R61.
- R25 and R26: what a command printed never causes a change.
- R10: commands reach a Spark through `spawnOn`.

## Tests

- `work.test.mjs` (the call, the answers, the key check, Spark 2, the proof in `self_test`).
- `root-helper.test.mjs` (the helper itself); `runner.test.mjs` (a change: copies, run wall, undo).

## Copy from

- `runCommand` in `21-work.mjs` (`run`, a look); `selfTestWalls` there (a verb with no command).
