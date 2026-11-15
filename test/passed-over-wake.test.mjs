// Covers: Lessons used at a start through a wake (B3 with R56; R48): a setup that failed twice the same known way, each
// time on a start that had to turn its Spark on first, is passed over by the next such start, as one that failed on a
// Spark that was on is: the start a power-on hands over to carries the start workflow's version, so its lessons have
// their start code, and the next start through a wake compares with the same version.
//
// wake-b3 is a model made for this file, on the hub's disk and Spark 3's, with two runs that worked here on record (the
// faster first). With Sparks 3 and 4 asleep, a start that names no Spark turns Spark 3 on (its record lists the model)
// and starts it there. The plug controller (test/mock/plugs.mjs) is tied to Sparks 3 (node 2) and 4 (node 3); Spark 2's
// plug (node 5) is read only; the stand-in sudo shuts a Spark down.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, mkdirSync, closeSync, openSync, truncateSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, waitFor, REPO, SLOW } from './lib.mjs';
import { startPlugs } from './mock/plugs.mjs';

const NODES = [
  { node_id: 2, available: true, attributes: { '1/6/0': true, '1/144/8': 0, '1/144/4': 121000, '1/144/5': 0 } },
  { node_id: 3, available: true, attributes: { '1/6/0': true, '1/144/8': 0, '1/144/4': 121000, '1/144/5': 0 } },
  { node_id: 5, available: true, readOnly: true, attributes: { '1/6/0': true, '1/144/8': 150000, '1/144/4': 121000, '1/144/5': 1300 } },
];
const plugs = await startPlugs(NODES);
after(() => plugs.close());

const VLLM = JSON.parse(readFileSync(join(REPO, 'service', 'config.json'), 'utf8')).images.vllm;
const MODEL = 'wake-b3', FAST = ['--max-model-len', '65536'], SLOWER = ['--max-model-len', '16384'];
// (the faster one far faster than the stand-in measures, so it stays first)
const worked = (args, tokS) => ({ key: JSON.stringify([MODEL, 'vllm', VLLM, 1, args, {}]), model: MODEL, repo: null, title: MODEL, engine: 'vllm', image: VLLM, args,
  env: {}, sparks: 1, nodes: ['spark3'], firstAt: '2026-11-10T00:00:00Z', lastAt: '2026-11-10T00:00:00Z', runs: 1, best: { decodeTokS: tokS, ttftMs: 100 } });

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
    for (const sp of ['spark2', 'spark3']) {
      const d = join(root, sp, 'models', MODEL);
      mkdirSync(d, { recursive: true });
      copyFileSync(join(root, 'spark3', 'models', 'gpt-oss-20b', 'config.json'), join(d, 'config.json'));
      closeSync(openSync(join(d, 'model.safetensors'), 'w'));
      truncateSync(join(d, 'model.safetensors'), 1000000);
      writeFileSync(join(d, 'spark.json'), JSON.stringify({ title: 'Wake B3', engine: 'vllm', args: [], memoryGiB: 8 }));
    }
    writeFileSync(join(stateDir, 'verified.json'), JSON.stringify({ deployments: [worked(FAST, 100000), worked(SLOWER, 40)] }), { mode: 0o600 });
  },
}, async () => {
  plugs.attach({ offlineFile: T.fleet.offlineFile, sparks: { 2: 'spark3', 3: 'spark4' }, bootMs: 1500 });
});

const act = (name, args) => api(`/actions/${name}`, { method: 'POST', body: args });
const look = async (name, args = {}) => { const r = await act(name, args); assert.equal(r.status, 200, r.text); return r.json; };
const offline = () => readFileSync(T.fleet.offlineFile, 'utf8').split(/\s+/).filter(Boolean);
const lessons = () => { const f = join(T.fleet.stateDir, 'lessons.json'); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).lessons.filter(l => l.subject?.model === MODEL) : []; };
const jobOf = async id => (await api(`/jobs/${id}`)).json;
const opEnd = id => waitFor(async () => { const o = await jobOf(id); return o?.status && o.status !== 'running' ? o : null; }, { timeout: 300000 * SLOW, what: `operation ${id} to end`, every: 500 });
async function done(r) {
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.outcome, 'started', r.text);
  const w = await opEnd(r.json.operation);
  assert.equal(w.status, 'completed', JSON.stringify({ status: w.status, error: w.error, log: w.log }));
  return w;
}
// One Spark asleep: what Spark Console runs there stopped first (so nothing is parked), then powered off.
async function sleepSpark(spark) {
  if (offline().includes(spark)) return;
  for (const m of (await look('running_models')).models.filter(x => x.spark === spark && x.container?.startsWith('sc-'))) {
    await done(await act('stop_model', { spark, container: m.container }));
  }
  await done(await act('power_off', { spark }));
}
// Sparks 3 and 4 asleep, then a start that names no Spark: it turns Spark 3 on and hands over to the start there. The
// power-on and the start it handed over to, each followed to its end before anything is checked.
async function startThroughWake() {
  await sleepSpark('spark4');
  await sleepSpark('spark3');
  const r = await act('start_model', { model: MODEL });
  const end = r.json?.operation ? await opEnd(r.json.operation) : null;
  const inner = end?.inner ? await jobOf(end.inner) : null;
  const said = JSON.stringify({ answer: r.json, status: end?.status, error: end?.error, inner: inner && { status: inner.status, error: inner.error } });
  assert.deepEqual(r.json?.poweringOn, ['spark3'], said);
  assert.ok(inner, said);
  return { end, inner, said };
}

test('a setup that failed twice the same known way, each time on a start that turned its Spark on first, is passed over by the next one, as on a Spark that was on', { timeout: 900000 * SLOW }, async () => {
  const version = (await api('/workflows')).json.workflows.find(w => w.id === 'start_model').version;
  // Twice through a wake, the faster run that worked here loads and doesn't answer: a failure of the setup's own.
  writeFileSync(join(T.fleet.dir, 'serve-silent'), '');
  let fast;
  try {
    for (const n of [1, 2]) {
      const { end, inner, said } = await startThroughWake();
      assert.equal(end.status, 'failed', said);
      assert.equal(inner.status, 'failed', said);
      assert.equal(inner.workflowVersion, version, 'the start the power-on handed over to carries the start’s version');
      fast ??= inner.setupTried;
      assert.equal(inner.setupTried?.flags, fast?.flags, `start ${n} tries the faster run`);
      assert.deepEqual(lessons().map(l => [l.failure, l.state, l.failed, l.tried.how, l.tried.on, l.tried.code]), [['no-answer', n === 1 ? 'seen' : 'proven', n, 'proven', 'spark3', version]]);
    }
  } finally { rmSync(join(T.fleet.dir, 'serve-silent'), { force: true }); }
  // The third start through a wake passes it over for the next run that worked here, says so, and that one starts.
  const { end, inner, said } = await startThroughWake();
  assert.equal(end.status, 'completed', said);
  assert.equal(inner.status, 'completed', said);
  assert.notEqual(inner.setupTried?.flags, fast.flags, said);
  assert.ok(inner.log.some(l => l.includes(`Passed over a run that worked here before: it failed 2 times the same way on Spark 3 (it loaded but didn’t answer a test prompt), last on `)
    && l.includes(`(lesson ${lessons()[0].id})`)), inner.log.join('\n'));
  assert.ok(readFileSync(join(T.fleet.root, 'spark3', '.mock', 'last-run-args'), 'utf8').split('\n').join(' ').includes('--max-model-len 16384'));
});
