// Covers: the paired owner's transport authority and exact delivery. Real source functions run against a stand-in
// sender: full multipart commands, acknowledgment before activation, retry/failure/re-pair, permission parity,
// private ingress proof, controls during a brain turn and one-time credentials that never enter chat or audit text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createHash, randomBytes } from 'node:crypto';
const read = name => readFileSync(new URL(`../service/src/${name}`, import.meta.url), 'utf8');
const keyDoor = read('20-keys.mjs'), changes = read('17-changes.mjs'), chats = read('14-chats.mjs');
const approval = read('20-tg-approve.mjs'), telling = read('20-tell.mjs'), telegram = read('21-telegram.mjs'), dangerous = read('20-danger.mjs'), actions = read('16-actions.mjs');
const take = (text, name, async = false) => { const line = text.match(new RegExp(`^${async ? 'async ' : ''}function ${name}\\(.*$`, 'm'))[0]; return line.endsWith('}') ? line : text.match(new RegExp(`^${async ? 'async ' : ''}function ${name}\\([^]*?^\\}`, 'm'))[0]; };
const proof = telegram.slice(telegram.indexOf('const TG_OWNER_PROOF'), telegram.indexOf('async function tgUpdate'));
const ownerFunctions = ['isOwnerCall', 'isOwnerButton', 'isOwnerPress'].map(name => take(actions, name)).join('\n');
const SECRET = 'new_secret_do_not_store', OWNER_ADMIN = '__owner_admin';
function harness() {
  let binding = { token: 'bot-token', chatId: 42, userId: 42, pairedAt: 'pair-one', approve: true };
  const state = { offset: 0, approvals: Array(100).fill(Date.now()) }, calls = [], audits = [], timers = [], conv = { id: 'sc_0123456789abcdef', login: 'owner', channel: 'telegram', messages: [] };
  class Refused extends Error { constructor(status, message) { super(message); this.status = status; } }
  const env = { createHash, randomBytes, OWNER_ADMIN, ALL_LOCAL: true, process: { env: {} }, console, Buffer,
    tgPaired: () => binding, tgBinding: () => binding, accessList: () => ({ owner: 'owner' }), ownerPermissions: () => ({}),
    tgPairingMark: (b = binding) => b ? createHash('sha256').update(`${b.chatId}:${b.userId}:${b.pairedAt || ''}`).digest('hex').slice(0, 16) : null,
    whoAsks: (viewer, ctx) => `${viewer.login}|conv|${ctx.conv}`, dangerForTest: () => null, savedShown: () => [], chatWhole: new WeakMap(), chatAsksWhole: new WeakMap(),
    pendingChoices: new Map(), chatData: () => ({ conversations: [conv] }), sparkieWho: (v, id) => `${v.login}|conv|${id}`,
    maskSecrets: text => String(text).split(SECRET).join('[hidden]'), tgSaved: () => state, tgSave: () => {}, tgSaveSoon: () => {}, saveChats: () => {},
    audit: entry => audits.push(entry), fleetEvent: entry => audits.push(entry), journal: (_, entry) => audits.push(entry), HttpError: Refused,
    tgSend: async (b, text, opts) => { calls.push({ chat: b.chatId, text, ...opts }); return env.send ? env.send(calls.length, b, text, opts) : true; },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return { unref() {} }; }, setInterval: () => ({ unref() {} }),
    dangerOpen: null, dangerRecent: null, dangerGoneIds: new Map(), dangerDeclined: new Map(), DANGER_MS: 900000, dangerJournal: () => {}, dangerBound: () => 'bound', dangerSha: () => 'same', dangerGone: () => null, dangerPressedHere: () => 'Type the digits.', dangerHeadOf: () => 'Owner change', dangerTelegramGone: () => {}, aheadEndAll: () => {},
    tg: { state: 'ok', strangers: 0, busy: false, pressing: false, inHits: [], toldTooMany: false }, replying: new Map(), LIMITS: { messages: 200 },
    TG_STALE_MS: 300000, TG_TOKEN_IN: /never-a-token/, TG_HELLO: 'Hello', tgKeys: async () => false, tgConv: () => conv,
    isOwnerAdminWord: text => text === '/admin', ownerAdminWord: async viewer => ({ reply: env.api.tgOwnerValid(viewer) ? 'Owner controls' : 'Bad proof' }),
    dangerTypedHere: () => null, ownerWord: () => null, tgCall: async () => {}, tgRanLine: () => 'Done.',
    runChoice: async () => ({ outcome: 'done' }),
  };
  const picked = ['tgUpdate', 'tgRun'].map(name => take(telegram, name, true)).join('\n') + '\n' + take(telegram, 'tgFollowUp');
  runInNewContext([proof, ownerFunctions, approval, telling, take(changes, 'question'), ...['sparkieMessageChoices', 'chatAsks', 'pressPost'].map(name => take(chats, name)), chats.match(/^const askShown = .*$/m)[0], take(dangerous, 'dangerTell', true), ...['dangerLive', 'dangerClose', 'dangerStopped', 'dangerTelegramGone'].map(name => take(dangerous, name)), take(dangerous, 'dangerPress', true), picked,
    'globalThis.api = { tgOwner, tgOwnerContext, tgOwnerContextValid, tgOwnerValid, question, chatAsks, pressPost, sparkieMessageChoices, tellReplyText, tellButtons, tgAskBinding, tgAskCurrent, tgAskDelivered, tgAskOpen, tgAsks, tgAsk, tgApproving, tgApprovalsHeld, tellParts, tellBlock, tellTry, tellAgain, tellOwnerSecret, dangerTell, dangerPress, dangerStopped, tgLock, tgFollowUp: globalThis.tgFollowUp, tgUpdate, tgRun, counters: () => ({ sends: tellSends, results: tellResults }) };',
  ].join('\n'), env);
  const choose = (args = { op: 'settings' }) => {
    const yes = { at: Date.now(), ownerOnly: true, group: 'group-one', action: OWNER_ADMIN, args, label: 'Apply exact owner change', question: 'Exact owner facts', who: `owner|conv|${conv.id}` };
    const no = { ...yes, action: null, args: null, label: 'No' };
    env.pendingChoices.set('aaaaaaaaaa', yes); env.pendingChoices.set('bbbbbbbbbb', no);
    return { yes, no, ids: ['aaaaaaaaaa', 'bbbbbbbbbb'], q: { group: yes.group, question: 'Exact owner facts', choices: [{ choice: 'aaaaaaaaaa', label: yes.label }, { choice: 'bbbbbbbbbb', label: no.label }] } };
  };
  return { env, api: env.api, state, calls, audits, timers, conv, choose, binding: () => binding, pair: value => { binding = value; } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(fn) { for (let n = 0; n < 50; n++) { if (fn()) return; await tick(); } assert.fail('the stand-in transport did not progress'); }

test('all command bytes reach Telegram in bounded Unicode-safe chunks, with no three-part truncation', async () => {
  const h = harness(), code = '  first\n' + '😀'.repeat(7000) + '\nlast  ';
  const parts = h.api.tellBlock('Exact facts', code, 'Type 42 after pressing Yes');
  assert.ok(parts.length > 3); assert.ok(parts.every(x => (x.text ?? x).length <= 4000));
  assert.equal(parts.filter(x => x.entities).map(x => x.text).join(''), code);
  assert.ok(parts.every(x => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(x.text ?? x)));
  assert.equal(h.api.tellParts(code).join(''), code);
});

test('a confirmation is inactive until every part is acknowledged and stays bound to the exact arguments', async () => {
  const h = harness(), c = h.choose(); const sent = h.api.tgAskBinding(c.ids, c.yes.group, h.conv.id);
  let last; h.env.send = (_, __, ___, opts) => opts.buttons ? new Promise(resolve => { last = resolve; }) : true;
  const work = h.api.tellTry('ask', 'facts\n'.repeat(3000), { buttons: [{ id: c.ids[0], label: 'Yes' }], isCurrent: () => h.api.tgAskCurrent(sent), onSent: () => h.api.tgAskDelivered(sent) });
  await until(() => Boolean(last)); assert.equal(h.api.tgAskOpen(c.ids[0], c.yes), false);
  assert.match(h.api.tgApproving(c.ids[0]).answer, /still being sent/);
  last(true); assert.equal(await work, 'sent'); assert.equal(h.api.tgAskOpen(c.ids[0], c.yes), true);
  c.yes.args.op = 'agent_remove'; assert.equal(h.api.tgAskOpen(c.ids[0], c.yes), false, 'changed payload never inherits the old confirmation');
});

test('partial failure stops before buttons; existing retry activates only after the whole exact ask succeeds', async () => {
  const h = harness(), c = h.choose(); let failing = true;
  h.env.send = n => failing && n === 2 ? 'unreachable' : true;
  assert.equal(h.api.tgAsk({ login: 'owner', role: 'owner' }, { conv: h.conv.id }, c.q, 'long exact facts\n'.repeat(1000)), true);
  await until(() => h.timers.length > 0); assert.equal(h.calls.length, 2); assert.ok(h.calls.every(x => !x.buttons)); assert.equal(h.api.tgAskOpen(c.ids[0], c.yes), false);
  failing = false; await h.timers.shift().fn();
  assert.equal(h.api.tgAskOpen(c.ids[0], c.yes), true); assert.ok(h.calls.at(-1).buttons);
});

test('re-pair between parts stops delivery and never activates or reroutes the old ask', async () => {
  const h = harness(), c = h.choose(); h.env.send = () => { h.pair({ ...h.binding(), chatId: 99, userId: 99, pairedAt: 'pair-two' }); return true; };
  h.api.tgAsk({ login: 'owner', role: 'owner' }, { conv: h.conv.id }, c.q, 'exact long facts\n'.repeat(1000));
  await until(() => h.calls.length > 0); await tick();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].chat, 42); assert.equal(h.api.tgAskOpen(c.ids[0], c.yes), false); assert.equal(h.api.tgAsks.size, 0);
});

test('approval and result history never imposes a different permission cap on the paired owner', async () => {
  const h = harness(), c = h.choose(); h.api.counters().results.push(...Array(100).fill(Date.now())); h.api.counters().sends.push(...Array(100).fill(Date.now()));
  const sent = h.api.tgAskBinding(c.ids, c.yes.group, h.conv.id); h.api.tgAskDelivered(sent);
  assert.equal(h.api.tgApprovalsHeld(), null); assert.equal(h.api.tgApproving(c.ids[0]).c, c.yes);
  assert.equal(await h.api.tellTry('result', 'The operation finished.'), 'sent');
});

test('who-approves and long dangerous asks carry the full command; while locked only an exact approvals-on ask can be confirmed', async () => {
  const h = harness(), c = h.choose({ op: 'telegram_approvals', on: true }); h.binding().approve = false;
  const a = { yes: c.ids[0], no: c.ids[1], group: c.yes.group, conv: h.conv.id, taken: false, lines: ['Changes who may approve'], code: '  exact\n'.repeat(2500), yesWords: 'Run it', digits: '42', whoApproves: true };
  h.env.dangerOpen = a; assert.equal(await h.api.dangerTell(a), true);
  assert.equal(h.calls.filter(x => x.entities).map(x => x.text).join(''), a.code); assert.equal(h.api.tgAskOpen(c.ids[0], c.yes), true);
  h.env.pendingChoices.delete(c.ids[0]); assert.equal(h.api.tgAskOpen(c.ids[0], c.yes), false);
  const other = h.choose({ op: 'agent_remove', id: 'unrelated' }); assert.equal(h.api.tgAskBinding(other.ids, other.yes.group, h.conv.id), null);
});

test('owner proof cannot come from channel strings or JSON and expires with its exact pairing', () => {
  const h = harness(), viewer = h.api.tgOwner(); const ctx = h.api.tgOwnerContext({ via: 'telegram', channel: 'telegram' }, viewer);
  assert.equal(h.api.tgOwnerContextValid(ctx), true); assert.equal(h.api.tgOwnerContextValid({ via: 'telegram', channel: 'telegram', from: 'telegram:42' }), false);
  assert.equal(h.api.tgOwnerContextValid(h.api.tgOwnerContext({ via: 'telegram' }, JSON.parse(JSON.stringify(viewer)))), false);
  assert.equal(h.api.tgOwnerContextValid({ ...ctx, agentId: 'agent' }), false); assert.equal(h.api.tgOwnerContextValid({ ...ctx, via: 'api', channel: undefined }), false);
  h.pair({ ...h.binding(), pairedAt: 'pair-two' }); assert.equal(h.api.tgOwnerContextValid(ctx), false); assert.equal(h.api.tgOwnerValid(viewer), false);
});

test('an ingress update cannot launder its identity after a pairing change during the key door await', async () => {
  const h = harness(); let turns = 0;
  h.env.tgKeys = async () => { h.pair({ ...h.binding(), userId: 99, chatId: 99, pairedAt: 'pair-two' }); return false; };
  h.env.tgTurn = async () => { turns++; };
  await h.api.tgUpdate({ update_id: 1, message: { message_id: 1, date: Math.floor(Date.now() / 1000), chat: { id: 42, type: 'private' }, from: { id: 42, is_bot: false }, text: '/admin' } });
  assert.equal(turns, 0); assert.equal(h.calls.length, 0); assert.equal(h.conv.messages.length, 0);
});

test('owner controls bypass brain-only flood/busy limits and owner confirmations work while the brain is answering', async () => {
  const h = harness(); h.env.tg.busy = true; h.env.tg.inHits = Array(20).fill(Date.now());
  await h.api.tgUpdate({ update_id: 1, message: { message_id: 1, date: Math.floor(Date.now() / 1000), chat: { id: 42, type: 'private' }, from: { id: 42, is_bot: false }, text: '/admin' } });
  assert.equal(h.calls.at(-1).text, 'Owner controls');
  const c = h.choose(), viewer = h.api.tgOwner(); let ran = 0; h.env.runChoice = async () => { ran++; return { outcome: 'done' }; };
  await h.api.tgRun(h.conv, c.ids[0], { c: c.yes, conv: h.conv }, viewer);
  assert.equal(ran, 1); assert.equal(h.env.tg.busy, true); assert.equal(h.env.tg.pressing, false);
});

test('new credentials bypass masking only for a proved owner press and never enter chat, audit text or retry records', async () => {
  const h = harness(), viewer = h.api.tgOwner(), ctx = h.api.tgOwnerContext({ via: 'telegram', channel: 'telegram', button: true, trusted: true, ownerConfirmed: true }, viewer);
  await assert.rejects(h.api.tellOwnerSecret(SECRET, { ...ctx, ownerConfirmed: false }), /confirmed/);
  assert.equal(await h.api.tellOwnerSecret(SECRET, ctx), true); assert.equal(h.calls.at(-1).text, SECRET);
  assert.doesNotMatch(JSON.stringify(h.audits), new RegExp(SECRET)); assert.equal(h.conv.messages.length, 0); assert.equal(h.timers.length, 0);
  await h.api.tellTry('system', SECRET, { secret: true }); assert.equal(h.calls.at(-1).text, '[hidden]', 'a public option cannot forge the private secret path');
  h.pair({ ...h.binding(), pairedAt: 'pair-two' }); await assert.rejects(h.api.tellOwnerSecret(SECRET, ctx), /confirmed/);
});

test('legacy disabled approvals stay off until an exact fresh owner unlock confirmation', () => {
  const h = harness(); delete h.binding().approve; const c = h.choose();
  assert.equal(h.api.tgAskBinding(c.ids, c.yes.group, h.conv.id), null);
  const unlock = h.choose({ op: 'telegram_approvals', on: true }); assert.ok(h.api.tgAskBinding(unlock.ids, unlock.yes.group, h.conv.id));
});

test('the delivered fingerprint binds go-ahead grants as well as ordinary action arguments', () => {
  const h = harness(), c = h.choose(); c.yes.ahead = { spark: 'spark3', under: '~/one' };
  const sent = h.api.tgAskBinding(c.ids, c.yes.group, h.conv.id); h.api.tgAskDelivered(sent); assert.equal(h.api.tgAskOpen(c.ids[0], c.yes), true);
  c.yes.ahead.under = '~/other'; assert.equal(h.api.tgAskOpen(c.ids[0], c.yes), false);
});

test('lock or stop during an awaited danger recheck revokes execution; the unchanged confirmation still succeeds', async () => {
  for (const revoke of ['lock', 'stop', 'none']) {
    const h = harness(), c = h.choose(); let release, started = false;
    h.env.secretsWrite = change => h.pair(change({ telegram: h.binding() }).telegram);
    const a = { id: 'ask', yes: c.ids[0], no: c.ids[1], group: c.yes.group, conv: h.conv.id, taken: false, opensAt: Date.now() - 1, pressedAt: Date.now(), pairOk: true, sha: 'bound', bytesSha: 'same', recheck: () => { started = true; return new Promise(resolve => { release = resolve; }); } };
    h.env.dangerOpen = a; a.telegram = h.api.tgAskBinding(c.ids, c.yes.group, h.conv.id); h.api.tgAskDelivered(a.telegram);
    const work = h.api.dangerPress(c.ids[0], c.yes, { via: 'telegram' }); await until(() => started);
    if (revoke === 'lock') h.api.tgLock(); else if (revoke === 'stop') assert.equal(h.api.dangerStopped(h.conv), true);
    release('same');
    if (revoke === 'none') { await work; assert.equal(a.closed, 'answered'); }
    else { await assert.rejects(work, /stopped, locked or expired/); assert.notEqual(a.closed, 'answered'); }
  }
});

test('an agent can ask but cannot answer; only the actual paired owner gains the delivered one-use choice', async () => {
  const h = harness(), c = h.choose(); h.conv.agent = { name: 'Read-only helper' }; let runs = 0;
  h.env.runChoice = async () => { runs++; h.env.pendingChoices.delete(c.ids[0]); h.env.pendingChoices.delete(c.ids[1]); return { outcome: 'done' }; };
  h.api.tgAsk({ login: 'owner', role: 'owner', agentKey: true }, { conv: h.conv.id, agent: true }, c.q);
  await until(() => h.api.tgAskOpen(c.ids[0], c.yes)); assert.match(h.calls[0].text, /Read-only helper.*asked/); assert.match(h.calls[0].text, /Only your confirmation runs it/);
  await h.api.tgRun(h.conv, c.ids[0], { c: c.yes, conv: h.conv }, { login: 'owner', role: 'owner', agentKey: true }); assert.equal(runs, 0);
  const approved = h.api.tgApproving(c.ids[0]); await h.api.tgRun(approved.conv, c.ids[0], approved, h.api.tgOwner());
  assert.equal(runs, 1); assert.match(h.api.tgApproving(c.ids[0]).answer, /expired/);
});

test('a page-origin plain follow-up is delivered and bound before its Telegram callback can resolve', async () => {
  const h = harness(), c = h.choose(); h.conv.channel = undefined; c.yes.ownerOnly = false; c.no.ownerOnly = false;
  const message = { content: 'Choose the exact next step', choices: c.ids.map((id, i) => ({ id, group: c.yes.group, state: 'open', label: i ? 'No' : 'Continue' })) };
  const follow = h.api.tgFollowUp(h.conv, message); assert.equal(follow.buttons.length, 2); assert.doesNotMatch(follow.text, /Spark Console/);
  assert.equal(await h.api.tellTry('reply', follow.text, { buttons: follow.buttons }), 'sent');
  assert.equal(h.api.tgAskOpen(c.ids[0], c.yes), true); assert.equal(h.api.tgApproving(c.ids[0]).conv.id, h.conv.id);
});


function keyDoorHarness() {
  let binding = { token: 'bot-token', chatId: 42, userId: 42, pairedAt: 'pair-one' };
  const original = { id: 'original-chat' }, next = { id: 'new-pair-chat' }, saves = [], replies = [], deletes = [], conversations = [];
  const env = {
    tgPaired: () => binding, tgPairingMark: (b = binding) => b ? `${b.chatId}:${b.userId}:${b.pairedAt}` : null,
    accessList: () => ({ owner: 'owner' }), ownerPermissions: () => ({}), keysGiven: text => text.startsWith('/key ') ? { name: 'HF_TOKEN', value: SECRET } : null,
    tgConv: () => { const conv = binding.chatId === 42 ? original : next; conversations.push(conv); return conv; },
    tgCall: async (token, method, args) => { deletes.push({ token, method, args }); if (env.onDelete) await env.onDelete(); },
    giveKey: async (conv, given, via, channel, after) => { saves.push({ conv, given, via, channel, after }); if (env.onSave) await env.onSave(); return { content: 'Kept your key.' }; },
    tell: async (why, text, opts) => { if (!opts.isCurrent()) return false; replies.push({ chat: binding.chatId, why, text }); return true; },
  };
  runInNewContext([proof, take(keyDoor, 'tgKeys', true), 'globalThis.api = { tgOwner, tgKeys };'].join('\n'), env);
  return { env, api: env.api, original, next, saves, replies, deletes, conversations, rePair: () => { binding = { ...binding, chatId: 99, userId: 99, pairedAt: 'pair-two' }; } };
}
const keyMessage = () => ({ message_id: 7, text: `/key HF_TOKEN ${SECRET}` });

test('a re-pair during key-message deletion saves no key and never replies to or uses the new chat', async () => {
  const h = keyDoorHarness(); h.env.onDelete = async () => h.rePair();
  assert.equal(await h.api.tgKeys(keyMessage(), h.api.tgOwner()), true);
  assert.equal(h.deletes.length, 1); assert.equal(h.deletes[0].args.chat_id, 42);
  assert.equal(h.saves.length, 0); assert.equal(h.replies.length, 0);
  assert.equal(h.conversations.length, 1); assert.equal(h.conversations[0], h.original);
});

test('an unchanged owner pairing saves its key in the captured chat and gets the fixed reply', async () => {
  const h = keyDoorHarness();
  assert.equal(await h.api.tgKeys(keyMessage(), h.api.tgOwner()), true);
  assert.equal(h.saves.length, 1); assert.equal(h.saves[0].conv, h.original);
  assert.equal(h.saves[0].given.value, SECRET); assert.match(h.saves[0].after, /was deleted/);
  assert.equal(h.replies.length, 1); assert.equal(h.replies[0].chat, 42); assert.equal(h.replies[0].text, 'Kept your key.');
});

test('a key save already started stays in its original chat and cannot reply into a replacement pairing', async () => {
  const h = keyDoorHarness(); h.env.onSave = async () => h.rePair();
  assert.equal(await h.api.tgKeys(keyMessage(), h.api.tgOwner()), true);
  assert.equal(h.saves.length, 1); assert.equal(h.saves[0].conv, h.original);
  assert.equal(h.conversations.length, 1); assert.equal(h.replies.length, 0);
});

test('a forwarded key stays outside the key-save door and an old proof cannot open it', async () => {
  const h = keyDoorHarness(), viewer = h.api.tgOwner();
  assert.equal(await h.api.tgKeys({ ...keyMessage(), forward_origin: { type: 'user' } }, viewer), false);
  h.rePair(); assert.equal(await h.api.tgKeys(keyMessage(), viewer), true);
  assert.equal(h.saves.length, 0); assert.equal(h.deletes.length, 0); assert.equal(h.replies.length, 0); assert.equal(h.conversations.length, 0);
});


function plainQuestion(h, text, label, { ownerOnly = false, kind = 'question' } = {}) {
  let q; const viewer = h.api.tgOwner();
  const ctx = h.api.tgOwnerContext({ via: 'sparkie', channel: 'telegram', conv: h.conv.id, noTelegramQuestion: true, onQuestion: value => { q = value; } }, viewer);
  h.api.question(viewer, ctx, text, [{ label, call: { action: 'keep_running', args: { spark: 'spark4', container: 'exact-app' } } }, { label: 'No', call: null }], kind, { ownerOnly });
  return q;
}
const questionMessage = (h, q, content = 'A short model summary.') => ({ content, choices: h.api.sparkieMessageChoices(q) });

test('full server questions and choice labels survive the old 8000-character cut and are masked through multipart delivery', async () => {
  const h = harness(), facts = 'Code-built facts: ' + 'f'.repeat(9000) + SECRET, label = 'Start exactly this: ' + 'x'.repeat(4500);
  const q = plainQuestion(h, facts, label, { kind: 'proposal' }), message = questionMessage(h, q);
  h.api.chatAsks([q], message);
  assert.ok(message.asks[0].text.length > 8000); assert.ok(message.asks[0].text.includes('[hidden]')); assert.ok(!message.asks[0].text.includes(SECRET));
  const text = h.api.tellReplyText(message), buttons = h.api.tellButtons(message);
  assert.equal(await h.api.tellTry('reply', text, { buttons }), 'sent');
  const sent = h.calls.map(x => x.text).join('');
  assert.ok(sent.includes(facts.replace(SECRET, '[hidden]'))); assert.ok(sent.includes(label)); assert.ok(!sent.includes(SECRET));
  assert.ok(h.calls.length > 3); assert.ok(h.calls.slice(0, -1).every(x => !x.buttons)); assert.ok(h.calls.at(-1).buttons);
  assert.equal(h.api.tgAskOpen(q.choices[0].choice, h.env.pendingChoices.get(q.choices[0].choice)), true);
});

test('a ninth plain group keeps its full facts after eight owner-only groups use the page ask limit', () => {
  const h = harness(), asks = [];
  for (let n = 0; n < 8; n++) asks.push(plainQuestion(h, `OWNER_PRIVATE_${n}`, `Owner choice ${n}`, { ownerOnly: true }));
  const facts = 'NINTH_FULL_FACTS_' + 'n'.repeat(9000), ninth = plainQuestion(h, facts, 'The exact ninth choice'); asks.push(ninth);
  const message = { content: 'The owner asks were sent separately.', choices: asks.flatMap(q => h.api.sparkieMessageChoices(q)) };
  h.api.chatAsks(asks, message);
  assert.equal(message.asks.length, 8, 'the existing page count stays bounded');
  assert.ok(!message.asks.some(a => a.group === ninth.group), 'the transport cannot rely on the bounded page copy');
  const text = h.api.tellReplyText(message), buttons = h.api.tellButtons(message);
  assert.ok(text.includes(facts)); assert.ok(text.includes('The exact ninth choice'));
  assert.equal(buttons.length, 2); assert.equal(buttons[0].id, ninth.choices[0].choice); assert.doesNotMatch(text, /OWNER_PRIVATE_/);
});

test('a real pressPost follow-up sends full canonical facts; a partial send cannot activate or rebind changed facts', async () => {
  const h = harness(), facts = 'Follow-up facts: ' + 'c'.repeat(9000), q = plainQuestion(h, facts, 'Apply this exact next step');
  const message = h.api.pressPost(h.conv, 'A model summary without the facts.', q);
  assert.equal(message.asks, undefined, 'pressPost does not carry a page ask copy');
  const follow = h.api.tgFollowUp({ id: h.conv.id }, message); assert.ok(follow.text.includes(facts));
  h.env.send = n => n === 2 ? 'unreachable' : true;
  assert.equal(await h.api.tellTry('reply', follow.text, { buttons: follow.buttons }), 'later');
  const id = q.choices[0].choice, choice = h.env.pendingChoices.get(id);
  assert.equal(h.api.tgAskOpen(id, choice), false); assert.ok(h.calls.every(x => !x.buttons));
  const before = h.calls.length; choice.question += ' CHANGED_AFTER_PARTIAL_SEND';
  assert.equal(await h.api.tellTry('reply', follow.text, { buttons: follow.buttons }), 'never');
  assert.equal(h.calls.length, before, 'old text never acquires a new binding for changed facts'); assert.equal(h.api.tgAskOpen(id, choice), false);
});

test('an unchanged ordinary retry becomes usable only after the final full-facts acknowledgment', async () => {
  const h = harness(), q = plainQuestion(h, 'Complete facts: ' + 'z'.repeat(9000), 'Apply this exact retry'), message = questionMessage(h, q);
  const text = h.api.tellReplyText(message), buttons = h.api.tellButtons(message), id = q.choices[0].choice, choice = h.env.pendingChoices.get(id);
  h.env.send = n => n === 2 ? 'unreachable' : true;
  assert.equal(await h.api.tellTry('reply', text, { buttons }), 'later'); assert.equal(h.api.tgAskOpen(id, choice), false);
  let acknowledge; h.env.send = (_, __, ___, opts) => opts.buttons ? new Promise(resolve => { acknowledge = resolve; }) : true;
  const retry = h.api.tellTry('reply', text, { buttons }); await until(() => Boolean(acknowledge));
  assert.equal(h.api.tgAskOpen(id, choice), false); acknowledge(true); assert.equal(await retry, 'sent'); assert.equal(h.api.tgAskOpen(id, choice), true);
});

test('separate owner and dangerous asks are not repeated; a choice missing its canonical question gets no button', async () => {
  const h = harness(), q = plainQuestion(h, 'SEPARATELY_DELIVERED_OWNER_FACTS', 'Owner approval', { ownerOnly: true });
  h.api.tgAsk(h.api.tgOwner(), { conv: h.conv.id }, q);
  await until(() => h.api.tgAskOpen(q.choices[0].choice, h.env.pendingChoices.get(q.choices[0].choice)));
  const message = questionMessage(h, q, 'Your owner confirmation was sent separately.'), before = h.calls.length;
  assert.equal(h.api.tellReplyText(message), message.content); assert.equal(h.api.tellButtons(message).length, 0); assert.equal(h.calls.length, before);
  for (const x of q.choices) h.env.pendingChoices.get(x.choice).danger = 'danger';
  assert.equal(h.api.tellReplyText(message), message.content); assert.equal(h.api.tellButtons(message).length, 0);
  const ordinary = plainQuestion(h, 'Full question required', 'Never activate without it'), m = questionMessage(h, ordinary);
  for (const x of ordinary.choices) delete h.env.pendingChoices.get(x.choice).question;
  assert.equal(h.api.tellButtons(m).length, 0); assert.match(h.api.tellReplyText(m), /no complete question/);
});
