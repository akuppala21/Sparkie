#!/usr/bin/env bash
# Clearing Spark 2, the hub (design E 2.6). Only the first step is built: the look. Run it on Spark 2, as yourself:
#
#   bash ~/spark-console-src/deploy/clear-spark2.sh --check
#
# It lists what is there: units (your systemd services and timers, and the system's running services), containers,
# listening TCP ports and the folders in your home, and the programs using the most memory. It marks each unit,
# container, port and folder as Spark Console's, the brain's or something else (the owner's decision: Spark 2 runs
# only the console and the brain), then says what the later clearing step would change and what it never touches.
# The four lists are the ones a list of what may run on the hub would hold (units, containers, ports, folders), by the
# same names, so a later step can compare the two.
#
# --check changes nothing on any machine. It runs only reads (systemctl list-units and list-unit-files, docker ps,
# ss -Htlnp, tailscale serve status, ps, du and sort) and reads unit files as text: test/clear-spark2.test.mjs runs it
# against stand-ins that record every call and fails on any other command. It needs no root and asks for nothing:
# where a look needs root to be complete, it says what it could not see. Run as root, it refuses.
#
# Without --check it refuses: the clearing itself is not built yet. When it is, it follows E 2.6's safe order, each
# part on the owner's yes: Spark Console on a Node of its own first; then a build without the browser editor; then
# the editor (code-server, spark-portal-editor.service) and its tunnels stopped and switched off, not deleted; a week
# later the old portal's unit and code and the code-server install deleted, each moved aside first, by exact path
# only (never a spark-portal* pattern), and code-server only once neither the service nor a kept snapshot starts
# Spark Console with its Node (critic-safety finding 28).
#
# Never, in this script or any later mode of it (the later step keeps this list, and the test that reads it):
#   - stop, remove or restart a qwen-recipe-* container or the brain's model server (its container is labelled
#     spark.role=main, sparkie-main by default), or the Docker service they run in;
#   - run `tailscale serve ... off` or `tailscale funnel ... off`, in any form;
#   - touch the public Funnel on port 443 or the tailscaled service;
#   - change a firewall, a user or SSH.
set -uo pipefail   # (no -e: a look that can't read one thing says so and goes on to the next)
set -f             # no file name patterns, except where a folder is listed on purpose

if [ $# != 1 ] || [ "$1" != --check ]; then
  echo "Nothing was changed. Clearing Spark 2 is not built yet; for now this script only looks." >&2
  echo "To look (it changes nothing): bash $0 --check" >&2
  exit 2
fi
if [ "$EUID" = 0 ]; then
  echo "Run this as yourself, not as root: it looks at your own services and folders, and needs no root. Nothing was changed." >&2
  exit 2
fi

CONSOLE="Spark Console's" BRAIN="the brain's" OTHER="something else"
EDITOR_PORT=8801 TUNNEL_PORTS='8802 8803 8804'
UNSEEN='' STOP_LATER='' DELETE_LATER='' C_PORTS='' EDITOR_OPEN=''
unseen() { UNSEEN="$UNSEEN  - $1"$'\n'; }
row() { printf '  %-16s %-36s %s\n' "$1" "$2" "$3"; }
first() { local s="${1%%$'\n'*}"; printf '%s' "${s:0:160}"; }
# split <line> [separator]: its fields in W (spaces and tabs by default)
split() { if [ $# -gt 1 ]; then local IFS="$2"; else local IFS=$' \t'; fi; W=($1); }
human() {
  local k=$1 u=MB d=1024
  if [ "$k" -ge 1073741824 ]; then u=TB d=1073741824; elif [ "$k" -ge 1048576 ]; then u=GB d=1048576; elif [ "$k" -lt 1024 ]; then printf '%s KB' "$k"; return; fi
  local t=$(( k * 10 / d )); printf '%s.%s %s' $(( t / 10 )) $(( t % 10 )) "$u"
}
# exec_of <unit name>: the first ExecStart= line of your own unit file, read as text (nothing if there is none)
exec_of() {
  local f line n="$1" t="${1%%@*}@.${1##*.}"
  for f in "$HOME/.config/systemd/user/$n" "$HOME/.local/share/systemd/user/$n" "$HOME/.config/systemd/user/$t"; do
    [ -f "$f" ] && [ -r "$f" ] || continue
    while IFS= read -r line || [ -n "$line" ]; do case "$line" in ExecStart=*) printf '%s' "${line#ExecStart=}"; return 0 ;; esac; done < "$f"
    return 0
  done
  return 0
}

echo "A look at Spark 2 (this is ${HOSTNAME:-this machine}, seen as ${USER:-you}). Nothing is changed."
echo "Each unit, container, port and folder is marked $CONSOLE, $BRAIN or $OTHER;"
echo "Spark 2 is meant to run only Spark Console and the brain."

# ── Units ──
U_LIST='' U_FILES='' S_LIST='' U_OK=yes
if ! U_LIST=$(systemctl --user list-units --all --type=service,timer --no-legend --no-pager --plain 2>&1); then
  unseen "Your units' states: systemd for your user didn't answer ($(first "$U_LIST"))."; U_LIST='' U_OK=no
fi
U_FILES=$(systemctl --user list-unit-files --type=service,timer --no-legend --no-pager 2>/dev/null) || U_FILES=''
# unit_word <list> <name> <field>: that field of the unit's line in a systemctl list (nothing if it isn't there)
unit_word() {
  local line
  while IFS= read -r line; do split "$line"; if [ "${W[0]:-}" = "$2" ]; then printf '%s' "${W[$3]:-}"; return 0; fi; done < <(printf '%s\n' "$1")
  return 0
}
# classify_unit <name> <ExecStart>: K (the kind), N (a note), P (what the later step does: stop, delete or nothing)
classify_unit() {
  K=$OTHER N='' P=''
  local p
  case "$1" in
    spark-console-api.service) K=$CONSOLE N='the service' ;;
    spark-console-watchdog.*) K=$CONSOLE N='its watchdog' ;;
    spark-console-*) K=$CONSOLE ;;
    spark-portal.service) N='the old portal (switched off since 2026-11-04)' P=delete ;;
    spark-portal-editor.service) N="code-server, the browser editor (port $EDITOR_PORT)" P=stop ;;
    *)
      for p in $TUNNEL_PORTS; do case "$2" in *ssh*"$p"*) N="an editor tunnel (port $p)" P=stop; return 0 ;; esac; done
      case "${2%% *}" in */code-server) N='code-server, the browser editor' P=stop ;; esac
      case "$1" in spark-portal*tunnel*) [ -n "$P" ] || { N='an editor tunnel' P=stop; } ;; esac ;;
  esac
  return 0
}
NAMES=''
add_name() { case " $NAMES " in *" $1 "*) ;; *) NAMES="$NAMES $1" ;; esac; }
set +f
for f in "$HOME"/.config/systemd/user/*.service "$HOME"/.config/systemd/user/*.timer \
         "$HOME"/.local/share/systemd/user/*.service "$HOME"/.local/share/systemd/user/*.timer; do
  [ -f "$f" ] && add_name "${f##*/}"
done
set -f
while IFS= read -r line; do
  split "$line"
  case "${W[0]:-}" in *.service|*.timer) [ "${W[2]:-inactive}" = inactive ] || add_name "${W[0]}" ;; esac
done < <(printf '%s\n' "$U_LIST")
echo
echo "Units: yours (systemd, user)"
[ -n "$NAMES" ] || echo "  (none found)"
for n in $(printf '%s\n' $NAMES | sort); do
  state=$(unit_word "$U_LIST" "$n" 3); case "$state" in dead|'') state=stopped ;; esac; [ "$U_OK" = yes ] || state=unknown
  enabled=$(unit_word "$U_FILES" "$n" 1)
  classify_unit "$n" "$(exec_of "$n")"
  case "$P" in stop) later='; stopped later' ; STOP_LATER="$STOP_LATER$n|$state|$N"$'\n' ;;
               delete) later='; deleted later'; DELETE_LATER="$DELETE_LATER$n|the old portal's unit"$'\n' ;; *) later='' ;; esac
  row "$K" "$n" "$state${enabled:+, $enabled}${N:+: $N}$later"
done
echo
echo "Units: the system's running services (the operating system's own; the clearing step never touches them)"
if ! S_LIST=$(systemctl list-units --type=service --state=running --no-legend --no-pager --plain 2>&1); then
  unseen "The system's services: systemd didn't answer ($(first "$S_LIST"))."; S_LIST=''
fi
while IFS= read -r line; do
  split "$line"; n="${W[0]:-}"
  case "$n" in *.service) ;; *) continue ;; esac
  case "$n" in
    docker.service|containerd.service) N="the containers run in it, the brain's among them" ;;
    tailscaled.service) N="Tailscale: Spark Console's address and the public Funnel" ;;
    ssh.service|sshd.service) N='SSH' ;;
    *) N='' ;;
  esac
  row "$OTHER" "$n" "running${N:+: $N}"
done < <(printf '%s\n' "$S_LIST")

# ── Containers ──
echo
echo "Containers"
DK=''
if ! DK=$(docker ps -a --no-trunc --format '{{.Names}}|{{.State}}|{{.Image}}|{{.Ports}}|{{.Label "spark.role"}}|{{.Label "spark.console"}}|{{.Label "spark.app"}}|{{.Label "spark.protect"}}' 2>&1); then
  unseen "Containers: Docker didn't answer ($(first "$DK"))."; DK=''
fi
# classify_container <name> <spark.role> <spark.console> <spark.app> <spark.protect>: K, N, and a one-letter kind in C
classify_container() {
  K=$OTHER N='' C=o
  if [ "$2" = main ] || [ "$1" = sparkie-main ]; then K=$BRAIN C=b N="the brain's model server, never touched"; return 0; fi
  case "$1" in
    qwen-recipe-*) K=$BRAIN C=b N='a Qwen recipe: protected, never touched' ;;
    spark-console-plugs) K=$CONSOLE C=c N='the plug controller' ;;
    spark-console-door) K=$CONSOLE C=c N='the retired short address (the installer says how to remove it)' ;;
    spark-console-*) K=$CONSOLE C=c ;;
    *) if [ -n "$4" ]; then K=$CONSOLE C=c N='an app or job it keeps'
       elif [ -n "$3" ]; then K=$CONSOLE C=c N='a model it started'
       elif [ "$5" = true ]; then N='protected, never touched'; fi ;;
  esac
  return 0
}
found=0
while IFS= read -r line; do
  split "$line" '|'
  [ "${#W[@]}" -ge 3 ] || continue
  found=1
  classify_container "${W[0]}" "${W[4]:-}" "${W[5]:-}" "${W[6]:-}" "${W[7]:-}"
  row "$K" "${W[0]}" "${W[1]}${N:+; $N}; ${W[2]}"
  # the host ports it publishes ("127.0.0.1:30100->8000/tcp, [::]:3000->8080/tcp"), for the ports below
  ports="${W[3]:-}"
  while [ -n "$ports" ]; do
    p="${ports%%, *}"; [ "$p" = "$ports" ] && ports='' || ports="${ports#*, }"
    case "$p" in *'->'*) p="${p%%->*}"; C_PORTS="$C_PORTS ${p##*:}:$C:${W[0]}" ;; esac
  done
done < <(printf '%s\n' "$DK")
[ "$found" = 1 ] || echo "  (none found)"

# ── Ports ──
echo
echo "Ports (listening, TCP)"
SS=''
if ! SS=$(ss -Htlnp 2>&1); then unseen "Ports: ss didn't answer ($(first "$SS"))."; SS=''; fi
ENTRIES=''
while IFS= read -r line; do
  split "$line"
  [ "${W[0]:-}" = LISTEN ] || continue
  local_addr="${W[3]:-}" proc="${W[5]:-}" prog=''
  case "$proc" in *'"'*) prog="${proc#*\"}"; prog="${prog%%\"*}" ;; esac
  ENTRIES="$ENTRIES${local_addr##*:}|${local_addr%:*}|$prog"$'\n'
done < <(printf '%s\n' "$SS")
# classify_port <port>: K and N, from the container that publishes it, else from the port's number
classify_port() {
  K=$OTHER N=''
  local e
  for e in $C_PORTS; do
    case "$e" in "$1":*)
      e="${e#*:}"; N="published by the container ${e#*:}"
      case "$e" in c:*) K=$CONSOLE ;; b:*) K=$BRAIN N="$N, never touched" ;; esac
      return 0 ;;
    esac
  done
  case "$1" in
    8810) K=$CONSOLE N='its local health port' ;;
    5580) K=$CONSOLE N='the plug controller' ;;
    8443) K=$CONSOLE N='its address (Tailscale serves it), never touched' ;;
    10000) K=$CONSOLE N='the app door (Tailscale serves it), never touched' ;;
    30100) K=$BRAIN N="the brain's model server, never touched" ;;
    443) N='the public Funnel (Tailscale), never touched' ;;
    "$EDITOR_PORT") N='code-server, the browser editor; stopped later' ;;
    8802|8803|8804) N='an editor tunnel; stopped later' ;;
    8800) N="the old portal's port" ;;
    22) N='SSH, never touched' ;;
  esac
  return 0
}
show_port() {   # show_port <port> <addresses> <programs>
  classify_port "$1"
  case " $EDITOR_PORT $TUNNEL_PORTS " in *" $1 "*) EDITOR_OPEN="$EDITOR_OPEN${EDITOR_OPEN:+, }$1" ;; esac
  [ -n "$3" ] || HIDDEN=$((HIDDEN + 1))
  printf '  %-16s %-7s %-28s %-12s %s\n' "$K" "$1" "$2" "${3:--}" "$N"
}
HIDDEN=0 TOTAL=0 cur='' addrs='' progs=''
while IFS='|' read -r port addr prog; do
  [ -n "$port" ] || continue
  if [ "$port" != "$cur" ]; then
    [ -z "$cur" ] || show_port "$cur" "$addrs" "$progs"
    cur="$port" addrs="$addr" progs="$prog" TOTAL=$((TOTAL + 1))
  else
    addrs="$addrs, $addr"
    [ -z "$prog" ] || case ",$progs," in *",$prog,"*) ;; *) progs="$progs${progs:+,}$prog" ;; esac
  fi
done < <(printf '%s' "$ENTRIES" | sort -t '|' -k1,1n -k2,2)
[ -z "$cur" ] || show_port "$cur" "$addrs" "$progs"
[ "$TOTAL" -gt 0 ] || echo "  (none found)"
[ "$HIDDEN" = 0 ] || unseen "Which program holds $HIDDEN of the $TOTAL ports (marked - above): that needs root. A port a container publishes is named by Docker instead."

# ── Folders ──
echo
echo "Folders (in your home)"
# path|kind (c, b or o)|note|what the later step does
KNOWN="spark-console|c|the page
spark-console-service|c|the service
spark-console-src|c|its source, for installs from Spark 2
.local/state/spark-console|c|its state: chats, people, memory
.local/share/spark-console|c|snapshots, the way back, the watchdog
.config/spark-console|c|its keys and the plug pairings
.cache/spark-console|c|installs on their way in, and the brain's kernel cache
.local/share/spark-portal|c|the shared folder and job outputs (the portal's old name), never touched
.local/state/spark-portal|c|the worker's files (the portal's old name), never touched
workspaces|c|people's files, never touched
.local/share/spark-console-www|c|the retired short address (the installer says how to remove it)
.config/spark-console-door|c|the retired short address
.local/state/spark-console-door|c|the retired short address
.cache/huggingface|b|model weights, the brain's among them, never touched
models|b|model files, never touched
spark-portal|o|the old portal's code; deleted later|delete
.config/spark-portal|o|the old portal's settings, kept as a small backup"
PARTIAL=''
show_folder() {   # show_folder <path under home> <c|b|o> <note>
  local out rc kb size kind
  case "$2" in c) kind=$CONSOLE ;; b) kind=$BRAIN ;; *) kind=$OTHER ;; esac
  out=$(du -sk "$HOME/$1" 2>/dev/null); rc=$?; kb="${out%%[!0-9]*}"
  if [ -z "$kb" ]; then size='size unknown'; PARTIAL="$PARTIAL${PARTIAL:+, }~/$1"
  elif [ "$rc" = 0 ]; then size=$(human "$kb")
  else size="at least $(human "$kb")"; PARTIAL="$PARTIAL${PARTIAL:+, }~/$1"; fi
  row "$kind" "~/$1" "$size${3:+: $3}"
}
NODE='' known_names='|'
while IFS='|' read -r path kind note plan; do
  known_names="$known_names$path|"
  [ -e "$HOME/$path" ] || continue
  show_folder "$path" "$kind" "$note"
  [ "$plan" != delete ] || DELETE_LATER="$DELETE_LATER~/$path|the old portal's code"$'\n'
done < <(printf '%s\n' "$KNOWN")
# Spark Console's Node, and the kept snapshots that start it with code-server's (critic-safety finding 28)
exec_line=$(exec_of spark-console-api.service); NODE="${exec_line%% *}"
SNAPS=0 SNAPS_CS=0
set +f
for d in "$HOME"/.local/opt/*; do
  [ -e "$d" ] || continue
  case "${d##*/}" in
    code-server-*) show_folder ".local/opt/${d##*/}" o 'code-server, the browser editor; deleted later'
                   DELETE_LATER="$DELETE_LATER~/.local/opt/${d##*/}|code-server|cs"$'\n' ;;
    *) show_folder ".local/opt/${d##*/}" o '' ;;
  esac
done
for d in "$HOME"/*/; do
  d="${d%/}"; [ -d "$d" ] || continue
  case "$known_names" in *"|${d##*/}|"*) continue ;; esac
  show_folder "${d##*/}" o ''
done
for f in "$HOME"/.local/share/spark-console/releases/*/spark-console-api.service; do
  [ -f "$f" ] || continue
  SNAPS=$((SNAPS + 1))
  while IFS= read -r line || [ -n "$line" ]; do case "$line" in ExecStart=*code-server*) SNAPS_CS=$((SNAPS_CS + 1)); break ;; esac; done < "$f"
done
set -f
[ -z "$PARTIAL" ] || unseen "Part of $PARTIAL could not be read (files only root or another user can open), so the size shown is the least it is."

# ── Memory ──
echo
echo "Memory: the programs using the most"
PS_OUT=''
if PS_OUT=$(ps -eo rss=,user=,comm= --sort=-rss 2>/dev/null) && [ -n "$PS_OUT" ]; then
  i=0
  while IFS= read -r line; do
    split "$line"; w="${W[0]:-}"
    [ "$i" -lt 8 ] && [ -n "$w" ] && [ "$w" = "${w//[!0-9]/}" ] || continue
    printf '  %10s  %-12s %s\n' "$(human "${W[0]}")" "${W[1]:-}" "${W[*]:2}"; i=$((i + 1))
  done < <(printf '%s\n' "$PS_OUT")
else
  unseen "Memory: ps didn't answer."
fi

# ── Tailscale ──
echo
echo "Tailscale's routes on this Spark (read only; the clearing step never changes them)"
TS=''
if TS=$(tailscale serve status 2>&1); then
  while IFS= read -r line; do printf '  %s\n' "$line"; done < <(printf '%s\n' "$TS")
else
  unseen "Tailscale's routes: Tailscale didn't answer ($(first "$TS"))."
fi

# ── What the later step would change, and what it never touches ──
echo
echo "What the later clearing step would change (it is not built yet; each part waits for your yes):"
case "$NODE" in
  *code-server*) node_is="code-server's own Node, so code-server stays until this is done" ;;
  '') node_is='not known: no unit file for spark-console-api.service was found' NODE='?' ;;
  *) node_is='a Node of its own already' ;;
esac
echo "  1. Spark Console gets a Node of its own on Spark 2, is installed again, and Spark 2 restarts once to prove it."
echo "     Today it starts with $NODE: $node_is."
echo "  2. A build without the browser editor is installed."
echo "  3. These are stopped and switched off, not deleted (each comes back with one command):"
if [ -n "$STOP_LATER" ]; then
  while IFS='|' read -r n state note; do [ -z "$n" ] || printf '       %-36s %-9s %s\n' "$n" "$state" "$note"; done < <(printf '%s' "$STOP_LATER")
else
  echo "       (none found)"
fi
[ -z "$EDITOR_OPEN" ] || echo "     Their ports open now: $EDITOR_OPEN."
echo "  4. A week later, these are deleted, each moved aside first, by exact path only:"
if [ -n "$DELETE_LATER" ]; then
  while IFS='|' read -r n note cs; do
    [ -n "$n" ] || continue
    [ -z "$cs" ] || note="$note: only once neither the service nor a kept snapshot starts Spark Console with its Node (today $SNAPS_CS of the $SNAPS kept snapshots do)"
    printf '       %-36s %s\n' "$n" "$note"
  done < <(printf '%s' "$DELETE_LATER")
else
  echo "       (none found)"
fi
echo "  Everything else marked \"$OTHER\" stays as it is: the clearing step changes only what is named here."
echo
echo "What it never touches, now or later:"
echo "  - the brain's model server and its container, every qwen-recipe-* container, and the Docker service they run in"
echo "  - Tailscale: its routes, the public Funnel on port 443, and the tailscaled service"
echo "  - the firewall, users and SSH"
echo "  - Spark Console's folders, and those it uses under the portal's old name: ~/.local/share/spark-portal,"
echo "    ~/.local/state/spark-portal and ~/workspaces"
echo "  - ~/.config/spark-portal, kept as a small backup"
echo
if [ -n "$UNSEEN" ]; then
  echo "What this look could not see:"
  printf '%s' "$UNSEEN"
else
  echo "This look saw everything it looks at."
fi
echo
echo "Nothing was changed."
