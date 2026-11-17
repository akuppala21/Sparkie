// Covers: Approving from Telegram (A10a, R32): the switch (off for a chat paired before it existed; on needs the owner,
// the page and the passkey; off needs none; a new pairing turns it on); an owner-only ask from the owner's page chat or
// Telegram chat sent once to the paired chat with the exact change and the page's own buttons, a press on either
// running it once, a Telegram yes echoed on the page; with the switch off nothing sent and a press there refused while
// the page still answers; `/lock` read late or after a full minute; silence for strangers, groups, bots and edited messages; nothing asked or run for an agent's
// conversation cannot approve itself, but the actual owner can; typed "ok" answers no owner-only ask;
// approval counts never limit owner powers; long changes arrive whole with the final buttons;
// an ask void after a new pairing and after a restart.
//
// The owner's yes from the paired Telegram chat (owner decisions 20 and 22; contract 8.7, 8.17; 20-tg-approve.mjs). The
// owner-only ask used here is a stop of a model that answers Sparkie's agents (routed there first): stop_model asks the
// owner whoever asks, from the page chat and from Telegram alike. The service talks to the stand-in Bot API
// (test/mock/telegram.mjs).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { T, MEMBER, useFleet, api, sleep, waitFor, auditLines, chatMessages, choose, newChat, say, call, createActKey, ASK, SLOW } from './lib.mjs';
import { serviceConfig, startMock } from './start-mock.mjs';
import { Authenticator, passkeyHeader } from './authenticator.mjs';

const MAIN_ORIGIN = serviceConfig().origin, TAILNET = new URL(MAIN_ORIGIN).hostname.split('.').slice(1).join('.');
const KEY = new Authenticator(TAILNET, MAIN_ORIGIN);
const TOKEN = '123456789:AAEtestTokenForSparkConsoleXYZ_abcdefghij', OWNER_TG = 5550001, STRANGER_TG = 5550002;
const TESTORG = 'sc-testorg--Qwen3.8-27B-abliterated-GGUF';
const ASK_TEXT = `${TESTORG} answers Sparkie’s chats or apps. Stop it anyway?\n\nYes, stop ${TESTORG}`;
const EXPIRED = 'That button has expired. Ask again.';
// Paired as before this step: no approvals switch in the file.
const pairing = (extra = {}) => ({ telegram: { token: TOKEN, bot: 'spark_test_bot', chatId: OWNER_TG, userId: OWNER_TG, name: 'Owner', pairedAt: '2026-11-10T00:00:00.000Z', ...extra } });
function seed({ dir, stateDir }, secrets, files = {}) {
  mkdirSync(join(dir, 'secrets'), { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, 'secrets', 'secrets.json'), JSON.stringify(secrets), { mode: 0o600 });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(stateDir, name), text, { mode: 0o600 });
}
const FLEET = { telegram: true, knowledge: true, watchMs: 60000, env: { SPARK_CONSOLE_TELEGRAM_LIMITS: '1000,1000,1000' } };
// (an agent key that may act, made before the owner sets up a passkey: after it, a new key needs one)
let actKey;
useFleet({ ...FLEET, prepare: ctx => seed(ctx, pairing()) }, async () => { actKey = await createActKey('tg-approve'); });

// (F: a fleet a test started itself; T and every helper follow it while withFleet runs)
let F = null;
const fleet = () => F || T.fleet;
async function withFleet(f, fn) {
  const was = { fleet: T.fleet, base: T.base, origin: T.origin, mcp: T.mcp };
  Object.assign(T, { fleet: f, base: f.base, origin: f.origin, mcp: f.mcp });
  F = f;
  try { return await fn(); } finally { Object.assign(T, was); F = null; }
}
const is = (r, status, what = '') => assert.equal(r.status, status, `${what} → ${r.status} ${r.text}`);
async function confirmed(method, path, body) {
  const b = await api('/auth/passkey/begin', { method: 'POST', body: { purpose: 'confirm', method, path, body } });
  is(b, 200, `begin confirm ${method} ${path}`);
  return api(path, { method, body, headers: { 'x-spark-passkey': passkeyHeader(KEY.sign(b.json)) } });
}
const tgUrl = p => `http://127.0.0.1:${fleet().telegramPort}${p}`;
const tgPost = async (p, body) => (await fetch(tgUrl(p), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const tgCalls = () => { const f = join(fleet().dir, 'telegram-calls.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []; };
const tgSent = (from = 0) => tgCalls().slice(from).filter(c => c.method === 'sendMessage');
let msgId = 1;
const tgMessage = (text, { from = OWNER_TG, chat = from, chatType = 'private' } = {}) => ({ message_id: msgId++, date: Math.floor(Date.now() / 1000), chat: { id: chat, type: chatType },
  from: { id: from, is_bot: false, first_name: 'Owner' }, text });
const tgSay = (text, opts) => tgPost('/__push', { message: tgMessage(text, opts) });
const tgPress = (data, { from = OWNER_TG, chat = from, chatType = 'private', isBot = false } = {}) => tgPost('/__push', { callback_query: { id: String(msgId++),
  from: { id: from, is_bot: isBot, first_name: 'Owner' }, data, message: { message_id: msgId++, chat: { id: chat, type: chatType }, date: Math.floor(Date.now() / 1000) } } });
const sentAfter = (from, n = 1, what = 'a Telegram message') => waitFor(() => { const s = tgSent(from); return s.length >= n ? s : null; }, { timeout: 60000, every: 200, what });
// The line a press was answered with (the first send after it that isn't a result).
const answerAfter = async (from, what = 'the answer to the press') => (await waitFor(() => tgSent(from).find(s => !/^Done: /.test(s.body.text)), { timeout: 60000, every: 200, what })).body.text;
const view = async () => (await api('/telegram')).json;
const secrets = () => JSON.parse(readFileSync(fleet().secretsFile, 'utf8'));
const approvalsKept = () => JSON.parse(readFileSync(join(fleet().stateDir, 'telegram.json'), 'utf8')).approvals || [];
const mock = (spark, file) => join(fleet().root, spark, '.mock', file);
const stateOf = (spark, name) => readFileSync(mock(spark, 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];
function setState(spark, name, state, status) {
  const f = mock(spark, 'containers');
  writeFileSync(f, readFileSync(f, 'utf8').replace(new RegExp(`^${name.replace(/[.]/g, '\\.')}\\|[^|]*\\|[^|]*\\|`, 'm'), `${name}|${state}|${status}|`));
}
const stopsRun = () => auditLines().filter(l => l.action === 'stop_model' && l.ok && l.outcome === 'started');
const script = rules => writeFileSync(join(fleet().dir, 'model-script.json'), JSON.stringify(rules));
const noScript = () => rmSync(join(fleet().dir, 'model-script.json'), { force: true });
// TESTORG answers Sparkie's agents, so stopping it is the owner's call whoever asks.
async function routeAgents() {
  const r = await api('/main/route', { method: 'POST', body: { role: 'agents', choice: `deploy:spark3:${TESTORG}` } });
  is(r, 200, 'route agents to TESTORG');
}
// Every operation done, and TESTORG running again for the next ask.
async function settle() {
  await waitFor(async () => !(await api('/jobs')).json.jobs.some(j => j.status === 'running'), { timeout: 60000, what: 'operations done' });
  setState('spark3', TESTORG, 'running', 'Up 1 second');
}
// The owner asks on the page: Sparkie's stop comes back as the owner-only question.
async function askOnPage() {
  const chat = await newChat();
  const r = await say(chat, `stop ${TESTORG} on spark 3`);
  const choices = r.message.choices || [];
  assert.equal(choices.length, 2, JSON.stringify(r.message));
  const yes = choices.find(c => c.label === `Yes, stop ${TESTORG}`), no = choices.find(c => c.label === 'No, leave it running');
  assert.ok(yes && no, JSON.stringify(choices));
  return { chat, yes, no };
}
const askSentFor = (from, yes) => waitFor(() => tgSent(from).find(s => s.body.reply_markup?.inline_keyboard?.some(row => row.some(b => b.callback_data === yes.id))), { timeout: 30000, every: 200, what: 'the ask in Telegram' });
const pagePress = (chat, choice) => confirmed('POST', `/chats/${chat}/choose`, { choice });

// T128: a risky ask with Telegram paired runs once from a press in the paired chat or on the page; a typed "ok" answers
// nothing; counts never block later approvals; /lock revokes old asks and unlock needs fresh confirmation; an ask left open
// across a restart runs nothing (the last describe).
describe('approving from Telegram', { concurrency: 1 }, () => {
  test('the switch: off for a chat paired before it existed; on needs the owner, the page and the passkey; off needs none', { timeout: 60000 * SLOW }, async () => {
    await waitFor(async () => (await view()).state === 'ok', { what: 'Telegram polling' });
    const b = await api('/auth/passkey/begin', { method: 'POST', body: { purpose: 'register' } });
    is(await api('/auth/passkey/register', { method: 'POST', body: KEY.register(b.json) }), 201, 'the owner sets up a passkey');
    assert.equal((await view()).approve, false);
    const said = async () => (await api('/actions/sparkie_setup', { method: 'POST', body: {} })).json.telegram.approvals;
    assert.match(await said(), /^Approvals from Telegram: off\. /, 'sparkie_setup says so in one line');
    const on = { on: true };
    is(await api('/telegram/approve', { method: 'PUT', body: on, headers: { 'tailscale-funnel-request': '?1' } }), 401, 'from the internet, not signed in');
    is(await api('/telegram/approve', { method: 'PUT', body: on, headers: { 'x-spark-console': null } }), 403, 'cross-site');
    is(await api('/telegram/approve', { method: 'PUT', body: on }), 428, 'without the passkey');
    is(await api('/telegram/approve', { method: 'PUT', body: { on: 'yes' } }), 400);
    assert.equal(secrets().telegram.approve, undefined, 'nothing stored');
    const r = await confirmed('PUT', '/telegram/approve', on);
    is(r, 200, 'with the passkey');
    assert.equal(r.json.approve, true);
    assert.equal(secrets().telegram.approve, true, 'kept beside the pairing, in the secrets file');
    assert.match(await said(), /^Approvals from Telegram: on\. Your paired chat has the same owner controls as the page/);
    const off = await api('/telegram/approve', { method: 'PUT', body: { on: false } });
    is(off, 200, 'off needs no passkey');
    assert.deepEqual([off.json.approve, secrets().telegram.approve], [false, false]);
    is(await confirmed('PUT', '/telegram/approve', on), 200);
    assert.deepEqual(auditLines().filter(l => l.action === 'telegram-approve').map(l => l.args.on), [true, false, true]);
  });

  test('an owner-only ask from the page chat: one ask in the paired chat with the exact change and the page\'s buttons; a press there runs it once, counted and echoed on the page', { timeout: 120000 * SLOW }, async () => {
    await routeAgents();
    const from = tgCalls().length, ran = stopsRun().length;
    const { chat, yes, no } = await askOnPage();
    const ask = await askSentFor(from, yes);
    assert.equal(ask.body.text, ASK_TEXT, 'the whole change, built by code');
    assert.deepEqual(ask.body.reply_markup.inline_keyboard.map(row => row.map(x => x.callback_data)), [[yes.id], [no.id]], 'the page\'s own buttons');
    await sleep(1000);
    assert.equal(tgSent(from).length, 1, 'one ask');
    assert.equal(stateOf('spark3', TESTORG), 'running', 'asking stops nothing');
    const pressAt = tgCalls().length;
    await tgPress(yes.id);
    assert.equal(await answerAfter(pressAt), 'Under way. I’ll tell you here when it’s done.');
    await waitFor(() => stateOf('spark3', TESTORG) === 'exited', { what: 'the stop' });
    const line = stopsRun().at(-1);
    assert.equal(stopsRun().length, ran + 1);
    assert.deepEqual([line.via, line.actor, line.channel, line.args.confirmRouted], ['telegram', 'owner on Telegram', 'telegram', true]);
    // Echoed on the page: the chat that asked says so, and a notice.
    const msgs = await chatMessages(chat);
    assert.equal(msgs.flatMap(m => m.choices || []).find(c => c.id === yes.id).state, 'picked');
    assert.match(msgs.findLast(m => m.notice && !m.operation).content, new RegExp(`^Approved from Telegram: Yes, stop ${TESTORG.replace(/[.]/g, '\\.')}: under way\\.`));
    const notices = (await api('/jobs')).json.notices.map(n => n.text);
    assert.ok(notices.some(t => t.startsWith(`Approved from Telegram: “Yes, stop ${TESTORG}”.`)), notices.join(' | '));
    assert.ok(auditLines().some(l => l.action === 'telegram-approved' && l.args.chat === chat && l.ok));
    assert.equal(approvalsKept().length, 1, 'counted, in telegram.json');
    // Once: a second press, here or on the page, runs nothing.
    const again = tgCalls().length;
    await tgPress(yes.id);
    assert.equal(await answerAfter(again), 'That button has expired. Ask again.');
    is(await pagePress(chat, yes.id), 409, 'the page\'s press after it');
    await settle();
    assert.equal(stopsRun().length, ran + 1, 'it ran once');
  });

  test('pressed on the page first, the same ask pressed in Telegram runs nothing', { timeout: 120000 * SLOW }, async () => {
    const from = tgCalls().length, ran = stopsRun().length;
    const { chat, yes } = await askOnPage();
    await askSentFor(from, yes);
    is(await choose(chat, yes.id), 428, 'on the page it still needs the passkey');
    is(await pagePress(chat, yes.id), 200, 'the page\'s press');
    const pressAt = tgCalls().length;
    await tgPress(yes.id);
    assert.equal(await answerAfter(pressAt), 'That button has expired. Ask again.');
    await settle();
    assert.equal(stopsRun().length, ran + 1, 'it ran once');
    assert.equal(stopsRun().at(-1).via, 'page');
    assert.equal(approvalsKept().length, 1, 'a page press isn\'t counted');
  });

  // Review of A10a: /lock was read after the five-minute rule and the minute's limit, so a late or flooded one was dropped.
  test('a /lock read seven minutes after it was sent still locks, and the press after it stops nothing', { timeout: 120000 * SLOW }, async () => {
    let from = tgCalls().length;
    const ran = stopsRun().length;
    const { yes } = await askOnPage();
    await askSentFor(from, yes);
    from = tgCalls().length;
    await tgPost('/__push', { message: { ...tgMessage('/lock'), date: Math.floor(Date.now() / 1000) - 7 * 60 } });
    assert.match(await answerAfter(from), /^Locked: nothing is approved from here now\./, 'the owner is told it is locked');
    assert.deepEqual([(await view()).approve, secrets().telegram.approve], [false, false]);
    from = tgCalls().length;
    await tgPress(yes.id);
    assert.equal(await answerAfter(from), EXPIRED);
    await sleep(1000);
    assert.equal(stateOf('spark3', TESTORG), 'running');
    assert.equal(stopsRun().length, ran);
    assert.equal(approvalsKept().length, 1);
    from = tgCalls().length;
    await tgSay('/status');
    assert.match(await answerAfter(from), /\nApprovals from Telegram: off\. Turn them on again in your owner controls\./, '/status there says so');
    is(await confirmed('PUT', '/telegram/approve', { on: true }), 200);
  });

  test('with the switch off: nothing is sent, a press in Telegram gets the old answer, and the page still answers; an ask sent before stays void there', { timeout: 180000 * SLOW }, async () => {
    is(await api('/telegram/approve', { method: 'PUT', body: { on: false } }), 200);
    let from = tgCalls().length;
    const ran = stopsRun().length;
    const first = await askOnPage();
    await sleep(2000 * SLOW);
    assert.equal(tgSent(from).length, 0, 'no ask while the switch is off');
    from = tgCalls().length;
    await tgPress(first.yes.id);
    assert.equal(await answerAfter(from), EXPIRED);
    assert.equal(stateOf('spark3', TESTORG), 'running');
    is(await pagePress(first.chat, first.yes.id), 200, 'the page still works');
    await settle();
    // Sent while on, then the switch off and on again: that ask's Telegram side stays void.
    is(await confirmed('PUT', '/telegram/approve', { on: true }), 200);
    from = tgCalls().length;
    const second = await askOnPage();
    await askSentFor(from, second.yes);
    is(await api('/telegram/approve', { method: 'PUT', body: { on: false } }), 200);
    from = tgCalls().length;
    await tgPress(second.yes.id);
    assert.equal(await answerAfter(from), EXPIRED);
    is(await confirmed('PUT', '/telegram/approve', { on: true }), 200);
    from = tgCalls().length;
    await tgPress(second.yes.id);
    assert.equal(await answerAfter(from), EXPIRED, 'an older ask gets nothing');
    assert.equal(stateOf('spark3', TESTORG), 'running');
    is(await pagePress(second.chat, second.yes.id), 200);
    await settle();
    assert.equal(stopsRun().length, ran + 2);
    assert.ok(stopsRun().slice(-2).every(l => l.via === 'page'));
    assert.equal(approvalsKept().length, 1);
  });

  test('from the Telegram chat: the ask, then Sparkie\'s words with no second button; a typed "ok" answers nothing; the press runs it', { timeout: 120000 * SLOW }, async () => {
    const from = tgCalls().length, ran = stopsRun().length;
    await tgSay(`stop ${TESTORG} on spark 3`);
    const sent = await sentAfter(from, 2, 'the ask and the reply');
    await sleep(1000);
    assert.equal(tgSent(from).length, 2);
    const [ask] = sent.filter(s => s.body.reply_markup), reply = sent.find(s => !s.body.reply_markup);
    assert.equal(sent.filter(s => s.body.reply_markup).length, 1, 'one message with buttons');
    assert.equal(ask.body.text, ASK_TEXT);
    assert.match(reply.body.text, /stop_model said/);
    assert.doesNotMatch(reply.body.text, /waits for you in Spark Console/);
    const yes = ask.body.reply_markup.inline_keyboard[0][0].callback_data;
    // A typed yes never answers it: it goes to Sparkie, and nothing stops.
    const okAt = tgCalls().length;
    await tgSay('ok');
    assert.match((await sentAfter(okAt))[0].body.text, /You asked: \*\*ok\*\*/);
    assert.equal(stateOf('spark3', TESTORG), 'running');
    assert.equal(stopsRun().length, ran);
    const pressAt = tgCalls().length;
    await tgPress(yes);
    assert.equal(await answerAfter(pressAt), 'Under way. I’ll tell you here when it’s done.');
    await waitFor(() => stateOf('spark3', TESTORG) === 'exited', { what: 'the stop' });
    assert.equal(stopsRun().length, ran + 1);
    assert.equal(approvalsKept().length, 2);
    await settle();
  });

  test('another chat gets silence: a stranger, the owner in a group, a bot and an edited message run nothing; the owner\'s press does', { timeout: 120000 * SLOW }, async () => {
    let from = tgCalls().length;
    const ran = stopsRun().length;
    const { yes } = await askOnPage();
    await askSentFor(from, yes);
    from = tgCalls().length;
    await tgPress(yes.id, { from: STRANGER_TG });
    await tgPress(yes.id, { chat: -100123, chatType: 'group' });
    await tgPress(yes.id, { from: 5550099, isBot: true });
    await tgPost('/__push', { edited_message: tgMessage('yes') });
    await sleep(2500 * SLOW);
    assert.equal(tgSent(from).length, 0, 'nobody was answered');
    assert.equal(stateOf('spark3', TESTORG), 'running');
    assert.equal(stopsRun().length, ran);
    await tgPress(yes.id);
    assert.equal(await answerAfter(from), 'Under way. I’ll tell you here when it’s done.');
    await waitFor(() => stateOf('spark3', TESTORG) === 'exited', { what: 'the stop' });
    assert.equal(approvalsKept().length, 3);
    await settle();
  });

  test('an agent\'s conversation asks the actual paired owner; the agent cannot approve and the owner can run it once', { timeout: 120000 * SLOW }, async () => {
    const k = actKey, ran = stopsRun().length;
    let from = tgCalls().length;
    const r = await call(k.token, ASK, { message: `stop ${TESTORG} on spark 3` });
    assert.equal(r.isError, false, r.text);
    const yes = (r.value.choices || []).find(c => c.label === `Yes, stop ${TESTORG}`);
    assert.ok(yes, JSON.stringify(r.value));
    const ask = await askSentFor(from, yes);
    assert.ok(ask.body.text.startsWith(`Agent “${k.name}” asked. Only your confirmation runs it.\n\n`), 'the saved agent name is shown exactly');
    assert.ok(ask.body.text.endsWith(ASK_TEXT));
    assert.equal(stateOf('spark3', TESTORG), 'running', 'an agent request alone stops nothing');
    const taken = await call(k.token, ASK, { conversation: r.value.conversation, choice: yes.id });
    assert.match(taken.raw, /Only the owner can answer this one/);
    from = tgCalls().length;
    await tgPress(yes.id);
    assert.equal(await answerAfter(from), 'Under way. I’ll tell you here when it’s done.');
    await waitFor(() => stateOf('spark3', TESTORG) === 'exited', { what: 'the stop only the owner approved' });
    assert.equal(stopsRun().length, ran + 1);
    assert.equal(approvalsKept().length, 4);
    from = tgCalls().length; await tgPress(yes.id);
    assert.equal(await answerAfter(from), EXPIRED);
    assert.equal(stopsRun().length, ran + 1, 'one owner approval, no replay');
    await settle();
  });

  test('a later approval in the same hour has the same powers, exact result and one-use protection', { timeout: 120000 * SLOW }, async () => {
    let from = tgCalls().length;
    const ran = stopsRun().length, before = approvalsKept().length;
    const { chat, yes } = await askOnPage();
    await askSentFor(from, yes);
    from = tgCalls().length; await tgPress(yes.id);
    assert.equal(await answerAfter(from), 'Under way. I’ll tell you here when it’s done.');
    await waitFor(() => stateOf('spark3', TESTORG) === 'exited', { what: 'the later owner stop' });
    assert.equal(approvalsKept().length, before + 1);
    assert.ok(!auditLines().some(l => l.action === 'telegram-approval-held' && l.args.chat === chat));
    is(await pagePress(chat, yes.id), 409, 'the page cannot replay the Telegram approval');
    await settle();
    assert.equal(stopsRun().length, ran + 1); assert.equal(stopsRun().at(-1).via, 'telegram');
  });

  test('/lock revokes old asks; the page route still needs a passkey and the paired owner unlocks with a fresh exact confirmation', { timeout: 120000 * SLOW }, async () => {
    let from = tgCalls().length;
    const { chat, yes } = await askOnPage();
    await askSentFor(from, yes);
    from = tgCalls().length;
    await tgSay('/lock');
    assert.match(await answerAfter(from), /^Locked: nothing is approved from here now\./);
    assert.deepEqual([(await view()).approve, secrets().telegram.approve], [false, false]);
    assert.ok((await api('/jobs')).json.notices.some(n => /turned off from Telegram \(\/lock\)/.test(n.text)));
    assert.ok(auditLines().some(l => l.action === 'telegram-approve' && l.via === 'telegram' && l.args.word === '/lock'));
    from = tgCalls().length;
    await tgPress(yes.id);
    assert.equal(await answerAfter(from), EXPIRED);
    is(await api('/telegram/approve', { method: 'PUT', body: { on: true } }), 428, 'on again needs the passkey');
    assert.equal((await view()).approve, false);
    const unlockAt = tgCalls().length; await tgSay('/admin approvals on');
    const unlock = await waitFor(() => tgSent(unlockAt).find(x => /then type \d{2}\./.test(x.body.text) && x.body.reply_markup), { what: 'the fresh unlock confirmation' });
    const unlockId = unlock.body.reply_markup.inline_keyboard[0][0].callback_data, digits = /then type (\d{2})\./.exec(unlock.body.text)[1];
    assert.equal((await view()).approve, false, 'asking never unlocks');
    from = tgCalls().length; await tgPress(unlockId);
    assert.match(await answerAfter(from), /Type the two digits/);
    assert.equal((await view()).approve, false, 'press alone never unlocks');
    from = tgCalls().length; await tgSay('00'); await answerAfter(from);
    assert.equal((await view()).approve, false, 'wrong digits never unlock');
    await tgSay(digits);
    await waitFor(async () => (await view()).approve === true, { what: 'unlock after the exact digits' });
    from = tgCalls().length; await tgPress(unlockId);
    assert.match(await answerAfter(from), /no longer open|expired|answered/);
    from = tgCalls().length;
    await tgPress(yes.id);
    assert.equal(await answerAfter(from), EXPIRED, 'the ask sent before /lock stays void there');
    assert.equal(stateOf('spark3', TESTORG), 'running');
    is(await pagePress(chat, yes.id), 200, 'the page answers it');
    await settle();
  });

  test('a change over 3,500 characters arrives whole before its exact buttons and runs once for the paired owner', { timeout: 120000 * SLOW }, async () => {
    // The owner asks a question; the brain proposes a complete long change. Its delivery alone must never start it.
    const env = Array.from({ length: 12 }, (_, i) => `OPTION_${String(i).padStart(2, '0')}_${'N'.repeat(38)}=${'v'.repeat(230)}`);
    const volumes = Array.from({ length: 4 }, (_, i) => `longdata${i}:/srv/${String.fromCharCode(97 + i).repeat(180)}`);
    const words = 'what would it take to keep longapp on spark 4 running from nginx:1.27?';
    script([{ match: '^what would it take to keep longapp on spark 4 running', calls: [{ name: 'keep_running', arguments: { spark: 'spark4', container: 'longapp', image: 'nginx:1.27', port: '9137:80', volumes, env } }] }]);
    try {
      const from = tgCalls().length;
      await tgSay(words);
      const chat = await waitFor(async () => (await api('/chats')).json.chats.find(c => c.channel === 'telegram'), { what: 'the Telegram conversation' });
      const reply = await waitFor(async () => (await chatMessages(chat.id)).findLast(m => m.role === 'assistant' && m.tools?.some(t => t.name === 'keep_running')), { what: 'the completed long proposal' });
      const c = reply.choices?.find(x => x.label.startsWith('Start longapp'));
      assert.ok(c, JSON.stringify(reply));
      assert.ok(c.label.length > 4000, String(c.label.length));
      const ask = await askSentFor(from, c);
      const parts = tgSent(from), last = parts.findIndex(x => x.body.reply_markup?.inline_keyboard?.flat().some(b => b.callback_data === c.id)), whole = parts.slice(0, last + 1);
      assert.ok(ask && last >= 0);
      assert.ok(whole.map(x => x.body.text).join('').includes(c.label), `the full code-built choice is delivered: ${JSON.stringify(whole.map(x => x.body.text))}`);
      assert.ok(whole.length > 1, 'the complete long change uses multiple parts');
      assert.ok(whole.slice(0, -1).every(x => !x.body.reply_markup), 'no buttons before the final part');
      assert.ok(whole.map(x => x.body.text).join('').includes(c.label), 'all characters of the exact choice reach the owner');
      assert.equal(stateOf('spark4', 'longapp'), undefined, 'delivery starts nothing');
      const pressAt = tgCalls().length; await tgPress(c.id);
      assert.equal(await answerAfter(pressAt), 'Under way. I’ll tell you here when it’s done.');
      await waitFor(() => stateOf('spark4', 'longapp') === 'running', { what: 'the exact approved long app' });
      const again = tgCalls().length; await tgPress(c.id);
      assert.equal(await answerAfter(again), EXPIRED);
      assert.equal(auditLines().filter(x => x.action === 'keep_running' && x.outcome === 'started').length, 1, 'the long choice runs once');
    } finally { noScript(); }
  });

  test('an ask is void after Telegram is paired again, on the page too; a new pairing turns approvals on', { timeout: 120000 * SLOW }, async () => {
    let from = tgCalls().length;
    const ran = stopsRun().length;
    const { chat, yes } = await askOnPage();
    await askSentFor(from, yes);
    is(await api('/telegram', { method: 'DELETE' }), 200);
    const r = await confirmed('PUT', '/telegram', { token: TOKEN });
    is(r, 200);
    assert.equal(r.json.approve, false, 'a new token: not paired, nothing approved');
    from = tgCalls().length;
    await tgSay(`/start ${new URL(r.json.code.link).searchParams.get('start')}`);
    assert.match((await sentAfter(from))[0].body.text, /^Paired with Spark Console\..*\/lock stops approvals from here/);
    assert.equal((await view()).approve, true, 'on once paired');
    assert.equal(secrets().telegram.approve, true);
    from = tgCalls().length;
    await tgPress(yes.id);
    assert.equal(await answerAfter(from), 'That button has expired. Ask again.');
    is(await pagePress(chat, yes.id), 409, 'void on the page too');
    assert.equal((await chatMessages(chat)).flatMap(m => m.choices || []).find(c => c.id === yes.id).state, 'gone');
    await sleep(1000);
    assert.equal(stateOf('spark3', TESTORG), 'running');
    assert.equal(stopsRun().length, ran);
  });
});

describe('with the real limits', { concurrency: 1 }, () => {
  test('a /lock after 20 messages in a minute still locks, and the press after it stops nothing', { timeout: 300000 * SLOW }, async () => {
    const f = await startMock({ telegram: true, knowledge: true, watchMs: 60000, prepare: ctx => seed(ctx, pairing({ approve: true })) });
    try {
      await withFleet(f, async () => {
        await waitFor(async () => (await view()).state === 'ok', { what: 'Telegram polling' });
        await routeAgents();
        let from = tgCalls().length;
        const { yes } = await askOnPage();
        await askSentFor(from, yes);
        // The minute filled: one turn that takes a while, then 19 more messages; then the owner's /lock.
        from = tgCalls().length;
        const t0 = Date.now();
        await tgSay('take 3 seconds please');
        for (let i = 0; i < 19; i++) await tgSay(`flood ${i}`);
        await tgSay('/lock');
        const locked = await waitFor(() => tgSent(from).find(s => /^Locked: nothing is approved from here now\./.test(s.body.text)), { timeout: 30000, every: 200, what: 'the owner told it is locked' });
        assert.ok(locked);
        assert.deepEqual([(await view()).approve, secrets().telegram.approve], [false, false]);
        // (pressed once the minute has freed, so the limit can't be what stops it)
        await sleep(Math.max(0, t0 + 62000 - Date.now()));
        from = tgCalls().length;
        await tgPress(yes.id);
        assert.equal(await answerAfter(from), EXPIRED);
        await sleep(1000);
        assert.equal(stateOf('spark3', TESTORG), 'running');
        assert.equal(stopsRun().length, 0);
      });
    } finally { await f.stop(); }
  });
});

describe('across a restart', { concurrency: 1 }, () => {
  test('ten earlier approvals never cap owner powers, before or after restart; an open pre-restart ask cannot run', { timeout: 300000 * SLOW }, async () => {
    // Ten approvals between 2 and 11 hours ago: none in the last hour.
    const approvals = Array.from({ length: 10 }, (_, i) => Date.now() - (2 + i) * 3600000);
    const one = await startMock({ ...FLEET, prepare: ctx => seed(ctx, pairing({ approve: true }), { 'telegram.json': JSON.stringify({ offset: 0, approvals }) }) });
    let kept, old;
    try {
      old = await withFleet(one, async () => {
        await waitFor(async () => (await view()).state === 'ok', { what: 'Telegram polling' });
        await routeAgents();
        let from = tgCalls().length;
        const asked = await askOnPage();
        await askSentFor(from, asked.yes);
        from = tgCalls().length;
        await tgPress(asked.yes.id);
        assert.equal(await answerAfter(from), 'Under way. I’ll tell you here when it’s done.');
        await waitFor(() => stateOf('spark3', TESTORG) === 'exited', { what: 'the eleventh owner approval' });
        assert.equal(approvalsKept().length, 11);
        await settle();
        from = tgCalls().length; const open = await askOnPage(); await askSentFor(from, open.yes);
        return open;
      });
      kept = { chats: readFileSync(join(one.stateDir, 'chats.json'), 'utf8'), telegram: JSON.stringify({ ...JSON.parse(readFileSync(join(one.stateDir, 'telegram.json'), 'utf8')), offset: 0 }) };
    } finally { await one.stop(); }
    const two = await startMock({ ...FLEET, prepare: ctx => seed(ctx, pairing({ approve: true }), { 'chats.json': kept.chats, 'telegram.json': kept.telegram }) });
    try {
      await withFleet(two, async () => {
        await waitFor(async () => (await view()).state === 'ok', { what: 'Telegram polling' });
        let from = tgCalls().length;
        await tgPress(old.yes.id);
        assert.equal(await answerAfter(from), 'That button has expired. Ask again.');
        is(await choose(old.chat, old.yes.id), 409, 'on the page too');
        assert.equal(stopsRun().length, 0);
        await routeAgents();
        from = tgCalls().length;
        const asked = await askOnPage();
        await askSentFor(from, asked.yes);
        from = tgCalls().length;
        await tgPress(asked.yes.id);
        assert.equal(await answerAfter(from), 'Under way. I’ll tell you here when it’s done.');
        await waitFor(() => stateOf('spark3', TESTORG) === 'exited', { what: 'the twelfth owner approval' });
        assert.equal(approvalsKept().length, 12, 'accounting survives restart without denying owner powers');
        is(await choose(asked.chat, asked.yes.id), 409, 'the used Telegram choice cannot replay on the page');
        assert.equal(stopsRun().length, 1);
      });
    } finally { await two.stop(); }
  });
});
