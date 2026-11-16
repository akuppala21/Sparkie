// Covers: The tested mark without the whole suite: the lock `test/lock.mjs` writes names the build, `tree`, `commit`,
// `run` and `brainReads`, the same on a second write; a changed tool description, tool input or system prompt changes
// `brainReads`; a character whose bytes reach the stand-in brain in two pieces is recorded whole, so the mark of one
// tree is the same every time; the lock leaves itself out of `tree`, names `commit` only when HEAD holds exactly the
// files, and doesn't touch git's own index; without git it names the runner's `SPARK_TEST_TREE` as `tree`; `run` only
// on GitHub; the service still counts every workflow of the build as tested with the new lock.
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
import { T, useFleet, REPO, SLOW, postInTwo } from './lib.mjs';
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

  // 2026-11-14: the stand-in brain decoded each piece of a request on its own, so a character whose bytes arrived in two
  // pieces (“Spark’s” in a tool's text) was read as replacement marks and the mark of one tree changed between runs.
  test('what the brain was sent is recorded as sent when a character’s bytes arrive in two pieces: the mark is the same every time', { timeout: 120000 * SLOW }, async () => {
    const sent = await brainSent(T.fleet), reads = brainReadsOf(sent);
    assert.ok(!JSON.stringify(sent).includes('\uFFFD'), 'what the brain reads has no broken character');
    // The same request again, straight to the stand-in brain, asked the same way.
    const p = sent.params;
    const body = JSON.stringify({ model: 'qwen-aphex', stream: true, temperature: p.temperature, top_p: p.top_p, top_k: p.top_k, max_tokens: p.max_tokens,
      chat_template_kwargs: { enable_thinking: p.thinking }, messages: [{ role: 'system', content: sent.system }, { role: 'user', content: 'Hello from the mark’s test.' }],
      tools: sent.tools, tool_choice: 'auto' });
    // Cut once in the system prompt and once in the tools' text, as two runs of one tree may be.
    const marks = [], cuts = [];
    for (const from of [0, Math.floor(Buffer.byteLength(body) / 2)]) {
      const r = await postInTwo(`http://127.0.0.1:${T.fleet.modelPort}/v1/chat/completions`, body, { from });
      assert.equal(r.status, 200);
      const got = JSON.parse(readFileSync(join(T.fleet.dir, 'brain-sent.json'), 'utf8'));
      assert.equal(got.system, sent.system);
      assert.deepEqual(got.tools, sent.tools);
      marks.push(brainReadsOf({ system: got.system, tools: got.tools, params: got.params, catalog: sent.catalog }));
      cuts.push(r.cut);
    }
    assert.ok(cuts[0] < Buffer.byteLength(JSON.stringify(sent.system)) + 200 && cuts[1] > cuts[0], `cut at bytes ${cuts}`);
    assert.deepEqual(marks, [reads, reads]);
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

  // (the final read's U1: a lock from a whole run on a Spark named no tree, so pull.sh couldn't place a build installed
  // from the Mac on main and offered an older tested build as newer)
  test('where there is no git (a whole run on a Spark), the lock names the tree the runner hands in, SPARK_TEST_TREE, and no commit', { timeout: 120000 * SLOW }, async () => {
    const tree = 'c'.repeat(40);
    const lock = await lockFor(T.fleet, { git: {}, env: { SPARK_TEST_TREE: tree } });
    assert.equal(lock.tree, tree);
    assert.equal('commit' in lock, false);
    const { testedFiles } = await import('./lock.mjs');
    // git's own where there is git; a value of another shape is no tree; git's sha-256 trees too
    const both = { tree: 'a'.repeat(40), commit: 'b'.repeat(40) };
    assert.deepEqual(testedFiles(both, { SPARK_TEST_TREE: tree }), both);
    for (const bad of ['', 'c'.repeat(39), `${tree}\n`, 'C'.repeat(40), '../x', `${tree} ${tree}`]) assert.deepEqual(testedFiles({}, { SPARK_TEST_TREE: bad }), {}, JSON.stringify(bad));
    assert.deepEqual(testedFiles({}, { SPARK_TEST_TREE: 'd'.repeat(64) }), { tree: 'd'.repeat(64) });
    assert.deepEqual(testedFiles({}, {}), {});
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
