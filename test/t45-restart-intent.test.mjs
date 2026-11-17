// Covers: an owner asking for an already-running model records intent without launching anything, even while its
// original start is still loading. Actual restart paths retain the unanswered-command gate, including inside a claim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../service/src/17-changes.mjs', import.meta.url), 'utf8');
const checked = source.slice(source.indexOf('async function restartChecked('), source.indexOf('\n// Room for it now'));
const room = source.slice(source.indexOf('async function restartRoom('), source.indexOf('// How long a restart waits'));
function fixture(state) {
  const h = { called: [], wishes: [], persisted: [], owner: true, starting: null, records: [{ phase: 'active', targets: ['spark3'], attempts: [{ commands: [{ spark: 'spark3' }] }] }] };
  const dep = { container: 'sc-loading', model: 'loading', state };
  class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
  h.api = new Function('rollbackRecords', 'HttpError', 'inventory', 'notBrainsSpark', 'restartJob', 'run', 'nodeById', 'ownersAsk', 'desiredWish', 'startingNow', 'savedRunReceipts', `${checked}\n${room}\nreturn {restartChecked,restartRoom};`)(
    () => h.records, HttpError, async () => ({ sparks: [{ id: 'spark3', deployments: [dep] }], library: [{ name: 'loading' }] }),
    () => {}, () => { h.called.push('start'); return {}; }, async () => { h.called.push('run'); throw new Error('Unexpected mutation'); }, id => ({ id }), () => h.owner, keys => { if (h.failWish) throw new Error('strict wish save failed'); h.wishes.push(keys); }, (names, where) => { assert.deepEqual(names, ['loading']); assert.deepEqual(where, ['spark3']); return h.starting; }, op => h.persisted.push({ id: op.id, ownersWish: op.ownersWish }));
  return h;
}
test('an already-running model returns without a restart despite its own unanswered loading command', async () => {
  const h = fixture('running'); assert.equal(await h.api.restartChecked({}, {}, 'spark3', 'sc-loading'), null); assert.deepEqual(h.called, []);
});
test('a stopped model with an unanswered command is refused before any actual restart', async () => {
  const h = fixture('exited'); await assert.rejects(h.api.restartChecked({}, {}, 'spark3', 'sc-loading'), e => e.status === 409 && /unanswered command/.test(e.message)); assert.deepEqual(h.called, []);
});
test('the room check inside the claimed restart still refuses a newly unanswered command', async () => {
  const h = fixture('exited'); await assert.rejects(h.api.restartRoom({}, 'spark3', 'sc-loading', 'loading'), e => e.status === 409 && /unanswered command/.test(e.message)); assert.deepEqual(h.called, []);
});

test('an owner restart records its strict wish even before the pending start has ranHere receipts', async () => {
  const h = fixture('running'); h.starting = { id: '123456789abc', status: 'running', type: 'deploy', node: 'spark3', model: 'loading' };
  assert.equal(await h.api.restartChecked({}, {}, 'spark3', 'sc-loading'), null);
  assert.equal(h.starting.ownersWish, undefined, 'only the exact source-record handoff may grant receipt immunity');
  assert.deepEqual(h.wishes, [['spark3/sc-loading']]); assert.deepEqual(h.persisted, []); assert.deepEqual(h.called, []);
});
test('a strict wish-save failure cannot mark a pending start adopted', async () => {
  const h = fixture('running'); h.failWish = true; h.starting = { id: '123456789abc' };
  await assert.rejects(h.api.restartChecked({}, {}, 'spark3', 'sc-loading'), /strict wish save failed/);
  assert.equal(h.starting.ownersWish, undefined); assert.deepEqual(h.persisted, []); assert.deepEqual(h.called, []);
});
test('a non-owner already-running lookup gives no new cleanup immunity', async () => {
  const h = fixture('running'); h.owner = false; h.starting = { id: '123456789abc' };
  assert.equal(await h.api.restartChecked({}, {}, 'spark3', 'sc-loading'), null);
  assert.equal(h.starting.ownersWish, undefined); assert.deepEqual(h.wishes, []); assert.deepEqual(h.persisted, []);
});
