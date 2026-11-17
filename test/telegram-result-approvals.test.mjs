// Covers: eval and coding-trial approvals from the verified paired Telegram owner retain one-use result identity,
// current build/setup checks and real result seals, with Telegram provenance instead of a claimed passkey press.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac, timingSafeEqual } from 'node:crypto';

const source = name => readFileSync(new URL(`../service/src/${name}`, import.meta.url), 'utf8');
const lift = (text, head) => { const at = text.indexOf(head); assert.ok(at >= 0, head); const end = text.indexOf('\n}', at); assert.ok(end > at, head); return text.slice(at, end + 2); };
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
function fixture() {
  const valid = new WeakSet(); let paired = true;
  const actions = source('16-actions.mjs'), rail = source('21-brain-rail.mjs'), trial = source('21-brain-trial.mjs');
  const auth = new Function('tgOwnerContextValid', `${lift(actions, 'function isOwnerCall(')}\n${lift(actions, 'function isOwnerButton(')}\n${lift(actions, 'function isOwnerPress(')}\nreturn { isOwnerCall, isOwnerButton, isOwnerPress };`)(ctx => paired && valid.has(ctx));
  const state = { reads: 'a'.repeat(64), set: 'b'.repeat(64) }, profile = { key: 'e'.repeat(16) }, audits = [];
  const sealKey = 'f'.repeat(64), stamp = new Date().toISOString();
  const rec = { reads: state.reads, set: state.set, build: 'c'.repeat(12), at: stamp, hash: 'd'.repeat(64), runs: 3,
    tasks: { version: state.set, ids: ['one'] }, score: { full: true, met: true, passOnce: 1, passes: [{ id: 'one', passed: 3 }] } };
  const deps = { isOwnerPress: auth.isOwnerPress, HttpError, timingSafeEqual, createHmac, brainRanLook: async () => { state.onLook?.(); },
    mainBusy: () => false, brainProfileOf: () => profile, brainKey: () => profile.key,
    brainReadsNow: () => state.reads, evalSetLocked: () => ({ version: state.set }), evalSetToday: () => ({ version: state.set }), trialSetNow: () => ({ version: state.set }),
    passkeys: () => [{}], railWords: async () => 'The real rail decides.', audit: value => audits.push(value), evalSame: () => false,
    evalSealKey: () => sealKey, evalMainSet: () => true, evalLine: () => 'eval', trialLine: () => 'trial',
    saveBrainProfile: (p, evals, trials) => { if (evals) p.evals = evals; if (trials) p.trial = trials; }, EVAL_KEEP: 5, EVAL_SLOTS: 6,
    EVAL_SLOT: /^[0-9a-f]{64}:[0-9a-f]{64}$/, EVAL_YES: 'keep_eval_result', TRIAL_YES: 'keep_trial_result', TRIAL_KEEP: 5 };
  const seal = /^const evalSealOf = .*$/m.exec(rail)?.[0]; assert.ok(seal);
  const body = `let evalWaiting = null, trialWaiting = null; const MAIN = {};\n${seal}\n${lift(rail, 'function evalSealed(')}\n${lift(source('21-brain-eval.mjs'), 'function keepEvalRecord(')}\n${lift(trial, 'function keepTrialRecord(')}\n${lift(rail, 'async function evalYes(')}\n${lift(trial, 'async function trialYes(')}\nreturn { evalYes, trialYes, evalSealed, pending(kind, record) { const w = { token: 'secret-token', rec: record, profileKey: '${profile.key}', setup: 'current' }; if (kind === 'eval') evalWaiting = w; else trialWaiting = w; } };`;
  const methods = new Function(...Object.keys(deps), body)(...Object.values(deps));
  return { ...methods, rec, state, profile, audits, telegram(extra = {}) { const ctx = { via: 'telegram', channel: 'telegram', button: true, trusted: true, ownerConfirmed: true, ...extra }; valid.add(ctx); return ctx; }, unpair() { paired = false; } };
}

for (const kind of ['eval', 'trial']) {
  const press = (f, ctx, args = {}, viewer = { role: 'owner' }) => f[`${kind}Yes`]({ token: 'secret-token', hash: f.rec.hash, keep: true, ...args }, viewer, ctx);
  const records = f => kind === 'eval' ? Object.values(f.profile.evals || {}).flat() : f.profile.trial || [];
  test(`${kind}: Telegram approval is one-use, sealed and audited as Telegram`, async () => {
    const f = fixture(), ctx = f.telegram(); f.pending(kind, f.rec);
    await assert.rejects(press(f, { ...ctx }), /No action called/);
    await assert.rejects(press(f, ctx, {}, { role: 'owner', agentKey: {} }), /No action called/);
    await assert.rejects(press(f, ctx, { token: 'another-token' }), /isn’t waiting/);
    if (kind === 'trial') await assert.rejects(press(f, ctx, { hash: '0'.repeat(64) }), /isn’t waiting/);
    const out = await press(f, ctx); assert.equal(out.outcome, 'kept');
    const kept = records(f)[0]; assert.equal(kept.keptWith, 'telegram');
    assert.equal(f.audits.at(-1).via, 'telegram'); assert.equal(f.audits.at(-1).args.keptWith, 'telegram');
    assert.match(kept.seal, /^[0-9a-f]{64}$/); assert.equal(f.evalSealed(f.profile.key, kept), true);
    assert.equal(f.evalSealed(f.profile.key, { ...kept, keptWith: 'passkey' }), false);
    await assert.rejects(press(f, ctx), /isn’t waiting/);
  });
  test(`${kind}: stale pairing, changed brain, reads or case set cannot keep a result`, async () => {
    for (const changed of ['pairing', 'pairing-during-check', 'brain', 'reads', 'set']) {
      const f = fixture(), ctx = f.telegram(); f.pending(kind, f.rec);
      if (changed === 'pairing') f.unpair();
      if (changed === 'pairing-during-check') f.state.onLook = () => f.unpair();
      if (changed === 'brain') f.profile.key = '0'.repeat(16);
      if (changed === 'reads') f.state.reads = '0'.repeat(64);
      if (changed === 'set') f.state.set = '0'.repeat(64);
      await assert.rejects(press(f, ctx)); assert.equal(records(f).length, 0, changed);
    }
  });
  test(`${kind}: dropping a Telegram result records the real channel and keeps nothing`, async () => {
    const f = fixture(), ctx = f.telegram(); f.pending(kind, f.rec);
    assert.equal((await press(f, ctx, { keep: false })).outcome, 'dropped');
    assert.equal(records(f).length, 0); assert.equal(f.audits.at(-1).via, 'telegram');
  });
  test(`${kind}: page approval retains its passkey provenance`, async () => {
    const f = fixture(); f.pending(kind, f.rec);
    await press(f, { via: 'page', trusted: true, button: true, ownerConfirmed: true });
    assert.equal(records(f)[0].keptWith, 'passkey'); assert.equal(f.audits.at(-1).via, 'page');
  });
}
