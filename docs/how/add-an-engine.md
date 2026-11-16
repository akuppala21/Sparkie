# Add an engine

A model server program (vLLM, SGLang, llama.cpp, …) the console can start.

## Touch

- `ENGINES` (`05-library.mjs`), hashed into every workflow version.

## Also update

- The watcher's image patterns (`MODEL_IMAGES`, `ENGINE_OF_IMAGE`, `learnedFrom` in `19-watcher.mjs`).
- Its command in `service/dig.mjs` (`engineCommand`; its other names in `vetSetup`), or a command that starts it is
  read as no setup.
- Its server program in `HUB_SERVERS` (`21-hub.mjs`), so a command that starts it on Spark 2 is refused (R1).
- Trusted image sources (`imageSources` in `CONFIG`, `01-setup.mjs`).
- `pinImage`'s registries (`11-setups.mjs`).
- A lock run, then validation runs: every workflow version changes.
- For an engine that can serve the brain: the brain check (`brainAsk`, `21-brain-check.mjs`) reads tool calls the
  way the chat loop does; a server that streams them differently fails the check, so try it with `POST /main/check`.

## Never

- An image from an untrusted source.

## Rules

- R18: workflow versions. R27: setup commands are vetted. R17: container names and labels.

## Tests

- `change.test.mjs` (“Recipes knows each model’s best setup”), `workflows.test.mjs`.

## Copy from

- The `trtllm` entry in `ENGINES` (`05-library.mjs`).
