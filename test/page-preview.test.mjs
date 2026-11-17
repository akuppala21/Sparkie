// Covers: tools/page-preview.mjs, the page preview: public/ served against the stand-in console, as Tailscale serves it
// on Spark 2. Started twice side by side: as the owner on the repo's public/ (stopped with Ctrl-C), and as a visitor
// from the internet on a copy of public/ that holds links out of it (stopped by ending what started it). Each start
// runs its own stand-in fleet with TMPDIR set to a folder of its own, so its leftovers can be looked for.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync, cpSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, OWNER, SLOW, sseEvents } from './lib.mjs';

const TOOL = join(REPO, 'tools', 'page-preview.mjs');
const PAGE = f => readFileSync(join(REPO, 'public', f));
// What only service/server.mjs holds: a refusal must never answer with it.
const SECRET = readFileSync(join(REPO, 'service', 'server.mjs'), 'utf8').split('\n').find(l => l.length > 40).slice(0, 40);
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Starts a process from a script given on the command line that runs the preview and stays while it runs; killed itself,
// it leaves the preview running without a parent: what a closed terminal tab or a test that ends does.
const MIDDLE = `const c = require('node:child_process').spawn(process.execPath, process.argv.slice(1), { stdio: 'inherit' });
console.error('preview pid ' + c.pid); c.on('exit', code => process.exit(code ?? 1));`;
// Every process started here, so none outlives a failed start.
const started = new Set();

// One request with its path sent exactly as given (no ../ tidied away). Resolves { status, headers, body (Buffer), text }.
function raw(port, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers, agent: false }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { const b = Buffer.concat(chunks); resolve({ status: res.statusCode, headers: res.headers, body: b, text: b.toString('utf8') }); });
      res.on('error', reject);
    });
    req.setTimeout(120000 * SLOW, () => req.destroy(new Error(`${path} timed out`)));
    req.on('error', reject);
    req.end(body);
  });
}
const json = async (...a) => { const r = await raw(...a); return { ...r, json: JSON.parse(r.text) }; };

// A process that is still there, not one that has ended and waits to be reaped (a zombie).
function alive(pid) {
  try { process.kill(pid, 0); } catch (e) { return e.code === 'EPERM'; }
  try { return readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^.*\) /s, '')[0] !== 'Z'; } catch {}
  try { return !/Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })); } catch { return false; }
}
// The live processes in a process group.
function inGroup(pgid) {
  if (existsSync('/proc/self/stat')) {
    return readdirSync('/proc').filter(d => /^\d+$/.test(d)).filter(d => {
      try { const f = readFileSync(`/proc/${d}/stat`, 'utf8').replace(/^.*\) /s, '').split(' '); return f[0] !== 'Z' && Number(f[2]) === pgid; } catch { return false; }
    }).map(Number);
  }
  return execFileSync('ps', ['-A', '-o', 'pid=,pgid=,stat='], { encoding: 'utf8' }).trim().split('\n').map(l => l.trim().split(/\s+/))
    .filter(([, g, st]) => Number(g) === pgid && !/Z/.test(st)).map(([p]) => Number(p));
}
async function gone(what, fn, ms = 30000 * SLOW) {
  for (const end = Date.now() + ms; !fn();) { if (Date.now() > end) assert.fail(`${what} is still there after ${ms / 1000} s`); await sleep(250); }
}

// Starts the preview on a free port (directly, or through MIDDLE) and waits for its one line on stdout.
async function startPreview(args, { middle = false } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'page-preview-'));
  const env = { ...process.env, TMPDIR: tmp };
  delete env.NODE_TEST_CONTEXT;
  const argv = [TOOL, '--port', '0', ...args];
  const child = spawn(process.execPath, middle ? ['-e', MIDDLE, ...argv] : argv, { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const p = { child, tmp, out: '', err: '' };
  started.add(p);
  child.stdout.on('data', d => { p.out += d; });
  child.stderr.on('data', d => { p.err += d; });
  const m = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ready line within ${300 * SLOW} s:\n${p.out}\n${p.err}`)), 300000 * SLOW);
    const look = () => { const r = /^Page preview: http:\/\/127\.0\.0\.1:(\d+)\/$/m.exec(p.out); if (r) { clearTimeout(timer); resolve(r); } };
    child.stdout.on('data', look);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`it ended (${code}) before its ready line:\n${p.err}`)); });
  });
  const f = /^Stand-in fleet: (\S+) \(process group (\d+)\)$/m.exec(p.err);
  assert.ok(f, `it names its fleet on stderr:\n${p.err}`);
  Object.assign(p, { port: Number(m[1]), url: `http://127.0.0.1:${m[1]}`, dir: f[1], pgid: Number(f[2]) });
  p.pids = Object.values(JSON.parse(readFileSync(join(p.dir, 'pids.json'), 'utf8')));
  p.tool = middle ? Number(/^preview pid (\d+)$/m.exec(p.err)?.[1]) : child.pid;
  return p;
}
// After the tests, or a start that failed: whatever is still running is stopped.
async function stopAll() {
  for (const p of started) {
    const tool = p.tool || Number(/^preview pid (\d+)$/m.exec(p.err)?.[1]);
    if (tool && alive(tool)) try { process.kill(tool, 'SIGINT'); } catch {}
    if (p.child.exitCode === null && p.child.signalCode === null) p.child.kill('SIGINT');
  }
  await sleep(3000);
  for (const p of started) {
    if (p.child.exitCode === null && p.child.signalCode === null) p.child.kill('SIGKILL');
    rmSync(p.tmp, { recursive: true, force: true });
  }
}
async function cleanedUp(p) {
  await gone('the preview', () => !alive(p.tool));
  await gone('the fleet’s folder', () => !existsSync(p.dir));
  assert.deepEqual(readdirSync(p.tmp).filter(f => f.startsWith('sct-')), [], 'no stand-in fleet folder left');
  await gone('a process of the fleet', () => !p.pids.some(alive) && !inGroup(p.pgid).length);
}

const P = {};
let linkCopy;
describe('the page preview', { concurrency: 1 }, () => {
  before(async () => {
    // The internet face serves a copy of the page holding a link to a file outside it and a linked folder.
    linkCopy = mkdtempSync(join(tmpdir(), 'page-copy-'));
    cpSync(join(REPO, 'public'), linkCopy, { recursive: true });
    symlinkSync(join(REPO, 'service', 'server.mjs'), join(linkCopy, 'outside.mjs'));
    symlinkSync(join(REPO, 'service'), join(linkCopy, 'linked'));
    [P.owner, P.public] = await Promise.all([startPreview([]), startPreview(['--as', 'public', '--public', linkCopy], { middle: true })]);
  }, { timeout: 330000 * SLOW });
  after(async () => {
    await stopAll();
    if (linkCopy) rmSync(linkCopy, { recursive: true, force: true });
  });

  test('/ and /console/ answer with the page’s index.html; app.js and styles.css with their content types; nothing is cached', async () => {
    for (const p of [P.owner, P.public]) {
      for (const at of ['/', '/console/']) {
        const r = await raw(p.port, at);
        assert.equal(r.status, 200, at);
        assert.ok(r.body.equals(PAGE('index.html')), `${at} is index.html`);
        assert.equal(r.headers['content-type'], 'text/html; charset=utf-8');
        assert.equal(r.headers['cache-control'], 'no-store');
        for (const [f, type] of [['app.js', 'text/javascript; charset=utf-8'], ['styles.css', 'text/css; charset=utf-8'], ['favicon.svg', 'image/svg+xml'], ['manifest.webmanifest', 'application/manifest+json']]) {
          const x = await raw(p.port, `${at}${f}`);
          assert.equal(x.status, 200, `${at}${f}`);
          assert.equal(x.headers['content-type'], type, f);
          assert.equal(x.headers['cache-control'], 'no-store', f);
          assert.ok(x.body.equals(PAGE(f)), `${at}${f} is public/${f}`);
        }
      }
      const bare = await raw(p.port, '/console');
      assert.deepEqual([bare.status, bare.headers.location], [301, '/console/']);
    }
  });

  test('the first read at boot answers as the owner through the proxy; a browser’s own Tailscale headers are dropped', async () => {
    const r = await json(P.owner.port, '/console/api/bootstrap');
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.json.viewer.login, r.json.viewer.role], [OWNER, 'owner']);
    for (const h of [{ 'tailscale-user-login': 'member@test' }, { 'tailscale-funnel-request': '?1' }, { 'x-forwarded-for': '100.64.0.3' }]) {
      const x = await json(P.owner.port, '/console/api/bootstrap', { headers: h });
      assert.equal(x.status, 200, `${JSON.stringify(h)}: ${x.text}`);
      assert.equal(x.json.viewer.login, OWNER, JSON.stringify(h));
    }
    const who = await json(P.owner.port, '/console/api/whoami');
    assert.deepEqual([who.json.access, who.json.via], ['owner', 'tailnet']);
  });

  test('bootstrap names the configured hub and compute Sparks; a stale saved public address does not replace its origin', async () => {
    const config = JSON.parse(readFileSync(join(P.owner.dir, 'config.json'), 'utf8'));
    const hub = config.nodes.find(n => n.host === 'local').id;
    const boot = (await json(P.owner.port, '/console/api/bootstrap')).json;
    const connections = (await json(P.owner.port, '/console/api/connections')).json;
    assert.equal(boot.hubId, hub);
    assert.ok(!boot.computeIds.includes(hub));
    assert.ok(boot.computeIds.length > 0);
    for (const id of boot.computeIds) assert.ok(config.nodes.some(n => n.id === id));
    const saved = JSON.parse(readFileSync(join(P.owner.dir, 'state', 'access.json'), 'utf8'));
    assert.notEqual(`https://${saved.publicHost}/`, `${config.origin}/`, 'fixture has a saved address from before migration');
    assert.equal(connections.portalUrl, `${config.origin.replace(/\/$/, '')}/`);
  });

  test('with --as public the same read answers as the public face: not signed in, from the internet; the public fleet answers', async () => {
    const r = await json(P.public.port, '/console/api/bootstrap', { headers: { 'tailscale-user-login': OWNER } });
    assert.equal(r.status, 401, r.text);
    const who = await json(P.public.port, '/console/api/whoami');
    assert.equal(who.status, 200);
    assert.deepEqual([who.json.login, who.json.access, who.json.via], [null, 'none', 'internet']);
    const fleet = await json(P.public.port, '/console/api/public/fleet');
    assert.equal(fleet.status, 200, fleet.text);
    assert.deepEqual(fleet.json.sparks.map(s => s.id), ['spark1', 'spark2', 'spark3', 'spark4']);
  });

  test('what was seeded: one chat with a tool call, a pressed button whose operation finished, an open button, and /status with the needs-you line', async () => {
    const chats = (await json(P.owner.port, '/console/api/chats')).json.chats;
    assert.equal(chats.length, 1, JSON.stringify(chats));
    const msgs = (await json(P.owner.port, `/console/api/chats/${chats[0].id}`)).json.messages;
    const said = JSON.stringify(msgs.map(m => [m.role, m.content.slice(0, 80), m.choices?.map(c => c.state)]));
    assert.ok(msgs.some(m => m.tools?.some(t => t.name === 'fleet_status')), said);
    assert.ok(msgs.some(m => m.choices?.some(c => c.state === 'picked')), `a pressed button: ${said}`);
    assert.ok(msgs.some(m => m.choices?.some(c => c.state === 'open')), `an open button: ${said}`);
    assert.ok(msgs.some(m => m.notice && /^Done: /.test(m.content)), `the operation's result: ${said}`);
    assert.ok(msgs.some(m => /^\/status\n[\s\S]*Needs you:\n- Spark 2 has [\d.]+ GB of disk left/.test(m.content)), `/status with the needs-you line: ${said}`);
    const jobs = (await json(P.owner.port, '/console/api/jobs')).json.jobs;
    assert.ok(jobs.some(j => j.status === 'completed'), JSON.stringify(jobs.map(j => [j.kind, j.status])));
  });

  test('a chat turn through the proxy streams its events as they come (not held back to the end), with one tool call and the stand-in’s reply', { timeout: 120000 * SLOW }, async () => {
    const page = { 'content-type': 'application/json', 'x-spark-console': '1', origin: P.owner.url };
    const made = await json(P.owner.port, '/console/api/chats', { method: 'POST', headers: page, body: '{}' });
    assert.equal(made.status, 201, `the page's own Origin is let through as the configured one: ${made.text}`);
    const elsewhere = await raw(P.owner.port, '/console/api/chats', { method: 'POST', headers: { ...page, origin: 'https://evil.example' }, body: '{}' });
    assert.equal(elsewhere.status, 403, 'another site is still refused');
    const seen = [];
    const end = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: P.owner.port, path: `/console/api/chats/${made.json.id}/messages`, method: 'POST', headers: page, agent: false }, res => {
        assert.equal(res.statusCode, 200);
        assert.match(res.headers['content-type'], /^text\/event-stream/);
        let text = '';
        res.on('data', c => { text += c; seen.push([Date.now(), String(c)]); });
        res.on('end', () => resolve({ at: Date.now(), text }));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.end(JSON.stringify({ text: 'take 3 seconds, then tell me about the Sparks' }));
    });
    const first = seen.find(([, c]) => c.includes('"type":"started"'));
    assert.ok(first, end.text.slice(0, 300));
    assert.ok(end.at - first[0] >= 2000, `“started” came ${end.at - first[0]} ms before the end: the stream was held back`);
    const events = sseEvents(end.text);
    assert.deepEqual(events.filter(e => e.type === 'tool').map(e => e.name), ['fleet_status']);
    assert.match(events.find(e => e.type === 'done').message.content, /^I checked\. fleet_status said: /);
  });

  test('nothing outside the page’s folder: ../ however spelled, a link to a file, a linked folder', async () => {
    const tries = ['/../service/server.mjs', '/console/../service/server.mjs', '/%2e%2e/service/server.mjs', '/%2E%2E%2Fservice%2Fserver.mjs',
      '/console/%2e%2e%2f%2e%2e%2fservice/server.mjs', '/..%5cservice%5cserver.mjs', '/console/api/../../service/server.mjs', '/./app.js', '/.git/config'];
    for (const p of [P.owner, P.public]) {
      for (const path of [...tries, ...(p === P.public ? ['/outside.mjs', '/console/outside.mjs', '/linked/server.mjs', '/%6cinked/server.mjs'] : [])]) {
        const r = await raw(p.port, path);
        assert.ok([400, 403, 404].includes(r.status), `${path}: ${r.status}`);
        assert.ok(!r.text.includes(SECRET), `${path} gave server.mjs`);
      }
    }
    assert.equal((await raw(P.public.port, '/app.js')).status, 200, 'the copy itself is served');
  });

  test('it listens on 127.0.0.1 only, and refuses any other address it is asked for', async () => {
    const others = Object.values(networkInterfaces()).flat().filter(a => !a.internal).map(a => a.address);
    for (const host of ['::1', ...(process.platform === 'linux' ? ['127.0.0.2'] : []), ...others]) {
      const ok = await new Promise(resolve => {
        const s = net.connect({ host, port: P.owner.port, timeout: 3000 }, () => { s.destroy(); resolve(true); });
        s.on('error', () => resolve(false));
        s.on('timeout', () => { s.destroy(); resolve(false); });
      });
      assert.equal(ok, false, `answered on ${host}`);
    }
    const tmp = mkdtempSync(join(tmpdir(), 'page-preview-'));
    try {
      for (const host of ['0.0.0.0', '::', '192.168.1.10', 'localhost']) {
        const r = spawnSync(process.execPath, [TOOL, '--port', '0', '--host', host], { env: { ...process.env, TMPDIR: tmp, NODE_TEST_CONTEXT: '' }, encoding: 'utf8', timeout: 30000 * SLOW });
        assert.equal(r.status, 2, `--host ${host}: ${r.stderr}`);
        assert.match(r.stderr, /listens on 127\.0\.0\.1 only/);
      }
      assert.deepEqual(readdirSync(tmp), [], 'no stand-in fleet was started');
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });

  test('stopped with Ctrl-C, or when what started it goes away: its fleet’s folder is gone and no process of it is left', { timeout: 90000 * SLOW }, async () => {
    P.owner.child.kill('SIGINT');
    // (MIDDLE keeps the internet face's preview; killing MIDDLE is its parent going away)
    P.public.child.kill('SIGKILL');
    await Promise.all([cleanedUp(P.owner), cleanedUp(P.public)]);
    assert.equal(P.owner.child.exitCode, 0, P.owner.err);
  });
});
