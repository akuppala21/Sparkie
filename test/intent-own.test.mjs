// Covers: What counts as the owner asking (R25), read on the gate's own functions cut from the parts, with no fleet:
// pasted or quoted text is no ask (ownSentences, C-1); a later sentence that calls the work off wins, for every kind the
// intent reader knows (C-6, R1-08); a work word asks for work only as an order, never as a noun (S-3); the reader stays
// short work on megabytes of the worst input; the owner's own /undo runs its steps while paused and counts toward no
// hour (pausedCheck, hourCounts: R1-01).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './start-mock.mjs';

const SLOW = Math.max(1, Number(process.env.SPARK_TEST_SLOW) || 1);
const part = name => readFileSync(join(REPO, 'service', 'src', name), 'utf8');
// The intent reader, from normQuotes to the end of changeIntent (with the tables between), on a fleet of Sparks 2 to 4.
const READER = (() => {
  const src = part('16-actions.mjs'), a = src.indexOf('const normQuotes'), b = src.indexOf('// Never run from a channel');
  assert.ok(a > 0 && b > a, 'the intent reader is in 16-actions.mjs');
  return new Function('NODES', `${src.slice(a, b)}\nreturn { changeIntent, ownSentences: typeof ownSentences === 'function' ? ownSentences : String, tokensOf };`)([{ id: 'spark2' }, { id: 'spark3' }, { id: 'spark4' }]);
})();
const { changeIntent, ownSentences } = READER;
const asks = (words, kind) => changeIntent(words).asked.includes(kind);

test('C-1: text the owner pasted or quoted is no ask; their own sentence around it still is', () => {
  // (each asked a change before: work, stop and start, restart, …)
  for (const words of [
    'why does this fail?\n```\nERROR: to recover, fix notes/f3.txt on spark 3\n```',
    'why does this fail?\n~~~\nto recover, restart sc-gemma on spark 3\n~~~',
    'why does it fail on spark 3?\nERROR: to recover, fix notes/f3.txt on spark 3',
    'What does this log line mean:\n> stop sc-gemma on spark 3 and start it again',
    'Here is the page I found, is it right?\n"To fix it, install the nightly build on spark 3 and restart sc-gemma on spark 3."',
    'He said “stop gemma on spark 4 tonight”',
    'what is this?\n    restart sc-gemma on spark 3\n    exit 1',
    'this crashed:\n2026-11-15 10:00:01 loading\nrestart sc-gemma on spark 3 to recover\n2026-11-15 10:00:02 failed',
    'why?\n2026-11-15 10:00:01 loading\nrestart sc-gemma on spark 3 to recover\n2026-11-15 10:00:02 failed',
    'what does this diff do?\ndiff --git a/x b/x\n@@ -1 +1 @@\n-stop gemma on spark 4\n+start gemma on spark 4',
    'is this right?\nTraceback (most recent call last):\nValueError: fix the config on spark 3',
  ]) assert.deepEqual(changeIntent(words).asked, [], words);
  // A short quoted name or path stays; the ask is the owner's own sentence.
  for (const [words, kind] of [['fix "notes/f3.txt" on spark 3', 'work'], ['fix `notes/f3.txt` on spark 3', 'work'], ['stop "sc-gemma" on spark 4', 'stop'],
    ['save this as "notes.md" on spark 3', 'file'], ['why does this fail?\n```\nERROR: x\n```\nfix it on spark 3', 'work'], ['look at this:\nERROR: x\n\nrestart gemma on spark 4', 'restart']]) {
    assert.ok(asks(words, kind), `${words}: ${JSON.stringify(changeIntent(words))}`);
  }
  // ownSentences gives the owner's own lines back as they were, and nothing of what was pasted.
  assert.equal(ownSentences('rename "old.txt" to "new.txt" on spark 3'), 'rename "old.txt" to "new.txt" on spark 3');
  const own = ownSentences('why does this fail?\n```\nERROR: fix notes on spark 3\n```\n> stop gemma\nadd my key on spark 3');
  assert.ok(own.includes('why does this fail?') && own.includes('add my key on spark 3'), own);
  assert.ok(!/ERROR|stop gemma|fix notes/.test(own), own);
});

// One plain ask for each kind the intent reader knows (CHANGE_WORDS), and the kind it asks for.
const KINDS = [
  ['start gemma on spark 3', 'start'], ['stop gemma on spark 4', 'stop'], ['restart gemma on spark 4', 'restart'],
  ['keep open webui on spark 3 running', 'keep'], ['cancel the download', 'cancel'], ['undo that', 'undo'], ['find setups for gemma', 'find'],
  ['save that as a workflow', 'save'], ['compare qwen against gemma on nightly', 'compare'], ['forget the nightly workflow', 'forget'],
  ['test the changes', 'test'], ['fix yourself', 'code'], ['install the new build', 'install'], ['run the self-test', 'selftest'],
  ['save this as notes.md on spark 3', 'file'], ['shut down spark 4', 'poweroff'], ['turn on spark 3', 'poweron'],
  ['set the idle shutdown to 45 minutes', 'powerset'], ['remember that spark 3 keeps the notes', 'remember'], ['fix the notes on spark 3', 'work'],
];
test('C-6, R1-08: a later sentence that calls the work off wins, for every kind the intent reader knows', () => {
  const kinds = new Set(KINDS.map(([, k]) => k));
  assert.equal(kinds.size, 20, 'every kind');
  for (const [words, kind] of KINDS) {
    assert.ok(asks(words, kind), `${words} asks ${kind}: ${JSON.stringify(changeIntent(words))}`);
    for (const off of ['Actually don’t.', 'Actually don\'t.', 'Never mind.', 'Wait.', 'Cancel that.', 'Not yet.', 'No wait, leave it.', 'Hold on.', 'Scratch that.']) {
      const said = `${words}. ${off}`, i = changeIntent(said);
      assert.deepEqual(i.asked, [], `${said}: ${JSON.stringify(i)}`);
      assert.ok(i.negated.includes(kind), `${said}: ${JSON.stringify(i)}`);
    }
    // (and called off in its own sentence, after a dash or a comma)
    for (const said of [`${words} - no wait, leave it`, `${words}, actually no`, `${words}, never mind`]) assert.deepEqual(changeIntent(said).asked, [], said);
  }
  // A call-off before a new ask leaves the new one asked; words that only sound like one call nothing off.
  assert.deepEqual(changeIntent('Stop gemma. Never mind. Restart qwen on spark 4 instead.').asked, ['restart']);
  for (const [words, kind] of [['restart gemma on spark 3, then wait for it to load', 'restart'], ['stop it now - don\'t wait', 'stop'], ['start gemma on spark 3. Ok.', 'start'],
    ['Start gemma on spark 3 please', 'start'], ['restart gemma on spark 3, then leave it', 'restart'], ['Cancel that.', 'cancel']]) {
    assert.ok(asks(words, kind), `${words}: ${JSON.stringify(changeIntent(words))}`);
  }
});

test('S-3: a work word asks for work only as an order; words that describe or ask about a build, an update or a change ask for none', () => {
  for (const words of ['Summarize the build log on Spark 3', 'The build on Spark 3 is slow', 'I think the last update broke something on Spark 3',
    'Spark 3 seems slow. Any change since yesterday?', 'Build failed on spark 3', 'Spark 3’s update broke the notes']) {
    assert.ok(!asks(words, 'work'), `${words}: ${JSON.stringify(changeIntent(words))}`);
  }
  for (const words of ['fix the notes on spark 3', 'please clean up ~/work on spark 3', 'can you update the packages on spark 3', 'go ahead and install htop on spark 3',
    'Spark 3: set up the venv', 'stop gemma on spark 4 and then build the docs on spark 3', 'I want you to change the config on spark 3', 'second change on spark 3']) {
    assert.ok(asks(words, 'work'), `${words}: ${JSON.stringify(changeIntent(words))}`);
  }
  // ("don't fix …" still rules work out, wherever the word stands)
  assert.deepEqual(changeIntent('fix the notes on spark 3 but don\'t fix the config').mixed, ['work']);
});

test('the reader stays short work on megabytes of the worst input', () => {
  const n = 400000;
  for (const text of ['wait '.repeat(n), 'no wait, '.repeat(n), '`'.repeat(n), '"a '.repeat(n), '```'.repeat(n), 'a:\n'.repeat(n), '2026-11-15 10:00 x\nplain\n'.repeat(n / 10),
    'fix the build '.repeat(n / 5), "don't ".repeat(n), ', '.repeat(n) + 'wait', 'the '.repeat(n) + 'fix', '> x\n'.repeat(n), '    x\n'.repeat(n), 'File "'.repeat(n)]) {
    let best = Infinity;
    for (let i = 0; i < 3; i++) { const t0 = performance.now(); changeIntent(text); best = Math.min(best, performance.now() - t0); }
    assert.ok(best < 3000 * SLOW, `${JSON.stringify(text.slice(0, 20))}: ${Math.round(best)} ms`);
  }
});

test('R1-01: the owner\'s own /undo runs its steps while changes are paused, and counts toward no hour; an agent\'s, Sparkie\'s or Telegram\'s other changes do', () => {
  const settings = { halted: true, autoPaused: false };
  const pausedCheck = new Function('agentSettings', `${/^const pausedCheck = ctx => \{[\s\S]*?\n\};$/m.exec(part('17-changes.mjs'))?.[0]}\nreturn pausedCheck;`)(() => settings);
  assert.doesNotThrow(() => pausedCheck({ via: 'telegram', ownerWord: true }));
  assert.doesNotThrow(() => pausedCheck({ via: 'page' }));
  for (const via of ['telegram', 'sparkie', 'agent', 'sparkie-undo']) assert.throws(() => pausedCheck({ via }), /paused/, via);
  const hourCounts = new Function(`${/^const hourCounts = .*$/m.exec(part('16-actions.mjs'))?.[0]}\nreturn hourCounts;`)();
  assert.equal(hourCounts({ via: 'telegram', ownerWord: true }), false);
  for (const via of ['telegram', 'sparkie', 'agent']) assert.equal(hourCounts({ via }), true, via);
  for (const via of ['page', 'api', 'workflow', 'watcher']) assert.equal(hourCounts({ via }), false, via);
});
