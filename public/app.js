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
  live: new Map(),
  liveHist: new Map(),
  liveOn: false,
  lib: { data: null, error: null, missing: false, loading: false, at: 0 },
  fabric: { sparks: null, pairs: null, checkedAt: null, error: null, missing: false, outdated: false, loading: false, checking: false },
  main: { data: null, error: null },
  consoleChats: null,
  passkeys: null,
  svcJobs: new Map(),
};

// Spark Console has one user, the owner (contract 2.1): whoever gets past sign-in is the owner.
const realOwner = () => state.boot?.viewer?.role === 'owner';
const owner = realOwner;
const canChat = () => owner();
// Every Spark, for everyone.
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
// Who started a job: you (on this page), Sparkie, one of your agents, or Auto-restart.
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
const jobLabel = j => SVC_LABEL[j.type]?.(j) || cap(String(j.type || 'Operation').replace(/[-_]/g, ' '));
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

/* ───────── routing ───────── */
function route() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { view: parts[0] || 'sparkie', a: parts[1], b: parts[2], params: new URLSearchParams(query) };
}
// Going to the page that's already open draws it again (no hashchange fires for the same address).
const go = path => { const to = `#/${path}`; if (location.hash === to) render(); else location.hash = to; };
// Old addresses still work: they're replaced by where that page lives now. Home, Models, Files and Access are off the
// page (the owner uses chat and the APIs), so their addresses open the chat.
const MOVED = {
  chat: hash => hash.replace(/^#\/?chat/, '#/sparkie'),
  recipes: () => '#/',
  clusters: () => '#/',
  overview: () => '#/',
  home: () => '#/',
  sharing: () => '#/',
  fleet: () => '#/',
  models: () => '#/',
  files: () => '#/',
  access: () => '#/',
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
  const names = { spark: nodeName(r.a), sparkie: ASSISTANT };
  document.title = names[r.view] ? `${names[r.view]} · Spark Console` : 'Spark Console';
  (Object.hasOwn(PAGES, r.view) ? PAGES[r.view] : notFoundPage)(view, r);
  runLive();
}

function notFoundPage(view) {
  put(view, h('div', { class: 'empty' }, icon('search'), h('strong', {}, 'Nothing here'), h('p', {}, 'That page doesn’t exist.'), h('a', { class: 'btn', href: '#/' }, `Back to ${ASSISTANT}`)));
}

/* ───────── shell ───────── */
// The main places: path, view, label, icon, who sees it.
const NAV = [
  ['sparkie', 'sparkie', ASSISTANT, 'chat', canChat],
];
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
      h('main', { id: 'view', class: 'view', tabindex: '-1' })),
    h('div', { class: 'toasts', id: 'toasts', 'aria-live': 'polite' }),
    h('div', { class: 'sr-only', id: 'announce', 'aria-live': 'polite' }));

  live(() => {
    const r = route();
    redraw(nav, ...NAV.filter(([, , , , allowed]) => allowed()).map(([path, view, label, ic]) => {
      return h('a', { class: 'nav-item', href: `#/${path}`, 'aria-current': r.view === view ? 'page' : null }, icon(ic), h('span', {}, label));
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

/* ───────── your account: passkey, devices, theme ───────── */
const myName = () => state.boot?.userName || state.boot?.viewer?.login || 'You';
// Spark Console's address to share or open elsewhere: this page's own.
const consoleAddress = () => location.origin + location.pathname;

function accountMenu() {
  const theme = currentTheme();
  return [
    { heading: `${myName()} · owner` },
    owner() && typeof state.boot?.passkeys === 'number' ? { label: 'Your passkey', icon: 'key', onSelect: openPasskeys } : null,
    { label: 'Your devices', icon: 'monitor', hint: owner() ? 'phone, SSH' : 'phone', onSelect: openDevices },
    owner() ? { label: 'Let a device in', icon: 'plus', onSelect: () => letDeviceIn() } : null,
    owner() ? { label: 'Agents and Telegram', icon: 'link', onSelect: openAgents } : null,
    'sep',
    { heading: 'Theme' },
    ...THEMES.map(([key, label]) => ({ label, icon: theme === key ? 'check' : THEME_ICON[key], onSelect: () => setTheme(key) })),
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
  // The owner's phone opens the main address, which works from the internet (4.10).
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
  if (!owner()) return [];
  const ssh = sshCommand(n.id);
  return [
    { heading: `Open ${n.name}` },
    conn(n.id) ? { label: 'VS Code desktop', icon: 'monitor', href: desktopUrl(n.id, 'vscode'), hint: 'Remote SSH' } : null,
    conn(n.id) ? { label: 'Cursor', icon: 'monitor', href: desktopUrl(n.id, 'cursor'), hint: 'Remote SSH' } : null,
    'sep',
    ssh ? { label: 'Copy SSH command', icon: 'terminal', hint: ssh, onSelect: () => copy(ssh, `Copied: ${ssh}`) } : null,
  ];
}

// Your own editor over SSH, or the SSH command (nothing goes through Spark Console).
function openButton(n, size = 'sm') {
  if (!owner() || !conn(n.id)) return null;
  return menuButton(() => openTargets(n), { label: `Ways to open ${n.name}`, cls: `btn ${size} primary`, iconName: 'monitor', text: 'Open' });
}

function sparkActions(n, onPage = false) {
  return [
    onPage ? null : { label: 'View details', icon: 'chip', onSelect: () => go(`spark/${n.id}`) },
    owner() && !onPage ? { label: 'Logs', icon: 'logs', onSelect: () => go(`spark/${n.id}/logs`) } : null,
    owner() && !onPage ? { label: 'Workloads', icon: 'box', onSelect: () => go(`spark/${n.id}/workloads`) } : null,
    owner() ? { label: 'Run checks', icon: 'clipboard', onSelect: () => go(`spark/${n.id}/diagnostics?run=1`) } : null,
  ];
}

/* ───────── activity ───────── */
// Something Spark Console wants you to know (agents paused by themselves, an operation a restart cut off).
// One about agents pausing leads to where they're resumed.
const noticeRow = n => h('div', { class: 'notice-row' }, icon('alert'),
  h('span', {}, n.text, n.workflows && owner() ? [' ', h('button', { class: 'link-btn', type: 'button', onclick: () => openActivity('workflows') }, 'Test it now')]
    : /paused/i.test(n.text) && owner() ? [' ', h('button', { class: 'link-btn', type: 'button', onclick: openAgents }, 'Open Agents')] : null),
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
        // Who started it, when it wasn't you: Sparkie, one of your agents or Auto-restart.
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
    // The one tap tests these; a start across two Sparks needs its own run (a real start across two Sparks).
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
        if (!(await dialog({ title: 'Undo the last update?', confirm: 'Undo update', danger: true, description: `Spark Console goes back to how it was before the update on ${updateTime(r.stamp)} and restarts (about a minute). Chats, keys and settings stay as they are.` }))) return;
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
  // Whose work to show: everyone, or just you, Sparkie, one agent or Auto-restart (those with work here).
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
    put(view, empty('chip', 'Spark not found', 'It isn’t on the fleet list.', h('a', { class: 'btn', href: '#/' }, `Back to ${ASSISTANT}`)));
    return;
  }
  const tabs = owner()
    ? [['overview', 'Overview', 'grid'], ['workloads', 'Workloads', 'box'], ['logs', 'Logs', 'logs'], ['diagnostics', 'Checks', 'clipboard']]
    : [['overview', 'Overview', 'grid']];
  const tab = tabs.some(([k]) => k === r.b) ? r.b : 'overview';

  const title = h('h1', {});
  const meta = h('div', { class: 'detail-meta' });
  const chipEl = h('span', { class: 'sc-chip' }, icon('chip'));
  const actions = h('div', { class: 'btn-row' });
  const facts = h('div', { class: 'facts' });
  const content = h('div');
  put(view, 
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

  const TABS = { overview: overviewTab, workloads: workloadsTab, logs: logsTab, diagnostics: diagnosticsTab };
  TABS[tab](content, n0, r);
};

function factChips(n) {
  const net = n.network || {};
  const chip = (ic, text, kind = '') => h('span', { class: `chip ${kind}` }, icon(ic), text);
  return [
    n.dockerAccessible ? null : chip('alert', 'Can’t run models: Docker isn’t answering', 'warn'),
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
        owner() ? h('a', { class: 'btn ghost sm', href: `#/spark/${id}/workloads` }, 'Details') : null));

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
    const c = conn(id);
    if (!c) { set(body, state.connectionsError ? failBanner('Couldn’t load the connection details', state.connectionsError, loadConnections) : h('p', { class: 'muted' }, state.connections === null ? 'Loading connection details…' : 'No connection details for this Spark.')); return; }
    const line = (text, label) => h('div', { class: 'connect-line' }, h('code', {}, text),
      h('button', { class: 'btn ghost sm icon-only', type: 'button', 'aria-label': `Copy ${label}`, title: 'Copy', onclick: () => copy(text, `Copied: ${text}`) }, icon('copy')));
    const launch = (ic, name, sub, href, external) => h('a', { class: 'launch', href, target: external ? '_blank' : null, rel: external ? 'noopener noreferrer' : null }, icon(ic), h('strong', {}, name), h('span', {}, sub));
    redraw(body, 
      h('div', { class: 'launch-grid' },
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
  // Sparkie's model, each running model (its own log), and Spark Console itself on its Spark.
  const services = () => [
    ...(state.main.data?.configured && state.main.data.node === id ? [['sparkie', `${ASSISTANT}’s model`]] : []),
    ...(d.workloads?.containers || []).filter(c => c.State === 'running' && !c.protected && c.Names !== 'sparkie-main')
      .map(c => [`container-${c.ID}`, containerTitle(c.Names)]),
    ...(host ? [['console', 'Spark Console']] : []),
  ];
  // (none at all on a compute Spark with nothing running: the tab says so)
  const pick = () => { if (!services().some(([k]) => k === d.logService)) d.logService = services()[0]?.[0] || null; };
  pick();
  const select = h('select', { class: 'select sm', 'aria-label': 'Which log', onchange: () => { d.logService = select.value; d.logs = null; draw(); load(); } });
  const fillSelect = () => { pick(); set(select, services().map(([value, label]) => h('option', { value, selected: value === d.logService }, label))); };
  fillSelect();
  // The running models come from the Spark's container list.
  if (!d.workloads && isUp(node(id))) capi(`nodes/${id}/workloads`).then(w => { d.workloads = w; if (select.isConnected) { fillSelect(); if (d.logs?.none) load(); } }).catch(() => {});
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
    if (!d.logService) { d.logs = { none: true, error: `Nothing of Spark Console’s runs on ${n0.name} now, so there is no log to show.` }; draw(); return; }
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
// Tailscale says who you are. For the few changes to who may act (agent keys and their rights, new devices, passkeys), the
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
  'main-switch': j => `Switch ${ASSISTANT} to ${j.model}`,
  dig: j => `Find setups for ${j.model}`,
  'add-list': j => `Add ${j.model} from Hugging Face`,
  // Turning a Spark off or on (the smart plugs, contract 9.22); a start that needed one turned on says which model.
  'power-off': j => `Power off ${(j.nodes || [j.node]).map(nodeName).join(' + ')}`,
  'power-on': j => `Turn on ${(j.nodes || [j.node]).map(nodeName).join(' + ')}${j.model ? ` for ${titleOf(j.model)}` : ''}`,
  'self-test': j => `Self-test on ${nodeName(j.node)}`,
  // (run with minutes: a long command, by its Spark alone)
  run: j => `A command on ${nodeName(j.node)}`,
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
  if (j.status === 'completed') toast(`${label}: done`, { sub: [j.endpoint ? `Serving at ${j.endpoint}${j.tailnetLink ? ` (on your tailnet: ${j.tailnetLink})` : ''}` : found].filter(Boolean), id: key, timeout: 9000 });
  else toast(`${label} failed`, { kind: 'bad', sub: [String(j.error || '').split('\n')[0], ' ', h('button', { class: 'link-btn', type: 'button', onclick: () => openActivity(j.id) }, 'See what happened')], id: key, timeout: 20000 });
  loadJobs();
  loadLibrary();
  if (j.type.startsWith('main-')) loadMain();
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
// outcome; without it, buttons on the message say the same. A command run as a look (outcome look) says it changed nothing.
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

// A command Sparkie ran on a Spark (design A 2.10): its own quiet row, never folded, the command itself on a button
// (the Spark it ran on before it, "as root" or "as a look"); a press shows the line saying it ran as a look, the
// command whole in fixed-width type with the end of what it printed, and where all of it is kept. The service builds
// and masks every field; here they are text.
function commandRow(t) {
  const shown = h('div', { class: 'cmd-shown', hidden: true },
    t.look ? h('div', { class: 'muted' }, t.look) : null,
    h('pre', {}, [t.line, t.tail].filter(Boolean).join('\n')),
    t.kept ? h('div', { class: 'muted' }, `All of it is kept in Sparkie’s record ${t.kept}.`) : null);
  const btn = h('button', { type: 'button', class: 'cmd-row', 'aria-expanded': 'false',
    onclick: () => { shown.hidden = !shown.hidden; btn.setAttribute('aria-expanded', String(!shown.hidden)); } },
  t.where ? h('span', {}, `${t.where}${t.root ? ', as root' : t.look ? ', as a look' : ''}`) : null, h('code', {}, t.line), t.ok === false ? h('span', {}, 'didn’t run') : null);
  return h('li', {}, btn, shown);
}

// The asks' own lines, as code built them for the button (write_file's path and its old and new lines, a run's command
// and why it is asked): plain text with the buttons, so a press never does what wasn't shown here (A7d's read).
function askLines(m) {
  const groups = new Set((m.choices || []).map(x => x.group));
  const list = (m.asks || []).filter(a => a && groups.has(a.group) && typeof a.text === 'string' && a.text);
  return list.length ? h('div', { class: 'ask-lines' }, list.map(a => h('pre', {}, a.text.slice(0, 8000)))) : null;
}
function toolLines(tools, asked = false) {
  const lines = [];
  for (const t of tools) {
    const same = !t.change && !t.line && lines.find(x => !x.change && !x.line && x.name === t.name && x.ok === t.ok);
    if (same) { same.times++; same.ms += num(t.ms) ? t.ms : 0; } else lines.push({ ...t, times: 1, ms: num(t.ms) ? t.ms : 0 });
  }
  const took = ms => (ms >= 10000 ? `${Math.round(ms / 1000)} s` : `${Math.max(0.1, ms / 1000).toFixed(1)} s`);
  const times = n => (n === 2 ? ' twice' : n > 2 ? ` ${n} times` : '');
  return h('ul', { class: 'msg-tools', 'aria-label': `What ${ASSISTANT} did` }, lines.map(t => {
    if (t.line) return commandRow(t);
    const title = t.title || t.name;
    const waits = t.outcome ? ['question', 'needs-ok'].includes(t.outcome) : asked;
    // (said from the change's own outcome: "Started" only for one that started, C-10)
    const did = !t.outcome || t.outcome === 'started' ? 'Started' : { already: 'Nothing to do', 'already-starting': 'Already starting', waiting: 'Waiting', cancelling: 'Cancelling' }[t.outcome] || 'Done';
    return h('li', {}, t.change ? (t.ok && waits ? `${title}: asked ${t.outcome === 'needs-ok' ? 'for your OK' : 'you to choose'}` : `${t.ok ? did : 'Couldn’t'}: ${title}`)
      : t.ok ? `${t.outcome === 'look' ? `${title} as a look (nothing changed or sent)` : `Checked ${title}`}${times(t.times)}${t.ms ? ` · ${took(t.ms)}` : ''}` : `Couldn’t check ${title}${times(t.times)}`);
  }));
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

// What Sparkie answers with: whatever it's set to (its dedicated model, or another running model).
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
  if (!canChat()) { put(view, empty('lock', `${ASSISTANT} isn’t enabled for you`, 'Only the owner chats with Sparkie.')); return; }
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
  // The model Sparkie answers with.
  const modelBtn = h('span', { class: 'chip composer-model' });
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
  const OWNER_WORDS = ['/status', '/pause', '/restart sparkie', '/stop', '/undo', '/undo update', '/allowed', '/putback', '/help'];
  const isWord = text => { const t = String(text).trim().toLowerCase().replace(/_/g, ' '); return owner() && t.length <= 40 && (OWNER_WORDS.includes(t) || /^\/allowed off (?:all|[1-9]\d?)$/.test(t)); };
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
    redraw(modelBtn, icon('sparkle'), model.name);
    ta.placeholder = n ? `Ask ${ASSISTANT} about ${n.name}…` : `Ask ${ASSISTANT}…`;
    const down = !model.up;
    const why = main?.state === 'running' && main.routes?.chat?.kind !== 'endpoint'
      ? `${model.name} is still loading on ${nodeName(main.node)}. That takes a few minutes after a start.`
      : `${model.name} isn’t running. ${owner() ? 'Type /restart sparkie to start it again.' : 'Ask the owner to start it.'}`;
    // Until Sparkie's state has loaded, just hold Send; don't flash a warning.
    redraw(alert, down && main ? h('div', { class: 'banner warn' }, icon('alert'),
      h('div', { class: 'banner-text' }, h('strong', {}, `${ASSISTANT} can’t answer right now`), h('p', {}, why, owner() ? ' Type /help for what still works.' : ''))) : null);
    syncSend();
    sendBtn.toggleAttribute('aria-busy', c.sending);
    // Sparkie's tools are the owner's (the only one who chats here).
    note.textContent = down || !c.conv ? '' : n && !isUp(n) ? `${n.name} is offline, so live answers about it aren’t available right now.`
      : owner() ? `${ASSISTANT} looks things up on your Sparks as it answers, and can start, stop or restart models when you ask.`
        : !n ? `Each question includes a live snapshot of all your Sparks, so ${ASSISTANT} can answer about health, capacity and setup.`
          : `Each question includes ${n.name}’s live state. ${ASSISTANT} answers with ${model.name} and can’t change anything itself.`;
  }

  // Ideas to start with. In the owner's chats Sparkie can act, so most of them do something. A pick fills the box,
  // ready to send or change.
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
    // A dangerous ask (R54): its yes takes the two digits shown with it, in the same press; closed, its buttons stay, grey.
    if (m.danger) {
      const open = owner() ? list.filter(x => x.state === 'open') : [], gone = list.filter(x => x.state === 'gone');
      const pair = h('input', { type: 'text', inputmode: 'numeric', maxlength: '2', autocomplete: 'off', placeholder: '00', 'aria-label': 'The two digits from the ask', style: { width: '3.5em' } });
      return h('div', { class: 'msg-choices' }, list.filter(x => x.state === 'picked').map(x => h('p', { class: 'choice-picked' }, icon('check'), x.label)),
        open.length ? h('div', { class: 'btn-row' }, open.some(x => x.pair) ? pair : null,
          open.map(x => h('button', { class: 'btn sm', type: 'button', onclick: e => choose(x, e.currentTarget, x.pair ? pair.value.trim() : null) }, x.label))) : null,
        !open.length && gone.length ? h('div', { class: 'btn-row' }, gone.map(x => h('button', { class: 'btn sm', type: 'button', disabled: true }, x.label))) : null);
    }
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
    // A dangerous ask: lines built by code, shown as written; the exact command in its own block; then its digits.
    if (m.danger) {
      const d = m.danger, end = m.pair ? `To run it: press ${d.yes}, then type ${m.pair}.` : m.opensAt ? `This ask opens at ${fmt.time(m.opensAt)}: read it meanwhile.` : null;
      return h('div', { class: 'msg notice' },
        h('div', { class: 'msg-avatar bad', 'aria-hidden': 'true' }, icon('alert')),
        h('div', { style: { 'min-width': '0' } },
          h('div', { class: 'msg-meta' }, h('strong', {}, 'Spark Console'), h('span', {}, fmt.time(m.createdAt))),
          h('div', { class: 'msg-body' }, (d.lines || []).map((l, i) => h('p', { style: { margin: '0 0 4px', ...(i ? {} : { 'font-weight': '600' }) } }, l)),
            d.long ? h('p', { style: { margin: '0 0 4px' } }, 'Long: read all of it before you answer.') : null,
            // (framed, under a label of the page's own, so a line inside the command never reads as one of the ask's)
            d.code != null ? h('div', { class: 'danger-cmd' }, h('p', {}, 'The exact command:'), h('pre', {}, d.code)) : null,
            end ? h('p', { style: { margin: '0' } }, end) : null),
          choiceRow(m)));
    }
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
        !mine && !m.streaming ? askLines(m) : null,
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
  async function choose(x, btn, pair = null) {
    const conv = c.conv;
    if (!conv || c.sending) return;
    // One press at a time: that message's buttons wait while it runs.
    const row = btn.closest('.msg-choices'), all = [...(row?.querySelectorAll('button') || [])];
    for (const b of all) b.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    try {
      const r = await capi(`chats/${conv.id}/choose`, 'POST', { choice: x.id, ...(pair !== null ? { pair } : {}) });
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
          reply.tools = [...(reply.tools || []), { name: ev.name, title: ev.title, ok: ev.ok, ms: ev.ms, change: ev.change, outcome: ev.outcome, where: ev.where, line: ev.line, tail: ev.tail, root: ev.root, kept: ev.kept, look: ev.look }];
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

/* ───────── saving a file (a Spark's log) ───────── */
function saveBlob(name, bytes, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
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

/* ───────── agents and Telegram ───────── */
// The owner's agents and Telegram, in a drawer from the account menu. They were the Agents tab of Access, which is off
// the page (the owner uses chat and the APIs); the passkey line above them came along.
function openAgents() {
  const box = h('div', { class: 'drawer-pad agents-drawer' }), unbind = [];
  drawer({ title: 'Agents and Telegram', body: box, wide: true, onClose: () => unbind.forEach(f => f()) });
  const bind = fn => unbind.push(drawerLive(fn));
  put(box, passkeyNudge(bind));
  agentsTab(box, bind);
}

// Until the owner has a passkey, a quiet line about it (it lives in the account menu, next to the avatar).
function passkeyNudge(bind) {
  const box = h('div');
  bind(() => redraw(box, newDevicePasskey() && passkeysWork() ? h('div', { class: 'banner info' }, icon('key'),
    h('div', { class: 'banner-text' }, h('p', {}, 'Add a passkey on this device, so next time you sign in with Face ID or Touch ID. You can for 15 minutes after signing in here.')),
    // (adding one reloads the account, which ends this offer)
    h('button', { class: 'btn sm', type: 'button', onclick: addPasskey }, 'Add a passkey'))
    : state.boot?.passkeys === 0 ? h('div', { class: 'banner info' }, icon('key'),
    h('div', { class: 'banner-text' }, h('p', {}, 'Set up a passkey so changes to who has access need your fingerprint or face, not just Tailscale.')),
    // Straight to setting it up (the drawer would only say the same thing again), unless this browser can't.
    h('button', { class: 'btn sm', type: 'button', onclick: passkeysWork() ? addPasskey : openPasskeys }, 'Set up a passkey')) : null));
  return box;
}

// Agents: your own AI agents (Claude Code, Cursor, the spark command) use the console's actions through the agent door,
// each with its own key, without opening this page. Reloaded on every visit so "last used" is current.
function agentsTab(view, bind) {
  const agentsBox = h('div'), telegramBox = h('div'), backup = h('p', { class: 'muted backup-line' });
  put(view, agentsBox, telegramBox, backup);
  bind(() => redraw(telegramBox, telegramPanel()));
  loadTelegram();
  // Spark Console copies its own state (keys, chats, settings) to another Spark while one is on.
  capi('health').then(x => {
    const b = x?.lastBackup;
    if (!b || !backup.isConnected) return;
    backup.textContent = b.ok ? `Spark Console’s settings were last backed up ${fmt.when(b.at)} to ${nodeName(b.to)}.`
      : `The last backup of Spark Console’s settings didn’t work (${fmt.when(b.at)}${b.error ? `: ${b.error}` : ''}). ${b.good ? `The last good one is from ${fmt.when(b.good.at)}, on ${nodeName(b.good.to)}.` : 'There is no good one yet.'} It tries again when another Spark is on.`;
  }).catch(() => {});
  bind(() => {
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
// Approve from Telegram (A10a): on needs the passkey; off never does. /lock in the paired chat turns it off too.
async function telegramApprove(box) {
  const on = box.checked;
  try { state.telegram = await capi('telegram/approve', 'PUT', { on }); } catch (e) { if (box.isConnected) box.checked = !on; failToast(e); }
  runLive();
}
function watchPairing() {
  if (telegramPoll || !state.telegram?.code) return;
  telegramPoll = setTimeout(async () => { telegramPoll = null; if (document.querySelector('.agents-drawer')) { await loadTelegram(); watchPairing(); } }, 4000);
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
    put(body, h('label', { class: 'toggle', style: { 'margin-bottom': '10px' } }, h('input', { type: 'checkbox', role: 'switch', checked: Boolean(t.approve), onchange: e => telegramApprove(e.target) }),
      'Let me approve changes from Telegram (at most 3 an hour, 10 a day; /lock there turns this off)'));
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
  const ok = await dialog({ title: `Remove ${k.name}?`, description: 'Its key stops working right away. Nothing it started is cancelled: its operations and saved workflows finish. Your other agents keep working.', confirm: 'Remove', danger: true });
  if (!ok) return;
  try { await capi(`agents/${k.id}`, 'DELETE'); toast(`Removed ${k.name}`); } catch (e) { failToast(e); }
  await loadAgents();
  document.getElementById('connect-agent')?.focus();
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
  if (canChat()) add('Go to', `Ask ${ASSISTANT} about your Sparks`, 'chat', () => { state.chat.conv = null; go('sparkie/new'); }, { keywords: 'new chat fleet conversation' });
  if (owner()) add('Go to', 'Agents and Telegram', 'link', openAgents, { keywords: 'keys mcp claude cursor pause auto-restart telegram' });
  add('Go to', 'Activity', 'activity', openActivity, { keywords: 'jobs operations history' });

  for (const n of nodes()) {
    const up = isUp(n), sub = COND[condition(n)][0];
    add('Sparks', n.name, 'chip', () => go(`spark/${n.id}`), { sub, keywords: `${hardware(n)} ${conn(n.id)?.alias || ''} details` });
    if (owner() && up) {
      if (conn(n.id)) {
        add('Open', `VS Code desktop on ${n.name}`, 'monitor', () => { location.href = desktopUrl(n.id, 'vscode'); }, { keywords: 'remote ssh ide' });
        add('Open', `Cursor on ${n.name}`, 'monitor', () => { location.href = desktopUrl(n.id, 'cursor'); }, { keywords: 'remote ssh ide' });
        add('Open', `Copy SSH command for ${n.name}`, 'terminal', () => copy(sshCommand(n.id), `Copied: ${sshCommand(n.id)}`), { sub: sshCommand(n.id), keywords: 'terminal shell' });
      }
    }
    if (canSparkChat(n)) add('Open', `Ask ${ASSISTANT} about ${n.name}`, 'chat', () => { state.chat.conv = null; go(`sparkie/new?spark=${n.id}`); }, { keywords: 'chat assistant' });
    if (owner()) {
      add('Inspect', `Logs on ${n.name}`, 'logs', () => go(`spark/${n.id}/logs`), { keywords: 'console sparkie output' });
      add('Inspect', `Workloads on ${n.name}`, 'box', () => go(`spark/${n.id}/workloads`), { keywords: 'containers processes docker gpu' });
      add('Inspect', `Run checks on ${n.name}`, 'clipboard', () => go(`spark/${n.id}/diagnostics?run=1`), { keywords: 'check health troubleshoot diagnostics cables' });
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

/* ───────── outside: the public page ───────── */
// What anyone can see without signing in, from the internet too: the fleet's hardware and live load. Nothing about
// what runs on it or who uses it. Only the owner signs in (contract 2.1): there is no asking to be let in.
function outsidePage(who) {
  const app = $('#app');
  app.className = 'outside';
  document.title = 'Spark Console';
  const stats = h('div', { class: 'card stats' }), cards = h('div', { class: 'fleet' }), clusters = h('div');
  const status = h('p', { class: 'muted outside-status' }, 'Checking the Sparks…');
  set(app,
    h('header', { class: 'topbar outside-bar' },
      h('span', { class: 'brand' },
        h('img', { class: 'logo-on-dark', src: 'nvidia-logo-white.svg', alt: 'NVIDIA', width: '98', height: '18' }),
        h('img', { class: 'logo-on-light', src: 'nvidia-logo-black.svg', alt: 'NVIDIA', width: '98', height: '18' }),
        h('span', { class: 'brand-name' }, 'Spark Console')),
      h('div', { class: 'topbar-spacer' }),
      h('div', { class: 'outside-actions' },
        h('button', { class: 'btn primary sm', type: 'button', onclick: () => openSignIn() }, 'Sign in'))),
    h('main', { class: 'view', id: 'view', tabindex: '-1' },
      // What this is, in one line. The page has no owner's name to show, so it stays general.
      h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'DGX Spark fleet'),
        h('div', { class: 'page-sub' }, 'A private fleet of NVIDIA DGX Sparks.'), status)),
      h('div', { class: 'stack' },
        // Someone on Tailscale who isn't the owner came for the console: say so, once, at the top.
        who.login ? h('div', { class: 'banner info', style: { margin: '0' } }, icon('key'),
          h('div', { class: 'banner-text' }, h('p', {}, `You’re signed in to Tailscale as ${who.login}. Spark Console is its owner’s only.`))) : null,
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

  // The owner, from the internet (4.10): their passkey, or a code they let in from a signed-in device. Tailscale still works.
  // With no passkey on file the Tailscale steps show, with the recovery code beside them when whoami says one would work
  // (who.recovery, F18).
  async function openSignIn() {
    // (state put back from a copy: nothing signs in from here until the owner has looked on the tailnet)
    if (who.held) return dialog({ title: 'Sign in', description: who.held, cancel: null });
    if (!who.signin) return openTailscaleSignIn();
    let other = null, dlg = null;
    const pick = what => { if (dlg?.querySelector('[aria-busy]')) return; other = what; dlg?.close(); };
    const ok = await dialog({
      title: 'Sign in', confirm: 'Use passkey',
      description: 'Owner: use your passkey (Face ID, Touch ID or screen lock), and this device stays signed in.',
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
  // this device is on the tailnet as the owner.
  async function openTailscaleSignIn() {
    let dlg = null, useRecovery = false;
    const note = h('div', { 'aria-live': 'polite' });
    const show = () => redraw(note, !who.login && who.via === 'internet' && who.signin
      ? h('div', { class: 'banner info signin-note' }, icon('alert'),
        h('div', { class: 'banner-text' }, h('p', {}, 'This browser reaches Spark Console over the internet, not through Tailscale, even with Tailscale on: it looks addresses up its own way (iCloud Private Relay in Safari, or secure DNS in Chrome). Sign in with your passkey or a code instead, or turn those off and reload.')),
        h('button', { class: 'btn sm', type: 'button', onclick: () => { dlg?.close(); openSignIn(); } }, 'Passkey or code'))
      : who.login && who.access === 'none'
      ? h('div', { class: 'banner info signin-note' }, icon('key'),
        h('div', { class: 'banner-text' }, h('p', {}, `You’re on Tailscale as ${who.login}, which isn’t the owner’s account.`)))
      : h('p', { class: 'signin-wait' }, h('span', { class: 'spinner sm' }), 'Waiting for Tailscale on this device…'));
    const check = async () => {
      try {
        const res = await fetch(`${CONSOLE_API}whoami`, { cache: 'no-store', headers: { Accept: 'application/json' } });
        const w = res.ok ? await res.json() : null;
        if (!w) return;
        if (w.access === 'owner') { location.reload(); return; }
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
          h('li', {}, 'Install Tailscale on this device and sign in with the owner’s account. ',
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

// State put back from a copy (contract 6.25): what came back, for the owner on the tailnet to look at once. A passkey
// or agent key removed here stops working at once; "Keep these" lets the rest work from the internet again.
async function putBackList() {
  let l;
  try { l = await capi('auth/putback'); } catch (e) { failToast(e); return; }
  if (!l.held) return;
  const when = t => (t ? fmt.when(t) : 'never');
  const row = (text, sub, remove) => h('li', { class: 'putback-row' }, h('div', {}, h('div', {}, text), h('div', { class: 'muted' }, sub)),
    h('button', { class: 'btn sm', type: 'button', onclick: async e => { e.target.disabled = true; try { await remove(); e.target.closest('li').remove(); } catch (err) { e.target.disabled = false; failToast(err); } } }, 'Remove'));
  const body = h('div', { class: 'putback' },
    h('p', {}, `Every device was signed out${l.parked ? `, and ${l.parked === 1 ? 'a task was' : `${l.parked} tasks were`} parked` : ''}. Remove anything here you had removed, then keep the rest.`),
    l.removedAgain.length ? h('p', { class: 'muted' }, `Removed again (you had removed them since): ${l.removedAgain.map(x => `${x.kind} “${x.name}”`).join(', ')}.`) : null,
    h('h3', {}, 'Passkeys'),
    l.passkeys.length ? h('ul', { class: 'putback-list' }, ...l.passkeys.map(k => row(k.name, `Added ${when(k.addedAt)} · last used ${when(k.lastUsedAt)}`, () => capi(`auth/passkeys/${encodeURIComponent(k.id)}`, 'DELETE')))) : h('p', { class: 'muted' }, 'None.'),
    h('h3', {}, 'Agent keys'),
    l.agentKeys.length ? h('ul', { class: 'putback-list' }, ...l.agentKeys.map(k => row(k.name, `${k.canChange ? 'Can start and stop models' : 'Can only look'}${k.fromAnywhere ? ', from anywhere' : ', on your tailnet only'}`, () => capi(`agents/${k.id}`, 'DELETE')))) : h('p', { class: 'muted' }, 'None.'),
    ...(l.allowed?.length ? [h('h3', {}, 'Always allowed'), h('ul', { class: 'putback-list' }, ...l.allowed.map(w => h('li', { class: 'putback-row' }, h('div', {}, w)))),
      h('p', { class: 'muted' }, 'These run without asking again only after you keep them. Take one away with /allowed off in your chat.')] : []),
    h('p', { class: 'muted' }, `${l.agentsPaused ? 'Agents’ changes are paused. ' : ''}${l.lastUse} ${l.namesAreData}`));
  const ok = await dialog({
    title: 'Spark Console’s state was put back from a copy', description: 'Until you keep what came back, sign-in from the internet is refused and agents can’t change anything.',
    body, confirm: 'Keep these', cancel: 'Later', wide: true,
    onConfirm: () => capi('auth/putback/keep', 'POST'),
  });
  if (ok) { toast('Kept. Sign-in from the internet and agents work again.'); refreshBoot(); }
}

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
  if (state.boot.putBack) putBackList();
  loadMain();
  loadConsoleChats();
  await loadStatus();
  connectLive();
  loadConnections();
  resumeJobs();
  // What runs on a Spark is shown by its model's name, from the library (Home loaded it before it left the page).
  loadLibrary();
  setInterval(() => { if (!document.hidden) { loadStatus(); loadMain(); } }, POLL_MS);
  setInterval(() => { if (!document.hidden) refreshBoot(); }, BOOT_POLL_MS);
  setInterval(tickLive, 1000);
}

start();
