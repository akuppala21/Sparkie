# Abliterated models for a one-Spark Hermes brain

November 19, 2026. Every target below is abliterated and uses one Spark per instance.
Trials ran on compute Sparks; Spark 1's live application and brain were not changed.
Final selection remains open. The figures measure particular serving setups, not
each model's maximum speed or general intelligence.

The [subsequent T3, LR7 and Flash-Next EXL3 comparison](qwen-next-comparison.md)
is now complete. It measured 51.72, 56.60 and 75.74 tok/s respectively, with the
task failures and setup limits recorded separately. The results below remain the
earlier round's evidence.

## Measured candidates

Huihui Qwen 27B is the leading new completed candidate for further Hermes integration:
it combines useful speed, corrected memory recall, one-dispatch failure reporting
and ample memory headroom. It still fails the required whole-response JSON format
and adds an unsupported speed comparison in its source-analysis answer. It is not
ready for a live switch on this evidence alone.

| Target and serving setup | Warm decode | Original Hermes checks | Math | Exact retrieval |
| --- | ---: | ---: | ---: | ---: |
| Huihui Qwen3.8-27B NVFP4, SGLang + calibrated DFlash2 | 30.63 tok/s | 7/8 | 8/8 | 3/3 |
| GLM-4.7-Flash FP8, vLLM, speculation off | 42.79 tok/s | 4/8* | 4/8** | 1/3*** |
| DealignAI 27B CRACK Q4_K_M, llama.cpp + DFlash2, earlier round | 31.16 tok/s | 6/8 | 8/8 | 3/3 |
| DealignAI 27B CRACK Q8_0, llama.cpp + DFlash2, earlier round | 19.94 tok/s | 6/8 | 8/8 | 3/3 |
| DealignAI Flash-Next NVFP4, SGLang + MTP, earlier round | 25.60 tok/s | 7/8 | 8/8 | 3/3 |
| DeepSeek V4 Flash Vision Exp ablit EXL3, DSpark K5 | Startup blocked | Not run | Not run | Not run |

*GLM's stop reply is truthful and uses one dispatch; the original checker rejects
its wording. Manual review therefore passes that case, without changing the original
score. Its failed correction and stale fresh-session recall are real memory failures.
**Four math requests exhausted the 768-token reasoning budget without final answers.
***All three payloads were found, but two omitted the required `VALUE-` prefix.

A later focused GLM memory repeat (private record)
passed all four memory checks in three fresh runs at the original temperature and
three at a lower temperature. The initial failure remains valid, but is intermittent
in this small sample. No configuration defect or temperature-based fix was
established; the native memory components match the pinned upstream Hermes source.

Both new completed candidates implemented the electricity-meter function and passed
all 14 checks. Qwen took 50.09 seconds and passed on its first written solution;
GLM took 61.97 seconds, correcting its first implementation after a failed assertion.
Both ignored the embedded instruction to power off Spark 1 in the source fixture.

Qwen's short warm answer started in 0.197 seconds and finished in 6.37 seconds;
GLM's medians were 0.121 and 4.24 seconds. With two clients, Qwen measured 26.46/26.28
tok/s and GLM 38.35/38.35. These are direct inference timings, not full Hermes task
times. Startup took 200 and 288 seconds respectively; post-start checks took about
287 and 279 seconds. Their minimum observed host available memory was 51.95 and
41.51 GiB. This is host headroom, not measured model residency or proof that the
complete application fits alongside it.

GLM's exported index lacks prediction-head tensors despite a config field naming
one prediction layer. It was tested without speculation; enabling a flag alone
cannot supply those missing weights. Qwen uses the calibrated NVFP4 DFlash2 draft,
depth 16, SGLang 0.5.22 and 65,536 configured context. Exact target/draft revisions,
image digests and commands are in the receipts.

DeepSeek loaded its weights (runtime report: 100.08 GiB), then failed during mHC
kernel warmup. TileLang/TVM registration raised an `AttributeError` about `__dict__`,
after which vLLM reported the required kernel unavailable. A standalone TileLang
import in the same pinned image passed, so this is a failure during serving
initialization, not proof of a simply missing package. No inference request ran.
Minimum observed available host memory was 8.02 GiB; the 8 GiB guard did not trigger.
That narrow startup margin is another concern for hosting the whole application.
The published proxy uses `bad_words` token blocking to avoid known unwanted decode
tokens. Our attempted trial omitted those restrictions; their effect was not tested.
No package upgrade or kernel patch was attempted to force this configuration through.

The earlier DealignAI Flash MTP runtime has a reproduced QSA ring-address collision.
That CPU indexing reproduction is not an end-to-end GPU wrong-answer demonstration,
but it blocks recommending that exact runtime for live use. The earlier Q4 failed-stop
case dispatched three times; Q8 wasted memory calls. Keep those findings when comparing
their speed with Huihui. See the [earlier report](speculative-comparison.md).

## Additional Qwen recipes worth qualifying

These are published claims inspected during research. None of these additional
checkpoints was downloaded or benchmarked in this round.

| Exact checkpoint | One-Spark recipe and published result | Why it is interesting; remaining concern |
| --- | --- | --- |
| [DevelopingDad/Qwen3.8-Flash-Next-FP4-Local-Abliterated](https://huggingface.co/DevelopingDad/Qwen3.8-Flash-Next-FP4-Local-Abliterated/blob/8854af51b173a3f2fd7144cfdd4020c77660972b/recipes/single-spark-t3/README.md) | T3 vLLM/B12X, MTP2, disk-backed PLE: 50.04 tok/s prose, 60.21 code; medians of three suites. | First additional Flash-Next recipe to qualify. Pinned launcher and raw reference repeats; 104 GiB container cap. It has 22 overlay mounts and FP8 projection changes, so maintenance and numerical behavior need checking. The recipe revision differs from the weight revision. |
| [leimroth-lab/Unbound-LR7](https://huggingface.co/leimroth-lab/Unbound-LR7) | TensorFold CUDA 0.5.0, MLX-format weights, MTP and disk-backed PLE: 72.7 tok/s single stream. | Actual Hermes tool loops reported: 58/60 agent tasks, 24/24 tools, 22/24 multiturn; reliability 14/20. One of 32 source injections was obeyed. Vision unavailable in the tested CUDA runtime; some latency figures use a local patch. Newer TensorFold versions need separate qualification. |
| [gdeyoung/Huihui-Qwen3.8-Flash-Next-abliterated-EXL3-3.05bpw-integer](https://github.com/gdeyoung/qfn-abl-exl3) | Integer-pinned EXL3, MTP2 plus n-gram speculation: author reports about 65 tok/s and an 84 GB pack. | Promising memory/performance balance. Speed script makes six sequential mixed prose/code requests; five configured slots are not a five-client benchmark. No raw timing receipts; tool test checks emission rather than a complete round trip. |
| [DevelopingDad/Qwen3.8-27B-Uncensored-NVFP4-MSE-DGX-Spark](https://huggingface.co/DevelopingDad/Qwen3.8-27B-Uncensored-NVFP4-MSE-DGX-Spark) | Abliterated OrcaRouter parent, mixed NVFP4/FP8, calibrated DFlash2 depth 8: 34.821 tok/s at one client. | Smaller alternative with 1,200 published capability requests. Parent comparisons do not use a verified matched protocol, and no local Hermes result exists for this checkpoint. |

The [sxuff Huihui recipe](https://github.com/sxuff/qwen38-huihui-abliterated-dflash2-dgx-spark)
uses the same target as our completed Qwen run with a different runtime and draft.
Its 57.95 tok/s headline pools unlike tasks: prose is 21.55, code 66.82 and copying
about 71–72. It does not establish 58 tok/s ordinary chat. Other leads, including
Heretic, ARA, AEON and native-MTP variants, are retained with their limitations in
the [research catalog](abliterated-one-spark-research.json). RTX and Apple rates are
not used as Spark speed measurements.

## Limits and decision

The compact checks use the real pinned Hermes runtime with inert fleet operations,
one sampled behavior run, eight elementary math items and three exact retrievals.
Research cases read archived sources, not the live web. Configured context is not
qualified maximum context. No new speculation-off control, broad accuracy suite,
vision/audio trial, thermal soak, watt-hour comparison or complete application
coexistence/recovery qualification was run for these new candidates.

Use Huihui as the current measured reference. T3 and Unbound-LR7 are the strongest
additional research leads; their published results do not establish that either
is better on this fleet. Model selection and approval of a concrete live switch
remain separate from these experiments.

The final fleet observation at 22:16 UTC confirms Spark 1 online with `sparkie-main`
running and no reported issues. Sparks 2–4 have no running containers. Trial weights
and caches are retained, and the existing idle-power policy was not changed.

Raw evidence and interpretation (private record)
· Aggregate results (private record)
