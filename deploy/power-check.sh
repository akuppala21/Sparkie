#!/usr/bin/env bash
# Read-only check of what each Spark supports for remote power off / wake-up. Changes nothing.
#   bash spark-console/deploy/power-check.sh
# Runs on the hub over SSH, and from there on every compute Spark (the hub reaches them without a password). Which Spark
# is the hub, and the others' addresses, come from deploy/hub.env: Spark 3's address, for one, is
#   sed -n 's/^spark3=//p' spark-console/deploy/hub.env
set -euo pipefail
. "$(dirname "$0")/hub.sh"
HOST="$HUB_HOST"
PEERS=''; NAMES=''
for s in $COMPUTE; do PEERS="$PEERS $(addr_of "$s")"; NAMES="$NAMES, $(says_of "$s")"; done
PEERS=${PEERS# } NAMES=${NAMES#, }

read -r -d '' CHECK <<'EOF' || true
echo "=== $(hostname)  ($(cat /sys/class/dmi/id/sys_vendor 2>/dev/null) $(cat /sys/class/dmi/id/product_name 2>/dev/null), BIOS $(cat /sys/class/dmi/id/bios_version 2>/dev/null))"
echo "kernel $(uname -r) · sleep states: $(cat /sys/power/state 2>/dev/null) · mem_sleep: $(cat /sys/power/mem_sleep 2>/dev/null)"
echo "default route: $(ip -4 route show default 2>/dev/null | head -1)"
for i in /sys/class/net/*; do
  n=$(basename "$i"); [ -e "$i/device" ] || continue
  drv=$(basename "$(readlink "$i/device/driver" 2>/dev/null)" 2>/dev/null)
  echo "  nic $n  mac=$(cat "$i/address")  state=$(cat "$i/operstate")  speed=$(cat "$i/speed" 2>/dev/null || echo -)  driver=$drv  wakeup=$(cat "$i/device/power/wakeup" 2>/dev/null || echo -)  ip=$(ip -4 -o addr show dev "$n" 2>/dev/null | awk '{print $4}' | paste -sd, -)"
done
if command -v ethtool >/dev/null && sudo -n true 2>/dev/null; then
  for i in /sys/class/net/*; do n=$(basename "$i"); [ -e "$i/device" ] || continue; echo "  $n: $(sudo -n ethtool "$n" 2>/dev/null | grep -i 'wake-on' | tr -s ' \n' ' ')"; done
else
  echo "  (Wake-on-LAN details need sudo; skipped)"
fi
echo "  power readings:"; nvidia-smi -q -d POWER 2>/dev/null | grep -iE 'power draw|module|limit' | head -8 | sed 's/^/    /'
for h in /sys/class/hwmon/hwmon*; do printf '    hwmon %s: %s\n' "$(basename "$h")" "$(cat "$h/name" 2>/dev/null)"; done
echo "  passwordless poweroff: $(sudo -n -l /usr/bin/systemctl poweroff >/dev/null 2>&1 && echo yes || echo no)"
EOF

echo "Checking from $HUB_SAYS, the hub ($HOST), then from there on the compute Sparks: $NAMES …"
ssh -o ConnectTimeout=10 "$HOST" "bash -s" <<<"$CHECK"
for p in $PEERS; do
  ssh -o ConnectTimeout=10 "$HOST" "ssh -o BatchMode=yes -o ConnectTimeout=8 $p 'bash -s'" <<<"$CHECK" || echo "=== $p: couldn't reach it from $HUB_SAYS"
done
