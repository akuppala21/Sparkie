// Covers: State put back from a copy lets no device or key in by itself (E2c; contract 6.25; design E 2.5, P-3;
// 22-putback.mjs). A state that holds a passkey has a number from the first (1, in the state and the secrets file); each
// removal (a passkey, an agent key, agents paused, a device signed out, a right taken from an agent key) raises it in
// both and the secrets file notes what went. An older copy put back
// on the same disk: what was removed since is removed again, every device is signed out (also a session the copy still
// held), the owner's pause comes back, a task under way is parked with a line in its chat, and the hold follows. Under
// it, from the internet, a passkey, a recovery code, a device code and an agent key get one plain line; an agent's
// change on the tailnet is refused; the tailnet door, the owner's own chat words and /health work. The owner looks at
// the list on the tailnet and keeps it with the passkey (never from the internet); then the internet signs in again,
// the removed passkey and key stay out, and a counter older in the copy than in the passkey breaks nothing. The next
// start holds no more. A new disk (a number in the state, no secrets file) holds too, also with a copy taken before
// anything was removed. Under the hold whoami offers no sign-in, and a secrets file that can't be read keeps the hold.
// restore.sh --with-state over the state as it is (nothing emptied first), then a start: with the line that takes the
// state's number away left out (as every snapshot made before this build has it), something removed since that is back
// is a put-back all the same; with it, the start always holds, a key's narrowing comes back undone and is taken again,
// and with nothing removed since nothing is removed and "Keep these" ends it; a saved workflow's run on record in the
// snapshot never comes back, so the start stops nothing of that name (R57); a narrowing notes only the right it took, so a
// put-back never takes one the owner never took. go-back.sh and an update's way back put
// back program files only and never trip it. An always-allowed kind taken away raises the number too: an older copy put
// back by hand holds, and the kind is taken away again (not live before or after "Keep these").
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, cpSync, chmodSync, readdirSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { T, request, call, newChat, say, eventLines, waitFor, sleep, createActKey, api, ASK, SLOW } from './lib.mjs';
import { startMock, serviceConfig, REPO } from './start-mock.mjs';
import { Authenticator, passkeyHeader } from './authenticator.mjs';

const ORIGIN = serviceConfig().origin, TAILNET = new URL(ORIGIN).hostname.split('.').slice(1).join('.');
const K1 = new Authenticator(TAILNET, ORIGIN), K2 = new Authenticator(TAILNET, ORIGIN);
const FUNNEL = { 'tailscale-funnel-request': '?1' };
const LINE = 'Spark Console’s state was put back from a copy. Open it once on your tailnet and look at the list of what came back; after that, sign-in from the internet works again.';
const parse = t => { try { return JSON.parse(t || 'null'); } catch { return null; } };
const ask = (F, path, { method = 'GET', body, headers = {} } = {}) => request(`${F.base}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body),
  headers: { ...(method === 'GET' ? {} : { 'content-type': 'application/json', 'x-spark-console': '1', origin: F.origin }), ...headers } }).then(r => ({ ...r, json: parse(r.text) }));
const net = (F, path, opts = {}) => ask(F, path, { ...opts, headers: { ...FUNNEL, ...(opts.headers || {}) } });
const is = (r, status, what = '') => assert.equal(r.status, status, `${what} → ${r.status} ${r.text}`);
const cookieOf = r => /^sc_session=(scs_[A-Za-z0-9_-]{43});/.exec(String(r.headers.get('set-cookie') || ''))?.[1] || null;
const withCookie = c => ({ cookie: `other=1; sc_session=${c}` });
async function confirmed(F, method, path, body, key = K1) {
  const b = await ask(F, '/auth/passkey/begin', { method: 'POST', body: { purpose: 'confirm', method, path, ...(body === undefined ? {} : { body }) } });
  is(b, 200, `begin confirm ${method} ${path}`);
  return ask(F, path, { method, body, headers: { 'x-spark-passkey': passkeyHeader(key.sign(b.json)) } });
}
async function signIn(F, key, signCount = 0) {
  const b = await net(F, '/auth/signin/begin', { method: 'POST', body: {} });
  if (b.status !== 200) return b;
  return net(F, '/auth/signin', { method: 'POST', body: { ...key.sign(b.json, { signCount }), name: 'Phone' } });
}
const serialIn = F => parse(existsSync(join(F.stateDir, 'auth-serial.json')) ? readFileSync(join(F.stateDir, 'auth-serial.json'), 'utf8') : null)?.serial ?? null;
const secretsOf = F => (existsSync(F.secretsFile) ? JSON.parse(readFileSync(F.secretsFile, 'utf8')) : null);
const use = F => Object.assign(T, { fleet: F, base: F.base, mcp: F.mcp, origin: F.origin });
// A copy of a state folder as it is now (sockets left out), and a fleet started from one, with a secrets file or none.
const COPIES = mkdtempSync(join(tmpdir(), 'sct-putback-'));
after(() => rmSync(COPIES, { recursive: true, force: true }));
function copyState(F, name) {
  const to = join(COPIES, name);
  cpSync(F.stateDir, to, { recursive: true, filter: p => !p.endsWith('.sock') });
  return to;
}
const startFrom = (state, secrets, change = null) => startMock({ prepare: ({ stateDir, dir }) => {
  for (const f of readdirSync(stateDir)) rmSync(join(stateDir, f), { recursive: true, force: true });
  cpSync(state, stateDir, { recursive: true });
  if (secrets) { mkdirSync(join(dir, 'secrets'), { recursive: true, mode: 0o700 }); writeFileSync(join(dir, 'secrets', 'secrets.json'), secrets, { mode: 0o600 }); }
  change?.(stateDir);
} });

describe('state put back from a copy', { concurrency: 1 }, () => {
  let F, G, older, secrets, codes, a1, a2, oldCookie;
  after(async () => { await F?.stop(); await G?.stop(); });

  test('a state with a passkey has a number from the first (1, nothing removed yet): no hold, and the internet signs in', { timeout: 300000 * SLOW }, async () => {
    F = await startMock({});
    use(F);
    is(await ask(F, '/auth/passkey/register', { method: 'POST', body: K1.register((await ask(F, '/auth/passkey/begin', { method: 'POST', body: { purpose: 'register' } })).json) }), 201, 'K1');
    const b2 = await ask(F, '/auth/passkey/begin', { method: 'POST', body: { purpose: 'register' } });
    is(await confirmed(F, 'POST', '/auth/passkey/register', K2.register(b2.json, { name: 'Old phone' })), 201, 'K2');
    for (const name of ['Kept agent', 'Removed agent']) {
      const k = await confirmed(F, 'POST', '/agents', { name });
      is(k, 201, name);
      is(await confirmed(F, 'PUT', `/agents/${k.json.id}`, { act: true, internet: true }), 200, `${name} acts, from anywhere`);
      if (!a1) a1 = k.json; else a2 = k.json;
    }
    const rc = await confirmed(F, 'POST', '/auth/recovery', {});
    is(rc, 200, 'recovery codes');
    codes = rc.json.codes;
    const w = await net(F, '/whoami');
    assert.equal(w.json.held, undefined);
    assert.equal(serialIn(F), 1, 'the first passkey gave the state its number: nothing was removed yet');
    assert.equal(secretsOf(F).auth.serial, 1, 'and the secrets file the same');
    const c = await signIn(F, K1, 5);
    is(c, 200, 'a browser signs in with the passkey (its counter at 5)');
    oldCookie = cookieOf(c);
    is(await net(F, '/bootstrap', { headers: withCookie(oldCookie) }), 200);
    is(await net(F, '/v1/models', { headers: { authorization: `Bearer ${a1.token}` } }), 200, 'an agent key from anywhere');
    // The copy, as an older copy or snapshot holds it: with the session in it.
    older = copyState(F, 'older');
    assert.ok(existsSync(join(older, 'sessions.json')));
  });

  test('each removal raises the number in the state and the secrets file, and the secrets file notes what went', { timeout: 120000 * SLOW }, async () => {
    is(await confirmed(F, 'DELETE', `/auth/passkeys/${K2.id}`), 200, 'a passkey removed');
    is(await ask(F, `/agents/${a2.id}`, { method: 'DELETE' }), 200, 'an agent key removed');
    is(await ask(F, '/agents/settings', { method: 'PUT', body: { halted: true } }), 200, 'agents paused');
    is(await signIn(F, K1, 10), 200, 'used again since (its counter at 10)');
    is(await net(F, '/auth/signout', { method: 'POST', body: {}, headers: withCookie(oldCookie) }), 200, 'the copy’s device signed out');
    assert.equal(serialIn(F), 5);
    const s = secretsOf(F);
    assert.equal(s.auth.serial, 5);
    assert.equal(s.auth.halted, true);
    assert.deepEqual(s.auth.removed.map(r => r.kind), ['passkey', 'agent', 'session']);
    assert.deepEqual(s.auth.removed.slice(0, 2).map(r => r.id), [K2.id, a2.id]);
    secrets = readFileSync(F.secretsFile, 'utf8');
    await F.stop(); F = null;
  });

  test('the older copy put back on the same disk: removed again, every device out, the pause back, a task parked, and the hold', { timeout: 300000 * SLOW }, async () => {
    G = await startFrom(older, secrets, stateDir => {
      // (a task under way when the copy was made)
      const f = join(stateDir, 'chats.json'), c = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { conversations: [] };
      c.conversations.push({ id: 'sc_00000000000000aa', login: 'owner@test', title: 'A long job', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        messages: [{ role: 'user', content: 'run the long job and tell me', createdAt: new Date().toISOString() }], task: { request: 'run the long job and tell me', at: new Date().toISOString(), continuations: 0 } });
      writeFileSync(f, JSON.stringify(c), { mode: 0o600 });
    });
    use(G);
    const s = secretsOf(G);
    assert.ok(s.auth.hold, JSON.stringify(s.auth));
    assert.deepEqual(JSON.parse(readFileSync(join(G.stateDir, 'sessions.json'), 'utf8')).sessions, [], 'every device signed out');
    assert.deepEqual(JSON.parse(readFileSync(join(G.stateDir, 'passkeys.json'), 'utf8')).keys.map(k => k.id), [K1.id], 'the removed passkey removed again');
    assert.deepEqual(JSON.parse(readFileSync(join(G.stateDir, 'agents.json'), 'utf8')).keys.map(k => k.id), [a1.id], 'the removed key removed again');
    assert.equal(JSON.parse(readFileSync(join(G.stateDir, 'agent-settings.json'), 'utf8')).halted, true, 'the owner’s pause came back');
    const conv = JSON.parse(readFileSync(join(G.stateDir, 'chats.json'), 'utf8')).conversations.find(c => c.id === 'sc_00000000000000aa');
    assert.equal(conv.task, null, 'parked');
    assert.match(conv.messages.at(-1).content, /^Spark Console’s state was put back from a copy, so “run the long job and tell me” isn’t carried on\./);
    assert.ok(eventLines(G).some(e => e.type === 'notice' && /^Spark Console’s state was put back from a copy\. What you had removed since came back and was removed again \(passkey “Old phone”, agent key “Removed agent”\)\./.test(e.text)));
  });

  test('under the hold, from the internet: one plain line for a passkey, a recovery code, a device code and an agent key; the old cookie signs nothing in', { timeout: 120000 * SLOW }, async () => {
    assert.equal((await net(G, '/whoami')).json.held, LINE);
    for (const r of [await signIn(G, K1, 11), await net(G, '/auth/signin/recovery', { method: 'POST', body: { code: codes[0] } }),
      await net(G, '/auth/device/start', { method: 'POST', body: { kind: 'terminal', name: 'T' } }), await net(G, '/v1/models', { headers: { authorization: `Bearer ${a1.token}` } })]) {
      is(r, 403);
      // (the model address answers errors in its own shape: { error: { message, type } })
      assert.equal(r.json.error?.message ?? r.json.error, LINE);
    }
    is(await net(G, '/bootstrap', { headers: withCookie(oldCookie) }), 401, 'the cookie the copy held');
  });

  test('under the hold, whoami offers no sign-in from the internet, and a secrets file that can’t be read keeps the hold', { timeout: 120000 * SLOW }, async () => {
    const w = (await net(G, '/whoami')).json;
    assert.deepEqual([w.held, w.signin, w.recovery], [LINE, false, false], 'neither the passkey nor a recovery code signs in now');
    const kept = readFileSync(G.secretsFile, 'utf8');
    try {
      writeFileSync(G.secretsFile, kept.slice(0, 20), { mode: 0o600 });
      await sleep(800);
      assert.equal((await net(G, '/whoami')).json.held, LINE, 'still held');
      const s = await signIn(G, K1, 11);
      is(s, 403, 'a passkey from the internet');
      assert.equal(s.json.error, LINE);
    } finally { writeFileSync(G.secretsFile, kept, { mode: 0o600 }); }
    await sleep(800);
    assert.equal((await net(G, '/whoami')).json.held, LINE, 'readable again: held');
  });

  test('under the hold, on the tailnet: the owner at once, the owner’s words and /health; an agent may look but its change is refused', { timeout: 120000 * SLOW }, async () => {
    const boot = await ask(G, '/bootstrap');
    is(boot, 200);
    assert.deepEqual([boot.json.viewer.role, boot.json.putBack], ['owner', true]);
    is(await ask(G, '/status'), 200);
    is(await ask(G, '/health'), 200);
    assert.match((await say(await newChat(), '/status')).text, /\S/, 'a word the page’s chat answers by code');
    const look = await call(a1.token, 'fleet_status', {});
    assert.equal(look.isError, false, look.text);
    const change = await call(a1.token, 'stop_model', { spark: 'spark4', container: 'sc-RadixArk--Qwen3.8-27B-NVFP4' });
    assert.equal(change.isError, true);
    assert.match(change.text, /state was put back from a copy, so agents can’t change anything/);
    const needs = (await ask(G, '/actions/fleet_status', { method: 'POST', body: {} })).json.needsOwner;
    assert.ok(needs.some(l => /^Spark Console’s state was put back from a copy/.test(l)), JSON.stringify(needs));
    const l = (await ask(G, '/auth/putback')).json;
    assert.deepEqual([l.held, l.passkeys.map(k => k.id), l.agentKeys.map(k => k.id), l.agentsPaused, l.parked], [true, [K1.id], [a1.id], true, 1]);
    assert.deepEqual(l.removedAgain, [{ kind: 'passkey', name: 'Old phone' }, { kind: 'agent key', name: 'Removed agent' }]);
  });

  test('“Keep these” only on the tailnet, with the passkey; then the internet signs in again, what was removed stays out, an older counter breaks nothing', { timeout: 120000 * SLOW }, async () => {
    assert.notEqual((await net(G, '/auth/putback/keep', { method: 'POST', body: {} })).status, 200, 'not from the internet');
    is(await ask(G, '/auth/putback/keep', { method: 'POST', body: {} }), 428, 'with the passkey');
    const k = await confirmed(G, 'POST', '/auth/putback/keep', {});
    is(k, 200);
    assert.equal(k.json.kept, true);
    assert.equal((await net(G, '/whoami')).json.held, undefined);
    assert.equal(serialIn(G), 5);
    assert.equal(secretsOf(G).auth.hold, undefined);
    const went = () => eventLines(G).filter(e => e.type === 'notice' && /lower count than before/.test(e.text || '')).length;
    // (the copy holds 5, the passkey itself had reached 10; the confirmation above was signed at 0, and was noted)
    const before = went();
    const c = await signIn(G, K1, 7);
    is(c, 200, 'a count above the copy’s');
    await sleep(500);
    assert.equal(went(), before, 'not noted');
    is(await signIn(G, K1, 3), 200, 'a count below the one kept now: accepted');
    await waitFor(() => went() === before + 1, { timeout: 10000, what: 'the counter note' });
    is(await net(G, '/auth/signin/recovery', { method: 'POST', body: { code: codes[1] } }), 200, 'a recovery code');
    const k2 = await signIn(G, K2, 50);
    is(k2, 403, 'the passkey removed since');
    is(await net(G, '/v1/models', { headers: { authorization: `Bearer ${a1.token}` } }), 200, 'the kept key from anywhere');
    is(await net(G, '/v1/models', { headers: { authorization: `Bearer ${a2.token}` } }), 401, 'the removed key');
    assert.ok(!(await ask(G, '/actions/fleet_status', { method: 'POST', body: {} })).json.needsOwner.some(l => /put back from a copy/.test(l)));
  });

  test('the next start, with nothing removed since: no hold', { timeout: 180000 * SLOW }, async () => {
    const state = copyState(G, 'after-keep'), s = readFileSync(G.secretsFile, 'utf8');
    await G.stop(); G = null;
    const H = await startFrom(state, s);
    try {
      assert.equal((await net(H, '/whoami')).json.held, undefined);
      assert.equal(JSON.parse(readFileSync(H.secretsFile, 'utf8')).auth.hold, undefined);
      is(await signIn(H, K1, 12), 200);
    } finally { await H.stop(); }
  });

  test('a new disk (a number in the state, no secrets file): held; the owner on the tailnet is the owner at once and keeps it', { timeout: 180000 * SLOW }, async () => {
    const N = await startFrom(older, null, stateDir => writeFileSync(join(stateDir, 'auth-serial.json'), JSON.stringify({ serial: 4 }), { mode: 0o600 }));
    try {
      assert.equal((await net(N, '/whoami')).json.held, LINE);
      assert.deepEqual(JSON.parse(readFileSync(join(N.stateDir, 'sessions.json'), 'utf8')).sessions, []);
      is(await signIn(N, K1, 20), 403);
      const boot = await ask(N, '/bootstrap');
      assert.deepEqual([boot.json.viewer.role, boot.json.putBack], ['owner', true]);
      is(await confirmed(N, 'POST', '/auth/putback/keep', {}), 200);
      is(await signIn(N, K1, 21), 200, 'from the internet again');
    } finally { await N.stop(); }
  });

  test('a new disk, with a copy taken before anything was removed (it carries the number its first passkey gave it): held too', { timeout: 180000 * SLOW }, async () => {
    assert.equal(parse(readFileSync(join(older, 'auth-serial.json'), 'utf8'))?.serial, 1);
    const N = await startFrom(older, null);
    try {
      assert.equal((await net(N, '/whoami')).json.held, LINE);
      const k2 = await signIn(N, K2, 60);
      is(k2, 403, 'the passkey removed after that copy');
      assert.equal(k2.json.error, LINE);
      const r = await net(N, '/v1/models', { headers: { authorization: `Bearer ${a2.token}` } });
      is(r, 403, 'the agent key removed after that copy');
      assert.equal(r.json.error?.message ?? r.json.error, LINE);
    } finally { await N.stop(); }
  });
});

// restore.sh --with-state run over the state folder as it is (nothing emptied first: it copies the snapshot's files
// over the live ones and leaves the rest), then a start on that same folder. The snapshot has no number, as every
// snapshot made before this build. restore.sh runs in a made-up home whose state folder is a link to the fleet's own,
// with a stand-in systemctl and curl, before the service starts. (RESTORE, the installer's text, is below.)
describe('restore.sh --with-state over the state as it is, then a start', { concurrency: 1 }, () => {
  const K3 = new Authenticator(TAILNET, ORIGIN), K4 = new Authenticator(TAILNET, ORIGIN);
  let R, Q, before, live, secrets, b1, b2, b3, same, now, kept;
  after(async () => { await R?.stop(); await Q?.stop(); });
  const startAfterRestore = (state, kept, snapshot, script) => startMock({ prepare: ({ dir, stateDir }) => {
    cpSync(state, stateDir, { recursive: true });
    const h = mkdtempSync(join(COPIES, 'home-')), snap = join(h, 'snap'), bin = join(h, 'bin');
    for (const d of [join(snap, 'state'), bin, join(h, '.local', 'state')]) mkdirSync(d, { recursive: true });
    symlinkSync(stateDir, join(h, '.local', 'state', 'spark-console'));
    cpSync(snapshot, join(snap, 'state'), { recursive: true });
    writeFileSync(join(snap, 'restore.sh'), script, { mode: 0o700 });
    writeFileSync(join(bin, 'systemctl'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    writeFileSync(join(bin, 'curl'), '#!/bin/sh\necho \'{"ok":true}\'\n', { mode: 0o755 });
    const r = spawnSync('bash', [join(snap, 'restore.sh'), '--with-state', '--stand-in'], { env: { ...process.env, HOME: h, PATH: `${bin}:${process.env.PATH}`, SPARK_CONSOLE_ALL_LOCAL: '1' }, encoding: 'utf8', timeout: 60000 * SLOW });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    mkdirSync(join(dir, 'secrets'), { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, 'secrets', 'secrets.json'), kept, { mode: 0o600 });
  } });
  const keysIn = F => JSON.parse(readFileSync(join(F.stateDir, 'agents.json'), 'utf8')).keys;
  const passkeyIds = F => JSON.parse(readFileSync(join(F.stateDir, 'passkeys.json'), 'utf8')).keys.map(k => k.id);
  const bearer = k => ({ headers: { authorization: `Bearer ${k.token}` } });

  test('the owner’s state: a snapshot with no number; since then a passkey and an agent key removed, and a key narrowed (which raises the number too)', { timeout: 300000 * SLOW }, async () => {
    R = await startMock({});
    is(await ask(R, '/auth/passkey/register', { method: 'POST', body: K3.register((await ask(R, '/auth/passkey/begin', { method: 'POST', body: { purpose: 'register' } })).json) }), 201, 'K3');
    const b = await ask(R, '/auth/passkey/begin', { method: 'POST', body: { purpose: 'register' } });
    is(await confirmed(R, 'POST', '/auth/passkey/register', K4.register(b.json, { name: 'Lost phone' }), K3), 201, 'K4');
    const made = [];
    for (const name of ['Kept agent', 'Removed agent', 'Narrowed agent']) {
      const k = await confirmed(R, 'POST', '/agents', { name }, K3);
      is(k, 201, name);
      is(await confirmed(R, 'PUT', `/agents/${k.json.id}`, { act: true, internet: true }, K3), 200, `${name} acts, from anywhere`);
      made.push(k.json);
    }
    [b1, b2, b3] = made;
    before = copyState(R, 'before');
    rmSync(join(before, 'auth-serial.json'), { force: true });
    is(await net(R, '/v1/models', bearer(b3)), 200, 'the key to be narrowed, from the internet');
    is(await confirmed(R, 'DELETE', `/auth/passkeys/${K4.id}`, undefined, K3), 200, 'a passkey removed');
    is(await ask(R, `/agents/${b2.id}`, { method: 'DELETE' }), 200, 'an agent key removed');
    const n = serialIn(R);
    is(await confirmed(R, 'PUT', `/agents/${b3.id}`, { act: false, internet: false }, K3), 200, 'look-only and tailnet-only');
    assert.equal(serialIn(R), n + 1, 'a narrowing raises the number as a removal does');
    const s = secretsOf(R);
    assert.equal(s.auth.serial, n + 1);
    assert.deepEqual((({ kind, id, act, internet }) => ({ kind, id, act, internet }))(s.auth.removed.at(-1)), { kind: 'narrowed', id: b3.id, act: false, internet: false });
    is(await net(R, '/v1/models', bearer(b3)), 401, 'tailnet-only now');
    live = copyState(R, 'live');
    secrets = readFileSync(R.secretsFile, 'utf8');
    await R.stop(); R = null;
  });

  test('restore.sh as every snapshot made before this build has it (the state’s number stays): what was removed is back, so it holds, and both are removed again', { timeout: 180000 * SLOW }, async () => {
    const script = RESTORE.replace('  rm -f "$HOME/.local/state/spark-console/auth-serial.json"\n', '');
    assert.notEqual(script, RESTORE, 'the line that takes the number away, left out');
    const A = await startAfterRestore(live, secrets, before, script);
    try {
      assert.equal(serialIn(A), JSON.parse(secrets).auth.serial, 'the two numbers are the same: they don’t show it');
      assert.equal((await net(A, '/whoami')).json.held, LINE);
      assert.deepEqual(passkeyIds(A), [K3.id], 'the removed passkey removed again');
      assert.deepEqual(keysIn(A).map(k => k.id), [b1.id, b3.id], 'the removed key removed again');
      const k4 = await signIn(A, K4, 70);
      is(k4, 403);
      assert.equal(k4.json.error, LINE);
    } finally { await A.stop(); }
  });

  test('the installer’s restore.sh from the same snapshot: it holds; what was removed since is removed again, and the narrowed key is look-only and tailnet-only again', { timeout: 180000 * SLOW }, async () => {
    Q = await startAfterRestore(live, secrets, before, RESTORE);
    assert.equal(serialIn(Q), null, 'restore.sh took the state’s number away');
    assert.equal((await net(Q, '/whoami')).json.held, LINE);
    assert.deepEqual(passkeyIds(Q), [K3.id]);
    assert.deepEqual(keysIn(Q).map(k => [k.id, k.scopes, k.internet]), [[b1.id, ['fleet:read', 'fleet:act'], true], [b3.id, ['fleet:read'], false]]);
    const l = (await ask(Q, '/auth/putback')).json;
    assert.deepEqual(l.agentKeys.map(k => [k.name, k.canChange, k.fromAnywhere]), [['Kept agent', true, true], ['Narrowed agent', false, false]]);
    assert.deepEqual(l.removedAgain, [{ kind: 'passkey', name: 'Lost phone' }, { kind: 'agent key', name: 'Removed agent' },
      { kind: 'agent key’s right to change things', name: 'Narrowed agent' }, { kind: 'agent key’s use from the internet', name: 'Narrowed agent' }]);
    is(await confirmed(Q, 'POST', '/auth/putback/keep', {}, K3), 200);
    is(await net(Q, '/v1/models', bearer(b3)), 401, 'the narrowed key, from the internet');
    is(await net(Q, '/v1/models', bearer(b1)), 200, 'the kept key, from anywhere');
  });

  test('nothing removed since the snapshot: the installer’s restore.sh still holds, nothing is removed, and “Keep these” ends it', { timeout: 180000 * SLOW }, async () => {
    [same, now, kept] = [copyState(Q, 'same'), copyState(Q, 'now'), readFileSync(Q.secretsFile, 'utf8')];
    assert.ok(existsSync(join(same, 'auth-serial.json')), 'this snapshot has a number');
    await Q.stop(); Q = null;
    const C = await startAfterRestore(now, kept, same, RESTORE);
    try {
      assert.equal((await net(C, '/whoami')).json.held, LINE);
      const l = (await ask(C, '/auth/putback')).json;
      assert.deepEqual([l.held, l.removedAgain, l.passkeys.map(k => k.id), l.agentKeys.map(k => k.id)], [true, [], [K3.id], [b1.id, b3.id]]);
      is(await confirmed(C, 'POST', '/auth/putback/keep', {}, K3), 200);
      assert.equal((await net(C, '/whoami')).json.held, undefined);
      is(await signIn(C, K3, 80), 200, 'the internet signs in again');
    } finally { await C.stop(); }
  });

  test('a saved workflow’s run on record in the snapshot: restore.sh --with-state leaves it out, so the start stops nothing of that name', { timeout: 180000 * SLOW }, async () => {
    const RADIX = 'sc-RadixArk--Qwen3.8-27B-NVFP4', snap = join(COPIES, 'with-a-run');
    cpSync(same, snap, { recursive: true });
    writeFileSync(join(snap, 'saved-runs.json'), JSON.stringify({ runs: { 'op-from-then': { operation: 'op-from-then', since: '2026-11-10T08:00:00.000Z', title: 'the run from then',
      chat: null, steps: 2, step: 2, started: [{ kind: 'model', spark: 'spark4', container: RADIX }], pending: [], awake: [] } } }), { mode: 0o600 });
    const D = await startAfterRestore(now, kept, snap, RESTORE);
    try {
      const stateOf = (spark, name) => readFileSync(join(D.root, spark, '.mock', 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];
      assert.equal(existsSync(join(D.stateDir, 'saved-runs.json')), false, 'the record didn’t come back');
      // (the start-up clean-up runs at once; a stop on the stand-in fleet takes a second or two)
      const acted = await waitFor(() => stateOf('spark4', RADIX) !== 'running' || eventLines(D).some(e => e.type === 'notice' && /the run from then/.test(e.text || '')),
        { timeout: 10000 * SLOW, every: 250, what: 'anything done about the run from then' }).catch(() => false);
      assert.equal(acted, false, eventLines(D).filter(e => e.type === 'notice').map(e => e.text).join('\n'));
      assert.equal(stateOf('spark4', RADIX), 'running');
    } finally { await D.stop(); }
  });

  test('a narrowing notes only the right it took: a put-back never takes one the owner never took', { timeout: 300000 * SLOW }, async () => {
    const K5 = new Authenticator(TAILNET, ORIGIN);
    let S = await startMock({}), E = null;
    try {
      is(await ask(S, '/auth/passkey/register', { method: 'POST', body: K5.register((await ask(S, '/auth/passkey/begin', { method: 'POST', body: { purpose: 'register' } })).json) }), 201, 'K5');
      // A new key is look-only and tailnet-only. The owner lets it change things, takes that away, then gives it both.
      const k = await confirmed(S, 'POST', '/agents', { name: 'Given-back agent' }, K5);
      is(k, 201);
      is(await confirmed(S, 'PUT', `/agents/${k.json.id}`, { act: true }, K5), 200, 'it may change things');
      is(await confirmed(S, 'PUT', `/agents/${k.json.id}`, { act: false }, K5), 200, 'not any more');
      assert.deepEqual((({ kind, act, internet }) => ({ kind, act, internet }))(secretsOf(S).auth.removed.at(-1)), { kind: 'narrowed', act: false, internet: undefined }, 'the right it took, only');
      is(await confirmed(S, 'PUT', `/agents/${k.json.id}`, { act: true, internet: true }, K5), 200, 'both given');
      const snap = copyState(S, 'given-back'), state = copyState(S, 'given-back-now'), s = readFileSync(S.secretsFile, 'utf8');
      await S.stop(); S = null;
      E = await startAfterRestore(state, s, snap, RESTORE);
      assert.equal((await net(E, '/whoami')).json.held, LINE);
      const key = keysIn(E).find(x => x.id === k.json.id);
      assert.equal(key.internet, true, 'its use from the internet, which the owner never took, stays');
      assert.deepEqual((await ask(E, '/auth/putback')).json.removedAgain, [{ kind: 'agent key’s right to change things', name: 'Given-back agent' }]);
    } finally { await S?.stop(); await E?.stop(); }
  });
});

// restore.sh, as the installer writes it into each snapshot; go-back.sh; the update's way back.
const INSTALLER = readFileSync(join(REPO, 'deploy', 'host-on-portal.sh'), 'utf8');
const RESTORE = INSTALLER.slice(INSTALLER.indexOf('\n', INSTALLER.indexOf(`cat > "$SNAP/restore.sh" <<'RESTORE'\n`)) + 1, INSTALLER.indexOf('\nRESTORE\n') + 1);
describe('go-back.sh and an update’s way back never trip the hold', () => {
  function home() {
    const h = mkdtempSync(join(tmpdir(), 'sct-putback-home-')), snap = join(h, 'snap'), live = join(h, '.local', 'state', 'spark-console'), bin = join(h, 'bin');
    for (const d of [join(snap, 'state'), join(snap, 'spark-console'), join(snap, 'spark-console-service'), live, bin, join(h, 'spark-console'), join(h, 'spark-console-service')]) mkdirSync(d, { recursive: true });
    writeFileSync(join(snap, 'restore.sh'), RESTORE, { mode: 0o700 });
    writeFileSync(join(snap, 'state', 'auth-serial.json'), '{"serial":2}');
    writeFileSync(join(live, 'auth-serial.json'), '{"serial":5}');
    writeFileSync(join(bin, 'systemctl'), '#!/bin/sh\nexit 0\n');
    writeFileSync(join(bin, 'curl'), '#!/bin/sh\necho \'{"ok":true}\'\n');
    for (const f of ['systemctl', 'curl']) chmodSync(join(bin, f), 0o755);
    return { h, snap, live, bin };
  }
  // (SPARK_CONSOLE_ALL_LOCAL keeps the stand-ins first on the PATH, as on the stand-in fleet)
  // (--stand-in: the stand-ins' PATH, as the stand-in fleet's tests say it, R53)
  const run = (x, ...args) => spawnSync('bash', [join(x.snap, 'restore.sh'), ...args, '--stand-in'], { env: { ...process.env, HOME: x.h, PATH: `${x.bin}:${process.env.PATH}`, SPARK_CONSOLE_ALL_LOCAL: '1' }, encoding: 'utf8', timeout: 60000 * SLOW });

  test('restore.sh without --with-state (what go-back.sh runs) leaves the state, and its number, as they are', () => {
    const x = home();
    try {
      const r = run(x);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(readFileSync(join(x.live, 'auth-serial.json'), 'utf8'), '{"serial":5}');
    } finally { rmSync(x.h, { recursive: true, force: true }); }
    const goBack = readFileSync(join(REPO, 'deploy', 'go-back.sh'), 'utf8').split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
    assert.doesNotMatch(goBack, /--with-state/, 'go-back.sh never puts state back');
    assert.match(goBack, /exec bash "\$last\/restore\.sh"\n/);
  });

  test('restore.sh --with-state signs every device out and takes the state’s number away, whether or not anything was removed since the snapshot', () => {
    const x = home();
    try {
      writeFileSync(join(x.snap, 'state', 'auth-serial.json'), '{"serial":5}');
      writeFileSync(join(x.live, 'sessions.json'), JSON.stringify({ sessions: [{ id: 'signedinnow1', hash: 'b'.repeat(64) }] }));
      const r = run(x, '--with-state');
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.ok(!existsSync(join(x.live, 'sessions.json')), 'no device stays signed in');
      assert.ok(!existsSync(join(x.live, 'auth-serial.json')), 'nothing was removed since: the hold follows all the same (and “Keep these” ends it: the test above)');
    } finally { rmSync(x.h, { recursive: true, force: true }); }
  });

  test('restore.sh --with-state leaves the state with no number, not even the snapshot’s older one, so the next start holds', () => {
    const x = home();
    try {
      const r = run(x, '--with-state');
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.ok(!existsSync(join(x.live, 'auth-serial.json')), readdirSync(x.live).join(' '));
    } finally { rmSync(x.h, { recursive: true, force: true }); }
  });

  test('an update’s way back (update-guard.sh) writes no file in the state folder but its own result, and never the secrets file', () => {
    const g = readFileSync(join(REPO, 'deploy', 'update-guard.sh'), 'utf8');
    const stateWrites = [...g.matchAll(/"\$STATE\/([\w.-]+)"/g)].map(m => m[1]);
    assert.deepEqual([...new Set(stateWrites)].sort(), ['api.sock', 'update-result.json']);
    assert.doesNotMatch(g, /auth-serial|secrets\.json|\.config\/spark-console/);
  });
});

// The paired Telegram chat under the hold (the pairing is in the secrets file: it never came back). The owner's own
// everyday requests there are answered and run; a press on an approval there is refused with its line; an agent's
// change asked through its chat with Sparkie is refused. Held from the start: a state number below the secrets file's.
describe('under the hold, the paired Telegram chat', { concurrency: 1 }, () => {
  const TOKEN = '123456789:AAEtestTokenForSparkConsoleXYZ_abcdefghij', OWNER_TG = 5550001;
  const TESTORG = 'sc-testorg--Qwen3.8-27B-abliterated-GGUF', RADIX = 'sc-RadixArk--Qwen3.8-27B-NVFP4';
  const TG_LINE = 'Spark Console’s state was put back from a copy, so this waits until you have looked at what came back: open Spark Console once on your tailnet.';
  let P, agent, msgId = 1;
  before(async () => {
    P = await startMock({ telegram: true, knowledge: true, watchMs: 60000, env: { SPARK_CONSOLE_TELEGRAM_LIMITS: '1000,1000,1000' }, prepare: ({ dir, stateDir }) => {
      mkdirSync(join(dir, 'secrets'), { recursive: true, mode: 0o700 });
      writeFileSync(join(dir, 'secrets', 'secrets.json'), JSON.stringify({ telegram: { token: TOKEN, bot: 'spark_test_bot', chatId: OWNER_TG, userId: OWNER_TG, name: 'Owner',
        pairedAt: '2026-11-10T00:00:00.000Z', approve: true }, auth: { serial: 2 } }), { mode: 0o600 });
      writeFileSync(join(stateDir, 'auth-serial.json'), JSON.stringify({ serial: 1 }), { mode: 0o600 });
    } });
    use(P);
    agent = await createActKey('putback-tg');
    await waitFor(async () => (await api('/telegram')).json.state === 'ok', { what: 'Telegram polling' });
  }, { timeout: 180000 * SLOW });
  after(() => P?.stop(), { timeout: 30000 });
  const tgPost = async (path, body) => (await fetch(`http://127.0.0.1:${P.telegramPort}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  const tgSent = (from = 0) => { const f = join(P.dir, 'telegram-calls.jsonl'); return (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []).slice(from).filter(c => c.method === 'sendMessage'); };
  const tgCount = () => { const f = join(P.dir, 'telegram-calls.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).length : 0; };
  const tgSay = text => tgPost('/__push', { message: { message_id: msgId++, date: Math.floor(Date.now() / 1000), chat: { id: OWNER_TG, type: 'private' }, from: { id: OWNER_TG, is_bot: false, first_name: 'Owner' }, text } });
  const tgPress = data => tgPost('/__push', { callback_query: { id: String(msgId++), from: { id: OWNER_TG, is_bot: false, first_name: 'Owner' }, data,
    message: { message_id: msgId++, chat: { id: OWNER_TG, type: 'private' }, date: Math.floor(Date.now() / 1000) } } });
  const stateOf = (spark, name) => readFileSync(join(P.root, spark, '.mock', 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];

  test('it holds, and the owner’s everyday requests in the paired chat are answered and run', { timeout: 180000 * SLOW }, async () => {
    assert.equal((await net(P, '/whoami')).json.held, LINE);
    let from = tgCount();
    await tgSay('/status');
    assert.ok((await waitFor(() => tgSent(from)[0], { timeout: 60000, every: 200, what: 'the answer to /status' })).body.text.length > 0);
    from = tgCount();
    await tgSay(`stop ${RADIX} on spark 4`);
    await waitFor(() => stateOf('spark4', RADIX) === 'exited', { timeout: 60000, what: 'the owner’s stop, asked on Telegram' });
    assert.ok((await waitFor(() => tgSent(from)[0], { timeout: 60000, every: 200, what: 'the reply on Telegram' })).body.text.length > 0);
  });

  test('an approval pressed there is refused with its line, and nothing runs', { timeout: 180000 * SLOW }, async () => {
    is(await ask(P, '/main/route', { method: 'POST', body: { role: 'agents', choice: `deploy:spark3:${TESTORG}` } }), 200, 'the model answers agents: its stop is the owner’s call');
    let from = tgCount();
    const r = await say(await newChat(), `stop ${TESTORG} on spark 3`);
    const yes = (r.message.choices || []).find(c => c.label === `Yes, stop ${TESTORG}`);
    assert.ok(yes, JSON.stringify(r.message));
    await waitFor(() => tgSent(from).find(m => m.body.reply_markup?.inline_keyboard?.some(row => row.some(b => b.callback_data === yes.id))), { timeout: 30000, every: 200, what: 'the ask on Telegram' });
    from = tgCount();
    await tgPress(yes.id);
    assert.equal((await waitFor(() => tgSent(from)[0], { timeout: 60000, every: 200, what: 'the answer to the press' })).body.text, TG_LINE);
    await sleep(1000);
    assert.equal(stateOf('spark3', TESTORG), 'running', 'nothing stopped');
  });

  test('an agent’s change asked through its chat with Sparkie is refused, and nothing runs', { timeout: 180000 * SLOW }, async () => {
    // (the owner's stop above left it exited: a restart is a change)
    const was = stateOf('spark4', RADIX);
    const r = await call(agent.token, ASK, { message: `restart ${RADIX} on spark 4` });
    assert.match(r.raw, /state was put back from a copy, so agents can’t change anything/, r.raw);
    await sleep(1000);
    assert.equal(stateOf('spark4', RADIX), was, 'nothing changed there');
  });
});

// An "always allowed" kind taken away with /allowed off raises the number and is noted (R1-04, R65): an older copy of
// the state, put back by hand on the same disk with nothing else removed since, holds, and the kind is taken away again,
// so it is not live, before "Keep these" or after it.
describe('an always-allowed kind taken away, then an older copy put back by hand', { concurrency: 1 }, () => {
  const KIND = { id: 'a1b2c3d4', spark: 'spark3', program: 'touch', under: '~/notes', addedAt: '2026-11-14T00:00:00.000Z' };
  const K5 = new Authenticator(TAILNET, ORIGIN);
  let A, B;
  after(async () => { await A?.stop(); await B?.stop(); });
  const kinds = F => parse(readFileSync(join(F.stateDir, 'agent-settings.json'), 'utf8'))?.allowed || [];

  test('taken away: the number goes up and the secrets file notes it; the older copy holds and the kind is taken away again', { timeout: 300000 * SLOW }, async () => {
    A = await startMock({ prepare: ({ stateDir }) => writeFileSync(join(stateDir, 'agent-settings.json'), JSON.stringify({ allowed: [KIND] }), { mode: 0o600 }) });
    use(A);
    is(await ask(A, '/auth/passkey/register', { method: 'POST', body: K5.register((await ask(A, '/auth/passkey/begin', { method: 'POST', body: { purpose: 'register' } })).json) }), 201, 'a passkey');
    assert.equal(serialIn(A), 1);
    assert.match((await say(await newChat(), '/allowed')).text, /\n1\. “touch” in ~\/notes on Spark 3\n/);
    const older = copyState(A, 'allowed-older');
    assert.match((await say(await newChat(), '/allowed off 1')).text, /\nTaken away: “touch” in ~\/notes on Spark 3\. It is asked again\.$/);
    assert.deepEqual(kinds(A), []);
    assert.equal(serialIn(A), 2, 'the state’s number went up');
    const s = secretsOf(A);
    assert.equal(s.auth.serial, 2, 'and the secrets file’s');
    assert.deepEqual(s.auth.removed.map(r => [r.kind, r.id]), [['allowed', KIND.id]]);
    const secrets = readFileSync(A.secretsFile, 'utf8');
    await A.stop(); A = null;
    B = await startFrom(older, secrets);
    use(B);
    assert.equal((await net(B, '/whoami')).json.held, LINE, 'held');
    assert.deepEqual(kinds(B), [], 'taken away again');
    assert.deepEqual((await ask(B, '/auth/putback')).json.allowed, []);
    assert.ok(eventLines(B).some(e => e.type === 'notice' && /was removed again \(always-allowed command “touch in ~\/notes on Spark 3”\)/.test(e.text || '')), JSON.stringify(eventLines(B).filter(e => e.type === 'notice')));
    assert.match((await say(await newChat(), '/allowed')).text, /\nNothing is always allowed\./);
    is(await confirmed(B, 'POST', '/auth/putback/keep', {}, K5), 200, 'kept');
    assert.deepEqual(kinds(B), [], 'not live after “Keep these” either');
    assert.match((await say(await newChat(), '/allowed')).text, /\nNothing is always allowed\./);
  });
});
