// The self-test's clean-up (21-selftest.mjs) on a fleet where nothing is validated yet, as after an install that changed
// the workflows: the self-test's runs are their validation runs, and its clean-up has to carry that pass too, or
// runAction refuses its stop and the test model is left running. (selftest.test.mjs covers the rest, with everything
// validated.) Spark 3 is made free as there, and it came back on ten minutes ago (so self-healing restarts nothing
// there for another twenty: the owner did what the self-test says when no compute Spark is on).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { T, useFleet, api, call, createKey, waitFor, sleep, SLOW } from './lib.mjs';

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
