// Passes when: the built server matches its parts, the hidden check passes (disk_free through the agent door), the
// agent door's own tests still pass (they compare the tool list exactly, so the new tool had to be added to it), and
// the agent added a test that uses disk_free.
import { buildCheck, runHiddenTest, runRepoTest, changedTests } from '../../grade-lib.mjs';

export default async function grade({ work, pristine }) {
  const checks = [];
  checks.push(buildCheck(work));
  checks.push(await runHiddenTest(work, new URL('./hidden/zz-agentbar-hidden.test.mjs', import.meta.url)));
  checks.push(await runRepoTest(work, 'test/door.test.mjs', 'the agent door\'s tests still pass'));
  const tests = changedTests(work, pristine).filter(t => /disk_free/.test(t.text));
  checks.push({ name: 'a test covers it', pass: tests.length > 0, detail: tests.map(t => t.file).join(', ') || 'no new or changed test mentions disk_free' });
  return checks;
}
