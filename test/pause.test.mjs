// Covers: Agents pausing themselves (`SPARK_CONSOLE_AGENT_CHANGES_PER_HOUR=3` here): three failed agent operations in a
// row; 3 changes in an hour (an agent's and Sparkie's count; an `already`, and the owner's button press, don't); then a
// change is refused (403), settings show `halted` and `autoPaused`, a notice is in `events.jsonl` and an audit line
// `pause-agents`; Sparkie is paused too, the owner's buttons still run; resuming. The service's clock moves an hour
// between the cases. The owner's own failed work: three failed `POST /actions` operations, then three started by
// Sparkie in the owner's chat (the job marked `ownersOwn`), don't pause.
//
// Agents pause themselves: outside agents, Sparkie and self-healing (anything but the owner on the page) stop changing
// things after SPARK_CONSOLE_AGENT_CHANGES_PER_HOUR changes in an hour (3 here; start-mock.mjs sets 1000 for the other
// files) or after three failed operations in a row. Only changes that started an operation count. Pausing sets the
// owner's "paused" switch, puts a notice in Activity (events.jsonl) and writes an audit line (pause-agents).
// The service's clock is moved ahead an hour between the two cases with mock/clock.mjs. The owner's own failed work
// (POST /actions, or what Sparkie started in the owner's own chat) never counts toward the three failures.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, call, createActKey, createKey, agentSettings, auditLines, eventLines, newChat, say, choose, sleep, waitFor, bug, SLOW } from './lib.mjs';
import { TEST_DIR } from './start-mock.mjs';

const keys = {};
useFleet({ watchMs: 60000, env: { SPARK_CONSOLE_AGENT_CHANGES_PER_HOUR: '3', NODE_OPTIONS: `--import=${join(TEST_DIR, 'mock', 'clock.mjs')}` } }, async () => {
  keys.act = await createActKey('pause-act');
  keys.look = await createKey('pause-look');
});

const mock = (spark, file) => join(T.fleet.root, spark, '.mock', file);
const stateOf = (spark, name) => readFileSync(mock(spark, 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];
const addContainer = (spark, line) => writeFileSync(mock(spark, 'containers'), readFileSync(mock(spark, 'containers'), 'utf8') + `${line}\n`);
const setClock = async ms => { writeFileSync(join(T.fleet.dir, 'clock-offset'), String(ms)); await sleep(400); };
async function ok(name, args, token = keys.act.token) {
  const r = await call(token, name, args);
  assert.equal(r.isError, false, `${name} ${JSON.stringify(args)}: ${r.text}`);
  return r.value;
}
async function finished(id) {
  for (const until = Date.now() + 240000 * SLOW; ;) {
    const w = await ok('wait_operation', { id, seconds: 20 }, keys.look.token);
    if (w.status !== 'running') return w;
    if (Date.now() > until) throw new Error(`operation ${id} still running after ${240 * SLOW} s: ${JSON.stringify(w)}`);
  }
}
const settings = async () => (await api('/agents')).json.settings;
const RADIX = 'sc-RadixArk--Qwen3.8-27B-NVFP4';

describe('agents pause themselves', () => {
  test('after three of their operations fail in a row', { timeout: 90000 * SLOW }, async () => {
    // Stopped models of Spark Console's that can't start again while RADIX holds spark4's serve port.
    for (let i = 1; i <= 3; i++) addContainer('spark4', `sc-fails-${i}|exited|Exited (0) just now|1|Qwen--Qwen3-32B||||`);
    const fromAudit = auditLines().length, fromEvents = eventLines().length;
    for (let i = 1; i <= 3; i++) {
      const x = await ok('restart_model', { spark: 'spark4', container: `sc-fails-${i}` });
      const w = await finished(x.operation);
      assert.equal(w.status, 'failed', JSON.stringify(w));
      assert.match(w.error, /port is already allocated/);
      if (i < 3) assert.equal((await settings()).halted, false, `not after ${i}`);
    }
    await new Promise(r => setTimeout(r, 300));
    const st = await settings();
    assert.equal(st.halted, true, 'paused after the third');
    assert.equal(st.autoPaused, true, 'marked as automatic');
    const notice = eventLines().slice(fromEvents).find(e => e.type === 'notice');
    assert.match(notice?.text || '', /^Agents’ changes were paused automatically: three of their operations failed in a row\./);
    const line = auditLines().slice(fromAudit).find(l => l.action === 'pause-agents');
    assert.deepEqual([line?.via, line?.actor, line?.ok, line?.args?.why], ['console', 'Safety pause', true, 'three of their operations failed in a row']);
    const r = await call(keys.act.token, 'stop_model', { spark: 'spark4', container: RADIX });
    assert.equal(r.isError, true);
    assert.match(r.text, /^\[not_allowed\] Agents’ changes are paused \(Access → Agents\)/);
    assert.equal(stateOf('spark4', RADIX), 'running');
    // Reads keep working.
    await ok('fleet_status', {}, keys.look.token);
  });

  // (four operations in a row: a few minutes on the stand-in fleet under the whole suite's load)
  test('after 3 changes in an hour (only ones that started an operation count; the owner\'s own don\'t)', { timeout: 360000 * SLOW }, async () => {
    // An hour later (the failures above were changes too), and the owner resumes them.
    await setClock(61 * 60000);
    assert.equal((await agentSettings({ halted: false })).halted, false);
    const fromAudit = auditLines().length, fromEvents = eventLines().length;
    // 1: an agent stops RADIX.
    let x = await ok('stop_model', { spark: 'spark4', container: RADIX });
    assert.equal((await finished(x.operation)).status, 'completed');
    // (not counted) the owner presses Sparkie's button to restart it; an agent's start of something already running.
    const chat = await newChat();
    const proposal = await say(chat, `should I restart ${RADIX} on spark 4?`);
    const pressed = await choose(chat, proposal.message.choices[0].id);
    assert.equal(pressed.status, 200, pressed.text);
    assert.equal((await finished(pressed.json.operation)).status, 'completed');
    assert.equal((await ok('start_model', { model: 'gpt-oss-20b' })).outcome, 'already');
    // 2: Sparkie stops it, asked in a chat. (Which container the words name is read from the watcher's last look, here
    // once a minute: on a fast machine that look can still be from before the restart, and the stop is then a button.)
    await waitFor(async () => (await ok('workloads', { spark: 'spark4' }, keys.look.token)).workloads.some(w => w.name === RADIX && w.running), { timeout: 90000, every: 1000, what: 'the watcher seeing it running again' });
    const sparkie = await say(chat, `stop ${RADIX} on spark 4`);
    assert.match(sparkie.text, /"outcome":"started"/);
    const sparkieOp = auditLines().findLast(l => l.via === 'sparkie' && l.action === 'stop_model' && l.ok).operation;
    assert.equal((await finished(sparkieOp)).status, 'completed');
    // 3: an agent starts it again.
    x = await ok('restart_model', { spark: 'spark4', container: RADIX });
    assert.equal((await finished(x.operation)).status, 'completed');
    assert.equal((await settings()).halted, false, 'not paused yet');
    // (a button the owner can press later; offering it changes nothing)
    const q = await say(chat, `should I stop ${RADIX} on spark 4?`);
    assert.equal(q.message.choices?.length, 1, q.text);
    // The next change is refused, and that pauses agents.
    const r = await call(keys.act.token, 'stop_model', { spark: 'spark4', container: RADIX });
    assert.equal(r.isError, true, r.text);
    assert.match(r.text, /^\[not_allowed\] Agents’ changes are paused: too many in the last hour\./);
    assert.equal(stateOf('spark4', RADIX), 'running');
    assert.equal((await settings()).halted, true);
    const notice = eventLines().slice(fromEvents).find(e => e.type === 'notice');
    assert.match(notice?.text || '', /^Agents’ changes were paused automatically: 3 changes in the last hour\./);
    const line = auditLines().slice(fromAudit).find(l => l.action === 'pause-agents');
    assert.deepEqual([line?.actor, line?.args?.why], ['Safety pause', '3 changes in the last hour']);
    // Sparkie is paused too; the owner on the page isn't: a button they press runs.
    const s = await say(chat, `stop ${RADIX} on spark 4`);
    assert.match(s.text, /stop_model said: \[error\] Agents’ changes are paused \(Access → Agents\)/);
    assert.equal(stateOf('spark4', RADIX), 'running');
    const p = await choose(chat, q.message.choices[0].id);
    assert.equal(p.status, 200, p.text);
    assert.equal(p.json.outcome, 'started', p.text);
    assert.equal((await finished(p.json.operation)).status, 'completed');
    assert.equal(stateOf('spark4', RADIX), 'exited');
  });

  test('once the owner resumes them, the next change goes through',
    { timeout: 60000 * SLOW }, async () => {
      const resumed = await agentSettings({ halted: false });
      assert.deepEqual([resumed.halted, resumed.autoPaused], [false, false]);
      const r = await call(keys.act.token, 'restart_model', { spark: 'spark4', container: RADIX });
      assert.equal(r.isError, false, r.text);
      assert.equal((await finished(r.value.operation)).status, 'completed');
      assert.equal((await settings()).halted, false);
    });
});

// F25 (review, 2026-11-11): the owner's own failures aren't a looping agent.
describe('the owner\'s own failed work', () => {
  const OWN = 'sc-Qwen--Qwen3-32B';
  test('three failed operations of the owner\'s own (POST /actions, then Sparkie in the owner\'s chat) don\'t pause agents', { timeout: 300000 * SLOW }, async () => {
    // (another hour on, so earlier changes leave the hour's count; RADIX runs on spark4 and holds its serve port, so a
    // start of OWN there fails)
    await setClock(2 * 61 * 60000);
    assert.equal((await settings()).halted, false);
    assert.equal(stateOf('spark4', RADIX), 'running');
    const fromEvents = eventLines().length;
    for (let i = 1; i <= 3; i++) {
      const r = await api('/actions/restart_model', { method: 'POST', body: { spark: 'spark4', container: OWN } });
      assert.equal(r.status, 200, r.text);
      const w = await finished(r.json.operation);
      assert.equal(w.status, 'failed', JSON.stringify(w));
      assert.match(w.error, /port is already allocated/);
    }
    await sleep(300);
    assert.equal((await settings()).halted, false, 'the owner\'s API calls don\'t count');
    const chat = await newChat();
    for (let i = 1; i <= 3; i++) {
      const from = auditLines().length;
      const s = await say(chat, `restart ${OWN} on spark 4`);
      assert.match(s.text, /"outcome":"started"/);
      const op = auditLines().slice(from).findLast(l => l.via === 'sparkie' && l.action === 'restart_model' && l.ok).operation;
      assert.equal((await finished(op)).status, 'failed');
      assert.equal((await api(`/jobs/${op}`)).json.ownersOwn, true);
    }
    await sleep(300);
    assert.equal((await settings()).halted, false, 'the owner\'s chat doesn\'t count');
    assert.ok(!eventLines().slice(fromEvents).some(e => e.type === 'notice' && /paused automatically/.test(e.text || '')));
  });
});
