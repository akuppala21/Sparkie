// Covers: Saved workflow recovery reads only a valid primary saved-runs.json. Malformed, invalid and unreadable
// primaries remain untouched and show a persistent owner problem; a stale valid .prev never stops healthy work,
// including when the primary is missing. Corruption during a live start's receipt capture never fails its saved
// workflow or stops its healthy app; failed Keep and Done writes are reported and preserve the primary. A valid
// interrupted primary still stops exactly the app its real service receipt identifies. Stand-ins only, no real Sparks.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { T, useFleet, api, waitFor, sleep, eventLines, SERVICE_FILE, REPO, SLOW } from './lib.mjs';

const HEALTHY = 'record-healthy', ACTIVE = 'record-active', OLD = '012345abcdef';
const BAD = '{"runs": broken primary kept byte for byte\n';
let current = null, previous;
// Stop the replacement before useFleet removes its state directory.
after(async () => {
  if (current && current.exitCode === null && current.signalCode === null) {
    const ended = new Promise(resolve => current.once('exit', resolve));
    current.kill('SIGKILL');
    assert.equal(await Promise.race([ended.then(() => true), sleep(5000).then(() => false)]), true, 'replacement service exited');
  }
});
useFleet({ watchMs: 60000, statusMs: 3000, env: { SPARK_CONSOLE_APP_ANSWER_MS: '3000' }, prepare: ({ root }) => {
  writeFileSync(join(root, 'spark4', '.mock', 'ids-per-run'), '');
  writeFileSync(join(root, 'spark4', '.mock', 'stamp-starts'), '');
} }, async () => {
  const job = await createApp(HEALTHY), seen = job.startedReceipts?.[`spark4/${HEALTHY}`];
  assert.ok(seen?.id && seen.startedAt, JSON.stringify(job));
  previous = JSON.stringify({ runs: { [OLD]: { operation: OLD, title: 'old finished run', since: job.createdAt,
    started: [{ kind: 'app', spark: 'spark4', container: HEALTHY, keep: false, seen: { id: seen.id, startedAt: seen.startedAt } }], pending: [] } } });
});
const file = () => join(T.fleet.stateDir, 'saved-runs.json');
const mock = name => join(T.fleet.root, 'spark4', '.mock', name);
const stateOf = name => readFileSync(mock('containers'), 'utf8').split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];
const freePort = () => new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const port = s.address().port; s.close(() => resolve(port)); }); });
const act = (name, body = {}) => api(`/actions/${name}`, { method: 'POST', body });
async function ended(id) {
  return waitFor(async () => {
    const r = await api(`/jobs/${id}`);
    assert.equal(r.status, 200, r.text);
    return r.json.status === 'running' ? null : r.json;
  }, { timeout: 180000, every: 250, what: `saved-record operation ${id} to end` });
}
async function restart() {
  if (current) {
    const gone = new Promise(resolve => current.once('exit', resolve));
    current.kill('SIGKILL');
    assert.equal(await Promise.race([gone.then(() => true), sleep(5000).then(() => false)]), true, 'previous replacement exited');
  } else {
    process.kill(T.fleet.servicePid(), 'SIGKILL');
    await waitFor(() => T.fleet.serviceExit(), { timeout: 10000, what: 'original record service to exit' });
  }
  current = spawn(process.execPath, [SERVICE_FILE], { cwd: REPO, env: T.fleet.env, stdio: 'ignore' });
  await waitFor(async () => (await api('/health').catch(() => null))?.status === 200,
    { timeout: 30000, what: 'saved-record service to answer after restart' });
}
async function problems() {
  const r = await act('fleet_status');
  assert.equal(r.status, 200, r.text);
  return r.json.needsOwner;
}
const readProblem = lines => lines.filter(l => /note of saved workflows under way can’t be read/.test(l));
async function createApp(name) {
  const r = await act('keep_running', { spark: 'spark4', container: name, image: 'nginx:1.27', port: `${await freePort()}:80` });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.outcome, 'started', r.text);
  const job = await ended(r.json.operation);
  assert.equal(job.status, 'completed', JSON.stringify(job));
  assert.equal(stateOf(name), 'running');
  return job;
}

for (const [label, primary] of [
  ['malformed JSON', BAD], ['null root', 'null'], ['array root', '[]'], ['missing runs', '{}'],
  ['array runs', '{"runs":[]}'], ['null run', JSON.stringify({ runs: { [OLD]: null } })],
  ['mismatched operation', JSON.stringify({ runs: { [OLD]: { operation: 'fedcba654321', started: [] } } })],
  ['invalid receipt shape', JSON.stringify({ runs: { [OLD]: { operation: OLD, pending: [{ kind: 'app', spark: 'spark4', container: HEALTHY, seen: { id: 12 } }] } } })],
]) {
  test(`${label}: a stale valid previous record grants no cleanup authority`, { timeout: 180000 * SLOW }, async () => {
    writeFileSync(file(), primary);
    writeFileSync(`${file()}.prev`, previous);
    const containers = readFileSync(mock('containers'), 'utf8'), events = eventLines().length;
    await restart();
    assert.equal((await api('/health')).status, 200);
    assert.equal(stateOf(HEALTHY), 'running');
    assert.equal(readFileSync(mock('containers'), 'utf8'), containers, 'no stale receipt stopped current work');
    assert.equal(readFileSync(file(), 'utf8'), primary, 'primary bytes preserved');
    assert.equal(readFileSync(`${file()}.prev`, 'utf8'), previous, 'previous record was neither promoted nor replaced');
    assert.ok(!readdirSync(T.fleet.stateDir).some(n => n.startsWith('saved-runs.json.unreadable-')), 'primary was not moved aside');
    assert.equal(readProblem(await problems()).length, 1, 'the owner sees the read problem');
    assert.equal(readProblem(await problems()).length, 1, 'reading status does not clear the problem');
    assert.ok(!eventLines().slice(events).some(e => e.type === 'notice' && /cut off the saved workflow “old finished run”/.test(e.text || '')));
    writeFileSync(file(), '{"runs":{}}');
    assert.equal(readProblem(await problems()).length, 0, 'a valid primary clears the problem');
  });
}

test('a primary read error preserves the unreadable entry and ignores the previous receipt', { timeout: 180000 * SLOW }, async () => {
  rmSync(file(), { force: true });
  mkdirSync(file());
  writeFileSync(join(file(), 'untouched'), 'preserve this directory entry');
  writeFileSync(`${file()}.prev`, previous);
  try {
    await restart();
    assert.equal(stateOf(HEALTHY), 'running');
    assert.equal(readFileSync(join(file(), 'untouched'), 'utf8'), 'preserve this directory entry');
    assert.equal(readFileSync(`${file()}.prev`, 'utf8'), previous);
    assert.equal(readProblem(await problems()).length, 1);
  } finally { rmSync(file(), { recursive: true, force: true }); }
});

test('a missing primary does not revive its valid previous cleanup record', { timeout: 180000 * SLOW }, async () => {
  rmSync(file(), { force: true });
  writeFileSync(`${file()}.prev`, previous);
  await restart();
  assert.equal(stateOf(HEALTHY), 'running');
  assert.ok(!existsSync(file()), 'no previous record was promoted');
  assert.equal(readFileSync(`${file()}.prev`, 'utf8'), previous);
  assert.equal(readProblem(await problems()).length, 0, 'missing is empty, not unreadable');
});

test('a corrupt primary during receipt capture leaves a healthy saved-workflow start running and reports failed record updates', { timeout: 300000 * SLOW }, async t => {
  writeFileSync(file(), '{"runs":{}}');
  writeFileSync(`${file()}.prev`, previous);
  writeFileSync(mock('slow-run'), String(10 * SLOW));
  t.after(() => rmSync(mock('slow-run'), { force: true }));
  const saved = await act('save_workflow', { title: 'record live start', steps: [
    { action: 'keep_running', args: { spark: 'spark4', container: ACTIVE, image: 'nginx:1.27', port: `${await freePort()}:80` } },
  ] });
  assert.equal(saved.status, 200, saved.text);
  const run = await act('run_workflow', { name: 'record live start' });
  assert.equal(run.json.outcome, 'started', run.text);
  await waitFor(() => {
    const record = JSON.parse(readFileSync(file(), 'utf8')).runs[run.json.operation];
    return record?.awaiting?.length && record.awaiting[0].operation ? record : null;
  }, { timeout: 120000, every: 100, what: 'the saved workflow awaiting its delayed app receipt' });
  writeFileSync(file(), BAD);
  const result = await ended(run.json.operation);
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.equal(stateOf(ACTIVE), 'running', 'record failure did not trigger live workflow cleanup');
  assert.equal(stateOf(HEALTHY), 'running', 'stale previous receipt was never consulted');
  assert.equal(readFileSync(file(), 'utf8'), BAD, 'Keep, Receipts and Done preserved the corrupt primary');
  assert.equal(readFileSync(`${file()}.prev`, 'utf8'), previous);
  assert.ok(result.log.some(l => /Couldn’t keep a note of what this run starts/.test(l)), result.log.join('\n'));
  assert.ok(result.log.some(l => /Couldn’t clear the note of this saved workflow/.test(l)), result.log.join('\n'));
  const child = (await api('/jobs')).json.jobs.find(j => j.app && j.container === ACTIVE);
  assert.ok(child?.startedReceipts?.[`spark4/${ACTIVE}`]?.id, JSON.stringify(child));
  assert.ok(child.log.some(l => /Couldn’t keep this start’s receipt/.test(l)), child.log.join('\n'));
  assert.equal(readProblem(await problems()).length, 1);
  writeFileSync(file(), '{"runs":{}}');
  assert.equal(readProblem(await problems()).length, 0);
});

test('a valid interrupted primary still cleans its matching receipt while leaving other running work alone', { timeout: 180000 * SLOW }, async () => {
  writeFileSync(file(), previous);
  writeFileSync(`${file()}.prev`, BAD);
  await restart();
  await waitFor(() => stateOf(HEALTHY) === 'exited', { timeout: 120000, what: 'the app named by the valid primary to stop' });
  await waitFor(() => !existsSync(file()), { timeout: 30000, what: 'the recovered primary to clear' });
  assert.equal(stateOf(ACTIVE), 'running', 'only the recorded receipt was stopped');
  assert.equal(readFileSync(`${file()}.prev`, 'utf8'), BAD, 'recovery did not read or rewrite the previous file');
  assert.equal(readProblem(await problems()).length, 0);
});
