// Covers: A start that names no Spark wakes both Sparks a model across two needs, and no more (R56, the after-landing
// review of D5): both asleep with the model on the hub's disk too, both are woken at once by its partner on the compute
// cable (never Spark 2's) and it starts across both; with its files only on the sleeping Sparks, Spark 3 is woken, its
// own need is read there, and its partner follows; Spark 3 on with it and Spark 4 asleep without it, Spark 4 is woken,
// or, when its record has no room for half, nothing is and the answer says why; a download whose only versions run
// across two wakes both and starts across both. After a wake a download's version is picked from the live look, so one
// that fits on one Spark starts there though the status hasn't caught up. A model that fits on one Spark wakes one, and
// the start a wake hands over to carries the start's version, so the same known failure with and without a wake makes
// one lesson. A start placed across two through a wake is a run of start_model_across, not of start_model. A workload
// whose start goes through two wakes stops that model on both Sparks at its end, and when its job fails. A saved
// workflow's run wakes a Spark through power.wake, keeps it awake while it runs and lets it go at its end (D6a).
//
// T141 (part): only the Sparks a start needs are woken: two for a model across two, one for one that fits on one.
//
// gpt-oss-120b is made a two-Spark model here: its spark.json says it needs 150 GiB, more than one Spark's 121.7 GiB,
// and Sparks 3 and 4 have 110 GiB free when on, so half of it fits on each. The stand-in cables (test/mock/links.json)
// list Spark 2's cable to Spark 3 before the one between Sparks 3 and 4. The plug controller (test/mock/plugs.mjs) is
// tied to Sparks 3 (node 2) and 4 (node 3); Spark 2's plug (node 5) is read only; the stand-in sudo shuts a Spark down.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, renameSync, rmSync, cpSync, existsSync, openSync, ftruncateSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, waitFor, SLOW } from './lib.mjs';
import { startPlugs } from './mock/plugs.mjs';

const NODES = [
  { node_id: 2, available: true, attributes: { '1/6/0': true, '1/144/8': 0, '1/144/4': 121000, '1/144/5': 0 } },
  { node_id: 3, available: true, attributes: { '1/6/0': true, '1/144/8': 0, '1/144/4': 121000, '1/144/5': 0 } },
  { node_id: 5, available: true, readOnly: true, attributes: { '1/6/0': true, '1/144/8': 150000, '1/144/4': 121000, '1/144/5': 1300 } },
];
const plugs = await startPlugs(NODES);
after(() => plugs.close());
const BIG = 'gpt-oss-120b', GEMMA = 'gemma-3-12b-it', IMAGE = 'python:3.12-slim';

useFleet({
  statusMs: 1500, watchMs: 1500,
  env: {
    SPARK_CONSOLE_PLUGS_URL: plugs.url, SPARK_CONSOLE_PLUGS_MS: '500',
    SPARK_CONSOLE_POWER_MS: '1000', SPARK_CONSOLE_POWER_FIRST_MS: '1000', SPARK_CONSOLE_POWER_POLL_MS: '300',
    SPARK_CONSOLE_POWER_OFF_WAIT_MS: String(8000 * SLOW), SPARK_CONSOLE_POWER_ON_WAIT_MS: String(30000 * SLOW),
    SPARK_CONSOLE_POWER_CYCLE_MS: '300', SPARK_CONSOLE_POWER_HOLD_MS: String(3000 * SLOW), SPARK_CONSOLE_HEAL_SETTLE_MS: '2000',
    SPARK_CONSOLE_JOB_WAIT_MS: '1000',
  },
  prepare: ({ root, stateDir }) => {
    writeFileSync(join(stateDir, 'plugs.json'), JSON.stringify({ spark2: { node: 5, readOnly: true }, spark3: { node: 2 }, spark4: { node: 3 } }), { mode: 0o600 });
    writeFileSync(join(stateDir, 'power.json'), JSON.stringify({ idleMinutes: 0, off: {} }), { mode: 0o600 });
    // (no hand-started benchmarks on Sparks 3 and 4: a power-off would be refused for them)
    for (const [spark, name] of [['spark3', 'qwen-recipe-chisel'], ['spark4', 'qwen-recipe-aphex3k']]) {
      const f = join(root, spark, '.mock', 'containers');
      writeFileSync(f, readFileSync(f, 'utf8').split('\n').filter(l => !l.startsWith(`${name}|`)).join('\n'));
    }
    cpSync(join(root, 'spark3', 'models', BIG), join(root, 'spark4', 'models', BIG), { recursive: true });
    for (const sp of ['spark2', 'spark3', 'spark4']) {
      writeFileSync(join(root, sp, 'models', BIG, 'spark.json'), JSON.stringify({ title: 'gpt-oss 120B', engine: 'vllm', args: [], memoryGiB: 150, source: 'huggingface:openai/gpt-oss-120b' }));
    }
    for (const sp of ['spark3', 'spark4']) {
      const mi = join(root, sp, '.mock', 'meminfo');
      writeFileSync(mi, readFileSync(mi, 'utf8').replace(/^MemAvailable:.*$/m, `MemAvailable:   ${110 * 1048576} kB`));
    }
    // (on Spark 3 a job runs its command to its end)
    writeFileSync(join(root, 'spark3', '.mock', 'jobs-run'), '');
  },
}, async () => {
  plugs.attach({ offlineFile: T.fleet.offlineFile, sparks: { 2: 'spark3', 3: 'spark4' }, bootMs: 1500 });
});

const act = (name, args) => api(`/actions/${name}`, { method: 'POST', body: args });
const look = async (name, args = {}) => { const r = await act(name, args); assert.equal(r.status, 200, r.text); return r.json; };
const offline = () => readFileSync(T.fleet.offlineFile, 'utf8').split(/\s+/).filter(Boolean);
const powerFile = () => join(T.fleet.stateDir, 'power.json');
const power = () => JSON.parse(readFileSync(powerFile(), 'utf8'));
// (a record as an older look, or a smaller Spark, would have left it: written whole, then moved into place)
function setRecord(spark, change) {
  const p = power();
  change(p.off[spark]);
  writeFileSync(`${powerFile()}.t`, JSON.stringify(p), { mode: 0o600 });
  renameSync(`${powerFile()}.t`, powerFile());
}
const lessons = () => { const f = join(T.fleet.stateDir, 'lessons.json'); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).lessons : []; };
const versionOf = async id => (await api('/workflows')).json.workflows.find(w => w.id === id).version;
const commandsSince = n => plugs.commands.slice(n);
const byNode = list => [...list].sort((a, b) => a.node - b.node);
const opEnd = (id, limit = 300000) => waitFor(async () => { const o = (await api(`/jobs/${id}`)).json; return o?.status && o.status !== 'running' ? o : null; }, { timeout: limit, what: `operation ${id} to end`, every: 500 });
async function done(r) {
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.outcome, 'started', r.text);
  const w = await opEnd(r.json.operation);
  assert.equal(w.status, 'completed', JSON.stringify({ status: w.status, error: w.error, log: w.log }));
  return w;
}
// (a model across two Sparks is listed on its first Spark: it stops there, both parts)
async function stopAllOn(spark) {
  for (const m of (await look('running_models')).models.filter(x => (x.spark === spark || (x.acrossSparks || []).includes(spark)) && x.container?.startsWith('sc-'))) {
    await done(await act('stop_model', { spark: m.spark, container: m.container }));
  }
}
// One Spark asleep: what Spark Console runs there stopped first (so nothing is parked), then powered off; its record
// holds its models and the two numbers.
async function sleepSpark(spark) {
  if (offline().includes(spark)) return;
  await stopAllOn(spark);
  await done(await act('power_off', { spark }));
  const r = power().off[spark];
  assert.ok(Array.isArray(r?.models) && r.memTotal > 0 && r.diskFree > 0, JSON.stringify(r));
}
const acrossBoth = async () => (await look('running_models')).models.find(x => x.container === `sc-${BIG}` && x.acrossSparks);
// A weights file whose apparent size is `bytes` (sparse: it takes no disk); the stand-in du reports the apparent size.
function bigFile(spark, bytes) {
  const fd = openSync(join(T.fleet.root, spark, 'models', BIG, 'big.safetensors'), 'w');
  try { ftruncateSync(fd, bytes); } finally { closeSync(fd); }
}

// One Spark on (it was put to sleep by an earlier test).
async function wakeUp(spark) {
  if (offline().includes(spark)) await done(await act('power_on', { spark }));
  assert.ok(!offline().includes(spark));
}
// A start with no Spark named, and the operation it answered with followed to its end, whichever way it went, before
// anything is checked: so a check that fails leaves no start running into the next test.
async function startNamingNone(model) {
  const before = plugs.commands.length, r = await act('start_model', { model });
  const end = r.json?.operation ? await opEnd(r.json.operation) : null;
  return { r, end, switched: commandsSince(before), ended: JSON.stringify({ answer: r.json, status: end?.status, error: end?.error }) };
}

// How many runs each start workflow has on record (validations.json), and which operation validated its version.
const runsOf = () => { const f = join(T.fleet.stateDir, 'validations.json'), v = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
  return Object.fromEntries(['start_model', 'start_model_across'].map(id => [id, { runs: v[id]?.runs || 0, operation: v[id]?.operation || null }])); };
const countedAs = (was, now) => [now.start_model.runs - was.start_model.runs, now.start_model_across.runs - was.start_model_across.runs];
// The containers of the big model (both its parts) running on a Spark, from the stand-in Docker's own list.
const bigRunningOn = spark => readFileSync(join(T.fleet.root, spark, '.mock', 'containers'), 'utf8').split('\n')
  .filter(l => l.startsWith(`sc-${BIG}`) && l.split('|')[1] === 'running').map(l => l.split('|')[0]);
// A saved workflow: the big model started with no Spark named, then a job on Spark 3; run to its end.
async function workload(title, job) {
  const saved = await act('save_workflow', { title, steps: [{ action: 'start_model', args: { model: BIG } }, { action: 'keep_running', args: { spark: 'spark3', container: job } }] });
  assert.equal(saved.status, 200, saved.text);
  const before = plugs.commands.length, r = await act('run_workflow', { name: title });
  assert.equal(r.json?.outcome, 'started', r.text);
  return { run: await opEnd(r.json.operation, 400000), switched: commandsSince(before) };
}

describe('a start wakes the Sparks a model across two needs, and no more (R56)', { concurrency: 1 }, () => {
  test('both asleep, a model that needs two on both records and on the hub’s disk: both are woken at once (the partner on the compute cable, not Spark 2’s) and it starts across both', { timeout: 420000 * SLOW }, async () => {
    await sleepSpark('spark4');
    await sleepSpark('spark3');
    assert.ok(power().off.spark3.models.includes(BIG) && power().off.spark4.models.includes(BIG), 'both records list it');
    const was = runsOf();
    const { r, end, switched, ended } = await startNamingNone(BIG);
    assert.deepEqual(r.json?.poweringOn, ['spark3', 'spark4'], ended);
    assert.equal(end?.status, 'completed', ended);
    assert.deepEqual(byNode(switched), [{ node: 2, command: 'on' }, { node: 3, command: 'on' }], 'Sparks 3 and 4, never Spark 2');
    const run = await acrossBoth();
    assert.deepEqual([...(run?.acrossSparks || [])].sort(), ['spark3', 'spark4'], JSON.stringify(run));
    // (it ran start_model_across, so it is that workflow's run and its validation run, not start_model's)
    const now = runsOf();
    assert.deepEqual(countedAs(was, now), [0, 1], JSON.stringify({ was, now }));
    assert.equal(now.start_model_across.operation, r.json.operation, 'the run that validated start_model_across');
    assert.notEqual(now.start_model.operation, r.json.operation);
    await stopAllOn('spark3');
  });

  test('both asleep, a model that needs two only on their disks (on no Spark that is on): Spark 3 is woken, its own need is read there, then its partner; it starts across both', { timeout: 420000 * SLOW }, async () => {
    rmSync(join(T.fleet.root, 'spark2', 'models', BIG), { recursive: true, force: true });
    await sleepSpark('spark4');
    await sleepSpark('spark3');
    const was = runsOf();
    const { r, end, switched, ended } = await startNamingNone(BIG);
    assert.deepEqual(r.json?.poweringOn, ['spark3'], ended);
    assert.equal(end?.status, 'completed', ended);
    assert.deepEqual(switched, [{ node: 2, command: 'on' }, { node: 3, command: 'on' }], 'Spark 3, then its partner');
    const run = await acrossBoth();
    assert.deepEqual([...(run?.acrossSparks || [])].sort(), ['spark3', 'spark4'], JSON.stringify(run));
    // (one run, of start_model_across: the power-on inside the first one hands up what the start ran, uncounted itself)
    assert.deepEqual(countedAs(was, runsOf()), [0, 1], JSON.stringify({ was, now: runsOf() }));
    await stopAllOn('spark3');
  });

  // (a workload: a run with a job step stops what it started at its end; the start here goes through two wakes, a
  // power-on inside a power-on, and only the start at the end of that chain ran the model)
  test('a workload whose start names no Spark, with the model only on the sleeping Sparks: two wakes, and at its end the model is stopped on both, as its result says', { timeout: 600000 * SLOW }, async () => {
    await wakeUp('spark3');
    await done(await act('keep_running', { spark: 'spark3', container: 'wl-ok', image: IMAGE, once: true, command: ['sh', '-c', 'true'] }));
    await sleepSpark('spark4');
    await sleepSpark('spark3');
    const { run, switched } = await workload('two wakes, then a job', 'wl-ok');
    try {
      assert.equal(run.status, 'completed', `${run.error}\n${(run.log || []).join('\n')}`);
      assert.deepEqual(switched, [{ node: 2, command: 'on' }, { node: 3, command: 'on' }], 'Spark 3, then its partner');
      assert.equal(run.cleanUp, `Stopped what this run had started: sc-${BIG} on Spark 3.`, (run.log || []).join('\n'));
      assert.deepEqual([bigRunningOn('spark3'), bigRunningOn('spark4')], [[], []], 'neither part runs');
    } finally { await stopAllOn('spark3'); }
  });

  test('the same workload whose job then fails: the run fails, and its clean-up stops the model on both Sparks', { timeout: 600000 * SLOW }, async () => {
    await wakeUp('spark3');
    const made = await act('keep_running', { spark: 'spark3', container: 'wl-bad', image: IMAGE, once: true, command: ['sh', '-c', 'echo going badly; exit 3'] });
    assert.equal(made.json?.outcome, 'started', made.text);
    await opEnd(made.json.operation);
    await sleepSpark('spark4');
    await sleepSpark('spark3');
    const { run, switched } = await workload('two wakes, then a job that fails', 'wl-bad');
    try {
      assert.equal(run.status, 'failed', JSON.stringify({ status: run.status, error: run.error }));
      assert.deepEqual(switched, [{ node: 2, command: 'on' }, { node: 3, command: 'on' }], 'Spark 3, then its partner');
      assert.match(run.error, new RegExp(`^Step 2 \\(keep_running\\) failed: wl-bad on Spark 3 ended with an error \\(exit 3\\)\\. Stopped what this run had started: sc-${BIG} on Spark 3\\.`), run.error);
      assert.equal(run.cleanUp, `Stopped what this run had started: sc-${BIG} on Spark 3.`, (run.log || []).join('\n'));
      assert.deepEqual([bigRunningOn('spark3'), bigRunningOn('spark4')], [[], []], 'neither part runs');
    } finally { await stopAllOn('spark3'); }
  });

  test('Spark 3 on with it, Spark 4 asleep, its record without it and too small for half of it: nothing is woken, and the answer says why', { timeout: 300000 * SLOW }, async () => {
    await sleepSpark('spark4');
    await wakeUp('spark3');
    await stopAllOn('spark3');
    const mem = power().off.spark4.memTotal;
    setRecord('spark4', x => { x.models = x.models.filter(n => n !== BIG); x.memTotal = 64e9; });
    try {
      const { r, switched, ended } = await startNamingNone(BIG);
      assert.equal(r.status, 409, ended);
      assert.match(r.json.error, /^Can’t start \S+ right now: .*not enough memory/, ended);
      assert.match(r.json.error, /Spark 4 was powered off by Spark Console and wasn’t turned on for it: Spark 4 had [\d.]+ GB of disk free and 64 GB of memory when it went off \(\d{4}-\d\d-\d\d \d\d:\d\d UTC\)\./, ended);
      await new Promise(res => setTimeout(res, 3000));
      assert.deepEqual(switched, [], 'no plug was switched');
      assert.ok(offline().includes('spark4'));
    } finally { if (power().off.spark4) setRecord('spark4', x => { x.memTotal = mem; }); }
  });

  test('Spark 3 on with it, Spark 4 asleep and its record without it: Spark 4 is woken (half of it fits there) and it starts across both', { timeout: 420000 * SLOW }, async () => {
    await sleepSpark('spark4');
    await wakeUp('spark3');
    await stopAllOn('spark3');
    setRecord('spark4', x => { x.models = x.models.filter(n => n !== BIG); });
    // (its files as large as a real two-Spark model's, more than one Spark's memory, so its size alone never fits one
    // Spark; Spark 4 keeps its files, so the start copies nothing)
    for (const sp of ['spark3', 'spark4']) bigFile(sp, 140e9);
    try {
      const { r, end, switched, ended } = await startNamingNone(BIG);
      assert.deepEqual(r.json?.poweringOn, ['spark4'], ended);
      assert.equal(end?.status, 'completed', ended);
      assert.deepEqual(switched, [{ node: 3, command: 'on' }], 'only Spark 4');
      const run = await acrossBoth();
      assert.deepEqual([...(run?.acrossSparks || [])].sort(), ['spark3', 'spark4'], JSON.stringify(run));
      await stopAllOn('spark3');
    } finally { for (const sp of ['spark3', 'spark4']) rmSync(join(T.fleet.root, sp, 'models', BIG, 'big.safetensors'), { force: true }); }
  });

  // (the stand-in worker's own status says Spark 3 has 66 GiB free, short of the 71.5 GB half of this version needs; the
  // live look says 110 GiB: the start after the wake goes by the live look)
  test('both asleep, a model on no disk whose recipe’s only versions run across two: both are woken at once, and it is downloaded and started across both', { timeout: 420000 * SLOW }, async () => {
    await sleepSpark('spark4');
    await sleepSpark('spark3');
    const { r, end, switched, ended } = await startNamingNone('laguna-s-2.1');
    assert.deepEqual(r.json?.poweringOn, ['spark3', 'spark4'], ended);
    assert.equal(end?.status, 'completed', ended);
    assert.deepEqual(byNode(switched), [{ node: 2, command: 'on' }, { node: 3, command: 'on' }], 'Sparks 3 and 4, never Spark 2');
    const run = (await look('running_models')).models.find(x => /Laguna-S-2\.1/.test(x.container) && x.acrossSparks);
    assert.deepEqual([...(run?.acrossSparks || [])].sort(), ['spark3', 'spark4'], JSON.stringify(run));
    await stopAllOn('spark3');
    await stopAllOn('spark4');
  });

  // (with ~/.mock/stall-worker the stand-in worker on Spark 3 answers no status, so the status loop never shows it as on
  // again, as the real one, which looks every 30 s, doesn't yet when a start goes on just after the wake; SSH, Docker and
  // the live look answer as usual)
  test('both asleep, a model on no disk that fits on one Spark: Spark 3 is woken, and the download starts there from the live look, though the status hasn’t caught up', { timeout: 420000 * SLOW }, async () => {
    await sleepSpark('spark4');
    await sleepSpark('spark3');
    const stall = join(T.fleet.root, 'spark3', '.mock', 'stall-worker');
    writeFileSync(stall, '3');
    let got;
    try { got = await startNamingNone('qwen3.5-0.8b'); } finally { rmSync(stall, { force: true }); }
    const { r, end, switched, ended } = got;
    assert.deepEqual(r.json?.poweringOn, ['spark3'], ended);
    assert.equal(end?.status, 'completed', ended);
    assert.deepEqual(switched, [{ node: 2, command: 'on' }], 'only Spark 3');
    assert.ok((await look('running_models')).models.some(x => x.spark === 'spark3' && /Qwen3\.5-0\.8B/.test(x.container)), 'it runs on Spark 3');
    await stopAllOn('spark3');
  });

  test('a model that fits on one Spark, on both records and the hub’s disk, wakes one; the start it hands over to carries the start’s version, so the same known failure without a wake counts on its lesson', { timeout: 420000 * SLOW }, async () => {
    const GATED = 'INFO loading weights\nhuggingface_hub.errors.GatedRepoError: 401 Client Error: Cannot access gated repo\n';
    const log = join(T.fleet.root, 'spark3', '.mock', `logs-sc-${GEMMA}`);
    writeFileSync(log, GATED);
    try {
      await sleepSpark('spark4');
      await sleepSpark('spark3');
      assert.ok(power().off.spark3.models.includes(GEMMA) && power().off.spark4.models.includes(GEMMA), 'both records list it');
      const version = await versionOf('start_model');
      const { r, end, switched, ended } = await startNamingNone(GEMMA);
      assert.deepEqual(r.json?.poweringOn, ['spark3'], ended);
      assert.equal(end?.status, 'failed', ended);
      assert.deepEqual(switched, [{ node: 2, command: 'on' }], 'only Spark 3');
      assert.ok(offline().includes('spark4'));
      const inner = (await api(`/jobs/${end.inner}`)).json;
      assert.equal(inner.workflowVersion, version, 'the start the power-on handed over to');
      const first = lessons().filter(l => l.subject?.model === GEMMA);
      assert.deepEqual(first.map(l => [l.failure, l.state, l.failed, l.tried.on, l.tried.code]), [['gated', 'seen', 1, 'spark3', version]]);
      // (again, Spark 3 on now: no wake)
      const again = await startNamingNone(GEMMA);
      assert.equal(again.r.json?.outcome, 'started', again.ended);
      assert.equal(again.r.json?.poweringOn, undefined, again.ended);
      assert.equal(again.end?.status, 'failed', again.ended);
      const second = lessons().filter(l => l.subject?.model === GEMMA);
      assert.deepEqual(second.map(l => [l.id, l.failure, l.state, l.failed, l.tried.code]), [[first[0].id, 'gated', 'proven', 2, version]]);
    } finally { rmSync(log, { force: true }); }
  });

  test('a saved workflow’s run turns a sleeping Spark on (power.wake), keeps it awake while it runs, and lets it go at its end (D6a)', { timeout: 420000 * SLOW }, async () => {
    // (the job is made while Spark 3 is on, by the owner; then Spark 3 is put to sleep)
    await wakeUp('spark3');
    await done(await act('keep_running', { spark: 'spark3', container: 'wl-k', image: IMAGE, once: true, command: ['sh', '-c', 'sleep 8'] }));
    await sleepSpark('spark3');
    const saved = await act('save_workflow', { title: 'kept awake', steps: [{ action: 'keep_running', args: { spark: 'spark3', container: 'wl-k' } }] });
    assert.equal(saved.status, 200, saved.text);
    const before = plugs.commands.length;
    const neededFor = async () => (await look('fleet_status')).power?.bySpark?.spark3?.neededFor;
    const r = await act('run_workflow', { name: 'kept awake' });
    assert.equal(r.json?.outcome, 'started', r.text);
    // (by kind and the run's operation, never the title: fleet_status is an inside read, R26, F2 C5)
    const want = `kept awake: a saved workflow’s run, operation ${r.json.operation}`;
    try {
      await waitFor(async () => ((await neededFor()) || []).includes(want), { timeout: 60000, every: 250, what: 'Spark 3 kept awake by the run' });
    } finally {
      const run = await opEnd(r.json.operation);
      assert.equal(run.status, 'completed', `${run.error}\n${(run.log || []).join('\n')}`);
    }
    assert.deepEqual(commandsSince(before), [{ node: 2, command: 'on' }], 'only Spark 3');
    const now = await waitFor(neededFor, { timeout: 30000, what: 'Spark 3 on, with what keeps it on' });
    assert.ok(!now.some(w => /^kept awake:/.test(w)), JSON.stringify(now));
  });
});
