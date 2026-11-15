// Covers: One way in for the owner's own scripts: `POST /actions/<name>` runs a lookup and a change (`remember`;
// `memory` then shows it as the owner's), and answers 404 for an unknown action and 400 for a wrong argument;
// `/v1/responses` and `/v1/embeddings` reach the model server (`/v1/files` is 404); a program on a Spark (its own
// address) gets 409 and starts no model by calling `/v1`.
//
// One way in (reviews, 2026-11-11): POST /actions/<name> runs any action for the owner's own scripts, the same actions
// Sparkie and agents use. /v1 passes the Responses API (Codex), embeddings and rerank through to the model, and a
// program on a Spark (it calls /v1 as the owner) uses the models that run but never starts one by calling it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useFleet, api } from './lib.mjs';

useFleet({ watchMs: 60000 });

test('POST /actions/<name>: a lookup, a change (memory) as the owner\'s own call, and an unknown name', async () => {
  const s = await api('/actions/fleet_status', { method: 'POST', body: {} });
  assert.equal(s.status, 200, s.text);
  assert.ok(Array.isArray(s.json.sparks), s.text);
  const m = await api('/actions/remember', { method: 'POST', body: { text: 'Spark 3 is the default home for models', kind: 'preference' } });
  assert.equal(m.status, 200, m.text);
  assert.equal(m.json.outcome, 'remembered', m.text);
  assert.deepEqual((await api('/actions/memory', { method: 'POST', body: {} })).json.entries.map(e => [e.text, e.by]), [['Spark 3 is the default home for models', 'owner']]);
  const bad = await api('/actions/format_disk', { method: 'POST', body: {} });
  assert.equal(bad.status, 404, bad.text);
  const wrong = await api('/actions/remember', { method: 'POST', body: { words: 'x' } });
  assert.equal(wrong.status, 400, wrong.text);
});

test('/v1/responses and /v1/embeddings reach the model server', async () => {
  const r = await api('/v1/responses', { method: 'POST', body: { model: 'sparkie', input: 'hi' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.object, 'response', r.text);
  const e = await api('/v1/embeddings', { method: 'POST', body: { model: 'sparkie', input: 'hi' } });
  assert.equal(e.status, 200, e.text);
  assert.ok(Array.isArray(e.json.data?.[0]?.embedding), e.text);
  assert.equal((await api('/v1/files', { method: 'POST', body: {} })).status, 404);
});

test('a program on a Spark (its own address) doesn\'t start a model by calling it', async () => {
  const r = await api('/v1/chat/completions', { method: 'POST', headers: { 'x-forwarded-for': '100.64.0.3' }, body: { model: 'gpt-oss-120b', messages: [{ role: 'user', content: 'hi' }] } });
  assert.equal(r.status, 409, r.text);
  assert.match(r.text, /A program on a Spark can use the models that run, but doesn’t start one by calling it/);
});
