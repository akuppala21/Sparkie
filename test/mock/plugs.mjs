// A stand-in for the Matter controller (matterjs-server) that deploy/plugs.sh runs on Spark 2: a WebSocket that sends
// the server's own description first, as the real one does, then answers get_nodes with the nodes it is given
// (setNodes), and device_command on the On/Off cluster (6): "on" and "off" (or, with names 'upper', only "On" and "Off")
// switch that node's <endpoint>/6/0, and a node marked readOnly refuses with Matter's status 126 (no rights), as Spark 2's
// plug does. Anything else is an error. Only what 12-plugs.mjs asks. Started inside the test process.
// attach({ offlineFile, sparks: { node: spark }, bootMs }) ties nodes to the stand-in fleet's Sparks: a plug's watts follow
// its Spark (on and answering: about 58 W; shut down, in the offline file: 2.5 W; plug off: 0), switching a plug off
// takes its Spark down (into the offline file) and switching it on boots it bootMs later (out of the file), unless
// setNoBoot(node). setStuck(node): its watts never drop (the plug isn't on that Spark). setWatts(node, milliwatts): a
// reading that stays at that value whatever its Spark does (one the controller hasn't caught up with); null ends it.
// setFail(node, text): every command to that node is refused with that text as the controller's details; null ends it.
// commands lists what was sent.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const frame = text => {
  const body = Buffer.from(text), len = body.length;
  let head;
  if (len < 126) head = Buffer.from([0x81, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, body]);
};
// Whole frames from what arrived so far (clients always mask theirs); the rest waits for more bytes.
function frames(buf) {
  const out = [];
  for (;;) {
    if (buf.length < 2) break;
    const op = buf[0] & 0x0f, masked = Boolean(buf[1] & 0x80);
    let len = buf[1] & 0x7f, at = 2;
    if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); at = 4; }
    else if (len === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); at = 10; }
    const mask = masked ? buf.subarray(at, at + 4) : null;
    if (masked) at += 4;
    if (buf.length < at + len) break;
    const body = Buffer.from(buf.subarray(at, at + len));
    if (mask) for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4];
    out.push({ op, text: body.toString() });
    buf = buf.subarray(at + len);
  }
  return [out, buf];
}

export async function startPlugs(nodes = []) {
  let current = nodes, fleet = null, names = 'lower';
  const asked = [], commands = [], stuck = new Set(), noBoot = new Set(), boots = new Map(), fixed = new Map(), fail = new Map();
  const offline = () => { try { return readFileSync(fleet.offlineFile, 'utf8').split(/[\s,]+/).filter(Boolean); } catch { return []; } };
  const setOffline = (spark, off) => {
    const now = offline().filter(x => x !== spark);
    writeFileSync(fleet.offlineFile, `${[...now, ...(off ? [spark] : [])].join('\n')}\n`);
  };
  const onOffKey = n => Object.keys(n.attributes || {}).find(k => /^\d+\/6\/0$/.test(k));
  // A node as get_nodes gives it: tied to a stand-in Spark, its watts (and amps) follow that Spark.
  const view = n => {
    const spark = fleet?.sparks[n.node_id];
    if (!spark) return n;
    const on = n.attributes?.[onOffKey(n)] === true;
    const mw = !on ? 0 : fixed.has(n.node_id) ? fixed.get(n.node_id) : stuck.has(n.node_id) || !offline().includes(spark) ? 58000 : 2500;
    return { ...n, attributes: { ...n.attributes, '1/144/8': mw, '1/144/5': Math.round(mw / 120) } };
  };
  function command(args) {
    const n = current.find(x => x.node_id === args?.node_id);
    if (!n) return { error_code: 5, details: `Node ${args?.node_id} not found.` };
    if (fail.has(n.node_id)) return { error_code: 1, details: fail.get(n.node_id) };
    if (args.cluster_id !== 6) return { error_code: 5, details: `The stand-in has no cluster ${args.cluster_id}.` };
    const known = names === 'upper' ? ['On', 'Off'] : ['on', 'off'];
    if (!known.includes(args.command_name)) return { error_code: 5, details: `Command ${args.command_name} not found on cluster 6.` };
    if (n.readOnly) return { error_code: 7, details: 'Command failed: Matter status 126 (UnsupportedAccess).' };
    const key = `${args.endpoint_id}/6/0`;
    if (!(key in (n.attributes || {}))) return { error_code: 5, details: `Endpoint ${args.endpoint_id} has no On/Off.` };
    const on = /^on$/i.test(args.command_name), was = n.attributes[key] === true;
    commands.push({ node: n.node_id, command: args.command_name });
    n.attributes = { ...n.attributes, [key]: on };
    const spark = fleet?.sparks[n.node_id];
    if (spark && was && !on) { clearTimeout(boots.get(spark)); setOffline(spark, true); }
    if (spark && !was && on && !noBoot.has(n.node_id)) boots.set(spark, setTimeout(() => setOffline(spark, false), fleet.bootMs ?? 1500));
    return { result: null };
  }
  const server = createServer((_, res) => { res.writeHead(426); res.end(); });
  server.on('upgrade', (req, socket) => {
    const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.write(frame(JSON.stringify({ fabric_id: 1, compressed_fabric_id: 1, schema_version: 11, sdk_version: 'stand-in' })));
    let buf = Buffer.alloc(0);
    socket.on('data', chunk => {
      const [got, rest] = frames(Buffer.concat([buf, chunk]));
      buf = rest;
      for (const m of got) {
        if (m.op === 8) { socket.end(Buffer.from([0x88, 0])); return; }
        if (m.op !== 1) continue;
        let q;
        try { q = JSON.parse(m.text); } catch { continue; }
        asked.push(q.command);
        const answer = q.command === 'get_nodes' ? { result: current.map(view) } : q.command === 'device_command' ? command(q.args)
          : { error_code: 1, details: `The stand-in has no ${q.command}.` };
        socket.write(frame(JSON.stringify({ message_id: q.message_id, ...answer })));
      }
    });
    socket.on('error', () => {});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `ws://127.0.0.1:${server.address().port}/ws`,
    asked, commands,
    setNodes: n => { current = n; },
    attach: f => { fleet = f; },
    setNames: v => { names = v; },
    setStuck: (node, on = true) => { if (on) stuck.add(node); else stuck.delete(node); },
    setNoBoot: (node, on = true) => { if (on) noBoot.add(node); else noBoot.delete(node); },
    setWatts: (node, mw) => { if (mw === null || mw === undefined) fixed.delete(node); else fixed.set(node, mw); },
    setFail: (node, text) => { if (text === null || text === undefined) fail.delete(node); else fail.set(node, String(text)); },
    node: id => current.find(x => x.node_id === id),
    close: () => new Promise(resolve => { for (const t of boots.values()) clearTimeout(t); server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}
