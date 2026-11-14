# Code map

Written by `node tools/code-map.mjs` from the code; don’t edit it by hand (a test fails when it’s out of date).
How the parts fit together is in `docs/architecture.md`; the rules every change must keep are in `docs/rules/`. What to read first is in `AGENTS.md`.

The service is 37 parts in `service/src/`, joined in name order into `service/server.mjs` (11009 lines in all). They share one scope, so a function in any part can be called from any other at run time; code that runs while the file loads can only use earlier parts.

## Every action, and where it lives

26 lookups and 15 changes. The same list is what Sparkie, the agent door (`/mcp`) and `POST /console/api/actions/<name>` offer.

| Action | Kind | What it is | Part |
|---|---|---|---|
| `fleet_status` | read | Fleet status | `16-actions.mjs` |
| `running_models` | read | Running models | `16-actions.mjs` |
| `models_on_disk` | read | Models on disk | `16-actions.mjs` |
| `find_recipes` | read | Find recipes | `16-actions.mjs` |
| `recipe_detail` | read | One recipe in full | `16-actions.mjs` |
| `search_huggingface` | read | Search Hugging Face | `16-actions.mjs` |
| `where_it_fits` | read | Where a model fits | `16-actions.mjs` |
| `deploy_plan` | read | Deploy plan (dry run) | `16-actions.mjs` |
| `cluster_plan` | read | Plan across two Sparks (dry run) | `16-actions.mjs` |
| `linked_sparks` | read | Linked Sparks | `16-actions.mjs` |
| `spark_detail` | read | One Spark right now | `16-actions.mjs` |
| `recent_operations` | read | Recent operations | `16-actions.mjs` |
| `operation_log` | read | Operation log | `16-actions.mjs` |
| `container_logs` | read | A container’s log | `16-actions.mjs` |
| `spark_diagnostics` | read | Spark diagnostics | `16-actions.mjs` |
| `service_logs` | read | Service logs | `16-actions.mjs` |
| `files` | read | Files in the shared folder | `16-actions.mjs` |
| `sparkie_setup` | read | Sparkie’s setup | `16-actions.mjs` |
| `workloads` | read | Everything on the Sparks | `16-actions.mjs` |
| `fleet_events` | read | What happened on the Sparks | `16-actions.mjs` |
| `start_model` | change | Start a model | `17-changes.mjs` |
| `stop_model` | change | Stop a model | `17-changes.mjs` |
| `restart_model` | change | Restart a model | `17-changes.mjs` |
| `find_setups` | change | Find setups for a model | `17-changes.mjs` |
| `save_file` | change | Save a file | `17-changes.mjs` |
| `workflows` | read | Workflows | `18-workflows.mjs` |
| `save_workflow` | change | Save a workflow | `18-workflows.mjs` |
| `run_workflow` | change | Run a saved workflow | `18-workflows.mjs` |
| `forget_workflow` | change | Forget a saved workflow | `18-workflows.mjs` |
| `wait_operation` | read | Follow an operation | `18-workflows.mjs` |
| `test_changes` | change | Test the changes | `18-workflows.mjs` |
| `undo_update` | change | Undo the last update | `18-workflows.mjs` |
| `should_be_running` | read | What should be running | `20-desired.mjs` |
| `cancel_operation` | change | Cancel an operation | `20-desired.mjs` |
| `undo_last_change` | change | Undo the last change | `20-desired.mjs` |
| `memory` | read | Memory | `20-memory.mjs` |
| `remember` | change | Remember | `20-memory.mjs` |
| `forget_memory` | change | Forget | `20-memory.mjs` |
| `keep_running` | change | Keep an app running | `21-apps.mjs` |
| `search_web` | read | Search the web | `21-web.mjs` |
| `read_page` | read | Read a web page | `21-web.mjs` |

## Every part

### `01-setup.mjs`

Generated: this file is service/src/*.mjs joined in name order (node tools/build-server.mjs). Edit the parts. Spark Console API: live metrics, the model library and deployments across the Spark fleet. Runs on the portal host behind `tailscale serve --set-path=/console/api`, next to the portal. Every request must come from a tailnet user the portal knows; anything that changes a Spark is owner-only.

- **Lines:** 101
- **Functions:** `buildOf`, `readJsonFile`, `offlineNow`, `q`, `sleep`, `nodeById`, `isProtected`, `hfSnap`, `hfMounts`

### `02-ssh.mjs`: running commands on Sparks

Scripts go over stdin to `bash -s`; plain commands (used when stdin carries data) go as the ssh command. `limit` (seconds) ends a script on the Spark itself too, so a stuck docker or du on a sick Spark doesn't pile up there after this side gave up.

- **Lines:** 71
- **Functions:** `spawnOn`, `knownOffline`, `noteReach`, `run`, `fields`, `b64json`

### `03-identity.mjs`: who's asking

The owner, the members and the Spark list live in the console's own owner-only file on this Spark, managed in Spark Console (Access). Tailscale serve sets Tailscale-User-Login, and this service only listens on 127.0.0.1.

- **Lines:** 285
- **State files it names:** `access.json`
- **Functions:** `readJson`, `readKept`, `writePrivate`, `ownAccess`, `accessToChange`, `accessList`, `memberPermissions`, `changeMembers`, `changeAccess`, `clean`, `addressKey`, `overLimit`, `askAccess`, `disconnectViewer`, `ownerPermissions`, `viewerFor`, `viewerForLogin`, `canUse`, `canManage`, `mustUse`, `refreshNodes`, `sameOrigin`

### `03-secrets.mjs`: secrets: one owner-only file outside the state folder

What Spark Console keeps for the owner that must never travel (Telegram's bot token and the chat it's paired with) is in ~/.config/spark-console/secrets.json: folder 0700, file 0600, outside the state folder, so the daily copy and the install snapshots never carry it and no restore brings an old pairing back (docs/architecture.md R32). It is typed only on the passkey page. A file that exists but can't be read is never written over. Under ALL_LOCAL the store is off unless a test names its own file, so tests never read the developer's home.

- **Lines:** 39
- **Functions:** `secretsRead`, `secretsWrite`

### `04-metrics.mjs`: live metrics

One long-running reader per Spark, only while someone has the page open; stopped shortly after they leave.

- **Lines:** 83
- **Runs on a timer:** `res`
- **Functions:** `startSampler`, `stopSamplers`, `broadcast`, `metricsStream`

### `05-library.mjs`: model library and deployments

- **Lines:** 397
- **Functions:** `ggufOnDisk`, `describe`, `inventory`, `containerName`, `engineOf`, `imageOf`, `gpuUsersScript`, `withHow`, `plan`, `fitOf`, `plansFor`, `pairOptions`, `deployOptions`, `memoryShare`, `shareIn`, `withoutShare`, `memNow`, `engineCacheDir`, `engineCache`, `dockerRunCommand`

### `06-links.mjs`: multi-Spark readiness (read-only)

Serving one model across Sparks (NVIDIA's vllm-cluster playbook) needs the ConnectX links up with addresses on a shared subnet, and full-MTU reachability between each pair. The console starts each Spark's part over its own SSH from Spark 2, so Sparks don't need SSH to each other. Nothing here changes a Spark: it reads /sys and ip, and pings.

- **Lines:** 98
- **State files it names:** `links.json`
- **Runs on a timer:** `test`
- **Functions:** `ipToInt`, `sameSubnet`, `netOf`, `fabric`

### `07-jobs.mjs`: jobs

- **Lines:** 227
- **Functions:** `newJob`, `note`, `step`, `publicJob`, `claimSparks`, `claimed`, `stopList`, `runJob`, `copyModel`, `unapprovedStops`, `planMoved`, `deploy`, `stopContainer`

### `08-cluster.mjs`: one model across two linked Sparks

NVIDIA's two-Spark method (build.nvidia.com/spark/vllm-cluster, advanced): native vLLM multi-node, one tensor-parallel rank per Spark, talking over the direct cable. The first Spark is the head and serves the API on its Tailscale address, port 8000, like a single-Spark deploy; the second runs headless. This service starts each part over its own SSH.

- **Lines:** 479
- **Functions:** `clusterName`, `workerName`, `clusterNet`, `cableCheck`, `spanOf`, `connectLines`, `sockLines`, `stuckAt`, `stuckIn`, `engineCheck`, `clusterPlan`, `clusterEnv`, `clusterRunCommand`, `clusterDeploy`, `asideBack`, `clusterParts`

### `09-verified.mjs`: verified deployments

Every deploy that comes up healthy is recorded with exactly how it ran (model, image, flags, memory share, Sparks) and a quick speed test on these Sparks: time to the first token and tokens per second over one 256-token answer. Recipes and the deploy dialog show these as "Verified on your Sparks", next to what others reported.

- **Lines:** 144
- **State files it names:** `verified.json`
- **Functions:** `verifiedList`, `httpJson`, `answerTest`, `answers`, `measureSpeed`, `recordVerified`, `adoptRunning`, `verifiedView`

### `10-recipes.mjs`: recipes

Recipes: service/catalog.json (built by tools/build-catalog.py from the research): models → versions → setups, plus models the owner added (~/.local/state/spark-console/added-models.json) and the setups the finder dug up for any model (found-setups.json, one entry per model, replaced each time it looks again).

- **Lines:** 220
- **State files it names:** `added-models.json`, `found-setups.json`
- **Functions:** `addedModels`, `foundSetups`, `recipeCatalog`, `modelKey`, `hfJson`, `quantOf`, `round1`, `needOf`, `fitSparks`, `variantFields`, `hfFixture`, `versionOf`, `inBatches`, `searchTerms`, `rememberSearch`, `searchModels`, `addModel`, `parseRepoList`, `addList`

### `11-setups.mjs`: finding setups

For one Recipes model, every published way of running its versions on DGX Spark: NVIDIA's recipes, recipes.vllm.ai, Spark Arena's and eugr's recipe files, NVIDIA's developer forums and the model's own card (its code blocks only). The commands are read out of those by the service itself (dig.mjs), never written by a model. Sparkie only reads forum posts to say which speed belongs to which command, quoting the post, and the quote is checked against it. Each setup then goes through the same checks as the catalog's; its image is pinned to the exact build published now.

- **Lines:** 437
- **Runs on a timer:** `daily`
- **Functions:** `webGet`, `parseYaml`, `cachedIndex`, `ghFiles`, `nvidiaIndex`, `sparkrunIndex`, `arenaIndex`, `eugrIndex`, `vllmRecipeSetups`, `cardText`, `cardSetups`, `squash`, `pinImage`, `digModel`, `startDig`, `recipeIdOf`, `setupsStale`, `refreshSetups`, `catalogSetup`, `sameRepo`, `needsDraftModel`, `plainFromBrain`, `resolveHow`, `downloadTargets`, `recipes`, `downloadVersion`

### `12-status.mjs`: Spark status (taking over from the original portal)

Each Spark's status comes from the portal's own worker.py (now shipped with the service), run over the same SSH as everything else, with the same fields the portal reported. It's collected every 30 seconds whether or not anyone is looking, like the portal did, which also keeps the GPU energy total going.

- **Lines:** 179
- **State files it names:** `energy.json`
- **Runs on a timer:** `collectStatus`
- **Functions:** `runWorker`, `sparkName`, `cleanStatus`, `sampleEnergy`, `energyView`, `collectStatus`, `statusFor`, `sparkFor`, `workerCall`, `sparkFiles`, `sparkAction`, `checkSparkAction`

### `13-main-model.mjs`: Sparkie's main model

Sparkie is the one main LLM; which model runs behind it is the owner's choice. This service runs it on its own Spark so chats and agents can reach it at 127.0.0.1. It starts with --restart unless-stopped, so it comes back after reboots until someone stops it here, and it's labeled protected, so deploys never stop it. Setups come from config.json (`main`, or `main.presets`) plus any made from Library models in the console; the one in use is saved in main.json next to the chats, so it survives restarts and installs.

- **Lines:** 301
- **State files it names:** `main.json`
- **Functions:** `configPresets`, `mainPresets`, `loadMainSetup`, `saveMainChoice`, `writeMainFile`, `brainLeftDown`, `markBrainLeftDown`, `saveRoutes`, `routeTarget`, `chatTarget`, `agentTarget`, `mainNode`, `repoOf`, `mainBusy`, `mainSnapshots`, `mainStatusScript`, `mainStatus`, `mainPlan`, `mainRunCommand`, `mainOverlayScript`, `startMain`, `setupFromLibrary`, `switchMain`, `stopMain`

### `14-chats.mjs`: Sparkie's chats

Sparkie's chats live here: one owner-only JSON file on this Spark. Each person sees only their own chats. Replies keep going (and are saved) if the page closes.

- **Lines:** 504
- **State files it names:** `chats.json`
- **Functions:** `chatData`, `saveChats`, `chatSummary`, `ownChat`, `systemPrompt`, `sparkieToolNames`, `sparkieTools`, `sparkieMessageChoices`, `outcomeText`, `runChoice`, `postResult`, `multiStep`, `chatBusy`, `resultSince`, `wakeWork`, `continueTask`, `unsupportedNumbers`, `stopTurn`, `sparkieTurn`, `chatReply`

### `15-routes.mjs`: choosing what Sparkie and agents use

Running models this service can point Sparkie or agents at: its own main model, console deploys (they listen on the tailnet too), and other model servers on its own Spark. Servers that only listen on another Spark's own address are listed but can't be reached from here.

- **Lines:** 212
- **Functions:** `runningChoices`, `servedModel`, `setRoute`, `routeView`, `usedRecently`, `runningModels`, `proxyModel`, `startOnCall`, `sparkieApi`, `proxyBrain`

### `16-actions.mjs`: actions: what the console can do, as one list for people, Sparkie and agents

Every workflow is a named action with typed inputs, so a model can pick up whichever it needs the same way each time, without opening the page. The agent door (MCP, below) offers them to your own agents; Sparkie's tools and the page's buttons move onto the same list, with the same checks. Each action says: kind 'read' runs straight away. 'change' (next) runs after the checks: dry-run plan, rails, re-check, verify, put back on failure. 'confirm' (deleting data, credentials) waits for the owner. Lock-out risks are never actions. scope which agent keys may use it: 'fleet:read' today; …

- **Lines:** 1115
- **Actions:** `fleet_status`, `running_models`, `models_on_disk`, `find_recipes`, `recipe_detail`, `search_huggingface`, `where_it_fits`, `deploy_plan`, `cluster_plan`, `linked_sparks`, `spark_detail`, `recent_operations`, `operation_log`, `container_logs`, `spark_diagnostics`, `service_logs`, `files`, `sparkie_setup`, `workloads`, `fleet_events`
- **Functions:** `action`, `gbOf`, `gbOfGiB`, `sparkIdOf`, `sparkList`, `sparkOf`, `checkValue`, `checkInput`, `liveSchema`, `normQuotes`, `sparkNames`, `tokensOf`, `changeIntent`, `pageOnlyLabel`, `pickContainer`, `tracesToRequest`, `planOf`, `modelCandidates`, `namesModel`, `sparkieCheck`, `tripBreaker`, `firmModel`, `requestLine`, `runAction`, `recent`, `recentInventory`, `recentWorkloads`, `recentMain`, `onDiskAs`, `libraryModel`, `didYouMean`, `mustLibraryModel`, `planSteps`, `fitView`, `pairView`, `flagsKey`, `sameFlags`, `runningDetail`, `darkNow`, `mainArg`, `pasteCard`, `wordStart`, `estimateFit`, `filePattern`, `sizeWords`, `filePath`, `sharedFolder`, `abilities`

### `17-changes.mjs`: actions that change things: say it, and it's done (checked inside)

Sparkie, your agents (with "can change things" on their key) and the spark command all go through these, and each is checked the same way before anything happens: 1. inputs (checkInput) 2. a fresh plan, never the cached view 3. the rails below, in code 4. one change per Spark (claimSparks) 5. inside the operation the plan is made again and has to match what was approved (deploy's stop list), and a pause by the owner stops it there 6. memory is measured after the stops and 8 GB is always kept free 7. it has to answer before it counts 8. on failure, what was stopped is started again. It asks …

- **Lines:** 785
- **Actions:** `start_model`, `stop_model`, `restart_model`, `find_setups`, `save_file`
- **State files it names:** `agent-settings.json`
- **Functions:** `agentSettings`, `setAgentSettings`, `noStopWords`, `pausedCheck`, `sparkieWho`, `whoAsks`, `question`, `changeLabel`, `propose`, `redeemChoice`, `routedSparks`, `railsFor`, `inRecipes`, `agentSafeSetup`, `placeModel`, `bestHow`, `deployPlaced`, `knownStartFailure`, `causeLines`, `rejectedFlags`, `withoutRejected`, `withoutFlags`, `fixFlags`, `startWithFixes`, `launch`, `putBack`, `resolveModelName`, `pickVersion`, `startingNow`, `alreadyStarting`, `brainSparks`, `notBrainsSpark`, `acrossGate`, `runsWhereNamed`, `namedInFull`, `startModel`, `stoppedForSure`, `restartChecked`, `restartJob`

### `18-workflows.mjs`: workflows

Every change Spark Console makes is a workflow: a named procedure with checked inputs, fixed steps, a check that it worked, a put-back, and its known problems with their fixes (docs/contract.md, section 6). Sparkie and agents choose a workflow and fill in its inputs; they never make up the steps. A workflow's version is a fingerprint of its code (the functions it runs, its action, its known problems, and the worker that runs on the Sparks), so any change to that code is a new version. A version runs only once it's validated twice: - tested: the whole test suite passed with this exact build …

- **Lines:** 570
- **Actions:** `workflows`, `save_workflow`, `run_workflow`, `forget_workflow`, `wait_operation`, `test_changes`, `undo_update`
- **State files it names:** `validations.json`, `saved-workflows.json`, `.test-check-fails`, `heal-tries.json`, `updates.json`, `update-note.json`
- **Functions:** `WORKER_SOURCE`, `START_CODE`, `workflowById`, `workflowFor`, `workflowVersion`, `WORKFLOW_LOCK`, `validations`, `workflowStatus`, `recordWorkflowRun`, `offMessage`, `unvalidatedMessage`, `pageWorkflow`, `rehearse`, `savedWorkflows`, `workflowSlug`, `fillIn`, `placeholders`, `savedView`, `findSaved`, `writeSaved`, `stepArgs`, `stepWords`, `missingTarget`, `checkFailsForTest`, `checkSteps`, `saveHealTries`, `maybeHeal`, `validateChanged`, `lastSnapshot`, `updatesFrom`, `noteUpdate`, `lastUpdates`, `startTestChanges`, `undoUpdate`

### `19-watcher.mjs`: watching the fleet: what runs, what changed, and what it learns

Every minute the console looks at every container on every Spark (models, services, dev boxes, anything started by hand) and remembers how each was started: image, command (secrets hidden), ports, mounts, GPU use, and the names (never the values) of its environment variables. Changes become events: started, stopped, crashed, removed, a Spark going offline or coming back, and the console's own operations. A model server someone started by hand, from an image source the console trusts, is saved as a recipe ("worked before"), so it can be started again like any other. Sparkie and agents read all …

- **Lines:** 303
- **State files it names:** `knowledge.json`, `events.jsonl`
- **Runs on a timer:** `watchFleet`
- **Functions:** `events`, `fleetEvent`, `describeEvent`, `reading`, `lastReading`, `readingWords`, `darkPeriods`, `watchScript`, `learnedFrom`, `watchSpark`, `learnRecipe`, `learnModels`, `noteSparkStates`, `saveKnowledge`, `watchFleet`, `sparkOff`, `fleetNotes`

### `20-desired.mjs`: what should be running (docs/contract.md 6.13, 8.8–8.10)

The owner's list of what should be running on each Spark: every model a change started, in numbered revisions. A start adds to it and a stop takes away, when they finish. Self-healing keeps crashed ones running (6.12). One that isn't running and won't come back by itself (cut off by a power loss, crash-looping, stopped outside Spark Console, its Spark gone) is *held*: the owner brings it back with one click, or forgets it. Nothing here ever stops anything. "Cancel" stops an operation at its next step and puts back what it did; "undo" goes back to the revision before this chat's last change.

- **Lines:** 251
- **Actions:** `should_be_running`, `cancel_operation`, `undo_last_change`
- **State files it names:** `desired.json`
- **Runs on a timer:** `watchHeld`
- **Functions:** `desired`, `keyOf`, `desiredAfter`, `keepApp`, `forgetApp`, `desiredNow`, `watchHeld`, `cancelJob`, `cancelCheck`, `holdsModelsOn`, `cancelRunningOn`, `cancelJobsAndWait`, `waitJob`

### `20-heal.mjs`: self-healing, more of it (v3.1, 2026-11-11)

Fixing things by itself is what matters most to the owner (2026-11-11). On top of a crashed one-Spark model coming back (maybeHeal), every minute, with the owner's switch (automatic restarts) on and agents not paused: - a model across two Sparks that lost a part: what's left of it stops, and it starts again across the same Sparks (start_model, so the cable and engine checks and the known fixes run); - a Spark the owner powered back on: what should be running there (should_be_running) comes back, once its Sparks have been up 2 minutes (Docker and the GPU settle), once per power-on; - Sparkie's …

- **Lines:** 246
- **Runs on a timer:** `healPass`
- **Functions:** `healOwner`, `healCount`, `healMark`, `cameBack`, `healSkip`, `healReason`, `bringBack`, `brainRestartCommand`, `restartBrain`, `keepBrain`, `watchBrain`, `displacedBy`, `healPass`

### `20-mcp.mjs`: the agent door (MCP)

Your own agents (Claude Code, Claude Desktop, Cursor, …) use the actions above through one MCP address, <console>/console/api/mcp, instead of opening the page. Each agent has its own key (Access → Agents), so you can see what each one did and remove one without touching the others. A key only works together with its owner's Tailscale identity, and never from the Sparks themselves (requestGate). Only the key's hash is kept. Read-only for now; the key's scopes decide which actions it's offered once more kinds exist.

- **Lines:** 300
- **State files it names:** `agents.json`, `audit.jsonl`
- **Functions:** `keyHash`, `agentKeys`, `consoleOrigin`, `mcpUrl`, `agentView`, `keyViewer`, `agentFor`, `agentInstructions`, `askSparkie`, `audit`, `mcpDoor`, `hidePrivateKeys`, `keyName`, `randomish`, `hideKeys`, `maskSecrets`, `secretName`, `maskDeep`

### `20-memory.mjs`: Sparkie's memory (v3.1, 2026-11-11)

What the owner asks Sparkie to remember across chats: preferences ("Spark 3 is where models go"), corrections ("no, I meant the FP4 one"), fleet facts ("Spark 4 is on Wi-Fi only") and lessons ("GLM needs sockets over the cable"). A few dozen short lines in memory.json, put at the end of Sparkie's system prompt (so the prompt cache stays warm until it changes), and listed for agents by `memory`. Live state beats memory: the prompt says so. Only the owner's own words add or remove a line: either they say so ("remember…", "forget that…"), or they simply state it ("Spark 4 is on Ethernet now") …

- **Lines:** 123
- **Actions:** `memory`, `remember`, `forget_memory`
- **State files it names:** `memory.json`
- **Functions:** `memoryEntries`, `memoryLine`, `memoryPrompt`, `saysForget`, `refusesRemember`, `memoryClear`

### `20-needs.mjs`: what is waiting on the owner (H4)

One list of open problems, built by code each time it is asked for, from facts Spark Console already holds: no model call, no look at another Spark, and no text from a log, an error, a container's output or the web (so fleet_status stays a read of the console's own numbers). Lock-out first, then the owner's data, then the fleet. A line stands while its cause does and goes when the cause goes, never because it was shown. Each cause is tried by itself, so one that throws never breaks /status. At most 8 lines are said (needsLines: the 8th counts the rest): in /status (page and Telegram), at the …

- **Lines:** 67
- **Functions:** `tilde`, `openProblems`, `needsLines`

### `20-tell.mjs`: telling the owner on Telegram

tell() is the only thing that sends to Telegram, and it sends only what the owner asked for (docs/contract.md 13, docs/architecture.md R32): a reply to a message sent there, the result of work started there, Sparkie carrying on with a request made there, and Spark Console's own fixed lines (pairing, /status, "restarted while answering"). Never heals, crashes nobody asked about, notices, sign-ins or digests, with one exception the owner switches on: the needs-me line at the end of this part. Every send is plain text with link previews off and secrets hidden, and is on the record (its kind and …

- **Lines:** 164
- **Functions:** `TELL_LIMITS`, `tellParts`, `tellClean`, `tell`, `tellName`, `tellWhat`, `tellResultLine`, `tellAwait`, `tellAwaitDone`, `tellResult`, `tellCarry`, `tellReplyText`, `tellButtons`, `needsLine`, `needsMeTick`

### `20-words.mjs`: the owner's words: /status, /pause, /restart sparkie, /stop, /undo update, /help (round two, 2026-11-11)

Typed as the whole message in the owner's own page chat, they're answered by code before any model call, so they work with Sparkie's model down or stuck (docs/analysis-2026-11-11/10-round-two-report.md, item 1; contract 8.13). They are not tools: no agent, no /mcp or /v1, no carry-on turn. They can only look, pause agents' changes, bring back the brain's own container (restart it, or start it again when it is stopped or gone: the same container, or the saved setup; never another model), end Sparkie's answer in that chat (/stop), or go back a build. /undo update is the one word that runs an …

- **Lines:** 160
- **Functions:** `ownerWord`, `nearMissWord`, `consoleSparkWords`, `statusText`, `pauseWord`, `restartWord`, `stopWord`, `undoWord`, `helpWord`, `answerOwnerWord`

### `21-apps.mjs`: apps kept running (R38)

"Keep Open WebUI on Spark 3 running and give me its link" (A12). An app is any container that isn't a model: Open WebUI, a database, a dashboard. keep_running puts one that's already on a Spark on the list of what should be running (desired.json, an entry with app: true), restarts or stops one kept that way, or starts a new one from an image the owner names: no GPU, a memory cap, named volumes only, its port opened on 127.0.0.1 and the Spark's tailnet address only, labelled spark.app=1 (never spark.console=1, so no model start ever counts it as one of its own). Self-healing brings a kept app …

- **Lines:** 548
- **Actions:** `keep_running`
- **Functions:** `appSecretName`, `imageRepo`, `appModelImage`, `appAnswers`, `appStates`, `appLook`, `appDiffers`, `commandWords`, `appCommand`, `devBox`, `appRoom`, `jobDir`, `appRunCommand`, `gpuAlone`, `jobFolder`, `jobEnded`, `appUp`, `appDone`, `appPutBack`, `appNamed`, `appNow`, `healApp`

### `21-door.mjs`: the app door: the owner's kept apps from anywhere (R40)

The owner opens an app kept running (keep_running, R38) on any Spark that isn't the brain's from anywhere, a phone without Tailscale too, signed in as on the main address (the owner, 2026-11-12: "once you're signed in, you shouldn't need a separate password"). It is Spark Console's own name on port 10000 (Funnel's one free port; 443 is the public Funnel's), which Tailscale serve hands to door.sock, a private socket like api.sock. Only the owner's script deploy/open-apps-to-internet.sh points Tailscale there; the console only reads whether it does (doorOn, checkRoute). - Its own origin: an …

- **Lines:** 263
- **State files it names:** `door.sock`
- **Functions:** `doorHosts`, `doorOrigin`, `doorLink`, `appLinks`, `linkWords`, `consoleCookieName`, `doorTarget`, `doorTicketOf`, `doorGate`, `doorWho`, `doorPage`, `doorRequestHeaders`, `doorResponseHeaders`, `doorOpen`, `doorHandler`, `doorUpgrade`

### `21-editor.mjs`: VS Code in the browser (taking over from the original portal)

<console api>/connect/<spark>/ goes to that Spark's code-server, which listens on 127.0.0.1 on this Spark: its own, and Spark 3 and 4's through the tunnel services. Owner only, since the editor is a full shell as the owner. The same checks and rewriting the portal did: no escaping the editor's path, redirects and cookies kept under it, and WebSockets only from this site.

- **Lines:** 114
- **Functions:** `editorPath`, `editorTarget`, `editorRequestHeaders`, `editorResponseHeaders`, `editorAllowed`, `editorHttp`, `editorUpgrade`

### `21-telegram.mjs`: Telegram: the owner talks to Sparkie from any phone or laptop

Spark 2 asks Telegram for new messages over one outbound HTTPS connection (long polling): no route, port or Funnel, so it works with Tailscale off on the owner's devices and with the console tailnet-only. One private chat, paired with a one-time code only the passkey page shows, is a turn in the owner's own Sparkie chat with the same gates as the page. Everyone else gets silence. Going back a build, memory and saved workflows wait as an owner-only button in Spark Console; access, keys, passkeys and devices have no path from here at all. (docs/architecture.md R32, …

- **Lines:** 393
- **State files it names:** `telegram.json`
- **Functions:** `tgBinding`, `tgPaired`, `tgSaved`, `tgSave`, `tgSaveSoon`, `tgSetState`, `tgProblem`, `telegramView`, `tgCall`, `tgSend`, `tgTyping`, `tgLoop`, `tgStop`, `tgRestart`, `tgOwner`, `tgUpdate`, `tgTryPair`, `tgNewCode`, `tgForget`, `tgConv`, `tgTurn`, `tgPress`, `tgStatusText`, `tgAfterRestart`, `telegramRoute`

### `21-web.mjs`: looking things up on the web

When Sparkie doesn't know something (a new model, an error message, an engine flag, a how-to), search_web finds pages and read_page reads one. Both are reads, open-world (an agent's 6 a minute at the door). What leaves the house is a search query (keys and the fleet's own names and addresses hidden, 200 characters at most) and plain GETs: no cookies, no credentials, no Authorization. A page's text comes back labelled as data. Text that was read never chooses the address (R39): read_page opens only an address in the owner's own words in this chat (any of their messages there; one typed without …

- **Lines:** 305
- **Actions:** `search_web`, `read_page`
- **Functions:** `fixtureJson`, `publicAddress`, `bareHost`, `publicLookup`, `publicHost`, `bareUrl`, `webHop`, `fixtureHop`, `webError`, `webFetch`, `decodeEntities`, `inlineText`, `dropBlocks`, `mainPart`, `pageText`, `readable`, `searxng`, `ddgTarget`, `ddgResults`, `searxResults`, `webSearch`, `sawAddresses`, `ownerAddresses`, `addressRefusal`, `reText`, `hideFleet`

### `22-passkey.mjs`: the owner's passkey: confirming changes to who has access

One portal for everyone: Tailscale says who you are (owner, member, or someone asking), and for the few changes to who has access (people, invites, agent keys and their rights, resuming paused agents) the owner also confirms with a passkey (Touch ID, Face ID, a phone or a security key). Each confirmation signs a one-time challenge bound to that exact request, so a program on the owner's device can't make those changes with Tailscale's identity alone. Until a passkey is set up, these changes need none (nothing can lock the owner out).

- **Lines:** 182
- **State files it names:** `passkeys.json`
- **Functions:** `passkeys`, `savePasskeys`, `passkeyOrigins`, `passkeyRpIds`, `counterNote`, `actionHash`, `newChallenge`, `describeChange`, `takeChallenge`, `passkeyNeeded`, `mayNeedPasskey`, `bodyLimit`, `stopsOutside`, `needsPasskey`, `refuseHiddenFiles`, `passkeyGate`

### `22-sessions.mjs`: signing in without Tailscale (docs/contract.md 4.10)

From the internet (Tailscale Funnel) a request carries no Tailscale identity, so on its own it's a public visitor. The owner signs a browser in with their passkey, or lets a device in by its short code (a terminal, or a phone without the passkey) from a device that's already signed in, confirming with the passkey. Each signed-in device holds a random token: a browser as a cookie only it sends (HttpOnly, Secure, SameSite=Strict, only to /console/api), a terminal as "Authorization: Bearer scs_…". Only a token's hash is kept. On the tailnet, Tailscale's identity wins.

- **Lines:** 357
- **State files it names:** `sessions.json`
- **Functions:** `sessionHash`, `sessionOver`, `asObject`, `sessionList`, `saveSessions`, `newSession`, `cookieValues`, `sessionTokens`, `carriesCredential`, `sessionFor`, `sessionViewer`, `ownerSessionView`, `newDevicePasskeyOpen`, `markPasskeyAdded`, `recoveryNorm`, `recoveryCode`, `recoveryOf`, `recoveryView`, `makeRecoveryCodes`, `useRecoveryCode`, `accessView`, `editorPasskeyFresh`, `markPasskey`, `sessionCookie`, `setSessionCookie`, `clearSessionCookie`, `holdForSession`, `endSession`, `userCodeOf`, `pruneDeviceCodes`, `onTailnet`, `deviceView`, `deviceByCode`, `signinMac`, `newSigninChallenge`, `takeSigninChallenge`, `limited`, `fromPage`, `signinRoute`, `sessionRoute`

### `23-http.mjs`: HTTP

- **Lines:** 141
- **State files it names:** `last-crash.json`, `watchdog-restarts`, `api.sock`, `api-locked`
- **Runs on a timer:** `checkRoute`, `refreshBlocked`
- **Functions:** `send`, `readBody`, `isFault`, `routePattern`, `faultText`, `faultFrames`, `recordFault`, `recordCrash`, `faultView`, `checkRoute`, `sparkAddresses`, `refreshBlocked`

### `24-handler.mjs`: the public page

Anyone may see the fleet's hardware and load, from the internet too. Internet (Funnel) traffic carries no Tailscale identity, so it never gets past the sign-in check: this is the only thing it can read. Nothing here names a model, container, job, chat, person, hostname or address.

- **Lines:** 706
- **Functions:** `publicFleet`, `publicValue`, `clientAddress`, `requestGate`, `handler`

### `25-backup-and-start.mjs`: a daily copy of the console's state on another Spark

People, passkeys, agent keys, chats, recipes that worked and the fleet's record are copied once a day to another Spark (Spark 3 unless config.json names one, then the next other Spark that takes it; never the brain's Spark or this one), keeping the last 14, so losing Spark 2's disk loses none of it (F17). Each copy arrives as <name>.part and is read back whole (gzip -t) there; only once tar here has ended well too does a second command move it into place and remove the oldest beyond 14, and otherwise that command removes the .part. So a copy cut short, or one tar couldn't finish (a file it …

- **Lines:** 139
- **State files it names:** `backup.json`
- **Runs on a timer:** `backupIfDue`, `needsMeTick`
- **Functions:** `dayOf`, `backupLate`, `backupTargets`, `sendCopy`, `backupState`, `backupIfDue`, `refuseUpgrade`, `openSockets`
