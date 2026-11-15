// Covers: A test file that runs past its limit ends itself (test/file-limit.mjs, which test/lib.mjs imports): one that
// waits for ever, run with a 3-second limit, prints one line naming itself, the test that was running and what that
// usually means, has its harness stop what it started (the fleet useFleet would have), leaves no process, and exits with
// a failing code; one that ends in time prints nothing extra and exits 0 without waiting for its limit; and
// test/lock.mjs, given such a file among passing ones, finishes, fails and names it once in its "Seconds per test file"
// table (the rows tools/affected.mjs reads). They start no fleet and bind no port.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO, SLOW } from './lib.mjs';
import { failedIn } from '../tools/affected.mjs';

const LIB = pathToFileURL(join(REPO, 'test', 'lib.mjs')).href;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MEANS = 'That usually means a test is waiting for something that never comes: give its waits a deadline.';

// The environment for a file run on its own: never as a child of this runner, never with this run's coverage.
function envWith(extra) {
  const env = { ...process.env };
  for (const k of ['NODE_TEST_CONTEXT', 'NODE_OPTIONS', 'NODE_V8_COVERAGE', 'SPARK_TEST_MAP', 'SPARK_TEST_TREE', 'SPARK_TEST_FILE_LIMIT_S']) delete env[k];
  return { ...env, ...extra };
}
// Runs node with args in a process group of its own; ended (the whole group) if it is still there after `limit` ms.
function run(args, { cwd, env, limit }) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const child = spawn(process.execPath, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', cut = false;
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => { cut = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, limit);
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, cut, out, err, ms: Date.now() - t0, group: child.pid }); });
  });
}
// A process that is still there, not one that has ended and waits to be reaped (a zombie).
function alive(pid) {
  try { process.kill(pid, 0); } catch (e) { return e.code === 'EPERM'; }
  try { return readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^.*\) /s, '')[0] !== 'Z'; } catch {}
  try { return !/Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })); } catch { return false; }
}
// The live processes in a process group.
function inGroup(pgid) {
  if (existsSync('/proc/self/stat')) {
    return readdirSync('/proc').filter(d => /^\d+$/.test(d)).filter(d => {
      try { const f = readFileSync(`/proc/${d}/stat`, 'utf8').replace(/^.*\) /s, '').split(' '); return f[0] !== 'Z' && Number(f[2]) === pgid; } catch { return false; }
    }).map(Number);
  }
  return execFileSync('ps', ['-A', '-o', 'pid=,pgid=,stat='], { encoding: 'utf8' }).trim().split('\n').map(l => l.trim().split(/\s+/))
    .filter(([, g, st]) => Number(g) === pgid && !/Z/.test(st)).map(([p]) => Number(p));
}
async function nothingLeft(pgid, what) {
  for (const end = Date.now() + 10000 * SLOW; inGroup(pgid).length;) {
    if (Date.now() > end) assert.fail(`${what} left processes behind: ${inGroup(pgid).join(', ')}`);
    await sleep(200);
  }
}
const endGroup = pgid => { try { process.kill(-pgid, 'SIGKILL'); } catch {} };

// A file that waits for ever in its second test. In place of the fleet useFleet starts, a process in the file's own
// group that only the harness's clean-up (T.fleet.stop()) ends.
const HANGS = lib => `import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { test, describe } from 'node:test';
import { T } from '${lib}';
const kid = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
writeFileSync(new URL('./kid', import.meta.url), String(kid.pid));
T.fleet = { stop: async () => { kid.kill('SIGKILL'); } };
test('passes first', () => {});
describe('the waits', () => {
  test('waits for ever', async () => { for (;;) await new Promise(r => setTimeout(r, 100)); });
});
`;
const QUICK = lib => `import { test } from 'node:test';
import '${lib}';
test('ends at once', () => {});
`;

describe('a test file that runs past its limit ends itself', { concurrency: true }, () => {
  test('one that waits for ever, with a 3-second limit: one line naming it and the test, its fleet stopped, nothing left, a failing exit code', { timeout: 120000 * SLOW }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'file-limit-'));
    let r;
    try {
      writeFileSync(join(dir, 'hang.test.mjs'), HANGS(LIB));
      r = await run(['hang.test.mjs'], { cwd: dir, env: envWith({ SPARK_TEST_FILE_LIMIT_S: '3' }), limit: 60000 * SLOW });
      assert.equal(r.cut, false, `it didn't end by itself within ${60 * SLOW} s:\n${r.err.slice(-2000)}`);
      assert.equal(r.code, 124, `${r.code} ${r.signal}\n${r.err}`);
      assert.ok(r.ms >= 3000, `it ran its 3 seconds: ${r.ms} ms`);
      assert.equal(r.err, `hang.test.mjs ran past its limit of 3 seconds and was ended while "the waits > waits for ever" was running. ${MEANS}\n`);
      assert.match(r.out, /passes first/);
      const kid = Number(readFileSync(join(dir, 'kid'), 'utf8'));
      for (const end = Date.now() + 5000 * SLOW; alive(kid);) { assert.ok(Date.now() < end, 'the harness\'s clean-up stopped what the file started'); await sleep(100); }
      await nothingLeft(r.group, 'the ended file');
    } finally {
      if (r) endGroup(r.group);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('one that ends in time prints nothing extra and exits 0 without waiting for its limit, on its own and under the runner', { timeout: 120000 * SLOW }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'file-limit-'));
    const runs = [];
    try {
      writeFileSync(join(dir, 'quick.test.mjs'), QUICK(LIB));
      for (const args of [['quick.test.mjs'], ['--test', 'quick.test.mjs']]) {
        const r = await run(args, { cwd: dir, env: envWith({ SPARK_TEST_FILE_LIMIT_S: '600' }), limit: 60000 * SLOW });
        runs.push(r);
        assert.equal(r.cut, false, `${args.join(' ')} waited for its limit: ${r.ms} ms`);
        assert.equal(r.code, 0, `${args.join(' ')}: ${r.out}\n${r.err}`);
        assert.equal(r.err, '', `${args.join(' ')} printed nothing on stderr`);
        assert.match(r.out, /ends at once/);
        assert.match(r.out, /ℹ pass 1\n/);
        assert.doesNotMatch(r.out, /ran past its limit|✖/);
        await nothingLeft(r.group, args.join(' '));
      }
    } finally {
      for (const r of runs) endGroup(r.group);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('test/lock.mjs given a hanging file among passing ones: it finishes, fails, and names that file once in its table', { timeout: 240000 * SLOW }, async () => {
    // A copy of what lock.mjs needs (the service, the tools, the harness) with three test files of its own.
    const root = mkdtempSync(join(tmpdir(), 'file-limit-lock-'));
    let r;
    try {
      for (const d of ['service', 'tools']) cpSync(join(REPO, d), join(root, d), { recursive: true });
      rmSync(join(root, 'service', 'workflows.lock.json'), { force: true });
      mkdirSync(join(root, 'test'));
      for (const f of readdirSync(join(REPO, 'test')).filter(f => f.endsWith('.mjs') && !f.endsWith('.test.mjs'))) cpSync(join(REPO, 'test', f), join(root, 'test', f));
      writeFileSync(join(root, 'test', 'hang.test.mjs'), HANGS('./lib.mjs'));
      writeFileSync(join(root, 'test', 'ok-one.test.mjs'), QUICK('./lib.mjs'));
      writeFileSync(join(root, 'test', 'ok-two.test.mjs'), "import { test } from 'node:test';\ntest('also ends at once', () => {});\n");
      const limit = 5 * SLOW;
      r = await run(['test/lock.mjs'], { cwd: root, env: envWith({ SPARK_TEST_FILE_LIMIT_S: String(limit) }), limit: 180000 * SLOW });
      const all = `${r.out}\n${r.err}`;
      assert.equal(r.cut, false, `test/lock.mjs didn't finish within ${180 * SLOW} s:\n${all.slice(-3000)}`);
      assert.equal(r.code, 1, all.slice(-3000));
      assert.ok(all.includes(`test/hang.test.mjs ran past its limit of ${limit} seconds and was ended while "the waits > waits for ever" was running. ${MEANS}`), all.slice(-3000));
      assert.match(all, /The suite didn’t pass, so nothing was marked as tested\./);
      assert.doesNotMatch(all, /^Marked build/m);
      assert.match(r.out, /^Seconds per test file, longest first \(3 files\):$/m, r.out.slice(-1500));
      assert.deepEqual(failedIn(r.out), ['test/hang.test.mjs']);
      for (const f of ['ok-one', 'ok-two']) assert.match(r.out, new RegExp(`^\\s*[\\d.]+\\s+pass\\s+test/${f}\\.test\\.mjs$`, 'm'));
      assert.doesNotMatch(r.out, /^\s*[\d.]+\s+pass\s+test\/hang\.test\.mjs$/m, 'the ended file is one row, FAIL');
      assert.equal(existsSync(join(root, 'service', 'workflows.lock.json')), false, 'nothing was marked as tested');
      await nothingLeft(r.group, 'test/lock.mjs');
    } finally {
      if (r) endGroup(r.group);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
