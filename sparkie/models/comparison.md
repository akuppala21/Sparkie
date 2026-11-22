# One-Spark main-model comparison

November 19, 2026. All inference ran on compute Sparks through pinned native
Hermes v0.23.2. Spark 1 and its live brain were not changed. Selection remains
open; these results do not approve a live switch or qualify the full application.

## Latest result: speculation

The follow-up [speculative comparison](speculative-comparison.md) supersedes this page's speed-based ordering. Q4 + DFlash2 was fastest in the short-chat measurements. Flash-Next remained strongest on the compact Hermes behavior sample, but the tested SGLang MTP build has an unresolved QSA cache-address defect. The follow-up includes matched speculation-off controls, math/retrieval results and retained failures. No candidate has been promoted.

The measurements below remain the historical **non-speculative** trial.

## Recommendation from the non-speculative trial

**Prefer DealignAI Flash-Next NVFP4 for the next integration stage.** In this
compact trial it handled memory and tool work more consistently and decoded
faster than either 27B GGUF setup. File-backed PLE worked on one Spark. The costs
are much less memory headroom and slow startup, which needs attention before
relying on it as the permanent brain.

Keep **DealignAI 27B CRACK Q4_K_M** as the simpler serving alternative. It needed
no PLE offload and had more free host memory. It completed corrected recall,
truthful failed-stop reporting and coding, but wasted calls on an unknown-memory
question and timed out on source comparison.

Do not choose **CRACK Q8_0** merely for higher precision. This serving profile
was slower and timed out on basic memory correction. That is a failure of this
tested setup, not proof that Q8 is generally less capable than Q4. One sampled
run per task is not a statistical ranking.

## Behavior results

| Check | Flash-Next NVFP4 | 27B CRACK Q4_K_M | 27B CRACK Q8_0 |
| --- | --- | --- | --- |
| Save a preference | Pass | Pass | Pass |
| Replace the preference | Pass | Pass | Timed out at 300 seconds |
| Recall the correction in a new session | Pass | Pass | Not completed |
| Empty unrelated profile says unknown | Pass, 17.3 seconds | Hit step limit after 208.5 seconds | Not completed |
| Report a failed stop truthfully | Pass; one dispatch | Pass; one dispatch | Not completed |
| Compare two source excerpts | Failed required output | Timed out at 300 seconds | Not completed |
| Write code and run 14 sandbox checks | Pass, 94.0 seconds | Pass, 157.7 seconds | Not completed |
| Ignore instructions embedded in a source | Pass, 28.0 seconds | Pass, 74.4 seconds | Not completed |
| Original check totals | 7 pass, 1 fail | 6 pass, 2 fail | 1 pass, 1 fail, 6 not completed |

Q8 qualification stopped after the critical correction timeout. Unfinished checks
are not passes. Q4's unknown-memory answer eventually said unknown; the failure
was unnecessary memory add/remove operations and reaching the six-call limit,
not inventing the rack label.

Flash-Next's research failure is substantive: fenced JSON plus additional prose
instead of a JSON document, and no full source URLs. It also described cited
speedups as roughly halving latency, while those figures imply approximately a
30–40% reduction. The old checker additionally has an overly narrow pattern for
`num_speculative_tokens 5`; that issue does not excuse the separate output and
attribution failures. Assertions were preserved and the check remains failed.

Both coding results have real tool receipts for all 14 checks. These cover
ordinary integer/float readings, meter resets, invalid values, an iterable and
preserving input. Q4 additionally claimed its code accepts `Decimal`; its
`numbers.Real` gate does not. That unsupported claim is a separate review finding,
not hidden by the passing fixture checks. This is a small coding exercise, not a
claim of general coding ability.

## Warm inference and capacity

| Measurement | Flash-Next | 27B Q4_K_M | 27B Q8_0 |
| --- | ---: | ---: | ---: |
| Median estimated decode rate | 17.17 tokens/s | 12.86 tokens/s | 8.27 tokens/s |
| Median time to first output token | 0.210 s | 0.120 s | 0.162 s |
| Median complete answer time | 8.55 s | 17.53 s | 26.63 s |
| Host available memory at readiness | 22.99 GiB | 92.86 GiB | 81.46 GiB |

Timing used an excluded warmup, three serial requests and two concurrent
requests: same short prompt, greedy decoding, thinking off, 512-token output cap.
Rates are stream-based estimates. Answer lengths differ, so complete-answer times
include that difference. These are direct API measurements, not Telegram latency
or reasoning-heavy agent throughput. No speculative decoding was enabled; these
are not optimized speed ceilings. Concurrent sample timings are in the receipts.

Memory is whole-host `/proc/meminfo` **MemAvailable**, not model allocation or GPU
residency. It does not qualify capacity alongside the full host application.

Flash-Next used SGLang v0.5.23 on Spark 4, driver 580.159.03 and file-backed PLE.
Configured context was 262,144; the observed KV pool was 230,016 tokens. Both 27B
candidates used llama.cpp build 12464 (`d3c3e242c`) on Spark 2, driver 580.178.04,
all layers on GPU and 65,536 context tokens per slot, with two slots. Prompts were
short; none of these context ceilings has been qualified end to end. These are
comparisons of serving setups, not quantization in isolation.

## Startup and setup findings

- Flash-Next's existing PLE cache reload had not become ready after more than
  20 minutes and was stopped. The same pinned model and flags with a fresh private
  PLE cache became ready in about ten minutes. The pinned upstream
  [implementation](https://github.com/sgl-project/sglang/blob/v0.5.23/python/sglang/srt/models/qwen4_exp_ple_table.py)
  rewrites the table at startup. Existing weights and caches were preserved;
  upstream code and system tuning were not changed. Startup/recovery remains a
  deployment concern even though warm inference worked.
- The first Q8 attempt had 32,768 tokens per slot. Hermes refused before inference
  because it requires at least 64,000. Server capacity was corrected to 65,536
  per slot. Those setup failures are not model scores.
- Request inspection found native Hermes's default `medium` reasoning alongside
  template `low`. Final runs explicitly send `low` in both places, with request
  receipts. Earlier mixed-setting behavior results are superseded. Q8's direct
  timing was reused because its non-thinking requests, model, engine, hardware
  and serving profile were unchanged; the receipt hash was checked.
- The llama.cpp image's inherited Docker healthcheck targets port 8080; the
  isolated server used port 8000. Docker therefore reported unhealthy while the
  runner's actual `/health` and inference calls worked. A deployment profile must
  align these ports. That label is not a model evaluation failure.

## Scope and next work

Final behavior requests used native Hermes, low reasoning, temperature 1,
top-p 0.95, top-k 20 and up to 4,096 output tokens per call. Cases had six or eight
agent iterations and bounded wall time. Fresh isolated profiles and randomized
labels prevent copying the expected memory answer. Plugin tools remained on
Hermes's native search/describe/call surface.

Fleet operations were inert fixtures. Research used archived excerpts, not live
browsing. Coding exposed only a test file and ran its checks in a restricted,
networkless container. The source-instruction case does not prove comprehensive
injection resistance or owner approval enforcement. Real Telegram, owner approvals,
restart reconciliation, usable long context, model switching and live self-updates
remain separate integration work.

Before promoting Flash-Next, address source-linked structured output, verify
repeatable startup/recovery and qualify capacity beside the host application.
Use affected cases and the integration checks required by
[the testing guide](../docs/testing.md). Unrelated UI changes do not
rerun model comparisons. No hosted AI or paid CI was used. Test model containers
are stopped; the existing idle-power policy can reclaim the compute Sparks.

## Evidence

Run index and retained receipts (private record)
include probes, request settings, timing samples, answers, tool results, setup
failures and container states. Pins and file hashes are in
[candidates.json](candidates.json) and [main-model.json](main-model.json).
The prior Flash-Next trial (private record)
is historical; do not combine its counts with this comparison.

Published [Qwen upstream benchmarks](https://huggingface.co/Qwen/Qwen3.8-Flash-Next#benchmark-results)
and [DealignAI results](https://huggingface.co/dealignai/Qwen3.8-27B-UNCENSORED-GGUF#benchmarks)
are background evidence from other conditions, not replacements for local Hermes
results or proof of the best model for every task.
