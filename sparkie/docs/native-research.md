# Native research without cloud AI

The candidate uses Hermes v0.23.2's maintained DDGS search provider, native
Docker terminal and file tools. The upstream `ddgs` optional extra is required;
it was missing from the initial prepared environment. Install it through the
pinned upstream lock, not an independent latest-version dependency solve.

On Spark 4, native DDGS found relevant NVIDIA forum URLs and the original Alzeo
repository in about three seconds per query. A second fresh run returned
`No results found` for both queries. This is a real retained availability failure;
its cause has not been established. No paid or hosted AI fallback ran. Use known
original-source URLs when available and report unavailable search honestly.

The bundled NVIDIA forum reader normally fetches an individual post once. On
HTTP 500, 502, 503 or 504, it can recover the original Markdown from the same
public forum's topic view. It checks the topic ID, post number and author before
saving the body. A response asking the client to wait ends the attempt, as do
redirects, access denials and missing posts. The recovery adds one HTTP request
only on the eligible error path. Spark 2 verified both routes returned identical
native file reads for an opening post and a numbered reply.
Test receipts (private record)

Research skill 1.6.0 can read a public GitHub repository's README at a named
tag, branch or commit. Its bundled helper makes one anonymous GET to the GitHub
README API, verifies the size and Git blob hash, and saves the original bytes
in the native terminal workspace. The terminal reports the saved path, source
URL and immutable blob URL. Hermes opens the file with native `read_file`.
On Spark 2, one ordinary dashboard-agent session used exactly those two tools,
cited the v6.2.0 p-limit README and answered all three requested behavior
questions in 24.877 seconds.
Native answer and request receipts (private record)

For a public GitHub project whose owner and name are known, Hermes's bundled
GitHub skill documents the first-party repository search. On Spark 2, DDGS
found the relevant NVIDIA forum threads but returned no hits for the Alzeo
project. The public GitHub search resolved the project and its README through
the native sandbox without credentials. The operator selected that route in
this test. Search results (private record)

The development reader also preserves short repository descriptions from that
same search response. These help distinguish projects sharing a name without
fetching every README. It keeps the existing repository list and search
completeness fields, omits malformed optional descriptions, and visibly marks
truncation. Descriptions are author-supplied discovery cues; the original files
still supply the evidence for an answer. No additional network or model request
is required to return this metadata.
Change and checks (private record)

README reads now make one additional bounded, anonymous request to GitHub's
repository metadata endpoint. The result reports the requested repository's
current fork status and the parent/source names GitHub supplies. It preserves
the exact requested repository, ref and file; it never substitutes an upstream
file. A missing or malformed response leaves the verified file available and
marks provenance unknown or partial. Explicit `--path` reads still use one GET.
[Development validation and limits](source-validation-2026-11-23.md).
Repository metadata describes the current repository, even for a historical
file ref. A nonfork result does not establish authorship or prove that it is
the project the owner intended. The extra request uses GitHub's API allowance
and uses a 15-second socket timeout, rather than a total request deadline.
Reader checks (private record)
· Native research and exact-fork control (private record)

Both runs read the original forum and repository through native sandbox Chromium
and `browser_cdp`. The forum body contained the actual vLLM command, five MTP
speculative tokens, single-Spark setting and measurement conditions. The repository
body contained the uncensored SGLang/DFlash2 setup and explicitly attributed
published performance claims. These were page bodies, not search snippets or cached
model summaries. First-party Discourse JSON and raw README downloads also returned
HTTP 200 through native `terminal`; native `read_file` read the saved files.

The browser check used upstream `bot_desktop.runtime`,
`browser_session_sandbox.create_sandbox_session`, and the native live CDP endpoint
override. Chromium ran inside the configured disposable Docker sandbox. Its
startup/endpoint still needs composition in the normal application; merely
selecting `browser_cdp` does not provision a browser. Direct public JSON/Markdown
reads already need no browser startup. The unsafe host-Python `browser_exec`
remains disabled. No custom crawler or additional model call was added.

Hermes v0.23.2 has no implemented local `web_extract` provider. DDGS is search-only,
and the native extraction availability check is shared with search. Individual
tool names in `disabled_toolsets` are ignored. A tiny native named toolset in the
existing plugin therefore groups only `web_extract` for global subtraction; this
preserves all other native platform and coding-posture tools. The template also
pins `extract_backend: ddgs`, so direct extraction fails explicitly as search-only
instead of discovering a credentialed service if plugin loading fails.

Native document extraction has `file_tools.hosted_ocr: false`. Native vision uses
a separate cloud-discovery ladder from text auxiliary tasks, so its route is pinned
to the local endpoint as well. Vision is unavailable until a local specialist is
qualified; the selected text model is not claimed to understand images. A missing
local capability must not silently send an attachment to hosted AI.

The final focused configuration and native dashboard/tool smoke passed 14 checks
in 1.51 seconds on Spark 4. They cover five text auxiliary task routes, vision,
inherited hosted OCR refusal, extraction failure, all three native platform
selections and coding posture. These checks construct actual native clients and
resolve actual tools; they do not perform inference or establish full isolation.
The real source check took about 54 seconds including desktop startup/cleanup.
All its containers were removed. There was no live installation or bot access.

Receipts and the preserved failure are in
`hermes-native-research-2026-11-19` (private record).

For model qualification, use these original-source receipts to separate transport
availability from reasoning. The compact eval should check citations, attribution
of published versus fleet measurements, and consumer-parsed whole-response JSON.
Passing tool transport alone does not close the selected model's earlier research
and JSON failures.

The compact selected-model check subsequently reproduced Markdown-fenced JSON,
unusable citations and an optional-hardware misreading. The initial 319-word native skill,
[`local-recipe-review`](../skills/local-recipe-review/SKILL.md), improved both unchanged
cases to complete-response JSON with the exact required shape and usable citations.
It uses native `skills.auto_load`, with no second model loop or extra source read.
The baseline and a YAML-adapter fixture failure remain preserved. The two sampled
answers and timing limits are documented in the
behavior receipts (private record).
Research acceptance remains open despite those structural passes. The original
answer overstates the demonstrated TP=1 configuration as "constrained to a single
node." The explicit-consumer answer attaches the published throughput to a fixed
262,144 context length, although the excerpt supplies context capacity rather than
benchmark input lengths. These semantic failures are recorded in the receipts'
review addendum; neither raw answer was repaired and no further model tuning or
run followed that review. On-demand-only skill loading was not the inference condition tested.

The later finish batch (private record)
uses a generic source-quote clarification and the native configured generation
profile. Its ordinary prose comparison correctly separates capacity from unknown
benchmark lengths and avoids an invented winner. Native structured extraction
returns schema-valid JSON with verified local generation settings, but still has
a context-limit interpretation and does not explicitly state the unknown benchmark
lengths. Unrestricted chat JSON remains unqualified: a bounded 4,096-token answer
can be cut and joined by native continuation inside a JSON string. Machine consumers
must use the native structured lane and require validated output before acting.
Those focused results do not establish broad research reliability or release readiness.

## Two-excerpt experiment

The experiment read two prepared source excerpts through native `read_file`
with the active task ID. A scoped auxiliary completion then attempted to
return literal quotes with their source URLs and measurement conditions, using
`null` for unknown conditions. Focused tests verified the source boundary,
the local route and quote matching. A literal match verifies the wording in
the supplied excerpt. The applicability of a condition, comparability and
source provenance still require reasoning about the original source.

The first task-bound sample timed out twice. A dedicated native task then
preserved the requested 3,072-token cap on the selected local server. That
sample returned no parsed evidence and the agent fell back to direct reads.
The prepared candidate continues to use the native source-review skill and
tools. The experimental implementation and trial evidence are archived.
Two-source evidence experiment (private record)

## NVIDIA Developer Forum posts

The native `local-recipe-review` skill includes a terminal helper for public
NVIDIA Developer Forum links. It requests Discourse's first-party
`/posts/by_number/{topic_id}/{post_number}.json`, verifies both returned IDs,
and saves the returned `raw` Markdown with its author, post number and citation
URL in a fresh workspace file. Native `read_file` can then read each complete
post, including code blocks and benchmark tables. A topic URL without a post
number selects the opening post. The helper makes one bounded HTTPS request per
supplied link inside the existing terminal sandbox.

## Optional check for a prepared evidence sheet

The source checkout includes a developer utility for a prepared comparison of
saved original texts. The prepared baseline uses native skill version 1.5.0
and its original forum reader. Run the utility from the checkout when reviewing an
existing evidence sheet. It uses the Python standard library and requires no
network access or inference.

Pass saved original files in source-number order, with a JSON sheet on stdin:

```sh
python3 sparkie/tools/check_research_evidence.py --workspace ./originals \
  source-a.md source-b.md < claims.json
```

The sheet has a `claims` array and a `compare` array. Each row needs a 1-based
`source`, `kind` (`measured`, `configured` or `described`), the exact result
`quote`, and four condition fields named `nodes`, `workload`, `thinking` and
`protocol`. Use brief literal text from that same source for conditions and
JSON null for unknowns. Numeric rows include the exact `metric`, `unit` and
`value`. A decimal string represents a scalar. A pair of decimal strings in
ascending order, such as `["37","43"]`, represents an interval. Quote the
complete interval and unit together, as in `37–43 files/hour` or
`37 to 43 files/hour`. A quote-only row can still describe any type of range.

The checker requires a quote from every supplied original. It returns the
source citation line or workspace path with each row and checks literal quote
occurrence. For arithmetic, all declared conditions and the metric must appear
with the reading in one record at every occurrence of the quote. The utility
recognizes a single clause or a paragraph consisting of the quoted settings
followed by one metric row. A second distinct reading in the chosen record,
conditions found elsewhere in the document, missing conditions and unexplained
numeric text in the measurement record withhold the ratio. This conservative
check may withhold a usable result when an unrelated number remains. Older sheets that relied on scattered labels can still be read and
show the reason in `unmatched`. A human must still interpret the author's words.

`"compare":[[2,3]]` divides claim 2 by claim 3. Two supported scalars retain
the `left_divided_by_right` result. With intervals, the checker returns the
minimum and maximum endpoint ratios in `left_divided_by_right_range` and the
corresponding values of `100 × (ratio − 1)` in `relative_change_percent_range`.
A denominator that includes zero withholds both results. These are independent
endpoint bounds. Paired observations require their own pairwise comparisons.

The mandatory version was evaluated on the original forum task and a fresh
matched/unmatched comparison. The observed cost and failures are recorded in
the trial evidence (private record).

## Complete-source comparison trials

An experimental outline of literal section headings and table headers helped
the native agent locate both original forum posts. Skill 1.7 passed one
matched/unmatched control and contradicted a valid matched result in another.
It also claimed a speed advantage across different forum workloads and
misattributed a multi-node launch setting. Skill 1.8 changed how the final
answer grouped experiments and their limitations. The forum answer still
made both errors. Both trials used a test-only strict-thinking server with
a 4,096-token reasoning budget and no total output cap.

A separate, single local editorial call with the full draft and originals
repeated both errors. That prepared baseline retained the original 1.5
guidance. The source outline, experimental prompts and reviewer fixture
are archived. Answers, checked sources and restored hashes (private record)

The default, unflagged serving recipe reproduced the unmatched speed claim
with the restored skill. A separate native delegation trial let the dashboard
agent read one complete post and its worker read the other. Hermes delivered
the worker's summary and resumed the original owner session, whose final answer
still attributed a two-node launch setting to one node and overstated the
speed comparison. The prepared baseline excludes this experimental skill.
Ordinary baseline and source-worker trial (private record)

In a later probe, the model selected immutable record IDs and the source
reader preserved the table columns and section headings. This reproduced
all seven entries in one forum post's one-Spark column and withheld a
two-Spark column. It omitted a relevant boot passage and did not answer the
two-source owner question. A separate CPU comparison also missed a genuine
shared OCR measurement in naturally worded reports. These prototypes remain
outside the prepared product.
Source-record results (private record)

Subsequent synthesis from selected original passages still claimed a speed
advantage across different workloads. A separate comparison-planning request
invented a measurement condition. Neither was truncated. Disabling speculative
decoding did not fix source attribution in a matched single-source diagnostic;
the original non-abliterated NVFP4 Qwen also failed that same request. These
results do not establish speculative decoding or abliteration as the cause.

The larger cached Flash-Next T3 completed the full-source forum task in 125.937
seconds but retained unsupported comparisons and setup attribution. Three
unrelated worked examples in an isolated copy of the native skill failed the
same task in 397.599 seconds. That trial exceeded the 300-second criterion and
was not advanced to unrelated controls. That batch retained skill
1.5; none of these experiments adds a reviewer, worker or evidence gate to
ordinary research. Source transport is working, while reliable interpretation
of these complete posts remains unqualified.
Consolidated diagnostic results (private record)

The remaining original BF16 Qwen control also failed the byte-identical
single-source diagnostic. It preserved the seven one-Spark table cells but
attributed a HumanEval measurement explicitly made on two Sparks to one Spark,
along with latency measurements lacking an explicit machine count. The one
native request finished normally in 38.546 seconds. Independent review confirmed
the errors, and the isolated model was stopped with absence verified. Higher
precision did not resolve this case; there is no new qualified research profile
or promoted research change from this batch.
Final diagnostic and disposition (private record)

Because that structured diagnostic disabled thinking and tools, it does not
establish BF16 accuracy in ordinary research. A distinct native run therefore
used the unchanged full question, both original posts, skill 1.5, tools and
thinking-enabled sampling. Both full sources were read. The turn missed the
300-second target and produced no final answer by the 600-second observation
deadline; its process was killed after the 60-second cleanup grace. Its
full-answer accuracy is ungraded. The engine continued decoding within the
memory guard, and the test sandbox and model were verified absent afterward.
Neither BF16 path qualifies a replacement research profile.
Ordinary-path result (private record)

## Check two supplied reports

Paste the question and both source texts into the explicit Hermes command. Each
block starts with a title and a link on separate lines. The links identify the
sources as supplied by the caller. The command assesses only the pasted text.

```text
/checked-comparison Which option demonstrated the requested result?
Source: First report
URL: https://example.org/first
Paste the first report here.
Source: Second report
URL: https://example.org/second
Paste the second report here.
```

Hermes asks the selected local model which source demonstrates the full
requirement and which passages support each judgment. Sparkie checks that each
quoted passage occurs in its assigned text. It labels eligibility as the local
model’s assessment and displays both source links, quoted evidence and an
optional next test directly. Short
paragraphs retain their surrounding context. A quotation from a top-level Markdown
table includes its section headings, original column labels and alignment line.
Long tables show the selected rows in source order. When a heading or row is
separated by other source text, it appears in a separate quoted block. A
repeated table quotation that could refer to different positions, or a quoted
row with a different number of cells from its header, leaves the verdict
unresolved. The renderer escapes backticks in source fences and checks the
result with Hermes’s attachment parsers. A passage
that would send an attachment, an invalid quotation, or an unavailable local
model produces a message without a verdict. Ordinary chat makes no
automatic comparison request.

The command accepts up to 60,000 UTF-8 bytes. A quotation can be accurate while
its interpretation is wrong. A signed-in isolated Webapp exercised the multiline command over its
native WebSocket. The messaging handler was tested with synthetic Telegram events. The messaging gateway accepts
`/checked_comparison` and normalizes en and em dashes in command arguments.
Quotation matching on that path uses the normalized text.
