// Passes when: the built server matches its parts, the hidden check passes (models listed and answering), and the agent
// added or changed a test that covers the model list.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCheck, runHiddenTest, changedTests } from '../../grade-lib.mjs';

export default async function grade({ work, pristine }) {
  const checks = [];
  checks.push(buildCheck(work));
  const src = readFileSync(join(work, 'service/src/15-routes.mjs'), 'utf8');
  checks.push({ name: 'the planted bug is gone', pass: !src.includes("d.status === 'running'") });
  checks.push(await runHiddenTest(work, new URL('./hidden/zz-agentbar-hidden.test.mjs', import.meta.url)));
  const tests = changedTests(work, pristine).filter(t => /v1\/models|runningModels|\/v1/.test(t.text));
  checks.push({ name: 'a test covers it', pass: tests.length > 0, detail: tests.map(t => t.file).join(', ') || 'no new or changed test mentions /v1/models' });
  return checks;
}
