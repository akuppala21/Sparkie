# Native Hermes runtime boundary

Review of pinned Hermes v0.23.2, November 19, 2026. These are preparation settings,
not a deployed configuration or complete isolation qualification.

The gateway resolves `platform_toolsets.cli` for web chat, and the Telegram and
cron platform lists for their own sessions. The old top-level `toolsets` hint
alone did not establish that those three surfaces got the intended tools.
The template now gives them the same native capabilities and the Sparks tools.
`no_mcp` prevents an unrelated configured MCP server from joining implicitly.

One important native exception needs explicit handling: `browser_exec` runs the
model's Python through a subprocess on the gateway host. The Docker terminal
setting does not move that Python process into Docker. Upstream acknowledges
this in `model_tools.py:_rewrite_browser_exec`; execution is in
`tools/browser_use_cli.py:browser_exec` and `_run_cli_killing_process_group`.
The template uses the supported `agent.disabled_toolsets: [browser-use, ...]`
subtraction to remove that one tool. CDP and dialog tools remain selected, but
they still need a provisioned sandbox browser endpoint. Full browser automation
is not yet qualified. Re-enable the Python helper only after its actual process
cannot reach private fleet credentials, the operation socket or gateway state.

Native skills, memory, conversation retrieval, delegation and schedules remain.
Skill inline shell is explicitly off. Skill credential mounts are constrained by
Hermes to its profile home and master-store read guard; keep fleet credentials
and the private broker setup outside that home. The native Docker mount helper
mounts skill/cache inputs read-only. The configured terminal, Python execution
and file tools still use the maintained Docker environment.

Cron scripts are another host execution path. Native validation confines them
to existing `HERMES_HOME/scripts/` files; the scheduler does not run those scripts
through `terminal.backend`. Deployment must keep that directory empty or populated
only with operator-reviewed scripts, and never writable by a model sandbox. The
model can still schedule native agent tasks. Do not confuse a scheduled agent's
sandboxed tools with a host cron script.

Browser provider selection is pinned to local; its desktop placement is pinned
to the terminal backend. Voice transcription is explicitly local instead of
discovering cloud credentials. Search uses the maintained DDGS provider; keyless
provider fallback/rescue is off. The later [native research check](native-research.md)
proved original-source reads in the sandbox and recorded both a successful DDGS
search run and a failed one. It does not qualify transcription or default browser
startup. Hosted extraction is excluded, document OCR cannot discover a paid service,
and the separate native vision route is pinned locally instead of cloud discovery.

Cloud-capable image/video generation, speech output, X search and connection/
catalog enrollment tools are held out until their local setup or owner-approved
integration is qualified. No feature is reported working merely because its
upstream schema exists. The selected text model does not establish image/video
understanding; those require a qualified local specialist.

For heavy execution, Hermes has a native SSH environment and the supported
`register_terminal_environment_provider` extension. The native SSH environment
runs commands as its configured remote account; pointing it at the existing
Docker-capable owner account would grant broad host authority. Its v0.23.2 SSH
command also uses `StrictHostKeyChecking=accept-new`. A compute sandbox with
verified identity and scoped credentials is still required. Do not invent a
second agent loop to route builds; retain the native environment interface.

The initial five focused native configuration checks passed on Spark 4 in 1.04 seconds.
They exercise native platform resolution, local auxiliary routing, cloud-discovery
refusal and Docker configuration. The initial run retained a missing-model-manifest
fixture failure; copying the unchanged manifest fixed that setup. Receipts are
in `docs/review-astra/evidence/hermes-runtime-config-2026-11-19/` at repository root.
No live settings, real bot, credentials or hosted AI were changed or called.
The later research configuration and native read smoke passed 14 checks in 1.51
seconds, including local text/vision clients and search-only extraction refusal;
its receipts preserve the unsupported per-tool-exclusion failure as well.
