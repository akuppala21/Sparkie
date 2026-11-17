# Raise a dangerous ask

Before root, a lock-out change, a delete that cannot be put back, the brain or an install of Spark Console, a change
asks the owner with `dangerAsk` (`20-danger.mjs`) instead of `question`. Ordinary work never does.

## Touch

- The action's own code, at the point where it would ask: `return dangerAsk(viewer, ctx, { kinds, where, facts,
  shown, call })`, and return what it gives back, as is.
- The yes comes back to the same action as a press: run only when `ctx.button`, `ctx.ownerConfirmed` and `ctx.danger`
  are all set (`runChoice` sets `ctx.danger` once `dangerPress` took the press and its two digits), as `rootChange`
  and `netChange` do. A change action that asks this way says `asks: 'danger'` in its `action({...})`, as
  `install_update` does, so Sparkie's call gets no plain button first (`runAction`).
- `kinds`: some of `root`, `lockout`, `delete`, `brain`, `install`, named by code (the sorter, the action), never from
  the brain's input. `where`: the Spark's id. `call`: `{action, args}`, exactly what the yes runs.
- `shown`: the bytes the press runs. `{command}`; `{path, before, after}` for a file (the lines that change; a path
  that one line would change, with a line break, a tab, two spaces together or over 400 characters, is refused);
  `{script}` for a script's text. None for an install.
- `facts`, each optional and typed: `asked` (the gate's own answer, when the raiser knows it better), `backAt` (the
  net's time), `net` (code's own line for the net on a compute Spark, kept by its check from outside: 21-net.mjs),
  `lockWhy` (the sorter's why), `kept` (files copied first), `gone` (`{what, bytes}`: cannot be put back), `waysIn`
  (paths), `install` (`{tree, testedAt, differs, brainReads, proposal}`; `differs` null when what differs isn't known),
  `outsideWall` (why), `hub` (on the hub: where it starts, how it runs and what is checked after, `21-hub.mjs`),
  `minutes` (how long a long command may run), `lines` (code's own sentences, one line each: what its wall lets it do,
  what it reaches),
  `whoApproves` (it changes passkeys, recovery codes, the pairing or the switch: exact strong owner confirmation), `switchBrain`, `wall`,
  `recheck` (a function giving the script's bytes again at the press).
- `ctx.reads`: what this request read, oldest first, the newest last (`{id, label, at}`: a journal id and a label
  built by code; `workRead`, `21-ladder.mjs`).

## Also update

- R54 when what an ask shows or who may answer it changes.
- `test/danger.test.mjs`: a test that raises it the way the action does.

## Never

- Text from the brain, a page, a log or a tool result in `facts` or a label: only typed facts and code's words.
- The digits anywhere but the ask: not in a result, a label, the journal or a log.
- A second way to answer it, or "don't ask again" and "always allow" for it.

## Rules

- R54: the dangerous ask. R32: Telegram, its pairing, complete delivery and switch. R6: the passkey on the page.

## Tests

- `danger.test.mjs`, `tg-approve.test.mjs`.

## Copy from

- `dangerForTest` (`20-danger.mjs`): how the stand-in hook calls it with a question's yes call.
