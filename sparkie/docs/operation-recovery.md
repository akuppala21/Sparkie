# Recorded operation recovery

The existing request card is the authoritative recovery view. `Controls.view`
returns a small `recovery` object alongside the operation state and existing
owner controls. The web request card, native Telegram request card, completion
notice and model result use the same disposition. This adds no model call,
background task, transcript feed or unsolicited message.

- `operation_terminal` describes the saved operation, not the current container,
  machine or memory. A separate observation cannot change the receipt.
- `retry_policy: keep_request` means the operation remains unresolved. Keep the
  same ID; Check result can observe and reconcile it without dispatching again.
- `retry_policy: review_required` means a failed, cancelled or expired request
  needs review before another attempt. It grants no permission or resource:
  a new request still passes the existing admission checks and exact owner
  confirmation. A failed service attempt can leave another service's hold intact.
- `retry_policy: no_retry` grants nothing. A succeeded operation needs no retry;
  a pending or approved operation follows its existing confirmation controls.

The store, claims, confirmations and dispatch paths are unchanged. Model results
still omit confirmation digests. Existing tool guidance bounds repeated checks;
the direct owner view does not depend on the model repeating that guidance.

## Chat replies after a check

On Hermes chat-completions turns tagged `cli` or `telegram`, the
model can pass `final_reply: true` to `spark_check_change` when the owner
only wants the checked results and their permitted next steps. A request
to repeat the original action, including a request for another stop, needs
that check before the assistant promises an action. An unresolved hold
also blocks an owner-requested repeat of that same change. A request that has already
succeeded needs no retry. A recorded failure requires a fresh review of
the workload. If another attempt is appropriate, prepare a new request
after checking resources, then ask the owner to confirm its exact ID before dispatch.
The tool middleware saves the broker's
actual response under the current profile, session, turn and native tool-call
ID. The chat-completions middleware can use those receipts to finish the
reply without another inference call. The owner sees the recorded state,
recovery advice and original request ID. Text in a transcript cannot supply
a receipt. This option has no confirmation or dispatch authority.

Every matching workload stop check returns a `stop_receipt` with the saved
ID, state, nullable `stopped` value and the recorded recovery advice. Only
a successful stop proves the exact workload was observed stopped. A failed
or unsent operation, an unknown result and a read-only check's dispatch flag
cannot establish that the workload was running. Those outcomes retain null.
An unavailable or mismatched ID yields no stop receipt.

For a single JSON receipt naming exactly `receipt_id`, `state`, `stopped`
and `next_step`, the model can pass `reply_format: "stop_receipt_json"`.
The middleware checks the owner's declared field list and the same-turn
tool result before returning that JSON. In the signed-in native Webapp,
use a standalone request such as `Check stop request <ID> as JSON with
receipt_id, state, stopped and next_step.` The gateway's authenticated
browser socket creates a `gui` session, whose agent uses the shared
`desktop` platform. The gateway can carry the checked receipt in its final
message even after the assistant streamed a preamble.

The Webapp shortcut requires the whole prompt to request that one receipt.
Additional questions, other field lists, explicit response schemas and
plain-text requests use ordinary model completion there. For a separate
current-state question or additional work the model should omit both reply
options. The standalone dashboard's terminal, its connection-status sidecar
and the OpenAI-compatible streaming API use different transports.

The model can invoke the known check directly through native Tool Search.
The recovery instructions call for a silent check before offering advice.
An opted-in final can complete the turn only when the latest check on every
ID found it held (uncertain or dispatching) or already succeeded. All other
states continue in ordinary Hermes chat. This lets it review current workload
state and prepare a legitimate new request for confirmation after a failure
when the owner asked it to do so. A new action, including stopping a workload
that restarted after a successful stop, also needs ordinary execution.

A prepared stop records the state seen at preparation. By the time a card
arrives, the owner may already have confirmed in another channel, or the
request may have expired. When the exact card still offers **Run it**, only
the signed-in web owner or paired Telegram owner can choose it. Sending
“go ahead” to the model cannot confirm a request. The paired owner can
retrieve the card with `/spark show <request ID>`.

For a mixed question, the model should omit `final_reply` and answer all
parts using the ordinary model path. The middleware checks that it has
receipts for the final tool batch and all explicit request IDs, and that
the turn used only supported request-reading tools. A mixed question that
needs no other tool still depends on the model choosing the option correctly.
Any prose streamed before the check stays visible, including premature
promises. The direct owner card remains available independently of that prose.

Hermes `ae2a81ccc00e9b7c06301523e5bb09608397149c` can omit a non-streamed
final reply from its OpenAI-compatible SSE stream after an earlier preamble.
The `api_server` platform and other unqualified platforms therefore use
ordinary model execution. The earlier comparison (private record)
and recovery correction record (private record)
record the observed owner replies and failures.

On the selected unflagged serving recipe with research skill 1.5, four of
six completed recovery questions passed. In one failed case the assistant
anticipated a second stop before checking, though the actual check kept the
original hold and dispatched nothing. In the other, it asked for owner
approval of a read-only workload-state check. That check requires no
confirmation. The seventh case was interrupted and positive follow-through
was unrun. The direct request card remains available without inference.
Selected serving recipe and full-stream evidence (private record)

An earlier strict-thinking development configuration with research skill 1.7
passed eight recovery questions, including a legitimate new stop drafted
for confirmation. Two checks reused identical receipts. The positive
follow-through took 149.821 seconds, including 94.971 seconds to the first
tool. These timings and answers belong to that development configuration.
Strict-thinking development results (private record)

Focused coverage is in `test_recovery_replies.py`, `test_proposal_reconciliation.py`, `test_native_controls.py`
and `test_notices.py`, including unknown outcomes, separate container observations,
resource holds, read-only reconciliation and channel parity. Run the existing
dashboard fixture and `tests/browser/controls.mjs` with
`SPARKIE_TEST_RECOVERY=1` for the additional desktop/phone workflow. Both must
receive that flag. It uses stand-in effects only. Compact local behavior and
applicable shared consumers remain required before qualifying a candidate.
