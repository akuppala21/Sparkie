// Covers: Real self-test loading, owner adoption and a later same-id owner restart remain running across a service
// crash and delayed cleanup. The primary ownership note and conditional stop dispatch preserve owner work.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { T, useFleet, resetFleet, api, waitFor, sleep, SERVICE_FILE, REPO, SLOW } from './lib.mjs';
let second = null;
after(() => { try { second?.kill('SIGKILL'); } catch {} });
const options = { watchMs: 2000, statusMs: 3000, prepare: ({ root, stateDir }) => {
  writeFileSync(join(stateDir, 'desired.json'), JSON.stringify({ revision: 7, revisions: [], running: [] }));
  const mock = join(root, 'spark3', '.mock'), list = join(mock, 'containers');
  writeFileSync(list, readFileSync(list, 'utf8').replace(/^(sc-testorg--Qwen3\.8-27B-abliterated-GGUF)\|running\|[^|]*\|/m, '$1|exited|Exited (0) 2 hours ago|').split('\n').filter(l => !l.startsWith('sc-gpt-oss-20b|')).join('\n'));
  for (const f of ['stamp-starts', 'ids-per-run', 'serve-down']) writeFileSync(join(mock, f), '');
} };
useFleet(options);
const running = model => readFileSync(join(T.fleet.root, 'spark3', '.mock', 'containers'), 'utf8').split('\n').some(l => l.split('|')[0] === model && l.split('|')[1] === 'running');
test('delayed self-test cleanup preserves genuine owner adoption of its running model', { timeout: 420000 * SLOW }, async () => {
  const mock = f => join(T.fleet.root, 'spark3', '.mock', f), noteFile = join(T.fleet.stateDir, 'self-test.json');
  const r = await api('/actions/self_test', { method: 'POST', body: { spark: 'spark3' } });
  assert.equal(r.status, 200, r.text); assert.equal(r.json.outcome, 'started', r.text);
  const old = await waitFor(() => { try { const x = JSON.parse(readFileSync(noteFile, 'utf8')); return x.model?.id ? x : null; } catch { return null; } }, { timeout: 120000, what: 'self-test model recorded while loading' });
  const model = old.model.container, oldStarted = readFileSync(mock('started-' + model), 'utf8').trim();
  assert.ok(running(model));
  const adopt = await api('/actions/restart_model', { method: 'POST', body: { spark: 'spark3', container: model } });
  assert.equal(adopt.status, 200, adopt.text); assert.equal(adopt.json.outcome, 'already', adopt.text);
  const adoptedDesired = JSON.parse(readFileSync(join(T.fleet.stateDir, 'desired.json'), 'utf8'));
  assert.ok(adoptedDesired.running.some(x => x.spark === 'spark3' && x.container === model && x.model), 'explicit adoption adds its absent model row to the existing list');
  assert.equal(adoptedDesired.revision, 8, 'adoption adds one ordinary desired revision');
  console.log(JSON.stringify({evidence: 'genuine owner adoption accepted', outcome: adopt.json.outcome, sameId: readFileSync(mock('id-' + model),'utf8').trim() === old.model.id}));
  process.kill(T.fleet.servicePid(), 'SIGKILL');
  await waitFor(() => T.fleet.serviceExit(), { timeout: 10000, what: 'crashed service ended' });
  rmSync(mock('serve-down'), { force: true });
  second = spawn(process.execPath, [SERVICE_FILE], { cwd: REPO, env: { ...T.fleet.env, SPARK_CONSOLE_SELFTEST_RECOVER_MS: '30000' }, stdio: 'ignore' });
  await waitFor(async () => (await api('/health').catch(() => null))?.status === 200, { timeout: 30000, what: 'service returned' });
  await waitFor(() => { try { return !Object.values(JSON.parse(readFileSync(join(T.fleet.stateDir,'saved-runs.json'),'utf8')).runs).some(x=>x.kind==='start-rollback'); } catch { return false; } }, {timeout: 20000, what:'fenced rollback retired after preserving owner adoption'});
  assert.ok(running(model), 'fenced rollback leaves adopted model running');
  assert.equal(readFileSync(mock('id-' + model),'utf8').trim(),old.model.id);
  console.log(JSON.stringify({evidence:'startup rollback honored adoption before delayed cleanup',running:running(model)}));
  await waitFor(() => !existsSync(noteFile), { timeout: 180000, what: 'delayed self-test recovery finished' });
  console.log(JSON.stringify({ evidence: 'after delayed recovery', running: running(model) }));
  assert.ok(running(model), 'delayed self-test cleanup stopped the owner’s adopted running model');
  assert.ok(JSON.parse(readFileSync(join(T.fleet.stateDir, 'desired.json'), 'utf8')).running.some(x => x.spark === 'spark3' && x.container === model), 'the owner desired row survives note retirement');
});

test('delayed self-test cleanup preserves a genuine newer owner restart after fenced rollback', { timeout: 420000 * SLOW }, async () => {
  if (second) { const gone = new Promise(resolve => second.once('exit', resolve)); second.kill('SIGKILL'); await gone; second = null; }
  await resetFleet(options);
  const mock = f => join(T.fleet.root, 'spark3', '.mock', f), noteFile = join(T.fleet.stateDir, 'self-test.json');
  const r = await api('/actions/self_test', { method: 'POST', body: { spark: 'spark3' } });
  assert.equal(r.status, 200, r.text); assert.equal(r.json.outcome, 'started', r.text);
  const old = await waitFor(() => { try { const x = JSON.parse(readFileSync(noteFile, 'utf8')); return x.model?.id ? x : null; } catch { return null; } }, { timeout: 120000, what: 'self-test model recorded while loading' });
  const model = old.model.container, oldStarted = readFileSync(mock('started-' + model), 'utf8').trim();
  assert.ok(running(model));
  process.kill(T.fleet.servicePid(), 'SIGKILL');
  await waitFor(() => T.fleet.serviceExit(), { timeout: 10000, what: 'crashed service ended' });
  rmSync(mock('serve-down'), { force: true });
  second = spawn(process.execPath, [SERVICE_FILE], { cwd: REPO, env: { ...T.fleet.env, SPARK_CONSOLE_SELFTEST_RECOVER_MS: '120000' }, stdio: 'ignore' });
  await waitFor(async () => (await api('/health').catch(() => null))?.status === 200, { timeout: 30000, what: 'service returned' });
  await waitFor(() => { try { return !running(model) && JSON.parse(readFileSync(noteFile, 'utf8')).rollbackStoppedModel?.id === old.model.id; } catch { return false; } }, { timeout: 90000, what: 'fenced rollback stopped exact self-test model and saved evidence' });
  await waitFor(async () => !(await api('/jobs')).json.jobs.some(j => j.status === 'running' && j.type === 'start-rollback'), { timeout: 30000, what: 'rollback claim released' });
  await sleep(1100);
  const restart = await api('/actions/restart_model', { method: 'POST', body: { spark: 'spark3', container: model } });
  assert.equal(restart.status, 200, restart.text); assert.equal(restart.json.outcome, 'started', restart.text);
  const done = await waitFor(async () => { const j = (await api('/jobs/' + restart.json.operation)).json; return j.status !== 'running' ? j : null; }, { timeout: 60000, what: 'genuine owner restart completed' });
  assert.equal(done.status, 'completed', JSON.stringify(done));
  assert.equal(readFileSync(mock('id-' + model), 'utf8').trim(), old.model.id);
  const newStarted = readFileSync(mock('started-' + model), 'utf8').trim(); assert.notEqual(newStarted, oldStarted);
  const desired = JSON.parse(readFileSync(join(T.fleet.stateDir, 'desired.json'), 'utf8'));
  assert.ok(desired.running.some(x => x.spark === 'spark3' && x.container === model));
  console.log(JSON.stringify({ evidence: 'owner restart completed before delayed recovery', operation: restart.json.operation, sameId: true, oldStarted, newStarted, desired: true, running: running(model) }));
  await waitFor(() => !existsSync(noteFile), { timeout: 180000, what: 'delayed self-test recovery finished' });
  console.log(JSON.stringify({ evidence: 'after delayed recovery', running: running(model) }));
  assert.ok(running(model), 'delayed self-test cleanup stopped the owner’s newer same-ID restart');
});


const part = name => readFileSync(join(REPO, 'service/src', name), 'utf8');
const take = (source, name) => {
  const found = new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, 'm').exec(source);
  assert.ok(found, name); return found[0];
};
const SELF = part('21-selftest.mjs'), STEPS = part('18-step-jobs.mjs'), CHANGES = part('17-changes.mjs');
const ID = 'a'.repeat(64), START = '2026-11-17T00:00:00.000Z', OP = '123456789abc';
function authorityFixture() {
  const h = { rec: { operation: OP, spark: 'spark3', model: { container: 'sc-test', name: 'exact-test-model', id: ID, startedAt: START } }, jobs: new Map(), desired: [], writes: 0,
    seen: { id: ID, startedAt: START, since: null, selfTest: OP }, now: { id: ID, startedAt: START } };
  const deps = {
    STATE_DIR: '/fake/state', openSync: () => 1, fsyncSync: () => {}, closeSync: () => {},
    SELF_TEST_FILE: 'self-test.json', selfTestRecord: () => { if (h.readError) throw new Error('note unavailable'); return structuredClone(h.rec); },
    writePrivate: (file, rec) => { assert.equal(file, 'self-test.json'); if (h.writeError) throw new Error('note write failed'); h.rec = structuredClone(rec); h.writes++; },
    desiredSelfTestWish: () => {}, keyOf: x => `${x.spark}/${x.container}`, selfTestSettleWishes: () => {},
    jobs: h.jobs, HttpError: class extends Error { constructor(status, text) { super(text); this.status = status; } },
    sparkName: n => n.id, nodeById: id => ({ id }),
    receiptOf: async () => { await h.afterReceipt?.(); return structuredClone(h.now); },
    desired: strict => { assert.equal(strict, true); if (h.desiredError) throw new Error('desired unavailable'); return { running: h.desired }; },
  };
  h.api = new Function(...Object.keys(deps), `${take(SELF, 'selfTestAuthority')}\n${take(SELF, 'selfTestWish')}\n${take(SELF, 'selfTestRevoke')}\n${take(SELF, 'selfTestSettleWishes')}\n${take(SELF, 'selfTestWishSaved')}\n${take(STEPS, 'startedStill')}\nreturn { selfTestAuthority, selfTestWish, selfTestRevoke, selfTestSettleWishes, startedStill };`)(...Object.values(deps));
  h.deps = deps; return h;
}
test('the stop reads owner adoption after its awaited Docker receipt, even without a desired row', async () => {
  const h = authorityFixture(); h.afterReceipt = () => h.api.selfTestWish(['spark3/sc-test']);
  assert.match(await h.api.startedStill('spark3', 'sc-test', h.seen), /kept by the owner/);
  assert.equal(h.rec.model.wish, true); assert.equal(h.writes, 1);
});
test('a new start time, a proved rollback stop, and unreadable authority never grant another stop', async () => {
  const h = authorityFixture(); h.now.startedAt = 'later';
  assert.match(await h.api.startedStill('spark3', 'sc-test', h.seen), /started again/);
  h.now.startedAt = START; h.rec.rollbackStoppedModel = { id: ID, container: 'sc-test' };
  assert.match(await h.api.startedStill('spark3', 'sc-test', h.seen), /already stopped/);
  delete h.rec.rollbackStoppedModel; h.readError = true;
  await assert.rejects(h.api.startedStill('spark3', 'sc-test', h.seen), /note unavailable/);
  h.readError = false; h.desiredError = true;
  await assert.rejects(h.api.startedStill('spark3', 'sc-test', h.seen), /desired unavailable/);
});
test('adoption is refused while the exact cleanup or drill is issuing its stop, and failed saves refuse success', () => {
  const h = authorityFixture();
  for (const job of [{ type: 'stop', selfTest: true, selfTestOperation: OP, container: 'sc-test' }, { type: 'self-test', selfTestStopping: 'sc-test' }]) {
    h.jobs.set('stop', { status: 'running', node: 'spark3', ...job });
    assert.throws(() => h.api.selfTestWish(['spark3/sc-test']), /stopping that workload/);
    assert.equal(h.rec.model.wish, undefined);
  }
  h.jobs.clear(); h.writeError = true;
  assert.throws(() => h.api.selfTestWish(['spark3/sc-test']), /note write failed/);
  assert.equal(h.rec.model.wish, undefined);
});
function stopFixture(when) {
  const h = authorityFixture(); h.events = []; h.pending = [];
  const dep = { container: 'sc-test', state: 'running', model: 'test' };
  let checks = 0;
  const deps = { ...h.deps, sparkArg: {}, choiceArg: {}, q: x => x,
    action: entry => { h.stop = entry.run; }, sparkOf: () => {},
    inventory: async () => { if (when === 'inventory') h.api.selfTestWish(['spark3/sc-test']); return { sparks: [{ id: 'spark3', deployments: [dep] }] }; },
    rollbackKnown: () => null, run: async () => { if (when === 'label') h.api.selfTestWish(['spark3/sc-test']); return { code: 0, out: '' }; },
    isProtected: () => false, mustUse: () => {}, routedSparks: () => new Set(),
    rollbackSupersede: () => h.events.push('superseded'), holdsModelsOn: () => true,
    cancelJobsAndWait: async () => { h.events.push('cancelled'); },
    claimed: (ids, words, create) => create(), newJob: (type, meta) => { const j = { id: 'stop', type, status: 'running', ...meta }; h.jobs.set(j.id, j); return j; },
    runJob: (j, fn) => { h.pending.push(fn(j)); }, pausedCheck: () => {}, note: () => {},
    startedStill: async (...args) => { checks++; if (when === 'claim' && checks === 3) h.rec.model.wish = true; return h.api.startedStill(...args); },
    stopContainer: async () => { h.events.push('stopped'); if (when === 'issuing') assert.throws(() => h.api.selfTestWish(['spark3/sc-test']), /stopping that workload/); },
    stoppedForSure: async () => {},
  };
  const source = CHANGES.slice(CHANGES.indexOf("action({\n  name: 'stop_model'"), CHANGES.indexOf('// A stop is done'));
  new Function(...Object.keys(deps), source)(...Object.values(deps));
  h.invoke = () => h.stop({ spark: 'spark3', container: 'sc-test' }, { login: 'owner' }, { via: 'workflow', actor: 'Self-test', selfTest: true, onlyIf: h.seen });
  return h;
}
for (const when of ['inventory', 'label']) test(`adoption during ${when} leaves work before rollback or cancellation is changed`, async () => {
  const h = stopFixture(when), out = await h.invoke();
  assert.equal(out.outcome, 'left'); assert.deepEqual(h.events, []); assert.equal(h.jobs.size, 0);
});
test('the claim-time guard leaves the model and records left, rather than reporting a stop', async () => {
  const h = stopFixture('claim'), out = await h.invoke(); await Promise.all(h.pending);
  assert.equal(out.outcome, 'started'); assert.match(h.jobs.get(out.operation).left, /kept by the owner/);
  assert.ok(!h.events.includes('stopped'));
});
test('the exact conditional stop refuses owner adoption through its dispatch await', async () => {
  const h = stopFixture('issuing'), out = await h.invoke(); await Promise.all(h.pending);
  assert.equal(out.outcome, 'started'); assert.ok(h.events.includes('stopped'));
});
test('a corrupt primary never promotes the earlier note that lacks the owner wish', () => {
  const file = join(T.fleet.stateDir, 'ownership-primary-test.json'), bad = '{unreadable';
  writeFileSync(file, bad); writeFileSync(`${file}.prev`, JSON.stringify(authorityFixture().rec));
  const read = new Function('readFileSync', 'SELF_TEST_FILE', `${take(SELF, 'selfTestRecord')}\nreturn selfTestRecord;`)(readFileSync, file);
  assert.throws(read, /note can’t be read/);
  assert.equal(readFileSync(file, 'utf8'), bad); assert.ok(existsSync(`${file}.prev`));
  rmSync(file); assert.equal(read(), null); assert.ok(existsSync(`${file}.prev`));
});

test('an owner wish made before the first container exists follows the source operation into the self-test note', async () => {
  const h = authorityFixture(), writes = [], source = { id: 'source', type: 'deploy', status: 'completed', ownersWish: true,
    startedReceipts: { 'spark3/sc-test': { id: ID, startedAt: START } } };
  let checks = 0, stopped = 0;
  h.rec = null; h.jobs.set(source.id, source);
  const deps = { ...h.deps,
    selfTestCtx: () => ({}), selfTestMine: () => {}, selfTestNeed: () => null, selfTestAddress: () => null,
    selfTestName: kind => `selftest-${kind}`, selfTestJobCommand: () => [], containerName: () => 'sc-test', healOwner: () => ({}),
    SELF_TEST_WEB_PORT: 18990, SELF_TEST_WEB: [], SELF_TEST_SH: '', SELF_TEST_PY: '',
    sleep: async () => {}, firstLine: e => e.message, step: () => {}, note: () => {}, pausedCheck: () => {},
    writePrivate: (file, rec) => { h.rec = structuredClone(rec); writes.push(structuredClone(rec)); },
    cancelCheck: () => { if (++checks > 1) throw Object.assign(new Error('cancel after the model step'), { cancelled: true }); },
    stepRun: async (parent, viewer, ctx, name) => { assert.equal(name, 'start_model'); return { outcome: 'started', operation: source.id }; },
    cancelJobsAndWait: async () => {},
    containerStates: async () => ({ 'sc-test': { id: ID, state: 'running' }, 'selftest-web': { state: 'gone' }, 'selftest-job': { state: 'gone' } }),
    selfTestStopModel: async (j, spark, container, seen) => { const left = await h.api.startedStill(spark, container, seen); if (!left) stopped++; return { left }; },
    selfTestStopApp: async () => { throw new Error('no app was started'); },
    startedStill: h.api.startedStill, wordList: xs => xs.join(', '), unlinkSync: () => { h.rec = null; },
  };
  const run = new Function(...Object.keys(deps), `${take(SELF, 'selfTest')}\nreturn selfTest;`)(...Object.values(deps));
  await assert.rejects(run({ id: OP, createdAt: START, log: [] }, {}, { spark: 'spark3', model: { name: 'test-model' } }, 'test-image'), /cancel after the model step/);
  const receipt = writes.find(x => x.model.id === ID);
  assert.ok(receipt, 'the actual source receipt was kept');
  assert.equal(receipt.model.wish, true, 'the source owner wish was kept atomically with that first id');
  assert.equal(stopped, 0, 'neither normal cleanup nor recovery can stop the adopted model');
});

test('the captured healing receipt updates only its matching self-test operation before the claim can end', async () => {
  const h = authorityFixture(), receipts = { 'spark3/sc-test': { id: ID, startedAt: 'healed-start' } };
  const deps = { ...h.deps,
    run: async () => ({ code: 0, out: `id\t${ID}\nat\trunning|healed-start|0|0\n` }),
    RECEIPT_LOOK: x => x, fields: (out, kind) => out.split('\n').filter(l => l.startsWith(`${kind}\t`)).map(l => l.split('\t').slice(1)),
    savedRunReceipts: () => {}, desired: () => ({ running: [] }),
  };
  const capture = new Function(...Object.keys(deps), `${take(SELF, 'selfTestStarted')}\n${take(STEPS, 'receiptOf')}\n${take(STEPS, 'captureStartedReceipts')}\nreturn captureStartedReceipts;`)(...Object.values(deps));
  const job = { type: 'restart', node: 'spark3', container: 'sc-test', selfTest: true, selfTestOperation: 'another-operation' };
  await capture(job); assert.equal(h.rec.model.startedAt, START, 'a different operation cannot regrant stop authority');
  job.selfTestOperation = OP; await capture(job);
  assert.equal(h.rec.model.startedAt, receipts['spark3/sc-test'].startedAt, 'own restart receipt is kept while still loading');
  assert.equal(job.startedReceipts['spark3/sc-test'].startedAt, 'healed-start');
  h.rec.model.wish = true; await capture(job); assert.equal(h.rec.model.wish, true, 'capture preserves owner adoption');
  h.rec.rollbackStoppedModel = { id: ID, container: 'sc-test' }; const writes = h.writes;
  await capture(job); assert.equal(h.writes, writes, 'a retired note never gains new stop authority');
});
function recoveryFixture(mode) {
  const h = authorityFixture(); let state = 'running', looks = 0;
  h.rec.model.wish = ['replaced', 'adoption', 'late-pending'].includes(mode); h.events = []; h.removed = 0; h.retries = 0;
  const deps = { ...h.deps, selfTestSettleWishes: () => { if (h.failSettle) throw new Error('pending desired save failed'); }, setTimeout: () => { h.retries++; return { unref() {} }; }, NAME_RE: /^[\w-]+$/, firstLine: e => e.message, wordList: xs => xs.join(', '),
    containerStates: async () => {
      if (++looks === 2 && mode === 'replaced') h.rec.operation = 'new-operation';
      if (looks === 2 && mode === 'late-pending') { h.failSettle = true; h.rec.model.wishSaved = false; }
      return { 'sc-test': { state, id: ID } };
    },
    selfTestStopModel: async () => { h.rec.rollbackStoppedModel = { id: ID, container: 'sc-test' }; state = 'exited'; return { left: 'already stopped' }; },
    unlinkSync: () => { h.removed++; }, fleetEvent: event => h.events.push(event),
  };
  h.run = new Function(...Object.keys(deps), `${take(SELF, 'selfTestRecover')}\nreturn selfTestRecover;`)(...Object.values(deps));
  return h;
}
test('a newer self-test note that appears during an awaited recovery look is neither removed nor reported as the old run', async () => {
  const h = recoveryFixture('replaced'); await h.run();
  assert.equal(h.rec.operation, 'new-operation'); assert.equal(h.removed, 0); assert.deepEqual(h.events, []);
});
test('rollback stop proof arriving during recovery is reported as stopped, never as left running', async () => {
  const h = recoveryFixture('rollback'); await h.run();
  assert.equal(h.removed, 1); assert.equal(h.events.length, 1);
  assert.match(h.events[0].text, /It stopped what the test had started there: sc-test/);
  assert.doesNotMatch(h.events[0].text, /Left running/);
});
test('malformed or mismatching rollback evidence stays unreadable and cannot retire an unrelated incarnation', () => {
  for (const proof of [{}, { id: 'b'.repeat(64), container: 'sc-test' }, { id: ID, container: 'another-container' }]) {
    const rec = authorityFixture().rec; rec.rollbackStoppedModel = proof;
    const read = new Function('readFileSync', 'SELF_TEST_FILE', `${take(SELF, 'selfTestRecord')}\nreturn selfTestRecord;`)(() => JSON.stringify(rec), 'self-test.json');
    assert.throws(read, /stop note is incomplete or changed/);
  }
});
test('owner adoption is not acknowledged when syncing its renamed note fails', () => {
  const h = authorityFixture(), fn = new Function(...Object.keys(h.deps), `${take(SELF, 'selfTestWish')}\nreturn selfTestWish;`)(...Object.entries(h.deps).map(([name, value]) => name === 'fsyncSync' ? () => { throw new Error('folder sync failed'); } : value));
  assert.throws(() => fn(['spark3/sc-test']), /folder sync failed/);
});

for (const part of ['web', 'job']) test(`${part}: missing identity never grants a stop, but a saved owner wish settles it as left`, async () => {
  const h = authorityFixture(), name = `selftest-${part}`;
  h.rec[part] = { container: name };
  const seen = { selfTest: OP, id: null, startedAt: null, since: null };
  await assert.rejects(h.api.startedStill('spark3', name, seen), /incomplete or changed/);
  h.api.selfTestWish([`spark3/${name}`]);
  assert.match(await h.api.startedStill('spark3', name, seen), /kept by the owner/);
  assert.equal(h.rec[part].wish, true);
});
test('an app’s early and completed own receipts follow its desired entry and preserve adoption', () => {
  const h = authorityFixture(); h.rec.web = { container: 'selftest-web' };
  const save = new Function(...Object.keys(h.deps), `${take(SELF, 'selfTestStarted')}\nreturn selfTestStarted;`)(...Object.values(h.deps));
  const job = { type: 'deploy', app: true, node: 'spark3', container: 'selftest-web', selfTestOperation: OP };
  save(job, { 'spark3/selftest-web': { id: ID, startedAt: START, since: null } });
  assert.equal(h.rec.web.since, null, 'receipt is kept before readiness and desiredAfter');
  h.rec.web.wish = true;
  save(job, { 'spark3/selftest-web': { id: ID, startedAt: START, since: 'own-completion' } });
  assert.equal(h.rec.web.since, 'own-completion'); assert.equal(h.rec.web.wish, true);
});
function appFixture(when) {
  const h = authorityFixture(), name = 'selftest-web', key = `spark3/${name}`;
  h.rec.web = { container: name, id: ID, startedAt: START, since: START };
  h.desired = [{ spark: 'spark3', container: name, app: true, since: START }];
  h.seen = { id: ID, startedAt: START, since: START, selfTest: OP }; h.events = []; h.pending = [];
  let checks = 0;
  const deps = { ...h.deps, sparkArg: {}, action: entry => { h.action = entry.run; },
    notBrainsSpark: () => {}, notBoxName: () => {}, sparkOf: () => ({ id: 'spark3' }), mustUse: () => {},
    inventory: async () => { if (when === 'inventory') h.api.selfTestWish([key]); return { sparks: [{ id: 'spark3', online: !h.offline, deployments: [], external: [], tsip: '127.0.0.1' }], library: [] }; },
    desired: () => ({ running: h.desired }), keyOf: x => `${x.spark}/${x.container}`, knowledge: { workloads: {}, sparks: { spark3: { online: false, lastSeenAt: '2020-01-01T00:00:00Z' } } }, HEAL_OFFLINE_MS: 1000,
    appLook: async () => { if (when === 'look') h.api.selfTestWish([key]); return { state: 'running', app: true, job: false, protect: '', capGB: 1, ports: [], opens: [] }; },
    startedStill: async (...args) => { checks++; if (when === 'claim' && checks === 3) h.rec.web.wish = true; return h.api.startedStill(...args); },
    isProtected: () => false, appDiffers: () => [], savedOwnCall: () => true, isOwnerCall: () => false,
    claimed: (ids, words, create) => create(), newJob: (type, meta) => { const j = { id: 'app-stop', type, status: 'running', ...meta }; h.jobs.set(j.id, j); return j; },
    runJob: (j, fn) => { h.pending.push(fn(j)); }, pausedCheck: () => {}, note: () => {},
    stopContainer: async () => { h.events.push('stopped'); if (when === 'issuing') assert.throws(() => h.api.selfTestWish([key]), /stopping that workload/); },
    stoppedForSure: async () => {}, ownersAsk: (viewer, ctx) => !ctx.selfTest, selfTestWish: h.api.selfTestWish,
    powerThenKeep: () => null, keepApp: () => { h.events.push('kept'); },
    desiredWish: keys => h.api.selfTestWish(keys), selfTestWishSaved: () => {}, selfTestRevoke: h.api.selfTestRevoke,
    forgetApp: () => { h.desired = []; h.events.push('forgotten'); return true; },
  };
  const source = part('21-apps.mjs'), action = source.slice(source.indexOf("action({\n  name: 'keep_running'"));
  new Function(...Object.keys(deps), action)(...Object.values(deps));
  h.invoke = (verb = 'stop') => h.action({ spark: 'spark3', container: name, ...(verb === 'stop' ? { do: 'stop' } : {}) }, { login: 'owner' },
    verb === 'stop' ? { via: 'workflow', actor: 'Self-test', selfTest: true, selfTestOperation: OP, onlyIf: h.seen } : { via: 'page' });
  return h;
}
for (const when of ['inventory', 'look']) test(`app adoption during ${when} is checked before cleanup changes anything`, async () => {
  const h = appFixture(when), out = await h.invoke(); assert.equal(out.outcome, 'left'); assert.deepEqual(h.events, []); assert.equal(h.jobs.size, 0);
});
test('app cleanup checks ownership under its claim and refuses owner adoption through stop dispatch', async () => {
  const h = appFixture('claim'), out = await h.invoke(); await Promise.all(h.pending);
  assert.match(h.jobs.get(out.operation).left, /kept by the owner/); assert.deepEqual(h.events, []);
  const actual = appFixture('issuing'); await actual.invoke(); await Promise.all(actual.pending);
  assert.deepEqual(actual.events, ['stopped']);
});
test('an app adoption refused during exact cleanup does not rewrite its desired entry first', async () => {
  const h = appFixture('keep'); h.desired = [];
  h.jobs.set('stopping', { type: 'stop', status: 'running', node: 'spark3', container: 'selftest-web', selfTestOperation: OP });
  await assert.rejects(h.invoke('keep'), /stopping that workload/); assert.deepEqual(h.events, []);
});

test('recovery reports verified adopted work as left running without claiming that nothing still runs', async () => {
  const h = recoveryFixture('adoption'); await h.run();
  assert.equal(h.events.length, 1); assert.match(h.events[0].text, /Nothing was stopped\. Left running: sc-test/);
  assert.doesNotMatch(h.events[0].text, /Nothing the test had started was still running/);
});
test('unreadable authority retains the normal cleanup note and reports unknown instead of nothing running', async () => {
  const h = authorityFixture(), source = { id: 'source', type: 'deploy', status: 'completed',
    startedReceipts: { 'spark3/sc-test': { id: ID, startedAt: START } } };
  let checks = 0, removed = 0, retries = 0;
  h.rec = null; h.jobs.set(source.id, source);
  const deps = { ...h.deps,
    selfTestCtx: () => ({}), selfTestMine: () => {}, selfTestNeed: () => null, selfTestAddress: () => null,
    selfTestName: kind => `selftest-${kind}`, selfTestJobCommand: () => [], containerName: () => 'sc-test', healOwner: () => ({}),
    SELF_TEST_WEB_PORT: 18990, SELF_TEST_WEB: [], SELF_TEST_SH: '', SELF_TEST_PY: '',
    sleep: async () => {}, firstLine: e => e.message, step: () => {}, note: () => {}, pausedCheck: () => {},
    writePrivate: (file, rec) => { h.rec = structuredClone(rec); },
    cancelCheck: () => { if (++checks > 1) { h.readError = true; throw Object.assign(new Error('cancel after the model step'), { cancelled: true }); } },
    stepRun: async () => ({ outcome: 'started', operation: source.id }), cancelJobsAndWait: async () => {},
    containerStates: async () => ({ 'sc-test': { id: ID, state: 'running' }, 'selftest-web': { state: 'gone' }, 'selftest-job': { state: 'gone' } }),
    selfTestStopModel: async (j, spark, container, seen) => h.api.startedStill(spark, container, seen),
    startedStill: h.api.startedStill, wordList: xs => xs.join(', '), unlinkSync: () => { removed++; },
    setTimeout: () => { retries++; return { unref() {} }; },
  };
  const run = new Function(...Object.keys(deps), `${take(SELF, 'selfTest')}\nreturn selfTest;`)(...Object.values(deps));
  const job = { id: OP, createdAt: START, log: [] };
  await assert.rejects(run(job, {}, { spark: 'spark3', model: { name: 'test-model' } }, 'test-image'), /cancel after the model step/);
  assert.match(job.report.at(-1), /^Left behind: unknown/); assert.doesNotMatch(job.report.at(-1), /nothing running/);
  assert.equal(removed, 0); assert.equal(retries, 1); assert.equal(h.rec.model.id, ID);
});

function handoffFixture() {
  const h = authorityFixture(), unrelated = { spark: 'spark4', container: 'sc-other', model: 'other-exact-model', since: 'older' };
  h.list = { revision: 7, running: [unrelated], revisions: [] }; h.rollback = { runs: {} }; h.writes = [];
  const KEY = 'spark3/sc-test', deps = { ...h.deps, DESIRED_FILE: 'desired.json', ENGINE_CHECK_NAME: 'engine-check',
    accessList: () => ({ owner: 'owner' }), keyOf: x => `${x.spark}/${x.container}`,
    desired: strict => { assert.equal(strict, true); if (h.readDesiredError) throw new Error('desired unreadable'); return structuredClone(h.list); },
    readKept: () => structuredClone(h.list),
    writePrivate: (file, value) => {
      if (file === 'desired.json') { if (h.failDesired) throw new Error('desired disk full'); h.list = structuredClone(value); }
      else h.rec = structuredClone(value);
      h.writes.push(file);
    },
    savedRunsNow: () => structuredClone(h.rollback), rollbackSave: state => { if (h.failRollback) throw new Error('rollback disk full'); h.rollback = structuredClone(state); },
    backUnits: () => [], rollbackKey: x => `${x.spark}/${x.container}`, rollbackRead: () => null,
    savedRunReceipts: () => {},
  };
  const functions = [take(SELF, 'selfTestWish'), take(SELF, 'selfTestWishSaved'), take(SELF, 'selfTestRevoke'), take(SELF, 'selfTestSettleWishes'),
    take(part('20-desired.mjs'), 'desiredSelfTestWish'), take(part('20-desired.mjs'), 'desiredWish'),
    take(part('17-rollback.mjs'), 'rollbackSupersede'), take(part('17-rollback.mjs'), 'rollbackAdoptStart')].join('\n');
  h.api = new Function(...Object.keys(deps), `${functions}\nreturn { desiredWish, selfTestSettleWishes, rollbackSupersede, rollbackAdoptStart };`)(...Object.values(deps));
  h.KEY = KEY; h.unrelated = unrelated; return h;
}
test('explicit model adoption adds one desired revision and preserves every unrelated desired entry', () => {
  const h = handoffFixture(); h.api.desiredWish([h.KEY]);
  assert.equal(h.list.revision, 8); assert.deepEqual(h.list.running[0], h.unrelated);
  assert.equal(h.list.running.find(x => `${x.spark}/${x.container}` === h.KEY).model, 'exact-test-model');
  assert.deepEqual(h.list.revisions[0].before, [h.unrelated]); assert.equal(h.list.revisions[0].operation, null, 'an adoption is intent, not a fabricated completed job');
  assert.equal(h.rec.model.wish, true); assert.equal(h.rec.model.wishSaved, true);
  h.api.desiredWish([h.KEY]); assert.equal(h.list.revision, 8, 'an existing desired entry keeps its revision');
});
test('a failed desired save refuses adoption and retains pending intent until retry saves the row', () => {
  const h = handoffFixture(); h.failDesired = true;
  assert.throws(() => h.api.desiredWish([h.KEY]), /could not be fully saved/);
  assert.equal(h.rec.model.wish, true); assert.equal(h.rec.model.wishSaved, false);
  assert.equal(h.list.revision, 7); assert.deepEqual(h.list.running, [h.unrelated]);
  h.failDesired = false; h.api.selfTestSettleWishes(OP);
  assert.equal(h.rec.model.wishSaved, true); assert.ok(h.list.running.some(x => `${x.spark}/${x.container}` === h.KEY));
});
test('a newer owner stop cancels pending handoff permanently, while a later explicit adoption follows the newest wish', () => {
  const h = handoffFixture(); h.failDesired = true;
  assert.throws(() => h.api.desiredWish([h.KEY]), /could not be fully saved/);
  h.api.rollbackSupersede([h.KEY], 'the owner stopped it');
  assert.equal(h.rec.model.wishStopped, true); assert.equal(h.rec.model.wishSaved, true);
  h.failDesired = false; h.api.selfTestSettleWishes(OP);
  assert.deepEqual(h.list.running, [h.unrelated], 'recovery cannot resurrect the revoked model wish');
  h.api.desiredWish([h.KEY]); assert.equal(h.rec.model.wishStopped, undefined);
  assert.ok(h.list.running.some(x => `${x.spark}/${x.container}` === h.KEY), 'a newer positive ask supersedes the old stop');
});
test('known rollback refusal and failed rollback save grant no self-test or desired adoption', () => {
  const h = handoffFixture();
  h.rollback.runs.source = { kind: 'start-rollback', phase: 'returning', targets: ['spark3'], units: [], attempts: [{ commands: [{ spark: 'spark3', name: 'sc-test', action: 'stop', result: null }] }] };
  assert.throws(() => h.api.desiredWish([h.KEY]), /still finishing/);
  assert.equal(h.rec.model.wish, undefined); assert.deepEqual(h.writes, []);
  h.rollback.runs.source.phase = 'active'; h.failRollback = true;
  assert.throws(() => h.api.desiredWish([h.KEY]), /rollback disk full/);
  assert.equal(h.rec.model.wish, undefined); assert.deepEqual(h.writes, []);
});
test('a genuine early source target carries the owner ask before the first Docker key, and marks its parent too', () => {
  const h = handoffFixture(), source = { id: 'source', type: 'deploy', node: 'spark3', selfTestOperation: OP, selfTestContainer: 'sc-test', ranHere: [] },
    parent = { id: OP, type: 'self-test', node: 'spark3', container: 'sc-test' };
  h.jobs.set(source.id, source); h.jobs.set(parent.id, parent);
  h.api.rollbackAdoptStart(source);
  assert.equal(source.ownersWish, true); assert.equal(parent.ownersWish, true);
  assert.equal(h.rec.model.wishSaved, true); assert.ok(h.list.running.some(x => `${x.spark}/${x.container}` === h.KEY));
});
test('legacy unknown model names are held before any adoption state is written', () => {
  const h = handoffFixture(); delete h.rec.model.name;
  assert.throws(() => h.api.desiredWish([h.KEY]), /exact model name is missing/);
  assert.equal(h.rec.model.wish, undefined); assert.deepEqual(h.writes, []); assert.equal(h.list.revision, 7);
});

test('actual early start adoption has the child target before first Docker identity and survives the later crash', { timeout: 420000 * SLOW }, async () => {
  if (second) { const gone = new Promise(resolve => second.once('exit', resolve)); second.kill('SIGKILL'); await gone; second = null; }
  await resetFleet({ ...options, prepare: ctx => { options.prepare(ctx); writeFileSync(join(ctx.root, 'spark3', '.mock', 'slow-image'), '20'); } });
  const noteFile = join(T.fleet.stateDir, 'self-test.json'), mock = f => join(T.fleet.root, 'spark3', '.mock', f);
  const start = await api('/actions/self_test', { method: 'POST', body: { spark: 'spark3' } });
  assert.equal(start.status, 200, start.text);
  const child = await waitFor(async () => (await api('/jobs')).json.jobs.find(j => j.selfTestOperation === start.json.operation && j.selfTestContainer === start.json.container),
    { timeout: 120000, every: 100, what: 'actual source child target before first create' });
  assert.equal(child.node, 'spark3');
  const before = JSON.parse(readFileSync(noteFile, 'utf8')); assert.ok(!before.model.id, 'the early adoption has no Docker identity yet');
  const adopt = await api('/actions/start_model', { method: 'POST', body: { spark: 'spark3', model: before.model.name } });
  assert.equal(adopt.status, 200, adopt.text); assert.equal(adopt.json.outcome, 'already-starting', adopt.text);
  assert.ok(JSON.parse(readFileSync(join(T.fleet.stateDir, 'desired.json'), 'utf8')).running.some(x => x.spark === 'spark3' && x.container === start.json.container));
  const marked = JSON.parse(readFileSync(noteFile, 'utf8')); assert.equal(marked.model.wish, true); assert.equal(marked.model.wishSaved, true);
  rmSync(mock('slow-image'), { force: true });
  await waitFor(() => { try { return JSON.parse(readFileSync(noteFile, 'utf8')).model.id; } catch { return null; } }, { timeout: 120000, what: 'the adopted early source’s exact Docker id' });
  process.kill(T.fleet.servicePid(), 'SIGKILL'); await waitFor(() => T.fleet.serviceExit(), { timeout: 10000, what: 'early-adopted source service crash' });
  rmSync(mock('serve-down'), { force: true });
  second = spawn(process.execPath, [SERVICE_FILE], { cwd: REPO, env: { ...T.fleet.env, SPARK_CONSOLE_SELFTEST_RECOVER_MS: '30000' }, stdio: 'ignore' });
  await waitFor(async () => (await api('/health').catch(() => null))?.status === 200, { timeout: 30000, what: 'early-adoption service back' });
  await waitFor(() => !existsSync(noteFile), { timeout: 120000, what: 'early-adoption recovery retired the self-test note' });
  assert.ok(running(start.json.container));
  assert.ok(JSON.parse(readFileSync(join(T.fleet.stateDir, 'desired.json'), 'utf8')).running.some(x => x.spark === 'spark3' && x.container === start.json.container));
});

test('pending owner intent arriving during the final awaited look is retained when its desired save fails', async () => {
  const h = recoveryFixture('late-pending'); await h.run();
  assert.equal(h.rec.model.wishSaved, false); assert.equal(h.removed, 0); assert.equal(h.retries, 1); assert.deepEqual(h.events, []);
});

async function recoverAfterNativeStop(h) {
  let removed = 0, retries = 0;
  const deps = { ...h.deps, NAME_RE: /^[\w-]+$/, firstLine: e => e.message, wordList: xs => xs.join(', '),
    selfTestSettleWishes: h.api.selfTestSettleWishes,
    containerStates: async () => ({ 'sc-test': { id: ID, state: 'exited' }, 'selftest-web': { id: ID, state: 'exited' } }),
    unlinkSync: () => { removed++; }, fleetEvent: () => {}, setTimeout: () => { retries++; return { unref() {} }; },
  };
  const recover = new Function(...Object.keys(deps), `${take(SELF, 'selfTestRecover')}\nreturn selfTestRecover;`)(...Object.values(deps));
  await recover(); return { removed, retries };
}
test('a native owner app stop revokes pending adoption before Docker and lets recovery retire its note without recreating intent', async () => {
  const h = appFixture('native-stop'); h.rec.web.wish = true; h.rec.web.wishSaved = false;
  const out = await h.action({ spark: 'spark3', container: 'selftest-web', do: 'stop' }, { login: 'owner' }, { via: 'page' });
  await Promise.all(h.pending);
  assert.equal(h.rec.web.wishStopped, true); assert.equal(h.rec.web.wishSaved, true); assert.deepEqual(h.events, ['stopped']);
  const finish = new Function('desired', 'writePrivate', 'DESIRED_FILE', 'brainSparks', 'keyOf', `${take(part('20-desired.mjs'), 'desiredAfter')}\nreturn desiredAfter;`)(
    () => ({ revision: 1, revisions: [], running: structuredClone(h.desired) }), (file, value) => { assert.equal(file, 'desired.json'); h.desired = value.running; },
    'desired.json', () => [], x => `${x.spark}/${x.container}`);
  finish({ ...h.jobs.get(out.operation), status: 'completed' });
  assert.deepEqual(h.desired, [], 'the native stop uses desiredAfter to remove its app entry');
  assert.deepEqual(await recoverAfterNativeStop(h), { removed: 1, retries: 0 });
  assert.deepEqual(h.desired, [], 'recovery never recreates the revoked app intent');
});
test('an admitted native offline app forget revokes pending adoption and permits note settlement', async () => {
  const h = appFixture('offline'); h.offline = true; h.rec.web.wish = true; h.rec.web.wishSaved = false;
  const out = await h.action({ spark: 'spark3', container: 'selftest-web', do: 'stop' }, { login: 'owner' }, { via: 'page' });
  assert.equal(out.outcome, 'forgotten'); assert.equal(h.rec.web.wishStopped, true); assert.equal(h.rec.web.wishSaved, true);
  assert.deepEqual(h.events, ['forgotten']); assert.deepEqual(h.desired, []);
  assert.deepEqual(await recoverAfterNativeStop(h), { removed: 1, retries: 0 });
});
test('a refused native app stop and conditional cleanup do not revoke the owner wish', async () => {
  const h = appFixture('refused'); h.desired = []; h.rec.web.wish = true; h.rec.web.wishSaved = false;
  await assert.rejects(h.action({ spark: 'spark3', container: 'selftest-web', do: 'stop' }, { login: 'owner' }, { via: 'page' }), /isn’t an app Spark Console keeps running/);
  assert.equal(h.rec.web.wishStopped, undefined); assert.equal(h.rec.web.wishSaved, false); assert.deepEqual(h.events, []);
  const conditional = appFixture('conditional'); conditional.rec.web.wish = true; conditional.rec.web.wishSaved = false;
  const out = await conditional.invoke(); assert.equal(out.outcome, 'left');
  assert.equal(conditional.rec.web.wishStopped, undefined); assert.equal(conditional.rec.web.wishSaved, false); assert.deepEqual(conditional.events, []);
});
