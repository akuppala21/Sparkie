// Covers: a failed create client is settled only by its returned full container ID and this exact command's labels.
// Missing, short, extra, renamed or mismatched evidence stays held. The failure remains visible after positive proof.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, chmodSync, rmSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const exec = promisify(execFile), source = readFileSync(new URL('../service/src/17-rollback-target.mjs', import.meta.url), 'utf8');
const py = source.split('const ROLLBACK_TARGET_PY = String.raw`')[1].split('\n`;')[0];
const ID = 'a'.repeat(64), OTHER = 'b'.repeat(64), AT = '2026-11-17T00:00:00.000Z';
const q = value => `'${String(value).replace(/'/g, `'\\''`)}'`;
async function create(t, { output = ID, id = ID, name = 'sc-new', labels = {} } = {}) {
  const home = mkdtempSync(join(tmpdir(), 't45-created-')), bin = join(home, 'bin'); mkdirSync(bin);
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const payload = { operation: '123456789abc', attempt: 'abcdef123456', command: 'cccccccccccc' };
  const x = { Id: id, Name: `/${name}`, State: { Status: 'running', StartedAt: AT }, Config: { Labels: { 'spark.operation': payload.operation, 'spark.attempt': payload.attempt, 'spark.command': payload.command, ...labels } }, HostConfig: {} };
  writeFileSync(join(home, 'container.json'), JSON.stringify(x));
  writeFileSync(join(bin, 'docker'), `#!/usr/bin/env python3
import json,os,sys
args=sys.argv[1:]; home=os.environ['HOME']
if args[0]=='ps':sys.exit(0)
if args[0]=='inspect':
 if not os.path.exists(os.path.join(home,'created')):print('Error: No such container',file=sys.stderr);sys.exit(1)
 print(json.dumps([json.load(open(os.path.join(home,'container.json')))]));sys.exit(0)
sys.exit(1)
`); chmodSync(join(bin, 'docker'), 0o755);
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` };
  const call = async value => {
    const r = await exec('python3', ['-c', py, Buffer.from(JSON.stringify({ ...payload, ...value })).toString('base64')], { env, timeout: 5000 });
    const row = r.stdout.split('\n').find(line => line.startsWith('rollback\t')); assert.ok(row, r.stdout); return JSON.parse(row.slice(9));
  };
  await call({ mode: 'dispatch', action: 'run', name: 'sc-new', script: `touch "$HOME/created"; printf '%s\\n' ${q(output)}; exit 1` });
  for (const end = Date.now() + 10000; Date.now() < end;) {
    const { result } = await call({ mode: 'receipt' });
    if (result) return { result, fence: await call({ mode: 'fence', commands: [payload.command] }) };
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail('The create receipt did not finish');
}
test('a failed client with the exact full returned create ID and labels is settled with its failure retained', async t => {
  const { result, fence } = await create(t);
  assert.equal(result.terminal, true); assert.equal(result.code, 1); assert.equal(result.failure, 'Docker refused the start');
  assert.equal(result.seen.id, ID); assert.equal(fence.active, false); assert.equal(fence.results.cccccccccccc.terminal, true);
});
for (const [label, options] of [
  ['no returned ID', { output: '' }], ['short returned ID', { output: ID.slice(0, 12) }],
  ['extra output', { output: `${ID}\nother output` }], ['different inspected ID', { id: OTHER }],
  ['renamed container', { name: 'somebody-else' }], ['different operation', { labels: { 'spark.operation': '111111111111' } }],
  ['different attempt', { labels: { 'spark.attempt': '111111111111' } }], ['different command', { labels: { 'spark.command': '111111111111' } }],
]) test(`a failed client with ${label} stays held after the fence`, async t => {
  const { result, fence } = await create(t, options);
  assert.equal(result.terminal, false); assert.equal(result.code, 1); assert.equal(result.seen, undefined);
  assert.equal(fence.results.cccccccccccc.terminal, false);
});
