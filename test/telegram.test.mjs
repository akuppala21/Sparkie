// Covers: Telegram (R32) on the stand-in Bot API: connecting needs the owner, the page and the passkey, a refused token
// stores nothing, and the token lives only in the 0600 secrets file (never in the state folder, log, API or Sparkie's
// tools); strangers, wrong codes, groups and bots get silence and never burn the code; the paired chat talks to Sparkie
// (typing, plain text, previews off, split under 4,096, full incoming text, `/new`, `/status`), changes report once,
// buttons press as `telegram`, one turn at a time; forwarded, photo, old and token-shaped messages aren't read; going
// back a build, saved workflows and memory erasure keep the same owner intent and confirmation rules (memory is kept,
// marked as said on Telegram; "save that as …" pressed there saves the steps but is no yes to their images); pause,
// injection, masking;
// unreachable, 409, a secrets file that can't be read (read again by itself, answered once it's back, no restart),
// brain down (the line names `/restart sparkie`), revoked token, disconnect and `/unpair`; the owner's words there
// (`/help`, `/pause` with no file path, `/restart sparkie`, `/stop` while Sparkie answers) answered by code, and
// `/resume` requiring its dangerous confirmation and `/undo update` handled by code; restart notices and input floods; the
// build in `sparkie_setup`; Telegram's address and sender in one place. Required confirmations remain one-use.
//
// Telegram (docs/architecture.md R32, docs/analysis-2026-11-11/09-telegram-design.md). The owner pairs one private
// Telegram chat with a code only the passkey page shows; after that, text from that chat is a turn in the owner's Sparkie
// chat with the same gates as the page, and everyone else gets silence. tell() is the only sender. The service talks to
// a stand-in Bot API (test/mock/telegram.mjs); the real one is never contacted.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync, rmSync, statSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import net from 'node:net';
import { join } from 'node:path';
import { T, REPO, MEMBER, useFleet, api, sleep, waitFor, auditLines, chatMessages, choose, createKey, call, agentSettings, newChat, say, CORE_TOOLS, SLOW } from './lib.mjs';
import { serviceConfig, startMock, TEST_DIR } from './start-mock.mjs';
import { Authenticator, passkeyHeader } from './authenticator.mjs';

const MAIN_ORIGIN = serviceConfig().origin, TAILNET = new URL(MAIN_ORIGIN).hostname.split('.').slice(1).join('.');
const KEY = new Authenticator(TAILNET, MAIN_ORIGIN);
const TOKEN = '123456789:AAEtestTokenForSparkConsoleXYZ_abcdefghij', REFUSED = '999999999:AAErefusedTokenForSparkConsole_abcdefghij';
const OWNER_TG = 5550001, STRANGER_TG = 5550002;
const RADIX = 'sc-RadixArk--Qwen3.8-27B-NVFP4';
// Where the installer keeps earlier builds: one is there, so "undo the update" has something to offer.
const RELEASES = mkdtempSync(join(tmpdir(), 'sct-tg-releases-'));
mkdirSync(join(RELEASES, '20261110T120000Z'), { recursive: true });
writeFileSync(join(RELEASES, '20261110T120000Z', 'restore.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
process.on('exit', () => rmSync(RELEASES, { recursive: true, force: true }));
let look, pairCode = null;
// (the limits on messages in and out are raised here; the flood tests run on a fleet of their own with the real ones)
// (an app is waited on 3 s to answer, not 3 minutes: the save-with-from test starts one whose port nothing answers)
useFleet({ telegram: true, knowledge: true, watchMs: 60000,
  env: { SPARK_CONSOLE_RELEASES: RELEASES, SPARK_CONSOLE_CONTINUE_MS: '500', SPARK_CONSOLE_TELEGRAM_LIMITS: '1000,1000,1000', SPARK_CONSOLE_APP_ANSWER_MS: '3000' } },
  async () => { look = (await createKey('tg-look')).token; });

const is = (r, status, what = '') => assert.equal(r.status, status, `${what} → ${r.status} ${r.text}`);
async function confirmed(method, path, body) {
  const b = await api('/auth/passkey/begin', { method: 'POST', body: { purpose: 'confirm', method, path, body } });
  is(b, 200, `begin confirm ${method} ${path}`);
  return api(path, { method, body, headers: { 'x-spark-passkey': passkeyHeader(KEY.sign(b.json)) } });
}
// The stand-in Bot API.
// (F: another fleet a test started; the helpers follow it)
let F = null;
const fleet = () => F || T.fleet;
const tgUrl = p => `http://127.0.0.1:${fleet().telegramPort}${p}`;
const tgPost = async (p, body) => (await fetch(tgUrl(p), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const tgMode = mode => tgPost('/__mode', mode);
const tgCalls = () => { const f = join(fleet().dir, 'telegram-calls.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []; };
const tgSent = (from = 0) => tgCalls().slice(from).filter(c => c.method === 'sendMessage');
let msgId = 1;
function tgSay(text, { from = OWNER_TG, chat = from, chatType = 'private', isBot = false, date = Math.floor(Date.now() / 1000), extra = {} } = {}) {
  return tgPost('/__push', { message: { message_id: msgId++, date, chat: { id: chat, type: chatType }, from: { id: from, is_bot: isBot, first_name: from === OWNER_TG ? 'Owner' : 'Someone' },
    ...(text === null ? {} : { text }), ...extra } });
}
const tgPress = (data, { from = OWNER_TG, chat = from } = {}) => tgPost('/__push', { callback_query: { id: String(msgId++), from: { id: from, is_bot: false, first_name: 'Owner' }, data,
  message: { message_id: msgId++, chat: { id: chat, type: 'private' }, date: Math.floor(Date.now() / 1000) } } });
// The next message(s) Telegram got after `from`, waiting for `n` of them.
const sentAfter = (from, n = 1, what = 'a Telegram message') => waitFor(() => { const s = tgSent(from); return s.length >= n ? s : null; }, { timeout: 60000, every: 200, what });
const requests = () => (existsSync(join(fleet().dir, 'model-requests.jsonl')) ? readFileSync(join(fleet().dir, 'model-requests.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []);
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const noScript = () => rmSync(join(T.fleet.dir, 'model-script.json'), { force: true });
const view = async () => (await api('/telegram')).json;
const tgChat = async () => (await api('/chats')).json.chats.find(c => c.channel === 'telegram');
const tgIdle = () => waitFor(() => !JSON.parse(readFileSync(join(fleet().stateDir, 'telegram.json'), 'utf8')).answering, { timeout: 60000 * SLOW, every: 100, what: 'the preceding Telegram turn to finish' });
const freePort = () => new Promise(res => { const sv = net.createServer(); sv.listen(0, '127.0.0.1', () => { const p = sv.address().port; sv.close(() => res(p)); }); });

describe('Telegram', { concurrency: 1 }, () => {
  describe('connecting and pairing', { concurrency: 1 }, () => {
    test('not connected: nothing is asked of Telegram; connecting is refused until a passkey is set up', async () => {
      const v = await view();
      assert.deepEqual([v.connected, v.paired, v.state, v.code], [false, false, 'off', null]);
      assert.equal(tgCalls().length, 0, 'no call to Telegram');
      is(await api('/telegram', { method: 'PUT', body: { token: TOKEN } }), 409, 'no passkey yet');
      const b = await api('/auth/passkey/begin', { method: 'POST', body: { purpose: 'register' } });
      is(await api('/auth/passkey/register', { method: 'POST', body: KEY.register(b.json) }), 201, 'the owner sets up a passkey');
    });

    test('connecting needs the owner, the page and the passkey; a token Telegram refuses stores nothing', async () => {
      is(await api('/telegram', { method: 'PUT', body: { token: TOKEN }, headers: { 'tailscale-funnel-request': '?1' } }), 401, 'from the internet, not signed in');
      is(await api('/telegram', { method: 'PUT', body: { token: TOKEN }, headers: { 'x-spark-console': null } }), 403, 'cross-site');
      is(await api('/telegram', { method: 'PUT', body: { token: TOKEN } }), 428, 'without the passkey');
      const bad = await confirmed('PUT', '/telegram', { token: REFUSED });
      is(bad, 400, 'a token Telegram refuses');
      assert.match(bad.json.error, /didn’t accept that token/);
      assert.deepEqual(JSON.parse(readFileSync(T.fleet.secretsFile, 'utf8')), { auth: { serial: 1 } }, 'nothing stored (only the number the passkey above gave the state, R23)');
      is(await confirmed('PUT', '/telegram', { token: 'not a token' }), 400);
    });

    test('with the passkey: the bot is named, a one-time code is shown, and the token is kept only in the 0600 secrets file', async () => {
      const r = await confirmed('PUT', '/telegram', { token: TOKEN });
      is(r, 200);
      assert.equal(r.json.bot, 'spark_test_bot');
      assert.match(r.json.code.link, /^https:\/\/t\.me\/spark_test_bot\?start=[A-HJ-KMNP-Z2-9]{8}$/);
      assert.equal(r.json.paired, false);
      pairCode = new URL(r.json.code.link).searchParams.get('start');
      // The code comes only with the passkey-confirmed answer: a plain read (a stolen cookie) never has it.
      assert.equal((await view()).code, null);
      const calls = tgCalls().map(c => c.method);
      assert.ok(calls.includes('getMe') && calls.includes('deleteWebhook'), calls.join(','));
      assert.equal(statSync(T.fleet.secretsFile).mode & 0o777, 0o600);
      assert.ok(!T.fleet.secretsFile.startsWith(T.fleet.stateDir), 'outside the state folder');
      assert.equal(JSON.parse(readFileSync(T.fleet.secretsFile, 'utf8')).telegram.token, TOKEN);
      // Nowhere else: not in the state folder (the daily copy and install snapshots), the log, the API or Sparkie's tools.
      for (const f of readdirSync(T.fleet.stateDir)) {
        const p = join(T.fleet.stateDir, f);
        if (statSync(p).isFile()) assert.ok(!readFileSync(p, 'utf8').includes(TOKEN), `token in ${f}`);
      }
      assert.ok(!T.fleet.logText().includes(TOKEN), 'token in the service log');
      for (const p of ['/telegram', '/health']) assert.ok(!(await api(p)).text.includes(TOKEN), p);
      const setup = await call(look, 'sparkie_setup', {});
      assert.ok(!setup.raw.includes(TOKEN));
      assert.equal(setup.value.telegram.connected, true);
      assert.ok(auditLines().some(l => l.action === 'telegram-connected' && l.args.bot === 'spark_test_bot'));
      await waitFor(async () => (await view()).state === 'pairing', { what: 'polling for the code' });
    });

    test('strangers and wrong codes get silence and never burn the code; a group or a bot can\'t pair; the owner\'s code pairs once', async () => {
      const code = pairCode;
      const from = tgCalls().length;
      await tgSay('hi', { from: STRANGER_TG });
      for (const guess of ['AAAAAAAA', 'BBBBBBBB', 'CCCCCCCC', 'DDDDDDDD']) await tgSay(`/start ${guess}`, { from: STRANGER_TG });
      await tgSay(`/start ${code}`, { from: STRANGER_TG }); // its 5th try: over 3 wrong ones, so even the right code is ignored from it
      await tgSay(`/start ${code}`, { from: OWNER_TG, chat: -100123, chatType: 'group' });
      await tgSay(`/start ${code}`, { from: 5550099, isBot: true });
      await waitFor(async () => (await view()).strangersIgnored >= 8, { what: 'the strangers to be read' });
      assert.equal(tgSent(from).length, 0, 'nobody was answered');
      assert.equal((await view()).paired, false);
      await tgSay(`/start ${code.toLowerCase()}`);
      const [hello] = await sentAfter(from, 1, 'the paired line');
      assert.equal(hello.body.chat_id, OWNER_TG);
      assert.match(hello.body.text, /^Paired with Spark Console\./);
      const v = await view();
      assert.deepEqual([v.paired, v.name, v.state, v.code], [true, 'Owner', 'ok', null]);
      const kept = JSON.parse(readFileSync(T.fleet.secretsFile, 'utf8')).telegram;
      assert.deepEqual([kept.chatId, kept.userId], [OWNER_TG, OWNER_TG]);
      assert.ok(!existsSync(join(T.fleet.stateDir, 'telegram.json')) || !readFileSync(join(T.fleet.stateDir, 'telegram.json'), 'utf8').includes(String(OWNER_TG)), 'the binding isn\'t in the state folder');
    });

    test('once paired, nobody else gets through: a stranger, a stranger pressing a button, the owner in a group or another chat', async () => {
      const from = tgCalls().length, asked = requests().length, chats = (await api('/chats')).json.chats.length;
      await tgSay('stop everything', { from: STRANGER_TG });
      await tgPress('0123456789', { from: STRANGER_TG });
      await tgSay('what\'s running', { from: OWNER_TG, chat: -100123, chatType: 'group' });
      await tgSay('what\'s running', { from: OWNER_TG, chat: 7770001 });
      await tgSay(`/start ABCDEFGH`, { from: STRANGER_TG });
      const before = (await view()).strangersIgnored;
      await waitFor(async () => (await view()).strangersIgnored >= before, { what: 'read' });
      await sleep(1500 * SLOW);
      assert.equal(tgSent(from).length, 0);
      assert.equal(requests().length, asked, 'no model request');
      assert.equal((await api('/chats')).json.chats.length, chats, 'no chat made');
    });
  });

  describe('talking', { concurrency: 1 }, () => {
    test('"what\'s running": typing, then one plain-text message with previews off; the chat is the owner\'s, tagged Telegram', async () => {
      const from = tgCalls().length;
      await tgSay('what\'s running');
      const [m] = await sentAfter(from);
      assert.equal(m.body.chat_id, OWNER_TG);
      assert.equal(m.body.parse_mode, undefined);
      assert.deepEqual(m.body.link_preview_options, { is_disabled: true });
      assert.match(m.body.text, /running_models said/);
      const calls = tgCalls().slice(from);
      assert.ok(calls.findIndex(c => c.method === 'sendChatAction' && c.body.action === 'typing') < calls.findIndex(c => c.method === 'sendMessage'), 'typing first');
      const chat = await tgChat();
      assert.equal(chat.agent, 'Telegram');
      const msgs = await chatMessages(chat.id);
      assert.deepEqual(msgs.slice(-2).map(x => x.role), ['user', 'assistant']);
      assert.equal(msgs.at(-2).content, 'what\'s running');
      const asked = requests().findLast(x => x.words === 'what\'s running');
      assert.match(asked.system, /writing from Telegram/);
      for (const t of ['save_workflow', 'forget_workflow']) assert.ok(!asked.tools.includes(t), `${t} offered`);
      assert.ok(asked.tools.includes('remember'), 'remember not offered');
      // The same words open the same tool groups on the page and Telegram (R46); these words open only the core.
      await say(await newChat(), 'what\'s running');
      const onPage = requests().findLast(x => x.words === 'what\'s running' && !/writing from Telegram/.test(x.system));
      assert.deepEqual([...asked.tools].sort(), [...onPage.tools].sort());
      assert.deepEqual([...asked.tools].sort(), [...CORE_TOOLS].sort());
      assert.ok(asked.tools.includes('start_model'));
      // undo_update, not offered for words that open no group (any undo word offers both undos), still reaches runAction
      // from Telegram when called. The words did not ask for it, so only the owner's real, one-use press permits it.
      script([{ match: '^go back to how it was before$', calls: [{ name: 'undo_update', arguments: {} }] }]);
      try {
        const before = tgCalls().length, rolled = auditLines().filter(l => l.action === 'rollback').length;
        await tgSay('go back to how it was before');
        const [reply] = await sentAfter(before);
        await tgIdle();
        assert.ok(!requests().findLast(x => x.words === 'go back to how it was before' && x.round === 0).tools.includes('undo_update'), 'undo_update was offered');
        const button = reply.body.reply_markup?.inline_keyboard?.[0]?.[0];
        assert.ok(button, `a button: ${JSON.stringify(reply.body)}`);
        const chat = await tgChat();
        assert.ok((await chatMessages(chat.id)).flatMap(m => m.choices || []).some(c => c.id === button.callback_data && c.state === 'open'), 'the exact unrequested change is still only an open choice');
        is(await choose(chat.id, button.callback_data), 428, 'a page press still needs the passkey');
        assert.equal(auditLines().filter(l => l.action === 'rollback').length, rolled, 'asking and a bare page press undo nothing');
        const pressAt = tgCalls().length;
        await tgPress(button.callback_data);
        const [pressed] = await sentAfter(pressAt, 1, 'the owner press');
        assert.match(pressed.body.text, /Going back to the build from before the update on 20261110T120000Z/);
        assert.equal(auditLines().filter(l => l.action === 'rollback').length, rolled + 1);
        const ran = auditLines().findLast(l => l.action === 'undo_update');
        assert.deepEqual([ran.outcome, ran.channel, ran.via], ['started', 'telegram', 'telegram']);
        const replay = tgCalls().length;
        await tgPress(button.callback_data);
        const [expired] = await sentAfter(replay);
        assert.match(expired.body.text, /expired/);
        assert.equal(auditLines().filter(l => l.action === 'rollback').length, rolled + 1, 'the same choice never runs twice');
      } finally { noScript(); }
    });

    test('a long answer is split under 4,096 characters a message; the owner’s incoming message stays complete', async () => {
      const from = tgCalls().length, long = `${'wordy '.repeat(900)}end`;
      await tgSay(long);
      const sent = await sentAfter(from, 2, 'two parts');
      await sleep(500);
      assert.ok(tgSent(from).length <= 3);
      for (const s of tgSent(from)) assert.ok(s.body.text.length <= 4096, String(s.body.text.length));
      const saved = (await chatMessages((await tgChat()).id)).filter(x => x.role === 'user').at(-1).content;
      assert.equal(saved, long, 'the paired owner’s incoming words are not truncated');
      assert.ok(sent.length >= 2);
    });

    test('/new starts a new chat and keeps the old one; /status answers without the model', async () => {
      const old = (await tgChat()).id, from = tgCalls().length, asked = requests().length;
      await tgSay('/new');
      assert.match((await sentAfter(from))[0].body.text, /^New chat\./);
      await tgSay('/status');
      const [, status] = await sentAfter(from, 2);
      assert.match(status.body.text, /Sparks online: .*\nOperations running: \d+\.\nSpark Console build [0-9a-f]{12}\./);
      assert.equal(requests().length, asked, '/new and /status never ask the model');
      const f2 = tgCalls().length;
      await tgSay('hello again');
      await sentAfter(f2);
      const chats = (await api('/chats')).json.chats.filter(c => c.channel === 'telegram');
      assert.equal(chats.length, 2);
      assert.notEqual((await tgChat()).id, old);
    });

    test('a change from Telegram runs as asked, is on the record with its channel, and reports once when it ends, as a fixed line', { timeout: 120000 * SLOW }, async () => {
      const from = tgCalls().length;
      await tgSay(`stop ${RADIX} on spark 4`);
      const [reply] = await sentAfter(from);
      assert.match(reply.body.text, /"outcome":"started"/);
      const line = auditLines().findLast(l => l.action === 'stop_model' && l.ok);
      assert.deepEqual([line.via, line.channel, line.from, line.actor], ['sparkie', 'telegram', `telegram:${OWNER_TG}`, 'Sparkie for the owner on Telegram']);
      const [, done] = await sentAfter(from, 2, 'the result');
      assert.equal(done.body.text, `Done: stopping “${RADIX}” on Spark 4 finished.`);
      const notice = (await chatMessages((await tgChat()).id)).find(m => m.notice && m.operation === line.operation);
      assert.match(notice.content, /^Done: stopping /, 'the page\'s chat keeps the full notice');
      await sleep(1500);
      assert.equal(tgSent(from).length, 2, 'one reply, one result');
    });

    test('an unclear request is a button in Telegram; pressing it runs it as the owner on Telegram; a second press has expired', { timeout: 120000 * SLOW }, async () => {
      const from = tgCalls().length;
      await tgSay(`should I restart ${RADIX} on spark 4?`);
      const [ask] = await sentAfter(from);
      const button = ask.body.reply_markup.inline_keyboard[0][0];
      assert.match(button.text, /^Restart sc-RadixArk/);
      await tgPress(button.callback_data);
      const [, pressed] = await sentAfter(from, 2, 'the press');
      assert.equal(pressed.body.text, 'Under way. I’ll tell you here when it’s done.');
      const line = auditLines().findLast(l => l.action === 'restart_model' && l.ok);
      assert.deepEqual([line.via, line.actor, line.channel], ['telegram', 'owner on Telegram', 'telegram']);
      await sentAfter(from, 3, 'the result');
      await tgPress(button.callback_data);
      const [, , , again] = await sentAfter(from, 4, 'the second press');
      assert.equal(again.body.text, 'That button has expired. Ask again.');
    });

    test('a second message while Sparkie answers gets one "still answering" line and never runs', { timeout: 120000 * SLOW }, async () => {
      const from = tgCalls().length;
      await tgSay('take 4 seconds to answer this');
      await waitFor(() => requests().some(x => x.words === 'take 4 seconds to answer this'), { what: 'the first turn' });
      assert.ok(JSON.parse(readFileSync(join(T.fleet.stateDir, 'telegram.json'), 'utf8')).answering, 'a turn under way is on record');
      await tgSay('second one');
      await tgSay('third one');
      const sent = await sentAfter(from, 2, 'the answer');
      await sleep(1000);
      const texts = tgSent(from).map(s => s.body.text);
      assert.equal(texts.filter(t => /^Still answering the last one\./.test(t)).length, 1, texts.join(' | '));
      assert.ok(!requests().some(x => x.words === 'second one' || x.words === 'third one'));
      assert.ok(sent.some(s => /take 4 seconds/.test(s.body.text)));
    });

    test('forwarded messages, photos, old messages and token-shaped text are never read as the owner\'s words', async () => {
      const from = tgCalls().length, asked = requests().length;
      await tgSay('stop everything', { extra: { forward_origin: { type: 'user', date: 1 } } });
      await tgSay(null, { extra: { photo: [{ file_id: 'x' }] } });
      await tgSay('stop everything', { date: Math.floor(Date.now() / 1000) - 400 });
      await tgSay(`my token is ${TOKEN}`);
      const sent = await sentAfter(from, 4);
      assert.deepEqual(sent.map(s => s.body.text.split('.')[0].split(':')[0]), ['Type it in your own words', 'I only read text here', 'I was away when you sent that', 'That looks like a bot token']);
      assert.equal(requests().length, asked, 'no model request');
      assert.ok(!readFileSync(join(T.fleet.stateDir, 'chats.json'), 'utf8').includes(TOKEN));
    });

    // Owner commands run through code. Resuming still requires the exact dangerous confirmation and digits.
    test('the owner\'s words are answered by code while Sparkie answers; an unconfirmed resume stays paused', { timeout: 240000 * SLOW }, async () => {
      let from = tgCalls().length, asked = requests().length;
      await tgSay('/help');
      const [help] = await sentAfter(from);
      assert.match(help.body.text, /^Paired with Spark Console\./);
      for (const w of ['/new', '/status', '/pause', '/resume', '/admin', '/restart sparkie', '/stop', '/unpair']) assert.ok(help.body.text.includes(w), w);
      assert.doesNotMatch(help.body.text, /By hand|docker |agent-settings\.json/);
      const rollbacks = () => auditLines().filter(l => l.action === 'rollback').length, rolled = rollbacks();
      try {
        from = tgCalls().length;
        await tgSay('/pause');
        const [p] = await sentAfter(from);
        assert.match(p.body.text, /^Paused\. /);
        assert.match(p.body.text, /To resume: send \/resume and confirm the change/);
        assert.doesNotMatch(p.body.text, /agent-settings\.json/);
        assert.equal((await api('/agents')).json.settings.halted, true);
        assert.ok(auditLines().some(l => l.action === 'agent-settings' && l.via === 'telegram' && l.args?.word === '/pause'));
        assert.equal(requests().length, asked, 'no model call');
        let f = tgCalls().length;
        await tgSay('/resume');
        const [resume] = await sentAfter(f, 1, '/resume confirmation');
        assert.match(resume.body.text, /Resume agents’ changes/);
        assert.match(resume.body.text, /To run it: press Run it, then type \d{2}\./);
        assert.ok(resume.body.reply_markup?.inline_keyboard?.length, 'the real confirmation reaches the paired owner');
        assert.equal((await api('/agents')).json.settings.halted, true, 'typed /resume without its press and digits stays paused');
        f = tgCalls().length;
        await tgSay('/undo update');
        const [undo] = await sentAfter(f, 1, '/undo update');
        assert.match(undo.body.text, /Going back to the build from before the update/);
        assert.equal((await api('/agents')).json.settings.halted, true, 'undoing an update does not resume agents');
        assert.equal(rollbacks(), rolled + 1, 'the explicit owner undo command runs once');
        assert.equal(requests().length, asked, 'both owner commands bypass the model');
      } finally { is(await confirmed('PUT', '/agents/settings', { halted: false }), 200); }
      // With the brain not answering: the line names the word (and promises no restart by itself); the word restarts it.
      const hung = join(T.fleet.root, 'spark2', '.mock', 'brain-hung');
      writeFileSync(hung, '1');
      try {
        from = tgCalls().length;
        await tgSay('hello?');
        const [down] = await sentAfter(from);
        assert.match(down.body.text, /^Sparkie’s model isn’t answering\./);
        assert.match(down.body.text, /\/restart sparkie/);
        assert.doesNotMatch(down.body.text, /by itself/);
        const restarts = () => auditLines().filter(l => l.action === 'restart_sparkie' && l.via === 'telegram'), before = restarts().length;
        from = tgCalls().length; asked = requests().length;
        await tgSay('/restart_sparkie');
        const [r] = await sentAfter(from);
        assert.match(r.body.text, /^Restarting Sparkie’s model\./);
        await waitFor(() => restarts().length > before, { timeout: 60000 * SLOW, what: 'the restart' });
        assert.deepEqual([restarts().at(-1).ok, restarts().at(-1).args.word], [true, '/restart sparkie']);
        assert.equal(requests().length, asked, 'no model call');
      } finally { rmSync(hung, { force: true }); }
      await waitFor(async () => (await api('/main')).json.healthy === true, { timeout: 60000 * SLOW, what: 'Sparkie answering' });
      // /stop while Sparkie answers: the answer ends, nothing more is sent for it, and the next message is answered.
      from = tgCalls().length;
      await tgSay('take 20 seconds to answer this');
      await waitFor(() => requests().some(x => x.words === 'take 20 seconds to answer this'), { what: 'the slow turn' });
      const t0 = Date.now();
      await tgSay('/stop');
      const [st] = await sentAfter(from);
      assert.match(st.body.text, /^Stopped\. /);
      await waitFor(() => !JSON.parse(readFileSync(join(T.fleet.stateDir, 'telegram.json'), 'utf8')).answering, { timeout: 15000, what: 'the turn ended' });
      await tgSay('quick one');
      await sentAfter(from, 2, 'the next answer');
      assert.ok(Date.now() - t0 < 15000 * SLOW, 'well before the stand-in would have answered');
      await sleep(1000);
      assert.equal(tgSent(from).length, 2, 'the stopped turn sent nothing');
      assert.equal((await chatMessages((await tgChat()).id)).filter(m => m.error).at(-1)?.error, 'Stopped at your word.');
    });
  });

  describe('paired owner controls and their confirmations', { concurrency: 1 }, () => {
    test('an explicit owner update undo has page-equivalent authority and keeps the Telegram audit channel', { timeout: 90000 * SLOW }, async () => {
      script([{ match: '^undo the update$', calls: [{ name: 'undo_update', arguments: {} }] }]);
      try {
        const from = tgCalls().length, rolled = auditLines().filter(l => l.action === 'rollback').length;
        await tgSay('undo the update');
        const [m] = await sentAfter(from);
        assert.match(m.body.text, /Going back to the build from before the update/);
        assert.equal(auditLines().filter(l => l.action === 'rollback').length, rolled + 1);
        const line = auditLines().findLast(l => l.action === 'undo_update');
        assert.deepEqual([line.outcome, line.channel, line.via], ['started', 'telegram', 'sparkie']);
      } finally { noScript(); }
    });

    test('/undo update is answered by code with no model call and undoes the update once', { timeout: 90000 * SLOW }, async () => {
      const from = tgCalls().length, asked = requests().length, rollbacks = auditLines().filter(l => l.action === 'rollback').length;
      await tgSay('/undo update');
      const [reply] = await sentAfter(from, 1);
      assert.match(reply.body.text, /Going back to the build from before the update/);
      assert.equal(requests().length, asked, 'the owner command did not reach the model');
      assert.equal(auditLines().filter(l => l.action === 'rollback').length, rollbacks + 1);
      assert.equal(auditLines().findLast(l => l.action === 'rollback').via, 'telegram');
    });

    test('saved workflows use the same tool groups and exact step confirmation; memory keeps its Telegram attribution', { timeout: 90000 * SLOW }, async () => {
      script([{ match: '^remember that spark 3 is the coding box$', calls: [{ name: 'remember', arguments: { text: 'Spark 3 is the coding box', kind: 'fact' }, offered: false }] },
        { match: '^save my routine$', calls: [{ name: 'save_workflow', arguments: { title: 'coding mode', steps: [{ action: 'stop_model', args: { spark: 'spark3', container: 'x' } }] }, offered: false }] }]);
      try {
        const memoryFile = join(T.fleet.stateDir, 'memory.json'), before = existsSync(memoryFile) ? readFileSync(memoryFile, 'utf8') : null;
        const from = tgCalls().length;
        await tgSay('remember that spark 3 is the coding box');
        await sentAfter(from, 1);
        await tgSay('save my routine');
        await sentAfter(from, 2);
        assert.notEqual(existsSync(memoryFile) ? readFileSync(memoryFile, 'utf8') : null, before, 'memory changed');
        const kept = JSON.parse(readFileSync(memoryFile, 'utf8')).entries.filter(e => e.text === 'Spark 3 is the coding box');
        assert.deepEqual(kept.map(e => [e.by, e.src.via, e.src.channel]), [['owner', 'sparkie', 'telegram']]);
        await tgIdle();
        const remembered = auditLines().findLast(l => l.action === 'remember');
        assert.deepEqual([remembered?.outcome, remembered?.channel], ['remembered', 'telegram']);
        const asked = requests().findLast(x => x.words === 'save my routine');
        assert.ok(asked.tools.includes('remember') && asked.tools.includes('save_workflow'));
        const chat = await tgChat(), choice = (await chatMessages(chat.id)).flatMap(m => m.choices || []).findLast(c => c.state === 'open' && c.label.startsWith('Save the workflow “coding mode”'));
        assert.ok(choice, 'the save still needs the exact steps confirmed');
        await waitFor(() => tgSent(from).some(m => m.body.reply_markup?.inline_keyboard?.some(row => row.some(b => b.callback_data === choice.id))), { what: 'the exact save choice on Telegram' });
        assert.ok(!(await api('/actions/workflows', { method: 'POST', body: {} })).json.saved.some(w => w.name === 'coding-mode'), 'asking has not saved the workflow');
        is(await choose(chat.id, choice.id), 428, 'the page still needs a passkey');
        const saveAt = tgCalls().length;
        await tgPress(choice.id);
        const [saved] = await sentAfter(saveAt);
        assert.equal(saved.body.text, 'Approved from Telegram: Save the workflow “coding mode”: 1. Stop x on Spark 3: done.');
        const savedAudit = auditLines().findLast(l => l.action === 'save_workflow');
        assert.deepEqual([savedAudit?.outcome, savedAudit?.channel, savedAudit?.via], ['saved', 'telegram', 'telegram']);
        assert.ok((await api('/actions/workflows', { method: 'POST', body: {} })).json.saved.some(w => w.name === 'coding-mode'));
        const replayAt = tgCalls().length;
        await tgPress(choice.id);
        assert.match((await sentAfter(replayAt))[0].body.text, /expired/);
      } finally { noScript(); }
    });

    // The workloads review's A1 (D6c): "save that as …" asked on Telegram waits for a button that lists no steps, so its
    // press on the page, with the passkey, saves the request's steps but is no yes to the images they start.
    test('a save asked on Telegram with from, pressed on the page with the passkey, saves the steps but is no yes to their image', { timeout: 180000 * SLOW }, async () => {
      const port = await freePort(), IMAGE = 'nginx:1.27';
      script([{ match: '^run wl-tg on spark 4$', calls: [{ name: 'keep_running', arguments: { spark: 'spark4', container: 'wl-tg', image: IMAGE, port: `${port}:80` } }] },
        { match: '^save that as tg web$', calls: [{ name: 'save_workflow', arguments: { title: 'tg web', from: 'this request' }, offered: false }] }]);
      const open = (chat, words) => waitFor(async () => (await chatMessages(chat.id)).flatMap(m => m.choices || []).findLast(c => c.label.includes(words) && (!c.state || c.state === 'open')) || null,
        { timeout: 60000, every: 250, what: `a button with “${words}”` });
      try {
        await tgSay('run wl-tg on spark 4');
        const chat = await tgChat(), start = await open(chat, `Start wl-tg on Spark 4 from the image ${IMAGE}`);
        const started = await confirmed('POST', `/chats/${chat.id}/choose`, { choice: start.id });
        is(started, 200, 'the start, pressed on the page');
        assert.equal(started.json.outcome, 'started', started.text);
        await waitFor(async () => { const o = (await api(`/jobs/${started.json.operation}`)).json; return o?.status && o.status !== 'running' ? o : null; }, { timeout: 120000, every: 250, what: 'wl-tg started' });
        await tgSay('save that as tg web');
        const save = await open(chat, 'Save the workflow “tg web”');
        assert.equal(save.label, 'Save the workflow “tg web”: what your request before it changed in this chat');
        const pressed = await confirmed('POST', `/chats/${chat.id}/choose`, { choice: save.id });
        is(pressed, 200, 'the save, pressed on the page with the passkey');
        assert.equal(pressed.json.outcome, 'saved', pressed.text);
        const w = (await api('/actions/workflows', { method: 'POST', body: {} })).json.saved.find(x => x.name === 'tg-web');
        assert.deepEqual(w?.steps.map(st => [st.action, st.args.container, st.args.image]), [['keep_running', 'wl-tg', IMAGE]], JSON.stringify(w));
        assert.equal(w.imagesApproved, undefined, 'no yes to the image');
        assert.equal(pressed.json.message.content, 'Saved the workflow “tg web”. A run asks before it starts nginx:1.27: only your yes to a save’s button, which lists its steps, covers the images it names.');
      } finally {
        noScript();
        await api('/actions/forget_workflow', { method: 'POST', body: { name: 'tg web' } }).catch(() => {});
        await api('/actions/keep_running', { method: 'POST', body: { spark: 'spark4', container: 'wl-tg', do: 'stop' } }).catch(() => {});
      }
    });

    // Forgotten is retired, not erased: the paired owner can inspect it; it never returns to live memory by a read.
    test('the paired owner reads retired memory and its journal records without reviving the forgotten line', { timeout: 120000 * SLOW }, async () => {
      const WORDS = 'my garage code is 9182';
      const kept = await api('/actions/remember', { method: 'POST', body: { text: WORDS, kind: 'fact' } });
      is(kept, 200, 'remember');
      is(await api('/actions/forget_memory', { method: 'POST', body: { id: kept.json.id } }), 200, 'forget');
      script([{ match: '^what did I ask you to forget\\?$', calls: [{ name: 'memory', arguments: { past: true } }] },
        { match: '^what do you have on my garage\\?$', calls: [{ name: 'recall', arguments: { about: 'garage code' } }, { name: 'recall', arguments: { id: kept.json.id } }] },
        { match: '^drop the garage line$', calls: [{ name: 'forget_memory', arguments: { id: kept.json.id } }] },
        { match: '^erase the garage line for good$', calls: [{ name: 'forget_memory', arguments: { id: kept.json.id, erase: true } }] }]);
      try {
        for (const words of ['what did I ask you to forget?', 'what do you have on my garage?']) {
          const from = tgCalls().length;
          await tgSay(words);
          await sentAfter(from);
          await tgIdle();
          const toBrain = requests().filter(x => x.words === words).flatMap(x => x.results.map(r => r.content)).join('\n');
          assert.ok(toBrain.includes(WORDS), `${words}: the paired owner receives the retired owner record`);
        }
        const before = tgCalls().length;
        await tgSay('drop the garage line');
        await sentAfter(before);
        await tgIdle();
        const live = (await api('/actions/memory', { method: 'POST', body: {} })).json;
        assert.ok(!live.entries.some(e => e.id === kept.json.id), 'reads and a repeated forget do not revive the line');
        const eraseAt = tgCalls().length;
        await tgSay('erase the garage line for good');
        await sentAfter(eraseAt);
        await tgIdle();
        const chat = await tgChat(), choices = (await chatMessages(chat.id)).findLast(m => m.choices?.some(c => c.label === `Erase for good: “${WORDS}”`)).choices;
        const yes = choices.find(c => c.label === `Erase for good: “${WORDS}”`), no = choices.find(c => c.label === 'No, keep it');
        assert.ok(yes && no);
        await waitFor(() => tgSent(eraseAt).some(m => m.body.reply_markup?.inline_keyboard?.some(row => row.some(b => b.callback_data === yes.id))), { what: 'the retired-line erase confirmation' });
        assert.ok((await api('/actions/memory', { method: 'POST', body: { past: true } })).json.past.some(e => e.id === kept.json.id), 'asking has not erased it');
        const declineAt = tgCalls().length;
        await tgPress(no.id);
        assert.equal((await sentAfter(declineAt))[0].body.text, 'Okay, left as it is.');
        assert.ok((await api('/actions/memory', { method: 'POST', body: { past: true } })).json.past.some(e => e.id === kept.json.id), 'declining keeps the retired line');
      } finally { noScript(); }
    });

    // Erasure still requires the exact owner's confirmation. A stranger, typed yes or a bare page request cannot erase.
    test('a paired-owner erase button runs once; page confirmation still requires its passkey', { timeout: 180000 * SLOW }, async () => {
      const WORDS = 'The spare key for the rack is in the top drawer';
      const kept = await api('/actions/remember', { method: 'POST', body: { text: WORDS, kind: 'fact' } });
      is(kept, 200, 'remember');
      const id = kept.json.id, lines = async () => (await api('/actions/memory', { method: 'POST', body: { past: true } })).json;
      script([{ match: '^erase the line about the rack key for good$', calls: [{ name: 'forget_memory', arguments: { id, erase: true }, offered: false }] }]);
      try {
        const from = tgCalls().length;
        await tgSay('erase the line about the rack key for good');
        await sentAfter(from);
        await tgIdle();
        const line = auditLines().findLast(l => l.action === 'forget_memory');
        assert.deepEqual([line.outcome, line.channel, line.args], ['question', 'telegram', { id, erase: true }]);
        assert.ok((await lines()).entries.some(e => e.id === id), 'asking has not erased the line');
        const chat = await tgChat(), c = (await chatMessages(chat.id)).findLast(x => x.choices?.some(c => c.label === `Erase for good: “${WORDS}”`)).choices[0];
        assert.equal(c.label, `Erase for good: “${WORDS}”`);
        await waitFor(() => tgSent(from).some(m => m.body.reply_markup?.inline_keyboard?.some(row => row.some(b => b.callback_data === c.id))), { what: 'the exact owner erase button' });
        const strangerAt = tgCalls().length;
        await tgPress(c.id, { from: STRANGER_TG });
        await sleep(500);
        assert.equal(tgSent(strangerAt).length, 0, 'a stranger gets silence');
        assert.ok((await lines()).entries.some(e => e.id === id), 'the stranger did not erase it');
        const yesAt = tgCalls().length;
        await tgSay('yes');
        await sentAfter(yesAt);
        await tgIdle();
        assert.ok((await lines()).entries.some(e => e.id === id), 'typed yes is no confirmation');
        is(await choose(chat.id, c.id), 428, 'the page still needs a passkey');
        const pressAt = tgCalls().length;
        await tgPress(c.id);
        const [erased] = await sentAfter(pressAt);
        assert.match(erased.body.text, /Erased for good/);
        const after = await lines();
        assert.ok(!after.entries.some(e => e.id === id) && !after.past.some(p => p.id === id), JSON.stringify(after));
        const replayAt = tgCalls().length;
        await tgPress(c.id);
        assert.match((await sentAfter(replayAt))[0].body.text, /expired/);
        const again = await lines();
        assert.ok(!again.entries.some(e => e.id === id) && !again.past.some(p => p.id === id), 'a replay cannot restore erased memory');
        // Keep the existing authenticated page path covered with a separate exact line.
        const pageLine = await api('/actions/remember', { method: 'POST', body: { text: `${WORDS} (page confirmation)`, kind: 'fact' } });
        is(pageLine, 200);
        script([{ match: '^erase the page check$', calls: [{ name: 'forget_memory', arguments: { id: pageLine.json.id, erase: true }, offered: false }] }]);
        const pageAt = tgCalls().length;
        await tgSay('erase the page check');
        await sentAfter(pageAt);
        await tgIdle();
        const pageChoice = (await chatMessages(chat.id)).findLast(m => m.choices?.some(c => c.label.includes('(page confirmation)'))).choices[0];
        is(await choose(chat.id, pageChoice.id), 428, 'the second page press still needs its passkey');
        const pressed = await confirmed('POST', `/chats/${chat.id}/choose`, { choice: pageChoice.id });
        is(pressed, 200, 'with the passkey');
        assert.equal(pressed.json.outcome, 'erased');
        const pageAfter = await lines();
        assert.ok(!pageAfter.entries.some(e => e.id === pageLine.json.id) && !pageAfter.past.some(e => e.id === pageLine.json.id), 'the authenticated page erase removes live and retired memory');
      } finally { noScript(); }
    });

    test('with agents\' changes paused, a change from Telegram is refused; a lookup and /status still answer', { timeout: 90000 * SLOW }, async () => {
      await agentSettings({ halted: true });
      try {
        const from = tgCalls().length;
        await tgSay(`restart ${RADIX} on spark 4`);
        const [m] = await sentAfter(from);
        assert.match(m.body.text, /paused/i);
        await tgSay('/status');
        await tgSay('what\'s running');
        const sent = await sentAfter(from, 3);
        assert.match(sent[1].body.text, /^Sparkie: /);
        assert.match(sent[2].body.text, /running_models said/);
      } finally {
        is(await confirmed('PUT', '/agents/settings', { halted: false }), 200);
      }
    });
  });

  describe('injection and secrets', { concurrency: 1 }, () => {
    test('a model misled into a change on a question gets a button, not a start', { timeout: 90000 * SLOW }, async () => {
      const from = tgCalls().length, ops = auditLines().filter(l => l.action === 'start_model' && l.outcome === 'started').length;
      await tgSay('why did it fail');
      const [m] = await sentAfter(from);
      assert.ok(m.body.reply_markup?.inline_keyboard?.length, 'a button');
      assert.equal(auditLines().filter(l => l.action === 'start_model' && l.outcome === 'started').length, ops, 'nothing started');
    });
    test('secrets in a reply are hidden; the bot token pattern is masked like other keys', async () => {
      const from = tgCalls().length;
      await tgSay('my hugging face key is hf_abcdefghijklmnopqrstuvwxyz123456 ok');
      const [m] = await sentAfter(from);
      assert.ok(!m.body.text.includes('hf_abcdefghijklmnopqrstuvwxyz123456'));
      assert.match(m.body.text, /\[hidden\]/);
      const r = await call(look, 'search_huggingface', { query: `x ${TOKEN.replace('123456789', '987654321')}` });
      assert.ok(!r.raw.includes(TOKEN.split(':')[1]), 'masked in the agent door');
    });
  });

  describe('when things go wrong', { concurrency: 1 }, () => {
    test('Telegram unreachable: it says so and retries by itself; a message waiting there is answered once when it\'s back', { timeout: 90000 * SLOW }, async () => {
      await tgMode({ down: true });
      await waitFor(async () => (await view()).state === 'unreachable', { what: 'unreachable' });
      is(await api('/health'), 200);
      const from = tgCalls().length;
      await tgSay('what\'s running');
      await tgMode({});
      const [m] = await sentAfter(from);
      assert.match(m.body.text, /running_models said/);
      await sleep(2000);
      assert.equal(tgSent(from).length, 1, 'answered once');
      assert.equal((await view()).state, 'ok');
    });

    test('409 (another program polls with the token): backs off, never fights, says so', { timeout: 60000 * SLOW }, async () => {
      const hooks = tgCalls().filter(c => c.method === 'deleteWebhook').length;
      await tgMode({ inUse: true });
      await waitFor(async () => (await view()).state === 'in-use', { what: 'in use' });
      const setup = await call(look, 'sparkie_setup', {});
      assert.match(setup.value.telegram.whatToDo, /Another program is using this bot/);
      await tgMode({});
      await waitFor(async () => (await view()).state === 'ok', { timeout: 30000, what: 'back' });
      assert.equal(tgCalls().filter(c => c.method === 'deleteWebhook').length, hooks, 'the loop never clears a webhook');
    });

    // F13 (review, 2026-11-11): one bad read of the secrets file never ends Telegram.
    test('a secrets file that can\'t be read: it is read again by itself, and a message sent meanwhile is answered once the file is back, with no restart', { timeout: 120000 * SLOW }, async () => {
      const good = readFileSync(T.fleet.secretsFile, 'utf8'), pid = T.fleet.servicePid();
      let from, said, put;
      // (written in place, so the file keeps its 0600 mode)
      writeFileSync(T.fleet.secretsFile, '{ "telegram": ');
      try {
        await waitFor(async () => (await view()).state === 'secrets-unreadable', { what: 'secrets-unreadable' });
        said = (await call(look, 'sparkie_setup', {})).value.telegram.whatToDo;
        // The page offers the token form in this state. Pasting one stops the loop's wait and can't be saved: the loop
        // must still be there afterwards.
        put = await confirmed('PUT', '/telegram', { token: TOKEN });
        from = tgCalls().length;
        await tgSay('what\'s running');
      } finally { writeFileSync(T.fleet.secretsFile, good); }
      is(put, 500, 'a token can\'t be saved over a file that can\'t be read');
      const [m] = await sentAfter(from);
      assert.match(m.body.text, /running_models said/);
      assert.equal((await view()).state, 'ok');
      assert.equal(T.fleet.servicePid(), pid, 'the same process: nothing was restarted');
      assert.match(said, /tries again every minute/);
    });

    test('the brain not answering: a fixed line, and /status still answers without it', { timeout: 90000 * SLOW }, async () => {
      const hung = join(T.fleet.root, 'spark2', '.mock', 'brain-hung');
      writeFileSync(hung, '1');
      try {
        const from = tgCalls().length;
        await tgSay('hello?');
        const [m] = await sentAfter(from);
        assert.match(m.body.text, /^Sparkie’s model isn’t answering\./);
      } finally { rmSync(hung, { force: true }); }
    });

    test('a token that stops working: polling stops and the page and Sparkie say what to do', { timeout: 60000 * SLOW }, async () => {
      await tgMode({ refuse: true });
      await waitFor(async () => (await view()).state === 'token-refused', { what: 'refused' });
      const n = tgCalls().filter(c => c.method === 'getUpdates').length;
      await sleep(2500);
      assert.equal(tgCalls().filter(c => c.method === 'getUpdates').length, n, 'no more polling');
      assert.match((await call(look, 'sparkie_setup', {})).value.telegram.whatToDo, /token stopped working/);
      await tgMode({});
    });

    test('disconnecting needs no passkey and forgets token and chat; /unpair does the same from Telegram', { timeout: 60000 * SLOW }, async () => {
      // A secrets file that can't be changed: Telegram still goes off at once, and the page says to remove the file.
      await tgMode({});
      // (a folder where the service writes its temporary copy: the write fails, the file stays as it was)
      const blocker = `${T.fleet.secretsFile}.${T.fleet.servicePid()}.tmp`;
      mkdirSync(blocker);
      try {
        is(await api('/telegram', { method: 'DELETE' }), 200);
        const v = await view();
        assert.deepEqual([v.connected, v.state], [false, 'forget-failed']);
        assert.match(v.whatToDo, /Remove ~\/\.config\/spark-console\/secrets\.json/);
        const quiet = tgCalls().length;
        await tgSay('still there?');
        await sleep(2500 * SLOW);
        assert.equal(tgSent(quiet).length, 0, 'off at once');
      } finally { rmSync(blocker, { recursive: true, force: true }); }
      is(await api('/telegram', { method: 'DELETE' }), 200);
      assert.equal(JSON.parse(readFileSync(T.fleet.secretsFile, 'utf8')).telegram, undefined);
      assert.equal((await view()).connected, false);
      // Connect and pair again, then /unpair.
      const r = await confirmed('PUT', '/telegram', { token: TOKEN });
      const code = new URL(r.json.code.link).searchParams.get('start');
      let from = tgCalls().length;
      await tgSay(`/start ${code}`);
      await sentAfter(from);
      from = tgCalls().length;
      await tgSay('/unpair');
      assert.match((await sentAfter(from))[0].body.text, /^Disconnected/);
      assert.equal((await view()).connected, false);
      const after = tgCalls().length;
      await sleep(1500);
      await tgSay('are you there?');
      await sleep(2500 * SLOW);
      assert.equal(tgSent(after).length, 0, 'silence once disconnected');
    });
  });

  describe('restart, flood, build and source', { concurrency: 1 }, () => {
    test('after a restart: a turn that was cut off and an operation that didn\'t report get one line', { timeout: 120000 * SLOW }, async () => {
      const fleet = await startMock({ telegram: true, prepare: ({ dir, stateDir }) => {
        mkdirSync(join(dir, 'secrets'), { recursive: true, mode: 0o700 });
        writeFileSync(join(dir, 'secrets', 'secrets.json'), JSON.stringify({ telegram: { token: TOKEN, bot: 'spark_test_bot', chatId: OWNER_TG, userId: OWNER_TG, name: 'Owner' } }), { mode: 0o600 });
        writeFileSync(join(stateDir, 'telegram.json'), JSON.stringify({ offset: 0, answering: { at: new Date().toISOString() }, awaiting: [{ id: 'abcdefabcdef', what: 'Starting “gemma” on Spark 3' }] }), { mode: 0o600 });
      } });
      try {
        const calls = () => { const f = join(fleet.dir, 'telegram-calls.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []; };
        const sent = await waitFor(() => calls().filter(c => c.method === 'sendMessage').at(0), { what: 'the line after the restart' });
        assert.equal(sent.body.text, 'Spark Console restarted while I was answering. Send that again.\nA restart cut off starting “gemma” on Spark 3. Check it in Spark Console.');
        const st = JSON.parse(readFileSync(join(fleet.stateDir, 'telegram.json'), 'utf8'));
        assert.deepEqual([st.answering, st.awaiting], [undefined, []]);
      } finally { await fleet.stop(); }
    });

    test('floods, with the real limits: strangers are dropped without sends or brain calls; the owner gets 20 a minute, one "too many" line, one turn at a time', { timeout: 180000 * SLOW }, async () => {
      F = await startMock({ telegram: true, prepare: ({ dir }) => {
        mkdirSync(join(dir, 'secrets'), { recursive: true, mode: 0o700 });
        writeFileSync(join(dir, 'secrets', 'secrets.json'), JSON.stringify({ telegram: { token: TOKEN, bot: 'spark_test_bot', chatId: OWNER_TG, userId: OWNER_TG, name: 'Owner' } }), { mode: 0o600 });
      } });
      try {
        await waitFor(() => tgCalls().some(c => c.method === 'getUpdates'), { what: 'polling' });
        let from = tgCalls().length;
        const asked = requests().length;
        await tgPost('/__push', Array.from({ length: 300 }, (_, i) => ({ message: { message_id: 90000 + i, date: Math.floor(Date.now() / 1000), chat: { id: 8000000 + i, type: 'private' }, from: { id: 8000000 + i, is_bot: false }, text: 'stop everything' } })));
        await tgSay('what\'s running');
        const [m] = await sentAfter(from);
        assert.equal(m.body.chat_id, OWNER_TG);
        assert.match(m.body.text, /running_models said/);
        await sleep(1000);
        assert.equal(tgSent(from).length, 1, 'nobody else was answered');
        assert.equal(requests().length - asked, 2, 'only the owner\'s turn asked the model (two rounds)');
        assert.equal((await fetch(`${F.base}/health`)).status, 200);
        // The owner's own flood.
        from = tgCalls().length;
        const before = requests().length;
        await tgSay('take 3 seconds please');
        for (let i = 0; i < 24; i++) await tgSay(`flood ${i}`);
        await sentAfter(from, 2, 'the answer and the busy line');
        await tgIdle();
        const texts = tgSent(from).map(s => s.body.text);
        assert.equal(texts.filter(t => /^Still answering/.test(t)).length, 1, texts.join(' | '));
        assert.ok(!requests().slice(before).some(x => /^flood /.test(x.words)), 'no overlapping flood message reached the model');
        // Busy messages never reach the brain and do not consume its turn budget. Fill the remaining 18 accepted
        // turns sequentially: the first lookup and slow turn above have consumed two of the real 20-per-minute cap.
        for (let i = 0; i < 18; i++) {
          const next = tgCalls().length;
          await tgSay(`counted turn ${i}`);
          await sentAfter(next);
          await tgIdle();
        }
        const over = tgCalls().length, askedBeforeExcess = requests().length;
        for (let i = 0; i < 6; i++) await tgSay(`excess turn ${i}`);
        await sentAfter(over, 1, 'the one rate-limit line');
        await sleep(1000);
        const limited = tgSent(over).map(s => s.body.text);
        assert.deepEqual(limited, ['Too many messages. Wait a minute.']);
        assert.equal(requests().length, askedBeforeExcess, 'excess accepted-turn requests never reach the model');
      } finally { await F.stop(); F = null; }
    });

    test('Sparkie can say which build is running; sparkie_setup names it', async () => {
      const setup = (await call(look, 'sparkie_setup', {})).value;
      assert.equal(setup.console.build, (await api('/health')).json.build);
      assert.equal(typeof setup.console.lockIsForThisBuild, 'boolean');
      assert.match(T.fleet.logText(), new RegExp(`Spark Console API [0-9.]+, build ${setup.console.build}`));
    });

    test('source: Telegram\'s address only in the adapter, one sender, and the test switches only behind ALL_LOCAL', () => {
      const dir = join(REPO, 'service', 'src');
      for (const f of readdirSync(dir).filter(x => x.endsWith('.mjs'))) {
        const text = readFileSync(join(dir, f), 'utf8');
        if (f !== '21-telegram.mjs') assert.ok(!text.includes('api.telegram.org'), `${f} names Telegram's address`);
        if (f !== '21-telegram.mjs') assert.ok(!/\btgSend\(/.test(text) || f === '20-tell.mjs', `${f} sends to Telegram itself`);
        if (f !== '21-telegram.mjs') assert.ok(!/'sendMessage'/.test(text), `${f} calls sendMessage`);
      }
      const tgPart = readFileSync(join(dir, '21-telegram.mjs'), 'utf8'), sec = readFileSync(join(dir, '03-secrets.mjs'), 'utf8');
      assert.equal((tgPart.match(/tgSend\(/g) || []).length, 1, 'tgSend is defined there and called only by tell()');
      assert.match(tgPart, /const TG_API = ALL_LOCAL \? \(.*SPARK_CONSOLE_TELEGRAM_API.*\) : TG_HOST;/);
      assert.match(sec, /const SECRETS_FILE = ALL_LOCAL \? \(.*SPARK_CONSOLE_SECRETS_FILE/);
    });
  });
});
