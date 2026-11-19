// Covers: Wall electricity is kept by America/Los_Angeles calendar month in energy.json, separately from lifetime
// GPU and wall totals. Trapezoids split at local month boundaries with interpolated watts; DST, restarts, zero watts,
// duplicate/missing plug observations and long gaps remain honest. Legacy totals migrate only with both endpoints
// in one month, once and partial. A new month appears on read without inventing old data. Bad energy state preserves
// the file and leaves status/power usable. Owner-only status includes the existing power view without switching.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { useFleet, api, T } from './lib.mjs';
import { startPlugs } from './mock/plugs.mjs';

const statusSource = readFileSync(new URL('../service/src/12-status.mjs', import.meta.url), 'utf8');
const energyCode = statusSource.slice(statusSource.indexOf('const ENERGY_FILE ='), statusSource.indexOf('setTimeout(() => {\n  collectStatus()'));
const iso = t => new Date(t).toISOString();
const time = s => Date.parse(s);
const near = (a, b, tolerance = 1e-10) => assert.ok(Math.abs(a - b) <= tolerance, `${a} differs from ${b}`);

function fixture({ at = '2026-11-18T20:00:00Z', seed = null, ids = ['spark3'] } = {}) {
  let now = time(at), kept = structuredClone(seed), saves = 0, powerReads = 0;
  const nodes = ids.map(id => ({ id, name: id })), walls = new Map();
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const power = { switchable: ids.filter(id => id !== 'spark1'), bySpark: Object.fromEntries(ids.map(id => [id, { state: 'on' }])) };
  const world = vm.runInNewContext(`${energyCode}\n({ sampleEnergy, energyView, wallMonthlyView, wallMonthStart, wallMonthAt, collectStatus, statusFor })`, {
    Date: Clock, Intl, STATE_DIR: '/fixture', NODES: nodes, STATUS_EVERY: 30000,
    readKept: () => structuredClone(kept),
    writePrivate: (_file, value) => { kept = structuredClone(value); saves++; },
    HttpError: class extends Error {},
    refreshNodes: async () => {}, runWorker: async () => ({ gpuPowerWatts: 999 }),
    cleanStatus: (node, raw) => ({ ...node, ...raw, reachable: true, state: 'online' }),
    wallFor: id => walls.get(id) || null,
    powerCutOperation: () => null, powerMark: () => null,
    noteSparkStates: () => {}, tasksNow: () => [],
    powerView: () => { powerReads++; return power; },
  });
  const points = values => nodes.map((n, i) => {
    const value = values[n.id];
    const wall = value == null ? null : { answering: true, watts: typeof value === 'number' ? value : value.watts,
      plug: i + 1, at: iso(now), ...(typeof value === 'object' ? value : {}) };
    walls.set(n.id, wall);
    return { ...n, reachable: true, gpuPowerWatts: 999, wall };
  });
  return {
    ...world,
    clock: value => { now = typeof value === 'string' ? time(value) : value; },
    sample(value, readings = { spark3: 60 }) { now = typeof value === 'string' ? time(value) : value; world.sampleEnergy(points(readings)); },
    setReadings: points,
    saved: () => structuredClone(kept), saves: () => saves, powerReads: () => powerReads,
    replaceSaved: value => { kept = structuredClone(value); },
    view: () => JSON.parse(JSON.stringify(world.energyView())),
  };
}
const bucket = (h, month, id = 'spark3') => h.saved().wallMonthly.months[month].nodes[id];

test('a changing wall reading splits its trapezoid at Los Angeles midnight, not UTC midnight', () => {
  const h = fixture(), a = time('2026-12-01T07:59:30Z');
  h.sample(a, { spark3: 100 }); h.sample(a + 60000, { spark3: 300 });
  near(bucket(h, '2026-11').kWh, 150 * 30 / 3.6e6);
  near(bucket(h, '2026-12').kWh, 250 * 30 / 3.6e6);
  assert.equal(bucket(h, '2026-11').coverageSeconds, 30);
  assert.equal(bucket(h, '2026-12').coverageSeconds, 30);
  assert.equal(h.view().wallMonthly.currentMonth, '2026-12');
  assert.deepEqual(h.view().wallMonthly.months.map(m => m.month), ['2026-12', '2026-11']);
  near(h.saved().nodes.spark3.wallKWh, 200 * 60 / 3.6e6, 1e-9);
});

test('month boundaries use the real local offset through spring, fall and New Year', () => {
  const h = fixture();
  for (const [month, expected] of [['2026-03', '2026-03-01T08:00:00Z'], ['2026-04', '2026-04-01T07:00:00Z'],
    ['2026-11', '2026-11-01T07:00:00Z'], ['2026-12', '2026-12-01T08:00:00Z']]) {
    assert.equal(h.wallMonthStart(month), time(expected));
    assert.equal(h.wallMonthAt(time(expected)), month);
  }
  assert.equal(h.wallMonthStart('2026-12', true), time('2027-01-01T08:00:00Z'));
});

test('spring skipped hours and fall repeated hours count elapsed seconds once', () => {
  for (const at of ['2026-03-08T09:59:30Z', '2026-11-01T08:59:30Z']) {
    const h = fixture({ at }), a = time(at);
    h.sample(a, { spark3: 60 }); h.sample(a + 60000, { spark3: 60 });
    const e = bucket(h, h.wallMonthAt(a));
    assert.equal(e.coverageSeconds, 60); near(e.kWh, .001);
  }
});

test('midmonth recording is partial, unavailable is null, and genuine zero wall readings stay zero', () => {
  const h = fixture({ ids: ['spark1', 'spark3'] }), a = time('2026-11-18T20:00:00Z');
  h.sample(a, {});
  assert.equal(h.view().wallMonthly.months[0].kWh, null, 'GPU watts are never substituted');
  h.sample(a + 30000, { spark1: 0, spark3: 0 }); h.sample(a + 60000, { spark1: 0, spark3: 0 });
  const m = h.view().wallMonthly.months[0];
  assert.equal(m.kWh, 0); assert.equal(m.partial, true);
  assert.equal(m.bySpark.spark1.kWh, 0, 'a read-only hub meter counts too');
  assert.equal(m.recordedSince, iso(a + 30000));
});

test('a month covered from its boundary can be complete while one missing plug makes it partial', () => {
  const a = time('2026-12-01T08:00:00Z'), h = fixture();
  h.sample(a, { spark3: 60 }); h.sample(a + 60000, { spark3: 60 });
  assert.equal(h.view().wallMonthly.months[0].partial, false);
  const missing = fixture({ ids: ['spark1', 'spark3'] });
  missing.sample(a, { spark3: 60 }); missing.sample(a + 60000, { spark3: 60 });
  assert.equal(missing.view().wallMonthly.months[0].partial, true);
});

test('cached timestamps add nothing twice; missing readings, long gaps, plug changes and a backward clock never bridge', () => {
  const h = fixture(), a = time('2026-11-18T20:00:00Z');
  h.sample(a, { spark3: 60 });
  h.sample(a + 30000, { spark3: { watts: 60, at: iso(a) } });
  assert.equal(h.view().wallMonthly.months[0].kWh, null);
  h.sample(a + 60000, { spark3: 60 });
  near(bucket(h, '2026-11').kWh, .001);
  h.sample(a + 300000, { spark3: 60 });
  h.sample(a + 330000, {});
  h.sample(a + 360000, { spark3: 60 });
  h.sample(a + 390000, { spark3: { watts: 60, plug: 99 } });
  h.sample(a + 370000, { spark3: { watts: 60, plug: 99 } });
  near(bucket(h, '2026-11').kWh, .001);
  h.sample(a + 420000, { spark3: { watts: 60, plug: 99 } });
  near(bucket(h, '2026-11').kWh, .0015);
  assert.equal(bucket(h, '2026-11').coverageSeconds, 90);
});

test('a restart retains buckets and last observations without recounting or resetting lifetime totals', () => {
  const a = time('2026-11-30T20:00:00Z'), first = fixture();
  first.sample(a, { spark3: 60 }); first.sample(a + 60000, { spark3: 60 });
  const second = fixture({ seed: first.saved() });
  second.sample(a + 60000, { spark3: 60 });
  near(bucket(second, '2026-11').kWh, .001);
  second.sample(a + 90000, { spark3: 60 });
  near(bucket(second, '2026-11').kWh, .0015);
  const lifetime = second.saved().nodes.spark3.wallKWh, writes = second.saves();
  second.clock('2026-12-01T08:00:00Z');
  const view = second.view().wallMonthly;
  assert.equal(view.currentMonth, '2026-12'); assert.equal(view.months[0].kWh, null);
  assert.equal(view.months[1].month, '2026-11'); assert.equal(second.saves(), writes, 'reading creates no empty history');
  assert.equal(second.saved().nodes.spark3.wallKWh, lifetime);
  second.sample('2026-12-01T08:01:00Z', { spark3: 60 });
  assert.equal(second.view().wallMonthly.months[0].kWh, null, 'restart/day-long gap is not assigned to December');
});

test('legacy energy wholly within one month migrates once and remains partial, without overlapping new observations', () => {
  const a = time('2026-11-18T20:00:00Z');
  const seed = { since: iso(a - 60000), nodes: { spark3: { kWh: 9, coverageSeconds: 60, last: null,
    wallKWh: .001, wallCoverageSeconds: 60, wallSince: iso(a - 60000), wallLast: { t: a, w: 60 } } } };
  const h = fixture({ seed });
  h.sample(a + 30000, { spark3: 60 });
  near(bucket(h, '2026-11').kWh, .001); assert.equal(h.view().wallMonthly.months[0].partial, true);
  h.sample(a + 60000, { spark3: 60 }); near(bucket(h, '2026-11').kWh, .0015);
  const next = fixture({ seed: h.saved() });
  next.sample(a + 60000, { spark3: 60 }); near(bucket(next, '2026-11').kWh, .0015);
  assert.ok(next.saved().nodes.spark3.kWh >= 9, 'GPU lifetime counter survives');
});

test('spanning, missing-endpoint and invalid legacy totals stay unallocated while the original counters survive', () => {
  const now = time('2026-11-18T20:00:00Z');
  for (const extra of [
    { wallSince: '2026-10-31T20:00:00Z', wallLast: { t: now - 60000, w: 60 } },
    { wallSince: '2026-11-01T10:00:00Z', wallLast: null },
    { wallSince: 'not a date', wallLast: { t: now - 60000, w: 60 } },
    { wallSince: '2026-11-01T10:00:00Z', wallLast: { t: now + 60000, w: 60 } },
  ]) {
    const seed = { since: '2026-10-31T20:00:00Z', nodes: { spark3: { kWh: 0, coverageSeconds: 0, wallKWh: .5,
      wallCoverageSeconds: 60, ...extra } } }, h = fixture({ seed });
    h.sample(now, {});
    assert.equal(h.view().wallMonthly.months[0].kWh, null);
    assert.equal(h.saved().nodes.spark3.wallKWh, .5);
    assert.deepEqual(Object.keys(h.saved().wallMonthly.months), []);
  }
});

test('unknown or malformed month history preserves its file and still answers fleet status and owner power', async () => {
  for (const seed of [
    { since: null, nodes: {}, wallMonthly: { version: 2, timeZone: 'America/Los_Angeles', months: {}, last: {} } },
    { since: null, nodes: {}, wallMonthly: { version: 1, timeZone: 'America/Los_Angeles', months: { broken: { expected: [], nodes: {} } }, last: {} } },
    { since: null, nodes: { 'removed-spark': null }, wallMonthly: { version: 1, timeZone: 'America/Los_Angeles', months: {}, last: {} } },
  ]) {
    const h = fixture({ seed });
    const status = await h.collectStatus();
    assert.equal(status.nodes[0].state, 'online');
    const owner = await h.statusFor({ role: 'owner' }, false);
    assert.ok(owner.power); assert.match(owner.energy.wallMonthly.problem, /could not be read/);
    assert.equal(owner.energy.wallMonthly.months[0].kWh, null);
    assert.deepEqual(h.saved(), seed); assert.equal(h.saves(), 0);
    const calls = h.powerReads(), other = await h.statusFor({ role: 'guest' }, false);
    assert.equal(other.energy, undefined); assert.equal(other.power, undefined); assert.equal(h.powerReads(), calls);
    h.replaceSaved({ since: null, nodes: {} });
    await h.collectStatus(); assert.equal(h.view().wallMonthly.problem, undefined, 'a repaired file can be read again');
  }
});

test('monthly code changes invalidate both start workflows through their real dependency lists', () => {
  const source = readFileSync(new URL('../service/src/18-workflows.mjs', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('const CONTEXT_CODE ='), source.indexOf('// Which versions passed the whole test suite.'));
  const names = new Set([...code.matchAll(/(?:=>|\bof) \[([\s\S]*?)\]/g)]
    .flatMap(m => [...m[1].matchAll(/\b[A-Za-z_$][\w$]*\b/g)].map(n => n[0])));
  const context = Object.fromEntries([...names].map(n => [n, function unchanged() {}]));
  Object.assign(context, { createHash, START_FAILURES: [], ENGINES: {}, WORKER_SOURCE: '',
    ACTIONS: new Map(['start_model', 'stop_model', 'find_setups', 'restart_model'].map(n => [n, { run() {}, input: {}, description: n }])) });
  const world = vm.createContext(context); vm.runInContext(code, world);
  const versions = () => JSON.parse(vm.runInContext('workflowVersions.clear(); JSON.stringify(Object.fromEntries(WORKFLOWS.map(w => [w.id, workflowVersion(w.id)])))', world));
  const before = versions();
  for (const name of ['WALL_ENERGY_ZONE', 'wallMonthFormatter', 'wallMonthParts', 'wallMonthAt', 'wallMonthStart', 'wallMonthBucket',
    'wallMonthState', 'addWallMonthInterval', 'sampleWallMonths', 'wallMonthlyView', 'addEnergy', 'powerView']) {
    assert.ok(names.has(name), `${name} must be versioned`);
    const previous = world[name]; world[name] = function changed() { return 'changed'; };
    const after = versions();
    for (const id of ['start_model', 'start_model_across']) assert.notEqual(after[id], before[id], name);
    world[name] = previous;
  }
});

const plugs = await startPlugs([{ node_id: 3, available: true, attributes: { '1/6/0': true, '1/144/8': 0, '1/144/4': 120000, '1/144/5': 0 } }]);
after(() => plugs.close());
useFleet({ statusMs: 1000, env: { SPARK_CONSOLE_PLUGS_URL: plugs.url, SPARK_CONSOLE_PLUGS_MS: '200' },
  prepare: ({ stateDir }) => {
    writeFileSync(join(stateDir, 'plugs.json'), JSON.stringify({ spark3: { node: 3 } }), { mode: 0o600 });
    writeFileSync(join(stateDir, 'power.json'), JSON.stringify({ idleMinutes: 0, off: {} }), { mode: 0o600 });
  } });

test('the real owner status exposes monthly electricity and existing power state without switching a plug', async () => {
  const r = await api('/status?fresh=1');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.energy.wallMonthly.timeZone, 'America/Los_Angeles');
  assert.equal(r.json.energy.wallMonthly.currentMonth, fixture().wallMonthAt(Date.now()));
  assert.ok(r.json.energy.wallMonthly.months.some(m => m.month === r.json.energy.wallMonthly.currentMonth));
  assert.ok(r.json.power.switchable.includes('spark3')); assert.equal(typeof r.json.power.bySpark.spark3.state, 'string');
  const file = join(T.fleet.stateDir, 'energy.json');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).wallMonthly.version, 1);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(plugs.commands, []);
});
