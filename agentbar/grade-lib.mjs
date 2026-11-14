// Helpers the tasks' graders share. They run inside the trial's container, after the engine has finished, against the
// workspace the engine left behind.
import { readFileSync, readdirSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const tail = (s, n = 1500) => String(s || '').slice(-n);

// service/server.mjs is still exactly its parts (the agent rebuilt it, or didn't need to).
export function buildCheck(work) {
  const r = spawnSync(process.execPath, ['tools/build-server.mjs', '--check'], { cwd: work, encoding: 'utf8', timeout: 60000 });
  return { name: 'service/server.mjs matches its parts', pass: r.status === 0, detail: r.status === 0 ? '' : tail(r.stderr || r.stdout, 300) };
}

function nodeTest(work, file, timeoutMs) {
  return spawnSync(process.execPath, ['--test', '--test-reporter=spec', file], {
    cwd: work, encoding: 'utf8', timeout: timeoutMs, env: { ...process.env, SPARK_TEST_STRICT: '1' },
  });
}

// A check the agent never saw: copied into test/, run, and removed again.
export async function runHiddenTest(work, url, name = 'the hidden check passes') {
  const src = fileURLToPath(url), dest = join(work, 'test', basename(src));
  copyFileSync(src, dest);
  try {
    const r = nodeTest(work, `test/${basename(src)}`, 10 * 60000);
    return { name, pass: r.status === 0, detail: r.status === 0 ? '' : tail(r.stdout + r.stderr) };
  } finally { rmSync(dest, { force: true }); }
}

// One of the repository's own test files, as the agent left it.
export async function runRepoTest(work, file, name) {
  if (!existsSync(join(work, file))) return { name, pass: false, detail: `${file} is missing` };
  const r = nodeTest(work, file, 15 * 60000);
  return { name, pass: r.status === 0, detail: r.status === 0 ? '' : tail(r.stdout + r.stderr) };
}

// test/*.test.mjs fingerprints, taken before the engine starts (pristine) and compared after.
export function testPrints(work) {
  const dir = join(work, 'test');
  return Object.fromEntries(readdirSync(dir).filter(f => f.endsWith('.test.mjs')).map(f => [f, createHash('sha256').update(readFileSync(join(dir, f))).digest('hex')]));
}
// The test files the agent added or changed, with their text.
export function changedTests(work, pristine) {
  const now = testPrints(work);
  return Object.entries(now).filter(([f, h]) => pristine[f] !== h).map(([f]) => ({ file: `test/${f}`, text: readFileSync(join(work, 'test', f), 'utf8') }));
}
