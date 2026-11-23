# Why the broad pytest run returned only its banner

The experiment reached its 390-second wall deadline while the first broad pytest process was running. GNU `timeout` sent SIGINT to the evaluation process group, including the attached `docker exec` client. That client returned zero with only the banner. The command inside Docker kept running. The model then requested the same broad run again, which opened the same redirected log for writing. [Historical terminal, cache and Docker events](incident.json)

| UTC on November 23, 2026 | Observation |
| --- | --- |
| 09:18:25.162 | Docker started the first broad command. The native terminal default was 180 seconds. |
| 09:19:12.986 | The session recorded the banner, exit 0 and no completion marker, background session or timeout field. |
| 09:19:18.208 | Pytest wrote its cache with 1,104 node IDs and ten failed tests. |
| 09:19:27.561 | Docker started the second broad command. The model had requested a 300-second native timeout. |
| 09:19:27.972 | Docker recorded exit 137 for both execs during teardown. The evaluation had used its 15-second termination grace. |

On the same 271-file checkout, an uninterrupted CPU replay of the same test command returned 10 failed, 1,083 passed and 11 skipped in 49.29 seconds. Its failure names matched all ten historical cache entries. The control replaced the preliminary inline Python plan formatter with a short plan listing. The compound shell returned zero from its final `tail`, while the printed pytest exit was one. The redirected log was independently readable through the next native tool call. This replay verifies the command and its status handling. The first historical run's final pytest totals were not captured. [CPU replay](incident.json)

## Experiment correction

The qualification driver now has a hard process-group deadline. The outer runner retains responsibility for recording interruption, removing the exact private container and verifying provider drain before releasing a reserved model. When the budget expires, the driver and its attached Docker client receive SIGKILL together. Only a result recorded before this boundary can count as a completed tool call. The in-container process can survive loss of its client until the outer runner removes its container. [Deadline launcher](run-before-deadline.sh)

For a new matched run, the experiment launcher uses `sh run-before-deadline.sh 390s "$PYTHON" -u run.py` in place of its earlier `timeout --signal=INT --kill-after=15s 390s` prefix. The prepared next-case launcher differs in that single invocation and passed shell syntax validation. [Launcher change and source hashes](next-launcher.json)

Passing `--foreground` to the old SIGINT wrapper avoided the false zero in a separate short control but still permitted a tool result after expiry. [Process-group and foreground-only controls](incident.json)

| Isolated Spark 2 control | Terminal result | Further work |
| --- | --- | --- |
| Original SIGINT plus grace | Exit 0 with only the start banner. The marker appeared 3.95 seconds after the reply. | A provider stand-in ran and a second real native terminal call completed during the grace period. |
| Hard deadline | Driver killed during the first native terminal call. | No returned result, provider continuation or second tool call. The outer process removed the one private container. |
| Normal completion before the hard deadline | Exit 0 with the start and completion markers. The marker file already existed. | Driver exited cleanly and native teardown removed the private container. |

The three controls used the sealed Hermes Docker terminal, CPU only, no network in the sandbox and zero model requests. The provider stand-in only recorded that the fixture reached that branch. Each control verified that the exact sandbox was gone. An initial verifier expected the outer supervisor to remove even a container already removed by ordinary Hermes teardown. The final verifier records both forms of cleanup and directly verifies absence by the captured container ID. [Controls and assertions](verify.py) · [Recorded runs](results.json)

On an enrolled compute Spark with GNU coreutils, Docker, the sealed release, and its corresponding Python environment, run `"$PYTHON" /path/to/verify.py verify "$RELEASE"` from a writable scratch directory. The verifier writes a new result directory, uses the sealed release's native test fixture and fails on a missing expected event or a surviving sandbox.

The owner's browser Stop action uses the gateway's `session.interrupt` RPC. A separate desktop and phone check observed previously completed tool output after Stop and reload. This watchdog correction applies to the experiment's wall-clock budget. The browser check interrupted a waiting model response and did not exercise a pending Docker command. [Owner Stop evidence](../../hermes-owner-chat-interruption-2026-11-23/results.md)
