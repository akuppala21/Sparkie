/* ───────── smart plugs: wall power (contract 9.22) ───────── */
// deploy/plugs.sh runs a Matter controller (matterjs-server, container spark-console-plugs) on Spark 2, with its
// WebSocket on 127.0.0.1:5580 only, and writes which plug (a controller node) is on which Spark to plugs.json. This part
// reads every 15 seconds: whether each plug is on and what the whole Spark draws at the wall (watts, volts, amps).
// switchPlug is the one place in the service that switches a plug (21-power.mjs calls it, R41): only a plug
// switchablePlug allows, and it checks the plug really switched. The plug that powers Spark Console itself is read
// only when deploy/plugs.sh proved it read-only (pair 2), and is never switchable. The stand-in fleet never reaches a
// real controller: SPARK_CONSOLE_PLUGS_URL points it at test/mock/plugs.mjs, and without it there are no plugs.
const PLUGS_FILE = `${STATE_DIR}/plugs.json`;
const PLUGS_URL = process.env.SPARK_CONSOLE_PLUGS_URL || (ALL_LOCAL ? null : 'ws://127.0.0.1:5580/ws');
const PLUGS_EVERY = Number(process.env.SPARK_CONSOLE_PLUGS_MS || 15000);
const PLUG_STALE_MS = Math.max(90000, PLUGS_EVERY * 4);
let plugs = { at: 0, bySpark: {}, problem: null };

// Which plug is on which Spark: plugs.json is {"spark3": {"node": 2}, "spark2": {"node": 4, "readOnly": true}, …},
// written by deploy/plugs.sh. The brain's Spark and the console's own are read only when marked readOnly, which
// plugs.sh writes only after the plug itself refused the controller's command (the controller holds View there).
function plugMap() {
  const raw = readJson(PLUGS_FILE), out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const own = brainSparks();
  for (const [spark, v] of Object.entries(raw)) {
    const node = Number(v?.node);
    if (nodeById(spark) && (!own.includes(spark) || v?.readOnly === true) && Number.isInteger(node) && node > 0) out[spark] = node;
  }
  return out;
}
// The plugs Spark Console may ever ask to switch: none on the brain's Spark or its own, none read-only.
const switchablePlug = spark => {
  const v = readJson(PLUGS_FILE)?.[spark];
  return Boolean(v && !v.readOnly && !brainSparks().includes(spark) && Number.isInteger(Number(v.node)));
};

// One question to the controller (its WebSocket API: the server's own description first, then one answer per
// message_id). get_nodes (every node it knows, with the attributes it has cached from its subscriptions), and, from
// switchPlug alone, device_command. A refusal comes back as an error carrying the controller's words.
function plugAsk(command, args = {}, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    if (!PLUGS_URL) { reject(new Error('There is no plug controller here.')); return; }
    let ws = null, done = false, ready = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws?.close(); } catch {}
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('The plug controller didn’t answer in time.')), timeoutMs);
    try { ws = new WebSocket(PLUGS_URL); } catch (e) { finish(new Error(`The plug controller can’t be reached: ${e.message}`)); return; }
    ws.onerror = () => finish(new Error('The plug controller isn’t answering on Spark 2.'));
    ws.onclose = () => finish(new Error('The plug controller closed the connection.'));
    ws.onmessage = ev => {
      let m;
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (!ready) { // its first message is always the server's own description
        ready = true;
        ws.send(JSON.stringify({ message_id: 'q', command, args }));
        return;
      }
      if (m?.message_id !== 'q') return;
      if (m.error_code != null) finish(Object.assign(new Error(String(m.details || 'The plug controller refused.').slice(0, 200)), { code: m.error_code }));
      else finish(null, m.result);
    };
  });
}
const plugNodes = async (timeoutMs = 8000) => { const r = await plugAsk('get_nodes', {}, timeoutMs); return Array.isArray(r) ? r : []; };

// Matter's numbers: On/Off is cluster 6; Electrical Power Measurement (0x0090) gives milliwatts (attribute 8), millivolts
// (4) and milliamps (5). Anything outside what a plug can carry is dropped rather than shown.
const plugAttr = (a, cluster, attribute) => {
  for (const [k, v] of Object.entries(a || {})) if (new RegExp(`^\\d+/${cluster}/${attribute}$`).test(k)) return v;
  return undefined;
};
const plugNumber = (v, places, lo, hi) => {
  const x = Number(v) / 1000;
  return v !== null && v !== undefined && v !== '' && Number.isFinite(x) && x >= lo && x <= hi ? Math.round(x * 10 ** places) / 10 ** places : null;
};
function wallOf(n, at) {
  const a = n?.attributes || {}, on = plugAttr(a, 6, 0), answering = n?.available !== false;
  if (!answering) return { plug: n.node_id, answering: false, on: null, watts: null, volts: null, amps: null, at, problem: 'The plug isn’t answering the controller.' };
  return {
    plug: n.node_id, answering: true, on: typeof on === 'boolean' ? on : null,
    watts: plugNumber(plugAttr(a, 144, 8), 1, 0, 3000), volts: plugNumber(plugAttr(a, 144, 4), 1, 50, 300), amps: plugNumber(plugAttr(a, 144, 5), 2, 0, 20), at,
  };
}

async function refreshPlugs() {
  const map = plugMap();
  if (!PLUGS_URL || !Object.keys(map).length) { plugs = { at: Date.now(), bySpark: {}, problem: null }; return; }
  try {
    const nodes = await plugNodes(), at = new Date().toISOString(), bySpark = {};
    for (const [spark, node] of Object.entries(map)) {
      const n = nodes.find(x => Number(x?.node_id) === node);
      bySpark[spark] = n ? wallOf(n, at)
        : { plug: node, answering: false, on: null, watts: null, volts: null, amps: null, at, problem: 'The plug controller doesn’t know this plug any more: pair it again with deploy/plugs.sh.' };
    }
    plugs = { at: Date.now(), bySpark, problem: null };
  } catch (e) {
    // The last readings stay until they're stale. A plugged Spark with no reading yet (the console started while the
    // controller was down, or plugs.json now names another plug) says the controller isn't answering, never "no plug".
    const bySpark = { ...plugs.bySpark };
    for (const [spark, node] of Object.entries(map)) {
      if (bySpark[spark]?.plug !== node) bySpark[spark] = { plug: node, answering: false, on: null, watts: null, volts: null, amps: null, at: null, problem: e.message };
    }
    plugs = { ...plugs, bySpark, problem: e.message };
  }
}

// A Spark's wall reading, or null when it has no paired plug. Old readings are never shown as current.
function wallFor(spark) {
  const w = plugs.bySpark[spark];
  // (only a plug plugs.json maps to this Spark now: a mapping taken away, or Spark 2's read-only mark, counts at once,
  // never one reading later, R41)
  if (!w || plugMap()[spark] !== w.plug) return null;
  if (!w.answering) return w;
  if (Date.now() - plugs.at > PLUG_STALE_MS) {
    return { plug: w.plug, answering: false, on: null, watts: null, volts: null, amps: null, at: w.at, problem: plugs.problem || 'No reading from the plug controller lately.' };
  }
  return w;
}
// What agents and Sparkie see: no internal plug number.
const wallView = w => (w ? { plugOn: w.on, watts: w.watts, volts: w.volts, amps: w.amps, readAt: w.at, ...(w.problem ? { problem: w.problem } : {}) } : null);
// For a Spark that isn't answering: what its plug says about why.
const wallWords = w => (!w || !w.answering ? null
  : w.on === false ? 'Its smart plug is off, so it has no power.'
  : w.watts !== null && w.watts < 15 ? `Its plug is on but it draws only ${w.watts} W, so it is shut down.`
  : w.watts !== null ? `Its plug shows ${w.watts} W, so it is powered on but not answering.` : null);

// A Spark's plug read now (a fresh get_nodes, never the 15-second cache): what power_off and power_on decide on.
async function freshWall(spark) {
  const v = readJson(PLUGS_FILE)?.[spark], node = Number(v?.node);
  if (!Number.isInteger(node) || node < 1) throw new Error(`${sparkName(nodeById(spark) || { id: spark })} has no paired plug.`);
  const n = (await plugNodes()).find(x => Number(x?.node_id) === node);
  if (!n) throw new Error(`The plug controller doesn’t know ${sparkName(nodeById(spark) || { id: spark })}’s plug any more: pair it again with deploy/plugs.sh.`);
  return wallOf(n, new Date().toISOString());
}

// Switching a plug (R41): the only place in the service that sends the controller a command. Only a plug switchablePlug
// allows (never the brain's Spark's or the console's own, never one plugs.json marks read-only). The command is Matter's
// On/Off cluster (6) on the endpoint that carries the plug's on/off reading (<endpoint>/6/0); a controller that doesn't
// know the name "on" is asked once more with "On". Done only when a fresh reading shows the plug on (or off) as asked;
// otherwise it throws. Returns that reading.
const PLUG_CONFIRM_MS = Number(process.env.SPARK_CONSOLE_PLUG_CONFIRM_MS || 10000);
async function switchPlug(spark, on) {
  const name = sparkName(nodeById(spark) || { id: spark });
  if (brainSparks().includes(spark) || !switchablePlug(spark)) throw new Error(`${name}’s plug can’t be switched from Spark Console.`);
  const node = Number(readJson(PLUGS_FILE)[spark].node);
  const n = (await plugNodes()).find(x => Number(x?.node_id) === node);
  if (!n) throw new Error(`The plug controller doesn’t know ${name}’s plug any more: pair it again with deploy/plugs.sh.`);
  if (n.available === false) throw new Error(`${name}’s plug isn’t answering the plug controller, so it wasn’t switched.`);
  const key = Object.keys(n.attributes || {}).find(k => /^\d+\/6\/0$/.test(k));
  if (!key) throw new Error(`${name}’s plug has no on/off switch the controller can see.`);
  const endpoint = Number(key.split('/')[0]);
  const send = command => plugAsk('device_command', { node_id: node, endpoint_id: endpoint, cluster_id: 6, command_name: command, payload: {} }, 15000);
  try { await send(on ? 'on' : 'off'); } catch (e) {
    // (a refusal for access, Matter's status 126, is the plug saying no: asking again by another name changes nothing)
    if (/\b126\b|access/i.test(e.message)) throw new Error(`${name}’s plug refused the command (${e.message}).`);
    try { await send(on ? 'On' : 'Off'); } catch (e2) { throw new Error(`${name}’s plug couldn’t be switched ${on ? 'on' : 'off'}: ${e2.message}`); }
  }
  for (const until = Date.now() + PLUG_CONFIRM_MS; ;) {
    // (a reading the controller doesn't give this time is tried again until the time is up)
    const w = wallOf((await plugNodes().catch(() => [])).find(x => Number(x?.node_id) === node) || { node_id: node, available: false }, new Date().toISOString());
    if (w.answering && w.on === on) { refreshPlugs().catch(() => {}); return w; }
    if (Date.now() > until) throw new Error(`${name}’s plug didn’t confirm it is ${on ? 'on' : 'off'}${w.on === null ? ' (no reading)' : ''}.`);
    await sleep(500);
  }
}

setTimeout(() => {
  refreshPlugs().catch(() => {});
  setInterval(() => refreshPlugs().catch(() => {}), PLUGS_EVERY);
}, 2000);
