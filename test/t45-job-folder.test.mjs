// Covers: a compensated job start checks its named shared folder inside the real target supervisor before starting
// the immutable container ID. A symlink refuses the start; real folders work; the former ID-as-folder guard is a negative control.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, symlinkSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const exec = promisify(execFile), source = name => readFileSync(new URL(`../service/src/${name}`, import.meta.url), 'utf8');
const py = source('17-rollback-target.mjs').split('const ROLLBACK_TARGET_PY = String.raw`')[1].split('\n`;')[0];
const apps = source('21-apps.mjs'), guardText = apps.slice(apps.indexOf('const jobMountsReal = '), apps.indexOf('\nfunction jobNotReal('));
const q = value => `'${String(value).replace(/'/g, `'\\''`)}'`;
const jobMountsReal = new Function('SHARED_AT', 'JOB_NOT_REAL', 'q', `${guardText}\nreturn jobMountsReal;`)('.local/share/spark-portal/workspaces/shared', 97, q);
const ID = 'a'.repeat(64), AT = '2026-11-17T00:00:00.000Z';
async function run(t, { link, wrongFolder = false, missingGuard = false }) {
  const home = mkdtempSync(join(tmpdir(), 't45-job-folder-')), bin = join(home, 'bin'), dir = join(home, '.local/share/spark-portal/workspaces/shared/jobs');
  mkdirSync(bin); mkdirSync(dir, { recursive: true }); mkdirSync(join(home, 'outside'));
  if (link) symlinkSync(join(home, 'outside'), join(dir, 'gpu-hold')); else mkdirSync(join(dir, 'gpu-hold'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  writeFileSync(join(bin, 'docker'), `#!/usr/bin/env python3
import json,os,sys
args=sys.argv[1:]; p=os.path.join(os.environ['HOME'],'started')
x={'Id':'${ID}','Name':'/gpu-hold','State':{'Status':'running' if os.path.exists(p) else 'exited','StartedAt':'${AT}'},'Config':{'Labels':{'spark.job':'1'}},'HostConfig':{}}
if args[0]=='inspect':print(json.dumps([x]));sys.exit(0)
if args[0]=='ps':sys.exit(0)
if args[0]=='start':
 assert args[1]=='${ID}'
 open(p,'w').write(args[1]);print(args[1]);sys.exit(0)
sys.exit(1)
`); chmodSync(join(bin, 'docker'), 0o755);
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` }, payload = { operation: '123456789abc', attempt: 'abcdef123456', command: 'cccccccccccc' };
  const call = async value => {
    const r = await exec('python3', ['-c', py, Buffer.from(JSON.stringify({ ...payload, ...value })).toString('base64')], { env, timeout: 5000 });
    const row = r.stdout.split('\n').find(line => line.startsWith('rollback\t')); assert.ok(row, r.stdout); return JSON.parse(row.slice(9));
  };
  const guard = missingGuard ? {} : { guard: jobMountsReal(wrongFolder ? ID : 'gpu-hold') };
  await call({ mode: 'dispatch', action: 'start', name: 'gpu-hold', expected: { id: ID, startedAt: AT }, ...guard });
  for (const end = Date.now() + 10000; Date.now() < end;) {
    const { result } = await call({ mode: 'receipt' });
    if (result) return { result, started: existsSync(join(home, 'started')) };
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail('The job-folder target command did not finish');
}

test('the real job-folder check rejects a symlink before any exact-ID Docker start', async t => {
  const out = await run(t, { link: true });
  assert.equal(out.started, false); assert.equal(out.result.terminal, true); assert.equal(out.result.notIssued, true);
  assert.equal(out.result.guardFailed, true); assert.equal(out.result.code, 97);
  assert.match(out.result.guardPath, /\/jobs\/gpu-hold$/);
});
test('a real job folder permits the exact immutable-ID start', async t => {
  const out = await run(t, { link: false });
  assert.equal(out.started, true); assert.equal(out.result.terminal, true); assert.equal(out.result.seen.id, ID);
});
test('negative control: the old ID-as-folder check misses the named symlink', async t => {
  const out = await run(t, { link: true, wrongFolder: true });
  assert.equal(out.started, true, 'this is why the caller must check the container name');
});
test('a job start with no folder guard stays unconfirmed and never starts Docker', async t => {
  const out = await run(t, { link: false, missingGuard: true });
  assert.equal(out.started, false); assert.equal(out.result.terminal, false);
});
