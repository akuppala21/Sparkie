// Covers: A job a saved workflow's run starts from its image is handed the one model address (D7, R57): with a brain that
// answers 4 at once it gets SPARK_MODEL_URL (Spark Console's one address, which answers with its models), SPARK_MODEL_NAME
// "sparkie" and SPARK_MODEL_PARALLEL 2 (its 4 less 2: one place for another app, one for the owner's chat); after a step
// that started or found a model, that model's name and 4 at once; a name the step sets itself is kept; a job run again by
// name is handed nothing (it keeps what it was made with), and so is a job step that names its image when its container
// is there already (the workloads review, C1: it runs again as it was made). A brain that answers one call at a time, or
// whose setup doesn't say it can chat, isn't handed, and the run says why.
//
// A new image in a saved step is the owner's question until a save's yes covers it (D6c), so each run here ends at that
// question, after the settings are added: the question's words list the job's settings exactly as it would run. The
// brain is the "aphex-agent" setup (4 at once) here, the "aphex" one (1 at once) and one that can't chat in fleets of
// their own below. Spark 3's model of Spark Console's is stopped first, so a restart_model step there starts
// sc-gpt-oss-20b.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, request, api, waitFor, SLOW } from './lib.mjs';
import { startMock } from './start-mock.mjs';

const GPT20 = 'sc-gpt-oss-20b', IMAGE = 'python:3.12-slim';
const brainSetup = (setup, change = null) => ({ stateDir }) => {
  const f = join(stateDir, 'main.json'), m = JSON.parse(readFileSync(f, 'utf8'));
  if (change) change(m.presets[setup]);
  writeFileSync(f, JSON.stringify({ ...m, current: setup }), { mode: 0o600 });
};
useFleet({ watchMs: 60000, prepare: x => {
  brainSetup('aphex-agent')(x);
  const list = join(x.root, 'spark3', '.mock', 'containers');
  writeFileSync(list, readFileSync(list, 'utf8').replace(/^(sc-testorg--Qwen3\.8-27B-abliterated-GGUF)\|running\|[^|]*\|/m, '$1|exited|Exited (0) 2 hours ago|'));
} });

const job = (container, extra = {}) => ({ action: 'keep_running', args: { spark: 'spark4', container, image: IMAGE, once: true, command: ['python3', '/in/ask.py'], ...extra } });
// Saves the steps, runs them (as the owner, through POST /actions: no save's yes, so the new image is asked) and gives
// the ended run.
async function runOn(base, origin, title, steps) {
  const json = r => { try { return JSON.parse(r.text); } catch { return null; } };
  const call = async (name, body) => { const r = await request(`${base}/actions/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-spark-console': '1', origin }, body: JSON.stringify(body) }); return { status: r.status, json: json(r) }; };
  const s = await call('save_workflow', { title, steps });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  const r = await call('run_workflow', { name: title });
  assert.equal(r.json?.outcome, 'started', JSON.stringify(r.json));
  return waitFor(async () => { const o = json(await request(`${base}/jobs/${r.json.operation}`)); return o && o.status !== 'running' ? o : null; }, { timeout: 180000, what: `the run of ${title}`, every: 250 });
}
const logOf = o => o.log.map(l => String(l).slice(10));
const handed = (o, n, c) => logOf(o).find(l => l.startsWith(`Step ${n}: ${c} is handed `));

describe('a job is handed the one model address (D7)', { concurrency: 1 }, () => {
  let url;
  test('with no model step: Sparkie\'s address and name, 2 at once; the address answers with its models', { timeout: 180000 * SLOW }, async () => {
    const run = await runOn(T.base, T.origin, 'ask sparkie', [job('wl-a1')]);
    const line = handed(run, 1, 'wl-a1');
    assert.match(line || '', /^Step 1: wl-a1 is handed sparkie at (http:\/\/127\.0\.0\.1:\d+\/console\/api\/v1), 2 at once$/, run.log.join('\n'));
    url = /at (\S+), 2 at once$/.exec(line)[1];
    assert.equal(run.status, 'failed');
    assert.ok(run.error.includes(`with SPARK_MODEL_URL=${url}, SPARK_MODEL_NAME=sparkie, SPARK_MODEL_PARALLEL=2`), run.error);
    const models = await (await fetch(`${url}/models`)).json();
    assert.ok(models.data.some(m => m.id === 'sparkie'), JSON.stringify(models));
  });

  test('after a step that found or started a model: that model\'s name, 4 at once', { timeout: 300000 * SLOW }, async () => {
    const found = await runOn(T.base, T.origin, 'ask radix', [{ action: 'start_model', args: { model: 'RadixArk--Qwen3.8-27B-NVFP4', spark: 'spark4' } }, job('wl-a2')]);
    assert.ok(logOf(found).some(l => /^Step 1: already/.test(l)), found.log.join('\n'));
    const name = /handed (\S+) at /.exec(handed(found, 2, 'wl-a2') || '')?.[1];
    assert.ok(name && /RadixArk/i.test(name), found.log.join('\n'));
    assert.ok(found.error.includes(`with SPARK_MODEL_URL=${url}, SPARK_MODEL_NAME=${name}, SPARK_MODEL_PARALLEL=4`), found.error);
    const started = await runOn(T.base, T.origin, 'ask gpt', [{ action: 'restart_model', args: { spark: 'spark3', container: GPT20 } }, job('wl-a3')]);
    assert.equal(handed(started, 2, 'wl-a3'), `Step 2: wl-a3 is handed gpt-oss-20b at ${url}, 4 at once`, started.log.join('\n'));
    assert.ok(started.error.includes('SPARK_MODEL_NAME=gpt-oss-20b, SPARK_MODEL_PARALLEL=4'), started.error);
  });

  test('a name the step sets itself is kept; a job run again by name is handed nothing', { timeout: 180000 * SLOW }, async () => {
    const own = await runOn(T.base, T.origin, 'own name', [job('wl-a4', { env: ['SPARK_MODEL_NAME=gpt-oss-20b'] })]);
    assert.equal(handed(own, 1, 'wl-a4'), `Step 1: wl-a4 is handed gpt-oss-20b at ${url}, 4 at once`, own.log.join('\n'));
    assert.ok(own.error.includes(`with SPARK_MODEL_NAME=gpt-oss-20b, SPARK_MODEL_URL=${url}, SPARK_MODEL_PARALLEL=4`), own.error);
    assert.equal(own.error.split('SPARK_MODEL_NAME=').length, 2, 'named once');
    // (no image: keep_running with a name only; nothing is added to what the container was made with)
    const again = await runOn(T.base, T.origin, 'by name', [{ action: 'keep_running', args: { spark: 'spark4', container: 'wl-a1' } }]);
    assert.ok(!logOf(again).some(l => /is handed|isn’t handed/.test(l)), again.log.join('\n'));
  });

  // The workloads review's C1: the owner ran a job once (outside a run), then saved it with the arguments it was made
  // with, image included, as "save that as …" keeps them. A run of it runs it again as it was made.
  test('a job step that names its image, with its container there already: handed nothing, it runs again as it was made', { timeout: 180000 * SLOW }, async () => {
    const jobsRun = join(T.fleet.root, 'spark4', '.mock', 'jobs-run');
    const runs = () => { const f = join(T.fleet.root, 'spark4', '.local', 'share', 'spark-portal', 'workspaces', 'shared', 'jobs', 'wl-d7', 'runs.txt'); return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).length : 0; };
    const args = { spark: 'spark4', container: 'wl-d7', image: IMAGE, once: true, command: ['sh', '-c', 'echo ran >> runs.txt'] };
    writeFileSync(jobsRun, '');
    try {
      const made = await api('/actions/keep_running', { method: 'POST', body: args });
      assert.equal(made.json?.outcome, 'started', made.text);
      await waitFor(async () => ['completed', 'failed'].includes((await api(`/jobs/${made.json.operation}`)).json?.status) || null, { timeout: 60000, what: 'wl-d7 made', every: 250 });
      await waitFor(() => runs() === 1 || null, { timeout: 30000, what: 'wl-d7 ran once' });
      const run = await runOn(T.base, T.origin, 'again with its image', [{ action: 'keep_running', args }]);
      assert.equal(run.status, 'completed', `${run.error}\n${run.log.join('\n')}`);
      assert.ok(logOf(run).includes('Step 1: wl-d7 is there already on Spark 4, so it runs again as it was made: a job is handed a model only when it is made'), run.log.join('\n'));
      assert.ok(!logOf(run).some(l => /is handed /.test(l)), run.log.join('\n'));
      assert.equal(runs(), 2, 'the job ran again');
    } finally { rmSync(jobsRun, { force: true }); }
  });
});

// Brains that aren't handed to a job, each on a fleet of its own.
for (const [name, setup, change, why] of [
  ['answers one call at a time', 'aphex', null, 'it answers one call at a time, and that place is the owner’s'],
  ['doesn’t say it can chat', 'aphex-agent', p => { p.can = ['embedding']; }, 'its setup doesn’t say it can chat'],
]) {
  describe(`a brain that ${name} isn't handed to a job (D7)`, { concurrency: 1 }, () => {
    let F;
    before(async () => { F = await startMock({ watchMs: 60000, prepare: brainSetup(setup, change) }); }, { timeout: 180000 });
    after(() => F?.stop(), { timeout: 30000 });
    test(`the run says why, and the job's settings have no model`, { timeout: 180000 * SLOW }, async () => {
      const run = await runOn(F.base, F.origin, 'ask the brain', [job('wl-b1')]);
      assert.ok(logOf(run).includes(`Step 1: wl-b1 isn’t handed Sparkie’s model: ${why}.`), run.log.join('\n'));
      assert.equal(run.status, 'failed');
      assert.ok(!run.error.includes('SPARK_MODEL'), run.error);
    });
  });
}
