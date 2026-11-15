#!/usr/bin/env bash
# Runs the test suite on a Spark and brings the log back (2026-11-13: the whole suite takes about 12 minutes there,
# against one to three hours on the Mac, whose security software checks every process the stand-in fleet starts).
#
# The tests run inside a container that has no network and no access to Docker, as the Spark's own user, and can write
# only the copy of the folder being tested. They can't touch a model, a container or anything else on the Spark.
# Never on Spark 2: it is the hub. Use a compute Spark that is on.
#
#   tools/test-on-spark.sh akuppala@<spark>            this folder's whole suite, once (test/lock.mjs)
#   tools/test-on-spark.sh akuppala@<spark> --watch    wait for requests and run them one at a time (leave it running)
#   tools/test-on-spark.sh --ask [test files…]         from inside any Spark Console work folder: ask the watcher to
#                                                      run that folder's tests (the whole suite when no file is named),
#                                                      wait, and print the result. It makes no connection itself.
#
# The watcher serves every work folder beside this one whose name starts with spark-console (the main folder and the
# branches' worktrees), so builders in other folders use the same Spark. A request is a small file in
# ../spark-test-runs/queue/<name>.req: an optional line tree=<folder name>, optional slow=<n> and conc=<n>, and test
# files (test/apps.test.mjs). The answer is ../spark-test-runs/<name>.log and <name>.done (the exit code); a whole-suite
# pass also leaves <name>.lock.json, which names the build it tested (copy it to service/ only when that build is the
# one in the folder), and <name>.affected-map.json, which test files ran each function (tools/affected.mjs): the whole
# suite runs with SPARK_TEST_MAP=1 and SPARK_TEST_TREE, git's hash of the files copied (taken here before and after
# the copy, kept only when the two agree). An empty file ../spark-test-runs/run-now still means "the main folder's
# whole suite", answered in latest.log, done and workflows.lock.json. tools/land.mjs queues a request the same way.
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
BASE=$(dirname "$HERE")
OUT=${SPARK_TEST_OUT:-$BASE/spark-test-runs}
IMAGE=${SPARK_TEST_IMAGE:-node:26-bookworm}
DSLOW=${SPARK_TEST_SLOW:-2}   # (1 ran four files side by side with one timing miss in 996; 2 doubles the waits' limits, not the run)
DCONC=${SPARK_TEST_CONCURRENCY:-4}
case "$DSLOW$DCONC" in *[!0-9]*) echo "SPARK_TEST_SLOW and SPARK_TEST_CONCURRENCY are whole numbers." >&2; exit 2 ;; esac
mkdir -p "$OUT/queue"
SUMMARY='^ℹ (tests|pass|fail|cancelled)|^real|^Marked build|^Wrote test/affected-map|didn.t pass|^exit='

if [ "${1:-}" = "--ask" ]; then
  shift
  top=$PWD
  while [ "$top" != "/" ] && [ ! -f "$top/test/lock.mjs" ]; do top=$(dirname "$top"); done
  [ -f "$top/test/lock.mjs" ] || { echo "Run this from inside a Spark Console work folder." >&2; exit 2; }
  name="$(basename "$top")-$(date +%H%M%S)-$$"
  { echo "tree=$(basename "$top")"; for f in "$@"; do echo "$f"; done; } > "$OUT/queue/$name.tmp" || exit 2
  mv "$OUT/queue/$name.tmp" "$OUT/queue/$name.req"
  echo "Asked for a run on the Spark: $name (the watcher runs one at a time, so it may wait its turn)."
  quiet=0
  until [ -e "$OUT/$name.done" ]; do
    sleep 2
    # No watcher is there to take it: the request has sat in the queue with nothing running for 2 minutes on end.
    # (Counted in a row: between two requests nothing runs for a second or two, and one look in that gap once
    # dropped a request that was only waiting its turn, 2026-11-14.)
    if [ -e "$OUT/queue/$name.req" ] && [ ! -e "$OUT/running.req" ]; then quiet=$((quiet + 2)); else quiet=0; fi
    if [ "$quiet" -ge 120 ]; then
      rm -f "$OUT/queue/$name.req"
      echo "No watcher took the request in 2 minutes, so nothing ran. The owner starts one with: bash $HERE/tools/test-on-spark.sh akuppala@<spark> --watch" >&2
      exit 3
    fi
  done
  grep -E "$SUMMARY|^✖|^Not |^The copy" "$OUT/$name.log" 2>/dev/null | head -80
  echo "Whole log: $OUT/$name.log"
  [ "$(cat "$OUT/$name.done")" = "0" ] && grep -q '^exit=0' "$OUT/$name.log"
  exit $?
fi

HOST=${1:?Say which Spark: tools/test-on-spark.sh akuppala@<address> [--watch]   (or: --ask [test files])}
MODE=${2:-once}

# git's hash of a folder's files as test/lock.mjs names them (its gitFields: a throwaway index, the lock left out), or
# nothing without git.
tree_of() {
  local idx; idx=$(mktemp -d) || return 0
  ( cd "$1" && export GIT_INDEX_FILE="$idx/index" && { ! git rev-parse -q --verify 'HEAD^{tree}' > /dev/null || git read-tree HEAD; } \
    && git add -A . && git rm --cached -q --ignore-unmatch service/workflows.lock.json && git write-tree ) 2> /dev/null
  rm -rf "$idx"
}

# $1 folder to test, $2 its folder name on the Spark, $3 test files (already checked; empty = whole suite), $4 slow,
# $5 files at once, $6 the name the answer is filed under.
run_once() {
  local dir=$1 remote=$2 files=$3 slow=$4 conc=$5 name=$6 inner map="" tree=""
  if [ -n "$files" ]; then inner="time node --test --test-concurrency=$conc $files"; else inner="time node test/lock.mjs"; map="-e SPARK_TEST_MAP=1"; tree=$(tree_of "$dir"); fi
  echo "$(date +%H:%M:%S) $name: copying $(basename "$dir") to $HOST and running: ${files:-the whole suite}"
  rsync -a --delete --exclude .claude --exclude .git --exclude node_modules "$dir/" "$HOST:$remote/" || { echo "The copy failed (is the Spark on?)." | tee "$OUT/$name.log"; return 1; }
  if [ -n "$tree" ] && [ "$tree" = "$(tree_of "$dir")" ]; then map="$map -e SPARK_TEST_TREE=$tree"; fi
  ssh "$HOST" "cd ~/$remote && docker run --rm --network none --user \$(id -u):\$(id -g) -e HOME=/tmp -e SPARK_TEST_STRICT=1 -e SPARK_TEST_SLOW=$slow -e SPARK_TEST_CONCURRENCY=$conc $map -v \"\$PWD\":/w -w /w $IMAGE bash -c '$inner' > ~/$remote-run.log 2>&1; echo \"exit=\$?\" >> ~/$remote-run.log"
  scp -q "$HOST:$remote-run.log" "$OUT/$name.log" || { echo "Couldn’t bring the log back." | tee "$OUT/$name.log"; return 1; }
  rm -f "$OUT/$name.lock.json" "$OUT/$name.affected-map.json"
  if grep -q "^Marked build" "$OUT/$name.log"; then
    scp -q "$HOST:$remote/service/workflows.lock.json" "$OUT/$name.lock.json"
    if grep -q "^Wrote test/affected-map.json" "$OUT/$name.log"; then scp -q "$HOST:$remote/test/affected-map.json" "$OUT/$name.affected-map.json"; fi
  fi
  grep -E "$SUMMARY" "$OUT/$name.log"
  echo "$(date +%H:%M:%S) $name: done"
  grep -q '^exit=0' "$OUT/$name.log"
}

# Reads one request and runs it. Anything it doesn't understand runs nothing.
run_req() {
  local req=$1 name=$2 tree slow=$DSLOW conc=$DCONC files="" line w
  tree=$(basename "$HERE")
  refuse() { echo "Not run: $1" | tee "$OUT/$name.log" >&2; return 2; }
  while IFS= read -r line || [ -n "$line" ]; do
    for w in $line; do
      case "$w" in
        tree=*) tree=${w#tree=} ;;
        slow=*) slow=${w#slow=} ;;
        conc=*) conc=${w#conc=} ;;
        test/*.test.mjs) case "$w" in *[!A-Za-z0-9./_-]*|*..*) refuse "not a test file: $w"; return 2 ;; esac; files="$files $w" ;;
        *) refuse "not understood: $w"; return 2 ;;
      esac
    done
  done < "$req"
  case "$tree" in spark-console|spark-console-*) ;; *) refuse "not a Spark Console folder: $tree"; return 2 ;; esac
  case "$tree" in *[!A-Za-z0-9._-]*|*..*) refuse "not a folder name: $tree"; return 2 ;; esac
  case "$slow$conc" in ''|*[!0-9]*) refuse "slow and conc are whole numbers"; return 2 ;; esac
  [ -f "$BASE/$tree/test/lock.mjs" ] || { refuse "no such work folder: $tree"; return 2; }
  run_once "$BASE/$tree" "sparkie-tests-$tree" "$files" "$slow" "$conc" "$name"
}

if [ "$MODE" != "--watch" ]; then
  run_once "$HERE" "sparkie-tests-$(basename "$HERE")" "" "$DSLOW" "$DCONC" latest
  rc=$?; [ -f "$OUT/latest.lock.json" ] && cp "$OUT/latest.lock.json" "$OUT/workflows.lock.json"; exit $rc
fi
# One watcher at a time: two would take the same request and run it twice into one folder on the Spark.
other=$(cat "$OUT/watcher.pid" 2>/dev/null)
case "$other" in ''|*[!0-9]*) other="" ;; esac
if [ -n "$other" ] && [ "$other" != "$$" ] && kill -0 "$other" 2>/dev/null && ps -o command= -p "$other" 2>/dev/null | grep -q "test-on-spark.sh"; then
  echo "A watcher is already running (process $other), so this one is not needed. Nothing to do here."
  exit 0
fi
echo "$$" > "$OUT/watcher.pid"
trap 'if [ "$(cat "$OUT/watcher.pid" 2>/dev/null)" = "$$" ]; then rm -f "$OUT/watcher.pid"; fi' EXIT
trap 'exit 130' INT TERM
echo "Waiting for requests in $OUT/queue (Ctrl-C stops this)."
while true; do
  if [ -e "$OUT/run-now" ]; then rm -f "$OUT/done" "$OUT/workflows.lock.json"; mv "$OUT/run-now" "$OUT/queue/latest.req"; fi
  req=$(ls -tr "$OUT/queue"/*.req 2>/dev/null | head -1)
  if [ -n "$req" ]; then
    name=$(basename "$req" .req)
    rm -f "$OUT/$name.done"
    mv "$req" "$OUT/running.req" 2>/dev/null || { sleep 1; continue; }
    run_req "$OUT/running.req" "$name"; rc=$?
    rm -f "$OUT/running.req"
    echo "$rc" > "$OUT/$name.done"
    if [ "$name" = latest ]; then [ -f "$OUT/latest.lock.json" ] && cp "$OUT/latest.lock.json" "$OUT/workflows.lock.json"; echo "$rc" > "$OUT/done"; fi
  fi
  sleep 1
done
