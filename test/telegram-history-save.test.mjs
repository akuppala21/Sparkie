// Covers: a Telegram history-save confirmation retains its from provenance through the real action gate;
// either owner channel saves those steps without image consent, while explicitly listed steps still carry consent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const source = name => readFileSync(new URL(`../service/src/${name}.mjs`, import.meta.url), 'utf8');
const take = (src, name) => { const m = new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, 'm').exec(src); assert.ok(m, name); return m[0]; };
const actions = source('16-actions'), changes = source('17-changes'), workflows = source('18-workflows');
const label = actions.slice(actions.indexOf('const savedWorkflowLabel ='), actions.indexOf('// The kinds of request'));
const start = workflows.indexOf("action({\n  name: 'save_workflow'"), end = workflows.indexOf('\n});', start);
assert.ok(start >= 0 && end > start);
function fixture() {
  const registry = new Map([['keep_running', {}]]), verified = new WeakSet(), saved = [], asks = [];
  const step = { action: 'keep_running', args: { spark: 'spark4', container: 'history-app', image: 'nginx:1.27' } };
  let expansions = 0;
  const env = {
    createHash, ACTIONS: registry, OWNER_ADMIN: '__owner', EVAL_YES: '__eval', TRIAL_YES: '__trial',
    HttpError: class extends Error { constructor(status, message) { super(message); this.status = status; } },
    tgOwnerContextValid: ctx => verified.has(ctx), agentSettings: () => ({ halted: false }),
    action: a => registry.set(a.name, a), checkInput: (_, args) => structuredClone(args),
    ACTION_KIND: { save_workflow: ['save'] }, tokensOf: () => new Set(), tracesToRequest: () => false, stepArgs: st => st.args || {}, RAIL_LOOK_WAIT_MS: 0,
    workflowFor: () => null, brainRail: async () => ({ checked: true }), audit: () => {}, requestLine: x => x,
    findSaved: () => null, stepWords: steps => steps.map(st => JSON.stringify(st)).join('; '),
    fromRequest: input => { if (input.from === undefined) return input; expansions++; const { from, ...rest } = input; return { ...rest, steps: [structuredClone(step)] }; },
    workflowSlug: x => x, savedStepShape: () => {}, NOT_A_STEP: new Set(), placeholders: () => [], APPROVAL_ARGS: [],
    stepInput: () => ({}), missingTarget: () => null, savedWorkflows: () => saved, savedView: w => structuredClone(w),
    writeSaved: rows => saved.splice(0, saved.length, ...rows), stepLine: st => JSON.stringify(st), NOT_SHOWN: /[\u0000]/,
    nodeById: id => ({ id }), sparkName: n => n.id,
  };
  const f = new Function('env', `with (env) {
    ${['isOwnerCall', 'isOwnerButton', 'isOwnerPress'].map(n => take(actions, n)).join('\n')}
    ${source('18-saved-yes')}
    ${label}
    ${['sparkieCheck', 'firmModel', 'runAction'].map(n => take(actions, n)).join('\n')}
    ${['changeLabel', 'propose'].map(n => take(changes, n)).join('\n')}
    ${workflows.slice(start, end + 4)}
    return { runAction, sparkieCheck, savedShown };
  }`)(env);
  env.question = (viewer, ctx, text, choices, outcome, flags = {}) => {
    const call = choices.find(c => c.call).call;
    asks.push({ text, choices, flags, covers: f.savedShown(call.args) });
    return { outcome, question: text };
  };
  const context = (via, extra = {}) => {
    const ctx = { via, ...(via !== 'page' ? { channel: 'telegram' } : {}), canChange: true, ...extra };
    verified.add(ctx); return ctx;
  };
  return { ...f, registry, saved, asks, step, context, expansions: () => expansions };
}

test('a history confirmation saves once confirmed on either owner channel and never grants its unseen image consent', async () => {
  for (const via of ['page', 'telegram']) {
    const f = fixture(), viewer = { role: 'owner', login: 'owner' }, input = { title: 'history routine', from: 'this request' };
    const result = await f.runAction('save_workflow', viewer, input, f.context('sparkie', { request: 'save that as history routine', intent: { asked: ['save'], negated: [], mixed: [] } }));
    assert.equal(result.outcome, 'question'); assert.equal(f.saved.length, 0, 'asking saves nothing');
    assert.equal(f.expansions(), 0, 'the intent gate must not erase history provenance');
    const ask = f.asks.at(-1), call = ask.choices[0].call;
    assert.equal(ask.flags.ownerOnly, true);
    assert.equal(ask.choices[0].label, 'Save the workflow “history routine”: what your request before it changed in this chat');
    assert.deepEqual(call.args, input); assert.deepEqual(ask.covers, []);
    const press = f.context(via, { trusted: true, button: true, ownerConfirmed: true, covers: ask.covers });
    const out = await f.registry.get('save_workflow').run(call.args, viewer, press);
    assert.equal(out.outcome, 'saved'); assert.equal(f.expansions(), 1);
    assert.deepEqual(f.saved[0].steps, [f.step]); assert.equal(f.saved[0].approved, undefined);
    assert.match(out.note, /A run asks before it starts nginx:1\.27/);
  }
});

test('page history resolution and explicit-step owner image consent retain their existing behavior', async () => {
  const f = fixture(), viewer = { role: 'owner', login: 'owner' };
  const checked = await f.sparkieCheck('save_workflow', { title: 'page history', from: 'this request' }, { request: 'save that as page history', intent: { asked: ['save'], negated: [], mixed: [] } });
  assert.deepEqual(checked.input.steps, [f.step]); assert.equal(checked.input.from, undefined);
  for (const via of ['page', 'telegram']) {
    const input = { title: `explicit ${via}`, steps: [f.step] };
    await f.registry.get('save_workflow').run(input, viewer, f.context(via, { trusted: true, button: true, ownerConfirmed: true, covers: f.savedShown(input) }));
    assert.deepEqual(f.saved.at(-1).approved.images, ['nginx:1.27']);
  }
});
