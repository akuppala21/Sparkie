// Covers: Brain ask helpers imported directly: untrusted setup fields are filtered, setup overrides and defaults stay
// consistent, role merging respects tool boundaries, streaming thinking tags work across chunk boundaries, tool call
// arguments stay intact, and model-reported token usage controls the next round's budget. No fleet or server is used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askBlock, withAsk, askOf, askSet, askedMessages, usageAsked, overBudget, answerReader } from '../service/src/13-ask.mjs';

test('untrusted ask fields keep only supported values and leave the input alone', () => {
  const raw = { thinking: true, maxTokens: 4096, sampling: { temperature: 0.3, top_p: 0.9, top_k: 20, unknown: 1, min_p: Infinity },
    templateKwargs: { enable_thinking: false, level: 2, label: 'brief', 'bad-key': true, nested: {} },
    mergeRoles: true, thinkTags: ['<reason>', '</reason>'], tokenBudget: 12000, toolRounds: 99 };
  const before = structuredClone(raw);
  assert.deepEqual(askBlock(raw), { thinking: true, maxTokens: 4096, sampling: { temperature: 0.3, top_p: 0.9, top_k: 20 },
    templateKwargs: { enable_thinking: false, level: 2, label: 'brief' }, mergeRoles: true, thinkTags: ['<reason>', '</reason>'], tokenBudget: 12000 });
  assert.deepEqual(raw, before);
  for (const bad of [null, [], 'settings', 1, { thinking: 1, maxTokens: 15, mergeRoles: 'yes', tokenBudget: 999, thinkTags: ['', '</think>'] },
    { maxTokens: 16.5, tokenBudget: Infinity, sampling: { temperature: NaN }, templateKwargs: { nested: [] } }]) {
    assert.deepEqual(askBlock(bad), {}, String(bad));
  }
  const kwargs = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`key${i}`, true]));
  assert.equal(Object.keys(askBlock({ templateKwargs: kwargs }).templateKwargs).length, 10);
});

test('valid ask overrides win while invalid fields preserve the setup and loop defaults', () => {
  const unchanged = { maxTokens: 2048, thinking: false };
  assert.equal(withAsk(unchanged), unchanged);
  const setup = withAsk({ ...unchanged, ask: { thinking: true, maxTokens: 1, mergeRoles: true, tokenBudget: 2000 } });
  assert.equal(setup.thinking, true);
  assert.equal(setup.maxTokens, 2048);
  assert.deepEqual(askSet(setup), { mergeRoles: true, tokenBudget: 2000 });
  assert.deepEqual(askOf({}), { mergeRoles: false, thinkTags: ['<think>', '</think>'], tokenBudget: null });
  assert.deepEqual(askSet({ sampling: { temperature: 0.3 }, thinking: true }), {});
});

test('adjacent plain roles merge without crossing tool, system, or structured-content boundaries', () => {
  const messages = [{ role: 'system', content: 'rules' }, { role: 'system', content: 'more rules' },
    { role: 'user', content: 'question' }, { role: 'user', content: 'notice' },
    { role: 'assistant', content: 'looking' }, { role: 'assistant', content: '', tool_calls: [{ id: 'c1' }] },
    { role: 'tool', content: 'one', tool_call_id: 'c1' }, { role: 'tool', content: 'two', tool_call_id: 'c2' },
    { role: 'assistant', content: 'answer' }, { role: 'assistant', content: 'detail' },
    { role: 'user', content: [{ type: 'text', text: 'structured' }] }, { role: 'user', content: 'plain' }];
  const before = structuredClone(messages);
  assert.equal(askedMessages({}, messages), messages);
  assert.deepEqual(askedMessages({ mergeRoles: true }, messages), [messages[0], messages[1],
    { role: 'user', content: 'question\n\nnotice' }, messages[4], messages[5], messages[6], messages[7],
    { role: 'assistant', content: 'answer\n\ndetail' }, messages[10], messages[11]]);
  assert.deepEqual(messages, before);
});

const event = delta => ({ choices: [{ delta }] });
const read = (pieces, setup = {}) => {
  const reader = answerReader(setup), got = pieces.map(content => reader.take(event({ content })));
  return { text: got.flatMap(part => part.text).concat(reader.end()).join(''), thinking: got.some(part => part.thinking) };
};
test('thinking tags are hidden at every stream split, including custom tags and one-character chunks', () => {
  for (const [setup, text] of [[{}, ' \n<think>private reasoning</think>\n\nVisible answer'],
    [{ thinkTags: ['<reason>', '</reason>'] }, '<reason>private reasoning</reason> Visible answer']]) {
    for (let split = 0; split <= text.length; split++) {
      assert.deepEqual(read([text.slice(0, split), text.slice(split)], setup), { text: 'Visible answer', thinking: true }, `split ${split}`);
    }
    assert.deepEqual(read([...text], setup), { text: 'Visible answer', thinking: true });
  }
  assert.equal(read(['<think>unfinished private reasoning']).text, '');
  assert.equal(read(['Answer with <think> as a literal.']).text, 'Answer with <think> as a literal.');
});

test('a partial opening tag and plain whitespace are released at EOF; reasoning fields never become answer text', () => {
  for (const text of ['<thi', ' \n', ' <third>plain answer']) assert.equal(read([...text]).text, text);
  const reader = answerReader({});
  for (const delta of [{ reasoning_content: 'private one' }, { reasoning: 'private two' }]) {
    assert.deepEqual(reader.take(event(delta)), { thinking: true, text: [], any: true });
  }
  assert.deepEqual(reader.take(event({ content: 'Visible' })).text, ['Visible']);
  assert.deepEqual(reader.end(), []);
});

test('interleaved tool calls preserve their argument fragments and the final usage event', () => {
  const reader = answerReader({});
  reader.take(event({ tool_calls: [{ index: 1, id: 'second', function: { name: 'fleet_', arguments: '{' } },
    { index: 0, id: 'first', function: { name: 'start_', arguments: '{"model":"' } }] }));
  reader.take(event({ tool_calls: [{ index: 0, function: { name: 'model', arguments: 'Qwen","spark":"spark3"}' } },
    { index: 1, function: { name: 'status', arguments: '}' } }, { index: 2, id: 'nameless', function: { arguments: '{}' } }] }));
  reader.take({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 900, completion_tokens: 80 } });
  const usage = { prompt_tokens: 900, completion_tokens: 100 };
  reader.take({ choices: [], usage });
  assert.deepEqual(reader.result(), { calls: [{ id: 'first', name: 'start_model', args: '{"model":"Qwen","spark":"spark3"}' },
    { id: 'second', name: 'fleet_status', args: '{}' }], finish: 'tool_calls', usage });
});

test('token budgets request usage and apply only when reported totals reach the valid limit', () => {
  assert.deepEqual(usageAsked({}), {});
  assert.deepEqual(usageAsked({ tokenBudget: 999 }), {});
  assert.deepEqual(usageAsked({ tokenBudget: 1000 }), { stream_options: { include_usage: true } });
  for (const [usage, expected] of [[null, false], [{ prompt_tokens: 900, completion_tokens: 99 }, false],
    [{ prompt_tokens: 900, completion_tokens: 100 }, true], [{ prompt_tokens: 1100 }, true], [{ prompt_tokens: '900', completion_tokens: '100' }, true]]) {
    assert.equal(overBudget({ tuned: { tokenBudget: 1000 }, usage }), expected);
    assert.equal(overBudget({ tuned: {}, usage }), false);
  }
});
