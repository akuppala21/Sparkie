# Add a recipe source

A recipe source is a place setups for a model are read from (a recipe list, a model card).

## Touch

- A pure parser in `service/dig.mjs` (part of the build id).
- A fetcher, `sources` and `SOURCE_RANK` in `11-setups.mjs` (`digModel`, `SOURCE_RANK`).

## Also update

- The `code()` of `find_setups` in `WORKFLOWS` (`18-workflows.mjs`).
- The source names in its description (`find_setups` in `17-changes.mjs`) and in its workflow text
  (`18-workflows.mjs`).
- `pinImage`'s registries (`11-setups.mjs`).
- A direct test of the parser: `test/dig.test.mjs` imports `dig.mjs`; a `{hf, card}` fixture entry goes through
  `dig.fromCard`, the others are already-parsed setups.

## Never

- Let a model write a command.
- Skip `dig.vetSetup`.
- Fetch in tests.
- Source kind `forum` (`bestHow` skips it).
- Read a card's words; take a card's command for another repo.
- Look on a timer: a look runs when asked, or when a start or `recipe_detail` finds the setups over a week old (R27).

## Rules

- R27: setup commands are read by code, vetted by `dig.vetSetup`, and checked again by `resolveHow` at use.
- R22: `found-setups.json` has one writer, `digModel`.
- R18: `find_setups` is a workflow; its `code()` lists what it runs.

## Tests

- `dig.test.mjs`; `change.test.mjs` (“Recipes knows each model’s best setup”); `setups-look.test.mjs`.

## Copy from

- The model-card source: `cardText` and `cardSetups` in `11-setups.mjs`, `fromCard` in `service/dig.mjs`.
