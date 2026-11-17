#!/usr/bin/env bash
# The way back for one update from GitHub (design C 2.3; R30). pull.sh, the copy installed now, arms it before the new
# build's own installer runs, so the build that is installed, not the incoming one, decides whether the new one stays:
#   update-guard.sh arm <tree> <new build> <old build> <pull.sh's process group>
#       Copies what an install changes (the page, the service and its unit, the by-hand files, the watchdog, the
#       source) to ~/.local/share/spark-console/update-guard/, with a copy of this script, and arms one timer in the
#       owner's systemd (spark-console-update-guard.timer, 30 minutes) that runs this put-back. The timer is enabled,
#       so after a restart of the hub it is armed again and fires 30 minutes after the user's services start. It is the
#       one timer this adds, it lives for one install, and it is gone after either ending. A failed timer-triggered recovery is
#       retried after a minute: at most three persisted attempts within 30 minutes of its first attempt. Direct pull
#       rollback and recovery by hand keep their existing paths; neither spends this timer-only budget.
#   update-guard.sh disarm      the new build was confirmed through the real address: timer and copy gone. Also the way
#       on when a copy can never go back: the build that runs now stays, and the build from before can then be had
#       only from an install snapshot (go-back.sh).
#   update-guard.sh put-back pull|timer|hand [why]
#       Stops the install if it still runs (the timer's put-back only, before it takes the lock), puts back what
#       differs from the copy, starts the service again whatever happens, then disarms. Each folder goes back by a copy
#       made beside it and checked first, then moved in: a copy back that fails (a full disk) changes nothing live, and
#       the copy, its guard file and its timer stay, to be tried again. The copy goes only once everything it holds is
#       back as it was and its service is seen started (answering or not). pull.sh writes the update's result itself;
#       the timer's and a put-back by hand write it here, with wayBackArmed when the copy stays.
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
BY_HAND=(go-back.sh RECOVERY.txt REBUILD.txt pull.sh update-guard.sh watchdog.sh install-mark)
WATCHDOG_UNITS=(spark-console-watchdog.service spark-console-watchdog.timer)
# The timer's length, and how long a run waits for the lock (a test may shorten them, only with SPARK_CONSOLE_ALL_LOCAL=1).
GUARD_S=1800 LOCK_S=120
if [ "${SPARK_CONSOLE_ALL_LOCAL:-}" = 1 ] && [[ "${SPARK_CONSOLE_UPDATE_GUARD_S:-}" =~ ^[0-9]+$ ]]; then GUARD_S=$SPARK_CONSOLE_UPDATE_GUARD_S; fi
if [ "${SPARK_CONSOLE_ALL_LOCAL:-}" = 1 ] && [[ "${SPARK_CONSOLE_UPDATE_LOCK_S:-}" =~ ^[0-9]+$ ]]; then LOCK_S=$SPARK_CONSOLE_UPDATE_LOCK_S; fi

say() { echo "  $*"; }
# The two ways on from a copy that stays armed (said in every refusal and result that leaves it so).
WAYS="put it back again once it can be (make room first if the disk is full): bash $G/update-guard.sh put-back hand. Or, if it can never go back, give the way back up and keep the build that runs now: bash $G/update-guard.sh disarm (the build from before can then be had only from an install snapshot: bash $SHARE/go-back.sh)"
# systemctl for the user's manager, with this script's lock and pull.sh's left behind (nothing it starts holds them).
sc() { systemctl --user "$@" 8>&- 9>&-; }
# One at a time: a put-back by the timer and one by pull.sh, a put-back and a disarm, or an arm, never run together, and
# nothing is changed without the lock (the timer's run may stop pull.sh's own group first, then asks for it again). It
# fails (1) when another run still holds it after LOCK_S seconds, (2) with no flock.
lock() {
  mkdir -p "$SHARE" || return 1
  command -v flock >/dev/null 2>&1 || { say "flock isn't on this Spark, so the way back can't be sure it runs alone. Nothing was changed."; return 2; }
  exec 8>"$SHARE/update-guard.lock" || return 1
  flock -w "$LOCK_S" 8
}
held() { say "Another run of the way back still holds its lock ($SHARE/update-guard.lock), so nothing was changed$1. Try again once it has ended."; }
field() { sed -n "s/^$1=//p" "$G/guard" 2>/dev/null | head -n 1; }
# Cancel a failed run's pending restart before disarming or giving a later install this unit name. A missing unit
# is fine; a manager that cannot stop a live or queued run is not. Never call this from the timer's own service.
stop_retries() {
  sc stop "$NAME.service" >/dev/null 2>&1 && return 0
  case "$(sc is-active "$NAME.service" 2>/dev/null)" in inactive|failed|unknown) return 0 ;; esac
  say "The update's pending way back couldn't be stopped. Its copy is kept; nothing else was installed."
  return 1
}
timer_off() {
  sc disable --now "$NAME.timer" >/dev/null 2>&1
  [ "${by:-}" = timer ] || stop_retries || return 1
  rm -f "$UNITS/$NAME.timer" "$UNITS/$NAME.service"
  sc daemon-reload >/dev/null 2>&1
  return 0
}
socket_build() {
  curl -q -s -m 3 --unix-socket "$STATE/api.sock" http://localhost/health 2>/dev/null | python3 -I -c 'import json, sys
d = json.loads(sys.stdin.read())
print(d.get("build") or "" if d.get("ok") is True else "")' 2>/dev/null || true
}
# copy_dir <from> <to>: an exact copy, if <from> is there.
copy_dir() { [ ! -d "$1" ] || { mkdir -p "$2" && cp -a "$1/." "$2/"; }; }
# stage <saved> <beside>: an exact copy of a saved folder made beside the live one, and checked. Nothing live changes.
stage() { rm -rf "$2" && mkdir -p "$2" && cp -a "$1/." "$2/" && same "$1" "$2"; }
# swap <beside> <live>: the live folder's contents become the staged ones, moved in (on one disk a move needs no room).
# It stays the same folder, so Tailscale's routes keep pointing at it.
swap() {
  local e ok=0
  { mkdir -p "$2" && find "$2" -mindepth 1 -delete; } || ok=1
  for e in "$1"/* "$1"/.[!.]* "$1"/..?*; do { [ -e "$e" ] || [ -L "$e" ]; } || continue; mv "$e" "$2/" || ok=1; done
  rmdir "$1" 2>/dev/null
  return $ok
}
# put_file <saved> <live>: one file back by a copy beside it, checked, then renamed over the live one.
put_file() {
  local t="${2%/*}/.${2##*/}.putback"
  { cp -p "$1" "$t" && same "$1" "$t" && mv -f "$t" "$2"; } || { rm -f "$t"; return 1; }
}
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
  [ ! -f "$HOME/spark-console-src.manifest" ] || cp -p "$HOME/spark-console-src.manifest" "$G/src.manifest" || return 1
  for u in spark-console-api.service "${WATCHDOG_UNITS[@]}"; do [ ! -f "$UNITS/$u" ] || cp -p "$UNITS/$u" "$G/units/" || return 1; done
  for f in "${BY_HAND[@]}"; do [ ! -f "$SHARE/$f" ] || cp -p "$SHARE/$f" "$G/share/" || return 1; done
  cp "$0" "$G/update-guard.sh"
}
arm() {
  [ $# = 4 ] && [[ "$1" =~ ^[0-9a-f]{12}$ ]] && [[ "$2" =~ ^[0-9a-f]{12}$ ]] && [[ "$3" =~ ^[0-9a-f]{12}$ ]] && [[ "$4" =~ ^[0-9]+$ ]] \
    || { echo "Usage: $0 arm <tree> <new build> <old build> <process group>" >&2; return 2; }
  local r=0
  lock || r=$?
  if [ "$r" != 0 ]; then [ "$r" = 2 ] || held ''; return 1; fi
  if [ -e "$G" ] && ! whole; then rm -rf "$G"; fi
  [ ! -e "$G" ] || { say "An earlier update's way back is still armed ($G). To go on: $WAYS."; return 1; }
  # The old run can still be waiting in RestartSec after its copy went. Stop it before this path names a new copy.
  stop_retries || return 1
  if ! sc reset-failed "$NAME.service" >/dev/null 2>&1; then
    [ "$(sc show --property=LoadState --value "$NAME.service" 2>/dev/null)" = not-found ] \
      || { say "The way back's retry count couldn't be reset. Nothing was installed."; return 1; }
  fi
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
ConditionPathExists=%h/.local/share/spark-console/update-guard/guard
StartLimitIntervalSec=infinity
StartLimitBurst=3
[Service]
Type=oneshot
Restart=on-failure
RestartSec=60s
TimeoutStartSec=9min
TimeoutStopSec=10s
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
  local r=0
  lock || r=$?
  if [ "$r" != 0 ]; then [ "$r" = 2 ] || held ', and the way back is still armed'; return 1; fi
  [ -d "$G" ] || { say "The way back had already put the build from before back."; return 1; }
  timer_off || return 1
  drop
  return 0
}

# stop_install: an install still running is stopped (only pull.sh's own group, on this boot). For the timer's put-back.
stop_install() {
  local pgid boot
  pgid=$(field pgid); boot=$(field boot)
  [[ "$pgid" =~ ^[0-9]+$ ]] && [ "$boot" = "$(cat /proc/sys/kernel/random/boot_id 2>/dev/null)" ] \
    && kill -0 -- "-$pgid" 2>/dev/null && ps -o args= -p "$pgid" 2>/dev/null | grep -q 'pull\.sh' || return 1
  say "Stopping the update that is still running ..."
  kill -TERM -- "-$pgid" 2>/dev/null
  for _ in $(seq 1 60); do kill -0 -- "-$pgid" 2>/dev/null || break; sleep 1; done
  kill -KILL -- "-$pgid" 2>/dev/null
  return 0
}
# result <why> <armed: yes|no>: the update's result, for the timer's put-back and one by hand (pull.sh writes its own).
# wayBackArmed says the copy stays armed, whatever the words: the console reads that, not the wording.
result() {
  [ "$by" != pull ] || return 0
  python3 -I -c 'import datetime, json, os, sys, tempfile
path, tree, build, why, armed = sys.argv[1:6]
d = {"tree": tree or None, "build": build or None, "result": "not kept", "why": why[:600], "wayBackArmed": armed == "yes",
     "at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")}
os.makedirs(os.path.dirname(path), exist_ok=True)
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".update-result.", suffix=".tmp")
with os.fdopen(fd, "w") as f: json.dump(d, f)
os.replace(tmp, path)' "$STATE/update-result.json" "$tree" "$build" "$1" "${2:-no}" 2>/dev/null
}
# kept <what happened>: the build from before isn't back. The copy, its guard file and its timer stay (the timer fires
# again after a restart of the hub), and both ways on are said.
kept() {
  local note="$1"
  if [ "${by:-}" = timer ] && [ "$(field autoTries)" = 3 ]; then
    note="$note Timer-triggered recovery has used its three tries; recovery by hand is needed."
  fi
  say "$note Its copy is kept, and the way back stays armed. To go on: $WAYS."
  result "$why; $note Its copy is kept, and the way back stays armed. To go on: $WAYS." yes
}
# started: the service runs, or systemd is starting it (a start was taken), as systemd says.
started() { sc is-active --quiet spark-console-api && return 0; case "$(sc is-active spark-console-api 2>/dev/null)" in activating|reloading) return 0 ;; esac; return 1; }
# back_whole: everything the copy holds is back as it was (the page, the service and its unit, the by-hand files, the
# watchdog's units, the source). Only then does the copy go.
back_whole() {
  local f u
  { [ ! -d "$G/ui" ] || same "$G/ui" "$HOME/spark-console"; } && { [ ! -d "$G/service" ] || same "$G/service" "$HOME/spark-console-service"; } \
    && { [ ! -f "$G/units/spark-console-api.service" ] || same "$G/units/spark-console-api.service" "$UNITS/spark-console-api.service"; } || return 1
  for f in "${BY_HAND[@]}"; do same "$G/share/$f" "$SHARE/$f" || return 1; done
  for u in "${WATCHDOG_UNITS[@]}"; do [ ! -f "$G/units/$u" ] || same "$G/units/$u" "$UNITS/$u" || return 1; done
  { [ ! -d "$G/src" ] || same "$G/src" "$HOME/spark-console-src"; } \
    && same "$G/src.manifest" "$HOME/spark-console-src.manifest"
}

# A timer-triggered attempt consumes its place under the same lock, before any live file changes. The existing
# guard record keeps this across hub restarts. Leave enough of its 30-minute budget for one bounded service start.
take_try() {
  python3 -I - "$G/guard" <<'PY'
import os, re, sys, tempfile, time
path = sys.argv[1]
tmp = None
try:
    pairs = [line.split('=', 1) for line in open(path).read().splitlines()]
    fields = dict(pairs)
    if len(fields) != len(pairs): raise ValueError('duplicate fields')
    tries, since = fields.get('autoTries', '0'), fields.get('autoSince', '0')
    if not re.fullmatch('[0-3]', tries) or not re.fullmatch('[0-9]+', since): raise ValueError('bad retry record')
    tries, since, now = int(tries), int(since), int(time.time())
    if (tries == 0) != (since == 0): raise ValueError('incomplete retry record')
    if tries >= 3 or (since and (now < since or now - since + 550 > 1800)):
        print('Timer-triggered recovery reached its three-try or thirty-minute limit. The saved copy needs recovery by hand.')
        sys.exit(1)
    fields.update(autoTries=str(tries + 1), autoSince=str(since or now))
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix='.guard-')
    with os.fdopen(fd, 'w') as f:
        f.write(''.join(k + '=' + v + '\n' for k, v in fields.items()))
        f.flush(); os.fsync(f.fileno())
    os.replace(tmp, path); tmp = None
    directory = os.open(os.path.dirname(path), os.O_RDONLY)
    try: os.fsync(directory)
    finally: os.close(directory)
except Exception:
    print("The automatic put-back's retry record couldn't be saved safely. The saved copy needs recovery by hand.")
    sys.exit(1)
finally:
    if tmp:
        try: os.unlink(tmp)
        except OSError: pass
PY
}

put_back() {
  local by="${1:-hand}" why="${2:-}" tree build from restart='' back='' now r=0 f u
  lock || r=$?
  # (the timer's run: an install still running may hold things up; it is stopped first, then the lock asked for again)
  if [ "$r" = 1 ] && [ "$by" = timer ] && whole && stop_install; then r=0; lock || r=$?; fi
  if [ "$r" != 0 ]; then [ "$r" = 2 ] || held ''; return 1; fi
  [ -d "$G" ] || { say "Nothing to put back: no update's way back is armed."; return 0; }
  whole || { say "The copy in $G isn't whole (an earlier run was cut off), so nothing is put back from it. It is removed."; timer_off; rm -rf "$G"; return 1; }
  tree=$(field tree); build=$(field build); from=$(field from)
  [ -n "$why" ] || why='nothing confirmed the new build through the real address in time'
  if [ "$by" = timer ]; then
    local retry_note
    if ! retry_note=$(take_try); then kept "$retry_note"; return 0; fi
  fi
  # However this ends from here, the service is started again (a start of a running service changes nothing).
  trap 'sc daemon-reload >/dev/null 2>&1; sc start spark-console-api >/dev/null 2>&1' EXIT
  # From the timer: an install still running is stopped first.
  [ "$by" != timer ] || stop_install || true
  same "$G/ui" "$HOME/spark-console" && same "$G/service" "$HOME/spark-console-service" \
    && same "$G/units/spark-console-api.service" "$UNITS/spark-console-api.service" || restart=1
  if [ -n "$restart" ]; then
    # First the build from before is copied beside each live folder and checked: a copy that fails (a full disk, a
    # disk error) changes nothing live, and the new build goes on running until the copy can be put back.
    if ! { { [ ! -d "$G/ui" ] || stage "$G/ui" "$HOME/.spark-console.putback"; } \
        && { [ ! -d "$G/service" ] || stage "$G/service" "$HOME/.spark-console-service.putback"; } \
        && { [ ! -f "$G/units/spark-console-api.service" ] || { mkdir -p "$UNITS" && cp -p "$G/units/spark-console-api.service" "$UNITS/.spark-console-api.service.putback" \
          && same "$G/units/spark-console-api.service" "$UNITS/.spark-console-api.service.putback"; }; }; }; then
      rm -rf "$HOME/.spark-console.putback" "$HOME/.spark-console-service.putback"; rm -f "$UNITS/.spark-console-api.service.putback"
      kept "The build from before the update couldn't be put back whole: it couldn't be copied back (is the disk full?), so this run changed none of its files."
      return 1
    fi
    say "Putting the build from before the update back (its page, its service and its unit; people, chats and settings stay) ..."
    sc stop spark-console-api >/dev/null 2>&1
    [ ! -d "$G/ui" ] || swap "$HOME/.spark-console.putback" "$HOME/spark-console"
    [ ! -d "$G/service" ] || swap "$HOME/.spark-console-service.putback" "$HOME/spark-console-service"
    [ ! -f "$UNITS/.spark-console-api.service.putback" ] || mv -f "$UNITS/.spark-console-api.service.putback" "$UNITS/spark-console-api.service"
    sc daemon-reload >/dev/null 2>&1
    sc restart spark-console-api >/dev/null 2>&1
  fi
  # The by-hand files, the watchdog and the source, as they were (no restart for these), each by a copy beside it. A
  # file that wasn't there goes, only while the copy is whole: a copy that went away under this run removes nothing.
  for f in "${BY_HAND[@]}"; do
    if [ -f "$G/share/$f" ]; then same "$G/share/$f" "$SHARE/$f" || put_file "$G/share/$f" "$SHARE/$f"
    elif whole; then rm -f "$SHARE/$f"; fi
  done
  for u in "${WATCHDOG_UNITS[@]}"; do
    if [ -f "$G/units/$u" ]; then same "$G/units/$u" "$UNITS/$u" || put_file "$G/units/$u" "$UNITS/$u"; fi
  done
  if [ -d "$G/src" ] && ! same "$G/src" "$HOME/spark-console-src"; then
    if stage "$G/src" "$HOME/spark-console-src.back"; then rm -rf "$HOME/spark-console-src" && mv "$HOME/spark-console-src.back" "$HOME/spark-console-src"
    else rm -rf "$HOME/spark-console-src.back"; fi
  fi
  # The source's tree proof travels with it. A failed copy keeps the guard armed; an older install had no proof.
  if [ -f "$G/src.manifest" ]; then
    same "$G/src.manifest" "$HOME/spark-console-src.manifest" || put_file "$G/src.manifest" "$HOME/spark-console-src.manifest"
  elif whole; then rm -f "$HOME/spark-console-src.manifest"; fi
  whole || { say "The copy in $G went away while this ran (another run took it), so nothing more was changed."; return 1; }
  # Not all back as the copy holds it: the copy stays armed, to be tried again.
  back_whole || { kept "The build from before the update couldn't be put back whole: some of its files couldn't be copied back (is the disk full?)."; return 1; }
  # The copy goes only once its service is seen started (running, or being started by systemd): a run cut off after its
  # last move left it stopped, say, and then nothing differs here.
  started || { sc daemon-reload >/dev/null 2>&1; sc start spark-console-api >/dev/null 2>&1; sleep 2; started; } \
    || { kept "The files of the build from before the update are back, but its service couldn't be started."; return 1; }
  # The newest install snapshot now holds what is installed: "Undo the last update" and go-back.sh pass over it.
  local snap
  snap=$(ls -d "$SHARE"/releases/[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z 2>/dev/null | tail -n 1)
  if [ -n "$snap" ] && [ ! -e "$snap/same" ] && same "$snap/spark-console-service" "$HOME/spark-console-service" \
      && same "$snap/spark-console" "$HOME/spark-console"; then : > "$snap/same"; fi
  # Answering again: the build from before, on the socket.
  for _ in $(seq 1 30); do now=$(socket_build); [ -z "$now" ] || break; sleep 1; done
  if [ -n "$now" ] && { [ "$now" = "$from" ] || [ -z "$restart" ]; }; then back=yes; fi
  # (the files are back whole, so the copy holds nothing the live folders don't: it goes, answering or not)
  timer_off || { kept "The files are back, but automatic retries couldn't be stopped."; return 1; }
  result "$why; $([ -n "$back" ] && echo "the build from before ($from) was put back and answers" || echo "the build from before was put back but doesn't answer")" no
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
