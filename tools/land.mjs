// Lands one step on main (R29): the tests its change needs, on a Spark, then a fast-forward. No batches, and no whole
// suite for every change: the whole suite runs after every landing, in the background, and an install still needs it
// on that exact build (the installer's lock check).
//
//   node tools/land.mjs <branch>             land <branch> on main (from any Spark Console work folder)
//   node tools/land.mjs --whole <branch>     the same with the whole suite first, whatever the pick says
//   node tools/land.mjs --catch-up <branch>  bring <branch> up to date: merge main in its folder, make the generated
//                                            files again (node tools/make.mjs), commit
//   node tools/land.mjs --status             the last landings and whole runs (and records whole runs that ended)
//
// It refuses unless <branch> has a work folder of its own and it is clean, the branch holds main's tip (--catch-up
// first), the main folder (the one with main checked out) is clean, and `node tools/make.mjs --check` passes on the
// branch with main in it. Then `pick --landing` (tools/affected.mjs) against main, and those files from the branch's
// folder through the Spark runner (tools/test-on-spark.sh --ask; SPARK_TEST_OUT says whose queue), or the whole suite
// for all, waited on. On a pass, and only if main has not moved and the branch is still what was tested,
// `git merge --ff-only` in the main folder. One landing at a time (spark-landings.lock, beside the work folders); one
// line per landing in spark-landings.log there, beside the runners' results.
//
// After a landing that changed code, one request for the main folder's whole suite is left in a runner's queue
// (SPARK_LAND_TIP_OUT, or spark-test-runs beside the work folders) and not waited on; none when one is already waiting
// there, which will test the newest main anyway. Its result is recorded the next time this runs, or with --status: a
// pass leaves the lock and map that are that build's tested record (the next pick measures from it); a failure names
// the landings since the last tested build and the files the pick missed. It never pushes, installs or edits a test,
// and wakes no Spark. SPARK_LAND_RUNNER: a stand-in for the runner (tests).
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, rmSync, readdirSync, renameSync, realpathSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pick, findMaps, lastTested, noteMissed, failedIn, gitTop } from './affected.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const short = c => String(c || '').slice(0, 7);
const git = (dir, ...args) => { const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; };
const isAncestor = (dir, a, b) => spawnSync('git', ['-C', dir, 'merge-base', '--is-ancestor', a, b]).status === 0;
const clean = dir => git(dir, 'status', '--porcelain') === '';
const read = f => { try { return readFileSync(f, 'utf8'); } catch { return null; } };
const readJson = f => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

class Refused extends Error {}
const refuse = why => { throw new Refused(why); };

// The work folders and where things live: the main folder (main checked out), the log and lock beside the work folders,
// and the runner's queue.
function places(here) {
  const trees = [];
  for (const l of (git(here, 'worktree', 'list', '--porcelain') || '').split('\n')) {
    if (l.startsWith('worktree ')) trees.push({ path: l.slice(9) });
    else if (l.startsWith('branch refs/heads/') && trees.length) trees.at(-1).branch = l.slice(18);
  }
  const main = trees.find(t => t.branch === 'main')?.path;
  if (!main) refuse('No work folder has main checked out, so there is nowhere to land.');
  const base = dirname(main);
  return { trees, main, base, log: join(base, 'spark-landings.log'), lock: join(base, 'spark-landings.lock'),
    out: process.env.SPARK_TEST_OUT || join(base, 'spark-test-runs'), tipOut: process.env.SPARK_LAND_TIP_OUT || join(base, 'spark-test-runs') };
}

const note = (p, e) => appendFileSync(p.log, `${JSON.stringify({ at: new Date().toISOString(), ...e })}\n`);
const entries = p => (read(p.log) || '').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

// One landing at a time: a folder with who holds it, put in place in one step (a rename, which fails while another is
// there). One left by a landing that has ended is taken over. Returns who holds it when that isn't this process.
function tryLock(p, branch) {
  for (let i = 0; i < 2; i++) {
    const mine = `${p.lock}.${process.pid}`;
    mkdirSync(mine, { recursive: true });
    writeFileSync(join(mine, 'owner.json'), JSON.stringify({ pid: process.pid, branch, at: new Date().toISOString() }));
    try {
      renameSync(mine, p.lock);
      process.on('exit', () => { if (readJson(join(p.lock, 'owner.json'))?.pid === process.pid) rmSync(p.lock, { recursive: true, force: true }); });
      return null;
    } catch (e) {
      rmSync(mine, { recursive: true, force: true });
      if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(e.code)) throw e;
      const owner = readJson(join(p.lock, 'owner.json'));
      if (owner && alive(owner.pid)) return owner;
      rmSync(p.lock, { recursive: true, force: true });
    }
  }
  return { branch: 'another', at: 'just now' };
}
function takeLock(p, branch) {
  const owner = tryLock(p, branch);
  if (owner) refuse(`Another landing is under way (${owner.branch}, since ${owner.at}). When it has ended, run this again; if it landed, bring ${branch} up to date with main first.`);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(sig, () => process.exit(130));
}

// The Spark runner's answer for these files (none: the whole suite), asked from the branch's folder.
function ask(dir, files) {
  const runner = process.env.SPARK_LAND_RUNNER || join(ROOT, 'tools', 'test-on-spark.sh');
  return new Promise(resolve => {
    const child = spawn('bash', [runner, '--ask', ...files], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    child.stdout.on('data', d => { text += d; process.stdout.write(d); });
    child.stderr.on('data', d => { text += d; process.stderr.write(d); });
    child.on('close', code => resolve({ code, log: /^Whole log: (.+)$/m.exec(text)?.[1]?.trim() ?? null }));
  });
}

// One request for the main folder's whole suite, left for the watcher (the runner's own request format).
function queueWholeRun(p) {
  const q = join(p.tipOut, 'queue'), folder = basename(p.main);
  mkdirSync(q, { recursive: true });
  for (const f of readdirSync(q).filter(f => f.endsWith('.req'))) {
    if ((read(join(q, f)) || '').trim() === `tree=${folder}`) return { name: f.slice(0, -4), waiting: true };
  }
  const t = new Date(), name = `${folder}-whole-${[t.getHours(), t.getMinutes(), t.getSeconds()].map(n => String(n).padStart(2, '0')).join('')}-${process.pid}`;
  writeFileSync(join(q, `${name}.tmp`), `tree=${folder}\n`);
  renameSync(join(q, `${name}.tmp`), join(q, `${name}.req`));
  return { name, waiting: false };
}

// Whole runs asked for after landings that have finished since: recorded once each.
export function settle(p, say = console.log) {
  const all = entries(p), recorded = new Set(all.filter(e => e.kind === 'whole run').map(e => e.name));
  const asked = new Map();
  for (const e of all) if (e.kind === 'whole run asked') asked.set(e.name, e);   // the newest main joined to it
  for (const [name, e] of asked) {
    if (recorded.has(name)) continue;
    const rc = read(join(e.out, `${name}.done`));
    if (rc === null) continue;
    const log = read(join(e.out, `${name}.log`)) || '';
    if (/^(?:The copy failed|Not run:|Couldn’t bring the log back)/m.test(log)) {
      note(p, { kind: 'whole run', name, main: e.main, result: 'not run', why: log.trim().split('\n')[0] });
      say(`The whole run of main at ${short(e.main)} didn’t run (${log.trim().split('\n')[0]}); the next landing asks again.`);
    } else if (rc.trim() === '0' && /^exit=0$/m.test(log)) {
      const lock = readJson(join(e.out, `${name}.lock.json`)), map = readJson(join(e.out, `${name}.affected-map.json`));
      note(p, { kind: 'whole run', name, main: e.main, result: 'passed', build: lock?.build ?? null, tree: map?.tree ?? null, map: !!map });
      say(`The whole run of main at ${short(e.main)} passed: build ${lock?.build ?? 'not named'}, the tested record from now on${map ? '' : ' (no map came back: a watcher restarted with this version of the runner records one)'}.`);
    } else {
      const failed = failedIn(log), maps = findMaps(p.main);
      const tested = lastTested(p.main, e.main, maps);
      const landings = all.filter(x => x.kind === 'landed' && isAncestor(p.main, x.to, e.main) && !(tested && isAncestor(p.main, x.to, tested.commit)))
        .map(x => `${x.branch} ${short(x.to)}`);
      let missed = [];
      try { missed = noteMissed({ top: p.main, failed, ref: e.main, maps, landing: true }).missed; } catch {}
      note(p, { kind: 'whole run', name, main: e.main, result: 'failed', failed, landings, missed });
      say(`The whole run of main at ${short(e.main)} failed${failed.length ? `: ${failed.join(', ')}` : ''}. Landings since the last tested build${tested ? ` (${short(tested.commit)})` : ''}: ${landings.join(', ') || 'none recorded'}.`);
      for (const f of missed) say(`missed by the pick: ${f}`);
    }
  }
}

export async function land(branch, { here = process.cwd(), whole = false } = {}) {
  const p = places(gitTop(here));
  if (!branch || branch === 'main') refuse('Say which branch to land on main: node tools/land.mjs <branch>.');
  const dir = p.trees.find(t => t.branch === branch)?.path;
  if (!dir) refuse(`${branch} has no work folder of its own (git worktree), and the runner tests a folder.`);
  takeLock(p, branch);
  settle(p);
  if (!clean(dir)) refuse(`${dir} has changes not committed: commit them or put them away, then run this again.`);
  const tip = git(dir, 'rev-parse', 'HEAD'), mainTip = git(p.main, 'rev-parse', 'main');
  if (!isAncestor(dir, mainTip, tip)) refuse(`${branch} doesn’t hold main’s tip (${short(mainTip)}): node tools/land.mjs --catch-up ${branch} merges it in, then run this again.`);
  if (tip === mainTip) refuse(`Nothing to land: ${branch} is main.`);
  if (!clean(p.main) || git(p.main, 'symbolic-ref', '--short', 'HEAD') !== 'main') refuse(`The main folder (${p.main}) has changes not committed, or isn’t on main: it has to be clean to move.`);
  const made = spawnSync(process.execPath, ['tools/make.mjs', '--check'], { cwd: dir, encoding: 'utf8' });
  if (made.status !== 0) refuse(`node tools/make.mjs --check fails in ${dir}:\n${(made.stderr || made.stdout).trim()}`);

  const picked = whole ? { all: true, files: null, why: 'the whole suite, as asked (--whole)' } : pick({ top: dir, base: 'main', landing: true });
  const commits = (git(dir, 'log', '--format=%h %s', `${mainTip}..${tip}`) || '').split('\n').filter(Boolean);
  const record = { branch, from: mainTip, to: tip, commits: commits.slice(0, 20), picked: picked.all ? 'all' : picked.files, why: picked.why };
  console.log(`${branch}: ${commits.length} commit${commits.length === 1 ? '' : 's'} on main's ${short(mainTip)}. ${picked.all ? 'The whole suite' : `${picked.files.length} test file${picked.files.length === 1 ? '' : 's'}`}: ${picked.why}.`);
  let run = { code: 0, log: null };
  if (picked.all || picked.files.length) run = await ask(dir, picked.all ? [] : picked.files);
  const stop = (result, why) => { note(p, { kind: 'not landed', ...record, result, log: run.log }); refuse(why); };
  if (run.code === 3) stop('not run', 'No watcher took the request, so nothing ran and nothing landed.');
  if (run.code !== 0) stop('failed', `The tests failed, so nothing landed.${run.log ? ` Log: ${run.log}` : ''}`);
  if (git(dir, 'rev-parse', 'HEAD') !== tip || !clean(dir)) stop('branch changed', `${branch} changed while its tests ran, so nothing landed: run this again.`);
  const now = git(p.main, 'rev-parse', 'main');
  if (now !== mainTip) stop('main moved', `main moved from ${short(mainTip)} to ${short(now)} while the tests ran, so nothing landed. Bring ${branch} up to date (node tools/land.mjs --catch-up ${branch}), then run this again.`);
  if (!clean(p.main)) stop('main folder changed', `The main folder has changes not committed now, so nothing landed.`);
  const ff = spawnSync('git', ['-C', p.main, 'merge', '--ff-only', '-q', tip], { encoding: 'utf8' });
  if (ff.status !== 0) stop('merge refused', `git merge --ff-only refused, so nothing landed: ${(ff.stderr || '').trim()}`);
  note(p, { kind: 'landed', ...record, result: 'passed', log: run.log });
  console.log(`Landed: main is now ${short(tip)} (${branch}).`);

  // The whole suite of main's new tip, in the background: only when code changed, and not when it just ran on it.
  const changed = (git(p.main, 'diff', '--name-only', mainTip, tip) || '').split('\n').filter(f => f && !/\.md$|^docs\//.test(f));
  if (!changed.length) console.log('Documents only: no whole run needed.');
  else if (picked.all) console.log('The whole suite just passed on this tree: no other whole run needed.');
  else {
    const q = queueWholeRun(p);
    note(p, { kind: 'whole run asked', name: q.name, out: p.tipOut, main: tip, joined: q.waiting });
    console.log(q.waiting ? `A whole run of main is already waiting (${q.name}); it will test this too.`
      : `Asked for main's whole suite in the background (${q.name}); not waited on. node tools/land.mjs --status shows it.`);
  }
}

// Generated files are never merged by hand: a conflict in one is settled by taking either side and making it again.
export const MADE = ['service/server.mjs', 'docs/code-map.md', 'docs/rules.md', 'docs/registry.md', 'docs/status.md'];

// Brings <branch> up to date with main in its own folder: merge main, make the generated files again, commit (not
// signed, as builders commit). It stops, leaving the merge for the builder, only on a conflict in a file written by
// hand, or when node tools/make.mjs finds a problem the two sides make together (a document over its limit); run it
// again once that is fixed and added, and it finishes the merge.
export function catchUp(branch, { here = process.cwd() } = {}) {
  const p = places(gitTop(here));
  const dir = p.trees.find(t => t.branch === branch)?.path;
  if (!dir || branch === 'main') refuse(`${branch || 'That'} has no work folder of its own to bring up to date.`);
  const mainTip = git(dir, 'rev-parse', 'main');
  if (git(dir, 'rev-parse', '-q', '--verify', 'MERGE_HEAD') === null) {
    if (!clean(dir)) refuse(`${dir} has changes not committed: commit them or put them away first.`);
    if (isAncestor(dir, mainTip, 'HEAD')) { console.log(`${branch} already holds main (${short(mainTip)}).`); return; }
    spawnSync('git', ['-C', dir, 'merge', '--no-ff', '--no-commit', '-q', mainTip], { encoding: 'utf8' });
    if (git(dir, 'rev-parse', '-q', '--verify', 'MERGE_HEAD') === null) refuse(`git couldn’t start merging main into ${branch}; nothing changed.`);
  }
  const unmerged = (git(dir, 'diff', '--name-only', '--diff-filter=U') || '').split('\n').filter(Boolean);
  for (const f of unmerged.filter(f => MADE.includes(f))) { git(dir, 'checkout', '--ours', '--', f); git(dir, 'add', '--', f); }
  const hand = unmerged.filter(f => !MADE.includes(f));
  if (hand.length) refuse(`main is half merged into ${branch}: these files written by hand conflict: ${hand.join(', ')}. Resolve them and git add them, then run node tools/land.mjs --catch-up ${branch} again; it makes the generated files and commits.`);
  const made = spawnSync(process.execPath, ['tools/make.mjs'], { cwd: dir, encoding: 'utf8' });
  const madeHere = MADE.filter(f => existsSync(join(dir, f)));
  if (madeHere.length) git(dir, 'add', '--', ...madeHere);
  if (made.status !== 0) refuse(`main is merged into ${branch}, but node tools/make.mjs finds problems in the two together:\n${(made.stderr || made.stdout).trim()}\nFix them and git add them, then run node tools/land.mjs --catch-up ${branch} again.`);
  const done = spawnSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-edit'], { encoding: 'utf8' });
  if (done.status !== 0) refuse(`The merge couldn’t be committed: ${(done.stderr || done.stdout).trim()}`);
  console.log(`${branch} now holds main (${short(mainTip)}), with the generated files made again. Land it: node tools/land.mjs ${branch}`);
}

// The last landings and whole runs, readable.
export function status(here = process.cwd(), n = 12) {
  const p = places(gitTop(here));
  // Finished whole runs are recorded under the landing lock; while a landing holds it, that landing records them.
  if (!tryLock(p, '--status')) try { settle(p); } finally { rmSync(p.lock, { recursive: true, force: true }); }
  const all = entries(p), done = new Set(all.filter(e => e.kind === 'whole run').map(e => e.name));
  for (const e of all.slice(-n)) {
    const when = e.at.replace('T', ' ').slice(0, 16);
    const what = e.kind === 'landed' ? `landed ${e.branch}: main ${short(e.from)} → ${short(e.to)}; ${e.picked === 'all' ? 'all' : `${e.picked.length} files`} (${e.why})`
      : e.kind === 'not landed' ? `not landed ${e.branch} (${e.result})`
      : e.kind === 'whole run asked' ? `whole run of main at ${short(e.main)} asked (${e.name})${done.has(e.name) ? '' : ', not finished yet'}`
      : e.result === 'passed' ? `whole run of main at ${short(e.main)} passed: build ${e.build}${e.map ? '' : ', no map'}`
      : e.result === 'not run' ? `whole run of main at ${short(e.main)} didn’t run: ${e.why}`
      : `whole run of main at ${short(e.main)} failed: ${e.failed.join(', ') || 'see its log'}; landings since the last tested build: ${e.landings.join(', ') || 'none'}${e.missed.length ? `; missed by the pick: ${e.missed.join(', ')}` : ''}`;
    console.log(`${when}  ${what}`);
  }
  if (!all.length) console.log('Nothing has landed yet.');
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (isMain()) {
  const args = process.argv.slice(2), branch = args.find(a => !a.startsWith('--'));
  try {
    if (args.includes('--status')) status();
    else if (args.includes('--catch-up')) catchUp(branch);
    else await land(branch, { whole: args.includes('--whole') });
  } catch (e) {
    console.error(e instanceof Refused ? e.message : (e.stack || e.message));
    process.exit(1);
  }
}
