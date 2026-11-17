// Covers: owner-visible recovery words preserve exact owed work separately from persistent follow-up guidance.
// An originally stopped copy is preserved without describing its replacement as a newly displaced running copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const rollback = readFileSync(new URL('../service/src/17-rollback.mjs', import.meta.url), 'utf8');
const resultSource = rollback.slice(rollback.indexOf('function rollbackResult('), rollback.indexOf('async function rollbackReturn('));
const stop = readFileSync(new URL('../service/src/17-stop-checked.mjs', import.meta.url), 'utf8');
const words = stop.slice(stop.indexOf('function owedWords('), stop.indexOf('// A failed start'));
function result(wasRunning, extraCommands = [], reverse = false) {
  const logs = [], job = {}, record = { blocked: ['spark4'], attempts: [{ commands: [{ action: 'run', spark: 'spark4', name: 'sc-new' }, ...extraCommands] }],
    units: [{ members: [{ spark: 'spark4', container: 'gpu-hold', state: 'waiting', wasRunning: true },
      { spark: 'spark4', container: 'sc-new', state: 'waiting', wasRunning, asideUsed: true, aside: 'sc-new-before-op' }] }] };
  if (reverse) record.units[0].members.reverse();
  const call = new Function('rollbackKey', 'backUnits', 'nodeById', 'sparkName', 'note', `${words}\n${resultSource}\nreturn rollbackResult;`)(
    m => `${m.spark}/${m.container}`, () => [], id => ({ id }), () => 'Spark 4', (_, line) => logs.push(line));
  call(job, record); return { job, logs };
}
test('an originally stopped preserved copy does not change the exact running-work debt sentence', () => {
  const { job, logs } = result(false);
  const owed = 'gpu-hold wasn’t started again on Spark 4: sc-new may still be running there (Spark Console couldn’t confirm it stopped). Stop it there, then start gpu-hold again';
  assert.equal(job.cleanUp.split('\n')[0], `${owed}.`); assert.ok(logs.includes(owed));
  assert.equal(job.cleanUp, `${owed}.`, 'the exact owed work stays the cancel and error text');
  assert.ok(logs.some(line => /^Earlier work still needs putting back/.test(line)), 'persistent recovery guidance stays in its own log line');
  assert.deepEqual(job.stoppedHere, ['spark4/gpu-hold']);
  assert.deepEqual(job.asideHere, [{ node: 'spark4', name: 'sc-new', aside: 'sc-new-before-op' }], 'the stopped original still remains recorded');
});
test('a formerly running copy still distinguishes the new container and names the preserved aside', () => {
  const { job } = result(true);
  assert.match(job.cleanUp.split('\n')[0], /sc-new \(there as sc-new-before-op\)/);
  assert.match(job.cleanUp.split('\n')[0], /the new sc-new may still be running/);
});

const CREATED = 'a'.repeat(64), engineRun = () => ({ action: 'run', spark: 'spark4', name: 'spark-console-engine-check', result: { seen: { id: CREATED } } });
const engineRemove = () => ({ action: 'remove', spark: 'spark4', name: 'spark-console-engine-check', expected: { id: CREATED }, result: { terminal: true, code: 0, seen: null } });
test('a proved exact-ID removal keeps the engine check out of still-running words without hiding other work', () => {
  const { job, logs } = result(false, [engineRun(), engineRemove()]);
  assert.deepEqual(job.ranHere, ['spark4/sc-new']);
  assert.ok(!job.cleanUp.includes('spark-console-engine-check'));
  assert.ok(logs.some(line => line.includes('sc-new may still be running')));
});
for (const [label, damage] of [
  ['different ID', r => { r.expected.id = 'b'.repeat(64); }],
  ['nonterminal receipt', r => { r.result.terminal = false; }],
  ['failed remove', r => { r.result.code = 1; }],
  ['missing post-remove look', r => { delete r.result.seen; }],
  ['container still seen', r => { r.result.seen = { id: CREATED, state: 'running' }; }],
]) test(`an engine check remains in the warning with ${label}`, () => {
  const removal = engineRemove(); damage(removal);
  const { job } = result(false, [engineRun(), removal]);
  assert.ok(job.ranHere.includes('spark4/spark-console-engine-check'));
  assert.ok(job.cleanUp.includes('spark-console-engine-check'));
});

function refusalReport({ terminal = true, code = 1, id = 'original', state = 'exited', changed = false, blocked = [], newer = false } = {}) {
  const logs = [], job = {}, member = { spark: 'spark4', container: 'gpu-hold', state: 'waiting', wasRunning: true, original: { id: 'original' } };
  const command = { action: 'start', spark: 'spark4', name: 'gpu-hold', expected: { id: 'original' }, result: { terminal, code, changed, seen: { id, state } } };
  const commands = newer ? [command, { ...command, result: { terminal: false } }] : [command];
  const record = { blocked, attempts: [{ commands }], units: [{ members: [member] }] };
  const call = new Function('rollbackKey', 'backUnits', 'nodeById', 'sparkName', 'note', `${words}\n${resultSource}\nreturn rollbackResult;`)(
    m => `${m.spark}/${m.container}`, () => [], id => ({ id }), () => 'Spark 4', (_, line) => logs.push(line));
  call(job, record); return { job, logs };
}
test('a terminal refused exact-ID restoration names the stopped original without claiming put-back succeeded', () => {
  const { job, logs } = refusalReport();
  assert.equal(job.cleanUp, 'gpu-hold couldn’t be started again on Spark 4; start it from Spark Console.');
  assert.deepEqual(job.stoppedHere, ['spark4/gpu-hold']);
  assert.deepEqual(job.ranHere, []);
  assert.ok(logs.some(line => /^Earlier work still needs putting back/.test(line)));
});
for (const [name, options] of [
  ['nonterminal receipt', { terminal: false }], ['different original', { id: 'other' }],
  ['running original', { state: 'running' }], ['unanswered target', { blocked: ['spark4'] }],
  ['changed identity', { changed: true }], ['newer uncertain start', { newer: true }], ['successful start', { code: 0 }],
]) test(`restoration words do not claim a proven refusal with ${name}`, () => {
  const { job } = refusalReport(options);
  assert.match(job.cleanUp, /^Earlier work still needs putting back/);
  assert.doesNotMatch(job.cleanUp, /couldn’t be started again|start it from/);
});

test('owed-work words keep independently stopped jobs before preserved copies regardless of record order', () => {
  const { job } = result(true, [], true);
  assert.equal(job.cleanUp, 'gpu-hold and sc-new (there as sc-new-before-op) weren’t started again on Spark 4: the new sc-new may still be running there (Spark Console couldn’t confirm it stopped). Stop it there, then start gpu-hold and sc-new again.');
  assert.deepEqual(job.stoppedHere, ['spark4/gpu-hold', 'spark4/sc-new']);
});


test('completed restoration removes an earlier cleanup warning and leaves no cleanup field in the API result', () => {
  const logs = [], job = { cleanUp: 'Earlier work still needs putting back.' };
  const call = new Function('rollbackKey', 'backUnits', 'nodeById', 'sparkName', 'note', `${words}\n${resultSource}\nreturn rollbackResult;`)(
    m => `${m.spark}/${m.container}`, () => [], id => ({ id }), () => 'Spark 4', (_, line) => logs.push(line));
  call(job, { blocked: [], attempts: [], units: [{ members: [{ spark: 'spark4', container: 'sc-old', state: 'restored', wasRunning: true }] }] });
  assert.equal(Object.hasOwn(job, 'cleanUp'), false);
  assert.equal(JSON.parse(JSON.stringify(job)).cleanUp, undefined);
  assert.deepEqual(job.ranHere, []);
  assert.deepEqual(job.stoppedHere, []);
  assert.deepEqual(job.asideHere, []);
  assert.deepEqual(logs, []);
});
