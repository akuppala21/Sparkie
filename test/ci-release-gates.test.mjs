// Covers: the installable release lock waits for both the complete strict suite and the browser check.
// Failed, cancelled or skipped prerequisites cannot be bypassed by a qualification job condition.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/full-run.yml', import.meta.url), 'utf8');
const job = name => {
  const block = new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [A-Za-z_][A-Za-z0-9_-]*:|$(?![\\s\\S]))`, 'm').exec(workflow)?.[1];
  assert.ok(block, `Missing release job: ${name}`);
  return block;
};

test('the lock artifact is published only after suite and browser both succeed', () => {
  const qualify = job('qualify');
  const needs = /^    needs:\s*\[([^\]\n]+)\]\s*$/m.exec(qualify)?.[1].split(',').map(s => s.trim());
  assert.ok(needs?.includes('suite'), 'qualification needs every strict shard');
  assert.ok(needs?.includes('browser'), 'qualification needs the browser check before publishing its lock');
  const condition = /^    if:\s*(.*)$/m.exec(qualify)?.[1];
  assert.ok(condition === undefined || condition === 'success()', 'qualification cannot run after a failed, cancelled or skipped prerequisite');
  assert.match(qualify, /name: workflows-lock-\$\{\{ github\.run_attempt \}\}/, 'qualification owns the attempt-specific installable lock');
});
