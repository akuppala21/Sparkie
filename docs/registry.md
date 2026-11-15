# Registry

Written by `node tools/make.mjs` from the parts and their headers (`tools/parts.mjs`); don’t edit it by hand. What
a header declares (the owner of a state file, its writers, the timers) is checked against the code on every run.

## Actions

Kind: a lookup runs at once; a change goes through the checks in `runAction`. Answers to: the words of the owner’s
request it may follow (`ACTION_KIND`). Page only: never run from a channel (`PAGE_ONLY`). Step: may be a step of a
saved workflow (not in `NOT_A_STEP`). Text: a lookup whose result is the console’s own (`INSIDE_READS`), or text
from outside. Group: the tool group Sparkie is offered it in (R46; the core is in every round).

| Action | Kind | Part | Group | Answers to | Page only | Step | Text |
|---|---|---|---|---|---|---|---|
| `fleet_status` | read | `16-actions` | core | — | — | yes | inside |
| `running_models` | read | `16-actions` | core | — | — | yes | inside |
| `models_on_disk` | read | `16-actions` | find | — | — | yes | inside |
| `find_recipes` | read | `16-actions` | find | — | — | yes | outside |
| `recipe_detail` | read | `16-actions` | find | — | — | yes | outside |
| `search_huggingface` | read | `16-actions` | find | — | — | yes | outside |
| `where_it_fits` | read | `16-actions` | find | — | — | yes | inside |
| `deploy_plan` | read | `16-actions` | sparks | — | — | yes | inside |
| `cluster_plan` | read | `16-actions` | sparks | — | — | yes | inside |
| `linked_sparks` | read | `16-actions` | sparks | — | — | yes | inside |
| `spark_detail` | read | `16-actions` | sparks | — | — | yes | outside |
| `recent_operations` | read | `16-actions` | dig | — | — | yes | outside |
| `operation_log` | read | `16-actions` | dig | — | — | yes | outside |
| `container_logs` | read | `16-actions` | dig | — | — | yes | outside |
| `spark_diagnostics` | read | `16-actions` | dig | — | — | yes | outside |
| `service_logs` | read | `16-actions` | dig | — | — | yes | outside |
| `files` | read | `16-actions` | reading | — | — | yes | outside |
| `sparkie_setup` | read | `16-actions` | core | — | — | yes | inside |
| `workloads` | read | `16-actions` | core | — | — | yes | outside |
| `fleet_events` | read | `16-actions` | past | — | — | yes | outside |
| `start_model` | change | `17-changes` | core | start | — | yes | — |
| `stop_model` | change | `17-changes` | core | stop | — | yes | — |
| `restart_model` | change | `17-changes` | core | restart, start | — | yes | — |
| `find_setups` | change | `17-changes` | find | find | — | yes | — |
| `save_file` | change | `17-changes` | reading | file | — | no | — |
| `workflows` | read | `18-workflows` | routines | — | — | yes | inside |
| `save_workflow` | change | `18-workflows` | routines | save | yes | no | — |
| `run_workflow` | change | `18-workflows` | routines | start | — | no | — |
| `forget_workflow` | change | `18-workflows` | routines | forget | yes | no | — |
| `wait_operation` | read | `18-workflows` | control | — | — | yes | outside |
| `test_changes` | change | `18-workflows` | checks | test | — | yes | — |
| `undo_update` | change | `18-workflows` | updates | undo | yes | yes | — |
| `should_be_running` | read | `20-desired` | core | — | — | yes | inside |
| `cancel_operation` | change | `20-desired` | control | cancel | — | yes | — |
| `undo_last_change` | change | `20-desired` | control | undo | — | yes | — |
| `memory` | read | `20-memory` | memory | — | — | yes | inside |
| `remember` | change | `20-memory` | core | remember | yes | no | — |
| `forget_memory` | change | `20-memory` | memory | remember | yes | no | — |
| `keep_running` | change | `21-apps` | core | keep, start, restart, stop | — | yes | — |
| `guide` | read | `21-guide` | core | — | — | yes | inside |
| `self_test` | change | `21-selftest` | checks | selftest | — | no | — |
| `search_web` | read | `21-web` | core | — | — | yes | outside |
| `read_page` | read | `21-web` | reading | — | — | yes | outside |

## State files and their writers

Each file is owned by the part that names it; its writers are found in the code and must be the ones its owner’s
header declares. Copied daily: in the state folder, so in the daily copy and every install snapshot. Read kept: read
with `readKept`, which sets an unreadable file aside and keeps one earlier copy (R20).

| File | Owner | Writers | Copied daily | Read kept |
|---|---|---|---|---|
| `access.json` | `03-identity` | `changeMembers`, `changeAccess`; `changeMembers` is called by `handler`; `changeAccess` is called by `askAccess`, `handler` | yes | no |
| `access.json.good` | `03-identity` | `ownAccess`; a copy of the last good access.json | yes | no |
| `added-models.json` | `10-recipes` | `addModel` | yes | yes |
| `agent-settings.json` | `17-changes` | `setAgentSettings`; `setAgentSettings` is called by `tripBreaker`, `pauseWord`, `handler` | yes | no |
| `agents.json` | `20-mcp` | `top level`, `handler` (24-handler); the top-level one is the last-use timer | yes | no |
| `api-locked` | `23-http` | `checkRoute` | yes | no |
| `audit.jsonl` | `20-mcp` | `audit` | yes | no |
| `backup.json` | `25-backup-and-start` | `backupState`; `backupState` is called by `backupIfDue` | yes | yes |
| `chats.json` | `14-chats` | `chatData`, `saveChats`; chatData sets an unreadable one aside | yes | no |
| `desired.json` | `20-desired` | `desiredAfter`, `keepApp`, `forgetApp`, `watchHeld`, `markUndone`, `handler` (24-handler); `desiredAfter` is called by `runJob`; `keepApp` is called by `keepIt`, `keep_running`; `forgetApp` is called by `keep_running` | yes | yes |
| `energy.json` | `12-status` | `sampleEnergy`; `sampleEnergy` is called by `collectStatus` | yes | no |
| `events.jsonl` | `19-watcher` | `fleetEvent` | yes | no |
| `found-setups.json` | `10-recipes` | `digModel` (11-setups); `digModel` is called by `addList`, `startDig` | yes | yes |
| `heal-tries.json` | `18-workflows` | `saveHealTries`; `saveHealTries` is called by `maybeHeal`, `healMark` | yes | no |
| `knowledge.json` | `19-watcher` | `saveKnowledge`; `saveKnowledge` is called by `watchSpark`, `noteSparkStates`, `watchFleet` | yes | no |
| `last-crash.json` | `23-http` | `recordCrash` | yes | no |
| `links.json` | `06-links` | `fabric`; `fabric` is called by `test`, `clusterNet`, `linked_sparks`, `handler` | yes | no |
| `main.json` | `13-main-model` | `writeMainFile`; `writeMainFile` is called by `saveMainChoice`, `markBrainLeftDown`, `saveRoutes` | yes | yes |
| `memory.json` | `20-memory` | `remember`, `forget_memory` | yes | yes |
| `passkeys.json` | `22-passkey` | `savePasskeys`; `savePasskeys` is called by `passkeyGate`, `signinRoute`, `handler` | yes | no |
| `saved-workflows.json` | `18-workflows` | `writeSaved`; `writeSaved` is called by `save_workflow`, `record`, `forget_workflow` | yes | yes |
| `secrets.json` | `03-secrets` | `secretsWrite`; outside the state folder | no | no |
| `self-test.json` | `21-selftest` | `keep`, `selfTest`, `selfTestRecover`; removed when a run ends; `selfTest` is called by `selfTestCtx`, `self_test` | yes | yes |
| `sessions.json` | `22-sessions` | `saveSessions` | yes | no |
| `telegram.json` | `21-telegram` | `tgSave` | yes | no |
| `update-note.json` | `18-workflows` | none; the installer writes it, noteUpdate reads it | yes | no |
| `updates.json` | `18-workflows` | `noteUpdate` | yes | yes |
| `validations.json` | `18-workflows` | `recordWorkflowRun`; `recordWorkflowRun` is called by `runJob` | yes | yes |
| `verified.json` | `09-verified` | `recordVerified` | yes | yes |
| `watchdog-restarts` | `23-http` | none; the watchdog writes it | yes | no |

## Timers, and what may wake

Every repeating timer, as its part declares it (one that runs once after start may be listed too). A timer is
named by the function it calls. What each part may wake is its own line: a Spark is woken only where it says so.

| Timer | Part | When |
|---|---|---|
| `startSampler` | `04-metrics` | again 15 s after a reader ends, while a page is open |
| `metricsStream` | `04-metrics` | a ping every 15 s to each open page |
| `test` | `06-links` | the cable test, fabric: 20 s after start, then every 10 minutes |
| `daily` | `11-setups` | the daily research: 3 minutes after start, then every 24 hours |
| `collectStatus` | `12-status` | every 30 s, after a first round 2 s after start |
| `watchFleet` | `19-watcher` | 15 s after start, then every 60 s |
| `beatOnce` | `20-beat` | every 5 minutes, started in the listen callback and again when an address is saved |
| `watchHeld` | `20-desired` | every 60 s; its first round seeds desired.json |
| `healPass` | `20-heal` | every 60 s |
| `agentUseDirty` | `20-mcp` | every 60 s: agents’ last use, saved when it changed |
| `selfTestRecover` | `21-selftest` | 5 s after start, then each minute while the Spark doesn’t answer |
| `tgLoop` | `21-telegram` | the long poll, one at a time, with a pause after a failure |
| `tgTyping` | `21-telegram` | “typing…” every 4.5 s while Sparkie answers, 5 minutes at most |
| `checkRoute` | `23-http` | every 60 s |
| `refreshBlocked` | `23-http` | every 60 s, not on the stand-in fleet |
| `backupIfDue` | `25-backup-and-start` | 10 minutes after start, then hourly |
| `needsMeTick` | `25-backup-and-start` | every 60 s |
| `tick` | `25-backup-and-start` | every 0.5 s while a stop waits for running operations, 60 s at most |

No part may wake a Spark: every header says `Wakes: none`.

## Events and operation types

An event is a line in the fleet’s record (`fleetEvent`); its type must be in `EVENT_TYPES`. An operation is a job
(`newJob`); its type must be named in R13, which says whether it takes a claim.

| Event | Sent by |
|---|---|
| `started` | `watchSpark` (19-watcher) |
| `stopped` | `watchSpark` (19-watcher) |
| `crashed` | `watchSpark` (19-watcher) |
| `removed` | `watchSpark` (19-watcher) |
| `created` | `watchSpark` (19-watcher) |
| `spark-offline` | `noteSparkStates` (19-watcher) |
| `spark-online` | `noteSparkStates` (19-watcher) |
| `learned` | `done` (19-watcher) |
| `operation` | `newJob` (07-jobs), `runJob` (07-jobs), `top level` (19-watcher), `pauseWord` (20-words), `restartWord` (20-words), `handler` (24-handler) |
| `healing` | `maybeHeal` (18-workflows), `bringBack` (20-heal), `keepBrain` (20-heal), `watchBrain` (20-heal), `healApp` (21-apps) |
| `heal-skipped` | `skip` (18-workflows), `healSkip` (20-heal), `bringBack` (20-heal), `healApp` (21-apps) |
| `notice` | `readKept` (03-identity), `ownAccess` (03-identity), `tripBreaker` (16-actions), `recordWorkflowRun` (18-workflows), `noteUpdate` (18-workflows), `undoUpdate` (18-workflows), `top level` (19-watcher), `watchSpark` (19-watcher), `watchHeld` (20-desired), `keepBrain` (20-heal), `jobEnded` (21-apps), `selfTestRecover` (21-selftest), `tgSetState` (21-telegram), `tgTryPair` (21-telegram), `counterNote` (22-passkey), `signinRoute` (22-sessions), `sessionRoute` (22-sessions), `handler` (24-handler), `backupState` (25-backup-and-start) |

| Operation | Started by |
|---|---|
| `add-list` | `handler` (24-handler) |
| `deploy` | `launch` (17-changes), `keep_running` (21-apps), `handler` (24-handler) |
| `deploy-cluster` | `launch` (17-changes), `handler` (24-handler) |
| `dig` | `startDig` (11-setups) |
| `download` | `handler` (24-handler) |
| `main-start` | `keepBrain` (20-heal), `restartWord` (20-words), `handler` (24-handler) |
| `main-stop` | `handler` (24-handler) |
| `main-switch` | `handler` (24-handler) |
| `restart` | `restartJob` (17-changes), `keep_running` (21-apps) |
| `self-test` | `self_test` (21-selftest) |
| `spark-action` | `handler` (24-handler) |
| `start-model` | `startModel` (17-changes) |
| `stop` | `stop_model` (17-changes), `keep_running` (21-apps), `handler` (24-handler) |
| `undo` | `undo_last_change` (20-desired) |
| `validate-workflows` | `startTestChanges` (18-workflows) |
| `workflow-run` | `run_workflow` (18-workflows) |
