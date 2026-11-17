// Covers: ordinary model-download admission through the real stand-in service: the page rejects an explicit hub,
// unknown/offline target, unknown size and unreadable/insufficient fresh disk before creating a job or download;
// the hub remains visible in inventory but is not a target. Download-first starts recheck fresh disk after placement.
// GGUF admission includes fresh selected-file and projector sizes, refuses incomplete size metadata, and never shrinks
// a larger catalog estimate. Valid compute downloads still use the native CLI or existing engine-image fallback, and
// a download-first start still works. These are preflight estimates, not task/download-byte accounting. No real Spark.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, existsSync, mkdtempSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { T, useFleet, api, waitFor, REPO, SLOW } from './lib.mjs';

const PAGE = 'testorg/admission-page', START = 'testorg/admission-start', FALLBACK = 'testorg/admission-fallback';
const GGUF = 'testorg/admission-GGUF', INCOMPLETE = 'testorg/admission-unknown-GGUF', CONSERVATIVE = 'testorg/admission-estimate-GGUF';
const UNKNOWN = 'testorg/admission-unknown-size', QUANT = 'Q4_K_M';
const BIN = join(REPO, 'test', 'mock', 'bin'), WRAP = mkdtempSync(join(tmpdir(), 'download-admission-'));
const HF = join(WRAP, 'hf-fixture.json');
writeFileSync(HF, JSON.stringify([
  { id: GGUF, siblings: [{ rfilename: 'model-Q4_K_M.gguf', size: 8e9 }, { rfilename: 'mmproj-f16.gguf', size: 4e9 }] },
  { id: INCOMPLETE, siblings: [{ rfilename: 'model-Q4_K_M.gguf', size: 8e9 }, { rfilename: 'mmproj-f16.gguf' }] },
  { id: CONSERVATIVE, siblings: [{ rfilename: 'model-Q4_K_M.gguf', size: 1e9 }] },
]));
// Observe admission without relying on cache-size growth: calls record that a native downloader or downloader
// container actually started. The real stand-ins still perform every allowed download and model launch.
writeFileSync(join(WRAP, 'hf'), `#!/bin/bash
printf 'hf|%s\n' "$2" >> "$MOCK_DIR/admission-downloads"
exec ${JSON.stringify(join(BIN, 'hf'))} "$@"
`);
writeFileSync(join(WRAP, 'docker'), `#!/bin/bash
case "$*" in *snapshot_download*) printf 'image|download\n' >> "$MOCK_DIR/admission-downloads" ;; esac
exec ${JSON.stringify(join(BIN, 'docker'))} "$@"
`);
// Only the admission probe names the existing Hugging Face hub folder. For one test its two reads see different
// free space; ordinary inventory's df of the home, and every other command, keep the normal stand-in behavior.
writeFileSync(join(WRAP, 'df'), `#!/bin/bash
sequence="$HOME/.mock/admission-df-sequence"
if [ "\${!#}" = "$HOME/.cache/huggingface/hub" ] && [ -s "$sequence" ]; then
  first=$(head -n 1 "$sequence"); tail -n +2 "$sequence" > "$sequence.next"; mv "$sequence.next" "$sequence"
  printf 'Avail\n%s\n' "$first"; exit 0
fi
exec ${JSON.stringify(join(BIN, 'df'))} "$@"
`);
for (const f of ['hf', 'docker', 'df']) chmodSync(join(WRAP, f), 0o755);
useFleet({ hub: 'spark1', watchMs: 60000, statusMs: 60000, env: { PATH: `${WRAP}:${BIN}:${process.env.PATH}`, SPARK_CONSOLE_HF_FIXTURE: HF },
  prepare: ({ stateDir }) => {
    const version = (repo, extra = {}) => ({ repo, sizeGB: 1, needGB: 8, sparks: 1, engine: 'vllm', ...extra });
    const models = [PAGE, START, FALLBACK].map((repo, i) => ({ id: `admission${i}`, title: `Admission ${i}`, variants: [version(repo)], setups: [] }));
    for (const repo of [GGUF, INCOMPLETE, CONSERVATIVE]) models.push({ id: `admission-${repo.split('/').pop().toLowerCase()}`, title: 'Admission GGUF', setups: [], variants: [version(repo, { engine: 'llama.cpp', file: QUANT,
      sizeGB: repo === CONSERVATIVE ? 20 : 1, quants: [{ file: QUANT, sizeGB: repo === CONSERVATIVE ? 20 : 1 }] })] });
    models.push({ id: 'admission-unknown', title: 'Unknown size', variants: [version(UNKNOWN, { sizeGB: null })], setups: [] });
    writeFileSync(join(stateDir, 'added-models.json'), JSON.stringify({ models }));
  } });
after(() => rmSync(WRAP, { recursive: true, force: true }));
const mock = (spark, file) => join(T.fleet.root, spark, '.mock', file);
const cache = (spark, repo) => join(T.fleet.root, spark, '.cache', 'huggingface', 'hub', `models--${repo.replace('/', '--')}`);
const downloads = () => { try { return readFileSync(join(T.fleet.dir, 'admission-downloads'), 'utf8').trim().split('\n').filter(Boolean); } catch { return []; } };
const jobs = async () => (await api('/jobs')).json.jobs;
const page = body => api('/recipes/download', { method: 'POST', body });
const start = body => api('/actions/start_model', { method: 'POST', body });
async function finished(id) {
  return waitFor(async () => { const r = await api(`/jobs/${id}`); assert.equal(r.status, 200, r.text); return r.json.status !== 'running' && r.json.finishedAt ? r.json : null; },
    { timeout: 240000, every: 250, what: `download admission operation ${id} to finish` });
}
async function unchangedDownload(before, target, repo) {
  assert.deepEqual(downloads(), before.calls, 'no downloader or downloader container ran');
  assert.deepEqual((await jobs()).map(j => j.id), before.jobs, 'no operation was created');
  assert.ok(!existsSync(cache(target, repo)), 'no target cache folder was made');
}
const before = async () => ({ calls: downloads(), jobs: (await jobs()).map(j => j.id) });

// R1: the shipped hub identity is tested here, not the stand-in fleet's historical Spark-2 default.
test('the page refuses an explicit hub or unknown target before any job, downloader or cache write', async () => {
  const hub = (await api('/bootstrap')).json.hubId; assert.equal(hub, 'spark1');
  for (const node of [hub, 'unknown-spark', '', 0, null]) {
    const was = await before(), r = await page({ repo: PAGE, node });
    assert.equal(r.status, node === hub ? 403 : 409, r.text);
    if (node === hub) assert.match(r.json.error, /Sparkie|brain/);
    await unchangedDownload(was, hub, PAGE);
  }
});

test('the hub stays visible in model presence while ordinary download targets and default exclude it', async () => {
  const r = await api('/recipes'); assert.equal(r.status, 200, r.text);
  assert.ok(!r.json.targets.some(t => t.id === 'spark1'));
  assert.notEqual(r.json.defaultTarget, 'spark1');
  assert.ok(r.json.models.some(m => m.variants.some(v => v.onDisk.includes('spark1'))), 'models already on the hub are still reported');
});

test('an explicit offline compute target is refused before work is created', async t => {
  const old = readFileSync(T.fleet.offlineFile, 'utf8');
  t.after(() => writeFileSync(T.fleet.offlineFile, old));
  writeFileSync(T.fleet.offlineFile, `${old}\nspark4\n`);
  const was = await before(), r = await page({ repo: PAGE, node: 'spark4' });
  assert.equal(r.status, 409, r.text); assert.match(r.json.error, /can’t be checked/);
  await unchangedDownload(was, 'spark4', PAGE);
});

test('unknown model size and malformed or insufficient fresh disk refuse the page before any job', async t => {
  t.after(() => rmSync(mock('spark3', 'disk-free'), { force: true }));
  const unknown = await before(), r = await page({ repo: UNKNOWN, node: 'spark3' });
  assert.equal(r.status, 409, r.text); assert.match(r.json.error, /size is not known/);
  await unchangedDownload(unknown, 'spark3', UNKNOWN);
  for (const free of ['not-a-number', ' ', '-1', '1e12', '9007199254740992', '1 000 000', '21099999999']) {
    writeFileSync(mock('spark3', 'disk-free'), free);
    const was = await before(), got = await page({ repo: PAGE, node: 'spark3' });
    assert.equal(got.status, 409, `${free}: ${got.text}`);
    assert.match(got.json.error, free === '21099999999' ? /enough free disk/ : /can’t be checked/);
    await unchangedDownload(was, 'spark3', PAGE);
  }
});

test('fresh GGUF sizes include the projector, reject unknown selected files, and preserve a larger catalog estimate', { timeout: 300000 * SLOW }, async t => {
  t.after(() => { rmSync(mock('spark3', 'disk-free'), { force: true }); rmSync(mock('spark3', 'admission-df-sequence'), { force: true }); });
  // The page's 1 GB estimate fits in 33 GB. Fresh 8 GB weights+4 GB projector need 33.2 GB; weights alone would fit.
  for (const [repo, free, message] of [[GGUF, 33e9, /enough free disk/], [INCOMPLETE, 100e9, /every selected model file/], [CONSERVATIVE, 30e9, /enough free disk/]]) {
    writeFileSync(mock('spark3', 'disk-free'), String(free));
    if (repo === CONSERVATIVE) writeFileSync(mock('spark3', 'admission-df-sequence'), '50000000000\n30000000000\n');
    const calls = downloads(), r = await page({ repo, node: 'spark3', file: QUANT });
    assert.equal(r.status, 202, r.text);
    const failed = await finished(r.json.id);
    assert.equal(failed.status, 'failed', JSON.stringify(failed)); assert.match(failed.error, message);
    if (repo === GGUF) assert.equal(failed.total, 12e9, 'fresh admission includes both selected files');
    if (repo === CONSERVATIVE) {
      assert.equal(failed.total, 20e9, 'smaller fresh weights never shrink the larger catalog estimate');
      assert.equal(readFileSync(mock('spark3', 'admission-df-sequence'), 'utf8'), '', 'both preflight and execution read fresh disk');
    }
    assert.deepEqual(downloads(), calls);
    assert.ok(!existsSync(cache('spark3', repo)));
  }
});

test('download-first starts refuse fresh low or unknown disk even when placement status said there was room', { timeout: 300000 * SLOW }, async t => {
  t.after(() => rmSync(mock('spark3', 'disk-free'), { force: true }));
  const status = await api('/status?fresh=1'); assert.equal(status.status, 200, status.text);
  assert.ok(status.json.nodes.find(n => n.id === 'spark3').diskFreeGiB > 30, 'placement has a usable disk reading');
  for (const free of ['1', 'unreadable']) {
    writeFileSync(mock('spark3', 'disk-free'), free);
    const calls = downloads(), r = await start({ model: START, spark: 'spark3' });
    assert.equal(r.status, 200, r.text); assert.equal(r.json.outcome, 'started', r.text);
    const failed = await finished(r.json.operation);
    assert.equal(failed.status, 'failed', JSON.stringify(failed));
    assert.match(failed.error, free === '1' ? /enough free disk/ : /can’t be checked/);
    assert.deepEqual(downloads(), calls); assert.ok(!existsSync(cache('spark3', START)));
    assert.ok(!readFileSync(mock('spark3', 'containers'), 'utf8').includes('sc-testorg--admission-start|'));
  }
});

test('valid compute downloads still work with the native CLI and with the existing engine-image fallback', { timeout: 300000 * SLOW }, async t => {
  t.after(() => rmSync(mock('spark3', 'no-hf'), { force: true }));
  for (const [repo, fallback] of [[PAGE, false], [FALLBACK, true]]) {
    if (fallback) writeFileSync(mock('spark3', 'no-hf'), '');
    const r = await page({ repo, node: 'spark3' }); assert.equal(r.status, 202, r.text);
    const done = await finished(r.json.id); assert.equal(done.status, 'completed', JSON.stringify(done));
    assert.ok(existsSync(join(cache('spark3', repo), 'snapshots', 'm0ck', 'model.safetensors')));
    if (fallback) assert.ok(done.log.some(l => /Downloaded with the Hugging Face library inside/.test(l)));
  }
});

test('a valid compute download-first start still reaches a verified running model', { timeout: 300000 * SLOW }, async () => {
  const r = await start({ model: START, spark: 'spark4' }); assert.equal(r.status, 200, r.text); assert.equal(r.json.outcome, 'started', r.text);
  const done = await finished(r.json.operation); assert.equal(done.status, 'completed', JSON.stringify(done));
  assert.ok(done.endpoint, 'the model passed its normal answering check');
  assert.ok(existsSync(join(cache('spark4', START), 'snapshots', 'm0ck', 'model.safetensors')));
  assert.match(readFileSync(mock('spark4', 'containers'), 'utf8'), /^sc-testorg--admission-start\|running\|/m);
});
