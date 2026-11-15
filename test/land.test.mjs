// tools/land.mjs, one step onto main, against a made-up repository with its own work folders and a stand-in for the
// Spark runner (SPARK_LAND_RUNNER: a script that notes what it was asked and answers as the test says). A passing pick
// lands and logs; a failing test lands nothing; a branch behind main, a dirty folder and a failing make check are
// refused before anything runs; main moving during the run lands nothing; two landings at once never interleave; a
// whole run of main asked for afterwards is recorded when it ends. No fleet and no Spark: git, node and bash.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { REPO } from './lib.mjs';
import { SHORT_CHECK } from '../tools/affected.mjs';

const LAND = join(REPO, 'tools', 'land.mjs');
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@test', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@test' };
const git = (dir, ...args) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', env: ENV });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
const put = (dir, f, text) => { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), text); };
const STANDIN = `#!/bin/bash
# Stand-in for tools/test-on-spark.sh --ask: notes the folder and files, does what during.sh says, answers with rc.
[ "$1" = "--ask" ] || exit 2
shift
echo "$PWD|$*" >> "$STANDIN_DIR/asked"
[ -f "$STANDIN_DIR/during.sh" ] && bash "$STANDIN_DIR/during.sh"
sleep "\${STANDIN_SLEEP:-0}"
echo "Whole log: $STANDIN_DIR/run.log"
exit "$(cat "$STANDIN_DIR/rc" 2>/dev/null || echo 0)"
`;
const ONE = 'function one(x) {\n  return x + 1;\n}\n';
const TWO = 'function two(y) {\n  return y * 2;\n}\n';
const MAKE = `import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
const made = readdirSync('service/src').sort().map(f => readFileSync('service/src/' + f, 'utf8')).join('');
if (!process.argv.includes('--check')) writeFileSync('service/server.mjs', made);
else if (readFileSync('service/server.mjs', 'utf8') !== made) process.exit(1);
process.exit(existsSync('make-fails') ? 1 : 0);
`;
const make = dir => assert.equal(spawnSync(process.execPath, ['tools/make.mjs'], { cwd: dir }).status, 0);

let base, main, out, sd;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'sct-land-'));
  main = join(base, 'spark-console'); out = join(base, 'spark-test-runs'); sd = join(base, 'standin');
  mkdirSync(main); mkdirSync(sd); mkdirSync(out);
  writeFileSync(join(sd, 'runner.sh'), STANDIN);
  git(main, 'init', '-q', '-b', 'main');
  // The folder's own make: server.mjs is its parts joined (--check: fails when it isn't), and it fails when the folder
  // holds make-fails.
  put(main, 'tools/make.mjs', MAKE);
  put(main, 'service/src/30-alpha.mjs', ONE);
  put(main, 'service/src/31-beta.mjs', TWO);
  make(main);
  put(main, 'test/a.test.mjs', '// a\n');
  put(main, 'test/b.test.mjs', '// b\n');
  put(main, 'docs/notes.md', '# Notes\n');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'base');
  // The tested record of main's tree, as a whole run on the Spark leaves it.
  writeFileSync(join(out, 'first.affected-map.json'), JSON.stringify({ tree: git(main, 'rev-parse', 'HEAD^{tree}'),
    tests: ['test/a.test.mjs', 'test/b.test.mjs'], fns: { '30-alpha.mjs:one@1-3': [0] }, missed: [] }));
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

// A branch in its own work folder beside main, with one commit that changes one().
function branch(name, { from = 'main', text = 'x + 2', file = 'service/src/30-alpha.mjs', also = null } = {}) {
  const dir = join(base, `spark-console-${name}`);
  git(main, 'worktree', 'add', '-q', '-b', name, dir, from);
  if (file) put(dir, file, file.includes('30-alpha') ? ONE.replace('x + 1', text) : `${name}\n`);
  if (also) put(dir, also, `${name}\n`);
  make(dir);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', `${name}: a step`);
  return { dir, tip: git(dir, 'rev-parse', 'HEAD') };
}
const env = extra => ({ ...ENV, SPARK_LAND_RUNNER: join(sd, 'runner.sh'), SPARK_TEST_OUT: out, STANDIN_DIR: sd, ...extra });
const land = (...args) => spawnSync(process.execPath, [LAND, ...args], { cwd: main, encoding: 'utf8', env: env() });
const landLater = (name, extra) => new Promise(resolve => {
  const p = spawn(process.execPath, [LAND, name], { cwd: main, env: env(extra) });
  let text = '';
  p.stdout.on('data', d => { text += d; }); p.stderr.on('data', d => { text += d; });
  p.on('close', status => resolve({ status, text }));
});
const log = () => (existsSync(join(base, 'spark-landings.log')) ? readFileSync(join(base, 'spark-landings.log'), 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []);
const asked = () => (existsSync(join(sd, 'asked')) ? readFileSync(join(sd, 'asked'), 'utf8').trim().split('\n') : []);
const mainTip = () => git(main, 'rev-parse', 'main');
const queued = () => (existsSync(join(out, 'queue')) ? readdirSync(join(out, 'queue')).filter(f => f.endsWith('.req')) : []);
const said = r => r.stdout + r.stderr;

describe('landing a step', () => {
  test('a passing pick lands: main moves to the branch, one line in the log, one whole run of main left in the queue', () => {
    const before = mainTip(), s = branch('step');
    const r = land('step');
    assert.equal(r.status, 0, said(r));
    assert.equal(mainTip(), s.tip);
    assert.match(readFileSync(join(main, 'service/src/30-alpha.mjs'), 'utf8'), /x \+ 2/);
    // The runner was asked from the branch's folder for what the pick gave (the short check's files aren't in this
    // made-up repository, so only the file that ran one()).
    assert.deepEqual(asked(), [`${git(s.dir, 'rev-parse', '--show-toplevel')}|test/a.test.mjs`]);
    const [landed, wholeRun] = log();
    assert.equal(landed.kind, 'landed');
    assert.equal(landed.branch, 'step');
    assert.equal(landed.from, before);
    assert.equal(landed.to, s.tip);
    assert.deepEqual(landed.commits, [`${s.tip.slice(0, 7)} step: a step`]);
    assert.deepEqual(landed.picked, ['test/a.test.mjs']);
    assert.match(landed.why, /1 function in 30-alpha\.mjs/);
    assert.equal(landed.result, 'passed');
    assert.ok(!Number.isNaN(Date.parse(landed.at)));
    assert.equal(wholeRun.kind, 'whole run asked');
    assert.equal(wholeRun.main, s.tip);
    assert.deepEqual(queued(), [`${wholeRun.name}.req`]);
    assert.equal(readFileSync(join(out, 'queue', `${wholeRun.name}.req`), 'utf8'), 'tree=spark-console\n');
    // Never pushed, never a merge commit.
    assert.equal(git(main, 'log', '--merges', '--format=%H', 'main'), '');
    assert.ok(!existsSync(join(base, 'spark-landings.lock')), 'the landing lock is let go');
    for (const f of SHORT_CHECK) assert.ok(!asked()[0].includes(f));
  });

  test('a failing test lands nothing; a documents-only step lands on the documents test and asks for no whole run', () => {
    const before = mainTip();
    branch('broken');
    writeFileSync(join(sd, 'rc'), '1');
    const r = land('broken');
    assert.equal(r.status, 1);
    assert.match(said(r), /The tests failed, so nothing landed/);
    assert.equal(mainTip(), before);
    assert.deepEqual(log().map(e => [e.kind, e.result]), [['not landed', 'failed']]);
    assert.deepEqual(queued(), []);

    writeFileSync(join(sd, 'rc'), '0');
    const d = branch('words', { file: 'docs/notes.md' });
    const w = land('words');
    assert.equal(w.status, 0, said(w));
    assert.equal(mainTip(), d.tip);
    assert.equal(asked().at(-1), `${git(d.dir, 'rev-parse', '--show-toplevel')}|test/docs.test.mjs`);
    assert.match(said(w), /Documents only: no whole run needed/);
    assert.deepEqual(queued(), []);
  });

  test('refused before anything runs: a branch behind main, a dirty branch folder, a dirty main folder, a failing make check', () => {
    const s = branch('behind');
    put(main, 'docs/other.md', 'x\n');
    git(main, 'add', '-A'); git(main, 'commit', '-q', '-m', 'main moves on');
    const moved = mainTip();
    let r = land('behind');
    assert.equal(r.status, 1);
    assert.match(said(r), /behind doesn’t hold main’s tip \([0-9a-f]{7}\): node tools\/land\.mjs --catch-up behind merges it in/);
    git(s.dir, 'merge', '-q', '--no-edit', 'main');

    put(s.dir, 'loose.txt', 'not committed\n');
    r = land('behind');
    assert.match(said(r), /has changes not committed/);
    rmSync(join(s.dir, 'loose.txt'));

    put(main, 'loose.txt', 'not committed\n');
    r = land('behind');
    assert.match(said(r), /The main folder \(.+\) has changes not committed/);
    rmSync(join(main, 'loose.txt'));

    put(s.dir, 'make-fails', 'x\n');
    git(s.dir, 'add', '-A'); git(s.dir, 'commit', '-q', '-m', 'make fails');
    r = land('behind');
    assert.match(said(r), /node tools\/make\.mjs --check fails in/);

    assert.equal(mainTip(), moved);
    assert.deepEqual(asked(), [], 'the runner was never asked');
    assert.deepEqual(log(), []);
  });

  test('main moving while the tests run lands nothing, and says to bring the branch up to date', () => {
    branch('slow');
    writeFileSync(join(sd, 'during.sh'), `cd "${main}" && echo moved > docs/moved.md && git add -A && git -c commit.gpgsign=false commit -q -m "someone else"\n`);
    const r = spawnSync(process.execPath, [LAND, 'slow'], { cwd: main, encoding: 'utf8', env: env() });
    assert.equal(r.status, 1, said(r));
    assert.match(said(r), /main moved from [0-9a-f]{7} to [0-9a-f]{7} while the tests ran, so nothing landed\. Bring slow up to date/);
    assert.equal(git(main, 'log', '-1', '--format=%s', 'main'), 'someone else');
    assert.deepEqual(log().map(e => [e.kind, e.result]), [['not landed', 'main moved']]);
  });

  test('two landings at once never interleave: one lands, the other is refused, main stays a straight line', async () => {
    const a = branch('one'), b = branch('two', { text: 'x + 3', file: 'service/src/30-alpha.mjs', also: 'docs/two.md' });
    const [ra, rb] = await Promise.all([landLater('one', { STANDIN_SLEEP: '3' }), landLater('two', { STANDIN_SLEEP: '3' })]);
    const results = [ra, rb].map(r => r.status).sort();
    assert.deepEqual(results, [0, 1], ra.text + rb.text);
    const lost = ra.status ? ra : rb;
    // (Refused at the lock; on a very slow machine the second may start only after the first has landed, and is then
    // refused for not holding main's tip. Either way nothing interleaves.)
    assert.match(lost.text, /Another landing is under way \((one|two), since [^)]+\)\.|(one|two) doesn’t hold main’s tip/);
    assert.ok([a.tip, b.tip].includes(mainTip()));
    assert.equal(asked().length, 1);
    assert.equal(git(main, 'log', '--merges', '--format=%H', 'main'), '');
    assert.deepEqual(log().filter(e => e.kind === 'landed').length, 1);
  });

  test('the whole run asked for after landings: a failure names the landings since the last tested build and what the pick missed', () => {
    const one = branch('first');
    assert.equal(land('first').status, 0);
    const two = branch('second', { from: 'main', text: 'x + 5' });
    const r = land('second');
    assert.equal(r.status, 0, said(r));
    assert.match(said(r), /A whole run of main is already waiting \(.+\); it will test this too/);
    const [name] = queued().map(f => f.slice(0, -4));
    assert.deepEqual(log().filter(e => e.kind === 'whole run asked').map(e => [e.name, e.main]), [[name, one.tip], [name, two.tip]]);

    // The watcher ran it and it failed in b, which the picks (a, for one()) never ran.
    rmSync(join(out, 'queue', `${name}.req`));
    writeFileSync(join(out, `${name}.done`), '1\n');
    writeFileSync(join(out, `${name}.log`), 'Seconds per test file, longest first (2 files):\n    2.0  FAIL  test/b.test.mjs\n    1.0  pass  test/a.test.mjs\nexit=1\n');
    const s = land('--status');
    assert.equal(s.status, 0, said(s));
    assert.match(said(s), /The whole run of main at [0-9a-f]{7} failed: test\/b\.test\.mjs\. Landings since the last tested build \([0-9a-f]{7}\): first [0-9a-f]{7}, second [0-9a-f]{7}\./);
    assert.match(said(s), /missed by the pick: test\/b\.test\.mjs/);
    const end = log().at(-1);
    assert.deepEqual([end.kind, end.result, end.failed, end.landings, end.missed],
      ['whole run', 'failed', ['test/b.test.mjs'], [`first ${one.tip.slice(0, 7)}`, `second ${two.tip.slice(0, 7)}`], ['test/b.test.mjs']]);
    assert.deepEqual(JSON.parse(readFileSync(join(out, 'first.affected-map.json'), 'utf8')).missed.map(m => [m.file, m.fns]), [['test/b.test.mjs', ['30-alpha.mjs:one']]]);
    // Recorded once.
    land('--status');
    assert.equal(log().filter(e => e.kind === 'whole run').length, 1);

    // A pass is the tested record: its lock names the build, and the next pick measures from its map.
    const third = branch('third', { text: 'x + 6' });
    assert.equal(land('third').status, 0);
    const next = log().at(-1).name;
    rmSync(join(out, 'queue', `${next}.req`));
    writeFileSync(join(out, `${next}.done`), '0\n');
    writeFileSync(join(out, `${next}.log`), 'Marked build abc123def456 as tested\nexit=0\n');
    writeFileSync(join(out, `${next}.lock.json`), JSON.stringify({ build: 'abc123def456' }));
    writeFileSync(join(out, `${next}.affected-map.json`), JSON.stringify({ tree: git(main, 'rev-parse', `${third.tip}^{tree}`), tests: ['test/a.test.mjs', 'test/b.test.mjs', 'test/c.test.mjs', 'test/d.test.mjs'], fns: { '30-alpha.mjs:one@1-3': [0, 1] }, missed: [] }));
    const t = land('--status');
    assert.match(said(t), /The whole run of main at [0-9a-f]{7} passed: build abc123def456, the tested record from now on\./);
    assert.deepEqual([log().at(-1).result, log().at(-1).build, log().at(-1).map], ['passed', 'abc123def456', true]);
    branch('fourth', { text: 'x + 7' });
    assert.equal(land('fourth').status, 0);
    assert.match(log().find(e => e.kind === 'landed' && e.branch === 'fourth').why, /from [0-9a-f]{7}, the last tested build\)$/);
    assert.deepEqual(log().find(e => e.kind === 'landed' && e.branch === 'fourth').picked, ['test/a.test.mjs', 'test/b.test.mjs']);
  });
});

describe('--whole, the queue for the whole run after, and catching up with main', () => {
  test('--whole runs the whole suite before landing, whatever the pick, and asks for no other whole run after', () => {
    const s = branch('careful');
    const r = spawnSync(process.execPath, [LAND, '--whole', 'careful'], { cwd: main, encoding: 'utf8', env: env() });
    assert.equal(r.status, 0, said(r));
    assert.equal(mainTip(), s.tip);
    assert.deepEqual(asked(), [`${git(s.dir, 'rev-parse', '--show-toplevel')}|`]);
    assert.deepEqual([log()[0].picked, log()[0].why], ['all', 'the whole suite, as asked (--whole)']);
    assert.match(said(r), /The whole suite just passed on this tree: no other whole run needed/);
    assert.deepEqual(queued(), []);
  });

  test('the whole run after a landing goes to SPARK_LAND_TIP_OUT, or else the main queue, whichever queue the tests used', () => {
    const q = dir => (existsSync(join(base, dir, 'queue')) ? readdirSync(join(base, dir, 'queue')).filter(f => f.endsWith('.req')) : []);
    branch('fourb');
    let r = spawnSync(process.execPath, [LAND, 'fourb'], { cwd: main, encoding: 'utf8',
      env: env({ SPARK_TEST_OUT: join(base, 'spark-test-runs-4'), SPARK_LAND_TIP_OUT: join(base, 'spark-test-runs-4b') }) });
    assert.equal(r.status, 0, said(r));
    assert.equal(q('spark-test-runs-4b').length, 1);
    assert.deepEqual([q('spark-test-runs-4'), q('spark-test-runs')], [[], []]);
    assert.equal(log().at(-1).out, join(base, 'spark-test-runs-4b'));
    branch('four', { text: 'x + 4' });
    r = spawnSync(process.execPath, [LAND, 'four'], { cwd: main, encoding: 'utf8', env: env({ SPARK_TEST_OUT: join(base, 'spark-test-runs-4') }) });
    assert.equal(r.status, 0, said(r));
    assert.equal(q('spark-test-runs').length, 1);
    assert.deepEqual(q('spark-test-runs-4'), []);
  });

  test('--catch-up merges main, makes the generated files again instead of merging them, and commits', () => {
    // main changes the end of one part and the branch the start of the next: the parts merge, server.mjs conflicts.
    const s = branch('side', { file: 'service/src/31-beta.mjs' });
    put(s.dir, 'service/src/31-beta.mjs', `// side was here\n${TWO}`);
    make(s.dir);
    git(s.dir, 'commit', '-q', '-am', 'side: the start of beta');
    put(main, 'service/src/30-alpha.mjs', `${ONE}// main was here\n`);
    make(main);
    git(main, 'commit', '-q', '-am', 'main: the end of alpha');
    const merged = spawnSync('git', ['-C', s.dir, 'merge-tree', '--write-tree', '--name-only', 'HEAD', 'main'], { encoding: 'utf8' });
    assert.match(merged.stdout, /service\/server\.mjs/, 'server.mjs would conflict if merged by hand');

    const r = land('--catch-up', 'side');
    assert.equal(r.status, 0, said(r));
    assert.match(said(r), /side now holds main \([0-9a-f]{7}\), with the generated files made again/);
    assert.equal(git(s.dir, 'status', '--porcelain'), '');
    assert.equal(git(s.dir, 'rev-parse', 'HEAD^2'), mainTip());
    const server = readFileSync(join(s.dir, 'service/server.mjs'), 'utf8');
    assert.equal(server, `${ONE}// main was here\n// side was here\n${TWO}`);
    assert.match(said(land('--catch-up', 'side')), /side already holds main/);
    assert.equal(land('side').status, 0);
  });

  test('--catch-up stops on a conflict in a file written by hand, and finishes once it is resolved', () => {
    const s = branch('words', { file: 'docs/notes.md' });
    put(main, 'docs/notes.md', 'main\n');
    git(main, 'commit', '-q', '-am', 'main: notes');
    const r = land('--catch-up', 'words');
    assert.equal(r.status, 1);
    assert.match(said(r), /main is half merged into words: these files written by hand conflict: docs\/notes\.md\. Resolve them and git add them/);
    assert.ok(git(s.dir, 'rev-parse', '-q', '--verify', 'MERGE_HEAD'));
    put(s.dir, 'docs/notes.md', 'both\n');
    git(s.dir, 'add', 'docs/notes.md');
    const again = land('--catch-up', 'words');
    assert.equal(again.status, 0, said(again));
    assert.equal(git(s.dir, 'status', '--porcelain'), '');
    assert.ok(spawnSync('git', ['-C', s.dir, 'merge-base', '--is-ancestor', 'main', 'HEAD']).status === 0);
  });
});
