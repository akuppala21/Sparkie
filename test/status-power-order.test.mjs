// Covers: collectStatus and statusFor order a confirmed power cut against each status probe, including replies or
// other nodes that finish late, controller cache lag, later online evidence, repeated cuts and wall-clock changes.
// waitAndCut records only a successful operation; legacy, unfinished and failed cuts preserve existing reporting.
// fleet_status agrees with the shared status view; private probe evidence never leaves it. Both start workflow
// versions change with the status ordering helpers that pickVersion calls. Direct source fixture.
import './file-limit.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const parts = Object.fromEntries(['12-status', '16-reads', '18-workflows', '21-power'].map(name => [name,
  readFileSync(new URL(`../service/src/${name}.mjs`, import.meta.url), 'utf8')]));
function section(name, start, end) {
  const source = parts[name], first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `load production ${name}: ${start}`);
  return source.slice(first, last);
}
const source = [
  section('21-power', 'function powerState(', '// A Spark Spark Console powered off (or is powering off)'),
  section('21-power', 'const offBy =', '// The setting and what may be switched'),
  section('21-power', 'async function waitAndCut(', '// Turning Sparks on (a job'),
  section('12-status', 'const STATUS_KEYS =', 'setTimeout(() => {\n  collectStatus()'),
  section('16-reads', "action({\n  name: 'fleet_status'", "action({\n  name: 'running_models'"),
  `sampleEnergy = () => {};
   ({collectStatus, statusFor, waitAndCut, offRecord, rawCache: () => statusCache})`,
].join('\n');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const check = (name, run) => test(name, { timeout: 3000 }, run);

function fixture() {
  let now = Date.parse('2026-11-18T08:00:00.000Z'), state = { off: {} };
  const nodes = [{ id: 'spark2', name: 'Spark 2' }, { id: 'spark4', name: 'Spark 4' }];
  const replies = new Map(), actions = new Map(), calls = [], observations = [], events = [];
  const controls = {
    wall: { answering: true, on: true, watts: 5 },
    switch: async () => ({ answering: true, on: false, watts: 0 }),
  };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const raw = { gpuUtilization: 55, temperature: 52, gpuPowerWatts: 20.1, runningContainers: [] };
  const api = vm.runInNewContext(source, {
    Date: Clock, NODES: nodes, STATE_DIR: '/unused', POWER_FILE: '/unused/power.json', STATUS_EVERY: 30000,
    IDLE_DEFAULT_MINUTES: 30, POWER_OFF_WAIT_MS: 1000, POWER_POLL_MS: 1, SHUT_DOWN_WATTS: 15,
    POWER_WHY: { asked: 'asked' },
    readKept: () => structuredClone(state),
    writePrivate: (_path, value) => { state = structuredClone(value); },
    refreshNodes: async () => {},
    runWorker: async (node, payload) => {
      assert.equal(payload.action, 'status');
      calls.push(node.id);
      const reply = replies.get(node.id);
      if (!reply) return { ...raw };
      replies.delete(node.id);
      reply.started.resolve();
      return reply.answer.promise;
    },
    wallFor: id => id === 'spark4' ? controls.wall : null,
    noteSparkStates: value => observations.push(value),
    tasksNow: () => [],
    nodeById: id => nodes.find(n => n.id === id),
    sparkWord: id => nodes.find(n => n.id === id)?.name || id,
    atWords: at => String(at), nameShown: name => name,
    asleepView: () => Object.keys(state.off).map(spark => ({ spark, words: `${spark} is asleep on purpose.` })),
    answersNow: async () => false,
    freshWall: async () => ({ answering: true, on: true, watts: 5 }),
    holdLow: async () => null,
    switchPlug: async (id, on) => { assert.equal(id, 'spark4'); assert.equal(on, false); return controls.switch(); },
    sleep: () => { throw new Error('fixture unexpectedly needed another power poll'); },
    minutesWords: ms => String(ms), step: () => {}, note: () => {},
    fleetEvent: event => events.push(event),
    action: value => actions.set(value.name, value),
    needsLines: () => [], knowledge: { sparks: {} }, darkNow: () => ({}),
    wallView: w => w && ({ plugOn: w.on, watts: w.watts }), wallWords: () => null,
    lastReading: () => null, gbOfGiB: value => value ?? null, powerView: () => ({}),
  }, { filename: 'status-power-order-production.mjs' });
  return {
    ...api, controls, calls, observations, events, raw,
    setClock(value) { now = value; },
    saved: () => structuredClone(state),
    beginOff(extra = {}) { api.offRecord('spark4', { at: new Clock().toISOString(), why: 'asked', parked: ['spark4/model'], plugCut: false, cutOperation: null, problem: null, ...extra }); },
    cut: id => api.waitAndCut({ id }, 'spark4', true, {}),
    pause(id = 'spark4') {
      const reply = { started: deferred(), answer: deferred() };
      replies.set(id, reply);
      return reply;
    },
    view: () => api.statusFor({ role: 'owner' }, false),
    fleet: () => actions.get('fleet_status').run({}, { role: 'owner' }),
  };
}
const four = view => view.nodes.find(n => n.id === 'spark4');
const fleetFour = view => view.sparks.find(n => n.id === 'spark4');

check('a confirmed cut replaces cached online status immediately, even while the plug cache still says on', async () => {
  const h = fixture();
  await h.collectStatus();
  h.beginOff();
  await h.cut('cut-a');
  const count = h.calls.length, view = await h.view(), row = four(view);
  assert.equal(h.controls.wall.on, true, 'the asynchronous plug refresh has not happened');
  assert.equal(row.state, 'unreachable');
  assert.equal(row.reachable, false);
  assert.equal(row.asleep, true);
  assert.equal(fleetFour(await h.fleet()).state, 'off');
  assert.equal(h.calls.length, count, 'reading adds no status or SSH probe');
  assert.equal(h.rawCache().value.nodes.find(n => n.id === 'spark4').state, 'online', 'raw watcher evidence is not rewritten');
  assert.equal(h.observations.at(-1).find(n => n.id === 'spark4').state, 'online');
  assert.equal(view.nodes.find(n => n.id === 'spark2').state, 'online', 'other Sparks are unchanged');
  assert.ok(!JSON.stringify(view).includes('powerCutSeen'), 'private probe marker is stripped');
  assert.ok(!JSON.stringify(view).includes('cutOperation'), 'internal operation ordering is not public status');
});

check('an old successful probe that returns after the cut is still reported off', async () => {
  const h = fixture(), pending = h.pause();
  const collecting = h.collectStatus();
  await pending.started.promise;
  h.beginOff();
  await h.cut('cut-a');
  pending.answer.resolve(h.raw);
  await collecting;
  assert.equal(four(await h.view()).asleep, true);
  assert.equal(fleetFour(await h.fleet()).state, 'off');
});

check('another slow Spark cannot make an earlier online sample look newer than the cut', async () => {
  const h = fixture(), other = h.pause('spark2'), target = h.pause();
  const collecting = h.collectStatus();
  await Promise.all([other.started.promise, target.started.promise]);
  target.answer.resolve(h.raw);
  h.beginOff();
  await h.cut('cut-a');
  h.setClock(Date.parse('2026-11-18T08:00:10.000Z'));
  other.answer.resolve(h.raw);
  await collecting;
  assert.equal(four(await h.view()).state, 'unreachable');
  assert.equal(h.rawCache().at, Date.parse('2026-11-18T08:00:10.000Z'), 'batch finished after the cut');
});

check('a probe begun after the cut proves online even with an old off reading and a backward clock', async () => {
  const h = fixture();
  await h.collectStatus();
  h.beginOff();
  await h.cut('cut-a');
  h.controls.wall = { answering: true, on: false, watts: 0 };
  h.setClock(Date.parse('2026-11-17T08:00:00.000Z'));
  await h.collectStatus();
  const row = four(await h.view());
  assert.equal(row.state, 'online');
  assert.equal(row.reachable, true);
  assert.equal(row.asleep, false);
  assert.equal(fleetFour(await h.fleet()).state, 'online');
  assert.equal(h.saved().off.spark4.plugCut, true, 'the power round has not yet cleared its record');
});

check('repeated cuts in the same clock tick supersede probes begun after the earlier cut', async () => {
  const h = fixture();
  h.beginOff();
  await h.cut('cut-a');
  const pending = h.pause(), collecting = h.collectStatus();
  await pending.started.promise;
  h.beginOff();
  await h.cut('cut-b');
  pending.answer.resolve(h.raw);
  await collecting;
  assert.equal(four(await h.view()).state, 'unreachable');
  assert.equal(h.saved().off.spark4.cutOperation, 'cut-b');
  await h.collectStatus();
  assert.equal(four(await h.view()).state, 'online', 'a new probe after the second cut can prove a second wake');
});

check('removing the off record after a wake immediately releases the cached online reading', async () => {
  const h = fixture();
  await h.collectStatus();
  h.beginOff();
  await h.cut('cut-a');
  assert.equal(four(await h.view()).state, 'unreachable');
  h.offRecord('spark4', null);
  const row = four(await h.view());
  assert.equal(row.state, 'online');
  assert.equal(row.poweredOff, undefined);
  assert.equal(row.asleep, undefined);
});

check('legacy, malformed and unconfirmed cut records never infer off from a plug reading alone', async () => {
  for (const record of [
    { plugCut: true },
    { plugCut: true, cutOperation: null },
    { plugCut: true, cutOperation: '' },
    { plugCut: true, cutOperation: 5 },
    { plugCut: true, cutOperation: {} },
    { plugCut: false, cutOperation: 'unfinished-cut' },
  ]) {
    const h = fixture();
    await h.collectStatus();
    h.beginOff(record);
    h.controls.wall = { answering: true, on: false, watts: 0 };
    assert.equal(four(await h.view()).state, 'online', JSON.stringify(record));
    assert.equal(fleetFour(await h.fleet()).state, 'online');
  }
});

check('a confirmed cut stays authoritative with no current plug mapping or with an unavailable reading', async () => {
  const h = fixture();
  await h.collectStatus();
  h.beginOff();
  await h.cut('cut-a');
  for (const wall of [null, { answering: false, on: null, watts: null }, { answering: true, on: false, watts: 0 }]) {
    h.controls.wall = wall;
    assert.equal(four(await h.view()).asleep, true, JSON.stringify(wall));
    assert.equal(fleetFour(await h.fleet()).state, 'off');
  }
});

check('a problem after a confirmed cut remains a problem, never healthy sleep', async () => {
  const h = fixture();
  await h.collectStatus();
  h.beginOff();
  await h.cut('cut-a');
  h.offRecord('spark4', { problem: 'Turning it on did not work.' });
  const row = four(await h.view()), fleet = fleetFour(await h.fleet());
  assert.equal(row.state, 'unreachable');
  assert.equal(row.asleep, false);
  assert.equal(row.poweredOff.asleep, null);
  assert.equal(fleet.offOnPurpose.problem, 'Turning it on did not work.');
  assert.equal(fleet.offOnPurpose.asleep, null);
});

check('waitAndCut saves its operation only after the switch is confirmed and keeps the original shutdown record', async () => {
  const h = fixture(), switching = deferred(), started = deferred();
  await h.collectStatus();
  h.beginOff();
  const original = h.saved().off.spark4;
  h.controls.switch = () => { started.resolve(); return switching.promise; };
  const cutting = h.cut('cut-a');
  await started.promise;
  assert.equal(h.saved().off.spark4.cutOperation, null);
  assert.equal(four(await h.view()).state, 'online');
  switching.resolve({ answering: true, on: false, watts: 0 });
  await cutting;
  const saved = h.saved().off.spark4;
  assert.equal(saved.cutOperation, 'cut-a');
  assert.equal(saved.plugCut, true);
  assert.equal(saved.at, original.at);
  assert.deepEqual(saved.parked, original.parked);
  assert.equal(four(await h.view()).asleep, true);
  assert.equal(h.events.at(-1).type, 'spark-powered-off');
});

check('a failed switch does not claim a completed cut or hide cached online status', async () => {
  const h = fixture();
  await h.collectStatus();
  h.beginOff();
  h.controls.switch = async () => { throw new Error('plug did not confirm'); };
  await assert.rejects(h.cut('cut-a'), /plug did not confirm/);
  assert.equal(h.saved().off.spark4.cutOperation, null);
  assert.equal(h.saved().off.spark4.plugCut, false);
  assert.equal(four(await h.view()).state, 'online');
  assert.equal(h.events.length, 0);
});

check('changing any status ordering helper changes both start workflow versions and no unrelated workflow', () => {
  // Execute the real dependency lists and fingerprint function. Other workflow bodies are inert stand-ins: the
  // fingerprint only stringifies them, and no workflow or service is started by this fixture.
  const workflows = section('18-workflows', 'const CONTEXT_CODE =', '// Which versions passed the whole test suite.');
  const names = new Set([...workflows.matchAll(/(?:=>|\bof) \[([\s\S]*?)\]/g)]
    .flatMap(match => [...match[1].matchAll(/\b[A-Za-z_$][\w$]*\b/g)].map(name => name[0])));
  const context = Object.fromEntries([...names].map(name => [name, function unchangedDependency() {}]));
  Object.assign(context, {
    createHash, START_FAILURES: [], ENGINES: {}, WORKER_SOURCE: '',
    ACTIONS: new Map(['start_model', 'stop_model', 'find_setups', 'restart_model'].map(name => [name,
      { run: function unchangedAction() {}, input: {}, description: name }])),
  });
  const world = vm.createContext(context);
  const realHelpers = ['statusFor', 'collectStatus', 'powerCutOperation', 'powerState'];
  for (const name of realHelpers) {
    const part = name.startsWith('power') ? parts['21-power'] : parts['12-status'];
    const match = new RegExp(`^(?:async )?function ${name}\\([^]*?^}`, 'm').exec(part);
    assert.ok(match, `load actual ${name}`);
    vm.runInContext(match[0], world);
  }
  vm.runInContext(workflows, world);
  const versions = () => JSON.parse(vm.runInContext(`workflowVersions.clear();
    JSON.stringify(Object.fromEntries(WORKFLOWS.map(w => [w.id, workflowVersion(w.id)])))`, world));
  const before = versions();
  for (const name of [...realHelpers, 'powerMark', 'cleanStatus', 'runWorker', 'refreshNodes', 'wallFor',
    'sampleEnergy', 'noteSparkStates', 'energyView', 'tasksNow']) {
    const original = world[name];
    world[name] = function changedStatusDependency() { return 'changed'; };
    const after = versions();
    for (const id of ['start_model', 'start_model_across']) assert.notEqual(after[id], before[id], `${name} must invalidate ${id}`);
    for (const id of ['stop_model', 'find_setups', 'restart_model']) assert.equal(after[id], before[id], `${name} does not affect ${id}`);
    world[name] = original;
  }
});
