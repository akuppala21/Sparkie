#!/usr/bin/env bash
# Opens Spark Console's app door (https://akspark2…ts.net:10000) to the internet with Tailscale Funnel, so the apps
# Spark Console keeps running (Open WebUI, Jupyter, code-server, ComfyUI…, on any Spark but the brain's) open from your
# phone or laptop without Tailscale, once you're signed in to Spark Console (R40). Run it once from your Mac; sudo may
# ask for your Spark 2 password. Running it again changes nothing.
#
#   bash spark-console/deploy/open-apps-to-internet.sh           open the app door
#   bash spark-console/deploy/open-apps-to-internet.sh --undo    close it (apps open on your tailnet only, as before)
#
# Only port 10000 changes. Port 8443 (Spark Console) and port 443 (the public Funnel) aren't touched, every other port
# is checked to be the same afterwards, and it never runs a plain `tailscale serve off` or `tailscale funnel off`. It
# stops if port 10000 already serves something else, or if the installed build's door doesn't turn away a visitor who
# isn't signed in.
set -euo pipefail
HOST="${SPARK2:-akuppala@100.79.155.126}"
URL="${SPARK_CONSOLE_URL:-https://akspark2.tailab9aa9.ts.net:8443}"
case "${1:-}" in '') MODE=open ;; --undo) MODE=undo ;; *) echo "Usage: bash $0 [--undo]" >&2; exit 2 ;; esac

# The part that runs on Spark 2, sent along with the command (nothing is written there first).
read -r -d '' REMOTE <<'EOF' || true
MODE="$1"
set -euo pipefail
SOCK="$HOME/.local/state/spark-console/door.sock"
serve() { tailscale serve "$@" 2>/dev/null || sudo tailscale serve "$@"; }
fun() { tailscale funnel "$@" 2>/dev/null || sudo tailscale funnel "$@"; }
status() { tailscale serve status --json 2>/dev/null || echo '{}'; }
# What port 10000 serves: none; door (exactly the app door's socket at /), with "-funnel" when Funnel is on; or other.
state() {
  status | SOCK="$SOCK" python3 -c '
import json, os, sys
cfg = json.loads(sys.stdin.read() or "{}") or {}
tcp = (cfg.get("TCP") or {}).get("10000")
web = [v for hp, v in (cfg.get("Web") or {}).items() if hp.endswith(":10000")]
funnel = any(on for hp, on in (cfg.get("AllowFunnel") or {}).items() if hp.endswith(":10000"))
if not tcp and not web: print("none"); sys.exit()
door = {"/": {"Proxy": "unix:" + os.environ["SOCK"]}}
if (tcp or {}) != {"HTTPS": True} or len(web) != 1 or (web[0].get("Handlers") or {}) != door: print("other"); sys.exit()
print("door-funnel" if funnel else "door")
'
}
# Everything served on the other ports (443, 8443 and the rest), to check it's the same afterwards.
others() {
  status | python3 -c '
import json, sys
cfg = json.loads(sys.stdin.read() or "{}") or {}
web = lambda d: {k: v for k, v in (d or {}).items() if not str(k).endswith(":10000")}
print(json.dumps([{k: v for k, v in (cfg.get("TCP") or {}).items() if str(k) != "10000"}, web(cfg.get("Web")), web(cfg.get("AllowFunnel"))], sort_keys=True))
'
}
now=$(state); before=$(others)
if [ "$MODE" = undo ]; then
  case "$now" in
    none) echo "The app door was already closed: nothing changed." ;;
    other) echo "STOP: port 10000 serves something other than Spark Console's app door, so it's left as it is." >&2; tailscale serve status >&2; exit 1 ;;
    *)
      # Serving the same route again without Funnel turns Funnel off for port 10000 alone; then that one route goes.
      if [ "$now" = door-funnel ]; then serve --bg --https=10000 --set-path=/ "unix:$SOCK" >/dev/null; fi
      serve --https=10000 --set-path=/ off >/dev/null ;;
  esac
  [ "$(state)" = none ] || { echo "WARNING: port 10000 still serves something:" >&2; tailscale serve status >&2; exit 1; }
else
  case "$now" in
    other) echo "STOP: port 10000 already serves something else (below), so the app door isn't opened there." >&2; tailscale serve status >&2; exit 1 ;;
    door-funnel) echo "The app door was already open: nothing changed." ;;
    *)
      [ -S "$SOCK" ] || { echo "STOP: $SOCK isn't there. Install the Spark Console build with the app door first." >&2; exit 1; }
      # Only a build whose door turns away a visitor from the internet who isn't signed in is opened.
      page=$(curl -s -m 5 --unix-socket "$SOCK" -H 'Tailscale-Funnel-Request: ?1' http://local/ 2>/dev/null || true)
      case "$page" in *'Sign in to Spark Console'*) ;; *) echo "STOP: the installed Spark Console's app door didn't answer as it should (or it's still starting): try again in a minute, or install the latest build." >&2; exit 1 ;; esac
      fun --bg --https=10000 --set-path=/ "unix:$SOCK" >/dev/null ;;
  esac
  [ "$(state)" = door-funnel ] || { echo "WARNING: port 10000 doesn't show the app door with Funnel on. Is Funnel allowed for this device in the tailnet's access controls?" >&2; tailscale serve status >&2; exit 1; }
fi
[ "$(others)" = "$before" ] || { echo "WARNING: another port's routes changed while this ran. Check them: tailscale serve status" >&2; exit 1; }
echo
tailscale serve status
EOF
ssh -t "$HOST" "bash -c $(printf %q "$REMOTE") open-apps-to-internet $MODE"
DOOR="$(printf '%s' "$URL" | sed -E 's#:[0-9]+$##'):10000"
echo
if [ "$MODE" = undo ]; then
  echo "The app door is closed. Kept apps open on your tailnet only, at their tailnet links. Within a minute Spark Console"
  echo "gives only those links again."
else
  echo "The app door is open at $DOOR/"
  echo "Within a minute, wherever Spark Console gives an app's link (Sparkie's answers, should_be_running), the first one"
  echo "is the door's ($DOOR/console/api/open/<spark>/<app>), and the tailnet link comes second."
  echo "Open it on a device signed in to Spark Console ($URL/): one app at a time per browser; opening another switches."
  echo "Close it: bash spark-console/deploy/open-apps-to-internet.sh --undo"
fi
