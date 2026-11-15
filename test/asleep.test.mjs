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
import { readFileSync, writeFileSync, rmSync, mkdtempSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
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
    await done(await act('power_off', { spark: 'spark4' }));
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
    await done(await act('start_model', { model: 'RadixArk/Qwen3.8-27B-NVFP4', spark: 'spark4' }));
    await new Promise(res => setTimeout(res, 3000));
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
    const start = sh.indexOf("python3 - <<'PY'\n", at) + "python3 - <<'PY'\n".length, end = sh.indexOf('\nPY\n', start);
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
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
});
