#!/usr/bin/env bash
# Runs the test suite on a Spark and brings the log back (2026-11-13: the whole suite takes about 10 minutes there,
# against one to three hours on the Mac, whose security software checks every process the stand-in fleet starts).
#
# The tests run inside a container that has no network and no access to Docker, as the Spark's own user, and can write
# only the copy of this folder. They can't touch a model, a container or anything else on the Spark.
#
#   tools/test-on-spark.sh akuppala@<spark>            the whole suite once (test/lock.mjs)
#   tools/test-on-spark.sh akuppala@<spark> --watch    wait for requests and run each (leave it running in a terminal)
#
# With --watch it looks at ../spark-test-runs/run-now once a second. An empty file means the whole suite; a file that
# lists test files (test/apps.test.mjs, one per line or space) means only those. Each run leaves
# ../spark-test-runs/run-<time>.log and latest.log; a whole-suite pass also leaves workflows.lock.json there, which
# names the build it tested (copy it to service/ only when that build is the one in this folder).
# Never on Spark 2: it is the hub. Use a compute Spark that is on.
set -u
HOST=${1:?Say which Spark: tools/test-on-spark.sh akuppala@<address> [--watch]}
MODE=${2:-once}
HERE=$(cd "$(dirname "$0")/.." && pwd)
OUT=${SPARK_TEST_OUT:-$HERE/../spark-test-runs}
IMAGE=${SPARK_TEST_IMAGE:-node:26-bookworm}
SLOW=${SPARK_TEST_SLOW:-1}
CONC=${SPARK_TEST_CONCURRENCY:-4}
case "$SLOW$CONC" in *[!0-9]*) echo "SPARK_TEST_SLOW and SPARK_TEST_CONCURRENCY are whole numbers." >&2; exit 2 ;; esac
mkdir -p "$OUT"

# $1: the test files to run, already checked; empty for the whole suite.
run_once() {
  local files=$1 stamp inner
  stamp=$(date +%Y%m%d-%H%M%S)
  if [ -n "$files" ]; then inner="time node --test --test-concurrency=$CONC $files"; else inner="time node test/lock.mjs"; fi
  echo "$(date +%H:%M:%S) copying this folder to $HOST and running: ${files:-the whole suite}"
  rsync -a --delete --exclude .claude --exclude .git --exclude node_modules "$HERE/" "$HOST:sparkie-tests/" || { echo "The copy failed (is the Spark on?)."; return 1; }
  ssh "$HOST" "cd ~/sparkie-tests && docker run --rm --network none --user \$(id -u):\$(id -g) -e HOME=/tmp -e SPARK_TEST_STRICT=1 -e SPARK_TEST_SLOW=$SLOW -e SPARK_TEST_CONCURRENCY=$CONC -v \"\$PWD\":/w -w /w $IMAGE bash -c '$inner' > ~/sparkie-tests-run.log 2>&1; echo \"exit=\$?\" >> ~/sparkie-tests-run.log"
  scp -q "$HOST:sparkie-tests-run.log" "$OUT/run-$stamp.log" || { echo "Couldn’t bring the log back."; return 1; }
  cp "$OUT/run-$stamp.log" "$OUT/latest.log"
  rm -f "$OUT/workflows.lock.json"
  if grep -q "^Marked build" "$OUT/latest.log"; then scp -q "$HOST:sparkie-tests/service/workflows.lock.json" "$OUT/workflows.lock.json"; fi
  grep -E "^ℹ (tests|pass|fail)|^real|^Marked build|didn.t pass|^exit=" "$OUT/latest.log"
  echo "$(date +%H:%M:%S) done: $OUT/run-$stamp.log"
}

# The request file's words, kept only if every one is a test file's name.
asked() {
  local words w ok=""
  words=$(tr '\n' ' ' < "$OUT/run-now")
  for w in $words; do
    case "$w" in test/*.test.mjs) ;; *) echo "Not a test file, so nothing ran: $w" >&2; return 1 ;; esac
    case "$w" in *[!A-Za-z0-9./_-]*|*..*) echo "Not a test file, so nothing ran: $w" >&2; return 1 ;; esac
    ok="$ok $w"
  done
  echo "$ok"
}

if [ "$MODE" != "--watch" ]; then run_once ""; exit $?; fi
echo "Waiting for requests in $OUT/run-now (Ctrl-C stops this)."
while true; do
  if [ -e "$OUT/run-now" ]; then
    files=$(asked) && { rm -f "$OUT/run-now" "$OUT/done"; run_once "$files"; echo "$?" > "$OUT/done"; } || rm -f "$OUT/run-now"
  fi
  sleep 1
done
