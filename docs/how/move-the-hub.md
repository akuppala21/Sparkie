# Move the hub to another Spark

The hub runs Spark Console and Sparkie: `deploy/hub.env` says which Spark it is for the scripts, `service/config.json`
(its Spark with host "local") for the service. From Spark 2 to Spark 1 (2026-11-16), in this order. Two consoles never
run at once: the state is copied first, then the install starts the new one. From the Mac, with
`D=spark-console/deploy S1=akuppala@100.119.233.101 S2=akuppala@100.79.155.126`.

## Touch

1. A build whose `hub.env` and `config.json` both name Spark 1, with its whole-suite lock (`node test/lock.mjs`).
2. Spark 1, by hand there (with the same `S2`): Node.js 22 (the NodeSource line `install.sh` prints);
   `sudo loginctl enable-linger $USER`; `ssh-keygen`, then `ssh-copy-id` to Spark 2, 3 and 4. The brain's model,
   draft and image (`main.presets` in `config.json`), from Spark 2: `rsync -a $S2:.cache/huggingface/hub/models--<model>
   :.cache/huggingface/hub/models--<draft> ~/.cache/huggingface/hub/` and `ssh $S2 docker save <image> | docker load`
   (the same image id).
3. Spark 1's shutdown rule off: `bash $D/power-setup.sh --undo 1`.
4. Stop Spark 2's console: `ssh $S2 'systemctl --user disable --now spark-console-api spark-console-watchdog.timer;
   docker stop spark-console-plugs'` (its brain stops with `docker stop sparkie-main`).
5. Copy the hub's files, sign-ins left out: `bash $D/copy-hub-state.sh 2 1`. It refuses while either runs a console.
6. Install on Spark 1: `NOTE='the hub moves to Spark 1' bash $D/host-on-portal.sh` (its default; it refuses Spark 2).
   It starts the console with the copied state and checks it as the owner. Then `bash $D/cutover.sh`: the `:8443/`
   route (Spark 1 has no portal, so nothing is switched off).
7. The passkey, on the tailnet: `https://akspark1.<tailnet>.ts.net:8443/`, account menu, Your passkey (the old one is
   for the old address). Devices sign in again.
8. Plugs: `bash $D/plugs.sh` (the controller on Spark 1, with the copied keys); `bash $D/plugs.sh status` gives Spark
   1's plug `<p>`; `bash $D/plugs.sh name <p> 1` makes it read-only and proves it. Spark 2's: the Tapo app removes
   the controller's connection and gives a new Matter code; `bash $D/plugs.sh pair 2`. Then
   `bash $D/power-setup.sh 2`.
9. `bash $D/open-to-internet.sh`: Spark 1's 8443 to the internet. Its 443 is never touched.
10. Check: `/status` and one turn in the chat, `bash $D/plugs.sh status`, `bash $D/power-check.sh`.

The way back, until Spark 1 is proven: `bash $D/open-to-internet.sh --undo`; on Spark 1 what step 4 did on Spark 2;
`bash $D/copy-hub-state.sh 1 2` to keep what changed (Spark 2's own goes aside first); then
`ssh $S2 'systemctl --user enable --now spark-console-api spark-console-watchdog.timer; docker start
spark-console-plugs'`. Spark 2's 8443 was never closed. After step 8 the plugs stay as it left them.

## Also update

- `deploy/hub.env` and `service/config.json` together: the installer refuses a build where they disagree.
- `docs/sharing.md` and the tools' default address name the new hub.

## Never

- Two consoles at once: stop one before the other starts (the copy refuses otherwise).
- Install the new build on the old hub: its installer refuses a build whose hub isn't the one installed there.
- Copy `sessions.json`, or switch the hub's plug (only `pair` or `name` with its number, read-only).
- Change or close port 443's Funnel on any Spark.

## Rules

- R41: the hub is never powered off, gets no shutdown rule, and its plug is read-only.
- R30: the installer, its snapshot and the way back. R23: a state put back with its secrets file is not held.

## Tests

- `hub-deploy.test.mjs`.

## Copy from

- `deploy/REBUILD.txt`: bringing a hub up from a copy of its state.
