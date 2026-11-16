#!/bin/bash
# Runs the coding trial (agentbar/trial.mjs, R67) on a compute Spark that has Docker, with or without Node.js: builds
# the runner's image, then runs the runner in it, talking to this Spark's Docker to start each run's box. The box has
# no network; the runner reaches only the brain, at the one model address. The repository is mounted at the same path
# inside, so the runs' folders mean the same thing to both. Never on Spark 2 (a box is a workload). Use a copy of the
# repository at the build Spark Console runs, with Sparkie's model up. The same options as trial.mjs:
#
#   bash agentbar/trial-on-spark.sh                              every task, 3 runs each (an hour or two)
#   bash agentbar/trial-on-spark.sh --runs 1 --tasks day-words   a try (Spark Console keeps no record of it)
#
# To leave it going after you log out:
#   nohup bash agentbar/trial-on-spark.sh > agentbar/trial.log 2>&1 &
# Safe beside a model: a run's box starts only with 16 GB free beyond the 8 GB kept for the system, ends by itself after
# its task's time and the grade's, and goes when the runner is stopped (Ctrl-C here, the session dropping, docker stop:
# docker run passes the signal on, and --init hands it to the runner).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(dirname "$HERE")"
SOCK=/var/run/docker.sock
[ -S "$SOCK" ] || { echo "No Docker on this machine ($SOCK is missing)." >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "This user can't use Docker here (add it to the docker group, then log in again)." >&2; exit 1; }
echo "Building the trial's runner image …"
docker build -q -t spark-trial - < "$HERE/trial.Dockerfile" >/dev/null
exec docker run --rm --init --network host \
  --user "$(id -u):$(id -g)" --group-add "$(stat -c %g "$SOCK")" \
  -v "$SOCK:$SOCK" -v "$REPO:$REPO" -w "$REPO" -e HOME=/tmp/runner \
  spark-trial node agentbar/trial.mjs "$@"
