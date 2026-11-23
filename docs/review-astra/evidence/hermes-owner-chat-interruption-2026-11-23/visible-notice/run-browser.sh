#!/usr/bin/env bash
set -euo pipefail
umask 077
if [[ $# != 4 ]]; then
  echo "Usage: bash run-browser.sh PACKAGE_OPT RELEASE MANIFEST_SHA NEW_RESULT_DIR" >&2
  exit 2
fi
base=$(realpath "$1")
release=$2
expected=$3
dir=$(realpath -m "$4")
mkdir "$dir"
inputs=$(cd "$(dirname "$0")" && pwd)
mode=$(python3 -c 'import uuid; print(uuid.uuid4().hex)')
name=sparkie-native-interrupt-$mode
cand=/opt/sparkie/releases/$release
test "$(sha256sum "$base/releases/$release/candidate.json" | cut -d' ' -f1)" = "$expected"
image=sha256:c268cfef5714cf58129c5b55b1da3871847a097f6f4e2a95e28546e099819414
test "$(docker image inspect "$image" --format '{{.Config.User}}')" = sandbox
scratch=$(mktemp -d)
cleanup() {
 if [[ -n "${gateway_id:-}" ]]; then docker stop --time 2 "$gateway_id" >/dev/null 2>&1 || true; fi
 if [[ -n "${box:-}" ]]; then docker stop --time 2 "$box" >/dev/null 2>&1 || true; fi
 rm -f "$dir/link" "$scratch/client" "$scratch/client.pub" "$scratch/known_hosts"
 rmdir "$scratch"
}
trap cleanup EXIT
alias=sparkie-workspace-$(python3 -c 'import uuid;print(uuid.uuid4().hex)')
ssh-keygen -q -t ed25519 -N '' -C fixture-only -f "$scratch/client"
box=$(docker run --name "sparkie-interrupt-sandbox-$mode" --user sandbox --rm --init --network none --pull never --read-only --cap-drop ALL --security-opt no-new-privileges --cpus 1 --memory 512m --pids-limit 96 --tmpfs /run:rw,noexec,nosuid,size=16m,uid=12001,gid=12001,mode=0700 --tmpfs /tmp:rw,nosuid,nodev,size=128m --tmpfs /home/sandbox:rw,nosuid,nodev,size=40m,uid=12001,gid=12001,mode=0700 --tmpfs /workspace:rw,nosuid,nodev,size=32m,uid=12001,gid=12001,mode=0700 -d "$image" sleep infinity)
docker exec "$box" sh -euc 'mkdir -p /run/ssh /run/sshd; ssh-keygen -q -t ed25519 -N "" -C fixture-only -f /run/ssh/host_key'
docker exec -i "$box" sh -c 'umask 077; cat > /run/ssh/authorized_keys' < "$scratch/client.pub"
printf '%s %s\n' "$alias" "$(docker exec "$box" cat /run/ssh/host_key.pub | cut -d' ' -f1-2)" > "$scratch/known_hosts"
chmod 600 "$scratch/known_hosts"
docker exec -i "$box" sh -c 'umask 077; cat > /run/ssh/sshd_config' <<'SSHD'
Port 2222
ListenAddress 127.0.0.1
HostKey /run/ssh/host_key
AuthorizedKeysFile /run/ssh/authorized_keys
PidFile /run/ssh/sshd.pid
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AuthenticationMethods publickey
PermitRootLogin no
UsePAM no
AllowUsers sandbox
AllowTcpForwarding no
AllowAgentForwarding no
X11Forwarding no
PermitTunnel no
PermitUserEnvironment no
StrictModes yes
Subsystem sftp internal-sftp
SSHD
docker exec "$box" sh -c 'printf "RAW-EVIDENCE-KITE-5807\nbeta=7\n" > /tmp/interrupt-proof.txt'
docker exec -d "$box" /usr/sbin/sshd -D -e -E /tmp/sshd.log -f /run/ssh/sshd_config
overlays=()
if [[ -n "${PATCHED_NATIVE:-}" ]]; then
 for file in agent/message_sanitization.py; do
  overlays+=(--mount "type=bind,src=$PATCHED_NATIVE/$file,dst=$cand/hermes/$file,readonly")
 done
fi
gateway_id=$(docker run "${overlays[@]}" --user "$(id -u):$(id -g)" --rm --init --network "container:$box" --mount "type=bind,src=$scratch,dst=/keys,readonly" -e "TEST_CONTAINER_ID=$box" -e "TEST_SANDBOX_IMAGE=$image" --cpus 1 --memory 2g --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:rw,nosuid,nodev,size=512m --mount "type=bind,src=$base,dst=/opt/sparkie,readonly" --mount "type=bind,src=$inputs,dst=/inputs,readonly" --mount "type=bind,src=$dir,dst=/results" -e "WEB_FIXTURE=$mode" -e HOME=/tmp/owner -e HERMES_HOME=/tmp/owner/.hermes -e "CANDIDATE=$cand" -e HERMES_ENABLE_PROJECT_PLUGINS=0 -e HERMES_DISABLE_LAZY_INSTALLS=1 -e "HERMES_WEBAPP_DIST=$cand/webapp" -e "HERMES_WEB_DIST=$cand/dashboard" -e "HERMES_BUNDLED_PLUGINS=$cand/bundled-plugins" -e HF_HUB_OFFLINE=1 -e PYTHONDONTWRITEBYTECODE=1 -e "PYTHONPATH=$cand/extension/src:$cand/hermes" --name "$name" -d sha256:b7087bc4d973034b30854b378ba107f9fab622b47514cb7e2592e41b8bab8d49 sh -c '"$CANDIDATE/hermes/.venv/bin/python" /inputs/gateway_fixture.py > /results/bootstrap.log 2>&1')

for i in {1..60}; do [ ! -s "$dir/link" ] || break; docker inspect "$name" >/dev/null 2>&1 || break; sleep 1; done
if [ ! -s "$dir/link" ]; then tail -12 "$dir/bootstrap.log" 2>/dev/null || true; cat "$dir/server-info.txt" 2>/dev/null || true; echo "No fixture launch link"; exit 2; fi
docker exec -i "$box" sh -c 'cat >/workspace/stop_probe.py' < "$inputs/probe.py"
docker exec "$box" sh -c 'printf "%s" "$1" >/workspace/expected-exit' sh "${PROBE_EXIT:-0}"
python3 "$inputs/observe.py" "$box" "$dir" &
observer=$!
browser_status=0
docker run --name "sparkie-interrupt-browser-$mode" --user "$(id -u):$(id -g)" --rm --init --network "container:$name" --cpus 1 --memory 1g --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:rw,nosuid,nodev,size=384m --mount "type=bind,src=$inputs/browser.cjs,dst=/driver.cjs,readonly" --mount "type=bind,src=$dir,dst=/results" -e HOME=/tmp -e "STOP_CASE=${STOP_CASE:?use normal or stop}" -e "UPLOAD_VIEWPORT=${UPLOAD_VIEWPORT:-desktop}" sha256:6f709680a833f887a5af2a1b34a6cea7990d40b1784b345314e52dbe08a05cf3 node /driver.cjs || browser_status=$?
for i in {1..24}; do [ -e "$dir/link" ] || break; sleep 1; done
test -s "$dir/browser.json"
test -s "$dir/durable.json"
test ! -e "$dir/link"
wait "$observer"
test -f "$dir/physical-done"
exit "$browser_status"
