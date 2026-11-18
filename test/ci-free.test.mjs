// Covers: hosted test jobs require public repository visibility before a runner starts, use standard Ubuntu runners, and bound artifact retention.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const sources = ['full-run', 'focused'].map(name => [name, readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8')]);
test('every independent hosted job refuses a private or unknown repository visibility', () => {
  for (const [name, source] of sources) {
    const jobs = [...source.matchAll(/^  ([a-z][a-z_-]*):\n([\s\S]*?)(?=^  [a-z][a-z_-]*:|$(?![\s\S]))/gm)].filter(m => /^    runs-on:/m.test(m[2]));
    assert.ok(jobs.length, name);
    for (const [, id, block] of jobs.filter(m => !/^    needs:/m.test(m[2]))) {
      const condition = /^    if: (.+)$/m.exec(block)?.[1];
      assert.ok(condition, `${name}/${id} must gate spending before starting a runner`);
      assert.equal(condition.replace(/^inputs\.browser && /, ''), "github.event.repository.visibility == 'public'", `${name}/${id} must fail closed for private or missing visibility`);
    }
  }
});
test('hosted checks use only the standard Ubuntu runner with no paid label or input', () => {
  for (const [name, source] of sources) {
    const runners = [...source.matchAll(/^    runs-on: (.+)$/gm)].map(m => m[1]);
    assert.ok(runners.length, name);
    for (const runner of runners) assert.equal(runner, 'ubuntu-24.04', name);
  }
});
test('each uploaded artifact has an explicit retention of at most seven days', () => {
  for (const [name, source] of sources) {
    const uploads = [...source.matchAll(/uses: actions\/upload-artifact@[^\n]+\n([\s\S]*?)(?=^      -|^  [a-z]|$(?![\s\S]))/gm)];
    assert.ok(uploads.length, name);
    for (const [, block] of uploads) {
      const days = Number(/retention-days: (\d+)/.exec(block)?.[1]);
      assert.ok(days >= 1 && days <= 7, `${name}: bounded artifact retention`);
    }
  }
});
