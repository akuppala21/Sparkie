# Recipes: adding any model, and how its setups are found

**Status:** built 2026-11-04. Owner-only for adding and searching; everyone can browse.

## Adding a model: two ways

1. **Search** (`GET /recipes/search?q=` with what you need). Sparkie turns your words into search terms,
   grounded in the current catalog. The service reads each result's real files on Hugging Face (size, format, gated) and
   groups the versions of one model together. `POST /recipes/add` adds it.
2. **Paste links** (`POST /recipes/add-list`). Paste up to 20 links or `org/model` names. Versions of the same
   model are grouped, and dataset and Space links are skipped.

Either way, the service then **finds setups** for the model on its own. **Look again** on any model reruns the search.

**Any model counts:** safetensors (served by vLLM, SGLang or TensorRT-LLM) and GGUF (served by llama.cpp), including
fine-tunes and abliterated or uncensored models. Left out: formats no engine here serves (MLX, ONNX, OpenVINO, phone
builds, EXL) and draft models (DFlash, EAGLE, MTP heads), which only run alongside a main model.

## Where setups come from

Each source is read in this order; the first copy of a command wins.

| Source | What's read |
|---|---|
| NVIDIA's local-ai-inference-recipes | `recipe.yaml` + `performance.yaml` for DGX Spark on 1, 2 or 4 Sparks. Measured speeds; the image is pinned to the digest NVIDIA measured with. |
| recipes.vllm.ai | The DGX Spark JSON for each version: exact flags, environment and image. |
| Spark Arena registry | sparkrun recipe files (official and experimental). |
| eugr's spark-vllm-docker | sparkrun-style recipe files, including 3- and 4-Spark ones. |
| NVIDIA developer forums | Commands in posts. Sparkie says which stated speed belongs to which command, quoting the post; a speed only counts if the quote really is in the post and contains the number. Threads with no command still give a **report**: the speeds from the title or first post, to compare against. |
| Model cards | Commands in the README (marked low confidence: usually not measured on Spark). |

The service itself pulls the commands out of every source (`service/dig.mjs`), so no model writes them. Only threads
whose title names this exact model are read, so the "Vision-Exp" thread doesn't count for the plain model. A quantized
version counts as the same model, but only when its name agrees. A fine-tune's base model's setups don't count, even
when the uploader tags it that way.

## The format (one per setup)

Every source becomes the same record, also used by `service/catalog.json`:

```json
{
  "id": "6b41a79399",
  "repo": "nvidia/Qwen3.8-27B-NVFP4",
  "quant": "NVFP4",
  "file": "Q4_K_M",
  "engine": "vllm | sglang | trtllm | llama.cpp | other",
  "image": "eugr/spark-vllm:latest@sha256:…",
  "sparks": 2,
  "args": ["--kv-cache-dtype", "fp8", "--max-num-seqs", "8"],
  "env": { "VLLM_USE_FLASHINFER_SAMPLER": "1" },
  "perf": { "decodeTokS": 55.7, "prefillTokS": 1500, "aggregateTokS": 59, "concurrency": 4, "context": "…", "quote": "…" },
  "source": { "url": "…", "author": "NVIDIA", "date": "2026-10-23", "kind": "nvidia | vllm-recipes | spark-arena | eugr | forum | model-card" },
  "credibility": "high | medium | low",
  "deployable": true,
  "why": null,
  "report": false
}
```

`file` is only for GGUF (which quantization file); `report` marks forum numbers with nothing to run. Found setups are kept
in `~/.local/state/spark-console/found-setups.json` on Spark 2, one entry per model, replaced on each search. Models you
added are in `added-models.json` there.

## What makes a setup one click

Checked when it's found, and again at deploy time, whatever the source said:

- **Engine and Sparks:** vLLM or SGLang on 1 or 2 Sparks, or TensorRT-LLM or llama.cpp on 1. 3- and 4-Spark setups are
  listed with their numbers, not run.
- **Image:** from an approved source (`imageSources` in `config.json`: NVIDIA's registry, vLLM, SGLang, llama.cpp,
  eugr). It's pinned to an exact digest and has an ARM64 build. A setup that names no image uses Spark Console's own
  pinned image for that engine (`images` in `config.json`).
- **Flags:** the ones the console sets itself are dropped: where it serves, the name, and how it spreads over Sparks.
  The setup isn't one click if it uses any of these:
  - flags that load code or files, change logins, or send data elsewhere (plugins, chat-template files, API keys, …);
  - shell variables, or blanks left to fill in;
  - paths on the author's machine;
  - words that aren't flags.
- **Environment:** only engine and NCCL tuning variables are kept; tokens and anything with a shell variable are
  dropped.
- **Size:** a setup on fewer Sparks than its version needs is flagged.
- **Remote code:** `--trust-remote-code` runs only for the owner, after ticking a box.
- **Not one click** for any of these: a community-built or self-built image, recipe patches ("mods") applied at start,
  or a hand-built engine. These stay listed with their numbers and the reason.

## Comparing options

Each model's **Options** table puts its choices side by side: for each version and number of Sparks, the fastest known
setup, plus forum reports, plus versions with no published setup (they run with the engine's defaults). A one-click
setup and a faster hand-built one for the same version get separate rows. Columns: Sparks, memory, speed for one user
(and prefill, several users, first token when known), and what runs it. Tags mark the trade-offs: **Fastest**,
**Fewest Sparks**, **Smallest**, **Most precise**, **Measured here**. Your own runs come first: every deploy is measured
and recorded as **Verified**.

## Engines

| Engine | Serves | Sparks | Default image (`config.json` → `images`) |
|---|---|---|---|
| vLLM | safetensors | 1 or 2 | `vllm/vllm-openai@sha256:…` |
| SGLang | safetensors | 1 or 2 | `lmsysorg/sglang@sha256:…` |
| TensorRT-LLM | safetensors | 1 | `nvcr.io/nvidia/tensorrt-llm/release:1.3.0rc29@sha256:…` |
| llama.cpp | GGUF (picks the chosen file; adds `--mmproj` when the repo has a vision projector) | 1 | `ghcr.io/ggml-org/llama.cpp@sha256:…` (server-cuda13) |

**Triton and Ollama:** not added. For OpenAI-style serving of one model, Triton runs the same TensorRT-LLM or vLLM
engines underneath, and Ollama serves GGUF, which llama.cpp already covers. Either can be added as an engine entry in
`server.mjs` (`ENGINES`) if a model ever needs it.
