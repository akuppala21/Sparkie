# Native text uploads and compute rereads

A small text upload already reached the agent inline. On the sealed energy baseline, however, its only file reference was relative to the gateway's profile. An actual `read_file` from the compute workspace returned “File not found.” Sealed attachment candidate `a5abe1534540c53d29d99cf41e656487e86f8babc6fb077a226f1037daa67903` also supplies the literal path for file tools. In independent phone and desktop uploads, the registered reader returned the one-line, 21-byte file from an SSH sandbox. [Native browser and tool observations](observations.json) · [Sealed candidate](package.json)

## Matched Webapp conversations

Chromium chose `exhibit-check.txt` through **Add context → Files** in a fresh native Webapp chat. Its contents were `EVIDENCE-MALLOW-7249` followed by a newline. The owner's question omitted that marker and included a reference to an existing synthetic file in another profile. The real upload endpoint returned HTTP 200. The native `file.attach` RPC received the staged-upload receipt, and `prompt.submit` carried the file reference. Only the gateway-expanded model input contained the file's contents.

| Observation | Energy baseline 134744d0 | Attachment candidate a5abe153 |
| --- | --- | --- |
| User's original file chip and inline text | Present | Present |
| File path supplied to the scripted completion endpoint | Relative `.hermes/attachments/…` | An additional `/home/sandbox/.hermes/attachments/…` path for file tools |
| Real `read_file` result using the path available in the prompt | File not found | `1\|EVIDENCE-MALLOW-7249`, 21 bytes |
| Other profile's file | Gateway refused expansion. Compute read failed. | Same two refusals. The private marker never reached the completion endpoint. |
| Candidate UI | Desktop control rendered | Separate 390×844 and 1280×850 conversations rendered with document widths of 390 and 1280 |

The scripted completion endpoint selected the supplied path and issued both direct tool calls. Hermes executed them in the same turn, through its packaged registry, private controller interface, `SparkComputeProvider`, pinned SSH and a separate non-root sandbox. The fixture allocator returned that one isolated container. Chromium, gateway, SSH, synchronization, reader, native tool results and final rendering were real. The loopback completion service made deterministic choices. This measures transport and path usability. It supplies no model reasoning score, live Telegram receipt, or cross-machine provisioning result. The original chip still uses the gateway reference. The additional path explicitly identifies the value to pass to file tools. [Browser driver](browser.cjs) · [Gateway and completion fixture](gateway_fixture.py) · [Portable Linux replay](run-browser.sh)

## Correction and access scope

The pinned native text formatter calls the same `_agent_visible_path` mapper already used for oversized text and binary attachments. After existing path admission, text extraction and file-size checks, it includes the tool path when the mapper returns a different location. The file name is JSON-quoted. The original reference, selected line range, fenced text and local-file formatting remain intact. The original access checks, cache synchronization and file tool continue to enforce their normal boundaries. No transfer service or new file-reading capability was added. The actual candidate builder verifies the patch, original module and resulting module against their reviewed SHA-256 hashes. [Six-file diff against the energy predecessor](attachment-only.diff) · [Pinned native module hashes](upstream-sha256.txt) · [Native source and patch provenance](package.json)

An earlier comparison on experimental candidate `2b459344` independently demonstrated that the exact same uploaded bytes already existed at the sandbox's mapped location. Passing the gateway's relative reference failed. Passing the mapped path returned the same content from a process running as UID 12001. That helped identify the missing path in the small-file prompt. The matching release comparison above used `134744d0` for its baseline and no application overlays. [Earlier and matched observations](observations.json)

## Telegram

The earlier experimental package received real python-telegram-bot Update objects generated from synthetic private-chat payloads. Its Telegram file-download boundary supplied the fixture bytes. The pinned native handler checked an explicit synthetic sender allowlist and passed the admitted event to a recording callback.

- A normal 20-byte UTF-8 text document reached the event as inline text, preserved the owner's caption and produced an identical cached document.
- A slash-command caption, a 102,401-byte document and invalid UTF-8 each preserved the caption and matching cached bytes with the inline flag false. The cache inventory mapped each to the sandbox's documents directory.
- An unlisted sender produced zero downloads and zero dispatched events. No real bot polled, no live account was paired, and the Telegram cases did not exercise an actual remote reread.

These results apply to the pinned Telegram adapter on the identified earlier artifact. The Webapp correction changes a different upstream module. [Five Telegram observations](observations.json) · [Adapter fixture](telegram_fixture.py)

## Checks and retained attempts

The sealed candidate was assembled in 10.68 seconds from `134744d03fec47a3041e8e6455a2b12c4ee85278dc7213661806dbd71431d58c`. Candidate verification found 261 extension files. Six source entries differ from its predecessor. The selector incorporated all six paths, including the package builder, and chose 64 Python modules. Those modules ran on the actual seal with **952 tests and five subtests passed**, zero failures and zero skips in 134.32 seconds. The 117-test development subset ran separately. Both reported one Starlette deprecation warning. Three pinned upstream reference modules passed all 51 tests in 1.52 seconds. The first upstream run omitted its async plugin, so 15 async cases could not execute and 36 passed. The corrected run explicitly loaded the cached plugin. [Full selection, test counts and smoke receipts](checks.json)

A fresh protected home loaded the packaged skills and `spark_compute` as service UID 1000. The native gate returned 401 without authentication, 403 for the wrong digest, 200 with one inert dispatch for the exact digest and 403 on replay. The smoke also verified the fleet tool, Telegram handler registration and memory guard.

An early browser fixture called the directly exposed reader through the deferred wrapper and received the wrapper's refusal. The matched rerun called `read_file` directly. An early standalone reader comparison shadowed its synthetic SSH public key and failed before creating an environment. The corrected fixture kept its key and path separate. One early teardown repeated synchronization during interpreter exit. Normal Hermes cleanup removed the environment and the rerun completed without that warning. The first two fixture launch files were removed after the corresponding containers retired. The final checks found zero fixture containers and zero one-use launch files. The independent compact local-model run on this same seal failed its lost-acknowledgement memory check. It reported the correct operation ID and outcome, but wrote `Placeholder` to native memory and failed to remove it. That failure blocks overall qualification independently of the upload results.

## Distributable source and independent answer review

The affected Python selection ran on Spark 2 using the distributable development source and the pinned attachment runtime. The first run passed 953 tests plus five subtests in 102.35 seconds. Two fixture-dependent cases failed. One needed an executable temporary directory to test a copied build tool. The other needed a machine ID for an isolated installation plan. Providing both prerequisites in the disposable container and replaying exactly those two cases produced two passes in 0.05 seconds. Both runs had zero skips. The original reports and rerun are recorded separately. [Selection, timings and report hashes](portable-checks.json)

The real local-model run took 201.63 seconds. Eight of nine automated cases passed. The lost-acknowledgement case stored an unrelated memory entry. Independent reading also failed the research answer for attributing native million-token capacity to a title, inferring zero extra VRAM from the absence of a separate draft model, and extending a build-specific YaRN limitation to other methods. The JSON shape and citations passed their mechanical checks. Release qualification remains open. [Per-case outcomes and exact research answer](portable-checks.json)
