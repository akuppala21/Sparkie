#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
p=$PWD
release=/opt/sparkie/releases/20261123-attachment1
dev=/opt/sparkie-dev/20261123-attachment1
args=()
for file in tools/terminal_tool.py tools/terminal_tool_result.py agent/replay_cleanup.py locales/en.yaml; do
 args+=(--mount "type=bind,src=$p/reviewed-runtime/$file,dst=$release/hermes/$file,readonly")
done
docker run --rm --init --network none --pull never --read-only --cpus 1 --memory 2g --pids-limit 128 --user 1000:1000 -w /tmp --cap-drop ALL --security-opt no-new-privileges:true \
 --tmpfs /tmp:rw,nosuid,nodev,size=384m,mode=1777 --mount "type=bind,src=$SOURCE_OPT,dst=/opt/sparkie,readonly" --mount "type=bind,src=$DEV_READY,dst=$dev,readonly" \
 --mount "type=bind,src=$p,dst=/inputs,readonly" "${args[@]}" -e HOME=/tmp -e HERMES_HOME=/tmp/fixture -e PYTHONDONTWRITEBYTECODE=1 -e HF_HUB_OFFLINE=1 \
 -e PYTHONPATH="$release/extension/src:$release/hermes" -e PATH="$dev/bin:/usr/local/bin:/usr/bin:/bin" \
 docker.io/nousresearch/hermes-sandbox@sha256:a561d383d4cf554cd98ca528a450574f86e0b3dcd9496d5b9b0fbd09482c6dd3 sh -euc '
   python3 -m pytest -q -p no:cacheprovider /inputs/sparkie/tests/test_remote_terminal_interrupt.py "$1/hermes/tests/gateway/test_stop_chat_scope.py"
   python3 /inputs/telegram_check.py
 ' sh "$release"
