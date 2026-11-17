// Covers: common Docker fixture faults still apply after callers switch from names to immutable container IDs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const exec = promisify(execFile), docker = new URL('./mock/bin/docker', import.meta.url).pathname;
async function fixture(t, state = 'running') {
  const home = mkdtempSync(join(tmpdir(), 't45-mock-id-')), mock = join(home, '.mock'); mkdirSync(mock);
  t.after(() => rmSync(home, { recursive: true, force: true }));
  writeFileSync(join(mock, 'containers'), `held|${state}|Up 1 second|app|||||\n`);
  const call = (...args) => exec('bash', [docker, ...args], { env: { ...process.env, HOME: home }, timeout: 5000 });
  const id = (await call('inspect', '-f', '{{.Id}}', 'held')).stdout.trim(); assert.match(id, /^[a-f0-9]{64}$/);
  return { home, mock, call, id, state: () => readFileSync(join(mock, 'containers'), 'utf8').split('|')[1] };
}
test('an ID-based stop honors the named stop-fails fixture instead of silently succeeding', async t => {
  const f = await fixture(t); writeFileSync(join(f.mock, 'stop-fails'), 'held');
  await assert.rejects(f.call('stop', '--time', '20', f.id), e => e.code === 1 && /a made-up failure/.test(e.stderr));
  assert.equal(f.state(), 'running');
});
test('an ID-based start honors the named start-fails fixture instead of silently succeeding', async t => {
  const f = await fixture(t, 'exited'); writeFileSync(join(f.mock, 'start-fails'), 'held');
  await assert.rejects(f.call('start', f.id), e => e.code === 1 && /a made-up failure/.test(e.stderr));
  assert.equal(f.state(), 'exited');
});
test('a detached run returns its actual immutable full container ID', async t => {
  const f = await fixture(t);
  const run = (await f.call('run', '-d', '--name', 'new-job', '--label', 'spark.app=1', 'example/image:1', 'sleep', '10')).stdout.trim();
  const seen = (await f.call('inspect', '-f', '{{.Id}}', 'new-job')).stdout.trim();
  assert.match(run, /^[a-f0-9]{64}$/); assert.equal(run, seen);
});
