// Covers: The coding trial's task day-words (agentbar/trial.mjs): a day in another year is said with its year, a day
// this year without one (memoryDayWords, 20-memory-time.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const part = f => readFileSync(new URL(`../service/src/${f}`, import.meta.url), 'utf8');
const box = vm.createContext({ console, process: { env: {} }, ALL_LOCAL: false, setTimeout: () => {}, MEMORY_FILE: '/nonexistent', memoryEntries: () => [],
  statSync: () => { throw Object.assign(new Error('no file'), { code: 'ENOENT' }); } });
vm.runInContext(`${part('20-memory-names.mjs')}\n${part('20-memory-time.mjs')}\n;globalThis.got = { memoryDayWords, memoryDay };`, box);

test('a day in another year is said with its year, and a day this year without', () => {
  assert.equal(box.got.memoryDayWords('2031-01-02'), 'Thursday 2 January 2031');
  const today = box.got.memoryDay();
  assert.ok(!box.got.memoryDayWords(today).includes(today.slice(0, 4)), box.got.memoryDayWords(today));
});
