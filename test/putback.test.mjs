// Covers: State put back from a copy lets no device or key in by itself (E2c; contract 6.25; design E 2.5, P-3;
// 22-putback.mjs). A state with no auth serial starts as before; each removal (a passkey, an agent key, agents paused, a
// device signed out) raises the number in the state and in the secrets file and notes what went. An older copy put back
// on the same disk: what was removed since is removed again, every device is signed out (also a session the copy still
// held), the owner's pause comes back, a task under way is parked with a line in its chat, and the hold follows. Under
// it, from the internet, a passkey, a recovery code, a device code and an agent key get one plain line; an agent's
// change on the tailnet is refused; the tailnet door, the owner's own chat words and /health work. The owner looks at
// the list on the tailnet and keeps it with the passkey (never from the internet); then the internet signs in again,
// the removed passkey and key stay out, and a counter older in the copy than in the passkey breaks nothing. The next
// start holds no more. A new disk (a number in the state, no secrets file) holds too. go-back.sh and an update's way
// back put back program files only and never trip it; restore.sh --with-state brings the older number back.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, cpSync, chmodSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { T, request, call, newChat, say, eventLines, waitFor, SLOW } from './lib.mjs';
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

  test('a state with no number starts as before: no hold, and the internet signs in', { timeout: 300000 * SLOW }, async () => {
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
    assert.equal(serialIn(F), null, 'no number: nothing was removed yet');
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
    assert.equal(serialIn(F), 4);
    const s = secretsOf(F);
    assert.equal(s.auth.serial, 4);
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
      assert.equal(r.json.error, LINE);
    }
    is(await net(G, '/bootstrap', { headers: withCookie(oldCookie) }), 401, 'the cookie the copy held');
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
    assert.equal(serialIn(G), 4);
    assert.equal(secretsOf(G).auth.hold, undefined);
    const went = () => eventLines(G).filter(e => e.type === 'notice' && /lower count than before/.test(e.text || '')).length;
    // (the copy holds 5; the passkey itself had reached 10)
    const c = await signIn(G, K1, 7);
    is(c, 200, 'a count above the copy’s');
    assert.equal(went(), 0, 'not noted');
    is(await signIn(G, K1, 3), 200, 'a count below the copy’s: accepted');
    await waitFor(() => went() === 1, { timeout: 10000, what: 'the counter note' });
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
  const run = (x, ...args) => spawnSync('bash', [join(x.snap, 'restore.sh'), ...args], { env: { ...process.env, HOME: x.h, PATH: `${x.bin}:${process.env.PATH}` }, encoding: 'utf8', timeout: 60000 * SLOW });

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

  test('restore.sh --with-state brings the older number back, so the next start holds', () => {
    const x = home();
    try {
      const r = run(x, '--with-state');
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(readFileSync(join(x.live, 'auth-serial.json'), 'utf8'), '{"serial":2}');
    } finally { rmSync(x.h, { recursive: true, force: true }); }
  });

  test('an update’s way back (update-guard.sh) writes no file in the state folder but its own result, and never the secrets file', () => {
    const g = readFileSync(join(REPO, 'deploy', 'update-guard.sh'), 'utf8');
    const stateWrites = [...g.matchAll(/"\$STATE\/([\w.-]+)"/g)].map(m => m[1]);
    assert.deepEqual([...new Set(stateWrites)].sort(), ['api.sock', 'update-result.json']);
    assert.doesNotMatch(g, /auth-serial|secrets\.json|\.config\/spark-console/);
  });
});
