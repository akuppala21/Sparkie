// Covers: A saved workflow's clean-up stops only what its run started (A-22, R57): each item it started keeps a receipt
// (its Docker id; a model's or app's entry `since` on the list of what should be running; a job's start time), looked at
// again inside the stop's own claim. While the run waits on a job, the owner stops and starts that model again (a new
// container), or asks to start it and is told it already runs, or stops it and restarts the same container: at the run's
// end (well, failed or cancelled) the model keeps running, stays on the list, and the result says it was left. A job the
// owner ran again by hand after the run's job step is left when a later step fails. A run nobody touched still stops
// what it started, and a model self-healing brought back during the run is still the run's and is stopped.
// From a chat, the clean-up's stop that left the model running says so there and never "finished", and isn't counted
// as a run of stop_model (its validation).
// The owner's start or restart while the run's own step is still starting it (loading) is their newest wish, so the run
// leaves it once the step has ended.
// The same for an app a run started (`keep_running`): the owner's keep answered "already" leaves it; one the owner took
// off the list and started again by hand is left, and not put back on the list by the run. The owner's restart answered
// "already" leaves a model too.
//
// The stand-in fleet as in the round-two check (a2-cleanup): Spark 3 with none of Spark Console's models running and a
// new id for each container made there; on Spark 4 a job (rc-long) that runs until the test ends it, and start times
// stamped as they happen. Self-healing looks every 2 s.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
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
const WISHED = 'Left running: sc-gpt-oss-20b on Spark 3 was asked for by the owner while being started.';
const WEB = 'rc-web', WEB_LEFT = 'Left running: rc-web on Spark 4 was started again since, not by this run.';
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
// (~/.mock/serve-down on Spark 3: a model started there stays loading until it is gone)
const loading = on => (on ? writeFileSync(mockFile('spark3', 'serve-down'), '') : rmSync(mockFile('spark3', 'serve-down'), { force: true }));
const stopRecord = () => { try { return JSON.parse(readFileSync(join(T.fleet.stateDir, 'validations.json'), 'utf8')).stop_model || null; } catch { return null; } };

// Before each run: the job runs, and gpt-oss-20b is stopped and off the list, so the run's step 1 starts it.
async function ready() {
  if (stateOf('spark4', 'rc-long') !== 'running') assert.equal((await done(await act('keep_running', { spark: 'spark4', container: 'rc-long' }))).status, 'completed');
  if (stateOf('spark3', GPT20) === 'running') await ownerStop();
  assert.deepEqual([stateOf('spark4', 'rc-long'), stateOf('spark3', GPT20)], ['running', 'exited']);
}
// Also the app: stopped, and off the list.
async function readyWeb() {
  await ready();
  if (stateOf('spark4', WEB) === 'running') {
    if ((await listed()).includes(`spark4/${WEB}`)) assert.equal((await done(await act('keep_running', { spark: 'spark4', container: WEB, do: 'stop' }))).status, 'completed');
    else setState('spark4', WEB, 'exited', 'Exited (0) just now');
  }
  assert.equal(stateOf('spark4', WEB), 'exited');
  assert.ok(!(await listed()).includes(`spark4/${WEB}`));
}
// A run of "rc eval" (or another) to the moment it waits on its job.
async function toStep2(title = 'rc eval') {
  const r = await act('run_workflow', { name: title });
  assert.equal(r.json?.outcome, 'started', r.text);
  return atStep2(r.json.operation, title === 'rc eval');
}
async function atStep2(id, model = true) {
  await waitFor(async () => /^Step 2: rc-long runs on Spark 4; waiting for it to end/.test((await opNow(id)).step), { timeout: 240000 * SLOW, what: 'step 2 waiting for rc-long', every: 250 });
  if (model) assert.equal(stateOf('spark3', GPT20), 'running');
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
  async 'asks to restart it, and is told it already runs'() {
    const a = await act('restart_model', { spark: 'spark3', container: GPT20 });
    assert.equal(a.json?.outcome, 'already', a.text);
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
    // An app, made and stopped (off the list), and a run that starts it for the job.
    const web = await act('keep_running', { spark: 'spark4', container: WEB, image: 'nginx:1.27', port: `${await freePort()}:80` });
    assert.equal((await done(web)).status, 'completed');
    assert.equal((await done(await act('keep_running', { spark: 'spark4', container: WEB, do: 'stop' }))).status, 'completed');
    const w = await act('save_workflow', { title: 'rc web', steps: [
      { action: 'keep_running', args: { spark: 'spark4', container: WEB } },
      { action: 'keep_running', args: { spark: 'spark4', container: 'rc-long' } },
    ] });
    assert.equal(w.status, 200, w.text);
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
    ['stops it and restarts the same container', 'well'], ['asks to restart it, and is told it already runs', 'well']]) {
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

  for (const ask of ['start', 'restart']) {
    test(`the owner asks to ${ask} it while the run's own step is still starting it (loading): that wish outlives the step's end, and the run leaves it running and on the list`, { timeout: 600000 * SLOW }, async () => {
      await ready();
      loading(true);
      let id;
      try {
        const r = await act('run_workflow', { name: 'rc eval' });
        assert.equal(r.json?.outcome, 'started', r.text);
        id = r.json.operation;
        await waitFor(async () => stateOf('spark3', GPT20) === 'running' && /^Step 1\b/.test((await opNow(id)).step), { timeout: 240000 * SLOW, what: 'step 1 loading the model', every: 250 });
        const a = ask === 'start' ? await act('start_model', { model: 'gpt-oss-20b', spark: 'spark3' }) : await act('restart_model', { spark: 'spark3', container: GPT20 });
        assert.equal(a.json?.outcome, ask === 'start' ? 'already-starting' : 'already', a.text);
      } finally { loading(false); }
      await atStep2(id);
      const o = await finish(id, 'well');
      assert.ok(String(o.cleanUp).includes(WISHED), `${o.cleanUp}`);
      assert.ok(!String(o.cleanUp).includes('Stopped what this run had started: sc-gpt-oss-20b'), o.cleanUp);
      assert.equal(stateOf('spark3', GPT20), 'running', 'the owner’s model runs');
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

  test('an app a run started, nobody touched: the run stops it, as before', { timeout: 600000 * SLOW }, async () => {
    await readyWeb();
    const id = await toStep2('rc web');
    assert.equal(stateOf('spark4', WEB), 'running');
    const o = await finish(id, 'well');
    assert.equal(o.cleanUp, 'Stopped what this run had started: rc-web on Spark 4.');
    assert.equal(stateOf('spark4', WEB), 'exited');
    assert.ok(!(await listed()).includes(`spark4/${WEB}`));
  });

  test('the owner asks to keep the run\'s app and is told it already runs: the run leaves it running and on the list', { timeout: 600000 * SLOW }, async () => {
    await readyWeb();
    const id = await toStep2('rc web');
    const k = await act('keep_running', { spark: 'spark4', container: WEB });
    assert.equal(k.json?.outcome, 'already', k.text);
    const o = await finish(id, 'well');
    assert.ok(String(o.cleanUp).includes(WEB_LEFT), `${o.cleanUp}`);
    assert.equal(stateOf('spark4', WEB), 'running', 'the owner’s app runs');
    assert.ok((await listed()).includes(`spark4/${WEB}`), 'and stays on the list');
  });

  test('the owner takes the run\'s app off the list and starts its container again by hand: the run leaves it, and never puts it on the list', { timeout: 600000 * SLOW }, async () => {
    await readyWeb();
    const id = await toStep2('rc web');
    assert.equal((await done(await act('keep_running', { spark: 'spark4', container: WEB, do: 'stop' }))).status, 'completed');
    assert.ok(!(await listed()).includes(`spark4/${WEB}`));
    setState('spark4', WEB, 'running', 'Up 1 second');
    const o = await finish(id, 'fails');
    assert.ok(String(o.cleanUp).includes(WEB_LEFT), `${o.cleanUp}`);
    assert.equal(stateOf('spark4', WEB), 'running', 'the owner’s app runs');
    assert.ok(!(await listed()).includes(`spark4/${WEB}`), 'and stays off the list');
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

const receiptPart = readFileSync(new URL('../service/src/18-step-jobs.mjs', import.meta.url), 'utf8');
const receiptFn = name => new RegExp(`^async function ${name}\\([^]*?^\\}`, 'm').exec(receiptPart)?.[0];
test('A-22: missing or incomplete ownership never authorizes a stop', async () => {
  for (const seen of [undefined, {}, { id: 'a'.repeat(64) }, { since: SINCE }, { id: null, since: SINCE }]) {
    let looks = 0;
    const still = new Function('sparkName', 'nodeById', 'receiptOf', `${receiptFn('startedStill')}\nreturn startedStill;`)(
      n => n.id, id => ({ id }), async () => { looks++; return { id: 'a'.repeat(64), startedAt: SINCE }; });
    await assert.rejects(still('spark3', GPT20, seen), /record of what this run started is missing/);
    assert.equal(looks, 0);
  }
});
test('A-22: a current look with unreadable identity never authorizes a stop', async () => {
  const still = new Function('sparkName', 'nodeById', 'receiptOf', `${receiptFn('startedStill')}\nreturn startedStill;`)(
    n => n.id, id => ({ id }), async () => ({ id: null, startedAt: SINCE }));
  await assert.rejects(still('spark3', GPT20, { id: 'a'.repeat(64), since: SINCE }), /wasn’t stopped/);
});
test('A-22: a finished step consumes its own operation receipt without sampling a replacement', async () => {
  const key = `spark3/${GPT20}`, own = { id: 'a'.repeat(64), since: SINCE, startedAt: SINCE };
  const operations = new Map([['start', { startedReceipts: { [key]: own } }]]);
  const receipts = new Function('jobs', `${receiptFn('startedReceipts')}\nreturn startedReceipts;`)(operations);
  const items = [{ kind: 'model', spark: 'spark3', container: GPT20, ops: ['start'] }];
  assert.deepEqual((await receipts(items))[0].seen, { id: own.id, since: SINCE });
  operations.set('start', { startedReceipts: { [key]: null } });
  assert.equal((await receipts(items))[0].seen, undefined, 'unknown original identity stays unknown');
});
test('A-22: cleanup with no ownership evidence leaves it running and reports unresolved cleanup', async () => {
  let calls = 0;
  const stop = new Function('nodeById', 'sparkName', 'runAction', 'maskSecrets', `${receiptFn('stopWhatRan')}\nreturn stopWhatRan;`)(
    id => ({ id }), n => n.id, async () => { calls++; }, String);
  const words = await stop([{ kind: 'model', spark: 'spark3', container: GPT20 }], {}, {}, 'test');
  assert.equal(calls, 0);
  assert.match(words, /record of what this run started is missing/);
  assert.match(words, /may still be running/);
});
test('A-22: a successful start records its resource identity before completion and claim release', async () => {
  const source = readFileSync(new URL('../service/src/07-jobs.mjs', import.meta.url), 'utf8');
  const fn = /^function runJob\([^]*?^\}/m.exec(source)[0], order = [], published = [];
  let letReceiptFinish;
  const pending = new Promise(resolve => { letReceiptFinish = resolve; });
  const job = { id: 'test', status: 'running', log: [], release: () => order.push('release') };
  const deps = { desiredAfter: j => { assert.equal(j.status, 'completed'); order.push('desired'); },
    captureStartedReceipts: async j => { assert.equal(j.status, 'running'); order.push('receipt'); await pending; },
    contextPublish: j => published.push({ id: j.id, status: j.status, order: [...order] }),
    note: (_j, text) => order.push(text), agentCache: { clear() {} }, recordWorkflowRun() {}, fleetEvent() {}, learnFrom() {}, journalOp() {}, console, jobMasked: String };
  const runJob = new Function(...Object.keys(deps), `${fn}\nreturn runJob;`)(...Object.values(deps));
  runJob(job, async () => {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(job.status, 'running');
  assert.deepEqual(order, ['desired', 'receipt']);
  assert.deepEqual(published, [], 'no context question is published while the receipt is still pending');
  letReceiptFinish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(job.status, 'completed');
  assert.deepEqual(order, ['desired', 'receipt', 'Done', 'release']);
  assert.deepEqual(published, [{ id: job.id, status: 'completed', order: ['desired', 'receipt', 'Done', 'release'] }],
    'context publication runs once, after claim release, with terminal status');
});
test('A-22: a once-job without ranHere still captures its own identity under its start claim', async () => {
  const key = 'spark4/rc-once', own = { id: 'b'.repeat(64), startedAt: SINCE }, job = { app: true, type: 'deploy', node: 'spark4', container: 'rc-once' };
  let saved = false;
  const capture = new Function('receiptOf', 'desired', 'keyOf', 'savedRunReceipts', `${receiptFn('captureStartedReceipts')}\nreturn captureStartedReceipts;`)(
    async (spark, container) => { assert.equal(`${spark}/${container}`, key); return own; }, () => ({ running: [] }), x => `${x.spark}/${x.container}`, () => { saved = true; });
  await capture(job);
  assert.deepEqual(job.startedReceipts[key], { ...own, since: null });
  assert.equal(saved, true);
});
test('A-22: a loading app receipt is kept on the pending restart record; an unknown identity stays unresolved', () => {
  const source = readFileSync(new URL('../service/src/18-run-record.mjs', import.meta.url), 'utf8');
  const fn = /^function savedRunReceipts\([^]*?^\}/m.exec(source)[0];
  const item = { kind: 'app', spark: 'spark4', container: 'rc-web', operation: 'app-start' };
  const record = { operation: 'workflow-run', awaiting: [item], pending: [] }, parent = { id: record.operation };
  const save = new Function('savedRunsNow', 'jobs', 'savedRunKeep', `${fn}\nreturn savedRunReceipts;`)(
    () => ({ runs: { [parent.id]: record } }), new Map([[parent.id, parent]]), (_j, fields) => Object.assign(record, fields));
  save({ id: 'app-start', startedReceipts: { 'spark4/rc-web': null } });
  assert.equal(record.pending.length, 0);
  assert.equal(record.awaiting.length, 1);
  save({ id: 'app-start', startedReceipts: { 'spark4/rc-web': { id: 'c'.repeat(64), startedAt: SINCE } } });
  assert.deepEqual(record.awaiting, []);
  assert.deepEqual(record.pending[0].seen, { id: 'c'.repeat(64), startedAt: SINCE });
  assert.equal(record.pending[0].wish, undefined);
  save({ id: 'app-start', ownersWish: true, startedReceipts: { 'spark4/rc-web': { id: 'c'.repeat(64), startedAt: SINCE } } });
  assert.equal(record.pending[0].wish, true, 'adoption while still loading survives a process restart');
});
test('A-22: an owner’s wish during loading is persisted with the pending operation immediately', () => {
  const source = readFileSync(new URL('../service/src/20-desired.mjs', import.meta.url), 'utf8');
  const fn = /^function desiredWish\([^]*?^\}/m.exec(source)[0], operation = { id: 'loading', node: 'spark4', container: 'rc-web' }, persisted = [];
  const wish = new Function('jobs', 'savedRunReceipts', 'readKept', 'DESIRED_FILE', 'console', `${fn}\nreturn desiredWish;`)(
    new Map([[operation.id, operation]]), j => persisted.push({ id: j.id, wish: j.ownersWish }), () => null, '/not-read', console);
  wish(['spark4/rc-web']);
  assert.equal(operation.ownersWish, true);
  assert.deepEqual(persisted, [{ id: operation.id, wish: true }]);
});
