# Spark Console: what else it should do

## 1. Verdict

Spark Console can become the owner's one always-on hub: Sparkie serves models, hosts files and sites, reaches outside services, answers from the phone and runs file-scale jobs, each from one sentence or API call. It is more than a model launcher because every new ability passes through the same typed actions, the same gate that reads only the owner's words, and the same evidence-first choice that model recipes use. Ten designs were attacked; all were ruled build-smaller, none can lock the owner out, and none needs a container, port or download in its smaller form. The 96 ideas reduce to eight building blocks, so a feature becomes an entry in a file. Three things gate the rest: Sparkie's tool cut, the owner's yes to CPU-only containers on Spark 2, and a home for tokens outside chat, backups and install snapshots.

## 2. The feature map

D = designed in depth and attacked. Score = the judges' total, of 15.

|Domain|You could say|Smallest way|Size|Score|
|---|---|---|---|---|
|Connectors (D)|"Open an issue titled X."|MCP client in the console: HTTPS, a token, three fixed tools (connectors-1 with -4)|M|12|
|Hosting (D)|"A link my brother can open for a week."|Console serves a cleaned copy at an expiring link on :8443 (hosting-2 = storage-2); apps later (landscape-1, -2)|M|12|
|Channels (D)|"Tell me here when the download finishes."|Telegram by long polling (channels-1, 11) behind one tell rule (channels-2)|M|13|
|Approach|"Set it up the proven way."|`find_ways` over worked-here, built-ins, NVIDIA playbooks; numbered answers (approach-1, -2)|M|12|
|Landscape (D)|"NVIDIA's tested way to do video search?"|One read tool, a card per playbook (landscape-4)|S|13|
|Knowledge (D)|"What did we decide about the YaRN overlay?"|Scan of chats in memory plus an archive (knowledge-2); documents later (knowledge-1, 11)|S|13|
|Automation|"Every night at 2, run cleanup."|`trigger` and `ask` step on saved workflows (automation-1, -2)|M|12|
|Media|"What's in this photo?"|Upload tray plus the brain's vision (media-1); images later (media-3, 10)|M|12|
|Voice (D)|"Hey Siri, ask Sparkie what's running."|Your Shortcut calling `ask_sparkie`, look-only (voice-1 = channels-3); transcription later (voice-4, 11)|S|13|
|Dev (D)|"How do I point opencode at Sparkie?"|`running_models` gains the brain's numbers; `agent_config` after a recorded trial (dev-3)|S|13|
|Training (D)|"Run these 5,000 prompts through GLM."|`run_batch` inside the console, resumable (training-2); speed leaderboard (training-1, 12)|S|14|
|Agents|"Cap my agent at one request."|Named keys, caps, a usage line at the gateway (agents-4)|S|12|
|Routing (D)|"Will my agents get answers with 3 and 4 off?"|Fallback list in the call (routing-1); wait while loading (routing-2, 13)|S|14|
|Storage|"What is filling the disks?"|`disk_report`; `free_disk` for the console's own leftovers (storage-1)|S|12|
|Secrets|"Add my Hugging Face token."|Passkey-gated form, paste guard, one store (secrets-2, 13; secrets-1, 12)|M|13|
|Insight (D)|"What can you do?"|One read built from the action list (insight-2); history, "why slow" (insight-1, -4, 12)|S|14|

## 3. The ones to build, in order

Prerequisites from the attacks: a full gate and fresh lock (the tree is reported ahead of lock build 4f371d567af6; a stale lock switches every workflow off), Sparkie's tool cut (36 actions today), and a per-key limit on open /v1 requests. Where no owner step is listed, there is none.

**1. "What can you do?" (insight-2), with the tool cut.**
- Build: `what_can_you_do`, no inputs, built from the action list: titles, saved workflows, workflows that are off, counts, ways in, today's "never" sentence, one build-tested example per change action.
- You: the same answer in chat, /mcp and POST /actions, even with Spark 3 and 4 off. It never asks; if no tool fits it says "not yet" and changes nothing.
- Guards: allow-listed fields, counts only; Sparkie's tools go from 36 to 34.

**2. Fallback list (routing-1).**
- Build: in 15-routes.mjs, up to 3 names as `model: "glm,sparkie"` or OpenRouter's `models`, on chat, completions and responses. It moves on only when a model is not running, refuses, gives no connection in 3 seconds or answers 503.
- You: `x-spark-model` says who answered; `running_models` shows a fallback tally. Sparkie asks only "which model first?"; a list never starts anything.
- Guards: unknown names are a 400; at most 2 list calls on the brain; none on embeddings or rerank.
- Only you: paste one line into each agent; one live Codex check before the comma spelling is handed out.

**3. Host a folder, site or file (hosting-2).**
- Build: `host(path, days, public)`, `hosted`, `stop_hosting`. A cleaned copy under ~/spark-hosted at /console/api/h/s/<token>/, 7 days (90 at most). No "only me" mode, drop page or copies from Spark 3 or 4.
- You: a link with its end date; "make it public" adds a readable name. It says what will not work: app builds needing a domain root, networks that block ts.net.
- Asks: it runs at once only when the typed path is in your words. A folder found by name shows one button with path, count and size. Public is always a passkey tap. A secret-scan hit asks.
- Guards: the route never reads identity or cookies; every response carries the sandbox header; token kept as a hash; 5 GB and 5,000 files an item; agent keys may only list and stop; deletes only console-made folders.
- Only you: one check on the iPhone.

**4. Batch over a file or folder (training-2).**
- Build: `run_batch` and `batch` in Node inside the console (no container, Python or socket). JSONL chat rows, a short list, or a folder of text files with one prompt, under ~/spark-data; 8 at once; resume by custom_id.
- You: an estimate after 20 rows, and it keeps going; "pick up reviews" continues a stopped one. It asks when the file or model is not in your words or files cannot be read, and never starts a model.
- Guards: one batch at a time; file text is data, tools stripped; the brain only when named; a model that is down is waited on; a batch never holds up an update.
- Only you: put files on Spark 2 (scp today).

**5. Recall of past chats (knowledge-2).**
- Build: `search_chats`, a scan of chats in memory (no SQLite, no Node upgrade), your words first, 5 dated passages. Separately, at 300 chats the 20 oldest idle ones move to chats-archive.jsonl, read back before they leave.
- You: the answer with its date and chat title; the "delete some chats" stop goes. "Like last time" changes come back as one button.
- Guards: owner only (refused for agents, ask_sparkie, workflow steps); prose only, masked; recalled text is data.

**6. Ask Sparkie from the phone (voice-1 = channels-3).**
- Build: now, no code: your Shortcut calls `ask_sparkie` at the agent door with a look-only key; time ten asks. Later, with Telegram: `POST /console/api/say`, always look-only, caller-set wait (default 25 s).
- You: the Action Button or "Hey Siri, Ask Sparkie". A change request answers "open the chat for that".
- Guards: no changes or remembering at this door; no new key type; only the key's hash kept.
- Only you: make the key with your passkey, build the Shortcut, turn off running when locked; say yes to changing contract section 13 before any `/say` code.

**7. Telegram with the tell rule (channels-2 inside channels-1).**
- Build: Telegram by long polling (channels-1 was not attacked; it needs its own pass) with `tell()` as the only sender: a reply, that thread's own result, its carry-on line, or a watch you asked for. Then `tell_me` and `stop_telling`: operation ends, Spark offline 90 seconds, Spark back, model crashed; once; 24 hours, 7 days at most.
- You: "Tell me here when the download finishes" brings one message. It asks only "which one?"
- Guards: fixed-template result lines (no errors, logs, addresses); plain text, link previews off; "stop telling me about gemma" can never stop gemma; contract 13, 9.16 and 8.12 updated in the same change.
- Only you: make the bot, paste its token on the passkey page, send the pairing code.

**8. Connectors (connectors-1 with connectors-4).**
- Build: about 250 lines, one MCP revision, HTTPS and a token, 10 pinned tools a connector, three tools (`connectors`, `connector_lookup`, `connector_change`). No search, daily re-read, OAuth, stdio, agent keys or workflow steps.
- You: a lookup just answers; Sparkie picks the tool and arguments. Every change is a tapped button showing connector, tool and all arguments; a typed yes does not press it. A lookup after outside text is refused in words unless the server is closed.
- Guards: adding and marking lookups need the passkey; address and token are one unit; the token stays out of the daily copy and install snapshots; a key pasted in chat is masked; a timed-out change is never re-sent.
- Only you: name the first connector, make a read-only token, one check by hand. Only GitHub is confirmed with a plain token; Notion and Home Assistant need OAuth, which waits.

**9. NVIDIA playbooks (landscape-4), with the runner or read_page.**
- Build: one read tool: the 29 playbooks on NVIDIA's DGX Spark page, others marked "not on the current list"; an id fetches one README when asked and returns a card built by code (hardware, prerequisites, time, risk, flags). No command text, state file or bulk fetch.
- You: a cited card. No match returns the whole list, never "NVIDIA has none".
- Guards: playbooks touching Tailscale, SSH or networking return a link and a fixed lock-out warning; the runner takes nothing from playbook text; a tool-choice eval passes first, else it folds into find_recipes.

**10. Settings for your coding agents (dev-3).**
- Build: now, `running_models` adds the brain's live numbers and docs/agent-door.md gets examples marked not tried. `agent_config` waits for a recorded engine trial.
- Guards: never "tried" without a record; no key values; a project-level file; Codex only after a live run.

## 4. How Sparkie chooses and when it asks

- Code picks the approach by evidence: worked here, built-in, NVIDIA's current playbooks. With nothing confirmed, Sparkie says so and does not improvise.
- It goes when the target (path, model, Spark, audience) is in your own words and matches one thing. Lookups always run.
- It asks one question with buttons when none or several match, an audience or model was not said, something would download, or the turn read outside text.
- Tap only, never a typed yes: connector changes and anything public (public also needs the passkey).
- A value you did not say is dropped, not guessed; answers state what was assumed.
- Pages, logs, connector results, files, transcripts and messages are data, never your words. Unattended turns are lookups only.
- The rules are measured on the real brain (approach-5), with hostile-text cases.

## 5. The building blocks

1. **Workload:** any non-model container (service, job, one-call tool) from one spec.
2. **Way:** a confirmed recipe for a workload, with evidence and rank.
3. **Procedure:** a saved workflow with a `trigger` and an `ask` step.
4. **Secret:** a named value the console uses and never shows.
5. **Connector:** an MCP server the console calls; pinned tools.
6. **Channel:** where your words arrive and answers return; one sender.
7. **Door:** an address with an end date: links on :8443, port 10000 for apps.
8. **Files:** one data folder on Spark 2 and one search.

Order: tool cut and fresh lock (the blocks add about 16 actions); Procedure; Files with Door links; Secret; Channel; Connector; Way, then Workload (services before jobs); Door for apps.

## 6. Not worth it, and why

- **Second control planes** (Umbrel, CasaOS, Coolify, Olares, Kubernetes): their own proxy and logins, ports 80 and 443 or the Docker socket.
- **Second brains** (OpenClaw, Hermes Agent, n8n as automation-6, Dify): a second memory, rule set and credential store.
- **Gateways and vaults** (Docker MCP Gateway, LiteLLM, llama-swap, Vault): a server for what a few lines or one file do.
- **Channels:** iMessage needs an always-on Mac; Twilio (channels-6) is paid and least private; Signal (channels-5) needs a spare number and a JVM.
- **A custom domain or Tailscale Services:** an outside account, or tagging Spark 2, a lock-out risk.
- **Vector databases, knowledge graphs, Syncthing (knowledge-6):** keyword search first.
- **OAuth (connectors-5, -6):** until a wanted connector refuses a token.
- **Over-built for one owner:** agents-3, secrets-4, secrets-6, dev-5, approach-6, routing-6, hosting-6, voice-6; hosting-1 loses to landscape-2.
- **Deferred until services and CPU jobs are proven:** training-3 to -6, dev-1, -2, -4, agents-1, -5, -6, media-6.
- **Cut by the attacks:** a Python container for batch, an SQLite index for recall, "only me" hosting, the drop page, a daily re-read, a door-limited phone key, changes by voice.

## 7. Decisions only the owner can make

1. **Messaging channel first.** Recommend the Shortcut trial now, then Telegram; iMessage only if a Mac joins the fleet.
2. **Contract section 13** (push and voice not wanted). Recommend allowing dictated input and messages you asked for on your own channel.
3. **Results to a channel.** Recommend yes for replies, results of work started in that thread and watches you asked for, as one-line templates; Telegram can read them.
4. **Public or private hosting.** Recommend expiring unguessable links by default; public only by passkey tap with an end date; no custom domain now.
5. **Where secrets live.** Recommend one 0600 file outside the state folder (so outside the daily copy and install snapshots), typed only on the passkey page, never your password. Seal it only if backups go off-site.
6. **CPU-only containers on Spark 2** (AGENTS.md forbids them). Recommend yes, within 12 GB checked before each start; those proposed total about 27 GB against 20 free.
7. **First connector.** Recommend GitHub, read-only token, if you keep code there.
8. **Phone key.** Recommend look-only.
9. **Fine-tuning, usage reports, separate backups.** Recommend they stay not wanted.
10. **Work data at home.** Your check of NVIDIA's rules comes first.

## 8. Domains nobody covered

A real web address (own domain; networks that block ts.net). Work versus home. Research as a job. Model conversion and quantizing. Media pipelines. Local caches. Patching hosted images, DGX OS and firmware. One exposure report and one shared fence for everything hosted. Emergency controls that work without the brain. A hostile-text test set. Privacy and retention. Tracing for your agents. Reminders and to-dos. NVIDIA NIM as a source of ways. Personal libraries (photos, paper, cameras). Power and hardware health. Public demos that use the models, a guest pass, a browser Sparkie drives, starter bundles.

### Critical Files for Implementation
- /Users/akuppala/Documents/26aiRAG/spark-console/service/src/16-actions.mjs
- /Users/akuppala/Documents/26aiRAG/spark-console/service/src/14-chats.mjs
- /Users/akuppala/Documents/26aiRAG/spark-console/service/src/15-routes.mjs
- /Users/akuppala/Documents/26aiRAG/spark-console/service/src/24-handler.mjs
- /Users/akuppala/Documents/26aiRAG/spark-console/service/src/18-workflows.mjs
