# Four blind owner questions on the local Hermes research agent

**Keep the incumbent research skill (1.6).** The proposed 1.7 skill read and quoted both benchmark records, then recommended publishing a 70% improvement those records could not establish. The incumbent correctly withheld that figure and reported the separate, supported 30% reduction.

The evaluator froze the questions, two synthetic workspaces and grading criteria before seeing the proposed wording. Each question went once to each version through ordinary Hermes with the same local Huihui 27B model, serving settings and tools. Each turn had a fresh workspace and a flushed model prefix cache. Only the research skill changed between arms. The questions supplied no source URLs or instructions to look things up.

| Owner question | Incumbent 1.6 | Trial 1.7 |
| --- | --- | --- |
| What does p-queue 8.1.0 do on timeout, and does queue wait count? | Both requested answers correct. Introduced an incorrect claim that a dependency was pinned to exactly 6.1.2. | Both requested answers correct. Introduced an overly broad claim that a timed-out task keeps running unless the caller supplies a signal. |
| How much faster is Quartz at cold full rebuilds, and what percentage did its own export time fall? | Correctly withheld the cross-build figure. Quartz's timed export went from 180 to 126 seconds, a 54-second or 30% reduction. | Calculated the 30% correctly. Despite identifying the incompatible workloads, recommended comparing Quartz's 126-second warm incremental export with Rowan's 420-second cold full rebuild to publish a 70% approximation. |
| Which p99 belongs in the release closeout for the 24 KiB profile? | Correctly left it pending. Read the decision log withdrawing 14.8 ms and confirmed the accepted 18.6 ms belonged to 8 KiB. | Reached the same correct disposition from the same three workspace records. |
| What is 37 minus 18? | Answered 19 directly with no tools. | Answered 19 directly with no tools. |

The publisher's tagged implementation supports both requested timeout answers. Under the defaults, the returned promise fulfills with `undefined` when the running operation times out. Waiting for a queue slot does not use the operation's timeout. Both versions actually read the release sources. The dependency range is `^6.1.2`. A compatible implementation calls a supplied promise's `cancel()` method when present. These details explain the two distinct errors in the additional advice. [Tagged queue source](https://github.com/sindresorhus/p-queue/blob/v8.1.0/source/index.ts#L290-L314) · [Published dependency range](https://github.com/sindresorhus/p-queue/blob/v8.1.0/package.json) · [Cancellation implementation](https://github.com/sindresorhus/p-timeout/blob/v6.1.2/index.js#L83-L85)

| Question | First visible text, 1.6 / 1.7 | Final answer, 1.6 / 1.7 | Local model requests, 1.6 / 1.7 |
| --- | ---: | ---: | ---: |
| Version-specific timeout | 56.94 / 64.81 s | 234.66 / 165.86 s | 12 / 11 |
| Incompatible benchmarks | 11.01 / 184.36 s | 119.91 / 198.65 s | 7 / 6 |
| Withdrawn evidence | 49.42 / 35.90 s | 56.67 / 133.00 s | 6 / 6 |
| Known arithmetic | 6.11 / 8.34 s | 6.28 / 8.39 s | 1 / 1 |

The trial added 217 input tokens on the no-tool arithmetic turn. It completed the version lookup sooner and took longer on the other three questions. The trial's arithmetic turn ran first after model startup. With one sample per question and arm, these times describe the observed turns only.

Neither arm invoked the native grounded-citations capability, wrote a native memory or skill, or deliberately saved a reusable evidence record. The version lookups downloaded temporary source files and Hermes updated its normal skill-use bookkeeping. Both arms took unnecessary detours into a fleet measurement skill on the synthetic benchmark and release questions. All eight turns completed and their isolated sandboxes were released.
