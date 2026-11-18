# Recovery follow-up review, 2026-11-17

This continues the finding series through A-42 from the Spark 1 review. Baseline: `c1a69b4684c9aa11cc084bbdf8fbabe2555372f6`,
with the preceding stale-record defect traced to `56c72fa2`. These are concrete source findings. Repairs have separate
builder and reviewer checks; hosted results and hardware evidence are stated independently. No contract promise or
existing test assertion is weakened to close them.

## A-43: an older saved-run record can stop healthy completed work

**Severity:** blocks installing the affected recovery path. A saved workflow finishes and leaves its model or app
running. Its primary cleanup record is removed, but `.prev` still holds receipts. If a later primary becomes malformed,
the old `readKept` fallback can promote that previous record, and startup recovery stops healthy work matching it.
A missing primary alone does not cause this fallback.

**Where:** `savedRunsNow` and `savedRunsRecover` in `service/src/18-run-record.mjs`; `sendCopy` and installer state restore.

**Smallest repair:** read only the primary, validate the entire shape, preserve unreadable bytes, and report the
problem. Live record failures must not turn healthy work into cleanup. Exclude both authority files from backup and
restore, including old destination residue. Do not restore an older receipt just because it parses.

**Answer:** accepted and implemented in `c1a69b46`; independent source review agrees. Most invalid-primary service cases
passed in run `44072357306`; the new live-corruption fixture reached an image-consent gate before receipt capture,
so its fixture was corrected with every assertion retained. Both cases then passed on `7bbed38f` in run `44074814751`.
`workloads-record.test.mjs`, `copy-signins.test.mjs` and existing recovery tests provide the portable checks.
This does not close failed completion-record removal or T45 deferred recovery after an unreachable Spark returns.

## A-44: malformed recovery contents can appear in notes and logs

**Severity:** must change before dependable recovery use. `JSON.parse` can quote malformed input in its exception.
The primary reader propagated that text; startup recovery printed it directly, and live notes masked only known
secret shapes. Arbitrary private contents could therefore leave the recovery file through an error message.

**Where:** `savedRunsNow`, `savedRunWords`, `savedRunKeep`, `savedRunDone`, `savedRunReceipts`, `savedRunsRecover` in
`service/src/18-run-record.mjs`; masking in `service/src/20-mcp.mjs`.

**Smallest repair:** fixed content-free errors at the read/parse boundary. Preserve the original primary; do not
attach the original exception as a cause. Keep the existing missing-file and shape behavior.

**Answer:** accepted; current patch and `workloads-record-errors.test.mjs` independently reviewed. The regression
forces an input-echoing parser and read error, disables pattern masking, and checks actual note/log callers and
unchanged bytes. All three error cases passed on `7bbed38f` in run `44074814751`; no actual secret disclosure is claimed as observed.

## A-45: update rollback restores source without its matching proof

**Severity:** blocks relying on standalone reinstall after a failed update. The installer now retains
`~/spark-console-src.manifest` beside its source. The update guard copied/restored only the source directory. A failed
update could restore the old source and lock while retaining the new manifest, then report complete recovery.
`tools/qualify-install.py` reads that sibling proof and correctly refuses the mismatched source.

**Where:** `take_copy`, `put_back`, `back_whole` in `deploy/update-guard.sh`; source retention in
`deploy/host-on-portal.sh`; `qualify` in `tools/qualify-install.py`.

**Smallest repair:** save and restore the sibling manifest, remove the incoming manifest if none existed before,
and require source/proof agreement before discarding the recovery copy. Keep recovery armed after a failed proof copy.

**Answer:** accepted; the current repair and three additive `update-guard.test.mjs` regressions independently reviewed.
All three cases passed on `7bbed38f` in run `44074814751`. They cover prior proof, prior absence, failed copy and successful later retry using
the actual guard with a stand-in service manager. Real systemd behavior remains a separate check. The installed guard
judges the next update, so an older installed guard retains its old behavior until this fixed guard is installed.

## A-46: failed removal can leave completed-work cleanup authority

**Accepted and repaired for unlink failure.** `savedRunDone` now persists the primary without the completed entry
before trying to remove an empty file. An unlink failure leaves an empty primary; other active entries remain.
A failed retirement write never falls through to unlink and warns that restart could stop already-completed work.
That combined write failure is still unresolved. File fsync does not establish sudden-power-loss durability.

Independent source review accepted the narrow repair. `workloads-retirement.test.mjs` checks normal deletion, failed
unlink plus actual service restart, failed persistence with no unlink attempt, and another active record. On frozen
source tree `d5f45ee1a4c9135c4bf32e09fb660233b6bd97b8`, these and four nearby recovery files passed **50/50** on
Spark 2 in six minutes. Source is `99488c8e` plus the retirement repair and explicitly approved asleep correction;
it is not the full moving candidate. The pre-fix negative control failed the three affected retirement cases as expected. Final release qualification remains separate.

## A-47: ordinary downloads can target the hub or use stale disk information

**Accepted; implementation and focused compute-Spark checks passed.** The recipe page rejects an explicit hub or unknown
target before creating a download operation. The shared transfer path checks a configured compute target, known
file size and fresh free space on the cache filesystem. GGUF checks include its projector and never shrink a larger
catalog estimate. Hub inventory stays visible. The brain's separate start path is unchanged.

`download-admission.test.mjs` exercises the real stand-in service, both downloader paths and the download-first
start. Independent source review found no blocker. All eight admission cases passed on frozen tree
`a79dea6f944c6854cd25e08d5abed97ef50b8979`; six relevant cases failed against pre-fix source. This is admission, not transferred-byte accounting, a continuous
disk floor or completed T46 stall recovery; those claims remain separate.

## A-48: compensation can stop work after a newer owner adoption

**Accepted; repaired and independently reviewed, with focused compute checks passed.** Independent Astra review of the candidate captured as recovery r15
(tree `b05e2ef735bc0609f32132b7cb141ebc1e117aab`) found that `rollbackOwned` reads `record.wishes` from a
snapshot held across Docker awaits. During that wait, `startModel` can answer an owner that the model already runs
and durably record `desiredWish`. `rollbackReturn` can then stop the exact container using its older snapshot.
`rollbackStopCancelled` similarly holds a member's older `stopReturn` intent across its container look.

The repair must check current owner intent at compensation stop/remove dispatch, after `rollbackAttempt` yields.
It must protect positive adoption of a failed attempt's new container and a newer original-member adoption while
preserving legitimate preflight stops. Regression injection is required during enumeration and immediately before
dispatch. A passing commit handoff test alone does not establish this compensation boundary.


The implementation now checks fresh intent at every compensation stop/remove dispatch. Adoption refuses pending
cleanup and known-stopped stale observations; a returning start is never called “already starting”. Explicit job
reruns check unanswered commands before Docker, under their existing claim; only a successful exact rerun can
supersede terminal cleanup history. Independent review accepted frozen r18 tree
`073dae15cc366f7cdb7b2834d56bb8f3931946c5`. Its direct/static batch passed **321/321**, including the new
coordinator races and rerun callbacks. Six targeted unchanged integration cases passed on Spark 2, including the
repaired job folder, delayed stop and restoration, owner intent during loading, and a job rerun surviving later
workflow failure. Final complete qualification remains required.

## A-49: a sensitive Telegram proposal can lose its page confirmation marker

**Accepted; scoped compute checks passed.** Removing the old channel-only gate exposed generic proposals for
workflow saves and update rollback without the `ownerOnly` marker. The r6 Telegram integration tests received
HTTP 200 from a bare page press where the retained passkey assertion required 428.

`propose` now retains the marker for Telegram-originated workflow save/forget, update rollback and code-change
proposals. The verified Telegram owner can still confirm; the page uses its existing passkey gate. Page-origin
behavior and ordinary memory choices are unchanged. Independent source review found no bypass. Both original
428 assertions and all 32 Telegram integration cases passed at policy r7 tree
`214a6fad15ab557bbda9b1db1454c470e5601412`; three direct proposal/proof cases passed too. That five-file run
was 89/91 overall: unrelated danger/long-ask checks remain open, so it is not release qualification.


## A-50: ordinary Telegram approvals can omit the complete confirmation facts

**Accepted; repair, independent source review and focused compute checks passed.** On immutable policy r7 tree
`214a6fad15ab557bbda9b1db1454c470e5601412`, a valid ordinary app proposal produced a 4,293-character
code-built question and a 4,292-character choice label. Telegram delivered 330 characters plus an active
60-character button; neither complete question nor label was present. The app had not started.

`chatAsks` captures only `needs-ok` and clips questions; `tellReplyText` relies on the model's reply and short button
labels. A choice's full question can differ from its label, and a follow-up may have no saved chat ask. The repair
must deliver the complete code-built question and choices through the existing multipart sender, with secret
masking, before activating approval. Partial delivery must leave no usable button. Owner-only and dangerous asks
retain their separate delivery paths. No new service or persistent store is needed.

Diagnostic evidence: `/tmp/sparkie-plainfacts-r7-observed.json`. Policy r8 tree
`24f0a841578365b72f5c5d665aca8bea2df0c1a1` passed **115/115** checks on Spark 3, including all 24
transport checks and five policy files. All five added full-facts regressions fail against the old r7 source;
the original 19 transport checks still pass there. Independent review pinned the accepted source to r8.
Final combined-tree and release qualification remain separate gates.

## A-51: a stopped historical pair can pull the hub into a new start

**Accepted; repaired, independently reviewed and focused checks passed.** The complete candidate run exposed a
new pair start that expanded an already-stopped historical pair into the old hub. Recovery now treats a historical
pair as stopped only when every recorded member is known stopped, and rechecks the selected copy before use.
A live or unknown peer retains the whole-pair refusal. No hub command is added. Added direct regressions and the
unchanged pair start, page, energy and wake integration checks passed on the r20/r21 snapshots below.

## A-52: a wall-clock jump can end command observation before its receipt arrives

**Accepted; repaired, independently reviewed and focused checks passed.** The unchanged between-rank context
expiry test moved wall time, causing the Docker observer to report a timeout before its already-running command
returned. Command observation and reconciliation now use monotonic elapsed time. Owner decision expiry still
uses wall time. Forward/backward clock regressions and the original between-rank expiry case pass.

## A-53: recovery lost the structured list of originals that could not return

**Accepted; repaired, independently reviewed and focused checks passed.** The failure still reported cleanup debt,
but omitted `job.notBack`. Recovery now derives that list from the existing exact terminal stop/refusal proof and
clears it after restoration or when proof is uncertain. The original context-recovery assertion and new negative
proof checks pass; unresolved debt still blocks another start.

## A-54: a setup clause's duplicate classification can block an explicit model start

**Accepted; repaired, independently reviewed and focused checks passed.** A request to start a named model and
then set up a folder was unnecessarily turned into a button because `set up` has both start and work tags.
The same clause's duplicate tag now adds no second restriction or authority. A completed then-join between distinct
requests is outside the first clause's context value. Different model/target choices, stop/restart clauses,
alternatives and unfinished joins retain their checks. Added boundary cases and the unchanged carry-on eval test pass.

Frozen r20 tree `817bed2c0868be18fbeedb447d41cb4b85e1bf35` passed **249/249** direct/static checks and
**8/8** context/page integration checks. Its production bytes also appear in r21 tree
`99755fe0f5cc5eefb83a9b4214b6f3f5f3e74ed1`, whose **64/64** deployment, lifecycle, energy and pair-wake
checks passed. The r21 fixtures return simulated memory before restoration and wait for actual recovery before
the next scenario, preserving every original behavioral assertion. The earlier full run is failed evidence, not
qualification. The complete suite on the repaired candidate and the hosted release gate remain required.

## Release limits

These scoped repairs do not establish a finished product. The complete strict hosted suite and browser release gate,
actual Spark 1 brain, power/workload paths and remaining contract work still need qualification. See
[finish-status.md](finish-status.md). The owner explicitly approved the reviewed asleep test correction on
2026-11-17; it is applied and its compute-Spark checks passed. No partial pass is a release lock or tested tag.

## A-55: a prelaunch refusal can leave false uncertainty and block later work

**Accepted; repaired, independently reviewed and focused checks passed.** A Hugging Face cache check can refuse
before Docker is called. The target previously classified that completed shell failure as an uncertain Docker run,
so validation retained a recovery obligation and seven later checks cascaded. The two trusted model builders now
require a launch marker immediately before Docker. Only their completed nonzero subprocess with no marker proves
that Docker was not called. Live preflight, failed clients after the marker, and other command builders retain their
uncertainty. Failure details retain bounded model/file names, never the outside target path or raw stderr.
Four new target checks exercise the boundary; the original validation assertions are unchanged.

## A-56: startup recovery can hide a self-test's stop and delay its first desired list

**Accepted; repaired, independently reviewed and focused checks passed.** Fenced startup recovery can stop the
self-test's model before its reporting pass. The eventual message then omits that stop. The existing self-test note
now retains an exact successful stop receipt for the same container incarnation. A failed note write remains
retryable from that receipt; an unrelated unreadable note cannot block restoration. Initial desired-list seeding
also permits an active self-test that displaced no running work, while excluding its test model. Any other pending
recovery still holds seeding. Original self-test/cleanup assertions remain, with added identity and debt controls.

## A-57: new owner and retry gates were absent from protected code paths

**Accepted; repaired, independently reviewed and focused checks passed.** The unchanged protected-path assertion
identified `17-context-retry.mjs` and `21-owner-admin.mjs` as missing from `SELF_PROTECTED_PARTS`. Both now have the
same protected treatment as the existing gates. No protected path was removed and no security assertion changed.

## A-58: recovery lines can hide the earlier retry decisions in an operation result

**Accepted; repaired, independently reviewed and focused checks passed.** A three-attempt start correctly restored
the original work, but extra cleanup lines pushed one retry decision outside `wait_operation`'s twelve-line tail.
A settled result now includes at most the last two missing retry decisions beside that tail, in order and without
duplication. The result remains masked and labelled as data. Running results retain twelve lines; settled results
are bounded at fourteen. The full original workflows and masking files pass, alongside three new history checks.

## A-59: owner-control help pushed the core prompt over its size limit

**Accepted; repaired, independently reviewed and focused checks passed.** The full run measured 2,573 characters
against the existing 2,500-character limit. Four instructions are shorter while retaining memory corrections,
workflow-only changes, model/app distinction, confirmations, truthful tool results and outside-text boundaries.
The original size assertion passes. Account and hub restrictions retain their exact wording.

The completed original run at tree `99061774e6e677854483939d7efff6edcfd9afaf` reported **3,336/3,381** passed,
45 failed, no skipped or cancelled tests. Its failures are preserved; it qualified no release. The later r2 full
run was deliberately interrupted with exit 137 once additional source repairs were known, and also qualifies none.

Root snapshot r22 tree `17edc7d670c759bb08467cfaa8b09b918f76e64a` passed **233/233** across eight files,
including prompt size, streaming decoders, held-agent refusal, pause/resume, and the unchanged safety text.
The decoder fixtures now import the actual exported reader; all byte-cut assertions remain. Two exact old Telegram
messages were updated under the owner's policy exception; `/resume` alone still cannot unpause work. The desktop
and phone fixture browser checks passed on Spark 3 with this snapshot; this is not a live installed-page result.

CI snapshot r23 tree `dc3b97b9a26170f4b93934328b7d139e2d3099f2` passed **56/56** across operation history,
runner receipts, self-change, workflows and masking, with no skips or cancellations. Its receipt fixture now gives
the actual runner a real minimal Git repository instead of expecting Git metadata in the compute export. All prior
receipt assertions remain. These focused results do not replace complete combined-tree and hosted qualification.

Combined r24 tree `86b0178fdf0fb04b23ee8ce3343d097ad786ee01` passed **231/231** across all thirteen T45
files plus validation, self-test and self-test cleanup, with no skipped or cancelled tests. The formerly failing
validation and both self-test cases now pass unchanged. Its generated-document and affected-test-selection batch
also passed **123/123**. All 45 original failures now have scoped passing evidence; complete release qualification
still must run on the final combined committed tree.

## A-60: delayed self-test cleanup can stop newer owner work

**Accepted; repaired and independently reviewed; final qualification pending.** After a self-test is interrupted,
fenced recovery can stop its model and release its claim. A genuine owner `restart_model` then starts that same
Docker container with a new `StartedAt` and records it as wanted. Delayed `selfTestRecover` compares only the
container ID, so it stops the owner's newer run. The existing stop action has a conditional incarnation guard,
but this caller supplies no condition. An already-running adoption also needs durable ownership evidence because
the self-test's model is deliberately absent from the desired list.

The isolated Spark 2 reproduction used tree `eec2c99cd95325c6c2ddc399d400b9d72498c175`, dispatch
`898231789aa348288c4815f21a316203`. Before cleanup it recorded a completed owner restart, the same container ID,
a changed start time, a desired entry and a running model. After cleanup the model was stopped; the preservation
assertion failed. A second actual owner-adoption reproduction on tree
`10bb8dd48391954867baf2bff21b072d69c34a90`, dispatch `e315941230454980ac17e2a0a363ad4e`,
showed startup rollback preserving the adopted running model, then delayed self-test cleanup stopping it. Both are
failing evidence, not a release qualification. The r3 full run is recorded under A-61. The repair must retire proved-stop authority, preserve newer owner wishes, recheck under the
existing claim, and report a deliberately preserved model as left running. No new service or state store is needed.

## A-61: an absent self-test stop receipt breaks result delivery

**Accepted; repaired; original result-delivery checks now pass.** With no model or rollback-stop receipt in the self-test
note, two optional-field equality checks both compare `undefined` to `undefined`. The code then dereferences
`recovered.container` and throws before posting the result. A matching receipt must actually exist. The original
minimal result-delivery fixture remains; adding imaginary stop evidence would hide the defect.

The r3 full run on commit `cc5ac519843164d26745bb0384955a7c3b5ed2e6`, tree
`63f2e083fd9cba530e003ca8425c687117930751`, completed **3,430/3,433** tests with three failures, zero skips
or cancellations, in 42 minutes 7 seconds. All three are the self-test result delivery/retry/disconnect/re-pair
scenarios in `tasks-telegram.test.mjs`, with the same missing-receipt error. No passing lock or coverage map was
written, and nothing landed. A-60 was found separately by additional integration reproductions.

## A-62: self-test app cleanup can stop an app the owner adopted

**Accepted; repaired and independently reviewed; final qualification pending.** The self-test can be interrupted while its web app
is running but still waiting to answer HTTP, before the app ID has reached its note. After restart, a genuine owner
`keep_running` adopts that app and its desired entry. Delayed self-test recovery still stops it by name. A name
alone must not authorize cleanup, and the existing conditional-receipt and owner-wish checks must cover the test's
apps and jobs as well as its model. No additional service or state store is needed.

The isolated Spark 3 reproduction used tree `72c333caa249d7403dd04b8578b670d3756d13e2`, dispatch
`165e89d2ec7b4ed9b03de3a47178ffab`. It recorded the missing pre-crash app ID, the accepted normal owner adoption,
the same live container ID, a desired entry and a running app. Delayed recovery then stopped it; the preservation
assertion failed. This additional failing integration evidence is separate from r3's three result-report failures.

## A-63: an adopted self-test model can be missing from the wanted list

**Accepted; repaired and independently reviewed; final qualification pending.** Preserving the adopted container is not
the full handoff. `desiredWish` only updates rows already present; `desiredAfter` skips self-test operations;
`seedDesired` does not reseed an existing file. If that file has no row for the test model, cleanup can preserve
the owner's model and clear the last note of that choice while leaving it untracked. A crash before the original
start completes must also preserve and transfer the owner's intent.

The repair must retain the exact selected model name and owner wish in the existing note until the existing desired
writer has saved the missing row. It must preserve unrelated entries and refuse or defer on a failed save. A
synthetic completed operation or guessed model name is not evidence. The adoption regression gains a wanted-row
assertion; these changes introduce no new service or state store.

The isolated pre-fix control used tree `63fc83c15a262458940f1f45b8434a8bb78555ff`, dispatch
`31195ab1176f4d29bc32da4edf7964ef`, with every service file byte-identical to r5. It began with an existing empty
desired list at revision 7. The normal owner restart call returned 200/`already`, then the wanted-row assertion
failed before any crash or new helper was involved.

The A-60/A-62 reproductions use the full service and its normal action routes with a stand-in Docker fleet, inside
isolated containers on compute Sparks. They do not establish real-hardware workload or power behavior.


## A-60–A-63 repair evidence at candidate freeze

The final r9 source uses the existing self-test note and desired writer, with no new service or state store.
Cleanup requires the exact Docker ID/start time and current ownership under the existing claim; a prior proved stop
retires cleanup authority. The primary-only note preserves the owner's adoption, exact selected model name and
unfinished desired-list handoff across a crash. A newer owner stop or forget revokes that handoff. Native app stops
also settle it, preventing a failed adoption save from blocking future self-tests. Pending handoffs are rechecked
after the final awaited look and before retiring the matching note. Missing receipts no longer break result delivery.

Independent source and test-preservation reviews accepted all 24 frozen r9 file hashes. The four original fixture
files retain all 32/88/72/58 assertion-bearing lines; their only changes wire actual dependencies. The two new
ownership files contain normal API/crash reproductions and direct boundary checks. No original behavioral assertion
was weakened. A second pre-fix A-63 crash control, tree `804597f9689cebb6d8069d7d66459e2c7aebb8d8`, preserved a
running model and cleared its note while leaving the desired row absent, independently confirming that handoff gap.

Frozen r8 tree `8e1c164a022d0710c8e24fb6a2ec896217c7b09b` passed **156/156** checks across nine files on Spark 2,
with no skipped or cancelled tests. This includes all three original A-61 failures, both model ownership reproductions,
the app-adoption reproduction, actual early adoption before Docker identity, and the final-await handoff regression.

The native app-stop correction passed **76/76** focused checks on compute tree `584a509376d1bb7028d5d72c9360e7c287d92cf6`, with no skipped or cancelled tests. Production and shipped test bytes matched the independently accepted r9 source; only a temporary direct-probe wrapper was additional.

The affected-test picker explicitly includes the new direct-source ownership fixtures for all six parts they read.
Its additive selection regression, build and document checks passed **124/124** on compute tree
`984793353723f36c3c8f090ecf2e8556912083e9`, with no skips or cancellations. Measured integration coverage and the
short mandatory checks remain selected. These focused results precede the complete candidate run and final hosted
qualification; they do not authorize an install by themselves or establish live hardware behavior.


## A-64: restoring an old state copy can revive self-test cleanup authority

**Accepted; repaired and independently reviewed; focused checks pass.** A daily copy can capture a running self-test
app before owner adoption. Restoring that copy overwrites the later wish and desired date while the same Docker
incarnation remains running. Startup cleanup then accepts that restored authority. The supported archive commands
and generated `restore.sh --with-state` both allowed it. The access-review hold does not block the self-test's owner
page context. Ordinary program-only rollback does not restore state and is not this failure.

The repair follows the existing saved-run policy: daily copies omit `self-test.json` and its `.prev`; explicit state
restore skips both and removes destination residue. `sharing.md`, `REBUILD.txt` and the shipped `RECOVERY.txt` cover
older archives and snapshots. Ordinary restart and rollback without state keep the current note. No new service,
state store or recovery mechanism was added. The generated registry now reports the actual backup exclusion.

The final new tests are byte-identical in both controls. Old source `b977cf30`, on compute tree
`5b9beaf26a64b6e172c3def987268d3099981df3`, produced seven expected failures and one passing ordinary-rollback
control. The repaired tree `c73e706c6d2043c8d2eba9c2c8c7f795270a5268` passed **27/27**, with no skips or
cancellations. The tests execute actual tar and generated restore commands, including old copies and destination
residue. A preceding 75/76 batch passed every original copy and installer assertion; its sole new-test failure was
an incorrectly preserved newline in a Markdown command described as one line. That fixture was corrected, then
both final controls were rerun; the earlier failure is preserved and is not counted as a complete passing batch.

Independent review verified all 17 repair hashes, identical final control tests, unchanged ordinary recovery, and
the actual failure/pass logs. Every one of the 441 existing test and fixture files remains unchanged.

## A-65: the stop workflow's version omits the self-test producer

**Accepted; repaired; the original workflow-version check now passes.** The complete r4 run on `b977cf30`, tree
`891bd98f46a79930d30221e7c17f8c8e0d4fcba8`, completed **3,470/3,471**, with one failure, zero skips or
cancellations, in 35 minutes 9 seconds. The failure was the existing dependency check in `workflows.test.mjs`:
`startedStill reads selfTest, which isn't on stop_model's list`. No lock or coverage map was produced; nothing landed.

That check conservatively counts the `seen.selfTest` field name as the globally named producer. Adding `selfTest`
to the literal `stop_model` dependency list preserves the existing check and fingerprints that producer as well.
This adds no runtime call and changes no stop guard. Independent review accepted the one-entry change.

Combined A-64/A-65 source on tree `4cdcb92a1dd56294af8e284e1162539600e8de3f` passed **125/125** original
workflow, build and document checks on Spark 3, with no skips or cancellations. All 18 combined file hashes and the
generated service/documents were independently checked. Complete qualification of the new committed candidate,
final GitHub checks, installation and real-Spark behavior remain required.


## A-66: long fixture-link metadata prevents a source box from opening

**Accepted; repaired and independently reviewed; focused checks pass.** GitHub's longer checkout path
made a copied fixture link target 119 bytes. Git correctly emits a local PAX `linkpath` header without
a separate `path` when the following name fits ustar. `tarRead` checked the skip list before reading
that name, and its key list also rejected `linkpath`. The first self-change start failed and 15 later
assertions consequently failed. The complete Spark run of the preceding candidate had passed 3,479/3,479;
that shorter-path result did not establish this archive shape. Hosted run 44244832191 was cancelled
after the owner reported the free Actions allowance was exhausted.

The reader now resolves the following entry's name before allowing an exact prelisted type-2 link
to be omitted, and removes its entire extended header with it. Readback still accepts no links.
Unknown keys, chained headers and unfinished metadata are refused. The change adds no service or
state. All 442 pre-existing test/fixture files remain unchanged. R62's existing limitations are retained.

Identical added tests on old source produced four expected failures and three passes on Spark 3.
Fixed tree `eff34e354d31bfbcc491e858c499cbdb9c8482db` passed **171/171** across seven files, with no
skips or cancellations (dispatch `b837e22fc0d3493ba5b9db5e4097b063`). The actual Git archive fixture
checks extracted files and absence of both omitted symlinks and their metadata. Independent review
accepted commit `5e5a6a62`. Complete qualification of the integrated candidate and live checks remain.


## A-67: recovery fixtures advance before their prerequisite finishes

**Accepted; independently reviewed; owner approved both fixture corrections on 2026-11-18.**
The exact candidate `06114f61`, tree `e2453867e570d94f9081415d6a636f6e64e2009c`, ran
3,489 strict tests on Spark 3 at concurrency 32: 3,485 passed, four failed, with no skipped or cancelled
tests. It produced no qualification lock and did not land. Both affected test files were byte-identical
to the preceding passing candidate.

Three later asleep cases requested power-off while the earlier crash-restart operation still held its
claim. The service correctly refused all three with HTTP 409. The earlier case now requires the
healing event's operation ID, waits for that exact operation and asserts that it completed. The unchanged
file separately passed 7/7 on the same candidate at concurrency 1; that diagnostic did not qualify the
failed full run.

The Docker-unresponsive put-back fixture made Docker fail after a container appeared, before its
launch receipt had necessarily arrived. The service correctly reported an unconfirmed launch and
withheld the earlier GPU job. The fixture now waits for the operation to reach its test prompt before
injecting Docker failure, matching its existing scenario and expected error. The separate hanging-launch
case still covers the other path.

These are ten added lines across the two fixtures. Every original assertion remains; the waits add
completion/phase assertions without increasing a timeout or changing production code. Independent
review confirmed the launch receipt precedes the prompt step and the healing event carries the restart
operation ID. Focused checks and complete qualification of the corrected tree remain required.
