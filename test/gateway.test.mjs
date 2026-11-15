// Covers: One address for every model (`/v1`): running models listed and answered by name wherever they run; a call
// marks a model in use for 30 minutes, so a start that would stop it asks first (naming who used it); a model that
// isn't running starts when called if nothing has to stop (503 with Retry-After, then it answers); one that would need
// a stop gets 409.
//
// One address for every model (docs/contract.md 9.9): /v1 serves Sparkie and every model Spark Console runs, by the name
// it's served as, wherever it runs now; a model that isn't running starts when it's called, if nothing has to stop for
// it (503 with Retry-After while it loads); a call marks that model in use for 30 minutes, so a start that would stop it
// asks first (8.4).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, call, createActKey, SLOW } from './lib.mjs';

const keys = {};
useFleet({ watchMs: 60000, statusMs: 20000 }, async () => { keys.act = await createActKey('gw'); });
const stateOf = (spark, name) => readFileSync(join(T.fleet.root, spark, '.mock', 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];
const chat = model => api('/v1/chat/completions', { method: 'POST', body: { model, messages: [{ role: 'user', content: 'hi' }] } });
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
const TESTORG = 'testorg/Qwen3.8-27B-abliterated-GGUF', RADIX = 'RadixArk/Qwen3.8-27B-NVFP4';

describe('one address', () => {
  test('lists every running model with its Spark, and answers for one wherever it runs', async () => {
    const list = (await api('/v1/models')).json.data;
    assert.ok(list.some(m => m.id === TESTORG && m.spark === 'spark3'), JSON.stringify(list));
    assert.ok(list.some(m => m.id === RADIX && m.spark === 'spark4'), JSON.stringify(list));
    const r = await chat(TESTORG);
    assert.equal(r.status, 200, r.text);
  });

  test('a start that would stop a model in use asks first, naming who used it; "yes" starts it', { timeout: 180000 * SLOW }, async () => {
    const q = await ok('start_model', { model: 'gpt-oss-20b', spark: 'spark3' });
    assert.equal(q.outcome, 'question', JSON.stringify(q));
    assert.match(q.question, /sc-testorg--Qwen3\.8-27B-abliterated-GGUF is in use \(it answered calls in the last 30 minutes, from owner@test\)/);
    assert.equal(stateOf('spark3', 'sc-testorg--Qwen3.8-27B-abliterated-GGUF'), 'running', 'asking stops nothing');
    const x = await ok('start_model', { choice: q.choices.find(c => /^Yes/.test(c.label)).choice });
    assert.equal(x.outcome, 'started', JSON.stringify(x));
    assert.equal((await finished(x.operation)).status, 'completed');
  });

  test('a model stopped on purpose isn\'t started again by a call', async () => {
    // (the test above stopped the testorg model on Spark 3 to start gpt-oss-20b there)
    const r = await chat(TESTORG);
    assert.equal(r.status, 409, r.text);
    assert.match(r.json.error.message, /was stopped on purpose \d+ min ago, so a call doesn’t start it again/);
  });

  test('a model that isn\'t running starts when it\'s called (on disk, in Recipes, nothing has to stop): 503 with Retry-After, then it answers', { timeout: 240000 * SLOW }, async () => {
    // It stopped without Spark Console stopping it (cleanly: a crash would be restarted by self-healing), and its Spark is free.
    const f = join(T.fleet.root, 'spark4', '.mock', 'containers');
    writeFileSync(f, readFileSync(f, 'utf8').split('\n').map(l => (l.startsWith('sc-RadixArk--Qwen3.8-27B-NVFP4|') ? l.replace('|running|Up 1 second|', '|exited|Exited (0) 1 second ago|') : l)).join('\n'));
    await new Promise(r => setTimeout(r, 16000)); // (what the console last saw is kept 15 s)
    const first = await chat(RADIX);
    assert.equal(first.status, 503, first.text);
    assert.equal(first.headers.get('retry-after'), '60');
    assert.equal(first.json.error.type, 'model_starting');
    const op = first.json.error.message.match(/operation ([0-9a-f]{12})/)[1];
    const w = await finished(op);
    assert.equal(w.status, 'completed', JSON.stringify(w));
    assert.deepEqual(w.recentLog.filter(l => /Stopping /.test(l)), [], 'nothing was stopped');
    const again = await chat(RADIX);
    assert.equal(again.status, 200, again.text);
  });

  test('one that would need something stopped, or isn\'t on disk, isn\'t started by a call: 409 says why', async () => {
    const r = await chat('gpt-oss-120b');
    assert.equal(r.status, 409, r.text);
    assert.match(r.json.error.message, /gpt-oss-120b isn’t running, and it can’t be started on its own/);
    const d = await chat('qwen3.5-4b');
    assert.equal(d.status, 409, d.text);
    assert.match(d.json.error.message, /a call doesn’t download models/);
  });
});
