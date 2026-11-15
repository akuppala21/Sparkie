#!/usr/bin/env bash
# Puts back the Spark Console build from before the last update, by hand, when Spark Console doesn't answer (when it
# does, type /undo update in your chat instead). It runs the newest complete snapshot's restore.sh: the page, the
# service and its unit are put back and the service is restarted. People, chats and settings stay as they are.
# It never touches SSH, Tailscale, the firewall, users or any model, and needs no sudo.
#   bash ~/.local/share/spark-console/go-back.sh
# Every install copies this file there (deploy/host-on-portal.sh); RECOVERY.txt beside it lists the other steps.
# Like "Undo the last update", it passes over a snapshot marked `same` (it holds exactly what is installed: the same
# update run again, or a snapshot already put back), so running it twice goes back one more build.
set -euo pipefail
# (the stand-in fleet's tests, and the watchdog they run, add --stand-in: it goes on to restore.sh as an argument)
STAND_IN=''
[ $# -eq 0 ] || { [ $# -eq 1 ] && [ "$1" = --stand-in ] && STAND_IN=--stand-in; } \
  || { echo "Usage: bash $0   (no options: it puts back the build's files only)" >&2; exit 2; }
REL="$HOME/.local/share/spark-console/releases"
last=''
for d in "$REL"/[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z; do
  if [ -f "$d/restore.sh" ] && [ ! -e "$d/same" ]; then last="$d"; fi
done
[ -n "$last" ] || { echo "There's no earlier build to go back to on this Spark (nothing complete in $REL that differs from what's installed)." >&2; exit 1; }
echo "Going back to the build saved before the update on ${last##*/} ..."
exec bash "$last/restore.sh" ${STAND_IN:+"$STAND_IN"}
