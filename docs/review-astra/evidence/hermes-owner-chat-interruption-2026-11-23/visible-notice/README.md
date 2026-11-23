# Remote command warning in the default owner view

The follow-up trial showed **“The remote command may still be running. Check its workspace before repeating it.”** in the conversation with the command row collapsed. A desktop browser showed the entire notice 679 ms after Stop and a phone viewport showed it after 643 ms. Neither browser clicked a disclosure or scrolled. Both retained the notice after a full reload. The probe kept running inside its SSH sandbox and wrote its marker after 12 seconds. These are single observed timings from an isolated fixture. [Browser and process receipts](browser-results.json) · [Desktop immediately after Stop](desktop-after-stop.png) · [Phone immediately after Stop](phone-after-stop.png)

| Trial | Visible by default after Stop | Visible by default after reload | Native completion requests |
| --- | --- | --- | ---: |
| Desktop, Stop during command | Yes | Yes | 1 |
| Phone, Stop during command | Yes | Yes | 1 |
| Desktop, command finished with exit 0 | No warning | No warning | 2 |
| Desktop, command itself exited 130 | No warning | No warning | 2 |

The two normal commands printed a JSON-looking interruption envelope to stdout and displayed their actual numeric exit codes. The two stopped commands made a single request to the scripted responder to start the tool. Normal completions made their usual second request after the result. All four runs used zero inference. The process probe and screenshots used a disposable owner. The worker also ran a separately scheduled model experiment during part of the CPU fixture batch.

## Candidate distinction

Complete package `20261123-ownerstop1`, SHA-256 `a6730d4ed5b9108f19dc785a6a7098a3338e7fb3d02d305ff8741f7496ceaf1e`, already exposed the unknown outcome and allocated workspace ID in the expanded command. This separate experiment mounted one additional reviewed Python file into that package. Its patch digest is `b8abe081bd1f86c888e57fdfb8e3a876d49927e06568967965a60898be5d932b`. It reused the same Webapp assets. [Earlier complete-package proof](../active-terminal/README.md) · [Follow-up source and provenance](../../../../../sparkie/deploy/patches/hermes-remote-terminal-notice.json)

Hermes already creates an interrupted closing row when the last tool round returns. The additional patch displays a fixed warning there when the round contains an actual terminal call whose structured result says the remote outcome is unknown. It matches native call IDs, handles sibling results, and preserves existing partial assistant text. The actual session database retained the original provider-facing interrupt placeholder, while the display text contained the notice. A genuine workspace ID, command and call ID remain in the command details. The notice uses the ordinary chat transcript and adds no tool or provider call. [Source patch](../../../../../sparkie/deploy/patches/hermes-remote-terminal-notice.patch) · [Notice and replay tests](../../../../../sparkie/tests/test_remote_terminal_interrupt.py)

Ten terminal-result, resume and notice tests passed in 1.26 seconds. The selector regression also passed. The focused selector includes native shared-session, desktop/phone, compute and candidate checks for each Stop patch, and the standalone candidate builder selects the Stop regression together with the other native patch regressions. [Focused receipts](focused.json) · [Selector tests](../../../../../sparkie/tests/test_check_selection.py)

The browser fixture samples the complete notice's bounding rectangle without expanding a row. The collector checks the before-and-after phases, actual process start and delayed marker, native RPC count, persisted display and provider-facing text, and loopback responder counts. [Browser driver](browser.cjs) · [Evidence validator](collect.py)
