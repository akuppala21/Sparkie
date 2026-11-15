# Add a brain setup

A way to run and ask Sparkie's brain: a setup in `service/config.json` (`main.presets`), or one made from a Library model
at a switch. A newer brain needs its setup, never an edit to the chat loop (R50).

## Touch

- `main.presets` in `service/config.json`: the model, engine, image and flags, and how its brain is asked (`thinking`,
  `maxTokens`, `sampling`, `templateKwargs`), beside them or in an `ask` block.
- For a Library model: an `ask` block in its `spark.json`. The setup made from it keeps it, checked (`askBlock`).

## Also update

- What the new brain needs that the first one didn't, in the same place: `mergeRoles` when its chat template refuses
  two user messages in a row; `thinkTags` when its server leaves its thinking in the text between other tags;
  `tokenBudget` when its context is small (its own count of tokens ends the tool rounds there).
- Its limits beside the block, never in it: `toolRounds`, `maxChanges`, `toolCap` (R46).
- After the switch: `POST /main/check` (the brain check) and the brain eval (`docs/how/run-the-brain-eval.md`). A setup
  that sets any of the three fields above changes what the brain reads (the tested mark).

## Never

- A line in the chat loop (`howAsked`, `modelStep`, `brainContext`) for one model: say it in its setup.
- A limit in an `ask` block: it is left out there, since a `spark.json` comes from a Spark's disk.

## Rules

- R50: how a brain is asked and read. R15: a start is done when it answers a test prompt. R46: `toolCap`.

## Tests

- `brain.test.mjs` (“another brain's habits, said by its setup”), `agent-setup.test.mjs`, `brain-check.test.mjs`.

## Copy from

- The `aphex-agent` setup in `service/config.json`: its own sampling, thinking on, long outputs.
