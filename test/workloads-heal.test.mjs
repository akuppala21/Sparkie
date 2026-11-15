// Covers: A model across Spark 3 and Spark 4 that was on the list of what should be running before a saved workflow's
// run (held), started again by a step and stopped by the run's clean-up, goes back on the list marked putBack, and
// self-healing leaves it alone, also once Spark Console's own memory of that stop is gone (a restart here; 15 minutes on
// the Sparks); the mark goes when it next runs (R57; the workloads review, C4).
//
// The fleet is heal-more.test.mjs's own (a healing pass every 2 s, Sparks settled after 3 s), with the least run time
// set to 1 ms so that the pair counts as having run long enough to be brought back. The test ends the service at once
// (SIGKILL: nothing of its own clean-up runs) and starts it again on the same state, as systemd does.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { T, REPO, SERVICE_FILE, useFleet, api, call, createKey, createActKey, agentSettings, eventLines, waitFor, sleep, SLOW } from './lib.mjs';

const keys = {};
const MODEL = 'RadixArk--Qwen3.8-27B-NVFP4', HEAD = `sc-${MODEL}`;
const DFLASH = ['--context-length', '1000000', '--speculative-algorithm', 'DFLASH', '--speculative-num-draft-tokens', '16', '--tp-size', '1', '--mem-fraction-static', '0.8'];
const brainRun = { key: JSON.stringify([MODEL, 'sglang', 'lmsysorg/sglang:v0.5.23', 1, DFLASH, {}]), model: MODEL, repo: 'RadixArk/Qwen3.8-27B-NVFP4',
  title: 'Qwen 3.8 27B', engine: 'sglang', image: 'lmsysorg/sglang:v0.5.23', args: DFLASH, env: {},
  sparks: 1, nodes: ['spark2'], firstAt: '2026-11-08T00:00:00Z', lastAt: '2026-11-08T00:00:00Z', runs: 1, best: { decodeTokS: 30, ttftMs: 100 }, brain: true };
let current = null;   // the service started again by the test, on the same state
after(() => { try { current?.kill('SIGKILL'); } catch {} });
useFleet({ watchMs: 2000, statusMs: 3000,
  env: { SPARK_CONSOLE_HEAL_MS: '2000', SPARK_CONSOLE_HEAL_SETTLE_MS: '3000', SPARK_CONSOLE_HEAL_OFFLINE_MS: '1000', SPARK_CONSOLE_HEAL_MIN_RUN_MS: '1',
    SPARK_CONSOLE_CONNECT_MS: String(20000 * SLOW) },
  prepare: ({ stateDir }) => writeFileSync(join(stateDir, 'verified.json'), JSON.stringify({ deployments: [brainRun] }), { mode: 0o600 }),
}, async () => { keys.look = await createKey('wl-heal'); keys.act = await createActKey('wl-heal-act'); });

const mock = (spark, file) => join(T.fleet.root, spark, '.mock', file);
const lines = spark => readFileSync(mock(spark, 'containers'), 'utf8').split('\n').filter(Boolean);
const partsOf = () => ['spark3', 'spark4'].flatMap(sp => lines(sp).filter(l => l.split('|')[4] === MODEL && l.split('|')[7] === 'spark3+spark4').map(l => ({ spark: sp, name: l.split('|')[0], state: l.split('|')[1] })));
// (stopped outside Spark Console: its line says exited, and it no longer answers)
function stopOutside(spark, name) {
  const f = mock(spark, 'containers');
  writeFileSync(f, readFileSync(f, 'utf8').replace(new RegExp(`^(${name.replace(/[.+]/g, '\\$&')})\\|running\\|[^|]*\\|`, 'm'), '$1|exited|Exited (0) just now|'));
  rmSync(mock(spark, `up-${name}`), { force: true });
}
async function finished(id) {
  for (const until = Date.now() + 240000 * SLOW; ;) {
    const w = (await call(keys.look.token, 'wait_operation', { id, seconds: 30 })).value;
    if (w.status !== 'running') return w;
    assert.ok(Date.now() < until, 'still running');
  }
}
const act = (name, body) => api(`/actions/${name}`, { method: 'POST', body });
const entry = async () => (await api('/desired')).json.running.find(x => x.container === HEAD && x.sparks?.join('+') === 'spark3+spark4');
const healing = since => eventLines().filter(e => e.at >= since && e.type === 'healing' && e.container === HEAD);
// Spark Console ends at once and comes back on the same state: its memory of its own stops is gone.
async function restart() {
  if (current) { const gone = new Promise(r => current.once('exit', r)); current.kill('SIGKILL'); await gone; }
  else { process.kill(T.fleet.servicePid(), 'SIGKILL'); await waitFor(() => T.fleet.serviceExit(), { timeout: 10000, what: 'the service to end' }); }
  current = spawn(process.execPath, [SERVICE_FILE], { cwd: REPO, env: T.fleet.env, stdio: 'ignore' });
  await waitFor(async () => (await api('/health').catch(() => null))?.status === 200, { timeout: 30000, what: 'the service back' });
}

test('a listed pair a run started again and its clean-up stopped goes back on the list marked putBack: self-healing leaves it alone after a restart, and the mark goes when it next runs', { timeout: 900000 * SLOW }, async () => {
  // The owner starts it across Spark 3 and Spark 4: it is on the list.
  const r = await call(keys.act.token, 'start_model', { model: MODEL, sparks: ['spark3', 'spark4'] });
  assert.equal(r.isError, false, r.text);
  assert.equal((await finished(r.value.operation)).status, 'completed');
  assert.ok(await entry(), 'on the list');
  await waitFor(async () => (await call(keys.look.token, 'workloads', { spark: 'spark4', detail: true })).value.workloads.some(w => w.labels?.['spark.cluster'] && w.running), { what: 'the watcher seeing the part' });
  // Automatic restarts off while both parts are stopped outside Spark Console: on the list, not running (held).
  await agentSettings({ selfHeal: false });
  for (const p of partsOf()) stopOutside(p.spark, p.name);
  assert.deepEqual(partsOf().map(p => p.state), ['exited', 'exited']);
  // A saved workflow starts it again, then fails at its next step: the clean-up stops it and puts its entry back.
  const s = await act('save_workflow', { title: 'pair then nothing', steps: [{ action: 'start_model', args: { model: MODEL, sparks: ['spark3', 'spark4'] } }, { action: 'keep_running', args: { spark: 'spark4', container: 'wl-nope' } }] });
  assert.equal(s.status, 200, s.text);
  const run = await act('run_workflow', { name: 'pair then nothing' });
  assert.equal(run.json?.outcome, 'started', run.text);
  const ended = await finished(run.json.operation);
  assert.equal(ended.status, 'failed', JSON.stringify(ended.recentLog));
  assert.match(String(ended.error), /Stopped what this run had started: [^.]*sc-RadixArk--Qwen3\.8-27B-NVFP4 on Spark 3\. Still on the list of what should be running, as before this run: /, ended.error);
  assert.deepEqual(partsOf().map(p => p.state), ['exited', 'exited']);
  assert.match(String((await entry())?.putBack), /^\d{4}-\d\d-\d\dT/, 'put back with its mark');
  // Automatic restarts on again, and Spark Console's memory of its own stop gone with a restart: nothing brings it back.
  await agentSettings({ selfHeal: true });
  const since = new Date().toISOString();
  await restart();
  await sleep(25000);
  assert.deepEqual(healing(since).map(e => e.why), [], 'self-healing left the put-back pair alone');
  assert.deepEqual(partsOf().map(p => p.state), ['exited', 'exited']);
  // The owner starts it again: it runs, and the mark goes.
  const again = await call(keys.act.token, 'start_model', { model: MODEL, sparks: ['spark3', 'spark4'] });
  assert.equal(again.isError, false, again.text);
  assert.equal((await finished(again.value.operation)).status, 'completed');
  const now = await entry();
  assert.ok(now && now.putBack === undefined, JSON.stringify(now));
});
