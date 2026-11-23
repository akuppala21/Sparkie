# Stop during an active remote command

**An owner can stop the agent response while its foreground SSH command continues running.** In the original package the reloaded Webapp displayed `exit 130` and the saved tool result said `[Command interrupted]`. An independent observer saw the same remote PID and process-start time still active 11.81 seconds into the command. Its marker appeared at 12.12 seconds. The owner had already pressed Stop by 0.50 seconds. [Physical process and Webapp observations](browser-results.json)

Sealed candidate **20261123-ownerstop1**, manifest `a6730d4ed5b9108f19dc785a6a7098a3338e7fb3d02d305ff8741f7496ceaf1e`, reports that observed situation correctly. A fresh browser run against the complete package used its installed files without overrides. The owner clicked the native Stop button, the server recorded an unknown remote outcome with a null exit code, and the remote command wrote its marker at 12.26 seconds. The restored, collapsed chat showed **Response stopped**. Opening the command displayed **“Stopped waiting for the remote command. It may still be running. Check the workspace before repeating it.”** followed by the same workspace ID issued by the allocator. This candidate requires opening the command to see that warning. [Complete-package observation in the first row](browser-results.json)

| Webapp run | Marker appeared | Exit displayed after expanding the command | Stop warning visible after expansion |
| --- | --- | --- | --- |
| Original package, desktop Stop | Yes | 130 | No |
| Candidate patch, desktop and phone Stop | Yes, both | No numeric exit | Yes, both |
| Complete candidate package, desktop Stop | Yes | No numeric exit | Yes |
| Candidate patch, normal exits 0, 7 and 130 | Yes, all three | 0, 7 and 130 respectively | No |

The three normally completed commands printed a JSON-looking interruption envelope to stdout. They retained their observed exit codes and ordinary execution status. The replay regression separately supplied the same structured top-level envelope as the output of an unrelated file tool and verified that its history survived. The candidate recognizes the new status only for the actual terminal call. Replaying a genuinely interrupted terminal preserves the original command, its call ID, the workspace ID and the warning to inspect the effect before retrying. A foreground SSH command has no native tracked-job ID. [Regression tests](../../../../../sparkie/tests/test_remote_terminal_interrupt.py) · [Reviewed patch and file hashes](../../../../../sparkie/deploy/patches/hermes-remote-terminal-interrupt.json)

## What ran

Each Chromium run used a fresh synthetic owner and the genuine native Stop RPC. Unauthenticated session requests received 401. A deterministic loopback responder requested a 12-second foreground command from the registered `spark_compute` tool. A private allocator supplied the enrolled test endpoint. Native OpenSSH ran the command in a separate non-root, network-isolated sandbox. Docker hosted the sandbox and independently observed its PID, process start ticks and final marker. The command's own environment confirmed the SSH connection in all six candidate runs. The fixtures used zero model calls. The run removed each fixture container and one-use launch link. [Browser actions](browser.cjs) · [Process observer](observe.py) · [Synthetic command](probe.py) · [Gateway and provider fixture](gateway_fixture.py)

A direct metadata-only check found the active dashboard on release `20261119-candidate1`, with `spark_compute` configured. Eight source files matched the unmodified experiment package byte-for-byte, including the native SSH transport, foreground wait, terminal finalizer and Spark provider. The experiment exercised physical Stop only on the disposable compute worker. No live owner turn was submitted or service updated. [Installation identity](installation.json)

The candidate uses the trusted executor interruption flag. It preserves redacted partial output, distinguishes the SSH wait outcome from a remote exit and skips command-verification evidence and killed-command telemetry for that unobserved remote result. The sealed builder verifies the patch and the before/after hashes of all four native files. The existing Webapp rendered the new result on desktop and phone. [Packaged patch](../../../../../sparkie/deploy/patches/hermes-remote-terminal-interrupt.patch) · [Desktop](desktop-reload.png) · [Phone](phone-reload.png)

The focused source and native gateway checks passed 21 tests in 2.42 seconds on one worker CPU. A synthetic private Telegram update passed the native sender allowlist, entered each actual active-turn Stop handler, and reached the native inline reply send boundary. Both paths requested one interrupt and returned **“Agent response stopped. If a remote command was running, check its workspace before repeating it. You can continue this session.”** The unlisted sender reached no handler. The fixture supplied the active session and recorded the interrupt and outbound send. Telegram vendor delivery and translations beyond English remain unverified. An earlier attempt stopped during test configuration because its upstream test cache targeted a read-only path. The completed run used the container's private temporary filesystem. [Telegram and test receipt](channels.json) · [Adapter fixture](telegram_check.py)

The earlier deadline incident interrupted the evaluator's attached Docker client. This experiment pressed the actual owner Stop button while SSH was running. The two incidents have distinct trigger and transport paths. [Deadline incident](../../hermes-native-dev-repair-2026-11-23/terminal-deadline/README.md)

## Reproduction

Run the fixture on an isolated Linux compute worker with the sealed package and pinned local images available. `STOP_CASE=stop` uses the native Stop button. `STOP_CASE=normal` waits for the terminal result, and `PROBE_EXIT` sets the known command exit. Specify a new absolute result directory for every arm. For a complete package leave `PATCHED_NATIVE` unset. A patch-discrimination run may point it to the four reviewed files produced by `prepare.sh`. The earlier baseline used the same process observer and command timing with no spoofed output or SSH-environment annotation.

```sh
STOP_CASE=stop UPLOAD_VIEWPORT=desktop PROBE_EXIT=0 \
  bash run-browser.sh "$SEALED_PACKAGE_OPT" "$RELEASE" "$MANIFEST_SHA" "$NEW_OUTPUT"
```

[Browser launcher](run-browser.sh) · [Patch verification](prepare.sh) · [Offline regression launcher](checks.sh) · [Sanitized result validator](collect.py)
