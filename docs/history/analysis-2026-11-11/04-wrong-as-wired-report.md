# Spark Console audit: what is wrong as built (2026-11-11)

Read-only; nothing was run. Paths are under `/Users/akuppala/Documents/26aiRAG/spark-console/service/src/` unless shown; line numbers are today's (re-checked for the table, since some parts moved a few lines during the audit).

## 1. Verdict

Spark Console is sound for one simple request on a quiet fleet, but not yet safe to leave alone: 22 critical or high problems end in a model stopped that nobody named, a request silently half done, or a statement no tool backed. The worst class is one fact kept in two places that disagree (the "don't stop" rule, a model's name, whether a Spark is on), so a later step acts on the wrong copy. Self-healing is the sharpest case: it can stop what the owner just started, restart what it was told to hold, and miss what it should restart. No finding touches SSH, Tailscale, the firewall or users.

## 2. Fix before anything else

Row 1 is critical, the rest high. "Sure" is the confidence left after a second agent tried to refute the finding.

| What the owner experiences | Where | Smallest fix | Sure |
|---|---|---|---|
| **1.** Healing brings GLM back across 3+4 and stops the model the owner started there since. | 20-heal.mjs:87, :97 | `noStops: true` in bringBack's ctx; stopping a down container (17-changes.mjs:534) takes it off the should-run list. | High |
| **2.** "Stop X, then start Y": Y silently never starts when the stop ends before Sparkie's reply, the owner types anything, or the chat hits 200 messages. | 14-chats.mjs:129, :139, :167, :192, :342 | Schedule continueTask at turn end; retry while replying; clear the task only on a new change request; say when giving up. | High |
| **3.** A stop on a Spark cancels a download-and-start still downloading there, and says "put back". | 20-desired.mjs:103-104; 17-changes.mjs:471, :492, :541 | Flag the job when it claims its Sparks (:492); `holdsModelsOn` skips it before. | High |
| **4.** A pair started by download-then-start is listed as `org/name` but labelled `org--name`: false heals, and a lost part never restarts. | 17-changes.mjs:471; 20-desired.mjs:29; 20-heal.mjs:49 | Store the library name; match parts by container and cluster label. | High |
| **5.** Any old power-on, or two missed status checks, restarts a held model as "Spark came back on". | 20-heal.mjs:19, :24-36, :53-62 | Power-on branch only if the model went down with that power-off; hold checks first. | High |
| **6.** After a console restart a "verified run" with defaults that never ran is recorded; later starts and heals can pick it. | 09-verified.mjs:117-140; 17-changes.mjs:164 | Adopt from `docker inspect`, else skip; delete `by: null` entries. | High |
| **7.** "Don't stop anything" is lost through a button, a typed yes or a saved workflow. | 17-changes.mjs:52; 14-chats.mjs:97-100, :227; 18-workflows.mjs:193 | Keep noStops with each pending choice and pass it into workflow steps. | High |
| **8.** A Spark the gate can't read ("Spark four", "both Sparks", "3/4") is deleted; the start runs wherever there is room. | 16-actions.mjs:90-96, :256-257 | An unbacked Spark becomes a button naming the place. | High |
| **9.** "Stop qwen coder" can stop the other qwen: the check looks at one Spark. | 16-actions.mjs:167-173 | Score all Sparks; run only on one best match. | High |
| **10.** "Undo" cancels the oldest running operation, or reverses an older change; after an install its steps are refused, leaving both models down. | 20-desired.mjs:19-26, :150-152, :159-160; 16-actions.mjs:330 | Cancel the newest; write a revision for a replaced container; mark undone only on success; count undo as a validation run. | High |
| **11.** In an automatic pause, healing records "restarting" then fails at once (the reviews file says fixed). | 17-changes.mjs:31, :184, :583 | Give `pausedCheck` the watcher exception at 16-actions.mjs:298. | High |
| **12.** Powered-off Sparks' containers reach Sparkie as "running now", the cable as just tested. | 19-watcher.mjs:74, :181; 16-actions.mjs:781-790; 06-links.mjs:84 | Say "off since…", with a time per Spark and pair. | High |
| **13.** Cancel and undo say "put back" when nothing was; a saved workflow's running step is never cancelled; a cancelled download runs on. | 20-desired.mjs:137-138, :151; 18-workflows.mjs:188-197; 14-chats.mjs:122; 11-setups.mjs:397 | Cancel the step with its parent; write the sentence from the job's record; name and stop the download container. | High; download part unproven |
| **14.** "Start X on Spark 3" where X runs deletes the working container; a failed start has nothing to put back. | 17-changes.mjs:104, :314-318, :418; 07-jobs.mjs:131-132 | Answer "already"; set the old container aside as 08-cluster.mjs:349-357 does. | High |
| **15.** A download-then-start picks its Spark from a stale reading, decides hours later what to stop, and never names it. | 17-changes.mjs:358, :486-492; 14-chats.mjs:123 | Read memory fresh; ask before any stop after the download; list stops in "Done". | High |
| **16.** A repo named in a community recipe file becomes a version a plain "start" downloads and runs. | 11-setups.mjs:191; 17-changes.mjs:362-363 | Skip `community: true` versions unless the owner names the repo. | High |
| **17.** The install's automatic test can leave the owner's model stopped: its put-back is refused as "not validated". | 18-workflows.mjs:342-354; 16-actions.mjs:330-341 | Put back as bringBack does (trusted, `__validate`). | High |
| **18.** A model that agents call at the address Sparkie gave them counts as idle and is stopped mid-task. | 16-actions.mjs:463; 15-routes.mjs:167 | Give out the console's /v1 address. | High |
| **19.** No GGUF model can start (`llama-server` isn't on PATH in the pinned image); a bystander is stopped first. | 05-library.mjs:137, :358 | Use `/app/llama-server`; prove it on a Spark. | Medium |
| **20.** Sparkie reads only the first 12,000 characters of a tool result, so logs lose their newest lines. | 14-chats.mjs:314 | Keep the end for log tools; shorten lists with a count. | High |
| **21.** Phone: a typed "ok" presses a button the page never showed. | 14-chats.mjs:189, :209; public/app.js:3898 | Press only buttons the page reports as shown. | High |
| **22.** Phone: carry-on turns never appear; one failed poll shows a running start as "failed". | public/app.js:2383, :3828-3835, :3898 | Keep reading while the chat replies or has a task; keep polling on a network miss. | High |

## 3. Wired wrong by design

- **One request, many copies.** The Spark, setup and "don't stop" live in one turn's context; buttons, workflow steps, heal and undo rebuild it without them, and the should-run list keeps a different name and no setup (rows 1, 4, 7, 8, 10; 20-heal.mjs:97). *Change:* one stored request record (model, Sparks, setup, noStops, who asked) carried by every choice, job and list entry.
- **A check standing in for another.** "In use" means called through the gateway; "up" means anything answers on port 8000 (08-cluster.mjs:436); "came back" means any power-on in 500 events; "verified" means was running at restart (rows 3, 5, 6, 18). *Change:* test the thing itself: engine counters, served name, the entry's own down time, a claim flag, the container's inspect.
- **Sentences fixed before the facts.** "Put back", "Done", "running now", "is back on" (13-main-model.mjs:260) and the page's "Started" (public/app.js:2474) are constants (rows 12, 13). *Change:* build every notice from the job's record.
- **A gate keyed on the verb.** undo_update, run_workflow and forget_workflow pass on "undo" or "start" alone; workflow steps skip the gate (16-actions.mjs:160, :180). *Change:* every change action declares a target the owner's words must contain, else a button naming it.
- **Carry-on woken by one event.** Only an operation ending at the right moment continues a task (row 2); a console restart cuts turns (25-backup-and-start.mjs:71). *Change:* a task record with its operation ids, re-checked at turn end, result post and start-up.
- **Several fit checks, remembered shares.** where_it_fits, pickVersion and the start disagree (05-library.mjs:240-250; 17-changes.mjs:367); a restart demands the first start's share (17-changes.mjs:574). *Change:* one can-start-here function; the share measured per engine at each start.
- **Who is speaking depends on the route.** The owner's API calls count as an agent's (07-jobs.mjs:64; 20-desired.mjs:132), an agent's words as the owner's memory (20-memory.mjs:49). *Change:* one actor on every context.

## 4. Medium and low

- **Chat:** "restart GLM" can't restart a pair (17-changes.mjs:563); a pair's "yes" button drops the second Spark (17-changes.mjs:428); "undo that" can roll the console back, or restore the build already running (16-actions.mjs:160; 18-workflows.mjs:362, :383; partly); the number check accepts clock digits (14-chats.mjs:148); instructions fall out after 20 messages (14-chats.mjs:5); a busy brain is "stopped responding" (14-chats.mjs:283); the secret mask refuses ordinary memory lines (20-mcp.mjs:240-243).
- **Page:** stops behind a button unsaid (14-chats.mjs:73, :122-126); cancelled shows "Running" (public/app.js:16); "Started" for no change (public/app.js:2474); an expired "yes" vanishes (14-chats.mjs:189).
- **Starts and healing:** any server on port 8000 counts as the pair (08-cluster.mjs:436); 30 s of silence ends a pair load (02-ssh.mjs:27-36); heal reads a minute-old record (20-heal.mjs:66-71); exits 0, 137, 143 never heal (19-watcher.mjs:102); restart refused with 1 GB less free (17-changes.mjs:574); a one-time context cap saved as the proven run (17-changes.mjs:212-215); SGLang share, llama.cpp limit, vLLM reserve (05-library.mjs:137, :298-314; reserve partly); page-cache refusal advises sudo (17-changes.mjs:205-207; partly); a model on an off Spark downloads again (05-library.mjs:82-85); where_it_fits recommends Spark 2 (05-library.mjs:244-250); "Permission denied" blames the wrong Spark (07-jobs.mjs:99-107).
- **Trust and gateway:** llama.cpp shell-tool flags pass (service/dig.mjs:212); agents remove owner memory (20-memory.mjs:58-62); the owner's API failures pause Sparkie (07-jobs.mjs:64); recipe-id calls get 503 forever (15-routes.mjs:139); streams left open (15-routes.mjs:89, :185); a crashing brain setup waits 45 minutes (13-main-model.mjs:220).
- **Install and growth:** a worker.py-only edit installs with workflows off (18-workflows.mjs:66; partly: deploy/host-on-portal.sh:57 now checks the lock); the install dies with the terminal (:334) and deletes Spark 2's source copy (:236-237); no KillMode (low); the daily look floods event lists (11-setups.mjs:231-241); stale "still downloading" (05-library.mjs:28); the 60-container cap answers "no container" (16-actions.mjs:721-723); a full disk stops chat (14-chats.mjs:24-29).

## 5. What was looked at, and what was not

Fourteen lenses; no finding refuted, eight only partly confirmed. Traced: sentences (sixty owner sentences through the gate), truth (each notice back to its check), state (should-run list, verified runs), timing (heal against owner, cancel), failures (what a failed step leaves), trust (web text to docker command), install (host-on-portal.sh), placement, brain (/v1, brain switch), tests (stand-ins against real commands), phone-page (chat in app.js), text-signals (patterns, exit codes, masks), real-spark-numbers (engine flags against their sources), caps-and-growth.

Not covered:
- What the live Qwen actually calls; anything on a real Spark; Spark 2's live state files.
- Sign-in and sessions (22-passkey.mjs, 22-sessions.mjs, 03-identity.mjs), 21-editor.mjs, 04-metrics.mjs, 23-http.mjs.
- REST routes that skip the gate and rails (24-handler.mjs:413-455).
- The page beyond chat, cloud/, agentbar/, tools/spark.mjs, other deploy scripts; installer, restore.sh and watchdog never run under a test.
- worker.py beyond status and logs; dig.mjs parsers; vLLM and SGLang flags.
- A cold boot of every Spark; MemoryMax=512M under load.

## 6. Tests that would have caught these

1. Slow brain: the stop ends before the reply; step two still runs.
2. start_model for a pair not on disk, then stop_model there: the download continues; kill a part and it restarts.
3. Heal table at production timings: automatic pause, a model started since the power-off, out of memory after an old power-on, two missed checks.
4. "Don't stop" through every door (button, typed yes, workflow, heal, download-then-start).
5. Restart the service with a setup running: verified.json unchanged.
6. Start where it already runs, fail the new start: the old one still answers.
7. Cancel a workflow mid-step: the step stops; the sentence matches the job record.
8. Gate table: "Spark four", "both", two qwens, verb-only actions.
9. Honest stand-ins: docker returns the command, rejects a missing entrypoint; containers outlive a killed ssh.
10. One real-Spark start per engine, GGUF included.

### Critical Files for Implementation
- /Users/akuppala/Documents/26aiRAG/spark-console/service/src/20-heal.mjs
- /Users/akuppala/Documents/26aiRAG/spark-console/service/src/17-changes.mjs
- /Users/akuppala/Documents/26aiRAG/spark-console/service/src/14-chats.mjs
- /Users/akuppala/Documents/26aiRAG/spark-console/service/src/20-desired.mjs
- /Users/akuppala/Documents/26aiRAG/spark-console/service/src/16-actions.mjs
