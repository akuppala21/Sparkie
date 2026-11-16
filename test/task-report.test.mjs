// Covers: The report when a task ends (design E 2.8 and step 7 as cut, no `report` action; R66): every journal line of a
// request carries its id (its turns, their tool calls, the changes made for it, its operations' end lines), and a task
// made of it keeps that id. When the task ends, code writes one report in its chat from those lines and what is still
// open: how it ended, its operations (finished, failed, cancelled), the changes made at once and after a yes and the
// questions asked, what was undone, how long and how many turns, and the watt-hours its operations' end lines give,
// summed, with one that has no number "not measured", never 0. No log line is in it. It is written once in the chat,
// and told once on Telegram for a task that began there; a restart neither tells it again nor loses one still owed.
// /status shows a task under way with its counts so far, and no request's words. Two operations' watt-hours are summed. A command that changed something (the runner's start line marks
// it a change) counts as a change, after the owner's yes when it was asked; a cancel counts once under "Undone".
//
// The stand-in fleet: Spark 3's plug reads a steady 60 W (test/mock/plugs.mjs) and the status loop counts every
// second, so an operation of a few seconds there has watt-hours on its end line; Spark 4 has no plug, so one there has
// none. A `docker stop` takes 3 seconds and a start or restart 20 (~/.mock/slow-<command>). Telegram is paired. A task's
// report is written 6 seconds after it ends, and a carry-on turn comes 2 seconds after its results.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { T, useFleet, api, newChat, say, choose, chatMessages, waitFor, sleep, SERVICE_FILE, REPO, SLOW } from './lib.mjs';
import { startPlugs } from './mock/plugs.mjs';

const plugs = await startPlugs([{ node_id: 2, available: true, attributes: { '1/6/0': true, '1/144/8': 60000, '1/144/4': 120000, '1/144/5': 500 } }]);
let current = null;   // the service started again by a test, on the same state
after(() => { try { current?.kill('SIGKILL'); } catch {} plugs.close(); });
const TG_TOKEN = '123456789:AAEtestTokenForSparkConsoleXYZ_abcdefghij', OWNER_TG = 5550001;
// A task parked at a button, and its own journal lines as the runner, a cancel and the operation it cancelled write them.
const SEED = { chat: 'sc_e7e70000000000a1', task: 'j_e7e700000001', words: 'tidy the notes folder, then tell me what changed' };
// A second, parked the same way, whose two operations each have watt-hours on their end lines (final read TE-15).
const SEED2 = { chat: 'sc_e7e70000000000a2', task: 'j_e7e700000002', words: 'stop the two test models, then tell me what is left' };
function seedTask(dir, stateDir) {
  const at = new Date(Date.now() - 600000).toISOString(), line = r => JSON.stringify({ at, chat: SEED.chat, task: SEED.task, ...r });
  writeFileSync(join(stateDir, 'chats.json'), JSON.stringify({ conversations: [{ id: SEED.chat, login: 'owner@test', title: 'notes', spark: null, createdAt: at, updatedAt: at,
    messages: [{ role: 'user', content: SEED.words, createdAt: at }, { role: 'assistant', content: 'Asked first.', createdAt: at }],
    task: { id: SEED.task, since: at, request: SEED.words, at, continuations: 0, hours: 2, turns: 8, parked: at } },
  { id: SEED2.chat, login: 'owner@test', title: 'two stops', spark: null, createdAt: at, updatedAt: at,
    messages: [{ role: 'user', content: SEED2.words, createdAt: at }, { role: 'assistant', content: 'Asked first.', createdAt: at }],
    task: { id: SEED2.task, since: at, request: SEED2.words, at, continuations: 0, hours: 2, turns: 8, parked: at } }] }), { mode: 0o600 });
  mkdirSync(join(dir, 'journal'), { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, 'journal', `journal-${new Date().toISOString().slice(0, 7)}.jsonl`), [
    line({ id: 'j_e7e7000000c1', k: 'cmd', start: true, act: 'run', class: 'change', gate: 'asked' }),
    line({ id: 'j_e7e7000000c1', k: 'cmd', end: true, act: 'run', ok: true, outcome: 'ended' }),
    line({ id: 'j_e7e7000000c2', k: 'cmd', start: true, act: 'run', class: 'change', gate: 'sparkie' }),
    line({ id: 'j_e7e7000000c3', k: 'cmd', act: 'run', class: 'look', gate: 'look', ok: true }),
    line({ id: 'j_e7e7000000c4', k: 'call', act: 'cancel_operation', allowed: 'words', ok: true, outcome: 'cancelled' }),
    line({ id: 'j_e7e7000000c5', k: 'op', op: 'e7e7000000c5', act: 'deploy', ok: false, outcome: 'cancelled', noWh: 'it ran on no Spark' }),
    JSON.stringify({ at, chat: SEED2.chat, task: SEED2.task, id: 'j_e7e7000000d1', k: 'op', op: 'e7e7000000d1', act: 'stop', ok: true, outcome: 'completed', wh: 1.5 }),
    JSON.stringify({ at, chat: SEED2.chat, task: SEED2.task, id: 'j_e7e7000000d2', k: 'op', op: 'e7e7000000d2', act: 'stop', ok: true, outcome: 'completed', wh: 2.25 }),
  ].join('\n') + '\n', { mode: 0o600 });
}
useFleet({ telegram: true, watchMs: 60000, statusMs: 1000,
  env: { SPARK_CONSOLE_PLUGS_URL: plugs.url, SPARK_CONSOLE_PLUGS_MS: '300', SPARK_CONSOLE_CONTINUE_MS: '2000', SPARK_CONSOLE_TASK_REPORT_MS: '6000', SPARK_CONSOLE_TELEGRAM_LIMITS: '1000,1000,1000' },
  prepare: ({ dir, root, stateDir }) => {
    mkdirSync(join(dir, 'secrets'), { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, 'secrets', 'secrets.json'), JSON.stringify({ telegram: { token: TG_TOKEN, bot: 'spark_test_bot', chatId: OWNER_TG, userId: OWNER_TG, name: 'Owner', pairedAt: new Date().toISOString() } }), { mode: 0o600 });
    writeFileSync(join(stateDir, 'plugs.json'), JSON.stringify({ spark3: { node: 2 } }), { mode: 0o600 });
    writeFileSync(join(stateDir, 'power.json'), JSON.stringify({ idleMinutes: 0, off: {} }), { mode: 0o600 });
    for (const spark of ['spark3', 'spark4']) writeFileSync(join(root, spark, '.mock', 'slow-stop'), '3');
    for (const c of ['start', 'restart']) writeFileSync(join(root, 'spark3', '.mock', `slow-${c}`), '20');
    seedTask(dir, stateDir);
  } }, () => waitFor(async () => (await api('/telegram')).json.state === 'ok', { what: 'Telegram polling' }));

const RADIX = 'sc-RadixArk--Qwen3.8-27B-NVFP4', GGUF = 'sc-testorg--Qwen3.8-27B-abliterated-GGUF';
const FINISHED = '^\\[Spark Console\\] What you started for the owner', ANSWERED = '^\\[Spark Console\\] The owner answered your question';
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const noScript = () => rmSync(join(T.fleet.dir, 'model-script.json'), { force: true });
const esc = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const records = () => (existsSync(T.fleet.journalDir) ? readdirSync(T.fleet.journalDir).filter(f => f.endsWith('.jsonl')).sort()
  .flatMap(f => readFileSync(join(T.fleet.journalDir, f), 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } })) : []);
const chatsOf = () => JSON.parse(readFileSync(join(T.fleet.stateDir, 'chats.json'), 'utf8')).conversations;
const tgChat = () => chatsOf().find(c => c.channel === 'telegram');
const sent = () => { const p = join(T.fleet.dir, 'telegram-calls.jsonl'); return existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(c => c.method === 'sendMessage').map(c => String(c.body?.text || '')) : []; };
const reportsSent = () => sent().filter(t => t.startsWith('Report on your request'));
let msgId = 700;
const tgSay = text => fetch(`http://127.0.0.1:${T.fleet.telegramPort}/__push`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ message: { message_id: msgId++, date: Math.floor(Date.now() / 1000), chat: { id: OWNER_TG, type: 'private' }, from: { id: OWNER_TG, is_bot: false, first_name: 'Owner' }, text } }) });
const stateOf = (spark, name) => readFileSync(join(T.fleet.root, spark, '.mock', 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];
const reportsIn = async chat => (await chatMessages(chat)).filter(m => m.report);
// Spark Console ends at once (a crash: nothing of its own clean-up runs), and comes back on the same state.
async function restart() {
  if (current) { const gone = new Promise(r => current.once('exit', r)); current.kill('SIGKILL'); await gone; }
  else { process.kill(T.fleet.servicePid(), 'SIGKILL'); await waitFor(() => T.fleet.serviceExit(), { timeout: 10000, what: 'the service to end' }); }
  current = spawn(process.execPath, [SERVICE_FILE], { cwd: REPO, env: T.fleet.env, stdio: 'ignore' });
  await waitFor(async () => (await api('/health').catch(() => null))?.status === 200, { timeout: 30000, what: 'the service back' });
  await waitFor(async () => (await api('/telegram')).json.state === 'ok', { what: 'Telegram polling again' });
}

// The read after E7: a command's change was not counted, and a cancel counted twice.
test('a task’s report counts a command that changed something, after the yes when it was asked, and a cancel once', { timeout: 120000 * SLOW }, async () => {
  const stop = await api(`/chats/${SEED.chat}/messages`, { method: 'POST', body: { text: '/stop' } });
  assert.equal(stop.status, 200, stop.text);
  const report = await waitFor(async () => (await reportsIn(SEED.chat))[0] || null, { timeout: 60000 * SLOW, what: 'the seeded task’s report', every: 500 });
  const lines = report.content.split('\n');
  assert.equal(lines[0], `Report on your request “${SEED.words}”: stopped by you.`);
  assert.equal(lines[1], 'Operations: 1 (1 cancelled).');
  assert.equal(lines[2], 'Changes: 2 made at once, 1 after your yes; 0 questions asked of you. Undone: 1.');
});

// (final read TE-15: two numbers are summed, not the last one kept)
test('a task’s report sums the watt-hours of its operations', { timeout: 120000 * SLOW }, async () => {
  const stop = await api(`/chats/${SEED2.chat}/messages`, { method: 'POST', body: { text: '/stop' } });
  assert.equal(stop.status, 200, stop.text);
  const report = await waitFor(async () => (await reportsIn(SEED2.chat))[0] || null, { timeout: 60000 * SLOW, what: 'the second seeded task’s report', every: 500 });
  const lines = report.content.split('\n');
  assert.equal(lines[1], 'Operations: 2 (2 finished).', report.content);
  assert.equal(lines[4], 'Energy at the wall: 3.8 Wh for 2 operations.', report.content);
});

// (Sparkie offers each change as a button here, and the owner presses them: the counts below say so)
test('a task that ends done: one report in its chat, counted from its own journal lines, its watt-hours summed and an operation with no number not measured', { timeout: 300000 * SLOW }, async () => {
  assert.deepEqual([stateOf('spark3', GGUF), stateOf('spark4', RADIX)], ['running', 'running']);
  // (Spark 3's plug readings are being counted before anything starts, as an operation's number needs: op-energy.test.mjs)
  await waitFor(async () => ((await api('/status')).json.energy?.nodes?.spark3?.wallCoverageSeconds || 0) >= 3 || null, { timeout: 60000 * SLOW, what: 'Spark 3’s wall readings counted', every: 500 });
  const words = `please stop the two models on spark 3 and spark 4, then tell me what is left running`;
  script([{ match: `^${esc(words)}$`, calls: [{ name: 'stop_model', arguments: { spark: 'spark3', container: GGUF } }, { name: 'stop_model', arguments: { spark: 'spark4', container: RADIX } }] },
    { match: FINISHED, calls: [] }, { match: ANSWERED, calls: [] }]);
  let chat, report;
  try {
    chat = await newChat();
    const r = await say(chat, words);
    assert.deepEqual(r.message.tools.map(t => [t.name, t.outcome ?? null]), [['stop_model', 'needs-ok'], ['stop_model', 'needs-ok']], r.text);
    for (const c of r.message.choices.filter(x => /^Stop /.test(x.label))) assert.equal((await choose(chat, c.id)).status, 200);
    report = await waitFor(async () => (await reportsIn(chat))[0] || null, { timeout: 180000 * SLOW, what: 'the task’s report', every: 500 });
  } finally { noScript(); }
  // Its id is the request's own: the first turn's journal id, on each line of it.
  const said = records().find(x => x.k === 'said' && x.chat === chat);
  assert.equal(report.report, said.id);
  const mine = records().filter(x => x.task === said.id);
  assert.deepEqual([...new Set(mine.map(x => x.k))].sort(), ['call', 'op', 'tool', 'turn']);
  const ops = mine.filter(x => x.k === 'op');
  assert.equal(ops.length, 2);
  const measured = ops.filter(o => typeof o.wh === 'number');
  assert.equal(measured.length, 1, `Spark 3 has a plug, Spark 4 none: ${JSON.stringify(ops.map(o => [o.wh, o.noWh]))}`);
  const lines = report.content.split('\n');
  assert.equal(lines[0], `Report on your request “${words}”: done.`);
  assert.equal(lines[1], 'Operations: 2 (2 finished).');
  assert.equal(lines[2], 'Changes: 0 made at once, 2 after your yes; 2 questions asked of you. Undone: 0.');
  assert.match(lines[3], /^Time: (\d+ s|\d+ min), [2-4] turns\.$/);
  assert.equal(lines[4], `Energy at the wall: ${Math.round(measured[0].wh * 10) / 10} Wh for 1 operation; 1 not measured.`);
  assert.equal(lines[5], 'Still open: nothing.');
  assert.equal(lines.length, 6);
  // No log line of its operations is in it.
  for (const o of ops) for (const l of (await api(`/jobs/${o.op}`)).json?.log || []) assert.ok(!report.content.includes(String(l).slice(10)), String(l));
  // Once in the chat; asked on the page and under an hour, so not on Telegram.
  await sleep(8000);
  assert.equal((await reportsIn(chat)).length, 1);
  assert.deepEqual(reportsSent(), []);
  assert.ok(!chatsOf().find(c => c.id === chat).reports, 'nothing owed');
});

test('a task from Telegram: /status shows its counts so far; /stop there ends it with one report in its chat and one on Telegram naming what still runs; a restart tells it again nowhere', { timeout: 300000 * SLOW }, async () => {
  assert.equal(stateOf('spark3', GGUF), 'exited');
  const words = 'restart the model on spark 3, then tell me when it answers';
  script([{ match: `^${esc(words)}$`, calls: [{ name: 'restart_model', arguments: { spark: 'spark3', container: GGUF } }] }, { match: ANSWERED, calls: [] }]);
  try {
    await tgSay(words);
    await waitFor(() => tgChat()?.task?.channel === 'telegram' || null, { timeout: 60000 * SLOW, what: 'the task from Telegram', every: 250 });
    // (its change is a button: the owner presses it on the page, and the restart runs)
    const chat0 = tgChat().id, button = await waitFor(async () => (await chatMessages(chat0)).flatMap(m => m.choices || []).find(c => /^Restart /.test(c.label) && c.state === 'open') || null, { what: 'the button' });
    assert.equal((await choose(chat0, button.id)).status, 200);
    await sleep(4000);
  } finally { noScript(); }
  const chat = tgChat().id, id = tgChat().task.id;
  // /status, under way: its counts so far.
  const status = await say(await newChat(), '/status');
  assert.match(status.text, new RegExp(`\\nRequests Sparkie is carrying on with:\\n- “${esc(words)}” \\(carrying on\\): 1 operation \\(1 running\\), 1 change, [12] turns?, \\d+ s so far, energy not measured\\.$`), status.text);
  const page = (await api('/status')).json.tasks;
  assert.deepEqual(page.map(x => [x.chat, x.state, x.operations, x.running, x.changes]), [[chat, 'carrying on', 1, 1, 1]], JSON.stringify(page));
  assert.ok(!JSON.stringify(page).includes(GGUF), 'no words of the request on the page’s status');
  assert.ok(page.every(x => !('request' in x)) && !JSON.stringify(page).includes('tell me when it answers'), `no request on the page’s status (final read TE-11): ${JSON.stringify(page)}`);
  await tgSay('/stop');
  const report = await waitFor(async () => (await reportsIn(chat))[0] || null, { timeout: 60000 * SLOW, what: 'the report', every: 500 });
  assert.equal(report.report, id);
  const lines = report.content.split('\n');
  assert.equal(lines[0], `Report on your request “${words}”: stopped by you.`);
  assert.equal(lines[1], 'Operations: none.');
  assert.equal(lines[2], 'Changes: 0 made at once, 1 after your yes; 1 question asked of you. Undone: 0.');
  assert.match(lines.at(-1), /^Still open: .*Qwen3\.8-27B-abliterated-GGUF is still running\.$/, report.content);
  await waitFor(() => reportsSent().length === 1 || null, { timeout: 30000, what: 'the report on Telegram' });
  assert.ok(reportsSent()[0].startsWith(lines[0]), reportsSent()[0]);
  await restart();
  await sleep(10000);
  assert.equal((await reportsIn(chat)).length, 1, 'once in the chat');
  assert.equal(reportsSent().length, 1, 'once on Telegram');
});

test('a report still owed when Spark Console stops is written and told once after the start', { timeout: 300000 * SLOW }, async () => {
  // (what the test before left: every operation ended, and Spark 3's model stopped, so the restart below starts it)
  await waitFor(async () => !(await api('/actions/recent_operations', { method: 'POST', body: { limit: 50 } })).json.operations.some(o => o.status === 'running') || null, { timeout: 120000 * SLOW, what: 'every operation to end', every: 1000 });
  if (stateOf('spark3', GGUF) === 'running') {
    const s = await api('/stop', { method: 'POST', body: { node: 'spark3', container: GGUF } });
    await waitFor(async () => ((await api(`/jobs/${s.json?.id}`)).json?.status || 'running') !== 'running' || null, { timeout: 60000 * SLOW, what: 'the stop', every: 500 });
  }
  const words = `restart ${GGUF} on spark 3 again, then tell me when it answers`;
  script([{ match: `^${esc(words)}$`, calls: [{ name: 'restart_model', arguments: { spark: 'spark3', container: GGUF } }] }]);
  const before = reportsSent().length;
  try {
    await tgSay(words);
    await waitFor(() => tgChat()?.task?.channel === 'telegram' || null, { timeout: 60000 * SLOW, what: 'the task from Telegram', every: 250 });
  } finally { noScript(); }
  const chat = tgChat().id, had = (await reportsIn(chat)).length;
  await tgSay('/stop');
  // (owed on disk: the report is written 6 seconds after the end, and Spark Console stops before that)
  await waitFor(() => chatsOf().find(c => c.id === chat)?.reports?.length || null, { timeout: 30000, what: 'the report owed on disk', every: 100 });
  await restart();
  await waitFor(async () => (await reportsIn(chat)).length === had + 1 || null, { timeout: 60000 * SLOW, what: 'the report after the start', every: 500 });
  await waitFor(() => reportsSent().length === before + 1 || null, { timeout: 30000, what: 'the report on Telegram after the start' });
  await sleep(8000);
  assert.equal((await reportsIn(chat)).length, had + 1);
  assert.equal(reportsSent().length, before + 1);
  assert.ok(!chatsOf().find(c => c.id === chat).reports, 'nothing owed');
});
