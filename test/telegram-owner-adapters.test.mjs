// Covers: paired Telegram owner authority reaches memory history, journal reads, saved image approval, standing
// allowances, context retries and self-change, while forged channel flags, agents and stale pairing proofs cannot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { contextAttempt } from '../service/src/17-context.mjs';

const source = name => readFileSync(new URL(`../service/src/${name}`, import.meta.url), 'utf8');
const lift = (text, head) => { const at = text.indexOf(head); assert.ok(at >= 0, head); const end = text.indexOf('\n}', at); assert.ok(end > at, head); return text.slice(at, end + 2); };
const declaration = (text, name) => { const hit = new RegExp(`^const ${name} = [\\s\\S]*?;\\n`, 'm').exec(text); assert.ok(hit, name); return hit[0]; };
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
function authority() {
  const verified = new WeakSet(); let paired = true;
  const actions = source('16-actions.mjs');
  const helpers = new Function('tgOwnerContextValid', `${lift(actions, 'function isOwnerCall(')}\n${lift(actions, 'function isOwnerButton(')}\n${lift(actions, 'function isOwnerPress(')}\nreturn { isOwnerCall, isOwnerButton, isOwnerPress };`)(ctx => paired && verified.has(ctx));
  return { ...helpers, telegram(extra = {}) { const ctx = { via: 'telegram', channel: 'telegram', trusted: true, button: true, ownerConfirmed: true, ...extra }; verified.add(ctx); return ctx; }, unpair() { paired = false; } };
}

test('owner history and journal reads accept only the verified Telegram owner, including page records', () => {
  const auth = authority(), chats = [{ id: 'own' }, { id: 'agent-chat', agent: { name: 'agent' } }];
  const functions = new Function('isOwnerCall', 'chatData', `${declaration(source('20-memory.mjs'), 'memoryPastShown')}\n${declaration(source('20-journal.mjs'), 'jOwnCall')}\nreturn { memoryPastShown, jOwnCall };`)(auth.isOwnerCall, () => ({ conversations: chats }));
  const owner = auth.telegram({ conv: 'own', via: 'sparkie' });
  assert.equal(functions.memoryPastShown(owner), true);
  assert.equal(functions.jOwnCall({}, owner), true);
  assert.equal(functions.jOwnCall({ agentKey: { id: 'read-key' } }, owner), false);
  for (const ctx of [{ ...owner }, auth.telegram({ agent: true }), auth.telegram({ agentId: 'key' }), auth.telegram({ conv: 'agent-chat' })]) {
    assert.equal(functions.memoryPastShown(ctx), false);
    assert.equal(functions.jOwnCall({}, ctx), false);
  }
  auth.unpair();
  assert.equal(functions.memoryPastShown(owner), false);
  assert.equal(functions.jOwnCall({}, owner), false);
});

test('saved image approval on Telegram binds the same exact steps and shown image as a page approval', () => {
  const auth = authority(), text = source('18-saved-yes.mjs');
  const f = new Function('createHash', 'isOwnerCall', 'isOwnerButton', 'isOwnerPress', 'stepCovered', `${declaration(text, 'savedStepsHash')}\n${declaration(text, 'savedStepKey')}\n${lift(text, 'function savedImagesYes(')}\n${lift(text, 'function stepImagesYes(')}\nreturn { savedStepsHash, savedStepKey, savedImagesYes, stepImagesYes };`)(createHash, auth.isOwnerCall, auth.isOwnerButton, auth.isOwnerPress, st => !st.hidden && !st.input);
  const step = { action: 'keep_running', args: { image: 'registry/app@sha256:abc', container: 'app' } }, steps = [step];
  const w = { steps, approved: { images: [step.args.image], steps: f.savedStepsHash(steps), covered: [f.savedStepKey(step)] } };
  const press = auth.telegram({ ownerConfirmed: false });
  assert.equal(f.savedImagesYes({}, press, [step.args.image]), true);
  assert.equal(f.savedImagesYes({}, { ...press }, [step.args.image]), false);
  assert.equal(f.savedImagesYes({ agentKey: {} }, press, [step.args.image]), false);
  const turn = auth.telegram({ via: 'sparkie', button: false, ownerConfirmed: false });
  assert.deepEqual(f.stepImagesYes(w, step, {}, turn), [step.args.image]);
  assert.deepEqual(f.stepImagesYes(w, step, {}, { ...turn }), []);
  assert.deepEqual(f.stepImagesYes(w, step, { agentKey: {} }, turn), []);
  w.approved.covered = [];
  assert.deepEqual(f.stepImagesYes(w, step, {}, turn), []);
  w.approved.covered = [f.savedStepKey(step)]; step.args.container = 'changed';
  assert.deepEqual(f.stepImagesYes(w, step, {}, turn), []);
  auth.unpair(); assert.equal(f.savedImagesYes({}, press, ['image']), false);
});

test('standing permissions need an actual owner press and retain Telegram audit provenance without a fake passkey', () => {
  const auth = authority(), audits = []; let settings = { allowed: [] };
  const keep = new Function('maskSecrets', 'isOwnerPress', 'passkeys', 'allowedList', 'allowedWords', 'setAgentSettings', 'randomBytes', 'audit', 'ALLOWED_MAX', `${lift(source('21-ahead.mjs'), 'function aheadKeep(')}\nreturn aheadKeep;`)(String, auth.isOwnerPress, () => [], () => settings.allowed, () => 'touch in ~/notes', value => { settings = value; }, () => ({ toString: () => 'abcdef01' }), value => audits.push(value), 50);
  const offer = { entry: { spark: 'spark3', program: 'touch', under: '~/notes' } }, press = auth.telegram();
  assert.equal(keep(offer, { ...press }), null);
  assert.equal(settings.allowed.length, 0);
  assert.match(keep(offer, press), /From now on/);
  assert.equal(settings.allowed.length, 1); assert.equal(audits[0].via, 'telegram');
  auth.unpair(); assert.equal(keep(offer, press), null);
});

test('self-change parity still requires the coding trial and an owner chat', () => {
  const auth = authority(); let trial = true;
  const gate = new Function('trialPassed', 'clean', 'HttpError', 'SELF_CHANGE_ON', 'selfTestFile', 'chatData', 'isOwnerCall', 'isOwnerButton', `${lift(source('21-selfchange.mjs'), 'function selfGate(')}\nreturn selfGate;`)(() => ({ passed: trial, says: 'not passed' }), String, HttpError, true, () => null, () => ({ conversations: [{ id: 'own' }, { id: 'agent-chat', agent: {} }] }), auth.isOwnerCall, auth.isOwnerButton);
  const ctx = auth.telegram({ via: 'sparkie', conv: 'own' });
  gate({ role: 'owner' }, ctx);
  for (const bad of [{ ...ctx }, auth.telegram({ via: 'sparkie', conv: 'agent-chat' }), auth.telegram({ via: 'sparkie', conv: 'own', agentId: 'key' })]) assert.throws(() => gate({ role: 'owner' }, bad), /only in your own chat/);
  assert.throws(() => gate({ role: 'owner', agentKey: {} }, ctx), /only in your own chat/);
  trial = false; assert.throws(() => gate({ role: 'owner' }, ctx), /coding trial has no pass/);
});

test('a page-created context retry accepts the paired owner and keeps exact context, placement and deadline checks', () => {
  const auth = authority(), retries = new Map(); let attempts = 0;
  const consume = new Function('contextPrune', 'contextRetries', 'isOwnerCall', 'isOwnerPress', 'HttpError', 'contextAttempt', 'FIX_WINDOW_MS', `${lift(source('17-context-retry.mjs'), 'function contextConsume(')}\nreturn contextConsume;`)(() => {}, retries, auth.isOwnerCall, auth.isOwnerPress, HttpError, (budget, now, limit) => { attempts++; return contextAttempt(budget, now, limit); }, 1800000);
  const plan = { page: { body: {} }, args: { model: 'model', spark: 'spark3' }, proposed: 16384, budget: { attempts: 0, deadline: Date.now() + 10000 }, noStops: true };
  const args = { ...plan.args, contextTokens: 16384, __contextRetryToken: 'token' }, ctx = auth.telegram();
  retries.set('token', plan);
  assert.throws(() => consume(args, { role: 'owner' }, { ...ctx }), /needs the owner/);
  const out = consume(args, { role: 'owner' }, ctx);
  assert.equal(out.args.contextTokens, 16384); assert.equal(out.ctx.noStops, true); assert.equal(attempts, 1);
  assert.throws(() => consume(args, { role: 'owner' }, ctx), /expired/);
  retries.set('token', plan);
  assert.throws(() => consume({ ...args, contextTokens: 8192 }, { role: 'owner' }, ctx), /no longer matches/);
  retries.set('token', { ...plan, budget: { attempts: 3, deadline: Date.now() + 10000 } });
  assert.throws(() => consume(args, { role: 'owner' }, ctx), /three attempts or its 30 minutes/);
  retries.set('token', { ...plan, budget: { attempts: 0, deadline: Date.now() - 1 } });
  assert.throws(() => consume(args, { role: 'owner' }, ctx), /three attempts or its 30 minutes/);
});

test('keeping a compared winner uses the same owner authority on Telegram as on the page', () => {
  const auth = authority(), kept = [];
  const keep = new Function('isOwnerCall', 'isOwnerPress', 'HttpError', 'savedNamed', 'question', 'compareKeepOn', 'compareBest', 'savedOwnCall', `${lift(source('21-compare.mjs'), 'function compareKeep(')}\nreturn compareKeep;`)(auth.isOwnerCall, auth.isOwnerPress, HttpError, w => w.title, () => ({ outcome: 'question' }), (w, best) => kept.push(best), r => r, () => true);
  const w = { id: 'workflow', title: 'Work', compared: { sample: 1, results: [{ model: 'candidate', result: 'ran', ok: true }] } };
  const ctx = auth.telegram({ via: 'sparkie', button: false, ownerConfirmed: false });
  assert.equal(keep(w, 'candidate', {}, { ...ctx }).outcome, 'question'); assert.equal(kept.length, 0);
  assert.equal(keep(w, 'candidate', {}, ctx).outcome, 'kept'); assert.equal(kept.length, 1);
  assert.throws(() => keep(w, 'another model', {}, ctx), /isn’t one of the candidates/);
});

test('the rollback action accepts a verified Telegram owner while an unconfirmed remote session still asks', async () => {
  const auth = authority(), text = source('18-workflows.mjs'), at = text.indexOf("  name: 'undo_update'"); assert.ok(at > 0);
  const begin = text.lastIndexOf('action({', at), end = text.indexOf('\n});', at); assert.ok(begin >= 0 && end > at);
  let action, ran = 0;
  new Function('action', 'isOwnerCall', 'isOwnerPress', 'lastSnapshot', 'HttpError', 'question', 'undoUpdate', text.slice(begin, end + 4))(
    value => { action = value; }, auth.isOwnerCall, auth.isOwnerPress, () => ({ stamp: 'before' }), HttpError,
    () => ({ outcome: 'question' }), via => { ran++; return { outcome: 'undone', via }; });
  const ctx = auth.telegram({ via: 'sparkie', button: false, ownerConfirmed: false });
  assert.equal((await action.run({}, {}, ctx)).outcome, 'undone'); assert.equal(ran, 1);
  assert.equal((await action.run({}, { session: {} }, { via: 'sparkie' })).outcome, 'question'); assert.equal(ran, 1);
  assert.equal((await action.run({}, {}, { ...ctx })).outcome, 'question'); assert.equal(ran, 1);
});
