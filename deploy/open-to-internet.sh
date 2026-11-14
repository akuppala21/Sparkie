#!/usr/bin/env bash
# Opens Spark Console's main address (https://akspark2…ts.net:8443) to the internet with Tailscale Funnel, so you reach
# it from your phone or laptop without Tailscale (docs/contract.md 4.10). From the internet nobody gets past the public
# fleet page until they sign in: your passkey, a device you let in with a code, or an agent with its own key.
# Run it once from your Mac; sudo may ask for your Spark 2 password.
#
#   bash spark-console/deploy/open-to-internet.sh           open it to the internet
#   bash spark-console/deploy/open-to-internet.sh --undo    back to tailnet only
#
# Only port 8443's Funnel switch changes: its routes stay as they are, the public Funnel on port 443 isn't touched, and
# it never runs `tailscale serve --https=8443 off`. Tailscale on your devices keeps working as before either way.
# Port 8443 is opened only when its routes are exactly Spark Console's three (the page's files twice, and the API's
# private socket), and the installed build signs people in, with your passkey set up.
set -euo pipefail
HOST="${SPARK2:-akuppala@100.79.155.126}"
URL="${SPARK_CONSOLE_URL:-https://akspark2.tailab9aa9.ts.net:8443}"
case "${1:-}" in '') MODE=open ;; --undo) MODE=undo ;; *) echo "Usage: bash $0 [--undo]" >&2; exit 2 ;; esac

# The part that runs on Spark 2, sent along with the command (nothing is written there first).
read -r -d '' REMOTE <<'EOF' || true
MODE="$1"
set -euo pipefail
SOCK="$HOME/.local/state/spark-console/api.sock"
fun() { tailscale funnel --bg --https=8443 "$@" 2>/dev/null || sudo tailscale funnel --bg --https=8443 "$@"; }
serve() { tailscale serve --bg --https=8443 "$@" 2>/dev/null || sudo tailscale serve --bg --https=8443 "$@"; }
# Port 8443's routes, checked to be exactly Spark Console's: / and /console/ serve the page's folder, /console/api the
# API's socket. Anything else there would go on the internet too.
routes_ok() {
  tailscale serve status --json 2>/dev/null | python3 -c '
import json, os, sys
home = os.path.expanduser("~")
want = {"/": ("Path", home + "/spark-console"), "/console/": ("Path", home + "/spark-console"),
        "/console/api": ("Proxy", "unix:" + home + "/.local/state/spark-console/api.sock")}
web = (json.load(sys.stdin) or {}).get("Web") or {}
ports = [v for hp, v in web.items() if hp.endswith(":8443")]
if len(ports) != 1: sys.exit("port 8443 has %d sites, not 1" % len(ports))
got = {("/console/" if p == "/console" else p): h for p, h in (ports[0].get("Handlers") or {}).items()}
for p, h in got.items():
    if p not in want: sys.exit("port 8443 also serves %s" % p)
    k, v = want[p]
    if h.get(k) != v or len(h) != 1: sys.exit("port 8443 serves %s from %s, not %s" % (p, json.dumps(h), v))
missing = [p for p in want if p not in got]
if missing: sys.exit("port 8443 is missing %s" % ", ".join(missing))
'
}
count() { tailscale serve status 2>/dev/null | grep -cE '^\|-- /' || true; }
[ -S "$SOCK" ] || { echo "STOP: $SOCK isn't there. Install the latest Spark Console first." >&2; exit 1; }
before=$(count)
if [ "$MODE" = undo ]; then
  # Serving the same route again without Funnel turns Funnel off for port 8443 and keeps every route.
  serve --set-path=/console/api "unix:$SOCK"
else
  routes_ok || { echo "STOP: port 8443's routes aren't just Spark Console's (above), so it isn't opened." >&2; exit 1; }
  # Only a build that signs you in from the internet, with your passkey set up, is opened (4.10).
  curl -s -m 5 --unix-socket "$SOCK" -H 'Tailscale-Funnel-Request: ?1' http://local/console/api/whoami | grep -q '"signin":true' \
    || { echo "STOP: the installed Spark Console can't sign you in from the internet yet: install the latest build, and set up your passkey (account menu → Your passkey)." >&2; exit 1; }
  # Funnel is a switch for the whole port: re-serving one route with Funnel opens all of 8443's routes, unchanged.
  fun --set-path=/console/api "unix:$SOCK"
fi
after=$(count)
echo
tailscale serve status
if [ "$after" -lt "$before" ]; then
  echo
  echo "WARNING: fewer routes than before ($before → $after). Put Spark Console's back with: bash spark-console/deploy/host-on-portal.sh" >&2
  exit 1
fi
open=no; tailscale funnel status 2>/dev/null | grep -qE ':8443 \(Funnel on\)' && open=yes
if [ "$MODE" = undo ] && [ "$open" = yes ]; then echo "WARNING: port 8443 still shows Funnel on." >&2; exit 1; fi
if [ "$MODE" = open ] && [ "$open" = no ]; then echo "WARNING: port 8443 doesn't show Funnel on. Is Funnel allowed for this device in the tailnet's access controls?" >&2; exit 1; fi
if [ "$MODE" = open ]; then routes_ok || { echo "WARNING: port 8443's routes changed; close it again: bash spark-console/deploy/open-to-internet.sh --undo" >&2; exit 1; }; fi
EOF
ssh -t "$HOST" "bash -c $(printf %q "$REMOTE") open-to-internet $MODE"
echo
if [ "$MODE" = undo ]; then
  echo "Spark Console is tailnet-only again: $URL/ opens with Tailscale on."
else
  echo "Spark Console is open to the internet at $URL/"
  echo "On your phone (Tailscale off): open it, add it to your Home Screen, then Sign in with your passkey (or Get a code)."
  echo "In a terminal without Tailscale: node spark-console/tools/console.mjs sign-in"
  echo "Back to tailnet only: bash spark-console/deploy/open-to-internet.sh --undo"
fi
