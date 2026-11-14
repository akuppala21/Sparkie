# Spark Console security report (2026-11-11)

Eight lenses gave 51 findings, merged here into 33; none is unverified, five were narrowed by their verifier ("partly"). Code reading only.

## 1. Verdict

A stranger with no credential cannot get in: passkey sign-in, device codes, Tailscale's identity headers and the cross-site checks were all attacked and held. A stranger can probably crash the console repeatedly (a refused WebSocket upgrade; a timing race, not run live), and about 100 addresses can block every new sign-in from the internet. The worst finding: a stolen browser sign-in cookie alone opens VS Code, a shell as you on every Spark, with no passkey, which undoes every passkey gate; and any leaked agent key, look-only included, can freeze the console with one request. Leaving Funnel on for the few days "Fix now" takes is tolerable; to close it meanwhile run `bash deploy/open-to-internet.sh --undo` (Tailscale keeps working).

## 2. Fix now

Paths are under `service/src/` unless said.

| # | Who | What they get | Where | Smallest fix | Owner by hand? |
|---|---|---|---|---|---|
| H1 | Holder of a stolen browser session cookie (session-1, stepup-1, gateway-2) | code-server terminal as the owner on each Spark; can rewrite passkeys.json, agents.json, authorized_keys, so sign-out no longer removes them | 24-handler.mjs:119-126 (editor branch, before passkeyGate at :129); 21-editor.mjs:81-83; 22-passkey.mjs:98-99 | When `viewer.session` is set, refuse `/connect` in both places unless that session was passkey-confirmed in the last few hours. Tailnet unchanged | No. Owner checks whether code-server has its own password |
| H2 | Anyone on the internet (race, not shown live); a program on Spark 2 via 127.0.0.1:8810 (nologin-1, gateway-6) | Process exits; restarts 3 s later with jobs, claims, buttons and sign-in codes lost; repeatable | 21-editor.mjs:76 (no error listener until :94); 25-backup-and-start.mjs:39-41, :80 | First line of all three upgrade handlers: `socket.on('error', () => socket.destroy())`; deny ends, then destroys; log, not exit, on uncaughtException | No |
| H3 | Any agent key, from the internet (keys-1) | One 1 MB `tools/call` freezes the single thread about 18 minutes (1.7 s at 40,000 characters, measured) | 20-mcp.mjs:126-127 (masks before the 1,000 cut), :147, :238-243 | Cut to 1,000 characters, then mask; mcpDoor reads at most 64 KB; mask only a string's first 20,000 characters | No |
| H4 | Can-change agent key from the internet, or a stolen session (stepup-2, atrest-2; keys-3 partly: by design, no gate bypassed) | `undo_update` or POST /rollback puts back the previous build: a fresh security fix is removed while Funnel stays on | 18-workflows.mjs:375-394, :401-405; 22-passkey.mjs:125-128; 24-handler.mjs:505-511 | While `funnelOn`: /rollback needs the passkey; agents get an owner-only question for `undo_update` and `test_changes`. `restore.sh` over SSH always remains | Owner decides: reverses the v3.1 choice |
| H5 | Anyone who reads shell history, ~/.zshrc, ~/.claude.json or mcp.json (atrest-1, keys-5) | The key alone is the owner at /mcp and /v1 from anywhere, though the dialog and docs say Tailscale is needed; audit records no address | public/app.js:4741-4758; docs/agent-door.md:48, :159-162; 20-mcp.mjs:34-41; 24-handler.mjs:81 | Correct the dialog and docs; drop the ~/.zshrc and inline-header lines; per-key "works without Tailscale" switch, off for new keys, existing keys unchanged; address in audit | Owner rotates keys already pasted into plain files |

## 3. Medium and low

Medium, in build order:

1. **Sign-in flood** (nologin-2, signin-1, session-4, headers-3). About 100 addresses keep the shared counters full; the owner's passkey sign-in and new codes get 429. 22-sessions.mjs:144-146, :167, :173, :189, :194, :203. Drop the shared cap on begin and sign-in (keep 30 per address); poll: look up first, count unknown codes only; at 300 codes replace the oldest unviewed. A lock-out: build it with "Fix now".
2. **Editor `/proxy/<port>/`** (session-2, gateway-1). After one owner click, a Spark program's page runs on the console's origin: every action and a shell. 21-editor.mjs:10-18. Refuse first segment `proxy` or `absproxy`.
3. **Cookie reaches the port-443 app** (session-3; 22-sessions.mjs:77; owner only). **Planted cookies hide the real one** (session-5, partly: shown from port 443 only). 22-sessions.mjs:48. Try every well-formed value (cap near 200).
4. **No passkey on file opens the gate; sessions outlive the passkey** (stepup-4, signin-3). 22-passkey.mjs:154-156; 24-handler.mjs:205-213. For a session or Funnel request, refuse gated changes ("do it on the tailnet").
5. **A session signs out every other device and removes agent keys** (stepup-6, partly: tailnet access untouched). 22-passkey.mjs:110-128; 22-sessions.mjs:233-246. From a session, that needs the passkey.
6. **Brain routes have no step-up** (stepup-3). 22-passkey.mjs:98-99; 24-handler.mjs:538-563. Add /main/start, stop, use and route to the passkey lists.
7. **/v1 has no limits or trace** (keys-2, gateway-4, -5, -7, headers-4). Any key or Spark program holds the brain's 1 to 4 slots, or pushes the service past 512 MB, unseen. 15-routes.mjs:157-197; 23-http.mjs:8-25. In-flight caps overall and per caller (one slot always Sparkie's), per-key rate limit, audit and last-used, capped `max_tokens`, upstream time limit.
8. **Image links in /v1 bodies** make a Spark fetch any address (gateway-3). 15-routes.mjs:157-160. Answer 400 unless `data:`.
9. **Memory lines and saved workflows** from a session or agent are stored as the owner's and outlive it (keys-4; stepup-5 partly: a planted `undo_update` step never runs). 20-memory.mjs:49; 18-workflows.mjs:155-169. Record the author; refuse an agent replacing a workflow it did not save.
10. **Device-code phishing** (signin-2). 22-sessions.mjs:188-200, :224-231. Plain characters in names; always show the "device's own claim" line; terminal limits for code sign-ins.
11. **IPv6 window after a restart** (headers-1): a Spark program is the owner for up to 60 s. 23-http.mjs:65-90. Add to the list, never replace.
12. **Local port lock skipped by a reset connection** (headers-2; read, not run). 24-handler.mjs:37-38. Mark the listener `req.viaTcp`.
13. **Daily backup is plain and trusted on restore** (atrest-3). 25-backup-and-start.mjs:8-13. Encrypt before it leaves.
14. **Terminal token** is an owner session for 60 idle days (atrest-4). tools/console.mjs:27; 22-sessions.mjs:63-65. About 14 days; notice on a new network.

Low: `/console/api//` never answered (nologin-3; 24-handler.mjs:50). /public/ask can be filled (nologin-4, headers-6; 03-identity.mjs:113, :129). Passkey ids and fleet load visible before sign-in (nologin-5, signin-4; 22-sessions.mjs:170; by design). Served folder never cleaned (nologin-6; deploy/host-on-portal.sh:174-175; a gap, not a proven leak). GETs skip the cross-site check (session-6; 24-handler.mjs:105). Short-address origin accepted on the main socket (session-7, partly; 03-identity.mjs:224-229). Deploy runs a folder's spark.json without the passkey (stepup-7; 22-passkey.mjs:116). Look-only key reads memory, notices and any container's log (keys-6; 16-actions.mjs:717-811). Audit pushed out in hours (keys-7; 20-mcp.mjs:123-129). Mask misses common shapes (atrest-6; 20-mcp.mjs:236-253). Port 8810 squatting (headers-5; 25-backup-and-start.mjs:44-47). Full /health on the tailnet (headers-7; 24-handler.mjs:53-58). `restore.sh --with-state` brings back removed devices and keys (atrest-5; deploy/host-on-portal.sh:147-149).

## 4. What held up

- Funnel traffic never gets a Tailscale identity; Tailscale replaces client-sent login and X-Forwarded-For headers, so limits and the Sparks block cannot be forged (03-identity.mjs:158-159; 24-handler.mjs:35, :40-46).
- One normalised path for gate and router; PUBLIC_ROUTES is an exact match (24-handler.mjs:34, :50-51).
- Passkey: main origin only; signed, single-use, 3-minute challenges; confirmations bound to method, path and body; first passkey never from the internet (22-passkey.mjs:16-18, :91-96, :162-165; service/passkey.mjs:92-137; 24-handler.mjs:193).
- Device codes: a 32-byte secret to collect, passkey-bound approval (22-sessions.mjs:206-207, :224-231).
- Tokens and keys: 256-bit, hashed at rest, constant-time; a terminal token never opens editors or writes dot-files (22-sessions.mjs:57-61; 20-mcp.mjs:35-38; 24-handler.mjs:124, :132).
- Cross-site: every non-GET needs the page header and a matching Origin; no CORS, ever (24-handler.mjs:105-111; 23-http.mjs:2-5).
- A look-only key changes nothing and starts no model by calling it; unknown arguments refused; owner-only questions closed to agents (16-actions.mjs:65-67, :292-295; 17-changes.mjs:88; 15-routes.mjs:172-176).
- Short address: no sign-in, sessions, keys, editors or passkey confirmation (24-handler.mjs:59, :76, :81; 22-sessions.mjs:53; 22-passkey.mjs:157).
- Sign-out is immediate and closes streams and editor sockets (22-sessions.mjs:237-245).
- State files 0600; push and Hugging Face tokens never reach pages or containers (03-identity.mjs:27-32; 23-http.mjs:98-111; 11-setups.mjs:395-397).

## 5. By hand, for the owner

1. Spark 2: `tailscale version` (the headers lens cites bulletins fixed in 1.98.9 and 1.104.4; update if older) and `tailscale funnel status` (is the short-address device's Funnel as you intend?).
2. Spark 2: `ls -la ~/spark-console`; remove anything that is not a page file or version.json.
3. Each Spark: read the code-server unit (spark-portal-editor.service): own password? version 4.10.1 or newer? Add `--disable-proxy`.
4. Port 443: point its `/console/api` at nothing (docs/contract.md:1344-1346), or move that app to another hostname.
5. Decide H4.
6. Rotate agent keys pasted into plain files; `node tools/console.mjs sign-out` on unused computers. Until Medium 4 lands, sign every device out before removing your last passkey.
7. Tailnet ACLs: who reaches the Sparks' model ports (8000, no key) directly; consider tagging the Sparks, after checking nothing you use is cut off.
8. After backup encryption lands: keep its key in your password manager.

## 6. Not looked at

- The live machine: the served folder, serve and Funnel state, Tailscale and Node versions, file permissions, backups on other Sparks.
- Nothing was run except two local checks (the masking timing; `new URL('//')` throwing). H2's internet race, headers-1 and headers-2 rest on Node, Linux and Tailscale source.
- code-server's flags, password and version: H1, Medium 2 and session-7 depend on them.
- The port-443 app, the Cloudflare account, the owner's Mac.
- Whether Funnel passes IPv6 visitors (would make Medium 1 cheaper).
- Model engines at installed versions; members' paths (none today); disk filling; plain traffic floods.

## 7. Tests to add

- H1: through Funnel, a browser session gets 403 on `/connect` GET and upgrade without a fresh passkey stamp; tailnet still opens (beside test/internet.test.mjs:199-203).
- H2: refuse then reset an upgrade on all three listeners; /health still answers.
- H3: a 1 MB "-a-a…" argument answers within a second.
- H4: with Funnel on, `undo_update` by key returns an owner-only question; POST /rollback answers 428.
- H5: a tailnet-only key through Funnel gets 401; audit lines carry the address.
- Flood: after 3,000 begins from 100 addresses a new address still gets a challenge; with 300 codes waiting a new start works.
- `/connect/<spark>/proxy/…` answers 400.
- Six planted cookies ahead of the real one: still signed in.
- No passkeys: POST /agents from a session is refused, from the tailnet allowed.
- A session deleting another session, or calling `/main/*`, gets 428.
- /v1: the in-flight cap gives 429; an http `image_url` gives 400; an audit line is written.
- Restart: a status answer without peers keeps earlier IPv6 addresses; a reset POST on the locked local port changes nothing.
- `/console/api//` answers 400; each missing mask shape at test/door.test.mjs:459.

### Critical Files for Implementation
- /Users/akuppala/Documents/26aiRAG/spark-console/service/src/24-handler.mjs
- /Users/akuppala/Documents/26aiRAG/spark-console/service/src/21-editor.mjs
- /Users/akuppala/Documents/26aiRAG/spark-console/service/src/22-passkey.mjs
- /Users/akuppala/Documents/26aiRAG/spark-console/service/src/22-sessions.mjs
- /Users/akuppala/Documents/26aiRAG/spark-console/service/src/20-mcp.mjs
