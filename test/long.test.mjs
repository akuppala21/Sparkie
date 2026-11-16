// Covers: run with minutes, a long command as an operation (21-long.mjs, with 21-work.mjs, 21-ladder.mjs and
// 21-runner.mjs; R23, R13; design A 2.10 and step 6, A6), end to end on the stand-in fleet: the call answers at once
// with the operation; an exit code other than 0 is a result and the operation completes; its end is posted in the
// chat that asked, built by code (how long, the exit code, its record) with none of the output, and the request's
// carry-on turn runs; a look is held to 1 minute and a change that runs at once to 10, each said; an asked change
// keeps what was asked (its button says how long); the limit stops it with everything it started; one long command
// a Spark at a time; cancel_operation stops its unit by id; a console killed while it runs stops it by id after the
// restart, says so once, and never runs it again.
// The stand-in fleet, with the real root helper set up and proven for Spark 3 (test/rehearsal.mjs, run: true), the
// stand-ins in test/mock/bin (systemd-run ends a unit at its time limit with everything it started; systemctl stop
// ends one that runs), and the stand-in brain told by a script which tools to call. A minute here is 3 seconds.
// Linux only: run it on a Spark with tools/test-on-spark.sh.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync, readdirSync, cpSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { T, useFleet, api, newChat, say, choose, chatMessages, waitFor, sleep, SLOW } from './lib.mjs';
import { rehearse } from './rehearsal.mjs';
import { startMock } from './start-mock.mjs';

const MINUTE = 3, SECONDS = 4;
const later = [];
after(async () => { for (const f of later) await f.stop().catch(() => {}); });
useFleet({ env: { SPARK_CONSOLE_MINUTE_SECONDS: String(MINUTE), SPARK_CONSOLE_RUN_SECONDS: String(SECONDS) },
  prepare: ({ root }) => {
    rehearse(root, 'spark3', { run: true });
    const h = join(root, 'spark3');
    const put = (p, data, mode = 0o644) => { mkdirSync(dirname(join(h, p)), { recursive: true }); writeFileSync(join(h, p), data); chmodSync(join(h, p), mode); };
    put('notes/a.txt', 'a before\n');
    put('notes/c.txt', 'c before\n');
  } }, async () => {
  // (the console's looks at the tailnet, the first 1.5 s after it starts: until one has read it, no change runs at once,
  // A7c. The Sparks' tailnet addresses come with the first request, so two looks after this one count)
  const looks = () => (existsSync(join(T.fleet.dir, 'tailscale-calls')) ? readFileSync(join(T.fleet.dir, 'tailscale-calls'), 'utf8').split('\n').filter(l => l === 'status --json').length : 0);
  const n = looks();
  await waitFor(() => looks() >= n + 2, { what: 'two looks at the tailnet after a request' });
  await sleep(300);
});

const H3 = () => join(T.fleet.root, 'spark3'), at3 = p => join(H3(), p);
const lines = file => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const records = (dir = T.fleet.journalDir) => (existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort() : []).flatMap(f => lines(join(dir, f))).filter(r => r.k === 'cmd');
const startOf = (command, dir) => records(dir).filter(r => r.start && r.act === 'run' && r.args?.command === command).at(-1);
const endOf = (r, dir) => records(dir).find(x => x.end && x.id === r.id);
// The units the helper asked systemd for (the rehearsal's own record), and the systemctl calls.
const calls = () => lines(join(H3(), '.rehearsal', 'calls.log'));
const unitProps = unit => calls().find(c => c[0] === 'systemd-run' && c.includes(`--unit=${unit}`)) || [];
const run = body => api('/actions/run', { method: 'POST', body: { on: 'spark3', dir: '~', ...body } });
const job = async id => (await api(`/jobs/${id}`)).json;
const ended = id => waitFor(async () => { const j = await job(id); return j.status !== 'running' && j; }, { timeout: 90000, what: `operation ${id} to end` });
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const noScript = () => rmSync(join(T.fleet.dir, 'model-script.json'), { force: true });
const FINISHED = '^\\[Spark Console\\] What you started for the owner';
// What a tool answered the brain (the newest), parsed.
const sentBack = words => {
  const x = lines(join(T.fleet.dir, 'model-requests.jsonl')).filter(m => m.words === words && m.lastRole === 'tool').at(-1);
  return (x?.results || []).map(r => (String(r.content).startsWith('[error] ') ? { error: String(r.content).slice(8) } : JSON.parse(r.content)));
};

test('with minutes a change is an operation: the call answers at once, exit code 3 completes it as a result, and its record keeps the output; at once it is held to 10 minutes, and says so', { timeout: 120000 * SLOW }, async () => {
  const command = "printf 'LONG-OUTPUT-WORD\\n'; sleep 2; echo done > notes/a.txt; exit 3";
  const t0 = Date.now(), r = await run({ command, minutes: 5 });
  assert.equal(r.status, 200, r.text);
  assert.ok(Date.now() - t0 < 2000 * SLOW, 'it did not wait for the command');
  assert.deepEqual([r.json.outcome, r.json.change, r.json.minutes, r.json.held], ['started', true, 5, undefined], r.text);
  assert.match(r.json.operation, /^[0-9a-f]{12}$/);
  assert.match(r.json.note, /^It runs on Spark 3 as operation [0-9a-f]{12}, for up to 5 minutes; the turn doesn’t wait for it\./);
  const j = await ended(r.json.operation);
  assert.deepEqual([j.type, j.status, j.exit, j.node, j.minutes], ['run', 'completed', 3, 'spark3', 5], JSON.stringify(j));
  assert.match(j.cleanUp, /^It ran for \d+ seconds? and ended with exit code 3\. What it printed is record (j_[0-9a-f]{12}) \(recall reads it\)\. undo_last_change puts back the file it copied first\.$/, j.cleanUp);
  assert.ok(!JSON.stringify(j).includes('LONG-OUTPUT-WORD'), 'the operation holds none of the output');
  assert.ok(!JSON.stringify(j).includes('printf'), 'nor the command');
  assert.equal(readFileSync(at3('notes/a.txt'), 'utf8'), 'done\n');
  const start = startOf(command), end = endOf(start);
  assert.deepEqual([start.class, start.minutes, start.seconds, start.op], ['change', 5, 5 * MINUTE, r.json.operation]);
  assert.deepEqual([end.ok, end.outcome, end.exit], [true, 'ran', 3]);
  assert.equal(j.cleanUp.match(/record (j_[0-9a-f]{12})/)[1], start.id);
  assert.ok(unitProps(start.unit).includes(`RuntimeMaxSec=${5 * MINUTE}`), JSON.stringify(unitProps(start.unit)));
  // More than 10 minutes at once is held to 10, and the answer says so.
  const held = await run({ command: 'echo held > notes/c.txt', minutes: 30 });
  assert.equal(held.status, 200, held.text);
  assert.deepEqual([held.json.minutes, held.json.held], [10, 'Held to 10 minutes: a change that runs without your yes is kept short (asked first, it may have up to 120).'], held.text);
  const hj = await ended(held.json.operation);
  assert.equal(hj.status, 'completed', JSON.stringify(hj));
  assert.match(hj.cleanUp, / Held to 10 minutes: a change that runs without your yes is kept short \(asked first, it may have up to 120\)\.$/);
  assert.ok(unitProps(startOf('echo held > notes/c.txt').unit).includes(`RuntimeMaxSec=${10 * MINUTE}`));
  // 121 minutes is no number run takes.
  const over = await run({ command: 'echo x > notes/c.txt', minutes: 121 });
  assert.equal(over.status, 400, over.text);
});

test('a look with minutes is held to 1 and says so; it has a start and an end line, its unit the look wall\'s', { timeout: 120000 * SLOW }, async () => {
  const r = await run({ command: 'cat notes/a.txt', minutes: 5 });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.json.outcome, r.json.look, r.json.minutes, r.json.held], ['started', true, 1, 'Held to 1 minute: a look runs for one minute at most.'], r.text);
  const j = await ended(r.json.operation);
  assert.equal(j.status, 'completed', JSON.stringify(j));
  assert.match(j.cleanUp, /^It ran for \d+ seconds? and ended with exit code 0\. What it printed is record j_[0-9a-f]{12} \(recall reads it\)\. Held to 1 minute: a look runs for one minute at most\.$/, j.cleanUp);
  const start = startOf('cat notes/a.txt'), end = endOf(start);
  assert.deepEqual([start.class, start.minutes, start.seconds, start.op], ['look', 1, MINUTE, r.json.operation], JSON.stringify(start));
  assert.match(start.unit, /^sw-look-[0-9a-f]{24}$/);
  assert.deepEqual([end.outcome, end.exit, end.class], ['ran', 0, 'look']);
  assert.ok(unitProps(start.unit).includes(`RuntimeMaxSec=${MINUTE}`), JSON.stringify(unitProps(start.unit)));
  assert.match(j.cleanUp, new RegExp(`record ${start.id} `));
});

test('at its limit a long command is stopped with everything it started, a result too; without minutes the turn\'s own limit stops it', { timeout: 120000 * SLOW }, async () => {
  const command = 'touch notes/lim-start; sleep 30; touch notes/lim-end';
  const r = await run({ command, minutes: 2 });
  assert.equal(r.status, 200, r.text);
  const j = await ended(r.json.operation);
  assert.equal(j.status, 'completed', JSON.stringify(j));
  assert.match(j.cleanUp, /^It was stopped at its limit of 2 minutes, with everything it started\. What it printed is record j_[0-9a-f]{12} \(recall reads it\)\./, j.cleanUp);
  assert.ok(existsSync(at3('notes/lim-start')) && !existsSync(at3('notes/lim-end')));
  assert.equal(endOf(startOf(command)).outcome, 'ended');
  // Without minutes: the call waits, and the command is ended at the runner's own limit.
  const t0 = Date.now(), short = await run({ command: 'sleep 30; touch notes/short-end' });
  assert.equal(short.status, 200, short.text);
  assert.match(short.json.ended || '', new RegExp(`^It ran past its ${SECONDS} seconds and was ended`), short.text);
  assert.ok(Date.now() - t0 < 20000 * SLOW && !existsSync(at3('notes/short-end')));
});

test('one long command a Spark at a time; cancel_operation stops its unit by id, says so, and lets the Spark go', { timeout: 120000 * SLOW }, async () => {
  const command = 'touch notes/c-start; sleep 20; touch notes/c-end';
  const r = await run({ command, minutes: 5 });
  assert.equal(r.status, 200, r.text);
  await waitFor(() => existsSync(at3('notes/c-start')), { every: 100, what: 'the command to start' });
  const look = await run({ command: 'cat notes/a.txt', minutes: 1 });
  assert.equal(look.status, 409, look.text);
  assert.equal(look.json.error, `A long command runs on Spark 3 already (operation ${r.json.operation}): one at a time on each Spark. Wait for its result, or cancel it (cancel_operation).`);
  const t0 = Date.now(), c = await api(`/jobs/${r.json.operation}/cancel`, { method: 'POST', body: {} });
  assert.equal(c.status, 200, c.text);
  assert.equal(c.json.outcome, 'cancelled', c.text);
  assert.ok(Date.now() - t0 < 15000 * SLOW, 'it did not wait for the command to end by itself');
  const j = await job(r.json.operation);
  assert.equal(j.status, 'cancelled');
  assert.match(j.cleanUp, /^It was stopped on Spark 3 after \d+ seconds?, with everything it started\. What it printed is record j_[0-9a-f]{12} \(recall reads it\)\./, j.cleanUp);
  const start = startOf(command);
  assert.ok(calls().some(x => x[0] === 'systemctl' && x[1] === 'stop' && x[2] === `${start.unit}.service`), 'its unit, stopped by name');
  await sleep(2000);
  assert.ok(!existsSync(at3('notes/c-end')), 'nothing it started went on');
  // The Spark is free again: a change runs.
  const next = await run({ command: 'echo next > notes/c.txt' });
  assert.equal(next.status, 200, next.text);
  assert.equal(readFileSync(at3('notes/c.txt'), 'utf8'), 'next\n');
});

test('in the chat that asked: its end is posted, built by code with none of the output, and the request carries on; an asked one keeps its minutes, and its button says how long', { timeout: 180000 * SLOW }, async () => {
  const chat = await newChat(), words = 'build the notes on spark 3, then tell me how it went', command = "printf 'CHAT-OUTPUT-WORD\\n'; exit 3";
  script([{ match: `^${words}$`, calls: [{ name: 'run', arguments: { on: 'spark3', command, dir: '~', minutes: 5 } }] }, { match: FINISHED, calls: [] }]);
  try {
    const r = await say(chat, words);
    assert.deepEqual(r.tools.map(t => [t.name, t.outcome]), [['run', 'started']], r.text);
    const notice = await waitFor(async () => (await chatMessages(chat)).find(m => m.notice && m.operation), { timeout: 60000, what: 'the result in the chat' });
    assert.equal(notice.status, 'completed');
    assert.match(notice.content, /^Done: the command on Spark 3 finished\. It ran for \d+ seconds? and ended with exit code 3\. What it printed is record j_[0-9a-f]{12} \(recall reads it\)\.$/, notice.content);
    assert.ok(!notice.content.includes('CHAT-OUTPUT-WORD') && !notice.content.includes('printf'));
    const m = await waitFor(async () => { const x = await chatMessages(chat), i = x.findIndex(y => y.auto); return i > 0 && x[i + 1]?.role === 'assistant' && x[i]; }, { timeout: 60000, what: 'the carry-on turn' });
    assert.match(m.content, new RegExp(FINISHED));
  } finally { noScript(); }
  // Asked (the words don't name the Spark): the button says how long, and the press runs it with what was asked.
  const chat2 = await newChat(), words2 = 'build the notes again', cmd2 = 'echo asked > notes/asked.txt';
  script([{ match: `^${words2}$`, calls: [{ name: 'run', arguments: { on: 'spark3', command: cmd2, dir: '~', minutes: 30 } }] }]);
  let asked;
  try { asked = await say(chat2, words2); } finally { noScript(); }
  const [q] = sentBack(words2);
  assert.equal(q?.outcome, 'needs-ok', JSON.stringify(q));
  assert.match(q.question, /^Run this on Spark 3\?\n\$ echo asked > notes\/asked\.txt\nAsked because your words don’t name Spark 3\.\nIt runs as an operation for up to 30 minutes; its result is posted here when it ends\.\n/, q.question);
  const yes = (asked.message.choices || []).find(c => c.label === 'Run it');
  assert.ok(yes, JSON.stringify(asked.message.choices));
  const p = await choose(chat2, yes.id);
  assert.equal(p.status, 200, p.text);
  assert.match(p.json.message.content, /under way/, p.text);
  const posted = await waitFor(async () => (await chatMessages(chat2)).find(m => m.notice && m.operation), { timeout: 60000, what: 'the asked one\'s result' });
  assert.match(posted.content, /^Done: the command on Spark 3 finished\. It ran for \d+ seconds? and ended with exit code 0\./, posted.content);
  assert.equal(readFileSync(at3('notes/asked.txt'), 'utf8'), 'asked\n');
  const start = startOf(cmd2);
  assert.deepEqual([start.minutes, start.gate], [30, 'asked']);
  assert.ok(unitProps(start.unit).includes(`RuntimeMaxSec=${30 * MINUTE}`), 'asked, it keeps 30 minutes: held only at once');
});

// Last: it ends this file's console.
test('a console killed while a long command runs: after the restart its unit is stopped by id, one cut-off notice says so, and it never runs again', { timeout: 240000 * SLOW }, async () => {
  const chat = await newChat(), words = 'build the slow notes on spark 3', command = 'touch notes/k-start; sleep 25; touch notes/k-late';
  script([{ match: `^${words}$`, calls: [{ name: 'run', arguments: { on: 'spark3', command, dir: '~', minutes: 10 } }] }]);
  try {
    const r = await say(chat, words);
    assert.deepEqual(r.tools.map(t => [t.name, t.outcome]), [['run', 'started']], r.text);
  } finally { noScript(); }
  await waitFor(() => existsSync(at3('notes/k-start')), { every: 100, what: 'the command to start' });
  const start = startOf(command);
  assert.deepEqual([start.minutes, start.seconds], [10, 10 * MINUTE]);
  process.kill(T.fleet.servicePid(), 'SIGKILL');
  await waitFor(() => T.fleet.serviceExit(), { what: 'the console to end' });
  // (the new console's Spark 3 is this one's, rehearsal and all, so the unit still running there is the one it finds)
  const B = await startMock({ watchMs: 600000, statusMs: 600000, prepare: ({ dir, root, stateDir }) => {
    cpSync(join(T.fleet.stateDir, 'chats.json'), join(stateDir, 'chats.json'));
    cpSync(join(T.fleet.stateDir, 'events.jsonl'), join(stateDir, 'events.jsonl'));
    cpSync(T.fleet.journalDir, join(dir, 'journal'), { recursive: true });
    rmSync(join(root, 'spark3'), { recursive: true, force: true });
    symlinkSync(H3(), join(root, 'spark3'));
  } });
  later.push(B);
  const cut = async () => (await (await fetch(`${B.base}/chats/${chat}`)).json()).messages.filter(x => x.notice && /cut off/.test(x.content));
  const notices = await waitFor(async () => { const m = await cut(); return m.length && m; }, { timeout: 60000, what: 'the notice' });
  assert.equal(notices.length, 1);
  assert.match(notices[0].content, /^A restart of Spark Console cut off “Run a command on a Spark: \$ touch notes\/k-start; sleep 25; touch notes\/k-late” on Spark 3 before its end was written \(it began at \d\d:\d\d UTC, with up to 10 minutes\)\. It was stopped there by id after the restart, with everything it started\. What it did until then stays, and it won’t be run again/, notices[0].content);
  assert.ok(calls().some(x => x[0] === 'systemctl' && x[1] === 'stop' && x[2] === `${start.unit}.service`), 'its unit, stopped by name');
  assert.deepEqual(records(B.journalDir).filter(x => x.id === start.id).map(x => [x.start || false, x.end || false, x.outcome || null]), [[true, false, null], [false, true, 'cut-off']]);
  // (the fleet's record says the operation was cut off, with no line telling the owner to start it again)
  const events = lines(join(B.stateDir, 'events.jsonl'));
  await waitFor(() => lines(join(B.stateDir, 'events.jsonl')).some(e => e.type === 'operation' && e.id === start.op && e.status === 'interrupted'), { what: 'the operation marked interrupted' });
  assert.ok(!events.concat(lines(join(B.stateDir, 'events.jsonl'))).some(e => e.type === 'notice' && /cut off run/.test(e.text || '')), 'no notice to start it again');
  await sleep(27000 - (Date.now() - Date.parse(start.at)) > 0 ? 27000 - (Date.now() - Date.parse(start.at)) : 0);
  assert.ok(!existsSync(at3('notes/k-late')), 'stopped: what it would have done after its sleep never happened');
  assert.equal((await cut()).length, 1, 'one notice');
  assert.equal(records(B.journalDir).filter(x => x.start && x.args?.command === command).length, 1, 'never run again');
});
