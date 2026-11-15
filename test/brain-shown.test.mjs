// Covers: The brain check shown in sparkie_setup in plain words (E4b; design E 2.3, build step 4): the two outcomes,
// checked or not checked, when and why, on which model, engine, image and flags, with the reasons, and the last try
// when a check kept nothing. Three stand-in brains: none checked yet (no profile at all), one that passes, one that
// never calls a tool. Only shown: nothing acts on it in this step.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, agentSettings, waitFor, SLOW } from './lib.mjs';

useFleet({ watchMs: 60000 }, async () => { await agentSettings({ selfHeal: false }); });

const mock = f => join(T.fleet.root, 'spark2', '.mock', f);
const profiles = () => { try { return JSON.parse(readFileSync(join(T.fleet.stateDir, 'brain-profiles.json'), 'utf8')).profiles; } catch { return {}; } };
const shown = async () => { const r = await api('/actions/sparkie_setup', { method: 'POST', body: {} }); assert.equal(r.status, 200, r.text); return r.json.brainCheck; };
const when = t => `${t.slice(0, 10)} at ${t.slice(11, 16)} UTC`;
// The brain in use, in the words sparkie_setup uses: model, engine, image (and the digest it pins), flags.
function brainWords() {
  const m = JSON.parse(readFileSync(join(T.fleet.stateDir, 'main.json'), 'utf8')), p = m.presets[m.current];
  return `${p.model.replace('--', '/')} with ${p.engine}, image ${p.image} (${p.imageId}), flags ${p.args.join(' ')}`;
}
async function checkNow() {
  const since = new Date().toISOString(), r = await api('/main/check', { method: 'POST', body: {} });
  assert.equal(r.status, 202, r.text);
  return waitFor(() => Object.values(profiles()).find(p => p.at > since), { timeout: 60000, what: 'a new profile' });
}
const OUTCOMES = 'The brain check has two outcomes: checked (it answers, calls a tool with arguments that fit 3 times out of 3, and answers from the tool’s result) or not checked, with why.';

describe('the brain check, in plain words in sparkie_setup', { concurrency: 1 }, () => {
  test('no profile at all: not checked, on the brain in use, with the two outcomes', { timeout: 60000 * SLOW }, async () => {
    assert.deepEqual(profiles(), {});
    const seen = await shown();
    assert.equal(seen.outcome, 'not checked');
    assert.equal(seen.says, `Not checked: no check has run on this setup yet (${brainWords()}).`);
    assert.equal(seen.outcomes, OUTCOMES);
  });

  test('a brain that passes: checked, when and why, on which model, engine, image and flags', { timeout: 90000 * SLOW }, async () => {
    const p = await checkNow();
    assert.equal(p.outcome, 'checked');
    const seen = await shown();
    assert.equal(seen.says, `Checked on ${when(p.at)} (asked for by the owner), on ${brainWords()}: It answered, called the tool with arguments that fit 3 of 3 times, and answered from the tool’s result.`);
    assert.equal(seen.outcomes, OUTCOMES);
  });

  test('a brain that never calls a tool: not checked, with why', { timeout: 90000 * SLOW }, async t => {
    t.after(() => rmSync(mock('brain-kind'), { force: true }));
    writeFileSync(mock('brain-kind'), 'no-tools');
    const p = await checkNow();
    assert.deepEqual([p.outcome, p.tools], ['not checked', 'none']);
    assert.equal((await shown()).says, `Not checked on ${when(p.at)} (asked for by the owner), on ${brainWords()}: It answered in words and never called the tool (3 of 3 tries). Handed the tool’s result, it didn’t answer from it.`);
  });

  test('a check that kept nothing: the last try and why, after the profile on record', { timeout: 90000 * SLOW }, async t => {
    t.after(() => rmSync(mock('brain-hung'), { force: true }));
    const since = new Date().toISOString();
    writeFileSync(mock('brain-hung'), '');
    assert.equal((await api('/main/check', { method: 'POST', body: {} })).status, 202);
    const seen = await waitFor(async () => { const s = await shown(); return s.lastTry?.at > since && s; }, { what: 'the try on record' });
    assert.match(seen.says, /^Not checked on .+ \(asked for by the owner\), on .+: It answered in words and never called the tool \(3 of 3 tries\)\. Handed the tool’s result, it didn’t answer from it\. The last try, on \d{4}-\d\d-\d\d at \d\d:\d\d UTC \(asked for by the owner\), kept nothing: Sparkie’s model answered 503 \(loading or busy\)$/);
  });
});
