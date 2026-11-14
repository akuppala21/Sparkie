# Retiring the original portal

**Goal:** Spark Console stands on its own, the original portal (`spark-portal.service`, `~/spark-portal`) is switched
off, and the console moves from `:8443/console/` to `:8443/`.

**Status:** steps 1–6 done (2026-11-04). Spark Console is at `:8443/` (and still at `:8443/console/`), and
`spark-portal.service` is stopped and disabled. Step 7, the cleanup, is due after a week without problems (from
2026-11-11).

## What the console still gets from the portal

| Piece | Portal API today | Plan |
|---|---|---|
| Who someone is, owner vs member, their permissions | `/api/bootstrap`, `/api/access` (users kept in `~/.config/spark-portal/portal.json`) | Done (steps 1 and 5): the console's own `access.json`, copied once; people are managed in Sharing & access. |
| Spark status (reachable, GPU, memory, disk, containers, uptime, temperature) | `/api/status` (the portal's `worker.py` over SSH) | The service collects it over the SSH it already uses; live metrics are already its own. |
| Workloads, logs, diagnostics | `/api/nodes/:id/workloads`, `/logs/:service`, `/diagnostics` | Same commands from the service. |
| Model start/stop, editor restart | `/api/nodes/:id/actions` | Nemotron controls go away once Aphex is Sparkie's model; editor restart moves to the service. |
| Files (browse, upload, download; 256 KB limit) | `/api/nodes/:id/files` | Ported to the service, with the same owner/member areas and size limit. |
| VS Code in the browser | `/connect/:id/` (proxy plus WebSocket to code-server on each Spark; Spark 3 and 4 via tunnel services) | The hardest piece. Either the service proxies it, or `tailscale serve` exposes each Spark's code-server directly. |
| Groups (request pool, Ray compute cluster, saved group) | `/api/clusters` | Dropped (step 4). Clusters now come from the direct cables the console tests itself. |
| Old Nemotron chats | `/api/conversations` | Done (step 5): copied in as ordinary Sparkie chats. |
| GPU energy totals | part of `/api/status` (`power.json`) | The live sampler already measures power; it adds the running total. |

## Order

1. **Identity and status first.** With those two, the console works with the portal stopped. Overview, Models, Recipes,
   Chat and Clusters readiness keep working. **Done:**
   - The service reads the owner, members and Sparks from the portal's two files.
   - It runs its own copy of the portal's `worker.py` for status every 30 s.
   - It keeps the energy total in `~/.local/state/spark-console/energy.json`.
   - Until cutover, both the portal and the console collect status, which doubles that light load for a while.
2. **Files, workloads, logs, diagnostics, editor restart.** Mostly the same commands, moved. **Done:**
   - Each one runs through the console's `worker.py`, with the portal's checks: owner-only reads and actions, and files
     per person (personal and shared areas, read/write rights, members kept to their own area, 2 operations at a time
     per person, 400 KB requests).
   - Editor restart is a console job, listed in Activity. (The portal's Nemotron start/stop and Ray cluster actions
     were dropped; models start and stop through Models, Sparkie and agents.)
   - Logs gained "Sparkie's model" and "Spark Console".
3. **VS Code in the browser.** **Done:**
   - The console service proxies each Spark's code-server at `:8443/console/api/connect/<spark>/`, HTTP and WebSockets,
     with the portal's checks:
     - owner only;
     - no path escapes;
     - redirects and cookies kept under the editor's path;
     - changes and WebSockets only from this site.
   - It uses the same local editor ports on Spark 2 (8801–8804; Spark 3 and 4 via the existing tunnel services, which run
     independently of `spark-portal.service`).
   - The console's VS Code links use it. At cutover, old `/connect/<spark>/` links should go there too.
   - Confirmed by the owner in a real browser session (2026-11-04).
4. **Groups.** **Dropped** (owner's choice):
   - No saved groups, request pools or Ray clusters. Request pools stopped mattering once Sparkie runs one model.
   - Clusters come from the direct cables instead. The console tests them every 10 minutes and shows linked Sparks
     on Home and the Clusters page, with roughly how big a model each linked pair could run.
   - Home's "Deploy a model" lists every model with where it fits right now and what would have to stop.
5. **Copy over old chats and access settings.** **Done:**
   - **People:** the console keeps its own owner-only `~/.local/state/spark-console/access.json`: the owner, the members
     and the Spark list. It's copied once from the portal's two files. Members keep their ids, so their personal files
     stay theirs. From then on people are managed on **Sharing & access → People** (add, change, remove; owner only, at
     most 20). Changes there apply straight away; someone removed or changed reconnects. Changes made in the old portal
     after the copy aren't picked up.
   - **Old chats:** every portal chat is copied in once as an ordinary Sparkie chat. It keeps the portal's id with `sc_`
     in front, so it's never copied twice. The snapshot that used to be glued onto each question is kept apart, and
     failed replies keep their error. A chat still waiting on a reply is copied on the next pass. Chats from people who
     no longer have access are skipped. Deleting a copied chat is final. Continuing an old chat asks Sparkie.
   - The chat list hides the portal's own copy, and old `#/chat/<id>` links open the copy.
6. **Cut over.** **Done** (2026-11-04). The owner ran `cutover.sh`. `:8443/` now serves the console's files,
   and the portal is stopped and won't start at boot. Every check passed: `/` and `/console/` serve the same build, the
   service answers, VS Code opens for Spark 2, 3 and 4, the Funnel on 443 still answers, and the portal's `/api` and old
   `/connect/` links return 404. The rollback had been run once beforehand, while the portal was still live; it worked.
   The plan as carried out:

   **Part A: the console stops using the portal (code only; the portal keeps running, nothing switches).** **Done.**
   - The UI stops calling the portal's API: the merged bootstrap, portal jobs in Activity, the connections fallback,
     the "Original portal" link and log source.
   - Chat is Sparkie only. The "Nemotron (portal)" choice goes, since those chats run through the portal. Nemotron
     itself stays on Models (start/stop), and Sparkie can still be pointed at it there if it's reachable.
   - Wording: about 25 screen texts still say "portal" ("Ask the portal owner…", "This Spark hosts the portal",
     "Portal link"). They change to "the owner", "Spark Console" and "Spark 2".
   - The service drops what's left: the old groups check, and asking the portal who someone is when there's no access
     file. A chat caught mid-reply when the portal stops is copied anyway, with "No reply".
   - The UI works from `:8443/` as well as `:8443/console/` (same files, same `/console/api`).
   - Test on the stand-ins with the portal off, one UI review, install, check live. Undo: reinstall the previous build.

   **Part B: the switch (one command, run by the owner from the Mac, because sudo may ask for a password).** **Ready:**
   the script is written, and its checks passed against Spark 2 on 2026-11-04 (`--check` changes nothing).
   `bash spark-console/deploy/cutover.sh`:
   1. Checks first and stops if anything's off: the console answers, `access.json` has the owner, and the new build is
      installed.
   2. Points `:8443/` at the console's files instead of the portal (`tailscale serve --bg --https=8443 --set-path=/
      ~/spark-console`). This replaces only the `/` route. `/console/` and `/console/api` stay, so old console links
      keep working. It never runs `tailscale serve --https=8443 off`, and the public Funnel on 443 isn't touched.
   3. Stops and disables `spark-portal.service`.
   4. Prints `tailscale serve status` and checks `:8443/`, `:8443/console/` and the API.

   `bash spark-console/deploy/cutover.sh --rollback` puts `/` back on `127.0.0.1:8800` and starts the portal again.
   Before changing anything it saves `tailscale serve status --json` to
   `~/.local/state/spark-console/serve-before-cutover.json`. If `/` doesn't end up on the console's files, it stops
   before touching the portal. Afterwards it also checks that VS Code for Spark 3 still opens (its tunnel should run
   without the portal) and that the Funnel on 443 still answers.

   Then a read-only check from the Mac:
   - `:8443/` and `:8443/console/` both open Spark Console, and the portal's `/api` is gone.
   - Status, Sparkie chat, VS Code (`/console/api/connect/<spark>/`) and People work.
   - The Funnel on 443 still answers.

   Old `:8443/connect/<spark>/` bookmarks stop working; the console's VS Code buttons already use the new address.

   **Not touched:** the VS Code servers on each Spark (`spark-portal-editor.service`), the editor tunnels on Spark 2 for
   Spark 3 and 4, and the file storage (`~/workspaces`, `~/.local/share/spark-portal/workspaces`). They still carry the
   portal's name, but Spark Console uses them.
   **After the switch (2026-11-04):** the console's remaining portal leftovers were removed: the Nemotron panel,
   Start/Stop Nemotron buttons and its log source, the portal's model and Ray checks in diagnostics, and the code that
   read the portal's files and copied its chats (both one-time jobs, done). The console is about general models, AI
   services and dev boxes, not one model.
7. **Clean up** after a week without problems, narrower than first planned: remove `spark-portal.service` and the
   portal's web server code on Spark 2. Keep everything listed under "Not touched" above, plus the portal's config and
   state files as a small backup.

## Rollback

After step 5 the console no longer reads the portal's access files, so rolling back to the portal also brings back the
portal's own list of people as it was at the copy.

Until step 7, rolling back is `bash spark-console/deploy/cutover.sh --rollback`, which does the two things by hand:
- `systemctl --user enable --now spark-portal.service`
- put the `:8443/` route back to `127.0.0.1:8800`

People added in Spark Console after the switch aren't in the portal's list, so they'd need adding there too.

Nothing in the portal's folders is deleted before then.

## Not touched

- The public Funnel on 443 (the Inference Lab).
- The Sparks' own code-server services.
- The Qwen benchmark folders.
