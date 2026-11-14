// Spark Console: one place to run, watch and share a fleet of DGX Sparks, over the Spark Console service (/console/api).
'use strict';

/* ───────── config ───────── */
// Hardware the API doesn't report. Sparks not listed here show as "DGX Spark".
const HARDWARE = { spark4: 'MSI EdgeXpert' };
// The assistant's name. It stays the same whichever model powers it.
const ASSISTANT = 'Sparkie';
const POLL_MS = 15000;
const BOOT_POLL_MS = 60000;
const STALE_MS = 90000;
const HISTORY_POINTS = 90;
const LIVE_POINTS = 300;
const HISTORY_MAX_AGE_MS = 45 * 60 * 1000;
// How a job ends. ('started' and 'running' are under way; 'interrupted' means a restart of Spark Console cut it off.)
const TERMINAL = new Set(['completed', 'partial', 'failed', 'interrupted']);
const underWay = j => !TERMINAL.has(j.status);
const STORE = { theme: 'spark-console:theme', history: 'spark-console:history' };
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
// Spark Console's service on Spark 2. The same address whether the page is opened at / or at /console/.
const CONSOLE_API = '/console/api/';
// The install script replaces 'dev' with a hash of the shipped UI files and writes the same hash to version.json.
const BUILD = 'dev';

/* ───────── DOM helpers ───────── */
const $ = (sel, root = document) => root.querySelector(sel);
const SVG_NS = 'http://www.w3.org/2000/svg';

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  let late;
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style') for (const [prop, v] of Object.entries(value)) el.style.setProperty(prop, v);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'value' || key === 'checked') {
      (late ||= {})[key] = value;
      // Also as an attribute, so redraw() can tell two versions of a field apart.
      if (key === 'value') el.setAttribute('value', value); else if (value) el.setAttribute('checked', '');
    }
    else el.setAttribute(key, value === true ? '' : value);
  }
  add(el, kids);
  if (late) Object.assign(el, late);
  return el;
}

// Like replaceChildren/append, but skips null/false and flattens arrays.
const set = (el, ...kids) => { el.replaceChildren(); return add(el, kids); };
const put = (el, ...kids) => add(el, kids);
// For parts drawn again on every refresh. A redraw that comes out the same leaves the page alone, so focus, open
// sections, text selection and scroll stay put. One that changes keeps what had focus (and what was typed in it) and
// the sections opened by hand.
const sameAs = el => `${el.tagName}|${el.getAttribute('aria-label') || el.textContent.trim().replace(/\s+/g, ' ').slice(0, 80)}`;
function redraw(el, ...kids) {
  const list = kids.flat(Infinity).filter(k => k != null && k !== false);
  // Already-built parts handed back in (cards that update themselves): only re-order them when needed.
  if (list.some(k => k instanceof Node && k.parentNode === el)) {
    list.forEach((k, i) => {
      const cur = el.childNodes[i], node = k instanceof Node ? k : document.createTextNode(String(k));
      if (cur !== node) { if (cur) el.insertBefore(node, cur); else el.append(node); }
    });
    while (el.childNodes.length > list.length) el.lastChild.remove();
    return el;
  }
  const next = add(document.createDocumentFragment(), list);
  const opened = new Set([...el.querySelectorAll('details[open] > summary')].map(sameAs));
  for (const sum of next.querySelectorAll('details > summary')) if (opened.has(sameAs(sum))) sum.parentNode.open = true;
  const now = [...el.childNodes], fresh = [...next.childNodes];
  if (now.length === fresh.length && now.every((n, i) => n.isEqualNode(fresh[i]))) return el;
  const had = el.contains(document.activeElement) ? document.activeElement : null;
  const key = had && sameAs(had), nth = had ? [...el.querySelectorAll(had.tagName)].filter(x => sameAs(x) === key).indexOf(had) : -1;
  const typed = had && ['INPUT', 'TEXTAREA'].includes(had.tagName) ? [had.value, had.selectionStart, had.selectionEnd] : null;
  el.replaceChildren(next);
  const back = had && [...el.querySelectorAll(had.tagName)].filter(x => sameAs(x) === key)[Math.max(0, nth)];
  if (back) {
    if (typed) { back.value = typed[0]; try { back.setSelectionRange(typed[1], typed[2]); } catch {} }
    back.focus({ preventScroll: true });
  }
  return el;
}

function add(el, kids) {
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}

function svg(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

const ICONS = {
  grid: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
  chip: 'M9 2v2 M15 2v2 M9 20v2 M15 20v2 M2 9h2 M2 15h2 M20 9h2 M20 15h2 M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M9 9h6v6H9z',
  box: 'M21 8 12 3 3 8v8l9 5 9-5z M3 8l9 5 9-5 M12 13v8',
  chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  terminal: 'M4 17l6-6-6-6 M12 19h8',
  code: 'M16 18l6-6-6-6 M8 6l-6 6 6 6',
  play: 'M7 4.5v15l12-7.5z',
  stop: 'M6 6h12v12H6z',
  refresh: 'M21 12a9 9 0 1 1-2.64-6.36 M21 3v6h-6',
  external: 'M15 3h6v6 M10 14 21 3 M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  copy: 'M9 9h11v11H9z M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.35-4.35',
  chevronRight: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  chevronLeft: 'M15 18l-6-6 6-6',
  more: 'F:M5 10.4a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z M12 10.4a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z M19 10.4a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z M12 1v2 M12 21v2 M4.22 4.22l1.42 1.42 M18.36 18.36l1.42 1.42 M1 12h2 M21 12h2 M4.22 19.78l1.42-1.42 M18.36 5.64l1.42-1.42',
  moon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
  monitor: 'M3 4h18v12H3z M8 20h8 M12 16v4',
  power: 'M18.36 6.64a9 9 0 1 1-12.73 0 M12 2v10',
  thermo: 'M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z',
  zap: 'M13 2 3 14h9l-1 8 10-12h-9z',
  layers: 'M12 2 2 7l10 5 10-5z M2 17l10 5 10-5 M2 12l10 5 10-5',
  check: 'M20 6 9 17l-5-5',
  checkCircle: 'M22 11.08V12a10 10 0 1 1-5.93-9.14 M22 4 12 14.01l-3-3',
  alert: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01',
  x: 'M18 6 6 18 M6 6l12 12',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6',
  image: 'M3 3h18v18H3z M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M21 15l-5-5L5 21',
  plus: 'M12 5v14 M5 12h14',
  logs: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
  clipboard: 'M9 2h6v4H9z M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2 M9 14l2 2 4-4',
  link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  send: 'M22 2 11 13 M22 2l-7 20-4-9-9-4z',
  sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z M19 15v4 M17 17h4',
  server: 'M3 4h18v7H3z M3 13h18v7H3z M7 7.5h.01 M7 16.5h.01',
  network: 'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M8.59 13.51l6.83 3.98 M15.41 6.51l-6.82 3.98',
  trash: 'M3 6h18 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6',
  edit: 'M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  menu: 'M3 6h18 M3 12h18 M3 18h18',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2',
  lock: 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4',
  disk: 'M22 12H2 M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z M6 16h.01 M10 16h.01',
  wifiOff: 'M1 1l22 22 M16.72 11.06A10.94 10.94 0 0 1 19 12.55 M5 12.55a10.94 10.94 0 0 1 5.17-2.39 M10.71 5.05A16 16 0 0 1 22.58 9 M1.42 9a15.91 15.91 0 0 1 4.7-2.88 M8.53 16.11a6 6 0 0 1 6.95 0 M12 20h.01',
  arrowRight: 'M5 12h14 M12 5l7 7-7 7',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20 M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
  key: 'M21 2l-2 2 M15.5 7.5l3 3L22 7l-3-3 M15.5 7.5l-4.1 4.1 M7.5 22a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11z',
};

function icon(name, cls = '') {
  let d = ICONS[name] || ICONS.box;
  const filled = d.startsWith('F:');
  if (filled) d = d.slice(2);
  const el = svg('svg', { viewBox: '0 0 24 24', class: `icon${filled ? ' filled' : ''}${cls ? ' ' + cls : ''}`, 'aria-hidden': 'true' });
  el.append(svg('path', { d }));
  return el;
}

/* ───────── formatting ───────── */
const num = v => typeof v === 'number' && Number.isFinite(v);
const GB_PER_GIB = 2 ** 30 / 1e9;
const sum = (list, key) => list.reduce((total, item) => total + (num(item[key]) ? item[key] : 0), 0);
const cap = s => String(s || '').replace(/^\w/, c => c.toUpperCase());
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// The API reports temperatures in Celsius; they're shown in Fahrenheit.
const toF = c => (num(c) ? (c * 9) / 5 + 32 : c);
const fmt = {
  pct: v => (num(v) ? `${Math.round(v)}%` : '—'),
  // Memory and disk arrive in GiB; everything is shown in GB, the unit model sizes use.
  gib: v => (num(v) ? (x => (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1)))(v * GB_PER_GIB) : '—'),
  watts: v => (num(v) ? `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} W` : '—'),
  temp: v => (num(v) ? `${Math.round(toF(v))}°F` : '—'),
  load: v => (num(v) ? v.toFixed(2) : '—'),
  disk: gib => (!num(gib) ? '—' : gib * GB_PER_GIB >= 1000 ? `${(gib * GB_PER_GIB / 1000).toFixed(1)} TB` : `${Math.round(gib * GB_PER_GIB)} GB`),
  bytes(n) {
    if (!num(n)) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (n >= 1000 && i < units.length - 1) { n /= 1000; i++; }
    return `${i ? n.toFixed(n >= 10 ? 0 : 1) : n} ${units[i]}`;
  },
  uptime(s) {
    if (!num(s)) return '—';
    const d = Math.floor(s / 86400), hr = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d ? `${d}d ${hr}h` : hr ? `${hr}h ${m}m` : `${m}m`;
  },
  ago(t) {
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 5) return 'just now';
    if (s < 60) return `${s}s ago`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const hr = Math.round(m / 60);
    return hr < 24 ? `${hr}h ago` : `${Math.round(hr / 24)}d ago`;
  },
  time(v) {
    const d = new Date(v);
    return isNaN(d) ? '—' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  },
  when(v) {
    const d = new Date(typeof v === 'number' && v < 1e12 ? v * 1000 : v);
    if (isNaN(d)) return '—';
    return d.toDateString() === new Date().toDateString()
      ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  },
};
// A Spark's smart plug (deploy/plugs.sh), when it has one: has is a current wall reading; words says what the plug
// shows for a Spark that isn't answering (its plug off, shut down, or powered but not answering).
const wallState = n => {
  const w = n?.wall, live = Boolean(w?.answering) && !isStale();
  const words = !live ? null : w.on === false ? 'Its smart plug is off, so it has no power.'
    : num(w.watts) && w.watts < 15 ? `Shut down: its plug is on and it draws ${fmt.watts(w.watts)}.`
    : num(w.watts) ? `Powered on (${fmt.watts(w.watts)} at the wall) but Spark Console can’t reach it over Tailscale.` : null;
  return { has: live && num(w.watts), words };
};

function initials(name) {
  return String(name || '?').split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('') || '?';
}

/* ───────── state ───────── */
const state = {
  boot: null,
  status: null,
  statusError: null,
  lastOk: 0,
  loadingStatus: false,
  connections: null,
  hist: new Map(),
  lastSampleKey: null,
  recentJobs: null,
  jobs: new Map(),
  following: new Map(),
  machine: new Map(),
  chat: { conv: null, spark: null, model: null, sending: false, waiting: false, search: '', pendingPrompt: null, draft: '' },
  files: { node: null, area: 'personal', path: '', entries: null, total: 0, nextOffset: null, busy: false, error: null, epoch: 0, editorPath: null },
  memberPreview: false,
  live: new Map(),
  liveHist: new Map(),
  liveOn: false,
  lib: { data: null, error: null, missing: false, loading: false, at: 0 },
  recipes: { data: null, error: null, missing: false, loading: false },
  fabric: { sparks: null, pairs: null, checkedAt: null, error: null, missing: false, outdated: false, loading: false, checking: false },
  main: { data: null, error: null },
  consoleChats: null,
  access: null,
  passkeys: null,
  recipeQuery: '',
  recipeFilter: 'All',
  recipeKind: 'all',
  recipeOpen: new Set(),
  recipeSearch: null,
  svcJobs: new Map(),
};

const realOwner = () => state.boot?.viewer?.role === 'owner';
const owner = () => realOwner() && !state.memberPreview;
function perms() {
  // Preview: a member who uses one Spark (the first online one) and may run models there.
  if (state.memberPreview) {
    const up = id => (state.status?.nodes || []).some(s => s.id === id && s.reachable && s.state === 'online');
    const first = (state.boot?.nodes || []).find(n => up(n.id)) || state.boot?.nodes?.[0];
    return { chat: true, deploy: true, files: 'write', sharedFiles: 'write', nodeIds: first ? [first.id] : [] };
  }
  return state.boot?.viewer?.permissions || {};
}
const canChat = () => owner() || Boolean(perms().chat);
const canFiles = () => owner() || ['read', 'write'].includes(perms().files) || ['read', 'write'].includes(perms().sharedFiles);
// Everyone sees the whole fleet. A member acts only on the Sparks shared with them ("mine"), and runs or stops models
// there only if the owner allowed it; the service enforces the same rules. Elsewhere their buttons are hidden.
const mine = id => owner() || (perms().nodeIds || []).includes(id);
const canRun = () => owner() || perms().deploy === true;
const canActOn = (...ids) => canRun() && ids.every(mine);
const fileAccess = () => (owner() ? 'write' : perms()[state.files.area === 'shared' ? 'sharedFiles' : 'files'] || 'none');

// Every Spark, for everyone (members only act on theirs; see mine()).
function nodes() {
  return (state.boot?.nodes || [])
    .map(n => withLive({ ...n, ...(state.status?.nodes || []).find(s => s.id === n.id) }));
}
// Fresh samples from the live stream (about one a second) override the slower status numbers.
function withLive(n) {
  const s = state.live.get(n.id);
  if (!s?.online || Date.now() - s.at > 5000) return n;
  const GiB = 2 ** 30;
  return {
    ...n,
    gpuUtilization: s.gpu ?? n.gpuUtilization, gpuPowerWatts: s.power ?? n.gpuPowerWatts, temperature: s.temp ?? n.temperature,
    ...(num(s.memTotal) && num(s.memAvailable) ? { memoryTotalGiB: s.memTotal / GiB, memoryFreeGiB: s.memAvailable / GiB } : {}),
  };
}
const node = id => nodes().find(n => n.id === id);
const nodeName = id => state.boot?.nodes?.find(n => n.id === id)?.name || id;
const isStale = () => Boolean(state.status && Date.now() - Date.parse(state.status.updatedAt) > STALE_MS);
const isUp = n => Boolean(n && state.status && n.reachable && n.state === 'online' && !isStale());
// What's running on a Spark: its containers. (The old portal's Ray runtime isn't used; models across Sparks run on vLLM.)
// What a container runs, in words: a started model by its title, Sparkie's model by name, a model server started
// elsewhere by the model it answers with, anything else by its name (the service doesn't know what it runs).
const repoKey = r => String(r || '').toLowerCase();
const modelTitle = m => m.manifest?.title || m.repo || m.name;
function containerTitle(name) {
  const c = String(name || ''), lib = state.lib.data, main = state.main.data;
  if (c === 'sparkie-main') return main?.title ? `${main.title} (${ASSISTANT})` : `${ASSISTANT}’s model`;
  const dep = lib?.sparks?.flatMap(sp => sp.deployments || []).find(x => x.container === c || `${x.container}-part2` === c);
  const m = dep && lib.library.find(x => x.name === dep.model);
  if (m) return modelTitle(m);
  const ext = lib?.sparks?.flatMap(sp => sp.external || []).find(x => x.container === c);
  if (ext?.models?.length) return ext.models.map(id => (libFor(id) ? modelTitle(libFor(id)) : String(id).split('/').pop())).join(', ');
  return /^sc-/.test(c) ? c.replace(/^sc-/, '').replace(/-part2$/, '').replace('--', '/') : c;
}
// What's running on a Spark, by name (a model across two Sparks shows once).
const workloads = n => [...new Set((n?.runningContainers || []).map(containerTitle))];
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function condition(n) {
  if (!n || !state.status) return 'unknown';
  if (!n.reachable || n.state !== 'online') return 'offline';
  if (isStale()) return 'stale';
  if (n.issues?.length) return 'degraded';
  if ((n.gpuUtilization || 0) >= 5) return 'busy';
  if (workloads(n).length) return 'running';
  return 'idle';
}
const COND = {
  running: ['Running', 'ok'],
  busy: ['Busy', 'ok'],
  idle: ['Idle', 'good'],
  degraded: ['Needs attention', 'warn'],
  stale: ['Out of date', 'warn'],
  offline: ['Offline', 'bad'],
  unknown: ['Checking', ''],
};
const pill = (label, kind = '') => h('span', { class: `pill ${kind}` }, label);
const condPill = cond => pill(...COND[cond]);
const led = cond => h('span', { class: 'led', dataset: { cond } });

const conn = id => state.connections?.nodes?.find(c => c.id === id);
function portalHostId() {
  try {
    const host = new URL(state.connections.portalUrl).hostname.split('.')[0];
    return state.connections.nodes.find(c => c.alias === host)?.id || null;
  } catch {
    return null;
  }
}
const hardware = n => `${HARDWARE[n.id] || 'DGX Spark'} · ${String(n.gpu || 'NVIDIA GB10').replace(/^NVIDIA\s+/, '')}`;
const editorUrl = n => n.editorPath || `${CONSOLE_API}connect/${n.id}/`;
const sshCommand = id => (conn(id) ? `ssh ${conn(id).alias || `${conn(id).user}@${conn(id).ip}`}` : null);
const sshDirect = id => (conn(id) ? `ssh ${conn(id).user}@${conn(id).ip}` : null);
function desktopUrl(id, scheme) {
  const c = conn(id);
  return c ? `${scheme}://vscode-remote/ssh-remote+${encodeURIComponent(c.alias || c.ip)}/home/${encodeURIComponent(c.user)}` : null;
}

/* ───────── API ───────── */

// Who you are, your Sparks and what you can do.
const loadBoot = () => capi('bootstrap');

async function loadStatus(fresh = false) {
  if (state.loadingStatus && !fresh) return;
  state.loadingStatus = true;
  try {
    const status = await capi(fresh && realOwner() ? 'status?fresh=1' : 'status');
    state.status = status;
    state.lastOk = Date.now();
    state.statusError = null;
    recordHistory(status);
  } catch (e) {
    state.statusError = e.message;
    // This device was signed out (elsewhere, or after 60 idle days): back to the public page and Sign in.
    if (e.status === 401 && state.boot?.session) location.reload();
  } finally {
    state.loadingStatus = false;
    runLive();
    tickLive();
  }
}

// Sparkie's model and the chats with it.
async function loadMain() {
  try {
    state.main.data = await capi('main');
    state.main.error = null;
  } catch (e) {
    state.main.error = e.message;
  }
  runLive();
}

async function loadConsoleChats() {
  if (!canChat()) return;
  try { state.consoleChats = (await capi('chats')).chats; state.chatsError = null; } catch (e) { state.consoleChats ||= []; state.chatsError = e.message; }
  runLive();
}

async function refreshBoot() {
  try {
    state.boot = await loadBoot();
    runLive();
  } catch (e) {
    if (e.status === 401 && state.boot?.session) location.reload();
  }
}

async function loadConnections() {
  if (!realOwner()) return;
  try {
    state.connections = await capi('connections');
    state.connectionsError = null;
  } catch (e) {
    state.connections = null;
    state.connectionsError = e.message;
  }
  runLive();
}

// Recent operations: deploys, Sparkie's model, Spark actions.
async function loadJobs() {
  try {
    const { jobs = [], notices = [] } = await capi('jobs');
    state.notices = notices;
    state.recentJobs = jobs.map(j => ({ ...j, console: true, nodeIds: j.node ? [j.node] : [], message: underWay(j) ? j.step : null }))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 40);
  } catch (e) { state.recentJobs ||= []; state.jobsError = e.message; }
  runLive();
}
// Activity: the jobs followed on this page (freshest) merged with the recent ones the service keeps, newest first.
function activityJobs() {
  const byId = new Map((state.recentJobs || []).map(j => [j.id, j]));
  for (const j of state.svcJobs.values()) byId.set(j.id, { ...byId.get(j.id), ...j, console: true, nodeIds: j.node ? [j.node] : j.nodes || [] });
  return [...byId.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
// A library model by its Hugging Face name.
const libFor = repo => (state.lib.data?.library || []).find(m => repoKey(m.repo || m.name.replace('--', '/')) === repoKey(repo));
// Who started a job: you (on this page), Sparkie, one of your agents, Auto-restart, or (for the owner) a member.
function whoKey(j) {
  if (j.via === 'watcher') return 'auto';
  if (j.via === 'sparkie') return 'sparkie';
  if (j.via === 'agent') return `agent:${j.actor || 'An agent'}`;
  const me = repoKey(state.boot?.viewer?.login);
  return j.by && me && repoKey(j.by) !== me ? `person:${j.by}` : 'you';
}
const whoName = key => (key === 'you' ? 'You' : key === 'sparkie' ? ASSISTANT : key === 'auto' ? 'Auto-restart' : key.slice(key.indexOf(':') + 1));

/* ───────── history (client-side samples for sparklines) ───────── */
function loadHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE.history) || '{}');
    const cutoff = Date.now() - HISTORY_MAX_AGE_MS;
    for (const [id, points] of Object.entries(raw)) {
      if (Array.isArray(points)) state.hist.set(id, points.filter(p => p && p.t > cutoff).slice(-HISTORY_POINTS));
    }
  } catch {}
}

function saveHistory() {
  try { localStorage.setItem(STORE.history, JSON.stringify(Object.fromEntries(state.hist))); } catch {}
}

function pushSample(id, point) {
  const list = state.hist.get(id) || [];
  if (list.length && list[list.length - 1].t >= point.t) return;
  list.push(point);
  while (list.length > HISTORY_POINTS) list.shift();
  state.hist.set(id, list);
}

function recordHistory(status) {
  if (!status?.updatedAt || status.updatedAt === state.lastSampleKey) return;
  state.lastSampleKey = status.updatedAt;
  const t = Date.parse(status.updatedAt) || Date.now();
  let power = 0, mem = 0, any = false;
  for (const n of status.nodes || []) {
    if (!n.reachable) continue;
    const used = num(n.memoryTotalGiB) && num(n.memoryFreeGiB) ? n.memoryTotalGiB - n.memoryFreeGiB : null;
    pushSample(n.id, { t, gpu: n.gpuUtilization, power: n.gpuPowerWatts, temp: n.temperature, mem: used });
    if (num(n.gpuPowerWatts)) { power += n.gpuPowerWatts; any = true; }
    if (num(used)) mem += used;
  }
  if (any) pushSample('_fleet', { t, power, mem });
  saveHistory();
}

const historyFor = id => (state.liveHist.get(id)?.length >= 2 ? state.liveHist.get(id) : state.hist.get(id) || []);
const series = (id, key) => historyFor(id).map(p => p[key]).filter(num);
function windowLabel(id) {
  const points = historyFor(id);
  if (points.length < 2) return isUp(node(id)) ? 'collecting…' : 'offline';
  const secs = (points[points.length - 1].t - points[0].t) / 1000;
  return secs < 90 ? `last ${Math.max(1, Math.round(secs))} s` : `last ${Math.round(secs / 60)} min`;
}

function sparkline(values, { min = 0, max, cls = '', label = 'Trend' } = {}) {
  const W = 100, H = 30;
  const el = svg('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', class: `spark ${cls}`, role: 'img', 'aria-label': label });
  const vals = values.slice(-LIVE_POINTS);
  if (vals.length < 2) {
    el.append(svg('line', { x1: 0, y1: H - 1, x2: W, y2: H - 1, class: 'base' }));
    return el;
  }
  const hi = Math.max(max ?? -Infinity, ...vals), lo = Math.min(min, ...vals), span = hi - lo || 1;
  const pts = vals.map((v, i) => [(i / (vals.length - 1)) * W, H - 1.5 - ((v - lo) / span) * (H - 4)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ');
  el.append(svg('path', { d: `${line} L${W} ${H} L0 ${H} Z`, class: 'area' }), svg('path', { d: line, class: 'line' }));
  return el;
}

function bar(fraction) {
  const f = Math.max(0, Math.min(1, fraction || 0));
  return h('div', { class: `bar${f > 0.95 ? ' bad' : ''}` }, h('span', { style: { width: `${(f * 100).toFixed(1)}%` } }));
}

/* ───────── live bindings ───────── */
// live(fn) runs fn now and again whenever fresh data arrives. View bindings reset on every route change.
let viewLive = [];
const shellLive = [];
function live(fn, list = viewLive) {
  list.push(fn);
  try { fn(); } catch (e) { console.error(e); }
}
function runLive() {
  for (const fn of [...shellLive, ...viewLive]) {
    try { fn(); } catch (e) { console.error(e); }
  }
  runFast();
}
// fast(fn) also runs on every live metric tick. Use it only to update numbers, bars and graphs in place,
// so they glide instead of being rebuilt.
let viewFast = [];
const shellFast = [];
function fast(fn, list = viewFast) {
  list.push(fn);
  try { fn(); } catch (e) { console.error(e); }
}
function runFast() {
  for (const fn of [...shellFast, ...viewFast]) {
    try { fn(); } catch (e) { console.error(e); }
  }
}
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)');
// Ease a number from what's shown to its new value.
function glide(el, to, decimals = 0) {
  if (!el) return;
  cancelAnimationFrame(el.glideFrame);
  if (!num(to)) { el.textContent = '—'; el.glideValue = null; return; }
  const from = num(el.glideValue) ? el.glideValue : to;
  el.glideValue = to;
  if (from === to || REDUCED_MOTION.matches) { el.textContent = to.toFixed(decimals); return; }
  const start = performance.now();
  const frame = now => {
    const k = Math.min(1, (now - start) / 700);
    el.textContent = (from + (to - from) * (1 - (1 - k) ** 3)).toFixed(decimals);
    if (k < 1) el.glideFrame = requestAnimationFrame(frame);
  };
  el.glideFrame = requestAnimationFrame(frame);
}

/* ───────── live metrics stream ───────── */
// The service samples each Spark once a second while this page is open and visible; hidden tabs disconnect.
let liveSource = null, liveRetry = null, liveFrame = 0, lastFast = 0;
function connectLive() {
  if (liveSource || document.hidden) return;
  clearTimeout(liveRetry);
  const source = new EventSource(`${CONSOLE_API}metrics`);
  liveSource = source;
  source.onopen = () => { state.liveOn = true; tickLive(); };
  source.onmessage = e => {
    let sample;
    try { sample = JSON.parse(e.data); } catch { return; }
    onSample(sample);
  };
  source.onerror = () => {
    state.liveOn = false;
    if (source.readyState === EventSource.CLOSED) {
      liveSource = null;
      liveRetry = setTimeout(connectLive, 30000);
    }
    tickLive();
  };
}
function disconnectLive() {
  clearTimeout(liveRetry);
  liveSource?.close();
  liveSource = null;
  state.liveOn = false;
}
function onSample(sample) {
  const at = Date.now();
  state.live.set(sample.node, { ...sample, at });
  if (sample.online) {
    const list = state.liveHist.get(sample.node) || [];
    const mem = num(sample.memTotal) && num(sample.memAvailable) ? (sample.memTotal - sample.memAvailable) / 2 ** 30 : null;
    list.push({ t: at, gpu: sample.gpu, power: sample.power, temp: sample.temp, mem });
    if (list.length > LIVE_POINTS) list.shift();
    state.liveHist.set(sample.node, list);
  }
  if (!liveFrame) liveFrame = setTimeout(() => requestAnimationFrame(() => { liveFrame = 0; lastFast = Date.now(); runFast(); tickLive(); }), Math.max(0, 1000 - (Date.now() - lastFast)));
}
const liveFresh = () => state.liveOn && [...state.live.values()].some(s => s.online && Date.now() - s.at < 3000);

/* ───────── feedback: toasts, menus, dialogs, drawers ───────── */
const dismissedToasts = new Set();
function toast(message, { kind = 'ok', sub, timeout = 4200, id } = {}) {
  const host = $('#toasts');
  if (!host) return null;
  let el = id ? host.querySelector(`[data-id="${CSS.escape(id)}"]`) : null;
  // Progress: the same toast updates in place, quietly (its line isn't read out on every update).
  if (el && kind === 'busy' && el.classList.contains('busy')) {
    redraw(el.querySelector('.toast-text'), message, sub ? h('small', { 'aria-live': 'off' }, sub) : null);
    return el;
  }
  const glyph = kind === 'busy' ? h('span', { class: 'spinner sm' }) : icon(kind === 'bad' ? 'alert' : kind === 'info' ? 'lock' : 'checkCircle');
  const content = [
    glyph,
    h('div', { class: 'toast-text' }, message, sub ? h('small', kind === 'busy' ? { 'aria-live': 'off' } : {}, sub) : null),
    h('button', { class: 'btn ghost sm icon-only', type: 'button', 'aria-label': 'Dismiss', onclick: () => { if (id) dismissedToasts.add(id); el.remove(); } }, icon('x')),
  ];
  if (el) { set(el, ...content); el.setAttribute('role', kind === 'bad' ? 'alert' : 'none'); }
  else {
    // The timer waits while the pointer is on the toast or focus is in it.
    el = h('div', {
      class: 'toast', role: kind === 'bad' ? 'alert' : 'none',
      onmouseenter: () => clearTimeout(el.dismissTimer), onfocusin: () => clearTimeout(el.dismissTimer),
      onmouseleave: () => armToast(el), onfocusout: e => { if (!el.contains(e.relatedTarget)) armToast(el); },
    }, content);
    host.append(el);
  }
  el.className = `toast ${kind}`;
  if (id) el.dataset.id = id;
  el.dismissAfter = timeout;
  armToast(el);
  return el;
}
function armToast(el) {
  clearTimeout(el.dismissTimer);
  const held = el.matches(':hover') || el.contains(document.activeElement);
  if (el.dismissAfter && !held) el.dismissTimer = setTimeout(() => el.remove(), el.dismissAfter);
}

async function copy(text, message = 'Copied to clipboard') {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
    return true;
  } catch {
    toast('Clipboard is unavailable here. Select the text and copy it.', { kind: 'bad' });
    return false;
  }
}

// Something that didn't go through, as a toast. A change the passkey didn't confirm isn't a fault, so it's said calmly
// (with a link when it can be done at another address).
function failToast(e) {
  const link = e?.link ? h('a', { class: 'btn sm', href: e.link.href, style: { 'margin-top': '6px' } }, icon('arrowRight'), e.link.label) : null;
  toast(e?.message || String(e), { kind: e?.calm ? 'info' : 'bad', sub: link, timeout: 9000 });
}

async function busy(btn, fn) {
  if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
  try {
    return await fn();
  } catch (e) {
    failToast(e);
  } finally {
    if (btn?.isConnected) { btn.disabled = false; btn.removeAttribute('aria-busy'); }
  }
}

let openMenuEl = null;
function closeMenus() {
  if (!openMenuEl) return;
  openMenuEl.anchor?.setAttribute('aria-expanded', 'false');
  openMenuEl.remove();
  openMenuEl = null;
}

function openMenu(anchor, items, align = 'end') {
  if (openMenuEl?.anchor === anchor) return closeMenus();
  closeMenus();
  const menu = h('div', { class: 'menu', role: 'menu' });
  for (const item of items) {
    if (!item) continue;
    if (item === 'sep') { menu.append(h('div', { class: 'menu-sep', role: 'separator' })); continue; }
    if (item.heading) { menu.append(h('div', { class: 'menu-label' }, item.heading)); continue; }
    const tag = item.href && !item.disabled ? 'a' : 'button';
    const el = h(tag, {
      class: `menu-item${item.danger ? ' danger' : ''}`,
      role: 'menuitem',
      type: tag === 'button' ? 'button' : null,
      href: tag === 'a' ? item.href : null,
      target: tag === 'a' && item.external ? '_blank' : null,
      rel: tag === 'a' && item.external ? 'noopener noreferrer' : null,
      disabled: tag === 'button' && item.disabled,
      title: item.title,
    }, icon(item.icon || 'chevronRight'), h('span', {}, item.label), item.hint ? h('span', { class: 'hint' }, item.hint) : null);
    el.addEventListener('click', e => {
      closeMenus();
      if (anchor.isConnected) anchor.focus({ preventScroll: true });
      if (item.onSelect) { e.preventDefault(); item.onSelect(); }
    });
    menu.append(el);
  }
  menu.addEventListener('keydown', e => {
    const list = [...menu.querySelectorAll('.menu-item:not(:disabled)')];
    const i = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    if (e.key === 'Escape') { e.preventDefault(); closeMenus(); anchor.focus(); }
    if (e.key === 'Tab') { e.preventDefault(); closeMenus(); anchor.focus(); }
  });
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(align === 'end' ? r.right - menu.offsetWidth : r.left, innerWidth - menu.offsetWidth - 8));
  let top = r.bottom + 6;
  if (top + menu.offsetHeight > innerHeight - 8) top = Math.max(8, r.top - menu.offsetHeight - 6);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.anchor = anchor;
  anchor.setAttribute('aria-expanded', 'true');
  openMenuEl = menu;
  menu.querySelector('.menu-item:not(:disabled)')?.focus({ preventScroll: true });
}

const menuButton = (items, { label = 'More actions', cls = 'btn ghost sm icon-only', iconName = 'more', text } = {}) =>
  h('button', { class: cls, type: 'button', 'aria-label': label, 'aria-haspopup': 'menu', title: label, onclick: e => openMenu(e.currentTarget, typeof items === 'function' ? items() : items) },
    icon(iconName), text || null);

// dismissable: false keeps it open on Esc and backdrop clicks (only its own buttons close it). focus: what gets focus first.
// While onConfirm runs, nothing closes it: what it creates (a key shown once, say) must reach the next step.
// setup gets the confirm button, the dialog, and done(value), which closes it with that answer.
function dialog({ title, description, body, confirm = 'OK', cancel = 'Cancel', danger = false, wide = false, onConfirm, setup, dismissable = true, focus = null }) {
  return new Promise(resolve => {
    const error = h('p', { class: 'form-error', role: 'alert', hidden: true }), descId = `dlg-${Math.random().toString(36).slice(2, 9)}`;
    const ok = h('button', { class: `btn ${danger ? 'danger-solid' : 'primary'}`, type: 'submit' }, confirm);
    const cancelBtn = cancel ? h('button', { class: 'btn', type: 'button', onclick: () => { if (!pending) finish(null); } }, cancel) : null;
    const form = h('form', { novalidate: true },
      h('div', { class: 'modal-head' }, h('h2', {}, title), description ? h('p', { id: descId }, description) : null),
      h('div', { class: 'modal-body' }, body || null, error),
      h('div', { class: 'modal-foot' }, cancelBtn, ok));
    const dlg = h('dialog', { class: `modal${wide ? ' wide' : ''}`, 'aria-label': title, 'aria-describedby': description ? descId : null }, form);
    // Settle directly instead of relying on the close event, which some Chromium builds don't fire.
    // Watching the open attribute also catches Esc and any other way the dialog closes. One that may not close now
    // (Chrome closes a modal on a repeated Esc even when told not to) opens again.
    let settled = false, pending = false, pressedBackdrop = false;
    const closed = () => {
      if (settled || dlg.open) return;
      if (dismissable && !pending) finish(null);
      else if (dlg.isConnected) dlg.showModal();
    };
    const watch = new MutationObserver(closed);
    const finish = value => {
      if (settled) return;
      settled = true;
      watch.disconnect();
      if (dlg.open) dlg.close();
      dlg.remove();
      resolve(value);
    };
    watch.observe(dlg, { attributes: true, attributeFilter: ['open'] });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (pending) return;
      if (!onConfirm) return finish(true);
      pending = true;
      ok.disabled = true;
      ok.setAttribute('aria-busy', 'true');
      if (cancelBtn) cancelBtn.disabled = true;
      try {
        const value = await onConfirm();
        pending = false;
        finish(value);
      } catch (x) {
        pending = false;
        // A calm one (do it at the main address, say) isn't shown as a failure, and keeps its way there.
        set(error, x.message, x.link ? [' ', h('a', { class: 'link', href: x.link.href }, x.link.label)] : null);
        error.classList.toggle('calm', Boolean(x.calm));
        error.hidden = false;
        ok.disabled = false;
        ok.removeAttribute('aria-busy');
        if (cancelBtn) cancelBtn.disabled = false;
      }
    });
    dlg.addEventListener('close', closed);
    dlg.addEventListener('cancel', e => { if (!dismissable || pending) e.preventDefault(); });
    // A click on the backdrop counts only if the press started there too (not a text selection dragged out of a field).
    dlg.addEventListener('pointerdown', e => { pressedBackdrop = e.target === dlg; });
    if (dismissable) dlg.addEventListener('click', e => { if (e.target === dlg && pressedBackdrop && !pending) finish(null); pressedBackdrop = false; });
    document.body.append(dlg);
    setup?.({ ok, dlg, done: finish });
    dlg.showModal();
    (focus || dlg.querySelector('input:not([type=checkbox]):not([type=radio]), textarea') || ok).focus();
  });
}

async function promptText({ title, label, value = '', confirm = 'Save', description }) {
  const input = h('input', { class: 'input', value, maxlength: '120', autocomplete: 'off' });
  return dialog({
    title, description, confirm,
    body: h('label', { class: 'field' }, label, input),
    onConfirm: () => {
      const v = input.value.trim();
      if (!v) throw new Error('Enter a value.');
      return v;
    },
  });
}

function drawer({ title, body, foot, actions = [], wide = false, onClose }) {
  closeMenus();
  const opener = document.activeElement;
  const backdrop = h('div', { class: 'drawer-backdrop' });
  const panel = h('aside', { class: `drawer${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'drawer-head' }, h('h2', {}, title), actions, h('button', { class: 'btn ghost icon-only', type: 'button', 'aria-label': 'Close', onclick: close }, icon('x'))),
    h('div', { class: 'drawer-body' }, body),
    foot ? h('div', { class: 'drawer-foot' }, foot) : null);
  const onKey = e => {
    if (e.key === 'Escape' && !document.querySelector('dialog[open]') && !$('.palette-backdrop') && !openMenuEl) close();
    if (e.key === 'Tab' && !document.querySelector('dialog[open]') && !openMenuEl) {
      const items = [...panel.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), select, textarea, [tabindex="0"]')].filter(x => x.offsetParent);
      if (!items.length) return;
      if (!panel.contains(document.activeElement)) { e.preventDefault(); items[0].focus(); }
      else if (e.shiftKey && document.activeElement === items[0]) { e.preventDefault(); items.at(-1).focus(); }
      else if (!e.shiftKey && document.activeElement === items.at(-1)) { e.preventDefault(); items[0].focus(); }
    }
  };
  function close() {
    backdrop.remove();
    panel.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  }
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop, panel);
  panel.querySelector('.drawer-head button:last-child').focus();
  return { close, panel };
}

/* ───────── jobs ───────── */
// Spark actions: what each is called, and the warning asked before it runs.
const ACTION_COPY = {
  'editor-restart': ['Restart VS Code', 'Open VS Code tabs will reconnect. Save your work first.'],
};
const actionLabel = action => ACTION_COPY[action]?.[0] || null;
const jobLabel = j => (j.type === 'spark-action' && actionLabel(j.action)) || actionLabel(j.type) || SVC_LABEL[j.type]?.(j) || cap(String(j.type || 'Operation').replace(/[-_]/g, ' '));
const jobTarget = j => (j.nodeIds || (j.nodeId ? [j.nodeId] : [])).map(nodeName).join(', ');

async function resumeJobs() {
  await loadJobs();
  for (const j of state.recentJobs || []) if (!TERMINAL.has(j.status)) followServiceJob(j);
}
// Operations Sparkie just started from a chat: follow them like your own, so their progress shows here too.
async function followNewJobs() {
  await loadJobs();
  for (const j of state.recentJobs || []) if (!TERMINAL.has(j.status) && !state.svcJobs.has(j.id)) followServiceJob(j);
}

async function nodeAction(n, action) {
  const [label, warning] = ACTION_COPY[action];
  if (warning && !(await dialog({ title: `${label} on ${n.name}?`, description: warning, confirm: label, danger: true }))) return;
  try {
    await followServiceJob(await capi(`nodes/${n.id}/actions`, 'POST', { action }));
  } catch (e) {
    toast(e.message, { kind: 'bad', timeout: 9000 });
  }
}

/* ───────── routing ───────── */
function route() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { view: parts[0] || 'fleet', a: parts[1], b: parts[2], params: new URLSearchParams(query) };
}
// Going to the page that's already open draws it again (no hashchange fires for the same address).
const go = path => { const to = `#/${path}`; if (location.hash === to) render(); else location.hash = to; };
// Old addresses still work: they're replaced by where that page lives now.
const MOVED = {
  chat: hash => hash.replace(/^#\/?chat/, '#/sparkie'),
  recipes: () => '#/models/find',
  clusters: () => '#/',
  overview: () => '#/',
  home: () => '#/',
  sharing: () => '#/access',
};

const PAGES = {};
function render() {
  closeMenus();
  viewLive = [];
  viewFast = [];
  if (Object.hasOwn(MOVED, route().view)) history.replaceState(null, '', MOVED[route().view](location.hash));
  const r = route();
  const view = $('#view');
  view.className = 'view';
  set(view);
  closeNav(false);
  const names = { fleet: 'Home', spark: nodeName(r.a), models: 'Models', sparkie: ASSISTANT, files: 'Files', access: 'Access' };
  document.title = names[r.view] ? `${names[r.view]} · Spark Console` : 'Spark Console';
  (Object.hasOwn(PAGES, r.view) ? PAGES[r.view] : notFoundPage)(view, r);
  runLive();
}

function notFoundPage(view) {
  put(view, h('div', { class: 'empty' }, icon('search'), h('strong', {}, 'Nothing here'), h('p', {}, 'That page doesn’t exist.'), h('a', { class: 'btn', href: '#/' }, 'Back to Home')));
}

// A page's own sections, as links (each has its own address, so Back and reloads keep the tab).
const pageTabs = (label, tabs, current) => h('nav', { class: 'tabs', 'aria-label': label }, tabs.map(([href, text, ic]) =>
  h('a', { class: 'tab', href, 'aria-current': href === current ? 'page' : null }, ic ? icon(ic) : null, text)));

/* ───────── shell ───────── */
// The main places: path, view, label, icon, who sees it. navBadge (below) can put a count on one.
const NAV = [
  ['', 'fleet', 'Home', 'grid', () => true],
  ['sparkie', 'sparkie', ASSISTANT, 'chat', canChat],
  ['models', 'models', 'Models', 'sparkle', () => true],
  ['files', 'files', 'Files', 'folder', canFiles],
  ['access', 'access', 'Access', 'users', () => true],
];
// A number to show on a nav item, or null: for the owner, the people waiting on Access.
const navBadge = view => (view === 'access' && owner() ? state.access?.requests?.length || null : null);
const THEMES = [['dark', 'Dark'], ['light', 'Light'], ['system', 'Match my system']];
const currentTheme = () => document.documentElement.dataset.theme || 'system';
const THEME_NEXT = { dark: 'light', light: 'system', system: 'dark' };
const THEME_ICON = { system: 'monitor', light: 'sun', dark: 'moon' };
function syncThemeColor() {
  const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b0c0e' : '#f5f6f8');
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeColor);
function setTheme(theme) {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  // Remembered either way: with nothing saved, Spark Console is dark.
  try { localStorage.setItem(STORE.theme, theme); } catch {}
  syncThemeColor();
  runLive();
}

const NARROW = matchMedia('(max-width: 920px)');
function syncNav() {
  const app = $('.app'), side = $('.sidebar'), btn = $('.menu-btn');
  if (!app || !side) return;
  const open = app.classList.contains('nav-open');
  side.inert = NARROW.matches && !open;
  // While the menu covers the page, the page behind it can't be reached.
  const main = $('.main');
  if (main) main.inert = NARROW.matches && open;
  btn?.setAttribute('aria-expanded', String(open));
}
function openNav() {
  $('.app')?.classList.add('nav-open');
  syncNav();
  $('.sidebar .nav-item')?.focus();
}
function closeNav(refocus = true) {
  const app = $('.app');
  if (!app?.classList.contains('nav-open')) { syncNav(); return; }
  app.classList.remove('nav-open');
  syncNav();
  if (refocus) $('.menu-btn')?.focus();
}
NARROW.addEventListener('change', syncNav);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('.app')?.classList.contains('nav-open')) closeNav(); });

function shell() {
  const app = $('#app');
  app.className = 'app';
  const nav = h('nav', { class: 'nav', 'aria-label': 'Main' });
  const sparkList = h('div', { class: 'spark-list' });
  const sparkLinks = new Map();
  const sparkCount = h('span', { class: 'num' });
  const avatar = h('span', { class: 'avatar', 'aria-hidden': 'true' });
  const accountBtn = h('button', { class: 'account-btn', type: 'button', 'aria-haspopup': 'menu', onclick: e => openMenu(e.currentTarget, accountMenu()) }, avatar);
  const activityBadge = h('span', { class: 'badge', hidden: true, 'aria-hidden': 'true' });
  const activityBtn = h('button', { class: 'btn ghost sm', type: 'button', onclick: () => openActivity(), title: 'What’s been started and stopped', 'aria-label': 'Activity' }, icon('activity'), h('span', { class: 'hide-sm' }, 'Activity'), activityBadge);
  const ribbon = h('div', { class: 'preview-ribbon', hidden: true },
    icon('eye'), h('span', {}, 'Previewing as a member: owner controls are hidden.'),
    h('button', { class: 'btn sm', type: 'button', onclick: () => setMemberPreview(false) }, 'Exit preview'));

  set(app, 
    h('aside', { class: 'sidebar', 'aria-label': 'Navigation' },
      h('a', { class: 'brand', href: '#/' },
        h('img', { class: 'logo-on-dark', src: 'nvidia-logo-white.svg', alt: 'NVIDIA', width: '98', height: '18' }),
        h('img', { class: 'logo-on-light', src: 'nvidia-logo-black.svg', alt: 'NVIDIA', width: '98', height: '18' }),
        h('span', { class: 'brand-name' }, 'Spark Console')),
      nav,
      h('div', { class: 'nav-section' }, h('span', {}, 'Sparks'), sparkCount),
      sparkList),
    h('div', { class: 'scrim', onclick: () => closeNav() }),
    h('div', { class: 'main' },
      h('header', { class: 'topbar' },
        h('button', { class: 'btn ghost icon-only menu-btn', type: 'button', 'aria-label': 'Open menu', 'aria-expanded': 'false', onclick: openNav }, icon('menu')),
        h('button', { class: 'search-trigger', type: 'button', onclick: openPalette, 'aria-label': 'Ask or do anything', 'aria-keyshortcuts': IS_MAC ? 'Meta+K' : 'Control+K' },
          icon('search'), h('span', {}, 'Ask or do anything…'), h('kbd', {}, IS_MAC ? '⌘ K' : 'Ctrl K')),
        h('div', { class: 'topbar-spacer' }),
        h('span', { class: 'live', id: 'live' }, h('span', { class: 'pulse' }), h('span', { class: 'live-text' }, 'Connecting…')),
        activityBtn,
        h('button', {
          class: 'btn ghost sm icon-only', type: 'button', 'aria-label': 'Refresh status', title: 'Refresh status',
          onclick: e => busy(e.currentTarget, () => loadStatus(true)),
        }, icon('refresh')),
        accountBtn),
      ribbon,
      h('main', { id: 'view', class: 'view', tabindex: '-1' })),
    h('div', { class: 'toasts', id: 'toasts', 'aria-live': 'polite' }),
    h('div', { class: 'sr-only', id: 'announce', 'aria-live': 'polite' }));

  live(() => {
    const r = route();
    redraw(nav, ...NAV.filter(([, , , , allowed]) => allowed()).map(([path, view, label, ic]) => {
      const count = navBadge(view);
      return h('a', { class: 'nav-item', href: `#/${path}`, 'aria-current': r.view === view ? 'page' : null }, icon(ic), h('span', {}, label),
        count ? h('span', { class: 'badge', 'aria-label': `${count} waiting` }, count) : null);
    }));
  }, shellLive);

  // The Spark links are rebuilt only when Sparks come, go or are renamed; fast() below keeps dots and numbers current.
  let sparkKey = null;
  live(() => {
    const r = route(), list = nodes();
    sparkCount.textContent = state.status ? `${list.filter(isUp).length}/${list.length}` : '';
    const key = list.map(n => `${n.id}\u0000${n.name}`).join('\n');
    if (key !== sparkKey) {
      sparkKey = key;
      sparkLinks.clear();
      set(sparkList, ...list.map(n => {
        const dot = led(condition(n)), meta = h('span', { class: 'spark-link-meta' });
        const link = h('a', { class: 'spark-link', href: `#/spark/${n.id}` }, dot, h('span', { class: 'spark-link-name' }, n.name), meta);
        sparkLinks.set(n.id, { link, dot, meta });
        return link;
      }));
    }
    for (const [id, { link }] of sparkLinks) {
      if (r.view === 'spark' && r.a === id) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    }
  }, shellLive);

  // GPU readout and status dot follow the live stream without rebuilding the list.
  fast(() => {
    for (const n of nodes()) {
      const el = sparkLinks.get(n.id);
      if (!el) continue;
      const cond = condition(n);
      el.dot.dataset.cond = cond;
      el.link.title = `${n.name} · ${COND[cond][0]}`;
      el.meta.textContent = isUp(n) ? fmt.pct(n.gpuUtilization) : cond === 'offline' ? 'offline' : '';
    }
  }, shellFast);

  live(() => {
    const name = myName();
    avatar.textContent = initials(name);
    accountBtn.setAttribute('aria-label', `${name}: account, devices and theme`);
    accountBtn.title = name;
    ribbon.hidden = !state.memberPreview;
    const running = [...state.svcJobs.values()].filter(underWay).length;
    activityBadge.hidden = !running;
    activityBadge.textContent = running;
    activityBtn.setAttribute('aria-label', running ? `Activity, ${plural(running, 'job')} running` : 'Activity');
  }, shellLive);
}

// Screen readers hear when the connection drops or comes back, not the "updated 8s ago" ticking.
function announce(text) { const el = $('#announce'); if (el) el.textContent = text; }
let lastLiveState = null;
function tickLive() {
  const el = $('#live');
  if (!el) return;
  const text = el.querySelector('.live-text');
  queueMicrotask(() => {
    const now = el.dataset.state;
    if (lastLiveState && now !== lastLiveState) announce(now === 'error' ? 'Lost contact with Spark Console. Reconnecting.' : lastLiveState === 'error' ? 'Reconnected.' : '');
    lastLiveState = now;
  });
  if (state.statusError && (!state.lastOk || Date.now() - state.lastOk > POLL_MS * 2)) {
    el.dataset.state = 'error';
    el.title = state.statusError;
    text.textContent = 'Reconnecting…';
    return;
  }
  if (liveFresh()) {
    el.dataset.state = 'live';
    el.title = 'Metrics stream from each Spark about once a second';
    text.textContent = 'Live';
    return;
  }
  el.dataset.state = isStale() ? 'error' : 'ok';
  el.title = state.status ? `Status from ${fmt.time(state.status.updatedAt)}` : '';
  text.textContent = state.lastOk ? `Updated ${fmt.ago(state.lastOk)}` : 'Connecting…';
}

function setMemberPreview(on) {
  state.memberPreview = on;
  state.files.area = 'personal';
  state.files.node = null;
  render();
}

/* ───────── your account: passkey, devices, theme ───────── */
const myName = () => state.boot?.userName || state.boot?.viewer?.login || 'You';
// Spark Console's address to share or open elsewhere: this page's own.
const consoleAddress = () => location.origin + location.pathname;

function accountMenu() {
  const theme = currentTheme();
  return [
    { heading: `${myName()} · ${state.memberPreview ? 'previewing as a member' : realOwner() ? 'owner' : 'member'}` },
    owner() && typeof state.boot?.passkeys === 'number' ? { label: 'Your passkey', icon: 'key', onSelect: openPasskeys } : null,
    { label: 'Your devices', icon: 'monitor', hint: owner() ? 'phone, SSH' : 'phone', onSelect: openDevices },
    owner() ? { label: 'Let a device in', icon: 'plus', onSelect: () => letDeviceIn() } : null,
    'sep',
    { heading: 'Theme' },
    ...THEMES.map(([key, label]) => ({ label, icon: theme === key ? 'check' : THEME_ICON[key], onSelect: () => setTheme(key) })),
    realOwner() ? 'sep' : null,
    realOwner() ? { label: state.memberPreview ? 'Exit member preview' : 'Preview as a member', icon: 'eye', onSelect: () => setMemberPreview(!state.memberPreview) } : null,
    // Signed in without Tailscale (4.10): signing this device out.
    state.boot?.session?.kind === 'browser' ? 'sep' : null,
    state.boot?.session?.kind === 'browser' ? { label: 'Sign out on this device', icon: 'arrowRight', onSelect: signOutHere } : null,
  ];
}

// Live content in a drawer: kept current until the drawer closes, whichever page is open behind it.
function drawerLive(fn) {
  live(fn, shellLive);
  return () => { const i = shellLive.indexOf(fn); if (i >= 0) shellLive.splice(i, 1); };
}

// The owner's passkeys (when the service has them): changes to who has access ask for one, at the main address.
function openPasskeys() {
  const box = h('div', { class: 'drawer-pad passkey-box' });
  let unbind = () => {};
  drawer({ title: 'Your passkey', body: box, onClose: () => unbind() });
  unbind = drawerLive(() => {
    const pk = state.passkeys, keys = pk?.keys || [];
    const note = text => h('p', { class: 'muted passkey-note' }, text);
    const used = k => (k.lastUsedAt ? `Last used ${fmt.ago(Date.parse(k.lastUsedAt))}` : `Added ${fmt.ago(Date.parse(k.createdAt))} · not used yet`);
    redraw(box, !pk ? h('div', { class: 'empty' }, h('span', { class: 'spinner' }), 'Loading…')
      : pk.error ? failBanner('Couldn’t load your passkeys', pk.error, loadPasskeys)
        : keys.length ? [
          note('Changes to who has access ask for it.'),
          h('div', { class: 'card rows' }, keys.map(k => h('div', { class: 'row' },
            h('div', { class: 'row-main' }, h('span', { class: 'row-icon', 'aria-hidden': 'true' }, icon('key')),
              h('div', { class: 'row-text' }, h('div', { class: 'row-title' }, k.name),
                h('div', { class: 'row-sub' }, [used(k), k.domain && !fitsHere(k.domain) ? `works at ${k.domain}` : null].filter(Boolean).join(' · ')))),
            h('div', { class: 'row-side' },
              h('button', { class: 'btn ghost sm icon-only', type: 'button', 'aria-label': `Remove ${k.name}`, title: 'Remove', onclick: () => removePasskey(k) }, icon('trash')))))),
          passkeysWork() ? h('div', {}, h('button', { class: 'btn sm', type: 'button', id: 'add-passkey', onclick: addPasskey }, icon('plus'), 'Add another')) : null,
          recoverySection()]
          : h('div', { class: 'passkey-empty' },
            note('Set up a passkey so changes to who has access need your fingerprint or face, not just Tailscale.'),
            !passkeysWork() ? note('This browser can’t make passkeys. Open this page in Safari, Chrome, Edge or Firefox.')
              : h('button', { class: 'btn sm primary', type: 'button', id: 'add-passkey', onclick: addPasskey }, icon('key'), 'Set up a passkey')));
  });
  loadPasskeys();
  loadRecovery();
}

// Recovery codes: the way in that needs no other device. Made with the passkey, shown once as one plain list (easy to
// screenshot or copy into a password manager); only how many are left is shown after that.
function recoverySection() {
  const r = state.recovery;
  if (!r || r.available === false) return null;
  const line = !r.total ? 'None yet. Make 10, and keep them somewhere safe: a password manager, a photo, or paper.'
    : `${r.left} of ${r.total} left${r.madeAt ? `, made ${fmt.when(r.madeAt)}` : ''}. Each signs one browser in, from anywhere, without another device.`;
  return h('section', { class: 'drawer-section' }, h('h3', {}, 'Recovery codes'),
    h('p', { class: 'muted passkey-note' }, line),
    h('button', { class: `btn sm${r.total ? '' : ' primary'}`, type: 'button', onclick: e => busy(e.currentTarget, makeRecovery) }, icon('key'), r.total ? 'Make new codes' : 'Make recovery codes'));
}
async function loadRecovery() {
  try { state.recovery = await capi('auth/recovery'); } catch { state.recovery = null; }
  runLive();
}
async function makeRecovery() {
  if (state.recovery?.total && !await dialog({ title: 'Make new recovery codes?', description: 'The codes you saved before stop working.', confirm: 'Make new codes', danger: true })) return;
  const r = await capi('auth/recovery', 'POST', {});
  state.recovery = { available: true, madeAt: r.madeAt, total: r.total, left: r.left };
  runLive();
  const text = r.codes.join('\n');
  await dialog({
    title: 'Your recovery codes', confirm: 'I saved them', cancel: null, dismissable: false,
    description: 'Save them now (a screenshot, a password manager, or paper): they aren’t shown again. Each signs one browser in once, from anywhere, with no other device.',
    body: h('div', {},
      h('ol', { class: 'recovery-codes', style: { 'font-family': 'var(--mono, ui-monospace, monospace)', 'font-size': '15px', 'line-height': '1.9', margin: '0 0 12px', 'padding-left': '28px' } },
        r.codes.map(c => h('li', {}, c))),
      h('button', { class: 'btn sm', type: 'button', onclick: () => copy(`Spark Console recovery codes (each works once)\n${text}`, 'Codes copied') }, icon('copy'), 'Copy all')),
  });
}

// Your other devices: the phone gets a code to scan; the owner's laptops get the SSH config for every Spark.
function openDevices() {
  // The owner's phone opens the main address, which works from the internet (4.10); members' need Tailscale.
  const url = owner() && state.boot?.main ? `${String(state.boot.main).replace(/\/$/, '')}/` : consoleAddress();
  const ssh = h('div', { class: 'drawer-section' }), signedIn = h('section', { class: 'drawer-section' });
  let unbind = () => {};
  drawer({
    title: 'Your devices',
    body: h('div', { class: 'drawer-pad' },
      h('section', { class: 'drawer-section phone-panel' }, h('h3', {}, 'Open on your phone'),
        h('div', { class: 'phone-open' },
          typeof QR !== 'undefined' ? h('div', { class: 'qr' }, QR.svg(url, 'QR code for Spark Console’s address')) : null,
          owner() ? h('ol', { class: 'phone-steps' },
            h('li', {}, 'Point your phone’s camera at this code.'),
            h('li', {}, 'Add it to your Home Screen, and open it from there.'),
            h('li', {}, 'Sign in with your passkey, or let it in from here with its code.'))
            : h('ol', { class: 'phone-steps' },
              h('li', {}, 'Install Tailscale on your phone and sign in with the same account as here.'),
              h('li', {}, 'Point the camera at this code.'),
              h('li', {}, 'Add it to your Home Screen. It opens like an app.')))),
      h('p', { class: 'phone-here muted' }, 'To open Spark Console like an app: Share → Add to Home Screen on iPhone, or ⋮ → Install app on Android.'),
      owner() ? signedIn : null,
      owner() ? ssh : null),
    onClose: () => unbind(),
  });
  if (!owner()) return;
  loadSessions();
  unbind = drawerLive(() => {
    redraw(signedIn, ...sessionsSection());
    const cfg = state.connections?.sshConfig;
    redraw(ssh, h('h3', {}, 'SSH config for all Sparks'), cfg
      ? [h('p', { class: 'muted' }, 'Add this to ~/.ssh/config on your laptop. Then ', h('code', {}, `ssh ${state.connections.nodes[0]?.alias || 'akspark1'}`), ' and the VS Code and Cursor buttons work for every Spark.'),
        h('pre', { class: 'config-block' }, cfg),
        h('div', {}, h('button', { class: 'btn sm', type: 'button', onclick: () => copy(cfg, 'SSH config copied') }, icon('copy'), 'Copy SSH config'))]
      : state.connectionsError ? failBanner('Couldn’t load the connection details', state.connectionsError, loadConnections)
        : h('p', { class: 'muted' }, state.connections === null ? 'Loading…' : 'Unavailable.'));
  });
  if (!state.connections) loadConnections();
}

/* ───────── shared bits ───────── */
function pageHead(title, sub, ...actions) {
  actions = actions.filter(Boolean);
  return h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, title), sub ? h('div', { class: 'page-sub' }, sub) : null),
    actions.length ? h('div', { class: 'btn-row' }, actions) : null);
}
const dot = () => h('span', { class: 'sep', 'aria-hidden': 'true' });
// Something didn't load: say what, why, and offer to try again.
const failBanner = (title, message, retry) => h('div', { class: 'banner bad' }, icon('alert'),
  h('div', { class: 'banner-text' }, title ? h('strong', {}, title) : null, message ? h('p', {}, message) : null),
  retry ? h('button', { class: 'btn sm', type: 'button', onclick: e => busy(e.currentTarget, retry) }, icon('refresh'), 'Try again') : null);
const joinDots = parts => parts.filter(Boolean).flatMap((p, i) => (i ? [dot(), p] : [p]));
const panel = (title, body, { actions = [], sub, tight = false, cls = '' } = {}) =>
  h('section', { class: `panel ${cls}` },
    h('div', { class: 'panel-head' }, h('div', {}, h('h2', {}, title), sub ? h('div', { class: 'muted' }, sub) : null), actions.length ? h('div', { class: 'btn-row' }, actions) : null),
    h('div', { class: `panel-body${tight ? ' tight' : ''}` }, body));
const empty = (iconName, title, text, ...actions) =>
  h('div', { class: 'empty' }, icon(iconName), h('strong', {}, title), text ? h('p', {}, text) : null, actions.length ? h('div', { class: 'btn-row' }, actions) : null);

function openTargets(n) {
  if (!owner()) return mine(n.id) ? [{ label: 'Browse files', icon: 'folder', onSelect: () => go(`files/${n.id}`) }] : [];
  const ssh = sshCommand(n.id);
  return [
    { heading: `Open ${n.name}` },
    { label: 'VS Code in browser', icon: 'code', href: editorUrl(n), external: true, hint: 'editor + terminal' },
    conn(n.id) ? { label: 'VS Code desktop', icon: 'monitor', href: desktopUrl(n.id, 'vscode'), hint: 'Remote SSH' } : null,
    conn(n.id) ? { label: 'Cursor', icon: 'monitor', href: desktopUrl(n.id, 'cursor'), hint: 'Remote SSH' } : null,
    'sep',
    ssh ? { label: 'Copy SSH command', icon: 'terminal', hint: ssh, onSelect: () => copy(ssh, `Copied: ${ssh}`) } : null,
    { label: 'Browse files', icon: 'folder', onSelect: () => go(`files/${n.id}`) },
  ];
}

function openButton(n, size = 'sm') {
  if (!owner()) {
    return canFiles() && mine(n.id) ? h('a', { class: `btn ${size}`, href: `#/files/${n.id}`, 'aria-label': `Files on ${n.name}` }, icon('folder'), 'Files') : null;
  }
  return h('div', { class: 'btn-group' },
    h('a', { class: `btn ${size} primary`, href: editorUrl(n), target: '_blank', rel: 'noopener noreferrer', title: `Open VS Code on ${n.name} in a new tab`, 'aria-label': `Open VS Code on ${n.name}` }, icon('code'), 'VS Code'),
    h('button', {
      class: `btn ${size} primary`, type: 'button', 'aria-label': `More ways to open ${n.name}`, 'aria-haspopup': 'menu',
      onclick: e => openMenu(e.currentTarget, openTargets(n)),
    }, icon('chevronDown')));
}

function sparkActions(n, onPage = false) {
  const up = isUp(n);
  return [
    onPage ? null : { label: 'View details', icon: 'chip', onSelect: () => go(`spark/${n.id}`) },
    owner() && !onPage ? { label: 'Logs', icon: 'logs', onSelect: () => go(`spark/${n.id}/logs`) } : null,
    owner() && !onPage ? { label: 'Workloads', icon: 'box', onSelect: () => go(`spark/${n.id}/workloads`) } : null,
    owner() ? { label: 'Run checks', icon: 'clipboard', onSelect: () => go(`spark/${n.id}/diagnostics?run=1`) } : null,
    owner() ? 'sep' : null,
    owner() ? { label: 'Restart VS Code', icon: 'refresh', disabled: !up, onSelect: () => nodeAction(n, 'editor-restart') } : null,
  ];
}

/* ───────── home ───────── */
PAGES.fleet = function fleetPage(view) {
  const headline = h('h1', {}, 'Home');
  const sub = h('div', { class: 'page-sub' });
  const alerts = h('div');
  const stats = h('div', { class: 'card stats' });
  const grid = h('div', { class: 'fleet' });
  const activity = h('div', { class: 'rows' });
  const clustersBox = h('div');

  put(view,
    h('div', { class: 'page-head' },
      h('div', {}, headline, sub),
      h('div', { class: 'btn-row' },
        canRun() ? h('button', { class: 'btn', type: 'button', onclick: e => openDeployPicker({ button: e.currentTarget }) }, icon('play'), 'Start a model') : null,
        canChat() ? h('a', { class: 'btn', href: '#/sparkie/new', title: `Ask ${ASSISTANT} about all your Sparks` }, icon('chat'), `Ask ${ASSISTANT}`) : null)),
    alerts, stats, grid, clustersBox,
    h('div', { style: { 'margin-top': '16px' } },
      panel('Recent activity', activity, { tight: true, actions: [h('button', { class: 'btn ghost sm', type: 'button', onclick: () => openActivity() }, 'All activity', icon('chevronRight'))] })));

  live(() => {
    const list = nodes();
    if (!state.status) { redraw(sub, h('span', {}, 'Checking your Sparks…')); return; }
    const jobs = [...state.svcJobs.values()].filter(underWay).length;
    const m = state.main.data, chat = m?.routes?.chat;
    redraw(sub, ...joinDots([
      jobs ? h('button', { class: 'link-btn', type: 'button', onclick: () => openActivity() }, `${plural(jobs, 'job')} in progress`) : null,
      // The owner can change it on Models; everyone else just sees which model it is.
      m?.configured || chat ? (owner() ? h('a', { href: '#/models', title: `Change what ${ASSISTANT} answers with` }, `${ASSISTANT}: ${chat?.title || m.title} on ${nodeName(chat?.node || m.node)} ›`)
        : h('span', {}, `${ASSISTANT}: ${chat?.title || m.title} on ${nodeName(chat?.node || m.node)}`)) : null,
    ]));
  });

  // Linked Sparks: which two could run one model together right now. Only when there's something to show.
  live(() => {
    const pairs = linkedPairs();
    if (!pairs.length) { redraw(clustersBox); return; }
    redraw(clustersBox, panel('Linked Sparks', h('div', { class: 'cluster-strip' }, linkMap(), h('div', { class: 'rows' }, pairs.map(p => pairRow(p)))),
      { tight: true, sub: 'Two Sparks joined by a direct cable can run one model together', cls: 'cluster-panel' }));
  });
  if (!state.fabric.loading && (!state.fabric.sparks || Date.now() - (state.fabric.at || 0) > 300000)) loadFabric();
  // What each Spark runs is named after its model, which comes from the library.
  if (!state.lib.loading && (!state.lib.data || Date.now() - state.lib.at > 60000)) loadLibrary();

  live(() => redraw(alerts, ...attentionBanners()));

  const stat = (label, ic) => {
    const value = h('span'), unit = h('small'), foot = h('div', { class: 'stat-foot' });
    put(stats, h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, icon(ic), label), h('div', { class: 'stat-value' }, value, unit), foot));
    return { value, unit, foot };
  };
  const sOnline = stat('Sparks online', 'server'), sWork = stat('Models running', 'box'), sMem = stat('Memory', 'layers');
  const sPower = stat('GPU power', 'zap');
  fast(() => {
    const list = nodes(), up = list.filter(isUp), busySparks = up.filter(n => workloads(n).length);
    const running = busySparks.reduce((t, n) => t + workloads(n).length, 0);
    const total = sum(up, 'memoryTotalGiB'), used = total - sum(up, 'memoryFreeGiB');
    sOnline.value.textContent = state.status ? up.length : '—';
    sOnline.unit.textContent = `/ ${list.length}`;
    sOnline.foot.textContent = !state.status ? 'Checking…' : list.length - up.length ? `${list.length - up.length} offline` : 'All online';
    sWork.value.textContent = state.status ? running : '—';
    sWork.foot.textContent = !state.status ? 'Checking…' : busySparks.length ? `on ${plural(busySparks.length, 'Spark')}` : 'Nothing running';
    glide(sMem.value, total ? used * GB_PER_GIB : null, used * GB_PER_GIB >= 100 ? 0 : 1);
    sMem.unit.textContent = `/ ${fmt.gib(total)} GB`;
    sMem.foot.textContent = total ? `${Math.round((used / total) * 100)}% in use across ${plural(up.length, 'Spark')}` : '—';
    glide(sPower.value, state.status ? sum(up, 'gpuPowerWatts') : null, 1);
    sPower.unit.textContent = 'W';
    const walls = list.filter(x => wallState(x).has).map(x => x.wall);
    sPower.foot.textContent = !state.status ? '—' : walls.length
      ? `At the wall: ${fmt.watts(walls.reduce((a, w) => a + w.watts, 0))} (${plural(walls.length, 'plug')})` : `across ${plural(up.length, 'Spark')}`;
  });

  // Cards follow the Spark list: new Sparks get a card, removed ones drop out, without a reload.
  const cards = new Map();
  let cardIds = '';
  live(() => {
    const ids = nodes().map(n => n.id);
    if (ids.join() === cardIds) return;
    cardIds = ids.join();
    for (const id of ids) if (!cards.has(id)) cards.set(id, sparkCard(id));
    redraw(grid, ...ids.map(id => cards.get(id)));
  });

  live(() => {
    const jobs = activityJobs().slice(0, 5);
    // Spark Console's notices from the last day come first here too (all of them are in Activity).
    const notes = (state.notices || []).filter(n => Date.now() - Date.parse(n.at) < 86400000).slice(0, 2).map(noticeRow);
    if (state.recentJobs === null && !jobs.length) redraw(activity, h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
    else if (!jobs.length && !notes.length) redraw(activity, empty('activity', 'Nothing yet', 'Models started and stopped, downloads and setup searches show up here, with their progress.'));
    else redraw(activity, ...notes, ...jobs.map(j => jobRow(j, { onOpen: () => openActivity(j.id) })));
  });

  if (state.recentJobs === null) loadJobs();
};

function attentionBanners() {
  if (!state.status) return [];
  if (isStale()) {
    return [h('div', { class: 'banner warn' }, icon('clock'),
      h('div', { class: 'banner-text' }, h('strong', {}, 'Status is out of date'), h('p', {}, `The last status check was ${fmt.ago(Date.parse(state.status.updatedAt))}.`)),
      h('button', { class: 'btn sm', type: 'button', onclick: e => busy(e.currentTarget, () => loadStatus(true)) }, icon('refresh'), 'Refresh'))];
  }
  return [];
}
const issueText = n => (n.issues?.length ? n.issues.join(' · ') : 'Something on this Spark needs attention.');

function sparkCard(id) {
  const card = h('article', { class: 'spark-card' });
  const body = h('a', { class: 'sc-link', href: `#/spark/${id}` });
  const foot = h('div', { class: 'sc-foot' });
  card.append(body, foot);
  let footKey = null, bodyKey = null, refs = null;
  const metric = (label, unit) => {
    const value = h('span');
    return [value, h('div', { class: 'sc-metric' }, h('div', { class: 'k' }, label), h('div', { class: 'v' }, value, h('small', {}, unit)))];
  };

  // Structure: rebuilt only when what the card shows changes (reachability, workloads, warnings).
  live(() => {
    const n = node(id);
    if (!n) return;
    const cond = condition(n), up = isUp(n), work = workloads(n), portalHost = portalHostId() === n.id;
    const wall = wallState(n), off = !up && n.poweredOff?.words ? n.poweredOff.words : null;
    const key = [up, up ? cond === 'degraded' : cond, work.join('\n'), portalHost, cond === 'degraded' ? issueText(n) : '', up ? wall.has : wall.words, off].join('|');
    if (key !== bodyKey) {
      bodyKey = key;
      const pillEl = condPill(cond);
      const head = h('div', { class: 'sc-head' },
        h('div', { class: 'sc-title' },
          h('span', { class: 'sc-chip' }, icon('chip')),
          h('div', { style: { 'min-width': '0' } },
            h('h3', {}, n.name, portalHost ? h('span', { class: 'tag', title: 'This Spark runs Spark Console. Keep it on.' }, 'Host') : null),
            h('div', { class: 'sc-sub' }, hardware(n)))),
        pillEl);
      if (!up) {
        set(body, head, h('div', { class: 'sc-offline' },
          icon(cond === 'unknown' || cond === 'stale' ? 'clock' : 'wifiOff'),
          cond === 'offline' ? null : h('strong', {}, cond === 'unknown' ? 'Checking…' : 'Status out of date'),
          h('span', {}, cond === 'unknown' ? 'Waiting for the first status report.' : cond === 'stale' ? 'Refresh to check again.'
            // (powered off by Spark Console on purpose: its own words, when, why and what was parked)
            : off || wall.words || 'Spark Console can’t reach it over Tailscale. Check that it’s on and signed in.')));
        refs = { pill: pillEl };
      } else {
        const [gpu, gpuBox] = metric('GPU', '%'), [power, powerBox] = metric(wall.has ? 'Wall power' : 'GPU power', 'W'), [temp, tempBox] = metric('Temp', '°F');
        const memUsed = h('span'), memTotal = h('span'), barFill = h('span'), graph = h('div', { class: 'sc-spark' }), span = h('span');
        set(body, head,
          cond === 'degraded' ? h('div', { class: 'sc-issue' }, icon('alert'), h('span', {}, issueText(n))) : null,
          h('div', { class: 'sc-work' },
            h('div', { class: 'sc-work-head' }, h('span', {}, 'Workloads'), h('strong', {}, work.length)),
            h('div', { class: 'sc-work-list' }, work.length
              ? [...work.slice(0, 2).map(w => h('div', { class: 'sc-work-item', title: w }, led('running'), h('span', {}, w))),
                work.length > 2 ? h('div', { class: 'sc-work-more' }, `+${work.length - 2} more`) : null]
              : h('div', { class: 'sc-work-empty' }, 'Nothing running'))),
          h('div', { class: 'meter-row' }, h('span', {}, 'Memory'), h('strong', {}, memUsed, ' / ', memTotal, ' GB')),
          h('div', { class: 'bar' }, barFill),
          h('div', { class: 'sc-metrics' }, gpuBox, powerBox, tempBox),
          graph,
          h('div', { class: 'sc-caption' }, h('span', {}, 'GPU use'), span));
        refs = { pill: pillEl, gpu, power, temp, memUsed, memTotal, barFill, graph, span };
      }
    }
    const fkey = `${cond === 'offline'}|${up}|${n.model?.running}|${owner()}|${Boolean(conn(id))}|${canSparkChat(n)}`;
    if (fkey === footKey) return;
    footKey = fkey;
    const ssh = owner() && cond === 'offline' ? sshDirect(id) : null;
    // Each button names its Spark, so a screen reader's list of buttons tells the cards apart.
    set(foot,
      up ? openButton(n) : owner() && cond === 'offline'
        ? h('button', { class: 'btn sm', type: 'button', 'aria-label': `Run checks on ${n.name}`, onclick: () => go(`spark/${id}/diagnostics?run=1`) }, icon('clipboard'), 'Run checks')
        : null,
      ssh ? h('button', { class: 'btn sm', type: 'button', title: ssh, 'aria-label': `Copy SSH command for ${n.name}`, onclick: () => copy(ssh, `Copied: ${ssh}`) }, icon('terminal'), 'Copy SSH') : null,
      canSparkChat(n) ? h('a', { class: 'btn sm', href: sparkChatHref(id), title: `Ask ${ASSISTANT} about ${n.name}`, 'aria-label': `Chat about ${n.name}` }, icon('chat'), 'Chat') : null,
      h('span', { class: 'grow' }),
      owner() ? menuButton(() => sparkActions(node(id)), { label: `More actions for ${n.name}` }) : h('a', { class: 'btn ghost sm', href: `#/spark/${id}`, 'aria-label': `Details for ${n.name}` }, 'Details'));
  });

  // Numbers, bar, status and graph: updated in place on every live tick.
  fast(() => {
    const n = node(id);
    if (!n || !refs) return;
    const cond = condition(n), [label, kind] = COND[cond];
    card.dataset.cond = cond;
    body.setAttribute('aria-label', `${n.name}: ${label}`);
    refs.pill.className = `pill ${kind}`;
    refs.pill.textContent = label;
    if (!refs.gpu) return;
    const total = n.memoryTotalGiB, used = num(total) && num(n.memoryFreeGiB) ? total - n.memoryFreeGiB : null;
    const share = num(used) && total ? Math.max(0, Math.min(1, used / total)) : 0;
    glide(refs.memUsed, num(used) ? used * GB_PER_GIB : null, Math.abs(used * GB_PER_GIB) >= 100 ? 0 : 1);
    refs.memTotal.textContent = fmt.gib(total);
    refs.barFill.style.width = `${(share * 100).toFixed(1)}%`;
    refs.barFill.parentElement.classList.toggle('bad', share > 0.95);
    glide(refs.gpu, n.gpuUtilization, 0);
    glide(refs.power, wallState(n).has ? n.wall.watts : n.gpuPowerWatts, 1);
    glide(refs.temp, toF(n.temperature), 0);
    set(refs.graph, sparkline(series(id, 'gpu'), { max: 100, label: `${n.name} GPU use, ${windowLabel(id)}` }));
    refs.span.textContent = windowLabel(id);
  });
  return card;
}

// Something Spark Console wants you to know (agents paused by themselves, an operation a restart cut off).
// One about agents pausing leads to where they're resumed.
const noticeRow = n => h('div', { class: 'notice-row' }, icon('alert'),
  h('span', {}, n.text, n.workflows && owner() ? [' ', h('button', { class: 'link-btn', type: 'button', onclick: () => openActivity('workflows') }, 'Test it now')]
    : /paused/i.test(n.text) && owner() ? [' ', h('a', { class: 'link', href: '#/access/agents' }, 'Open Agents')] : null),
  n.workflows ? null : h('span', { class: 'muted' }, fmt.ago(Date.parse(n.at))));

function jobRow(j, { onOpen, open = false } = {}) {
  const done = TERMINAL.has(j.status), failed = j.status === 'failed';
  const first = String(j.error || '').split('\n')[0];
  // Where it ran, unless the title already says ("Start X on Spark 2").
  const ids = j.nodeIds || (j.nodeId ? [j.nodeId] : []), where = ids.every(id => jobLabel(j).includes(nodeName(id))) ? null : jobTarget(j);
  const main = [
      h('span', { class: `row-icon ${failed ? 'bad' : done && j.status !== 'interrupted' ? 'ok' : 'warn'}` },
        done ? icon(j.type === 'chat' ? 'chat' : String(j.type).startsWith('cluster') ? 'network' : 'zap') : h('span', { class: 'spinner sm' })),
      h('div', { class: 'row-text' },
        h('div', { class: 'row-title' }, jobLabel(j)),
        // Who started it, when it wasn't you: Sparkie, one of your agents, Auto-restart or a member.
        (sub => sub ? h('div', { class: 'row-sub' }, sub) : null)([whoKey(j) === 'you' ? null : whoName(whoKey(j)), where, first || (done ? (num(j.result?.found) ? `${plural(j.result.found, 'setup')} found` : null) : j.step || j.message)].filter(Boolean).join(' · ')))];
  const side = h('div', { class: 'row-side' },
      h('span', { class: 'muted num hide-sm' }, fmt.when(j.createdAt)),
      j.status === 'interrupted' ? pill('Cut off', 'warn') : pill(failed ? 'Failed' : done ? (j.status === 'partial' ? 'Partial' : 'Done') : 'Running', failed ? 'bad' : done ? 'good' : 'info'));
  if (onOpen) {
    const log = (j.log || []).join('\n');
    // What was asked for, in the words used (Auto-restart says what it saw instead).
    const asked = j.request ? (j.via === 'watcher' ? j.request : `Asked: “${j.request}”`) : null;
    return h('div', { class: `job${open ? ' open' : ''}`, dataset: { id: j.id } },
      h('div', { class: 'row' }, h('button', { class: 'row-main row-btn', type: 'button', 'aria-expanded': String(open), onclick: onOpen }, main), side),
      open ? h('div', { class: 'job-detail' },
        asked ? h('p', { class: 'job-asked' }, asked) : null,
        j.error && j.error.includes('\n') ? h('pre', { class: 'log wrap' }, j.error) : null,
        log ? h('pre', { class: 'log wrap', tabindex: '0', 'aria-label': 'Job log' }, log) : h('p', { class: 'muted' }, 'No log for this job.'),
        !done && owner() && /^[0-9a-f]{12}$/.test(String(j.id)) ? h('button', { class: 'btn sm', type: 'button', 'aria-label': `Stop ${jobLabel(j)}`, onclick: e => busy(e.currentTarget, async () => {
          if (!(await dialog({ title: `Stop ${jobLabel(j)}?`, confirm: 'Stop it', cancel: 'Keep it running', danger: true, description: 'It stops after its current step, and what it already changed is undone.' }))) return;
          try {
            const r = await capi(`jobs/${j.id}/cancel`, 'POST', {});
            toast(r.outcome === 'already' ? 'It had already finished.' : r.outcome === 'cancelled' ? 'Stopped. What it changed was undone.' : 'Stopping…');
            await loadJobs();
          } catch (x) { failToast(x); }
        }) }, icon('x'), 'Stop') : null,
        log ? h('button', { class: 'btn ghost sm', type: 'button', onclick: () => copy([jobLabel(j), asked, j.error, log].filter(Boolean).join('\n\n'), 'Log copied') }, icon('copy'), 'Copy log') : null) : null);
  }
  return h('div', { class: 'row' },
    h('div', { class: 'row-main' }, main), side);
}

// Every change Spark Console makes is a workflow (docs/contract.md, section 6): tested with this build, then tried once
// on your Sparks before Sparkie and agents use it. Folded away at the foot of Activity, with a one-line summary; open
// by itself when one can be tested now.
const WF_STATE = { active: ['Ready', 'good'], 'needs-validation': ['Needs a test run', 'warn'], untested: ['Off', 'bad'] };
const updateTime = stamp => fmt.when(String(stamp).replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/, '$1-$2-$3T$4:$5:$6Z'));
function workflowsFold() {
  const sum = h('span', { class: 'muted' }, ' …'), rows = h('div', { class: 'rows' });
  const fold = h('details', { class: 'invite-fold workflows-fold' }, h('summary', {}, 'Workflows', sum), rows);
  const draw = () => capi('workflows').then(({ workflows: list = [] }) => {
    const waiting = list.filter(w => w.state !== 'active').length;
    // The one tap tests these; a start across two Sparks needs its own run, from Deploy.
    const testable = list.filter(w => w.state === 'needs-validation' && w.id !== 'start_model_across');
    const testing = (state.recentJobs || []).some(j => j.type === 'validate-workflows' && !TERMINAL.has(j.status));
    const lastTest = (state.recentJobs || []).find(j => j.type === 'validate-workflows');
    set(sum, ` · ${waiting ? `${list.length - waiting} of ${list.length} ready` : `all ${list.length} ready`}`);
    if (testable.length) fold.open = true;
    set(rows, list.map(w => {
      const [label, kind] = WF_STATE[w.state] || [w.state, ''];
      const sub = w.runs ? `Worked ${w.succeeded} of ${plural(w.runs, 'time')}` : 'Not tried on your Sparks yet';
      return h('div', { class: 'row' }, h('div', { class: 'row-main' }, h('div', { class: 'row-text' }, h('div', { class: 'row-title' }, w.title), h('div', { class: 'row-sub' }, sub))), pill(label, kind));
    }), testable.length || lastTest?.status === 'failed' ? h('div', { class: 'workflow-actions' },
      testing ? h('p', { class: 'muted' }, 'Testing now. It shows at the top of Activity.')
        : testable.length ? h('button', { class: 'btn sm primary', type: 'button', onclick: e => busy(e.currentTarget, async () => {
          if (!(await dialog({ title: 'Test the changes?', confirm: 'Test them', description: 'Spark Console tries each change once with a small model on a spare Spark (never Spark 2). Anything running there stops for a few minutes and starts again at the end.' }))) return;
          try { await capi('workflows/validate', 'POST', {}); toast('Testing started'); await loadJobs(); draw(); } catch (x) { failToast(x); }
        }) }, icon('check'), 'Test the changes') : null,
      // A test that failed: undoing the last update is one click (docs/contract.md 6.3).
      lastTest?.status === 'failed' ? h('button', { class: 'btn sm', type: 'button', onclick: e => busy(e.currentTarget, async () => {
        const r = await capi('rollback');
        if (!r?.available) { toast(`There’s no earlier version on ${nodeName(portalHostId())} to go back to.`); return; }
        if (!(await dialog({ title: 'Undo the last update?', confirm: 'Undo update', danger: true, description: `Spark Console goes back to how it was before the update on ${updateTime(r.stamp)} and restarts (about a minute). People, chats and settings stay as they are.` }))) return;
        await capi('rollback', 'POST', {});
        toast('Undoing the update: Spark Console restarts in a moment');
      }) }, icon('refresh'), 'Undo the last update') : null) : null);
  }).catch(e => { set(sum, ' · couldn’t load'); set(rows, h('p', { class: 'form-error' }, `Couldn’t load the workflows: ${e.message}`)); });
  draw();
  return fold;
}

// What should be running but isn't (docs/contract.md 6.13): one row each, with Bring back and Forget.
function heldRows(list, reload) {
  return list.filter(x => x.state === 'held').map(x => {
    const name = containerTitle(x.container);
    return h('div', { class: 'notice-row held-row' }, icon('alert'),
      h('div', { class: 'row-text' }, h('div', {}, `${name} on ${nodeName(x.spark)} should be running but isn’t`), h('div', { class: 'muted' }, cap(x.why))),
      h('div', { class: 'held-actions' },
        h('button', { class: 'btn sm', type: 'button', 'aria-label': `Bring back ${name}`, onclick: e => busy(e.currentTarget, async () => {
          try { await capi('desired/bring-back', 'POST', { spark: x.spark, container: x.container }); toast(`Bringing back ${name}`); await reload(); } catch (err) { failToast(err); }
        }) }, icon('refresh'), 'Bring back'),
        h('button', { class: 'btn ghost sm', type: 'button', 'aria-label': `Forget ${name}`, onclick: e => busy(e.currentTarget, async () => {
          if (!(await dialog({ title: `Forget ${name}?`, confirm: 'Forget it', description: 'It comes off the list of what should be running. Nothing is stopped or deleted.' }))) return;
          try { await capi('desired/forget', 'POST', { spark: x.spark, container: x.container }); await reload(); document.querySelector('.drawer [aria-label="Refresh"]')?.focus(); } catch (err) { failToast(err); }
        }) }, 'Forget')));
  });
}

async function openActivity(focusId) {
  const list = h('div', { class: 'rows' }, h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
  const opened = new Set(typeof focusId === 'string' && focusId !== 'workflows' ? [focusId] : []);
  let timer, who = 'all', whoList = '';
  // Whose work to show: everyone, or just you, Sparkie, one agent, Auto-restart or one member (those with work here).
  const whoPick = h('select', { class: 'select sm', 'aria-label': 'Started by', onchange: () => { who = whoPick.value; draw(); } });
  const fillWho = jobs => {
    const order = k => (k === 'you' ? 0 : k === 'sparkie' ? 1 : k.startsWith('agent:') ? 2 : k === 'auto' ? 3 : 4);
    const keys = [...new Set(['you', ...jobs.map(whoKey), who].filter(k => k !== 'all'))].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
    if (keys.join('\n') === whoList) return;
    whoList = keys.join('\n');
    set(whoPick, h('option', { value: 'all' }, 'Everyone'), keys.map(k => h('option', { value: k }, whoName(k))));
    whoPick.value = who;
  };
  // An open log keeps its place across refreshes: at the newest lines if it was there (or just opened), else where it was.
  const logs = () => [...list.querySelectorAll('.job[data-id] pre[aria-label="Job log"]')].map(pre => [pre.closest('.job').dataset.id, pre]);
  const draw = () => {
    const all = activityJobs();
    fillWho(all);
    const jobs = who === 'all' ? all : all.filter(j => whoKey(j) === who);
    const was = new Map(logs().map(([id, pre]) => [id, pre.scrollHeight - pre.scrollTop - pre.clientHeight < 24 ? null : pre.scrollTop]));
    // Things Spark Console wants you to know (agents paused by themselves, an operation a restart cut off), last 7 days.
    const notes = who === 'all' ? [...heldRows(held, load), ...(state.notices || []).filter(n => !/should be running but isn’t/.test(n.text)).map(noticeRow)] : [];
    redraw(list, ...notes, ...(jobs.length ? jobs.map(j => jobRow(j, { open: opened.has(j.id), onOpen: () => { if (opened.has(j.id)) opened.delete(j.id); else opened.add(j.id); draw(); } }))
      : [state.jobsError ? empty('alert', 'Couldn’t load Activity', state.jobsError)
        : all.length ? empty('activity', who === 'you' ? 'Nothing started by you lately' : `Nothing from ${whoName(who)} lately`, null)
          : empty('activity', 'Nothing yet', 'Models started and stopped, downloads and setup searches show up here, with their progress and logs.')]));
    for (const [id, pre] of logs()) pre.scrollTop = was.get(id) ?? pre.scrollHeight;
  };
  let held = [];
  const load = async () => {
    const [, d] = await Promise.all([loadJobs(), realOwner() ? capi('desired').catch(() => null) : null]);
    held = d?.running || [];
    if (list.isConnected) draw();
  };
  const fold = owner() ? workflowsFold() : null;
  drawer({
    title: 'Activity',
    body: fold ? h('div', {}, list, fold) : list,
    foot: 'Select one to see its log. Only recent work is kept.',
    actions: [whoPick, h('button', { class: 'btn ghost sm icon-only', type: 'button', 'aria-label': 'Refresh', title: 'Refresh', onclick: e => busy(e.currentTarget, load) }, icon('refresh'))],
    onClose: () => clearInterval(timer),
  });
  await load();
  if (!list.isConnected) return;
  if (focusId === 'workflows' && fold) { fold.open = true; fold.scrollIntoView({ block: 'start' }); fold.querySelector('summary')?.focus(); }
  timer = setInterval(() => { if (!document.hidden) load(); }, 4000);
}

/* ───────── spark detail ───────── */
function mdata(id) {
  if (!state.machine.has(id)) {
    state.machine.set(id, {
      workloads: null, workloadsError: null, workloadsBusy: false, showStopped: false,
      logs: null, logsAt: 0, logService: null, logFilter: '', logWrap: false, logFollow: false, logTimer: null, logQuiet: true,
      checks: null, checksBusy: false,
    });
  }
  return state.machine.get(id);
}

PAGES.spark = function sparkPage(view, r) {
  const id = r.a;
  const n0 = node(id);
  if (!n0) {
    put(view, empty('chip', 'Spark not found', 'It may not be shared with you.', h('a', { class: 'btn', href: '#/' }, 'Back to Home')));
    return;
  }
  const tabs = owner()
    ? [['overview', 'Overview', 'grid'], ['workloads', 'Workloads', 'box'], ['logs', 'Logs', 'logs'], ['diagnostics', 'Checks', 'clipboard'], ['files', 'Files', 'folder']]
    : [['overview', 'Overview', 'grid'], canFiles() && mine(id) ? ['files', 'Files', 'folder'] : null].filter(Boolean);
  const tab = tabs.some(([k]) => k === r.b) ? r.b : 'overview';

  const title = h('h1', {});
  const meta = h('div', { class: 'detail-meta' });
  const chipEl = h('span', { class: 'sc-chip' }, icon('chip'));
  const actions = h('div', { class: 'btn-row' });
  const facts = h('div', { class: 'facts' });
  const content = h('div');
  put(view, 
    h('div', { class: 'crumbs' }, h('a', { href: '#/' }, 'Home'), icon('chevronRight'), h('span', {}, n0.name)),
    h('div', { class: 'detail-head' }, h('div', { class: 'detail-title' }, chipEl, h('div', { style: { 'min-width': '0' } }, title, meta)), actions),
    facts,
    h('nav', { class: 'tabs', 'aria-label': `${n0.name} sections` }, tabs.map(([key, label, ic]) =>
      h('a', { class: 'tab', href: `#/spark/${id}${key === 'overview' ? '' : `/${key}`}`, 'aria-current': key === tab ? 'page' : null }, icon(ic), label))),
    content);

  let actionsKey = null;
  live(() => {
    const n = node(id), cond = condition(n), c = conn(id);
    set(title, n.name, condPill(cond));
    chipEl.parentElement.parentElement.parentElement.dataset.cond = cond;
    set(meta, ...joinDots([
      h('span', {}, hardware(n)),
      isUp(n) ? h('span', {}, `up ${fmt.uptime(n.uptimeSeconds)}`) : null,
      portalHostId() === id ? h('span', {}, 'runs Spark Console') : null,
    ]));
    set(facts, ...(isUp(n) ? factChips(n) : []));
    const key = `${cond}|${n.model?.running}|${owner()}|${Boolean(c)}|${canSparkChat(n)}`;
    if (key !== actionsKey) {
      actionsKey = key;
      set(actions,
        canSparkChat(n) ? h('a', { class: 'btn', href: sparkChatHref(id), title: `Ask ${ASSISTANT} about ${n.name}` }, icon('chat'), 'Chat') : null,
        isUp(n) ? openButton(n, '') : null,
        owner() ? menuButton(() => sparkActions(node(id), true), { cls: 'btn icon-only' }) : null);
    }
  });

  const TABS = { overview: overviewTab, workloads: workloadsTab, logs: logsTab, diagnostics: diagnosticsTab, files: (box, n) => put(box, filesBrowser(n.id)) };
  TABS[tab](content, n0, r);
};

function factChips(n) {
  const net = n.network || {};
  const chip = (ic, text, kind = '') => h('span', { class: `chip ${kind}` }, icon(ic), text);
  return [
    n.dockerAccessible ? null : chip('alert', 'Can’t run models: Docker isn’t answering', 'warn'),
    owner() && !n.editorReady ? chip('code', 'VS Code not ready', 'warn') : null,
    num(net.highSpeedLinksConfigured) && net.highSpeedLinksUp < net.highSpeedLinksConfigured ? chip('link', `${net.highSpeedLinksUp} of ${net.highSpeedLinksConfigured} direct cables up`, 'warn') : null,
  ];
}

function overviewTab(box, n0) {
  const id = n0.id;
  const tile = (label, ic, read, key, opts) => {
    const number = h('span'), unit = h('small'), wrap = h('div', { class: 'spark-wrap' }), span = h('span');
    fast(() => {
      const n = node(id), [v, decimals, suffix] = read(n);
      glide(number, v, decimals);
      unit.textContent = suffix;
      set(wrap, sparkline(series(id, key), { ...opts, label }));
      span.textContent = windowLabel(id);
    });
    return h('div', { class: 'card tile' }, h('div', { class: 'stat-label' }, icon(ic), label), h('div', { class: 'stat-value' }, number, unit),
      wrap, h('div', { class: 'tile-foot' }, span, h('span', {}, opts.range || '')));
  };
  const offline = h('div');
  live(() => redraw(offline, ...(!state.status || isUp(node(id)) ? [] : [h('div', { class: 'banner bad' }, icon('wifiOff'),
    h('div', { class: 'banner-text' }, h('strong', {}, `${n0.name} is offline`), h('p', {}, 'Live metrics resume when it’s back on Tailscale. Run checks to see which part is failing.')),
    owner() ? h('a', { class: 'btn sm', href: `#/spark/${id}/diagnostics?run=1` }, icon('clipboard'), 'Run checks') : null)])));

  // Going offline or coming back switches the layout (metrics, or the banner and how to connect).
  const upAtStart = !state.status || isUp(node(id));
  live(() => { if (state.status && isUp(node(id)) !== upAtStart && route().view === 'spark' && route().a === id) render(); });
  if (!upAtStart) {
    put(box, offline);
    return;
  }
  put(box, offline,
    h('div', { class: 'tiles' },
      tile('GPU utilization', 'chip', n => [n.gpuUtilization, 0, '%'], 'gpu', { max: 100, range: '0–100%' }),
      tile('GPU power', 'zap', n => [n.gpuPowerWatts, 1, 'W'], 'power', { max: 30, cls: 'info' }),
      tile('Temperature', 'thermo', n => [toF(n.temperature), 0, '°F'], 'temp', { min: 25, max: 70, cls: 'warn' }),
      tile('Memory in use', 'layers', n => [num(n.memoryTotalGiB) && num(n.memoryFreeGiB) ? (n.memoryTotalGiB - n.memoryFreeGiB) * GB_PER_GIB : null, 1, ` / ${fmt.gib(n.memoryTotalGiB)} GB`], 'mem', { max: n0.memoryTotalGiB || 128, cls: 'muted' })));

  const services = h('div');
  const system = h('dl', { class: 'kv' });
  live(() => {
    if (!state.status) {
      set(services, h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
      set(system);
      return;
    }
    const n = node(id), up = isUp(n);
    const row = (ic, name, statusEl, sub, ...buttons) => h('div', { class: 'svc' },
      h('div', { class: 'row-main' }, h('span', { class: 'row-icon' }, icon(ic)), h('div', { class: 'row-text' }, h('div', { class: 'row-title' }, name, ' ', statusEl), h('div', { class: 'row-sub' }, sub))),
      h('div', { class: 'btn-row' }, buttons));
    redraw(services, 
      row('box', 'Running here', n.dockerAccessible ? null : pill('Docker isn’t answering', 'warn'),
        workloads(n).length ? workloads(n).join(', ') : 'Nothing running.',
        owner() ? h('a', { class: 'btn ghost sm', href: `#/spark/${id}/workloads` }, 'Details') : null),
      owner() ? row('code', 'VS Code', pill(n.editorReady ? 'Ready' : 'Not ready', n.editorReady ? 'good' : 'warn'), 'Editor and terminal in your browser.',
        h('button', { class: 'btn ghost sm', type: 'button', onclick: () => nodeAction(node(id), 'editor-restart') }, 'Restart')) : null);

    const net = n.network || {}, pw = n.power || {};
    const kv = (k, v) => h('div', {}, h('dt', {}, k), h('dd', {}, v));
    redraw(system, 
      kv('CPU load (1 min)', up ? `${fmt.load(n.load1Minute ?? n.load)} across ${n.cpuLogicalCount ?? '—'} cores` : '—'),
      kv('Disk free', up ? fmt.disk(n.diskFreeGiB) : '—'),
      kv('Control network', net.controlNetwork || '—'),
      kv('Direct cables', num(net.highSpeedLinksConfigured) ? `${net.highSpeedLinksUp} of ${net.highSpeedLinksConfigured} up` : '—'),
      pw.sleepModes ? kv('Wake over the network', pw.remoteWakeVerified ? 'Works' : 'Not checked yet') : null);
  });

  put(box, h('div', { class: 'grid-2' },
    panel('Services', services, { tight: true }),
    h('div', { style: { display: 'grid', gap: '16px', 'align-content': 'start' } },
      owner() ? connectPanel(id) : null,
      panel('System', system))));
}

function connectPanel(id) {
  const body = h('div', { class: 'connect-grid' });
  live(() => {
    const n = node(id), c = conn(id);
    if (!c) { set(body, state.connectionsError ? failBanner('Couldn’t load the connection details', state.connectionsError, loadConnections) : h('p', { class: 'muted' }, state.connections === null ? 'Loading connection details…' : 'No connection details for this Spark.')); return; }
    const line = (text, label) => h('div', { class: 'connect-line' }, h('code', {}, text),
      h('button', { class: 'btn ghost sm icon-only', type: 'button', 'aria-label': `Copy ${label}`, title: 'Copy', onclick: () => copy(text, `Copied: ${text}`) }, icon('copy')));
    const launch = (ic, name, sub, href, external) => h('a', { class: 'launch', href, target: external ? '_blank' : null, rel: external ? 'noopener noreferrer' : null }, icon(ic), h('strong', {}, name), h('span', {}, sub));
    redraw(body, 
      h('div', { class: 'launch-grid' },
        launch('code', 'Browser', 'VS Code + terminal', editorUrl(n), true),
        launch('monitor', 'VS Code', 'Remote SSH', desktopUrl(id, 'vscode')),
        launch('monitor', 'Cursor', 'Remote SSH', desktopUrl(id, 'cursor'))),
      line(sshCommand(id), 'SSH command'),
      c.alias ? line(sshDirect(id), 'direct SSH command') : null,
      h('p', { class: 'muted', style: { 'font-size': '12.5px' } }, 'Desktop apps use your SSH setup. ', h('button', { type: 'button', class: 'link-btn', onclick: openDevices }, 'Get the SSH config'), ' for all Sparks.'));
  });
  return panel('Connect', body, { sub: 'Open this Spark from any of your devices on Tailscale' });
}

function workloadsTab(box, n0) {
  const id = n0.id, d = mdata(id);
  const content = h('div', { style: { display: 'grid', gap: '16px' } });
  const stamp = h('span', { class: 'muted' });
  const refresh = h('button', { class: 'btn sm', type: 'button', onclick: () => load() }, icon('refresh'), 'Refresh');
  put(box, h('div', { class: 'files-bar' }, h('div', { class: 'btn-row' }, stamp), refresh), content);

  async function load() {
    if (d.workloadsBusy || !isUp(node(id))) return;
    d.workloadsBusy = true;
    refresh.setAttribute('aria-busy', 'true');
    try {
      d.workloads = await capi(`nodes/${id}/workloads`);
      d.workloadsError = null;
    } catch (e) {
      d.workloadsError = e.message;
    } finally {
      d.workloadsBusy = false;
      refresh.removeAttribute('aria-busy');
      if (content.isConnected) draw();
    }
  }

  function table(cols, rows, { numeric = [], dimIf } = {}) {
    return h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, cols.map((c, i) => h('th', { class: numeric.includes(i) ? 'num' : null }, c)))),
      h('tbody', {}, rows.map(row => h('tr', { class: dimIf?.(row) ? 'dim' : null }, row.cells.map((cell, i) => h('td', { class: numeric.includes(i) ? 'num' : null }, cell)))))));
  }

  function draw() {
    if (!isUp(node(id))) { set(content, empty('wifiOff', `${n0.name} is offline`, 'What runs on it shows here again when it’s back.')); stamp.textContent = ''; return; }
    if (d.workloadsError && !d.workloads) { set(content, failBanner('Couldn’t load workloads', d.workloadsError, load)); return; }
    if (!d.workloads) { set(content, h('div', { class: 'empty' }, h('span', { class: 'spinner' }), 'Inspecting containers and processes…')); return; }
    const w = d.workloads;
    stamp.textContent = `As of ${fmt.time(w.checkedAt)}`;
    const containers = [...(w.containers || [])].sort((a, b) => (a.State === 'running' ? 0 : 1) - (b.State === 'running' ? 0 : 1));
    const running = containers.filter(c => c.State === 'running'), stopped = containers.filter(c => c.State !== 'running');
    const shownContainers = d.showStopped ? containers : running;
    // Ports as the numbers you'd connect to ("30100"), not Docker's "127.0.0.1:30100->8000/tcp".
    const ports = text => [...new Set([...String(text || '').matchAll(/:(\d+)->/g)].map(x => x[1]))].join(', ') || '—';
    redraw(content,
      ...(w.issues || []).map(text => h('div', { class: 'banner warn' }, icon('alert'), h('div', { class: 'banner-text' }, text))),
      panel('Containers', shownContainers.length
        ? table(['What', 'Status', 'Port'], shownContainers.map(c => {
          const what = containerTitle(c.Names);
          return {
            state: c.State,
            cells: [h('div', { class: 'cell-main' }, led(c.State === 'running' ? 'running' : 'unknown'),
              h('div', { style: { 'min-width': '0' } }, h('strong', { title: c.Image }, what), what !== c.Names ? h('div', { class: 'row-sub' }, c.Names) : null)),
              c.Status, h('span', { class: 'num', title: c.Ports || null }, ports(c.Ports))],
          };
        }), { dimIf: row => row.state !== 'running' })
        : empty('box', 'Nothing running', stopped.length ? `${plural(stopped.length, 'stopped container')} hidden.` : null),
      { tight: true, sub: `${running.length} running`, actions: stopped.length ? [h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: d.showStopped, onchange: e => { d.showStopped = e.target.checked; draw(); } }), 'Show stopped')] : [] }),
      panel('Using the GPU', w.gpuProcesses?.length
        ? table(['Program', 'GPU memory'], w.gpuProcesses.map(p => ({ cells: [h('code', { title: `PID ${p.pid}` }, p.name), num(Number(p.memoryMiB)) ? `${(Number(p.memoryMiB) * 2 ** 20 / 1e9).toFixed(1)} GB` : '—'] })), { numeric: [1] })
        : empty('chip', 'Nothing is using the GPU', null), { tight: true }),
      h('details', { class: 'card fold' }, h('summary', {}, 'System details: services and processes'),
        h('div', { class: 'fold-body' },
          h('h3', {}, 'Your services'), w.services?.length
            ? h('div', { class: 'members' }, w.services.map(s => h('span', { class: 'chip' }, s)))
            : h('p', { class: 'muted' }, 'None.'),
          h('h3', {}, 'Top processes'), w.processes?.length
            ? table(['PID', 'User', 'Program', 'CPU %', 'RAM'], w.processes.map(p => ({ cells: [p.pid, p.user, h('code', {}, p.name), p.cpu, num(Number(p.rssKiB)) ? fmt.bytes(Number(p.rssKiB) * 1024) : '—'] })), { numeric: [3, 4] })
            : h('p', { class: 'muted' }, 'None reported.'))));
  }

  draw();
  if (!d.workloads || Date.now() - Date.parse(d.workloads.checkedAt) > 30000) load();
}

function logsTab(box, n0) {
  const id = n0.id, d = mdata(id);
  const host = portalHostId() === id;
  // Sparkie's model, each running model (its own log), VS Code, and Spark Console itself on its Spark.
  const services = () => [
    ...(state.main.data?.configured && state.main.data.node === id ? [['sparkie', `${ASSISTANT}’s model`]] : []),
    ...(d.workloads?.containers || []).filter(c => c.State === 'running' && !c.protected && c.Names !== 'sparkie-main')
      .map(c => [`container-${c.ID}`, containerTitle(c.Names)]),
    ['editor', 'VS Code'],
    ...(host ? [['console', 'Spark Console']] : []),
  ];
  if (!services().some(([k]) => k === d.logService)) d.logService = services()[0][0];
  const select = h('select', { class: 'select sm', 'aria-label': 'Which log', onchange: () => { d.logService = select.value; d.logs = null; draw(); load(); } });
  const fillSelect = () => { set(select, services().map(([value, label]) => h('option', { value, selected: value === d.logService }, label))); };
  fillSelect();
  // The running models come from the Spark's container list.
  if (!d.workloads && isUp(node(id))) capi(`nodes/${id}/workloads`).then(w => { d.workloads = w; if (select.isConnected) fillSelect(); }).catch(() => {});
  const filter = h('input', { class: 'input sm', type: 'search', placeholder: 'Filter lines…', 'aria-label': 'Filter log lines', value: d.logFilter, oninput: () => { d.logFilter = filter.value; draw(); } });
  const reload = h('button', { class: 'btn sm', type: 'button', onclick: () => load() }, icon('refresh'), 'Refresh');
  const pre = h('pre', { class: 'log', tabindex: '0', 'aria-label': 'Log output' });
  const meta = h('span', { class: 'muted', style: { 'font-size': '12px' } });
  const toggleEl = (label, key, onChange) => h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: d[key], onchange: e => { d[key] = e.target.checked; onChange?.(); draw(); } }), label);

  put(box, h('div', { class: 'panel' },
    h('div', { class: 'logbar' }, select, filter, toggleEl('Hide health checks', 'logQuiet'), toggleEl('Wrap', 'logWrap'), toggleEl('Follow', 'logFollow', schedule), h('span', { class: 'grow' }), meta,
      h('button', { class: 'btn ghost sm icon-only', type: 'button', 'aria-label': 'Copy logs', title: 'Copy', onclick: () => copy(d.logs?.text || '') }, icon('copy')),
      h('button', { class: 'btn ghost sm icon-only', type: 'button', 'aria-label': 'Download logs', title: 'Download', onclick: () => saveBlob(`${id}-${d.logService}.log`, new TextEncoder().encode(d.logs?.text || ''), 'text/plain') }, icon('download')),
      reload),
    pre));

  async function load() {
    // Only the newest request counts: switching logs quickly never shows the one before.
    const ticket = d.logTicket = (d.logTicket || 0) + 1;
    if (!isUp(node(id))) { d.logs = { error: `${n0.name} is offline. Its logs show here again when it’s back.` }; draw(); return; }
    reload.setAttribute('aria-busy', 'true');
    let logs;
    try { logs = await capi(`nodes/${id}/logs/${d.logService}`); } catch (e) { logs = { error: e.message }; }
    if (ticket !== d.logTicket) return;
    d.logs = logs;
    d.logsAt = Date.now();
    reload.removeAttribute('aria-busy');
    if (pre.isConnected) draw();
  }

  function highlight(text, q) {
    if (!q) return text;
    const out = [], lower = text.toLowerCase();
    let i = 0, j;
    while ((j = lower.indexOf(q, i)) >= 0) {
      out.push(text.slice(i, j), h('mark', {}, text.slice(j, j + q.length)));
      i = j + q.length;
    }
    out.push(text.slice(i));
    return out;
  }

  let first = true, drawn = null;
  function draw() {
    pre.className = `log${d.logWrap ? ' wrap' : ''}`;
    const key = [d.logs?.text, d.logs?.error, d.logFilter, d.logQuiet, d.logService].join('\u0000');
    if (d.logs && key === drawn) { meta.textContent = meta.textContent.replace(/· [^·]*$/, `· ${fmt.time(d.logsAt)}`); return; }
    drawn = d.logs ? key : null;
    if (!d.logs) { set(pre, h('span', { class: 'ln' }, 'Loading…')); meta.textContent = ''; return; }
    if (d.logs.error) { set(pre, h('span', { class: 'ln err' }, d.logs.error)); meta.textContent = ''; return; }
    const lines = String(d.logs.text || 'No log entries.').replace(/\n$/, '').split('\n');
    const q = d.logFilter.trim().toLowerCase();
    const health = /"(GET|HEAD) \/(health\w*|healthz|ready|ping|metrics|v1\/models|v1\/health\S*|get_model_info|get_server_info)[ ?"\/]/;
    const quiet = d.logQuiet ? lines.filter(l => !health.test(l)) : lines;
    const shown = q ? quiet.filter(l => l.toLowerCase().includes(q)) : quiet;
    const hidden = lines.length - quiet.length;
    const atBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 48;
    set(pre, ...(shown.length
      ? shown.slice(-4000).map(l => h('span', { class: `ln${/\b(error|exception|traceback|fatal|failed)\b/i.test(l) ? ' err' : /\bwarn(ing)?\b/i.test(l) ? ' wrn' : ''}` }, highlight(l, q)))
      : [h('span', { class: 'ln note' }, hidden && !q ? `Nothing but health checks in the last ${lines.length} lines. Turn off “Hide health checks” to see them.` : 'No lines match.')]));
    if (atBottom || first) pre.scrollTop = pre.scrollHeight;
    first = false;
    meta.textContent = `${shown.length} of ${lines.length} lines${hidden ? ` · ${hidden} health checks hidden` : ''} · ${fmt.time(d.logsAt)}`;
  }

  function schedule() {
    clearInterval(d.logTimer);
    if (!d.logFollow) return;
    d.logTimer = setInterval(() => {
      if (!pre.isConnected || !d.logFollow) { clearInterval(d.logTimer); return; }
      if (!document.hidden) load();
    }, 5000);
  }

  draw();
  if (!d.logs || d.logs.error || Date.now() - d.logsAt > 15000) load();
  schedule();
}

function diagnosticsTab(box, n0, r) {
  const id = n0.id, d = mdata(id);
  const list = h('div');
  const run = h('button', { class: 'btn sm primary', type: 'button', onclick: () => check() }, icon('clipboard'), 'Run checks');
  const trouble = h('div', { style: { 'margin-top': '16px' } });
  put(box, panel('Checks', list, { tight: true, sub: 'Reachability, services, model endpoint and network links', actions: [run] }), trouble,
    h('div', { style: { 'margin-top': '16px' } }, cablePanel(id)));
  live(() => redraw(trouble, state.status && !isUp(node(id)) ? troubleshootPanel(id) : null));

  async function check() {
    if (d.checksBusy) return;
    d.checksBusy = true;
    run.setAttribute('aria-busy', 'true');
    draw();
    try {
      d.checks = await capi(`nodes/${id}/diagnostics`);
    } catch (e) {
      d.checks = { error: e.message };
    } finally {
      d.checksBusy = false;
      run.removeAttribute('aria-busy');
      if (list.isConnected) draw();
    }
  }

  function draw() {
    if (d.checksBusy && !d.checks) { set(list, h('div', { class: 'empty' }, h('span', { class: 'spinner' }), `Checking ${n0.name}…`)); return; }
    if (!d.checks) { set(list, empty('clipboard', 'No checks run yet', 'Checks take a few seconds and change nothing on the Spark.')); return; }
    if (d.checks.error) { set(list, h('div', { style: { padding: '12px' } }, h('div', { class: 'banner bad' }, icon('alert'), h('div', { class: 'banner-text' }, h('strong', {}, 'Checks couldn’t run'), h('p', {}, d.checks.error))))); return; }
    const checks = d.checks.checks || [];
    const failing = checks.filter(c => !c.ok).length;
    set(list, 
      h('div', { class: 'svc' }, h('strong', {}, failing ? `${failing} of ${checks.length} checks need attention` : `All ${checks.length} checks passed`), h('span', { class: 'muted' }, `Checked ${fmt.time(d.checks.checkedAt)}`)),
      ...checks.map(c => h('div', { class: `check ${c.ok ? 'ok' : 'bad'}` }, icon(c.ok ? 'checkCircle' : 'alert'), h('div', {}, h('strong', {}, c.name), h('p', {}, c.message)))));
  }

  draw();
  if (r.params.get('run')) {
    if (!d.checksBusy) check();
    // Run once: a reload or Back doesn't run them again.
    history.replaceState(null, '', `#/spark/${encodeURIComponent(id)}/diagnostics`);
  }
}

function troubleshootPanel(id) {
  const n = node(id), c = conn(id);
  const cmd = text => h('div', { class: 'connect-line', style: { 'margin-top': '8px' } }, h('code', {}, text),
    h('button', { class: 'btn ghost sm icon-only', type: 'button', 'aria-label': `Copy ${text}`, title: 'Copy', onclick: () => copy(text, `Copied: ${text}`) }, icon('copy')));
  const step = (title, text, ...extra) => h('div', { class: 'step' }, h('div', { style: { 'min-width': '0' } }, h('strong', {}, title), h('p', {}, text), extra));
  return panel(`Bring ${n.name} back online`, h('div', { class: 'steps' },
    step('Check power', 'The power LED should be lit. If it’s asleep, press the power button once and give it a minute to rejoin.'),
    step('Check Tailscale', 'See when it was last seen in the admin console, or ping it from your laptop:',
      c ? cmd(`tailscale ping ${c.alias || c.ip}`) : null,
      h('a', { class: 'btn sm', href: 'https://login.tailscale.com/admin/machines', target: '_blank', rel: 'noopener noreferrer', style: { 'margin-top': '8px' } }, icon('external'), 'Tailscale admin')),
    step('Sign it back in', 'If you can reach it on your local network or with a keyboard and monitor, bring Tailscale back up:', cmd('sudo tailscale up')),
    step('Refresh', 'Spark Console reconnects on its own once the Spark is back. You can also check now.',
      h('button', { class: 'btn sm', type: 'button', style: { 'margin-top': '8px' }, onclick: e => busy(e.currentTarget, () => loadStatus(true)) }, icon('refresh'), 'Check now'))),
  { tight: true, sub: 'Spark Console can’t reach it, so checks can’t run on it yet.' });
}

/* ───────── Spark Console's service ───────── */
async function capi(path, method = 'GET', body) {
  // The body becomes text once, so what a passkey confirms is exactly what's sent.
  const text = body === undefined ? undefined : JSON.stringify(body);
  const send = async extra => {
    let res;
    try {
      res = await fetch(`${CONSOLE_API}${path}`, {
        method,
        headers: { Accept: 'application/json', ...(method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Spark-Console': '1' }), ...extra },
        body: text,
      });
    } catch {
      throw Object.assign(new Error(state.boot ? 'Can’t reach Spark Console’s service. Check that Tailscale is connected.' : 'Can’t reach Spark Console’s service. Check your connection.'), { missing: true });
    }
    return [res, await res.json().catch(() => null)];
  };
  let [res, data] = await send();
  // A change to who has access: confirm it with the owner's passkey (at the main address), then send the same request
  // again with the answer.
  if (res.status === 428 && data?.passkey === 'confirm') [res, data] = await send({ 'X-Spark-Passkey': await confirmWithPasskey(method, path, text) });
  // A workflow's first run on these Sparks (docs/contract.md 6.3): said once, then sent again as its validation run.
  if (res.status === 428 && data?.validation) {
    const v = data.validation;
    const go = await dialog({ title: 'First time on your Sparks', confirm: 'Go ahead', cancel: 'Not now',
      description: `“${v.title}” hasn’t been tried on your Sparks yet. If this first run works, Sparkie and your agents can do it too from now on.` });
    if (!go) throw calmError('Not started.');
    [res, data] = await send({ 'X-Spark-Validate': v.id });
  }
  if (!res.ok) {
    const missing = !data || res.status === 502;
    throw Object.assign(new Error(missing ? 'Spark Console’s service didn’t answer. It restarts for a moment after an update; try again shortly.' : data.error || `Spark Console’s service returned an error (${res.status}). Try again; if it keeps happening, look at Spark Console’s log on ${nodeName(portalHostId())} › Logs.`), { status: res.status, missing });
  }
  return data;
}

/* ───────── signing in without Tailscale (docs/contract.md 4.10) ───────── */
// From the internet, the owner signs this browser in with their passkey once, or lets it in with a short code from a
// device that's already signed in. Each signed-in device is listed under Your devices, with Sign out.
async function signInWithPasskey() {
  if (!passkeysWork()) throw calmError('This browser can’t use passkeys. Sign in with a code instead.');
  const begin = await capi('auth/signin/begin', 'POST', {});
  const pick = usablePasskeys(begin.allow);
  if (!pick) throw calmError('Your passkey was made for another address. Sign in with a code instead.');
  let cred;
  try {
    cred = await passkeyCall('get', { challenge: fromB64u(begin.challenge), rpId: pick.rpId, allowCredentials: pick.allowCredentials, userVerification: 'required', timeout: 120000 },
      { title: 'Sign in with your passkey', confirm: 'Use passkey', description: 'Your browser asks for your fingerprint, face or screen lock.' });
  } catch (e) {
    if (rpRefused(e)) throw calmError('Your passkey was made for another address. Sign in with a code instead.');
    throw new Error(e.name === 'NotAllowedError' || e.name === 'AbortError' ? 'You didn’t sign in. Try again when you’re ready.' : e.message);
  }
  const r = cred.response;
  return capi('auth/signin', 'POST', { challengeId: begin.challengeId, id: b64u(cred.rawId), clientDataJSON: b64u(r.clientDataJSON),
    authenticatorData: b64u(r.authenticatorData), signature: b64u(r.signature), name: deviceName() });
}

// This browser has no passkey: it shows a code, and the owner lets it in from a device that's signed in.
// One of the owner's 10 recovery codes: this browser is signed in, with no other device (and may then add its own
// passkey for 15 minutes).
async function signInWithRecovery() {
  const field = h('input', { class: 'input', type: 'text', autocomplete: 'one-time-code', autocapitalize: 'characters', spellcheck: 'false', maxlength: '40', placeholder: 'XXXXX-XXXXX-XXXXX-XXXXX', 'aria-label': 'Recovery code' });
  const ok = await dialog({
    title: 'Sign in with a recovery code', confirm: 'Sign in',
    description: 'Type one of the 10 recovery codes you saved. Each works once.',
    body: h('label', { class: 'field' }, 'Recovery code', field),
    focus: field,
    onConfirm: async () => {
      const r = await capi('auth/signin/recovery', 'POST', { code: field.value, name: deviceName() });
      if (r?.left !== undefined && r.left <= 3) toast(`${r.left} recovery ${r.left === 1 ? 'code' : 'codes'} left`, { sub: 'Make new ones under Your passkey.', timeout: 9000 });
      return true;
    },
  });
  if (ok) location.reload();
}
async function signInWithCode() {
  const start = await capi('auth/device/start', 'POST', { kind: 'browser', name: deviceName() });
  const status = h('p', { class: 'signin-wait', 'aria-live': 'polite' }, h('span', { class: 'spinner sm' }), 'Waiting for you to let it in…');
  const shown = h('div', { class: 'signin' });
  let stop = false;
  (async () => {
    while (!stop) {
      await new Promise(r => setTimeout(r, (start.interval || 3) * 1000));
      if (stop) return;
      try {
        const res = await fetch(`${CONSOLE_API}auth/device/poll`, { method: 'POST', body: JSON.stringify({ deviceCode: start.deviceCode }),
          headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Spark-Console': '1' } });
        if (res.status === 200) { stop = true; location.reload(); return; }
        if (res.status === 410) {
          stop = true;
          shown.classList.add('expired');
          redraw(status, icon('alert'), (await res.json().catch(() => null))?.error || 'That code expired. Start again.');
          return;
        }
      } catch {}
    }
  })();
  set(shown,
    h('div', { class: 'device-code' }, start.code),
    h('p', { class: 'muted signin-fine' }, 'The code works for 10 minutes.'));
  await dialog({
    title: 'Sign in with a code', confirm: 'Close', cancel: null, dismissable: false,
    description: 'On a device that’s signed in: account menu › Let a device in, then type this code.',
    body: h('div', { class: 'signin' }, shown, status),
  });
  stop = true;
}

// Let a device in by the code it shows, typed here (account menu or Your devices; never from a link, which someone else
// could send). The passkey confirms it.
async function letDeviceIn() {
  const lookUp = c => capi(`auth/device/${encodeURIComponent(c)}`);
  let d;
  {
    const input = h('input', { class: 'input device-code-input', type: 'text', maxlength: '12', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'BCDF-2345' });
    d = await dialog({
      title: 'Let a device in', confirm: 'Continue', description: 'Enter the code the other device shows.',
      body: h('label', { class: 'field' }, 'Code', input), focus: input,
      onConfirm: async () => {
        const c = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (c.length !== 8) throw new Error('The code has 8 letters and numbers.');
        return lookUp(`${c.slice(0, 4)}-${c.slice(4)}`);
      },
    });
    if (!d) return;
  }
  let turnedAway = false;
  const yes = await dialog({
    title: `Let “${d.name}” in?`, confirm: 'Let it in', cancel: null, dismissable: false,
    description: 'It signs in as you, with full access. Say yes only if you just started this yourself.',
    body: h('div', { style: { display: 'grid', gap: '12px' } },
      h('div', { class: 'change-summary' }, `${d.kind === 'terminal' ? 'A terminal' : 'A browser'} called “${d.name}”, asked ${fmt.ago(Date.parse(d.at))} from ${d.from || 'an unknown address'}${d.fromInternet ? ' on the internet' : ' on your tailnet'}. Code ${d.code}.`),
      d.fromInternet ? h('p', { class: 'muted signin-fine' }, 'Its name is whatever the device said. If you didn’t start this yourself, say No.') : null),
    setup: ({ ok, done }) => ok.before(h('button', { class: 'btn', type: 'button', onclick: () => { turnedAway = true; done(null); } }, 'No')),
    onConfirm: () => capi('auth/device/approve', 'POST', { code: d.code }),
  });
  if (!yes) { if (turnedAway) capi('auth/device/deny', 'POST', { code: d.code }).catch(() => {}); return; }
  toast(`${d.name} can sign in now`, { sub: 'It signs in within a few seconds, then shows under Your devices.' });
  setTimeout(loadSessions, 5000);
}

async function loadSessions() {
  try { state.sessions = (await capi('auth/sessions')).sessions; state.sessionsError = null; } catch (e) { state.sessionsError = e.message; }
  runLive();
}
async function signOutDevice(s) {
  await capi(`auth/sessions/${s.id}`, 'DELETE');
  if (s.current) { location.reload(); return; }
  toast(`${s.name} is signed out`);
  await loadSessions();
}
async function signOutHere() {
  try { await capi('auth/signout', 'POST', {}); } catch (e) { toast(e.message, { kind: 'bad' }); return; }
  location.reload();
}
// Your devices → the ones signed in without Tailscale.
function sessionsSection() {
  const list = state.sessions;
  return [h('h3', {}, 'Signed in without Tailscale'),
    h('p', { class: 'muted' }, 'Each stays signed in until 60 days after it was last used.'),
    state.sessionsError ? failBanner('Couldn’t load your signed-in devices', state.sessionsError, loadSessions)
      : !list ? h('p', { class: 'muted' }, 'Loading…')
        : !list.length ? h('p', { class: 'muted' }, 'None yet.')
          : h('div', { class: 'card rows sessions' }, list.map(s => h('div', { class: 'row' },
            h('div', { class: 'row-main' }, h('span', { class: 'row-icon' }, icon(s.kind === 'terminal' ? 'terminal' : 'monitor')),
              h('div', { class: 'row-text' }, h('div', { class: 'row-title' }, s.name, s.current ? [' ', pill('This device')] : null),
                h('div', { class: 'row-sub muted' }, [s.kind === 'terminal' ? 'Terminal' : 'Browser', s.via === 'passkey' ? 'with your passkey' : 'with a code', `used ${fmt.ago(Date.parse(s.lastUsedAt))}${s.lastFrom ? ` from ${s.lastFrom}` : ''}`].join(' · ')))),
            h('button', { class: 'btn sm', type: 'button', 'aria-label': `Sign out ${s.name}`, onclick: e => busy(e.currentTarget, () => signOutDevice(s)) }, 'Sign out')))),
    h('div', {}, h('button', { class: 'btn sm', type: 'button', onclick: () => letDeviceIn() }, icon('plus'), 'Let a device in'))];
}

/* ───────── the owner's passkey ───────── */
// Tailscale says who you are. For the few changes to who has access (people, invites, agent keys and their rights), the
// owner also confirms with a passkey: Touch ID, Face ID, a phone or a security key. The service binds each confirmation
// to that exact request.
const calmError = (message, link = null) => Object.assign(new Error(message), { calm: true, link });
const passkeysWork = () => Boolean(window.isSecureContext && window.PublicKeyCredential && navigator.credentials?.create);
const b64u = buf => {
  let s = '';
  for (const b of ArrayBuffer.isView(buf) ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) : new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64u = s => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4)), c => c.charCodeAt(0));
// A passkey made for a domain works at this address when the domain is this host or a parent of it.
const fitsHere = (domain, host = location.hostname) => Boolean(domain) && (host === domain || host.endsWith(`.${domain}`));
// Where something passkey-related can be done instead: the main address unless told otherwise.
const mainLink = (origin = state.boot?.main) => (origin ? { href: `${String(origin).replace(/\/$/, '')}/`, label: 'Open it there' } : null);
// The browser turned down the domain the passkey is for (as opposed to someone pressing Cancel).
const rpRefused = e => e?.name === 'SecurityError' || (e?.name === 'NotAllowedError' && /rp ?id|relying party/i.test(e.message || ''));
// The passkeys that work at this address: the tailnet's domain before the address's own host.
function usablePasskeys(allow = []) {
  const usable = allow.filter(a => fitsHere(a.rpId));
  if (!usable.length) return null;
  const rpId = usable.map(a => a.rpId).sort((a, b) => a.length - b.length)[0];
  return { rpId, allowCredentials: usable.filter(a => a.rpId === rpId).map(a => ({ type: 'public-key', id: fromB64u(a.id) })) };
}
// The request's path as the service sees it.
const apiTarget = path => new URL(`${CONSOLE_API}${path}`, location.href).pathname.replace(/^\/console\/api(?=\/|$)/, '');
// The change being confirmed, in the service's plain words.
const changeBox = summary => (summary ? h('div', { class: 'change-summary' }, summary) : null);
const passkeyMiss = e => (e.name === 'NotAllowedError' || e.name === 'AbortError' ? 'Your passkey didn’t confirm it. Try again when you’re ready.' : e.message);

// Browsers show the passkey prompt only soon after a click. When that moment has passed (or the browser turns the
// request down at once for that reason), a small dialog asks for one more click.
async function passkeyCall(kind, publicKey, ask) {
  const call = () => navigator.credentials[kind]({ publicKey });
  if (!navigator.userActivation || navigator.userActivation.isActive) {
    const t0 = Date.now();
    try { return await call(); } catch (e) { if (e.name !== 'NotAllowedError' || Date.now() - t0 > 1500 || rpRefused(e)) throw e; }
  }
  let failed = null;
  const cred = await dialog({ ...ask, onConfirm: () => call().catch(e => { failed = e; return null; }) });
  if (failed) throw failed;
  if (!cred) throw new DOMException('Cancelled.', 'NotAllowedError');
  return cred;
}

// The answer to a 428 (at the main address): the service's one-time challenge for exactly this request (method, path and
// body), signed by the owner's passkey, ready for the X-Spark-Passkey header. The change is shown in plain words first,
// and the passkey is asked for from that dialog's button (which also gives Safari the click it needs).
async function confirmWithPasskey(method, path, text) {
  if (!passkeysWork()) throw calmError('Not changed: this browser can’t use passkeys. Open Spark Console in Safari, Chrome, Edge or Firefox.');
  const begin = await capi('auth/passkey/begin', 'POST', { purpose: 'confirm', method, path: apiTarget(path), body: text === undefined ? {} : JSON.parse(text) });
  const pick = usablePasskeys(begin.allow);
  const elsewhere = domain => calmError(`Your passkey was set up for ${domain}. Open Spark Console at ${state.boot?.main || domain} to do this.`, mainLink());
  if (!pick) throw elsewhere(begin.allow?.[0]?.rpId || 'another address');
  let refused = false;
  const cred = await dialog({
    title: 'Confirm with your passkey', confirm: 'Use passkey',
    description: begin.summary ? 'Check that this is the change you asked for.' : 'Changes to who has access need your fingerprint, face or security key.',
    body: changeBox(begin.summary),
    onConfirm: async () => {
      try {
        return await navigator.credentials.get({ publicKey: { challenge: fromB64u(begin.challenge), rpId: pick.rpId, allowCredentials: pick.allowCredentials, userVerification: 'required', timeout: 120000 } });
      } catch (e) {
        if (rpRefused(e)) { refused = true; return null; }
        throw new Error(passkeyMiss(e));
      }
    },
  });
  if (refused) throw elsewhere(pick.rpId);
  if (!cred) throw calmError('Not changed: you didn’t confirm with your passkey.');
  const r = cred.response;
  return b64u(new TextEncoder().encode(JSON.stringify({ challengeId: begin.challengeId, id: b64u(cred.rawId),
    clientDataJSON: b64u(r.clientDataJSON), authenticatorData: b64u(r.authenticatorData), signature: b64u(r.signature) })));
}

// A new passkey for the tailnet's domain. There's no fallback to the address's own host: passkeys made for different
// domains can't be offered together, so one could hide another.
async function createPasskey(begin) {
  const ids = (begin.rpIds || []).filter(id => fitsHere(id)).sort((a, b) => a.length - b.length);
  if (!ids.length) throw calmError('Passkeys are set up at Spark Console’s main address.', mainLink());
  const options = rpId => ({
    challenge: fromB64u(begin.challenge), rp: { id: rpId, name: 'Spark Console' },
    user: { id: fromB64u(begin.user.id), name: begin.user.name, displayName: begin.user.name },
    pubKeyCredParams: [-7, -8, -257].map(alg => ({ type: 'public-key', alg })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' }, attestation: 'none',
    excludeCredentials: (begin.exclude || []).map(id => ({ type: 'public-key', id: fromB64u(id) })), timeout: 120000,
  });
  const ask = { title: 'Make your passkey', confirm: 'Continue', description: 'Your browser asks for your fingerprint, face or screen lock.' };
  return passkeyCall('create', options(ids[0]), ask);
}
const passkeyTrouble = e => (e.name === 'InvalidStateError' ? 'This device already has a passkey for Spark Console.'
  : e.name === 'NotAllowedError' || e.name === 'AbortError' ? 'No passkey was made. Try again when you’re ready.'
    : e.name === 'SecurityError' ? 'This browser won’t make a passkey for this address. Try another browser.' : e.message);
// A name for a new passkey: the kind of device it's made on.
function deviceName() {
  const ua = `${navigator.userAgentData?.platform || ''} ${navigator.userAgent}`;
  return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad'
    : /Android/.test(ua) ? 'Android phone' : /mac/i.test(ua) ? 'Mac' : /Win/.test(ua) ? 'Windows PC' : /CrOS/.test(ua) ? 'Chromebook'
      : /Linux/.test(ua) ? 'Linux computer' : 'This device';
}

async function loadPasskeys() {
  try { state.passkeys = await capi('auth/passkeys'); } catch (e) { state.passkeys = { error: e.message, keys: [] }; }
  runLive();
}
// Set up a passkey on this device, named after it. Another one is confirmed with a passkey already set up.
// A browser signed in a few minutes ago with a recovery code, or let in with a code, adds its own passkey without
// another one (once, within 15 minutes).
const newDevicePasskey = () => { const x = state.boot?.session; return Boolean(x?.kind === 'browser' && x.letInAt && !x.passkeyAddedAt && Date.now() - Date.parse(x.letInAt) < 15 * 60000); };
async function addPasskey() {
  const more = (state.passkeys?.keys || []).length > 0 || state.boot?.passkeys > 0, fresh = newDevicePasskey();
  const name = h('input', { class: 'input', type: 'text', maxlength: '60', autocomplete: 'off', value: deviceName() });
  const made = await dialog({
    title: more ? 'Add another passkey' : 'Set up a passkey', confirm: 'Continue',
    description: fresh ? 'Your browser makes a passkey for this device. You signed in here a few minutes ago, so no other passkey is needed.'
      : more ? 'Your browser makes the new passkey, then asks for one you already have to confirm it.'
      : 'Your browser asks for your fingerprint, face or screen lock (or a phone or security key). There’s nothing to remember.',
    body: h('label', { class: 'field' }, 'Name', name),
    onConfirm: async () => {
      const begin = await capi('auth/passkey/begin', 'POST', { purpose: 'register' });
      let cred;
      try { cred = await createPasskey(begin); } catch (e) { throw e.calm ? e : new Error(passkeyTrouble(e)); }
      return capi('auth/passkey/register', 'POST', { challengeId: begin.challengeId, name: name.value.trim() || deviceName(),
        clientDataJSON: b64u(cred.response.clientDataJSON), attestationObject: b64u(cred.response.attestationObject) });
    },
  });
  if (!made) return;
  toast(`${made.name} is set up`, { sub: 'Changes to who has access now ask for your passkey.' });
  await Promise.all([loadPasskeys(), refreshBoot()]);
  document.getElementById('add-passkey')?.focus();
}
async function removePasskey(k) {
  const last = (state.passkeys?.keys || []).length === 1;
  const ok = await dialog({
    title: `Remove ${k.name}?`, confirm: 'Remove', danger: true,
    description: last ? 'It’s your only passkey. Without one, you can’t sign in from the internet with a passkey: only Tailscale or a recovery code gets you in. A new passkey can only be set up with Tailscale on. Changes to who has access will stop asking for one.' : 'Your other passkeys keep working.',
  });
  if (!ok) return;
  try { await capi(`auth/passkeys/${encodeURIComponent(k.id)}`, 'DELETE'); toast(`Removed ${k.name}`); } catch (e) { failToast(e); }
  await Promise.all([loadPasskeys(), refreshBoot()]);
}

/* ───────── models: the library, starting and stopping, jobs ───────── */
// While a load is under way, callers share it, so awaiting it always waits for the answer.
let libLoad = null;
function loadLibrary() {
  if (libLoad) return libLoad;
  state.lib.loading = true;
  return (libLoad = (async () => {
    try {
      state.lib.data = await capi('models');
      state.lib.error = null;
      state.lib.missing = false;
    } catch (e) {
      state.lib.error = e.message;
      state.lib.missing = Boolean(e.missing);
      if (e.missing) { clearTimeout(state.lib.retry); state.lib.retry = setTimeout(loadLibrary, 6000); }
    } finally {
      state.lib.loading = false;
      state.lib.at = Date.now();
      libLoad = null;
      runLive();
    }
  })());
}

async function loadRecipes() {
  if (state.recipes.loading) return;
  state.recipes.loading = true;
  try {
    state.recipes.data = await capi('recipes');
    state.recipes.error = null;
    state.recipes.missing = false;
  } catch (e) {
    state.recipes.error = e.message;
    state.recipes.missing = Boolean(e.missing);
    if (e.missing) { clearTimeout(state.recipes.retry); state.recipes.retry = setTimeout(loadRecipes, 6000); }
  } finally {
    state.recipes.loading = false;
    runLive();
  }
}

// A model named by the service (library name or Hugging Face repo), by its title when the library knows it.
const titleOf = name => { const m = (state.lib.data?.library || []).find(x => x.name === name) || libFor(name); return m ? modelTitle(m) : name; };
const SVC_LABEL = {
  deploy: j => `Start ${titleOf(j.model)} on ${nodeName(j.node)}`,
  'deploy-cluster': j => `Start ${titleOf(j.model)} across ${(j.nodes || []).map(nodeName).join(' + ')}`,
  stop: j => `Stop ${containerTitle(j.container)} on ${nodeName(j.node)}`,
  restart: j => `Restart ${containerTitle(j.container)} on ${nodeName(j.node)}`,
  // Started by Sparkie or an agent: downloads it first if it isn't on the Spark yet, then starts it.
  'start-model': j => `Start ${titleOf(j.model)} on ${(j.nodes || [j.node]).map(nodeName).join(' + ')}`,
  download: j => `Download ${j.model} to ${nodeName(j.node)}`,
  'main-start': j => `Start ${j.model} on ${nodeName(j.node)}`,
  'main-stop': j => `Stop ${j.model} on ${nodeName(j.node)}`,
  'spark-action': j => `${actionLabel(j.action) || 'Change'} on ${nodeName(j.node)}`,
  'main-switch': j => `Switch ${ASSISTANT} to ${j.model}`,
  dig: j => `Find setups for ${j.model}`,
  'add-list': j => `Add ${j.model} from Hugging Face`,
  // Turning a Spark off or on (the smart plugs, contract 9.22); a start that needed one turned on says which model.
  'power-off': j => `Power off ${(j.nodes || [j.node]).map(nodeName).join(' + ')}`,
  'power-on': j => `Turn on ${(j.nodes || [j.node]).map(nodeName).join(' + ')}${j.model ? ` for ${titleOf(j.model)}` : ''}`,
};
const jobPercent = j => (j.progress?.total ? Math.min(99, Math.round((j.progress.done / j.progress.total) * 100)) : null);

async function followServiceJob(job) {
  const key = `svc-${job.id}`, label = SVC_LABEL[job.type]?.(job) || 'Working';
  let j = job;
  const started = Date.now();
  state.svcJobs.set(j.id, j);
  while (underWay(j)) {
    const pct = jobPercent(j);
    // After a few seconds, progress carries on in Activity (the badge counts it) instead of a toast on every page.
    if (Date.now() - started > 12000 && !dismissedToasts.has(key)) { dismissedToasts.add(key); $(`#toasts [data-id="${key}"]`)?.remove(); }
    if (!dismissedToasts.has(key)) toast(label, { kind: 'busy', sub: [`${j.step}${pct != null ? ` · ${pct}%` : ''}`, h('button', { class: 'link-btn', type: 'button', onclick: () => openActivity(j.id) }, 'Details')], timeout: 0, id: key });
    runLive();
    await sleep(1500);
    try {
      j = await capi(`jobs/${job.id}`);
      state.svcJobs.set(j.id, j);
    } catch (e) {
      if (e.status === 404 || e.missing) { j = { ...j, status: 'failed', error: e.message }; break; }
    }
  }
  state.svcJobs.set(j.id, j);
  const found = j.result && num(j.result.found) ? `${plural(j.result.found, 'setup')} found, ${j.result.oneClick} one click` : null;
  dismissedToasts.delete(key);
  const deployNow = j.type === 'download' && j.status === 'completed' && canRun()
    ? h('button', { class: 'link-btn', type: 'button', onclick: async () => { await loadLibrary(); const m = libFor(j.repo); if (m) startModel(m); else go('models/library'); } }, 'Start it') : null;
  if (j.status === 'completed') toast(`${label}: done`, { sub: [j.endpoint ? `Serving at ${j.endpoint}${j.tailnetLink ? ` (on your tailnet: ${j.tailnetLink})` : ''}` : found, deployNow].filter(Boolean), id: key, timeout: deployNow ? 15000 : 9000 });
  else toast(`${label} failed`, { kind: 'bad', sub: [String(j.error || '').split('\n')[0], ' ', h('button', { class: 'link-btn', type: 'button', onclick: () => openActivity(j.id) }, 'See what happened')], id: key, timeout: 20000 });
  loadJobs();
  loadLibrary();
  if (['download', 'dig', 'add-list'].includes(j.type)) loadRecipes();
  if (j.type.startsWith('main-')) { loadMain(); loadMainChoices(); }
  loadStatus();
  return j;
}

// The service didn't answer: usually it's restarting for a moment after an update, and the page tries again on its own.
// Only a service too old for this page (outdated) needs the install command.
function serviceMissing(what, outdated = false) {
  if (!outdated) {
    return h('div', { class: 'card' }, empty('refresh', 'Spark Console’s service didn’t answer',
      `${what} come from it. It restarts for a moment after an update; this page tries again every few seconds.`));
  }
  const command = 'bash spark-console/deploy/host-on-portal.sh';
  return h('div', { class: 'card' }, empty('server', 'Update the Spark Console service',
    `${what} need a newer Spark Console service on Spark 2. Run this on your Mac once, then refresh:`,
    h('div', { class: 'connect-line' }, h('code', {}, command),
      h('button', { class: 'btn ghost sm icon-only', type: 'button', 'aria-label': 'Copy command', onclick: () => copy(command) }, icon('copy')))));
}

// POST that answers with server-sent events; calls onEvent with each parsed event.
async function streamChat(path, body, onEvent) {
  const res = await fetch(`${CONSOLE_API}${path}`, {
    method: 'POST',
    headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json', 'X-Spark-Console': '1' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error || `${ASSISTANT} couldn’t answer (error ${res.status}). Try again in a moment.`);
  }
  const reader = res.body.getReader(), decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const line = buf.slice(0, i).split('\n').find(l => l.startsWith('data:'));
      buf = buf.slice(i + 2);
      if (line) { try { onEvent(JSON.parse(line.slice(5))); } catch {} }
    }
  }
}

// What Sparkie did while answering, one quiet line each: "Checked Fleet status · 0.4 s", "Started: Start a model".
// The same lookup made more than once is one line; changes are always listed one by one. A change that only asked
// (which model? OK to stop this?) waits for a button below, so it doesn't say Started. The service marks those with
// outcome; without it, buttons on the message say the same.
// How a change was checked (docs/contract.md 7.9): its plan, folded away. And numbers in the answer no tool reported.
const SOURCE_WORDS = { said: 'from your words', live: 'from what’s running', chosen: 'chosen by Spark Console', owner: 'you picked it' };
const INPUT_NAMES = { spark: 'Spark', sparks: 'Sparks', model: 'Model', container: 'Model', setup: 'Recipe setup', id: 'Operation' };
const inputValue = i => (i.name === 'spark' && /^spark\d$/.test(i.value) ? nodeName(i.value) : i.name === 'sparks' ? i.value.split(' + ').map(x => (/^spark\d$/.test(x) ? nodeName(x) : x)).join(' + ')
  : i.name === 'container' ? containerTitle(i.value) : i.value);
function checkedFold(m) {
  const plans = (m.tools || []).filter(t => t.plan).map(t => t.plan);
  const odd = m.unverified || [];
  if (!plans.length && !odd.length) return null;
  return h('div', { class: 'msg-checked' },
    plans.length ? h('details', {}, h('summary', {}, 'How this was checked'),
      plans.map(p => h('div', { class: 'check-plan' },
        h('div', {}, h('strong', {}, p.title)),
        h('ul', {}, p.inputs.map(i => h('li', {}, `${INPUT_NAMES[i.name] || i.name}: ${inputValue(i)} `, h('span', { class: 'muted' }, `(${SOURCE_WORDS[i.source] || i.source})`))),
          p.checks.map(c => h('li', { class: 'muted' }, `✓ ${c}`)))))) : null,
    odd.length ? h('p', { class: 'muted msg-unverified' }, `Not confirmed by your Sparks: ${odd.join(', ')}. Double-check these.`) : null);
}

function toolLines(tools, asked = false) {
  const lines = [];
  for (const t of tools) {
    const same = !t.change && lines.find(x => !x.change && x.name === t.name && x.ok === t.ok);
    if (same) { same.times++; same.ms += num(t.ms) ? t.ms : 0; } else lines.push({ ...t, times: 1, ms: num(t.ms) ? t.ms : 0 });
  }
  const took = ms => (ms >= 10000 ? `${Math.round(ms / 1000)} s` : `${Math.max(0.1, ms / 1000).toFixed(1)} s`);
  const times = n => (n === 2 ? ' twice' : n > 2 ? ` ${n} times` : '');
  return h('ul', { class: 'msg-tools', 'aria-label': `What ${ASSISTANT} did` }, lines.map(t => {
    const title = t.title || t.name;
    const waits = t.outcome ? ['question', 'needs-ok'].includes(t.outcome) : asked;
    return h('li', {}, t.change ? (t.ok && waits ? `${title}: asked ${t.outcome === 'needs-ok' ? 'for your OK' : 'you to choose'}` : `${t.ok ? 'Started' : 'Couldn’t'}: ${title}`)
      : t.ok ? `Checked ${title}${times(t.times)}${t.ms ? ` · ${took(t.ms)}` : ''}` : `Couldn’t check ${title}${times(t.times)}`);
  }));
}

const engineName = engine =>({ sglang: 'SGLang', trtllm: 'TensorRT-LLM', 'llama.cpp': 'llama.cpp', triton: 'Triton', ollama: 'Ollama', lmstudio: 'LM Studio', other: 'Custom setup' }[engine] || (engine && engine !== 'vllm' ? engine : 'vLLM'));

// The same model from different publishers or in different quantizations (RadixArk/…, unsloth/…, nvidia/…Qwen3.8-27B-NVFP4,
// …-FP8) is one Library row with its versions underneath, opened on request. Draft models and fine-tunes (other names)
// stay their own rows.
const QUANT_RE = /[-_.](nvfp4|mxfp4|fp8(-dynamic)?|fp4|bf16|fp16|awq|gptq|int4|int8|w4a16|w8a8|gguf|4bit|8bit)$/i;
const modelBase = m => {
  let base = String(m.repo || m.name).split(/\/|--/).pop();
  for (let i = 0; i < 3 && QUANT_RE.test(base); i++) base = base.replace(QUANT_RE, '');
  return base;
};
const modelQuant = m => (String(m.repo || m.name).match(/(NVFP4|MXFP4|FP8|FP4|BF16|AWQ|GPTQ|INT4|INT8|W4A16|GGUF)/i)?.[1] || m.dtype || '').toUpperCase();
const modelPublisher = m => (m.repo ? m.repo.split('/')[0] : String(m.name).includes('--') ? m.name.split('--')[0] : null);
const libOpen = new Set();
function libraryRows(d, row) {
  const groups = new Map();
  for (const m of d.library) {
    const key = m.role === 'draft' ? 'drafts' : modelBase(m).toLowerCase();
    groups.set(key, [...(groups.get(key) || []), m]);
  }
  const drafts = groups.get('drafts');
  groups.delete('drafts');
  if (drafts) groups.set('drafts', drafts);
  return [...groups].flatMap(([key, list]) => {
    if (key === 'drafts') {
      const open = libOpen.has(key), toggle = () => { if (open) libOpen.delete(key); else libOpen.add(key); runLive(); };
      return [h('tr', { class: 'lib-group' },
        h('td', {}, h('div', { class: 'cell-main' }, h('span', { class: 'row-icon' }, icon('layers')),
          h('div', { style: { 'min-width': '0' } }, h('strong', {}, plural(list.length, 'draft model')),
            h('div', { class: 'row-sub' }, 'Helpers for speculative decoding. They run alongside their main model, not on their own.')))),
        h('td', {}),
        h('td', { class: 'num' }, h('button', { class: 'btn sm', type: 'button', 'aria-expanded': String(open), onclick: toggle }, open ? 'Hide' : 'Show', icon(open ? 'chevronDown' : 'chevronRight')))),
        ...(open ? list.map(m => { const tr = row(m); tr.classList.add('lib-child'); return tr; }) : [])];
    }
    if (list.length === 1) return [row(list[0])];
    const open = libOpen.has(key), toggle = () => { if (open) libOpen.delete(key); else libOpen.add(key); runLive(); };
    const sparks = [...new Set(list.flatMap(m => m.copies || []))];
    const running = d.sparks.filter(sp => sp.deployments.some(x => list.some(m => m.name === x.model) && x.state === 'running' && !x.rank)).map(sp => sp.id);
    const head = h('tr', { class: 'lib-group' },
      h('td', {}, h('div', { class: 'cell-main' }, h('span', { class: 'row-icon' }, icon('layers')),
        h('div', { style: { 'min-width': '0' } }, h('strong', {}, modelBase(list[0]),
          list.some(m => m.verified?.length) ? [' ', h('span', { class: 'tag' }, 'Verified')] : null),
          h('div', { class: 'row-sub' }, `${list.length} versions: ${list.map(m => [modelQuant(m), modelPublisher(m)].filter(Boolean).join(' · ')).join(', ')}`)))),
      h('td', {}, h('div', { class: 'members' }, running.length
        ? running.map(id => h('span', { class: 'chip ok' }, led('running'), `Running on ${nodeName(id)}`))
        : sparks.map(id => h('span', { class: 'chip' }, icon('disk'), nodeName(id))))),
      h('td', { class: 'num' }, h('button', { class: 'btn sm', type: 'button', 'aria-expanded': String(open), onclick: toggle }, open ? 'Hide versions' : 'Show versions', icon(open ? 'chevronDown' : 'chevronRight'))));
    return [head, ...(open ? list.map(m => { const tr = row(m); tr.classList.add('lib-child'); return tr; }) : [])];
  });
}
const gb = bytes => (num(bytes) ? `${Math.round(bytes / 1e9)} GB` : '—');
// The best speed measured on these Sparks for a library model (on this many Sparks, when given).
function measuredText(m, sparks = null) {
  const runs = (m?.verified || []).filter(v => v.best && (!sparks || v.sparks === sparks)).sort((a, b) => b.best.decodeTokS - a.best.decodeTokS);
  const v = runs[0];
  return v ? [`${tokS(v.best.decodeTokS)} measured${sparks ? '' : ` on ${sparksText(v.sparks)}`}`, ...perfBits({ ttftMs: v.best.ttftMs })].join(', ') : null;
}
// Every Start button comes here: the start dialog, with where the model fits best already picked.
const startModel = (m, options) => openDeploy(m, options);
// Where apps that use the OpenAI API reach Sparkie's model (and the others, by name).
const appsEndpoint = () => new URL(`${CONSOLE_API}v1`, location.href).href;

/* ───────── models page: Running · On your Sparks · Find more ───────── */
const MODEL_TABS = [['#/models', 'Running', 'zap'], ['#/models/library', 'On your Sparks', 'disk'], ['#/models/find', 'Find more', 'search']];
PAGES.models = function modelsPage(view, r) {
  const tab = r.a === 'library' || r.a === 'find' ? r.a : 'running';
  const sub = {
    running: 'What’s answering on your Sparks right now.',
    library: 'Every model stored on your online Sparks. Start any of them on any online Spark.',
    find: 'Models that run well on DGX Spark, the setups people use and how fast they are.',
  }[tab];
  const content = h('div', { class: 'stack' });
  put(view,
    pageHead('Models', sub,
      tab !== 'find' && canRun() ? h('button', { class: 'btn', type: 'button', onclick: e => openDeployPicker({ button: e.currentTarget }) }, icon('play'), 'Start a model') : null,
      tab !== 'find' ? h('button', { class: 'btn icon-only', type: 'button', 'aria-label': 'Refresh', title: 'Refresh', onclick: e => busy(e.currentTarget, loadLibrary) }, icon('refresh')) : null),
    pageTabs('Models', MODEL_TABS, tab === 'running' ? '#/models' : `#/models/${tab}`),
    content);
  ({ running: runningTab, library: libraryTab, find: findMoreTab })[tab](content);
  if (!state.lib.loading && (!state.lib.data || Date.now() - state.lib.at > 10000)) loadLibrary();
};

// Running: Sparkie's model, then everything else that answers on the Sparks.
function runningTab(box) {
  const lib = state.lib, mainBox = h('div'), running = h('div');
  put(box, mainBox, running);

  // Sparkie: which model it answers with (any running model, or one on disk started as its own), and, under Advanced,
  // which model apps get at Sparkie's address.
  let mainKey = null;
  live(() => {
    const m = state.main.data, choices = state.mainChoices;
    if (!m?.configured && !m?.routes?.chat) { redraw(mainBox); return; }
    const key = JSON.stringify([m, choices, owner()]);
    if (key === mainKey) return;
    mainKey = key;
    const [label, kind] = mainState(m), on = ['running', 'restarting'].includes(m.state);
    const chat = m.routes?.chat, agents = m.routes?.agents, onMain = !chat || chat.kind === 'main';
    const problems = [
      !m.online ? m.error : null,
      m.online && !m.ready?.model ? `${m.model} isn’t on ${nodeName(m.node)}.` : null,
      m.online && m.draft && !m.ready?.draft ? `${m.draft} (its draft model) isn’t on ${nodeName(m.node)}.` : null,
      m.online && !m.local ? `It’s set to run on ${nodeName(m.node)}, but chats can only reach a model on the Spark that runs Spark Console.` : null,
    ].filter(Boolean);
    const endpoint = appsEndpoint();
    // Next to the model: the dedicated model's state and Start/Stop when Sparkie uses it, else whether the running
    // model it uses answers.
    const startStop = owner() && m.configured && m.online && !m.busy
      ? (on ? h('button', { class: 'btn sm', type: 'button', onclick: stopMain }, icon('stop'), 'Stop')
        : h('button', { class: 'btn sm primary', type: 'button', disabled: problems.length > 0, onclick: openMainStart }, icon('play'), 'Start'))
      : null;
    const modelRow = h('div', { class: 'sparkie-row' },
      owner() ? mainSelect('chat', m, choices) : h('strong', {}, chat?.title || m.title),
      onMain ? [pill(label, kind), startStop] : pill(chat?.healthy ? 'Answering' : 'Not answering', chat?.healthy ? 'ok' : 'warn'));
    const detail = onMain
      ? h('span', { title: 'Spark Console keeps it running: it restarts after a reboot, and starting other models never stops it.' },
        [nodeName(m.node), engineName(m.engine), m.about, m.healthy && m.startedAt ? `up since ${fmt.when(m.startedAt)}` : null].filter(Boolean).join(' · '))
      : h('span', {}, `${nodeName(chat.node)} · already running there`,
        m.configured && on ? [` · ${m.title}, ${ASSISTANT}’s own model, is still running on ${nodeName(m.node)}. `,
          owner() && !m.busy ? h('button', { class: 'btn ghost sm', type: 'button', onclick: stopMain }, icon('stop'), 'Stop it') : null] : null);
    // "Model for apps": what anything using the OpenAI API gets at Sparkie's address (the service calls this route
    // "agents"; Agents on Access are something else).
    redraw(mainBox, panel(ASSISTANT, [
      h('div', { class: 'sparkie-fields' },
        h('div', { class: 'sparkie-control' }, modelRow, h('div', { class: 'row-sub', style: { 'white-space': 'normal' } }, detail)),
        onMain && problems.length ? h('div', { class: 'banner warn', style: { margin: '0' } }, icon('alert'), h('div', { class: 'banner-text' }, problems.map(t => h('p', {}, t)))) : null),
      h('details', { class: 'fold sparkie-advanced' }, h('summary', {}, 'Advanced'),
        h('div', { class: 'fold-body' },
          h('div', { class: 'field' }, h('span', {}, 'Model for apps'),
            h('div', { class: 'sparkie-row' },
              owner() ? mainSelect('agents', m, choices) : h('strong', {}, agents?.same ? `Same as ${ASSISTANT}` : agents?.title || '—'),
              h('button', { class: 'btn sm', type: 'button', title: `Apps that use the OpenAI API connect at ${endpoint}, with model “sparkie” and any API key.`,
                onclick: () => copy(endpoint, `Copied: ${endpoint}`) }, icon('copy'), 'Copy address'))))),
    ], { tight: true, sub: `The model ${ASSISTANT} answers with. Pick a running model, or one on disk to start.` }));
  });
  if (owner() && !state.mainChoicesLoading) loadMainChoices();

  live(() => {
    const d = lib.data, rows = [], m = state.main.data;
    if (lib.missing) { redraw(running, serviceMissing('Running models')); return; }
    // Sparkie's dedicated model first. It only listens on its own Spark, so other tools reach it through Spark Console's
    // OpenAI-compatible address, by its own model name (stop it from the Sparkie panel above).
    const sparkieOn = m?.configured && ['running', 'restarting'].includes(m.state);
    if (sparkieOn) {
      const endpoint = appsEndpoint();
      rows.push(h('div', { class: 'row' },
        h('div', { class: 'row-main' }, h('span', { class: `row-icon ${m.healthy ? 'ok' : ''}` }, icon('sparkle')),
          h('div', { class: 'row-text' }, h('div', { class: 'row-title' }, m.title),
            h('div', { class: 'row-sub', style: { 'white-space': 'normal' } }, [nodeName(m.node), `${ASSISTANT}’s model`, m.healthy ? null : 'loading', measuredText(d?.library.find(x => x.name === m.model || repoKey(x.repo || x.name) === repoKey(m.model)), 1)].filter(Boolean).join(' · ')))),
        h('div', { class: 'row-side' },
          h('button', { class: 'btn ghost sm', type: 'button', title: `${endpoint} · model ${m.served} · any API key`, onclick: () => copy(endpoint, `Copied: ${endpoint} · model ${m.served}`) }, icon('copy'), 'Copy address'),
          pill(m.healthy ? 'Running' : 'Loading', m.healthy ? 'ok' : 'info'))));
    }
    for (const sp of d?.sparks || []) {
      // A model running across Sparks shows once, on the Spark that answers (its other part has rank 1).
      for (const dep of sp.deployments.filter(x => x.state === 'running' && x.role !== 'main' && !x.rank)) {
        const lm = d.library.find(x => x.name === dep.model);
        rows.push(h('div', { class: 'row' },
          h('div', { class: 'row-main' }, h('span', { class: 'row-icon ok' }, icon(dep.cluster ? 'link' : 'sparkle')),
            h('div', { class: 'row-text' }, h('div', { class: 'row-title' }, lm ? modelTitle(lm) : dep.model),
              h('div', { class: 'row-sub' }, [dep.cluster ? `Across ${dep.cluster.split('+').map(nodeName).join(' + ')}` : nodeName(sp.id), dep.status,
                measuredText(lm, dep.cluster ? dep.cluster.split('+').length : 1)].filter(Boolean).join(' · ')))),
          h('div', { class: 'row-side' },
            dep.endpoint ? h('button', { class: 'btn ghost sm', type: 'button', title: `${dep.endpoint} (works with apps that use the OpenAI API)`, onclick: () => copy(dep.endpoint, `Copied: ${dep.endpoint}`) }, icon('copy'), 'Copy address') : null,
            canActOn(...(dep.cluster ? dep.cluster.split('+') : [sp.id])) ? h('button', { class: 'btn sm', type: 'button', onclick: () => stopDeployment(sp.id, dep) }, icon('stop'), 'Stop') : null)));
      }
    }
    // Model servers started outside the console, like benchmarks. Shown, never stopped from here.
    for (const sp of d?.sparks || []) {
      for (const ext of sp.external || []) {
        rows.push(h('div', { class: 'row' },
          h('div', { class: 'row-main' }, h('span', { class: 'row-icon' }, icon('box')),
            h('div', { class: 'row-text' }, h('div', { class: 'row-title', title: ext.models.join(', ') }, containerTitle(ext.container)),
              h('div', { class: 'row-sub', title: ext.port ? `${ext.container} · port ${ext.port}` : ext.container }, `${nodeName(sp.id)} · started outside Spark Console`))),
          h('div', { class: 'row-side' }, pill('Running', 'ok'))));
      }
    }
    // Sparkie's own model already has its panel above; this list is for everything else that runs.
    const others = rows.length - (sparkieOn ? 1 : 0);
    redraw(running, others > 0 ? panel('Running now', h('div', { class: 'rows' }, rows), { tight: true })
      : !d ? (lib.error ? failBanner('Couldn’t load what’s running', lib.error, loadLibrary) : h('div', { class: 'card' }, h('div', { class: 'empty' }, h('span', { class: 'spinner' }))))
        : h('div', { class: 'card' }, empty('box', sparkieOn ? `Only ${ASSISTANT}’s model is running` : 'Nothing is running',
          'Start one of the models on your Sparks, or find a new one.',
          canRun() ? h('button', { class: 'btn primary', type: 'button', onclick: e => openDeployPicker({ button: e.currentTarget }) }, icon('play'), 'Start a model') : null,
          h('a', { class: 'btn', href: '#/models/find' }, icon('search'), 'Find more'))));
  });
}

// On your Sparks: every model stored on the online Sparks, versions of one model grouped together.
function libraryTab(box) {
  const lib = state.lib, library = h('div');
  put(box, library);
  live(() => {
    if (lib.missing) { redraw(library, serviceMissing('The models on your Sparks')); return; }
    if (!lib.data) {
      redraw(library, lib.error ? failBanner('Couldn’t load the models on your Sparks', lib.error, loadLibrary)
        : h('div', { class: 'card' }, h('div', { class: 'empty' }, h('span', { class: 'spinner' }))));
      return;
    }
    const d = lib.data;
    const offline = d.sparks.filter(sp => !sp.online).map(sp => nodeName(sp.id));
    const note = text => h('p', { class: 'muted lib-note' }, text);
    const offlineNote = offline.length ? note(`${offline.join(', ')} ${offline.length === 1 ? 'is' : 'are'} offline; what’s stored there shows when ${offline.length === 1 ? 'it’s' : 'they’re'} back.`) : null;
    if (!d.libraryOnline) {
      redraw(library, h('div', { class: 'banner bad' }, icon('wifiOff'),
        h('div', { class: 'banner-text' }, h('strong', {}, 'No Sparks are reachable'), h('p', {}, 'This list is whatever your online Sparks hold, so it’s empty until one is back.'))));
      return;
    }
    // Models that can't start yet: still downloading, or only partly downloaded.
    const notReady = reason => {
      const byRepo = new Map();
      for (const x of (d.incomplete || []).filter(x => (x.reason || 'downloading') === reason)) byRepo.set(x.repo, [...(byRepo.get(x.repo) || []), nodeName(x.node)]);
      return [...byRepo].map(([repo, where]) => `${repo} (${where.join(', ')})`).join(', ');
    };
    const partialNote = [
      notReady('downloading') ? note(`Still downloading: ${notReady('downloading')}.`) : null,
      notReady('no-weights') ? note(`Only partly downloaded, so they can’t start: ${notReady('no-weights')}.`) : null,
    ];
    // Where models live on a Spark, for adding one by hand.
    const byHand = h('details', { class: 'rc-notes lib-note' }, h('summary', {}, 'Adding a model by hand'),
      h('p', {}, `Put each model in its own folder in ${d.modelsDir} on any Spark, or download it with hf download into the Hugging Face cache (${d.hfDir}). ${nodeName(d.modelsHost)} is where new ones go by default.`));
    if (!d.library.length) {
      redraw(library, h('div', { class: 'card' }, empty('box', 'No models on your Sparks yet', 'Find one under Find more: it downloads in one click.',
        h('a', { class: 'btn primary', href: '#/models/find' }, icon('search'), 'Find more')), partialNote, offlineNote, byHand));
      return;
    }
    const count = d.library.filter(m => m.role !== 'draft').length;
    redraw(library, panel(plural(count, 'model'), [h('div', { class: 'table-wrap' }, h('table', { class: 'data lib-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Model'), h('th', {}, 'Where'), h('th', { class: 'num' }, h('span', { class: 'sr-only' }, 'Actions')))),
      h('tbody', {}, libraryRows(d, m => {
        const where = d.sparks.flatMap(sp => {
          const dep = sp.deployments.find(x => x.model === m.name && x.state === 'running');
          if (dep?.cluster) return dep.rank ? [] : [h('span', { class: 'chip ok' }, led('running'), `Running across ${dep.cluster.split('+').map(nodeName).join(' + ')}`)];
          if (dep) return [h('span', { class: 'chip ok' }, led('running'), `Running on ${nodeName(sp.id)}`)];
          if (sp.models.includes(m.name)) {
            const tip = `Stored on ${nodeName(sp.id)}${m.stores?.[sp.id] === 'hf' ? ' (Hugging Face cache)' : ''}${m.locked?.[sp.id] ? '. Read-only there: it starts on this Spark, but can’t be copied to another.' : ''}`;
            return [h('span', { class: 'chip', title: tip }, icon(m.locked?.[sp.id] ? 'lock' : 'disk'), nodeName(sp.id))];
          }
          return [];
        });
        return h('tr', {},
          h('td', {}, h('div', { class: 'cell-main' }, h('span', { class: 'row-icon' }, icon('sparkle')),
            h('div', { style: { 'min-width': '0' } }, h('strong', {}, modelTitle(m),
              m.verified?.length ? [' ', h('span', { class: 'tag', title: m.verified.map(v => `${v.sparks} Spark${v.sparks > 1 ? 's' : ''} · ${v.engine}${v.best ? ` · ${v.best.decodeTokS} tokens/s` : ''} · ${v.runs}× since ${fmt.when(v.firstAt)}`).join('\n') }, 'Verified')] : null),
              h('div', { class: 'row-sub' }, [fmt.bytes(m.sizeBytes), m.format === 'gguf' ? `GGUF ${(m.ggufQuants || []).join(', ')}` : /^(compressed-tensors|modelopt|auto)$/i.test(m.dtype || '') ? null : m.dtype, m.contextLength ? `${Math.round(m.contextLength / 1024)}k context` : null,
                engineName(m.manifest?.engine || (m.format === 'gguf' ? 'llama.cpp' : null)), measuredText(m)].filter(Boolean).join(' · '))))),
          h('td', {}, h('div', { class: 'members' }, where)),
          // Plain buttons: a column of filled ones down the table would shout.
          h('td', { class: 'num' }, !canRun() || m.role === 'draft' ? null
            : h('button', { class: 'btn sm', type: 'button', 'aria-label': `Start ${modelTitle(m)}`, onclick: () => startModel(m) }, icon('play'), 'Start')));
      })))), partialNote, offlineNote,
      h('p', { class: 'muted lib-note' }, 'Looking for another model? ', h('a', { class: 'link', href: '#/models/find' }, 'Find more'), '.'), byHand],
      { tight: true, sub: `across ${plural(new Set(d.library.flatMap(m => m.copies || [])).size, 'Spark')}` }));
  });
}

async function loadMainChoices() {
  state.mainChoicesLoading = true;
  // If the list can't be read, the dropdown says so and it tries again shortly.
  try { state.mainChoices = await capi('main/choices'); state.mainChoicesError = null; } catch (e) { state.mainChoices = null; state.mainChoicesError = e.message; setTimeout(() => { if (!state.mainChoices) loadMainChoices(); }, 15000); } finally { state.mainChoicesLoading = false; }
  runLive();
}

// A dropdown of what Sparkie (role 'chat') or apps (role 'agents') can use: running models first, then (for Sparkie) models on disk,
// which start as Sparkie's own model on its Spark.
function mainSelect(role, m, choices) {
  const route = m.routes?.[role], running = choices?.running || [];
  const routeId = role === 'agents' && route?.same ? 'same'
    : !route || route.kind === 'main' ? 'main'
      : running.find(c => c.kind === 'endpoint' && c.title === route.title && c.node === route.node)?.id || 'current';
  const opt = (value, text, extra = {}) => h('option', { value, ...extra }, text);
  const runningOpts = running.map(c => opt(c.id,
    `${c.title} · ${nodeName(c.node)}${c.kind === 'main' ? ` · ${ASSISTANT}’s own${c.running ? '' : ', stopped'}` : ''}${c.reachable ? '' : ` (${c.reason})`}`,
    { disabled: !c.reachable, title: c.kind === 'main' ? `Spark Console keeps this model running for ${ASSISTANT}` : '' }));
  const onDisk = role === 'chat' ? [
    ...(choices?.presets || []).filter(p => !p.current).map(p => opt(`preset:${p.id}`, `${p.title} · saved setup`)),
    // A Library model that already has a saved setup (made the last time it was Sparkie's) is listed once, as that setup.
    ...(choices?.library || []).filter(x => !(choices.presets || []).some(p => p.id === `lib-${x.id}`))
      .map(x => opt(`model:${x.id}`, `${x.title} · ${fmt.bytes(x.sizeBytes)}${x.onSparkieSpark ? '' : `, copied to ${nodeName(choices.sparkieSpark)} first`}`)),
  ] : [];
  const select = h('select', { class: 'select', 'aria-label': role === 'chat' ? `${ASSISTANT}’s model` : 'Model for apps', onchange: () => chooseMain(role, select.value, select) },
    role === 'agents' ? opt('same', `Same as ${ASSISTANT}`) : null,
    routeId === 'current' ? opt('current', `${route.title} · ${nodeName(route.node)}`) : null,
    !choices ? opt(routeId, state.mainChoicesError ? 'Couldn’t load the list · retrying' : 'Loading…') : null,
    running.length ? h('optgroup', { label: 'Running now' }, runningOpts) : null,
    onDisk.length ? h('optgroup', { label: `On disk · starts on ${nodeName(choices.sparkieSpark)}` }, onDisk) : null);
  select.value = routeId;
  select.dataset.current = routeId;
  return select;
}

async function chooseMain(role, value, select) {
  const m = state.main.data, revert = () => { select.value = select.dataset.current; };
  if (value.startsWith('preset:') || value.startsWith('model:')) {
    const [kind, id] = [value.slice(0, value.indexOf(':')), value.slice(value.indexOf(':') + 1)];
    const title = select.selectedOptions[0]?.textContent.split(' · ')[0] || id;
    const job = await openMainPlan({
      title: `Make ${title} ${ASSISTANT}’s model?`, confirm: 'Switch',
      intro: `It replaces ${m.title} on ${nodeName(m.node)} and stays on. If it doesn’t start, ${ASSISTANT} goes back to ${m.title}.`,
      query: `?${kind}=${encodeURIComponent(id)}`, submit: keep => capi('main/use', 'POST', { [kind]: id, keep }),
    });
    if (!job) revert();
    return;
  }
  const choice = (state.mainChoices?.running || []).find(c => c.id === value);
  if (role === 'chat' && value !== 'main') {
    const ok = await dialog({
      title: `Answer with ${choice?.title || 'this model'}?`, confirm: 'Use it',
      description: `${ASSISTANT}’s chats go to ${choice?.title} on ${nodeName(choice?.node)}, which is already running. Nothing restarts.${m.healthy ? ` ${m.title} keeps running; stop it below if you don’t need it.` : ''}`,
    });
    if (!ok) { revert(); return; }
  }
  try {
    await capi('main/route', 'POST', { role, choice: value });
    toast(role === 'chat' ? `${ASSISTANT} now answers with ${choice?.title || m.title}` : value === 'same' ? `Apps use the same model as ${ASSISTANT}` : `Apps now use ${choice?.title || m.title}`);
  } catch (e) {
    toast(e.message, { kind: 'bad', timeout: 9000 });
  }
  await loadMain();
}

function mainState(m) {
  if (!m.online) return ['Offline', 'bad'];
  if (m.busy) return ['Changing…', 'info'];
  if (m.state === 'running') return m.healthy ? ['Ready', 'ok'] : ['Loading', 'info'];
  if (m.state === 'restarting') return ['Restarting', 'warn'];
  if (m.state === 'missing') return ['Not started', ''];
  return m.exitCode ? ['Stopped with an error', 'bad'] : ['Stopped', ''];
}

// Starting a model as Sparkie's own (the one it has, or a new one): what else on that Spark's GPU stops (each with
// Keep running, like a deploy), any copy or download, then the start. Resolves with the job, or null if cancelled.
async function openMainPlan({ title, confirm, intro, query = '', submit }) {
  const keep = new Set();
  let plan = null;
  const body = h('div', { class: 'plan' }, h('div', { class: 'empty' }, h('span', { class: 'spinner' }), 'Checking what’s running there…'));
  const draw = () => {
    const stops = plan.steps.filter(s => s.kind === 'stop');
    const freed = stops.filter(s => !keep.has(s.container)).reduce((t, s) => t + s.gpuMiB * 2 ** 20, 0);
    redraw(body,
      stops.length ? h('div', { class: 'plan-steps' }, stops.map(s => h('label', { class: 'check-row' },
        h('input', { type: 'checkbox', checked: !keep.has(s.container), onchange: e => { if (e.target.checked) keep.delete(s.container); else keep.add(s.container); draw(); } }),
        h('span', {}, `Stop ${containerTitle(s.container)}`),
        h('span', { class: 'muted' }, [s.reason, s.gpuMiB ? gb(s.gpuMiB * 2 ** 20) : null].filter(Boolean).join(' · '))))) : null,
      h('p', { class: 'plan-sentence' }, planSentence(plan)),
      memoryNote(plan, freed, 'Stop more first.'),
      warnBanner(plan.warnings));
  };
  const job = await dialog({
    title, wide: true, confirm,
    body: [h('p', { class: 'muted' }, intro), body],
    setup: ({ ok }) => {
      ok.disabled = true;
      capi(`main/plan${query}`).then(p => { plan = p; draw(); ok.disabled = false; })
        .catch(e => set(body, h('div', { class: 'banner bad' }, icon('alert'), h('div', { class: 'banner-text' }, h('p', {}, e.message)))));
    },
    onConfirm: () => submit([...keep]),
  });
  if (job?.id) followServiceJob(job);
  return job?.id ? job : null;
}

function openMainStart() {
  const m = state.main.data;
  return openMainPlan({
    title: `Start ${m.title}?`, confirm: 'Start', submit: keep => capi('main/start', 'POST', { keep }),
    intro: `It runs on ${nodeName(m.node)} and stays on: it restarts after a reboot, and starting other models never stops it.`,
  });
}

async function stopMain() {
  const m = state.main.data;
  const ok = await dialog({
    title: `Stop ${m.title}?`, confirm: 'Stop', danger: true,
    description: `${ASSISTANT} can’t answer until it’s started again, and it stays off after a reboot.`,
  });
  if (!ok) return;
  try { followServiceJob(await capi('main/stop', 'POST', {})); } catch (e) { toast(e.message, { kind: 'bad' }); }
}

async function stopDeployment(nodeId, dep) {
  const ok = await dialog({
    title: `Stop ${containerTitle(dep.container)} on ${dep.cluster ? dep.cluster.split('+').map(nodeName).join(' + ') : nodeName(nodeId)}?`, confirm: 'Stop', danger: true,
    description: `${dep.cluster ? 'It stops on both Sparks. ' : ''}Requests in flight are cut off. The model stays on disk, so starting it again is quick.`,
  });
  if (!ok) return;
  try { followServiceJob(await capi('stop', 'POST', { node: nodeId, container: dep.container })); } catch (e) { toast(e.message, { kind: 'bad' }); }
}

// The fastest run of a model that's been verified on these Sparks with this many of them (from deploys that came up healthy).
const verifiedSpeed = (m, sparks) => (m?.verified || []).filter(v => v.sparks === sparks && v.best).sort((a, b) => b.best.decodeTokS - a.best.decodeTokS)[0] || null;
const verifiedNote = (m, sparks) => { const v = verifiedSpeed(m, sparks); return v ? `verified ${v.best.decodeTokS} tokens/s here` : null; };

// The steps after the stops, as one plain sentence: copy, download, start, and the memory it needs.
function planSentence(p, engine) {
  const parts = p.steps.filter(s => s.kind !== 'stop').map(s => (s.kind === 'copy' ? `copies ${fmt.bytes(s.bytes)} from ${nodeName(s.from)} first`
    : s.kind === 'pull' ? `downloads the ${engineName(engine || s.engine)} image first` : `starts it with ${engineName(s.engine)} and waits until it answers`));
  if (p.memory?.need) parts.push(p.memory.need < 1e9 ? 'needs under 1 GB' : `needs about ${gb(p.memory.need)}`);
  return parts.length ? `${cap(parts.join(', '))}.` : '';
}
// "X stops", "X and Y stop", "X, Y and Z stop".
const stopsText = names => `${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]} ${names.length > 1 ? 'stop' : 'stops'}`;
// A plan's notes (what's protected, a busy port) in one quiet banner, not one per line.
const warnBanner = list => (list.length ? h('div', { class: 'banner warn', style: { margin: '0' } }, icon('alert'),
  h('div', { class: 'banner-text' }, list.map(w => h('p', {}, w)))) : null);
// Only when memory is short: a note on what's missing.
function memoryNote(p, freed, hint) {
  const known = num(p.memory?.available), after = known ? p.memory.available + freed : null;
  if (!known || !p.memory.need || after >= p.memory.need) return null;
  return h('div', { class: 'banner warn', style: { margin: '0' } }, icon('alert'),
    h('div', { class: 'banner-text' }, h('p', {}, `Needs about ${gb(p.memory.need)}, but only about ${gb(after)} would be free. ${hint}`)));
}

// Start a model from anywhere: pick one on disk, then the usual start dialog (best Spark, or the pair asked for, picked).
async function openDeployPicker({ pair = null, button = null } = {}) {
  if (!state.lib.data) await busy(button, loadLibrary);
  if (!state.lib.data) { toast(state.lib.error || 'Couldn’t load the models. Try again.', { kind: 'bad' }); return; }
  const models = (state.lib.data.library || []).filter(m => m.role !== 'draft');
  if (!models.length) { toast('No models on your Sparks yet', { sub: 'Pick one under Find more; it downloads in one click.' }); go('models/find'); return; }
  let picked = null;
  // Each model says where it fits right now; what fits without stopping anything comes first.
  const rows = new Map();
  const list = h('div', { class: 'radio-cards' }, models.map(m => {
    const fit = h('p', {}, fmt.bytes(m.sizeBytes), ' · ', h('span', { class: 'muted' }, 'checking where it fits…'));
    const card = h('label', { class: 'radio-card' },
      h('input', { type: 'radio', name: 'deploy-model', value: m.name, onchange: () => { picked = m; } }),
      h('div', {}, h('strong', {}, modelTitle(m)), fit));
    rows.set(m.name, { m, card, fit });
    return card;
  }));
  const both = nodes => nodes.map(nodeName).join(' + ');
  // Opened for a pair, each model says what matters there: whether it needs both, not where it fits alone.
  const fitText = o => (pair ? (o.across ? [`Running across ${both(o.across)}`, 2] : o.error ? [`Can’t check right now: ${o.error}`, 4]
    : o.needsTwo ? ['Needs two Sparks', 0] : o.best ? ['Also fits on one Spark', 1] : ['No single Spark has room for it now', 0])
    : o.across ? [`Running across ${both(o.across)}`, 2] : o.running.length ? [`Running on ${o.running.map(nodeName).join(', ')}`, 2]
      : o.best && !o.best.stop.length ? [`Fits on ${nodeName(o.best.node)} now`, 0]
        : o.best ? [`Fits on ${nodeName(o.best.node)} if ${stopsText(o.best.stop.map(containerTitle))}`, 1]
          : o.pair ? [`Fits across ${both(o.pair.nodes)}${o.pair.stop.length ? ` if ${stopsText(o.pair.stop.map(x => containerTitle(x.container)))}` : ''}`, 1]
            : o.error ? [`Can’t check right now: ${o.error}`, 4]
              : o.needsTwo ? ['Too big for one Spark · needs two linked Sparks, and none have room now', 3] : ['Doesn’t fit on any Spark right now', 3]);
  capi('deploy/options').then(r => {
    const order = [];
    for (const o of r.models || []) {
      const row = rows.get(o.model);
      if (!row) continue;
      const [text, rank] = fitText(o);
      set(row.fit, `${fmt.bytes(row.m.sizeBytes)} · ${text}`);
      // Across two Sparks, the models too big for one come first: that's what a pair is for.
      order.push([pair ? (o.needsTwo ? 0 : 10) + rank : rank, row.card]);
    }
    order.sort((a, b) => a[0] - b[0]).forEach(([, card]) => list.append(card));
  }, e => rows.forEach(row => set(row.fit, `${fmt.bytes(row.m.sizeBytes)} · on ${row.m.copies.map(nodeName).join(', ')}`)));
  const ok = await dialog({
    title: pair ? `Start a model across ${pair.map(nodeName).join(' + ')}` : 'Start a model', confirm: 'Next', wide: true,
    description: pair ? 'Models too big for one Spark are listed first. A smaller one also runs across both, usually faster.' : null, body: [list],
    onConfirm: () => { if (!picked) throw new Error('Pick a model.'); return true; },
  });
  if (ok && picked) openDeploy(picked, { pair });
}

// From Find more, a start can name a setup or a verified run (with how many Sparks it's for); a setup that needs the
// model to run its own code shows a checkbox that must be ticked.
async function openDeploy(model, { pair = null, setup = null, verified = null, sparks: only = null, remoteCode = false } = {}) {
  const d = state.lib.data;
  if (!d) return;
  const keep = new Set(), fits = new Map(), cards = new Map();
  let chosen = null, current = null, token = 0, okButton = null;
  const plan = h('div', { class: 'plan' }, h('div', { class: 'empty' }, h('span', { class: 'spinner' }), 'Finding where it fits best…'));
  const sparks = d.sparks.filter(sp => sp.online && node(sp.id) && mine(sp.id));
  const both = ids => ids.map(nodeName).join(' + ');
  // One short line per Spark, then per pair of linked Sparks: whether it fits and what would have to stop.
  // The best fit is pre-selected (or the pair this was opened for).
  const picker = h('div', { class: 'radio-cards' }, sparks.map(sp => {
    const n = node(sp.id);
    const line = h('p', {}, 'Checking…'), tag = h('span', { class: 'tag', hidden: true }, 'Best fit');
    const input = h('input', { type: 'radio', name: 'deploy-spark', value: sp.id, onchange: () => pick(sp.id) });
    const card = h('label', { class: 'radio-card' }, input, h('div', {}, h('strong', {}, n.name, ' ', tag), line));
    cards.set(sp.id, { card, line, tag, input, copyNote: sp.models.includes(model.name) ? null : `copies ${fmt.bytes(model.sizeBytes)} over first` });
    return card;
  }));
  const pairHead = h('p', { class: 'muted', hidden: true, style: { margin: '4px 0 0', 'font-size': '12.5px' } }, 'Or across two linked Sparks');
  const pairBox = h('div', { class: 'radio-cards' });
  // Where this model runs now: alone on one Spark, or across a pair (named by its group, e.g. "spark2+spark3").
  const live = d.sparks.flatMap(sp => sp.deployments.filter(x => x.model === model.name && x.state === 'running' && !x.rank).map(x => ({ node: sp.id, group: x.cluster })));
  const alone = live.filter(x => !x.group).map(x => x.node), across = live.find(x => x.group)?.group || null;
  const sameGroup = ids => across && across.split('+').sort().join() === [...ids].sort().join();
  // A deploy only stops things on the Sparks it uses: overlapping where the model runs now moves it, otherwise it's a
  // second copy and the first keeps running.
  const elsewhere = ids => {
    if (across) return across.split('+').some(id => ids.includes(id)) ? `stops it across ${both(across.split('+'))} first` : `a second copy; it keeps running across ${both(across.split('+'))}`;
    const here = alone.filter(id => ids.includes(id)), there = alone.filter(id => !ids.includes(id));
    return here.length && ids.length > 1 ? `moves it from ${both(here)} alone to both` : there.length ? `a second copy; it keeps running on ${both(there)}` : null;
  };
  const fitLine = f => (f.error ? `Can’t check right now: ${f.error}`
    : alone.includes(f.node) ? 'Already running here · starting it again restarts it'
      : !f.fits ? (f.plan?.sparkieHere ? `Not enough room next to ${ASSISTANT}’s model` : 'Not enough memory, even if everything stops')
        : [f.stop.length ? `Fits if ${stopsText(f.stop.map(containerTitle))}` : 'Fits · nothing has to stop', verifiedNote(model, 1), elsewhere([f.node])].filter(Boolean).join(' · '));
  const pairLine = p => (p.error ? `Can’t use them together right now: ${p.error}`
    : sameGroup(p.nodes) ? 'Already running across both · starting it again restarts it'
      : !p.fits ? (p.sparkie?.length ? `Not enough room next to ${ASSISTANT}’s model on ${both(p.sparkie)}` : 'Not enough memory across both, even if everything stops')
        : [p.stop.length ? `Fits across both if ${stopsText(p.stop.map(x => `${containerTitle(x.container)} on ${nodeName(x.node)}`))}` : 'Fits across both · nothing has to stop',
          verifiedNote(model, 2), elsewhere(p.nodes)].filter(Boolean).join(' · '));
  async function rank() {
    try {
      const r = await capi(`deploy/plans?model=${encodeURIComponent(model.name)}`);
      for (const f of r.sparks) {
        const c = cards.get(f.node);
        if (!c) continue;
        if (only === 2) { c.card.remove(); continue; }
        fits.set(f.node, f);
        c.line.textContent = [fitLine(f), f.error ? null : c.copyNote].filter(Boolean).join(' · ');
        c.tag.hidden = f.node !== r.recommended;
        picker.append(c.card);
      }
      for (const p of only === 1 ? [] : r.pairs || []) {
        const id = p.nodes.join('+'), tag = h('span', { class: 'tag', hidden: id !== r.recommended }, 'Best fit');
        const input = h('input', { type: 'radio', name: 'deploy-spark', value: id, disabled: Boolean(p.error), onchange: () => pick(id) });
        const line = h('p', {}, [pairLine(p), !p.error && p.copy ? 'copies the model over first' : null].filter(Boolean).join(' · '));
        const card = h('label', { class: 'radio-card' }, input, h('div', {}, h('strong', {}, both(p.nodes), ' ', tag), line));
        cards.set(id, { card, line, tag, input });
        fits.set(id, p);
        pairBox.append(card);
      }
      pairHead.hidden = !(r.pairs || []).length;
      const want = pair ? [pair.join('+'), [...pair].reverse().join('+')].find(id => cards.has(id) && !fits.get(id)?.error) : null;
      const firstPair = (r.pairs || []).find(p => p.fits && !p.error)?.nodes.join('+');
      const first = want || (only === 2 ? firstPair : only === 1 ? (r.recommended && !r.recommended.includes('+') ? r.recommended : r.sparks.find(f => !f.error)?.node) : r.recommended || r.sparks.find(f => !f.error)?.node);
      if (first && !chosen) { cards.get(first).input.checked = true; pick(first); }
      else if (!first) set(plan, h('p', { class: 'muted' }, 'No online Spark can take it right now.'));
    } catch (e) {
      for (const c of cards.values()) c.line.textContent = c.copyNote || 'already has it';
      set(plan, h('p', { class: 'muted' }, 'Pick a Spark to see exactly what will happen. Nothing changes until you click Start.'));
    }
  }

  async function pick(id) {
    chosen = id;
    const f = fits.get(id), across = id.includes('+');
    if (!across && f?.plan) {
      // Keep everything the model doesn't need stopped; the plan still lets you change each one.
      current = f.plan;
      keep.clear();
      for (const s of f.plan.steps) if (s.kind === 'stop' && !f.stop.includes(s.container)) keep.add(s.container);
      drawPlan();
      return;
    }
    const mine = ++token;
    okButton.disabled = true;
    set(plan, h('div', { class: 'empty' }, h('span', { class: 'spinner' }), across ? 'Checking both Sparks and their cable…' : 'Checking what’s running there…'));
    try {
      const p = across
        ? await capi(`deploy/cluster-plan?model=${encodeURIComponent(model.name)}&nodes=${encodeURIComponent(id.split('+').join(','))}`)
        : await capi(`deploy/plan?model=${encodeURIComponent(model.name)}&node=${encodeURIComponent(id)}`);
      if (mine !== token) return;
      current = p;
      keep.clear();
      if (across) for (const m of p.members) for (const s of m.steps) if (s.kind === 'stop' && !m.stop.includes(s.container)) keep.add(s.container);
      drawPlan();
    } catch (e) {
      if (mine === token) set(plan, h('div', { class: 'banner bad' }, icon('alert'), h('div', { class: 'banner-text' }, h('p', {}, e.message))));
    }
  }

  const stopRow = (s, where) => h('label', { class: 'check-row' },
    h('input', { type: 'checkbox', checked: !keep.has(s.container), onchange: e => { if (e.target.checked) keep.delete(s.container); else keep.add(s.container); drawPlan(); } }),
    h('span', {}, `Stop ${containerTitle(s.container)}${where ? ` on ${nodeName(where)}` : ''}`,
      s.group ? h('span', { class: 'muted' }, ` (runs across ${both(s.group.split('+'))}; both parts stop)`) : null),
    h('span', { class: 'muted' }, [s.reason, s.gpuMiB ? gb(s.gpuMiB * 2 ** 20) : null, !s.gpuMiB && s.required ? 'has to stop' : null].filter(Boolean).join(' · ')));

  // Short of memory with what's ticked to stop, and whether stopping everything listed would be enough.
  const freedBy = (steps, all) => steps.filter(s => s.kind === 'stop' && (all || !keep.has(s.container))).reduce((t, s) => t + s.gpuMiB * 2 ** 20, 0);
  const shortOf = (p, freed) => num(p.memory?.available) && p.memory.need > 0 && p.memory.available + freed < p.memory.need;
  const fixHint = (p, where) => (shortOf(p, freedBy(p.steps, true)) ? `Pick ${where ? 'other Sparks' : 'another Spark'}.` : `Tick more above to stop them, or pick ${where ? 'other Sparks' : 'another Spark'}.`);
  function drawPlan() {
    const p = current;
    if (p.members) okButton.disabled = p.members.some(m => shortOf(m, freedBy(m.steps)));
    else okButton.disabled = shortOf(p, freedBy(p.steps));
    if (p.members) {
      // Across two Sparks: what stops on each, then one sentence for the rest.
      const [a, b] = p.nodes;
      const rest = [
        ...p.members.flatMap(m => m.steps.filter(s => s.kind === 'copy').map(s => `copies ${fmt.bytes(s.bytes)} to ${nodeName(m.node)}`)),
        ...p.members.filter(m => m.steps.some(s => s.kind === 'pull')).map(m => `downloads the vLLM image on ${nodeName(m.node)}`),
        `starts it on both over their direct cable, with ${nodeName(a)} answering requests`, `needs about ${gb(p.each)} on each`,
      ];
      redraw(plan,
        h('div', { class: 'plan-steps' }, p.members.flatMap(m => m.steps.filter(s => s.kind === 'stop').map(s => stopRow(s, m.node)))),
        h('p', { class: 'plan-sentence' }, `${cap(rest.join(', '))}.`),
        p.members.map(m => memoryNote(m, freedBy(m.steps), `That’s on ${nodeName(m.node)}. ${fixHint(m, true)}`)),
        warnBanner([...new Set(p.members.flatMap(m => m.warnings.map(w => `${nodeName(m.node)}: ${w}`)))]));
      return;
    }
    const stops = p.steps.filter(s => s.kind === 'stop');
    const freed = stops.filter(s => !keep.has(s.container)).reduce((t, s) => t + s.gpuMiB * 2 ** 20, 0);
    redraw(plan,
      stops.length ? h('div', { class: 'plan-steps' }, stops.map(s => stopRow(s, null))) : null,
      h('p', { class: 'plan-sentence' }, planSentence(p, p.model.engine)),
      memoryNote(p, freed, fixHint(p, false)),
      warnBanner(p.warnings));
  }

  if (only === 2) picker.hidden = true;
  const allow = h('input', { type: 'checkbox' });
  const how = { ...(setup ? { setup } : {}), ...(verified ? { verified } : {}), ...(remoteCode ? { allowRemoteCode: true } : {}) };
  const job = await dialog({
    title: `Start ${modelTitle(model)}`, wide: true, confirm: 'Start',
    description: setup ? 'With the setup you picked.' : verified ? 'With the settings it ran with before.' : null,
    body: [h('div', { class: 'field' }, 'Where should it run?', picker, pairHead, pairBox), plan,
      remoteCode ? h('label', { class: 'check-row' }, allow, h('span', {}, 'Let this model run its own code (this setup needs it)')) : null],
    setup: ({ ok }) => { okButton = ok; ok.disabled = true; rank(); },
    onConfirm: () => {
      if (remoteCode && !allow.checked) throw new Error('This setup needs the model to run its own code. Tick the box to allow it.');
      // Exactly what the plan on screen stops, so anything that starts using the GPU meanwhile isn't stopped unseen.
      const stopping = (steps, node) => steps.filter(s => s.kind === 'stop' && !keep.has(s.container)).map(s => `${node}/${s.container}`);
      const stop = current?.members ? current.members.flatMap(m => stopping(m.steps, m.node)) : current ? stopping(current.steps, chosen) : [];
      return chosen.includes('+')
        ? capi('deploy/cluster', 'POST', { model: model.name, nodes: chosen.split('+'), keep: [...keep], stop, ...how })
        : capi('deploy', 'POST', { model: model.name, node: chosen, keep: [...keep], stop, ...how });
    },
  });
  if (job?.id) followServiceJob(job);
}

/* ───────── models page: Find more ───────── */
// Every model worth running on the Sparks (the catalog of recipes), its versions (quantizations), and the setups
// people published with their speeds; "Verified" marks what has actually run on these Sparks. Filters by how many
// Sparks it needs (one, or a linked pair), plus a kind.
const RECIPE_FILTERS = ['All', '1 Spark', '2 Sparks', 'Verified'];
// The number of Sparks picked in the filter, or null for All and Verified.
const wantedSparks = () => { const x = /^(\d) Spark/.exec(state.recipeFilter); return x ? Number(x[1]) : null; };
// Hugging Face links or org/model names, as pasted (an empty list when it's words to search for).
const HF_LINK = /^(https?:\/\/)?(www\.)?(huggingface\.co|hf\.co)\//i;
function hfRepos(text) {
  const words = String(text || '').trim().split(/[\s,;]+/).filter(Boolean);
  const ok = words.length && words.every(w => (HF_LINK.test(w) && /^[\w.-]+\/[\w.-]+/.test(w.replace(HF_LINK, ''))) || /^[\w.-]+\/[\w.-]+$/.test(w));
  return ok ? [...new Set(words.map(w => w.replace(HF_LINK, '').split(/[/?#]/).slice(0, 2).join('/')))] : [];
}
const RECIPE_KINDS = [['all', 'All kinds'], ['chat', 'Chat'], ['coding', 'Coding'], ['reasoning', 'Reasoning'], ['vision', 'Vision'],
  ['rag', 'Embeddings & rerank'], ['small', 'Small & fast']];
const kindOf = (m, k) => k === 'all' || (k === 'rag' ? m.categories.some(c => ['embedding', 'rerank'].includes(c)) : m.categories.includes(k));
const tokS = n => (num(n) ? `${Math.round(n)} tokens/s` : null);
const sparksText = n => `${n} Spark${n > 1 ? 's' : ''}`;
// Fastest published speed for a model on n Sparks (credible sources); your own runs show separately.
function bestSpeed(m, n) {
  const theirs = m.setups.filter(st => st.sparks === n && num(st.perf?.decodeTokS) && st.credibility !== 'low').sort((a, b) => b.perf.decodeTokS - a.perf.decodeTokS)[0];
  return theirs ? { speed: theirs.perf.decodeTokS, verified: false } : null;
}
const yourSpeed = m => (m.verified || []).filter(v => v.best).sort((a, b) => b.best.decodeTokS - a.best.decodeTokS)[0] || null;
// The speed numbers besides one user's decode speed, in plain words: prefill, several users at once, first token.
const bigNum = n => Math.round(n).toLocaleString();
const perfBits = (p = {}) => [
  num(p.prefillTokS) ? `prefill ${bigNum(p.prefillTokS)} tokens/s` : null,
  num(p.aggregateTokS) ? `${bigNum(p.aggregateTokS)} tokens/s ${p.concurrency > 1 ? `with ${p.concurrency} users` : 'with several users'}` : null,
  num(p.ttftMs) ? (p.ttftMs < 100 ? 'first token in under 0.1 s' : `first token in ${(p.ttftMs / 1000).toFixed(1)} s`) : null,
].filter(Boolean);
// How precise a quantization is, roughly: 16-bit > 8-bit > 5/6-bit > 4-bit.
// The weights' own format decides, not a layer kept in higher precision ("NVFP4, BF16 lm_head" is 4-bit).
const precisionOf = q => { const s = String(q || '').toUpperCase(); return /NVFP4|MXFP4|FP4|INT4|W4|\bI?Q[234]|AWQ|GPTQ|4-?BIT/.test(s) ? 1 : /\bQ[56]/.test(s) ? 2 : /FP8|INT8|\bQ8|W8|8-?BIT/.test(s) ? 3 : /BF16|FP16|\bF16\b/.test(s) ? 4 : 0; };
// A model's options side by side: for each version and number of Sparks, the fastest known way to run it (your own
// runs first, then published setups), plus forum reports, plus versions nobody has published a setup for yet.
// With n, only the ways on n Sparks, and the trade-offs are tagged among those.
function modelOptions(m, n = null) {
  const byKey = new Map(), variant = repo => m.variants.find(v => repoKey(v.repo) === repoKey(repo));
  // Per row, the better of two: one with a speed beats one without; then your own measured run; then the faster.
  const score = o => [num(o.speed) ? 1 : 0, o.mine ? 1 : 0, o.speed || 0];
  const better = (a, b) => { const x = score(a), y = score(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
  const offer = (key, o) => { const cur = byKey.get(key); if (!cur || better(o, cur) > 0) byKey.set(key, o); };
  // Your run of a published setup is that setup's row; your run with other settings is a row of its own, so it never
  // hides a faster one-click recipe for the same version.
  const mineIds = new Set((m.verified || []).map(r => r.setupId).filter(Boolean));
  for (const r of m.verified || []) if (r.repo) offer(`${repoKey(r.repo)}|${r.sparks}|${r.setupId || 'mine'}`, { repo: r.repo, v: variant(r.repo), sparks: r.sparks, engine: r.engine, speed: r.best?.decodeTokS ?? null, perf: { ttftMs: r.best?.ttftMs }, mine: true, run: r });
  for (const st of m.setups) {
    if (!st.report && !st.repo) continue;
    // A one-click setup and a faster hand-built one for the same version are both worth seeing.
    offer(st.report ? `report|${st.id}` : `${repoKey(st.repo)}|${st.sparks}|${mineIds.has(st.id) ? st.id : st.deployable ? 1 : 0}`, { repo: st.repo, v: st.repo ? variant(st.repo) : null, quant: st.quant, sparks: st.sparks, engine: st.engine, speed: st.perf?.decodeTokS ?? null, perf: st.perf || {}, setup: st, report: Boolean(st.report) });
  }
  // Versions with nothing published still run, with the engine's default settings.
  for (const v of m.variants) if (v.sparks && ![...byKey.values()].some(o => !o.report && o.repo && repoKey(o.repo) === repoKey(v.repo))) offer(`${repoKey(v.repo)}|${v.sparks}|0`, { repo: v.repo, v, sparks: v.sparks, engine: v.engine || null, speed: null, perf: {} });
  // A run of yours that was never measured adds nothing next to other rows for that version (it's under Deployed before).
  const all = [...byKey.values()];
  const list = all.filter(o => o.sparks >= 1 && o.sparks <= 4 && (!n || o.sparks === n))
    .filter(o => !(o.mine && !num(o.speed) && all.some(x => x !== o && repoKey(x.repo) === repoKey(o.repo) && x.sparks === o.sparks)))
    .sort((a, b) => a.sparks - b.sparks || (b.speed || 0) - (a.speed || 0));
  // The trade-offs, each on one option: fastest (credible, runnable), smallest, most precise.
  const tag = (o, t) => { if (o && !o.tags.includes(t)) o.tags.push(t); };
  for (const o of list) o.tags = [];
  const runnable = list.filter(o => !o.report), q = o => precisionOf(o.v?.quant || o.quant);
  const fast = runnable.filter(o => num(o.speed) && o.setup?.credibility !== 'low').sort((a, b) => b.speed - a.speed);
  if (fast.length > 1) tag(fast[0], 'Fastest');
  const sized = runnable.filter(o => num(o.v?.needGB) && !(o.engine === 'llama.cpp' && !o.v.quants)).sort((a, b) => a.v.needGB - b.v.needGB);
  if (sized.length > 1 && sized[0].v.needGB < sized[sized.length - 1].v.needGB) tag(sized[0], 'Smallest');
  const precise = runnable.filter(o => q(o) > 0).sort((a, b) => q(b) - q(a) || (b.speed || 0) - (a.speed || 0));
  if (precise.length > 1 && q(precise[0]) > q(precise[precise.length - 1])) tag(precise[0], 'Most precise');
  return list;
}
// Fewest Sparks it fits: from the versions' sizes when known, else from the setups people ran.
const minSparks = m => {
  const known = m.variants.map(v => v.sparks).filter(Boolean);
  return known.length ? Math.min(...known) : Math.min(99, ...m.setups.map(st => st.sparks));
};

function findMoreTab(box) {
  const r = state.recipes;
  if (!RECIPE_FILTERS.includes(state.recipeFilter)) state.recipeFilter = 'All';
  // One box: words filter the list (Enter searches Hugging Face too); a Hugging Face link or org/model name is added.
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search, or paste a Hugging Face link', 'aria-label': 'Search models, or paste a Hugging Face link', value: state.recipeQuery,
    oninput: () => { state.recipeQuery = search.value; draw(); },
    onkeydown: e => { if (e.key !== 'Enter') return; e.preventDefault(); if (owner() && hfRepos(state.recipeQuery).length) addLinks(); else if (canRun()) searchHub(); } });
  // Hugging Face search: Sparkie turns the words into search terms; the service reads the real sizes and formats.
  async function searchHub() {
    const q = state.recipeQuery.trim();
    if (q.length < 2) return;
    state.recipeSearch = { q, loading: true };
    draw();
    try { state.recipeSearch = { q, data: await capi(`recipes/search?q=${encodeURIComponent(q)}`) }; } catch (e) { state.recipeSearch = { q, error: e.message }; }
    draw();
  }
  // Links (owner): each is added to the list, then Spark Console looks for setups that run it on DGX Spark.
  async function addLinks(button = null) {
    const text = state.recipeQuery.trim();
    const job = await busy(button, () => capi('recipes/add-list', 'POST', { text }));
    if (!job?.id) return;
    state.recipeQuery = search.value = '';
    draw();
    followServiceJob(job);
  }
  const kind = h('select', { class: 'select', 'aria-label': 'Kind', onchange: () => { state.recipeKind = kind.value; draw(); } },
    RECIPE_KINDS.map(([v, t]) => h('option', { value: v, selected: v === state.recipeKind }, t)));
  const filters = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Sparks' });
  const body = h('div', { class: 'stack' });
  put(box,
    h('div', { class: 'files-bar find-bar' }, search, kind, h('div', { class: 'filter-scroll' }, filters)),
    body);

  function draw() {
    redraw(filters, RECIPE_FILTERS.map(f => h('button', { type: 'button', 'aria-pressed': String(state.recipeFilter === f), onclick: () => { state.recipeFilter = f; draw(); } }, f)));
    if (r.missing) { redraw(body, serviceMissing('The model list')); return; }
    if (!r.data) {
      redraw(body, r.error ? failBanner('Couldn’t load the model list', r.error, loadRecipes) : h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
      return;
    }
    const d = r.data, typed = state.recipeQuery.trim(), repos = hfRepos(typed), f = state.recipeFilter;
    // A pasted link finds its model in the list too, by its org/model name.
    const terms = repos.length ? repos.map(repoKey) : typed ? [typed.toLowerCase()] : [];
    const has = text => !terms.length || terms.some(t => text.toLowerCase().includes(t));
    const showAll = () => terms.length > 0 || f !== 'All' || state.recipeKind !== 'all' || state.recipeOpen.has('*all');
    const sparksWanted = wantedSparks();
    const matches = m => has(`${m.title} ${m.family} ${m.about || ''} ${m.variants.map(v => v.repo).join(' ')}`)
      && kindOf(m, state.recipeKind)
      && (!sparksWanted || m.setups.some(st => st.sparks === sparksWanted) || (sparksWanted === minSparks(m)))
      && (f !== 'Verified' || (m.verified || []).length);
    // Within a rank: what's on your Sparks or verified first, then what people run most.
    const here = m => ((m.verified || []).length ? 2 : 0) + (m.variants.some(v => (v.onDisk || []).length) ? 1 : 0);
    const models = d.models.filter(matches).sort((a, b) => b.rank - a.rank || here(b) - here(a) || b.setups.length - a.setups.length);
    const yours = [...(d.models.flatMap(m => (m.verified || []).map(v => ({ ...v, catalogTitle: m.title })))), ...(d.yours || [])]
      .filter(v => has(`${v.title} ${v.repo}`)).sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt));
    const hs = state.recipeSearch;
    const next = owner() && repos.length
      ? h('button', { class: 'btn primary', type: 'button', title: 'It’s added to the list, then Spark Console looks for setups that run it on DGX Spark.', onclick: e => addLinks(e.currentTarget) },
        icon('plus'), repos.length === 1 ? `Add ${repos[0]}` : `Add ${repos.length} models`)
      : canRun() && typed.length >= 2 && (!hs || hs.q !== typed) ? h('button', { class: 'btn', type: 'button', onclick: searchHub }, icon('search'), `Search Hugging Face for “${typed}”`) : null;
    redraw(body,
      next ? h('div', {}, next) : null,
      hs ? hubSection(hs) : null,
      yours.length && (f === 'All' || f === 'Verified') ? h('section', {},
        h('div', { class: 'section-head' }, h('h2', {}, 'Your recipes'), h('span', { class: 'muted' }, 'Started before, with the settings they ran with')),
        h('div', { class: 'card' }, h('div', { class: 'rows' }, yours.map(yourRow)))) : null,
      h('section', {},
        h('div', { class: 'section-head' }, h('h2', {}, 'All models'), h('span', { class: 'muted' }, `${models.length} of ${d.models.length}`)),
        models.length ? h('div', { class: 'rc-list' }, (showAll() ? models : models.slice(0, 12)).map(modelRow)) : h('div', { class: 'card' }, empty('book', 'No matching models', null)),
        !showAll() && models.length > 12 ? h('button', { class: 'btn', type: 'button', style: { 'margin-top': '10px' }, onclick: () => { state.recipeOpen.add('*all'); draw(); } }, `Show all ${models.length}`) : null));
  }

  function hubSection(hs) {
    const head = h('div', { class: 'section-head' }, h('h2', {}, 'From Hugging Face'),
      hs.data ? h('span', { class: 'muted' }, `searched ${hs.data.terms.map(t => `“${t}”`).join(', ')}${hs.data.by === 'sparkie' ? ` (terms from ${ASSISTANT})` : ''}`) : null,
      h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { state.recipeSearch = null; draw(); } }, 'Clear'));
    if (hs.loading) return h('section', {}, head, h('div', { class: 'card' }, h('div', { class: 'empty' }, h('span', { class: 'spinner' }), 'Searching…')));
    if (hs.error) return h('section', {}, head, failBanner('Couldn’t search Hugging Face', hs.error, () => searchHub()));
    const results = hs.data.results;
    return h('section', {}, head, results.length ? h('div', { class: 'rc-list' }, results.map(res => h('article', { class: 'card rc-model' },
      h('div', { class: 'rc-head', style: { cursor: 'default' } },
        h('div', { class: 'rc-title' }, h('strong', {}, res.title),
          res.inRecipes ? h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { state.recipeOpen.add(res.inRecipes.id); state.recipeOpen.add('*all'); state.recipeSearch = null; state.recipeQuery = ''; search.value = ''; draw(); } }, 'In the list', icon('chevronRight'))
            : owner() ? h('button', { class: 'btn sm primary', type: 'button', onclick: e => busy(e.currentTarget, () => addFound(res)) }, icon('plus'), 'Add') : null)),
      h('div', { class: 'rc-detail' }, h('div', { class: 'rows' }, res.versions.slice(0, 5).map(v => h('div', { class: 'row' },
        h('div', { class: 'row-main' }, h('div', { class: 'row-text' },
          h('div', { class: 'row-title' }, h('a', { href: `https://huggingface.co/${v.repo}`, target: '_blank', rel: 'noopener noreferrer' }, v.repo)),
          h('div', { class: 'row-sub' }, [v.quant, v.sizeGB ? `${Math.round(v.sizeGB)} GB` : null, v.sparks ? (v.sparks === 1 ? 'fits 1 Spark' : `needs ${v.sparks} Sparks`) : null,
            v.gated ? 'license to accept' : null, `${v.downloads >= 1e6 ? `${(v.downloads / 1e6).toFixed(1)}M` : v.downloads >= 1e3 ? `${Math.round(v.downloads / 1e3)}k` : v.downloads} downloads`].filter(Boolean).join(' · ')))))))))))
      : h('div', { class: 'card' }, empty('search', 'Nothing that fits your Sparks matched', 'Try a model family name, like “Qwen3-Coder” or “gemma-4”, or paste its Hugging Face link.')));
  }
  async function addFound(res) {
    try {
      const added = await capi('recipes/add', 'POST', { title: res.title, repos: res.versions.slice(0, 6).map(v => v.repo) });
      toast(`Added ${res.title}`, { sub: added.job ? 'Looking for setups that run it on DGX Spark…' : null });
      if (added.job) followServiceJob(added.job);
      await loadRecipes();
      res.inRecipes = { id: (state.recipes.data.models.find(m => m.variants.some(v => res.versions.some(x => repoKey(x.repo) === repoKey(v.repo)))) || {}).id, title: res.title };
      draw();
    } catch (e) { toast(e.message, { kind: 'bad', timeout: 9000 }); }
  }

  function yourRow(v) {
    const lib = (state.lib.data?.library || []).find(m => m.name === v.model || repoKey(m.repo) === repoKey(v.repo));
    const main = state.main.data, sparkieRuns = main?.healthy && repoKey(main.model) === repoKey(v.repo || v.model);
    const runningOn = sparkieRuns ? main.node : lib && state.lib.data.sparks.find(sp => sp.deployments.some(x => x.model === lib.name && x.state === 'running'))?.id;
    return h('div', { class: 'row' },
      h('div', { class: 'row-main' }, h('span', { class: 'row-icon ok' }, icon('check')),
        h('div', { class: 'row-text' }, h('div', { class: 'row-title' }, v.title),
          h('div', { class: 'row-sub' }, [sparksText(v.sparks), engineName(v.engine), v.file, v.best ? tokS(v.best.decodeTokS) : null, ...perfBits({ ttftMs: v.best?.ttftMs }), `last ${fmt.when(v.lastAt)}`, v.runs > 1 ? `${v.runs} runs` : null].filter(Boolean).join(' · ')))),
      h('div', { class: 'row-side' }, runningOn ? pill(`Running on ${nodeName(runningOn)}`, 'ok') : canRun() && lib && v.sparks <= 2
        ? h('button', { class: 'btn sm primary', type: 'button', onclick: () => startModel(lib, { verified: v.key, sparks: v.sparks }) }, icon('play'), 'Start')
        : h('span', { class: 'muted', style: { 'font-size': '12.5px' } }, lib ? '' : 'not on disk now')));
  }

  function modelRow(m) {
    const open = state.recipeOpen.has(m.id), toggle = () => { if (open) state.recipeOpen.delete(m.id); else state.recipeOpen.add(m.id); draw(); };
    const fits = minSparks(m), where = [...new Set(m.variants.flatMap(v => v.onDisk || []))];
    // The headline speed is on the fewest Sparks it fits (else the fewest with a number); the rest are inside.
    // Under a Spark filter, the speed is the one on that many Sparks.
    const want = wantedSparks();
    const speeds = [1, 2, 3, 4].map(n => [n, bestSpeed(m, n)]).filter(([, b]) => b);
    const top = want ? speeds.find(([n]) => n === want) : speeds.find(([n]) => n === fits) || speeds[0];
    const mineBest = want ? (m.verified || []).filter(v => v.best && v.sparks === want).sort((a, b) => b.best.decodeTokS - a.best.decodeTokS)[0] || null : yourSpeed(m);
    return h('article', { class: 'card rc-model' },
      h('button', { class: 'rc-head', type: 'button', 'aria-expanded': String(open), onclick: toggle },
        h('div', { class: 'rc-title' }, h('strong', {}, m.title), pill(m.family, 'plain'), (m.verified || []).length ? h('span', { class: 'tag' }, 'Verified') : null),
        m.about ? h('p', {}, m.about) : null,
        h('div', { class: 'recipe-meta' },
          fits < 99 ? h('span', { class: 'chip' }, icon('server'), fits === 1 ? 'Fits 1 Spark' : m.setups.some(st => st.sparks < fits) ? `Usually ${sparksText(fits)}` : `Needs ${fits} Sparks`) : null,
          top || mineBest ? h('span', { class: 'chip', title: mineBest ? `Measured on your Sparks: ${tokS(mineBest.best.decodeTokS)} on ${sparksText(mineBest.sparks)}` : null }, icon('zap'),
            top ? `≈ ${tokS(top[1].speed)}${top[0] !== fits ? ` on ${sparksText(top[0])}` : ''}` : `${tokS(mineBest.best.decodeTokS)} measured here`) : null,
          where.length ? h('span', { class: 'chip ok' }, icon('disk'), `On ${where.map(nodeName).join(', ')}`) : null,
          h('span', { class: 'muted rc-more' }, icon(open ? 'chevronDown' : 'chevronRight')))),
      open ? modelDetail(m) : null);
  }

  // The ways to run it, side by side: version, Sparks, memory, speeds and what runs it, with the trade-offs tagged.
  // Buttons only where a click gives what the row shows: a one-click setup, your own run, or default settings.
  function optionsTable(m) {
    // Under a Spark filter, only the ways on that many Sparks; one line says what else there is.
    const want = wantedSparks(), everyKey = `${m.id}:every`, every = state.recipeOpen.has(everyKey);
    const list = modelOptions(m, every ? null : want);
    if (!list.length) return null;
    const others = want ? modelOptions(m).filter(o => o.sparks !== want) : [];
    const counts = [...new Set(others.map(o => o.sparks))].sort();
    const flip = () => { if (every) state.recipeOpen.delete(everyKey); else state.recipeOpen.add(everyKey); draw(); };
    const scope = !others.length ? null : h('div', { class: 'rc-dig' },
      h('span', { class: 'muted' }, every ? 'Showing every number of Sparks.' : `Showing ${sparksText(want)}. ${plural(others.length, 'more way')} on ${counts.join(' or ')} Spark${counts.length > 1 || counts[0] > 1 ? 's' : ''}.`),
      h('button', { class: 'btn ghost sm', type: 'button', onclick: flip }, every ? `Only ${sparksText(want)}` : 'Show them'));
    // Six rows: the tagged trade-offs, your runs, the best one-click way on each number of Sparks, what's on disk, a
    // forum report, then the fastest of the rest. Everything else is in "All versions and setups".
    const pick = new Set(), add = o => { if (o && pick.size < 7) pick.add(o); };
    const oneClick = o => Boolean(o.mine || o.setup?.deployable);
    const headN = want && !every ? want : minSparks(m);
    list.filter(o => o.tags.length).forEach(add);
    // The row the card's speed comes from (fastest credible setup on that many Sparks).
    add(list.filter(o => !o.report && o.sparks === headN && num(o.speed) && o.setup?.credibility !== 'low').sort((a, b) => b.speed - a.speed)[0]);
    list.filter(o => o.mine).forEach(add);
    for (const n of [1, 2, 3, 4]) add(list.find(o => o.sparks === n && oneClick(o)) || list.find(o => o.sparks === n && !o.report));
    add(list.find(o => !o.report && o.repo && libFor(o.repo)));
    add(list.find(o => o.report));
    [...list].sort((a, b) => (b.speed || 0) - (a.speed || 0)).forEach(add);
    const shown = list.filter(o => pick.has(o));
    const action = o => {
      if (!canRun()) return null;
      if (o.report || (o.setup && !o.setup.deployable && !o.mine)) {
        const u = o.setup?.source?.url;
        return u ? h('a', { class: 'btn ghost sm', href: u, target: '_blank', rel: 'noopener noreferrer', title: o.report ? null : o.setup.why }, icon('external'), o.report ? 'Read it' : 'See how') : null;
      }
      const lib = o.repo && libFor(o.repo);
      if (o.sparks > 2) return h('span', { class: 'muted', style: { 'font-size': '12px' } }, 'Not one click yet');
      if (lib && o.setup?.deployable) return h('button', { class: 'btn sm primary', type: 'button', onclick: () => startModel(lib, { setup: o.setup.id, sparks: o.sparks, remoteCode: o.setup.args.some(a => a.startsWith('--trust-remote-code')) }) }, icon('play'), 'Start');
      if (lib && o.run) return h('button', { class: 'btn sm primary', type: 'button', onclick: () => startModel(lib, { verified: o.run.key, sparks: o.sparks }) }, icon('play'), 'Start');
      if (lib) return h('button', { class: 'btn sm', type: 'button', onclick: () => startModel(lib, { sparks: o.sparks }) }, icon('play'), 'Start');
      if (o.v) return h('button', { class: 'btn ghost sm', type: 'button', disabled: !d().libraryOnline || downloading(o.v.repo), onclick: () => downloadVersion(o.v, d()) }, icon('download'), downloading(o.v.repo) ? 'Downloading…' : 'Download');
      return null;
    };
    // A llama.cpp run of a safetensors version loads some GGUF conversion of it, whose size isn't known here.
    const memOf = o => (o.engine === 'llama.cpp' && o.v && !o.v.quants ? null : num(o.v?.needGB) ? `${o.v.needGB} GB` : num(o.v?.sizeGB) ? `${Math.round(o.v.sizeGB * 1.15 + 4)} GB` : null);
    const how = o => (o.mine ? 'measured here' : o.report ? 'forum report' : !o.setup ? 'default settings' : o.setup.deployable ? 'one click' : 'hand-built');
    const runsWith = o => (o.engine === 'other' ? (o.report ? 'Forum report' : 'Hand-built') : `${engineName(o.engine || o.v?.engine || 'vllm')} · ${how(o)}`);
    return [h('div', { class: 'table-wrap rc-options' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Version'), h('th', { class: 'num' }, 'Sparks'), h('th', { class: 'num' }, 'Memory'), h('th', {}, 'Speed'), h('th', {}, 'Runs with'), h('th', { class: 'num' }, h('span', { class: 'sr-only' }, 'Actions')))),
      h('tbody', {}, shown.map(o => h('tr', {},
        h('td', { class: 'opt-ver' }, h('div', {}, h('strong', {}, o.v?.quant || o.quant || (o.report ? 'Forum report' : '—')), o.tags.map(t => [' ', h('span', { class: 'tag' }, t)])),
          h('div', { class: 'row-sub' }, o.report ? (o.perf.context || '') : String(o.repo || '').split('/')[0]),
          h('div', { class: 'row-sub opt-mobile' }, [sparksText(o.sparks), memOf(o), runsWith(o)].filter(Boolean).join(' · '))),
        h('td', { class: 'num opt-hide-sm' }, String(o.sparks)),
        h('td', { class: 'num opt-hide-sm' }, memOf(o) || '—'),
        h('td', { class: 'opt-speed' }, h('div', {}, num(o.speed) ? tokS(o.speed) : h('span', { class: 'muted' }, '—')),
          perfBits(o.perf).length ? h('div', { class: 'row-sub' }, perfBits(o.perf).join(' · ')) : null),
        h('td', { class: 'opt-hide-sm' }, h('span', { class: 'row-sub' }, runsWith(o))),
        h('td', { class: 'num opt-act' }, action(o))))))), scope];
  }

  // Under the table: where the setups came from and when (owner: look again).
  function digLine(m) {
    const job = [...state.svcJobs.values()].find(j => j.type === 'dig' && j.modelId === m.id && underWay(j));
    const from = m.dug ? m.dug.sources.filter(x => x.found).map(x => x.name) : [];
    const text = !m.dug ? (owner() ? 'Look for setups in NVIDIA’s recipes, the forums, Spark Arena and the model cards.' : null)
      : from.length ? `Setups from ${plural(from.length, 'source')} · checked ${fmt.when(m.dug.at)}` : `No published setups yet (checked ${fmt.when(m.dug.at)}). It starts with default settings.`;
    if (!text && !job) return null;
    return h('div', { class: 'rc-dig' },
      job ? [h('span', { class: 'spinner sm' }), h('span', { class: 'muted' }, `${job.step}…`)] : h('span', { class: 'muted', title: from.join(', ') || null }, text),
      owner() && !job ? h('button', { class: 'btn ghost sm', type: 'button', onclick: e => busy(e.currentTarget, async () => {
        try { followServiceJob(await capi('recipes/dig', 'POST', { model: m.id })); } catch (err) { toast(err.message, { kind: 'bad', timeout: 9000 }); }
      }) }, icon('search'), m.dug ? 'Look again' : 'Find setups') : null);
  }

  function modelDetail(m) {
    // Setups: verified here first, then one-click, then by speed; reports and the rest after.
    const verifiedSet = new Set((m.verified || []).map(v => v.setupId).filter(Boolean));
    const setupRank = st => (verifiedSet.has(st.id) ? 0 : st.deployable ? 1 : st.report ? 3 : 2);
    const want = wantedSparks(), setups = m.setups.filter(st => !want || st.sparks === want)
      .sort((a, b) => setupRank(a) - setupRank(b) || (b.perf?.decodeTokS || 0) - (a.perf?.decodeTokS || 0));
    const shown = state.recipeOpen.has(`${m.id}:all`) ? setups : setups.slice(0, 6);
    // Versions that are on disk or fit first; the rest behind "Show more".
    const order = v => ((v.onDisk || []).length ? 0 : 1) * 10 + (v.sparks || 9);
    const versions = [...m.variants].sort((a, b) => order(a) - order(b));
    const allVersions = state.recipeOpen.has(`${m.id}:versions`), shownVersions = allVersions ? versions : versions.slice(0, 4);
    const versionSpeed = v => m.setups.filter(st => repoKey(st.repo) === repoKey(v.repo) && num(st.perf?.decodeTokS)).sort((a, b) => b.perf.decodeTokS - a.perf.decodeTokS)[0];
    const options = optionsTable(m), foldKey = `${m.id}:more`;
    const more = [
      h('h3', {}, `Versions (${m.variants.length})`),
      h('div', { class: 'rows' }, shownVersions.map(v => {
        const lib = libFor(v.repo), fast = versionSpeed(v);
        return h('div', { class: 'row' },
          h('div', { class: 'row-main' }, h('div', { class: 'row-text' },
            h('div', { class: 'row-title' }, h('a', { href: `https://huggingface.co/${v.repo}`, target: '_blank', rel: 'noopener noreferrer' }, v.repo)),
            h('div', { class: 'row-sub' }, [v.quant, v.sizeGB ? `${Math.round(v.sizeGB)} GB` : null, v.sparks ? (v.sparks === 1 ? 'fits 1 Spark' : `needs ${v.sparks} Sparks`) : null,
              fast ? `≈ ${tokS(fast.perf.decodeTokS)} on ${sparksText(fast.sparks)}` : null, v.quants?.length > 1 ? `${v.quants.length} sizes to pick from` : null,
              v.gated ? 'license to accept' : null, (v.onDisk || []).length ? `on ${v.onDisk.map(nodeName).join(', ')}` : null].filter(Boolean).join(' · ')))),
          h('div', { class: 'row-side' }, !canRun() ? null : lib
            ? h('button', { class: 'btn sm primary', type: 'button', onclick: () => startModel(lib) }, icon('play'), 'Start')
            : h('button', { class: 'btn ghost sm', type: 'button', disabled: !d().libraryOnline || downloading(v.repo), onclick: () => downloadVersion(v, d()) }, icon('download'), downloading(v.repo) ? 'Downloading…' : 'Download')));
      })),
      !allVersions && versions.length > 4 ? h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { state.recipeOpen.add(`${m.id}:versions`); draw(); } }, `Show ${versions.length - 4} more versions`) : null,
      h('h3', {}, `Setups people use (${setups.length})`),
      shown.length ? h('div', { class: 'rows' }, shown.map(st => {
        const lib = libFor(st.repo) || m.variants.map(v => libFor(v.repo)).find(Boolean);
        const sameRepo = lib && st.repo && repoKey(lib.repo || lib.name.replace('--', '/')) === repoKey(st.repo);
        const src = st.source || {}, extra = perfBits(st.perf);
        return h('div', { class: 'row' },
          h('div', { class: 'row-main' }, h('div', { class: 'row-text' },
            h('div', { class: 'row-title' }, [sparksText(st.sparks), engineName(st.engine), tokS(st.perf?.decodeTokS)].filter(Boolean).join(' · '),
              verifiedSet.has(st.id) ? [' ', h('span', { class: 'tag' }, 'Verified')] : st.report ? [' ', h('span', { class: 'tag' }, 'Report')] : null),
            extra.length || st.quant ? h('div', { class: 'row-sub' }, [st.report ? null : st.quant, ...extra].filter(Boolean).join(' · ')) : null,
            h('details', { class: 'rc-notes' }, h('summary', {}, [src.author ? `by ${src.author}` : (src.kind === 'nvidia' ? 'NVIDIA' : null), src.date].filter(Boolean).join(', ') || 'Details'),
              h('p', {}, [st.report ? st.perf?.context : null, st.speculative ? `speculative decoding: ${st.speculative}` : null, st.report ? null : st.perf?.context, st.perf?.quote ? `“${st.perf.quote}”` : null,
                st.imageNote || null, `${st.credibility} confidence`].filter(Boolean).join(' · '),
                src.url ? [' · ', h('a', { href: src.url, target: '_blank', rel: 'noopener noreferrer' }, 'source')] : null)))),
          h('div', { class: 'row-side' }, st.report
            ? (src.url ? h('a', { class: 'btn ghost sm', href: src.url, target: '_blank', rel: 'noopener noreferrer' }, icon('external'), 'Read it') : null)
            : !canRun() ? null : st.deployable && sameRepo
              ? h('button', { class: 'btn sm', type: 'button', onclick: () => startModel(lib, { setup: st.id, sparks: st.sparks, remoteCode: st.args.some(a => a.startsWith('--trust-remote-code')) }) }, icon('play'), 'Start')
              : h('span', { class: 'muted', style: { 'font-size': '12px', 'max-width': '180px', 'text-align': 'right' } }, st.deployable ? (st.repo ? `download ${st.repo.split('/')[0]}’s version first` : '') : st.why)));
      })) : h('p', { class: 'muted' }, 'No setups with numbers yet.'),
      setups.length > shown.length ? h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { state.recipeOpen.add(`${m.id}:all`); draw(); } }, `Show all ${setups.length}`) : null,
      m.engineNotes ? h('details', { class: 'rc-notes' }, h('summary', {}, 'Serving notes'), h('p', {}, m.engineNotes)) : null,
    ];
    // The table is the one list always shown; every version and setup is one click away.
    return h('div', { class: 'rc-detail' },
      options ? [h('h3', {}, 'Ways to run it'), options] : null,
      digLine(m),
      options ? h('details', { class: 'rc-more-fold', open: state.recipeOpen.has(foldKey), ontoggle: e => { if (e.target.open) state.recipeOpen.add(foldKey); else state.recipeOpen.delete(foldKey); } },
        h('summary', {}, `All ${plural(m.variants.length, 'version')} and ${plural(setups.length, 'setup')}${want ? ` on ${sparksText(want)}` : ''}`), h('div', { class: 'rc-detail-inner' }, more)) : more);
  }
  const d = () => r.data;
  const downloading = repo => [...state.svcJobs.values()].some(j => j.type === 'download' && repoKey(j.repo) === repoKey(repo) && underWay(j));

  live(draw);
  if (!r.loading && (!r.data || r.error)) loadRecipes();
}

async function downloadVersion(v, data) {
  let target = data.defaultTarget;
  // A GGUF version holds several sizes (quantizations): pick one; the default fits one Spark.
  let file = v.file || null;
  const sizeNow = () => (file && v.quants ? v.quants.find(x => x.file === file)?.sizeGB : v.sizeGB) || null;
  const fileSelect = v.quants?.length > 1 ? h('select', { class: 'select', 'aria-label': 'Size', onchange: e => { file = e.target.value; draw(); } },
    v.quants.map(x => h('option', { value: x.file, selected: x.file === file }, `${x.file} · ${Math.round(x.sizeGB)} GB${x.needGB > 105 ? ' · too big for one Spark' : ''}`))) : null;
  const picker = h('div', { class: 'radio-cards' }), sizeLine = h('p', { class: 'muted', style: { margin: '0' } });
  const draw = () => {
    const size = sizeNow() ? sizeNow() * 1e9 : null;
    const spots = data.targets.filter(t => mine(t.id)), roomy = t => !(size && num(t.diskFree) && t.diskFree < size * 1.05);
    // Never leave a Spark chosen that's full or not yours.
    if (!spots.some(t => t.id === target && roomy(t))) target = spots.find(roomy)?.id || null;
    set(sizeLine, sizeNow() ? `About ${Math.round(sizeNow())} GB` : '');
    set(picker, spots.map(t => h('label', { class: 'radio-card' },
      h('input', { type: 'radio', name: 'download-spark', value: t.id, checked: t.id === target, disabled: !roomy(t), onchange: () => { target = t.id; } }),
      h('div', {}, h('strong', {}, nodeName(t.id)),
        h('p', {}, num(t.diskFree) ? `${fmt.disk(t.diskFree / 2 ** 30)} free${roomy(t) ? '' : ' · not enough room'}` : 'free space unknown')))));
  };
  draw();
  const ok = await dialog({
    title: `Download ${v.repo}?`, confirm: 'Download',
    description: `From Hugging Face onto that Spark. Any Spark can start it afterwards; it’s copied over the first time.${v.engine === 'llama.cpp' ? ' It runs with llama.cpp, on one Spark.' : ''}${v.gated ? ' It needs its license accepted on huggingface.co and a Hugging Face sign-in on that Spark.' : ''}`,
    body: [fileSelect ? h('label', { class: 'field' }, 'Size', fileSelect) : null, sizeLine, h('div', { class: 'field' }, 'Download to', picker)],
    onConfirm: () => { if (!target) throw new Error('None of your Sparks has room for it.'); return true; },
  });
  if (!ok || !target) return;
  try { followServiceJob(await capi('recipes/download', 'POST', { repo: v.repo, node: target, ...(file ? { file } : {}) })); } catch (e) { toast(e.message, { kind: 'bad', timeout: 9000 }); }
}

/* ───────── chat ───────── */
function renderMarkdown(src) {
  const root = h('div', { class: 'md' });
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const listRe = /^\s*([-*+]|\d+[.)])\s+/;
  const isTable = i => /\|/.test(lines[i]) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1]);
  const cells = row => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      const lang = line.trim().slice(3).trim(), buf = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      put(root, codeBlock(buf.join('\n'), lang));
    } else if (/^#{1,6}\s/.test(line)) {
      const level = line.match(/^#+/)[0].length;
      put(root, h(level === 1 ? 'h3' : level === 2 ? 'h4' : 'h5', {}, inline(line.replace(/^#+\s*/, '').replace(/\s*#+\s*$/, ''))));
      i++;
    } else if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      put(root, h('hr'));
      i++;
    } else if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      put(root, h('blockquote', {}, [...renderMarkdown(buf.join('\n')).childNodes]));
    } else if (isTable(i)) {
      const head = cells(lines[i]);
      i += 2;
      const body = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) body.push(cells(lines[i++]));
      put(root, h('table', {}, h('thead', {}, h('tr', {}, head.map(c => h('th', {}, inline(c))))), h('tbody', {}, body.map(r => h('tr', {}, r.map(c => h('td', {}, inline(c))))))));
    } else if (listRe.test(line)) {
      const [list, next] = parseList(lines, i, listRe);
      put(root, list);
      i = next;
    } else if (!line.trim()) {
      i++;
    } else {
      const buf = [line];
      i++;
      while (i < lines.length && lines[i].trim() && !/^(\s*```|#{1,6}\s|\s*>)/.test(lines[i]) && !listRe.test(lines[i]) && !isTable(i)) buf.push(lines[i++]);
      put(root, h('p', {}, inline(buf.join('\n'))));
    }
  }
  return root;
}

function parseList(lines, i, listRe) {
  const indent = l => l.match(/^\s*/)[0].length;
  const base = indent(lines[i]);
  const list = h(/^\s*\d/.test(lines[i]) ? 'ol' : 'ul');
  let item = null;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) {
      if (i + 1 < lines.length && listRe.test(lines[i + 1]) && indent(lines[i + 1]) >= base) { i++; continue; }
      break;
    }
    const ind = indent(l), isItem = listRe.test(l);
    if (isItem && ind === base) { item = h('li', {}, inline(l.replace(listRe, ''))); list.append(item); i++; }
    else if (isItem && ind > base && item) { const [sub, next] = parseList(lines, i, listRe); put(item, sub); i = next; }
    else if (!isItem && ind > base && item) { put(item, ' ', inline(l.trim())); i++; }
    else break;
  }
  return [list, i];
}

function inline(text) {
  const out = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\((https?:\/\/[^)\s]+)\))|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
  let last = 0, m;
  const breaks = s => s.split('\n').flatMap((part, i) => (i ? [h('br'), part] : [part]));
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(...breaks(text.slice(last, m.index)));
    const t = m[0];
    if (m[1]) out.push(h('code', {}, t.slice(1, -1)));
    else if (m[2] || m[3]) out.push(h('strong', {}, inline(t.slice(2, -2))));
    else if (m[4]) out.push(h('em', {}, inline(t.slice(1, -1))));
    else if (m[5]) out.push(h('a', { href: m[6], target: '_blank', rel: 'noopener noreferrer' }, t.slice(1, t.indexOf(']('))));
    else out.push(h('a', { href: t, target: '_blank', rel: 'noopener noreferrer' }, t));
    last = m.index + t.length;
  }
  if (last < text.length) out.push(...breaks(text.slice(last)));
  return out;
}

function codeBlock(code, lang) {
  return h('div', { class: 'codeblock' },
    h('div', { class: 'codeblock-head' }, h('span', {}, lang || 'code'),
      h('button', { class: 'btn ghost sm', type: 'button', onclick: () => copy(code) }, icon('copy'), 'Copy')),
    h('pre', {}, h('code', {}, code)));
}

// A chat is either about the whole fleet or about one Spark; each question carries a live snapshot of that, kept apart
// from the question itself. Chats copied from the original portal had it glued on after SNAPSHOT_SEP.
const SNAPSHOT_MARK = '[Fleet snapshot from Spark Console';
const SNAPSHOT_SEP = '\n\n---\n';

// What Sparkie answers with: whatever it's set to on Models (its dedicated model, or another running model).
function sparkieModel() {
  const main = state.main.data, chat = main?.routes?.chat, healthy = chat ? chat.healthy : main?.healthy;
  return { name: chat?.title || main?.title || `${ASSISTANT}’s model`, up: Boolean(healthy && (chat?.node || main?.node)) };
}
// Chats are saved by the service (ids start sc_; ones copied from the original portal keep its id after sc_).
const isConsoleChat = id => /^sc_/.test(String(id || ''));
const canSparkChat = n => canChat() && isUp(n);
const sparkChatHref = id => `#/sparkie/new?spark=${encodeURIComponent(id)}`;

const chatTitle = x => String(x?.title || '').split(/\s*-{3}\s*\[(?:Fleet snapshot|Snapshot of)/)[0].trim() || 'Untitled chat';

function splitSnapshot(content) {
  const text = String(content ?? '');
  const i = text.indexOf(SNAPSHOT_SEP + SNAPSHOT_MARK);
  return i < 0 ? [text, null] : [text.slice(0, i), text.slice(i + SNAPSHOT_SEP.length)];
}

function nodeLine(n, host = portalHostId()) {
  const about = [hardware(n), host === n.id ? 'runs Spark Console' : null, conn(n.id)?.alias ? `ssh ${conn(n.id).alias}` : null].filter(Boolean).join('; ');
  if (!isUp(n)) return `- ${n.name} (${about}): ${condition(n) === 'stale' ? 'status out of date' : 'offline, not reachable over Tailscale'}`;
  const m = n.model || {}, net = n.network || {};
  const used = num(n.memoryTotalGiB) && num(n.memoryFreeGiB) ? n.memoryTotalGiB - n.memoryFreeGiB : null;
  const facts = [
    `GPU ${fmt.pct(n.gpuUtilization)}`,
    `memory ${fmt.gib(used)} of ${fmt.gib(n.memoryTotalGiB)} GB used`,
    fmt.temp(n.temperature),
    `${fmt.watts(n.gpuPowerWatts)} GPU`,
    wallState(n).has ? `${fmt.watts(n.wall.watts)} at the wall` : null,
    `disk ${fmt.disk(n.diskFreeGiB)} free`,
    n.runningContainers?.length ? `containers: ${n.runningContainers.join(', ')}` : 'no containers running',
    num(net.highSpeedLinksConfigured) ? `${net.highSpeedLinksUp} of ${net.highSpeedLinksConfigured} direct cables up` : null,
    n.issues?.length ? `issues: ${n.issues.join('; ')}` : null,
  ].filter(Boolean);
  return `- ${n.name} (${about}): online; ${facts.join('; ')}`;
}

function sparkSnapshot(n) {
  return [`[Snapshot of ${n.name} from Spark Console, ${new Date().toLocaleString()}]`, nodeLine(n)].join('\n');
}

function fleetSnapshot() {
  const list = nodes(), host = portalHostId(), main = state.main.data;
  const lines = list.map(n => nodeLine(n, host));
  const up = list.filter(isUp), total = sum(up, 'memoryTotalGiB'), used = total - sum(up, 'memoryFreeGiB');
  const control = up.find(n => n.network?.controlNetwork)?.network.controlNetwork;
  const linked = linkedPairs().map(p => `${nodeName(p.a)} + ${nodeName(p.b)}`);
  return [
    `${SNAPSHOT_MARK}, ${new Date().toLocaleString()}]`,
    ...lines,
    `Fleet: ${up.length} of ${list.length} online; ${fmt.gib(used)} of ${fmt.gib(total)} GB unified memory in use; ${sum(up, 'gpuPowerWatts').toFixed(1)} W GPU power${(w => (w.length ? `; ${w.reduce((a, x) => a + x.wall.watts, 0).toFixed(0)} W at the wall from ${plural(w.length, 'plug')}` : ''))(list.filter(x => wallState(x).has))}${control ? `; control network ${control}` : ''}.`,
    `Sparks with a direct link to each other: ${linked.length ? linked.join('; ') : 'none known'}.`,
    main?.configured ? `${ASSISTANT}'s own model: ${main.title} on ${nodeName(main.node)} (${main.healthy ? 'ready' : main.state || 'unknown'}).` : null,
  ].filter(Boolean).join('\n');
}

PAGES.sparkie = function sparkiePage(view, r) {
  if (!canChat()) { put(view, empty('lock', `${ASSISTANT} isn’t enabled for you`, 'Ask the owner for access.')); return; }
  view.className = 'view flush';
  const c = state.chat;
  const id = r.a && r.a !== 'new' ? r.a : null;
  if (c.conv?.id !== id) c.conv = null;
  if (!id) c.spark = r.params.get('spark') || null;
  else if (!c.conv) c.spark = null;
  const subjectNode = () => (c.spark ? node(c.spark) : null);

  const items = h('div', { class: 'chat-items' });
  const search = h('input', { class: 'input sm', type: 'search', placeholder: 'Search chats', 'aria-label': 'Search chats', value: c.search, oninput: () => { c.search = search.value; drawList(); } });
  const title = h('h2', {});
  const headActions = h('div', { class: 'btn-row' });
  const inner = h('div', { class: 'messages-inner' });
  const scroller = h('div', { class: 'messages' }, inner);
  const ta = h('textarea', { rows: '1', 'aria-label': 'Message', value: c.draft });
  const subject = h('div', { class: 'btn-row' });
  // The model Sparkie answers with; the owner changes it on Models.
  const modelBtn = owner() ? h('a', { class: 'btn ghost sm composer-model', href: '#/models', title: `${ASSISTANT}’s model. Change it on Models.` }) : h('span', { class: 'chip composer-model' });
  const sendBtn = h('button', { class: 'btn primary sm', type: 'submit' }, icon('send'), 'Send');
  const note = h('p', { class: 'composer-note' });
  const alert = h('div', { class: 'composer-alert' });
  const layout = h('div', { class: 'chat' });

  const grow = () => {
    ta.style.height = 'auto';
    if (ta.value) ta.style.height = `${Math.min(ta.scrollHeight, 240)}px`;
  };
  // With Sparkie down, Send still works for the owner's words (/status, /pause, /restart sparkie, /stop, /undo update, /help): code answers them.
  const slashDraft = () => owner() && ta.value.trim().startsWith('/');
  // One of the owner's words, exactly (the same rule as the server's): it goes through even while another answer is
  // stuck, as its own small request.
  const OWNER_WORDS = ['/status', '/pause', '/restart sparkie', '/stop', '/undo update', '/help'];
  const isWord = text => { const t = String(text).trim().toLowerCase().replace(/_/g, ' '); return owner() && t.length <= 40 && OWNER_WORDS.includes(t); };
  const syncSend = () => { sendBtn.disabled = (c.sending && !isWord(ta.value)) || (!sparkieModel().up && !slashDraft()); };
  ta.addEventListener('input', () => { c.draft = ta.value; grow(); syncSend(); });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });

  const form = h('form', { class: 'composer', onsubmit: e => { e.preventDefault(); send(ta.value); } },
    ta, h('div', { class: 'composer-bar' }, subject, modelBtn, h('span', { class: 'grow' }), sendBtn));
  const composerWrap = h('div', { class: 'composer-wrap' }, alert, form, note);

  put(layout,
    h('aside', { class: 'chat-list', 'aria-label': 'Conversations' },
      h('div', { class: 'chat-list-head' }, search, h('a', { class: 'btn sm primary', href: '#/sparkie/new', title: `New ${ASSISTANT} chat about all your Sparks`, onclick: e => {
        c.conv = null; c.draft = ''; layout.classList.remove('show-list');
        // Already on a new chat: start it over (the address alone wouldn't change anything).
        if (!e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); go('sparkie/new'); }
      } }, icon('plus'), 'New')),
      items),
    h('section', { class: 'chat-main' },
      h('div', { class: 'chat-head' },
        h('button', { class: 'btn ghost sm icon-only chat-back', type: 'button', 'aria-label': 'Show conversations', onclick: () => layout.classList.add('show-list') }, icon('chevronLeft')),
        title, headActions),
      scroller,
      composerWrap));
  put(view, layout);
  // Toasts sit just above the message box, however tall it grows (see .toasts in styles.css).
  new ResizeObserver(() => { if (composerWrap.isConnected) document.documentElement.style.setProperty('--composer-h', `${composerWrap.offsetHeight}px`); }).observe(composerWrap);

  function drawList() {
    const q = c.search.trim().toLowerCase();
    const convs = [...(state.consoleChats || [])]
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .filter(x => !q || chatTitle(x).toLowerCase().includes(q));
    redraw(items, ...(convs.length ? convs.map(x =>
      h('a', { class: 'chat-item', href: `#/sparkie/${x.id}`, 'aria-current': x.id === (c.conv?.id || id) ? 'page' : null },
        h('strong', {}, chatTitle(x)),
        // A conversation one of your agents had with Sparkie says which agent.
        h('small', {}, x.agent ? [h('span', { class: 'from-tag' }, `from ${x.agent}`), ' '] : null,
          [fmt.when(x.updatedAt), `${x.messageCount ?? 0} messages`, x.agent ? null : x.spark ? nodeName(x.spark) : 'All Sparks'].filter(Boolean).join(' · '))))
      : [state.chatsError && !q ? h('div', { style: { padding: '8px' } }, failBanner('Couldn’t load your chats', state.chatsError, loadConsoleChats))
        : h('p', { class: 'muted', style: { padding: '8px 10px', 'font-size': '13px' } }, q ? 'No matches.' : 'No chats yet.')]));
  }

  function drawHead() {
    const n = subjectNode();
    title.textContent = c.conv ? chatTitle(c.conv) : id ? 'Loading…' : n ? `${ASSISTANT} · ${n.name}` : `Ask ${ASSISTANT}`;
    set(headActions, c.conv?.agent ? h('span', { class: 'from-tag', title: `A conversation ${c.conv.agent} had with ${ASSISTANT}. You can join in.` }, `from ${c.conv.agent}`) : null, c.conv ? menuButton([
      { label: 'Rename', icon: 'edit', onSelect: renameChat },
      { label: 'Copy transcript', icon: 'copy', onSelect: () => copy((c.conv.messages || []).map(m => (m.role === 'user' ? `${m.from || 'You'}: ${splitSnapshot(m.content)[0]}` : `${m.notice ? 'Spark Console' : ASSISTANT}: ${m.content}`)).join('\n\n')) },
      'sep',
      { label: 'Delete chat', icon: 'trash', danger: true, onSelect: deleteChat },
    ]) : null);
  }

  // A new chat is about all the Sparks or one of them, picked here; once it's started it stays what it was about.
  function subjectMenu() {
    return [
      { heading: 'Ask about' },
      { label: 'All Sparks', icon: c.spark ? 'server' : 'check', hint: 'the whole fleet', onSelect: () => pickSubject(null) },
      ...nodes().map(x => ({ label: x.name, icon: c.spark === x.id ? 'check' : 'chip', hint: COND[condition(x)]?.[0], onSelect: () => pickSubject(x.id) })),
    ];
  }
  function pickSubject(sparkId) {
    c.spark = sparkId;
    history.replaceState(null, '', `#/sparkie/new${sparkId ? `?spark=${encodeURIComponent(sparkId)}` : ''}`);
    drawHead(); drawComposer(); drawMessages();
    ta.focus();
  }

  function drawComposer() {
    const n = subjectNode();
    const label = n ? [led(condition(n)), n.name] : [icon('server'), 'All Sparks'];
    redraw(subject, c.conv
      ? h('span', { class: n ? 'chip ok' : 'chip', title: n ? `This chat is about ${n.name}` : 'This chat is about your whole fleet' }, label)
      : h('button', { class: 'btn ghost sm', type: 'button', 'aria-haspopup': 'menu', title: 'Ask about all your Sparks, or just one',
        onclick: e => openMenu(e.currentTarget, subjectMenu(), 'start') }, label, icon('chevronDown')));
    const model = sparkieModel(), main = state.main.data;
    redraw(modelBtn, icon('sparkle'), model.name, owner() ? icon('chevronRight') : null);
    ta.placeholder = n ? `Ask ${ASSISTANT} about ${n.name}…` : `Ask ${ASSISTANT}…`;
    const down = !model.up;
    const why = main?.state === 'running' && main.routes?.chat?.kind !== 'endpoint'
      ? `${model.name} is still loading on ${nodeName(main.node)}. That takes a few minutes after a start.`
      : `${model.name} isn’t running. ${owner() ? 'Start it from Models, then come back.' : 'Ask the owner to start it.'}`;
    // Until Sparkie's state has loaded, just hold Send; don't flash a warning.
    redraw(alert, down && main ? h('div', { class: 'banner warn' }, icon('alert'),
      h('div', { class: 'banner-text' }, h('strong', {}, `${ASSISTANT} can’t answer right now`), h('p', {}, why, owner() ? ' Type /help for what still works.' : '')),
      owner() ? h('a', { class: 'btn sm', href: '#/models' }, 'Open Models') : null) : null);
    syncSend();
    sendBtn.toggleAttribute('aria-busy', c.sending);
    // Sparkie's tools are the owner's: in other people's chats it still only answers.
    note.textContent = down || !c.conv ? '' : n && !isUp(n) ? `${n.name} is offline, so live answers about it aren’t available right now.`
      : owner() ? `${ASSISTANT} looks things up on your Sparks as it answers, and can start, stop or restart models when you ask.`
        : !n ? `Each question includes a live snapshot of all your Sparks, so ${ASSISTANT} can answer about health, capacity and setup.`
          : `Each question includes ${n.name}’s live state. ${ASSISTANT} answers with ${model.name} and can’t change anything itself.`;
  }

  // Ideas to start with. In the owner's chats Sparkie can act, so most of them do something; in members' chats it
  // only answers, so theirs are questions. A pick fills the box, ready to send or change.
  function welcome() {
    const n = subjectNode();
    const pick = prompt => () => { ta.value = c.draft = prompt; grow(); ta.focus(); };
    // The Spark to tidy up: one that runs something but is barely busy, else the last one online.
    const up = nodes().filter(isUp);
    const quiet = [...up].reverse().find(x => workloads(x).length && (x.gpuUtilization || 0) < 5) || up.at(-1);
    const acts = owner();
    const ideas = n ? (acts ? [
      ['How busy is it?', `What’s running on ${n.name}, and how busy is it?`],
      ['Start a model here', `Start the best model that fits on ${n.name}.`],
      ['Stop what’s idle', `Stop what’s idle on ${n.name}.`],
      ['Health check', `Is anything unhealthy on ${n.name} right now?`],
    ] : [
      ['How busy is it?', `What’s running on ${n.name}, and how busy is it?`],
      ['Room for another model?', `How much memory is free on ${n.name}, and what size of model fits there?`],
      ['Health check', `Is anything unhealthy on ${n.name} right now?`],
      ['Anything failing?', `Is anything on ${n.name} failing or restarting?`],
    ]) : (acts ? [
      ['Start a coding model', 'Start the best coding model that fits.'],
      ['How busy is each Spark?', 'What’s running, and how busy is each Spark?'],
      quiet ? [`Free up ${quiet.name}`, `Stop what’s idle on ${quiet.name}.`] : ['Fleet health', 'Give me a quick health summary of all my Sparks.'],
      ['Find a vision model', 'Find a good vision model that runs on my Sparks.'],
    ] : [
      ['How busy is each Spark?', 'What’s running, and how busy is each Spark?'],
      ['Where to run a model', 'Which Spark has the most free memory, and what size of model fits there?'],
      ['Find a vision model', 'Which vision models run well on these Sparks?'],
      ['Fleet health', 'Give me a quick health summary of all the Sparks.'],
    ]);
    return h('div', { class: 'chat-welcome' },
      h('div', { class: 'chat-orb' }, icon(n ? 'chip' : 'server')),
      h('h2', {}, n ? `Ask ${ASSISTANT} about ${n.name}` : `Ask ${ASSISTANT}`),
      h('p', {}, n
        ? `${ASSISTANT} answers from ${n.name}’s live state${acts ? ', and can start or stop models there when you ask' : ': services, memory and workloads'}.`
        : acts ? `${ASSISTANT} sees your whole fleet live. Ask about it, or say what you want done: start, stop or find a model.`
          : `${ASSISTANT} sees a live snapshot of the whole fleet with every question, so ask about health, capacity, or what runs where.`),
      h('div', { class: 'suggestions' }, ideas.map(([label, prompt]) =>
        h('button', { class: 'suggestion', type: 'button', onclick: pick(prompt) }, h('strong', {}, label), prompt))));
  }

  // Sparkie's buttons under a message: the open ones to press (in the owner's chats), and the one picked as a quiet line.
  function choiceRow(m) {
    const list = m.choices || [];
    const picked = list.filter(x => x.state === 'picked'), open = owner() ? list.filter(x => x.state === 'open') : [];
    if (!picked.length && !open.length) return null;
    return h('div', { class: 'msg-choices' },
      picked.map(x => h('p', { class: 'choice-picked' }, icon('check'), x.label)),
      open.length ? h('div', { class: 'btn-row' }, open.map(x => h('button', { class: 'btn sm', type: 'button', onclick: e => choose(x, e.currentTarget) }, x.label))) : null);
  }

  function messageEl(m) {
    const mine = m.role === 'user';
    // Spark Console's own notes in the conversation (what a button did, or how an operation ended): quieter, and not
    // Sparkie's words.
    if (m.notice) {
      const bad = ['failed', 'interrupted'].includes(m.status) || /^Couldn’t /.test(m.content || '');
      return h('div', { class: 'msg notice' },
        h('div', { class: `msg-avatar${bad ? ' bad' : ''}`, 'aria-hidden': 'true' }, icon(bad ? 'alert' : 'checkCircle')),
        h('div', { style: { 'min-width': '0' } },
          h('div', { class: 'msg-meta' }, h('strong', {}, 'Spark Console'), h('span', {}, fmt.time(m.createdAt))),
          m.content ? h('div', { class: 'msg-body' }, renderMarkdown(m.content)) : null,
          choiceRow(m)));
    }
    const [text, snapshot] = mine ? ('context' in m ? [m.content, m.context] : splitSnapshot(m.content)) : [m.content, null];
    // In a conversation one of your agents had with Sparkie, its messages carry its name.
    return h('div', { class: `msg ${mine ? 'user' : 'assistant'}${m.from ? ' from-agent' : ''}` },
      h('div', { class: 'msg-avatar', 'aria-hidden': 'true' }, mine ? (m.from ? icon('key') : initials(state.boot.userName)) : ASSISTANT[0]),
      h('div', { style: { 'min-width': '0' } },
        h('div', { class: 'msg-meta' }, h('strong', {}, mine ? m.from || 'You' : ASSISTANT), !mine && (m.nodeId || m.node) ? h('span', {}, `on ${nodeName(m.nodeId || m.node)}`) : null,
          m.streaming ? h('span', {}, m.content ? 'answering…' : m.tools?.length ? 'looking things up…' : m.thinking ? 'thinking…' : 'reading…') : h('span', {}, fmt.time(m.createdAt))),
        mine ? h('div', { class: 'msg-body' }, text)
          : m.streaming && !m.content ? h('div', { class: 'typing', role: 'status', 'aria-label': `${ASSISTANT} is replying` }, h('i'), h('i'), h('i'))
            : m.content ? h('div', { class: 'msg-body' }, renderMarkdown(m.content)) : null,
        !mine && m.tools?.length ? toolLines(m.tools, (m.choices || []).length > 0) : null,
        !mine ? checkedFold(m) : null,
        !mine && !m.streaming ? choiceRow(m) : null,
        snapshot ? h('details', { class: 'snapshot' }, h('summary', {}, icon('server'), 'Live snapshot attached'), h('pre', {}, snapshot)) : null,
        m.error ? h('div', { class: 'banner bad', style: { 'margin-top': '8px' } }, icon('alert'), h('div', { class: 'banner-text' }, m.error || 'This reply failed.')) : null,
        m.truncated ? h('p', { class: 'muted', style: { 'font-size': '12px', 'margin-top': '6px' } }, `The answer hit its length limit. Ask ${ASSISTANT} to continue.`) : null,
        !mine && !m.streaming && m.content ? h('div', { class: 'msg-actions' }, h('button', { class: 'btn ghost sm', type: 'button', onclick: () => copy(m.content) }, icon('copy'), 'Copy')) : null));
  }

  // A fresh copy of the conversation from the service. Messages that didn't change keep the ones already shown, so
  // what's selected or open in them stays.
  function withMessages(old, fresh) {
    const { outcome, operation, message, ...conv } = fresh;
    const before = old?.id === conv.id ? old.messages || [] : [];
    conv.messages = (conv.messages || []).map((m, i) => (before[i] && JSON.stringify(before[i]) === JSON.stringify(m) ? before[i] : m));
    return conv;
  }

  // Pressing one of Sparkie's buttons: what it offered runs, and the conversation shows what happened.
  async function choose(x, btn) {
    const conv = c.conv;
    if (!conv || c.sending) return;
    // One press at a time: that message's buttons wait while it runs.
    const row = btn.closest('.msg-choices'), all = [...(row?.querySelectorAll('button') || [])];
    for (const b of all) b.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    try {
      const r = await capi(`chats/${conv.id}/choose`, 'POST', { choice: x.id });
      if (c.conv?.id === conv.id && !c.sending) { c.conv = withMessages(c.conv, r); drawMessages(); }
      if (r.operation) followNewJobs();
      // Followed even without an operation id: a press that took too long still posts its result here.
      watchOps(conv.id, r.operation ? [r.operation] : [], 2);
    } catch (e) {
      failToast(e);
      for (const b of all) b.disabled = false;
      btn.removeAttribute('aria-busy');
      // An expired button: the conversation as saved shows it gone.
      const saved = await capi(`chats/${conv.id}`).catch(() => null);
      if (saved && c.conv?.id === conv.id && !c.sending) { c.conv = withMessages(c.conv, saved); drawMessages(false); }
    }
  }

  // Operations started from this conversation post their result in it when they finish. While one is under way (or a
  // button just started one), the conversation is read again every 5 seconds until it settles.
  // An operation stops being waited for once its result is posted, or Activity shows it ended (a restart can cut one off
  // without a result) or no longer lists it. atLeast: read the conversation this many times whatever happens.
  let watching = null;
  function watchOps(convId, ops = [], atLeast = 0) {
    if (watching?.convId === convId) { for (const op of ops) watching.pending.add(op); watching.atLeast = Math.max(watching.atLeast, watching.polls + atLeast); return; }
    const w = watching = { convId, pending: new Set(ops), polls: 0, atLeast };
    const here = () => watching === w && layout.isConnected && c.conv?.id === convId;
    (async () => {
      const until = Date.now() + 30 * 60000;
      while (here() && Date.now() < until) {
        const posted = new Set((c.conv.messages || []).filter(m => m.notice && m.operation).map(m => m.operation));
        const jobs = activityJobs();
        for (const op of [...w.pending]) {
          const j = jobs.find(x => x.id === op);
          if (posted.has(op) || (j && !underWay(j)) || (!j && w.polls > 0)) w.pending.delete(op);
        }
        if (w.polls >= w.atLeast && !w.pending.size && !jobs.some(j => j.conv === convId && underWay(j))) break;
        await sleep(5000);
        if (!here()) break;
        if (c.sending || c.waiting) continue;
        await loadJobs();
        const saved = await capi(`chats/${convId}`).catch(() => null);
        w.polls++;
        if (saved && here() && !c.sending) { c.conv = withMessages(c.conv, saved); drawMessages(false); }
      }
      if (watching === w) watching = null;
    })();
  }

  // Finished messages are built once and kept (so selections, copies and open snapshots survive); only the reply
  // being written is rebuilt.
  const built = new WeakMap();
  const msgView = m => {
    if (m.streaming) return messageEl(m);
    if (!built.has(m)) built.set(m, messageEl(m));
    return built.get(m);
  };
  const waitingEl = h('div', { class: 'msg assistant' }, h('div', { class: 'msg-avatar', 'aria-hidden': 'true' }, ASSISTANT[0]),
    h('div', {}, h('div', { class: 'msg-meta' }, h('strong', {}, ASSISTANT), h('span', {}, 'thinking…')), h('div', { class: 'typing', role: 'status', 'aria-label': `${ASSISTANT} is replying` }, h('i'), h('i'), h('i'))));
  function drawMessages(stick = true) {
    const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
    const msgs = c.conv?.messages || [];
    if (id && !c.conv) set(inner, h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
    else if (!msgs.length && !c.waiting) set(inner, welcome());
    else {
      const list = [...msgs.map(msgView), c.waiting ? waitingEl : null].filter(Boolean);
      if (!list.some(x => x.parentNode === inner)) set(inner, ...list);
      else redraw(inner, ...list);
    }
    if (stick || nearBottom) scroller.scrollTop = scroller.scrollHeight;
  }

  let drawQueued = false;
  const drawSoon = () => {
    if (drawQueued) return;
    drawQueued = true;
    setTimeout(() => { drawQueued = false; if (layout.isConnected) drawMessages(false); }, 100);
  };

  async function openConsole(convId) {
    try {
      let conv = await capi(`chats/${convId}`);
      if (route().a !== convId) return;
      c.conv = conv;
      c.spark = conv.spark || null;
      drawHead(); drawMessages(); drawList(); drawComposer();
      // A reply that was still being written when the page opened: check back until it's saved.
      while (conv.replying && route().a === convId) {
        c.waiting = true;
        drawMessages(false);
        await sleep(2000);
        conv = await capi(`chats/${convId}`);
        if (c.conv?.id === convId) c.conv = conv;
      }
      c.waiting = false;
      if (layout.isConnected) drawMessages();
      loadJobs().then(() => watchOps(convId));
    } catch (e) {
      set(inner, empty('alert', 'Couldn’t open this chat', e.message, h('a', { class: 'btn', href: '#/sparkie/new' }, 'Start a new chat')));
    }
  }

  async function open(convId) {
    // An old portal link: its chat was copied in under the same id with sc_ in front.
    if (!isConsoleChat(convId)) { go(`sparkie/sc_${convId}`); return; }
    return openConsole(convId);
  }

  async function sendConsole(text) {
    c.sending = true;
    drawComposer();
    try {
      let conv = c.conv;
      if (!conv) {
        conv = await capi('chats', 'POST', { spark: c.spark });
        c.conv = conv;
        history.replaceState(null, '', `#/sparkie/${conv.id}`);
      }
      const n = subjectNode(), context = n ? sparkSnapshot(n) : fleetSnapshot();
      ta.value = c.draft = '';
      grow();
      const reply = { role: 'assistant', content: '', createdAt: new Date().toISOString(), node: state.main.data?.node, streaming: true };
      conv.messages = [...(conv.messages || []), { role: 'user', content: text, context, createdAt: new Date().toISOString() }, reply];
      drawHead();
      drawMessages();
      await streamChat(`chats/${conv.id}/messages`, { text, context }, ev => {
        if (ev.type === 'thinking') reply.thinking = true;
        if (ev.type === 'delta') reply.content += ev.text;
        if (ev.type === 'tool') {
          reply.tools = [...(reply.tools || []), { name: ev.name, title: ev.title, ok: ev.ok, ms: ev.ms, change: ev.change, outcome: ev.outcome }];
          if (ev.change && ev.ok) followNewJobs();
        }
        if (ev.type === 'done' || ev.type === 'error') {
          Object.assign(reply, ev.message, { streaming: false });
          announce(ev.type === 'done' ? `${ASSISTANT} replied.` : `${ASSISTANT}’s reply failed.`);
        }
        if (c.conv === conv) drawSoon();
      });
      if (reply.streaming) Object.assign(reply, { streaming: false, error: reply.content ? null : 'The connection closed before the answer finished.' });
      // The saved copy has the title the first message gave it, and the reply as stored.
      const saved = await capi(`chats/${conv.id}`).catch(() => null);
      if (saved && c.conv === conv) c.conv = saved;
    } catch (e) {
      toast(e.message, { kind: 'bad', timeout: 9000 });
      if (c.conv) c.conv.messages = (c.conv.messages || []).filter(m => !m.streaming);
    } finally {
      c.sending = false;
      if (layout.isConnected) { drawHead(); drawMessages(); drawComposer(); }
      loadConsoleChats();
    }
  }

  // A word sent while another answer is still coming: its notice is added to the chat on screen; the other answer and
  // the shared sending state are left alone.
  async function sendWord(text) {
    ta.value = c.draft = '';
    grow();
    syncSend();
    try {
      let conv = c.conv;
      if (!conv) {
        conv = c.conv = await capi('chats', 'POST', { spark: c.spark });
        history.replaceState(null, '', `#/sparkie/${conv.id}`);
        drawHead();
      }
      let notice = null;
      await streamChat(`chats/${conv.id}/messages`, { text }, ev => { if (ev.type === 'done') notice = ev.message; });
      if (notice && c.conv?.id === conv.id) { c.conv.messages = [...(c.conv.messages || []), notice]; drawMessages(); }
    } catch (e) {
      toast(e.message, { kind: 'bad', timeout: 9000 });
    } finally {
      loadConsoleChats();
    }
  }

  async function send(text) {
    text = text.trim();
    if (!text) return;
    if (c.sending) { if (isWord(text)) await sendWord(text); return; }
    await sendConsole(text);
    // Anything Sparkie started is followed until its result is posted here.
    if (c.conv && layout.isConnected) loadJobs().then(() => { if (c.conv) watchOps(c.conv.id); });
  }

  async function renameChat() {
    const name = await promptText({ title: 'Rename chat', label: 'Title', value: c.conv.title || '' });
    if (!name) return;
    try {
      c.conv = await capi(`chats/${c.conv.id}`, 'PATCH', { title: name });
      loadConsoleChats();
      drawHead();
    } catch (e) { toast(e.message, { kind: 'bad' }); }
  }

  async function deleteChat() {
    const ok = await dialog({ title: 'Delete this chat?', description: 'It’s removed for good. Copy anything you want to keep first.', confirm: 'Delete chat', danger: true });
    if (!ok) return;
    try {
      await capi(`chats/${c.conv.id}`, 'DELETE');
      c.conv = null;
      await loadConsoleChats();
      go('sparkie/new');
    } catch (e) { toast(e.message, { kind: 'bad' }); }
  }

  live(() => {
    drawList();
    drawComposer();
    if (!id && !c.conv && !c.waiting) drawMessages();
  });
  drawHead();
  drawMessages();
  grow();
  if (id && !c.conv) open(id);
  // Back on a chat that was open before: catch up with what was posted meanwhile, and follow its operations again.
  else if (id && !c.sending) {
    capi(`chats/${id}`).then(saved => { if (saved && layout.isConnected && c.conv?.id === id && !c.sending) { c.conv = withMessages(c.conv, saved); drawMessages(false); } }).catch(() => {});
    loadJobs().then(() => watchOps(id));
  }
  if (c.pendingPrompt) {
    // A question asked from ⌘K starts a new chat. If one is still being sent, it waits in the box instead.
    const prompt = c.pendingPrompt;
    c.pendingPrompt = null;
    if (!id && !c.sending) send(prompt);
    else { ta.value = c.draft = prompt; grow(); ta.focus(); }
  } else if (!matchMedia('(pointer: coarse)').matches) ta.focus();
};

/* ───────── files ───────── */
const fileApi = (nodeId, operation, path, extra = {}) => capi(`nodes/${nodeId}/files`, 'POST', { operation, path, area: state.files.area, ...extra });
const joinPath = (...parts) => parts.filter(Boolean).join('/');
const isFolder = e => e.kind === 'folder' || e.kind === 'directory' || e.type === 'directory' || e.isDirectory === true;
function encodeBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}
const decodeBase64 = data => Uint8Array.from(atob(data), ch => ch.charCodeAt(0));
function saveBlob(name, bytes, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };

PAGES.files = function filesPage(view, r) {
  if (!canFiles()) { put(view, empty('lock', 'Files aren’t shared with you', 'Ask the owner for file access.')); return; }
  const list = nodes().filter(n => n.configured !== false && mine(n.id));
  const id = r.a && list.some(n => n.id === r.a) ? r.a : state.files.node && list.some(n => n.id === state.files.node && isUp(n)) ? state.files.node : (list.find(isUp) || list[0])?.id;
  if (!id) { put(view, empty('folder', 'No Sparks available', null)); return; }
  const picker = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Spark' });
  live(() => redraw(picker, ...list.map(n => h('button', {
    type: 'button', 'aria-pressed': String(n.id === id), disabled: !isUp(n), title: isUp(n) ? null : `${n.name} is offline`,
    onclick: () => go(`files/${n.id}`),
  }, led(condition(n)), n.name))));
  const p = perms();
  const areas = owner() ? [] : [['personal', 'My files', p.files], ['shared', 'Shared', p.sharedFiles]].filter(([, , a]) => a && a !== 'none');
  if (areas.length && !areas.some(([k]) => k === state.files.area)) state.files.area = areas[0][0];
  put(view, 
    pageHead('Files', owner() ? 'Browse, preview, upload and download across your Sparks.' : 'Your space on each Spark, plus a shared space.', picker,
      areas.length > 1 ? h('div', { class: 'segmented', role: 'group', 'aria-label': 'File space' }, areas.map(([key, label]) =>
        h('button', { type: 'button', 'aria-pressed': String(state.files.area === key), onclick: () => { state.files.area = key; state.files.node = null; render(); } }, label))) : null),
    filesBrowser(id));
};

function filesBrowser(nodeId) {
  const f = state.files;
  if (f.node !== nodeId) Object.assign(f, { node: nodeId, path: '', entries: null, error: null, total: 0, nextOffset: null, editorPath: null });
  const n0 = node(nodeId);
  const pathEl = h('div', { class: 'path', 'aria-label': 'Folder path' });
  const tools = h('div', { class: 'btn-row' });
  const body = h('div');
  const foot = h('div', { class: 'muted', style: { padding: '10px 16px', 'font-size': '12.5px', display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', gap: '10px', 'border-top': '1px solid var(--border)' } });
  const upload = h('input', { type: 'file', multiple: true, hidden: true, onchange: () => { uploadFiles([...upload.files]); upload.value = ''; } });
  const card = h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, pathEl, tools), body, foot, upload);

  card.addEventListener('dragover', e => { if (fileAccess() === 'write' && e.dataTransfer?.types.includes('Files')) { e.preventDefault(); card.classList.add('dropzone'); } });
  card.addEventListener('dragleave', e => { if (!card.contains(e.relatedTarget)) card.classList.remove('dropzone'); });
  card.addEventListener('drop', e => {
    card.classList.remove('dropzone');
    if (fileAccess() !== 'write' || !e.dataTransfer?.files.length) return;
    e.preventDefault();
    uploadFiles([...e.dataTransfer.files]);
  });

  async function load(path = f.path, offset = 0) {
    if (!isUp(node(nodeId))) { draw(); return; }
    const epoch = ++f.epoch, moved = path !== f.path;
    f.path = path;
    f.busy = true;
    if (!offset) f.entries = null;
    draw();
    // The list it was opened from is gone: focus moves to where you are now, the last part of the path.
    if (moved) pathEl.querySelector('button:last-of-type')?.focus();
    try {
      const res = await fileApi(nodeId, 'list', path, { offset, limit: 200 });
      if (epoch !== f.epoch) return;
      f.entries = offset ? [...(f.entries || []), ...(res.entries || [])] : res.entries || [];
      f.total = res.total ?? f.entries.length;
      f.nextOffset = res.nextOffset ?? null;
      f.editorPath = res.editorPath || null;
      f.maxFileBytes = res.maxFileBytes || null;
      if (!path) {
        try { f.rootLabel = new URL(f.editorPath, location.origin).searchParams.get('folder')?.replace(/^\/home\/[^/]+/, '~') || null; } catch { f.rootLabel = null; }
      }
      f.error = null;
    } catch (e) {
      if (epoch === f.epoch) f.error = e.message;
    } finally {
      if (epoch === f.epoch) { f.busy = false; if (card.isConnected) draw(); }
    }
  }

  async function uploadFiles(files) {
    const folder = f.path;
    for (const file of files) {
      const key = `upload-${file.name}-${file.size}`;
      if (f.maxFileBytes && file.size > f.maxFileBytes) {
        toast(`${file.name} is too large for browser upload`, { kind: 'bad', timeout: 10000, sub: `Uploads here go up to ${fmt.bytes(f.maxFileBytes)}. Use VS Code (drag into its explorer) or scp for bigger files.` });
        continue;
      }
      toast(`Uploading ${file.name}`, { kind: 'busy', sub: `${fmt.bytes(file.size)} to ${nodeName(nodeId)}`, timeout: 0, id: key });
      try {
        const data = encodeBase64(new Uint8Array(await file.arrayBuffer()));
        await fileApi(nodeId, 'write', joinPath(folder, file.name), { data, revision: null });
        toast(`Uploaded ${file.name}`, { sub: `${nodeName(nodeId)} · ${folder || 'home'}`, id: key });
      } catch (e) {
        toast(`Couldn’t upload ${file.name}`, { kind: 'bad', sub: e.message, id: key, timeout: 10000 });
      }
    }
    if (f.node === nodeId && f.path === folder) load(folder);
  }

  async function newFolder() {
    const name = await promptText({ title: 'New folder', label: 'Folder name', confirm: 'Create' });
    if (!name) return;
    if (/[/\\]/.test(name)) return toast('Use a name without slashes.', { kind: 'bad' });
    try { await fileApi(nodeId, 'mkdir', joinPath(f.path, name)); load(); } catch (e) { toast(e.message, { kind: 'bad' }); }
  }

  async function revisionOf(entry) {
    return isFolder(entry) ? entry.revision : (await fileApi(nodeId, 'read', joinPath(f.path, entry.name))).revision;
  }

  async function rename(entry) {
    const name = await promptText({ title: `Rename ${isFolder(entry) ? 'folder' : 'file'}`, label: 'New name', value: entry.name, confirm: 'Rename' });
    if (!name || name === entry.name) return;
    if (/[/\\]/.test(name)) return toast('Use a name without slashes.', { kind: 'bad' });
    try {
      await fileApi(nodeId, 'rename', joinPath(f.path, entry.name), { destination: joinPath(f.path, name), revision: await revisionOf(entry) });
      load();
      refocus();
    } catch (e) { toast(e.message, { kind: 'bad' }); }
  }

  async function remove(entry) {
    const ok = await dialog({
      title: `Delete ${entry.name}?`, confirm: 'Delete', danger: true,
      description: isFolder(entry) ? 'Only empty folders can be deleted.' : `This permanently deletes the file from ${nodeName(nodeId)}.`,
    });
    if (!ok) return;
    try {
      await fileApi(nodeId, 'delete', joinPath(f.path, entry.name), { revision: await revisionOf(entry) });
      load();
      refocus();
    } catch (e) { toast(e.message, { kind: 'bad' }); }
  }

  // After a rename or delete the row (and its menu button) is rebuilt: keep focus nearby, on Refresh.
  const refocus = () => tools.querySelector('[aria-label="Refresh files"]')?.focus();

  async function download(entry) {
    try {
      const file = await fileApi(nodeId, 'read', joinPath(f.path, entry.name));
      saveBlob(entry.name, decodeBase64(file.data || ''));
    } catch (e) { toast(e.message, { kind: 'bad' }); }
  }

  async function preview(entry) {
    const path = joinPath(f.path, entry.name);
    const content = h('div', { class: 'empty' }, h('span', { class: 'spinner' }));
    const dl = h('button', { class: 'btn sm', type: 'button', onclick: () => download(entry) }, icon('download'), 'Download');
    drawer({ title: entry.name, body: content, wide: true, actions: [dl], foot: `${nodeName(nodeId)} · ${path}` });
    try {
      const file = await fileApi(nodeId, 'read', path);
      const bytes = decodeBase64(file.data || '');
      const ext = entry.name.split('.').pop().toLowerCase();
      if (IMAGE_TYPES[ext]) {
        content.replaceWith(h('img', { class: 'preview-img', alt: entry.name, src: `data:${IMAGE_TYPES[ext]};base64,${file.data}` }));
        return;
      }
      let text = null;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); if (text.includes('\0')) text = null; } catch {}
      if (text === null) set(content, icon('file'), h('strong', {}, 'No preview for this file type'), h('p', {}, `${fmt.bytes(bytes.length)} · download it to open locally.`));
      else content.replaceWith(h('pre', { class: 'preview-pre' }, text.length > 400000 ? `${text.slice(0, 400000)}\n\n… truncated for preview. Download for the full file.` : text));
    } catch (e) {
      set(content, icon('alert'), h('strong', {}, 'Couldn’t open this file'), h('p', {}, e.message));
    }
  }

  function draw() {
    const write = fileAccess() === 'write';
    const segments = f.path ? f.path.split('/') : [];
    redraw(pathEl,
      h('button', { type: 'button', title: f.rootLabel || null, onclick: () => load('') }, `${n0.name} · ${owner() ? f.rootLabel || 'home' : state.files.area === 'shared' ? 'shared' : 'my files'}`),
      ...segments.flatMap((seg, i) => [icon('chevronRight'), h('button', { type: 'button', onclick: () => load(segments.slice(0, i + 1).join('/')) }, seg)]));
    redraw(tools, 
      write ? h('button', { class: 'btn sm', type: 'button', 'aria-label': 'Upload', title: 'Upload', onclick: () => upload.click() }, icon('upload'), h('span', { class: 'hide-sm' }, 'Upload')) : null,
      write ? h('button', { class: 'btn sm', type: 'button', 'aria-label': 'New folder', title: 'New folder', onclick: newFolder }, icon('plus'), h('span', { class: 'hide-sm' }, 'New folder')) : null,
      owner() && isUp(node(nodeId)) ? h('a', { class: 'btn sm', href: f.editorPath || editorUrl(node(nodeId)), target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Open in VS Code', title: 'Open in VS Code' }, icon('code'), h('span', { class: 'hide-sm' }, 'Open in VS Code')) : null,
      h('button', { class: 'btn ghost sm icon-only', type: 'button', 'aria-label': 'Refresh files', title: 'Refresh', onclick: () => load() }, icon('refresh')));

    if (!isUp(node(nodeId))) { set(tools); set(body, empty('wifiOff', `${n0.name} is offline`, 'Its files are here again when it’s back.')); set(foot); return; }
    if (f.error) { set(body, h('div', { style: { padding: '14px' } }, failBanner('Couldn’t list this folder', f.error, () => load()))); set(foot); return; }
    if (!f.entries) { set(body, h('div', { class: 'empty' }, h('span', { class: 'spinner' }))); set(foot); return; }
    if (!f.entries.length) {
      set(body, empty('folder', 'This folder is empty', write ? 'Drop files here or use Upload.' : null));
    } else {
      set(body, h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', { class: 'num hide-sm' }, 'Size'), h('th', { class: 'hide-sm' }, 'Modified'), h('th', {}, h('span', { class: 'sr-only' }, 'Actions')))),
        h('tbody', {}, f.entries.map(entry => {
          const folder = isFolder(entry);
          const ext = entry.name.split('.').pop().toLowerCase();
          const openEntry = () => (folder ? load(joinPath(f.path, entry.name)) : preview(entry));
          return h('tr', { class: 'clickable', onclick: e => { if (!e.target.closest('button')) openEntry(); } },
            h('td', {}, h('div', { class: 'cell-main' }, icon(folder ? 'folder' : IMAGE_TYPES[ext] ? 'image' : 'file', `file-icon${folder ? ' folder' : ''}`),
              h('button', { class: 'link-btn', type: 'button', style: { border: 'none', background: 'none', padding: '0', 'text-align': 'left', 'font-weight': folder ? '600' : '500' }, onclick: openEntry }, entry.name))),
            h('td', { class: 'num hide-sm muted' }, folder ? '—' : fmt.bytes(entry.size)),
            h('td', { class: 'hide-sm muted' }, fmt.when(entry.modified ?? entry.modifiedAt ?? entry.mtime)),
            h('td', { class: 'num' }, menuButton([
              folder ? { label: 'Open', icon: 'folder', onSelect: openEntry } : { label: 'Preview', icon: 'eye', onSelect: () => preview(entry) },
              folder ? null : { label: 'Download', icon: 'download', onSelect: () => download(entry) },
              write ? 'sep' : null,
              write ? { label: 'Rename', icon: 'edit', onSelect: () => rename(entry) } : null,
              write ? { label: 'Delete', icon: 'trash', danger: true, onSelect: () => remove(entry) } : null,
            ], { label: `Actions for ${entry.name}` })));
        })))));
    }
    set(foot, 
      h('span', {}, `${f.entries.length}${f.total > f.entries.length ? ` of ${f.total}` : ''} items${write ? ` · drop files to upload${f.maxFileBytes ? ` (up to ${fmt.bytes(f.maxFileBytes)} each)` : ''}` : ''}`),
      f.nextOffset != null ? h('button', { class: 'btn sm', type: 'button', onclick: () => load(f.path, f.nextOffset) }, 'Load more') : null);
  }

  if (f.entries === null && !f.busy) load();
  else draw();
  return card;
}

/* ───────── linked Sparks ───────── */
// Linked pairs are worked out from the direct cables, not saved: two Sparks that are both online and directly linked can
// run one model together. A link counts once the automatic connection test passed full-size traffic over it, or, until
// the first test, when the two share a subnet on a cable. Splitting a model is limited by the least-free Spark.
function linkedPairs() {
  const f = state.fabric;
  if (!f.sparks) return [];
  const up = id => isUp(node(id)) && f.sparks.some(s => s.id === id && s.online);
  if (f.pairs?.length) return f.pairs.filter(p => p.fastLink === 'full' && up(p.a) && up(p.b)).map(p => ({ a: p.a, b: p.b, tested: true }));
  const nets = s => s.links.filter(l => l.up).flatMap(l => l.ipv4);
  const out = [], list = f.sparks.filter(s => up(s.id));
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    if (nets(list[i]).some(x => nets(list[j]).some(y => sameNet(x, y)))) out.push({ a: list[i].id, b: list[j].id, tested: false });
  }
  return out;
}
const ip4 = ip => ip.split('.').reduce((a, b) => (a << 8) + Number(b), 0) >>> 0;
function sameNet(x, y) {
  const [a, bits] = x.split('/'), [b] = y.split('/'), mask = Number(bits) ? (~0 << (32 - Number(bits))) >>> 0 : 0;
  return a !== b && (ip4(a) & mask) === (ip4(b) & mask);
}
// Roughly the largest model (weights) a set of Sparks could hold together right now.
function roomFor(ids) {
  const free = ids.map(id => node(id)?.memoryFreeGiB).filter(num);
  return free.length === ids.length ? Math.floor((Math.min(...free) * GB_PER_GIB * ids.length) / 1.15) : null;
}

// A small map of the Sparks and the direct cables that work between them.
function linkMap() {
  const ids = nodes().map(n => n.id), size = 112, r = 11;
  const spots = [[0.22, 0.22], [0.78, 0.22], [0.78, 0.78], [0.22, 0.78]];
  const at = id => spots[ids.indexOf(id) % spots.length].map(v => v * size);
  const map = svg('svg', { viewBox: `0 0 ${size} ${size}`, class: 'link-map', role: 'img' });
  const lines = [];
  for (const p of linkedPairs()) {
    const [x1, y1] = at(p.a), [x2, y2] = at(p.b);
    map.append(svg('line', { x1, y1, x2, y2, class: `link ${p.tested ? 'ok' : 'untested'}` }));
    lines.push(`${nodeName(p.a)}–${nodeName(p.b)}`);
  }
  for (const id of ids) {
    const [cx, cy] = at(id), t = svg('text', { x: cx, y: cy + 4 });
    t.textContent = String(id).replace(/^spark/, '');
    map.append(svg('circle', { cx, cy, r, class: `spark-dot ${isUp(node(id)) ? 'on' : 'off'}` }), t);
  }
  map.setAttribute('aria-label', lines.length ? `Direct cables that work: ${lines.join(', ')}` : 'No working direct cables');
  return map;
}

// One line per pair of linked Sparks: how big a model they could share, whether either is busy, and Start a model.
function pairRow(p) {
  const room = roomFor([p.a, p.b]), busy = [p.a, p.b].filter(id => workloads(node(id)).length);
  return h('div', { class: 'row' },
    h('div', { class: 'row-main' }, h('span', { class: 'row-icon ok' }, icon('link')),
      h('div', { class: 'row-text' }, h('div', { class: 'row-title' }, `${nodeName(p.a)} + ${nodeName(p.b)}`),
        h('div', { class: 'row-sub' }, [room ? `fits a model up to about ${room} GB` : null,
          busy.length === 2 ? 'both busy now' : busy.length ? `${nodeName(busy[0])} busy now` : 'both free',
          p.tested ? null : 'cable not tested yet'].filter(Boolean).join(' · ')))),
    // (never a start that takes in Sparkie's own Spark: nothing else runs there, and the service refuses it)
    canActOn(p.a, p.b) && p.tested && ![p.a, p.b].includes(state.main.data?.node) ? h('div', { class: 'row-side' },
      h('button', { class: 'btn sm', type: 'button', title: `Run one model across ${nodeName(p.a)} and ${nodeName(p.b)}`, 'aria-label': `Start a model across ${nodeName(p.a)} and ${nodeName(p.b)}`,
        onclick: e => openDeployPicker({ pair: [p.a, p.b], button: e.currentTarget }) }, icon('play'), 'Start a model')) : null);
}

function testedAgo() {
  const at = state.fabric.checkedAt;
  return at ? `tested ${fmt.ago(Date.parse(at))}` : 'not tested yet';
}

// Serving one model across Sparks runs over the direct QSFP cables between them. The service only reads link state
// and pings across the cables; it changes nothing on a Spark.
async function loadFabric(check = false) {
  const f = state.fabric;
  if (f.loading) return;
  f.loading = true;
  f.checking = check;
  runLive();
  try {
    const data = await capi(check ? 'fabric?check=1' : 'fabric');
    f.sparks = data.sparks;
    f.at = Date.now();
    // The service tests the connections on its own every 10 minutes; any answer carries the latest result.
    if (check || data.checkedAt) { f.pairs = data.pairs; f.checkedAt = data.checkedAt; }
    f.error = null;
    f.missing = false;
    f.outdated = false;
  } catch (e) {
    f.error = e.message;
    f.missing = Boolean(e.missing);
    f.outdated = e.status === 404;
    if (e.missing) { clearTimeout(f.retry); f.retry = setTimeout(() => loadFabric(), 6000); }
  } finally {
    f.loading = false;
    f.checking = false;
    runLive();
  }
}

function cableState(s) {
  if (!s.online) return ['Offline', 'bad', 'Checked again when it’s back.'];
  if (!s.links.length) return ['No direct-cable ports', 'warn', 'No ports for direct cables were found.'];
  const up = s.links.filter(l => l.up), addressed = up.filter(l => l.ipv4.length);
  if (!up.length) return ['No cable', '', 'Connect a direct (QSFP) cable to another Spark.'];
  if (!addressed.length) return ['Cable in, not set up', 'warn', 'The cabled ports need NVIDIA’s one-time network setup.'];
  return ['Ready', 'good', null];
}

// How a pair's last connection test went: label, tone, a plain hint, and the technical detail for a tooltip.
const PAIR = {
  full: ['Connected', 'good', 'Large transfers pass both ways.'],
  partial: ['Partly connected', 'warn', 'Some paths answer and some don’t.'],
  mtu: ['Size mismatch', 'warn', 'Small transfers pass but large ones don’t. The two ends are set up differently.', 'Set the same MTU on both ends.'],
  fail: ['Not answering', 'bad', 'They share a network on the cable but don’t answer. Check the cable and its setup.'],
  'no-shared-subnet': ['Not cabled together', '', 'No direct cable between them, or their ports are on different networks.'],
};

// A Spark's Checks: its direct cables, and how each link to another Spark tested. Read-only.
function cablePanel(id) {
  const body = h('div');
  const checkBtn = h('button', { class: 'btn sm', type: 'button', onclick: () => loadFabric(true) }, icon('refresh'), 'Check cables');
  const wrap = panel('Direct cables', body, { sub: 'For running one model across two Sparks. A read-only check; nothing changes.', actions: owner() ? [checkBtn] : [], tight: true });
  live(() => {
    const f = state.fabric;
    checkBtn.disabled = f.loading || Boolean(f.missing || f.outdated);
    if (f.missing || f.outdated) { redraw(body, serviceMissing('Cable checks', f.outdated)); return; }
    if (f.error && !f.sparks) { redraw(body, h('div', { class: 'panel-body' }, failBanner('Couldn’t read the cables', f.error, () => loadFabric()))); return; }
    if (!f.sparks) { redraw(body, h('div', { class: 'empty' }, h('span', { class: 'spinner' }), 'Reading the cables…')); return; }
    const s = f.sparks.find(x => x.id === id);
    if (!s) { redraw(body, h('p', { class: 'muted fabric-summary' }, 'No cable details for this Spark.')); return; }
    const [label, kind, hint] = cableState(s), up = s.links.filter(l => l.up);
    const speed = Math.max(0, ...up.map(l => l.speedGbps || 0));
    // Each other Spark it's tested against, except the ones with no cable to it.
    const pairs = (f.pairs || []).filter(p => (p.a === id || p.b === id) && p.fastLink !== 'no-shared-subnet');
    redraw(body,
      f.checking ? h('div', { class: 'fabric-summary' }, h('span', { class: 'spinner sm' }), 'Checking the cables…') : null,
      h('div', { class: 'rows fabric-pairs' },
        h('div', { class: 'row' },
          h('div', { class: 'row-main' }, h('span', { class: 'row-icon' }, icon('link')),
            h('div', { class: 'row-text' }, h('div', { class: 'row-title' }, s.online ? (up.length ? `Cable connected${speed ? ` · ${speed} Gb/s` : ''}` : 'No cable connected') : 'Offline'),
              hint ? h('div', { class: 'row-sub' }, hint) : null)),
          h('div', { class: 'row-side' }, pill(label, kind))),
        pairs.map(p => {
          const kindOfLink = p.fastLink === 'partial' && p.pings.some(x => x.result === 'small') ? 'mtu' : p.fastLink;
          const [text, tone, why, tip] = PAIR[kindOfLink] || PAIR.fail;
          return h('div', { class: 'row' },
            h('div', { class: 'row-main' }, h('span', { class: `row-icon ${tone === 'good' ? 'ok' : tone === 'bad' ? 'bad' : 'warn'}` }, icon('link')),
              h('div', { class: 'row-text' }, h('div', { class: 'row-title' }, `To ${nodeName(p.a === id ? p.b : p.a)}`), h('div', { class: 'row-sub', title: tip || null }, why))),
            h('div', { class: 'row-side' }, pill(text, tone)));
        })),
      h('p', { class: 'muted fabric-summary' }, `${cap(testedAgo())}. The service tests the cables every 10 minutes.`),
      s.online && up.length ? h('details', { class: 'fabric-details' }, h('summary', {}, 'Network details'),
        up.flatMap(l => (l.ipv4.length ? l.ipv4 : ['no address']).map(ip => h('div', { class: 'mono-line' }, `${l.name} · ${ip} · MTU ${l.mtu || '?'}`)))) : null);
  });
  if (!state.fabric.loading && (!state.fabric.sparks || Date.now() - (state.fabric.at || 0) > 60000)) loadFabric();
  return wrap;
}

/* ───────── access: people and agents ───────── */
// The owner: People (who's waiting, who's in, inviting someone) and Agents (keys and the switches for them).
// A member sees what they get and the address to use.
PAGES.access = function accessPage(view, r) {
  if (!owner()) { memberAccess(view); return; }
  const tab = r.a === 'agents' ? 'agents' : 'people';
  put(view,
    pageHead('Access', tab === 'people' ? 'Who can open Spark Console and what they can do.' : 'Your own AI agents, each with its own key.'),
    pageTabs('Access', [['#/access', 'People', 'users'], ['#/access/agents', 'Agents', 'key']], tab === 'people' ? '#/access' : '#/access/agents'),
    passkeyNudge());
  (tab === 'people' ? peopleTab : agentsTab)(view);
};

// Until the owner has a passkey, a quiet line about it (it lives in the account menu, next to the avatar).
function passkeyNudge() {
  const box = h('div');
  live(() => redraw(box, newDevicePasskey() && passkeysWork() ? h('div', { class: 'banner info' }, icon('key'),
    h('div', { class: 'banner-text' }, h('p', {}, 'Add a passkey on this device, so next time you sign in with Face ID or Touch ID. You can for 15 minutes after signing in here.')),
    // (adding one reloads the account, which ends this offer)
    h('button', { class: 'btn sm', type: 'button', onclick: addPasskey }, 'Add a passkey'))
    : state.boot?.passkeys === 0 && !state.memberPreview ? h('div', { class: 'banner info' }, icon('key'),
    h('div', { class: 'banner-text' }, h('p', {}, 'Set up a passkey so changes to who has access need your fingerprint or face, not just Tailscale.')),
    // Straight to setting it up (the drawer would only say the same thing again), unless this browser can't.
    h('button', { class: 'btn sm', type: 'button', onclick: passkeysWork() ? addPasskey : openPasskeys }, 'Set up a passkey')) : null));
  return box;
}

// Spark Console's address, with a Copy button.
function addressLines() {
  const url = consoleAddress();
  return [h('div', { class: 'address-line' },
    h('span', { class: 'muted' }, 'Spark Console'),
    h('div', { class: 'connect-line' }, h('code', {}, url),
      h('button', { class: 'btn ghost sm icon-only', type: 'button', 'aria-label': 'Copy Spark Console link', title: 'Copy', onclick: () => copy(url, 'Spark Console link copied') }, icon('copy'))))];
}

function memberAccess(view) {
  const v = state.boot.viewer || {}, p = perms(), name = myName(), portalHost = portalHostId();
  const describe = level => (level === 'write' ? 'Read & write' : level === 'read' ? 'Read only' : 'None');
  const kv = (k, val) => h('div', {}, h('dt', {}, k), h('dd', {}, val));
  put(view, pageHead('Access', 'What you can do here, and the address to use.'),
    h('div', { class: 'grid-2' },
      panel('You', h('div', { style: { display: 'grid', gap: '14px' } },
        h('div', { class: 'identity' }, h('span', { class: 'avatar' }, initials(name)),
          h('div', {}, h('strong', {}, name), h('div', { class: 'muted' }, v.login || ''))),
        h('dl', { class: 'kv' },
          kv('Role', pill('Member', 'info')),
          kv('Can use', p.nodeIds ? (p.nodeIds.map(nodeName).join(', ') || 'None yet') : 'Every Spark'),
          kv(ASSISTANT, p.chat ? 'On' : 'Off'),
          kv('My files', describe(p.files)),
          kv('Shared files', describe(p.sharedFiles)),
          p.concurrentChats ? kv('Parallel chats', p.concurrentChats) : null))),
      panel('Address', h('div', { style: { display: 'grid', gap: '12px' } }, addressLines(),
        h('p', { class: 'muted', style: { 'font-size': '13px' } }, `Opens for people on the owner’s Tailscale network${portalHost ? ` while ${nodeName(portalHost)} is on` : ''}.`)))));
}

function peopleTab(view) {
  // People who asked from Spark Console, first: approve with a starting point (fine-tune it under People), or decline.
  const waiting = h('div'), people = h('div'), invite = h('div');
  put(view, waiting, people, h('div', { style: { 'margin-top': '16px' } }, invite));
  live(() => {
    const list = state.access?.requests || [];
    if (!list.length) { redraw(waiting); return; }
    redraw(waiting, h('div', { style: { 'margin-bottom': '16px' } }, panel('Waiting for access', h('div', { class: 'rows' }, list.map(r => {
      const preset = h('select', { class: 'select sm', 'aria-label': `What ${r.login} can do` },
        [['look', 'Look around'], ['chat', 'Chat and files'], ['run', 'Start models too']].map(([v, t]) => h('option', { value: v }, t)));
      // One decision at a time: both buttons wait while either runs.
      const buttons = [];
      const decide = decision => async e => {
        for (const b of buttons) b.disabled = true;
        await busy(e.currentTarget, async () => {
          // An email typed on the public page: say what approving it means before it counts.
          if (decision === 'approve' && !r.verified && !(await dialog({
            title: `Let ${r.login} in?`, confirm: 'Approve',
            description: `This came from the public page, so the email isn’t checked yet. It only works once someone signs in to Tailscale as ${r.login}: approve it only if you know who that is.`,
          }))) return;
          await capi('access/requests', 'POST', { login: r.login, decision, preset: preset.value });
          toast(decision === 'decline' ? `Declined ${r.login}` : r.verified ? `${r.login} can open Spark Console now` : `Added ${r.login}`,
            decision === 'approve' && !r.verified ? { sub: 'Send them the invite (Copy invite) so they can reach it with Tailscale.', timeout: 9000 } : {});
          await loadAccess();
        });
        for (const b of buttons) b.disabled = false;
      };
      buttons.push(h('button', { class: `btn sm${list.length === 1 ? ' primary' : ''}`, type: 'button', 'aria-label': `Approve ${r.login}`, onclick: decide('approve') }, 'Approve'),
        h('button', { class: 'btn ghost sm', type: 'button', 'aria-label': `Decline ${r.login}`, onclick: decide('decline') }, 'Decline'));
      return h('div', { class: 'row' },
        h('div', { class: 'row-main' }, h('span', { class: 'avatar sm' }, initials(r.name || r.login)),
          // The login first, whole: a name can't push it out of sight.
          h('div', { class: 'row-text' }, h('div', { class: 'row-title', style: { 'white-space': 'normal', 'overflow-wrap': 'anywhere' } }, r.login),
            h('div', { class: 'row-sub', style: { 'white-space': 'normal' } },
              [r.name ? `says they’re ${r.name}` : null, r.verified ? 'signed in with Tailscale' : 'from the public page, email not checked yet', fmt.when(r.at), r.note ? `“${r.note}”` : null].filter(Boolean).join(' · ')))),
        h('div', { class: 'row-side' }, preset, buttons));
    })), { tight: true, sub: 'Approving adds them under People, where you can change it any time.' })));
  });

  // People: everyone besides the owner who can open Spark Console, and what they get.
  const level = { read: 'read only', write: 'read & write' };
  live(() => {
    const a = state.access;
    redraw(people, panel('People', !a ? h('div', { class: 'empty' }, h('span', { class: 'spinner' }), 'Loading…')
      : a.error ? h('div', { style: { padding: '10px' } }, failBanner('Couldn’t load People', a.error, loadAccess))
        : a.members.length ? h('div', { class: 'rows' }, a.members.map(u => h('div', { class: 'row' },
          h('div', { class: 'row-main' }, h('span', { class: 'avatar sm' }, initials(u.login)),
            h('div', { class: 'row-text' }, h('div', { class: 'row-title' }, u.login),
              h('div', { class: 'row-sub', style: { 'white-space': 'normal' } }, [
                `Uses ${u.permissions.nodeIds.map(nodeName).join(', ')}`, u.permissions.deploy ? 'starts and stops models there' : null, u.permissions.chat ? `chats with ${ASSISTANT}` : 'no chat',
                u.permissions.files !== 'none' ? `My files: ${level[u.permissions.files]}` : null,
                u.permissions.sharedFiles !== 'none' ? `Shared files: ${level[u.permissions.sharedFiles]}` : null,
              ].filter(Boolean).join(' · ')))),
          h('div', { class: 'row-side' },
            h('button', { class: 'btn ghost sm icon-only', type: 'button', 'aria-label': `Change access for ${u.login}`, title: 'Change access', onclick: () => personDialog(u) }, icon('edit')),
            h('button', { class: 'btn ghost sm icon-only', type: 'button', 'aria-label': `Remove ${u.login}`, title: 'Remove', onclick: () => removePerson(u) }, icon('trash'))))))
          : h('p', { class: 'muted', style: { padding: '12px 14px', margin: '0', 'font-size': '13px' } }, 'Only you so far.'),
    { tight: true, sub: 'Who else can open Spark Console.', actions: [h('button', { class: 'btn sm', type: 'button', id: 'add-person', onclick: () => personDialog(null) }, icon('plus'), 'Add someone')] }));
  });
  // Fresh on every visit (the nav's count may be a minute old).
  loadAccess();

  // Invite someone: one Tailscale share link (kept here), then a message to copy and send. The address and what
  // members get sit underneath.
  const portalHost = portalHostId();
  const yes = () => h('span', { class: 'cap-yes', title: 'Yes' }, icon('check'), h('span', { class: 'sr-only' }, 'Yes'));
  const no = () => h('span', { class: 'cap-no', title: 'No' }, h('span', { 'aria-hidden': 'true' }, '—'), h('span', { class: 'sr-only' }, 'No'));
  const capRow = (label, member) => h('tr', {}, h('td', {}, label), h('td', {}, member ? yes() : no()));
  const step = (title, ...body) => h('div', { class: 'step' }, h('div', {}, h('strong', {}, title), ...body));
  live(() => {
    const acc = state.access || {}, link = consoleAddress();
    const device = portalHost ? conn(portalHost)?.alias || nodeName(portalHost) : 'the Spark that runs Spark Console';
    const field = h('input', { class: 'input', type: 'url', placeholder: 'https://login.tailscale.com/…', value: acc.invite?.url || '', 'aria-label': 'Tailscale share link' });
    const save = h('button', { class: 'btn sm', type: 'button', onclick: e => busy(e.currentTarget, async () => {
      await capi('access/invite', 'PUT', { url: field.value.trim() });
      toast(field.value.trim() ? 'Share link saved' : 'Share link removed');
      await loadAccess();
    }) }, 'Save');
    const age = acc.invite?.at ? Math.floor((Date.now() - Date.parse(acc.invite.at)) / 86400000) : null;
    const message = () => [
      'You’re invited to Spark Console, where I run my NVIDIA DGX Sparks.',
      acc.invite?.url ? `1. Accept this Tailscale invite. Tailscale is free; sign in with Google, Apple, GitHub or Microsoft: ${acc.invite.url}`
        : '1. Install Tailscale (free) and sign in: https://tailscale.com/download',
      `2. With Tailscale on, open ${link} and press Request access. I’ll approve it.`,
    ].join('\n');
    redraw(invite, panel('Invite someone', [
      h('div', { class: 'steps' },
        step('Copy a share link from Tailscale',
          h('p', {}, `In Tailscale, open ${device} → Share → Copy share link. It works for 30 days.`),
          h('a', { class: 'btn sm', href: 'https://login.tailscale.com/admin/machines', target: '_blank', rel: 'noopener noreferrer', style: { 'margin-top': '8px' } }, icon('external'), 'Open Tailscale')),
        step('Paste it here', h('div', { class: 'invite-line' }, field, save),
          age != null && age >= 25 ? h('p', { class: 'form-error' }, `Saved ${plural(age, 'day')} ago. Tailscale share links stop working after 30, so make a new one.`) : null),
        step('Send the invite',
          h('p', {}, 'They open Spark Console and press Request access; you approve them above.'),
          h('button', { class: 'btn sm primary', type: 'button', style: { 'margin-top': '8px' }, onclick: () => copy(message(), 'Invite copied. Paste it into a message.') }, icon('copy'), 'Copy invite'))),
      h('div', { class: 'invite-extra' },
        addressLines(),
        h('details', { class: 'invite-fold' }, h('summary', {}, 'What members get'),
          h('div', { class: 'table-wrap' }, h('table', { class: 'data cap-table' },
            h('thead', {}, h('tr', {}, h('th', {}, h('span', { class: 'sr-only' }, 'What they can do')), h('th', {}, 'Members'))),
            h('tbody', {},
              capRow('See every Spark’s health and what runs on it', true),
              capRow(`Chat with ${ASSISTANT}`, true),
              capRow('My files and Shared files on each Spark', true),
              capRow('Start and stop models on their Sparks (if you allow it)', true),
              capRow(`${ASSISTANT}’s model, People, VS Code and SSH`, false),
              capRow('Use the Sparks not shared with them', false),
              capRow('Logs, workloads and checks', false)))),
          h('button', { class: 'btn sm', type: 'button', onclick: () => setMemberPreview(true) }, icon('eye'), 'Preview as a member'))),
    ], { cls: 'invite-panel', sub: `Works for people on your Tailscale network${portalHost ? `; keep ${nodeName(portalHost)} on` : ''}.` }));
  });
}

// Agents: your own AI agents (Claude Code, Cursor, the spark command) use the console's actions through the agent door,
// each with its own key, without opening this page. Reloaded on every visit so "last used" is current.
function agentsTab(view) {
  const agentsBox = h('div'), telegramBox = h('div'), backup = h('p', { class: 'muted backup-line' });
  put(view, agentsBox, telegramBox, backup);
  live(() => redraw(telegramBox, telegramPanel()));
  loadTelegram();
  // Spark Console copies its own state (people, keys, chats) to another Spark once a day.
  capi('health').then(x => {
    const b = x?.lastBackup;
    if (!b || !backup.isConnected) return;
    backup.textContent = b.ok ? `Spark Console’s settings were last backed up ${fmt.when(b.at)} to ${nodeName(b.to)}.`
      : `The last backup of Spark Console’s settings didn’t work (${fmt.when(b.at)}${b.error ? `: ${b.error}` : ''}). ${b.good ? `The last good one is from ${fmt.when(b.good.at)}, on ${nodeName(b.good.to)}.` : 'There is no good one yet.'} It tries again every hour.`;
  }).catch(() => {});
  live(() => {
    const a = state.agents, titleOf = name => a?.actions?.find(x => x.name === name)?.title || name;
    const used = k => (k.lastUsedAt ? `Last used ${fmt.ago(Date.parse(k.lastUsedAt))}${k.lastAction ? ` · ${titleOf(k.lastAction)}` : ''}` : `Added ${fmt.ago(Date.parse(k.createdAt))} · not used yet`);
    const canAct = k => (k.scopes || []).includes('fleet:act');
    // The owner's two switches for all agents (Sparkie's changes included).
    const s = a && !a.error ? a.settings : null;
    const switchFor = (key, label, hint) => h('label', { class: 'toggle', title: hint || null },
      h('input', { type: 'checkbox', role: 'switch', checked: Boolean(s[key]), onchange: e => agentSetting(key, e.target) }), label);
    const switches = s ? h('div', { class: 'agent-switches' },
      h('div', { class: 'agent-switch-row' },
        switchFor('halted', s.halted ? 'Paused (automatically or by you)' : 'Pause agents’ changes', 'Agents also pause on their own after 12 changes in an hour, or 3 failed operations in a row.'),
        switchFor('selfHeal', 'Restart crashed models automatically', 'Only Spark Console’s own models, at most twice an hour, and never after one ran out of memory.')),
      s.halted ? h('p', { class: 'agent-note' }, icon('alert'), `Agents and ${ASSISTANT} can look but not change anything until you turn this off.`) : null) : null;
    const list = !a ? h('div', { class: 'empty' }, h('span', { class: 'spinner' }), 'Loading…')
      : a.error ? failBanner('Couldn’t load the agents', a.error, loadAgents)
        : a.keys.length ? h('div', { class: 'rows' }, a.keys.map(k => h('div', { class: 'row agent-row' },
          h('div', { class: 'row-main' }, h('span', { class: 'avatar sm', 'aria-hidden': 'true' }, icon('key')),
            h('div', { class: 'row-text' }, h('div', { class: 'row-title' }, k.name),
              h('div', { class: 'row-sub' }, used(k)))),
          h('div', { class: 'row-side' },
            h('label', { class: 'toggle' }, h('input', { type: 'checkbox', role: 'switch', checked: canAct(k), 'aria-label': `${k.name} can start and stop models`,
              onchange: e => agentCanAct(k, e.target) }), 'Can start and stop models'),
            h('label', { class: 'toggle' }, h('input', { type: 'checkbox', role: 'switch', checked: k.internet !== false, 'aria-label': `${k.name}’s key works from anywhere`,
              onchange: e => agentFromAnywhere(k, e.target) }), 'Works from anywhere'),
            h('button', { class: 'btn ghost sm icon-only', type: 'button', 'aria-label': `Remove ${k.name}`, title: 'Remove', onclick: () => removeAgent(k) }, icon('trash'))))))
          : h('p', { class: 'muted', style: { padding: '12px 14px', margin: '0', 'font-size': '13px' } }, 'None yet. Connect Claude Code, Codex, Cursor or the ', h('code', {}, 'spark'), ' command to use the fleet without opening this page.');
    const actions = a?.actions || [], changes = actions.filter(x => x.kind === 'change'), looks = actions.filter(x => x.kind !== 'change');
    const actionList = xs => h('ul', { class: 'action-list' }, xs.map(x => h('li', {}, x.title, ' ', h('code', { class: 'muted' }, x.name))));
    redraw(agentsBox, panel('Agents', [switches, list,
      actions.length ? h('details', { class: 'fold agent-actions' }, h('summary', {}, `What agents can do (${actions.length})`),
        h('div', { class: 'fold-body' },
          h('p', { class: 'muted', style: { 'font-size': '13px', margin: '0' } }, 'You can also run any of these in a terminal, like ', h('code', { style: { 'white-space': 'nowrap' } }, 'spark fleet_status'), '.'),
          changes.length ? [h('h3', {}, 'Looking'), actionList(looks), h('h3', {}, 'Only with “Can start and stop models” on'), actionList(changes)] : actionList(actions))) : null],
    { tight: true, sub: 'Each can look, or also start and stop models if you allow it.',
      actions: [h('button', { class: 'btn sm', type: 'button', id: 'connect-agent', onclick: connectAgent }, icon('plus'), 'Connect an agent')] }));
  });
  loadAgents();
}

// Telegram (R32): talk to Sparkie from any phone or laptop without Tailscale. Connecting and each pairing code take the
// passkey; disconnecting never does. The token is never shown back.
// The pairing code comes only with the passkey-confirmed answer that made it (a plain read never returns it), so it's
// kept here and the panel checks every few seconds until the chat is paired or the code runs out.
let telegramPoll = null;
async function loadTelegram() {
  try {
    const v = await capi('telegram'), code = state.telegram?.code;
    state.telegram = v.connected && !v.paired && code && Date.parse(code.expiresAt) > Date.now() ? { ...v, code } : v;
  } catch (e) { state.telegram = { error: e.message }; }
  runLive();
}
async function telegramNeedsMe(box) {
  const on = box.checked;
  try { state.telegram = await capi('telegram/needs', 'PUT', { on }); } catch (e) { if (box.isConnected) box.checked = !on; failToast(e); }
  runLive();
}
function watchPairing() {
  if (telegramPoll || !state.telegram?.code) return;
  telegramPoll = setTimeout(async () => { telegramPoll = null; if (location.hash.startsWith('#/access')) { await loadTelegram(); watchPairing(); } }, 4000);
}
function telegramPanel() {
  const t = state.telegram;
  const sub = `Talk to ${ASSISTANT} from Telegram on any phone or laptop, without Tailscale. Only your own chat is answered.`;
  if (!t) return panel('Telegram', h('div', { class: 'empty' }, h('span', { class: 'spinner' }), 'Loading…'), { tight: true, sub });
  if (t.error) return panel('Telegram', failBanner('Couldn’t load Telegram', t.error, loadTelegram), { tight: true, sub });
  const note = (text, warn = false) => h('p', { class: warn ? 'agent-note' : 'muted', style: { 'font-size': '13px', margin: '0 0 10px' } }, warn ? icon('alert') : null, text);
  const act = (label, fn, opts = {}) => h('button', { class: `btn sm${opts.primary ? ' primary' : ''}${opts.danger ? ' danger' : ''}`, type: 'button', onclick: e => busy(e.currentTarget, fn) }, label);
  const body = h('div', { style: { padding: '12px 14px' } });
  if (!t.connected) {
    const token = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'Bot token from @BotFather', 'aria-label': 'Bot token', style: { width: '100%', 'max-width': '420px' } });
    put(body, note('In Telegram, message @BotFather: send /newbot and pick a name, then /setjoingroups and choose Disable. Paste the token it gives you here. Turn on Two-Step Verification in Telegram’s settings too.'),
      h('div', { style: { display: 'flex', gap: '8px', 'flex-wrap': 'wrap' } }, token,
        act('Connect', async () => { state.telegram = await capi('telegram', 'PUT', { token: token.value.trim() }); token.value = ''; runLive(); }, { primary: true })));
    return panel('Telegram', body, { tight: true, sub });
  }
  const problem = ['token-refused', 'in-use', 'unreachable', 'secrets-unreadable'].includes(t.state);
  if (problem) put(body, note(t.whatToDo, true));
  if (t.paired) {
    put(body, note(`Paired with ${t.name || 'your Telegram'} (@${t.bot})${t.pairedAt ? `, ${fmt.when(t.pairedAt)}` : ''}.${t.lastMessageAt ? ` Last message ${fmt.ago(Date.parse(t.lastMessageAt))}.` : ''} Going back a build, ${ASSISTANT}’s memory and saved workflows still wait for you here.`),
      // The needs-me line (H5): off until switched on here, with the passkey; off never needs it.
      h('label', { class: 'toggle', style: { 'margin-bottom': '10px' } }, h('input', { type: 'checkbox', role: 'switch', checked: Boolean(t.needsMe), onchange: e => telegramNeedsMe(e.target) }),
        'Tell me on Telegram when something new needs me (at most 3 a day)'));
  } else if (t.code) {
    watchPairing();
    put(body, note(`Open this on the device with your Telegram and press Start. It works once, until ${fmt.when(t.code.expiresAt)}.`),
      h('p', { style: { margin: '0 0 10px' } }, h('a', { href: t.code.link, target: '_blank', rel: 'noopener noreferrer' }, t.code.link)),
      typeof QR !== 'undefined' ? h('div', { class: 'qr' }, QR.svg(t.code.link, 'QR code to pair your Telegram chat')) : null);
  } else {
    put(body, note(`Connected to @${t.bot}. Pair your chat with a one-time code.`));
  }
  put(body, h('div', { style: { display: 'flex', gap: '8px', 'flex-wrap': 'wrap', 'margin-top': '6px' } },
    t.paired ? null : act(t.code ? 'Show a new code' : 'Show a pairing code', async () => { state.telegram = await capi('telegram/pair', 'POST', {}); runLive(); }, { primary: !t.code }),
    act('Disconnect', async () => {
      if (!await dialog({ title: 'Disconnect Telegram?', description: 'Spark Console forgets the bot’s token and your chat. You can connect again any time.', confirm: 'Disconnect', danger: true })) return;
      state.telegram = await capi('telegram', 'DELETE'); runLive();
    }, { danger: true })));
  return panel('Telegram', body, { tight: true, sub });
}

async function loadAgents() {
  try {
    const [list, acts] = await Promise.all([capi('agents'), capi('actions').catch(() => ({ actions: [] }))]);
    state.agents = { ...list, actions: acts.actions };
  } catch (e) { state.agents = { error: e.message, keys: [] }; }
  runLive();
}
// A switch shows its new state right away and goes back if the change didn't save.
async function agentSetting(key, box) {
  const on = box.checked, was = !on;
  const show = value => { if (state.agents?.settings) state.agents.settings = { ...state.agents.settings, [key]: value }; runLive(); };
  show(on);
  try {
    const { settings } = await capi('agents/settings', 'PUT', { [key]: on });
    if (state.agents && settings) { state.agents.settings = settings; runLive(); }
  } catch (e) {
    show(was);
    if (box.isConnected) box.checked = was;
    failToast(e);
  }
}
// Whether one agent's key also works from the internet without Tailscale, or only on the tailnet.
async function agentFromAnywhere(k, box) {
  const on = box.checked, was = k.internet;
  k.internet = on;
  runLive();
  try {
    Object.assign(k, await capi(`agents/${k.id}`, 'PUT', { internet: on }));
  } catch (e) {
    k.internet = was;
    if (box.isConnected) box.checked = !on;
    failToast(e);
  }
}
// Whether one agent may start, stop and restart models, or only look.
async function agentCanAct(k, box) {
  const on = box.checked, was = k.scopes;
  k.scopes = on ? [...new Set([...(k.scopes || []), 'fleet:act'])] : (k.scopes || []).filter(x => x !== 'fleet:act');
  runLive();
  try {
    Object.assign(k, await capi(`agents/${k.id}`, 'PUT', { act: on }));
  } catch (e) {
    k.scopes = was;
    if (box.isConnected) box.checked = !on;
    failToast(e);
  }
  runLive();
}
// Name it, get its key once, and copy the line for the tool it runs in. The key dialog only closes with Done.
async function connectAgent() {
  const name = h('input', { class: 'input', type: 'text', maxlength: '60', placeholder: 'Claude Code on my MacBook', autocomplete: 'off' });
  const act = h('input', { type: 'checkbox' });
  let made = null;
  // A new key can only look. Letting it start and stop models is a second change, right after (each asks for the
  // passkey, when there is one). If that one doesn't go through, the key still works and can only look.
  await dialog({
    title: 'Connect an agent', confirm: 'Create key',
    description: 'Name it after the tool and the computer it runs on, so you can tell your agents apart and remove one on its own.',
    body: [h('label', { class: 'field' }, 'Name', name),
      // Each change asks for the passkey (when there is one), so ticking this means a second confirm.
      h('label', { class: 'check-row' }, act, h('span', {}, 'Can start and stop models'),
        h('span', { class: 'muted' }, state.boot?.passkeys > 0 ? 'asks for your passkey a second time' : 'you can change this later'))],
    onConfirm: async () => {
      made ||= await capi('agents', 'POST', { name: name.value.trim() });
      if (act.checked) {
        try { Object.assign(made, await capi(`agents/${made.id}`, 'PUT', { act: true })); } catch (e) { made.actError = e.message; }
      }
      return made;
    },
  });
  if (!made) return;
  const canAct = (made.scopes || []).includes('fleet:act');
  const header = `Authorization: Bearer ${made.token}`;
  // Copy says so on the button itself: toasts sit behind an open dialog.
  const copyBtn = (text, label) => {
    const b = h('button', { class: 'btn ghost sm', type: 'button', onclick: async () => {
      if (!(await copy(text, `${cap(label.replace(/^Copy /, ''))} copied`))) return;
      b.replaceChildren(icon('check'), 'Copied');
      setTimeout(() => { if (b.isConnected) b.replaceChildren(icon('copy'), label); }, 2000);
    } }, icon('copy'), label);
    return b;
  };
  const block = (label, text, button) => h('div', { class: 'agent-setup' },
    h('div', { class: 'agent-setup-head' }, h('strong', {}, label), button || copyBtn(text, 'Copy')), h('pre', { class: 'config-block' }, text));
  const first = copyBtn(`claude mcp add --transport http --scope user sparks ${made.url} --header "${header}"`, 'Copy command');
  const mcpJson = JSON.stringify({ mcpServers: { sparks: { url: made.url, headers: { Authorization: `Bearer ${made.token}` } } } }, null, 2);
  const codexToml = `[mcp_servers.sparks]\nurl = "${made.url}"\nbearer_token_env_var = "SPARK_CONSOLE_KEY"`;
  await dialog({
    title: `Connect ${made.name}`, confirm: 'Done', cancel: null, wide: true, dismissable: false, focus: first,
    description: 'Copy what you need now. This key is shown only once. If you lose it, remove this agent and connect it again.',
    body: h('div', { style: { display: 'grid', gap: '14px' } },
      block('Claude Code: run this once in a terminal', `claude mcp add --transport http --scope user sparks ${made.url} --header "${header}"`, first),
      block('The spark command: run spark setup and paste this key when it asks', made.token, copyBtn(made.token, 'Copy key')),
      h('details', { class: 'agent-more' }, h('summary', {}, 'Codex, Cursor and other apps'),
        // Codex reads MCP servers from ~/.codex/config.toml; the key goes in an environment variable, not the file.
        block('Codex: add this to ~/.codex/config.toml', codexToml, copyBtn(codexToml, 'Copy Codex settings')),
        block('…and set SPARK_CONSOLE_KEY to the key where Codex runs (a password manager or keychain is safer than a shell profile)', `SPARK_CONSOLE_KEY=${made.token}`, copyBtn(made.token, 'Copy key')),
        block('Cursor and other apps: add this to the app’s mcp.json', mcpJson, copyBtn(mcpJson, 'Copy settings'))),
      made.actError ? h('div', { class: 'banner warn', style: { margin: '0' } }, icon('alert'), h('div', { class: 'banner-text' },
        h('p', {}, `It can only look for now: ${made.actError} Turn on “Can start and stop models” for it under Agents when you’re ready.`)))
        : h('p', { class: 'muted', style: { 'font-size': '13px', margin: '0' } }, canAct ? 'It can look, and start and stop models.' : 'It can only look until you turn on “Can start and stop models” for it.'),
      h('p', { class: 'muted', style: { 'font-size': '13px', margin: '0' } }, 'It works on your tailnet (Tailscale on, signed in as you), never from the Sparks themselves. To use it from anywhere without Tailscale, turn on “Works from anywhere” for it under Agents. Anyone who has the key can use it, so keep it out of shared files.')),
  });
  await loadAgents();
}
async function removeAgent(k) {
  const ok = await dialog({ title: `Remove ${k.name}?`, description: 'Its key stops working right away. Your other agents keep working.', confirm: 'Remove', danger: true });
  if (!ok) return;
  try { await capi(`agents/${k.id}`, 'DELETE'); toast(`Removed ${k.name}`); } catch (e) { failToast(e); }
  await loadAgents();
  document.getElementById('connect-agent')?.focus();
}

async function loadAccess() {
  try { state.access = await capi('access'); } catch (e) { state.access = { error: e.message, members: [], sparks: [] }; }
  runLive();
}
// Add someone, or change what they get. The same choices as the portal had; parallel chats stay as they were.
async function personDialog(u) {
  const sparks = state.access?.sparks || [], p = u?.permissions || { nodeIds: [], chat: true, files: 'write', sharedFiles: 'read', concurrentChats: 1 };
  const login = h('input', { class: 'input', type: 'email', placeholder: 'name@example.com', autocomplete: 'off', value: u?.login || '' });
  const picks = sparks.map(sp => ({ id: sp.id, box: h('input', { type: 'checkbox', checked: p.nodeIds.includes(sp.id) }), name: sp.name }));
  const chat = h('input', { type: 'checkbox', checked: p.chat });
  const deploy = h('input', { type: 'checkbox', checked: Boolean(p.deploy) });
  const choose =(label, value) => h('select', { class: 'select', 'aria-label': label },
    [['none', 'None'], ['read', 'Read only'], ['write', 'Read & write']].map(([v, t]) => h('option', { value: v, selected: v === value }, t)));
  const files = choose('My files', p.files), shared = choose('Shared files', p.sharedFiles);
  const ok = await dialog({
    title: u ? `Change ${u.login}` : 'Add someone', confirm: u ? 'Save' : 'Add',
    description: u ? null : 'They sign in with Tailscale, so there’s no password. Also share this machine with them in Tailscale.',
    body: h('div', { style: { display: 'grid', gap: '14px' } },
      u ? null : h('label', { class: 'field' }, 'Their Tailscale login', login),
      h('fieldset', { class: 'field' }, h('legend', {}, 'Their Sparks ', h('span', { class: 'hint' }, '(they see every Spark, but only use these)')),
        h('div', { style: { display: 'grid', gap: '6px' } }, picks.map(x => h('label', { class: 'check-row' }, x.box, h('span', {}, x.name))))),
      h('label', { class: 'check-row' }, deploy, h('span', {}, 'Can start and stop models on their Sparks')),
      h('label', { class: 'check-row' }, chat, h('span', {}, `Can chat with ${ASSISTANT}`)),
      h('div', { class: 'grid-2', style: { gap: '12px' } }, h('label', { class: 'field' }, 'My files (their own space)', files), h('label', { class: 'field' }, 'Shared files', shared))),
    onConfirm: async () => {
      const permissions = { nodeIds: picks.filter(x => x.box.checked).map(x => x.id), deploy: deploy.checked, chat: chat.checked, files: files.value, sharedFiles: shared.value, concurrentChats: p.concurrentChats || 1 };
      if (u) await capi(`access/${u.id}`, 'PUT', { permissions });
      else await capi('access', 'POST', { login: login.value.trim(), permissions });
      return true;
    },
  });
  if (!ok) return;
  toast(u ? `Saved ${u.login}` : `Added ${login.value.trim()}`);
  await loadAccess();
}
async function removePerson(u) {
  const ok = await dialog({ title: `Remove ${u.login}?`, description: 'They lose access right away. Their chats and files stay on the Sparks.', confirm: 'Remove', danger: true });
  if (!ok) return;
  try { await capi(`access/${u.id}`, 'DELETE'); toast(`Removed ${u.login}`); } catch (e) { failToast(e); }
  await loadAccess();
  document.getElementById('add-person')?.focus();
}

/* ───────── command palette ───────── */
function score(text, query) {
  const t = text.toLowerCase();
  let total = 0;
  for (const word of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    const i = t.indexOf(word);
    if (i >= 0) { total += 10 + (i === 0 || /[\s·:/-]/.test(t[i - 1]) ? 8 : 0) - Math.min(i, 30) * 0.05; continue; }
    let pos = -1, gaps = 0;
    for (const ch of word) {
      const j = t.indexOf(ch, pos + 1);
      if (j < 0) return -1;
      gaps += j - pos - 1;
      pos = j;
    }
    total += Math.max(0.5, 4 - gaps * 0.2);
  }
  return total;
}

function paletteCommands() {
  const cmds = [];
  const add = (group, label, ic, run, extra = {}) => cmds.push({ group, label, icon: ic, run, ...extra });
  add('Go to', 'Home', 'grid', () => go(''), { keywords: 'overview fleet dashboard' });
  if (canChat()) add('Go to', `Ask ${ASSISTANT} about your Sparks`, 'chat', () => { state.chat.conv = null; go('sparkie/new'); }, { keywords: 'new chat fleet conversation' });
  add('Go to', 'Models', 'sparkle', () => go('models'), { keywords: 'running inference endpoints' });
  add('Go to', 'Models on your Sparks', 'disk', () => go('models/library'), { keywords: 'library disk stored' });
  add('Go to', 'Find more models', 'search', () => go('models/find'), { keywords: 'recipes download catalog hugging face' });
  // Draft models only run next to their main model, so they aren't offered on their own.
  if (canRun()) for (const m of (state.lib.data?.library || []).filter(x => x.role !== 'draft')) add('Start', `Start ${modelTitle(m)}…`, 'play', () => startModel(m), { keywords: `model deploy run serve ${m.name}` });
  if (canFiles()) add('Go to', 'Files', 'folder', () => go('files'), { keywords: 'upload download browse' });
  add('Go to', 'Access', 'users', () => go('access'), { keywords: 'sharing share invite people permissions' });
  if (owner()) add('Go to', 'Agents', 'key', () => go('access/agents'), { keywords: 'keys mcp claude cursor pause auto-restart' });
  add('Go to', 'Activity', 'activity', openActivity, { keywords: 'jobs operations history' });

  for (const n of nodes()) {
    const up = isUp(n), sub = COND[condition(n)][0];
    add('Sparks', n.name, 'chip', () => go(`spark/${n.id}`), { sub, keywords: `${hardware(n)} ${conn(n.id)?.alias || ''} details` });
    if (owner() && up) {
      add('Open', `VS Code on ${n.name}`, 'code', () => window.open(editorUrl(n), '_blank', 'noopener'), { keywords: 'editor terminal browser ide' });
      if (conn(n.id)) {
        add('Open', `VS Code desktop on ${n.name}`, 'monitor', () => { location.href = desktopUrl(n.id, 'vscode'); }, { keywords: 'remote ssh ide' });
        add('Open', `Cursor on ${n.name}`, 'monitor', () => { location.href = desktopUrl(n.id, 'cursor'); }, { keywords: 'remote ssh ide' });
        add('Open', `Copy SSH command for ${n.name}`, 'terminal', () => copy(sshCommand(n.id), `Copied: ${sshCommand(n.id)}`), { sub: sshCommand(n.id), keywords: 'terminal shell' });
      }
    }
    if (canFiles() && up) add('Open', `Files on ${n.name}`, 'folder', () => go(`files/${n.id}`), { keywords: 'browse upload download' });
    if (canSparkChat(n)) add('Open', `Ask ${ASSISTANT} about ${n.name}`, 'chat', () => { state.chat.conv = null; go(`sparkie/new?spark=${n.id}`); }, { keywords: 'chat assistant' });
    if (owner()) {
      add('Inspect', `Logs on ${n.name}`, 'logs', () => go(`spark/${n.id}/logs`), { keywords: 'editor console sparkie output' });
      add('Inspect', `Workloads on ${n.name}`, 'box', () => go(`spark/${n.id}/workloads`), { keywords: 'containers processes docker gpu' });
      add('Inspect', `Run checks on ${n.name}`, 'clipboard', () => go(`spark/${n.id}/diagnostics?run=1`), { keywords: 'check health troubleshoot diagnostics cables' });
      if (up) add('Actions', `Restart VS Code on ${n.name}`, 'refresh', () => nodeAction(n, 'editor-restart'), { keywords: 'vscode code server editor' });
    }
  }
  if (canChat()) {
    for (const conv of [...(state.consoleChats || [])].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 8)) {
      add('Recent chats', chatTitle(conv), 'chat', () => go(`sparkie/${conv.id}`), { sub: fmt.when(conv.updatedAt) });
    }
  }
  add('Preferences', `Theme: switch to ${THEME_NEXT[currentTheme()]}`, THEME_ICON[THEME_NEXT[currentTheme()]], () => setTheme(THEME_NEXT[currentTheme()]), { keywords: 'dark light appearance' });
  add('Preferences', 'Refresh status now', 'refresh', () => loadStatus(true), { keywords: 'reload update' });
  if (owner() && typeof state.boot?.passkeys === 'number') add('Preferences', 'Your passkey', 'key', openPasskeys, { keywords: 'security fingerprint face touch id' });
  add('Preferences', 'Your devices', 'monitor', openDevices, { keywords: 'phone qr ssh config laptop' });
  if (realOwner()) add('Preferences', state.memberPreview ? 'Exit member preview' : 'Preview as a member', 'eye', () => setMemberPreview(!state.memberPreview), { keywords: 'share guest' });
  return cmds;
}

function togglePalette() {
  if ($('.palette-backdrop')) closePalette();
  else openPalette();
}
function closePalette() {
  const el = $('.palette-backdrop');
  if (!el) return;
  el.remove();
  el.returnFocus?.focus?.();
}

function openPalette() {
  // Not over a dialog: the dialog would keep the keyboard and the palette couldn't be used.
  if ($('.palette-backdrop') || document.querySelector('dialog[open]')) return;
  closeMenus();
  const all = paletteCommands();
  const input = h('input', { type: 'text', placeholder: 'Say what you want, or search…', 'aria-label': 'Ask or do anything', autocomplete: 'off', spellcheck: 'false', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'palette-list' });
  const listEl = h('div', { class: 'palette-list', id: 'palette-list', role: 'listbox' });
  // tabindex -1: a click on its blank parts keeps focus inside it, so Esc still closes it.
  const backdrop = h('div', { class: 'palette-backdrop' },
    h('div', { class: 'palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Command palette', tabindex: '-1' },
      h('div', { class: 'palette-input' }, icon('search'), input, h('kbd', {}, 'esc')),
      listEl,
      h('div', { class: 'palette-foot' }, h('span', {}, h('kbd', {}, '↑'), h('kbd', {}, '↓'), 'navigate'), h('span', {}, h('kbd', {}, '↵'), 'run'), h('span', {}, h('kbd', {}, 'esc'), 'close'))));
  backdrop.returnFocus = document.activeElement;
  let results = [], active = 0;

  function compute() {
    const q = input.value.trim();
    // Before typing: where to go, the Sparks and recent chats. Everything else turns up as you type.
    const order = ['Go to', 'Sparks', 'Recent chats'];
    if (!q) results = all.filter(c => order.includes(c.group)).sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group)).slice(0, 20);
    else {
      results = all.map(c => ({ c, s: score(`${c.label} ${c.sub || ''} ${c.keywords || ''} ${c.group}`, q) }))
        .filter(x => x.s >= 0).sort((a, b) => b.s - a.s).slice(0, 30).map(x => x.c);
      if (canChat() && q.length > 2) {
        const ask = { group: ASSISTANT, label: `Ask ${ASSISTANT}: “${q}”`, icon: 'sparkle', run: () => { state.chat.conv = null; state.chat.pendingPrompt = q; go('sparkie/new'); } };
        if (results.length && score(results[0].label, q) >= 10) results.push(ask);
        else results.unshift(ask);
      }
    }
    active = 0;
    draw();
  }

  function draw() {
    set(listEl);
    if (!results.length) { put(listEl, h('div', { class: 'empty' }, 'No matches')); return; }
    let group = null;
    results.forEach((c, i) => {
      if (c.group !== group) { group = c.group; put(listEl, h('div', { class: 'palette-group' }, group)); }
      put(listEl, h('button', {
        class: 'palette-item', type: 'button', role: 'option', id: `pi-${i}`, 'aria-selected': String(i === active), tabindex: '-1',
        onmousemove: () => { if (active !== i) { active = i; mark(); } },
        onclick: () => runAt(i),
      }, icon(c.icon), h('span', { class: 'pi-text' }, c.label, c.sub ? h('span', { class: 'pi-sub' }, c.sub) : null), i === active ? h('span', { class: 'hint' }, '↵') : null));
    });
    input.setAttribute('aria-activedescendant', `pi-${active}`);
  }

  function mark() {
    listEl.querySelectorAll('.palette-item').forEach((el, i) => {
      el.setAttribute('aria-selected', String(i === active));
      el.querySelector('.hint')?.remove();
      if (i === active) { el.append(h('span', { class: 'hint' }, '↵')); el.scrollIntoView({ block: 'nearest' }); }
    });
    input.setAttribute('aria-activedescendant', `pi-${active}`);
  }

  function runAt(i) {
    const c = results[i];
    if (!c) return;
    closePalette();
    c.run();
  }

  input.addEventListener('input', compute);
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(results.length - 1, active + 1); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); mark(); }
    else if (e.key === 'Enter') { e.preventDefault(); runAt(active); }
    // The arrows move through the list; Tab would only leave it.
    else if (e.key === 'Tab') e.preventDefault();
  });
  // Esc closes it from anywhere inside, and goes no further (a drawer under it stays open).
  backdrop.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePalette(); } });
  backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) closePalette(); });
  document.body.append(backdrop);
  compute();
  input.focus();
}

/* ───────── outside: the public page, and asking to be let in ───────── */
// What anyone can see without signing in, from the internet too: the fleet's hardware and live load. Nothing about
// what runs on it or who uses it. Anyone can ask to be let in; the owner approves on Access.
function outsidePage(who) {
  const app = $('#app');
  app.className = 'outside';
  document.title = 'Spark Console';
  const stats = h('div', { class: 'card stats' }), cards = h('div', { class: 'fleet' }), clusters = h('div');
  const status = h('p', { class: 'muted outside-status' }, 'Checking the Sparks…');
  const askBtn = h('button', { class: 'btn sm', type: 'button', onclick: () => openAsk() }, icon('key'), 'Request access');
  set(app,
    h('header', { class: 'topbar outside-bar' },
      h('span', { class: 'brand' },
        h('img', { class: 'logo-on-dark', src: 'nvidia-logo-white.svg', alt: 'NVIDIA', width: '98', height: '18' }),
        h('img', { class: 'logo-on-light', src: 'nvidia-logo-black.svg', alt: 'NVIDIA', width: '98', height: '18' }),
        h('span', { class: 'brand-name' }, 'Spark Console')),
      h('div', { class: 'topbar-spacer' }),
      h('div', { class: 'outside-actions' }, askBtn,
        h('button', { class: 'btn primary sm', type: 'button', onclick: () => openSignIn() }, 'Sign in'))),
    h('main', { class: 'view', id: 'view', tabindex: '-1' },
      // What this is, in one line. The page has no owner's name to show, so it stays general.
      h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'DGX Spark fleet'),
        h('div', { class: 'page-sub' }, 'A private fleet of NVIDIA DGX Sparks. Members sign in with Tailscale.'), status)),
      h('div', { class: 'stack' },
        // Someone already on Tailscale who isn't on the list yet came for the console: say so, once, at the top.
        who.login && !who.asked ? h('div', { class: 'banner info', style: { margin: '0' } }, icon('key'),
          h('div', { class: 'banner-text' }, h('p', {}, `You’re signed in to Tailscale as ${who.login}, but you’re not on Spark Console’s list yet. Use Request access at the top.`))) : null,
        stats, cards, clusters)),
    h('div', { class: 'toasts', id: 'toasts', 'aria-live': 'polite' }));

  const stat = (label, ic) => {
    const value = h('span'), unit = h('small'), foot = h('div', { class: 'stat-foot' });
    put(stats, h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, icon(ic), label), h('div', { class: 'stat-value' }, value, unit), foot));
    return { value, unit, foot };
  };
  const sOnline = stat('Sparks online', 'server'), sMem = stat('Memory', 'layers'), sGpu = stat('GPU use', 'chip'), sPower = stat('GPU power', 'zap');
  const metric = (label, value) => h('div', { class: 'public-metric' }, h('span', {}, label), h('strong', {}, value));
  const card = x => h('article', { class: 'card public-card' },
    h('div', { class: 'sc-head' },
      h('div', { class: 'sc-title' }, h('span', { class: 'sc-chip' }, icon('chip')),
        h('div', { style: { 'min-width': '0' } }, h('h3', {}, x.name), h('div', { class: 'sc-sub' }, HARDWARE[x.id] || 'DGX Spark'))),
      pill(x.online ? 'Online' : 'Offline', x.online ? 'good' : 'bad')),
    x.online ? h('div', { class: 'public-metrics' },
      metric('GPU', fmt.pct(x.gpuUtilization)),
      metric('Memory', num(x.memoryTotalGiB) && num(x.memoryFreeGiB) ? `${fmt.gib(x.memoryTotalGiB - x.memoryFreeGiB)} / ${fmt.gib(x.memoryTotalGiB)} GB` : '—'),
      metric('Temperature', fmt.temp(x.temperature)),
      metric('Power', fmt.watts(x.gpuPowerWatts))) : h('p', { class: 'muted', style: { 'font-size': '13px' } }, 'Offline right now.'));
  const draw = d => {
    const up = d.sparks.filter(x => x.online), total = sum(up, 'memoryTotalGiB'), used = total - sum(up, 'memoryFreeGiB');
    const gpus = up.map(x => x.gpuUtilization).filter(num);
    sOnline.value.textContent = up.length; sOnline.unit.textContent = `/ ${d.sparks.length}`;
    sOnline.foot.textContent = up.length === d.sparks.length ? 'All online' : `${d.sparks.length - up.length} offline`;
    sMem.value.textContent = total ? fmt.gib(used) : '—'; sMem.unit.textContent = total ? `/ ${fmt.gib(total)} GB` : '';
    sMem.foot.textContent = total ? `${Math.round((used / total) * 100)}% in use` : '';
    sGpu.value.textContent = gpus.length ? Math.round(gpus.reduce((a, b) => a + b, 0) / gpus.length) : '—'; sGpu.unit.textContent = gpus.length ? '%' : '';
    sGpu.foot.textContent = 'Average';
    sPower.value.textContent = up.length ? sum(up, 'gpuPowerWatts').toFixed(1) : '—'; sPower.unit.textContent = up.length ? 'W' : '';
    sPower.foot.textContent = 'GPU only';
    status.textContent = `${plural(d.sparks.length, 'Spark')}, live${d.updatedAt ? ` · updated ${fmt.time(d.updatedAt)}` : ''}`;
    redraw(cards, ...d.sparks.map(card));
    redraw(clusters, d.links.length ? publicClusters(d) : null);
  };
  const load = async () => {
    try { draw(await capi('public/fleet')); } catch (e) { status.textContent = e.status === 429 ? 'Refreshing too often. Slowing down.' : `Couldn’t load the fleet: ${e.message}`; }
  };
  load();
  setInterval(() => { if (!document.hidden) load(); }, 10000);

  // Asking to be let in, from the button at the top. On the tailnet, Tailscale already says who they are; from the
  // internet, they give the email they sign in to Tailscale with (the owner sees it as not checked yet).
  const sent = () => { set(askBtn, icon('check'), 'Request sent'); askBtn.disabled = true; };
  async function openAsk() {
    const email = who.login ? null : h('input', { class: 'input', type: 'email', autocomplete: 'email', placeholder: 'you@example.com', maxlength: '200' });
    const name = who.login ? null : h('input', { class: 'input', type: 'text', autocomplete: 'name', maxlength: '80' });
    const note = h('input', { class: 'input', type: 'text', maxlength: '200', placeholder: 'Who you are, or what you’d like to do' });
    const ok = await dialog({
      title: 'Request access', confirm: 'Send request',
      description: who.login ? `You’re signed in to Tailscale as ${who.login}. The owner sees your request and lets you in.`
        : 'Spark Console signs people in with Tailscale, so there are no passwords. Ask the owner to let you in.',
      body: h('div', { style: { display: 'grid', gap: '14px' } },
        email ? h('label', { class: 'field' }, 'The email you use with Tailscale (or will)', email) : null,
        name ? h('label', { class: 'field' }, 'Your name', name) : null,
        h('label', { class: 'field' }, 'Note for the owner (optional)', note)),
      onConfirm: async () => {
        await capi(who.login ? 'access/ask' : 'public/ask', 'POST', who.login ? { note: note.value } : { email: email.value, name: name.value, note: note.value });
        return true;
      },
    });
    if (!ok) return;
    if (who.login) who.asked = true;
    sent();
    toast('Request sent', { sub: who.login ? 'Once the owner approves it, reload this page.' : 'If the owner approves it, they’ll send you a Tailscale invite.', timeout: 9000 });
  }
  if (who.asked) sent();

  // The owner, from the internet (4.10): their passkey, or a code they let in from a signed-in device. Tailscale still works.
  // With no passkey on file the Tailscale steps show, with the recovery code beside them when whoami says one would work
  // (who.recovery, F18).
  async function openSignIn() {
    if (!who.signin) return openTailscaleSignIn();
    let other = null, dlg = null;
    const pick = what => { if (dlg?.querySelector('[aria-busy]')) return; other = what; dlg?.close(); };
    const ok = await dialog({
      title: 'Sign in', confirm: 'Use passkey',
      description: 'Owner: use your passkey (Face ID, Touch ID or screen lock), and this device stays signed in. Members sign in with Tailscale.',
      body: h('div', { class: 'signin-other' },
        h('button', { class: 'btn sm', type: 'button', onclick: () => pick('code') }, 'No passkey here? Get a code'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => pick('recovery') }, 'Use a recovery code'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => pick('tailscale') }, 'Sign in with Tailscale')),
      setup: ({ dlg: d }) => { dlg = d; },
      onConfirm: () => signInWithPasskey(),
    });
    if (ok) { location.reload(); return; }
    if (other === 'code') { try { await signInWithCode(); } catch (e) { toast(e.message, { kind: 'bad' }); } }
    if (other === 'recovery') { try { await signInWithRecovery(); } catch (e) { toast(e.message, { kind: 'bad' }); } }
    if (other === 'tailscale') openTailscaleSignIn();
  }
  // Signing in with Tailscale. While this is open the page checks every few seconds, and opens the portal as soon as
  // this device is on the tailnet as someone the owner approved.
  async function openTailscaleSignIn() {
    let dlg = null, useRecovery = false;
    const note = h('div', { 'aria-live': 'polite' });
    const show = () => redraw(note, !who.login && who.via === 'internet' && who.signin
      ? h('div', { class: 'banner info signin-note' }, icon('alert'),
        h('div', { class: 'banner-text' }, h('p', {}, 'This browser reaches Spark Console over the internet, not through Tailscale, even with Tailscale on: it looks addresses up its own way (iCloud Private Relay in Safari, or secure DNS in Chrome). Sign in with your passkey or a code instead, or turn those off and reload.')),
        h('button', { class: 'btn sm', type: 'button', onclick: () => { dlg?.close(); openSignIn(); } }, 'Passkey or code'))
      : who.login && who.access === 'none'
      ? h('div', { class: 'banner info signin-note' }, icon('key'),
        h('div', { class: 'banner-text' }, h('p', {}, who.asked
          ? `You’re on Tailscale as ${who.login}. Your request is waiting for the owner; this page opens Spark Console once they approve it.`
          : `You’re on Tailscale as ${who.login}, but the owner hasn’t approved this account yet.`)),
        who.asked ? null : h('button', { class: 'btn sm', type: 'button', onclick: () => { dlg?.close(); openAsk(); } }, 'Request access'))
      : h('p', { class: 'signin-wait' }, h('span', { class: 'spinner sm' }), 'Waiting for Tailscale on this device…'));
    const check = async () => {
      try {
        const res = await fetch(`${CONSOLE_API}whoami`, { cache: 'no-store', headers: { Accept: 'application/json' } });
        const w = res.ok ? await res.json() : null;
        if (!w) return;
        if (w.access === 'owner' || w.access === 'member') { location.reload(); return; }
        Object.assign(who, w);
        show();
      } catch {}
    };
    show();
    const timer = setInterval(check, 4000);
    const again = await dialog({
      title: 'Sign in', confirm: 'Check again', cancel: 'Close',
      description: 'Spark Console signs you in with Tailscale, so there’s no password.',
      body: h('div', { class: 'signin' },
        h('ol', { class: 'signin-steps' },
          h('li', {}, 'Install Tailscale on this device and sign in with the account the owner approved. ',
            h('a', { class: 'link', href: 'https://tailscale.com/download', target: '_blank', rel: 'noopener noreferrer' }, 'Get Tailscale')),
          h('li', {}, 'Come back here: this page opens Spark Console by itself.')),
        h('p', { class: 'muted signin-fine' }, 'Tailscale addresses don’t open on NVIDIA’s network; use another network.'),
        note,
        !who.signin && who.recovery ? h('div', { class: 'signin-other' },
          h('button', { class: 'btn sm', type: 'button', onclick: () => { useRecovery = true; dlg?.close(); } }, 'Use a recovery code')) : null),
      setup: ({ dlg: d }) => { dlg = d; },
    });
    clearInterval(timer);
    if (useRecovery) { try { await signInWithRecovery(); } catch (e) { toast(e.message, { kind: 'bad' }); } return; }
    if (again) location.reload();
  }
}

// The public page's linked Sparks: the Sparks in a square, a line for each working direct cable, and per linked pair how
// big a model the two could run together (from the memory free on both right now).
function publicClusters(d) {
  const size = 150, r = 14, spots = [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]];
  const at = id => spots[d.sparks.findIndex(x => x.id === id) % spots.length].map(v => v * size);
  const name = id => d.sparks.find(x => x.id === id)?.name || id;
  const map = svg('svg', { viewBox: `0 0 ${size} ${size}`, class: 'link-map public-map', role: 'img',
    'aria-label': `Direct cables: ${d.links.map(([a, b]) => `${name(a)} to ${name(b)}`).join(', ')}` });
  for (const [a, b] of d.links) { const [x1, y1] = at(a), [x2, y2] = at(b); map.append(svg('line', { x1, y1, x2, y2, class: 'link ok' })); }
  for (const x of d.sparks) {
    const [cx, cy] = at(x.id), t = svg('text', { x: cx, y: cy + 4.5 });
    t.textContent = String(x.id).replace(/^spark/, '');
    map.append(svg('circle', { cx, cy, r, class: `spark-dot ${x.online ? 'on' : 'off'}` }), t);
  }
  const free = id => d.sparks.find(x => x.id === id)?.memoryFreeGiB;
  const pair = ([a, b]) => {
    const room = num(free(a)) && num(free(b)) ? Math.floor((Math.min(free(a), free(b)) * GB_PER_GIB * 2) / 1.15) : null;
    return h('div', { class: 'row' }, h('div', { class: 'row-main' }, h('span', { class: 'row-icon ok' }, icon('link')),
      h('div', { class: 'row-text' }, h('div', { class: 'row-title' }, `${name(a)} + ${name(b)}`),
        h('div', { class: 'row-sub' }, room ? `Can run a model up to about ${room} GB together right now` : 'Linked by a direct cable'))));
  };
  return panel('Linked Sparks', h('div', { class: 'cluster-strip' }, map, h('div', { class: 'rows' }, d.links.map(pair))),
    { tight: true, sub: 'Sparks linked by a direct cable can run one model together' });
}

/* ───────── boot ───────── */
function fatal(e) {
  const app = $('#app');
  app.className = 'booting';
  const denied = e.status === 401 || e.status === 403;
  set(app, h('div', { class: 'boot', style: { 'max-width': '420px', 'text-align': 'center', padding: '24px' } },
    h('img', { class: 'logo-on-dark', src: 'nvidia-logo-white.svg', alt: 'NVIDIA', width: '120', height: '22' }),
    h('img', { class: 'logo-on-light', src: 'nvidia-logo-black.svg', alt: 'NVIDIA', width: '120', height: '22' }),
    icon(denied ? 'lock' : 'wifiOff', 'xl'),
    h('h1', { style: { 'font-size': '20px', color: 'var(--text)' } }, denied ? 'You don’t have access to Spark Console' : 'Can’t reach Spark Console'),
    h('p', {}, denied ? 'Ask the owner to share it with your Tailscale account.' : e.message),
    h('button', { class: 'btn primary', type: 'button', onclick: () => location.reload() }, icon('refresh'), 'Try again')));
}

/* ───────── updates ───────── */
// tailscale serve sends no cache headers, so after an update a browser can keep running the old files for hours.
// When version.json names a different build than this page, refresh the cached files and reload, once per build;
// if the page is still old after that (or it's been open a while), offer a reload instead.
const UPDATE_TRIED = 'spark-console:update-tried';
let lastUpdateCheck = 0;

async function reloadFresh() {
  await Promise.allSettled(['./', 'app.js', 'styles.css', 'theme.js', 'qr.js'].map(u => fetch(u, { cache: 'reload' })));
  location.reload();
}

// Resolves true when the page should offer a reload.
async function checkForUpdate({ atStart = false } = {}) {
  if (BUILD === 'dev' || Date.now() - lastUpdateCheck < 60000) return false;
  lastUpdateCheck = Date.now();
  let latest = null;
  try { latest = (await (await fetch('version.json', { cache: 'no-store' })).json()).build; } catch {}
  if (!latest || latest === BUILD) return false;
  let tried = null;
  try { tried = sessionStorage.getItem(UPDATE_TRIED); } catch {}
  if (atStart && tried !== latest) {
    try { sessionStorage.setItem(UPDATE_TRIED, latest); } catch {}
    await reloadFresh();
    return false;
  }
  return true;
}

const offerUpdate = () => toast('Spark Console has been updated', {
  sub: h('button', { class: 'btn sm', type: 'button', style: { 'margin-top': '6px' }, onclick: reloadFresh }, icon('refresh'), 'Reload'),
  timeout: 0, id: 'update',
});

async function start() {
  // tailscale serve can't send frame-ancestors, so inside another page Spark Console shows nothing (clickjacking).
  if (window.top !== window.self) {
    document.body.textContent = 'Spark Console can’t be shown inside another page. Open it directly.';
    return;
  }
  const update = checkForUpdate({ atStart: true });
  try {
    state.boot = await loadBoot();
  } catch (e) {
    if (e.status === 401) {
      const who = await capi('whoami').catch(() => null);
      if (who) { outsidePage(who); return; }
    }
    fatal(e);
    return;
  }
  loadHistory();
  shell();
  syncNav();
  syncThemeColor();
  update.then(offer => offer && offerUpdate());
  window.addEventListener('hashchange', () => {
    render();
    window.scrollTo(0, 0);
    // The new page starts at the top for the keyboard too, unless it already put focus somewhere (the chat box).
    const view = $('#view');
    if (view && !view.contains(document.activeElement)) view.focus({ preventScroll: true });
  });
  window.addEventListener('resize', closeMenus);
  window.addEventListener('scroll', closeMenus, { passive: true });
  document.addEventListener('pointerdown', e => {
    if (openMenuEl && !openMenuEl.contains(e.target) && !openMenuEl.anchor?.contains(e.target)) closeMenus();
  });
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); togglePalette(); return; }
    const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
    if (e.key === '/' && !typing && !document.querySelector('dialog[open], .palette-backdrop, .drawer')) { e.preventDefault(); openPalette(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) disconnectLive();
    else { loadStatus(); connectLive(); checkForUpdate().then(offer => offer && offerUpdate()); }
  });
  render();
  loadMain();
  loadConsoleChats();
  await loadStatus();
  connectLive();
  loadConnections();
  resumeJobs();
  // The owner sees on the nav when someone is waiting to be let in.
  if (realOwner()) loadAccess();
  setInterval(() => { if (!document.hidden) { loadStatus(); loadMain(); } }, POLL_MS);
  setInterval(() => { if (!document.hidden) { refreshBoot(); if (realOwner()) loadAccess(); } }, BOOT_POLL_MS);
  setInterval(tickLive, 1000);
}

start();
