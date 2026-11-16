# Open something through the app door

The app door is port 10000 of the console's own name: it shows the owner's kept apps, and nothing of the console.

## Touch

- Nothing for an app: any app kept with `keep_running` (R38) on a Spark that isn't the brain's opens through it, and
  its links come from `appLinks` (the door's first, the tailnet one as `tailnetLink`, only while `doorOn`).
- A change to the door itself: `21-door.mjs` (`doorHandler`, `doorUpgrade`, `doorGate`).

## Also update

- R40.
- `test/app-door.test.mjs` (as nobody, an agent key, a terminal, from a Spark's address, cross-site and from another
  port, for HTTP and the WebSocket).
- `deploy/open-apps-to-internet.sh` if its route changes.

## Never

- Pass a `/console/api` path or a console cookie to an app.
- Forward to a host or port the request names, the brain's Spark or a model's port.
- Let anyone but the owner, or an agent key, through.
- Serve the API or the page on it.
- Let the console change Tailscale.

## Rules

- R40: the app door. R38: apps are kept only through `keep_running`. R3: no action changes Tailscale.

## Tests

- `app-door.test.mjs`, `apps.test.mjs`.

## Copy from

- `doorTarget` and `appLinks` in `21-door.mjs`.
