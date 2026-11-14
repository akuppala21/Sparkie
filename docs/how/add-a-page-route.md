# Add a page route

A route under `/console/api` that the page calls. From the map's "Where new things go", row "A page route".

## Touch

- A branch in `handler` (`24-handler.mjs`) below the checks it needs (R4).

## Also update

- When gated by the passkey: `mayNeedPasskey`, `needsPasskey`, `describeChange`, `bodyLimit` (`22-passkey.mjs`).
- `runRoute` (in `handler`) if members may use it.
- The tests R4 lists: the route as nobody, a member, cross-site, through Funnel, from a Spark's address.

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
