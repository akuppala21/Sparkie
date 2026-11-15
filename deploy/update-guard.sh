#!/usr/bin/env bash
# The way back for one update from GitHub (design C 2.3; R30). pull.sh, the copy installed now, arms it before the new
# build's own installer runs, so the build that is installed, not the incoming one, decides whether the new one stays:
#   update-guard.sh arm <tree> <new build> <old build> <pull.sh's process group>
#       Copies what an install changes (the page, the service and its unit, the by-hand files, the watchdog, the
#       source) to ~/.local/share/spark-console/update-guard/, with a copy of this script, and arms one timer in the
#       owner's systemd (spark-console-update-guard.timer, 30 minutes) that runs this put-back. The timer is enabled,
#       so after a restart of Spark 2 it is armed again and fires 30 minutes after the user's services start. It is the
#       one timer this adds, it lives for one install, and it is gone after either ending.
#   update-guard.sh disarm      the new build was confirmed through the real address: timer and copy gone
#   update-guard.sh put-back pull|timer|hand [why]
#       Stops the install if it still runs (the timer's put-back only), puts back what differs from the copy, starts
#       the service again whatever happens, then disarms. pull.sh writes the update's result itself; the timer's and a
#       put-back by hand write it here.
#   update-guard.sh status      armed or not
# It needs no sudo and never touches SSH, Tailscale, the firewall, users or any model. Run by hand when an update was
# left half-done:  bash ~/.local/share/spark-console/update-guard/update-guard.sh put-back hand
set -uo pipefail
SHARE="$HOME/.local/share/spark-console"
G="$SHARE/update-guard"
STATE="$HOME/.local/state/spark-console"
UNITS="$HOME/.config/systemd/user"
NAME=spark-console-update-guard
# The files beside pull.sh at the fixed path that an install replaces or adds (each put back as it was, or removed if
# it wasn't there).
BY_HAND=(go-back.sh RECOVERY.txt pull.sh update-guard.sh watchdog.sh install-mark)
WATCHDOG_UNITS=(spark-console-watchdog.service spark-console-watchdog.timer)
# The timer's length (a test may shorten it, only with SPARK_CONSOLE_ALL_LOCAL=1).
GUARD_S=1800
if [ "${SPARK_CONSOLE_ALL_LOCAL:-}" = 1 ] && [[ "${SPARK_CONSOLE_UPDATE_GUARD_S:-}" =~ ^[0-9]+$ ]]; then GUARD_S=$SPARK_CONSOLE_UPDATE_GUARD_S; fi

say() { echo "  $*"; }
# systemctl for the user's manager, with this script's lock and pull.sh's left behind (nothing it starts holds them).
sc() { systemctl --user "$@" 8>&- 9>&-; }
# One at a time: a put-back by the timer and one by pull.sh, or a put-back and a disarm, never run together.
lock() {
  mkdir -p "$SHARE"
  if command -v flock >/dev/null 2>&1; then exec 8>"$SHARE/update-guard.lock"; flock -w 120 8 || true; fi
}
field() { sed -n "s/^$1=//p" "$G/guard" 2>/dev/null | head -n 1; }
timer_off() {
  sc disable --now "$NAME.timer" >/dev/null 2>&1
  rm -f "$UNITS/$NAME.timer" "$UNITS/$NAME.service"
  sc daemon-reload >/dev/null 2>&1
  return 0
}
socket_build() {
  curl -s -m 3 --unix-socket "$STATE/api.sock" http://localhost/health 2>/dev/null | python3 -c 'import json, sys
d = json.loads(sys.stdin.read())
print(d.get("build") or "" if d.get("ok") is True else "")' 2>/dev/null || true
}
# copy_dir <from> <to>: an exact copy, if <from> is there.
copy_dir() { [ ! -d "$1" ] || { mkdir -p "$2" && cp -a "$1/." "$2/"; }; }
# same <saved> <live>: the live folder or file holds exactly what was saved (both missing counts as the same).
same() {
  if [ -d "$1" ]; then diff -rq --no-dereference "$1" "$2" >/dev/null 2>&1
  elif [ -e "$1" ]; then cmp -s "$1" "$2"
  else [ ! -e "$2" ]; fi
}

# A copy counts only while its guard file is there: arm writes it last, and every removal takes it away first, so a copy
# that was cut off part-way (being made or being removed) is never put back.
whole() { [ -s "$G/guard" ]; }
drop() { rm -f "$G/guard"; rm -rf "$G"; }
take_copy() {
  local f u
  copy_dir "$HOME/spark-console" "$G/ui" && copy_dir "$HOME/spark-console-service" "$G/service" \
    && copy_dir "$HOME/spark-console-src" "$G/src" && mkdir "$G/share" "$G/units" || return 1
  for u in spark-console-api.service "${WATCHDOG_UNITS[@]}"; do [ ! -f "$UNITS/$u" ] || cp -p "$UNITS/$u" "$G/units/" || return 1; done
  for f in "${BY_HAND[@]}"; do [ ! -f "$SHARE/$f" ] || cp -p "$SHARE/$f" "$G/share/" || return 1; done
  cp "$0" "$G/update-guard.sh"
}
arm() {
  [ $# = 4 ] && [[ "$1" =~ ^[0-9a-f]{12}$ ]] && [[ "$2" =~ ^[0-9a-f]{12}$ ]] && [[ "$3" =~ ^[0-9a-f]{12}$ ]] && [[ "$4" =~ ^[0-9]+$ ]] \
    || { echo "Usage: $0 arm <tree> <new build> <old build> <process group>" >&2; return 2; }
  if [ -e "$G" ] && ! whole; then rm -rf "$G"; fi
  [ ! -e "$G" ] || { say "An earlier update's way back is still armed ($G). Put it back first: bash $G/update-guard.sh put-back hand"; return 1; }
  local boot=''
  boot=$(cat /proc/sys/kernel/random/boot_id 2>/dev/null) || boot=''
  ( umask 077; mkdir -p "$SHARE" && mkdir "$G" ) || { say "Couldn't make $G."; return 1; }
  # What an install changes, as it is now. A copy that fails leaves nothing behind.
  take_copy || { rm -rf "$G"; say "Couldn't copy what is installed now (is the disk full?)."; return 1; }
  printf 'tree=%s\nbuild=%s\nfrom=%s\npgid=%s\nboot=%s\nat=%s\n' "$1" "$2" "$3" "$4" "$boot" "$(date +%s)" > "$G/guard.new" \
    && mv "$G/guard.new" "$G/guard" || { rm -rf "$G"; say "Couldn't copy what is installed now (is the disk full?)."; return 1; }
  mkdir -p "$UNITS"
  cat > "$UNITS/$NAME.service" <<EOF
[Unit]
Description=Spark Console: put the build from before the update back (the update was not confirmed)
[Service]
Type=oneshot
ExecStart=/bin/bash %h/.local/share/spark-console/update-guard/update-guard.sh put-back timer
EOF
  cat > "$UNITS/$NAME.timer" <<EOF
[Unit]
Description=Spark Console: the way back for one update, unless the new build is confirmed first
[Timer]
OnActiveSec=${GUARD_S}s
AccuracySec=1s
[Install]
WantedBy=timers.target
EOF
  if sc daemon-reload && sc enable --now "$NAME.timer" >/dev/null 2>&1 \
      && sc is-active --quiet "$NAME.timer"; then
    say "The way back is armed: unless the new build is confirmed within $((GUARD_S / 60)) minutes, the build from before goes back by itself."
    return 0
  fi
  timer_off; drop
  say "The timer that puts the build from before back couldn't be started in your systemd."
  return 1
}

disarm() {
  lock
  [ -d "$G" ] || { say "The way back had already put the build from before back."; return 1; }
  timer_off
  drop
  return 0
}

put_back() {
  local by="${1:-hand}" why="${2:-}" tree build from pgid boot restart='' back='' now
  lock
  [ -d "$G" ] || { say "Nothing to put back: no update's way back is armed."; return 0; }
  whole || { say "The copy in $G isn't whole (an earlier run was cut off), so nothing is put back from it. It is removed."; timer_off; rm -rf "$G"; return 1; }
  tree=$(field tree); build=$(field build); from=$(field from); pgid=$(field pgid); boot=$(field boot)
  [ -n "$why" ] || why='nothing confirmed the new build through the real address in time'
  # From the timer: an install still running is stopped first (only pull.sh's own group, on this boot).
  if [ "$by" = timer ] && [[ "$pgid" =~ ^[0-9]+$ ]] && [ "$boot" = "$(cat /proc/sys/kernel/random/boot_id 2>/dev/null)" ] \
      && kill -0 -- "-$pgid" 2>/dev/null && ps -o args= -p "$pgid" 2>/dev/null | grep -q 'pull\.sh'; then
    say "Stopping the update that is still running ..."
    kill -TERM -- "-$pgid" 2>/dev/null
    for _ in $(seq 1 60); do kill -0 -- "-$pgid" 2>/dev/null || break; sleep 1; done
    kill -KILL -- "-$pgid" 2>/dev/null
  fi
  same "$G/ui" "$HOME/spark-console" && same "$G/service" "$HOME/spark-console-service" \
    && same "$G/units/spark-console-api.service" "$UNITS/spark-console-api.service" || restart=1
  if [ -n "$restart" ]; then
    say "Putting the build from before the update back (its page, its service and its unit; people, chats and settings stay) ..."
    # However this ends, the service is started again.
    trap 'sc daemon-reload >/dev/null 2>&1; sc start spark-console-api >/dev/null 2>&1' EXIT
    sc stop spark-console-api >/dev/null 2>&1
    for p in "ui:$HOME/spark-console" "service:$HOME/spark-console-service"; do
      if [ -d "$G/${p%%:*}" ]; then mkdir -p "${p#*:}"; find "${p#*:}" -mindepth 1 -delete; cp -a "$G/${p%%:*}/." "${p#*:}/"; fi
    done
    [ ! -f "$G/units/spark-console-api.service" ] || { mkdir -p "$UNITS"; cp -p "$G/units/spark-console-api.service" "$UNITS/"; }
    sc daemon-reload >/dev/null 2>&1
    sc restart spark-console-api >/dev/null 2>&1
  fi
  # The by-hand files, the watchdog and the source, as they were (no restart for these). A file that wasn't there goes.
  for f in "${BY_HAND[@]}"; do
    if [ -f "$G/share/$f" ]; then same "$G/share/$f" "$SHARE/$f" || { cp -p "$G/share/$f" "$SHARE/.$f.back" && mv -f "$SHARE/.$f.back" "$SHARE/$f"; }
    else rm -f "$SHARE/$f"; fi
  done
  for u in "${WATCHDOG_UNITS[@]}"; do
    if [ -f "$G/units/$u" ]; then same "$G/units/$u" "$UNITS/$u" || cp -p "$G/units/$u" "$UNITS/"; fi
  done
  if [ -d "$G/src" ] && ! same "$G/src" "$HOME/spark-console-src"; then
    rm -rf "$HOME/spark-console-src.back" && cp -a "$G/src" "$HOME/spark-console-src.back" \
      && rm -rf "$HOME/spark-console-src" && mv "$HOME/spark-console-src.back" "$HOME/spark-console-src"
  fi
  # The newest install snapshot now holds what is installed: "Undo the last update" and go-back.sh pass over it.
  local snap
  snap=$(ls -d "$SHARE"/releases/[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z 2>/dev/null | tail -n 1)
  if [ -n "$snap" ] && [ ! -e "$snap/same" ] && same "$snap/spark-console-service" "$HOME/spark-console-service" \
      && same "$snap/spark-console" "$HOME/spark-console"; then : > "$snap/same"; fi
  # Answering again: the build from before, on the socket.
  for _ in $(seq 1 30); do now=$(socket_build); [ -z "$now" ] || break; sleep 1; done
  if [ -n "$now" ] && { [ "$now" = "$from" ] || [ -z "$restart" ]; }; then back=yes; fi
  timer_off
  if [ "$by" != pull ]; then
    python3 -c 'import datetime, json, os, sys, tempfile
path, tree, build, why = sys.argv[1:5]
d = {"tree": tree or None, "build": build or None, "result": "not kept", "why": why[:600],
     "at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")}
os.makedirs(os.path.dirname(path), exist_ok=True)
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".update-result.", suffix=".tmp")
with os.fdopen(fd, "w") as f: json.dump(d, f)
os.replace(tmp, path)' "$STATE/update-result.json" "$tree" "$build" \
      "$why; $([ -n "$back" ] && echo "the build from before ($from) was put back and answers" || echo "the build from before was put back but doesn't answer")" 2>/dev/null
  fi
  if [ -n "$back" ]; then say "The build from before the update ($from) is back and answers."
  else say "The build from before the update was put back, but it doesn't answer. See ~/.local/share/spark-console/RECOVERY.txt"; fi
  drop
  [ -n "$back" ]
}

case "${1:-}" in
  arm) shift; arm "$@"; exit $? ;;
  disarm) disarm; exit $? ;;
  put-back) shift; put_back "$@"; exit $? ;;
  status) if [ -d "$G" ]; then echo armed; else echo 'not armed'; fi; exit 0 ;;
  *) echo "Usage: $0 arm <tree> <new build> <old build> <process group> | disarm | put-back pull|timer|hand [why] | status" >&2; exit 2 ;;
esac
