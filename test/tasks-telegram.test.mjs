// Covers: Long tasks (design E 2.1 as cut, step 6; R66), first piece (E6a), on Telegram (R32): a task made from the
// paired chat keeps which pairing it came from (a mark, never the chat's ids). The owner's /stop there takes the task
// off the record on disk at once, though no answer is saved in the chat. A new bot token ends a task from Telegram, as
// Disconnect does; so does a new pairing, made while a task from the pairing before is still on disk (the look after a
// start comes late here). Started again paired with someone else, such a task ends at the look after the start: no
// carry-on turn, and nothing of it is told to the new chat. A carry-on turn here waits ten minutes, so a task stays as
// it is made; the brain's context is 1,000 tokens, so one long lookup ends a reply at the output budget and makes one.
// A task's report on Telegram that fails to send is tried again (A-8): marked before the send, put back on a failure
// for now and tried on later ticks with a growing wait, four tries in all, then dropped and said in the journal; a
// refusal that never succeeds (403, the bot blocked) is tried once (a fleet of its own, its stand-in told to fail, what
// Telegram took counted exactly). The final read of the chat: a chat's reports are sent one tick at a time, so two that
// meet while a send waits are both kept and each sent once (C8c); each report keeps its own schedule (C9); one owed
// across a restart is sent once at its next try (C8c); one owed to a pairing is never sent to the chat paired since,
// nor is a result tried again in memory (C4); a result counts toward the hour's six only when it went (C7).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync, cpSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { T, useFleet, api, waitFor, sleep, SERVICE_FILE, REPO, SLOW } from './lib.mjs';
import { serviceConfig, startMock } from './start-mock.mjs';
import { Authenticator, passkeyHeader } from './authenticator.mjs';

const MAIN_ORIGIN = serviceConfig().origin, TAILNET = new URL(MAIN_ORIGIN).hostname.split('.').slice(1).join('.');
const KEY = new Authenticator(TAILNET, MAIN_ORIGIN);
const TG_TOKEN = '123456789:AAEtestTokenForSparkConsoleXYZ_abcdefghij', OWNER_TG = 5550001, OTHER_TG = 5559999;
const ago = ms => new Date(Date.now() - ms).toISOString();
const pairing = (id, pairedAt) => ({ token: TG_TOKEN, bot: 'spark_test_bot', chatId: id, userId: id, name: id === OWNER_TG ? 'Owner' : 'Someone', pairedAt });
const writeSecrets = (dir, s) => { mkdirSync(join(dir, 'secrets'), { recursive: true, mode: 0o700 }); writeFileSync(join(dir, 'secrets', 'secrets.json'), JSON.stringify(s), { mode: 0o600 }); };
useFleet({ telegram: true, watchMs: 60000, env: { SPARK_CONSOLE_CONTINUE_MS: '600000' }, prepare: ({ dir, stateDir }) => {
  writeSecrets(dir, { telegram: pairing(OWNER_TG, ago(3600000)) });
  const f = join(stateDir, 'main.json'), m = JSON.parse(readFileSync(f, 'utf8'));
  m.presets[m.current] = { ...m.presets[m.current], contextTokens: 1000 };
  writeFileSync(f, JSON.stringify(m), { mode: 0o600 });
} }, async () => {
  await waitFor(async () => (await api('/telegram')).json.state === 'ok', { what: 'Telegram polling' });
  // (a new bot token, and a new pairing code, need the owner's passkey)
  const b = await api('/auth/passkey/begin', { method: 'POST', body: { purpose: 'register' } });
  const r = await api('/auth/passkey/register', { method: 'POST', body: KEY.register(b.json) });
  assert.equal(r.status, 201, r.text);
});

const esc = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CARRIED = '^\\[Spark Console\\] Your last reply stopped at the limit of one message';
const FINISHED = '^\\[Spark Console\\] What you started for the owner';
const QUIET = [{ match: CARRIED, calls: [] }, { match: FINISHED, calls: [] }];
const LONG = { name: 'workflows', arguments: {} };
// Any fleet's page calls, its Telegram stand-in and its disk (T.fleet, or one started here).
const call = async (f, path, { method = 'GET', body, headers = {} } = {}) => {
  const r = await fetch(`${f.base}${path}`, { method, headers: { ...(method === 'GET' ? {} : { 'content-type': 'application/json', 'x-spark-console': '1', origin: f.origin }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, text, json };
};
async function confirmed(f, method, path, body) {
  const b = await call(f, '/auth/passkey/begin', { method: 'POST', body: { purpose: 'confirm', method, path, body } });
  assert.equal(b.status, 200, b.text);
  return call(f, path, { method, body, headers: { 'x-spark-passkey': passkeyHeader(KEY.sign(b.json)) } });
}
const chatsOf = f => { try { return JSON.parse(readFileSync(join(f.stateDir, 'chats.json'), 'utf8')).conversations; } catch { return []; } };
const taskIn = (f, id) => chatsOf(f).find(c => c.id === id)?.task ?? null;
const sentOf = f => { const p = join(f.dir, 'telegram-calls.jsonl'); return existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(c => c.method === 'sendMessage').map(c => ({ to: c.body?.chat_id, text: String(c.body?.text || '') })) : []; };
let msgId = 900;
const tgSay = (f, text, from = OWNER_TG) => fetch(`http://127.0.0.1:${f.telegramPort}/__push`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ message: { message_id: msgId++, date: Math.floor(Date.now() / 1000), chat: { id: from, type: 'private' }, from: { id: from, is_bot: false, first_name: from === OWNER_TG ? 'Owner' : 'Someone' }, text } }) });
const others = [];
after(async () => { for (const f of others) await f.stop().catch(() => {}); }, { timeout: 60000 });
const made = {};

// A task made from Telegram: its reply reached the output budget, and it waits for its carry-on turn.
async function tasked(words) {
  writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify([{ match: `^${esc(words)}$`, rounds: [[LONG]] }]));
  try {
    await tgSay(T.fleet, words);
    return await waitFor(() => chatsOf(T.fleet).find(c => c.channel === 'telegram' && c.task?.carry && c.task.request === words), { timeout: 120000 * SLOW, what: `the task of “${words}” on disk` });
  } finally { rmSync(join(T.fleet.dir, 'model-script.json'), { force: true }); }
}

test('/stop from Telegram takes the task off the record on disk at once', { timeout: 300000 * SLOW }, async () => {
  const conv = await tasked('read the workflows from the phone, then tell me which one stops a model');
  assert.deepEqual([conv.task.channel, conv.task.carry], ['telegram', true], JSON.stringify(conv.task));
  const from = sentOf(T.fleet).length;
  await tgSay(T.fleet, '/stop');
  const line = await waitFor(() => sentOf(T.fleet).slice(from).find(x => /^Stopped\./.test(x.text)), { timeout: 60000 * SLOW, what: 'the answer to /stop on Telegram' });
  assert.match(line.text, /it won’t carry on with that request/);
  assert.equal(taskIn(T.fleet, conv.id), null, 'Telegram was told it won’t carry on: so says the disk');
});

test('a new bot token ends a task from Telegram, as Disconnect does', { timeout: 300000 * SLOW }, async () => {
  const conv = await tasked('read the workflows again from the phone, then tell me which one stops a model');
  const r = await confirmed(T.fleet, 'PUT', '/telegram', { token: TG_TOKEN });
  assert.equal(r.status, 200, r.text);
  made.code = new URL(r.json.code.link).searchParams.get('start');
  assert.equal(taskIn(T.fleet, conv.id), null, 'the new token ended it');
});

// (the disk as fleet A left it when killed, and its secrets; the fleets below start from it)
const start = (telegram, env) => startMock({ telegram: true, watchMs: 60000, evalOnRecord: false, env, prepare: ({ dir, stateDir }) => {
  for (const x of readdirSync(stateDir)) rmSync(join(stateDir, x), { recursive: true, force: true });
  cpSync(T.fleet.stateDir, stateDir, { recursive: true });
  // (the last update read there was the old stand-in's: this one counts from 1 again)
  rmSync(join(stateDir, 'telegram.json'), { force: true });
  writeSecrets(dir, { ...made.secrets, telegram });
  writeFileSync(join(dir, 'model-script.json'), JSON.stringify(QUIET));
} });

test('a new pairing ends a task from the pairing before (the look after the start comes late here)', { timeout: 400000 * SLOW }, async () => {
  assert.ok(made.code, 'the test above set a new token');
  // The owner pairs again, with the new token's code, and makes a task there; then the console is killed.
  const from = sentOf(T.fleet).length;
  await tgSay(T.fleet, `/start ${made.code}`);
  await waitFor(() => sentOf(T.fleet).slice(from).some(x => /^Paired with Spark Console\./.test(x.text)), { timeout: 60000 * SLOW, what: 'paired again' });
  made.conv = await tasked('read the workflows once more from the phone, then tell me which one stops a model');
  process.kill(T.fleet.servicePid(), 'SIGKILL');
  await waitFor(() => T.fleet.serviceExit(), { what: 'the console to end' });
  made.secrets = JSON.parse(readFileSync(T.fleet.secretsFile, 'utf8'));
  // D: the token kept and no chat paired; someone else pairs with a new code.
  const D = await start({ token: TG_TOKEN, bot: 'spark_test_bot' }, { SPARK_CONSOLE_CONTINUE_MS: '600000', SPARK_CONSOLE_TASKS_AFTER_MS: '600000' });
  others.push(D);
  try {
    assert.ok(taskIn(D, made.conv.id), 'on disk at the start');
    const p = await confirmed(D, 'POST', '/telegram/pair', {});
    assert.equal(p.status, 200, p.text);
    await tgSay(D, `/start ${new URL(p.json.code.link).searchParams.get('start')}`, OTHER_TG);
    await waitFor(async () => (await call(D, '/telegram')).json.paired === true, { timeout: 60000 * SLOW, what: 'the new pairing' });
    assert.equal(taskIn(D, made.conv.id), null, 'the new pairing ended the task from the one before');
  } finally { await D.stop(); }
});

test('a task from Telegram keeps a mark of its pairing (not the chat’s ids); started again paired with someone else, it ends at the look and tells the new chat nothing', { timeout: 300000 * SLOW }, async () => {
  assert.ok(made.secrets, 'the test above left the disk');
  assert.ok(/^[0-9a-f]{16}$/.test(made.conv.task.tg), JSON.stringify(made.conv.task));
  assert.ok(!JSON.stringify(made.conv.task).includes(String(OWNER_TG)), 'no id of the paired chat on the task');
  const E = await start(pairing(OTHER_TG, new Date().toISOString()), { SPARK_CONSOLE_CONTINUE_MS: '1500', SPARK_CONSOLE_TASKS_AFTER_MS: '3000' });
  others.push(E);
  await sleep(12000 * SLOW);
  const id = made.conv.id, m = (await call(E, `/chats/${id}`)).json.messages;
  const got = { carryOnTurns: m.filter(x => x.auto).length, stillATask: Boolean(taskIn(E, id)), toldToTheNewChat: sentOf(E).filter(x => x.to === OTHER_TG && /stops a model|Carry on with that request/.test(x.text)).map(x => x.text.slice(0, 160)) };
  assert.deepEqual(got, { carryOnTurns: 0, stillATask: false, toldToTheNewChat: [] }, JSON.stringify(m.slice(-3).map(x => [x.role, String(x.content).slice(0, 80)])));
});

// A-8 (R32) and the final read of the chat (C4, C7, C8c, C9): a fleet of its own for these, its stand-in Bot API told to
// fail (and to wait first, `hold`); what Telegram took (answered 200) is counted exactly from telegram-delivered.jsonl.
let a8 = null, a8Child = null;
after(() => { try { a8Child?.kill('SIGKILL'); } catch {} });
async function a8Fleet() {
  if (a8) return a8;
  const F = await startMock({ telegram: true, watchMs: 60000, env: { SPARK_CONSOLE_CONTINUE_MS: '600000', SPARK_CONSOLE_TASK_REPORT_MS: '500', SPARK_CONSOLE_TELL_RETRY_MS: '1500', SPARK_CONSOLE_TELEGRAM_LIMITS: '1000,1000,1000' },
    prepare: ({ dir, stateDir }) => {
      writeSecrets(dir, { telegram: pairing(OWNER_TG, ago(3600000)) });
      const f = join(stateDir, 'main.json'), m = JSON.parse(readFileSync(f, 'utf8'));
      m.presets[m.current] = { ...m.presets[m.current], contextTokens: 1000 };
      writeFileSync(f, JSON.stringify(m), { mode: 0o600 });
    } });
  others.push(F);
  await waitFor(async () => (await call(F, '/telegram')).json?.state === 'ok', { what: 'Telegram polling' });
  // (a new pairing needs the owner's passkey, C4)
  const b = await call(F, '/auth/passkey/begin', { method: 'POST', body: { purpose: 'register' } });
  const r = await call(F, '/auth/passkey/register', { method: 'POST', body: KEY.register(b.json) });
  assert.equal(r.status, 201, r.text);
  a8 = F;
  return F;
}
const mode = (F, m) => fetch(`http://127.0.0.1:${F.telegramPort}/__mode`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(m) });
const jsonl = p => (existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const REPORT = words => `Report on your request “${words}”`;
// The stand-in's calls that sent a task's report (each one, failed or not), to one chat or any; and the ones it took.
const reportCalls = (F, words, to = null) => jsonl(join(F.dir, 'telegram-calls.jsonl')).filter(c => c.method === 'sendMessage' && String(c.body?.text || '').startsWith(REPORT(words)) && (to === null || c.body?.chat_id === to));
const reportSends = (F, words) => reportCalls(F, words).length;
const delivered = (F, words) => jsonl(join(F.dir, 'telegram-delivered.jsonl')).filter(d => String(d.text || '').startsWith(REPORT(words)));
const dropped = (F, id) => readdirSync(F.journalDir).filter(f => f.endsWith('.jsonl')).flatMap(f => jsonl(join(F.journalDir, f))).filter(x => x.k === 'event' && x.act === 'telegram-dropped' && x.task === id);
const owed = (F, chat) => chatsOf(F).find(c => c.id === chat)?.reports || [];
// A task made from the paired chat (its reply at the output budget), on disk; replied: once its reply went there too.
async function a8Task(F, words, { replied = true } = {}) {
  writeFileSync(join(F.dir, 'model-script.json'), JSON.stringify([{ match: `^${esc(words)}$`, rounds: [[LONG]] }]));
  const before = jsonl(join(F.dir, 'telegram-delivered.jsonl')).length;
  try {
    await tgSay(F, words);
    const conv = await waitFor(() => chatsOf(F).find(c => c.channel === 'telegram' && c.task?.carry && c.task.request === words), { timeout: 120000 * SLOW, what: `the task of “${words}” on disk` });
    if (replied) {
      await waitFor(() => jsonl(join(F.dir, 'telegram-delivered.jsonl')).length > before, { timeout: 60000 * SLOW, what: 'the reply in the paired chat' });
      await sleep(1000);
    }
    return conv;
  } finally { rmSync(join(F.dir, 'model-script.json'), { force: true }); }
}
// (ended by /stop on the page: its report goes to Telegram)
const stop = (F, conv) => call(F, `/chats/${conv.id}/messages`, { method: 'POST', body: { text: '/stop' } });
const owedGone = (F, conv) => waitFor(() => !chatsOf(F).find(c => c.id === conv.id)?.reports, { timeout: 120000 * SLOW, what: 'the reports no longer owed' });
// Two reports owed in one chat: a task, then (Telegram failing now) the owner's next request there, which ends it, and
// that one's task ended on the page.
async function twoOwed(F, wA, wB, failing) {
  const cA = await a8Task(F, wA);
  await mode(F, failing);
  const cB = await a8Task(F, wB, { replied: false });
  assert.equal(cB.id, cA.id, 'set-up: one chat');
  assert.equal((await stop(F, cB)).status, 200);
  return [cA, cB];
}

// A-8 (R32): a report that fails to reach the paired chat is tried again a few times, never twice once sent; a 403 once.
test('a task’s report on Telegram: two failed tries then sent once; always failing, four tries then dropped in the journal; a 403, one try', { timeout: 400000 * SLOW }, async () => {
  const F = await a8Fleet();
  try {
    // Two failed tries (each one of tgSend's: a 429, its wait, a 429), then sent: five calls, the last one went, once.
    const w1 = 'read the workflows for the first report, then tell me which one stops a model', c1 = await a8Task(F, w1);
    await mode(F, { slowDown: 4 });
    assert.equal((await stop(F, c1)).status, 200);
    await owedGone(F, c1);
    // (no longer owed, and not dropped: it went, after a try that failed; none after it)
    assert.deepEqual(dropped(F, c1.task.id), []);
    const n1 = reportSends(F, w1);
    assert.ok(n1 >= 3, `a failed try (two calls) and the one that went: ${n1}`);
    assert.equal(delivered(F, w1).length, 1, 'Telegram took it once');
    await sleep(4000);
    assert.equal(reportSends(F, w1), n1, 'nothing more once it went');
    assert.equal(delivered(F, w1).length, 1, 'nothing more once it went');
    // Always failing: four tries, then dropped, said in the journal; nothing owed after.
    const w2 = 'read the workflows for the second report, then tell me which one stops a model', c2 = await a8Task(F, w2);
    await mode(F, { slowDown: 100000 });
    assert.equal((await stop(F, c2)).status, 200);
    const d2 = await waitFor(() => dropped(F, c2.task.id)[0], { timeout: 120000 * SLOW, what: 'the dropped report in the journal' });
    assert.deepEqual([d2.what, d2.tries, d2.outcome], ['report', 4, 'dropped']);
    assert.equal(reportSends(F, w2), 8);
    assert.equal(delivered(F, w2).length, 0, 'Telegram took none of them');
    await owedGone(F, c2);
    // A 403 (the bot blocked): one try, dropped at once.
    await mode(F, {});
    const w3 = 'read the workflows for the third report, then tell me which one stops a model', c3 = await a8Task(F, w3);
    await mode(F, { blocked: true });
    assert.equal((await stop(F, c3)).status, 200);
    const d3 = await waitFor(() => dropped(F, c3.task.id)[0], { timeout: 60000 * SLOW, what: 'the dropped report in the journal' });
    assert.deepEqual([d3.tries, d3.err], [1, 'never']);
    await sleep(5000);
    assert.equal(reportSends(F, w3), 1);
    assert.equal(delivered(F, w3).length, 0, 'Telegram took none');
  } finally { await mode(F, {}); }
});

// C8c: one tick at a time a chat. A second report's tick that came while the first one's send waited on Telegram took
// the report in flight off the list, so it was lost (or sent twice). Both are tried in turn, both stay owed, and each
// is sent exactly once when Telegram takes them.
test('C8c: two reports meet in one chat while a send waits on Telegram: each is tried in turn, kept, and sent exactly once', { timeout: 400000 * SLOW }, async () => {
  const F = await a8Fleet(), HOLD = 4000;
  const wA = 'read the workflows for the guard’s first report, then tell me which one stops a model', wB = 'read the workflows for the guard’s second report, then tell me which one stops a model';
  try {
    const [cA, cB] = await twoOwed(F, wA, wB, { hold: HOLD, slowDown: 100000 });
    const stopped = Date.now();
    await waitFor(() => [cA.task.id, cB.task.id].every(id => owed(F, cA.id).some(r => r.task === id && r.tg && r.told === false && r.tgTries >= 1)), { timeout: 120000 * SLOW, every: 250, what: 'both reports tried once and both still owed' });
    // (set-up: the second report's tick, half a second after its task ended, came while the first one's try waited)
    const a = reportCalls(F, wA);
    assert.ok(Date.parse(a[1]?.at) + HOLD > stopped + 500, `set-up: the first report's try still waited on Telegram (${a.map(c => c.at)}; ended ${new Date(stopped).toISOString()})`);
    await mode(F, {});
    for (const w of [wA, wB]) await waitFor(() => delivered(F, w).length > 0, { timeout: 120000 * SLOW, what: `the report of “${w}” delivered` });
    await owedGone(F, cA);
    await sleep(5000);
    assert.deepEqual([delivered(F, wA).length, delivered(F, wB).length], [1, 1], 'each delivered exactly once');
    assert.deepEqual([...dropped(F, cA.task.id), ...dropped(F, cB.task.id)], []);
  } finally { await mode(F, {}); }
});

// C9: each report on its own schedule. Two owed in one chat, Telegram always failing: each gets its four tries, each
// try after the wait its own last failure set (1.5, 3, 6 seconds here), never one sooner because the other's came due.
test('C9: two reports owed in one chat, Telegram failing: each its own four tries, each wait double the one before, then dropped', { timeout: 400000 * SLOW }, async () => {
  const F = await a8Fleet();
  const wA = 'read the workflows for the doubling’s first report, then tell me which one stops a model', wB = 'read the workflows for the doubling’s second report, then tell me which one stops a model';
  try {
    const [cA, cB] = await twoOwed(F, wA, wB, { slowDown: 100000 });
    for (const id of [cA.task.id, cB.task.id]) {
      const d = await waitFor(() => dropped(F, id)[0], { timeout: 180000 * SLOW, what: 'the dropped report in the journal' });
      assert.deepEqual([d.what, d.tries, d.outcome], ['report', 4, 'dropped']);
    }
    for (const w of [wA, wB]) {
      const calls = reportCalls(F, w);
      assert.equal(calls.length, 8, `four tries, each of tgSend's two calls (a 429, its wait, a 429): ${calls.map(c => c.at)}`);
      const starts = [0, 2, 4, 6].map(i => Date.parse(calls[i].at));
      for (let k = 1; k <= 3; k++) {
        const gap = starts[k] - starts[k - 1], wait = 1500 * 2 ** (k - 1);
        assert.ok(gap >= wait, `“${w}”: try ${k + 1} came ${gap} ms after try ${k}; its wait is ${wait} ms`);
      }
      assert.equal(delivered(F, w).length, 0);
    }
    await owedGone(F, cA);
  } finally { await mode(F, {}); }
});

// C8c: a restart. A report owed when Spark Console ends at once (no clean-up of its own) is tried after it starts again,
// at the next try kept on disk, and sent exactly once (its in-memory timer died with it: the start-up's tick sets one).
test('C8c: a report owed when Spark Console stops at once is sent after the restart at its next try, exactly once', { timeout: 400000 * SLOW }, async () => {
  const F = await a8Fleet();
  const w = 'read the workflows for the report across a restart, then tell me which one stops a model';
  try {
    const c = await a8Task(F, w);
    await mode(F, { slowDown: 100000 });
    assert.equal((await stop(F, c)).status, 200);
    // (its third try failed: the fourth is 6 seconds later, time enough to end it first)
    await waitFor(() => owed(F, c.id).some(r => r.task === c.task.id && r.told === false && r.tgTries === 3), { timeout: 120000 * SLOW, every: 100, what: 'three failed tries' });
    process.kill(F.servicePid(), 'SIGKILL');
    await waitFor(() => F.serviceExit(), { timeout: 10000, what: 'the service to end' });
    // (the next try put 20 seconds on, on disk: the start-up's tick must leave it until then, and set it)
    const file = join(F.stateDir, 'chats.json'), all = JSON.parse(readFileSync(file, 'utf8')), next = new Date(Date.now() + 20000).toISOString();
    const r = all.conversations.find(x => x.id === c.id).reports.find(x => x.task === c.task.id);
    assert.deepEqual([r.told, r.tgTries], [false, 3], 'set-up: owed after three tries');
    r.tgNext = next;
    writeFileSync(file, JSON.stringify(all), { mode: 0o600 });
    await mode(F, {});
    a8Child = spawn(process.execPath, [SERVICE_FILE], { cwd: REPO, env: F.env, stdio: 'ignore' });
    await waitFor(async () => (await call(F, '/health').catch(() => null))?.status === 200, { timeout: 30000 * SLOW, what: 'the service back' });
    await waitFor(async () => (await call(F, '/telegram')).json?.state === 'ok', { what: 'Telegram polling again' });
    const d = await waitFor(() => delivered(F, w)[0], { timeout: 90000 * SLOW, what: 'the report delivered after the restart' });
    assert.ok(Date.parse(d.at) >= Date.parse(next), `sent at its next try (${next}), not before: ${d.at}`);
    await owedGone(F, c);
    await sleep(4000);
    assert.equal(delivered(F, w).length, 1, 'Telegram took it once');
    assert.equal(reportSends(F, w), 7, 'three failed tries of two calls each, then the one that went');
    assert.deepEqual(dropped(F, c.task.id), []);
  } finally { await mode(F, {}); }
});

// C4: a report owed to one pairing goes to that chat only. Someone else pairs before its next try (the owner connected
// the bot again): it is dropped, said in the journal, and nothing of it reaches the chat paired since. (Last here: the
// fleet's chat is paired with someone else after it.)
test('C4: a report owed to one pairing, when someone else pairs before its next try, is dropped and said in the journal, never sent to the new chat', { timeout: 400000 * SLOW }, async () => {
  const F = await a8Fleet();
  const w = 'read the workflows for the private report of the owner, then tell me which one stops a model';
  try {
    const c = await a8Task(F, w);
    // (each try waits on Telegram and fails: time enough to pair again before the tries run out)
    await mode(F, { hold: 2000, slowDown: 100000 });
    assert.equal((await stop(F, c)).status, 200);
    await waitFor(() => owed(F, c.id).some(r => r.task === c.task.id && r.told === false && r.tgTries >= 1), { timeout: 120000 * SLOW, what: 'the report owed after its first try' });
    const put = await confirmed(F, 'PUT', '/telegram', { token: TG_TOKEN });
    assert.equal(put.status, 200, put.text);
    await tgSay(F, `/start ${new URL(put.json.code.link).searchParams.get('start')}`, OTHER_TG);
    await waitFor(async () => (await call(F, '/telegram')).json?.paired === true, { timeout: 60000 * SLOW, what: 'the new pairing' });
    await mode(F, {});
    const d = await waitFor(() => dropped(F, c.task.id)[0], { timeout: 120000 * SLOW, what: 'the report dropped in the journal' });
    assert.deepEqual([d.what, d.err, d.outcome], ['report', 'another pairing', 'dropped']);
    await owedGone(F, c);
    await sleep(3000);
    assert.deepEqual(reportCalls(F, w, OTHER_TG), [], 'nothing of it sent to the chat paired since');
    assert.deepEqual(delivered(F, w), [], 'nor anywhere');
  } finally { await mode(F, {}); }
});

// The tell part's own functions, read alone from 20-tell.mjs (the parts are joined into server.mjs).
const TELL_SRC = () => readFileSync(join(REPO, 'service', 'src', '20-tell.mjs'), 'utf8');
const fnOf = (src, name) => new RegExp(`^(?:async )?function ${name}\\(.*\\) \\{\\n[\\s\\S]*?\\n\\}$`, 'm').exec(src)?.[0];

// C7: a result counts toward the hour's results (6; 1 here) only when it went: a try that failed uses none.
test('C7: a result counts toward the hour’s results only when it went: a try that failed uses none of them', async () => {
  const src = TELL_SRC(), never = /^const TELL_NEVER = [^\n]*$/m.exec(src)?.[0], sent = [], audits = [], answers = [];
  assert.ok(never && fnOf(src, 'tellTry'), 'TELL_NEVER and tellTry are in 20-tell.mjs');
  const tellTry = new Function('TELL_WHY', 'tgPaired', 'tellParts', 'tellClean', 'tellBlock', 'tgSend', 'audit', 'TELL_LIMITS', 'tellSends', 'tellResults', 'TELL_QUIET_MS',
    `let tellOwnerAt = 0;\n${never}\n${fnOf(src, 'tellTry')}\nreturn tellTry;`)(new Set(['result']), () => ({ token: 't', chatId: 1 }), t => [t], t => t, () => [],
    async (b, text) => { sent.push(text); return answers.shift(); }, a => audits.push(a.action), { in: 20, out: 20, results: 1 }, [], [], 1800000);
  answers.push('slow-down');
  assert.equal(await tellTry('result', 'first'), 'later');
  answers.push(true);
  assert.equal(await tellTry('result', 'second'), 'sent', 'the failed try used none of the hour’s one result');
  assert.equal(await tellTry('result', 'third'), 'later', 'the one that went used it');
  assert.deepEqual(sent, ['first', 'second']);
  assert.deepEqual(audits, ['telegram-send', 'telegram-send', 'telegram-held']);
});

// C4: a result tried again in memory (an operation's line, a press's late result) goes only to the pairing it was meant
// for: paired with another since, its next try is not made, and it is dropped, said in the journal.
test('C4: a result tried again goes only to the pairing it was meant for: paired with another since, it is dropped and said', async () => {
  let mark = 'first';
  const tries = [], drops = [];
  const tellAgain = new Function('tellTry', 'tgPairingMark', 'tellDropped', 'TELL_TRIES', 'tellWait', `${fnOf(TELL_SRC(), 'tellAgain')}\nreturn tellAgain;`)(
    async () => { tries.push(mark); return 'later'; }, () => mark, (what, f) => drops.push({ what, ...f }), 4, () => 100);
  assert.equal(await tellAgain('result', 'x', {}, 'press', { chat: 'sc_1' }), 'later');
  mark = 'second';
  await waitFor(() => drops.length, { timeout: 5000, what: 'the dropped line' });
  await sleep(300);
  assert.deepEqual(tries, ['first'], 'never tried in the chat paired since');
  assert.deepEqual(drops, [{ what: 'press', chat: 'sc_1', tries: 1, err: 'another pairing' }]);
});
