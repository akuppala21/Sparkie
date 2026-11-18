// Covers: The self-test uses one tailnet route for the job’s name and Docker command, even if the route changes
// or first becomes known before Docker creates the job.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const part = name => readFileSync(new URL(`../service/src/${name}`, import.meta.url), 'utf8');
function take(source, pattern) {
  const match = pattern.exec(source);
  assert.ok(match, `source fixture matches ${pattern}`);
  return match[1] ?? match[0];
}

const selfTest = part('21-selftest.mjs'), apps = part('21-apps.mjs');
const jobName = take(selfTest, /^(const selfTestName = [^]*?)^const wordList /m);
const testContext = take(selfTest, /^const selfTestCtx = .*;$/m);
const testSetup = take(selfTest, /^async function selfTest\(j, asked, where, image\) \{\n([^]*?)^  await sleep\(0\);/m);
const jobDir = take(apps, /^const jobDir = .*;$/m);
const appRun = take(apps, /^function appRunCommand\([^]*?^}/m);
const appRunCall = take(apps, /\$\{(appRunCommand\([^\n]*?\))\}/);

// Use the self-test’s setup and keep_running’s Docker argument handoff with a controllable route between them.
const fixture = new Function('createHash', 'q', `
  let selfTailnetHost = null;
  const nodeById = id => ({ id }), sparkName = node => node.id, healOwner = () => ({});
  const containerName = name => 'sc-' + name;
  const selfTestAddress = () => 'https://hub.test.ts.net:8443/console/api/v1/models';
  const selfTestMine = () => {}, selfTestNeed = () => null;
  const SELF_TEST_WEB_PORT = 18990, SELF_TEST_WEB = [], SELF_TEST_SH = 'sh', SELF_TEST_PY = 'py';
  ${jobName}
  ${testContext}
  ${jobDir}
  ${appRun}
  return {
    refresh(route) { selfTailnetHost = route; },
    start(j, where, image) {
      ${testSetup}
      return { job, appCtx };
    },
    docker(a, sp, ctx) { return ${appRunCall}; },
  };
`);

test('the self-test keeps the job’s original route when Tailscale refreshes', () => {
  const first = 'hub.test.ts.net:100.64.9.2', next = 'hub.test.ts.net:100.64.9.3';
  const f = fixture(createHash, JSON.stringify), image = 'python:3.12-slim';
  const where = { spark: 'spark3', model: { name: 'tiny-model' } };
  const nextJob = () => f.start({ id: 'operation' }, where, image);
  f.refresh(first);
  const known = nextJob();
  f.refresh(null);
  const unknown = nextJob();
  f.refresh(next);
  const later = nextJob();

  assert.equal(new Set([known.job, unknown.job, later.job]).size, 3, 'each route names a different job');
  const command = ({ job, appCtx }) => f.docker({ container: job, image, once: true, gpu: true, memoryGB: 2,
    volumes: [], env: [] }, { tsip: '100.64.9.4' }, appCtx);
  const hosts = run => run.match(/--add-host=[^"'\s]+/g) || [];
  assert.deepEqual(hosts(command(known)), [`--add-host=${first}`]);
  assert.deepEqual(hosts(command(unknown)), []);
  assert.deepEqual(hosts(command(later)), [`--add-host=${next}`]);
});
