# Spark Console

One place to run, watch and share the DGX Sparks. It's a static UI plus a small service on Spark 2 that does
everything itself: who's who, status, live metrics, the model library and deploys, Sparkie's model and chats, files,
logs and VS Code in the browser. It replaced the original Spark Portal (see `docs/retire-portal.md`).

- **UI:** https://akspark2.tailab9aa9.ts.net:8443/ (also at `:8443/console/`). The original portal is switched off; undo with
  `bash spark-console/deploy/cutover.sh --rollback` until it's cleaned up (`docs/retire-portal.md`).
- **Install or update:** `bash spark-console/deploy/host-on-portal.sh` (asks for your Spark 2 password; sudo only the first time).
  It snapshots the current version and settings first (`~/.local/share/spark-console/releases/`, newest 10), waits for
  the new build to answer, and puts the old one back by itself if it doesn't; it prints the one-line restore command.
- **Protected containers:** deploys and agents never stop containers matching `protect` in `service/config.json`
  (default `["qwen-recipe-*"]`) or labelled `spark.protect=true`.
- **What the console remembers** (`~/.local/state/spark-console` on Spark 2): `knowledge.json` (every container seen and
  how it was started), `events.jsonl` (what happened), `audit.jsonl` (every agent call), `links.json` (the last cable
  test), `heal-tries.json` (auto-restarts this hour), `api-locked` (Tailscale uses the private socket, so the local port
  is health-only from start-up; `deploy/lock-api.sh --undo` removes it). A file it can't read is set aside as
  `<name>.unreadable-<time>`, never overwritten (the copy from before its last save, `<name>.prev`, takes its place
  when it reads). Once a day the whole folder is copied to Spark 3, or the next Spark that takes it
  (`~/.local/share/spark-console/backups/`, the last 14; tried hourly until one lands, and read back before it replaces
  one); `backup.json` and `/health` show the last try and the last good copy.
- **Safe to leave running:** a Spark that stops answering is skipped after two misses; an operation cut off by a restart
  is reported in Activity; an install waits up to a minute for running operations; agents pause themselves after 12
  changes in an hour or three failed operations in a row.
  Each install stamps a build id into `app.js` and `version.json`. `tailscale serve` sends no cache headers, so open pages
  check `version.json` and refresh themselves when the build changes.

## Pieces

| Path | What it is |
|---|---|
| `public/` | The UI: plain JavaScript, no build step. Served by `tailscale serve` at `/console/`. |
| `service/server.mjs` | The Spark Console service, a `systemd --user` unit on Spark 2 (`spark-console-api`) behind `/console/api/`. |
| `service/config.json` | The starting Spark list (the list in `access.json` takes over once it exists), the library's default home, the serving port, default images, and `main`: Sparkie's always-on model. |
| `service/catalog.json` | The Recipes catalog: models, their versions and the setups people published with their speeds, plus NVIDIA's DGX Spark playbooks. Built by `tools/build-catalog.py`. |
| `service/dig.mjs` | Reads setups out of recipe files, forum posts and model cards, and checks what may run as one click. See [docs/recipes.md](docs/recipes.md). |
| `server.mjs` | Local preview server: `node spark-console/server.mjs`, then http://localhost:4417. |
| `docs/multi-spark.md` | The plan for serving one model across Sparks (prepared, not switched on yet). |

## How the service works

- **Who can use it:** every request comes through Tailscale, which tells the service who the person is. The owner,
  the members (which Sparks they see, chat, file access) and the Spark list are in the console's own
  `~/.local/state/spark-console/access.json` on Spark 2, copied once from the original portal. The owner manages people on
  **Access → People**. Anything that changes a Spark is owner-only, and cross-site requests are refused.
- **One address:** Spark Console has one address, `https://akspark2.tailab9aa9.ts.net:8443/` (`origin` in
  `service/config.json`), on your tailnet, or from the internet through Funnel (`deploy/open-to-internet.sh`), where
  only the public fleet page answers until you sign in with your passkey. People ask for access there, and you
  approve on Access → People. See [docs/sharing.md](docs/sharing.md).
- **Old portal chats** are copied into Sparkie's chat history once each, as ordinary chats.
- **Live metrics:** while someone has the page open, one lightweight reader per Spark streams GPU use, power,
  temperature and memory once a second. It stops about 20 seconds after the last viewer leaves, and hidden tabs disconnect.
- **Any mix of Sparks:** the Spark list is in `access.json` and is re-read every minute. Sparks that go offline drop
  out, Sparks that come back return, and Sparks added there later show up in metrics, deploys and downloads, all without
  a restart. Spark 2 is always on: it runs this service and Sparkie's brain. Spark 3 is the library's default home
  (`modelsHost`): downloads go there unless another Spark is picked, and copies to other Sparks come from it.
- **Model library:** the library is every online Spark's `~/models` (one folder per model, Hugging Face layout) plus its
  Hugging Face cache (`~/.cache/huggingface/hub`, where `hf download` and vLLM put models). A model stored on several Sparks
  shows as one entry with all its copies. Deploying to a Spark that doesn't have it copies it from an online Spark that
  does (Spark 2 first), into the same kind of place. The copy goes through a staging folder, so an interrupted copy never
  looks complete.
  - **Cache models:** a cache model counts once its snapshot has a `config.json` (or GGUF files) and no `.incomplete` blobs; unfinished
    downloads are listed under the table instead. It's served from the snapshot `refs/main` points at, under its repo id
    (e.g. `Qwen/Qwen3-32B`).
  - **Cache location:** the service runs over SSH without your shell profile, so a cache moved with `HF_HOME` in `.bashrc`
    isn't seen. Use the default location.
- **What fits where:** Home's **Deploy a model** lists every model with where it fits right now ("Fits on Spark 4 now",
  "Fits on Spark 3 if X stops", "Running on …"), best options first. After picking one, each online Spark says whether it
  fits and what would have to stop, and the best fit is preselected. The service ranks them from one GPU check per Spark
  (`GET /deploy/options`, `GET /deploy/plans?model=`): fits without stopping anything, then fewest stops, then no copy,
  then most memory to spare. Sparkie's model and other protected containers are never counted as stoppable.
- **Deploy:** the plan shows exactly what will happen before anything runs. It stops containers using the GPU
  (each one has a **Keep running** checkbox), copies the model if needed, downloads the serving image if missing,
  starts the model's engine (vLLM, SGLang, TensorRT-LLM, or llama.cpp for GGUF files), and waits until it answers on
  port 8000.
  Containers labeled `spark.protect=true` are never stopped.
- **Running now** also lists model servers started outside the console, like benchmarks. It finds them by asking each
  running container's published port for `/v1/models` (read-only). They're shown, never stopped from the Models page.
- **Sparkie's model (`main` in config.json):** the service runs one always-on chat model on its own Spark (Spark 2) as the
  container `sparkie-main`.
  - **Always on:** `--restart unless-stopped`, so it comes back after reboots until someone presses Stop. It's labeled
    `spark.protect=true`, so deploys never stop it.
  - **Weights:** from Spark 2's Hugging Face cache (the model plus its draft model), mounted read-only. Compiled kernels are
    kept in `~/.cache/spark-console/kernels`, so restarts after the first are quicker.
  - **API:** listens on `127.0.0.1:30100` only.
  - **Long context (`ropeScaling`):** Aphex serves 1M tokens using YaRN (factor 4 over a 262,144-token base), like the
    benchmark's "extended" copies. Each start builds `~/.cache/spark-console/overlay/<served name>/{model,draft}`: links to
    every cached file, plus a `config.json` with that rope change. The cache itself is never modified. If a config has no
    rope settings, the start stops with an error.
  - **Settings:** today it's the Aphex Qwen recipe: SGLang, `RadixArk/Qwen3.8-27B-NVFP4` with `z-lab/Qwen3.8-27B-DFlash2` for
    DFLASH speculative decoding, 1M context, one request at a time. Change `main` to change it.
  - **Start and Stop:** from Models. Start shows what else on that GPU stops, with Keep running choices.
- **Choosing Sparkie's model (Models → Sparkie):** Sparkie is the one main LLM; the model behind it is your choice.
  - **Model dropdown:** any running model the service can reach, or a model on disk.
    - **Running:** Sparkie's own model, console deploys (they listen on the tailnet), and other model servers on Spark 2.
      Choosing one just points Sparkie there; nothing restarts.
    - **On disk:** a saved setup or any Library model. It starts as Sparkie's own model on Spark 2, copied over first if
      needed. If it doesn't start, Sparkie goes back to the previous model.
  - **Agents dropdown:** "Same as Sparkie", or any running model.
  - **Where it's kept:** the choices and setups made from Library models live in
    `~/.local/state/spark-console/main.json` on Spark 2.
  - **Not offered:** servers that only listen on another Spark's own address (`127.0.0.1` there) are shown but can't be
    picked.
- **Agents (the agent door):** your own agents (Claude Code, Cursor, the `spark` command) use the console's actions
  through one MCP address, each with its own key from Access → Agents; they can talk with Sparkie (`ask_sparkie`,
  `spark ask`) or call actions directly, and change things only if you allow it. See
  [docs/agent-door.md](docs/agent-door.md); the plan for Sparkie acting on its own is [docs/history/sparkie-actions.md](docs/history/sparkie-actions.md).
- **Sparkie for agents:** one OpenAI-compatible address that stays the same whichever model is behind it:
  `https://akspark2.tailab9aa9.ts.net:8443/console/api/v1`, model `sparkie`, any API key.
  - **Model names:** `sparkie` goes to whatever the Agents choice on Models is. The dedicated model's own name (today
    `qwen-aphex`) always reaches it, the way any deployed model has its own address. It only listens on Spark 2 itself,
    so this is how other tools reach it; Models → Running now shows the address and name. Any other name goes to `sparkie`.
  - **Thinking:** Qwen thinks before answering unless told not to. Send `"chat_template_kwargs": {"enable_thinking": false}`
    for short direct answers (Sparkie's own chat does), or allow enough `max_tokens` for the thinking.
  - **Supports:** `/v1/models`, `/v1/chat/completions` and `/v1/completions`, streamed or not.
  - **Access:** follows your Tailscale identity (anyone allowed to chat). It only takes JSON, and refuses requests from web
    pages on other sites.
  - **Example:**
    ```bash
    curl https://akspark2.tailab9aa9.ts.net:8443/console/api/v1/chat/completions -H 'content-type: application/json' -d '{"model":"sparkie","messages":[{"role":"user","content":"hi"}]}'
    ```
- **Sparkie's chats:** every chat goes to Sparkie, through this service, whatever model Sparkie is set to.
  - **Streaming:** it streams each reply from the model to the page. A reply keeps going and is saved even if the page closes.
  - **What's attached:** each question carries a live snapshot of the fleet, or of one Spark for a Spark's own chat, as context.
  - **Where history lives:** in `~/.local/state/spark-console/chats.json` on Spark 2 (owner-only file). Each person sees only
    their own chats. Anyone the owner lets chat can use it.
  - **Older chats:** the original portal's chats were copied in once, as ordinary chats, before it was switched off.
- **Recipes:** every model worth running on the Sparks (80 as of 2026-11-04), each with its versions (NVFP4, FP8, …)
  and the setups people published: engine, image, flags, number of Sparks (1–4) and tokens/s, with the source and how
  credible it is. **Verified** marks what has run on these Sparks; every deploy is recorded there automatically
  ("Your recipes", with **Start**).
  - **Adding any model** (owner): type in the one box on Models → Find more: words search Hugging Face, a link or `org/model` adds it. Safetensors and GGUF
    both work, fine-tunes and abliterated models included. Spark Console then finds the setups people published for it
    (NVIDIA's recipes, recipes.vllm.ai, Spark Arena, eugr, the forums, model cards). The format, the sources and the
    one-click rules are in [docs/recipes.md](docs/recipes.md).
  - **Options:** each model's versions and setups side by side (Sparks, memory, speeds) with the trade-offs tagged.
  - **Download** puts a version into that Spark's Hugging Face cache (no pickle weights or duplicate copies); for GGUF,
    only the chosen file.
  - **Start** runs a setup as published, if it passes the one-click checks (pinned image from an approved source,
    no flags that load plugins or read host paths, 1 or 2 Sparks). Other setups stay listed with their numbers and why
    they aren't one-click. A setup that needs `--trust-remote-code` only runs for the owner, after ticking a box.
  - **Updating the catalog:** `python3 -I tools/build-catalog.py <research dir> service/catalog.json` merges model lists
    and community setups (the research files from 2026-11-04 are the inputs).
- **Direct-cable readiness** (each Spark → Checks; linked pairs on Home): reads each Spark's ConnectX links and addresses, and on request pings each pair
  over the cable at full packet size. It changes nothing. It's the first step toward serving one model across Sparks;
  see [docs/multi-spark.md](docs/multi-spark.md).

### Optional `spark.json` in a model folder

```json
{ "title": "Qwen3 30B-A3B Instruct", "engine": "vllm", "args": ["--max-model-len", "32768"], "memoryGiB": 75 }
```

`engine` is `vllm` (the default) or `sglang`. `image` overrides the default image, `args` are passed to the server,
and `memoryGiB` is used for the "will it fit" check.

## Removing it

```bash
ssh -t akuppala@100.79.155.126 'sudo tailscale serve --https=8443 --set-path=/console/ off; sudo tailscale serve --https=8443 --set-path=/console/api off; systemctl --user disable --now spark-console-api'
```

Don't run the plain `tailscale serve --https=8443 off` that tailscale suggests: it removes every route on port 8443, not
just these two.
