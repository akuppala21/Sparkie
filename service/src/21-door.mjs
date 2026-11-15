/* ───────── the app door: the owner's kept apps from anywhere (R40) ───────── */
// Area: features        Rules: R40        Tests: app-door.test.mjs
// Owns: none
// Timers: none        Wakes: none
// The owner opens an app kept running (keep_running, R38) on any Spark that isn't the brain's from anywhere, a phone
// without Tailscale too, signed in as on the main address (the owner, 2026-11-12: "once you're signed in, you shouldn't
// need a separate password"). It is Spark Console's own name on port 10000 (Funnel's one free port; 443 is the public
// Funnel's), which Tailscale serve hands to door.sock, a private socket like api.sock. Only the owner's script
// deploy/open-apps-to-internet.sh points Tailscale there; the console only reads whether it does (doorOn, checkRoute).
// - Its own origin: an app's page can't call the console's API as the owner. sameOrigin compares the whole origin, port
//   included, nothing answers CORS, and requestGate refuses the door's origin outright.
// - The browser's sign-in cookie is sent only under /console/api (on any port of this name), so opening an app is
//   GET /console/api/open/<spark>/<container> on the door: it reads the cookie with viewerFor, as the main address does,
//   and gives this browser a door ticket, a random token in its own cookie (HttpOnly, Secure, SameSite=Lax, Path=/) kept
//   here in memory only, with the session it came from and the one app it opens. One browser shows one app at a time:
//   it can't tell the browser's tabs apart, so opening another app over one in use asks first, and a switch closes the
//   first app's WebSockets.
// - Every request and WebSocket then checks again: the owner by Tailscale on the tailnet, or from the internet the
//   ticket's session still signed in and the owner's; and the app still kept. Members never; agent keys never.
// - Toward the app go no console or door cookie, no Tailscale identity and no client X-Forwarded-*; back from it, no
//   Set-Cookie with a console or door name (cookies set on :10000 also reach :8443) and no CORS grant.
// - No service worker on its origin (one would outlive its tab and answer for whichever app is open next), and opening
//   an app clears the origin's cache (never its cookies or storage: that would sign apps such as Open WebUI out).
// Nothing here is logged: no body, cookie, header or path.
const DOOR_SOCKET = process.env.SPARK_CONSOLE_DOOR_SOCKET || `${STATE_DIR}/door.sock`;
const DOOR_PORT = 10000;
const DOOR_COOKIE = '__Host-sc_door';
const DOOR_OPEN = /^\/console\/api\/open\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/([A-Za-z0-9][A-Za-z0-9_.-]{0,62})\/?$/;
const DOOR_TICKET_MS = 12 * 3600000;
// An app counts as in use in this browser with a request this recent, or a WebSocket open.
const DOOR_BUSY_MS = 10 * 60000;
// Whether Tailscale serves the door (port 10000 to door.sock): null until an answer names this name (as funnelOn).
let doorOn = null;
const doorTickets = new Map();
const doorHosts = () => [...new Set([selfOrigin, CONFIG.origin].filter(o => /^https:\/\/[a-z0-9.-]+(:\d+)?$/.test(o || '')).map(o => `${new URL(o).hostname}:${DOOR_PORT}`))];
const doorOrigin = () => (/^https:\/\//.test(consoleOrigin()) ? `https://${new URL(consoleOrigin()).hostname}:${DOOR_PORT}` : null);
// An app's door link, only while the door is on.
const doorLink = (spark, container) => (doorOn && doorOrigin() ? `${doorOrigin()}/console/api/open/${spark}/${container}` : null);
// An app's links (R40): with the door on, its door link first and its tailnet link second; else the tailnet one alone.
function appLinks(spark, container, tailnet) {
  const door = tailnet ? doorLink(spark, container) : null;
  return door ? { link: door, tailnetLink: tailnet } : { link: tailnet };
}
const linkWords = l => (l.tailnetLink ? `${l.link} (on your tailnet: ${l.tailnetLink})` : l.link);
// A cookie name that is the console's or the door's (sc_session, __Host-sc_door, or any later sc_ name).
const consoleCookieName = name => /^(__host-|__secure-)?sc_/i.test(String(name || '').trim());

// The app named, if the door may open it: on the list of what should be running as an app (keep_running), on a Spark
// that is on the list and isn't the brain's, at its recorded port (never the model port, nor one a model server answers
// on), at that Spark's tailnet address. Nothing from the request but the two names, each one word.
async function doorTarget(spark, container) {
  await refreshNodes(null);
  const x = desired().running.find(y => y.app && y.spark === spark && y.container === container);
  const at = sparkName(nodeById(spark) || { id: spark });
  if (!x || !nodeById(spark) || brainSparks().includes(spark)) throw new HttpError(404, `${container} on ${at} isn’t an app Spark Console keeps running, so the app door doesn’t open it.`);
  if (!Number.isInteger(x.port) || x.port < 1 || x.port > 65535 || x.port === CONFIG.servePort) throw new HttpError(404, `No port is known for ${container}, so the app door can’t open it.`);
  const sp = (await recentInventory()).sparks.find(s => s.id === spark);
  if (!sp?.online || !/^\d{1,3}(\.\d{1,3}){3}$/.test(sp.tsip || '')) throw new HttpError(503, `${at} isn’t reachable right now.`);
  if (sp.deployments.some(d => d.container === container) || sp.external.some(e => e.port === x.port)) throw new HttpError(404, `${container} on ${at} serves models, so the app door doesn’t open it.`);
  return { spark, container, host: sp.tsip, port: x.port };
}
// The ticket this browser holds, if any (an app's page may add its own cookie of that name under a longer path: each
// value is tried, and only one this process gave out counts).
function doorTicketOf(req) {
  const now = Date.now();
  for (const v of cookieValues(req, DOOR_COOKIE)) {
    const t = /^[A-Za-z0-9_-]{43}$/.test(v) ? doorTickets.get(sessionHash(v)) : null;
    if (t && t.exp > now) return t;
  }
  return null;
}
// As requestGate: programs on the Sparks never act as a person (R5), and nothing answers until their addresses are known.
function doorGate(req) {
  const blocked = ALL_LOCAL ? sparkAddresses() : blockedAddresses, from = clientAddress(req);
  if (!blocked) return { status: 503, text: 'Spark Console is starting. Try again in a few seconds.' };
  if (from && blocked.has(from)) return { status: 403, text: 'Programs on the Sparks can’t open apps through the app door.' };
  return null;
}
// Who is asking and what they may open, checked on every request and WebSocket: { viewer, ticket } or { status, text }.
function doorWho(req) {
  const refused = doorGate(req);
  if (refused) return refused;
  const ticket = doorTicketOf(req), funnel = Boolean(req.headers['tailscale-funnel-request']);
  const login = funnel ? null : req.headers['tailscale-user-login'] || DEV_LOGIN;
  // On the tailnet, Tailscale says who it is; from the internet, the session the ticket came from, as it is now.
  const viewer = login ? viewerForLogin(login) : ticket?.session ? ownerSessionView(sessionList().find(s => s.id === ticket.session && !sessionOver(s))) : null;
  if (!viewer) return { status: 401, text: 'Sign in to Spark Console, then open the app from there.' };
  if (viewer.role !== 'owner') return { status: 403, text: 'The app door is the owner’s. Open the app on your tailnet.' };
  if (viewer.session && viewer.session.kind !== 'browser') return { status: 403, text: 'Open apps from a browser.' };
  if (!ticket) return { status: 404, text: 'No app is open here. Open one from Spark Console.' };
  const x = desired().running.find(y => y.app && y.spark === ticket.spark && y.container === ticket.container);
  if (!x || x.port !== ticket.port || !nodeById(ticket.spark) || brainSparks().includes(ticket.spark)) return { status: 404, text: `${ticket.container} isn’t kept running any more. Open an app from Spark Console.` };
  return { viewer, ticket };
}
// The short page for anything refused: one sentence and the main address, nothing else (the switch question: and its
// one button).
function doorPage(res, status, text, button = null) {
  const home = /^https:\/\/[a-z0-9.-]+(:\d+)?$/.test(consoleOrigin()) ? `${consoleOrigin()}/` : null;
  const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'" });
  res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spark Console</title>`
    + `<body style="font:17px/1.5 system-ui,sans-serif;margin:2rem auto;max-width:32rem;padding:0 1rem"><p>${esc(text)}</p>${button ? `<form method="get" action="${esc(button.action)}"><input type="hidden" name="switch" value="${esc(button.word)}"><button>Switch anyway</button></form>` : ''}${home ? `<p><a href="${esc(home)}">Open Spark Console</a></p>` : ''}</body></html>`);
}

// Toward the app: the browser's request, less the console's and the door's credentials and identities.
function doorRequestHeaders(req, upgrade) {
  const out = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (k.startsWith('tailscale-') || k.startsWith('x-forwarded-') || ['host', 'forwarded', 'connection', 'upgrade', 'keep-alive', 'proxy-connection', 'proxy-authorization'].includes(k)) continue;
    out[k] = v;
  }
  if (out.cookie) {
    const kept = String(out.cookie).split(';').map(s => s.trim()).filter(s => s && !consoleCookieName(s.split('=')[0])).join('; ');
    if (kept) out.cookie = kept; else delete out.cookie;
  }
  // (a terminal's sign-in token never goes on; an app's own Authorization does)
  if (/\bscs_/.test(String(out.authorization || ''))) delete out.authorization;
  const host = doorHosts()[0];
  if (host) Object.assign(out, { host, 'x-forwarded-host': host, 'x-forwarded-proto': 'https' });
  if (upgrade) Object.assign(out, { connection: 'Upgrade', upgrade: req.headers.upgrade });
  return out;
}
// Back from the app: no cookie with a console or door name, no CORS grant (pages on this name's other ports would read
// the app as the owner), and its own redirects kept on the door.
function doorResponseHeaders(headers, t) {
  const out = { ...headers };
  delete out['access-control-allow-origin'];
  delete out['access-control-allow-credentials'];
  delete out['service-worker-allowed'];
  if (out['set-cookie']) {
    const kept = out['set-cookie'].filter(c => !consoleCookieName(String(c).split('=')[0]));
    if (kept.length) out['set-cookie'] = kept; else delete out['set-cookie'];
  }
  if (typeof out.location === 'string' && /^(https?:)?\/\//i.test(out.location)) {
    try {
      const u = new URL(out.location, 'https://door.invalid');
      if ([...doorHosts(), `${t.host}:${t.port}`].includes(u.host)) out.location = `${u.pathname}${u.search}${u.hash}`;
    } catch {}
  }
  return out;
}

async function doorOpen(req, res, spark, container, word) {
  // From Spark Console's page (same site) or opened by itself (typed, a bookmark, another app's link): never from an
  // app's own page here, which could switch this browser to another app and read it, nor from another site. "Switch
  // anyway" (below) is the door's own page, with the one-time word it gave this browser for this app.
  const site = req.headers['sec-fetch-site'], refused = doorGate(req);
  if (refused) return doorPage(res, refused.status, refused.text);
  const current = doorTicketOf(req), ask = current?.confirm;
  if (word !== null && current) delete current.confirm;
  const confirmed = word !== null && ask?.exp > Date.now() && ask.spark === spark && ask.container === container && ask.hash === sessionHash(word);
  if (word !== null && !confirmed) return doorPage(res, 403, 'That switch has expired. Open the app again from Spark Console.');
  if (site && !['same-site', 'none', ...(confirmed ? ['same-origin'] : [])].includes(site)) return doorPage(res, 403, 'Open apps from Spark Console.');
  const viewer = await viewerFor(req);
  if (!viewer) return doorPage(res, 401, 'Sign in to Spark Console, then open the app from there.');
  if (viewer.role !== 'owner') return doorPage(res, 403, 'The app door is the owner’s. Open the app on your tailnet.');
  if (viewer.session && viewer.session.kind !== 'browser') return doorPage(res, 403, 'Open apps from a browser.');
  let t;
  try { t = await doorTarget(spark, container); } catch (e) { return doorPage(res, e.status || 500, e.message); }
  const now = Date.now(), other = current && (current.spark !== spark || current.container !== container);
  // Another app in use in this browser: the door can't tell its tabs apart (one cookie), so ask before switching.
  if (other && !confirmed && (current.sockets.size || now - current.lastAt < DOOR_BUSY_MS)) {
    const w = randomBytes(32).toString('base64url'), name = (s, c) => `${c} on ${sparkName(nodeById(s) || { id: s })}`;
    current.confirm = { hash: sessionHash(w), spark, container, exp: now + DOOR_BUSY_MS };
    const a = name(current.spark, current.container), b = name(spark, container);
    return doorPage(res, 409, `${a} is open in this browser. Opening ${b} switches this browser to it: the other tab stops working, and anything it still saves would go to ${b}. Close that tab first.`,
      { action: `/console/api/open/${spark}/${container}`, word: w });
  }
  const token = randomBytes(32).toString('base64url'), key = sessionHash(token);
  for (const [k, x] of doorTickets) if (x.exp < now) doorTickets.delete(k);
  while (doorTickets.size >= 200) doorTickets.delete(doorTickets.keys().next().value);
  // One ticket per browser: the one it held goes; another app's WebSockets close with it (that tab visibly disconnects),
  // the same app's carry over.
  if (current) {
    doorTickets.delete(current.key);
    if (other) for (const s of current.sockets) s.destroy();
  }
  doorTickets.set(key, { key, session: viewer.session?.id || null, ...t, exp: now + DOOR_TICKET_MS, sockets: current && !other ? current.sockets : new Set(), lastAt: 0 });
  audit({ via: viewer.session ? 'internet' : 'page', actor: 'owner', action: 'app-opened', args: { spark, container, device: viewer.session?.name || null }, ok: true });
  res.writeHead(302, { location: '/', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'clear-site-data': '"cache"',
    'set-cookie': `${DOOR_COOKIE}=${token}; Path=/; Max-Age=${DOOR_TICKET_MS / 1000}; HttpOnly; Secure; SameSite=Lax` });
  res.end();
}

const doorHandler = async (req, res) => {
  try {
    if (!String(req.url || '').startsWith('/')) return doorPage(res, 400, 'Bad request.');
    // A browser fetching a service worker's script says so: refused, so none registers on the door's origin.
    if (req.headers['service-worker']) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      return res.end('The app door doesn’t let apps install service workers.\n');
    }
    const u = new URL(req.url, 'http://door'), path = u.pathname;
    // /console/api is the door's own (the sign-in cookie is sent there): never passed to an app.
    if (/^\/console\/api(\/|$)/.test(path)) {
      const m = DOOR_OPEN.exec(path);
      if (!m || req.method !== 'GET') return doorPage(res, 404, 'Not found.');
      return await doorOpen(req, res, m[1], m[2], u.searchParams.get('switch'));
    }
    const who = doorWho(req);
    if (!who.ticket) return doorPage(res, who.status, who.text);
    // Changes come from the app's own page: a page on another site or another port of this name (which the door's
    // SameSite=Lax cookie would still reach) can't post to the app as the owner.
    const site = req.headers['sec-fetch-site'], origin = req.headers.origin;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && ((site && site !== 'same-origin') || (origin && origin !== doorOrigin()))) return doorPage(res, 403, 'Only the app’s own page can change things in it.');
    const t = who.ticket;
    t.lastAt = Date.now();
    const up = http.request({ host: t.host, port: t.port, path: req.url, method: req.method, headers: doorRequestHeaders(req, false) }, r => {
      up.setTimeout(0);
      // (a reply Node reads but can't pass on, a status of 099 say, must not end the process)
      try { res.writeHead(r.statusCode, doorResponseHeaders(r.headers, t)); } catch {
        r.destroy();
        return res.headersSent ? res.destroy() : doorPage(res, 502, `${t.container} on ${sparkName(nodeById(t.spark) || { id: t.spark })} answered with something the app door can’t pass on.`);
      }
      r.pipe(res);
    });
    up.on('error', () => { if (!res.headersSent) doorPage(res, 502, `${t.container} on ${sparkName(nodeById(t.spark) || { id: t.spark })} isn’t answering right now.`); else res.destroy(); });
    // (until the app starts answering; a stream after that stays open as long as both ends keep it)
    up.setTimeout(120000, () => up.destroy());
    res.on('close', () => { if (!res.writableFinished) up.destroy(); });
    req.pipe(up);
  } catch {
    if (!res.headersSent) doorPage(res, 500, 'Something went wrong. Try again.'); else res.destroy();
  }
};

async function doorUpgrade(req, socket, head) {
  // (an error listener first: a reset socket with none would end the process, R31)
  socket.on('error', () => socket.destroy());
  const deny = status => { socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`); socket.destroySoon?.(); };
  try {
    if (!String(req.url || '').startsWith('/') || /^\/console\/api(\/|$)/.test(new URL(req.url, 'http://door').pathname)) return deny('404 Not Found');
    if (String(req.headers.upgrade || '').toLowerCase() !== 'websocket') return deny('400 Bad Request');
    const who = doorWho(req);
    if (!who.ticket) return deny(who.status === 401 ? '401 Unauthorized' : who.status === 404 ? '404 Not Found' : who.status === 503 ? '503 Service Unavailable' : '403 Forbidden');
    // Browsers let any page open a WebSocket anywhere (CORS doesn't cover them): only the app's own page here opens one.
    if (req.headers.origin && req.headers.origin !== doorOrigin()) return deny('403 Forbidden');
    const t = who.ticket, held = t.sockets;
    t.lastAt = Date.now();
    // Signing this device out closes its app connections too; so does opening another app in this browser.
    holdForSession(who.viewer, socket);
    held.add(socket);
    socket.once('close', () => held.delete(socket));
    const up = http.request({ host: t.host, port: t.port, path: req.url, method: 'GET', headers: doorRequestHeaders(req, true) });
    up.on('upgrade', (response, remote, upHead) => {
      // (no idle limit once it's a WebSocket: a quiet notebook stays connected)
      remote.setTimeout(0);
      const headers = doorResponseHeaders(response.headers, t);
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(headers).flatMap(([k, v]) => (Array.isArray(v) ? v.map(x => `${k}: ${x}`) : [`${k}: ${v}`])).join('\r\n')}\r\n\r\n`);
      if (upHead.length) socket.write(upHead);
      if (head.length) remote.write(head);
      socket.pipe(remote).pipe(socket);
      socket.on('error', () => remote.destroy());
      remote.on('error', () => socket.destroy());
      socket.on('close', () => remote.destroy());
      remote.on('close', () => socket.destroy());
    });
    up.on('response', r => { r.resume(); deny('502 Bad Gateway'); });
    up.on('error', () => socket.destroy());
    up.setTimeout(15000, () => up.destroy());
    up.end();
  } catch {
    deny('403 Forbidden');
  }
}
