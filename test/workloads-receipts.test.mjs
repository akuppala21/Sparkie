// Covers: A saved workflow's clean-up stops only what its run started (A-22, R57): each item it started keeps a receipt
// (its Docker id; a model's or app's entry `since` on the list of what should be running; a job's start time), looked at
// again inside the stop's own claim. While the run waits on a job, the owner stops and starts that model again (a new
// container), or asks to start it and is told it already runs, or stops it and restarts the same container: at the run's
// end (well, failed or cancelled) the model keeps running, stays on the list, and the result says it was left. A job the
// owner ran again by hand after the run's job step is left when a later step fails. A run nobody touched still stops
// what it started, and a model self-healing brought back during the run is still the run's and is stopped.
// From a chat, the clean-up's stop that left the model running says so there and never "finished", and isn't counted
// as a run of stop_model (its validation).
//
// The stand-in fleet as in the round-two check (a2-cleanup): Spark 3 with none of Spark Console's models running and a
// new id for each container made there; on Spark 4 a job (rc-long) that runs until the test ends it, and start times
// stamped as they happen. Self-healing looks every 2 s.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, waitFor, eventLines, newChat, say, chatMessages, SLOW } from './lib.mjs';

const RADIX = 'sc-RadixArk--Qwen3.8-27B-NVFP4', GPT20 = 'sc-gpt-oss-20b';
const SINCE = '2026-11-12T08:00:00.000Z';
const SEEDED = { revision: 1, running: [{ spark: 'spark4', container: RADIX, model: 'RadixArk--Qwen3.8-27B-NVFP4', since: SINCE, by: 'owner' }],
  revisions: [{ revision: 1, at: SINCE, by: 'owner', chat: null, operation: null, added: [`spark4/${RADIX}`], removed: [], before: [] }] };
useFleet({ watchMs: 2000, statusMs: 3000,
  env: { SPARK_CONSOLE_APP_ANSWER_MS: '3000', SPARK_CONSOLE_STEP_JOB_MS: '900000', SPARK_CONSOLE_HEAL_MS: '2000', SPARK_CONSOLE_HEAL_SETTLE_MS: '3000',
    SPARK_CONSOLE_HEAL_OFFLINE_MS: '1000', SPARK_CONSOLE_HEAL_MIN_RUN_MS: '1' },
  prepare: ({ root, stateDir }) => {
    const list = join(root, 'spark3', '.mock', 'containers');
    writeFileSync(list, readFileSync(list, 'utf8').replace(/^(sc-testorg--Qwen3\.8-27B-abliterated-GGUF)\|running\|[^|]*\|/m, '$1|exited|Exited (0) 2 hours ago|'));
    writeFileSync(join(root, 'spark3', '.mock', 'ids-per-run'), '');
    for (const sp of ['spark3', 'spark4']) writeFileSync(join(root, sp, '.mock', 'stamp-starts'), '');
    writeFileSync(join(stateDir, 'desired.json'), JSON.stringify(SEEDED), { mode: 0o600 });
  } });

const mockFile = (spark, f) => join(T.fleet.root, spark, '.mock', f);
const containers = spark => readFileSync(mockFile(spark, 'containers'), 'utf8');
const stateOf = (spark, name) => containers(spark).split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];
const idOf = (spark, name) => readFileSync(mockFile(spark, `id-${name}`), 'utf8').trim();
const setState = (spark, name, state, status) => writeFileSync(mockFile(spark, 'containers'), containers(spark).replace(new RegExp(`^${name}\\|[^|]*\\|[^|]*\\|`, 'm'), `${name}|${state}|${status}|`));
const end = (name, code) => setState('spark4', name, 'exited', `Exited (${code}) just now`);
const act = (name, body) => api(`/actions/${name}`, { method: 'POST', body });
const opNow = async id => (await api(`/jobs/${id}`)).json;
const opEnd = (id, what, timeout = 300000 * SLOW) => waitFor(async () => { const o = await opNow(id); return o?.status && o.status !== 'running' ? o : null; }, { timeout, what, every: 250 });
const listed = async () => (await api('/desired')).json.running.map(x => `${x.spark}/${x.container}`);
const done = async r => { assert.equal(r.json?.outcome, 'started', r.text); return opEnd(r.json.operation, 'an operation'); };
const ownerStop = async () => { const s = await api('/stop', { method: 'POST', body: { node: 'spark3', container: GPT20 } }); assert.equal(s.status, 202, s.text); assert.equal((await opEnd(s.json.id, 'the owner’s stop')).status, 'completed'); };
const LEFT = 'Left running: sc-gpt-oss-20b on Spark 3 was started again since, not by this run.';
const stopRecord = () => { try { return JSON.parse(readFileSync(join(T.fleet.stateDir, 'validations.json'), 'utf8')).stop_model || null; } catch { return null; } };

// Before each run: the job runs, and gpt-oss-20b is stopped and off the list, so the run's step 1 starts it.
async function ready() {
  if (stateOf('spark4', 'rc-long') !== 'running') assert.equal((await done(await act('keep_running', { spark: 'spark4', container: 'rc-long' }))).status, 'completed');
  if (stateOf('spark3', GPT20) === 'running') await ownerStop();
  assert.deepEqual([stateOf('spark4', 'rc-long'), stateOf('spark3', GPT20)], ['running', 'exited']);
}
// A run of "rc eval" to the moment it waits on its job.
async function toStep2() {
  const r = await act('run_workflow', { name: 'rc eval' });
  assert.equal(r.json?.outcome, 'started', r.text);
  return atStep2(r.json.operation);
}
async function atStep2(id) {
  await waitFor(async () => /^Step 2: rc-long runs on Spark 4; waiting for it to end/.test((await opNow(id)).step), { timeout: 240000 * SLOW, what: 'step 2 waiting for rc-long', every: 250 });
  assert.equal(stateOf('spark3', GPT20), 'running');
  return id;
}
// How the run ends: its job ends well, or with an error, or the run is cancelled.
async function finish(id, how) {
  if (how === 'well') end('rc-long', 0);
  else if (how === 'fails') end('rc-long', 3);
  else { const c = await api(`/jobs/${id}/cancel`, { method: 'POST', body: {} }); assert.equal(c.status, 200, c.text); }
  const o = await opEnd(id, 'the run to end');
  assert.equal(o.status, { well: 'completed', fails: 'failed', cancelled: 'cancelled' }[how], JSON.stringify(o));
  return o;
}
// What the owner does while the run waits.
const TOUCH = {
  async 'stops it and starts it again (a new container)'() {
    const before = idOf('spark3', GPT20);
    await ownerStop();
    assert.equal((await done(await act('start_model', { model: 'gpt-oss-20b', spark: 'spark3' }))).status, 'completed');
    assert.notEqual(idOf('spark3', GPT20), before, 'a new container under the same name');
  },
  async 'asks to start it, and is told it already runs'() {
    const a = await act('start_model', { model: 'gpt-oss-20b', spark: 'spark3' });
    assert.equal(a.json?.outcome, 'already', a.text);
  },
  async 'stops it and restarts the same container'() {
    const before = idOf('spark3', GPT20);
    await ownerStop();
    assert.equal((await done(await act('restart_model', { spark: 'spark3', container: GPT20 }))).status, 'completed');
    assert.equal(idOf('spark3', GPT20), before, 'the same container');
  },
};

describe('a saved workflow\'s clean-up stops only what its run started (A-22)', { concurrency: 1 }, () => {
  before(async () => {
    const r = await act('keep_running', { spark: 'spark4', container: 'rc-long', image: 'python:3.12-slim', once: true, command: ['python3', '/in/long.py'] });
    assert.equal((await done(r)).status, 'completed');
    const s = await act('save_workflow', { title: 'rc eval', steps: [
      { action: 'start_model', args: { model: 'gpt-oss-20b', spark: 'spark3' } },
      { action: 'keep_running', args: { spark: 'spark4', container: 'rc-long' } },
    ] });
    assert.equal(s.status, 200, s.text);
  }, { timeout: 180000 * SLOW });

  test('nobody touched it: the run stops what it started, as before', { timeout: 600000 * SLOW }, async () => {
    await ready();
    const o = await finish(await toStep2(), 'well');
    assert.equal(o.cleanUp, 'Stopped what this run had started: sc-gpt-oss-20b on Spark 3.');
    assert.equal(stateOf('spark3', GPT20), 'exited');
    assert.ok(!(await listed()).includes(`spark3/${GPT20}`));
  });

  for (const [touch, how] of [['stops it and starts it again (a new container)', 'well'], ['stops it and starts it again (a new container)', 'fails'],
    ['stops it and starts it again (a new container)', 'cancelled'], ['asks to start it, and is told it already runs', 'well'],
    ['asks to start it, and is told it already runs', 'fails'], ['asks to start it, and is told it already runs', 'cancelled'],
    ['stops it and restarts the same container', 'well']]) {
    test(`the owner ${touch} while the run waits; the run ${how === 'well' ? 'ends well' : how === 'fails' ? 'fails' : 'is cancelled'}: the model keeps running, stays on the list, and the result says it was left`, { timeout: 600000 * SLOW }, async () => {
      await ready();
      const id = await toStep2();
      await TOUCH[touch]();
      const id0 = idOf('spark3', GPT20);
      const o = await finish(id, how);
      assert.ok(String(o.cleanUp).includes(LEFT), `${o.cleanUp}`);
      assert.ok(!String(o.cleanUp).includes('Stopped what this run had started: sc-gpt-oss-20b'), o.cleanUp);
      assert.equal(stateOf('spark3', GPT20), 'running', 'the owner’s model runs');
      assert.equal(idOf('spark3', GPT20), id0, 'the same container');
      assert.ok((await listed()).includes(`spark3/${GPT20}`), 'and stays on the list');
    });
  }

  test('from a chat: the clean-up\'s stop that left the model running says so there, never "finished", and isn\'t counted as a run of stop_model', { timeout: 600000 * SLOW }, async () => {
    await ready();
    writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify([{ match: '^run rc eval from this chat$', calls: [{ name: 'run_workflow', arguments: { name: 'rc eval' } }] }]));
    let chat;
    try { chat = await newChat(); await say(chat, 'run rc eval from this chat'); } finally { rmSync(join(T.fleet.dir, 'model-script.json'), { force: true }); }
    const run = await waitFor(async () => (await act('recent_operations', { limit: 50 })).json.operations.find(o => o.type === 'workflow-run' && o.status === 'running'), { timeout: 30000 * SLOW, what: 'the run' });
    const id = await atStep2(run.id);
    await TOUCH['asks to start it, and is told it already runs']();
    const before = stopRecord();
    const o = await finish(id, 'well');
    assert.ok(String(o.cleanUp).includes(LEFT), `${o.cleanUp}`);
    await waitFor(async () => (await chatMessages(chat)).some(m => m.notice && m.operation === id), { timeout: 30000 * SLOW, what: 'the run’s result in the chat' });
    const said = (await chatMessages(chat)).filter(m => m.notice).map(m => m.content);
    assert.ok(!said.some(l => /^Done: stopping sc-gpt-oss-20b/.test(l)), said.join('\n'));
    assert.ok(said.includes(LEFT), said.join('\n'));
    assert.deepEqual(stopRecord(), before, 'the left stop isn’t a run of stop_model');
    assert.equal(stateOf('spark3', GPT20), 'running');
  });

  test('a model self-healing brought back during the run is still the run\'s: it is stopped at the end', { timeout: 600000 * SLOW }, async () => {
    await ready();
    const id = await toStep2();
    const since = new Date().toISOString();
    setState('spark3', GPT20, 'exited', 'Exited (1) just now');
    await waitFor(() => eventLines().some(e => e.at >= since && e.type === 'healing' && e.container === GPT20), { timeout: 120000 * SLOW, what: 'self-healing to bring it back' });
    await waitFor(() => stateOf('spark3', GPT20) === 'running', { timeout: 120000 * SLOW, what: 'it running again' });
    await waitFor(async () => !(await act('recent_operations', { limit: 50 })).json.operations.some(x => x.type === 'restart' && x.status === 'running'), { timeout: 120000 * SLOW, what: 'the restart to finish' });
    const o = await finish(id, 'well');
    assert.equal(o.cleanUp, 'Stopped what this run had started: sc-gpt-oss-20b on Spark 3.');
    assert.equal(stateOf('spark3', GPT20), 'exited');
  });

  test('a job the owner ran again by hand after the run\'s job step, then a later step fails: the job is left running', { timeout: 600000 * SLOW }, async () => {
    for (const name of ['rc-first', 'rc-second']) {
      const r = await act('keep_running', { spark: 'spark4', container: name, image: 'python:3.12-slim', once: true, command: ['python3', `/in/${name}.py`] });
      assert.equal((await done(r)).status, 'completed');
    }
    const s = await act('save_workflow', { title: 'rc jobs', steps: [{ action: 'keep_running', args: { spark: 'spark4', container: 'rc-first' } }, { action: 'keep_running', args: { spark: 'spark4', container: 'rc-second' } }] });
    assert.equal(s.status, 200, s.text);
    for (const name of ['rc-first', 'rc-second']) end(name, 0);
    const r = await act('run_workflow', { name: 'rc jobs' });
    assert.equal(r.json?.outcome, 'started', r.text);
    const id = r.json.operation;
    await waitFor(async () => /^Step 1: rc-first runs on Spark 4; waiting/.test((await opNow(id)).step), { timeout: 120000 * SLOW, what: 'step 1 waiting', every: 250 });
    end('rc-first', 0);
    await waitFor(async () => /^Step 2: rc-second runs on Spark 4; waiting/.test((await opNow(id)).step), { timeout: 120000 * SLOW, what: 'step 2 waiting', every: 250 });
    // (the owner runs the first job again by hand, while the second one runs)
    assert.equal((await done(await act('keep_running', { spark: 'spark4', container: 'rc-first' }))).status, 'completed');
    assert.equal(stateOf('spark4', 'rc-first'), 'running');
    end('rc-second', 3);
    const o = await opEnd(id, 'the run to end');
    assert.equal(o.status, 'failed', JSON.stringify(o));
    assert.ok(String(o.cleanUp).includes('Left running: rc-first on Spark 4 was started again since, not by this run.'), o.cleanUp);
    assert.equal(stateOf('spark4', 'rc-first'), 'running', 'the owner’s run of the job goes on');
    end('rc-first', 0);
  });
});
