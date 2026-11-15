// Covers: Wall power read from the stand-in plug controller (contract 9.22): `/status`, `fleet_status` and energy;
// Spark 2's plug read only when marked `readOnly`; a plug or controller that doesn't answer. It switches nothing.
//
// Smart plugs (contract 9.22, deploy/plugs.sh): the whole Spark's power at the wall, read from the Matter controller on
// Spark 2 (here a stand-in, test/mock/plugs.mjs), in /status, in fleet_status for agents and Sparkie, and in the
// energy totals. Spark 2's own plug is never read, even when plugs.json names it. Nothing here switches a plug.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, call, api, createKey, waitFor } from './lib.mjs';
import { startPlugs } from './mock/plugs.mjs';

// Matter's units: milliwatts, millivolts, milliamps. An int64 may arrive as a string.
const NODES = [
  { node_id: 2, available: true, attributes: { '1/6/0': true, '1/144/8': 54321, '1/144/4': 121816, '1/144/5': 1207 } },
  { node_id: 3, available: true, attributes: { '1/6/0': true, '1/144/8': '61000', '1/144/4': 121900, '1/144/5': 503 } },
  { node_id: 4, available: true, attributes: { '1/6/0': false, '1/144/8': 0, '1/144/4': 121700, '1/144/5': 0 } },
  { node_id: 5, available: true, attributes: { '1/6/0': true, '1/144/8': 150000, '1/144/4': 121000, '1/144/5': 1300 } },
];
const plugs = await startPlugs(NODES);
after(() => plugs.close());

let key;
useFleet({
  statusMs: 2000,
  env: { SPARK_CONSOLE_PLUGS_URL: plugs.url, SPARK_CONSOLE_PLUGS_MS: '500' },
  // Spark 1 (dark on the stand-in fleet) has its plug off; Spark 2 is the brain's and the console's own Spark.
  prepare: ({ stateDir }) => writeFileSync(join(stateDir, 'plugs.json'),
    JSON.stringify({ spark1: { node: 4 }, spark2: { node: 5 }, spark3: { node: 2 }, spark4: { node: 3 } }), { mode: 0o600 }),
}, async () => { key = (await createKey('plugs')).token; });

const status = async () => (await api('/status?fresh=1')).json;
const spark = (s, id) => s.nodes.find(n => n.id === id);
const fleet = async () => {
  const r = await call(key, 'fleet_status', {});
  assert.equal(r.isError, false, r.raw);
  return r.value;
};

describe('wall power from the smart plugs', () => {
  test('/status: each plugged Spark has its wall reading in watts, volts and amps', async () => {
    const s = await waitFor(async () => (x => (spark(x, 'spark3')?.wall?.watts != null ? x : null))(await status()), { what: 'a wall reading for Spark 3' });
    assert.deepEqual((({ answering, on, watts, volts, amps }) => ({ answering, on, watts, volts, amps }))(spark(s, 'spark3').wall),
      { answering: true, on: true, watts: 54.3, volts: 121.8, amps: 1.21 });
    assert.equal(spark(s, 'spark4').wall.watts, 61, 'an int64 sent as a string still reads');
    assert.equal(spark(s, 'spark1').wall.on, false, 'a dark Spark still has its plug reading');
    assert.equal(spark(s, 'spark1').wall.watts, 0);
    assert.ok(plugs.asked.includes('get_nodes'));
  });

  test('Spark 2, the console’s own Spark: its plug is read only once plugs.json marks it read-only (plugs.sh proved it)', async () => {
    const s = await status();
    assert.equal(spark(s, 'spark2').wall, undefined, 'named without readOnly: not read');
    const f = await fleet();
    assert.equal(f.sparks.find(x => x.id === 'spark2').wall, null);
    const file = join(T.fleet.dir, 'state', 'plugs.json'), before = readFileSync(file, 'utf8');
    writeFileSync(file, JSON.stringify({ ...JSON.parse(before), spark2: { node: 5, readOnly: true } }), { mode: 0o600 });
    try {
      const s2 = await waitFor(async () => spark(await status(), 'spark2')?.wall, { what: 'Spark 2’s read-only plug' });
      assert.equal(s2.watts, 150);
      assert.equal(s2.on, true);
    } finally {
      writeFileSync(file, before, { mode: 0o600 });
    }
  });

  test('fleet_status: wall power beside GPU power, words for a dark Spark, and energy measured at the plugs', async () => {
    const f = await waitFor(async () => (x => (x.wallEnergyKWh?.spark3 ? x : null))(await fleet()), { what: 'wall energy for Spark 3' });
    const s3 = f.sparks.find(x => x.id === 'spark3');
    assert.equal(s3.state, 'online');
    assert.deepEqual((({ plugOn, watts, volts, amps }) => ({ plugOn, watts, volts, amps }))(s3.wall), { plugOn: true, watts: 54.3, volts: 121.8, amps: 1.21 });
    assert.ok('gpuPowerWatts' in s3, 'GPU power is still there, apart from wall power');
    assert.equal(s3.wall.plug, undefined, 'no internal plug number for agents');
    const s1 = f.sparks.find(x => x.id === 'spark1');
    assert.notEqual(s1.state, 'online');
    assert.equal(s1.powerWords, 'Its smart plug is off, so it has no power.');
    assert.match(f.wallEnergyKWh.spark3.since, /^\d{4}-\d\d-\d\dT/);
    assert.equal(typeof f.wallEnergyKWh.spark3.kWh, 'number');
    assert.equal(f.sparks.find(x => x.id === 'spark2').wall, null, 'Spark 2 isn’t read without readOnly (its energy from the read-only test before may stay)');
  });

  test('a plug the controller no longer knows reads as not answering, with what to do', async () => {
    plugs.setNodes(NODES.filter(n => n.node_id !== 3));
    try {
      const w = await waitFor(async () => (x => (x?.answering === false ? x : null))(spark(await status(), 'spark4').wall), { what: 'Spark 4’s plug gone' });
      assert.equal(w.watts, null, 'no old number shown as current');
      assert.match(w.problem, /doesn’t know this plug/);
    } finally {
      plugs.setNodes(NODES);
    }
  });

  // Last: it closes the stand-in controller.
  test('with the controller down, a plugged Spark with no reading says the controller isn’t answering, not “no plug”', async () => {
    const file = join(T.fleet.dir, 'state', 'plugs.json'), map = JSON.parse(readFileSync(file, 'utf8'));
    await plugs.close();
    writeFileSync(file, JSON.stringify({ ...map, spark1: { node: 9 } }), { mode: 0o600 });
    const w = await waitFor(async () => (x => (x?.plug === 9 ? x : null))(spark(await status(), 'spark1')?.wall), { what: 'Spark 1’s new plug, controller down' });
    assert.equal(w.answering, false);
    assert.equal(w.watts, null);
    assert.match(w.problem, /plug controller/i);
    const f = await fleet();
    assert.notEqual(f.sparks.find(x => x.id === 'spark1').wall, null, 'agents see a plug that isn’t answering, not “no plug”');
  });
});
