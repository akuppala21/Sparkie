set -eu
d=$(cd "$(dirname "$0")" && pwd)
orig=$(realpath "${SPARKIE_REPLAY_SOURCE:?set the sealed experiment directory}")
p=$(cat "$orig/release-path")
cd "$d"
dest=${1:?provide a new absolute results path}
[[ "$dest" == /* ]]
mkdir -m 700 "$dest"
for arm in normal relay; do
 env -i SPARKIE_REPLAY_MACHINE_ID="${SPARKIE_REPLAY_MACHINE_ID:?set the pinned compute host identity}" HOME="$d" LANG=C.UTF-8 PATH=/usr/local/bin:/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 HERMES_ENABLE_PROJECT_PLUGINS=0 PYTHONPATH="$p/hermes" \
  timeout --signal=INT --kill-after=5s 60s "$orig/sealed-python/bin/python" replay.py batch-output "$arm" --controls --frozen "$orig/finalizer-preflight/frozen" --release "$p" --out "$dest/$arm" > "$dest/$arm.log" 2>&1 || { tail -10 "$dest/$arm.log"; exit 1; }
done
cmp "$dest/normal/controls.json" "$dest/relay/controls.json"
cat "$dest/relay/controls.json"
