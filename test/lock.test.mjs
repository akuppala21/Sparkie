// Covers: The tested mark without the whole suite: the lock `test/lock.mjs` writes names the build, `tree`, `commit`,
// `run` and `brainReads`, the same on a second write; a changed tool description, tool input or system prompt changes
// `brainReads`; the lock leaves itself out of `tree`, names `commit` only when HEAD holds exactly the files, and
// doesn't touch git's own index; `run` only on GitHub; the service still counts every workflow of the build as tested
// with the new lock.
//
// The tested mark, test/lock.mjs, without running the whole suite: the lock it writes for the stand-in fleet's build
// names the files tested (tree, and commit when they are exactly a commit's), the GitHub run (only on GitHub) and what
// the brain reads (brainReads: a sha256 of the system prompt and every tool's name, description and inputs, as the
// stand-in brain was sent them). The same build gives the same lock; the service still reads it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { T, useFleet, REPO, SLOW } from './lib.mjs';
import { startMock } from './start-mock.mjs';
import { lockFor, gitFields, runOf, brainSent, brainReadsOf } from './lock.mjs';

useFleet({ watchMs: 60000, statusMs: 20000 });

const GITHUB = { GITHUB_ACTIONS: 'true', GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'someone/spark-console', GITHUB_RUN_ID: '4242', GITHUB_RUN_ATTEMPT: '2' };
const hasGit = spawnSync('git', ['--version']).status === 0;
const git = (dir, ...args) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@test', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

describe('the lock', () => {
  test('names the build, what was tested and what the brain reads, the same on a second write', { timeout: 120000 * SLOW }, async () => {
    const a = await lockFor(T.fleet, { env: GITHUB }), b = await lockFor(T.fleet, { env: GITHUB });
    // What readers already use is there as before.
    assert.equal(a.build, (await (await fetch(`${T.base}/health`)).json()).build);
    assert.deepEqual(a.versions, Object.fromEntries((await (await fetch(`${T.base}/workflows`)).json()).workflows.map(w => [w.id, w.version])));
    assert.ok(!Number.isNaN(Date.parse(a.testedAt)));
    assert.match(a.brainReads, /^[0-9a-f]{64}$/);
    assert.equal(a.run, 'https://github.com/someone/spark-console/actions/runs/4242');
    // In a git checkout the tree is named; a copy without .git (the Spark's test container) leaves it out.
    if (hasGit && existsSync(join(REPO, '.git'))) assert.match(a.tree, /^[0-9a-f]{40}$/);
    else assert.equal(a.tree, undefined);
    const { testedAt: _a, ...sameA } = a, { testedAt: _b, ...sameB } = b;
    assert.deepEqual(sameB, sameA);
    // Off GitHub there's no run.
    assert.equal('run' in await lockFor(T.fleet, { env: {} }), false);
  });

  test('brainReads is what the brain was sent: a changed tool description or system prompt changes it', { timeout: 120000 * SLOW }, async () => {
    const sent = await brainSent(T.fleet);
    // The record is the request the stand-in brain logged: the same tools, each with its words and inputs.
    const logged = readFileSync(join(T.fleet.dir, 'model-requests.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(e => e.round === 0 && e.tools.length).at(-1);
    assert.deepEqual(sent.tools.map(t => t.function.name), logged.tools);
    assert.equal(sent.system, logged.system);
    for (const t of sent.tools) {
      assert.ok(t.function.description?.length > 20, t.function.name);
      assert.equal(typeof t.function.parameters, 'object', t.function.name);
    }
    const reads = brainReadsOf(sent);
    assert.equal(reads, (await lockFor(T.fleet, { env: {} })).brainReads);
    assert.equal(brainReadsOf(structuredClone(sent)), reads);
    const described = structuredClone(sent);
    described.tools[3].function.description += ' Now also something else.';
    assert.notEqual(brainReadsOf(described), reads);
    const input = structuredClone(sent);
    input.tools.at(-1).function.parameters.properties = { ...input.tools.at(-1).function.parameters.properties, extra: { type: 'string' } };
    assert.notEqual(brainReadsOf(input), reads);
    assert.notEqual(brainReadsOf({ ...sent, system: `${sent.system} ` }), reads);
  });

  test('the service reads the new lock as before: every workflow of this build counts as tested', { timeout: 120000 * SLOW }, async () => {
    const file = join(T.fleet.dir, 'new-lock.json');
    writeFileSync(file, JSON.stringify(await lockFor(T.fleet, { env: GITHUB })));
    const other = await startMock({ watchMs: 60000, statusMs: 20000, env: { SPARK_CONSOLE_CHECK_LOCK: '1', SPARK_CONSOLE_WORKFLOW_LOCK: file } });
    try {
      const { workflows } = await (await fetch(`${other.base}/workflows`)).json();
      assert.ok(workflows.length >= 5);
      for (const w of workflows) assert.equal(w.tested, true, w.id);
    } finally { await other.stop(); }
  });
});

describe('what it names', () => {
  test('tree: git’s hash of the files as they are, the lock left out; commit only when HEAD holds exactly those files', { skip: !hasGit && 'git isn’t installed' }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'lock-git-'));
    try {
      git(dir, 'init', '-q');
      writeFileSync(join(dir, 'a.txt'), 'one\n');
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', 'one');
      const head = { tree: git(dir, 'rev-parse', 'HEAD^{tree}'), commit: git(dir, 'rev-parse', 'HEAD') };
      assert.deepEqual(gitFields(dir), head);
      // The lock itself is never part of what was tested.
      mkdirSync(join(dir, 'service'));
      writeFileSync(join(dir, 'service', 'workflows.lock.json'), '{"build":"x"}\n');
      assert.deepEqual(gitFields(dir), head);
      // A changed file: a new tree, no commit, and git's own index untouched.
      writeFileSync(join(dir, 'a.txt'), 'two\n');
      const changed = gitFields(dir);
      assert.match(changed.tree, /^[0-9a-f]{40}$/);
      assert.notEqual(changed.tree, head.tree);
      assert.equal(changed.commit, undefined);
      assert.equal(git(dir, 'status', '--porcelain', '--untracked-files=no'), 'M a.txt');
      git(dir, 'commit', '-q', '-am', 'two');
      assert.deepEqual(gitFields(dir), { tree: changed.tree, commit: git(dir, 'rev-parse', 'HEAD') });
      // A folder inside a checkout but not its top, and a folder with no git at all: nothing named.
      mkdirSync(join(dir, 'inner'));
      assert.deepEqual(gitFields(join(dir, 'inner')), {});
      rmSync(join(dir, '.git'), { recursive: true, force: true });
      assert.deepEqual(gitFields(dir), {});
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('run: the GitHub run’s page, only on GitHub and only when its names look right', () => {
    assert.equal(runOf(GITHUB), 'https://github.com/someone/spark-console/actions/runs/4242');
    assert.equal(runOf({}), null);
    assert.equal(runOf({ ...GITHUB, GITHUB_ACTIONS: undefined }), null);
    assert.equal(runOf({ ...GITHUB, GITHUB_RUN_ID: '42; rm -rf /' }), null);
    assert.equal(runOf({ ...GITHUB, GITHUB_REPOSITORY: '../x' }), null);
    assert.equal(runOf({ ...GITHUB, GITHUB_SERVER_URL: 'http://github.com' }), null);
  });
});
