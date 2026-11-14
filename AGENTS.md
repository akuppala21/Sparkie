# Working on Spark Console

For whoever changes this code: Sparkie (the owner's local brain), an agent engine, or a person. Start here.

## Read in this order

1. **This page.** The layout, how to work, and the rules that are never broken.
2. **`docs/architecture.md`.** How it is built today, checked against the code:
   - the diagram;
   - the path of one sentence from chat to a running model;
   - who holds each fact;
   - rules R1–R40 that every change must keep;
   - where new things go;
   - the checklist to tick before any install.
3. **`docs/code-map.md`.** Every part, action, state file, timer and function, written from the code. Use it to find where something lives.
4. **`docs/contract.md`.** What the product must do and why. Search it; don't read it all.
5. **`docs/analysis-2026-11-11/`** and **`docs/reviews-2026-11-11.md`.** What the reviews found and the plan that came out of them.

The contract says what the product must do. The architecture map says how it is built now. When they disagree, say so
in your change (and fix the one that is wrong); never quietly change either.

## Layout

| Path | What it is |
|---|---|
| `service/src/NN-name.mjs` | The service, in parts. **Edit these, never `service/server.mjs`.** |
| `service/server.mjs` | Generated: the parts joined in name order. Rebuild it with `node tools/build-server.mjs` after any change to a part. The tests and the installer refuse a `server.mjs` that doesn't match its parts. |
| `service/config.json` | The Sparks, images, and the brain's setups (`main.presets`). |
| `service/dig.mjs`, `service/passkey.mjs`, `service/worker.py` | Recipe reading, passkeys (WebAuthn), and the worker run on each Spark. |
| `public/` | The page: plain JavaScript, no build step. |
| `test/` | The suite (`*.test.mjs`) and the stand-in fleet (`test/mock/`, `test/start-mock.mjs`). See `test/README.md`. |
| `deploy/` | Install scripts (`host-on-portal.sh`; on Spark 2 itself, `host-on-portal.sh local`). `go-back.sh` and `RECOVERY.txt`: every install copies them to `~/.local/share/spark-console/` on Spark 2, the by-hand way back when the console doesn't answer. |
| `tools/` | `build-server.mjs`, `code-map.mjs`, `console.mjs`, `spark.mjs`, `brain-load.mjs`, and catalog builders. |
| `docs/` | The contract, the architecture map, the code map, and the analysis record. |

On Spark 2 the same tree is at `~/spark-console-src` (every install copies it there).

## How to work

1. Find it first: `docs/code-map.md` for where, `docs/architecture.md` section 6 for where a new thing of that kind goes.
   Then read the code before changing it.
2. Make the change in `service/src/…`, then run `node tools/build-server.mjs` and `node tools/code-map.mjs`.
3. Every fix gets a test that fails without it. Put it in the `test/*.test.mjs` file closest to the feature.
4. Run the tests closest to your change: `SPARK_TEST_STRICT=1 node --test test/<file>.test.mjs`. On a slow machine,
   add `SPARK_TEST_SLOW=3`. Tests bind local ports and start a stand-in fleet of bash scripts; they never touch the
   real Sparks.
5. A new tool (an `action({...})` an agent can call) also goes in the tool lists in `test/lib.mjs` (`TOOLS` or
   `CHANGE_TOOLS`), which the door tests compare exactly, and in the tool counts in `test/change.test.mjs`.
6. If the change alters how parts connect, who holds a fact, or a rule, update `docs/architecture.md` in the same
   change.
7. Before a release: `node test/lock.mjs` runs the whole suite strictly and, only if all of it passes, marks the build's
   workflows as tested in `service/workflows.lock.json`. The installer refuses a lock that isn't for this exact code.
   Install with a line saying what changed: `NOTE='what changed, in plain words' bash deploy/host-on-portal.sh`. It goes
   on the update record that `sparkie_setup` shows (no secrets in it).
8. After installing, check the change the way the owner would use it: through Sparkie's chat or
   `POST /console/api/actions/<name>`. Passing tests are not the same as working on the real Sparks. The installer checks
   the new build by itself (40 seconds as one process, the ways in, one chat turn) and puts the previous files back on
   any miss (R30); put `SKIP_CHAT_CHECK=1` in front of the command to update while Sparkie's model is down.

## Rules that matter

- Never edit `service/server.mjs` directly, and never edit or weaken an existing test to make a change pass.
- Keep rules R1–R40 in `docs/architecture.md`. Where the map says "Today:" the code falls short of a rule; don't add to
  those gaps.
- Text the owner reads (the page, Sparkie's notes, errors) is plain words: short sentences, no jargon.
- Nothing starts a model or workload on Spark 2 (the brain's Spark). Never touch SSH, Tailscale, firewall or user
  settings (contract 8.3).
- Don't delete the owner's data. Stopping something isn't deleting.
- Sparkie never says something happened unless a tool said so, and never says it checked something it has no tool for.
