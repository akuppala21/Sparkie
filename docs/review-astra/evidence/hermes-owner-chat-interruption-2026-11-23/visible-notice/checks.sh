#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
p=$PWD
r=/opt/sparkie/releases/20261123-ownerstop1
dev=/opt/sparkie-dev/20261123-attachment1
docker run --rm --init --network none --pull never --read-only --cpus 1 --memory 2g --pids-limit 128 --user 1000:1000 -w /tmp --cap-drop ALL --security-opt no-new-privileges:true \
 --tmpfs /tmp:rw,nosuid,nodev,size=384m,mode=1777 --mount "type=bind,src=$SOURCE_OPT,dst=/opt/sparkie,readonly" \
 --mount "type=bind,src=$DEV_READY,dst=$dev,readonly" --mount "type=bind,src=$p,dst=/inputs,readonly" \
 --mount "type=bind,src=$p/reviewed-runtime/agent/message_sanitization.py,dst=$r/hermes/agent/message_sanitization.py,readonly" \
 -e HOME=/tmp -e HERMES_HOME=/tmp/fixture -e PYTHONDONTWRITEBYTECODE=1 -e HF_HUB_OFFLINE=1 \
 -e PYTHONPATH="$r/extension/src:$r/hermes:$r/hermes/.venv/lib/python3.14/site-packages" -e PATH="$dev/bin:/usr/local/bin:/usr/bin:/bin" \
 docker.io/nousresearch/hermes-sandbox@sha256:a561d383d4cf554cd98ca528a450574f86e0b3dcd9496d5b9b0fbd09482c6dd3 sh -euc '
 python3 -m pytest -q -p no:cacheprovider /inputs/sparkie/tests/test_remote_terminal_interrupt.py
 python3 -m pytest -q -p no:cacheprovider /inputs/sparkie/tests/test_check_selection.py -k remote_stop_changes_select
 '
