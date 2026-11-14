# Add a member permission

What a member (not the owner) may do. From the map's "Where new things go", row "A member permission".

## Touch

- `memberPermissions`, `ACCESS_PRESETS`, `ownerPermissions` (`03-identity.mjs`).

## Also update

- The route's own check in `handler` (`24-handler.mjs`).

## Never

- Widen a preset silently.

## Rules

- R4: a GET is readable by every member unless it calls `ownerOnly()`; a member's non-GET is refused unless listed.
- R6: changes to who has access need the passkey.

## Tests

- `passkey.test.mjs`, `internet.test.mjs`, `door.test.mjs` (“members cannot list actions or keys, or make keys”).

## Copy from

- The run permission: `runRoute` and `canManage` in `handler` (`24-handler.mjs`).
