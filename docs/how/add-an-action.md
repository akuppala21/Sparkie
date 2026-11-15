# Add an action

An action is a named tool that Sparkie, agents (`/mcp`) and `POST /console/api/actions/<name>` all call through
`runAction`. From the map's "Where new things go", row "An action".

## Touch

- `action({...})` at top level in a part numbered 16 or later (`action` in `16-actions.mjs`).
- Give it a group: `group: '…'` at the end of its first line (`name: …, title: …`). `core` only if every round needs
  it, else one of the groups in `GROUP_WORDS` (`16-actions.mjs`), or a new group with its words there; at most 12 in
  the core and 6 a group (`node tools/make.mjs` says which). A group decides what Sparkie is offered, never what it may
  do.
- Only kind `read` is special: every other kind is a change (`confirm` is not implemented). Scope is `fleet:read` or
  `fleet:act` (keys hold nothing else). `who: member` is unreachable (tools go to the owner only).
- A plain-words `title`: `sparkie_setup {about: "abilities"}` tells the owner what Sparkie can do by listing every
  action's title straight from the registry (nothing to edit there), and an action added to `PAGE_ONLY` shows in its
  Telegram line by itself.
- Limits it inherits. Agent door (`mcpDoor` in `20-mcp.mjs`): 120 requests a minute per key, 3 tools at once, 6
  open-world calls a minute, an answer within 50 seconds, results cut at 60,000 characters. Sparkie (`sparkieTurn` in
  `14-chats.mjs`): 6 tool rounds and 4 changes per message, 4 calls a round, 12,000 characters per result, 50 seconds
  per tool.

## Also update

- `test/lib.mjs` (`TOOLS` or `CHANGE_TOOLS`, and `CORE_TOOLS` for a core one), which the tests compare name by name;
  `DOOR_READ` and `DOOR_ACT` follow from them.
- For a change: `ACTION_KIND` and `CHANGE_WORDS` (`16-actions.mjs`), `changeLabel` (`17-changes.mjs`), and its own
  target check in `sparkieCheck` for any argument not called model, container, spark or sparks.
- `INSIDE_READS` (`14-chats.mjs`) for a read of the console's own numbers; `PLAN_SKIP` (`16-actions.mjs`) for an
  approval argument.
- The valid-argument tables: `door.test.mjs` (“read tools, valid arguments”) and `VALID` in `test/fuzz.test.mjs`
  (door tests want string, integer, boolean or array properties and the Spark enum on any "spark" property).
- `NOT_A_STEP` (`18-workflows.mjs`) if it must not be a step of a saved workflow.
- A change that writes a file or runs a command on a Spark is written down first: `journalFirstFor` (`20-journal.mjs`,
  R43). `runAction` then writes its start line, synced, before it runs, and refuses it (`JOURNAL_REFUSED`) when the
  line can't be written. Code outside `runAction` (the command runner) calls `journal` with `{ start: true }`, runs
  nothing when it gives back null, and ends with `{ id, end: true }` and the output as the text.
- Run `node tools/make.mjs`: the code map and `docs/registry.md` list the new action.

## Never

- A second route doing the same change.
- Approval arguments in the schema.
- Long work that does not return `{outcome:'started', operation}` at once.

## Rules

- R11: only through `runAction`, in its order; anything that changes a Spark also takes a claim, a job and `run`.
- R25: a change from Sparkie runs at once only when the owner's own words ask for it and name its target.
- R29: every action is in `TOOLS` or `CHANGE_TOOLS`.
- R46: every action has one group; a line in Sparkie's prompt that names it goes in `TOOL_LINES` (`14-chats.mjs`).
- R7: results to agents pass `maskDeep`.
- R43: a change that writes or runs on a Spark has its start line on disk before it runs.

## Tests

- `door.test.mjs`, `fuzz.test.mjs`, `change.test.mjs` (“who may change things”), `abilities.test.mjs`, `tools.test.mjs`.
- The part's own test file, with a test that fails without the action.

## Copy from

- A read: `search_web` in `21-web.mjs`.
- A change that starts an operation: `restart_model` in `17-changes.mjs`.
