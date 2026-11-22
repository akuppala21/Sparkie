# Telegram and web conversations use native Hermes

The selected Hermes v0.23.2 already has a shared session authority, durable input
queue, streaming events, cancellation and restart recovery. Sparkie does not add
a conversation database, session bridge, duplicate chat loop or notification
scheduler. The Sparks extension owns fleet operation receipts only.

## Runtime wiring

- Run the gateway and dashboard with the **same fresh `HERMES_HOME` and pinned
  Hermes environment**. The native gateway owns the conversation, cached agent,
  input queue and saved history. A browser/TUI is a viewer of that conversation.
- Start the native Telegram gateway once, using protected setup for the real bot
  credential and exact owner allowlist. Development fixtures must never poll that
  bot. Keep the old bot consumer running until an approved cutover replaces it.
- The native dashboard Sessions page and Chat rail expose Telegram sessions.
  Resume the chosen conversation with its native `/chat?resume=<session-id>` link.
  It must resolve to the existing gateway session, rather than create a chat with
  copied messages. Reopening a completed conversation keeps its original identity.
- Use Hermes's authenticated `/api/ws` and its `session.resume`, `prompt.submit`,
  streaming and control methods. Native dashboard cookies/tickets and the native
  gateway's private discovery are credentials; a session ID alone is not one.
- Both surfaces use the same configured local model and native execution backend.
  Keep a stable sign-in configuration across restarts. Do not put a standing
  secret in a resume URL or invent a second authentication mechanism here.
- A native viewer disconnect is not a request to stop its conversation. Explicit
  cancellation stops or cancels the admitted work and publishes its actual state.
  Fleet operations that were already dispatched still need their separate result
  observation; cancelling a chat does not prove that a machine stopped.
- Route completion to the original messaging conversation through the native
  adapter. A web continuation of the Telegram conversation remains on that lane.
  Do not duplicate notifications through a second sender.

The gateway-owned HTTP listener can mount the native dashboard API directly
(`gateway/run_api.py`). The standalone dashboard is also native, with the TUI
using the canonical gateway client. The assembled launch must verify the chosen
route and the reverse proxy's HTTP/WebSocket behavior together. Merely pointing
two processes at the same database is not sufficient qualification.

## Focused qualification

The test selection in `tests/upstream-sessions.json` runs the maintained upstream
checks without copying their implementation. Run it in the pinned Hermes source
and locked environment on a compute Spark, with a disposable home and basetemp.
It belongs with Hermes-version, startup, authentication and session-routing
changes; an electricity-card edit does not need it.

The November 19 Spark 4 run passed **12 checks in 23.74 seconds**. It used real
Hermes gateway, agent, database, HTTP/WebSocket and control code. Only the model
HTTP responses and Telegram vendor transport were local stand-ins. It observed:

- A Telegram-origin message completes; an authenticated WebSocket resumes the
  same conversation and reuses the same warm `AIAgent`.
- The browser-side prompt streams `message.delta` and `message.complete`; its
  completion also reaches the captured Telegram adapter.
- Unauthenticated sockets and foreign/retired control identities are rejected.
- Inputs retain their committed source identity and queue order. Changing the
  original event object after acknowledgement does not change admitted work.
- Killing the disposable owner process preserves unknown execution as unknown,
  recovers safe queued work once, and does not run it again on a second restart.
- Cancellation settles observers once and a control can reach a waiting turn
  without getting stuck behind that turn in its input queue.

See the receipts (private record).
These are native transport and state checks. They do not qualify Huihui's answer
quality, the real Telegram bot, a phone browser, the final public sign-in setup,
or the assembled live runtime. Those remain acceptance checks at cutover.

## Pinned upstream interfaces

- [Native dashboard chat and resume](https://github.com/NousResearch/hermes-agent/blob/v0.23.2/website/docs/user-guide/features/web-dashboard.md)
- [Canonical gateway client](https://github.com/NousResearch/hermes-agent/blob/v0.23.2/hermes_cli/gateway_client.py)
- [Gateway HTTP/WebSocket listener](https://github.com/NousResearch/hermes-agent/blob/v0.23.2/gateway/run_api.py)
- [Native shared-session regression](https://github.com/NousResearch/hermes-agent/blob/v0.23.2/tests/gateway/test_session_authority.py)
