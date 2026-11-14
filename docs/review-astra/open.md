# Open points

One row per finding. Updated by the builders after each reply. Nothing is closed until both sides agree, or the
owner decides (see [the procedure](README.md)).

Last updated: 2026-11-14, after `reply-1.md` (complete for round 1). Commits and tests: the table at the end of the reply.

| Id | One line | State | Who moves next |
|---|---|---|---|
| A-1 | A removed or downgraded agent's reply under way can still make changes | Accepted in part; fixed on `main` (`eab0f43`, four tests). Not accepted: pending buttons and carry-on turns. Policy written down: operations already running keep running. Later: A-1b | Astra: check the fix; agree or rebut the part not accepted and the policy |
| A-2 | A stopped GPU app starts on checks made before its claim | Accepted in part; fixed on `main` for `keep_running` (`2cc8152`, one test). Later: the restart path (A-2b: it changes `restart_model`'s version) | Astra: check the fix; agree or rebut the rating and A-2b |
| A-3 | A question, "don't forget…", a quoted forget or an unrelated "remember…" can make Sparkie forget a line; "do not remember…" saved one | Accepted, wider than reported; fixed on `main` (`25f0cdb`, two tests); G 3.6 amended | Astra: check the fix |
| A-4 | A model error cut off part-way leaves the chat stuck, also after `/stop` | Accepted; fixed on `main` (`a65f880`, three tests) | Astra: check the fix |
| A-5 | A key in an error's text is saved in the chat file | Accepted, plus button labels and operation errors in the events file; fixed on `main` (`acd2b92`, three tests) | Astra: check the fix |
| A-6 | A file delete can remove a save that lands at the same moment | Accepted in part: later, a rename-first delete with the next `worker.py` change, or its only caller goes in milestone 4; not a blocker | Astra: agree or rebut "later", and the one word changed in its closing test |
| A-7 | A character split across two pieces of a request body is spoiled | Accepted; fixed on `main` (`418e16b`, one test). Not taken: counting the limit in bytes. Later: A-7b (three less likely places) | Astra: check the fix; agree or rebut the byte limit |
| A-8 | The first short job on a Spark only ever seen empty is never told | Accepted in part; fixed on `main` (`3f8044c`, one test). Not taken: "don't mark told before the notice succeeds" | Astra: check the fix; agree or rebut the part not taken |
| A-9 | The far side keeps a daily copy before this side knows tar ended well | Accepted; fixed on `main` (`aba4683`, three tests, one with real GNU tar on Linux). The macOS run does not carry over to the Sparks | Astra: check the fix |
| A-10 | A pair's plan that arrives late replaces the plan of the Spark picked since | Accepted; later (page; the view is deleted in milestone 4) | Astra: agree or rebut "later" |
| A-11 | A file listing still on its way shows under the next Spark | Accepted; later (page; the view is deleted in milestone 4) | Astra: agree or rebut "later" |
| A-12 | A batch of uploads follows the area switch | Accepted; later (page; the view is deleted in milestone 4). Also reachable from the owner's "Preview as a member" | Astra: agree or rebut "later" |
| T-1 | One clean-up failure (`ENOTEMPTY`) in Astra's Mac run, 995 of 996 | Accepted as a fault in the test harness, not the app; fixed on `main` (`48ca258`, two tests) | Astra: run the whole suite again |
| T-2 | A stand-in fleet's port taken by another test file before the service listened (found in our own Linux run) | Fixed on `main` (`8b65066`, one test) | Astra: nothing, unless it sees it again |
| Default: no trash | Change the default to a bounded trash for workspace deletes | Not accepted as a change of default; one sentence written into design A 2.6 | Astra: agree or rebut |
| P-1 | The put-back timer can fire while its command is still writing | Accepted; written into the one page and A 2.8 (milestone 2) | Astra: check the amended text |
| P-2 | A change can happen with no lasting journal record | Accepted, with the block scoped to free-form changes; written into the one page sections 2 and 4 (milestone 2) | Astra: check the amended text; agree or rebut the scope |
| P-3 | Restoring an old copy can bring back a removed device or passkey | Accepted in part: sessions leave the copy; one number detects state put back. Not accepted: open sign-ins and asks (memory only), "recovery candidates". Later: P-3a (today's restore by hand) | Astra: agree or rebut the smaller mechanism and P-3a |
| P-4 | A "checked" brain grade must name the behaviour that was checked | Accepted, with a rider so it does not bring back asking; written into the one page section 10 (milestones 1 and 5) | Astra: check the amended text; agree or rebut the rider |
| P-5 | Run the script bytes that were shown on the approval | Accepted; written into the one page section 4 and A (milestone 2) | Astra: check the amended text |
| P-6 | Keep exact-tree approval through the self-change PR path | Accepted; written into C (milestone 5) | Astra: check the amended text |
| P-7 | Tighten the memory research claims | Accepted, with one correction to the correction; written into G | Astra: check the amended text; agree or rebut the correction |
| Broader answers | Astra's answers to the guide's broader questions | Fourteen adopted and written into the plan; eleven were already there | Astra: check the amended text |
| Design clean-up | Output caps in A and B; journal copies in E; G's page-only wording and `memoryClear`; the guide's description of the page | All four accepted and written into the designs and the guide; milestone 4 now names the delete of the page's views | Astra: check the amended text |
