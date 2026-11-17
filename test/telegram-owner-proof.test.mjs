// Covers: the actual Telegram proof helpers, including capture before an await, JSON spoofing, pairing changes,
// propagation through internal object spreads, and the distinction between a request, a button and a strong press.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = name => readFileSync(new URL(`../service/src/${name}`, import.meta.url), 'utf8');
const lift = (text, name) => { const at = text.indexOf(`function ${name}(`), end = text.indexOf('\n}', at); assert.ok(at >= 0 && end > at, name); return text.slice(at, end + 2); };
function fixture() {
  let binding = { mark: 'first-pair' };
  const tg = source('21-telegram.mjs'), actions = source('16-actions.mjs');
  const f = new Function('accessList', 'ownerPermissions', 'tgPairingMark', 'tgPaired', `const TG_OWNER_PROOF = Symbol('the authenticated paired owner');
${['tgOwner', 'tgOwnerContext', 'tgOwnerContextValid'].map(n => lift(tg, n)).join('\n')}
${['isOwnerCall', 'isOwnerButton', 'isOwnerPress'].map(n => lift(actions, n)).join('\n')}
return { tgOwner, tgOwnerContext, tgOwnerContextValid, isOwnerCall, isOwnerButton, isOwnerPress };`)(() => ({ owner: 'owner@example.test' }), () => ({}), (b = binding) => b?.mark || null, () => binding);
  return { ...f, pair(next) { binding = next ? { mark: next } : null; } };
}

test('request fields cannot manufacture Telegram authority and serialization loses it', () => {
  const f = fixture();
  const spoof = { via: 'telegram', channel: 'telegram', from: 'telegram:5550001', trusted: true, button: true, ownerConfirmed: true };
  assert.equal(f.isOwnerCall(spoof), false);
  assert.equal(f.isOwnerPress(spoof), false);
  const forgedViewer = { login: 'owner@example.test', role: 'owner', chat: true };
  assert.equal(f.isOwnerCall(f.tgOwnerContext(spoof, forgedViewer)), false);
  const context = f.tgOwnerContext(spoof, f.tgOwner());
  assert.equal(f.isOwnerPress(context), true);
  assert.equal(f.isOwnerPress({ ...context }), true, 'internal spreads preserve the server proof');
  assert.equal(f.isOwnerPress(JSON.parse(JSON.stringify(context))), false, 'wire or stored fields cannot restore proof');
});

test('a viewer captured before a pairing change cannot acquire the new pairing authority after an await', async () => {
  const f = fixture(), viewer = f.tgOwner();
  const context = f.tgOwnerContext({ via: 'sparkie', channel: 'telegram' }, viewer);
  assert.equal(f.isOwnerCall(context), true);
  await Promise.resolve(); f.pair('new-pair');
  assert.equal(f.isOwnerCall(context), false);
  assert.equal(f.isOwnerCall(f.tgOwnerContext({ via: 'telegram', channel: 'telegram' }, viewer)), false);
  assert.equal(f.isOwnerCall(f.tgOwnerContext({ via: 'telegram', channel: 'telegram' }, f.tgOwner())), true);
  f.pair(null);
  assert.equal(f.isOwnerCall(context), false);
});

test('only verified owner buttons can be strong owner presses; agents and channel relabeling remain denied', () => {
  const f = fixture(), viewer = f.tgOwner();
  const request = f.tgOwnerContext({ via: 'sparkie', channel: 'telegram' }, viewer);
  assert.equal(f.isOwnerCall(request), true);
  assert.equal(f.isOwnerButton(request), false);
  const button = { ...request, via: 'telegram', button: true, trusted: true };
  assert.equal(f.isOwnerButton(button), true);
  assert.equal(f.isOwnerPress(button), false);
  assert.equal(f.isOwnerPress({ ...button, ownerConfirmed: true }), true);
  for (const patch of [{ agent: true }, { agentId: 'some-agent' }, { via: 'agent' }, { via: 'api' }, { channel: 'other' }]) {
    assert.equal(f.isOwnerCall({ ...button, ...patch }), false, JSON.stringify(patch));
    assert.equal(f.isOwnerPress({ ...button, ownerConfirmed: true, ...patch }), false, JSON.stringify(patch));
  }
  assert.equal(f.isOwnerPress({ via: 'page', button: true, trusted: true, ownerConfirmed: true }), true);
  assert.equal(f.isOwnerPress({ via: 'page', button: true, trusted: true, ownerConfirmed: true, agentId: 'agent' }), false);
});
