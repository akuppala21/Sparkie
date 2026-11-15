/* ───────── who's asking ───────── */
// Area: ground        Rules: R4, R5, R10, R20        Tests: state.test.mjs, internet.test.mjs, passkey.test.mjs, owner-only.test.mjs
// Owns: access.json (writers: none), access.json.good (writers: ownAccess; a copy of the last good access.json)
// Timers: none        Wakes: none
// The owner and the Spark list live in the console's own owner-only file on this Spark (access.json); the service never
// writes it. Spark Console has one user, the owner (contract 2.1): members, their requests and the share link an older
// build kept there are left as they are, never read and never removed (E10d), so going back a build still finds them.
// Tailscale serve sets Tailscale-User-Login, and this service only listens on 127.0.0.1.
const ACCESS_FILE = `${STATE_DIR}/access.json`;
const ACCESS_GOOD = `${ACCESS_FILE}.good`;
const LOGIN_RE = /^[A-Za-z0-9.!#$%&'+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;
const readJson = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
// For files the console rewrites from what it read (recipes that worked, Sparkie's setups, added models): one that
// exists but can't be read is moved aside with a note, so the next save doesn't quietly replace it with an empty one.
// Each of these files also keeps the copy from before its last save, <file>.prev (writePrivate makes it, S1). When the
// file itself isn't JSON (what a power cut can leave), that copy takes its place and the note says so. A missing file is
// just empty: it never falls back.
const keptFiles = new Set();
function readKept(file) {
  keptFiles.add(file);
  let text;
  // Missing is empty; any other read error (too many open files, permissions) is "try again", never "empty", so the
  // next save can't write over what's there.
  try { text = readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw new HttpError(503, `${file.split('/').pop()} couldn’t be read just now (${e.code || e.message}). Try again.`); }
  let v = null;
  try { v = JSON.parse(text); } catch { v = undefined; }
  if (v === undefined) {
    const name = file.split('/').pop();
    const aside = `${file}.unreadable-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    let moved = false;
    try { renameSync(file, aside); moved = true; } catch {}
    // Only once the damaged file is safely aside: the copy from before the last save, if it reads, goes in its place.
    let back = null;
    if (moved) {
      try {
        const prev = JSON.parse(readFileSync(`${file}.prev`, 'utf8'));
        if (prev && typeof prev === 'object') { writePrivate(file, prev); back = prev; }
      } catch {}
    }
    console.error(`${file} couldn’t be read; moved it to ${aside}${back ? ' and put the copy from before the last save in its place' : ''}.`);
    const now = back ? 'The copy from before the last save is in use, so the last change may be missing.' : 'It starts empty now. What it held is still in that file.';
    // At start-up the fleet's record isn't open yet: the note waits for it.
    setTimeout(() => { try { fleetEvent({ type: 'notice', text: `${name} couldn’t be read, so it was set aside as ${aside.split('/').pop()}. ${now}` }); } catch {} }, 0);
    return back;
  }
  return v;
}
// Saves that failed, by file name, until a later save of the same file works, and when a save of any file last worked
// (openProblems, 20-needs.mjs, reads both: a failed save is listed only while no save has worked since it failed).
const saveFailed = new Map();
let saveWorkedAt = 0;
function writePrivate(file, value) {
  const name = String(file).split('/').pop();
  try {
    mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    // Synced to disk before it takes the file's place: after a power cut the file is the old one or the new one, never
    // an empty one (S1).
    const fd = openSync(tmp, 'w', 0o600);
    try { writeFileSync(fd, JSON.stringify(value, null, 2)); fsyncSync(fd); } finally { closeSync(fd); }
    // A file readKept reads keeps the copy from before this save (a first save has none to keep).
    if (keptFiles.has(file)) { try { copyFileSync(file, `${file}.prev`); chmodSync(`${file}.prev`, 0o600); } catch {} }
    renameSync(tmp, file);
    saveFailed.delete(name);
    saveWorkedAt = Date.now();
  } catch (e) {
    saveFailed.set(name, { at: new Date().toISOString(), code: e.code || 'error' });
    throw e;
  }
}
// access.json is the one file between the owner and every door, so a last good copy is kept beside it
// (access.json.good, S2). The copy is rewritten each time access.json reads fine and differs from it (after an edit by
// hand: the service itself never writes access.json). When access.json is there but can’t be read, isn’t JSON or names
// no owner, the copy answers instead and one notice says so: the bad file is never written over and never moved. A
// missing access.json still means “no owner yet”, copy or no copy. Never throws.
let accessBad = null, accessGoodText = null;
function ownAccess() {
  let text = null, own = null, why = null;
  try { text = readFileSync(ACCESS_FILE, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') why = e.code || 'read error'; }
  if (text === null && !why) { accessBad = null; return null; }
  if (!why) { try { own = JSON.parse(text); } catch { why = 'not JSON'; } }
  if (!why && !own?.ownerLogin) why = 'no owner in it';
  if (!why) {
    accessBad = null;
    // Keeping the copy must never break the read.
    if (text !== accessGoodText) { try { writePrivate(ACCESS_GOOD, own); accessGoodText = text; } catch (e) { console.error(`access.json.good couldn’t be written (${e.code || e.message}).`); } }
    return own;
  }
  const good = readJson(ACCESS_GOOD);
  // No copy to fall back on: as before, no owner.
  if (!good?.ownerLogin) { accessBad = null; return null; }
  if (!accessBad) {
    console.error(`${ACCESS_FILE} can’t be read (${why}); using ${ACCESS_GOOD}.`);
    // At start-up the fleet's record isn't open yet: the note waits for it (as in readKept).
    setTimeout(() => { try { fleetEvent({ type: 'notice', text: `access.json can’t be read (${why}). Spark Console is using its last good copy, access.json.good, so sign-in and the Spark list still work. Mend it, or copy access.json.good over it (both are in Spark Console’s state folder).` }); } catch {} }, 0);
  }
  accessBad = why;
  return good;
}
let accessCache = null;
function accessList() {
  if (accessCache && Date.now() - accessCache.at < 10000) return accessCache;
  const own = ownAccess() || {};
  accessCache = {
    at: Date.now(),
    owner: CONFIG.ownerLogin || own.ownerLogin || null,
    userName: CONFIG.userName || own.userName || 'Owner',
    nodes: Array.isArray(own.nodes) && own.nodes.length ? own.nodes : null,
    sshUser: own.sshUser || CONFIG.user,
    publicHost: own.publicHost || (CONFIG.origin ? new URL(CONFIG.origin).host : null),
  };
  return accessCache;
}

const clean = (v, max) => String(v || '').replace(/[\u0000-\u001f\u007f\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
// Counting requests per address in a window (an IPv6 /64 counts as one address); the oldest addresses are forgotten first.
// IPv6 is expanded first, so every way of writing one /64 is the same key; an IPv4 address inside IPv6 counts as itself.
function addressKey(from) {
  const a = String(from).toLowerCase().replace(/%.*$/, '');
  if (!a.includes(':')) return a;
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (v4) return v4[1];
  const [head, tail = ''] = a.split('::'), h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
  const groups = a.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return groups.slice(0, 4).map(g => g.replace(/^0+(?=.)/, '')).join(':');
}
function overLimit(map, from, windowMs, limit) {
  const key = addressKey(from), now = Date.now();
  const recent = (map.get(key) || []).filter(t => now - t < windowMs);
  map.delete(key);
  if (recent.length >= limit) { map.set(key, recent); return true; }
  map.set(key, [...recent, now]);
  while (map.size > 2000) map.delete(map.keys().next().value);
  return false;
}
const ownerPermissions = () => ({ nodeIds: NODES.map(n => n.id), chat: true, files: 'write', sharedFiles: 'write', concurrentChats: 4 });

async function viewerFor(req) {
  // Internet (Funnel) traffic never carries a Tailscale identity (Tailscale removes any it brings): it's someone only
  // when it's a device the owner signed in (docs/contract.md 4.10). On the tailnet, Tailscale's identity wins.
  const funnel = Boolean(req.headers['tailscale-funnel-request']);
  const login = funnel ? null : req.headers['tailscale-user-login'] || DEV_LOGIN;
  if (!login) {
    const v = sessionViewer(req);
    authProblem = v ? null : funnel ? 'From the internet, and not signed in' : 'No Tailscale identity on the request';
    return v;
  }
  return viewerForLogin(login);
}
// The owner, by their login; anyone else (a former member included: their row in access.json is never read) is nobody.
function viewerForLogin(login) {
  const a = accessList();
  if (a.owner) {
    if (String(login || '').toLowerCase() !== String(a.owner).toLowerCase()) { authProblem = `${login} doesn’t have access`; return null; }
    authProblem = null;
    return { login, role: 'owner', nodeIds: null, chat: true, permissions: ownerPermissions() };
  }
  authProblem = `No owner is set up in ${ACCESS_FILE}`;
  return null;
}
// Acting on a Spark, or running and stopping models, is the owner's: every viewer is the owner (the page, the agents'
// keys, Telegram, the self-test and healing all act as the owner), and anything else is refused, never let through.
// (The start and stop workflows call these, so their names stay.)
const canUse = viewer => viewer?.role === 'owner';
const canManage = viewer => viewer?.role === 'owner';
function mustUse(viewer) {
  if (!canManage(viewer)) throw new HttpError(403, 'Only the owner can do that.');
}

// This machine's own addresses, so the portal host's entry runs commands locally instead of over SSH.
const LOCAL_IPS = new Set();
spawn('bash', ['-c', 'tailscale ip 2>/dev/null; hostname -I 2>/dev/null']).on('error', () => {}).stdout
  .on('data', d => String(d).split(/\s+/).filter(Boolean).forEach(ip => LOCAL_IPS.add(ip)));

let nodesAt = 0;
async function refreshNodes(req) {
  if (Date.now() - nodesAt < NODES_TTL) return;
  nodesAt = Date.now();
  const a = accessList();
  let list;
  if (a.nodes) {
    // Every Spark with a Tailscale address (the list came from the portal's config); sshHost may carry a user.
    list = a.nodes.filter(n => n.configured && /^[0-9.]+$/.test(n.tailnetIp || '')).map(n => {
      const at = String(n.sshHost || '').split('@');
      return { id: n.id, name: n.name, ip: n.tailnetIp, user: at.length === 2 ? at[0] : a.sshUser, local: n.local === true };
    });
  } else return;
  list = list.filter(n => NODE_ID_RE.test(n.id || '') && /^[0-9a-fA-F:.]+$/.test(n.ip || '') && /^[a-z_][a-z0-9_.-]*$/i.test(n.user || CONFIG.user));
  if (!list.length) return;
  const before = new Set(NODES.map(n => n.id));
  NODES = list.map(n => ({
    id: n.id, name: n.name || null, ip: n.ip, user: n.user || CONFIG.user, alias: n.alias || `ak${n.id}`,
    host: n.local || LOCAL_IPS.has(n.ip) || nodeById(n.id)?.host === 'local' ? 'local' : n.ip,
  }));
  for (const [id, entry] of samplers) {
    if (nodeById(id)) continue;
    clearTimeout(entry.retry);
    entry.child?.kill('SIGTERM');
    samplers.delete(id);
  }
  if (clients.size) for (const n of NODES) if (!before.has(n.id)) startSampler(n);
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const forwarded = req.headers['x-forwarded-host'] ? `https://${req.headers['x-forwarded-host']}` : null;
  return origin === CONFIG.origin || origin === forwarded || (selfOrigin && origin === selfOrigin);
}

