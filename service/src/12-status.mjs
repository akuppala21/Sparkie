/* ───────── Spark status (taking over from the original portal) ───────── */
// Area: knowledge        Rules: R10, R24, R30, R37        Tests: fleet.test.mjs, dark.test.mjs, files.test.mjs
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
    const child = spawnOn(node, { command });
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
          else if (ev.type === 'path' && typeof ev.missing === 'string') pathMissing.set(node.id, ev.missing.split(' ').filter(Boolean));
        } catch {}
      }
    });
    child.stderr.on('data', () => {});
    child.on('error', e => { error ||= e.message; });
    child.on('close', exit => {
      clearTimeout(timer);
      noteReach(node, timedOut ? 255 : exit);
      if (result && !error) resolve(result);
      else reject(Object.assign(new Error(error || (exit === 255 ? `${node.id} isn’t reachable.` : 'The Spark didn’t finish.')), { refused: refused && !timedOut, conflict }));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(payload));
  });
}

// The same cleaning the portal applied to the worker's report.
const STATUS_KEYS = ['gpu', 'gpuUtilization', 'temperature', 'memoryTotalGiB', 'memoryFreeGiB', 'uptimeSeconds', 'load', 'load1Minute', 'cpuLogicalCount',
  'editorReady', 'dockerAccessible', 'diskFreeGiB', 'gpuPowerWatts'];
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
let energy = null;
function addEnergy(e, w, now, [kWh, seconds, last]) {
  if (w !== null && e[last] && now - e[last].t <= 120000 && now > e[last].t) {
    const dt = (now - e[last].t) / 1000;
    e[kWh] = (e[kWh] || 0) + (((w + e[last].w) / 2) * dt) / 3.6e6;
    e[seconds] = (e[seconds] || 0) + dt;
  }
  e[last] = w === null ? null : { t: now, w };
}
function sampleEnergy(nodes) {
  energy ||= readJson(ENERGY_FILE) || { since: null, nodes: {} };
  const now = Date.now();
  for (const n of nodes) {
    const e = (energy.nodes[n.id] ||= { kWh: 0, coverageSeconds: 0, last: null });
    addEnergy(e, n.reachable && typeof n.gpuPowerWatts === 'number' ? n.gpuPowerWatts : null, now, ['kWh', 'coverageSeconds', 'last']);
    const wall = n.wall?.answering && typeof n.wall.watts === 'number' ? n.wall.watts : null;
    if (wall !== null) e.wallSince ||= new Date(now).toISOString();
    addEnergy(e, wall, now, ['wallKWh', 'wallCoverageSeconds', 'wallLast']);
  }
  energy.since ||= new Date(now).toISOString();
  try {
    mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(`${ENERGY_FILE}.tmp`, JSON.stringify(energy), { mode: 0o600 });
    renameSync(`${ENERGY_FILE}.tmp`, ENERGY_FILE);
  } catch {}
}
const energyView = () => (energy ? {
  since: energy.since,
  nodes: Object.fromEntries(Object.entries(energy.nodes).map(([id, e]) => [id, { kWh: e.kWh, coverageSeconds: Math.round(e.coverageSeconds),
    ...(e.wallSince ? { wallKWh: e.wallKWh || 0, wallCoverageSeconds: Math.round(e.wallCoverageSeconds || 0), wallSince: e.wallSince } : {}) }])),
} : null);

let statusCache = null, statusPending = null;
function collectStatus() {
  statusPending ||= (async () => {
    await refreshNodes(null);
    const nodes = await Promise.all(NODES.map(async n => {
      try { return cleanStatus(n, await runWorker(n, { action: 'status' }, 25000)); } catch {
        return { id: n.id, name: sparkName(n), configured: true, reachable: false, state: 'unreachable' };
      }
    }));
    for (const n of nodes) { const w = wallFor(n.id); if (w) n.wall = w; }
    sampleEnergy(nodes);
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
  // or Spark 2's read-only mark taken away, shows at once, R41)
  const nodes = value.nodes.map(n => {
    const off = powerMark(n.id), w = wallFor(n.id), { wall: _cached, ...rest } = n;
    return { ...rest, ...(w ? { wall: w } : {}), ...(off ? { poweredOff: off } : {}) };
  });
  return { ...value, nodes, ...(viewer.role === 'owner' ? { energy: energyView() } : {}), source: 'console' };
}
setTimeout(() => {
  collectStatus().catch(() => {});
  setInterval(() => collectStatus().catch(() => {}), STATUS_EVERY);
}, 3000);

/* ───────── Spark pages: workloads, logs, diagnostics, files, actions (taking over from the portal) ───────── */
// The same worker operations and checks the portal used. Only the owner sees workloads, logs and diagnostics and runs
// actions; files follow each person's permissions (personal and shared areas; members see only their own area).
const LOG_SERVICES = ['editor', 'console', 'sparkie'];
const FILE_OPS = ['list', 'read', 'write', 'mkdir', 'rename', 'delete'];
const fileBusy = new Map();

function sparkFor(viewer, id) {
  const node = nodeById(id);
  if (!node || !canUse(viewer, id)) throw new HttpError(403, 'This Spark isn’t shared with you.');
  return node;
}
async function workerCall(node, payload, timeout) {
  try { return await runWorker(node, payload, timeout); } catch (e) { throw Object.assign(new HttpError(502, e.message), { refused: Boolean(e.refused), conflict: Boolean(e.conflict) }); }
}

async function sparkFiles(viewer, node, data) {
  const allowed = ['operation', 'path', 'data', 'revision', 'area', 'destination', 'offset', 'limit'];
  if (!data || typeof data !== 'object' || Object.keys(data).some(k => !allowed.includes(k))) throw new HttpError(400, 'Unsupported request settings.');
  const area = data.area || 'personal';
  if (!['personal', 'shared'].includes(area)) throw new HttpError(400, 'Choose personal or shared files.');
  const permission = (viewer.permissions || ownerPermissions())[area === 'shared' ? 'sharedFiles' : 'files'];
  if (permission === 'none' || (permission !== 'write' && ['write', 'mkdir', 'rename', 'delete'].includes(data.operation))) throw new HttpError(403, 'This file operation isn’t permitted.');
  if (!FILE_OPS.includes(data.operation) || typeof data.path !== 'string' || data.path.length > 1000) throw new HttpError(400, 'Choose a workspace file operation.');
  if ((data.operation !== 'write' && data.data !== undefined) || (!['write', 'rename', 'delete'].includes(data.operation) && data.revision !== undefined)
    || (data.operation !== 'rename' && data.destination !== undefined) || (data.operation !== 'list' && (data.offset !== undefined || data.limit !== undefined))) {
    throw new HttpError(400, 'Unexpected file settings.');
  }
  const owner = viewer.role === 'owner';
  const memberId = owner ? null : accessList().members.find(u => u.login === viewer.login)?.id;
  if (!owner && area === 'personal' && !memberId) throw new HttpError(403, 'Your personal files aren’t set up.');
  const { area: _area, ...settings } = data;
  const scope = area === 'shared' ? { workspaceScope: 'shared' } : owner ? {} : { workspaceScope: 'member', memberId };
  const mine = fileBusy.get(viewer.login) || 0, all = [...fileBusy.values()].reduce((a, b) => a + b, 0);
  if (mine >= 2 || all >= 8) throw new HttpError(429, 'File operations are busy. Try again shortly.');
  fileBusy.set(viewer.login, mine + 1);
  try {
    const { editorFolder, editorRoot, ...visible } = await workerCall(node, { action: 'workspace-files', ...settings, ...scope }, 30000);
    if (owner && typeof (editorRoot || editorFolder) === 'string') visible.editorPath = `${editorPath(node.id)}?folder=${encodeURIComponent(editorRoot || editorFolder)}`;
    return visible;
  } finally {
    fileBusy.set(viewer.login, Math.max(0, (fileBusy.get(viewer.login) || 1) - 1));
  }
}

// Restarting a Spark's VS Code server, as a job (owner only).
async function sparkAction(job, node, action) {
  step(job, 'Restarting the VS Code server');
  const result = await workerCall(node, { action }, 60000);
  if (action === 'editor-restart' && result.editorReady === false) throw new Error('The VS Code server didn’t come back up.');
  note(job, 'Done on the Spark');
}
async function checkSparkAction(node, action) {
  if (action !== 'editor-restart') throw new HttpError(400, 'Unsupported Spark action.');
  if ([...jobs.values()].some(j => j.status === 'running' && j.node === node.id && ['spark-action', 'deploy', 'stop', 'power-off', 'power-on'].includes(j.type))) {
    throw new HttpError(409, `Something is already changing on ${node.id}. Wait for it to finish.`);
  }
}

