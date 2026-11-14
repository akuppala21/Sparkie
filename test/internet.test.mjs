// From anywhere, without Tailscale (docs/contract.md 4.10, v3.1). The main address is open to the internet (Tailscale
// Funnel: every request from there carries "Tailscale-Funnel-Request" and never a Tailscale identity). Nobody gets past
// the public fleet page until they sign in: the owner's passkey signs a browser in (a cookie only it sends), a device
// without the passkey shows a code the owner lets in with the passkey (a terminal gets a bearer token), and an agent
// uses its own key at the agent door. Also (v3.1): validation runs, "Test the changes" and going back a build need no
// passkey, and an agent that may change things takes a validation run's choice itself.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, mkdirSync, rmSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import http from 'node:http';
import netSocket from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { T, useFleet, api, call, rpc, post, sleep, waitFor, auditLines, eventLines, newChat, say, choose, SLOW } from './lib.mjs';
import { serviceConfig, startMock, TEST_DIR } from './start-mock.mjs';
import { Authenticator, passkeyHeader } from './authenticator.mjs';

const MAIN_ORIGIN = serviceConfig().origin, MAIN_HOST = new URL(MAIN_ORIGIN).hostname;
const TAILNET = MAIN_HOST.split('.').slice(1).join('.');
const KEY = new Authenticator(TAILNET, MAIN_ORIGIN), STRANGER = new Authenticator(TAILNET, MAIN_ORIGIN);

// Where the installer keeps earlier builds (empty until a test puts one there).
const RELEASES = mkdtempSync(join(tmpdir(), 'sct-releases-'));
process.on('exit', () => rmSync(RELEASES, { recursive: true, force: true }));
useFleet({ env: { NODE_OPTIONS: `--import=${join(TEST_DIR, 'mock', 'clock.mjs')}`, SPARK_CONSOLE_RELEASES: RELEASES } });

const FUNNEL = { 'tailscale-funnel-request': '?1' };
// A request from the internet, as Tailscale Funnel delivers it.
const net = (path, { headers = {}, ...opts } = {}) => api(path, { ...opts, headers: { ...FUNNEL, ...headers } });
const is = (r, status, what = '') => assert.equal(r.status, status, `${what} → ${r.status} ${r.text}`);
const cookieOf = r => /^sc_session=(scs_[A-Za-z0-9_-]{43});/.exec(String(r.headers.get('set-cookie') || ''))?.[1] || null;
const withCookie = token => ({ cookie: `other=1; sc_session=${token}` });
const bearer = token => ({ authorization: `Bearer ${token}` });
const setClock = async ms => { writeFileSync(join(T.fleet.dir, 'clock-offset'), String(ms)); await sleep(400); };

async function confirmed(method, path, body) {
  const b = await api('/auth/passkey/begin', { method: 'POST', body: { purpose: 'confirm', method, path, body } });
  is(b, 200, `begin confirm ${method} ${path}`);
  const r = await api(path, { method, body, headers: { 'x-spark-passkey': passkeyHeader(KEY.sign(b.json)) } });
  return Object.assign(r, { summary: b.json.summary });
}
async function signIn(key = KEY, { origin } = {}) {
  const b = await net('/auth/signin/begin', { method: 'POST', body: {} });
  is(b, 200, 'begin sign-in');
  return net('/auth/signin', { method: 'POST', body: { ...key.sign(b.json, origin ? { origin } : {}), name: 'Test phone' } });
}
async function startCode(kind = 'terminal', name = 'Test terminal') {
  const r = await net('/auth/device/start', { method: 'POST', body: { kind, name } });
  is(r, 200, 'start a code');
  return r.json;
}
const poll = deviceCode => net('/auth/device/poll', { method: 'POST', body: { deviceCode } });

describe('from the internet, not signed in', () => {
  test('only the public fleet, whoami and a bare /health answer; a Tailscale identity it brings counts for nothing', async () => {
    for (const p of ['/bootstrap', '/status', '/chats', '/agents', '/access']) is(await net(p), 401, p);
    is(await net('/bootstrap', { headers: { 'tailscale-user-login': 'owner@test' } }), 401, 'a forged identity');
    is(await net('/public/fleet'), 200, 'the public fleet');
    const h = await net('/health');
    is(h, 200);
    assert.deepEqual(h.json, { ok: true });
    const w = await net('/whoami');
    is(w, 200);
    assert.equal(w.json.access, 'none');
    assert.equal(w.json.signin, false, 'no passkey yet, so no passkey sign-in');
    is(await net('/auth/signin/begin', { method: 'POST', body: {} }), 409, 'nothing to sign in with yet');
  });

  test('before a passkey exists, no device can be let in (nothing could confirm it)', async () => {
    const s = await startCode('terminal', 'Too early');
    const r = await api('/auth/device/approve', { method: 'POST', body: { code: s.code } });
    is(r, 409);
    assert.match(r.json.error, /Set up your passkey first/);
    is(await poll(s.deviceCode), 202, 'still waiting');
    is(await api('/auth/device/deny', { method: 'POST', body: { code: s.code } }), 200, 'turned away instead');
  });

  // F18: a recovery code is a way in by itself (R33), so whoami says when one would work, passkey or not. Yes or no only.
  test('with no passkey on file, whoami still says a recovery code signs in here', async () => {
    assert.equal((await net('/whoami')).json.recovery, false, 'no codes made yet');
    // On the tailnet with no passkey yet nothing could confirm it, so the codes are made without one.
    const made = await api('/auth/recovery', { method: 'POST', body: {} });
    is(made, 200, 'make the codes');
    const w = (await net('/whoami')).json;
    assert.deepEqual([w.signin, w.recovery], [false, true], 'no passkey to sign in with, but a recovery code works: true, not a count');
    assert.equal((await api('/whoami')).json.recovery, false, 'not offered to someone signed in by Tailscale');
    const r = await net('/auth/signin/recovery', { method: 'POST', body: { code: made.json.codes[0], name: 'Phone, no passkey' }, headers: { 'x-forwarded-for': '203.0.113.18' } });
    is(r, 200, 'the code signs the phone in with no passkey on file');
    const cookie = cookieOf(r);
    assert.equal((await net('/whoami', { headers: withCookie(cookie) })).json.recovery, false, 'already signed in');
    is(await net('/auth/signout', { method: 'POST', body: {}, headers: withCookie(cookie) }), 200, 'signed out, so later tests see the same devices');
  });

  test('once the owner has a passkey, whoami offers signing in with it', async () => {
    const b = await api('/auth/passkey/begin', { method: 'POST', body: { purpose: 'register' } });
    is(b, 200);
    is(await api('/auth/passkey/register', { method: 'POST', body: KEY.register(b.json) }), 201, 'the owner sets up a passkey on the tailnet');
    assert.equal((await net('/whoami')).json.signin, true);
    assert.equal((await api('/whoami')).json.signin, false, 'not offered to someone signed in by Tailscale');
  });
});

describe('a browser, signed in with the owner\'s passkey', () => {
  let cookie;
  test('the passkey signs it in: a cookie only it sends (HttpOnly, Secure, SameSite=Strict, only to /console/api)', async () => {
    const r = await signIn();
    is(r, 200, 'sign in');
    const set = String(r.headers.get('set-cookie'));
    for (const part of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/console/api']) assert.ok(set.includes(part), `${part} in ${set}`);
    cookie = cookieOf(r);
    assert.ok(cookie, set);
    const boot = await net('/bootstrap', { headers: withCookie(cookie) });
    is(boot, 200, 'bootstrap with the cookie');
    assert.equal(boot.json.viewer.role, 'owner');
    assert.deepEqual({ kind: boot.json.session.kind, name: boot.json.session.name }, { kind: 'browser', name: 'Test phone' });
    is(await net('/status', { headers: withCookie(cookie) }), 200, 'status');
    const w = await net('/whoami', { headers: withCookie(cookie) });
    assert.deepEqual([w.json.access, w.json.session], ['owner', 'browser']);
    assert.ok(auditLines().some(l => l.action === 'signed-in' && l.args?.device === 'Test phone'));
  });

  test('changes from the browser still need the page\'s header and origin', async () => {
    is(await net('/chats', { method: 'POST', body: {}, headers: { ...withCookie(cookie), 'x-spark-console': null } }), 403, 'no header');
    is(await net('/chats', { method: 'POST', body: {}, headers: { ...withCookie(cookie), origin: 'https://evil.example' } }), 403, 'another site');
    is(await net('/chats', { method: 'POST', body: {}, headers: withCookie(cookie) }), 201, 'the page');
  });

  test('a passkey the owner never set up, another site\'s page, a used challenge or a bad token: nobody gets in', async () => {
    const stranger = await signIn(STRANGER);
    assert.ok(stranger.status === 403 || stranger.status === 400, stranger.text);
    assert.equal(cookieOf(stranger), null);
    const elsewhere = await signIn(KEY, { origin: 'https://evil.example' });
    is(elsewhere, 403, 'signed on another site');
    assert.equal(cookieOf(elsewhere), null);
    const b = await net('/auth/signin/begin', { method: 'POST', body: {} });
    const answer = KEY.sign(b.json);
    is(await net('/auth/signin', { method: 'POST', body: answer }), 200, 'once');
    is(await net('/auth/signin', { method: 'POST', body: answer }), 409, 'the same answer again');
    is(await net('/auth/signin/begin', { method: 'POST', body: {}, headers: { 'x-spark-console': null } }), 403, 'not from the page');
    is(await net('/bootstrap', { headers: withCookie(`scs_${'A'.repeat(43)}`) }), 401, 'a made-up cookie');
    is(await net('/bootstrap', { headers: bearer(cookie) }), 401, 'a browser\'s token in a header');
    // A sign-in challenge is signed by the service: one changed by a letter, or made up, is refused.
    const b2 = await net('/auth/signin/begin', { method: 'POST', body: {} });
    const bent = `${b2.json.challengeId.slice(0, -1)}${b2.json.challengeId.endsWith('A') ? 'B' : 'A'}`;
    is(await net('/auth/signin', { method: 'POST', body: KEY.sign({ challengeId: bent, challenge: bent }) }), 409, 'a changed challenge');
    is(await net('/auth/signin', { method: 'POST', body: null }), 409, 'a body of null');
  });

  test('another cookie of the same name (set by another page on this host) doesn\'t hide the real one', async () => {
    const fake = `scs_${'B'.repeat(43)}`;
    is(await net('/status', { headers: { cookie: `sc_session=${fake}; sc_session=${cookie}` } }), 200, 'the real one, second');
    // (a page on the app door's origin can write any number under a longer path, which the browser sends first)
    const six = [1, 2, 3, 4, 5, 6].map(i => `sc_session=scs_${String(i).repeat(43)}`).join('; ');
    is(await net('/status', { headers: { cookie: `${six}; sc_session=${cookie}` } }), 200, 'the real one, after six made-up ones');
    is(await net('/status', { headers: { cookie: `sc_session=${fake}` } }), 401, 'only the fake one');
  });

  test('signing a device out ends its live stream too', async () => {
    const r = await signIn();
    const c = cookieOf(r);
    const ended = new Promise((resolve, reject) => {
      const req = http.request(`${T.base}/metrics`, { headers: { ...FUNNEL, ...withCookie(c) } }, res => {
        if (res.statusCode !== 200) { reject(new Error(`metrics ${res.statusCode}`)); return; }
        res.on('data', () => {});
        res.on('end', resolve);
        res.on('close', resolve);
      });
      req.on('error', resolve);
      req.end();
    });
    await sleep(500);
    const id = (await api('/auth/sessions')).json.sessions.find(s => s.name === 'Test phone' && s.via === 'passkey' && Date.parse(s.createdAt) > Date.now() - 60000)?.id;
    assert.ok(id);
    is(await api(`/auth/sessions/${id}`, { method: 'DELETE' }), 200);
    await Promise.race([ended, sleep(5000).then(() => { throw new Error('the stream stayed open'); })]);
  });

  test('sign out: the cookie stops working, and the answer clears it', async () => {
    const r = await net('/auth/signout', { method: 'POST', body: {}, headers: withCookie(cookie) });
    is(r, 200);
    assert.match(String(r.headers.get('set-cookie')), /sc_session=; .*Max-Age=0/);
    is(await net('/bootstrap', { headers: withCookie(cookie) }), 401, 'after signing out');
  });

  test('signing in is limited per address', async () => {
    const from = { 'x-forwarded-for': '203.0.113.9' };
    let last;
    for (let i = 0; i < 31; i++) last = await net('/auth/signin/begin', { method: 'POST', body: {}, headers: from });
    is(last, 429, 'the 31st try in 10 minutes');
    is(await net('/auth/signin/begin', { method: 'POST', body: {} }), 200, 'another address still can');
    // Every way of writing one IPv6 /64 counts as one address.
    const spellings = ['2001:db8:0:1::5', '2001:0db8:0000:0001:0:0:0:6', '2001:DB8:0:1:ffff::7'];
    for (let i = 0; i < 30; i++) last = await net('/auth/signin/begin', { method: 'POST', body: {}, headers: { 'x-forwarded-for': spellings[i % 3] } });
    is(last, 200, 'the 30th');
    is(await net('/auth/signin/begin', { method: 'POST', body: {}, headers: { 'x-forwarded-for': '2001:0db8::1:0:0:0:9' } }), 429, 'the 31st, written another way');
  });
});

describe('a device without the passkey: its code, let in from a signed-in device', () => {
  let token, sessionId;
  test('a terminal shows a code; the owner sees who asked and lets it in with the passkey; its token comes once', async () => {
    const s = await startCode();
    assert.match(s.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    assert.equal(s.approveUrl, undefined, 'no link to approve it: the owner types the code (a link could be someone else\'s)');
    is(await poll(s.deviceCode), 202, 'waiting');
    const d = await api(`/auth/device/${s.code}`);
    is(d, 200);
    assert.deepEqual([d.json.kind, d.json.name, d.json.state, d.json.fromInternet], ['terminal', 'Test terminal', 'waiting', false]);
    is(await net(`/auth/device/${s.code}`), 401, 'not from the internet without signing in');
    const plain = await api('/auth/device/approve', { method: 'POST', body: { code: s.code } });
    is(plain, 428, 'letting a device in needs the passkey');
    const ok = await confirmed('POST', '/auth/device/approve', { code: s.code });
    is(ok, 200, 'with the passkey');
    assert.match(ok.summary, /Let a terminal called “Test terminal” sign in as you \(code [A-Z0-9-]{9}/);
    const got = await poll(s.deviceCode);
    is(got, 200, 'the token');
    token = got.json.token;
    assert.match(token, /^scs_[A-Za-z0-9_-]{43}$/);
    assert.equal(cookieOf(got), null, 'a terminal gets no cookie');
    is(await poll(s.deviceCode), 410, 'only once');
  });

  test('the terminal\'s token works from the internet in its header, not as a cookie, and never for the editors', async () => {
    const st = await net('/status', { headers: bearer(token) });
    is(st, 200, 'status');
    is(await net('/status', { headers: withCookie(token) }), 401, 'as a cookie');
    is(await net('/connect/spark3/', { headers: bearer(token) }), 403, 'the editor');
    const w = await net('/workflows', { headers: bearer(token) });
    is(w, 200, 'the workflows');
    const hidden = await net('/nodes/spark3/files', { method: 'POST', body: { operation: 'write', area: 'own', path: '.vscode/tasks.json', content: '{}' }, headers: bearer(token) });
    is(hidden, 403, 'no hidden files from a terminal');
    assert.match(hidden.json.error, /terminal signed in from the internet/);
  });

  test('a code asked from the internet says so; one address can have at most 3 waiting', async () => {
    const from = { 'x-forwarded-for': '198.51.100.7' };
    const codes = [];
    for (let i = 0; i < 3; i++) {
      const r = await net('/auth/device/start', { method: 'POST', body: { kind: 'browser', name: `Phone ${i}` }, headers: from });
      is(r, 200, `code ${i + 1}`);
      codes.push(r.json.code);
    }
    is(await net('/auth/device/start', { method: 'POST', body: { kind: 'browser', name: 'Phone 4' }, headers: from }), 429, 'a 4th from the same address');
    const d = await api(`/auth/device/${codes[0]}`);
    assert.deepEqual([d.json.from, d.json.fromInternet], ['198.51.100.7', true]);
    for (const code of codes) is(await api('/auth/device/deny', { method: 'POST', body: { code } }), 200);
  });

  test('signed-in devices are listed, and signing one out stops its token', async () => {
    const list = (await api('/auth/sessions')).json.sessions;
    const t = list.find(s => s.kind === 'terminal' && s.name === 'Test terminal');
    assert.ok(t, JSON.stringify(list));
    assert.equal(t.via, 'code');
    sessionId = t.id;
    assert.ok(!JSON.stringify(list).includes('hash'), 'no token hashes leave the service');
    is(await api(`/auth/sessions/${sessionId}`, { method: 'DELETE' }), 200, 'sign it out (no passkey)');
    is(await net('/status', { headers: bearer(token) }), 401, 'its token after');
  });

  test('turned away, or not answered in 10 minutes: the code stops working', async () => {
    const no = await startCode('browser', 'Someone else');
    is(await api('/auth/device/deny', { method: 'POST', body: { code: no.code } }), 200);
    const r = await poll(no.deviceCode);
    is(r, 410);
    assert.match(r.json.error, /didn’t let this device in/);
    const late = await startCode('browser', 'Too late');
    await setClock(11 * 60000);
    try {
      is(await poll(late.deviceCode), 410, 'after 10 minutes');
      is(await api(`/auth/device/${late.code}`), 404, 'nothing left to let in');
    } finally { await setClock(0); }
  });

  test('a browser let in by its code gets the same cookie as a passkey sign-in', async () => {
    const s = await startCode('browser', 'Work laptop');
    is(await confirmed('POST', '/auth/device/approve', { code: s.code }), 200);
    const r = await poll(s.deviceCode);
    is(r, 200);
    assert.equal(r.json.token, undefined, 'no token in the body');
    const c = cookieOf(r);
    assert.ok(c);
    is(await net('/bootstrap', { headers: withCookie(c) }), 200);
  });
});

let agentId;
describe('agents, from anywhere', () => {
  test('an agent\'s own key works at the agent door from the internet; a made-up one doesn\'t', async () => {
    // The owner has a passkey by now, so making the key is confirmed with it.
    const made = await confirmed('POST', '/agents', { name: 'net-agent' });
    is(made, 201, 'an agent key');
    const k = { token: made.json.token };
    agentId = made.json.id;
    // A new key works on the tailnet only, until the owner lets it work from anywhere (security audit, 2026-11-11: a key
    // left in a shell profile was the owner, from anywhere).
    assert.equal(made.json.internet, false);
    const shut = await rpc(k.token, 'tools/list', undefined, { headers: FUNNEL });
    assert.equal(shut.status, 401, shut.text);
    assert.equal((await call(k.token, 'fleet_status', {})).isError, false, 'on the tailnet it works');
    is(await api(`/agents/${agentId}`, { method: 'PUT', body: { internet: true } }), 428, 'letting it work from anywhere needs the passkey');
    const open = await confirmed('PUT', `/agents/${agentId}`, { internet: true });
    is(open, 200);
    assert.equal(open.json.internet, true);
    assert.match(open.summary, /work from anywhere, without Tailscale/);
    const r = await rpc(k.token, 'tools/list', undefined, { headers: FUNNEL });
    assert.equal(r.status, 200, r.text);
    assert.ok(r.json.result.tools.some(t => t.name === 'fleet_status'));
    const st = await call(k.token, 'fleet_status', {}, { headers: FUNNEL });
    assert.equal(st.isError, false, st.text);
    const bad = await rpc(`${k.token.slice(0, -4)}AAAA`, 'tools/list', undefined, { headers: FUNNEL });
    assert.ok([401, 403].includes(bad.status), bad.text);
    is(await net('/bootstrap', { headers: bearer(k.token) }), 401, 'an agent key isn\'t a sign-in for the page');
    // A look-only key doesn't start a model by calling the model address.
    const v1 = await net('/v1/chat/completions', { method: 'POST', body: { model: 'NVIDIA-Nemotron-Nano-9B-v2', messages: [{ role: 'user', content: 'hi' }] }, headers: { ...bearer(k.token), 'x-spark-console': null } });
    is(v1, 409, 'a model that isn\'t running');
    assert.match(v1.text, /may only look/);
  });
});

describe('no passkey for updates (v3.1)', () => {
  test('"Test the changes" and going back a build don\'t ask for the passkey', async () => {
    const v = await api('/workflows/validate', { method: 'POST', body: {} });
    is(v, 202, 'test the changes');
    await waitFor(async () => (await api(`/jobs/${v.json.id}`)).json.status !== 'running', { timeout: 60000 * SLOW, what: 'the test run' });
    is(await api('/rollback', { method: 'POST', body: {} }), 404, 'going back: no earlier build here, and no passkey asked');
  });

  test('an agent that may change things runs a validation run by taking the choice it\'s offered', { timeout: 240000 * SLOW }, async () => {
    const other = await startMock({ watchMs: 60000, statusMs: 20000, knowledge: true, env: { SPARK_CONSOLE_ASSUME_VALIDATED: '0' } });
    try {
      const at = (path, method = 'GET', body) => fetch(`${other.base}${path}`, { method, body: body && JSON.stringify(body),
        headers: body ? { 'content-type': 'application/json', 'x-spark-console': '1', origin: other.origin } : {} }).then(async r => ({ status: r.status, json: await r.json().catch(() => null) }));
      const k = await at('/agents', 'POST', { name: 'validator' });
      is(k, 201, 'an agent key');
      is(await at(`/agents/${k.json.id}`, 'PUT', { act: true }), 200, 'it may change things');
      const opts = { url: other.mcp };
      const q = await call(k.json.token, 'stop_model', { spark: 'spark4', container: 'sc-RadixArk--Qwen3.8-27B-NVFP4' }, opts);
      assert.equal(q.isError, false, q.text);
      assert.equal(q.value.outcome, 'question', q.text);
      const yes = q.value.choices.find(c => /^Yes, run it as its validation/.test(c.label));
      assert.ok(yes?.choice, q.text);
      const run = await call(k.json.token, 'stop_model', { choice: yes.choice }, opts);
      assert.equal(run.isError, false, run.text);
      for (const until = Date.now() + 180000 * SLOW; ;) {
        const w = (await call(k.json.token, 'wait_operation', { id: run.value.operation, seconds: 20 }, opts)).value;
        if (w.status !== 'running') { assert.equal(w.status, 'completed', JSON.stringify(w)); break; }
        assert.ok(Date.now() < until, 'still stopping');
      }
      const wf = (await at('/workflows')).json.workflows.find(w => w.id === 'stop_model');
      assert.equal(wf.state, 'active', JSON.stringify(wf));
    } finally { await other.stop(); }
  });
});

// The security audit's fixes (2026-11-11): what someone on the internet could do with a stolen cookie or key, or a flood.
describe('security fixes (audit, 2026-11-11)', () => {
  let browser, coded;
  // A WebSocket upgrade over a connection of its own; resolves with the answer's first line (null if reset first).
  function upgrade(path, headers = {}, { reset = false } = {}) {
    return new Promise(resolve => {
      const s = netSocket.connect(T.fleet.port, '127.0.0.1');
      let got = '';
      s.on('connect', () => {
        const h = { host: new URL(MAIN_ORIGIN).host, origin: MAIN_ORIGIN, connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13',
          'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', ...FUNNEL, ...headers };
        s.write(`GET /console/api${path} HTTP/1.1\r\n${Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
        if (reset) { s.resetAndDestroy(); resolve(null); }
      });
      s.on('data', d => { got += d; if (got.includes('\r\n')) s.destroy(); });
      s.on('error', () => {});
      s.on('close', () => resolve(got.split('\r\n')[0] || null));
    });
  }

  test('from the internet, the editors open only within 12 hours of using the passkey on that device; never port forwarding', async () => {
    browser = cookieOf(await signIn());
    assert.ok(browser);
    // No editor runs in the stand-in fleet: getting past every check is "isn't answering" (503), not 403.
    is(await net('/connect/spark3/', { headers: withCookie(browser) }), 503, 'just signed in with the passkey');
    // (its WebSocket gets past them too: with no editor there, the connection just closes, no 403)
    assert.doesNotMatch(String(await upgrade('/connect/spark3/', withCookie(browser))), /403/, 'its WebSocket gets past the checks too');
    for (const p of ['/connect/spark3/proxy/8080/', '/connect/spark3/absproxy/8080/', '/connect/spark3/%70roxy/8080/', '/connect/spark3/PROXY/8080/x',
      '/connect/spark3//proxy/8080/', '/connect/spark3/%2Fproxy/8080/']) {
      const r = await net(p, { headers: withCookie(browser) });
      is(r, 400, p);
      assert.match(r.json.error, /Port forwarding isn’t offered/);
    }
    is(await api('/connect/spark3/proxy/8080/'), 400, 'not on the tailnet either');
    // A browser let in by its code hasn't used the passkey on that device.
    const s = await startCode('browser', 'Borrowed laptop');
    is(await confirmed('POST', '/auth/device/approve', { code: s.code }), 200);
    coded = cookieOf(await poll(s.deviceCode));
    assert.ok(coded);
    const no = await net('/connect/spark3/', { headers: withCookie(coded) });
    is(no, 403, 'let in by a code');
    assert.match(no.json.error, /within 12 hours of using your passkey/);
    assert.match(await upgrade('/connect/spark3/', withCookie(coded)), /^HTTP\/1\.1 403/, 'its WebSocket neither');
    // Thirteen hours on, the passkey sign-in is too old as well; the page itself still works.
    await setClock(13 * 3600000);
    try {
      is(await net('/connect/spark3/', { headers: withCookie(browser) }), 403, '13 hours after the passkey');
      is(await net('/status', { headers: withCookie(browser) }), 200, 'the rest of the console');
    } finally { await setClock(0); }
  });

  test('using the passkey on a device (confirming a change) opens the editors there again', async () => {
    const via = withCookie(coded);
    const b = await net('/auth/passkey/begin', { method: 'POST', body: { purpose: 'confirm', method: 'PUT', path: `/agents/${agentId}`, body: { internet: true } }, headers: via });
    is(b, 200, 'begin confirm from the internet');
    const r = await net(`/agents/${agentId}`, { method: 'PUT', body: { internet: true }, headers: { ...via, 'x-spark-passkey': passkeyHeader(KEY.sign(b.json)) } });
    is(r, 200, 'confirmed with the passkey');
    is(await net('/connect/spark3/', { headers: via }), 503, 'the editor, now');
  });

  test('a refused or reset WebSocket never ends the console', async () => {
    for (let i = 0; i < 25; i++) {
      await upgrade('/connect/spark3/', {}, { reset: true });
      await upgrade('/connect/nowhere/', withCookie(browser), { reset: true });
      await upgrade('/status', {}, { reset: true });
    }
    assert.match(await upgrade('/connect/spark3/'), /^HTTP\/1\.1 403/, 'not signed in');
    await sleep(500);
    // The stand-in fleet doesn't restart a service that ended: answering means it never did.
    is(await api('/health'), 200, 'still answering');
  });

  test('a huge argument at the agent door is turned away (413), and a long one answers quickly', async () => {
    const made = await confirmed('POST', '/agents', { name: 'long-args' });
    is(made, 201);
    const token = made.json.token;
    const big = await post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'fleet_status', arguments: { note: '-a'.repeat(200000) } } }, { token });
    assert.equal(big.status, 413, big.text.slice(0, 200));
    // Under the limit, an argument shaped to make secret-hiding slow (before: over a second per 40,000 characters).
    const started = Date.now();
    const r = await call(token, 'find_recipes', { query: `--x-${'-a'.repeat(60000)}token ${'b'.repeat(40)}` });
    assert.ok(r.status === 200, r.text?.slice(0, 200));
    assert.ok(Date.now() - started < 3000 * SLOW, `took ${Date.now() - started} ms`);
    is(await api(`/agents/${made.json.id}`, { method: 'DELETE' }), 200);
  });

  test('going back a build: from a device signed in over the internet it needs the passkey; an agent only asks the owner', async () => {
    const back = await net('/rollback', { method: 'POST', body: {}, headers: withCookie(browser) });
    is(back, 428, 'a stolen cookie can\'t undo an update');
    // An earlier build to go back to.
    const stamp = '20261110T120000Z';
    mkdirSync(join(RELEASES, stamp), { recursive: true });
    writeFileSync(join(RELEASES, stamp, 'restore.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    try {
      const made = await confirmed('POST', '/agents', { name: 'undoer' });
      is(made, 201);
      is(await confirmed('PUT', `/agents/${made.json.id}`, { act: true, internet: true }), 200, 'it may change things, from anywhere');
      const from = { headers: { ...FUNNEL, 'x-forwarded-for': '203.0.113.50' } };
      const q = await call(made.json.token, 'undo_update', {}, from);
      assert.equal(q.isError, false, q.text);
      assert.equal(q.value.outcome, 'question', q.text);
      assert.match(q.value.note || '', /Only the owner can answer this one/, q.text);
      const yes = q.value.choices.find(c => /^Yes, go back a build/.test(c.label));
      // (asked of a direct call: no choice id comes back, and it says how the owner says yes)
      assert.ok(yes && yes.choice === null, q.text);
      assert.match(q.value.note, /no choice to send back/);
      // The audit says where an agent's call came from.
      const line = auditLines().filter(l => l.actor === 'undoer' && l.action === 'undo_update').pop();
      assert.equal(line?.from, '203.0.113.50', JSON.stringify(line ?? null));
      const taken = await call(made.json.token, 'undo_update', { choice: yes.choice }, from);
      assert.equal(taken.isError, true, taken.text);
      assert.match(taken.text, /Only the owner can answer this one|Unknown argument: choice/);
      // Through Sparkie too (the review of the fixes): an agent asking it in plain words gets the same owner-only button.
      writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify([{ match: '^undo the last update$', calls: [{ name: 'undo_update', arguments: {} }] }]));
      let v = (await call(made.json.token, 'ask_sparkie', { message: 'undo the last update' }, from)).value;
      for (const until = Date.now() + 60000 * SLOW; v?.status !== 'answered' && Date.now() < until;) v = (await call(made.json.token, 'ask_sparkie', { conversation: v.conversation }, from)).value;
      assert.equal(v?.status, 'answered', JSON.stringify(v));
      const viaSparkie = auditLines().filter(l => l.action === 'undo_update' && l.actor === 'Sparkie for undoer').pop();
      assert.equal(viaSparkie?.outcome, 'question', JSON.stringify(viaSparkie ?? null));
      // And from a device signed in over the internet, through the API.
      const api1 = await net('/actions/undo_update', { method: 'POST', body: {}, headers: withCookie(browser) });
      is(api1, 200);
      assert.equal(api1.json.outcome, 'question', api1.text);
      // (the door's own line for a call has no outcome; the action's line says what it did)
      const ran = auditLines().filter(l => l.action === 'undo_update' && 'outcome' in l && l.outcome !== 'question');
      assert.deepEqual(ran, [], 'nothing was undone');
      is(await api(`/agents/${made.json.id}`, { method: 'DELETE' }), 200);
    } finally { rmSync(join(RELEASES, stamp), { recursive: true, force: true }); }
  });

  // F7 (review, 2026-11-11): a carry-on turn keeps where its request came from.
  test('a request from a signed-in device carries on as one: its "then undo the last update" is the owner-only button, never a rollback', { timeout: 240000 * SLOW }, async () => {
    const RADIX = 'sc-RadixArk--Qwen3.8-27B-NVFP4', stamp = '20261110T130000Z', via = { ...FUNNEL, ...withCookie(browser) };
    // An earlier build to go back to.
    mkdirSync(join(RELEASES, stamp), { recursive: true });
    writeFileSync(join(RELEASES, stamp, 'restore.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    const words = `stop ${RADIX} on spark 4, then undo the last update`;
    writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify([
      { match: `^${words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, calls: [{ name: 'stop_model', arguments: { spark: 'spark4', container: RADIX } }] },
      { match: '^\\[Spark Console\\] What you started', calls: [{ name: 'undo_update', arguments: {} }] }]));
    const from = auditLines().length;
    try {
      // (Sparkie's stop runs at once only for a container the watcher has seen on that Spark; its first look is 15 s
      // after the service starts, and a quick run of this file gets here sooner)
      await waitFor(async () => (await api('/actions/workloads', { method: 'POST', body: { spark: 'spark4' } })).json?.workloads?.some(w => w.name === RADIX && w.running),
        { timeout: 60000, what: 'the watcher seeing the model on Spark 4' });
      const chat = await newChat(via);
      const r = await say(chat, words, via);
      assert.deepEqual(r.message.tools.map(t => [t.name, t.ok, t.outcome]), [['stop_model', true, 'started']], JSON.stringify(r.message.tools));
      // The stop finishes and Sparkie carries on with the stored words, which ask for the undo.
      const line = await waitFor(() => auditLines().slice(from).find(l => l.chat === chat && l.action === 'undo_update'), { timeout: 120000, what: 'Sparkie carrying on' });
      assert.equal(line.outcome, 'question', JSON.stringify(line));
      assert.ok(!auditLines().slice(from).some(l => l.action === 'rollback'), 'nothing was undone');
    } finally {
      rmSync(join(RELEASES, stamp), { recursive: true, force: true });
      rmSync(join(T.fleet.dir, 'model-script.json'), { force: true });
    }
  });

  test('/undo update typed by a device signed in over the internet: the owner-only button, pressed with the passkey; never a rollback by itself', async () => {
    const stamp = '20261110T120000Z', rollbacks = () => auditLines().filter(l => l.action === 'rollback');
    mkdirSync(join(RELEASES, stamp), { recursive: true });
    writeFileSync(join(RELEASES, stamp, 'restore.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    try {
      const h = { ...FUNNEL, ...withCookie(browser) }, before = rollbacks().length;
      const chat = await newChat(h);
      const r = await say(chat, '/undo update', h);
      assert.match(r.text, /^\/undo update\nGo back to the build from before the update on 20261110T120000Z\?/);
      const yes = (r.message.choices || []).find(c => c.label === 'Yes, go back a build' && c.state === 'open');
      assert.ok(yes?.id, JSON.stringify(r.message));
      assert.ok((r.message.choices || []).some(c => c.label === 'No, keep this build'), JSON.stringify(r.message));
      assert.equal(rollbacks().length, before);
      is(await choose(chat, yes.id, h), 428, 'pressing it needs the passkey');
      assert.equal(rollbacks().length, before);
      await waitFor(async () => (await api('/health')).json.jobsRunning === 0, { timeout: 60000 * SLOW, what: 'no operations running' });
      is(await confirmed('POST', `/chats/${chat}/choose`, { choice: yes.id }), 200, 'pressed with the passkey');
      assert.equal(rollbacks().length, before + 1);
      assert.equal(rollbacks().at(-1).args?.to, stamp);
    } finally { rmSync(join(RELEASES, stamp), { recursive: true, force: true }); }
  });

  test('a flood of codes from many addresses never stops a new one; the oldest waiting code makes room', async () => {
    const started = [];
    for (let a = 0; a < 100; a++) {
      const from = { 'x-forwarded-for': `198.18.${a >> 4}.${(a & 15) + 1}` };
      for (let i = 0; i < 3; i++) {
        const r = await net('/auth/device/start', { method: 'POST', body: { kind: 'terminal', name: `Flood ${a}.${i}` }, headers: from });
        is(r, 200, `flood ${a}.${i}`);
        started.push(r.json.code);
      }
    }
    const mine = await startCode('terminal', 'Mine, after the flood');
    is(await api(`/auth/device/${mine.code}`), 200, 'the owner\'s code is there to let in');
    is(await poll(mine.deviceCode), 202, 'and waiting');
    is(await api(`/auth/device/${started[0]}`), 404, 'the oldest flood code made room');
    // The flood goes on from new addresses: room is made from the addresses with the most waiting, never the owner's one.
    for (let a = 100; a < 110; a++) {
      for (let i = 0; i < 3; i++) is(await net('/auth/device/start', { method: 'POST', body: { kind: 'terminal', name: `Flood ${a}.${i}` }, headers: { 'x-forwarded-for': `198.18.${a >> 4}.${(a & 15) + 1}` } }), 200);
    }
    is(await api(`/auth/device/${mine.code}`), 200, 'the owner\'s code outlasts the flood');
    // Every way of writing one IPv6 /64 counts as one address for the 3 waiting.
    const v6 = ['2001:db8:0:7::1', '2001:0db8:0000:0007:0:0:0:2', '2001:DB8:0:7:ffff::3', '2001:db8:0:7::4'];
    for (let i = 0; i < 3; i++) is(await net('/auth/device/start', { method: 'POST', body: { kind: 'terminal', name: `v6 ${i}` }, headers: { 'x-forwarded-for': v6[i] } }), 200, `v6 ${i}`);
    is(await net('/auth/device/start', { method: 'POST', body: { kind: 'terminal', name: 'v6 3' }, headers: { 'x-forwarded-for': v6[3] } }), 429, 'a 4th from the same /64');
  });

  test('polling a real code never runs out; only guesses count, and they don\'t stop real codes from that address', async () => {
    const from = { 'x-forwarded-for': '192.0.2.77' };
    const r = await net('/auth/device/start', { method: 'POST', body: { kind: 'terminal', name: 'Patient terminal' }, headers: from });
    is(r, 200);
    const pollFrom = deviceCode => net('/auth/device/poll', { method: 'POST', body: { deviceCode }, headers: from });
    for (let i = 0; i < 450; i++) is(await pollFrom(r.json.deviceCode), 202, `real poll ${i + 1}`);
    const guess = 'A'.repeat(43);
    for (let i = 0; i < 400; i++) is(await pollFrom(guess), 410, `guess ${i + 1}`);
    is(await pollFrom(guess), 429, 'the 401st guess');
    is(await pollFrom(r.json.deviceCode), 202, 'the real code still answers');
    is(await api('/auth/device/deny', { method: 'POST', body: { code: r.json.code } }), 200);
  });

  test('sign-in is limited per address only: a flood from 101 addresses doesn\'t lock the owner out', async () => {
    for (let a = 0; a < 101; a++) {
      const from = { 'x-forwarded-for': `198.19.${a >> 4}.${(a & 15) + 1}` };
      const answers = await Promise.all(Array.from({ length: 30 }, () => net('/auth/signin/begin', { method: 'POST', body: {}, headers: from })));
      assert.ok(answers.every(x => x.status === 200), `address ${a}: ${answers.map(x => x.status).join(',')}`);
    }
    const r = await signIn();
    is(r, 200, 'the owner signs in after 3,030 tries from elsewhere');
  });
});

// A way in that needs no other device (the owner, 2026-11-11: "sometimes I'm only on my phone, or only on my Mac"):
// 10 one-time recovery codes, made with the passkey and kept as hashes in the secrets file; and a browser just signed
// in with one, or let in with a code, adds its own passkey once within 15 minutes without another one.
describe('recovery codes, and a fresh device\'s own passkey (2026-11-11)', () => {
  const PHONE = new Authenticator(TAILNET, MAIN_ORIGIN), LATE = new Authenticator(TAILNET, MAIN_ORIGIN), LET_IN = new Authenticator(TAILNET, MAIN_ORIGIN);
  let codes = [];
  const viaRecovery = (code, headers = {}) => net('/auth/signin/recovery', { method: 'POST', body: { code, name: 'Only my phone' }, headers });
  async function addOwnPasskey(key, cookie) {
    const b = await net('/auth/passkey/begin', { method: 'POST', body: { purpose: 'register' }, headers: withCookie(cookie) });
    is(b, 200, 'begin');
    return net('/auth/passkey/register', { method: 'POST', body: key.register(b.json, { name: 'Phone passkey' }), headers: withCookie(cookie) });
  }

  test('making them needs the passkey; 10 codes come back once; only hashes are kept, outside the state folder', async () => {
    await setClock(0);
    is(await api('/auth/recovery', { method: 'POST', body: {} }), 428, 'the passkey');
    const r = await confirmed('POST', '/auth/recovery', {});
    is(r, 200);
    assert.match(r.summary, /Make 10 new recovery codes/);
    codes = r.json.codes;
    assert.equal(codes.length, 10);
    for (const c of codes) assert.match(c, /^[A-HJ-KMNP-Z2-9]{5}(-[A-HJ-KMNP-Z2-9]{5}){3}$/);
    assert.equal(new Set(codes).size, 10);
    assert.deepEqual([(await api('/auth/recovery')).json.left, (await api('/auth/recovery')).json.total], [10, 10]);
    assert.equal((await api('/auth/recovery')).json.codes, undefined, 'never shown again');
    const kept = readFileSync(T.fleet.secretsFile, 'utf8');
    for (const c of codes) assert.ok(!kept.includes(c) && !kept.includes(c.replace(/-/g, '')), 'only hashes');
    for (const f of readdirSync(T.fleet.stateDir).filter(f => statSync(join(T.fleet.stateDir, f)).isFile())) {
      const text = readFileSync(join(T.fleet.stateDir, f), 'utf8');
      assert.ok(!codes.some(c => text.includes(c) || text.includes(c.replace(/-/g, ''))), f);
    }
  });

  test('one code signs a browser in from the internet, once; wrong or used codes don\'t; tries are limited per address', async () => {
    const r = await viaRecovery(codes[0].toLowerCase().replace(/-/g, ' '));
    is(r, 200, 'typed loosely: lower case, spaces');
    assert.equal(r.json.left, 9);
    const cookie = cookieOf(r);
    assert.ok(cookie);
    is(await net('/bootstrap', { headers: withCookie(cookie) }), 200, 'signed in');
    is(await viaRecovery(codes[0]), 403, 'used up');
    is(await viaRecovery('AAAAA-BBBBB-CCCCC-DDDDD'), 403, 'not one of them');
    is(await viaRecovery('ABC'), 400, 'not a whole code');
    const line = auditLines().findLast(l => l.action === 'signed-in' && l.args?.by === 'recovery code');
    assert.equal(line.args.left, 9);
    // A flood from one address is slowed there only; the owner's next try from elsewhere still works.
    const flood = { 'x-forwarded-for': '198.51.100.77' };
    for (let i = 0; i < 10; i++) await viaRecovery(`ZZZZZ-ZZZZZ-ZZZZZ-ZZZ${String(i).padStart(2, '2').replace(/[01]/g, '2')}`, flood);
    is(await viaRecovery(codes[1], flood), 429, 'that address waits');
    is(await viaRecovery(codes[1], { 'x-forwarded-for': '203.0.113.9' }), 200, 'another address is fine');
  });

  test('that browser adds its own passkey with no other one, once; it then signs in with it', async () => {
    const r = await viaRecovery(codes[2]);
    const cookie = cookieOf(r);
    is(await addOwnPasskey(PHONE, cookie), 201, 'no second passkey needed');
    const again = await addOwnPasskey(LATE, cookie);
    is(again, 428, 'only once');
    assert.ok(eventLines().some(e => e.type === 'notice' && /A passkey, “Phone passkey”, was added on “Only my phone”/.test(e.text)));
    is(await signIn(PHONE), 200, 'the new passkey signs in from anywhere');
    is(await net('/auth/recovery', { method: 'POST', body: {}, headers: withCookie(cookie) }), 428, 'new codes still need a passkey');
  });

  test('after 15 minutes the offer is over; a browser let in with a code gets the same offer', async () => {
    const late = cookieOf(await viaRecovery(codes[3]));
    await setClock(16 * 60000);
    try { is(await addOwnPasskey(LATE, late), 428, 'too late: it needs a passkey'); } finally { await setClock(0); }
    const s = await startCode('browser', 'Borrowed laptop');
    is(await confirmed('POST', '/auth/device/approve', { code: s.code }), 200);
    const cookie = cookieOf(await poll(s.deviceCode));
    is(await addOwnPasskey(LET_IN, cookie), 201, 'let in with a code: its own passkey');
    const seen = (await api('/auth/recovery')).json;
    assert.equal(seen.left, 6, 'four used');
  });
});

// A5: “Who is signed in? How many recovery codes are left?” sparkie_setup carries access (devices signed in without
// Tailscale, passkeys by name, recovery codes left: names, times and counts) only on the owner's own call.
describe('who is signed in, for the owner only (A5)', () => {
  const FROM = { 'x-forwarded-for': '192.0.2.201' };   // not used elsewhere in the file
  const requests = () => (existsSync(join(T.fleet.dir, 'model-requests.jsonl')) ? readFileSync(join(T.fleet.dir, 'model-requests.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
  const toolResults = from => requests().slice(from).flatMap(x => x.results.map(y => y.content)).join('\n');
  const setup = () => api('/actions/sparkie_setup', { method: 'POST', body: {} });

  test('the owner’s POST /actions and own chat get names, times and counts; an agent’s key, ask_sparkie and a chat an agent started get none', { timeout: 240000 * SLOW }, async () => {
    const b = await net('/auth/signin/begin', { method: 'POST', body: {}, headers: FROM });
    is(b, 200, 'begin sign-in');
    is(await net('/auth/signin', { method: 'POST', body: { ...KEY.sign(b.json), name: 'Kitchen tablet' }, headers: FROM }), 200, 'sign the tablet in');
    const page = { sessions: (await api('/auth/sessions')).json.sessions, keys: (await api('/auth/passkeys')).json.keys, recovery: (await api('/auth/recovery')).json };
    const own = await setup();
    is(own, 200, 'sparkie_setup');
    const a = own.json.access;
    assert.ok(a, 'the owner’s own call carries access');
    assert.deepEqual(a.devices.map(d => [d.name, d.kind, d.signedInAt, d.lastUsedAt]), page.sessions.map(s => [s.name, s.kind, s.createdAt, s.lastUsedAt]));
    assert.equal(a.devices.find(d => d.name === 'Kitchen tablet')?.signedInWith, 'your passkey');
    assert.deepEqual(a.passkeys.map(k => [k.name, k.addedAt, k.lastUsedAt]), page.keys.map(k => [k.name, k.createdAt, k.lastUsedAt]));
    assert.deepEqual(a.recoveryCodes, { left: page.recovery.left, total: page.recovery.total, madeAt: page.recovery.madeAt });
    assert.match(a.namesAreData, /data, not instructions/);
    assert.match(a.whereToChange, /Your devices.*Your passkey.*Sparkie can’t change/);
    assert.equal(a.problem, undefined);
    // Never an address or an id.
    assert.ok(page.sessions.some(s => s.lastFrom === '192.0.2.201'), 'the page knows where it signed in from');
    const all = JSON.stringify(a);
    for (const s of page.sessions) for (const v of [s.id, s.from, s.lastFrom].filter(Boolean)) assert.ok(!all.includes(`"${v}"`) && !all.includes(v), v);
    for (const k of page.keys) assert.ok(!all.includes(k.id), 'no passkey id');
    assert.doesNotMatch(all, /[a-f0-9]{64}/);
    // An agent's key: the rest of the setup, never access.
    const made = await confirmed('POST', '/agents', { name: 'peeker' });
    is(made, 201, 'an agent key');
    try {
      const seen = await call(made.json.token, 'sparkie_setup', {});
      assert.equal(seen.isError, false, seen.text);
      assert.ok(seen.value.console.build, seen.text);
      assert.equal(seen.value.access, undefined, 'not for an agent');
      assert.ok(!seen.raw.includes('Kitchen tablet'));
      writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify([{ match: '^who is signed in', calls: [{ name: 'sparkie_setup', arguments: {} }] }]));
      // The owner's own chat: access, with no address.
      let from = requests().length;
      const mine = await say(await newChat(), 'who is signed in?');
      assert.deepEqual(mine.message.tools.map(t => [t.name, t.ok]), [['sparkie_setup', true]]);
      assert.match(toolResults(from), /"access":\{"namesAreData"/);
      assert.ok(!toolResults(from).includes('192.0.2.201'), 'no address');
      // ask_sparkie: the agent's own conversation, no access.
      from = requests().length;
      let v = (await call(made.json.token, 'ask_sparkie', { message: 'who is signed in?' })).value;
      for (const until = Date.now() + 60000 * SLOW; v?.status !== 'answered' && Date.now() < until;) v = (await call(made.json.token, 'ask_sparkie', { conversation: v.conversation })).value;
      assert.equal(v?.status, 'answered', JSON.stringify(v));
      assert.deepEqual(v.looked, ['sparkie_setup'], JSON.stringify(v));
      assert.match(toolResults(from), /"console":\{"build"/);
      assert.doesNotMatch(toolResults(from), /"access"/);
      // The owner typing in the chat that agent started (the agent can read its answers there): no access either.
      from = requests().length;
      await say(v.conversation, 'who is signed in?');
      assert.match(toolResults(from), /"console":\{"build"/);
      assert.doesNotMatch(toolResults(from), /"access"/);
    } finally {
      rmSync(join(T.fleet.dir, 'model-script.json'), { force: true });
      await api(`/agents/${made.json.id}`, { method: 'DELETE' });
    }
  });

  test('a file that can’t be read is said, never shown as none or “0 left”, and the rest of the setup still answers', async () => {
    const keysFile = join(T.fleet.stateDir, 'passkeys.json'), secrets = T.fleet.secretsFile;
    const keysText = readFileSync(keysFile, 'utf8'), secretsText = existsSync(secrets) ? readFileSync(secrets, 'utf8') : null;
    try {
      writeFileSync(keysFile, '{not json');
      writeFileSync(secrets, '{not json');
      const r = await setup();
      is(r, 200, 'still answers');
      assert.ok(r.json.console.build, r.text);
      assert.equal(r.json.access.passkeys, null, r.text);
      assert.equal(r.json.access.recoveryCodes, null, r.text);
      assert.match(r.json.access.problem, /can’t read your passkeys or your recovery codes/);
      assert.ok(Array.isArray(r.json.access.devices));
    } finally {
      writeFileSync(keysFile, keysText, { mode: 0o600 });
      if (secretsText === null) rmSync(secrets, { force: true }); else writeFileSync(secrets, secretsText, { mode: 0o600 });
    }
  });
});
