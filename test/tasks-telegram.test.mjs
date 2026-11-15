// Covers: Long tasks (design E 2.1 as cut, step 6; R50), first piece (E6a), on Telegram (R32): a task made from the
// paired chat keeps which pairing it came from (a mark, never the chat's ids). The owner's /stop there takes the task
// off the record on disk at once, though no answer is saved in the chat. A new bot token ends a task from Telegram, as
// Disconnect does; so does a new pairing, made while a task from the pairing before is still on disk (the look after a
// start comes late here). Started again paired with someone else, such a task ends at the look after the start: no
// carry-on turn, and nothing of it is told to the new chat. A carry-on turn here waits ten minutes, so a task stays as
// it is made; the brain's context is 1,000 tokens, so one long lookup ends a reply at the output budget and makes one.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync, cpSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, waitFor, sleep, SLOW } from './lib.mjs';
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
