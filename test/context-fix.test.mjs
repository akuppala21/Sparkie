// Covers: A known bad-flag start failure never removes a context setting (R16, contract 6.9). Engine aliases are
// protected, a failed real service deploy keeps the requested context and restores the workloads it stopped.
// T42 (part): rejected context flags are not dropped; the out-of-memory question is still pending.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { T, REPO, useFleet, api, waitFor, SLOW } from './lib.mjs';

const MODEL = 'NVIDIA-Nemotron-Nano-9B-v2';
useFleet({ watchMs: 60000, statusMs: 20000, prepare: ({ root }) => {
  for (const id of ['spark2', 'spark3', 'spark4']) {
    const file = join(root, id, 'models', MODEL, 'spark.json');
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(file, JSON.stringify({ ...manifest, args: [...manifest.args, '--context-length', '131072'] }));
  }
  writeFileSync(join(root, 'spark4', '.mock', 'reject-flag'), '--context-length');
} });

test('a rejected context setting never becomes an automatic flag-removal retry, for each engine alias', () => {
  const src = readFileSync(join(REPO, 'service/src/17-changes.mjs'), 'utf8');
  const from = src.indexOf('const START_FAILURES = [');
  const expr = src.slice(from, src.indexOf('];', from) + 1).replace(/^const START_FAILURES = /, '');
  const rejected = message => message.split(' ');
  const badFlag = new Function('rejectedFlags', 'dig', `return ${expr};`)(rejected, { OWN: new Set(), flagKey: f => f }).find(f => f.id === 'bad-flag');
  for (const flag of ['--context-length', '--max-model-len', '--max_seq_len', '--ctx-size', '-c']) {
    assert.equal(badFlag.next({ fix: {}, message: flag }), null, flag);
    assert.equal(badFlag.next({ fix: {}, message: `--other ${flag}` }), null, `mixed ${flag}`);
  }
  assert.deepEqual(badFlag.next({ fix: {}, message: '--other' }), { fix: { dropFlags: ['--other'] } }, 'other rejected settings still use the known fix');
});

test('a failed start keeps its context setting and puts back the workloads it stopped', { timeout: 180000 * SLOW }, async () => {
  const plan = await api(`/deploy/plan?model=${MODEL}&node=spark4`);
  assert.equal(plan.status, 200, plan.text);
  const stops = plan.json.steps.filter(s => s.kind === 'stop');
  const required = stops.filter(s => s.required).map(s => s.container);
  assert.ok(required.length, 'the fixture requires stopping earlier work');
  const r = await api('/deploy', { method: 'POST', body: { model: MODEL, node: 'spark4',
    keep: stops.filter(s => !s.required).map(s => s.container), stop: required.map(c => `spark4/${c}`) } });
  assert.equal(r.status, 202, r.text);
  const job = await waitFor(async () => {
    const got = await api(`/jobs/${r.json.id}`);
    assert.equal(got.status, 200, got.text);
    return got.json.status === 'running' ? null : got.json;
  }, { timeout: 120000, what: 'the rejected-context start to finish its cleanup' });
  assert.equal(job.status, 'failed', JSON.stringify(job));
  assert.match(job.error, /engine didn’t accept one of the settings/);
  assert.ok(!job.fixed, 'no context-changing fix was counted as success');
  assert.ok(!job.log.some(l => /attempt 2 of 3|Starting it again without/.test(l)), JSON.stringify(job.log));
  const args = readFileSync(join(T.fleet.root, 'spark4', '.mock', 'last-run-args'), 'utf8').split('\n');
  assert.equal(args[args.indexOf('--context-length') + 1], '131072', 'the requested context stayed in the attempted command');
  const containers = readFileSync(join(T.fleet.root, 'spark4', '.mock', 'containers'), 'utf8').split('\n').map(l => l.split('|'));
  assert.notEqual(containers.find(l => l[0] === `sc-${MODEL}`)?.[1], 'running');
  for (const name of required) assert.equal(containers.find(l => l[0] === name)?.[1], 'running', `${name} was restored`);
});
