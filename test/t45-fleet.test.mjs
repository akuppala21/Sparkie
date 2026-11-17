// Covers: T45 through the real stand-in service. Spark4 drops during an across start after its actual Docker run;
// Spark3's independent original returns immediately, Spark4's same-name original stays aside until it returns,
// and the failed model is never rerun. Repeat after killing/restarting the console on its exact saved state.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, existsSync, mkdirSync, mkdtempSync, chmodSync, copyFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { T, useFleet, api, waitFor, REPO, SERVICE_FILE, SLOW } from './lib.mjs';
const MODEL = 'testorg--t45-target', OLD3 = 'sc-gpt-oss-20b', OLD4 = `sc-${MODEL}`, SINCE = '2026-11-17T00:00:00.000Z';
const BIN = join(REPO, 'test/mock/bin'), WRAP = mkdtempSync(join(tmpdir(), 't45-fleet-'));
const IMAGE = JSON.parse(readFileSync(join(REPO, 'service/config.json'), 'utf8')).images.vllm;
let current = null;
writeFileSync(join(WRAP, 'docker'), `#!/bin/bash
name='' previous=''
if [ "$1" = run ]; then
  for word in "$@"; do [ "$previous" != --name ] || name=$word; previous=$word; done
  case "$name" in sc-*) printf '%s\\n' "$name" >> "$HOME/.mock/t45-launches" ;; esac
fi
${JSON.stringify(join(BIN, 'docker'))} "$@"; result=$?
if [ "$result" = 0 ] && [ "$name" = ${JSON.stringify(`${OLD4}-part2`)} ] && [ -e "$HOME/.mock/t45-drop" ]; then
  rm -f "$HOME/.mock/t45-drop"
  printf 'spark4\\n' >> "$SPARK_CONSOLE_OFFLINE_FILE"
  echo 'Error response from daemon: the stand-in connection went away after the part was created' >&2
  exit 125
fi
exit "$result"
`); chmodSync(join(WRAP, 'docker'), 0o755);
useFleet({ hub: 'spark1', watchMs: 60000, statusMs: 60000, env: { PATH: `${WRAP}:${BIN}:${process.env.PATH}`, SPARK_CONSOLE_HEAL_MS: '1000' },
  prepare: ({ root, stateDir }) => {
    for (const spark of ['spark3', 'spark4']) {
      const dir = join(root, spark, 'models', MODEL); mkdirSync(dir, { recursive: true });
      copyFileSync(join(root, 'spark3/models/gpt-oss-20b/config.json'), join(dir, 'config.json'));
      writeFileSync(join(dir, 'model.safetensors'), Buffer.alloc(1024));
      writeFileSync(join(dir, 'spark.json'), JSON.stringify({ title: 'T45 target', engine: 'vllm', image: IMAGE, args: [], memoryGiB: 8 }));
      writeFileSync(join(root, spark, '.mock/containers'), `${spark === 'spark3' ? OLD3 : OLD4}|running|Up 10 minutes|1|${spark === 'spark3' ? 'gpt-oss-20b' : MODEL}||||\n`);
      rmSync(join(root, spark, '.mock/gpu'), { force: true });
    }
    writeFileSync(join(stateDir, 'desired.json'), JSON.stringify({ revision: 1, revisions: [], running: [
      { spark: 'spark3', container: OLD3, model: 'gpt-oss-20b', since: SINCE }, { spark: 'spark4', container: OLD4, model: MODEL, since: SINCE },
    ] }));
  } });
after(() => { current?.kill('SIGKILL'); rmSync(WRAP, { recursive: true, force: true }); });
const mock = (spark, name) => join(T.fleet.root, spark, '.mock', name);
const state = (spark, name) => readFileSync(mock(spark, 'containers'), 'utf8').split('\n').find(x => x.startsWith(`${name}|`))?.split('|')[1];
const notes = () => { try { return Object.values(JSON.parse(readFileSync(join(T.fleet.stateDir, 'saved-runs.json'), 'utf8')).runs).filter(r => r.kind === 'start-rollback'); } catch (e) { if (e.code === 'ENOENT') return []; throw e; } };
const launches = spark => { try { return readFileSync(mock(spark, 't45-launches'), 'utf8').trim().split('\n').filter(Boolean); } catch { return []; } };
async function finished(id) {
  return waitFor(async () => { const r = await api(`/jobs/${id}`); return r.json?.finishedAt && r.json.status !== 'running' ? r.json : null; }, { timeout: 300000, every: 250, what: 'the failed across attempt to finish its immediate put-back' });
}
async function restart() {
  if (current) { const end = new Promise(resolve => current.once('exit', resolve)); current.kill('SIGKILL'); await end; }
  else { process.kill(T.fleet.servicePid(), 'SIGKILL'); await waitFor(() => T.fleet.serviceExit(), { timeout: 10000, what: 'the cut-off console to end' }); }
  current = spawn(process.execPath, [SERVICE_FILE], { cwd: REPO, env: T.fleet.env, stdio: 'ignore' });
  await waitFor(async () => (await api('/health').catch(() => null))?.status === 200, { timeout: 30000, what: 'the console back on the same state' });
}
async function across() {
  const planned = await api(`/deploy/cluster-plan?model=${MODEL}&nodes=spark3,spark4`); assert.equal(planned.status, 200, planned.text);
  const stops = planned.json.members.flatMap(m => m.steps.filter(s => s.kind === 'stop').map(s => `${m.node}/${s.container}`));
  assert.ok(stops.includes(`spark3/${OLD3}`)); assert.ok(stops.includes(`spark4/${OLD4}`));
  writeFileSync(mock('spark4', 't45-drop'), '');
  const r = await api('/deploy/cluster', { method: 'POST', body: { model: MODEL, nodes: ['spark3', 'spark4'], keep: [], stop: stops } });
  assert.equal(r.status, 202, r.text); return finished(r.json.id);
}
for (const withRestart of [false, true]) test(`T45: Spark4 returns ${withRestart ? 'after a console restart' : 'later'} and its earlier copy is restored without rerunning the failed start`, { timeout: 420000 * SLOW }, async () => {
  const offline = readFileSync(T.fleet.offlineFile, 'utf8');
  try {
    const result = await across(); assert.equal(result.status, 'failed', JSON.stringify(result));
    assert.equal(state('spark3', OLD3), 'running');
    const held = notes().find(r => r.operation === result.id); assert.ok(held, 'unfinished compensation is durable');
    const aside = `${OLD4}-before-${result.id}`;
    assert.equal(state('spark4', aside), 'exited');
    const owed = `${OLD4} (there as ${aside}) wasn’t started again on Spark 4: ${OLD4}-part2 may still be running there (Spark Console couldn’t confirm it stopped). Stop it there, then start ${OLD4} again.`;
    assert.equal(result.cleanUp, owed);
    assert.ok(result.log.some(line => /power cycle/.test(line)), result.log.join('\n'));
    const before3 = launches('spark3'), before4 = launches('spark4');
    if (withRestart) await restart();
    writeFileSync(T.fleet.offlineFile, offline);
    await waitFor(() => state('spark4', OLD4) === 'running' && !notes().some(r => r.operation === result.id), { timeout: 180000, every: 500, what: 'Spark4’s exact earlier copy to return and its obligation to retire' });
    assert.equal(state('spark3', OLD3), 'running'); assert.notEqual(state('spark3', OLD4), 'running'); assert.notEqual(state('spark4', `${OLD4}-part2`), 'running');
    assert.deepEqual(launches('spark3'), before3); assert.deepEqual(launches('spark4'), before4);
    const old = await api('/desired'); assert.ok(old.json.running.some(x => x.spark === 'spark4' && x.container === OLD4));
  } finally { writeFileSync(T.fleet.offlineFile, offline); rmSync(mock('spark4', 't45-drop'), { force: true }); }
});
