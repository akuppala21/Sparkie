// Self-healing brings back only the newest model the owner wants on a Spark (gate, 2026-11-13). A two-Spark model was
// down, and the owner had started another model on one of its Sparks since. When that newer model went down too, two
// healers raced for the Spark: the watcher restarting the newer one, and the healing pass bringing the older pair back.
// When the pass won, the pair started in the newer model's place and the newer one stayed down. Now an entry with a
// newer model on the list for one of its Sparks stays down while that newer one is on the list, running or down. A
// start by the owner's own hand makes an entry the newest again, so it is healed as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, call, createKey, createActKey, agentSettings, waitFor, sleep, SLOW } from './lib.mjs';

const keys = {};
const MODEL = 'RadixArk--Qwen3.8-27B-NVFP4', HEAD = `sc-${MODEL}`, OTHER = 'sc-gpt-oss-20b';
const DFLASH = ['--context-length', '1000000', '--speculative-algorithm', 'DFLASH', '--speculative-num-draft-tokens', '16', '--tp-size', '1', '--mem-fraction-static', '0.8'];
const brainRun = { key: JSON.stringify([MODEL, 'sglang', 'lmsysorg/sglang:v0.5.23', 1, DFLASH, {}]), model: MODEL, repo: 'RadixArk/Qwen3.8-27B-NVFP4',
  title: 'Qwen 3.8 27B', engine: 'sglang', image: 'lmsysorg/sglang:v0.5.23', args: DFLASH, env: {},
  sparks: 1, nodes: ['spark2'], firstAt: '2026-11-08T00:00:00Z', lastAt: '2026-11-08T00:00:00Z', runs: 1, best: { decodeTokS: 30, ttftMs: 100 }, brain: true };
// (the parts get a minute to connect whatever SLOW is: with other test files running beside this one on a fast machine,
// 20 s was once too short and the bring-back's start failed; nothing here tests that limit)
useFleet({ watchMs: 2000, statusMs: 3000,
  env: { SPARK_CONSOLE_HEAL_MS: '2000', SPARK_CONSOLE_HEAL_SETTLE_MS: '3000', SPARK_CONSOLE_HEAL_OFFLINE_MS: '1000', SPARK_CONSOLE_HEAL_MIN_RUN_MS: '60000',
    SPARK_CONSOLE_CONNECT_MS: String(20000 * Math.max(SLOW, 3)) },
  prepare: ({ stateDir }) => writeFileSync(join(stateDir, 'verified.json'), JSON.stringify({ deployments: [brainRun] }), { mode: 0o600 }),
}, async () => { keys.look = await createKey('heal-displaced'); keys.act = await createActKey('heal-displaced-act'); });

const mock = (spark, file) => join(T.fleet.root, spark, '.mock', file);
const lines = spark => readFileSync(mock(spark, 'containers'), 'utf8').split('\n').filter(Boolean);
const stateOf = (spark, name) => lines(spark).find(l => l.startsWith(`${name}|`))?.split('|')[1];
const partsOf = () => ['spark3', 'spark4'].flatMap(sp => lines(sp).filter(l => l.split('|')[4] === MODEL && l.split('|')[7] === 'spark3+spark4').map(l => ({ spark: sp, name: l.split('|')[0], state: l.split('|')[1] })));
function crash(spark, name, status = 'Exited (1) just now') {
  const f = mock(spark, 'containers');
  writeFileSync(f, readFileSync(f, 'utf8').replace(new RegExp(`^(${name.replace(/[.+]/g, '\\$&')})\\|running\\|[^|]*\\|`, 'm'), `$1|exited|${status}|`));
  rmSync(mock(spark, `up-${name}`), { force: true });
}
// (asked once a second at most: the door allows an agent 120 calls a minute)
async function look(name, args) {
  const r = await call(keys.look.token, name, args);
  assert.equal(r.isError, false, `${name}: ${r.text ?? r.raw}`);
  return r.value;
}
const eventsSince = async since => (await look('fleet_events', { since, limit: 200 })).events;
const operations = async () => (await look('recent_operations', { limit: 30 })).operations;
async function finished(id) {
  for (const until = Date.now() + 240000 * SLOW; ;) {
    const w = await look('wait_operation', { id, seconds: 30 });
    if (w.status !== 'running') return w;
    assert.ok(Date.now() < until, 'still running');
  }
}
const watcherSees = (spark, name, running) => waitFor(async () => (await look('workloads', { spark })).workloads.some(w => w.name === name && Boolean(w.running) === running),
  { timeout: 60000, every: 1000, what: `the watcher seeing ${spark}/${name} ${running ? 'running' : 'stopped'}` });
async function startPair() {
  const r = await call(keys.act.token, 'start_model', { model: MODEL, sparks: ['spark3', 'spark4'] });
  assert.equal(r.isError, false, r.text);
  assert.equal((await finished(r.value.operation)).status, 'completed');
  assert.deepEqual(partsOf().map(p => p.state), ['running', 'running']);
}

test('(the owner starts a model across Spark 3 and Spark 4)', { timeout: 300000 * SLOW }, startPair);

test('an older pair is not brought back in place of the newer model the owner started on its Spark, even while that one is down', { timeout: 400000 * SLOW }, async () => {
  for (const p of partsOf()) await watcherSees(p.spark, p.name, true);
  // With healing off: the pair goes down, the owner starts another model on Spark 3, and that one goes down too.
  await agentSettings({ selfHeal: false });
  for (const p of partsOf()) crash(p.spark, p.name);
  const r = await call(keys.act.token, 'start_model', { model: 'gpt-oss-20b', spark: 'spark3' });
  assert.equal(r.isError, false, r.text);
  assert.equal((await finished(r.value.operation)).status, 'completed');
  await watcherSees('spark3', OTHER, true);
  crash('spark3', OTHER);
  await watcherSees('spark3', OTHER, false);
  // Healing on: the first thing self-healing says about the pair is why it waits. Nothing starts.
  const since = new Date().toISOString();
  await agentSettings({ selfHeal: true });
  const first = await waitFor(async () => (await eventsSince(since)).find(e => e.container === HEAD && (e.type === 'healing' || e.type === 'heal-skipped')),
    { timeout: 60000, every: 1000, what: 'self-healing looking at the pair' });
  assert.equal(first.type, 'heal-skipped', JSON.stringify(first));
  assert.match(first.why, /gpt-oss-20b was started on Spark 3 after it, so it stays down while that one is wanted there: self-healing never stops anything else to bring something back/, first.why);
  // (three more passes, and more on a slow machine)
  await sleep(7000 * SLOW);
  assert.ok(!(await operations()).some(o => o.actor === 'Self-healing' && o.startedAt > since), 'no operation by Self-healing');
  assert.ok(!(await eventsSince(since)).some(e => e.type === 'healing'), 'nothing was brought back');
  assert.deepEqual(partsOf().map(p => p.state), ['exited', 'exited']);
  assert.equal(stateOf('spark3', OTHER), 'exited');
});

test('started again by the owner, the pair is the newest there: a part that stops is brought back as before', { timeout: 400000 * SLOW }, async () => {
  // The owner's own start of the pair (the other model is still on the list, down).
  await startPair();
  for (const p of partsOf()) await watcherSees(p.spark, p.name, true);
  const since = new Date().toISOString();
  const part = partsOf().find(p => p.spark === 'spark4');
  crash(part.spark, part.name);
  const healing = await waitFor(async () => (await eventsSince(since)).find(e => e.container === HEAD && (e.type === 'healing' || e.type === 'heal-skipped')),
    { timeout: 90000, every: 1000, what: 'self-healing looking at the pair' });
  assert.equal(healing.type, 'healing', JSON.stringify(healing));
  assert.match(healing.why, /^a part stopped/, healing.why);
  const op = await waitFor(async () => (await operations()).find(o => o.actor === 'Self-healing' && o.startedAt > since), { timeout: 60000, every: 1000, what: 'the bring-back' });
  assert.equal((await finished(op.id)).status, 'completed');
  assert.deepEqual(partsOf().map(p => p.state), ['running', 'running']);
});
