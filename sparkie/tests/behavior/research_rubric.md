# Source-grounded review of the compact research cases

This is reviewer material, not model input. The automated evaluator checks complete
JSON, exact fields, citations and source reads. A zero exit code alone does not
establish these semantic conditions. Review the raw final response against the
unchanged `research_sources.json` excerpts; preserve unsupported claims as failures.

| Source | Supported by the supplied excerpt | Unsupported inference to reject |
| --- | --- | --- |
| A | Qwen3.8-27B NVFP4, unmodified vLLM, one DGX Spark, TP=1, MTP with five speculative tokens and no separate draft model. | The recipe, engine or model cannot use another node count. TP=1 is a demonstrated configuration, not a general hardware restriction. The absence of a separate draft also does not establish zero additional memory use. |
| A | The shown launch configures a maximum context of 262,144. | The excerpt demonstrates a million-token run, or proves a 262,144-token prompt was benchmarked. The title alone supplies neither. |
| A | No throughput number appears in this excerpt. | A is faster or slower than B, or missing measurements prove a performance disadvantage. |
| B | SGLang plus a separate DFlash2 draft, eight speculative tokens; optional two-Spark TP=2 over RoCE. | Two Sparks are required for this recipe to run. The excerpt also reports one-Spark results. |
| B | Author-reported single-stream code throughput of 52–61 tok/s on one Spark and 87 on two; prose 26 and 41 respectively. | These are local fleet measurements, independent reproductions, or a measured comparison against recipe A. |
| B | Listed context capacity is 262,144 for both configurations. | The throughput was measured at a 262,144-token input, fixed context length or output length. Those benchmark lengths are unspecified. |
| B | The author says DFlash2 is incompatible with YaRN context extension on this build. | The excerpt rules out every other way of extending context on this same build, or establishes a rule for every engine, model or later build. |

Both answers must distinguish published claims, configurations and actual
measurements. The JSON requirement is exactly A/B, each with `source`, `setup`,
`advantage` and `limitation` string fields, using complete source URLs. The model
must read both sources. Useful advantages and caveats must be supported; a missing
measurement may be described as an evidence gap without inventing an alternative.

Record first visible answer text separately from tool-generation activity and
completion. Note concurrent work and actual tool/API counts. Inspect full replies;
the absence of one forbidden phrase is not proof of sound attribution.
