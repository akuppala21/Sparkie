// Covers: The brain eval's memory fields (design G 3.7, step 7, piece a), on the stand-in brain: `test/eval.mjs --set
// memory-examples` runs `test/eval/memory-examples.json` (three examples) and the record names that file; a case's
// earlier chats (before) leave what was remembered in the new chat's request; a seeded memory line is in memory
// before the turn, with its id; seeded journal records come back only through recall; has and hasNot pass and fail
// on a request that does and does not hold a seeded line, and the record lists what failed; a case file from elsewhere
// is named without its folder; a
// malformed case stops the run. A memory switch (--memory-off) reaches each case's console as
// SPARK_CONSOLE_MEMORY_OFF and turns that feature off for the run: with memory past its block, the line the picker
// chooses for a question about a Spark is in the request with every switch on and in none with `names` off; the record
// says which switches were on and off, --store refuses such a run, and an unknown switch is refused.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO, SLOW } from './lib.mjs';

const TMP = mkdtempSync(join(tmpdir(), 'sct-eval-memory-'));
process.on('exit', () => rmSync(TMP, { recursive: true, force: true }));
const file = n => join(TMP, n), read = n => JSON.parse(readFileSync(file(n), 'utf8'));
const SWITCHES = ['names', 'past', 'time', 'digest', 'count', 'said'];

// test/eval.mjs as the owner runs it, its output kept.
function runEval(args) {
  return new Promise(resolve => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, [join(REPO, 'test', 'eval.mjs'), ...args], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    const limit = setTimeout(() => child.kill('SIGKILL'), 300000 * SLOW);
    child.on('close', code => { clearTimeout(limit); resolve({ code, out }); });
  });
}
const byId = record => Object.fromEntries(record.cases.map(c => [c.id, c.runs[0]]));
// A seeded owner's line, and words of it that are nowhere else in a request.
const LINE = { id: '5eed0001', text: 'the owner calls spark 4 the attic', kind: 'fact', at: '-3d' };
const seeded = (id, more) => ({ id, say: 'which spark is the quiet one?', expect: 'answer', seed: { memory: [LINE] }, ...more });

describe('the eval’s memory fields', { concurrency: 1 }, () => {
  test('--set memory-examples runs test/eval/memory-examples.json and the record names it: before, seed and recall reach the request; every switch on', { timeout: 360000 * SLOW }, async () => {
    const r = await runEval(['--stand-in', '--set', 'memory-examples', '--runs', '1', '--out', file('memory.json')]);
    assert.equal(r.code, 0, r.out);
    const rec = read('memory.json'), bytes = readFileSync(join(REPO, 'test', 'eval', 'memory-examples.json'));
    assert.deepEqual([rec.setFile, rec.set, rec.setCases], ['test/eval/memory-examples.json', createHash('sha256').update(bytes).digest('hex'), JSON.parse(bytes).length]);
    assert.deepEqual(rec.memorySwitches, { on: SWITCHES, off: [] });
    const runs = byId(rec);
    assert.deepEqual(Object.keys(runs), ['told-in-another-chat', 'seeded-line', 'seeded-record-recalled']);
    // Told in an earlier chat (before): the stand-in remembered it there, and the new chat's request holds it.
    assert.deepEqual([runs['told-in-another-chat'].passed, runs['told-in-another-chat'].missing], [true, []], r.out);
    // Seeded: the line is in memory before the turn (its id is in the request); the journal is in no request by itself.
    assert.deepEqual([runs['seeded-line'].passed, runs['seeded-line'].missing, runs['seeded-line'].unwanted], [true, [], []], r.out);
    // A seeded record comes back through recall, in the turn's second request; the older one about another app doesn't.
    const recalled = runs['seeded-record-recalled'];
    assert.deepEqual([recalled.passed, recalled.called, recalled.rounds, recalled.missing, recalled.unwanted], [true, ['recall'], 2, [], []], r.out);
    assert.match(r.out, /case set test\/eval\/memory-examples\.json \([0-9a-f]{12}\)/);
  });

  test('has and hasNot pass and fail on a request that does and does not hold a seeded line; a case file from elsewhere is named without its folder', { timeout: 360000 * SLOW }, async () => {
    writeFileSync(file('has.json'), JSON.stringify([
      seeded('has-seeded', { has: ['the attic', `[${LINE.id}]`] }),
      seeded('hasnot-seeded', { hasNot: ['the attic'] }),
      { id: 'has-not-seeded', say: 'which spark is the quiet one?', expect: 'answer', has: ['the attic'] },
      { id: 'hasnot-not-seeded', say: 'which spark is the quiet one?', expect: 'answer', hasNot: ['the attic'] },
    ]));
    const r = await runEval(['--stand-in', '--cases', file('has.json'), '--runs', '1', '--out', file('has-result.json')]);
    assert.equal(r.code, 0, r.out);
    const rec = read('has-result.json'), runs = byId(rec);
    assert.equal(rec.setFile, 'has.json', 'no folder of this machine in the record');
    assert.deepEqual(Object.fromEntries(Object.entries(runs).map(([id, x]) => [id, [x.passed, x.missing ?? null, x.unwanted ?? null]])), {
      'has-seeded': [true, [], null],
      'hasnot-seeded': [false, null, ['the attic']],
      'has-not-seeded': [false, ['the attic'], null],
      'hasnot-not-seeded': [true, null, []],
    }, r.out);
    assert.match(r.out, /FAIL {2}hasnot-seeded .*the brain’s requests held \["the attic"\]/);
    assert.match(r.out, /FAIL {2}has-not-seeded .*the brain’s requests lacked \["the attic"\]/);
  });

  test('a malformed case stops the run before anything starts, and names it', async () => {
    writeFileSync(file('bad.json'), JSON.stringify([{ id: 'bad-seed', say: 'hi', expect: 'answer', seed: { memory: [{ text: 'x', at: 'last spring' }] } }]));
    const r = await runEval(['--stand-in', '--cases', file('bad.json'), '--runs', '1', '--out', file('bad-result.json')]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /^bad\.json: the case bad-seed seed: \{memory: \[\{text, kind\?, at\?, by\?, id\?\}\]/m);
  });

  test('a memory switch turns its feature off for the run, and the record says which were on; --store refuses that run; an unknown switch is refused', { timeout: 360000 * SLOW }, async () => {
    // The picker (`names`, 20-memory-names.mjs): the line about Spark 4 is the oldest, and the newer lines alone are past
    // the 4,000-character block, so the system prompt leaves it out; a question naming Spark 4 brings it back as a pick.
    const newer = Array.from({ length: 60 }, (_, i) => ({ text: `note ${i + 1}: the hallway clock ran ${i + 1} minutes fast after the storm, so the kitchen timer was set by hand again`, kind: 'fact', at: '-1d' }));
    assert.ok(newer.reduce((n, l) => n + l.text.length, 0) > 4000 + LINE.text.length, 'the newer lines fill the block without the line about Spark 4');
    writeFileSync(file('switch.json'), JSON.stringify([{ ...seeded('seeded-switch', { has: ['the attic'] }), say: 'what do you remember about spark 4?', seed: { memory: [{ ...LINE, at: '-30d' }, ...newer] } }]));
    const on = await runEval(['--stand-in', '--cases', file('switch.json'), '--runs', '1', '--out', file('on.json')]);
    assert.equal(on.code, 0, on.out);
    assert.deepEqual([read('on.json').memorySwitches, byId(read('on.json'))['seeded-switch'].passed], [{ on: SWITCHES, off: [] }, true], on.out);
    const off = await runEval(['--stand-in', '--cases', file('switch.json'), '--memory-off', 'names', '--runs', '1', '--out', file('off.json')]);
    assert.equal(off.code, 0, off.out);
    const rec = read('off.json');
    assert.deepEqual(rec.memorySwitches, { on: SWITCHES.filter(s => s !== 'names'), off: ['names'] });
    assert.deepEqual([byId(rec)['seeded-switch'].passed, byId(rec)['seeded-switch'].missing], [false, ['the attic']], off.out);
    assert.match(off.out, /memory additions off: names/);
    // Kept with a profile it would stand for the build as it runs: refused here, with no console asked.
    const store = await runEval(['--store', file('off.json'), '--console', 'http://127.0.0.1:9/console/api']);
    assert.equal(store.code, 1, store.out);
    assert.match(store.out, /^Not kept: that run had memory additions switched off \(names\)/m);
    const unknown = await runEval(['--stand-in', '--memory-off', 'names,graph', '--runs', '1', '--out', file('unknown.json')]);
    assert.equal(unknown.code, 1, unknown.out);
    assert.match(unknown.out, /--memory-off takes a list of: names, past, time, digest, count, said\./);
  });
});
