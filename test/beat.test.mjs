// Covers: The outside heartbeat (20-beat.mjs; R32; docs/design-2026-11-13/e-unattended.md 2.4 and build step 1). Once
// the owner has saved a check's address (https://hc-ping.com/<uuid>) with the passkey, Spark Console sends one bodiless
// GET to it each interval: none before, none from a second copy, none after it is removed (no passkey for that). The
// address is in no chat, audit line, event, log, state file or answer; an address on another host is refused; the
// request carries no body, no cookie and no header that names this fleet, and a redirect is never followed. A beat
// failing for the late time is one needs-you line. The service beats a stand-in on 127.0.0.1 (SPARK_CONSOLE_BEAT_API,
// honoured only under SPARK_CONSOLE_ALL_LOCAL=1); no real host is ever contacted.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, cpSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { T, REPO, MEMBER, SERVICE_FILE, useFleet, api, sleep, waitFor, auditLines, eventLines, createKey, call, newChat, say, chatMessages, SLOW } from './lib.mjs';
import { serviceConfig } from './start-mock.mjs';
import { Authenticator, passkeyHeader } from './authenticator.mjs';

const MAIN_ORIGIN = serviceConfig().origin, TAILNET = new URL(MAIN_ORIGIN).hostname.split('.').slice(1).join('.');
const KEY = new Authenticator(TAILNET, MAIN_ORIGIN);
const ID = '3f1c9a2e-5b7d-4e8f-9a1b-2c3d4e5f6a7b', ADDRESS = `https://hc-ping.com/${ID}`;
// How often it beats here (5 minutes for real), how long beats fail before the needs-you line (an hour for real), and
// how long after a start the first beat waits (a minute for real).
const EVERY = 1500, LATE = 4500, FIRST = 5000;

// A stand-in for hc-ping.com: it keeps each request as it arrived (method, path, the headers in order and as written,
// the body) and answers as the test sets it.
function standIn() {
  const got = [];
  let status = 200, location = null;
  const server = http.createServer((req, res) => {
    const body = [];
    req.on('data', c => body.push(c));
    req.on('end', () => {
      got.push({ at: Date.now(), method: req.method, url: req.url, version: req.httpVersion, rawHeaders: req.rawHeaders, body: Buffer.concat(body).toString('latin1') });
      res.writeHead(status, location ? { location } : {});
      res.end(status === 200 ? 'OK' : '');
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    got, server, port: server.address().port, base: `http://127.0.0.1:${server.address().port}`,
    answer: (s, l = null) => { status = s; location = l; },
  })));
}
// HC is the check's host; ELSEWHERE is where a redirect points and where a second copy would beat; RESTARTED is what
// consoles started beside this one beat.
const HC = await standIn(), ELSEWHERE = await standIn(), RESTARTED = await standIn();
after(() => { for (const s of [HC, ELSEWHERE, RESTARTED]) { s.server.closeAllConnections?.(); s.server.close(); } });

let look;
useFleet({ env: { SPARK_CONSOLE_BEAT_API: HC.base, SPARK_CONSOLE_BEAT_MS: String(EVERY), SPARK_CONSOLE_BEAT_LATE_MS: String(LATE), SPARK_CONSOLE_BEAT_FIRST_MS: String(FIRST) } },
  async () => { look = (await createKey('beat-look')).token; });

const is = (r, status, what = '') => assert.equal(r.status, status, `${what} → ${r.status} ${r.text}`);
async function confirmed(method, path, body) {
  const b = await api('/auth/passkey/begin', { method: 'POST', body: { purpose: 'confirm', method, path, body } });
  is(b, 200, `begin confirm ${method} ${path}`);
  return { r: await api(path, { method, body, headers: { 'x-spark-passkey': passkeyHeader(KEY.sign(b.json)) } }), summary: b.json.summary };
}
const view = async () => { const r = await api('/heartbeat'); is(r, 200, 'GET /heartbeat'); assert.ok(!r.text.includes(ID), 'the address in GET /heartbeat'); return r.json; };
const secrets = () => (existsSync(T.fleet.secretsFile) ? JSON.parse(readFileSync(T.fleet.secretsFile, 'utf8')) : {});
const needs = async () => { const r = await api('/actions/fleet_status', { method: 'POST', body: {} }); is(r, 200, 'fleet_status'); return r.json.needsOwner; };
const BEAT_LINE = /^Spark Console hasn’t reached its outside check \(hc-ping\.com\) for over an hour, so the check may say Spark 2 is down while it is up\. Check that Spark 2 reaches the internet, and that the check still exists at Healthchecks\.io\.$/;
// Words that name this fleet: its addresses, its tailnet, the owner, the Sparks' hosts and SSH names.
const access = JSON.parse(readFileSync(join(REPO, 'test', 'mock', 'access.json'), 'utf8'));
const FLEET_WORDS = [new URL(MAIN_ORIGIN).hostname, TAILNET, access.publicHost.split(':')[0], access.ownerLogin, access.userName, access.sshUser, 'owner', 'tailscale', 'ts.net',
  ...access.nodes.flatMap(n => [n.tailnetIp, n.sshHost, n.name].filter(Boolean)), ...serviceConfig().nodes.map(n => n.host).filter(h => h !== 'local')];
// What the stand-in brain was sent, one entry a request (test/mock/model.mjs).
const BRAIN_RECORD = () => join(T.fleet.dir, 'model-requests.jsonl');
const brainRecord = () => (existsSync(BRAIN_RECORD()) ? readFileSync(BRAIN_RECORD(), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const TYPED = 'my outside check is';
// Every file in the fleet's folder (state, the service's log, the stand-in Sparks), but the secrets file, that holds
// this text. The stand-in brain's record is read line by line instead: only the turn the owner typed it in may hold it.
function filesHolding(text) {
  const found = [], walk = dir => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p);
      else if (p === BRAIN_RECORD()) { if (brainRecord().some(e => JSON.stringify(e).includes(text) && !e.words.startsWith(TYPED))) found.push(f); }
      else if (st.isFile() && p !== T.fleet.secretsFile && readFileSync(p).includes(text)) found.push(p.slice(T.fleet.dir.length + 1));
    }
  };
  walk(T.fleet.dir);
  return found;
}

// Another console, as systemd starts one after a crash: its own port, sockets, copy of the state and of the secrets file
// (so the saved address), beating `to`. Back once it answers, so its listen callback has run.
async function anotherConsole(to) {
  const dir = mkdtempSync(join(tmpdir(), 'sct-beat-'));
  cpSync(T.fleet.stateDir, join(dir, 'state'), { recursive: true, filter: f => !f.endsWith('.sock') });
  mkdirSync(join(dir, 'secrets'), { mode: 0o700 });
  copyFileSync(T.fleet.secretsFile, join(dir, 'secrets', 'secrets.json'));
  const port = await new Promise(resolve => { const s = http.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const at = Date.now(), p = spawn(process.execPath, [SERVICE_FILE], { cwd: REPO, stdio: 'ignore', env: { ...T.fleet.env, PORT: String(port),
    SPARK_CONSOLE_STATE_DIR: join(dir, 'state'), SPARK_CONSOLE_SOCKET: join(dir, 'api.sock'), SPARK_CONSOLE_SECRETS_FILE: join(dir, 'secrets', 'secrets.json'), SPARK_CONSOLE_BEAT_API: to.base } });
  let exited = false;
  const gone = new Promise(resolve => p.on('exit', () => { exited = true; resolve(); }));
  const kill = async () => { if (!exited) p.kill('SIGKILL'); await gone; rmSync(dir, { recursive: true, force: true }); };
  try {
    await waitFor(async () => { if (exited) throw new Error('the other console stopped'); return fetch(`http://127.0.0.1:${port}/console/api/health`, { signal: AbortSignal.timeout(1000) }).then(r => r.ok, () => false); },
      { timeout: 30000, every: 100, what: 'the other console to answer' });
  } catch (e) { await kill(); throw e; }
  return { at, kill };
}

describe('the outside heartbeat', { concurrency: 1 }, () => {
  test('no address saved: nothing is sent, interval after interval', { timeout: 60000 * SLOW }, async () => {
    await sleep(EVERY * 3 + 500);
    assert.deepEqual(HC.got, [], 'nothing reached the stand-in');
    const v = await view();
    assert.deepEqual([v.saved, v.state, v.lastOkAt], [false, 'off', null]);
  });

  test('saving it needs the owner, the page and the passkey', { timeout: 60000 * SLOW }, async () => {
    const body = { url: ADDRESS };
    is(await api('/heartbeat', { method: 'PUT', body }), 409, 'no passkey set up yet');
    const b = await api('/auth/passkey/begin', { method: 'POST', body: { purpose: 'register' } });
    is(await api('/auth/passkey/register', { method: 'POST', body: KEY.register(b.json) }), 201, 'the owner sets up a passkey');
    is(await api('/heartbeat', { method: 'PUT', body, headers: { 'tailscale-funnel-request': '?1' } }), 401, 'from the internet, not signed in');
    is(await api('/heartbeat', { method: 'PUT', body, headers: { 'x-spark-console': null } }), 403, 'cross-site');
    is(await api('/heartbeat', { method: 'PUT', body, headers: { 'x-forwarded-for': '100.64.0.3' } }), 403, 'from a Spark’s address');
    is(await api('/heartbeat', { method: 'PUT', body }), 428, 'without the passkey');
    is(await api('/heartbeat', { method: 'POST', body }), 405, 'POST is not a way around it');
    assert.equal(secrets().heartbeat, undefined, 'nothing kept');
    assert.deepEqual(HC.got, [], 'nothing sent');
  });

  test('an address on another host, or anything but https://hc-ping.com/<uuid>, is refused, kept nowhere and never called', { timeout: 120000 * SLOW }, async () => {
    const refused = [`https://hc-ping.com.example.org/${ID}`, `https://example.org/${ID}`, `http://hc-ping.com/${ID}`, `https://hc-ping.com:8443/${ID}`,
      `https://user@hc-ping.com/${ID}`, `https://hc-ping.com/${ID}?rid=1`, `https://hc-ping.com/${ID}#x`, `https://hc-ping.com/${ID}/fail`, `https://hc-ping.com/${ID}/`,
      `https://www.hc-ping.com/${ID}`, `https://hc-ping.com/ping-key-of-the-project/hub`, 'https://hc-ping.com/not-a-check', `${ELSEWHERE.base}/${ID}`, `${HC.base}/${ID}`, ID];
    for (const url of refused) {
      const { r } = await confirmed('PUT', '/heartbeat', { url });
      is(r, 400, url);
      assert.ok(!r.text.includes(url), `the refusal repeats ${url}`);
    }
    for (const body of [{}, { url: 42 }, { url: [ADDRESS] }]) is((await confirmed('PUT', '/heartbeat', body)).r, 400, JSON.stringify(body));
    assert.equal(secrets().heartbeat, undefined, 'nothing kept');
    await sleep(EVERY * 2);
    assert.deepEqual([HC.got.length, ELSEWHERE.got.length], [0, 0], 'nothing sent anywhere');
  });

  // T133: once the address is given, one request with nothing in it leaves each interval, none before (the first test);
  // the outside service's own alarm is not in the suite.
  test('with the passkey: kept only in the 0600 secrets file; then a bodiless GET each interval, with no cookie and no header that names this fleet', { timeout: 90000 * SLOW }, async () => {
    const { r, summary } = await confirmed('PUT', '/heartbeat', { url: ADDRESS });
    is(r, 200, 'saved');
    assert.ok(!r.text.includes(ID) && !String(summary).includes(ID), 'the address in the answer or in what the passkey dialog shows');
    assert.match(summary, /hc-ping\.com every 5 minutes/);
    // The save waits for the first beat.
    assert.deepEqual([r.json.saved, r.json.state], [true, 'ok']);
    assert.equal(HC.got.length, 1, 'the first beat, at the save');
    assert.equal(statSync(T.fleet.secretsFile).mode & 0o777, 0o600);
    assert.ok(!T.fleet.secretsFile.startsWith(T.fleet.stateDir), 'outside the state folder');
    assert.equal(secrets().heartbeat.url, ADDRESS);
    await waitFor(() => HC.got.length >= 4, { timeout: EVERY * 8, every: 100, what: 'four beats' });
    for (const g of HC.got) {
      assert.deepEqual([g.method, g.url, g.version, g.body], ['GET', `/${ID}`, '1.1', ''], 'GET /<uuid>, no query, no body');
      // Exactly these headers, in this order: a fixed User-Agent, the host, and the connection closing. No cookie, no
      // Authorization, no content, nothing else.
      assert.deepEqual(g.rawHeaders, ['User-Agent', 'spark-console', 'Host', `127.0.0.1:${HC.port}`, 'Connection', 'close']);
      const sent = `${g.url} ${g.rawHeaders.join(' ')} ${g.body}`.toLowerCase();
      for (const w of FLEET_WORDS) assert.ok(!sent.includes(String(w).toLowerCase()), `the beat names ${w}`);
    }
    // One each interval: never two at once, never a long gap.
    const gaps = HC.got.slice(1).map((g, i) => g.at - HC.got[i].at);
    for (const gap of gaps) assert.ok(gap >= EVERY * 0.6 && gap <= EVERY * 4 * SLOW, `beats ${gaps.join(', ')} ms apart, every ${EVERY} ms asked`);
    const v = await view();
    assert.deepEqual([v.saved, v.state, v.failingSince, v.miss], [true, 'ok', null, null]);
    assert.ok(Date.parse(v.lastOkAt) > Date.now() - EVERY * 4 * SLOW);
    assert.ok(auditLines().some(l => l.action === 'heartbeat-saved' && l.via === 'page'));
    assert.deepEqual(ELSEWHERE.got, []);
  });

  test('a console that dies within the wait after each start never beats, start after start; one left running beats first after the wait, then each interval', { timeout: 120000 * SLOW }, async () => {
    assert.equal(secrets().heartbeat?.url, ADDRESS, 'an address is saved');
    // (as systemd restarts one that dies a few seconds in: listening, then killed, three times)
    for (let i = 0; i < 3; i++) {
      const c = await anotherConsole(RESTARTED);
      await sleep(300);
      await c.kill();
    }
    await sleep(500);
    assert.deepEqual(RESTARTED.got, [], 'a console killed within the wait beat, so the check would stay green while it is down');
    const c = await anotherConsole(RESTARTED);
    try {
      await waitFor(() => RESTARTED.got.length >= 3, { timeout: FIRST + EVERY * 8, every: 100, what: 'three beats from the console left running' });
      assert.ok(RESTARTED.got[0].at - c.at >= FIRST, `its first beat came ${RESTARTED.got[0].at - c.at} ms after it was started, within the ${FIRST} ms wait`);
      const gaps = RESTARTED.got.slice(1).map((g, i) => g.at - RESTARTED.got[i].at);
      for (const gap of gaps) assert.ok(gap >= EVERY * 0.6 && gap <= EVERY * 4 * SLOW, `beats ${gaps.join(', ')} ms apart, every ${EVERY} ms asked`);
      for (const g of RESTARTED.got) assert.deepEqual([g.method, g.url, g.body], ['GET', `/${ID}`, '']);
    } finally { await c.kill(); }
  });

  test('a second copy (its port in use) exits and never beats, even when its exit is held for two intervals', { timeout: 60000 * SLOW }, async () => {
    // (its exit held, as on a slow machine: a beat started anywhere but the local port's listen callback would arrive)
    const hold = `data:text/javascript,const e=process.exit.bind(process);process.exit=c=>setTimeout(()=>e(c),${EVERY * 2 + 1000});`;
    const second = spawn(process.execPath, ['--import', hold, SERVICE_FILE], { cwd: REPO, env: { ...T.fleet.env, SPARK_CONSOLE_BEAT_API: ELSEWHERE.base }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    second.stdout.on('data', d => { out += d; });
    second.stderr.on('data', d => { out += d; });
    const code = await new Promise(resolve => second.on('exit', c => resolve(c)));
    assert.equal(code, 1, out);
    assert.match(out, /already running/);
    assert.ok(!out.includes(ID), 'the address in its output');
    assert.deepEqual(ELSEWHERE.got, [], 'the second copy beat');
  });

  test('beats that fail for the late time are one needs-you line, without the address; a redirect is never followed; working again clears it', { timeout: 120000 * SLOW }, async () => {
    HC.answer(302, `${ELSEWHERE.base}/${ID}`);
    const from = HC.got.length;
    await waitFor(() => HC.got.length > from, { timeout: EVERY * 4, every: 100, what: 'a beat that gets the redirect' });
    await waitFor(async () => (await view()).state === 'failing', { timeout: EVERY * 4, every: 200, what: 'failing' });
    const v = await view();
    assert.equal(v.miss, 'answered 302');
    assert.ok(!(await needs()).some(l => BEAT_LINE.test(l)), 'no line before the late time');
    const line = await waitFor(async () => (await needs()).find(l => BEAT_LINE.test(l)), { timeout: LATE + EVERY * 6, every: 300, what: 'the needs-you line' });
    assert.ok(Date.now() - Date.parse(v.failingSince) >= LATE, 'not before the late time');
    assert.ok(!line.includes(ID));
    // Where the owner sees it, and what Sparkie is told: /status in a chat, and the fleet notes of a turn.
    const status = (await say(await newChat(), '/status')).text;
    assert.ok(status.includes(line), status);
    await say(await newChat(), 'hello');
    assert.deepEqual(ELSEWHERE.got, [], 'the redirect was followed');
    HC.answer(200);
    await waitFor(async () => (await view()).state === 'ok', { timeout: EVERY * 6, every: 200, what: 'working again' });
    assert.ok(!(await needs()).some(l => BEAT_LINE.test(l)), 'the line is gone');
  });

  test('an address the owner types into a chat is kept as the heartbeat\'s address and nowhere else: code answers, the chat holds [key HEARTBEAT kept] in its place, and the brain is never sent it', { timeout: 60000 * SLOW }, async () => {
    const chat = await newChat(), from = brainRecord().length;
    await say(chat, `${TYPED} ${ADDRESS}, keep it to yourself`);
    await say(chat, 'thanks');
    const msgs = await chatMessages(chat);
    assert.equal(msgs[0].content, `${TYPED} [key HEARTBEAT kept], keep it to yourself`);
    assert.ok(!JSON.stringify(msgs).includes(ID), JSON.stringify(msgs));
    // (the answer is code's: the address was taken at the door, R51)
    assert.match(msgs[1].content, /^Kept the heartbeat’s address/);
    const title = (await api('/chats')).json.chats.find(c => c.id === chat)?.title;
    assert.ok(title && !title.includes(ID), title);
    assert.ok(!readFileSync(join(T.fleet.stateDir, 'chats.json'), 'utf8').includes(ID), 'chats.json, which the daily copy carries');
    // What the brain was sent: never the address (the turn it was typed in asked no brain, R51); the next turn, whose
    // history is the saved chat, holds none of it.
    const sent = brainRecord().slice(from), next = sent.filter(e => e.words === 'thanks');
    assert.deepEqual(brainRecord().filter(e => JSON.stringify(e).includes(ID)).map(e => e.words), [], 'a record in the brain’s log holds the address');
    assert.ok(next.length >= 1 && next.every(e => !JSON.stringify(e).includes(ID) && e.messages >= 4), JSON.stringify(next.map(e => [e.words, e.messages])));
    // Kept as the heartbeat's address, and nowhere else: the secrets file holds it; the chat file, the journal, the
    // audit, the events and the brain's log hold neither the address nor its ID alone.
    assert.equal(secrets().heartbeat.url, ADDRESS);
    assert.ok(readFileSync(T.fleet.secretsFile, 'utf8').includes(ID));
    const journal = readdirSync(T.fleet.journalDir).map(f => join(T.fleet.journalDir, f));
    assert.ok(journal.length > 0, 'the journal has files');
    for (const f of [join(T.fleet.stateDir, 'chats.json'), join(T.fleet.stateDir, 'audit.jsonl'), BRAIN_RECORD(), ...journal]) assert.ok(existsSync(f), f);
    for (const f of [join(T.fleet.stateDir, 'chats.json'), join(T.fleet.stateDir, 'audit.jsonl'), join(T.fleet.stateDir, 'events.jsonl'), BRAIN_RECORD(), ...journal]) {
      for (const [what, t] of [['the address', ADDRESS], ['its ID', ID]]) assert.ok(!existsSync(f) || !readFileSync(f, 'utf8').includes(t), `${what} in ${f}`);
    }
  });

  test('the address is in no chat, audit line, event, log, state file, answer or tool result', { timeout: 60000 * SLOW }, async () => {
    for (const p of ['/health', '/status', '/heartbeat', '/bootstrap', '/chats', '/telegram']) assert.ok(!(await api(p)).text.includes(ID), p);
    const chats = (await api('/chats')).json.chats;
    assert.ok(chats.length >= 2);
    for (const c of chats) assert.ok(!(await api(`/chats/${c.id}`)).text.includes(ID), `chat ${c.id}`);
    for (const [name, args] of [['sparkie_setup', {}], ['fleet_status', {}], ['fleet_events', {}], ['service_logs', { spark: 'spark2', service: 'console' }]]) {
      const r = await call(look, name, args);
      assert.ok(!r.raw.includes(ID), name);
    }
    assert.ok(auditLines().some(l => l.action === 'heartbeat-saved'));
    assert.ok(!JSON.stringify(auditLines()).includes(ID) && !JSON.stringify(eventLines()).includes(ID));
    assert.ok(!T.fleet.logText().includes(ID), 'the service log');
    assert.deepEqual(filesHolding(ID), [], 'files in the fleet’s folder that hold the address');
    assert.ok(readFileSync(T.fleet.secretsFile, 'utf8').includes(ID), 'the secrets file does');
  });

  test('removing it needs no passkey, only the owner on the page; after that nothing more is sent', { timeout: 60000 * SLOW }, async () => {
    is(await api('/heartbeat', { method: 'DELETE', headers: { 'tailscale-funnel-request': '?1' } }), 401, 'from the internet, not signed in');
    is(await api('/heartbeat', { method: 'DELETE', headers: { 'x-spark-console': null } }), 403, 'cross-site');
    assert.equal(secrets().heartbeat.url, ADDRESS, 'still kept');
    const r = await api('/heartbeat', { method: 'DELETE' });
    is(r, 200, 'removed without the passkey');
    assert.deepEqual([r.json.saved, r.json.state], [false, 'off']);
    assert.equal(secrets().heartbeat, undefined);
    assert.ok(auditLines().some(l => l.action === 'heartbeat-removed' && l.args.fileChanged === true));
    await sleep(300);
    const n = HC.got.length;
    await sleep(EVERY * 3 + 500);
    assert.equal(HC.got.length, n, 'a beat after the address was removed');
    assert.deepEqual(ELSEWHERE.got, []);
  });
});
