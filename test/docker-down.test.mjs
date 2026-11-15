// Covers: Docker not answering on a Spark that is on (`.mock/stall` set to 0): no `removed` events, healing leaves a
// two-Spark model alone and uses no try, the should-run list says “Docker isn’t answering on Spark 3”, one notice for
// the whole outage, one line in `needsOwner` and none for the model; when Docker answers again everything is known as
// before (F6).
//
// Docker not answering on a Spark that is on (its service restarting, or slow) is "couldn't read", never "nothing
// there" (F6, 2026-11-12). The stand-in Spark's ~/.mock/stall set to 0 makes every docker command there fail at once
// while the Spark itself (its worker) still answers. Before: the watcher's `docker ps … | while` exited 0 with no lines and
// called every container there removed, healing stopped the healthy part of a two-Spark model and used a try, and the
// should-run list said "its container is gone" with a notice for each model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, call, createKey, waitFor, sleep, SLOW } from './lib.mjs';

const keys = {};
// A model running across Spark 3 and Spark 4, on the should-run list before Spark Console starts (no start needed).
const MODEL = 'pair-model', HEAD = `sc-${MODEL}`, PART2 = `${HEAD}-part2`, DOWN = 'spark3';
useFleet({ watchMs: 2000, statusMs: 3000,
  env: { SPARK_CONSOLE_HEAL_MS: '2000', SPARK_CONSOLE_DESIRED_MS: '2000' },
  prepare: ({ root, stateDir }) => {
    appendFileSync(join(root, 'spark3', '.mock', 'containers'), `${HEAD}|running|Up 2 hours|1|${MODEL}|||spark3+spark4|0\n`);
    appendFileSync(join(root, 'spark4', '.mock', 'containers'), `${PART2}|running|Up 2 hours|1|${MODEL}|||spark3+spark4|1\n`);
    const at = '2026-11-10T00:00:00.000Z', entry = { spark: 'spark3', container: HEAD, model: MODEL, sparks: ['spark3', 'spark4'], since: at, by: 'owner@test' };
    writeFileSync(join(stateDir, 'desired.json'), JSON.stringify({ revision: 1, running: [entry],
      revisions: [{ revision: 1, at, by: 'owner@test', chat: null, operation: null, added: [`spark3/${HEAD}`], removed: [], before: [] }] }), { mode: 0o600 });
  },
}, async () => { keys.look = await createKey('docker-down'); });

const mock = (spark, file) => join(T.fleet.root, spark, '.mock', file);
const stateOf = (spark, name) => readFileSync(mock(spark, 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];
const eventsSince = async since => (await call(keys.look.token, 'fleet_events', { since, limit: 200 })).value.events;
const tries = () => { try { return readFileSync(join(T.fleet.stateDir, 'heal-tries.json'), 'utf8'); } catch { return ''; } };
const listed = async () => (await call(keys.look.token, 'should_be_running', {})).value.running.find(x => x.container === HEAD);
const watched = async (spark, name) => (await call(keys.look.token, 'workloads', { spark })).value.workloads.find(w => w.name === name);
const needsOwner = async () => (await call(keys.look.token, 'fleet_status', {})).value.needsOwner;
// What a container look or healing would write if it took "couldn't read" for "nothing there".
const MOVED = ['removed', 'created', 'started', 'stopped', 'crashed', 'healing', 'heal-skipped'];
const dockerNotices = ev => ev.filter(e => e.type === 'notice' && /Docker/.test(e.text));
// The by-hand line, as it really is (the Fleet group's review, 2026-11-13): a Docker restart stops every container there,
// and only Sparkie's model (--restart unless-stopped) comes back by itself.
const RESTART_ADVICE = /run this on Spark 3: sudo systemctl restart docker\. It stops every container there: Sparkie’s model comes back by itself, and the rest need bringing back\.$/;

test('Docker stops answering on Spark 3: nothing is called removed, nothing is healed, and the owner hears once', { timeout: 300000 * SLOW }, async t => {
  // (the watcher's first look is 15 s after the start; both parts are known and running, and the list agrees)
  await waitFor(async () => (await watched('spark3', HEAD))?.running && (await watched('spark4', PART2))?.running, { timeout: 60000 * SLOW, what: 'the watcher seeing both parts' });
  await waitFor(async () => (await listed())?.state === 'running', { timeout: 60000 * SLOW, what: 'the should-run list seeing it running' });
  const triesBefore = tries(), since = new Date().toISOString();
  writeFileSync(mock(DOWN, 'stall'), '0');
  t.after(() => rmSync(mock(DOWN, 'stall'), { force: true }));

  // The watcher's next look: it says so, and nothing there is called removed.
  await waitFor(async () => { const ev = await eventsSince(since); return dockerNotices(ev).length || ev.some(e => e.type === 'removed' && e.spark === DOWN); },
    { timeout: 40000 * SLOW, what: 'the watcher’s next look at Spark 3' });
  assert.deepEqual((await eventsSince(since)).filter(e => e.type === 'removed'), [], 'no container is called removed');

  // The should-run list says why (from the same look healing uses), without calling the container gone.
  const held = await waitFor(async () => { const x = await listed(); return x?.state === 'held' ? x : null; }, { timeout: 60000 * SLOW, what: 'the should-run list seeing Spark 3 unread' });
  assert.equal(held.why, 'Docker isn’t answering on Spark 3');
  // Healing and the held-notice loop (every 2 s here) pass a few times on that look.
  await sleep(8000 * SLOW);
  const ev = await eventsSince(since);
  assert.deepEqual(ev.filter(e => MOVED.includes(e.type)), [], 'nothing was removed, started or healed');
  assert.equal(tries(), triesBefore, 'no heal try was used');
  assert.equal(stateOf('spark4', PART2), 'running', 'the healthy part on Spark 4 was not stopped');
  assert.equal(dockerNotices(ev).length, 1, JSON.stringify(ev.filter(e => e.type === 'notice')));
  assert.match(dockerNotices(ev)[0].text, /^Docker isn’t answering on Spark 3, so Spark Console can’t see or change its containers\. Nothing was changed\./);
  assert.equal(dockerNotices(ev)[0].spark, DOWN);
  assert.match(dockerNotices(ev)[0].text, RESTART_ADVICE);
  assert.ok(!/restarts every container/.test(dockerNotices(ev)[0].text), dockerNotices(ev)[0].text);
  assert.ok(!ev.some(e => e.type === 'notice' && /should be running but isn’t/.test(e.text)), 'no “should be running but isn’t” for what couldn’t be read');
  // What waits on the owner (H4): Docker on Spark 3, once; not the model as "should be running" (whether it runs isn't known).
  const needs = await needsOwner();
  assert.deepEqual(needs.filter(l => /Docker isn’t answering on Spark 3/.test(l)).length, 1, JSON.stringify(needs));
  assert.match(needs.find(l => /Docker isn’t answering on Spark 3/.test(l)), RESTART_ADVICE);
  assert.ok(!needs.some(l => l.includes(HEAD)), JSON.stringify(needs));

  // Docker answers again: everything is known as before, and nothing that never stopped is "created" or "started".
  rmSync(mock(DOWN, 'stall'));
  await waitFor(async () => (await listed())?.state === 'running', { timeout: 60000 * SLOW, what: 'the should-run list seeing it running again' });
  await sleep(5000 * SLOW);
  const after = await eventsSince(since);
  assert.deepEqual(after.filter(e => MOVED.includes(e.type)), []);
  assert.equal(dockerNotices(after).length, 1, 'still one notice for the whole outage');
  assert.equal((await watched('spark3', HEAD))?.state, 'running');
  assert.ok(!(await needsOwner()).some(l => /Docker/.test(l)), 'the line goes when Docker answers');
  assert.equal(stateOf('spark4', PART2), 'running');
});
