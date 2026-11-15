# Use the journal

The journal (`20-journal.mjs`, R43) is Spark Console's record of what was said, called, run and seen. To find what
happened (also before a restart), `recall`: with words or an operation id, then with a record's id for its whole text.
To write to it: add a record where something new happens, or make a change wait for its start line.

## Touch

- One call of `journal` (kind, fields, long text) where the thing happens, outside every function a workflow's `code()`
  lists: in a hook it already calls (`note`) or in its caller (`runJob`). A line added inside a listed function
  changes that workflow's version.
- A new kind: `JOURNAL_KINDS` (`20-journal.mjs`), which is also `recall`'s `kind` list.
- A change written down first (P-2): `journalFirstFor`. `runAction` then writes its start line and syncs it before the
  change runs, refuses the change with `JOURNAL_REFUSED` when the line can't be written, and ends it with a second
  line of the same id. Code outside `runAction` (the command runner, when it comes) calls `journal` with
  `{ start: true }`, runs nothing when it gives back null, and ends with `{ id, end: true }` and the output as the text.

## Also update

- `jView` (`20-journal.mjs`) when `recall` should show a new field.
- R43's Today when a kind or a change written down first is added; the journal's row in `docs/state.md`.

## Never

- Mask before handing it over, or cut a key in half first: `journal` masks fields with `maskDeep` and long text with
  `jMasker`, piece by piece with an overlap. Give it the raw text.
- Hold a long output whole to write it: pass something iterable that gives it in pieces.
- Delete, rewrite or copy the journal (the daily copy, a snapshot, another Spark).
- Make stop, pause, cancel or put-back wait on it; put journal text in the prompt (the brain reads it only through
  `recall`, as outside text).

## Rules

- R43: the journal. R7: masked before it is kept. R26: outside text. R18: workflow versions.

## Tests

- `journal.test.mjs` (“with the journal's disk full”, “a console killed between a start line and its end”);
  `test/mock/disk-full.mjs` makes the journal's writes fail as a full disk does.

## Copy from

- `journalOp` (`20-journal.mjs`), called last in `runJob`'s `finally` (`07-jobs.mjs`).
