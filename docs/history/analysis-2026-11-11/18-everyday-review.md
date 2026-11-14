# Everyday additions: the Fable 5.2 review (2026-11-12)

Six Fable 5.2 reviewers at xhigh (A8 security, A12 safety, A12 healing, A7 and the API, tests and architecture, a
skeptic walking the owner's own requests), and one Fable 5.2 verifier per finding told to refute it: 48 findings, all
48 confirmed. The full record (each finding, its verifier's reasoning, fix and test idea) is in
`18-everyday-review.json`. They come to the distinct problems below; the numbers are the findings in that file.

Choices made here where findings pull different ways (the owner's standing rules decide: nothing that could lock the
owner out, no change from an agent or Sparkie without the owner's words, keys never shown or stored, not over-built).

## Must fix

1. **A container ID prefix passes as a name** (7). `docker inspect` resolves ID prefixes, so `keep_running` on a short
   hex "name" can adopt, stop or restart another container, a protected one or a model included. Every look and change
   resolves the exact name (`^/name$`) and refuses anything else.
2. **A failed first start leaves its container, and a retry silently reuses it** (11, 15, 33, 38). A new app's start that
   fails removes only the container this very call created (it never ran; that is not deleting the owner's data). A
   keep of a name that exists with a different image, port, volumes or settings than asked is refused and says what
   differs; it never silently starts the old one.

## Should fix

3. **save_file's at-once gate matches pieces of words** (1, 48). Use the verifier's fix in finding 1: the whole path is
   one of the owner's words and looks like a file name; the Spark is this message's, the message before counts only
   when this one names none. R37's words become "the whole path, as one word".
4. **Keys reach audit.jsonl through the unmasked request field** (2, 27). The audit line's request text goes through the
   same mask as its arguments (older plumbing; this batch made it likely).
5. **The save guard and the files view use the display mask as a key detector** (3, 43, 4). A save is refused only for
   real key shapes (known token prefixes such as hf_, sk-, ghp_, github_pat_, xox, AKIA; private key blocks including PGP
   and WireGuard `PrivateKey =`; `NAME=value` where NAME ends in KEY, TOKEN, SECRET, PASSWORD, PASS or PWD and the value
   is long and random-looking). Plain notes and code save. The files view hides those same shapes and not plain words.
6. **Which containers count as model servers** (8, 26, 35, 45). Decide by what the container is, not by a live probe of
   /v1/models: a model-engine image (the engines in service/config.json and the known serving images), Spark Console's
   own model label, or the watcher's record of it as a model, refuses. An app Spark Console started as an app
   (`spark.app=1`) stays an app even if it answers /v1/models. An existing container is started only after the 8 GB
   rule with its real memory limit (or refused when it has none and no memoryGB was given).
7. **Agents can adopt and change containers started outside Spark Console** (9, 39). From an agent or Telegram, keep,
   restart or stop of a container Spark Console didn't start, or of a new image, is an owner-only question. From
   Sparkie, it runs at once only when the owner's words name the container and the Spark (finding 10: whole names, not
   substrings, and the image check is never skipped because the watcher knows the name).
8. **A question from a direct call that nobody can answer** (25). An owner-only question asked of a direct API call
   hands back no dead choice ids: it says the owner has to say yes in Sparkie's chat (or on the page) and how. Fix it
   where questions are made, so every action gets it (the API review asked for the same).
9. **The approval button is cut** (14, 5). The button's words show the whole image, port, volumes and settings (keys
   masked), and a file name in full; names with invisible or right-to-left characters are refused.
10. **Services that don't speak HTTP** (16, 34, 41). An app is "up" when its container is running and stays running; the
    HTTP answer only decides whether a link is shown and whether it "answers". Nothing stops an app because it doesn't
    answer HTTP.
11. **Ports** (12, 17, 31, 42, 19). Read the port an existing container publishes from `docker inspect` (its port
    bindings, which real Docker keeps for a stopped container; `docker port` answers only while it runs). The stand-in
    docker's `port` stops answering for stopped containers, as real Docker does. A recorded port follows what Docker
    reports; a port argument that disagrees with Docker for an existing container is refused, and ports above 65535 are
    refused everywhere. Starting a name that is still on the list updates its port and memory figure.
12. **"Keep X running" also counts as "don't stop anything"** (32, 40). The no-stop words ignore "keep … running".
13. **A quoted key inside a shell-string command** (24) is hidden in `running_models {detail}`.

## Minor, fix while there

- Stop while the app's Spark is off (18, 44): it comes off the list (held), and the answer says so; it isn't started at
  the next power-on.
- Forget during a heal pass is undone (20): the heal re-reads the list before putting an app back.
- A held app's reason comes from an old, unrelated event (21): only that app's latest heal event counts.
- Undo of a model start that stopped a kept app (22): the undo names the app and uses keep_running, not restart_model.
- appLook says "missing" when Docker didn't answer (23): it says Docker didn't answer.
- Secret setting names (13, 30, 46): match whole name parts (KEY, TOKEN, SECRET, PASSWORD, PASS, PWD, CREDENTIAL, and
  AUTH only as `_AUTH_TOKEN`-like parts), so WEBUI_AUTH=False and similar ordinary settings pass.
- llama.cpp's `--ctx-size` / `-c` (28, 47) is read for the context length.
- "Exactly those of Recipes setup X" (29) is said only when the settings match too.
- The three-at-once file look refused as busy (6): leave the cap; the answer says it was busy and to try again.
- `files` creates the shared folder on its first look (37): a read changes nothing; it says the folder isn't there yet.
- The tailnet port binding is untested (36): a test with a stand-in tailnet address other than 127.0.0.1, if the
  stand-in allows it without new machinery; otherwise noted in test/README.md.
