# Checking that the research test can read its sources

The ordinary two-source trial reached its 285-second deadline without an answer. Its agent log showed that Hermes filtered out the file reader when the test's terminal backend was unavailable. Sparkie could list and open skills, but the model received neither source. That run measures a broken test setup.

The corrected evaluator checks the actual agent's exposed tool list and calls its registered reader on both complete archived excerpts before sending a model request. A role with no reader, an incomplete read or a truncated response fails setup. Those verification reads are kept separate from subsequent reads requested by the model. When the model requests a source, its returned line range and content hash are written to the trial directory immediately. A later timeout preserves that evidence.

On Spark 2, an independent interruption after a real dispatcher return preserved exactly one source-read record and no final answer. The enrolled fixture checked both source hashes before inference. The portable code passed all 13 selected Python checks in 2.29 seconds with native Hermes registration, and correctly listed the separate local-model evaluation as outstanding. These changes affect the evaluator only.

For the complete-source trial, the packaged reader independently retrieved NVIDIA forum posts 380244/1 and 380350/14 from the publisher in 0.418 and 0.438 seconds. Both citation URLs and post numbers matched. Downloading both again gave the same hashes. The documents contain different evidence from the short test excerpts. [Full-source grading criteria](full-source-criteria.md)
