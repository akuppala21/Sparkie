# Sparkie: remaining completion checks

Source audit: 2026-11-17; starting commit `512fb26a`, plus the install-qualification work being integrated.
This is a completion checklist, not a tested or deployed release certificate. Hosted CI and real-Spark checks are
pending. Stamp the final commit/tree and link the actual results before changing any pending item to complete.

## Decisions carried forward

- Spark 1 permanently hosts the service and brain and stays on. Sparks 2/3/4 provide compute and sleep/wake when
  safe. Status reads wake nothing; owner work takes priority over tests. No inferred cable topology.
- During development, run the affected behavioral tests and meaningful checks of their dependent boundaries.
  A selected-file pass does not qualify a release. Before install, require the complete passing suite and browser
  checks for the exact frozen source being installed, plus the applicable brain/hardware checks.
- Use standard GitHub-hosted CPU runners for portable tests after the implementation is ready. No larger paid
  runner or permanently-on compute Spark is required. A free runner type does not by itself establish an account's
  private-repository allowance; do not select paid capacity to make a slow suite green.
- Keep one service, the current action/claim/job paths and one primary brain. Add no model panel, permanent scheduler
  or extra inference on ordinary requests. Verify work with tools; distinguish failed, cancelled and unknown from
  completed. Known recovery stays bounded and preserves the owner's explicit choices, access and data.

## Contract and design reconciliation

The contract now has an explicit hub clarification; its older wording and acceptance bars remain intact.
The next-phase master is `docs/design-2026-11-13/README.md`. Its "Nothing here is built yet", "about 12 minutes",
Spark-2 hub, Spark-1 arrival and distributed-brain examples describe an older planning snapshot. The individual
A–G designs and ledger have similar old defaults. They establish design intent, not present implementation status.
Do not globally replace Spark numbers: physical links, explicitly named compute destinations and historical
measurements need their own evidence. Use this checklist with current rule Today notes until that narrative refresh.

Further contract edits need explicit owner review; this work does not silently settle:

| Location | Reconciliation still needed |
|---|---|
| Introduction versus section 7 | The introduction promises separate checker agents on every request; section 7 specifies cheap code, result checks and independent review of self-code changes. Preserve the latter operating direction without adding per-request models. |
| 3.5, 7.10 | Separate first acknowledgement, first model token, first tool dispatch and verified finish when measuring latency. Do not lower the existing timing bars or claim an acknowledgement meets the model-output bar. |
| 7.11 versus power/health rules | Distinguish required bounded observation from expensive background inference; the literal no-timer wording conflicts with existing required recovery and idle checks. |
| 6.3 and 15 versus R18 | Contract validation says explicit opt-in and auto-restart paused until validated; current rules permit ordinary owner/healing runs as validation. Record the chosen behavior rather than quietly weakening either promise. |
| 3.12, 9.1, T117/T140/T142 | Reconcile compute membership and future distributed-brain examples against actual links. No fast hub link or multi-Spark brain qualification is established here. |
| 6.16, 6.23 and design C | Preserve exact-release qualification while using focused development checks and portable hosted CI. Old private-plan cost estimates and duration predictions are not current measurements. |
| 8.11–8.14/T127 and 16 | Keep the existing open decisions about `/keep`, confirming visits, network-piped code and root boundaries visible. This audit grants no extra permissions. |

## Release and everyday-use evidence still required

The current implementation contains the reviewed repairs below. Source changes and added regressions alone do not
close the findings under `docs/review-astra/README.md`; the reviewer must agree or the owner decide.

- [ ] Freeze the final source; regenerate/check generated outputs; run the full strict hosted suite and browser
  job. Keep the exact tree/commit/run manifest and terminal results. Test that UI-only, worker-only and dirty-tree
  changes invalidate an old install lock. Review the installer freeze/manifest follow-up before using its gate.
- [ ] Validate the actual Spark 1 brain: immutable image identity on its Docker store, cached/offline start, first
  startup intent, intentional Stop preserved, and bounded recovery. Healthy inference alone does not prove the
  configured immutable image is the one running.
- [ ] On available compute, validate start, stop and restart with the shared HF blob layout; confirm restoration
  failure/timeout stays failed with unresolved work recorded. Validate an across-Spark start separately on verified
  links; a single-Spark validation cannot qualify it.
- [ ] Run the complete qualifying brain eval on the actual Spark 1 setup and exact prompt/tool/case-set mark.
  Retain full masked replies and operation outcomes. Include the handoff's planted-log, keep-app, three-group,
  fit-lookup and ordinary-command cases, plus mixed-command target binding. Keep the existing pass bars. A pass on
  the current 33-case regression set is not all section-11 tests plus the broader real-chat qualification.
- [ ] Prove wake → Docker ready → requested work → verified result → safe idle sleep on compute, with Spark 1
  excluded. Include park-write failure, wake overlap, boot cancellation, a restart during loading, owner adoption,
  missing receipts and a requested start followed by an unrelated parked restore. The requested start must remain
  the saved run's cleanup target. Hosted stand-ins do not prove Matter plugs, physical boot or GB10 behavior.
- [ ] Check the page through the owner's normal URL at desktop/phone widths: operation reconnect, chat reconnect
  without resend, delayed approvals, correct hub identity, compute capacity and model counts. A passing source
  assertion does not establish browser recovery.
- [ ] Demonstrate one useful app/job/code task through normal chat, including an inspectable output and truthful
  result. Qualify a self-code proposal separately through independent review and the owner's exact-tree install
  approval; code must not certify its own task completion from an accepted operation id.

## Original handoff: bounded follow-ups

Read against `/Users/akuppala/Documents/26aiRAG/astra-leftovers.md` (2026-11-16). Historical scores, installed-build
claims and live endpoint state in that handoff were not reverified by this audit.

| Handoff item | Current disposition / next evidence |
|---|---|
| A; B1/B2/B6/B8 | Brain startup/image/cache/intent repairs are in the source; actual workflow validation and the qualifying eval remain required above. The old "I've stopped" fragment remains insufficient evidence of a specific false claim. |
| B3, long Mac ControlPaths | Both `deploy/copy-hub-state.sh` and `deploy/plugs.sh` now use short `/tmp/sc-ssh.XXXXXX` directories. Their long-temp-path regression still needs a passing hosted result. No Mac fleet was run here. |
| B4, migration weights | The move card now uses dereferencing copy and mentions link checks. Prove all snapshot links and shards are readable as the runtime user, and reconcile `deploy/REBUILD.txt`; copied link names alone are insufficient. |
| B5, first validation request | The installer's final `test-changes` request is still one shot in the audited source. Add bounded retry for transient connection/certificate readiness, preserving actual workflow failure. |
| B7, plug names | The move card still exposes Matter node ids. The Spark-only naming/selection request needs its script/card change and regression; internal controller ids can remain internal. |
| C, T42/T45 | Keep explicit proof pending: owner-specified context is never shortened without asking; losing one Spark during an across start restores the reachable side promptly and preserves recovery for the other. Do not mark covered from a loosely similar test name. |
| C, `/keep`, budgets | `/keep` is explicitly unbuilt in R71. The handoff's 200 GB download/100 GB hub-floor promises still need a tested implementation or owner-approved disposition. Existing generic disk floors are not proof of those numbers. |
| C, delivery/update retries | The handoff lists five result lines sent once and update retry only after restart. Reproduce before choosing the smallest retry repair; do not promise durable delivery or automatic retry from an in-memory record. |
| C, root units/helper trust | Report the actual supported boundary. Do not expand the helper or bypass managed access restrictions to finish a demonstration. |
| C, old address and cleanup | Verify and repoint external agents before retiring the old Spark 2 endpoint after Spark 1 is proven. Old worktrees, proof folders and possible containers need an inventory and the owner's cleanup scope; delete nothing from this checklist. |

Portable CI already has push/PR/manual suite execution, a separate browser job and a tested-mark writer that runs
no repository code. Nightly scheduling and multi-host/shard aggregation are follow-ups, not prerequisites for
declaring a particular full exact-tree run valid. Add them only when requested and measured need justifies them.
