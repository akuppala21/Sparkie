# Add an outbound connection

Anything the console fetches from outside the Sparks. From the map's "Where new things go", row "An outbound
connection".

## Touch

- A fetcher with a fixed host, like `webGet` (`11-setups.mjs`).
- The one fetcher whose host isn't fixed is `read_page` (`21-web.mjs`, R39): only an address in the owner's own words
  or one `search_web` returned in the last hour, only public addresses, checked by the lookup each hop connects
  through (3 redirects at most), no credentials, 15 s and 2 MB.

## Also update

- A switch like `DIG_FIXTURE` (web lookup: `WEB_FIXTURE`) so the stand-in fleet never reaches the web.
- The WEB node of the diagram in `docs/architecture.md`.

## Never

- Let text that was read choose the host.
- Follow redirects with a token attached.
- Send fleet or personal data out (the one exception: `tell()` to the owner's paired Telegram chat, R32; a
  `search_web` query leaves with its key shapes and the fleet's own names and addresses hidden).

## Rules

- R39: web lookup. R26: text read from outside reaches the brain labelled as data. R7: secrets are masked.

## Tests

- `web.test.mjs`, `dig.test.mjs`.

## Copy from

- `webGet` (`11-setups.mjs`) for a fixed host; `webFetch` and `publicAddress` (`21-web.mjs`) for an open one.
