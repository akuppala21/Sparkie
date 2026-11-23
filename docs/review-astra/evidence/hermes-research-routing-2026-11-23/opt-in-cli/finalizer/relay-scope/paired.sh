#!/bin/bash
# Compare two native summary sends per case on the specified compute host.
set -euo pipefail
umask 077
here=$(cd "$(dirname "$0")" && pwd)
orig=$(realpath "${SPARKIE_REPLAY_SOURCE:?set this to the sealed opt-in replay directory}")
: "${SPARKIE_REPLAY_MACHINE_ID:?set this to the pinned compute host identity}"
workspace=$(dirname "$orig")
preflight="$orig/finalizer-preflight"
release=$(cat "$orig/release-path")
mode=${1:-dry}
destination=${2:?provide a new absolute results path}
[[ "$destination" == /* ]]
args=()
case "$mode" in
  dry) [[ $# -eq 2 ]] ;;
  leased)
    [[ $# -eq 4 ]]
    identity=$(realpath "$3")
    deadline=$4
    [[ "$deadline" =~ ^[0-9]+$ ]]
    # Time for cold startup, bounded dispatch and queue drain on all six arms.
    (( deadline - $(date +%s) >= 950 ))
    exec 9>>"$workspace/native-case.lock"
    flock -w 8 9 || exit 75
    args=(--lease-identity "$identity")
    ;;
  *) exit 2 ;;
esac
mkdir -m 700 "$destination"
# Alternate which condition goes first across the three fixed pairs.
for spec in 'batch-output normal' 'batch-output relay' 'serial-check relay' 'serial-check normal' 'running-worker normal' 'running-worker relay'; do
  read -r case_id arm <<< "$spec"
  mkdir -p "$destination/$case_id"
  out="$destination/$case_id/$arm"
  if [[ "$mode" == leased ]]; then
    (( deadline - $(date +%s) >= 155 ))
    python3 "$preflight/idle.py" "$out.initial-idle.json"
    python3 "$workspace/flush.py" > "$out.flush.json"
  fi
  status=0
  env -i SPARKIE_REPLAY_MACHINE_ID="$SPARKIE_REPLAY_MACHINE_ID" HOME="$here" LANG=C.UTF-8 PATH=/usr/local/bin:/usr/bin:/bin HERMES_ENABLE_PROJECT_PLUGINS=0 PYTHONDONTWRITEBYTECODE=1 PYTHONPATH="$release/hermes" \
    /usr/bin/time -f %e -o "$out.elapsed" timeout --signal=INT --kill-after=10s 100s "$orig/sealed-python/bin/python" "$here/replay.py" "$case_id" "$arm" \
    --release "$release" --frozen "$preflight/frozen" --out "$out" "${args[@]}" > "$out.log" 2>&1 || status=$?
  echo "$status" > "$out.exit"
  if [[ "$mode" == leased ]]; then
    python3 "$preflight/idle.py" "$out.idle.json"
    python3 "$here/cleanup_check.py" "$out"
    [[ "$status" == 0 || "$status" == 124 || "$status" == 137 ]] || exit "$status"
  else
    [[ "$status" == 0 ]] || exit "$status"
  fi
done
python3 "$here/blind.py" "$destination"
