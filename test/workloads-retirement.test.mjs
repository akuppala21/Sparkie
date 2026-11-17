// Covers: A completed saved workflow revokes its primary cleanup record before an optional unlink. Normal completion
// still removes the file; an unlink failure leaves a durable empty record and healthy work survives a restart.
// A failed retirement write preserves active receipts, never attempts a fallback unlink, and reports the remaining
// restart risk without leaking error contents. That combined persistence failure is not claimed restart-safe.
// Actual stand-in service, existing CPU apps and a test-only filesystem fault shim; no real Sparks.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { T, useFleet, api, waitFor, sleep, SERVICE_FILE, REPO, SLOW } from './lib.mjs';

const SHIM = mkdtempSync(join(tmpdir(), 'saved-retirement-')), PRIVATE = 'quiet parchment meadow';
writeFileSync(join(SHIM, 'fault.mjs'), `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
if (/\\/service\\/server\\.mjs$/.test(process.argv[1] || '') && process.env.MOCK_DIR) {
  const file = process.env.SPARK_CONSOLE_STATE_DIR + '/saved-runs.json', dir = process.env.MOCK_DIR;
  const rename = fs.renameSync, unlink = fs.unlinkSync;
  const trace = value => fs.appendFileSync(dir + '/retirement-trace.jsonl', JSON.stringify(value) + '\\n');
  fs.renameSync = (from, to) => {
    if (String(to) === file) {
      const next = JSON.parse(fs.readFileSync(from, 'utf8'));
      if (next.runs && !Object.keys(next.runs).length) {
        trace({ kind: 'retirement-write' });
        if (fs.existsSync(dir + '/retirement-write-fails')) throw Object.assign(new Error('${PRIVATE}'), { code: 'EIO' });
      }
    }
    return rename(from, to);
  };
  fs.unlinkSync = target => {
    if (String(target) === file) {
      trace({ kind: 'unlink', runs: Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).runs) });
      if (fs.existsSync(dir + '/retirement-unlink-fails')) throw Object.assign(new Error('${PRIVATE}'), { code: 'EACCES' });
    }
    return unlink(target);
  };
  syncBuiltinESMExports();
}
`);
let current = null;
after(async () => {
  if (current && current.exitCode === null && current.signalCode === null) {
    const gone = new Promise(resolve => current.once('exit', resolve));
    current.kill('SIGKILL');
    assert.equal(await Promise.race([gone.then(() => true), sleep(5000).then(() => false)]), true, 'replacement service exited');
  }
});
useFleet({ watchMs: 60000, statusMs: 3000, env: {
  NODE_OPTIONS: `--import=${join(SHIM, 'fault.mjs')}`, SPARK_CONSOLE_APP_ANSWER_MS: '3000',
} });
after(() => rmSync(SHIM, { recursive: true, force: true }));
const file = () => join(T.fleet.stateDir, 'saved-runs.json');
const fault = name => join(T.fleet.dir, `retirement-${name}-fails`);
const trace = () => {
  const path = join(T.fleet.dir, 'retirement-trace.jsonl');
  return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
};
const stateOf = name => readFileSync(join(T.fleet.root, 'spark4', '.mock', 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];
const act = (name, body) => api(`/actions/${name}`, { method: 'POST', body });
const freePort = () => new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const port = s.address().port; s.close(() => resolve(port)); }); });
async function ended(id) {
  return waitFor(async () => {
    const r = await api(`/jobs/${id}`);
    assert.equal(r.status, 200, r.text);
    return r.json.status === 'running' ? null : r.json;
  }, { timeout: 180000, every: 250, what: `retirement operation ${id} to finish` });
}
async function seed(name) {
  const made = await act('keep_running', { spark: 'spark4', container: name, image: 'nginx:1.27', port: `${await freePort()}:80` });
  assert.equal(made.json.outcome, 'started', made.text);
  assert.equal((await ended(made.json.operation)).status, 'completed');
  const stopped = await act('keep_running', { spark: 'spark4', container: name, do: 'stop' });
  assert.equal(stopped.json.outcome, 'started', stopped.text);
  assert.equal((await ended(stopped.json.operation)).status, 'completed');
  assert.equal(stateOf(name), 'exited');
  const saved = await act('save_workflow', { title: name, steps: [{ action: 'keep_running', args: { spark: 'spark4', container: name } }] });
  assert.equal(saved.status, 200, saved.text);
}
async function run(name) {
  const r = await act('run_workflow', { name });
  assert.equal(r.json.outcome, 'started', r.text);
  const done = await ended(r.json.operation);
  assert.equal(done.status, 'completed', JSON.stringify(done));
  assert.equal(stateOf(name), 'running', 'a routine without a job leaves its healthy app running');
  return done;
}
async function restart() {
  if (current) {
    const gone = new Promise(resolve => current.once('exit', resolve));
    current.kill('SIGKILL');
    assert.equal(await Promise.race([gone.then(() => true), sleep(5000).then(() => false)]), true, 'previous replacement exited');
  } else {
    process.kill(T.fleet.servicePid(), 'SIGKILL');
    await waitFor(() => T.fleet.serviceExit(), { timeout: 10000, what: 'original retirement service to exit' });
  }
  current = spawn(process.execPath, [SERVICE_FILE], { cwd: REPO, env: T.fleet.env, stdio: 'ignore' });
  await waitFor(async () => (await api('/health').catch(() => null))?.status === 200, { timeout: 30000, what: 'retirement service restarted' });
}

test('ordinary completed saved work still removes its note after revoking the record', { timeout: 240000 * SLOW }, async () => {
  await seed('retire-normal');
  const from = trace().length;
  await run('retire-normal');
  assert.ok(!existsSync(file()), 'ordinary successful deletion remains unchanged');
  assert.deepEqual(trace().slice(from), [{ kind: 'retirement-write' }, { kind: 'unlink', runs: [] }]);
});

test('failed unlink leaves an empty primary, so restart never stops completed healthy work', { timeout: 300000 * SLOW }, async t => {
  await seed('retire-unlink');
  writeFileSync(fault('unlink'), '');
  t.after(() => rmSync(fault('unlink'), { force: true }));
  const from = trace().length, done = await run('retire-unlink');
  assert.deepEqual(trace().slice(from), [{ kind: 'retirement-write' }, { kind: 'unlink', runs: [] }], 'the primary is empty before the unlink is attempted');
  assert.deepEqual(JSON.parse(readFileSync(file(), 'utf8')), { runs: {} });
  assert.ok(done.log.some(line => /empty file couldn’t be removed/.test(line)), done.log.join('\n'));
  assert.ok(done.log.some(line => /no longer lets a restart stop/.test(line)), done.log.join('\n'));
  assert.ok(!JSON.stringify(done).includes(PRIVATE), 'filesystem error contents stay out of the result');
  await restart();
  assert.equal(stateOf('retire-unlink'), 'running');
  assert.equal(stateOf('retire-normal'), 'running');
  assert.deepEqual(JSON.parse(readFileSync(file(), 'utf8')), { runs: {} });
});

test('failed retirement persistence with unlink also unavailable warns explicitly and makes no unsafe deletion attempt', { timeout: 240000 * SLOW }, async t => {
  await seed('retire-write');
  writeFileSync(fault('write'), '');
  writeFileSync(fault('unlink'), '');
  t.after(() => { rmSync(fault('write'), { force: true }); rmSync(fault('unlink'), { force: true }); });
  const from = trace().length, done = await run('retire-write');
  assert.deepEqual(trace().slice(from), [{ kind: 'retirement-write' }], 'failed write never reaches unlink, even if it would fail too');
  const left = JSON.parse(readFileSync(file(), 'utf8')).runs[done.id];
  assert.equal(left.operation, done.id, 'stale authority still exists; durable retirement is unresolved');
  assert.ok(left.started.some(item => item.container === 'retire-write' && item.seen?.id), JSON.stringify(left));
  assert.ok(done.log.some(line => /Couldn’t clear the note of this saved workflow/.test(line)), done.log.join('\n'));
  assert.ok(done.log.some(line => /restart could stop work this run already finished with/.test(line)), done.log.join('\n'));
  assert.ok(!done.log.some(line => /no longer lets a restart stop/.test(line)));
  assert.ok(!JSON.stringify(done).includes(PRIVATE), 'write errors use fixed failure words');
  // Deliberately no restart: this case proves and reports the remaining inability to retire authority, not safety.
});

test('retiring one completed entry preserves another active run and never unlinks the shared file', () => {
  const source = readFileSync(new URL('../service/src/18-run-record.mjs', import.meta.url), 'utf8');
  const fn = /^function savedRunDone\([^]*?^\}/m.exec(source)?.[0];
  assert.ok(fn);
  const done = { operation: '012345abcdef' }, active = { operation: 'fedcba654321', started: [{ container: 'still-owned' }] };
  let saved = null, unlinks = 0;
  const notes = [];
  const retire = new Function('savedRunsNow', 'writePrivate', 'unlinkSync', 'note', 'SAVED_RUNS_FILE', `${fn}\nreturn savedRunDone;`)(
    () => ({ runs: { [done.operation]: done, [active.operation]: active } }),
    (_file, value) => { saved = value; }, () => { unlinks++; }, (_job, line) => notes.push(line), 'saved-runs.json');
  retire({ id: done.operation });
  assert.deepEqual(saved, { runs: { [active.operation]: active } });
  assert.equal(unlinks, 0);
  assert.deepEqual(notes, []);
});
