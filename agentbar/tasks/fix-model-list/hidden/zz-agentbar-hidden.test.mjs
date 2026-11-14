// The agent bar's check for fix-model-list (not shown to the agent): the models running on the stand-in Sparks are
// listed at /v1/models with their Spark, and one answers when called by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useFleet, api } from './lib.mjs';

useFleet({ watchMs: 60000, statusMs: 20000 });
const TESTORG = 'testorg/Qwen3.8-27B-abliterated-GGUF', RADIX = 'RadixArk/Qwen3.8-27B-NVFP4';

test('agent bar: /v1/models lists the models running on the Sparks, and they answer', { timeout: 180000 }, async () => {
  const list = (await api('/v1/models')).json.data;
  assert.ok(list.some(m => m.id === TESTORG && m.spark === 'spark3'), JSON.stringify(list));
  assert.ok(list.some(m => m.id === RADIX && m.spark === 'spark4'), JSON.stringify(list));
  const r = await api('/v1/chat/completions', { method: 'POST', body: { model: TESTORG, messages: [{ role: 'user', content: 'hi' }] } });
  assert.equal(r.status, 200, r.text);
});
