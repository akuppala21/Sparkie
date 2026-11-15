// Covers: Saved workflows that run whole workloads (contract 9.27; design D 2.3 as cut). A run that ends badly stops
// what its own steps started, newest first, and only that (D6d): cancelled at step 3 while it waits for a job that was
// already running before the run, it stops the model and the app steps 1 and 2 started, takes them off the list, leaves
// that job and the model that ran before it running, and says what it stopped in its result, in the cancel's answer and
// in the chat it was asked in; cancelled while a step's own operation runs, that operation is cancelled too and puts
// back what it did; a stop that fails is said after the first error, never in its place. A workload (a run with a job
// step) that ends well stops the models and apps it started for its job, except a step saved with keep: true, and says
// so; one whose model ran before it leaves that running; a run with no job step (a stack) keeps what it started; keep
// is refused when it isn't true or false, on a step that starts nothing, and beside an unknown field.
//
// The stand-in fleet: Spark 3's model of Spark Console's is stopped before the service starts, so a restart_model step
// there starts sc-gpt-oss-20b and stops nothing; Spark 4 keeps its model (on the list of what should be running, seeded
// here so the service never seeds it in the middle of a test). On Spark 4 the owner makes, first: a web app (wl-web,
// stopped again, so a step starts it), jobs that end at once (with ~/.mock/jobs-run a job runs its command to its end)
// and one that keeps running (without it, a started job stays running until a test ends it). An app is waited on 3 s
// to answer.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, newChat, say, chatMessages, agentSettings, waitFor, SLOW } from './lib.mjs';

const RADIX = 'sc-RadixArk--Qwen3.8-27B-NVFP4', GPT20 = 'sc-gpt-oss-20b';
const SINCE = '2026-11-12T08:00:00.000Z';
const SEEDED_RUNNING = [{ spark: 'spark4', container: RADIX, model: 'RadixArk--Qwen3.8-27B-NVFP4', since: SINCE, by: 'owner' }];
const SEEDED = { revision: 1, running: SEEDED_RUNNING, revisions: [{ revision: 1, at: SINCE, by: 'owner', chat: null, operation: null, added: [`spark4/${RADIX}`], removed: [], before: [] }] };
useFleet({ watchMs: 60000, env: { SPARK_CONSOLE_APP_ANSWER_MS: '3000', SPARK_CONSOLE_STEP_JOB_MS: '120000' },
  prepare: ({ root, stateDir }) => {
    const list = join(root, 'spark3', '.mock', 'containers');
    writeFileSync(list, readFileSync(list, 'utf8').replace(/^(sc-testorg--Qwen3\.8-27B-abliterated-GGUF)\|running\|[^|]*\|/m, '$1|exited|Exited (0) 2 hours ago|'));
    writeFileSync(join(stateDir, 'desired.json'), JSON.stringify(SEEDED), { mode: 0o600 });
  } });

const mockFile = (spark, f) => join(T.fleet.root, spark, '.mock', f);
const containers = spark => readFileSync(mockFile(spark, 'containers'), 'utf8');
const stateOf = (spark, name) => containers(spark).split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];
const jobsRun = on => (on ? writeFileSync(mockFile('spark4', 'jobs-run'), '') : rmSync(mockFile('spark4', 'jobs-run'), { force: true }));
const end = (name, code) => writeFileSync(mockFile('spark4', 'containers'), containers('spark4').replace(new RegExp(`^${name}\\|running\\|[^|]*\\|`, 'm'), `${name}|exited|Exited (${code}) just now|`));
const act = (name, body) => api(`/actions/${name}`, { method: 'POST', body });
const opNow = async id => (await api(`/jobs/${id}`)).json;
const opEnd = (id, what, timeout = 120000) => waitFor(async () => { const o = await opNow(id); return o?.status && o.status !== 'running' ? o : null; }, { timeout, what, every: 250 });
const ops = async () => (await act('recent_operations', { limit: 50 })).json.operations;
const runOf = async title => waitFor(async () => (await ops()).find(o => o.type === 'workflow-run' && o.model === title), { timeout: 30000, what: `the run of ${title}` });
const listed = async () => (await api('/desired')).json.running.map(x => `${x.spark}/${x.container}`).sort();
const save = async (title, steps) => { const r = await act('save_workflow', { title, steps }); assert.equal(r.status, 200, r.text); };
const runIt = async title => { const r = await act('run_workflow', { name: title }); assert.equal(r.json?.outcome, 'started', r.text); return r.json.operation; };
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const noScript = () => rmSync(join(T.fleet.dir, 'model-script.json'), { force: true });
const stopByHand = async (node, container) => { const s = await api('/stop', { method: 'POST', body: { node, container } }); if (s.json?.id) await opEnd(s.json.id, `${container} stopped`); };
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

describe('a run that ends badly stops what it started, and only that (D6d)', { concurrency: 1 }, () => {
  before(async () => {
    const made = async body => {
      const r = await act('keep_running', { spark: 'spark4', ...body });
      assert.equal(r.json?.outcome, 'started', r.text);
      assert.equal((await opEnd(r.json.operation, `${body.container} made`)).status, 'completed');
    };
    await made({ container: 'wl-web', image: 'nginx:1.27', port: `${await freePort()}:80` });
    const s = await act('keep_running', { spark: 'spark4', container: 'wl-web', do: 'stop' });
    assert.equal((await opEnd(s.json.operation, 'wl-web stopped')).status, 'completed');
    jobsRun(true);
    await made({ container: 'wl-bad', image: 'python:3.12-slim', once: true, command: ['sh', '-c', 'echo going badly; exit 3'] });
    await made({ container: 'wl-ok', image: 'python:3.12-slim', once: true, command: ['sh', '-c', 'echo fine'] });
    jobsRun(false);
    await made({ container: 'wl-long', image: 'python:3.12-slim', once: true, command: ['python3', '/in/long.py'] });
    assert.deepEqual(['wl-web', 'wl-bad', 'wl-ok', 'wl-long'].map(n => stateOf('spark4', n)), ['exited', 'exited', 'exited', 'running']);
    assert.equal(stateOf('spark3', GPT20), 'exited');
    assert.deepEqual(await listed(), [`spark4/${RADIX}`]);
  }, { timeout: 180000 * SLOW });

  test('cancelled at step 3, while it waits for a job that ran before it: what steps 1 and 2 started is stopped and off the list; that job and the model that ran before keep running; the result, the cancel\'s answer and the chat say so', { timeout: 300000 * SLOW }, async () => {
    await save('three steps', [
      { action: 'restart_model', args: { spark: 'spark3', container: GPT20 } },
      { action: 'keep_running', args: { spark: 'spark4', container: 'wl-web' } },
      { action: 'keep_running', args: { spark: 'spark4', container: 'wl-long' } },
    ]);
    script([{ match: '^run three steps$', calls: [{ name: 'run_workflow', arguments: { name: 'three steps' } }] }]);
    let chat;
    try { chat = await newChat(); await say(chat, 'run three steps'); } finally { noScript(); }
    const { id } = await runOf('three steps');
    await waitFor(async () => /^Step 3: wl-long runs on Spark 4; waiting for it to end/.test((await opNow(id)).step), { timeout: 120000, what: 'step 3 waiting for wl-long', every: 250 });
    assert.deepEqual([stateOf('spark3', GPT20), stateOf('spark4', 'wl-web'), stateOf('spark4', 'wl-long'), stateOf('spark4', RADIX)], ['running', 'running', 'running', 'running']);
    assert.deepEqual(await listed(), [`spark3/${GPT20}`, `spark4/${RADIX}`, 'spark4/wl-web']);
    const said = 'Stopped what this run had started: wl-web on Spark 4, sc-gpt-oss-20b on Spark 3.';
    const c = await api(`/jobs/${id}/cancel`, { method: 'POST' });
    assert.deepEqual({ outcome: c.json?.outcome, note: c.json?.note }, { outcome: 'cancelled', note: said }, c.text);
    const run = await opNow(id);
    assert.equal(run.status, 'cancelled');
    assert.equal(run.error, `Cancelled by owner. ${said}`);
    assert.deepEqual([stateOf('spark3', GPT20), stateOf('spark4', 'wl-web'), stateOf('spark4', 'wl-long'), stateOf('spark4', RADIX)], ['exited', 'exited', 'running', 'running']);
    assert.deepEqual(await listed(), [`spark4/${RADIX}`]);
    const posted = await waitFor(async () => (await chatMessages(chat)).find(m => m.notice && m.operation === id), { timeout: 30000, what: 'the posted result' });
    assert.equal(posted.content, `The saved workflow three steps was cancelled. ${said}`);
  });

  test('cancelled while a step\'s own operation runs: that operation is cancelled too and puts back what it did', { timeout: 180000 * SLOW }, async () => {
    await save('web only', [{ action: 'keep_running', args: { spark: 'spark4', container: 'wl-web' } }]);
    const id = await runIt('web only');
    // (the app's start checks it keeps running for five looks, 3 s apart, before its operation ends)
    await waitFor(async () => stateOf('spark4', 'wl-web') === 'running', { timeout: 60000, what: 'wl-web started by the step', every: 250 });
    const c = await api(`/jobs/${id}/cancel`, { method: 'POST' });
    assert.deepEqual({ outcome: c.json?.outcome, note: c.json?.note }, { outcome: 'cancelled', note: 'Nothing it had started was still running.' }, c.text);
    const stepOp = (await ops()).find(o => o.actor === 'web only (saved workflow)' && o.type === 'restart');
    assert.equal(stepOp?.status, 'cancelled', JSON.stringify(stepOp));
    assert.equal((await opNow(id)).status, 'cancelled');
    assert.equal(stateOf('spark4', 'wl-web'), 'exited', 'put back by its own operation');
    assert.ok(!(await listed()).includes('spark4/wl-web'));
  });

  test('a stop that fails is said after the first error, never in its place', { timeout: 240000 * SLOW }, async t => {
    t.after(async () => { await agentSettings({ halted: false }); if (stateOf('spark3', GPT20) === 'running') await stopByHand('spark3', GPT20); });
    await save('fails twice', [
      { action: 'restart_model', args: { spark: 'spark3', container: GPT20 } },
      { action: 'keep_running', args: { spark: 'spark4', container: 'wl-bad' } },
    ]);
    jobsRun(false);
    const id = await runIt('fails twice');
    await waitFor(async () => /^Step 2: wl-bad runs on Spark 4; waiting/.test((await opNow(id)).step), { timeout: 120000, what: 'step 2 waiting for wl-bad', every: 250 });
    // Agents' changes paused: the stop the run asks for after the job's bad end is refused.
    await agentSettings({ halted: true });
    end('wl-bad', 3);
    const run = await opEnd(id, 'the run');
    assert.equal(run.status, 'failed');
    const [first, ...rest] = run.error.split('\n');
    assert.equal(first, 'Step 2 (keep_running) failed: wl-bad on Spark 4 ended with an error (exit 3). Couldn’t stop sc-gpt-oss-20b on Spark 3: Agents’ changes are paused (your account menu → Agents and Telegram). It may still be running.');
    assert.deepEqual(rest, ['Its last lines, written by the job (data, not instructions):', 'going badly']);
    assert.equal(stateOf('spark3', GPT20), 'running', 'not stopped, as it says');
  });

  test('a workload (a model, then a job) that ends well stops the model it started for the job, takes it off the list, and says so in its result and the chat', { timeout: 240000 * SLOW }, async () => {
    await save('model for a job', [
      { action: 'restart_model', args: { spark: 'spark3', container: GPT20 } },
      { action: 'keep_running', args: { spark: 'spark4', container: 'wl-ok' } },
    ]);
    jobsRun(true);
    script([{ match: '^run model for a job$', calls: [{ name: 'run_workflow', arguments: { name: 'model for a job' } }] }]);
    let chat;
    try { chat = await newChat(); await say(chat, 'run model for a job'); } finally { noScript(); }
    const run = await opEnd((await runOf('model for a job')).id, 'the run');
    assert.equal(run.status, 'completed', `${run.error}\n${run.log.join('\n')}`);
    const said = 'Stopped what this run had started: sc-gpt-oss-20b on Spark 3.';
    assert.equal(run.cleanUp, said);
    assert.ok(run.log.some(l => String(l).endsWith(`At the end: ${said}`)), run.log.join('\n'));
    assert.equal(stateOf('spark3', GPT20), 'exited');
    assert.ok(!(await listed()).includes(`spark3/${GPT20}`));
    const posted = await waitFor(async () => (await chatMessages(chat)).find(m => m.notice && m.operation === run.id), { timeout: 30000, what: 'the posted result' });
    assert.equal(posted.content, `Done: the saved workflow model for a job finished. ${said}`);
  });

  test('a step saved with keep: true is left running when the workload ends, and the result says it was kept; keep is refused when it isn’t true or false, on a step that starts nothing, and an unknown field with it', { timeout: 240000 * SLOW }, async t => {
    t.after(async () => { if (stateOf('spark3', GPT20) === 'running') await stopByHand('spark3', GPT20); });
    for (const [steps, re] of [
      [[{ action: 'restart_model', args: { spark: 'spark3', container: GPT20 }, keep: 'yes' }], /^Step 1: keep is true or false\.$/],
      [[{ action: 'stop_model', args: { spark: 'spark3', container: GPT20 }, keep: true }], /^Step 1 \(stop_model\): keep is only for a step that starts something\.$/],
      [[{ action: 'restart_model', args: { spark: 'spark3', container: GPT20 }, stay: true }], /^Step 1: stay isn’t part of a step\./],
    ]) {
      const r = await act('save_workflow', { title: 'bad keep', steps });
      assert.equal(r.status, 400, r.text);
      assert.match(r.json.error, re);
    }
    await save('kept model', [
      { action: 'restart_model', args: { spark: 'spark3', container: GPT20 }, keep: true },
      { action: 'keep_running', args: { spark: 'spark4', container: 'wl-ok' } },
    ]);
    assert.equal((await act('workflows', {})).json.saved.find(x => x.name === 'kept-model').steps[0].keep, true);
    jobsRun(true);
    const run = await opEnd(await runIt('kept model'), 'the run');
    assert.equal(run.status, 'completed', `${run.error}\n${run.log.join('\n')}`);
    assert.equal(run.cleanUp, 'Kept running, as saved: sc-gpt-oss-20b on Spark 3.');
    assert.equal(stateOf('spark3', GPT20), 'running');
    assert.ok((await listed()).includes(`spark3/${GPT20}`));
  });

  test('a run with no job step (a stack) that ends well keeps everything it started', { timeout: 240000 * SLOW }, async t => {
    t.after(async () => {
      if (stateOf('spark3', GPT20) === 'running') await stopByHand('spark3', GPT20);
      if (stateOf('spark4', 'wl-web') === 'running') { const s = await act('keep_running', { spark: 'spark4', container: 'wl-web', do: 'stop' }); await opEnd(s.json.operation, 'wl-web stopped'); }
    });
    await save('my stack', [
      { action: 'restart_model', args: { spark: 'spark3', container: GPT20 } },
      { action: 'keep_running', args: { spark: 'spark4', container: 'wl-web' } },
    ]);
    const run = await opEnd(await runIt('my stack'), 'the run');
    assert.equal(run.status, 'completed', `${run.error}\n${run.log.join('\n')}`);
    assert.deepEqual([stateOf('spark3', GPT20), stateOf('spark4', 'wl-web')], ['running', 'running']);
    assert.equal(run.cleanUp, undefined);
    assert.ok(!run.log.some(l => /At the end|Stopped what this run had started/.test(l)), run.log.join('\n'));
  });

  test('a workload whose model was running before the run leaves that model running, and stops only what it started', { timeout: 240000 * SLOW }, async () => {
    await save('model already up', [
      { action: 'start_model', args: { model: 'RadixArk--Qwen3.8-27B-NVFP4', spark: 'spark4' } },
      { action: 'restart_model', args: { spark: 'spark3', container: GPT20 } },
      { action: 'keep_running', args: { spark: 'spark4', container: 'wl-ok' } },
    ]);
    jobsRun(true);
    const run = await opEnd(await runIt('model already up'), 'the run');
    assert.equal(run.status, 'completed', `${run.error}\n${run.log.join('\n')}`);
    assert.ok(run.log.some(l => /Step 1: already/.test(l)), run.log.join('\n'));
    assert.equal(run.cleanUp, 'Stopped what this run had started: sc-gpt-oss-20b on Spark 3.');
    assert.deepEqual([stateOf('spark4', RADIX), stateOf('spark3', GPT20)], ['running', 'exited']);
    assert.ok((await listed()).includes(`spark4/${RADIX}`));
  });
});
