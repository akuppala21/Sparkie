// Covers: brain model edits select the direct immutable-image, desired-intent and start-recovery fixtures as well as
// measured service checks, in both ordinary and landing picks, without requiring every test file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choose, SHORT_CHECK } from '../tools/affected.mjs';

for (const landing of [false, true]) {
  test(`brain model fixtures survive an integration-only coverage map (${landing ? 'landing' : 'ordinary'})`, () => {
    const pick = choose({ landing,
      map: { tests: ['test/api.test.mjs', 'test/fleet.test.mjs', 'test/sparkie.test.mjs'],
        fns: { '13-main-model.mjs:mainImageRef@1-3': [2] } },
      changes: [{ path: 'service/src/13-main-model.mjs', status: 'M',
        hunks: [{ s: 2, n: 1, t: 2, add: ['  return 2;'] }] }],
      oldText: () => 'function mainImageRef() {\n  return 1;\n}',
      newText: () => 'function mainImageRef() {\n  return 2;\n}',
    });
    assert.equal(pick.all, false, pick.why);
    for (const file of ['test/brain-readiness.test.mjs', 'test/brain.test.mjs', 'test/sparkie.test.mjs', ...SHORT_CHECK]) {
      assert.ok(pick.files.includes(file), file);
    }
    assert.ok(!pick.files.includes('test/download-stall.test.mjs'), 'unrelated direct fixtures are not added');
  });
}
