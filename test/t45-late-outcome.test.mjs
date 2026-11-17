// Covers: bounded late-outcome reconciliation keeps the 120-second caller timeout and requires inactive fenced
// producers. Only uncertain stops of exact proven new IDs can be disposed by successful stop/remove receipts;
// original IDs, other actions, missing identity, failed removal and owner adoption stay held without restoration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { randomBytes } from 'node:crypto';
const source = readFileSync(new URL('../service/src/17-rollback-target.mjs', import.meta.url), 'utf8');
const OP = '123456789abc', ATTEMPT = 'aaaaaaaaaaaa', CREATE = 'bbbbbbbbbbbb', STOP = 'cccccccccccc';
const NEW = 'd'.repeat(64), OLD = 'e'.repeat(64), AT = '2026-11-17T00:00:00.000Z';
const clone = x => structuredClone(x);
const seen = () => ({ id: NEW, name: 'sc-new', startedAt: AT, state: 'running', labels: { 'spark.operation': OP, 'spark.attempt': ATTEMPT, 'spark.command': CREATE } });
function record() {
  return { operation: OP, phase: 'returning', targets: ['spark3'], units: [{ members: [{ spark: 'spark3', original: { id: OLD, startedAt: AT } }] }],
    attempts: [{ id: ATTEMPT, commands: [
      { id: CREATE, spark: 'spark3', name: 'sc-new', action: 'run', expected: null, result: { terminal: true, code: 0, boot: 'boot', seen: seen() } },
      { id: STOP, spark: 'spark3', name: 'sc-new', action: 'stop', expected: { id: NEW, startedAt: AT }, result: { terminal: false, code: 1, boot: 'boot' } },
    ] }] };
}
function harness(initial = record(), options = {}) {
  let state = clone(initial), now = 0, container = seen();
  const commands = [], looks = [], receipts = new Map(initial.attempts.flatMap(a => a.commands.map(c => [c.id, clone(c.result)])));
  const later = new Map();
  const env = {
    Date: class extends Date { static now() { return now; } }, randomBytes, Buffer, console,
    rollbackRead: () => clone(state), rollbackWrite: r => { state = clone(r); },
    rollbackSame: (a, b) => !!a && !!b && a.id === b.id && a.startedAt === b.startedAt,
    STOPPED_STATES: ['created', 'exited', 'dead', 'missing'],
    ENGINE_CHECK_NAME: 'spark-console-engine-check',
    sleep: async ms => { now += ms; }, jobNotReal: () => new Error('bad job folder'),
    rollbackAttempt: async job => {
      options.onAttempt?.(state);
      if (job.rollbackAttempt) return state.attempts.find(a => a.id === job.rollbackAttempt);
      const a = { id: randomBytes(6).toString('hex'), commands: [], boots: {} };
      state.attempts.push(a); job.rollbackAttempt = a.id; return clone(a);
    },
  };
  runInNewContext(source + '\nglobalThis.api = {rollbackReconcile,rollbackFence,rollbackStopCreated,rollbackStopDisposed,rollbackRun,rollbackStopNew};', env);
  const result = id => later.has(id) && now >= later.get(id).at ? clone(later.get(id).result) : clone(receipts.get(id));
  env.rollbackTarget = async (spark, p) => {
    if (p.mode === 'look') {
      looks.push(p.name); options.onLook?.(state);
      if (options.missing) return { seen: null };
      return { seen: container && (p.name === container.id || p.name === container.name) ? clone(options.lookChange ? options.lookChange(clone(container)) : container) : null };
    }
    if (p.mode === 'fence') {
      const active = options.active || p.commands.some(id => later.has(id) && now < later.get(id).at);
      if (active) return { active: true, boot: 'boot' };
      return { active: false, fenced: true, boot: 'boot', results: Object.fromEntries(p.commands.map(id => [id,
        options.missingReceipt === id ? { terminal: false, boot: 'boot' } : result(id) || { terminal: false, boot: 'boot' }])) };
    }
    if (p.mode === 'receipt') return { result: result(p.command) || null, boot: 'boot' };
    assert.equal(p.mode, 'dispatch'); commands.push(clone(p));
    if (p.action === 'run' && options.lateCreate) {
      const created = { ...seen(), labels: { 'spark.operation': p.operation, 'spark.attempt': p.attempt, 'spark.command': p.command } };
      container = created;
      later.set(p.command, { at: now + 150000, result: { terminal: true, code: 1, boot: 'boot', seen: created } });
    } else {
      assert.equal(p.expected.id, NEW, 'every disposal command is addressed to the full new ID');
      assert.equal(p.expected.startedAt, AT);
      if (p.action === 'stop') {
        if (options.failStop) receipts.set(p.command, { terminal: false, code: 1, boot: 'boot' });
        else { container.state = 'exited'; receipts.set(p.command, { terminal: true, code: 0, boot: 'boot', seen: clone(container) }); }
      } else {
        assert.equal(p.action, 'remove');
        if (options.failRemove) receipts.set(p.command, { terminal: options.failRemove === 'refused', code: 1, boot: 'boot' });
        else { container = null; receipts.set(p.command, { terminal: true, code: 0, boot: 'boot', seen: null, ...(options.removeFlags || {}) }); }
      }
    }
    return { dispatched: true, boot: 'boot' };
  };
  return { api: env.api, commands, looks, now: () => now, state: () => clone(state), job: { id: OP, rollbackOperation: OP },
    change: fn => fn(state), container: () => clone(container) };
}

test('a late exact create receipt is reconciled without changing the caller’s 120-second timeout or replaying the create', async () => {
  const r = record(); r.attempts = [];
  const h = harness(r, { lateCreate: true });
  const out = await h.api.rollbackRun(h.job, 'spark3', 'sc-new', () => 'fixed model script');
  assert.equal(out.code, 124); assert.equal(out.err, '(timed out)');
  assert.ok(h.now() >= 120000 && h.now() < 122000, h.now());
  assert.equal(await h.api.rollbackReconcile(h.job, 'spark3'), true);
  assert.ok(h.now() >= 150000 && h.now() < 152000, h.now());
  assert.deepEqual(h.commands.map(c => c.action), ['run']);
  const receipt = h.state().attempts.flatMap(a => a.commands)[0].result;
  assert.equal(receipt.terminal, true); assert.equal(receipt.code, 1, 'the failed client remains failed');
});

test('a fenced unknown stop is disposed by fresh exact-ID stop and removal; its original receipt stays nonterminal', async () => {
  const h = harness();
  assert.equal(await h.api.rollbackFence(h.state(), 'spark3'), false);
  assert.equal(await h.api.rollbackReconcile(h.job, 'spark3'), true);
  assert.deepEqual(h.commands.map(c => c.action), ['stop', 'remove']);
  assert.equal(h.job.rollbackAttempt, undefined, 'restoration must use a fresh attempt after disposal was fenced');
  assert.ok(h.commands.every(c => c.attempt !== ATTEMPT));
  assert.deepEqual(h.looks, [NEW]); assert.equal(h.container(), null);
  const r = h.state(), old = r.attempts[0].commands[1];
  assert.equal(old.result.terminal, false, 'positive disposal never rewrites the uncertain receipt');
  assert.equal(h.api.rollbackStopDisposed(r, 'spark3', old), true);
  assert.equal(await h.api.rollbackFence(r, 'spark3'), true);
  assert.ok(!h.commands.some(c => c.action === 'start'), 'this helper never restores or starts work');
});

for (const [name, damage] of [
  ['an original ID', r => { r.units[0].members[0].original.id = NEW; }],
  ['a different expected ID', r => { r.attempts[0].commands[1].expected.id = 'f'.repeat(64); }],
  ['a short expected ID', r => { r.attempts[0].commands[1].expected.id = NEW.slice(0, 12); }],
  ['a changed start identity', r => { r.attempts[0].commands[1].expected.startedAt = 'later'; }],
  ['a mismatched operation label', r => { r.attempts[0].commands[0].result.seen.labels['spark.operation'] = '111111111111'; }],
  ['a mismatched attempt label', r => { r.attempts[0].commands[0].result.seen.labels['spark.attempt'] = '111111111111'; }],
  ['a mismatched command label', r => { r.attempts[0].commands[0].result.seen.labels['spark.command'] = '111111111111'; }],
  ['an unproved create', r => { r.attempts[0].commands[0].result.terminal = false; }],
  ['a create without an identity receipt', r => { delete r.attempts[0].commands[0].result.seen; }],
  ['an adopted failed container', r => { r.wishes = ['spark3/sc-new']; }],
  ...['run', 'start', 'rename', 'remove'].map(action => [`an unresolved ${action}`, r => { r.attempts[0].commands[1].action = action; }]),
]) test(`${name} cannot authorize disposal or restoration`, async () => {
  const r = record(); damage(r); const h = harness(r);
  assert.equal(await h.api.rollbackReconcile(h.job, 'spark3'), false);
  assert.deepEqual(h.commands, []);
});

for (const [name, options] of [
  ['an active producer', { active: true }],
  ['no create receipt', { missingReceipt: CREATE }],
  ['an absent container with no removal receipt', { missing: true }],
  ['a reused name with a different ID', { lookChange: s => ({ ...s, id: 'f'.repeat(64) }) }],
  ['a newer start of the same ID', { lookChange: s => ({ ...s, startedAt: 'later' }) }],
  ['changed live labels', { lookChange: s => ({ ...s, labels: {} }) }],
  ['an owner adoption during the look', { onLook: r => { r.wishes = ['spark3/sc-new']; } }],
]) test(`${name} stays held before any disposal command`, async () => {
  const h = harness(record(), options);
  assert.equal(await h.api.rollbackReconcile(h.job, 'spark3'), false);
  assert.deepEqual(h.commands, []); assert.ok(h.now() <= 90000);
});

for (const [name, options] of [
  ['an unproved stop', { failStop: true }],
  ['an unproved removal', { failRemove: 'unknown' }],
  ['a refused removal', { failRemove: 'refused' }],
  ['a removal that was not issued', { removeFlags: { notIssued: true } }],
  ['an absence report instead of a removal', { removeFlags: { missing: true } }],
]) test(`${name} does not settle the old stop`, async () => {
  const h = harness(record(), options);
  assert.equal(await h.api.rollbackReconcile(h.job, 'spark3'), false);
  assert.equal(await h.api.rollbackFence(h.state(), 'spark3'), false);
  assert.equal(h.state().attempts[0].commands[1].result.terminal, false);
});

test('an already terminal attempt returns immediately without the reconciliation delay or another mutation', async () => {
  const r = record(); r.attempts[0].commands[1].result = { terminal: true, code: 0, boot: 'boot', seen: { ...seen(), state: 'exited' } };
  const h = harness(r); assert.equal(await h.api.rollbackReconcile(h.job, 'spark3'), true);
  assert.equal(h.now(), 0); assert.deepEqual(h.commands, []);
});


test('an unanswered stop reports a reachable exact target as still running without settling its receipt', async () => {
  const h = harness(record(), { failStop: true });
  assert.equal(await h.api.rollbackStopNew(h.job, 'spark3', 'sc-new'), 'running');
  assert.deepEqual(h.looks, ['sc-new', NEW]);
  assert.deepEqual(h.commands.map(c => c.action), ['stop']);
  assert.equal(await h.api.rollbackFence(h.state(), 'spark3'), false);
});
for (const [name, change] of [
  ['missing', () => null], ['stopped', s => ({ ...s, state: 'exited' })],
  ['restarted', s => ({ ...s, startedAt: 'later' })], ['renamed', s => ({ ...s, name: 'someone-else' })],
]) test(`a ${name} follow-up look cannot settle an unanswered stop`, async () => {
  let looks = 0;
  const h = harness(record(), { failStop: true, lookChange: s => ++looks === 1 ? s : change(s) });
  assert.equal(await h.api.rollbackStopNew(h.job, 'spark3', 'sc-new'), 'unknown');
  assert.equal(await h.api.rollbackFence(h.state(), 'spark3'), false);
});


for (const [name, options] of [
  ['during the Docker look', { onLook: r => { r.wishes = ['spark3/sc-new']; } }],
  ['before dispatch', { onAttempt: r => { r.wishes = ['spark3/sc-new']; } }],
]) test(`a newer owner adoption ${name} prevents the cluster cleanup stop`, async () => {
  const h = harness(record(), options);
  assert.equal(await h.api.rollbackStopNew(h.job, 'spark3', 'sc-new'), 'unknown');
  assert.deepEqual(h.commands, []); assert.equal(h.container().state, 'running');
});
for (const [name, change] of [
  ['another ID', s => ({ ...s, id: 'f'.repeat(64) })],
  ['another start', s => ({ ...s, startedAt: 'later' })],
]) test(`cluster cleanup leaves ${name} alone even when it has the earlier labels`, async () => {
  const h = harness(record(), { lookChange: change });
  assert.equal(await h.api.rollbackStopNew(h.job, 'spark3', 'sc-new'), 'unknown');
  assert.deepEqual(h.commands, []);
});
