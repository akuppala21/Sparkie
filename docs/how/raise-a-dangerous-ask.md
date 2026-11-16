# Raise a dangerous ask

Before root, a lock-out change, a delete that cannot be put back, the brain or an install of Spark Console, a change
asks the owner with `dangerAsk` (`20-danger.mjs`) instead of `question`. Ordinary work never does.

## Touch

- The action's own code, at the point where it would ask: `return dangerAsk(viewer, ctx, { kinds, where, facts,
  shown, call })`, and return what it gives back, as is.
- `kinds`: some of `root`, `lockout`, `delete`, `brain`, `install`, named by code (the sorter, the action), never from
  the brain's input. `where`: the Spark's id. `call`: `{action, args}`, exactly what the yes runs.
- `shown`: the bytes the press runs. `{command}`; `{path, before, after}` for a file (the lines that change; a path
  that one line would change, with a line break, a tab, two spaces together or over 400 characters, is refused);
  `{script}` for a script's text. None for an install.
- `facts`, each optional and typed: `asked` (the gate's own answer, when the raiser knows it better), `backAt` (the
  net's time, when the owner confirms), `net` (code's own line for the net on a compute Spark, kept by its check
  from outside: 21-net.mjs), `lockWhy` (the sorter's why), `kept` (files copied first), `gone` (`{what, bytes}`:
  cannot be put back), `waysIn` (paths), `install` (`{tree, testedAt, differs, brainReads}`; `differs` null when what
  differs isn't known), `outsideWall` (why), `whoApproves` (it changes passkeys, recovery codes, the pairing or the
  switch: page only), `switchBrain`, `wall`, `recheck` (a function giving the script's bytes again at the press).
- `ctx.reads`: what this request read, newest first (`{id, label, at}`: a journal id and a label built by code).

## Also update

- R54 when what an ask shows or who may answer it changes.
- `test/danger.test.mjs`: a test that raises it the way the action does.

## Never

- Text from the brain, a page, a log or a tool result in `facts` or a label: only typed facts and code's words.
- The digits anywhere but the ask: not in a result, a label, the journal or a log.
- A second way to answer it, or "don't ask again" and "always allow" for it.

## Rules

- R54: the dangerous ask. R32: Telegram, its switch and its caps. R6: the passkey on the page.

## Tests

- `danger.test.mjs`, `tg-approve.test.mjs`.

## Copy from

- `dangerForTest` (`20-danger.mjs`): how the stand-in hook calls it with a question's yes call.
