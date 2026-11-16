// The coding trial's shared pieces (agentbar/trial.mjs, and its test): the task set and its version, what a task may
// never touch, a record's sha256, and the grade, all by code. Spark Console computes the task set's version the same
// way (trialSetNow, service/src/21-brain-trial.mjs) and a record's sha256 the same way (trialHash): the two must agree,
// or no record counts.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

// Every file under the task set's folder, by its path there: the set's version is the sha256 of each path and the
// sha256 of its bytes, in path order. A changed prompt, plant or test is a new set, and no record of the old one counts.
export function taskSetVersion(dir) {
  const files = [];
  const walk = d => { for (const n of readdirSync(d).sort()) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else files.push(p); } };
  walk(dir);
  const h = createHash('sha256');
  for (const f of files.sort((a, b) => relative(dir, a).localeCompare(relative(dir, b)))) h.update(`${relative(dir, f)}\0${createHash('sha256').update(readFileSync(f)).digest('hex')}\n`);
  return h.digest('hex');
}
// The tasks: each folder with a task.json ({id, title, minutes, test, plant: {file, good, bad}}), a prompt.md (what the
// brain is asked) and a test.mjs (the failing test plant.mjs puts at `test`).
export function taskSet(dir) {
  const ids = readdirSync(dir).filter(t => existsSync(join(dir, t, 'task.json'))).sort();
  return { version: taskSetVersion(dir), ids, tasks: ids.map(id => ({ ...JSON.parse(readFileSync(join(dir, id, 'task.json'), 'utf8')), id })) };
}

// What a task may never touch (design C 2.5, "What Sparkie may never change on its own word"): anything under .github/,
// AGENTS.md, the map and the contract, and the paths that always run the whole suite (tools/affected.mjs ALWAYS); of
// tools/, only build-server.mjs and affected.mjs. (A folder's own name too: a repository nested there hides its files.)
export const PROTECTED = [/^\.github(\/|$)/, /^AGENTS\.md$/, /^docs\/architecture\.md$/, /^docs\/contract\.md$/, /^service\/(passkey|dig)\.mjs$/, /^service\/worker\.py$/,
  /^service\/config\.json$/, /^deploy(\/|$)/, /^test\/lib\.mjs$/, /^test\/start-mock\.mjs$/, /^test\/mock(\/|$)/, /^test\/lock\.mjs$/, /^tools\/(build-server|affected)\.mjs$/];

// A record as Spark Console reads it for its sha256 (evalCanon, 21-brain-eval.mjs): every object's fields in name
// order. The sha256 the runner prints is the one on the owner's button.
export const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(n => [n, x[n]])) : x));
export const recordHash = r => createHash('sha256').update(canon(r)).digest('hex');

// The grade of one task's workspace, by code, in order; a check after a failed one isn't run (the short check takes
// minutes). Nothing the brain could change is trusted:
// - what changed is read by the runner's own git (git(args) gives { exit, out }): a repository outside the workspace,
//   made at the plant, holding the planted task as its one commit (HEAD). Its config is the runner's, so no filter or
//   diff program the brain set up runs, and ignored files are added too;
// - box.exec(command, seconds) runs one shell command in the workspace, in the box, and gives { exit, out }; of the
//   repository's tools it trusts only protected ones: tools/build-server.mjs says server.mjs is its parts, whatever
//   tools/make.mjs says.
export async function gradeTask(box, task, { short, git }) {
  const checks = [], add = (name, pass, detail = '') => { checks.push({ name, pass, ...(pass ? {} : { detail: String(detail).slice(-1500) }) }); return pass; };
  const DIFF = ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--no-renames'];
  const added = git(['add', '-A', '--force', '.']), changed = added.exit === 0 ? git([...DIFF, '--name-status', '-z', 'HEAD']) : added;
  const paths = changed.out.split('\0').filter((x, i) => i % 2 === 1 && x);
  const touched = paths.filter(p => PROTECTED.some(re => re.test(p)));
  if (!add('no protected path touched', changed.exit === 0 && !touched.length, changed.exit ? changed.out : touched.join(', '))) return checks;
  // (an existing test line removed or edited: a "-" line inside a hunk of a test file that was there at the plant, or
  // the file gone)
  const diff = git([...DIFF, '-U0', 'HEAD', '--', 'test/*.test.mjs']), removed = [];
  let hunk = false;
  for (const line of diff.out.split('\n')) {
    if (line.startsWith('diff --git ')) hunk = false;
    else if (line.startsWith('@@')) hunk = true;
    else if ((hunk && line.startsWith('-')) || (!hunk && line.startsWith('deleted file'))) removed.push(line);
  }
  if (!add('no existing test line removed or edited', diff.exit === 0 && !removed.length, diff.exit ? diff.out : removed.slice(0, 20).join('\n'))) return checks;
  const made = await box.exec('{ node tools/build-server.mjs --check && node tools/make.mjs --check; } 2>&1 | tail -20; exit "${PIPESTATUS[0]}"', 300);
  if (!add('the generated files are what the build makes (node tools/make.mjs)', made.exit === 0, made.out)) return checks;
  const own = await box.exec(`node --test ${task.test} 2>&1 | tail -30; exit "\${PIPESTATUS[0]}"`, 300);
  if (!add(`the task's test passes (${task.test})`, own.exit === 0 && /ℹ fail 0/.test(own.out) && /ℹ pass [1-9]/.test(own.out), own.out)) return checks;
  const all = await box.exec(`node --test --test-concurrency=4 ${short.join(' ')} 2>&1 | tail -40; exit "\${PIPESTATUS[0]}"`, 40 * 60);
  add(`the short check passes (${short.length} file${short.length === 1 ? '' : 's'})`, all.exit === 0 && /ℹ fail 0/.test(all.out) && /ℹ cancelled 0/.test(all.out) && /ℹ pass [1-9]/.test(all.out), all.out);
  return checks;
}
// The short check as this tree names it (tools/affected.mjs: SHORT_CHECK and the documents' test).
export async function shortCheck(repo) {
  const m = await import(pathToFileURL(join(repo, 'tools', 'affected.mjs')).href);
  return [...m.SHORT_CHECK, m.DOCS_TEST];
}
