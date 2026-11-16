// Covers: The memory questions (design G 3.7; build step 7, piece b): `test/eval/memory.json` and its held-out set
// `test/eval/memory-held-out.json`, run by `test/eval.mjs` on the stand-in brain. With every memory switch on, every
// question's checks of what the brain is sent (has, hasNot) hold and nothing is changed; for each switch (names, past,
// time, count, said, digest) every question that measures it fails those checks with that switch off (a lesson card
// follows names; a long result's line, and a line read on through recall, follow digest), and the questions that
// measure none still hold with every switch off (an agent's chat gets no card); the run prints each case and each kind
// with its rounds and seconds. The held-out set holds the same way, and none of its words is in another case file, a
// document, the service's code or settings, or what a stand-in console's brain is sent (its system prompt, tools and
// their catalog).
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO, SLOW } from './lib.mjs';
import { startMock } from './start-mock.mjs';
import { brainSent } from './lock.mjs';

const TMP = mkdtempSync(join(tmpdir(), 'sct-memory-questions-'));
process.on('exit', () => rmSync(TMP, { recursive: true, force: true }));
const file = n => join(TMP, n), read = n => JSON.parse(readFileSync(file(n), 'utf8'));
const setOf = name => JSON.parse(readFileSync(join(REPO, 'test', 'eval', `${name}.json`), 'utf8'));
// The additions a question can measure: every one of design G 3 (the digest since G5).
const SWITCHES = ['names', 'past', 'time', 'count', 'said', 'digest'];
let fleet = null;
after(async () => { await fleet?.stop(); });

// test/eval.mjs as the owner runs it, its output kept.
function runEval(args) {
  return new Promise(resolve => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, [join(REPO, 'test', 'eval.mjs'), '--stand-in', '--runs', '1', ...args], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    const limit = setTimeout(() => child.kill('SIGKILL'), 600000 * SLOW);
    child.on('close', code => { clearTimeout(limit); resolve({ code, out }); });
  });
}
// Each case's one run: whether what the brain was sent held (has and hasNot), and the run itself.
async function sentChecks(set, out, args = []) {
  const r = await runEval(['--set', set, '--out', file(out), ...args]);
  assert.equal(r.code, 0, r.out);
  const rec = read(out);
  return { r, rec, held: Object.fromEntries(rec.cases.map(c => [c.id, !(c.runs[0].missing?.length || c.runs[0].unwanted?.length)])), runs: Object.fromEntries(rec.cases.map(c => [c.id, c.runs[0]])) };
}
const idsOf = (set, keep) => set.cases.filter(keep).map(c => c.id);

for (const name of ['memory', 'memory-held-out']) {
  describe(`the memory questions: ${name}`, { concurrency: 1 }, () => {
    const set = setOf(name);
    test('every switch on: what each question checks in the brain’s requests holds, and nothing is changed; results by case and by kind', { timeout: 900000 * SLOW }, async () => {
      for (const s of SWITCHES) assert.ok(set.cases.some(c => c.switch === s), `a question that measures ${s}`);
      assert.ok(set.cases.every(c => c.kind && (c.has || c.hasNot)), 'every question has a kind and checks what the brain is sent');
      const { r, rec, held, runs } = await sentChecks(name, `${name}-on.json`);
      assert.deepEqual(rec.cases.map(c => c.id), set.cases.map(c => c.id));
      assert.deepEqual(rec.memorySwitches.off, []);
      assert.deepEqual(Object.entries(held).filter(([, ok]) => !ok).map(([id]) => `${id}: ${JSON.stringify([runs[id].missing, runs[id].unwanted])}`), [], r.out);
      assert.deepEqual(Object.values(runs).map(x => [x.wrong, x.changed]).filter(([w, ch]) => w || ch.some(x => x.action !== 'remember')), [], 'no change made');
      assert.deepEqual(rec.cases.map(c => [c.id, c.kind, c.switch ?? null]), set.cases.map(c => [c.id, c.kind, c.switch ?? null]));
      assert.match(r.out, /^By case: runs passed, rounds and seconds/m);
      for (const c of set.cases) assert.match(r.out, new RegExp(`^ {2}${c.id} +${c.kind} +${c.switch ?? ''} *\\d+/1 {2}[\\d.]+ rounds {2}[\\d.]+ s$`, 'm'), c.id);
      for (const kind of new Set(set.cases.map(c => c.kind))) assert.match(r.out, new RegExp(`^ {2}${kind} +\\d+/\\d+ runs passed {2}[\\d.]+ rounds {2}[\\d.]+ s$`, 'm'), kind);
    });
    for (const s of SWITCHES) {
      test(`with ${s} off, every question that measures it fails what it checks in the brain’s requests`, { timeout: 900000 * SLOW }, async () => {
        const ids = idsOf(set, c => c.switch === s), { r, rec, held } = await sentChecks(name, `${name}-${s}.json`, ['--memory-off', s, '--only', ids.join(',')]);
        assert.deepEqual(rec.memorySwitches, { on: ['names', 'past', 'time', 'digest', 'count', 'said'].filter(x => x !== s), off: [s] });
        assert.deepEqual(Object.keys(held), ids);
        assert.deepEqual(Object.entries(held).filter(([, ok]) => ok).map(([id]) => id), [], r.out);
      });
    }
    test('with every switch off, the questions that measure none still hold', { timeout: 900000 * SLOW }, async () => {
      const ids = idsOf(set, c => !c.switch), { r, held } = await sentChecks(name, `${name}-off.json`, ['--memory-off', SWITCHES.join(','), '--only', ids.join(',')]);
      assert.deepEqual(Object.keys(held), ids);
      assert.deepEqual(Object.entries(held).filter(([, ok]) => !ok).map(([id]) => id), [], r.out);
    });
  });
}

// The held-out set is kept apart: its words are the test of a brain, so they are never what anything is written or
// tuned from. The service never reads a case file but today's cases.json; this checks the rest.
describe('the held-out set is kept apart', () => {
  const held = setOf('memory-held-out').cases;
  const words = [...new Set(held.flatMap(c => [c.say, ...(c.has || []), ...(c.hasNot || []), ...(c.answerHas || []), ...(c.answerHasNot || []),
    ...(c.before || []).flat(), ...(c.seed?.memory || []).map(l => l.text), ...(c.seed?.past || []).map(l => l.text),
    ...(c.seed?.journal || []).flatMap(j => [j.words, j.text].filter(Boolean)), ...(c.seed?.events || []).flatMap(e => Object.values(e.errorLines?.put || {}))])
    .map(w => w.toLowerCase()))];
  const found = (where, text) => words.filter(w => text.toLowerCase().includes(w)).map(w => `${where}: “${w}”`);
  const filesIn = dir => readdirSync(join(REPO, dir)).flatMap(f => { const p = `${dir}/${f}`; return statSync(join(REPO, p)).isDirectory() ? filesIn(p) : [p]; });
  test('none of its words is in another case file, a document, or the service’s code and settings', () => {
    assert.ok(words.length >= held.length * 2, 'its words were read');
    const places = [...['memory.json', 'memory-examples.json', 'cases.json'].map(f => `test/eval/${f}`), ...filesIn('docs'), 'AGENTS.md', 'README.md', 'test/README.md', 'test/covers.md',
      ...filesIn('service')];
    assert.deepEqual(places.flatMap(p => found(p, readFileSync(join(REPO, p), 'utf8'))), []);
  });
  test('none of its words is in what a stand-in console’s brain is sent: the system prompt, the tools and their catalog', { timeout: 180000 * SLOW }, async () => {
    fleet = await startMock();
    const sent = await brainSent(fleet);
    assert.ok(sent.system.length > 1000 && sent.tools.length > 10, 'what the brain is sent was read');
    assert.deepEqual(found('what the brain is sent', JSON.stringify(sent)), []);
  });
});
