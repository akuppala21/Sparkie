#!/usr/bin/env bash
# Copies the hub's own files from one Spark to another, to move the hub (docs/how/move-the-hub.md) or to move it back.
# Run it from your Mac, with Spark Console stopped on both Sparks:
#
#   bash spark-console/deploy/copy-hub-state.sh <from> <to>      Spark numbers from deploy/hub.env, for example: 2 1
#
# What goes, read on <from> and written on <to> through this Mac (the two Sparks need no key to each other):
#   ~/.local/state/spark-console               the state, but sessions.json (sign-ins: every device signs in again),
#                                              sockets and half-written files
#   ~/.config/spark-console/secrets.json       the keys, Telegram, the heartbeat, the GitHub token, the put-back record
#   ~/.config/spark-console/eval-seal.json     the seal on the brain's kept eval results
#   ~/.config/spark-console/matter             the plug controller's pairing keys
#   ~/.local/share/spark-console/journal       what was said, called and run (R43)
#   ~/.local/share/spark-console/repo.git      the copy of the repository pull.sh and check_update read
# Each of these already on <to> is moved aside first, to <its name>.before-<time> beside it: nothing is deleted. Then
# the names and sizes of what arrived are compared with <from>'s.
# It refuses, with nothing changed: a Spark deploy/hub.env doesn't name, or the same one twice; on either Spark, Spark
# Console or its watchdog running, the plug controller running, or an update's way back still armed; a <from> with no
# state. It needs no sudo, and never touches SSH settings, Tailscale, the firewall, users, a container or any model.
set -euo pipefail
. "$(dirname "$0")/hub.sh"
[ $# = 2 ] || { echo "Usage: bash $0 <from> <to>   (Spark numbers, for example: bash $0 2 1)" >&2; exit 2; }
stop() { echo "Stopped: $*. Nothing was changed." >&2; exit 2; }
F=$(spark_of "$1" || true) T=$(spark_of "$2" || true)
[ -n "$F" ] && [ -n "$T" ] || stop "$1 or $2 isn't a Spark in deploy/hub.env ($SPARKS)"
[ "$F" != "$T" ] || stop "$(says_of "$F") is named twice"
FROM="$LOGIN@$(addr_of "$F")" TO="$LOGIN@$(addr_of "$T")"

# The part that runs on each Spark, sent with each command (nothing is written there first).
read -r -d '' REMOTE <<'EOF' || true
set -euo pipefail
cd
MODE=$1
ITEMS=(.local/state/spark-console .config/spark-console/secrets.json .config/spark-console/eval-seal.json
  .config/spark-console/matter .local/share/spark-console/journal .local/share/spark-console/repo.git)
present() { local i; for i in "${ITEMS[@]}"; do if [ -e "$i" ] || [ -L "$i" ]; then echo "$i"; fi; done; }
case "$MODE" in
  look)
    echo "api=$(systemctl --user is-active spark-console-api 2>/dev/null || true)"
    echo "dog=$(systemctl --user is-active spark-console-watchdog.timer 2>/dev/null || true)"
    echo "plugs=$(docker inspect -f '{{.State.Running}}' spark-console-plugs 2>/dev/null || true)"
    if [ -s .local/share/spark-console/update-guard/guard ]; then echo guard=armed; else echo guard=; fi
    if [ -d .local/state/spark-console ]; then echo state=yes; else echo state=; fi ;;
  aside)
    for i in $(present); do mv -T -- "$i" "$i.before-$2"; echo "  moved aside on $(hostname): ~/$i.before-$2"; done ;;
  send)
    # (never the sign-ins, a socket or a half-written file)
    tar -cf - --exclude=.local/state/spark-console/sessions.json '--exclude=*.sock' '--exclude=*.tmp' -- $(present) ;;
  take)
    tar -xpf - ;;
  sum)
    for i in $(present); do
      find "$i" \( -type f -o -type l \) ! -path .local/state/spark-console/sessions.json ! -name '*.sock' ! -name '*.tmp' -printf '%p %s\n'
    done | LC_ALL=C sort | sha256sum | cut -c1-64 ;;
esac
EOF
CTL="$(mktemp -d)"
SSH=(ssh -o ControlMaster=auto -o ControlPath="$CTL/%C" -o ControlPersist=120)
trap '"${SSH[@]}" -O exit "$FROM" >/dev/null 2>&1 || true; "${SSH[@]}" -O exit "$TO" >/dev/null 2>&1 || true; rm -rf "$CTL"' EXIT
on() { local h="$1"; shift; "${SSH[@]}" "$h" "bash -c $(printf %q "$REMOTE") copy-hub-state $*"; }

for x in "$F $FROM" "$T $TO"; do
  read -r id host <<<"$x"
  look=$(on "$host" look </dev/null) || stop "$(says_of "$id") ($host) didn't answer"
  val() { sed -n "s/^$1=//p" <<<"$look"; }
  case "$(val api)" in active|activating|reloading|deactivating)
    stop "Spark Console is running on $(says_of "$id"). Stop it first, from the Mac: ssh $host 'systemctl --user disable --now spark-console-api spark-console-watchdog.timer'" ;; esac
  [ "$(val dog)" != active ] || stop "Spark Console's watchdog is on on $(says_of "$id"), and it would start the console again. Stop it first: ssh $host 'systemctl --user disable --now spark-console-api spark-console-watchdog.timer'"
  [ "$(val plugs)" != true ] || stop "the plug controller is running on $(says_of "$id"), and its pairing keys go too. Stop it first: ssh $host 'docker stop spark-console-plugs'"
  [ -z "$(val guard)" ] || stop "an update from GitHub on $(says_of "$id") still has its way back armed (RECOVERY.txt, step 6, says how to end it)"
  [ "$id" != "$F" ] || [ "$(val state)" = yes ] || stop "$(says_of "$F") has no state folder to copy"
done

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
echo "Copying the hub's files from $(says_of "$F") ($FROM) to $(says_of "$T") ($TO), through this Mac …"
on "$TO" aside "$STAMP" </dev/null
on "$FROM" send </dev/null | on "$TO" take \
  || { echo "The copy didn't finish (above). What arrived on $(says_of "$T") is incomplete; what was there before is beside it, as *.before-$STAMP. Run this again." >&2; exit 1; }
A=$(on "$FROM" sum </dev/null) B=$(on "$TO" sum </dev/null)
[ -n "$A" ] && [ "$A" = "$B" ] \
  || { echo "The copy on $(says_of "$T") doesn't hold the same files and sizes as $(says_of "$F")'s. Run this again; what was there before is beside it, as *.before-$STAMP." >&2; exit 1; }
echo "Done: $(says_of "$T") holds the hub's files as $(says_of "$F") had them (sign-ins left out); the same names and sizes on both."
