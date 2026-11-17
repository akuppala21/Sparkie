# Telegram as an owner interface

Owner decision, 2026-11-17: the paired Telegram chat is the primary way Anurag uses Sparkie. It has the same owner controls as the page. The page is optional for ordinary administration. This replaces the earlier page-only Telegram policy in contract 4.10, 8.7, 8.13 and 8.17; it does not remove the confirmations those operations need.

## Smallest shared implementation

- One service, one action runner, one pending-choice store and one sender. The Telegram adapter carries the real `telegram` origin. It never claims to be the page or to have performed a passkey check.
- The update's private chat and user must match the current pairing. A proof made by the server is captured before any wait, copied into that request, and checked again when it acts. A channel name or user id supplied in arguments is not proof. Re-pairing invalidates old turns and buttons.
- The page's validated administration functions are shared with deterministic owner commands. They work when the brain is stopped. Neither an agent nor a model gets an arbitrary HTTP proxy or a way to manufacture owner confirmation.
- The complete confirmation is delivered before a Telegram button becomes usable. A partial send grants no authority. Long output is split into ordered messages. Telegram's own transport backoff still applies; a fourth approval is not a different permission.
- Existing action-specific checks remain: exact arguments and scripts, expiry, one use, dangerous-action digits, brain result seals, setup/build matches, image confirmation and fresh placement checks. The paired chat can use persistent allowances only for the same narrow operations as the page.
  Sensitive Telegram proposals retain owner-only markers, so answering from the page still uses its passkey gate.
- Ordinary workloads never start on Spark 1. Spark 1 never powers off. Root remains opt-in and asked; access changes on a Spark still use the existing put-back net.
- `/lock` invalidates outstanding Telegram approvals. Turning them on again needs a fresh owner confirmation; it does not revive old asks. An absent or revoked pairing cannot authenticate its own recovery.
- Creating a passkey still requires a real browser/authenticator ceremony. One-time agent keys or recovery codes must go directly to the verified owner, never through the model, saved chat, audit text or ordinary retries.

During restored-access review, the owner explicitly permits ordinary workload requests and confirmations on both interfaces. They do not lift the hold: sign-ins, agent access and new device approvals still wait. The corresponding old Telegram-only refusal test is revised under that specific approval.

## Browser sign-in

`/device CODE allow|deny` uses the existing pending device-code map. It creates no new store or listener.
The confirmation binds the private polling request as well as the displayed browser, source and expiry. Before
issuing a cookie, the service checks the pairing and owner again. A changed pairing, disabled approvals, expiry or
restored-access hold invalidates the grant. An exact denial remains possible under the hold and grants no access.
Terminals keep the page's passkey path. The browser's passkey registration ceremony is unchanged.

## Testing this change

Development checks run on compute Sparks. New tests cover the changed behavior and the security boundaries separately. A source change selects its nearby regression files plus shared checks. A release still requires the complete strict suite and browser check on the same tree before an installation lock is published.

Existing tests explicitly encode the superseded policy. They are not evidence of a product defect when they require
a Telegram-only restriction, and they cannot simply be removed from release qualification. On 2026-11-17 the owner
explicitly approved revising these obsolete policy assertions while preserving their security checks. The exception
covers policy changes, not weaker evidence for unrelated behavior:

| Existing test | Obsolete expectation | Must remain tested |
| --- | --- | --- |
| `telegram`, `memory-tg`, `memory-reads`, `recall` | Workflows, retired memory, erase, resume or update rollback wait for the page | Agent isolation, erased content stays erased, exact owner confirmation, stale pairing rejection |
| `tg-approve` | Fourth/hour, eleventh/day, long asks and unlock require the page | One use, expiry, restart, re-pairing, explicit lock, complete delivery |
| `danger` | Long commands and authority changes get no Telegram button | Complete exact bytes, digits, payload/script recheck, no replay |
| `brain-rail`, `trial` | No Telegram result-retention ask | Matching result, token, profile, setup, case set, build, seal and truthful provenance |
| `allowed`, `words`, `abilities`, `internet`, `pressed` | Page-only allowances, resume, account help and follow-up delivery | No broad/risky/root/net allowances; pause remains effective for automation |

The reviewed sleep/wake test correction is a separate exception already authorized by the owner. The owner also explicitly approved exact strong confirmation from the already paired Telegram chat for new webpage sign-ins; this does not remove browser passkey ceremonies or the HTTP route’s own confirmation checks. No existing assertion is weakened to hide an implementation failure.

## Scope boundaries

This change does not add microservices, a second administration backend, a generic scheduler or a new approval store. `/keep` after an incomplete network rollback remains a separate design decision; it is not silently included. The free-work download budget and hub disk floor remain open contract work. Passing these checks is not a claim that every contract item is finished.
