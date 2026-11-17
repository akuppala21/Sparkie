// Covers: only the owner's wholly positive, settled job-adoption debt can retire synchronously under its Spark claim.
// Uncovered targets, waiting or negative wishes, live commands, running survivors and engine checks remain held.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../service/src/17-rollback.mjs', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('async function rollbackRetireSuperseded('), source.indexOf('async function rollbackPrepare('));
function fixture(change = () => {}) {
  let record = { operation: '123456789abc', phase: 'returning', targets: ['spark4'], units: [{ members: [{ state: 'superseded', stopReturn: false }] }], attempts: [] };
  const h = { jobs: new Map(), fences: [], owned: [], fenceOK: true, failSave: false, forgotten: false, afterLook: null };
  change(record, h);
  h.run = new Function('rollbackRecords', 'rollbackRead', 'rollbackFence', 'rollbackOwned', 'rollbackForget', 'jobs', 'ENGINE_CHECK_NAME', 'STOPPED_STATES', `${helper}\nreturn rollbackRetireSuperseded;`)(
    () => record ? [structuredClone(record)] : [], () => structuredClone(record),
    async (_, spark) => { h.fences.push(spark); return h.fenceOK; },
    async () => { if (h.afterLook) h.afterLook(record); return h.owned; },
    () => { if (h.failSave) throw new Error('disk full'); h.forgotten = true; record = null; }, h.jobs, 'spark-console-engine-check', ['exited', 'dead', 'created']);
  h.record = () => structuredClone(record); return h;
}
test('wholly positive owner adoption retires settled source debt under the target claim', async () => {
  const h = fixture(); h.owned.push({ name: 'sc-failed', state: 'exited' }); await h.run(['spark4']);
  assert.equal(h.forgotten, true); assert.deepEqual(h.fences, ['spark4']); assert.equal(h.record(), null);
});
for (const [label, change] of [
  ['another uncovered target', r => r.targets.push('spark3')],
  ['a waiting mate', r => r.units[0].members.push({ state: 'waiting' })],
  ['a negative stop wish', r => { r.units[0].members[0].stopReturn = true; }],
  ['a merely restored original', r => r.units[0].members.push({ state: 'restored' })],
  ['an active source operation', (r, h) => h.jobs.set(r.operation, { status: 'running' })],
  ['an unknown command fence', (_, h) => { h.fenceOK = false; }],
  ['a running source survivor', (_, h) => h.owned.push({ name: 'sc-failed', state: 'running' })],
  ['a stopped engine check', (_, h) => h.owned.push({ name: 'spark-console-engine-check', state: 'exited' })],
  ['a strict retirement save failure', (_, h) => { h.failSave = true; }],
  ['a stop wish arriving during the target look', (_, h) => { h.afterLook = r => { r.units[0].members[0].stopReturn = true; }; }],
]) test(`job adoption preserves debt with ${label}`, async () => {
  const h = fixture(change); await h.run(['spark4']); assert.equal(h.forgotten, false); assert.ok(h.record());
});
test('an identity-check failure while looking at source survivors keeps the debt', async () => {
  const h = fixture((_, h) => { h.afterLook = () => { throw new Error('identity changed'); }; });
  await h.run(['spark4']); assert.equal(h.forgotten, false); assert.ok(h.record());
});
