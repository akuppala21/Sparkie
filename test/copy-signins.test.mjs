// Covers: No sign-in travels with the state (E2b; contract 6.25; design E 2.5): a copy of the state holds no
// `sessions.json`, and a sign-in alone sends no copy (the passkey's counter and last use don't count); nor does it hold
// `saved-runs.json` or `saved-runs.json.prev` (old saved-run cleanup authority, R57); state put back
// from a copy onto a fresh Spark Console signs no device in (the old cookie gets 401) while the owner's access and
// passkey are as the copy had them (the passkey signs in from the internet again once the owner, on the tailnet, has
// kept what came back: E2c, the copy has a number and the new disk none); `restore.sh --with-state` puts an
// install snapshot's state back but never its `sessions.json` or either saved-run authority file, including an older
// snapshot or a destination with an old file already there. Other `.prev` files remain recoverable. The registry's "Copied
// daily" column agrees with what a real copy holds, for each state file there (TR-6).
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
import { Authenticator, passkeyHeader } from './authenticator.mjs';

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

  test('a copy holds no sessions.json', { timeout: 300000 * SLOW }, async () => {
    // The owner sets up a passkey on the tailnet, and a browser signs in with it from the internet: a session.
    const b = await ask(F, '/auth/passkey/begin', { method: 'POST', body: { purpose: 'register' } });
    assert.equal(b.status, 200, b.text);
    assert.equal((await ask(F, '/auth/passkey/register', { method: 'POST', body: KEY.register(b.json) })).status, 201);
    const signedIn = await signIn(F);
    assert.equal((await net(F, '/bootstrap', { headers: withCookie(signedIn) })).status, 200, 'signed in');
    assert.ok(existsSync(join(F.stateDir, 'sessions.json')));
    // Then a change to the state (a file of its own, as any state file is written): the copy that follows holds the
    // passkey and the owner's access, and no sessions.json.
    const r0 = await quiet(F);
    writeFileSync(join(F.stateDir, 'test-change.json'), JSON.stringify({ at: new Date().toISOString() }), { mode: 0o600 });
    const c = await waitFor(async () => { const x = await record(F); return x?.ok && x.at !== r0.at && x; }, { timeout: 30000 * SLOW, what: 'a copy after a change' });
    copy = c; cookie = signedIn;
    const names = listed(copyFile(F, c));
    assert.ok(names.includes('./passkeys.json') && names.includes('./access.json') && names.includes('./test-change.json'), names.join(' '));
    assert.ok(!names.some(n => /(^|\/)sessions\.json$/.test(n)), `no sessions.json in the copy: ${names.join(' ')}`);
  });

  test('a sign-in alone sends no copy (a session, and the passkey’s counter and last use)', { timeout: 300000 * SLOW }, async () => {
    const r1 = await quiet(F);
    const again = await signIn(F);
    assert.equal((await net(F, '/bootstrap', { headers: withCookie(again) })).status, 200, 'signed in');
    await sleep(10000);
    assert.equal((await record(F)).at, r1.at, 'no copy');
  });

  test('a copy holds no saved-runs.json (a saved workflow’s run under way when it was made)', { timeout: 300000 * SLOW }, async () => {
    const r0 = await quiet(F), runs = join(F.stateDir, 'saved-runs.json'), present = new Set(readdirSync(F.stateDir));
    // (written while the service runs: it reads the record only at its start)
    writeFileSync(runs, JSON.stringify({ runs: { 'op-copy-test': { operation: 'op-copy-test', since: new Date().toISOString(), title: 'a run under way', steps: 2, step: 1,
      started: [{ kind: 'model', spark: 'spark4', container: 'sc-RadixArk--Qwen3.8-27B-NVFP4' }] } } }), { mode: 0o600 });
    try {
      writeFileSync(join(F.stateDir, 'test-change-2.json'), JSON.stringify({ at: new Date().toISOString() }), { mode: 0o600 });
      const c = await waitFor(async () => { const x = await record(F); return x?.ok && x.at !== r0.at && x; }, { timeout: 30000 * SLOW, what: 'a copy after a change' });
      const names = listed(copyFile(F, c));
      assert.ok(names.includes('./test-change-2.json'), names.join(' '));
      assert.ok(!names.some(n => /(^|\/)saved-runs\.json$/.test(n)), `no saved-runs.json in the copy: ${names.join(' ')}`);
      // (docs/registry.md's "Copied daily" says what this copy did, for each state file that was there before it, TR-6)
      const rows = readFileSync(join(REPO, 'docs', 'registry.md'), 'utf8').split('\n').map(l => /^\| `([\w.-]+)` \| `[\w-]+` \| .* \| (yes|no) \| (?:yes|no) \|$/.exec(l)).filter(Boolean);
      assert.deepEqual(['saved-runs.json', 'sessions.json'].map(f => rows.find(r => r[1] === f)?.[2]), ['no', 'no'], 'the registry lists both as not copied');
      for (const [, file, copied] of rows.filter(r => present.has(r[1]) || r[1] === 'saved-runs.json')) assert.equal(names.includes(`./${file}`) ? 'yes' : 'no', copied, `${file}: the registry says “Copied daily: ${copied}”`);
    } finally { rmSync(runs, { force: true }); }
  });

  test('a copy leaves out both saved-run authority files while keeping other previous state', { timeout: 300000 * SLOW }, async () => {
    const r0 = await quiet(F), files = ['saved-runs.json', 'saved-runs.json.prev', 'test-kept.json.prev', 'test-change-authority.json'];
    const before = new Map(files.map(f => [f, existsSync(join(F.stateDir, f)) ? readFileSync(join(F.stateDir, f)) : null]));
    try {
      const oldRun = { runs: { old: { operation: 'old', started: [{ kind: 'model', spark: 'spark4', container: 'sc-current', seen: { id: 'old-container-id', startedAt: 'old-start' } }] } } };
      for (const f of files.slice(0, 2)) writeFileSync(join(F.stateDir, f), JSON.stringify(oldRun), { mode: 0o600 });
      writeFileSync(join(F.stateDir, 'test-kept.json.prev'), JSON.stringify({ entries: ['kept previous state'] }), { mode: 0o600 });
      writeFileSync(join(F.stateDir, 'test-change-authority.json'), JSON.stringify({ at: new Date().toISOString() }), { mode: 0o600 });
      const c = await waitFor(async () => { const x = await record(F); return x?.ok && x.at !== r0.at && x; }, { timeout: 30000 * SLOW, what: 'a copy with previous-state files present' });
      const names = listed(copyFile(F, c));
      assert.ok(!names.some(n => /(^|\/)saved-runs\.json(?:\.prev)?$/.test(n)), `no old saved-run authority in the copy: ${names.join(' ')}`);
      assert.ok(names.includes('./test-kept.json.prev'), 'other previous state is still copied');
      assert.ok(names.includes('./test-change-authority.json'), 'the requested changed state reached the archive');
    } finally {
      for (const [f, data] of before) { if (data === null) rmSync(join(F.stateDir, f), { force: true }); else writeFileSync(join(F.stateDir, f), data, { mode: 0o600 }); }
    }
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
      // (E2c, contract 6.25) Not before the owner has looked at what came back, on the tailnet, and kept it: the copy
      // carries the number its first passkey gave it, and this disk's secrets file has none, so the start held.
      const held = await net(G, '/auth/signin/begin', { method: 'POST', body: {} });
      assert.equal(held.status, 403, held.text);
      assert.equal(held.json.error, 'Spark Console’s state was put back from a copy. Open it once on your tailnet and look at the list of what came back; after that, sign-in from the internet works again.');
      const c = await ask(G, '/auth/passkey/begin', { method: 'POST', body: { purpose: 'confirm', method: 'POST', path: '/auth/putback/keep', body: {} } });
      assert.equal(c.status, 200, c.text);
      const kept = await ask(G, '/auth/putback/keep', { method: 'POST', body: {}, headers: { 'x-spark-passkey': passkeyHeader(KEY.sign(c.json)) } });
      assert.equal(kept.status, 200, kept.text);
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
  // stand-ins (the service "answers" at once), kept first on the PATH as on the stand-in fleet (--stand-in).
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
  const run = ({ h, snap, bin }) => spawnSync('bash', [join(snap, 'restore.sh'), '--with-state', '--stand-in'], { env: { ...process.env, HOME: h, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8', timeout: 60000 * SLOW });

  // (E2c, contract 6.25: until then the devices signed in at the time stayed signed in)
  test('the snapshot’s state comes back but never its sessions.json, and every device signs in again', () => {
    const now = JSON.stringify({ sessions: [{ id: 'signedinnow1', hash: 'b'.repeat(64) }] });
    const x = home({ liveSessions: now });
    try {
      const r = run(x);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.ok(!existsSync(join(x.live, 'sessions.json')), 'no device stays signed in');
      assert.deepEqual(JSON.parse(readFileSync(join(x.live, 'passkeys.json'), 'utf8')), { keys: [{ id: 'from-the-snapshot' }] }, 'the rest is put back');
      assert.deepEqual(JSON.parse(readFileSync(join(x.live, 'memory.json'), 'utf8')), { entries: ['from the snapshot'] });
    } finally { rmSync(x.h, { recursive: true, force: true }); }
  });

  test('an older snapshot restores neither saved-run authority file and removes both live copies', () => {
    const x = home({ liveSessions: null });
    try {
      for (const f of ['saved-runs.json', 'saved-runs.json.prev']) {
        writeFileSync(join(x.snap, 'state', f), JSON.stringify({ runs: { old: { operation: 'old', started: [{ spark: 'spark4', container: 'sc-current' }] } } }));
        writeFileSync(join(x.live, f), JSON.stringify({ runs: { current: { operation: 'current' } } }));
      }
      writeFileSync(join(x.snap, 'state', 'memory.json.prev'), JSON.stringify({ entries: ['previous snapshot memory'] }));
      const r = run(x);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      for (const f of ['saved-runs.json', 'saved-runs.json.prev']) assert.ok(!existsSync(join(x.live, f)), `${f} restores no cleanup authority`);
      assert.deepEqual(JSON.parse(readFileSync(join(x.live, 'memory.json.prev'), 'utf8')), { entries: ['previous snapshot memory'] });
      assert.deepEqual(JSON.parse(readFileSync(join(x.live, 'memory.json'), 'utf8')), { entries: ['from the snapshot'] });
    } finally { rmSync(x.h, { recursive: true, force: true }); }
  });

  test('a snapshot without saved-run files still clears both files left in the destination', () => {
    const x = home({ liveSessions: null });
    try {
      for (const f of ['saved-runs.json', 'saved-runs.json.prev']) writeFileSync(join(x.live, f), JSON.stringify({ runs: { old: { operation: 'old' } } }));
      const r = run(x);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      for (const f of ['saved-runs.json', 'saved-runs.json.prev']) assert.ok(!existsSync(join(x.live, f)), `${f} does not survive state restoration`);
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
