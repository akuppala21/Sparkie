// Covers: the hub moved to Spark 1 (the owner's decision of 2026-11-16; R1, R41, R60, R70, R55): on a stand-in fleet
// whose hub is spark1, as service/config.json ships it, with access.json still marking spark2 local (a list made before
// the move), the hub is config.json's alone. The console's one address is akspark1's. The brain's own start goes to
// Spark 1 and nowhere else; a model is never started there and starts on Spark 2 as on any compute Spark; power-off,
// parking and the plug never touch Spark 1 (its plug named in plugs.json, not read-only) and work for Spark 2; a change
// on Spark 1 is asked, a lock-out change there refused, root there refused, while Spark 2 takes root as a compute Spark
// does; a command on a compute Spark aimed at Spark 1, by any name it goes by, is refused, and one aimed at Spark 2 is
// not; every answer names Spark 1 and none says Spark 2 where it means the hub. The real root helper set up and proven
// for Spark 1 (test/rehearsal.mjs, run: true), called through a stand-in systemd-run --user; the stand-in plug
// controller (test/mock/plugs.mjs). Linux only: run it on a Spark with tools/test-on-spark.sh.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync, cpSync, rmSync, realpathSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { T, useFleet, api, newChat, say, choose, waitFor, REPO, SLOW } from './lib.mjs';
import { rehearse } from './rehearsal.mjs';
import { startPlugs } from './mock/plugs.mjs';

const MOCKBIN = join(REPO, 'test', 'mock', 'bin');
// (a stand-in for the owner's service manager on the hub, as hub-change.test.mjs has it: systemd-run --user runs the
// call; the unit calls go to the stand-in systemd-run. A folder of its own, left where it is.)
const BIN = realpathSync(mkdtempSync(join(tmpdir(), 'hub-move-bin-')));
writeFileSync(join(BIN, 'systemd-run'), `#!/bin/bash
if [ "$1" = --user ]; then
  printf '%s\\n' "$*" >> "$HOME/.user-units"
  while [ $# -gt 0 ] && [ "\${1#-}" != "$1" ]; do shift; done
  exec "$@"
fi
exec ${MOCKBIN}/systemd-run "$@"
`, { mode: 0o755 });
// The hub's plug is node 5, named in plugs.json WITHOUT readOnly and taking commands at the controller: only the rule
// from config.json's hub keeps it from being switched. Spark 2's is node 2.
const plugs = await startPlugs([
  { node_id: 2, available: true, attributes: { '1/6/0': true, '1/144/8': 0, '1/144/4': 121000, '1/144/5': 0 } },
  { node_id: 5, available: true, attributes: { '1/6/0': true, '1/144/8': 150000, '1/144/4': 121000, '1/144/5': 1300 } },
]);
after(() => plugs.close());
const MODEL = 'gpt-oss-20b', C2 = `sc-${MODEL}`;
const NEW_ORIGIN = 'https://akspark1.tailab9aa9.ts.net:8443';
useFleet({
  hub: 'spark1', statusMs: 1500, watchMs: 1500,
  env: {
    PATH: `${BIN}:${MOCKBIN}:${process.env.PATH}`, SPARK_CONSOLE_HUB: '1', SPARK_CONSOLE_NET: '1',
    SPARK_CONSOLE_PLUGS_URL: plugs.url, SPARK_CONSOLE_PLUGS_MS: '500',
    SPARK_CONSOLE_POWER_MS: '1000', SPARK_CONSOLE_POWER_FIRST_MS: '1000', SPARK_CONSOLE_IDLE_MINUTE_MS: String(1000 * SLOW),
    SPARK_CONSOLE_POWER_POLL_MS: '300', SPARK_CONSOLE_POWER_OFF_WAIT_MS: String(8000 * SLOW), SPARK_CONSOLE_POWER_ON_WAIT_MS: String(30000 * SLOW),
    SPARK_CONSOLE_POWER_CYCLE_MS: '300', SPARK_CONSOLE_POWER_HOLD_MS: String(3000 * SLOW), SPARK_CONSOLE_CONNECT_MS: String(20000 * SLOW),
  },
  prepare: ({ dir, root, stateDir }) => {
    rehearse(root, 'spark1', { run: true });
    // Spark 2, a compute Spark now: on, with a model on its disk and the images to start it.
    cpSync(join(root, 'spark3', 'models', MODEL), join(root, 'spark2', 'models', MODEL), { recursive: true });
    writeFileSync(join(root, 'spark2', '.mock', 'images'), readFileSync(join(root, 'spark3', '.mock', 'images')));
    writeFileSync(join(dir, 'offline'), '\n');
    writeFileSync(join(stateDir, 'plugs.json'), JSON.stringify({ spark1: { node: 5 }, spark2: { node: 2 } }), { mode: 0o600 });
    writeFileSync(join(stateDir, 'power.json'), JSON.stringify({ idleMinutes: 0, off: {} }), { mode: 0o600 });
  },
}, async () => { plugs.attach({ offlineFile: T.fleet.offlineFile, sparks: { 2: 'spark2' }, bootMs: 1500 }); });

const mock = (spark, f) => join(T.fleet.root, spark, '.mock', f);
const containers = spark => (existsSync(mock(spark, 'containers')) ? readFileSync(mock(spark, 'containers'), 'utf8') : '');
const stateOf = (spark, name) => containers(spark).split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];
const offline = () => readFileSync(T.fleet.offlineFile, 'utf8').split(/\s+/).filter(Boolean);
const power = () => JSON.parse(readFileSync(join(T.fleet.stateDir, 'power.json'), 'utf8'));
const desired = () => JSON.parse(readFileSync(join(T.fleet.stateDir, 'desired.json'), 'utf8')).running;
const act = (name, args) => api(`/actions/${name}`, { method: 'POST', body: args });
const look = async (name, args = {}) => { const r = await act(name, args); assert.equal(r.status, 200, r.text); return r.json; };
const run = (on, command, more = {}) => act('run', { on, command, ...more });
const lines = file => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
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
// Words the owner reads about the hub: they name Spark 1, never Spark 2.
const namesTheHub = (text, what) => {
  assert.match(String(text), /Spark 1/, `${what} names Spark 1: ${text}`);
  assert.doesNotMatch(String(text), /Spark 2/, `${what} never says Spark 2: ${text}`);
};
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const noScript = () => rmSync(join(T.fleet.dir, 'model-script.json'), { force: true });
// One owner's message, the stand-in brain calling run once on the hub; then what run answered it.
async function inChat(chat, words, command) {
  script([{ match: `^${words}$`, rounds: [[{ name: 'run', arguments: { on: 'spark1', command, dir: '~' } }]] }]);
  let r;
  try { r = await say(chat, words); } finally { noScript(); }
  const x = lines(join(T.fleet.dir, 'model-requests.jsonl')).filter(m => m.words === words && m.lastRole === 'tool').at(-1);
  const sent = String(x?.results?.[0]?.content ?? '');
  return { r, error: sent.startsWith('[error] ') ? sent.slice(8) : null, value: sent.startsWith('[error] ') ? null : JSON.parse(sent || 'null') };
}
const answering = () => waitFor(async () => { const m = (await api('/main')).json; return m.state === 'running' && m.healthy === true; }, { timeout: 90000 * SLOW, what: 'Sparkie answering' });

test('the console’s one address is akspark1’s: the fleet’s origin, the page’s (bootstrap), and a write from the old one is refused', async () => {
  assert.equal(T.fleet.origin, NEW_ORIGIN);
  assert.equal((await api('/bootstrap')).json.main, NEW_ORIGIN);
  const old = await api('/actions/fleet_status', { method: 'POST', body: {}, headers: { origin: 'https://akspark2.tailab9aa9.ts.net:8443' } });
  assert.equal(old.status, 403, old.text);
  assert.equal((await act('fleet_status', {})).status, 200);
});

test('the tools and the brain’s abilities name the hub as Spark 1', async () => {
  const actions = (await api('/actions')).json.actions, text = name => actions.find(a => a.name === name)?.description || '';
  assert.match(text('run'), /on any Spark \(Spark 1 too\)/);
  assert.match(text('run'), /On Spark 1 every change is asked, and one that could lock the owner out is refused\./);
  assert.match(text('write_file'), /Never on Spark 1, as root,/);
  assert.match(text('power_off'), /Refused for Spark 1 \(it runs Spark Console and Sparkie\)/);
  for (const a of actions) assert.doesNotMatch(a.description, /Spark 2/, a.name);
  const can = JSON.stringify((await look('sparkie_setup', { about: 'abilities' })));
  assert.match(can, /On Spark 1 every change is asked and runs inside the net/);
  assert.doesNotMatch(can, /Spark 2/);
});

test('the brain’s own start goes to Spark 1 and nowhere else', { timeout: 300000 * SLOW }, async () => {
  await answering();
  assert.equal((await api('/main')).json.node, 'spark1');
  for (const path of ['/main/stop', '/main/start']) {
    const r = await api(path, { method: 'POST', body: {} });
    assert.equal(r.status, 202, r.text);
    const j = await waitFor(async () => { const x = (await api(`/jobs/${r.json.id}`)).json; return x.status !== 'running' && x; }, { timeout: 180000 * SLOW, what: `${path} to end` });
    assert.equal(j.status, 'completed', JSON.stringify(j));
    assert.equal(j.node, 'spark1', JSON.stringify(j));
  }
  assert.equal(stateOf('spark1', 'sparkie-main'), 'running');
  for (const spark of ['spark2', 'spark3', 'spark4']) assert.equal(stateOf(spark, 'sparkie-main'), undefined, `no brain on ${spark}`);
  await answering();
});

test('a model is never started on Spark 1, and starts on Spark 2 as on any compute Spark', { timeout: 300000 * SLOW }, async () => {
  const hubBefore = containers('spark1');
  const r = await act('start_model', { model: MODEL, spark: 'spark1' });
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.error, 'Spark 1 is Sparkie’s (the brain’s), so no other workload starts there. Pick another Spark.');
  assert.equal(containers('spark1'), hubBefore, 'nothing changed on Spark 1');
  await done(await act('start_model', { model: MODEL, spark: 'spark2' }));
  assert.equal(stateOf('spark2', C2), 'running');
  assert.equal(containers('spark1'), hubBefore, 'nothing changed on Spark 1');
});

test('Spark 1 is never powered off or on, nor its plug switched, though plugs.json names it without readOnly', async () => {
  const before = plugs.commands.length;
  for (const name of ['power_off', 'power_on']) {
    const r = await act(name, { spark: 'spark1' });
    assert.equal(r.status, 403, r.text);
    assert.match(r.json.error, /^Spark 1 runs Spark Console and Sparkie, so it is never powered off or on from here/);
    namesTheHub(r.json.error, name);
  }
  assert.equal((await act('power_off', { sparks: ['spark1', 'spark2'] })).status, 403);
  const p = await waitFor(async () => (x => (x.bySpark.spark2?.state === 'on' ? x : null))((await look('fleet_status')).power), { what: 'Spark 2’s plug read' });
  assert.equal(p.bySpark.spark1?.neededFor, undefined, 'the hub’s plug is never one that may be switched');
  assert.ok(Array.isArray(p.bySpark.spark2.neededFor), JSON.stringify(p.bySpark.spark2));
  const set = await look('power_settings', { idleMinutes: 30 });
  try {
    assert.match(set.note, /\(never Spark 1\)/);
    namesTheHub(set.note, 'the idle power-off’s note');
  } finally { await look('power_settings', { idleMinutes: 0 }); }
  assert.deepEqual(plugs.commands.slice(before), [], 'no plug command');
  assert.deepEqual(power().off, {});
});

test('Spark 2 powers off with its model parked and its plug switched, and comes back on with it; Spark 1’s plug is never sent a command', { timeout: 300000 * SLOW }, async () => {
  const before = plugs.commands.length;
  const off = await act('power_off', { spark: 'spark2' });
  assert.deepEqual(off.json.stops, [`spark2/${C2}`], off.text);
  await done(off);
  assert.deepEqual(plugs.commands.slice(before), [{ node: 2, command: 'off' }]);
  assert.ok(offline().includes('spark2'));
  assert.equal(stateOf('spark2', C2), 'exited');
  assert.ok(desired().find(x => x.spark === 'spark2' && x.container === C2)?.parked, JSON.stringify(desired()));
  assert.deepEqual(power().off.spark2?.parked, [`spark2/${C2}`]);
  const on = await act('power_on', { spark: 'spark2' });
  assert.deepEqual(on.json.bringsBack, [C2], on.text);
  await done(on);
  assert.ok(!offline().includes('spark2'));
  assert.equal(stateOf('spark2', C2), 'running');
  assert.deepEqual(plugs.commands.slice(before), [{ node: 2, command: 'off' }, { node: 2, command: 'on' }]);
  assert.ok(!plugs.commands.some(c => c.node === 5), 'the hub’s plug was never sent a command');
  assert.equal(stateOf('spark1', 'sparkie-main'), 'running');
});

test('on Spark 1 a change is asked, from the API not run, a lock-out change refused, and root refused, each in words naming Spark 1', { timeout: 120000 * SLOW }, async () => {
  const api0 = await run('spark1', 'echo api > notes/api.txt', { dir: '~' });
  assert.equal(api0.status, 409, api0.text);
  assert.equal(api0.json.error, 'Not run: every change on Spark 1 is asked with a button, one command a press. Ask for it in your chat with Sparkie. Nothing ran.');
  const lock = await run('spark1', `printf '%s\\n' 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHub other@hub' >> .ssh/authorized_keys`, { dir: '~' });
  assert.equal(lock.status, 403, lock.text);
  assert.match(lock.json.error, /^Not done on Spark 1: a change that can lock you out of Spark 1 is never made from Spark Console, which runs there: if it cut you off, nothing here could put it back\. Make it by hand on Spark 1, in your own terminal\./);
  namesTheHub(lock.json.error, 'the lock-out refusal');
  const root = await run('spark1', 'id', { root: true });
  assert.equal(root.status, 403, root.text);
  assert.equal(root.json.error, 'Spark 1 runs Spark Console and the brain, so nothing runs there as root.');
  const sudo = await run('spark1', 'sudo touch notes/r.txt', { dir: '~' });
  assert.equal(sudo.status, 403, sudo.text);
  assert.equal(sudo.json.error, 'Nothing ran: Spark 1 runs Spark Console and the brain, so nothing runs there as root.');
  const refused = await run('spark1', 'docker restart sparkie-main', { dir: '~' });
  assert.equal(refused.status, 403, refused.text);
  assert.equal(refused.json.error, 'Not done on Spark 1: it would stop, restart, remove or change the brain’s container or its model files. Spark 1 runs only Spark Console and the brain; nothing was asked or run.');
  await answering();
  const chat = await newChat(), c = await inChat(chat, 'fix the hub notes on spark 1', 'echo hub > notes/hub.txt');
  try {
    assert.equal(c.value?.outcome, 'needs-ok', JSON.stringify(c.value ?? c.error));
    assert.match(c.value.question, /^Run this on Spark 1\?\n\$ echo hub > notes\/hub\.txt\nAsked because every change on Spark 1 is asked, one command a press: it runs Spark Console and the brain\.\n/);
    assert.match(c.value.question, /These are Spark Console’s own checks, made on Spark 1 itself/);
    assert.doesNotMatch(c.value.question, /Spark 2/);
  } finally { const no = c.r?.message?.choices?.find(x => x.label === 'No'); if (no) await choose(chat, no.id); }
  for (const f of ['notes/api.txt', 'notes/r.txt', 'notes/hub.txt']) assert.ok(!existsSync(join(T.fleet.root, 'spark1', f)), `${f}: nothing ran`);
  assert.equal(stateOf('spark1', 'sparkie-main'), 'running');
});

test('Spark 2 takes root as a compute Spark does: its one-time command, sent through Spark 1’s address, with no --hub', async () => {
  const r = await run('spark2', 'id', { root: true });
  assert.doesNotMatch(r.text, /runs Spark Console and the brain/, r.text);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.ran, false, r.text);
  assert.match(r.json.ownerCommand || '', /^ssh -t \S+@akspark1\.tailab9aa9\.ts\.net 'bash ~\/spark-console-src\/deploy\/root-for-sparkie\.sh (?:--with-root )?2'$/, r.text);
});

test('a command on a compute Spark aimed at Spark 1, by any name it goes by, is refused; one aimed at Spark 2 is not', { timeout: 60000 * SLOW }, async () => {
  for (const [command, host] of [['ssh spark1 uptime', 'spark1'], ['ssh akspark1 uptime', 'akspark1'], ['ssh owner@100.64.0.1 ls', '100.64.0.1'],
    ['ssh owner@akspark1.tailab9aa9.ts.net uptime', 'akspark1.tailab9aa9.ts.net']]) {
    const r = await run('spark3', command);
    assert.equal(r.status, 403, `${command}: ${r.text}`);
    assert.equal(r.json.error, `Not done: ssh reaches Spark 1 (“${host}”): a command for Spark 1 is run on Spark 1 (run with on: "spark1"), where its own rules hold, never from another Spark.`, command);
  }
  for (const command of ['ssh spark2 uptime', 'ssh owner@100.64.0.2 ls']) {
    const r = await run('spark3', command);
    assert.doesNotMatch(String(r.json?.error || ''), /reaches Spark/, `${command}: ${r.text}`);
  }
});
