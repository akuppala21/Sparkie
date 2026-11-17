// Covers: A Spark Spark Console put to sleep reads "asleep" (D4, R41): in `fleet_status` (beside its state, off), in
// `/status` and in the fleet notes Sparkie is sent, with since when and what was on its disk then; a planned wake doesn't
// hold back a crash restart for half an hour (its `spark-online` event says `planned`); the installer's reach check says
// asleep for a Spark Spark Console powered off, not "NOT reachable".
//
// T141 (part): a look reads "asleep" for a Spark Spark Console put to sleep.
//
// On the stand-in fleet the plug controller (test/mock/plugs.mjs) is tied to Sparks 3 and 4, and the stand-in sudo shuts
// a Spark down. The reach check is the installer's own Python, taken from deploy/host-on-portal.sh and run with a made-up
// home and a stand-in ssh that never connects.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, mkdtempSync, mkdirSync, chmodSync, existsSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { T, useFleet, api, newChat, say, waitFor, eventLines, SLOW } from './lib.mjs';
import { startPlugs } from './mock/plugs.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NODES = [
  { node_id: 2, available: true, attributes: { '1/6/0': true, '1/144/8': 0, '1/144/4': 121000, '1/144/5': 0 } },
  { node_id: 3, available: true, attributes: { '1/6/0': true, '1/144/8': 0, '1/144/4': 121000, '1/144/5': 0 } },
  { node_id: 5, available: true, readOnly: true, attributes: { '1/6/0': true, '1/144/8': 150000, '1/144/4': 121000, '1/144/5': 1300 } },
];
const plugs = await startPlugs(NODES);
after(() => plugs.close());

const RADIX = 'sc-RadixArk--Qwen3.8-27B-NVFP4';
useFleet({
  statusMs: 1500, watchMs: 1500,
  env: {
    SPARK_CONSOLE_PLUGS_URL: plugs.url, SPARK_CONSOLE_PLUGS_MS: '500',
    SPARK_CONSOLE_POWER_MS: '1000', SPARK_CONSOLE_POWER_FIRST_MS: '1000', SPARK_CONSOLE_POWER_POLL_MS: '300',
    SPARK_CONSOLE_POWER_OFF_WAIT_MS: String(8000 * SLOW), SPARK_CONSOLE_POWER_ON_WAIT_MS: String(30000 * SLOW),
    SPARK_CONSOLE_POWER_CYCLE_MS: '300', SPARK_CONSOLE_POWER_HOLD_MS: String(3000 * SLOW), SPARK_CONSOLE_HEAL_SETTLE_MS: '2000',
    SPARK_CONSOLE_HEAL_MIN_RUN_MS: '1000',
  },
  prepare: ({ root, stateDir }) => {
    writeFileSync(join(stateDir, 'plugs.json'), JSON.stringify({ spark2: { node: 5, readOnly: true }, spark3: { node: 2 }, spark4: { node: 3 } }), { mode: 0o600 });
    writeFileSync(join(stateDir, 'power.json'), JSON.stringify({ idleMinutes: 0, off: {} }), { mode: 0o600 });
    for (const [spark, name] of [['spark3', 'qwen-recipe-chisel'], ['spark4', 'qwen-recipe-aphex3k']]) {
      const f = join(root, spark, '.mock', 'containers');
      writeFileSync(f, readFileSync(f, 'utf8').split('\n').filter(l => !l.startsWith(`${name}|`)).join('\n'));
    }
  },
}, async () => {
  plugs.attach({ offlineFile: T.fleet.offlineFile, sparks: { 2: 'spark3', 3: 'spark4' }, bootMs: 1500 });
});

const mock = (spark, f) => join(T.fleet.root, spark, '.mock', f);
const act = (name, args) => api(`/actions/${name}`, { method: 'POST', body: args });
const look = async (name, args = {}) => { const r = await act(name, args); assert.equal(r.status, 200, r.text); return r.json; };
const power = () => JSON.parse(readFileSync(join(T.fleet.stateDir, 'power.json'), 'utf8'));
async function done(r) {
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.outcome, 'started', r.text);
  for (const until = Date.now() + 240000 * SLOW; ;) {
    const w = await look('wait_operation', { id: r.json.operation, seconds: 20 });
    if (w.status !== 'running') { assert.equal(w.status, 'completed', JSON.stringify(w)); return w; }
    assert.ok(Date.now() < until, `still running: ${JSON.stringify(w)}`);
  }
}
const ASLEEP = /^Spark 4 is asleep since \d{4}-\d\d-\d\d \d\d:\d\d UTC; \d+ models on its disk then\. A look doesn’t wake it\.$/;

describe('asleep (D4)', { concurrency: 1 }, () => {
  test('a Spark Spark Console powered off reads asleep in fleet_status, /status and the fleet notes', { timeout: 300000 * SLOW }, async () => {
    // (the watcher's first look comes 15 s after the service starts: only after it does a Spark going dark make an event)
    await waitFor(async () => (await look('workloads')).workloads?.some(w => w.spark === 'spark4'), { timeout: 90000, what: 'the watcher’s first look' });
    await done(await act('power_off', { spark: 'spark4' }));
    const parked = JSON.parse(readFileSync(join(T.fleet.stateDir, 'desired.json'), 'utf8')).running.find(x => x.spark === 'spark4' && x.container === RADIX);
    assert.ok(parked?.parked, 'power-off preserved the parked model on disk');
    const row = (await look('fleet_status')).sparks.find(x => x.id === 'spark4');
    assert.equal(row.state, 'off', JSON.stringify(row));
    assert.match(row.offOnPurpose.asleep, ASLEEP);
    const node = (await api('/status?fresh=1')).json.nodes.find(n => n.id === 'spark4');
    assert.equal(node.asleep, true, JSON.stringify(node));
    assert.match(node.poweredOff.asleep, ASLEEP);
    // (what Sparkie is sent with the owner's message: the stand-in brain logs it)
    const words = `how are the sparks? ${Date.now()}`;
    await say(await newChat(), words);
    const sent = readFileSync(join(T.fleet.dir, 'model-requests.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).findLast(x => x.words === words);
    // (the fleet notes go in front of the owner's words, or in the prompt)
    assert.match(`${sent?.system || ''}\n${sent?.lastUser || ''}`, /Spark 4: asleep, on purpose \(not a fault\)\. Powered off by Spark Console \(asked\)/);
  });

  test('after a planned wake, a model that crashes is restarted at once: the wake is no outage', { timeout: 300000 * SLOW }, async () => {
    await done(await act('power_on', { spark: 'spark4' }));
    const online = await waitFor(() => eventLines().findLast(e => e.type === 'spark-online' && e.spark === 'spark4'), { timeout: 60000, what: 'Spark 4 seen online' });
    assert.equal(online.planned, true, JSON.stringify(online));
    assert.equal(eventLines().findLast(e => e.type === 'spark-offline' && e.spark === 'spark4')?.planned, true);
    // The wake must restore what shutdown parked, before a repeated start can hide a failed restore.
    const restored = await waitFor(async () => (await look('should_be_running')).running.find(x => x.spark === 'spark4' && x.container === RADIX && x.state === 'running'),
      { timeout: 60000, what: 'the parked model restored after power-on' });
    assert.equal(restored.parked, undefined, 'the restored model is no longer parked');
    const saved = JSON.parse(readFileSync(join(T.fleet.stateDir, 'desired.json'), 'utf8')).running.find(x => x.spark === 'spark4' && x.container === RADIX);
    assert.ok(saved, 'the restored model stays on the saved list');
    assert.equal(saved.parked, undefined, 'the cleared parked mark was saved');
    assert.equal(readFileSync(mock('spark4', 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${RADIX}|`))?.split('|')[1], 'running', 'the wake restored the actual container');
    assert.equal(power().off.spark4, undefined, 'power-on cleared the off record');
    const workloadOperations = async () => {
      const r = await api('/jobs');
      assert.equal(r.status, 200, r.text);
      return r.json.jobs.filter(j => (j.node === 'spark4' || j.nodes?.includes('spark4'))
        && (j.container === RADIX || [RADIX.slice(3), RADIX.slice(3).replace('--', '/')].includes(j.model))).map(j => j.id).sort();
    };
    const beforeStart = await workloadOperations();
    assert.ok(beforeStart.length, 'the restored workload has an operation on record');
    const again = await act('start_model', { model: 'RadixArk/Qwen3.8-27B-NVFP4', spark: 'spark4' });
    assert.equal(again.status, 200, again.text);
    assert.equal(again.json.outcome, 'already', again.text);
    assert.equal(again.json.operation, undefined, 'an already-running model starts no operation');
    await new Promise(res => setTimeout(res, 3000));
    assert.deepEqual(await workloadOperations(), beforeStart, 'the repeated start created no workload operation');
    // (it crashes: exited with 1, as heal.test.mjs crashes one)
    const since = new Date().toISOString(), f = mock('spark4', 'containers');
    const before = readFileSync(f, 'utf8'), crashed = before.replace(new RegExp(`^${RADIX.replace(/[.+]/g, '\\$&')}\\|running\\|[^|]*\\|`, 'm'), `${RADIX}|exited|Exited (1) just now|`);
    assert.notEqual(crashed, before, 'it was running');
    writeFileSync(f, crashed);
    rmSync(mock('spark4', `up-${RADIX}`), { force: true });
    const e = await waitFor(() => eventLines().find(x => x.at > since && x.spark === 'spark4' && x.container === RADIX && ['healing', 'heal-skipped'].includes(x.type)),
      { timeout: 60000, what: 'self-healing to look at it' });
    assert.equal(e.type, 'healing', JSON.stringify(e));
  });

  test('the installer’s reach check says asleep for a Spark Spark Console powered off, and still says NOT reachable for one that isn’t', () => {
    const sh = readFileSync(join(ROOT, 'deploy/host-on-portal.sh'), 'utf8');
    const at = sh.indexOf('echo "Checking that this machine can reach the other Sparks without a password:"');
    const open = /python3(?: -I)? - <<'PY'\n/.exec(sh.slice(at)), start = open ? at + open.index + open[0].length : -1, end = sh.indexOf('\nPY\n', start);
    assert.ok(at > 0 && start > at && end > start, 'the reach check is in the installer');
    const home = mkdtempSync(join(tmpdir(), 'reach-')), bin = join(home, 'bin');
    try {
      mkdirSync(join(home, 'spark-console-service')); mkdirSync(join(home, '.local/state/spark-console'), { recursive: true }); mkdirSync(bin);
      writeFileSync(join(home, 'spark-console-service/config.json'), JSON.stringify({ user: 'owner', nodes: [{ id: 'spark2', host: 'local' }, { id: 'spark3', host: 'spark-3' }, { id: 'spark4', host: 'spark-4' }] }));
      writeFileSync(join(home, '.local/state/spark-console/power.json'), JSON.stringify({ idleMinutes: 30, off: { spark4: { at: '2026-11-14T10:00:00.000Z', why: 'idle' } } }));
      writeFileSync(join(bin, 'ssh'), '#!/bin/sh\necho "ssh: connect to host port 22: Connection timed out" >&2\nexit 255\n');
      chmodSync(join(bin, 'ssh'), 0o755);
      writeFileSync(join(home, 'reach.py'), sh.slice(start, end));
      const r = spawnSync('python3', [join(home, 'reach.py')], { env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(r.stdout.replace(/\n+$/, '').split('\n'), [
        '  spark2: this machine',
        '  spark3: NOT reachable without a password: ssh: connect to host port 22: Connection timed out',
        '  spark4: asleep (Spark Console powered it off at 2026-11-14 10:00 UTC; a start or power_on turns it on)',
      ]);
      assert.ok(existsSync(join(home, 'reach.py')));
      // (a record that isn't one, as a power.json edited by hand: that Spark is read as not asleep, and the check still
      // ends well, so an install that worked never ends in an error here)
      writeFileSync(join(home, '.local/state/spark-console/power.json'), JSON.stringify({ off: { spark3: null, spark4: 'asleep' } }));
      const bad = spawnSync('python3', [join(home, 'reach.py')], { env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' });
      assert.equal(bad.status, 0, bad.stderr);
      assert.deepEqual(bad.stdout.replace(/\n+$/, '').split('\n').map(l => l.replace(/: .*/, '')), ['  spark2', '  spark3', '  spark4']);
      assert.match(bad.stdout, /spark4: NOT reachable without a password/);
      // (a record that carries a problem, a wake that failed: not asleep, and the problem is said; text from the file is
      // printed only as far as it can be, so an escape sequence or half of a character pair in it neither reaches the
      // terminal nor ends the check in an error)
      writeFileSync(join(home, '.local/state/spark-console/power.json'), JSON.stringify({ off: {
        spark3: { at: '2026-11-14T10:00:00.000Z', why: 'asked', problem: 'Turning it on didn’t work: Spark 3’s plug is on, but Spark 3 didn’t answer within 5 minutes.' },
        spark4: { at: '\u001b[2J2026-11-14T10:00\ud800', why: 'idle' } } }));
      const odd = spawnSync('python3', [join(home, 'reach.py')], { env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' });
      assert.equal(odd.status, 0, odd.stderr);
      assert.deepEqual(odd.stdout.replace(/\n+$/, '').split('\n'), [
        '  spark2: this machine',
        '  spark3: NOT reachable (ssh: connect to host port 22: Connection timed out); Spark Console powered it off at 2026-11-14 10:00 UTC and its record says: Turning it on didn’t work: Spark 3’s plug is on, but Spark 3 didn’t answer within 5 minutes.',
        '  spark4: asleep (Spark Console powered it off at [2J2026-11-14 10 UTC; a start or power_on turns it on)',
      ]);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  // (from here, a fault after a planned wake, a wake that fails, and a power.json edited by hand: R56)
  const setOffline = (spark, off) => writeFileSync(T.fleet.offlineFile, `${[...readFileSync(T.fleet.offlineFile, 'utf8').split(/\s+/).filter(x => x && x !== spark), ...(off ? [spark] : [])].join('\n')}\n`);
  const seen = (type, since, what) => waitFor(() => eventLines().findLast(e => e.type === type && e.spark === 'spark4' && e.at > since), { timeout: 90000, what });
  const ended = async id => { for (const until = Date.now() + 240000 * SLOW; ;) { const w = await look('wait_operation', { id, seconds: 20 }); if (w.status !== 'running') return w; assert.ok(Date.now() < until, `still running: ${JSON.stringify(w)}`); } };
  // (what Sparkie is sent about Spark 4 with a message of the owner's: the stand-in brain logs it)
  async function notesOn4() {
    const words = `how are the sparks? ${Date.now()}`;
    await say(await newChat(), words);
    const sent = readFileSync(join(T.fleet.dir, 'model-requests.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).findLast(x => x.words === words);
    return `${sent?.system || ''}\n${sent?.lastUser || ''}`.split('\n').filter(l => /^Spark 4: /.test(l));
  }

  test('a real outage after a planned wake is still an outage: its events aren’t planned, and a crash after it is held', { timeout: 300000 * SLOW }, async () => {
    // (Spark 4 was put to sleep and woken by Spark Console above, and its model runs again there)
    await waitFor(async () => (await look('running_models')).models.some(m => m.spark === 'spark4' && m.container === RADIX), { timeout: 90000, what: `${RADIX} running` });
    const t1 = new Date().toISOString();
    setOffline('spark4', true);
    const dark = await seen('spark-offline', t1, 'Spark 4 going dark by itself');
    await new Promise(res => setTimeout(res, 3000));
    setOffline('spark4', false);
    const back = await seen('spark-online', dark.at, 'its return');
    assert.equal(power().off.spark4, undefined, 'no record: not Spark Console’s doing');
    assert.deepEqual([dark.planned ?? null, back.planned ?? null], [null, null], JSON.stringify({ dark, back }));
    await new Promise(res => setTimeout(res, 3000));
    const since = new Date().toISOString(), f = mock('spark4', 'containers');
    const before = readFileSync(f, 'utf8'), crashed = before.replace(new RegExp(`^${RADIX.replace(/[.+]/g, '\\$&')}\\|running\\|[^|]*\\|`, 'm'), `${RADIX}|exited|Exited (1) just now|`);
    assert.notEqual(crashed, before, 'it was running');
    writeFileSync(f, crashed);
    rmSync(mock('spark4', `up-${RADIX}`), { force: true });
    const e = await waitFor(() => eventLines().find(x => x.at > since && x.spark === 'spark4' && x.container === RADIX && ['healing', 'heal-skipped'].includes(x.type)),
      { timeout: 60000, what: 'self-healing to look at it' });
    assert.equal(e.type, 'heal-skipped', JSON.stringify(e));
    assert.match(String(e.why), /was offline in the last half hour/);
  });

  test('a wake that fails reads as a fault, with its problem, in fleet_status, /status and the fleet notes, never as asleep', { timeout: 300000 * SLOW }, async () => {
    await done(await act('power_off', { spark: 'spark4' }));
    // (its plug switches on, and the Spark doesn't boot)
    plugs.setNoBoot(3);
    try {
      const w = await ended((await act('power_on', { spark: 'spark4' })).json.operation);
      assert.equal(w.status, 'failed', JSON.stringify(w));
      assert.match(String(power().off.spark4?.problem), /^Turning it on didn’t work: /);
      const row = (await look('fleet_status')).sparks.find(x => x.id === 'spark4');
      assert.equal(row.state, 'off', JSON.stringify(row));
      assert.equal(row.offOnPurpose.asleep, null, JSON.stringify(row.offOnPurpose));
      assert.match(row.offOnPurpose.words, /^Shut down by Spark Console \(asked\) at .* UTC\. Turning it on didn’t work: /);
      const node = (await api('/status?fresh=1')).json.nodes.find(n => n.id === 'spark4');
      assert.equal(node.asleep, false, JSON.stringify(node));
      assert.equal(node.poweredOff.asleep, null);
      const lines = await notesOn4();
      assert.ok(lines.some(l => /^Spark 4: Shut down by Spark Console \(asked\) at .* UTC\. Turning it on didn’t work: /.test(l)), JSON.stringify(lines));
      assert.ok(!lines.some(l => /asleep|not a fault/.test(l)), JSON.stringify(lines));
    } finally {
      plugs.setNoBoot(3, false);
      // (its button pressed: it answers, and its record goes)
      setOffline('spark4', false);
      await waitFor(() => !power().off.spark4, { timeout: 90000, what: 'its record cleared' });
    }
  });

  // What the brain is told about such a Spark matches what fleet_status then shows: the description says a record that
  // carries a problem is a fault, and the row after a failed wake carries one (left by d4-later: it said "not a problem").
  test('fleet_status’s description calls a powered-off Spark with a problem a fault, and a failed wake shows that problem', { timeout: 300000 * SLOW }, async () => {
    const desc = (await api('/actions')).json.actions.find(a => a.name === 'fleet_status').description;
    const said = desc.split(/(?<=\.) /).find(s => s.includes('offOnPurpose'));
    assert.ok(said && !/not a problem/.test(said), said);
    assert.match(said, /not a fault unless it carries a problem/);
    await done(await act('power_off', { spark: 'spark4' }));
    plugs.setNoBoot(3);
    try {
      const w = await ended((await act('power_on', { spark: 'spark4' })).json.operation);
      assert.equal(w.status, 'failed', JSON.stringify(w));
      const row = (await look('fleet_status')).sparks.find(x => x.id === 'spark4');
      assert.equal(row.state, 'off', JSON.stringify(row));
      assert.match(String(row.offOnPurpose.problem), /^Turning it on didn’t work: /, JSON.stringify(row.offOnPurpose));
      assert.equal(row.offOnPurpose.asleep, null);
    } finally {
      plugs.setNoBoot(3, false);
      setOffline('spark4', false);
      await waitFor(() => !power().off.spark4, { timeout: 90000, what: 'its record cleared' });
    }
  });

  test('a power.json edited by hand to hold null or a word for a Spark beside a real record: the looks, the chat and a start still work, and only the real record counts', { timeout: 300000 * SLOW }, async () => {
    await done(await act('power_off', { spark: 'spark4' }));
    const file = join(T.fleet.stateDir, 'power.json'), good = power();
    const write = p => { writeFileSync(`${file}.t`, JSON.stringify(p), { mode: 0o600 }); renameSync(`${file}.t`, file); };
    write({ ...good, off: { ...good.off, spark3: null, spark1: 'asleep' } });
    try {
      const status = await api('/status?fresh=1');
      assert.equal(status.status, 200, status.text);
      const by = Object.fromEntries(status.json.nodes.map(n => [n.id, n]));
      assert.match(by.spark4.poweredOff?.asleep || '', ASLEEP);
      assert.deepEqual([by.spark3.poweredOff, by.spark1.poweredOff], [undefined, undefined]);
      const fleet = await look('fleet_status');
      assert.equal(fleet.sparks.find(x => x.id === 'spark4').state, 'off');
      await look('models_on_disk');
      assert.ok((await notesOn4()).some(l => /^Spark 4: asleep, on purpose \(not a fault\)\./.test(l)), 'the chat turn answered, with Spark 4 asleep');
      // (a download that fits on Spark 3, which is on: it reads the status, whose marks read every record)
      const start = await act('start_model', { model: 'qwen3.5-0.8b' });
      assert.equal(start.status, 200, start.text);
      if (start.json?.operation) await ended(start.json.operation);
    } finally { write({ ...power(), off: Object.fromEntries(Object.entries(power().off).filter(([, r]) => r && typeof r === 'object')) }); }
  });
});
