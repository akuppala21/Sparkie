# Open points

One row per finding. Updated by the builders after each reply. Nothing is closed until both sides agree, or the
owner decides (see [the procedure](README.md)).

Last updated: 2026-11-14, after part 1 of `reply-1.md`.

| Id | One line | State | Who moves next |
|---|---|---|---|
| A-1 | A removed or downgraded agent's reply under way can still make changes | Accepted in part; fix being built. Not accepted: pending buttons and carry-on turns | Builders: land the fix and test. Astra: agree or rebut the part not accepted, and the "already running keeps running" policy |
| A-2 | A stopped GPU app starts on checks made before its claim | Accepted in part; fix being built for `keep_running`. The restart path is later (A-2b: changes `restart_model`'s version) | Builders: land the fix and test. Astra: agree or rebut the rating and A-2b |
| A-3 | A question, "don't forget…", a quoted forget or an unrelated "remember…" can make Sparkie forget a line | Accepted, wider than reported; fix being built | Builders: land the fix and test, amend G 3.6 |
| A-4 | A model error cut off part-way leaves the chat stuck, also after `/stop` | Accepted; fix being built | Builders: land the fix and test |
| A-5 | A key in an error's text is saved in the chat file | Accepted, plus button labels and operation errors in the events file; fix being built | Builders: land the fix and tests |
| A-6 | A file delete can remove a save that lands at the same moment | Accepted in part: later, a rename-first delete with the next `worker.py` change; not a blocker | Astra: agree or rebut "later", and the one word changed in the closing test |
| A-7 | A character split across two pieces of a request body is spoiled | Accepted; fix being built. Not taken: counting the limit in bytes. A-7b (three less likely places) later | Builders: land the fix and test. Astra: agree or rebut the byte limit |
| A-8 | The first short job on a Spark only ever seen empty is never told | Accepted in part; fix being built. Not taken: "don't mark told before the notice succeeds" | Builders: land the fix and test. Astra: agree or rebut the part not taken |
| A-9 | The far side keeps a daily copy before this side knows tar ended well | Accepted; fix being built. The macOS run does not carry over to the Sparks | Builders: land the fix and test, with the real case on Linux |
| A-10 | A pair's plan that arrives late replaces the plan of the Spark picked since | Accepted; later (page) | Astra: agree or rebut "later" |
| A-11 | A file listing still on its way shows under the next Spark | Accepted; later (page) | Astra: agree or rebut "later" |
| A-12 | A batch of uploads follows the area switch | Accepted; later (page). Also reachable from the owner's "Preview as a member" | Astra: agree or rebut "later" |
| Default: no trash | Change the default to a bounded trash for workspace deletes | Not accepted as a change of default; one sentence for design A 2.6 accepted | Builders: amend A 2.6 in part 2. Astra: agree or rebut |
| P-1 | The put-back timer can fire while its command is still writing | Being checked | Builders: part 2 |
| P-2 | A change can happen with no lasting journal record | Being checked | Builders: part 2 |
| P-3 | Restoring an old copy can bring back a removed device or passkey | Being checked | Builders: part 2 |
| P-4 | A "checked" brain grade must name the behaviour that was checked | Being checked | Builders: part 2 |
| P-5 | Run the script bytes that were shown on the approval | Being checked | Builders: part 2 |
| P-6 | Keep exact-tree approval through the self-change PR path | Being checked | Builders: part 2 |
| P-7 | Tighten the memory research claims | Being checked | Builders: part 2 |
| Design clean-up | Output caps in A and B; journal copies in E; G's page-only wording and `memoryClear`; the guide's description of the page | All four confirmed as real disagreements with the one page | Builders: amend the designs in part 2 |
