# Research recommendations in ordinary Hermes chat

Spark 2 ran the selected one-Spark Huihui checkpoint with SGLang and DFlash2. The chat comparisons used fresh Hermes dashboard-agent sessions. Each received an ordinary owner question, and the model chose its own tools. Each question had one attempt per configuration. The deadline was 450 seconds with a further 30 seconds for interruption. Single trials show what happened on these questions.

## Advice about real changes

The experiment added one paragraph to the assistant instructions. It asked for the smallest supported course that preserves existing state and for validation on the relevant version. Both configurations had the same renderer and previous manual reader. The revised instructions stay experimental. The development package retains the original instructions. [Matched owner questions, answers and timings](public/ordinary-chats.json)

| Owner question | Original instructions | Revised instructions |
| --- | --- | --- |
| Roll out an enum change on PostgreSQL 11 and 12 | Found both version rules. Timed out after 480 s without an answer. | Answered in 158 s with the correct two-file rollout and both manuals. Calling the plain command idempotent was incorrect. |
| Back a merge out of a shared Git release, then bring it back after QA | Correctly selected parent two and reversed the rollback. Answered in 195 s. Volunteered incorrect advice for an updated topic. | Both requested commands were correct in 112 s. Overstated the certainty of a conflict-free restoration. |
| Answer a simple arithmetic question | Correct in 8.1 s with zero tools. | Correct in 7.6 s with zero tools. |

The PostgreSQL decision was materially better than the timeout. Compared with the earlier worked-example trial, this reply also avoided a rebuild that silently removed an existing enum label. The new reply nevertheless gave an inaccurate retry explanation and imprecise PostgreSQL 12 error wording. Replaying its SQL on 11.22 and 12.22 confirmed that executing the standalone `ADD VALUE` a second time fails with duplicate-label SQLSTATE `42710`. On 12.22, using the new value before commit fails with `55P04`. Skipping an already-completed migration is a valid retry procedure. [Database replay](holdout/postgres-replay-result.json) · [Earlier migration trial](../hermes-autonomous-research-2026-11-22/results.md)

Both Git answers came from model knowledge. Each used one model request and zero tools. An independent Spark 2 Git fixture verified the requested commands, the later fix and the unchanged-topic reintroduction. What happens after subsequent edits to the release branch remains conditional. [Git replay](holdout/restore-release/spark2-replay.json) · [Unseen question and frozen criteria](holdout/restore-release/rubric.md)

## Links to specific manual entries

The reader now restricts text matches to a supported, uniquely matching HTML ID. It preserves original line numbers and the complete page. An absent, ambiguous, hidden or unsupported target yields zero section passages. Ordinary page URLs retain whole-page search. Inline locator spans, JavaScript-rendered content and arbitrary publisher-specific page layouts have no general section guarantee.

Four publisher links were compared against the previous reader using identical response bytes. For both Python gzip manuals, the previous first matches were under `GzipFile`. The revised reader found the linked `gzip.compress` signature, including `mtime=None` in 3.13 and `mtime=0` in 3.14. The tutorial example stayed within its named section. In the Python URL-decoding manual the previous first two string matches were on lines 15 and 21. The linked definition is on lines 248–251 of the saved text and explicitly requires a string. All four complete plain-text files remained byte-identical to the earlier extraction. The affected suite passed 121 tests in 8.36 s on the final reader, including 40 reader tests. Independent review of earlier revisions found a paragraph that leaked into the next heading and qualifiers omitted under header markup. Their regressions are included. [Publisher receipts](public/reader-checks.json) · [Repeatable comparison](public/check-manuals.py)

## Finding a skill in its execution workspace

Hermes v0.23.2 printed the host directory in the assistant's startup and slash-command text. The model had tried that path on another machine and hit file errors. The packaged correction uses the same roots that Hermes mounts or synchronizes. The terminal shows its own skill directory for eligible files and offers native `skill_view` for an unmapped location. The patch is pinned to one upstream module with checked input and output hashes. It adds no model call, tool registration or running service. [Pinned upstream renderer](https://github.com/NousResearch/hermes-agent/blob/ae2a81ccc00e9b7c06301523e5bb09608397149c/agent/skill_commands.py#L425-L448)

On Spark 2, both a native Docker workspace and a disposable native SSH workspace ran the exact reader from the directory shown to the model. Both startup and slash activation displayed the correct location. The SSH test used loopback on Spark 2. [Workspace receipts](public/cpu-workspaces.json)

The enrolled development package `41035655` took 16.23 s to assemble. Its 258 application files matched the owner checkout. The changed-file selector chose 67 test modules. Of 1,041 tests, 1,037 passed on the first run. Four systemd-dependent tests passed unchanged once the compute Spark's service-manager tools, libraries and units were mounted read-only. Separate renderer checks passed 85 focused and 41 upstream tests. The packaged owner-authorization smoke passed with an inert dispatch. The portable GitHub checkout uses generic enrollment and excludes private fixtures. Its changed code passed a separate 98-test run in 5.82 s. [Package checks](public/package-checks.json) · [Portable checkout](public/portable-checks.json)

## Did the assistant actually use the reader?

The previous reader, the section-aware reader, and the section-aware reader with a corrected terminal directory all answered the same Python 3.13 question correctly. All three used other tools to download and inspect the page. The directory fix made the script reachable. A narrow instruction in the existing research skill then told the model how to open an owner-supplied manual section. The selected model, general assistant instructions, and native tools stayed the same.

| Owner chat | Section reader used | First visible text | Final | Model requests | Tool results | Requested decision |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Python, previous reader and skill | No | 49.3 s | 184.3 s | 7 | 8 | Correct |
| Python, new reader | No | 24.1 s | 161.9 s | 6 | 7 | Correct |
| Python, new reader and corrected skill path | No | 25.8 s | 97.0 s | 7 | 8 | Correct |
| Python, explicit linked-section instruction | Yes | 73.2 s | 81.7 s | 7 | 7 | Correct |
| Docker, previously unseen linked-section question | Yes | 22.8 s | 28.6 s | 3 | 2 | Correct |

On Python, the first helper attempt failed with a generic fetch or decode error. Its retry returned lines 248–251 of the requested definition. The assistant inspected a wider range, verified the behavior on CPython 3.13.18, recommended `unquote_plus(raw.decode('ascii'))`, and correctly predicted `A B+C`. The result demonstrates use of the right source. All four versions already got the answer right, and the guided turn started showing text later than the others. [Matched answers and section receipts](public/linked-chats.json) · [Independent Python replay](holdout/anchored-manual/spark2-replay.json)

The unseen Docker question ran only after the Python trial used the reader. The first tool call returned lines 46–56 of Docker's swap-limit entry, ending before the neighboring swappiness section. The second call read the whole extracted page. Sparkie correctly explained that zero is treated as unset, that the previous flags allowed up to an additional 2 GiB of swap, and that `--memory=2g --memory-swap=2g` sets a 2 GiB memory limit with no additional swap allowance. It made no workload change. This establishes transfer to a second publisher. Discovery when the owner supplies no URL and synthesis across conflicting sources still need separate qualification. [Frozen Docker question](holdout/linked-workload/input/question.txt) · [Publisher rules used for grading](holdout/linked-workload/reference.json)

The final development candidate `34725fba` changes only the research skill from package `41035655`. All other 257 source files have the same bytes. Building it took 12.08 s. Its 121 affected tests passed in 9.01 s and the protected-profile and owner checks passed. A separate check of the portable development branch passed 98 tests in 6.42 s. [Candidate and checks](public/guided-package.json) · [Portable check](public/portable-final.json)

## Release decision

The linked-manual change is in the development branch. The release remains held. The final assembled package passed its native smoke in 3.37 s and seven of nine compact behavior cases in 149.06 s. In the two failures Sparkie read the correct stop record once, correctly reported a failed or uncertain stop, and returned the request label where the machine-readable answer required the operation ID. In the uncertain case it included the correct ID in the explanatory text. Each isolated fixture recorded a single dispatch. For consumers that use the structured field, the wrong ID is a consequential error. The structured research case cited both forum sources and correctly distinguished configured context from measured throughput on this attempt. [Final compact evidence and the two incorrect fields](public/compact-final.json)

Package `41035655` had passed eight of nine compact cases in 143.45 s. On that attempt the failed-stop answer gave the right ID and outcome but read the complete file twice. Native Hermes detected the byte-identical result; no second stop occurred. A private adapter configuration initially prevented the evaluation from starting. After correcting its trial directory the evaluation ran once. Neither compact result was rerolled. Differences between two model samples do not establish the cause of the recovery misses. [Earlier compact results](public/compact-base.json) · [Repeated read and actual outcome](public/failed-stop.json)

The test supervisor released the model after the final check. All 11 ordinary test sessions were accounted for. Three observations found the listener free, the model and its test sandboxes absent, and no GPU process on Spark 2. Spark 1 was online. Spark 2 had zero running containers and its normal 30-minute idle policy. Sparks 3 and 4 were off. [Cleanup and fleet observations](public/cleanup.json)
