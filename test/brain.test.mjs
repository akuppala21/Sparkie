// Sparkie's own model (the brain) when a change of Spark Console's goes wrong. Switching it: a setup that can't start is
// refused before anything stops; a failed switch says whether the old model came back, and leaves no half-started
// container when it didn't (F3). The brain keeper (H2): a brain Spark Console left down itself (its `leftDown` mark in
// main.json) comes back with the same setup, twice in 6 hours at most, stopping nothing; one stopped by the owner never
// does. The stand-in brain is sparkie-main on spark2; ~/.mock/reject-flag makes its start exit at once, and the stand-in
// docker exits any model whose name has "gemma".
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, agentSettings, auditLines, eventLines, waitFor, sleep, SLOW } from './lib.mjs';

useFleet({
  watchMs: 60000,
  // (self-healing looks every 2 s, and a brain stopped for 3 s is "down", so the keeper acts within seconds)
  env: { SPARK_CONSOLE_HEAL_MS: '2000', SPARK_CONSOLE_HEAL_SETTLE_MS: '3000' },
  prepare: ({ stateDir }) => {
    const f = join(stateDir, 'main.json'), m = JSON.parse(readFileSync(f, 'utf8')), base = m.presets[m.current];
    m.presets['f3-not-here'] = { ...base, title: 'Not here', model: 'nobody--not-here' };
    m.presets['f3-crashes'] = { node: base.node, title: 'Crashes at start', served: 'gemma-brain', engine: base.engine, image: base.image, imageId: base.imageId, model: 'Qwen--Qwen3-32B', port: base.port, args: [] };
    writeFileSync(f, JSON.stringify(m), { mode: 0o600 });
  },
}, async () => { await agentSettings({ selfHeal: false }); });

const mock = f => join(T.fleet.root, 'spark2', '.mock', f);
const brainState = () => readFileSync(mock('containers'), 'utf8').split('\n').find(l => l.startsWith('sparkie-main|'))?.split('|')[1] || 'missing';
const setBrain = state => writeFileSync(mock('containers'), readFileSync(mock('containers'), 'utf8').replace(/^sparkie-main\|[^|]*\|/m, `sparkie-main|${state}|`));
const mainFile = () => JSON.parse(readFileSync(join(T.fleet.stateDir, 'main.json'), 'utf8'));
const tries = () => { try { return JSON.parse(readFileSync(join(T.fleet.stateDir, 'heal-tries.json'), 'utf8'))['keep:spark2/sparkie-main'] || []; } catch { return []; } };
const keeperStarts = async () => (await api('/jobs')).json.jobs.filter(j => j.type === 'main-start' && j.actor === 'Self-healing');
const ended = id => waitFor(async () => { const j = (await api(`/jobs/${id}`)).json; return j.status !== 'running' && j; }, { timeout: 180000 * SLOW, what: `operation ${id} to end` });
const answering = () => waitFor(async () => { const m = (await api('/main')).json; return m.state === 'running' && m.healthy === true; }, { timeout: 90000 * SLOW, what: 'Sparkie answering' });
const draft = () => join(T.fleet.root, 'spark2', '.cache', 'huggingface', 'hub', 'models--z-lab--Qwen3.8-27B-DFlash2');
async function brainJob(path, body = {}) {
  const r = await api(path, { method: 'POST', body });
  assert.equal(r.status, 202, r.text);
  return ended(r.json.id);
}
// The owner's own brain start, failing after Spark Console removed the container (the stand-in engine rejects a flag).
async function failedStart() {
  writeFileSync(mock('reject-flag'), '--tp-size');
  const j = await brainJob('/main/start');
  assert.equal(j.status, 'failed', JSON.stringify(j.log));
  assert.equal(brainState(), 'exited');
  rmSync(mock('reject-flag'), { force: true });
}

describe('switching Sparkie\'s model', { concurrency: 1 }, () => {
  test('a switch to a setup that can\'t start leaves Sparkie\'s model untouched', { timeout: 120000 * SLOW }, async () => {
    await answering();
    const up = readFileSync(mock('up-sparkie-main'), 'utf8'), id = (await api('/main')).json.id;
    const j = await brainJob('/main/use', { preset: 'f3-not-here' });
    assert.equal(j.status, 'failed');
    assert.match(j.error, /^Not here can’t start, and nothing was stopped: nobody\/not-here isn’t on spark2\./);
    assert.ok(!j.log.some(l => /Stopping/.test(l)), JSON.stringify(j.log));
    assert.equal(brainState(), 'running');
    assert.equal(readFileSync(mock('up-sparkie-main'), 'utf8'), up, 'never restarted');
    assert.equal((await api('/main')).json.id, id);
    assert.equal(mainFile().leftDown, undefined);
  });

  test('a failed switch says the truth about the way back', { timeout: 400000 * SLOW }, async t => {
    t.after(() => { if (existsSync(`${draft()}.aside`)) renameSync(`${draft()}.aside`, draft()); });
    const id = (await api('/main')).json.id;
    // The new setup crashes; the old one comes back.
    let j = await brainJob('/main/use', { preset: 'f3-crashes' });
    assert.equal(j.status, 'failed');
    assert.match(j.error, /^Crashes at start didn’t start, so Sparkie is back on /);
    await answering();
    // The new setup crashes, and the old one can't start either (its draft model is gone): it says so, and no
    // half-started container is left for Docker or the word to bring back.
    renameSync(draft(), `${draft()}.aside`);
    j = await brainJob('/main/use', { preset: 'f3-crashes' });
    assert.equal(j.status, 'failed');
    assert.doesNotMatch(j.error, /is back on/);
    assert.match(j.error, /didn’t come back either, so Sparkie is down\. To start it again, type \/restart sparkie/);
    const m = (await api('/main')).json;
    assert.deepEqual([m.state, m.id], ['missing', id]);
    assert.ok(mainFile().leftDown, 'Spark Console took it down: marked');
    // (put back: the owner's own start)
    renameSync(`${draft()}.aside`, draft());
    assert.equal((await brainJob('/main/start')).status, 'completed');
    await answering();
    assert.equal(mainFile().leftDown, undefined, 'answering again: the mark is gone');
  });
});

describe('the brain keeper', { concurrency: 1 }, () => {
  test('a brain Spark Console left down itself comes back with the same setup', { timeout: 300000 * SLOW }, async () => {
    await answering();
    const id = (await api('/main')).json.id;
    await failedStart();
    assert.ok(mainFile().leftDown, 'the failed start left the mark');
    const from = eventLines().length;
    await agentSettings({ selfHeal: true });
    try {
      await waitFor(() => eventLines().slice(from).some(e => e.type === 'healing' && e.container === 'sparkie-main' && /^Spark Console left Sparkie’s model down/.test(e.why)),
        { timeout: 60000 * SLOW, what: 'the keeper' });
      const [job] = await keeperStarts();
      assert.equal((await ended(job.id)).status, 'completed', JSON.stringify(job));
      await answering();
      assert.equal((await api('/main')).json.id, id);
      const args = readFileSync(mock('last-run-args'), 'utf8').split('\n');
      assert.equal(args[args.indexOf('--served-model-name') + 1], 'qwen-aphex');
      assert.equal(mainFile().leftDown, undefined);
      assert.equal(tries().length, 1);
      assert.ok(auditLines().some(l => l.action === 'start_sparkie' && l.actor === 'Self-healing' && l.operation === job.id));
    } finally { await agentSettings({ selfHeal: false }); }
  });

  test('the second try refuses to stop anything; then one notice, and never a third', { timeout: 300000 * SLOW }, async t => {
    await failedStart();
    // Something else on Spark 2's GPU: starting the brain now would stop it.
    writeFileSync(mock('gpu'), '4242, 20000, python3, sc-gpt-oss-20b\n');
    t.after(() => rmSync(mock('gpu'), { force: true }));
    const from = eventLines().length, twice = () => eventLines().slice(from).filter(e => e.type === 'notice' && /tried twice in the last 6 hours to start Sparkie’s model again on Spark 2/.test(e.text || ''));
    await agentSettings({ selfHeal: true });
    try {
      await waitFor(() => twice().length, { timeout: 60000 * SLOW, what: 'the notice' });
      await sleep(10000);
      assert.equal(twice().length, 1, 'one notice');
      assert.match(twice()[0].text, /\/restart sparkie/);
      const starts = await keeperStarts();
      assert.equal(starts.length, 2, 'never a third');
      assert.equal(starts[0].status, 'failed');
      assert.match(starts[0].error, /would stop, copy or download something/);
      assert.match(readFileSync(mock('containers'), 'utf8'), /^sc-gpt-oss-20b\|running\|/m);
      assert.equal(tries().length, 2);
      assert.equal(mainFile().leftDown, undefined);
      assert.equal(brainState(), 'exited');
    } finally { await agentSettings({ selfHeal: false }); }
    rmSync(mock('gpu'), { force: true });
    assert.equal((await brainJob('/main/start')).status, 'completed');
    await answering();
  });

  test('the owner\'s Stop clears the mark, and so does the brain answering again however it came back: nothing is started', { timeout: 300000 * SLOW }, async () => {
    const before = (await keeperStarts()).length;
    await failedStart();
    assert.ok(mainFile().leftDown);
    assert.equal((await brainJob('/main/stop')).status, 'completed');
    assert.equal(mainFile().leftDown, undefined, 'the owner\'s Stop');
    await agentSettings({ selfHeal: true });
    try {
      await sleep(12000);
      assert.equal((await keeperStarts()).length, before, 'stopped by the owner: never started by itself');
      assert.equal(brainState(), 'exited');
    } finally { await agentSettings({ selfHeal: false }); }
    // Left down by a failed start, then brought back by hand: once it answers, the mark goes.
    await failedStart();
    assert.ok(mainFile().leftDown);
    setBrain('running');
    writeFileSync(mock('up-sparkie-main'), String(Math.floor(Date.now() / 1000) - 60));
    await answering();
    await agentSettings({ selfHeal: true });
    try {
      await waitFor(() => mainFile().leftDown === undefined, { timeout: 30000 * SLOW, what: 'the mark to go' });
      assert.equal((await keeperStarts()).length, before);
    } finally { await agentSettings({ selfHeal: false }); }
  });
});
