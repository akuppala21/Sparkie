---
name: maintain-sparkie
version: 1.0.7
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
   returns the archive hash, predecessor manifest identity and absolute `baseline`
   path. Verify the archive hash, then extract its build inputs into
   `/opt/sparkie` **inside that workspace**. This path is backed by the workspace's own storage. It is not the
   host's installation. Never copy the host's home, private configuration, keys,
   conversations, operations, electricity database or model weights.
2. Use the supplied checkout or copy the exported baseline's `extension` to a
   working directory under `/workspace`. Read its instructions and affected callers.
   For a bug, reproduce the reported symptom through its normal entry point in
   that copy. Trace the symptom to its producer and inspect how callers use the
   result. Use their contract to identify other inputs or entry points that
   should behave alike and a nearby case that should still behave differently.
   After the smallest coherent fix, replay the original failure and exercise
   those cases through the affected callers. Preserve existing assertions and
   add a focused regression for behavior they missed. If the cause or scope
   remains uncertain, say which observation could settle it.
   From the extension checkout, use the exported release path as `baseline`
   and pass the changed paths. This runs affected pytest and any selected
   Sparks panel desktop/phone check. In the private worker, keep its evidence
   under /workspace alongside the checkout.

   ```sh
   TMPDIR=/workspace bash tools/dev-python.sh "$baseline" tools/checks.py --paths path/to/changed.py --run-affected "$baseline"
   ```

   Read the final JSON for pytest's actual counts, the browser outcome and log
   or report path, and any remaining check groups. If a dependency is missing,
   report the blocked check and its diagnostic alongside the completed checks.

   For a review-only repair, inspect the final diff and send the owner the result
   as soon as the reproduction and affected checks have outcomes. Include the
   observed before/after behavior, affected callers, files changed, tests that
   ran and any gap. Link the patch or give its path in the checkout.
   If a check cannot collect, verify its path and the missing dependency once.
   Run any independent checks that still work. Name the blocked check and what
   it needs in the same reply. A partial result is useful. Stop there for a review.
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
