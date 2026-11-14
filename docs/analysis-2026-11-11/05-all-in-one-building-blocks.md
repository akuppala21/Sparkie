# Spark Console: eight building blocks

**Rule for every block:** one state file, one small part in `service/src`, at most three fixed actions through `action()`. A new feature is an entry in the file. Lists go into one shared read (insight-2), never a tool per entry: Sparkie carries 36 tools and the reviews want about 20.

## 1. Workload
Anything in a container that is not a model: a service (kept up), a job (runs to exit), or a tool (starts for one call).
- **Fields:** id, kind, image@digest, command, spark, gpu, memory/CPU cap, port on 127.0.0.1, data folder, network (none | gateway | allowlist), secrets by name, check (HTTP or exit code), idle stop.
- **Actions:** `run_workload`, `stop_workload`, `keep_running` (adopt).
- **Exists:** `dockerRunCommand` (05-library.mjs:355), `runJob` (07-jobs.mjs), should-run and healing (20-desired.mjs, 20-heal.mjs), the watcher's container record. In the way: `notBrainsSpark` (17-changes.mjs:388) and `desiredAfter` keep everything off Spark 2; needs the owner's yes to a CPU-only budget there.
- **Unlocks:** landscape-1, landscape-3, hosting-3, hosting-4, routing-4, voice-4, knowledge-3, knowledge-6, media-3, media-5, media-6, dev-2, dev-4, dev-6, storage-3, storage-6, training-6.

## 2. Way
A confirmed recipe for a workload, with its evidence: the model recipe made general.
- **Fields:** goal words, source and link at a commit, rank (worked here, built-in, NVIDIA playbook, one app catalog, Docker Official, owner's hand-run), workload spec, blanks to ask, check, undo, flags (owner runs it, outside service, touches access = link only), worked-here record.
- **Actions:** `find_ways` (read).
- **Exists:** recipes, `find_setups`, `webGet` and `pinImage` (11-setups.mjs:8, :95), verified.json (09-verified.mjs:91), `learnRecipe` for hand-started containers (19-watcher.mjs:120), and 29 NVIDIA playbook entries in catalog.json Sparkie never reads. Defaults for blanks sit in memory.json.
- **Unlocks:** approach-1, approach-2, approach-3, approach-4, approach-6, landscape-4, hosting-6 (one catalog only). approach-5 is its test gate.

## 3. Procedure
The owner's saved workflow, able to start itself.
- **Fields added:** `trigger` (daily, every N hours, a fleet event, a hook, a drop folder), `once`, an `ask` step (a background Sparkie turn), budget, last/next run, paused after two failures.
- **Actions:** none to save (new fields on `save_workflow`); `check_back`.
- **Exists:** saved-workflows.json with a free-text `when` (18-workflows.mjs:126-207), `continueTask` (14-chats.mjs:137), `fleetEvent`, and two hard-coded daily timers (11-setups.mjs:241, 25-backup-and-start.mjs:34) that become entries.
- **Unlocks:** automation-1, automation-2, automation-3, automation-4, automation-5, agents-2, voice-2, storage-5.

## 4. Secret
A named value the console uses and never shows.
- **Fields:** name, kind, allowed hosts, used by, added, checked, expires.
- **How kept:** sealed with AES-256-GCM in secrets.json; the key in `~/.config/spark-console/secrets.key` (0600), outside the state folder, so backups and install snapshots carry sealed values only. Typed only on the passkey page: never chat, the brain or audit. Leaves only as a header to allowed hosts or a file in a container.
- **Actions:** `request_secret` (returns the form link), `forget_secret`.
- **Exists:** key hashes only (agents.json) and `maskSecrets` (20-mcp.mjs:236-247). Container env is passed as `-e K=V` (05-library.mjs:360).
- **Unlocks:** secrets-1, secrets-2, secrets-3, secrets-5, secrets-6.

## 5. Connector
An MCP server the console calls as a client.
- **Fields:** id, https address (or a tool workload), secret name, at most 10 pinned tools (name, hash, mark: lookup | change | off), private, closed.
- **Actions:** `connector_lookup` (read), `connector_change` (always a tapped button; never a workflow step or an agent call). Added and removed on the passkey page; address and token are one unit.
- **Exists:** the server side only (20-mcp.mjs). Reuses `propose` (17-changes.mjs:79), `readOutside` (14-chats.mjs:326) and `audit`.
- **Unlocks:** connectors-1, connectors-2, connectors-3, connectors-4, landscape-6 (Home Assistant half).

## 6. Channel
A place the owner's words arrive from and answers go back to.
- **Fields:** kind (say, telegram, signal), secret name, the owner's id there (the only sender accepted), rights (look-only by default), rolling conversation, reply style, and the tell rule: a reply, that thread's own result, its carry-on, or a watch the owner asked for.
- **Actions:** `tell_me`, `stop_telling`; one sender function.
- **Exists:** `askSparkie` has the shape (words in, conversation, choices: 20-mcp.mjs:72) and `postResult` (14-chats.mjs:116). Agent keys reach only `/mcp` and `/v1` from the internet (24-handler.mjs:81).
- **Unlocks:** voice-1 (= channels-3), channels-1, channels-2, channels-4, channels-5, voice-3, voice-5.

## 7. Door
An address for a thing, private by default, always with an end date.
- **Fields:** name, target (file, folder copy, workload port), who (link | public | owner), until, token hash, place: a path on :8443 for static copies; port 10000 or a tailnet-only port for apps, opened by one owner-run command.
- **Actions:** `host`, `stop_hosting`.
- **Exists:** the proxy in 21-editor.mjs (header scrubbing, cookie rewriting, WebSockets): slated for deletion, keep it. `PUBLIC_ROUTES` (24-handler.mjs:34). No Caddy, and nothing on port 10000.
- **Unlocks:** hosting-2 (= storage-2), landscape-2, hosting-5, dev-5, storage-4.

## 8. Files
One data folder on Spark 2 that every block reads and writes, with one search.
- **Fields:** `~/spark-data/{inbox,docs,notes,batch,out,apps,hosted}`; per file: path, kind, source (owner, chat, web, channel), date. Content is always data.
- **Actions:** `search` (docs, notes, chats), `keep_note`, `run_batch`. Upload is a stream into inbox.
- **Exists:** nothing. Chats stop at 300; files arrive only by scp.
- **Unlocks:** media-1, knowledge-1, knowledge-2, knowledge-5, training-2, media-4.

## What does not fit

- **Small code on existing parts (worth doing; code, not data).** Gateway, 15-routes.mjs: routing-1, routing-2, routing-3, routing-5, routing-6, training-5, agents-4, insight-3, dev-3. Fleet record, 12-status.mjs and 19-watcher.mjs: insight-1, insight-4, insight-5, insight-6, training-1, storage-1.
- **Duplicates:** hosting-1 (Caddy) loses to landscape-2; knowledge-4, media-2 and landscape-5 fold into routing-4 and voice-4.
- **Stretch Workload; wait until services and CPU jobs are proven:** training-3, training-4, dev-1, agents-1, agents-5, agents-6.
- **OAuth is code, not data; wait until a wanted connector refuses a token:** connectors-5, connectors-6.
- **Over-engineered for one owner:** automation-6 (second automation engine and secret store), agents-3 (new model loop on a 4-slot brain), secrets-4 (`used by` suffices), voice-6 (page is being cut), channels-6 (paid, least private), `power_spark` in landscape-6 (hardware one-off).

## Build order

0. Sparkie's planned tool cut first: the blocks add about 16 actions.
1. **Procedure trigger and `ask` step.** No dependencies; its ticker later serves watches and secret checks.
2. **Files, with Door links on :8443.** Share links, static sites, upload, chat search. No container, no owner step.
3. **Secret.** Useful alone (paste guard, key expiry); required by 4 and 5.
4. **Channel.** `/say` with a look-only key, then Telegram with the tell rule in the same change.
5. **Connector.** HTTPS plus token; one read-only connector the owner names.
6. **Way, then Workload.** After the owner's yes to CPU-only work on Spark 2; services before jobs.
7. **Door for apps** on port 10000, once the first web app exists.

### Critical Files for Implementation
- /Users/akuppala/Documents/26aiRAG/spark-console/service/src/16-actions.mjs
- /Users/akuppala/Documents/26aiRAG/spark-console/service/src/18-workflows.mjs
- /Users/akuppala/Documents/26aiRAG/spark-console/service/src/17-changes.mjs
- /Users/akuppala/Documents/26aiRAG/spark-console/service/src/20-desired.mjs
- /Users/akuppala/Documents/26aiRAG/spark-console/service/src/24-handler.mjs
