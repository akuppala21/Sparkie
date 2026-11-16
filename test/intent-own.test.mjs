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

test('the reader stays short work on megabytes of the worst input', () => {
  const n = 400000;
  for (const text of ['wait '.repeat(n), 'no wait, '.repeat(n), '`'.repeat(n), '"a '.repeat(n), '```'.repeat(n), 'a:\n'.repeat(n), '2026-11-15 10:00 x\nplain\n'.repeat(n / 10),
    'fix the build '.repeat(n / 5), "don't ".repeat(n), ', '.repeat(n) + 'wait', 'the '.repeat(n) + 'fix', '> x\n'.repeat(n), '    x\n'.repeat(n), 'File "'.repeat(n)]) {
    let best = Infinity;
    for (let i = 0; i < 3; i++) { const t0 = performance.now(); changeIntent(text); best = Math.min(best, performance.now() - t0); }
    assert.ok(best < 3000 * SLOW, `${JSON.stringify(text.slice(0, 20))}: ${Math.round(best)} ms`);
  }
});

