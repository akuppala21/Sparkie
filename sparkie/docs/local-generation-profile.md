# Native local generation profile

The candidate's `config/hermes.example.yaml` uses Hermes's supported named custom
provider `custom:sparkie-local`, pointing to the selected Huihui server on loopback.
Its `providers.sparkie-local.extra_body` carries the measured temperature 1.0,
top-p 0.95, top-k 20 and Qwen thinking template with low effort.
`agent.reasoning_effort: low` sets Hermes's native reasoning selection too; an
unset value would otherwise resolve to medium in this pinned release.

This is configuration consumed by upstream Hermes, not a new request middleware.
The named entry matters: the pinned resolver's bare `custom` route with an explicit
URL bypasses named-provider request extras. Hermes resolves the saved identity to
the `custom` wire provider and carries its extras through the gateway. The canonical
`custom:` prefix also makes native auxiliary calls outside an agent inherit the
saved endpoint extras. Local-only routing and empty fallback lists
remain in force. A model swap must replace its provider-specific generation
settings as well as its model identifier.

## Ordinary chat limits

The prepared dashboard's native WebSocket path constructs its agent through
`tui_gateway.agent_factory._make_agent`. The Telegram turn runner constructs
its agent through `gateway.session_execution`. Both pass the named provider's
request settings to `AIAgent` and omit a `max_tokens` argument. The candidate
also leaves the native iteration cap and `agent.run_budget_seconds` unset.
For the selected custom
chat-completions route, Hermes sends the ordinary initial request without a
`max_tokens` or `max_completion_tokens` field. Native recovery and auxiliary
tools can still set request-specific limits.

The pinned SGLang 0.5.22 image accepts both completion-cap fields. When both
are absent, the scheduler bounds generation by the configured 65,536-token
context, the tokenized input including prompt overhead, and available KV cache
capacity. Stop tokens can end a response earlier. A completion budget includes
generated reasoning and visible output. The native Telegram gateway's default
watchdog triggers after 1,800 seconds of inactivity and warns at 900 seconds.
These are inactivity thresholds. The native local stream-stall detector
defaults to 900 seconds, and the underlying loopback socket read timeout
defaults to 1,800 seconds.

The prior comparisons explicitly started research at 4,096 tokens per
completion. Native length recovery subsequently sent 8,192 and 16,384 in the
retained Huihui run. Those numbers are particular to the test harness and its
recovery requests. The experimental recipe-evidence tool demonstrated that
the pinned generic custom auxiliary route drops a facade `max_tokens` argument.
A plugin-owned auxiliary task delivered `max_completion_tokens: 3072` through
its own native `extra_body`, with a 120-second timeout per attempt. Hermes's
two default transient retries allow three attempts with short backoff for
repeated transport timeouts. That policy supplies per-attempt timeouts. A
hard wall cutoff for the experiment came from the isolated runner. The
prepared candidate does not register that task because the bounded model
sample returned no parsed evidence.

The focused check constructed both agents using the pinned native factories
and the candidate configuration on Spark 2. It captured both serialized
OpenAI-compatible payloads with an HTTP fixture. The server bounds were
checked in the actual selected SGLang image on Spark 2. The archived test
wire records show request limits for the harness. These checks used isolated
session state and did not open the installed owner's browser or Telegram.
See the retained research wire records (private record).
See the auxiliary request and timeout receipts (private record).

Copy `sparkie/SOUL.md` to the fresh native `HERMES_HOME/SOUL.md`. It gives the
assistant its contract-based identity, Spark 1 protection, authority boundary,
truthful operation interpretation and memory rules. Hermes loads it through its
normal identity path. The source-review skill remains native `skills.auto_load`.
Neither introduces another agent loop or a separate memory store.

For a machine-consumed extraction, use native
`ctx.llm.complete_structured(..., json_schema=...)`, with `jsonschema` installed,
and require a validated parsed value before the consumer acts. Preserve a failed
raw response; do not reinterpret prose as an authorized action. This is a direct
extraction call for the task, not an extra reviewer on ordinary answers. Generic
chat JSON compliance is a separate behavior and remains subject to its own strict
whole-response parser. Native `delegate_task.output_schema` also exists, with its
own bounded validation retry; that distinct path needs its own qualification.

Focused config checks exercise Hermes's actual named-provider, gateway and
auxiliary consumers. The compact model checks resolve those native settings and
capture only generation fields from actual HTTP requests; they do not log request
headers or credentials. The raw research prompts and archived source bodies are
unchanged, with semantic assessment separate from JSON success. See
the finish-batch receipts (private record)
for outcomes, observed delays and limitations. Two clients sharing one model do
not establish interactive priority or guarantee sub-ten-second answers.
