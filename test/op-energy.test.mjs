// Covers: An operation's energy at the wall (D9 as cut, R43): its journal end line carries `wh`, the watt-hours its
// Sparks drew while it ran, from the wall counter the status loop keeps (stand-in plugs at a steady 60 W); across two
// Sparks both add up; with no plug, a plug that doesn't answer, or a newest reading older than the operation there is
// no number and `noWh` says why; an agent's `recall` of the record shows the number as the owner's does.
//
// The stand-in plug controller (test/mock/plugs.mjs) reads 60 W on Spark 3's plug and Spark 4's, whatever the Sparks
// do. The status loop counts every second here (30 s on the Sparks), so an operation of a few seconds has readings
// inside it. With steady watts the number is exact but for its rounding to 0.01 Wh.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, call, createKey, waitFor, sleep, SLOW } from './lib.mjs';
import { startPlugs } from './mock/plugs.mjs';

// Spark 3's plug is node 2, Spark 4's node 3; Matter's units are milliwatts, millivolts and milliamps.
const NODES = [2, 3].map(node_id => ({ node_id, available: true, attributes: { '1/6/0': true, '1/144/8': 60000, '1/144/4': 120000, '1/144/5': 500 } }));
const plugs = await startPlugs(NODES);
let plugsClosed = false;
after(() => (plugsClosed ? null : plugs.close()));

const PLUGS = { spark3: { node: 2 }, spark4: { node: 3 } };
const keys = {};
useFleet({
  watchMs: 60000, statusMs: 1000,
  env: { SPARK_CONSOLE_PLUGS_URL: plugs.url, SPARK_CONSOLE_PLUGS_MS: '300' },
  prepare: ({ stateDir }) => {
    writeFileSync(join(stateDir, 'plugs.json'), JSON.stringify(PLUGS), { mode: 0o600 });
    writeFileSync(join(stateDir, 'power.json'), JSON.stringify({ idleMinutes: 0, off: {} }), { mode: 0o600 });
  },
}, async () => { keys.look = await createKey('energy-look'); });

const T3 = 'sc-testorg--Qwen3.8-27B-abliterated-GGUF';
const mock = (spark, f) => join(T.fleet.root, spark, '.mock', f);
const plugsFile = () => join(T.fleet.stateDir, 'plugs.json');
function setFree(spark, gib) {
  const f = mock(spark, 'meminfo');
  writeFileSync(f, readFileSync(f, 'utf8').replace(/^MemAvailable:.*$/m, `MemAvailable:   ${Math.round(gib * 1048576)} kB`));
}
const MEM = { spark3: 64, spark4: 46 };   // test/mock/root's meminfo, GiB
const act = (name, args) => api(`/actions/${name}`, { method: 'POST', body: args });
const status = async () => (await api('/status?fresh=1')).json;
// The op records in the journal (one line each), and the end line of one operation.
const records = () => (existsSync(T.fleet.journalDir) ? readdirSync(T.fleet.journalDir).filter(f => f.endsWith('.jsonl'))
  .flatMap(f => readFileSync(join(T.fleet.journalDir, f), 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } })) : []);
const opRecord = id => waitFor(() => records().find(r => r.k === 'op' && r.op === id), { what: `the journal's end line of ${id}` });
// Started, followed to its end; its operation id.
async function done(r) {
  assert.equal(r.status, 200, r.text);
  if (r.json?.outcome === 'question') r = await act('start_model', { choice: r.json.choices.find(c => /^Yes/.test(c.label)).choice });
  assert.equal(r.json.outcome, 'started', r.text);
  for (const until = Date.now() + 240000 * SLOW; ;) {
    const w = (await act('wait_operation', { id: r.json.operation, seconds: 20 })).json;
    if (w.status !== 'running') { assert.equal(w.status, 'completed', JSON.stringify(w)); assert.ok(!('wallAtStart' in w), 'the counter at its start is not on the operation as shown'); return r.json.operation; }
    assert.ok(Date.now() < until, `still running: ${JSON.stringify(w)}`);
  }
}
// Steady watts give the exact figure; the record rounds to 0.01 Wh.
const near = (wh, watts, ms) => {
  const want = (watts * ms) / 3.6e6;
  assert.equal(typeof wh, 'number', `wh is ${wh}`);
  assert.ok(Math.abs(wh - want) <= 0.005 + want * 0.01, `${wh} Wh, expected ${want.toFixed(4)} Wh (${watts} W for ${ms} ms)`);
};
// Until the counter has a few seconds of wall readings for each Spark.
const counting = ids => waitFor(async () => { const e = (await status()).energy?.nodes || {}; return ids.every(id => (e[id]?.wallCoverageSeconds || 0) >= 3); },
  { what: `wall readings counted for ${ids.join(' and ')}` });
let oneSpark = null, noPlug = null;

test('steady 60 W on Spark 3: a stop that takes about 6 s ends with 60 W times its time, in watt-hours', { timeout: 300000 * SLOW }, async () => {
  await counting(['spark3', 'spark4']);
  writeFileSync(mock('spark3', 'slow-stop'), '6');
  try { oneSpark = await done(await act('stop_model', { spark: 'spark3', container: T3 })); } finally { rmSync(mock('spark3', 'slow-stop'), { force: true }); }
  const r = await opRecord(oneSpark);
  assert.deepEqual([r.act, r.ok, r.sub], ['stop', true, ['spark3', T3]], JSON.stringify(r));
  assert.ok(r.ms >= 6000, `${r.ms} ms`);
  near(r.wh, 60, r.ms);
  assert.equal(r.noWh, undefined);
});

test('across Spark 3 and Spark 4: both Sparks add up', { timeout: 300000 * SLOW }, async () => {
  await counting(['spark3', 'spark4']);
  setFree('spark3', 70);
  setFree('spark4', 70);
  let id;
  try { id = await done(await act('start_model', { model: 'gpt-oss-120b', sparks: ['spark3', 'spark4'] })); } finally { setFree('spark3', MEM.spark3); setFree('spark4', MEM.spark4); }
  const r = await opRecord(id);
  assert.deepEqual([r.act, r.ok], ['deploy-cluster', true], JSON.stringify(r));
  assert.ok(r.sub.includes('spark3') && r.sub.includes('spark4'), JSON.stringify(r.sub));
  near(r.wh, 120, r.ms);
});

test('no plug: Spark 3 taken out of plugs.json gives no number, and says so', { timeout: 300000 * SLOW }, async () => {
  writeFileSync(plugsFile(), JSON.stringify({ spark4: PLUGS.spark4 }), { mode: 0o600 });
  try { noPlug = await done(await act('stop_model', { spark: 'spark3', container: 'sc-gpt-oss-120b' })); } finally { writeFileSync(plugsFile(), JSON.stringify(PLUGS), { mode: 0o600 }); }
  const r = await opRecord(noPlug);
  assert.equal(r.wh, undefined, JSON.stringify(r));
  assert.equal(r.noWh, 'Spark 3 has no plug Spark Console reads');
});

test('a plug that doesn’t answer the controller: no number, and says so', { timeout: 300000 * SLOW }, async () => {
  plugs.node(2).available = false;
  let id;
  try {
    await waitFor(async () => (await status()).nodes.find(n => n.id === 'spark3')?.wall?.answering === false, { what: 'Spark 3’s plug not answering' });
    id = await done(await act('restart_model', { spark: 'spark3', container: T3 }));
  } finally { plugs.node(2).available = true; }
  const r = await opRecord(id);
  assert.equal(r.wh, undefined, JSON.stringify(r));
  assert.equal(r.noWh, 'Spark 3’s plug isn’t answering');
});

test('a newest reading older than the operation (the controller stopped answering a moment ago): no number, and says so', { timeout: 300000 * SLOW }, async () => {
  await waitFor(async () => (await status()).nodes.find(n => n.id === 'spark3')?.wall?.answering === true, { what: 'Spark 3’s plug answering again' });
  // (its last reading stays shown as current for 90 s, the counter keeps adding it up, but none is newer than the start)
  await plugs.close();
  plugsClosed = true;
  await sleep(1500);
  writeFileSync(mock('spark3', 'slow-stop'), '3');
  let id;
  try { id = await done(await act('stop_model', { spark: 'spark3', container: T3 })); } finally { rmSync(mock('spark3', 'slow-stop'), { force: true }); }
  const r = await opRecord(id);
  assert.ok(r.ms < 80000, `${r.ms} ms: inside the 90 s a held reading still shows`);
  assert.equal(r.wh, undefined, JSON.stringify(r));
  assert.equal(r.noWh, 'Spark 3’s newest plug reading is older than the operation');
});

test('recall: an agent sees the number and the reason as the owner does (operations are readable to agents, R43)', async () => {
  for (const [id, field] of [[oneSpark, 'wh'], [noPlug, 'noWh']]) {
    assert.ok(id, 'the operation ran above');
    const kept = (await opRecord(id))[field];
    const agent = await call(keys.look.token, 'recall', { about: id, kind: 'op' });
    assert.equal(agent.isError, false, agent.text);
    const owner = (await act('recall', { about: id, kind: 'op' })).json;
    for (const seen of [agent.value, owner]) {
      const v = seen.records.find(x => x.op === id);
      assert.ok(v, JSON.stringify(seen));
      assert.equal(v[field], kept, JSON.stringify(v));
    }
  }
});
