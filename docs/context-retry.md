# Asking before changing requested context

A context length is how many tokens the model can keep in one request. An out-of-memory repair must preserve a
length the owner explicitly requested, a context in a selected setup, or the effective model-owned setup. An
automatically chosen setup does not become an owner choice just because it has a setup ID. The model's advertised
maximum is not a request.

`start_model` and the page deploy routes accept `contextTokens` as a whole positive token count. The supported
engine flag is applied in memory; the saved model and setup are not rewritten. Recipe choices, stop approvals,
wake-first and download-first starts must preserve the request. A running copy or an in-flight start cannot satisfy
an explicit context merely by having the same model name.

When an automatic repair would shorten protected context, the failed operation first puts back its changes.
It releases its claims before publishing an owner-only question for a new operation. Unresolved cleanup or an
uncertain command end prevents an enabled retry. The failed operation stays failed and does not validate a workflow.
Its Activity row links to the owner chat with “Review retry”; opening the link approves nothing.

The proposed retry is a frozen private snapshot. It binds the model, effective setup, exact Sparks, context,
stop permissions and original retry budget. No environment values or retry token are exposed in public jobs.
The owner's one-use button goes through the normal action, workflow, planning, claim and execution paths. Changed
settings, expired decisions and a service restart invalidate the proposal. Normal extra stop/busy approvals still
apply. A page-only setup's permission to run model code never becomes permission for an agent or an ordinary chat
start.

An approved retry authorizes exactly the number shown. Another reduction requires another decision. All linked
attempts share the original three-attempt and 30-minute limit, including time spent waiting for the owner. The
originating task is parked while the question waits, including when an agent's request needs a separate owner chat.

Automatic settings retain ordinary bounded out-of-memory recovery and the 16,384-token floor. Rejected context
flags are never silently removed. Pure policy tests cover parsing, provenance, immutable proposals and retry limits;
integration tests cover actual launch, rollback and approval wiring. The lifecycle regressions exercise a private
choice expiring before its public button, restart invalidation, failed restoration withholding a question, and a
deadline crossed during image preparation before launch. Browser checks use a fixture API at desktop
and phone widths; they do not prove actual GPU memory behavior or real-brain interpretation.

The boundary regressions also cover shared-attempt exhaustion after a different automatic repair, named and verified
page-only setups, a numeric download-first request, and expiry between actual rank launches. They use the service
with stand-ins; wake-first and expiry during model copying remain separate evidence gaps.
