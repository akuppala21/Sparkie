// Look at the page in a browser before it is installed: public/ served against the stand-in console, on this computer.
//
//   node tools/page-preview.mjs [--port 4430] [--as owner|member|public]
//
// Then open the address it prints (one line, "Page preview: http://127.0.0.1:4430/") in a browser. Ctrl-C stops it,
// with the stand-in fleet, and removes the fleet's temporary folder; so does closing the terminal or ending whatever
// started it. Reload the browser after changing a file in public/: nothing is cached and there is no build step.
//
// What it plays: on Spark 2, Tailscale serves public/ at / and /console/ and passes /console/api on to the service's
// socket, adding who the visitor is. Here one stand-in fleet (test/start-mock.mjs, the same one the tests use) runs the
// real service, and this tool serves public/ and passes /console/api/* to that service's socket, with the headers
// Tailscale would add for the visitor chosen:
//   --as owner    (the default) the owner on the tailnet: Tailscale-User-Login: owner@test, so no passkey is asked
//   --as member   member@test on the tailnet (Sparks 2 and 3 shared, chat on, no starting models)
//   --as public   from the internet: Tailscale-Funnel-Request, no identity (the page shows its public face)
// Headers the browser itself sends under those names are dropped, as Tailscale drops them. The browser's Origin (this
// address) is replaced by the configured one (config.json's origin), which is what the page sends on Spark 2, so the
// service's cross-site check passes for the page and still refuses any other site.
//
// What the page has to show (seeded through the service's own API and the stand-in fleet's own switches, never by
// writing the service's state files): the stand-in Sparks and their running models; Spark 2's disk nearly full (the
// needs-you line); and the owner's chat with Sparkie (a member or the public sees none), in which a question used a
// tool, a stop of gpt-oss-20b on Spark 2 was offered as a button, pressed, ran and finished, a stop of the model on
// Spark 4 is offered as a button still open, and /status says what needs you. The stand-in brain answers any message
// with one tool call (fleet_status) and a short reply saying what the tool said, except its own patterns: "start …",
// "stop … on spark N", "restart … on spark N", "what's running" (test/stand-in-fleet.md).
//
// What can't work here: passkeys (WebAuthn needs the real https address: "Sign in" with --as public, and a change that
// asks for the owner's passkey, can't finish) and anything that reaches outside this computer (the
// stand-in fleet refuses it). The page's update check is off, as for any copy whose app.js still says BUILD = 'dev'.
//
// It listens on 127.0.0.1 only (--host takes nothing else), needs only Node, and never touches a real Spark, the real
// brain, Tailscale or any other host. It is a developer tool: nothing in deploy/ or service/ ships or names it.
// test/page-preview.test.mjs checks it. --public <folder> serves another copy of the page (that test uses it).
import http from 'node:http';
import { readFileSync, writeFileSync, realpathSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { startMock, REPO, API_MOUNT, OWNER, MEMBER } from '../test/start-mock.mjs';

const HOST = '127.0.0.1';
// Where a visitor seems to come from (the service rate-limits and blocks by it): a device on the tailnet, or one on the
// internet (a documentation address).
const TAILNET_VISITOR = '100.100.7.7', INTERNET_VISITOR = '203.0.113.9';
// What Tailscale adds for each visitor.
const FACES = {
  owner: { 'tailscale-user-login': OWNER, 'tailscale-user-name': 'Test Owner', 'x-forwarded-for': TAILNET_VISITOR },
  member: { 'tailscale-user-login': MEMBER, 'tailscale-user-name': 'Test Member', 'x-forwarded-for': TAILNET_VISITOR },
  public: { 'tailscale-funnel-request': '?1', 'x-forwarded-for': INTERNET_VISITOR },
};
// The content types Spark 2's route gives (Go's file server, with Ubuntu's mime.types for the manifest).
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};
// Headers for one hop only: never passed on in either direction.
const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'proxy-authorization', 'proxy-authenticate', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
// Two of the stand-in fleet's running models: the seeded chat stops the first and offers to stop the second.
const GPT = 'sc-gpt-oss-20b', RAD = 'sc-RadixArk--Qwen3.8-27B-NVFP4';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function usage(problem) {
  if (problem) console.error(`page-preview: ${problem}`);
  console.error('Use: node tools/page-preview.mjs [--port 4430] [--as owner|member|public]');
  process.exit(problem ? 2 : 0);
}
function options(argv) {
  const o = { port: 4430, as: 'owner', host: HOST, public: join(REPO, 'public') };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s);
    const value = () => inline ?? (i + 1 < argv.length ? argv[++i] : usage(`${flag} needs a value`));
    if (flag === '--port') o.port = value();
    else if (flag === '--as') o.as = value();
    else if (flag === '--host') o.host = value();
    else if (flag === '--public') o.public = value();
    else if (flag === '-h' || flag === '--help') usage();
    else usage(`unknown option ${argv[i]}`);
  }
  if (o.host !== HOST) usage(`listens on ${HOST} only, never ${o.host}`);
  if (!/^\d{1,5}$/.test(String(o.port)) || Number(o.port) > 65535) usage(`--port takes a port number (0 picks a free one), not ${o.port}`);
  if (!FACES[o.as]) usage(`--as takes owner, member or public, not ${o.as}`);
  try { if (!statSync(o.public).isDirectory()) throw new Error(); } catch { usage(`${o.public} isn't a folder`); }
  return { ...o, port: Number(o.port), public: realpathSync(o.public) };
}

/* ───────── the page's folder, as Spark 2's route serves it ───────── */
const say = (res, status, text, headers = {}) => {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(`${text}\n`);
};
// rel: the decoded path under the folder ('' for the folder itself). Only plain files inside it: no dotfiles, no folder
// listings, and nothing reached through a link (a link inside could point anywhere).
function servePage(root, req, res, rel) {
  if (!['GET', 'HEAD'].includes(req.method)) return say(res, 405, 'Only GET and HEAD here.', { allow: 'GET, HEAD' });
  const parts = (rel || 'index.html').split('/');
  if (parts.some(p => !p || p.startsWith('.'))) return say(res, 404, 'Not found.');
  const full = join(root, ...parts);
  let real, st;
  try { real = realpathSync(full); st = statSync(real); } catch { return say(res, 404, 'Not found.'); }
  if (real !== full) return say(res, 403, 'Refused: that is a link, and only the page’s own files are served.');
  if (!st.isFile()) return say(res, 404, 'Not found.');
  const body = readFileSync(real);
  res.writeHead(200, { 'content-type': TYPES[extname(real).toLowerCase()] || 'application/octet-stream', 'content-length': body.length, 'cache-control': 'no-store' });
  res.end(req.method === 'HEAD' ? undefined : body);
}

/* ───────── /console/api, as Tailscale passes it on ───────── */
function passOn(fleet, face, self, req, res) {
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k) && !k.startsWith('tailscale-') && !k.startsWith('x-forwarded-')) headers[k] = v;
  if (headers.origin === self) headers.origin = fleet.origin;
  Object.assign(headers, FACES[face], { 'x-forwarded-host': new URL(fleet.origin).host, 'x-forwarded-proto': 'https' });
  const up = http.request({ socketPath: fleet.socket, method: req.method, path: req.url, headers }, upRes => {
    const out = {};
    for (const [k, v] of Object.entries(upRes.headers)) if (!HOP.has(k)) out[k] = v;
    res.writeHead(upRes.statusCode, out);
    // The chat's reply and the live view are event streams: each piece goes on as it comes.
    res.flushHeaders();
    upRes.pipe(res);
    upRes.on('error', () => res.destroy());
  });
  up.on('error', e => { if (res.headersSent) res.destroy(); else say(res, 502, `The stand-in service didn’t answer: ${e.message}`); });
  // The browser went away (a closed page, an EventSource closed): so does the request to the service.
  res.on('close', () => { if (!res.writableFinished) up.destroy(); });
  req.pipe(up);
}

function handler(state) {
  return (req, res) => {
    const raw = req.url || '/', q = raw.indexOf('?'), path = q < 0 ? raw : raw.slice(0, q);
    let decoded;
    try { decoded = decodeURIComponent(path); } catch { return say(res, 400, 'Bad address.'); }
    // Nothing outside the page's folder or the service, however it is spelled (../, %2e%2e, a backslash).
    if (!decoded.startsWith('/') || /[\\\0]/.test(decoded) || decoded.split('/').some(s => s === '..' || s === '.')) return say(res, 403, 'Refused: outside the page’s folder.');
    if (path === API_MOUNT || path.startsWith(`${API_MOUNT}/`)) {
      if (!state.fleet) return say(res, 503, 'The stand-in fleet is starting. Try again in a few seconds.', { 'retry-after': '5' });
      return passOn(state.fleet, state.as, state.self, req, res);
    }
    if (path === '/console') { res.writeHead(301, { location: `/console/${q < 0 ? '' : raw.slice(q)}`, 'cache-control': 'no-store' }); return res.end(); }
    return servePage(state.public, req, res, decoded.startsWith('/console/') ? decoded.slice('/console/'.length) : decoded.slice(1));
  };
}

/* ───────── seeding, as the owner, through the service's own API ───────── */
// One request straight to the service's socket as the owner (page writes carry what the page sends), on a connection
// of its own. Resolves { status, text, json }.
function asOwner(fleet, path, { method = 'GET', body, timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const headers = { 'tailscale-user-login': OWNER, ...(method === 'GET' ? {} : { 'content-type': 'application/json', 'x-spark-console': '1', origin: fleet.origin }),
      ...(data ? { 'content-length': data.length } : {}) };
    const req = http.request({ socketPath: fleet.socket, path: `${API_MOUNT}${path}`, method, headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json = null; try { json = JSON.parse(text); } catch {} clearTimeout(timer); resolve({ status: res.statusCode, text, json }); });
      res.on('error', reject);
    });
    const timer = setTimeout(() => req.destroy(new Error(`${method} ${path} took over ${timeout / 1000} s`)), timeout);
    req.on('error', e => { clearTimeout(timer); reject(e); });
    req.end(data);
  });
}
async function until(what, fn, ms = 180000) {
  for (const end = Date.now() + ms; ;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error(`gave up waiting for ${what}`);
    await sleep(1000);
  }
}
async function turn(fleet, chat, text) {
  const r = await asOwner(fleet, `/chats/${chat}/messages`, { method: 'POST', body: { text } });
  const events = r.text.split('\n\n').map(b => b.trim()).filter(b => b.startsWith('data:')).map(b => { try { return JSON.parse(b.slice(5)); } catch { return {}; } });
  const done = events.find(e => e.type === 'done');
  if (r.status !== 200 || !done) throw new Error(`“${text}” got no answer: ${r.status} ${r.text.slice(0, 300)}`);
  return done.message;
}
async function seed(fleet) {
  // The stand-in brain: any message that isn't one of its own patterns gets one tool call and a reply about it.
  const own = String.raw`\b(?:start|run|deploy|launch|stop|restart)\b|\bwhat(?:'|’)?s running\b|\bwhat is running\b|\bwhy did (?:it|that) fail\b`;
  writeFileSync(join(fleet.dir, 'model-script.json'), JSON.stringify([{ match: `^(?![\\s\\S]*(?:${own}))[\\s\\S]`, calls: [{ name: 'fleet_status', arguments: {} }] }]));
  // Spark 2's disk nearly full: one line under "Needs you" (the stand-in Spark's own numbers).
  writeFileSync(join(fleet.root, 'spark2', '.mock', 'status.json'), JSON.stringify({ diskFreeGiB: 6 }));
  const made = await asOwner(fleet, '/chats', { method: 'POST', body: {} });
  if (made.status !== 201) throw new Error(`couldn’t make a chat: ${made.status} ${made.text.slice(0, 200)}`);
  const chat = made.json.id;
  await turn(fleet, chat, 'How are my Sparks doing?');
  // A question about a change comes back as a button; pressing it (as the page does) runs the operation.
  const offer = (await turn(fleet, chat, `should I stop ${GPT} on spark 2?`)).choices?.find(c => c.state === 'open');
  if (!offer) throw new Error(`no button came with the question about stopping ${GPT}`);
  const pressed = await asOwner(fleet, `/chats/${chat}/choose`, { method: 'POST', body: { choice: offer.id } });
  if (pressed.status !== 200) throw new Error(`pressing “${offer.label}” failed: ${pressed.status} ${pressed.text.slice(0, 200)}`);
  await turn(fleet, chat, `should I stop ${RAD} on spark 4?`);
  // The stop finishes (its result comes into the chat), and the needs-you line is there, before /status is asked.
  await until('the stop to finish', async () => ((await asOwner(fleet, `/chats/${chat}`)).json?.messages || []).some(m => m.notice && /^Done: /.test(m.content)));
  await until('the needs-you line', async () => ((await asOwner(fleet, '/actions/fleet_status', { method: 'POST', body: {} })).json?.needsOwner || []).some(l => /disk left/.test(l)));
  await turn(fleet, chat, '/status');
}

/* ───────── start and stop ───────── */
async function main() {
  const o = options(process.argv.slice(2));
  const state = { fleet: null, as: o.as, public: o.public, self: null };
  const sockets = new Set();
  const server = http.createServer({ noDelay: true }, handler(state));
  server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  let stopping = false;
  const stop = async (code, why) => {
    if (stopping) process.exit(130);
    stopping = true;
    if (why) console.error(why);
    server.close();
    for (const s of sockets) s.destroy();
    await state.fleet?.stop();
    process.exit(code);
  };
  const signals = () => {
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) { process.removeAllListeners(sig); process.on(sig, () => stop(0)); }
  };
  signals();
  // Whatever started it went away (a closed terminal tab, a test that ended): stop too.
  const parent = process.ppid;
  setInterval(() => { if (process.ppid !== parent) stop(0, 'page-preview: what started it has gone, so it stops.'); }, 1000);

  // The port first, so a busy one is said at once.
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(o.port, HOST, resolve); })
    .catch(e => usage(e.code === 'EADDRINUSE' ? `port ${o.port} is in use; try --port <another>` : e.message));
  const at = server.address();
  if (at.address !== HOST) { server.close(); usage(`ended up on ${at.address}, not ${HOST}`); }
  state.self = `http://${HOST}:${at.port}`;

  const t0 = Date.now();
  let fleet;
  try { fleet = await startMock({ timeoutMs: 90000 }); } catch (e) { console.error(`page-preview: the stand-in fleet didn’t start: ${e.message}`); return stop(1); }
  signals();   // (startMock's own handlers would exit at once and leave the clean-up to its last resort)
  console.error(`Stand-in fleet: ${fleet.dir} (process group ${fleet.pid})`);
  state.fleet = fleet;
  const t1 = Date.now();
  try { await seed(fleet); } catch (e) { console.error(`page-preview: seeding stopped part-way (${e.message}); the page shows what got made.`); }
  if (stopping) return;
  const secs = (a, b) => Math.round((b - a) / 1000);
  console.error(`Ready in ${secs(t0, Date.now())} s (the fleet ${secs(t0, t1)} s, seeding ${secs(t1, Date.now())} s), as ${o.as === 'public' ? 'a visitor from the internet' : `${FACES[o.as]['tailscale-user-login']} on the tailnet`}. Ctrl-C stops it and removes the fleet's folder.`);
  console.log(`Page preview: ${state.self}/`);
}

main().catch(e => { console.error(`page-preview: ${e.stack || e.message}`); process.exit(1); });
