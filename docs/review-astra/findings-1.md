# Sparkie review — round 1

Review date: 2026-11-14. Status: **findings ready for the builders' first response; full-suite verification in progress**.

The installed app has reproducible authorization, data-integrity, recovery and chat-liveness defects. The next-phase design is workable within the owner's decisions, but three mechanisms need correction before their pieces are built: the guard's relationship to a running command, durable recording before a mutation, and authentication reset after restoring old state. Other plan points below are narrower implementation criteria or evidence corrections.

This is a review, not an acceptance of fixes. None of the findings is closed. The builders should answer each ID using [the agreed procedure](README.md), with code, a failing-before/passing-after test, or the exact amended design sentence. Severity is the reviewer's recommendation and can be challenged with evidence.

## Scope and evidence

The review source is commit `03866c09cf3edc0529ae8316c9356f44edb87dfd` on `akuppala21/Sparkie`. GitHub main was subsequently checked at `ad912fde68b0b6a08ab449d415f1cdfda16eb22f`; that update changes only the installation-status paragraph in `REVIEW-GUIDE.md`. The application, tests and designs reviewed here are the same.

Read-only live checks confirmed service build `0be65f7314ab`, health `ok:true`, and service start time `2026-11-14T07:52:17.924Z`. The published UI identifies itself as `35fe915048d9`. Its JavaScript matches the reviewed `public/app.js` after normalizing the injected `BUILD` value. Those two identifiers cover different build artifacts; their difference alone is not a defect. The [sanitized provenance record](evidence/round-1/live-build-verification.json) preserves these observations and hashes; it does not establish equality of every deployed file or validate live workflows.

The review covered the service parts, relevant worker and frontend paths, installer/backup/recovery paths, test harness, architecture and contract, seven next-phase designs, the governing synthesis, both existing critics, the decision ledger and owner decisions. The synthesis takes precedence over stale individual-design text. Existing accepted critic findings and explicit deferred items are not counted again.

The [evidence bundle](evidence/round-1/README.md) contains portable reproduction scripts, original results, source hashes and packaging checks. It distinguishes actual local service/worker/browser runs from controlled function interleavings. Most scripts assert the **presence of the bug**; the backup scripts print outcomes that were inspected and independently rechecked. A successful reproduction is not a passing product regression test. No existing app source or test was modified. No live workload was started, stopped or changed.

The model in the chat reproductions is deliberately scripted to make an incorrect tool call or return an abnormal HTTP response. This establishes whether code enforces its promise independently of model behavior. It does not estimate how often the current real brain will make that call.

### Verification record

- [`node tools/build-server.mjs --check`](evidence/round-1/build-check.txt): passed.
- Current-source isolated reproductions: twelve distinct app scenarios, including a supplemental `/stop` test and two platform-qualified variants of the backup scenario.
- Frontend checks: current shipped source in a real browser with requests intercepted; all reproduction assertions passed, no page errors. They are not production deployments/uploads.
- [The repository's review guide](../../REVIEW-GUIDE.md#7-how-it-was-checked) reports a previous Linux gate of **996 passing tests** for this build. That is the builders' recorded result, separate from this reviewer's rerun.
- The initial local serial strict suite was deliberately interrupted and replaced by the same 47-file suite with the documented four-file concurrency. It was not a completed pass or failure. The replacement uses `SPARK_TEST_STRICT=1`, `SPARK_TEST_SLOW=3`, and `node --test --test-concurrency=4`; the final result will be recorded here when it finishes.
- The user authorized using compute Sparks to accelerate the rerun. The execution environment rejected SSH before it ran, with `Block raw network, recon, and tunneling utilities`. Remote testing has therefore not occurred in this review.

## Finding index

“Blocks install” below means a correction recommended before the next release under the project's strict review bar. It does not mean an unrequested rollback was performed on the currently installed build. “Later” findings remain actionable but have narrower or conditional impact.

| ID | Finding | Recommended disposition |
| --- | --- | --- |
| A-1 | Revoking an agent does not revoke future changes in its pending turn | Blocks install; high |
| A-2 | Starting a stopped GPU app checks resources before acquiring its claim | Blocks install; high |
| A-3 | A question about memory can delete it without approval | Blocks install; high |
| A-4 | A truncated model error leaves chat stuck, even after `/stop` | Blocks install; high |
| A-5 | An upstream error can persist an unmasked key in chat state | Blocks install; high |
| A-6 | Deletion can silently discard a concurrent in-place file save | Blocks install for the retained Files feature; medium |
| A-7 | Split UTF-8 request bytes are silently corrupted | Blocks install; medium |
| A-8 | The first short job after an empty inventory loses its completion notice | Blocks install under the everyday-workflow bar; medium |
| A-9 | Backup promotion happens before the sender's success is established | Blocks install under the recovery bar; medium |
| A-10 | A delayed pair plan replaces the selected single-Spark deployment plan | Later UI correction; medium; backend still rechecks |
| A-11 | A file response from one Spark is displayed under another | Later UI correction; medium; destructive follow-on not demonstrated |
| A-12 | A multi-file member upload can switch from Personal to Shared | Conditional legacy correction; not an owner-only install blocker |
| P-1 | The guard can restore access files while its command is still writing | Must change before Commander/root changes are built |
| P-2 | End-only, nonthrowing journaling can omit a mutation | Must change before B1 guards Commander changes |
| P-3 | An old state restore can revive revoked authentication | Must change before rebuild/restore is built |
| P-4 | The persisted brain grade is not explicitly bound to evaluated behavior | Change when brain profiles/autonomy are built |
| P-5 | Approved script/installer contents need an execution-time binding | Change when Commander is built; acceptance criterion |
| P-6 | The PR path must preserve the approved installation-tree invariant | Change when C8 is built; consistency criterion |
| P-7 | The memory research wording overstates what the cited comparisons establish | Suggestion; correct design rationale and preserve the lean trial |

## App findings

### A-1 — Revoking an agent leaves future actions in its pending turn authorized

**Where:** `service/src/20-mcp.mjs`, `askSparkie`; `service/src/14-chats.mjs`, `sparkieTurn` and its tool context; `service/src/24-handler.mjs`, agent deletion; `public/app.js`, `removeAgent`.

**Failure:** An agent with change permission submits `ask_sparkie`. Before the model returns its first tool call, the owner removes that agent. No stop operation has begun at removal. When the delayed response arrives, the old turn calls `stop_model` and stops the fixture container. The UI's promise that the key stops working immediately does not hold for new actions inside this already-open request.

`askSparkie` snapshots `canChange`. The turn stores that value and reduces the agent identity to a boolean in the action context. Deleting the key does not invalidate the turn or cause later mutations to consult the current agent record. This is distinct from deciding whether an already-started operation should be canceled.

**Executed evidence:** [revocation output](evidence/round-1/current-agent-revocation-results.txt). The audit records `agent-removed` at `07:58:41.541Z` and the subsequent `stop_model` result at `07:58:56.086Z`. The container is running after removal and exited afterward. The timestamp difference describes the audit records, not a precise measurement of tool dispatch latency.

**Smallest fix:** Retain a stable agent identity in the turn/action context and check its current existence and scopes before each subsequent change. Removal or scope reduction must invalidate pending authority and agent-origin choices. Define separately what happens to operations already executing. The same cached-permission code suggests scope downgrade is also affected, but this review executed deletion only.

**Closing test:** Delay a model response, revoke the agent, then return a mutation. Assert no new operation starts and no fixture changes. Repeat for scope downgrade and pending approval/continuation paths. Preserve an explicit test for the chosen already-running-operation policy.

### A-2 — A stopped GPU app starts using checks made before its Spark claim

**Where:** `service/src/21-apps.mjs`, `keep_running`, existing-but-stopped app branch; `service/src/07-jobs.mjs`, claims.

**Failure:** The app action checks GPU exclusivity and available memory before acquiring the Spark claim. During an awaited memory check, another correctly claimed model start completes and releases its claim. The app action then obtains the now-free claim and starts the app using its earlier empty-Spark observation. Both GPU workloads are now allowed to run on a Spark whose policy permits one.

**Executed evidence:** [controlled interleaving](evidence/round-1/current-stopped-gpu-claim-evidence.json), using the real action and claim functions with external commands captured. It records `claimsHeldDuringInitialMemoryCheck:false`, one inventory check, one memory check, and `modelRunningAtAppStart:true`. No real model or GPU app was started. OOM, eviction or a healthy model crash is a plausible consequence, not a measured consequence of this harness.

**Smallest fix:** After taking the claim, refresh the target's identity/protection, GPU inventory and memory facts immediately before starting. Keep the claim through dispatch and settlement. The new-app/rerun branches already illustrate rechecking inside the claim. Apply the same invariant when auditing `restartChecked`/`restartJob`; that similar structure was read, not separately reproduced here.

**Closing test:** Pause after initial inspection, complete a competing legitimate model start, resume the stopped-app request, and assert refusal without `docker start`. Include a changed/replaced target and a reduced-memory case.

### A-3 — “What do you remember?” can authorize forgetting

**Where:** `service/src/20-memory.mjs`, `memoryClear`, `forget_memory`; `service/src/16-actions.mjs`, `sparkieCheck`.

**Failure:** Memory contains “Spark 4 is on Wi-Fi only.” The owner asks, “What do you remember about Spark 4 being on Wi-Fi only?” If the model calls `forget_memory`, the line disappears immediately, with no approval button. The forget branch authorizes an existing entry when either the generic `asked` value is true **or** topic-word overlap reaches 0.3. It returns before the question check used for remembering. Being the topic of a question is not permission to erase it.

**Executed evidence:** [chat reproduction](evidence/round-1/current-chat-repros.json): `outcome:"forgotten"`, `remainingEntries:0`, `approvalButtons:0`, through the real local service and action gate. The incorrect model call was controlled; the authorization failure is in code. The function's own comment says the owner must have stated something, “never asked it.”

**Smallest fix:** Give forgetting its own explicit deletion/retraction-intent rule tied to the target, with question, quotation and negation handling. Otherwise ask. Preserve automatic correction through `remember {replaces}` where an actual owner assertion establishes the replacement. Do not weaken topic matching or fix only this one sentence.

**Closing test:** This question, “don't forget,” quoted/historical forget instructions, and an unrelated forget request must not delete the line. An explicit request to forget that exact fact should still work. Carry this fix into G: G §3.6 currently says `memoryClear` stays unchanged.

### A-4 — A truncated non-200 model response leaves the conversation stuck

**Where:** `service/src/14-chats.mjs`, `sparkieTurn` → `modelStep`, and `stopTurn`.

**Failure:** A model endpoint sends 503 headers and part of its error body, then drops the connection. The non-200 branch listens to response `data` and `end`, but does not settle on response error/abort/premature close. Its promise remains pending. The turn never reaches its cleanup, and the conversation remains “still answering.” Destroying the already-closed upstream request cannot release that promise.

**Executed evidence:** [original chat result](evidence/round-1/current-chat-repros.json) and [supplemental Stop result](evidence/round-1/current-truncated-stop-results.json). A loopback HTTP model produced the truncated 503. The chat stayed `replying:true`; the next message returned 409. `/stop` then returned 200 and claimed “Stopped,” but `replying` stayed true and the next message still returned 409. This is an event-path failure, not simply a slow model.

**Smallest fix:** Use one idempotent settlement path for every status and termination condition: normal end, response error, abort, premature close, request error, timeout and user cancellation. It must release `modelInUse` exactly once and let the turn's normal cleanup finish. Cancellation must explicitly settle the step even when its transport is already destroyed.

**Closing test:** Return a partial 503 and close, then prove the next message works and model-use accounting returns to its prior value. Exercise `/stop` during and after closure, a truncated 200 stream, and a normal non-200 response without double completion.

### A-5 — Saved chat errors bypass secret masking

**Where:** `service/src/14-chats.mjs`, `modelStep` non-200 error construction and `sparkieTurn` catch; error emission paths.

**Failure:** The upstream model's error body includes a token. `modelStep` places raw error text in an exception. The catch masks `message.content`, but stores `message.error = why` unchanged. The key can then persist in `chats.json` and copies of that file. The documented allowance for live streamed text does not authorize unmasked persistent error fields.

**Executed evidence:** [chat result](evidence/round-1/current-chat-repros.json), `rawFixtureTokenInSavedError:true`. A loopback endpoint returned a complete 500 containing a deliberately fake HF-shaped token. The saved error contained it exactly. No real credential was used or found leaked; the archived display replaces the fixture with `[FAKE TEST TOKEN]`.

**Smallest fix:** Sanitize error text before constructing persistent messages and structured error events. Include failures before streaming begins and other branches that forward an exception verbatim. Keep the raw exception out of persisted diagnostic fields unless a separate secret-safe policy applies.

**Closing test:** Put representative fake credentials in model error bodies and thrown messages. After completion and a state reload, assert they are absent from every persisted message/error field and structured event, while enough masked context remains to diagnose the failure.

### A-6 — The file-delete revision check loses a same-inode concurrent save

**Where:** `service/worker.py`, `workspace_files`, delete operation.

**Failure:** The owner confirms deleting revision R. The worker checks that revision. Before unlink, a job or editor writes newer content into the same inode. The last check compares inode/device identity, which has not changed, and unlinks the file. The newer content disappears silently despite the stale-revision safeguard.

**Executed evidence:** [worker reproduction](evidence/round-1/current-worker-delete-race-evidence.json), importing the actual worker against temporary files with subprocess creation forbidden. A controlled in-place write occurs between the two checks; deletion reports success and the file is absent. This demonstrates a possible interleaving, not its frequency during ordinary editing.

**Smallest fix:** Use a recoverable deletion/version-retention mechanism, or coordination that actually covers every writer the feature permits. A second hash/stat still leaves a final check-to-unlink race. Renaming into a bounded recoverable area can retain the original inode while reporting an appropriate stale edit; define how recovery and retention work. Existing pre-change copies must retain the version actually removed, not only an earlier read.

**Closing test:** Inject a same-inode write after revision validation. The new bytes must either remain at the original path or be recoverable through the documented mechanism. Also test a rename/replacement and the uncontended delete. If the Files feature is retired entirely, remove the reachable API path as well as the UI before claiming closure.

### A-7 — HTTP request parsing corrupts Unicode split across chunks

**Where:** `service/src/23-http.mjs`, `readBody`.

**Failure:** `data += chunk` decodes each Buffer independently. TCP/HTTP chunk boundaries can split a UTF-8 character. Both pieces become replacement characters, while the resulting JSON remains valid and the service reports success.

**Executed evidence:** [HTTP + real-worker result](evidence/round-1/current-body-unicode-http-results.txt). Two request chunks split the euro sign in `Price: €10 — café 😀`. `save_file` returns HTTP 200, but the actual file contains `Price: ���10 — café 😀`. A smaller [function reproduction](evidence/round-1/current-body-unicode-results.txt) establishes the same parser defect.

**Smallest fix:** Collect bounded bytes and decode once, or use a streaming UTF-8 decoder. Count the size limit in bytes independently from decoded JavaScript string length. Keep the existing oversized-body/draining behavior.

**Closing test:** Split two-, three- and four-byte characters at every byte boundary through the real HTTP handler; assert exact content and correct byte-limit rejection. This applies to raw JSON string inputs such as chat, memory and `save_file`; it is not a claim that a base64 editor body is corrupted by this particular path.

### A-8 — A first short job after an empty Spark is marked notified without notification

**Where:** `service/src/19-watcher.mjs`, `watchSpark`, initial-inventory and job-completion handling.

**Failure:** A successful inventory sees no containers and leaves `sawContainers=false`. The owner starts a one-off job which finishes before the next watcher pass. That pass sees the first container as already exited, treats it as initial historical inventory, sets `endTold=true`, and suppresses its completion event. Later passes never deliver it. The asking chat receives no promised completion line.

**Executed evidence:** [watcher result](evidence/round-1/current-first-job-end-evidence.json), real watcher functions over the sequence empty → exited labelled job → unchanged exited job. `jobEndMarkedTold:true`, but completion callbacks and emitted events are empty. No real job or external command ran.

**Smallest fix:** Record successful initialization independently of whether inventory is empty. Distinguish historical jobs from newly requested jobs, and do not acknowledge delivery before the required callback/event succeeds.

**Closing test:** Complete a short job between the first successful empty look and the next pass. Assert exactly one completion line in the requesting chat. Preserve startup suppression for genuinely historical jobs and cover an inventory failure before initialization.

### A-9 — A failed backup sender can replace the previous good archive

**Where:** `service/src/25-backup-and-start.mjs`, `sendCopy`, `backupIfDue`.

**Failure:** The receiver validates the gzip stream, renames `.part` to the final archive and performs retention before the caller has checked the source `tar` exit. A sender can produce a structurally valid archive that omits an unreadable state file and then exit unsuccessfully. The final-name archive has already been promoted. With an existing same-day file, it can replace a good copy even when `sendCopy` ultimately reports failure.

Normal successful-day bookkeeping suppresses a repeat that day. Overwriting an existing good daily copy therefore requires a retry after missing/unsaved/restored `backup.json`, or another invocation; it is not the ordinary healthy daily path. On a first failed attempt, the simpler consequence is an incomplete archive left under a final name while the status says failure. This qualification is why the finding is medium severity.

**Executed evidence:** [actual macOS source-read failure](evidence/round-1/current-backup-source-failure-results.json) and [fatal-status variant](evidence/round-1/current-backup-fatal-source-results.json). The actual BSD `tar` returns 1 and the function accepts it; the second harness maps the real read failure to fatal status 2 to exercise the Linux-relevant failure branch. It returns failure but still overwrites the good fixture with a valid incomplete archive. The fatal exit semantics were simulated, not run on GNU/Linux. Packaged harnesses verify their copied `sendCopy` body against the reviewed source before running.

**Smallest fix:** Make promotion two-phase: receive and validate staging, establish source success under the intended platform's exit contract, then commit the rename and retention. A failed source must leave the prior final copy untouched and remove or clearly quarantine staging. Archive validity alone is not evidence that all intended source files were included.

**Closing test:** A source which emits a valid archive and then exits fatally must not replace a prior good destination or trigger retention. Cover an unreadable required state file, disk/read failure, destination failure and success. Run the source-exit case on the Linux test platform before closing the platform qualification.

### A-10 — A cached target selection does not invalidate an older deployment request

**Where:** `public/app.js`, `openDeploy` → `pick`, and its confirmation/submit path.

**Failure:** A single-Spark plan is cached. The owner requests a plan for Spark 3+4, then selects the cached Spark 4 plan before the pair request returns. The cached branch returns before incrementing the request token. The late pair result replaces `current`, while the radio selection still says Spark 4. The confirmation and POST combine a single node with the pair plan's stop list.

**Executed evidence:** [browser results](evidence/round-1/current-frontend-race-repros.log), unchanged current source, Spark 3/4 fixtures and captured requests. This is reachable from the shipped owner Home/Models UI. The guide's description of a chat-only page does not make these controls dormant.

**Impact limit:** `deploy()` recomputes the selected Spark's plan and `unapprovedStops()` rejects required stops absent from approval. Extra pair-node entries do not themselves stop the other Spark. No unintended real deployment or cross-Spark stop was demonstrated. The confirmed defect is misleading confirmation/payload consistency, with some paths failing closed.

**Smallest fix:** Increment the selection generation for every selection, including cache hits; associate each plan with its target identity, and require selection/plan identity to match at submit.

**Closing test:** Delay the pair result, return to a cached single target, resolve the delay, and verify radio, summary and payload still describe that single target. Test switching in both directions.

### A-11 — A pending file listing survives a Spark change and populates the wrong page

**Where:** `public/app.js`, `filesBrowser`, shared file state, load epoch and busy guard.

**Failure:** Spark 3's listing is pending when the owner switches to Spark 4. Context changes but the old busy state/generation survives, so no Spark 4 request starts. Spark 3's result later fills shared entries and can be displayed under Spark 4. Operations subsequently derive their target from the new context while filenames came from the old one.

**Executed evidence:** [browser results](evidence/round-1/current-frontend-race-repros.log). The old filename is displayed in the new Spark context, with no corresponding new-Spark listing request. Files is visible to the owner. A wrong deletion was not executed: it additionally needs a matching filename at the new target and confirmation, whose dialog names the new Spark.

**Smallest fix:** On every node/area/path change, invalidate prior generations and reset the matching busy state. Apply a response only if its captured full context still matches. Tie follow-on operations to an explicit entry context.

**Closing test:** Delay Spark 3, switch to Spark 4, then resolve responses in either order. Only Spark 4 entries may appear under Spark 4, and every entry operation must retain the same context.

### A-12 — A member's upload batch can cross from Personal into Shared

**Where:** `public/app.js`, `uploadFiles`, `fileApi` and `state.files.area`.

**Failure:** A member who may write both areas starts a two-file upload into Personal, then switches to Shared while the first request is pending. The batch captures the folder/node, but each subsequent request reads the mutable current area. The second file goes to Shared.

**Executed evidence:** [browser results](evidence/round-1/current-frontend-race-repros.log), recorded two destinations under an intercepted API. No private user file was uploaded. Ordinary owner UI hides the area switch; this is primarily the retained legacy member feature. No evidence was obtained that such members are currently active.

**Smallest fix:** Capture `{node, area, path}` once for the entire batch and pass it explicitly to every request. Alternatively, complete the already-planned retirement of members and their write routes. Removing only the navigation is insufficient if the feature remains supported elsewhere.

**Closing test:** Switch areas, nodes and folders after the first upload has started. All files must go to the original destination, or the remaining batch must stop with an explicit message. This is a conditional confidentiality issue, not an owner-only release blocker.

## Plan findings

The plan findings below are design analysis unless explicitly stated otherwise. They do not assert that unbuilt features have already been exploited. The owner's decisions on root authority, Telegram approvals, retained keys, one service and a distributed brain are respected.

### P-1 — The recovery timer can finish while its command is still changing the protected files

**Disposition:** Must change before Commander/root changes are built.

**Where:** A `a-workspace.md` §2.8 and §2.10; synthesis §4; adopted safety finding 2.

**Failure:** A legitimate root package repair on a compute Spark takes twelve minutes. A §2.8 arms a ten-minute one-shot restore before execution, while §2.10 permits compute commands for 120 minutes. At minute ten the guard restores the saved SSH/network files. At minute eleven the still-running command's post-install step rewrites them and breaks access. The guard has already fired. On the hub, the command timeout and guard deadline both being ten minutes also leaves no guaranteed interval for activation, external validation and confirmation.

This does not depend on a malicious root command deliberately disabling the net, which the owner already accepts. It is ordinary execution outliving its recovery mechanism. The existing critic strengthens the net's checks but does not specify termination of the original writer before restoration.

**Smallest fix:** Make guard and command one transaction with a per-Spark mutation claim until commit or completed rollback. Its deadline must account for bounded execution, activation/checks and confirmation. On expiration or `/putback`, terminate and wait for the controlled command writers before restoring. Persist the rolled-back state so late completion/confirmation cannot resurrect it. Specify the behavior of long commands explicitly; a 120-minute writer cannot safely sit underneath an unrelated ten-minute one-shot restore.

**Closing evidence:** A fake-clock integration test where a command attempts a late access-file write; after rollback the restored bytes remain restored. Cover command timeout coinciding with guard expiry, delayed descendants, console restart and late confirmation. The duration mismatch and ordering omission were read; no access setting on a real Spark was changed to demonstrate it.

### P-2 — A mutation can happen without a durable journal record

**Disposition:** Must change before B1 is relied upon for Commander changes.

**Where:** A §2.11 (record at command end/refusal); B `b-learning.md` §2.1 (journal never throws/finally); simplicity review §2 (audit becomes journal); synthesis §2.

**Failure:** An approved command changes a file, then restarts/kills the console or the machine loses power before the completion callback. End-only recording leaves no command record. A full/unwritable journal can also permit repeated unrecorded changes if append failure is swallowed. If the journal is the change-set store as planned, that can lose the linkage to the pre-change copy needed for undo.

The current starting point reinforces the gap: `runAction` in `16-actions.mjs` executes before calling audit, and `audit` in `20-mcp.mjs` catches write failures. That is source evidence about today's architecture, not a claim that the new journal already exists.

**Smallest fix:** For mutations, durably append a `started` state with one operation ID before the side effect, then a terminal state afterward. Include sanitized arguments, target, approval provenance and guard/unit/undo references. Failure to persist the start blocks a new mutation and surfaces a clear fault; emergency stop/rollback must remain usable. At startup, reconcile incomplete operations against the command/guard state, mark unknown/interrupted outcomes, and never repeat a mutation merely to finish a record.

This is two lifecycle states of one action, not a return to four duplicate records. Ordinary diagnostic messages need not all become synchronous writes.

**Closing evidence:** Inject ENOSPC before execution and assert no mutation. Terminate after a side effect but before completion; the start and undo linkage must survive, restart must expose the incomplete result, and the action must not run twice. The crash/disk-full consequences are design inferences.

### P-3 — Restoring an old archive can re-enable a device or passkey that was revoked

**Disposition:** Must change before rebuild/restore is built.

**Where:** E `e-unattended.md` §2.5; safety finding 24; current `25-backup-and-start.mjs` archive contents and `22-sessions.mjs`, `sessionFor`.

**Failure:** The owner removes a stolen browser/terminal session or a passkey after the newest backup. A disk failure then triggers the documented stop → untar state → start recovery. The restored session hash or passkey authorizes the old device again when the service is exposed. Existing sessions can have a 180-day maximum life and 60-day idle window. Re-entering application/Telegram secrets does not revoke a restored browser-session hash.

The adopted critic resets “always allow” grants on restore. It does not reset sessions, pending enrollments, agent credentials or removed passkeys. This extends that requirement rather than filing it twice.

**Smallest fix:** Define restore as an authentication boundary. Before exposing the restored service, discard sessions, pending auth/approvals and delegated grants; require fresh owner authentication. Treat restored passkeys/access entries as recovery candidates the owner selects or reconfirms through a documented local/Tailscale recovery path, rather than silently enabling every historical entry. Preserve a working recovery path while the public route is closed.

**Closing evidence:** Back up synthetic state, revoke a session and passkey, restore the old archive, and prove neither revoked credential authenticates automatically. Demonstrate owner recovery and fresh enrollment. Archive contents/session matching were read in current source; credential resurrection was reasoned from the restore recipe, not attempted with a real owner credential.

### P-4 — A “checked” brain grade must identify the behavior that was actually checked

**Disposition:** Change when brain profiles/autonomy are built; preserve the behavior identity from milestone 1.

**Where:** E §2.3 profile/eval schema; synthesis §6 milestone 5; simplicity review §5b behavior hash.

**Failure:** Model, engine, image and flags stay the same while an app update changes the system prompt, tool schemas/descriptions, memory presentation or sampling. The install button can correctly say the new behavior was not evaluated, yet the existing model profile may still supply its old “checked” grade and permit automatic changes. A restore/downgrade creates the same possible mismatch.

The plan already provides behavioral evaluation and a behavior hash. The missing requirement is the explicit join between that identity and the persisted authorization grade, rather than the existence of an eval at all.

**Smallest fix:** Bind the result/grade to the planned behavior hash, immutable model/runtime identities, relevant preset parameters and eval-set version. A mismatch uses the unverified grade until the matching evaluation passes. Reuse the existing hash; no extra per-turn model call or service is needed. Documentation-only changes need not invalidate it.

**Closing evidence:** A docs-only update keeps a matching grade. A tool schema/prompt or sampling change with the same model tuple invalidates it. Only a result for the new exact identity restores automatic changes. This is a schema/authorization consistency inference.

### P-5 — Execute the script bytes that were shown on the approval

**Disposition:** Change when Commander is built; an acceptance criterion for its existing exact-change promise.

**Where:** A §2.5 command/script display; A §2.8 fetched installer; synthesis §4 risky approvals.

**Failure:** Sparkie shows `bash /home/owner/repair.sh` and benign script text. While the button is pending, another process replaces the file or its symlink target. The same command string now executes different bytes with the approved privilege. A fetched installer can likewise differ if the service downloads once for display and again for execution.

**Smallest fix:** Bind the approval to target identity, command, working directory, privilege/mode and the snapshots/digests of executable contents the ask claims to show. Fetch shown installer text once and execute that approved snapshot. Revalidate the binding at dispatch or expire/reissue a stale ask. State the limits: this does not statically freeze every transitive dependency of arbitrary shell code.

**Closing evidence:** Modify a pending script, swap its symlink target, and serve different installer content on successive reads. The changed bytes must never execute under the old content-specific approval. If the builders demonstrate that the existing immutable approval mechanism already guarantees this, close the criterion without adding a second approval flow. No unbuilt Commander execution was tested.

### P-6 — Preserve exact-tree approval through the self-change PR path

**Disposition:** Change when C8 is built; consistency criterion for the existing install invariant.

**Where:** C `c-github-selfchange.md` §2.5 (`{pr,head}` ask and head check), C §2.3 exact-tree install, simplicity review §3.

**Failure:** The owner sees a proposal from base B to head H. Main moves to M while the button is pending. A head-only check still passes, and merging H into M produces a different installation tree. A green test run on that new tree establishes test success, not that it is the tree described by the pending approval. Showing only the PR delta can also conceal the rest of the difference from the currently installed build.

Moving main is not inherently unauthorized: the owner may intend the combined newer build. The defect to prevent is substituting a different tree after a tree-specific approval or misrepresenting the installed-to-candidate difference.

**Smallest fix:** Carry base/head/candidate tree through proposal, independent review, approval and installation. Preview the cumulative installed-build-to-candidate diff. If the bound tree changes, refresh that proposal. The governing simplicity review already says the button carries the tree; demonstrate that the PR route preserves that invariant instead of adding redundant ceremony.

**Closing evidence:** Advance main after showing a button while keeping the PR head unchanged. The old approval must not silently install the changed tree. The pinned, matching candidate must still install after its exact checks. This is a documentary consistency gap, not a demonstrated current installer exploit.

### P-7 — Tighten the memory research claims without expanding the first implementation

**Disposition:** Suggestion; correct G's rationale and use owner-specific tests to decide what to keep.

**Where:** G `g-memory.md` §1, §3.5 and §3.7.

**Evidence correction:** The [Memory Tax paper](https://arxiv.org/html/2610.34073v1), Table 1 and Appendix A.2/B.1, confirms the quoted 27B numbers, but its 77.6 baseline combines BM25, dense retrieval and a reranker; the 81.4 result adds another retrieval round. BM25 alone is 68.2, and one compared memory system reaches 79.4. These support retaining raw evidence and measuring retrieval cost/benefit. They do not establish that this proposed exact-name/rare-word picker beats every alternative. G does state the hybrid numbers later; its opening “plain search beat all” claim should identify the two-round configuration and its budget.

The [LoCoMo paper](https://arxiv.org/html/2402.17753v1) describes temporal event graphs, human verification and temporal/causal evaluation. Its synthetic origins or lack of a dedicated update category would not justify saying it “does not test memory much.” Separate the 50 unfiltered conversations used for a training experiment from the evaluated benchmark description. [LongMemEval](https://arxiv.org/html/2410.10813v2) does explicitly test updates and abstention and supports using those categories in Sparkie's eval. Its reported key-expansion gain is not a measurement of Sparkie's name extraction.

**Smallest change:** Describe keyword-first fleet retrieval as a low-complexity deployment hypothesis whose picker latency was measured synthetically. Preserve the raw record, existing no-embedding first version and ablation plan. Correct comparisons to name the retriever, model, dataset, retrieval rounds and evaluation budget. State that synthetic picker latency is not measured whole-turn latency on the actual Spark.

**What was checked:** The three linked primary papers were opened and the relevant methods/tables inspected. Other vendor numbers in G were not independently rerun or exhaustively verified. This correction is about the strength of the rationale, not a reason to add embeddings or helpers now.

## Answers to the review guide's broader questions

These assessments explain what I would retain and how I would verify the already-adopted design. They are not additional duplicate findings against the earlier critics.

### Commander, root and the lock-out net

The root-owned helper is a plausible implementation on systemd/Linux, but its isolation must be enforced by the OS and independently tested on DGX OS. A user in the Docker group can obtain host authority through the Docker socket, so hiding sockets/secrets and stopping escape routes is central, not an optional hardening layer. A “look” is read-only only if mounts, network, devices, credentials, process visibility and child execution actually enforce that property. A command classifier or a model's assurance is insufficient.

For a Spark without the helper, adopted safety findings 7(c) and 8 specify the fallback: every host change is asked, and looks use exact program/flag forms with a clean environment. Preserve those limits and show which helper protections are unavailable. A go-ahead or always grant must not silently enable unrestricted execution there. Keeping only existing typed actions until setup would be a simpler, stricter first-release alternative, but it is a recommendation rather than the settled design.

Before enabling root/hub changes, test the already-adopted wall requirements with attempts to write via aliases/symlinks, contact network endpoints, access Docker/Tailscale/API sockets, inspect another process's credentials and escape through subprocesses. Run these only in a disposable fixture for the helper. Ordinary root cannot be made safe against deliberately hostile root code; the synthesis already discloses that limit.

A fresh connection through the **changed** way in is the right hub confirmation primitive if it is bound to the particular guard transaction and created after activation. An existing session, a different route, or Telegram acknowledgment must not count. Authentication changes need proof of the relevant credential/route, not merely an HTTP 200. The adopted activation/restart checks cover delayed-effect configuration; P-1 adds the missing command/rollback lifecycle.

### Telegram, retained keys and text that steers

Three risky approvals an hour and ten a day limit frequency, not impact. A single approved root command may be sufficient to destroy data or change access. Two digits displayed in the ask impede reflex taps; they are not an independent secret factor. This risk is already disclosed in synthesis §9. The default-off daily PIN is a defensible convenience tradeoff for this owner, not proof of resistance to an unlocked-phone attacker.

Preserve the cheap adopted protections: one-use expiring buttons, code-built target/privilege/provenance text, atomic consumption across page and Telegram, persistent caps, `/lock`, and page-controlled re-enablement. Test replay, simultaneous page/Telegram presses, expiry, restart and changes to the paired identity. The new P-5 criterion pins the content underneath that approval.

Trace outside text through log/web result → proposal → task go-ahead/always grant → dispatcher → helper. The trust label must survive tool rounds, journal/recall, continuation and restart. A go-ahead intentionally permits outside information to inform ordinary work inside its bounded authority; it must not promote that text into owner authorization for root scripts, keys, the hub or final deletes. Existing safety findings 5, 7, 9 and 17 require these checks in code. A second model or reassuring prose does not replace them. A-3 shows why a real incorrect tool call must be rejected even when the prompt says otherwise.

Retained keys still have concrete exposure points: Docker configuration/environment on disk, process arguments/environment, command output, remote destinations, exception fields and Telegram's servers. The adopted ingress extraction, named injection, destination/image pinning, output masking and message deletion are necessary. They cannot retract a key Telegram already received or a key deliberately printed in an unexpected encoding. Use synthetic keys to test persistence across chat, journal, errors, backups and restart; include A-5. Do not put actual credentials into the review package.

### Memory, learning and evaluation

I would keep the lean design: raw records, dated/sourced owner lines, retirement history, lexical selection, a digest with raw retrieval, and no extra model before an ordinary reply. Exact names are useful for repository/model/container identifiers. Alias collisions, unnamed follow-ups and paraphrases with no shared rare word remain expected weaknesses to measure.

The twenty questions are a useful initial retrieval smoke/ablation set. G already separates deterministic tests from real-brain trials and joins B's stage 2; B §2.8 already rejects **any wrong change**. Do not average unauthorized changes into a memory-quality score. Three repetitions of twenty related prompts are not sixty independent examples or evidence of a rare-failure safety rate.

Add these cases to the existing implementation acceptance set when Memory is built:

| Boundary | Case that exercises it |
| --- | --- |
| Candidate cap | Put the needed line beyond 400 candidates; 300-record correctness plus 40,000-record speed does not cover this |
| Prompt budget | Let wishes exceed the always-visible block; omitted relevant wishes remain discoverable with their source |
| Raw fallback | Hide a unique middle log line from both the failure-pattern and query-word digest; recall it after restart |
| Write intent | Quoted, negated, hypothetical and historical remember/forget phrases; A-3's question; an agent replacing an owner line |
| History | Repeated replacement, expiry, restart and rollback retain current truth, retired history and raw evidence distinctly |
| Authority | An old owner instruction or saved preference retrieved now does not supply present mutation authority |

Use held-out paraphrases and unfamiliar logs alongside the small fixed set. Report per-category errors, latency and round limits as well as aggregate accuracy. Keep paired baseline comparisons. The existing six-task long-read experiment is a sensible gate for helpers; its cold unknown-pattern log is especially important.

For lessons, “failed twice” should refer to a validated structured failure identity tied to the applicable setup/environment, as adopted safety finding 27 requires. A free-form log substring can be spoofed or reflect a transient network outage. Skipping a setup is a recommendation that needs clear evidence and a way to retry after the environment changes; it should not become an unexplained permanent ban.

### GitHub, updates and self-change

Keep the split between untrusted test jobs and the job that can publish the tested mark, and keep the installed verifier responsible for judging the new build and restoring the previous one. Those are already accepted critic changes. Test forged/moved marks, mismatched tree/artifact, a package with changed contents, a sign-in failure despite a healthy process, and an update that changes its own checker. A tag name or incoming build's self-report is not sufficient evidence.

The “new tests/generated files/status rows” free-change category is only safe if code verifies those meanings: generation must be reproducible from approved inputs, and executable test/workflow changes cannot acquire release credentials. Keep the independent review and dangerous approval for workflow changes. P-6 concerns propagation of the already-selected exact-tree invariant through PR merging.

### Fleet, the distributed brain and downtime

[NVIDIA Sync's current Cluster Assistant guide](https://docs.nvidia.com/sync/latest/cluster-assistant.html) supports direct cabling for two or three Sparks and requires a switch for four **when using NVIDIA Sync**. That supports the plan's proposed supported topology; it is not a claim that every possible four-node physical/network topology without a switch is impossible. No cabling, RDMA performance or multi-node model was tested in this review.

Keep the staged gates: prove the two-compute-Spark run on real hardware, then a two-Spark brain with recovery, then three only after the manual NVIDIA test succeeds. The synthesis discloses up to 45 minutes without Sparkie during a failed distributed-brain attempt. That is a planned recovery budget, not a measured hard upper bound: cache misses, a dead host or failure of the saved brain can exceed it unless each phase has a tested bound. The console and code-driven stop/putback/status must work without a brain throughout.

Workflows, compares and self-tests should acquire the relevant claims, identify only their own resources, and clean up by recorded identity. They must not stop a healthy unrelated model to make a test pass. Preserve the adopted critic cases, and add A-2's stale-check interleaving to every branch that starts/restarts something on a Spark. Existing live validation that deliberately left a healthy two-Spark model alone is appropriate; its unrun workflow checks must remain explicitly unverified.

### Structure, any brain and build order

One front door, one card per task and one location for each rule are appropriate for a small-context agent. The 24-tool cap is a hypothesis to compare with 41 tools on the same brain/cases/settings, not a safety boundary. Include tasks needing tools from several groups, and verify hidden tools have exactly the same dispatcher permissions. A tool selector must not accidentally remove the only route for recall, stopping or recovery.

Two brain outcomes—checked or every change requires a button—are a useful simple policy. Finite evaluations do not prove a weak model safe; the dispatcher/helper remain the authority. P-4 ensures that a checked grade belongs to the behavior currently running. Durable tasks need persistent limits, original owner intent, provenance and cancellation; no old memory, journal record or model-generated task summary should enlarge their authority.

The six milestones are useful in the proposed order. Within Commander, ship looks first and gate mutations on the complete helper, approvals, guard and durable-journal requirements. Build the recovery/restore specification before enabling unattended or self-changing work, even though its user-facing milestone remains fourth. Keep the distributed brain last. Avoid adding embeddings, helpers, a new scheduler or a separate service until the plan's measurements justify them.

## Design cleanup and defaults

These are conflicts already resolved by the governing synthesis; reconcile the underlying build text rather than reopening owner policy:

- A/B still contain 64 KB or 1 MB raw-output caps, while synthesis §5 and G require complete raw text with a digest for context. Before B1, specify streaming/chunking/backpressure so complete retention does not mean unbounded RAM. The digest and retained output are different budgets.
- E still describes copying/restoring journal segments, while synthesis §8 explicitly says the journal is never copied off Spark 2. Correct the recovery instructions: after loss of that disk, the journal is lost under the chosen default. Do not silently restore a backup policy the owner declined.
- G's page-only action table and old R32 wording need the already-selected Telegram exception; G's unchanged `memoryClear` assumption must incorporate A-3.
- The guide says the page is just chat/sign-in/status, but Models and Files remain visible and operational. State the actual current scope until D12 removal is complete.

The one default I would change is **“no trash” for workspace-file deletes**. A-6 shows a concrete concurrent-save loss path. A bounded recoverable rename/version mechanism for small workspace files is a useful default for this feature; it need not become a general root-filesystem trash service or cover an explicitly approved final delete. If the builders retain “no trash,” they need another mechanism that preserves the bytes actually removed despite permitted concurrent writers.

I would keep the remaining defaults, with their stated consequences: keys must be supplied again after hub-disk loss; the journal is lost with that disk; Telegram possession can authorize damaging commands; root authority cannot be protected against intentionally hostile root code; distributed-brain recovery can leave the owner waiting. None of these facts should be hidden by a passing test count.

## What is still missing, and what closes this round

The missing pieces are precise state transitions at boundaries: revocation during a turn, context changes during async UI work, check versus claim, sender success versus backup promotion, guard expiry versus running writers, mutation versus durable intent, and restore versus authentication history. Those need small explicit contracts and adversarial tests, not another framework.

The builders' first reply should answer A-1 through A-12 and P-1 through P-7 individually. For app fixes, retain these reproductions as evidence and add normal regression tests which fail before the fix and pass afterward. For plan changes, amend the synthesis first, then the relevant design. For P-5/P-6, an implementation demonstrating the existing promised invariant is enough; no additional approval flow is required just to satisfy this review.

An accepted finding is not closed until the implementation/design response has been checked. After two rounds, unresolved points follow the agreed three-line-per-side owner escalation. This report does not invent a builders' acceptance, a completed debate or a production verification that has not happened.

