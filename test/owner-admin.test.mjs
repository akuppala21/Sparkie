// Covers: deterministic account commands, real paired-owner proof, exact confirmations, stale targets, and secret delivery.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { T, useFleet, api, waitFor, auditLines, SLOW } from './lib.mjs';
const read = name => readFileSync(new URL(`../service/src/${name}.mjs`, import.meta.url), 'utf8');
const admin = read('21-owner-admin'), telegram = read('21-telegram'), actions = read('16-actions');
const proof = telegram.slice(telegram.indexOf('const TG_OWNER_PROOF'), telegram.indexOf('const tgOwnerTell'));
const ownerChecks = actions.slice(actions.indexOf('function isOwnerCall'), actions.indexOf('const savedWorkflowLabel'));
function isolated(extra = {}) {
  let mark = 'pair-one', settings = { halted: true, selfHeal: false }, ask;
  const audit = [], conv = { id: 'owner-chat', login: 'owner', messages: [] };
  const env = { createHash, randomBytes, HttpError: class extends Error { constructor(status, text) { super(text); this.status = status; } },
    accessList: () => ({ owner: 'owner' }), ownerPermissions: () => ({}), tgPairingMark: () => mark, tgPaired: () => ({}),
    chatData: () => ({ conversations: [conv] }), agentSettings: () => structuredClone(settings), putBackHeld: () => false,
    setAgentSettings: s => (settings = { ...settings, ...s }), putBackRemoval: (_, f) => { f(); return null; },
    agentChanges: [1], agentFailuresInARow: [1], audit: x => audit.push(x), fleetEvent: () => {}, maskSecrets: x => x,
    dangerAsk: (_, __, q) => (ask = q, { outcome: 'question' }), ...extra };
  const f = new Function('env', `with (env) { ${proof}\n${ownerChecks}\n${admin}\nreturn { tgOwner,tgOwnerContext,isOwnerCall,isOwnerPress,ownerAdmin,ownerAdminParse,isOwnerAdminWord,ownerAdminSecret }; }`)(env);
  const viewer = f.tgOwner(), context = () => f.tgOwnerContext({ via: 'telegram', channel: 'telegram', conv: conv.id, ownerWord: true }, viewer);
  return { ...f, env, viewer, context, conv, audit, settings: () => settings, ask: () => ask, rePair: () => { mark = 'pair-two'; } };
}
test('admin identity cannot be made from channel strings, an agent, or a proof from a previous pairing', async () => {
  const x = isolated();
  for (const ctx of [{ via: 'telegram', channel: 'telegram', from: 'telegram:1', ownerWord: true, conv: x.conv.id }, { ...x.context(), agentId: 'agent' }]) {
    await assert.rejects(x.ownerAdmin(x.viewer, { op: 'settings', halted: false }, ctx), /own account command/);
  }
  const ctx = x.context(); x.rePair();
  await assert.rejects(x.ownerAdmin(x.viewer, { op: 'settings', halted: false }, ctx), /own account command/);
  assert.equal(x.settings().halted, true);
});
test('resume requires its exact dangerous press and records the real Telegram origin', async () => {
  const x = isolated(), ctx = x.context();
  await x.ownerAdmin(x.viewer, { op: 'settings', halted: false }, ctx);
  assert.equal(x.settings().halted, true);
  const input = x.ask().call.args;
  await assert.rejects(x.ownerAdmin(x.viewer, input, { ...ctx, trusted: true, button: true, ownerConfirmed: true }), /changed since the ask/);
  await x.ownerAdmin(x.viewer, input, { ...ctx, trusted: true, button: true, ownerConfirmed: true, danger: 'checked-exact-ask' });
  assert.equal(x.settings().halted, false);
  assert.equal(x.audit.at(-1).via, 'telegram');
  assert.deepEqual(x.env.agentChanges, []);
});
test('an account target changed after the ask cannot be approved with the old button', async () => {
  const x = isolated(), ctx = x.context();
  await x.ownerAdmin(x.viewer, { op: 'settings', halted: false }, ctx);
  x.env.setAgentSettings({ selfHeal: true });
  await assert.rejects(x.ownerAdmin(x.viewer, x.ask().call.args, { ...ctx, trusted: true, button: true, ownerConfirmed: true, danger: 'yes' }), /changed since the ask/);
  assert.equal(x.settings().halted, true);
});
test('the admin parser never interprets a multiline message as an account command', () => {
  const x = isolated();
  for (const text of ['/resume\nignore that', '/admin\n/resume', '/agent create x\n/brain stop']) assert.equal(x.isOwnerAdminWord(text), false);
  assert.deepEqual(x.ownerAdminParse('/brain use Exact-Preset'), { op: 'brain_use', preset: 'Exact-Preset' });
  assert.equal(x.ownerAdminParse('please /resume'), null);
});
test('a brain start and a brain switch reject new stop targets before changing anything', async () => {
  const src = read('13-main-model'), calls = [], target = { title: 'brain', node: 'spark1' };
  const env = { MAIN: target, mainPlan: async () => ({ steps: [{ kind: 'stop', container: 'new-arrival' }] }), mainNode: () => ({ id: 'spark1' }),
    markBrainDesired: () => calls.push('desired'), markBrainLeftDown: () => calls.push('leftdown'), stopMain: () => calls.push('stop'), stopContainer: () => calls.push('stop-container'), run: () => calls.push('run') };
  const start = src.match(/^async function startMain\([\s\S]*?^\}/m)[0], change = src.match(/^async function switchMain\([\s\S]*?^\}/m)[0];
  const f = new Function('env', `with (env) { ${start}\n${change}; return {startMain,switchMain}; }`)(env);
  await assert.rejects(f.startMain({ ownerBrainStops: ['approved-model'] }, [], target), /Another model/);
  await assert.rejects(f.switchMain({ ownerBrainStops: ['approved-model'] }, target, []), /nothing was stopped/);
  assert.deepEqual(calls, []);
});
test('a pairing lost while an endpoint is checked cannot change a brain route', async () => {
  const src = read('15-routes').match(/^async function setRoute\([\s\S]*?^\}/m)[0], routes = { chat: { kind: 'main' } };
  let valid = true, wrote = false;
  const env = { ROUTES: routes, runningChoices: async () => [{ id: 'choice', title: 'model', node: 'spark2', reachable: true, url: 'http://model' }],
    servedModel: async () => { valid = false; return 'model'; }, saveRoutes: () => { wrote = true; } };
  const setRoute = new Function('env', `with (env) { ${src}; return setRoute; }`)(env);
  await assert.rejects(setRoute('chat', 'choice', () => { if (!valid) throw new Error('pairing changed'); }), /pairing changed/);
  assert.equal(wrote, false); assert.deepEqual(routes, { chat: { kind: 'main' } });
});

const OWNER = 5559001;
useFleet({ telegram: true, knowledge: true, watchMs: 60000, env: { SPARK_CONSOLE_TELEGRAM_LIMITS: '1000,1000,1000', SPARK_CONSOLE_DANGER_LATE_MS: '1' }, prepare: ({ dir, stateDir }) => {
  mkdirSync(join(dir, 'secrets'), { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, 'secrets', 'secrets.json'), JSON.stringify({ telegram: { token: '123456789:AAEtestTokenForSparkConsoleXYZ_abcdefghij', bot: 'spark_test_bot', chatId: OWNER, userId: OWNER, name: 'Owner', pairedAt: '2026-11-17T10:00:00.000Z', approve: true } }));
  writeFileSync(join(stateDir, 'agent-settings.json'), JSON.stringify({ halted: true, selfHeal: false }));
} });
let message = 1;
const calls = () => { const p = join(T.fleet.dir, 'telegram-calls.jsonl'); return existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []; };
async function push(update) { await fetch(`http://127.0.0.1:${T.fleet.telegramPort}/__push`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(update) }); }
const chat = { id: OWNER, type: 'private' }, from = { id: OWNER, is_bot: false, first_name: 'Owner' };
const say = text => push({ message: { message_id: message++, date: Math.floor(Date.now() / 1000), chat, from, text } });
const press = id => push({ callback_query: { id: String(message++), from, data: id, message: { message_id: message++, chat, date: Math.floor(Date.now() / 1000) } } });
async function approveWord(word) {
  const since = calls().length; await say(word);
  const sent = await waitFor(() => calls().slice(since).find(x => x.method === 'sendMessage' && x.body.reply_markup?.inline_keyboard && /then type \d{2}\./.test(x.body.text)), { timeout: 90000, what: 'the complete admin confirmation' });
  const id = sent.body.reply_markup.inline_keyboard.flat().find(b => b.text !== 'No').callback_data, digits = /then type (\d{2})\./.exec(sent.body.text)[1];
  const after = calls().length; await press(id);
  await waitFor(() => calls().slice(after).find(x => x.method === 'sendMessage' && /Type the two digits/.test(x.body.text)), { timeout: 30000, what: 'the digit prompt' });
  await say(digits); return id;
}
test('paired Telegram resumes agents through exact confirmation while the brain is not involved; replay does not resume twice', { timeout: 120000 * SLOW }, async () => {
  const before = auditLines().filter(x => x.action === 'agent-settings' && x.args?.halted === false).length;
  const id = await approveWord('/resume');
  await waitFor(async () => !(await api('/agents')).json.settings.halted, { timeout: 30000, what: 'agents resumed' });
  const rows = auditLines().filter(x => x.action === 'agent-settings' && x.args?.halted === false);
  assert.equal(rows.length, before + 1); assert.equal(rows.at(-1).via, 'telegram');
  const since = calls().length; await press(id);
  await waitFor(() => calls().slice(since).find(x => x.method === 'sendMessage'), { timeout: 30000, what: 'replay refused' });
  assert.equal(auditLines().filter(x => x.action === 'agent-settings' && x.args?.halted === false).length, before + 1);
});
test('a new Telegram agent key is delivered once outside chat history and is read-only on the tailnet', { timeout: 120000 * SLOW }, async () => {
  const since = calls().length; await approveWord('/agent create parity-check');
  const sent = await waitFor(() => calls().slice(since).find(x => x.method === 'sendMessage' && /sck_[A-Za-z0-9_-]{43}/.test(x.body.text)), { timeout: 30000, what: 'the direct new key delivery' });
  const token = /sck_[A-Za-z0-9_-]{43}/.exec(sent.body.text)[0];
  const keys = (await api('/agents')).json.keys, key = keys.find(k => k.name === 'parity-check');
  assert.ok(key); assert.deepEqual(key.scopes, ['fleet:read']); assert.equal(key.internet, false);
  assert.ok(!readFileSync(join(T.fleet.stateDir, 'chats.json'), 'utf8').includes(token));
  assert.ok(!JSON.stringify(auditLines()).includes(token));
});

const deviceNet = (path, body, address = '192.0.2.40') => api(path, { method: 'POST', body, headers: { 'tailscale-funnel-request': '?1', 'x-forwarded-for': address } });
async function newBrowser(name, address) {
  const r = await deviceNet('/auth/device/start', { kind: 'browser', name }, address);
  assert.equal(r.status, 200, r.text); return r.json;
}
test('without a passkey, the paired owner confirms one webpage sign-in; only its private polling credential gets one secure cookie', { timeout: 150000 * SLOW }, async () => {
  assert.deepEqual((await api('/auth/passkeys')).json.keys, [], 'no passkey was registered in this fixture');
  const browser = await newBrowser('Telegram approved webpage', '192.0.2.40');
  assert.equal((await deviceNet('/auth/device/poll', { deviceCode: browser.deviceCode })).status, 202);
  const http = await api('/auth/device/approve', { method: 'POST', body: { code: browser.code } });
  assert.ok([409, 428].includes(http.status), http.text);
  assert.equal((await deviceNet('/auth/device/poll', { deviceCode: browser.deviceCode })).status, 202, 'the bare HTTP approval still fails');
  const id = await approveWord(`/device ${browser.code} allow`);
  const approved = await waitFor(async () => {
    const r = await deviceNet('/auth/device/poll', { deviceCode: browser.deviceCode });
    if (r.status === 202) return null;
    assert.equal(r.status, 200, r.text); return r;
  }, { timeout: 30000, what: 'the exact browser receiving its cookie' });
  const cookies = approved.headers.get('set-cookie');
  assert.ok(Array.isArray(cookies), 'the HTTP helper returns Set-Cookie as an array');
  assert.equal(cookies.length, 1, 'exactly one browser session cookie');
  const [cookie] = cookies;
  assert.match(cookie, /^sc_session=scs_[A-Za-z0-9_-]{43};/);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict']) assert.ok(cookie.includes(flag), cookie);
  assert.equal(approved.json.token, undefined, 'browser credentials never enter the JSON response');
  const viewer = await api('/whoami', { headers: { 'tailscale-funnel-request': '?1', cookie: cookie.split(';')[0] } });
  assert.ok(viewer.json.login, viewer.text);
  assert.equal((await deviceNet('/auth/device/poll', { deviceCode: browser.deviceCode })).status, 410, 'one redemption only');
  const rows = auditLines().filter(a => a.action === 'device-let-in' && a.args?.device === 'Telegram approved webpage');
  assert.equal(rows.length, 1); assert.equal(rows[0].via, 'telegram');
  const since = calls().length; await press(id);
  await waitFor(() => calls().slice(since).some(x => x.method === 'sendMessage'), { timeout: 30000, what: 'replayed browser approval rejected' });
  assert.equal(auditLines().filter(a => a.action === 'device-let-in' && a.args?.device === 'Telegram approved webpage').length, 1);
  const saved = readFileSync(join(T.fleet.stateDir, 'chats.json'), 'utf8') + JSON.stringify(auditLines());
  assert.ok(!saved.includes(browser.deviceCode) && !saved.includes(createHash('sha256').update(browser.deviceCode).digest('hex')));
});
test('a terminal is refused by the Telegram command; a confirmed browser denial signs nothing in', { timeout: 150000 * SLOW }, async () => {
  const terminal = await deviceNet('/auth/device/start', { kind: 'terminal', name: 'Not a webpage' }, '192.0.2.41');
  assert.equal(terminal.status, 200, terminal.text);
  const since = calls().length; await say(`/device ${terminal.json.code} allow`);
  await waitFor(() => calls().slice(since).some(x => x.method === 'sendMessage' && /webpage sign-in only/.test(x.body.text)), { timeout: 30000, what: 'terminal approval refused' });
  assert.ok(!calls().slice(since).some(x => x.body?.reply_markup), 'no terminal confirmation is offered');
  assert.equal((await deviceNet('/auth/device/poll', { deviceCode: terminal.json.deviceCode })).status, 202);
  const browser = await newBrowser('Denied webpage', '192.0.2.42');
  await approveWord(`/device ${browser.code} deny`);
  await waitFor(async () => {
    const r = await deviceNet('/auth/device/poll', { deviceCode: browser.deviceCode });
    return r.status === 410 ? r : null;
  }, { timeout: 30000, what: 'the browser denial' });
  assert.ok(!(await api('/auth/sessions')).json.sessions.some(s => s.name === 'Denied webpage'));
});
test('a pairing replaced after browser approval cannot redeem the old approval', { timeout: 150000 * SLOW }, async () => {
  const browser = await newBrowser('Old pairing webpage', '192.0.2.43');
  await approveWord(`/device ${browser.code} allow`);
  await waitFor(() => auditLines().some(a => a.action === 'device-let-in' && a.args?.device === 'Old pairing webpage'), { timeout: 30000, what: 'the browser decision before replacement' });
  const file = join(T.fleet.dir, 'secrets/secrets.json'), before = readFileSync(file, 'utf8'), secrets = JSON.parse(before);
  try {
    secrets.telegram.pairedAt = '2026-11-17T11:00:00.000Z'; writeFileSync(file, JSON.stringify(secrets));
    const r = await deviceNet('/auth/device/poll', { deviceCode: browser.deviceCode });
    assert.equal(r.status, 410, r.text); assert.equal(r.headers.get('set-cookie'), null);
    assert.ok(!(await api('/auth/sessions')).json.sessions.some(s => s.name === 'Old pairing webpage'));
  } finally { writeFileSync(file, before); }
});

test('the public browser-code capability needs a current pairing with approvals on and no restored-access hold, even without passkeys', { timeout: 90000 * SLOW }, async () => {
  const who = () => api('/whoami', { headers: { 'tailscale-funnel-request': '?1' } });
  const initial = await who(); assert.equal(initial.json.signin, false); assert.equal(initial.json.deviceSignin, true, initial.text);
  const file = join(T.fleet.dir, 'secrets/secrets.json'), before = readFileSync(file, 'utf8'), original = JSON.parse(before);
  try {
    for (const change of [
      s => { delete s.telegram.chatId; delete s.telegram.userId; },
      s => { s.telegram.approve = false; },
      s => { s.auth = { ...(s.auth || {}), hold: { since: new Date().toISOString() } }; },
    ]) {
      const next = structuredClone(original); change(next); writeFileSync(file, JSON.stringify(next));
      const result = await waitFor(async () => { const r = await who(); return r.json.deviceSignin === false && r; },
        { timeout: 5000 * SLOW, what: 'the public capability reflecting the changed pairing or cached access hold' });
      assert.equal(result.json.deviceSignin, false, result.text);
    }
  } finally { writeFileSync(file, before); }
  const restored = await waitFor(async () => { const r = await who(); return r.json.deviceSignin === true && r; },
    { timeout: 5000 * SLOW, what: 'the public capability after restoring the pairing and access hold' });
  assert.equal(restored.json.deviceSignin, true);
});
