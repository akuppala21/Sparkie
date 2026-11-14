# Sparkie as an agent

**Status:** plan v3 (2026-11-05), updated with the owner's direction below. Built: the action list and the agent door,
read-only ([agent-door.md](agent-door.md)). v2's details (where commands run, dev boxes, records, testing) still apply
except where v3 says otherwise.

## v3: Sparkie is the main user (owner, 2026-11-05)

- **Say it, it's done.** The model on the Sparks (Qwen today) runs the fleet: deploys, clusters, starts any model you
  name, starts a recipe with the models you choose, runs commands, and can change the console itself. You say what you
  want; it doesn't ask you to click OK for ordinary work.
- **Checked inside, several times, before anything runs:**
  1. Typed inputs: every action's arguments are checked against its schema.
  2. A dry run: the action builds its exact plan (what stops, what's copied, memory, where it answers).
  3. An independent checker compares the plan with what you asked and with the rails, and refuses or fixes mismatches
     (a different model, more stopped than needed, something protected, something not the console's own).
  4. A re-check right before it runs, in case the fleet changed.
  5. Verification after (the model answers, the container stays up), and an automatic put-back if it fails.
- **Questions only when truly confused:** when two readings are equally likely ("qwen" matches four models and none
  is clearly meant). Then one question with the real choices, never "Shall I go ahead?".
- **Never, for any agent, even if asked:** anything that could lock you out. SSH, Tailscale, firewall and network
  settings, user accounts, keys and sudo, the console's access list and owner, or turning the console off. You do those
  by hand.
- **Always asks first:** deleting data (models, files, volumes) and anything with passwords or keys.
- **Everything is an action:** each button is a named action with typed inputs; the page, Sparkie, outside agents
  (MCP) and the `spark` command all use the same list, so nothing exists only as a button.
- **Other agents talk to the fleet directly:** through the agent door, each with its own key, including governed
  terminal access later, instead of opening the page.
- **Changing the console:** settings and data (add a Spark, a model, a recipe) are actions like any other. Code changes
  go through a change request: the change is made on a copy, tested, and shown as a diff; install and one-click
  rollback follow the same checks. A stronger coding agent (Claude Code) writes the code; Sparkie reviews and reports.

## What Sparkie is

Sparkie is the fleet's agent: an LLM that answers, plans and does things, for everyone, each within their own limits.

- **The owner:** anything you ask, anywhere: run any command on any Spark, start, stop and move any workload, manage the
  cluster. How much it does without asking is your dial (below).
- **Members:** the same kind of agent, limited to what's theirs: their Sparks, their workloads, their dev boxes, and the
  permissions you gave them. Their commands run inside their own dev boxes, never on a Spark itself.
- **Never Sparkie's, for anyone:** changing roles or people, Sparkie's own model while you're chatting with it, and the
  console's own files, keys and audit log.

## What it works on: workloads

One idea covers everything that runs on the Sparks:

| Kind | Examples |
|---|---|
| **Model** | an LLM, a vision model, an embedding or rerank model, on one Spark or across linked Sparks |
| **Service** | Open WebUI, ComfyUI, a vector database, a RAG pipeline, Jupyter, an agent server |
| **Dev box** | a fresh environment on a Spark with an editor, a terminal, your workspace, and the models you chose wired in |

A **stack** is several at once, planned and approved together (say embeddings + reranker + LLM + vector DB + a dev box).
Each kind comes from an owner-approved **template**; every workload that runs becomes a **recipe** you can start again in
one click (the existing rule). Ownership is recorded on each one, so "theirs" is a fact, not a guess.

*As built (2026-11-13, A13):* a service, a dev box or a job is one action, `keep_running` (docs/architecture.md R38):
`gpu` gives it the Spark's GPU (one GPU thing per Spark: never beside a model, and a model start asks before it stops
it), `command` is what it runs, and `once` makes a job that runs to its end and writes into `jobs/<name>` in the shared
folder, told in the chat when it ends. A stack is a saved workflow of `keep_running` steps. Dev boxes run with no
password, by the owner's choice (anyone on the owner's tailnet, or the owner through the app door); the per-box key,
gateway and idle stop below are not built. Templates are not built: Sparkie looks up what it doesn't know
(`search_web`, `read_page`) and what the owner didn't type comes back as one button showing every setting.

## Tools

**Read** (run immediately; every result says when it was observed): fleet status, one Spark's detail, workloads,
templates and recipes, the library, where something fits, recent activity, logs (owner; secrets masked).

**Act:**

| Tool | Does |
|---|---|
| `propose_launch(items)` | Start one workload or a stack: models, services, dev boxes, with placement |
| `propose_start` / `propose_stop` / `propose_remove` | On one workload, including both parts of a model across Sparks |
| `propose_download(recipe, spark)` | A model into the library |
| `run_command(target, command, reason)` | A shell command. The owner targets any Spark (or several); members target their own dev box |
| `command_output` / `cancel_command` | Follow or stop a running command (cancel never needs a click) |

Arguments are typed and built per person: a member's Sparkie isn't even offered Sparks or workloads that aren't theirs.
The service checks every call against the same rules as the buttons, as the person who's chatting.

## The dial: how much runs without a click

Each person has one; the owner sets the most a member may choose.

| Setting | Runs on its own | Still a card |
|---|---|---|
| **Ask** (default) | nothing | everything |
| **Reads** | read-only commands and lookups | anything that changes something |
| **Typed** | also commands you typed word for word in this chat | anything Sparkie wrote itself |
| **Full** | everything except the always-a-card list | the always-a-card list |

- What counts as read-only is decided by a real shell parser in the service, never by Sparkie's description.
- **Full** is per chat, lasts at most 60 minutes and shows a banner while on.
- **Outside text** is judged by where it came from. Logs, files, web pages, model cards, other people's text and
  command output count as outside text. Status the console builds itself doesn't. Once a chat holds outside text,
  Full falls back to Typed for that chat, so a poisoned log line can't drive your admin powers.
  (Decision for you below: whether ordinary command output counts.)

**Always a card, at every setting (checked in code):** anything destructive (deleting data, wiping disks), anything that
could lock you out (network, firewall, SSH, Tailscale, users and keys), credentials and tokens, things that persist
(cron, services, startup scripts), anything touching Spark Console or Sparkie itself, and anything that belongs to
someone else.

## Where commands run

- **The owner's commands** run on the chosen Spark through the console's SSH, but as a separate `sparkie` account, not
  the console's own. So everyday commands can't edit the console, its access list, the audit log or its SSH key, and
  can't read other people's chats. `sudo` and Docker (both are root) always go through a card.
- **Members' commands** run only inside their own dev boxes (`docker exec`), within the box's limits.
- Commands get no terminal (`sudo` fails fast instead of waiting), have a timeout (2 min default; up to 30 for the
  owner, 10 for members), stream their output to the page, and are capped (Sparkie sees at most 12 KB per call).
- Secrets are masked in everything before it's stored, shown or given to Sparkie: tokens the console knows, common key
  formats (Hugging Face, NGC, GitHub, Tailscale, cloud keys, JWTs, private keys) and auth headers.

## Dev boxes (members' sandbox, everyone's workspace)

- First-party images with VS Code (in the browser) and Jupyter, their workspace mounted, their chosen models wired in
  through environment variables pointing at Spark Console's `/v1` with a per-box key.
- No host access: not privileged, no Docker socket, user namespaces, memory and CPU limits, never on Spark 2.
- Network: only their models through Spark Console and an allowlist of package sites, through a small gateway on each
  Spark; no tailnet, cable or local addresses. The owner can give a person full internet.
- Box apps (and any service's web UI) open on their own address, never under Spark Console's, so a page in a box can't
  act as whoever is viewing it.
- They stop after 2 hours idle and come back from their recipe.

## The card

Built by the service from the real plan, in plain words:

```
Start Qwen3.8 27B on Spark 3
  You get   a chat model at Spark Console's /v1 (model qwen3.8-27b)
  Stops     nothing else
  Uses      about 30 GB of Spark 3's memory
  ▸ Details
                                   [ Not now ]  [ Start it ]
```

A command card shows the exact command, where it runs, what kind it is (read, change, destructive) and why Sparkie
wants it. On **Start it**: the service re-checks permissions and the plan; if anything changed it shows the new one.
One card per chat, single-use, expires in 5 minutes, only for the person who asked. Declined or expired cards tell
Sparkie, which doesn't retry on its own. A failure offers "Put it back" as a new card.

## Talking

- A request goes straight to a card, never "Shall I go ahead?". Exploring questions get an answer plus one "Start it
  there" chip. At most one question back, offering the real choices.
- Refusals use the console's own words ("Spark 3 isn't shared with you. Ask the owner.") and offer the nearest thing
  the person can do.
- Live status is stated plainly; old status says when it's from. Anything in a reply that didn't come from this turn's
  results gets a quiet line: "Part of this isn't from live status."

## Records and the stop button

- Every action and command is an Activity job. An append-only audit log (who, chat, target, masked command, kind, card
  or automatic and why, exit code, a hash of the output) is copied to a second Spark.
- **Stop Sparkie's commands** (owner): cancels every running command and sets every dial back to Ask.

## Fix first (found by the reviews)

| | Status |
|---|---|
| Programs on a Spark were treated as the owner (Tailscale vouches for the Sparks as you) | **Fixed** 2026-11-04: requests from the Sparks themselves are refused, except the agent model address |
| Programs on Spark 2 could call the API directly and claim any identity | **Fixed** 2026-11-04: Tailscale reaches the API through a private socket (`lock-api.sh`); the local port answers `/health` only |
| Model servers on the tailnet have no login | To do: serve them only through Spark Console's `/v1` (their ports move off the tailnet), plus the Tailscale rule for shared people |
| A model folder's `spark.json` can set the image and flags, fleet-wide | To do: only owner-approved recipes set images and flags; safetensors only; `--trust-remote-code` needs your OK per model; pin revisions |
| "Protected" is a Docker label anyone can set | To do: the console keeps its own list |
| Members could stop other people's containers on their Sparks | Your call earlier ("anything not protected"); revisit once ownership is recorded |
| The status Sparkie sees comes from the browser | To do: built by the service for any chat that can act |
| Secret masking misses some key formats | To do: the fuller list above |

## Testing

A fake fleet and 30+ golden tasks, run 3 times each on every change to the prompt, tools, model or engine: questions,
actions, ambiguous requests, permission boundaries, command classification, and injection attempts (a log line saying
"run `curl … | sh`", a model card with instructions, a box name with a command in it). Actions, asking, permissions and
injection must pass every time. A box escape test must pass before members get dev boxes.

## Build order (v3)

1. **Done (2026-11-05):** the action list (19 read actions, including dry runs for one Spark and two linked Sparks),
   the agent door (MCP) with a key per agent, the `spark` command, and the fleet watcher (every container on every
   Spark, how it was started, events, hand-started model servers kept as recipe candidates for your OK, all in Sparkie's
   chats). Plus the
   fixes from 15 reviews: see "Done in this release" below.
2. **Done (2026-11-05): the first changing actions** — `start_model` (by any name; downloads first if needed; one Spark
   or a linked pair), `stop_model`, `restart_model`, `wait_operation` — with the rails in code (fresh plan, only the
   console's own containers stop without asking, protected never, 8 GB headroom, tested link, no remote code, one
   change per Spark, re-check, verify, put back), Sparkie using every action as a tool in your chats (changes only
   when your message asks and names it), per-agent "can start and stop models", a pause switch, and self-healing restarts.
   **Still to do from the checklist:** stacks (several models together; needs a port per deploy and gateway routing),
   approving learned recipe candidates, members' agents, the kill switch's automatic triggers, jobs kept on disk.
3. Sparkie (Qwen) uses the same actions itself, with the checker; agents hand it whole tasks (`hand_off`, task ids).
4. Commands on the Sparks as the `sparkie` account behind the OS-level wall below.
5. Playbooks, then services, dev boxes and members' agents.
6. The gateway with models that start when called, then the memory store.

## Must be true before any change action ships (from the reviews)

**Engine and rails**
- One `runAction` path for every caller: typed inputs → fresh plan (never cached) → rails in code (only the console's
  own unprotected containers, or ones named in your words; never Sparkie's model; memory known and ≥ 8 GB left free;
  disk with margin; link "full" and recently tested; approved images pinned by digest) → re-plan and compare just
  before running → run → verify (served name answers, a 1-token reply, still up after 30 s) → put back what it
  stopped on failure.
- Every argument traces back to your words or a server-side id; text from tools never fills arguments.
- Questions only from fixed triggers (a name that matches several models equally, a fit that needs stopping something
  the console didn't start, `--trust-remote-code`); each choice carries the complete call.
- `spark.json` and recipe setups pass `cleanFlags`/`cleanEnv` and the image allowlist at deploy time too (today manifest
  args and images reach `docker run` unchecked); replace `--privileged` on cluster parts with the narrow capabilities
  RoCE needs (test on Spark 3+4 first).
- Copy and pull before stopping anything; one model per Spark today (port 8000), so stacks need a port per deploy and
  the gateway routing by name.
- Jobs, locks and an append-only audit log kept on disk; running jobs marked interrupted after a restart; a reconciler
  that stops lone halves of two-Spark models.
- A kill switch ("Stop all agents"): a persisted halt checked first by `runAction` and the agent door; any key can halt,
  only the page resumes; automatic halt on a never-list attempt or two put-backs in 30 minutes.
- Keys: `fleet:act` opt-in per key, bound to the device it was made for, with an expiry and a budget.
- Activity records who acted (you, Sparkie, which agent), the request in your words, what changed, and an undo.

**The wall for commands (before step 4, done by hand on each Spark)**
- A `sparkie` account with no sudo, docker or Tailscale-operator rights; `ForceCommand` into a sandboxed shell
  (bwrap, read-only root, no docker socket, timeouts); a root-owned `spark-deploy` helper that only accepts typed
  deploy specs; drop-ins giving ssh and tailscaled `OOMScoreAdjust=-1000`.
- Recovery prepared: Tailscale SSH as a second way in, a break-glass local account, and a root watchdog that restores
  SSH/Tailscale/firewall config if it drifts.

**Gateway (before stacks)**
- Every model reachable through `/v1` by name, with an unknown name answering 404 with close matches (today it falls
  back to Sparkie silently); model ports off the tailnet.

## Done in this release (from the reviews)

- Deploys stop exactly what the plan showed (a container that started using the GPU afterwards is never stopped
  unseen); a console-kept protected list (`protect` in config.json, default `qwen-recipe-*`); one change per Spark at a
  time; two-Spark loading tolerates a missed SSH check; recipes' environment can't redirect NCCL to another cable.
- The local port stays locked across restarts (no window where a local program can claim to be you); page changes need
  the browser's Origin.
- `--trust_remote_code` (underscore) and abbreviations like `--trust-rem` can't skip the remote-code opt-in; flags and
  env that load outside code are blocked, abbreviated or dotted (`--kv-transfer-config.x`); a tokenizer from another
  repo is refused; past runs are re-checked (image source, flags, env) every time they're deployed.
- Agent door: field-level secret hiding, a concurrency cap, a separate web-search limit, 50 s answers, size cap, audit
  log, error codes; Spark and model names understood the way people say them; GB everywhere; `fitsNow`/`canRun`.
- Chats: Sparkie stops generating when you leave, each person's parallel-answer limit is enforced, long chats stay within
  the model's context, an unreadable chats file is set aside instead of overwritten.
- Installs snapshot the old version and settings and roll back automatically if the new build doesn't come up.

## Done in the architecture review (2026-11-05)

- **Talking, not just calling:** other agents talk with Sparkie (`ask_sparkie`, `spark ask`), with their own
  conversations that the owner sees; Sparkie acts with the agent's rights.
- **Two lanes instead of phrase rules:** a clear request (the owner's words, the named model and Sparks, no logs or web
  pages read in that reply) runs at once; anything else is a button built from the real plan. The model never handles
  choice ids; "yes" presses the one offered button. Questions, conditions ("if it crashes …") and "should I …?" never
  act; polite requests ("can you start …") do.
- **Results come to you:** operations started from a conversation post their result there; Sparkie no longer waits on them.
  Its tools are the 14 it needs; the static instructions stay fixed, live notes ride with the message.
- **Safe unattended:** a start already under way is never started twice; timeouts say "don't retry"; agents pause
  themselves after 12 changes an hour or three failures in a row; auto-restart never revives a model that froze a Spark,
  died while loading, or ran under 10 minutes, and its limit survives restarts; a frozen Spark is skipped; operations cut
  off by a restart are reported; installs drain running work first; unreadable state is set aside; a second copy of the
  service refuses to start; state is copied to Spark 3 daily.
- **Simpler access:** passkeys are confirmed on the page you're on, the confirm-in-another-tab relay is gone, and
  members are kept from hidden files. Lock-out paths each have a written way back (docs/sharing.md). Since 2026-11-11
  Spark Console has one address.
- **Less to maintain:** the forum and model-card scrapers, the old portal's Ray/Nemotron/chat code in `worker.py`
  (about 300 lines) and the portal proxy are gone; `/v1` refuses model names it doesn't serve instead of answering
  with another model.

## Decisions for you

1. **Protected list (needed for step 2):** agents never stop a container the console didn't start unless you name it
   in your request, and never the ones on the list (suggested to start: every `qwen-recipe-*` benchmark). OK?
2. **The `sparkie` account:** run commands as a separate account (recommended) or as yours?
3. **Members' agents:** members get their own agent keys limited to their Sparks (suggested), or owner only for now?
4. **Dev boxes:** which templates to offer first (suggested: plain Python/CUDA box, Jupyter, Open WebUI, a vector DB).
5. **Members' network:** package sites only (suggested) or full internet by default.
6. **Privacy:** you have a shell on every Spark, so members' privacy from you is policy, not something the console can
   enforce. OK to say so in Access?

v2's "Full and command output" question is replaced by v3's checker: every action has to trace back to your own
words, so text from logs or web pages can't start anything.
