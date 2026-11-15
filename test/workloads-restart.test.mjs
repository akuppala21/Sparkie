// Covers: A restart of Spark Console in the middle of a saved workflow's run (D6f, R57): the run keeps what it started
// in saved-runs.json as it goes, and at start-up what it started is stopped newest first under a failure's rules, one
// notice says so (in the chat that asked too), the generic "start it again" line isn't given, nothing runs again and the
// note is gone. Cut off while it waits on a job; cut off while step 2's own start runs (an app not yet on the list);
// a workload with keep: true (that step's model stays); a restart with no run under way changes nothing; cut off inside
// a start step, the start's own line is given and the run's notice never says nothing was still running (the workloads
// review, C5).
//
// The stand-in fleet as in workloads.test.mjs: Spark 3's model of Spark Console's is stopped first, so a restart_model
// step there starts sc-gpt-oss-20b; on Spark 4 the owner has made a web app (wl-web, stopped again) and a job (wl-long)
// that, run again without ~/.mock/jobs-run, stays running until it is stopped. Each test ends the service at once
// (SIGKILL: no clean-up runs) and starts it again on the same state, as systemd does.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { T, useFleet, api, newChat, say, chatMessages, eventLines, waitFor, sleep, SERVICE_FILE, REPO, SLOW } from './lib.mjs';

const RADIX = 'sc-RadixArk--Qwen3.8-27B-NVFP4', GPT20 = 'sc-gpt-oss-20b';
const SINCE = '2026-11-12T08:00:00.000Z';
const SEEDED_RUNNING = [{ spark: 'spark4', container: RADIX, model: 'RadixArk--Qwen3.8-27B-NVFP4', since: SINCE, by: 'owner' }];
let current = null;   // the service started again by a test, on the same state
after(() => { try { current?.kill('SIGKILL'); } catch {} });
useFleet({ watchMs: 60000, env: { SPARK_CONSOLE_APP_ANSWER_MS: '3000', SPARK_CONSOLE_STEP_JOB_MS: '600000' },
  prepare: ({ root, stateDir }) => {
    const list = join(root, 'spark3', '.mock', 'containers');
    writeFileSync(list, readFileSync(list, 'utf8').replace(/^(sc-testorg--Qwen3\.8-27B-abliterated-GGUF)\|running\|[^|]*\|/m, '$1|exited|Exited (0) 2 hours ago|'));
    writeFileSync(join(stateDir, 'desired.json'), JSON.stringify({ revision: 1, running: SEEDED_RUNNING, revisions: [{ revision: 1, at: SINCE, by: 'owner', chat: null, operation: null, added: [`spark4/${RADIX}`], removed: [], before: [] }] }), { mode: 0o600 });
  } });

const mockFile = (spark, f) => join(T.fleet.root, spark, '.mock', f);
const containers = spark => readFileSync(mockFile(spark, 'containers'), 'utf8');
const stateOf = (spark, name) => containers(spark).split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];
const jobsRun = on => (on ? writeFileSync(mockFile('spark4', 'jobs-run'), '') : rmSync(mockFile('spark4', 'jobs-run'), { force: true }));
const act = (name, body) => api(`/actions/${name}`, { method: 'POST', body });
const opNow = async id => (await api(`/jobs/${id}`)).json;
const opEnd = (id, what) => waitFor(async () => { const o = await opNow(id); return o?.status && o.status !== 'running' ? o : null; }, { timeout: 120000, what, every: 250 });
const listed = async () => (await api('/desired')).json.running.map(x => `${x.spark}/${x.container}`).sort();
const save = async (title, steps) => { const r = await act('save_workflow', { title, steps }); assert.equal(r.status, 200, r.text); };
const runIt = async title => { const r = await act('run_workflow', { name: title }); assert.equal(r.json?.outcome, 'started', r.text); return r.json.operation; };
const noteFile = () => join(T.fleet.stateDir, 'saved-runs.json');
const note = () => { try { return JSON.parse(readFileSync(noteFile(), 'utf8')); } catch { return null; } };
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const STEP_ONE = { action: 'restart_model', args: { spark: 'spark3', container: GPT20 } };
// Spark Console ends at once (a crash: nothing of its own clean-up runs), and comes back on the same state.
async function restart() {
  if (current) { const gone = new Promise(r => current.once('exit', r)); current.kill('SIGKILL'); await gone; }
  else { process.kill(T.fleet.servicePid(), 'SIGKILL'); await waitFor(() => T.fleet.serviceExit(), { timeout: 10000, what: 'the service to end' }); }
  current = spawn(process.execPath, [SERVICE_FILE], { cwd: REPO, env: T.fleet.env, stdio: 'ignore' });
  await waitFor(async () => (await api('/health').catch(() => null))?.status === 200, { timeout: 30000, what: 'the service back' });
}
const noticesSince = since => eventLines().filter(e => e.at >= since && e.type === 'notice');
async function stopByHand(node, container) { const s = await api('/stop', { method: 'POST', body: { node, container } }); if (s.json?.id) await opEnd(s.json.id, `${container} stopped`); }

describe('a restart in the middle of a saved workflow\'s run (D6f)', { concurrency: 1 }, () => {
  before(async () => {
    const web = await act('keep_running', { spark: 'spark4', container: 'wl-web', image: 'nginx:1.27', port: `${await freePort()}:80` });
    assert.equal((await opEnd(web.json.operation, 'wl-web made')).status, 'completed');
    const s = await act('keep_running', { spark: 'spark4', container: 'wl-web', do: 'stop' });
    assert.equal((await opEnd(s.json.operation, 'wl-web stopped')).status, 'completed');
    jobsRun(true);
    const j = await act('keep_running', { spark: 'spark4', container: 'wl-long', image: 'python:3.12-slim', once: true, command: ['sh', '-c', 'echo made'] });
    assert.equal((await opEnd(j.json.operation, 'wl-long made')).status, 'completed');
    jobsRun(false);
    assert.deepEqual([stateOf('spark4', 'wl-web'), stateOf('spark4', 'wl-long'), stateOf('spark3', GPT20)], ['exited', 'exited', 'exited']);
  }, { timeout: 120000 * SLOW });

  test('cut off while it waits on a job: at start-up the job and the model it started are stopped, one notice says so in the chat too, and nothing runs again', { timeout: 300000 * SLOW }, async () => {
    await save('model and job', [STEP_ONE, { action: 'keep_running', args: { spark: 'spark4', container: 'wl-long' } }]);
    writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify([{ match: '^run model and job$', calls: [{ name: 'run_workflow', arguments: { name: 'model and job' } }] }]));
    let chat;
    try { chat = await newChat(); await say(chat, 'run model and job'); } finally { rmSync(join(T.fleet.dir, 'model-script.json'), { force: true }); }
    const run = await waitFor(async () => (await act('recent_operations', { limit: 50 })).json.operations.find(o => o.type === 'workflow-run' && o.model === 'model and job'), { timeout: 30000, what: 'the run' });
    await waitFor(async () => /^Step 2: wl-long runs on Spark 4; waiting/.test((await opNow(run.id)).step), { timeout: 120000, what: 'step 2 waiting', every: 250 });
    const kept = note()?.runs?.[run.id];
    assert.deepEqual({ step: kept?.step, started: kept?.started?.map(x => `${x.kind} ${x.spark}/${x.container}`) }, { step: 2, started: [`model spark3/${GPT20}`, 'job spark4/wl-long'] }, JSON.stringify(kept));
    const since = new Date().toISOString();
    await restart();
    const said = `A restart of Spark Console cut off the saved workflow “model and job” at step 2 of 2. Stopped what this run had started: wl-long on Spark 4, ${GPT20} on Spark 3. Nothing was run again: ask for it again if it’s still wanted.`;
    await waitFor(() => noticesSince(since).some(e => e.text === said), { timeout: 120000, what: 'the notice' });
    assert.deepEqual([stateOf('spark4', 'wl-long'), stateOf('spark3', GPT20), stateOf('spark4', RADIX)], ['exited', 'exited', 'running']);
    assert.ok(!existsSync(noteFile()), 'the note is gone');
    assert.ok(!(await listed()).includes(`spark3/${GPT20}`));
    const posted = await waitFor(async () => (await chatMessages(chat)).filter(m => m.notice && m.content === said), { timeout: 30000, what: 'the line in the chat' });
    assert.equal(posted.length, 1);
    await sleep(2000);
    const told = noticesSince(since);
    assert.ok(!told.some(e => /cut off workflow-run|Check it’s running/.test(e.text)), JSON.stringify(told));
    assert.ok(eventLines().some(e => e.type === 'operation' && e.id === run.id && e.status === 'interrupted'), 'the run is marked interrupted');
    assert.ok(!(await act('recent_operations', { limit: 50 })).json.operations.some(o => o.type === 'workflow-run'), 'nothing was run again');
  });

  test('cut off while step 2\'s own start runs: what step 1 started and the app step 2 was bringing up are stopped, and neither is left on the list', { timeout: 300000 * SLOW }, async () => {
    await save('model and web', [STEP_ONE, { action: 'keep_running', args: { spark: 'spark4', container: 'wl-web' } }]);
    const id = await runIt('model and web');
    // (the app's start looks five times, 3 s apart, before its operation ends: Docker has started it by then)
    await waitFor(() => stateOf('spark4', 'wl-web') === 'running' && note()?.runs?.[id]?.pending?.length === 1, { timeout: 120000, what: 'step 2 under way', every: 200 });
    assert.deepEqual(note().runs[id].pending.map(x => `${x.kind} ${x.spark}/${x.container}`), ['app spark4/wl-web']);
    const since = new Date().toISOString();
    await restart();
    const said = `A restart of Spark Console cut off the saved workflow “model and web” at step 2 of 2. Stopped what this run had started: wl-web on Spark 4, ${GPT20} on Spark 3. Nothing was run again: ask for it again if it’s still wanted.`;
    await waitFor(() => noticesSince(since).some(e => e.text === said), { timeout: 120000, what: 'the notice' });
    assert.deepEqual([stateOf('spark4', 'wl-web'), stateOf('spark3', GPT20)], ['exited', 'exited']);
    assert.deepEqual(await listed(), [`spark4/${RADIX}`]);
    await sleep(2000);
    assert.ok(!noticesSince(since).some(e => /Check it’s running/.test(e.text)), JSON.stringify(noticesSince(since)));
  });

  test('a workload with keep: true: cut off in its job wait, the job is stopped and the kept model stays, as the notice says', { timeout: 300000 * SLOW }, async t => {
    t.after(async () => { if (stateOf('spark3', GPT20) === 'running') await stopByHand('spark3', GPT20); });
    await save('kept model and job', [{ ...STEP_ONE, keep: true }, { action: 'keep_running', args: { spark: 'spark4', container: 'wl-long' } }]);
    const id = await runIt('kept model and job');
    await waitFor(async () => /^Step 2: wl-long runs on Spark 4; waiting/.test((await opNow(id)).step), { timeout: 120000, what: 'step 2 waiting', every: 250 });
    const since = new Date().toISOString();
    await restart();
    const said = `A restart of Spark Console cut off the saved workflow “kept model and job” at step 2 of 2. Stopped what this run had started: wl-long on Spark 4. Kept running, as saved: ${GPT20} on Spark 3. Nothing was run again: ask for it again if it’s still wanted.`;
    await waitFor(() => noticesSince(since).some(e => e.text === said), { timeout: 120000, what: 'the notice' });
    assert.deepEqual([stateOf('spark4', 'wl-long'), stateOf('spark3', GPT20)], ['exited', 'running']);
  });

  test('a restart with no run under way changes nothing', { timeout: 120000 * SLOW }, async () => {
    assert.ok(!existsSync(noteFile()));
    const before = ['spark3', 'spark4'].map(containers).join('\n---\n'), since = new Date().toISOString();
    await restart();
    await sleep(5000);
    assert.equal(['spark3', 'spark4'].map(containers).join('\n---\n'), before, 'no container changed');
    assert.ok(!noticesSince(since).some(e => /saved workflow/.test(e.text)), JSON.stringify(noticesSince(since)));
    assert.ok(!existsSync(noteFile()));
  });

  // C5: the start's container is known only once its operation ends, so the run can't stop it; its own line says so.
  test('cut off inside a start step: the start\'s own line is given, and the run\'s notice never says nothing was still running', { timeout: 300000 * SLOW }, async t => {
    t.after(async () => { if (stateOf('spark3', GPT20) === 'running') await stopByHand('spark3', GPT20); });
    assert.equal(stateOf('spark3', GPT20), 'exited');
    await save('start and look', [{ action: 'start_model', args: { model: 'gpt-oss-20b', spark: 'spark3' } }, { action: 'should_be_running', args: {} }]);
    const id = await runIt('start and look');
    // (Docker has started the model's container; the start's own operation still waits for it to answer)
    await waitFor(() => (stateOf('spark3', GPT20) === 'running' && note()?.runs?.[id]?.step === 1) || null, { timeout: 120000, what: 'the start under way', every: 100 });
    const since = new Date().toISOString();
    await restart();
    const cut = await waitFor(() => noticesSince(since).find(e => /cut off the saved workflow “start and look”/.test(e.text)) || null, { timeout: 120000, what: 'the run’s notice' });
    assert.equal(cut.text, 'A restart of Spark Console cut off the saved workflow “start and look” at step 1 of 2. The start at step 1 was still under way: its own line says what to check. Nothing was run again: ask for it again if it’s still wanted.');
    const told = noticesSince(since).map(e => e.text);
    assert.ok(told.some(x => /^A restart of Spark Console cut off (deploy|start-model|deploy-cluster) .*Check it’s running/.test(x)), JSON.stringify(told));
    assert.ok(!told.some(x => /Nothing it had started was still running/.test(x)), JSON.stringify(told));
  });
});
