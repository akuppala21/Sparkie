// Covers: Workflows (docs/contract.md, sections 6 and 15), with nothing counted as validated here: the list (versions,
// when to use each, known problems; also through the door and `/health`); an agent's plain call doesn't run an
// unvalidated workflow but is offered the validation run as a choice (v3.1); the owner's first run from a button (428,
// then `X-Spark-Validate`) validates it and has to answer a test prompt; then agents can; starting across two Sparks is
// validated on its own; a version not in the lock is off everywhere; a model that loads but doesn't answer fails and
// what it stopped runs again; out of memory → tried again with the context capped, and that setup recorded; 3 failed
// attempts → put back, with what was tried; out of memory is never cut below 16,384 tokens by itself (A-26): at 16,384
// it starts and says so, below that it fails after three tries and puts back what it stopped, and the fix's next
// context is never under 16,384; a rejected setting is dropped by name and the result says so; a stop is
// checked; from the owner's chat the first restart asks once (a button, not a typed "yes"), one that doesn't answer is
// stopped again, and the next validates it. stop_model's version holds every name its look at a saved workflow's receipt
// reads (A-22), but the ways to a Spark.
//
// Workflows (docs/contract.md, section 6): every change is a named workflow with a version (a fingerprint of its code),
// and runs only once that version is tested (the suite passed with it: workflows.lock.json) and validated (a run on the
// Sparks passed its check). The first run, taken on purpose, is the validation run: the owner's, or (v3.1) an agent's
// that may change things, by the choice it's offered; an agent's plain call doesn't run an unvalidated one. A start is
// done only when the model answers a test prompt, and known problems are fixed and tried
// again by the workflow itself, up to 3 attempts, putting back what it stopped when it gives up.
// This file's service counts nothing as validated (SPARK_CONSOLE_ASSUME_VALIDATED=0), unlike the others.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { T, REPO, useFleet, api, call, createKey, createActKey, eventLines, waitFor, newChat, say, choose, SLOW } from './lib.mjs';
import { startMock } from './start-mock.mjs';

const keys = {};
useFleet({ watchMs: 60000, statusMs: 20000, knowledge: true, env: { SPARK_CONSOLE_ASSUME_VALIDATED: '0' } }, async () => {
  keys.look = await createKey('wf-look');
  keys.act = await createActKey('wf-act');
});

const mock = (spark, file) => join(T.fleet.root, spark, '.mock', file);
const stateOf = (spark, name) => readFileSync(mock(spark, 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];
async function ok(name, args, token = keys.act.token) {
  const r = await call(token, name, args);
  assert.equal(r.isError, false, `${name} ${JSON.stringify(args)}: ${r.text}`);
  return r.value;
}
async function refused(name, args, re, token = keys.act.token) {
  const r = await call(token, name, args);
  assert.equal(r.isError, true, `${name} should be refused: ${r.text}`);
  assert.match(r.text, re);
  return r.text;
}
// (a start with three attempts takes ~3 minutes on the stand-in fleet under the whole suite's load)
async function finished(id) {
  for (const until = Date.now() + 300000 * SLOW; ;) {
    const w = await ok('wait_operation', { id, seconds: 20 }, keys.look.token);
    if (w.status !== 'running') return w;
    if (Date.now() > until) throw new Error(`operation ${id} still running: ${JSON.stringify(w)}`);
  }
}
const workflows = async () => Object.fromEntries((await api('/workflows')).json.workflows.map(w => [w.id, w]));
// The page's deploy body for a model on a Spark: stop only what has to stop (Spark Console's own model there), keep the rest.
async function deployBody(model, node) {
  const p = (await api(`/deploy/plan?model=${encodeURIComponent(model)}&node=${node}`)).json;
  const stops = p.steps.filter(s => s.kind === 'stop');
  return { model, node, keep: stops.filter(s => !s.required).map(s => s.container), stop: stops.filter(s => s.required).map(s => `${node}/${s.container}`) };
}
// Models that fit the stand-in Sparks: Nemotron (on disk on Spark 3 and 4) and the Radix NVFP4 one (Spark 4's model).
const NEMO = 'NVIDIA-Nemotron-Nano-9B-v2', RADIX = 'RadixArk--Qwen3.8-27B-NVFP4';

describe('the list', () => {
  test('every workflow, with its version, when to use it, its inputs and its known problems; none validated yet', async () => {
    const all = await workflows();
    assert.deepEqual(Object.keys(all).sort(), ['find_setups', 'restart_model', 'start_model', 'start_model_across', 'stop_model']);
    for (const w of Object.values(all)) {
      assert.match(w.version, /^[0-9a-f]{12}$/, w.id);
      assert.equal(w.state, 'needs-validation', w.id);
      assert.equal(w.validated, null);
      assert.ok(w.when && w.changes && w.takes && Object.keys(w.inputs).length, w.id);
    }
    assert.notEqual(all.start_model.version, all.start_model_across.version);
    assert.ok(all.start_model.knownProblems.some(p => /ran out of memory/.test(p.problem) && /shorter context/.test(p.fixTried)), JSON.stringify(all.start_model.knownProblems));
    // The same, through the agent door and on /health.
    const v = await ok('workflows', {}, keys.look.token);
    assert.deepEqual(v.workflows.map(w => w.id).sort(), Object.keys(all).sort());
    const health = (await api('/health')).json;
    assert.deepEqual(health.workflows, Object.fromEntries(Object.keys(all).map(id => [id, 'needs-validation'])));
  });

  // (a version holds what decides the workflow's answer: stop_model's look at a saved workflow's receipt reads the
  // receipt's fields and the list of what should be running; only the ways to a Spark stay off the list, W-11)
  test('stop_model\'s version holds every name its look at a run\'s receipt reads, but the ways to a Spark', () => {
    const src = readFileSync(join(REPO, 'service', 'server.mjs'), 'utf8');
    const list = /\{ id: 'stop_model',[\s\S]*?code: \(\) => \[([^\]]*)\]/.exec(src)[1].split(',').map(x => x.trim());
    const body = name => (new RegExp(`^(?:async )?function ${name}\\b[\\s\\S]*?^}`, 'm').exec(src) || new RegExp(`^const ${name} = .*$`, 'm').exec(src))[0];
    const defined = new Set([...src.matchAll(/^(?:async )?function ([A-Za-z_$][\w$]*)|^const ([A-Za-z_$][\w$]*) =/gm)].map(m => m[1] || m[2]));
    const ways = new Set(['run', 'nodeById', 'sparkName', 'q']);
    for (const fn of ['startedStill', 'receiptOf', 'RECEIPT_LOOK']) {
      assert.ok(list.includes(fn), fn);
      const used = [...new Set([...body(fn).matchAll(/\b([A-Za-z_$][\w$]*)\b/g)].map(m => m[1]))].filter(n => n !== fn && defined.has(n) && !ways.has(n));
      for (const n of used) assert.ok(list.includes(n), `${fn} reads ${n}, which isn’t on stop_model’s list`);
    }
  });
});

describe('validation', () => {
  // v3.1 (the owner, 2026-11-09: agents should do it by themselves): the agent is offered the validation run as a
  // choice instead of being refused; nothing runs until it takes that choice on purpose.
  test('an agent\'s plain call doesn\'t run a workflow that hasn\'t been validated: nothing starts, and it\'s offered as its validation run', async () => {
    for (const [name, args] of [['start_model', { model: NEMO, spark: 'spark4' }], ['stop_model', { spark: 'spark4', container: 'sc-RadixArk--Qwen3.8-27B-NVFP4' }]]) {
      const q = await ok(name, args);
      assert.equal(q.outcome, 'question', JSON.stringify(q));
      assert.match(q.question, /hasn’t been validated on your Sparks yet/);
      assert.ok(q.choices.some(c => /^Yes, run it as its validation/.test(c.label) && c.choice), JSON.stringify(q.choices));
      assert.match(q.note, /first run/);
    }
    // The button names a model that exists: a name that matches nothing is said now, not when the button is pressed.
    await refused('start_model', { model: 'no such model here', spark: 'spark4' }, /No model on disk or in the recipes matches/);
    assert.equal(stateOf('spark4', 'sc-RadixArk--Qwen3.8-27B-NVFP4'), 'running');
    assert.equal((await workflows()).start_model.state, 'needs-validation');
  });

  test('the owner\'s first run from a button is the validation run, confirmed on purpose; it has to answer a test prompt', { timeout: 180000 * SLOW }, async () => {
    const body = await deployBody(NEMO, 'spark4');
    const first = await api('/deploy', { method: 'POST', body });
    assert.equal(first.status, 428, first.text);
    assert.equal(first.json.validation.id, 'start_model');
    assert.match(first.json.error, /first run of “Start a model on one Spark”/);
    assert.equal(stateOf('spark4', 'sc-RadixArk--Qwen3.8-27B-NVFP4'), 'running', 'nothing changed');
    const r = await api('/deploy', { method: 'POST', body, headers: { 'X-Spark-Validate': 'start_model' } });
    assert.equal(r.status, 202, r.text);
    const w = await finished(r.json.id);
    assert.equal(w.status, 'completed', JSON.stringify(w));
    assert.ok(w.recentLog.some(l => /It answers a test prompt \(Hello from the stand-in model/.test(l)), w.recentLog.join('\n'));
    const st = (await workflows()).start_model;
    assert.equal(st.state, 'active');
    assert.equal(st.validated.operation, r.json.id);
    assert.equal(st.runs, 1);
    assert.equal(st.succeeded, 1);
    assert.ok(eventLines().some(e => e.type === 'notice' && /Validated: “Start a model on one Spark”/.test(e.text)));
    // Only that workflow: the across-Sparks one is separate.
    assert.equal((await workflows()).start_model_across.state, 'needs-validation');
  });

  test('once validated, agents can run it', { timeout: 180000 * SLOW }, async () => {
    const x = await ok('start_model', { model: 'gpt-oss-20b', spark: 'spark3' });
    assert.equal(x.outcome, 'started', JSON.stringify(x));
    const w = await finished(x.operation);
    assert.equal(w.status, 'completed', JSON.stringify(w));
    assert.equal(stateOf('spark3', 'sc-gpt-oss-20b'), 'running');
    assert.equal((await workflows()).start_model.runs, 2);
  });

  test('starting across two Sparks is a workflow of its own: a validated one-Spark start doesn\'t let an agent start across two', async () => {
    assert.equal((await workflows()).start_model.state, 'active');
    const q = await ok('start_model', { model: 'gpt-oss-120b', sparks: ['spark3', 'spark4'] });
    assert.equal(q.outcome, 'question', JSON.stringify(q));
    assert.match(q.question, /“Start one model across two Sparks” \(version [0-9a-f]{12}\) hasn’t been validated/);
    assert.equal((await workflows()).start_model_across.runs, 0);
  });

  test('a version that didn\'t pass the tests doesn\'t run at all, even for the owner', { timeout: 120000 * SLOW }, async () => {
    const lock = join(T.fleet.dir, 'old-lock.json');
    writeFileSync(lock, JSON.stringify({ versions: { start_model: '000000000000' } }));
    const other = await startMock({ watchMs: 60000, statusMs: 20000, env: { SPARK_CONSOLE_CHECK_LOCK: '1', SPARK_CONSOLE_WORKFLOW_LOCK: lock } });
    try {
      const get = async path => JSON.parse(await (await fetch(`${other.base}${path}`)).text());
      const all = Object.fromEntries((await get('/workflows')).workflows.map(w => [w.id, w]));
      assert.equal(all.start_model.state, 'untested');
      assert.equal(all.stop_model.state, 'untested');
      const r = await fetch(`${other.base}/deploy`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-spark-console': '1', 'x-spark-validate': 'start_model', origin: other.origin },
        body: JSON.stringify({ model: NEMO, node: 'spark4', keep: [], stop: [] }) });
      assert.equal(r.status, 409, await r.text());
    } finally { await other.stop(); }
  });
});

describe('done means it answers, and known problems are fixed', () => {
  test('a model that loads but can\'t answer a test prompt fails, says why, and what it stopped runs again', { timeout: 180000 * SLOW }, async () => {
    writeFileSync(join(T.fleet.dir, 'serve-silent'), '');
    try {
      assert.equal(stateOf('spark4', `sc-${NEMO}`), 'running');
      const x = await ok('start_model', { model: RADIX, spark: 'spark4' });
      assert.deepEqual(x.stops, [`spark4/sc-${NEMO}`]);
      const w = await finished(x.operation);
      assert.equal(w.status, 'failed', JSON.stringify(w));
      assert.match(w.error, /^It didn’t start: it loaded but didn’t answer a test prompt\. Its log/);
      assert.match(w.error, /chat_template is not set/);
      assert.ok(w.recentLog.some(l => /putting back/.test(l)), w.recentLog.join('\n'));
      assert.equal(stateOf('spark4', `sc-${NEMO}`), 'running');
      assert.notEqual(stateOf('spark4', `sc-${RADIX}`), 'running');
      const st = (await workflows()).start_model;
      assert.equal(st.runs - st.succeeded, 1);
    } finally { rmSync(join(T.fleet.dir, 'serve-silent'), { force: true }); }
  });

  test('out of memory with a long context: the workflow caps the context and tries again, and that setup is the one recorded', { timeout: 180000 * SLOW }, async () => {
    writeFileSync(mock('spark4', 'oom-ctx'), '32768');
    try {
      const x = await ok('start_model', { model: RADIX, spark: 'spark4' });
      const w = await finished(x.operation);
      assert.equal(w.status, 'completed', JSON.stringify(w));
      assert.ok(w.recentLog.some(l => /Known problem: it ran out of memory while loading\. Starting it with a shorter context .* \(attempt 2 of 3\)/.test(l)), w.recentLog.join('\n'));
      // The engine's own context flag (--max-model-len for vLLM, --context-length for SGLang) is capped at 32,768.
      const args = readFileSync(mock('spark4', 'last-run-args'), 'utf8').split('\n');
      const at = args.findLastIndex(a => a === '--max-model-len' || a === '--context-length');
      assert.ok(at >= 0 && Number(args[at + 1]) <= 32768, args.join(' '));
      // Its engine's compiled kernels and tuning are kept on the Spark, per image, for the next start.
      assert.ok(args.some(a => /\.cache\/spark-console\/engines\/.+:\/spark-cache$/.test(a)), args.join(' '));
      for (const e of ['VLLM_CACHE_ROOT=/spark-cache/vllm', 'TRITON_CACHE_DIR=/spark-cache/triton', 'XDG_CACHE_HOME=/spark-cache/xdg']) assert.ok(args.includes(e), e);
      const verified = JSON.parse(readFileSync(join(T.fleet.stateDir, 'verified.json'), 'utf8')).deployments.filter(d => d.model === RADIX);
      assert.ok(verified.some(d => d.args.join(' ').includes(args[at + 1])), JSON.stringify(verified.map(d => d.args)));
    } finally { rmSync(mock('spark4', 'oom-ctx'), { force: true }); }
  });

  test('when the fixes run out (3 attempts), it says what it tried and puts back what it stopped', { timeout: 420000 * SLOW }, async () => {
    writeFileSync(mock('spark4', 'oom-ctx'), '1024');
    let id = null;
    try {
      assert.equal(stateOf('spark4', `sc-${RADIX}`), 'running');
      // From the page (Nemotron runs its own code, so only the owner starts it): the page's starts fix and put back too.
      const r = await api('/deploy', { method: 'POST', body: await deployBody(NEMO, 'spark4') });
      assert.equal(r.status, 202, r.text);
      id = r.json.id;
      const w = await finished(r.json.id);
      assert.equal(w.status, 'failed', JSON.stringify(w));
      assert.match(w.error, /^It didn’t start: it ran out of memory while loading \(3 attempts\)\. Even a short context didn’t fit/);
      assert.equal(w.recentLog.filter(l => /Known problem: it ran out of memory/.test(l)).length, 2, w.recentLog.join('\n'));
      assert.equal(stateOf('spark4', `sc-${RADIX}`), 'running', 'put back');
    } finally {
      // (one that ran past the test isn't left holding Spark 4 for the next)
      if (id) await api(`/jobs/${id}/cancel`, { method: 'POST', body: {} }).catch(() => {});
      rmSync(mock('spark4', 'oom-ctx'), { force: true });
    }
  });

  // T12 (part): never cut below 16,384 tokens by itself; a context fixed in a named setup is still cut without asking (T42: not built).
  // (T42 needs a question inside a running operation, or a new argument: the rule's Today, R16, says so.)
  test('out of memory even at 16,384 tokens: it fails after three tries, never cut shorter by itself; nothing of it runs and what it stopped runs again', { timeout: 420000 * SLOW }, async () => {
    writeFileSync(mock('spark4', 'oom-ctx'), '8192');
    let id = null;
    try {
      assert.equal(stateOf('spark4', `sc-${RADIX}`), 'running');
      const r = await api('/deploy', { method: 'POST', body: await deployBody(NEMO, 'spark4') });
      assert.equal(r.status, 202, r.text);
      id = r.json.id;
      const w = await finished(r.json.id);
      assert.equal(w.status, 'failed', JSON.stringify(w));
      // (W-14: no "without asking" where no ask follows, and the one way on that runs it shorter, a setup that sets it)
      assert.match(w.error, /^It didn’t start: it ran out of memory while loading \(3 attempts\)\. Even a short context didn’t fit \(16,384 tokens, the shortest Spark Console cuts it to by itself\): it needs a Spark with more free memory, or a smaller version of the model\. To run it with a shorter context, start it with a setup that sets one itself \(a recipe setup, or its own spark\.json\): a setup’s own context is never made longer\.$/m, w.error);
      assert.ok(w.recentLog.some(l => /Starting it with a shorter context \(32,768 tokens, then 16,384, the shortest Spark Console cuts it to by itself\)\. \(attempt 3 of 3\)/.test(l)), w.recentLog.join('\n'));
      const args = readFileSync(mock('spark4', 'last-run-args'), 'utf8').split('\n');
      assert.equal(args[args.findLastIndex(a => a === '--context-length' || a === '--max-model-len') + 1], '16384', args.join(' '));
      assert.notEqual(stateOf('spark4', `sc-${NEMO}`), 'running', 'nothing of it runs');
      assert.equal(stateOf('spark4', `sc-${RADIX}`), 'running', 'put back');
    } finally {
      if (id) await api(`/jobs/${id}/cancel`, { method: 'POST', body: {} }).catch(() => {});
      rmSync(mock('spark4', 'oom-ctx'), { force: true });
    }
  });

  test('out of memory above 16,384 tokens: the third try at 16,384 starts, and it says it runs with a context of 16,384 tokens', { timeout: 420000 * SLOW }, async () => {
    writeFileSync(mock('spark4', 'oom-ctx'), '16384');
    let id = null;
    try {
      const r = await api('/deploy', { method: 'POST', body: await deployBody(NEMO, 'spark4') });
      assert.equal(r.status, 202, r.text);
      id = r.json.id;
      const w = await finished(r.json.id);
      assert.equal(w.status, 'completed', JSON.stringify(w));
      assert.deepEqual(w.fixed, { problems: ['out-of-memory', 'out-of-memory'], gaveUp: 'a context of 16,384 tokens' });
      assert.ok(w.recentLog.some(l => /Started after fixing: it ran out of memory while loading; it ran out of memory while loading \(it runs with a context of 16,384 tokens\)/.test(l)), w.recentLog.join('\n'));
      const args = readFileSync(mock('spark4', 'last-run-args'), 'utf8').split('\n');
      assert.equal(args[args.findLastIndex(a => a === '--context-length' || a === '--max-model-len') + 1], '16384', args.join(' '));
      id = null;
    } finally {
      if (id) await api(`/jobs/${id}/cancel`, { method: 'POST', body: {} }).catch(() => {});
      rmSync(mock('spark4', 'oom-ctx'), { force: true });
    }
  });

  test('the out-of-memory fix\'s next context is never under 16,384 tokens', () => {
    // START_FAILURES as written in the part, run on its own: each next try from where the last one left off.
    const src = readFileSync(join(REPO, 'service', 'src', '17-changes.mjs'), 'utf8');
    const text = src.slice(src.indexOf('const START_FAILURES = ['), src.indexOf('];', src.indexOf('const START_FAILURES = [')) + 1).replace(/^const START_FAILURES = /, '');
    const floor = Number(/^const CONTEXT_FLOOR = (\d+);$/m.exec(src)?.[1]);
    const oom = new Function('CONTEXT_FLOOR', 'rejectedFlags', 'dig', `return ${text};`)(floor, () => [], {}).find(f => f.id === 'out-of-memory');
    const caps = [];
    for (let fix = {}, next; (next = oom.next({ fix, tried: [], message: '' })) && caps.length < 10; fix = next.fix) caps.push(next.fix.contextCap);
    assert.deepEqual(caps, [32768, 16384]);
    for (const from of [65536, 32768, 20000, 16385, 16384, 12000, 8192, 1024]) {
      const cap = oom.next({ fix: { contextCap: from }, tried: [], message: '' })?.fix.contextCap;
      assert.ok(cap === undefined || cap >= 16384, `after ${from}: ${cap}`);
    }
  });

  test('a setting the engine rejects: only that setting is dropped, the rest stays, and the result says what it runs without', { timeout: 180000 * SLOW }, async () => {
    writeFileSync(mock('spark4', 'reject-flag'), '--trust-remote-code');
    try {
      const r = await api('/deploy', { method: 'POST', body: await deployBody(NEMO, 'spark4') });
      assert.equal(r.status, 202, r.text);
      const w = await finished(r.json.id);
      assert.equal(w.status, 'completed', JSON.stringify(w));
      assert.ok(w.recentLog.some(l => /Known problem: the engine didn’t accept one of the settings\. Starting it again without the setting the engine rejected/.test(l)), w.recentLog.join('\n'));
      assert.deepEqual(w.fixed, { problems: ['bad-flag'], gaveUp: 'without --trust-remote-code' });
      const args = readFileSync(mock('spark4', 'last-run-args'), 'utf8').split('\n');
      assert.ok(!args.includes('--trust-remote-code'), args.join(' '));
      assert.ok(args.includes('--context-length') || args.includes('--mem-fraction-static'), 'the rest of the setup stays');
    } finally { rmSync(mock('spark4', 'reject-flag'), { force: true }); }
  });

  test('a stop is done when the container really isn\'t running (validated by the owner\'s first stop)', { timeout: 120000 * SLOW }, async () => {
    const r = await api('/stop', { method: 'POST', body: { node: 'spark4', container: `sc-${NEMO}` }, headers: { 'X-Spark-Validate': 'stop_model' } });
    assert.equal(r.status, 202, r.text);
    const w = await finished(r.json.id);
    assert.equal(w.status, 'completed', JSON.stringify(w));
    assert.ok(w.recentLog.some(l => new RegExp(`Checked: sc-${NEMO} isn’t running`).test(l)), w.recentLog.join('\n'));
    assert.equal((await workflows()).stop_model.state, 'active');
  });
});

describe('validating from the owner\'s chat', () => {
  // v3.1 (the owner, 2026-11-11: no extra buttons): the owner's own clear request to Sparkie runs a workflow that isn't
  // validated yet straight away, as its validation run; if it works, that run validates it.
  const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
  const RESTART = [{ match: '^restart the nemotron', calls: [{ name: 'restart_model', arguments: { spark: 'spark4', container: `sc-${NEMO}` } }] }];
  // The restart the request started, to its end.
  async function restarted(since) {
    const op = await waitFor(async () => (await ok('recent_operations', { limit: 20 }, keys.look.token)).operations
      .find(o => o.type === 'restart' && o.container === `sc-${NEMO}` && o.startedAt > since), { what: 'the restart' });
    return { id: op.id, w: await finished(op.id) };
  }
  test('the owner\'s clear request runs it as its validation run, with no button; a restart that loads but doesn\'t answer is stopped again', { timeout: 180000 * SLOW }, async () => {
    script(RESTART);
    writeFileSync(join(T.fleet.dir, 'serve-silent'), '');
    try {
      assert.notEqual(stateOf('spark4', `sc-${NEMO}`), 'running');
      const since = new Date().toISOString();
      const r = await say(await newChat(), 'restart the nemotron one on spark 4');
      assert.ok(!(r.message.choices || []).length, JSON.stringify(r.message));
      assert.deepEqual(r.message.tools.map(t => [t.name, t.ok]), [['restart_model', true]], JSON.stringify(r.message.tools));
      const { w } = await restarted(since);
      assert.equal(w.status, 'failed', JSON.stringify(w));
      assert.match(w.error, /didn’t answer a test prompt/);
      assert.ok(w.recentLog.some(l => new RegExp(`Stopped sc-${NEMO} again`).test(l)), w.recentLog.join('\n'));
      assert.notEqual(stateOf('spark4', `sc-${NEMO}`), 'running');
      assert.equal((await workflows()).restart_model.state, 'needs-validation');
    } finally { rmSync(join(T.fleet.dir, 'serve-silent'), { force: true }); }
  });
  test('once it answers, that run validates it', { timeout: 180000 * SLOW }, async () => {
    script(RESTART);
    const since = new Date().toISOString();
    await say(await newChat(), 'restart the nemotron one on spark 4');
    const { id, w } = await restarted(since);
    assert.equal(w.status, 'completed', JSON.stringify(w));
    const st = (await workflows()).restart_model;
    assert.equal(st.state, 'active');
    assert.equal(st.validated.operation, id);
    rmSync(join(T.fleet.dir, 'model-script.json'), { force: true });
  });
});
