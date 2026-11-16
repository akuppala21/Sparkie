// Covers: One tap ("Validate changed workflows"): start, stop and restart validated with a small model on Spark 3 or 4,
// what was running there runs again, Spark 2 untouched; "Auto-restart is OFF" until then; no earlier build to roll back
// to on the stand-in fleet. A model whose only proven setup is the brain's starts with it made plain; a cached copy
// whose files link outside its folder starts with each file mounted by itself.
// Only a weight file that is a plain file may link out of a cached copy: any other (a chat template, a folder, a device,
// an entry that is itself a link) stops the start with one line naming it, and nothing runs; the ordinary layout starts.
// A start that first copies the model from another Spark checks the same before anything is sent, with a weight file
// that leads out at least 16 MiB: a chat template or a small file under a weight name linked out stops it, a large
// shard is copied as a file and the model starts. A copy whose sender ends badly after a whole archive (A-21: a weight
// file it can't read left out) leaves nothing at the final place or in staging, the library doesn't count that Spark,
// and the next start copies again and completes; a copy cancelled part-way leaves nothing either. A copy that reached
// the other Spark but couldn't be moved into place there says so, names that Spark, and keeps the whole copy (W-9).
//
// One tap after an install (docs/contract.md 6.3): "Test the changes" runs each workflow that isn't validated
// with a small model on Spark 3 or 4 (never Spark 2), and starts again whatever had to stop. Auto-restart works before
// that (its first run validates it). Going back to the last good build needs a snapshot from the installer.
// Nothing here counts as validated at first (SPARK_CONSOLE_ASSUME_VALIDATED=0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, symlinkSync, rmSync, existsSync, statSync, lstatSync, closeSync, openSync, truncateSync, chmodSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { T, useFleet, api, call, createKey, createActKey, waitFor, SLOW } from './lib.mjs';

const keys = {};
// Seen on the real Sparks (2026-11-08): the brain's own runs (DFlash with a draft model only Spark 2 has, a stretched
// context) were saved as runs that worked, and the test reused one as an ordinary start on Spark 3, which SGLang refused.
// So the fleet starts with such runs on record: an old one with no brain mark, as fast as can be, for the model the
// test would otherwise pick, and one marked as the brain's.
const DFLASH = ['--context-length', '1000000', '--speculative-algorithm', 'DFLASH', '--speculative-num-draft-tokens', '16'];
const run = (model, extra) => ({ key: JSON.stringify([model, 'sglang', 'lmsysorg/sglang:v0.5.23', 1, DFLASH, {}]), model, repo: null, title: model, engine: 'sglang',
  image: 'lmsysorg/sglang:v0.5.23', args: DFLASH, env: {}, sparks: 1, nodes: ['spark2'], firstAt: '2026-11-08T00:00:00Z', lastAt: '2026-11-08T00:00:00Z', runs: 1,
  best: { decodeTokS: 99, ttftMs: 100 }, ...extra });
// (A-21) A stand-in tar in front of the fleet's (PATH): with ~/.mock/tar-hold, a tar that writes an archive sends its
// first MiB and then holds the rest until the file goes, as a link that stalls part-way does; else the stand-in's own.
const BIN = join(dirname(fileURLToPath(import.meta.url)), 'mock', 'bin');
const WRAP = mkdtempSync(join(tmpdir(), 'validate-tar-'));
writeFileSync(join(WRAP, 'tar'), `#!/bin/bash
real=${JSON.stringify(join(BIN, 'tar'))}
writes=; for a in "$@"; do case "$a" in -c*) writes=1 ;; esac; done
[ -n "$writes" ] && [ -f "$HOME/.mock/tar-hold" ] || exec "$real" "$@"
"$real" "$@" | head -c 1048576
while [ -f "$HOME/.mock/tar-hold" ]; do sleep 0.2; done
exit 0
`);
chmodSync(join(WRAP, 'tar'), 0o755);
useFleet({ watchMs: 60000, statusMs: 3000, env: { SPARK_CONSOLE_ASSUME_VALIDATED: '0', PATH: `${WRAP}:${BIN}:${process.env.PATH}` },
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
  // (the page has no Deploy view: the owner is told to ask Sparkie, TR-5)
  assert.ok(w.recentLog.some(l => /across two Sparks” still needs its first run: when Spark 3 and Spark 4 are both free, ask Sparkie to start one model across them\.$/.test(l)), w.recentLog.join('\n'));
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

// A link planted in a cached copy must not put any file of the Spark into the model's container (Docker mounts as root):
// a link out of the copy's folder is followed only for a weight file that is a plain file. Any other stops the start
// with one line naming the file, and no docker run happens. (The owner's own starts: refusals don't pause agents.)
const hub4 = () => join(T.fleet.root, 'spark4', '.cache', 'huggingface', 'hub');
function cachedCopy(name, links, at = hub4()) {
  const entry = join(at, `models--testorg--${name}`), snap = join(entry, 'snapshots', 'c1');
  mkdirSync(snap, { recursive: true }); mkdirSync(join(entry, 'blobs'), { recursive: true });
  writeFileSync(join(entry, 'blobs', 'cfg1'), JSON.stringify({ architectures: ['Qwen3ForCausalLM'], model_type: 'qwen3', torch_dtype: 'bfloat16', max_position_embeddings: 40960 }));
  writeFileSync(join(entry, 'blobs', 'w1'), Buffer.alloc(1000000));
  symlinkSync('../../blobs/cfg1', join(snap, 'config.json'));
  symlinkSync('../../blobs/w1', join(snap, 'model-00001-of-00002.safetensors'));
  for (const [file, to] of Object.entries(links)) symlinkSync(to, join(snap, file));
  return { model: `testorg--${name}`, entry, snap };
}
const lastRun4 = () => { try { return readFileSync(join(T.fleet.root, 'spark4', '.mock', 'last-run-args'), 'utf8'); } catch { return ''; } };
async function ownerStartOn4(model) {
  const r = await api('/actions/start_model', { method: 'POST', body: { model, spark: 'spark4' } });
  assert.equal(r.json?.outcome, 'started', r.text);
  let w;
  for (const until = Date.now() + 240000 * SLOW; ;) {
    w = (await call(keys.look.token, 'wait_operation', { id: r.json.operation, seconds: 30 })).value;
    if (w.status !== 'running') break;
    assert.ok(Date.now() < until, 'still starting');
  }
  return w;
}
async function refusedOn4(model, file) {
  const before = lastRun4();
  const w = await ownerStartOn4(model);
  assert.equal(w.status, 'failed', JSON.stringify(w));
  assert.match(w.error, new RegExp(`${file.replace(/\./g, '\\.')} in the Hugging Face cache copy of ${model} links outside the model’s folder`), w.error);
  assert.equal(lastRun4(), before, 'no docker run');
}

test('a cached copy whose chat template links outside its folder isn\'t started: one line names the file, nothing runs; without the link it starts', { timeout: 600000 * SLOW }, async () => {
  const secret = join(T.fleet.root, 'spark4', 'not-the-models.txt');
  writeFileSync(secret, 'a private file of the Spark\n');
  const c = cachedCopy('Templated-27B', { 'chat_template.jinja': secret });
  await refusedOn4(c.model, 'chat_template.jinja');
  // The ordinary layout (every file a link into blobs/ of the same folder) starts as before: the folder, read-only.
  rmSync(join(c.snap, 'chat_template.jinja'));
  const w = await ownerStartOn4(c.model);
  assert.equal(w.status, 'completed', JSON.stringify(w));
  const args = lastRun4();
  assert.match(args, /^spark\.model=testorg--Templated-27B$/m);
  assert.match(args, /\/models--testorg--Templated-27B:\/hf:ro$/m, 'the folder');
  assert.doesNotMatch(args, /^type=bind,/m, 'no file by itself');
});

test('weight files linked straight out of a cached copy to plain files still start, each mounted by itself', { timeout: 300000 * SLOW }, async () => {
  const disk = join(T.fleet.root, 'spark4', 'otherdisk');
  mkdirSync(disk, { recursive: true });
  const names = ['model-00002-of-00002.safetensors', 'pytorch_model.bin', 'extra.pt', 'extra.pth'];
  for (const [i] of names.entries()) writeFileSync(join(disk, `s${i}`), Buffer.alloc(1000));
  const c = cachedCopy('Shards-27B', Object.fromEntries(names.map((n, i) => [n, join(disk, `s${i}`)])));
  const w = await ownerStartOn4(c.model);
  assert.equal(w.status, 'completed', JSON.stringify(w));
  const args = lastRun4();
  assert.match(args, /^spark\.model=testorg--Shards-27B$/m);
  assert.doesNotMatch(args, /:\/hf:ro$/m, 'not the folder');
  for (const [i, n] of names.entries()) assert.match(args, new RegExp(`^type=bind,src=.*/otherdisk/s${i},dst=/hf/snapshots/c1/${n.replace(/\./g, '\\.')},readonly$`, 'm'), n);
  assert.match(args, /^type=bind,src=.*\/blobs\/w1,dst=\/hf\/snapshots\/c1\/model-00001-of-00002\.safetensors,readonly$/m);
  assert.match(args, /^type=bind,src=.*\/blobs\/cfg1,dst=\/hf\/snapshots\/c1\/config\.json,readonly$/m);
});

test('a weight file linked out to a folder or a device, or a cached copy that is itself a link, isn\'t started', { timeout: 600000 * SLOW }, async () => {
  const away = join(T.fleet.root, 'spark4', 'a-folder');
  mkdirSync(away, { recursive: true });
  await refusedOn4(cachedCopy('Foldered-27B', { 'model-00002-of-00002.safetensors': away }).model, 'model-00002-of-00002.safetensors');
  await refusedOn4(cachedCopy('Deviced-27B', { 'model-00002-of-00002.safetensors': '/dev/null' }).model, 'model-00002-of-00002.safetensors');
  // The copy's own folder a link (it could point at the home): every file in it counts as outside. (A whole cache on
  // another disk, the hub or a folder above it a link, is judged by where the copy's folder really is; not tried here,
  // as it would move every model of this Spark.)
  const elsewhere = join(T.fleet.root, 'spark4', 'elsewhere');
  mkdirSync(elsewhere, { recursive: true });
  const c = cachedCopy('Linkedentry-27B', {}, elsewhere);
  symlinkSync(c.entry, join(hub4(), 'models--testorg--Linkedentry-27B'));
  await refusedOn4(c.model, 'config.json');
});

// A start on Spark 4 of a model only Spark 3 holds copies it first, following its links (copyModel): before anything is
// sent the copy checks the same rule, and a weight file that leads out must be 16 MiB or more there, since the copy
// hands the bytes over and any readable file would land on Spark 4 under a weight's name.
const hub3 = () => join(T.fleet.root, 'spark3', '.cache', 'huggingface', 'hub');
async function copyRefused(model, file) {
  const before = lastRun4();
  const w = await ownerStartOn4(model);
  assert.equal(w.status, 'failed', JSON.stringify(w));
  assert.match(w.error, /wasn’t copied from spark3/, w.error);
  assert.match(w.error, new RegExp(`${file.replace(/\./g, '\\.')} in the Hugging Face cache copy of ${model} links outside the model’s folder`), w.error);
  assert.ok(!existsSync(join(hub4(), `models--${model}`)), 'nothing copied');
  assert.ok(!existsSync(join(hub4(), '.spark-console-incoming', `models--${model}`)), 'nothing half copied');
  assert.equal(lastRun4(), before, 'no docker run');
}

test('a start that copies the model from another Spark first: a chat template or a small file under a weight name linked out stops it before anything is sent', { timeout: 600000 * SLOW }, async () => {
  const key = join(T.fleet.root, 'spark3', 'made-up-key');
  writeFileSync(key, '-----BEGIN MADE-UP KEY-----\nnot a real one\n-----END MADE-UP KEY-----\n');
  await copyRefused(cachedCopy('Copytemplate-27B', { 'chat_template.jinja': key }, hub3()).model, 'chat_template.jinja');
  await copyRefused(cachedCopy('Copykey-27B', { 'model-00002-of-00002.safetensors': key }, hub3()).model, 'model-00002-of-00002.safetensors');
});

test('a start that copies the model from another Spark first: a real weight shard linked out to a large plain file is copied as a file, and the model starts', { timeout: 300000 * SLOW }, async () => {
  const disk = join(T.fleet.root, 'spark3', 'shardsdisk');
  mkdirSync(disk, { recursive: true });
  const shard = join(disk, 'shard2');
  closeSync(openSync(shard, 'w'));
  truncateSync(shard, 17 * 2 ** 20);
  const c = cachedCopy('Copyshard-27B', { 'model-00002-of-00002.safetensors': shard }, hub3());
  const w = await ownerStartOn4(c.model);
  assert.equal(w.status, 'completed', JSON.stringify(w));
  const there = join(hub4(), `models--${c.model}`, 'snapshots', 'c1', 'model-00002-of-00002.safetensors');
  assert.ok(!lstatSync(there).isSymbolicLink(), 'a file, not a link');
  assert.equal(statSync(there).size, 17 * 2 ** 20);
  assert.match(lastRun4(), /^spark\.model=testorg--Copyshard-27B$/m);
});

// A-21: the receiving Spark unpacks into staging and stops there; only when both ends ended 0 is it moved into place.
// A model in ~/models on Spark 3 only (a config and two weight files); the tests run as a user that is not root.
const models = (spark, ...p) => join(T.fleet.root, spark, 'models', ...p);
function onlyOn3(name, mib) {
  const dir = models('spark3', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ architectures: ['Qwen3ForCausalLM'], model_type: 'qwen3', torch_dtype: 'bfloat16', max_position_embeddings: 40960 }));
  for (const n of ['model-00001-of-00002.safetensors', 'model-00002-of-00002.safetensors']) { closeSync(openSync(join(dir, n), 'w')); truncateSync(join(dir, n), mib * 2 ** 20); }
  return dir;
}
const planOn4 = async model => (await api(`/deploy/plan?model=${model}&node=spark4`)).json;
const copies = async model => (await api('/models')).json.library.find(m => m.name === model)?.copies || [];

test('a copy whose sender ends badly after a whole archive (a weight file it can\'t read) leaves nothing on the other Spark, isn\'t counted there, and the next start copies again', { timeout: 600000 * SLOW }, async () => {
  const MODEL = 'a21-twoshard', dir = onlyOn3(MODEL, 1), second = join(dir, 'model-00002-of-00002.safetensors');
  chmodSync(second, 0o000);
  try {
    assert.throws(() => readFileSync(second), /EACCES/, 'this test needs a user that can’t read the second weight file (not root)');
    assert.ok((await planOn4(MODEL)).steps.some(s => s.kind === 'copy' && s.from === 'spark3'));
    const w = await ownerStartOn4(MODEL);
    assert.equal(w.status, 'failed', JSON.stringify(w));
    assert.match(w.error, /Copy failed: some files on spark3 can’t be read as your user/, w.error);
    assert.ok(!existsSync(models('spark4', MODEL)), 'nothing at the final place');
    assert.ok(!existsSync(models('spark4', '.incoming', MODEL)), 'nothing in staging');
    assert.ok(!(await copies(MODEL)).includes('spark4'), 'the library doesn’t count Spark 4');
    assert.ok((await planOn4(MODEL)).steps.some(s => s.kind === 'copy' && s.from === 'spark3'), 'the next plan still copies');
  } finally { chmodSync(second, 0o644); }
  const w = await ownerStartOn4(MODEL);
  assert.equal(w.status, 'completed', JSON.stringify(w));
  assert.deepEqual(readdirSync(models('spark4', MODEL)).sort(), ['config.json', 'model-00001-of-00002.safetensors', 'model-00002-of-00002.safetensors']);
  assert.equal(statSync(models('spark4', MODEL, 'model-00002-of-00002.safetensors')).size, 2 ** 20);
});

test('a copy cancelled part-way leaves nothing at the final place and nothing in staging', { timeout: 600000 * SLOW }, async () => {
  const MODEL = 'a21-cancelled';
  onlyOn3(MODEL, 2);
  const hold = join(T.fleet.root, 'spark3', '.mock', 'tar-hold');
  writeFileSync(hold, '');
  let id = null;
  try {
    const r = await api('/actions/start_model', { method: 'POST', body: { model: MODEL, spark: 'spark4' } });
    assert.equal(r.json?.outcome, 'started', r.text);
    id = r.json.operation;
    // (part of it has come over, and the rest is held)
    await waitFor(async () => { const o = (await api(`/jobs/${id}`)).json; assert.equal(o.status, 'running', JSON.stringify(o)); return o.progress?.done >= 2 ** 20 && existsSync(models('spark4', '.incoming', MODEL)); },
      { timeout: 120000 * SLOW, what: 'part of the copy on Spark 4', every: 200 });
    const c = await api(`/jobs/${id}/cancel`, { method: 'POST', body: {} });
    assert.equal(c.status, 200, c.text);
  } finally { rmSync(hold, { force: true }); }
  const w = await waitFor(async () => { const o = (await api(`/jobs/${id}`)).json; return o?.status && o.status !== 'running' ? o : null; }, { timeout: 180000 * SLOW, what: 'the start to end', every: 500 });
  assert.equal(w.status, 'cancelled', JSON.stringify(w));
  assert.ok(!existsSync(models('spark4', MODEL)), 'nothing at the final place');
  assert.ok(!existsSync(models('spark4', '.incoming', MODEL)), 'nothing in staging');
  assert.ok(!(await copies(MODEL)).includes('spark4'));
});

// W-9: the copy reaches Spark 4 whole, but its move into place there fails: an earlier entry left at the final place
// holds a folder this user can't write (as files a container wrote as root are). The words name Spark 4, never Spark 3,
// and the whole copy is kept in staging there, with the one command that finishes it.
test('a copy that reached the other Spark but couldn\'t be moved into place there: the words name that Spark and how to finish it, and the whole copy is kept', { timeout: 600000 * SLOW }, async () => {
  const c = cachedCopy('Movefail-27B', {}, hub3()), entry4 = join(hub4(), `models--${c.model}`), locked = join(entry4, 'blobs', 'locked');
  mkdirSync(locked, { recursive: true });
  writeFileSync(join(locked, 'left-by-a-container'), 'x');
  chmodSync(locked, 0o555);
  try {
    assert.ok((await planOn4(c.model)).steps.some(s => s.kind === 'copy' && s.from === 'spark3'), 'a copy is planned (what is left there isn’t a copy)');
    const w = await ownerStartOn4(c.model);
    assert.equal(w.status, 'failed', JSON.stringify(w));
    const [first] = w.error.split('\n');
    assert.match(first, new RegExp(`^Copy failed: the copy reached spark4 but couldn’t be moved into place there \\([^)]*Permission denied[^)]*\\)\\. The whole copy is kept there in ~/\\.cache/huggingface/hub/\\.spark-console-incoming/models--${c.model}\\. To finish it, on spark4 run: sudo chown -R \\$USER ~/\\.cache/huggingface/hub/models--${c.model} && rm -rf ~/\\.cache/huggingface/hub/models--${c.model} && mv ~/\\.cache/huggingface/hub/\\.spark-console-incoming/models--${c.model} ~/\\.cache/huggingface/hub/models--${c.model}$`), first);
    assert.doesNotMatch(w.error, /On spark3 run|files on spark3 can’t be read/);
    assert.ok(existsSync(join(hub4(), '.spark-console-incoming', `models--${c.model}`, 'snapshots', 'c1', 'config.json')), 'the whole copy is kept in staging');
  } finally { chmodSync(locked, 0o755); }
});

test('going back to the last good build: none on the stand-in fleet, so it says so', async () => {
  assert.deepEqual((await api('/rollback')).json, { available: false, stamp: null });
  assert.equal((await api('/rollback', { method: 'POST', body: {} })).status, 404);
});
