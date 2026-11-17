// Covers: Powering Sparks off and on (R41) with the stand-in plug controller (`setWatts` for a lagging reading) and a
// stand-in `sudo`: what is refused and why (Spark 2 first), the clean path, the one-minute hold, `power_on`'s cases, an
// agent waiting for the owner, the owner's words, every signal the idle loop reads, and a model across two Sparks. Each
// test's name says what it checks.
//
// Power-aware Sparks (contract 9.22, R41, 21-power.mjs): Spark Console shuts a Spark down cleanly and switches its
// smart plug off (power_off), turns it on again (power_on), powers idle Sparks off by itself (power_settings), and turns
// a Spark it powered off back on when a start or a call needs it. On the stand-in fleet: the stand-in plug controller
// (test/mock/plugs.mjs) is tied to Sparks 3 and 4 (its watts follow them; switching it off takes the Spark down, on
// boots it), Spark 2's plug is read-only, Spark 1 has none, and a stand-in sudo (test/mock/bin/sudo) shuts a Spark down.
// Never: Spark 2 switched, a Spark that still answers cut, a plug cut whose watts didn't drop, a hand-started or
// protected container stopped, healing acting against a power-off made on purpose.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, readdirSync, mkdtempSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { T, useFleet, api, call, createActKey, agentSettings, newChat, say, chatMessages, waitFor, sleep, eventLines, REPO, SLOW } from './lib.mjs';
import { startPlugs } from './mock/plugs.mjs';

// spark3's plug is node 2, spark4's node 3, Spark 2's (read-only) node 5. Matter's units: milliwatts, millivolts, mA.
const NODES = [
  { node_id: 2, available: true, attributes: { '1/6/0': true, '1/144/8': 0, '1/144/4': 121000, '1/144/5': 0 } },
  { node_id: 3, available: true, attributes: { '1/6/0': true, '1/144/8': 0, '1/144/4': 121000, '1/144/5': 0 } },
  { node_id: 5, available: true, readOnly: true, attributes: { '1/6/0': true, '1/144/8': 150000, '1/144/4': 121000, '1/144/5': 1300 } },
];
const plugs = await startPlugs(NODES);
after(() => plugs.close());

const TESTORG = 'testorg--Qwen3.8-27B-abliterated-GGUF', T3 = `sc-${TESTORG}`;
const RADIX = 'RadixArk--Qwen3.8-27B-NVFP4', R4 = `sc-${RADIX}`;
const HAND3 = 'qwen-recipe-chisel|running|Up 17 minutes|0||';
const keys = {};
useFleet({
  statusMs: 1500, watchMs: 1500,
  env: {
    SPARK_CONSOLE_PLUGS_URL: plugs.url, SPARK_CONSOLE_PLUGS_MS: '500',
    SPARK_CONSOLE_POWER_MS: '1000', SPARK_CONSOLE_POWER_FIRST_MS: '1000', SPARK_CONSOLE_IDLE_MINUTE_MS: String(1000 * SLOW),
    SPARK_CONSOLE_POWER_POLL_MS: '300', SPARK_CONSOLE_POWER_OFF_WAIT_MS: String(8000 * SLOW), SPARK_CONSOLE_POWER_ON_WAIT_MS: String(30000 * SLOW),
    SPARK_CONSOLE_POWER_CYCLE_MS: '300', SPARK_CONSOLE_POWER_HOLD_MS: String(3000 * SLOW), SPARK_CONSOLE_HEAL_MS: '1500', SPARK_CONSOLE_DESIRED_MS: '1500', SPARK_CONSOLE_HEAL_SETTLE_MS: '2000',
    SPARK_CONSOLE_HEAL_OFFLINE_MS: '1000', SPARK_CONSOLE_CONNECT_MS: String(20000 * SLOW),
  },
  prepare: ({ root, stateDir }) => {
    writeFileSync(join(stateDir, 'plugs.json'), JSON.stringify({ spark2: { node: 5, readOnly: true }, spark3: { node: 2 }, spark4: { node: 3 } }), { mode: 0o600 });
    // The idle power-off starts off here; the tests about it set it.
    writeFileSync(join(stateDir, 'power.json'), JSON.stringify({ idleMinutes: 0, off: {} }), { mode: 0o600 });
    // No hand-started benchmarks on Sparks 3 and 4 (one test puts one back).
    for (const [spark, name] of [['spark3', 'qwen-recipe-chisel'], ['spark4', 'qwen-recipe-aphex3k']]) {
      const f = join(root, spark, '.mock', 'containers');
      writeFileSync(f, readFileSync(f, 'utf8').split('\n').filter(l => !l.startsWith(`${name}|`)).join('\n'));
    }
    const at = new Date().toISOString();
    writeFileSync(join(stateDir, 'desired.json'), JSON.stringify({ revision: 1, running: [
      { spark: 'spark3', container: T3, model: TESTORG, since: at, by: 'test' }, { spark: 'spark4', container: R4, model: RADIX, since: at, by: 'test' }],
    revisions: [{ revision: 1, at, by: 'test', chat: null, operation: null, added: [`spark3/${T3}`, `spark4/${R4}`], removed: [], before: [], seeded: true }] }), { mode: 0o600 });
  },
}, async () => {
  plugs.attach({ offlineFile: T.fleet.offlineFile, sparks: { 2: 'spark3', 3: 'spark4' }, bootMs: 1500 });
  keys.act = await createActKey('power-act');
});

const mock = (spark, f) => join(T.fleet.root, spark, '.mock', f);
const stateOf = (spark, name) => readFileSync(mock(spark, 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];
const offline = () => readFileSync(T.fleet.offlineFile, 'utf8').split(/\s+/).filter(Boolean);
const setOffline = (spark, off) => writeFileSync(T.fleet.offlineFile, `${[...offline().filter(x => x !== spark), ...(off ? [spark] : [])].join('\n')}\n`);
const power = () => JSON.parse(readFileSync(join(T.fleet.stateDir, 'power.json'), 'utf8'));
const desiredFile = () => JSON.parse(readFileSync(join(T.fleet.stateDir, 'desired.json'), 'utf8'));
const entry = (spark, container) => desiredFile().running.find(x => x.spark === spark && x.container === container);
const act = (name, args) => api(`/actions/${name}`, { method: 'POST', body: args });
// (reads as the owner's own call: the agent door's per-key limit would be met by the polling here)
const look = async (name, args = {}) => { const r = await act(name, args); assert.equal(r.status, 200, r.text); return r.json; };
const fleet = () => look('fleet_status');
const status = async () => (await api('/status?fresh=1')).json;
async function finished(id, limit = 240000) {
  for (const until = Date.now() + limit * SLOW; ;) {
    const w = await look('wait_operation', { id, seconds: 20 });
    if (w.status !== 'running') return w;
    assert.ok(Date.now() < until, `still running: ${JSON.stringify(w)}`);
  }
}
async function done(r) {
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.outcome, 'started', r.text);
  const w = await finished(r.json.operation);
  assert.equal(w.status, 'completed', JSON.stringify(w));
  return w;
}
const commandsSince = n => plugs.commands.slice(n);
// (until the operation is watching a Spark's plug before switching it: the hold, holdLow; without one, as long as a
// hold would take, so what the test checks next says what happened)
const watching = id => waitFor(async () => ((await api(`/jobs/${id}`)).json.log || []).some(l => /watching it for/.test(l)), { timeout: 10000, what: 'the hold to begin' }).catch(() => {});
// Spark 4 as the tests expect it: its plug on and reading what it draws, booting, and answering (after a test that failed
// part-way, so the ones after it start from that).
function restore4() {
  plugs.setStuck(3, false); plugs.setWatts(3, null); plugs.setNoBoot(3, false);
  const n4 = plugs.node(3);
  n4.available = true; n4.attributes = { ...n4.attributes, '1/6/0': true };
  setOffline('spark4', false);
}
const eventsSince = (since, type) => eventLines().filter(e => e.at > since && (!type || e.type === type));
const ops = async () => (await look('recent_operations', { limit: 50 })).operations;
// (Spark Console's status of a Spark that changed: what the idle loop and the came-back check read)
const seenOnline = (id, on) => waitFor(async () => ((await status()).nodes.find(n => n.id === id)?.state === 'online') === on, { what: `${id} ${on ? 'online' : 'offline'}` });
const running = (spark, name) => waitFor(() => stateOf(spark, name) === 'running', { timeout: 120000, what: `${name} running on ${spark}` });
// A model server's /metrics with a count that doesn't move: measured, and unused.
const flat = spark => writeFileSync(mock(spark, 'metrics'), '# TYPE vllm:request_success_total counter\nvllm:request_success_total{model_name="m"} 7.0\nvllm:num_requests_running{model_name="m"} 0.0\n');
const idle = (spark, on) => { if (on) writeFileSync(mock(spark, 'status.json'), JSON.stringify({ gpuUtilization: 0, load1Minute: 0.1 })); else rmSync(mock(spark, 'status.json'), { force: true }); };

describe('power_off refuses, changing nothing', () => {
  test('Spark 2 is never switched; a Spark without a plug says how to pair one', async () => {
    const before = plugs.commands.length;
    for (const name of ['power_off', 'power_on']) {
      const r = await act(name, { spark: 'spark2' });
      assert.equal(r.status, 403, r.text);
      assert.match(r.json.error, /Spark 2 runs Spark Console and Sparkie, so it is never powered off or on from here/);
    }
    const p = await act('power_off', { sparks: ['spark2', 'spark3'] });
    assert.equal(p.status, 403, p.text);
    const none = await act('power_off', { spark: 'spark1' });
    assert.equal(none.status, 409, none.text);
    assert.match(none.json.error, /Spark 1 has no smart plug Spark Console can switch.*bash spark-console\/deploy\/plugs\.sh pair 1$/);
    assert.deepEqual(commandsSince(before), [], 'no plug command');
    assert.deepEqual(power().off, {});
  });

  test('a hand-started (protected) container on it: refused, naming it; nothing stops', async () => {
    const f = mock('spark3', 'containers'), was = readFileSync(f, 'utf8'), before = plugs.commands.length;
    writeFileSync(f, `${was.trimEnd()}\n${HAND3}\n`);
    try {
      const r = await act('power_off', { spark: 'spark3' });
      assert.equal(r.status, 409, r.text);
      assert.match(r.json.error, /^Spark 3 is in use: qwen-recipe-chisel \(protected\) runs there\. Spark Console never stops those, so nothing was changed/);
      assert.equal(stateOf('spark3', T3), 'running');
      assert.equal(stateOf('spark3', 'qwen-recipe-chisel'), 'running');
      assert.deepEqual(commandsSince(before), []);
      assert.ok(!offline().includes('spark3'));
    } finally { writeFileSync(f, was); }
  });

  test('sudo not set up for the shutdown: refused with what to run, nothing stopped', async () => {
    const before = plugs.commands.length;
    writeFileSync(mock('spark4', 'no-sudo'), '');
    try {
      const r = await act('power_off', { spark: 'spark4' });
      assert.equal(r.status, 409, r.text);
      assert.match(r.json.error, /Run deploy\/power-setup\.sh once for this Spark \(bash spark-console\/deploy\/power-setup\.sh 100\.64\.0\.4\)\. Nothing was changed\./);
      assert.equal(stateOf('spark4', R4), 'running');
      assert.deepEqual(commandsSince(before), []);
      assert.deepEqual(power().off, {});
      assert.equal(entry('spark4', R4).parked, undefined);
    } finally { rmSync(mock('spark4', 'no-sudo'), { force: true }); }
  });

  test('a plug not proven on that Spark (off while it answers, or not answering the controller): refused before anything stops', async () => {
    const before = plugs.commands.length, n4 = plugs.node(3);
    n4.attributes = { ...n4.attributes, '1/6/0': false };
    try {
      const r = await act('power_off', { spark: 'spark4' });
      assert.equal(r.status, 409, r.text);
      assert.match(r.json.error, /^Spark 4’s plug reads as off while Spark 4 answers, so that plug may not be Spark 4’s\. Nothing was changed\./);
    } finally { n4.attributes = { ...n4.attributes, '1/6/0': true }; }
    n4.available = false;
    try {
      const r = await act('power_off', { spark: 'spark4' });
      assert.equal(r.status, 409, r.text);
      assert.match(r.json.error, /^Spark 4’s plug isn’t answering the plug controller, so Spark 4 wasn’t shut down/);
    } finally { n4.available = true; }
    assert.equal(stateOf('spark4', R4), 'running');
    assert.ok(!offline().includes('spark4'));
    assert.deepEqual(commandsSince(before), []);
    assert.deepEqual(power().off, {});
  });

  test('fleet_status gives each Spark’s power state (power.state) and, for one that may be switched, what keeps it on (sparkNeeded)', async () => {
    // (the plugs are first read 2 s after the service starts; until then a plugged Spark reads unknown too)
    const p = await waitFor(async () => (x => (x.bySpark.spark2.state === 'on' && x.bySpark.spark3.state === 'on' ? x : null))((await fleet()).power), { what: 'the plugs read' });
    assert.equal(p.bySpark.spark1.state, 'unknown', 'no plug paired: as before plugs');
    assert.equal(p.bySpark.spark2.state, 'on', 'Spark 2’s read-only plug is read');
    assert.equal(p.bySpark.spark2.neededFor, undefined, 'never switched, so never asked');
    assert.equal(p.bySpark.spark3.state, 'on');
    assert.ok(Array.isArray(p.bySpark.spark3.neededFor), JSON.stringify(p.bySpark.spark3));
    assert.ok(p.bySpark.spark3.neededFor.every(x => typeof x === 'string'));
  });

  test('only 12-plugs.mjs sends the plug controller a command (switchPlug)', () => {
    const dir = join(REPO, 'service', 'src');
    const senders = readdirSync(dir).filter(f => /^\d\d-[a-z0-9-]+\.mjs$/.test(f) && readFileSync(join(dir, f), 'utf8').includes('device_command'));
    assert.deepEqual(senders, ['12-plugs.mjs']);
  });

  test('Spark 2’s plug named without readOnly, on a plug that would take commands: refused, never switchable, never read, nothing sent', async () => {
    const file = join(T.fleet.stateDir, 'plugs.json'), was = readFileSync(file, 'utf8'), n5 = plugs.node(5), before = plugs.commands.length;
    writeFileSync(file, JSON.stringify({ ...JSON.parse(was), spark2: { node: 5 } }), { mode: 0o600 });
    n5.readOnly = false;
    try {
      for (const name of ['power_off', 'power_on']) {
        const r = await act(name, { spark: 'spark2' });
        assert.equal(r.status, 403, r.text);
        assert.match(r.json.error, /Spark 2 runs Spark Console and Sparkie, so it is never powered off or on from here/);
      }
      const f = await fleet();
      assert.ok(!f.power.switchable.includes('spark2'), JSON.stringify(f.power));
      assert.equal(f.sparks.find(x => x.id === 'spark2').wall, null, 'not read without readOnly');
      assert.deepEqual(commandsSince(before), []);
    } finally { writeFileSync(file, was, { mode: 0o600 }); n5.readOnly = true; }
  });

  test('one function sends the shutdown, and it and the plug switch refuse the hub before anything else (R41)', () => {
    const dir = join(REPO, 'service', 'src'), src = f => readFileSync(join(dir, f), 'utf8');
    const senders = readdirSync(dir).filter(f => /^\d\d-[a-z0-9-]+\.mjs$/.test(f) && /systemctl poweroff/.test(src(f)));
    assert.deepEqual(senders, ['21-power.mjs']);
    const power = src('21-power.mjs');
    assert.deepEqual(power.match(/\bSHUTDOWN\b/g), ['SHUTDOWN', 'SHUTDOWN'], 'the command is written once and sent once');
    assert.match(power, /\nfunction shutDownSpark\(node\) \{\n  if \(!node \|\| brainSparks\(\)\.includes\(node\.id\) \|\| node\.host === 'local'\) throw [^\n]+\n  return run\(node, SHUTDOWN, /,
      'its first line refuses the brain’s Spark and Spark Console’s own; then it sends');
    const plugsSrc = src('12-plugs.mjs'), sw = plugsSrc.slice(plugsSrc.indexOf('async function switchPlug('));
    assert.ok(/^\s*if \(brainSparks\(\)\.includes\(spark\) \|\| nodeById\(spark\)\?\.host === 'local' \|\| !switchablePlug\(spark\)\) throw/m.test(sw.slice(0, sw.indexOf('plugNodes()'))),
      'switchPlug refuses the hub before it asks the controller anything');
    assert.match(plugsSrc, /const switchablePlug = spark => \{\n[^\n]*\n  return Boolean\(v && !v\.readOnly && !brainSparks\(\)\.includes\(spark\) && nodeById\(spark\)\?\.host !== 'local'/);
  });

  test('deploy/power-setup.sh refuses Spark 2, by its address or name before it connects, and by its machine id on the far side', () => {
    const bin = mkdtempSync(join(tmpdir(), 'power-setup-')), log = join(bin, 'ssh.log'), sent = join(bin, 'remote.sh');
    // (a stand-in ssh: notes each call, keeps the script sent for the far side, and gives a machine id; never connects)
    writeFileSync(join(bin, 'ssh'), `#!/bin/bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\ncase "$*" in *machine-id*) echo 0123abcd ;; *'cat >'*) cat > ${JSON.stringify(sent)} ;; esac\nexit 0\n`, { mode: 0o755 });
    // (the test's own hub, Spark 2 as when this was written: a copy of the script beside its own deploy/hub.env; the last
    // case's hub is at 100.64.0.2, as SPARK2=u@100.64.0.2 made it before the hub came from hub.env)
    const HUB = 'HUB=spark2\nHUB_NAME=akspark2\nLOGIN=akuppala\nTAILNET=tailab9aa9.ts.net\nspark2=100.79.155.126\nspark3=100.122.49.9\nspark4=100.109.240.15\n';
    const copy = (name, hub) => {
      const d = join(bin, name);
      mkdirSync(d);
      for (const f of ['power-setup.sh', 'hub.sh']) writeFileSync(join(d, f), readFileSync(join(REPO, 'deploy', f)));
      writeFileSync(join(d, 'hub.env'), hub);
      return join(d, 'power-setup.sh');
    };
    const SCRIPT = copy('hub2', HUB), SCRIPT_U = copy('hub-u', HUB.replace('LOGIN=akuppala', 'LOGIN=u').replace('spark2=100.79.155.126', 'spark2=100.64.0.2'));
    const setup = (args, script = SCRIPT) => spawnSync('bash', [script, ...args], { env: { PATH: `${bin}:${process.env.PATH}`, HOME: bin }, encoding: 'utf8' });
    try {
      for (const [args, script] of [[['100.79.155.126']], [['akuppala@100.79.155.126']], [['akspark2']], [['localhost']], [['100.122.49.9', '100.64.0.2'], SCRIPT_U]]) {
        const r = setup(args, script);
        assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
        assert.match(r.stderr, /^Refused: \S+ is Spark 2\. It runs Spark Console and Sparkie and is never set up to shut down\.$/m);
      }
      assert.ok(!existsSync(log), 'it never connected');
      // Another Spark: the script sent to it refuses, first of all, a machine whose id is Spark 2's.
      const r = setup(['100.122.49.9']);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(readFileSync(log, 'utf8').split('\n')[0], /cat \/etc\/machine-id/, 'Spark 2’s machine id is read first');
      assert.match(readFileSync(sent, 'utf8'), /^HUB_ID='0123abcd'\n\[ "\$\(cat \/etc\/machine-id 2>\/dev\/null\)" = "\$HUB_ID" \] && \{ echo 'Refused: this is Spark 2\./);
    } finally { rmSync(bin, { recursive: true, force: true }); }
  });
});

describe('powering a Spark off and on', { concurrency: 1 }, () => {
  test('the clean path: its model is parked, it shuts down, its plug goes off once it stops answering and draws under 15 W', { timeout: 300000 * SLOW }, async () => {
    const since = new Date().toISOString(), before = plugs.commands.length;
    const r = await act('power_off', { spark: 'spark4' });
    assert.deepEqual(r.json.stops, [`spark4/${R4}`], r.text);
    const w = await done(r);
    assert.ok(w.recentLog.some(l => /Shutting down Spark 4 cleanly/.test(l)), JSON.stringify(w.recentLog));
    assert.ok(w.recentLog.some(l => /Spark 4 is shut down \(2\.5 W at the wall\): switching its plug off/.test(l)), JSON.stringify(w.recentLog));
    assert.deepEqual(commandsSince(before), [{ node: 3, command: 'off' }]);
    assert.ok(offline().includes('spark4'));
    assert.equal(stateOf('spark4', R4), 'exited');
    // Parked: still on the list, marked, not held.
    assert.ok(entry('spark4', R4)?.parked, JSON.stringify(desiredFile().running));
    const rec = power().off.spark4;
    assert.deepEqual({ why: rec.why, plugCut: rec.plugCut, parked: rec.parked, problem: rec.problem }, { why: 'asked', plugCut: true, parked: [`spark4/${R4}`], problem: null });
    const ev = eventsSince(since, 'spark-powered-off');
    assert.deepEqual(ev.map(e => [e.spark, e.why, e.parked]), [['spark4', 'asked', [R4]]]);
    await seenOnline('spark4', false);
    const s4 = (await fleet()).sparks.find(x => x.id === 'spark4');
    assert.equal(s4.state, 'off', JSON.stringify(s4));
    assert.equal(s4.problem, undefined);
    assert.deepEqual(s4.offOnPurpose.parkedModels, [R4]);
    assert.match(s4.offOnPurpose.words, /^Powered off by Spark Console \(asked\) at \d{4}-\d\d-\d\d \d\d:\d\d UTC\. Parked: sc-RadixArk--Qwen3\.8-27B-NVFP4\. Say “turn on Spark 4” to turn it on/);
    assert.equal(s4.offOnPurpose.howToTurnOn, 'power_on {"spark":"spark4"}');
    const p4 = (await fleet()).power.bySpark.spark4;
    assert.deepEqual(p4, { state: 'off' }, 'power.state: off, by Spark Console');
    const n4 = (await status()).nodes.find(n => n.id === 'spark4');
    assert.match(n4.poweredOff.words, /^Powered off by Spark Console \(asked\)/);
    const x = (await look('should_be_running')).running.find(y => y.container === R4);
    assert.equal(x.state, 'parked', JSON.stringify(x));
    assert.match(x.why, /Spark 4 was powered off by Spark Console; it comes back when it is turned on, or when it is called/);
  });

  test('nothing heals against it: no bring-back, no "should be running" notice, nothing waiting on the owner', { timeout: 120000 * SLOW }, async () => {
    const since = new Date().toISOString();
    await sleep(9000);   // six heal passes, six looks at what should be running
    const evs = eventsSince(since);
    assert.ok(!evs.some(e => ['healing', 'heal-skipped'].includes(e.type) && e.container === R4), JSON.stringify(evs));
    assert.ok(!evs.some(e => e.type === 'notice' && /RadixArk/.test(e.text || '')), JSON.stringify(evs));
    const f = await fleet();
    assert.ok(!f.needsOwner.some(l => /Spark 4|RadixArk/.test(l)), JSON.stringify(f.needsOwner));
    const darkFinding = (await look('spark_diagnostics', { spark: 'spark4' })).darkPeriods?.periods?.[0]?.finding;
    if (darkFinding) assert.match(darkFinding, /^powered off on purpose by Spark Console \(asked\), not a fault/);
    assert.equal(stateOf('spark4', R4), 'exited');
    assert.ok(offline().includes('spark4'));
  });

  test('power_on: its plug goes on, it boots, and what was parked comes back', { timeout: 300000 * SLOW }, async () => {
    const since = new Date().toISOString(), before = plugs.commands.length;
    const r = await act('power_on', { spark: 'spark4' });
    assert.deepEqual(r.json.bringsBack, [R4], r.text);
    const w = await done(r);
    assert.deepEqual(commandsSince(before), [{ node: 3, command: 'on' }]);
    assert.ok(w.recentLog.some(l => /Turning on Spark 4 \(about 2 minutes\)…/.test(l)), JSON.stringify(w.recentLog));
    assert.ok(!offline().includes('spark4'));
    assert.equal(stateOf('spark4', R4), 'running');
    assert.equal(entry('spark4', R4).parked, undefined);
    assert.deepEqual(power().off, {});
    assert.deepEqual(eventsSince(since, 'spark-powered-on').map(e => [e.spark, e.why]), [['spark4', 'asked']]);
    await seenOnline('spark4', true);
    assert.equal((await fleet()).sparks.find(x => x.id === 'spark4').state, 'online');
  });

  // (The owner's call, 2026-11-14: power is asked first. Until then an agent answered its own question here; now its
  // power-off and idle setting wait for the owner's button, which it can't press, and its power-on stays open.)
  test('an agent’s power-off and idle setting wait for the owner (a button it can’t press); the owner’s power-off does it; its power-on works', { timeout: 300000 * SLOW }, async () => {
    const before = plugs.commands.length;
    const q = await call(keys.act.token, 'power_off', { spark: 'spark4' });
    assert.equal(q.isError, false, q.text);
    assert.equal(q.value.outcome, 'question', q.text);
    assert.match(q.value.question, /^Power off Spark 4\? It stops sc-RadixArk--Qwen3\.8-27B-NVFP4 first/);
    assert.ok(q.value.choices.every(c => c.choice === null), 'no choice it could send back');
    assert.match(q.value.note, /^Only the owner can answer this one, from Spark Console, and nothing was done/);
    const set = await call(keys.act.token, 'power_settings', { idleMinutes: 5 });
    assert.equal(set.value?.outcome, 'question', set.text);
    assert.ok(set.value.choices.every(c => c.choice === null), set.text);
    assert.equal(power().idleMinutes, 0, 'the setting is unchanged');
    assert.equal(stateOf('spark4', R4), 'running', 'asking changes nothing');
    assert.deepEqual(commandsSince(before), []);
    await done(await act('power_off', { spark: 'spark4' }));
    assert.ok(offline().includes('spark4'));
    const on = await call(keys.act.token, 'power_on', { spark: 'spark4' });
    assert.equal(on.value?.outcome, 'started', on.text);
    assert.equal((await finished(on.value.operation)).status, 'completed');
    assert.equal(stateOf('spark4', R4), 'running');
  });

  test('sudo allowed when asked but refused at the shutdown: its model starts again, nothing is switched or kept', { timeout: 300000 * SLOW }, async () => {
    const before = plugs.commands.length;
    writeFileSync(mock('spark4', 'poweroff-refused'), '');
    try {
      const r = await act('power_off', { spark: 'spark4' });
      assert.equal(r.status, 200, r.text);
      const w = await finished(r.json.operation);
      assert.equal(w.status, 'failed', JSON.stringify(w));
      assert.match(w.error, /Run deploy\/power-setup\.sh once for this Spark/);
      assert.ok(w.recentLog.some(l => /Started sc-RadixArk--Qwen3\.8-27B-NVFP4 on Spark 4 again/.test(l)), JSON.stringify(w.recentLog));
    } finally { rmSync(mock('spark4', 'poweroff-refused'), { force: true }); }
    assert.equal(stateOf('spark4', R4), 'running');
    assert.equal(entry('spark4', R4).parked, undefined);
    assert.deepEqual(power().off, {});
    assert.ok(!offline().includes('spark4'));
    assert.deepEqual(commandsSince(before), []);
  });

  test('turned on outside Spark Console while agents’ changes are paused: what was parked shows as held, not parked for good', { timeout: 300000 * SLOW }, async () => {
    await done(await act('power_off', { spark: 'spark4' }));
    assert.ok(entry('spark4', R4).parked);
    await agentSettings({ halted: true });
    try {
      // (the owner turns its plug on in the Tapo app: it boots)
      const n4 = plugs.node(3);
      n4.attributes = { ...n4.attributes, '1/6/0': true };
      setOffline('spark4', false);
      await waitFor(() => !power().off.spark4, { timeout: 60000, what: 'its record cleared' });
      assert.equal(entry('spark4', R4).parked, undefined, 'unparked');
      const x = await waitFor(async () => (await look('should_be_running')).running.find(y => y.container === R4 && y.state === 'held'), { what: 'held' });
      assert.equal(x.state, 'held');
      assert.equal(stateOf('spark4', R4), 'exited', 'nothing was started while paused');
    } finally { await agentSettings({ halted: false }); }
    // (back as it was, for the tests after this)
    await done(await act('restart_model', { spark: 'spark4', container: R4 }));
  });

  test('the look after its models stopped fails (Docker not answering): what was parked is put back, and it says so', { timeout: 300000 * SLOW }, async () => {
    const before = plugs.commands.length;
    // (the look in the action and the one in the job answer; the one after the stops doesn't)
    writeFileSync(mock('spark4', 'power-looks'), '2');
    try {
      const r = await act('power_off', { spark: 'spark4' });
      assert.equal(r.status, 200, r.text);
      const w = await finished(r.json.operation);
      assert.equal(w.status, 'failed', JSON.stringify(w));
      assert.match(w.error, /^Its models were stopped, but the last look before the shutdown didn’t work \(Docker there didn’t answer\), so nothing was shut down and what was parked was put back\./);
    } finally { rmSync(mock('spark4', 'power-looks'), { force: true }); }
    assert.equal(stateOf('spark4', R4), 'running');
    assert.equal(entry('spark4', R4).parked, undefined);
    assert.deepEqual(power().off, {});
    assert.ok(!offline().includes('spark4'));
    assert.deepEqual(commandsSince(before), []);
  });

  test('watts that never drop (the plug isn’t on that Spark): the power is not cut; once it answers again it is taken back', { timeout: 300000 * SLOW }, async () => {
    const before = plugs.commands.length, since = new Date().toISOString();
    plugs.setStuck(2);
    try {
      const r = await act('power_off', { spark: 'spark3' });
      assert.equal(r.status, 200, r.text);
      const w = await finished(r.json.operation);
      assert.equal(w.status, 'failed', JSON.stringify(w));
      assert.match(w.error, /Spark 3 stopped answering, but its plug still shows 58 W, so the plug may not be on Spark 3\. Its power was not cut\./);
      assert.deepEqual(commandsSince(before), [], 'the plug was never switched');
      assert.ok(offline().includes('spark3'), 'it did shut down');
      assert.match(power().off.spark3.problem, /may not be on Spark 3/);
      await seenOnline('spark3', false);
      const f = await fleet();
      assert.ok(f.needsOwner.some(l => /^Spark 3: Spark 3 stopped answering, but its plug still shows 58 W/.test(l)), JSON.stringify(f.needsOwner));
      assert.equal(f.sparks.find(x => x.id === 'spark3').state, 'off');
    } finally { plugs.setStuck(2, false); }
    // The owner presses its power button: it answers again, its record goes and what was parked comes back.
    setOffline('spark3', false);
    await waitFor(() => eventsSince(since, 'spark-powered-on').some(e => e.spark === 'spark3' && e.why === 'turned on outside Spark Console'), { timeout: 60000, what: 'spark3 taken back' });
    await running('spark3', T3);
    await waitFor(() => !power().off.spark3 && !entry('spark3', T3).parked, { what: 'its record and park mark gone' });
    assert.deepEqual(commandsSince(before), [], 'taking it back switched nothing');
    // (the bring-back's own operation ends before the next test powers Spark 3 off)
    await waitFor(async () => !(await ops()).some(o => o.status === 'running' && (o.sparks || [o.spark]).includes('spark3')), { timeout: 120000, what: 'nothing changing on spark3' });
  });

  test('a Spark that still answers after the shutdown is never cut', { timeout: 300000 * SLOW }, async () => {
    const before = plugs.commands.length;
    writeFileSync(mock('spark3', 'poweroff-hangs'), '');
    try {
      const r = await act('power_off', { spark: 'spark3' });
      assert.equal(r.status, 200, r.text);
      const w = await finished(r.json.operation);
      assert.equal(w.status, 'failed', JSON.stringify(w));
      assert.match(w.error, /^Spark 3 still answers \d+ (?:seconds|minutes?) after it was told to shut down, so its plug was left on\./);
      assert.deepEqual(commandsSince(before), [], 'never cut');
      assert.ok(!offline().includes('spark3'));
    } finally { rmSync(mock('spark3', 'poweroff-hangs'), { force: true }); }
    // It is on: its record goes and its parked model comes back, with nothing switched.
    await running('spark3', T3);
    await waitFor(() => !power().off.spark3 && !entry('spark3', T3).parked, { what: 'its record and park mark gone' });
    assert.deepEqual(commandsSince(before), []);
  });

  test('power_on: shut down with its plug on → plug off, then on; drawing power but not answering → nothing; a plug that refuses (status 126)', { timeout: 300000 * SLOW }, async () => {
    // Shut down by hand, plug on (2.5 W): off, then on again.
    setOffline('spark4', true);
    await seenOnline('spark4', false);
    let before = plugs.commands.length;
    await done(await act('power_on', { spark: 'spark4' }));
    assert.deepEqual(commandsSince(before), [{ node: 3, command: 'off' }, { node: 3, command: 'on' }]);
    assert.ok(!offline().includes('spark4'));
    // Powered (58 W) but not answering: nothing is switched.
    plugs.setStuck(3);
    setOffline('spark4', true);
    try {
      before = plugs.commands.length;
      const r = await act('power_on', { spark: 'spark4' });
      assert.equal(r.status, 409, r.text);
      assert.match(r.json.error, /^Spark 4’s plug shows 58 W, so it is powered on but not answering\. Nothing was switched/);
      assert.deepEqual(commandsSince(before), []);
    } finally { plugs.setStuck(3, false); setOffline('spark4', false); }
    // A plug that refuses the controller (as Spark 2's does): Matter's status 126, said, and nothing more is tried.
    await seenOnline('spark4', true);
    const n4 = plugs.node(3);
    n4.attributes['1/6/0'] = false;
    setOffline('spark4', true);
    n4.readOnly = true;
    try {
      before = plugs.commands.length;
      const r = await act('power_on', { spark: 'spark4' });
      const w = await finished(r.json.operation);
      assert.equal(w.status, 'failed', JSON.stringify(w));
      assert.match(w.error, /Spark 4’s plug refused the command \(Command failed: Matter status 126/);
      assert.deepEqual(commandsSince(before), []);
    } finally { n4.readOnly = false; }
    // A controller that only knows "On": asked again by that name.
    plugs.setNames('upper');
    try {
      before = plugs.commands.length;
      await done(await act('power_on', { spark: 'spark4' }));
      assert.deepEqual(commandsSince(before), [{ node: 3, command: 'On' }]);
      assert.ok(!offline().includes('spark4'));
    } finally { plugs.setNames('lower'); }
    await seenOnline('spark4', true);
  });

  test('power_on of a Spark shut down with its plug on, whose plug reading lags: it comes up while its plug is watched, and nothing is switched', { timeout: 300000 * SLOW }, async () => {
    setOffline('spark4', true);
    await seenOnline('spark4', false);
    plugs.setWatts(3, 2500);
    try {
      const before = plugs.commands.length;
      const r = await act('power_on', { spark: 'spark4' });
      assert.equal(r.status, 200, r.text);
      // (its own button pressed while its plug is watched, the reading not caught up yet)
      await watching(r.json.operation);
      setOffline('spark4', false);
      const w = await finished(r.json.operation);
      assert.deepEqual(commandsSince(before), [], 'its plug was never switched');
      assert.equal(w.status, 'completed', JSON.stringify(w));
      assert.ok(w.recentLog.some(l => /Spark 4 is on and answering/.test(l)), JSON.stringify(w.recentLog));
    } finally { restore4(); }
    await seenOnline('spark4', true);
  });

  test('power_off of a Spark that doesn’t answer: 58 W or a plug that can’t be read is refused; a lagging 2.5 W while it comes back is never cut; 2.5 W for the whole hold is cut, nothing parked', { timeout: 300000 * SLOW }, async () => {
    setOffline('spark4', true);
    await seenOnline('spark4', false);
    let before = plugs.commands.length;
    try {
      plugs.setStuck(3);
      let r = await act('power_off', { spark: 'spark4' });
      assert.equal(r.status, 409, r.text);
      assert.match(r.json.error, /^Spark 4 isn’t answering, but its plug shows 58 W: it is powered on but not answering, so its power is not cut from here\./);
      plugs.setStuck(3, false);
      const n4 = plugs.node(3);
      n4.available = false;
      try {
        r = await act('power_off', { spark: 'spark4' });
        assert.equal(r.status, 409, r.text);
        assert.match(r.json.error, /^Spark 4 isn’t answering, and its plug can’t be read \(/);
        // (the plug controller's own words are outside text: the answer points at fleet_status's wall, final read)
        assert.match(r.json.error, /\(fleet_status’s wall for it says why\), so nothing was changed\./);
        assert.doesNotMatch(r.json.error, /isn’t answering the controller/);
      } finally { n4.available = true; }
      assert.deepEqual(commandsSince(before), []);
      // (2.5 W from a reading that lags: it comes back while its plug is watched, and is never cut)
      plugs.setWatts(3, 2500);
      r = await act('power_off', { spark: 'spark4' });
      assert.equal(r.status, 200, r.text);
      await watching(r.json.operation);
      setOffline('spark4', false);
      let w = await finished(r.json.operation);
      assert.deepEqual(commandsSince(before), [], 'never cut');
      assert.equal(w.status, 'failed', JSON.stringify(w));
      assert.match(w.error, /Spark 4 answered while its plug was being watched, so its power was not cut\./);
      assert.equal(power().off.spark4, undefined);
      plugs.setWatts(3, null);
      // (shut down, silent and under 15 W for the whole hold: cut; nothing could be stopped there, so nothing is parked)
      setOffline('spark4', true);
      await seenOnline('spark4', false);
      before = plugs.commands.length;
      w = await done(await act('power_off', { spark: 'spark4' }));
      assert.ok(w.recentLog.some(l => /Spark 4 isn’t answering and its plug reads under 15 W: watching it for \d+ seconds before its plug is switched/.test(l)), JSON.stringify(w.recentLog));
      assert.deepEqual(commandsSince(before), [{ node: 3, command: 'off' }]);
      const rec = power().off.spark4;
      assert.deepEqual({ why: rec.why, plugCut: rec.plugCut, parked: rec.parked }, { why: 'asked', plugCut: true, parked: [] });
      assert.equal(entry('spark4', R4).parked, undefined, 'nothing parked');
    } catch (e) { restore4(); throw e; } finally { plugs.setStuck(3, false); plugs.setWatts(3, null); }
    await done(await act('power_on', { spark: 'spark4' }));
    await seenOnline('spark4', true);
    assert.deepEqual(power().off, {});
  });

  test('a power-on that fails is on the needs-you list, so the owner knows it needs its button', { timeout: 300000 * SLOW }, async () => {
    await running('spark4', R4);
    await done(await act('power_off', { spark: 'spark4' }));
    plugs.setNoBoot(3);
    try {
      const w = await finished((await act('power_on', { spark: 'spark4' })).json.operation);
      assert.equal(w.status, 'failed', JSON.stringify(w));
      assert.match(w.error, /Spark 4’s plug is on, but Spark 4 didn’t answer within/);
      assert.match(power().off.spark4.problem, /^Turning it on didn’t work: Spark 4’s plug is on, but Spark 4 didn’t answer within .* power button/);
      const f = await fleet();
      assert.ok(f.needsOwner.some(l => /^Spark 4: Turning it on didn’t work: Spark 4’s plug is on, but Spark 4 didn’t answer within/.test(l)), JSON.stringify(f.needsOwner));
    } catch (e) { restore4(); throw e; } finally { plugs.setNoBoot(3, false); }
    // (its button pressed: it answers, its record goes, and what was parked comes back)
    setOffline('spark4', false);
    await waitFor(() => !power().off.spark4, { timeout: 60000, what: 'its record cleared' });
    await running('spark4', R4);
    await waitFor(async () => !(await ops()).some(o => o.status === 'running' && (o.sparks || [o.spark]).includes('spark4')), { timeout: 120000, what: 'nothing changing on spark4' });
  });

  test('left parked on a Spark that is on, with no record of a power-off: the mark comes off, it is said, and self-healing brings it back', { timeout: 300000 * SLOW }, async () => {
    const since = new Date().toISOString();
    await running('spark4', R4);
    // (what a restart leaves between "the Spark answers again" and "what was parked there comes back")
    const f = mock('spark4', 'containers');
    writeFileSync(f, readFileSync(f, 'utf8').split('\n').map(l => (l.startsWith(`${R4}|`) ? (p => { p[1] = 'exited'; p[2] = 'Exited (0) 5 minutes ago'; return p.join('|'); })(l.split('|')) : l)).join('\n'));
    const d = join(T.fleet.stateDir, 'desired.json'), list = JSON.parse(readFileSync(d, 'utf8'));
    list.running.find(x => x.spark === 'spark4' && x.container === R4).parked = new Date(Date.now() - 600000).toISOString();
    writeFileSync(d, JSON.stringify(list), { mode: 0o600 });
    assert.deepEqual(power().off, {});
    await waitFor(() => !entry('spark4', R4).parked, { timeout: 30000, what: 'the park mark taken off' });
    assert.ok(eventsSince(since, 'notice').some(e => e.container === R4 && /^sc-RadixArk--Qwen3\.8-27B-NVFP4 was still marked parked, though Spark 4 is on, so the mark was taken off/.test(e.text)),
      JSON.stringify(eventsSince(since, 'notice')));
    // (held now, as anything else that should run and doesn't: self-healing waits here, as Spark 4 was off in the last
    // half hour, and Bring back works)
    const x = await waitFor(async () => (await look('should_be_running')).running.find(y => y.container === R4 && ['held', 'running'].includes(y.state)), { what: 'held, or running again' });
    assert.notEqual(x.state, 'parked');
    await done(await act('restart_model', { spark: 'spark4', container: R4 }));
  });
});

describe('Sparkie maps the owner’s words', { concurrency: 1 }, () => {
  const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
  after(() => rmSync(join(T.fleet.dir, 'model-script.json'), { force: true }));
  const tools = r => r.message.tools.map(t => [t.name, t.ok, t.outcome]);

  test('"turn on Spark 3" never powers anything off; "shut down Spark 3" does, at once; "turn on Spark 3" brings it back', { timeout: 300000 * SLOW }, async () => {
    // (a chat each: what one message asks is judged on its own words)
    script([{ match: '^turn on spark 3', calls: [{ name: 'power_off', arguments: { spark: 'spark3' } }] }]);
    const wrong = await say(await newChat(), 'Turn on Spark 3');
    assert.deepEqual(tools(wrong), [['power_off', true, 'needs-ok']], JSON.stringify(wrong.message.tools));
    assert.ok(!offline().includes('spark3'));
    script([{ match: '^shut down spark 3', calls: [{ name: 'power_off', arguments: { spark: 'spark3' } }] }]);
    const offChat = await newChat(), off = await say(offChat, 'Shut down Spark 3');
    assert.deepEqual(tools(off), [['power_off', true, 'started']], JSON.stringify(off.message.tools));
    await waitFor(() => power().off.spark3?.plugCut === true, { timeout: 120000, what: 'spark3 off' });
    await waitFor(async () => !(await ops()).some(o => o.type === 'power-off' && o.status === 'running'), { what: 'its operation done' });
    // Its result is posted in that chat, and it was one request ("shut down" isn't also a stop to carry on with).
    await waitFor(async () => (await chatMessages(offChat)).some(m => m.notice && /^Done: powering off Spark 3 finished\./.test(m.content)), { what: 'the result in the chat' });
    await sleep(5000);
    assert.ok(!(await chatMessages(offChat)).some(m => m.auto), 'no carry-on turn');
    script([{ match: '^turn on spark 3', calls: [{ name: 'power_on', arguments: { spark: 'spark3' } }] }]);
    const on = await say(await newChat(), 'Turn on Spark 3');
    assert.deepEqual(tools(on), [['power_on', true, 'started']], JSON.stringify(on.message.tools));
    await running('spark3', T3);
    await waitFor(async () => !(await ops()).some(o => o.type === 'power-on' && o.status === 'running'), { timeout: 120000, what: 'its operation done' });
  });

  test('"shut it down" after stopping a model, or a power-off of another Spark in the same words, is never a power-off of that Spark', { timeout: 120000 * SLOW }, async () => {
    script([{ match: '^stop sc-radixark', calls: [{ name: 'power_off', arguments: { spark: 'spark4' } }] },
      { match: '^shut down spark 3 and stop', calls: [{ name: 'power_off', arguments: { spark: 'spark4' } }] }]);
    assert.deepEqual(tools(await say(await newChat(), 'Stop sc-RadixArk--Qwen3.8-27B-NVFP4 on Spark 4 and shut it down')), [['power_off', true, 'needs-ok']]);
    assert.deepEqual(tools(await say(await newChat(), 'Shut down Spark 3 and stop gemma on Spark 4')), [['power_off', true, 'needs-ok']]);
    assert.ok(!offline().includes('spark4'));
    assert.deepEqual(power().off, {});
  });

  test('"turn off Spark 3’s model" is never a power-off of Spark 3: a Spark followed by ’s is whose, not what is switched', { timeout: 120000 * SLOW }, async () => {
    script([{ match: '^turn off spark 3', calls: [{ name: 'power_off', arguments: { spark: 'spark3' } }] }]);
    assert.deepEqual(tools(await say(await newChat(), 'Turn off Spark 3’s model')), [['power_off', true, 'needs-ok']]);
    assert.deepEqual(tools(await say(await newChat(), "Turn off Spark 3's model")), [['power_off', true, 'needs-ok']]);
    assert.ok(!offline().includes('spark3'));
    assert.deepEqual(power().off, {});
  });

  test('the idle time: "power off idle Sparks after an hour" sets 60; "stop auto shutdown" sets 0; a time the words don’t give is a button', { timeout: 120000 * SLOW }, async () => {
    script([{ match: '^power off idle sparks after an hour', calls: [{ name: 'power_settings', arguments: { idleMinutes: 60 } }] }]);
    assert.deepEqual(tools(await say(await newChat(), 'Power off idle Sparks after an hour')), [['power_settings', true, 'saved']]);
    assert.equal(power().idleMinutes, 60);
    script([{ match: '^power off idle sparks after an hour', calls: [{ name: 'power_settings', arguments: { idleMinutes: 5 } }] }]);
    assert.deepEqual(tools(await say(await newChat(), 'Power off idle Sparks after an hour')), [['power_settings', true, 'needs-ok']]);
    assert.equal(power().idleMinutes, 60);
    script([{ match: '^stop auto shutdown', calls: [{ name: 'power_settings', arguments: { idleMinutes: 0 } }] }]);
    assert.deepEqual(tools(await say(await newChat(), 'Stop auto shutdown')), [['power_settings', true, 'saved']]);
    assert.equal(power().idleMinutes, 0);
    assert.equal((await fleet()).power.idleMinutes, 0);
  });
});

describe('the idle power-off', { concurrency: 1 }, () => {
  // Spark 3 has its model and nothing else; its GPU reads 0% and its load 0.1, and its model server's /metrics gives a
  // count that doesn't move (a model whose use can't be measured is never idle: its own test takes the count away).
  // Spark 4's GPU stays busy. Idle means 10 "minutes" of a second each here (longer on a slow machine, SPARK_TEST_SLOW;
  // a call can take a few seconds while Spark Console looks at the Sparks again), and each case holds for longer than that.
  const settle = 15000 * SLOW;
  before(() => flat('spark3'));
  // (whatever happens here, the idle power-off is off again for the tests after these)
  after(async () => { await act('power_settings', { idleMinutes: 0 }); idle('spark3', false); rmSync(mock('spark3', 'metrics'), { force: true }); });
  async function noPowerOff(what) {
    const since = new Date().toISOString();
    await sleep(settle);
    assert.ok(!(await ops()).some(o => o.type === 'power-off' && o.startedAt > since), `${what}: nothing was powered off`);
    assert.ok(!offline().includes('spark3'), what);
  }

  test('not while something it didn’t start runs there', { timeout: 120000 * SLOW }, async () => {
    idle('spark3', true);
    const f = mock('spark3', 'containers'), was = readFileSync(f, 'utf8');
    writeFileSync(f, `${was.trimEnd()}\nhand-made|running|Up 1 minute|0||\n`);
    try {
      assert.equal((await act('power_settings', { idleMinutes: 10 })).json.outcome, 'saved');
      await noPowerOff('a hand-started container');
    } finally { writeFileSync(f, was); }
  });

  test('the first time it can act, the owner is told once, in their chat, with the minutes and the words that change it', { timeout: 120000 * SLOW }, async () => {
    const said = () => eventLines().filter(e => e.type === 'notice' && /^The idle power-off is on now:/.test(e.text || ''));
    await waitFor(() => said().length > 0, { what: 'the note' });
    // (it may first have been said while the Sparkie tests above set an hour)
    assert.match(said()[0].text, /^The idle power-off is on now: Spark 3 and Spark 4 are powered off after \d+ idle minutes, with their models parked; a call or a start turns them on again\. Spark 2 never\. To change the time, say “power off idle Sparks after an hour”; to turn it off, say “stop auto shutdown”\.$/);
    assert.match(power().activeSaidAt, /^\d{4}-\d\d-\d\dT/);
    let inChat = false;
    for (const c of (await api('/chats')).json.chats) if ((await chatMessages(c.id)).some(m => m.notice && m.content === said()[0].text)) inChat = true;
    assert.ok(inChat, 'in the owner’s chat');
    await sleep(3000 * SLOW);
    assert.equal(said().length, 1, 'said once');
  });

  test('not while its model is called at the model address', { timeout: 120000 * SLOW }, async () => {
    const stop = Date.now() + settle;
    const calls = (async () => { while (Date.now() < stop) { const c = await api('/v1/chat/completions', { method: 'POST', body: { model: 'testorg/Qwen3.8-27B-abliterated-GGUF', messages: [{ role: 'user', content: 'hi' }] } }); assert.equal(c.status, 200, c.text); await sleep(1000); } })();
    await noPowerOff('calls to its model');
    await calls;
  });

  test('not while an app it keeps running is there (only models are parked for idleness)', { timeout: 120000 * SLOW }, async () => {
    const f = mock('spark3', 'containers'), was = readFileSync(f, 'utf8'), d = join(T.fleet.stateDir, 'desired.json'), list = readFileSync(d, 'utf8');
    writeFileSync(f, `${was.trimEnd()}\nkept-app|running|Up 1 minute|app||\n`);
    const parsed = JSON.parse(list);
    parsed.running.push({ spark: 'spark3', container: 'kept-app', app: true, port: 3999, memoryGB: 1, since: new Date().toISOString(), by: 'test' });
    writeFileSync(d, JSON.stringify(parsed), { mode: 0o600 });
    try { await noPowerOff('a kept app'); } finally {
      writeFileSync(f, was);
      const now = JSON.parse(readFileSync(d, 'utf8'));
      now.running = now.running.filter(x => x.container !== 'kept-app');
      writeFileSync(d, JSON.stringify(now), { mode: 0o600 });
    }
  });

  test('not while someone is signed in to it over SSH', { timeout: 120000 * SLOW }, async () => {
    writeFileSync(mock('spark3', 'who'), 'owner pts/0 2026-11-13 10:00 (100.64.0.9)\n');
    try { await noPowerOff('an SSH session'); } finally { rmSync(mock('spark3', 'who'), { force: true }); }
  });

  test('not while its model server counts requests the console didn’t pass on (its own /metrics)', { timeout: 120000 * SLOW }, async () => {
    const f = mock('spark3', 'metrics');
    let n = 1, going = true;
    const count = () => writeFileSync(f, `# TYPE vllm:request_success_total counter\nvllm:request_success_total{finished_reason="stop",model_name="m"} ${n++}.0\nvllm:num_requests_running{model_name="m"} 0.0\n`);
    count();
    const bump = (async () => { while (going) { await sleep(1500); count(); } })();
    try { await noPowerOff('requests counted by its model server'); } finally { going = false; await bump; flat('spark3'); }
  });

  test('not while its model’s use can’t be measured (its server gives no /metrics counter)', { timeout: 120000 * SLOW }, async () => {
    rmSync(mock('spark3', 'metrics'), { force: true });
    try {
      await noPowerOff('a model whose use can’t be measured');
      const p = (await fleet()).power.bySpark.spark3;
      assert.ok((p.neededFor || []).includes('its model’s use can’t be measured (its server gives no /metrics counter)'), JSON.stringify(p));
    } finally { flat('spark3'); }
  });

  test('not while agents’ changes are paused', { timeout: 120000 * SLOW }, async () => {
    await agentSettings({ halted: true });
    try { await noPowerOff('agents paused'); } finally { await agentSettings({ halted: false }); }
  });

  test('idle for its minutes: its model is parked and it is powered off, why idle', { timeout: 240000 * SLOW }, async () => {
    const since = new Date().toISOString();
    const op = await waitFor(async () => (await ops()).find(o => o.type === 'power-off' && o.startedAt > since), { timeout: 60000, what: 'the idle power-off' });
    assert.equal(op.actor, 'Idle power-off');
    assert.equal(op.spark, 'spark3');
    { const f = await finished(op.id); assert.equal(f.status, 'completed', JSON.stringify(f)); }
    assert.ok(offline().includes('spark3'));
    assert.ok(!offline().includes('spark4'), 'Spark 4 was busy');
    assert.equal(power().off.spark3.why, 'idle');
    assert.ok(entry('spark3', T3).parked);
    assert.deepEqual(eventsSince(since, 'spark-powered-off').map(e => [e.spark, e.why]), [['spark3', 'idle']]);
    await act('power_settings', { idleMinutes: 0 });
  });

  test('start_model of the parked model turns its Spark on first, in one operation, and starts it there', { timeout: 300000 * SLOW }, async () => {
    const r = await act('start_model', { model: 'testorg/Qwen3.8-27B-abliterated-GGUF' });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.json.outcome, r.json.poweringOn], ['started', ['spark3']], r.text);
    assert.match(r.json.note, /^Spark 3 was powered off by Spark Console, so it is turned on first \(about 2 minutes\); then testorg--Qwen3\.8-27B-abliterated-GGUF starts\./);
    const w = await finished(r.json.operation);
    assert.equal(w.status, 'completed', JSON.stringify(w));
    assert.equal(w.type, 'power-on');
    assert.equal(stateOf('spark3', T3), 'running');
    assert.ok(!power().off.spark3);
    assert.equal(entry('spark3', T3).parked, undefined);
    // (llama.cpp is started with its /metrics on, once: how the idle power-off sees it used at its own address)
    const args = readFileSync(mock('spark3', 'last-run-args'), 'utf8').split('\n');
    assert.ok(args.includes('llama-server'), args.join(' '));
    assert.equal(args.filter(a => a === '--metrics').length, 1, args.join(' '));
  });
});

describe('a model across two Sparks', { concurrency: 1 }, () => {
  const HEAD = R4, MODEL = RADIX;
  const parts = () => ['spark3', 'spark4'].flatMap(sp => readFileSync(mock(sp, 'containers'), 'utf8').split('\n').filter(l => l.split('|')[4] === MODEL && l.split('|')[7] === 'spark3+spark4').map(l => l.split('|')[1]));

  test('(it starts across Spark 3 and Spark 4)', { timeout: 300000 * SLOW }, async () => {
    // (Spark 3's model was called a minute ago, so stopping it to make room is asked first: yes)
    let r = await act('start_model', { model: MODEL, sparks: ['spark3', 'spark4'] });
    if (r.json?.outcome === 'question') r = await act('start_model', { choice: r.json.choices.find(c => /^Yes/.test(c.label)).choice });
    await done(r);
    assert.deepEqual(parts(), ['running', 'running']);
  });

  test('refused at the shutdown: its parts aren’t started by a bare docker start; it is unparked and self-healing starts it again across both', { timeout: 300000 * SLOW }, async () => {
    const since = new Date().toISOString();
    writeFileSync(mock('spark4', 'poweroff-refused'), '');
    try {
      const r = await act('power_off', { spark: 'spark4' });
      const w = await finished(r.json.operation);
      assert.equal(w.status, 'failed', JSON.stringify(w));
      assert.match(w.error, /Run deploy\/power-setup\.sh once for this Spark/);
      assert.ok(w.recentLog.some(l => /self-healing starts it again across both/.test(l)), JSON.stringify(w.recentLog));
    } finally { rmSync(mock('spark4', 'poweroff-refused'), { force: true }); }
    assert.ok(!desiredFile().running.find(y => y.container === HEAD && y.sparks)?.parked, 'unparked');
    assert.deepEqual(power().off, {});
    // (self-healing tries a start twice: the one that completes; any that failed is printed if none does)
    await waitFor(async () => (await ops()).find(o => o.type === 'deploy-cluster' && o.actor === 'Self-healing' && o.startedAt > since && o.status === 'completed'),
      { timeout: 180000, what: 'self-healing starting it across both' }).catch(async e => {
      throw new Error(`${e.message}: ${JSON.stringify((await ops()).filter(o => o.type === 'deploy-cluster' && o.startedAt > since))}`);
    });
    assert.deepEqual(parts(), ['running', 'running']);
  });

  test('powering off one of its Sparks stops it on both and says so; the other stays on; healing leaves it', { timeout: 300000 * SLOW }, async () => {
    const r = await act('power_off', { spark: 'spark4' });
    assert.match(r.json.note, /sc-RadixArk--Qwen3\.8-27B-NVFP4 runs across Spark 3 and Spark 4, so it stops on both; Spark 3 stays on\./, r.text);
    await done(r);
    assert.deepEqual(parts(), ['exited', 'exited']);
    assert.ok(offline().includes('spark4') && !offline().includes('spark3'));
    const x = desiredFile().running.find(y => y.container === HEAD && y.sparks);
    assert.ok(x?.parked, JSON.stringify(desiredFile().running));
    const since = new Date().toISOString();
    await sleep(8000);
    assert.ok(!eventsSince(since).some(e => ['healing', 'heal-skipped'].includes(e.type) && e.container === HEAD), 'no bring-back of the pair');
    assert.deepEqual(parts(), ['exited', 'exited']);
  });

  test('a call to it at the model address turns Spark 4 on and starts it across both again (503 while it comes)', { timeout: 300000 * SLOW }, async () => {
    // (refused while agents' changes are paused: that doesn't keep the next call from starting it)
    await agentSettings({ halted: true });
    try {
      const p = await api('/v1/chat/completions', { method: 'POST', body: { model: 'RadixArk/Qwen3.8-27B-NVFP4', messages: [{ role: 'user', content: 'hi' }] } });
      assert.equal(p.status, 409, p.text);
      assert.match(p.json.error.message, /paused/);
    } finally { await agentSettings({ halted: false }); }
    assert.ok(offline().includes('spark4'), 'nothing was turned on');
    const c = await api('/v1/chat/completions', { method: 'POST', body: { model: 'RadixArk/Qwen3.8-27B-NVFP4', messages: [{ role: 'user', content: 'hi' }] } });
    assert.equal(c.status, 503, c.text);
    assert.match(c.json.error.message, /is starting \(operation [0-9a-f]{12}\)/);
    const id = /operation ([0-9a-f]{12})/.exec(c.json.error.message)[1];
    const w = await finished(id);
    assert.equal(w.status, 'completed', JSON.stringify(w));
    assert.deepEqual(parts(), ['running', 'running']);
    assert.ok(!offline().includes('spark4'));
    assert.deepEqual(power().off, {});
  });

  test('idle, both of its Sparks are powered off together; power_on of both brings it back across them', { timeout: 300000 * SLOW }, async () => {
    const since = new Date().toISOString(), before = plugs.commands.length;
    idle('spark3', true); idle('spark4', true);
    flat('spark3');   // (its first part answers on Spark 3, and its use there is measured)
    try {
      await act('power_settings', { idleMinutes: 3 });
      const op = await waitFor(async () => (await ops()).find(o => o.type === 'power-off' && o.startedAt > since), { timeout: 90000, what: 'the idle power-off of the pair' });
      assert.deepEqual(op.sparks, ['spark3', 'spark4']);
      { const f = await finished(op.id); assert.equal(f.status, 'completed', JSON.stringify(f)); }
    } finally { await act('power_settings', { idleMinutes: 0 }); idle('spark3', false); idle('spark4', false); rmSync(mock('spark3', 'metrics'), { force: true }); }
    assert.deepEqual(commandsSince(before).sort((a, b) => a.node - b.node), [{ node: 2, command: 'off' }, { node: 3, command: 'off' }]);
    assert.ok(offline().includes('spark3') && offline().includes('spark4'));
    await done(await act('power_on', { sparks: ['spark3', 'spark4'] }));
    assert.deepEqual(parts(), ['running', 'running']);
    assert.deepEqual(power().off, {});
  });
  test('a call for a Recipes model no sleeping Spark holds wakes nothing; one a sleeping Spark holds wakes only that Spark', { timeout: 300000 * SLOW }, async () => {
    // (both asleep, each record listing the models on its disk)
    await done(await act('power_off', { sparks: ['spark3', 'spark4'] }));
    assert.ok(Array.isArray(power().off.spark4.models) && power().off.spark4.models.includes('unsloth--Qwen3.8-27B-NVFP4'), JSON.stringify(power().off.spark4));
    let before = plugs.commands.length;
    const none = await api('/v1/chat/completions', { method: 'POST', body: { model: 'paddleocr-vl-1.6', messages: [{ role: 'user', content: 'hi' }] } });
    assert.equal(none.status, 409, none.text);
    assert.match(none.json.error.message, /isn’t on your Sparks: a call doesn’t download models/);
    assert.deepEqual(commandsSince(before), [], 'nothing was turned on');
    before = plugs.commands.length;
    const c = await api('/v1/chat/completions', { method: 'POST', body: { model: 'unsloth/Qwen3.8-27B-NVFP4', messages: [{ role: 'user', content: 'hi' }] } });
    assert.equal(c.status, 503, c.text);
    const w = await finished(/operation ([0-9a-f]{12})/.exec(c.json.error.message)[1]);
    assert.equal(w.status, 'completed', JSON.stringify(w));
    assert.deepEqual(commandsSince(before), [{ node: 3, command: 'on' }], 'only Spark 4');
    assert.ok(offline().includes('spark3') && !offline().includes('spark4'));
    assert.equal(stateOf('spark4', 'sc-unsloth--Qwen3.8-27B-NVFP4'), 'running');
    assert.ok(desiredFile().running.find(y => y.container === HEAD && y.sparks)?.parked, 'the pair stays parked while Spark 3 sleeps');
  });

  test('both turned on outside Spark Console in the same round while paused: the pair is unparked (held), both records go', { timeout: 300000 * SLOW }, async () => {
    await done(await act('stop_model', { spark: 'spark4', container: 'sc-unsloth--Qwen3.8-27B-NVFP4' }));
    await done(await act('power_off', { spark: 'spark4' }));
    assert.ok(power().off.spark3 && power().off.spark4);
    // (both records older than the 5 s the came-back check waits, so both are taken back in the same round)
    await sleep(6000);
    await agentSettings({ halted: true });
    try {
      for (const node of [2, 3]) { const n = plugs.node(node); n.attributes = { ...n.attributes, '1/6/0': true }; }
      writeFileSync(T.fleet.offlineFile, 'spark1\n');
      await waitFor(() => !power().off.spark3 && !power().off.spark4, { timeout: 60000, what: 'both records cleared' });
      assert.equal(desiredFile().running.find(y => y.container === HEAD && y.sparks)?.parked, undefined, 'unparked');
      const x = await waitFor(async () => (await look('should_be_running')).running.find(y => y.container === HEAD && y.state === 'held'), { what: 'held' });
      assert.equal(x.state, 'held');
    } finally { await agentSettings({ halted: false }); }
  });
});
