// Covers: changes to saved-run retirement select both its direct fixture and measured service checks, even when
// the service coverage map cannot see the direct multi-run control or remote download supervisor. Existing short checks remain selected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choose, SHORT_CHECK } from '../tools/affected.mjs';

test('retirement edits retain direct controls and measured recovery coverage', () => {
  const before = 'function savedRunDone() {\n  return 1;\n}';
  const after = 'function savedRunDone() {\n  return 2;\n}';
  const pick = choose({ landing: true,
    map: { tests: ['test/workloads-restart.test.mjs'], fns: { '18-run-record.mjs:savedRunDone@1-3': [0] } },
    changes: [{ path: 'service/src/18-run-record.mjs', status: 'M', hunks: [{ s: 2, n: 1, t: 2, add: ['  return 2;'] }] }],
    oldText: () => before, newText: () => after,
  });
  assert.equal(pick.all, false, pick.why);
  for (const file of ['test/workloads-retirement.test.mjs', 'test/workloads-record-errors.test.mjs',
    'test/workloads-restart.test.mjs', ...SHORT_CHECK]) assert.ok(pick.files.includes(file), file);
});

test('download supervisor edits retain direct process and transfer controls', () => {
  const pick = choose({ landing: true,
    map: { tests: ['test/download-admission.test.mjs'], fns: { '11-downloads.mjs:downloadResume@1-3': [0] } },
    changes: [{ path: 'service/src/11-downloads.mjs', status: 'M', hunks: [{ s: 2, n: 1, t: 2, add: ['  return 2;'] }] }],
    oldText: () => 'function downloadResume() {\n  return 1;\n}',
    newText: () => 'function downloadResume() {\n  return 2;\n}',
  });
  assert.equal(pick.all, false, pick.why);
  for (const file of ['test/download-stall.test.mjs', 'test/download-admission.test.mjs', ...SHORT_CHECK])
    assert.ok(pick.files.includes(file), file);
});
