# Research accuracy on the local Huihui model

These are first attempts at individual owner questions using the same one-Spark Huihui model. Each ordinary turn used the native Hermes agent with its usual research and workspace tools. The structured comparison used the native schema and fixed excerpts. A normal chat, a structured answer and a test of a file reader measure different behaviors.

## Shorter general research instructions

| Owner question | Prior instructions (1.6) | Shorter trial instructions (1.9) |
| --- | --- | --- |
| What does p-queue 8.1.0 do on timeout, and does queue time count? | Got both requested facts right in 192.4 s. Added an unconditional claim that the underlying work keeps running. Its dependency can call a supplied cancellation method. | Got both facts right in 255.6 s. Inspected the implementation and reproduced the behavior with the requested package. The first experiment also timed out its slot holder. A corrected experiment controlled for that. |
| Can a release team recover an encrypted project within 20 minutes? | Never opened the three project records. Treated the destination software as a possible fleet node and missed its documented recovery route. | Read all three records and found the supported standby restore. Used an eight-minute unencrypted live replay to estimate a 32-minute encrypted standby restore. The duration and traffic-switch time are unknown. |
| Compare two published model-serving configurations | Correctly attributed reported rates to their configurations. Overstated a speedup and treated an incompatibility with YaRN as a general context limit. | Correctly scoped the YaRN limitation to that method. Inferred zero extra speculative-decoding memory from the absence of a separate draft model. The source gave no memory measurement. |
| How should a team extract customer archives during a Python 3.13 to 3.14 rollout? | Reached first-party documentation but gave no final answer within the 450-second deadline or 30-second grace period. | Read both release manuals and correctly recommended an explicit data filter and disk quota. Lost the factual pass by recommending fully trusted extraction for hypothetical older workers and overstating how absolute member names are handled. Finished in 245.1 s. |

The broader rewrite stayed out of the application. An original can settle a specific question and still be insufficient for a different claim in the same answer. The manual research rubric now covers both the context-extension and memory-overhead errors encountered here. The recovery fixture also checks that the assistant gives the supported procedure even when the requested deadline cannot be established.

The package and runtime conditions matter for the p-queue result. Its v8.1.0 implementation handles a timeout by resolving to `undefined` under the default settings. It starts the timer after the task is dequeued. Cancellation of underlying work depends on the supplied work and its timeout wrapper. [Tagged source](https://github.com/sindresorhus/p-queue/blob/v8.1.0/source/index.ts) · [Timeout dependency](https://github.com/sindresorhus/p-timeout/blob/v6.1.4/index.js)

## Reading a named file at the requested revision

Skill 1.6.1 used the new file reader in an ordinary version-specific question. It recovered from a missing path, located the tagged TypeScript source, and read the implementation and README. Its two requested answers were correct. It then repeated the unsupported claim that work always continues after a timeout. It completed in 178.1 seconds. The reader retrieved the relevant original and the assistant still overstated what that original established. [Publisher's file](https://github.com/sindresorhus/p-queue/blob/v8.1.0/source/index.ts)

Skill 1.6.2 asks for a short answer to each requested fact and evidence before adding a claim about another component or version. On the same p-queue question, it answered both parts correctly and made no unsupported cancellation claim. It read the tagged README through the helper and obtained the tagged implementation with the native terminal. It did not use the helper's new named-file option for that second read. It reached the final answer in 91.6 seconds over eight model requests, compared with 192.4 seconds for 1.6. This is a targeted regression result. One run per version does not establish a typical response time.

The two original instructions also handled some questions without a change. On the build-record control, both correctly withheld a cross-job comparison and calculated a measured within-job change from 180 to 126 seconds, a 30% reduction. On a simple arithmetic question, both returned the correct answer in one model request with zero research tools.
