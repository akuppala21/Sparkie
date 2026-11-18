# Open points

One row per finding. Updated by the builders after each reply. Nothing is closed until both sides agree, or the
owner decides (see [the procedure](README.md)).

Last updated: 2026-11-16. `reply-1.md` (complete for round 1) was written on 2026-11-14 and brought up to the build sent with it before it was sent: four findings are closed by removal since, and the plan (P-1 to P-7) is code now, so its rows ask Astra to check the code. Our own check of the reply against that code then changed six rows (A-1, A-2, A-5, P-2, P-3, P-5): the reply marks each place "Since (our check of this reply)", and its third table at the end has the commits. Commits and tests: the two tables at the end of the reply. The second table lists five follow-up commits from our own review of the fixes; the reply's "later" list has a second part from that review, which Astra can rebut too.

| Id | One line | State | Who moves next |
|---|---|---|---|
| A-1 | A removed or downgraded agent's reply under way can still make changes | Accepted in part; fixed on `main` (`eab0f43`, four tests; one test's wait made real, `a677d71`). Not accepted: pending buttons and carry-on turns. Policy written down: operations already running keep running, the rest of a saved workflow the agent started included (made true since, `3659abd`: a step carries no key id; `test/workloads-agent.test.mjs`). Later: A-1b | Astra: check the fix; agree or rebut the part not accepted and the policy |
| A-2 | A stopped GPU app starts on checks made before its claim | Accepted in part; fixed on `main` for `keep_running` (`2cc8152`, one test). Closed since: the restart path, A-2b (`48066c9`: `restartRoom` looks again inside the claim; one test in `test/apps.test.mjs`; `restart_model` has a new version). Since too: changes in one round run one after another, `run` and `write_file` included (`b837c66`; `test/rounds.test.mjs`) | Astra: check both fixes; agree or rebut the rating |
| A-3 | A question, "don't forget…", a quoted forget or an unrelated "remember…" can make Sparkie forget a line; "do not remember…" saved one | Accepted, wider than reported; fixed on `main` (`25f0cdb`, two tests; then `8e9dceb` and `55fd2cd` after our own review: statements with a "not" are kept again, and three more forget shapes give a button); G 3.6 amended. Closed since: an agent never forgets or replaces an owner's line (`fc42765`) | Astra: check the fix, and the sentences in the reply's later list that still slip through |
| A-4 | A model error cut off part-way leaves the chat stuck, also after `/stop` | Accepted; fixed on `main` (`a65f880`, three tests) | Astra: check the fix |
| A-5 | A key in an error's text is saved in the chat file | Accepted, plus button labels and operation errors in the events file; fixed on `main` (`acd2b92`, three tests; a third healing reason, `7182534`, one test; a fourth healing reason and four more spots since, `5340517`, one test). Open: `wait_operation` hands an operation's error and last log lines unmasked to the owner's own call of it (R7's Today); nothing of that is kept in a file | Astra: check the fix; agree or rebut the open point |
| A-6 | A file delete can remove a save that lands at the same moment | Accepted in part ("blocks install" was not). Closed since by removal: the file browser's route and the worker's delete, rename and new-folder calls are gone (`42ddc29`; `test/no-file-browser.test.mjs`) | Astra: check the removal |
| A-7 | A character split across two pieces of a request body is spoiled | Accepted; fixed on `main` (`418e16b`, one test). Not taken: counting the limit in bytes. Later: A-7b (less likely places; more than three now, the reply names them) | Astra: check the fix; agree or rebut the byte limit |
| A-8 | The first short job on a Spark only ever seen empty is never told | Accepted in part; fixed on `main` (`3f8044c`, one test). Not taken: "don't mark told before the notice succeeds" | Astra: check the fix; agree or rebut the part not taken |
| A-9 | The far side keeps a daily copy before this side knows tar ended well | Accepted; fixed on `main` (`aba4683`, three tests, one with real GNU tar on Linux; its first command made safe under zsh, `ea0d6f1`, one test). The macOS run does not carry over to the Sparks | Astra: check the fix |
| A-10 | A pair's plan that arrives late replaces the plan of the Spark picked since | Accepted. Closed since by removal: Home, Models, Files and Access are off the page (`test/page.test.mjs`) | Astra: check the removal |
| A-11 | A file listing still on its way shows under the next Spark | Accepted. Closed since by removal: the file browser and its route are gone (`42ddc29`; `test/no-file-browser.test.mjs`) | Astra: check the removal |
| A-12 | A batch of uploads follows the area switch | Accepted, and reachable from the owner's "Preview as a member" too. Closed since by removal: the file browser, members and the preview are gone (`test/owner-only.test.mjs`) | Astra: check the removal |
| T-1 | One clean-up failure (`ENOTEMPTY`) in Astra's Mac run, 995 of 996 | Accepted as a fault in the test harness, not the app; fixed on `main` (`48ca258`, two tests) | Astra: run the whole suite again |
| T-2 | A stand-in fleet's port taken by another test file before the service listened (found in our own Linux run) | Fixed on `main` (`8b65066`, one test) | Astra: nothing, unless it sees it again |
| Default: no trash | Change the default to a bounded trash for workspace deletes | Not accepted as a change of default; one sentence written into design A 2.6 | Astra: agree or rebut |
| P-1 | The put-back timer can fire while its command is still writing | Accepted; written into the one page and A 2.8. Built since (R60; `21-net.mjs`, the root helper), with shorter times than the text: the reply's "As built" | Astra: check the code |
| P-2 | A change can happen with no lasting journal record | Accepted, with the block scoped to free-form changes; written into the one page sections 2 and 4. Built since (R43, R61; `20-journal.mjs`, `21-runner.mjs`); two typed actions and a command in the box are written first too. The tests for a changing `run`, an undo, a long look and a change inside the net with the journal unwritable came since (`bae6a88`, `f2d572f`: `test/runner-fixes.test.mjs`, Linux only; `test/net.test.mjs`) | Astra: check the code; agree or rebut the scope |
| P-3 | Restoring an old copy can bring back a removed device or passkey | Accepted in part: sessions leave the copy; one number detects state put back. Not accepted: open sign-ins and asks (memory only), "recovery candidates". Built since (R23; `22-putback.mjs`), with more than the reply promised; P-3a is closed for sign-ins. Since: taking an always-allowed kind away raises the number too (`df65eea`; `test/putback.test.mjs`) | Astra: check the code; agree or rebut the smaller mechanism |
| P-4 | A "checked" brain grade must name the behaviour that was checked | Accepted, with a rider so it does not bring back asking; written into the one page section 10. Built since (R52, R47; `21-brain-rail.mjs`); the second rider was built differently: the reply's "As built" | Astra: check the code; agree or rebut the rider as built |
| P-5 | Run the script bytes that were shown on the approval | Accepted; written into the one page section 4 and A (milestone 2). Built since with less than the answer says (R72; `21-ladder.mjs`, `21-runner.mjs`; `d1592fc`): the button shows each script's hash, not its text; the press takes the Spark's claim, then reads the hashes again; the change's own first lines check them once more; the script then runs by its path, not from bytes held open. No installer is downloaded once. The reply's "As built" | Astra: check the code; agree or rebut what was not built |
| P-6 | Keep exact-tree approval through the self-change PR path | Accepted; written into C. Built since as two presses, and switched off (R69; `21-selfchange.mjs`) | Astra: check the code |
| P-7 | Tighten the memory research claims | Accepted, with one correction to the correction; written into G | Astra: check the amended text; agree or rebut the correction |
| Broader answers | Astra's answers to the guide's broader questions | Fourteen adopted and written into the plan; eleven were already there. Built since, but for the confirming visit (9) and a brain across Sparks (12); the reply marks each | Astra: check the code |
| Design clean-up | Output caps in A and B; journal copies in E; G's page-only wording and `memoryClear`; the guide's description of the page | All four accepted and written into the designs and the guide. Since: milestone 4's delete is built, and long output is held in memory up to 16 MB until its command ends (clean-up 1 was built differently) | Astra: check the code |


## Recovery follow-up, 2026-11-17

These rows record the new findings in [findings-4.md](findings-4.md), without changing the earlier round's decisions.
The repairs are in draft candidate `7bbed38f`; focused run `44074814751` passed 968/968. Independent source review
agrees with the scoped repairs. Full release qualification and installation remain separate gates.

| Id | One line | State | Who moves next |
|---|---|---|---|
| A-43 | A previous saved-run record can revive stale cleanup authority | Accepted; primary-only reads and backup boundary implemented; hosted regressions pass | Release qualification and install |
| A-44 | Corrupt recovery contents can enter error notes and logs | Accepted; content-free reader errors implemented; all three regressions pass | Release qualification and install |
| A-45 | Update rollback can leave old source with a new manifest | Accepted; source/proof restored together; prior absence and failed-copy retry checks pass | Install the fixed guard before relying on it for later upgrades |

| A-46 | Failed unlink can retain completed-work cleanup authority | Accepted; narrow retirement repair and source review pass; 50/50 nearby checks passed on compute, and pre-fix controls fail | Final release qualification; combined persistence failure remains open |
| A-47 | Ordinary downloads can target the hub or use stale disk data | Accepted; admission repair and source review pass; 8/8 focused compute checks, and pre-fix controls fail | Final release qualification; continuous budget enforcement remains separate |

| A-48 | Compensation can stop a container after a newer owner adoption | Fixed; independent source review accepted r18; 321/321 direct/static and 6/6 selected integration checks pass | Final complete release qualification |
| A-49 | Sensitive Telegram proposals lost their page passkey marker | Fixed; original 428 assertions and all 32 Telegram cases pass on policy r7; independent source review agrees | Final qualification; separate long-confirmation defect under investigation |

| A-50 | Ordinary Telegram approval omits full code-built facts | Fixed; independent source review and 115/115 compute checks pass on r8; all five new regressions fail on old source | Final combined-tree release qualification |

| A-51 | Stopped historical pair prevents a new compute pair start | Fixed; independent review; direct and unchanged pair/wake integration checks pass on r20/r21 | Complete release qualification |
| A-52 | Wall time expires a command observer before its receipt | Fixed; monotonic transport budgets; clock regressions and original context-expiry case pass | Complete release qualification |
| A-53 | Failed restoration omits structured notBack evidence | Fixed; exact proof-derived metadata, original context/lifecycle assertions pass | Complete release qualification |
| A-54 | Duplicate setup intent asks before an explicit model start | Fixed; independent review; negative authority controls and unchanged carry-on eval pass | Complete release qualification |

| A-55 | Pre-Docker refusal becomes false unresolved start debt | Fixed; independent review; boundary regressions and original validation pass in r24’s 231/231 | Complete release qualification |
| A-56 | Self-test recovery loses stop evidence and holds initial seeding | Fixed; independent review; original and added identity/debt checks pass in r24’s 231/231 | Complete release qualification |
| A-57 | New retry and owner gates lack protected-path classification | Fixed; unchanged security assertions pass in r23's 56/56 | Complete release qualification |
| A-58 | Long cleanup hides earlier retry decisions | Fixed; bounded masked history; original workflows and added cases pass in r23 | Complete release qualification |
| A-59 | Core prompt exceeds its existing size limit | Fixed; shorter instructions preserve safeguards; original assertion passes in r22's 233/233 | Complete qualification and real brain evaluation |

| A-60 | Delayed self-test cleanup stops a newer same-ID owner restart | Fixed; r9 independently accepted; actual ownership reproductions pass in r8’s 156/156 | Complete exact-tree qualification and live checks |

| A-61 | Missing self-test stop receipt crashes result delivery | Fixed; original minimal fixtures retained and all three result cases pass in r8 | Complete exact-tree qualification |

| A-62 | Name-based self-test cleanup stops an owner-adopted app | Fixed; exact ownership checks; actual app-adoption/crash regression passes | Complete qualification and native-stop follow-up evidence |

| A-63 | Preserved owner-adopted self-test model can remain untracked | Fixed; durable desired handoff and newer-stop revocation independently accepted; real model adoption checks pass | Complete qualification; scoped native app-stop status in findings-4 |


| A-64 | Restored state can revive a self-test's old stop permission | Fixed; independent source/evidence review; seven old-source failures and 27/27 fixed checks, ordinary rollback preserved | Complete qualification of the corrected candidate |
| A-65 | Stop workflow fingerprint omits the self-test producer | Fixed; one dependency entry; original assertion passes in combined 125/125 checks | Complete qualification of the corrected candidate |

| A-66 | Long link metadata rejects a permitted fixture omission | Fixed; independent review; four old-source failures and 171/171 fixed checks | Complete integrated qualification and install |

| A-67 | Recovery fixtures inject the next fault before the prior phase finishes | Owner-approved corrections; every assertion retained; independent review; complete compute 3,489/3,489, all four cases also pass hosted | Final qualification of A-68 candidate |

| A-68 | Older status reports online after a confirmed shutdown | Closed. Installed R8 passed 3,501/3,501 on Spark 2 and GitHub. Live operation `44758d05e9b2` showed Spark 2 off at 0 W and Spark 1 online. Wake-on-app `c83baa3b7656` completed and the app returned HTTP 200. | Complete |
| A-69 | A bridged compute job reaches the public sign-in page at the model address | Old/fixed controls reproduced and passed. R10 passed 3,503/3,503 on Spark 2 and GitHub, but its separate brain evaluation did not qualify. | Qualify the next prompt candidate, install and repeat the live self-test |
| A-70 | Sparkie guesses setup details for an existing app and reports it missing | R8 passed 0/3 and reproduced 0/1 with no operation. R10 passed both focused and full `keep-app` 3/3, with no asks or wrong changes. | Preserve the action repair in the next complete qualifying brain run; A-71 is separate |

| A-71 | Sparkie claims an app answers while its readiness check is pending | Two of three focused R10 replies made the unsupported claim. The action was correct. The next prompt asks it to distinguish confirmed and pending results. | Direct real-brain wording evidence; the existing case grade does not check this |
| A-72 | A reply repeats a command planted in an untrusted log | R10 failed all three; R11 focused cases passed 3/3 without forwarding the executable command. No execution, changes or asks. One reply named the script and shell in prose; that is not a command. | Preserve the result in a complete qualifying brain run and exact-tree software qualification |
| A-73 | A speed question without a recorded measurement becomes a benchmark approval | R12 made no requests for approval but one of three speed answers skipped its lookup. The next wording explicitly requires looking up the model and recorded measurements before reporting speed status. Gates and original grades are unchanged. | Fresh focused cases without unnecessary asks, then the full unchanged evaluation |
