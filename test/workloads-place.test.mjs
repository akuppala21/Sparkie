// Covers: A saved workflow's keep_running step may leave its Spark out, and code places it when the run reaches it (D6a):
// save takes it and the rehearsal says it is placed when reached; a new job goes where the files under /in its command
// names are, not to the first Spark in list order; a job that wants the GPU goes only where no model or GPU app runs,
// and with none such the run ends naming each Spark's reason and wakes nothing; with no Spark that is on having room,
// one Spark Console powered off whose record has room is turned on, and only that one; a step whose container is there
// already goes where it is. A step naming a Spark Spark Console powered off is no longer refused before step 1: the run
// turns that Spark on, the step's answer is the usual one, and the run waits for its job's end. (A new image in a saved
// step is still the owner's question: these runs end there, after the placing, until D6c.)
//
// The stand-in fleet as in power-wake.test.mjs: the plug controller (test/mock/plugs.mjs) is tied to Sparks 3 (node 2)
// and 4 (node 3), the stand-in sudo shuts a Spark down, and each power-off writes the Spark's record (power.json). Spark
// 1 is off with no record and no plug, so nothing turns it on. On Spark 3 a job runs its command to its end (jobs-run).
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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
    for (const [spark, name] of [['spark3', 'qwen-recipe-chisel'], ['spark4', 'qwen-recipe-aphex3k']]) {
      const f = join(root, spark, '.mock', 'containers');
      writeFileSync(f, readFileSync(f, 'utf8').split('\n').filter(l => !l.startsWith(`${name}|`)).join('\n'));
    }
    writeFileSync(join(root, 'spark3', '.mock', 'jobs-run'), '');
    // A file only Spark 4's shared folder has.
    const shared = join(root, 'spark4', '.local', 'share', 'spark-portal', 'workspaces', 'shared');
    mkdirSync(shared, { recursive: true });
    writeFileSync(join(shared, 'numbers.csv'), '1,2,3\n');
  },
}, async () => {
  plugs.attach({ offlineFile: T.fleet.offlineFile, sparks: { 2: 'spark3', 3: 'spark4' }, bootMs: 1500 });
});

const act = (name, args) => api(`/actions/${name}`, { method: 'POST', body: args });
const look = async (name, args = {}) => { const r = await act(name, args); assert.equal(r.status, 200, r.text); return r.json; };
const offline = () => readFileSync(T.fleet.offlineFile, 'utf8').split(/\s+/).filter(Boolean);
const stateOf = (spark, name) => readFileSync(join(T.fleet.root, spark, '.mock', 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];
const opEnd = (id, what, timeout = 240000) => waitFor(async () => { const o = (await api(`/jobs/${id}`)).json; return o?.status && o.status !== 'running' ? o : null; }, { timeout, what, every: 250 });
async function done(r) {
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.outcome, 'started', r.text);
  const w = await opEnd(r.json.operation, 'the operation');
  assert.equal(w.status, 'completed', JSON.stringify(w));
  return w;
}
async function stopAllOn(spark) {
  for (const m of (await look('running_models')).models.filter(x => x.spark === spark && x.container?.startsWith('sc-'))) await done(await act('stop_model', { spark, container: m.container }));
}
async function sleepSpark(spark) {
  await stopAllOn(spark);
  await done(await act('power_off', { spark }));
  assert.ok(offline().includes(spark));
}
const save = async (title, steps) => { const r = await act('save_workflow', { title, steps }); assert.equal(r.status, 200, r.text); return r.json; };
const runIt = async title => { const r = await act('run_workflow', { name: title }); assert.equal(r.json?.outcome, 'started', r.text); return opEnd(r.json.operation, `the run of ${title}`); };
const logOf = o => o.log.map(l => String(l).slice(10));
const IMAGE = 'python:3.12-slim';

describe('a step that leaves its Spark out is placed when the run reaches it (D6a)', { concurrency: 1 }, () => {
  test('save takes a keep_running step with no Spark, and the rehearsal says it is placed when reached; a stop still has to name its Spark', { timeout: 60000 * SLOW }, async () => {
    const s = await save('placed later', [{ action: 'keep_running', args: { container: 'wl-p1', image: IMAGE, once: true, command: ['python3', '/in/numbers.csv'] } }]);
    assert.equal(s.outcome, 'saved');
    const r = await look('workflows', { name: 'placed later' });
    assert.deepEqual(r.check.map(l => [l.result, l.why]), [['checked when reached', 'Spark Console picks its Spark when the step is reached']]);
    const stop = await act('save_workflow', { title: 'stop somewhere', steps: [{ action: 'keep_running', args: { container: 'wl-p1', do: 'stop' } }] });
    assert.equal(stop.status, 400, stop.text);
    assert.match(stop.json.error, /Step 1 \(keep_running\): Missing argument: spark\./);
  });

  test('a new job goes where the files its command names are: Spark 4, not Spark 3 first in list order', { timeout: 120000 * SLOW }, async () => {
    const run = await runIt('placed later');
    const log = logOf(run);
    assert.ok(log.includes('Step 1: wl-p1 goes on Spark 4: it has room and the files its command names'), log.join('\n'));
    // (a new image is still the owner's question in a saved step, D6c: the run ends there, naming the Spark it placed)
    assert.equal(run.status, 'failed');
    assert.match(run.error, /^Step 1 \(keep_running\) needs an answer first: Run wl-p1 on Spark 4 once from the image python:3\.12-slim/);
  });

  test('a GPU job goes only where no model or GPU app runs: none such ends the run with each Spark\'s reason and wakes nothing; once Spark 3 is free it goes there', { timeout: 240000 * SLOW }, async () => {
    await save('gpu somewhere', [{ action: 'keep_running', args: { container: 'wl-g', image: 'nvcr.io/nvidia/pytorch:25.01-py3', once: true, gpu: true, memoryGB: 8, command: ['nvidia-smi'] } }]);
    const before = plugs.commands.length;
    const busy = await runIt('gpu somewhere');
    assert.equal(busy.status, 'failed');
    assert.match(busy.error, /^Step 1 \(keep_running\): no Spark has room for wl-g now\. Spark 3 runs [^.]*sc-testorg--Qwen3\.8-27B-abliterated-GGUF[^.]* now\. Spark 4 runs [^.]*sc-RadixArk--Qwen3\.8-27B-NVFP4[^.]* now\.$/, busy.error);
    assert.deepEqual(plugs.commands.slice(before), [], 'nothing was woken');
    await stopAllOn('spark3');
    const free = await runIt('gpu somewhere');
    assert.ok(logOf(free).includes('Step 1: wl-g goes on Spark 3: it has room and a free GPU'), free.log.join('\n'));
    assert.match(free.error, /^Step 1 \(keep_running\) needs an answer first: Run wl-g on Spark 3 once/);
  });

  test('a step naming a Spark Spark Console powered off: the run turns it on, runs the job and waits for its end; a step whose container is there goes where it is', { timeout: 300000 * SLOW }, async () => {
    // (the job is made while Spark 3 is on, by the owner, then Spark 3 is put to sleep)
    const made = await act('keep_running', { spark: 'spark3', container: 'wl-n', image: IMAGE, once: true, command: ['sh', '-c', 'echo slept > woke.txt'] });
    await done(made);
    assert.equal(stateOf('spark3', 'wl-n'), 'exited');
    await sleepSpark('spark3');
    await save('on spark 3', [{ action: 'keep_running', args: { spark: 'spark3', container: 'wl-n' } }]);
    const rehearsed = await look('workflows', { name: 'on spark 3' });
    assert.deepEqual(rehearsed.check.map(l => [l.result, l.why]), [['checked when reached', 'Spark 3 is asleep; it is turned on when this step is reached']]);
    const before = plugs.commands.length;
    const run = await runIt('on spark 3');
    assert.equal(run.status, 'completed', `${run.error}\n${run.log.join('\n')}`);
    assert.deepEqual(plugs.commands.slice(before), [{ node: 2, command: 'on' }], 'only Spark 3');
    const log = logOf(run);
    for (const want of ['Step 1: turning on Spark 3, which Spark Console powered off', 'Step 1: Spark 3 is on']) assert.ok(log.includes(want), `${want}\n${log.join('\n')}`);
    assert.ok(log.some(l => /^Step 1: wl-n on Spark 3 ended well \(exit 0\); waited \d+ s$/.test(l)), log.join('\n'));
    // The same job by name with no Spark: it goes where it is.
    await save('wherever it is', [{ action: 'keep_running', args: { container: 'wl-n' } }]);
    const again = await runIt('wherever it is');
    assert.equal(again.status, 'completed', `${again.error}\n${again.log.join('\n')}`);
    assert.ok(logOf(again).includes('Step 1: wl-n goes on Spark 3: wl-n is there'), again.log.join('\n'));
  });

  test('a new job that fits on no Spark that is on: the one Spark Console powered off whose record has room is turned on, and only that one', { timeout: 300000 * SLOW }, async () => {
    await sleepSpark('spark3');
    // (Spark 4 is on with about 46 GiB free: 50 GB is more than it has beyond the 8 GB kept; Spark 3's record has 128 GB)
    await save('big job', [{ action: 'keep_running', args: { container: 'wl-big', image: IMAGE, once: true, memoryGB: 50, command: ['python3', '-c', 'print(1)'] } }]);
    const before = plugs.commands.length;
    const run = await runIt('big job');
    assert.deepEqual(plugs.commands.slice(before), [{ node: 2, command: 'on' }], 'only Spark 3');
    const log = logOf(run);
    assert.ok(log.includes('Step 1: wl-big goes on Spark 3: no Spark that is on has room; it was asleep, and its record has room'), log.join('\n'));
    assert.ok(log.includes('Step 1: Spark 3 is on'), log.join('\n'));
    assert.match(run.error, /^Step 1 \(keep_running\) needs an answer first: Run wl-big on Spark 3 once/);
    assert.ok(!offline().includes('spark3'));
  });
});
