// Covers: The coding trial's task numbers-as-written (agentbar/trial.mjs): a memory line's numbers are read as written,
// so two versions, two addresses or two dates are two numbers (lineNumbers, 20-memory-time.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const part = f => readFileSync(new URL(`../service/src/${f}`, import.meta.url), 'utf8');
const box = vm.createContext({ console, process: { env: {} }, ALL_LOCAL: false, setTimeout: () => {}, MEMORY_FILE: '/nonexistent', memoryEntries: () => [],
  statSync: () => { throw Object.assign(new Error('no file'), { code: 'ENOENT' }); } });
vm.runInContext(`${part('20-memory-names.mjs')}\n${part('20-memory-time.mjs')}\n;globalThis.got = { lineNumbers };`, box);
const numbers = t => JSON.parse(JSON.stringify(box.got.lineNumbers(t)));

test('a line\'s numbers are read as written, a Spark said by number aside', () => {
  assert.deepEqual(numbers('vLLM 0.11.0 works with gemma on Spark 3'), ['0.11.0']);
  assert.deepEqual(numbers('the NAS sits at 10.0.0.5, the lab borrows Spark 1 on 11/12'), ['10.0.0.5', '11/12']);
});
