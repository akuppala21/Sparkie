# Add a messaging channel

A way for the owner to talk to Sparkie from another app, like Telegram. From the map's "Where new things go", row "A
messaging channel".

## Touch

- An adapter like `21-telegram.mjs`: a fixed host behind an ALL_LOCAL switch, a loop started in the listen callback,
  the owner's words through `sparkieTurn` with `channel`, presses through `runChoice` with its own `via`, every send
  through `tell()` (`20-tell.mjs`).
- Its door takes a key out before anything reads the words, as `tgKeys` does (`20-keys.mjs`): `keysGiven`, delete the
  message there if it can, then `giveKey` in the owner's chat of that channel.

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
- Its token anywhere but the secrets file.
- The owner's words to `sparkieTurn` before the key door has seen them.

## Rules

- R32: Telegram. R34: the owner's words answered by code. R25: the intent gate.

## Tests

- `telegram.test.mjs`, `needs-me.test.mjs`, `words.test.mjs`, `app-keys.test.mjs`.

## Copy from

- `21-telegram.mjs` (`tgLoop`, `tgUpdate`, `tgTurn`) and `tell` in `20-tell.mjs`.
