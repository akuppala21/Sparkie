# Spark Console

One place to run, watch and share the DGX Sparks. It's a static UI plus a small service on Spark 2 that does
everything itself: who's who, status, live metrics, the model library and deploys, Sparkie's model and chats, files,
logs and VS Code in the browser. It replaced the original Spark Portal (see `docs/retire-portal.md`).

- **UI:** https://akspark2.tailab9aa9.ts.net:8443/ (also at `:8443/console/`), the console's one address: on the
  tailnet, or from the internet behind the owner's passkey (`docs/sharing.md`).
- **Install or update:** `bash spark-console/deploy/host-on-portal.sh` (asks for your Spark 2 password; sudo only the first time).
  It keeps the update only if the new build answers, and puts the old one back by itself if not (R30). If the
  console ever stops answering, on Spark 2: `bash ~/.local/share/spark-console/go-back.sh` (`deploy/RECOVERY.txt`).
- **Sparkie's model from your own tools:** `https://akspark2.tailab9aa9.ts.net:8443/console/api/v1`, model `sparkie`
  (contract 9.9). Qwen thinks before answering unless told not to: send
  `"chat_template_kwargs": {"enable_thinking": false}` for short direct answers, or allow enough `max_tokens` for the
  thinking.

## Where to start

| To … | Read |
|---|---|
| change it (Sparkie, an agent or a person) | `AGENTS.md`, then one card in `docs/how/` |
| know what it must do, and what is built | `docs/contract.md`, `docs/status.md` |
| see how it fits together | `docs/architecture.md`, `docs/code-map.md`, `docs/registry.md` |
| know what it keeps on Spark 2, and where | `docs/state.md`, `docs/state-outside.md` |
| use it from your own agents and scripts | `docs/agent-door.md` |
| share it with people | `docs/sharing.md` |
| add models and the setups people published | `docs/recipes.md` |
| serve one model across Sparks | `docs/multi-spark.md` |
| run the tests | `test/README.md` |
| look up a word | `docs/glossary.md` |

## Pieces

| Path | What it is |
|---|---|
| `public/` | The UI: plain JavaScript, no build step. |
| `service/src/` | The service, in parts; `service/server.mjs` is them joined, by `node tools/make.mjs`. |
| `service/config.json` | The starting Spark list (the list in `access.json` takes over once it exists), the library's default home, the serving port, default images, and `main`: Sparkie's always-on model. |
| `service/catalog.json` | The Recipes catalog: models, their versions and the setups people published with their speeds, plus NVIDIA's DGX Spark playbooks. Built by `tools/build-catalog.py`. |
| `service/dig.mjs` | Reads setups out of recipe files, forum posts and model cards, and checks what may run as one click. See [docs/recipes.md](docs/recipes.md). |
| `server.mjs` | Local preview server: `node spark-console/server.mjs`, then http://localhost:4417. |

## Removing it

```bash
ssh -t akuppala@100.79.155.126 'sudo tailscale serve --https=8443 --set-path=/console/ off; sudo tailscale serve --https=8443 --set-path=/console/api off; systemctl --user disable --now spark-console-api'
```

Don't run the plain `tailscale serve --https=8443 off` that tailscale suggests: it removes every route on port 8443, not
just these two.
