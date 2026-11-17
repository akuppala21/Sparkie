// Covers: T42's page deploy routes preserve numeric and model-owned context, restore earlier work before asking,
// expose a safe owner-chat link, and only start the exact shorter context after an owner press. Both one-Spark and
// two-Spark routes reject malformed context before creating work; retry consent never bypasses workflow validation. These are stand-in service checks, never real GPUs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, choose, waitFor, SLOW } from './lib.mjs';

const MODEL = 'NVIDIA-Nemotron-Nano-9B-v2';
const mock = (id, file) => join(T.fleet.root, id, '.mock', file);
useFleet({ watchMs: 60000, statusMs: 20000, env: { SPARK_CONSOLE_ASSUME_VALIDATED: '0' }, prepare: ({ root }) => {
  for (const id of ['spark2', 'spark3', 'spark4']) {
    const file = join(root, id, 'models', MODEL, 'spark.json');
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(file, JSON.stringify({ ...manifest, args: [...manifest.args, '--context-length', '131072'] }));
  }
} });
const stateOf = (id, name) => readFileSync(mock(id, 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];
const attemptedContext = id => {
  const args = readFileSync(mock(id, 'last-run-args'), 'utf8').split('\n');
  return args[args.findLastIndex(a => ['--context-length', '--max-model-len'].includes(a)) + 1];
};
async function finished(id) {
  return waitFor(async () => {
    const got = await api(`/jobs/${id}`);
    assert.equal(got.status, 200, got.text);
    return got.json.status === 'running' ? null : got.json;
  }, { timeout: 180000, every: 1000, what: `operation ${id} to settle` });
}
async function bodyFor(nodes) {
  const path = nodes.length === 1 ? `/deploy/plan?model=${MODEL}&node=${nodes[0]}` : `/deploy/cluster-plan?model=${MODEL}&nodes=${nodes.join(',')}`;
  const r = await api(path);
  assert.equal(r.status, 200, r.text);
  const members = nodes.length === 1 ? [{ node: nodes[0], steps: r.json.steps }] : r.json.members;
  const stops = members.flatMap(m => m.steps.filter(s => s.kind === 'stop').map(s => ({ ...s, node: m.node })));
  return { model: MODEL, ...(nodes.length === 1 ? { node: nodes[0] } : { nodes }),
    keep: [...new Set(stops.filter(s => !s.required).map(s => s.container))],
    stop: stops.filter(s => s.required).map(s => `${s.node}/${s.container}`) };
}
function restored(body) {
  for (const item of body.stop) {
    const [node, name] = item.split('/');
    assert.equal(stateOf(node, name), 'running', `${item} was restored before asking`);
  }
}
async function questionFor(job) {
  assert.equal(job.status, 'failed', JSON.stringify(job));
  assert.match(job.contextQuestion?.chat || '', /^sc_[0-9a-f]{16}$/);
  assert.doesNotMatch(JSON.stringify(job), /__contextRetry|baseHow|contextRetries/);
  const chat = await api(`/chats/${job.contextQuestion.chat}`);
  assert.equal(chat.status, 200, chat.text);
  assert.doesNotMatch(chat.text, /__contextRetry|baseHow|contextRetries/);
  const choices = chat.json.messages.flatMap(m => m.choices || []);
  const retry = choices.find(c => /Try again with 32,768 tokens/.test(c.label));
  const leave = choices.find(c => c.label === 'Leave it stopped');
  assert.ok(retry && leave, chat.text);
  return { chat: chat.json.id, retry, leave };
}

test('page routes reject malformed explicit context before any job or workload change', async () => {
  const before = (await api('/jobs')).json.jobs.map(j => j.id);
  const containers = ['spark3', 'spark4'].map(id => readFileSync(mock(id, 'containers'), 'utf8'));
  for (const value of [0, -1, 1.5, '131072', null, 2147483648]) {
    for (const [path, target] of [['/deploy', { node: 'spark4' }], ['/deploy/cluster', { nodes: ['spark3', 'spark4'] }]]) {
      const r = await api(path, { method: 'POST', body: { model: MODEL, ...target, keep: [], stop: [], contextTokens: value } });
      assert.equal(r.status, 400, `${path} ${JSON.stringify(value)}: ${r.text}`);
    }
  }
  assert.deepEqual((await api('/jobs')).json.jobs.map(j => j.id), before);
  assert.deepEqual(['spark3', 'spark4'].map(id => readFileSync(mock(id, 'containers'), 'utf8')), containers);
});

// T42 (part): numeric context through the page, rollback before the question, and a distinct approved retry.
test('one-Spark page start preserves explicit context over the manifest, then asks before a shorter separate start', { timeout: 420000 * SLOW }, async t => {
  writeFileSync(mock('spark4', 'oom-ctx'), '32768');
  t.after(() => rmSync(mock('spark4', 'oom-ctx'), { force: true }));
  const body = { ...(await bodyFor(['spark4'])), contextTokens: 65536 };
  assert.ok(body.stop.length, 'earlier work must need restoration');
  const r = await api('/deploy', { method: 'POST', body, headers: { 'X-Spark-Validate': 'start_model' } });
  assert.equal(r.status, 202, r.text);
  const failed = await finished(r.json.id);
  assert.equal(attemptedContext('spark4'), '65536', 'the request overrides the model-owned 131072 setting');
  assert.match(failed.error, /65,536|65536/);
  restored(body);
  const q = await questionFor(failed);
  assert.notEqual(stateOf('spark4', `sc-${MODEL}`), 'running', 'no shorter start before the press');
  const approved = await choose(q.chat, q.retry.id);
  assert.equal(approved.status, 200, approved.text);
  assert.ok(!approved.json.operation, 'context approval does not silently authorize workflow validation');
  assert.equal(attemptedContext('spark4'), '65536', 'the separate validation question starts no attempt');
  const validation = approved.json.messages.flatMap(m => m.choices || []).find(c => c.state === 'open' && /^Yes, run it as its validation/.test(c.label));
  assert.ok(validation, approved.text);
  const validated = await choose(q.chat, validation.id);
  assert.equal(validated.status, 200, validated.text);
  assert.ok(validated.json.operation, validated.text);
  assert.notEqual(validated.json.operation, failed.id);
  const retry = await finished(validated.json.operation);
  assert.equal(retry.status, 'completed', JSON.stringify(retry));
  assert.equal(retry.retryOf, failed.id, 'the approved operation names its failed predecessor');
  assert.equal(attemptedContext('spark4'), '32768', 'the new attempt uses exactly the displayed context');
  assert.equal((await api(`/jobs/${failed.id}`)).json.status, 'failed', 'success never rewrites the failed attempt');
  const replay = await choose(q.chat, q.retry.id);
  assert.equal(replay.status, 409, replay.text);
});

// T42 (part): the page passes the complete model manifest into shared policy for both Sparks.
test('two-Spark page start keeps model-owned context and declining its question creates no retry', { timeout: 420000 * SLOW }, async t => {
  writeFileSync(mock('spark3', 'oom-ctx'), '32768');
  t.after(() => rmSync(mock('spark3', 'oom-ctx'), { force: true }));
  const body = await bodyFor(['spark3', 'spark4']);
  const r = await api('/deploy/cluster', { method: 'POST', body, headers: { 'X-Spark-Validate': 'start_model_across' } });
  assert.equal(r.status, 202, r.text);
  const failed = await finished(r.json.id);
  assert.equal(attemptedContext('spark3'), '131072');
  assert.equal(attemptedContext('spark4'), '131072');
  assert.match(failed.error, /131,072|131072/);
  restored(body);
  const q = await questionFor(failed);
  const before = (await api('/jobs')).json.jobs.map(j => j.id);
  const declined = await choose(q.chat, q.leave.id);
  assert.equal(declined.status, 200, declined.text);
  assert.ok(!declined.json.operation, declined.text);
  assert.deepEqual((await api('/jobs')).json.jobs.map(j => j.id), before);
  assert.equal((await api(`/jobs/${failed.id}`)).json.status, 'failed');
  restored(body);
});
