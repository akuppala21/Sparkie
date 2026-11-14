/* ───────── multi-Spark readiness (read-only) ───────── */
// Serving one model across Sparks (NVIDIA's vllm-cluster playbook) needs the ConnectX links up with addresses
// on a shared subnet, and full-MTU reachability between each pair. The console starts each Spark's part over its own
// SSH from Spark 2, so Sparks don't need SSH to each other. Nothing here changes a Spark: it reads /sys and ip, and pings.
const LINKS_SCRIPT = `SYS=\${SPARK_SYSFS:-/sys}
for dev in "$SYS"/class/net/*; do
  name=\${dev##*/}
  case "$name" in en*np*) ;; *) [ -d "$dev/device/infiniband" ] || continue ;; esac
  speed=$(cat "$dev/speed" 2>/dev/null); [ "\${speed:-0}" -gt 0 ] 2>/dev/null || speed=""
  ips=$(ip -4 -o addr show dev "$name" 2>/dev/null | awk '{print $4}' | paste -sd, -)
  printf 'link\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' "$name" "$(cat "$dev/operstate" 2>/dev/null)" "$speed" "$(cat "$dev/mtu" 2>/dev/null)" "$ips" "$(ls "$dev/device/infiniband" 2>/dev/null | head -1)"
done`;

const ipToInt = ip => ip.split('.').reduce((a, b) => (a << 8) + Number(b), 0) >>> 0;
function sameSubnet(cidr, ip) {
  const [base, bits] = cidr.split('/');
  const mask = Number(bits) ? (~0 << (32 - Number(bits))) >>> 0 : 0;
  return (ipToInt(base) & mask) === (ipToInt(ip) & mask);
}

// The network a CIDR address is on, e.g. 10.100.188.1/24 → 10.100.188.0/24: one key per direct cable.
function netOf(cidr) {
  const [base, bits] = cidr.split('/');
  const mask = Number(bits) ? (~0 << (32 - Number(bits))) >>> 0 : 0, n = (ipToInt(base) & mask) >>> 0;
  return `${[24, 16, 8, 0].map(sh => (n >>> sh) & 255).join('.')}/${bits}`;
}

async function fabric(viewer, check) {
  const nodes = NODES;
  const scans = await Promise.all(nodes.map(async n => [n, await run(n, LINKS_SCRIPT, { timeout: 20000 })]));
  const sparks = scans.map(([n, r]) => ({
    id: n.id, online: r.code === 0,
    links: fields(r.out, 'link').map(([name, state, speed, mtu, ips, hca]) => ({
      name, up: state === 'up', speedGbps: Number(speed) ? Number(speed) / 1000 : null, mtu: Number(mtu) || null,
      ipv4: ips ? ips.split(',').filter(Boolean) : [], hca: hca || null,
    })),
  }));
  if (!check) {
    return { sparks, pairs: lastCheck?.pairs || [], checkedAt: lastCheck?.checkedAt || null };
  }

  // From each Spark, ping every peer address that shares a subnet with one of its own links, at full MTU with
  // fragmentation off. A pair that only answers small pings has mismatched MTUs.
  const online = sparks.filter(s => s.online);
  const results = await Promise.all(online.map(async a => {
    const node = nodeById(a.id), peers = online.filter(b => b.id !== a.id);
    const probes = [];
    for (const b of peers) {
      for (const link of a.links.filter(l => l.up)) {
        for (const cidr of link.ipv4) {
          for (const peerIp of b.links.flatMap(l => l.ipv4.map(c => c.split('/')[0]))) {
            if (peerIp !== cidr.split('/')[0] && sameSubnet(cidr, peerIp)) probes.push({ peer: b.id, iface: link.name, ip: peerIp, net: netOf(cidr), mtu: link.mtu || 1500 });
          }
        }
      }
    }
    const lines = probes.map(p => `if ping -c 2 -i 0.2 -W 1 -M do -s ${Math.max(0, p.mtu - 28)} -I ${q(p.iface)} ${q(p.ip)} >/dev/null 2>&1; then r=full; ` +
      `elif ping -c 2 -i 0.2 -W 1 -I ${q(p.iface)} ${q(p.ip)} >/dev/null 2>&1; then r=small; else r=fail; fi; printf 'ping\\t%s\\t%s\\t%s\\t%s\\n' ${q(p.peer)} ${q(p.iface)} ${q(p.ip)} "$r"`);
    const r = lines.length ? await run(node, lines.join('\n'), { timeout: 90000 }) : { out: '' };
    return { from: a.id, pings: fields(r.out, 'ping').map(([peer, iface, ip, result]) => ({ peer, iface, ip, result, net: probes.find(p => p.iface === iface && p.ip === ip)?.net || ip })) };
  }));
  const pairs = [];
  for (const a of online) {
    for (const b of online) {
      if (a.id >= b.id) continue;
      const ab = results.find(x => x.from === a.id), ba = results.find(x => x.from === b.id);
      const pings = [...(ab?.pings || []).filter(p => p.peer === b.id), ...(ba?.pings || []).filter(p => p.peer === a.id)];
      // Per cable (network): a ping's reply comes back over the same cable, so a full-size ping from either side proves
      // it both ways, and a side that can't ping at all (e.g. no permission to) doesn't fail a cable its peer confirms.
      // Only small pings getting through, from either side, is a real size mismatch.
      const byNet = new Map();
      for (const p of pings) byNet.set(p.net, [...(byNet.get(p.net) || []), p.result]);
      const cables = [...byNet.values()].map(rs => (rs.includes('small') ? 'small' : rs.includes('full') ? 'full' : 'fail'));
      pairs.push({
        a: a.id, b: b.id,
        fastLink: !cables.length ? 'no-shared-subnet' : cables.every(r => r === 'full') ? 'full' : cables.some(r => r !== 'fail') ? 'partial' : 'fail',
        pings,
      });
    }
  }
  // A Spark that didn't answer this time (busy, a blip) keeps its pairs' last result rather than losing them: a missing
  // pair reads as "not tested" and refuses every start across it until the next test, 10 minutes on.
  for (const p of lastCheck?.pairs || []) if (!pairs.some(x => x.a === p.a && x.b === p.b) && ![p.a, p.b].every(id => online.some(s => s.id === id)) && nodes.some(n => n.id === p.a) && nodes.some(n => n.id === p.b)) pairs.push(p);
  lastCheck = { pairs, checkedAt: new Date().toISOString() };
  try { writePrivate(LINKS_FILE, lastCheck); } catch {}
  return { sparks, pairs, checkedAt: lastCheck.checkedAt };
}
// The connection test runs on its own every 10 minutes (a few small pings per cable), so pages show a recent result
// without anyone pressing Test connections first.
// Kept on disk, so two-Spark deploys work straight after a restart instead of waiting for the next test.
const LINKS_FILE = `${STATE_DIR}/links.json`;
let lastCheck = readJson(LINKS_FILE);
setTimeout(() => {
  const test = () => fabric({ nodeIds: null }, true).catch(() => {});
  test();
  setInterval(test, Number(process.env.SPARK_CONSOLE_FABRIC_MS || 600000));
}, 20000);

