# Add a messaging channel

A way for the owner to talk to Sparkie from another app, like Telegram.

## Touch

- An adapter like `21-telegram.mjs`: a fixed host behind an ALL_LOCAL switch, a loop started in the listen callback,
  the owner's words through `sparkieTurn` with `channel`, presses through `runChoice` with its own `via`, every send
  through `tell()` (`20-tell.mjs`).
- Its door takes a key out before anything reads the words, as `tgKeys` does (`20-keys.mjs`): `keysGiven`, delete the
  message there if it can, then `giveKey` in the owner's chat of that channel. Capture its authenticated owner and chat
  before waiting for deletion; recheck that owner before saving and bind the reply to that request. A save already
  started may finish; a replacement pairing receives none of its result.
- The owner's yes from it: an owner-only ask goes out through `tgAsk` and its press comes back through
  `tgApproving` (`20-tg-approve.mjs`), with current pairing proof, complete delivery and `/lock`; `runChoice` takes it as the owner's yes
  only after `tgAskOpen`.
- Plain choices retain the full server question in `pendingChoices`. Send that question and complete labels through
  `tellReplyText`, including pressed follow-ups and choices beyond the page’s eight-ask display limit. A50 closes the
  gap where a model summary and shortened button hid the facts. Mask every part before activation; retries keep the
  same exact question and call. Owner-only and dangerous asks retain their separate sender.

An app start’s reply uses the same operation wording as a pressed action. Keep that reply from the shared turn.

Completion results use `tellAgain` (20-tell.mjs), including job ends, saved-run and self-test recovery, install
results and carry-on replies. Keep each caller's return value and page updates; `tellAgain` returns `sent`, `later`
or `never`, while `tellCarry` returns a boolean. The existing retry checks its first-send pairing before each later
try; disconnecting or pairing again drops it. It makes at most four tries, waiting 1, 2 and 4 minutes. Its timers
are in memory: a restart loses remaining tries. This is no exactly-once promise; a lost answer or partial multipart
send can repeat a message. Task reports keep their own retry record in the chat; do not also call `tellAgain` for them.

## Also update

- R32; R51 (keys given once).
- The shared owner predicates in `16-actions.mjs`; never derive owner authority from a channel string.
- `sparkie_setup` and `fleetNotes` for its state.
- A mock in `test/mock` started by `startMock` (`test/start-mock.mjs`).
- The diagram in `docs/architecture.md`.

## Never

- A route the internet can call.
- A new `via` for its tool calls (the intent gate keys on `sparkie`).
- A second sender.
- A second way for a channel's press to count as the owner's yes. Use the existing pending choice and confirmation path.
- Its token anywhere but the secrets file.
- The owner's words to `sparkieTurn` before the key door has seen them.

## Rules

- R32: Telegram. R34: the owner's words answered by code. R25: the intent gate.

## Tests

- `telegram.test.mjs`, `tasks-telegram.test.mjs`, `needs-me.test.mjs`, `words.test.mjs`, `app-keys.test.mjs`, `tg-approve.test.mjs`.

## Copy from

- `21-telegram.mjs` (`tgLoop`, `tgUpdate`, `tgTurn`) and `tell` in `20-tell.mjs`.
