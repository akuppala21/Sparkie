// Covers: An agent's run of a saved workflow is the agent's in each of its steps (R57; the workloads review's B1): a
// saved step that runs a job again, or powers a Spark off, is asked in the agent's run exactly as the agent's own call
// is, and runs nothing; the owner's own run of the same workflow runs it. The clean-up after an agent's run that ended
// badly still stops what the run started, as the run (no question it can't get answered). Removing the agent while its
// run goes (R9, R1-02): the rest of the run goes on as it began and the removed key starts nothing new; a later step an
// agent is asked for is still asked, and the clean-up stops only what the run started, never what ran before it.
//
// The stand-in fleet as in power-wake.test.mjs: plugs on Sparks 3 (node 2) and 4 (node 3), the stand-in sudo shuts a
// Spark down. On Spark 4 a job runs its command to its end (~/.mock/jobs-run). The owner makes the job (wl-again, which
// adds a line to runs.txt each time it runs) and a web app (wl-web, stopped again) first. The agent's key may act; on
// the tailnet its calls come with the owner's viewer, so only the context says it is the agent's.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, call, createActKey, waitFor, SLOW } from './lib.mjs';
import { startPlugs } from './mock/plugs.mjs';

const NODES = [
  { node_id: 2, available: true, attributes: { '1/6/0': true, '1/144/8': 0, '1/144/4': 121000, '1/144/5': 0 } },
  { node_id: 3, available: true, attributes: { '1/6/0': true, '1/144/8': 0, '1/144/4': 121000, '1/144/5': 0 } },
  { node_id: 5, available: true, readOnly: true, attributes: { '1/6/0': true, '1/144/8': 150000, '1/144/4': 121000, '1/144/5': 1300 } },
];
const plugs = await startPlugs(NODES);
after(() => plugs.close());
const keys = {};
useFleet({
  statusMs: 1500, watchMs: 1500,
  env: {
    SPARK_CONSOLE_PLUGS_URL: plugs.url, SPARK_CONSOLE_PLUGS_MS: '500',
    SPARK_CONSOLE_POWER_MS: '1000', SPARK_CONSOLE_POWER_FIRST_MS: '1000', SPARK_CONSOLE_POWER_POLL_MS: '300',
    SPARK_CONSOLE_POWER_OFF_WAIT_MS: String(8000 * SLOW), SPARK_CONSOLE_POWER_ON_WAIT_MS: String(30000 * SLOW),
    SPARK_CONSOLE_POWER_CYCLE_MS: '300', SPARK_CONSOLE_POWER_HOLD_MS: String(3000 * SLOW), SPARK_CONSOLE_HEAL_SETTLE_MS: '2000',
    SPARK_CONSOLE_APP_ANSWER_MS: '3000',
  },
  prepare: ({ root, stateDir }) => {
    writeFileSync(join(stateDir, 'plugs.json'), JSON.stringify({ spark2: { node: 5, readOnly: true }, spark3: { node: 2 }, spark4: { node: 3 } }), { mode: 0o600 });
    writeFileSync(join(stateDir, 'power.json'), JSON.stringify({ idleMinutes: 0, off: {} }), { mode: 0o600 });
    for (const [spark, name] of [['spark3', 'qwen-recipe-chisel'], ['spark4', 'qwen-recipe-aphex3k']]) {
      const f = join(root, spark, '.mock', 'containers');
      writeFileSync(f, readFileSync(f, 'utf8').split('\n').filter(l => !l.startsWith(`${name}|`)).join('\n'));
    }
    writeFileSync(join(root, 'spark4', '.mock', 'jobs-run'), '');
  },
}, async () => {
  plugs.attach({ offlineFile: T.fleet.offlineFile, sparks: { 2: 'spark3', 3: 'spark4' }, bootMs: 1500 });
  keys.act = await createActKey('saved-agent');
});

const act = (name, args) => api(`/actions/${name}`, { method: 'POST', body: args });
const look = async (name, args = {}) => { const r = await act(name, args); assert.equal(r.status, 200, r.text); return r.json; };
const offline = () => readFileSync(T.fleet.offlineFile, 'utf8').split(/\s+/).filter(Boolean);
const opEnd = (id, what, timeout = 240000) => waitFor(async () => { const o = (await api(`/jobs/${id}`)).json; return o?.status && o.status !== 'running' ? o : null; }, { timeout, what, every: 250 });
const stateOf = name => readFileSync(join(T.fleet.root, 'spark4', '.mock', 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];
const runs = () => { try { return readFileSync(join(T.fleet.root, 'spark4', '.local', 'share', 'spark-portal', 'workspaces', 'shared', 'jobs', 'wl-again', 'runs.txt'), 'utf8').split('\n').filter(Boolean).length; } catch { return 0; } };
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
async function agentRun(title, steps) {
  const s = await call(keys.act.token, 'save_workflow', { title, steps });
  assert.equal(s.isError, false, s.text);
  const r = await call(keys.act.token, 'run_workflow', { name: title });
  assert.equal(r.isError, false, r.text);
  return opEnd(r.value.operation, `the agent’s run of ${title}`);
}
async function ownerRun(title) {
  const r = await act('run_workflow', { name: title });
  assert.equal(r.json?.outcome, 'started', r.text);
  return opEnd(r.json.operation, `the owner’s run of ${title}`);
}
const AGAIN = { action: 'keep_running', args: { spark: 'spark4', container: 'wl-again' } };

describe('an agent\'s run of a saved workflow is the agent\'s in its steps', { concurrency: 1 }, () => {
  before(async () => {
    const job = await act('keep_running', { spark: 'spark4', container: 'wl-again', image: 'python:3.12-slim', once: true, command: ['sh', '-c', 'echo ran >> runs.txt'] });
    assert.equal((await opEnd(job.json.operation, 'wl-again made')).status, 'completed');
    const web = await act('keep_running', { spark: 'spark4', container: 'wl-web', image: 'nginx:1.27', port: `${await freePort()}:80` });
    assert.equal((await opEnd(web.json.operation, 'wl-web made')).status, 'completed');
    const s = await act('keep_running', { spark: 'spark4', container: 'wl-web', do: 'stop' });
    assert.equal((await opEnd(s.json.operation, 'wl-web stopped')).status, 'completed');
    assert.deepEqual([stateOf('wl-again'), stateOf('wl-web'), runs()], ['exited', 'exited', 1]);
  }, { timeout: 180000 * SLOW });

  test('a job run again: asked in the agent\'s run as in its own call, and runs nothing; the owner\'s run of the same workflow runs it', { timeout: 240000 * SLOW }, async () => {
    const direct = await call(keys.act.token, 'keep_running', AGAIN.args);
    assert.equal(direct.value?.outcome, 'question', direct.text);
    assert.match(direct.value.question, /^Run wl-again on Spark 4 again\? Running a job again is the owner’s call\.$/);
    const run = await agentRun('agent again', [AGAIN]);
    assert.equal(run.status, 'failed', run.log.join('\n'));
    assert.match(run.error, /^Step 1 \(keep_running\) needs an answer first: Run wl-again on Spark 4 again\? Running a job again is the owner’s call\./);
    assert.equal(runs(), 1, 'the job didn’t run again');
    const owners = await ownerRun('agent again');
    assert.equal(owners.status, 'completed', `${owners.error}\n${owners.log.join('\n')}`);
    assert.equal(runs(), 2, 'the owner’s run ran it again');
  });

  test('the clean-up after an agent\'s run that ended at that question still stops what the run started, with no question', { timeout: 240000 * SLOW }, async () => {
    const run = await agentRun('agent web then job', [{ action: 'keep_running', args: { spark: 'spark4', container: 'wl-web' } }, AGAIN]);
    assert.equal(run.status, 'failed', run.log.join('\n'));
    assert.match(run.error, /^Step 2 \(keep_running\) needs an answer first: Run wl-again on Spark 4 again\?.* Stopped what this run had started: wl-web on Spark 4\./);
    assert.equal(stateOf('wl-web'), 'exited');
    assert.ok(!(await look('should_be_running')).running.some(x => x.container === 'wl-web'), 'off the list');
  });

  test('a power-off: asked in the agent\'s run as in its own call, and no plug is switched; the owner\'s run of the same workflow powers off', { timeout: 300000 * SLOW }, async () => {
    for (const m of (await look('running_models')).models.filter(x => x.spark === 'spark3' && x.container?.startsWith('sc-'))) {
      const s = await act('stop_model', { spark: 'spark3', container: m.container });
      assert.equal((await opEnd(s.json.operation, 'the stop')).status, 'completed');
    }
    const direct = await call(keys.act.token, 'power_off', { spark: 'spark3' });
    assert.equal(direct.value?.outcome, 'question', direct.text);
    const before = plugs.commands.length;
    const run = await agentRun('agent lights out', [{ action: 'power_off', args: { spark: 'spark3' } }]);
    assert.equal(run.status, 'failed', run.log.join('\n'));
    assert.match(run.error, /^Step 1 \(power_off\) needs an answer first: Power off Spark 3\?/);
    assert.deepEqual(plugs.commands.slice(before), [], 'no plug was switched');
    assert.ok(!offline().includes('spark3'));
    const owners = await ownerRun('agent lights out');
    assert.equal(owners.status, 'completed', `${owners.error}\n${owners.log.join('\n')}`);
    assert.ok(offline().includes('spark3'), 'the owner’s run powered it off');
  });
});

// R9 (R1-02): removing the agent cancels nothing already running, the rest of a saved workflow it started included; the
// run goes on with the authority it began with (still the agent's: a step an agent is asked for is still asked), and
// its clean-up never stops what ran before the run began. Every docker start on Spark 4 takes 4 s here, so the key is
// removed while step 1's operation runs.
describe('removing the agent while its saved workflow runs', { concurrency: 1 }, () => {
  const RADIX = 'sc-RadixArk--Qwen3.8-27B-NVFP4', slowFile = () => join(T.fleet.root, 'spark4', '.mock', 'slow-start');
  const noSlow = () => rmSync(slowFile(), { force: true });
  const app = async name => {
    const r = await act('keep_running', { spark: 'spark4', container: name, image: 'nginx:1.27', port: `${await freePort()}:80` });
    assert.equal((await opEnd(r.json.operation, `${name} made`)).status, 'completed');
    const s = await act('keep_running', { spark: 'spark4', container: name, do: 'stop' });
    assert.equal((await opEnd(s.json.operation, `${name} stopped`)).status, 'completed');
  };
  // The agent's run, with its key removed once step 1 is under way (its key was read for run_workflow and step 1).
  async function removedDuring(title, steps, atStep) {
    const k = await createActKey(`saved-${title.replace(/\W+/g, '-')}`);
    const s = await call(k.token, 'save_workflow', { title, steps });
    assert.equal(s.isError, false, s.text);
    const r = await call(k.token, 'run_workflow', { name: title });
    assert.equal(r.isError, false, r.text);
    const id = r.value.operation;
    await waitFor(async () => (await api(`/jobs/${id}`)).json?.log?.some(l => String(l).includes(`Step ${atStep} of ${steps.length}`)), { timeout: 60000 * SLOW, every: 100, what: `step ${atStep} of ${title} begun` });
    assert.equal((await api(`/jobs/${id}`)).json.status, 'running', `${title} still running when its agent is removed`);
    const del = await api(`/agents/${k.id}`, { method: 'DELETE' });
    assert.equal(del.status, 200, del.text);
    const again = await call(k.token, 'run_workflow', { name: title });
    assert.equal(again.status, 403, `the removed key starts nothing new: ${again.raw}`);
    assert.match(again.raw, /A removed agent’s key stops working\./);
    return opEnd(id, `the agent’s run of ${title}`);
  }
  before(async () => {
    await app('wl-two');
    await app('wl-three');
    writeFileSync(slowFile(), '4');
  }, { timeout: 180000 * SLOW });
  after(() => noSlow());

  test('the rest of the run goes on as it began, and nothing is stopped', { timeout: 300000 * SLOW }, async () => {
    const run = await removedDuring('agent two apps', [{ action: 'keep_running', args: { spark: 'spark4', container: 'wl-web' } }, { action: 'keep_running', args: { spark: 'spark4', container: 'wl-two' } }], 1);
    assert.equal(run.status, 'completed', `${run.error}\n${run.log.join('\n')}`);
    assert.ok(run.log.some(l => /Step 2 done/.test(l)), run.log.join('\n'));
    assert.deepEqual([stateOf('wl-web'), stateOf('wl-two')], ['running', 'running']);
  });

  test('a later step an agent is asked for is still asked; the clean-up stops only what this run started, never a model or app that ran before it', { timeout: 300000 * SLOW }, async () => {
    assert.deepEqual([stateOf(RADIX), stateOf('wl-web'), stateOf('wl-three')], ['running', 'running', 'exited']);
    const run = await removedDuring('agent before and after', [{ action: 'restart_model', args: { spark: 'spark4', container: RADIX } },
      { action: 'keep_running', args: { spark: 'spark4', container: 'wl-web' } }, { action: 'keep_running', args: { spark: 'spark4', container: 'wl-three' } }, AGAIN], 3);
    assert.equal(run.status, 'failed', run.log.join('\n'));
    assert.match(run.error, /^Step 4 \(keep_running\) needs an answer first: Run wl-again on Spark 4 again\? Running a job again is the owner’s call\..* Stopped what this run had started: wl-three on Spark 4\./);
    assert.doesNotMatch(run.error, /This agent was removed|wl-web on Spark 4|sc-RadixArk/, 'only what this run started is stopped');
    assert.deepEqual([stateOf(RADIX), stateOf('wl-web'), stateOf('wl-three'), runs()], ['running', 'running', 'exited', 2]);
    noSlow();
  });
});
