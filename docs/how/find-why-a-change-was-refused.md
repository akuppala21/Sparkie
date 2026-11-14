# Find out why a change was refused, asked about, or paused

A change that did not run at once: it was refused, became a button for the owner, or found agents paused. Each gate
says which it was in its words; find the gate before changing anything.

## Touch

Look in this order:
1. The refusal or the button's text: it names the gate (paused, not tested, not validated, not your words, no room,
   the brain's Spark, protected).
2. `sparkie_setup`: whether agents' changes are paused (by the owner or by themselves) and why.
3. `workflows`: whether the workflow behind it is tested and validated.
4. `recent_operations` and `fleet_events`: failed operations that tripped the pause.

Then the code, in the order `runAction` (`16-actions.mjs`) checks: inputs (`checkInput`), may change, the pause
(`pausedCheck`, `agentSettings` in `17-changes.mjs`), the intent gate for Sparkie (`sparkieCheck`, `changeIntent`,
`tracesToRequest` in `16-actions.mjs`), the workflow state (`workflowStatus` in `18-workflows.mjs`), the breaker
(`tripBreaker`), then the action's own rails (`railsFor`, `placeModel`, `question` in `17-changes.mjs`). Passkey
gates on page routes: `passkeyGate` (`22-passkey.mjs`).

## Also update

- A gate that refused what the owner's words asked for: a test in `sparkie.test.mjs` or `intent.test.mjs` that fails
  without the fix.

## Never

- Loosen a gate to make a change pass. Never set `ctx.trusted` or an approval argument from outside.
- Resume a pause the breaker set without knowing which operations failed.

## Rules

- R25: a change from Sparkie runs at once only when the owner's own words ask for it and name its target.
- R9: the pause fails closed and trips itself. R18: a workflow runs only tested. R12: approval arguments stay out of
  public schemas. R6: passkey-gated changes.

## Tests

- `sparkie.test.mjs` (“the tools, and the two lanes for a change”), `intent.test.mjs`, `pause.test.mjs`,
  `workflows.test.mjs` (“validation”), `passkey.test.mjs`.

## Copy from

- `sparkie.test.mjs` (“requests run (a polite”): what runs and what becomes a button, side by side.
