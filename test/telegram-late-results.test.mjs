// Covers: a slow approved action reports its real masked failure/follow-up in Telegram, and an old pairing cannot
// receive a delayed result or a retry after that pairing changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const text = readFileSync(new URL('../service/src/14-chats.mjs', import.meta.url), 'utf8');
const start = text.indexOf('function pressLate('), end = text.indexOf('\n}', start);
assert.ok(start >= 0 && end > start);
function fixture() {
  let current = true; const sends = [], answered = [];
  const env = {
    pressSaid: x => x, contextChoiceResult() {}, maskSecrets: x => String(x).replaceAll('example-secret', '[hidden]'),
    pressPost: (conv, content, asked) => ({ content, choices: asked?.choices || [] }),
    tgOwnerContextValid: () => current, tgAskedThere: () => false,
    tgFollowUp: (conv, message) => ({ text: message.content, buttons: message.choices }),
    tellAgain: (...args) => { sends.push(args); return Promise.resolve('sent'); }, taskAnswered: (...args) => answered.push(args),
    tgRanLine: () => 'Done.',
  };
  const late = new Function(...Object.keys(env), `${text.slice(start, end + 2)}\nreturn pressLate;`)(...Object.values(env));
  return { late, sends, answered, revoke() { current = false; } };
}
const conv = { id: 'owner-chat', messages: [] }, choice = { group: 'one' }, by = { via: 'telegram' };
test('delayed failures keep actual masked details and retries stay bound to the original owner', () => {
  const f = fixture();
  f.late({ out: { outcome: 'error', error: 'Drive is full: example-secret' }, content: 'The download failed: drive is full; example-secret' }, choice, conv, {}, by, () => null);
  assert.equal(f.sends.length, 1);
  assert.match(f.sends[0][1], /drive is full; \[hidden\]/);
  assert.doesNotMatch(f.sends[0][1], /details are in Spark Console|example-secret/);
  assert.equal(f.sends[0][2].isCurrent(), true);
  f.revoke(); assert.equal(f.sends[0][2].isCurrent(), false);
  f.late({ out: { outcome: 'error' }, content: 'Old private result' }, choice, conv, {}, by, () => null);
  assert.equal(f.sends.length, 1, 'a result that finished after re-pairing was not sent');
});
test('a slow action follow-up sends the same question and choices instead of requiring the page', () => {
  const f = fixture(), choices = [{ id: 'exact-choice', label: 'Keep these files' }];
  f.late({ out: { outcome: 'question' }, content: 'Keep these files?' }, choice, conv, {}, by, () => ({ choices }));
  assert.equal(f.sends.length, 1);
  assert.match(f.sends[0][1], /Keep these files\?/);
  assert.deepEqual(f.sends[0][2].buttons, choices);
  assert.equal(f.answered.length, 0, 'a task is not resumed before the owner answers');
});
