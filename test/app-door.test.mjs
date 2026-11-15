// Covers: The app door (R40), on a fifth stand-in Spark added to the list and on Spark 4, with tiny apps in the test
// process: with the door on, `keep_running` and `should_be_running` give the door's link first and the tailnet one as
// `tailnetLink`; the owner's session cookie opens a kept app (an HttpOnly, Secure, SameSite=Lax door ticket for `/`),
// HTTP, a WebSocket and a 5 MB upload go through; no console or door cookie, Tailscale identity or client
// `X-Forwarded-*` reaches the app, and its Set-Cookie with a console or door name and its CORS grant are dropped; one
// app per browser; refused for HTTP and the WebSocket: not signed in, a member, an agent key, a terminal, a Spark's own
// address; `/open` refuses a model, Spark 2, the model port, a hand-started model server, an unknown name or Spark, a
// port or address in the path, an app's own page or another site; posts and WebSockets only from the door's origin; the
// door's origin can't use the main API, a read too; signing a device out closes its app WebSocket and ticket; a
// forgotten app no longer opens. `deploy/open-apps-to-internet.sh` against a stand-in `tailscale` and `ssh`: opens only
// port 10000 with Funnel, a second run changes nothing, `--undo` puts it back as it was (twice too), and it refuses a
// port 10000 that serves something else or a build without the door.
//
// The app door (R40): the owner opens an app kept running (keep_running) on any Spark that isn't the brain's from
// anywhere, signed in as on the main address, at Spark Console's name on port 10000. Tailscale serve hands that port to
// the door's own socket (door.sock); here the test talks to the socket the way Tailscale would, with
// "Tailscale-Funnel-Request" for the internet and "Tailscale-User-Login" for the tailnet. The apps are tiny HTTP and
// WebSocket servers in this process, kept on a fifth stand-in Spark (added to the list the way the owner adds one, so
// nothing in the code names it) and on Spark 4. The door is on: the stand-in `tailscale serve status` says port 10000
// goes to door.sock.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, copyFileSync, mkdtempSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { T, useFleet, api, createKey, auditLines, sleep, SLOW, REPO } from './lib.mjs';
import { serviceConfig } from './start-mock.mjs';

const MAIN = serviceConfig().origin, HOST = new URL(MAIN).hostname;
const DOOR = `https://${HOST}:10000`, DOOR_HOST = `${HOST}:10000`;
const openLink = (spark, container) => `${DOOR}/console/api/open/${spark}/${container}`;

// An app: answers every request with its name, the path and how many bytes it was sent; sets its own cookie and tries
// to set the console's and the door's; grants CORS to anyone and a service worker the whole origin; and echoes a
// WebSocket's bytes. /boom answers with a status line Node reads and can't pass on. It keeps what it saw, by path
// (Spark Console's own looks at it, /v1/models and /, come in between).
function app(name) {
  const seen = { http: {}, ws: null };
  const s = http.createServer((req, res) => {
    if (req.url === '/boom') return req.socket.end('HTTP/1.1 099 Odd\r\nContent-Length: 0\r\n\r\n');
    let n = 0;
    req.on('data', c => { n += c.length; });
    req.on('end', () => {
      seen.http[req.url] = { method: req.method, headers: req.headers, bytes: n };
      const head = { 'content-type': 'text/plain', 'access-control-allow-origin': req.headers.origin || '*', 'access-control-allow-credentials': 'true', 'service-worker-allowed': '/',
        'set-cookie': ['app_session=ok; Path=/', 'sc_session=planted; Path=/console/api', '__Host-sc_door=planted; Path=/; Secure', 'SC_Other=x; Path=/'] };
      if (req.url === '/redirect') { res.writeHead(302, { ...head, location: `http://${DOOR_HOST}/lab?x=1` }); return res.end(); }
      res.writeHead(200, head);
      res.end(`${name} ${req.url} ${n}`);
    });
  });
  s.on('upgrade', (req, socket) => {
    seen.ws = { url: req.url, headers: req.headers };
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSet-Cookie: sc_session=planted\r\n\r\n');
    socket.on('data', d => socket.write(`${name}:${d}`));
    socket.on('error', () => {});
  });
  return new Promise(r => s.listen(0, '127.0.0.1', () => r({ s, port: s.address().port, seen })));
}
const A = await app('webui'), B = await app('notebook');
// A model server someone started by hand on Spark 4 (the stand-in curl answers /v1/models there for it).
const PV = await new Promise(r => { const x = http.createServer(); x.listen(0, '127.0.0.1', () => { const p = x.address().port; x.close(() => r(p)); }); });
after(() => { for (const x of [A, B]) { x.s.closeAllConnections?.(); x.s.close(); } });

// Two signed-in devices of the owner's: a browser (its cookie) and a terminal (its bearer token), as sign-in made them.
const token = c => `scs_${c.repeat(43)}`;
const BROWSER = token('b'), TERMINAL = token('t'), hash = t => createHash('sha256').update(t).digest('hex');
const now = new Date().toISOString();
const sessions = [
  { id: 'b0b0b0b0b0b0', hash: hash(BROWSER), kind: 'browser', name: 'Phone', login: 'owner@test', via: 'passkey', from: '203.0.113.9', lastFrom: '203.0.113.9', createdAt: now, lastUsedAt: now, passkeyAt: now },
  { id: 'e0e0e0e0e0e0', hash: hash(TERMINAL), kind: 'terminal', name: 'Terminal', login: 'owner@test', via: 'code', from: '203.0.113.9', lastFrom: '203.0.113.9', createdAt: now, lastUsedAt: now },
];
const keys = {};
useFleet({
  prepare: ({ dir, root, stateDir }) => {
    // A fifth Spark, added to the list as the owner adds one; webui runs there (started by hand), notebook on Spark 4.
    const m5 = join(root, 'spark5', '.mock');
    mkdirSync(m5, { recursive: true });
    mkdirSync(join(root, 'spark5', 'models'), { recursive: true });
    copyFileSync(join(root, 'spark4', '.mock', 'meminfo'), join(m5, 'meminfo'));
    writeFileSync(join(m5, 'containers'), 'webui|running|Up 2 hours||||||\n');
    writeFileSync(join(m5, 'ports'), `webui|${A.port}\n`);
    writeFileSync(join(m5, 'image-webui'), 'ghcr.io/open-webui/open-webui:main');
    writeFileSync(join(m5, 'memory-webui'), String(4 * 2 ** 30));
    appendFileSync(join(root, 'spark4', '.mock', 'containers'), 'notebook|running|Up 1 hour||||||\nhand-vllm|running|Up 1 hour||||||\n');
    writeFileSync(join(root, 'spark4', '.mock', 'ports'), `notebook|${B.port}\nhand-vllm|${PV}\n`);
    writeFileSync(join(root, 'spark4', '.mock', `serve-${PV}`), '{"object":"list","data":[{"id":"hand-model","object":"model"}]}');
    writeFileSync(join(root, 'spark4', '.mock', 'image-notebook'), 'quay.io/jupyter/base-notebook:latest');
    writeFileSync(join(root, 'spark4', '.mock', 'memory-notebook'), String(2 * 2 ** 30));
    const access = JSON.parse(readFileSync(join(stateDir, 'access.json'), 'utf8'));
    access.nodes.push({ id: 'spark5', name: 'Spark 5', configured: true, tailnetIp: '100.64.0.5', sshHost: 'test-spark5' });
    writeFileSync(join(stateDir, 'access.json'), JSON.stringify(access), { mode: 0o600 });
    writeFileSync(join(stateDir, 'sessions.json'), JSON.stringify({ sessions }), { mode: 0o600 });
    // The owner ran deploy/open-apps-to-internet.sh: port 10000 of this name goes to the door's socket, with Funnel.
    writeFileSync(join(dir, 'serve.json'), JSON.stringify({ TCP: { 10000: { HTTPS: true } },
      Web: { [DOOR_HOST]: { Handlers: { '/': { Proxy: `unix:${join(stateDir, 'door.sock')}` } } } }, AllowFunnel: { [DOOR_HOST]: true } }));
  },
}, async () => {
  // On the list beside what keep_running puts there: a model; and an "app" on Spark 2, one at the model port and one
  // that is a model server, which keep_running never writes but the door must refuse anyway.
  writeFileSync(join(T.fleet.stateDir, 'desired.json'), JSON.stringify({ revision: 1, revisions: [], running: [
    { spark: 'spark4', container: 'sc-RadixArk--Qwen3.8-27B-NVFP4', model: 'RadixArk--Qwen3.8-27B-NVFP4' },
    { spark: 'spark2', container: 'sneaky', app: true, port: A.port },
    { spark: 'spark3', container: 'at-model-port', app: true, port: T.fleet.servePort },
    { spark: 'spark4', container: 'hand-vllm', app: true, port: PV },
    // (kept as keep_running keeps an app already running: one keep_running call less on a busy laptop)
    { spark: 'spark4', container: 'notebook', app: true, port: B.port, memoryGB: 2 },
  ] }), { mode: 0o600 });
  keys.agent = await createKey('app-door');
});

// One request to the door's socket, as Tailscale serve hands it over: from the internet (Funnel) or the tailnet.
const INTERNET = { 'tailscale-funnel-request': '?1', 'x-forwarded-for': '203.0.113.9' };
const TAILNET = { 'tailscale-user-login': 'owner@test', 'x-forwarded-for': '100.100.7.7' };
const sock = () => join(T.fleet.stateDir, 'door.sock');
function door(path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: sock(), path, method, agent: false, headers: { host: DOOR_HOST, ...headers, ...(body ? { 'content-length': body.length } : {}) } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.setTimeout(60000 * SLOW, () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end(body);
  });
}
// A WebSocket through the door: { status } when refused, else { status: 101, headers, socket, say(text) → reply }.
function ws(path, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: sock(), path, agent: false, headers: { host: DOOR_HOST, connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', ...headers } });
    req.on('response', res => { res.resume(); resolve({ status: res.statusCode }); });
    req.on('upgrade', (res, socket) => {
      socket.on('error', () => {});
      resolve({ status: 101, headers: res.headers, socket, say: text => new Promise(r => { socket.once('data', d => r(String(d))); socket.write(text); }) });
    });
    req.setTimeout(60000 * SLOW, () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end();
  });
}
const cookies = r => [].concat(r.headers['set-cookie'] || []);
const ticketOf = r => /^__Host-sc_door=([A-Za-z0-9_-]{43});/.exec(cookies(r).find(c => c.startsWith('__Host-sc_door=')) || '')?.[1] || null;
const sessionCookie = { cookie: `sc_session=${BROWSER}` };
const withTicket = (t, more = '') => ({ cookie: `${more}__Host-sc_door=${t}` });
const keep = (spark, container) => api('/actions/keep_running', { method: 'POST', body: { spark, container } });

let ticket;
describe('the app door', () => {
  test('keep_running and should_be_running give the door link first, and the tailnet link as "on your tailnet"', async () => {
    const r = await keep('spark5', 'webui');
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.link, openLink('spark5', 'webui'), r.text);
    assert.equal(r.json.tailnetLink, `http://127.0.0.1:${A.port}`);
    assert.match(r.json.note, new RegExp(`It answers at ${openLink('spark5', 'webui').replace(/[.]/g, '\\.')} \\(on your tailnet: http://127\\.0\\.0\\.1:${A.port}\\)`), r.json.note);
    const s = await api('/actions/should_be_running', { method: 'POST', body: {} });
    const x = s.json.running.find(y => y.spark === 'spark5' && y.container === 'webui');
    assert.deepEqual([x?.link, x?.tailnetLink], [openLink('spark5', 'webui'), `http://127.0.0.1:${A.port}`], s.text);
  });

  test('the owner\'s session cookie opens a kept app on the fifth Spark, a WebSocket too; the console\'s cookies never reach it', async () => {
    const o = await door('/console/api/open/spark5/webui', { headers: { ...INTERNET, ...sessionCookie, 'sec-fetch-site': 'same-site' } });
    assert.equal(o.status, 302, o.text);
    assert.equal(o.headers.location, '/');
    const set = cookies(o).find(c => c.startsWith('__Host-sc_door='));
    for (const part of ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax']) assert.ok(set.includes(part), `${part} in ${set}`);
    ticket = ticketOf(o);
    assert.ok(ticket);
    assert.ok(auditLines().some(l => l.action === 'app-opened' && l.args?.spark === 'spark5' && l.args?.container === 'webui' && l.args?.device === 'Phone'));

    const page = await door('/lab?x=1', { headers: { ...INTERNET, ...withTicket(ticket, `app_session=ok; sc_session=${BROWSER}; SC_Other=1; `),
      'x-forwarded-host': 'evil.example', authorization: 'Bearer app-token', origin: DOOR } });
    assert.equal(page.status, 200, page.text);
    assert.equal(page.text, 'webui /lab?x=1 0');
    const h = A.seen.http['/lab?x=1'].headers;
    assert.equal(h.cookie, 'app_session=ok', 'only the app\'s own cookie goes on');
    assert.equal(h.host, DOOR_HOST);
    assert.equal(h['x-forwarded-host'], DOOR_HOST, 'the client\'s X-Forwarded-Host is replaced');
    assert.equal(h['x-forwarded-for'], undefined);
    assert.ok(!Object.keys(h).some(k => k.startsWith('tailscale-')), JSON.stringify(h));
    assert.equal(h.authorization, 'Bearer app-token', 'the app\'s own Authorization goes on');
    // Back: the app's own cookie, never one with the console's or the door's name; no CORS grant.
    assert.deepEqual(cookies(page), ['app_session=ok; Path=/']);
    assert.equal(page.headers['access-control-allow-origin'], undefined);
    assert.equal(page.headers['access-control-allow-credentials'], undefined);
    const redirect = await door('/redirect', { headers: { ...INTERNET, ...withTicket(ticket) } });
    assert.deepEqual([redirect.status, redirect.headers.location], [302, '/lab?x=1'], 'the app\'s own redirect stays on the door');

    const w = await ws('/api/kernels/1/channels', { ...INTERNET, ...withTicket(ticket, `sc_session=${BROWSER}; `), origin: DOOR });
    assert.equal(w.status, 101);
    assert.equal(await w.say('ping'), 'webui:ping');
    assert.equal(A.seen.ws.headers.cookie, undefined, 'no console or door cookie on the WebSocket either');
    assert.equal(w.headers['set-cookie'], undefined);
    w.socket.destroy();

    // A large upload goes through whole.
    const big = Buffer.alloc(5 * 2 ** 20, 7);
    const up = await door('/upload', { method: 'POST', body: big, headers: { ...INTERNET, ...withTicket(ticket), origin: DOOR, 'sec-fetch-site': 'same-origin' } });
    assert.equal(up.text, `webui /upload ${big.length}`);
  });

  test('one browser shows one app at a time: opening another switches it', async () => {
    const o = await door('/console/api/open/spark4/notebook', { headers: TAILNET });
    assert.equal(o.status, 302, o.text);
    const t = ticketOf(o);
    assert.equal((await door('/', { headers: { ...TAILNET, ...withTicket(t) } })).text, 'notebook / 0');
    assert.equal((await door('/', { headers: { ...INTERNET, ...withTicket(t) } })).status, 401, 'a ticket opened on the tailnet is nothing from the internet');
  });

  test('an app answering with a status Node can\'t pass on gets a 502, and Spark Console stays up', async () => {
    const r = await door('/boom', { headers: { ...INTERNET, ...withTicket(ticket) } });
    assert.equal(r.status, 502, r.text);
    assert.match(r.text, /webui on Spark 5 answered with something the app door can’t pass on/);
    await sleep(1000 * SLOW);
    assert.equal(T.fleet.serviceExit(), null, 'Spark Console didn\'t end');
    assert.equal((await api('/health')).status, 200);
    assert.equal((await door('/', { headers: { ...INTERNET, ...withTicket(ticket) } })).text, 'webui / 0', 'the app still opens');
  });

  test('an app can\'t leave a service worker or its cache behind: no worker script, no Service-Worker-Allowed; opening clears the cache', async () => {
    const sw = await door('/sw.js', { headers: { ...INTERNET, ...withTicket(ticket), 'service-worker': 'script' } });
    assert.equal(sw.status, 403, sw.text);
    assert.equal(A.seen.http['/sw.js'], undefined, 'never reached the app');
    const page = await door('/page', { headers: { ...INTERNET, ...withTicket(ticket) } });
    assert.equal(page.text, 'webui /page 0');
    assert.equal(page.headers['service-worker-allowed'], undefined);
    const o = await door('/console/api/open/spark5/webui', { headers: TAILNET });
    assert.equal(o.status, 302, o.text);
    assert.equal(o.headers['clear-site-data'], '"cache"', 'the cache only: never cookies or storage');
  });

  test('opening a second app while the first is in use asks first; "Switch anyway" switches and closes the first app\'s WebSockets', async () => {
    const browser = { ...INTERNET, 'sec-fetch-site': 'same-site' };
    const tA = ticketOf(await door('/console/api/open/spark5/webui', { headers: { ...browser, ...sessionCookie } }));
    assert.ok(tA);
    // Tab 1: the first app with a WebSocket open (a kernel, a terminal).
    const w = await ws('/api/kernels/1/channels', { ...INTERNET, ...withTicket(tA), origin: DOOR });
    assert.equal(w.status, 101);
    const closed = new Promise(r => w.socket.once('close', () => r(true)));
    // Tab 2 opens the second app; the browser sends the door cookie it holds.
    const both = t => ({ cookie: `sc_session=${BROWSER}; __Host-sc_door=${t}` });
    const ask = await door('/console/api/open/spark4/notebook', { headers: { ...browser, ...both(tA) } });
    assert.equal(ask.status, 409, ask.text);
    assert.equal(ticketOf(ask), null, 'not switched yet');
    assert.match(ask.text, /webui on Spark 5 is open in this browser\. Opening notebook on Spark 4 switches this browser to it: the other tab stops working, and anything it still saves would go to notebook on Spark 4\. Close that tab first\./);
    assert.equal(await w.say('ping'), 'webui:ping', 'the first app still works');
    assert.equal((await door('/', { headers: { ...INTERNET, ...withTicket(tA) } })).text, 'webui / 0');
    const action = /<form method="get" action="([^"]+)">/.exec(ask.text)?.[1], word = /name="switch" value="([A-Za-z0-9_-]{43})"/.exec(ask.text)?.[1];
    assert.deepEqual([action, Boolean(word)], ['/console/api/open/spark4/notebook', true], ask.text);
    // An app's own page can't switch it without the word; the button on the door's page does, once.
    const fromDoor = { ...INTERNET, 'sec-fetch-site': 'same-origin' };
    assert.equal((await door(action, { headers: { ...fromDoor, ...both(tA) } })).status, 403);
    const sw = await door(`${action}?switch=${word}`, { headers: { ...fromDoor, ...both(tA) } });
    assert.equal(sw.status, 302, sw.text);
    const tB = ticketOf(sw);
    assert.ok(tB);
    assert.ok(await Promise.race([closed, sleep(10000 * SLOW).then(() => false)]), 'the first app\'s WebSocket closed with the switch');
    assert.equal((await door('/', { headers: { ...INTERNET, ...withTicket(tB) } })).text, 'notebook / 0');
    assert.equal((await door('/', { headers: { ...INTERNET, ...withTicket(tA) } })).status, 401, 'the first ticket is gone');
    assert.equal((await door(`${action}?switch=${word}`, { headers: { ...fromDoor, ...both(tB) } })).status, 403, 'the word works once');
    // The same app again doesn't ask.
    assert.equal((await door('/console/api/open/spark4/notebook', { headers: { ...browser, ...both(tB) } })).status, 302);
  });

  test('not signed in, a member, an agent key, a terminal or a Spark\'s own program: refused, HTTP and WebSocket alike', async () => {
    // (on the tailnet, Tailscale's identity decides even beside the owner's door ticket; from the internet, a ticket is
    // the owner's, so these come without one)
    const refused = async (headers, [open, page], what, { owners = false } = {}) => {
      const o = await door('/console/api/open/spark5/webui', { headers });
      assert.equal(o.status, open, `${what}: open → ${o.status} ${o.text}`);
      assert.equal(ticketOf(o), null, `${what}: no ticket`);
      const h = owners ? { ...headers, ...withTicket(ticket) } : headers;
      const p = await door('/', { headers: h });
      assert.equal(p.status, page, `${what}: page → ${p.status}`);
      assert.doesNotMatch(p.text, /webui/, what);
      const w = await ws('/ws', { ...h, origin: DOOR });
      assert.equal(w.status, page, `${what}: WebSocket`);
      return o;
    };
    const anon = await refused({ 'tailscale-funnel-request': '?1', 'x-forwarded-for': '203.0.113.50' }, [401, 401], 'not signed in');
    // The page: one sentence and the main address's sign-in, nothing else.
    assert.match(anon.text, /Sign in to Spark Console/);
    assert.deepEqual([...anon.text.matchAll(/href="([^"]+)"/g)].map(x => x[1]), [`${MAIN}/`]);
    assert.equal((await door('/', { headers: { 'tailscale-funnel-request': '?1' } })).status, 401, 'no ticket, no session');
    await refused({ 'tailscale-user-login': 'member@test', 'x-forwarded-for': '100.100.8.8' }, [403, 403], 'a member', { owners: true });
    await refused({ ...INTERNET, authorization: `Bearer ${keys.agent.token}` }, [401, 401], 'an agent key');
    await refused({ ...INTERNET, authorization: `Bearer ${TERMINAL}` }, [403, 401], 'a terminal signed in from the internet');
    await refused({ ...TAILNET, 'x-forwarded-for': '100.64.0.3' }, [403, 403], 'a program on Spark 3', { owners: true });
    // A made-up ticket is nothing, even beside a real one under a longer path, which still works.
    assert.equal((await door('/', { headers: { ...INTERNET, cookie: `__Host-sc_door=${'A'.repeat(43)}` } })).status, 401);
    assert.equal((await door('/', { headers: { ...INTERNET, cookie: `__Host-sc_door=${'A'.repeat(43)}; __Host-sc_door=${ticket}` } })).status, 200);
  });

  test('only a kept app on a Spark that isn\'t the brain\'s opens: never a model, Spark 2, the model port, an unknown name or a port', async () => {
    for (const [path, what] of [
      ['/console/api/open/spark4/sc-RadixArk--Qwen3.8-27B-NVFP4', 'a model'],
      ['/console/api/open/spark2/sneaky', 'Spark 2'],
      ['/console/api/open/spark3/at-model-port', 'the model port'],
      ['/console/api/open/spark4/hand-vllm', 'a model server started by hand'],
      ['/console/api/open/spark3/nope', 'an unknown name'],
      ['/console/api/open/spark9/webui', 'an unknown Spark'],
      ['/console/api/open/spark5/webui:9000', 'a port in the name'],
      ['/console/api/open/spark5/webui/9000', 'a port after the name'],
      ['/console/api/open/spark5/127.0.0.1:22', 'an address'],
      ['/console/api/open/spark5/%2e%2e', 'an encoded name'],
    ]) {
      const r = await door(path, { headers: { ...INTERNET, ...sessionCookie } });
      assert.ok(r.status >= 400 && r.status < 500, `${what}: ${r.status} ${r.text}`);
      assert.equal(ticketOf(r), null, what);
    }
    // Opened from an app's own page (it would switch this browser to another app and read it), or from another site.
    for (const site of ['same-origin', 'cross-site']) {
      const r = await door('/console/api/open/spark5/webui', { headers: { ...INTERNET, ...sessionCookie, 'sec-fetch-site': site } });
      assert.equal(r.status, 403, site);
      assert.equal(ticketOf(r), null, site);
    }
    // The door's own paths are never passed to the app.
    const own = await door('/console/api/health', { headers: { ...INTERNET, ...withTicket(ticket) } });
    assert.equal(own.status, 404);
    assert.doesNotMatch(own.text, /webui/);
  });

  test('a page on another port or site can\'t post to the app as the owner, nor open its WebSocket', async () => {
    for (const [origin, site] of [[MAIN, 'same-site'], ['https://evil.example', 'cross-site']]) {
      const r = await door('/api/contents', { method: 'POST', body: Buffer.from('{}'), headers: { ...INTERNET, ...withTicket(ticket), origin, 'sec-fetch-site': site } });
      assert.equal(r.status, 403, `${origin}: ${r.text}`);
      assert.equal((await ws('/ws', { ...INTERNET, ...withTicket(ticket), origin })).status, 403, `${origin} WebSocket`);
    }
  });

  test('a request from the door\'s origin can\'t use the main API, not even to read', async () => {
    const post = await api('/chats', { method: 'POST', body: {}, headers: { origin: DOOR } });
    assert.equal(post.status, 403, post.text);
    const read = await api('/status', { headers: { origin: DOOR } });
    assert.equal(read.status, 403, read.text);
    assert.equal((await api('/status', { headers: { origin: MAIN } })).status, 200, 'the console\'s own page still reads');
  });

  test('signing the device out closes its app connections and its ticket; a forgotten app no longer opens', async () => {
    const w = await ws('/ws', { ...INTERNET, ...withTicket(ticket), origin: DOOR });
    assert.equal(w.status, 101);
    const closed = new Promise(r => w.socket.once('close', () => r(true)));
    assert.equal((await api('/auth/sessions/b0b0b0b0b0b0', { method: 'DELETE' })).status, 200);
    assert.ok(await Promise.race([closed, sleep(15000 * SLOW).then(() => false)]), 'the app WebSocket closed with the sign-out');
    assert.equal((await door('/', { headers: { ...INTERNET, ...withTicket(ticket) } })).status, 401);
    // On the tailnet: opened, then forgotten.
    const t = ticketOf(await door('/console/api/open/spark5/webui', { headers: TAILNET }));
    assert.equal((await door('/', { headers: { ...TAILNET, ...withTicket(t) } })).status, 200);
    assert.equal((await api('/desired/forget', { method: 'POST', body: { spark: 'spark5', container: 'webui' } })).status, 200);
    assert.equal((await door('/', { headers: { ...TAILNET, ...withTicket(t) } })).status, 404);
  });
});

// deploy/open-apps-to-internet.sh, the owner's own script, against a stand-in `tailscale` that keeps a serve config the
// way tailscaled does (443 and 8443 already in use, as on Spark 2) and a stand-in `ssh` that runs the Spark 2 half here.
// Its door check asks this file's real app door, through the folder the script looks in.
describe('open-apps-to-internet.sh', () => {
  const FAKE_TAILSCALE = `#!/usr/bin/env node
const fs = require('fs'), f = process.env.HOME + '/serve.json', a = process.argv.slice(2);
fs.appendFileSync(process.env.HOME + '/calls', a.join(' ') + '\\n');
const cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
if (a[0] === 'serve' && a[1] === 'status') { console.log(a[2] === '--json' ? JSON.stringify(cfg) : 'status'); process.exit(0); }
const port = (a.find(x => x.startsWith('--https=')) || '').slice(8), path = (a.find(x => x.startsWith('--set-path=')) || '').slice(11), hp = 'akspark2.tailab9aa9.ts.net:' + port;
if (!port || !path) process.exit(1);
for (const k of ['TCP', 'Web', 'AllowFunnel']) cfg[k] ||= {};
if (a[a.length - 1] === 'off') {
  delete cfg.Web[hp]?.Handlers?.[path];
  if (!Object.keys(cfg.Web[hp]?.Handlers || {}).length) { delete cfg.Web[hp]; delete cfg.TCP[port]; delete cfg.AllowFunnel[hp]; }
} else {
  cfg.TCP[port] = { HTTPS: true };
  cfg.Web[hp] = { Handlers: { ...(cfg.Web[hp]?.Handlers || {}), [path]: { Proxy: a[a.length - 1] } } };
  if (a[0] === 'funnel') cfg.AllowFunnel[hp] = true; else delete cfg.AllowFunnel[hp];
}
fs.writeFileSync(f, JSON.stringify(cfg));
`;
  const START = { TCP: { 443: { HTTPS: true }, 8443: { HTTPS: true } },
    Web: { 'akspark2.tailab9aa9.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:3000' } } },
      'akspark2.tailab9aa9.ts.net:8443': { Handlers: { '/': { Path: '/home/x/spark-console' }, '/console/api': { Proxy: 'unix:/home/x/.local/state/spark-console/api.sock' } } } },
    AllowFunnel: { 'akspark2.tailab9aa9.ts.net:443': true, 'akspark2.tailab9aa9.ts.net:8443': true } };
  let h;
  const homes = [];
  // (a short folder name: the socket's path, through it, stays under the 104 characters macOS allows)
  const setup = (cfg = START, { socket = true } = {}) => {
    h = mkdtempSync(join(tmpdir(), 'sca-'));
    homes.push(h);
    const bin = join(h, 'bin'), st = join(h, '.local', 'state', 'spark-console');
    mkdirSync(bin); mkdirSync(st, { recursive: true });
    writeFileSync(join(bin, 'tailscale'), FAKE_TAILSCALE, { mode: 0o755 });
    writeFileSync(join(bin, 'ssh'), '#!/bin/bash\n[ "$1" = -t ] && shift\nshift\nexec bash -c "$1"\n', { mode: 0o755 });
    writeFileSync(join(bin, 'sudo'), '#!/bin/bash\necho "sudo $*" >> "$HOME/calls"\nexit 1\n', { mode: 0o755 });
    writeFileSync(join(h, 'serve.json'), JSON.stringify(cfg));
    if (socket) symlinkSync(sock(), join(st, 'door.sock'));
  };
  after(() => { for (const x of homes) rmSync(x, { recursive: true, force: true }); });
  // (spawned, not spawnSync: the script's door check asks this process's fleet)
  const run = (...args) => new Promise(resolve => {
    const c = spawn('bash', [join(REPO, 'deploy', 'open-apps-to-internet.sh'), ...args], { env: { PATH: `${join(h, 'bin')}:${process.env.PATH}`, HOME: h } });
    let out = '', err = '';
    c.stdout.on('data', d => { out += d; });
    c.stderr.on('data', d => { err += d; });
    c.on('close', status => resolve({ status, out, err }));
  });
  const cfg = () => JSON.parse(readFileSync(join(h, 'serve.json'), 'utf8'));
  const calls = () => (existsSync(join(h, 'calls')) ? readFileSync(join(h, 'calls'), 'utf8').trim().split('\n') : []);
  const writes = () => calls().filter(c => !c.startsWith('serve status'));
  const notDoor = c => JSON.stringify([c.TCP[443], c.TCP[8443], c.Web['akspark2.tailab9aa9.ts.net:443'], c.Web['akspark2.tailab9aa9.ts.net:8443'],
    c.AllowFunnel['akspark2.tailab9aa9.ts.net:443'], c.AllowFunnel['akspark2.tailab9aa9.ts.net:8443']]);

  test('opens port 10000 alone to the app door with Funnel; again changes nothing; --undo closes only it, twice too', async () => {
    setup();
    const door = `unix:${join(h, '.local', 'state', 'spark-console', 'door.sock')}`;
    let r = await run();
    assert.equal(r.status, 0, r.err + r.out);
    assert.deepEqual(cfg().Web['akspark2.tailab9aa9.ts.net:10000'], { Handlers: { '/': { Proxy: door } } });
    assert.deepEqual([cfg().TCP[10000], cfg().AllowFunnel['akspark2.tailab9aa9.ts.net:10000']], [{ HTTPS: true }, true]);
    assert.equal(notDoor(cfg()), notDoor(START), '443 and 8443 untouched');
    assert.deepEqual(writes(), [`funnel --bg --https=10000 --set-path=/ ${door}`]);
    r = await run();
    assert.equal(r.status, 0, r.err);
    assert.match(r.out, /already open: nothing changed/);
    assert.equal(writes().length, 1, 'nothing written the second time');
    r = await run('--undo');
    assert.equal(r.status, 0, r.err + r.out);
    assert.deepEqual(cfg(), START, 'back as it was');
    assert.deepEqual(writes().slice(1), [`serve --bg --https=10000 --set-path=/ ${door}`, 'serve --https=10000 --set-path=/ off']);
    r = await run('--undo');
    assert.equal(r.status, 0, r.err);
    assert.match(r.out, /already closed: nothing changed/);
    assert.equal(writes().length, 3);
    // Never a plain off, never another port, never sudo (the stand-in never needs it).
    assert.ok(writes().every(c => c.includes('--https=10000')), writes().join('\n'));
  });

  test('refuses when port 10000 serves something else, or the door isn\'t installed; changes nothing', async () => {
    const taken = { ...START, TCP: { ...START.TCP, 10000: { HTTPS: true } }, Web: { ...START.Web, 'akspark2.tailab9aa9.ts.net:10000': { Handlers: { '/': { Proxy: 'http://127.0.0.1:9999' } } } } };
    setup(taken);
    for (const args of [[], ['--undo']]) {
      const r = await run(...args);
      assert.equal(r.status, 1, `${args}: ${r.out}`);
      assert.match(r.err, /STOP: port 10000 (already )?serves something/);
      assert.deepEqual(cfg(), taken);
    }
    const tcp = { ...START, TCP: { ...START.TCP, 10000: { TCPForward: '127.0.0.1:22' } } };
    setup(tcp);
    assert.equal((await run()).status, 1, 'a TCP forward on 10000');
    assert.deepEqual(cfg(), tcp);
    setup(START, { socket: false });
    const r = await run();
    assert.equal(r.status, 1);
    assert.match(r.err, /door\.sock isn’t there|door\.sock isn't there/);
    assert.deepEqual(cfg(), START);
    assert.deepEqual(writes(), []);
  });
});
