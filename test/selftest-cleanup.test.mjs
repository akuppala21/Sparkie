// Covers: The self-test's clean-up on a fleet where nothing is validated yet (as after an install that changed the
// workflows), on a Spark 3 turned on ten minutes ago: cancelled during its first step while `stop_model` waits for its
// validation run, the clean-up still stops the model; the drill isn't run there ("not tried", saying when to ask
// again), nothing is killed and the run passes; after a restart of Spark Console in the middle, at start-up it stops
// exactly what the test had started (`self-test.json`), says so once in the chat that asked, and tells no one to start
// it again.
//
// The self-test's clean-up (21-selftest.mjs) on a fleet where nothing is validated yet, as after an install that changed
// the workflows: the self-test's runs are their validation runs, and its clean-up has to carry that pass too, or
// runAction refuses its stop and the test model is left running. (selftest.test.mjs covers the rest, with everything
// validated.) Spark 3 is made free as there, and it came back on ten minutes ago (so self-healing restarts nothing
// there for another twenty: the owner did what the self-test says when no compute Spark is on).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { T, useFleet, api, call, createKey, waitFor, sleep, newChat, say, chatMessages, eventLines, SERVICE_FILE, REPO, SLOW } from './lib.mjs';

let second = null;   // the service started again by the last test, on the same state
after(() => { try { second?.kill('SIGKILL'); } catch {} });
const page = await new Promise(res => { const s = http.createServer((req, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end('<p>self-test</p>'); }); s.listen(0, '127.0.0.1', () => res(s)); });
after(() => page.close());
const keys = {};
useFleet({ watchMs: 2000, statusMs: 3000,
  env: { SPARK_CONSOLE_SELFTEST_PORT: String(page.address().port), SPARK_CONSOLE_JOB_WAIT_MS: '500', SPARK_CONSOLE_APP_ANSWER_MS: '20000', SPARK_CONSOLE_SELFTEST_HEAL_MS: '60000',
    SPARK_CONSOLE_ASSUME_VALIDATED: '0', SPARK_CONSOLE_DIG_FIXTURE: join(dirname(fileURLToPath(import.meta.url)), 'mock', 'dig-fixture.json') },
  prepare: ({ root, stateDir }) => {
    const at = ms => new Date(Date.now() - ms).toISOString();
    writeFileSync(join(stateDir, 'events.jsonl'), [{ at: at(8 * 3600000), type: 'spark-offline', spark: 'spark3' }, { at: at(10 * 60000), type: 'spark-online', spark: 'spark3', upSeconds: 45 }]
      .map(e => JSON.stringify(e)).join('\n') + '\n', { mode: 0o600 });
    const list = join(root, 'spark3', '.mock', 'containers');
    writeFileSync(list, readFileSync(list, 'utf8').replace(/^(sc-testorg--Qwen3\.8-27B-abliterated-GGUF)\|running\|[^|]*\|/m, '$1|exited|Exited (0) 2 hours ago|'));
    for (const f of ['jobs-run', 'stamp-starts', 'ids-per-run']) writeFileSync(join(root, 'spark3', '.mock', f), '');
  } }, async () => {
  keys.look = await createKey('selftest-cleanup');
  await waitFor(async () => (await call(keys.look.token, 'workloads', { spark: 'spark3' })).value?.count > 0, { timeout: 60000, what: 'the watcher\'s first look' });
});
const running = spark => readFileSync(join(T.fleet.root, spark, '.mock', 'containers'), 'utf8').split('\n').filter(l => l.split('|')[1] === 'running').map(l => l.split('|')[0]).sort();
const workflows = async () => Object.fromEntries((await api('/workflows')).json.workflows.map(w => [w.id, w.state]));
async function finished(id, timeout = 300000) {
  for (const until = Date.now() + timeout * SLOW; ;) {
    const j = (await api(`/jobs/${id}`)).json;
    if (j.status !== 'running') return j;
    assert.ok(Date.now() < until, `operation ${id} still running: ${j.step}`);
    await sleep(1000);
  }
}

test('cancelled during its first step while stop_model waits for its validation run, its clean-up still stops the model', { timeout: 600000 * SLOW }, async () => {
  assert.equal((await workflows()).stop_model, 'needs-validation');
  const before = running('spark3');
  const r = await api('/actions/self_test', { method: 'POST', body: {} });
  assert.equal(r.status, 200, r.text);
  // (cancelled once its first step is under way, as its log says, like the same test in selftest.test.mjs: under load
  // a cancel can land before it starts its model, and then it ends with nothing started and no Model line)
  await waitFor(async () => (await api(`/jobs/${r.json.operation}`)).json.log.some(l => l.endsWith(`Starting ${r.json.model} on Spark 3, stopping nothing`)), { what: 'the self-test\'s first step' });
  const c = await api(`/jobs/${r.json.operation}/cancel`, { method: 'POST', body: {} });
  assert.equal(c.status, 200, c.text);
  const j = await finished(r.json.operation);
  assert.equal(j.status, 'cancelled', JSON.stringify(j));
  assert.match(j.report[0], /^Model: worked in \d+ s\./, j.report.join('\n'));
  assert.ok(!j.log.some(l => /Couldn’t stop/.test(l)), j.log.join('\n'));
  assert.match(j.report.at(-1), /^Left behind: nothing running\./, j.report.join('\n'));
  assert.deepEqual(running('spark3'), before);
  // (that stop was a real one, so it is stop_model's validation run)
  assert.equal((await workflows()).stop_model, 'active');
});

test('on a Spark turned on ten minutes ago the drill isn\'t run: healing is "not tried", saying when to ask again, nothing is killed, and the run passes', { timeout: 600000 * SLOW }, async () => {
  const r = await api('/actions/self_test', { method: 'POST', body: {} });
  assert.equal(r.status, 200, r.text);
  const j = await finished(r.json.operation);
  assert.equal(j.status, 'completed', `${j.error}\n${(j.report || []).join('\n')}`);
  assert.match(j.report[1], /^Healing: not tried\. Spark 3 went off or came on in the last half hour, and self-healing restarts nothing there for half an hour after that, so the drill didn’t run\. Ask again in about \d+ minutes?\.$/, j.report[1]);
  for (const i of [0, 2, 3, 4, 5]) assert.match(j.report[i], /: worked in \d+ s\. /, j.report[i]);
  assert.ok(!existsSync(join(T.fleet.root, 'spark3', '.mock', 'killed')), 'nothing killed');
});

test('a restart of Spark Console in the middle: at start-up it stops exactly what the test had started, says so once in the chat that asked, and tells no one to start it again', { timeout: 600000 * SLOW }, async () => {
  const before = running('spark3'), mock = f => join(T.fleet.root, 'spark3', '.mock', f), noteFile = join(T.fleet.stateDir, 'self-test.json');
  // Its model loads and loads (a big one would take minutes).
  writeFileSync(mock('serve-down'), '');
  writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify([{ match: 'run the self-test', calls: [{ name: 'self_test', arguments: {} }] }]));
  let chat;
  try { chat = await newChat(); const r = await say(chat, 'run the self-test'); assert.match(r.text, /"outcome":"started"/, r.text); }
  finally { rmSync(join(T.fleet.dir, 'model-script.json'), { force: true }); }
  // What it started is noted as it starts: the model's container id while it is still loading.
  const note = await waitFor(() => { try { const x = JSON.parse(readFileSync(noteFile, 'utf8')); return x.model?.id ? x : null; } catch { return null; } }, { timeout: 120000, what: 'the model\'s id in self-test.json' });
  const model = note.model.container;
  assert.equal(readFileSync(mock(`id-${model}`), 'utf8').trim(), note.model.id);
  assert.ok(running('spark3').includes(model), running('spark3').join(', '));
  const since = new Date().toISOString();
  // Spark Console ends at once (a crash: no clean-up runs), and comes back on the same state, as systemd starts it.
  process.kill(T.fleet.servicePid(), 'SIGKILL');
  await waitFor(() => T.fleet.serviceExit(), { timeout: 10000, what: 'the service to end' });
  rmSync(mock('serve-down'), { force: true });
  assert.ok(running('spark3').includes(model), 'still running while Spark Console is down');
  second = spawn(process.execPath, [SERVICE_FILE], { cwd: REPO, env: T.fleet.env, stdio: 'ignore' });
  await waitFor(async () => (await api('/health').catch(() => null))?.status === 200, { timeout: 30000, what: 'the service back' });
  // At start-up: exactly that container stopped, the note cleared, one line in the chat that asked.
  await waitFor(() => !running('spark3').includes(model), { timeout: 120000, what: `${model} stopped` });
  assert.deepEqual(running('spark3'), before);
  await waitFor(() => !existsSync(noteFile), { timeout: 30000, what: 'the note cleared' });
  const lines = async () => (await chatMessages(chat)).filter(m => m.notice && /^Spark Console restarted while the self-test ran/.test(m.content));
  await waitFor(async () => (await lines()).length > 0, { timeout: 30000, every: 500, what: 'the line in the chat' });
  const said = await lines();
  assert.equal(said.length, 1, JSON.stringify(said));
  assert.equal(said[0].content, `Spark Console restarted while the self-test ran on Spark 3. It stopped what the test had started there: ${model}. Nothing else was touched. Ask again to run the self-test.`);
  // No notice tells the owner to start the cut-off operations again.
  await sleep(2000);
  const told = eventLines().filter(e => e.at >= since && e.type === 'notice');
  assert.ok(!told.some(e => /cut off/.test(e.text)), JSON.stringify(told));
  assert.equal(told.filter(e => /^Spark Console restarted while the self-test ran/.test(e.text)).length, 1, JSON.stringify(told));
});

test('fenced recovery records only a matching self-test model stop and preserves the rest of its note', () => {
  const source = readFileSync(join(REPO, 'service/src/21-selftest.mjs'), 'utf8');
  const body = /^function selfTestRollbackStopped\(spark, seen\) \{[\s\S]*?^\}/m.exec(source)?.[0];
  assert.ok(body);
  let saved = { operation: 'test-operation', spark: 'spark3', model: { id: 'a'.repeat(64), container: 'sc-test' }, chat: 'kept-chat' }, writes = 0;
  const fn = new Function('SELF_TEST_FILE', 'selfTestRecord', 'writePrivate', `${body}\nreturn selfTestRollbackStopped;`)('self-test.json', () => structuredClone(saved), (file, value) => { assert.equal(file, 'self-test.json'); writes++; saved = value; });
  for (const [spark, id, name] of [['spark4', 'a'.repeat(64), 'sc-test'], ['spark3', 'b'.repeat(64), 'sc-test'], ['spark3', 'a'.repeat(64), 'sc-other']]) fn(spark, { id, name });
  assert.equal(writes, 0);
  fn('spark3', { id: 'a'.repeat(64), name: 'sc-test' });
  assert.equal(writes, 1); assert.equal(saved.chat, 'kept-chat'); assert.equal(saved.operation, 'test-operation');
  assert.deepEqual(saved.rollbackStoppedModel, { id: 'a'.repeat(64), container: 'sc-test' });
});

test('an unrelated unreadable self-test note cannot block fenced model restoration', () => {
  const source = readFileSync(join(REPO, 'service/src/21-selftest.mjs'), 'utf8');
  const body = /^function selfTestRollbackStopped\(spark, seen\) \{[\s\S]*?^\}/m.exec(source)?.[0]; assert.ok(body);
  let writes = 0, warnings = 0;
  const fn = new Function('SELF_TEST_FILE', 'selfTestRecord', 'writePrivate', 'console', `${body}\nreturn selfTestRollbackStopped;`)(
    'self-test.json', () => { throw new Error('unreadable unrelated note'); }, () => { writes++; }, { error: () => { warnings++; } });
  assert.doesNotThrow(() => fn('spark3', { id: 'a'.repeat(64), name: 'sc-other' }));
  assert.equal(writes, 0); assert.equal(warnings, 1);
});
