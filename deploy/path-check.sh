#!/usr/bin/env bash
# Read-only: is every program Spark Console's own commands call on a Spark found on the fixed PATH they use there
# (R53)? Prints the missing ones by name and exits 1; changes nothing. On the Spark itself: bash path-check.sh
# From another machine: ssh <spark> bash -s < spark-console/deploy/path-check.sh
# The console makes the same look at every status round, and its needs-you list names what is missing. The list and
# the PATH are PATH_PROGRAMS and FIXED_PATH in service/src/01-setup.mjs; test/fixed-path.test.mjs holds them equal.
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin
export PATH
m=
for p in bash timeout python3 docker nvidia-smi tailscale curl tar gzip ip ss ping who sudo systemctl journalctl loginctl ps free df du find xargs readlink sed awk grep cut cat head tail tr wc sort ls mkdir rm rmdir mv ln dirname paste base64 id sleep ssh systemd-run hostname; do
  command -v "$p" >/dev/null 2>&1 || m="$m $p"
done
if [ -n "$m" ]; then echo "Not on the fixed path ($PATH):$m"; exit 1; fi
echo "Every program Spark Console's commands call is on the fixed path ($PATH)."
