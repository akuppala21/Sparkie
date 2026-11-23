# What the owner can recover from a stopped native Webapp chat

**An owner can recover a completed tool round after stopping the chat.** At 390 × 844 and 1280 × 850 the assistant’s intermediate interpretation remained visible after Stop and after a full page reload. Expanding the corresponding **Ran cat /tmp/interrupt-proof.txt** row showed the actual output and exit status. The chat displayed **Response stopped**. No completed final answer was generated. [Phone evidence](phone.json) · [Desktop evidence](desktop.json)

| Owner view | Intermediate interpretation | Raw terminal evidence |
| --- | --- | --- |
| Live chat, while the next completion was waiting | Visible by default | Appeared when the owner expanded the finished command |
| Immediately after clicking Stop | Visible beside the interruption status | The command row returned to its collapsed state |
| After a full page reload | Visible beside **Response stopped** | Expanding the command restored its exact stdout and exit code |

[Phone after reload](phone-reload.png) · [Desktop after reload](desktop-reload.png) · [Phone live](phone-live.png) · [Desktop live](desktop-live.png) · [Phone stopped](phone-stopped.png) · [Desktop stopped](desktop-stopped.png)

## What happened

1. A fresh Chromium profile used a one-use launch link to enter a disposable native Webapp. Before sign-in the genuine session-list endpoint returned HTTP 401, and a credential-free browser WebSocket failed to open. Only the isolated container network could reach the gateway.
2. A deterministic loopback completion asked the native terminal to read a synthetic file in a separate non-root SSH sandbox. The user’s text and the command contained no result marker. The actual output was `RAW-EVIDENCE-KITE-5807` followed by `beta=7`, with terminal exit 0.
3. After receiving those bytes, the scripted assistant wrote “The recorded checker result is seven for beta.” in the same message as its next tool call. The second command, `true`, completed. The third completion was held before it produced an answer.
4. The owner clicked the native stop button. Both browser runs sent one `session.interrupt` RPC. After reload, the transcript still showed the explanation, both command rows and the stop status. The underlying `state.db` contained the owner prompt, the two assistant messages with tool calls, both matching terminal results and the native interruption notice. Each browser recorded three successful authenticated session-message reads containing both the interim interpretation and the raw evidence marker.

The two visible strings test different claims. The interpretation first appeared in a tool-calling assistant message. The raw evidence marker appeared only in native terminal output. Both can be recovered from an owner chat even when the assistant never composes a final answer. The same native mechanism would expose a previously written interim answer in an equivalent owner session. The earlier research harness ran outside the browser and ended under a process deadline, so its saved interim text alone does not establish delivery to an actual owner. A question-specific runbook or conclusion still has to be written by the assistant.

## Why the owner can recover it

The pinned Hermes tool executor flushes the assistant’s tool call and its result to the session database during a turn. The native stop path interrupts the running session. The browser reads the stored transcript through the session-messages API, reconnects tool results to calls and renders the stopped state and terminal disclosure. The sealed source digests match the inspected v0.23.2 files at commit `ae2a81ccc00e9b7c06301523e5bb09608397149c`. [Native persistence](https://github.com/NousResearch/hermes-agent/blob/ae2a81ccc00e9b7c06301523e5bb09608397149c/agent/tool_executor.py#L204) · [Stop RPC implementation](https://github.com/NousResearch/hermes-agent/blob/ae2a81ccc00e9b7c06301523e5bb09608397149c/tui_gateway/session_lifecycle.py#L850) · [Stored transcript API](https://github.com/NousResearch/hermes-agent/blob/ae2a81ccc00e9b7c06301523e5bb09608397149c/hermes_cli/web_routers/sessions.py#L746) · [Browser hydration](https://github.com/NousResearch/hermes-agent/blob/ae2a81ccc00e9b7c06301523e5bb09608397149c/apps/desktop/src/lib/chat-messages/hydration.ts#L506) · [Sealed digests](sealed-upstream-sha256.txt)

## Reproduction and scope

The sealed application manifest was `a5abe1534540c53d29d99cf41e656487e86f8babc6fb077a226f1037daa67903`, release `20261123-attachment1`. Each run used fresh credentials, profile, browser storage and a network-isolated sandbox. The native gateway, owner chat, WebSocket, real registered terminal, SSH execution, session database, browser refresh and disclosure controls ran unchanged. The completion choices and synthetic file were controlled inputs. The experiment used zero GPU inference. No tool evidence or credentials were taken from a real owner.

With the sealed package and the three pinned local images available on the assigned Linux compute machine, run `run-browser.sh PACKAGE_OPT 20261123-attachment1 MANIFEST_SHA NEW_RESULT_DIRECTORY` twice. Set `UPLOAD_VIEWPORT=phone` for `phone-final` and `UPLOAD_VIEWPORT=desktop` for `desktop-final`. Then run `python3 collect.py RESULT_PARENT REPORT_DIRECTORY` to validate and extract the observations. [Launcher](run-browser.sh) · [Gateway and scripted completion](gateway_fixture.py) · [Browser actions](browser.cjs) · [Receipt checks](collect.py)

An exploratory desktop run also recovered the transcript after reload. A low-disk notification from the 512 MiB temporary filesystem interfered with its first attempt to open the live tool disclosure. The final independent runs set the disposable profile’s native auto-prune preference to false, which suppresses that prompt. Their live and reloaded disclosure checks passed. The final host check found zero trial browser, sandbox or gateway containers and both one-use link files removed.

The tested interruption was an owner cancellation after two completed tool rounds. Abrupt gateway termination, a tool interrupted before it returns, and streaming text that never became a persisted assistant message remain outside this result. The native owner path already supports the tested recovery, so this investigation produced no application change.
