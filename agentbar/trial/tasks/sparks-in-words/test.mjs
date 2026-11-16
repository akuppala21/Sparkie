// Covers: The coding trial's task sparks-in-words (agentbar/trial.mjs): Sparks named together ("Sparks 3 and 4") are
// each one word, spark3 and spark4 (nameWords, 20-memory-names.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const part = f => readFileSync(new URL(`../service/src/${f}`, import.meta.url), 'utf8');
const box = vm.createContext({ console, process: { env: {} }, ALL_LOCAL: false, setTimeout: () => {}, MEMORY_FILE: '/nonexistent', memoryEntries: () => [],
  statSync: () => { throw Object.assign(new Error('no file'), { code: 'ENOENT' }); } });
vm.runInContext(`${part('20-memory-names.mjs')}\n;globalThis.got = { nameWords };`, box);
const words = t => JSON.parse(JSON.stringify(box.got.nameWords(t)));

test('Sparks named together are each one word', () => {
  assert.deepEqual(words('Sparks 3 and 4 are busy tonight'), ['spark3', 'spark4', 'are', 'busy', 'tonight']);
  assert.deepEqual(words('spark 1 or 2, then spark 3'), ['spark1', 'spark2', 'then', 'spark3']);
});
