---
name: one-spark-serving-results
description: Use this fleet’s one-Spark measurements when recommending Qwen models, serving engines or recipes.
metadata:
  hermes:
    tags: [benchmarks, dgx-spark, qwen]
---

# Local Qwen serving results

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

Keep the raw outputs and checks in the owner's persistent project artifacts. After
reading them back, use native Hermes skill management to save a separate discoverable
measurement note with the checkpoint, date, conditions, result and durable receipt
location. Keep earlier observations when a new result differs. Confirm the note is
readable before reporting it saved. Release the test reservation and verify cleanup.
