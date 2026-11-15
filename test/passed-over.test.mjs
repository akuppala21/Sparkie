// Covers: Lessons used at a start (B3, R48; contract 5.10). A setup that failed twice the same known way, with no
// success between, is passed over while its image, its Sparks and its start code are what the start would use, and the
// result and the operation's log name it; one failure, or two of different kinds, is still tried; a new start code
// tries it again, and its success clears it. When every setup there is failed twice: an agent and Sparkie get a
// question whose yes tries it, the owner's own request runs it and says so, and other Sparks or a new image try it
// again with no question. A failure whose cause is outside the setup (a sign-in) never passes it over. A lessons.json
// that can't be read (garbage, or a folder) passes nothing over. A context cut to fit (out of memory) isn't locked in:
// with more free memory than when it was cut, the full context goes first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, mkdirSync, closeSync, openSync, truncateSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, call, createKey, createActKey, newChat, say, choose, REPO, SLOW } from './lib.mjs';

const VLLM = JSON.parse(readFileSync(join(REPO, 'service', 'config.json'), 'utf8')).images.vllm;
// Models made for this file, so nothing else has run them: pass-b3 on Spark 3, with two runs that worked here on record
// (the faster first); only-b3 on Spark 3 and 4, whose only setup is its own (its spark.json names its image); gemma-b3
// on Spark 4, the same (the stand-in stops any gemma while it loads); ctx-b3 on Spark 3, with nothing on record.
const PASS = 'pass-b3', ONLY = 'only-b3', GEMMA = 'gemma-b3', CTX = 'ctx-b3';
const FAST = ['--max-model-len', '65536'], SLOWER = ['--max-model-len', '16384'];
const IMG_A = `vllm/vllm-openai@sha256:${'a1'.repeat(32)}`, IMG_B = `vllm/vllm-openai@sha256:${'b2'.repeat(32)}`;
// The stand-in engine's log for gemma-b3: a Hugging Face refusal, a known failure with no fix (one attempt).
const GATED = 'INFO loading weights\nhuggingface_hub.errors.GatedRepoError: 401 Client Error: Cannot access gated repo\n';
const worked = (args, tokS) => ({ key: JSON.stringify([PASS, 'vllm', VLLM, 1, args, {}]), model: PASS, repo: null, title: PASS, engine: 'vllm', image: VLLM, args,
  env: {}, sparks: 1, nodes: ['spark3'], firstAt: '2026-11-10T00:00:00Z', lastAt: '2026-11-10T00:00:00Z', runs: 1, best: { decodeTokS: tokS, ttftMs: 100 } });
function addModel(root, spark, name, manifest, like) {
  const d = join(root, spark, 'models', name);
  mkdirSync(d, { recursive: true });
  copyFileSync(join(root, 'spark3', 'models', like, 'config.json'), join(d, 'config.json'));
  closeSync(openSync(join(d, 'model.safetensors'), 'w'));
  truncateSync(join(d, 'model.safetensors'), 1000000);
  writeFileSync(join(d, 'spark.json'), JSON.stringify(manifest));
}

const keys = {};
useFleet({ watchMs: 60000, prepare: ({ root, stateDir }) => {
  addModel(root, 'spark3', PASS, { title: 'Pass B3', engine: 'vllm', args: [], memoryGiB: 8 }, 'gpt-oss-20b');
  for (const sp of ['spark3', 'spark4']) addModel(root, sp, ONLY, { title: 'Only B3', engine: 'vllm', image: IMG_A, args: [], memoryGiB: 8 }, 'gpt-oss-20b');
  addModel(root, 'spark4', GEMMA, { title: 'Gemma B3', engine: 'vllm', image: IMG_A, args: [], memoryGiB: 8 }, 'gemma-3-12b-it');
  addModel(root, 'spark3', CTX, { title: 'Ctx B3', engine: 'vllm', args: [], memoryGiB: 8 }, 'gpt-oss-20b');
  // (the faster one far faster than the stand-in measures, so it stays first after the other runs again)
  writeFileSync(join(stateDir, 'verified.json'), JSON.stringify({ deployments: [worked(FAST, 100000), worked(SLOWER, 40)] }), { mode: 0o600 });
} }, async () => { keys.look = await createKey('po-look'); keys.act = await createActKey('po-act'); });

const mock = (spark, file) => join(T.fleet.root, spark, '.mock', file);
const lessonsFile = () => join(T.fleet.stateDir, 'lessons.json');
const lessons = () => { try { return JSON.parse(readFileSync(lessonsFile(), 'utf8')).lessons; } catch { return []; } };
const about = model => lessons().filter(l => l.subject?.model === model);
const kinds = model => about(model).map(l => [l.failure, l.state, l.failed]).sort();
const lastArgs = spark => readFileSync(mock(spark, 'last-run-args'), 'utf8').split('\n').join(' ');
const silent = on => (on ? writeFileSync(join(T.fleet.dir, 'serve-silent'), '') : rmSync(join(T.fleet.dir, 'serve-silent'), { force: true }));
const jobOf = async id => (await api(`/jobs/${id}`)).json;
// The owner's own call (POST /actions): its failed operations never pause agents, and these fail on purpose.
async function asOwner(name, args) {
  const r = await api(`/actions/${name}`, { method: 'POST', body: args });
  assert.equal(r.status, 200, `${name} ${JSON.stringify(args)}: ${r.status} ${r.text}`);
  return r.json;
}
async function start(args) {
  const out = await asOwner('start_model', args);
  assert.equal(out?.outcome, 'started', `start_model ${JSON.stringify(args)}: ${JSON.stringify(out)}`);
  return out;
}
async function finished(id) {
  for (const until = Date.now() + 300000 * SLOW; ;) {
    const r = await call(keys.look.token, 'wait_operation', { id, seconds: 20 });
    assert.equal(r.isError, false, r.text);
    if (r.value.status !== 'running') return r.value;
    if (Date.now() > until) throw new Error(`operation ${id} still running`);
  }
}
async function stopped(spark, container) {
  const out = await asOwner('stop_model', { spark, container });
  assert.equal((await finished(out.operation)).status, 'completed');
}
const NO_ANSWER = 'it loaded but didn’t answer a test prompt';
const PASSED = /^Passed over a run that worked here before: it failed 2 times the same way on Spark 3 \(it loaded but didn’t answer a test prompt\), last on \d{4}-\d\d-\d\d, with the image, Sparks and start code this start would use \(lesson (l_[0-9a-f]{8})\)\./;

// T106 (part): the third start passes the setup that failed twice the same known way over and says so; after a change
// (here its start code) it is tried again.
test('a setup that failed twice the same known way is passed over, and the result names it; one failure, or two of different kinds, is still tried; a new start code tries it again, and its success clears it', { timeout: 900000 * SLOW }, async () => {
  // 1. The faster run that worked here goes first, and loads but doesn't answer: one lesson.
  silent(true);
  let a;
  try {
    a = await start({ model: PASS, spark: 'spark3' });
    assert.equal(a.passedOver, undefined, JSON.stringify(a));
    assert.equal((await finished(a.operation)).status, 'failed');
  } finally { silent(false); }
  assert.ok(lastArgs('spark3').includes('--max-model-len 65536'), lastArgs('spark3'));
  const fast = (await jobOf(a.operation)).setupTried;
  assert.equal(fast?.how, 'proven', JSON.stringify(fast));
  assert.deepEqual(kinds(PASS), [['no-answer', 'seen', 1]]);
  // 2. One failure: it is still tried, and runs out of memory (a second kind).
  writeFileSync(mock('spark3', 'oom-ctx'), '1024');
  try {
    const b = await start({ model: PASS, spark: 'spark3' });
    assert.equal(b.passedOver, undefined, JSON.stringify(b));
    assert.equal((await finished(b.operation)).status, 'failed');
    assert.equal((await jobOf(b.operation)).setupTried.flags, fast.flags, 'one failure: still tried');
  } finally { rmSync(mock('spark3', 'oom-ctx'), { force: true }); }
  assert.deepEqual(kinds(PASS), [['no-answer', 'seen', 1], ['out-of-memory', 'seen', 1]]);
  // 3. Two failures of different kinds: still tried. It doesn't answer again: the same known way twice.
  silent(true);
  try {
    const c = await start({ model: PASS, spark: 'spark3' });
    assert.equal(c.passedOver, undefined, JSON.stringify(c));
    assert.equal((await finished(c.operation)).status, 'failed');
    assert.equal((await jobOf(c.operation)).setupTried.flags, fast.flags, 'two kinds: still tried');
  } finally { silent(false); }
  assert.deepEqual(kinds(PASS), [['no-answer', 'proven', 2], ['out-of-memory', 'seen', 1]]);
  const proven = about(PASS).find(l => l.failure === 'no-answer');
  // 4. The third start passes it over for the next run that worked here, and says so in its result and its log.
  const d = await start({ model: PASS, spark: 'spark3' });
  assert.equal(d.passedOver?.length, 1, JSON.stringify(d));
  assert.match(d.passedOver[0], PASSED);
  assert.equal(PASSED.exec(d.passedOver[0])[1], proven.id);
  const wd = await finished(d.operation);
  assert.equal(wd.status, 'completed', JSON.stringify(wd));
  assert.notEqual((await jobOf(d.operation)).setupTried.flags, fast.flags);
  assert.ok(lastArgs('spark3').includes('--max-model-len 16384'), lastArgs('spark3'));
  const logD = (await jobOf(d.operation)).log;
  assert.ok(logD.some(l => l.includes(d.passedOver[0])), logD.join('\n'));
  assert.deepEqual(kinds(PASS), [['no-answer', 'proven', 2], ['out-of-memory', 'seen', 1]], 'another setup\'s success leaves them');
  // 5. Written by an earlier start code: tried again. It works, and that takes its lessons out.
  writeFileSync(lessonsFile(), JSON.stringify({ lessons: lessons().map(l => (l.id === proven.id ? { ...l, tried: { ...l.tried, code: '0123456789ab' } } : l)) }), { mode: 0o600 });
  await stopped('spark3', `sc-${PASS}`);
  const e = await start({ model: PASS, spark: 'spark3' });
  assert.equal(e.passedOver, undefined, JSON.stringify(e));
  assert.equal((await finished(e.operation)).status, 'completed');
  assert.equal((await jobOf(e.operation)).setupTried.flags, fast.flags);
  assert.deepEqual(about(PASS), [], 'its success takes its lessons out');
  // 6. And from then on it goes first again.
  await stopped('spark3', `sc-${PASS}`);
  const f = await start({ model: PASS, spark: 'spark3' });
  assert.equal(f.passedOver, undefined, JSON.stringify(f));
  assert.equal((await jobOf(f.operation)).setupTried.flags, fast.flags);
  assert.equal((await finished(f.operation)).status, 'completed');
});

test('when every setup there is failed twice: an agent and Sparkie are asked and a yes tries it, the owner\'s own request runs it and says so, and other Sparks or a new image try it again', { timeout: 900000 * SLOW }, async () => {
  const ASKED = /^only-b3’s only setup here, its own setup \(its spark\.json, or the engine’s defaults\), failed 2 times the same way on Spark 4 \(it loaded but didn’t answer a test prompt\), last on \d{4}-\d\d-\d\d, with the same image, Sparks and start code\. Try it again anyway\?$/;
  const LABELS = ['Yes, try only-b3 with it again', 'No, leave it'];
  // Every start here loads and doesn't answer: a failure of the setup's own, so it counts.
  silent(true);
  try {
    for (const n of [1, 2]) {
      const x = await start({ model: ONLY, spark: 'spark4' });
      assert.equal(x.passedOver, undefined, `start ${n}: ${JSON.stringify(x)}`);
      assert.equal((await finished(x.operation)).status, 'failed');
    }
    assert.deepEqual(about(ONLY).map(x => [x.failure, x.state, x.failed, x.tried.how, x.tried.image, x.tried.on]), [['no-answer', 'proven', 2, 'own', IMG_A, 'spark4']]);
    // An agent's start: a question, and nothing started.
    const q = await call(keys.act.token, 'start_model', { model: ONLY, spark: 'spark4' });
    assert.equal(q.isError, false, q.text);
    assert.equal(q.value.outcome, 'question', JSON.stringify(q.value));
    assert.equal(q.value.operation, undefined);
    assert.match(q.value.question, ASKED);
    assert.deepEqual(q.value.choices.map(c => c.label), LABELS);
    // Sparkie, in the owner's chat: the same question, as buttons. The yes tries it, and its log says why.
    writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify([{ match: '^please start only-b3', calls: [{ name: 'start_model', arguments: { model: ONLY, spark: 'spark4' } }] }]));
    const chat = await newChat();
    const r = await say(chat, 'please start only-b3 on spark 4');
    assert.deepEqual(r.message.choices?.map(c => c.label), LABELS, JSON.stringify(r.message));
    assert.equal(about(ONLY)[0].failed, 2, 'asking starts nothing');
    const p = await choose(chat, r.message.choices[0].id);
    assert.equal(p.status, 200, p.text);
    assert.equal(p.json.outcome, 'started', p.text);
    assert.equal((await finished(p.json.operation)).status, 'failed');
    const logP = (await jobOf(p.json.operation)).log;
    assert.ok(logP.some(x => x.includes(`Tried again as asked, though its own setup (its spark.json, or the engine’s defaults) failed 2 times the same way on Spark 4 (${NO_ANSWER}), last on `)), logP.join('\n'));
    assert.equal(about(ONLY)[0].failed, 3);
    // The owner's own request: it runs, and its result says so.
    const own = await start({ model: ONLY, spark: 'spark4' });
    assert.match(own.passedOver?.[0] || '', /^Tried again at the owner’s own request, though its own setup \(its spark\.json, or the engine’s defaults\) failed 3 times the same way on Spark 4 \(it loaded but didn’t answer a test prompt\), last on [\d-]+: it is the only setup there is \(lesson l_[0-9a-f]{8}\)\.$/, JSON.stringify(own));
    assert.equal((await finished(own.operation)).status, 'failed');
    assert.equal(about(ONLY)[0].failed, 4);
    // A new image: tried with nothing passed over; failing again, its lesson is written anew from one.
    // (on every Spark that holds it: the library reads a model's spark.json from its preferred home, Spark 3)
    const was = about(ONLY)[0];
    for (const sp of ['spark3', 'spark4']) {
      const manifest = join(T.fleet.root, sp, 'models', ONLY, 'spark.json');
      writeFileSync(manifest, readFileSync(manifest, 'utf8').replace(IMG_A, IMG_B));
    }
    for (const n of [1, 2]) {
      const x = await start({ model: ONLY, spark: 'spark4' });
      assert.equal(x.passedOver, undefined, `start ${n} with the new image: ${JSON.stringify(x)}`);
      assert.equal((await finished(x.operation)).status, 'failed');
    }
    assert.deepEqual(about(ONLY).map(x => [x.id, x.tried.image, x.tried.on, x.state, x.failed]), [[was.id, IMG_B, 'spark4', 'proven', 2]]);
    // Other Sparks: an agent's start goes ahead, with no question and nothing passed over.
    const other = await call(keys.act.token, 'start_model', { model: ONLY, spark: 'spark3' });
    assert.equal(other.value?.outcome, 'started', other.text);
    assert.equal(other.value.passedOver, undefined);
    assert.equal((await finished(other.value.operation)).status, 'failed');
    assert.deepEqual(about(ONLY).map(x => [x.tried.on, x.state, x.failed]), [['spark3', 'seen', 1]]);
  } finally {
    silent(false);
    rmSync(join(T.fleet.dir, 'model-script.json'), { force: true });
  }
});

test('a failure whose cause is outside the setup never passes it over: a model that needs a sign-in, twice, is tried a third time with no question', { timeout: 600000 * SLOW }, async () => {
  writeFileSync(mock('spark4', `logs-sc-${GEMMA}`), GATED);
  try {
    for (const n of [1, 2]) {
      const x = await start({ model: GEMMA, spark: 'spark4' });
      assert.equal(x.passedOver, undefined, `start ${n}: ${JSON.stringify(x)}`);
      assert.equal((await finished(x.operation)).status, 'failed');
    }
    // The lesson is kept as it is (B2): proven. It just doesn't pass the setup over.
    assert.deepEqual(kinds(GEMMA), [['gated', 'proven', 2]]);
    const x = await call(keys.act.token, 'start_model', { model: GEMMA, spark: 'spark4' });
    assert.equal(x.value?.outcome, 'started', x.text);
    assert.equal(x.value.passedOver, undefined);
    assert.equal((await finished(x.value.operation)).status, 'failed');
    assert.deepEqual(kinds(GEMMA), [['gated', 'proven', 3]]);
  } finally { rmSync(mock('spark4', `logs-sc-${GEMMA}`), { force: true }); }
});

test('a context cut to fit isn\'t locked in: with more free memory than when it was cut, the full context goes first', { timeout: 600000 * SLOW }, async () => {
  const meminfo = readFileSync(mock('spark3', 'meminfo'), 'utf8');
  const runs = () => JSON.parse(readFileSync(join(T.fleet.stateDir, 'verified.json'), 'utf8')).deployments.filter(x => x.model === CTX);
  writeFileSync(mock('spark3', 'oom-ctx'), '32768');
  try {
    // Out of memory with its full context: started with 32,768 tokens, and that run kept with the free memory it had.
    const a = await start({ model: CTX, spark: 'spark3' });
    const wa = await finished(a.operation);
    assert.equal(wa.status, 'completed', JSON.stringify(wa));
    assert.deepEqual(wa.fixed, { problems: ['out-of-memory'], gaveUp: 'a context of 32,768 tokens' });
    assert.deepEqual(runs().map(x => x.args), [['--max-model-len', '32768']]);
    const cut = runs()[0].contextCut;
    assert.ok(Number.isFinite(cut?.free) && cut.free > 0, JSON.stringify(runs()[0]));
    // The same free memory: that run goes first as it is, with no attempt that runs out of memory.
    await stopped('spark3', `sc-${CTX}`);
    const b = await start({ model: CTX, spark: 'spark3' });
    assert.equal((await finished(b.operation)).status, 'completed');
    const logB = (await jobOf(b.operation)).log;
    assert.ok(!logB.some(l => /Known problem|full context/.test(l)), logB.join('\n'));
    assert.ok(lastArgs('spark3').includes('--max-model-len 32768'), lastArgs('spark3'));
    // 20 GB more free than when it was cut: its full context goes first, and now it fits.
    await stopped('spark3', `sc-${CTX}`);
    rmSync(mock('spark3', 'oom-ctx'), { force: true });
    const kb = Number(/^MemAvailable:\s+(\d+) kB$/m.exec(meminfo)[1]);
    writeFileSync(mock('spark3', 'meminfo'), meminfo.replace(/^MemAvailable:.*$/m, `MemAvailable:   ${kb + 20 * 1048576} kB`));
    const c = await start({ model: CTX, spark: 'spark3' });
    assert.equal((await finished(c.operation)).status, 'completed');
    const logC = (await jobOf(c.operation)).log;
    assert.ok(logC.some(l => /Trying its full context first: \d+ GB is free on Spark 3 now, \d+ GB when its context was cut to fit/.test(l)), logC.join('\n'));
    assert.ok(!logC.some(l => /Known problem/.test(l)), logC.join('\n'));
    assert.ok(!lastArgs('spark3').includes('--max-model-len'), lastArgs('spark3'));
  } finally {
    writeFileSync(mock('spark3', 'meminfo'), meminfo);
    rmSync(mock('spark3', 'oom-ctx'), { force: true });
  }
});

test('a lessons.json that can\'t be read passes nothing over: garbage, or a folder of that name', { timeout: 600000 * SLOW }, async () => {
  silent(true);
  try {
    // only-b3 on Spark 3 fails a second time the same way (the test before left it seen once): an agent is asked.
    assert.equal((await finished((await start({ model: ONLY, spark: 'spark3' })).operation)).status, 'failed');
    assert.deepEqual(about(ONLY).map(x => [x.tried.on, x.state, x.failed]), [['spark3', 'proven', 2]]);
    const q = await call(keys.act.token, 'start_model', { model: ONLY, spark: 'spark3' });
    assert.equal(q.value?.outcome, 'question', q.text);
    // Garbage, with no copy from before the last save to put back: the agent's start runs as if there were no lessons.
    writeFileSync(lessonsFile(), '{"lessons": [ this is not JSON', { mode: 0o600 });
    rmSync(`${lessonsFile()}.prev`, { force: true });
    const g = await call(keys.act.token, 'start_model', { model: ONLY, spark: 'spark3' });
    assert.equal(g.value?.outcome, 'started', g.text);
    assert.equal(g.value.passedOver, undefined);
    assert.equal((await finished(g.value.operation)).status, 'failed');
    // A folder where the file should be: it can't be read at all, and the start still runs.
    rmSync(lessonsFile(), { recursive: true, force: true });
    rmSync(`${lessonsFile()}.prev`, { force: true });
    mkdirSync(lessonsFile());
    const d = await call(keys.act.token, 'start_model', { model: ONLY, spark: 'spark3' });
    assert.equal(d.value?.outcome, 'started', d.text);
    assert.equal(d.value.passedOver, undefined);
    assert.equal((await finished(d.value.operation)).status, 'failed');
  } finally {
    silent(false);
    rmSync(lessonsFile(), { recursive: true, force: true });
  }
});
