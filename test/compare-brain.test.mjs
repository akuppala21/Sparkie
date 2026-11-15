// Covers: compare_models with Sparkie's own model as a candidate, and as the winner (D8, R57; the model review, D2):
// with a brain whose setup answers 4 calls at once, "sparkie" is tried first and its run leaves out the {model} start;
// when it wins it is kept, and the later run with no model given runs the workflow as the compare ran it for the brain
// (its {model} start left out), its job handed sparkie.
//
// The fleet is compare.test.mjs's own, with the brain setup workloads-address.test.mjs uses ("aphex-agent", 4 at
// once). Spark 3's model of Spark Console's is stopped first; on Spark 3 a job runs its command to its end
// (~/.mock/jobs-run) and writes result.json with a score that depends on the model it was handed (SPARK_MODEL_NAME).
// The workload is saved through Sparkie's button (the owner's yes, D6c).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, newChat, say, choose, waitFor, SLOW } from './lib.mjs';

const RADIX = 'sc-RadixArk--Qwen3.8-27B-NVFP4', GPT = 'gpt-oss-20b', IMAGE = 'python:3.12-slim';
const SINCE = '2026-11-12T08:00:00.000Z';
const SEEDED_RUNNING = [{ spark: 'spark4', container: RADIX, model: 'RadixArk--Qwen3.8-27B-NVFP4', since: SINCE, by: 'owner' }];
useFleet({ watchMs: 60000, env: { SPARK_CONSOLE_COMPARE_MS: '600000', SPARK_CONSOLE_STEP_JOB_MS: '600000' },
  prepare: ({ root, stateDir }) => {
    const f = join(stateDir, 'main.json'), m = JSON.parse(readFileSync(f, 'utf8'));
    writeFileSync(f, JSON.stringify({ ...m, current: 'aphex-agent' }), { mode: 0o600 });
    const list = join(root, 'spark3', '.mock', 'containers');
    writeFileSync(list, readFileSync(list, 'utf8').replace(/^(sc-testorg--Qwen3\.8-27B-abliterated-GGUF)\|running\|[^|]*\|/m, '$1|exited|Exited (0) 2 hours ago|'));
    writeFileSync(join(stateDir, 'desired.json'), JSON.stringify({ revision: 1, running: SEEDED_RUNNING, revisions: [{ revision: 1, at: SINCE, by: 'owner', chat: null, operation: null, added: [`spark4/${RADIX}`], removed: [], before: [] }] }), { mode: 0o600 });
    writeFileSync(join(root, 'spark3', '.mock', 'jobs-run'), '');
  } });

const act = (name, body) => api(`/actions/${name}`, { method: 'POST', body });
const opNow = async id => (await api(`/jobs/${id}`)).json;
const opEnd = (id, what, timeout = 300000) => waitFor(async () => { const o = await opNow(id); return o?.status && o.status !== 'running' ? o : null; }, { timeout, what, every: 500 });
const saved = async name => (await act('workflows', {})).json.saved.find(w => w.name === name) || null;
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const noScript = () => rmSync(join(T.fleet.dir, 'model-script.json'), { force: true });
const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const scoring = scores => ['sh', '-c', `case "$SPARK_MODEL_NAME" in ${Object.entries(scores).map(([m, s]) => `*${m}*) s=${s};;`).join(' ')} *) s=0.5;; esac; printf '{"score": %s, "ok": true, "items": %s}' "$s" "$SPARK_SAMPLE" > result.json`];
// The owner's yes: Sparkie's save button, pressed on the page.
async function ownerSaves(title, steps) {
  const words = `make a workflow called ${title}`;
  script([{ match: `^${esc(words)}$`, calls: [{ name: 'save_workflow', arguments: { title, inputs: { model: 'the model', sample: 'how many items' }, steps } }] }]);
  try {
    const chat = await newChat(), r = await say(chat, words);
    assert.deepEqual(r.message.tools.map(x => [x.name, x.outcome ?? null]), [['save_workflow', 'needs-ok']], JSON.stringify(r.message.tools));
    assert.equal((await choose(chat, r.message.choices[0].id)).status, 200);
  } finally { noScript(); }
  assert.deepEqual((await saved(title.replace(/ /g, '-')))?.imagesApproved, [IMAGE]);
}

test('Sparkie’s model wins and is kept; the later run with no model given runs the brain’s view, its job handed sparkie', { timeout: 600000 * SLOW }, async () => {
  await ownerSaves('brain work', [{ action: 'start_model', args: { model: '{model}', spark: 'spark3' } },
    { action: 'keep_running', args: { spark: 'spark3', container: 'brn', image: IMAGE, once: true, command: scoring({ sparkie: 0.9, gpt: 0.6 }) } }]);
  const c = await act('compare_models', { workflow: 'brain work', candidates: [GPT, 'sparkie'], sample: 2 });
  assert.equal(c.json?.outcome, 'started', c.text);
  const op = await opEnd(c.json.operation, 'the compare');
  assert.equal(op.status, 'completed', `${op.error}\n${op.log.join('\n')}`);
  assert.match(op.report[0], /^sparkie: score 0\.9, 2 items, \d+ s$/);
  assert.match(op.report[1], /^gpt-oss-20b: score 0\.6, 2 items, \d+ s$/);
  assert.equal(op.report[2], 'Kept sparkie for “brain work”: a run of it with no model given uses it.');
  // The run it promises.
  const r = await act('run_workflow', { name: 'brain work', inputs: { sample: 3 } });
  assert.equal(r.json?.outcome, 'started', r.text);
  assert.match(r.json.model, /^sparkie: no model was given/);
  const run = await opEnd(r.json.operation, 'the run with no model');
  assert.equal(run.status, 'completed', `${run.error}\n${run.log.join('\n')}`);
  const log = run.log.map(l => String(l).slice(10));
  assert.ok(log.some(l => /^Step 1: brn is handed sparkie at \S+, 2 at once$/.test(l)), log.join('\n'));
  assert.ok(!log.some(l => /start_model/.test(l)), 'no start of a model named sparkie');
  assert.equal((await saved('brain-work'))?.lastRun?.ok, true, 'the run is on the saved workflow’s record');
});
