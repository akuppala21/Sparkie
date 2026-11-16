// Covers: one round of the brain's tool calls and the end of a turn's rounds (14-rounds.mjs: roundCalls, runOne,
// turnRounds; R50, R26), end to end on the stand-in fleet, from the final read of 2026-11-15. The lookups of a round
// run together; every call that may change something (a change, run, write_file) runs after them, one after another in
// the order asked, each once the one before it has ended: a write and the command that reads it, four changes for one
// Spark, a change on one Spark and a look on another; one still going past its 50 seconds is waited for; a change
// refused because an operation the same turn started still holds its Spark is no refusal of its own. A command marks
// the turn as having read outside text only once something ran (a failed one too); one refused, answered "nothing
// ran" or asked does not, so the change after it runs at once. Past the rounds a message may take, the brain is told
// its tools are put away, a call it makes all the same is answered "not run" and nothing runs, the reply ends with
// code's own lines, and a task carries on in a fresh turn (the stand-in brain's "untooled" call). The steps' note
// counts only the commands that ran, and those asked first apart, as waiting for the owner's yes. The
// brain's mark covers the last round's note. The brain's token budget ends a turn as the others do: the brain is told,
// code's own line ends the reply, and a task carries on. Calls past the 4 one round runs are not run, and each says so.
// The model's answer (the chat's modelStep and the brain check's brainAsk) and a command's output (run) are read through
// one decoder: with their bytes cut inside any character, what comes out is what went in (pure: no port, no fleet).
//
// The stand-in fleet, with the real root helper set up and proven for Spark 3 (test/rehearsal.mjs, run: true) and for
// looks on Spark 4, and the stand-in brain told by a script which tools to call. Linux only: run it on a Spark with
// tools/test-on-spark.sh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync, readdirSync, statSync, mkdtempSync, cpSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { T, REPO, useFleet, api, newChat, say, chatMessages, waitFor, sleep, SLOW } from './lib.mjs';
import { rehearse } from './rehearsal.mjs';

// (a change may run 60 seconds here, so one can go on past the 50 seconds a tool call has)
useFleet({ env: { SPARK_CONSOLE_RUN_SECONDS: '60', SPARK_CONSOLE_ROUTE_MS: '1000', SPARK_CONSOLE_WIDE_MS: '1', SPARK_CONSOLE_DANGER_LATE_MS: '0',
  SPARK_CONSOLE_NET: '0', SPARK_CONSOLE_HUB: '0', SPARK_CONSOLE_CONTINUE_MS: '300' },
  prepare: ({ root, stateDir }) => {
    rehearse(root, 'spark3', { run: true });
    rehearse(root, 'spark4');
    const put = (spark, p, data) => { mkdirSync(dirname(join(root, spark, p)), { recursive: true }); writeFileSync(join(root, spark, p), data); chmodSync(join(root, spark, p), 0o644); };
    put('spark3', 'notes/w.txt', 'w before\n');
    put('spark3', 'notes/present.txt', 'present\n');
    put('spark4', 'docs/plain.txt', 'hello from spark4\n');
    // (a setup with a token budget, for the test that reaches it by the stand-in brain's own count of tokens)
    const f = join(stateDir, 'main.json'), m = JSON.parse(readFileSync(f, 'utf8'));
    m.presets['rounds-tokens'] = { ...m.presets[m.current], title: 'A token budget', tokenBudget: 4000 };
    writeFileSync(f, JSON.stringify(m), { mode: 0o600 });
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
    // (changes on Spark 2 are switched off on this fleet: it answers that nothing ran)
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

// Final read C-5: past the round limit the brain was told nothing, a call it made was dropped unseen, and the reply had
// no line from code and no carry-on.
const CARRIED = '^\\[Spark Console\\] Your last reply stopped at the limit of one message \\(its last lines say which\\)\\. Carry on with that request: “';
test('past the rounds a message may take: the brain is told its tools are put away, a call it makes all the same is answered “not run” and nothing runs, the reply ends with code’s own lines, and a task carries on', { timeout: 240000 * SLOW }, async () => {
  const chat = await newChat(), from = journal().length, words = 'look around, then tell me what you found';
  // (six rounds of lookups, the stand-in brain's six; in the seventh, with no tools offered, it calls run all the same)
  const late = { ...RUN('echo late > notes/late.txt'), untooled: true };
  script([{ match: `^${esc(words)}$`, rounds: [...Array(6).fill([GUIDE]), [late]] }, { match: CARRIED, rounds: [] }]);
  let r, m;
  try {
    r = await say(chat, words);
    m = await waitFor(async () => { const x = await chatMessages(chat); return x.length >= 4 && x.at(-1).role === 'assistant' && x; }, { timeout: 120000, what: 'the carry-on turn' });
  } finally { noScript(); }
  const asked = requests(words);
  assert.deepEqual(asked.map(x => [x.round, x.tools.length > 0]), [...[0, 1, 2, 3, 4, 5].map(i => [i, true]), [6, false]]);
  assert.ok(asked.at(-1).system.endsWith('\n\n[Spark Console] Your tools are put away for this message (one message may take 6 rounds of tools). A tool you call now is not run: answer with what the tools said, and say what is left to do.'), asked.at(-1).system.slice(-400));
  assert.ok(!asked.slice(0, -1).some(x => x.system.includes('tools are put away')), 'only the last request is told');
  // The call made all the same: not run, and said so on the page and in the journal.
  assert.deepEqual(r.tools.map(t => [t.name, t.ok]), [...Array(6).fill(['guide', true]), ['run', false]], shown(r.tools));
  assert.equal(r.tools.at(-1).tail, 'Not run: it was asked for after the tools were put away for this message.');
  assert.ok(!existsSync(at3('notes/late.txt')), 'nothing ran');
  assert.deepEqual(toolRecords(chat, from).filter(x => x.act === 'run').map(x => x.ok), [false]);
  // Code's own lines end the reply, and the task carries on in a fresh turn.
  assert.ok(r.text.endsWith('Stopped here: one message may take 6 rounds of tools, and this one has.\n1 more call was asked for after the tools were put away, and not run (run).\nCarrying on with your request in a fresh turn.'), r.text.slice(-400));
  assert.equal(m[2].role, 'user');
  assert.ok(m[2].auto, 'Spark Console’s own turn');
  assert.match(m[2].content, new RegExp(`${CARRIED}${esc(words)}”`));
  const budgets = journal().filter(x => x.k === 'turn' && x.chat === chat).map(x => x.budgets && [x.budgets.spent ?? null, x.budgets.carried ?? null]);
  assert.deepEqual(budgets[0], ['rounds', true], JSON.stringify(budgets));
});

// Final read of the sorter, S-15: the steps' note counted a command asked first as one that ran.
test('the steps’ note counts only the commands that ran, and says how many wait for the owner’s yes', { timeout: 300000 * SLOW }, async () => {
  const k = n => RUN(`echo ${n} > notes/k${n}.txt`);
  const r = await turn(await newChat(), 'fix the k notes on spark 3', [[1, 2, 3, 4].map(k), [5, 6, 7, 8].map(k), [9, 10, 11, 12].map(k)]);
  // (the first round's four ran at once; after what they printed, each later one is asked first: R26)
  const asked = o => (['needs-ok', 'question'].includes(o) ? 'asked' : o);
  assert.deepEqual(r.tools.map(t => asked(t.outcome)), [...Array(4).fill('change'), ...Array(8).fill('asked')], shown(r.tools));
  for (const n of [1, 2, 3, 4]) assert.equal(text(`notes/k${n}.txt`), `${n}\n`);
  for (const n of [5, 12]) assert.ok(!existsSync(at3(`notes/k${n}.txt`)), `k${n} waits`);
  assert.ok(r.text.endsWith('\n\nStopped here: one message may run 12 commands, and 12 were tried and 4 ran; 8 wait for your yes.\nSay “go on” to carry on.'), r.text.slice(-300));
});

// The last round's note (toolsAway) is among the fixed words the brain's mark hashes (BRAIN_WORDS, 21-guide.mjs), with
// the report's lines: a build whose note says one word otherwise has another mark there, and the same elsewhere.
test('the brain’s mark covers the last round’s note: a build whose note says one word otherwise has another report mark', { timeout: 300000 * SLOW }, async () => {
  const words = (await api('/actions')).json.brain.words, TMP = mkdtempSync(join(tmpdir(), 'rounds-words-')), copy = join(TMP, 'tree');
  try {
    for (const d of ['service', 'test', 'tools', 'deploy', 'public']) cpSync(join(REPO, d), join(copy, d), { recursive: true, verbatimSymlinks: true });
    const part = join(copy, 'service', 'src', '14-rounds.mjs'), was = readFileSync(part, 'utf8');
    assert.ok(was.includes('Your tools are put away for this message'));
    writeFileSync(part, was.replace('Your tools are put away for this message', 'Your tools are put aside for this message'));
    const made = spawnSync(process.execPath, [join(copy, 'tools', 'build-server.mjs')], { cwd: copy, encoding: 'utf8', timeout: 120000 });
    assert.equal(made.status, 0, made.stdout + made.stderr);
    const { startMock: startCopy } = await import(pathToFileURL(join(copy, 'test', 'start-mock.mjs')).href);
    const other = await startCopy({ evalOnRecord: false });
    let theirs;
    try { theirs = (await (await fetch(`${other.base}/actions`, { signal: AbortSignal.timeout(30000) })).json()).brain.words; } finally { await other.stop(); }
    assert.notEqual(theirs.report, words.report, 'the report mark moved');
    assert.deepEqual({ ...theirs, report: null }, { ...words, report: null }, 'the other words are the same');
  } finally { rmSync(TMP, { recursive: true, force: true }); }
});

// Calls past the 4 one round runs were dropped unseen: now each is answered "not run", on the page, in the journal, to
// the brain in its next round, and in the reply's last lines.
test('calls past the 4 one round runs are not run, and each says so: on the page, in the journal, to the brain and in the reply’s last lines', { timeout: 180000 * SLOW }, async () => {
  const chat = await newChat(), from = journal().length, NOT = 'Not run: one round runs at most 4 calls. Ask for it again in the next one.';
  const r = await turn(chat, 'fix the five notes on spark 3', [[GUIDE, GUIDE, GUIDE, GUIDE, RUN('echo five > notes/five.txt'), RUN('echo six > notes/six.txt')]]);
  assert.deepEqual(r.message.tools.map(t => [t.name, t.ok]), [...Array(4).fill(['guide', true]), ['run', false], ['run', false]], shown(r.message.tools));
  for (const t of r.message.tools.slice(4)) assert.equal(t.tail, NOT);
  assert.ok(!existsSync(at3('notes/five.txt')) && !existsSync(at3('notes/six.txt')), 'nothing ran');
  assert.deepEqual(toolRecords(chat, from).map(x => [x.act, x.ok]), [...Array(4).fill(['guide', true]), ['run', false], ['run', false]]);
  // (the brain's next request carries every call's result, the two past the four saying they did not run)
  assert.equal(r.back.length, 6, JSON.stringify(r.back).slice(0, 400));
  assert.deepEqual(r.back.slice(4), [{ error: NOT }, { error: NOT }]);
  assert.ok(r.text.endsWith('\n\n2 more calls were asked for past the 4 calls one round runs, and not run (run).'), r.text.slice(-300));
  assert.doesNotMatch(r.text, /Stopped/);
});

// The brain's token budget (R50) ended a turn with no line from code and no carry-on: now it is a budget as the others.
// (it switches the brain's setup and back: keep it last in this file)
const ended = id => waitFor(async () => { const j = (await api(`/jobs/${id}`)).json; return j.status !== 'running' && j; }, { timeout: 180000, what: `operation ${id} to end` });
const answering = () => waitFor(async () => { const m = (await api('/main')).json; return m.state === 'running' && m.healthy === true; }, { timeout: 90000, what: 'Sparkie answering' });
async function use(preset) {
  const r = await api('/main/use', { method: 'POST', body: { preset } });
  assert.equal(r.status, 202, r.text);
  assert.equal((await ended(r.json.id)).status, 'completed');
  await answering();
}
test('past the brain’s token budget: the brain is told its tools are put away, the reply ends with code’s own line, and a task carries on', { timeout: 400000 * SLOW }, async () => {
  const habits = h => (h ? writeFileSync(join(T.fleet.dir, 'model-habits.json'), JSON.stringify(h)) : rmSync(join(T.fleet.dir, 'model-habits.json'), { force: true }));
  const was = JSON.parse(readFileSync(join(T.fleet.stateDir, 'main.json'), 'utf8')).current, words = 'look over the past, then tell me what you found';
  await use('rounds-tokens');
  let r, m, chat;
  try {
    // (5,000 tokens by the brain's own count, over the setup's 4,000: one round of tools, then the last)
    habits({ usage: 5000 });
    script([{ match: `^${esc(words)}$`, rounds: [[GUIDE], [GUIDE], [GUIDE]] }, { match: CARRIED, rounds: [] }]);
    chat = await newChat();
    r = await say(chat, words);
    m = await waitFor(async () => { const x = await chatMessages(chat); return x.length >= 4 && x.at(-1).role === 'assistant' && x; }, { timeout: 120000, what: 'the carry-on turn' });
  } finally { noScript(); habits(null); await use(was); }
  const asked = requests(words);
  assert.deepEqual(asked.map(x => [x.round, x.tools.length > 0]), [[0, true], [1, false]]);
  assert.ok(asked.at(-1).system.endsWith('\n\n[Spark Console] Your tools are put away for this message (one message may use 4,000 of your tokens). A tool you call now is not run: answer with what the tools said, and say what is left to do.'), asked.at(-1).system.slice(-400));
  assert.deepEqual(r.tools.map(t => [t.name, t.ok]), [['guide', true]], shown(r.tools));
  assert.ok(r.text.endsWith('\n\nStopped here: one message may use 4,000 of the brain’s tokens (what it reads and writes), and this one has.\nCarrying on with your request in a fresh turn.'), r.text.slice(-400));
  assert.equal(m[2].role, 'user');
  assert.ok(m[2].auto, 'Spark Console’s own turn');
  const budgets = journal().filter(x => x.k === 'turn' && x.chat === chat).map(x => x.budgets && [x.budgets.spent ?? null, x.budgets.carried ?? null]);
  assert.deepEqual(budgets[0], ['tokens', true], JSON.stringify(budgets));
});

// (the outside review's A-7b: a character whose bytes the stream cuts between two pieces came out spoiled)
const SRC = f => readFileSync(join(REPO, 'service', 'src', f), 'utf8');
const lift = (src, head) => { const from = src.indexOf(head); assert.ok(from >= 0, head); return src.slice(from, src.indexOf('\n}\n', from) + 2); };
// A body in the pieces given, as a socket hands them: Buffers through a real stream, which decodes only if asked to.
const piecesOut = (pieces, extra = {}) => { const r = Object.assign(new PassThrough(), extra); setImmediate(() => { for (const p of pieces) r.write(p); r.end(); }); return r; };
const sse = o => `data: ${JSON.stringify(o)}\n\n`;
const ANSWER = 'Voilà — Señor Peña’s “notes”, 日本語 🎉';
const ARGS = JSON.stringify({ on: 'box', path: 'notes/café.txt', text: 'Ça marche — 日本語 🎉\n' });
const BODY = Buffer.from([
  sse({ choices: [{ index: 0, delta: { role: 'assistant', content: ANSWER }, finish_reason: null }] }),
  sse({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'write_file', arguments: '' } }] }, finish_reason: null }] }),
  sse({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: ARGS } }] }, finish_reason: null }] }),
  sse({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }), 'data: [DONE]\n\n'].join(''), 'utf8');
// Every cut inside a character of 2, 3 and 4 bytes: the left piece ends part-way through it.
const CUTS = [...BODY.keys()].filter(i => i > 0 && (BODY[i] & 0xc0) === 0x80);

test('the chat’s model answer is read through one decoder: cut inside any character, its words and a write_file call’s text come out as they went in', async () => {
  const fn = new Function('http', 'answerReader', 'modelInUse', 'TURN_STOPPED', `${SRC('13-ask.mjs')}\n${lift(SRC('14-rounds.mjs'), 'function modelStep(turn, sent) {')}\nreturn modelStep;`);
  let pieces = [];
  const http = { request(opts, cb) { const up = new EventEmitter(); up.end = () => cb(piecesOut(pieces, { statusCode: 200 })); up.destroy = () => {}; return up; } };
  const modelStep = fn(http, null, 0, 'stopped');
  const step = async p => { pieces = p; return modelStep({ emit: () => {}, link: {}, target: { host: 'x', port: 1 }, messages: [], base: {}, tuned: {}, answer: '' }, [{ type: 'function', function: { name: 'write_file' } }]); };
  assert.ok(CUTS.length >= 20, `cuts inside characters: ${CUTS.length}`);
  for (const i of CUTS) {
    const r = await step([BODY.subarray(0, i), BODY.subarray(i)]);
    assert.deepEqual([r.content, r.calls?.[0]?.args], [ANSWER, ARGS], `cut at byte ${i}`);
  }
});

test('the brain check’s answer is read through one decoder: cut inside any character, it comes out as it went in', async () => {
  const src = SRC('21-brain-check.mjs');
  const fn = new Function('http', 'howAsked', 'clean', 'CHECK_TOOL', 'CHECK_ASK_MS', `${SRC('13-ask.mjs')}\n${lift(src, 'function brainAsk(m, messages, tools = null) {')}\nreturn brainAsk;`);
  let pieces = [];
  const http = { request(opts, cb) { const req = new EventEmitter(); req.end = () => cb(piecesOut(pieces, { statusCode: 200 })); req.destroy = () => {}; return req; } };
  const brainAsk = fn(http, () => ({ base: {} }), s => String(s), {}, 30000);
  for (const i of CUTS) {
    pieces = [BODY.subarray(0, i), BODY.subarray(i)];
    const r = await brainAsk({ port: 1, served: 'm' }, []);
    assert.deepEqual([r.content, r.calls?.[0]?.args], [ANSWER, ARGS], `cut at byte ${i}`);
  }
});

test('a command’s output is read through one decoder: cut inside any character, run gives it back whole, its errors too', async () => {
  const fn = new Function('knownOffline', 'spawnOn', 'noteReach', `${lift(SRC('02-ssh.mjs'), 'function run(node, script, {')}\nreturn run;`);
  const OUT = Buffer.from('café — Señor Peña’s “list”: 日本語 🎉\n', 'utf8'), ERR = Buffer.from('erreur: déjà vu 🎉\n', 'utf8');
  const inside = b => [...b.keys()].filter(i => i > 0 && (b[i] & 0xc0) === 0x80);
  let cut = 0;
  const spawnOn = () => {
    const child = new EventEmitter(), o = OUT, e = ERR, io = cut % o.length || 1, ie = inside(e)[cut % inside(e).length];
    child.stdout = piecesOut([o.subarray(0, io), o.subarray(io)]);
    child.stderr = piecesOut([e.subarray(0, ie), e.subarray(ie)]);
    child.kill = () => {};
    let ended = 0;
    for (const s of [child.stdout, child.stderr]) s.on('end', () => { if (++ended === 2) setImmediate(() => child.emit('close', 0)); });
    return child;
  };
  const run = fn(() => false, spawnOn, () => {});
  for (const i of inside(OUT)) {
    cut = i;
    const r = await run({ id: 'spark3' }, 'true', { timeout: 5000 });
    assert.deepEqual([r.code, r.out, r.err], [0, OUT.toString('utf8'), ERR.toString('utf8').trim()], `cut at byte ${i}`);
  }
});
