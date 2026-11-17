// Covers: the real model-word gate ranks a start's own current clause, so an earlier long model name cannot block a
// different explicit model or authorize substituting the earlier model. Separate clauses keep model, Spark and context
// together; explicit pronoun targets can still use owner history. Loose container matching ignores only a generated
// replacement aside proven by its labels and same-Spark canonical family; exact aside names and real variant ambiguity
// remain. Source fixtures use the shipped gate and matching functions, no fleet or external connection.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './start-mock.mjs';

const source = readFileSync(join(REPO, 'service', 'src', '16-actions.mjs'), 'utf8');
const cut = (from, to) => { const a = source.indexOf(from), b = source.indexOf(to, a); assert.ok(a >= 0 && b > a, from); return source.slice(a, b); };
const code = [cut('// Sparks are named the way people say them', 'const sparkList'), cut('const normQuotes', 'const PAGE_ONLY'),
  cut('// The kinds of request (CHANGE_WORDS)', '// A typed answer to Sparkie'), cut('// Which of Spark Console\'s models on that Spark', '// A change\'s plan'),
  cut('// The models a request could mean:', '// What Sparkie may do straight away'), cut('// What Sparkie may do straight away', '// ctx says who')].join('\n');
const RADIX = 'RadixArk--Qwen3.8-27B-NVFP4', GPT = 'gpt-oss-20b', NEMO = 'nvidia--Nemotron-3-Nano-30B-A3B-NVFP4';
function fixture(workloads = []) {
  const inv = { library: [{ name: RADIX, repo: 'RadixArk/Qwen3.8-27B-NVFP4' }, { name: GPT, repo: 'openai/gpt-oss-20b' }, { name: 'gemma-3-12b-it', repo: 'google/gemma-3-12b-it' }] };
  const knowledge = { workloads: Object.fromEntries(workloads.map((w, i) => [i, w])) };
  const env = {
    NODES: [1, 2, 3, 4].map(i => ({ id: `spark${i}` })), sparkName: n => `Spark ${n.id.slice(5)}`,
    squash: s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''), HttpError: class extends Error {}, knowledge,
    recentInventory: async () => inv, recipeCatalog: () => ({ models: [] }), onDiskAs: () => false,
    // Resolution alone identifies the supplied known input; the real namesModel ranks it against every candidate.
    // No model authorization result is stubbed, and an unexpected fixture model fails instead of passing by catch.
    resolveModelName: async name => { const lib = inv.library.find(m => name === m.name || name === m.repo); assert.ok(lib, `unknown fixture model ${name}`); return { lib }; },
  };
  const gate = new Function(...Object.keys(env), `${code}\nreturn { sparkieCheck, changeIntent, namesModel, containersSaid, pickContainer };`)(...Object.values(env));
  const check = (name, input, words, before = null) => {
    if (name === 'start_model') assert.ok(inv.library.some(m => input.model === m.name || input.model === m.repo), `unknown fixture model ${input.model}`);
    return gate.sparkieCheck(name, input, { intent: gate.changeIntent(words), request: words, said: [before, words].filter(Boolean).join('\n') });
  };
  return { ...gate, check };
}
const modelRow = (name, { model = NEMO, spark = 'spark3', running = true, labels = true } = {}) => ({ name, spark, byConsole: true, running, state: running ? 'running' : 'exited',
  ...(labels ? { labels: { 'spark.console': '1', 'spark.model': model } } : {}) });

describe('start identity belongs to the current clause', () => {
  test('a previous longer model name cannot make the new explicit start ask unnecessarily', async () => {
    const f = fixture(), before = `start RadixArk/Qwen3.8-27B-NVFP4 on Spark 4 with 128k context then report its speed`;
    const input = Object.freeze({ model: GPT, spark: 'spark4' });
    const got = await f.check('start_model', input, `start ${GPT} on Spark 3 then report its speed`, before);
    assert.equal(got.clear, true);
    assert.deepEqual(got.input, { model: GPT, spark: 'spark3' });
    assert.deepEqual(input, { model: GPT, spark: 'spark4' });
  });

  test('the brain cannot replace the explicit new model with the previous model', async () => {
    const f = fixture(), before = `start RadixArk/Qwen3.8-27B-NVFP4 on Spark 4 with 128k context`;
    for (const words of [`start ${GPT} on Spark 3`, `start ${GPT} on Spark 3 with 64k context`, `start ${GPT} on Spark 3 using the same context`, `start it again ${GPT} on Spark 3`]) {
      assert.equal((await f.check('start_model', { model: RADIX, spark: 'spark3' }, words, before)).clear, false, words);
    }
  });

  test('two current starts keep their own model identity, target and exact context', async () => {
    const f = fixture(), words = `start RadixArk/Qwen3.8-27B-NVFP4 on Spark 4 with 128k context; start ${GPT} on Spark 3 with 64k context`;
    const old = await f.check('start_model', { model: RADIX, spark: 'spark3' }, words);
    const next = await f.check('start_model', { model: GPT, spark: 'spark4' }, words);
    assert.equal(old.clear, true); assert.equal(next.clear, true);
    assert.deepEqual(old.input, { model: RADIX, spark: 'spark4', contextTokens: 131072 });
    assert.deepEqual(next.input, { model: GPT, spark: 'spark3', contextTokens: 65536 });
    const wrong = await f.check('start_model', { model: 'gemma-3-12b-it', spark: 'spark3' }, words, 'start gemma-3-12b-it');
    assert.equal(wrong.clear, false, 'a prior model is not a third current clause');
  });

  test('a pronoun target still resolves the model from owner history while placement stays current', async () => {
    const f = fixture(), before = 'RadixArk/Qwen3.8-27B-NVFP4 is the model I mean on Spark 4';
    for (const words of ['start it on Spark 3', 'start that one on Spark 3', 'start the same model on Spark 3', 'start it again on Spark 3', 'run that one again on Spark 3', 'start the same model again on Spark 3', 'start it now on Spark 3', 'start it again now please on Spark 3', 'bring it up on Spark 3', 'switch Spark 3 to it']) {
      const got = await f.check('start_model', { model: RADIX, spark: 'spark4' }, words, before);
      assert.equal(got.clear, true, words);
      assert.equal(got.input.spark, 'spark3', words);
      assert.equal(got.input.contextTokens, undefined, words);
    }
  });
});

describe('temporary replacement names do not invent a second model', () => {
  const canonical = `sc-${NEMO}`, aside = `${canonical}-before-012345abcdef`;
  test('the canonical model remains an unambiguous restart while its generated aside is still remembered', async () => {
    const f = fixture([modelRow(canonical), modelRow(aside, { running: false })]);
    assert.deepEqual(f.containersSaid('spark3', 'restart nemotron on Spark 3').map(c => c.name), [canonical]);
    const got = await f.check('restart_model', { spark: 'spark3', container: canonical }, 'restart nemotron on Spark 3');
    assert.equal(got.clear, true);
  });

  test('an exact owner name still selects the aside, and a paired worker follows the same family rule', async () => {
    const f = fixture([modelRow(canonical), modelRow(aside, { running: false })]);
    assert.equal(f.pickContainer('restart_model', 'spark3', `restart ${aside} on Spark 3`), aside);
    assert.equal((await f.check('restart_model', { spark: 'spark3', container: aside }, `restart ${aside} on Spark 3`)).clear, true);
    const worker = `${canonical}-part2`, g = fixture([modelRow(worker), modelRow(`${worker}-before-012345abcdef`, { running: false })]);
    assert.deepEqual(g.containersSaid('spark3', 'restart nemotron').map(c => c.name), [worker]);
  });

  test('two real variants stay ambiguous even when one is running and the other is stopped', async () => {
    const other = 'sc-nvidia--Nemotron-3-Nano-30B-A3B-FP8', f = fixture([modelRow(canonical), modelRow(other, { model: 'nvidia--Nemotron-3-Nano-30B-A3B-FP8', running: false }), modelRow(aside, { running: false })]);
    assert.equal(f.containersSaid('spark3', 'restart nemotron').length, 2);
    assert.equal(f.pickContainer('restart_model', 'spark3', 'restart nemotron'), null);
    assert.equal((await f.check('restart_model', { spark: 'spark3', container: canonical }, 'restart nemotron on Spark 3')).clear, false);
  });

  test('a matching suffix alone cannot hide an owner model or an unproven row', () => {
    for (const extra of [modelRow(aside, { model: `${NEMO}-before-012345abcdef` }), modelRow(aside, { labels: false }), modelRow(`${canonical}-before-012345abcdeg`, { running: false })]) {
      const f = fixture([modelRow(canonical), extra]);
      assert.equal(f.containersSaid('spark3', 'restart nemotron').length, 2, extra.name);
      assert.equal(f.pickContainer('restart_model', 'spark3', 'restart nemotron'), null, extra.name);
    }
    const f = fixture([modelRow(canonical, { spark: 'spark4' }), modelRow(aside, { running: false })]);
    assert.deepEqual(f.containersSaid('spark3', 'restart nemotron').map(c => c.name), [aside], 'a canonical row on another Spark proves no local replacement family');
  });
});


describe('a start keeps its own authority beside a duplicated setup classification', () => {
  test('set up or install beside an explicit start does not turn its same-clause work tag into a second request', async () => {
    for (const next of ['set up a folder called renders inside the work folder on Spark 3', 'install the requested package on Spark 3']) {
      const f = fixture(), words = `start ${GPT} on Spark 3 with 64k context and then ${next}`;
      const got = await f.check('start_model', { model: GPT, spark: 'spark4' }, words);
      assert.equal(got.clear, true, words);
      assert.deepEqual(got.input, { model: GPT, spark: 'spark3', contextTokens: 65536 });
      assert.equal((await f.check('start_model', { model: RADIX, spark: 'spark3' }, words)).clear, false, 'the other step grants no different model');
    }
  });
  test('a real separate work, stop, restart or ambiguous destination remains a button', async () => {
    for (const words of [
      `start ${GPT} on Spark 3 and then edit the file on Spark 3`,
      `start ${GPT} on Spark 3 and then stop gemma on Spark 4`,
      `start ${GPT} on Spark 3 and then restart gemma on Spark 4`,
      `start ${GPT} on Spark 3 or 4 and then set up a folder on Spark 3`,
      `start ${GPT} on Spark 3 with 64k context or start ${RADIX} on Spark 4`,
      `start ${GPT} on Spark 3 with 64k context and`,
      `set up ${GPT} on Spark 3 with 64k context and`,
      `set up a folder on Spark 3 and then start ${GPT}`,
    ]) assert.equal((await fixture().check('start_model', { model: GPT, spark: 'spark3' }, words)).clear, false, words);
  });
});
