#!/usr/bin/env bash
# Step 6, part B of retiring the original portal (docs/retire-portal.md): make https://<Spark 2>:8443/ open Spark
# Console, and switch the portal off. Run it from your Mac; it works on Spark 2 over SSH. sudo may ask for your
# Spark 2 password, for the tailscale serve change.
#
#   bash spark-console/deploy/cutover.sh              switch over
#   bash spark-console/deploy/cutover.sh --check      only the checks; changes nothing
#   bash spark-console/deploy/cutover.sh --rollback   put the portal back at :8443/ and start it again
#
# Only the :8443/ route changes: /console/ and /console/api stay, so old console links keep working. It never runs
# `tailscale serve --https=8443 off`, the public Funnel on 443 isn't touched, and nothing is deleted (the portal's code
# and files stay until step 7).
set -euo pipefail
HOST="${SPARK2:-akuppala@100.79.155.126}"
URL="${SPARK_CONSOLE_URL:-https://akspark2.tailab9aa9.ts.net:8443}"
FUNNEL="${URL%:8443}"
case "${1:-}" in
  '') MODE=switch ;;
  --check) MODE=check ;;
  --rollback) MODE=rollback ;;
  *) echo "Usage: bash $0 [--check | --rollback]" >&2; exit 2 ;;
esac

SOCK="/tmp/spark-console-cutover-$$"
SSH=(ssh -o ControlMaster=auto -o ControlPath="$SOCK" -o ControlPersist=60)
trap '"${SSH[@]}" -O exit "$HOST" >/dev/null 2>&1 || true' EXIT

# The part that runs on Spark 2. It's copied there first, then run with a terminal so sudo can ask for a password.
read -r -d '' REMOTE <<'EOF' || true
set -euo pipefail
MODE="$1"
STATE="$HOME/.local/state/spark-console"
fail() { echo "  STOP: $*" >&2; exit 1; }
serve() { tailscale serve --bg --https=8443 "$@" 2>/dev/null || sudo tailscale serve --bg --https=8443 "$@"; }
root_route() { tailscale serve status 2>/dev/null | awk '/:8443/{p=1} p && $2 == "/" {print $3, $4; exit}'; }

if [ "$MODE" = rollback ]; then
  # The old portal must never land on a port that's open to the internet (deploy/open-to-internet.sh, contract 4.10).
  tailscale funnel status 2>/dev/null | grep -qE ':8443 \(Funnel on\)' \
    && fail "Port 8443 is open to the internet. Close it first: bash spark-console/deploy/open-to-internet.sh --undo"
  echo "Putting the portal back at :8443/ …"
  serve --set-path=/ http://127.0.0.1:8800
  systemctl --user enable --now spark-portal.service
  # Any answer means it's up: the portal refuses requests that don't come through Tailscale (403).
  for _ in $(seq 20); do [ "$(curl -s -o /dev/null -m 2 -w '%{http_code}' http://127.0.0.1:8800/ || true)" != 000 ] && break; sleep 1; done
  systemctl --user is-active --quiet spark-portal.service || fail "spark-portal.service didn't start. See: journalctl --user -u spark-portal -n 50"
  echo "  / now: $(root_route)"
  echo; tailscale serve status
  exit 0
fi

echo "Checking first (nothing changes if any of these fail) …"
curl -fsS -m 5 http://127.0.0.1:8810/health >/dev/null || fail "Spark Console's service isn't answering on 127.0.0.1:8810. Run: bash spark-console/deploy/host-on-portal.sh"
echo "  ok: Spark Console's service answers"
python3 - "$STATE/access.json" <<'PY' || fail "No owner in $STATE/access.json yet. Open Spark Console once (it copies the owner from the portal), then run this again."
import json, sys
d = json.load(open(sys.argv[1]))
assert d.get("ownerLogin")
PY
echo "  ok: Spark Console has its own owner and people list"
grep -q "^const CONSOLE_API = '/console/api/';$" "$HOME/spark-console/app.js" 2>/dev/null \
  || fail "The installed Spark Console is older than part A. Run: bash spark-console/deploy/host-on-portal.sh"
echo "  ok: the installed build works at :8443/ as well as /console/"
status=$(tailscale serve status 2>&1)
echo "$status" | grep -qE '/console/ +path' && echo "$status" | grep -q '/console/api' \
  || fail "The /console routes aren't set up. Run: bash spark-console/deploy/host-on-portal.sh"
echo "  ok: /console/ and /console/api are in place"
echo "  / now: $(root_route)"

if [ "$MODE" = check ]; then
  systemctl --user is-active --quiet spark-portal.service && echo "  the portal is running" || echo "  the portal isn't running"
  echo "Checks passed. Nothing was changed."
  exit 0
fi

mkdir -p "$STATE"
tailscale serve status --json > "$STATE/serve-before-cutover.json" 2>/dev/null || true
echo "Pointing :8443/ at Spark Console (sudo may ask for your password) …"
serve --set-path=/ "$HOME/spark-console"
now=$(root_route)
case "$now" in
  "path $HOME/spark-console"*) echo "  ok: / now serves Spark Console" ;;
  *) fail "/ still points at: ${now:-nothing}. The portal is still running; nothing else was changed." ;;
esac
tailscale serve status 2>&1 | grep -q '/console/api' || fail "/console/api went missing. Run: bash spark-console/deploy/cutover.sh --rollback"

echo "Switching the portal off …"
systemctl --user disable --now spark-portal.service
if systemctl --user is-active --quiet spark-portal.service; then fail "spark-portal.service is still running."; fi
echo "  ok: spark-portal.service is stopped and won't start at boot"
echo; tailscale serve status
EOF

echo "Spark 2: $HOST"
"${SSH[@]}" "$HOST" 'mkdir -p ~/.cache/spark-console && cat > ~/.cache/spark-console/cutover-remote.sh' <<<"$REMOTE"
"${SSH[@]}" -t "$HOST" "bash ~/.cache/spark-console/cutover-remote.sh $MODE"

[ "$MODE" = check ] && exit 0
echo
echo "Checking from this Mac …"
code() { curl -s -o /dev/null -w '%{http_code}' -m 20 "$1" || true; }
check() { if [ "$2" = "$3" ]; then echo "  ok: $1 ($3)"; else echo "  CHECK: $1 answered $3, expected $2"; problems=1; fi; }
problems=0
if [ "$MODE" = switch ]; then
  title=$(curl -s -m 20 "$URL/" | grep -o '<title>[^<]*</title>' || true)
  check ":8443/ opens Spark Console" "<title>Spark Console</title>" "${title:-nothing}"
  check ":8443/console/ still works" 200 "$(code "$URL/console/")"
  check "Spark Console's service" 200 "$(code "$URL/console/api/bootstrap")"
  check "the portal's API is gone" 404 "$(code "$URL/api/bootstrap")"
else
  check "the portal answers at :8443/" 200 "$(code "$URL/api/bootstrap")"
  check ":8443/console/ still works" 200 "$(code "$URL/console/")"
fi
funnel=$(code "$FUNNEL/")
case "$funnel" in 2??|3??) echo "  ok: the public Funnel on 443 still answers ($funnel)" ;; *) echo "  CHECK: the public Funnel on 443 answered $funnel"; problems=1 ;; esac
echo
if [ "$problems" = 0 ]; then
  [ "$MODE" = switch ] && echo "Done: $URL/ is Spark Console. Undo with: bash spark-console/deploy/cutover.sh --rollback" \
    || echo "Done: the portal is back at $URL/"
else
  echo "Finished, but some checks above need a look."
fi
