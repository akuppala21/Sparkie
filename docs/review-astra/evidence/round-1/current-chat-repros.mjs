import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const reviewRoot=resolve(process.env.SPARK_REVIEW_ROOT || fileURLToPath(new URL('../../../../',import.meta.url)));
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const { startMock } = await import(pathToFileURL(join(reviewRoot,'test/start-mock.mjs')).href);
const { T, api, newChat, say } = await import(pathToFileURL(join(reviewRoot,'test/lib.mjs')).href);

const results = [];
let fleet;
const bind = f => Object.assign(T, { fleet: f, base: f.base, origin: f.origin, mcp: f.mcp });
try {
  fleet = await startMock({ watchMs: 600000, statusMs: 600000 });
  bind(fleet);
  const seed = await api('/actions/remember', { method: 'POST', body: { text: 'Spark 4 is on Wi-Fi only', kind: 'fact' } });
  assert.equal(seed.status, 200, seed.text);
  const question = 'What do you remember about Spark 4 being on Wi-Fi only?';
  writeFileSync(join(fleet.dir, 'model-script.json'), JSON.stringify([{ match: '^What do you remember about Spark 4', calls: [{ name: 'forget_memory', arguments: { id: seed.json.id } }] }]));
  const chat = await newChat();
  const reply = await say(chat, question);
  const after = await api('/actions/memory', { method: 'POST', body: {} });
  assert.equal(after.json.entries.length, 0);
  assert.equal(reply.message.tools[0].outcome, 'forgotten');
  assert.equal(reply.message.choices?.length || 0, 0);
  results.push({ case: 'memory-question-can-delete-memory', question, tools: reply.message.tools, remainingEntries: after.json.entries.length, approvalButtons: reply.message.choices?.length || 0 });
} finally { await fleet?.stop(); }

let mode = 'truncated', gotRequest;
const fakeSecret = 'hf_abcdefghijklmnopqrstuvwxyz123456';
const model = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    gotRequest?.();
    if (mode === 'truncated') {
      res.writeHead(503, { 'content-type': 'application/json', 'content-length': '10000' });
      res.write('{"error":"model shutting down');
      setTimeout(() => res.destroy(), 50);
    } else {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `upstream rejected token ${fakeSecret}` }));
    }
  });
});
await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
try {
  fleet = await startMock({ watchMs: 600000, statusMs: 600000, prepare: ({ stateDir }) => {
    const p = join(stateDir, 'main.json'), j = JSON.parse(readFileSync(p, 'utf8'));
    j.chat = { kind: 'endpoint', url: `http://127.0.0.1:${model.address().port}`, model: 'review-fixture', title: 'Review fixture', node: 'spark2' };
    writeFileSync(p, JSON.stringify(j));
  } });
  bind(fleet);
  const chat = await newChat();
  const received = new Promise(resolve => { gotRequest = resolve; });
  const controller = new AbortController();
  const stream = fetch(`${fleet.base}/chats/${chat}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-spark-console': '1', origin: fleet.origin },
    body: JSON.stringify({ text: 'hello, connection failure check' }), signal: controller.signal,
  }).then(r => r.text()).catch(e => e.name);
  await received;
  await new Promise(resolve => setTimeout(resolve, 1500));
  const active = await api('/chats');
  const row = active.json.chats.find(x => x.id === chat);
  const retry = await api(`/chats/${chat}/messages`, { method: 'POST', body: { text: 'hello again' } });
  assert.equal(row.replying, true);
  assert.equal(retry.status, 409, retry.text);
  results.push({ case: 'truncated-error-response-leaves-chat-busy', afterUpstreamClosedMs: 1500, replying: row.replying, retryStatus: retry.status, retryError: retry.json.error });
  controller.abort();
  await stream;
  mode = 'error-secret';
  const errorChat = await newChat();
  const errorResponse = await api(`/chats/${errorChat}/messages`, { method: 'POST', body: { text: 'hello, error masking check' } });
  const saved = JSON.parse(readFileSync(join(fleet.stateDir, 'chats.json'), 'utf8'));
  const message = saved.conversations.find(c => c.id === errorChat).messages.at(-1);
  assert.ok(message.error.includes(fakeSecret));
  results.push({ case: 'upstream-error-secret-persists-in-chat', httpStatus: errorResponse.status, rawFixtureTokenInSavedError: message.error.includes(fakeSecret), errorField: message.error.replaceAll(fakeSecret, '[FAKE TEST TOKEN]') });
} finally {
  await fleet?.stop();
  await new Promise(resolve => model.close(resolve));
}

console.log(JSON.stringify(results, null, 2));
