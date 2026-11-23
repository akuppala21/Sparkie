# Practical repair with a 780-second hard deadline

**The selected local model left a two-hunk patch that passed 4 of 8 hidden cases. The owner got no final answer.** All 30 tool calls had matching persisted results. The last two edited the selector at about 751 seconds. The model made no post-edit verification call before the driver stopped at exactly 780.0 seconds, exit 137. The native session contains intermediate commentary and no final assistant row. The model-facing entry point was the native dashboard agent factory with a CLI surface, matching the earlier trials. No browser was attached. [Model patch](model.patch) · [Complete tool timings and public interim messages](native-tools.json) · [Independent grades](results.json)

| Hidden case | Result |
| --- | --- |
| Explicit nested `test_reports.py` | Passed, ran the failing test without broad qualification |
| Explicit nested `render_test.py` | Failed, selected a broad plan and missed the failing test |
| Explicit root `render_test.py` | Failed, selected a broad plan and missed the failing test |
| Existing specialized behavior group | Failed, preserved the compact behavior requirement but missed the explicitly changed test |
| Broad discovery of nested `test_reports.py` | Passed, propagated the real pytest failure |
| Broad discovery of nested `render_test.py` | Failed, missed the failing test |
| Git-discovered nested `test_reports.py` | Passed, propagated the real pytest failure |
| Documentation-only edit | Passed, kept the fast path |

The patch recursively discovers files named `test_*.py` during broad qualification and adds explicit paths directly under `tests/components/`. The explicit branch reconstructs the path from the basename, so it also loses deeper directories. The model left all 271 files in place, with exactly one content change in `sparkie/tools/checks.py`. It added no regression test. Independent post-run checks passed all 46 existing selector-related tests in 1.92 seconds and confirmed that direct invocation of the planted test still failed in 0.01 seconds. The private scorer ran each required behavior against a new disposable checkout. [File inventory and all eight receipts](results.json)

## How the turn spent its time

- At 166 seconds the model requested the directly failing component test. Pytest printed one failure, while the shell's trailing pipeline and echo reported zero. The next genuine broad run returned 10 failed, 1,083 passed and 11 skipped in 47.93 seconds of pytest time. The native tool round took 51.50 seconds.
- The model spent the following minutes investigating those ten other failures. A scratch copy under `/tmp` let it move modules aside. One of those broad runs took 47.69 seconds and still had a failing test. Another produced a collection error after moving a dependency.
- It then recreated the scratch copy from the original and added a pytest collection hook to deselect the ten named failures. The resulting run took 52.30 seconds through the native tool and reported 1,083 passed and 11 skipped. The planted nested test remained absent. The model described the exclusions in its interim message. The actual checkout retained the original test files and had no collection hook.
- The real selector changed at 751.66 and 752.03 seconds. The final provider request remained active when the hard deadline expired. Serving counters recorded one aborted request. The case made 30 local HTTP completion requests, including auxiliary traffic. [Per-call measurements](native-tools.json) · [Serving counters](results.json)

## Comparison and scope

Both previous trials retain their original 390-second targets plus 15 seconds of termination grace, exit 137, no final answer and 1 of 8 hidden cases. This separately labeled trial used the original sealed application, exact question, 271-file seed, eight-case scorer, native settings and ready-to-use development environment. The old and new model processes had matching image, launch arguments and mounts. A new lease, model container, profile and Git checkout isolated this trial. Model startup took 205.1 seconds before the 780-second trial clock. One stochastic run at each condition does not isolate the effect of the larger budget. [Original and matched failed trials](../hermes-native-dev-repair-2026-11-23/README.md) · [Hard deadline controls](../hermes-native-dev-repair-2026-11-23/terminal-deadline/README.md) · [Fresh preflight and hidden baseline 1/8, reference 8/8](preflight.json)

The outer supervisor removed the exact remaining sandbox and confirmed that provider counters drained. The temporary model unit and container retired. Three host samples found zero GPU processes, a bindable port and 117.63–117.65 GiB available. The enrolled owner fleet observation at 09:57:29 UTC showed Spark 2 online, with zero running containers and no reservations under its 30-minute idle policy. [Handback evidence](handback.json)
