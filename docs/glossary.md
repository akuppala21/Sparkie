# Words

One word for each thing. The documents, Sparkie's prompt, action titles and the page use the word; the code keeps its
own name where a rename would change a workflow version. Meanings are the owner's. Words marked "not built yet" name
something the next phase builds (`docs/design-2026-11-13/README.md`).

| Word | What it means | Name in code | Don't say |
|---|---|---|---|
| hub | The Spark that runs the console and the brain. Spark 2 today | `brainSparks`, `MAIN.node` | portal host; "Spark 2" for the role |
| compute Spark | Every other Spark on the list: models, apps and jobs run there | `NODES`, less the hub | "Spark 3 or 4" for the role |
| workload | Anything that runs on a Spark: a model, an app, a job. What the `workloads` action lists | `knowledge.workloads`, `workloads` | pipeline |
| app | A container that isn't a model and is kept running (Open WebUI, Jupyter). A dev box is an app that is an editor or a notebook | `keep_running`, label `spark.app=1`, `devBox` | service |
| job | A container that runs once, to its end, and writes into the shared folder | `keep_running` with `once`, label `spark.job=1`, `jobEnded` | job for an operation |
| operation | Long work the console tracks and posts a result for: a start, a stop, a download | `newJob`, `runJob`, `jobs` (the code says job) | task, job |
| task | One request Sparkie carries on with across turns and operations until it is done. Today the carry-on; made to last, with hours and turns, in milestone 5 | `conv.task`, `continueTask`, `wakeWork` | work queue; carry-on for the new thing |
| workflow | A tested, versioned change in code: it runs only when the lock names this build and its version | `WORKFLOWS`, `workflowStatus` | "every change is a workflow" |
| saved workflow | The owner's ordered action calls on named Sparks, run by name | `saved-workflows.json`, `save_workflow`, `run_workflow` | routine, stack, pipeline |
| shared folder | The one folder per Spark that files and jobs use | `sharedFolder` (the path says `workspaces/shared`) | workspace |
| run; write_file | The next phase's two command tools: `run {on, command}` runs one command on a Spark or the box, sorted by code into a look, a change or a risky one; write_file writes one file there, copied first. Not built yet (milestone 2) | none yet; `run` in `02-ssh.mjs` is already the function that sends a command to a Spark | exec, shell |
| box | A throwaway container that one command runs in, on a compute Spark (`on: "box"`). Not built yet (milestone 5) | none yet | sandbox, workspace |
| memory line | One line of the owner's own words that Sparkie keeps across chats | `memory.json`, `remember`, `forget_memory`, `memoryPrompt` | memory for lessons or the journal |
| journal | The raw record of everything said, called, run and seen; never rewritten. Not built yet (milestone 2) | none yet | log; memory |
| lesson | A fact code drew from the console's own runs, such as a setup that failed twice. Not built yet (milestone 3); today a memory line may have the kind lesson | `MEMORY_KINDS` (today) | skill, learned fix |
| asleep | Powered off or paused on purpose; wakes by itself when needed. A compute Spark: the idle power-off or `power_off`, turned on again by a start or a call (R41). The brain: not built yet. Dark is different: off without being asked | `power.json` (`off`), `consoleOff`; `darkPeriods` (dark) | off, resting |
| parked | Stopped by Spark Console so its Spark could be powered off: still on the should-run list, back once that Spark is on | `parked` in `desired.json`, `parkDesired` | held (that waits for the owner) |
| wall power | What a Spark draws at the wall, read from its smart plug. Not the GPU’s power | `wall`, `wallFor`, `plugs.json` | power, for either alone |
| held | On the should-run list, not running, and not coming back by itself until the owner presses Bring back | `desiredNow`, `watchHeld` | paused |
| paused | Agents' changes are stopped, by the owner or by the breaker; reads keep working | `agent-settings.json` (`halted`), `pausedCheck`, `tripBreaker` | paused for anything else |
| tested; validated | Tested: the whole suite passed on this exact tree and `node test/lock.mjs` wrote the lock. Validated: one real run of that workflow version passed on the Sparks | `service/workflows.lock.json`; `validations.json`, `recordWorkflowRun` | verified (a proven run, `verified.json`) |
| agent door; app door | The agent door is `/mcp`, where the owner's agents call actions with a key. The app door is port 10000 of the same name, where the owner opens kept apps | `mcpDoor`; `doorHandler` | "the door" alone |
