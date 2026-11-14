# Add a new way in

A new caller: something that reaches the console's actions or Sparkie from somewhere new. From the map's "Where new
things go", row "A new way in".

## Touch

- A call to `runAction` with its own `via`; words go through `sparkieTurn`.
- A credential in `viewerFor` (`03-identity.mjs`) or beside `keyViewer` (`20-mcp.mjs`, called from `handler` in
  `24-handler.mjs`).
- A listener in `openSockets` (`25-backup-and-start.mjs`).

## Also update

- Every place `via` is compared. Find them with `grep -n "via ===\|via !==" service/src/*.mjs`; today they are in
  `runAction`, `planOf` and `abilities` (`16-actions.mjs`), `runJob` (`07-jobs.mjs`), `pausedCheck`, `question`,
  `redeemChoice`, `launch`, `acrossGate`, `startModel` and `restartJob` (`17-changes.mjs`), `runChoice`
  (`14-chats.mjs`), `checkSteps` and `undoUpdate` (`18-workflows.mjs`), `memoryPrompt` (`20-memory.mjs`), and the
  page's `whoKey` (`public/app.js`).
- `carriesCredential`; `SECRET_PATTERNS`; `routes_ok` (`deploy/open-to-internet.sh`).

## Never

- Set `ctx.trusted` or via `page` from a request.
- Override a Tailscale login.
- Add a second address or listener for people (the owner chose one address, 2026-11-11; the one exception is the app
  door, the owner's decision of 2026-11-12: a second listener on the same name, for kept apps only, R40).

## Rules

- R5: transport and sender are judged before identity.
- R11: new callers run actions only through `runAction`. R12: only server code sets `ctx.trusted`.
- R9: the pause and the failure count treat a new `via` as an agent unless it is handled.
- R4: a route sits below the handler checks it needs.

## Tests

- `internet.test.mjs`, `fleet.test.mjs` (“requests from the Sparks themselves”), `pause.test.mjs`, `door.test.mjs`
  (“auth”).

## Copy from

- Telegram: `21-telegram.mjs` (`tgTurn`), a turn with its own channel; presses through `runChoice` with `via`
  `telegram`.
