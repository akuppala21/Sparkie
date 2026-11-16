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
// back by hand holds, and the kind is taken away again (not live before or after "Keep these"). When the state's first
// number can't be written, the secrets file's is taken out again, so the next start holds nothing. The notice of what
// came back masks the names it gives (an agent named like a key). A removal whose note can't be written at once (the
// write fails, the file can't be read, a sync fails) is done and said, waits on the needs-you list, is written by the
// retry or at the next start, and an older copy put back then holds with the key removed again; a hold whose own write
// fails at a start holds in memory (P-3, round two). Round two's final read (S-1, S-2, S-8, S-9, S-10): the secrets
// file is replaced only by a whole one (secretsWrite lifted, under a write limit, a short write, a disk that says it took
// all); every kind of removal, its note written at once or waiting, stays removed (or paused) when an older copy goes
// over the state folder, and its answer says when the note waits; a start that still can't write a waiting note judges
// as if it were written; a note kept neither in the secrets file nor in the state folder is said as such, held in memory
// and written once it can be; a stop between the note and the save, or between keeping the note and the save, leaves
// the next start holding; a stale note never removes what the owner added again; the page shows a waiting note.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
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

// putBackSeed's two writes (R1-14): the secrets file's number, then the state's. A state folder whose number can't be
// written (here auth-serial.json is a folder, so the save can't take its place) leaves neither number: the secrets
// file's is taken out again, so the next start, with the state writable again, holds nothing and gives both 1.
describe('the state’s first number when its second write fails', { concurrency: 1 }, () => {
  let S, N;
  after(async () => { await S?.stop(); await N?.stop(); });

  test('the secrets file’s number is taken out again, and the next start holds nothing', { timeout: 300000 * SLOW }, async () => {
    S = await startMock({ prepare: ({ stateDir }) => mkdirSync(join(stateDir, 'auth-serial.json')) });
    use(S);
    is(await ask(S, '/agents', { method: 'POST', body: { name: 'Seed agent' } }), 201, 'an agent key, which starts the number');
    assert.deepEqual(readdirSync(join(S.stateDir, 'auth-serial.json')), [], 'the state’s write failed: still a folder');
    assert.equal(secretsOf(S)?.auth?.serial, undefined, `the secrets file holds no number alone: ${JSON.stringify(secretsOf(S))}`);
    const state = copyState(S, 'seed-failed'), secrets = existsSync(S.secretsFile) ? readFileSync(S.secretsFile, 'utf8') : null;
    await S.stop(); S = null;
    N = await startFrom(state, secrets, stateDir => rmSync(join(stateDir, 'auth-serial.json'), { recursive: true, force: true }));
    use(N);
    assert.equal((await net(N, '/whoami')).json.held, undefined, 'no hold');
    assert.equal(secretsOf(N).auth?.hold, undefined);
    assert.deepEqual([serialIn(N), secretsOf(N).auth?.serial], [1, 1], 'both numbers started at this start');
  });
});

// The put-back notice names what came back and was removed again (R7, R1-06): names typed by whoever set each up, so a
// key typed as an agent's name is masked in the notice, as in every notice.
describe('the put-back notice masks the names it gives', { concurrency: 1 }, () => {
  const NAME = 'hf_MadeUpKeyForMaskTest5abcdefghij0123';
  let A, B;
  after(async () => { await A?.stop(); await B?.stop(); });

  test('an agent named like a key, removed, then an older copy put back: the notice says it was removed again, masked', { timeout: 300000 * SLOW }, async () => {
    A = await startMock({});
    use(A);
    const k = await ask(A, '/agents', { method: 'POST', body: { name: NAME } });
    is(k, 201, 'an agent named like a key');
    const older = copyState(A, 'key-named-older');
    is(await ask(A, `/agents/${k.json.id}`, { method: 'DELETE' }), 200, 'removed');
    const secrets = readFileSync(A.secretsFile, 'utf8');
    await A.stop(); A = null;
    B = await startFrom(older, secrets);
    use(B);
    assert.equal((await net(B, '/whoami')).json.held, LINE, 'held');
    const notice = eventLines(B).find(e => e.type === 'notice' && /^Spark Console’s state was put back from a copy\./.test(e.text || ''));
    assert.match(notice?.text || '', /was removed again \(agent key “\[hidden\]”\)/, JSON.stringify(notice));
    assert.ok(!eventLines(B).some(e => e.type === 'notice' && String(e.text).includes(NAME)), 'no notice holds the name whole');
  });
});

// P-3, round two: a removal whose note in the secrets file can't be written (the write fails, the file can't be read, a
// sync fails) is still done at once, and its answer says the note waits; the needs-you list shows it; the retry writes
// it; a start in between notes it from the state folder (auth-unnoted.json); an older copy put back by hand then holds
// and the removed key is removed again. A hold whose own write fails at a start is held in memory, and said.
describe('a removal whose note can’t be written at once', { concurrency: 1 }, () => {
  const DISK = { NODE_OPTIONS: `--import=${join(REPO, 'test', 'mock', 'disk-full.mjs')}` };
  const fleets = [];
  after(async () => { for (const F of fleets) await F?.stop().catch(() => {}); });
  const begin = async (env = {}, prepare = null) => { const F = await startMock({ env: { SPARK_CONSOLE_PUTBACK_RETRY_MS: '1000', ...env }, ...(prepare ? { prepare } : {}) }); fleets.push(F); use(F); return F; };
  const startWith = async (state, secrets, env = {}, extra = null) => {
    const F = await startMock({ env, prepare: ({ stateDir, dir }) => {
      for (const f of readdirSync(stateDir)) rmSync(join(stateDir, f), { recursive: true, force: true });
      cpSync(state, stateDir, { recursive: true });
      mkdirSync(join(dir, 'secrets'), { recursive: true, mode: 0o700 });
      writeFileSync(join(dir, 'secrets', 'secrets.json'), secrets, { mode: 0o600 });
      extra?.(dir);
    } });
    fleets.push(F); use(F); return F;
  };
  const agentIds = F => (parse(readFileSync(join(F.stateDir, 'agents.json'), 'utf8'))?.keys || []).map(k => k.id);
  // (read as it is on disk: a file that can't be read just then has nothing noted)
  const noted = F => (parse(existsSync(F.secretsFile) ? readFileSync(F.secretsFile, 'utf8') : '')?.auth?.removed || []).filter(r => r.kind === 'agent').map(r => r.id);
  const works = async (F, token) => (await net(F, '/v1/models', { headers: { authorization: `Bearer ${token}` } })).status;
  const needs = async F => (await ask(F, '/actions/fleet_status', { method: 'POST', body: {} })).json?.needsOwner || [];
  const WAITS = /^A removal \(agent\) couldn’t be noted outside the state yet/;
  // An agent key that may change things from anywhere, and a copy of the state taken while it was there.
  async function keyAndCopy(F, name) {
    const k = await ask(F, '/agents', { method: 'POST', body: { name } });
    is(k, 201, name);
    is(await ask(F, `/agents/${k.json.id}`, { method: 'PUT', body: { act: true, internet: true } }), 200);
    assert.equal(await works(F, k.json.token), 200, 'it works from the internet');
    return { key: k.json, older: copyState(F, `p3-${name}`) };
  }
  // The removal, with the note not written: done at once, said in its answer and on the needs-you list.
  async function removedUnnoted(F, key) {
    const gone = await ask(F, `/agents/${key.id}`, { method: 'DELETE' });
    is(gone, 200, 'removed');
    assert.equal(gone.json.noted, false, gone.text);
    assert.match(gone.json.note, /^Done\. Its note outside the state \(in the secrets file\) couldn’t be written just now/);
    assert.ok(!agentIds(F).includes(key.id), 'removed at once');
    assert.deepEqual(noted(F), [], 'not noted yet');
    assert.ok((await needs(F)).some(l => WAITS.test(l)), JSON.stringify(await needs(F)));
  }
  // The older copy, put back by hand on the same disk: held, and the removed key removed again.
  async function putBackHolds(older, secrets, key) {
    const B = await startWith(older, secrets);
    assert.equal((await net(B, '/whoami')).json.held, LINE, 'held');
    assert.ok(!agentIds(B).includes(key.id), 'the removed key is removed again');
    assert.notEqual(await works(B, key.token), 200, 'and doesn’t work from the internet');
    await B.stop();
  }

  test('the note’s write fails: the removal is done and said; the retry writes the note; the older copy then holds and the key stays removed', { timeout: 600000 * SLOW }, async () => {
    const A = await begin(), { key, older } = await keyAndCopy(A, 'p3-write-fails');
    const block = `${A.secretsFile}.${A.servicePid()}.tmp`;
    mkdirSync(block);
    try { await removedUnnoted(A, key); } finally { rmSync(block, { recursive: true, force: true }); }
    await waitFor(() => noted(A).includes(key.id), { timeout: 30000 * SLOW, what: 'the retry writing the note' });
    assert.equal(secretsOf(A).auth.serial, serialIn(A), 'the two numbers level');
    assert.ok(!existsSync(join(A.stateDir, 'auth-unnoted.json')), 'nothing waits');
    await waitFor(async () => !(await needs(A)).some(l => WAITS.test(l)), { timeout: 30000 * SLOW, what: 'the needs-you line gone' });
    const secrets = readFileSync(A.secretsFile, 'utf8');
    await A.stop();
    await putBackHolds(older, secrets, key);
  });

  test('the secrets file can’t be read at the removal, and is mended: the same', { timeout: 600000 * SLOW }, async () => {
    const A = await begin(), { key, older } = await keyAndCopy(A, 'p3-unreadable');
    const good = readFileSync(A.secretsFile, 'utf8');
    writeFileSync(A.secretsFile, '{ "telegram": ');
    try { await removedUnnoted(A, key); } finally { writeFileSync(A.secretsFile, good, { mode: 0o600 }); }
    await waitFor(() => noted(A).includes(key.id), { timeout: 30000 * SLOW, what: 'the retry writing the note' });
    const secrets = readFileSync(A.secretsFile, 'utf8');
    await A.stop();
    await putBackHolds(older, secrets, key);
  });

  test('a start between the failed note and the put-back: the start notes it from the state folder, so the older copy holds and the key stays removed', { timeout: 600000 * SLOW }, async () => {
    const A = await begin(), { key, older } = await keyAndCopy(A, 'p3-start-between');
    mkdirSync(`${A.secretsFile}.${A.servicePid()}.tmp`);
    await removedUnnoted(A, key);
    assert.ok(existsSync(join(A.stateDir, 'auth-unnoted.json')), 'the note waits in the state folder');
    const now = copyState(A, 'p3-now'), stale = readFileSync(A.secretsFile, 'utf8');
    await A.stop();
    const M = await startWith(now, stale);
    assert.ok(noted(M).includes(key.id), 'the start noted it');
    assert.equal((await net(M, '/whoami')).json.held, undefined, 'and holds nothing: nothing came back');
    const secrets = readFileSync(M.secretsFile, 'utf8');
    await M.stop();
    await putBackHolds(older, secrets, key);
  });

  test('the secrets file’s sync fails at the removal: the note isn’t taken as written', { timeout: 300000 * SLOW }, async () => {
    const A = await begin(DISK), { key } = await keyAndCopy(A, 'p3-sync-fails');
    const before = readFileSync(A.secretsFile, 'utf8');
    writeFileSync(join(A.dir, 'secrets-fsync-fail'), '');
    try {
      await removedUnnoted(A, key);
      assert.equal(readFileSync(A.secretsFile, 'utf8'), before, 'the secrets file is as it was');
    } finally { rmSync(join(A.dir, 'secrets-fsync-fail'), { force: true }); }
    await waitFor(() => noted(A).includes(key.id), { timeout: 30000 * SLOW, what: 'the retry writing the note' });
  });

  test('a hold whose own write fails at a start holds in memory all the same, and says so', { timeout: 600000 * SLOW }, async () => {
    const A = await begin(), { key, older } = await keyAndCopy(A, 'p3-hold-unsaved');
    is(await ask(A, `/agents/${key.id}`, { method: 'DELETE' }), 200);
    assert.ok(noted(A).includes(key.id));
    const secrets = readFileSync(A.secretsFile, 'utf8');
    await A.stop();
    const B = await startWith(older, secrets, DISK, dir => writeFileSync(join(dir, 'secrets-full'), ''));
    assert.equal(secretsOf(B).auth.hold, undefined, 'the hold couldn’t be written');
    assert.equal((await net(B, '/whoami')).json.held, LINE, 'held all the same');
    assert.notEqual(await works(B, key.token), 200);
    assert.ok((await needs(B)).some(l => /^Spark Console’s state was put back from a copy.* The hold couldn’t be saved, so it lasts only until Spark Console next starts\./.test(l)), JSON.stringify(await needs(B)));
    await B.stop();
  });

  // Round two's final read. S-2: a right taken from a key while its note waits; the older copy goes over the state
  // folder while the secrets file still can't be written (the start's retry fails): judged as if written, so it holds.
  test('a right taken while its note waits, then the older copy while the note still can’t be written: the start judges as if it were, so it holds and takes the right again', { timeout: 600000 * SLOW }, async () => {
    const A = await begin(), { key, older } = await keyAndCopy(A, 'p3-still-full');
    const block = `${A.secretsFile}.${A.servicePid()}.tmp`;
    let now, secrets;
    mkdirSync(block);
    try {
      const r = await ask(A, `/agents/${key.id}`, { method: 'PUT', body: { internet: false } });
      is(r, 200, 'taken off the internet');
      assert.equal(r.json.noted, false, r.text);
      [now, secrets] = [copyState(A, 'p3-still-full-now'), readFileSync(A.secretsFile, 'utf8')];
    } finally { rmSync(block, { recursive: true, force: true }); }
    await A.stop();
    cpSync(older, now, { recursive: true });
    const B = await startWith(now, secrets, DISK, dir => writeFileSync(join(dir, 'secrets-full'), ''));
    assert.equal((await net(B, '/whoami')).json.held, LINE, 'held');
    assert.equal((parse(readFileSync(join(B.stateDir, 'agents.json'), 'utf8'))?.keys || []).find(k => k.id === key.id)?.internet, false, 'the right taken again');
    assert.notEqual(await works(B, key.token), 200);
    await B.stop();
  });

  // S-8: the note can be written neither in the secrets file nor in the state folder (both temporary names blocked).
  test('a note that can be kept neither in the secrets file nor in the state folder: done, its answer says exactly that, the needs-you line comes from memory, and both are written once they can be', { timeout: 600000 * SLOW }, async () => {
    const UNKEPT = 'Done. Its note couldn’t be written, outside the state or in it, so if an older copy of the state folder is put back before the disk is mended, it may come back.';
    const A = await begin(), { key, older } = await keyAndCopy(A, 'p3-unkept');
    const pid = A.servicePid(), waitingFile = join(A.stateDir, 'auth-unnoted.json'), blocks = [`${A.secretsFile}.${pid}.tmp`, `${waitingFile}.${pid}.tmp`];
    const waitingIds = () => (parse(existsSync(waitingFile) ? readFileSync(waitingFile, 'utf8') : '')?.notes || []).map(r => r.id);
    for (const b of blocks) mkdirSync(b);
    try {
      const gone = await ask(A, `/agents/${key.id}`, { method: 'DELETE' });
      is(gone, 200, 'removed');
      assert.deepEqual([gone.json.noted, gone.json.note], [false, UNKEPT], gone.text);
      assert.ok(!agentIds(A).includes(key.id), 'removed at once');
      assert.ok(!existsSync(waitingFile), 'not kept in the state folder');
      const line = (await needs(A)).find(l => WAITS.test(l));
      assert.match(line || '', / It couldn’t be kept in the state folder either, so if Spark Console stops before then, it is forgotten\.$/, JSON.stringify(await needs(A)));
      // The state folder takes it again: the retry keeps it there from memory, while the secrets file still can't.
      rmSync(blocks[1], { recursive: true, force: true });
      await waitFor(() => waitingIds().includes(key.id), { timeout: 30000 * SLOW, what: 'the retry keeping the note in the state folder' });
      assert.deepEqual(noted(A), [], 'not in the secrets file yet');
    } finally { for (const b of blocks) rmSync(b, { recursive: true, force: true }); }
    await waitFor(() => noted(A).includes(key.id) && !existsSync(waitingFile), { timeout: 30000 * SLOW, what: 'the retry writing the note' });
    const secrets = readFileSync(A.secretsFile, 'utf8');
    await A.stop();
    await putBackHolds(older, secrets, key);
  });

  // S-10 and S-8: the service stops between a removal's two writes (the stand-in kills it as it opens the second of the
  // two, whichever comes first); then the older copy goes over the state folder. Only the right order holds it.
  async function stoppedBetween(name, files, block) {
    const A = await begin(DISK), { key, older } = await keyAndCopy(A, name);
    if (block) mkdirSync(`${A.secretsFile}.${A.servicePid()}.tmp`);
    writeFileSync(join(A.dir, 'stop-between'), files);
    await ask(A, `/agents/${key.id}`, { method: 'DELETE' }).catch(() => null);
    await waitFor(() => A.serviceExit() !== null, { timeout: 30000 * SLOW, what: 'the service stopped between the two writes' });
    const now = copyState(A, `${name}-now`), secrets = readFileSync(A.secretsFile, 'utf8');
    await A.stop();
    cpSync(older, now, { recursive: true });
    await putBackHolds(now, secrets, key);
  }
  test('a stop between the note and the removal’s save, whichever comes first, then the older copy: the note came first, so the next start holds and removes the key again', { timeout: 600000 * SLOW },
    () => stoppedBetween('p3-stop-noted', 'secrets.json agents.json', false));
  test('the note can’t be written, and a stop between keeping it in the state folder and the save, whichever comes first, then the older copy: kept first, so the next start holds and removes the key again', { timeout: 600000 * SLOW },
    () => stoppedBetween('p3-stop-kept', 'auth-unnoted.json agents.json', true));

  // A note written late names what went by its id. What the owner adds again has a new id, so it is never taken.
  test('a stale note the retry writes never removes what the owner added again: the same name has a new id, and nothing holds at the next start', { timeout: 600000 * SLOW }, async () => {
    const A = await begin(), { key } = await keyAndCopy(A, 'p3-again');
    const block = `${A.secretsFile}.${A.servicePid()}.tmp`;
    let again;
    mkdirSync(block);
    try {
      await removedUnnoted(A, key);
      again = await ask(A, '/agents', { method: 'POST', body: { name: 'p3-again' } });
      is(again, 201, 'the same name, added again');
      is(await ask(A, `/agents/${again.json.id}`, { method: 'PUT', body: { act: true, internet: true } }), 200);
      assert.notEqual(again.json.id, key.id, 'a new id');
    } finally { rmSync(block, { recursive: true, force: true }); }
    await waitFor(() => noted(A).includes(key.id), { timeout: 30000 * SLOW, what: 'the retry writing the old note' });
    assert.ok(agentIds(A).includes(again.json.id), 'the new key stays');
    assert.equal(await works(A, again.json.token), 200);
    const now = copyState(A, 'p3-again-now'), secrets = readFileSync(A.secretsFile, 'utf8');
    await A.stop();
    const B = await startWith(now, secrets);
    assert.equal((await net(B, '/whoami')).json.held, undefined, 'no hold');
    assert.ok(agentIds(B).includes(again.json.id), 'still there after a start');
    assert.equal(await works(B, again.json.token), 200, 'and it works from the internet');
    await B.stop();
  });
});

// Round two's final read, S-2 and S-9: every kind of removal by the owner, its note written at once or waiting (the
// secrets file's temporary name blocked), then the console stopped and an older copy of the state put over the state
// folder by hand (files the copy doesn't hold stay), with the same secrets file. Each answer says when the note waits;
// each start holds, and each removed thing stays removed, each pause stays paused. One fleet makes the removals, one
// at a time with nothing waiting before each copy; a fleet of its own is started on each put-back.
describe('every kind of removal, its note written at once or waiting, then an older copy over the state folder', { concurrency: 1 }, () => {
  const K = new Authenticator(TAILNET, ORIGIN), P = { 'at once': new Authenticator(TAILNET, ORIGIN), waiting: new Authenticator(TAILNET, ORIGIN) };
  const KINDS = { 'at once': { id: 'c0ffee01', spark: 'spark3', program: 'touch', under: '~/notes', addedAt: '2026-11-14T00:00:00.000Z' },
    waiting: { id: 'c0ffee02', spark: 'spark3', program: 'mkdir', under: '~/notes', addedAt: '2026-11-14T00:00:00.000Z' } };
  const WAITS_SAID = /^Done\. Its note outside the state \(in the secrets file\) couldn’t be written just now/;
  const fleets = [], keys = {};
  let A, count = 0;
  after(async () => { for (const F of fleets) await F?.stop().catch(() => {}); });
  const fileOf = (F, name) => parse(existsSync(join(F.stateDir, name)) ? readFileSync(join(F.stateDir, name), 'utf8') : '') || {};
  const keyIn = (F, id) => (fileOf(F, 'agents.json').keys || []).find(k => k.id === id);
  const works = async (F, token) => (await net(F, '/v1/models', { headers: { authorization: `Bearer ${token}` } })).status;
  async function device(name) {
    const b = await net(A, '/auth/signin/begin', { method: 'POST', body: {} });
    is(b, 200, 'sign-in begins');
    const c = await net(A, '/auth/signin', { method: 'POST', body: { ...K.sign(b.json, { signCount: ++count }), name } });
    is(c, 200, `${name} signs in from the internet`);
    const d = { cookie: cookieOf(c), id: (await ask(A, '/auth/sessions')).json.sessions.find(s => s.name === name)?.id };
    assert.ok(d.cookie && d.id, `${name} is on the list`);
    return d;
  }
  const resume = async () => is(await confirmed(A, 'PUT', '/agents/settings', { halted: false }, K), 200, 'resumed for the next row');
  const ROWS = {
    'a passkey': { remove: mode => confirmed(A, 'DELETE', `/auth/passkeys/${P[mode].id}`, undefined, K),
      stays: (B, mode) => assert.ok(!(fileOf(B, 'passkeys.json').keys || []).some(k => k.id === P[mode].id), 'the passkey stays removed') },
    'an agent key': { remove: mode => ask(A, `/agents/${keys[`gone ${mode}`].id}`, { method: 'DELETE' }),
      stays: async (B, mode) => { assert.equal(keyIn(B, keys[`gone ${mode}`].id), undefined, 'the key stays removed'); assert.notEqual(await works(B, keys[`gone ${mode}`].token), 200); } },
    'a right taken from a key': { remove: mode => confirmed(A, 'PUT', `/agents/${keys[`narrowed ${mode}`].id}`, { internet: false }, K),
      stays: async (B, mode) => { assert.equal(keyIn(B, keys[`narrowed ${mode}`].id)?.internet, false, 'tailnet-only again'); assert.notEqual(await works(B, keys[`narrowed ${mode}`].token), 200); } },
    'the pause, from the settings': { remove: () => ask(A, '/agents/settings', { method: 'PUT', body: { halted: true } }), after: resume,
      stays: B => assert.equal(fileOf(B, 'agent-settings.json').halted, true, 'still paused') },
    'a device that signs itself out': { before: mode => device(`Self ${mode}`), remove: (mode, d) => net(A, '/auth/signout', { method: 'POST', body: {}, headers: withCookie(d.cookie) }),
      stays: async (B, mode, d) => { assert.ok(!(fileOf(B, 'sessions.json').sessions || []).some(s => s.id === d.id)); is(await net(B, '/bootstrap', { headers: withCookie(d.cookie) }), 401, 'its cookie'); } },
    'a device signed out from the list': { before: mode => device(`Listed ${mode}`), remove: (mode, d) => ask(A, `/auth/sessions/${d.id}`, { method: 'DELETE' }),
      stays: async (B, mode, d) => { assert.ok(!(fileOf(B, 'sessions.json').sessions || []).some(s => s.id === d.id)); is(await net(B, '/bootstrap', { headers: withCookie(d.cookie) }), 401, 'its cookie'); } },
    '/pause': { chat: true, remove: async () => say(await newChat(), '/pause'), after: resume,
      stays: B => assert.equal(fileOf(B, 'agent-settings.json').halted, true, 'still paused') },
    '/allowed off': { chat: true, remove: async mode => say(await newChat(), `/allowed off ${(fileOf(A, 'agent-settings.json').allowed || []).findIndex(e => e.id === KINDS[mode].id) + 1}`),
      stays: (B, mode) => assert.ok(!(fileOf(B, 'agent-settings.json').allowed || []).some(e => e.id === KINDS[mode].id), 'still taken away') },
  };

  test('the owner’s state: three passkeys, four agent keys that work from anywhere, two always-allowed kinds, nothing paused', { timeout: 300000 * SLOW }, async () => {
    A = await startMock({ env: { SPARK_CONSOLE_PUTBACK_RETRY_MS: '1000' }, prepare: ({ stateDir }) => writeFileSync(join(stateDir, 'agent-settings.json'), JSON.stringify({ allowed: Object.values(KINDS) }), { mode: 0o600 }) });
    fleets.push(A);
    use(A);
    is(await ask(A, '/auth/passkey/register', { method: 'POST', body: K.register((await ask(A, '/auth/passkey/begin', { method: 'POST', body: { purpose: 'register' } })).json) }), 201, 'the passkey that confirms');
    for (const [mode, k] of Object.entries(P)) {
      const b = await ask(A, '/auth/passkey/begin', { method: 'POST', body: { purpose: 'register' } });
      is(await confirmed(A, 'POST', '/auth/passkey/register', k.register(b.json, { name: `Lost ${mode}` }), K), 201, `a passkey to remove ${mode}`);
    }
    for (const name of ['gone at once', 'gone waiting', 'narrowed at once', 'narrowed waiting']) {
      const k = await confirmed(A, 'POST', '/agents', { name }, K);
      is(k, 201, name);
      is(await confirmed(A, 'PUT', `/agents/${k.json.id}`, { act: true, internet: true }, K), 200, `${name} acts, from anywhere`);
      keys[name] = k.json;
      assert.equal(await works(A, k.json.token), 200, `${name} works from the internet`);
    }
    assert.deepEqual([(fileOf(A, 'agent-settings.json').allowed || []).map(e => e.id), fileOf(A, 'agent-settings.json').halted], [Object.values(KINDS).map(e => e.id), undefined]);
  });

  for (const mode of ['at once', 'waiting']) {
    for (const [what, row] of Object.entries(ROWS)) {
      test(`${what}, its note ${mode === 'at once' ? 'written at once' : 'waiting'}: the answer says so; the older copy holds, and it stays ${/pause/.test(what) ? 'paused' : 'removed'}`, { timeout: 300000 * SLOW }, async () => {
        assert.ok(A, 'the owner’s state is set up');
        use(A);
        const tag = `kinds-${Object.keys(ROWS).indexOf(what)}-${mode === 'at once' ? 'now' : 'waits'}`;
        await waitFor(() => !existsSync(join(A.stateDir, 'auth-unnoted.json')), { timeout: 30000 * SLOW, what: 'nothing waiting before the copy' });
        const x = await row.before?.(mode);
        const older = copyState(A, `${tag}-older`), block = `${A.secretsFile}.${A.servicePid()}.tmp`;
        let r, now, secrets;
        if (mode === 'waiting') mkdirSync(block);
        try {
          r = await row.remove(mode, x);
          [now, secrets] = [copyState(A, `${tag}-now`), readFileSync(A.secretsFile, 'utf8')];
        } finally { if (mode === 'waiting') rmSync(block, { recursive: true, force: true }); }
        if (row.chat) assert.equal(/\nDone\. Its note outside the state \(in the secrets file\) couldn’t be written just now/.test(r.text), mode === 'waiting', r.text);
        else {
          is(r, 200, what);
          assert.equal(r.json.noted, mode === 'waiting' ? false : undefined, r.text);
          if (mode === 'waiting') assert.match(r.json.note, WAITS_SAID);
        }
        assert.equal(existsSync(join(now, 'auth-unnoted.json')), mode === 'waiting', 'the note waits in the state folder only when it couldn’t be written');
        await row.after?.();
        cpSync(older, now, { recursive: true });
        const B = await startMock({ evalOnRecord: false, prepare: ({ stateDir, dir }) => {
          for (const f of readdirSync(stateDir)) rmSync(join(stateDir, f), { recursive: true, force: true });
          cpSync(now, stateDir, { recursive: true });
          mkdirSync(join(dir, 'secrets'), { recursive: true, mode: 0o700 });
          writeFileSync(join(dir, 'secrets', 'secrets.json'), secrets, { mode: 0o600 });
        } });
        fleets.push(B);
        try {
          assert.equal((await net(B, '/whoami')).json.held, LINE, 'held');
          await row.stays(B, mode, x);
        } finally { await B.stop(); }
      });
    }
  }
});

// Round two's final read, S-1: secretsWrite, taken from 03-secrets.mjs as it is and run in a child process of its own
// (no fleet). Under a write limit (`ulimit -f`, the stand-in for a nearly full disk) only part of the new file fits: the
// call throws, the secrets file is byte for byte as it was, and nothing is left under the temporary name; with room it
// writes. A write that comes back short once with room left is written to the end; a disk that says it took every byte
// and took half is caught by the read-back.
describe('the secrets file is only ever replaced by a whole one', () => {
  const SRC = readFileSync(join(REPO, 'service', 'src', '03-secrets.mjs'), 'utf8');
  const lifted = name => { const m = new RegExp(`^function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}$`, 'm').exec(SRC); assert.ok(m, `${name} is in 03-secrets.mjs`); return m[0]; };
  const BEFORE = JSON.stringify({ telegram: { bot: 'spark_test_bot' }, auth: { serial: 6 } });
  const NEXT = { auth: { serial: 7, removed: Array.from({ length: 300 }, (_, i) => ({ kind: 'agent', id: `id${i}`, name: 'x'.repeat(40), at: '2026-11-16T00:00:00.000Z' })) } };
  // way: '' (the disk as it is), 'short-once' (the first write takes half and says so; the rest fits), 'lies' (each write
  // takes half and says it took all); limitKb: a write limit, so only part fits.
  function write(way, limitKb = null) {
    const d = mkdtempSync(join(COPIES, 'secrets-write-')), folder = join(d, 'secrets'), file = join(folder, 'secrets.json'), script = join(d, 'lift.mjs');
    mkdirSync(folder, { mode: 0o700 });
    writeFileSync(file, BEFORE, { mode: 0o600 });
    writeFileSync(script, ["import * as fs from 'node:fs';",
      'const { readFileSync, mkdirSync, chmodSync, openSync, fsyncSync, closeSync, renameSync, unlinkSync, statSync } = fs;',
      'const SECRETS_FILE = process.argv[2], WAY = process.argv[3], keptSeen = {}; let secretsProblem = null, calls = 0;',
      'class HttpError extends Error {}',
      'const writeSync = (fd, b, off, len) => {',
      "  if (typeof b === 'string') b = Buffer.from(b);",
      '  off ??= 0; len ??= b.length - off; calls++;',
      "  if (WAY === 'short-once' && calls === 1) return fs.writeSync(fd, b, off, Math.floor(len / 2));",
      "  if (WAY === 'lies') { fs.writeSync(fd, b, off, Math.floor(len / 2)); return len; }",
      '  return fs.writeSync(fd, b, off, len);',
      '};',
      lifted('secretsRead'), lifted('secretsWrite'),
      `let threw = null; try { secretsWrite(x => ({ ...x, ...${JSON.stringify(NEXT)} })); } catch (e) { threw = e.code || e.message || String(e); }`,
      'console.log(JSON.stringify({ threw, calls }));'].join('\n'));
    const r = spawnSync('bash', ['-c', `trap "" XFSZ; ${limitKb ? `ulimit -f ${limitKb}; ` : ''}exec "$@"`, 'limit', process.execPath, script, file, way], { encoding: 'utf8', timeout: 30000 * SLOW });
    const out = parse(String(r.stdout || '').trim().split('\n').pop());
    assert.ok(out, `the lifted secretsWrite ran: ${r.stdout}${r.stderr}${r.error || ''}`);
    return { ...out, text: readFileSync(file, 'utf8'), left: readdirSync(folder).sort() };
  }

  test('only part fits (a write limit): it throws, the secrets file is byte for byte as it was, and nothing is left under the temporary name; with room it writes', { timeout: 120000 * SLOW }, () => {
    const full = write('', 16);
    assert.ok(full.threw, `it throws: ${JSON.stringify(full)}`);
    assert.equal(full.text, BEFORE, 'the secrets file as it was');
    assert.deepEqual(full.left, ['secrets.json'], 'nothing under the temporary name');
    const room = write('');
    assert.equal(room.threw, null, JSON.stringify(room));
    assert.deepEqual(JSON.parse(room.text), { telegram: { bot: 'spark_test_bot' }, ...NEXT }, 'written whole');
    assert.deepEqual(room.left, ['secrets.json']);
  });

  test('a write that comes back short once, with room left, is written until every byte is in', { timeout: 120000 * SLOW }, () => {
    const r = write('short-once');
    assert.equal(r.threw, null, JSON.stringify(r));
    assert.ok(r.calls >= 2, `written on after the short write: ${JSON.stringify(r)}`);
    assert.deepEqual(JSON.parse(r.text), { telegram: { bot: 'spark_test_bot' }, ...NEXT }, 'written whole');
    assert.deepEqual(r.left, ['secrets.json']);
  });

  test('a disk that says it took every byte and took half: the read-back catches it, the secrets file is as it was, nothing is left', { timeout: 120000 * SLOW }, () => {
    const r = write('lies');
    assert.ok(r.threw, `it throws: ${JSON.stringify(r)}`);
    assert.equal(r.text, BEFORE, 'the secrets file as it was');
    assert.deepEqual(r.left, ['secrets.json'], 'nothing under the temporary name');
  });
});

// Round two's final read, S-9: the page shows the note a removal's answer carries when it waits (noted: false), in its
// own words: capi shows it for every route, and a sign-out that reloads the page shows it first. The page's own
// functions, taken from public/app.js and run here with stand-ins (no test here drives a browser).
test('the page shows a removal’s waiting note, and a sign-out that reloads the page shows it before the reload', async () => {
  const APP = readFileSync(join(REPO, 'public', 'app.js'), 'utf8');
  const src = ['capi', 'removalNote', 'signOutHere', 'signOutDevice', 'signedOutNote'].map(n => {
    const m = new RegExp(`^(?:async )?function ${n}\\([^)]*\\) \\{\\n[\\s\\S]*?^\\}`, 'm').exec(APP);
    assert.ok(m, `${n} is in public/app.js`);
    return m[0];
  }).join('\n');
  const NOTE = 'Done. Its note outside the state (in the secrets file) couldn’t be written just now, so an older copy of the state put back by hand could bring it back: Spark Console tries again every minute and says so on the needs-you list until it is written.';
  let answer;
  const toasts = [], dialogs = [], seen = [];
  const page = vm.runInNewContext(`${src}\n({ capi, signOutHere, signOutDevice })`, {
    CONSOLE_API: '/console/api/', state: { boot: {} },
    fetch: async () => ({ ok: true, status: 200, json: async () => answer }),
    toast: (message, o = {}) => { toasts.push({ message, ...o }); seen.push('toast'); },
    dialog: async o => { dialogs.push(o); seen.push('dialog'); return true; },
    location: { reload: () => seen.push('reload') },
    loadSessions: async () => {},
  });
  answer = { ok: true, noted: false, note: NOTE };
  await page.capi('agents/0123456789ab', 'DELETE');
  assert.deepEqual(toasts.map(t => [t.message, t.timeout]), [[NOTE, 0]], 'shown, and it stays until closed');
  for (const signOut of [() => page.signOutHere(), () => page.signOutDevice({ id: 'abcdef012345', name: 'Phone', current: true })]) {
    [dialogs.length, seen.length] = [0, 0];
    await signOut();
    assert.equal(dialogs[0]?.description, NOTE, 'said before the page goes');
    assert.ok(seen.indexOf('dialog') >= 0 && seen.indexOf('dialog') < seen.indexOf('reload'), seen.join(' '));
  }
  // Nothing waiting: nothing more is shown.
  [answer, toasts.length, dialogs.length, seen.length] = [{ ok: true }, 0, 0, 0];
  await page.capi('agents/0123456789ab', 'DELETE');
  await page.signOutHere();
  assert.deepEqual([toasts.length, dialogs.length, seen], [0, 0, ['reload']]);
});
