# Add a page route

A route under `/console/api` that the page calls.

## Touch

- A branch in `handler` (`24-handler.mjs`) below the checks it needs (R4).

## Also update

- When gated by the passkey: `mayNeedPasskey`, `needsPasskey`, `describeChange`, `bodyLimit` (`22-passkey.mjs`).
- Power cards reuse `/actions/power_on` and `/actions/power_off` with `X-Spark-Power-Card: 1` for page choices;
  other action calls stay direct API calls. Confirm with the server's choice id alone. Owner-only power-off choices
  need the normal passkey even if the marker is absent.
- The tests R4 lists: the route as nobody, cross-site, through Funnel, from a Spark's address; and the route in
  `owner-only.test.mjs`'s list, which fails until it is there.

## Never

- List it in `PUBLIC_ROUTES` unless the internet may call it.
- Change a Spark without `runAction`.

## Rules

- R4: a route sits below the handler checks it needs. R5: transport and sender come before identity.
- R6: a passkey-gated change is in both lists, with entries in `describeChange` and `bodyLimit`.
- R11: a change to a Spark goes through `runAction`.

## Tests

- `internet.test.mjs`, `passkey.test.mjs`, `fleet.test.mjs` (“page routes refuse a Spark's address too”).

## Copy from

- The `/desired` branch in `handler` (`24-handler.mjs`): a read; `/desired/forget`: a change.
