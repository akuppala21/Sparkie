# Testing research-heavy owner questions

The comparison used the same one-Spark Huihui model, SGLang + calibrated DFlash2, and Hermes v0.23.2. Research6 supplied the baseline. The experiment added a short instruction and a reader for public HTML manuals. The reader can download up to four originals from the sandbox, save full HTML and line-addressable text, and show a few matching passages with their source. The model still chooses how to research and what to answer.

The two questions ask for a deployable decision during a version upgrade. Python had repeatedly missed its deadline in earlier trials. SQLite was an unseen question with a rubric and original-document fingerprints frozen before the candidate answered. Each turn used a fresh native Hermes chat and empty workspace. The evaluator supplied only the question. Model requests were serialized on the same compute GPU with the prefix cache cleared between turns. The original deadline was 450 seconds plus a 30-second interrupt grace. A killed turn counts as incomplete. A result from one turn cannot establish a success rate.

The evaluation records four things separately.

- Did Sparkie deliver a usable answer within the time limit?
- Which originals did it actually open and which passages reached the model?
- Do its recommendation and its extra factual claims follow from those sources and the user's description?
- How long did the turn take, and how many model requests and tools did it use?

The reader smoke also checks the underlying files and excerpts against the publisher's originals. In the first attempt the fixture searched for “denial of service.” Both Python manuals spell the phrase “denial-of-service.” The literal search correctly found no match and the fixture failed. After correcting the spelling, both original pages passed. The interim reader passed 17 focused checks. The final reader passed 21, including regressions for an adjacent section with the opposite rule, excessive nesting, invalid page anchors and redaction of rejected credentials. The pinned Hermes sandbox reported curl 8.14.1. [Python 3.13 manual](https://docs.python.org/3.13/library/tarfile.html#hints-for-further-verification) · [Python 3.14 manual](https://docs.python.org/3.14/library/tarfile.html#hints-for-further-verification)

The experiment borrows two ideas from published work. Long documents can be harder for a model to use when relevant information sits in the middle. Showing a matching passage while retaining the original gives the assistant a short path to the relevant text and a way to check missing context. Citation evaluation distinguishes whether an answer supports its claims from whether it covers the question. These findings motivated the experiment. The paired turns measure what actually happened on this model. [Lost in the Middle](https://aclanthology.org/2024.tacl-1.9/) · [ALCE](https://aclanthology.org/2023.emnlp-main.398/) · [DeepResearch Bench](https://openreview.net/pdf/825cb7ecee1e417db9362f062cf98ef841a42fd5.pdf)
