#!/usr/bin/env bash
# One-time setup so Spark Console can shut a compute Spark down cleanly before its smart plug cuts the power.
# (DGX Spark can't be woken over the network, so turning it back on is the plug's job: power returns and the Spark boots,
# which needs the firmware's "After Power Loss Behavior" set to Auto Boot; that's the default on NVIDIA's own model.)
# Run it from your Mac; sudo asks for each Spark's password once.
#
#   bash spark-console/deploy/power-setup.sh                 every compute Spark (deploy/hub.env: all but the hub)
#   bash spark-console/deploy/power-setup.sh <n>             just one Spark: its number, or its Tailscale address
#   bash spark-console/deploy/power-setup.sh --undo [...]    remove it again (from every compute Spark, or those named;
#                                                            the hub too, which is reached directly: a hub that had the
#                                                            rule as a compute Spark loses it this way)
#
# On each Spark it adds one sudo rule that lets your account run exactly two commands without a password, and nothing
# else (/etc/sudoers.d/spark-console-power, checked with visudo before it's put in place):
#   systemctl stop nvidia-persistenced   (NVIDIA's workaround: headless shutdowns can hang in it on kernel 7.0.0-1019)
#   systemctl poweroff
# The hub is never set up here: it runs Spark Console and stays on. Each Spark is reached through the hub, which reaches
# the others without a password.
set -euo pipefail
. "$(dirname "$0")/hub.sh"
UNDO=0
[ "${1:-}" = --undo ] && { UNDO=1; shift; }
TARGETS=()
if [ $# -eq 0 ]; then for s in $COMPUTE; do TARGETS+=("$(addr_of "$s")"); done; else TARGETS=("$@"); fi

read -r -d '' REMOTE <<'EOF' || true
UNDO="$1"
set -euo pipefail
me=$(id -un)
echo "=== $(hostname)"
if [ "$UNDO" = 1 ]; then
  sudo rm -f /etc/sudoers.d/spark-console-power
  echo "  removed the sudo rule"; exit 0
fi
# Passwordless poweroff, and nothing else.
tmp=$(mktemp)
printf '%s ALL=(root) NOPASSWD: /usr/bin/systemctl stop nvidia-persistenced, /usr/bin/systemctl poweroff\n' "$me" > "$tmp"
sudo visudo -cf "$tmp" >/dev/null && sudo install -m 0440 -o root -g root "$tmp" /etc/sudoers.d/spark-console-power
rm -f "$tmp"
sudo -n -l /usr/bin/systemctl poweroff >/dev/null && echo "  passwordless poweroff: ok"

EOF

HOST="$HUB_HOST"
# Never the hub (R41): by its number, id, address or name here (deploy/hub.env), and on the far side by its machine id,
# so no other name for it (a hostname, another of its addresses) gets the shutdown rule either. --undo only takes the
# rule away, so it may name the hub.
is_hub() { [ "$(spark_of "$1" || true)" = "$HUB" ] || case "${1#*@}" in localhost|127.*|::1) true ;; *) false ;; esac; }
if [ "$UNDO" = 0 ]; then
  for s in "${TARGETS[@]}"; do
    if is_hub "$s"; then echo "Refused: $s is $HUB_SAYS. It runs Spark Console and Sparkie and is never set up to shut down." >&2; exit 2; fi
  done
  HUB_ID=$(ssh "$HOST" 'cat /etc/machine-id' 2>/dev/null || true)
  [ -n "$HUB_ID" ] || { echo "Couldn't read $HUB_SAYS's machine id, so nothing was set up (it is how the hub is told apart)." >&2; exit 2; }
  REMOTE="HUB_ID='$HUB_ID'
[ \"\$(cat /etc/machine-id 2>/dev/null)\" = \"\$HUB_ID\" ] && { echo 'Refused: this is $HUB_SAYS. It runs Spark Console and Sparkie and is never set up to shut down.' >&2; exit 2; }
$REMOTE"
fi
for s in "${TARGETS[@]}"; do
  if [ "$UNDO" = 1 ] && is_hub "$s"; then
    # (the hub itself, straight from here: not through itself)
    echo "Taking the rule off $HUB_SAYS, the hub ($HOST) …"
    ssh "$HOST" 'mkdir -p ~/.cache/spark-console && cat > ~/.cache/spark-console/power-setup-remote.sh' <<<"$REMOTE"
    ssh -t "$HOST" "bash ~/.cache/spark-console/power-setup-remote.sh $UNDO" || echo "  $s: undo didn't finish"
    continue
  fi
  # (a Spark named by its number or id is reached at its address in hub.env)
  id=$(spark_of "$s" || true); [ -z "$id" ] || [ "$s" != "${s#*@}" ] || s=$(addr_of "$id")
  echo "Setting up $s (through $HUB_SAYS) …"
  # A terminal on the far side, so sudo can ask for that Spark's password.
  ssh "$HOST" "ssh -o ConnectTimeout=8 $s 'mkdir -p ~/.cache/spark-console && cat > ~/.cache/spark-console/power-setup-remote.sh'" <<<"$REMOTE"
  ssh -t "$HOST" "ssh -t -o ConnectTimeout=8 $s 'bash ~/.cache/spark-console/power-setup-remote.sh $UNDO'" || echo "  $s: setup didn't finish"
done
echo
echo "Done. Once the smart plugs are set up, Spark Console shuts a Spark down cleanly, then switches its plug off."
