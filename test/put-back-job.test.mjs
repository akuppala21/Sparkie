// Covers: A model start that stopped a GPU job with the owner's yes and then failed puts the job back only through the
// job folder check (R38, `putBack`): with the job's folder swapped for a link meanwhile, the job isn't started again
// and the operation's log says why, by name; with its folder a real one again, the same failed start puts it back
// running.
//
// The owner's yes is the page's Deploy with the job on its stop list (POST /deploy). The start fails the known way
// "gated" (a Hugging Face refusal in the model's log). On the stand-in fleet a job runs until it is stopped (Spark 4
// has no ~/.mock/jobs-run); a stop takes ~/.mock/up-<name> away and only a start writes it, so a job not started again
// has none.
//
// A-23: the put-back looks at each stop. The same start, of Spark 4's own model (it runs, then fails its test prompt):
// with Docker there answering nothing before the put-back, or with the stop of the new model never coming back, the GPU
// job isn't started beside a model that may still be running; the error (after its first line) and the log say so, and
// the operation's two lists keep both. Cancelled from the owner's chat while loading, with its stop refused, neither the
// operation, the cancel's answer nor the chat line says it was put back. A `docker run` that made the container but
// never came back is stopped by the put-back too, and the job then runs again. A start that never becomes ready (the
// limit set short here, SPARK_CONSOLE_READY_MS) says the start gave up on it, never that it may still be loading, and is
// stopped; that limit moves only on the stand-in fleet, and on any other console the variable is ignored (pure, from the
// limit's own line). A stand-in docker in front of the fleet's (PATH) holds a stop or a run of the one container a test
// names.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, renameSync, symlinkSync, existsSync, mkdtempSync, chmodSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { T, useFleet, resetFleet, api, waitFor, newChat, say, chatMessages, auditLines, SLOW, REPO } from './lib.mjs';

// A stop of the container named in ~/.mock/stop-hangs never comes back (putBack gives a stop 90 s), and of the one in
// ~/.mock/stop-hangs-once only the first time; one named in ~/.mock/stop-fails is refused at once and keeps running; a
// start of the one in ~/.mock/start-fails is refused; a run of the one named in ~/.mock/run-hangs makes it, then
// doesn't come back (run gives it 120 s). Anything else goes to the stand-in docker as it is.
const BIN = join(dirname(fileURLToPath(import.meta.url)), 'mock', 'bin');
const WRAP = mkdtempSync(join(tmpdir(), 'put-back-docker-'));
writeFileSync(join(WRAP, 'docker'), `#!/bin/bash
real=${JSON.stringify(join(BIN, 'docker'))}
named() { [ -s "$HOME/.mock/$1" ] || return 1; local n a; n=$(cat "$HOME/.mock/$1"); shift; for a in "$@"; do [ "$a" = "$n" ] && return 0; done; return 1; }
if [ "$1" = stop ] && named stop-hangs-once "$@"; then rm -f "$HOME/.mock/stop-hangs-once"; exec >/dev/null 2>&1 </dev/null; sleep 150; exit 1; fi
if [ "$1" = stop ] && named stop-hangs "$@"; then exec >/dev/null 2>&1 </dev/null; sleep 150; exit 1; fi
if [ "$1" = start ] && named start-fails "$@"; then echo "Error response from daemon: failed to create task for container: a made-up failure" >&2; exit 1; fi
if [ "$1" = stop ] && named stop-fails "$@"; then echo "Error response from daemon: cannot stop container: $(cat "$HOME/.mock/stop-fails"): tried to kill container, but did not receive an exit event" >&2; exit 1; fi
if [ "$1" = run ] && named run-hangs "$@"; then "$real" "$@"; exec >/dev/null 2>&1 </dev/null; sleep 150; exit 1; fi
exec "$real" "$@"
`);
chmodSync(join(WRAP, 'docker'), 0o755);

const JOB = 'gpu-hold', MODEL = 'gemma-3-12b-it';
const FLEET_OPTIONS = { env: { PATH: `${WRAP}:${BIN}:${process.env.PATH}`, SPARK_CONSOLE_READY_MS: String(30000 * SLOW) },
  prepare: ({ root }) => {
    // (Spark 4 with nothing running: no hand-started benchmark, none of Spark Console's models; a GPU job starts only
    // where no model runs)
    const f = join(root, 'spark4', '.mock', 'containers');
    writeFileSync(f, readFileSync(f, 'utf8').split('\n').filter(l => l && !l.startsWith('qwen-recipe-aphex3k|'))
      .map(l => (/^sc-[^|]*\|running\|/.test(l) ? l.replace(/\|running\|[^|]*\|/, '|exited|Exited (0) just now|') : l)).join('\n') + '\n');
  },
};
useFleet(FLEET_OPTIONS);
beforeEach(async t => {
  if (t.name.startsWith('its folder swapped for a link') || t.name.startsWith('the limit moves only')) return;
  // Every independent fault case owns a fresh world. Its predecessor's unanswered commands remain unproved
  // until that whole fake fleet is stopped; no recovery state is edited or skipped in a surviving service.
  await resetFleet(FLEET_OPTIONS);
  const made = await api('/actions/keep_running', { method: 'POST', body: { spark: 'spark4', container: JOB,
    image: 'nvcr.io/nvidia/pytorch:25.10-py3', command: ['sleep', 'infinity'], once: true, gpu: true, memoryGB: 8 } });
  assert.equal(made.json?.outcome, 'started', made.text);
  assert.equal((await opEnd(made.json.operation)).status, 'completed');
}, { timeout: 180000 * SLOW });

const mock = (spark, file) => join(T.fleet.root, spark, '.mock', file);
const stateOf = (spark, name) => readFileSync(mock(spark, 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];
const started = () => existsSync(mock('spark4', `up-${JOB}`));
const opEnd = id => waitFor(async () => { const o = (await api(`/jobs/${id}`)).json; return o?.status && o.status !== 'running' ? o : null; }, { timeout: 240000, what: `operation ${id} to end`, every: 500 });
// The page's Deploy of the model on Spark 4, the owner having said yes to stopping what its plan stops (the GPU job too).
async function deployStoppingTheJob() {
  const p = (await api(`/deploy/plan?model=${MODEL}&node=spark4`)).json;
  const stops = (p.steps || []).filter(s => s.kind === 'stop');
  assert.ok(stops.some(s => s.container === JOB && s.hold), JSON.stringify(p.steps));
  const r = await api('/deploy', { method: 'POST', body: { model: MODEL, node: 'spark4', keep: [], stop: stops.map(s => `spark4/${s.container}`) } });
  assert.equal(r.status, 202, r.text);
  const w = await opEnd(r.json.id);
  assert.equal(w.status, 'failed', JSON.stringify(w));
  assert.match(w.error, /^It didn’t start: /, JSON.stringify(w));
  return w;
}

describe('a failed start puts back a job it stopped only through the job folder check (R38)', { concurrency: 1 }, () => {
  test('its folder swapped for a link: the job isn’t started again, and the operation says why; its folder real again: it is put back running', { timeout: 420000 * SLOW }, async () => {
    const home = join(T.fleet.root, 'spark4'), jobs = join(home, '.local/share/spark-portal/workspaces/shared/jobs');
    const made = await api('/actions/keep_running', { method: 'POST', body: { spark: 'spark4', container: JOB, image: 'nvcr.io/nvidia/pytorch:25.10-py3', command: ['sleep', 'infinity'], once: true, gpu: true, memoryGB: 8 } });
    assert.equal(made.json?.outcome, 'started', made.text);
    assert.equal((await opEnd(made.json.operation)).status, 'completed');
    assert.equal(stateOf('spark4', JOB), 'running');
    writeFileSync(mock('spark4', `logs-sc-${MODEL}`), 'INFO loading weights\nhuggingface_hub.errors.GatedRepoError: 401 Client Error: Cannot access gated repo\n');
    try {
      // (a walled change may do this while the start runs: the job's folder moved aside and a link to the home put there)
      renameSync(join(jobs, JOB), join(jobs, `${JOB}-aside`));
      symlinkSync(home, join(jobs, JOB));
      const w = await deployStoppingTheJob();
      assert.equal(stateOf('spark4', JOB), 'exited', 'not started again');
      assert.ok(!started(), 'no docker start');
      assert.ok(w.log.some(l => /The job’s folder jobs\/gpu-hold in the shared folder on Spark 4 isn’t a real folder: it is a link, or inside one\. Docker would follow it, so gpu-hold wasn’t started\./.test(l)), w.log.join('\n'));
      assert.ok(!w.log.some(l => /Started gpu-hold on spark4 again/.test(l)), w.log.join('\n'));
      // Its folder real again, the job run again: the same failed start puts it back, running.
      rmSync(join(jobs, JOB), { force: true });
      renameSync(join(jobs, `${JOB}-aside`), join(jobs, JOB));
      const rerun = await api('/actions/keep_running', { method: 'POST', body: { spark: 'spark4', container: JOB } });
      assert.equal(rerun.json?.outcome, 'started', rerun.text);
      assert.equal((await opEnd(rerun.json.operation)).status, 'completed');
      assert.equal(stateOf('spark4', JOB), 'running');
      const again = await deployStoppingTheJob();
      assert.equal(stateOf('spark4', JOB), 'running', 'started again');
      assert.ok(started(), 'docker start ran');
      assert.ok(again.log.some(l => /Started gpu-hold on spark4 again/.test(l)), again.log.join('\n'));
    } finally {
      if (existsSync(join(jobs, `${JOB}-aside`))) { rmSync(join(jobs, JOB), { force: true }); renameSync(join(jobs, `${JOB}-aside`), join(jobs, JOB)); }
      rmSync(mock('spark4', `logs-sc-${MODEL}`), { force: true });
      await api('/actions/keep_running', { method: 'POST', body: { spark: 'spark4', container: JOB, do: 'stop' } }).catch(() => {});
    }
  });
});

// A-23. Spark 4's own model, from the page's Deploy with the GPU job on its stop list; serve-silent makes it fail its
// test prompt once it runs, so the put-back runs while its container is running.
const RADIX = 'RadixArk--Qwen3.8-27B-NVFP4', SC = `sc-${RADIX}`;
const OWED = `gpu-hold wasn’t started again on Spark 4: ${SC} may still be running there (Spark Console couldn’t confirm it stopped). Stop it there, then start gpu-hold again`;
const opLong = id => waitFor(async () => { const o = (await api(`/jobs/${id}`)).json; return o?.status && o.status !== 'running' ? o : null; }, { timeout: 420000 * SLOW, what: `operation ${id} to end`, every: 500 });
const silent = on => (on ? writeFileSync(join(T.fleet.dir, 'serve-silent'), '') : rmSync(join(T.fleet.dir, 'serve-silent'), { force: true }));
async function deployRadix() {
  const p = (await api(`/deploy/plan?model=${RADIX}&node=spark4`)).json;
  const stops = (p.steps || []).filter(s => s.kind === 'stop');
  const r = await api('/deploy', { method: 'POST', body: { model: RADIX, node: 'spark4', keep: [], stop: stops.map(s => `spark4/${s.container}`) } });
  assert.equal(r.status, 202, r.text);
  return { id: r.json.id, stops: stops.map(s => s.container) };
}
// (nothing changing on Spark 4 any more: the test before may have left a stop or a start to end)
const idle4 = () => waitFor(async () => !((await api('/jobs')).json.jobs || []).some(j => j.status === 'running' && [j.node, ...(j.nodes || [])].includes('spark4')),
  { timeout: 300000 * SLOW, what: 'nothing changing on Spark 4', every: 500 });
async function jobRunning() {
  await idle4();
  if (stateOf('spark4', JOB) === 'running') return;
  const r = await api('/actions/keep_running', { method: 'POST', body: { spark: 'spark4', container: JOB } });
  assert.equal(r.json?.outcome, 'started', r.text);
  assert.equal((await opEnd(r.json.operation)).status, 'completed');
  assert.equal(stateOf('spark4', JOB), 'running');
}
async function modelStopped() {
  for (const f of ['daemon-down', 'stop-hangs', 'stop-hangs-once', 'stop-fails', 'start-fails', 'run-hangs', 'serve-down']) rmSync(mock('spark4', f), { force: true });
  await idle4();
  if (stateOf('spark4', SC) !== 'running') return;
  const s = await api('/stop', { method: 'POST', body: { node: 'spark4', container: SC } });
  if (s.json?.id) await opEnd(s.json.id);
  assert.notEqual(stateOf('spark4', SC), 'running');
}

describe('a failed start puts back only beside what is known to have stopped (A-23)', { concurrency: 1 }, () => {
  test('Docker on Spark 4 answers nothing before the put-back: the job isn’t started beside the model, the error and log say so, and both stay on the lists', { timeout: 420000 * SLOW }, async () => {
    await jobRunning();
    silent(true);
    try {
      const { id, stops } = await deployRadix();
      assert.deepEqual(stops, [JOB]);
      // (the new model runs and the job is stopped: from here Docker on Spark 4 answers nothing)
      await waitFor(async () => { if (stateOf('spark4', SC) === 'running' && stateOf('spark4', JOB) === 'exited') return true; const o = (await api(`/jobs/${id}`)).json; assert.equal(o.status, 'running', JSON.stringify(o)); return false; },
        { timeout: 120000 * SLOW, what: 'the new model running, the job stopped', every: 100 });
      // Docker must answer the launch receipt before this scenario makes it unresponsive during put-back.
      // A running container alone can precede that receipt; cutting Docker there tests an unfinished launch instead.
      await waitFor(async () => {
        const o = (await api(`/jobs/${id}`)).json;
        assert.equal(o.status, 'running', JSON.stringify(o));
        return o.step === 'Checking it answers a test prompt';
      }, { timeout: 120000 * SLOW, what: 'the launched model reaching its test prompt', every: 100 });
      writeFileSync(mock('spark4', 'daemon-down'), '');
      const w = await opLong(id);
      assert.equal(w.status, 'failed', JSON.stringify(w));
      assert.match(w.error, /^It didn’t start: it loaded but didn’t answer a test prompt\./, w.error);
      assert.equal(w.error.split('\n')[1], `${OWED}.`, w.error);
      assert.ok(w.log.some(l => l.endsWith(OWED)), w.log.join('\n'));
      assert.ok(!w.log.some(l => /Started gpu-hold on spark4 again|Couldn’t start gpu-hold/.test(l)), w.log.join('\n'));
      assert.deepEqual([w.ranHere, w.stoppedHere], [[`spark4/${SC}`], [`spark4/${JOB}`]]);
      assert.deepEqual([stateOf('spark4', SC), stateOf('spark4', JOB)], ['running', 'exited']);
    } finally { silent(false); await modelStopped(); }
  });

  test('only the stop of the new model doesn’t come back: the job isn’t started beside it, and it is said', { timeout: 600000 * SLOW }, async () => {
    await jobRunning();
    silent(true);
    writeFileSync(mock('spark4', 'stop-hangs'), SC);
    try {
      const { id } = await deployRadix();
      const w = await opLong(id);
      assert.equal(w.status, 'failed', JSON.stringify(w));
      assert.match(w.error, /^It didn’t start: it loaded but didn’t answer a test prompt\./, w.error);
      assert.equal(w.error.split('\n')[1], `${OWED}.`, w.error);
      assert.ok(!w.log.some(l => /Started gpu-hold on spark4 again/.test(l)), w.log.join('\n'));
      assert.deepEqual([w.ranHere, w.stoppedHere], [[`spark4/${SC}`], [`spark4/${JOB}`]]);
      assert.deepEqual([stateOf('spark4', SC), stateOf('spark4', JOB)], ['running', 'exited']);
    } finally { silent(false); await modelStopped(); }
  });

  test('cancelled from the owner’s chat while loading, its stop refused: neither the operation, the cancel’s answer nor the chat line says it was put back', { timeout: 420000 * SLOW }, async () => {
    // (nothing runs on Spark 4, so the start stops nothing)
    await idle4();
    if (stateOf('spark4', JOB) === 'running') {
      await api('/actions/keep_running', { method: 'POST', body: { spark: 'spark4', container: JOB, do: 'stop' } });
      await idle4();
    }
    assert.notEqual(stateOf('spark4', JOB), 'running');
    const words = `start ${RADIX} on spark 4`;
    writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify([{ match: `^${words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, calls: [{ name: 'start_model', arguments: { model: RADIX, spark: 'spark4' } }] }]));
    writeFileSync(mock('spark4', 'serve-down'), '');
    writeFileSync(mock('spark4', 'stop-fails'), SC);
    const said = `${SC} may still be running on Spark 4: Spark Console couldn’t confirm it stopped. Stop it there before starting anything there again.`;
    try {
      const chat = await newChat();
      await say(chat, words);
      const line = auditLines().findLast(l => l.action === 'start_model' && l.chat === chat);
      assert.equal(line?.outcome, 'started', JSON.stringify(line));
      await waitFor(() => stateOf('spark4', SC) === 'running', { timeout: 120000 * SLOW, what: 'the new model loading' });
      const c = await api(`/jobs/${line.operation}/cancel`, { method: 'POST', body: {} });
      assert.equal(c.status, 200, c.text);
      assert.equal(c.json.outcome, 'cancelled', c.text);
      assert.equal(c.json.note, said);
      const w = await opLong(line.operation);
      assert.equal(w.status, 'cancelled', JSON.stringify(w));
      assert.equal(w.error, `Cancelled by owner. ${said}`);
      const posted = await waitFor(async () => (await chatMessages(chat)).find(m => m.notice && m.operation === line.operation), { timeout: 60000, what: 'the start’s line in the chat' });
      assert.match(posted.content, new RegExp(`was cancelled\\. ${SC.replace(/\./g, '\\.')} may still be running on Spark 4`), posted.content);
      for (const text of [c.json.note, w.error, posted.content]) assert.doesNotMatch(text, /put back/);
      assert.equal(stateOf('spark4', SC), 'running', 'its stop was refused');
    } finally { rmSync(join(T.fleet.dir, 'model-script.json'), { force: true }); await modelStopped(); }
  });

  test('a docker run that made the container but never came back: the put-back stops it, then the job runs again', { timeout: 600000 * SLOW }, async () => {
    await jobRunning();
    writeFileSync(mock('spark4', 'run-hangs'), SC);
    try {
      const { id } = await deployRadix();
      const w = await opLong(id);
      assert.equal(w.status, 'failed', JSON.stringify(w));
      assert.match(w.error, /^Docker couldn’t start it: \(timed out\)/, w.error);
      assert.ok(w.log.some(l => /Started gpu-hold on spark4 again$/.test(l)), w.log.join('\n'));
      assert.deepEqual([stateOf('spark4', SC), stateOf('spark4', JOB)], ['exited', 'running']);
    } finally { await modelStopped(); }
  });

  test('a start that never becomes ready: it says the start gave up on it (never that it may still be loading), and it is stopped', { timeout: 420000 * SLOW }, async () => {
    await jobRunning();
    writeFileSync(mock('spark4', 'serve-down'), '');
    try {
      const { id } = await deployRadix();
      const w = await opLong(id);
      assert.equal(w.status, 'failed', JSON.stringify(w));
      assert.match(w.error, /^The model didn’t become ready within \d+ (?:seconds|minutes), so the start gave up on it\. Its log \(container_logs\) may say why\.$/, w.error);
      assert.doesNotMatch(w.error, /may still be loading/);
      assert.ok(w.log.some(l => /Started gpu-hold on spark4 again$/.test(l)), w.log.join('\n'));
      assert.deepEqual([stateOf('spark4', SC), stateOf('spark4', JOB)], ['exited', 'running']);
    } finally { await modelStopped(); await api('/actions/keep_running', { method: 'POST', body: { spark: 'spark4', container: JOB, do: 'stop' } }).catch(() => {}); }
  });
});

// The limit moves only on the stand-in fleet (ALL_LOCAL, SPARK_CONSOLE_ALL_LOCAL=1, the switch every other test-only
// setting needs): a stray SPARK_CONSOLE_READY_MS on any other console moves nothing. Pure: the limit's own line, read from 07-jobs.mjs.
test('the limit moves only on the stand-in fleet: on any other console SPARK_CONSOLE_READY_MS is ignored', () => {
  const line = /^const START_READY_MS = (.+);$/m.exec(readFileSync(join(REPO, 'service', 'src', '07-jobs.mjs'), 'utf8'))?.[1];
  assert.ok(line, 'START_READY_MS in 07-jobs.mjs');
  const limit = (allLocal, value) => new Function('ALL_LOCAL', 'process', `return ${line};`)(allLocal, { env: value == null ? {} : { SPARK_CONSOLE_READY_MS: value } });
  assert.equal(limit(false, '20000'), 45 * 60000, 'a console that isn’t the stand-in fleet');
  assert.equal(limit(true, '20000'), 20000, 'the stand-in fleet');
  assert.deepEqual([limit(true, undefined), limit(true, ''), limit(true, 'soon')], [45 * 60000, 45 * 60000, 45 * 60000], 'not set, or not a number');
});

// The final read's put-back faults (W-1, W-3, W-6): a copy of the same model running is set aside for the new one, and
// its put-back looks at the new one's stop first; what couldn't be started again is owed and said; a new app whose run
// Docker didn't answer is stopped again.
const plantRadix = () => {
  const f = mock('spark4', 'containers');
  writeFileSync(f, `${readFileSync(f, 'utf8').split('\n').filter(l => l && !l.startsWith(`${SC}|`)).join('\n')}\n${SC}|running|Up 1 hour|1|${RADIX}||||\n`);
  writeFileSync(mock('spark4', `up-${SC}`), String(Math.floor(Date.now() / 1000) - 3600));
};
const asideOf = id => `${SC}-before-${id}`;
// (the new container under the copy's name runs, and the copy is set aside: from here its stop is what the test holds)
const newOneRuns = id => waitFor(async () => { if (stateOf('spark4', SC) === 'running' && stateOf('spark4', asideOf(id)) === 'exited') return true; const o = (await api(`/jobs/${id}`)).json; assert.equal(o.status, 'running', JSON.stringify(o)); return false; },
  { timeout: 120000 * SLOW, what: 'the new one running, the copy set aside', every: 100 });
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

describe('the put-back of a copy set aside, of what couldn’t start again, and of a run Docker didn’t answer (W-1, W-3, W-6)', { concurrency: 1 }, () => {
  test('a start over a running copy of the same model whose new container never stops: neither the job nor the copy is started beside it, both stay on the lists, and it is said', { timeout: 600000 * SLOW }, async () => {
    await jobRunning();
    plantRadix();
    silent(true);
    let id = null;
    try {
      const d = await deployRadix();
      id = d.id;
      assert.deepEqual(d.stops.sort(), [JOB, SC].sort());
      await newOneRuns(id);
      writeFileSync(mock('spark4', 'stop-hangs'), SC);
      const w = await opLong(id);
      assert.equal(w.status, 'failed', JSON.stringify(w));
      const owed = `gpu-hold and ${SC} (there as ${asideOf(id)}) weren’t started again on Spark 4: the new ${SC} may still be running there (Spark Console couldn’t confirm it stopped). Stop it there, then start gpu-hold and ${SC} again.`;
      assert.equal(w.error.split('\n')[1], owed, w.error);
      assert.equal(w.cleanUp, owed);
      assert.deepEqual([stateOf('spark4', SC), stateOf('spark4', asideOf(id)), stateOf('spark4', JOB)], ['running', 'exited', 'exited']);
      assert.deepEqual(w.ranHere, [`spark4/${SC}`]);
      assert.deepEqual([...w.stoppedHere].sort(), [`spark4/${JOB}`, `spark4/${SC}`].sort());
      assert.ok(!w.log.some(l => /Started gpu-hold on spark4 again|Started sc-.* on spark4 again/.test(l)), w.log.join('\n'));
    } finally {
      silent(false);
      await modelStopped();
      // (the copy set aside goes, so the next test starts from one copy)
      const f = mock('spark4', 'containers');
      writeFileSync(f, readFileSync(f, 'utf8').split('\n').filter(l => !l.startsWith(`${SC}-before-`)).join('\n'));
    }
  });

  test('the new container stops only at the put-back\'s own try: its second look starts the copy set aside again', { timeout: 600000 * SLOW }, async () => {
    await idle4();
    if (stateOf('spark4', JOB) === 'running') { await api('/actions/keep_running', { method: 'POST', body: { spark: 'spark4', container: JOB, do: 'stop' } }); await idle4(); }
    plantRadix();
    silent(true);
    let id = null;
    try {
      const d = await deployRadix();
      id = d.id;
      await newOneRuns(id);
      writeFileSync(mock('spark4', 'stop-hangs-once'), SC);
      const w = await opLong(id);
      assert.equal(w.status, 'failed', JSON.stringify(w));
      assert.ok(w.log.some(l => new RegExp(`Started ${SC.replace(/\./g, '\\.')} on spark4 again$`).test(l)), w.log.join('\n'));
      assert.equal(stateOf('spark4', SC), 'running', 'the copy runs again under its own name');
      assert.equal(stateOf('spark4', asideOf(id)), undefined, 'nothing left set aside');
      assert.equal(w.cleanUp, undefined);
      assert.deepEqual([w.ranHere, w.stoppedHere], [[], []]);
    } finally { silent(false); await modelStopped(); }
  });

  test('cancelled, and what it had stopped couldn’t be started again: the cancel says that, never "put back", and it stays on the list', { timeout: 420000 * SLOW }, async () => {
    await jobRunning();
    writeFileSync(mock('spark4', 'serve-down'), '');
    const said = 'gpu-hold couldn’t be started again on Spark 4; start it from Spark Console.';
    try {
      const { id } = await deployRadix();
      await waitFor(() => stateOf('spark4', SC) === 'running' && stateOf('spark4', JOB) === 'exited', { timeout: 120000 * SLOW, what: 'the new model loading, the job stopped', every: 100 });
      writeFileSync(mock('spark4', 'start-fails'), JOB);
      const c = await api(`/jobs/${id}/cancel`, { method: 'POST', body: {} });
      assert.equal(c.json?.outcome, 'cancelled', c.text);
      assert.equal(c.json.note, said);
      const w = await opLong(id);
      assert.equal(w.status, 'cancelled', JSON.stringify(w));
      assert.equal(w.error, `Cancelled by owner. ${said}`);
      for (const t of [c.json.note, w.error]) assert.doesNotMatch(t, /put back/);
      assert.deepEqual(w.stoppedHere, [`spark4/${JOB}`]);
      assert.deepEqual([stateOf('spark4', SC), stateOf('spark4', JOB)], ['exited', 'exited']);
    } finally { await modelStopped(); }
  });

  test('a new app whose docker run Docker didn’t answer in time, but that started: it is stopped again and said', { timeout: 420000 * SLOW }, async () => {
    await idle4();
    writeFileSync(mock('spark4', 'run-hangs'), 'hang-app');
    try {
      const r = await api('/actions/keep_running', { method: 'POST', body: { spark: 'spark4', container: 'hang-app', image: 'nginx:1.27', port: `${await freePort()}:80` } });
      assert.equal(r.json?.outcome, 'started', r.text);
      const w = await opLong(r.json.operation);
      assert.equal(w.status, 'failed', JSON.stringify(w));
      assert.equal(w.error, 'Docker didn’t answer the start of hang-app in time.');
      assert.ok(w.log.some(l => /It didn’t come up, so it was stopped again\./.test(l)), w.log.join('\n'));
      assert.notEqual(stateOf('spark4', 'hang-app'), 'running');
    } finally { rmSync(mock('spark4', 'run-hangs'), { force: true }); }
  });
});
