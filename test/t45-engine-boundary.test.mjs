// Covers: an engine-check peer cannot issue a fresh GPU launch after its sibling failed and outer rollback began.
// Drive the real engineCheck function with a delayed second look; all peer workers must join before rejection.
// A timeout result from the start adapter remains a failure until the exact target receipt is terminal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../service/src/08-cluster.mjs', import.meta.url), 'utf8');
const fn = source.match(/^async function engineCheck\(job, \{ cp, model, net, nodeIds, fix \}\) \{[\s\S]*?^\}/m)[0];
test('engine-check rejection waits for the delayed sibling’s launch and cleanup before outer rollback can start', async () => {
  let release, rejected = false; const gate = new Promise(resolve => { release = resolve; }), calls = [];
  const env = { ALL_LOCAL: true, ENGINE_CHECK_NAME: 'spark-console-engine-check', ENGINE_CHECK_PY: 'fixed check',
    sparkName: n => n.id, nodeById: id => ({ id }), clusterEnv: () => ({}), imageOf: () => 'fixed-image', q: x => `'${x}'`, step: () => {},
    rollbackLook: async spark => { calls.push(['look', spark]); if (spark === 'spark3') throw new Error('first peer failed'); await gate; return null; },
    rollbackRun: async (_, spark) => { calls.push(['run', spark]); return { code: 0, out: 'created', err: '' }; },
    rollbackStopNew: async (_, spark) => { calls.push(['stop', spark]); return 'stopped'; },
    rollbackRemove: async (_, spark) => { calls.push(['remove', spark]); },
    run: async () => ({ code: 0, out: '', err: '' }),
  };
  const engineCheck = new Function('env', `with (env) { ${fn}; return engineCheck; }`)(env);
  const pending = engineCheck({ rollbackOperation: '123456789abc' }, { cp: { members: [{ node: 'spark3' }, { node: 'spark4' }] }, model: {}, net: {}, nodeIds: ['spark3', 'spark4'], fix: {} }).catch(e => { rejected = true; throw e; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(rejected, false, 'rollback cannot begin while a sibling can still issue a command');
  assert.deepEqual(calls, [['look', 'spark3'], ['look', 'spark4']]);
  release(); await assert.rejects(pending, /first peer failed/);
  assert.deepEqual(calls.slice(2), [['run', 'spark4'], ['stop', 'spark4'], ['remove', 'spark4']]);
});


test('a start adapter timeout cannot be treated as a successful engine check without a terminal receipt', async () => {
  const calls = [];
  const env = { ALL_LOCAL: true, ENGINE_CHECK_NAME: 'spark-console-engine-check', ENGINE_CHECK_PY: 'fixed check',
    sparkName: n => n.id, nodeById: id => ({ id }), clusterEnv: () => ({}), imageOf: () => 'fixed-image', q: x => x, step: () => {},
    rollbackLook: async () => null,
    rollbackRun: async () => ({ code: 124, out: '', err: '(timed out)' }),
    rollbackRead: () => ({ attempts: [{ commands: [{ spark: 'spark3', name: 'spark-console-engine-check', action: 'run', result: { terminal: false } }] }] }),
    rollbackStopNew: async () => { calls.push('stop'); return 'stopped'; }, rollbackRemove: async () => { calls.push('remove'); },
    run: async () => { calls.push('engine-read'); return { code: 0, out: 'engine start yes\nengine gloo ok\nengine nccl ok' }; },
  };
  const engineCheck = new Function('env', `with (env) { ${fn}; return engineCheck; }`)(env);
  await assert.rejects(engineCheck({ rollbackOperation: '123456789abc' }, { cp: { members: [{ node: 'spark3' }] }, model: {}, net: {}, nodeIds: ['spark3', 'spark4'], fix: {} }), /engine check on spark3 didn’t start: \(timed out\)/);
  assert.deepEqual(calls, [], 'neither successful engine output nor cleanup is inferred from the timeout');
});
