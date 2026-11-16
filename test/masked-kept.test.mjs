// Covers: A key inside an error never comes back whole (R7; R1-06 and the final read): what wait_operation returns (its
// error, step and log lines, the owner's own call included) is masked as the fleet's record is; a restart whose Docker
// output names a key keeps its error masked; a refused shutdown's own words keep the key masked in the operation's
// error; a failed wake's problem, kept in power.json and shown by fleet_status, is masked. Each case puts a made-up key
// shape where the error is built, and looks for it where the error is kept or returned. (The put-back notice's names
// are in putback.test.mjs.)
//
// The stand-in fleet with plugs on Sparks 3 (node 2) and 4 (node 3), as in power-box.test.mjs: the stand-in sudo shuts a
// Spark down, or with ~/.mock/poweroff-says refuses with that line; the stand-in plug controller, with setFail, refuses
// every command to a plug with the words given.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
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
  },
  prepare: ({ root, stateDir }) => {
    writeFileSync(join(stateDir, 'plugs.json'), JSON.stringify({ spark2: { node: 5, readOnly: true }, spark3: { node: 2 }, spark4: { node: 3 } }), { mode: 0o600 });
    writeFileSync(join(stateDir, 'power.json'), JSON.stringify({ idleMinutes: 0, off: {} }), { mode: 0o600 });
    for (const [spark, name] of [['spark3', 'qwen-recipe-chisel'], ['spark4', 'qwen-recipe-aphex3k']]) {
      const f = join(root, spark, '.mock', 'containers');
      writeFileSync(f, readFileSync(f, 'utf8').split('\n').filter(l => !l.startsWith(`${name}|`)).join('\n'));
    }
  },
}, async () => {
  plugs.attach({ offlineFile: T.fleet.offlineFile, sparks: { 2: 'spark3', 3: 'spark4' }, bootMs: 1500 });
});

const RADIX = 'sc-RadixArk--Qwen3.8-27B-NVFP4';
const act = (name, args) => api(`/actions/${name}`, { method: 'POST', body: args });
const opEnd = (id, what, timeout = 240000 * SLOW) => waitFor(async () => { const o = (await api(`/jobs/${id}`)).json; return o?.status && o.status !== 'running' ? o : null; }, { timeout, what, every: 250 });
const mock = (spark, f) => join(T.fleet.root, spark, '.mock', f);
const lines = spark => readFileSync(mock(spark, 'containers'), 'utf8').split('\n').filter(Boolean);
const stateOf = (spark, name) => lines(spark).find(l => l.startsWith(`${name}|`))?.split('|')[1];
const offline = () => readFileSync(T.fleet.offlineFile, 'utf8').split(/\s+/).filter(Boolean);
// Made-up key shapes (the mask hides hf_ and twenty letters or more), one a case.
const FAKE = n => `hf_MadeUpKeyForMaskTest${n}abcdefghij0123`;

describe('a key inside an error never comes back whole', { concurrency: 1 }, () => {
  test('wait_operation: the error, the step and the log lines it returns are masked, also on the owner’s own call', { timeout: 240000 * SLOW }, async () => {
    const key = FAKE(1), check = join(T.fleet.stateDir, '.test-check-fails');
    const s = await act('save_workflow', { title: 'masked wait', steps: [{ action: 'stop_model', args: { spark: 'spark4', container: key } }] });
    assert.equal(s.status, 200, s.text);
    // (the check before step 1 fails on purpose, so the run goes ahead and its step is refused with the key in its words)
    writeFileSync(check, '');
    let id;
    try {
      const r = await act('run_workflow', { name: 'masked wait' });
      assert.equal(r.json?.outcome, 'started', r.text);
      id = r.json.operation;
    } finally { rmSync(check, { force: true }); }
    const raw = await opEnd(id, 'the run');
    assert.equal(raw.status, 'failed');
    assert.ok(raw.error.includes(key), `the run's error quotes the key where it is built: ${raw.error}`);
    let w;
    await waitFor(async () => { w = (await act('wait_operation', { id, seconds: 1 })).json; return w?.status === 'failed'; }, { timeout: 30000 * SLOW, what: 'wait_operation saying it failed' });
    const said = JSON.stringify(w);
    assert.ok(!said.includes(key), `no key in what wait_operation returns: ${said}`);
    assert.match(w.error, /^Step 1 \(stop_model\) failed: \[hidden\] isn’t one of Spark Console’s models on spark4\./);
    assert.ok(w.recentLog.some(l => l.includes('[hidden]')), JSON.stringify(w.recentLog));
  });

  test('restart_model: Docker’s own words naming a key keep it masked in the operation’s error', { timeout: 240000 * SLOW }, async () => {
    const key = FAKE(2);
    assert.equal(stateOf('spark4', RADIX), 'running', 'the model there holds the serve port');
    appendFileSync(mock('spark4', 'containers'), `${key}|exited|Exited (0) 2 hours ago|1|RadixArk--Qwen3.8-27B-NVFP4||||\n`);
    try {
      const r = await act('restart_model', { spark: 'spark4', container: key });
      assert.equal(r.json?.outcome, 'started', r.text);
      const done = await opEnd(r.json.operation, 'the restart');
      assert.equal(done.status, 'failed');
      assert.match(done.error, /^Docker couldn’t start it: .*\[hidden\].*port is already allocated/);
      assert.ok(!done.error.includes(key), done.error);
      assert.notEqual(stateOf('spark4', key), 'running');
    } finally {
      writeFileSync(mock('spark4', 'containers'), lines('spark4').filter(l => !l.startsWith(`${key}|`)).map(l => `${l}\n`).join(''));
    }
  });

  test('power_off: a shutdown refused in words that hold a key keeps it masked in the operation’s error', { timeout: 300000 * SLOW }, async () => {
    const key = FAKE(3);
    writeFileSync(mock('spark4', 'poweroff-says'), `the shutdown stopped at ${key}\n`);
    try {
      const r = await act('power_off', { spark: 'spark4' });
      assert.equal(r.json?.outcome, 'started', r.text);
      const done = await opEnd(r.json.operation, 'the power-off');
      assert.equal(done.status, 'failed');
      assert.match(done.error, /Spark 4 didn’t shut down: the shutdown stopped at \[hidden\]/);
      assert.ok(!done.error.includes(key), done.error);
      assert.ok(!offline().includes('spark4'), 'Spark 4 stays up');
    } finally { rmSync(mock('spark4', 'poweroff-says'), { force: true }); }
  });

  test('power_on: a wake the plug refuses in words that hold a key keeps the problem masked in power.json and fleet_status', { timeout: 300000 * SLOW }, async () => {
    const key = FAKE(4);
    const off = await act('power_off', { spark: 'spark3' });
    assert.equal(off.json?.outcome, 'started', off.text);
    assert.equal((await opEnd(off.json.operation, 'spark3 off')).status, 'completed');
    assert.ok(offline().includes('spark3'));
    plugs.setFail(2, `the plug said no at ${key}`);
    try {
      const r = await act('power_on', { spark: 'spark3' });
      assert.equal(r.json?.outcome, 'started', r.text);
      assert.equal((await opEnd(r.json.operation, 'the wake')).status, 'failed');
      const problem = JSON.parse(readFileSync(join(T.fleet.stateDir, 'power.json'), 'utf8')).off?.spark3?.problem || '';
      assert.match(problem, /^Turning it on didn’t work: Spark 3’s plug couldn’t be switched on: the plug said no at \[hidden\]/);
      assert.ok(!problem.includes(key), problem);
      const status = await act('fleet_status', {});
      assert.ok(!status.text.includes(key), 'not in fleet_status');
    } finally { plugs.setFail(2, null); }
  });
});
