// Self-healing: the watcher starts one of Spark Console's crashed models again (restart, after the same memory check as
// a start), at most twice an hour per container (counted in heal-tries.json, so a restart of the service doesn't reset
// it), and records 'healing' / 'heal-skipped' fleet events and audit lines. Never: a model that ran out of memory (killed
// for it, or its log says so), one that exited with 255 (the Spark lost power or restarted), one on a Spark that went
// offline or came back in the last 30 minutes, one that ran less than SPARK_CONSOLE_HEAL_MIN_RUN_MS (10 minutes; one
// here), a part of a two-Spark model (the list of what should be running brings those back: heal-more.test.mjs), Sparkie's Spark (spark2 here), a container Spark Console didn't start, one the
// console stopped itself in the last 15 minutes, while the owner has self-healing off, or while agents are paused.
// Crashes are simulated by changing the stand-in docker's state; the watcher looks every 3 seconds. The stand-in docker
// says a container started on 2026-11-04 unless ~/.mock/started-<name> says otherwise.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, call, createActKey, agentSettings, waitFor, KeyPool, bug, SLOW } from './lib.mjs';

const keys = {}, looks = new KeyPool('heal-look', 100);   // polling: a fresh key every 100 calls (120 a minute each)
const mock = (spark, file) => join(T.fleet.root, spark, '.mock', file);
// Extra model containers of Spark Console's, running since a while ago.
function seed(spark, name, extra = '', model = 'Qwen--Qwen3-32B') {
  writeFileSync(mock(spark, 'containers'), `${readFileSync(mock(spark, 'containers'), 'utf8')}${name}|running|Up 1 hour|1|${model}||${extra}\n`);
  writeFileSync(mock(spark, `up-${name}`), String(Math.floor(Date.now() / 1000) - 3600));
}
// A container that crashes: exited, with this status (its exit code; "OOM" for killed for memory).
function crash(spark, name, status = 'Exited (1) just now') {
  const f = mock(spark, 'containers'), before = readFileSync(f, 'utf8');
  const after = before.replace(new RegExp(`^${name.replace(/[.+]/g, '\\$&')}\\|running\\|[^|]*\\|`, 'm'), `${name}|exited|${status}|`);
  assert.notEqual(after, before, `${spark}/${name} wasn't running`);
  writeFileSync(f, after);
  rmSync(mock(spark, `up-${name}`), { force: true });
}
const stateOf = (spark, name) => readFileSync(mock(spark, 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];

async function tool(name, args, token) {
  const r = await call(token || await looks.token(), name, args);
  assert.equal(r.isError, false, `${name}: ${r.text}`);
  return r.value;
}
const eventsSince = async since => (await tool('fleet_events', { since, limit: 200 })).events;
const has = (evs, spark, container, type) => evs.find(e => e.spark === spark && e.container === container && e.type === type);
async function waitEvents(since, wanted, what) {
  // (a heal looks at the Spark first; on the stand-in fleet under the whole suite's load, that alone can take ~20 s)
  return waitFor(async () => { const evs = await eventsSince(since); return wanted.every(([s, c, t]) => has(evs, s, c, t)) && evs; }, { timeout: 60000, every: 500, what });
}
async function running(spark, name) {
  await waitFor(async () => (await tool('workloads', { spark })).workloads.some(w => w.name === name && w.running), { timeout: 60000, every: 500, what: `the watcher seeing ${spark}/${name} running` });
}
async function finished(id) {
  for (;;) {
    const w = await tool('wait_operation', { id, seconds: 20 });
    if (w.status !== 'running') return w;
  }
}
const auditLines = () => (existsSync(join(T.fleet.stateDir, 'audit.jsonl')) ? readFileSync(join(T.fleet.stateDir, 'audit.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const NOTHING = ['healing', 'heal-skipped'];
const noHealing = (evs, spark, container) => assert.ok(!evs.some(e => e.spark === spark && e.container === container && NOTHING.includes(e.type)),
  `${spark}/${container}: ${JSON.stringify(evs.filter(e => e.container === container))}`);

const TESTORG = 'sc-testorg--Qwen3.8-27B-abliterated-GGUF', RADIX = 'sc-RadixArk--Qwen3.8-27B-NVFP4';
const HEAL_FILE = () => join(T.fleet.stateDir, 'heal-tries.json');
// Restart attempts from before this service started (heal-tries.json, as a restart of the service would find it).
const PREHEAL = 'sc-preheal';
useFleet({
  watchMs: 3000,
  env: { SPARK_CONSOLE_HEAL_MIN_RUN_MS: '60000' },
  prepare: ({ stateDir }) => {
    writeFileSync(join(stateDir, 'heal-tries.json'), JSON.stringify({ [`spark4/${PREHEAL}`]: [Date.now() - 20 * 60000, Date.now() - 10 * 60000] }), { mode: 0o600 });
    // Nothing on the list of what should be running: bringing that back (and two-Spark models) is heal-more.test.mjs's.
    writeFileSync(join(stateDir, 'desired.json'), JSON.stringify({ revision: 1, running: [], revisions: [] }), { mode: 0o600 });
  },
}, async () => {
  keys.act = await createActKey('heal-act');
  // While the watcher hasn't started yet (15 s after the service): the owner's agent stops spark3's model and starts it
  // again, as you would after changing something.
  for (const [action, check] of [['stop_model', 'exited'], ['restart_model', 'running']]) {
    const x = await tool(action, { spark: 'spark3', container: TESTORG }, keys.act.token);
    assert.equal((await finished(x.operation)).status, 'completed', action);
    assert.equal(stateOf('spark3', TESTORG), check);
  }
  // More of Spark Console's models, to crash in different ways (after that restart: they'd hold its port).
  seed('spark3', 'sc-oomkilled');
  seed('spark3', 'sc-oomlog');
  writeFileSync(mock('spark3', 'logs-sc-oomlog'), 'INFO loading weights\ntorch.OutOfMemoryError: CUDA out of memory. Tried to allocate 2.00 GiB\n');
  seed('spark4', 'sc-pairpart', '|spark3+spark4|0');
});

let round1;   // when the crashes below happened
test('a crash of each kind at once: only Spark Console\'s own one-Spark models, off Spark 2, not out of memory, are started again', { timeout: 240000 * SLOW }, async () => {
  const want = [['spark4', RADIX], ['spark3', TESTORG], ['spark2', 'sc-gpt-oss-20b'], ['spark3', 'sc-oomkilled'], ['spark3', 'sc-oomlog'],
    ['spark4', 'sc-pairpart'], ['spark4', 'qwen-recipe-aphex3k']];
  for (const [s, c] of want) await running(s, c);
  round1 = new Date().toISOString();
  crash('spark4', RADIX);
  crash('spark3', TESTORG, 'Exited (2) just now');          // (its heal is checked in the next test)
  crash('spark2', 'sc-gpt-oss-20b');                        // Sparkie's Spark
  crash('spark3', 'sc-oomkilled', 'Exited (137) OOM');       // killed for memory
  crash('spark3', 'sc-oomlog');                              // its log says out of memory
  crash('spark4', 'sc-pairpart');                            // a part of a two-Spark model
  crash('spark4', 'qwen-recipe-aphex3k');                    // not started by Spark Console
  const crashed = await waitEvents(round1, want.map(([s, c]) => [s, c, 'crashed']), 'seven crashes');
  assert.equal(has(crashed, 'spark3', 'sc-oomkilled', 'crashed').oomKilled, true);
  assert.equal(has(crashed, 'spark3', TESTORG, 'crashed').exitCode, 2);
  const evs = await waitEvents(round1, [['spark4', RADIX, 'healing'], ['spark3', 'sc-oomlog', 'heal-skipped']], 'healing and heal-skipped');
  assert.match(has(evs, 'spark3', 'sc-oomlog', 'heal-skipped').why, /out of memory/);
  const quiet = [['spark2', 'sc-gpt-oss-20b'], ['spark3', 'sc-oomkilled'], ['spark4', 'sc-pairpart'], ['spark4', 'qwen-recipe-aphex3k']];
  for (const [s, c] of quiet) noHealing(evs, s, c);
  // The restart runs as an operation of its own, as the owner, and answers again.
  const healing = has(evs, 'spark4', RADIX, 'healing');
  assert.match(healing.operation, /^[0-9a-f]{12}$/);
  const w = await finished(healing.operation);
  assert.equal(w.status, 'completed', JSON.stringify(w));
  assert.equal(w.type, 'restart');
  assert.equal(stateOf('spark4', RADIX), 'running');
  const op = (await tool('recent_operations', { limit: 50 })).operations.find(o => o.id === healing.operation);
  assert.equal(op.by, 'owner');
  assert.ok(auditLines().some(l => l.via === 'watcher' && l.actor === 'Self-healing' && l.action === 'restart_model' && l.ok === true && l.operation === healing.operation));
  for (const [s, c] of [...quiet, ['spark3', 'sc-oomlog']]) assert.equal(stateOf(s, c), 'exited', `${s}/${c}`);
  const skipped = auditLines().find(l => l.via === 'watcher' && l.ok === false && l.args?.container === 'sc-oomlog');
  assert.match(skipped?.error || '', /out of memory/);
  // The try is on disk (with the ones from before the service started).
  const tries = JSON.parse(readFileSync(HEAL_FILE(), 'utf8'));
  assert.equal(tries[`spark4/${RADIX}`]?.length, 1, JSON.stringify(tries));
  assert.equal(tries[`spark4/${PREHEAL}`]?.length, 2);
});

test('one the console stopped and then started again (restart_model) is healed when it crashes', { timeout: 180000 * SLOW }, async () => {
  // spark3's model crashed in the round above, after the agent's stop and restart_model before it; a heal would have
  // been recorded by now (spark4's, from the same look, already finished), so this waits only briefly.
  const healed = await waitFor(async () => has(await eventsSince(round1), 'spark3', TESTORG, 'healing') || null, { timeout: 3000, what: 'healing' }).catch(() => null);
  assert.ok(healed, `not healed: ${JSON.stringify((await eventsSince(round1)).filter(e => e.container === TESTORG))}`);
  assert.equal((await finished(healed.operation)).status, 'completed');
});

describe('then, side by side', { concurrency: true }, () => {
  test('spark4: a second crash in the hour is healed, a third isn\'t', { timeout: 240000 * SLOW }, async () => {
    await running('spark4', RADIX);
    let since = new Date().toISOString();
    crash('spark4', RADIX);
    const evs = await waitEvents(since, [['spark4', RADIX, 'healing']], 'the second healing');
    assert.equal((await finished(has(evs, 'spark4', RADIX, 'healing').operation)).status, 'completed');
    await running('spark4', RADIX);
    since = new Date().toISOString();
    crash('spark4', RADIX);
    const third = await waitEvents(since, [['spark4', RADIX, 'heal-skipped']], 'the third crash skipped');
    assert.match(has(third, 'spark4', RADIX, 'heal-skipped').why, /two restarts this hour/);
    assert.ok(!has(third, 'spark4', RADIX, 'healing'));
    assert.equal(stateOf('spark4', RADIX), 'exited');
  });
  test('spark3: one Spark Console stopped itself (its engine exits with 1 on SIGTERM, so it looks like a crash) is left alone', { timeout: 180000 * SLOW }, async () => {
    seed('spark3', 'sc-sigterm');
    writeFileSync(mock('spark3', 'stop-code-sc-sigterm'), '1');
    await running('spark3', 'sc-sigterm');
    const since = new Date().toISOString();
    const x = await tool('stop_model', { spark: 'spark3', container: 'sc-sigterm' }, keys.act.token);
    assert.equal((await finished(x.operation)).status, 'completed');
    // (left alone is decided as the crash is seen: nothing comes after it)
    const evs = await waitEvents(since, [['spark3', 'sc-sigterm', 'crashed']], 'the stop seen as a crash');
    assert.equal(has(evs, 'spark3', 'sc-sigterm', 'crashed').exitCode, 1);
    noHealing(evs, 'spark3', 'sc-sigterm');
    assert.equal(stateOf('spark3', 'sc-sigterm'), 'exited');
  });
});

// (seeded only now: running, they'd hold their Spark's serve port while RADIX and TESTORG are restarted above)
describe('left alone, side by side', { concurrency: true }, () => {
  test('two restarts this hour from before the service started (heal-tries.json): a third crash isn\'t restarted', { timeout: 180000 * SLOW }, async () => {
    seed('spark4', PREHEAL);
    await running('spark4', PREHEAL);
    const since = new Date().toISOString();
    crash('spark4', PREHEAL);
    const evs = await waitEvents(since, [['spark4', PREHEAL, 'heal-skipped']], 'heal-skipped');
    assert.match(has(evs, 'spark4', PREHEAL, 'heal-skipped').why, /two restarts this hour/);
    assert.equal(stateOf('spark4', PREHEAL), 'exited');
  });
  test('exit code 255 (the Spark lost power or restarted): not restarted', { timeout: 180000 * SLOW }, async () => {
    seed('spark3', 'sc-exit255');
    await running('spark3', 'sc-exit255');
    const since = new Date().toISOString();
    crash('spark3', 'sc-exit255', 'Exited (255) just now');
    const evs = await waitEvents(since, [['spark3', 'sc-exit255', 'heal-skipped']], 'heal-skipped');
    assert.equal(has(evs, 'spark3', 'sc-exit255', 'crashed').exitCode, 255);
    assert.match(has(evs, 'spark3', 'sc-exit255', 'heal-skipped').why, /lost power or restarted/);
    assert.equal(stateOf('spark3', 'sc-exit255'), 'exited');
  });
  test('one that ran less than the minimum (a minute here) isn\'t restarted: likely a setup problem', { timeout: 180000 * SLOW }, async () => {
    seed('spark4', 'sc-justnow');
    writeFileSync(mock('spark4', 'started-sc-justnow'), new Date(Date.now() - 20000).toISOString());
    await running('spark4', 'sc-justnow');
    const since = new Date().toISOString();
    crash('spark4', 'sc-justnow');
    const evs = await waitEvents(since, [['spark4', 'sc-justnow', 'heal-skipped']], 'heal-skipped');
    assert.match(has(evs, 'spark4', 'sc-justnow', 'heal-skipped').why, /stopped within 1 minutes of starting/);
    assert.equal(stateOf('spark4', 'sc-justnow'), 'exited');
    assert.ok(auditLines().some(l => l.via === 'watcher' && l.ok === false && l.args?.container === 'sc-justnow'));
  });
});

// The review of A-5: the reason kept when a restart fails was the error as it came. Here the error names the model,
// which isn't in the library: a fake key (built from pieces), so the reason holds a key.
test('a restart that fails with a key in its error: the reason kept in the fleet\'s record hides it', { timeout: 180000 * SLOW }, async () => {
  const KEY = ['hf_', 'FAKE', 'fake'.repeat(5), '0000'].join(''), name = 'sc-keyed';
  seed('spark3', name, '', KEY);
  await running('spark3', name);
  const since = new Date().toISOString();
  crash('spark3', name);
  const evs = await waitEvents(since, [['spark3', name, 'heal-skipped']], 'heal-skipped');
  assert.match(has(evs, 'spark3', name, 'heal-skipped').why, /isn’t in the library on spark3 any more/);
  const kept = readFileSync(join(T.fleet.stateDir, 'events.jsonl'), 'utf8').split('\n').filter(l => l.includes('"heal-skipped"') && l.includes(`"${name}"`));
  assert.equal(kept.length, 1, kept.join('\n'));
  assert.ok(!kept[0].includes('FAKEfake'), `a piece of the key is in events.jsonl: ${kept[0]}`);
  assert.match(kept[0], /\[hidden\] isn’t in the library/);
  assert.equal(stateOf('spark3', name), 'exited');
});

describe('the owner\'s switches', () => {
  // Both seen running before either test (they don't hold anything the other needs).
  const names = { 'self-healing off': 'sc-selfheal-off-test', 'agents paused': 'sc-paused-test' };
  test('(two more of Spark Console\'s models running on spark4)', { timeout: 30000 * SLOW }, async () => {
    for (const c of Object.values(names)) seed('spark4', c);
    for (const c of Object.values(names)) await running('spark4', c);
  });
  for (const [label, setting] of [['self-healing off', { selfHeal: false }], ['agents paused', { halted: true }]]) {
    test(`${label}: a crash is left alone`, { timeout: 180000 * SLOW }, async () => {
      const c = names[label];
      await agentSettings(setting);
      try {
        const since = new Date().toISOString();
        crash('spark4', c);
        // (left alone is decided as the crash is seen)
        noHealing(await waitEvents(since, [['spark4', c, 'crashed']], 'the crash'), 'spark4', c);
        assert.equal(stateOf('spark4', c), 'exited');
      } finally { await agentSettings({ selfHeal: true, halted: false }); }
    });
  }
});

// Last: it takes spark4 offline for a moment.
describe('a Spark that went offline', () => {
  test('a crash there within 30 minutes of it going offline or coming back isn\'t restarted', { timeout: 90000 * SLOW }, async () => {
    seed('spark4', 'sc-after-offline');
    await running('spark4', 'sc-after-offline');
    const since = new Date().toISOString();
    writeFileSync(T.fleet.offlineFile, 'spark1\nspark4\n');
    await waitFor(async () => (await tool('fleet_events', { since, type: 'spark-offline' })).events.some(e => e.spark === 'spark4'), { timeout: 40000, what: 'spark4 going offline' });
    writeFileSync(T.fleet.offlineFile, 'spark1\n');
    await waitFor(async () => (await tool('fleet_events', { since, type: 'spark-online' })).events.some(e => e.spark === 'spark4'), { timeout: 40000, what: 'spark4 coming back' });
    await running('spark4', 'sc-after-offline');
    const at = new Date().toISOString();
    crash('spark4', 'sc-after-offline');
    const evs = await waitEvents(at, [['spark4', 'sc-after-offline', 'heal-skipped']], 'heal-skipped');
    assert.match(has(evs, 'spark4', 'sc-after-offline', 'heal-skipped').why, /Spark 4 was offline in the last half hour/);
    assert.equal(stateOf('spark4', 'sc-after-offline'), 'exited');
  });
});
