# Can Sparkie use technical sources accurately?

## Code from a manual

The manual reader now retains indentation, comments, blank lines and line breaks in HTML code examples. Excerpts stop at the end of the example and mark partial blocks. A 65,536-line limit bounds expansion of large preformatted inputs. The original page and its hash remain available. This change adds no tool or model request to ordinary chat.

On Spark 2, an independent extractor selected the 104-line multiprocessing example containing `worker_configurer` in the CPython 3.13 logging cookbook. The previous reader lost its layout. Lines 881–984 of the revised reader’s saved text matched the publisher sample exactly, and the sample parsed as Python. The structural checks also exercised tabs, comments, blank lines, hidden spans, unanchored blocks and per-line wrappers. All 110 affected integration and reader tests passed in 7.11 seconds, including the 29 reader tests. An initial publisher probe picked a HOWTO with no example matching its selection criteria and exited before comparing the two readers. The cookbook probe identifies the specific example it checks. [Publisher](https://docs.python.org/3.13/howto/logging-cookbook.html) · [Check results](public/reader-checks.json)

A separate owner chat explicitly asked for the prime-number example from the Python 3.13 tutorial as a standalone script. Both versions delivered an independently verified program and all eight expected output lines. The old reader flattened the example and the model reconstructed it. The revised reader exposed its indentation directly. The revised chat used seven tools versus eleven with the old reader. The first visible text arrived in 10.2 seconds versus 48.2 seconds, and both finished in about 62 seconds. This one pair establishes source fidelity and fewer tool calls on that task. Both answers were correct. [Matched chat receipts](public/runnable-example.json) · [Frozen example](holdout/code-example/rubric.md)

## Worked examples in ordinary chat

Six fresh Hermes dashboard-agent chats used the selected local Huihui model on one compute Spark. Each question had one attempt per configuration, a 450-second deadline and 30 seconds of interruption grace. An independent evaluator froze the questions and scoring criteria before seeing the candidate. The candidate used Hermes’s built-in prefill with two worked examples. All candidate requests contained both examples before the owner’s question. Their demonstration calls were excluded from tool counts. Checks found none of their tool IDs or full teaching texts in the three saved conversations or final answers.

| Owner task | Previous configuration | With worked examples |
| --- | --- | --- |
| Recommend a PostgreSQL 11/12 rollout | Retrieved both manuals and tested both versions. No final answer in 480 s. | Correct two-step primary plan in 404 s, followed by an unsafe alternative. Tested a synthetic schema on PostgreSQL 17 and claimed the alternative worked on 11 and 12. Whole answer failed. |
| Reconcile three project records for release handover | Correct. Reported 94/100 current approvals and split the six outstanding reviews correctly in 87 s. | Correct in 103 s. Opened all three records, but foregrounded the number delivered before giving the requested approval count. |
| Answer a simple arithmetic question | Correct in 7.8 s, one model request and zero tools. | Correct in 7.2 s, one model request and zero tools. |

The PostgreSQL candidate used 22 model requests and received 24 genuine tool results. Its optional plan rebuilt a type from an invented list of enum values. In an independent replay on PostgreSQL 11.22 and 12.22, the suggested transaction committed successfully and silently removed an existing unused label, `archived`. The primary two-step plan preserved all labels, a dependent table, the column default and the row excluded by the update. [Replay](public/replay-enum.sh) · [Observed results](public/enum-replay-output.txt) The original question required only adding and committing the new value before updating rows. The worked examples remain outside the application. Both configurations passed two of the three sampled questions. [Per-chat results](public/chat-results.json) · [PostgreSQL 11 manual](https://www.postgresql.org/docs/11/sql-altertype.html) · [PostgreSQL 12 manual](https://www.postgresql.org/docs/12/sql-altertype.html)

The [migration case](holdout/deploy/rubric.md) and [release handover case](holdout/reconcile/rubric.md) retain their exact inputs and frozen scoring rules for future changes.

## Research without an explicit lookup request

Two further ordinary chats answered which of two Python workers could produce a different gzip cache key simply because time passed. Both independently fetched the original CPython code at both release tags before answering. Both correctly explained the changed timestamp default and recommended `gzip.compress(payload, mtime=0)` on both workers. The baseline incorrectly called the timestamp a single byte. The candidate added an unsupported guarantee about byte-identical output across different builds. Neither answer met the stricter standard of supporting every consequential claim. [Question and grading criteria](holdout/implicit-manual/rubric.md) · [Measured turns](public/implicit-lookup.json)

The candidate exposed the existing reader as a discoverable Hermes tool. Native CPU checks found it and verified source delivery inside a task-bound test workspace. During the ordinary chat the model used the existing GitHub helper, with zero calls to the new tool. The baseline took 233 s and the candidate took 145 s. These two samples do not establish a speedup from the new tool. The extra registration stays experimental.

## Compact checks on the reader change

The native smoke passed and the compact local evaluation passed all nine automated cases in 158 seconds. The simple question produced its first text in 7.4 seconds, and the unknown preference question left memory untouched on this attempt. Manual grading of the structured research answer still identified a configured limit described as measured and an unsupported hard ceiling. The compact case validated the response structure and citations. General research accuracy remains open. [Case results](public/compact.json)

The temporary model retired automatically on Spark 2. Three follow-up observations found its listener free and no remaining test sandbox or GPU process. [Cleanup checks](public/cleanup.json)
