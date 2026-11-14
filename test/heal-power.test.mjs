// Self-healing after a power-on decides from what the Sparks show now (gate, 2026-11-13). Right after the owner powers
// Sparks back on, the watcher may not have looked there yet: its last look, from before the power went, still says the
// model's parts were running. Deciding from that brought the model back at once, as "a part stopped", before the Sparks
// had settled (3 s here, 2 minutes on the Sparks) and without the "it may be what froze it" guard. Here the watcher looks
// only once, early on, so what it knows of the parts is always from before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, call, createKey, createActKey, waitFor, SLOW } from './lib.mjs';

const keys = {};
const MODEL = 'RadixArk--Qwen3.8-27B-NVFP4', HEAD = `sc-${MODEL}`;
const DFLASH = ['--context-length', '1000000', '--speculative-algorithm', 'DFLASH', '--speculative-num-draft-tokens', '16', '--tp-size', '1', '--mem-fraction-static', '0.8'];
const brainRun = { key: JSON.stringify([MODEL, 'sglang', 'lmsysorg/sglang:v0.5.23', 1, DFLASH, {}]), model: MODEL, repo: 'RadixArk/Qwen3.8-27B-NVFP4',
  title: 'Qwen 3.8 27B', engine: 'sglang', image: 'lmsysorg/sglang:v0.5.23', args: DFLASH, env: {},
  sparks: 1, nodes: ['spark2'], firstAt: '2026-11-08T00:00:00Z', lastAt: '2026-11-08T00:00:00Z', runs: 1, best: { decodeTokS: 30, ttftMs: 100 }, brain: true };
// (the parts get a minute to connect whatever SLOW is: with other test files running beside this one on a fast machine,
// 20 s was once too short and the bring-back's start failed; nothing here tests that limit)
useFleet({ watchMs: 3600000, statusMs: 3000,
  env: { SPARK_CONSOLE_HEAL_MS: '2000', SPARK_CONSOLE_HEAL_SETTLE_MS: '3000', SPARK_CONSOLE_HEAL_OFFLINE_MS: '1000', SPARK_CONSOLE_HEAL_MIN_RUN_MS: '60000',
    SPARK_CONSOLE_CONNECT_MS: String(20000 * Math.max(SLOW, 3)) },
  prepare: ({ stateDir }) => writeFileSync(join(stateDir, 'verified.json'), JSON.stringify({ deployments: [brainRun] }), { mode: 0o600 }),
}, async () => { keys.look = await createKey('heal-power'); keys.act = await createActKey('heal-power-act'); });

const mock = (spark, file) => join(T.fleet.root, spark, '.mock', file);
const lines = spark => readFileSync(mock(spark, 'containers'), 'utf8').split('\n').filter(Boolean);
const partsOf = () => ['spark3', 'spark4'].flatMap(sp => lines(sp).filter(l => l.split('|')[4] === MODEL && l.split('|')[7] === 'spark3+spark4').map(l => ({ spark: sp, name: l.split('|')[0], state: l.split('|')[1] })));
// A part stops: exited with this status ("Exited (255)" when its Spark lost power).
function stop(spark, name, status) {
  const f = mock(spark, 'containers');
  writeFileSync(f, readFileSync(f, 'utf8').replace(new RegExp(`^(${name.replace(/[.+]/g, '\\$&')})\\|running\\|[^|]*\\|`, 'm'), `$1|exited|${status}|`));
  rmSync(mock(spark, `up-${name}`), { force: true });
}
const eventsSince = async since => (await call(keys.look.token, 'fleet_events', { since, limit: 200 })).value.events;
async function finished(id) {
  for (const until = Date.now() + 240000 * SLOW; ;) {
    const w = (await call(keys.look.token, 'wait_operation', { id, seconds: 30 })).value;
    if (w.status !== 'running') return w;
    assert.ok(Date.now() < until, 'still running');
  }
}
async function offline(ids) {
  const since = new Date().toISOString();
  writeFileSync(T.fleet.offlineFile, ['spark1', ...ids].join('\n') + '\n');
  await waitFor(async () => (await eventsSince(since)).filter(e => e.type === 'spark-offline' && ids.includes(e.spark)).length === ids.length, { timeout: 40000 * SLOW, what: `${ids} going offline` });
}
// Back on; the time the last of them was seen back.
async function online(ids) {
  const since = new Date().toISOString();
  await new Promise(res => setTimeout(res, 1500));
  writeFileSync(T.fleet.offlineFile, 'spark1\n');
  const back = await waitFor(async () => { const on = (await eventsSince(since)).filter(e => e.type === 'spark-online' && ids.includes(e.spark)); return on.length === ids.length ? on : null; },
    { timeout: 40000 * SLOW, what: `${ids} coming back` });
  return Math.max(...back.map(e => Date.parse(e.at)));
}

test('(the owner starts a model across Spark 3 and Spark 4)', { timeout: 300000 * SLOW }, async () => {
  const r = await call(keys.act.token, 'start_model', { model: MODEL, sparks: ['spark3', 'spark4'] });
  assert.equal(r.isError, false, r.text);
  assert.equal((await finished(r.value.operation)).status, 'completed');
  assert.deepEqual(partsOf().map(p => p.state), ['running', 'running']);
});

test('powered off and on: it comes back as "came back on", once the Sparks have settled, from what they show now', { timeout: 300000 * SLOW }, async () => {
  await offline(['spark3', 'spark4']);
  for (const p of partsOf()) stop(p.spark, p.name, 'Exited (255) 1 minute ago');
  const since = new Date().toISOString();
  const on = await online(['spark3', 'spark4']);
  const ev = await waitFor(async () => (await eventsSince(since)).find(e => e.type === 'healing' && e.container === HEAD), { timeout: 60000 * SLOW, what: 'Self-healing bringing it back' });
  assert.match(ev.why, /^Spark 3 and Spark 4 came back on$/, JSON.stringify(ev));
  assert.ok(Date.parse(ev.at) - on >= 3000, `brought back ${Date.parse(ev.at) - on} ms after they came back, before they settled`);
  const op = await waitFor(async () => (await call(keys.look.token, 'recent_operations', { limit: 20 })).value.operations
    .find(o => o.type === 'deploy-cluster' && o.actor === 'Self-healing' && o.startedAt > since), { timeout: 60000 * SLOW, what: 'Self-healing starting it again' });
  // (on a miss, the operation itself says why)
  const done = await finished(op.id);
  assert.equal(done.status, 'completed', JSON.stringify(done).slice(0, 1500));
  assert.deepEqual(partsOf().map(p => p.state), ['running', 'running']);
});

test('down again within 30 minutes of that: held, "it may be what froze it"', { timeout: 180000 * SLOW }, async () => {
  await offline(['spark4']);
  for (const p of partsOf()) stop(p.spark, p.name, 'Exited (255) just now');
  const since = new Date().toISOString();
  await online(['spark4']);
  const skipped = await waitFor(async () => (await eventsSince(since)).find(e => e.type === 'heal-skipped' && e.container === HEAD), { timeout: 60000 * SLOW, what: 'heal-skipped' });
  assert.match(skipped.why, /may be what froze it/);
  assert.ok(!(await eventsSince(since)).some(e => e.type === 'healing' && e.container === HEAD));
  assert.deepEqual(partsOf().map(p => p.state), ['exited', 'exited']);
});
