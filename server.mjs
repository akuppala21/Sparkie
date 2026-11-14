// Local preview server for Spark Console: serves public/ (at / and at /console/, like the hosted copy) and forwards
// /console/api to Spark Console's service, the hosted one on Spark 2 unless CONSOLE_API_URL names another.
//
//   node spark-console/server.mjs                                              then http://localhost:4417
//   CONSOLE_API_URL=http://127.0.0.1:8811 PORT=4419 node spark-console/server.mjs   (a local test service)
import http from 'node:http';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

// The hosted console's address (Spark 2).
const HOSTED = 'https://akspark2.tailab9aa9.ts.net:8443';
// Spark Console's service. Defaults to the hosted one.
const CONSOLE_API = new URL(process.env.CONSOLE_API_URL || HOSTED);
// The site address requests appear to come from (the hosted console's), so the service's same-origin checks pass,
// a local test service included.
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || HOSTED;
const PORT = Number(process.env.PORT || 4417);
const HOST = process.env.HOST || '127.0.0.1';
// Host headers this server answers to. Anything else is refused, which blocks DNS-rebinding pages
// from borrowing your tailnet identity through this proxy. Add your serve hostname when sharing.
const ALLOWED_HOSTS = new Set([
  `localhost:${PORT}`,
  `127.0.0.1:${PORT}`,
  ...(process.env.ALLOWED_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean),
]);
const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
// FRAME_PARENT: a local copy of the public page that may show this UI inside it (to try that out); else none may.
const FRAME_PARENT = /^https?:\/\/[a-z0-9.-]+(:\d+)?$/.test(process.env.FRAME_PARENT || '') ? process.env.FRAME_PARENT : "'none'";
const SECURITY_HEADERS = {
  'content-security-policy': `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors ${FRAME_PARENT}`,
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};
const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade'];

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...SECURITY_HEADERS });
  res.end(body);
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = normalize(join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden');
  try {
    const body = await readFile(file);
    send(res, 200, req.method === 'HEAD' ? undefined : body, TYPES[extname(file)] || 'application/octet-stream');
  } catch {
    send(res, 404, 'Not found');
  }
}

function proxy(req, res) {
  const target = CONSOLE_API;
  const headers = { ...req.headers, host: target.host };
  for (const name of HOP_BY_HOP) delete headers[name];
  if (headers.origin) headers.origin = PUBLIC_ORIGIN;
  if (headers.referer) headers.referer = PUBLIC_ORIGIN + '/';
  const upstream = (target.protocol === 'https:' ? https : http).request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
    method: req.method,
    path: req.url,
    headers,
    timeout: 120000,
  }, upRes => {
    const out = { ...upRes.headers };
    for (const name of HOP_BY_HOP) delete out[name];
    res.writeHead(upRes.statusCode, out);
    upRes.pipe(res);
  });
  upstream.on('timeout', () => upstream.destroy(new Error('timed out')));
  upstream.on('error', e => {
    if (res.headersSent) return res.destroy();
    send(res, 502, JSON.stringify({ error: `Can't reach ${target.host} (${e.code || e.message}). Is Tailscale connected?` }), 'application/json');
  });
  req.pipe(upstream);
}

http.createServer((req, res) => {
  if (!ALLOWED_HOSTS.has(req.headers.host)) return send(res, 421, 'Unknown host. Add it to ALLOWED_HOSTS to serve under this name.');
  const { pathname } = new URL(req.url, 'http://local');
  if (pathname === '/console/api' || pathname.startsWith('/console/api/')) {
    if (!['GET', 'HEAD'].includes(req.method) && !sameOrigin(req)) {
      return send(res, 403, JSON.stringify({ error: 'Cross-site request blocked.' }), 'application/json');
    }
    return proxy(req, res);
  }
  if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, 'Method not allowed');
  // Same layout as the hosted console's /console/ mount.
  if (pathname === '/console') {
    res.writeHead(302, { location: '/console/' });
    return res.end();
  }
  serveStatic(req, res, pathname.startsWith('/console/') ? pathname.slice('/console'.length) : pathname);
}).listen(PORT, HOST, () => {
  console.log(`Spark Console on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  →  API ${CONSOLE_API.origin}`);
});
