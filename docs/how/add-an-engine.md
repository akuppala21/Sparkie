# Add an engine

A model server program (vLLM, SGLang, llama.cpp, …) the console can start. From the map's "Where new things go",
row "An engine".

## Touch

- `ENGINES` (`05-library.mjs`), hashed into every workflow version.

## Also update

- The watcher's image patterns (`MODEL_IMAGES`, `learnedFrom` in `19-watcher.mjs`).
- Trusted image sources (`imageSources` in `CONFIG`, `01-setup.mjs`).
- `pinImage`'s registries (`11-setups.mjs`).
- A lock run, then validation runs: every workflow version changes.

## Never

- An image from an untrusted source.

## Rules

- R18: workflow versions. R27: setup commands are vetted. R17: container names and labels.

## Tests

- `change.test.mjs` (“Recipes knows each model’s best setup”), `workflows.test.mjs`.

## Copy from

- The `trtllm` entry in `ENGINES` (`05-library.mjs`).
