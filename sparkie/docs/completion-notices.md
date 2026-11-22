# Completion notices

Long owner operations retain their original Telegram destination in the existing
operation database. The trusted initial `/spark` handler or native conversation
context binds it before approval. Viewing a web request through Telegram cannot
change its origin. Neither a model argument nor a card's later approver supplies
a destination.

The existing collector maintenance pass advances hardware work, then calls
`CompletionNotices.deliver`. Only operations previously observed in flight and
now recorded terminal are eligible. Synchronous results already returned by the
button do not receive another completion notice. Status text comes from the
same checked operation view used by the owner controls; uncertain hardware is
never called complete.

Delivery uses pinned Hermes v0.23.2's documented `hermes send --to
telegram:<chat> --file - --json`. This is deterministic and needs no model,
running second gateway or Telegram polling. The native sender receives only the
three required protected Telegram variables and fixed candidate/profile paths.
It refuses a profile `.env` that could override those settings. The owner
generation and original chat are checked again immediately before dispatch.

One notice disposition is recorded on the operation before invoking the CLI.
Concurrent maintenance passes share an OS lock. A process crash, timeout or
unverified transport result leaves delivery unknown and is never automatically
resent. A preflight refusal known to have started no sender may be checked again
on later maintenance. This is at-most-once dispatch of a notice, not a claim of
guaranteed exactly-once Telegram delivery. Hardware outcome and notice outcome
are separate; `/spark show <request ID>` retains the hardware result and explains
an unverified notice.

Protected controller configuration optionally supplies:

```json
{
  "notifications": {
    "home": "/var/lib/sparkie/hermes",
    "environment": "/etc/sparkie/owner.env",
    "python": "/opt/sparkie/releases/20261119-candidate2/hermes/.venv/bin/python",
    "source": "/opt/sparkie/releases/20261119-candidate2/hermes"
  }
}
```

These must be the same reviewed home, environment and source/interpreter as the
installation. The installation receipt hashes private configuration; the
candidate manifest hashes the native source and interpreter. Secrets do not
enter the operation ledger, code, prompts or evidence. Absence of this optional
configuration enables no sending. No live bot messages were used to qualify it.

The native cron delivery queue was inspected but is not used: it snapshots its
destination and can drain after owner revocation, with no supported generic
pre-send authorization hook in v0.23.2. Its durable local-chat completion notes
are internal cron facilities. Public `post_message` handles are session-bound
and process-local. Replacing the Telegram adapter or inventing a delivery
platform would add unnecessary integration.

The web exposes the same recorded operation through its authenticated Sparks
controls. Its bounded refresh reads status while a visible page has an in-flight
operation, and stops when results settle, the page is hidden or the wait expires.
It does not retry mutations or insert an unsolicited note into a native web
conversation. That transcript-note limitation remains explicit.

Focused tests cover origin binding, both owner transports, actual broker
consumers, terminal-state truthfulness, revocation, restart, ambiguous dispatch,
protected credential extraction and the real native CLI argument/stdin handler
with captured outbound transport. They run on a compute Spark; no paid API,
real Telegram send, model call or physical power action is part of these tests.

See the focused receipt and source hashes (private record).
