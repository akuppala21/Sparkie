# Add a new way in

A new caller: something that reaches the console's actions or Sparkie from somewhere new.

## Touch

- A call to `runAction` with its own `via`; words go through `sparkieTurn`.
- A credential in `viewerFor` (`03-identity.mjs`) or beside `keyViewer` (`20-mcp.mjs`, called from `handler` in
  `24-handler.mjs`).
- A listener in `openSockets` (`25-backup-and-start.mjs`).

## Also update

- Every place `via` is compared. Find them with
  `grep -nE "via (===|!==)|includes\((ctx\.|job\.)?via\)" service/src/*.mjs`; today they are in:
  - `16-actions.mjs` (`runAction`, `planOf`, `hourCounts`), `16-reads.mjs` (`sparkie_setup`), `07-jobs.mjs` (`runJob`)
  - `17-changes.mjs` (`noStopWords`, `pausedCheck`, `question`, `redeemChoice`, `acrossGate`, `startModel`,
    `stop_model`); `14-chats.mjs` (`runChoice`, `pressLate`)
  - `18-workflows.mjs` (`startTestChanges`, `undoUpdate`, `undo_update`); `18-saved-from.mjs` (`requestSteps`),
    `18-saved-yes.mjs` (`savedImagesYes`, `stepImagesYes`), `18-step-jobs.mjs` (`savedStepAgent`)
  - `20-danger.mjs` (`dangerAskedFor`, `dangerAsk`, `dangerPress`); `20-journal.mjs` (`journalLooks`, `jOwnCall`)
  - `20-desired.mjs` (`cancel_operation`, `undo_last_change`); `20-lessons.mjs` (`askedByOwner`, `passedOverAsk`)
  - `20-memory.mjs` (`lineBy`, `notTheOwners`, `memoryPastShown`, `memoryWithPast`, `memory`, `keepLine`, `eraseLine`),
    `20-memory-tg.mjs` (`tgOwnMemory`), `20-recall.mjs` (`recallLine`)
  - `20-words.mjs` (`pauseWord`, `undoChangeWord`); `21-ahead.mjs` (`aheadChat`, `aheadGive`, `aheadKeep`,
    `allowedWord`)
  - a command on a Spark: `21-work.mjs` (`whoMayLook`), `21-ladder.mjs` (`hostClear`, `workChange`), `21-net.mjs`
    (`netWhose`), `21-long.mjs` (`longStart`), `21-box.mjs` (`boxBy`)
  - `21-apps.mjs` (`keep_running`); `21-power.mjs` (`power_off`, `powerFirst`, `power_settings`); `21-selftest.mjs`
    (`self_test`); `21-web.mjs` (`addressRefusal`)
  - `21-brain-rail.mjs` (`evalYes`), `21-brain-trial.mjs` (`trialYes`), `21-selfchange.mjs` (`selfGate`),
    `21-updates.mjs` (`updInstallAsk`, `updProposalAsk`)
  - the page's `whoKey` (`public/app.js`)
  - `22-sessions.mjs` matches too, but its `via` is how a device signed in, not a caller
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
