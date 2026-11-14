# Agents: using the fleet without opening the page

Your own AI agents (Claude Code, Cursor, anything that speaks MCP) and the `spark` terminal command use Spark Console
through one address, the **agent door**:

```
https://akspark2.tailab9aa9.ts.net:8443/console/api/mcp
```

Two ways in, through the same door:

- **Talk with Sparkie** (`ask_sparkie`, or `spark ask "…"`): plain words in, a colleague's answer out. Sparkie looks
  things up with its own tools, and starts, stops or restarts models if the agent may change things. This is "my agent
  talks to the Sparks' agent".
- **Call actions directly**: everything the console can do is one list of named **actions** with typed inputs. The page,
  Sparkie and outside agents use the same list under the same checks. Some look things up; the others change
  things (starting, stopping and restarting models among them), for agents you allow (below).

Commands on the Sparks come later (see [history/sparkie-actions.md](history/sparkie-actions.md)).

## Talking with Sparkie

```bash
spark ask "what's running, and is anything idle?"
spark ask --conversation sc_… "start the best coding model that fits"
spark ask --conversation sc_… --choice <id>        # take a change Sparkie offered
```

Over MCP it's the `ask_sparkie` tool: `{message}` starts a conversation, `{conversation, message}` continues it,
`{conversation}` waits for an answer that took longer than 40 seconds (status `thinking`) or reads results posted since,
and `{conversation, choice}` takes one of the `choices` Sparkie offered (only agents allowed to change things). Each
agent has its own conversations; you see them in Sparkie's list, marked with the agent's name, and can join in.
Operations Sparkie starts post their result into the conversation when they finish.

## Connect an agent

1. In Spark Console open **Access → Agents → Connect an agent**, name it after the tool and computer ("Claude Code on
   my MacBook"), and tick **Can start and stop models** if it should.
2. Copy what the dialog shows. The key is shown once; the console keeps only its fingerprint.
   - **Claude Code** (once, in a terminal):
     ```bash
     claude mcp add --transport http --scope user sparks https://akspark2.tailab9aa9.ts.net:8443/console/api/mcp --header "Authorization: Bearer <key>"
     ```
     Then ask Claude Code things like "ask Sparkie what's running" or "where would gpt-oss-120b fit?".
   - **Any other MCP client:** the address above, with the header `Authorization: Bearer <key>`.
3. Remove an agent on the same panel; its key stops working at once and the others keep working.

A new key works from your own devices on Tailscale, signed in as you (the owner). To use it from anywhere without
Tailscale (Claude on the web, the phone apps, a computer off your tailnet), turn on **Works from anywhere** for that
agent under Agents; then the key alone is enough, so anyone who has it can use it: keep it in a password manager or
the app's own settings, never in a shell profile or a shared file. Keys made before 2026-11-11 work from anywhere
until you turn that off.

## The `spark` command

`tools/spark.mjs` is a small terminal client for the same actions (Node.js 18+). Install it once:

```bash
mkdir -p ~/.local/bin && ln -sf ~/Documents/26aiRAG/spark-console/tools/spark.mjs ~/.local/bin/spark && chmod +x ~/Documents/26aiRAG/spark-console/tools/spark.mjs
```

```bash
spark setup
```

`spark setup` asks for the key (it doesn't show as you paste) and saves it in `~/.config/spark-console/agent.json`, readable
only by you. Then:

```bash
spark                                          # every action and what it takes
spark fleet_status
spark where_it_fits gpt-oss-120b               # values fill the required arguments in order
spark cluster_plan --model gpt-oss-120b --sparks spark3+spark4
spark find_recipes --query "qwen coder" --limit 3 --json
```

New actions show up in `spark` and in every agent automatically; nothing to update on the Mac.

## What agents can do today (all read-only)

| Action | Use it for |
|---|---|
| `fleet_status` | “Is everything OK, does anything need me, how busy is it?” `needsOwner`: what is waiting on the owner, in plain words (an empty list means nothing). Each Spark: online, GPU use, memory and disk in GB, temperature, power, issues |
| `workloads` | “What runs (or ran) on the Sparks, and how was it started?” Every container the console has seen — models, services, Sparkie, anything started by hand — with image, ports, GPU, served models, start/stop/crash, recipe candidates; `detail` adds the command (secrets hidden), mounts and environment variable names; on a Spark that is off or not answering, rows say `running: false`, `state: "unknown (Spark off or not answering)"` and `lastSeenRunning: true` |
| `fleet_events` | “What happened while I was away?” Started, stopped, crashed (exit code, out of memory), removed, Sparks offline/online, model servers learned, the console's own operations |
| `running_models` | “What models are running and how do I call them?” Each server's `callWith` (base URL and exact model name), Sparkie's model, servers started by hand, other containers |
| `models_on_disk` | Downloaded models across all Sparks, with the `modelId` other actions take |
| `find_recipes`, `recipe_detail` | “What’s a good model for X that fits?” Filters by category, memory and Sparks; setups best first |
| `search_huggingface` | Any model by name, when it isn't a recipe yet (6 a minute) |
| `where_it_fits` | “Where can I run X?” `canRun`, `fitsNow`, what would stop, blockers; an estimate for models not downloaded yet |
| `deploy_plan`, `cluster_plan` | Dry runs, changing nothing: exactly what deploying on one Spark, or across two linked Sparks, would do |
| `linked_sparks` | Which Sparks can run a model together (the last cable test) |
| `spark_detail`, `spark_diagnostics` | One Spark right now; health checks, or why it's unreachable |
| `recent_operations`, `operation_log` | The console's own operations and their logs |
| `container_logs`, `service_logs` | The newest lines of any container's log; the console's, Sparkie's or the editor's log |
| `sparkie_setup` | Sparkie's model and which model answers chats and apps; Spark Console's build, its own recent errors, its last crash and the watchdog's restarts. With `about: "abilities"`: what Sparkie can look up and change (every action's title) and its limits. Who is signed in and the recovery codes left come only on the owner's own call, never to an agent |
| `files` | “What’s in my shared folder on Spark 3?” The files and folders in one Spark's shared folder, or one text file there (the first 8,000 characters, with keys hidden: known token formats, private keys, settings like `SECRET_KEY=<random>`, a password in an address; plain words never); hidden files, links and key files are never opened. A Spark with no shared folder yet says so (a look never makes one); more than two file operations at once answers `[busy, retry later]`, saying to try again |

Model arguments take a library name, a Hugging Face repo or a recipe id; Spark arguments take `spark3`, “Spark 3” or `3`.
Errors start with a code (`[not_found]`, `[invalid]`, `[unreachable, retry later]`, …) and name the valid choices.

## Actions that change things

| Action | What it does |
|---|---|
| `start_model` | Starts a model you name any way (library name, repo, recipe id, or words like “qwen coder”): finds it, downloads it first if needed, picks a Spark or two linked Sparks with room, starts it with the best setup known, checks it answers. A Hugging Face repo that isn't in Recipes joins them after its download, and its setups (its own model card's too) are looked up before it starts. Asked again for a model already running where you name it, it answers `already` |
| `stop_model` | Stops one of Spark Console's models (both parts of a two-Spark model) |
| `restart_model` | Starts one of Spark Console's stopped or crashed models again |
| `keep_running` | Keeps an app that isn't a model (Open WebUI, a database) running: one already on a Spark joins the list of what should be running and comes back after a crash or a power cycle; `do` restart or stop; with `image` and `port`, starts a new one (a memory cap, named volumes, opened on your tailnet only); `gpu` gives it the Spark's GPU (with `memoryGB`; only where no model or other GPU app runs), `command` the words it runs, and `once` makes a job that runs to its end, needs no port, writes into `jobs/<name>` in the shared folder and is told in the chat when it ends. From an agent (or Telegram), a new image, keeping, restarting or stopping a container Spark Console didn't start, running a job again, or starting a stopped app that uses the GPU is a question only the owner answers. Up means it keeps running; a link is given when it answers web requests (a database is up without one). A name that's there with another image, port, volumes or settings is refused (`[conflict]`, saying what differs); a port Docker doesn't publish for it, or above 65535, is refused; a stopped one starts only within its own memory limit (or a `memoryGB` you give when it has none); a stop while its Spark is off takes it off the list (`forgotten`). Never on Spark 2, never a model (by its image, Spark Console's model label or what the watcher saw), never by the start of a container's id |
| `save_file` | Saves one new text file (at most 64 KB) in a Spark's shared folder; never replaces a file that's there, never makes a folder, never writes a hidden file or text holding a key shape (a known token format, a private key, `SECRET_KEY=<random>`, a password in an address: plain notes and code are fine). The name has no invisible or direction-changing characters |
| `wait_operation` | Follows an operation (reads only) |

**Who can:** Sparkie, in your chats and in conversations with agents you allowed. Your agents, once you turn on **Can
change things** for that agent (Access → Agents); new agents can only look. A start already under way for the same
model returns that operation (`already-starting`) instead of starting a second copy; a change that takes over 50
seconds answers `[still_running]` (don't call it again; check `recent_operations`).

**Checked inside, every time:** a fresh plan; only Spark Console's own containers stop (anything else is a question for
you), never a model running across two Sparks as a side effect, never Sparkie's model or protected containers
(`qwen-recipe-*`); 8 GB of memory always stays free, measured after the stops, so a Spark can't freeze; Spark 2 (where
Sparkie and the console run) is only used when you name it; two Sparks need a cable that passed the connection test;
models that run their own code, or whose `spark.json` sets unsafe flags, environment or an unpinned image, are refused
(you can start those on the page); only models from your recipes run across two Sparks (those parts run with more
privileges); a Hugging Face repo outside your recipes is a question first; a memory share written into a setup or a
past run never exceeds the measured safe one; one change per Spark
at a time; the plan is made again just before it runs and must match; pausing agents stops work already under way at
its next step; it has to answer before it counts; if it fails, what it stopped is started again.

**Questions only when it's truly unclear:** a name that matches several models, room that needs stopping something
Spark Console didn't start, or a repo outside your recipes. The choices are kept by Spark Console, for whoever asked,
and used once; an outside agent answers with the choice's id. A question only the owner can answer, asked of a direct
call (a tool call, `POST /actions`), comes back with no choice ids (`choice: null`): its note says the owner asks
Sparkie for it in their own chat (or does it on the page) and presses the button there. Through `ask_sparkie` the
button waits in that conversation in Spark Console.

**Sparkie runs a change straight away when it's clearly what you asked:** your message asks for that kind of change
(a request, "can you start gemma?" included; not a question like "can gemma run on Spark 3?", "if …", or "should I
stop it?"), the model and Sparks are the ones in your words ("stop everything on Spark 4" covers Spark Console's models
there), and Sparkie hasn't read logs or web pages in that reply. Anything else — "start the best coding model that
fits", a restart it suggests after reading a log — comes back as a **button** under its answer, built from the real
plan; pressing it (or replying just "yes") runs exactly that. The model never handles the buttons' ids, so text in a log
or a web page can't start or stop anything. "Don't stop …", "without stopping anything" or "keep gemma running" rule
stopping out (from your previous message too; "keep Open WebUI running" that `keep_running` answered is about that app,
and doesn't carry over); a start that would stop something always asks first, naming it. A file is saved at once only
when your message names the Spark and the whole file name as one word. An app runs at once only when your words name
it and the Spark; a new image, its port, volumes and settings must be typed as whole words.
Results of what it starts are posted in the conversation when they finish.

**Your switches** (Access → Agents): **Pause agents’ changes** stops every change at once (Sparkie's too; looking
still works; your own clicks always go through). Agents also pause themselves after 12 changes in an hour or three
of their operations failing within an hour, with a note in Activity; resuming that needs no passkey. **Restart crashed models automatically** (on by default): one of Spark
Console's models that crashes is started again if there's room, at most twice an hour (counted across restarts);
never one Spark Console stopped on purpose, one that ran out of memory, one that stopped within 10 minutes of starting,
one on a Spark that lost power or was offline in the last half hour, or anything on Spark 2.

**Never, for anyone:** SSH, Tailscale, firewall and network, users, keys and sudo, people and access, turning Spark
Console off. Every change is recorded in Activity (who, your words), `audit.jsonl` and `fleet_events`.

## What the console sees and learns

Every minute it looks at every container on every Spark and remembers how each was started (image, command with
secrets hidden, ports, mounts, GPU, environment variable names — never their values). Changes become events. A model
server someone starts by hand, from an image source the console trusts and with flags that pass the recipe checks, is
kept as a recipe candidate (`workloads` shows it as `recipeCandidate`); it becomes one-click only once you approve it,
since anyone who can start a container could otherwise create one. Everything else is still remembered and listed. Sparkie's chats include the same
record, so when you ask Sparkie about the fleet it knows what's running and what just happened. Files:
`knowledge.json` and `events.jsonl` in `~/.local/state/spark-console` on Spark 2.

## Rails

- **Owner only, per agent:** on the tailnet a key works only with the owner's Tailscale identity; from the internet
  only if the owner turned on **Works from anywhere** for it. Each agent has its own key, so you can see what each one
  last did (and from where) and remove one alone. Only a fingerprint of each key is stored.
- **Never from the Sparks:** programs on the Sparks (a model container, a script) are refused, since Tailscale signs
  them in as you.
- **Not from web pages:** the door only takes JSON from tools, and refuses pages on other sites.
- **Secrets hidden:** Hugging Face, NVIDIA, GitHub, Tailscale, OpenAI-style, AWS and console keys, tokens, JWTs and
  private keys are replaced with `[hidden]` in everything sent out.
- **Logs are data:** log text is marked as text from programs, never instructions.
- **Typed inputs:** every argument is checked against the action's schema before anything runs; unknown arguments
  are refused.
- **Limits:** 120 requests a minute and 3 at once per agent; web searches 6 a minute; every answer within 50 seconds.
- **Audit:** every agent call is a line in `audit.jsonl` (who, action, arguments with secrets hidden, result, time).
- **Your passkey:** creating an agent key, letting an agent change things and resuming paused agents need your passkey
  (see [sharing.md](sharing.md)); removing an agent or pausing never does.
- **Your Claude Code stays careful:** keep its permission prompts on, so a prompt-injected agent can't reach the console
  another way (a shell `curl` runs as you).

## Under the hood

- MCP over HTTP (Streamable HTTP, JSON responses, stateless): `initialize`, `tools/list`, `tools/call`, `ping`.
- Keys: `~/.local/state/spark-console/agents.json` on Spark 2 (fingerprints, names, last use).
- The action list: `ACTIONS` in `service/server.mjs`; `GET /console/api/actions` lists it (owner), each action with
  its group (R46). Sparkie is offered a few groups a round; an agent sees every action, and is told to call `guide` first.
