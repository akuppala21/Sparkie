// Covers: T141 on the stand-in fleet (D8, R57): "run my workload on whatever is best, keep the winner, and let the Sparks
// sleep after", with every compute Spark asleep: the owner's press of Sparkie's button starts the compare; only the
// Spark the candidates need (Spark 3, whose record holds both models) is turned on, never Spark 4; each candidate is
// started, its job placed and scored, and stopped; the winner is kept; nothing holds Spark 3 awake after (it powers off
// again); a look at the Sparks wakes nothing, says how old its answer is and reads "asleep".
//
// T141 (part): only the Spark a candidate needs is woken; each is started, scored and stopped, and the winner kept; a
// look wakes nothing, says how old its answer is, and reads "asleep".
//
// The stand-in fleet as in power-wake.test.mjs: plugs on Sparks 3 (node 2) and 4 (node 3), the stand-in sudo shuts a
// Spark down, each power-off writes its record. Spark 1 is off with no record and no plug. On Spark 3 a job runs its
// command to its end (jobs-run) and writes result.json with a score that depends on the model it was given.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, newChat, say, choose, waitFor, SLOW } from './lib.mjs';
import { startPlugs } from './mock/plugs.mjs';

const GPT = 'gpt-oss-20b', TEST = 'testorg--Qwen3.8-27B-abliterated-GGUF', IMAGE = 'python:3.12-slim';
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
  },
}, async () => {
  plugs.attach({ offlineFile: T.fleet.offlineFile, sparks: { 2: 'spark3', 3: 'spark4' }, bootMs: 1500 });
});

const act = (name, args) => api(`/actions/${name}`, { method: 'POST', body: args });
const look = async (name, args = {}) => { const r = await act(name, args); assert.equal(r.status, 200, r.text); return r.json; };
const offline = () => readFileSync(T.fleet.offlineFile, 'utf8').split(/\s+/).filter(Boolean);
const opEnd = (id, what, timeout = 300000) => waitFor(async () => { const o = (await api(`/jobs/${id}`)).json; return o?.status && o.status !== 'running' ? o : null; }, { timeout, what, every: 500 });
async function done(r) { assert.equal(r.status, 200, r.text); assert.equal(r.json.outcome, 'started', r.text); const w = await opEnd(r.json.operation, 'the operation'); assert.equal(w.status, 'completed', JSON.stringify(w)); }
async function sleepSpark(spark) {
  for (const m of (await look('running_models')).models.filter(x => x.spark === spark && x.container?.startsWith('sc-'))) await done(await act('stop_model', { spark, container: m.container }));
  await done(await act('power_off', { spark }));
  assert.ok(offline().includes(spark));
}
const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const noScript = () => rmSync(join(T.fleet.dir, 'model-script.json'), { force: true });

describe('T141: whatever is best, the winner kept, the Sparks asleep (D8)', { concurrency: 1 }, () => {
  before(async () => {
    // The workload, saved through Sparkie's button (the owner's yes to its job's image): a start and a job, neither
    // naming a Spark.
    const words = 'make a workflow called best work';
    const steps = [
      { action: 'start_model', args: { model: '{model}' } },
      { action: 'keep_running', args: { container: 't141', image: IMAGE, once: true, command: ['sh', '-c', `case "{model}" in *gpt*) s=0.9;; *) s=0.6;; esac; printf '{"score": %s, "ok": true, "items": %s}' "$s" "{sample}" > result.json`] } },
    ];
    script([{ match: `^${esc(words)}$`, calls: [{ name: 'save_workflow', arguments: { title: 'best work', inputs: { model: 'the model', sample: 'how many items' }, steps } }] }]);
    try { const chat = await newChat(), r = await say(chat, words); assert.equal((await choose(chat, r.message.choices[0].id)).status, 200); } finally { noScript(); }
    for (const spark of ['spark3', 'spark4']) await sleepSpark(spark);
  }, { timeout: 300000 * SLOW });

  test('only Spark 3 is turned on; each candidate is started, scored and stopped; the winner is kept; nothing holds Spark 3 after; a look wakes nothing and reads asleep', { timeout: 600000 * SLOW }, async t => {
    const words = 'run my workload on whatever is best, keep the winner, and let the Sparks sleep after';
    // (and the carry-on turn the request may get once the compare ends says only words)
    script([{ match: `^${esc(words)}$`, calls: [{ name: 'compare_models', arguments: { workflow: 'best work', candidates: [GPT, TEST], sample: 3 } }] }, { match: '^\\[Spark Console\\]', calls: [] }]);
    t.after(noScript);
    const before = plugs.commands.length;
    const chat = await newChat(), r = await say(chat, words);
    // (Sparkie chose the candidates and the words don't name the workflow: a button, pressed by the owner)
    assert.deepEqual(r.message.tools.map(x => [x.name, x.outcome ?? null]), [['compare_models', 'needs-ok']], JSON.stringify(r.message.tools));
    assert.equal((await choose(chat, r.message.choices[0].id)).status, 200);
    const op = await waitFor(async () => (await look('recent_operations', { limit: 50 })).operations.find(o => o.type === 'compare'), { timeout: 30000, what: 'the compare' });
    const ended = await opEnd(op.id, 'the compare');
    assert.equal(ended.status, 'completed', `${ended.error}\n${ended.log.join('\n')}`);
    assert.match(ended.report[0], /^gpt-oss-20b: score 0\.9, 3 items, \d+ s$/, ended.report.join('\n'));
    assert.match(ended.report[1], /^testorg--Qwen3\.8-27B-abliterated-GGUF: score 0\.6, 3 items, \d+ s$/);
    assert.equal(ended.report[2], 'Kept gpt-oss-20b for “best work”: a run of it with no model given uses it.');
    assert.deepEqual(plugs.commands.slice(before), [{ node: 2, command: 'on' }], 'only Spark 3, never Spark 4 or Spark 2');
    assert.ok(offline().includes('spark4') && !offline().includes('spark3'));
    assert.ok(!(await look('running_models')).models.some(x => x.spark === 'spark3' && x.container?.startsWith('sc-')), 'each candidate stopped');
    assert.equal((await look('workflows')).saved.find(w => w.name === 'best-work')?.best?.model, GPT);
    // Nothing holds Spark 3 awake after: it powers off again.
    await done(await act('power_off', { spark: 'spark3' }));
    // A look wakes nothing, says how old its answer is, and reads asleep.
    const n = plugs.commands.length;
    const disk = await look('models_on_disk');
    const asleep = Object.fromEntries(disk.asleep.map(a => [a.spark, a]));
    assert.deepEqual(Object.keys(asleep).sort(), ['spark3', 'spark4'], JSON.stringify(disk.asleep));
    assert.match(asleep.spark4.words, /^Spark 4 is asleep since \d{4}-\d\d-\d\d \d\d:\d\d UTC; \d+ models on its disk then\. A look doesn’t wake it\.$/);
    await new Promise(res => setTimeout(res, 3000));
    assert.deepEqual(plugs.commands.slice(n), [], 'the look switched no plug');
  });
});
