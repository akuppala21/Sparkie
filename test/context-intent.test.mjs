// Covers: T42 at the actual owner-word gate: a numeric context in one model's start clause reaches the first action
// even when the brain omits it or supplies another value; k means 1,024 tokens. Unbound or ambiguous context needs
// confirmation, and an ambiguity without a proposed number has no executable default-context Start. Another model,
// an earlier message, quoted or pasted specifications, negation and conditions grant no numeric authority. Retry
// capabilities stay out of public plans and are masked by the existing record masker. Pure checks, no fleet.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './start-mock.mjs';

const part = name => readFileSync(join(REPO, 'service', 'src', name), 'utf8');
const source = part('16-actions.mjs');
const cut = (from, to) => { const a = source.indexOf(from), b = source.indexOf(to, a); assert.ok(a >= 0 && b > a, from); return source.slice(a, b); };
const fnOf = (text, name) => new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\) \\{\\n[\\s\\S]*?\\n\\}$`, 'm').exec(text)?.[0];
// Use the real intent/clause reader and gate. Model identity is independently covered by intent tests; here its
// stand-in says that a named model is the intended one so no inventory or real service is needed.
const code = [cut('// Sparks are named the way people say them', 'const sparkList'), cut('const normQuotes', '// Never run from a channel'),
  cut('// The kinds of request (CHANGE_WORDS)', '// A typed answer to Sparkie'), cut('// Which of Spark Console\'s models on that Spark', '// A change\'s plan'),
  cut('// What Sparkie may do straight away', '// ctx says who')].join('\n');
const bindings = {
  NODES: [1, 2, 3, 4].map(i => ({ id: `spark${i}` })), sparkName: n => `Spark ${n.id.slice(5)}`,
  squash: s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''), HttpError: class extends Error {},
  knowledge: { workloads: {} }, namesModel: async () => true,
};
const gate = new Function(...Object.keys(bindings), `${code}\nreturn { sparkieCheck, changeIntent, tokensOf, normQuotes, sparkNames };`)(...Object.values(bindings));
const context = (text, before = null) => ({ via: 'sparkie', canChange: true, intent: gate.changeIntent(text), request: text, said: [before, text].filter(Boolean).join('\n') });
const check = (text, args = {}, before = null) => gate.sparkieCheck('start_model', { model: 'qwen', ...args }, context(text, before));

function actionRunner() {
  const launched = [], proposed = [];
  const env = {
    EVAL_YES: '__eval', TRIAL_YES: '__trial',
    ACTIONS: new Map([['start_model', { kind: 'change', run: async input => { launched.push({ ...input }); return { outcome: 'complete' }; } }]]),
    checkInput: (_, args) => ({ ...args }), HttpError: class extends Error {}, agentSettings: () => ({ halted: false }),
    PAGE_ONLY: new Set(), sparkieCheck: gate.sparkieCheck, workflowFor: () => null, brainRail: async () => ({ checked: true }), RAIL_LOOK_WAIT_MS: 0,
    firmModel: async (_, input) => input,
    propose: (_, ctx, name, input) => { proposed.push({ ...input }); return { outcome: 'question', input }; },
    hourCounts: () => false, journalFirst: () => null, audit: () => {}, journalCalled: () => {}, requestLine: () => '', RAN_NOTHING: new Set(['question']),
  };
  const runAction = new Function(...Object.keys(env), `${fnOf(source, 'runAction')}\nreturn runAction;`)(...Object.values(env));
  return { launched, proposed, run: (text, args = {}) => runAction('start_model', { role: 'owner' }, { model: 'qwen', ...args }, context(text)) };
}

describe('the owner numeric context reaches the first launch', () => {
  test('common context and window forms inject an exact number before the action starts', async () => {
    for (const [phrase, tokens] of [
      ['128k context', 131072], ['128 k context', 131072], ['128K-token context', 131072],
      ['context 131072', 131072], ['context length 131,072 tokens', 131072], ['context window of 131072', 131072],
      ['context=131072', 131072], ['contextTokens=131072', 131072], ['131072 tokens of context', 131072],
      ['--context-length=131072', 131072], ['--max-model-len 131072', 131072], ['--max_seq_len=131072', 131072],
      ['--ctx-size 131072', 131072], ['-c 131072', 131072],
    ]) {
      const words = `start qwen on spark 3 with ${phrase}`, result = await check(words);
      assert.equal(result.clear, true, phrase);
      assert.equal(result.input.contextTokens, tokens, phrase);
      const runner = actionRunner();
      assert.equal((await runner.run(words)).outcome, 'complete', phrase);
      assert.deepEqual(runner.launched, [{ model: 'qwen', spark: 'spark3', contextTokens: tokens }], phrase);
      assert.deepEqual(runner.proposed, []);
    }
  });

  test('the owner number overrides a mismatched brain value without mutating the tool arguments', async () => {
    const input = Object.freeze({ model: 'qwen', spark: 'spark4', contextTokens: 32768 });
    const result = await gate.sparkieCheck('start_model', input, context('start qwen on spark 3 with 128k context'));
    assert.equal(result.clear, true);
    assert.deepEqual(result.input, { model: 'qwen', spark: 'spark3', contextTokens: 131072 });
    assert.deepEqual(input, { model: 'qwen', spark: 'spark4', contextTokens: 32768 });
    const runner = actionRunner();
    await runner.run('start qwen on spark 3 with 128k context', { contextTokens: 32768 });
    assert.equal(runner.launched[0].contextTokens, 131072);
  });

  test('equal numeric statements agree and unrelated generation or memory numbers invent no context', async () => {
    assert.equal((await check('start qwen on spark 3 with 128k context, context length 131072')).input.contextTokens, 131072);
    for (const words of ['start qwen on spark 3 with 64 GB memory', 'start qwen on spark 3 with max output tokens 4096']) {
      const result = await check(words);
      assert.equal(result.clear, true, words);
      assert.equal(result.input.contextTokens, undefined, words);
    }
  });
});

describe('only this model clause supplies numeric authority', () => {
  test('another model clause and an earlier owner message cannot supply the current context', async () => {
    const words = 'start qwen on spark 3; start gemma on spark 4 with 64k context';
    assert.equal((await check(words)).input.contextTokens, undefined);
    const gemma = await check(words, { model: 'gemma' });
    assert.equal(gemma.input.contextTokens, 65536);
    const invented = await check(words, { contextTokens: 65536 });
    assert.equal(invented.clear, false, 'the other model number is only a proposal for qwen');
    const earlier = await check('start qwen on spark 3', { contextTokens: 131072 }, 'start qwen with 128k context');
    assert.equal(earlier.clear, false, 'a past message is not this start clause');
    const split = 'start qwen on spark 3 with 128k context; start gemma on spark 4 with 64k context';
    assert.equal((await check(split)).input.contextTokens, 131072);
    assert.equal((await check(split, { model: 'gemma' })).input.contextTokens, 65536);
  });

  test('described model limits and digits inside a model name are not a chosen context', async () => {
    for (const words of [
      'start qwen on spark 3 with its default context (the model supports 128k context)',
      'start qwen on spark 3 — its docs say it has 128k context',
      'start qwen on spark 3 with its advertised maximum 128k context',
      'start qwen on spark 3 with at most 128k context',
      'start qwen on spark 3 with qwen128k context',
    ]) {
      const result = await check(words);
      assert.equal(result.clear, false, words);
      assert.equal(result.input.contextTokens, undefined, words);
      assert.match(result.clarification, /context/i, words);
      const supplied = await check(words, { contextTokens: 131072 });
      assert.equal(supplied.clear, false, words);
      const runner = actionRunner(), question = await runner.run(words);
      assert.equal(question.outcome, 'question', words);
      assert.deepEqual(question.choices, [], words);
      assert.deepEqual(runner.launched, [], words);
    }
  });

  test('selecting quoted context asks for an unquoted number even when the brain omits it', async () => {
    for (const phrase of [
      'with "128k context"', "with '128k context'", 'with `128k context`', 'using “128k context”',
      'at "context length 128k tokens please"', 'using `--context-length 131072`',
    ]) {
      const words = `start qwen on spark 3 ${phrase}`, result = await check(words);
      assert.equal(result.clear, false, phrase);
      assert.equal(result.input.contextTokens, undefined, phrase);
      assert.match(result.clarification, /context/i, phrase);
      const runner = actionRunner(), question = await runner.run(words);
      assert.equal(question.outcome, 'question', phrase);
      assert.deepEqual(question.choices, [], phrase);
      assert.deepEqual(runner.launched, [], phrase);
    }
    const pasted = 'start qwen on spark 3\n> with "128k context"';
    assert.equal((await check(pasted)).clear, true, 'standalone pasted specs do not select a context');
    const split = 'start qwen on spark 3; start gemma on spark 4 with "128k context"';
    assert.equal((await check(split)).clear, true, 'another model owns the unresolved quoted context');
  });

  test('inline quotes, pasted settings, negated values and conditions do not become automatic owner constraints', async () => {
    for (const words of [
      'start qwen on spark 3 with "128k context"', "start qwen on spark 3 with '128k context'", 'start qwen on spark 3 with `128k context`',
      'start qwen on spark 3\n> context length 131072', 'start qwen on spark 3\n```\ncontext length 131072\n```',
      'start qwen on spark 3 without 128k context', 'start qwen on spark 3 with context not 128k',
      'start qwen on spark 3 if it supports 128k context', 'start qwen on spark 3 with 128k context if possible',
    ]) {
      const result = await check(words, { contextTokens: 131072 });
      assert.equal(result.clear, false, words);
      assert.equal((await check(words)).input.contextTokens, undefined, words);
    }
  });
});

describe('unsettled context is a question, never an executable default', () => {
  test('invented numeric tool input is proposed for confirmation instead of launching', async () => {
    const runner = actionRunner(), result = await runner.run('start qwen on spark 3', { contextTokens: 32768 });
    assert.equal(result.outcome, 'question');
    assert.deepEqual(runner.launched, []);
    assert.deepEqual(runner.proposed, [{ model: 'qwen', spark: 'spark3', contextTokens: 32768 }]);
  });

  test('ambiguous, invalid or unsupported context without a proposed number asks for clarification with no Start choice', async () => {
    for (const phrase of ['128k or 64k context', 'context 128k or 64k', '128k context, 64k context', 'context 0', 'context 2147483648', 'context 00128', '1M context']) {
      const words = `start qwen on spark 3 with ${phrase}`, runner = actionRunner();
      const result = await runner.run(words);
      assert.equal(result.outcome, 'question', phrase);
      assert.match(result.question, /context length|context tokens/i, phrase);
      assert.deepEqual(result.choices, [], 'no executable default-context Start');
      assert.deepEqual(runner.launched, [], phrase);
      assert.deepEqual(runner.proposed, [], phrase);
    }
  });

  test('a supplied number for ambiguous words still needs fresh visible consent, and repeated model clauses never collapse into one owner number', async () => {
    const runner = actionRunner();
    assert.equal((await runner.run('start qwen on spark 3 with 128k or 64k context', { contextTokens: 65536 })).outcome, 'question');
    assert.deepEqual(runner.launched, []);
    assert.equal(runner.proposed[0].contextTokens, 65536);
    const result = await check('start qwen on spark 3 with 128k context; start qwen on spark 4 with 64k context');
    assert.equal(result.clear, false);
    assert.equal(result.input.contextTokens, undefined);
    assert.match(result.clarification, /context/i);
    const combined = await check('start qwen and gemma on spark 3 with 128k context');
    assert.equal(combined.clear, false, 'a shared clause with another model is ambiguous');
    assert.equal(combined.input.contextTokens, undefined);
  });
});

test('a private context retry capability is neither a public plan input nor an unmasked record value', () => {
  const token = 'private-context-retry-token-for-this-test';
  const table = /^const PLAN_SKIP = new Set\(\[[\s\S]*?\n\]\);/m.exec(source)?.[0];
  assert.ok(table, 'the public plan has its explicit skip list');
  const planOf = new Function('tokensOf', 'squash', 'sparkNames', 'normQuotes', 'hubName', `${table}\n${fnOf(source, 'planOf')}\nreturn planOf;`)(gate.tokensOf, bindings.squash, gate.sparkNames, gate.normQuotes, () => 'Spark 1');
  const plan = planOf({ id: 'start_model', title: 'Start a model' }, { version: 'version', state: 'active' }, { model: 'qwen', spark: 'spark3', contextTokens: 32768, __contextRetryToken: token }, { via: 'page' });
  assert.ok(!JSON.stringify(plan).includes(token));
  assert.ok(!plan.inputs.some(i => i.name === '__contextRetryToken'));
  assert.ok(plan.inputs.some(i => i.name === 'contextTokens' && i.value === '32768'));
  const masking = part('20-mcp.mjs'), start = masking.indexOf('const SECRET_NAME'), end = masking.indexOf('\n}', masking.indexOf('function maskDeep', start)) + 2;
  assert.ok(start >= 0 && end > start);
  const maskDeep = new Function('maskSecrets', `${masking.slice(start, end)}\nreturn maskDeep;`)(String);
  assert.equal(maskDeep({ args: { __contextRetryToken: token } }).args.__contextRetryToken, '[hidden]');
});
