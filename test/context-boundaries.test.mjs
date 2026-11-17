// Covers: T42's remaining launch boundaries on the stand-in service: a selected setup's context survives a known
// non-context repair, the third shared attempt publishes no fourth-attempt question, named and verified remote-code
// setups retain page-only consent through an exact shorter retry, a download-first start preserves numeric context,
// and a deadline crossed after rank zero starts prevents rank one and restores earlier work. No real Spark is used.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, mkdirSync, mkdtempSync, chmodSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { T, useFleet, api, choose, waitFor, sleep, createActKey, call, REPO, SLOW } from './lib.mjs';

const MODEL = 'testorg--context-boundary', REPO_NAME = 'testorg/context-boundary';
const SAFE = 'ctxbound128', REMOTE = 'ctxboundremote', VERIFIED = 't42-boundary-verified';
const IMAGE = JSON.parse(readFileSync(join(REPO, 'service', 'config.json'), 'utf8')).images.vllm;
const SAFE_ARGS = ['--max-model-len', '131072', '--max-num-seqs', '4'];
const REMOTE_ARGS = ['--max-model-len', '65536', '--trust-remote-code'];
const WINDOW = Math.min(120000 * SLOW, 600000), OFFSET = WINDOW + 5000;
const BIN = join(REPO, 'test', 'mock', 'bin'), WRAP = mkdtempSync(join(tmpdir(), 'context-boundary-docker-'));
// Record only model-launch identity, rank and context, never environment values. The optional hold happens AFTER
// the real stand-in rank-zero launch succeeds, so the next rank's deadline check must notice the intervening expiry.
writeFileSync(join(WRAP, 'docker'), `#!/bin/bash
name='' rank='' context='' previous=''
if [ "$1" = run ]; then
  for word in "$@"; do
    [ "$previous" != --name ] || name=$word
    case "$word" in spark.rank=*) rank=\${word#spark.rank=} ;; esac
    case "$previous" in --context-length|--max-model-len|--max_seq_len|--ctx-size|-c) context=$word ;; esac
    previous=$word
  done
  case "$name" in sc-*) printf '%s|%s|%s\n' "$name" "$rank" "$context" >> "$HOME/.mock/t42-launches" ;; esac
fi
${JSON.stringify(join(BIN, 'docker'))} "$@"; result=$?
if [ "$result" = 0 ] && [ "$name" = ${JSON.stringify(`sc-${MODEL}`)} ] && [ "$rank" = 0 ] && [ -e "$HOME/.mock/t42-hold-rank0" ]; then
  : > "$HOME/.mock/t42-rank0-started"
  for ((n=0; n<1200; n++)); do [ -e "$HOME/.mock/t42-hold-rank0" ] || break; sleep 0.1; done
fi
exit "$result"
`);
chmodSync(join(WRAP, 'docker'), 0o755);
let agent;
useFleet({ watchMs: 60000, statusMs: 20000, env: {
  NODE_OPTIONS: `--import=${join(REPO, 'test', 'mock', 'clock.mjs')}`,
  SPARK_CONSOLE_FIX_WINDOW_MS: String(WINDOW), PATH: `${WRAP}:${BIN}:${process.env.PATH}`,
}, prepare: ({ root, stateDir }) => {
  for (const spark of ['spark3', 'spark4']) {
    const dir = join(root, spark, 'models', MODEL);
    mkdirSync(dir, { recursive: true });
    copyFileSync(join(root, 'spark3', 'models', 'gpt-oss-20b', 'config.json'), join(dir, 'config.json'));
    writeFileSync(join(dir, 'model.safetensors'), Buffer.alloc(1024));
    writeFileSync(join(dir, 'spark.json'), JSON.stringify({ title: 'Context boundary', engine: 'vllm', image: IMAGE, args: [], memoryGiB: 8 }));
    // This fleet's starts never need a separate approval for a benchmark the owner started by hand.
    const containers = join(root, spark, '.mock', 'containers');
    writeFileSync(containers, readFileSync(containers, 'utf8').split('\n').filter(l => !/^qwen-recipe-/.test(l)).join('\n'));
  }
  writeFileSync(join(stateDir, 'added-models.json'), JSON.stringify({ models: [{ id: 'context-boundary', title: 'Context boundary', variants: [{ repo: REPO_NAME, engine: 'vllm', needGB: 8, sizeGB: 0.001 }],
    setups: [{ id: SAFE, repo: REPO_NAME, engine: 'vllm', image: IMAGE, args: SAFE_ARGS, env: {}, sparks: 1, deployable: true },
      { id: REMOTE, repo: REPO_NAME, engine: 'vllm', image: IMAGE, args: REMOTE_ARGS, env: {}, sparks: 1, deployable: true }] }] }));
  writeFileSync(join(stateDir, 'verified.json'), JSON.stringify({ deployments: [{ key: VERIFIED, model: MODEL, repo: REPO_NAME, title: 'Verified context boundary', engine: 'vllm', image: IMAGE,
    args: REMOTE_ARGS, env: {}, sparks: 1, nodes: ['spark4'], firstAt: '2026-11-10T00:00:00Z', lastAt: '2026-11-10T00:00:00Z', runs: 1, best: { decodeTokS: 10 } }] }));
} }, async () => { agent = await createActKey('context-boundaries'); });
after(() => rmSync(WRAP, { recursive: true, force: true }));
const mock = (spark, file) => join(T.fleet.root, spark, '.mock', file);
const stateOf = (spark, name) => readFileSync(mock(spark, 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];
const launches = (spark, name) => { try { return readFileSync(mock(spark, 't42-launches'), 'utf8').trim().split('\n').map(l => l.split('|')).filter(([n]) => n === `sc-${name}` || n === `sc-${name}-part2`); } catch { return []; } };
const jobs = async () => (await api('/jobs')).json.jobs;
const act = (name, body) => api(`/actions/${name}`, { method: 'POST', body });
async function finished(id) {
  return waitFor(async () => {
    const r = await api(`/jobs/${id}`); assert.equal(r.status, 200, r.text);
    return r.json.status !== 'running' && r.json.finishedAt ? r.json : null;
  }, { timeout: 240000, every: 250, what: `context boundary operation ${id} to finish` });
}
async function offered(job) {
  assert.equal(job.status, 'failed', JSON.stringify(job));
  const ready = await waitFor(async () => { const r = await api(`/jobs/${job.id}`); return r.json.contextQuestion ? r.json : null; }, { what: 'the released boundary operation’s context question' });
  const chat = await api(`/chats/${ready.contextQuestion.chat}`); assert.equal(chat.status, 200, chat.text);
  assert.ok(!chat.json.agent, 'only an owner chat gets the retry decision');
  const yes = chat.json.messages.flatMap(m => m.choices || []).find(c => c.state === 'open' && c.group === ready.contextQuestion.choice && /^Try again/.test(c.label));
  assert.ok(yes, chat.text);
  return { chat: chat.json.id, yes, job: ready };
}
async function approve(q) {
  const r = await choose(q.chat, q.yes.id); assert.equal(r.status, 200, r.text);
  assert.equal(r.json.outcome, 'started', r.text); assert.notEqual(r.json.operation, q.job.id);
  const retry = await finished(r.json.operation); assert.equal(retry.retryOf, q.job.id);
  return retry;
}
async function bodyFor(nodes, extra = {}) {
  const r = await api(nodes.length === 1 ? `/deploy/plan?model=${MODEL}&node=${nodes[0]}` : `/deploy/cluster-plan?model=${MODEL}&nodes=${nodes.join(',')}`);
  assert.equal(r.status, 200, r.text);
  const members = nodes.length === 1 ? [{ node: nodes[0], steps: r.json.steps }] : r.json.members;
  const stops = members.flatMap(m => m.steps.filter(s => s.kind === 'stop').map(s => ({ ...s, node: m.node })));
  return { model: MODEL, ...(nodes.length === 1 ? { node: nodes[0] } : { nodes }), keep: [...new Set(stops.filter(s => !s.required).map(s => s.container))],
    stop: stops.filter(s => s.required).map(s => `${s.node}/${s.container}`), ...extra };
}
function restored(body) { for (const item of body.stop) { const [spark, name] = item.split('/'); assert.equal(stateOf(spark, name), 'running', `${item} restored`); } }

// T42 (part): attempts spent on another known repair count against the same owner-approved context sequence.
test('a selected setup’s third shared attempt fails without offering a fourth attempt', { timeout: 420000 * SLOW }, async t => {
  writeFileSync(mock('spark4', 'reject-flag'), '--max-num-seqs'); writeFileSync(mock('spark4', 'oom-ctx'), '16384');
  t.after(() => { rmSync(mock('spark4', 'reject-flag'), { force: true }); rmSync(mock('spark4', 'oom-ctx'), { force: true }); });
  const before = launches('spark4', MODEL).length;
  const r = await act('start_model', { model: MODEL, spark: 'spark4', setup: SAFE });
  assert.equal(r.status, 200, r.text); assert.equal(r.json.outcome, 'started', r.text);
  const first = await finished(r.json.operation), q = await offered(first);
  assert.deepEqual(launches('spark4', MODEL).slice(before).map(x => x[2]), ['131072', '131072'], 'the non-context repair preserves the selected setup’s exact context');
  assert.ok(first.log.some(l => /attempt 2 of 3/.test(l)), JSON.stringify(first));
  assert.match(q.yes.label, /32,768/);
  // The engine now accepts that flag; the approved retry uses the last shared attempt on a real 32768-token OOM.
  rmSync(mock('spark4', 'reject-flag'), { force: true });
  const third = await approve(q);
  assert.equal(third.status, 'failed'); assert.match(third.error, /32,768/);
  assert.deepEqual(launches('spark4', MODEL).slice(before).map(x => x[2]), ['131072', '131072', '32768']);
  assert.equal(third.contextQuestion, undefined, 'budget exhaustion must withhold the otherwise-eligible 16384-token proposal');
  assert.ok(!(third.choices || []).some(c => /Try again/.test(c.label)));
  const chat = await api(`/chats/${q.chat}`);
  assert.ok(!chat.json.messages.flatMap(m => m.choices || []).some(c => c.state === 'open' && /16,384/.test(c.label)));
  assert.ok(!(await jobs()).some(j => j.retryOf === third.id));
});

for (const [kind, selection] of [['named', { setup: REMOTE }], ['verified', { verified: VERIFIED }]]) {
  // T42 (part): page-only remote-code consent survives its own retry, never an ordinary action or agent start.
  test(`a ${kind} remote-code setup keeps its selected context and page-only permission through a retry`, { timeout: 420000 * SLOW }, async t => {
    writeFileSync(mock('spark4', 'oom-ctx'), '32768'); t.after(() => rmSync(mock('spark4', 'oom-ctx'), { force: true }));
    const body = await bodyFor(['spark4'], selection), before = launches('spark4', MODEL).length;
    const refused = await api('/deploy', { method: 'POST', body });
    assert.equal(refused.status, 409, refused.text); assert.match(refused.json.error, /own code|Allow it/);
    assert.equal(launches('spark4', MODEL).length, before);
    const r = await api('/deploy', { method: 'POST', body: { ...body, allowRemoteCode: true } });
    assert.equal(r.status, 202, r.text);
    const failed = await finished(r.json.id), q = await offered(failed);
    assert.equal(launches('spark4', MODEL).at(-1)[2], '65536', 'the selected setup is protected without a numeric override');
    restored(body);
    const retry = await approve(q); assert.equal(retry.status, 'completed', JSON.stringify(retry));
    assert.equal(launches('spark4', MODEL).at(-1)[2], '32768');
    assert.ok(readFileSync(mock('spark4', 'last-run-args'), 'utf8').split('\n').includes('--trust-remote-code'), 'the owner-approved page setup is still the one that ran');
    const at = (await jobs()).map(j => j.id);
    const ordinary = await act('start_model', { model: MODEL, spark: 'spark4', setup: REMOTE });
    assert.equal(ordinary.status, 409, ordinary.text); assert.match(ordinary.json.error, /own code|Allow it/);
    const byAgent = await call(agent.token, 'start_model', { model: MODEL, spark: 'spark4', setup: REMOTE });
    assert.equal(byAgent.isError, true, byAgent.text); assert.match(byAgent.text, /own code|Allow it/);
    assert.deepEqual((await jobs()).map(j => j.id), at, 'page consent does not create another caller’s launch capability');
  });
}

// T42 (part): the download-then-start branch binds context before its first actual launch, and releases before asking.
test('a download-first numeric request launches exactly that context and asks before its separate shorter retry', { timeout: 420000 * SLOW }, async t => {
  const repo = 'Qwen/Qwen3.5-4B', name = 'Qwen--Qwen3.5-4B';
  writeFileSync(mock('spark4', 'oom-ctx'), '32768'); t.after(() => rmSync(mock('spark4', 'oom-ctx'), { force: true }));
  const before = launches('spark4', name).length;
  const r = await act('start_model', { model: repo, spark: 'spark4', contextTokens: 131072 });
  assert.equal(r.status, 200, r.text); assert.equal(r.json.outcome, 'started', r.text);
  const failed = await finished(r.json.operation); assert.equal(failed.type, 'start-model');
  const q = await offered(failed);
  assert.deepEqual(launches('spark4', name).slice(before).map(x => x[2]), ['131072']);
  const retry = await approve(q); assert.equal(retry.status, 'completed', JSON.stringify(retry));
  assert.deepEqual(launches('spark4', name).slice(before).map(x => x[2]), ['131072', '32768']);
  assert.equal((await api(`/jobs/${failed.id}`)).json.status, 'failed');
});

// T42 (part): a deadline crossed between actual rank launches stops the sequence and restores the prior workloads.
test('expiry after rank zero starts prevents rank one and cleans up the partial pair', { timeout: 420000 * SLOW }, async t => {
  writeFileSync(mock('spark3', 't42-hold-rank0'), '');
  t.after(async () => { rmSync(mock('spark3', 't42-hold-rank0'), { force: true }); rmSync(mock('spark3', 't42-rank0-started'), { force: true }); rmSync(join(T.fleet.dir, 'clock-offset'), { force: true }); await sleep(400); });
  const before3 = launches('spark3', MODEL).length, before4 = launches('spark4', MODEL).length;
  const body = await bodyFor(['spark3', 'spark4'], { contextTokens: 131072 });
  assert.ok(body.stop.length, 'the pair must have earlier work to restore');
  const r = await api('/deploy/cluster', { method: 'POST', body }); assert.equal(r.status, 202, r.text);
  await waitFor(() => { try { return readFileSync(mock('spark3', 't42-rank0-started'), 'utf8') === ''; } catch { return false; } }, { timeout: 120000, every: 100, what: 'the first actual rank launch to complete while held before rank one' });
  assert.equal(stateOf('spark3', `sc-${MODEL}`), 'running');
  writeFileSync(join(T.fleet.dir, 'clock-offset'), String(OFFSET)); await sleep(400);
  rmSync(mock('spark3', 't42-hold-rank0'), { force: true });
  const failed = await finished(r.json.id);
  assert.equal(failed.status, 'failed', JSON.stringify(failed)); assert.match(failed.error, /30 minutes.*ended/);
  assert.deepEqual(launches('spark3', MODEL).slice(before3).map(x => x.slice(1)), [['0', '131072']]);
  assert.equal(launches('spark4', MODEL).length, before4, 'rank one never receives docker run after the deadline');
  assert.notEqual(stateOf('spark3', `sc-${MODEL}`), 'running', 'the partial new pair is stopped');
  restored(body);
  assert.equal(failed.contextQuestion, undefined);
});
