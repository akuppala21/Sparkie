// Covers: A power-off and the box (R1-13; 21-power-box.mjs; R56, R62). The box Spark Console opened is its own: a
// power-off the owner asks for says a box is open there, whose it is and what its folder holds, and ends it (container
// and folder) inside the operation before the Spark goes down; a box of a chat whose task is still under way is the
// owner's question first, and the yes ends it and powers off. A container named and labelled like a box that this
// console doesn't have open refuses the power-off in words that say what it is, never "started outside Spark Console".
// A parked model whose bring-back after a power-on fails with a key in its error keeps no key in events.jsonl (R7).
//
// The stand-in fleet as in workloads-agent.test.mjs: plugs on Sparks 3 (node 2) and 4 (node 3), Spark 2's read only, the
// stand-in sudo shuts a Spark down. The box's pinned image is on Sparks 3 and 4 from the start, so a box opens at once.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, appendFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { T, useFleet, api, newChat, say, waitFor, eventLines, REPO, SLOW } from './lib.mjs';
import { startPlugs } from './mock/plugs.mjs';

const NODES = [
  { node_id: 2, available: true, attributes: { '1/6/0': true, '1/144/8': 0, '1/144/4': 121000, '1/144/5': 0 } },
  { node_id: 3, available: true, attributes: { '1/6/0': true, '1/144/8': 0, '1/144/4': 121000, '1/144/5': 0 } },
  { node_id: 5, available: true, readOnly: true, attributes: { '1/6/0': true, '1/144/8': 150000, '1/144/4': 121000, '1/144/5': 1300 } },
];
const IMAGE = JSON.parse(readFileSync(join(REPO, 'service', 'config.json'), 'utf8')).work?.images?.python;
const plugs = await startPlugs(NODES);
after(() => plugs.close());
useFleet({
  statusMs: 1500, watchMs: 1500,
  env: {
    SPARK_CONSOLE_PLUGS_URL: plugs.url, SPARK_CONSOLE_PLUGS_MS: '500',
    SPARK_CONSOLE_POWER_MS: '1000', SPARK_CONSOLE_POWER_FIRST_MS: '1000', SPARK_CONSOLE_POWER_POLL_MS: '300',
    SPARK_CONSOLE_POWER_OFF_WAIT_MS: String(8000 * SLOW), SPARK_CONSOLE_POWER_ON_WAIT_MS: String(30000 * SLOW),
    SPARK_CONSOLE_POWER_CYCLE_MS: '300', SPARK_CONSOLE_POWER_HOLD_MS: String(3000 * SLOW), SPARK_CONSOLE_HEAL_SETTLE_MS: '2000',
    SPARK_CONSOLE_DESIRED_MS: '1500',
  },
  prepare: ({ root, stateDir }) => {
    writeFileSync(join(stateDir, 'plugs.json'), JSON.stringify({ spark2: { node: 5, readOnly: true }, spark3: { node: 2 }, spark4: { node: 3 } }), { mode: 0o600 });
    writeFileSync(join(stateDir, 'power.json'), JSON.stringify({ idleMinutes: 0, off: {} }), { mode: 0o600 });
    for (const [spark, name] of [['spark3', 'qwen-recipe-chisel'], ['spark4', 'qwen-recipe-aphex3k']]) {
      const f = join(root, spark, '.mock', 'containers');
      writeFileSync(f, readFileSync(f, 'utf8').split('\n').filter(l => !l.startsWith(`${name}|`)).join('\n'));
      appendFileSync(join(root, spark, '.mock', 'images'), `${IMAGE}\n`);
    }
  },
}, async () => {
  plugs.attach({ offlineFile: T.fleet.offlineFile, sparks: { 2: 'spark3', 3: 'spark4' }, bootMs: 1500 });
});

const RADIX = 'sc-RadixArk--Qwen3.8-27B-NVFP4', DECOY = 'spark-console-box-0123456789ab';
const boxName = key => `spark-console-box-${createHash('sha256').update(key).digest('hex').slice(0, 12)}`;
const act = (name, args) => api(`/actions/${name}`, { method: 'POST', body: args });
const opEnd = (id, what, timeout = 240000 * SLOW) => waitFor(async () => { const o = (await api(`/jobs/${id}`)).json; return o?.status && o.status !== 'running' ? o : null; }, { timeout, what, every: 250 });
const mock = (spark, f) => join(T.fleet.root, spark, '.mock', f);
const lines = spark => readFileSync(mock(spark, 'containers'), 'utf8').split('\n').filter(Boolean);
const stateOf = (spark, name) => lines(spark).find(l => l.startsWith(`${name}|`))?.split('|')[1];
const hasBox = (spark, name) => lines(spark).some(l => l.startsWith(`${name}|`) && l.split('|')[3] === 'box');
const folder = (spark, name) => join(T.fleet.root, spark, '.local/share/spark-console/work', name);
const offline = () => readFileSync(T.fleet.offlineFile, 'utf8').split(/\s+/).filter(Boolean);
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));

describe('a power-off the owner asks for, with Spark Console’s own box open there', { concurrency: 1 }, () => {
  before(async () => {
    // (the list of what should be running seeded from what runs, so a power-off parks Spark 4's model on it)
    await waitFor(async () => (await act('should_be_running', {})).json?.running?.some(x => x.spark === 'spark4' && x.container === RADIX), { timeout: 60000 * SLOW, what: 'the list seeded' });
    // (Spark 3's models stopped first, so its power-off parks nothing and asks nothing about them)
    for (const m of (await act('running_models', {})).json.models.filter(x => x.spark === 'spark3' && x.container?.startsWith('sc-'))) {
      const s = await act('stop_model', { spark: 'spark3', container: m.container });
      assert.equal((await opEnd(s.json.operation, 'the stop')).status, 'completed');
    }
  }, { timeout: 180000 * SLOW });

  test('one named and labelled like a box that Spark Console doesn’t have open refuses it, in words that say what it is', { timeout: 120000 * SLOW }, async () => {
    appendFileSync(mock('spark3', 'containers'), `${DECOY}|running|Up 1 second|box||||||\n`);
    try {
      const before = plugs.commands.length, r = await act('power_off', { spark: 'spark3' });
      assert.equal(r.status, 409, r.text);
      assert.match(r.json.error, new RegExp(`^Spark 3 is in use: ${DECOY} \\(labelled as a box, but not one Spark Console has open now: one left from before a restart ends by itself within 2 hours of opening\\) runs there\\.`));
      assert.doesNotMatch(r.json.error, /started outside Spark Console/);
      assert.deepEqual(plugs.commands.slice(before), []);
    } finally {
      writeFileSync(mock('spark3', 'containers'), lines('spark3').filter(l => !l.startsWith(`${DECOY}|`)).map(l => `${l}\n`).join(''));
    }
  });

  test('a box of no task under way: said in the answer, ended with its folder inside the operation, and the Spark goes down', { timeout: 300000 * SLOW }, async () => {
    const name = boxName('api owner');
    const b = await act('run', { on: 'box', command: 'echo hi > a.txt' });
    assert.deepEqual([b.status, b.json?.box, b.json?.spark, b.json?.name], [200, 'opened', 'spark3', name], b.text);
    assert.ok(hasBox('spark3', name) && existsSync(join(folder('spark3', name), 'a.txt')));
    const r = await act('power_off', { spark: 'spark3' });
    assert.equal(r.json?.outcome, 'started', r.text);
    assert.deepEqual(r.json.boxes, [name]);
    assert.match(r.json.note, new RegExp(`^A box is open: on Spark 3, ${name}, a box opened by your own call, holding 1 file \\(a\\.txt\\)\\. It ends first, with its folder\\. `));
    const done = await opEnd(r.json.operation, 'the power-off');
    assert.equal(done.status, 'completed', `${done.error}\n${done.log.join('\n')}`);
    assert.ok(done.log.some(l => l.includes(`Ended the box ${name} on Spark 3, with its folder`)), done.log.join('\n'));
    assert.ok(!hasBox('spark3', name) && !existsSync(folder('spark3', name)), 'the box and its folder went');
    assert.ok(offline().includes('spark3'), 'Spark 3 went down');
    assert.ok(!plugs.commands.some(c => c.node === 5), 'Spark 2’s plug is never switched');
  });

  test('a box of a chat whose task is under way: the owner’s question first, nothing switched; the yes ends it and powers off', { timeout: 300000 * SLOW }, async () => {
    const chat = await newChat(), name = boxName(`chat ${chat}`), words = 'look in the box, then stop the old one';
    assert.equal(stateOf('spark4', RADIX), 'running');
    script([{ match: `^${words}$`, rounds: [[{ name: 'run', arguments: { on: 'box', command: 'echo hi > b.txt' } }], [{ name: 'stop_model', arguments: { spark: 'spark4', container: RADIX } }]] }]);
    try { await say(chat, words); } finally { rmSync(join(T.fleet.dir, 'model-script.json'), { force: true }); }
    assert.ok(hasBox('spark4', name), 'the chat’s box opened on Spark 4 (Spark 3 is off)');
    const convOf = () => JSON.parse(readFileSync(join(T.fleet.stateDir, 'chats.json'), 'utf8')).conversations.find(c => c.id === chat);
    await waitFor(() => convOf()?.task && !convOf().task.ended, { timeout: 30000 * SLOW, what: 'the chat’s task, parked at its button' });
    const before = plugs.commands.length, r = await act('power_off', { spark: 'spark4' });
    assert.equal(r.json?.outcome, 'question', r.text);
    assert.match(r.json.question, new RegExp(`^A box is open: on Spark 4, ${name}, Sparkie’s box in your chat “[^”]*”, for a task still under way there, holding 1 file \\(b\\.txt\\)\\. Power off Spark 4 anyway\\? The box ends first, and what its folder holds goes with it\\.$`));
    assert.ok(hasBox('spark4', name), 'nothing ended yet');
    assert.deepEqual(plugs.commands.slice(before), [], 'nothing switched');
    const yes = r.json.choices.find(c => c.label === 'Yes, end the box and power off Spark 4');
    assert.ok(yes?.choice, JSON.stringify(r.json.choices));
    const p = await act('power_off', { choice: yes.choice });
    assert.equal(p.json?.outcome, 'started', p.text);
    const done = await opEnd(p.json.operation, 'the power-off');
    assert.equal(done.status, 'completed', `${done.error}\n${done.log.join('\n')}`);
    assert.ok(!hasBox('spark4', name) && !existsSync(folder('spark4', name)), 'the box and its folder went');
    assert.ok(offline().includes('spark4'), 'Spark 4 went down');
  });
});

// R1-06 (R7): a parked model whose bring-back fails with a key in its error's first line keeps no key in events.jsonl.
// Spark 4 is asleep from the last case, with what it ran parked; the model's own record (its container's model label)
// is made to read as a key, so the restart that brings it back is refused with that text.
describe('a bring-back that fails with a key in its error', { concurrency: 1 }, () => {
  const FAKE = 'hf_FakeTestTokenForMaskingAbcdef123456';
  test('the heal-skipped reason is masked before it is kept', { timeout: 300000 * SLOW }, async () => {
    const parked = (await act('should_be_running', {})).json.running.find(x => x.spark === 'spark4' && x.container === RADIX);
    assert.ok(parked?.parked, `parked on Spark 4: ${JSON.stringify(parked)}`);
    writeFileSync(mock('spark4', 'containers'), lines('spark4').map(l => (l.startsWith(`${RADIX}|`) ? l.split('|').map((v, i) => (i === 4 ? FAKE : v)).join('|') : l)).map(l => `${l}\n`).join(''));
    const r = await act('power_on', { spark: 'spark4' });
    assert.equal(r.json?.outcome, 'started', r.text);
    const done = await opEnd(r.json.operation, 'the power-on');
    assert.ok(!offline().includes('spark4'), 'Spark 4 is on');
    const skipped = await waitFor(() => eventLines().find(e => e.type === 'heal-skipped' && e.container === RADIX), { timeout: 60000 * SLOW, what: `the heal-skipped line for ${RADIX}` });
    assert.match(skipped.why, /^bringing it back after its Spark was turned on failed: .*\[hidden\]/, skipped.why);
    assert.ok(!readFileSync(join(T.fleet.stateDir, 'events.jsonl'), 'utf8').includes(FAKE), 'no key in events.jsonl');
    assert.ok(!done.log.join('\n').includes(FAKE), 'nor in the operation’s log');
  });
});
