// Covers: sensitive Telegram proposals retain explicit owner-only choices across channels, so a bare page press
// cannot inherit Telegram authority. The real proposal, question and pairing-proof functions preserve exact calls,
// ordinary memory choices and existing page-origin behavior; forged, agent and stale pairing contexts create no ask.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const read = name => readFileSync(new URL(`../service/src/${name}`, import.meta.url), 'utf8');
const lift = (source, name) => { const m = source.match(new RegExp(`^function ${name}\\([^]*?^\\}`, 'm')); assert.ok(m, name); return m[0]; };
const changes = read('17-changes.mjs'), telegram = read('21-telegram.mjs');
const SENSITIVE = ['undo_update', 'save_workflow', 'forget_workflow', 'propose_update'];
function fixture() {
  let pair = { mark: 'first-pair' };
  const pendingChoices = new Map(), conversations = [], deliveries = [];
  class Refused extends Error { constructor(status, text) { super(text); this.status = status; } }
  const env = { randomBytes, pendingChoices, HttpError: Refused,
    tgPaired: () => pair, tgPairingMark: (b = pair) => b?.mark || null,
    accessList: () => ({ owner: 'owner@example.test' }), ownerPermissions: () => ({}),
    changeLabel: (name, input) => `${name}: ${JSON.stringify(input)}`,
    dangerForTest: () => null, savedShown: () => [], tgAsk: (viewer, ctx, q) => deliveries.push({ viewer, ctx, q }),
    whoAsks: (viewer, ctx) => `${viewer.login}|conv|${ctx.conv}`,
  };
  const code = `const TG_OWNER_PROOF = Symbol('the authenticated paired owner');\n${['tgOwner', 'tgOwnerContext', 'tgOwnerContextValid'].map(n => lift(telegram, n)).join('\n')}\n${lift(changes, 'question')}\n${lift(changes, 'propose')}\nreturn { tgOwner, tgOwnerContext, propose };`;
  const api = new Function('env', `with (env) { ${code} }`)(env);
  const viewer = api.tgOwner(), capture = q => conversations.push(q);
  const context = extra => api.tgOwnerContext({ via: 'sparkie', channel: 'telegram', conv: 'sc_0123456789abcdef', onQuestion: capture, ...extra }, viewer);
  return { ...api, viewer, context, pendingChoices, conversations, deliveries, pair: value => { pair = value; } };
}

test('sensitive Telegram proposals keep owner-only metadata and exact pending calls before any confirmation', () => {
  const f = fixture();
  for (const name of SENSITIVE) {
    const args = { title: 'Exact owner choice', steps: [{ action: 'stop_model', args: { spark: 'spark3', container: 'sc-old' } }] };
    const out = f.propose(f.viewer, f.context(), name, args, 'words');
    const q = f.conversations.at(-1), choice = f.pendingChoices.get(q.choices[0].choice);
    assert.equal(choice.ownerOnly, true, `${name}: the page passkey gate must see an owner-only choice`);
    assert.equal(choice.action, name); assert.deepEqual(choice.args, args);
    assert.equal(choice.tg, 'first-pair'); assert.equal(choice.group, q.group);
    assert.equal(out.outcome, 'needs-ok'); assert.equal(out.askedBecause, 'words');
    assert.equal(f.deliveries.at(-1).q, q, 'the same exact choice goes to the authenticated owner');
  }
});

test('page-origin proposal behavior and ordinary paired-owner memory choices remain unchanged', () => {
  const f = fixture();
  for (const name of SENSITIVE) {
    f.propose(f.viewer, { via: 'sparkie', conv: 'sc_0123456789abcdef', onQuestion: q => f.conversations.push(q) }, name, {});
    assert.equal(f.pendingChoices.get(f.conversations.at(-1).choices[0].choice).ownerOnly, false, name);
  }
  for (const name of ['remember', 'forget_memory']) {
    f.propose(f.viewer, f.context(), name, { text: 'An ordinary memory suggestion' });
    assert.equal(f.pendingChoices.get(f.conversations.at(-1).choices[0].choice).ownerOnly, false, name);
  }
  assert.equal(f.deliveries.length, 0, 'ordinary proposals use their existing reply sender');
});

test('forged, agent and stale Telegram proposal contexts cannot create or deliver any choice', () => {
  for (const mode of ['forged', 'agent', 'stale']) {
    const f = fixture();
    let ctx = f.context(mode === 'agent' ? { agentId: 'agent' } : {});
    if (mode === 'forged') ctx = JSON.parse(JSON.stringify({ ...ctx, onQuestion: undefined }));
    if (mode === 'stale') f.pair({ mark: 'new-pair' });
    assert.throws(() => f.propose(f.viewer, ctx, 'save_workflow', { title: 'Never save this' }), error => error.status === 403 && /pairing changed/.test(error.message));
    assert.equal(f.pendingChoices.size, 0); assert.equal(f.deliveries.length, 0);
  }
});
