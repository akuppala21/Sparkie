// The self-test (self_test, 21-selftest.mjs; design D 2.9): on one compute Spark that is on and free, a small model
// (started, stopping nothing), the healing drill (its container killed by id, self-healing brings it back), a stop, a
// small web page whose link answers, and a job with the GPU that also calls the model address from inside its
// container; one line per check, in order, with its seconds. Nothing is left running, nothing starts on the hub, and
// nothing that ran before is stopped.
//
// The stand-in fleet: Spark 3 is made free (its model of Spark Console's is stopped; a benchmark started outside Spark
// Console keeps running there, using no GPU), so it is the one picked (Spark 4 runs a model, Spark 1 is off, Spark 2 is
// the hub). On Spark 3 a job really runs its command (~/.mock/jobs-run: sh, the stand-in nvidia-smi, and python3 calling
// this service's /v1/models), and starts are stamped with their time (~/.mock/stamp-starts), so the drill's model has
// run for seconds, not days: self-healing would pass over it but for the drill's mark. The web page is a server this
// test runs on the port the self-test opens.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { T, useFleet, api, call, createActKey, createKey, newChat, say, chatMessages, eventLines, waitFor, sleep, agentSettings, SLOW } from './lib.mjs';

const page = await new Promise(res => { const s = http.createServer((req, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end('<p>self-test</p>'); }); s.listen(0, '127.0.0.1', () => res(s)); });
const WEB_PORT = page.address().port;
after(() => page.close());

const MOCK_BIN = join(dirname(fileURLToPath(import.meta.url)), 'mock', 'bin');
const keys = {};
const SINCE = '2026-11-12T08:00:00.000Z';
const SEEDED_RUNNING = [
  { spark: 'spark4', container: 'sc-RadixArk--Qwen3.8-27B-NVFP4', model: 'RadixArk--Qwen3.8-27B-NVFP4', since: SINCE, by: 'owner' },
  { spark: 'spark3', container: 'sc-testorg--Qwen3.8-27B-abliterated-GGUF', model: 'testorg--Qwen3.8-27B-abliterated-GGUF', since: SINCE, by: 'owner' },
];
const SEEDED = { revision: 1, running: SEEDED_RUNNING, revisions: [{ revision: 1, at: SINCE, by: 'owner', chat: null, operation: null, added: SEEDED_RUNNING.map(x => `${x.spark}/${x.container}`), removed: [], before: [] }] };
const mockFile = (spark, file) => join(T.fleet.root, spark, '.mock', file);
useFleet({ watchMs: 2000, statusMs: 3000,
  env: { SPARK_CONSOLE_SELFTEST_PORT: String(WEB_PORT), SPARK_CONSOLE_JOB_WAIT_MS: '500', SPARK_CONSOLE_APP_ANSWER_MS: '20000', SPARK_CONSOLE_SELFTEST_HEAL_MS: '60000',
    SPARK_CONSOLE_DIG_FIXTURE: join(dirname(fileURLToPath(import.meta.url)), 'mock', 'dig-fixture.json') },
  prepare: ({ root, stateDir }) => {
    const list = join(root, 'spark3', '.mock', 'containers');
    writeFileSync(list, readFileSync(list, 'utf8').replace(/^(sc-testorg--Qwen3\.8-27B-abliterated-GGUF)\|running\|[^|]*\|/m, '$1|exited|Exited (0) 2 hours ago|'));
    // (and on Spark 3 a container made again under a name gets a new id, as Docker gives)
    for (const f of ['jobs-run', 'stamp-starts', 'ids-per-run']) writeFileSync(join(root, 'spark3', '.mock', f), '');
    // The owner's list of what should be running, as it would be on a fleet that has been up a while: Spark 4's model, and
    // one on Spark 3 that is down (stopped above). Written here, so the service never seeds it itself in the middle of a
    // test (it does that 60 s after it starts when there is no list).
    writeFileSync(join(stateDir, 'desired.json'), JSON.stringify(SEEDED), { mode: 0o600 });
  } }, async () => {
  keys.act = await createActKey('selftest');
  keys.look = await createKey('selftest-look');
  // The watcher's first look (15 s after the start) has to have seen Spark 3, as on a fleet that has been up a while.
  await waitFor(async () => (await call(keys.look.token, 'workloads', { spark: 'spark3' })).value?.count > 0, { timeout: 60000, what: 'the watcher\'s first look' });
});

// name → state, from the stand-in docker's list.
const states = spark => Object.fromEntries(readFileSync(mockFile(spark, 'containers'), 'utf8').split('\n').filter(Boolean).map(l => l.split('|')).map(([n, s]) => [n, s]));
const running = spark => Object.entries(states(spark)).filter(([, s]) => s === 'running').map(([n]) => n).sort();
const desiredRunning = () => JSON.parse(readFileSync(join(T.fleet.stateDir, 'desired.json'), 'utf8')).running.map(x => `${x.spark}/${x.container}`).sort();
const operations = async () => (await call(keys.look.token, 'recent_operations', { limit: 50 })).value.operations;
async function finished(id, timeout = 300000) {
  for (const until = Date.now() + timeout * SLOW; ;) {
    const j = (await api(`/jobs/${id}`)).json;
    if (j.status !== 'running') return j;
    assert.ok(Date.now() < until, `operation ${id} still running: ${j.step}`);
    await sleep(1000);
  }
}
const ORDER = ['Model', 'Healing', 'Stop', 'App', 'Job', 'Model address from a container', 'Left behind'];
// A container's id on Spark 3, as the stand-in docker made it (ids-per-run).
const idOn3 = name => readFileSync(mockFile('spark3', `id-${name}`), 'utf8').trim();
// The stand-in docker on one Spark, as someone at its terminal would run it.
const byHand = (spark, ...args) => execFileSync('bash', [join(MOCK_BIN, 'docker'), ...args], { env: { ...process.env, HOME: join(T.fleet.root, spark), PATH: `${MOCK_BIN}:${process.env.PATH}` }, encoding: 'utf8' });

const first = {};
test('asked in the owner\'s words, it runs at once: the lines come in order, each with its seconds, and nothing is left running or on the hub', { timeout: 600000 * SLOW }, async () => {
  first.before = { spark2: running('spark2'), spark3: running('spark3'), spark4: running('spark4') };
  first.hub = readFileSync(mockFile('spark2', 'containers'), 'utf8');
  first.desired = desiredRunning();
  assert.deepEqual(first.desired, SEEDED_RUNNING.map(x => `${x.spark}/${x.container}`).sort(), 'the seeded list');
  first.since = new Date().toISOString();
  writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify([{ match: 'run the self-test', calls: [{ name: 'self_test', arguments: {} }] }]));
  let chat, r;
  try { chat = await newChat(); r = await say(chat, 'run the self-test'); } finally { rmSync(join(T.fleet.dir, 'model-script.json'), { force: true }); }
  assert.deepEqual(r.tools.map(t => [t.name, t.ok, t.change]), [['self_test', true, true]]);
  assert.match(r.text, /"outcome":"started"/, r.text);
  const id = /"operation":"([0-9a-f]{12})"/.exec(r.text)[1];
  const j = await finished(id);
  first.job = j;
  assert.equal(j.type, 'self-test');
  assert.equal(j.status, 'completed', `${j.error}\n${(j.report || j.log).join('\n')}`);
  assert.equal(j.node, 'spark3', 'the free compute Spark');
  assert.deepEqual(j.report.map(l => l.split(':')[0]), ORDER, j.report.join('\n'));
  for (const l of j.report.slice(0, 6)) assert.match(l, /^[A-Za-z ]+: worked in \d+ s\. \S/, l);
  assert.match(j.report[0], /answered its test prompt/);
  assert.match(j.report[3], /A small web page answered at its link/);
  assert.match(j.report[4], /nvidia-smi worked; its output is in jobs\/spark-selftest-job-[0-9a-f]{8} in the shared folder on Spark 3/);
  assert.match(j.report[5], /got the model list from http:\/\/127\.0\.0\.1:\d+\/console\/api\/v1\/models from inside its container/);
  assert.match(j.report[6], /^Left behind: nothing running\. sc-\S+ is stopped on Spark 3, as after any stop\. spark-selftest-web-[0-9a-f]{8} and spark-selftest-job-[0-9a-f]{8} are stopped there and used again next time\.$/, j.report[6]);
  // The job's files are in its own folder in Spark 3's shared folder.
  const job = /jobs\/(spark-selftest-job-[0-9a-f]{8})/.exec(j.report[4])[1];
  const out = join(T.fleet.root, 'spark3', '.local', 'share', 'spark-portal', 'workspaces', 'shared', 'jobs', job);
  assert.equal(JSON.parse(readFileSync(join(out, 'models.json'), 'utf8')).object, 'list');
  assert.ok(existsSync(join(out, 'gpu.txt')));
  // Its result is posted in the chat, with the lines.
  const posted = await waitFor(async () => (await chatMessages(chat)).find(m => m.notice && m.operation === id), { timeout: 30000, what: 'the posted result' });
  assert.match(posted.content, /^Done: the self-test with \S+ on Spark 3 finished\.\nModel: worked in \d+ s\./, posted.content);
  assert.ok(posted.content.includes(j.report[6]), posted.content);
  // Nothing of it runs now; nothing new on the hub; the list of what should be running is as it was.
  assert.deepEqual(running('spark3'), first.before.spark3);
  assert.equal(readFileSync(mockFile('spark2', 'containers'), 'utf8'), first.hub, 'Spark 2 untouched');
  assert.deepEqual(desiredRunning(), first.desired);
  // The test's model never touched the list: its start, the drill's restart and its stop leave it alone.
  const model = /\b(sc-\S+) is stopped on Spark 3/.exec(j.report[6])[1];
  const revisions = JSON.parse(readFileSync(join(T.fleet.stateDir, 'desired.json'), 'utf8')).revisions;
  assert.deepEqual(revisions.filter(rv => [...(rv.added || []), ...(rv.removed || [])].includes(`spark3/${model}`)), []);
  // Every step ran on Spark 3, none on the hub.
  const steps = (await operations()).filter(o => o.actor === 'Self-test' || o.id === id);
  assert.ok(steps.length >= 6, JSON.stringify(steps));
  assert.ok(steps.every(o => o.spark === 'spark3'), JSON.stringify(steps.map(o => [o.type, o.spark])));
});

test('the healing drill kills only the container this run started, by its id, and self-healing brings it back', async () => {
  assert.ok(first.job, 'the first run ran');
  const model = /\b(sc-\S+) is stopped on Spark 3/.exec(first.job.report[6])[1];
  // One kill, on Spark 3 only, by the full id of the model's container (the one the run made).
  assert.match(idOn3(model), /^[0-9a-f]{64}$/);
  assert.deepEqual(readFileSync(mockFile('spark3', 'killed'), 'utf8').trim().split('\n'), [idOn3(model)]);
  for (const sp of ['spark1', 'spark2', 'spark4', 'spark5']) assert.ok(!existsSync(mockFile(sp, 'killed')), `nothing killed on ${sp}`);
  // The watcher called it a crash, as the drill's, and self-healing restarted it.
  const ev = eventLines().filter(e => e.at >= first.since && e.container === model);
  const crash = ev.find(e => e.type === 'crashed');
  assert.ok(crash, JSON.stringify(ev));
  assert.deepEqual([crash.spark, crash.drill, crash.exitCode], ['spark3', true, 137]);
  const healing = ev.find(e => e.type === 'healing');
  assert.ok(healing?.operation, JSON.stringify(ev));
  const restart = (await api(`/jobs/${healing.operation}`)).json;
  assert.deepEqual([restart.type, restart.status, restart.actor], ['restart', 'completed', 'Self-healing']);
  assert.match(first.job.report[1], /^Healing: worked in \d+ s\. sc-\S+ was stopped hard on purpose \(only the container this test started\), and self-healing started it again; it answers again\.$/);
});

test('a model that was already running is still running after, on every Spark, and none of them was stopped', async () => {
  assert.ok(first.job, 'the first run ran');
  // (sc-gpt-oss-20b and Sparkie's on the hub; a benchmark on Spark 3 itself; a model on Spark 4)
  assert.ok(first.before.spark2.includes('sc-gpt-oss-20b') && first.before.spark3.includes('qwen-recipe-chisel') && first.before.spark4.includes('sc-RadixArk--Qwen3.8-27B-NVFP4'), JSON.stringify(first.before));
  assert.deepEqual({ spark2: running('spark2'), spark3: running('spark3'), spark4: running('spark4') }, first.before);
  const stopped = eventLines().filter(e => e.at >= first.since && ['stopped', 'crashed'].includes(e.type) && first.before[e.spark]?.includes(e.container));
  assert.deepEqual(stopped, []);
});

test('with the stand-in GPU broken, the job line fails and the others still report; its stopped containers are used again', { timeout: 600000 * SLOW }, async () => {
  writeFileSync(mockFile('spark3', 'gpu-broken'), '');
  try {
    const before = running('spark3');
    const r = await api('/actions/self_test', { method: 'POST', body: {} });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.outcome, 'started', r.text);
    const j = await finished(r.json.operation);
    assert.equal(j.status, 'failed', JSON.stringify(j));
    assert.equal(j.error, 'The self-test found a problem: job.');
    assert.deepEqual(j.report.map(l => l.split(':')[0]), ORDER, j.report.join('\n'));
    assert.match(j.report[4], /^Job: failed in \d+ s\. nvidia-smi didn’t work inside the job \(exit 9\); what it said is in jobs\/spark-selftest-job-[0-9a-f]{8}\/gpu\.txt in the shared folder on Spark 3\.$/, j.report[4]);
    for (const i of [0, 1, 2, 3, 5]) assert.match(j.report[i], /: worked in \d+ s\. /, j.report[i]);
    assert.match(j.report[6], /^Left behind: nothing running\./);
    // The web page's and job's containers from the first run were started again, not made anew.
    const web = /(spark-selftest-web-[0-9a-f]{8})/.exec(first.job.report[6])[1], job = /(spark-selftest-job-[0-9a-f]{8})/.exec(first.job.report[6])[1];
    assert.deepEqual(Object.keys(states('spark3')).filter(n => /^spark-selftest-/.test(n)).sort(), [job, web].sort());
    assert.deepEqual(running('spark3'), before);
  } finally { rmSync(mockFile('spark3', 'gpu-broken'), { force: true }); }
});

test('a third self-test within the hour: self-healing would pass the model over, so the drill isn\'t run ("not tried", with why and when), nothing is killed, and the run passes', { timeout: 600000 * SLOW }, async () => {
  const before = { spark3: running('spark3'), desired: desiredRunning(), killed: readFileSync(mockFile('spark3', 'killed'), 'utf8') }, since = new Date().toISOString();
  const r = await api('/actions/self_test', { method: 'POST', body: {} });
  assert.equal(r.status, 200, r.text);
  const j = await finished(r.json.operation);
  assert.equal(j.status, 'completed', `${j.error}\n${(j.report || []).join('\n')}`);
  assert.match(j.report[1], /^Healing: not tried\. Self-healing restarted sc-\S+ twice in the last hour, the most it does, so the drill didn’t run\. Ask again in about \d+ minutes?\.$/, j.report[1]);
  assert.match(j.report[2], /^Stop: worked in \d+ s\./, j.report[2]);
  for (const i of [3, 4, 5]) assert.match(j.report[i], /: worked in \d+ s\. /, j.report[i]);
  assert.match(j.report[6], /^Left behind: nothing running\./);
  assert.equal(readFileSync(mockFile('spark3', 'killed'), 'utf8'), before.killed, 'nothing killed');
  const model = /\b(sc-\S+) was|restarted (sc-\S+) twice/.exec(j.report[1]).slice(1).find(Boolean);
  assert.ok(!eventLines().some(e => e.at >= since && e.container === model && ['crashed', 'healing', 'heal-skipped'].includes(e.type)), 'no crash, no restart');
  assert.deepEqual(desiredRunning(), before.desired);
  assert.deepEqual(running('spark3'), before.spark3);
});

test('the model it stops is the container it started, by id: one made by hand under that name on that Spark during the test keeps running', { timeout: 600000 * SLOW }, async () => {
  const r = await api('/actions/self_test', { method: 'POST', body: {} });
  assert.equal(r.status, 200, r.text);
  const id = r.json.operation, name = r.json.container;
  assert.match(name, /^sc-/, r.text);
  const job = async () => (await api(`/jobs/${id}`)).json;
  // Once it is past its model (stopped by it, or left down by its drill), someone runs a container of that name there by
  // hand (docker rm, docker run: a new container, a new id), while the self-test goes on with its web page and job.
  await waitFor(async () => (await job()).log.some(l => /A small web page on Spark 3/.test(l)), { timeout: 300000, what: 'the self-test\'s App step' });
  const before = idOn3(name);
  byHand('spark3', 'rm', '-f', name);
  byHand('spark3', 'run', '-d', '--name', name, '--label', 'spark.console=1', '--label', `spark.model=${name.slice(3)}`, 'vllm/vllm-openai:v0.20.0');
  const theirs = idOn3(name);
  assert.notEqual(theirs, before, 'a new container');
  const j = await finished(id);
  assert.ok(j.report?.length, JSON.stringify(j));
  // That container: still running, the same one; the report doesn't count it as the test's.
  assert.equal(states('spark3')[name], 'running', j.report.join('\n'));
  assert.equal(idOn3(name), theirs);
  assert.doesNotMatch(j.report[6], new RegExp(`${name} (is stopped|still running)`), j.report[6]);
  // (put back as it was)
  byHand('spark3', 'stop', name);
});
test('an operation under way on a compute Spark makes it not free; one the owner starts there during the test is never cancelled by it', { timeout: 600000 * SLOW }, async () => {
  // The owner's start of a model that isn't on disk: it downloads first, holding no claim (the stand-in download is held
  // while hf-hold is there).
  const hold = mockFile('spark3', 'hf-hold');
  const download = async () => {
    const d = await api('/actions/start_model', { method: 'POST', body: { model: 'qwen3.5-4b', spark: 'spark3' } });
    assert.equal(d.status, 200, d.text);
    assert.equal(d.json.outcome, 'started', d.text);
    await waitFor(async () => /Downloading/i.test((await api(`/jobs/${d.json.operation}`)).json.step || ''), { timeout: 60000, what: 'the download under way' });
    return d.json.operation;
  };
  // (let go: the stand-in download fails, so the operation ends and nothing lands on disk)
  const release = async op => {
    writeFileSync(mockFile('spark3', 'hf-fails'), '');
    rmSync(hold, { force: true });
    try { await finished(op); } finally { rmSync(mockFile('spark3', 'hf-fails'), { force: true }); }
  };
  writeFileSync(hold, '');
  let op = await download();
  try {
    // Asked while it runs: Spark 3 isn't free (and Spark 4 runs a model), so nothing is started.
    const ops = (await operations()).length;
    const no = await api('/actions/self_test', { method: 'POST', body: {} });
    assert.equal(no.status, 409, no.text);
    assert.match(no.json.error, /Spark 3 has an operation under way \(start-model [^)]*Qwen3\.5-4B[^)]*\)/i, no.json.error);
    assert.equal((await operations()).length, ops, 'nothing started');
    assert.equal((await api(`/jobs/${op}`)).json.status, 'running');
  } finally { await release(op); }
  // Started while the self-test runs there: it is left alone, also by the self-test's stop of its own model. (Automatic
  // restarts are off for this run, so the drill doesn't run and the Stop step has a model to stop.)
  writeFileSync(hold, '');
  await agentSettings({ selfHeal: false });
  let j;
  try {
    const r = await api('/actions/self_test', { method: 'POST', body: {} });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.spark, 'spark3');
    op = await download();
    j = await finished(r.json.operation);
  } finally { await agentSettings({ selfHeal: true }); }
  try {
    assert.match(j.report[2], /^Stop: worked in \d+ s\./, j.report.join('\n'));
    const owner = (await api(`/jobs/${op}`)).json;
    assert.equal(owner.cancelled, undefined, `the self-test cancelled the owner's operation: ${owner.error}`);
    assert.equal(owner.status, 'running', JSON.stringify(owner));
  } finally { await release(op); }
});

test('cancelled during its first step, it still stops what it started: nothing is left running', { timeout: 600000 * SLOW }, async () => {
  const before = running('spark3');
  const r = await api('/actions/self_test', { method: 'POST', body: {} });
  assert.equal(r.status, 200, r.text);
  const c = await api(`/jobs/${r.json.operation}/cancel`, { method: 'POST', body: {} });
  assert.equal(c.status, 200, c.text);
  const j = await finished(r.json.operation);
  assert.equal(j.status, 'cancelled', JSON.stringify(j));
  // Its model did start (the step under way ends first), and its clean-up stopped it.
  assert.match(j.report[0], /^Model: worked in \d+ s\./, j.report.join('\n'));
  assert.match(j.report.at(-1), /^Left behind: nothing running\./, j.report.join('\n'));
  assert.deepEqual(running('spark3'), before);
});

test('a model on the list of what should be running on that Spark is never the test\'s: with every one there listed, it says so and changes nothing', async () => {
  // (every model with a copy on Spark 3 is on the list for Spark 3, down: as after the Spark was off, or a model held)
  const disk = (await call(keys.look.token, 'models_on_disk', {})).value.models.filter(m => m.onSparks.includes('spark3'));
  const listed = [...SEEDED_RUNNING.filter(x => x.spark !== 'spark3'), ...disk.map(m => ({ spark: 'spark3', container: `sc-${m.modelId}`, model: m.modelId, since: SINCE, by: 'owner' }))];
  const file = join(T.fleet.stateDir, 'desired.json'), saved = readFileSync(file, 'utf8');
  writeFileSync(file, JSON.stringify({ ...SEEDED, running: listed }), { mode: 0o600 });
  try {
    const before = desiredRunning(), ops = (await operations()).length;
    const r = await api('/actions/self_test', { method: 'POST', body: {} });
    assert.equal(r.status, 409, r.text);
    assert.match(r.json.error, /every small chat model on Spark 3 is on the list of what should be running there, and the self-test never touches those/);
    assert.deepEqual(desiredRunning(), before);
    assert.equal((await operations()).length, ops, 'nothing started');
  } finally { writeFileSync(file, saved, { mode: 0o600 }); }
});

test('an agent\'s call is the owner\'s question, and nothing starts', async () => {
  const before = (await operations()).length;
  const r = await call(keys.act.token, 'self_test', {});
  assert.equal(r.isError, false, r.text);
  assert.equal(r.value.outcome, 'question', r.text);
  assert.match(r.value.question, /^Run the self-test on a compute Spark that is free: .*stopping nothing\? Running the self-test is the owner’s call\.$/);
  assert.match(r.value.note, /^Only the owner can answer this one/);
  assert.ok(r.value.choices.every(c => c.choice === null), JSON.stringify(r.value.choices));
  // Naming the hub is refused outright.
  const hub = await call(keys.act.token, 'self_test', { spark: 'spark2' });
  assert.equal(hub.isError, true, hub.text);
  assert.match(hub.text, /Spark 2 is Sparkie’s \(the brain’s\), so no other workload starts there/);
  assert.equal((await operations()).length, before, 'nothing started');
});

test('with every compute Spark off, it says so, wakes nothing and starts nothing', { timeout: 120000 * SLOW }, async () => {
  const before = (await operations()).length;
  const offline = readFileSync(T.fleet.offlineFile, 'utf8');
  writeFileSync(T.fleet.offlineFile, 'spark1 spark3 spark4\n');
  try {
    await sleep(4000);   // (the stand-in's offline list is read again after 3 s)
    const r = await api('/actions/self_test', { method: 'POST', body: {} });
    assert.equal(r.status, 409, r.text);
    assert.equal(r.json.error, 'No compute Spark is on: Spark 1, Spark 3 and Spark 4 are off or not answering, so the self-test didn’t run and nothing was started. It wakes nothing: turn one on, then ask again.');
    assert.equal((await operations()).length, before, 'nothing started');
  } finally { writeFileSync(T.fleet.offlineFile, offline); }
});
