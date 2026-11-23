# Can Sparkie use technical sources accurately?

## Code from a manual

The manual reader now retains indentation, comments, blank lines and line breaks in HTML code examples. Excerpts stop at the end of the example and mark partial blocks. A 65,536-line limit bounds expansion of large preformatted inputs. The original page and its hash remain available. This change adds no tool or model request to ordinary chat.

On Spark 2, an independent extractor selected the 104-line multiprocessing example containing `worker_configurer` in the CPython 3.13 logging cookbook. The previous reader lost its layout. Lines 881–984 of the revised reader’s saved text matched the publisher sample exactly, and the sample parsed as Python. The structural checks also exercised tabs, comments, blank lines, hidden spans, unanchored blocks and per-line wrappers. All 110 affected integration and reader tests passed in 7.11 seconds, including the 29 reader tests. An initial publisher probe picked a HOWTO with no example matching its selection criteria and exited before comparing the two readers. The cookbook probe identifies the specific example it checks. [Publisher](https://docs.python.org/3.13/howto/logging-cookbook.html) · [Check results](public/reader-checks.json)

## Worked examples in ordinary chat

Six fresh Hermes dashboard-agent chats used the selected local Huihui model on one compute Spark. Each question had one attempt per configuration, a 450-second deadline and 30 seconds of interruption grace. An independent evaluator froze the questions and scoring criteria before seeing the candidate. The candidate used Hermes’s built-in prefill with two worked examples. All candidate requests contained both examples before the owner’s question. Their demonstration calls were excluded from tool counts. Checks found none of their tool IDs or full teaching texts in the three saved conversations or final answers.

| Owner task | Previous configuration | With worked examples |
| --- | --- | --- |
| Recommend a PostgreSQL 11/12 rollout | Retrieved both manuals and tested both versions. No final answer in 480 s. | Correct two-step primary plan in 404 s, followed by an unsafe alternative. Tested a synthetic schema on PostgreSQL 17 and claimed the alternative worked on 11 and 12. Whole answer failed. |
| Reconcile three project records for release handover | Correct. Reported 94/100 current approvals and split the six outstanding reviews correctly in 87 s. | Correct in 103 s. Opened all three records, but foregrounded the number delivered before giving the requested approval count. |
| Answer a simple arithmetic question | Correct in 7.8 s, one model request and zero tools. | Correct in 7.2 s, one model request and zero tools. |

The PostgreSQL candidate used 22 model requests and received 24 genuine tool results. Its optional plan rebuilt a type from an invented list of enum values. On a different schema that could drop valid unused labels or fail on another dependency. The original question required only adding and committing the new value before updating rows. The worked examples remain outside the application. Both configurations passed two of the three sampled questions. [Per-chat results](public/chat-results.json) · [PostgreSQL 11 manual](https://www.postgresql.org/docs/11/sql-altertype.html) · [PostgreSQL 12 manual](https://www.postgresql.org/docs/12/sql-altertype.html)
