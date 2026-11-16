// Covers: one round of the brain's tool calls and the end of a turn's rounds (14-rounds.mjs: roundCalls, runOne,
// turnRounds; R50, R26), end to end on the stand-in fleet, from the final read of 2026-11-15. The lookups of a round
// run together; every call that may change something (a change, run, write_file) runs after them, one after another in
// the order asked, each once the one before it has ended: a write and the command that reads it, four changes for one
// Spark, a change on one Spark and a look on another; one still going past its 50 seconds is waited for; a change
// refused because an operation the same turn started still holds its Spark is no refusal of its own. A command marks
// the turn as having read outside text only once something ran (a failed one too); one refused, answered "nothing
// ran" or asked does not, so the change after it runs at once.
//
// The stand-in fleet, with the real root helper set up and proven for Spark 3 (test/rehearsal.mjs, run: true) and for
// looks on Spark 4, and the stand-in brain told by a script which tools to call. Linux only: run it on a Spark with
// tools/test-on-spark.sh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { T, useFleet, api, newChat, say, waitFor, sleep, SLOW } from './lib.mjs';
import { rehearse } from './rehearsal.mjs';

// (a change may run 60 seconds here, so one can go on past the 50 seconds a tool call has)
useFleet({ env: { SPARK_CONSOLE_RUN_SECONDS: '60', SPARK_CONSOLE_ROUTE_MS: '1000', SPARK_CONSOLE_WIDE_MS: '1', SPARK_CONSOLE_DANGER_LATE_MS: '0',
  SPARK_CONSOLE_NET: '0', SPARK_CONSOLE_HUB: '0', SPARK_CONSOLE_CONTINUE_MS: '300' },
  prepare: ({ root }) => {
    rehearse(root, 'spark3', { run: true });
    rehearse(root, 'spark4');
    const put = (spark, p, data) => { mkdirSync(dirname(join(root, spark, p)), { recursive: true }); writeFileSync(join(root, spark, p), data); chmodSync(join(root, spark, p), 0o644); };
    put('spark3', 'notes/w.txt', 'w before\n');
    put('spark3', 'notes/present.txt', 'present\n');
    put('spark4', 'docs/plain.txt', 'hello from spark4\n');
  } }, async () => {
  // (no change runs at once until the console has read the tailnet: two looks after a request, A7c)
  const looks = () => (existsSync(join(T.fleet.dir, 'tailscale-calls')) ? readFileSync(join(T.fleet.dir, 'tailscale-calls'), 'utf8').split('\n').filter(l => l === 'status --json').length : 0);
  await api('/health');
  const n = looks();
  await waitFor(() => looks() >= n + 2, { timeout: 60000, what: 'two looks at the tailnet after a request' });
  await sleep(300);
});

const H3 = () => join(T.fleet.root, 'spark3'), at3 = p => join(H3(), p), text = p => readFileSync(at3(p), 'utf8');
const lines = file => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const journal = () => readdirSync(T.fleet.journalDir).filter(f => f.endsWith('.jsonl')).sort().flatMap(f => lines(join(T.fleet.journalDir, f)));
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const noScript = () => rmSync(join(T.fleet.dir, 'model-script.json'), { force: true });
const requests = words => lines(join(T.fleet.dir, 'model-requests.jsonl')).filter(x => x.words === words);
const RUN = (command, more = {}) => ({ name: 'run', arguments: { on: 'spark3', command, dir: '~', ...more } });
const WRITE = (path, txt) => ({ name: 'write_file', arguments: { on: 'spark3', path, text: txt } });
const GUIDE = { name: 'guide', arguments: { tools: 'past' } };
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const shown = tools => JSON.stringify(tools.map(t => [t.name, t.ok, t.outcome || null, t.tail || null]));
// One owner's message, the stand-in brain calling these rounds of tools; its steps, what the last round was answered.
async function turn(chat, words, rounds) {
  script([{ match: `^${esc(words)}$`, rounds }]);
  try {
    const r = await say(chat, words);
    const sent = requests(words).filter(m => m.lastRole === 'tool').at(-1);
    const back = (sent?.results || []).map(x => (String(x.content).startsWith('[error] ') ? { error: String(x.content).slice(8) } : JSON.parse(x.content)));
    return { tools: r.tools, message: r.message, text: r.text, back };
  } finally { noScript(); }
}
// A tool call's span on the journal's record: when it began and when it ended, in ms.
const span = x => [Date.parse(x.at) - x.ms, Date.parse(x.at)];
const toolRecords = (chat, from) => journal().slice(from).filter(x => x.k === 'tool' && x.chat === chat);

test('a write and the command that reads it, in one round: the command runs after the write has ended, and reads what it wrote', { timeout: 120000 * SLOW }, async () => {
  const chat = await newChat();
  const r = await turn(chat, 'fix the w notes on spark 3', [[WRITE('~/notes/w.txt', 'written first\n'), RUN('cat notes/w.txt')]]);
  assert.deepEqual(r.tools.map(t => [t.name, t.ok]), [['write_file', true], ['run', true]], shown(r.tools));
  assert.equal(r.back[0]?.ran, true, JSON.stringify(r.back[0]));
  assert.equal(text('notes/w.txt'), 'written first\n');
  assert.match(String(r.back[1]?.output), /^written first/, JSON.stringify(r.back[1]));
});

test('four changes for one Spark in one round all run, one after another in the order asked; none meets the Spark’s claim', { timeout: 180000 * SLOW }, async () => {
  const chat = await newChat(), from = journal().length, cmd = n => `echo ${n} > notes/q${n}.txt`;
  const r = await turn(chat, 'fix the q notes on spark 3', [[1, 2, 3, 4].map(n => RUN(cmd(n)))]);
  assert.deepEqual(r.tools.map(t => [t.name, t.ok, t.outcome]), Array(4).fill(['run', true, 'change']), shown(r.tools));
  for (const n of [1, 2, 3, 4]) assert.equal(text(`notes/q${n}.txt`), `${n}\n`);
  assert.doesNotMatch(r.text, /Stopped asking/);
  // (each began after the one before it had ended: the journal's start and end lines of each command)
  const cmds = journal().slice(from).filter(x => x.k === 'cmd' && x.act === 'run');
  const starts = [1, 2, 3, 4].map(n => cmds.find(x => x.start && x.args?.command === cmd(n))), ends = starts.map(s => cmds.find(x => x.end && x.id === s?.id));
  assert.ok(starts.every(Boolean) && ends.every(Boolean), JSON.stringify(cmds));
  for (let i = 1; i < 4; i++) assert.ok(starts[i].at >= ends[i - 1].at, `command ${i + 1} began at ${starts[i].at}, before command ${i} ended at ${ends[i - 1].at}`);
});

test('two lookups in one round still run together', { timeout: 180000 * SLOW }, async () => {
  // (an operation that runs a while: a look with minutes on Spark 4, which each lookup follows for 3 seconds)
  const op = await api('/actions/run', { method: 'POST', body: { on: 'spark4', command: 'sleep 20', minutes: 1 } });
  assert.equal(op.status, 200, op.text);
  assert.equal(op.json.outcome, 'started', op.text);
  try {
    const chat = await newChat(), from = journal().length, WAIT = { name: 'wait_operation', arguments: { id: op.json.operation, seconds: 3 } };
    const r = await turn(chat, 'how is that look on spark 4 going', [[WAIT, WAIT]]);
    assert.deepEqual(r.tools.map(t => [t.name, t.ok]), [['wait_operation', true], ['wait_operation', true]], shown(r.tools));
    const [a, b] = toolRecords(chat, from).map(span);
    assert.ok(a && b && a[1] - a[0] >= 1000 && b[1] - b[0] >= 1000, 'each followed the operation a while');
    assert.ok(a[0] < b[1] && b[0] < a[1], `they ran at the same time: ${JSON.stringify([a, b])}`);
  } finally {
    await waitFor(async () => (await api(`/jobs/${op.json.operation}`)).json?.status !== 'running', { timeout: 90000, what: 'the look on Spark 4 to end' });
  }
});

test('a change on one Spark and a look on another, in one round: both run, the look after the change', { timeout: 120000 * SLOW }, async () => {
  const chat = await newChat(), from = journal().length;
  const r = await turn(chat, 'fix the m notes on spark 3', [[RUN('echo three > notes/m.txt'), { name: 'run', arguments: { on: 'spark4', command: 'cat docs/plain.txt' } }]]);
  assert.deepEqual(r.tools.map(t => [t.name, t.ok, t.outcome]), [['run', true, 'change'], ['run', true, 'look']], shown(r.tools));
  assert.equal(text('notes/m.txt'), 'three\n');
  assert.match(String(r.back[1]?.output), /^hello from spark4/, JSON.stringify(r.back[1]));
  const [change, look] = toolRecords(chat, from).map(span);
  assert.ok(look[0] >= change[1] - 2, `the look began at ${look[0]}, before the change ended at ${change[1]}`);
});

test('a change still going past its 50 seconds is waited for: the next ones of its round run after it has ended, and none is refused', { timeout: 300000 * SLOW }, async () => {
  const chat = await newChat();
  const r = await turn(chat, 'fix the h notes on spark 3', [[RUN('touch notes/h1; sleep 53; touch notes/h2'), RUN('echo x > notes/h3.txt'), RUN('echo y > notes/h4.txt')]]);
  assert.deepEqual(r.tools.map(t => [t.name, t.ok]), [['run', false], ['run', true], ['run', true]], shown(r.tools));
  assert.match(r.back[0]?.error || '', /^run took over 50 seconds and may still be going/);
  assert.ok(existsSync(at3('notes/h2')), 'the first ran to its end');
  assert.equal(text('notes/h3.txt'), 'x\n');
  assert.equal(text('notes/h4.txt'), 'y\n');
  assert.ok(statSync(at3('notes/h3.txt')).mtimeMs >= statSync(at3('notes/h2')).mtimeMs, 'the second ran after the first had ended');
  assert.doesNotMatch(r.text, /Stopped asking/);
});

test('a change refused because an operation the same turn started still holds its Spark is no refusal of its own: three of them don’t put the tools away', { timeout: 180000 * SLOW }, async () => {
  const chat = await newChat(), words = 'fix the l notes on spark 3';
  const r = await turn(chat, words, [[RUN('touch notes/l1; sleep 12; touch notes/l2', { minutes: 1 }), RUN('echo a > notes/la.txt'), RUN('echo b > notes/lb.txt'), RUN('echo c > notes/lc.txt')], [GUIDE]]);
  try {
    assert.deepEqual(r.tools.map(t => [t.name, t.ok]), [['run', true], ['run', false], ['run', false], ['run', false], ['guide', true]], shown(r.tools));
    assert.equal(r.tools[0].outcome, 'started');
    for (const t of r.tools.slice(1, 4)) assert.match(t.tail, /^Something is already changing on Spark 3/, shown(r.tools));
    assert.ok(requests(words)[1]?.tools.length > 0, 'the round after them offered tools');
    assert.doesNotMatch(r.text, /Stopped asking/);
  } finally {
    await waitFor(() => existsSync(at3('notes/l2')), { timeout: 90000, what: 'the long command to end' });
    await sleep(2000);
  }
});

// Final read of the net, 5: "Leave out sudo and set root", then the same command with root set refused as "text
// Sparkie read first", though nothing had run.
test('a command refused, answered “nothing ran” or asked, before anything ran, is no outside text: the change after it runs at once', { timeout: 240000 * SLOW }, async () => {
  for (const [words, first, name] of [
    ['fix the s notes on spark 3', RUN('sudo ls'), 's'],
    // (Spark 2's commands come with a later build: it answers that nothing ran)
    ['fix the t notes on spark 3', { name: 'run', arguments: { on: 'spark2', command: 'ls' } }, 't'],
    // (it uses the GPU: asked, with a button)
    ['fix the g notes on spark 3', RUN('echo g > notes/g.txt', { gpu: true }), 'g'],
  ]) {
    const r = await turn(await newChat(), words, [[first], [RUN(`echo ${name} > notes/${name}2.txt`)]]);
    assert.equal(r.tools.length, 2, `${words}: ${shown(r.tools)}`);
    assert.deepEqual([r.tools[1].ok, r.tools[1].outcome], [true, 'change'], `${words}: ${shown(r.tools)}`);
    assert.equal(text(`notes/${name}2.txt`), `${name}\n`);
  }
  assert.ok(!existsSync(at3('notes/g.txt')), 'the asked one did not run');
});

test('a command that ran and printed something is outside text, one that failed too: the change after it is asked', { timeout: 180000 * SLOW }, async () => {
  for (const [words, look, name] of [['fix the v notes on spark 3', 'cat notes/present.txt', 'v'], ['fix the x notes on spark 3', 'cat notes/missing.txt', 'x']]) {
    const r = await turn(await newChat(), words, [[RUN(look)], [RUN(`echo ${name} > notes/${name}.txt`)]]);
    assert.deepEqual(r.tools.map(t => [t.ok, t.outcome || null]).slice(0, 1), [[true, 'look']], `${words}: ${shown(r.tools)}`);
    assert.ok(['needs-ok', 'question'].includes(r.tools[1]?.outcome), `${words}: ${shown(r.tools)}`);
    assert.match(String(r.back[0]?.question), /\nAsked because Sparkie read text from outside first\.\n/, JSON.stringify(r.back[0]));
    assert.ok(!existsSync(at3(`notes/${name}.txt`)), 'asked, not run');
  }
});
