#!/usr/bin/env bash
# Smart plugs (contract 9.22): a Matter controller on the hub that switches and reads the Tapo P110M plugs on the compute
# Sparks, and only reads the hub's own, entirely on the home network. Run it from your Mac; the hub's password is asked
# once per run. Which Spark is the hub, and each Spark's number, come from deploy/hub.env.
#
#   bash spark-console/deploy/plugs.sh              install or update the plug controller on the hub
#   bash spark-console/deploy/plugs.sh pair <n>     pair Spark <n>'s plug (asks for a Matter code from the Tapo app;
#                                                   installs the controller first if it isn't there yet); the hub's own
#                                                   plug is paired read-only: its readings, never its switch (below)
#   bash spark-console/deploy/plugs.sh name <from> <to>  reassign an existing Spark's plug by Spark numbers
#   bash spark-console/deploy/plugs.sh name <n> --label '<name>'  assign an unassigned plug by its unique Tapo name
#                                                   the hub's is first made read-only and proven, as pair does
#   bash spark-console/deploy/plugs.sh status       every paired plug: its Spark, on or off, watts
#   bash spark-console/deploy/plugs.sh check        why a plug can't be found (the hub's network side; changes nothing)
#   bash spark-console/deploy/plugs.sh remove       stop and remove the controller (its pairings stay in its folder)
#
# A code for `pair`: in the Tapo app, open the plug, then its settings, then Matter Setup Code. Each code works for 15
# minutes. It's read without being shown and reaches the hub over SSH's input, never on a command line.
#
# What runs: matterjs-server (the Open Home Foundation's Matter controller; it replaced python-matter-server in 2026),
# pinned by digest, as container spark-console-plugs on the hub: host networking (Matter finds the plugs by mDNS), its
# WebSocket API on 127.0.0.1:5580 only, no capabilities, as your own user, and no firmware updates (an update restarts
# the plug, which would cut its Spark's power). Its pairing keys stay in ~/.config/spark-console/matter, not in the
# state folder (that one is copied to another Spark every day). Which plug is on which Spark:
# ~/.local/state/spark-console/plugs.json.
#
# The hub's own plug: nothing on the hub may be able to cut its own power. `pair <the hub's number>` pairs it, then at
# once lowers the controller's own rights on that plug to View (Matter's access list, kept by the plug itself), then
# proves it: an "on" command (harmless, the plug is on) must come back refused. If that can't be shown, the plug is
# unpaired again straight away. `name <from Spark> <the hub's number>` does the same to a plug paired with full rights (a
# Spark that has become the hub). Read-only, the controller can't switch it, change its rights back or open it to anyone
# else; only the Tapo app (its first admin) can, which is where you restart the hub from your phone if it ever freezes.
# Its MAC is kept, so that plug can never be paired with full rights as another Spark's. Every action runs only on the
# hub: on a Spark whose installed Spark Console isn't the hub's it stops, with nothing changed.
set -euo pipefail
. "$(dirname "$0")/hub.sh"
HOST="$HUB_HOST"
IMAGE='ghcr.io/matter-js/matterjs-server:1.5.5@sha256:ee149c7c67eff0e90f131e8f0d628f7b099591ec58473c8cda1209e8ae4df66e'

# spark_n <word>: the Spark a number (or id) names, when hub.env has it. The hub's is read-only, proven before it's kept.
spark_n() { case "$1" in [1-9]|[1-9][0-9]|spark[1-9]|spark[1-9][0-9]) [[ " $SPARKS " != *" spark${1#spark} "* ]] || echo "spark${1#spark}" ;; esac; }
ACTION="${1:-install}" SPARK='' SELECTOR=''
case "$ACTION" in
  install|status|check|remove) ;;
  pair)
    SPARK=$(spark_n "${2:-}")
    [ -n "$SPARK" ] || { echo "Say which Spark the plug is on, by its number: pair <n> (deploy/hub.env: $SPARKS)." >&2; exit 2; } ;;
  name)
    if [ "$#" = 4 ] && [ "$3" = --label ] && [ -n "$4" ]; then
      SPARK=$(spark_n "${2:-}")
      SELECTOR="label:$4"
    elif [ "$#" = 3 ]; then
      FROM=$(spark_n "${2:-}")
      [ -n "$FROM" ] || { echo "Say the existing Spark, then the new Spark: name <from> <to>." >&2; exit 2; }
      SPARK=$(spark_n "${3:-}")
      SELECTOR="spark:$FROM"
    else
      echo "Use Spark numbers: name <from> <to>; for an unassigned plug: name <n> --label '<name from status>'." >&2; exit 2
    fi
    [ -n "$SPARK" ] || { echo "Say which Spark it's on (deploy/hub.env: $SPARKS)." >&2; exit 2; } ;;
  *) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2 ;;
esac

if [ "$ACTION" = pair ]; then
  read -rs -p "Matter setup code for ${SPARK/spark/Spark }'s plug, from the Tapo app (it isn't shown): " CODE; echo
  [[ "$CODE" == MT:* ]] || CODE="$(printf '%s' "$CODE" | tr -d ' -')"
  [[ "$CODE" =~ ^([0-9]{11}|[0-9]{21}|MT:[0-9A-Z.-]+)$ ]] || { echo "That isn't a Matter code: it's 11 digits, like 1234-567-8901." >&2; exit 2; }
fi

read -r -d '' REMOTE <<'REMOTE_EOF' || true
set -euo pipefail
# Its Python reads nothing from the home it runs in (no ~/json.py in place of the real one, no user site): -I, as the
# console's own commands do (R53).
python3() { command python3 -I "$@"; }
C=spark-console-plugs
DATA="$HOME/.config/spark-console/matter"
MAP="$HOME/.local/state/spark-console/plugs.json"
ACTION="$1" SPARK="${2:-}" SELECTOR="${3:-}" NODE=''
SETUP=2   # bump when the docker run below changes, so `pair` brings an older controller up to date by itself

# Talks to the controller from inside its own container (Node has WebSocket built in): ping; nodes; commission (the
# code on standard input); or any other command with its arguments as JSON. A refusal prints its details as JSON
# (error_code, details, and the device's status when it answered) and exits 1.
read -r -d '' HELPER <<'JS' || true
const [cmd, argsJson] = process.argv.slice(1);
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', () => {
  const ws = new WebSocket('ws://127.0.0.1:5580/ws');
  const limit = setTimeout(() => { console.error('The plug controller took too long to answer.'); process.exit(2); }, cmd === 'commission' ? 300000 : 60000);
  let ready = false;
  ws.onerror = () => { console.error('The plug controller isn\'t answering on 127.0.0.1:5580.'); process.exit(2); };
  ws.onmessage = ev => {
    const m = JSON.parse(String(ev.data));
    if (!ready) {
      ready = true; // the first message is always the server's own info
      if (cmd === 'ping') { clearTimeout(limit); console.log('{"ok":true}'); process.exit(0); }
      ws.send(JSON.stringify(cmd === 'commission' ? { message_id: 'q', command: 'commission_with_code', args: { code: input.trim(), network_only: true } }
        : cmd === 'nodes' ? { message_id: 'q', command: 'get_nodes', args: {} }
        : { message_id: 'q', command: cmd, args: JSON.parse(argsJson || '{}') }));
      return;
    }
    if (m.message_id !== 'q') return;
    clearTimeout(limit);
    if (m.error_code !== undefined && m.error_code !== null) {
      console.error(`The controller said: ${m.details || 'error ' + m.error_code}`);
      console.log(JSON.stringify({ refused: true, error_code: m.error_code, details: m.details ?? null, status: m.status ?? null, cluster_status: m.cluster_status ?? null }));
      process.exit(1);
    }
    console.log(JSON.stringify(m.result ?? null));
    process.exit(0);
  };
});
JS

# Every paired plug, one line each, matched to its Spark through plugs.json.
read -r -d '' SHOW <<'PY' || true
import base64, json, re, sys
nodes = json.load(sys.stdin) or []
hub = sys.argv[2] if len(sys.argv) > 2 else ''
try:
    plugs = json.load(open(sys.argv[1]))
except Exception:
    plugs = {}
spark_of = {v.get('node'): k for k, v in plugs.items() if isinstance(v, dict)}
if not nodes:
    print('No plugs are paired yet.')
def order(n):
    spark = spark_of.get(n.get('node_id'), '')
    return (0, int(spark[5:])) if re.fullmatch(r'spark[1-9][0-9]*', spark) else (1, str((n.get('attributes') or {}).get('0/40/5', '')))
for n in sorted(nodes, key=order):
    a = n.get('attributes') or {}
    def first(pattern):
        for k, v in a.items():
            if re.fullmatch(pattern, k):
                return v
        return None
    on, mw = first(r'\d+/6/0'), first(r'\d+/144/8')
    spark = spark_of.get(n.get('node_id'))
    who = (spark.replace('spark', 'Spark ') + (' (read-only)' if plugs[spark].get('readOnly') else
           f" (the hub's, NOT read-only yet: plugs.sh name {spark[5:]} {spark[5:]})" if spark == hub else '')) if spark else 'Unassigned plug'
    state = 'on' if on is True else 'off' if on is False else 'on/off unknown'
    try:
        power = f'{float(mw) / 1000:.0f} W'
    except (TypeError, ValueError):
        power = 'no power reading yet (update the plug in the Tapo app)'
    gone = '' if n.get('available') else ', not answering right now'
    mac = ''
    for nic in first(r'0/51/0') or []:
        raw = nic.get('4') or nic.get('hardwareAddress') if isinstance(nic, dict) else None
        try:
            mac = '-'.join(f'{b:02X}' for b in base64.b64decode(raw)) if isinstance(raw, str) else ''
        except Exception:
            mac = ''
        if mac:
            break
    label = a.get('0/40/5')
    named = f', name {json.dumps(label, ensure_ascii=False)}' if isinstance(label, str) and label else ', no name (set a unique name in the Tapo app)'
    print(f"{who}: {state}, {power}{gone}{named}" + (f"  (MAC {mac})" if mac else ''))
PY

# Resolve the owner's Spark number, or one unique unassigned plug name. Controller ids stay inside this script.
read -r -d '' SELECT <<'PY' || true
import json, sys
path, selector, target = sys.argv[1:]
nodes = json.load(sys.stdin) or []
try:
    plugs = json.load(open(path))
except FileNotFoundError:
    plugs = {}
def stop(words):
    print(words, file=sys.stderr)
    sys.exit(2)
if selector.startswith('spark:'):
    source = selector[6:]
    node = (plugs.get(source) or {}).get('node')
    if node is None:
        stop(f"{source.replace('spark', 'Spark ')} has no assigned plug. Use status; for an unassigned plug, use name <Spark> --label '<name>'.")
    found = [n for n in nodes if n.get('node_id') == node]
else:
    label = selector[6:]
    found = [n for n in nodes if (n.get('attributes') or {}).get('0/40/5') == label]
    if len(found) != 1:
        stop('That plug name does not match exactly one paired plug. Use status, and give unassigned plugs unique names in the Tapo app.')
    node = found[0].get('node_id')
    assigned = next((k for k, v in plugs.items() if isinstance(v, dict) and v.get('node') == node), None)
    if assigned:
        stop(f"That plug is already assigned to {assigned.replace('spark', 'Spark ')}. Use name <from Spark> <to Spark>.")
if len(found) != 1 or not isinstance(node, int) or isinstance(node, bool):
    stop('That Spark’s assigned plug is not in the controller’s list. Use status; nothing was reassigned.')
occupied = plugs.get(target)
if isinstance(occupied, dict) and occupied.get('node') != node:
    stop(f"{target.replace('spark', 'Spark ')} already has another plug assigned; nothing was reassigned.")
print(node)
PY

# One node (get_node) in, one answer out: its MAC (mac), the On/Off endpoint (onoff), or the subjects of this
# controller's own Administer entry in the plug's access list (admins; the list read when it was paired).
read -r -d '' NODEINFO <<'PY' || true
import base64, json, re, sys
want, n = sys.argv[1], json.load(sys.stdin) or {}
a = n.get('attributes') or {}
def field(e, *keys):
    for k in keys:
        if isinstance(e, dict) and k in e:
            return e[k]
    return None
if want == 'mac':
    for nic in a.get('0/51/0') or []:
        raw = field(nic, '4', 'hardwareAddress')
        if isinstance(raw, str):
            print('-'.join(f'{b:02X}' for b in base64.b64decode(raw)))
            sys.exit(0)
    sys.exit(1)
if want == 'onoff':
    eps = sorted(int(k.split('/')[0]) for k in a if re.fullmatch(r'\d+/6/0', k))
    if not eps:
        sys.exit(1)
    print(eps[0])
    sys.exit(0)
if want == 'admins':
    mine, subjects = a.get('0/62/5'), []
    for e in a.get('0/31/0') or []:
        index = field(e, '254', 'fabricIndex', 'fabric_index')
        if mine is not None and index is not None and index != mine:
            continue
        if field(e, '1', 'privilege') == 5 and field(e, '2', 'authMode', 'auth_mode') == 2:
            subjects += [s for s in field(e, '3', 'subjects') or [] if s not in subjects]
    if not subjects:
        sys.exit(1)
    print(json.dumps(subjects))  # exactly as the controller wrote them (a big node id stays exact)
    sys.exit(0)
sys.exit(2)
PY

# Asks the home network who offers Matter (mDNS, IPv4 and IPv6, as a one-off query that gets unicast answers) and
# prints what came back within 5 seconds.
read -r -d '' MDNS <<'PY' || true
import select, socket, struct, sys, time
iface, ip4 = sys.argv[1], sys.argv[2]
def query(name):
    q = b''.join(bytes([len(p)]) + p.encode() for p in name.split('.')) + b'\0'
    return struct.pack('>6H', 0, 0, 1, 0, 0, 0) + q + struct.pack('>HH', 12, 1)
socks = []
try:
    s4 = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s4.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_IF, socket.inet_aton(ip4))
    s4.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 255)
    socks.append((s4, ('224.0.0.251', 5353)))
except OSError:
    pass
try:
    idx = socket.if_nametoindex(iface)
    s6 = socket.socket(socket.AF_INET6, socket.SOCK_DGRAM)
    s6.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_MULTICAST_IF, idx)
    socks.append((s6, ('ff02::fb', 5353, 0, idx)))
except OSError:
    pass
for s, dest in socks:
    s.setblocking(False)
    for name in ('_matterc._udp.local', '_matter._tcp.local'):
        try:
            s.sendto(query(name), dest)
        except OSError:
            pass
ready, paired = set(), set()
end = time.time() + 5
while time.time() < end and socks:
    for s in select.select([s for s, _ in socks], [], [], 0.5)[0]:
        try:
            data, src = s.recvfrom(9000)
        except OSError:
            continue
        if b'\x08_matterc\x04_udp' in data:
            ready.add(src[0].split('%')[0])
        if b'\x07_matter\x04_tcp' in data:
            paired.add(src[0].split('%')[0])
print('  Matter devices ready to pair, heard by the hub:', ', '.join(sorted(ready)) or 'none')
print('  Matter devices already paired with an app, heard by the hub:', ', '.join(sorted(paired)) or 'none')
PY

ask() { docker exec -i "$C" node -e "$HELPER" "$@"; }
running() { [ "$(docker inspect -f '{{.State.Running}}' "$C" 2>/dev/null)" = true ]; }
need_running() { running || { echo "The plug controller isn't running on $HUB_SAYS. Install it first: bash spark-console/deploy/plugs.sh" >&2; exit 1; }; }
# This Spark has to be the hub: the Spark Console installed here runs as $HUB (its config.json's Spark with host "local").
hub_here() {
  local here said="no Spark (Spark Console isn't installed here)"
  here=$(python3 -c 'import json, sys
n = [x.get("id") for x in json.load(open(sys.argv[1])).get("nodes") or [] if isinstance(x, dict) and x.get("host") == "local"]
print(n[0] if len(n) == 1 else "")' "$HOME/spark-console-service/config.json" 2>/dev/null || true)
  [ "$here" != "$HUB" ] || return 0
  [ -z "$here" ] || said="Spark ${here#spark}"
  echo "Stopped: the plug controller runs only on the hub, $HUB_SAYS, and Spark Console here runs as $said. Nothing was changed." >&2
  exit 2
}

# Why a plug can't be found, from the hub's side. Changes nothing.
check_net() {
  local IFACE ADDR IP base plugs
  IFACE="$(ip -4 route show default 2>/dev/null | awk '{print $5; exit}')"
  ADDR="$(ip -4 -o addr show dev "$IFACE" 2>/dev/null | awk '{print $4; exit}')"
  IP="${ADDR%/*}" base="${IP%.*}"
  echo "$HUB_SAYS is on the home network as $ADDR ($IFACE)."
  ip -6 -o addr show dev "$IFACE" scope link 2>/dev/null | grep -q inet6 || echo "  It has no IPv6 link-local address there, and Matter needs IPv6."
  grep -qs '^ENABLED=yes' /etc/ufw/ufw.conf && echo "  $HUB_SAYS's firewall (ufw) is on, and it can block the plugs' answers."
  # The plugs by their MAC (TP-Link's 58:d8:12:c2:…): one ping to every address next to the hub's, then who answered.
  for i in $(seq 1 254); do ping -c1 -W1 "$base.$i" >/dev/null 2>&1 & done
  wait
  plugs="$(ip neigh show dev "$IFACE" 2>/dev/null | grep -i ' 58:d8:12:c2:' | awk '{print $1 "  " $3}' || true)"
  if [ -n "$plugs" ]; then
    echo "  Tapo plugs on $HUB_SAYS's network (address, MAC):"; printf '%s\n' "$plugs" | sed 's/^/    /'
  else
    echo "  No Tapo plug answered anywhere on $base.0/24: they're probably on a different Wi-Fi or network than $HUB_SAYS."
  fi
  python3 -c "$MDNS" "$IFACE" "$IP" || true
  echo "  $HUB_SAYS's own IPv6 addresses on $IFACE:"
  ip -6 -o addr show dev "$IFACE" 2>/dev/null | awk '{print "    " $4 "  (" $6 ")"}'
  ip -6 route show default 2>/dev/null | head -2 | sed 's/^/    IPv6 default route: /'
  if running; then
    echo "  What the controller tried in the last 15 minutes (addresses and pairing steps):"
    docker logs --since 15m "$C" 2>&1 | grep -iE 'pase|pbkdf|spake|discover|commission|udp://|tcp://|address|\[[0-9a-f:]+\]|[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+:5540|could not|timeout|timed out|refused|unreachable|retransmi|status ?report|error' |
      grep -vE '^\s+at ' | tail -40 | cut -c1-240 | sed 's/^/    /'
  fi
}

install_it() {
    mkdir -p "$DATA" "$(dirname "$MAP")"
    chmod 700 "$HOME/.config/spark-console" "$DATA"
    IFACE="$(ip -4 route show default 2>/dev/null | awk '{print $5; exit}')"
    [ -n "$IFACE" ] || { echo "$HUB_SAYS has no default route, so it can't see the plugs on the home network." >&2; exit 1; }
    echo "$HUB_SAYS reaches the home network on $IFACE."
    ip -6 addr show dev "$IFACE" scope link 2>/dev/null | grep -q inet6 ||
      echo "Note: $IFACE has no IPv6 link-local address, and Matter needs IPv6 on the home network. Pairing may fail until it's on."
    echo "Getting the controller image …"
    docker pull -q "$IMAGE" >/dev/null
    docker rm -f "$C" >/dev/null 2>&1 || true
    # Detailed log (which address each pairing step used and what came back), kept to 3 files of 10 MB.
    docker run -d --name "$C" --restart unless-stopped --network host \
      --user "$(id -u):$(id -g)" --cap-drop ALL --security-opt no-new-privileges --memory 1g \
      --log-opt max-size=10m --log-opt max-file=3 \
      --label spark.protect=true --label "spark.plugs.setup=$SETUP" \
      -v "$DATA:/data" \
      -e STORAGE_PATH=/data -e LISTEN_ADDRESS=127.0.0.1 -e PORT=5580 -e PRIMARY_INTERFACE="$IFACE" -e DISABLE_OTA=true \
      -e LOG_LEVEL=debug \
      "$IMAGE" >/dev/null
    for _ in $(seq 1 30); do
      if ask ping </dev/null >/dev/null 2>&1; then echo "The plug controller is up on $HUB_SAYS (127.0.0.1:5580)."; return 0; fi
      sleep 2
    done
    echo "The controller didn't answer within a minute. Its last log lines:" >&2
    docker logs --tail 30 "$C" >&2
    exit 1
}

# Records which Spark a plug (a controller node) is on: one Spark per plug. Optional: read-only (the hub's), its MAC.
map_node() {
  python3 - "$MAP" "$1" "$2" "${3:-}" "${4:-}" <<'PY'
import json, os, sys
path, spark, node, read_only, mac = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4] == 'read-only', sys.argv[5]
try:
    plugs = json.load(open(path))
except Exception:
    plugs = {}
old = next((v for v in plugs.values() if isinstance(v, dict) and v.get('node') == node), {})
plugs = {k: v for k, v in plugs.items() if isinstance(v, dict) and v.get('node') != node and k != spark}
plugs[spark] = {**old, 'node': node, **({'readOnly': True} if read_only else {}), **({'mac': mac} if mac else {})}
tmp = f'{path}.{os.getpid()}.tmp'
with open(tmp, 'w') as f:
    json.dump(plugs, f, indent=2)
os.chmod(tmp, 0o600)
os.replace(tmp, path)
PY
}

# The hub's plug as plugs.json keeps it: its MAC, its node, and whether it is read-only (yes or nothing).
hub_mac() { python3 -c 'import json, sys; print((json.load(open(sys.argv[1])).get(sys.argv[2]) or {}).get("mac", ""))' "$MAP" "${HUB:-}" 2>/dev/null || true; }
hub_node() { python3 -c 'import json, sys; print((json.load(open(sys.argv[1])).get(sys.argv[2]) or {}).get("node", ""))' "$MAP" "${HUB:-}" 2>/dev/null || true; }
hub_kept_read_only() { python3 -c 'import json, sys; print("yes" if (json.load(open(sys.argv[1])).get(sys.argv[2]) or {}).get("readOnly") is True else "")' "$MAP" "${HUB:-}" 2>/dev/null || true; }

# Takes this controller off a plug again (it leaves the plug's fabric list). Used when a pairing mustn't be kept.
undo_pair() {
  if ask remove_node "{\"node_id\": $1}" </dev/null >/dev/null 2>&1; then
    echo "Unpaired it again: the controller has no rights on that plug." >&2
  else
    echo "Couldn't unpair that plug from here. Spark Console never reads or switches a plug it hasn't kept; in the Tapo app, open that plug's Matter settings and remove the other connection." >&2
  fi
}

# The hub's plug: lower this controller's own rights on it to View, then prove the plug refuses its commands.
read_only() {
  local node="$1" info subjects ep out name
  info="$(ask get_node "{\"node_id\": $node}" </dev/null 2>/dev/null)" || { echo "Couldn't read the plug back after pairing." >&2; return 1; }
  subjects="$(printf '%s' "$info" | python3 -c "$NODEINFO" admins)" || { echo "Couldn't find the controller's own entry in the plug's access list." >&2; return 1; }
  ep="$(printf '%s' "$info" | python3 -c "$NODEINFO" onoff)" || { echo "The plug shows no on/off switch to test with." >&2; return 1; }
  out="$(ask set_acl_entry "{\"node_id\": $node, \"entry\": [{\"privilege\": 1, \"auth_mode\": 2, \"subjects\": $subjects, \"targets\": null}]}" </dev/null 2>/dev/null)" ||
    { echo "The plug refused the change to view-only." >&2; return 1; }
  printf '%s' "$out" | python3 -c 'import json, sys; r = json.load(sys.stdin); r = r if isinstance(r, list) else [r]; sys.exit(0 if r and all(x.get("status", x.get("Status", 1)) == 0 for x in r) else 1)' ||
    { echo "The plug didn't accept the change to view-only: $out" >&2; return 1; }
  # The proof: "on" (the hub is running this, so its plug is on and nothing changes) must be refused for access.
  for name in on On; do
    if out="$(ask device_command "{\"node_id\": $node, \"endpoint_id\": $ep, \"cluster_id\": 6, \"command_name\": \"$name\", \"payload\": {}}" </dev/null 2>/dev/null)"; then
      echo "The plug still accepts commands from the controller." >&2
      return 1
    fi
    if printf '%s' "$out" | python3 -c 'import json, sys; r = json.load(sys.stdin); d = str(r.get("details") or "").lower().replace(" ", "").replace("_", "")
sys.exit(0 if r.get("status") == 126 or "unsupportedaccess" in d or "0x7e" in d else 1)'; then
      return 0
    fi
  done
  echo "Couldn't show that the plug refuses commands from the controller: $out" >&2
  return 1
}

# Every action, first of all: only on the hub.
case "$ACTION" in *) hub_here ;; esac
case "$ACTION" in
  install) install_it ;;
  pair)
    [[ $SPARK =~ ^spark[1-9][0-9]*$ ]] || { echo "Say which Spark the plug is on." >&2; exit 2; }
    IFS= read -r CODE
    if ! running || [ "$(docker inspect -f '{{index .Config.Labels "spark.plugs.setup"}}' "$C" 2>/dev/null)" != "$SETUP" ]; then install_it; fi
    echo "Pairing ${SPARK/spark/Spark }'s plug. Finding it on the network can take up to 3 minutes …"
    if ! OUT="$(printf '%s' "$CODE" | ask commission)"; then
      echo "Pairing didn't finish. What $HUB_SAYS sees of the plugs:" >&2
      check_net >&2 || true
      [ "$SPARK" != "$HUB" ] || [ -z "$(hub_node)" ] || echo "If $HUB_SAYS's plug is already assigned here with full rights (status shows it), make it read-only with: bash spark-console/deploy/plugs.sh name $HUB_N $HUB_N" >&2
      exit 1
    fi
    unset CODE
    NODE="$(printf '%s' "$OUT" | python3 -c 'import json, sys; r = json.load(sys.stdin); print(int(r["node_id"] if isinstance(r, dict) else r))')"
    MAC="$(ask get_node "{\"node_id\": $NODE}" </dev/null 2>/dev/null | python3 -c "$NODEINFO" mac 2>/dev/null || true)"
    if [ "$SPARK" = "$HUB" ]; then
      echo "Paired. Making it read-only for this controller, then checking the plug refuses its commands …"
      if ! read_only "$NODE"; then undo_pair "$NODE"; exit 1; fi
      map_node "$HUB" "$NODE" read-only "$MAC"
      echo "$HUB_SAYS's plug is read-only here: its readings come through, and the plug refuses any switch from $HUB_SAYS."
    else
      # The hub's plug is never kept with full rights, whichever Spark it was paired as.
      if [ -n "$MAC" ] && [ "$MAC" = "$(hub_mac)" ]; then
        echo "That's the hub's plug ($HUB_SAYS's, MAC $MAC). It's only ever kept read-only, by: bash spark-console/deploy/plugs.sh pair $HUB_N" >&2
        undo_pair "$NODE"; exit 1
      fi
      map_node "$SPARK" "$NODE" '' "$MAC"
      echo "Paired."
    fi
    ask nodes </dev/null | python3 -c "$SHOW" "$MAP" "$HUB" ;;
  name)
    [[ $SPARK =~ ^spark[1-9][0-9]*$ ]] || { echo "Say which Spark it's on." >&2; exit 2; }
    need_running
    NODE="$(ask nodes </dev/null | python3 -c "$SELECT" "$MAP" "$SELECTOR" "$SPARK")"
    MAC="$(ask get_node "{\"node_id\": $NODE}" </dev/null 2>/dev/null | python3 -c "$NODEINFO" mac 2>/dev/null || true)"
    if [ "$SPARK" = "$HUB" ]; then
      # The hub's own plug, paired with full rights before its Spark became the hub: lowered to View and proven, as a
      # new pairing of it is; kept as the hub's only then.
      if [ "$NODE" = "$(hub_node)" ] && [ "$(hub_kept_read_only)" = yes ]; then
        echo "$HUB_SAYS's plug is assigned already, and read-only."
      else
        echo "Making $HUB_SAYS's plug read-only for this controller, then checking it refuses its commands …"
        read_only "$NODE" || { echo "That plug wasn't kept as $HUB_SAYS's. If it is that plug, remove this controller's connection from it in the Tapo app, then pair it again: bash spark-console/deploy/plugs.sh pair $HUB_N" >&2; exit 1; }
        map_node "$HUB" "$NODE" read-only "$MAC"
        echo "$HUB_SAYS's plug is read-only here: its readings come through, and the plug refuses any switch from $HUB_SAYS."
      fi
    else
      if [ "$NODE" = "$(hub_node)" ] || { [ -n "$MAC" ] && [ "$MAC" = "$(hub_mac)" ]; }; then
        echo "That plug is the hub's ($HUB_SAYS's), which stays read-only." >&2; exit 2
      fi
      map_node "$SPARK" "$NODE" '' "$MAC"
    fi
    ask nodes </dev/null | python3 -c "$SHOW" "$MAP" "$HUB" ;;
  status)
    need_running
    ask nodes </dev/null | python3 -c "$SHOW" "$MAP" "$HUB" ;;
  check) check_net ;;
  remove)
    if docker rm -f "$C" >/dev/null 2>&1; then
      echo "Removed the plug controller. The plugs keep their power as it is; the pairings stay in $DATA."
    else
      echo "No plug controller was installed."
    fi ;;
esac
REMOTE_EOF
REMOTE="IMAGE='$IMAGE'"$'\n'"HUB='$HUB' HUB_SAYS='$HUB_SAYS' HUB_N='$HUB_N'"$'\n'"$REMOTE"

CTL="$(mktemp -d /tmp/sc-ssh.XXXXXX)"
SSH=(ssh -o ControlMaster=auto -o ControlPath="$CTL/ssh" -o ControlPersist=120)
trap '"${SSH[@]}" -O exit "$HOST" >/dev/null 2>&1 || true; rm -rf "$CTL"' EXIT
echo "Connecting to $HUB_SAYS, the hub ($HOST). Your password is asked once."
"${SSH[@]}" -fN "$HOST"
printf '%s\n' "$REMOTE" | "${SSH[@]}" "$HOST" 'umask 077; mkdir -p ~/.cache/spark-console && cat > ~/.cache/spark-console/plugs-remote.sh'
if [ "$ACTION" = pair ]; then
  printf '%s\n' "$CODE" | "${SSH[@]}" "$HOST" "bash ~/.cache/spark-console/plugs-remote.sh pair $SPARK"
  unset CODE
elif [ "$ACTION" = name ]; then
  "${SSH[@]}" "$HOST" "bash ~/.cache/spark-console/plugs-remote.sh name $SPARK $(printf %q "$SELECTOR")" </dev/null
else
  "${SSH[@]}" "$HOST" "bash ~/.cache/spark-console/plugs-remote.sh $ACTION" </dev/null
fi
