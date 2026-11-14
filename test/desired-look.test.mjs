// A look at the Sparks that began before an operation ended says nothing about what that operation did (gate,
// 2026-11-13). The list of what should be running was read while a stop of one of its models ran; the look at the
// Sparks that went with it came back after the stop had ended. With no operation running any more, the model showed
// as held ("should be running but isn't"), and the owner was told so. A Spark where an operation ended after the look
// began now counts as changing until a fresh look. Nothing in the background looks at the list here (its checks and
// self-healing run once an hour), so the only look is the test's own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, call, createActKey, waitFor, SLOW } from './lib.mjs';

const keys = {};
useFleet({ watchMs: 3600000, statusMs: 3000, env: { SPARK_CONSOLE_DESIRED_MS: '3600000', SPARK_CONSOLE_HEAL_MS: '3600000' } },
  async () => { keys.act = await createActKey('desired-look'); });
const mock = (spark, file) => join(T.fleet.root, spark, '.mock', file);
const stateOf = (spark, name) => readFileSync(mock(spark, 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];
async function ok(name, args) {
  const r = await call(keys.act.token, name, args);
  assert.equal(r.isError, false, `${name} ${JSON.stringify(args)}: ${r.text}`);
  return r.value;
}
async function finished(id) {
  for (const until = Date.now() + 150000 * SLOW; ;) {
    const w = await ok('wait_operation', { id, seconds: 20 });
    if (w.status !== 'running') return w;
    if (Date.now() > until) throw new Error(`still running: ${JSON.stringify(w)}`);
  }
}
const listed = async () => (await api('/desired')).json.running;
const GPT = 'sc-gpt-oss-20b';

test('a stop that ends while a look at its Spark is under way: its model shows as changing, not held', { timeout: 300000 * SLOW }, async t => {
  const x = await ok('start_model', { model: 'gpt-oss-20b', spark: 'spark3' });
  assert.equal((await finished(x.operation)).status, 'completed');
  assert.equal((await listed()).find(e => e.spark === 'spark3' && e.container === GPT)?.state, 'running');
  // (the look just taken is shared for 15 s; this test needs one of its own)
  await new Promise(r => setTimeout(r, 16000));
  // The stop's docker stop takes 3 s, then its check that it stopped (docker inspect) 6 s more. A look at Spark 3's
  // containers (docker ps) takes 14 s.
  t.after(() => { for (const f of ['slow-stop', 'slow-inspect', 'slow-ps']) rmSync(mock('spark3', f), { force: true }); });
  writeFileSync(mock('spark3', 'slow-stop'), '3');
  const s = await ok('stop_model', { spark: 'spark3', container: GPT });
  writeFileSync(mock('spark3', 'slow-inspect'), '6');
  writeFileSync(mock('spark3', 'slow-ps'), '14');
  await waitFor(() => stateOf('spark3', GPT) === 'exited', { timeout: 60000, every: 100, what: 'its container stopped' });
  // The list is read now, while the stop is still checking; the look that goes with it comes back after the stop ended.
  const e = (await listed()).find(y => y.spark === 'spark3' && y.container === GPT);
  const w = await ok('wait_operation', { id: s.operation, seconds: 1 });
  assert.equal(w.status, 'completed', 'the stop ended before the look came back');
  assert.ok(e, 'on the list when it was read');
  assert.equal(e.state, 'changing', JSON.stringify(e));
  // A fresh look: the stop took it off the list.
  for (const f of ['slow-stop', 'slow-inspect', 'slow-ps']) rmSync(mock('spark3', f), { force: true });
  await waitFor(async () => !(await listed()).some(y => y.container === GPT), { timeout: 60000, what: 'off the list' });
});
