// Covers: No sign-in travels with the state (E2b; contract 6.25; design E 2.5): a copy of the state holds no
// `sessions.json`, and a sign-in alone sends no copy (the passkey's counter and last use don't count); state put back
// from a copy onto a fresh Spark Console signs no device in (the old cookie gets 401) while the owner's access and
// passkey are as the copy had them (the passkey signs in from the internet again); `restore.sh --with-state` puts an
// install snapshot's state back but never its `sessions.json`, also when the snapshot holds one.
//
// One stand-in fleet looks every 3 s (the hourly look, made short), with Sparks 3 and 4 on; a second starts from the
// first one's copy. restore.sh is the text deploy/host-on-portal.sh writes into each snapshot, run in a made-up home
// with a stand-in systemctl and curl.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, mkdtempSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { request, waitFor, sleep, SLOW } from './lib.mjs';
import { startMock, serviceConfig, REPO } from './start-mock.mjs';
import { Authenticator } from './authenticator.mjs';

const ORIGIN = serviceConfig().origin, KEY = new Authenticator(new URL(ORIGIN).hostname.split('.').slice(1).join('.'), ORIGIN);
const FUNNEL = { 'tailscale-funnel-request': '?1' };
const ask = (F, path, { method = 'GET', body, headers = {} } = {}) => request(`${F.base}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body),
  headers: { ...(method === 'GET' ? {} : { 'content-type': 'application/json', 'x-spark-console': '1', origin: F.origin }), ...headers } })
  .then(r => ({ ...r, json: (() => { try { return JSON.parse(r.text || 'null'); } catch { return null; } })() }));
// From the internet, as Tailscale Funnel hands a request over; and with a browser's cookie.
const net = (F, path, opts = {}) => ask(F, path, { ...opts, headers: { ...FUNNEL, ...(opts.headers || {}) } });
const withCookie = token => ({ cookie: `other=1; sc_session=${token}` });
const cookieOf = r => /^sc_session=(scs_[A-Za-z0-9_-]{43});/.exec(String(r.headers.get('set-cookie') || ''))?.[1] || null;
const record = async F => (await ask(F, '/health')).json.lastBackup;
const copyFile = (F, b) => join(F.root, b.to, '.local', 'share', 'spark-console', 'backups', b.file);
const listed = file => execFileSync('tar', ['-tzf', file], { encoding: 'utf8' }).split('\n').filter(Boolean);
async function signIn(F) {
  const b = await net(F, '/auth/signin/begin', { method: 'POST', body: {} });
  assert.equal(b.status, 200, b.text);
  const r = await net(F, '/auth/signin', { method: 'POST', body: { ...KEY.sign(b.json), name: 'Test phone' } });
  assert.equal(r.status, 200, r.text);
  return cookieOf(r);
}
// Until no new copy has been recorded for 10 s (more than three looks).
async function quiet(F) {
  let last = await record(F), since = Date.now();
  for (const until = Date.now() + 120000 * SLOW; Date.now() - since < 10000;) {
    assert.ok(Date.now() < until, 'the copies never settled');
    await sleep(1000);
    const b = await record(F);
    if (b?.at !== last?.at) { last = b; since = Date.now(); }
  }
  return last;
}

describe('no sign-in travels with the state', { concurrency: 1 }, () => {
  let F, copy, cookie;
  before(async () => {
    F = await startMock({ statusMs: 1500, env: { SPARK_CONSOLE_BACKUP_FIRST_MS: '2000', SPARK_CONSOLE_BACKUP_MS: '3000' } });
    await waitFor(async () => (await record(F))?.ok, { timeout: 30000 * SLOW, what: 'the first copy' });
    // (the brain's first check, a minute after the start, writes its profile: copied, then quiet)
    await waitFor(() => existsSync(join(F.stateDir, 'brain-profiles.json')), { timeout: 150000 * SLOW, every: 1000, what: 'the brain’s first profile' }).catch(() => {});
    await quiet(F);
  }, { timeout: 400000 * SLOW });
  after(() => F?.stop(), { timeout: 30000 });

  test('a copy holds no sessions.json, and a sign-in alone sends no copy', { timeout: 300000 * SLOW }, async () => {
    // The owner sets up a passkey on the tailnet: a change, so a copy goes.
    const r0 = await record(F);
    const b = await ask(F, '/auth/passkey/begin', { method: 'POST', body: { purpose: 'register' } });
    assert.equal(b.status, 200, b.text);
    assert.equal((await ask(F, '/auth/passkey/register', { method: 'POST', body: KEY.register(b.json) })).status, 201);
    await waitFor(async () => { const x = await record(F); return x?.ok && x.at !== r0.at; }, { timeout: 30000 * SLOW, what: 'the copy after the passkey' });
    const r1 = await quiet(F);
    // A browser signs in from the internet with it: a session, the passkey's counter and last use. No copy for that.
    cookie = await signIn(F);
    assert.ok(cookie);
    assert.equal((await net(F, '/bootstrap', { headers: withCookie(cookie) })).status, 200, 'signed in');
    assert.ok(existsSync(join(F.stateDir, 'sessions.json')));
    await sleep(10000);
    assert.equal((await record(F)).at, r1.at, 'a sign-in alone sends no copy');
    // A change to the state: the copy that follows holds the passkey and the owner's access, and no sessions.json.
    assert.equal((await ask(F, '/agents/settings', { method: 'PUT', body: { selfHeal: false } })).status, 200);
    copy = await waitFor(async () => { const x = await record(F); return x?.ok && x.at !== r1.at && x; }, { timeout: 30000 * SLOW, what: 'a copy after a change' });
    const names = listed(copyFile(F, copy));
    assert.ok(names.includes('./passkeys.json') && names.includes('./access.json') && names.includes('./agent-settings.json'), names.join(' '));
    assert.ok(!names.some(n => /(^|\/)sessions\.json$/.test(n)), `no sessions.json in the copy: ${names.join(' ')}`);
  });

  test('state put back from that copy onto a fresh Spark Console signs no device in; the owner’s access and passkey are as the copy had them', { timeout: 300000 * SLOW }, async () => {
    assert.ok(copy && cookie, 'the copy and the cookie from the test before');
    const file = copyFile(F, copy), had = name => JSON.parse(execFileSync('tar', ['-xzOf', file, `./${name}`], { encoding: 'utf8' }));
    // A fresh Spark Console whose state folder is that copy, untarred with the service stopped (the rebuild's step 3).
    const G = await startMock({ prepare: ({ stateDir }) => execFileSync('tar', ['-xzf', file, '-C', stateDir]) });
    try {
      assert.equal((await net(G, '/bootstrap', { headers: withCookie(cookie) })).status, 401, 'the cookie from before signs nothing in');
      assert.ok(!existsSync(join(G.stateDir, 'sessions.json')), 'no session came back');
      assert.deepEqual(JSON.parse(readFileSync(join(G.stateDir, 'access.json'), 'utf8')), had('access.json'));
      assert.deepEqual(JSON.parse(readFileSync(join(G.stateDir, 'passkeys.json'), 'utf8')), had('passkeys.json'));
      const boot = await ask(G, '/bootstrap');
      assert.equal(boot.status, 200, boot.text);
      assert.equal(boot.json.viewer.role, 'owner', 'the owner is the owner on the tailnet');
      assert.deepEqual((await ask(G, '/auth/passkeys')).json.keys.map(k => k.id).sort(), had('passkeys.json').keys.map(k => k.id).sort());
      // The passkey that came back signs a browser in from the internet again.
      const again = await signIn(G);
      assert.ok(again);
      assert.equal((await net(G, '/bootstrap', { headers: withCookie(again) })).status, 200);
    } finally { await G.stop(); }
  });
});

// restore.sh, as the installer writes it into each snapshot.
const INSTALLER = readFileSync(join(REPO, 'deploy', 'host-on-portal.sh'), 'utf8');
const RESTORE = (() => {
  const a = INSTALLER.indexOf(`cat > "$SNAP/restore.sh" <<'RESTORE'\n`), b = INSTALLER.indexOf('\nRESTORE\n', a);
  assert.ok(a > 0 && b > a, 'restore.sh is in deploy/host-on-portal.sh');
  return INSTALLER.slice(INSTALLER.indexOf('\n', a) + 1, b + 1);
})();
describe('restore.sh --with-state', () => {
  // A made-up home: the live install and state, and a snapshot that holds its own state. systemctl and curl are
  // stand-ins (the service "answers" at once).
  function home({ liveSessions }) {
    const h = mkdtempSync(join(tmpdir(), 'sct-restore-')), snap = join(h, 'snap'), live = join(h, '.local', 'state', 'spark-console'), bin = join(h, 'bin');
    for (const d of [join(snap, 'state'), join(snap, 'spark-console'), join(snap, 'spark-console-service'), live, bin, join(h, 'spark-console'), join(h, 'spark-console-service')]) mkdirSync(d, { recursive: true });
    writeFileSync(join(snap, 'restore.sh'), RESTORE, { mode: 0o700 });
    writeFileSync(join(snap, 'state', 'sessions.json'), JSON.stringify({ sessions: [{ id: 'snapshotsess', hash: 'a'.repeat(64) }] }), { mode: 0o600 });
    writeFileSync(join(snap, 'state', 'passkeys.json'), JSON.stringify({ keys: [{ id: 'from-the-snapshot' }] }), { mode: 0o600 });
    writeFileSync(join(snap, 'state', 'memory.json'), JSON.stringify({ entries: ['from the snapshot'] }), { mode: 0o600 });
    writeFileSync(join(live, 'passkeys.json'), JSON.stringify({ keys: [{ id: 'live' }] }), { mode: 0o600 });
    if (liveSessions) writeFileSync(join(live, 'sessions.json'), liveSessions, { mode: 0o600 });
    writeFileSync(join(bin, 'systemctl'), '#!/bin/sh\nexit 0\n');
    writeFileSync(join(bin, 'curl'), '#!/bin/sh\necho \'{"ok":true}\'\n');
    for (const f of ['systemctl', 'curl']) chmodSync(join(bin, f), 0o755);
    return { h, snap, live, bin };
  }
  const run = ({ h, snap, bin }) => spawnSync('bash', [join(snap, 'restore.sh'), '--with-state'], { env: { ...process.env, HOME: h, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8', timeout: 60000 * SLOW });

  test('the snapshot’s state comes back but never its sessions.json: who is signed in stays as it is now', () => {
    const now = JSON.stringify({ sessions: [{ id: 'signedinnow1', hash: 'b'.repeat(64) }] });
    const x = home({ liveSessions: now });
    try {
      const r = run(x);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(readFileSync(join(x.live, 'sessions.json'), 'utf8'), now, 'the sessions of now stay');
      assert.deepEqual(JSON.parse(readFileSync(join(x.live, 'passkeys.json'), 'utf8')), { keys: [{ id: 'from-the-snapshot' }] }, 'the rest is put back');
      assert.deepEqual(JSON.parse(readFileSync(join(x.live, 'memory.json'), 'utf8')), { entries: ['from the snapshot'] });
    } finally { rmSync(x.h, { recursive: true, force: true }); }
  });

  test('with nobody signed in now, the snapshot’s sessions.json still doesn’t come back', () => {
    const x = home({ liveSessions: null });
    try {
      const r = run(x);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.ok(!existsSync(join(x.live, 'sessions.json')), readdirSync(x.live).join(' '));
      assert.deepEqual(JSON.parse(readFileSync(join(x.live, 'passkeys.json'), 'utf8')), { keys: [{ id: 'from-the-snapshot' }] });
    } finally { rmSync(x.h, { recursive: true, force: true }); }
  });
});
