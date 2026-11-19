/* ───────── Spark status (taking over from the original portal) ───────── */
// Area: knowledge        Rules: R10, R20, R24, R30, R37, R41, R56
// Tests: fleet.test.mjs, dark.test.mjs, files.test.mjs, status-power-order.test.mjs, wall-monthly.test.mjs
// Owns: energy.json (writers: sampleEnergy)
// Timers: collectStatus (every 30 s, after a first round 2 s after start)        Wakes: none
// Each Spark's status comes from the portal's own worker.py (now shipped with the service), run over the same SSH
// as everything else, with the same fields the portal reported. It's collected every 30 seconds whether or not
// anyone is looking, like the portal did, which also keeps the GPU energy total going.
const WORKER = process.env.SPARK_CONSOLE_WORKER || `${HERE}worker.py`;
const STATUS_EVERY = Number(process.env.SPARK_CONSOLE_STATUS_MS || 30000);

function runWorker(node, payload, timeout = 30000) {
  if (knownOffline(node)) return Promise.reject(new Error(`${node.id} isn’t reachable (checked in the last minute).`));
  const code = readFileSync(WORKER).toString('base64');
  const command = `${payload?.action === 'status' ? PATH_CHECK : ''}python3 -I -c ${q(`import base64;exec(compile(base64.b64decode('${code}'),'<spark-console-worker>','exec'))`)}`;
  return new Promise((resolve, reject) => {
    const began = Date.now(), child = spawnOn(node, { command });
    // (refused: the worker itself said no, as opposed to the Spark not answering; conflict: a name that's taken)
    let buf = '', result = null, error = null, timedOut = false, refused = false, conflict = false;
    const timer = setTimeout(() => { timedOut = true; error ||= 'The Spark didn’t answer in time.'; child.kill('SIGKILL'); }, timeout);
    child.stdout.on('data', chunk => {
      buf += chunk;
      if (buf.length > 4e6) { error = 'The Spark’s answer was too large.'; child.kill('SIGKILL'); }
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        try {
          const ev = JSON.parse(line);
          if (ev.type === 'result') result = ev.result;
          else if (ev.type === 'error') { error = String(ev.error || 'The Spark couldn’t do that.').slice(0, 300); refused = true; conflict = ev.code === 'conflict'; }
          else if (ev.type === 'path' && typeof ev.missing === 'string') pathMissing.set(node.id, ev.missing.split(' ').filter(p => PATH_PROGRAMS.split(' ').includes(p)));
        } catch {}
      }
    });
    child.stderr.on('data', () => {});
    child.on('error', e => { error ||= e.message; });
    child.on('close', exit => {
      clearTimeout(timer);
      noteReach(node, timedOut ? 255 : exit, began, timedOut);
      if (result && !error) resolve(result);
      else reject(Object.assign(new Error(error || (exit === 255 ? `${node.id} isn’t reachable.` : 'The Spark didn’t finish.')), { refused: refused && !timedOut, conflict }));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(payload));
  });
}

// The same cleaning the portal applied to the worker's report.
const STATUS_KEYS = ['gpu', 'gpuUtilization', 'temperature', 'memoryTotalGiB', 'memoryFreeGiB', 'uptimeSeconds', 'load', 'load1Minute', 'cpuLogicalCount',
  'dockerAccessible', 'diskFreeGiB', 'gpuPowerWatts'];
const sparkName = n => n.name || `Spark ${String(n.id).replace(/^spark/, '')}`;
function cleanStatus(node, raw) {
  const value = { id: node.id, name: sparkName(node), configured: true, reachable: true, state: 'online' };
  for (const k of STATUS_KEYS) if (['string', 'number', 'boolean'].includes(typeof raw[k]) || raw[k] === null) value[k] = typeof raw[k] === 'string' ? raw[k].slice(0, 120) : raw[k];
  if (Array.isArray(raw.issues)) {
    value.issues = raw.issues.slice(0, 12).map(x => (typeof x === 'string' ? x : x && typeof x === 'object' ? `${x.name || 'Check'}: ${x.message || 'Unavailable'}` : ''))
      .filter(Boolean).map(x => x.slice(0, 180));
  }
  value.runningContainers = Array.isArray(raw.runningContainers) ? raw.runningContainers.filter(x => typeof x === 'string').slice(0, 40).map(x => x.slice(0, 100)) : null;
  if (raw.power) value.power = { sleepModes: Array.isArray(raw.power.sleepModes) ? raw.power.sleepModes.filter(x => ['s2idle', 'shallow', 'deep'].includes(x)) : [], hibernateAvailable: raw.power.hibernateAvailable === true, remoteWakeVerified: false };
  if (raw.network) {
    value.network = {
      highSpeedLinksUp: Number.isInteger(raw.network.highSpeedLinksUp) ? raw.network.highSpeedLinksUp : 0,
      highSpeedLinksConfigured: Number.isInteger(raw.network.highSpeedLinksConfigured) ? raw.network.highSpeedLinksConfigured : 0,
      controlNetwork: 'Tailscale', inferenceFabricVerified: false,
    };
  }
  return value;
}

// Energy, two totals per Spark: the GPU alone (its own power reading, while the Spark answers) and the whole Spark at
// the wall (its smart plug, 12-plugs.mjs, also while it's dark: a shut-down Spark still draws a little). Power is
// averaged between readings (trapezoids); gaps over two minutes (no reading, the service restarting) aren't counted.
// Kept in an owner-only file next to the chats.
const ENERGY_FILE = `${STATE_DIR}/energy.json`;
const WALL_ENERGY_ZONE = 'America/Los_Angeles';
let energy = null, energyProblem = null;
function wallMonthFormatter() {
  return new Intl.DateTimeFormat('en-US', { timeZone: WALL_ENERGY_ZONE, year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
}
const WALL_ENERGY_FORMAT = wallMonthFormatter();
function wallMonthParts(t) {
  return Object.fromEntries(WALL_ENERGY_FORMAT.formatToParts(new Date(t))
    .filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
}
function wallMonthAt(t) {
  const p = wallMonthParts(t);
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}
function wallMonthStart(month, next = false) {
  const [year, m] = month.split('-').map(Number), target = Date.UTC(year, m - 1 + Number(next), 1);
  let t = target;
  // Local midnight is unambiguous here; find its UTC offset instead of assuming every month is PST.
  for (let i = 0; i < 3; i++) {
    const p = wallMonthParts(t);
    t += target - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  }
  return t;
}
function wallMonthBucket(monthly, month, ids) {
  const bucket = (monthly.months[month] ||= { expected: [], nodes: {} });
  bucket.expected = [...new Set([...bucket.expected, ...ids])];
  return bucket;
}
function wallMonthState(now) {
  if (Object.hasOwn(energy, 'wallMonthly')) {
    const m = energy.wallMonthly;
    if (!m || m.version !== 1 || m.timeZone !== WALL_ENERGY_ZONE || !m.months || typeof m.months !== 'object' || Array.isArray(m.months)
      || !m.last || typeof m.last !== 'object' || Array.isArray(m.last)) {
      throw new HttpError(503, 'The saved electricity months could not be read. Their file was left alone.');
    }
    const number = n => Number.isFinite(n) && n >= 0, object = x => x && typeof x === 'object' && !Array.isArray(x);
    for (const [month, bucket] of Object.entries(m.months)) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !object(bucket) || !Array.isArray(bucket.expected)
        || bucket.expected.some(id => typeof id !== 'string') || !object(bucket.nodes)
        || Object.values(bucket.nodes).some(e => !object(e) || !number(e.kWh) || !number(e.coverageSeconds)
          || !number(e.since) || !number(e.until) || e.until < e.since || e.since < wallMonthStart(month)
          || e.until > wallMonthStart(month, true) || e.coverageSeconds > (e.until - e.since) / 1000 + 1)) {
        throw new HttpError(503, 'The saved electricity month could not be read. Its file was left alone.');
      }
    }
    if (Object.values(m.last).some(p => !object(p) || !number(p.t) || (p.w !== null && (!number(p.w) || p.w > 3000))
      || (p.plug !== null && !Number.isInteger(p.plug)))) throw new HttpError(503, 'The last electricity reading could not be read. Its file was left alone.');
    return m;
  }
  const monthly = { version: 1, timeZone: WALL_ENERGY_ZONE, months: {}, last: {} };
  // A lifetime counter is assignable only when both ends prove it belongs to one month. Never split an old total.
  for (const [id, e] of Object.entries(energy.nodes)) {
    const since = Date.parse(e.wallSince), until = e.wallLast?.t;
    if (!Number.isFinite(since) || !Number.isFinite(until) || until < since || until > now || wallMonthAt(since) !== wallMonthAt(until)
      || !Number.isFinite(e.wallKWh) || e.wallKWh < 0 || !Number.isFinite(e.wallCoverageSeconds) || e.wallCoverageSeconds < 0
      || e.wallCoverageSeconds > (until - since) / 1000 + 1 || (e.wallKWh > 0 && !e.wallCoverageSeconds)) continue;
    if (e.wallCoverageSeconds > 0) {
      const bucket = wallMonthBucket(monthly, wallMonthAt(since), Object.keys(energy.nodes));
      bucket.legacy = true;
      bucket.nodes[id] = { kWh: e.wallKWh, coverageSeconds: e.wallCoverageSeconds, since, until };
    }
    // The old file did not keep a plug identity. The first new observation starts a new pair of readings.
    monthly.last[id] = { t: until, w: null, plug: null };
  }
  energy.wallMonthly = monthly;
  return monthly;
}
function addWallMonthInterval(monthly, id, previous, current, ids) {
  const span = current.t - previous.t;
  for (let start = previous.t; start < current.t;) {
    const month = wallMonthAt(start), end = Math.min(current.t, wallMonthStart(month, true));
    const a = previous.w + (current.w - previous.w) * (start - previous.t) / span;
    const b = previous.w + (current.w - previous.w) * (end - previous.t) / span;
    const bucket = wallMonthBucket(monthly, month, ids);
    const e = (bucket.nodes[id] ||= { kWh: 0, coverageSeconds: 0, since: start, until: end });
    e.kWh += ((a + b) / 2) * (end - start) / 3.6e9;
    e.coverageSeconds += (end - start) / 1000;
    e.since = Math.min(e.since, start); e.until = Math.max(e.until, end);
    start = end;
  }
}
function sampleWallMonths(nodes, now) {
  const monthly = wallMonthState(now), ids = nodes.map(n => n.id);
  for (const n of nodes) {
    const wall = n.wall, t = Date.parse(wall?.at), previous = monthly.last[n.id];
    const valid = wall?.answering && Number.isFinite(wall.watts) && wall.watts >= 0 && wall.watts <= 3000
      && Number.isFinite(t) && t <= now && now - t <= 120000 && Number.isInteger(wall.plug);
    if (!valid) { if (previous) previous.w = null; continue; }
    // A controller reply reused by several status reads contributes once. A clock going back never recounts it.
    if (previous && t <= previous.t) continue;
    const current = { t, w: wall.watts, plug: wall.plug };
    if (previous && previous.w !== null && previous.plug === current.plug && t - previous.t <= 120000) {
      addWallMonthInterval(monthly, n.id, previous, current, ids);
    }
    monthly.last[n.id] = current;
  }
}
function wallMonthlyView(now = Date.now()) {
  const currentMonth = wallMonthAt(now), monthly = energy?.wallMonthly;
  const months = [...new Set([currentMonth, ...Object.keys(monthly?.months || {})])].sort().reverse().map(month => {
    const bucket = monthly?.months[month], start = wallMonthStart(month), end = Math.min(now, wallMonthStart(month, true));
    const nodes = Object.entries(bucket?.nodes || {}), expected = [...new Set([...(bucket?.expected || []), ...(month === currentMonth ? NODES.map(n => n.id) : [])])];
    const seconds = nodes.reduce((sum, [, e]) => sum + e.coverageSeconds, 0);
    const partial = Boolean(bucket?.legacy) || !expected.length || expected.some(id => {
      const e = bucket?.nodes[id];
      return !e || e.since > start + 1 || (e.until - start) / 1000 - e.coverageSeconds > 1
        || end - e.until > (month === currentMonth ? 120000 : 1);
    });
    return { month, kWh: seconds > 0 ? Math.round(nodes.reduce((sum, [, e]) => sum + e.kWh, 0) * 1e6) / 1e6 : null, partial,
      recordedSince: nodes.length ? new Date(Math.min(...nodes.map(([, e]) => e.since))).toISOString() : null,
      recordedUntil: nodes.length ? new Date(Math.max(...nodes.map(([, e]) => e.until))).toISOString() : null,
      coverageSeconds: Math.round(seconds),
      bySpark: Object.fromEntries(nodes.map(([id, e]) => [id, { kWh: e.kWh, coverageSeconds: Math.round(e.coverageSeconds),
        since: new Date(e.since).toISOString(), until: new Date(e.until).toISOString() }])) };
  });
  return { timeZone: WALL_ENERGY_ZONE, currentMonth, method: 'wall-power-readings', months, ...(energyProblem ? { problem: energyProblem } : {}) };
}
function addEnergy(e, w, now, [kWh, seconds, last]) {
  if (w !== null && e[last] && now - e[last].t <= 120000 && now > e[last].t) {
    const dt = (now - e[last].t) / 1000;
    e[kWh] = (e[kWh] || 0) + (((w + e[last].w) / 2) * dt) / 3.6e6;
    e[seconds] = (e[seconds] || 0) + dt;
  }
  e[last] = w === null ? null : { t: now, w };
}
function sampleEnergy(nodes) {
  energy ||= readKept(ENERGY_FILE) || { since: null, nodes: {} };
  if (!energy || typeof energy !== 'object' || !energy.nodes || typeof energy.nodes !== 'object' || Array.isArray(energy.nodes)
    || Object.values(energy.nodes).some(e => !e || typeof e !== 'object' || Array.isArray(e))) {
    throw new HttpError(503, 'The saved electricity readings could not be read. Their file was left alone.');
  }
  const now = Date.now();
  sampleWallMonths(nodes, now);
  for (const n of nodes) {
    const e = (energy.nodes[n.id] ||= { kWh: 0, coverageSeconds: 0, last: null });
    addEnergy(e, n.reachable && typeof n.gpuPowerWatts === 'number' ? n.gpuPowerWatts : null, now, ['kWh', 'coverageSeconds', 'last']);
    const wall = n.wall?.answering && typeof n.wall.watts === 'number' ? n.wall.watts : null;
    if (wall !== null) e.wallSince ||= new Date(now).toISOString();
    addEnergy(e, wall, now, ['wallKWh', 'wallCoverageSeconds', 'wallLast']);
  }
  energy.since ||= new Date(now).toISOString();
  try { writePrivate(ENERGY_FILE, energy); energyProblem = null; }
  catch { energyProblem = 'Electricity totals could not be saved. They will be tried again with the next reading.'; }
}
const energyView = () => (energy || energyProblem ? {
  since: energy?.since || null,
  wallMonthly: wallMonthlyView(),
  nodes: Object.fromEntries(Object.entries(energy?.nodes || {}).map(([id, e]) => [id, { kWh: e.kWh, coverageSeconds: Math.round(e.coverageSeconds),
    ...(e.wallSince ? { wallKWh: e.wallKWh || 0, wallCoverageSeconds: Math.round(e.wallCoverageSeconds || 0), wallSince: e.wallSince } : {}) }])),
} : null);

let statusCache = null, statusPending = null;
function collectStatus() {
  statusPending ||= (async () => {
    await refreshNodes(null);
    const nodes = await Promise.all(NODES.map(async n => {
      // The cut this probe starts after, not when the whole batch happens to finish. An older reply can arrive late.
      const powerCutSeen = powerCutOperation(n.id);
      try { return { ...cleanStatus(n, await runWorker(n, { action: 'status' }, 25000)), powerCutSeen }; } catch {
        return { id: n.id, name: sparkName(n), configured: true, reachable: false, state: 'unreachable' };
      }
    }));
    for (const n of nodes) { const w = wallFor(n.id); if (w) n.wall = w; }
    try { sampleEnergy(nodes); }
    catch { energy = null; energyProblem = 'Electricity history could not be read. Its saved totals were left alone.'; }
    noteSparkStates(nodes);
    statusCache = { at: Date.now(), value: { nodes, updatedAt: new Date().toISOString() } };
    return statusCache.value;
  })().finally(() => { statusPending = null; });
  return statusPending;
}
async function statusFor(viewer, fresh) {
  const value = fresh || !statusCache || Date.now() - statusCache.at > STATUS_EVERY + 5000 ? await collectStatus() : statusCache.value;
  // (a Spark Spark Console powered off on purpose carries its mark, 21-power.mjs: when, why, what was parked)
  // (the wall reading is taken again here, never from the cached copy: a plug plugs.json no longer maps to that Spark,
  // or the hub's read-only mark taken away, shows at once, R41)
  const nodes = value.nodes.map(n => {
    const off = powerMark(n.id), cut = powerCutOperation(n.id), w = wallFor(n.id), { wall: _cached, powerCutSeen, ...rest } = n;
    // A completed cut beats a probe begun before it, even while the controller's cached reading still says on.
    // A probe begun after that cut can prove it came back; no wall-clock or controller timestamp orders those facts.
    if (rest.state === 'online' && off?.plugCut && cut && cut !== powerCutSeen) {
      rest.reachable = false;
      rest.state = 'unreachable';
    }
    return { ...rest, ...(w ? { wall: w } : {}), ...(off ? { poweredOff: off, asleep: rest.state !== 'online' && !off.problem } : {}) };
  });
  // (the owner's tasks under way, with their counts so far: no words of a request, 14-tasks.mjs, E7)
  let tasks = [];
  if (viewer.role === 'owner') try { tasks = tasksNow().map(({ request: _r, ...x }) => x); } catch {}
  return { ...value, nodes, ...(viewer.role === 'owner' ? { energy: energyView(), power: powerView(), tasks } : {}), source: 'console' };
}
setTimeout(() => {
  collectStatus().catch(() => {});
  setInterval(() => collectStatus().catch(() => {}), STATUS_EVERY);
}, 3000);

/* ───────── Spark pages: workloads, logs, diagnostics; shared-folder files (from the portal) ───────── */
// The same worker operations and checks the portal used, for the owner (the only one who gets past the handler). Files
// are a Spark's shared folder only, for the files and save_file actions (R37): the page's file browser, its route and
// the worker's delete, rename and new-folder calls are gone (E10e).
const LOG_SERVICES = ['console', 'sparkie'];
const FILE_OPS = ['list', 'read', 'write'];
const fileBusy = new Map();

function sparkFor(viewer, id) {
  const node = nodeById(id);
  if (!node || !canUse(viewer)) throw new HttpError(403, 'There’s no such Spark on the list.');
  return node;
}
async function workerCall(node, payload, timeout) {
  try { return await runWorker(node, payload, timeout); } catch (e) { throw Object.assign(new HttpError(502, e.message), { refused: Boolean(e.refused), conflict: Boolean(e.conflict) }); }
}

async function sparkFiles(viewer, node, data) {
  const allowed = ['operation', 'path', 'data', 'area', 'offset', 'limit'];
  if (!data || typeof data !== 'object' || Object.keys(data).some(k => !allowed.includes(k))) throw new HttpError(400, 'Unsupported request settings.');
  if (data.area !== 'shared') throw new HttpError(400, 'Only a Spark’s shared folder is read or written here.');
  if (!FILE_OPS.includes(data.operation) || typeof data.path !== 'string' || data.path.length > 1000) throw new HttpError(400, 'Choose a workspace file operation.');
  if ((data.operation !== 'write' && data.data !== undefined) || (data.operation !== 'list' && (data.offset !== undefined || data.limit !== undefined))) {
    throw new HttpError(400, 'Unexpected file settings.');
  }
  // (only the owner reaches here: canUse is the owner's alone, and Sparkie and agents act as the owner)
  if (!canUse(viewer)) throw new HttpError(403, 'Only the owner can do that.');
  const { area: _area, ...settings } = data;
  const mine = fileBusy.get(viewer.login) || 0, all = [...fileBusy.values()].reduce((a, b) => a + b, 0);
  if (mine >= 2 || all >= 8) throw new HttpError(429, 'File operations are busy. Try again shortly.');
  fileBusy.set(viewer.login, mine + 1);
  try {
    return await workerCall(node, { action: 'workspace-files', ...settings, workspaceScope: 'shared' }, 30000);
  } finally {
    fileBusy.set(viewer.login, Math.max(0, (fileBusy.get(viewer.login) || 1) - 1));
  }
}

