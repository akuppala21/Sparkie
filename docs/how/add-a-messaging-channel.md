# Add a messaging channel

A way for the owner to talk to Sparkie from another app, like Telegram.

## Touch

- An adapter like `21-telegram.mjs`: a fixed host behind an ALL_LOCAL switch, a loop started in the listen callback,
  the owner's words through `sparkieTurn` with `channel`, presses through `runChoice` with its own `via`, every send
  through `tell()` (`20-tell.mjs`).
- Its door takes a key out before anything reads the words, as `tgKeys` does (`20-keys.mjs`): `keysGiven`, delete the
  message there if it can, then `giveKey` in the owner's chat of that channel.
- The owner's yes from it: an owner-only ask goes out through `tgAsk` and its press comes back through
  `tgApproving` (`20-tg-approve.mjs`), with the switch, the caps and `/lock`; `runChoice` takes it as the owner's yes
  only after `tgAskOpen`.

Completion results use `tellAgain` (20-tell.mjs), including job ends, saved-run and self-test recovery, install
results and carry-on replies. Keep each caller's return value and page updates; `tellAgain` returns `sent`, `later`
or `never`, while `tellCarry` returns a boolean. The existing retry checks its first-send pairing before each later
try; disconnecting or pairing again drops it. It makes at most four tries, waiting 1, 2 and 4 minutes. Its timers
are in memory: a restart loses remaining tries. This is no exactly-once promise; a lost answer or partial multipart
send can repeat a message. Task reports keep their own retry record in the chat; do not also call `tellAgain` for them.

## Also update

- R32; R51 (keys given once).
- `PAGE_ONLY` (`16-actions.mjs`).
- `sparkie_setup` and `fleetNotes` for its state.
- A mock in `test/mock` started by `startMock` (`test/start-mock.mjs`).
- The diagram in `docs/architecture.md`.

## Never

- A route the internet can call.
- A new `via` for its tool calls (the intent gate keys on `sparkie`).
- A second sender.
- A second way for a channel's press to count as the owner's yes, or one for a `PAGE_ONLY` action.
- Its token anywhere but the secrets file.
- The owner's words to `sparkieTurn` before the key door has seen them.

## Rules

- R32: Telegram. R34: the owner's words answered by code. R25: the intent gate.

## Tests

- `telegram.test.mjs`, `tasks-telegram.test.mjs`, `needs-me.test.mjs`, `words.test.mjs`, `app-keys.test.mjs`, `tg-approve.test.mjs`.

## Copy from

- `21-telegram.mjs` (`tgLoop`, `tgUpdate`, `tgTurn`) and `tell` in `20-tell.mjs`.
