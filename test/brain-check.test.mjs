// The brain check (21-brain-check.mjs; design E 2.3, cut by the one page to two outcomes): a few requests to Sparkie's
// model with a toy tool, and a profile in brain-profiles.json kept per brain setup and shown in sparkie_setup; nothing
// acts on it yet. Three stand-in brains (~/.mock/brain-kind on spark2: good, bad-arguments, no-tools) give checked, not
// checked and not checked, each with what was tried and what came back. The profile belongs to what was checked: the
// model, engine, image and flags (its key; another flag is another profile) and this build's "what the brain reads" hash
// from the lock, and a new check keeps the eval results stored with it. It runs once, a minute after the service
// starts, for a brain in use with no profile; as the last step of a switch; and on POST /main/check, the owner's alone
// (refused as nobody, a member, cross-site, through Funnel and from a Spark's address). A brain that doesn't answer
// keeps nothing and says why. A check waits while a chat is on the brain and is no part of the chat's turn.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, existsSync, mkdtempSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { T, useFleet, api, agentSettings, createKey, call, newChat, say, chatMessages, waitFor, sleep, SLOW, MEMBER, SERVICE_FILE } from './lib.mjs';

// A lock for this build, so the profile can name what the brain reads (brainReads, as test/lock.mjs writes it).
const h = createHash('sha256');
for (const f of ['server.mjs', 'dig.mjs', 'passkey.mjs']) h.update(readFileSync(join(dirname(SERVICE_FILE), f)));
const BUILD = h.digest('hex').slice(0, 12), READS = 'a1'.repeat(32);
const LOCK_DIR = mkdtempSync(join(tmpdir(), 'sct-brain-check-')), LOCK = join(LOCK_DIR, 'workflows.lock.json');
writeFileSync(LOCK, JSON.stringify({ build: BUILD, versions: {}, brainReads: READS }));
process.on('exit', () => rmSync(LOCK_DIR, { recursive: true, force: true }));

useFleet({
  watchMs: 60000,
  env: { SPARK_CONSOLE_WORKFLOW_LOCK: LOCK },
  // (a second setup of the same model, with one flag more: another profile)
  prepare: ({ stateDir }) => {
    const f = join(stateDir, 'main.json'), m = JSON.parse(readFileSync(f, 'utf8')), base = m.presets[m.current];
    m.presets['e4a-flag'] = { ...base, title: 'Aphex, one flag more', args: [...base.args, '--enable-cache-report'] };
    writeFileSync(f, JSON.stringify(m), { mode: 0o600 });
  },
}, async () => { await agentSettings({ selfHeal: false }); });

const mock = f => join(T.fleet.root, 'spark2', '.mock', f);
const lines = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const checkLog = () => lines(join(T.fleet.dir, 'brain-check.jsonl'));
const chatLog = () => lines(join(T.fleet.dir, 'model-requests.jsonl'));
const profiles = () => { try { return JSON.parse(readFileSync(join(T.fleet.stateDir, 'brain-profiles.json'), 'utf8')).profiles; } catch { return {}; } };
const setup = async () => { const r = await api('/actions/sparkie_setup', { method: 'POST', body: {} }); assert.equal(r.status, 200, r.text); return r.json.brainCheck; };
const newer = (id, since) => waitFor(() => Object.values(profiles()).find(p => p.setup.id === id && p.at > since), { timeout: 60000, what: `a profile of ${id} newer than ${since}` });
const brain = kind => (kind ? writeFileSync(mock('brain-kind'), kind) : rmSync(mock('brain-kind'), { force: true }));
async function checkNow(id = 'aphex') {
  const since = new Date().toISOString(), r = await api('/main/check', { method: 'POST', body: {} });
  assert.equal(r.status, 202, r.text);
  assert.equal(r.json.checking, true);
  assert.equal(r.json.setup.id, id);
  return newer(id, since);
}

describe('the brain check', { concurrency: 1 }, () => {
  let first;
  test('once, a minute after the service starts, the brain in use with no profile is checked: the good stand-in is checked', { timeout: 150000 * SLOW }, async () => {
    first = await waitFor(() => Object.values(profiles())[0], { timeout: 120000, every: 1000, what: 'the first profile' });
    assert.equal(first.why, 'start');
    assert.equal(first.outcome, 'checked');
    assert.deepEqual(first.because, ['It answered, called the tool with arguments that fit 3 of 3 times, and answered from the tool’s result.']);
    assert.deepEqual(first.probes.map(p => [p.probe, p.passed]), [['a plain answer', true], ['one tool (1 of 3)', true], ['one tool (2 of 3)', true],
      ['one tool (3 of 3)', true], ['the tool’s result handed back', true], ['two things at once (shown only)', true]]);
    assert.match(first.probes[1].cameBack, /^one call to weather with arguments that fit: weather \{"city":"Oslo","unit":"c"\}$/);
    assert.equal(first.tools, 'parallel');
    // What it belongs to (P-4): the setup by everything that changes how it answers, and this build's brainReads.
    const preset = JSON.parse(readFileSync(join(T.fleet.stateDir, 'main.json'), 'utf8')).presets.aphex;
    assert.match(first.key, /^[0-9a-f]{16}$/);
    assert.deepEqual([first.setup.id, first.model, first.engine, first.image, first.imageId, first.flags],
      ['aphex', preset.model.replace('--', '/'), preset.engine, preset.image, preset.imageId, preset.args]);
    assert.deepEqual([first.reads, first.build, first.evals], [READS, BUILD, {}]);
    // Toy tools only, asked the way a chat turn asks; none of it reached the chat's log, and it ran once.
    const asked = checkLog();
    assert.equal(asked.length, 6, JSON.stringify(asked));
    assert.ok(asked.every(a => a.tools.every(t => t === 'weather') && a.params.temperature === 0.3 && a.params.thinking === false), JSON.stringify(asked));
    assert.ok(!chatLog().some(x => /checking how this model calls tools/.test(x.system)));
    await sleep(5000);
    assert.equal(checkLog().length, 6, 'once');
  });

  test('sparkie_setup shows it, through POST /actions and the agent door', { timeout: 60000 * SLOW }, async () => {
    const seen = await setup();
    assert.equal(seen.outcome, 'checked');
    assert.deepEqual([seen.at, seen.setup.id, seen.reads, seen.readsNow, seen.checkingNow, seen.probes.length], [first.at, 'aphex', READS, READS, false, 6]);
    assert.match(seen.ask, /POST \/console\/api\/main\/check/);
    const door = await call((await createKey('brain-check')).token, 'sparkie_setup', {});
    assert.equal(door.isError, false, door.text);
    assert.deepEqual([door.value.brainCheck.outcome, door.value.brainCheck.at], ['checked', first.at]);
  });

  test('three stand-in brains: bad arguments and no tools are not checked, each with what came back; good is checked again, its eval results kept', { timeout: 180000 * SLOW }, async t => {
    t.after(() => brain(null));
    brain('bad-arguments');
    const bad = await checkNow();
    assert.equal(bad.key, first.key, 'the same setup, the same profile');
    assert.deepEqual([bad.why, bad.outcome, bad.because], ['asked', 'not checked', ['Its tool calls didn’t fit the tool and the request in 3 of 3 tries.']]);
    assert.equal(bad.probes[1].passed, false);
    assert.equal(bad.probes[1].cameBack, 'one call to weather with arguments the tool doesn’t take (place): weather {"place":"Oslo","unit":"kelvin"}');
    assert.equal((await setup()).outcome, 'not checked');

    brain('no-tools');
    const none = await checkNow();
    assert.deepEqual([none.outcome, none.tools], ['not checked', 'none']);
    assert.deepEqual(none.because, ['It answered in words and never called the tool (3 of 3 tries).', 'Handed the tool’s result, it didn’t answer from it.']);
    assert.deepEqual(none.probes.slice(1, 4).map(p => p.cameBack), Array(3).fill('words, and no tool call'));
    assert.equal(none.probes[4].cameBack, 'words without 17');

    // (an eval result stored with the profile, as the eval will: a new check keeps it)
    const file = join(T.fleet.stateDir, 'brain-profiles.json'), kept = JSON.parse(readFileSync(file, 'utf8'));
    const evals = { [READS]: { set: 'test-set', passRate: 1, wrongChanges: 0, at: new Date().toISOString() } };
    kept.profiles[first.key].evals = evals;
    writeFileSync(file, JSON.stringify(kept), { mode: 0o600 });
    brain(null);
    const good = await checkNow();
    assert.deepEqual([good.outcome, good.evals], ['checked', evals]);
    assert.equal(Object.keys(profiles()).length, 1);
    assert.ok(checkLog().every(a => a.tools.every(n => n === 'weather')));
  });

  test('POST /main/check is the owner’s alone: refused as nobody, a member, cross-site, through Funnel and from a Spark’s address', { timeout: 60000 * SLOW }, async () => {
    const before = checkLog().length;
    for (const [headers, status, who] of [[{ 'tailscale-user-login': 'stranger@test' }, 401, 'nobody'], [{ 'tailscale-user-login': MEMBER }, 403, 'a member'],
      [{ 'x-spark-console': null }, 403, 'cross-site'], [{ 'tailscale-funnel-request': '?1' }, 401, 'through Funnel'], [{ 'x-forwarded-for': '100.64.0.4' }, 403, 'a Spark’s address']]) {
      const r = await api('/main/check', { method: 'POST', body: {}, headers });
      assert.equal(r.status, status, `${who}: ${r.text}`);
    }
    await sleep(2000);
    assert.equal(checkLog().length, before, 'no check ran');
    assert.equal((await setup()).checkingNow, false);
  });

  test('a brain that doesn’t answer keeps nothing, and sparkie_setup says why', { timeout: 120000 * SLOW }, async t => {
    t.after(() => rmSync(mock('brain-hung'), { force: true }));
    const was = profiles()[first.key].at, since = new Date().toISOString();
    writeFileSync(mock('brain-hung'), '');
    assert.equal((await api('/main/check', { method: 'POST', body: {} })).status, 202);
    const seen = await waitFor(async () => { const s = await setup(); return s.lastTry?.at > since && s; }, { what: 'the try on record' });
    assert.deepEqual([seen.lastTry.kept, seen.lastTry.why], [false, 'asked']);
    assert.match(seen.lastTry.problem, /answered 503/);
    assert.equal(seen.outcome, 'checked', 'the profile on record stands');
    assert.equal(profiles()[first.key].at, was);
  });

  test('a check waits while a chat is on the brain, and is no part of the chat’s turn', { timeout: 120000 * SLOW }, async () => {
    const chat = await newChat(), words = 'hello from the brain check test, take 3 seconds';
    const answer = say(chat, words);
    const asked = await waitFor(() => chatLog().find(x => x.words === words), { what: 'the chat at the brain' });
    const from = checkLog().length;
    const done = checkNow();
    const reply = await answer;
    await done;
    const probes = checkLog().slice(from);
    assert.equal(probes.length, 6);
    assert.ok(Date.parse(probes[0].at) - Date.parse(asked.at) >= 3000, `the first request came ${Date.parse(probes[0].at) - Date.parse(asked.at)} ms after the chat's`);
    assert.equal(reply.tools.length, 0);
    assert.deepEqual((await chatMessages(chat)).map(m => m.role), ['user', 'assistant']);
    assert.equal(chatLog().filter(x => x.words === words).length, 1);
  });

  test('a switch ends with a check of the new setup: another flag is another profile, and the old one stays', { timeout: 300000 * SLOW }, async () => {
    const since = new Date().toISOString(), r = await api('/main/use', { method: 'POST', body: { preset: 'e4a-flag' } });
    assert.equal(r.status, 202, r.text);
    const job = await waitFor(async () => { const j = (await api(`/jobs/${r.json.id}`)).json; return j.status !== 'running' && j; }, { timeout: 240000, what: 'the switch' });
    assert.equal(job.status, 'completed', JSON.stringify(job.log));
    assert.ok(job.log.some(l => /Checking how it calls tools now, after the switch; sparkie_setup shows the result\./.test(l)), JSON.stringify(job.log));
    const p = await newer('e4a-flag', since);
    assert.deepEqual([p.why, p.outcome], ['switch', 'checked']);
    assert.notEqual(p.key, first.key);
    assert.deepEqual(p.flags.slice(-1), ['--enable-cache-report']);
    assert.ok(profiles()[first.key], 'the first setup’s profile is kept');
    assert.equal((await setup()).setup.id, 'e4a-flag');
  });
});
