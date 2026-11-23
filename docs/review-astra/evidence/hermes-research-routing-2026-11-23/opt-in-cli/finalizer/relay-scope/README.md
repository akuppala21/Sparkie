# Native Relay iteration-summary control

The public NeMo Relay 0.11.0 component interface can switch off the selected local checkpoint's thinking template for an iteration-limit summary. In six native Hermes SDK dispatches over three frozen histories, every ordinary finalizer request matched its sealed body. Each opt-in body differed in exactly two nested booleans, `chat_template_kwargs.enable_thinking` and `chat_template_kwargs.thinking`. Both changed from true to false. The top-level and template reasoning efforts remained `low`. The original owner questions, messages, tool schemas, sampling parameters and provider-default output limits matched across each pair. The selected provider received zero requests. [Complete-body comparisons and scope controls](receipts.json)

| Frozen question | Historical rounds | Stock body SHA-256 prefix | Opt-in body SHA-256 prefix |
| --- | ---: | --- | --- |
| jq batch output | 3 | `4646a7f5d58d` | `febb1d9ff619` |
| Serial GNU xargs | 4 | `2862de5a4511` | `81c9d3414fdf` |
| Existing Python worker | 1 | `edd30d549265` | `bdaaf2cb1202` |

The restored native session entered the real exhausted-budget fallback inside an active Hermes Relay turn. The opt-in process registered the component through `nemo_relay.plugin.register` and the Hermes component TOML. Its request interceptor checks the OpenAI chat-completions channel, served model name, active logical scope and Hermes's `iteration_summary` role. The adapter carries the role in public scope metadata. The harness independently checks the selected custom provider, loopback route and model, then checks the complete prepared SDK body before transport. The component itself sees the channel and model alias. The actual destination check belongs to the harness. [Component](scope_plugin.py) · [Opt-in configuration](component.toml) · [Native dispatch](replay.py)

Each paired CPU arm intercepted one SDK request. Each blocked four incidental socket attempts during profile startup and allowed zero connections. A second test used the same restored agent for ordinary primary dispatch, the native summary, the actual title-generation auxiliary client and another primary dispatch. The ordinary and auxiliary requests all carried the original thinking settings and the same complete body hash in both processes. The final agent reasoning configuration stayed enabled at low effort. Those controls exercised the native dispatch paths with a fixed synthetic user message. They supplied a deterministic HTTP response. [Control driver](controls.py) · [Wire hashes](receipts.json)

The pinned target's Jinja template, rendered on CPU with one synthetic question, opened a thinking block in the stock arm. With the switch off, it emitted a preclosed block and omitted the low-effort thinking instruction. Answer quality, model compliance, token use and elapsed generation time require actual paired inference. [Template check](template_check.py) · [Rendered suffixes](template.json)

## Replay and blind grading

On the established compute host, set `SPARKIE_REPLAY_SOURCE` to the existing sealed experiment directory containing `sealed-python`, `release-path` and `finalizer-preflight/frozen`. Set `SPARKIE_REPLAY_MACHINE_ID` to the independently recorded identity of that host. Give each command a fresh absolute output path.

```sh
bash paired.sh dry "$NEW_PAIR_OUTPUT"
bash run-controls.sh "$NEW_CONTROL_OUTPUT"
python3 collect.py "$NEW_PAIR_OUTPUT" "$NEW_CONTROL_OUTPUT"
```

The dry batch also exercised blind-packet creation. A future, separately admitted operator run uses `bash paired.sh leased "$NEW_PAIR_OUTPUT" "$CURRENT_LEASE_IDENTITY_JSON" "$LEASE_DEADLINE_EPOCH"`. The wrapper requires an exclusive experiment lock, checks remaining wall time, flushes the cache for each arm, and checks idle state after each dispatch. The driver checks the current container against the identity receipt, the sealed original launch arguments and mounted model paths. Each arm has the same 100-second limit and ten-second termination grace. Only one validated provider send can occur per arm. The selected request body supplies the same provider-default token budget on both sides. The harness does not execute tools returned by the summary. This leased mode was prepared and remains unexecuted for this experiment. [Paired wrapper](paired.sh) · [Blind packet](blind.py)

The two conditions alternate which goes first across the three cases. A fresh random A/B assignment per question hides arm identity from the grader. Grade only the visible text and completion against the original cutoff rubric, with the key withheld until grading is complete. jq must flag the wrong option in both NUL tests. GNU xargs must give both ordered label sequences and statuses. The Python answer must leave the existing worker's TLS unknown and identify an observation inside that process. Missing visible answers receive no completion credit. Historical reference grades remain in the original disposition. [Previous answers and cutoff outcomes](../../../../hermes-ambiguity-2026-11-23/public/memory-and-command-trials.json)

The files in this directory contain experiment code, synthetic template suffixes, and allowlisted counts, booleans and request digests. The compute host retains the full frozen prompts, session databases, native logs, private assignment keys, owner-path inputs and machine and lease identity files.
