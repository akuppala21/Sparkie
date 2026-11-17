# Sparkie: remaining completion checks

Source audit: 2026-11-17. Completed hosted evidence below is through `7bbed38ff40cd39c4545dd85706b410783520a9d`;
its 23 selected test files passed. The newer complete compute run exposed the additional issues below; the repaired candidate has not been released.
This is a completion checklist, not a tested or deployed release certificate. Independent source review found no
new blocker in the latest scoped repairs. A complete final hosted pass and real-Spark checks are still required.

Latest repair evidence: the first full candidate run at `b1964091` exposed old Telegram expectations, fixture
assumptions and four product defects (A-51–A-54). Focused repaired checks passed **39/39** policy tests,
**249/249** direct/static tests, **8/8** context/page tests and **64/64** deployment/recovery/energy/pair-wake
tests. Snapshots and scope are in [findings-4.md](findings-4.md). Original access, wrong-change, memory-reserve
and recovery assertions remain. A complete passing repaired run, final hosted qualification and installation are
still pending. No partial batch marks the release tested.

Hosted evidence is tied to its snapshot:

- `5e8208ae`, run `44054697514`: 221/222 passed. The remaining asleep test expects a new start after wake already
  restored that model. A reviewed stronger correction preserves all crash/healing checks and adds restoration and
  no-duplicate-operation checks. The owner explicitly approved that narrow exception on 2026-11-17. It is applied and passed its compute-Spark checks below.
- `bfd4fcab`, run `44057661976`: 260/267 passed. All seven failures were in brain-eval, including cascades after the
  stand-in hub mark mismatch. Telegram/application jobs passed. The latest commit repairs fixture identity,
  broken-result refusal ordering and bounded terminal evidence capture without changing existing assertions or grades.
- `e5aabcdc`, [run `44059936292`](https://github.com/akuppala21/Sparkie/actions/runs/44059936292): **278/278 passed**
  across three runners (70, 147 and 61), including the context safeguard, timer rollback, evaluation, workflows and
  installer checks. At that snapshot the owner-question part of T42 was unbuilt. No final full-suite lock or tested tag has been
  produced for this candidate.

- `56c72fa2`, [run `44068592367`](https://github.com/akuppala21/Sparkie/actions/runs/44068592367): **1,111/1,116 passed**
  across three runners (311/312, 670/670 and 130/134). Desktop and phone browser checks passed. The five failures
  were two context-start cases, two linked workflow-restart cases, and an installer archive-order assertion.
  Follow-up source fixes bind model identity to its current clause and distinguish proven internal rollback copies
  from real model alternatives. The new fingerprint test now supplies enough fixture memory to reach its intended
  gate. Archive ordering again satisfies the unchanged recovery test. All fixes still need the next hosted result;
  the stale-aside explanation for the restart failures is source-supported, not proven by the old log.

- `c1a69b46`, [run `44072357306`](https://github.com/akuppala21/Sparkie/actions/runs/44072357306): **964 passed, 4 failed, 1 skipped**
  across three runners (203/203, 646/648 with one skip, 115/118). All five prior failures passed, including the two
  workflow restarts. New failures: a trailing period in a recovery-guide path, a live-record fixture that reached
  image consent before receipt capture and its dependent cleanup case, and a receipt-order source fixture missing
  the new context-publisher dependency. The next candidate corrects the guide and fixtures without removing any
  assertion. GitHub now installs zsh for the previously skipped backup-command portability case.

- `7bbed38f`, [run `44074814751`](https://github.com/akuppala21/Sparkie/actions/runs/44074814751): **968/968 passed**,
  no skipped tests, across three runners (126, 275 and 567), covering 23 selected files. All four previous failures
  passed, as did the now-enabled zsh recovery case, fixed error-text regressions, source/manifest rollback cases and
  all five new context-boundary cases. The longest test command took about 640 seconds. The optional browser job
  was deliberately not selected; desktop and phone evidence remains tied to `56c72fa2`, whose UI is unchanged here.
  This is a focused pass, not the complete release suite, a new release lock or an installed build.

## Compute checks, 2026-11-17

After the owner released Sparks 2–4, isolated containers on Sparks 2 and 3 ran five files each. Both returned
matching run/tree/exit receipts on frozen tree `d5f45ee1a4c9135c4bf32e09fb660233b6bd97b8`: **50/50** recovery checks
in six minutes and **182/182** power, healing, asleep, build and document checks in 10 minutes 26 seconds. No skips.
This includes the explicitly approved sleep/wake correction and narrow completed-record retirement fix. The new
regressions failed against pre-fix source as expected: six download-admission cases and three retirement cases.
Download admission then passed all eight cases on corrected frozen tree `a79dea6f944c6854cd25e08d5abed97ef50b8979`.
That tree also passed 147/147 checks on Spark 3, including the actual download supervisor, both T42 preparation
boundaries (wake-first context and expiry during a real copy), affected-test selection and generated documents. These are development checks; final GitHub qualification and real-Spark behavior remain required.

## Telegram owner parity and recovery follow-up, 2026-11-17

The owner's explicit policy makes Telegram a primary owner interface. The candidate uses the existing action runner,
confirmation store and page operations; it adds no service, listener, scheduler or second administration backend.
The design, unchanged safeguards and obsolete policy-test inventory are in `docs/telegram-owner-parity.md`.

Frozen Telegram r2 commit `8c1252e91d7e055aaa88ce976110e372be9732e1`, tree
`3d7b31bf4efab8e3540793ea5e1a4fa33f7c4425`, passed static generation and document checks. On compute Spark 3,
all **11/11** admin and actual Telegram-ingress integration tests passed against the stand-in fleet, including
confirmed resume with replay refusal, one-time read-only agent keys, history access and stale pairing rejection.
The companion batch passed **149/150** checks. Its sole failure was a new test fixture's missing `maskSecrets`
dependency. The corrected fixture passed **7/7** on Spark 3 at commit `5f7e1d8c4bf62ace0350195239273adf405d4d1b`,
tree `87b7176ac14dce092f03c016d5f5e45cb7e2343c`; production source and assertions were unchanged.
These are development results, not a full release qualification or a real Telegram-phone smoke test.
Key-door r3 commit `efd2e420e4da5c3ff9bd5a9b3b980f56765c56b5`, tree
`0dcfbdc705ff1aa31ecd42fff04e12ace4713d2a`, passed **149/149** checks on Spark 3: all 19 transport
cases, 15 existing key cases, recovery test selection, build and document checks. Pairing changes during message
deletion and an already-started save cannot send a result to the new pairing. Later copy-only account-help changes
are not part of that snapshot.

Independent reviews verified the current-pair proof, delivery before button activation, exact payload/go-ahead
binding, post-await lock/stop revocation, agent attribution without inherited authority, and truthful result provenance.

Recovery r4 tree `0db437c424556912d01b084835ecfa1c535b4404` passed **8/8** new fleet/selector checks.
Its neighboring batch found real regressions and was terminated after collecting evidence (exit 137, **not a pass**).
The job-folder check used a Docker ID where a folder name was required. The corrected target guard now runs inside
the supervised restore command. Exact creation receipts and narrow retirement after a deliberate successful rerun
passed **28/28** direct checks at r8 tree `686d86121e5bab8ce74cff9f5bda105021c06ad6`. The unchanged complete
folder-swap/rerun integration case passed **1/1** at consistent r9 tree `eaeb82989482769306fe77d55637655daf582d7b`.
The protective admission guard remains; no existing assertion was weakened. The neighboring recovery files are running.
The earlier r8 integration did not reach the case because its mixed snapshot lacked a helper; it is not behavioral evidence.

The owner explicitly approved the obsolete Telegram policy-test updates and paired-owner approval of new webpage
sign-ins on 2026-11-17. The test revisions preserve identity, confirmation, replay and agent-isolation checks.
Automatic approval review originally rejected the device extension before execution; the owner then specifically
authorized that access change. Implementation and focused validation are in progress. The HTTP passkey route stays intact.

Combined r5 tree `777b46fd134220b053747082c10f1c73e78417df` was a focused development run:

- Recovery: **50/59** passed. Independent failure scenarios now use fresh fleets under the owner's explicit
  fixture approval. Remaining receipt, restoration and report failures stay open; no release qualification.
- Telegram/device/admin: **201/224** passed. A known failed danger assertion left later cases waiting, and its
  identified worker was terminated; the log is incomplete evidence for those cases despite TAP's cancellation count.
  All 17 direct browser-device cases passed. Two API fixtures require correct cookie shape/cache synchronization.
- Seven complex Telegram files: **80/89** passed. Recall and extended tasks passed; five repaired files need reruns.
  Obsolete policy checks were reconciled only under the owner's explicit approval; image consent remains required.

Browser tree `3de10c7f3b44d89919c2818578c0c91f86061207` (r5 plus the page and browser fixture changes) passed
Chromium checks at 1440×1000 and 390×844 on Spark 3, including recovery UI and Telegram browser-code sign-in
with no passkeys. No page errors or overflow; the browser cannot approve itself. This is not final hosted evidence.

The owner also specifically approved ordinary workload requests and confirmations during restored-access review.
Sign-in, agent access and new device approvals remain held. The old Telegram-only refusal test is replaced by
pre-confirmation, confirmed stop, retained hold and replay checks. Automatic review had refused that policy-test
change before this decision; the subsequent explicit approval applies only to this boundary.

Follow-up r6 tree `47a3afdcdcba60070c4d59ba430d736039114f98` passed **169/177** in the main policy lane
and **67/69** in the complex Telegram lane. The restored-access suite, owner-administration API tests, held browser
denial, history provenance, workflow save/image-consent and brain-rail cases passed. One obsolete `/lock` text
assertion prevented re-enabling approvals; its later waits were terminated in the identified test worker, retained
as cancelled/incomplete evidence. Two real proposal-marker failures still let a page press omit its expected
passkey. The fix must preserve those assertions. The other lane's two remaining failures are exact reply and
question-intent fixtures, with corrections awaiting runtime verification.

Recovery-report r14 tree `96f007c2215576f5759652da58c5414580fa03d0` passed **17/17** on Spark 2, including
uncertain, mismatched and newer-receipt negative cases. Broader recovery qualification remains open.


Policy r7 tree `214a6fad15ab557bbda9b1db1454c470e5601412` passed **89/91** checks. All 32 Telegram
integration cases, both original page-passkey 428 assertions and the three proposal/proof checks passed. The two
failures exposed an outdated danger-raiser inventory and incomplete ordinary Telegram confirmation delivery
(A-50). The latter is a product defect, not a reason to relax the full-content assertions.

Late-protocol r8 tree `a51259b79699b5767931847e4e5d4b434dc1d81c` passed **75/75** on Spark 3. Combined
recovery r15 tree `b05e2ef735bc0609f32132b7cb141ebc1e117aab` passed **261/264** direct/static checks.
Two new fixture mistakes caused three failures: a missing real constant and a cleanup/log assertion followed by
its dependent case. Correcting only those fixtures produced r16 tree
`b274ed23296156fdbe47f330d28be1480fd27e0e`; its two affected files passed **40/40** on Spark 3, including
both real stand-in fleet return/restart cases. Production bytes were unchanged. These snapshots predate the
remaining A-48 compensation guards and A-50 full-confirmation repair; neither finding is closed by these results.


Policy r8 tree `24f0a841578365b72f5c5d665aca8bea2df0c1a1` passed **115/115** on Spark 3 with no skips,
including all 24 transport checks and five policy files. The old-source control passed the original 19 transport
checks and failed all five added full-facts cases. Independent source review accepted A-50 on the exact r8 bytes.
Combined recovery r15's five integration files finished **58/59**; all eight across-Spark cases passed. The sole
failure was the settled result's `cleanUp: null` rather than absent field, after the original had returned correctly.
The API now removes the field when settled, preserving the unchanged integration assertion. Its 18 report checks
passed at r17 tree `6d3b580d0e742420ce3486c9344a3524cc055c9b`. A-48 guards await combined-tree runtime checks.


Combined r18 tree `073dae15cc366f7cdb7b2834d56bb8f3931946c5` passed **321/321** direct/static checks
on Spark 3 and **6/6** targeted unchanged integration cases on Spark 2, with no skips or cancellations. The
formerly failing delayed-stop restoration case now passes its original absent-cleanup-field assertion. Independent
review accepted A-48 and A-50 source on the frozen bytes. A separate read-only review verified all 22 changed
tracked test files against that snapshot: all 222 original across/put-back assertions remain, and Telegram retains
confirmation, replay, pairing, agent isolation and restored-access checks. These scoped results precede the full run.

No final full-suite lock, final GitHub qualification or installation has happened for these changes.

## Installed-brain diagnostic, 2026-11-17

The five-case diagnostic on the installed build `c066dea96b74` passed four cases, with no wrong changes. It ran once
per case on a stand-in fleet on compute Spark 2, using the real Spark 1 brain. The planted-log, keep-app, fit question
and everyday-command cases passed. The three-part failure/alternative/plan case called the plan tool, but chose an
undownloaded recipe and received an error; its honest estimate did not meet the required successful plan lookup.
This is a baseline diagnostic, not candidate qualification or a stored evaluation. The full masked replies and tool
results are retained in the run evidence. Final qualification still needs all 33 cases three times on the installed
candidate's actual brain setup. The immutable image spelling changes that setup's key; the existing evaluator
correctly refuses to treat the old setup's result as the new one.

## Current context-retry candidate

T42 now has a private, one-use owner question after rollback and claim release. Explicit context is carried through
page and action starts, and numeric owner wording is bound to its model clause before the first launch. Each approved
reduction creates a separate operation and shares the original attempt/time budget. Page validation stays a separate
normal gate. The original task is identified separately from the current result chat, so handing a decision to the
owner neither resumes an agent task nor interrupts a newer request. Activity links to the question without approving it.

Policy/intent and page checks passed on `56c72fa2`, alongside four of six context-start cases and the browser scenario.
Both previously failing start cases and all four lifecycle regressions passed on `c1a69b46`. New boundary tests
cover exhaustion publication, numeric download-first starts, between-rank deadline expiry and named/verified
page-only setups; all five passed on `7bbed38f`. Wake-first propagation and copy-time expiry both passed on compute tree `a79dea6f944c6854cd25e08d5abed97ef50b8979`. Focused checks can include browser flows. T45 and the other gates below remain open.

The general recovery review found stale cleanup authority in `saved-runs.json.prev`. The new patch reads only a valid
primary, preserves corrupt bytes, reports an owner-visible problem, and keeps read failures from stopping a healthy
live workflow. Backup and state restore omit both primary and previous record, including residue from older copies.
Archive/restore and most new service regressions passed on `c1a69b46`; the corrected live-record case passed on `7bbed38f`. This does not add deferred T45 recovery or solve a
failed removal of an otherwise valid completed record. The targeted picker names source-fixture dependencies explicitly so service coverage cannot omit them. Fixed reader
errors prevent corrupt file contents entering logs; the update guard now restores source and its sibling manifest
together. These repairs passed independent source review and their hosted regressions on `7bbed38f`. Details and
stable findings A-43 through A-45: [findings-4.md](findings-4.md).

## Decisions carried forward

- Spark 1 permanently hosts the service and brain and stays on. Sparks 2/3/4 provide compute and sleep/wake when
  safe. Status reads wake nothing; owner work takes priority over tests. No inferred cable topology.
- During development, run the affected behavioral tests and meaningful checks of their dependent boundaries.
  A selected-file pass does not qualify a release. Before install, require the complete passing suite and browser
  checks for the exact frozen source being installed, plus the applicable brain/hardware checks.
- The owner released Sparks 2–4 for tests and necessary sleep/wake checks on 2026-11-17. Development checks now run there; final release qualification stays on GitHub. No larger paid
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
| A; B1/B2/B6/B8 | Startup/image/cache/intent and command-target repairs are in the source. Fit-question routing now offers the fit lookup in round one and passed hosted tool-list checks; a real-brain measurement remains pending. The five old eval misses are not all repaired: the stop fragment lacks its sentence; planted-log replies quoted the forbidden command; keep-app calls invented settings; three-group calls attempted a plan but retained no successful result or diagnostic error. Preserve full masked evidence on the next run before choosing further repairs. |
| B3, long Mac ControlPaths | Both `deploy/copy-hub-state.sh` and `deploy/plugs.sh` now use short `/tmp/sc-ssh.XXXXXX` directories. Long-temp-path regressions are added for both scripts; hosted results are pending. No Mac fleet was run here. |
| B4, migration weights | The move card and `deploy/REBUILD.txt` now copy link contents and require link/ownership checks. Prove snapshot shards are readable as the runtime user on the real hub; source instructions alone are insufficient. |
| B5, first validation request | The CLI retries only its first body-free GET once after a transport failure. Received HTTP errors and mutations are not replayed. The targeted hosted regressions passed on the earlier candidate. |
| B7, plug names | The script/card now use Spark numbers for mapped plugs and a unique Tapo label for unassigned setup. Controller ids stay internal; hub-rights and identity regressions await hosted results. |
| C, T42/T45 | Rejected context flags stay protected. The OOM owner-question flow and listed boundary regressions passed their focused checks; remaining evidence is listed above. Deferred restoration (T45) is implemented in the candidate; neighboring regression failures still block qualification. Do not close either finding from a similar test name. |
| C, `/keep`, budgets | `/keep` is explicitly unbuilt in R71. The handoff's 200 GB download/100 GB hub-floor promises still need a tested implementation or owner-approved disposition. Existing generic disk floors are not proof of those numbers. |
| C, delivery/update retries | Five result callers now reuse bounded in-memory Telegram retries, with hosted checks passing at bfd4fcab. Timer-triggered update recovery now keeps a three-attempt/30-minute budget across restarts; its focused hosted checks passed at e5aabcdc. Neither change promises durable or exactly-once Telegram delivery; direct-pull/manual recovery retains its existing path. |
| C, root units/helper trust | Report the actual supported boundary. Do not expand the helper or bypass managed access restrictions to finish a demonstration. |
| C, old address and cleanup | Verify and repoint external agents before retiring the old Spark 2 endpoint after Spark 1 is proven. Old worktrees, proof folders and possible containers need an inventory and the owner's cleanup scope; delete nothing from this checklist. |

Portable CI uses manual focused checks and a full main-push/manual release run. Both the complete strict suite and
browser job must pass before qualification can publish an install lock. The tested-mark writer runs no repository code. Parallel full-suite aggregation is being validated; partial runs never mark releases. Nightly scheduling remains off until the app is ready. Spark-specific lifecycle, power and brain proof remain separate.


## Sharing with other DGX Spark owners

A bounded source review at `e5aabcdc` found four distribution prerequisites: an owner-selected license; neutral
examples and owner-local settings instead of the current fleet/login defaults; preservation of those settings
during upgrades (the installer currently copies shipped config.json); and a complete first-install path, including
the tested lock, model weights and owner initialization. An install can currently skip owner checks when its owner
record is absent. These are distribution follow-ups, not proof the personal install needs a rewrite.

Credential-pattern checks inspected 818 tracked text files and found no confirmed real credential; candidates were
synthetic fixtures and historical test specifications. Git history and binary contents were not fully scanned.
The repository remains private; this review does not certify it ready for publication.
