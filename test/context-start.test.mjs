// Covers: T42's action and chat flow: exact owner context reaches a real stand-in launch, OOM is put back before an
// owner-only question, each shorter launch needs one press and a new operation, a second reduction asks again, and
// replay or changed settings starts nothing. A short press exercises late completion; private retry data stays off
// public jobs and chat. Late questions park the right request before continuation, including a failure while its
// original reply still streams, and never park or end a newer request in that chat. An agent-originated start hands
// its context decision to an owner chat; approved retries and later questions keep that owner destination. No real
// Spark is contacted.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, choose, newChat, say, waitFor, sleep, createActKey, call, SLOW } from './lib.mjs';

const MODEL = 'RadixArk--Qwen3.8-27B-NVFP4', BOX = `sc-${MODEL}`, REPO_NAME = 'RadixArk/Qwen3.8-27B-NVFP4';
let agent;
useFleet({ watchMs: 60000, statusMs: 20000, knowledge: true, env: { SPARK_CONSOLE_PRESS_MS: '1', SPARK_CONSOLE_CONTINUE_MS: '30' } }, async () => { agent = await createActKey('context'); });
const mock = (spark, file) => join(T.fleet.root, spark, '.mock', file);
const jobs = async () => (await api('/jobs')).json.jobs;
const wanted = j => j.model === MODEL && (j.node === 'spark4' || j.nodes?.includes('spark4'));
const task = chat => JSON.parse(readFileSync(join(T.fleet.stateDir, 'chats.json'), 'utf8')).conversations.find(c => c.id === chat)?.task;
const ctxArgs = () => readFileSync(mock('spark4', 'last-run-args'), 'utf8').split('\n');
function actualContext() { const args = ctxArgs(), i = args.findLastIndex(x => ['--context-length', '--max-model-len', '--max_seq_len', '-c', '--ctx-size'].includes(x)); assert.ok(i >= 0, args.join(' ')); return Number(args[i + 1]); }
async function ended(id) { return waitFor(async () => { const r = await api(`/jobs/${id}`); return r.json?.status && r.json.status !== 'running' ? r.json : null; }, { timeout: 300000, what: `operation ${id} to end` }); }
async function start(contextTokens, model = MODEL) {
  const r = await api('/actions/start_model', { method: 'POST', body: { model, spark: 'spark4', contextTokens } });
  assert.equal(r.status, 200, r.text); assert.equal(r.json.outcome, 'started', r.text);
  return r.json.operation;
}
async function offered(job) {
  assert.equal(job.status, 'failed', JSON.stringify(job));
  const ready = await waitFor(async () => { const r = await api(`/jobs/${job.id}`); return r.json.contextQuestion ? r.json : null; }, { what: 'the released operation’s owner question' });
  assert.match(ready.contextQuestion.chat, /^sc_[0-9a-f]{16}$/);
  assert.doesNotMatch(JSON.stringify(ready), /__contextRetry|baseHow|contextRetries|fingerprint/);
  const r = await api(`/chats/${ready.contextQuestion.chat}`); assert.equal(r.status, 200, r.text);
  assert.ok(!r.json.agent, 'the decision is in an owner chat');
  const choices = r.json.messages.flatMap(m => m.choices || []).filter(c => c.group === ready.contextQuestion.choice && c.state === 'open');
  return { chat: ready.contextQuestion.chat, yes: choices.find(c => /^Try again/.test(c.label)), no: choices.find(c => /Leave it stopped/.test(c.label)), job: ready };
}
async function approve(q) {
  assert.ok(q.yes?.id);
  const r = await choose(q.chat, q.yes.id); assert.equal(r.status, 200, r.text);
  assert.equal(r.json.outcome, 'running', 'the 1 ms press returns before fresh planning; its later result must stay bound');
  const retry = await waitFor(async () => (await jobs()).find(j => j.retryOf === q.job.id), { timeout: 60000, what: 'the approved retry operation' });
  assert.notEqual(retry.id, q.job.id);
  return ended(retry.id);
}

describe('explicit context decisions', { concurrency: 1 }, () => {
  test('131072 → owner 32768 → owner 16384: three distinct attempts, no unapproved reduction and no replay', { timeout: 600000 * SLOW }, async () => {
    writeFileSync(mock('spark4', 'oom-ctx'), '16384');
    try {
      const before = new Set((await jobs()).filter(wanted).map(j => j.id));
      const first = await ended(await start(131072));
      assert.equal(actualContext(), 131072);
      const q = await offered(first); assert.match(q.yes.label, /32,768/);
      assert.equal(readFileSync(mock('spark4', 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${BOX}|`))?.split('|')[1], 'running', 'the old copy was put back before asking');
      assert.equal((await jobs()).filter(j => wanted(j) && !before.has(j.id)).length, 1);
      const agentPress = await call(agent.token, 'start_model', { choice: q.yes.id });
      assert.equal(agentPress.isError, true, 'an agent cannot answer the owner’s question');
      const second = await approve(q); assert.equal(second.status, 'failed'); assert.equal(actualContext(), 32768);
      const q2 = await offered(second); assert.match(q2.yes.label, /16,384/);
      assert.equal((await jobs()).filter(j => wanted(j) && !before.has(j.id)).length, 2, 'no automatic third attempt');
      const third = await approve(q2); assert.equal(third.status, 'completed', JSON.stringify(third)); assert.equal(actualContext(), 16384);
      assert.equal((await jobs()).filter(j => wanted(j) && !before.has(j.id)).length, 3);
      const replay = await choose(q.chat, q.yes.id); assert.equal(replay.status, 409, replay.text);
      const replay2 = await choose(q2.chat, q2.yes.id); assert.equal(replay2.status, 409, replay2.text);
      const publicText = JSON.stringify((await jobs()).filter(wanted)) + JSON.stringify((await api(`/chats/${q.chat}`)).json);
      assert.doesNotMatch(publicText, /__contextRetry|baseHow|contextRetries|fingerprint/);
      const files = [join(T.fleet.stateDir, 'audit.jsonl'), ...readdirSync(T.fleet.journalDir).filter(f => /\.(jsonl|out)$/.test(f)).map(f => join(T.fleet.journalDir, f))];
      for (const file of files) if (existsSync(file)) assert.doesNotMatch(readFileSync(file, 'utf8'), /"__contextRetryToken"\s*:\s*"(?!\[hidden\])[^"\n]+"/, 'private retry token must be masked in records');
    } finally { rmSync(mock('spark4', 'oom-ctx'), { force: true }); }
  });

  test('an explicit context below the automatic floor reports only the size it actually tried', { timeout: 300000 * SLOW }, async () => {
    writeFileSync(mock('spark4', 'oom-ctx'), '4096');
    try {
      const before = new Set((await jobs()).filter(wanted).map(j => j.id));
      const failed = await ended(await start(8192));
      assert.equal(failed.status, 'failed'); assert.equal(actualContext(), 8192);
      assert.match(failed.error, /out of memory at 8,192 context tokens/);
      assert.doesNotMatch(failed.error, /16,384/);
      assert.equal(failed.contextQuestion, undefined, 'there is no automatic proposal below the floor');
      assert.equal((await jobs()).filter(j => wanted(j) && !before.has(j.id)).length, 1);
    } finally { rmSync(mock('spark4', 'oom-ctx'), { force: true }); }
  });

  test('changed model settings expire an approved choice before any new operation starts', { timeout: 300000 * SLOW }, async () => {
    writeFileSync(mock('spark4', 'oom-ctx'), '32768');
    const modelName = 'Qwen3-30B-A3B-Instruct-2507';
    // This model needs 75 GiB. Give the fixture room to reach the fingerprint gate under test.
    const memory = mock('spark4', 'meminfo'), beforeMemory = readFileSync(memory, 'utf8');
    writeFileSync(memory, beforeMemory.replace(/^MemAvailable:.*$/m, 'MemAvailable: 110100480 kB'));
    const originals = ['spark3', 'spark4'].map(id => { const path = join(T.fleet.root, id, 'models', modelName, 'spark.json'); return { path, text: readFileSync(path, 'utf8') }; });
    try {
      const q = await offered(await ended(await start(131072, modelName))), before = (await jobs()).filter(j => j.model === modelName).map(j => j.id).sort();
      for (const file of originals) { const model = JSON.parse(file.text); model.args = [...(model.args || []), '--dtype', 'bfloat16']; writeFileSync(file.path, JSON.stringify(model)); }
      assert.equal((await choose(q.chat, q.yes.id)).status, 200);
      await waitFor(async () => (await api(`/chats/${q.chat}`)).json.messages.some(m => /model or setup changed|model, setup or Sparks changed/.test(m.content || '')), { timeout: 60000, what: 'the stale-context refusal' });
      assert.deepEqual((await jobs()).filter(j => j.model === modelName).map(j => j.id).sort(), before);
    } finally { for (const file of originals) writeFileSync(file.path, file.text); writeFileSync(memory, beforeMemory); rmSync(mock('spark4', 'oom-ctx'), { force: true }); }
  });

  test('an agent-originated start hands retry results and later context questions to the same owner chat', { timeout: 420000 * SLOW }, async () => {
    writeFileSync(mock('spark4', 'oom-ctx'), '16384');
    writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify([{ match: '^start RadixArk/Qwen3.8-27B-NVFP4 on Spark 4 with a 128k context$', calls: [{ name: 'start_model', arguments: { model: MODEL, spark: 'spark4', contextTokens: 131072 } }], answer: 'The start is under way.' }]));
    try {
      const asked = await call(agent.token, 'ask_sparkie', { message: `start ${REPO_NAME} on Spark 4 with a 128k context` });
      assert.equal(asked.isError, false, asked.text);
      const origin = asked.value.conversation;
      const first = await waitFor(async () => (await jobs()).find(j => wanted(j) && j.conv === origin), { timeout: 60000, what: 'the agent-originated start in its chat' });
      const q = await offered(await ended(first.id));
      assert.notEqual(q.chat, origin, 'an agent chat is not the owner decision destination');
      await waitFor(async () => (await api(`/chats/${origin}`)).json.messages.some(m => m.operation === first.id), { what: 'the original failure notice in the agent chat' });
      assert.ok(!(await api(`/chats/${origin}`)).json.messages.flatMap(m => m.choices || []).some(c => c.group === q.job.contextQuestion.choice), 'owner retry buttons are not repeated in the agent chat');
      const second = await approve(q);
      assert.equal(second.status, 'failed'); assert.equal(actualContext(), 32768);
      assert.equal(second.conv, q.chat, 'the approved retry posts its result in the owner chat');
      const q2 = await offered(second);
      assert.equal(q2.chat, q.chat, 'the second context question stays in the same owner chat');
      await waitFor(async () => (await api(`/chats/${q.chat}`)).json.messages.some(m => m.notice && m.operation === second.id && m.status === 'failed'), { what: 'the retry’s failed-operation notice in the owner chat' });
      const ownerMessages = (await api(`/chats/${q.chat}`)).json.messages;
      assert.equal(ownerMessages.flatMap(m => m.choices || []).filter(c => c.group === q2.job.contextQuestion.choice).length, 2, 'the owner sees each retry button once');
      assert.ok(!(await api(`/chats/${origin}`)).json.messages.some(m => m.operation === second.id), 'the retry result does not return to the agent chat');
      assert.equal((await choose(q2.chat, q2.no.id)).status, 200);
    } finally { rmSync(mock('spark4', 'oom-ctx'), { force: true }); rmSync(join(T.fleet.dir, 'model-script.json'), { force: true }); }
  });

  test('a question raised while the original reply still streams parks that same request before it can continue', { timeout: 300000 * SLOW }, async () => {
    writeFileSync(mock('spark4', 'oom-ctx'), '32768');
    writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify([{ match: '^start RadixArk/Qwen3.8-27B-NVFP4 on Spark 4 with a 128k context then report', calls: [{ name: 'start_model', arguments: { model: MODEL, spark: 'spark4' } }], answer: 'Waiting for the operation. '.repeat(1000) }]));
    const chat = await newChat(); let reply, replied = false;
    try {
      reply = say(chat, `start ${REPO_NAME} on Spark 4 with a 128k context then report its speed`).finally(() => { replied = true; });
      // Keep a rejection observed even if an earlier polling assertion fails.
      reply.catch(() => {});
      const job = await waitFor(async () => (await jobs()).find(j => wanted(j) && j.conv === chat), { what: 'the chat’s context start' });
      const q = await offered(await ended(job.id));
      assert.equal(replied, false, 'the question is published before the original streamed reply finishes');
      await reply;
      assert.equal(q.chat, chat);
      assert.ok(task(chat)?.parked, 'the request waits for its owner decision');
      assert.ok(task(chat)?.asks.includes(q.job.contextQuestion.choice));
      const before = (await jobs()).filter(wanted).length;
      await sleep(500);
      assert.equal((await jobs()).filter(wanted).length, before, 'the unanswered question creates no continuation start');
      assert.equal((await choose(chat, q.no.id)).status, 200);
      assert.equal(task(chat), null, 'declining ends only that request');
    } finally { await reply?.catch(() => {}); rmSync(mock('spark4', 'oom-ctx'), { force: true }); rmSync(join(T.fleet.dir, 'model-script.json'), { force: true }); }
  });

  test('a late question from A neither parks nor declines the owner’s newer request B', { timeout: 360000 * SLOW }, async () => {
    writeFileSync(mock('spark4', 'oom-ctx'), '32768');
    writeFileSync(mock('spark4', 'slow-run'), '10');
    writeFileSync(mock('spark3', 'serve-down'), '');
    writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify([
      { match: '^start RadixArk/Qwen3.8-27B-NVFP4', calls: [{ name: 'start_model', arguments: { model: MODEL, spark: 'spark4' } }], answer: 'The start is under way.' },
      { match: '^start gpt-oss-20b', calls: [{ name: 'start_model', arguments: { model: 'gpt-oss-20b', spark: 'spark3' } }], answer: 'The other start is under way.' },
    ]));
    const chat = await newChat(); let other;
    try {
      await say(chat, `start ${REPO_NAME} on Spark 4 with a 128k context then report its speed`);
      const original = await waitFor(async () => (await jobs()).find(j => wanted(j) && j.conv === chat), { what: 'request A’s start' });
      assert.equal(original.status, 'running', 'request B begins before A has finished');
      const answer = await say(chat, 'start gpt-oss-20b on Spark 3 then report its speed');
      assert.ok(!(answer.message.choices || []).length, JSON.stringify(answer.message));
      const newer = task(chat); assert.ok(newer?.id);
      other = await waitFor(async () => (await jobs()).find(j => j.conv === chat && j.node === 'spark3' && j.type === 'deploy'), { what: 'request B’s loading start' });
      assert.equal((await api(`/jobs/${original.id}`)).json.status, 'running', 'B has its own request before A can ask');
      const q = await offered(await ended(original.id));
      assert.equal(task(chat)?.id, newer.id);
      assert.equal(task(chat)?.parked, undefined, 'A’s late question must not park B');
      assert.equal((await choose(chat, q.no.id)).status, 200);
      assert.equal(task(chat)?.id, newer.id, 'declining A does not end B');
      assert.equal(task(chat)?.parked, undefined);
    } finally {
      await say(chat, '/stop').catch(() => {});
      if (other) { await api(`/jobs/${other.id}/cancel`, { method: 'POST', body: {} }); await ended(other.id); }
      rmSync(mock('spark4', 'slow-run'), { force: true }); rmSync(mock('spark3', 'serve-down'), { force: true }); rmSync(mock('spark4', 'oom-ctx'), { force: true }); rmSync(join(T.fleet.dir, 'model-script.json'), { force: true });
    }
  });
});
