# Open points

One row per finding. Updated by the builders after each reply. Nothing is closed until both sides agree, or the
owner decides (see [the procedure](README.md)).

Last updated: 2026-11-15. `reply-1.md` (complete for round 1) was written on 2026-11-14 and brought up to the build of 2026-11-15 before it was sent: four findings are closed by removal since, and the plan (P-1 to P-7) is code now, so its rows ask Astra to check the code. Commits and tests: the two tables at the end of the reply. The second table lists five follow-up commits from our own review of the fixes; the reply's "later" list has a second part from that review, which Astra can rebut too.

| Id | One line | State | Who moves next |
|---|---|---|---|
| A-1 | A removed or downgraded agent's reply under way can still make changes | Accepted in part; fixed on `main` (`eab0f43`, four tests; one test's wait made real, `a677d71`). Not accepted: pending buttons and carry-on turns. Policy written down: operations already running keep running. Later: A-1b | Astra: check the fix; agree or rebut the part not accepted and the policy |
| A-2 | A stopped GPU app starts on checks made before its claim | Accepted in part; fixed on `main` for `keep_running` (`2cc8152`, one test). Later: the restart path (A-2b: it changes `restart_model`'s version) | Astra: check the fix; agree or rebut the rating and A-2b |
| A-3 | A question, "don't forget…", a quoted forget or an unrelated "remember…" can make Sparkie forget a line; "do not remember…" saved one | Accepted, wider than reported; fixed on `main` (`25f0cdb`, two tests; then `8e9dceb` and `55fd2cd` after our own review: statements with a "not" are kept again, and three more forget shapes give a button); G 3.6 amended. Closed since: an agent never forgets or replaces an owner's line (`fc42765`) | Astra: check the fix, and the sentences in the reply's later list that still slip through |
| A-4 | A model error cut off part-way leaves the chat stuck, also after `/stop` | Accepted; fixed on `main` (`a65f880`, three tests) | Astra: check the fix |
| A-5 | A key in an error's text is saved in the chat file | Accepted, plus button labels and operation errors in the events file; fixed on `main` (`acd2b92`, three tests; a third healing reason, `7182534`, one test) | Astra: check the fix |
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
| P-2 | A change can happen with no lasting journal record | Accepted, with the block scoped to free-form changes; written into the one page sections 2 and 4. Built since (R43, R61; `20-journal.mjs`, `21-runner.mjs`); two typed actions are written first too | Astra: check the code; agree or rebut the scope |
| P-3 | Restoring an old copy can bring back a removed device or passkey | Accepted in part: sessions leave the copy; one number detects state put back. Not accepted: open sign-ins and asks (memory only), "recovery candidates". Built since (R23; `22-putback.mjs`), with more than the reply promised; P-3a is closed for sign-ins | Astra: check the code; agree or rebut the smaller mechanism |
| P-4 | A "checked" brain grade must name the behaviour that was checked | Accepted, with a rider so it does not bring back asking; written into the one page section 10. Built since (R52, R47; `21-brain-rail.mjs`); the second rider was built differently: the reply's "As built" | Astra: check the code; agree or rebut the rider as built |
| P-5 | Run the script bytes that were shown on the approval | Accepted; written into the one page section 4 and A (milestone 2) | Astra: check the amended text |
| P-6 | Keep exact-tree approval through the self-change PR path | Accepted; written into C. Built since as two presses, and switched off (R69; `21-selfchange.mjs`) | Astra: check the code |
| P-7 | Tighten the memory research claims | Accepted, with one correction to the correction; written into G | Astra: check the amended text; agree or rebut the correction |
| Broader answers | Astra's answers to the guide's broader questions | Fourteen adopted and written into the plan; eleven were already there. Built since, but for the confirming visit (9) and a brain across Sparks (12); the reply marks each | Astra: check the code |
| Design clean-up | Output caps in A and B; journal copies in E; G's page-only wording and `memoryClear`; the guide's description of the page | All four accepted and written into the designs and the guide. Since: milestone 4's delete is built, and long output is held in memory up to 16 MB until its command ends (clean-up 1 was built differently) | Astra: check the code |

PENDING: A-1's row (R1-02): "operations already running keep running", for a saved workflow a removed agent started.
PENDING: A-2's row (R1-07): the restart path (A-2b) and its reason.
PENDING: P-2's row (R1-10): the test for a changing `run` with the journal unwritable.
PENDING: P-3's row (R1-04): whether a removed "always" entry raises the number.
PENDING: P-5's row (R1-03): what was built, and what Astra should check.
