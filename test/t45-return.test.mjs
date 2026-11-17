// Covers: T45 durable compensation authority. These source-level tests drive the real coordinator against controlled
// Docker facts, strict state failures, whole old-pair claims, owner tombstones and changed resource conditions.
// They do not start the service or touch a real Spark. t45-fleet.test.mjs covers the actual service and stand-in boundary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { randomBytes } from 'node:crypto';

const stopSource = readFileSync(new URL('../service/src/17-stop-checked.mjs', import.meta.url), 'utf8');
const backUnitsSource = stopSource.match(/^function backUnits\(items\) \{[\s\S]*?^\}/m)[0];
const source = ['17-rollback-target.mjs', '17-rollback.mjs'].map(file => readFileSync(new URL(`../service/src/${file}`, import.meta.url), 'utf8')).join('\n');
const ID = '123456789abc', SINCE = '2026-11-17T00:00:00.000Z';
const receipt = (id, name, state = 'exited') => ({ id: id.repeat(64).slice(0, 64), name, state, startedAt: SINCE, labels: {}, memory: 20e9 });
const original = (spark, name, hex = 'a', wasRunning = true) => ({ spark, container: name, original: { id: hex.repeat(64), startedAt: SINCE }, aside: `${name}-before-${ID}`, listed: null, wasRunning, need: 20e9, state: 'waiting' });
function record(members = [original('spark3', 'sc-old')]) {
  return { kind: 'start-rollback', operation: ID, since: SINCE, chat: null, phase: 'returning', targets: [...new Set(members.map(m => m.spark))], units: [{ id: 'abcdef123456', members }], attempts: [] };
}
function harness(initial = record()) {
  let state = { runs: initial ? { [ID]: structuredClone(initial) } : {} }, failWrite = false;
  const events = [], calls = [], containers = new Map(), busy = new Map(), available = new Map(), blocked = new Set(), desired = { revision: 1, revisions: [], running: [] };
  for (const m of initial?.units.flatMap(u => u.members) || []) containers.set(m.original.id, { ...receipt(m.original.id[0], m.container), spark: m.spark });
  const fields = (out, tag) => out.split('\n').filter(l => l.startsWith(tag + '\t')).map(l => l.split('\t').slice(1));
  const env = {
    STATE_DIR: '/fake/state', openSync: () => 1, fsyncSync: () => {}, closeSync: () => {},
    NAME_RE: /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/, computeSparks: () => ['spark3', 'spark4'], SAVED_RUNS_FILE: 'saved-runs.json',
    savedRunsNow: () => structuredClone(state), writePrivate: (_, next) => { if (failWrite) throw new Error('disk full'); state = structuredClone(next); },
    randomBytes, Date, performance, JSON, Buffer, Symbol, console, Number, Set, Map,
    nodeById: id => ['spark3', 'spark4'].includes(id) ? { id } : null, sparkName: n => n.id,
    notBrainsSpark: ids => { if (ids.some(x => !['spark3', 'spark4'].includes(x))) throw new Error('hub'); },
    claimSparks: ids => { if (ids.some(x => busy.has(x))) throw new Error('busy'); ids.forEach(x => busy.set(x, true)); calls.push(['claim', ...ids]); return () => ids.forEach(x => busy.delete(x)); },
    desired: () => structuredClone(desired), keyOf: x => `${x.spark}/${x.container}`, fields,
    gpuUsersScript: () => 'gpu-look', run: async () => ({ code: 0, out: 'rollback-docker\tok\nrollback-gpu\tok\n', err: '' }),
    memNow: async n => ({ total: 128e9, available: available.get(n.id) ?? 100e9 }), HEADROOM: 8 * 2 ** 30,
    STOPPED_STATES: ['exited', 'dead', 'created', 'missing'], runsRan: new Map(), consoleStopped: new Map(),
    jobMountsReal: () => 'true', jobNotReal: () => new Error('job folder is a link'),
    note: (j, line) => { (j.log ||= []).push(line); events.push(line); }, sleep: async () => {}, q: x => `'${x}'`,
    agentSettings: () => ({ halted: false, selfHeal: false }), jobs: new Map(), busySparks: busy, consoleOff: () => false,
    runAction: async (...args) => { calls.push(['action', ...args]); return { outcome: 'started' }; }, healOwner: () => ({ login: 'owner' }),
    savedRunWords: e => e.message, owedWords: () => [], selfTestRollbackStopped: () => {},
  };
  runInNewContext(backUnitsSource + '\n' + source + '\nglobalThis.api = { rollbackShape, rollbackWrite, rollbackPrepare, rollbackReturn, rollbackSupersede, rollbackPass, rollbackHeld, rollbackCommand, rollbackLook, rollbackTransfer, rollbackOwned };', env);
  env.rollbackLook = async (spark, ref) => {
    const x = containers.get(ref) || [...containers.values()].find(x => x.spark === spark && x.name === ref);
    return x ? structuredClone(x) : null;
  };
  env.rollbackFence = async (_, spark) => !blocked.has(spark);
  // This coordinator fixture has no target producer. Its additional fence-state look must report the same
  // controlled boundary as rollbackFence; the late-outcome fixture exercises the real reconciliation protocol.
  env.rollbackFenceState = async (r, spark) => {
    const clear = await env.rollbackFence(r, spark);
    return { fenced: clear, clear, active: false, unresolved: state.runs[ID].attempts.flatMap(a => a.commands).filter(c => c.spark === spark && !c.result?.terminal) };
  };
  env.rollbackOwned = async () => [];
  env.rollbackCommand = async (job, spark, action, name, expected, extra = {}) => {
    calls.push([action, spark, name, expected?.id]);
    const x = containers.get(expected?.id);
    if (!x) throw new Error('missing original');
    if (action === 'rename') x.name = extra.to;
    if (action === 'start') { if (env.failStart === spark) throw new Error('start failed'); x.state = 'running'; x.startedAt = '2026-11-17T00:01:00.000Z'; }
    if (action === 'stop') x.state = 'exited';
    if (action === 'remove') containers.delete(expected.id);
    const f = state.runs[ID];
    f.attempts.push({ id: randomBytes(6).toString('hex'), boots: {}, commands: [{ id: randomBytes(6).toString('hex'), spark, action, name, expected,
      result: { terminal: true, boot: 'boot-1', code: 0, seen: structuredClone(x) } }] });
    return { terminal: true, boot: 'boot-1', code: 0, seen: structuredClone(x) };
  };
  const job = () => ({ id: 'bbbbbbbbbbbb', rollbackSource: ID, log: [] });
  return { env, api: env.api, events, calls, containers, busy, available, blocked, desired, job, read: () => structuredClone(state), fail: value => { failWrite = value; } };
}

test('T45 strict record shape rejects unknown targets, hub members, malformed result and unsupported authority kinds', () => {
  const h = harness(); assert.equal(h.api.rollbackShape(record()), true);
  for (const damage of [r => { r.targets = ['hub']; }, r => { r.targets = null; }, r => { r.units[0].members[0].spark = 'hub'; },
    r => { delete r.units[0].members[0].original.startedAt; }, r => { r.wishes = ['hub/sc-old']; },
    r => { r.attempts = [{ id: 'cccccccccccc', boots: {}, commands: [{ id: 'dddddddddddd', spark: 'spark3', action: 'run', name: 'sc-new', expected: null, result: { terminal: 'yes', boot: 'boot' } }] }]; }]) {
    const r = record(); damage(r); assert.equal(h.api.rollbackShape(r), false, JSON.stringify(r));
  }
});

test('strict save failure happens before stop, rename, run, or target mutation and releases additional old-pair claims', async () => {
  const h = harness(null); h.fail(true); h.busy.set('spark3', true);
  const inv = { library: [{ name: 'old', sizeBytes: 20e9 }], sparks: ['spark3', 'spark4'].map((id, i) => ({ id, deployments: [{ container: i ? 'sc-old-part2' : 'sc-old', model: 'old', cluster: 'spark3+spark4' }] })) };
  for (const [i, spark] of ['spark3', 'spark4'].entries()) h.containers.set((i ? 'b' : 'a').repeat(64), { ...receipt(i ? 'b' : 'a', i ? 'sc-old-part2' : 'sc-old', 'running'), spark });
  await assert.rejects(h.api.rollbackPrepare({ id: ID, createdAt: SINCE }, ['spark3'], ['spark3/sc-old'], inv), /disk full/);
  assert.deepEqual(h.calls, [['claim', 'spark4']]); assert.equal(h.busy.has('spark4'), false); assert.equal(h.busy.has('spark3'), true);
  assert.ok([...h.containers.values()].every(x => x.state === 'running'));
});

test('independent healthy originals return immediately; an unanswered mate returns on a later pass without rerunning the failed model', async () => {
  const r = record(); r.targets.push('spark4'); r.units.push({ id: 'eeeeeeeeeeee', members: [original('spark4', 'sc-other', 'b')] });
  const h = harness(r); h.blocked.add('spark4');
  const first = h.job(); await h.api.rollbackReturn(first);
  assert.equal(h.containers.get('a'.repeat(64)).state, 'running'); assert.equal(h.containers.get('b'.repeat(64)).state, 'exited'); assert.ok(h.read().runs[ID]);
  h.blocked.clear(); await h.api.rollbackReturn(h.job());
  assert.equal(h.containers.get('b'.repeat(64)).state, 'running'); assert.equal(h.read().runs[ID], undefined);
  assert.equal(h.calls.filter(x => x[0] === 'start' && x[1] === 'spark3').length, 1);
  await h.api.rollbackReturn(h.job()); assert.equal(h.calls.filter(x => x[0] === 'start').length, 2, 'repeated passes do no extra work');
  assert.equal(h.calls.filter(x => x[0] === 'run').length, 0);
});

test('a prior pair waits whole, and a failed second restore checked-stops its first restored part', async () => {
  const h = harness(record([original('spark3', 'sc-old'), original('spark4', 'sc-old-part2', 'b')]));
  h.blocked.add('spark4'); await h.api.rollbackReturn(h.job()); assert.equal(h.calls.filter(x => x[0] === 'start').length, 0);
  h.blocked.clear(); h.env.failStart = 'spark4'; await h.api.rollbackReturn(h.job());
  assert.equal(h.containers.get('a'.repeat(64)).state, 'exited'); assert.ok(h.calls.some(x => x[0] === 'stop' && x[1] === 'spark3')); assert.ok(h.read().runs[ID]);
});

test('a same-name original set aside is returned by exact ID; one originally stopped stays stopped', async () => {
  const h = harness(record([original('spark3', 'sc-old', 'a', false)]));
  h.containers.get('a'.repeat(64)).name = `sc-old-before-${ID}`;
  await h.api.rollbackReturn(h.job());
  assert.equal(h.containers.get('a'.repeat(64)).name, 'sc-old'); assert.equal(h.containers.get('a'.repeat(64)).state, 'exited');
  assert.equal(h.calls.filter(x => x[0] === 'start').length, 0); assert.equal(h.read().runs[ID], undefined);
});

test('fresh memory pressure and unrelated GPU work hold restoration until safe, without stopping other work', async () => {
  const h = harness(); h.available.set('spark3', 22e9); await h.api.rollbackReturn(h.job());
  assert.equal(h.calls.filter(x => x[0] === 'start').length, 0); assert.ok(h.read().runs[ID]);
  h.available.set('spark3', 100e9); h.env.run = async () => ({ code: 0, out: 'gpu\t123\t4096\tother\tunrelated\nrollback-docker\tok\nrollback-gpu\tok\n' });
  await h.api.rollbackReturn(h.job()); assert.equal(h.calls.filter(x => x[0] === 'start' || x[0] === 'stop').length, 0);
  h.env.run = async () => ({ code: 0, out: 'rollback-docker\tok\nrollback-gpu\tok\n' }); await h.api.rollbackReturn(h.job());
  assert.equal(h.containers.get('a'.repeat(64)).state, 'running');
});

test('replacement identity and newer desired generation supersede an old restore', async () => {
  for (const change of ['id', 'since']) {
    const r = record(); r.units[0].members[0].listed = { spark: 'spark3', container: 'sc-old', since: SINCE };
    const h = harness(r); h.desired.running.push({ spark: 'spark3', container: 'sc-old', since: change === 'since' ? '2026-11-18T00:00:00Z' : SINCE });
    if (change === 'id') { h.containers.delete('a'.repeat(64)); h.containers.set('c'.repeat(64), { ...receipt('c', 'sc-old', 'running'), spark: 'spark3' }); }
    await h.api.rollbackReturn(h.job()); assert.equal(h.calls.filter(x => x[0] === 'start' || x[0] === 'stop').length, 0); assert.equal(h.read().runs[ID], undefined);
  }
});

test('an owner stop/forget persists supersession even with no desired row; failed tombstone writes refuse authority changes', async () => {
  const h = harness(); h.fail(true); assert.throws(() => h.api.rollbackSupersede(['spark3/sc-old'], 'the owner forgot it'), /disk full/);
  assert.equal(h.read().runs[ID].units[0].members[0].state, 'waiting'); h.fail(false);
  h.api.rollbackSupersede(['spark3/sc-old'], 'the owner forgot it'); await h.api.rollbackReturn(h.job());
  assert.equal(h.calls.filter(x => x[0] === 'start').length, 0); assert.equal(h.read().runs[ID], undefined);
});

test('busy whole-unit claims defer dispatch, including unfinished attempts with no originals', async () => {
  const r = record(); r.units = []; const h = harness(r);
  h.busy.set('spark3', true); await h.api.rollbackPass(); assert.equal(h.calls.length, 0);
  assert.equal(h.api.rollbackHeld(['spark3']), true);
  h.busy.clear(); await h.api.rollbackPass(); assert.equal(h.calls.filter(x => x[0] === 'action').length, 1);
});

test('an owner stop during an unanswered restoration is settled after the final receipt, including a console restart', async () => {
  for (const restartBeforeReceipt of [false, true]) {
    const h = harness(), command = h.env.rollbackCommand;
    let receiptAfterLostObserver = null;
    h.env.rollbackCommand = async (...args) => {
      const result = await command(...args);
      if (args[2] === 'start') {
        receiptAfterLostObserver = structuredClone(result);
        const f = h.env.savedRunsNow(), c = f.runs[ID].attempts.at(-1).commands[0]; c.result = { terminal: false, boot: 'boot-1' }; h.env.writePrivate('', f);
        h.api.rollbackSupersede(['spark3/sc-old'], 'the owner stopped it');
        throw new Error('the observer lost its reply after Docker completed');
      }
      return result;
    };
    h.env.rollbackFence = async () => {
      const f = h.env.savedRunsNow(); let okay = true;
      for (const a of f.runs[ID].attempts) for (const c of a.commands) if (!c.result.terminal) {
        if (restartBeforeReceipt) okay = false; else c.result = structuredClone(receiptAfterLostObserver);
      }
      h.env.writePrivate('', f); return okay;
    };
    await h.api.rollbackReturn(h.job());
    if (!restartBeforeReceipt) {
      assert.equal(h.containers.get('a'.repeat(64)).state, 'exited'); assert.equal(h.read().runs[ID], undefined);
    } else {
      assert.ok(h.read().runs[ID], 'no retirement while the superseded original start is still uncertain');
      assert.equal(h.containers.get('a'.repeat(64)).state, 'running');
      const pending = h.read().runs[ID]; pending.attempts.at(-1).commands[0].result = structuredClone(receiptAfterLostObserver);
      const after = harness(pending); after.containers.set('a'.repeat(64), structuredClone(h.containers.get('a'.repeat(64))));
      await after.api.rollbackReturn(after.job());
      assert.equal(after.containers.get('a'.repeat(64)).state, 'exited'); assert.equal(after.read().runs[ID], undefined);
      assert.equal(after.calls.filter(x => x[0] === 'start').length, 0, 'the failed restoration is never replayed');
    }
  }
});

test('a stop on an old mate outside the new placement sees the entire claim and supersedes the whole restore unit', async () => {
  const h = harness(null), job = { id: ID, createdAt: SINCE, status: 'running', type: 'deploy', nodes: ['spark3'] };
  h.busy.set('spark3', true);
  const inv = { library: [{ name: 'old', sizeBytes: 20e9 }], sparks: ['spark3', 'spark4'].map((id, rank) => ({ id, deployments: [{ container: rank ? 'sc-old-part2' : 'sc-old', model: 'old', cluster: 'spark3+spark4' }] })) };
  for (const [rank, spark] of ['spark3', 'spark4'].entries()) h.containers.set((rank ? 'b' : 'a').repeat(64), { ...receipt(rank ? 'b' : 'a', rank ? 'sc-old-part2' : 'sc-old', 'running'), spark });
  await h.api.rollbackPrepare(job, ['spark3'], ['spark3/sc-old'], inv);
  const desiredSource = readFileSync(new URL('../service/src/20-desired.mjs', import.meta.url), 'utf8');
  const definitions = ['CHANGES_MODELS', 'holdsModelsOn'].map(name => desiredSource.match(new RegExp(`^const ${name} = .*;$`, 'm'))[0]).join('\n');
  const holds = new Function(`${definitions}\nreturn holdsModelsOn;`)(); assert.equal(holds(job, ['spark4']), true);
  h.api.rollbackSupersede(['spark4/sc-old-part2'], 'the owner stopped the old mate');
  assert.ok(h.read().runs[ID].units[0].members.every(m => m.state === 'superseded'));
  job.release(); assert.equal(h.busy.has('spark4'), false); assert.equal(h.busy.has('spark3'), true, 'the outer source claim remains its owner’s');
});

test('a restored job transfers its exact new start receipt to its still-running saved workflow before retirement', async () => {
  const h = harness(), workflow = 'dddddddddddd';
  const f = h.env.savedRunsNow(); f.runs[workflow] = { operation: workflow, started: [{ kind: 'job', spark: 'spark3', container: 'sc-old', seen: { id: 'a'.repeat(64), startedAt: SINCE } }] }; h.env.writePrivate('', f);
  await h.api.rollbackReturn(h.job());
  assert.equal(h.read().runs[workflow].started[0].seen.id, 'a'.repeat(64));
  assert.equal(h.read().runs[workflow].started[0].seen.startedAt, '2026-11-17T00:01:00.000Z'); assert.equal(h.read().runs[ID], undefined);
});

test('settled engine-check survivors are removed by exact receipt before a no-original obligation retires', async () => {
  const r = record(); r.units = [];
  const seen = { ...receipt('e', 'spark-console-engine-check'), spark: 'spark3', labels: { 'spark.operation': ID, 'spark.attempt': 'aaaaaaaaaaaa', 'spark.command': 'bbbbbbbbbbbb' } };
  r.attempts.push({ id: 'aaaaaaaaaaaa', boots: {}, commands: [{ id: 'bbbbbbbbbbbb', spark: 'spark3', action: 'run', name: seen.name, expected: null, result: { terminal: true, code: 0, boot: 'boot-1', seen } }] });
  const h = harness(r); h.env.ENGINE_CHECK_NAME = seen.name; h.containers.set(seen.id, structuredClone(seen)); h.env.rollbackOwned = async () => [structuredClone(seen)];
  await h.api.rollbackReturn(h.job());
  assert.equal(h.containers.has(seen.id), false); assert.equal(h.calls.filter(x => x[0] === 'remove').length, 1); assert.equal(h.read().runs[ID], undefined);
});

test('manual restart refuses a Spark whose earlier start still has an issued unanswered command', async () => {
  const changes = readFileSync(new URL('../service/src/17-changes.mjs', import.meta.url), 'utf8');
  const fn = changes.match(/^async function restartChecked\(viewer, ctx, spark, container\) \{[\s\S]*?^\}/m)[0];
  class Refused extends Error { constructor(status, message) { super(message); this.status = status; } }
  const pending = record(); pending.attempts.push({ id: 'aaaaaaaaaaaa', commands: [{ spark: 'spark3', result: { terminal: false } }] });
  const restart = new Function('env', `with (env) { ${fn}; return restartChecked; }`)({ rollbackRecords: () => [pending], HttpError: Refused,
    inventory: async () => ({ sparks: [{ id: 'spark3', deployments: [{ container: 'sc-old', model: 'old', state: 'exited' }] }], library: [{ name: 'old' }] }),
    notBrainsSpark: () => { throw new Error('the guarded restart must not reach placement or mutate'); },
    restartRoom: () => { throw new Error('the guarded restart must not reach placement or mutate'); },
    restartJob: () => { throw new Error('the guarded restart must not reach placement or mutate'); } });
  await assert.rejects(restart({}, {}, 'spark3', 'sc-old'), error => error.status === 409 && /unanswered command/.test(error.message));
  const roomSource = changes.match(/^async function restartRoom\(viewer, spark, container, model, inv = null\) \{[\s\S]*?^\}/m)[0];
  const room = new Function('env', `with (env) { ${roomSource}; return restartRoom; }`)({ rollbackRecords: () => [pending], HttpError: Refused });
  await assert.rejects(room({}, 'spark3', 'sc-old', 'old'), error => error.status === 409 && /unanswered command/.test(error.message));
});

test('an initial routed-stop question preserves rollback authority; the confirmed choice writes its tombstone before claiming', async () => {
  const h = harness(), changes = readFileSync(new URL('../service/src/17-changes.mjs', import.meta.url), 'utf8');
  const block = changes.match(/^action\(\{\n  name: 'stop_model'[\s\S]*?^\}\);/m)[0];
  let registered, work, stops = 0; const order = [];
  const env = { action: a => { registered = a; }, sparkArg: {}, choiceArg: {}, sparkOf: () => {},
    inventory: async () => ({ sparks: [{ id: 'spark3', deployments: [{ container: 'sc-old', state: 'running' }] }] }),
    rollbackKnown: () => true, rollbackSupersede: (...args) => { order.push('tombstone'); return h.api.rollbackSupersede(...args); },
    nodeById: id => ({ id }), run: async () => ({ code: 0, out: '' }), q: x => `'${x}'`, isProtected: () => false, mustUse: () => {},
    routedSparks: () => new Set(['spark3']), question: () => ({ outcome: 'question' }), jobs: new Map(), holdsModelsOn: () => false,
    claimed: (_, __, create) => { order.push('claim'); return create(); }, newJob: () => ({ id: 'eeeeeeeeeeee' }),
    runJob: (_, fn) => { work = fn; }, pausedCheck: () => {}, stopContainer: async () => { stops++; }, stoppedForSure: async () => {},
    redeemChoice: () => ({ spark: 'spark3', container: 'sc-old', confirmRouted: true }),
  };
  new Function('env', `with (env) { ${block} }`)(env);
  const asked = await registered.run({ spark: 'spark3', container: 'sc-old' }, { login: 'owner' }, { via: 'page' });
  assert.equal(asked.outcome, 'question'); assert.equal(h.read().runs[ID].units[0].members[0].state, 'waiting'); assert.deepEqual(order, []); assert.equal(stops, 0);
  const yes = await registered.run({ choice: 'yes' }, { login: 'owner' }, { via: 'page' });
  assert.equal(yes.outcome, 'started'); assert.equal(h.read().runs[ID].units[0].members[0].state, 'superseded'); assert.deepEqual(order.slice(0, 2), ['tombstone', 'claim']);
  await work({}); assert.equal(stops, 1);
});

test('a negative stop of an unanswered new name is never a positive wish, even with no original to restore', async () => {
  for (const previouslyAdopted of [false, true]) {
    const r = record(); r.units = [];
    const seen = { ...receipt('e', 'sc-new', 'running'), spark: 'spark3', labels: { 'spark.operation': ID, 'spark.attempt': 'aaaaaaaaaaaa', 'spark.command': 'bbbbbbbbbbbb' } };
    r.attempts.push({ id: 'aaaaaaaaaaaa', boots: {}, commands: [{ id: 'bbbbbbbbbbbb', spark: 'spark3', action: 'run', name: seen.name, expected: null, result: { terminal: true, code: 0, boot: 'boot-1', seen } }] });
    const h = harness(r); h.env.ENGINE_CHECK_NAME = 'spark-console-engine-check'; h.containers.set(seen.id, structuredClone(seen));
    h.env.run = async () => ({ code: 0, out: seen.id + '\n', err: '' }); h.env.rollbackOwned = h.api.rollbackOwned;
    if (previouslyAdopted) h.api.rollbackSupersede(['spark3/sc-new'], 'the owner asked for it again', null, false);
    h.api.rollbackSupersede(['spark3/sc-new'], 'the owner stopped the pending name');
    await h.api.rollbackReturn(h.job());
    assert.equal(h.containers.get(seen.id).state, 'exited', 'the late owned container must stop');
    assert.equal(h.calls.filter(x => x[0] === 'stop').length, 1); assert.equal(h.read().runs[ID], undefined);
  }
});

test('head adoption and a later negative stop cover both exact recorded parts of an across attempt', async () => {
  const r = record(); r.units = []; r.targets.push('spark4');
  const seen = ['spark3', 'spark4'].map((spark, rank) => ({ ...receipt(rank ? 'f' : 'e', `sc-new${rank ? '-part2' : ''}`, 'running'), spark,
    labels: { 'spark.operation': ID, 'spark.attempt': 'aaaaaaaaaaaa', 'spark.command': rank ? 'cccccccccccc' : 'bbbbbbbbbbbb' } }));
  r.attempts.push({ id: 'aaaaaaaaaaaa', boots: {}, commands: seen.map(x => ({ id: x.labels['spark.command'], spark: x.spark, action: 'run', name: x.name, expected: null, result: { terminal: true, code: 0, boot: 'boot-1', seen: x } })) });
  const h = harness(r); h.env.ENGINE_CHECK_NAME = 'spark-console-engine-check'; for (const x of seen) h.containers.set(x.id, structuredClone(x));
  h.env.run = async node => ({ code: 0, out: seen.find(x => x.spark === node.id).id + '\n', err: '' }); h.env.rollbackOwned = h.api.rollbackOwned;
  h.api.rollbackSupersede(['spark3/sc-new'], 'the owner adopted the across model', null, false);
  assert.equal((await h.api.rollbackOwned(h.read().runs[ID], 'spark3')).length, 0); assert.equal((await h.api.rollbackOwned(h.read().runs[ID], 'spark4')).length, 0);
  h.api.rollbackSupersede(['spark3/sc-new'], 'the owner stopped the across model'); await h.api.rollbackReturn(h.job());
  assert.ok(seen.every(x => h.containers.get(x.id).state === 'exited')); assert.equal(h.calls.filter(x => x[0] === 'stop').length, 2); assert.equal(h.read().runs[ID], undefined);
});

test('a wholly stopped historical pair preserves only its replaced compute copy and never claims the former hub', async () => {
  const h = harness(null), calls = [], look = h.env.rollbackLook;
  h.env.rollbackLook = async (spark, ref) => { calls.push([spark, ref]); return look(spark, ref); };
  const inv = { library: [{ name: 'old', sizeBytes: 20e9 }], sparks: [
    { id: 'spark2', deployments: [{ container: 'sc-old', model: 'old', cluster: 'spark2+spark3', state: 'exited' }] },
    { id: 'spark3', deployments: [{ container: 'sc-old-part2', model: 'old', cluster: 'spark2+spark3', state: 'exited' }] },
  ] };
  h.containers.set('b'.repeat(64), { ...receipt('b', 'sc-old-part2'), spark: 'spark3' });
  const job = { id: ID, createdAt: SINCE };
  await h.api.rollbackPrepare(job, ['spark3', 'spark4'], ['spark3/sc-old-part2'], inv);
  const saved = h.read().runs[ID];
  assert.deepEqual(saved.targets, ['spark3', 'spark4']);
  assert.deepEqual(saved.units.flatMap(u => u.members).map(m => [m.spark, m.container, m.wasRunning]), [['spark3', 'sc-old-part2', false]]);
  assert.ok(calls.every(([spark]) => spark !== 'spark2'));
  assert.deepEqual(h.calls, [], 'no extra claim or mutation reaches the old peer');
  await h.api.rollbackReturn(job);
  assert.equal(h.containers.get('b'.repeat(64)).state, 'exited');
  assert.equal(h.read().runs[ID], undefined);
  assert.ok(!h.calls.some(c => ['start', 'stop', 'remove'].includes(c[0])));
});

for (const peerState of ['running', undefined]) test(`a historical pair with ${peerState || 'unknown'} peer state keeps its whole-pair hub refusal`, async () => {
  const h = harness(null), inv = { library: [], sparks: [
    { id: 'spark2', deployments: [{ container: 'sc-old', model: 'old', cluster: 'spark2+spark3', state: peerState }] },
    { id: 'spark3', deployments: [{ container: 'sc-old-part2', model: 'old', cluster: 'spark2+spark3', state: 'exited' }] },
  ] };
  await assert.rejects(h.api.rollbackPrepare({ id: ID, createdAt: SINCE }, ['spark3'], ['spark3/sc-old-part2'], inv), /hub/);
  assert.deepEqual(h.calls, []);
  assert.equal(h.read().runs[ID], undefined);
});

test('a stopped historical copy that starts after planning refuses before recording or changing it', async () => {
  const h = harness(null), inv = { library: [], sparks: ['spark2', 'spark3'].map((id, rank) => ({ id,
    deployments: [{ container: `sc-old${rank ? '-part2' : ''}`, model: 'old', cluster: 'spark2+spark3', state: 'exited' }] })) };
  h.containers.set('b'.repeat(64), { ...receipt('b', 'sc-old-part2', 'running'), spark: 'spark3' });
  await assert.rejects(h.api.rollbackPrepare({ id: ID, createdAt: SINCE }, ['spark3'], ['spark3/sc-old-part2'], inv), /pair.*changed.*Nothing was stopped/);
  assert.deepEqual(h.calls, []);
  assert.equal(h.read().runs[ID], undefined);
  assert.equal(h.containers.get('b'.repeat(64)).state, 'running');
});
