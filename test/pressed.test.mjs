// Covers: what a pressed change says it did (K2, the final read: R66, R32, R61): the press's line on the page and the
// fixed line in the paired Telegram chat are built from the result's own fields (`pressRan`, 14-chats.mjs; `tgRanLine`,
// 21-telegram.mjs), "done" only for a command that ran and ended with exit 0. A press on a Spark with no root helper says
// nothing ran and why, and shows the owner's one-time command where the result carries it (on the page; Telegram says
// where it is); one that exits 1 says so, with its exit code and last line; a write_file into a folder that isn't there
// says nothing was written; one ended at its time limit says so. A task parked at the button and woken by a failed press
// reads what happened, not "done". A task's report counts its changes from the journal's own lines, as the code writes
// them (K5): one that ran after the yes counts; one whose end line says it never ran doesn't. The report goes to Telegram
// only for a task begun there, without the failure lines (C-8, R32).
// The stand-in fleet, with the real root helper set up and proven for Spark 3 (test/rehearsal.mjs, run: true) and none
// on Spark 4, the stand-in brain told by a script which tools to call, and the paired Telegram chat (test/mock/
// telegram.mjs) with approvals from there on. Linux only: run it on a Spark with tools/test-on-spark.sh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { T, useFleet, api, newChat, say, choose, chatMessages, waitFor, REPO, SLOW } from './lib.mjs';
import { rehearse } from './rehearsal.mjs';

const SECONDS = 6, TOKEN = '123456789:AAEtestTokenForSparkConsoleXYZ_abcdefghij', OWNER_TG = 5550001;
const ANSWERED = '^\\[Spark Console\\] The owner answered your question';
// (C-8) A task begun in the paired chat, parked at a button, with one failed operation on record whose error line holds a
// home path and an address: its journal line as the operations' end lines carry the task.
const TGSEED = { chat: 'sc_c8c8000000000a01', task: 'j_c8c800000001', words: 'start the c8 model, then tell me when it answers', err: 'pull failed at /home/owner/.cache/x from 100.64.0.7' };
function seedTgTask(dir, stateDir, pairedAt) {
  const at = new Date(Date.now() - 600000).toISOString(), tg = createHash('sha256').update(`${OWNER_TG}:${OWNER_TG}:${pairedAt}`).digest('hex').slice(0, 16);
  writeFileSync(join(stateDir, 'chats.json'), JSON.stringify({ conversations: [{ id: TGSEED.chat, login: 'owner@test', title: 'c8', spark: null, createdAt: at, updatedAt: at, channel: 'telegram',
    messages: [{ role: 'user', content: TGSEED.words, createdAt: at }, { role: 'assistant', content: 'Asked first.', createdAt: at }],
    task: { id: TGSEED.task, since: at, request: TGSEED.words, at, continuations: 0, hours: 2, turns: 8, parked: at, channel: 'telegram', tg } }] }), { mode: 0o600 });
  mkdirSync(join(dir, 'journal'), { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, 'journal', `journal-${new Date().toISOString().slice(0, 7)}.jsonl`), `${JSON.stringify({ id: 'j_c8c8000000c1', at, k: 'op', chat: TGSEED.chat, task: TGSEED.task,
    op: 'c8c8000000c1', act: 'deploy', model: 'c8-model', ok: false, outcome: 'failed', err: TGSEED.err, noWh: 'it ran on no Spark' })}\n`, { mode: 0o600 });
}
useFleet({ telegram: true, watchMs: 60000,
  env: { SPARK_CONSOLE_RUN_SECONDS: String(SECONDS), SPARK_CONSOLE_ROUTE_MS: '1000', SPARK_CONSOLE_WIDE_MS: '1', SPARK_CONSOLE_TELEGRAM_LIMITS: '1000,1000,1000',
    SPARK_CONSOLE_CONTINUE_MS: '1000' },
  prepare: ({ root, dir, stateDir }) => {
    rehearse(root, 'spark3', { run: true });
    const h = join(root, 'spark3');
    const put = (p, data, mode = 0o644) => { mkdirSync(dirname(join(h, p)), { recursive: true }); writeFileSync(join(h, p), data); chmodSync(join(h, p), mode); };
    put('notes/fail.sh', 'echo "no such package: k2-demo"\nexit 1\n');
    put('notes/slow.sh', 'sleep 40\n');
    mkdirSync(join(root, 'spark4', 'notes'), { recursive: true });
    mkdirSync(join(dir, 'secrets'), { recursive: true, mode: 0o700 });
    const pairedAt = new Date().toISOString();
    writeFileSync(join(dir, 'secrets', 'secrets.json'), JSON.stringify({ telegram: { token: TOKEN, bot: 'spark_test_bot', chatId: OWNER_TG, userId: OWNER_TG, name: 'Owner',
      pairedAt, approve: true } }), { mode: 0o600 });
    seedTgTask(dir, stateDir, pairedAt);
  } }, () => waitFor(async () => (await api('/telegram')).json.state === 'ok', { what: 'Telegram polling' }));

const lines = file => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const journal = () => readdirSync(T.fleet.journalDir).filter(f => f.endsWith('.jsonl')).sort().flatMap(f => lines(join(T.fleet.journalDir, f)));
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const noScript = () => rmSync(join(T.fleet.dir, 'model-script.json'), { force: true });
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const RUN = (on, command) => ({ name: 'run', arguments: { on, command, dir: '~' } });
const WRITE = (path, text) => ({ name: 'write_file', arguments: { on: 'spark3', path, text } });
// One owner's message on the page (words that name no Spark: every change is a button), the stand-in brain calling one
// tool; its "Run it" button.
async function asked(words, call) {
  const chat = await newChat();
  script([{ match: `^${esc(words)}$`, rounds: [[call]] }]);
  let r;
  try { r = await say(chat, words); } finally { noScript(); }
  const yes = (r.message.choices || []).find(c => c.label === 'Run it');
  assert.ok(yes, `${words}: ${JSON.stringify(r.message)}`);
  return { chat, yes };
}
const pressed = async (chat, yes) => { const p = await choose(chat, yes.id); assert.equal(p.status, 200, p.text); return p.json; };
// The paired chat (stand-in Bot API): what was sent, and a press there.
const tgCalls = () => lines(join(T.fleet.dir, 'telegram-calls.jsonl'));
const tgSent = (from = 0) => tgCalls().slice(from).filter(c => c.method === 'sendMessage');
let msgId = 1;
const tgPress = data => fetch(`http://127.0.0.1:${T.fleet.telegramPort}/__push`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ callback_query: { id: String(msgId++), from: { id: OWNER_TG, is_bot: false, first_name: 'Owner' }, data,
    message: { message_id: msgId++, chat: { id: OWNER_TG, type: 'private' }, date: Math.floor(Date.now() / 1000) } } }) });
// The ask sent to the paired chat pressed there: the line it answered with there, and the press's line on the page.
async function pressedThere(chat, yes) {
  await waitFor(() => tgSent().some(s => JSON.stringify(s.body?.reply_markup || {}).includes(yes.id)), { what: 'the ask in the paired chat' });
  const from = tgCalls().length;
  await tgPress(yes.id);
  const line = (await waitFor(() => tgSent(from)[0], { timeout: 90000, what: 'the answer to the press there' })).body.text;
  const notice = await waitFor(async () => (await chatMessages(chat)).find(m => m.notice && /^Approved from Telegram: /.test(m.content)), { what: 'the press’s line on the page' });
  return { line, page: notice.content, sent: tgCalls().slice(from) };
}
const NONE4 = 'The root helper isn’t set up on Spark 4 yet (the owner’s one-time command hasn’t run there), so nothing ran there.';
const FAILED = 'it ran and failed, with exit code 1. Its last line: “no such package: k2-demo”.';
const MORE = 'The details are in Spark Console.';

// (Telegram first: at most 3 approvals from there an hour, and the first press on Spark 4 is the one that carries the
// owner's one-time command, which is given once per Spark while the console runs)
test('pressed in the paired chat, on a Spark with no root helper: "Nothing ran" there; on the page why, and the one-time command', { timeout: 180000 * SLOW }, async () => {
  const { chat, yes } = await asked('make the k2 note on the other one', RUN('spark4', 'touch notes/k2-none.txt'));
  const { line, page, sent } = await pressedThere(chat, yes);
  assert.equal(line, 'Nothing ran: Spark 4 needs your one-time set-up command first. It is in your chat in Spark Console.');
  assert.ok(!sent.some(c => /root-for-sparkie/.test(JSON.stringify(c.body || {}))), 'the command, which names Spark 2’s address, is not sent to Telegram');
  const [head, how, cmd, ...rest] = page.split('\n');
  assert.equal(head, `Approved from Telegram: Run it: ${NONE4}`);
  assert.equal(how, 'Run this once in your own terminal (it asks Spark 4’s password once), then ask again:');
  assert.match(cmd, /root-for-sparkie\.sh 4'?$/);
  assert.deepEqual(rest, []);
  assert.ok(!existsSync(join(T.fleet.root, 'spark4', 'notes', 'k2-none.txt')), 'nothing ran');
  // (the runner's start line, then its end line: never ran)
  const start = journal().filter(x => x.k === 'cmd' && x.start && x.args?.command === 'touch notes/k2-none.txt').at(-1);
  assert.ok(start, 'a start line');
  assert.equal(journal().find(x => x.id === start.id && x.end)?.ran, false);
});

test('pressed in the paired chat: a command that exits 1 says so there and on the page', { timeout: 180000 * SLOW }, async () => {
  const { chat, yes } = await asked('fix the failing note', RUN('spark3', 'bash notes/fail.sh'));
  const { line, page } = await pressedThere(chat, yes);
  assert.equal(line, `It ran and failed, with exit code 1. ${MORE}`);
  assert.equal(page, `Approved from Telegram: Run it: ${FAILED}`);
});

test('pressed in the paired chat: a write_file into a folder that isn’t there says nothing was written', { timeout: 180000 * SLOW }, async () => {
  const { chat, yes } = await asked('write the new project file', WRITE('~/notes/newproj/app.py', 'print("hi")\n'));
  const { line, page } = await pressedThere(chat, yes);
  assert.equal(line, `Nothing was written. ${MORE}`);
  assert.match(page, /^Approved from Telegram: Run it: Nothing was written: \S/);
  assert.ok(!existsSync(join(T.fleet.root, 'spark3', 'notes', 'newproj')), 'nothing was written');
});

test('pressed on the page: no root helper, exit 1, nothing written and the time limit, each said as it is, never "done"', { timeout: 300000 * SLOW }, async () => {
  // (Spark 4's one-time command was given already: said once a Spark while the console runs)
  const none = await asked('make the k2 note on the other one again', RUN('spark4', 'touch notes/k2-again.txt'));
  const n = await pressed(none.chat, none.yes);
  assert.equal(n.message.content, `Run it: ${NONE4}`);
  const fail = await asked('fix the failing note again', RUN('spark3', 'bash notes/fail.sh'));
  const f = await pressed(fail.chat, fail.yes);
  assert.equal(f.message.content, `Run it: ${FAILED}`);
  const write = await asked('write the other project file', WRITE('~/notes/otherproj/app.py', 'print("hi")\n'));
  const w = await pressed(write.chat, write.yes);
  assert.match(w.message.content, /^Run it: Nothing was written: \S/, w.message.content);
  const slow = await asked('run the slow note', RUN('spark3', 'bash notes/slow.sh'));
  const s = await pressed(slow.chat, slow.yes);
  assert.equal(s.message.content, `Run it: It ran past its ${SECONDS} seconds and was ended, with everything it started.`);
  // (what the journal's end lines say of the four: never ran, exit 1, exit 1, ended at the limit)
  const end = command => { const st = journal().filter(x => x.k === 'cmd' && x.start && x.args?.command === command).at(-1); return journal().find(x => x.id === st?.id && x.end); };
  assert.deepEqual([end('touch notes/k2-again.txt')?.ran, end('bash notes/slow.sh')?.outcome], [false, 'ended']);
});

test('a task parked at its button and woken by a press that failed reads what happened, not "done"', { timeout: 300000 * SLOW }, async () => {
  const words = 'fix the failing note, then tell me what happened', chat = await newChat();
  script([{ match: `^${esc(words)}$`, rounds: [[RUN('spark3', 'bash notes/fail.sh')]] }, { match: ANSWERED, calls: [] }]);
  const marker = join(T.fleet.dir, 'model-history');
  try {
    const r = await say(chat, words);
    const yes = (r.message.choices || []).find(c => c.label === 'Run it');
    assert.ok(yes, JSON.stringify(r.message));
    const task = JSON.parse(readFileSync(join(T.fleet.stateDir, 'chats.json'), 'utf8')).conversations.find(c => c.id === chat)?.task;
    assert.ok(task?.parked, `set-up: the request is a task parked at its button: ${JSON.stringify(task)}`);
    writeFileSync(marker, '');
    assert.equal((await pressed(chat, yes)).message.content, `Run it: ${FAILED}`);
    const woken = await waitFor(() => lines(join(T.fleet.dir, 'model-history.jsonl')).find(x => new RegExp(ANSWERED).test(x.words)), { timeout: 90000, what: 'the carry-on turn after the press' });
    assert.ok(woken.history.some(h => h.includes(`Run it: ${FAILED}`)), JSON.stringify(woken.history));
    assert.ok(!woken.history.some(h => /Run it: done\./.test(h)), JSON.stringify(woken.history));
    // (K5: its report counts the change, which ran, after the yes)
    const report = await waitFor(async () => (await chatMessages(chat)).find(m => m.report), { timeout: 90000, what: 'the task’s report' });
    assert.equal(report.content.split('\n')[2], 'Changes: 0 made at once, 1 after your yes; 1 question asked of you. Undone: 0.', report.content);
    // (C-8: begun on the page, so its report isn't sent to Telegram, though its ask went there)
    assert.ok(tgSent().some(x => JSON.stringify(x.body?.reply_markup || {}).includes(yes.id)), 'set-up: its ask went to the paired chat');
    await waitFor(() => !JSON.parse(readFileSync(join(T.fleet.stateDir, 'chats.json'), 'utf8')).conversations.find(c => c.id === chat)?.reports, { what: 'the report no longer owed' });
    assert.deepEqual(tgSent().map(x => x.body.text).filter(t => t.startsWith('Report on your request')), []);
  } finally { noScript(); rmSync(marker, { force: true }); }
});

// K5 (R66): the runner writes its start line before the root helper is called; on a Spark with no helper the end line
// says it never ran, and the report counts no change.
test('a task’s change that never ran (no root helper on Spark 4) is no change in its report', { timeout: 300000 * SLOW }, async () => {
  const words = 'make the k5 note on the other one, then tell me what changed', chat = await newChat();
  script([{ match: `^${esc(words)}$`, rounds: [[RUN('spark4', 'touch notes/k5.txt')]] }, { match: ANSWERED, calls: [] }]);
  try {
    const r = await say(chat, words);
    const yes = (r.message.choices || []).find(c => c.label === 'Run it');
    assert.ok(yes, JSON.stringify(r.message));
    assert.equal((await pressed(chat, yes)).message.content, `Run it: ${NONE4}`);
    const report = await waitFor(async () => (await chatMessages(chat)).find(m => m.report), { timeout: 120000, what: 'the task’s report' });
    assert.equal(report.content.split('\n')[2], 'Changes: 0 made at once, 0 after your yes; 1 question asked of you. Undone: 0.', report.content);
    // (through the real path: the start line carries the task, and its end line says it never ran)
    const start = journal().filter(x => x.k === 'cmd' && x.start && x.args?.command === 'touch notes/k5.txt').at(-1);
    assert.equal(start?.task, report.report, JSON.stringify(start));
    assert.equal(journal().find(x => x.id === start.id && x.end)?.ran, false);
    assert.ok(!existsSync(join(T.fleet.root, 'spark4', 'notes', 'k5.txt')));
  } finally { noScript(); }
});

// C-8 (R32): a task begun in the paired chat is reported there once, without the failure lines (no error text there).
test('a task begun in the paired chat: its report there says how many failed and where to look, with no error line; the page’s has it', { timeout: 120000 * SLOW }, async () => {
  const stop = await api(`/chats/${TGSEED.chat}/messages`, { method: 'POST', body: { text: '/stop' } });
  assert.equal(stop.status, 200, stop.text);
  const page = await waitFor(async () => (await chatMessages(TGSEED.chat)).find(m => m.report), { timeout: 60000, what: 'the report in its chat' });
  assert.match(page.content.split('\n')[1], /^Operations: 1 \(1 failed\)\. Failed: Starting c8-model: pull failed at /, page.content);
  const there = await waitFor(() => tgSent().map(x => x.body.text).find(t => t.startsWith('Report on your request')), { timeout: 60000, what: 'the report on Telegram' });
  assert.equal(there.split('\n')[0], `Report on your request “${TGSEED.words}”: stopped by you.`);
  assert.equal(there.split('\n')[1], 'Operations: 1 (1 failed). What failed is in Spark Console.');
  assert.ok(!there.includes('pull failed') && !there.includes('100.64.0.7') && !there.includes('/home/owner'), there);
});

// The two functions, cut from their parts, for every kind of result (Telegram's approvals allow 3 presses an hour, so
// the time limit, an unknown end and the net's outcomes are read here).
test('the words from each kind of result: the page’s pressRan and Telegram’s tgRanLine', () => {
  const cut = (file, re) => { const m = re.exec(readFileSync(join(REPO, 'service', 'src', file), 'utf8')); assert.ok(m, `${file}: ${re}`); return m[0]; };
  const stubs = 'const maskSecrets = s => String(s).replace(/hf_[A-Za-z0-9]{20,}/g, "[hidden]"); const nodeById = id => (["spark3", "spark4"].includes(id) ? { id } : undefined); const sparkName = n => `Spark ${n.id.slice(5)}`;';
  const page = new Function(`${stubs}\n${cut('14-chats.mjs', /^function pressRan\(label, out, agentChat = false\) \{[\s\S]*?\n\}$/m)}\nreturn pressRan;`)();
  const tg = new Function(`${stubs}\n${cut('21-telegram.mjs', /^function tgRanLine\(r\) \{[\s\S]*?\n\}$/m)}\nreturn tgRanLine;`)();
  const ended = 'It ran past its 30 seconds and was ended, with everything it started.', unknown = 'Spark 3 didn’t answer within 45 seconds, so whether it finished is unknown.';
  const rows = [
    [{ spark: 'spark3', ran: true, exit: 0, tail: 'ok\nexit 0' }, 'Run it: done.', 'Done.'],
    [{ spark: 'spark3', ran: true, exit: 2, tail: 'key hf_abcdefghijklmnopqrstuvwxyz\nexit 2' }, 'Run it: it ran and failed, with exit code 2. Its last line: “key [hidden]”.', `It ran and failed, with exit code 2. ${MORE}`],
    [{ spark: 'spark3', ran: true, exit: 1, tail: 'exit 1' }, 'Run it: it ran and failed, with exit code 1.', `It ran and failed, with exit code 1. ${MORE}`],
    [{ spark: 'spark3', ran: true, exit: null, ended }, `Run it: ${ended}`, `${ended} ${MORE}`],
    [{ spark: 'spark3', ran: true, exit: null, ended: unknown }, `Run it: ${unknown}`, `${unknown} ${MORE}`],
    [{ spark: 'spark3', ran: true, exit: null, cut: 'Its output passed 16 MB, so it was ended there.' }, 'Run it: Its output passed 16 MB, so it was ended there.', `Its output passed 16 MB, so it was ended there. ${MORE}`],
    [{ spark: 'spark3', ran: true, exit: 1, notWritten: 'Nothing was written: no such folder' }, 'Run it: Nothing was written: no such folder', `Nothing was written. ${MORE}`],
    [{ spark: 'spark3', ran: true, exit: null, notWritten: 'Whether it was written isn’t known: it was ended before it finished.' }, 'Run it: Whether it was written isn’t known: it was ended before it finished.', `Whether it was written isn’t known: it was ended before it finished. ${MORE}`],
    [{ box: 'open', spark: 'spark3', notWritten: { path: '/work/a.py', why: 'it ended with code 1' } }, 'Run it: Nothing was written to /work/a.py: it ended with code 1.', `Nothing was written. ${MORE}`],
    [{ box: 'open', spark: 'spark3', wrote: { path: '/work/a.py', bytes: 3 } }, 'Run it: done.', 'Done.'],
    [{ spark: 'spark4', ran: false, why: `${NONE4}`, ownerCommand: 'bash x.sh 4' }, `Run it: ${NONE4}\nRun this once in your own terminal (it asks Spark 4’s password once), then ask again:\nbash x.sh 4`, 'Nothing ran: Spark 4 needs your one-time set-up command first. It is in your chat in Spark Console.'],
    [{ spark: 'spark4', ran: false, why: NONE4, next: 'given earlier' }, `Run it: ${NONE4}`, `Nothing ran. ${MORE}`],
    [{ spark: 'spark3', ran: true, exit: 0, notes: ['It was stopped: the disk’s free space fell under 5 GB (the root helper\'s floor).'] }, 'Run it: done. It was stopped: the disk’s free space fell under 5 GB (the root helper\'s floor).', 'Done.'],
    [{ outcome: 'saved', title: 'x' }, null, 'Done.'],
  ];
  for (const [out, onPage, there] of rows) {
    assert.equal(page('Run it', out), onPage, JSON.stringify(out));
    assert.equal(tg(out), there, JSON.stringify(out));
  }
  assert.equal(page('Run it', rows[10][0], true).split('\n')[1], 'The owner runs this once, in their own terminal (it asks Spark 4’s password once), then ask again:');
  // (the net's, Spark 2's and root's: their note on the page, as before; on Telegram a fixed line by the net's outcome)
  const net = (outcome, exit) => ({ spark: 'spark3', ran: true, exit, net: { id: 'x', outcome }, note: 'the net’s own words' });
  assert.deepEqual([tg(net('kept', 0)), tg(net('kept', 3)), tg(net('kept', null)), tg(net('put back', 0)), tg(net('timer', null))], [
    'Done: it ran inside the lock-out net and is kept.', `It ran inside the lock-out net and is kept, but the command itself ended with exit code 3. ${MORE}`,
    `It ran inside the lock-out net and is kept, but the command itself was ended before it finished. ${MORE}`, `It ran inside the lock-out net and was put back. ${MORE}`,
    `It wasn’t kept: if it ran, Spark 3’s own timer puts it back. ${MORE}`]);
});
