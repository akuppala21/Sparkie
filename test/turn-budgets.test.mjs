// Covers: the chat loop's budgets (design A 2.10, step 3; R50), counted by code on each turn: the run calls one message
// may make (the setup's workSteps, else twice its tool rounds, at most 30; 12 for today's stand-in brain), the tool
// output it may read (40% of its context at 3 characters a token: the setup's contextTokens, else the number after its
// --context-length, --max-model-len or --ctx-size flag, else 32,768), and three refused calls in a row. A brain that runs
// commands again and again stops at the step budget, and the calls past it in that round are not run; a result past the
// output budget, and every one after it, is cut to a notice naming the journal record that keeps it whole; three
// refusals in a row (run's own checks, a Spark with no helper, an input the gate refuses) put the tools away, and a call
// that works between resets the count. Each ends the turn the way a token budget does (the next round offers no tools),
// and the answer ends with code's own report. A request that is a task (one with a next step) then carries on in a
// fresh turn, within the carry-on's own limit of turns; a plain request, a task past that limit, and three refusals
// wait for the owner's "go on". Lookups other than run are no work steps; a new message, and another chat answering at
// once, start from nothing; a setup's own workSteps and contextTokens apply and change the tested mark, its context
// flag sets the output budget without changing it, and its ask block cannot raise them. A brain not checked (no eval
// kept for its setup) gets the careful limits, 8 rounds and 16 commands a message, whatever its setup says; one task
// runs at most 120 commands over all its turns, and the turn that reaches them waits for the owner; a context flag
// given twice counts by its last, for the output and for memory's block (E5b).
//
// The stand-in fleet, with the real root helper as a rehearsal on Spark 3 and Spark 4 (as test/work.test.mjs sets it
// up; its sudo stand-in, in a temporary folder first on the PATH, runs only the rehearsal's helper); Spark 2 has none.
// Linux only (GNU coreutils, bash 4 or newer): run it on a Spark with tools/test-on-spark.sh.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync, realpathSync, readdirSync, openSync, readSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { T, useFleet, api, newChat, say, chatMessages, waitFor, sleep, REPO, SLOW } from './lib.mjs';

const MOCKBIN = join(REPO, 'test', 'mock', 'bin');
const HELPER_SRC = join(REPO, 'deploy', 'spark-console-root');
const BIN = realpathSync(mkdtempSync(join(tmpdir(), 'budgets-bin-')));
after(() => rmSync(BIN, { recursive: true, force: true }));
writeFileSync(join(BIN, 'sudo'), `#!/bin/bash
python3 -c 'import json, sys; print(json.dumps({"args": sys.argv[1:]}))' "$@" >> "$HOME/.sudo-calls"
[ "$1" = -n ] || { echo 'sudo: a terminal is required to read the password' >&2; exit 1; }
shift
R="$HOME/.rehearsal"
[ "$1" = "$R/usr/local/sbin/spark-console-root" ] || { echo "sudo: these tests allow no $1" >&2; exit 1; }
[ -f "$R/etc/sudoers.d/spark-console-root" ] || { echo 'sudo: a password is required' >&2; exit 1; }
shift
R=$(realpath "$R")
exec env SUDO_UID=1000 SUDO_USER=owner SUDO_GID=1000 SPARK_CONSOLE_REHEARSAL="$R" "$R/usr/local/sbin/spark-console-root" "$@"
`, { mode: 0o755 });

// The real helper on a stand-in Spark, as the owner's one-time command leaves it (its sudo line too), and proven.
function rehearse(root, spark) {
  const home = join(root, spark), R = join(home, '.rehearsal');
  const put = (p, text = '', mode) => { mkdirSync(dirname(join(R, p)), { recursive: true }); writeFileSync(join(R, p), text); if (mode) chmodSync(join(R, p), mode); };
  mkdirSync(join(R, 'usr/local/sbin'), { recursive: true });
  for (const d of ['', 'usr', 'usr/local', 'usr/local/sbin']) chmodSync(join(R, d), 0o755);
  put('usr/local/sbin/spark-console-root', readFileSync(HELPER_SRC), 0o755);
  put('etc/passwd', `root:x:0:0:root:/root:/bin/bash\nowner:x:1000:1000::${realpathSync(home)}:/bin/bash\n`);
  put('etc/group', 'root:x:0:\nowner:x:1000:\ndocker:x:999:owner\n');
  put('etc/sudoers.d/spark-console-root', 'owner ALL=(root) NOPASSWD: /usr/local/sbin/spark-console-root\n', 0o440);
  put('proc/1/comm', 'systemd\n');
  put('proc/sys/kernel/osrelease', '6.11.0-1016-nvidia\n');
  put('proc/swaps', 'Filename\tType\tSize\tUsed\tPriority\n');
  put('sys/fs/cgroup/cgroup.controllers', 'cpu io memory pids\n');
  mkdirSync(join(R, 'standin'), { recursive: true });
  const real = realpathSync(R), p = spawnSync(join(real, 'usr/local/sbin/spark-console-root'), ['prove', '--id', 'prepared00001'],
    { env: { PATH: `${BIN}:${MOCKBIN}:/usr/bin:/bin`, HOME: realpathSync(home), SPARK_CONSOLE_REHEARSAL: real, SUDO_UID: '1000', SUDO_USER: 'owner', SUDO_GID: '1000' }, encoding: 'utf8', timeout: 120000 });
  assert.equal(p.status, 0, p.stdout + p.stderr);
  mkdirSync(join(home, 'docs'), { recursive: true });
  writeFileSync(join(home, 'docs', 'plain.txt'), `hello from ${spark}\n`);
}
// (Spark 2's changes are off for this fleet: its refused calls on Spark 2 are the hub's off side, hub-change.test the on side)
useFleet({ env: { PATH: `${BIN}:${MOCKBIN}:${process.env.PATH}`, SPARK_CONSOLE_LOOK_SECONDS: '10', SPARK_CONSOLE_CONTINUE_MS: '300', SPARK_CONSOLE_HUB: '0' },
  prepare: ({ root, stateDir }) => {
    rehearse(root, 'spark3');
    rehearse(root, 'spark4');
    // A setup that states its own budgets, with an ask block that asks for more (its maxTokens shows the block is read).
    const f = join(stateDir, 'main.json'), m = JSON.parse(readFileSync(f, 'utf8')), base = m.presets[m.current];
    m.presets['a3-small'] = { ...base, title: 'Small budgets', workSteps: 3, contextTokens: 8000, ask: { workSteps: 30, contextTokens: 1048576, maxTokens: 5000 } };
    // Today's brain (its flags say --context-length 1000000) with its context flag set otherwise: 262,144; none; nonsense.
    const flag = (args, value) => args.flatMap((a, i) => (a === '--context-length' ? (value == null ? [] : [a, value]) : args[i - 1] === '--context-length' ? [] : [a]));
    assert.deepEqual(flag(base.args, '1000000'), base.args, 'today\'s brain states its context');
    m.presets['a3-262k'] = { ...base, title: 'Context 262,144', args: flag(base.args, '262144') };
    m.presets['a3-plain'] = { ...base, title: 'No context flag', args: flag(base.args, null) };
    m.presets['a3-nonsense'] = { ...base, title: 'Nonsense context', args: [...flag(base.args, null), '--ctx-size', 'lots'] };
    // (E5b: more rounds than a brain not checked gets; 15 commands a message, for a task's 120; its context flag twice)
    m.presets['a3-big'] = { ...base, title: 'Many rounds', toolRounds: 20 };
    m.presets['a3-task'] = { ...base, title: 'Fifteen a message', workSteps: 15 };
    m.presets['a3-twice'] = { ...base, title: 'Context given twice', args: [...base.args, '--context-length', '15000'] };
    writeFileSync(f, JSON.stringify(m), { mode: 0o600 });
  } });

const lines = file => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
// The helper's looks that were asked for, on the two Sparks that have it.
const looks = () => ['spark3', 'spark4'].flatMap(s => lines(join(T.fleet.root, s, '.sudo-calls'))).filter(c => c.args[2] === 'look').length;
const requests = words => lines(join(T.fleet.dir, 'model-requests.jsonl')).filter(x => x.words === words);
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const noScript = () => rmSync(join(T.fleet.dir, 'model-script.json'), { force: true });
async function saying(rules, chat, words) {
  script(rules);
  try { return await say(chat, words); } finally { noScript(); }
}
const records = () => readdirSync(T.fleet.journalDir).filter(f => f.endsWith('.jsonl')).flatMap(f => lines(join(T.fleet.journalDir, f)));
function recordText(r) {
  const fd = openSync(join(T.fleet.journalDir, `journal-${r.at.slice(0, 7)}.out`), 'r'), buf = Buffer.alloc(r.o[1]);
  try { readSync(fd, buf, 0, r.o[1], r.o[0]); } finally { closeSync(fd); }
  return buf.toString();
}
const ended = id => waitFor(async () => { const j = (await api(`/jobs/${id}`)).json; return j.status !== 'running' && j; }, { timeout: 180000 * SLOW, what: `operation ${id} to end` });
const answering = () => waitFor(async () => { const m = (await api('/main')).json; return m.state === 'running' && m.healthy === true; }, { timeout: 90000 * SLOW, what: 'Sparkie answering' });
const RUN = (on, command = 'cat docs/plain.txt') => ({ name: 'run', arguments: { on, command } });
const SEQ = on => RUN(on, 'seq 1 20000');
const GUIDE = { name: 'guide', arguments: { tools: 'past' } };
const calls = r => r.message.tools.map(t => [t.name, t.ok]);
// (the error results the stand-in brain was sent for these words, to say why when a count is off)
const errors = words => JSON.stringify(requests(words).flatMap(x => x.results.map(y => y.content)).filter(c => c.startsWith('[error]')));
// (each request the stand-in brain got for these words: its round, and whether it was offered tools)
const rounds = words => requests(words).map(x => [x.round, x.tools.length > 0]);
const offeredThen = n => [...Array(n).keys()].map(i => [i, true]).concat([[n, false]]);
const NOTICE = budget => new RegExp(`^\\[Spark Console\\] Not shown: this result \\(([\\d,]+) characters\\) would pass the ${budget} characters of tool results one message may read\\. It is kept whole in record (j_[0-9a-f]{12}): recall \\{"id":"\\2"\\} reads it, in a later message\\. Answer now with what you have\\.$`);
// The brain's setup switched (as the owner does), and answering again.
async function use(preset) {
  const r = await api('/main/use', { method: 'POST', body: { preset } });
  assert.equal(r.status, 202, r.text);
  assert.equal((await ended(r.json.id)).status, 'completed');
  await answering();
}
// Each turn of a chat, as its journal line keeps its budgets.
const budgetsIn = chat => records().filter(x => x.k === 'turn' && x.chat === chat).map(x => x.budgets);
// What the stand-in brain is told in a carry-on turn after a reply a budget ended (continueTask), for a script's rule.
const CARRIED = '^\\[Spark Console\\] Your last reply stopped at the limit of one message \\(its last lines say which\\)\\. Carry on with that request: “';
// No carry-on turn comes: the chat still holds the n messages it had, a while after its reply.
async function noCarryOn(chat, n) {
  await sleep(2000 * SLOW);
  assert.equal((await chatMessages(chat)).length, n, 'no carry-on turn');
}

test('a brain that runs commands again and again stops at 12, twice its 6 rounds: no command past them runs, the answer says how many ran and that the owner can say go on, and the next message starts fresh', { timeout: 300000 * SLOW }, async () => {
  await answering();
  const FOUR = [RUN('spark3'), RUN('spark3'), RUN('spark4'), RUN('spark4')], THREE = [RUN('spark3'), RUN('spark3'), RUN('spark4')];
  const chat = await newChat(), before = looks();
  const r = await saying([{ match: '^look again and again$', rounds: [FOUR, FOUR, THREE, THREE, FOUR, FOUR, FOUR] }], chat, 'look again and again');
  // 4, 4 and 3 ran; in the fourth round the twelfth ran and the two after it were not handed over.
  assert.deepEqual(calls(r), [...Array(12).fill(['run', true]), ['run', false], ['run', false]], errors('look again and again'));
  assert.equal(looks() - before, 12, 'twelve commands reached the helper, no more');
  assert.deepEqual(rounds('look again and again'), offeredThen(4), 'the round after the twelfth offered no tools, and was the last');
  const last = requests('look again and again').at(-1).results.map(x => x.content);
  assert.equal(last.filter(c => c === '[error] Not run: one message may run 12 commands, and this one has. Answer now with what you found and what is left.').length, 2);
  assert.match(r.text, /^I checked\. /, 'the brain\'s last words first');
  assert.ok(r.text.endsWith('\n\nStopped here: one message may run 12 commands, and 12 ran; 2 more were asked for and not run.\nSay “go on” to carry on.'), r.text.slice(-300));
  // A plain question, not a task: it waits for the owner.
  await noCarryOn(chat, 2);
  assert.deepEqual(budgetsIn(chat), [{ steps: 12, output: 1200000, spent: 'steps', carried: false }], 'today\'s brain: 40% of its 1,000,000 tokens');
  // The owner says go on: a new message, with its own twelve.
  const again = await saying([{ match: '^go on$', rounds: [[RUN('spark3')]] }], chat, 'go on');
  assert.deepEqual(calls(again), [['run', true]]);
  assert.equal(looks() - before, 13);
  assert.doesNotMatch(again.text, /Stopped/);
});

test('a task whose reply reaches the step budget carries on in a fresh turn, and finishes there', { timeout: 300000 * SLOW }, async () => {
  const FOUR = [RUN('spark3'), RUN('spark3'), RUN('spark4'), RUN('spark4')], words = 'look everywhere, then tell me what you found';
  const chat = await newChat(), before = looks();
  script([{ match: `^${words}$`, rounds: [FOUR, FOUR, FOUR, FOUR] }, { match: CARRIED, rounds: [[RUN('spark3')]] }]);
  let r, m;
  try {
    r = await say(chat, words);
    m = await waitFor(async () => { const x = await chatMessages(chat); return x.length >= 4 && x.at(-1).role === 'assistant' && x; }, { timeout: 120000, what: 'the carry-on turn' });
  } finally { noScript(); }
  assert.deepEqual(calls(r), Array(12).fill(['run', true]), errors(words));
  assert.ok(r.text.endsWith('\n\nStopped here: one message may run 12 commands, and 12 ran.\nCarrying on with your request in a fresh turn.'), r.text.slice(-200));
  assert.equal(m[2].role, 'user');
  assert.ok(m[2].auto, 'Spark Console\'s own turn, not the owner\'s words');
  assert.match(m[2].content, new RegExp(`${CARRIED}${words}”\\. Do the next step`));
  assert.deepEqual(m[3].tools.map(t => [t.name, t.ok]), [['run', true]]);
  assert.doesNotMatch(m[3].content, /Stopped|Carrying on/);
  assert.equal(looks() - before, 13);
  assert.deepEqual(budgetsIn(chat), [{ steps: 12, output: 1200000, spent: 'steps', carried: true }, { steps: 12, output: 1200000 }]);
  await noCarryOn(chat, 4);
});

test('the output budget follows the setup\'s context flag (with no flag, or one that says nothing, 32,768 tokens); past 39,321 characters a result is cut to a notice naming the record that keeps it whole, and the turn ends', { timeout: 500000 * SLOW }, async () => {
  for (const [preset, output] of [['a3-262k', 314572], ['a3-plain', 39321], ['a3-nonsense', 39321]]) {
    await use(preset);
    const hello = await newChat();
    await say(hello, 'hello');
    assert.deepEqual(budgetsIn(hello), [{ steps: 12, output }], preset);
  }
  // (a3-nonsense now: 39,321 characters)
  const chat = await newChat(), from = records().length, before = looks();
  const r = await saying([{ match: '^read a lot$', rounds: Array(6).fill([SEQ('spark3'), SEQ('spark4')]) }], chat, 'read a lot');
  const asked = requests('read a lot'), notice = NOTICE('39,321');
  // Only the last request carries notices, and it offered no tools: the turn ended in the round after the cut.
  assert.ok(asked.slice(0, -1).every(x => !x.results.some(y => notice.test(y.content))));
  const cut = asked.at(-1).results.map(y => notice.exec(y.content)).filter(Boolean);
  assert.ok(cut.length >= 1, JSON.stringify(asked.at(-1).results.map(y => y.content.slice(0, 200))));
  assert.equal(asked.at(-1).tools.length, 0);
  assert.ok(asked.length >= 2 && asked.length < 6, `ended by the output, not by the rounds (${asked.length} requests)`);
  assert.equal(looks() - before, r.message.tools.length, 'every command asked for ran: the steps were not the limit');
  // What was shown fits; the result that was cut would not have; each cut result is kept whole in its record.
  const mine = records().slice(from).filter(x => x.k === 'tool' && x.chat === chat), texts = new Map(mine.map(x => [x.id, recordText(x)]));
  assert.equal(mine.length, r.message.tools.length);
  const ids = new Set(cut.map(m => m[2])), alt = `(?:${cut.map(m => m[2]).join('|')})`, shown = [...texts].filter(([id]) => !ids.has(id)).reduce((n, [, t]) => n + t.length, 0);
  assert.ok(shown <= 39321, String(shown));
  for (const m of cut) {
    const t = texts.get(m[2]);
    assert.ok(t, `record ${m[2]}`);
    assert.equal(Number(m[1].replace(/,/g, '')), t.length);
    assert.match(t, /^\{"look":"It ran as a look[\s\S]*"output":"1\\n2\\n3\\n/);
  }
  assert.ok(shown + Math.max(...cut.map(m => texts.get(m[2]).length)) > 39321);
  assert.match(r.text, new RegExp(`\\n\\nStopped here: one message may read 39,321 characters of tool results, so (?:1 result wasn’t|${cut.length} results weren’t) read \\(kept whole in Spark Console’s record: ${alt}(?:, ${alt})*\\)\\.\\nSay “go on” to carry on\\.$`));
});

test('three refused calls in a row put the tools away, the answer says what was refused and why, and even a task waits for the owner; a call that works between resets the count', { timeout: 300000 * SLOW }, async () => {
  const BOGUS = { name: 'stop_model', arguments: { spark: 'spark4', container: 'nothing-here', bogus: true } };
  let before = looks();
  // (a task, with a next step: even so it waits for the owner)
  const words = 'try what is refused, then tell me', chat = await newChat();
  const r = await saying([{ match: `^${words}$`, rounds: [[RUN('spark3', 'sudo ls')], [RUN('spark2', 'ls')], [BOGUS], [RUN('spark3')], [RUN('spark4')]] }], chat, words);
  // run's own check, a Spark with no helper (it answers, and runs nothing), and an input the gate refuses.
  assert.deepEqual(calls(r), [['run', false], ['run', true], ['stop_model', false]], errors(words));
  assert.deepEqual(rounds(words), offeredThen(3));
  assert.equal(looks(), before, 'nothing was run after them');
  assert.match(r.text, /\n\nStopped asking: 3 calls in a row were refused, so the tools were put away for this message\.\n- run: Leave out sudo: a look already reads what root can read \(keys aside\), and it changes nothing\.\n- run: Commands on Spark 2, the hub, come with a later build \(its set-up waits for the lock-out net\), so nothing ran there\.\n- stop_model: Unknown argument: bogus\. stop_model takes [^\n]+\.\nSay what to change, or “go on” to try again\.$/);
  await noCarryOn(chat, 2);
  // Two refused, one that works, two refused, a lookup: every round runs.
  before = looks();
  const s = await saying([{ match: '^refused, then not$', rounds: [[RUN('spark3', 'sudo ls')], [RUN('spark2', 'ls')], [RUN('spark3')], [RUN('spark3', 'sudo ls')], [RUN('spark2', 'ls')], [GUIDE]] }], await newChat(), 'refused, then not');
  assert.deepEqual(calls(s), [['run', false], ['run', true], ['run', true], ['run', false], ['run', true], ['guide', true]], errors('refused, then not'));
  assert.deepEqual(rounds('refused, then not'), offeredThen(6));
  assert.equal(looks() - before, 1);
  assert.doesNotMatch(s.text, /Stopped/);
});

// (review after the loop, Later 11: the twelfth command set "steps" before the three refusals of its own round came
// back, so that reply carried on once more)
test('three refusals in the round whose command reached the twelfth end the carrying on: the task waits for the owner', { timeout: 300000 * SLOW }, async () => {
  const FOUR = [RUN('spark3'), RUN('spark3'), RUN('spark4'), RUN('spark4')], THREE = [RUN('spark3'), RUN('spark3'), RUN('spark4')];
  const BOGUS = { name: 'stop_model', arguments: { spark: 'spark4', container: 'nothing-here', bogus: true } };
  const words = 'look and then refuse, then tell me', chat = await newChat();
  const r = await saying([{ match: `^${words}$`, rounds: [FOUR, FOUR, THREE, [RUN('spark4'), BOGUS, BOGUS, BOGUS]] }], chat, words);
  assert.deepEqual(calls(r), [...Array(12).fill(['run', true]), ['stop_model', false], ['stop_model', false], ['stop_model', false]], errors(words));
  assert.match(r.text, /\n\nStopped asking: 3 calls in a row were refused/, r.text.slice(-400));
  await noCarryOn(chat, 2);
  assert.deepEqual(budgetsIn(chat), [{ steps: 12, output: 39321, spent: 'refused', carried: false }]);
});

test('a setup\'s own budgets apply and change the tested mark; its ask block can\'t raise them; lookups are no work steps; two chats at once each have their own', { timeout: 400000 * SLOW }, async () => {
  // A setup that states neither (its context flag aside): the brain's catalog (part of the tested mark) is as it was.
  assert.ok(!('workSteps' in (await api('/actions')).json.brain.setup) && !('contextTokens' in (await api('/actions')).json.brain.setup));
  await use('a3-small');
  const setup = (await api('/actions')).json.brain.setup;
  assert.deepEqual([setup.workSteps, setup.contextTokens], [3, 8000]);
  // Three run calls, whatever the ask block says; the lookups between them are not counted.
  let before = looks();
  const r = await saying([{ match: '^small steps$', rounds: [[RUN('spark3'), GUIDE, GUIDE, GUIDE], [GUIDE, RUN('spark4')], [RUN('spark3')], [RUN('spark4')], [RUN('spark3')]] }], await newChat(), 'small steps');
  assert.deepEqual(r.message.tools.map(t => t.name), ['run', 'guide', 'guide', 'guide', 'guide', 'run', 'run']);
  assert.equal(looks() - before, 3);
  assert.deepEqual(rounds('small steps'), offeredThen(3));
  assert.equal(requests('small steps')[0].params.max_tokens, 5000, 'the ask block is read: its maxTokens');
  assert.ok(r.text.endsWith('\n\nStopped here: one message may run 3 commands, and 3 ran.\nSay “go on” to carry on.'), r.text.slice(-200));
  // 40% of its 8,000 tokens, at 3 characters a token: the second long result is cut.
  const big = await saying([{ match: '^small reads$', rounds: [[SEQ('spark3')], [SEQ('spark4')], [RUN('spark3')]] }], await newChat(), 'small reads');
  assert.deepEqual(rounds('small reads'), offeredThen(2));
  assert.match(requests('small reads')[1].results[0].content, /^\{"look":/);
  assert.match(requests('small reads')[2].results[0].content, NOTICE('9,600'));
  assert.match(big.text, /\n\nStopped here: one message may read 9,600 characters of tool results, so 1 result wasn’t read \(kept whole in Spark Console’s record: j_[0-9a-f]{12}\)\.\nSay “go on” to carry on\.$/);
  // Two chats answering at once: three each.
  const [a, b] = [await newChat(), await newChat()];
  before = looks();
  script([{ match: '^chat a looks$', rounds: Array(5).fill([RUN('spark3')]) }, { match: '^chat b looks$', rounds: Array(5).fill([RUN('spark4')]) }]);
  let both;
  try { both = await Promise.all([say(a, 'chat a looks'), say(b, 'chat b looks')]); } finally { noScript(); }
  for (const x of both) {
    assert.deepEqual(calls(x), Array(3).fill(['run', true]), errors('chat a looks') + errors('chat b looks'));
    assert.match(x.text, /Stopped here: one message may run 3 commands, and 3 ran\.\nSay “go on” to carry on\.$/);
  }
  assert.equal(looks() - before, 6);
  // (their requests overlapped in time: each chat's first request came before the other's last)
  const [ra, rb] = [requests('chat a looks'), requests('chat b looks')];
  assert.ok(ra[0].at < rb.at(-1).at && rb[0].at < ra.at(-1).at, 'the two answered at once');
});

test('a task whose every reply reaches the step budget carries on within the carry-on\'s own limit of turns, then waits for the owner', { timeout: 400000 * SLOW }, async () => {
  // (a3-small now: three commands a message)
  const words = 'small task, then tell me', chat = await newChat(), before = looks();
  script([{ match: `^${words}$`, rounds: Array(4).fill([RUN('spark3')]) }, { match: CARRIED, rounds: Array(4).fill([RUN('spark4')]) }]);
  let m;
  try {
    await say(chat, words);
    // The owner's reply and 8 carry-on turns (CONTINUE_MAX).
    m = await waitFor(async () => { const x = await chatMessages(chat); return x.length >= 18 && x.at(-1).role === 'assistant' && x; }, { timeout: 300000, what: 'eight carry-on turns' });
    await noCarryOn(chat, 18);
  } finally { noScript(); }
  const replies = m.filter(x => x.role === 'assistant');
  assert.equal(replies.length, 9);
  for (const x of replies.slice(0, 8)) assert.ok(x.content.endsWith('\n\nStopped here: one message may run 3 commands, and 3 ran.\nCarrying on with your request in a fresh turn.'), x.content.slice(-200));
  assert.ok(replies[8].content.endsWith('\n\nStopped here: one message may run 3 commands, and 3 ran.\nSay “go on” to carry on.'), replies[8].content.slice(-200));
  assert.equal(looks() - before, 27);
  assert.deepEqual(budgetsIn(chat).map(x => x.carried), [...Array(8).fill(true), false]);
});

// E5b: the limits a turn gets are its brain's profile's: a setup with no eval kept for it is not checked, so it gets the
// careful ones, at most 8 rounds and 16 commands a message, whatever it says.
test('a brain not checked gets the careful limits: 8 rounds and 16 commands a message, whatever its setup says', { timeout: 400000 * SLOW }, async () => {
  await use('a3-big');
  const FOUR = [RUN('spark3'), RUN('spark3'), RUN('spark4'), RUN('spark4')], before = looks();
  const r = await saying([{ match: '^look a lot, carefully$', rounds: Array(8).fill(FOUR) }], await newChat(), 'look a lot, carefully');
  assert.deepEqual(calls(r), Array(16).fill(['run', true]), errors('look a lot, carefully'));
  assert.equal(looks() - before, 16);
  assert.ok(r.text.endsWith('\n\nStopped here: one message may run 16 commands, and 16 ran.\nSay “go on” to carry on.'), r.text.slice(-200));
  await saying([{ match: '^guide me a lot$', rounds: Array(20).fill([GUIDE]) }], await newChat(), 'guide me a lot');
  assert.deepEqual(rounds('guide me a lot'), offeredThen(8), 'eight rounds, not its twenty');
});

// Design A 2.10: one task runs at most 120 commands over all its turns; the reply that reaches them says so and waits
// for the owner (whose next message is a new request, with its own).
test('one task runs at most 120 commands over all its turns: the turn that reaches them says so, and nothing carries on', { timeout: 600000 * SLOW }, async () => {
  await use('a3-task');
  const FOUR = [RUN('spark3'), RUN('spark3'), RUN('spark4'), RUN('spark4')], words = 'a long task, then tell me', chat = await newChat(), before = looks();
  script([{ match: `^${words}$`, rounds: Array(4).fill(FOUR) }, { match: CARRIED, rounds: Array(4).fill(FOUR) }]);
  let m;
  try {
    await say(chat, words);
    // The owner's reply and 7 carry-on turns: 8 turns of 15.
    m = await waitFor(async () => { const x = await chatMessages(chat); return x.length >= 16 && x.at(-1).role === 'assistant' && x; }, { timeout: 500000, what: 'seven carry-on turns' });
    await noCarryOn(chat, 16);
  } finally { noScript(); }
  const replies = m.filter(x => x.role === 'assistant');
  assert.equal(replies.length, 8);
  for (const x of replies.slice(0, 7)) assert.ok(x.content.endsWith('\n\nStopped here: one message may run 15 commands, and 15 ran; 1 more was asked for and not run.\nCarrying on with your request in a fresh turn.'), x.content.slice(-200));
  assert.ok(replies[7].content.endsWith('\n\nStopped here: one task may run 120 commands, and this one has (15 in this message); 1 more was asked for and not run.\nSay “go on” to carry on.'), replies[7].content.slice(-200));
  assert.equal(looks() - before, 120);
  assert.deepEqual(budgetsIn(chat).map(x => [x.spent, x.carried]), [...Array(7).fill(['steps', true]), ['task', false]]);
  const carried = lines(join(T.fleet.dir, 'model-requests.jsonl')).filter(x => new RegExp(CARRIED).test(x.words) && x.words.includes(words));
  assert.ok(carried.some(x => x.results.some(y => y.content === '[error] Not run: one task may run 120 commands, and this one has. Answer now with what you found and what is left.')));
});

// R50: the output budget and memory's sizes read the context from the same flags, the last when one is given twice.
test('a context flag given twice: the last one counts, for the output a message may read and for memory’s block', { timeout: 300000 * SLOW }, async () => {
  await use('a3-twice');
  const hello = await newChat();
  await say(hello, 'hello');
  assert.deepEqual(budgetsIn(hello), [{ steps: 12, output: 18000 }], '40% of the last flag’s 15,000 tokens');
  // (memory's block in the system prompt is 4,000 characters from 33,334 tokens up, 1,800 at 15,000: 25 facts of about
  // 100 characters fit the first and not the second, where they are only picked)
  for (let i = 0; i < 25; i++) {
    const r = await api('/actions/remember', { method: 'POST', body: { text: `Twice fact ${i}: a flag given twice counts by its last, as an engine reads it (number ${i}).`, kind: 'fact' } });
    assert.equal(r.status, 200, r.text);
  }
  await say(await newChat(), 'hello again, twice');
  const twice = requests('hello again, twice')[0].system;
  assert.match(twice, /What the owner asked you to remember[\s\S]*More is remembered than fits here/);
  assert.ok(!twice.includes('Twice fact 0:'), 'at its last flag’s 15,000 tokens the facts don’t fit the block');
  await use('aphex');
  await say(await newChat(), 'hello again, once');
  const once = requests('hello again, once')[0].system;
  for (let i = 0; i < 25; i++) assert.ok(once.includes(`Twice fact ${i}:`), `at 1,000,000 tokens fact ${i} is in the block`);
});
