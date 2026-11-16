// Covers: A restart that doesn't answer within its limit (A-24; the limit set short here with
// SPARK_CONSOLE_RESTART_WAIT_MS): with the stand-in's serve-down it fails "…, so it was stopped again" and the container
// isn't running; with Docker there answering nothing by then, it fails "…, and it couldn't be stopped: it may still be
// running on Spark 3", that is the operation's clean-up, and nothing is said to be "missing"; as a saved workflow's
// only step, the run fails and nothing it started is running at its end. The limit moves only on the stand-in fleet: on
// any other console the variable is ignored (pure, from the limit's own line). A restart whose `docker start` Docker
// didn't answer in time, but that started all the same, is stopped again and says so (W-6).
//
// The stand-in fleet: Spark 3's model of Spark Console's is stopped before the service starts, so restart_model of
// sc-gpt-oss-20b there starts it and holds no port another model has; what should be running is seeded (Spark 4's model).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, mkdtempSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { T, useFleet, api, waitFor, SLOW, REPO } from './lib.mjs';

const GPT20 = 'sc-gpt-oss-20b', RADIX = 'sc-RadixArk--Qwen3.8-27B-NVFP4', LIMIT = 20000 * SLOW;
const SINCE = '2026-11-12T08:00:00.000Z';
const SEEDED = { revision: 1, running: [{ spark: 'spark4', container: RADIX, model: 'RadixArk--Qwen3.8-27B-NVFP4', since: SINCE, by: 'owner' }],
  revisions: [{ revision: 1, at: SINCE, by: 'owner', chat: null, operation: null, added: [`spark4/${RADIX}`], removed: [], before: [] }] };
// (W-6) A stand-in docker in front of the fleet's (PATH): a start of the container named in ~/.mock/start-hangs starts
// it, then doesn't come back (the restart gives a start 90 s); anything else goes to the stand-in as it is.
const BIN = join(dirname(fileURLToPath(import.meta.url)), 'mock', 'bin');
const WRAP = mkdtempSync(join(tmpdir(), 'restart-docker-'));
writeFileSync(join(WRAP, 'docker'), `#!/bin/bash
if [ "$1" = start ] && [ -s "$HOME/.mock/start-hangs" ]; then
  for a in "$@"; do [ "$a" = "$(cat "$HOME/.mock/start-hangs")" ] && { ${JSON.stringify(join(BIN, 'docker'))} "$@"; exec >/dev/null 2>&1 </dev/null; sleep 150; exit 1; }; done
fi
exec ${JSON.stringify(join(BIN, 'docker'))} "$@"
`);
chmodSync(join(WRAP, 'docker'), 0o755);
useFleet({ watchMs: 60000, env: { SPARK_CONSOLE_RESTART_WAIT_MS: String(LIMIT), PATH: `${WRAP}:${BIN}:${process.env.PATH}` },
  prepare: ({ root, stateDir }) => {
    const list = join(root, 'spark3', '.mock', 'containers');
    writeFileSync(list, readFileSync(list, 'utf8').replace(/^(sc-testorg--Qwen3\.8-27B-abliterated-GGUF)\|running\|[^|]*\|/m, '$1|exited|Exited (0) 2 hours ago|'));
    writeFileSync(join(stateDir, 'desired.json'), JSON.stringify(SEEDED), { mode: 0o600 });
  } });

const mock = (spark, f) => join(T.fleet.root, spark, '.mock', f);
const stateOf = (spark, name) => readFileSync(mock(spark, 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];
const act = (name, body) => api(`/actions/${name}`, { method: 'POST', body });
const opEnd = (id, what, timeout = 180000 * SLOW) => waitFor(async () => { const o = (await api(`/jobs/${id}`)).json; return o?.status && o.status !== 'running' ? o : null; }, { timeout, what, every: 250 });
const SAID = /^It didn’t answer within \d+ (?:seconds|minutes), so it was stopped again\.$/;

describe('a restart that doesn\'t answer within its limit (A-24)', { concurrency: 1 }, () => {
  test('it fails, it is stopped again, and the error says so', { timeout: 300000 * SLOW }, async () => {
    assert.equal(stateOf('spark3', GPT20), 'exited');
    writeFileSync(mock('spark3', 'serve-down'), '');
    try {
      const r = await act('restart_model', { spark: 'spark3', container: GPT20 });
      assert.equal(r.json?.outcome, 'started', r.text);
      const w = await opEnd(r.json.operation, 'the restart');
      assert.equal(w.status, 'failed', JSON.stringify(w));
      assert.match(w.error, SAID, w.error);
      assert.ok(w.log.some(l => new RegExp(`Stopped ${GPT20} again$`).test(l)), w.log.join('\n'));
      assert.notEqual(stateOf('spark3', GPT20), 'running', 'not left running');
      assert.equal(w.cleanUp, undefined);
    } finally { rmSync(mock('spark3', 'serve-down'), { force: true }); }
  });

  test('Docker there answering nothing by then: it fails saying it couldn\'t be stopped and may still be running, never that it is missing', { timeout: 300000 * SLOW }, async () => {
    writeFileSync(mock('spark3', 'serve-down'), '');
    try {
      const r = await act('restart_model', { spark: 'spark3', container: GPT20 });
      assert.equal(r.json?.outcome, 'started', r.text);
      // (it runs: from here Docker on Spark 3 answers nothing)
      await waitFor(async () => { if (stateOf('spark3', GPT20) === 'running') return true; const o = (await api(`/jobs/${r.json.operation}`)).json; assert.equal(o.status, 'running', JSON.stringify(o)); return false; },
        { timeout: 60000 * SLOW, what: `${GPT20} running`, every: 100 });
      writeFileSync(mock('spark3', 'daemon-down'), '');
      const w = await opEnd(r.json.operation, 'the restart');
      assert.equal(w.status, 'failed', JSON.stringify(w));
      assert.match(w.error, /^It didn’t answer within \d+ (?:seconds|minutes), and it couldn’t be stopped: it may still be running on Spark 3\.$/, w.error);
      assert.doesNotMatch(w.error, /stopped again while loading/);
      assert.ok(w.log.some(l => new RegExp(`Couldn’t stop ${GPT20} again: it may still be running on Spark 3$`).test(l)), w.log.join('\n'));
      assert.equal(w.cleanUp, `${GPT20} couldn’t be stopped again: it may still be running on Spark 3.`);
      assert.equal(stateOf('spark3', GPT20), 'running', 'Docker never answered the stop');
    } finally {
      rmSync(mock('spark3', 'daemon-down'), { force: true });
      rmSync(mock('spark3', 'serve-down'), { force: true });
      const s = await api('/stop', { method: 'POST', body: { node: 'spark3', container: GPT20 } });
      if (s.json?.id) await opEnd(s.json.id, `${GPT20} stopped by hand`);
    }
    assert.notEqual(stateOf('spark3', GPT20), 'running');
  });

  test('a docker start Docker didn\'t answer in time, but that started: it is stopped again, and the error says so (W-6)', { timeout: 300000 * SLOW }, async () => {
    assert.notEqual(stateOf('spark3', GPT20), 'running');
    writeFileSync(mock('spark3', 'start-hangs'), GPT20);
    try {
      const r = await act('restart_model', { spark: 'spark3', container: GPT20 });
      assert.equal(r.json?.outcome, 'started', r.text);
      const w = await opEnd(r.json.operation, 'the restart');
      assert.equal(w.status, 'failed', JSON.stringify(w));
      assert.equal(w.error, `Docker didn’t answer the start of ${GPT20} in time, so it was stopped again.`);
      assert.ok(w.log.some(l => new RegExp(`Stopped ${GPT20} again$`).test(l)), w.log.join('\n'));
      assert.notEqual(stateOf('spark3', GPT20), 'running', 'not left running');
    } finally { rmSync(mock('spark3', 'start-hangs'), { force: true }); }
  });

  test('as a saved workflow\'s step: the run fails, and nothing it started is running at its end', { timeout: 300000 * SLOW }, async () => {
    const saved = await act('save_workflow', { title: 'restart that never answers', steps: [{ action: 'restart_model', args: { spark: 'spark3', container: GPT20 } }] });
    assert.equal(saved.status, 200, saved.text);
    writeFileSync(mock('spark3', 'serve-down'), '');
    try {
      const r = await act('run_workflow', { name: 'restart that never answers' });
      assert.equal(r.json?.outcome, 'started', r.text);
      const w = await opEnd(r.json.operation, 'the run');
      assert.equal(w.status, 'failed', JSON.stringify(w));
      assert.match(w.error, /It didn’t answer within \d+ (?:seconds|minutes), so it was stopped again\./, w.error);
      assert.notEqual(stateOf('spark3', GPT20), 'running', 'nothing the run started runs at its end');
    } finally { rmSync(mock('spark3', 'serve-down'), { force: true }); }
  });
});

// The limit moves only on the stand-in fleet (ALL_LOCAL, SPARK_CONSOLE_ALL_LOCAL=1, the switch every other test-only
// setting needs): a stray SPARK_CONSOLE_RESTART_WAIT_MS on any other console moves nothing. Pure: the limit's own line, read from 17-changes.mjs.
test('the limit moves only on the stand-in fleet: on any other console SPARK_CONSOLE_RESTART_WAIT_MS is ignored', () => {
  const line = /^const RESTART_WAIT_MS = (.+);$/m.exec(readFileSync(join(REPO, 'service', 'src', '17-changes.mjs'), 'utf8'))?.[1];
  assert.ok(line, 'RESTART_WAIT_MS in 17-changes.mjs');
  const limit = (allLocal, value) => new Function('ALL_LOCAL', 'process', `return ${line};`)(allLocal, { env: value == null ? {} : { SPARK_CONSOLE_RESTART_WAIT_MS: value } });
  assert.equal(limit(false, '20000'), 30 * 60000, 'a console that isn’t the stand-in fleet');
  assert.equal(limit(true, '20000'), 20000, 'the stand-in fleet');
  assert.deepEqual([limit(true, undefined), limit(true, ''), limit(true, 'soon')], [30 * 60000, 30 * 60000, 30 * 60000], 'not set, or not a number');
});
