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
