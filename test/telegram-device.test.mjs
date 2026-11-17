// Covers: a paired owner can approve only the exact waiting webpage sign-in through a strong confirmation;
// stale proof, changed or reused requests, expiry, agent calls and terminal requests cannot acquire that authority.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const source = name => readFileSync(new URL(`../service/src/${name}.mjs`, import.meta.url), 'utf8');
const sessions = source('22-sessions'), admin = source('21-owner-admin'), actions = source('16-actions'), telegram = source('21-telegram');
const take = (src, name) => { const got = new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, 'm').exec(src); assert.ok(got, name); return got[0]; };
const proof = telegram.slice(telegram.indexOf('const TG_OWNER_PROOF'), telegram.indexOf('const tgOwnerTell'));
const helpers = ['pruneDeviceCodes', 'deviceByCode', 'ownerDevicePreview', 'ownerDeviceDecision', 'telegramDeviceApprovalCurrent', 'telegramDeviceSignInAvailable'].map(n => take(sessions, n)).join('\n');
const fingerprint = sessions.match(/^const deviceFingerprint = .*;$/m)[0];
function fixture() {
  let pair = 'pair-one', owner = 'owner', approvals = true, held = false, keys = [], ask;
  const audits = [], devices = new Map(), conv = { id: 'chat', login: 'owner', messages: [] };
  const hash = x => createHash('sha256').update(String(x)).digest('hex');
  const d = { userCode: 'BCDF-2345', deviceHash: hash('private browser poll token'), kind: 'browser', name: 'My webpage', from: '192.0.2.10', at: Date.now(), exp: Date.now() + 600000, state: 'waiting' };
  devices.set(d.userCode, d);
  const env = { createHash, sessionHash: hash, deviceCodes: devices, accessList: () => ({ owner }), tgPaired: () => pair ? {} : null, tgPairingMark: () => pair,
    ownerPermissions: () => ({}), chatData: () => ({ conversations: [conv] }), tgApproveOn: () => approvals, putBackHeld: () => held,
    passkeys: () => keys, clean: (s, n) => String(s || '').slice(0, n), maskSecrets: s => s, audit: a => audits.push(a), fleetEvent: () => {},
    HttpError: class extends Error { constructor(status, message) { super(message); this.status = status; } }, dangerAsk: (_, __, q) => { ask = q; return { outcome: 'question' }; } };
  const f = new Function('env', `with(env) { ${proof}\n${['isOwnerCall', 'isOwnerButton', 'isOwnerPress'].map(n => take(actions, n)).join('\n')}\n${fingerprint}\n${helpers}\n${admin}\nreturn { ownerAdmin, ownerAdminParse, isOwnerAdminWord, ownerDevicePreview, ownerDeviceDecision, telegramDeviceApprovalCurrent, deviceFingerprint, tgOwner, tgOwnerContext }; }`)(env);
  const viewer = f.tgOwner(), context = () => f.tgOwnerContext({ via: 'telegram', channel: 'telegram', conv: conv.id, ownerWord: true }, viewer);
  const press = () => ({ ...context(), trusted: true, button: true, ownerConfirmed: true, danger: 'exact-ask-and-digits' });
  return { ...f, viewer, context, press, d, devices, audits, ask: () => ask, keys: value => { keys = value; }, rePair: () => { pair = 'pair-two'; }, unpair: () => { pair = null; }, changeOwner: () => { owner = 'other'; }, lock: () => { approvals = false; }, hold: () => { held = true; } };
}
const input = { op: 'device_decision', code: 'BCDF-2345', allow: true };
async function ask(f, patch = {}) { assert.equal((await f.ownerAdmin(f.viewer, { ...input, ...patch }, f.context())).outcome, 'question'); return f.ask().call.args; }

test('the command accepts one exact code and decision, never embedded or multiline instructions', () => {
  const f = fixture();
  assert.deepEqual(f.ownerAdminParse('/device bcdf-2345 allow'), input);
  assert.deepEqual(f.ownerAdminParse('/device BCDF-2345 deny'), { ...input, allow: false });
  for (const text of ['please /device BCDF-2345 allow', '/device BCDF2345 allow', '/device BCDF-2345 allow now', '/device BCDF-2345 allow\n/resume']) assert.equal(f.isOwnerAdminWord(text), false, text);
});
test('zero passkeys: asking changes nothing; exact strong Telegram confirmation approves once and exposes no private credential', async () => {
  const f = fixture(), bound = await ask(f);
  assert.equal(f.d.state, 'waiting'); assert.equal(f.audits.length, 0);
  const shown = JSON.stringify(f.ask());
  assert.ok(shown.includes(f.d.name) && shown.includes(f.d.from) && shown.includes(new Date(f.d.exp).toISOString()));
  assert.ok(!shown.includes(f.d.deviceHash) && !shown.includes(f.deviceFingerprint(f.d)), 'private polling identity never enters the ask');
  await assert.rejects(f.ownerAdmin(f.viewer, bound, { ...f.press(), danger: undefined }), /changed since the ask/);
  await f.ownerAdmin(f.viewer, bound, f.press());
  assert.equal(f.d.state, 'approved'); assert.equal(f.audits.length, 1); assert.equal(f.audits[0].via, 'telegram');
  assert.equal(f.telegramDeviceApprovalCurrent(f.d), true); assert.ok(Object.isFrozen(f.d.telegramApproval));
  assert.ok(!JSON.stringify(f.audits).includes(f.d.deviceHash));
  await assert.rejects(f.ownerAdmin(f.viewer, bound, f.press()), /isn’t waiting/);
  assert.equal(f.audits.length, 1);
});
for (const field of ['deviceHash', 'name', 'from', 'at', 'exp']) test(`a changed request ${field} invalidates the old confirmation`, async () => {
  const f = fixture(), bound = await ask(f);
  f.d[field] = typeof f.d[field] === 'number' ? f.d[field] + 1000 : `${f.d[field]}-changed`;
  await assert.rejects(f.ownerAdmin(f.viewer, bound, f.press()), /changed since the ask/);
  assert.equal(f.d.state, 'waiting'); assert.equal(f.audits.length, 0);
});
test('a different browser reusing the exact short code and shown facts cannot use the original approval', async () => {
  const f = fixture(), bound = await ask(f), replacement = { ...f.d, deviceHash: 'c'.repeat(64) };
  f.devices.set(f.d.userCode, replacement);
  await assert.rejects(f.ownerAdmin(f.viewer, bound, f.press()), /changed since the ask/);
  assert.equal(replacement.state, 'waiting');
});
test('replacement after preview but before the mutation fails the final synchronous identity check', async () => {
  const f = fixture(), bound = await ask(f), pending = f.ownerAdmin(f.viewer, bound, f.press());
  const replacement = { ...f.d, deviceHash: 'd'.repeat(64) }; f.devices.set(f.d.userCode, replacement);
  await assert.rejects(pending, /webpage sign-in changed/); assert.equal(replacement.state, 'waiting');
});
test('expiry or another decision before the press leaves no authority to approve', async () => {
  for (const change of [f => { f.d.exp = Date.now() - 1; }, f => { f.d.state = 'denied'; }, f => f.devices.delete(f.d.userCode)]) {
    const f = fixture(), bound = await ask(f); change(f);
    await assert.rejects(f.ownerAdmin(f.viewer, bound, f.press()), /isn’t waiting/); assert.equal(f.audits.length, 0);
  }
});
test('terminal requests cannot enter the Telegram confirmation or helper even with real owner proof', async () => {
  const f = fixture(); f.d.kind = 'terminal';
  await assert.rejects(f.ownerAdmin(f.viewer, input, f.context()), /webpage sign-in only/);
  assert.throws(() => f.ownerDeviceDecision(f.d.userCode, true, f.press(), f.deviceFingerprint(f.d)), /webpage sign-in changed/);
  assert.equal(f.d.state, 'waiting');
});
test('spoofed fields, agents, a changed pairing during the await, a locked pairing and restored-access hold cannot approve', async () => {
  const f = fixture(), bound = await ask(f);
  for (const ctx of [{ via: 'telegram', channel: 'telegram', conv: 'chat', ownerWord: true, trusted: true, button: true, ownerConfirmed: true, danger: 'forged' }, { ...f.press(), agentId: 'agent' }]) await assert.rejects(f.ownerAdmin(f.viewer, bound, ctx), /own account command/);
  const pending = f.ownerAdmin(f.viewer, bound, f.press()); f.rePair();
  await assert.rejects(pending, /own account command/); assert.equal(f.d.state, 'waiting');
  for (const revoke of ['lock', 'hold']) {
    const g = fixture(), b = await ask(g); g[revoke]();
    await assert.rejects(g.ownerAdmin(g.viewer, b, g.press())); assert.equal(g.d.state, 'waiting');
  }
});
test('a confirmed denial is one-use and gives no pending sign-in approval', async () => {
  const f = fixture(), bound = await ask(f, { allow: false }); await f.ownerAdmin(f.viewer, bound, f.press());
  assert.equal(f.d.state, 'denied'); assert.equal(f.d.telegramApproval, undefined); assert.equal(f.audits[0].action, 'device-turned-away');
  await assert.rejects(f.ownerAdmin(f.viewer, bound, f.press()), /isn’t waiting/);
});
test('pairing, owner, approval revocation or request changes after approval cannot redeem that approval', async () => {
  for (const revoke of [f => f.rePair(), f => f.unpair(), f => f.changeOwner(), f => f.lock(), f => { f.d.deviceHash = 'e'.repeat(64); }]) {
    const f = fixture(), bound = await ask(f); await f.ownerAdmin(f.viewer, bound, f.press()); revoke(f);
    assert.equal(f.telegramDeviceApprovalCurrent(f.d), false);
  }
});
test('the shared page path still requires a registered passkey and can still approve a terminal', () => {
  const f = fixture(); f.d.kind = 'terminal';
  assert.throws(() => f.ownerDeviceDecision(f.d.userCode, true, { via: 'page', login: 'owner' }), /Set up your passkey first/);
  assert.equal(f.d.state, 'waiting'); f.keys([{ id: 'existing' }]);
  f.ownerDeviceDecision(f.d.userCode, true, { via: 'page', login: 'owner' });
  assert.equal(f.d.state, 'approved'); assert.equal(f.d.telegramApproval, undefined); assert.equal(f.audits[0].via, 'page');
});

test('during restored-access hold a current owner may deny over HTTP, but neither interface may approve', async () => {
  const f = fixture(); f.keys([{ id: 'existing' }]); f.hold();
  assert.throws(() => f.ownerDeviceDecision(f.d.userCode, true, { via: 'page', login: 'owner' }), /Review restored access/);
  assert.throws(() => f.ownerDeviceDecision(f.d.userCode, false, { via: 'page', login: 'someone-else' }), /Only the owner/);
  assert.equal(f.d.state, 'waiting');
  assert.deepEqual(f.ownerDeviceDecision(f.d.userCode, false, { via: 'page', login: 'owner' }), { ok: true, state: 'denied' });
  assert.equal(f.d.telegramApproval, undefined); assert.equal(f.audits[0].action, 'device-turned-away');
  const g = fixture(), bound = await ask(g); g.hold();
  await assert.rejects(g.ownerAdmin(g.viewer, bound, g.press()), /Review restored access/);
  assert.equal(g.d.state, 'waiting');
  const h = fixture(); h.hold(); const denied = await ask(h, { allow: false });
  await h.ownerAdmin(h.viewer, denied, h.press()); assert.equal(h.d.state, 'denied');
  const malformed = fixture(); malformed.hold();
  await assert.rejects(malformed.ownerAdmin(malformed.viewer, { ...input, allow: false, extra: true }, malformed.context()), /Review restored access/);
  assert.equal(malformed.d.state, 'waiting');
});
