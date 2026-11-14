// Healing never works against the owner (the wrong-as-wired audit, 2026-11-11):
// - bringing a model back never stops anything else: if the owner started another model where a two-Spark model used to
//   run, that model keeps running and the older one is held, with the reason (before, a bring-back could stop it);
// - during the automatic pause (three failed operations in a row, or too many changes in an hour) self-healing goes on:
//   its restart job no longer fails at its first line with "agents' changes are paused". The owner's own pause still
//   stops it (heal.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, call, createKey, createActKey, agentSettings, waitFor, SLOW } from './lib.mjs';

const keys = {};
const MODEL = 'RadixArk--Qwen3.8-27B-NVFP4', HEAD = `sc-${MODEL}`, OTHER = 'sc-gpt-oss-20b';
const DFLASH = ['--context-length', '1000000', '--speculative-algorithm', 'DFLASH', '--speculative-num-draft-tokens', '16', '--tp-size', '1', '--mem-fraction-static', '0.8'];
const brainRun = { key: JSON.stringify([MODEL, 'sglang', 'lmsysorg/sglang:v0.5.23', 1, DFLASH, {}]), model: MODEL, repo: 'RadixArk/Qwen3.8-27B-NVFP4',
  title: 'Qwen 3.8 27B', engine: 'sglang', image: 'lmsysorg/sglang:v0.5.23', args: DFLASH, env: {},
  sparks: 1, nodes: ['spark2'], firstAt: '2026-11-08T00:00:00Z', lastAt: '2026-11-08T00:00:00Z', runs: 1, best: { decodeTokS: 30, ttftMs: 100 }, brain: true };
useFleet({ watchMs: 2000, statusMs: 3000,
  env: { SPARK_CONSOLE_HEAL_MS: '2000', SPARK_CONSOLE_HEAL_SETTLE_MS: '3000', SPARK_CONSOLE_HEAL_OFFLINE_MS: '1000', SPARK_CONSOLE_HEAL_MIN_RUN_MS: '60000',
    SPARK_CONSOLE_CONNECT_MS: String(20000 * SLOW) },
  prepare: ({ stateDir }) => writeFileSync(join(stateDir, 'verified.json'), JSON.stringify({ deployments: [brainRun] }), { mode: 0o600 }),
}, async () => { keys.look = await createKey('heal-newer'); keys.act = await createActKey('heal-newer-act'); });

const mock = (spark, file) => join(T.fleet.root, spark, '.mock', file);
const lines = spark => readFileSync(mock(spark, 'containers'), 'utf8').split('\n').filter(Boolean);
const stateOf = (spark, name) => lines(spark).find(l => l.startsWith(`${name}|`))?.split('|')[1];
const partsOf = () => ['spark3', 'spark4'].flatMap(sp => lines(sp).filter(l => l.split('|')[4] === MODEL && l.split('|')[7] === 'spark3+spark4').map(l => ({ spark: sp, name: l.split('|')[0], state: l.split('|')[1] })));
function crash(spark, name, status = 'Exited (1) just now') {
  const f = mock(spark, 'containers');
  writeFileSync(f, readFileSync(f, 'utf8').replace(new RegExp(`^(${name.replace(/[.+]/g, '\\$&')})\\|running\\|[^|]*\\|`, 'm'), `$1|exited|${status}|`));
  rmSync(mock(spark, `up-${name}`), { force: true });
}
// (a refused call says why: gate, 2026-11-13, the door's 120 calls a minute turned a slow wait into "Cannot read
// properties of undefined")
const eventsSince = async since => {
  const r = await call(keys.look.token, 'fleet_events', { since, limit: 200 });
  if (!Array.isArray(r.value?.events)) throw new Error(`fleet_events was refused: ${r.text ?? r.json?.error?.message ?? r.raw}`);
  return r.value.events;
};
const operations = async () => (await call(keys.look.token, 'recent_operations', { limit: 30 })).value.operations;
async function finished(id) {
  for (const until = Date.now() + 240000 * SLOW; ;) {
    const w = (await call(keys.look.token, 'wait_operation', { id, seconds: 30 })).value;
    if (w.status !== 'running') return w;
    assert.ok(Date.now() < until, 'still running');
  }
}
const seenRunning = (spark, name) => waitFor(async () => (await call(keys.look.token, 'workloads', { spark })).value.workloads.some(w => w.name === name && w.running), { timeout: 60000, what: `the watcher seeing ${spark}/${name} running` });

test('(the owner starts a model across Spark 3 and Spark 4)', { timeout: 300000 * SLOW }, async () => {
  const r = await call(keys.act.token, 'start_model', { model: MODEL, sparks: ['spark3', 'spark4'] });
  assert.equal(r.isError, false, r.text);
  assert.equal((await finished(r.value.operation)).status, 'completed');
  assert.deepEqual(partsOf().map(p => p.state), ['running', 'running']);
});

test('bringing the pair back never stops a model the owner started there since: it is held, with why', { timeout: 300000 * SLOW }, async () => {
  for (const p of partsOf()) await seenRunning(p.spark, p.name);
  // Both parts go down while healing is off, and the owner starts another model on Spark 3.
  await agentSettings({ selfHeal: false });
  for (const p of partsOf()) crash(p.spark, p.name);
  const r = await call(keys.act.token, 'start_model', { model: 'gpt-oss-20b', spark: 'spark3' });
  assert.equal(r.isError, false, r.text);
  assert.equal((await finished(r.value.operation)).status, 'completed');
  assert.equal(stateOf('spark3', OTHER), 'running');
  const since = new Date().toISOString();
  await agentSettings({ selfHeal: true });
  const skipped = await waitFor(async () => (await eventsSince(since)).find(e => e.type === 'heal-skipped' && e.container === HEAD), { timeout: 90000, what: 'the bring-back being held' });
  assert.match(skipped.why, /self-healing never stops anything else to bring something back/, skipped.why);
  // Nothing was stopped or started for it: the owner's newer model still runs, the pair stays down.
  assert.ok(!(await operations()).some(o => o.actor === 'Self-healing' && o.startedAt > since), 'no operation by Self-healing');
  assert.equal(stateOf('spark3', OTHER), 'running');
  assert.deepEqual(partsOf().map(p => p.state), ['exited', 'exited']);
});

test('during the automatic pause, a crashed model is still restarted (only the owner\'s own pause stops healing)', { timeout: 240000 * SLOW }, async t => {
  await seenRunning('spark3', OTHER);
  // The automatic pause, as three failed operations in a row leave it.
  const file = join(T.fleet.stateDir, 'agent-settings.json');
  writeFileSync(file, JSON.stringify({ halted: true, autoPaused: true, selfHeal: true }), { mode: 0o600 });
  t.after(() => writeFileSync(file, JSON.stringify({ halted: false, selfHeal: true }), { mode: 0o600 }));
  const since = new Date().toISOString();
  crash('spark3', OTHER);
  // (on a miss, what happened there since: gate, 2026-11-13, a run that missed said only "timed out")
  // (asked every 2 s, so a long wait stays under the door's 120 calls a minute and ends with what happened)
  let seen = [];
  await waitFor(async () => (seen = await eventsSince(since)).some(e => e.type === 'healing' && e.container === OTHER), { timeout: 90000, every: 2000, what: 'self-healing starting it again' })
    .catch(e => { throw new Error(`${e.message}; on spark3 since: ${JSON.stringify(seen.filter(x => x.spark === 'spark3').slice(-12))}`); });
  const op = await waitFor(async () => (await operations()).find(o => o.type === 'restart' && o.container === OTHER && o.startedAt > since), { timeout: 60000, what: 'the restart' });
  const w = await finished(op.id);
  assert.equal(w.status, 'completed', JSON.stringify(w));
  assert.equal(stateOf('spark3', OTHER), 'running');
});
