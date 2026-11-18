// Covers: observation during a pending start is not an owner wish; an actual newer wish survives the exact
// create-receipt handoff to its saved workflow before source rollback authority is retired.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const part = name => readFileSync(new URL(`../service/src/${name}`, import.meta.url), 'utf8');
const take = (text, name) => { const found = new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, 'm').exec(text); assert.ok(found, name); return found[0]; };
const rollback = part('17-rollback.mjs'), records = part('18-run-record.mjs'), steps = part('18-step-jobs.mjs'), desiredSource = part('20-desired.mjs');
const SOURCE = '123456789abc', PARENT = 'abcdef123456', ID = 'a'.repeat(64), WHEN = '2026-11-17T00:00:00.000Z', KEY = 'spark3/sc-loading';
function handoff() {
  const job = { id: SOURCE, rollbackOperation: SOURCE, ranHere: [KEY] }, parent = { id: PARENT };
  const h = { job, parent, events: [], failRead: false, failWrite: false, seen: { id: ID, startedAt: WHEN } };
  let state = { runs: {
    [SOURCE]: { kind: 'start-rollback', operation: SOURCE, phase: 'active', targets: ['spark3'], wishes: [KEY], units: [], attempts: [{ commands: [{ spark: 'spark3', name: 'sc-loading', action: 'run', result: { terminal: true, code: 0, seen: { id: ID, startedAt: WHEN } } }] }] },
    [PARENT]: { operation: PARENT, starting: SOURCE, pending: [], awaiting: [] },
  } };
  const names = ['savedRunsNow', 'writePrivate', 'SAVED_RUNS_FILE', 'note', 'savedRunWords', 'jobs', 'rollbackRead', 'rollbackWrite', 'rollbackForget', 'rollbackSame', 'receiptOf', 'desired', 'keyOf', 'rollbackKey', 'rollbackSave', 'backUnits', 'readKept', 'DESIRED_FILE', 'ENGINE_CHECK_NAME', 'selfTestWish', 'selfTestRevoke'];
  const values = [
    () => { if (h.failRead) throw new Error('unreadable receipts'); return structuredClone(state); },
    (_, next) => { if (h.failWrite) throw new Error('receipt disk full'); state = structuredClone(next); h.events.push('receipt'); },
    '/fake/saved-runs.json', () => {}, e => e.message, new Map([[SOURCE, job], [PARENT, parent]]),
    id => structuredClone(state.runs[id]), r => { state.runs[r.operation] = structuredClone(r); h.events.push('committed'); },
    id => { h.retiredWith = structuredClone(state); delete state.runs[id]; h.events.push('forgotten'); },
    (a, b) => Boolean(a && b && a.id === b.id && a.startedAt === b.startedAt),
    async () => { h.captureCount = (h.captureCount || 0) + 1; if (h.afterReceipt) h.afterReceipt(state); return structuredClone(h.seen); },
    () => ({ running: [{ spark: 'spark3', container: 'sc-loading', since: WHEN }] }), x => `${x.spark}/${x.container}`, x => `${x.spark}/${x.container}`,
    next => { if (h.failIntent) throw new Error('intent disk full'); state = structuredClone(next); h.events.push('intent'); }, () => [], () => null, '/fake/desired.json', 'spark-console-engine-check', () => {}, () => {},
  ];
  h.api = new Function(...names, `${take(records, 'savedRunKeep')}\n${take(records, 'savedRunReceipts')}\n${take(steps, 'captureStartedReceipts')}\n${take(desiredSource, 'desiredWish')}\n${take(rollback, 'rollbackSupersede')}\n${take(rollback, 'rollbackAdoptStart')}\n${take(rollback, 'rollbackCommit')}\nreturn { rollbackCommit, rollbackSupersede, rollbackAdoptStart, desiredWish };`)(...values);
  h.commit = h.api.rollbackCommit; h.supersede = h.api.rollbackSupersede; h.adopt = h.api.rollbackAdoptStart;
  h.read = () => structuredClone(state); h.change = fn => fn(state); return h;
}
test('the exact source wish is durable in the parent receipt before the source recovery record is forgotten', async () => {
  const h = handoff(); await h.commit(h.job);
  assert.equal(h.job.ownersWish, true); assert.equal(h.read().runs[SOURCE], undefined);
  const pending = h.read().runs[PARENT].pending;
  assert.deepEqual(pending, [{ kind: 'model', spark: 'spark3', container: 'sc-loading', operation: SOURCE, wish: true, seen: { id: ID, startedAt: WHEN } }]);
  assert.deepEqual(h.events, ['receipt', 'committed', 'forgotten']);
  assert.equal(h.retiredWith.runs[PARENT].pending[0].wish, true, 'a fresh process sees the owner intent without the source job in memory');
});
test('a wish for another resource cannot adopt this source operation', async () => {
  const h = handoff(); h.change(s => { s.runs[SOURCE].wishes = ['spark4/sc-other']; });
  await h.commit(h.job); assert.equal(h.job.ownersWish, undefined); assert.equal(h.captureCount, undefined);
  assert.deepEqual(h.read().runs[PARENT].pending, []);
});
for (const [name, damage, pattern] of [
  ['missing exact receipt', h => { h.seen = null; }, /exact container/],
  ['different container ID', h => { h.seen.id = 'b'.repeat(64); }, /exact container/],
  ['different start time', h => { h.seen.startedAt = 'later'; }, /exact container/],
  ['unreadable saved workflow receipts', h => { h.failRead = true; }, /unreadable receipts/],
  ['failed durable receipt write', h => { h.failWrite = true; }, /receipt disk full/],
]) test(`the source wish survives ${name}; no retirement is claimed`, async () => {
  const h = handoff(); damage(h); await assert.rejects(h.commit(h.job), pattern);
  assert.equal(h.read().runs[SOURCE].phase, 'active'); assert.deepEqual(h.read().runs[SOURCE].wishes, [KEY]);
  assert.ok(!h.events.includes('forgotten')); assert.equal(h.retiredWith, undefined);
});
test('an already-recorded owner wish is also handed off before retirement', async () => {
  const h = handoff(); h.change(s => { s.runs[SOURCE].wishes = []; }); h.job.ownersWish = true;
  await h.commit(h.job); assert.equal(h.read().runs[PARENT].pending[0].wish, true);
});
function seedFixture() {
  const h = { records: [], seeds: 0, missing: true, badRecords: false };
  h.watch = new Function('existsSync', 'DESIRED_FILE', 'recentInventory', 'rollbackRecords', 'seedDesired', 'desired', 'jobs', 'console', `let heldLast = [];\n${take(desiredSource, 'watchHeld')}\nreturn watchHeld;`)(
    () => !h.missing, '/fake/desired.json', async () => ({ sparks: [{ id: 'spark3', online: true, deployments: [{ container: 'sc-loading', state: 'running' }] }] }),
    () => { if (h.badRecords) throw new Error('unreadable recovery'); return h.records; }, () => { h.seeds++; }, () => ({ running: [] }), new Map(), { error: text => { if (!h.badRecords) throw new Error(text); } });
  return h;
}
for (const phase of ['active', 'returning']) test(`first automatic desired seed waits through ${phase} recovery, then resumes`, async () => {
  const h = seedFixture(); h.records = [{ phase }]; await h.watch(); assert.equal(h.seeds, 0, 'a loading/uncertain container creates no fresh owner intent');
  h.records = []; await h.watch(); assert.equal(h.seeds, 1);
});
test('an unreadable recovery record cannot seed a new desired list', async () => {
  const h = seedFixture(); h.badRecords = true; await h.watch(); assert.equal(h.seeds, 0);
});
test('committed recovery and an existing desired file keep their existing seed behavior', async () => {
  const h = seedFixture(); h.records = [{ phase: 'committed' }]; await h.watch(); assert.equal(h.seeds, 1);
  h.missing = false; h.badRecords = true; await h.watch(); assert.equal(h.seeds, 1, 'the existing list was not replaced');
});

test('a newer owner stop during receipt capture is never overwritten by the earlier positive wish', async () => {
  const h = handoff(); h.afterReceipt = state => {
    state.runs[SOURCE].wishes = [];
    state.runs[SOURCE].units = [{ members: [{ spark: 'spark3', container: 'sc-loading', state: 'superseded', stopReturn: true }] }];
  };
  await assert.rejects(h.commit(h.job), e => e.cancelled === true && /newer wish was kept/.test(e.message));
  assert.deepEqual(h.read().runs[SOURCE].wishes, []); assert.equal(h.read().runs[SOURCE].units[0].members[0].stopReturn, true);
  assert.equal(h.read().runs[SOURCE].phase, 'active'); assert.deepEqual(h.read().runs[PARENT].pending, []);
  assert.equal(h.job.startedReceipts, undefined); assert.ok(!h.events.includes('forgotten'));
});
test('a wrong captured identity is never published to existing awaiting cleanup receipts', async () => {
  const h = handoff(); h.seen.id = 'b'.repeat(64);
  h.change(state => { state.runs[PARENT].awaiting = [{ operation: SOURCE, kind: 'model', spark: 'spark3', container: 'sc-loading' }]; });
  await assert.rejects(h.commit(h.job), /exact container/);
  assert.deepEqual(h.read().runs[PARENT].pending, []); assert.equal(h.read().runs[PARENT].awaiting[0].seen, undefined);
  assert.equal(h.job.startedReceipts, undefined); assert.equal(h.events.length, 0);
});

test('already-starting adoption is durable before any ranHere receipt and before commit', () => {
  const h = handoff(); h.job.ranHere = []; h.change(state => { state.runs[SOURCE].wishes = []; });
  h.adopt(h.job); assert.equal(h.job.ownersWish, true); assert.deepEqual(h.read().runs[SOURCE].wishes, [KEY]);
  assert.deepEqual(h.events, ['intent']); assert.equal(h.read().runs[SOURCE].phase, 'active');
});
for (const during of [false, true]) test(`a job-only wish cannot override a newer stop with no original unit (${during ? 'during' : 'before'} capture)`, async () => {
  const h = handoff(); h.job.ownersWish = true; h.change(state => { state.runs[SOURCE].wishes = []; });
  const stop = () => h.supersede([KEY], 'the owner stopped it');
  if (during) h.afterReceipt = stop; else stop();
  await assert.rejects(h.commit(h.job), e => e.cancelled === true);
  assert.deepEqual(h.read().runs[SOURCE].stopWishes, [KEY]); assert.deepEqual(h.read().runs[SOURCE].wishes, []);
  assert.equal(h.read().runs[SOURCE].phase, 'active'); assert.deepEqual(h.read().runs[PARENT].pending, []);
  assert.equal(h.job.startedReceipts, undefined); assert.equal(h.job.ownersWish, false);
});
test('a failed negative-intent save does not claim a stop was kept', () => {
  const h = handoff(); h.failIntent = true;
  assert.throws(() => h.supersede([KEY], 'the owner stopped it'), /intent disk full/);
  assert.deepEqual(h.read().runs[SOURCE].wishes, [KEY]); assert.equal(h.read().runs[SOURCE].stopWishes, undefined);
});
test('the owner’s later positive wish replaces its exact negative marker; a cancelled start is never revived', () => {
  const h = handoff(); h.supersede([KEY], 'the owner stopped it'); h.adopt(h.job);
  assert.deepEqual(h.read().runs[SOURCE].stopWishes, []); assert.deepEqual(h.read().runs[SOURCE].wishes, [KEY]);
  h.job.cancelled = true; h.supersede([KEY], 'the owner stopped it');
  assert.throws(() => h.adopt(h.job), /being stopped/); assert.deepEqual(h.read().runs[SOURCE].stopWishes, [KEY]);
});
test('owner adoption never includes an engine-check key, from commands or transient job lists', () => {
  const h = handoff(); h.job.ranHere = ['spark3/spark-console-engine-check'];
  h.change(state => { state.runs[SOURCE].wishes = []; state.runs[SOURCE].attempts[0].commands[0].name = 'spark-console-engine-check'; });
  h.adopt(h.job); assert.deepEqual(h.read().runs[SOURCE].wishes, []);
});
test('negative intent uses the existing strict recovery shape and rejects bad, hub and excessive keys', () => {
  const shape = new Function('computeSparks', 'NAME_RE', `${take(rollback, 'rollbackShape')}\nreturn rollbackShape;`)(() => ['spark3', 'spark4'], /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/);
  const record = { kind: 'start-rollback', operation: SOURCE, phase: 'active', since: WHEN, chat: null, targets: ['spark3'], units: [], attempts: [], stopWishes: [KEY] };
  assert.equal(shape(record), true);
  for (const bad of [['spark1/sc-loading'], ['spark4/sc-loading'], ['spark3/a/b'], Array.from({ length: 81 }, () => KEY), false]) assert.equal(shape({ ...record, stopWishes: bad }), false);
});

test('a newer stop with no earlier adoption and no original unit prevents commit outright', async () => {
  const h = handoff(); h.change(state => { state.runs[SOURCE].wishes = []; }); h.supersede([KEY], 'the owner stopped it');
  await assert.rejects(h.commit(h.job), e => e.cancelled === true);
  assert.equal(h.captureCount, undefined, 'no capture or positive handoff is attempted');
  assert.equal(h.read().runs[SOURCE].phase, 'active'); assert.deepEqual(h.read().runs[SOURCE].stopWishes, [KEY]);
  assert.ok(!h.events.includes('committed')); assert.ok(!h.events.includes('forgotten'));
});
test('a stop on another Spark adds no irrelevant intent to this recovery record', () => {
  const h = handoff(); h.supersede(['spark4/sc-other'], 'the owner stopped it');
  assert.equal(h.read().runs[SOURCE].stopWishes, undefined); assert.deepEqual(h.read().runs[SOURCE].wishes, [KEY]);
  assert.deepEqual(h.events, []);
});

function commandFixture() {
  const attempt = '111111111111', h = { targets: [], fail: false }, job = { rollbackOperation: SOURCE, ownersWish: true };
  let record = { operation: SOURCE, phase: 'active', wishes: [], targets: ['spark3'], attempts: [{ id: attempt, commands: [] }] };
  h.dispatch = new Function('rollbackAttempt', 'rollbackRead', 'rollbackWrite', 'randomBytes', 'rollbackTarget', 'sleep', 'ENGINE_CHECK_NAME', `${take(part('17-rollback-target.mjs'), 'rollbackCommand')}\nreturn rollbackCommand;`)(
    async () => ({ id: attempt }), () => structuredClone(record), next => { if (h.fail) throw new Error('intent disk full'); record = structuredClone(next); }, randomBytes,
    async (_spark, payload) => {
      h.targets.push({ payload, record: structuredClone(record) });
      return payload.mode === 'receipt' ? { result: { terminal: true, code: 0, boot: 'boot' } } : {};
    }, async () => {}, 'spark-console-engine-check');
  h.job = job; h.read = () => structuredClone(record); h.stop = () => { record.stopWishes = [KEY]; }; return h;
}
test('an adoption before the first create is written in the command intent before target dispatch', async () => {
  const h = commandFixture(); await h.dispatch(h.job, 'spark3', 'run', 'sc-loading');
  assert.deepEqual(h.targets[0].record.wishes, [KEY]);
  assert.equal(h.targets[0].record.attempts[0].commands.length, 1);
});
test('negative intent prevents a later create even when its old job still has an in-memory adoption flag', async () => {
  const h = commandFixture(); h.stop();
  await assert.rejects(h.dispatch(h.job, 'spark3', 'run', 'sc-loading'), e => e.cancelled === true);
  assert.deepEqual(h.targets, []); assert.deepEqual(h.read().attempts[0].commands, []); assert.deepEqual(h.read().wishes, []);
});
test('a failed pre-create wish/command save dispatches nothing', async () => {
  const h = commandFixture(); h.fail = true;
  await assert.rejects(h.dispatch(h.job, 'spark3', 'run', 'sc-loading'), /intent disk full/); assert.deepEqual(h.targets, []);
});
test('the same in-memory flag never adopts an engine check before its dispatch', async () => {
  const h = commandFixture(); await h.dispatch(h.job, 'spark3', 'run', 'spark-console-engine-check');
  assert.deepEqual(h.targets[0].record.wishes, []);
});

test('the actual already-starting owner path persists adoption before its reply', () => {
  const h = handoff(); h.job.node = 'spark3'; h.job.ranHere = []; h.change(state => { state.runs[SOURCE].wishes = []; });
  const reply = new Function('ownersAsk', 'rollbackAdoptStart', `${take(part('17-changes.mjs'), 'alreadyStarting')}\nreturn alreadyStarting;`)(() => true, h.adopt)(h.job, 'loading', {}, {});
  assert.equal(reply.outcome, 'already-starting'); assert.equal(reply.operation, SOURCE);
  assert.deepEqual(h.read().runs[SOURCE].wishes, [KEY]); assert.equal(h.job.ownersWish, true);
});
test('the actual already-starting agent path grants no new owner intent', () => {
  const h = handoff(); h.job.node = 'spark3'; h.change(state => { state.runs[SOURCE].wishes = []; });
  const reply = new Function('ownersAsk', 'rollbackAdoptStart', `${take(part('17-changes.mjs'), 'alreadyStarting')}\nreturn alreadyStarting;`)(() => false, () => assert.fail('an agent cannot adopt the owner’s work'))(h.job, 'loading', {}, {});
  assert.equal(reply.outcome, 'already-starting'); assert.equal(h.job.ownersWish, undefined);
  assert.deepEqual(h.read().runs[SOURCE].wishes, []); assert.deepEqual(h.events, []);
});

function cleanupHistory(h, action, result) {
  h.change(state => {
    const r = state.runs[SOURCE]; r.phase = 'returning'; r.wishes = [];
    r.attempts[0].commands.push({ id: 'dddddddddddd', spark: 'spark3', name: 'sc-loading', action, expected: { id: ID, startedAt: WHEN }, ...(result ? { result } : {}) });
  });
}
for (const action of ['stop', 'remove']) test(`an already-running adoption is refused while its exact cleanup ${action} is unresolved`, () => {
  const h = handoff(); cleanupHistory(h, action);
  assert.throws(() => h.api.desiredWish([KEY]), /earlier stop or removal is still finishing/);
  assert.throws(() => h.api.desiredWish([KEY], { afterStart: { [KEY]: { id: ID, startedAt: WHEN } } }), /earlier stop or removal is still finishing/, 'fresh-start evidence never overrides an unresolved mutation');
  assert.deepEqual(h.read().runs[SOURCE].wishes, []); assert.equal(h.job.ownersWish, undefined); assert.deepEqual(h.events, []);
});
for (const action of ['stop', 'remove']) test(`a stale running read cannot adopt a known ${action === 'stop' ? 'stopped' : 'removed'} target; an exact successful owner rerun can`, () => {
  const h = handoff(); cleanupHistory(h, action, { terminal: true, code: 0, seen: action === 'remove' ? null : { id: ID, startedAt: WHEN, state: 'exited' } });
  assert.throws(() => h.api.desiredWish([KEY]), /cleanup has stopped that container/);
  assert.deepEqual(h.events, []); assert.deepEqual(h.read().runs[SOURCE].wishes, []);
  h.api.desiredWish([KEY], { afterStart: { [KEY]: { id: ID, startedAt: WHEN } } });
  assert.deepEqual(h.read().runs[SOURCE].wishes, [KEY]); assert.equal(h.job.ownersWish, true);
});
test('a completed refused stop with exact running proof permits a new owner adoption', () => {
  const h = handoff(); cleanupHistory(h, 'stop', { terminal: true, code: 1, seen: { id: ID, startedAt: WHEN, state: 'running' } });
  h.api.desiredWish([KEY]); assert.deepEqual(h.read().runs[SOURCE].wishes, [KEY]);
});
test('a later create overrides terminal preflight-stop history; an unissued cleanup intent is harmless', () => {
  const h = handoff(); cleanupHistory(h, 'stop', { terminal: true, code: 0, seen: { id: ID, startedAt: WHEN, state: 'exited' } });
  h.change(state => state.runs[SOURCE].attempts[0].commands.push({ id: 'eeeeeeeeeeee', spark: 'spark3', name: 'sc-loading', action: 'run', result: { terminal: true, code: 0, seen: { id: 'b'.repeat(64), startedAt: WHEN, state: 'running' } } }));
  h.api.desiredWish([KEY]); assert.deepEqual(h.read().runs[SOURCE].wishes, [KEY]);
  h.change(state => { state.runs[SOURCE].wishes = []; state.runs[SOURCE].attempts[0].commands.push({ id: 'ffffffffffff', spark: 'spark3', name: 'sc-loading', action: 'stop', expected: { id: 'b'.repeat(64), startedAt: WHEN }, result: { terminal: true, notIssued: true } }); });
  h.api.desiredWish([KEY]); assert.deepEqual(h.read().runs[SOURCE].wishes, [KEY]);
});
test('cleanup for a different exact resource key does not block this adoption', () => {
  const h = handoff(); cleanupHistory(h, 'stop'); h.change(state => { state.runs[SOURCE].attempts[0].commands.at(-1).name = 'sc-other'; });
  h.api.desiredWish([KEY]); assert.deepEqual(h.read().runs[SOURCE].wishes, [KEY]);
});
test('an operation already putting work back cannot promise it is still starting, even with no model create', () => {
  const h = handoff(); h.job.ranHere = []; h.change(state => { state.runs[SOURCE].phase = 'returning'; state.runs[SOURCE].attempts[0].commands = []; state.runs[SOURCE].wishes = []; });
  assert.throws(() => h.adopt(h.job), /start failed and is putting earlier work back/);
  assert.equal(h.job.ownersWish, undefined); assert.deepEqual(h.events, []);
});

// Exercise the actual stopped-job callback: a post-start refusal would be too late to prevent an old stop.
function rerunCallback(h, { beforeStart = null } = {}) {
  const apps = part('21-apps.mjs'), begin = apps.indexOf('// A job run again ("run sums again")');
  const start = apps.indexOf('runJob(job, ', begin) + 'runJob(job, '.length, end = apps.indexOf('\n        });', start);
  assert.ok(begin >= 0 && start > begin && end > start);
  const callback = apps.slice(start, end) + '\n        }';
  const mutations = [], env = {
    pausedCheck: () => {}, ctx: {}, jobFolder: async () => {}, node: {}, container: 'sc-loading',
    look: { gpu: false }, appRoom: async () => { if (beforeStart) beforeStart(); }, gb: 1, key: KEY,
    rollbackRecords: () => Object.values(h.read().runs).filter(r => r.kind === 'start-rollback'),
    step: () => {}, at: 'Spark 3', run: async () => { mutations.push('start'); return { code: 0 }; },
    jobMountsReal: () => 'true', q: value => value, JOB_NOT_REAL: 97,
    captureStartedReceipts: async job => { job.startedReceipts = { [KEY]: { id: ID, startedAt: WHEN } }; },
    consoleStopped: new Map(), ownersAsk: () => true, viewer: {}, desiredWish: h.api.desiredWish,
    rollbackRetireSuperseded: async () => {}, spark: 'spark3', knowledge: { workloads: {} }, note: () => {},
  };
  const invoke = new Function(...Object.keys(env), `${take(rollback, 'rollbackBeforeRerun')}\nreturn ${callback};`)(...Object.values(env));
  return { run: () => invoke({}), mutations };
}
for (const action of ['stop', 'remove']) test(`the actual owner job-rerun callback refuses an unresolved ${action} before Docker starts`, async () => {
  const h = handoff(), call = rerunCallback(h, { beforeStart: () => cleanupHistory(h, action) });
  await assert.rejects(call.run(), /earlier command is still finishing/);
  assert.deepEqual(call.mutations, []); assert.deepEqual(h.read().runs[SOURCE].wishes, []);
});
test('the actual owner job-rerun callback permits settled stopped history and records its fresh successful receipt', async () => {
  const h = handoff(); cleanupHistory(h, 'stop', { terminal: true, code: 0, seen: { id: ID, startedAt: WHEN, state: 'exited' } });
  const call = rerunCallback(h); await call.run();
  assert.deepEqual(call.mutations, ['start']); assert.deepEqual(h.read().runs[SOURCE].wishes, [KEY]);
});

for (const phase of ['active', 'returning']) for (const action of ['run', 'start', 'rename']) test(`the actual job-rerun callback waits for an unanswered ${phase} ${action} elsewhere on the same Spark`, async () => {
  const h = handoff();
  h.change(state => { const r = state.runs[SOURCE]; r.phase = phase; r.attempts[0].commands.push({ spark: 'spark3', name: 'sc-other', action }); });
  const call = rerunCallback(h); await assert.rejects(call.run(), /earlier command is still finishing/);
  assert.deepEqual(call.mutations, []);
});
test('the actual job-rerun callback is not blocked by an unanswered command on another Spark', async () => {
  const h = handoff(); h.change(state => { const r = state.runs[SOURCE]; r.phase = 'returning'; r.targets.push('spark4'); r.attempts[0].commands.push({ spark: 'spark4', name: 'sc-other', action: 'stop' }); });
  const call = rerunCallback(h); await call.run(); assert.deepEqual(call.mutations, ['start']);
});
