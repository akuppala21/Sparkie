// Covers: A start wakes only the Spark it needs (D5, R41): with a Spark awake and room there, a sleeping one isn't woken; a
// model only on a sleeping Spark's record wakes that one, which is waited for, and the model starts; a model on no record
// wakes one Spark, not every one, and a record with no numbers comes last; with no record holding it, nothing is woken and
// the answer says why. A look (`models_on_disk`, `where_it_fits`, `fleet_status`) wakes nothing and says how old it is.
//
// T141 (part): only the Spark a start needs is woken, and a look wakes nothing, says how old its answer is and reads
// "asleep".
//
// The record each power-off writes in power.json (21-power.mjs: offRecord) holds the model folders on that Spark's disk,
// its memory and its free disk, from the look just before it went off; wakeOne picks from those alone. On the stand-in
// fleet the plug controller (test/mock/plugs.mjs) is tied to Sparks 3 and 4, and the stand-in sudo shuts a Spark down.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, createActKey, waitFor, SLOW } from './lib.mjs';
import { startPlugs } from './mock/plugs.mjs';

// spark3's plug is node 2, spark4's node 3, Spark 2's (read-only) node 5.
const NODES = [
  { node_id: 2, available: true, attributes: { '1/6/0': true, '1/144/8': 0, '1/144/4': 121000, '1/144/5': 0 } },
  { node_id: 3, available: true, attributes: { '1/6/0': true, '1/144/8': 0, '1/144/4': 121000, '1/144/5': 0 } },
  { node_id: 5, available: true, readOnly: true, attributes: { '1/6/0': true, '1/144/8': 150000, '1/144/4': 121000, '1/144/5': 1300 } },
];
const plugs = await startPlugs(NODES);
after(() => plugs.close());

useFleet({
  statusMs: 1500, watchMs: 1500,
  env: {
    SPARK_CONSOLE_PLUGS_URL: plugs.url, SPARK_CONSOLE_PLUGS_MS: '500',
    SPARK_CONSOLE_POWER_MS: '1000', SPARK_CONSOLE_POWER_FIRST_MS: '1000', SPARK_CONSOLE_POWER_POLL_MS: '300',
    SPARK_CONSOLE_POWER_OFF_WAIT_MS: String(8000 * SLOW), SPARK_CONSOLE_POWER_ON_WAIT_MS: String(30000 * SLOW),
    SPARK_CONSOLE_POWER_CYCLE_MS: '300', SPARK_CONSOLE_POWER_HOLD_MS: String(3000 * SLOW), SPARK_CONSOLE_HEAL_SETTLE_MS: '2000',
  },
  prepare: ({ root, stateDir }) => {
    writeFileSync(join(stateDir, 'plugs.json'), JSON.stringify({ spark2: { node: 5, readOnly: true }, spark3: { node: 2 }, spark4: { node: 3 } }), { mode: 0o600 });
    writeFileSync(join(stateDir, 'power.json'), JSON.stringify({ idleMinutes: 0, off: {} }), { mode: 0o600 });
    // (no hand-started benchmarks on Sparks 3 and 4: a power-off would be refused for them)
    for (const [spark, name] of [['spark3', 'qwen-recipe-chisel'], ['spark4', 'qwen-recipe-aphex3k']]) {
      const f = join(root, spark, '.mock', 'containers');
      writeFileSync(f, readFileSync(f, 'utf8').split('\n').filter(l => !l.startsWith(`${name}|`)).join('\n'));
    }
  },
}, async () => {
  plugs.attach({ offlineFile: T.fleet.offlineFile, sparks: { 2: 'spark3', 3: 'spark4' }, bootMs: 1500 });
});

const act = (name, args) => api(`/actions/${name}`, { method: 'POST', body: args });
const look = async (name, args = {}) => { const r = await act(name, args); assert.equal(r.status, 200, r.text); return r.json; };
const offline = () => readFileSync(T.fleet.offlineFile, 'utf8').split(/\s+/).filter(Boolean);
const powerFile = () => join(T.fleet.stateDir, 'power.json');
const power = () => JSON.parse(readFileSync(powerFile(), 'utf8'));
// (a record as an older build, or a fuller disk, would have left it: written whole, then moved into place)
function setRecord(spark, change) {
  const p = power();
  change(p.off[spark]);
  writeFileSync(`${powerFile()}.t`, JSON.stringify(p), { mode: 0o600 });
  renameSync(`${powerFile()}.t`, powerFile());
}
async function finished(id, limit = 240000) {
  for (const until = Date.now() + limit * SLOW; ;) {
    const w = await look('wait_operation', { id, seconds: 20 });
    if (w.status !== 'running') return w;
    assert.ok(Date.now() < until, `still running: ${JSON.stringify(w)}`);
  }
}
async function done(r) {
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.outcome, 'started', r.text);
  const w = await finished(r.json.operation);
  assert.equal(w.status, 'completed', JSON.stringify(w));
  return w;
}
const commandsSince = n => plugs.commands.slice(n);
// Stops what Spark Console runs on a Spark (so the next power-off parks nothing that would come back with it).
async function stopAllOn(spark) {
  for (const m of (await look('running_models')).models.filter(x => x.spark === spark && x.container?.startsWith('sc-'))) {
    await done(await act('stop_model', { spark, container: m.container }));
  }
}
// One Spark asleep: its models stopped first, then powered off; its record has its models and the two numbers.
async function sleepSpark(spark) {
  await stopAllOn(spark);
  await done(await act('power_off', { spark }));
  const r = power().off[spark];
  assert.ok(Array.isArray(r?.models) && r.memTotal > 0 && r.diskFree > 0, JSON.stringify(r));
}
// A start of a model on no Spark's disk, waited for whichever way it went, and what it started stopped again.
async function settle(r, spark) {
  if (r.json?.operation) await finished(r.json.operation);
  if (spark && !offline().includes(spark)) await stopAllOn(spark);
}

describe('a start wakes only the Spark it needs (D5)', { concurrency: 1 }, () => {
  test('a model on no disk, with Spark 3 awake and room there: it downloads on Spark 3, and the sleeping Spark 4 isn’t woken', { timeout: 300000 * SLOW }, async () => {
    await sleepSpark('spark4');
    const before = plugs.commands.length;
    const r = await act('start_model', { model: 'qwen3.5-4b' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.outcome, 'started', r.text);
    assert.equal(r.json.poweringOn, undefined, r.text);
    assert.deepEqual(r.json.sparks, ['spark3'], r.text);
    await settle(r, 'spark3');
    assert.deepEqual(commandsSince(before), [], 'no plug was switched');
    assert.ok(offline().includes('spark4'), 'Spark 4 stays asleep');
  });

  test('a look wakes nothing, and says from its record when the Spark went to sleep and what was on its disk then', { timeout: 300000 * SLOW }, async () => {
    await sleepSpark('spark3');
    const before = plugs.commands.length, rec = power().off;
    const disk = await look('models_on_disk');
    const asleep = Object.fromEntries(disk.asleep.map(a => [a.spark, a]));
    assert.deepEqual(Object.keys(asleep).sort(), ['spark3', 'spark4'], JSON.stringify(disk.asleep));
    assert.equal(asleep.spark3.since, rec.spark3.at);
    assert.ok(asleep.spark3.modelsThen.includes('gpt-oss-20b'), JSON.stringify(asleep.spark3));
    assert.match(asleep.spark3.words, /^Spark 3 is asleep since \d{4}-\d\d-\d\d \d\d:\d\d UTC; \d+ models on its disk then\. A look doesn’t wake it\.$/);
    const fits = await look('where_it_fits', { model: 'gpt-oss-20b' });
    assert.deepEqual(fits.asleep.map(a => a.spark), ['spark3'], JSON.stringify(fits.asleep));
    await look('fleet_status');
    await new Promise(res => setTimeout(res, 3000));
    assert.deepEqual(commandsSince(before), [], 'no plug was switched');
    assert.deepEqual(offline().filter(x => x !== 'spark1').sort(), ['spark3', 'spark4']);
  });

  test('with both asleep, a model only on Spark 3’s record wakes Spark 3 alone, which is waited for, and it starts there', { timeout: 300000 * SLOW }, async () => {
    const before = plugs.commands.length;
    const r = await act('start_model', { model: 'gpt-oss-20b' });
    assert.deepEqual(r.json?.poweringOn, ['spark3'], r.text);
    await done(r);
    assert.deepEqual(commandsSince(before), [{ node: 2, command: 'on' }], 'only Spark 3');
    assert.ok(offline().includes('spark4') && !offline().includes('spark3'));
    assert.ok((await look('running_models')).models.some(x => x.spark === 'spark3' && /gpt-oss-20b/.test(x.container)), 'it runs on Spark 3');
    await sleepSpark('spark3');
  });

  test('with both asleep and the model on neither record, one Spark is woken (the first with room), not both', { timeout: 300000 * SLOW }, async () => {
    const before = plugs.commands.length;
    const r = await act('start_model', { model: 'qwen3.5-0.8b' });
    assert.deepEqual(r.json?.poweringOn, ['spark3'], r.text);
    await settle(r, 'spark3');
    assert.deepEqual(commandsSince(before), [{ node: 2, command: 'on' }], 'only Spark 3');
    assert.ok(offline().includes('spark4'));
    await sleepSpark('spark3');
  });

  test('a record with no numbers (an older build) comes last: the Spark whose record has them is woken', { timeout: 300000 * SLOW }, async () => {
    setRecord('spark3', r => { delete r.memTotal; delete r.diskFree; });
    const before = plugs.commands.length;
    const r = await act('start_model', { model: 'granite-4.2-8b' });
    assert.deepEqual(r.json?.poweringOn, ['spark4'], r.text);
    await settle(r, 'spark4');
    assert.deepEqual(commandsSince(before), [{ node: 3, command: 'on' }], 'only Spark 4');
    assert.ok(offline().includes('spark3'));
    await sleepSpark('spark4');
  });

  test('when no sleeping Spark’s record has room for it, nothing is woken, and the answer says why', { timeout: 120000 * SLOW }, async () => {
    for (const spark of ['spark3', 'spark4']) setRecord(spark, r => { r.memTotal = 128e9; r.diskFree = 5e9; });
    const before = plugs.commands.length;
    const r = await act('start_model', { model: 'glm-ocr' });
    assert.equal(r.status, 409, r.text);
    assert.match(r.json.error, /no version fits on the Sparks right now/);
    assert.match(r.json.error, /Spark 3 and Spark 4 were powered off by Spark Console and weren’t turned on for it: Spark 3 had 5 GB of disk free and 128 GB of memory when it went off \(\d{4}-\d\d-\d\d \d\d:\d\d UTC\); Spark 4 had 5 GB/);
    await new Promise(res => setTimeout(res, 3000));
    assert.deepEqual(commandsSince(before), [], 'no plug was switched');
    assert.deepEqual(offline().filter(x => x !== 'spark1').sort(), ['spark3', 'spark4']);
  });
});
