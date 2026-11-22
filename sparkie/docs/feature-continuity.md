# Sparkie feature continuity

This is a source inventory for the candidate. It establishes no installation or release qualification. The owner’s direction preserves user-visible outcomes across the move to native Hermes. Superseded implementation details stay historical. “Planned” below includes previously specified outcomes whose full owner path still needs evidence.

| Owner outcome | Native or extension owner and continuity check |
| --- | --- |
| Chat from a phone, desktop or paired Telegram, continue a task across interfaces, stream, interrupt, redirect and receive results in its original conversation | Native Hermes web, gateway, sessions, attachments and notification delivery. Preserve ongoing chat while background work runs, status behind each action, phone and desktop usability. Qualify the primary Telegram and signed-in remote browser independently. |
| Questions, decisions and activity | Native tasks and conversations plus exact operational approvals. Historical “Waiting for you” combined parked tasks, gated downloads, updates, expiring credentials, and faults. Verify findability from both owner interfaces. Keep the originating request, ID, scope, reports, partial results, retries, and undo. |
| Files, project results and gallery | Hermes attachment and artifact views. Historical intent includes upload from phone, HEIC/HEVC, resumable uploads, share sheet, preview/version/task lineage, retained gallery, and authenticated app links. The active contract covers artifacts generally. Track each detailed path individually. |
| Owner access and external tools | Approved public HTTPS and Nous Portal browser login without Tailscale on the client, independent recovery, signed-in apps, web/API/WebSocket protection, equal paired-owner authority. Preserve scoped/revocable per-agent credentials, identify requesting agent, and prevent agent approval. Historical terminal/CLI, MCP status/results, agent-model choice, device/session listing and revocation, copyable setup and app single-sign-on need explicit compatibility checks. |
| Memory, work/personal scopes, learning and research | Native Hermes recall, inspect origin, correction, forget and confirmed erase; newest corrections win. Preserve scoped tool access and source-backed research, learned procedures as skills, read-only checks when model fails. Record partial failure honestly. |
| Fleet overview and topology | Sparks dashboard extension in source renders host/worker identity, timestamp/staleness, free memory/storage, GPU usage, wall watts, physical link state/speed, running containers vs supporting services. Its own copy explicitly reports cable peers unverified. Preserve live versus cached states, verify peer and port identities, fabric speed, usable pairs and capacity before distributed work. Retain add/remove fleet capability with checked discovery. |
| Workload lifecycle | Shared checked operations across chat, buttons and Telegram. Launch models/apps/jobs/dev environments on verified eligible workers, claim single/multi-host resources atomically, track one lifecycle, pause/resume where supported, cancel/stop, read progress/logs and open verified results. Dedicated app health, stable authenticated endpoint, restart and safe undo. Source dashboard conditionally renders Stop workload. It does not establish launch, logs, pause, artifact links, or detached-job handoff. Distinguish pausing new autonomous changes from pausing an individual job. |
| Models, recipes and storage | Extension catalog should expose weights/cache, disk free and admission, discover/import existing local weights/setups, reuse or resume downloads, owner-approved removal, stable model endpoints, saved exact recipes and named variants, launch with other engines, ready library, side-by-side comparison on owner prompts, benchmarks with hardware/engine/context/load and achieved quality. Preserve previous working brain on failed switch. An experiment uses workers. Spark 1 keeps one selected local brain and shares it across local Hermes calls. |
| Power and electricity | Extension uses compute-only wake, wait, resource lease, idle settings and protected workloads, stable verified plug identity, confirmed OS shutdown before cutting power. Spark 1 always on. Query sleeping workers without waking. Bench/idle decisions account for distributed workloads. Electricity same card, current LA calendar month by default, Monday-based weeks/day/month/year history, fleet and per-Spark kWh, choice of amount or custom rate, immediate estimated costs, gaps/reset reporting and preserved readings. |
| Projects and applications | Native coding/research/delegation plus checked compute execution. Preserve reproducible model/app setup and templates, access to dev boxes and notebooks, multi-step document/image/video/speech tasks, returned files, open authenticated app links, measured working conditions and stderr on failure. Prior templates include ComfyUI/Jupyter and local model clients. A catalog listing alone does not establish this path. |
| Self-work and recovery | Isolated compute checkout, evidence-based local review, tests and measured local model eval where applicable, candidate diff, interruption, exact owner approval and working rollback for every live update, verify actual owner entry point after installation. Status/pause/recovery without inference, safe service supervision and independent access recovery. User-directed Hermes schedules and watches within resource budget; no unsolicited digest implied. |
| Migration and data | Fresh Hermes conversations/memory. Archive prior state outside active retrieval, preserve models/projects/workloads/personal files, support configuration backups and deliberate restore without reviving revoked access. Existing live system remains until approved cutover. |

## Current service implementation

The prepared extension now implements reviewed single-Spark model/app starts,
exact-instance stops, progress, bounded logs and stable authenticated links.
Home and the native Telegram adapter share the same operation cards and private
controller. The two enrolled recipes are a read-only artifact browser and a GLM
compute model; Huihui remains the selected main brain. The desktop/phone Home
checks passed with inert effects, and real Compose lifecycle/relay checks have
separate receipts. Final packaging, applicable behavior acceptance and live
owner verification still govern release readiness.

This closes source gaps in the workload row above for those two recipes only.
It does not establish arbitrary app compatibility, distributed serving,
pause/resume, every historical media workflow or external-agent enrollment.
See [recipe services](recipe-services.md) and [service access](service-access.md).

## Historical boundaries

The November 19 decisions supersede the older Spark 2 host, old passkey implementation, custom UI/agent loop/workflow/memory stores, hosted checks as default, and older blanket schedule restriction. One owner and Telegram remain. Historical iMessage and members/shared administration are explicitly excluded or deferred. The owner selected signed-in public browser access, distinct from a public anonymous fleet page. Training, unsolicited voice/messages, public sharing, automatic cleanup of legacy assets, and an alternate hosted brain have no new authorization. Local speech processing is a valid task. The November 11 record specifically made retirement of the browser editor/file browser, legacy short address, members and sharing subject to final approval at removal.

## Source map

* docs/contract.md §§1–10 and docs/architecture.md govern the current product, deployment and verification.
* docs/history/hermes-transition-2026-11-19/contract-before-hermes.md §§4, 8–9, 11 and 13 record detailed owner workflows, acceptance cases and explicit exclusions.
* docs/design-2026-11-13/README.md §§2–4, docs/design-2026-11-13/owner-decisions.md and docs/design-2026-11-13/d-fleet-workloads.md cover historically planned outcomes and later cuts. docs/history/analysis-2026-11-11/README.md records the Telegram-only decision.
* public/app.js documents legacy rendered controls and navigation. sparkie/plugin/dashboard/index.js, especially Details, Electricity and Sparks, records candidate controls. Both are source evidence. sparkie/docs/compute-workspaces-plan.md, native-deployment-plan.md, native-sessions.md, completion-notices.md, power-idle.md, electricity.md and brain-service-recovery.md record candidate design and evidence boundaries.
