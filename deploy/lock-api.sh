#!/usr/bin/env bash
# Points Tailscale at Spark Console's private socket instead of its local port, so programs on the hub (containers,
# scripts) can't reach the API directly and claim to be someone. Run it once from your Mac; sudo may ask for the hub's
# password (deploy/hub.env names the hub). Within a minute of the switch, the service stops answering API requests on its local port
# (127.0.0.1:8810 keeps only /health).
#
#   bash spark-console/deploy/lock-api.sh            switch to the socket
#   bash spark-console/deploy/lock-api.sh --undo     back to the local port
#
# Only the /console/api route changes. It never runs `tailscale serve --https=8443 off`.
set -euo pipefail
. "$(dirname "$0")/hub.sh"
HOST="$HUB_HOST"
URL="$HUB_URL"
case "${1:-}" in '') MODE=lock ;; --undo) MODE=undo ;; *) echo "Usage: bash $0 [--undo]" >&2; exit 2 ;; esac

# The part that runs on the hub is copied there first, then run in a real terminal so sudo can ask for a password.
read -r -d '' REMOTE <<'EOF' || true
MODE="$1"
set -euo pipefail
SOCK="$HOME/.local/state/spark-console/api.sock"
serve() { tailscale serve --bg --https=8443 "$@" 2>/dev/null || sudo tailscale serve --bg --https=8443 "$@"; }
if [ "$MODE" = undo ]; then
  serve --set-path=/console/api http://127.0.0.1:8810
  # The service keeps its local port health-only while this file exists. Tailscale points at the port first (so the
  # restarted service doesn't see the socket route and lock again), then the file goes and the service restarts.
  rm -f "$HOME/.local/state/spark-console/api-locked"
  systemctl --user restart spark-console-api
  for i in $(seq 1 20); do curl -s -m 2 http://127.0.0.1:8810/health | grep -q '"ok":true' && break; sleep 1; done
else
  [ -S "$SOCK" ] || { echo "STOP: $SOCK isn't there yet. Install the latest Spark Console first." >&2; exit 1; }
  curl -s -m 5 --unix-socket "$SOCK" http://local/health | grep -q '"ok":true' || { echo "STOP: the service doesn't answer on its socket." >&2; exit 1; }
  serve --set-path=/console/api "unix:$SOCK"
fi
echo; tailscale serve status
EOF
SOCK_SSH="/tmp/spark-console-lock-$$"
SSH=(ssh -o ControlMaster=auto -o ControlPath="$SOCK_SSH" -o ControlPersist=60)
trap '"${SSH[@]}" -O exit "$HOST" >/dev/null 2>&1 || true' EXIT
"${SSH[@]}" "$HOST" 'mkdir -p ~/.cache/spark-console && cat > ~/.cache/spark-console/lock-api-remote.sh' <<<"$REMOTE"
"${SSH[@]}" -t "$HOST" "bash ~/.cache/spark-console/lock-api-remote.sh $MODE"

echo
echo "Checking from this Mac …"
code=$(curl -s -o /dev/null -w '%{http_code}' -m 20 "$URL/console/api/bootstrap" || true)
if [ "$code" = 200 ]; then echo "  ok: Spark Console answers ($code)"; else echo "  CHECK: Spark Console answered $code. Undo with: bash $0 --undo"; fi
