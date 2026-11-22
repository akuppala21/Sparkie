---
name: one-spark-serving-results
description: Use local serving results for Qwen recommendations and run requested llama.cpp prompt-cache measurements in an allocated workspace.
metadata:
  hermes:
    tags: [benchmarks, dgx-spark, qwen]
---

# Local serving measurements

## Compare prompt caching on an allocated llama.cpp server

Read the project's allocation for the loopback origin and model. When the owner
requests a greedy comparison with one warmup and three timings per setting,
invoke this reviewed client directly as the first and only completion client.
Substitute the allocated origin, existing project, exact prompt and output cap.

```sh
python3 ~/.hermes/skills/one-spark-serving-results/scripts/measure_cache.py --url "$origin" --project "$project" --prompt "$prompt" --tokens "$cap"
```

It checks readiness and the response schema using the requested warmup. A
separate completion probe adds an extra request. The client rereads all eight
raw receipts, compares the completions and calculates both medians. Read its
returned `receipt` once to confirm the result. Report both `median_wall_ms`
values and the receipt path. For cache reuse, state the engine's counts from
`timed_input_tokens`: how many input tokens were reused, processed and total.
If a count is absent, report only the available fields. If an attempt fails or
already exists, inspect its receipts before any new measurement.

When the owner asks for fresh-chat recall, keep the numbers in the project
receipt. Use the native `memory` tool to save one sentence with the project
name and receipt path. Supply the arguments in this shape:

```json
{"target":"memory","operations":[{"action":"add","content":"PROJECT measurement: read RECEIPT for the recorded result."}]}
```

Check the tool's reply for an applied write. Finish the owner answer now. If the
write failed, give the verified project path and say that the recall pointer
could not be saved. In a later chat, open the project receipt and check for
corrections before quoting it.

## Local Qwen serving results

For serving recommendations on this fleet, consult matching local results first. These records are from November 22, 2026. Give the measurements for the checkpoint asked about. Each observation is a median of three serial direct API requests after one warmup. All used the same short prompts, temperature zero, thinking off and a 384-token output cap. All scored responses passed their own task checks. Each code response passed seven executable checks.

## Stock recipes on Spark 4

Both stock recipes ran on the same physical GB10. vLLM served Unsloth Qwen3.8-27B-NVFP4 with five integrated MTP draft tokens. SGLang served RadixArk Qwen3.8-27B-NVFP4 with a separate z-lab DFlash2 draft and eight draft tokens. The engines, target packs, templates, drafts and serving settings all differed. Which individual change caused the observed gap is unknown. One request was active throughout.

| Prompt and cache policy | vLLM wall (s) | SGLang wall (s) | vLLM decode (tok/s) | SGLang decode (tok/s) |
| --- | ---: | ---: | ---: | ---: |
| Bakery chat, warm repeat | 0.9489 | 0.7107 | 33.92 | 44.06 |
| Python interval merge, warm repeat | 3.5282 | 1.8405 | 33.49 | 63.61 |
| Compare two short reports, warm repeat | 3.6771 | 2.1674 | 25.04 | 46.32 |
| Bakery chat, cleared prefix cache | 0.8443 | 0.6552 | 33.62 | 43.77 |
| Python interval merge, cleared prefix cache | 3.4564 | 1.7113 | 33.11 | 67.23 |
| Compare two short reports, cleared prefix cache | 3.6117 | 2.4750 | 24.72 | 36.05 |

SGLang finished each of these stock-recipe workloads sooner. Both engines acknowledged the cache resets before the cleared-prefix measurements. Startup was outside the timer.

## The selected Huihui checkpoint on Spark 2

The actual selected checkpoint, edp1096/Huihui-RadixArk-Qwen3.8-27B-abliterated-NVFP4, ran separately on Spark 2 with the pinned SGLang and calibrated DFlash2 recipe and 16 draft tokens. Here are Huihui's own warm measurements.

| Prompt | Wall time to complete (s) | First generated text (s) | Decode (tok/s) | Output tokens |
| --- | ---: | ---: | ---: | ---: |
| Bakery chat | 0.6837 | 0.1808 | 47.76 | 25 |
| Python interval merge | 2.1889 | 0.1736 | 83.89 | 170 |
| Compare two short reports | 2.0000 | 0.1832 | 46.82 | 86 |

For Huihui, SGLang was the only engine measured. Its vLLM time, which engine wins with that checkpoint, and the size or even direction of that possible gap are unknown. A matched Huihui run on both engines would answer that question. Use its direct measurements when the question concerns these three prompts. Ordinary Hermes conversation has different inputs and can include reasoning, source reads and tool calls. Its end-to-end latency requires a timed Hermes conversation.

The evidence directory in the Spark Console repo is `docs/review-astra/evidence/hermes-research-optimization-2026-11-22/engines/`. Its `measured-summary.json`, `cold/measured-summary.json` and `huihui/measured-summary.json` hold timings and ranges. Those summaries give the per-workload medians and ranges. For questions limited to an author's publication, use that publication as the source.

## When the owner asks for a new measurement

Check the native skills catalog for later fleet measurements for the same checkpoint,
revision and workload. A request for advice alone does not start an experiment.
If the owner asks to test a gap, use an available compute Spark through the checked
workspace and workload tools. Verify the reservation, model revision, serving recipe
and responding endpoint first. Report the missing prerequisite if any is unavailable.

Use the same physical Spark, prompt, output cap, sampling, concurrency and cache
policy for both recipes. Use the existing serving benchmark or the engine's maintained
client. Run one warmup and three serial timed requests per arm. Verify answer quality
for the actual task. Record the median wall time, first text and decode rate when
available, along with failures and the exact settings that differed. If only one
arm worked, report its results and leave the cross-engine question open.

Keep raw outputs and checks in the owner's persistent project. Preserve earlier
observations when a new result differs. For requested recall, save the brief
native memory pointer described above. Release any test reservation you started
and verify cleanup.
