# Review of the security fixes (2026-11-11)

A Fable 5.2 reviewer read the fixes for the five high findings of the outside-attacker audit (`06-outside-attacker-report.md`, H1–H5) and the sign-in flood fix. It worked read-only. The fixes were then built on Opus 5.5.

| # | Finding | Severity | What was done |
|---|---|---|---|
| 1 | `undo_update` could be reached through Sparkie in two ways. An agent's `ask_sparkie` ran with `via: 'sparkie'` and no session, so the guard was skipped. A plain proposal button, once pressed, ran with `trusted: true`, which also switched the guard off. | high | The undo now runs as asked only for the owner on their tailnet: the page, the API, or Sparkie in the owner's own chat. It also runs when the owner presses an owner-only button on the page (`ctx.ownerConfirmed`, set in `runChoice`). Every other caller gets the owner-only button. Tests: the `ask_sparkie` path and `POST /actions/undo_update` from a signed-in device. The `ask_sparkie` test was checked against the old guard, which started the undo. |
| 2 | The 3-waiting check compared raw addresses while the rate limits group an IPv6 /64, so a flood could push out the owner's waiting code. | low/med | The check now groups by `addressKey`. When room is needed, the oldest code of the address with the most waiting codes goes. Tests: one /64 written four ways gets a 429 on the 4th code, and the owner's single code outlasts a continued flood. |
| 3 | The proxy refusal looked only at the first path segment, so `//proxy/` and `%2Fproxy/` got through. | low | It now checks the first non-empty segment. Tests cover both spellings. |
| 4 | The JWT and private-key patterns were still quadratic on crafted text. A secret straddling the audit's 1,000-character cut could stay partly visible. | low | The JWT pattern is bounded per segment. Private keys are found by searching forward, and a key cut off before its END is hidden to the end of the text. The audit masks 1,200 characters, then cuts to 1,000. Timing on 1 MB inputs: 229 ms worst case, down from minutes. |
| 5 | A tailnet-only key was refused on any request without a Tailscale login, including tagged tailnet devices. | low | It is now refused only on Funnel requests. |

The reviewer judged these sound: H1 (`passkeyAt` is set only by a verified passkey), H2 (error listeners on all three upgrade paths; only network errors are swallowed), H3 (door limit, audit cut), H5 (bearer keys are honoured only on `/mcp` and `/v1/`; old keys keep working; the toggle goes through the passkey) and the page toggle.

Known limit: the per-address map keeps 2,000 addresses, so a host cycling more /64s than that is never rate-limited. That costs it nothing it couldn't do anyway: passkey sign-in has no shared cap, and the owner's waiting code is the last to go.

Rule: `docs/architecture.md` R31.
