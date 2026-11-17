// Covers: T42 preparation boundaries through the stand-in service: a numeric context request survives waking a
// sleeping compute Spark and reaches the actual model launch; expiry during a real model copy prevents launch,
// leaves the copied files intact, restores earlier work, and offers no shorter retry. Never reaches a real Spark.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, mkdirSync, mkdtempSync, chmodSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { T, useFleet, api, waitFor, sleep, REPO, SLOW } from './lib.mjs';
import { startPlugs } from './mock/plugs.mjs';

const WAKE = 'testorg--context-wake', COPY = 'testorg--context-copy';
const IMAGE = JSON.parse(readFileSync(join(REPO, 'service', 'config.json'), 'utf8')).images.vllm;
const WINDOW = Math.min(120000 * SLOW, 600000), OFFSET = WINDOW + 5000;
const BIN = join(REPO, 'test', 'mock', 'bin'), WRAP = mkdtempSync(join(tmpdir(), 'context-preparation-'));
// Observe the actual Docker invocation, independent of the requested arguments or job's public context record.
writeFileSync(join(WRAP, 'docker'), `#!/bin/bash
name='' context='' previous=''
if [ "$1" = run ]; then
  for word in "$@"; do
    [ "$previous" != --name ] || name=$word
    case "$previous" in --context-length|--max-model-len|--max_seq_len|--ctx-size|-c) context=$word ;; esac
    previous=$word
  done
  case "$name" in sc-*) printf '%s|%s\\n' "$name" "$context" >> "$HOME/.mock/t42-preparation-launches" ;; esac
fi
exec ${JSON.stringify(join(BIN, 'docker'))} "$@"
`);
// Hold only the receiving end AFTER real tar has unpacked this model. The sender and every other archive keep
// their normal behavior; removing the hold lets production copyModel move its actual staging folder into place.
writeFileSync(join(WRAP, 'tar'), `#!/bin/bash
/usr/bin/tar "$@"; result=$?
if [ "$result" = 0 ] && [ -e "$HOME/.mock/t42-hold-copy" ] && [ -f "$HOME/models/.incoming/${COPY}/config.json" ]; then
  case "$*" in *' -xf -'*)
    : > "$HOME/.mock/t42-copy-unpacked"
    for ((n=0; n<1200; n++)); do [ -e "$HOME/.mock/t42-hold-copy" ] || break; sleep 0.1; done
    ;;
  esac
fi
exit "$result"
`);
for (const f of ['docker', 'tar']) chmodSync(join(WRAP, f), 0o755);
const plugs = await startPlugs([
  { node_id: 2, available: true, attributes: { '1/6/0': true, '1/144/8': 0, '1/144/4': 121000, '1/144/5': 0 } },
  { node_id: 3, available: true, attributes: { '1/6/0': true, '1/144/8': 0, '1/144/4': 121000, '1/144/5': 0 } },
  { node_id: 5, available: true, readOnly: true, attributes: { '1/6/0': true, '1/144/8': 150000, '1/144/4': 121000, '1/144/5': 1300 } },
]);
after(() => plugs.close());
useFleet({ statusMs: 1500, watchMs: 60000, env: {
  NODE_OPTIONS: `--import=${join(REPO, 'test', 'mock', 'clock.mjs')}`,
  SPARK_CONSOLE_FIX_WINDOW_MS: String(WINDOW), PATH: `${WRAP}:${BIN}:${process.env.PATH}`,
  SPARK_CONSOLE_PLUGS_URL: plugs.url, SPARK_CONSOLE_PLUGS_MS: '500',
  SPARK_CONSOLE_POWER_MS: '1000', SPARK_CONSOLE_POWER_FIRST_MS: '1000', SPARK_CONSOLE_POWER_POLL_MS: '300',
  SPARK_CONSOLE_POWER_OFF_WAIT_MS: String(8000 * SLOW), SPARK_CONSOLE_POWER_ON_WAIT_MS: String(30000 * SLOW),
  SPARK_CONSOLE_POWER_CYCLE_MS: '300', SPARK_CONSOLE_POWER_HOLD_MS: String(3000 * SLOW), SPARK_CONSOLE_HEAL_SETTLE_MS: '2000',
}, prepare: ({ root, stateDir }) => {
  writeFileSync(join(stateDir, 'plugs.json'), JSON.stringify({ spark2: { node: 5, readOnly: true }, spark3: { node: 2 }, spark4: { node: 3 } }), { mode: 0o600 });
  writeFileSync(join(stateDir, 'power.json'), JSON.stringify({ idleMinutes: 0, off: {} }), { mode: 0o600 });
  for (const [spark, model] of [['spark3', COPY], ['spark4', WAKE]]) {
    const dir = join(root, spark, 'models', model);
    mkdirSync(dir, { recursive: true });
    copyFileSync(join(root, 'spark3', 'models', 'gpt-oss-20b', 'config.json'), join(dir, 'config.json'));
    writeFileSync(join(dir, 'model.safetensors'), Buffer.alloc(1024));
    writeFileSync(join(dir, 'spark.json'), JSON.stringify({ title: 'Context preparation', engine: 'vllm', image: IMAGE, args: [], memoryGiB: 8 }));
    const containers = join(root, spark, '.mock', 'containers');
    writeFileSync(containers, readFileSync(containers, 'utf8').split('\n').filter(l => !/^qwen-recipe-/.test(l)).join('\n'));
  }
} }, async () => {
  plugs.attach({ offlineFile: T.fleet.offlineFile, sparks: { 2: 'spark3', 3: 'spark4' }, bootMs: 1500 });
});
after(() => rmSync(WRAP, { recursive: true, force: true }));
const mock = (spark, file) => join(T.fleet.root, spark, '.mock', file);
const stateOf = (spark, name) => readFileSync(mock(spark, 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];
const launches = (spark, name) => { try { return readFileSync(mock(spark, 't42-preparation-launches'), 'utf8').trim().split('\n').map(l => l.split('|')).filter(([n]) => n === `sc-${name}`); } catch { return []; } };
const act = (name, body) => api(`/actions/${name}`, { method: 'POST', body });
async function finished(id) {
  return waitFor(async () => {
    const r = await api(`/jobs/${id}`); assert.equal(r.status, 200, r.text);
    return r.json.status !== 'running' && r.json.finishedAt ? r.json : null;
  }, { timeout: 240000, every: 250, what: `context preparation operation ${id} to finish` });
}
async function done(r) {
  assert.equal(r.status, 200, r.text); assert.equal(r.json.outcome, 'started', r.text);
  const j = await finished(r.json.operation); assert.equal(j.status, 'completed', JSON.stringify(j)); return j;
}

// T42 (part): waking delegates the original numeric request to its own real model-start operation.
test('a wake-first start preserves numeric context through the power-on handoff to the actual launch', { timeout: 420000 * SLOW }, async () => {
  const running = await act('running_models', {}); assert.equal(running.status, 200, running.text);
  for (const m of running.json.models.filter(m => m.spark === 'spark4' && m.container?.startsWith('sc-'))) {
    await done(await act('stop_model', { spark: 'spark4', container: m.container }));
  }
  await done(await act('power_off', { spark: 'spark4' }));
  assert.ok(readFileSync(T.fleet.offlineFile, 'utf8').split(/\s+/).includes('spark4'));
  const off = JSON.parse(readFileSync(join(T.fleet.stateDir, 'power.json'), 'utf8')).off.spark4;
  assert.ok(off?.models.includes(WAKE), 'the sleeping Spark has the requested model on record');
  const before = plugs.commands.length, count = launches('spark4', WAKE).length;
  const r = await act('start_model', { model: WAKE, spark: 'spark4', contextTokens: 65536 });
  assert.deepEqual(r.json?.poweringOn, ['spark4'], r.text);
  const outer = await done(r);
  assert.equal(outer.type, 'power-on'); assert.match(String(outer.inner), /^[0-9a-f]{12}$/);
  const inner = await finished(outer.inner);
  assert.equal(inner.status, 'completed', JSON.stringify(inner));
  assert.equal(inner.partOf, outer.id); assert.equal(inner.setupTried?.on, 'spark4');
  assert.deepEqual(launches('spark4', WAKE).slice(count), [[`sc-${WAKE}`, '65536']], 'one actual launch with the exact original context');
  assert.equal(stateOf('spark4', `sc-${WAKE}`), 'running');
  assert.deepEqual(plugs.commands.slice(before), [{ node: 3, command: 'on' }]);
  assert.equal(JSON.parse(readFileSync(join(T.fleet.stateDir, 'power.json'), 'utf8')).off.spark4, undefined);
  assert.equal(inner.contextQuestion, undefined);
});

// T42 (part): the final launch fence follows an actual cross-Spark file copy, including the staging move.
test('expiry during a real model copy prevents launch and restores the earlier workload', { timeout: 420000 * SLOW }, async t => {
  const target = join(T.fleet.root, 'spark4', 'models', COPY);
  assert.equal(existsSync(target), false, 'this start really needs a copy');
  writeFileSync(mock('spark4', 't42-hold-copy'), '');
  t.after(async () => {
    rmSync(mock('spark4', 't42-hold-copy'), { force: true });
    rmSync(mock('spark4', 't42-copy-unpacked'), { force: true });
    rmSync(join(T.fleet.dir, 'clock-offset'), { force: true }); await sleep(400);
  });
  const p = await api(`/deploy/plan?model=${COPY}&node=spark4`); assert.equal(p.status, 200, p.text);
  assert.ok(p.json.steps.some(s => s.kind === 'copy' && s.from === 'spark3'), p.text);
  const stops = p.json.steps.filter(s => s.kind === 'stop');
  const body = { model: COPY, node: 'spark4', contextTokens: 131072,
    keep: stops.filter(s => !s.required).map(s => s.container), stop: stops.filter(s => s.required).map(s => `spark4/${s.container}`) };
  assert.ok(body.stop.includes(`spark4/sc-${WAKE}`), 'the previous running model must be restored after expiry');
  const before = launches('spark4', COPY).length;
  const r = await api('/deploy', { method: 'POST', body }); assert.equal(r.status, 202, r.text);
  await waitFor(() => existsSync(mock('spark4', 't42-copy-unpacked')), { timeout: 120000, every: 100, what: 'the actual copy to unpack on Spark 4 while held before completion' });
  assert.ok(existsSync(join(T.fleet.root, 'spark4', 'models', '.incoming', COPY, 'model.safetensors')));
  assert.equal(stateOf('spark4', `sc-${WAKE}`), 'exited', 'the old workload was stopped before preparation');
  writeFileSync(join(T.fleet.dir, 'clock-offset'), String(OFFSET)); await sleep(400);
  rmSync(mock('spark4', 't42-hold-copy'), { force: true });
  const failed = await finished(r.json.id);
  assert.equal(failed.status, 'failed', JSON.stringify(failed)); assert.match(failed.error, /30 minutes.*ended/i);
  assert.ok(existsSync(join(target, 'config.json')) && existsSync(join(target, 'model.safetensors')), 'the real copy landed before launch was refused');
  assert.equal(existsSync(join(T.fleet.root, 'spark4', 'models', '.incoming', COPY)), false, 'the staging move completed');
  assert.equal(launches('spark4', COPY).length, before, 'no model run after the copy crossed the deadline');
  assert.ok(!failed.ranHere?.length);
  for (const item of body.stop) assert.equal(stateOf('spark4', item.slice('spark4/'.length)), 'running', `${item} restored`);
  assert.equal(failed.contextQuestion, undefined);
  assert.ok(!((await api('/jobs')).json.jobs).some(j => j.retryOf === failed.id));
});
