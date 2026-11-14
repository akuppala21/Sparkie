#!/usr/bin/env bash
# One-time setup so Spark Console can shut a Spark down cleanly before its smart plug cuts the power.
# (DGX Spark can't be woken over the network, so turning it back on is the plug's job: power returns and the Spark boots,
# which needs the firmware's "After Power Loss Behavior" set to Auto Boot; that's the default on NVIDIA's own model.)
# Run it from your Mac; sudo asks for each Spark's password once.
#
#   bash spark-console/deploy/power-setup.sh                 Spark 3 and Spark 4
#   bash spark-console/deploy/power-setup.sh 100.122.49.9    just one Spark (its Tailscale address)
#   bash spark-console/deploy/power-setup.sh --undo [...]    remove it again
#
# On each Spark it adds one sudo rule that lets your account run exactly two commands without a password, and nothing
# else (/etc/sudoers.d/spark-console-power, checked with visudo before it's put in place):
#   systemctl stop nvidia-persistenced   (NVIDIA's workaround: headless shutdowns can hang in it on kernel 7.0.0-1019)
#   systemctl poweroff
# Spark 2 is never set up here: it runs Spark Console and stays on.
set -euo pipefail
UNDO=0
[ "${1:-}" = --undo ] && { UNDO=1; shift; }
if [ $# -eq 0 ]; then SPARKS=(100.122.49.9 100.109.240.15); else SPARKS=("$@"); fi

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

HOST="${SPARK2:-akuppala@100.79.155.126}"
for s in "${SPARKS[@]}"; do
  echo "Setting up $s (through Spark 2) …"
  # A terminal on the far side, so sudo can ask for that Spark's password.
  ssh "$HOST" "ssh -o ConnectTimeout=8 $s 'mkdir -p ~/.cache/spark-console && cat > ~/.cache/spark-console/power-setup-remote.sh'" <<<"$REMOTE"
  ssh -t "$HOST" "ssh -t -o ConnectTimeout=8 $s 'bash ~/.cache/spark-console/power-setup-remote.sh $UNDO'" || echo "  $s: setup didn't finish"
done
echo
echo "Done. Once the smart plugs are set up, Spark Console shuts a Spark down cleanly, then switches its plug off."
