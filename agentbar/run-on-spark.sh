#!/bin/bash
# Runs the agent bar on a Spark that has Docker but maybe no Node.js: builds the trial image, then runs the runner
# (agentbar/run.mjs) in it, talking to this Spark's Docker to start each run's own container. The repository is
# mounted at the same path inside, so the runs' folders mean the same thing to both. Same options as run.mjs:
#
#   bash agentbar/run-on-spark.sh                       both engines, every task, 3 runs each (hours)
#   bash agentbar/run-on-spark.sh --runs 1 --tasks diagnose-crash
#
# For the long run, leave it going after you log out:
#   nohup bash agentbar/run-on-spark.sh > agentbar/trial.log 2>&1 &
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(dirname "$HERE")"
SOCK=/var/run/docker.sock
[ -S "$SOCK" ] || { echo "No Docker on this machine ($SOCK is missing)." >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "This user can't use Docker here (add it to the docker group, then log in again)." >&2; exit 1; }
echo "Building the trial image (both engines, pinned versions) …"
docker build -q -t spark-agentbar "$HERE" >/dev/null
exec docker run --rm --network host \
  --user "$(id -u):$(id -g)" --group-add "$(stat -c %g "$SOCK")" \
  -v "$SOCK:$SOCK" -v "$REPO:$REPO" -w "$REPO" -e HOME=/tmp/runner \
  spark-agentbar node agentbar/run.mjs --no-build "$@"
