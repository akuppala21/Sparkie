// What should be running (docs/contract.md 6.13, 8.8–8.10): finished starts and stops change the owner's list; one that
// should be running but isn't is held (a notice, Sparkie's notes, Activity) with Bring back and Forget; an operation can
// be cancelled (it puts back what it did); a stop never waits behind a start; "undo" in a chat reverses that chat's last
// change.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, call, createActKey, eventLines, auditLines, waitFor, newChat, say, chatMessages, SLOW } from './lib.mjs';

const keys = {};
useFleet({ watchMs: 60000, statusMs: 3000, knowledge: true, env: { SPARK_CONSOLE_DESIRED_MS: '1500' } }, async () => { keys.act = await createActKey('ds'); });
const mock = (spark, file) => join(T.fleet.root, spark, '.mock', file);
const stateOf = (spark, name) => readFileSync(mock(spark, 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];
function setState(spark, name, state, status) {
  const f = mock(spark, 'containers');
  writeFileSync(f, readFileSync(f, 'utf8').split('\n').map(l => (l.startsWith(`${name}|`) ? l.split('|').map((v, i) => (i === 1 ? state : i === 2 ? status : v)).join('|') : l)).join('\n'));
}
async function ok(name, args) {
  const r = await call(keys.act.token, name, args);
  assert.equal(r.isError, false, `${name} ${JSON.stringify(args)}: ${r.text}`);
  return r.value;
}
async function finished(id) {
  for (const until = Date.now() + 150000 * SLOW; ;) {
    const w = await ok('wait_operation', { id, seconds: 20 });
    if (w.status !== 'running') return w;
    if (Date.now() > until) throw new Error(`still running: ${JSON.stringify(w)}`);
  }
}
const listed = async () => (await api('/desired')).json.running;
const GPT = 'sc-gpt-oss-20b', TESTORG = 'sc-testorg--Qwen3.8-27B-abliterated-GGUF';

describe('the list', () => {
  test('a start that finished is on it, and what it stopped isn\'t', { timeout: 180000 * SLOW }, async () => {
    const x = await ok('start_model', { model: 'gpt-oss-20b', spark: 'spark3' });
    assert.equal((await finished(x.operation)).status, 'completed');
    const l = await listed();
    assert.ok(l.some(e => e.spark === 'spark3' && e.container === GPT && e.state === 'running'), JSON.stringify(l));
    assert.ok(!l.some(e => e.container === TESTORG));
    assert.ok(!l.some(e => e.spark === 'spark2'), 'the brain’s Spark isn’t on the list');
    assert.ok((await ok('should_be_running', {})).running.some(e => e.container === GPT));
  });

  test('one that stops outside Spark Console is held: a notice, then Bring back starts it again', { timeout: 180000 * SLOW }, async () => {
    setState('spark3', GPT, 'exited', 'Exited (0) just now');
    const held = await waitFor(async () => (await listed()).find(e => e.container === GPT && e.state === 'held'), { timeout: 60000, what: 'held' });
    assert.match(held.why, /isn’t running/);
    await waitFor(() => eventLines().some(e => e.type === 'notice' && /sc-gpt-oss-20b on Spark 3 should be running but isn’t/.test(e.text)), { what: 'the notice' });
    const r = await api('/desired/bring-back', { method: 'POST', body: { spark: 'spark3', container: GPT } });
    assert.equal(r.status, 202, r.text);
    assert.equal((await finished(r.json.operation)).status, 'completed');
    assert.equal(stateOf('spark3', GPT), 'running');
  });

  test('Forget takes it off the list; nothing is stopped', async () => {
    assert.equal((await api('/desired/forget', { method: 'POST', body: { spark: 'spark3', container: GPT } })).status, 200);
    assert.ok(!(await listed()).some(e => e.spark === 'spark3' && e.container === GPT));
    assert.equal(stateOf('spark3', GPT), 'running');
  });
});

describe('cancel, and stops that don\'t wait', () => {
  // Waits for the new model's container to be up (still loading: serve-down keeps it from answering); if it never is,
  // says what the operation was doing. (Each look at the stand-in fleet takes ~20 s, and a start takes three.)
  async function loading(id) {
    try { await waitFor(() => stateOf('spark4', 'sc-NVIDIA-Nemotron-Nano-9B-v2') === 'running', { timeout: 120000, what: 'the new model loading' }); }
    catch (e) { throw new Error(`${e.message}: ${JSON.stringify(await ok('wait_operation', { id, seconds: 1 }))}`); }
  }
  // (a test that failed half-way doesn't leave its start running into the next one)
  const leaveNothingRunning = async id => { if (id) { await api(`/jobs/${id}/cancel`, { method: 'POST', body: {} }).catch(() => {}); await finished(id).catch(() => {}); } };
  test('cancelling: the owner\'s cancel puts back what the start stopped; a stop on that Spark doesn\'t wait behind it', { timeout: 240000 * SLOW }, async () => {
    let id = null;
    writeFileSync(mock('spark4', 'serve-down'), '');
    try {
      assert.equal(stateOf('spark4', 'sc-RadixArk--Qwen3.8-27B-NVFP4'), 'running');
      const r = await api('/deploy/plan?model=NVIDIA-Nemotron-Nano-9B-v2&node=spark4');
      const stops = r.json.steps.filter(s => s.kind === 'stop');
      const d = await api('/deploy', { method: 'POST', body: { model: 'NVIDIA-Nemotron-Nano-9B-v2', node: 'spark4', keep: stops.filter(s => !s.required).map(s => s.container), stop: stops.filter(s => s.required).map(s => `spark4/${s.container}`) } });
      assert.equal(d.status, 202, d.text);
      id = d.json.id;
      await loading(id);
      const c = await api(`/jobs/${d.json.id}/cancel`, { method: 'POST', body: {} });
      assert.equal(c.status, 200, c.text);
      assert.equal(c.json.outcome, 'cancelled', c.text);
      const w = await finished(d.json.id);
      assert.equal(w.status, 'cancelled');
      assert.match(w.error, /Cancelled by owner/);
      assert.ok(w.recentLog.some(l => /putting back/.test(l)), w.recentLog.join('\n'));
      assert.equal(stateOf('spark4', 'sc-RadixArk--Qwen3.8-27B-NVFP4'), 'running', 'put back');
      assert.notEqual(stateOf('spark4', 'sc-NVIDIA-Nemotron-Nano-9B-v2'), 'running');
    } finally { await leaveNothingRunning(id); rmSync(mock('spark4', 'serve-down'), { force: true }); }
  });

  test('the owner\'s stop on a Spark where a start is loading cancels the start, then stops', { timeout: 240000 * SLOW }, async () => {
    let id = null;
    writeFileSync(mock('spark4', 'serve-down'), '');
    try {
      const r = await api('/deploy/plan?model=NVIDIA-Nemotron-Nano-9B-v2&node=spark4');
      const stops = r.json.steps.filter(s => s.kind === 'stop');
      const d = await api('/deploy', { method: 'POST', body: { model: 'NVIDIA-Nemotron-Nano-9B-v2', node: 'spark4', keep: stops.filter(s => !s.required).map(s => s.container), stop: stops.filter(s => s.required).map(s => `spark4/${s.container}`) } });
      assert.equal(d.status, 202, d.text);
      id = d.json.id;
      await loading(id);
      // (the start put RadixArk back once it was cancelled; the stop then stops it)
      const s = await api('/stop', { method: 'POST', body: { node: 'spark4', container: 'sc-RadixArk--Qwen3.8-27B-NVFP4' } });
      assert.equal(s.status, 202, s.text);
      assert.equal((await finished(d.json.id)).status, 'cancelled');
      assert.equal((await finished(s.json.id)).status, 'completed');
      assert.notEqual(stateOf('spark4', 'sc-RadixArk--Qwen3.8-27B-NVFP4'), 'running');
    } finally { await leaveNothingRunning(id); rmSync(mock('spark4', 'serve-down'), { force: true }); }
  });
});

describe('undo', () => {
  const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
  test('"undo that" in a chat reverses that chat\'s last change: what it started stops, what it stopped starts again', { timeout: 300000 * SLOW }, async () => {
    // spark3 runs gpt-oss-20b (from the tests above); this chat starts the testorg GGUF there, which stops it.
    assert.equal(stateOf('spark3', GPT), 'running');
    script([{ match: '^start the testorg', calls: [{ name: 'start_model', arguments: { model: 'testorg--Qwen3.8-27B-abliterated-GGUF', spark: 'spark3' } }] },
      { match: '^undo that', calls: [{ name: 'undo_last_change', arguments: {} }] }]);
    try {
      const chat = await newChat();
      await say(chat, 'start the testorg qwen3.8 27b abliterated gguf on spark 3');
      const line = auditLines().findLast(l => l.action === 'start_model' && l.chat === chat);
      assert.equal(line?.outcome, 'started', JSON.stringify(line));
      assert.equal((await finished(line.operation)).status, 'completed');
      assert.equal(stateOf('spark3', TESTORG), 'running');
      assert.notEqual(stateOf('spark3', GPT), 'running');
      const u = await say(chat, 'undo that');
      // It answers straight away (the undo is an operation of its own) and posts to the chat when it's done.
      assert.deepEqual(u.tools.map(t => [t.name, t.ok]), [['undo_last_change', true]], JSON.stringify({ tools: u.tools, reply: u.text, audit: auditLines().filter(l => l.chat === chat || /undo/.test(l.request || '')).slice(-6) }));
      await waitFor(() => stateOf('spark3', GPT) === 'running', { timeout: 180000, what: 'gpt-oss-20b started again' });
      assert.notEqual(stateOf('spark3', TESTORG), 'running');
      const posted = await waitFor(async () => (await chatMessages(chat)).find(m => m.notice && /^Done: undoing the last change finished/.test(m.content)), { timeout: 120000, what: 'the undo’s result in the chat' });
      assert.ok(posted);
      // A second "undo" goes back on the change before (there isn't one in this chat).
      const again = await say(chat, 'undo that');
      assert.equal(again.tools[0]?.ok, true, JSON.stringify(again.tools));
    } finally { rmSync(join(T.fleet.dir, 'model-script.json'), { force: true }); }
  });
});
