// Grades one run, inside its container: node grade.mjs <task> <workspace> <pristine.json>
// Prints one line of JSON: { task, pass, checks: [{ name, pass, detail }] }. A run passes only when every check does.
import { readFileSync } from 'node:fs';

const [task, work, pristineFile] = process.argv.slice(2);
const pristine = JSON.parse(readFileSync(pristineFile, 'utf8'));
let checks;
try {
  const { default: grade } = await import(new URL(`./tasks/${task}/grade.mjs`, import.meta.url));
  checks = await grade({ work, pristine, env: process.env });
} catch (e) {
  checks = [{ name: 'the grader ran', pass: false, detail: String(e.stack || e).slice(0, 1500) }];
}
console.log(JSON.stringify({ task, pass: checks.length > 0 && checks.every(c => c.pass), checks }));
process.exit(0);
