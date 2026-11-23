---
name: maintain-sparkie
version: 1.0.2
description: Diagnose and repair Sparkie in a private checkout, verify its affected callers, or prepare a compatible application update for exact owner review.
---

# Work on Sparkie

Use the native coding, terminal, files and test tools. Preparing a change is not
permission to install it. Never use an owner shell, privileged container or a
manually written approval to replace the app.

If the owner supplied a private development checkout, use that source and start
at step 2. For a review-only repair, finish that step with the diff, actual test
results and any checks still outstanding. Preparing an installable update also
requires the sealed predecessor and steps 3–7.

1. Call `spark_update_source` once to copy the installed sealed application and
   its base interpreter into the current private compute workspace. The tool
   returns the archive hash and exact predecessor manifest identity. Verify the
   archive hash, then extract its build inputs into `/opt/sparkie` **inside that
   workspace**. This path is backed by the workspace's own storage. It is not the
   host's installation. Never copy the host's home, private configuration, keys,
   conversations, operations, electricity database or model weights.
2. Use the supplied checkout or copy the exported baseline's `extension` to a
   working directory under `/workspace`. Read its instructions and affected callers.
   For a bug, reproduce the reported symptom through its normal entry point in
   that copy. Trace the observation to the failing code before editing. If you
   cannot distinguish the cause, report what you observed and the smallest check
   that could settle it. After editing, repeat the reproduction and check a
   neighboring case that should keep working. Check what each affected caller
   actually receives. Report a partial repair when any required behavior is missing.
   Use the smallest coherent fix, preserve useful assertions, and run affected
   checks with `tools/checks.py --paths ...`. Record actual results and duration.
   The selector also lists browser, native integration and local behavior checks
   that still need to run. Its Python pass alone does not qualify a release.
3. Build with the existing `deploy/candidate.py` at a **new** final path
   `/opt/sparkie/releases/<release-name>` in the same private workspace. Use the
   original pinned upstream archive from `upstream.lock.json`, checking its SHA,
   and pass the exported baseline's `tools/uv` as `--uv`. Its exact pinned build
   runs `uv sync --frozen`. Keep the exported base Python
   and unchanged native UI bundles when the edit does not affect them. Rebuild
   changed UI bundles using the pinned native build. Report a missing dependency
   rather than claiming a build. Do not relocate a virtualenv or skip verification.
4. The ordinary application-update path accepts backward-compatible presentation,
   existing skill guidance and the enrolled sandbox forum reader with the same base,
   upstream version, model, worker and privileged policy. Changes outside this
   scope need a separate reviewed administrator plan. Do not disguise an
   unsupported change as a permitted file. Verify the complete candidate using
   its packaged `candidate.py verify`, then run the applicable assembled smoke.
5. Write a JSON review containing `diff`, `checks`, `interruption`, and `rollback`.
   Include what changed, actual/reused/skipped evidence and remaining limits.
   Make the actual diff and test receipts inspectable through native artifacts;
   a sentence claiming checks passed is not evidence. Do not invent a receipt.
   Create the output directory under `/workspace`.
   Use `deploy/upgrade.py prepare --candidate <new> --baseline <exported-baseline>
   --details <review.json> --destination <workspace-output>` to create the sealed
   offer. Keep the output under `/workspace`; the tool returns its proposal hash.
6. Call `spark_offer_update` with that directory, hash and a request ID. Reuse the
   ID for redelivery; use a new ID only for a separately requested attempt after
   checking the previous outcome. It copies the offer to
   the private inbox and creates an unapproved request. It does not install.
   Give the owner that existing request, with the complete review available on
   Home or `/spark show <request>` in the paired native chat. No separate app,
   second bot or terminal login is needed for a compatible update decision.
7. After the owner confirms, the independent installer checks the same sealed
   proposal and predecessor, switches only that version and checks startup and
   protected sign-in. Use the original request to inspect a lost reply. Never
   send a replacement install to resolve uncertainty. When it says it awaits
   the owner's check, ask them to use **Keep this version** or **Restore previous
   release** on that request. Neither a model answer nor passing tests supplies
   this approval. A restored version preserves conversations and usage history.

Use already verified source and results. Do not add a reviewer loop, full-suite
run, hardware power cycle or hosted CI job to every ordinary change.
