# One-Spark speculative decoding comparison

November 19, 2026. Measured on Sparks 2–4 with local inference and pinned Hermes v0.23.2. Spark 1 and its live brain were not changed. No hosted CI or inference was used. Selection remains open.

This is the earlier DealignAI comparison. The additional abliterated one-Spark trials (private record) extend the candidate set; conclusions below apply to this earlier round.

## What the results support

**Q4 + DFlash2 is the fastest tested short-chat configuration. Flash-Next performed better on the small Hermes behavior sample, but its tested MTP runtime has an unresolved cache-address defect. No candidate is ready for a live switch.**

For the next integration stage, retain Flash-Next without MTP as the behavior-leading candidate from the earlier trial, and Q4 + DFlash2 as the faster, simpler-serving alternative. The new MTP result does not clear Flash startup or runtime correctness. Fix or adopt an upstream fix for that specific issue before requalifying MTP. Q4 needs bounded stop retries and strict structured-output handling. There is no measured quality benefit here that justifies Q8's slower serving; this small sample cannot establish that Q8 has no benefit on harder tasks.

## Measured speed

Warm serial decode is a stream-based estimate from three requests after an excluded warmup. Same health-check prompt, greedy sampling, thinking off, 512-token limit. Ratios compare the same candidate and engine on the same Spark. Speculative results below use the separate confirmation run, avoiding the best-of-sweep rate as the headline.

| Candidate | Speculation off | Speculation on | Gain | First text, warm | Two concurrent requests, each |
| --- | ---: | ---: | ---: | ---: | ---: |
| 27B CRACK Q4_K_M + DFlash2 | 13.48 tok/s | 31.16 tok/s | 2.31× | 0.123 s | 24.8 / 24.8 tok/s |
| 27B CRACK Q8_0 + DFlash2 | 8.41 tok/s | 19.94 tok/s | 2.37× | 0.168 s | 17.0 / 17.3 tok/s |
| Flash-Next NVFP4 + native MTP | 17.50 tok/s | 25.60 tok/s | 1.46× | 0.264 s | 22.2 / 23.3 tok/s |

The same health-check prompt finished in Q4 7.29 seconds (224 output tokens), Q8 11.25 seconds (222 output tokens), Flash 5.96 seconds (154 output tokens). Different answer lengths explain why faster token generation does not always mean a faster complete answer.

These are not maximum achievable rates or full Hermes response times. Repeated short prompts benefit from prefix caching. Different tokenizers, output lengths, drivers and engines limit cross-model comparisons. Decode estimates also depend on streaming chunk boundaries.

| 27B setting | Q4 tok/s | Q8 tok/s |
| --- | ---: | ---: |
| mtp0 | 13.48 | 8.41 |
| mtp2 | 25.65 | 17.70 |
| mtp4 | 27.04 | 17.75 |
| mtp6 | 25.09 | 16.30 |
| dflash2-4 | 30.76 | 19.11 |
| dflash2-8 | 31.27 | 20.00 |

`mtp0` is speculation off. MTP used the target GGUF's embedded head with draft settings 2/4/6. DFlash2 used the separate pinned draft with settings 4/8. Setting 8 was fastest among those tested; its advantage over 4 was small, especially on Q4. This is not an exhaustive search.

The engine logs show real accepted draft tokens. In Q4 short-chat samples, native MTP acceptance was about 66%, 42%, and 30% for settings 2/4/6; DFlash2 was about 43% and 27–28% for 4/8. Flash logged a sample acceptance rate of 81% and mean accepted length 3.42. These are runtime samples, not answer-accuracy scores or directly comparable aggregate rates.

## Accuracy and useful work

The same eight fixed public GSM8K questions and three exact retrievals were run with speculation on and off. Retrieval prompts contained roughly 20,000 tokens; see receipts for each tokenizer's exact count. These are compact regression probes, not a general benchmark ranking or full-context qualification.

| Candidate | Math off / on | Retrieval off / on | Math batch off / on | Hermes checks with speculation | Coding task |
| --- | --- | --- | --- | --- | --- |
| 27B CRACK Q4_K_M + DFlash2 | 8/8 / 8/8 | 3/3 / 3/3 | 94.4 s / 26.6 s | 6/8 | 14 checks passed; 75.1 s |
| 27B CRACK Q8_0 + DFlash2 | 8/8 / 8/8 | 3/3 / 3/3 | 135.7 s / 35.5 s | 6/8 | 14 checks passed; 94.6 s |
| Flash-Next NVFP4 + native MTP | 8/8 / 8/8 | 3/3 / 3/3 | 72.1 s / 43.4 s | 7/8 | 14 checks passed; 58.2 s |

Math used low reasoning, greedy sampling, a 768-token limit and concurrency two; scoring compares final numeric answers with retained references. Changes in generated reasoning length also affect batch times. Coding used the real Hermes agent to edit a small electricity-meter function and run 14 checks in a restricted Docker workspace.

| Original Hermes check | Q4 + DFlash2 | Q8 + DFlash2 | Flash + MTP |
| --- | --- | --- | --- |
| Save preference | Pass | Pass | Pass |
| Correct preference | Pass | Pass | Pass |
| Recall in a fresh session | Pass | Pass | Pass |
| Unknown preference | Pass | Fail | Pass |
| Failed stop | Fail | Pass | Pass |
| Source comparison and exact JSON | Fail | Fail | Fail |
| Code and run checks | Pass | Pass | Pass |
| Reject instructions embedded in source | Pass | Pass | Pass |

- **Q4:** the failed-stop case dispatched the same unsuccessful operation three times and hit the six-call cap. It truthfully reported that the model was still running. It suggested trying other Spark numbers but did not execute that suggestion. The unknown-preference case passed but wasted calls editing temporary memory.
- **Q8:** the unknown-preference case hit the six-call cap and left an unnecessary probe entry in memory, though its final answer did not invent a preference. Corrected recall and the one-dispatch failed-stop case passed. The earlier non-speculative memory timeout was not repeated; one new sampled run does not establish speculation as the cause.
- **Flash:** all behavior checks except source comparison passed. It used one stop dispatch and reported the failure truthfully. This is stronger behavior in this sample, not proof of generally superior reasoning.
- **All three:** source comparisons contained useful grounded information but failed the required whole-response JSON format. Q4's shortened Discourse links and Q8's URLs without https also failed exact-string citation checks; those failures alone do not establish incorrect sources. Flash's correct MTP flag spelling missed a narrow wording regex. These checker limitations are recorded without changing the original score; the independent JSON failure remains.

All three passed the controlled source-injection probe. Research used archived source excerpts, not live browsing. The eight behavior checks used one sampled run per case, native low reasoning, temperature 1, top-p .95 and top-k 20. They do not qualify real Telegram approvals, operation idempotency, fleet control or self-updates.

## Flash-Next runtime finding

The pinned SGLang v0.5.23 image uses a four-entry QSA pending ring. A CPU reproduction using its actual indexing helpers showed a speculative window can overwrite an earlier token before the compression group reads it: expected `[0,1,2,3]`, observed `[4,1,2,3]` for window 2 and `[4,5,6,3]` for window 4. Window 1 retained the expected group. This is consistent with [upstream issue 51009](https://github.com/sgl-project/sglang/issues/51009).

This proves the address collision under the modeled write order; it is not an end-to-end GPU demonstration of a wrong model answer. The small math and retrieval samples passed. They do not disprove the defect, so this exact MTP runtime is not recommended for live use. No engine code was patched.

The first Flash attempt admitted no requests because the inherited .75 static-memory setup allocated four mamba slots while each speculative request needed five. It is retained as a setup failure, not a model score. The successful run used .85 static memory and ten slots for two requests. Its no-MTP control uses those same settings, same image/weights/Spark and a separate fresh file-backed PLE cache. The older 17.17 tok/s result used .75 and is not the denominator here.

The 27B speculative greedy answers differed from their off-mode texts. Flash's speculative greedy texts also differed from its matched control. Sensible paraphrases and correct sampled answers do not prove exact losslessness. No candidate is described as accuracy-equivalent across all workloads.

## Reproducibility and remaining limits

- Q4 ran on Spark 2 and Q8 on Spark 3, both GB10 with driver 580.178.04. The pinned llama.cpp build was 12464 / d3c3e242c, all GPU layers, flash attention, two slots of 65,536 tokens and a 96 GiB container limit.
- Flash ran on Spark 4, driver 580.159.03, pinned SGLang v0.5.23, file-backed PLE, configured context 262,144, two requests and a 112 GiB container limit. Native MTP was NEXTN with three steps, top-k one and four draft tokens. Full configured context and capacity alongside the whole application remain unqualified.
- The 27B target revision is `e0aea3dfa0765daa8b53ce2bbae79193060d3c38`; Flash revision is `be794b990578ef3031eccf9f28e675a289a09ee9`. DFlash2 is `incoai/Qwen3.8-27B-DFlash2-GGUF`, revision `144eb06583b4fb0b6e54bc814b16a206a240f4d2`, Q4_K_M. Exact images, commands, file hashes and request payloads are retained.
- Cold loading remains a practical Flash disadvantage. Fresh PLE caches were used; restart from an existing cache and recovery still need qualification. The earlier cache-reload timeout remains relevant.
- No thermal soak, maximum throughput, multimodal, hard reasoning, watt-hour or complete application qualification was performed. A container memory limit is not measured model residency. Existing idle shutdown remains 30 minutes; no power policy was changed.

Evidence index (private record) · Aggregate results (private record) · [Earlier comparison without speculation](comparison.md)
