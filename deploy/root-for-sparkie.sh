#!/usr/bin/env bash
# The owner's one-time command for Sparkie's root helper (docs/rules/R42.md; design: docs/design-2026-11-13/
# a-workspace.md, 2.13). Run it once for each Spark, in your own terminal: the compute Sparks first, Spark 2 last.
#
#   bash spark-console/deploy/root-for-sparkie.sh --check 3   what is there for each wall; changes nothing, asks no password
#   bash spark-console/deploy/root-for-sparkie.sh 3           set it up on Spark 3; sudo asks that Spark's password once
#   bash spark-console/deploy/root-for-sparkie.sh --undo 3    remove it again: the line, then the helper, then the mark
#   bash spark-console/deploy/root-for-sparkie.sh --hub 2     Spark 2 itself, the hub: last, and only with --hub
#
# From the Mac it does one thing: it runs Spark 2's installed copy of itself over ssh
# (ssh -t <you>@<Spark 2> 'bash ~/spark-console-src/deploy/root-for-sparkie.sh 3'), so what goes on a Spark is always
# the installed build's. There, it copies the helper (deploy/spark-console-root) to that Spark's ~/.cache/spark-console/
# and runs the short set-up script below on that Spark, in a terminal. The set-up script travels on the command line
# and is never written to disk; nothing your account can write is installed or run after the password is typed:
#   1. Spark 2 is refused without --hub, and --hub anywhere else (here by the Spark's number, there by its machine id)
#   2. /usr, /usr/local and /usr/local/sbin must be writable by root alone
#   3. the copy's SHA-256 must be the one Spark 2 sent
#   4. the sudo line is written by root to /etc/sudoers.d/spark-console-root.new (sudo skips a name with a dot) and
#      checked there with visudo -cf: if that fails, it is removed and nothing has changed
#   5. the helper is copied by root to /usr/local/sbin/spark-console-root.new and hashed again there, now that only root
#      can change it; a different SHA-256 removes both new files and nothing has changed. Then it is moved into place
#   6. the line is moved to /etc/sudoers.d/spark-console-root (root, 0440); it names that one file and no other command:
#        <you> ALL=(root) NOPASSWD: /usr/local/sbin/spark-console-root
#   7. the helper proves its walls and prints each wall's result; if the proof fails, the line and the helper are
#      removed again, so nothing half set up is left
# Run again, it changes nothing when this build's helper, the same line and a current proof are already there.
# It never touches SSH settings, Tailscale, a firewall, users, Docker or a container, and keeps no password anywhere.
set -euo pipefail

usage() { echo "Usage: bash $0 [--check | --undo] [--hub] <Spark number>   (for example: --check 3)" >&2; exit 2; }
stop() { echo "Stopped: $*" >&2; exit 2; }

MODE=install HUB=0 N=''
for a in "$@"; do
  case "$a" in
    --check|--undo) [ "$MODE" = install ] || usage; MODE=${a#--} ;;
    --hub) HUB=1 ;;
    [1-9]|[1-9][0-9]) [ -z "$N" ] || usage; N=$a ;;
    *) usage ;;
  esac
done
[ -n "$N" ] || usage
FLAGS=''
[ "$MODE" = install ] || FLAGS="--$MODE "
[ "$HUB" = 0 ] || FLAGS+='--hub '

# Not Spark 2's installed copy (the Mac's, say): run that one instead, so what is installed is the installed build's.
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/root-for-sparkie.sh"
INSTALLED=$(realpath "$HOME/spark-console-src/deploy/root-for-sparkie.sh" 2>/dev/null || true)
if [ "$SELF" != "$INSTALLED" ]; then
  HOST="${SPARK2:-akuppala@100.79.155.126}"
  echo "Running Spark 2's installed copy ($HOST), so what goes on the Spark is the installed build's."
  exec ssh -t "$HOST" "bash ~/spark-console-src/deploy/root-for-sparkie.sh $FLAGS$N"
fi

HERE=${SELF%/*}
HELPER_FILE="$HERE/spark-console-root"
CONFIG="$HERE/../service/config.json"
[ -f "$HELPER_FILE" ] && [ -f "$CONFIG" ] || stop "this build has no deploy/spark-console-root or no Spark list"
read -r ADDR FLEET_USER < <(python3 -I -c '
import json, sys
c = json.load(open(sys.argv[1]))
n = [x for x in c.get("nodes", []) if x.get("id") == sys.argv[2]]
print(n[0].get("host") or "-" if n else "-", c.get("user") or "-")' "$CONFIG" "spark$N") || stop "couldn't read Spark Console's list of Sparks"
[ "$ADDR" != - ] || stop "Spark $N is not on Spark Console's list"
if [ "$ADDR" = local ]; then
  [ "$HUB" = 1 ] || stop "Spark $N runs Spark Console: it is the hub, set up last, after a compute Spark, and only with --hub: bash ~/spark-console-src/deploy/root-for-sparkie.sh ${FLAGS}--hub $N"
else
  [ "$HUB" = 0 ] || stop "--hub is only for Spark 2 itself; Spark $N is a compute Spark"
  [[ $ADDR =~ ^[A-Za-z0-9.-]+$ && $FLEET_USER =~ ^[a-z_][a-z0-9_-]*$ ]] || stop "Spark $N's address or the fleet's account is not a plain name"
fi
HUB_ID=$(systemd-id128 machine-id 2>/dev/null || true)
[[ $HUB_ID =~ ^[0-9a-f]{32}$ ]] || stop "couldn't read Spark 2's machine id (it is how Spark 2 is told apart), so nothing was done"
read -r SHA _ < <(sha256sum "$HELPER_FILE")

# The set-up script: run on the Spark being set up, as you, in a terminal (sudo asks there). It is never written to a
# file: it travels as one quoted word on the command line (sq), or on bash's input for --check.
sq() { local s=${1//\'/\'\\\'\'}; printf "'%s'" "$s"; }
setup_text() {
  cat <<'SETUP'
# The set-up half of spark-console's deploy/root-for-sparkie.sh, run on the Spark being set up, as you.
#   bash -c '<this text>' root-setup install|check|undo <the helper's SHA-256> <Spark 2's machine id> <1 with --hub, else 0>
set -euo pipefail
HELPER=/usr/local/sbin/spark-console-root
LINE=/etc/sudoers.d/spark-console-root
MARK=/var/lib/spark-console/proved
COPY="$HOME/.cache/spark-console/spark-console-root.copy"
# What the run wall holds in your home must be there (the helper's MUST_BE_THERE: the same names, kept in step with it):
# a start file, or a folder something outside the walls reads, that is not there could be made from inside the wall.
MUST='.bashrc .profile .bash_profile .bash_logout .bash_aliases .pam_environment .ssh .docker .config/systemd
  .config/environment.d .config/autostart .config/user-tmpfiles.d .local/share/systemd .local/share/user-tmpfiles.d
  .cache/spark-console'
# Names the wall holds that must not be links (nor sit under one): the helper refuses a change until each is real.
HELD="$MUST .bash_login .zshenv .zprofile .zshrc .zlogin .zlogout .config/fish .local/opt .local/share/code-server
  .config/code-server .config/spark-console .local/share/spark-console .local/state/spark-console spark-console
  spark-console-service spark-console-src .config .local .local/share .local/state .cache"
# Where an enabled unit of yours may take its program from without a change being able to rewrite it.
SAFE_RUN=".local/opt .local/share/code-server spark-console spark-console-service spark-console-src .cache/spark-console
  .config/systemd .local/share/systemd"
stop() { echo "  Stopped on $(hostname): $*" >&2; exit 2; }
note() { echo "  $*"; }
new_id() { od -An -N8 -tx1 /dev/urandom | tr -d ' \n'; }
show() { local id rest; while read -r id rest; do [ -n "$rest" ] && echo "    $rest"; done; return 0; }

missing() { local n; for n in $MUST; do [ -e "$HOME/$n" ] || [ -L "$HOME/$n" ] || printf '%s ' "$n"; done; }
links() {   # as the helper judges them: each name's real path must be its own (the home's too)
  local n real
  [ "$(realpath -e -- "$HOME" 2>/dev/null)" = "$HOME" ] || printf '%s ' "$HOME"
  for n in $HELD; do
    [ -e "$HOME/$n" ] || [ -L "$HOME/$n" ] || continue
    real=$(realpath -e -- "$HOME/$n" 2>/dev/null) || real=''
    [ "$real" = "$HOME/$n" ] || printf '%s ' "$n"
  done
}
home_lines() {   # what the run wall needs of your home, and what reaches round it: reads only
  local v u path n bad files
  v=$(missing)
  if [ -n "$v" ]; then note "not there, made when you set up (a change could make them): ${v% }"; else note "every name the run wall holds is there"; fi
  v=$(links)
  if [ -n "$v" ]; then note "links, which the run wall refuses until each is the real file or folder: ${v% }"; else note "no name the run wall holds is a link"; fi
  files=$(grep -ls 'user_readenv=1' /etc/pam.d/* 2>/dev/null | tr '\n' ' ' || true)
  if [ -n "$files" ]; then note "PAM reads ~/.pam_environment: yes (${files% }); the run wall holds it read-only"; else note "PAM reads ~/.pam_environment: no"; fi
  bad=''
  while read -r u _; do
    [ -n "$u" ] || continue
    path=$(systemctl show --user --property=ExecStart --value "$u" 2>/dev/null | grep -o 'path=[^ ;]*' | head -n 1 || true)
    path=${path#path=}
    case "$path" in "$HOME"/*) ;; *) continue ;; esac
    for n in $SAFE_RUN; do case "$path" in "$HOME/$n"/*) continue 2 ;; esac; done
    bad+="$u ($path) "
  done < <(for d in "$HOME/.config/systemd/user" /etc/systemd/user; do   # enabled: linked into a .wants folder
             find "$d" -mindepth 2 -maxdepth 2 -path '*.wants/*' -printf '%f\n' 2>/dev/null || true
           done | sort -u)
  if [ -n "$bad" ]; then note "enabled units of yours that run a program a change could rewrite: ${bad% }"; else note "no enabled unit of yours runs a program a change could rewrite"; fi
  v=$(tailscale debug prefs 2>/dev/null || true)
  if [[ $v == *'"RunSSH": true'* ]]; then
    note "Tailscale SSH: on. Any program on your tailnet signed in as you can open a shell here with no key, outside every"
    note "wall (from a change running on another Spark, too). To turn it off: sudo tailscale set --ssh=false"
  elif [[ $v == *'"RunSSH": false'* ]]; then note "Tailscale SSH: off"
  else note "Tailscale SSH: could not tell (tailscale debug prefs did not answer)"; fi
}
make_missing() {   # as you, before the password: each name the run wall holds that is not there
  local n
  for n in $MUST; do
    [ -e "$HOME/$n" ] || [ -L "$HOME/$n" ] && continue
    case "$n" in
      .ssh) mkdir -m 0700 -- "$HOME/.ssh" ;;
      .bash_profile)   # what bash read without one: .bash_login if there is one, else .profile
        if [ -e "$HOME/.bash_login" ]; then printf '%s\n' '. "$HOME/.bash_login"' > "$HOME/.bash_profile"
        else printf '%s\n' '. "$HOME/.profile"' > "$HOME/.bash_profile"; fi ;;
      .bashrc|.profile|.bash_logout|.bash_aliases|.pam_environment) : > "$HOME/$n" ;;
      *) mkdir -p -- "$HOME/$n" ;;
    esac
    note "made $n (it was not there, and the run wall holds it)"
  done
}

check() {
  local id out v major h
  note "checking: nothing is changed and no password is asked"
  id=$(new_id)
  if out=$(sudo -n "$HELPER" check --id "$id" 2>/dev/null); then
    read -r _ _ v < <(grep -m1 "^$id helper " <<<"$out" || true) || true
    if [ "$v" = "$1" ]; then note "the helper ($HELPER): there, this build's"
    else note "the helper ($HELPER): there, but not this build's (run the command again to replace it)"; fi
    note "its sudo line ($LINE): works, the helper runs without a password"
    read -r _ _ v < <(grep -m1 "^$id proof " <<<"$out" || true) || true
    if [ "$v" != current ]; then
      note "set up, but its walls are not proven (a proof was stopped, failed, or is out of date): look and run refuse here"
      note "until a proof passes. Run this command again without --check to prove them, or --undo to remove the line and the helper."
    fi
    home_lines
    note "what the helper says:"
    grep "^$id " <<<"$out" | grep -v "^$id helper " | show
    return 0
  fi
  v=$(systemctl show --property=Version --value 2>/dev/null | head -n 1 || true)
  major=${v%%[!0-9]*}
  if [ -n "$major" ] && (( 10#$major >= 248 )); then note "systemd $v (needs 248 or newer): ok"
  else note "systemd ${v:-not answering} (needs 248 or newer): no"; fi
  if [ "$(cat /proc/1/comm 2>/dev/null)" = systemd ]; then note "systemd is the first process: ok"; else note "systemd is the first process: no"; fi
  if [ -f /sys/fs/cgroup/cgroup.controllers ]; then note "control groups in one tree (cgroup2): ok"; else note "control groups in one tree (cgroup2): no"; fi
  h=$(unshare --help 2>&1 || true)
  if [[ $h == *--kill-child* && $h == *--mount-proc* ]]; then note "unshare knows --kill-child and --mount-proc: ok"; else note "unshare knows --kill-child and --mount-proc: no"; fi
  h=$(setpriv --help 2>&1 || true)
  if [[ $h == *--groups* && $h == *--bounding-set* ]]; then note "setpriv knows --groups and --bounding-set: ok"; else note "setpriv knows --groups and --bounding-set: no"; fi
  if python3 -I -S -c 'import ctypes' 2>/dev/null; then note "python3, for the wall proof: ok"; else note "python3, for the wall proof: no"; fi
  if folders_ok; then note "/usr, /usr/local and /usr/local/sbin, writable by root alone: ok"; else note "/usr, /usr/local and /usr/local/sbin, writable by root alone: no"; fi
  if [ -e "$HELPER" ]; then note "the helper ($HELPER): there, but sudo asks for a password to run it (its line is missing)"
  else note "the helper ($HELPER): not there"; fi
  note "its sudo line ($LINE): not working (not there, or sudo asks for a password)"
  home_lines
  note "look wall: not set up"
  note "run wall: not set up"
  note "root (the net): not built yet, refused on every Spark"
}

folders_ok() {
  local d uid mode
  for d in /usr /usr/local /usr/local/sbin; do
    read -r uid mode < <(stat -c '%u %a' "$d" 2>/dev/null || echo '- -')
    [ "$uid" = 0 ] && (( (8#$mode & 8#022) == 0 )) || return 1
  done
}

install() {
  local sha=$1 me got have_line have_sha want_line state
  folders_ok || stop "/usr, /usr/local or /usr/local/sbin can be written by an account other than root, so the helper would not be safe there. Nothing was changed."
  [ -f "$COPY" ] || stop "the copy of the helper did not arrive. Nothing was changed."
  read -r got _ < <(sha256sum "$COPY")
  [ "$got" = "$sha" ] || stop "the copy's SHA-256 is not the one Spark 2 sent. Nothing was changed."
  make_missing
  me=$(id -un)
  want_line="$me ALL=(root) NOPASSWD: $HELPER"
  note "the helper to install has SHA-256 $sha"
  note "sudo asks for your password on $(hostname), once"
  sudo -v || stop "sudo did not accept the password. Nothing was changed."
  have_line=$(sudo cat "$LINE" 2>/dev/null || true)
  read -r have_sha _ < <(sudo sha256sum "$HELPER" 2>/dev/null || echo '-')
  if [ "$have_sha" = "$sha" ] && [ "$have_line" = "$want_line" ]; then
    state=$(sudo "$HELPER" check --id "$(new_id)" 2>/dev/null | awk '$2 == "proof" { print $3 }' || true)
    if [ "$state" = current ]; then note "already set up: this build's helper, its line and a current proof. Nothing was changed."; return 0; fi
  fi
  # From here everything is staged as root, under names nothing uses, and checked where only root can change it.
  sudo rm -f "$LINE.new" "$HELPER.new"
  printf '%s\n' "$want_line" | sudo tee "$LINE.new" > /dev/null
  sudo chmod 0440 "$LINE.new"
  if ! sudo visudo -cf "$LINE.new" > /dev/null; then sudo rm -f "$LINE.new"; stop "visudo did not accept the sudo line, so nothing was changed."; fi
  if [ "$have_sha" != "$sha" ]; then
    sudo install -o root -g root -m 0755 "$COPY" "$HELPER.new"
    read -r got _ < <(sudo sha256sum "$HELPER.new" || echo '-')
    if [ "$got" != "$sha" ]; then
      sudo rm -f "$HELPER.new" "$LINE.new"
      stop "the helper's copy changed after it arrived (its SHA-256 is no longer the one Spark 2 sent), so nothing was installed."
    fi
    sudo mv -f "$HELPER.new" "$HELPER"
    note "the helper is in place: $HELPER"
  fi
  if [ "$have_line" != "$want_line" ]; then sudo mv -f "$LINE.new" "$LINE"; note "its sudo line is in place: $LINE"
  else sudo rm -f "$LINE.new"; fi
  note "proving the walls (a few seconds):"
  if sudo -n "$HELPER" prove --id "$(new_id)" | show; then
    note "done: the helper is set up and its walls are proven on $(hostname)."
    return 0
  fi
  sudo rm -f "$LINE"
  sudo rm -f "$HELPER"
  note "the proof failed (the line above says which attempt got through), so the sudo line and the helper were removed again. Nothing half set up is left."
  return 1
}

undo() {
  note "sudo asks for your password on $(hostname), once"
  sudo -v || stop "sudo did not accept the password. Nothing was changed."
  sudo rm -f "$LINE" "$LINE.new"; note "the sudo line is gone: $LINE"
  sudo rm -f "$HELPER" "$HELPER.new"; note "the helper is gone: $HELPER"
  sudo rm -f "$MARK"; note "the proof's mark is gone: $MARK"
  note "(copies under /var/lib/spark-console stay, and a put-back timer already armed still fires)"
}

main() {
  local mode=$1 sha=$2 hub_id=$3 hub=$4 mid
  [[ $mode =~ ^(install|check|undo)$ && $sha =~ ^[0-9a-f]{64}$ && $hub_id =~ ^[0-9a-f]{32}$ && $hub =~ ^[01]$ ]] \
    || stop "the set-up script was called with something it does not understand"
  if [ "$mode" != check ]; then trap 'rm -f "$COPY"' EXIT; fi
  mid=$(systemd-id128 machine-id 2>/dev/null || true)
  [[ $mid =~ ^[0-9a-f]{32}$ ]] || stop "couldn't read this Spark's machine id, so nothing was done"
  if [ "$mid" = "$hub_id" ] && [ "$hub" != 1 ]; then stop "this is Spark 2, the hub: it is set up last, and only with --hub."; fi
  if [ "$mid" != "$hub_id" ] && [ "$hub" = 1 ]; then stop "--hub is only for Spark 2 itself, and this is another Spark."; fi
  case "$mode" in
    check) check "$sha" ;;
    install) install "$sha" ;;
    undo) undo ;;
  esac
}
main "$@"
SETUP
}

if [ "$ADDR" = local ]; then
  echo "Spark $N (this Spark, the hub):"
  if [ "$MODE" = check ]; then exec bash -s -- check "$SHA" "$HUB_ID" 1 < <(setup_text); fi
  if [ "$MODE" = install ]; then
    mkdir -p "$HOME/.cache/spark-console"
    cp "$HELPER_FILE" "$HOME/.cache/spark-console/spark-console-root.copy"
  fi
  exec bash -c "$(setup_text)" root-setup "$MODE" "$SHA" "$HUB_ID" 1
fi
DEST="$FLEET_USER@$ADDR"
echo "Spark $N ($ADDR):"
if [ "$MODE" = check ]; then exec ssh -o ConnectTimeout=8 "$DEST" "bash -s -- check $SHA $HUB_ID 0" < <(setup_text); fi
if [ "$MODE" = install ]; then
  ssh -o ConnectTimeout=8 "$DEST" 'mkdir -p ~/.cache/spark-console && cat > ~/.cache/spark-console/spark-console-root.copy' < "$HELPER_FILE" \
    || stop "couldn't copy the helper to Spark $N (is it on?)"
fi
exec ssh -t -o ConnectTimeout=8 "$DEST" "bash -c $(sq "$(setup_text)") root-setup $MODE $SHA $HUB_ID 0"
