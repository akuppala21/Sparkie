// Covers: a later owner adoption wins over stale compensation inventory and the attempt-lock await.
// Created cleanup, removal and cancelled-original stops recheck intent; initial preflight remains authorized.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { randomBytes } from 'node:crypto';
const source = name => readFileSync(new URL(`../service/src/${name}`, import.meta.url), 'utf8');
const take = (text, name) => { const m = new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, 'm').exec(text); assert.ok(m, name); return m[0]; };
const core = source('17-rollback.mjs'), target = source('17-rollback-target.mjs');
const OP = '123456789abc', ATTEMPT = 'abcdef123456', COMMAND = 'cccccccccccc', ID = 'a'.repeat(64), OLD = 'b'.repeat(64), AT = '2026-11-17T00:00:00.000Z', NAME = 'sc-new', KEY = `spark3/${NAME}`;
function harness(adoptAt = null) {
  const h = { adoptAt, adopted: false, mutations: [], logs: [], forgotten: false, extra: new Map(), receipts: new Map() };
  h.container = { id: ID, name: NAME, startedAt: AT, state: 'running', labels: { 'spark.operation': OP, 'spark.attempt': ATTEMPT, 'spark.command': COMMAND } };
  let record = { operation: OP, phase: 'returning', targets: ['spark3'], wishes: [], units: [], attempts: [{ id: ATTEMPT, commands: [{ id: COMMAND, spark: 'spark3', action: 'run', name: NAME, result: { terminal: true, code: 0, boot: 'boot', seen: structuredClone(h.container) } }] }] };
  h.adopt = () => {
    if (h.adopted) return; h.adopted = true;
    record.wishes = [KEY]; record.stopWishes = [];
    for (const u of record.units) for (const m of u.members) { m.state = 'superseded'; m.stopReturn = false; }
  };
  h.adoptPair = () => { h.adopted = true; record.wishes = record.units.flatMap(u => u.members.map(m => `${m.spark}/${m.container}`)); for (const u of record.units) for (const m of u.members) { m.state = 'superseded'; m.stopReturn = false; } };
  const fence = async () => {
    for (const a of record.attempts) for (const c of a.commands) if (!c.result) c.result = { terminal: true, notIssued: true, boot: 'boot' };
    return true;
  };
  const env = {
    randomBytes, Date, performance, Map, Set, JSON, Object, String, Error,
    ENGINE_CHECK_NAME: 'spark-console-engine-check', STOPPED_STATES: ['exited', 'created', 'dead'],
    rollbackRead: () => structuredClone(record), rollbackWrite: next => { record = structuredClone(next); },
    rollbackForget: () => { h.forgotten = true; h.beforeForget = structuredClone(record); record = null; },
    rollbackSame: (a, b) => Boolean(a && b && a.id === b.id && a.startedAt === b.startedAt),
    nodeById: id => ({ id }), q: s => `'${s}'`, note: (_j, line) => h.logs.push(line), sleep: async () => {},
    run: async () => { if (h.adoptAt === 'list') h.adopt(); return { code: 0, out: h.listEmpty ? '' : `${ID}\n` }; },
    rollbackLook: async (_spark, ref) => {
      if (h.adoptAt === 'look') h.adopt();
      if (h.postStopReady && ++h.postLookCount === 2 && h.adoptAt === 'postLook') h.adopt();
      await Promise.resolve();
      const found = [h.container, ...h.extra.values()].find(x => x && [x.id, x.name].includes(ref));
      return found ? structuredClone(found) : null;
    },
    rollbackReconcile: async () => fence(), rollbackFence: fence, rollbackStopDisposed: () => false,
    rollbackResult: (job, r) => { job.cleanUp = r.blocked.length ? 'held' : undefined; },
    rollbackTarget: async (_spark, p) => {
      if (p.mode === 'dispatch') {
        const box = [h.container, ...h.extra.values()].find(x => x?.id === p.expected.id);
        assert.ok(box); assert.equal(p.expected.startedAt, box.startedAt);
        h.mutations.push({ action: p.action, id: p.expected.id });
        const failed = p.action === 'start' && box.id === h.failStartId;
        if (p.action === 'start' && !failed) box.state = 'running';
        if (p.action === 'stop') box.state = 'exited';
        if (p.action === 'remove') { if (h.container?.id === box.id) h.container = null; else h.extra.delete(box.id); }
        h.receipts.set(p.command, { action: p.action, failed, result: { terminal: true, code: failed ? 1 : 0, boot: 'boot', seen: p.action === 'remove' ? null : structuredClone(box) } });
        return {};
      }
      const receipt = h.receipts.get(p.command); assert.ok(receipt);
      if (receipt.action === 'start' && receipt.failed) { h.pendingPairCleanup = true; if (h.adoptAt === 'secondFailure') h.adoptPair(); }
      if (receipt.action === 'start' && !receipt.failed && h.negativeAfterStart) {
        const member = record.units[0].members[0]; member.state = 'superseded'; member.stopReturn = true;
        record.wishes = []; record.stopWishes = [`${member.spark}/${member.container}`]; h.postStopReady = true; h.postLookCount = 0;
      }
      return { result: receipt.result };
    },
    rollbackKey: x => `${x.spark}/${x.container}`, desired: () => ({ running: [] }), rollbackDesiredChanged: () => false,
    agentSettings: () => ({ halted: false }), rollbackRoom: async () => {}, rollbackTransfer: async () => {},
    jobMountsReal: () => 'true', consoleStopped: new Map(), selfTestRollbackStopped: () => {},
  };
  const functions = ['rollbackAttempt', 'rollbackOriginal', 'rollbackStopOriginal', 'rollbackRemove', 'rollbackOwned', 'rollbackStopCancelled', 'rollbackReturn'];
  runInNewContext(functions.map(n => take(core, n)).join('\n') + '\n' + take(target, 'rollbackCommand'), env);
  const attempt = env.rollbackAttempt;
  env.rollbackAttempt = async job => { const answer = await attempt(job); if (h.adoptAt === 'attempt') h.adopt(); if (h.adoptAt === 'pairAttempt' && h.pendingPairCleanup) h.adoptPair(); if (h.adoptAt === 'postAttempt' && h.postStopReady) h.adopt(); return answer; };
  h.api = env; h.job = () => ({ id: 'eeeeeeeeeeee', rollbackOperation: OP });
  h.change = fn => fn(record); h.read = () => structuredClone(record); return h;
}
for (const at of ['list', 'look', 'attempt']) test(`a created container adopted during ${at} is left running by the real coordinator`, async () => {
  const h = harness(at); await h.api.rollbackReturn(h.job());
  assert.equal(h.adopted, true); assert.equal(h.container.state, 'running'); assert.deepEqual(h.mutations, []);
  assert.equal(h.forgotten, true, 'all real command intents are settled before retiring compensation');
  assert.deepEqual(h.beforeForget.wishes, [KEY]);
});
test('without a newer adoption, created cleanup still stops the exact failed-attempt ID', async () => {
  const h = harness(); await h.api.rollbackReturn(h.job());
  assert.deepEqual(h.mutations, [{ action: 'stop', id: ID }]); assert.equal(h.container.state, 'exited'); assert.equal(h.forgotten, true);
});
for (const at of ['look', 'attempt']) test(`return-time removal skips a stopped container adopted during ${at}`, async () => {
  const h = harness(at); h.container.state = 'exited';
  await h.api.rollbackRemove(h.job(), 'spark3', NAME);
  assert.equal(h.adopted, true); assert.ok(h.container); assert.deepEqual(h.mutations, []);
});
test('active preflight removal is not blocked by adoption of the new start', async () => {
  const h = harness(); h.container.state = 'exited'; h.change(r => { r.phase = 'active'; r.wishes = [KEY]; });
  await h.api.rollbackRemove(h.job(), 'spark3', NAME);
  assert.deepEqual(h.mutations, [{ action: 'remove', id: ID }]); assert.equal(h.container, null);
});
function original(h) {
  h.container = { id: OLD, name: NAME, startedAt: AT, state: 'running', labels: {} };
  h.change(r => {
    r.units = [{ id: '111111111111', members: [{ spark: 'spark3', container: NAME, original: { id: OLD, startedAt: AT }, state: 'superseded', stopReturn: true }] }];
    r.attempts[0].commands.push({ id: 'dddddddddddd', spark: 'spark3', name: NAME, action: 'start', expected: { id: OLD, startedAt: AT }, result: { terminal: true, code: 0, boot: 'boot', seen: structuredClone(h.container) } });
  });
}
for (const at of ['look', 'attempt']) test(`a cancelled original adopted during ${at} follows its fresh positive member intent`, async () => {
  const h = harness(at); original(h); const snapshot = h.read();
  await h.api.rollbackStopCancelled(h.job(), snapshot, 'spark3');
  assert.equal(h.adopted, true); assert.equal(h.container.state, 'running'); assert.deepEqual(h.mutations, []);
  assert.equal(h.read().units[0].members[0].stopReturn, false);
});
test('a still-current negative original intent stops only its exact completed restoration ID', async () => {
  const h = harness(); original(h);
  await h.api.rollbackStopCancelled(h.job(), h.read(), 'spark3');
  assert.deepEqual(h.mutations, [{ action: 'stop', id: OLD }]); assert.equal(h.container.state, 'exited');
});
test('initial old-copy preflight stop still runs when the owner adopted the pending new start', async () => {
  const h = harness(); original(h); h.change(r => { r.phase = 'active'; r.wishes = [KEY]; r.units[0].members[0].state = 'waiting'; r.units[0].members[0].stopReturn = false; });
  await h.api.rollbackStopOriginal(h.job(), 'spark3', NAME);
  assert.deepEqual(h.mutations, [{ action: 'stop', id: OLD }]); assert.equal(h.container.state, 'exited');
});

function restoration(h, pair = false) {
  h.listEmpty = true;
  h.container = { id: OLD, name: NAME, startedAt: AT, state: 'exited', labels: {} };
  const member = (spark, container, id) => ({ spark, container, original: { id, startedAt: AT }, state: 'waiting', wasRunning: true, need: 1, listed: null, aside: `${container}-before-op` });
  h.change(r => { r.attempts[0].commands = []; r.units = [{ id: '111111111111', members: [member('spark3', NAME, OLD)] }]; });
  if (pair) {
    const second = { id: 'c'.repeat(64), name: `${NAME}-part2`, startedAt: AT, state: 'exited', labels: {} };
    h.extra.set(second.id, second); h.failStartId = second.id;
    h.change(r => { r.targets.push('spark4'); r.units[0].members.push(member('spark4', second.name, second.id)); });
  }
}
for (const at of ['postLook', 'postAttempt']) test(`a newer positive original intent wins over a post-restoration negative stop during ${at}`, async () => {
  const h = harness(at); restoration(h); h.negativeAfterStart = true;
  await h.api.rollbackReturn(h.job());
  assert.equal(h.adopted, true); assert.equal(h.container.state, 'running');
  assert.deepEqual(h.mutations, [{ action: 'start', id: OLD }]); assert.equal(h.forgotten, true);
});
for (const at of ['secondFailure', 'pairAttempt']) test(`paired rollback does not undo newer owner adoption during ${at}`, async () => {
  const h = harness(at); restoration(h, true);
  await h.api.rollbackReturn(h.job());
  assert.equal(h.adopted, true); assert.equal(h.container.state, 'running');
  assert.ok(!h.mutations.some(x => x.action === 'stop')); assert.equal(h.forgotten, true);
});
test('without adoption, a failed second restoration still stops the first half by its exact ID', async () => {
  const h = harness(); restoration(h, true); await h.api.rollbackReturn(h.job());
  assert.equal(h.container.state, 'exited'); assert.ok(h.mutations.some(x => x.action === 'stop' && x.id === OLD));
  assert.equal(h.forgotten, false, 'unrestored originals remain on record');
});
