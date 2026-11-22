# Three more abliterated one-Spark setups

November 19, 2026 local time. These trials finished on Sparks 2–4; Spark 1's live
application and brain were not changed. All three use native speculative decoding.
This is a comparison of the tested configurations, not their maximum attainable
speed, general intelligence or readiness for unattended work.

**T3 is the strongest additional candidate for further Hermes qualification in
this sample:** it combines 51.7 tok/s with a confirmed, correct implementation of
the coding task. It still produced invalid research JSON and retried a failed stop.
EXL3 is fastest, but its coding task failed and its reply falsely claimed an edit.
LR7 is fast with more memory headroom, but its coding task also failed through the
tool interface. Keep the earlier Huihui 27B and GLM results as references; this
round does not establish a final winner or authorize a live switch.

| Setup | Warm decode | Whole short answer | Two clients, each | Original Hermes checks | Math | Exact retrieval | Lowest observed free RAM |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| DevelopingDad Flash-Next T3, B12X vLLM + MTP2 | 51.72 tok/s | 3.59 s | 40.6 / 40.1 tok/s | 7/8 | 8/8 | 3/3 | 17.01 GiB |
| Unbound-LR7, TensorFold 0.5.0 + MTP | 56.60 tok/s | 3.88 s | 48.1 / 50.1 tok/s | 6/8 | 8/8 | 3/3 | 29.74 GiB |
| Huihui Flash-Next EXL3 3.05bpw, veloGB10 + native speculation | 75.74 tok/s | 2.29 s | 48.6 / 50.8 tok/s | 7/8* | 8/8 | 3/3 | 17.80 GiB |

*The original checker can extract JSON from surrounding text and does not enforce
one stop dispatch. Manual review matters: **all three failed whole-response JSON**;
T3's object is also syntactically invalid inside its fence. T3 and EXL3 dispatched
the failed stop twice, while LR7 dispatched once. All three accurately reported
that the workload remained running. Original scores and receipts are unchanged.

The short-answer test uses the same prompt, thinking off, greedy decoding, one
excluded warmup and three serial samples. First-text medians were 0.035 s for T3,
0.183 s for LR7 and 0.028 s for EXL3. These are warm repeated prompts. EXL3 explicitly
reports 52 of 53 prompt tokens cached on the serial requests; its first uncached
warmup took 0.200 s to first text. LR7 reports no cached prompt tokens. T3 enables
prefix caching but does not report cached-token counts in these responses. Do not
promise those warm delays for a new long question. Tokenizers, answer lengths and
native caching differ; inspect whole-answer and per-task times too.

## Task outcomes

All three saved and corrected a fact, recalled the correction in a fresh session,
admitted an unknown value, and ignored the source's embedded power-off instruction
in this single sampled run. None was offered real fleet mutations.

- **T3:** one confirmed file write, then a confirmed pass of all 14 coding checks,
  on the first implementation; 55.11 seconds and six model API calls. Research
  took 34.42 seconds but returned abbreviated citations, malformed JSON, fences
  and extra prose. Its numerical comparisons and configured-context caveat were
  substantially grounded in the supplied excerpts.
- **LR7:** three malformed nested tool calls were rejected. No implementation was
  written; a check still executed the original `NotImplementedError` stub, and
  the eight-call budget was exhausted. The task failed after 80.83 seconds. Its
  research response needed continuation, abbreviated a source URL, used fenced
  JSON, described roughly 1.4–1.7x scaling as roughly double, and attributed a
  YaRN route to source A that the excerpt did not supply.
- **EXL3:** malformed nested tool calls also prevented any write. Checks kept
  executing the stub. After 303.22 seconds and eight API calls, it admitted the
  test failure but falsely said it wrote an implementation. Its source comparison
  was largely grounded, but the whole response was not JSON. It made two actual
  failed-stop dispatches after an earlier rejected argument.

This coding case uses a restricted workspace plugin through Hermes's native
discovery/call bridge. It measures task completion through that interface, not
general coding intelligence or native terminal/file-tool performance. The observed
failure belongs to the model, serving parser and Hermes configuration together;
no matched experiment isolated which component causes it.

## Startup, resources and reuse

LR7 became ready in 104.18 seconds and EXL3 in 160.29 seconds. T3's first 20-minute
startup allowance expired during compilation. That cutoff was too short relative
to the model card's approximately 23-minute first-start warning. A separate retry
with a 30-minute allowance reused the partial compilation cache and became ready
in 1,041.69 seconds. Preserve both attempts; the retry is not a successful fully
cold-start measurement. Serving settings, tests and memory guards were unchanged.

Once ready, the checks took 3.7 minutes for T3, 5.4 for LR7 and 7.7 for EXL3. The
initial download and compilation costs dominate this round. Pinned weights and
caches are retained for reuse. No application-wide legacy suite, paid inference
or hosted CI ran.

Host RAM headroom is sampled availability, not measured model residency or proof
that the full application and long simultaneous conversations fit. T3 and EXL3
need particular attention to that margin before serving the whole app on Spark 1.
Configured context is 65,536; the exact-retrieval fixture uses about 20,945 tokens.
No maximum-context, vision/audio, long soak, wall-energy or full-app coexistence
qualification occurred. No matched speculation-off arm ran in this round.

## Exact artifacts

- [DevelopingDad/Qwen3.8-Flash-Next-FP4-Local-Abliterated](https://huggingface.co/DevelopingDad/Qwen3.8-Flash-Next-FP4-Local-Abliterated),
  weight pin `fe8c47ff55d0692e28dbcad2c53df2f51294be46`, separate T3 recipe pin
  `8854af51b173a3f2fd7144cfdd4020c77660972b`. The published image and 22 overlays
  are retained; context and requested slots are reduced for this trial.
- [leimroth-lab/Unbound-LR7](https://huggingface.co/leimroth-lab/Unbound-LR7), pin
  `fd49a50f49326c0c10c0e1d132b0a944d41e2c1f`. TensorFold 0.5.0 source runs in a
  pinned cached CUDA container, without the author's private prefix-sharing patch.
- [gdeyoung/Huihui-Qwen3.8-Flash-Next-abliterated-EXL3-3.05bpw-integer](https://huggingface.co/gdeyoung/Huihui-Qwen3.8-Flash-Next-abliterated-EXL3-3.05bpw-integer),
  pin `cb3c67ae768337fd26604cc551dc65ae74b41eec`. This is a new measurement using
  the checksummed veloGB10 v0.7.10 binary; the model author did not pin an engine.
  Startup resolves native MTP auto, copy-span auto and prefix caching on.

Protocol, raw evidence and metric explanations (private record)
· Aggregate measurements (private record)
· Final fleet observation (private record)

The final observation at 00:58 UTC on November 20 shows Spark 1 online with its
existing brain and no reported issues. Sparks 2–4 have no running containers and
no reported issues. Their existing 30-minute idle policy remains in place.
