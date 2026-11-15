# Working on Spark Console

Spark Console is one Node service on Spark 2 that runs the owner's NVIDIA DGX Sparks: models, apps and jobs on the
other Sparks, and Sparkie, the local brain the owner talks to. This page is the front door for whoever changes it
(Sparkie, an agent or a person): read it, then your task's card, then what that card names.

The contract (`docs/contract.md`) says what must be true; the rules (`docs/rules/`) say how; code that falls short is
recorded (a "Today" note in its rule), never fixed by quietly editing either.

## Never break

- Never edit `service/server.mjs` directly, and never edit or weaken an existing test to make a change pass.
- Keep every rule in `docs/rules/` (one line each in `docs/rules.md`); don't add to the gaps a rule's "Today" notes.
- Nothing starts a model or workload on Spark 2 (the brain's Spark) or powers it off (R41).
- Today no action changes SSH, Tailscale, the firewall or users (R3, contract 8.3), and you don't while working here.
  Milestone 2 lets Sparkie change them when the owner asks, asked first, inside the put-back net; until then, add no
  path to them.
- Don't delete the owner's data. Stopping something isn't deleting.
- Sparkie never says something happened unless a tool said so, and never says it checked something it has no tool for.
- Text the owner reads (the page, Sparkie's notes, errors) is plain words: short sentences, no jargon.

## Layout

| Path | What it is |
|---|---|
| `service/src/NN-name.mjs` | The service, in parts. **Edit these.** |
| `service/config.json` | The Sparks, images, and the brain's setups (`main.presets`). |
| `service/dig.mjs`, `service/passkey.mjs`, `service/worker.py` | Recipe reading, passkeys (WebAuthn), the worker on each Spark. |
| `public/` | The page: plain JavaScript, no build step. |
| `test/` | The suite and the stand-in fleet (`test/README.md`). |
| `deploy/` | The installer (`host-on-portal.sh`); `go-back.sh` and `RECOVERY.txt`, the way back by hand. |
| `tools/` | `make.mjs` (the one command), `console.mjs` (the owner's terminal), `spark.mjs` (agents), builders. |
| `docs/architecture.md` | The picture: the diagram, one request from chat to a running model, known traps. |
| `docs/rules/`, `docs/rules.md` | One rule per file, and their index (generated). |
| `docs/how/` | One card per kind of work. |
| `docs/state.md`, `docs/glossary.md` | Who holds each fact; this project's words. |
| `docs/code-map.md`, `docs/registry.md` | Generated: parts and who uses what; actions, state files, timers. |
| `docs/contract.md` | What the product must do and why. |
| `docs/history/` | Dated records: plans, reviews, analyses. Never edited. |

## How to work

1. Find it first: the task table below gives one card. Read the code before changing it; `docs/code-map.md` says
   where everything lives.
2. Change the parts in `service/src/`, then run `node tools/make.mjs`: it rebuilds `service/server.mjs` and the
   generated documents, and checks them and the parts' headers. `node tools/make.mjs --check` changes nothing.
3. Every fix gets a test that fails without it, in the `test/*.test.mjs` file closest to the feature.
4. Run the tests closest to your change: `SPARK_TEST_STRICT=1 node --test test/<file>.test.mjs`
   (`SPARK_TEST_SLOW=3` on a slow machine). They never touch a real Spark.
5. Land each step: `node tools/land.mjs <branch>` (affected tests, R29). Before an install, `node test/lock.mjs`
   runs the whole suite; only a pass marks the build tested (`service/workflows.lock.json`). Install with a note of
   what changed: `NOTE='what changed, in plain words' bash deploy/host-on-portal.sh` (no secrets).
6. After installing, check the change the way the owner would use it: through Sparkie's chat or
   `POST /console/api/actions/<name>`. Passing tests don't prove it works on the Sparks.

## I want to …

| I want to … | Card |
|---|---|
| add an action (a tool Sparkie and agents call) | `docs/how/add-an-action.md` |
| add a workflow (a tested, versioned change) | `docs/how/add-a-workflow.md` |
| add a recipe source | `docs/how/add-a-recipe-source.md` |
| add a known start failure and its fix | `docs/how/add-a-known-failure.md` |
| add a read-only check on the Sparks | `docs/how/add-a-read-only-check.md` |
| add a saved workflow (no code) | `docs/how/add-a-saved-workflow.md` |
| run a new kind of workload (an app, a job) | `docs/how/add-a-kind-of-workload.md` |
| add a new way in (a new caller) | `docs/how/add-a-way-in.md` |
| open something through the app door | `docs/how/change-the-app-door.md` |
| add a page route | `docs/how/add-a-page-route.md` |
| add a state file | `docs/how/add-a-state-file.md` |
| add an event type or a job type | `docs/how/add-an-event-or-job-type.md` |
| add a worker.py action | `docs/how/add-a-worker-action.md` |
| fetch something from outside the Sparks | `docs/how/add-an-outbound-connection.md` |
| add a messaging channel | `docs/how/add-a-messaging-channel.md` |
| change what a member may do | `docs/how/add-a-member-permission.md` |
| add an engine | `docs/how/add-an-engine.md` |
| add a self-test check | `docs/how/add-a-hardware-check.md` |
| run the brain eval and keep its result | `docs/how/run-the-brain-eval.md` |
| run something on a Spark through the root helper | `docs/how/call-the-root-helper.md` |
| find out why a model start failed | `docs/how/find-why-a-start-failed.md` |
| find out why a model or app stopped | `docs/how/find-why-something-stopped.md` |
| find out why a change was refused or asked | `docs/how/find-why-a-change-was-refused.md` |
| add a test file | `docs/how/add-a-test-file.md` |
| land a step on main | `docs/how/land-a-step.md` |

No card fits? Search `docs/rules.md`.

## Before you say done

1. Parts edited, not `server.mjs`; each part's name and header fit R28; `node tools/make.mjs --check` passes.
2. A test that fails without the change; no existing test weakened.
3. A new action, page route, caller (`via`) or state file follows its card: Touch, Also update, Never. Anything new
   kept in memory may be lost at a restart.
4. Anything new that changes a Spark goes through `runAction`, a claim, a job and `run`. Don't copy the paths that
   skip them today (R11).
5. Nothing starts on Spark 2; the 8 GB rule holds; no new path touches SSH, Tailscale, the firewall, users or access.
6. Outside text is labelled as data; secrets are masked, including anything new that reaches events or fleet notes.
7. Every function a workflow runs is in its `code()` list (add the ones missing today when touching them); expect
    "needs validation" after install.
8. A new shipped file is in the installer's lists (R30), a new code file in all four build-id lists (R29's Where); a
   change to what the installer reads keeps `test/install.test.mjs` passing.
9. Before an install, `node test/lock.mjs` passed on that exact tree (again after a `worker.py` edit); after it,
    `/health` shows no workflow `untested`.
10. The documents change with the code: the diagram in `docs/architecture.md`, a row in `docs/state.md`, the
    rule's file in `docs/rules/` (its Today, Where and Checked by), a card in `docs/how/`.
