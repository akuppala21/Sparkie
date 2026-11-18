// Covers: Self-test cleanup authority never travels in daily copies or returns from archived state. The real
// sendCopy tar stream omits self-test.json and its previous copy; generated state restore skips both old source
// files and removes live residue. Documented archive commands do the same. Code-only go-back preserves the current
// note byte for byte. Legacy release repair instructions name all four authority files. Every process uses made-up
// folders and stand-in systemctl/curl, never a real Spark or service.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { REPO, SLOW } from './lib.mjs';

const AUTHORITY = ['self-test.json', 'self-test.json.prev'];
const OLD = JSON.stringify({ operation: '123456789abc', spark: 'spark3', model: { container: 'sc-adopted', name: 'exact-model', id: 'a'.repeat(64), startedAt: '2026-11-17T00:00:00Z' } });
const CURRENT = JSON.stringify({ operation: 'abcdef123456', spark: 'spark3', model: { container: 'sc-current', id: 'b'.repeat(64), startedAt: '2026-11-17T01:00:00Z', wish: true, wishSaved: true } });
const source = readFileSync(join(REPO, 'service/src/25-backup-and-start.mjs'), 'utf8');
const sendSource = /^function sendCopy\([^]*?^\}/m.exec(source)?.[0];
assert.ok(sendSource, 'actual sendCopy source');
const installer = readFileSync(join(REPO, 'deploy/host-on-portal.sh'), 'utf8');
const mark = `cat > "$SNAP/restore.sh" <<'RESTORE'\n`, start = installer.indexOf(mark), end = installer.indexOf('\nRESTORE\n', start);
assert.ok(start >= 0 && end > start, 'actual generated restore script');
const restore = installer.slice(start + mark.length, end + 1);
const shell = (command, env) => spawnSync('bash', ['-c', command], { env, encoding: 'utf8', timeout: 60000 * SLOW });
const okay = result => assert.equal(result.status, 0, `${result.stdout || ''}\n${result.stderr || ''}`);
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'selftest-copy-')), live = join(home, '.local/state/spark-console'),
    snap = join(home, '.local/share/spark-console/releases/20261117T000000Z'), bin = join(home, 'bin');
  for (const d of [live, join(snap, 'state'), bin, join(snap, 'spark-console'), join(snap, 'spark-console-service'), join(home, 'spark-console'), join(home, 'spark-console-service')]) mkdirSync(d, { recursive: true });
  writeFileSync(join(snap, 'restore.sh'), restore, { mode: 0o700 });
  writeFileSync(join(snap, 'spark-console', 'version'), 'old page');
  writeFileSync(join(snap, 'spark-console-service', 'version'), 'old program');
  writeFileSync(join(home, 'spark-console-service', 'version'), 'current program');
  writeFileSync(join(snap, 'state', 'memory.json'), '{"entries":["saved memory"]}');
  writeFileSync(join(snap, 'state', 'memory.json.prev'), '{"entries":["previous memory"]}');
  writeFileSync(join(bin, 'systemctl'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$HOME/systemctl.calls"\n', { mode: 0o700 });
  writeFileSync(join(bin, 'curl'), '#!/bin/sh\necho \'{"ok":true}\'\n', { mode: 0o700 });
  for (const name of ['ssh', 'sudo', 'tailscale', 'systemd-run']) writeFileSync(join(bin, name), '#!/bin/sh\nexit 97\n', { mode: 0o700 });
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, DBUS_SESSION_BUS_ADDRESS: '' };
  return { home, live, snap, env };
}
const clean = x => rmSync(x.home, { recursive: true, force: true });
function restored(x, withState = true) {
  const result = spawnSync('bash', [join(x.snap, 'restore.sh'), '--stand-in', ...(withState ? ['--with-state'] : [])], { env: x.env, encoding: 'utf8', timeout: 60000 * SLOW });
  okay(result); assert.equal(readFileSync(join(x.home, 'spark-console-service', 'version'), 'utf8'), 'old program', 'program restoration really ran');
}

test('the actual daily copy excludes both self-test authority files and preserves current note bytes', { timeout: 120000 * SLOW }, async () => {
  const x = fixture(), targetHome = join(x.home, 'other-spark'); mkdirSync(targetHome);
  try {
    for (const name of AUTHORITY) writeFileSync(join(x.live, name), CURRENT);
    writeFileSync(join(x.live, 'desired.json'), '{"revision":8,"running":[],"revisions":[]}');
    writeFileSync(join(x.live, 'memory.json.prev'), '{"entries":["kept previous memory"]}');
    const env = { ...x.env, HOME: targetHome };
    const run = (target, command) => new Promise(resolve => {
      const child = spawn('bash', ['-c', command], { env, stdio: 'ignore' });
      child.once('error', () => resolve({ code: 1 })); child.once('close', code => resolve({ code }));
    });
    const send = new Function('spawn', 'STATE_DIR', 'spawnOn', 'run', `${sendSource}\nreturn sendCopy;`)(spawn, x.live,
      (target, { command }) => spawn('bash', ['-c', command], { env, stdio: ['pipe', 'ignore', 'ignore'] }), run);
    assert.equal(await send({ id: 'stand-in' }, 'state-2026-11-17.tgz'), true);
    const archive = join(targetHome, '.local/share/spark-console/backups/state-2026-11-17.tgz');
    const listed = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' }); okay(listed);
    const names = listed.stdout.split('\n');
    for (const name of AUTHORITY) {
      assert.ok(!names.includes(`./${name}`), `${name} must not carry old cleanup permission in a copy`);
      assert.equal(readFileSync(join(x.live, name), 'utf8'), CURRENT, 'making a copy never changes the live note');
    }
    assert.ok(names.includes('./desired.json')); assert.ok(names.includes('./memory.json.prev'));
  } finally { clean(x); }
});

test('state restore skips both authority files in an older snapshot and removes both destination copies', () => {
  const x = fixture();
  try {
    for (const name of AUTHORITY) { writeFileSync(join(x.snap, 'state', name), OLD); writeFileSync(join(x.live, name), CURRENT); }
    restored(x);
    for (const name of AUTHORITY) assert.equal(existsSync(join(x.live, name)), false, `${name} is never imported or retained`);
    assert.equal(readFileSync(join(x.live, 'memory.json'), 'utf8'), '{"entries":["saved memory"]}');
    assert.ok(existsSync(join(x.live, 'memory.json.prev')), 'unrelated previous state is still recoverable');
  } finally { clean(x); }
});
test('state restore clears destination authority even when the snapshot has neither file', () => {
  const x = fixture();
  try {
    for (const name of AUTHORITY) writeFileSync(join(x.live, name), CURRENT);
    restored(x);
    for (const name of AUTHORITY) assert.equal(existsSync(join(x.live, name)), false, `${name} residue cannot survive state replacement`);
  } finally { clean(x); }
});
test('ordinary go-back without state restoration keeps the current primary and previous note unchanged', () => {
  const x = fixture();
  try {
    for (const name of AUTHORITY) { writeFileSync(join(x.snap, 'state', name), OLD); writeFileSync(join(x.live, name), CURRENT); }
    const result = spawnSync('bash', [join(REPO, 'deploy/go-back.sh'), '--stand-in'], { env: x.env, encoding: 'utf8', timeout: 60000 * SLOW }); okay(result);
    assert.equal(readFileSync(join(x.home, 'spark-console-service', 'version'), 'utf8'), 'old program');
    for (const name of AUTHORITY) assert.equal(readFileSync(join(x.live, name), 'utf8'), CURRENT, `${name} stays current during code-only rollback`);
  } finally { clean(x); }
});
for (const doc of ['docs/sharing.md', 'deploy/REBUILD.txt']) test(`${doc}: documented older archive restore never imports authority or retains destination residue`, () => {
  const x = fixture();
  try {
    const archive = join(x.home, 'old-state.tgz');
    for (const name of AUTHORITY) { writeFileSync(join(x.snap, 'state', name), OLD); writeFileSync(join(x.live, name), CURRENT); }
    okay(spawnSync('tar', ['-C', join(x.snap, 'state'), '-czf', archive, '.'], { encoding: 'utf8' }));
    const text = readFileSync(join(REPO, doc), 'utf8').replace(/\\\n\s*/g, ' ');
    const extract = doc.endsWith('.md') ? /run `(tar -xzf <copy>[^`]+)`/.exec(text)?.[1] : /^\s*(tar -xzf [^\n]+)/m.exec(text)?.[1];
    const remove = doc.endsWith('.md') ? /`(rm -f ~\/\.local\/state\/spark-console\/saved-runs\.json[^`]+)`/.exec(text)?.[1] : /^\s*(rm -f ~\/\.local\/state\/spark-console\/saved-runs\.json[^\n]+)/m.exec(text)?.[1];
    assert.ok(extract && remove, 'the documented extraction and cleanup commands are executable');
    okay(shell(extract.replace(/\s+/g, ' ').replace(/^tar -xzf \S+/, `tar -xzf ${quote(archive)}`), x.env));
    okay(shell(remove, x.env));
    for (const name of AUTHORITY) assert.equal(existsSync(join(x.live, name)), false, `${name} grants no restored authority`);
    assert.ok(existsSync(join(x.live, 'memory.json')));
  } finally { clean(x); }
});
test('the generated registry classifies the self-test note as not copied daily', () => {
  const row = readFileSync(join(REPO, 'docs/registry.md'), 'utf8').split('\n').find(line => line.startsWith('| `self-test.json` |'));
  assert.ok(row); assert.equal(row.split('|')[4].trim(), 'no');
});

test('the shipped legacy release repair instructions forbid restoring either authority pair and require live cleanup before restart', () => {
  const text = readFileSync(join(REPO, 'deploy/RECOVERY.txt'), 'utf8');
  const repair = /Do not run its old restore\.sh --with-state[^]*?before restarting\./.exec(text)?.[0];
  assert.ok(repair, 'old scripts must be repaired before they can restart the service');
  for (const file of ['saved-runs.json', 'saved-runs.json.prev', ...AUTHORITY]) assert.ok(repair.includes(file), `${file} is named in the old-script skip/remove instruction`);
  assert.match(repair, /skip and remove/); assert.match(repair, /~\/\.local\/state\/spark-console before restarting/);
});
