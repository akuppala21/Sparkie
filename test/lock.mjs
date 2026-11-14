// Marks this build's workflows as tested: runs the whole suite strictly and, only if every test passes and no service
// file changed while it ran, writes the build id and each workflow's version to service/workflows.lock.json. Spark
// Console runs a workflow only when the installed build and its version are in that file (and the version has been
// validated on the real Sparks), so run this before installing a changed build:
//
//   node test/lock.mjs
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { startMock, REPO } from './start-mock.mjs';

const SERVICE = join(REPO, 'service');
const fingerprint = () => {
  const h = createHash('sha256');
  for (const f of readdirSync(SERVICE).filter(f => /\.(mjs|py|json)$/.test(f) && f !== 'workflows.lock.json').sort()) h.update(f).update(readFileSync(join(SERVICE, f)));
  return h.digest('hex');
};
// The service runs server.mjs, which is built from service/src/*.mjs: it has to match its parts.
const built = spawnSync(process.execPath, [join(REPO, 'tools', 'build-server.mjs'), '--check'], { stdio: 'inherit' });
if (built.status !== 0) process.exit(1);
const before = fingerprint();
// (SPARK_TEST_CONCURRENCY: fewer test files at once on a slow machine, e.g. one whose security software checks every
// process the stand-in fleet starts)
const suite = spawnSync(process.execPath, ['--test', `--test-concurrency=${Number(process.env.SPARK_TEST_CONCURRENCY) || 4}`, 'test/*.test.mjs'], { cwd: REPO, stdio: 'inherit', env: { ...process.env, SPARK_TEST_STRICT: '1' } });
if (suite.status !== 0) {
  console.error('\nThe suite didn’t pass, so nothing was marked as tested.');
  process.exit(1);
}
if (fingerprint() !== before) {
  console.error('\nService files changed while the suite ran, so nothing was marked as tested. Run it again.');
  process.exit(1);
}
const fleet = await startMock();
try {
  const { workflows } = await (await fetch(`${fleet.base}/workflows`)).json();
  const { build } = await (await fetch(`${fleet.base}/health`)).json();
  const lock = { build, testedAt: new Date().toISOString(), versions: Object.fromEntries(workflows.map(w => [w.id, w.version])) };
  writeFileSync(join(SERVICE, 'workflows.lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
  console.log(`\nMarked build ${build} as tested: ${workflows.map(w => `${w.id} ${w.version}`).join(', ')}`);
} finally { await fleet.stop(); }
