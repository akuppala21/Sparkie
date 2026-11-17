# Diagnose a brain eval miss

Run the eval as described in [the card](how/run-the-brain-eval.md). Every result has a separate
`<result>.diagnostics.json` beside it. It is evidence only: kind `spark-console-eval-evidence`,
`qualification: false`. It changes no grade, pass bar or kept-result field. `--store` refuses it before any network
request. The console does not keep it.

Each attempted run has its case, run and attempt numbers. A no-result attempt stays beside its retry, rather than
being replaced. Before removing each practice fleet, the runner captures:

- Full masked replies and carry-on messages, with their chat and task, and the last reply or error envelope.
- Parsed tool arguments and results, including tool errors.
- The operations as they stood then, with their status, error and last 120 public log lines, plus journal records.

Use the full words to distinguish “I've stopped trying” from a claim that a workload stopped. Read the tool result
and operation status before deciding what happened. The existing failed grade stays failed in either case.
After grading, capture waits for operations its tool calls started, using only the case’s remaining task-wait budget
and at most 30 more seconds. It does not restart the wait budget.
Unrelated work never holds it up. Operations still running or missing at that limit are listed in `operationsOpen`.
Unavailable saved replies or operations carry an explicit error while other evidence is retained.

`test/eval-diagnostics.mjs` reuses the production masking definitions from `service/src/20-mcp.mjs` and
`service/src/03-secrets.mjs` in an isolated context. It supplies only the practice fleet's own secret snapshot and
the case's `answerSecret` values, including their percent and base64 forms. It reads no owner or home secrets.
A linked fixture secret file is refused. If the snapshot or masker cannot be read, all text for that attempt is
omitted and a capture failure is recorded. The same happens if the unchanged grader's seeded-token check still
finds a fragment or spaced token after masking. Text over 2 MiB before or after masking is omitted and marked
`truncated`; that attempt is not a full transcript.

`writeDiagnostics` replaces any previous output file or link atomically with a new mode-0600 file. A link's target
is never written. The file remains on the runner's machine until its owner removes it.

`test/eval-diagnostics.test.mjs` covers masking, fragments, full-word distinctions with unchanged grades, retry
retention, fail-closed omissions and private writes. `test/brain-eval.test.mjs` checks the runner writes evidence,
retains both failed attempts, and refuses to store it before contacting a console.

An inference server without verified serving identity produces `spark-console-eval-diagnostic`. Its wrong changes
are still counted and still exit with code 2; the record cannot be stored to qualify a brain. The command regression
checks both grading and that refusal.
