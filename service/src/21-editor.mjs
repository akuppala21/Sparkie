/* ───────── VS Code in the browser (taking over from the original portal) ───────── */
// Area: features        Rules: R4, R31        Tests: internet.test.mjs, passkey.test.mjs
// Owns: none
// Timers: none        Wakes: none
// <console api>/connect/<spark>/ goes to that Spark's code-server, which listens on 127.0.0.1 on this Spark: its own,
// and Spark 3 and 4's through the tunnel services. Owner only, since the editor is a full shell as the owner. The
// same checks and rewriting the portal did: no escaping the editor's path, redirects and cookies kept under it, and
// WebSockets only from this site.
const EDITOR_PORTS = CONFIG.editorPorts || { spark1: 8803, spark2: 8801, spark3: 8802, spark4: 8804 };
const API_MOUNT = CONFIG.apiMount || '/console/api';
const editorPath = id => `${API_MOUNT}/connect/${id}/`;
// Editor use on each Spark, for the idle power-off (21-power.mjs): when a request last went to its editor, and how many
// of its WebSockets (an open editor tab) are open now. In memory only.
const editorUse = new Map();   // spark → { at, open }
const editorSeen = (id, open = 0) => { const u = editorUse.get(id) || { at: 0, open: 0 }; editorUse.set(id, { at: Date.now(), open: Math.max(0, u.open + open) }); };

function editorTarget(path) {
  const m = /^\/connect\/([a-z0-9-]+)\/(.*)$/.exec(path);
  if (!m) return null;
  if (!EDITOR_PORTS[m[1]]) throw new HttpError(404, 'That Spark has no editor.');
  let decoded;
  try { decoded = decodeURIComponent(m[2].split('?')[0]); } catch { throw new HttpError(400, 'Invalid workspace path.'); }
  if (decoded.includes('\\') || decoded.split('/').includes('..') || /[\x00-\x1f]/.test(decoded)) throw new HttpError(400, 'Invalid workspace path.');
  // code-server's port forwarding (/proxy/<port>/, /absproxy/<port>/) would put any program's page on a Spark on this
  // console's own address, with the owner's sign-in: never through the console (security audit, 2026-11-11).
  if (/^(abs)?proxy$/i.test(decoded.split('/').filter(Boolean)[0] || '')) throw new HttpError(400, 'Port forwarding isn’t offered through Spark Console.');
  return { id: m[1], port: EDITOR_PORTS[m[1]], path: `/${m[2]}`, prefix: `${API_MOUNT}/connect/${m[1]}` };
}
function editorRequestHeaders(req, upgrade) {
  const headers = { ...req.headers };
  for (const key of Object.keys(headers)) {
    if (key.startsWith('tailscale-') || key.startsWith('x-forwarded-') || ['authorization', 'proxy-authorization', 'x-spark-console', 'host', 'connection', 'upgrade', 'proxy-connection', 'forwarded'].includes(key)) delete headers[key];
  }
  // The editor keeps its own cookies; the owner's sign-in cookie (4.10) is Spark Console's alone.
  if (headers.cookie) {
    const kept = String(headers.cookie).split(';').map(s => s.trim()).filter(s => s && !s.startsWith(`${SESSION_COOKIE}=`)).join('; ');
    if (kept) headers.cookie = kept; else delete headers.cookie;
  }
  headers.host = req.headers.host;
  if (upgrade) { headers.connection = 'Upgrade'; headers.upgrade = 'websocket'; }
  return headers;
}
function editorResponseHeaders(headers, target) {
  const out = { ...headers };
  delete out['access-control-allow-origin'];
  delete out['access-control-allow-credentials'];
  if (out.location) {
    const loc = out.location;
    if (/^https?:\/\//.test(loc)) {
      const u = new URL(loc);
      if (!['127.0.0.1', 'localhost'].includes(u.hostname) && u.origin !== CONFIG.origin) throw new Error('External workspace redirect denied.');
      out.location = target.prefix + u.pathname + u.search;
    } else if (loc.startsWith('/') && !loc.startsWith('//')) out.location = target.prefix + loc;
    else if (/^[a-z][a-z0-9+.-]*:/i.test(loc) || loc.startsWith('//')) throw new Error('External redirect denied.');
  }
  if (out['set-cookie']) out['set-cookie'] = out['set-cookie'].map(c => (/;\s*Path=/i.test(c) ? c.replace(/;\s*Path=([^;]*)/i, `; Path=${target.prefix}/`) : `${c}; Path=${target.prefix}/`));
  out['cache-control'] = 'no-store';
  return out;
}
// Cross-site checks for the editor: browsers mark where a request came from; changes and WebSockets must come from
// this site.
function editorAllowed(req, strict) {
  const site = req.headers['sec-fetch-site'];
  if (site && !['same-origin', 'none'].includes(site)) return false;
  const origin = req.headers.origin;
  if (origin && origin !== CONFIG.origin && !sameOrigin(req)) return false;
  return !strict || Boolean(origin) && (origin === CONFIG.origin || sameOrigin(req));
}

function editorHttp(req, res, target) {
  if (Number(req.headers['content-length'] || 0) > 100 * 1024 * 1024) throw new HttpError(413, 'Workspace upload is too large.');
  if (!editorAllowed(req, !['GET', 'HEAD'].includes(req.method))) throw new HttpError(403, 'Open the editor from Spark Console.');
  editorSeen(target.id);
  const up = http.request({ host: '127.0.0.1', port: target.port, path: target.path, method: req.method, headers: editorRequestHeaders(req, false) }, r => {
    let headers;
    try { headers = editorResponseHeaders(r.headers, target); } catch { r.destroy(); return send(res, 502, { error: 'Workspace redirect was rejected.' }); }
    // (a reply Node reads but can't pass on, a status of 099 say, must not end the process)
    try { res.writeHead(r.statusCode, headers); } catch { r.destroy(); return res.headersSent ? res.destroy() : send(res, 502, { error: 'The workspace answered with something Spark Console can’t pass on.' }); }
    r.pipe(res);
  });
  up.on('error', () => { if (!res.headersSent) send(res, 503, { error: `${target.id}’s editor isn’t answering. Restart it from the Spark’s menu.` }); else res.destroy(); });
  up.setTimeout(120000, () => up.destroy());
  res.on('close', () => { if (!res.writableFinished) up.destroy(); });
  req.pipe(up);
}

async function editorUpgrade(req, socket, head) {
  // A socket that errors with no listener ends the whole process: one is attached before anything else, so a visitor
  // resetting a refused connection can't restart the console (security audit, 2026-11-11).
  socket.on('error', () => socket.destroy());
  const deny = status => { socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`); socket.destroySoon?.(); };
  try {
    const path = new URL(req.url, 'http://local').pathname.replace(/^\/console\/api(?=\/|$)/, '') + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');
    const target = editorTarget(path);
    if (!target || req.headers.upgrade?.toLowerCase() !== 'websocket') return deny('404 Not Found');
    try { requestGate(req, path); } catch { return deny('403 Forbidden'); }
    const viewer = await viewerFor(req);
    if (!viewer || viewer.role !== 'owner' || (viewer.session && viewer.session.kind !== 'browser') || !editorPasskeyFresh(viewer) || !editorAllowed(req, true)) return deny('403 Forbidden');
    // Signing this device out closes its editor connections too (4.10).
    holdForSession(viewer, socket);
    const up = http.request({ host: '127.0.0.1', port: target.port, path: target.path, method: 'GET', headers: editorRequestHeaders(req, true) });
    up.on('upgrade', (response, remote, upHead) => {
      let headers;
      try { headers = editorResponseHeaders(response.headers, target); } catch { remote.destroy(); socket.destroy(); return; }
      // (an open editor tab: its Spark is in use until the socket closes)
      editorSeen(target.id, 1);
      socket.once('close', () => editorSeen(target.id, -1));
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

