#!/usr/bin/env bash
# Installs or updates Spark Console on Spark 2 (the name is from when it ran next to the original portal):
#   https://<Spark 2>:8443/console/      the UI (static files; :8443/ serves the same folder since the portal's cutover)
#   https://<Spark 2>:8443/console/api/  its service: status, live metrics, models, deploys, chats, files, VS Code
# The :8443/ route is left alone here; deploy/cutover.sh owns it.
#
#   bash spark-console/deploy/host-on-portal.sh [user@host]
#
# Run it again to push updates; sudo is only needed the first time, to add the two routes.
#   NOTE='what changed, in plain words' bash spark-console/deploy/host-on-portal.sh   puts that line on the console's update record (no secrets in it)
# Every update first saves what's installed, with its state, in ~/.local/share/spark-console/releases/<time>/ on
# Spark 2 (the newest 10 are kept) and prints the command that puts it back. The update is kept only if the new service
# answers, keeps running as the same process for 40 seconds, still knows the owner, answers at the agent door and the
# model address, Sparkie answers one chat turn with a tool call, and Telegram polls again if it did before; on any miss,
# or a copy that fails part-way, the previous files go back on their own. SKIP_CHAT_CHECK=1 updates without the chat
# turn (for when Sparkie's model is down).
# If Spark Console ever stops answering, on Spark 2: bash ~/.local/share/spark-console/go-back.sh puts the last build
# back (every install copies it there; RECOVERY.txt beside it lists the other by-hand steps).
# On Spark 2 without the Mac, deploy/pull.sh installs a tested build from GitHub with `local` and SKIP_ROUTES=1: then
# nothing here calls tailscale, sudo or ssh (the routes on 8443 and the other Sparks' reach aren't checked).
# To remove Spark Console:
#   ssh -t <host> 'sudo tailscale serve --https=8443 --set-path=/console/ off; sudo tailscale serve --https=8443 --set-path=/console/api off;
#                  systemctl --user disable --now spark-console-api'
#   (the saved snapshots, chats included, stay in ~/.local/share/spark-console on Spark 2 until you delete them)
set -euo pipefail
HOST="${1:-akuppala@100.79.155.126}"
# (--stand-in, after the host: the stand-in fleet's tests, through pull.sh; it reaches install.sh as an argument only)
STAND_IN=''; [ "${2:-}" != --stand-in ] || STAND_IN=' --stand-in'
HERE="$(cd "$(dirname "$0")/.." && pwd)"
# The page's files, one a line in this order: the page's build stamp is the hash of them read in this order.
UI_FILES=(
  index.html
  app.js
  styles.css
  theme.js
  qr.js
  favicon.svg
  nvidia-logo-white.svg
  nvidia-logo-black.svg
  manifest.webmanifest
  icon-192.png
  icon-512.png
  icon-maskable-512.png
  apple-touch-icon.png
)
# The service's files, one a line, in name order.
SERVICE_FILES=(
  catalog.json
  config.json
  dig.mjs
  passkey.mjs
  server.mjs
  worker.py
  workflows.lock.json
)
# The by-hand way back, kept at a fixed path on Spark 2 (~/.local/share/spark-console/): deploy/RECOVERY.txt says how.
RECOVERY_FILES=(go-back.sh RECOVERY.txt)
# pull.sh (the install from GitHub) and update-guard.sh (its way back) go there too, but only once the build they came
# with is kept: they judge the next.
RECOVERY_FILES+=(pull.sh update-guard.sh)
RECOVERY_FILES+=(REBUILD.txt)   # bringing Spark 2 back after its disk is lost (also on GitHub)
# server.mjs is built from service/src/*.mjs (tools/build-server.mjs): install only one that matches its parts.
cat "$HERE"/service/src/[0-9][0-9]-*.mjs | cmp -s - "$HERE/service/server.mjs" || { echo "service/server.mjs doesn't match service/src: run node tools/build-server.mjs, then node test/lock.mjs." >&2; exit 1; }
# Which workflow versions passed the whole test suite (test/lock.mjs writes it). Without it every workflow is off.
[ -f "$HERE/service/workflows.lock.json" ] || { echo "service/workflows.lock.json is missing: run node test/lock.mjs (the whole suite) first." >&2; exit 1; }
SOCK="/tmp/spark-console-ssh-$$"
SSH=(ssh -o ControlMaster=auto -o ControlPath="$SOCK" -o ControlPersist=120)
# On Spark 2 itself (2026-11-11, so it can update without the Mac): `local` runs each step here instead of over SSH.
if [ "$HOST" = local ]; then
  on_spark2() { while [ $# -gt 0 ] && [ "$1" != local ]; do shift; done; shift; [ $# -eq 0 ] || bash -c "$*"; }
  SSH=(on_spark2)
fi
STAGE="$(mktemp -d)"
trap '"${SSH[@]}" -O exit "$HOST" >/dev/null 2>&1 || true; rm -rf "$STAGE"' EXIT

# Stamp this build so open pages notice the update (tailscale serve sends no cache headers). version.json goes last,
# so it only names the new build once the new files are in place.
BUILD="$(cd "$HERE/public" && cat "${UI_FILES[@]}" | shasum -a 256 | cut -c1-12)"
mkdir "$STAGE/ui" "$STAGE/service"
for f in "${UI_FILES[@]}"; do cp "$HERE/public/$f" "$STAGE/ui/"; done
sed "s/^const BUILD = 'dev';$/const BUILD = '$BUILD';/" "$HERE/public/app.js" > "$STAGE/ui/app.js"
grep -q "^const BUILD = '$BUILD';$" "$STAGE/ui/app.js" || { echo "Couldn't stamp the build into app.js." >&2; exit 1; }
printf '{"build":"%s"}\n' "$BUILD" > "$STAGE/ui/version.json"
for f in "${SERVICE_FILES[@]}"; do cp "$HERE/service/$f" "$STAGE/service/"; done
for f in "${RECOVERY_FILES[@]}"; do cp "$HERE/deploy/$f" "$STAGE/"; done
# The look install.sh makes on Spark 2 before it changes anything: every program the console's commands call is on the
# fixed path (R53).
cp "$HERE/deploy/path-check.sh" "$STAGE/"
# The service's /health names its build: the first 12 hex digits of the sha256 of its code (server.mjs, dig.mjs,
# passkey.mjs, in that order). The update only counts once the service answers with the code sent here.
API_BUILD="$(cd "$STAGE/service" && cat server.mjs dig.mjs passkey.mjs | shasum -a 256 | cut -c1-12)"
# The whole source goes along and is kept on Spark 2 (~/spark-console-src), so Spark 2 can rebuild, test and install
# without this Mac (2026-11-11, reviews: "truly standalone").
# The eval's held-out set (test/eval/memory-held-out.json) is never sent: it tests a brain, so the brain must never be
# able to read it once commands reach Spark 2. Nothing the console runs reads it (the eval runs it from this machine).
COPYFILE_DISABLE=1 tar -C "$HERE" --exclude='.DS_Store' --exclude='node_modules' --exclude='test/eval/memory-held-out.json' -cf "$STAGE/source.tar" \
  $(cd "$HERE" && ls -d AGENTS.md README.md agentbar deploy docs public service test tools 2>/dev/null)
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
# The lock has to be for THIS code: a tree one change ahead of its test run would install with every workflow off
# (found by the gap analysis, 2026-11-11).
LOCK_BUILD="$(python3 -I -c 'import json, sys; print(json.load(open(sys.argv[1])).get("build", ""))' "$HERE/service/workflows.lock.json" 2>/dev/null || true)"
[ "$LOCK_BUILD" = "$API_BUILD" ] || { echo "service/workflows.lock.json is for build ${LOCK_BUILD:-unknown}, but this code is build $API_BUILD. Run node test/lock.mjs (the whole suite) first; installing now would switch every workflow off." >&2; exit 1; }
# What this update is, in plain words (optional, NOTE='…'). The new build puts it on its update record as it starts.
NOTE="${NOTE:-}" python3 -I -c 'import json, os, sys; json.dump({"build": sys.argv[1], "note": os.environ["NOTE"][:600]}, open(sys.argv[2], "w"))' "$API_BUILD" "$STAGE/update-note.json" 2>/dev/null \
  || printf '{"build":"%s","note":""}\n' "$API_BUILD" > "$STAGE/update-note.json"

# The part that runs on Spark 2. It travels with the new files to ~/.cache/spark-console/incoming (nothing installed
# changes by being copied there):
#   install.sh check                            checks Node.js and the fixed path (path-check.sh); prints "busy <jobs
#                                               running> <chats answering>", or "busy down" / "busy unknown", for this
#                                               Mac to read
#   install.sh verify                           the checks alone (sign-in, the agent door, the model address, one chat
#                                               turn); changes nothing
#   install.sh install <stamp> <build> <host>   saves a snapshot, installs, restarts, checks; puts the old files back
#                                               on any miss
cat > "$STAGE/install.sh" <<'REMOTE'
set -euo pipefail
IN="$(cd "$(dirname "$0")" && pwd)"
STATE="$HOME/.local/state/spark-console"
API="$STATE/api.sock"
UNIT="$HOME/.config/systemd/user/spark-console-api.service"
REL="$HOME/.local/share/spark-console/releases"
fail() { echo "  STOP: $*" >&2; exit 1; }
# The stand-in fleet's tests say --stand-in, last (an argument only: the environment never switches it, R53).
STAND_IN=''
if [ $# -gt 0 ] && [ "${!#}" = --stand-in ]; then STAND_IN=1; set -- "${@:1:$(($# - 1))}"; fi
# Every program the console's commands call has to be on the fixed path (R53): path-check.sh, beside this script, says
# which isn't. Asked before anything changes; a miss refuses, naming each. (With --stand-in a test marks one missing
# with ~/.mock/off-path-<program>, as the console's own look reads it; the list is path-check.sh's.)
path_check() {
  local out p
  if [ -n "$STAND_IN" ] && [ -f "$IN/path-check.sh" ]; then
    out=''
    for p in $(sed -n 's/^for p in \(.*\); do$/\1/p' "$IN/path-check.sh"); do [ ! -e "$HOME/.mock/off-path-$p" ] || out="$out $p"; done
    [ -z "$out" ] && return 0
    out="Not on the fixed path:$out"
  else
    out=$(bash "$IN/path-check.sh" 2>&1) && return 0
  fi
  [ -n "$out" ] || out="path-check.sh gave no answer"
  fail "Spark 2 is missing programs Spark Console's commands call. $out. Nothing was changed. Install them where that path finds them (not in your home), then run this again."
}

# The Node.js the service runs with (it's written into the systemd unit below), checked before anything changes.
NODE=$(command -v node || ls -d "$HOME"/.local/opt/code-server-*/lib/node 2>/dev/null | tail -1 || true)
[ -n "$NODE" ] && [ -x "$NODE" ] || fail "No Node.js found on Spark 2. Spark Console needs Node.js 18 or newer; install it, then run this again."
NODE_V=$("$NODE" --version 2>/dev/null || true)
NODE_MAJOR=${NODE_V#v}; NODE_MAJOR=${NODE_MAJOR%%.*}
[[ "$NODE_MAJOR" =~ ^[0-9]+$ ]] && [ "$NODE_MAJOR" -ge 18 ] \
  || fail "Spark Console needs Node.js 18 or newer, but the one it would run with ($NODE) is ${NODE_V:-unreadable}. Install a newer one, then run this again."

# /health on the socket Tailscale uses (empty if nothing answers).
socket_health() { curl -q -s -m 3 --unix-socket "$API" http://localhost/health 2>/dev/null || true; }

if [ "${1:-}" = check ]; then
  echo "  Node.js $NODE_V ($NODE): ok" >&2
  path_check
  # A service from before the socket only answers on its local port.
  h=$(socket_health); [ -n "$h" ] || h=$(curl -q -s -m 3 http://127.0.0.1:8810/health 2>/dev/null || true)
  printf '%s' "$h" | python3 -I -c 'import json, sys
try:
    d = json.loads(sys.stdin.read())
except ValueError:
    print("busy down"); sys.exit()
try:
    print("busy %d %d" % (int(d["jobsRunning"]), int(d["replying"])))
except Exception:
    print("busy unknown")'
  exit 0
fi

# How long the new build gets to answer first, and how long it then has to keep answering as the same process.
WAIT_S="${SPARK_CONSOLE_INSTALL_WAIT_S:-45}"; SETTLE_S="${SPARK_CONSOLE_INSTALL_SETTLE_S:-40}"
# field <name>: that field of the JSON object on stdin (True/False for a yes/no); nothing if it can't be read.
field() { python3 -I -c 'import json, sys
try:
    v = json.loads(sys.stdin.read()).get(sys.argv[1])
except Exception:
    sys.exit(0)
print("" if v is None else v)' "$1"; }
# started <build>: when the service answering /health started, only if it is ok and is that build.
started() { python3 -I -c 'import json, sys
try:
    d = json.loads(sys.stdin.read())
except ValueError:
    sys.exit(1)
if not (isinstance(d, dict) and d.get("ok") is True and d.get("build") == sys.argv[1] and d.get("startedAt")): sys.exit(1)
print(d["startedAt"])' "$1"; }
# The owner's login, as the service reads it (config.json's ownerLogin wins over access.json's). The checks below ask
# the service on its own socket as the owner, the way Tailscale hands a request over. Empty on a first install.
OWNER=$(python3 -I -c 'import json, sys
def owner(f):
    try: return json.load(open(f)).get("ownerLogin") or ""
    except Exception: return ""
print(owner(sys.argv[1]) or owner(sys.argv[2]))' "$IN/service/config.json" "$STATE/access.json" 2>/dev/null || true)
[[ "$OWNER" =~ ^[A-Za-z0-9._%+@-]+$ ]] || OWNER=''
as_owner() { local t="$1"; shift; curl -q -s -m "$t" --unix-socket "$API" -H "Tailscale-User-Login: $OWNER" "$@"; }
# (what a change from the page carries: the console's header and its own Origin)
page_post() { as_owner "$1" -H 'X-Spark-Console: 1' -H 'X-Forwarded-Host: localhost' -H 'Origin: https://localhost' -H 'Content-Type: application/json' -d "$3" "http://localhost$2"; }
WHY=''
# The ways in, read-only: the owner is still the owner; the agent door answers (no key is sent, so "needs its own key"
# is right: only silence or a 5xx is a miss); the model address lists.
check_ways() {
  local code
  [ "$(as_owner 10 http://localhost/whoami | field access)" = owner ] || { WHY="sign-in: $OWNER isn't the owner to the new build"; return 1; }
  code=$(as_owner 10 -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}' http://localhost/mcp) || code=000
  [[ "$code" =~ ^[234][0-9][0-9]$ ]] || { WHY="the agent door (/mcp) answered $code"; return 1; }
  [ "$(as_owner 60 http://localhost/v1/models | field object)" = list ] || { WHY="the model address (/v1/models) didn't list its models"; return 1; }
}
# One real turn through the owner's chat: Sparkie has to call a tool and finish its answer. A chat is only deleted with
# the owner's passkey, so the check keeps one chat of its own ("Update check. ...") and uses it again while it has room.
CANARY='Update check. Call the fleet_status tool once, then say in one short line how many Sparks answer.'
chat_turn() {
  local id="$1" out
  [ -n "$id" ] || id=$(page_post 10 /chats '{}' | field id)
  [[ "$id" =~ ^sc_[0-9a-f]{16}$ ]] || return 1
  out=$(page_post 120 "/chats/$id/messages" "{\"text\":\"$CANARY\"}") || true
  grep -q '"type":"tool".*"ok":true' <<<"$out" && grep -q '"type":"done"' <<<"$out"
}
check_chat() {
  local kept
  kept=$(as_owner 10 http://localhost/chats | python3 -I -c 'import json, sys
try:
    chats = json.loads(sys.stdin.read())["chats"]
except Exception:
    sys.exit(0)
for c in chats:
    if str(c.get("title") or "").startswith("Update check.") and not c.get("agent") and int(c.get("messageCount") or 0) < 150:
        print(c["id"]); break') || kept=''
  # (a second try, in a new chat, before a good build is sent back for one odd answer)
  chat_turn "$kept" || chat_turn '' || { WHY="chat: Sparkie didn't call a tool and finish an answer"; return 1; }
}

if [ "${1:-}" = verify ]; then
  [ -n "$OWNER" ] || fail "No owner is set up in $STATE/access.json, so there's nobody to check as."
  check_ways || fail "$WHY"
  check_chat || fail "$WHY"
  echo "  ways in: ok (sign-in, the agent door, the model address). chat: ok (Sparkie called a tool and answered)."
  exit 0
fi

[ "${1:-}" = install ] && [ $# = 4 ] || fail "Usage: install.sh check | verify | install <stamp> <build> <host>   (tests add --stand-in)"
STAMP="$2" API_BUILD="$3" HOST="$4"
[[ "$STAMP" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] && [[ "$API_BUILD" =~ ^[0-9a-f]{12}$ ]] || fail "Unexpected snapshot name or build: $STAMP $API_BUILD"
path_check

# Before anything changes. Can the chat be checked afterwards? Only if Sparkie's model answers now.
BEFORE=$(socket_health)
TG_BEFORE=$(printf '%s' "$BEFORE" | field telegram)
CHAT_CHECK=yes CHAT_WHY=''
if [ "${SKIP_CHAT_CHECK:-}" = 1 ]; then
  CHAT_CHECK=no CHAT_WHY='switched off with SKIP_CHAT_CHECK=1'
elif [ -z "$OWNER" ] || [ -z "$BEFORE" ]; then
  CHAT_CHECK=no CHAT_WHY="Spark Console wasn't answering before this update"
else
  BRAIN=$(as_owner 30 http://localhost/main || true)
  if [ "$(printf '%s' "$BRAIN" | field configured)" = False ]; then
    CHAT_CHECK=no CHAT_WHY='no model is set up for Sparkie'
  elif [ "$(printf '%s' "$BRAIN" | field healthy)" != True ]; then
    fail "Sparkie's model isn't answering right now, so this update couldn't be checked with a chat turn. Nothing was changed. Start it (type /restart sparkie in your chat), then run this again. To update without the chat check, put SKIP_CHAT_CHECK=1 in front of the same command."
  fi
fi
# Room for the snapshot and the new files (a disk that fills part-way was the worst case).
USED_KB=$( { du -sk "$HOME/spark-console" "$HOME/spark-console-service" "$STATE" "$IN" 2>/dev/null || true; } | awk '{s += $1} END {print s + 0}')
FREE_KB=$(df -Pk "$HOME" 2>/dev/null | awk 'NR == 2 {print $4}' || true)
if [[ "$FREE_KB" =~ ^[0-9]+$ ]]; then
  NEED_KB=$((USED_KB * 2 + 102400))
  [ "$FREE_KB" -ge "$NEED_KB" ] || fail "Spark 2 has $((FREE_KB / 1024)) MB free, and this update needs about $((NEED_KB / 1024)) MB (a snapshot of what's installed, plus the new files). Nothing was changed. Free some space, then run this again. Old snapshots are in $REL."
else
  echo "  Note: couldn't read how much disk space is free, so that wasn't checked."
fi
# An update from GitHub whose way back is still armed (update-guard.sh) would put this install back when its timer
# fires. Made inside that update (its pull.sh's process group, on this boot): left alone. Made while that pull.sh still
# runs: refused. Any other install (from the Mac, or by hand) first puts the build from before that update back, so
# however it ends a confirmed build is what it goes back to (R30).
GUARD="$HOME/.local/share/spark-console/update-guard"
ME_PGID=$(ps -o pgid= -p $$ 2>/dev/null | tr -d ' ') || ME_PGID=''
ME_BOOT=$(cat /proc/sys/kernel/random/boot_id 2>/dev/null) || ME_BOOT=''
if [ -f "$GUARD/guard" ] && [[ "$ME_PGID" =~ ^[0-9]+$ ]]; then
  G_PGID=$(sed -n 's/^pgid=//p' "$GUARD/guard"); G_BOOT=$(sed -n 's/^boot=//p' "$GUARD/guard")
  if [ "$G_PGID" != "$ME_PGID" ] || [ "$G_BOOT" != "$ME_BOOT" ]; then
    if [ "$G_BOOT" = "$ME_BOOT" ] && [[ "$G_PGID" =~ ^[0-9]+$ ]] && kill -0 -- "-$G_PGID" 2>/dev/null \
        && { ps -o args= -p "$G_PGID" 2>/dev/null || true; } | grep -q 'pull\.sh'; then
      fail "An update from GitHub is still running (its pull.sh, process group $G_PGID). Let it finish, then run this again. Nothing was changed."
    fi
    echo "  An update from GitHub left its way back armed; this install takes over, so it is disarmed first."
    echo "  (The build from before that update is put back first: if this install isn't kept, that confirmed build returns.)"
    bash "$GUARD/update-guard.sh" put-back hand "an install made outside it took over" \
      || echo "  NOTE: that build from before didn't come back answering, or its copy wasn't whole; this install goes on."
  fi
fi

# From here on, however this script ends: a snapshot that wasn't finished is removed (it would hide the good ones from
# "Undo the last update"), and once files have started to change, any failure puts the previous install back.
PHASE=before SNAP=''
on_exit() {
  local code=$?
  trap - EXIT HUP INT TERM; trap '' PIPE   # (a cut session must not stop the put-back half-way)
  set +e
  if [ "$code" != 0 ] && [ "$PHASE" = snapshot ] && [ -n "$SNAP" ]; then rm -rf "$SNAP"; fi
  if [ "$code" != 0 ] && [ "$PHASE" = changing ]; then
    if [ -n "$SNAP" ] && [ -f "$SNAP/restore.sh" ]; then
      echo "  Putting the previous install back (its files only; state stays as it is) ..." >&2
      # (with --stand-in, its restore.sh is told so by a mark beside it, there only while this put-back runs)
      [ -z "$STAND_IN" ] || : > "$SNAP/stand-in"
      bash "$SNAP/restore.sh" > "$SNAP/restore.log" 2>&1; back=$?
      rm -f "$SNAP/stand-in"
      sed 's/^/  /' "$SNAP/restore.log" >&2
      if [ "$back" = 0 ]; then echo "  STOP: The update was not kept. The previous version is running again. Fix the problem above and run this again." >&2
      else echo "  STOP: The update was not kept, and the previous version isn't answering either. Its snapshot is $SNAP." >&2; fi
    else
      echo "  STOP: There's no earlier install to go back to. Fix the problem above and run this again." >&2
    fi
  fi
  exit "$code"
}
trap on_exit EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM; trap 'exit 141' PIPE

# Save what's installed now, with its state, so it can be put back.
if [ -e "$HOME/spark-console" ] || [ -e "$HOME/spark-console-service" ] || [ -e "$STATE" ]; then
  # (a folder of that name already there is someone else's: never removed below)
  [ ! -e "$REL/$STAMP" ] || fail "A snapshot named $STAMP is already in $REL. Nothing was changed; run this again in a moment."
  SNAP="$REL/$STAMP" PHASE=snapshot
  echo "Saving a snapshot of the current install and its state …"
  ( umask 077
    # save <folder> <name>: an exact copy, leaving out sockets and half-written files. tar's status 1 only means a
    # file changed while it was read; the service replaces its state files whole, so each copy is still complete.
    save() {
      [ -d "$1" ] || return 0
      mkdir "$SNAP/$2"
      { tar -C "$1" --exclude='*.sock' --exclude='*.tmp' --warning=no-file-changed --warning=no-file-removed -cf - . || [ $? = 1 ]; } |
        tar -C "$SNAP/$2" -xpf -
    }
    mkdir -p "$REL"; chmod 700 "$HOME/.local/share/spark-console" "$REL"
    mkdir "$SNAP"
    save "$HOME/spark-console" spark-console
    save "$HOME/spark-console-service" spark-console-service
    save "$STATE" state
    if [ -f "$UNIT" ]; then cp -p "$UNIT" "$SNAP/"; fi
    # Which build this snapshot holds (the fingerprint /health reports), for the record of updates.
    python3 -I -c 'import hashlib, sys; print(hashlib.sha256(b"".join(open(f, "rb").read() for f in sys.argv[1:])).hexdigest()[:12])' \
      "$SNAP"/spark-console-service/server.mjs "$SNAP"/spark-console-service/dig.mjs "$SNAP"/spark-console-service/passkey.mjs > "$SNAP/build" 2>/dev/null || rm -f "$SNAP/build"
    # `same`: this snapshot holds exactly what is installed (here: the same update run again), so going back to it
    # would change nothing and "Undo the last update" passes over it. restore.sh leaves the same mark once it has put
    # its files back.
    if diff -rq "$IN/ui" "$HOME/spark-console" >/dev/null 2>&1 && diff -rq "$IN/service" "$HOME/spark-console-service" >/dev/null 2>&1; then : > "$SNAP/same"; fi
    cat > "$SNAP/restore.sh" <<'RESTORE'
#!/usr/bin/env bash
# Puts back the Spark Console install saved in this folder: the UI, the service and its systemd unit. Then restarts
# the service. People, chats and the rest of the state stay as they are; with --with-state, the state saved here is
# copied back too (state files made since then stay), and sessions.json goes: every device signs in again, and none
# signed out since is let back in. So does the state's number (auth-serial.json): the next start holds sign-in from the
# internet and agents' changes until the owner, on the tailnet, has looked at what came back (contract 6.25). And so
# does saved-runs.json: the next start would stop by name what a saved workflow ran back then (R57).
#   bash restore.sh [--with-state]
set -euo pipefail
# Its programs come from the fixed path, never a folder in the home (R53); the stand-in fleet's tests keep their PATH.
# They say so with --stand-in (or the installer that runs this, by a mark beside it): never the environment.
WITH_STATE='' SPARK_CONSOLE_ALL_LOCAL=''
for a in "$@"; do
  case "$a" in --with-state) WITH_STATE=1 ;; --stand-in) SPARK_CONSOLE_ALL_LOCAL=1 ;; *) echo "Usage: bash $0 [--with-state]" >&2; exit 2 ;; esac
done
[ ! -e "${0%/*}/stand-in" ] || SPARK_CONSOLE_ALL_LOCAL=1
[ "${SPARK_CONSOLE_ALL_LOCAL:-}" = 1 ] || { PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin; export PATH; }
S="$(cd "$(dirname "$0")" && pwd)"
# put_back <saved> <live>: the live folder's contents become exactly the saved ones. It stays the same folder, so
# Tailscale's routes keep pointing at it.
put_back() { if [ -d "$1" ]; then mkdir -p "$2"; find "$2" -mindepth 1 -delete; cp -a "$1/." "$2/"; fi; }
echo "Putting back the Spark Console install saved in $S …"
# However this ends, the service is started again: a copy that fails must never leave it stopped (the watchdog leaves a
# stopped service alone).
trap 'systemctl --user daemon-reload 2>/dev/null; systemctl --user start spark-console-api 2>/dev/null || true' EXIT
systemctl --user stop spark-console-api 2>/dev/null || true
put_back "$S/spark-console" "$HOME/spark-console"
put_back "$S/spark-console-service" "$HOME/spark-console-service"
if [ -f "$S/spark-console-api.service" ]; then
  mkdir -p "$HOME/.config/systemd/user"; cp -p "$S/spark-console-api.service" "$HOME/.config/systemd/user/"
fi
if [ -n "$WITH_STATE" ] && [ -d "$S/state" ]; then
  mkdir -p "$HOME/.local/state/spark-console"
  for f in "$S/state"/* "$S/state"/.[!.]* "$S/state"/..?*; do
    [ -e "$f" ] && [ "${f##*/}" != sessions.json ] || continue
    cp -a "$f" "$HOME/.local/state/spark-console/"
  done
  rm -f "$HOME/.local/state/spark-console/sessions.json"
  rm -f "$HOME/.local/state/spark-console/auth-serial.json"
  rm -f "$HOME/.local/state/spark-console/saved-runs.json"
fi
# The files are back: this snapshot is what's installed now, answering or not, so the next go-back passes over it
# (one that only marked itself once it answered would be put back again and again if its build is dead).
: > "$S/same" 2>/dev/null || true
systemctl --user daemon-reload
systemctl --user restart spark-console-api
for _ in $(seq 1 20); do
  if curl -q -s -m 2 --unix-socket "$HOME/.local/state/spark-console/api.sock" http://localhost/health 2>/dev/null | grep '"ok":true' >/dev/null; then
    : > "$S/same" 2>/dev/null || true   # this snapshot is what's installed now: "Undo the last update" passes over it
    echo "  Done: the service answers again."; exit 0
  fi
  sleep 1
done
echo "  The files are back, but the service isn't answering. See: journalctl --user -u spark-console-api -n 50" >&2
exit 1
RESTORE
  )
  # Keep the newest 10.
  find "$REL" -mindepth 1 -maxdepth 1 -type d -name '????????T??????Z' -printf '%f\n' | sort -r | tail -n +11 |
    while read -r old; do rm -rf "${REL:?}/$old"; done
  echo "  Saved in $SNAP"
  echo "  To put this install back later: ssh $HOST 'bash $SNAP/restore.sh'"
  echo "  (that leaves people, chats and settings as they are by then; add --with-state to put those back too)"
else
  echo "Nothing is installed yet, so there's nothing to snapshot."
fi
PHASE=changing
# The by-hand way back, at a fixed path, before anything installed is replaced: go-back.sh puts back the newest
# snapshot (files only) and RECOVERY.txt lists the by-hand steps. Both work with Spark Console down.
mkdir -p "$HOME/.local/share/spark-console"
cp "$IN/go-back.sh" "$IN/RECOVERY.txt" "$HOME/.local/share/spark-console/"
[ ! -f "$IN/REBUILD.txt" ] || cp "$IN/REBUILD.txt" "$HOME/.local/share/spark-console/"
chmod 700 "$HOME/.local/share/spark-console/go-back.sh"

echo "Installing the UI in ~/spark-console …"
mkdir -p "$HOME/spark-console" "$HOME/spark-console-service"
for f in "$IN"/ui/*; do if [ "${f##*/}" != version.json ]; then cp "$f" "$HOME/spark-console/"; fi; done
cp "$IN/ui/version.json" "$HOME/spark-console/"

echo "Installing the service in ~/spark-console-service …"
cp "$IN"/service/* "$HOME/spark-console-service/"
# This update's note (NOTE=…), for the new build's update record: it reads it once, as it starts.
if [ -f "$IN/update-note.json" ]; then
  ( umask 077; mkdir -p "$STATE" && cp "$IN/update-note.json" "$STATE/update-note.json" ) \
    || echo "  NOTE: couldn't keep this update's note (the install itself is fine)."
fi

echo "Starting the service (Node.js $NODE_V) and waiting for it to answer …"
mkdir -p "$HOME/.config/systemd/user"
cat > "$UNIT" <<UNIT
[Unit]
Description=Spark Console API (live metrics, model library, deploys)
After=network-online.target

[Service]
WorkingDirectory=%h/spark-console-service
ExecStart=$NODE %h/spark-console-service/server.mjs
Restart=always
RestartSec=3
NoNewPrivileges=true
MemoryMax=512M

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable spark-console-api >/dev/null 2>&1
systemctl --user restart spark-console-api || true   # if it can't start, the check below says so and puts the old one back
# After a power cut, a user's services start with the Spark only if the user lingers (the owner turns that on, once).
[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" = yes ] || echo "Note: Spark Console starts after a reboot only once you log in. To start it with the Spark, run once on Spark 2: sudo loginctl enable-linger $USER" >&2

# Only the new build counts: ok on the socket Tailscale uses, naming the server.mjs just installed. Any miss from here
# to "kept" ends this script, and on_exit puts the previous install back.
miss() {
  echo "  The new build ($API_BUILD) didn't pass: $1. Its last log lines:" >&2
  journalctl --user -u spark-console-api -n 30 --no-pager 2>&1 | sed 's/^/    /' >&2 || true
  exit 1
}
FIRST=''
END=$((SECONDS + WAIT_S))
while [ "$SECONDS" -lt "$END" ]; do
  FIRST=$(socket_health | started "$API_BUILD") && break
  FIRST=''; sleep 1
done
[ -n "$FIRST" ] || miss "it didn't answer on its socket within $WAIT_S seconds"
echo "  health: ok (build $API_BUILD). Watching that it keeps running for $SETTLE_S seconds ..."
# The same process has to keep answering: one that dies in its first timers comes back with a new start time.
same_process() {
  local now quiet=0
  while :; do
    now=$(socket_health | started "$API_BUILD") || now=''
    [ -z "$now" ] || { [ "$now" = "$FIRST" ]; return; }
    quiet=$((quiet + 1)); [ "$quiet" -lt 3 ] || return 1
    sleep 2
  done
}
END=$((SECONDS + SETTLE_S))
while [ "$SECONDS" -lt "$END" ]; do
  sleep 2
  same_process || miss "it stopped or restarted by itself in its first $SETTLE_S seconds"
done
if [ -n "$OWNER" ]; then
  check_ways || miss "$WHY"
  echo "  ways in: ok (sign-in, the agent door, the model address)"
  if [ "$CHAT_CHECK" = yes ]; then
    check_chat || miss "$WHY"
    echo "  chat: ok (Sparkie called a tool and answered)"
  else
    echo "  chat: not checked ($CHAT_WHY)"
  fi
else
  echo "  No owner is set up yet, so sign-in and chat weren't checked."
fi
# Telegram, only if it was working before this update: it has to be polling again (its state starts at "off" in every
# new process and becomes "ok" only when a poll comes back).
if [ "$TG_BEFORE" = ok ]; then
  END=$((SECONDS + SETTLE_S))
  until [ "$(socket_health | field telegram)" = ok ]; do
    [ "$SECONDS" -lt "$END" ] || miss "Telegram was working before this update and isn't polling now"
    sleep 2
  done
  echo "  Telegram: ok (polling again)"
fi
same_process || miss "it restarted by itself during the checks"
PHASE=done
echo "  kept: build $API_BUILD passed its checks"
# pull.sh and update-guard.sh judge the next install, so this build's copies take over only now. Renamed into place:
# the pull.sh that may be running this install keeps reading its own copy.
for f in pull.sh update-guard.sh; do
  if [ -f "$IN/$f" ]; then
    cp "$IN/$f" "$HOME/.local/share/spark-console/.$f.new" && chmod 700 "$HOME/.local/share/spark-console/.$f.new" \
      && mv -f "$HOME/.local/share/spark-console/.$f.new" "$HOME/.local/share/spark-console/$f" \
      || echo "  NOTE: couldn't copy $f to ~/.local/share/spark-console (the install itself is fine)."
  fi
done
# When this build was kept: for a day, the watchdog goes back a build if it stays silent for 15 minutes (R30).
printf '%s %s\n' "$(date +%s)" "$API_BUILD" > "$HOME/.local/share/spark-console/install-mark" 2>/dev/null \
  || echo "  NOTE: couldn't write ~/.local/share/spark-console/install-mark (the install itself is fine)."
# The source, kept here too (swapped in whole; the old copy goes once the new one is in place).
if [ -f "$IN/source.tar" ]; then
  SRC="$HOME/spark-console-src"
  rm -rf "$SRC.new" "$SRC.old" && mkdir -p "$SRC.new" && tar --warning=no-unknown-keyword -C "$SRC.new" -xf "$IN/source.tar" \
    && { [ ! -d "$SRC" ] || mv "$SRC" "$SRC.old"; } && mv "$SRC.new" "$SRC" && rm -rf "$SRC.old" \
    && echo "  source: $SRC (to update from Spark 2 itself: bash $SRC/deploy/host-on-portal.sh local)" \
    || echo "  NOTE: couldn't keep the source in $SRC (the install itself is fine)."
fi
# The watchdog: outside the console, so a stuck console can't stop it. Every minute it asks /health on the socket;
# after 3 misses in a row it restarts the console (at most 3 times an hour), and a console that systemd gave up on is
# started again. A console that systemd keeps trying to start (activating) counts as a miss too; the watchdog still only
# restarts. One stopped on purpose (systemctl --user stop) is left alone. It never touches SSH, Tailscale, the
# firewall, users or any model.
mkdir -p "$HOME/.local/share/spark-console"
cat > "$HOME/.local/share/spark-console/watchdog.sh" <<'DOG'
#!/usr/bin/env bash
# Its programs come from the fixed path, never a folder in the home (R53); the stand-in fleet's tests keep their PATH,
# and say so with --stand-in (never the environment).
SPARK_CONSOLE_ALL_LOCAL=''; [ "${1:-}" != --stand-in ] || SPARK_CONSOLE_ALL_LOCAL=1
[ "${SPARK_CONSOLE_ALL_LOCAL:-}" = 1 ] || { PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin; export PATH; }
S="$HOME/.local/state/spark-console"; U=spark-console-api; D="$HOME/.local/share/spark-console"
# put <file> <text>: the file becomes that text whole, by a new file renamed over it, never written through a link that
# is there; read <file>: its text, or nothing when it is a link.
put() { local t; t=$(mktemp "$S/.watchdog.XXXXXX") || return 0; if printf '%s\n' "$2" > "$t"; then mv -f "$t" "$1"; else rm -f "$t"; fi; }
read_plain() { [ -L "$1" ] || cat "$1" 2>/dev/null; }
state=$(systemctl --user show -p ActiveState --value "$U" 2>/dev/null)
restart() {
  now=$(date +%s); recent=$(read_plain "$S/watchdog-restarts" | awk -v n="$now" '$1 ~ /^[0-9]+$/ && n - $1 < 3600' | wc -l)
  [ "$recent" -lt 3 ] || { logger -t spark-console-watchdog "not restarting: 3 restarts in the last hour already"; return 0; }
  # (the restarts of the last day, kept as numbers; the console counts them for its needs-you line)
  put "$S/watchdog-restarts" "$( { read_plain "$S/watchdog-restarts" | awk -v n="$now" '$1 ~ /^[0-9]+$/ && n - $1 < 86400 { print $1 }'; echo "$now"; } )"
  put "$S/watchdog-misses" 0
  logger -t spark-console-watchdog "restarting Spark Console: $1"
  systemctl --user reset-failed "$U" 2>/dev/null; systemctl --user restart "$U"
}
case "$state" in
  failed) restart "systemd gave up on it" ;;
  active|activating)
    if curl -q -s -m 10 --unix-socket "$S/api.sock" http://localhost/health 2>/dev/null | grep -q '"ok":true'; then put "$S/watchdog-misses" 0; rm -f "$S/watchdog-silent-since"; exit 0; fi
    # (read as text first: only plain digits count, so nothing in the file is ever worked out as an expression)
    m=$(read_plain "$S/watchdog-misses"); [[ "$m" =~ ^[0-9]+$ ]] || m=0
    m=$((10#$m + 1)); put "$S/watchdog-misses" "$m"
    [ "$m" -lt 3 ] || restart "it didn't answer /health 3 minutes in a row" ;;
  *) rm -f "$S/watchdog-silent-since"; exit 0 ;;
esac
# Silent for 15 minutes within a day of an install (install-mark): go back a build, once. Never while an update's own
# way back is armed (update-guard.sh decides then), and never for a console stopped on purpose (above).
now=$(date +%s); since=$(read_plain "$S/watchdog-silent-since")
[[ "$since" =~ ^[0-9]+$ ]] || { put "$S/watchdog-silent-since" "$now"; exit 0; }
mark=$(cut -d' ' -f1 "$D/install-mark" 2>/dev/null)
if [ $((now - since)) -ge 900 ] && [[ "$mark" =~ ^[0-9]+$ ]] && [ $((now - mark)) -lt 86400 ] && [ ! -e "$D/update-guard" ]; then
  rm -f "$D/install-mark" "$S/watchdog-silent-since"
  logger -t spark-console-watchdog "going back a build: silent for 15 minutes within a day of an install"
  bash "$D/go-back.sh" ${SPARK_CONSOLE_ALL_LOCAL:+--stand-in} >/dev/null 2>&1
fi
DOG
chmod 700 "$HOME/.local/share/spark-console/watchdog.sh"
cat > "$HOME/.config/systemd/user/spark-console-watchdog.service" <<'DOGU'
[Unit]
Description=Spark Console watchdog (restarts the console if it stops answering)
[Service]
Type=oneshot
ExecStart=/bin/bash %h/.local/share/spark-console/watchdog.sh
DOGU
cat > "$HOME/.config/systemd/user/spark-console-watchdog.timer" <<'DOGT'
[Unit]
Description=Spark Console watchdog, every minute
[Timer]
OnBootSec=3min
OnUnitActiveSec=1min
[Install]
WantedBy=timers.target
DOGT
systemctl --user daemon-reload && systemctl --user enable --now spark-console-watchdog.timer >/dev/null 2>&1 \
  && echo "  watchdog: on (every minute)" || echo "  NOTE: the watchdog timer couldn't be turned on."
echo "  if Spark Console ever stops answering, on Spark 2: bash ~/.local/share/spark-console/go-back.sh puts the last build back (more: ~/.local/share/spark-console/RECOVERY.txt)"

# Each workflow's state: active, waiting for its first run on the Sparks (which validates it), or off (not tested).
socket_health | python3 -I -c '
import json, sys
names = {"active": "active", "needs-validation": "its first run validates it", "untested": "OFF: this version was not tested (run node test/lock.mjs, then install again)"}
for k, v in (json.load(sys.stdin).get("workflows") or {}).items(): print(f"  workflow {k}: {names.get(v, v)}")
' 2>/dev/null || true
# (Spark Console's Python leaves out the packages in the home, as -I does here: only the system's PyYAML counts)
python3 -I -c 'import yaml' 2>/dev/null && echo "  recipe files: readable" || echo "  NOTE: Find setups reads recipe files with PyYAML, and the system's Python here doesn't have it (Spark Console's Python leaves out packages in your home, so a pip install --user doesn't count). Install the system package with: sudo apt install python3-yaml"

if [ "${SKIP_ROUTES:-}" = 1 ]; then echo "  Not checked here: whether this machine reaches the other Sparks (SKIP_ROUTES=1: no ssh)."
else
echo "Checking that this machine can reach the other Sparks without a password:"
python3 -I - <<'PY'
import json, os, subprocess
cfg = json.load(open(os.path.expanduser('~/spark-console-service/config.json')))
# (a Spark Spark Console powered off on purpose is asleep, not unreachable: its record in power.json, R41)
try: asleep = {k: v for k, v in json.load(open(os.path.expanduser('~/.local/state/spark-console/power.json')))['off'].items() if isinstance(v, dict)}
except Exception: asleep = {}
# (only what can be printed of the file's text: no escape sequence reaches the terminal, and print never fails on it)
clean = lambda s: ''.join(c for c in str(s) if c.isprintable())
for n in cfg['nodes']:
    if n['host'] == 'local':
        print(f"  {n['id']}: this machine"); continue
    try:
        r = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', f"{cfg['user']}@{n['host']}", 'docker info --format x >/dev/null && echo ok'],
                           capture_output=True, text=True, timeout=20)
        ok, why = r.stdout.strip() == 'ok', (r.stderr.strip().splitlines() or ['no answer'])[-1]
    except subprocess.TimeoutExpired:
        ok, why = False, 'timed out'
    if not ok and n['id'] in asleep:
        at = clean(asleep[n['id']].get('at') or '?')[:16].replace('T', ' ')
        # (its record carries a problem, a wake that failed: not asleep, and the problem is said)
        if asleep[n['id']].get('problem'): print(f"  {n['id']}: NOT reachable ({clean(why)[:200]}); Spark Console powered it off at {at} UTC and its record says: {clean(asleep[n['id']]['problem'])[:300]}"); continue
        print(f"  {n['id']}: asleep (Spark Console powered it off at {at} UTC; a start or power_on turns it on)"); continue
    print(f"  {n['id']}: " + ('ok' if ok else 'NOT reachable without a password: ' + why))
PY
fi
REMOTE

echo "Connecting to $HOST. Your password is asked once and reused for the steps below."
"${SSH[@]}" -fN "$HOST"

echo "Copying build $BUILD to a holding folder on Spark 2 (nothing installed changes yet) and checking it …"
PRE=$(COPYFILE_DISABLE=1 tar -C "$STAGE" -cf - ui service install.sh path-check.sh source.tar "${RECOVERY_FILES[@]}" update-note.json | "${SSH[@]}" "$HOST" \
  'I="$HOME/.cache/spark-console/incoming"; rm -rf "$I" && mkdir -p "$I" && tar --warning=no-unknown-keyword -C "$I" -xf - && bash "$I/install.sh" check'"$STAND_IN")
PRE="${PRE##*$'\n'}"
case "$PRE" in
  'busy down') echo "  The service isn't answering right now (expected on a first install)." ;;
  'busy unknown') echo "  The running version doesn't say whether anything is in progress, so that wasn't checked." ;;
  'busy '*)
    read -r _ JOBS CHATS <<<"$PRE"
    if [ "$JOBS" -gt 0 ] || [ "$CHATS" -gt 0 ]; then
      echo
      echo "Spark Console is busy: $JOBS job(s) running, and Sparkie is answering in $CHATS chat(s)."
      echo "Updating restarts its service, which interrupts them."
      ANSWER=''
      if [ "${ASSUME_YES:-}" = 1 ]; then ANSWER=y; else read -rp "Update anyway? [y/N] " ANSWER </dev/tty || ANSWER=''; fi
      case "$ANSWER" in [yY]|[yY][eE][sS]) ;; *) echo "Nothing was changed. Run this again once they've finished."; exit 1 ;; esac
    fi ;;
  *) echo "Couldn't check Spark 2 before installing (it answered: ${PRE:-nothing})." >&2; exit 1 ;;
esac

printf -v HOST_Q '%q' "$HOST"
SKIP=''; if [ "${SKIP_CHAT_CHECK:-}" = 1 ]; then SKIP='SKIP_CHAT_CHECK=1 '; fi
if [ "${SKIP_ROUTES:-}" = 1 ]; then SKIP="${SKIP}SKIP_ROUTES=1 "; fi
"${SSH[@]}" "$HOST" "${SKIP}bash \"\$HOME/.cache/spark-console/incoming/install.sh\" install $STAMP $API_BUILD $HOST_Q$STAND_IN" \
  || { echo; echo "The install stopped (see above). The routes on port 8443 weren't touched." >&2; exit 1; }

if [ "${SKIP_ROUTES:-}" = 1 ]; then echo "The /console routes on port 8443 weren't checked (SKIP_ROUTES=1: no tailscale or sudo)."
else
echo "Checking the /console routes on port 8443 …"
"${SSH[@]}" -t "$HOST" 'set -e
  status=$(tailscale serve status 2>&1)
  need() { echo "$status" | grep -qE "$1" && return 1 || return 0; }
  serve() { tailscale serve --bg --https=8443 "$@" 2>/dev/null || sudo tailscale serve --bg --https=8443 "$@"; }
  if need "/console/ +path"; then echo "  adding /console/ (sudo may ask for your password)"; serve --set-path=/console "$HOME/spark-console"; fi
  if need "/console/api"; then echo "  adding /console/api (sudo may ask for your password)"; serve --set-path=/console/api "unix:$HOME/.local/state/spark-console/api.sock"; fi
  echo; tailscale serve status'
fi

echo
echo "Done: https://akspark2.tailab9aa9.ts.net:8443/"
# The retired short address and web page (2026-11-11): if any of it is still on Spark 2, say how to remove it. Nothing
# here removes it (it's a Tailscale device; the owner does that), and nothing stops if this check can't run.
if "${SSH[@]}" "$HOST" 'test -e "$HOME/.local/state/spark-console/door.json" || test -e "$HOME/.local/state/spark-console/cloud.json" || docker ps -a --format "{{.Names}}" 2>/dev/null | grep -qx spark-console-door' 2>/dev/null; then
  echo
  echo "The retired short address or web page is still on Spark 2. To remove it (docs/sharing.md, the last section):"
  echo "  docker rm -f spark-console-door; docker network rm spark-console-door"
  echo "  rm -f ~/.local/state/spark-console/door.json ~/.local/state/spark-console/cloud.json; rm -rf ~/.local/state/spark-console/door ~/.local/share/spark-console-www ~/.config/spark-console-door"
  echo "  sudo rm -rf ~/.local/state/spark-console-door   (then delete its device in the Tailscale admin console)"
fi

# "Test the changes" runs by itself (docs/contract.md 6.3, v3.1): each changed workflow's real check with a small model
# on Spark 3 or 4, then everything is put back. No passkey. SKIP_TEST=1 skips it.
# (On Spark 2 itself the console doesn't take a person's requests from its own address: the test runs from the console
# by itself when the next start or restart validates each workflow.)
if [ "${SKIP_TEST:-}" != 1 ] && [ "$HOST" != local ] && command -v node >/dev/null 2>&1; then
  echo
  node "$HERE/tools/console.mjs" test-changes \
    || echo "The test of the changes didn't pass (see above). If the update itself is at fault, Undo the last update on the page puts the last good build back."
fi
