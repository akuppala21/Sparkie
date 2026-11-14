// The hub guard (R1; design D step 1): a start that names no Spark is placed only on the compute Sparks
// (computeSparks()), never on the hub, which is both the brain's Spark and the console's own. Here the brain's setup is on
// Spark 4, so the two differ: before computeSparks(), placement left out only the brain's Spark (MAIN.node), and Spark 2,
// where the console itself runs, was fair game for a model on disk, a pair, or a download.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { T, useFleet, call, createActKey, createKey, agentSettings, SLOW } from './lib.mjs';

const keys = {};
const mock = (root, spark, file) => join(root, spark, '.mock', file);
useFleet({ watchMs: 60000, statusMs: 20000, env: { SPARK_CONSOLE_DIG_FIXTURE: join(dirname(fileURLToPath(import.meta.url)), 'mock', 'dig-fixture.json') },
  prepare: ({ root, stateDir }) => {
    // The brain's setup runs on Spark 4; Spark Console itself stays on Spark 2 (its host is "local").
    const f = join(stateDir, 'main.json'), main = JSON.parse(readFileSync(f, 'utf8'));
    main.presets[main.current].node = 'spark4';
    writeFileSync(f, JSON.stringify(main), { mode: 0o600 });
    // Spark 2 has by far the most room, on disk and in its status: the best place by every measure, if it could be used.
    // Spark 3's free memory can't be read, so on disk nothing fits there.
    const mi = mock(root, 'spark2', 'meminfo');
    writeFileSync(mi, readFileSync(mi, 'utf8').replace(/^MemAvailable:.*$/m, `MemAvailable:   ${110 * 1048576} kB`));
    writeFileSync(mock(root, 'spark3', 'meminfo'), 'MemTotal:       127607420 kB\n');
    writeFileSync(mock(root, 'spark2', 'status.json'), JSON.stringify({ memoryFreeGiB: 110 }));
  } }, async () => {
  keys.act = await createActKey('hub');
  keys.look = await createKey('hub-look');
});

const containers = spark => readFileSync(join(T.fleet.root, spark, '.mock', 'containers'), 'utf8');
const operations = async () => (await call(keys.look.token, 'recent_operations', { limit: 50 })).value.operations;

test('the brain\'s setup is on Spark 4, and Spark Console runs on Spark 2: both are the hub', async () => {
  const s = (await call(keys.look.token, 'sparkie_setup', {})).value;
  assert.equal(s.model?.spark, 'spark4', JSON.stringify(s.model));
});

test('a model on disk with no Spark named never lands on the console\'s Spark, even when only it has room', { timeout: 120000 * SLOW }, async () => {
  const before = containers('spark2');
  // gpt-oss-120b (80 GiB) fits only on Spark 2 now; Spark 3's memory is unknown, and every pair has a hub Spark in it.
  const r = await call(keys.act.token, 'start_model', { model: 'gpt-oss-120b' });
  assert.equal(r.isError, true, `it should be refused, not placed: ${r.text}`);
  assert.match(r.text, /^\[conflict(, retry later)?\] /, r.text);
  assert.match(r.text, /spark4 and spark2 are Sparkie’s, so nothing else starts there/, r.text);
  assert.deepEqual(await operations(), [], 'nothing started');
  assert.equal(containers('spark2'), before, 'nothing changed on Spark 2');
});

test('a download with no Spark named never goes to the console\'s Spark, even when it has the most room', { timeout: 120000 * SLOW }, async () => {
  const before = containers('spark2');
  const r = await call(keys.act.token, 'start_model', { model: 'qwen3.5-4b' });
  assert.equal(r.isError, false, r.text);
  const x = r.value;
  assert.equal(x.outcome, 'started', JSON.stringify(x));
  assert.ok(!x.sparks.includes('spark2') && !x.sparks.includes('spark4'), JSON.stringify(x));
  // Stopped at its next step (nothing is downloaded or started).
  await agentSettings({ halted: true });
  try {
    for (const until = Date.now() + 90000 * SLOW; ;) {
      const w = (await call(keys.look.token, 'wait_operation', { id: x.operation, seconds: 10 })).value;
      if (w.status !== 'running') break;
      assert.ok(Date.now() < until, 'still running');
    }
  } finally { await agentSettings({ halted: false }); }
  assert.equal(containers('spark2'), before, 'nothing changed on Spark 2');
});
