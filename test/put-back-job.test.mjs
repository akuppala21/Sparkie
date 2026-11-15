// Covers: A model start that stopped a GPU job with the owner's yes and then failed puts the job back only through the
// job folder check (R38, `putBack`): with the job's folder swapped for a link meanwhile, the job isn't started again
// and the operation's log says why, by name; with its folder a real one again, the same failed start puts it back
// running.
//
// The owner's yes is the page's Deploy with the job on its stop list (POST /deploy). The start fails the known way
// "gated" (a Hugging Face refusal in the model's log). On the stand-in fleet a job runs until it is stopped (Spark 4
// has no ~/.mock/jobs-run); a stop takes ~/.mock/up-<name> away and only a start writes it, so a job not started again
// has none.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, renameSync, symlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, waitFor, SLOW } from './lib.mjs';

const JOB = 'gpu-hold', MODEL = 'gemma-3-12b-it';
useFleet({
  prepare: ({ root }) => {
    // (Spark 4 with nothing running: no hand-started benchmark, none of Spark Console's models; a GPU job starts only
    // where no model runs)
    const f = join(root, 'spark4', '.mock', 'containers');
    writeFileSync(f, readFileSync(f, 'utf8').split('\n').filter(l => l && !l.startsWith('qwen-recipe-aphex3k|'))
      .map(l => (/^sc-[^|]*\|running\|/.test(l) ? l.replace(/\|running\|[^|]*\|/, '|exited|Exited (0) just now|') : l)).join('\n') + '\n');
  },
});

const mock = (spark, file) => join(T.fleet.root, spark, '.mock', file);
const stateOf = (spark, name) => readFileSync(mock(spark, 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];
const started = () => existsSync(mock('spark4', `up-${JOB}`));
const opEnd = id => waitFor(async () => { const o = (await api(`/jobs/${id}`)).json; return o?.status && o.status !== 'running' ? o : null; }, { timeout: 240000, what: `operation ${id} to end`, every: 500 });
// The page's Deploy of the model on Spark 4, the owner having said yes to stopping what its plan stops (the GPU job too).
async function deployStoppingTheJob() {
  const p = (await api(`/deploy/plan?model=${MODEL}&node=spark4`)).json;
  const stops = (p.steps || []).filter(s => s.kind === 'stop');
  assert.ok(stops.some(s => s.container === JOB && s.hold), JSON.stringify(p.steps));
  const r = await api('/deploy', { method: 'POST', body: { model: MODEL, node: 'spark4', keep: [], stop: stops.map(s => `spark4/${s.container}`) } });
  assert.equal(r.status, 202, r.text);
  const w = await opEnd(r.json.id);
  assert.equal(w.status, 'failed', JSON.stringify(w));
  assert.match(w.error, /^It didn’t start: /, JSON.stringify(w));
  return w;
}

describe('a failed start puts back a job it stopped only through the job folder check (R38)', { concurrency: 1 }, () => {
  test('its folder swapped for a link: the job isn’t started again, and the operation says why; its folder real again: it is put back running', { timeout: 420000 * SLOW }, async () => {
    const home = join(T.fleet.root, 'spark4'), jobs = join(home, '.local/share/spark-portal/workspaces/shared/jobs');
    const made = await api('/actions/keep_running', { method: 'POST', body: { spark: 'spark4', container: JOB, image: 'nvcr.io/nvidia/pytorch:25.10-py3', command: ['sleep', 'infinity'], once: true, gpu: true, memoryGB: 8 } });
    assert.equal(made.json?.outcome, 'started', made.text);
    assert.equal((await opEnd(made.json.operation)).status, 'completed');
    assert.equal(stateOf('spark4', JOB), 'running');
    writeFileSync(mock('spark4', `logs-sc-${MODEL}`), 'INFO loading weights\nhuggingface_hub.errors.GatedRepoError: 401 Client Error: Cannot access gated repo\n');
    try {
      // (a walled change may do this while the start runs: the job's folder moved aside and a link to the home put there)
      renameSync(join(jobs, JOB), join(jobs, `${JOB}-aside`));
      symlinkSync(home, join(jobs, JOB));
      const w = await deployStoppingTheJob();
      assert.equal(stateOf('spark4', JOB), 'exited', 'not started again');
      assert.ok(!started(), 'no docker start');
      assert.ok(w.log.some(l => /The job’s folder jobs\/gpu-hold in the shared folder on Spark 4 isn’t a real folder: it is a link, or inside one\. Docker would follow it, so gpu-hold wasn’t started\./.test(l)), w.log.join('\n'));
      assert.ok(!w.log.some(l => /Started gpu-hold on spark4 again/.test(l)), w.log.join('\n'));
      // Its folder real again, the job run again: the same failed start puts it back, running.
      rmSync(join(jobs, JOB), { force: true });
      renameSync(join(jobs, `${JOB}-aside`), join(jobs, JOB));
      const rerun = await api('/actions/keep_running', { method: 'POST', body: { spark: 'spark4', container: JOB } });
      assert.equal(rerun.json?.outcome, 'started', rerun.text);
      assert.equal((await opEnd(rerun.json.operation)).status, 'completed');
      assert.equal(stateOf('spark4', JOB), 'running');
      const again = await deployStoppingTheJob();
      assert.equal(stateOf('spark4', JOB), 'running', 'started again');
      assert.ok(started(), 'docker start ran');
      assert.ok(again.log.some(l => /Started gpu-hold on spark4 again/.test(l)), again.log.join('\n'));
    } finally {
      if (existsSync(join(jobs, `${JOB}-aside`))) { rmSync(join(jobs, JOB), { force: true }); renameSync(join(jobs, `${JOB}-aside`), join(jobs, JOB)); }
      rmSync(mock('spark4', `logs-sc-${MODEL}`), { force: true });
      await api('/actions/keep_running', { method: 'POST', body: { spark: 'spark4', container: JOB, do: 'stop' } }).catch(() => {});
    }
  });
});
