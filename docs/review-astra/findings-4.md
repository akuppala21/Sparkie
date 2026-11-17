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

## Release limits

These scoped repairs do not establish a finished product. The complete strict hosted suite and browser release gate,
actual Spark 1 brain, power/workload paths and remaining contract work still need qualification. See
[finish-status.md](finish-status.md). The asleep test correction remains unapplied pending the explicit test-edit
exception; no partial pass is a release lock or tested tag.
