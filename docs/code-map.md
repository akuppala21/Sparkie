# Code map

Written by `node tools/code-map.mjs` from the code; don’t edit it by hand (a test fails when it’s out of date).
How the parts fit together is in `docs/architecture.md`; the rules every change must keep are in `docs/rules/`; actions, state files, timers, events and operations are in `docs/registry.md`. What to read first is in `AGENTS.md`.

The service is 79 parts in `service/src/`, joined in name order into `service/server.mjs` (20240 lines in all). They share one scope, so a function in any part can be called from any other at run time; code that runs while the file loads can only use earlier parts. Each part starts with its header (docs/rules/R28.md). “Uses” lists the names a part takes from each other part (a name counts when it is a top-level name of exactly one other part); “Used by”, the parts that take a name from it.

## Every action, and where it lives

30 lookups and 20 changes. The same list is what Sparkie, the agent door (`/mcp`) and `POST /console/api/actions/<name>` offer.

| Action | Kind | What it is | Part |
|---|---|---|---|
| `fleet_status` | read | Fleet status | `16-reads.mjs` |
| `running_models` | read | Running models | `16-reads.mjs` |
| `models_on_disk` | read | Models on disk | `16-reads.mjs` |
| `find_recipes` | read | Find recipes | `16-reads.mjs` |
| `recipe_detail` | read | One recipe in full | `16-reads.mjs` |
| `search_huggingface` | read | Search Hugging Face | `16-reads.mjs` |
| `where_it_fits` | read | Where a model fits | `16-reads.mjs` |
| `deploy_plan` | read | Deploy plan (dry run) | `16-reads.mjs` |
| `cluster_plan` | read | Plan across two Sparks (dry run) | `16-reads.mjs` |
| `linked_sparks` | read | Linked Sparks | `16-reads.mjs` |
| `spark_detail` | read | One Spark right now | `16-reads.mjs` |
| `recent_operations` | read | Recent operations | `16-reads.mjs` |
| `operation_log` | read | Operation log | `16-reads.mjs` |
| `container_logs` | read | A container’s log | `16-reads.mjs` |
| `spark_diagnostics` | read | Spark diagnostics | `16-reads.mjs` |
| `service_logs` | read | Service logs | `16-reads.mjs` |
| `files` | read | Files in the shared folder | `16-reads.mjs` |
| `sparkie_setup` | read | Sparkie’s setup | `16-reads.mjs` |
| `workloads` | read | Everything on the Sparks | `16-reads.mjs` |
| `fleet_events` | read | What happened on the Sparks | `16-reads.mjs` |
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
| `recall` | read | Recall | `20-journal.mjs` |
| `memory` | read | Memory | `20-memory.mjs` |
| `remember` | change | Remember | `20-memory.mjs` |
| `forget_memory` | change | Forget | `20-memory.mjs` |
| `keep_running` | change | Keep an app running | `21-apps.mjs` |
| `compare_models` | change | Compare models on a saved workload | `21-compare.mjs` |
| `guide` | read | Guide to the tools | `21-guide.mjs` |
| `power_off` | change | Power off a Spark | `21-power.mjs` |
| `power_on` | change | Turn on a Spark | `21-power.mjs` |
| `power_settings` | change | Idle power-off setting | `21-power.mjs` |
| `self_test` | change | Test the Sparks (the self-test) | `21-selftest.mjs` |
| `check_update` | read | Check for a newer build | `21-updates.mjs` |
| `search_web` | read | Search the web | `21-web.mjs` |
| `read_page` | read | Read a web page | `21-web.mjs` |
| `run` | read | Run a command on a Spark | `21-work.mjs` |

## Every part

### `01-setup.mjs`: setup: the build id, config.json, the Sparks, test switches and shared helpers

Generated: this file is service/src/*.mjs joined in name order (node tools/build-server.mjs). Edit the parts. Spark Console API: live metrics, the model library and deployments across the Spark fleet. Runs on the portal host behind `tailscale serve --set-path=/console/api`, next to the portal. Every request must come from a tailnet user the portal knows; anything that changes a Spark is owner-only.

- **Area:** ground. **Rules:** R8, R28, R29, R30. **Tests:** build.test.mjs, fleet.test.mjs
- **Lines:** 150
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `buildOf`, `readJsonFile`, `offlineNow`, `q`, `sleep`, `nodeById`, `isProtected`, `hfSnap`, `hfMounts`, `hfEachFile`
- **Uses:** nothing from other parts
- **Used by:** `02-ssh`, `03-identity`, `03-secrets`, `04-metrics`, `05-library`, `06-links`, `07-jobs`, `08-cluster`, `09-verified`, `10-recipes`, `11-setups`, `12-plugs`, `12-status`, `13-main-model`, `14-chats`, `14-rounds`, `15-routes`, `16-actions`, `16-reads`, `17-changes`, `18-job-model`, `18-run-record`, `18-saved-from`, `18-step-jobs`, `18-workflows`, `19-watcher`, `20-beat`, `20-danger`, `20-desired`, `20-digest`, `20-heal`, `20-journal`, `20-keys`, `20-lessons`, `20-mcp`, `20-memory-names`, `20-memory-time`, `20-memory`, `20-needs`, `20-op-energy`, `20-places`, `20-programs`, `20-recall`, `20-sort`, `20-state-copy`, `20-tell`, `20-tg-approve`, `20-ways-in`, `20-words`, `21-apps`, `21-brain-check`, `21-brain-eval`, `21-compare`, `21-copies`, `21-door`, `21-guide`, `21-power`, `21-runner`, `21-selftest`, `21-telegram`, `21-updates`, `21-web`, `21-work-shown`, `21-work`, `22-passkey`, `22-sessions`, `23-http`, `24-handler`, `25-backup-and-start`

### `02-ssh.mjs`: running commands on Sparks

Scripts go over stdin to `bash -s`; plain commands (used when stdin carries data) go as the ssh command. `limit` (seconds) ends a script on the Spark itself too, so a stuck docker or du on a sick Spark doesn't pile up there after this side gave up.

- **Area:** ground. **Rules:** R10. **Tests:** fleet.test.mjs, dark.test.mjs
- **Lines:** 76
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `spawnOn`, `knownOffline`, `noteReach`, `run`, `fields`, `b64json`
- **Uses:** `01-setup` (`ALL_LOCAL`, `offlineNow`, `PATH_FIRST`, `CONFIG`, `PREAMBLE`, `OFFLINE_TTL`), `25-backup-and-start` (`local`)
- **Used by:** `03-identity`, `04-metrics`, `05-library`, `06-links`, `07-jobs`, `08-cluster`, `11-setups`, `12-status`, `13-main-model`, `16-reads`, `17-changes`, `18-run-record`, `18-step-jobs`, `18-workflows`, `19-watcher`, `20-desired`, `20-digest`, `20-heal`, `20-journal`, `20-memory`, `20-places`, `20-ways-in`, `20-words`, `21-apps`, `21-brain-eval`, `21-compare`, `21-copies`, `21-guide`, `21-power`, `21-runner`, `21-selftest`, `21-updates`, `21-web`, `21-work-shown`, `21-work`, `24-handler`, `25-backup-and-start`

### `03-identity.mjs`: who's asking

The owner and the Spark list live in the console's own owner-only file on this Spark (access.json); the service never writes it. Spark Console has one user, the owner (contract 2.1): members, their requests and the share link an older build kept there are left as they are, never read and never removed (E10d), so going back a build still finds them. Tailscale serve sets Tailscale-User-Login, and this service only listens on 127.0.0.1.

- **Area:** ground. **Rules:** R4, R5, R10, R20. **Tests:** state.test.mjs, internet.test.mjs, passkey.test.mjs, owner-only.test.mjs
- **Lines:** 210
- **Owns:** access.json (writers: none), access.json.good (writers: ownAccess; a copy of the last good access.json)
- **Timers:** none
- **Wakes:** none
- **Functions:** `readJson`, `readKept`, `writePrivate`, `ownAccess`, `accessList`, `clean`, `addressKey`, `overLimit`, `ownerPermissions`, `viewerFor`, `viewerForLogin`, `canUse`, `canManage`, `mustUse`, `refreshNodes`, `sameOrigin`
- **Uses:** `01-setup` (`STATE_DIR`, `HttpError`, `CONFIG`, `NODES`, `DEV_LOGIN`, `NODES_TTL`, `NODE_ID_RE`, `nodeById`), `02-ssh` (`authProblem`), `04-metrics` (`samplers`, `clients`, `startSampler`), `16-actions` (`recent`), `19-watcher` (`fleetEvent`), `21-web` (`publicHost`), `22-sessions` (`sessionViewer`), `23-http` (`selfOrigin`), `25-backup-and-start` (`local`)
- **Used by:** `05-library`, `06-links`, `07-jobs`, `08-cluster`, `09-verified`, `10-recipes`, `11-setups`, `12-plugs`, `12-status`, `13-main-model`, `14-chats`, `14-rounds`, `16-reads`, `17-changes`, `18-run-record`, `18-workflows`, `19-watcher`, `20-danger`, `20-desired`, `20-heal`, `20-journal`, `20-keys`, `20-lessons`, `20-mcp`, `20-memory-names`, `20-memory`, `20-needs`, `20-state-copy`, `20-tg-approve`, `20-ways-in`, `21-apps`, `21-brain-check`, `21-door`, `21-power`, `21-selftest`, `21-telegram`, `22-passkey`, `22-sessions`, `23-http`, `24-handler`, `25-backup-and-start`

### `03-secrets.mjs`: secrets: one owner-only file outside the state folder

What Spark Console keeps for the owner that must never travel (Telegram's bot token and the chat it's paired with) is in ~/.config/spark-console/secrets.json: folder 0700, file 0600, outside the state folder, so the daily copy and the install snapshots never carry it and no restore brings an old pairing back (docs/architecture.md R32). Telegram's token is typed only on the passkey page; a key the owner gives in their own chat is kept here by name (20-keys.mjs, R51). A file that exists but can't be read is never written over. Under ALL_LOCAL the store is off unless a test names its own file, …

- **Area:** ground. **Rules:** R20, R32, R51. **Tests:** telegram.test.mjs, needs.test.mjs, app-keys.test.mjs
- **Lines:** 83
- **Owns:** secrets.json (writers: secretsWrite; outside the state folder)
- **Timers:** none
- **Wakes:** none
- **Functions:** `secretsRead`, `secretsWrite`, `keptForms`, `keptHidden`
- **Uses:** `01-setup` (`ALL_LOCAL`, `HttpError`)
- **Used by:** `14-chats`, `20-beat`, `20-keys`, `20-mcp`, `20-memory-names`, `20-needs`, `20-tg-approve`, `21-telegram`, `21-updates`, `22-sessions`, `24-handler`

### `04-metrics.mjs`: live metrics

One long-running reader per Spark, only while someone has the page open; stopped shortly after they leave.

- **Area:** ground. **Rules:** R10, R24. **Tests:** internet.test.mjs
- **Lines:** 88
- **Owns:** none
- **Timers:** startSampler (again 15 s after a reader ends, while a page is open), metricsStream (a ping every 15 s to each open page)
- **Wakes:** none
- **Functions:** `startSampler`, `stopSamplers`, `broadcast`, `metricsStream`
- **Uses:** `01-setup` (`NODES`), `02-ssh` (`spawnOn`, `unreachableUntil`, `noteReach`), `21-power` (`power`), `22-sessions` (`holdForSession`)
- **Used by:** `03-identity`, `22-sessions`, `24-handler`, `25-backup-and-start`

### `05-library.mjs`: model library and deployments

- **Area:** ground. **Rules:** R2, R8, R17, R21, R38. **Tests:** change.test.mjs, across.test.mjs
- **Lines:** 426
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `ggufOnDisk`, `plainText`, `plainImage`, `plainManifest`, `describe`, `inventory`, `containerName`, `engineOf`, `metricsFlags`, `imageOf`, `gpuUsersScript`, `withHow`, `plan`, `fitOf`, `plansFor`, `pairOptions`, `deployOptions`, `memoryShare`, `shareIn`, `withoutShare`, `memNow`, `engineCacheDir`, `engineCache`, `dockerRunCommand`
- **Uses:** `01-setup` (`MODELS`, `HF_HUB`, `hfSnap`, `NODES`, `NAME_RE`, `CONFIG`, `q`, `HttpError`, `nodeById`, `isProtected`, `hfMounts`), `02-ssh` (`run`, `fields`, `b64json`), `03-identity` (`canUse`), `06-links` (`lastCheck`), `08-cluster` (`clusterPlan`), `12-status` (`sparkName`), `13-main-model` (`MAIN`), `21-web` (`readable`)
- **Used by:** `07-jobs`, `08-cluster`, `09-verified`, `11-setups`, `13-main-model`, `14-rounds`, `15-routes`, `16-actions`, `16-reads`, `17-changes`, `18-job-model`, `18-step-jobs`, `18-workflows`, `20-lessons`, `21-apps`, `21-compare`, `21-power-pair`, `21-power`, `21-selftest`, `24-handler`

### `06-links.mjs`: multi-Spark readiness (read-only)

Serving one model across Sparks (NVIDIA's vllm-cluster playbook) needs the ConnectX links up with addresses on a shared subnet, and full-MTU reachability between each pair. The console starts each Spark's part over its own SSH from Spark 2, so Sparks don't need SSH to each other. Nothing here changes a Spark: it reads /sys and ip, and pings.

- **Area:** ground. **Rules:** R10, R17, R24. **Tests:** across.test.mjs, door.test.mjs
- **Lines:** 101
- **Owns:** links.json (writers: fabric)
- **Timers:** test (the cable test, fabric: 20 s after start, then every 10 minutes)
- **Wakes:** none
- **Functions:** `ipToInt`, `sameSubnet`, `netOf`, `fabric`
- **Uses:** `01-setup` (`NODES`, `nodeById`, `q`, `STATE_DIR`), `02-ssh` (`run`, `fields`), `03-identity` (`writePrivate`, `readJson`)
- **Used by:** `05-library`, `08-cluster`, `16-reads`, `17-changes`, `21-power-pair`, `24-handler`

### `07-jobs.mjs`: jobs

- **Area:** ground. **Rules:** R7, R9, R13, R14, R15, R16, R21. **Tests:** change.test.mjs, state.test.mjs, pause.test.mjs
- **Lines:** 245
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `newJob`, `note`, `step`, `publicJob`, `claimSparks`, `claimed`, `stopList`, `runJob`, `copyModel`, `unapprovedStops`, `planMoved`, `deploy`, `stopContainer`
- **Uses:** `01-setup` (`HttpError`, `nodeById`, `HF_HUB`, `CONFIG`, `hfSnap`, `q`, `HF_OWN`, `hfEachFile`, `sleep`, `ALL_LOCAL`), `02-ssh` (`run`, `spawnOn`), `03-identity` (`accessList`, `mustUse`), `05-library` (`plan`, `containerName`, `withHow`, `inventory`, `engineOf`, `ENGINES`, `memNow`, `memoryShare`, `dockerRunCommand`, `imageOf`), `08-cluster` (`asideBack`), `09-verified` (`answers`, `recordVerified`), `12-status` (`sparkName`), `14-chats` (`postResult`), `15-routes` (`sparkCalls`), `16-actions` (`tripBreaker`, `agentCache`), `17-changes` (`withoutRejected`, `fixFlags`, `causeLines`), `18-workflows` (`recordWorkflowRun`, `consoleStopped`), `19-watcher` (`fleetEvent`), `20-desired` (`cancelCheck`, `desiredAfter`), `20-journal` (`journalNote`, `journalOp`), `20-lessons` (`learnFrom`), `20-mcp` (`maskSecrets`), `20-op-energy` (`opEnergyStart`), `20-tell` (`tellAwaitDone`)
- **Used by:** `08-cluster`, `09-verified`, `10-recipes`, `11-setups`, `13-main-model`, `14-chats`, `14-rounds`, `16-actions`, `16-reads`, `17-changes`, `18-job-model`, `18-run-record`, `18-step-jobs`, `18-workflows`, `20-danger`, `20-desired`, `20-digest`, `20-heal`, `20-journal`, `20-mcp`, `20-memory`, `20-recall`, `20-state-copy`, `20-tell`, `20-words`, `21-apps`, `21-compare`, `21-guide`, `21-power`, `21-runner`, `21-selftest`, `21-telegram`, `21-updates`, `21-web`, `24-handler`, `25-backup-and-start`

### `08-cluster.mjs`: one model across two linked Sparks

NVIDIA's two-Spark method (build.nvidia.com/spark/vllm-cluster, advanced): native vLLM multi-node, one tensor-parallel rank per Spark, talking over the direct cable. The first Spark is the head and serves the API on its Tailscale address, port 8000, like a single-Spark deploy; the second runs headless. This service starts each part over its own SSH.

- **Area:** ground. **Rules:** R14, R15, R16, R17. **Tests:** across.test.mjs
- **Lines:** 490
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `clusterName`, `workerName`, `clusterNet`, `freeLocalPorts`, `cableCheck`, `spanOf`, `connectLines`, `sockLines`, `stuckAt`, `stuckIn`, `engineCheck`, `clusterPlan`, `clusterEnv`, `clusterRunCommand`, `clusterDeploy`, `asideBack`, `clusterParts`
- **Uses:** `01-setup` (`HttpError`, `nodeById`, `ALL_LOCAL`, `q`, `HF_HUB`, `CONFIG`, `hfSnap`, `hfMounts`, `sleep`), `02-ssh` (`run`), `03-identity` (`canUse`), `05-library` (`containerName`, `imageOf`, `inventory`, `withHow`, `ENGINES`, `engineOf`, `plan`, `fitOf`, `ENGINE_CACHE_ENV`, `engineCache`, `metricsFlags`, `memNow`, `memoryShare`), `06-links` (`fabric`, `lastCheck`, `sameSubnet`), `07-jobs` (`step`, `note`, `unapprovedStops`, `planMoved`, `stopContainer`, `copyModel`), `09-verified` (`answers`, `recordVerified`), `12-status` (`sparkName`), `17-changes` (`withoutRejected`, `fixFlags`, `causeLines`), `18-workflows` (`consoleStopped`), `20-desired` (`cancelCheck`), `25-backup-and-start` (`local`)
- **Used by:** `05-library`, `07-jobs`, `16-reads`, `17-changes`, `18-workflows`, `19-watcher`, `24-handler`

### `09-verified.mjs`: verified deployments

Every deploy that comes up healthy is recorded with exactly how it ran (model, image, flags, memory share, Sparks) and a quick speed test on these Sparks: time to the first token and tokens per second over one 256-token answer. Recipes and the deploy dialog show these as "Verified on your Sparks", next to what others reported.

- **Area:** ground. **Rules:** R15, R22. **Tests:** change.test.mjs, detail.test.mjs
- **Lines:** 150
- **Owns:** verified.json (writers: recordVerified)
- **Timers:** none
- **Wakes:** none
- **Functions:** `verifiedList`, `httpJson`, `answerTest`, `answers`, `measureSpeed`, `recordVerified`, `adoptRunning`, `verifiedView`
- **Uses:** `01-setup` (`STATE_DIR`, `sleep`, `ALL_LOCAL`, `nodeById`, `CONFIG`), `03-identity` (`readKept`, `writePrivate`), `05-library` (`withoutShare`, `inventory`, `engineOf`, `imageOf`), `07-jobs` (`step`, `note`), `13-main-model` (`MAIN`, `mainStatus`, `repoOf`), `15-routes` (`servedModel`), `20-desired` (`keyOf`), `21-brain-check` (`checkBrainSoon`), `25-backup-and-start` (`local`)
- **Used by:** `07-jobs`, `08-cluster`, `10-recipes`, `11-setups`, `13-main-model`, `16-reads`, `17-changes`, `18-workflows`, `20-danger`, `20-mcp`, `20-recall`, `21-apps`, `21-power`, `24-handler`

### `10-recipes.mjs`: recipes

Recipes: service/catalog.json (built by tools/build-catalog.py from the research): models → versions → setups, plus models the owner added (~/.local/state/spark-console/added-models.json) and the setups the finder dug up for any model (found-setups.json, one entry per model, replaced each time it looks again).

- **Area:** knowledge. **Rules:** R20, R27, R30. **Tests:** detail.test.mjs, intent.test.mjs, gateway.test.mjs
- **Lines:** 243
- **Owns:** added-models.json (writers: addModel), found-setups.json (writers: digModel)
- **Timers:** none
- **Wakes:** none
- **Functions:** `addedModels`, `foundSetups`, `recipeCatalog`, `modelKey`, `hfFixtureAnswer`, `hfJson`, `quantOf`, `round1`, `needOf`, `fitSparks`, `variantFields`, `hfFixture`, `versionOf`, `inBatches`, `searchTerms`, `rememberSearch`, `searchModels`, `addModel`, `parseRepoList`, `addList`
- **Uses:** `01-setup` (`STATE_DIR`, `readJsonFile`, `ALL_LOCAL`, `q`, `HttpError`), `03-identity` (`readKept`, `writePrivate`), `07-jobs` (`step`, `note`), `09-verified` (`httpJson`), `11-setups` (`sameRepo`, `DIG_FIXTURE`, `digModel`), `13-main-model` (`chatTarget`), `14-chats` (`modelInUse`), `17-changes` (`inRecipes`)
- **Used by:** `11-setups`, `16-actions`, `16-reads`, `17-changes`, `18-workflows`, `20-memory-names`, `21-power`, `24-handler`

### `11-setups.mjs`: finding setups

For one Recipes model, every published way of running its versions on DGX Spark: NVIDIA's recipes, recipes.vllm.ai, Spark Arena's and eugr's recipe files, NVIDIA's developer forums and the model's own card (its code blocks only). The commands are read out of those by the service itself (dig.mjs), never written by a model. Sparkie only reads forum posts to say which speed belongs to which command, quoting the post, and the quote is checked against it. Each setup then goes through the same checks as the catalog's; its image is pinned to the exact build published now.

- **Area:** knowledge. **Rules:** R10, R22, R27. **Tests:** dig.test.mjs, setups-look.test.mjs
- **Lines:** 443
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `webGet`, `parseYaml`, `cachedIndex`, `ghFiles`, `nvidiaIndex`, `sparkrunIndex`, `arenaIndex`, `eugrIndex`, `vllmRecipeSetups`, `cardText`, `cardSetups`, `squash`, `pinImage`, `digModel`, `startDig`, `recipeIdOf`, `setupsStale`, `refreshSetups`, `lookedUp`, `catalogSetup`, `sameRepo`, `needsDraftModel`, `plainFromBrain`, `resolveHow`, `downloadTargets`, `recipes`, `downloadVersion`
- **Uses:** `01-setup` (`ALL_LOCAL`, `CONFIG`, `HttpError`, `MODELS`, `HF_HUB`, `NODES`, `q`, `sleep`), `02-ssh` (`run`, `fields`), `03-identity` (`writePrivate`), `05-library` (`ENGINES`, `withoutShare`), `07-jobs` (`step`, `note`, `jobs`, `runJob`, `newJob`), `09-verified` (`verifiedList`, `verifiedView`), `10-recipes` (`inBatches`, `hfFixture`, `recipeCatalog`, `foundSetups`, `addedModels`, `REPO_RE`, `hfJson`, `modelKey`, `FINETUNE`, `SKIP_REPO`, `versionOf`, `variantFields`, `FOUND_FILE`), `16-actions` (`onDiskAs`), `20-desired` (`waitJob`, `cancelCheck`)
- **Used by:** `10-recipes`, `16-actions`, `16-reads`, `17-changes`, `18-workflows`, `20-memory`, `21-apps`, `21-power`, `24-handler`

### `12-plugs.mjs`: smart plugs: wall power (contract 9.22)

deploy/plugs.sh runs a Matter controller (matterjs-server, container spark-console-plugs) on Spark 2, with its WebSocket on 127.0.0.1:5580 only, and writes which plug (a controller node) is on which Spark to plugs.json. This part reads every 15 seconds: whether each plug is on and what the whole Spark draws at the wall (watts, volts, amps). switchPlug is the one place in the service that switches a plug (21-power.mjs calls it, R41): only a plug switchablePlug allows, and it checks the plug really switched. The plug that powers Spark Console itself is read only when deploy/plugs.sh proved it …

- **Area:** knowledge. **Rules:** R41. **Tests:** plugs.test.mjs, power.test.mjs
- **Lines:** 178
- **Owns:** plugs.json (writers: none; deploy/plugs.sh writes it)
- **Timers:** refreshPlugs (every 15 s, after a first read 2 s after start)
- **Wakes:** none
- **Functions:** `plugMap`, `switchablePlug`, `plugAsk`, `plugNodes`, `plugAttr`, `plugNumber`, `wallOf`, `refreshPlugs`, `wallFor`, `wallView`, `wallWords`, `freshWall`, `switchPlug`
- **Uses:** `01-setup` (`STATE_DIR`, `ALL_LOCAL`, `nodeById`, `sleep`), `03-identity` (`readJson`), `12-status` (`sparkName`), `17-changes` (`brainSparks`), `23-http` (`send`)
- **Used by:** `12-status`, `16-reads`, `18-step-jobs`, `20-op-energy`, `21-power`

### `12-status.mjs`: Spark status (taking over from the original portal)

Each Spark's status comes from the portal's own worker.py (now shipped with the service), run over the same SSH as everything else, with the same fields the portal reported. It's collected every 30 seconds whether or not anyone is looking, like the portal did, which also keeps the GPU energy total going.

- **Area:** knowledge. **Rules:** R10, R24, R30, R37. **Tests:** fleet.test.mjs, dark.test.mjs, files.test.mjs
- **Lines:** 178
- **Owns:** energy.json (writers: sampleEnergy)
- **Timers:** collectStatus (every 30 s, after a first round 2 s after start)
- **Wakes:** none
- **Functions:** `runWorker`, `sparkName`, `cleanStatus`, `addEnergy`, `sampleEnergy`, `energyView`, `collectStatus`, `statusFor`, `sparkFor`, `workerCall`, `sparkFiles`
- **Uses:** `01-setup` (`HERE`, `PATH_CHECK`, `q`, `pathMissing`, `PATH_PROGRAMS`, `STATE_DIR`, `NODES`, `nodeById`, `HttpError`), `02-ssh` (`knownOffline`, `spawnOn`, `noteReach`), `03-identity` (`readJson`, `refreshNodes`, `canUse`), `12-plugs` (`wallFor`), `16-actions` (`action`), `19-watcher` (`noteSparkStates`), `21-power` (`powerMark`)
- **Used by:** `05-library`, `07-jobs`, `08-cluster`, `12-plugs`, `14-chats`, `15-routes`, `16-actions`, `16-reads`, `17-changes`, `18-job-model`, `18-run-record`, `18-step-jobs`, `18-workflows`, `19-watcher`, `20-danger`, `20-desired`, `20-heal`, `20-journal`, `20-lessons`, `20-needs`, `20-op-energy`, `20-state-copy`, `20-tell`, `20-ways-in`, `20-words`, `21-apps`, `21-copies`, `21-door`, `21-power`, `21-runner`, `21-selftest`, `21-work-shown`, `21-work`, `22-passkey`, `22-sessions`, `24-handler`, `25-backup-and-start`

### `13-ask.mjs`: how the brain is asked and read: its setup's ask block (B9, R50)

What one model needs is said by its brain setup, never by the chat loop (contract 3.11). A setup may carry an `ask` block: how its brain is asked (thinking, maxTokens, sampling, templateKwargs, as today's setups say beside it) and what the loop does for it (mergeRoles, thinkTags, tokenBudget). The chat loop (howAsked, modelStep, turnRounds in 14-rounds.mjs; brainContext in 14-chats.mjs) and the brain check (brainAsk, 21-brain-check.mjs) go through the functions here. A setup with none of the loop's fields is asked and read as the first brain was (a Qwen on SGLang): what it is sent does not …

- **Area:** brain. **Rules:** R50. **Tests:** brain.test.mjs
- **Lines:** 132
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `askBlock`, `withAsk`, `askOf`, `askSet`, `askedMessages`, `usageAsked`, `overBudget`, `answerReader`
- **Uses:** nothing from other parts
- **Used by:** `13-main-model`, `14-chats`, `14-rounds`, `20-memory-names`, `21-brain-check`, `21-guide`

### `13-main-model.mjs`: Sparkie's main model

Sparkie is the one main LLM; which model runs behind it is the owner's choice. This service runs it on its own Spark so chats and agents can reach it at 127.0.0.1. It starts with --restart unless-stopped, so it comes back after reboots until someone stops it here, and it's labeled protected, so deploys never stop it. Setups come from config.json (`main`, or `main.presets`) plus any made from Library models in the console; the one in use is saved in main.json next to the chats, so it survives restarts and installs. A setup's `ask` block says how its brain is asked and read (13-ask.mjs, R50); …

- **Area:** brain. **Rules:** R2, R8, R14, R15, R17, R19, R20, R22, R27, R34. **Tests:** brain.test.mjs, agent-setup.test.mjs
- **Lines:** 309
- **Owns:** main.json (writers: writeMainFile)
- **Timers:** none
- **Wakes:** none
- **Functions:** `configPresets`, `mainPresets`, `loadMainSetup`, `saveMainChoice`, `writeMainFile`, `brainLeftDown`, `markBrainLeftDown`, `saveRoutes`, `routeTarget`, `chatTarget`, `agentTarget`, `mainNode`, `repoOf`, `mainBusy`, `mainSnapshots`, `mainStatusScript`, `mainStatus`, `mainPlan`, `mainRunCommand`, `mainOverlayScript`, `startMain`, `setupFromLibrary`, `switchMain`, `stopMain`
- **Uses:** `01-setup` (`STATE_DIR`, `CONFIG`, `ALL_LOCAL`, `nodeById`, `q`, `HF_HUB`, `hfSnap`, `HttpError`, `isProtected`, `sleep`), `02-ssh` (`run`, `fields`), `03-identity` (`readKept`, `readJson`), `05-library` (`gpuUsersScript`, `inventory`), `07-jobs` (`jobs`, `note`, `stopContainer`, `step`, `copyModel`), `09-verified` (`recordVerified`), `13-ask` (`withAsk`), `21-brain-check` (`checkBrainSoon`), `21-web` (`readable`), `25-backup-and-start` (`local`)
- **Used by:** `05-library`, `09-verified`, `10-recipes`, `14-chats`, `15-routes`, `16-actions`, `16-reads`, `17-changes`, `18-job-model`, `18-workflows`, `19-watcher`, `20-heal`, `20-memory-names`, `20-words`, `21-brain-check`, `21-brain-eval`, `21-compare`, `21-guide`, `21-runner`, `21-updates`, `24-handler`

### `14-chats.mjs`: Sparkie's chats

Sparkie's chats live here: one owner-only JSON file on this Spark. Each person sees only their own chats. Replies keep going (and are saved) if the page closes.

- **Area:** brain. **Rules:** R3, R7, R9, R20, R25, R26, R31, R32, R34, R36, R38, R39, R46. **Tests:** sparkie.test.mjs, sparkie-more.test.mjs, state.test.mjs, tools.test.mjs
- **Lines:** 551
- **Owns:** chats.json (writers: saveChats, chatData; chatData sets an unreadable one aside)
- **Timers:** none
- **Wakes:** none
- **Functions:** `chatData`, `saveChats`, `chatSummary`, `ownChat`, `systemPrompt`, `sparkieToolNames`, `sparkieTools`, `sparkieMessageChoices`, `outcomeText`, `runChoice`, `postResult`, `multiStep`, `chatBusy`, `resultSince`, `wakeWork`, `continueTask`, `unsupportedNumbers`, `stopTurn`, `sparkieTurn`, `turnDoor`, `turnHistory`, `keepWords`, `markAnswering`, `turnRequest`, `brainContext`, `keepTask`, `endTask`, `endTasksFrom`, `turnAnswer`, `turnFailed`, `chatReply`
- **Uses:** `01-setup` (`STATE_DIR`, `HttpError`, `q`, `sleep`, `nodeById`), `03-identity` (`accessList`, `ownerPermissions`), `03-secrets` (`keptHidden`), `07-jobs` (`deploy`, `jobs`), `12-status` (`sparkName`), `13-ask` (`askedMessages`), `13-main-model` (`MAIN`, `chatTarget`, `ASSISTANT_NAME`), `14-rounds` (`howAsked`, `turnBudgets`, `turnGroups`, `turnRounds`, `budgetsOf`), `16-actions` (`ACTIONS`, `liveSchema`, `runAction`, `normQuotes`, `changeIntent`, `PAGE_ONLY_TOOLS`, `AFFIRM`, `REFUSE`), `17-changes` (`pendingChoices`, `sparkieWho`, `agentSettings`), `19-watcher` (`fleetNotes`), `20-danger` (`dangerLive`, `dangerGone`, `dangerPress`), `20-journal` (`journalTurn`, `journalSaid`), `20-keys` (`keysHidden`), `20-lessons` (`lessonSeenBefore`), `20-mcp` (`maskSecrets`), `20-memory-names` (`memorySystem`, `memoryPickBlock`), `20-memory-said` (`keepSaid`), `20-memory-time` (`memoryTodayLine`), `20-tell` (`tellResult`, `tellCarry`, `tell`), `20-tg-approve` (`tgAskOpen`), `21-telegram` (`tgPaired`), `23-http` (`recordFault`)
- **Used by:** `07-jobs`, `10-recipes`, `14-rounds`, `16-reads`, `18-run-record`, `18-saved-from`, `20-danger`, `20-journal`, `20-keys`, `20-mcp`, `20-memory`, `20-needs`, `20-tg-approve`, `20-words`, `21-apps`, `21-brain-check`, `21-compare`, `21-guide`, `21-power`, `21-selftest`, `21-telegram`, `22-passkey`, `22-sessions`, `24-handler`

### `14-rounds.mjs`: Sparkie’s rounds

The rounds of one reply, cut from sparkieTurn (14-chats.mjs), which calls them in order: how the brain is asked and how much it may do, the tools each round offers, one streamed model call, the loop of rounds, one round’s tool calls, and one tool call. They share the turn’s state in one object, `turn`.

- **Area:** brain. **Rules:** R7, R26, R34, R36, R43, R46, R50. **Tests:** sparkie.test.mjs, sparkie-more.test.mjs, tools.test.mjs, words.test.mjs, brain.test.mjs, turn-budgets.test.mjs
- **Lines:** 261
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `howAsked`, `budgetsSet`, `turnBudgets`, `budgetContext`, `budgetCarries`, `budgetsOf`, `workStep`, `budgetsAfter`, `budgetCut`, `budgetReport`, `turnGroups`, `roundTools`, `modelStep`, `turnRounds`, `roundCalls`, `runOne`
- **Uses:** `01-setup` (`HttpError`, `sleep`), `03-identity` (`overLimit`), `05-library` (`plan`), `07-jobs` (`step`), `13-ask` (`usageAsked`, `answerReader`, `overBudget`), `14-chats` (`multiStep`, `CONTINUE_MAX`, `CONTINUE_HOURS`, `systemPrompt`, `modelInUse`, `TURN_STOPPED`, `INSIDE_READS`), `16-actions` (`ACTIONS`, `runAction`), `17-changes` (`agentSettings`), `20-danger` (`dangerParked`), `20-digest` (`DIGEST_AT`, `digestOut`), `20-journal` (`jOwnCall`, `journalTool`), `20-mcp` (`agentWorld`, `maskDeep`, `maskSecrets`), `20-memory-time` (`memoryOffFor`), `21-guide` (`requestGroups`, `toolCap`, `wordGroups`, `openGroup`, `stateGroups`, `offeredNames`), `21-work-shown` (`commandShown`)
- **Used by:** `14-chats`, `21-brain-check`, `21-guide`

### `15-routes.mjs`: choosing what Sparkie and agents use

Running models this service can point Sparkie or agents at: its own main model, console deploys (they listen on the tailnet too), and other model servers on its own Spark. Servers that only listen on another Spark's own address are listed but can't be reached from here.

- **Area:** brain. **Rules:** R5, R36. **Tests:** gateway.test.mjs, paste.test.mjs
- **Lines:** 234
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `runningChoices`, `servedModel`, `setRoute`, `routeView`, `usedRecently`, `runningModels`, `proxyModel`, `startOnCall`, `sparkieApi`, `proxyBrain`
- **Uses:** `01-setup` (`ALL_LOCAL`, `nodeById`, `CONFIG`, `HttpError`), `05-library` (`inventory`, `containerName`), `12-status` (`sparkName`), `13-main-model` (`MAIN`, `mainStatus`, `ROUTES`, `saveRoutes`, `routeTarget`, `agentTarget`), `16-actions` (`recentInventory`, `recent`, `runAction`, `mainArg`), `17-changes` (`resolveModelName`, `inRecipes`), `18-workflows` (`consoleStopped`), `20-desired` (`desired`, `waitJob`), `21-power` (`parkedFor`, `offFor`, `powerState`, `wakeNames`), `23-http` (`send`, `readBody`, `sparkAddresses`, `blockedAddresses`), `24-handler` (`clientAddress`), `25-backup-and-start` (`local`)
- **Used by:** `07-jobs`, `09-verified`, `16-reads`, `17-changes`, `18-job-model`, `18-workflows`, `21-brain-check`, `21-compare`, `21-power`, `24-handler`

### `16-actions.mjs`: actions: what the console can do, as one list for people, Sparkie and agents

Every workflow is a named action with typed inputs, so a model can pick up whichever it needs the same way each time, without opening the page. The agent door (MCP, below) offers them to your own agents; Sparkie's tools and the page's buttons move onto the same list, with the same checks. Each action says: kind 'read' runs straight away. 'change' (next) runs after the checks: dry-run plan, rails, re-check, verify, put back on failure. 'confirm' (deleting data, credentials) waits for the owner. Lock-out risks are never actions. scope which agent keys may use it: 'fleet:read' today; …

- **Area:** core. **Rules:** R7, R9, R11, R12, R18, R21, R23, R25, R32, R35, R36, R37, R38, R46. **Tests:** change.test.mjs, door.test.mjs, api.test.mjs, abilities.test.mjs, intent.test.mjs
- **Lines:** 645
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `action`, `gbOfGiB`, `sparkIdOf`, `sparkList`, `sparkOf`, `checkValue`, `checkInput`, `liveSchema`, `normQuotes`, `sparkNames`, `tokensOf`, `changeIntent`, `pageOnlyLabel`, `pickContainer`, `tracesToRequest`, `planOf`, `modelCandidates`, `namesModel`, `sparkieCheck`, `powerSparksSaid`, `tripBreaker`, `firmModel`, `requestLine`, `runAction`, `recent`, `recentInventory`, `recentMain`, `onDiskAs`, `libraryModel`, `mainArg`, `wordStart`, `filePattern`, `sizeWords`, `filePath`, `sharedFolder`
- **Uses:** `01-setup` (`NODES`, `HttpError`, `q`), `05-library` (`inventory`, `plan`), `07-jobs` (`agentFailuresInARow`, `jobs`), `10-recipes` (`recipeCatalog`), `11-setups` (`squash`, `sameRepo`), `12-status` (`sparkName`, `statusCache`, `sparkFor`, `sparkFiles`), `13-main-model` (`mainStatus`, `MAIN`), `17-changes` (`question`, `changeLabel`, `pendingChoices`, `resolveModelName`, `agentSettings`, `setAgentSettings`, `propose`), `18-saved-from` (`fromRequest`), `18-saved-yes` (`savedImagesLabel`), `18-workflows` (`stepWords`, `findSaved`, `savedWorkflows`, `stepArgs`, `workflowFor`, `workflowStatus`, `offMessage`, `unvalidatedMessage`, `workflowVersion`, `workflowById`), `19-watcher` (`knowledge`, `fleetEvent`), `20-journal` (`journalLooks`, `journalLook`, `journalFirst`, `journalCalled`), `20-mcp` (`audit`, `maskSecrets`, `agentKeys`), `20-memory-tg` (`tgOwnMemory`), `20-memory` (`memoryClear`), `20-tell` (`tellAwait`), `21-apps` (`appNamed`), `21-power` (`powerSettingsClear`)
- **Used by:** `03-identity`, `07-jobs`, `11-setups`, `12-status`, `14-chats`, `14-rounds`, `15-routes`, `16-reads`, `17-changes`, `18-job-model`, `18-run-record`, `18-saved-from`, `18-step-jobs`, `18-workflows`, `19-watcher`, `20-beat`, `20-danger`, `20-desired`, `20-heal`, `20-journal`, `20-keys`, `20-lessons`, `20-mcp`, `20-memory-said`, `20-memory`, `20-needs`, `20-recall`, `20-tell`, `20-tg-approve`, `20-words`, `21-apps`, `21-brain-eval`, `21-compare`, `21-door`, `21-guide`, `21-power`, `21-runner`, `21-selftest`, `21-telegram`, `21-updates`, `21-web`, `21-work-shown`, `21-work`, `22-passkey`, `22-sessions`, `24-handler`

### `16-reads.mjs`: reads: the lookups, what people, Sparkie and agents can look up

Every action here only looks (kind 'read'), so runAction runs it straight away and it changes nothing. The registry (action), the input checks, the gate and runAction are in 16-actions.mjs, which loads first; a helper a lookup shares with a change or with another part stays there too. Moved here whole from 16-actions.mjs (F6, 2026-11-14).

- **Area:** core. **Rules:** R3, R7, R23, R26, R33, R36, R37, R41. **Tests:** door.test.mjs, abilities.test.mjs, detail.test.mjs, dark.test.mjs, files.test.mjs, paste.test.mjs
- **Lines:** 621
- **Actions:** `fleet_status`, `running_models`, `models_on_disk`, `find_recipes`, `recipe_detail`, `search_huggingface`, `where_it_fits`, `deploy_plan`, `cluster_plan`, `linked_sparks`, `spark_detail`, `recent_operations`, `operation_log`, `container_logs`, `spark_diagnostics`, `service_logs`, `files`, `sparkie_setup`, `workloads`, `fleet_events`
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `gbOf`, `recentWorkloads`, `didYouMean`, `mustLibraryModel`, `planSteps`, `fitView`, `pairView`, `flagsKey`, `sameFlags`, `runningDetail`, `darkNow`, `pasteCard`, `estimateFit`, `abilities`
- **Uses:** `01-setup` (`HttpError`, `API_MOUNT`, `nodeById`, `q`, `CONFIG`, `isProtected`, `BUILD`, `STARTED_AT`), `02-ssh` (`run`, `b64json`), `03-identity` (`accessList`), `05-library` (`plainImage`, `withoutShare`, `ENGINES`, `shareIn`, `metricsFlags`, `memoryShare`, `plansFor`, `plan`, `fitOf`, `PLAIN_NOTE`), `06-links` (`lastCheck`, `fabric`), `07-jobs` (`note`, `jobs`, `step`), `08-cluster` (`clusterPlan`), `09-verified` (`verifiedList`, `verifiedView`, `answers`), `10-recipes` (`recipeCatalog`, `searchModels`), `11-setups` (`squash`, `catalogSetup`, `recipes`, `sameRepo`, `lookedUp`), `12-plugs` (`wallView`, `wallWords`), `12-status` (`workerCall`, `statusFor`, `sparkName`, `LOG_SERVICES`), `13-main-model` (`MAIN`, `agentTarget`, `mainNode`, `ROUTES`, `mainPresets`, `repoOf`), `14-chats` (`NEVER_CHANGES`, `chatData`), `15-routes` (`servedModel`, `SPARKIE_ID`, `routeView`), `16-actions` (`recent`, `action`, `recentInventory`, `libraryModel`, `gbOfGiB`, `recentMain`, `mainArg`, `wordStart`, `onDiskAs`, `CREDIBILITY`, `modelArg`, `sparkArg`, `sparkOf`, `sparksArg`, `filePathArg`, `filePath`, `sharedFolder`, `FILE_LIST`, `FILE_SHOW`, `ACTIONS`, `PAGE_ONLY`), `18-workflows` (`WORKFLOW_LOCK`, `lastUpdates`), `19-watcher` (`knowledge`, `lastReading`, `learnedFrom`, `ENGINE_OF_IMAGE`, `darkPeriods`, `readingWords`, `sparkOff`, `WATCH_EVERY`, `events`), `20-mcp` (`consoleOrigin`, `maskDeep`, `hideKeys`), `20-needs` (`needsLines`), `20-tg-approve` (`tgApprovalsLine`), `21-brain-check` (`brainCheck`, `brainCheckView`), `21-power` (`power`, `powerView`, `setupWords`, `asleepView`), `21-telegram` (`telegramView`), `21-work` (`needsOwner`), `22-sessions` (`accessView`), `23-http` (`faultView`)
- **Used by:** `21-power`

### `17-changes.mjs`: actions that change things: say it, and it's done (checked inside)

Sparkie, your agents (with "can change things" on their key) and the spark command all go through these, and each is checked the same way before anything happens: 1. inputs (checkInput) 2. a fresh plan, never the cached view 3. the rails below, in code 4. one change per Spark (claimSparks) 5. inside the operation the plan is made again and has to match what was approved (deploy's stop list), and a pause by the owner stops it there 6. memory is measured after the stops and 8 GB is always kept free 7. it has to answer before it counts 8. on failure, what was stopped is started again. It asks …

- **Area:** core. **Rules:** R1, R2, R3, R7, R8, R9, R12, R13, R15, R16, R17, R27, R35, R37, R38. **Tests:** change.test.mjs, hub.test.mjs, pause.test.mjs, files.test.mjs
- **Lines:** 886
- **Actions:** `start_model`, `stop_model`, `restart_model`, `find_setups`, `save_file`
- **Owns:** agent-settings.json (writers: setAgentSettings)
- **Timers:** none
- **Wakes:** none
- **Functions:** `agentSettings`, `setAgentSettings`, `noStopWords`, `pausedCheck`, `sparkieWho`, `whoAsks`, `question`, `changeLabel`, `propose`, `redeemChoice`, `routedSparks`, `railsFor`, `inRecipes`, `agentSafeSetup`, `placeModel`, `bestHow`, `fullContext`, `freeOn`, `deployPlaced`, `knownStartFailure`, `causeLines`, `rejectedFlags`, `withoutRejected`, `withoutFlags`, `fixFlags`, `startWithFixes`, `launch`, `putBack`, `resolveModelName`, `pickVersion`, `startingNow`, `alreadyStarting`, `brainSparks`, `computeSparks`, `notBrainsSpark`, `acrossGate`, `runsWhereNamed`, `namedInFull`, `startModel`, `stoppedForSure`, `restartChecked`, `restartJob`
- **Uses:** `01-setup` (`STATE_DIR`, `nodeById`, `HttpError`, `CONFIG`, `q`, `NODES`, `isProtected`, `sleep`, `ALL_LOCAL`), `02-ssh` (`run`), `03-identity` (`readJson`, `writePrivate`, `mustUse`), `05-library` (`plan`, `fitOf`, `plansFor`, `ENGINES`, `memNow`, `engineOf`, `shareIn`, `inventory`, `KEEP_FREE`), `06-links` (`lastCheck`), `07-jobs` (`note`, `deploy`, `claimed`, `newJob`, `runJob`, `step`, `jobs`, `claimSparks`, `stopContainer`), `08-cluster` (`clusterPlan`, `clusterDeploy`), `09-verified` (`verifiedList`, `answers`), `10-recipes` (`recipeCatalog`, `REPO_RE`, `versionOf`, `QUANT_ORDER`, `addModel`), `11-setups` (`sameRepo`, `resolveHow`, `needsDraftModel`, `plainFromBrain`, `recipes`, `refreshSetups`, `downloadVersion`, `recipeIdOf`, `startDig`), `12-status` (`sparkName`, `statusFor`), `13-main-model` (`ROUTES`, `MAIN`), `15-routes` (`usedRecently`), `16-actions` (`action`, `pageOnlyLabel`, `sizeWords`, `onDiskAs`, `CREDIBILITY`, `libraryModel`, `wordStart`, `gbOfGiB`, `modelArg`, `sparkArg`, `sparksArg`, `sparkOf`, `filePathArg`, `SAVE_PATH`, `filePath`, `FILE_SAVE_BYTES`, `sharedFolder`), `18-saved-yes` (`savedShown`), `18-workflows` (`findSaved`, `consoleStopped`, `workflowStatus`, `offMessage`, `workflowVersion`), `20-danger` (`dangerForTest`), `20-desired` (`cancelCheck`, `holdsModelsOn`, `cancelJobsAndWait`), `20-lessons` (`setupTried`, `bestHowNow`, `passedOverAsk`, `passedOverLines`, `askedByOwner`, `passedWords`), `20-mcp` (`maskSecrets`, `hideKeys`, `audit`), `20-memory` (`memoryText`), `20-tg-approve` (`tgAsk`), `21-apps` (`appCommand`, `commandWords`, `devBox`, `DEV_BOX_WORDS`, `jobMountsReal`, `JOB_NOT_REAL`, `jobNotReal`), `21-power-pair` (`wakeLiveStatus`, `wakeNeedOf`, `wakeMayPair`, `wakeNeedsTwo`), `21-power` (`parkedFor`, `powerFirst`, `powerState`, `sparksWords`, `wakeNames`)
- **Used by:** `07-jobs`, `08-cluster`, `10-recipes`, `12-plugs`, `14-chats`, `14-rounds`, `15-routes`, `16-actions`, `18-step-jobs`, `18-workflows`, `20-danger`, `20-desired`, `20-digest`, `20-heal`, `20-journal`, `20-lessons`, `20-mcp`, `20-memory-said`, `20-memory`, `20-recall`, `20-tell`, `20-tg-approve`, `20-words`, `21-apps`, `21-compare`, `21-door`, `21-power-pair`, `21-power`, `21-runner`, `21-selftest`, `22-passkey`, `22-sessions`, `24-handler`, `25-backup-and-start`

### `18-job-model.mjs`: a saved workflow's job is handed the one model address (D7)

The address rule (design D 2.4 and 2.3's "handing results on", as cut): a job a saved workflow's run starts from its image (keep_running with once and an image) is told where its model is, in its settings: SPARK_MODEL_URL, Spark Console's one OpenAI-compatible address (the one the self-test's job calls from inside its container, 9.9); SPARK_MODEL_NAME, the model to ask there; SPARK_MODEL_PARALLEL, how many calls it may make at once. Which model: the one the step's own settings name (SPARK_MODEL_NAME), else the one an earlier step of this run started or found running (jobModel: a start's …

- **Area:** core. **Rules:** R57, R36. **Tests:** workloads-address.test.mjs
- **Lines:** 53
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `jobModelAddress`, `jobModel`, `jobFromImage`, `jobModelEnv`
- **Uses:** `01-setup` (`nodeById`), `05-library` (`inventory`), `07-jobs` (`note`), `12-status` (`sparkName`), `13-main-model` (`MAIN`), `15-routes` (`SPARKIE_ID`), `16-actions` (`action`, `sparkIdOf`, `mainArg`), `21-selftest` (`selfTestAddress`)
- **Used by:** `18-workflows`, `21-compare`

### `18-run-record.mjs`: a saved workflow's run, kept on disk so a restart of Spark Console finishes it (D6f)

Design D 2.3: "after a console restart, code stops in reverse order what this run started". A run keeps a small record of itself in saved-runs.json (R20: writePrivate and readKept; names, Spark ids and the chat id, no secret), rewritten as it goes: its title, the chat that asked, how many steps and which one it is at, what its finished steps started (`started`, as stopWhatRan reads it), what a step under way has answered `started` for and is still bringing up (`pending`: a restart_model or keep_running step's container, known from its own arguments; a start's container is known only once its …

- **Area:** core. **Rules:** R57. **Tests:** workloads-restart.test.mjs
- **Lines:** 86
- **Owns:** saved-runs.json (writers: savedRunKeep, savedRunDone, savedRunsRecover)
- **Timers:** none
- **Wakes:** none
- **Functions:** `savedRunsNow`, `savedRunWords`, `savedRunKeep`, `savedRunDone`, `savedRunPending`, `savedRunCutOff`, `savedRunsRecover`
- **Uses:** `01-setup` (`STATE_DIR`, `nodeById`, `NAME_RE`), `02-ssh` (`fields`), `03-identity` (`readKept`, `writePrivate`, `accessList`), `07-jobs` (`note`, `jobs`), `12-status` (`sparkName`), `14-chats` (`chatData`, `saveChats`), `16-actions` (`action`, `sparkIdOf`), `18-step-jobs` (`stopWhatRan`), `19-watcher` (`fleetEvent`), `20-heal` (`healOwner`), `20-mcp` (`maskSecrets`), `20-tell` (`tell`)
- **Used by:** `18-step-jobs`, `18-workflows`, `19-watcher`

### `18-saved-from.mjs`: "save that as …": a saved workflow from the changes a request made (D6e)

save_workflow {title, from: "this request"} saves the chain of changes the journal recorded for the request just before this one, in this chat (contract 9.7's "save this as …"; the critic's cut of B7 and D's pipelines). Only in the owner's own chat with Sparkie, on the page or Telegram, or a press of its button there: never an agent (its key, ask_sparkie or a chat an agent started) and never POST /actions, which has no chat; R43's own-call test. The records are this chat's alone (`chat`): its two newest `said` lines bound the request (the owner's words that asked, then the words asking to …

- **Area:** core. **Rules:** R35, R43. **Tests:** workloads-save.test.mjs
- **Lines:** 53
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `fromRequest`, `requestSteps`
- **Uses:** `01-setup` (`HttpError`), `14-chats` (`chatData`), `16-actions` (`ACTIONS`, `action`), `18-workflows` (`NOT_A_STEP`, `APPROVAL_ARGS`), `20-journal` (`journalFiles`, `jLinesOf`, `jParse`, `jMerge`)
- **Used by:** `16-actions`, `18-workflows`

### `18-saved-yes.mjs`: the yes at save covers a saved workflow's images (D6c)

A new image is code that runs on a Spark, so keep_running starts one at once only for the owner on their tailnet, and otherwise asks the owner (R38). A saved workflow's steps run as `workflow`, so until now a step with a new image always asked. Now the owner's yes to a save is also the yes to the images its steps name (contract 9.27; design D 2.3, and its question 2 as recommended). The yes is a button the owner presses, whose label lists every step, a keep_running step with an image whole, and says the press is also the yes to those images and that a tag can change (pageOnlyLabel, stepWords, …

- **Area:** core. **Rules:** R35, R38. **Tests:** workloads-images.test.mjs
- **Lines:** 72
- **Owns:** none (saved-workflows.json's `approved`, written by writeSaved in 18-workflows.mjs)
- **Timers:** none
- **Wakes:** none
- **Functions:** `savedStepsHash`, `stepCovered`, `savedStepKey`, `savedShown`, `savedImages`, `savedCover`, `savedImagesLabel`, `savedImagesYes`, `savedImagesWords`, `stepImagesYes`
- **Uses:** `18-workflows` (`placeholders`, `stepLine`, `NOT_SHOWN`)
- **Used by:** `16-actions`, `17-changes`, `18-workflows`, `21-compare`

### `18-step-jobs.mjs`: a saved workflow's run: steps placed, job steps waited on, and what a failed run started stopped (D6a, D6b, D6d)

A step that runs a job (keep_running with once true, or one whose answer says it is a job: run again, or already running) is done when the job's container has ended, not when it started (contract 9.27; design D 2.3 as cut by critic-simplicity.md). run_workflow waits for the step's own operation as for any step (stepOpEnd), then calls jobStepEnd, which follows the job with waitJobEnd: its one fixed `docker inspect` of that container every 10 s through `run` (the look the self-test uses; no new timer), for STEP_JOB_MS at most (6 hours, D 2.3). Exit 0 goes on to the next step. Anything else ends …

- **Area:** core. **Rules:** R35, R38. **Tests:** steps.test.mjs, workloads.test.mjs, workloads-place.test.mjs
- **Lines:** 233
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `forHowLong`, `sleepUnless`, `jobStepEnd`, `stepOpEnd`, `savedStepAgent`, `startedBy`, `startedListed`, `stopWhatRan`, `stopAppStarted`, `runCleanUp`, `runEndWell`, `savedStepStarts`, `savedStepShape`, `placedStep`, `stepInput`, `firstSentence`, `placeStep`, `letSleep`, `pickSpark`
- **Uses:** `01-setup` (`nodeById`, `q`, `sleep`, `HttpError`), `02-ssh` (`run`, `fields`), `05-library` (`inventory`), `07-jobs` (`step`, `note`, `jobs`), `12-plugs` (`switchablePlug`), `12-status` (`sparkName`), `16-actions` (`sparkIdOf`, `action`, `runAction`, `ACTIONS`), `17-changes` (`computeSparks`), `18-run-record` (`savedRunKeep`), `19-watcher` (`knowledge`), `20-desired` (`cancelJob`, `waitJob`, `desiredPutBack`), `20-mcp` (`maskSecrets`), `21-apps` (`waitJobEnd`, `APP_MEMORY_GB`, `gpuAlone`, `appLook`, `appRoom`), `21-power` (`consoleOff`, `keepAwake`, `power`, `doneWith`, `wakeOne`)
- **Used by:** `18-run-record`, `18-workflows`, `21-apps`

### `18-workflows.mjs`: workflows

Every change Spark Console makes is a workflow: a named procedure with checked inputs, fixed steps, a check that it worked, a put-back, and its known problems with their fixes (docs/contract.md, section 6). Sparkie and agents choose a workflow and fill in its inputs; they never make up the steps. A workflow's version is a fingerprint of its code (the functions it runs, its action, its known problems, and the worker that runs on the Sparks), so any change to that code is a new version. A version runs only once it's validated twice: - tested: the whole test suite passed with this exact build …

- **Area:** core. **Rules:** R10, R11, R18, R19, R20, R22, R25, R29, R30, R31, R32, R34, R35, R37. **Tests:** workflows.test.mjs, steps.test.mjs, validate.test.mjs, updates.test.mjs, heal.test.mjs
- **Lines:** 699
- **Actions:** `workflows`, `save_workflow`, `run_workflow`, `forget_workflow`, `wait_operation`, `test_changes`, `undo_update`
- **Owns:** validations.json (writers: recordWorkflowRun), saved-workflows.json (writers: writeSaved), heal-tries.json (writers: saveHealTries), updates.json (writers: noteUpdate), update-note.json (writers: none; the installer writes it, noteUpdate reads it)
- **Timers:** none
- **Wakes:** none
- **Functions:** `WORKER_SOURCE`, `START_CODE`, `workflowById`, `workflowFor`, `workflowVersion`, `WORKFLOW_LOCK`, `validations`, `workflowStatus`, `recordWorkflowRun`, `offMessage`, `unvalidatedMessage`, `pageWorkflow`, `rehearse`, `savedWorkflows`, `workflowSlug`, `fillIn`, `placeholders`, `savedView`, `findSaved`, `writeSaved`, `stepArgs`, `stepWords`, `notShown`, `stepLine`, `missingTarget`, `checkFailsForTest`, `checkSteps`, `saveHealTries`, `healTriesThisHour`, `lastOnOff`, `maybeHeal`, `stepRun`, `testModels`, `validateChanged`, `lastSnapshot`, `updatesFrom`, `noteUpdate`, `lastUpdates`, `startTestChanges`, `undoUpdate`
- **Uses:** `01-setup` (`hfMounts`, `HF_OWN`, `hfEachFile`, `isProtected`, `ALL_LOCAL`, `STATE_DIR`, `BUILD`, `HttpError`, `nodeById`, `sleep`, `q`), `02-ssh` (`run`), `03-identity` (`readKept`, `writePrivate`, `readJson`, `accessList`, `ownerPermissions`), `05-library` (`plansFor`, `fitOf`, `gpuUsersScript`, `shareIn`, `memoryShare`, `ENGINE_CACHE_ENV`, `engineCacheDir`, `engineCache`, `metricsFlags`, `memNow`, `plan`, `dockerRunCommand`, `ENGINES`, `inventory`, `containerName`), `07-jobs` (`unapprovedStops`, `planMoved`, `stopContainer`, `copyModel`, `deploy`, `step`, `note`, `newJob`, `runJob`, `jobs`), `08-cluster` (`asideBack`, `clusterDeploy`, `clusterPlan`, `clusterRunCommand`, `clusterNet`, `cableCheck`, `freeLocalPorts`, `CABLE_CHECK_PY`, `clusterParts`, `connectLines`, `spanOf`, `LOADING_RE`, `DUMP_PY`, `sockLines`, `stuckAt`, `stuckIn`, `clusterEnv`, `CLUSTER_PINNED_ENV`, `engineCheck`, `ENGINE_CHECK_PY`, `ENGINE_CHECK_NAME`), `09-verified` (`answerTest`, `answers`, `httpJson`, `recordVerified`, `verifiedList`), `10-recipes` (`recipeCatalog`, `addModel`, `versionOf`, `hfFixture`, `REPO_RE`), `11-setups` (`downloadVersion`, `resolveHow`, `needsDraftModel`, `plainFromBrain`, `refreshSetups`, `setupsStale`, `recipeIdOf`, `digModel`, `startDig`, `nvidiaIndex`, `eugrIndex`, `arenaIndex`, `sparkrunIndex`, `vllmRecipeSetups`, `pinImage`, `cardSetups`, `cardText`), `12-status` (`sparkName`), `13-main-model` (`MAIN`), `15-routes` (`usedRecently`), `16-actions` (`action`, `ACTIONS`, `recentInventory`, `sparkIdOf`, `checkInput`, `libraryModel`, `runAction`), `17-changes` (`startModel`, `notBrainsSpark`, `brainSparks`, `computeSparks`, `acrossGate`, `placeModel`, `railsFor`, `agentSafeSetup`, `startingNow`, `runsWhereNamed`, `resolveModelName`, `pickVersion`, `launch`, `deployPlaced`, `startWithFixes`, `knownStartFailure`, `causeLines`, `rejectedFlags`, `withoutRejected`, `withoutFlags`, `fixFlags`, `putBack`, `bestHow`, `namedInFull`, `fullContext`, `freeOn`, `START_FAILURES`, `stoppedForSure`, `routedSparks`, `restartChecked`, `restartJob`, `changeLabel`, `agentSettings`, `inRecipes`, `question`), `18-job-model` (`jobFromImage`, `jobModelEnv`, `jobModel`), `18-run-record` (`savedRunKeep`, `savedRunPending`, `savedRunDone`), `18-saved-from` (`fromRequest`), `18-saved-yes` (`savedCover`, `savedImagesYes`, `savedStepsHash`, `savedImagesWords`, `stepImagesYes`), `18-step-jobs` (`stepInput`, `WAKES_FOR_STEP`, `placedStep`, `savedStepShape`, `placeStep`, `savedStepStarts`, `savedStepAgent`, `startedListed`, `stepOpEnd`, `startedBy`, `jobStepEnd`, `runEndWell`, `runCleanUp`, `letSleep`), `19-watcher` (`fleetEvent`, `events`), `20-desired` (`cancelCheck`, `cancelJobsAndWait`, `holdsModelsOn`, `CHANGES_MODELS`, `desired`, `keyOf`, `waitJob`), `20-lessons` (`setupTried`, `lessonOf`, `lessonsKept`, `PASS_OVER_FAILURES`, `failedTwice`, `bestHowNow`, `passedWords`, `passedOverLines`, `askedByOwner`, `passedOverAsk`), `20-mcp` (`maskSecrets`, `audit`), `21-apps` (`jobMountsReal`, `jobNotReal`, `JOB_NOT_REAL`, `SHARED_AT`, `devBox`, `DEV_BOX_WORDS`), `21-compare` (`compareStep`), `21-power-pair` (`wakeNeedOf`, `wakeMayPair`, `wakePartner`, `wakeNeedsTwo`, `wakeLiveStatus`), `21-power` (`powerFirst`, `parkedFor`, `wakeNames`, `offFor`, `wakeOne`, `offHolds`, `powerThenStart`, `powerThen`, `powerOnSparks`, `powerOnOne`, `bringBackParked`, `consoleOff`), `21-selftest` (`selfTestModels`)
- **Used by:** `07-jobs`, `08-cluster`, `15-routes`, `16-actions`, `16-reads`, `17-changes`, `18-saved-from`, `18-saved-yes`, `19-watcher`, `20-heal`, `20-lessons`, `21-apps`, `21-brain-check`, `21-compare`, `21-guide`, `21-power`, `21-selftest`, `24-handler`, `25-backup-and-start`

### `19-watcher.mjs`: watching the fleet: what runs, what changed, and what it learns

Every minute the console looks at every container on every Spark (models, services, dev boxes, anything started by hand) and remembers how each was started: image, command (secrets hidden), ports, mounts, GPU use, and the names (never the values) of its environment variables. Changes become events: started, stopped, crashed, removed, a Spark going offline or coming back, and the console's own operations. A model server someone started by hand, from an image source the console trusts, is saved as a recipe ("worked before"), so it can be started again like any other. Sparkie and agents read all …

- **Area:** core. **Rules:** R7, R19, R21, R23, R24, R38. **Tests:** fleet.test.mjs, dark.test.mjs, docker-down.test.mjs, state.test.mjs
- **Lines:** 330
- **Owns:** knowledge.json (writers: saveKnowledge), events.jsonl (writers: fleetEvent)
- **Timers:** watchFleet (15 s after start, then every 60 s)
- **Wakes:** none
- **Functions:** `events`, `fleetEvent`, `describeEvent`, `reading`, `lastReading`, `readingWords`, `darkPeriods`, `watchScript`, `learnedFrom`, `watchSpark`, `learnRecipe`, `learnModels`, `noteSparkStates`, `saveKnowledge`, `watchFleet`, `sparkOff`, `fleetNotes`
- **Uses:** `01-setup` (`STATE_DIR`, `q`, `isProtected`, `CONFIG`, `NODES`), `02-ssh` (`run`, `fields`, `b64json`), `03-identity` (`readJson`, `writePrivate`, `refreshNodes`), `08-cluster` (`ENGINE_CHECK_NAME`), `12-status` (`sparkName`), `13-main-model` (`MAIN`), `16-actions` (`libraryModel`, `recentInventory`), `18-run-record` (`savedRunCutOff`, `savedRunsRecover`), `18-workflows` (`healDrills`, `maybeHeal`, `WORKFLOWS`, `workflowStatus`), `20-desired` (`desired`, `keyOf`, `heldLast`), `20-heal` (`HEAL_OFFLINE_MS`), `20-journal` (`journalEvent`), `20-mcp` (`maskDeep`), `20-needs` (`needsLines`), `20-state-copy` (`copyOnWake`), `21-apps` (`jobEnded`), `21-power` (`powerState`, `POWER_WHY`, `powerMark`), `21-selftest` (`selfTestCutOff`), `21-telegram` (`tgProblem`, `TG_WORDS`, `tg`)
- **Used by:** `03-identity`, `07-jobs`, `12-status`, `14-chats`, `16-actions`, `16-reads`, `18-run-record`, `18-step-jobs`, `18-workflows`, `20-desired`, `20-heal`, `20-memory-names`, `20-needs`, `20-state-copy`, `20-tg-approve`, `20-words`, `21-apps`, `21-compare`, `21-power`, `21-runner`, `21-selftest`, `21-telegram`, `22-passkey`, `22-sessions`, `24-handler`

### `20-beat.mjs`: the outside heartbeat: an outside service notices when Spark 2 stops

Once the owner has saved a check's ping address (Healthchecks.io: https://hc-ping.com/<uuid>), pasted in their own chat (20-keys.mjs) or with the passkey (PUT /heartbeat), Spark Console sends it one GET every 5 minutes, so that service raises the alarm (by email, or its own Telegram bot) when Spark 2 or the console goes quiet. Silence is the signal, so this is the one timer that ticks when nothing changed. The request carries nothing: no body, no query, no cookie, one fixed User-Agent. The host is fixed; what the owner saves only names the check, and a redirect is never followed. The address …

- **Area:** safety. **Rules:** R32, R51. **Tests:** beat.test.mjs, app-keys.test.mjs
- **Lines:** 110
- **Owns:** none
- **Timers:** beatStart (once, a minute after the listen callback: the first beat), beatOnce (every 5 minutes after that, and from a beat at once when an address is saved)
- **Wakes:** none
- **Functions:** `beatEnv`, `beatAddress`, `beatOnce`, `beatStart`, `beatLate`, `beatView`, `heartbeatRoute`, `beatSave`
- **Uses:** `01-setup` (`ALL_LOCAL`, `HttpError`), `03-secrets` (`secretsRead`, `secretsWrite`, `SECRETS_FILE`), `16-actions` (`action`), `20-mcp` (`audit`), `22-passkey` (`passkeys`), `23-http` (`send`, `readBody`)
- **Used by:** `20-keys`, `20-needs`, `24-handler`, `25-backup-and-start`

### `20-danger.mjs`: the dangerous ask: hard to tap by reflex (A10b)

Before root, a lock-out change, an install of Spark Console, a delete that cannot be put back and the brain (design A 2.14; contract 8.18), a raiser calls dangerAsk in place of question(). The ask is a message of its own that holds no word of the brain's: facts built by code (what and where, whether the owner asked, whether it goes back, what came from outside), the exact bytes the press runs in a fixed-width block, then the two digits to type with its own yes. One is open at a time in the whole console. The digits live only with the open ask in memory and in its own text (the Telegram …

- **Area:** safety. **Rules:** R54. **Tests:** danger.test.mjs
- **Lines:** 401
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `dangerEnvMs`, `dangerPlain`, `dangerHhmm`, `dangerSha`, `dangerSame`, `dangerHead`, `dangerCodeOf`, `dangerBack`, `dangerMore`, `dangerThings`, `dangerWhole`, `cameFrom`, `dangerJournalText`, `dangerReadsLoaded`, `dangerAskedFor`, `dangerOwnerWords`, `dangerAsk`, `dangerBound`, `dangerJournal`, `dangerLive`, `dangerClose`, `dangerGone`, `dangerHeadOf`, `dangerStopped`, `dangerPaused`, `dangerTelegramGone`, `dangerParked`, `dangerShown`, `dangerTell`, `dangerPressedHere`, `dangerWrong`, `dangerTypedHere`, `dangerPress`, `dangerForTest`
- **Uses:** `01-setup` (`ALL_LOCAL`, `nodeById`, `HttpError`, `q`, `STATE_DIR`, `sleep`), `03-identity` (`accessList`), `07-jobs` (`note`), `09-verified` (`answers`), `12-status` (`sparkName`), `14-chats` (`chatData`, `saveChats`, `replying`), `16-actions` (`sizeWords`, `action`, `ACTION_KIND`, `tokensOf`, `ACTIONS`), `17-changes` (`question`, `pendingChoices`), `20-journal` (`journalFiles`, `jLinesOf`, `jParse`, `jFile`, `journal`, `jSub`), `20-mcp` (`maskSecrets`), `20-tell` (`TELL_PART`, `tell`), `20-tg-approve` (`tgAsks`, `tgApproveOn`, `TG_ASK_MAX`, `tgAskOpen`, `tgApprovalsHeld`), `21-telegram` (`tgPaired`, `tg`, `tgRun`)
- **Used by:** `14-chats`, `14-rounds`, `17-changes`, `20-tg-approve`, `20-words`, `21-telegram`, `24-handler`

### `20-desired.mjs`: what should be running (docs/contract.md 6.13, 8.8–8.10)

The owner's list of what should be running on each Spark: every model a change started, in numbered revisions. A start adds to it and a stop takes away, when they finish. Self-healing keeps crashed ones running (6.12). One that isn't running and won't come back by itself (cut off by a power loss, crash-looping, stopped outside Spark Console, its Spark gone) is *held*: the owner brings it back with one click, or forgets it. Nothing here ever stops anything. "Cancel" stops an operation at its next step and puts back what it did; "undo" goes back to the revision before this chat's last change.

- **Area:** record. **Rules:** R9, R20, R21, R22, R38, R57. **Tests:** desired.test.mjs, desired-look.test.mjs, workloads.test.mjs
- **Lines:** 298
- **Actions:** `should_be_running`, `cancel_operation`, `undo_last_change`
- **Owns:** desired.json (writers: desiredAfter, keepApp, forgetApp, watchHeld, markUndone, handler, parkDesired, desiredPutBack)
- **Timers:** watchHeld (every 60 s; its first round seeds desired.json)
- **Wakes:** none
- **Functions:** `desired`, `keyOf`, `desiredAfter`, `keepApp`, `forgetApp`, `parkDesired`, `desiredPutBack`, `desiredNow`, `watchHeld`, `cancelJob`, `cancelCheck`, `holdsModelsOn`, `cancelRunningOn`, `cancelJobsAndWait`, `waitJob`
- **Uses:** `01-setup` (`STATE_DIR`, `nodeById`, `sleep`, `HttpError`), `02-ssh` (`run`), `03-identity` (`readKept`, `writePrivate`), `07-jobs` (`jobs`, `note`, `newJob`, `runJob`, `step`), `12-status` (`sparkName`), `16-actions` (`recentInventory`, `lookBegan`, `action`, `runAction`), `17-changes` (`brainSparks`), `19-watcher` (`knowledge`, `events`, `sparkOff`, `fleetEvent`), `21-apps` (`appStates`, `appNow`), `21-power` (`parkedWhy`, `poweredOffNow`), `21-runner` (`runnerUndo`), `21-selftest` (`selfTestModels`)
- **Used by:** `07-jobs`, `08-cluster`, `09-verified`, `11-setups`, `15-routes`, `17-changes`, `18-step-jobs`, `18-workflows`, `19-watcher`, `20-heal`, `20-needs`, `21-apps`, `21-compare`, `21-door`, `21-power`, `21-selftest`, `24-handler`

### `20-digest.mjs`: the digest: a long tool result cut by code into its numbered lines that matter (G5)

A tool result longer than DIGEST_AT (12,000 characters) no longer enters Sparkie's turn as its first 12,000 characters (design G 3.4, A4, step 5). Code makes a digest of it, with no model call and no file read (runOne, digestOut): the text is seen as lines in one pass, whatever it holds (textLines: a newline ends a line, and in JSON an escaped one too; a line past 300 characters goes on in the next). It keeps the first line and the last three, then the lines that name a failure (an error word, an exit code that isn't 0, out of memory, an …Error name, a known start failure; an empty JSON field …

- **Area:** record. **Rules:** R59. **Tests:** digest.test.mjs, work.test.mjs
- **Lines:** 141
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `digestFails`, `textSplit`, `textLines`, `digestText`, `digestOut`, `recordPart`
- **Uses:** `01-setup` (`HttpError`), `02-ssh` (`run`), `07-jobs` (`note`), `17-changes` (`START_FAILURES`), `20-journal` (`jFile`), `20-mcp` (`maskSecrets`), `20-memory-names` (`memorySizes`), `21-web` (`readable`)
- **Used by:** `14-rounds`, `20-journal`

### `20-heal.mjs`: self-healing, more of it (v3.1, 2026-11-11)

Fixing things by itself is what matters most to the owner (2026-11-11). On top of a crashed one-Spark model coming back (maybeHeal), every minute, with the owner's switch (automatic restarts) on and agents not paused: - a model across two Sparks that lost a part: what's left of it stops, and it starts again across the same Sparks (start_model, so the cable and engine checks and the known fixes run); - a Spark the owner powered back on: what should be running there (should_be_running) comes back, once its Sparks have been up 2 minutes (Docker and the GPU settle), once per power-on (a Spark …

- **Area:** safety. **Rules:** R7, R8, R11, R18, R19, R21, R34, R38. **Tests:** heal.test.mjs, heal-more.test.mjs, heal-newer.test.mjs, heal-displaced.test.mjs, heal-power.test.mjs
- **Lines:** 261
- **Owns:** none
- **Timers:** healPass (every 60 s)
- **Wakes:** none
- **Functions:** `healOwner`, `healCount`, `healMark`, `cameBack`, `healSkip`, `healReason`, `bringBack`, `brainRestartCommand`, `restartBrain`, `keepBrain`, `watchBrain`, `displacedBy`, `healPass`
- **Uses:** `01-setup` (`nodeById`, `q`), `02-ssh` (`run`), `03-identity` (`accessList`, `ownerPermissions`), `07-jobs` (`busySparks`, `claimSparks`, `claimed`, `newJob`, `runJob`, `jobs`), `12-status` (`sparkName`), `13-main-model` (`MAIN`, `brainLeftDown`, `markBrainLeftDown`, `mainNode`, `startMain`, `mainStatus`), `16-actions` (`runAction`, `action`, `recentInventory`), `17-changes` (`agentSettings`), `18-workflows` (`healTries`, `saveHealTries`, `consoleStopped`, `HEAL_MIN_RUN`, `workflowStatus`), `19-watcher` (`events`, `fleetEvent`, `sparkOff`, `knowledge`), `20-desired` (`keyOf`, `desired`), `20-mcp` (`audit`, `maskSecrets`), `21-apps` (`healApp`), `21-power` (`consoleOff`, `power`)
- **Used by:** `18-run-record`, `19-watcher`, `20-words`, `21-apps`, `21-brain-check`, `21-compare`, `21-power`, `21-selftest`

### `20-journal.mjs`: the journal: what was said, called, run and seen here, kept on Spark 2 (B1, R43)

Spark Console's own record of what happens through it, so it is still known after a restart (operation_log forgets then) and can be looked up (recall). Append-only: never rewritten, never deleted, never copied off Spark 2. Its folder (JOURNAL_DIR, 0700, files 0600) is outside the state folder, so neither the daily copy nor an install snapshot takes it. Two files a month: journal-YYYY-MM.jsonl, one short line per record (1,500 bytes at most), and journal-YYYY-MM.out, a record's long text (a tool's result, an operation's log), written in pieces as it is read and masked piece by piece; its line …

- **Area:** record. **Rules:** R7, R22, R26, R43. **Tests:** journal.test.mjs, door.test.mjs, fuzz.test.mjs
- **Lines:** 370
- **Actions:** `recall`
- **Owns:** none (its own files, journal-YYYY-MM.jsonl and .out in JOURNAL_DIR, are outside the state folder; one writer, journal)
- **Timers:** none
- **Wakes:** none
- **Functions:** `journalId`, `jSub`, `jErr`, `jArgs`, `jArgsKept`, `jFile`, `jMasker`, `jSlices`, `jBody`, `jLine`, `journal`, `journalFirstFor`, `jCall`, `journalFirst`, `journalCalled`, `journalLooks`, `journalLook`, `journalSaid`, `journalTool`, `journalTurn`, `journalNote`, `jOpText`, `journalOp`, `journalEvent`, `journalFiles`, `jParse`, `jLinesOf`, `jWhere`, `jTitle`, `jCommand`, `jView`, `jMerge`, `jOwnCall`, `jSaidHere`, `jWho`, `jOpen`, `jShut`, `jSees`, `jRecord`, `journalHits`, `journalAfterRestart`, `journalNeeds`
- **Uses:** `01-setup` (`ALL_LOCAL`, `JOURNAL_DIR`, `HttpError`, `nodeById`), `02-ssh` (`fields`, `run`), `03-identity` (`clean`), `07-jobs` (`note`), `12-status` (`sparkName`), `14-chats` (`chatData`, `saveChats`), `16-actions` (`ACTIONS`, `sizeWords`, `action`, `sparkArg`), `17-changes` (`START_FAILURES`, `knownStartFailure`), `20-digest` (`recordPart`), `20-mcp` (`maskSecrets`, `maskDeep`), `20-needs` (`SAVE_WHY`, `tilde`), `20-op-energy` (`opWh`), `20-recall` (`recallAnswer`)
- **Used by:** `07-jobs`, `14-chats`, `14-rounds`, `16-actions`, `18-saved-from`, `19-watcher`, `20-danger`, `20-digest`, `20-keys`, `20-lessons`, `20-memory-said`, `20-needs`, `20-recall`, `21-runner`, `21-work`, `25-backup-and-start`

### `20-keys.mjs`: keys given once: taken out of the owner's words at the door, kept by name

A key, token or address the owner gives in their own chat (the page, or the paired Telegram chat) is taken out of the message here, before anything else reads it: the chat file, the journal, the audit, a title, the gate, the brain. Two forms: "/key NAME value" (the value alone, after the name or on the next line), and the heartbeat's address, known by its shape anywhere in the words. It is kept by name in the secrets file (03-secrets.mjs, through secretsWrite), never shown back, and its exact value is hidden wherever text is written or sent (keptHidden, which hideKeys runs first). Two names …

- **Area:** safety. **Rules:** R51, R7, R32. **Tests:** app-keys.test.mjs
- **Lines:** 179
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `keyNameOk`, `keysGiven`, `keysHidden`, `keepKey`, `keepNamed`, `keepGithub`, `keepBeat`, `giveKey`, `hideKeptInChats`, `answerKeys`, `tgKeys`
- **Uses:** `01-setup` (`HttpError`, `ALL_LOCAL`), `03-identity` (`accessList`), `03-secrets` (`keptHidden`, `secretsWrite`, `secretsRead`, `SECRETS_FILE`, `keptSeen`), `14-chats` (`LIMITS`, `saveChats`, `chatData`), `16-actions` (`action`), `20-beat` (`BEAT_URL_RE`, `beatSave`), `20-journal` (`journalSaid`), `20-mcp` (`hideKeys`, `maskSecrets`, `audit`), `20-tell` (`tell`), `21-telegram` (`tgPaired`, `tgCall`, `tgConv`)
- **Used by:** `14-chats`, `20-mcp`, `21-telegram`, `21-updates`, `24-handler`

### `20-lessons.mjs`: lessons: what failed, written by code when an operation ends (B2, R48)

A lesson is Spark Console's own short record of a failure (contract 5.10; design B 2.2 as cut): what was tried, on what, and the known way it failed. Code writes it when an operation ends (learnFrom, at runJob's end), from the console's own typed facts on the job, never from a log's, the brain's or the owner's words: every value is one of the console's names that its pattern allows and no mask would change, a hash, an id from a fixed list, a number or a time, else null. A start: the model, its engine and how many Sparks; the setup it tried (setupTried, which the start puts on the job before …

- **Area:** record. **Rules:** R7, R20, R22, R48. **Tests:** lessons.test.mjs, passed-over.test.mjs, lesson-cards.test.mjs
- **Lines:** 228
- **Owns:** lessons.json (writers: recordLesson)
- **Timers:** none
- **Wakes:** none
- **Functions:** `lValue`, `lSparks`, `setupTried`, `lessonOf`, `lessonsKept`, `recordLesson`, `learnFrom`, `failedTwice`, `bestHowNow`, `passedWords`, `passedOverLines`, `askedByOwner`, `passedOverAsk`, `lessonDay`, `lessonTried`, `lessonFailWords`, `lessonCard`, `lessonSeenBefore`
- **Uses:** `01-setup` (`STATE_DIR`, `nodeById`, `HttpError`), `03-identity` (`readKept`, `writePrivate`), `05-library` (`withHow`, `engineOf`, `imageOf`, `ENGINES`), `12-status` (`sparkName`), `16-actions` (`action`), `17-changes` (`knownStartFailure`, `bestHow`, `START_FAILURES`, `question`), `18-workflows` (`workflowVersion`), `20-journal` (`START_JOBS`), `20-mcp` (`maskSecrets`)
- **Used by:** `07-jobs`, `14-chats`, `17-changes`, `18-workflows`, `20-memory-names`, `20-recall`

### `20-mcp.mjs`: the agent door (MCP)

Your own agents (Claude Code, Claude Desktop, Cursor, …) use the actions above through one MCP address, <console>/console/api/mcp, instead of opening the page. Each agent has its own key (Agents and Telegram), so you can see what each one did and remove one without touching the others. A key only works together with its owner's Tailscale identity, and never from the Sparks themselves (requestGate). Only the key's hash is kept. Read-only for now; the key's scopes decide which actions it's offered once more kinds exist.

- **Area:** ways in. **Rules:** R7, R9, R26, R31, R37, R39. **Tests:** door.test.mjs, ask.test.mjs, fuzz.test.mjs
- **Lines:** 308
- **Owns:** agents.json (writers: handler, top level; the top-level one is the last-use timer), audit.jsonl (writers: audit)
- **Timers:** agentUseDirty (every 60 s: agents’ last use, saved when it changed)
- **Wakes:** none
- **Functions:** `keyHash`, `agentKeys`, `consoleOrigin`, `mcpUrl`, `agentView`, `keyViewer`, `agentFor`, `agentInstructions`, `askSparkie`, `audit`, `mcpDoor`, `hidePrivateKeys`, `keyName`, `randomish`, `hideKeys`, `maskSecrets`, `secretName`, `maskDeep`
- **Uses:** `01-setup` (`STATE_DIR`, `HttpError`, `CONFIG`, `API_MOUNT`, `sleep`, `VERSION`), `03-identity` (`readJson`, `writePrivate`, `viewerForLogin`, `sameOrigin`, `overLimit`), `03-secrets` (`keptHidden`), `07-jobs` (`note`), `09-verified` (`answers`), `14-chats` (`chatData`, `replying`, `saveChats`, `runChoice`, `sparkieTurn`, `turns`), `16-actions` (`checkInput`, `ACTIONS`, `liveSchema`, `action`, `runAction`), `17-changes` (`pendingChoices`), `20-keys` (`keysHidden`), `23-http` (`selfOrigin`, `send`, `readBody`, `isFault`, `recordFault`), `24-handler` (`clientAddress`)
- **Used by:** `07-jobs`, `14-chats`, `14-rounds`, `16-actions`, `16-reads`, `17-changes`, `18-run-record`, `18-step-jobs`, `18-workflows`, `19-watcher`, `20-beat`, `20-danger`, `20-digest`, `20-heal`, `20-journal`, `20-keys`, `20-lessons`, `20-memory-names`, `20-memory-said`, `20-memory`, `20-recall`, `20-tell`, `20-tg-approve`, `20-words`, `21-apps`, `21-brain-check`, `21-brain-eval`, `21-compare`, `21-copies`, `21-door`, `21-runner`, `21-selftest`, `21-telegram`, `21-updates`, `21-web`, `21-work-shown`, `21-work`, `22-passkey`, `22-sessions`, `23-http`, `24-handler`

### `20-memory-names.mjs`: what Sparkie's memory lines are about, the index of them, and the picker

Each memory line says what it is about (`about`, G2a): up to five names of things Spark Console itself knows, found by code in the line's own words when it is saved: never by a model, and never by reading a file then. A name is a Spark ("spark4"), a model (a recipe's id, "glm-5.3-flash"), a container, an app, a setup (one of the brain's, "aphex-x4", or a recipe's, by its id), a person (the owner, a member) or an agent, each kept in one form, lower case. The names come from a book of what the console lists (memoryNameBook): made at start, and again at most once a minute when memory is used, …

- **Area:** record. **Rules:** R45, R48. **Tests:** memory.test.mjs, lesson-cards.test.mjs
- **Lines:** 286
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `nameWords`, `buildNameBook`, `memoryNameBook`, `memoryNamesIn`, `memoryEnded`, `memoryLive`, `memorySig`, `memoryNamed`, `memoryIndexOf`, `memoryIndexNow`, `memoryLinesAbout`, `withoutAbout`, `pickWords`, `memoryPicking`, `memorySizes`, `isWish`, `memoryShown`, `memoryShownNow`, `memoryTail`, `memoryNeeds`, `memoryKeysHidden`, `memorySystem`, `memoryPicks`, `pickLine`, `memoryPickBlock`, `lessonsNow`, `memoryCards`
- **Uses:** `01-setup` (`NODES`, `ALL_LOCAL`), `03-identity` (`accessList`), `03-secrets` (`keptHidden`), `10-recipes` (`modelKey`, `recipeCatalog`), `13-ask` (`askOf`), `13-main-model` (`repoOf`, `mainPresets`, `chatTarget`, `MAIN`), `19-watcher` (`knowledge`), `20-lessons` (`LESSONS_FILE`, `lessonsKept`, `lessonCard`), `20-mcp` (`agentKeys`), `20-memory-time` (`memoryOffFor`), `20-memory` (`MEMORY_FILE`, `memoryEntries`, `MEMORY_CHARS`, `memoryPrompt`, `MEMORY_UNREAD`)
- **Used by:** `14-chats`, `20-digest`, `20-memory-time`, `20-memory`, `20-needs`, `20-recall`

### `20-memory-said.mjs`: said outright, kept by code: "remember that …" when the brain didn't call remember

Design G's sixth addition (A6, step 6); the brain eval switches it off with `said` in SPARK_CONSOLE_MEMORY_OFF. When the owner says outright, in their own chat on the page or in the paired Telegram chat, "remember that …" or "from now on …", and the brain answers without calling remember or forget_memory, code keeps one line itself at the end of the turn (turnAnswer), through remember's own keeper (keepLine: a secret refused, the same line kept once, a fact said again taking its line's place), so a weaker brain can't drop it. The reply says it as every memory write is said ("I'll remember: …

- **Area:** record. **Rules:** R45, R25. **Tests:** memory-said.test.mjs
- **Lines:** 66
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `saidToKeep`, `keepSaid`
- **Uses:** `16-actions` (`normQuotes`, `ACTIONS`, `requestLine`, `action`), `17-changes` (`agentSettings`), `20-journal` (`journalCalled`), `20-mcp` (`audit`), `20-memory-time` (`memoryOffFor`), `20-memory` (`refusesRemember`, `keepLine`)
- **Used by:** `14-chats`

### `20-memory-tg.mjs`: memory from the paired Telegram chat: the owner's own words remember and forget there (G6b)

Contract 4.10 and 5.5, the one page's section 8, ledger 5c clean-up 3: a line the owner states in the paired Telegram chat is remembered or forgotten as on the page, marked as said there (`src.channel`). `remember` and `forget_memory` stay in PAGE_ONLY; runAction lets them through from a channel in this one case only: Sparkie answering the owner's own words in the chat paired now (via sparkie, channel telegram, from the paired user; not an agent's conversation, not a button, not an erase). Everything after that check holds as on the page: the rest of runAction, sparkieCheck and memoryClear …

- **Area:** safety. **Rules:** R25, R32, R45. **Tests:** memory-tg.test.mjs
- **Lines:** 16
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `tgOwnMemory`
- **Uses:** `21-telegram` (`tgPaired`)
- **Used by:** `16-actions`

### `20-memory-time.mjs`: memory's lines in time: an end date, a fact said again, the other lines about the same thing

Design G's third addition (A3, step 4). The brain eval switches it off with `time` in SPARK_CONSOLE_MEMORY_OFF (test/eval.mjs): then memory is as the build before this one kept it, and an `until` given to remember is not kept. - `until`: the last day a line is true (YYYY-MM-DD, Spark 2's own day). After it the line is in no prompt and no pick; `memory {past: true}` shows it as past (why "expired"), and the next save of memory moves it to memory-past.json. It is never deleted. A day already gone when the line is saved is refused. Sparkie keeps a line with an end at once only when the owner's …

- **Area:** record. **Rules:** R45. **Tests:** memory-time.test.mjs
- **Lines:** 98
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `memoryOffFor`, `memoryExpired`, `memoryExpire`, `memoryUntil`, `lineNumbers`, `lineWords`, `sameNames`, `memorySaidAgain`, `memoryAlso`, `memorySaid`, `memoryDayWords`, `memoryTodayLine`
- **Uses:** `01-setup` (`ALL_LOCAL`, `HttpError`), `20-memory-names` (`memoryEnded`, `memoryLive`, `memoryDay`, `nameWords`, `memoryNamed`, `memoryLinesAbout`), `20-memory` (`MEMORY_FILLER`)
- **Used by:** `14-chats`, `14-rounds`, `20-memory-names`, `20-memory-said`, `20-memory`, `20-recall`, `21-selftest`

### `20-memory.mjs`: Sparkie's memory (v3.1, 2026-11-11)

What the owner asks Sparkie to remember across chats: preferences ("Spark 3 is where models go"), corrections ("no, I meant the FP4 one"), fleet facts ("Spark 4 is on Wi-Fi only") and lessons ("GLM needs sockets over the cable"). Short lines in memory.json (no ceiling), put at the end of Sparkie's system prompt (so the prompt cache stays warm until it changes), and listed for agents by `memory`. Live state beats memory: the prompt says so. Only the owner's own words add or remove a line: either they say so ("remember…", "forget that…"), or they simply state it ("Spark 4 is on Ethernet now") …

- **Area:** record. **Rules:** R20, R22, R25, R26, R45. **Tests:** sparkie-more.test.mjs, memory.test.mjs
- **Lines:** 256
- **Actions:** `memory`, `remember`, `forget_memory`
- **Owns:** memory.json (writers: saveMemory), memory-past.json (writers: saveMemory)
- **Timers:** none
- **Wakes:** none
- **Functions:** `memoryEntries`, `memoryPast`, `saveMemory`, `memoryText`, `lineBy`, `lineSrc`, `retired`, `notTheOwners`, `memoryLine`, `memoryFit`, `memoryPrompt`, `memoryPastShown`, `memoryWithPast`, `keepLine`, `eraseLine`, `saysForget`, `refusesRemember`, `memoryClear`
- **Uses:** `01-setup` (`STATE_DIR`, `HttpError`), `02-ssh` (`run`), `03-identity` (`readKept`, `writePrivate`), `07-jobs` (`note`), `11-setups` (`squash`), `14-chats` (`chatData`), `16-actions` (`action`, `normQuotes`, `POLITE`, `NEGATOR`, `CALLED_OFF`, `QUESTION_START`, `INFO_START`, `HYPOTHETICAL`, `tokensOf`, `sparkNames`), `17-changes` (`changeLabel`, `question`), `20-mcp` (`maskSecrets`), `20-memory-names` (`memoryNamed`, `memoryIndexOf`, `memorySig`, `memoryLive`, `memoryEnded`, `withoutAbout`, `memoryIndexNow`, `memoryNamesIn`), `20-memory-time` (`memoryExpire`, `memoryOffFor`, `memoryExpired`, `memoryUntil`, `memorySaidAgain`, `memoryAlso`, `memorySaid`, `TIME_WORDS`)
- **Used by:** `16-actions`, `17-changes`, `20-memory-names`, `20-memory-said`, `20-memory-time`, `20-recall`

### `20-needs.mjs`: what is waiting on the owner (H4)

One list of open problems, built by code each time it is asked for, from facts Spark Console already holds: no model call, no look at another Spark, and no text from a log, an error, a container's output or the web (so fleet_status stays a read of the console's own numbers). Lock-out first, then the owner's data, then the fleet. A line stands while its cause does and goes when the cause goes, never because it was shown. Each cause is tried by itself, so one that throws never breaks /status. At most 8 lines are said (needsLines: the 8th counts the rest): in /status (page and Telegram), at the …

- **Area:** safety. **Rules:** R21, R26. **Tests:** needs.test.mjs
- **Lines:** 90
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `tilde`, `openProblems`, `needsLines`
- **Uses:** `01-setup` (`NODES`, `STATE_DIR`, `pathMissing`, `nodeById`, `FIXED_PATH`), `03-identity` (`ownAccess`, `accessBad`, `saveFailed`, `saveWorkedAt`, `readJson`), `03-secrets` (`SECRETS_FILE`, `secretsRead`), `12-status` (`sparkName`, `statusCache`), `14-chats` (`chatsUnsaved`), `16-actions` (`gbOfGiB`), `19-watcher` (`knowledge`, `sparkOff`), `20-beat` (`beatLate`), `20-desired` (`heldLast`, `keyOf`), `20-journal` (`journalNeeds`), `20-memory-names` (`memoryNeeds`), `20-state-copy` (`copyLateNow`, `copyLateWords`), `20-ways-in` (`waysInNeeds`), `21-power` (`powerState`), `21-updates` (`updNeeds`), `23-http` (`WATCHDOG_RESTARTS_FILE`, `LAST_CRASH_FILE`)
- **Used by:** `16-reads`, `19-watcher`, `20-journal`, `20-shell`, `20-tell`, `20-words`

### `20-op-energy.mjs`: an operation's energy at the wall (D9 as cut: one number, on its journal end line)

When an operation ends, its journal end line (journalOp) says how much electricity its Sparks drew at the wall while it ran: wh, in watt-hours, the sum over its Sparks from its start (createdAt) to its end (finishedAt). It comes from the wall counter the status loop already keeps (sampleEnergy, 12-status.mjs: each plug's watts every 30 s, added up between readings), read twice: as the operation begins (newJob) and as it ends. No timer and no plug read of its own. Each end is moved to the operation's own moment with the watts read last there. When the readings in hand can't cover the …

- **Area:** record. **Rules:** R41, R43. **Tests:** op-energy.test.mjs
- **Lines:** 49
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `opWallNow`, `opEnergyStart`, `opWh`
- **Uses:** `01-setup` (`nodeById`), `12-plugs` (`wallFor`), `12-status` (`energy`, `sparkName`)
- **Used by:** `07-jobs`, `20-journal`

### `20-options.mjs`: the sorter's options: what each program's options are, read one way for all

One reader for every program's options, and each program's options from its manual. sortOpts(spec, args) reads a program's options as getopt does: -abc is three letters; a letter that takes a value takes the rest of its word or the next word (-o.bash_profile, -fsSLo x); --name=value or --name value; a long name may be cut short to any beginning only it has; -- ends the options; plain words are the rest (with first, the first plain word ends the options too, and so does each option named in first, after its value). An option not in the spec is returned as unknown, and so is a word from a $ or …

- **Area:** safety. **Rules:** R55. **Tests:** sort.test.mjs
- **Lines:** 164
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `sortSpec`, `sortSplits`, `sortOpts`
- **Uses:** nothing from other parts
- **Used by:** `20-programs`, `20-remote`, `20-sort`, `20-tools`

### `20-places.mjs`: the sorter's places: which paths and names are ways in, risky or the helper's (design A 2.8)

What a path a command names is, for the sorter (20-sort.mjs): one of the ways in (lockout), the root helper or its sudo line (not done), a risky place (a disk or device, the kernel, a schedule, Docker's settings), a program or setting that something outside the wall later runs or reads (risky when written), Spark Console's own files or the brain's (risky). A path is placed as ~/… (any home) or /…, from each folder a cd may have left the command in, with /proc/<id>/root taken off the front. "Wide" is a command that reaches everything under a folder it names (rm -r, chmod, a folder an archive …

- **Area:** safety. **Rules:** R55. **Tests:** sort.test.mjs
- **Lines:** 235
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `sortQ`, `sortNorm`, `sortAtHome`, `sortPaths`, `sortCd`, `sortGlob`, `sortSeg`, `sortClass`, `sortUp`, `sortBraces`, `sortReach`, `sortNames`, `sortPlace`, `sortGitSet`, `sortTails`, `sortCands`, `sortTouch`, `sortWrote`, `sortBefore`, `sortScan`, `sortSee`
- **Uses:** `01-setup` (`q`), `02-ssh` (`run`), `20-shell` (`unsure`), `20-sort` (`raise`, `SORT_PROGS`)
- **Used by:** `20-programs`, `20-remote`, `20-sort`, `20-tools`

### `20-programs.mjs`: the sorter's programs: what each one it knows does (design A 2.8)

One function a program the sorter (20-sort.mjs) reads past its name: shells and interpreters, editors, the shell's built-ins that set a name, archives, the system's own tools, sudo and su (the package managers, git, the builds and systemd are in 20-tools.mjs; the network's tools and other machines in 20-remote.mjs). A program in no table is unknown, and so risky; an option a handler doesn't know is a doubt, and so risky (each reads its options by its spec in 20-options.mjs, or as written here). A program that unpacks or downloads under names it picks reaches everything under the folder it …

- **Area:** safety. **Rules:** R55. **Tests:** sort.test.mjs
- **Lines:** 324
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `sortShell`, `sortSuffix`, `sortInterp`, `sortDoubts`, `sortSets`, `sortDeclare`, `sortZip`, `sortBecome`, `sortInto`
- **Uses:** `01-setup` (`q`), `20-options` (`sortOpts`, `SORT_OPTS`, `sortSpec`), `20-places` (`sortQ`, `sortScan`, `sortTouch`, `sortPaths`, `sortCd`, `sortNorm`), `20-shell` (`unsure`, `sortSedSafe`), `20-sort` (`sortInline`, `sortRuns`, `raise`, `sortProgram`, `sortAssign`, `sortFile`, `sortGone`, `SORT_READS`, `SORT_LOCK_READS`, `sortReads`)
- **Used by:** `20-remote`, `20-sort`, `20-tools`

### `20-recall.mjs`: recall: one look back over memory, lessons, proven runs and the journal (G3)

recall (its action is in 20-journal.mjs) answers from everything Spark Console keeps, in one order (design G 3.4): the owner's live memory lines, lessons (lessons.json), runs that worked here (verified.json), the owner's retired lines (memory-past.json, marked retired), then the journal, the owner's own words first. Each piece says when (at) and where it is from (source). The answer starts with one line that counts everything that matched (inAll), and next reads on from where the last answer stopped, leaving out what was kept after the first page, so nothing repeats. when is a word that code …

- **Area:** record. **Rules:** R43, R45. **Tests:** recall.test.mjs, journal.test.mjs, door.test.mjs, fuzz.test.mjs
- **Lines:** 143
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `recallWords`, `recallSpan`, `recallDay`, `recallLines`, `recallLineFrom`, `recallLine`, `recallLesson`, `recallLessonText`, `recallProven`, `recallProvenText`, `recallInAll`, `recallOne`, `recallAnswer`
- **Uses:** `01-setup` (`HttpError`), `07-jobs` (`note`), `09-verified` (`verifiedList`), `16-actions` (`tokensOf`), `17-changes` (`START_FAILURES`), `20-journal` (`jRecord`, `jOwnCall`, `jWho`, `JOURNAL_KINDS`, `journalHits`), `20-lessons` (`lessonsKept`), `20-mcp` (`maskDeep`), `20-memory-names` (`memoryIndexNow`, `memoryLinesAbout`, `memoryEnded`, `withoutAbout`, `pickLine`, `memoryNamesIn`, `memorySizes`), `20-memory-time` (`memoryOffFor`, `memoryExpired`), `20-memory` (`memoryPastShown`, `memoryEntries`, `memoryPast`, `retired`), `21-work` (`mayRun`)
- **Used by:** `20-journal`

### `20-remote.mjs`: the sorter's programs that reach the network or another machine (design A 2.8)

The handlers 20-programs.mjs leaves to this part, added to SORT_HANDLERS: the network's own tools (ip, arp, ss), the downloaders (curl, wget, aria2c), Tailscale, and ssh, scp, rsync and sftp. On another machine there is no wall and no copy first, so a command that runs or writes there is asked (risky) whatever it is, and still sorted as a command there for lockout or not done; a host that isn't one of the Sparks is risky, a tunnel through one is not done. As root no wall stands in front of the Spark's own ports, so a root download that names a host by number, localhost, a one-word name, a …

- **Area:** safety. **Rules:** R55. **Tests:** sort.test.mjs
- **Lines:** 131
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `sortHost`, `sortDns`, `sortFar`
- **Uses:** `20-options` (`sortOpts`, `SORT_OPTS`), `20-places` (`sortPlace`, `sortNorm`, `sortQ`, `sortTouch`, `sortScan`), `20-programs` (`SORT_HANDLERS`, `sortInto`), `20-shell` (`unsure`), `20-sort` (`sortShows`, `raise`, `sortOpen`, `sortFresh`, `sortInline`, `sortAt`, `sortMerge`, `sortGone`)
- **Used by:** no other part

### `20-shell.mjs`: how bash reads a command: words, pipelines, here-documents (for the sorter)

The one tokenizer the sorter reads a command with (design A 2.8; 20-sort.mjs). It reads as bash does, and anything it can't read whole (a quote that never closes, a loop, arithmetic, a ${ … } form, a here-document that runs commands, an end word bash reads differently, a line that runs on with \) throws a SortDoubt, which the sorter answers as risky.

- **Area:** safety. **Rules:** R55. **Tests:** sort.test.mjs
- **Lines:** 191
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `unsure`, `sortWs`, `shellLex`, `shellParse`, `sortSedSafe`
- **Uses:** `20-needs` (`tilde`)
- **Used by:** `20-places`, `20-programs`, `20-remote`, `20-sort`, `20-tools`

### `20-sort.mjs`: the sorter: what one command on a Spark is (design A 2.8)

sortCommand(command, {at, root, dir, home, hosts, brain, written}) says what one command for run is before anything runs, from its text and where it runs alone: no model call, no file read, a bounded amount of work, and never a throw for anything JSON can carry (a getter or a toString that throws is caught too). Five classes, in their order of danger (when two could apply, the later wins): look (only reads: at once), change (design A 2.5's ladder), risky (always asked), lockout (asked, and inside the net), notdone (never, and not for want of a yes). The careful answer is the default: a …

- **Area:** safety. **Rules:** R55. **Tests:** sort.test.mjs
- **Lines:** 399
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `raise`, `sortFresh`, `sortMerge`, `sortAssign`, `sortIsCd`, `sortIsExit`, `sortList`, `sortKeep`, `sortCmd`, `sortWroteIn`, `sortRuns`, `sortGone`, `sortOpen`, `sortInline`, `sortKnown`, `sortProgram`, `sortReads`, `sortSetuid`, `sortFile`, `sortShows`, `sortWrap`, `sortAt`, `sortCommand`
- **Uses:** `01-setup` (`CONFIG`), `20-options` (`SORT_OPTS`, `sortOpts`, `SORT_MODES`), `20-places` (`sortQ`, `SORT_STEPS`, `sortTouch`, `sortBefore`, `sortPaths`, `sortWrote`, `sortCands`, `sortNames`, `SORT_PLACED`, `SORT_PATH`, `sortNorm`, `sortSee`, `sortScan`), `20-programs` (`SORT_HANDLERS`, `sortInto`), `20-shell` (`unsure`, `shellParse`, `shellLex`, `SortDoubt`), `21-work` (`lookForm`, `lookWords`, `keyWord`)
- **Used by:** `20-places`, `20-programs`, `20-remote`, `20-tools`, `21-runner`, `21-work`

### `20-state-copy.mjs`: when the state's copy goes: only while another Spark is awake anyway

What a copy is, and how it lands, is 25-backup-and-start.mjs's (sendCopy, backupState, backup.json). This part says when one goes and where, so a copy never wakes a Spark and nothing is sent when nothing changed (owner decision 5, contract 6.25): - a compute Spark comes online (the status check sees it come back, or sees it on for the first time: by itself, by the owner's hand, or turned on by Spark Console): it gets a copy if the state changed since the newest good copy (copyOnWake, from 19-watcher.mjs); - just before Spark Console powers a Spark off: if the state changed since the newest …

- **Area:** safety. **Rules:** R23, R41. **Tests:** copy.test.mjs, state.test.mjs
- **Lines:** 138
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `stateMark`, `copyDue`, `keepMarks`, `copyAwake`, `copyOnWake`, `copyBeforeOff`, `copyLateNow`, `copyLateWords`, `copyLate`
- **Uses:** `01-setup` (`STATE_DIR`, `sleep`, `nodeById`, `NODES`), `03-identity` (`writePrivate`), `07-jobs` (`jobs`, `step`, `note`), `12-status` (`statusCache`, `sparkName`), `19-watcher` (`fleetEvent`), `21-power` (`consoleOff`), `25-backup-and-start` (`BACKUP_ON`, `lastBackup`, `backupTargets`, `backupState`, `backingUp`, `dayOf`, `BACKUP_FILE`)
- **Used by:** `19-watcher`, `20-needs`, `21-power`, `25-backup-and-start`

### `20-tell.mjs`: telling the owner on Telegram

tell() is the only thing that sends to Telegram, and it sends only what the owner asked for (docs/contract.md 13, docs/architecture.md R32): a reply to a message sent there, the result of work started there, Sparkie carrying on with a request made there, Spark Console's own fixed lines (pairing, /status, "restarted while answering"), and an ask that waits for the owner's yes, with its buttons (20-tg-approve.mjs, only while approvals from Telegram are on). Never heals, crashes nobody asked about, notices, sign-ins or digests, with one exception the owner switches on: the needs-me line at the …

- **Area:** safety. **Rules:** R32. **Tests:** telegram.test.mjs, needs-me.test.mjs
- **Lines:** 195
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `TELL_LIMITS`, `tellParts`, `tellClean`, `tellBlock`, `tell`, `tellName`, `tellWhat`, `tellResultLine`, `tellAwait`, `tellAwaitDone`, `tellResult`, `tellCarry`, `tellReplyText`, `tellButtons`, `needsLine`, `needsMeTick`
- **Uses:** `01-setup` (`ALL_LOCAL`, `nodeById`), `07-jobs` (`deploy`, `draining`), `12-status` (`sparkName`), `16-actions` (`action`), `17-changes` (`pendingChoices`), `20-mcp` (`maskSecrets`, `audit`), `20-needs` (`openProblems`), `20-tg-approve` (`tgAsks`), `21-telegram` (`tgPaired`, `tgSend`, `tgSaved`, `tgSave`, `tg`)
- **Used by:** `07-jobs`, `14-chats`, `16-actions`, `18-run-record`, `20-danger`, `20-keys`, `20-tg-approve`, `21-apps`, `21-power`, `21-selftest`, `21-telegram`, `25-backup-and-start`

### `20-tg-approve.mjs`: approving from Telegram: the owner's yes from the paired chat (A10a)

The owner's yes may come from Telegram (owner decisions 20 and 22; contract 8.7, 8.17). A question only the owner answers (`question(…, { ownerOnly: true })`, 17-changes.mjs: today's owner-only buttons, and whatever a later step calls risky) asked in one of the owner's own chats is also sent to the paired chat as one ask, built by code: the question and each yes in full, with the page's own buttons. A press there is the owner's yes only when all hold: - "Approve from Telegram" is on: `approve` beside the pairing in the secrets file. On needs the passkey, off never does; a new pairing turns it …

- **Area:** safety. **Rules:** R32, R06. **Tests:** tg-approve.test.mjs
- **Lines:** 157
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `tgApproveOn`, `tgApprovalsLine`, `tgAskable`, `tgAskText`, `tgAsk`, `tgAskOpen`, `tgAskedThere`, `tgApprovals`, `tgApprovalsHeld`, `tgApproving`, `tgApprovalCounted`, `tgApproved`, `tgAsksVoid`, `tgNewPairing`, `tgLock`, `tgApproveRoute`
- **Uses:** `01-setup` (`q`, `HttpError`), `03-identity` (`accessList`), `03-secrets` (`secretsWrite`), `14-chats` (`chatData`, `saveChats`), `16-actions` (`PAGE_ONLY`, `action`), `17-changes` (`question`, `pendingChoices`, `sparkieWho`), `19-watcher` (`fleetEvent`), `20-danger` (`dangerGone`, `dangerPressedHere`, `dangerHeadOf`, `dangerTelegramGone`), `20-mcp` (`audit`, `maskSecrets`), `20-tell` (`tell`), `21-telegram` (`tgPaired`, `tgSaved`, `tgOwner`, `tgSave`, `tgBinding`, `telegramView`), `23-http` (`readBody`)
- **Used by:** `14-chats`, `16-reads`, `17-changes`, `20-danger`, `20-tell`, `21-telegram`

### `20-tools.mjs`: the sorter's tools that set a Spark up: packages, git, builds, services (design A 2.8)

The handlers 20-programs.mjs leaves to this part, added to SORT_HANDLERS: the package managers (apt, dpkg, pip, conda, npm, hf), git, Docker, the builds (make and its kin), and systemd (systemctl, service, loginctl). Each knows its sub-commands: one not on its list is a doubt (risky), and so is an option its spec (20-options.mjs) doesn't hold. A sub-command that runs another program (conda run, npm explore, yarn node, git bisect run, git rebase -x, git submodule foreach, git difftool -x) has that program sorted where it stands; such a handler returns how many words are its own, so the options …

- **Area:** safety. **Rules:** R55. **Tests:** sort.test.mjs
- **Lines:** 216
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `sortPkgs`, `sortElsewhere`, `sortBuild`
- **Uses:** `20-options` (`SORT_OPTS`, `sortOpts`, `SORT_NOOPTS`), `20-places` (`sortQ`, `sortTouch`, `sortGlob`, `WAYS_UNITS`), `20-programs` (`SORT_HANDLERS`, `sortInto`), `20-shell` (`unsure`), `20-sort` (`raise`, `sortRuns`, `sortGone`, `sortInline`, `sortProgram`, `sortOpen`)
- **Used by:** no other part

### `20-ways-in.mjs`: the ways in, watched ahead: Tailscale's keys, linger, Funnel (ledger 5b, addition 6)

The owner reaches Spark Console through ways in that can each close with no warning: a Tailscale key that expires (Spark 2's takes every way in but Telegram with it; a compute Spark's cuts that Spark off), the console's user without linger on Spark 2 (its services stop at logout and stay off after a reboot until someone logs in), and Funnel switched off. Each is read on a look the console already takes, never on a timer of its own: Tailscale's own status (`tailscale status --json`, read by refreshBlocked in 23-http.mjs every 60 s: Spark 2 is Self, a compute Spark the peer holding its tailnet …

- **Area:** safety. **Rules:** R49. **Tests:** ways-in.test.mjs
- **Lines:** 98
- **Owns:** funnel-seen.json (writers: noteFunnel; deploy/open-to-internet.sh --undo removes it)
- **Timers:** none
- **Wakes:** none
- **Functions:** `waysDay`, `noteTailnet`, `lookLinger`, `noteFunnel`, `waysInNeeds`
- **Uses:** `01-setup` (`ALL_LOCAL`, `STATE_DIR`, `NODES`), `02-ssh` (`spawnOn`), `03-identity` (`writePrivate`), `12-status` (`sparkName`), `23-http` (`funnelOn`)
- **Used by:** `20-needs`, `23-http`

### `20-words.mjs`: the owner's words: /status, /pause, /restart sparkie, /stop, /undo update, /help (round two, 2026-11-11)

Typed as the whole message in the owner's own page chat, they're answered by code before any model call, so they work with Sparkie's model down or stuck (docs/analysis-2026-11-11/10-round-two-report.md, item 1; contract 8.13). They are not tools: no agent, no /mcp or /v1, no carry-on turn. They can only look, pause agents' changes, bring back the brain's own container (restart it, or start it again when it is stopped or gone: the same container, or the saved setup; never another model), end Sparkie's answer in that chat (/stop), or go back a build. /undo update is the one word that runs an …

- **Area:** safety. **Rules:** R34. **Tests:** words.test.mjs
- **Lines:** 171
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `ownerWord`, `nearMissWord`, `consoleSparkWords`, `statusText`, `pauseWord`, `restartWord`, `stopWord`, `undoWord`, `helpWord`, `answerOwnerWord`
- **Uses:** `01-setup` (`sleep`, `NODES`, `nodeById`, `BUILD`, `q`), `02-ssh` (`knownOffline`), `07-jobs` (`jobs`, `busySparks`, `claimed`, `newJob`, `runJob`), `12-status` (`sparkName`), `13-main-model` (`chatTarget`, `MAIN`, `mainNode`, `mainBusy`, `mainStatus`, `mainPlan`, `startMain`), `14-chats` (`stopTurn`, `sparkieMessageChoices`, `LIMITS`, `saveChats`), `16-actions` (`recentMain`, `action`, `runAction`), `17-changes` (`agentSettings`, `setAgentSettings`, `SETTINGS_FILE`), `19-watcher` (`fleetEvent`), `20-danger` (`dangerPaused`, `dangerStopped`), `20-heal` (`brainRestarting`, `restartBrain`, `brainRestartCommand`), `20-mcp` (`maskSecrets`, `audit`), `20-needs` (`needsLines`), `23-http` (`funnelOn`)
- **Used by:** `21-telegram`, `24-handler`

### `21-apps.mjs`: apps kept running (R38)

"Keep Open WebUI on Spark 3 running and give me its link" (A12). An app is any container that isn't a model: Open WebUI, a database, a dashboard. keep_running puts one that's already on a Spark on the list of what should be running (desired.json, an entry with app: true), restarts or stops one kept that way, or starts a new one from an image the owner names: no GPU, a memory cap, named volumes only, its port opened on 127.0.0.1 and the Spark's tailnet address only, labelled spark.app=1 (never spark.console=1, so no model start ever counts it as one of its own). Self-healing brings a kept app …

- **Area:** features. **Rules:** R1, R2, R7, R23, R38, R40. **Tests:** apps.test.mjs
- **Lines:** 601
- **Actions:** `keep_running`
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `appSecretName`, `imageRepo`, `appModelImage`, `appAnswers`, `appStates`, `appLook`, `appDiffers`, `commandWords`, `appCommand`, `devBox`, `appRoom`, `jobDir`, `appRunCommand`, `gpuAlone`, `jobFolder`, `jobMountsReal`, `jobNotReal`, `jobEnded`, `waitJobEnd`, `appUp`, `appDone`, `appPutBack`, `appNamed`, `appNow`, `healApp`
- **Uses:** `01-setup` (`CONFIG`, `q`, `HttpError`, `sleep`, `nodeById`, `isProtected`), `02-ssh` (`run`, `fields`, `b64json`), `03-identity` (`accessList`, `mustUse`), `05-library` (`memNow`, `KEEP_FREE`, `inventory`), `07-jobs` (`step`, `note`, `claimed`, `newJob`, `runJob`, `stopContainer`), `09-verified` (`answers`), `11-setups` (`squash`), `12-status` (`sparkName`), `14-chats` (`chatData`, `saveChats`), `16-actions` (`recent`, `tokensOf`, `sparkNames`, `normQuotes`, `runAction`, `action`, `sparkArg`, `sparkOf`), `17-changes` (`notBrainsSpark`, `changeLabel`, `question`, `pausedCheck`, `stoppedForSure`), `18-step-jobs` (`sleepUnless`), `18-workflows` (`consoleStopped`), `19-watcher` (`MODEL_IMAGES`, `fleetEvent`, `knowledge`, `events`, `sparkOff`), `20-desired` (`cancelCheck`, `keyOf`, `desired`, `forgetApp`, `keepApp`), `20-heal` (`skippedOnce`, `healSkip`, `cameBack`, `healCount`, `HEAL_WINDOW`, `HEAL_SETTLE_MS`, `healMark`, `healOwner`, `HEAL_OFFLINE_MS`), `20-mcp` (`SECRET_FLAG`, `maskSecrets`), `20-tell` (`tell`), `21-door` (`appLinks`, `linkWords`), `21-power` (`power`, `powerThenKeep`)
- **Used by:** `16-actions`, `17-changes`, `18-step-jobs`, `18-workflows`, `19-watcher`, `20-desired`, `20-heal`, `21-compare`, `21-runner`, `21-selftest`

### `21-brain-check.mjs`: the brain check: does Sparkie's model call tools, with arguments that fit (design E 2.3)

A few fixed requests to the brain's own port, with one toy tool written here (never the action registry, so nothing can run or change), and a profile of what came back in brain-profiles.json, kept per brain setup and shown in sparkie_setup. Two outcomes, not three grades (the one page): "checked" when it answers, calls the tool with arguments that fit three times out of three, and answers from the tool's result; "not checked" otherwise, with why. Nothing acts on the outcome yet: no change becomes a button because of it (design E, build step 5, does that). A profile belongs to what was checked …

- **Area:** features. **Rules:** R22, R24, R26, R36. **Tests:** brain-check.test.mjs
- **Lines:** 202
- **Owns:** brain-profiles.json (writers: saveBrainProfile)
- **Timers:** none
- **Wakes:** none
- **Functions:** `brainSetupOf`, `brainKey`, `brainReadsNow`, `brainProfiles`, `brainProfileOf`, `saveBrainProfile`, `brainAsk`, `argsProblem`, `toolCameBack`, `brainCheckAsk`, `brainCheck`, `checkBrainSoon`, `checkWhen`, `checkSetupWords`, `checkWords`, `brainCheckView`
- **Uses:** `01-setup` (`STATE_DIR`, `BUILD`, `sleep`, `ALL_LOCAL`), `03-identity` (`readKept`, `writePrivate`, `clean`), `13-ask` (`askSet`, `answerReader`), `13-main-model` (`repoOf`, `mainBusy`, `MAIN`, `mainNode`), `14-chats` (`modelInUse`), `14-rounds` (`howAsked`), `15-routes` (`gatewayBrainCalls`, `inUse`), `18-workflows` (`WORKFLOW_LOCK`), `20-heal` (`cameBack`), `20-mcp` (`maskSecrets`), `21-brain-eval` (`brainInUse`, `brainEvalView`)
- **Used by:** `09-verified`, `13-main-model`, `16-reads`, `21-brain-eval`, `21-updates`, `24-handler`

### `21-brain-eval.mjs`: the brain eval's results, kept with what they ran against (the one page, milestone 1 and 10; P-4)

test/eval.mjs runs the eval's cases on a stand-in console with the real brain and writes one record of the run (R47). The owner's own call, POST /main/eval, keeps a record in the profile of the brain serving now (brain-profiles.json, written by saveBrainProfile, 21-brain-check.mjs), under evals["<reads>:<set>"]: what the brain read in the build that ran and the version of the case set. The newest five of each, and the six of those with the newest results. It refuses a record that isn't one (400); one run at another cap; one from another brain (the stand-in's on a real console, a real brain's …

- **Area:** features. **Rules:** R47. **Tests:** brain-eval.test.mjs
- **Lines:** 126
- **Owns:** cases.json (writers: none; every install keeps test/eval/cases.json in ~/spark-console-src, evalSetNow reads it)
- **Timers:** none
- **Wakes:** none
- **Functions:** `evalSetNow`, `brainInUse`, `evalRecordProblem`, `evalScore`, `evalLine`, `storeBrainEval`, `brainEvalView`
- **Uses:** `01-setup` (`ALL_LOCAL`, `HttpError`), `02-ssh` (`run`), `13-main-model` (`MAIN`, `repoOf`, `mainBusy`), `16-actions` (`action`), `20-mcp` (`maskDeep`, `audit`), `21-brain-check` (`brainKey`, `brainProfileOf`, `saveBrainProfile`, `brainReadsNow`)
- **Used by:** `21-brain-check`, `21-updates`, `24-handler`

### `21-compare.mjs`: compare_models: a saved workload run with each candidate model, and the winner kept (D8)

"Run my workload on whatever is best, keep the winner" (contract 9.27, T141; design D 2.5's first block, as cut). compare_models {workflow, candidates, sample} runs a saved workflow that declares a `model` input once for each candidate, one after another, as run_workflow runs it (its own code, called with the compare's caller: placing, job waits, D7's model address, D6c's yes, and a workload's end stopping what that run started all hold). It is one operation, `compare`, which holds no claim itself. The brain ("sparkie") goes first when listed: its run leaves out the steps that start, stop or …

- **Area:** features. **Rules:** R57, R13. **Tests:** compare.test.mjs, compare-asleep.test.mjs
- **Lines:** 203
- **Actions:** `compare_models`
- **Owns:** none (saved-workflows.json's `compared` and `best`, through writeSaved in 18-workflows.mjs)
- **Timers:** none
- **Wakes:** none
- **Functions:** `compareWords`, `compareIsBrain`, `compareSkips`, `compareBrainView`, `compareWontReach`, `compareIsJob`, `compareStep`, `compareBrainWhy`, `compareWait`, `compareScore`, `compareLine`, `compareKeepOn`, `compareBest`, `compareRun`, `compareKeep`
- **Uses:** `01-setup` (`nodeById`, `sleep`, `q`, `HttpError`), `02-ssh` (`run`), `05-library` (`inventory`), `07-jobs` (`jobs`, `note`, `step`, `newJob`, `runJob`), `13-main-model` (`MAIN`), `14-chats` (`sparkieMessageChoices`), `15-routes` (`SPARKIE_ID`), `16-actions` (`mainArg`, `sharedFolder`, `ACTIONS`, `action`), `17-changes` (`computeSparks`, `question`), `18-job-model` (`jobFromImage`), `18-saved-yes` (`savedStepsHash`), `18-workflows` (`placeholders`, `stepArgs`, `writeSaved`, `savedWorkflows`, `findSaved`), `19-watcher` (`knowledge`), `20-desired` (`cancelJob`, `cancelCheck`), `20-heal` (`healOwner`), `20-mcp` (`maskSecrets`), `21-apps` (`appLook`)
- **Used by:** `18-workflows`

### `21-copies.mjs`: the copies a change makes first, and putting them back (A7b)

Before the runner (21-runner.mjs) runs a change on a compute Spark, every file the sorter placed it as writing, removing or changing (its result's placed and wide: a * expanded there, a wide folder walked) is copied into a set of its own, ~/.local/share/spark-console/before/<set>/ on that Spark (the walls hide that folder from every command): folder 0700, files 0600, the bytes, the mode and the path of each kept, so a restore is exact. At most 16 MB a file and 128 MB a command; a file past a limit, unreadable or not a plain file, and what a named link points to, is "not kept", with why. The …

- **Area:** features. **Rules:** R61. **Tests:** runner.test.mjs
- **Lines:** 382
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `copiesSetName`, `copiesOn`
- **Uses:** `01-setup` (`HttpError`), `02-ssh` (`run`), `12-status` (`sparkName`), `20-mcp` (`maskSecrets`)
- **Used by:** `21-runner`

### `21-door.mjs`: the app door: the owner's kept apps from anywhere (R40)

The owner opens an app kept running (keep_running, R38) on any Spark that isn't the brain's from anywhere, a phone without Tailscale too, signed in as on the main address (the owner, 2026-11-12: "once you're signed in, you shouldn't need a separate password"). It is Spark Console's own name on port 10000 (Funnel's one free port; 443 is the public Funnel's), which Tailscale serve hands to door.sock, a private socket like api.sock. Only the owner's script deploy/open-apps-to-internet.sh points Tailscale there; the console only reads whether it does (doorOn, checkRoute). - Its own origin: an …

- **Area:** features. **Rules:** R40. **Tests:** app-door.test.mjs
- **Lines:** 266
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `doorHosts`, `doorOrigin`, `doorLink`, `appLinks`, `linkWords`, `consoleCookieName`, `doorTarget`, `doorTicketOf`, `doorGate`, `doorWho`, `doorPage`, `doorRequestHeaders`, `doorResponseHeaders`, `doorOpen`, `doorHandler`, `doorUpgrade`
- **Uses:** `01-setup` (`STATE_DIR`, `CONFIG`, `nodeById`, `HttpError`, `ALL_LOCAL`, `DEV_LOGIN`), `03-identity` (`refreshNodes`, `viewerForLogin`, `viewerFor`), `12-status` (`sparkName`), `16-actions` (`recentInventory`, `action`), `17-changes` (`brainSparks`), `20-desired` (`desired`), `20-mcp` (`consoleOrigin`, `audit`), `22-sessions` (`cookieValues`, `sessionHash`, `ownerSessionView`, `sessionList`, `sessionOver`, `holdForSession`), `23-http` (`selfOrigin`, `sparkAddresses`, `blockedAddresses`), `24-handler` (`clientAddress`), `25-backup-and-start` (`door`)
- **Used by:** `21-apps`, `21-power`, `23-http`, `24-handler`, `25-backup-and-start`

### `21-guide.mjs`: the guide: the brain's tool groups, and the lookup that finds the rest

Each round Sparkie's brain is offered the core (every action whose group is core) and the groups this request opened, at most TOOL_CAP tools (R46). The owner's words open groups (GROUP_WORDS, 16-actions.mjs), and so does state: an operation of this chat running opens control, the chat's last operation failing opens dig, and a search_web call opens reading. A call to an action that wasn't offered runs through runAction like any other call, and opens its group; so does guide {tools: "<group>"}. With more groups than fit, the newest one the words opened gives way, so a request keeps the groups …

- **Area:** features. **Rules:** R46. **Tests:** tools.test.mjs
- **Lines:** 109
- **Actions:** `guide`
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `groupActions`, `toolCap`, `groupsUnder`, `requestGroups`, `openGroup`, `wordGroups`, `stateGroups`, `offeredNames`, `brainCatalog`
- **Uses:** `01-setup` (`ALL_LOCAL`), `02-ssh` (`run`), `07-jobs` (`jobs`), `13-ask` (`askSet`), `13-main-model` (`MAIN`), `14-chats` (`TOOL_LINES`), `14-rounds` (`budgetsSet`), `16-actions` (`GROUP_WORDS`, `ACTIONS`, `normQuotes`, `action`), `18-workflows` (`savedWorkflows`)
- **Used by:** `14-rounds`, `24-handler`

### `21-power-pair.mjs`: a start wakes both Sparks a model across two needs (R56)

A start that names no Spark and has to wake one (wakeOne, 21-power.mjs; startModel, 17-changes.mjs) wakes the two a model across two Sparks needs. How many it needs is read from what the start already knows, never guessed: for a model on a disk of a Spark that is on, its own need as plan() reckons it (05-library.mjs: its spark.json's memoryGiB, else its size and 15%), against a Spark's memory less the 8 GB kept free (a sleeping Spark's from its record, one that is on from the live look); for one to download, the recipe's versions (`sparks`, `needGB`). Its partner is the other end of a cable …

- **Area:** features. **Rules:** R41, R56. **Tests:** power-wake-pair.test.mjs, power-wake.test.mjs
- **Lines:** 41
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `wakeNeedOf`, `wakeMayPair`, `wakePartner`, `wakeNeedsTwo`, `wakeLiveStatus`
- **Uses:** `05-library` (`ENGINES`, `engineOf`), `06-links` (`lastCheck`), `17-changes` (`inRecipes`, `brainSparks`, `computeSparks`, `HEADROOM`)
- **Used by:** `17-changes`, `18-workflows`, `21-power`

### `21-power.mjs`: power-aware Sparks (contract 9.22, R41)

The owner, 2026-11-13: "shut down sparks when not in use (not spark 2), when idle, or when I tell chat, an agent or the API"; idle models are parked. A Spark with a plug Spark Console may switch (switchablePlug, 12-plugs.mjs) is powered off cleanly and on again: - power_off: refused for Spark 2 (brainSparks) always, for a Spark without a switchable plug, and while anything runs there that Spark Console didn't start or keeps protected (hand-started benchmarks, spark.protect=true, a job that hasn't ended): those are never stopped by this. Spark Console's own models and kept apps there are …

- **Area:** features. **Rules:** R19, R22, R23, R32, R41. **Tests:** power.test.mjs, heal-status.test.mjs
- **Lines:** 1060
- **Actions:** `power_off`, `power_on`, `power_settings`
- **Owns:** power.json (writers: savePower)
- **Timers:** powerTick (every 60 s, first 5 minutes after start)
- **Wakes:** a compute Spark it powered off, or one shut down with a switchable plug, never Spark 2: power_on, a start or call that needs it (powerThen), power.wake
- **Functions:** `powerState`, `savePower`, `offRecord`, `consoleOff`, `poweredOffNow`, `sparkWord`, `sparksWords`, `minutesWords`, `atWords`, `parkedWhy`, `parkedFor`, `offHolds`, `wakeNames`, `offFor`, `wakeOne`, `asleepView`, `powerMark`, `wakeWaiting`, `powerView`, `answersNow`, `powerLook`, `inUseWords`, `setupWords`, `sudoReady`, `shutDownSpark`, `holdLow`, `plugUnproven`, `idleInUse`, `powerTargets`, `powerPlan`, `pairWords`, `unpark`, `powerOffJob`, `waitAndCut`, `powerOnOne`, `powerOnSparks`, `bringBackParked`, `powerFirst`, `powerThenStart`, `powerThenKeep`, `powerThen`, `minutesSaid`, `powerSettingsClear`, `lastJobOn`, `lastUseOn`, `sparkNeeded`, `busyReason`, `serveUsed`, `servesHere`, `sayIdleActive`, `powerOpOn`, `unparkStranded`, `powerTick`, `keepAwake`, `doneWith`, `sparkPowerState`, `wakeSpark`, `wallWattsNow`, `wallWhNow`
- **Uses:** `01-setup` (`STATE_DIR`, `nodeById`, `NODES`, `HttpError`, `isProtected`, `sleep`, `CONFIG`, `q`), `02-ssh` (`spawnOn`, `noteReach`, `run`, `fields`), `03-identity` (`readKept`, `writePrivate`, `mustUse`, `accessList`, `readJson`), `05-library` (`plan`, `inventory`), `07-jobs` (`step`, `note`, `jobs`, `claimed`, `newJob`, `runJob`, `stopContainer`, `busySparks`), `09-verified` (`answers`), `10-recipes` (`recipeCatalog`), `11-setups` (`squash`, `sameRepo`), `12-plugs` (`switchablePlug`, `freshWall`, `switchPlug`, `wallFor`), `12-status` (`sparkName`, `statusCache`, `STATUS_EVERY`, `energy`, `ENERGY_FILE`), `14-chats` (`chatData`, `LIMITS`, `saveChats`), `15-routes` (`inUse`, `sparkCalls`), `16-actions` (`onDiskAs`, `sparkOf`, `action`, `sparkArg`, `sparksArg`, `runAction`, `ACTIONS`, `normQuotes`), `16-reads` (`gbOf`), `17-changes` (`HEADROOM`, `brainSparks`, `choiceArg`, `redeemChoice`, `routedSparks`, `question`, `pausedCheck`, `stoppedForSure`, `acrossGate`, `startModel`, `agentSettings`), `18-workflows` (`workflowStatus`, `consoleStopped`, `workflowVersion`), `19-watcher` (`fleetEvent`, `knowledge`, `WATCH_EVERY`, `events`), `20-desired` (`desired`, `keyOf`, `cancelCheck`, `parkDesired`, `waitJob`, `cancelJob`), `20-heal` (`healOwner`, `cameBack`, `HEAL_SETTLE_MS`), `20-state-copy` (`copyBeforeOff`), `20-tell` (`tell`), `21-door` (`doorTickets`), `21-power-pair` (`wakePartner`)
- **Used by:** `04-metrics`, `12-status`, `15-routes`, `16-actions`, `16-reads`, `17-changes`, `18-step-jobs`, `18-workflows`, `19-watcher`, `20-desired`, `20-heal`, `20-needs`, `20-state-copy`, `21-apps`

### `21-runner.mjs`: the runner: one change on a compute Spark, its copies first (A7b, dark)

runChange sorts one command itself (20-sort.mjs; no caller hands it an answer) and runs it, only when that is a plain change, on a compute Spark, in the root helper's run wall (R42). In this order, and holding that Spark's claim (R13) for all of it, released at every end: the room for the run wall's memory cap (R2); the copies of every file the sorter placed (21-copies.mjs) and the fingerprints of the ways in (a command that removes or overwrites files stops here, with nothing run, when one was not kept); the journal's start line, synced to disk, which names the set and the manifest's SHA-256 …

- **Area:** features. **Rules:** R61, R13, R43. **Tests:** runner.test.mjs
- **Lines:** 190
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `runnerSortOpts`, `runnerRefuses`, `runnerWaysDiff`, `runChange`, `runnerLatest`, `runnerSparkOf`, `runnerUndo`
- **Uses:** `01-setup` (`ALL_LOCAL`, `CONFIG`, `NODES`, `HttpError`, `nodeById`), `02-ssh` (`fields`), `07-jobs` (`claimSparks`, `note`), `12-status` (`sparkName`), `13-main-model` (`MAIN`), `16-actions` (`tripBreaker`, `sizeWords`), `17-changes` (`brainSparks`, `agentSettings`, `putBack`), `19-watcher` (`fleetEvent`), `20-journal` (`journal`, `jSub`, `JOURNAL_REFUSED`, `J_MAX`, `jErr`, `journalFiles`, `jLinesOf`, `jParse`), `20-mcp` (`maskSecrets`), `20-sort` (`sortCommand`), `21-apps` (`appRoom`), `21-copies` (`copiesSetName`, `copiesOn`), `21-work` (`helperCall`, `helperAnswer`, `needsOwner`, `wallsFailed`, `lookClean`, `forBrain`, `LOOK_SLACK`)
- **Used by:** `20-desired`, `21-work`

### `21-selftest.mjs`: the self-test: the fleet proved on its real hardware (design D 2.9)

"Run the self-test", "test the Sparks": one operation built from actions that exist, each run and waited on the way "Test the changes" runs its steps (stepRun), as Spark Console itself, because what it runs is fixed here and in config.json (selfTestImage), never chosen by the caller. On one compute Spark (computeSparks) that is on, free (no model, model server or GPU app runs there, and nothing is changing there) and has a small chat model on disk (testModels): Model start_model there, stopping nothing (noStops); it answers its test prompt, and is timed. Healing the drill: that model's …

- **Area:** features. **Rules:** R1, R11, R13, R19, R20, R22, R30, R38, R42. **Tests:** selftest.test.mjs, selftest-cleanup.test.mjs, work.test.mjs
- **Lines:** 424
- **Actions:** `self_test`
- **Owns:** self-test.json (writers: keep, selfTest, selfTestRecover; removed when a run ends)
- **Timers:** selfTestRecover (5 s after start, then each minute while the Spark doesn’t answer)
- **Wakes:** none
- **Functions:** `selfTestJobCommand`, `selfTestAddress`, `selfTestName`, `wordList`, `firstLine`, `selfTestPlace`, `healDrill`, `inAbout`, `drillHeldBack`, `selfTestJobParts`, `selfTestCtx`, `selfTestNeed`, `selfTestMine`, `selfTestModels`, `selfTestStopModel`, `selfTestStopApp`, `containerStates`, `selfTest`, `selfTestRecover`, `selfTestCutOff`
- **Uses:** `01-setup` (`ALL_LOCAL`, `CONFIG`, `API_MOUNT`, `nodeById`, `HttpError`, `sleep`, `q`, `STATE_DIR`, `NAME_RE`), `02-ssh` (`run`, `fields`), `03-identity` (`readKept`, `writePrivate`, `mustUse`, `accessList`), `05-library` (`inventory`, `containerName`), `07-jobs` (`busySparks`, `jobs`, `step`, `claimSparks`, `note`, `newJob`, `runJob`), `12-status` (`sparkName`), `14-chats` (`chatData`, `saveChats`), `16-actions` (`runAction`, `action`, `sparkArg`, `ACTIONS`), `17-changes` (`computeSparks`, `agentSettings`, `pausedCheck`, `notBrainsSpark`, `changeLabel`, `question`), `18-workflows` (`testModels`, `healDrills`, `consoleStopped`, `healTriesThisHour`, `workflowStatus`, `lastOnOff`, `stepRun`), `19-watcher` (`WATCH_EVERY`, `knowledge`, `events`, `fleetEvent`), `20-desired` (`desired`, `cancelCheck`, `waitJob`, `holdsModelsOn`, `cancelJobsAndWait`), `20-heal` (`healOwner`), `20-mcp` (`consoleOrigin`, `maskSecrets`), `20-memory-time` (`lineWords`), `20-tell` (`tell`), `21-apps` (`waitJobEnd`), `21-work` (`selfTestWalls`)
- **Used by:** `18-job-model`, `18-workflows`, `19-watcher`, `20-desired`

### `21-telegram.mjs`: Telegram: the owner talks to Sparkie from any phone or laptop

Spark 2 asks Telegram for new messages over one outbound HTTPS connection (long polling): no route, port or Funnel, so it works with Tailscale off on the owner's devices and with the console tailnet-only. One private chat, paired with a one-time code only the passkey page shows, is a turn in the owner's own Sparkie chat with the same gates as the page. Everyone else gets silence. Going back a build, memory and saved workflows wait as an owner-only button in Spark Console; access, agent keys, passkeys and devices have no path from here at all. (docs/architecture.md R32, …

- **Area:** features. **Rules:** R32, R34. **Tests:** telegram.test.mjs
- **Lines:** 424
- **Owns:** telegram.json (writers: tgSave)
- **Timers:** tgLoop (the long poll, one at a time, with a pause after a failure), tgTyping (“typing…” every 4.5 s while Sparkie answers, 5 minutes at most)
- **Wakes:** none
- **Functions:** `tgBinding`, `tgPaired`, `tgSaved`, `tgSave`, `tgSaveSoon`, `tgSetState`, `tgProblem`, `telegramView`, `tgCall`, `tgSend`, `tgTyping`, `tgLoop`, `tgStop`, `tgRestart`, `tgOwner`, `tgUpdate`, `tgTryPair`, `tgNewCode`, `tgForget`, `tgConv`, `tgTurn`, `tgPress`, `tgRun`, `tgStatusText`, `tgAfterRestart`, `telegramRoute`
- **Uses:** `01-setup` (`ALL_LOCAL`, `STATE_DIR`, `sleep`, `HttpError`), `03-identity` (`readJson`, `writePrivate`, `accessList`, `ownerPermissions`), `03-secrets` (`secretsRead`, `secretsProblem`, `secretsWrite`, `SECRETS_FILE`), `07-jobs` (`draining`, `jobs`), `14-chats` (`chatData`, `endTasksFrom`, `LIMITS`, `saveChats`, `sparkieTurn`, `TURN_STOPPED`, `replying`, `runChoice`), `16-actions` (`action`), `19-watcher` (`fleetEvent`), `20-danger` (`dangerTypedHere`), `20-keys` (`tgKeys`), `20-mcp` (`audit`), `20-tell` (`tellOwnerAt`, `tell`, `TELL_LIMITS`, `tellReplyText`, `tellButtons`), `20-tg-approve` (`tgApproveOn`, `tgLock`, `tgNewPairing`, `tgApproving`, `tgApprovalCounted`, `tgApproved`, `tgAskedThere`, `tgApprovalsLine`, `tgApproveRoute`), `20-words` (`ownerWord`, `pauseWord`, `restartWord`, `stopWord`, `statusText`), `22-passkey` (`passkeys`), `23-http` (`send`, `readBody`)
- **Used by:** `14-chats`, `16-reads`, `19-watcher`, `20-danger`, `20-keys`, `20-memory-tg`, `20-tell`, `20-tg-approve`, `24-handler`, `25-backup-and-start`

### `21-updates.mjs`: Spark Console's own updates, from chat: is a newer tested build out (design C 2.3, step 5)

check_update runs `pull.sh check --json` on Spark 2 (the copy every install leaves beside go-back.sh), as /key GITHUB runs `pull.sh setup` (20-keys.mjs), and says: the build installed; the newest commit on main with a tested/ tag, and whether it is newer; whether it changes what the brain reads (the two locks' brainReads) and the eval's result for that on record, or "not run"; and the commits' subjects since, which are outside text (data, never the owner's request: check_update is not in INSIDE_READS). It installs and changes nothing; the token never leaves pull.sh. When GitHub refuses the …

- **Area:** features. **Rules:** R58. **Tests:** check-update.test.mjs, tools.test.mjs
- **Lines:** 109
- **Actions:** `check_update`
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `updPullFacts`, `updEvalFor`, `updShort`, `updDay`, `updCheck`, `updNeeds`
- **Uses:** `01-setup` (`ALL_LOCAL`, `BUILD`), `02-ssh` (`run`), `03-secrets` (`SECRETS_FILE`), `07-jobs` (`note`), `13-main-model` (`MAIN`), `16-actions` (`action`), `20-keys` (`SECRETS_TAIL`), `20-mcp` (`maskDeep`), `21-brain-check` (`brainProfileOf`, `brainReadsNow`), `21-brain-eval` (`evalSetNow`, `EVAL_SLOT`, `evalLine`)
- **Used by:** `20-needs`

### `21-web.mjs`: looking things up on the web

When Sparkie doesn't know something (a new model, an error message, an engine flag, a how-to), search_web finds pages and read_page reads one. Both are reads, open-world (an agent's 6 a minute at the door). What leaves the house is a search query (keys and the fleet's own names and addresses hidden, 200 characters at most) and plain GETs: no cookies, no credentials, no Authorization. A page's text comes back labelled as data. Text that was read never chooses the address (R39): read_page opens only an address in the owner's own words in this chat (any of their messages there; one typed without …

- **Area:** features. **Rules:** R39. **Tests:** web.test.mjs
- **Lines:** 308
- **Actions:** `search_web`, `read_page`
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `fixtureJson`, `publicAddress`, `bareHost`, `publicLookup`, `publicHost`, `bareUrl`, `webHop`, `fixtureHop`, `webError`, `webFetch`, `decodeEntities`, `inlineText`, `dropBlocks`, `mainPart`, `pageText`, `readable`, `searxng`, `ddgTarget`, `ddgResults`, `searxResults`, `webSearch`, `sawAddresses`, `ownerAddresses`, `addressRefusal`, `reText`, `hideFleet`
- **Uses:** `01-setup` (`ALL_LOCAL`, `HttpError`, `CONFIG`, `q`), `02-ssh` (`run`), `07-jobs` (`note`), `16-actions` (`action`), `20-mcp` (`maskSecrets`)
- **Used by:** `03-identity`, `05-library`, `13-main-model`, `20-digest`

### `21-work-shown.mjs`: what the owner sees of a command Sparkie ran

The chat's `tool` event for a command Sparkie ran on a Spark (design A 2.10, step 5) carries six more fields, which the chat loop puts on the step it emits and saves in message.tools (the chat file): where (the Spark's name), line ("$ " and the command), tail (the last line the command printed, then "exit N", or why it ended or did not run), root (whether it ran as root), kept (the journal record that holds the whole command and output, when it ran) and look (the result's own line saying it ran as a look: nothing changed, nothing sent). Code builds them from the call's arguments and from the …

- **Area:** features. **Rules:** R42. **Tests:** work.test.mjs, page.test.mjs
- **Lines:** 50
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `shownText`, `shownFirst`, `shownLast`, `commandShown`
- **Uses:** `01-setup` (`NODES`), `02-ssh` (`run`), `12-status` (`sparkName`), `16-actions` (`sparkIdOf`), `20-mcp` (`maskSecrets`), `21-work` (`lookClean`)
- **Used by:** `14-rounds`

### `21-work.mjs`: run: a command on a Spark, through the root helper (today a look, in its look wall)

run (the one page's tool, design A's host_look) runs one command Sparkie writes on any Spark, Spark 2 included. Today every command is a look: it runs inside the root helper's look wall (deploy/spark-console-root, R42; design A 2.3 and 2.13): the whole disk read-only, no network, no socket or device, keys hidden, as a throw-away account with root's read rights, so it can change and send nothing (changes, root and the net are later steps). helperCall is the one way the console calls the helper: one script over ssh (local bash on Spark 2) that first checks the Spark's helper is the one this …

- **Area:** features. **Rules:** R42, R43. **Tests:** work.test.mjs
- **Lines:** 338
- **Actions:** `run`
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `globRe`, `keyWord`, `shellWords`, `lookWords`, `lookForm`, `helperScript`, `helperCall`, `helperAnswer`, `ownerCommand`, `mayRun`, `needsOwner`, `whoMayLook`, `lookClean`, `forBrain`, `runCommand`, `selfTestWalls`
- **Uses:** `01-setup` (`ALL_LOCAL`, `q`, `CONFIG`, `HttpError`, `NODES`), `02-ssh` (`knownOffline`, `spawnOn`, `noteReach`, `run`), `12-status` (`sparkName`), `16-actions` (`sparkOf`, `sizeWords`, `action`, `sparkArg`), `20-journal` (`J_MAX`, `journalId`, `journal`, `jErr`, `jSub`), `20-mcp` (`maskSecrets`, `consoleOrigin`, `agentKeys`), `20-sort` (`sortCommand`), `21-runner` (`runnerSortOpts`, `runChange`)
- **Used by:** `16-reads`, `20-recall`, `20-sort`, `21-runner`, `21-selftest`, `21-work-shown`

### `22-passkey.mjs`: the owner's passkey: confirming changes to who has access

Tailscale, or a device the owner signed in, says the owner is asking, and for the few changes to who may act (agent keys and their rights, resuming paused agents, new devices and passkeys) the owner also confirms with a passkey (Touch ID, Face ID, a phone or a security key). Each confirmation signs a one-time challenge bound to that exact request, so a program on the owner's device can't make those changes with Tailscale's identity alone. Until a passkey is set up, these changes need none (nothing can lock the owner out).

- **Area:** ways in. **Rules:** R6, R23, R31, R32, R33. **Tests:** passkey.test.mjs
- **Lines:** 174
- **Owns:** passkeys.json (writers: savePasskeys)
- **Timers:** none
- **Wakes:** none
- **Functions:** `passkeys`, `savePasskeys`, `passkeyOrigins`, `passkeyRpIds`, `counterNote`, `actionHash`, `newChallenge`, `describeChange`, `takeChallenge`, `passkeyNeeded`, `mayNeedPasskey`, `bodyLimit`, `stopsOutside`, `needsPasskey`, `passkeyGate`
- **Uses:** `01-setup` (`STATE_DIR`, `HttpError`, `CONFIG`, `nodeById`), `03-identity` (`readJson`, `writePrivate`, `clean`), `12-status` (`sparkName`), `14-chats` (`chatData`), `16-actions` (`action`), `17-changes` (`pendingChoices`, `agentSettings`), `19-watcher` (`fleetEvent`, `knowledge`), `20-mcp` (`audit`, `agentKeys`, `keyName`), `22-sessions` (`deviceCodes`, `newDevicePasskeyOpen`, `markPasskey`), `23-http` (`selfOrigin`, `readBody`)
- **Used by:** `20-beat`, `21-telegram`, `22-sessions`, `24-handler`

### `22-sessions.mjs`: signing in without Tailscale (docs/contract.md 4.10)

From the internet (Tailscale Funnel) a request carries no Tailscale identity, so on its own it's a public visitor. The owner signs a browser in with their passkey, or lets a device in by its short code (a terminal, or a phone without the passkey) from a device that's already signed in, confirming with the passkey. Each signed-in device holds a random token: a browser as a cookie only it sends (HttpOnly, Secure, SameSite=Strict, only to /console/api), a terminal as "Authorization: Bearer scs_…". Only a token's hash is kept. On the tailnet, Tailscale's identity wins.

- **Area:** ways in. **Rules:** R31, R33, R40. **Tests:** internet.test.mjs, app-door.test.mjs
- **Lines:** 358
- **Owns:** sessions.json (writers: saveSessions)
- **Timers:** none
- **Wakes:** none
- **Functions:** `sessionHash`, `sessionOver`, `asObject`, `sessionList`, `saveSessions`, `newSession`, `cookieValues`, `sessionTokens`, `carriesCredential`, `sessionFor`, `sessionViewer`, `ownerSessionView`, `newDevicePasskeyOpen`, `markPasskeyAdded`, `recoveryNorm`, `recoveryCode`, `recoveryOf`, `recoveryView`, `makeRecoveryCodes`, `useRecoveryCode`, `accessView`, `markPasskey`, `sessionCookie`, `setSessionCookie`, `clearSessionCookie`, `holdForSession`, `endSession`, `userCodeOf`, `pruneDeviceCodes`, `onTailnet`, `deviceView`, `deviceByCode`, `signinMac`, `newSigninChallenge`, `takeSigninChallenge`, `limited`, `fromPage`, `signinRoute`, `sessionRoute`
- **Uses:** `01-setup` (`STATE_DIR`, `NODES`, `nodeById`, `HttpError`), `03-identity` (`readJson`, `writePrivate`, `clean`, `accessList`, `ownerPermissions`, `overLimit`, `sameOrigin`, `addressKey`), `03-secrets` (`secretsRead`, `SECRETS_FILE`, `secretsWrite`, `secretsProblem`), `04-metrics` (`clients`), `12-status` (`sparkName`), `14-chats` (`endTasksFrom`), `16-actions` (`action`), `17-changes` (`brainSparks`), `19-watcher` (`fleetEvent`), `20-mcp` (`audit`), `22-passkey` (`passkeys`, `passkeyOrigins`, `savePasskeys`, `counterNote`), `23-http` (`send`, `readBody`), `24-handler` (`clientAddress`)
- **Used by:** `03-identity`, `04-metrics`, `16-reads`, `21-door`, `22-passkey`, `24-handler`

### `23-http.mjs`: HTTP

- **Area:** ways in. **Rules:** R7, R10, R30, R40. **Tests:** faults.test.mjs, fleet.test.mjs, internet.test.mjs
- **Lines:** 148
- **Owns:** last-crash.json (writers: recordCrash), watchdog-restarts (writers: none; the watchdog writes it), api-locked (writers: checkRoute)
- **Timers:** checkRoute (every 60 s), refreshBlocked (every 60 s)
- **Wakes:** none
- **Functions:** `send`, `readBody`, `isFault`, `routePattern`, `faultText`, `faultFrames`, `recordFault`, `recordCrash`, `faultView`, `checkRoute`, `sparkAddresses`, `refreshBlocked`
- **Uses:** `01-setup` (`HttpError`, `STATE_DIR`, `BUILD`, `NODES`, `CONFIG`), `03-identity` (`writePrivate`, `readJson`, `LOCAL_IPS`), `20-mcp` (`maskSecrets`, `consoleOrigin`), `20-ways-in` (`lookLinger`, `noteFunnel`, `ROUTE_MS`, `noteTailnet`), `21-door` (`doorHosts`, `doorOn`, `DOOR_SOCKET`)
- **Used by:** `03-identity`, `12-plugs`, `14-chats`, `15-routes`, `16-reads`, `20-beat`, `20-mcp`, `20-needs`, `20-tg-approve`, `20-ways-in`, `20-words`, `21-door`, `21-telegram`, `22-passkey`, `22-sessions`, `24-handler`, `25-backup-and-start`

### `24-handler.mjs`: the public page

Anyone may see the fleet's hardware and load, from the internet too. Internet (Funnel) traffic carries no Tailscale identity, so it never gets past the sign-in check: this is the only thing it can read. Nothing here names a model, container, job, chat, person, hostname or address.

- **Area:** ways in. **Rules:** R1, R3, R4, R5, R8, R9, R11, R22, R27, R30, R33, R34, R38, R40. **Tests:** fleet.test.mjs, api.test.mjs, internet.test.mjs, passkey.test.mjs
- **Lines:** 627
- **Owns:** none
- **Timers:** none
- **Wakes:** none
- **Functions:** `publicFleet`, `publicValue`, `clientAddress`, `requestGate`, `handler`
- **Uses:** `01-setup` (`HttpError`, `NODES`, `ALL_LOCAL`, `VERSION`, `BUILD`, `STARTED_AT`, `CONFIG`, `NAME_RE`, `nodeById`, `isProtected`), `02-ssh` (`knownOffline`, `authProblem`, `run`, `fields`), `03-identity` (`overLimit`, `viewerFor`, `LOGIN_RE`, `accessList`, `sameOrigin`, `refreshNodes`, `ownerPermissions`, `clean`, `writePrivate`, `mustUse`), `03-secrets` (`SECRETS_FILE`), `04-metrics` (`metricsStream`), `05-library` (`inventory`, `plan`, `deployOptions`, `plansFor`, `gpuUsersScript`), `06-links` (`lastCheck`, `fabric`), `07-jobs` (`jobs`, `agentFailuresInARow`, `publicJob`, `stopList`, `claimSparks`, `newJob`, `runJob`, `deploy`, `claimed`, `stopContainer`), `08-cluster` (`clusterPlan`, `clusterNet`, `clusterDeploy`), `09-verified` (`verifiedList`, `verifiedView`), `10-recipes` (`searchModels`, `addModel`, `parseRepoList`, `addList`, `recipeCatalog`, `REPO_RE`), `11-setups` (`recipes`, `resolveHow`, `startDig`, `sameRepo`, `downloadTargets`, `downloadVersion`, `refreshSetups`), `12-status` (`statusCache`, `sparkName`, `statusFor`, `sparkFor`, `workerCall`, `LOG_SERVICES`), `13-main-model` (`mainPresets`, `repoOf`, `MAIN`, `ROUTES`, `mainStatus`, `setupFromLibrary`, `mainSetup`, `mainPlan`, `mainBusy`, `switchMain`, `startMain`, `stopMain`, `markBrainLeftDown`), `14-chats` (`replying`, `chatData`, `chatSummary`, `LIMITS`, `saveChats`, `CHAT_ID`, `ownChat`, `runChoice`, `chatReply`), `15-routes` (`sparkieApi`, `routeView`, `runningChoices`, `setRoute`), `16-actions` (`action`, `ACTIONS`, `liveSchema`, `runAction`, `agentChanges`), `17-changes` (`agentSettings`, `setAgentSettings`, `notBrainsSpark`, `startWithFixes`, `stoppedForSure`), `18-workflows` (`WORKFLOWS`, `workflowStatus`, `pageWorkflow`, `startTestChanges`, `lastSnapshot`, `undoUpdate`), `19-watcher` (`fleetEvent`, `events`), `20-beat` (`heartbeatRoute`), `20-danger` (`dangerShown`), `20-desired` (`cancelRunningOn`, `desiredNow`, `desired`, `DESIRED_FILE`), `20-keys` (`keysGiven`, `answerKeys`), `20-mcp` (`consoleOrigin`, `keyViewer`, `mcpDoor`, `audit`, `maskSecrets`, `mcpUrl`, `agentKeys`, `agentView`, `keyHash`, `AGENTS_FILE`, `AGENT_ID`, `agentUse`), `20-words` (`ownerWord`, `answerOwnerWord`, `nearMissWord`), `21-brain-check` (`checkBrainSoon`), `21-brain-eval` (`storeBrainEval`), `21-door` (`doorHosts`), `21-guide` (`brainCatalog`), `21-telegram` (`tg`, `telegramRoute`), `22-passkey` (`passkeys`, `passkeyGate`, `passkeyRpIds`, `newChallenge`, `describeChange`, `actionHash`, `takeChallenge`, `passkeyOrigins`, `savePasskeys`, `challenges`), `22-sessions` (`SIGNIN_ROUTES`, `carriesCredential`, `recoveryView`, `signinRoute`, `sessionRoute`, `makeRecoveryCodes`, `markPasskeyAdded`), `23-http` (`funnelOn`, `tcpApiOff`, `sparkAddresses`, `blockedAddresses`, `send`, `readBody`, `isFault`, `recordFault`, `routePattern`), `25-backup-and-start` (`lastBackup`)
- **Used by:** `15-routes`, `20-mcp`, `21-door`, `22-sessions`, `25-backup-and-start`

### `25-backup-and-start.mjs`: a copy of the console's state on another Spark

People, passkeys, agent keys, chats, recipes that worked and the fleet's record are copied to another Spark while one is awake anyway (Spark 3 unless config.json names one, then the next other Spark that takes it; never the brain's Spark or this one), one file a day, keeping the last 14, so losing Spark 2's disk loses little (F17). Each copy arrives as <name>.part and is read back whole (gzip -t) there; only once tar here has ended well too does a second command move it into place and remove the oldest beyond 14, and otherwise that command removes the .part. So a copy cut short, or one tar …

- **Area:** start. **Rules:** R10, R20, R22, R31, R40. **Tests:** state.test.mjs, copy.test.mjs, fleet.test.mjs, install.test.mjs
- **Lines:** 155
- **Owns:** backup.json (writers: backupState, copyLate)
- **Timers:** backupIfDue (10 minutes after start, then hourly; it sends only while a Spark is on and the state changed), needsMeTick (every 60 s), tick (every 0.5 s while a stop waits for running operations, 60 s at most)
- **Wakes:** none
- **Functions:** `dayOf`, `backupTargets`, `sendCopy`, `backupState`, `backupIfDue`, `refuseUpgrade`, `openSockets`
- **Uses:** `01-setup` (`STATE_DIR`, `ALL_LOCAL`, `CONFIG`, `NODES`, `VERSION`, `BUILD`), `02-ssh` (`knownOffline`, `spawnOn`, `run`), `03-identity` (`readKept`, `writePrivate`), `04-metrics` (`stopSamplers`), `07-jobs` (`draining`, `jobs`), `12-status` (`sparkName`, `statusCache`), `17-changes` (`brainSparks`), `18-workflows` (`noteUpdate`), `20-beat` (`beatStart`, `BEAT_FIRST_MS`), `20-journal` (`journalAfterRestart`), `20-state-copy` (`copyAwake`, `stateMark`, `keepMarks`, `copyLate`, `copyDue`), `20-tell` (`needsMeTick`, `NEEDS_MS`), `21-door` (`doorHandler`, `doorUpgrade`, `DOOR_SOCKET`), `21-telegram` (`tgAfterRestart`, `tgLoop`, `tgStop`), `23-http` (`tcpApiOff`, `API_SOCKET`, `recordFault`, `recordCrash`), `24-handler` (`handler`)
- **Used by:** `02-ssh`, `03-identity`, `08-cluster`, `09-verified`, `13-main-model`, `15-routes`, `20-state-copy`, `21-door`, `24-handler`
