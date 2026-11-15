// Covers: More self-healing, for a model across Spark 3 and Spark 4 (a pass every 2 s, Sparks settled after 3 s here):
// a part that crashes while its Sparks stay on: what's left stops and it starts again across both ("a part stopped");
// powered off and on, it comes back once they have settled ("came back on"); a Spark down again within 30 minutes of
// that: nothing comes back (`heal-skipped`, "may be what froze it"). Sparkie's model running but silent for 4 s is
// restarted.
//
// More self-healing (2026-11-11: "most importantly self healing and being able to fix things by itself"). Every pass
// (2 s here) of the list of what should be running: a model across two Sparks that lost a part stops what's left and
// starts again across the same Sparks; when the owner powers Sparks back on, what should run there comes back once they
// have settled (3 s here) after being off for more than 1 s here (90 s on the Sparks); and if a Spark goes down again within 30 minutes of that, it isn't brought back by itself.
// Sparkie's own model, running but silent for 4 s here (10 minutes on the Sparks), is restarted. Each one is a
// 'healing' fleet event; each refusal a 'heal-skipped' one with why.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, call, createKey, createActKey, waitFor, SLOW } from './lib.mjs';

const keys = {};
const MODEL = 'RadixArk--Qwen3.8-27B-NVFP4', HEAD = `sc-${MODEL}`;
const DFLASH = ['--context-length', '1000000', '--speculative-algorithm', 'DFLASH', '--speculative-num-draft-tokens', '16', '--tp-size', '1', '--mem-fraction-static', '0.8'];
const brainRun = { key: JSON.stringify([MODEL, 'sglang', 'lmsysorg/sglang:v0.5.23', 1, DFLASH, {}]), model: MODEL, repo: 'RadixArk/Qwen3.8-27B-NVFP4',
  title: 'Qwen 3.8 27B', engine: 'sglang', image: 'lmsysorg/sglang:v0.5.23', args: DFLASH, env: {},
  sparks: 1, nodes: ['spark2'], firstAt: '2026-11-08T00:00:00Z', lastAt: '2026-11-08T00:00:00Z', runs: 1, best: { decodeTokS: 30, ttftMs: 100 }, brain: true };
useFleet({ watchMs: 2000, statusMs: 3000,
  env: { SPARK_CONSOLE_HEAL_MS: '2000', SPARK_CONSOLE_HEAL_SETTLE_MS: '3000', SPARK_CONSOLE_HEAL_OFFLINE_MS: '1000', SPARK_CONSOLE_HEAL_MIN_RUN_MS: '60000', SPARK_CONSOLE_BRAIN_HUNG_MS: '4000',
    SPARK_CONSOLE_BRAIN_LOADING_MS: '0', SPARK_CONSOLE_CONNECT_MS: String(20000 * SLOW) },
  prepare: ({ stateDir }) => writeFileSync(join(stateDir, 'verified.json'), JSON.stringify({ deployments: [brainRun] }), { mode: 0o600 }),
}, async () => { keys.look = await createKey('heal-more'); keys.act = await createActKey('heal-more-act'); });

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
// The start Self-healing made after `since`, to its end.
async function healedStart(since) {
  const op = await waitFor(async () => (await call(keys.look.token, 'recent_operations', { limit: 20 })).value.operations
    .find(o => o.type === 'deploy-cluster' && o.actor === 'Self-healing' && o.startedAt > since), { timeout: 60000, what: 'Self-healing starting it again' });
  const w = await finished(op.id);
  assert.equal(w.status, 'completed', JSON.stringify(w));
  return w;
}
async function offline(ids) {
  const since = new Date().toISOString();
  writeFileSync(T.fleet.offlineFile, ['spark1', ...ids].join('\n') + '\n');
  await waitFor(async () => (await eventsSince(since)).filter(e => e.type === 'spark-offline' && ids.includes(e.spark)).length === ids.length, { timeout: 40000, what: `${ids} going offline` });
}
async function online(ids) {
  const since = new Date().toISOString();
  await new Promise(res => setTimeout(res, 1500));
  writeFileSync(T.fleet.offlineFile, 'spark1\n');
  await waitFor(async () => (await eventsSince(since)).filter(e => e.type === 'spark-online' && ids.includes(e.spark)).length === ids.length, { timeout: 40000, what: `${ids} coming back` });
}

test('(the owner starts a model across Spark 3 and Spark 4)', { timeout: 300000 * SLOW }, async () => {
  const r = await call(keys.act.token, 'start_model', { model: MODEL, sparks: ['spark3', 'spark4'] });
  assert.equal(r.isError, false, r.text);
  assert.equal((await finished(r.value.operation)).status, 'completed');
  assert.deepEqual(partsOf().map(p => p.state), ['running', 'running']);
  assert.ok((await api('/desired')).json.running.some(x => x.container === HEAD && x.sparks?.join('+') === 'spark3+spark4'));
});

test('a part crashes while its Sparks stay on: what\'s left stops, and it starts again across both', { timeout: 300000 * SLOW }, async () => {
  // (seen running by the watcher first, so it knows how long the part ran)
  await waitFor(async () => (await call(keys.look.token, 'workloads', { spark: 'spark4', detail: true })).value.workloads.some(w => w.labels?.['spark.cluster'] && w.running), { what: 'the watcher seeing the part' });
  const since = new Date().toISOString(), part = partsOf().find(p => p.spark === 'spark4');
  stop('spark4', part.name, 'Exited (1) just now');
  const w = await healedStart(since);
  assert.ok(w.recentLog.length > 0);
  const ev = (await eventsSince(since)).find(e => e.type === 'healing' && e.container === HEAD);
  assert.match(ev?.why || '', /a part stopped/, JSON.stringify(ev));
  assert.deepEqual(partsOf().map(p => p.state), ['running', 'running']);
});

test('the owner powers Spark 3 and 4 off and on again: it comes back once they have settled', { timeout: 300000 * SLOW }, async () => {
  await offline(['spark3', 'spark4']);
  for (const p of partsOf()) stop(p.spark, p.name, 'Exited (255) 1 minute ago');
  const since = new Date().toISOString();
  await online(['spark3', 'spark4']);
  await healedStart(since);
  const ev = (await eventsSince(since)).find(e => e.type === 'healing' && e.container === HEAD);
  assert.match(ev?.why || '', /Spark 3 and Spark 4 came back on/, JSON.stringify(ev));
  assert.deepEqual(partsOf().map(p => p.state), ['running', 'running']);
});

test('a Spark that goes down again within 30 minutes of that: nothing comes back by itself (it may be what froze it)', { timeout: 180000 * SLOW }, async () => {
  await offline(['spark4']);
  for (const p of partsOf()) stop(p.spark, p.name, 'Exited (255) just now');
  const since = new Date().toISOString();
  await online(['spark4']);
  const skipped = await waitFor(async () => (await eventsSince(since)).find(e => e.type === 'heal-skipped' && e.container === HEAD), { timeout: 60000, what: 'heal-skipped' });
  assert.match(skipped.why, /may be what froze it/);
  assert.ok(!(await eventsSince(since)).some(e => e.type === 'healing' && e.container === HEAD));
  assert.deepEqual(partsOf().map(p => p.state), ['exited', 'exited']);
});

test('Sparkie\'s model running but not answering is restarted', { timeout: 120000 * SLOW }, async t => {
  const since = new Date().toISOString();
  writeFileSync(mock('spark2', 'brain-hung'), '');
  t.after(() => rmSync(mock('spark2', 'brain-hung'), { force: true }));
  const ev = await waitFor(async () => (await eventsSince(since)).find(e => e.type === 'healing' && e.container === 'sparkie-main'), { timeout: 60000, what: 'Sparkie’s model being restarted' });
  assert.match(ev.why, /^Sparkie’s model was running but hadn’t answered for 4 seconds$/);
  await waitFor(async () => (await api('/main')).json.healthy === true, { timeout: 60000, what: 'Sparkie answering again' });
});
