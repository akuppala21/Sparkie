// Covers: T42's retry lifetime on the stand-in service: an expired private context choice cannot launch while its
// public button is still young, a console restart invalidates saved retry buttons, failed restoration withholds a
// shorter-context question, and a deadline crossed during image preparation prevents the actual model launch and
// restores earlier work. Uses the existing clock, image delay and failed-start fixtures; never reaches real Sparks.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, mkdtempSync, chmodSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { T, useFleet, api, choose, waitFor, sleep, eventLines, SERVICE_FILE, REPO, SLOW } from './lib.mjs';

const MODEL = 'RadixArk--Qwen3.8-27B-NVFP4', BOX = `sc-${MODEL}`;
// Shorten only the already-supported fix window. Its expiry remains well inside the separate 15-minute button life.
const WINDOW = Math.min(120000 * SLOW, 600000), OFFSET = WINDOW + 5000;
const BIN = join(REPO, 'test', 'mock', 'bin'), WRAP = mkdtempSync(join(tmpdir(), 'context-lifecycle-docker-'));
// The same named failed-start fixture as put-back-job.test.mjs. Ordinary runs and every other command are unchanged.
writeFileSync(join(WRAP, 'docker'), `#!/bin/bash
if [ "$1" = start ] && [ -s "$HOME/.mock/start-fails" ]; then
  for a in "$@"; do
    if [ "$a" = "$(cat "$HOME/.mock/start-fails")" ]; then echo 'Error response from daemon: failed to create task for container: a made-up failure' >&2; exit 1; fi
  done
fi
exec ${JSON.stringify(join(BIN, 'docker'))} "$@"
`);
chmodSync(join(WRAP, 'docker'), 0o755);
let second = null;
// Registered before useFleet's after: the replacement must exit before its state directory is removed.
after(async () => {
  if (second && second.exitCode === null && second.signalCode === null) {
    const gone = new Promise(resolve => second.once('exit', resolve));
    second.kill('SIGKILL');
    assert.equal(await Promise.race([gone.then(() => true), sleep(5000).then(() => false)]), true, 'the restarted context service exited after SIGKILL');
  }
});
useFleet({ watchMs: 60000, statusMs: 20000, env: {
  NODE_OPTIONS: `--import=${join(REPO, 'test', 'mock', 'clock.mjs')}`,
  SPARK_CONSOLE_FIX_WINDOW_MS: String(WINDOW), PATH: `${WRAP}:${BIN}:${process.env.PATH}`,
} });
after(() => rmSync(WRAP, { recursive: true, force: true }));
const mock = name => join(T.fleet.root, 'spark4', '.mock', name);
const stateOf = name => readFileSync(mock('containers'), 'utf8').split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];
const argsNow = () => readFileSync(mock('last-run-args'), 'utf8');
const jobs = async () => (await api('/jobs')).json.jobs;
const clock = async offset => { writeFileSync(join(T.fleet.dir, 'clock-offset'), String(offset)); await sleep(400); };
async function finished(id) {
  return waitFor(async () => {
    const got = await api(`/jobs/${id}`);
    assert.equal(got.status, 200, got.text);
    return got.json.status === 'running' ? null : got.json;
  }, { timeout: 240000, every: 250, what: `context operation ${id} to finish` });
}
async function pageStart() {
  const plan = await api(`/deploy/plan?model=${MODEL}&node=spark4`);
  assert.equal(plan.status, 200, plan.text);
  const stops = plan.json.steps.filter(s => s.kind === 'stop');
  const body = { model: MODEL, node: 'spark4', contextTokens: 131072,
    keep: stops.filter(s => !s.required).map(s => s.container),
    stop: stops.filter(s => s.required).map(s => `spark4/${s.container}`) };
  const r = await api('/deploy', { method: 'POST', body });
  assert.equal(r.status, 202, r.text);
  return { id: r.json.id, body };
}
function restored(body) {
  assert.ok(body.stop.length, 'the start must have earlier work to restore');
  for (const item of body.stop) assert.equal(stateOf(item.slice('spark4/'.length)), 'running', `${item} restored`);
}
async function offered(id) {
  const failed = await finished(id);
  assert.equal(failed.status, 'failed', JSON.stringify(failed));
  assert.match(failed.error, /131,072|131072/);
  const ready = await waitFor(async () => {
    const job = (await api(`/jobs/${id}`)).json;
    return job.contextQuestion ? job : null;
  }, { what: `the released context question for ${id}` });
  const chat = await api(`/chats/${ready.contextQuestion.chat}`);
  assert.equal(chat.status, 200, chat.text);
  const yes = chat.json.messages.flatMap(m => m.choices || []).find(c => c.group === ready.contextQuestion.choice && c.state === 'open' && /Try again with 32,768 tokens/.test(c.label));
  assert.ok(yes, chat.text);
  return { chat: chat.json.id, yes, job: ready };
}

// T42 (part): the private attempt deadline expires before the otherwise-valid public button does.
test('an expired context decision refuses the still-young owner button without creating a retry', { timeout: 360000 * SLOW }, async t => {
  writeFileSync(mock('oom-ctx'), '32768');
  t.after(async () => { rmSync(mock('oom-ctx'), { force: true }); await clock(0); });
  const first = await pageStart(), q = await offered(first.id);
  restored(first.body);
  const before = (await jobs()).map(j => j.id), args = argsNow(), containers = readFileSync(mock('containers'), 'utf8');
  await clock(OFFSET);
  const pressed = await choose(q.chat, q.yes.id);
  assert.equal(pressed.status, 200, pressed.text);
  assert.equal(pressed.json.outcome, 'error', pressed.text);
  assert.match(pressed.json.message.content, /context choice has expired/i, 'the private deadline refuses this; not the generic button timeout');
  assert.ok(!pressed.json.operation, pressed.text);
  assert.deepEqual((await jobs()).map(j => j.id), before);
  assert.equal(argsNow(), args, 'no new docker run');
  assert.equal(readFileSync(mock('containers'), 'utf8'), containers);
});

// T42 (part): the final launch check follows actual preparation, not just acceptance of the start.
test('a context deadline crossed during image preparation prevents launch and restores the previous work', { timeout: 360000 * SLOW }, async t => {
  const imageFile = mock('images'), images = readFileSync(imageFile, 'utf8'), args = argsNow();
  writeFileSync(imageFile, '');
  // mock/bin/docker's existing slow-<command> fixture delays the pull before it can finish preparation.
  writeFileSync(mock('slow-pull'), String(10 * SLOW));
  t.after(async () => {
    rmSync(mock('slow-pull'), { force: true });
    writeFileSync(imageFile, images);
    await clock(0);
  });
  const first = await pageStart();
  await waitFor(async () => {
    const job = (await api(`/jobs/${first.id}`)).json;
    assert.equal(job.status, 'running', JSON.stringify(job));
    return /^Downloading the .+ image$/.test(job.step);
  }, { timeout: 120000, every: 100, what: 'the real image preparation step before the model run' });
  await clock(OFFSET);
  const failed = await finished(first.id);
  assert.equal(failed.status, 'failed', JSON.stringify(failed));
  assert.match(failed.error, /30 minutes.*ended/i);
  assert.equal(argsNow(), args, 'the model was never run after the preparation crossed its deadline');
  assert.equal(failed.contextQuestion, undefined, 'an expired start offers no shorter-context retry');
  assert.ok(!failed.ranHere?.length);
  restored(first.body);
  assert.ok(readFileSync(imageFile, 'utf8').trim(), 'the delayed image pull really completed before the refusal');
  assert.equal((await jobs()).filter(j => j.retryOf === first.id).length, 0);
});

// T42 (part): an OOM proposal never becomes an enabled question while restoration still owes work.
test('a failed restoration withholds the shorter-context question and reports what remains stopped', { timeout: 360000 * SLOW }, async t => {
  writeFileSync(mock('oom-ctx'), '32768');
  writeFileSync(mock('start-fails'), BOX);
  t.after(async () => {
    rmSync(mock('start-fails'), { force: true });
    rmSync(mock('oom-ctx'), { force: true });
    // Leave the fixture's model running through the page after removing the failure fixture.
    if (stateOf(BOX) !== 'running') {
      const restored = await pageStart();
      assert.equal((await finished(restored.id)).status, 'completed');
    }
  });
  const before = new Set((await jobs()).map(j => j.id)), first = await pageStart(), failed = await finished(first.id);
  assert.equal(failed.status, 'failed', JSON.stringify(failed));
  assert.match(failed.error, /131,072|131072/);
  assert.match(failed.cleanUp, /couldn’t be started again.*Spark 4/i);
  assert.ok(failed.notBack?.some(n => n.items.includes(`spark4/${BOX}`)), JSON.stringify(failed));
  assert.notEqual(stateOf(BOX), 'running');
  assert.equal(failed.contextQuestion, undefined);
  assert.ok(!(failed.choices || []).some(c => /Try again with/.test(c.label)));
  assert.equal((await jobs()).filter(j => !before.has(j.id) && ['deploy', 'deploy-cluster'].includes(j.type)).length, 1, 'no automatic retry while cleanup is owed');
});

// T42 (part): only visible conversation data survives a restart; it never restores private retry authority.
// Last: restart the same service on the same fixture, as selftest-cleanup.test.mjs does.
test('a saved context button cannot restart its failed model after the console restarts', { timeout: 360000 * SLOW }, async t => {
  writeFileSync(mock('oom-ctx'), '32768');
  t.after(() => rmSync(mock('oom-ctx'), { force: true }));
  const first = await pageStart(), q = await offered(first.id);
  restored(first.body);
  const args = argsNow(), containers = readFileSync(mock('containers'), 'utf8');
  const events = eventLines().length;
  process.kill(T.fleet.servicePid(), 'SIGKILL');
  await waitFor(() => T.fleet.serviceExit(), { timeout: 10000, what: 'the original context service to exit' });
  second = spawn(process.execPath, [SERVICE_FILE], { cwd: REPO, env: T.fleet.env, stdio: 'ignore' });
  await waitFor(async () => (await api('/health').catch(() => null))?.status === 200,
    { timeout: 30000, what: 'the context service restarted on its original state' });
  const pressed = await choose(q.chat, q.yes.id);
  assert.equal(pressed.status, 409, pressed.text);
  assert.match(pressed.json.error, /button has expired/i);
  const chat = await api(`/chats/${q.chat}`);
  assert.equal(chat.status, 200, chat.text);
  assert.equal(chat.json.messages.flatMap(m => m.choices || []).find(c => c.id === q.yes.id)?.state, 'gone');
  assert.equal(argsNow(), args);
  assert.equal(readFileSync(mock('containers'), 'utf8'), containers);
  assert.equal(eventLines().slice(events).filter(e => e.type === 'operation' && e.status === 'started' && ['deploy', 'deploy-cluster'].includes(e.operation)).length, 0);
  assert.ok(!(await jobs()).some(j => j.retryOf === first.id));
});
