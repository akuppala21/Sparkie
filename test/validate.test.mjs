// Covers: One tap ("Validate changed workflows"): start, stop and restart validated with a small model on Spark 3 or 4,
// what was running there runs again, Spark 2 untouched; "Auto-restart is OFF" until then; no earlier build to roll back
// to on the stand-in fleet. A model whose only proven setup is the brain's starts with it made plain; a cached copy
// whose files link outside its folder starts with each file mounted by itself.
//
// One tap after an install (docs/contract.md 6.3): "Test the changes" runs each workflow that isn't validated
// with a small model on Spark 3 or 4 (never Spark 2), and starts again whatever had to stop. Auto-restart works before
// that (its first run validates it). Going back to the last good build needs a snapshot from the installer.
// Nothing here counts as validated at first (SPARK_CONSOLE_ASSUME_VALIDATED=0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, call, createKey, createActKey, SLOW } from './lib.mjs';

const keys = {};
// Seen on the real Sparks (2026-11-08): the brain's own runs (DFlash with a draft model only Spark 2 has, a stretched
// context) were saved as runs that worked, and the test reused one as an ordinary start on Spark 3, which SGLang refused.
// So the fleet starts with such runs on record: an old one with no brain mark, as fast as can be, for the model the
// test would otherwise pick, and one marked as the brain's.
const DFLASH = ['--context-length', '1000000', '--speculative-algorithm', 'DFLASH', '--speculative-num-draft-tokens', '16'];
const run = (model, extra) => ({ key: JSON.stringify([model, 'sglang', 'lmsysorg/sglang:v0.5.23', 1, DFLASH, {}]), model, repo: null, title: model, engine: 'sglang',
  image: 'lmsysorg/sglang:v0.5.23', args: DFLASH, env: {}, sparks: 1, nodes: ['spark2'], firstAt: '2026-11-08T00:00:00Z', lastAt: '2026-11-08T00:00:00Z', runs: 1,
  best: { decodeTokS: 99, ttftMs: 100 }, ...extra });
useFleet({ watchMs: 60000, statusMs: 3000, env: { SPARK_CONSOLE_ASSUME_VALIDATED: '0' },
  prepare: ({ stateDir }) => writeFileSync(join(stateDir, 'verified.json'), JSON.stringify({ deployments: [run('gpt-oss-20b', {}), run('RadixArk--Qwen3.8-27B-NVFP4', { brain: true }),
  run('unsloth--Qwen3.8-27B-NVFP4', { brain: true })] }), { mode: 0o600 }),
}, async () => { keys.look = await createKey('val'); });
const running = spark => readFileSync(join(T.fleet.root, spark, '.mock', 'containers'), 'utf8').split('\n').filter(l => l.split('|')[1] === 'running' && l.split('|')[3] === '1').map(l => l.split('|')[0]).sort();
const workflows = async () => Object.fromEntries((await api('/workflows')).json.workflows.map(w => [w.id, w.state]));

// v3.1 (2026-11-11): auto-restart works before its first test run (that run validates it), so nothing says it's off.
test('before: auto-restart isn\'t said to be off (it works, and its first run validates it)', async () => {
  const n = (await api('/jobs')).json.notices;
  assert.ok(!n.some(x => /Auto-restart is (paused|off)/.test(x.text)), JSON.stringify(n));
});

test('one tap validates start, stop and restart with a small model on Spark 3 or 4, and puts back what it stopped', { timeout: 600000 * SLOW }, async () => {
  const before = { spark3: running('spark3'), spark4: running('spark4'), spark2: running('spark2') };
  const r = await api('/workflows/validate', { method: 'POST', body: {} });
  assert.equal(r.status, 202, r.text);
  let w;
  for (const until = Date.now() + 540000 * SLOW; ;) {
    const v = await call(keys.look.token, 'wait_operation', { id: r.json.id, seconds: 30 });
    w = v.value;
    if (w.status !== 'running') break;
    assert.ok(Date.now() < until, 'still validating');
  }
  assert.equal(w.status, 'completed', JSON.stringify(w));
  // The brain's runs weren't repeated: no start used speculative decoding without its draft model.
  for (const sp of ['spark3', 'spark4']) {
    let args = '';
    try { args = readFileSync(join(T.fleet.root, sp, '.mock', 'last-run-args'), 'utf8'); } catch {}
    assert.doesNotMatch(args, /--speculative-algorithm/, `${sp}: ${args}`);
  }
  assert.deepEqual(await workflows(), { start_model: 'active', start_model_across: 'needs-validation', stop_model: 'active', find_setups: 'active', restart_model: 'active' });
  assert.ok(w.recentLog.some(l => /across two Sparks” still needs its first run/.test(l)), w.recentLog.join('\n'));
  // What ran on Spark 3 and 4 runs again; Spark 2 was never touched.
  assert.deepEqual({ spark3: running('spark3'), spark4: running('spark4'), spark2: running('spark2') }, before);
  assert.ok(!(await api('/jobs')).json.notices.some(n => /Auto-restart is paused/.test(n.text)));
  // A second test while one runs is refused; none runs now, and nothing waits, so it just finds nothing to do.
  assert.equal((await api('/workflows/validate', { method: 'POST', body: {} })).status, 202);
});

// Seen on the real Sparks (2026-11-09): only restart had changed, so the start that sets it up wasn't a validation run,
// and the test crashed naming its workflow ("Cannot read properties of null (reading 'title')").
test('only restart changed (start and stop still validated): one tap checks restart alone', { timeout: 600000 * SLOW }, async () => {
  for (const until = Date.now() + 120000 * SLOW; (await api('/jobs')).json.jobs.some(j => j.type === 'validate-workflows' && j.status === 'running');) {
    assert.ok(Date.now() < until, 'the last test run is still going');
    await new Promise(res => setTimeout(res, 1000));
  }
  const file = join(T.fleet.stateDir, 'validations.json');
  const all = JSON.parse(readFileSync(file, 'utf8'));
  delete all.restart_model;
  writeFileSync(file, JSON.stringify(all), { mode: 0o600 });
  assert.equal((await workflows()).restart_model, 'needs-validation');
  const r = await api('/workflows/validate', { method: 'POST', body: {} });
  assert.equal(r.status, 202, r.text);
  let w;
  for (const until = Date.now() + 540000 * SLOW; ;) {
    w = (await call(keys.look.token, 'wait_operation', { id: r.json.id, seconds: 30 })).value;
    if (w.status !== 'running') break;
    assert.ok(Date.now() < until, 'still validating');
  }
  assert.equal(w.status, 'completed', JSON.stringify(w));
  assert.deepEqual(await workflows(), { start_model: 'active', start_model_across: 'needs-validation', stop_model: 'active', find_setups: 'active', restart_model: 'active' });
  assert.ok(w.recentLog.some(l => /Restart a model as it was: validated/.test(l)), w.recentLog.join('\n'));
  assert.ok(w.recentLog.some(l => /Start a model on one Spark: done/.test(l)), w.recentLog.join('\n'));
});

test('a model whose only proven setup is the brain\'s starts elsewhere with that setup, minus its draft model and stretched context', { timeout: 300000 * SLOW }, async () => {
  const act = await createActKey('val-act');
  // (unsloth's copy sits unused on Spark 4, with no run of its own: only a brain run is on record for it)
  const r = await call(act.token, 'start_model', { model: 'unsloth--Qwen3.8-27B-NVFP4', spark: 'spark3' });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.value.setup, 'the brain’s proven setup, without its draft model', JSON.stringify(r.value));
  let w;
  for (const until = Date.now() + 240000 * SLOW; ;) {
    w = (await call(keys.look.token, 'wait_operation', { id: r.value.operation, seconds: 30 })).value;
    if (w.status !== 'running') break;
    assert.ok(Date.now() < until, 'still starting');
  }
  assert.equal(w.status, 'completed', JSON.stringify(w));
  assert.ok(w.recentLog.some(l => /Using the brain’s proven setup/.test(l)), w.recentLog.join('\n'));
  const args = readFileSync(join(T.fleet.root, 'spark3', '.mock', 'last-run-args'), 'utf8');
  assert.doesNotMatch(args, /--speculative-/);
  assert.doesNotMatch(args, /^1000000$/m, 'the stretched context is gone');
});

test('a cached copy whose weight files link outside its folder still starts: each file is mounted by itself', { timeout: 300000 * SLOW }, async () => {
  // Seen on Spark 3 (2026-11-08): the copy looked whole on the Spark (its blobs were links to elsewhere on the disk), but
  // the container, shown only the model's folder, found 3 weight files missing. The stand-in docker fails the same way.
  const hub = join(T.fleet.root, 'spark4', '.cache', 'huggingface', 'hub', 'models--testorg--Linked-27B');
  const disk = join(T.fleet.root, 'spark4', 'bigdisk');
  mkdirSync(join(hub, 'snapshots', 'c1'), { recursive: true }); mkdirSync(join(hub, 'blobs'), { recursive: true }); mkdirSync(disk, { recursive: true });
  writeFileSync(join(hub, 'blobs', 'cfg1'), JSON.stringify({ architectures: ['Qwen3ForCausalLM'], model_type: 'qwen3', torch_dtype: 'bfloat16', max_position_embeddings: 40960 }));
  writeFileSync(join(disk, 'w1'), Buffer.alloc(1000000));
  symlinkSync(join(disk, 'w1'), join(hub, 'blobs', 'w1'));
  symlinkSync('../../blobs/cfg1', join(hub, 'snapshots', 'c1', 'config.json'));
  symlinkSync('../../blobs/w1', join(hub, 'snapshots', 'c1', 'model.safetensors'));
  const act = await createActKey('val-linked');
  const r = await call(act.token, 'start_model', { model: 'testorg--Linked-27B', spark: 'spark4' });
  assert.equal(r.isError, false, r.text);
  let w;
  for (const until = Date.now() + 240000 * SLOW; ;) {
    w = (await call(keys.look.token, 'wait_operation', { id: r.value.operation, seconds: 30 })).value;
    if (w.status !== 'running') break;
    assert.ok(Date.now() < until, 'still starting');
  }
  assert.equal(w.status, 'completed', JSON.stringify(w));
  const args = readFileSync(join(T.fleet.root, 'spark4', '.mock', 'last-run-args'), 'utf8');
  assert.doesNotMatch(args, /:\/hf:ro$/m, 'not the folder');
  assert.match(args, /^type=bind,src=.*\/bigdisk\/w1,dst=\/hf\/snapshots\/c1\/model\.safetensors,readonly$/m);
  assert.match(args, /^type=bind,src=.*\/blobs\/cfg1,dst=\/hf\/snapshots\/c1\/config\.json,readonly$/m);
  assert.match(args, /^\/hf\/snapshots\/c1$/m, 'served from the usual path');
});

test('going back to the last good build: none on the stand-in fleet, so it says so', async () => {
  assert.deepEqual((await api('/rollback')).json, { available: false, stamp: null });
  assert.equal((await api('/rollback', { method: 'POST', body: {} })).status, 404);
});
