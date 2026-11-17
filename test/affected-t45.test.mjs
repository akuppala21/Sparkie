// Covers: engine, rollback, stopped-work and desired-state checks select their direct boundary and return fixtures alongside
// measured fleet checks, so source-extracted regressions cannot disappear from a focused landing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choose, SHORT_CHECK } from '../tools/affected.mjs';

for (const [part, required] of [
  ['08-cluster.mjs', ['test/t45-engine-boundary.test.mjs']],
  ['17-changes.mjs', ['test/t45-return.test.mjs', 'test/t45-restart-intent.test.mjs']],
  ['17-rollback-target.mjs', ['test/t45-return.test.mjs', 'test/t45-target.test.mjs', 'test/t45-job-folder.test.mjs', 'test/t45-created-receipt.test.mjs']],
  ['17-rollback.mjs', ['test/t45-return.test.mjs', 'test/t45-adopt-job.test.mjs', 'test/t45-recovery-words.test.mjs']],
  ['17-stop-checked.mjs', ['test/t45-return.test.mjs', 'test/t45-recovery-words.test.mjs']],
  ['21-apps.mjs', ['test/t45-job-folder.test.mjs', 'test/t45-adopt-job.test.mjs']],
  ['20-desired.mjs', ['test/t45-return.test.mjs']],
]) {
  test(`${part} keeps its direct rollback fixtures without measured server coverage`, () => {
    const pick = choose({ landing: true,
      map: { tests: ['test/t45-fleet.test.mjs'], fns: { [`${part}:fixture@1-3`]: [0] } },
      changes: [{ path: `service/src/${part}`, status: 'M',
        hunks: [{ s: 2, n: 1, t: 2, add: ['  return 2;'] }] }],
      oldText: () => 'function fixture() {\n  return 1;\n}',
      newText: () => 'function fixture() {\n  return 2;\n}',
    });
    assert.equal(pick.all, false, pick.why);
    for (const file of [...required, 'test/t45-fleet.test.mjs', ...SHORT_CHECK]) assert.ok(pick.files.includes(file), file);
    if (part !== '17-rollback-target.mjs') assert.ok(!pick.files.includes('test/t45-target.test.mjs'), 'target-only fixture follows its own source part');
  });
}
