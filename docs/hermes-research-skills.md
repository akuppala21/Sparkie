# Sparkie research skills for Hermes

The two skills in this update use the native Hermes agent on a local model. The
tested runtime is Hermes v0.23.2 with the selected Huihui Qwen 3.8 27B NVFP4
checkpoint and SGLang with DFlash2 on one compute Spark.

| Owner request | Behavior |
| --- | --- |
| Look up a named option in a public GitHub project | Read the publisher's README at the requested tag or commit. The reader verifies the byte count and Git blob before returning the file. A missing tag produces an error. |
| Look up one function or section in an HTML manual | The manual reader searches within the linked definition, heading or enclosing element and reports line numbers in the saved full text. If the fragment is missing, ambiguous or unsupported, it returns zero section hits. The original page remains available for a separate whole-page lookup. |
| Recommend an engine based on this fleet | Load the one-Spark results on demand. The stock Qwen recipes have a two-engine comparison. The selected Huihui checkpoint has measurements for SGLang alone. |
| Measure a gap | Use a reserved compute workspace with an authorized, reachable model endpoint. Save the conditions, quality checks, timings and receipt location in the project and a discoverable Hermes note. An unavailable arm leaves the comparison open. |
| Repair a project using its dependency documentation | Reproduce the installed version's failure, read its publisher's docs, edit the client and rerun its tests. The disposable HTTP client fixture includes independent verification instructions. |

The native skill directories are
[`local-recipe-review`](../sparkie/skills/local-recipe-review/SKILL.md) and
[`one-spark-serving-results`](../sparkie/skills/one-spark-serving-results/SKILL.md).
The research skill uses native terminal and file tools in a writable
`/workspace`. Its Python readers belong in the same skill's `scripts/`
directory in the execution sandbox. The existing profile auto-loads
`local-recipe-review`. Hermes discovers the fleet record by name and description.
Changes to the protected skill roster follow the reviewed installation procedure.

The [stock warm](review-astra/evidence/hermes-research-optimization-2026-11-22/engines/measured-summary.json),
[stock cleared-cache](review-astra/evidence/hermes-research-optimization-2026-11-22/engines/cold/measured-summary.json)
and [Huihui warm](review-astra/evidence/hermes-research-optimization-2026-11-22/engines/huihui/measured-summary.json)
records distinguish direct serving latency from time spent by Hermes on a whole task.
The [versioned lookup receipt](review-astra/evidence/hermes-research-update-2026-11-22/repo-lookup/result.json)
records the ordinary agent turn. To repeat the repair case, use the
[disposable project](../sparkie/tests/behavior/retry_handoff/README.md).

The [research and memory comparison](review-astra/evidence/hermes-general-research-2026-11-22/README.md)
records which results survived a fresh chat, how Hermes handled a withdrawn measurement,
and where it still drew a conclusion its sources could not support.
