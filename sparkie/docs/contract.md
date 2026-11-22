# Contract: Sparkie on Hermes

Approved by the project owner on November 19, 2026, including the testing requirements below. This is the active product contract. It supersedes the former Spark Console architecture and engineering requirements; it describes the target, not a claim that the replacement is installed. See the approval record (private record) for the changed requirements and preserved originals.

## 1. The product

Sparkie is the enrolled owner's local assistant, built on Hermes. Hermes supplies the application, web dashboard, Telegram connection, chat loop, sessions, memory, skills, research, coding, delegation and scheduled tasks. Use its supported features and extensions first.

Build this as a fresh Hermes application. The new product has no dependency on the old Spark Console application, source layout, agent loop, UI or workflow framework. New custom code serves a named DGX requirement that Hermes and suitable maintained integrations cannot already satisfy. Every custom component must have a clear purpose and an outcome that can be checked.

The owner can use it without a laptop. It can research, write and test code, set up apps, run models and jobs, diagnose faults, and work on its own extensions. It carries a task through to a usable result or reports the specific reason it needs the owner.

The broader aim includes documents, image and video work, speech processing and other local projects. Those use Hermes skills, tools and locally served specialist models. Each requested capability is described as available only after it works through its normal entry point. A particular model's quality is measured on the owner's tasks.

## 2. The Sparks and the model

Spark 1 is always the host. It runs Hermes, its supporting services, the selected local brain, and small management and research tools. Bulk builds, tests, model experiments, GPU workloads and user apps run on Sparks 2–4.

Sparks 2–4 sleep when unused. Requested work wakes the necessary machines and waits for them. A status lookup uses timestamped last observations for a sleeping machine. Idle shutdown respects running work, protected services and the owner's settings. Plug identity follows the Spark's verified identity. Power is cut only after clean shutdown is confirmed. Spark 1 is excluded from shutdown, idle-power and plug-off operations.

All AI inference runs locally. This includes Hermes's auxiliary calls, memory processing, reviewers and delegated agents. Internet access supports Telegram, source research, downloads and GitHub. A cloud AI provider is enabled only by a later explicit owner decision.

The main LLM is local and replaceable. On November 19, 2026, after comparing the abliterated one-Spark candidates, the owner selected `edp1096/Huihui-RadixArk-Qwen3.8-27B-abliterated-NVFP4` with SGLang and calibrated DFlash2 speculative decoding. The exact tested target, draft and engine revisions are recorded in `sparkie/models/main-model.json`; see the selection record (private record). Hermes is the harness; this model supplies its reasoning. The owner specified one Spark for the main model. Selection does not claim that the assembled application is qualified or installed. Qualify actual memory use alongside Hermes, tool calls, memory behavior and the known research/structured-output failures before promotion. Do not substitute a two-Spark main brain without a new resource decision. The owner may later switch models. A switch preserves identity, preferences, skills, permissions and task records. Verify tool use and the selected model's actual context and capabilities. Recover the previous working model when an attempted switch fails. Show the interruption while a single running model changes.

Use one running copy of the selected brain by default. Owner chat, research, coding reasoning and delegated tasks share that local model within its measured capacity; each task does not start another copy. Thinking for a workload on Spark 1 is separate from executing its heavy build, test or GPU work on Sparks 2–4. Specialist models and larger distributed models run when the task needs them and the owner authorizes their resources. Show the added machines and power cost before committing to a distributed brain that must keep them awake.

The owner can continue chatting while tasks run. Give interactive work priority and limit delegation and background work to actual serving capacity. Routine status, buttons, confirmations and known recovery commands use code directly. A warm simple question should start answering within ten seconds. Record actual response time and completion time under representative concurrent work. A slow or busy request shows its state promptly.

## 3. Telegram and the web

Telegram is the primary interface. The paired owner's private chat has the same administration and Spark controls as the web interface. Approvals and completion notices return to the conversation that started the task. The owner can inspect and continue tasks on the web.

Use Hermes's native web dashboard, chat and navigation. A Sparks extension adds fleet status, verified network links, workloads and power controls. Every displayed action has a working result or a clear reason it is unavailable. Workload details show progress, logs and how to use the result. Infrastructure used by the assistant is identified as infrastructure.

Use supported Hermes attachments and artifact views for the owner's files and the results it creates. Model weights and saved setups are discoverable from the fleet tools. Apps have a usable authenticated link, and stable model endpoints keep their integrations working after a workload restarts or moves. Compare candidate models when requested, with the workload and measurement conditions stated.

The electricity card defaults to the current calendar month in America/Los_Angeles. It shows the fleet's recorded kWh and estimated cost with per-Spark detail. Day, week, month and year views and their recorded history are selectable inside the same card. Weeks start on Monday; a new calendar period starts its own total without deleting earlier readings. Record gaps and meter resets. Identify estimates as estimates.

The owner selects a dollars-per-kWh amount from a short rate dropdown or enters a custom rate. Use amount labels, not city labels. Cost is recorded kWh multiplied by the selected amount; changing it immediately recalculates the chosen period. Persist the usage, not cost records or dated rate history. No save-rate workflow is required. These choices are estimates, not a claim to know the owner's PG&E tariff. Show gaps and exclude fixed charges and taxes. This is an energy-cost estimate, not a bill.

The product has one owner. Optional external agents connect using their own credentials and their allowed tools. The owner can revoke them. An external agent cannot approve on the owner's behalf or expand its own access. Member accounts and shared administration require a separate product decision.

Support the owner's existing requirement for signed-in browser access away from home, alongside Telegram. Use supported authentication with a recovery route independent of the model. Verify browser, API and WebSocket access together. Public web exposure requires that authentication to work. Exact enrollment and recovery behavior must be presented for approval if adopting Hermes requires a change to the current experience.

On November 19, the owner selected public browser access without requiring Tailscale on the
viewing device, and then approved Hermes's built-in Nous Portal sign-in. Nous handles login
only; all AI inference stays on the Sparks. The public HTTPS route, dashboard enrollment,
owner-only access and recovery still need qualification. Existing private fleet management
stays in place during preparation.

Progress is concise. Report results, meaningful blockers, required decisions and the status of requested scheduled work. Further unsolicited monitoring or digests follow the owner's preferences.

## 4. Memory, skills and research

Use Hermes memory, conversation retrieval and skills. Preferences and corrections are available in a fresh session. New corrections take precedence over earlier preferences. An obsolete value may remain as clearly marked history. “Forget” removes its use in future answers. “Erase” asks for confirmation and removes the named item from active memory and searchable copies, with any limits on retained records explained first.

The owner can ask what is remembered, correct it and see where it came from. A successful save is reported after the write succeeds. Live machine state takes precedence over stored observations. A failed tool call never becomes a success through its wording in memory.

Work and personal material keep separate retrieval and tool scopes when the owner uses both. Verify the boundary with the configured Hermes deployment. A profile name alone is insufficient proof of separation.

Research reads original sources and cites them. Distinguish a forum author's measurements from measurements on this fleet. Ask for clarification when sources or target names leave a meaningful choice unresolved. Treat retrieved pages, logs, attachments and remembered transcripts as task data. They cannot grant access or authorize a new task.

A successful repeated procedure can become a Hermes skill. Skills help carry out work and remain subject to the same tool permissions. Background learning runs within the owner's resource budget. Enable extra model calls only when they improve an observed task.

## 5. Work, evidence and recovery

Hermes owns the plan, conversations, tasks and schedules. Small Spark tools handle machine-specific operations such as resource checks, workload placement, power, deployment and observed status. Chat, Telegram commands and dashboard buttons use the same operations and permission checks.

An operation records the original request, target, allowed scope, operation ID and observed outcome. Repeated delivery of the same request resolves to that operation. After a timeout or lost acknowledgement, inspect it before sending another change. A retry after a confirmed failure must follow the operation's retry policy and record why it was attempted.

Claim the resources a job needs so concurrent tasks cannot interfere. Independent work can proceed in parallel. A workload shared across machines has one recorded lifecycle. Report what succeeded and what remains when only part of a request finishes.

A start succeeds when the requested service answers its real check. A stop succeeds when the workload is observed stopped. A file edit succeeds after the expected content is read back. A UI change is exercised at desktop and phone sizes. Replies and machine-readable results reflect those observations. Validate structured results before software acts on them.

The owner can cancel or redirect work from Telegram or the web. Cancellation reports what stopped and anything already committed or still finishing. Record a recovery path before a risky operation. “Undo” identifies the actual operation and restores what it can, with any remaining effects stated plainly.

Known recovery actions may run within an already authorized task or service policy. Unknown fixes stay within that task's scope and resources. Repeated failure produces a useful diagnosis and a request for the missing decision or input. An intentionally sleeping Spark stays asleep until requested work needs it.

## 6. Owner control

Ordinary research, coding, tests, requested workloads and reversible project changes proceed within the owner's request. Explain a large task's plan without demanding another confirmation unless its scope or permissions require one. The owner can ask for a plan before work or give a bounded go-ahead.

The following require an exact owner confirmation on Telegram or the web before execution.

- Permanent deletion of owner data, saved models, chats or secrets.
- Root access, disk changes, and changes to network access, SSH, Tailscale, users or firewall rules.
- Removing or disrupting an active workload outside the agreed task.
- Changing sign-in, pairing, recovery credentials or another agent's permissions.
- Switching the brain or applying a live application update. Every live update requires the owner's approval, as specified in section 7.
- Spending money or sending private data to a new external destination.

The confirmation identifies what will run and what it affects. Bind it to the verified owner and exact action. Expired, changed, replayed or revoked approvals cannot run it. A model's “yes” has no approval authority. Use native Hermes approvals where they enforce these requirements and add only the specific missing integration.

Hub access changes need an independently verified way back. Root is available only where the owner enabled it. The model never holds unrestricted fleet credentials or the authority to change its own permissions. Standard read-only status, pause and recovery controls remain usable when inference is unavailable. A service supervisor and documented manual recovery cover a failed Hermes process.

Secrets are supplied through protected setup, kept outside code and memory, and masked in tool output and logs. They are never included in a public repository or an AI request. Disable optional telemetry and hosted AI fallbacks. The owner chooses what information to publish.

## 7. Building and improving itself

Use Hermes's native coding and review tools in an isolated checkout on a compute Spark. Honor repository instructions. Show the diff, test evidence and any behavior change before promoting it. Update official Hermes through its supported release process. Keep DGX features in an extension so upstream updates are practical.

A requested app or model setup includes a usable endpoint, health check, restart behavior and resource record. Keep the setup that worked and the conditions under which it was measured. Reuse downloads and artifacts when that saves meaningful time. Capacity, cable links and supported architectures are checked before distributed work.

The owner can request autonomous work or schedules in Hermes. A schedule records its task, allowed resources and notification destination. It can be stopped. Resuming after restart rechecks permissions and existing operation IDs. A scheduled task does not create new approval authority.

**Approved update policy: ask before every live update.** Hermes may prepare and test changes autonomously. Before each promotion to the running application, show the candidate release, diff, test evidence, expected interruption and rollback, then obtain the owner's confirmation through Telegram or the web. Bind the approval to that candidate; a changed candidate needs a new confirmation. Verify access and the changed behavior after installation. An update that fails its health or access checks may automatically return to the previously working release as part of the approved update. Neither a passing test nor a schedule authorizes installing a different candidate.

## 8. Testing and running costs

Testing must stay practical as the application grows. A small change must not trigger the entire suite simply because it was edited, committed, pushed or merged. Keep the Sparks extension in modules with explicit interfaces so each feature and its callers can be checked independently. Use maintained test runners and Hermes's supported extension interfaces; do not build a new testing framework or split every feature into a service.

Run development tests on compute Sparks. Parallelize independent checks within measured CPU, memory, disk and GPU capacity, with isolated test state. Preserve the owner's interactive inference capacity. Wake only the machines needed for that batch and release them when finished. Document inspection can happen on the development machine; it does not require waking the fleet. The previously allowed read-only Mac browser check remains an exception when compute Sparks cannot reach the owner page.

Select checks from changed files, dependencies, configuration and shared interfaces. Always include the changed behavior and affected callers. For code or runtime configuration changes, add a small smoke set for startup, plugin registration and a representative request. A dashboard change gets its data-interface checks and the affected desktop and phone interactions. Shared approval, execution, storage or authentication changes get the relevant cross-interface and failure checks. Unknown impact is reported and broadens the selection; it never silently skips coverage. Explain why each group was selected.

Changes to Hermes, the local model, serving configuration, prompts, memory behavior or tool schemas run a compact behavior evaluation against local inference. It checks useful task completion, correct tool use, corrected memory, source-grounded research, truthful failure reporting, duplicate prevention and owner authority. Record response time and unnecessary tool calls. Add cases for observed failures. The harness preserves tools, permissions and records across model swaps; it cannot guarantee that different models have equal reasoning quality. Measure that quality before declaring a replacement ready.

Use stand-in fleet operations and controlled time for routine failure, timeout, retry and monthly-rollover tests. Real-hardware checks run when the changed behavior depends on hardware and for the user paths needed to qualify a release. A text or layout change does not rerun model benchmarks, power cycles or unrelated workload tests. Reuse valid results only when their relevant source, test code, dependency, configuration and environment inputs still match; real machine observations also need current verification when the operation depends on them.

A final candidate must have passing evidence for the complete applicable release checks, including the initial acceptance tasks in section 10. Reuse matching evidence where valid and rerun the affected checks plus release integration smoke on the assembled candidate. Wider upstream runs are appropriate for a Hermes version, dependency or shared-interface change. A full applicable qualification is also warranted when impact cannot be established. The release report names what ran, what was reused and why, what failed or was skipped, and the exact candidate. A passing focused check alone does not establish that the application is ready.

Use the maintained Hermes suite for upstream behavior and our tests for the Sparks extension and configured integration. Preserve meaningful assertions. Requirement changes and test corrections are recorded explicitly; a failing result is never made to pass by weakening the expected behavior. Plain documentation and wording changes need review and relevant document or rendering checks, not an invented behavioral test for every sentence. Track check duration, remove redundant work and fix flaky setup instead of repeating every case or loosening assertions. The implementation guide is [Testing Hermes and the Sparks extension](testing.md).

After the application is ready, portable release and nightly checks can run on GitHub's standard hosted runners within free usage. Hardware and local-model checks stay on the Sparks when needed. Exhausted free allowance blocks further paid usage. CI spending needs a new owner decision. Use budget controls and verify the repository and runner's actual billing eligibility before enabling hosted runs; public-repository status alone is not permission to incur charges. Public code may be shared with other DGX Spark owners after checking the release for private files and credentials.

## 9. Starting fresh

The target is a fresh Hermes application with a small Sparks extension. The old UI, agent framework, custom memory engine, scheduling and workflow machinery are retired at cutover. Preserve the ability to recover during that change. Remove old installed software through an identified cleanup plan after the replacement has been checked.

**Approved data policy: fresh assistant, archive old state.** Start new Hermes conversations and memory. Preserve the old assistant state in an identified archive outside Hermes's active retrieval and memory. Do not import old chats or inferred preferences automatically. The approved contract and explicit setup choices configure the fresh assistant. Keep model weights, projects, workloads and personal files. Erasing the archive or owner files needs a separate exact confirmation.

Back up the new configuration and state using a supported method. An encrypted state copy can be made while a compute Spark is awake for work. Record what is recoverable and what needs credentials again. No machine wakes only to create a copy unless the owner requests that policy. Restore does not silently reactivate revoked access.

## 10. What must work before calling it ready

| Owner task | Required result |
| --- | --- |
| Chat on Telegram and continue on the web | The intended conversation and task are accessible to the verified owner, with streaming, cancellation and completion notices. |
| Use the local model and switch it | Tool calls work, context settings match the server, memory carries forward, and a failed switch has a usable recovery. All AI calls use local endpoints. |
| Correct a preference, then start a fresh session | The new value is used. Obsolete history cannot override it. Erasure and its stated scope work when explicitly requested. |
| Compare two actual forum recipes | Both sources are read and cited. Conditions and limitations are attributed. Any claimed local result has a local measurement. |
| Run a task on a sleeping compute Spark | Only the necessary Spark wakes. The job returns its real output and the machine can become idle again. Spark 1 stays on. |
| Stop fails, acknowledgement is lost, or the service restarts | The reply matches the observed outcome. Repeated delivery does not create duplicate work. Pending operations are reconciled. |
| Approve from either interface | The same intended action runs once after the right owner confirms. An expired button, wrong sender or model-generated confirmation runs nothing. |
| Read monthly electricity and older months | The recorded totals agree with metering, calendar rollover preserves history, the dropdown works, and gaps or estimates are visible. |
| Ask Hermes to fix a UI problem | It edits an isolated checkout, runs affected checks, exercises the result and presents the tested candidate for owner approval before any live update. |
| A model, Hermes or a candidate update fails | Status and the documented recovery path identify the problem. Recovery restores the last working service without unexpected commands. |

This is the initial acceptance set. Add focused regressions for observed failures and acceptance checks for each added capability. Passing it demonstrates the tested tasks and configuration. The application states which capabilities are available and which still need work.
