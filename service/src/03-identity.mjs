/* ───────── who's asking ───────── */
// The owner, the members and the Spark list live in the console's own owner-only file on this Spark, managed in
// Spark Console (Access). Tailscale serve sets Tailscale-User-Login, and this service only listens on 127.0.0.1.
const ACCESS_FILE = `${STATE_DIR}/access.json`;
const ACCESS_GOOD = `${ACCESS_FILE}.good`;
const LOGIN_RE = /^[A-Za-z0-9.!#$%&'+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;
const MEMBER_ID = /^[a-f0-9]{16}$/;
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
// (access.json.good, S2). The copy is rewritten each time access.json reads fine and differs from it: after every change
// made here (changeAccess and changeMembers read it back) and after an edit by hand. When access.json is there but
// can’t be read, isn’t JSON or names no owner, the copy answers instead, one notice says so, and nothing here changes
// who has access until the file reads fine again: the bad file is never written over and never moved. A missing
// access.json still means “no owner yet”, copy or no copy. Never throws.
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
    setTimeout(() => { try { fleetEvent({ type: 'notice', text: `access.json can’t be read (${why}). Spark Console is using its last good copy, access.json.good, so sign-in and the Spark list still work. Who has access can’t be changed until access.json reads fine again: mend it, or copy access.json.good over it (both are in Spark Console’s state folder).` }); } catch {} }, 0);
  }
  accessBad = why;
  return good;
}
// What a change starts from: access.json itself, read fresh. Never the copy, so a change is never built on a guess.
function accessToChange() {
  const own = ownAccess();
  if (accessBad) throw new HttpError(503, 'Who has access can’t be changed just now, because Spark Console’s access file can’t be read. Nothing was changed. The notice in Activity says how to mend it.');
  if (!own) throw new HttpError(409, 'No owner is set up on this Spark yet.');
  return own;
}
let accessCache = null;
function accessList() {
  if (accessCache && Date.now() - accessCache.at < 10000) return accessCache;
  const own = ownAccess() || {};
  accessCache = {
    at: Date.now(),
    owner: CONFIG.ownerLogin || own.ownerLogin || null,
    userName: CONFIG.userName || own.userName || 'Owner',
    members: [...(CONFIG.members || []), ...(Array.isArray(own.members) ? own.members : [])].filter(u => u?.login && u.permissions),
    nodes: Array.isArray(own.nodes) && own.nodes.length ? own.nodes : null,
    sshUser: own.sshUser || CONFIG.user,
    publicHost: own.publicHost || (CONFIG.origin ? new URL(CONFIG.origin).host : null),
  };
  return accessCache;
}

// Members, managed by the owner: which Sparks they see, chat, and their file access (as in the portal).
function memberPermissions(p) {
  const known = new Set(NODES.map(n => n.id));
  const { nodeIds, chat, files, sharedFiles, concurrentChats = 1, deploy = false } = p && typeof p === 'object' ? p : {};
  if (!Array.isArray(nodeIds) || !nodeIds.length || nodeIds.some(id => !known.has(id))) throw new HttpError(400, 'Pick at least one Spark.');
  if (typeof chat !== 'boolean' || typeof deploy !== 'boolean' || ![files, sharedFiles].every(x => ['none', 'read', 'write'].includes(x))) throw new HttpError(400, 'Choose chat, model and file access.');
  if (!Number.isInteger(concurrentChats) || concurrentChats < 1 || concurrentChats > 4) throw new HttpError(400, 'Parallel chats must be 1 to 4.');
  return { nodeIds: [...new Set(nodeIds)], chat, files, sharedFiles, concurrentChats, deploy };
}
function changeMembers(change) {
  const own = accessToChange();
  const members = change(structuredClone(Array.isArray(own.members) ? own.members : []));
  writePrivate(ACCESS_FILE, { ...own, members });
  accessCache = null;
  ownAccess(); // read it back: a write that reads fine becomes the last good copy
  return members;
}
function changeAccess(change) {
  const own = accessToChange();
  const next = change(structuredClone(own));
  writePrivate(ACCESS_FILE, next);
  accessCache = null;
  ownAccess(); // read it back: a write that reads fine becomes the last good copy
  return next;
}
// Approving someone who asked: one of three starting points (the owner can fine-tune it after, as for anyone).
const ACCESS_PRESETS = {
  look: { chat: false, files: 'none', sharedFiles: 'read', deploy: false },
  chat: { chat: true, files: 'write', sharedFiles: 'read', deploy: false },
  run: { chat: true, files: 'write', sharedFiles: 'write', deploy: true },
};
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
// Someone on the tailnet who isn't on the list asks to be let in; the owner sees it on Access → People.
// From the public page (no Tailscale identity yet) it's the email they'll sign in with, so it's marked unverified:
// Tailscale checks that email when they sign in, and only then does the access apply.
// Public asks: at most 10 waiting, each kept a week, and they never push out or overwrite someone who asked from the
// tailnet. Whatever the list holds, a public ask gets the same answer, so it can't be used to learn who has access.
const askHits = new Map();
function askAccess(login, name, note, verified, from) {
  if (!LOGIN_RE.test(login) || login.length > 200) throw new HttpError(400, 'Enter the email you sign in to Tailscale with.');
  if (!verified && (overLimit(askHits, from, 3600000, 3) || overLimit(askHits, '*', 3600000, 20))) throw new HttpError(429, 'Too many requests right now. Try again later.');
  const a = accessList(), lc = login.toLowerCase();
  if (lc === String(a.owner || '').toLowerCase() || a.members.some(u => u.login.toLowerCase() === lc)) {
    if (verified) throw new HttpError(409, 'You already have access. Reload the page.');
    return;
  }
  changeAccess(own => {
    const week = Date.now() - 7 * 86400000;
    let list = (Array.isArray(own.requests) ? own.requests : []).filter(r => r.verified || Date.parse(r.at) > week);
    const before = list.find(r => r.login.toLowerCase() === lc);
    if (before && (before.verified || !verified)) {
      if (verified && Date.now() - Date.parse(before.at) < 10 * 60000) throw new HttpError(429, 'You’ve asked already. The owner will see it on Access → People.');
      if (!verified) return own;
    }
    list = list.filter(r => r !== before);
    const unverified = list.filter(r => !r.verified);
    if (!verified && unverified.length >= 10) return own;
    if (verified && list.length >= 30) {
      if (!unverified.length) throw new HttpError(429, 'Too many people are waiting. Ask the owner directly.');
      list = list.filter(r => r !== unverified[0]);
    }
    return { ...own, requests: [...list, { login, name, note, verified, at: new Date().toISOString() }] };
  });
}
// Someone whose access changed reconnects their live view, so it's re-checked straight away.
function disconnectViewer(login) {
  for (const client of clients) if (client.viewer.login === login) client.res.end();
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
// Someone on the access list, by their login: the owner or a member.
function viewerForLogin(login) {
  const a = accessList(), same = (x, y) => String(x || '').toLowerCase() === String(y || '').toLowerCase();
  if (a.owner) {
    const member = same(login, a.owner) ? null : a.members.find(u => same(u.login, login));
    if (!same(login, a.owner) && !member) { authProblem = `${login} doesn’t have access`; return null; }
    authProblem = null;
    const permissions = member ? member.permissions : ownerPermissions();
    return { login, role: member ? 'member' : 'owner', nodeIds: member ? permissions.nodeIds || [] : null, chat: !member || permissions.chat === true, permissions };
  }
  authProblem = `No owner is set up in ${ACCESS_FILE}`;
  return null;
}
// Everyone sees the whole fleet (read-only). Acting on a Spark needs it to be theirs: the owner's are all of them, a
// member's are the ones shared with them. Running or stopping models also needs the owner's go-ahead (permissions.deploy).
const canUse = (viewer, nodeId) => !viewer.nodeIds || viewer.nodeIds.includes(nodeId);
const canManage = viewer => viewer.role === 'owner' || viewer.permissions?.deploy === true;
function mustUse(viewer, ids) {
  if (!canManage(viewer)) throw new HttpError(403, 'Running and stopping models isn’t enabled for your account. Ask the owner.');
  const other = ids.find(id => !canUse(viewer, id));
  if (other) throw new HttpError(403, `${sparkName(nodeById(other) || { id: other })} isn’t shared with you.`);
}

// This machine's own addresses, so the portal host's entry runs commands locally instead of over SSH.
const LOCAL_IPS = new Set();
spawn('bash', ['-c', 'tailscale ip 2>/dev/null; hostname -I 2>/dev/null']).stdout
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

