// Covers: The rail (R52; contract 3.11; the one page, milestone 5): a change Sparkie is clearly asked for runs at once
// only while its brain is checked: the brain check passed for this exact brain, and the eval on record for this build's
// mark and case set is a full run that met the bar, recounted from the record. With no eval on record every change is one
// button and nothing runs at once, from the page, from Telegram and through the agent door; a lookup is never affected;
// sparkie_setup says why in one line. A full, bar-met record kept with the passkey runs today's clear changes at once.
// What never counts: a partial run; a run that missed the bar (also when its own score says it met it); another mark; another case set; a memory-set run; one with
// a memory addition off; one missing those fields; a case id or expect that isn't the lock's; a record written into the
// file by hand; one sent without the passkey once a passkey is set up (428, nothing kept); another key (a changed flag,
// image, image actually run, weights' snapshot, toolRounds, maxChanges, toolCap) or the narrow key of before; the chat
// routed to another model; a missing or unreadable profile or lock. The newest full run decides: one that missed the bar
// takes the pass away, and newer partial runs never push a full one out. A server error on the brain check keeps
// nothing. The eval's runner refuses to ask the brain as another setup than the one serving.
// T136 (part): a switch to a brain with no eval on record makes every change a button; once the eval has passed for this
// brain and build, a clear change runs at once.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, mkdtempSync, cpSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { T, REPO, useFleet, api, call, createActKey, newChat, say, auditLines, waitFor, SLOW } from './lib.mjs';
import { serviceConfig, startMock } from './start-mock.mjs';
import { Authenticator, passkeyHeader } from './authenticator.mjs';

const MAIN_ORIGIN = serviceConfig().origin, TAILNET = new URL(MAIN_ORIGIN).hostname.split('.').slice(1).join('.');
const KEY = new Authenticator(TAILNET, MAIN_ORIGIN);
const TOKEN = '123456789:AAEtestTokenForSparkConsoleXYZ_abcdefghij', OWNER_TG = 5550001;
const RADIX = 'sc-RadixArk--Qwen3.8-27B-NVFP4', TESTORG = 'sc-testorg--Qwen3.8-27B-abliterated-GGUF';
const SWITCHES = ['names', 'past', 'time', 'digest', 'count', 'said'], OTHER_IMAGE = `sha256:${'b'.repeat(64)}`;
const TMP = mkdtempSync(join(tmpdir(), 'sct-brain-rail-'));
after(() => rmSync(TMP, { recursive: true, force: true }));

let act;
// No eval on record at the start (evalOnRecord: false), Telegram paired, and setups that differ from the one in use by
// one thing each.
useFleet({ watchMs: 60000, knowledge: true, telegram: true, evalOnRecord: false, env: { SPARK_CONSOLE_CONTINUE_MS: '500' },
  prepare: ({ dir, stateDir, root }) => {
    mkdirSync(join(dir, 'secrets'), { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, 'secrets', 'secrets.json'), JSON.stringify({ telegram: { token: TOKEN, bot: 'spark_test_bot', chatId: OWNER_TG, userId: OWNER_TG, name: 'Owner' } }), { mode: 0o600 });
    const f = join(stateDir, 'main.json'), m = JSON.parse(readFileSync(f, 'utf8')), base = m.presets[m.current];
    Object.assign(m.presets, { 'rail-flag': { ...base, args: [...base.args, '--enable-cache-report'] }, 'rail-image': { ...base, imageId: OTHER_IMAGE },
      'rail-rounds': { ...base, toolRounds: 7 }, 'rail-changes': { ...base, maxChanges: 3 }, 'rail-cap': { ...base, toolCap: 20 } });
    writeFileSync(f, JSON.stringify(m), { mode: 0o600 });
    appendFileSync(join(root, 'spark2', '.mock', 'images'), `\n${OTHER_IMAGE}\n`);
  } }, async () => { act = await createActKey('rail-act'); });

const evalMain = x => x.setFile === 'test/eval/cases.json' && Array.isArray(x.memorySwitches?.off) && !x.memorySwitches.off.length;
const LOCK = () => JSON.parse(readFileSync(join(T.fleet.dir, 'workflows.lock.json'), 'utf8'));
const PROFILES = () => join(T.fleet.stateDir, 'brain-profiles.json');
const profiles = () => { try { return JSON.parse(readFileSync(PROFILES(), 'utf8')).profiles; } catch { return {}; } };
const mock = (spark, f) => join(T.fleet.root, spark, '.mock', f);
const stateOf = (spark, name) => readFileSync(mock(spark, 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const shown = async () => { const r = await api('/actions/sparkie_setup', { method: 'POST', body: {} }); assert.equal(r.status, 200, r.text); return r.json; };

// A record as test/eval.mjs writes one, for the brain serving now and this build's lock; each run passes unless told.
let tick = Date.now() - 900000;
async function record(over = {}, { cases = LOCK().evalSet.cases, runs = 3, passed = () => true } = {}) {
  const inUse = (await shown()).brainCheck.inUse, lock = LOCK();
  return { kind: 'spark-console-eval', at: new Date(tick += 1000).toISOString(), build: lock.build, reads: lock.brainReads, set: lock.evalSet.version, setFile: 'test/eval/cases.json',
    setCases: lock.evalSet.cases.length, cap: null, memorySwitches: { on: SWITCHES, off: [] }, runs,
    brain: { standIn: true, key: inUse.key, setup: inUse.setup, model: inUse.model, engine: inUse.engine, image: inUse.image, flags: inUse.flags },
    cases: cases.map(([id, expect], i) => ({ id, expect, runs: Array.from({ length: runs }, () => ({ passed: passed(i), asked: expect === 'ask', rounds: 1, seconds: 1, wrong: 0, unverified: 0, called: [], changed: [] })) })),
    ...over };
}
// POST /main/eval as the owner; with the passkey when the service asks for it (428) and confirm is true.
async function keep(rec, { confirm = true } = {}) {
  const r = await api('/main/eval', { method: 'POST', body: rec });
  if (r.status !== 428 || !confirm) return r;
  const b = await api('/auth/passkey/begin', { method: 'POST', body: { purpose: 'confirm', method: 'POST', path: '/main/eval', body: rec } });
  assert.equal(b.status, 200, b.text);
  return api('/main/eval', { method: 'POST', body: rec, headers: { 'x-spark-passkey': passkeyHeader(KEY.sign(b.json)) } });
}
const kept = async (rec, opts) => { const r = await keep(rec, opts); assert.equal(r.status, 201, r.text); return r.json; };

// The owner's clear "remember that …" (a change, at once while checked): its outcome, and the buttons offered.
let n = 0;
async function remember() {
  const words = `remember that rail fact ${++n} holds`;
  script([{ match: `^${words}$`, calls: [{ name: 'remember', arguments: { text: `Rail fact ${n} holds`, kind: 'fact' } }] }]);
  const { message } = await say(await newChat(), words);
  return { tools: message.tools.map(t => [t.name, t.outcome]), buttons: (message.choices || []).length };
}
async function atOnce(what) { assert.deepEqual(await remember(), { tools: [['remember', 'remembered']], buttons: 0 }, what); }
async function aButton(what, why = null) {
  assert.deepEqual(await remember(), { tools: [['remember', 'needs-ok']], buttons: 1 }, what);
  if (why) assert.match((await shown()).changes, why, what);
}

const tgUrl = p => `http://127.0.0.1:${T.fleet.telegramPort}${p}`;
const tgPost = async (p, body) => (await fetch(tgUrl(p), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const tgSent = () => { const f = join(T.fleet.dir, 'telegram-calls.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(c => c.method === 'sendMessage') : []; };
let msgId = 1;
const tgSay = text => tgPost('/__push', { message: { message_id: msgId++, date: Math.floor(Date.now() / 1000), chat: { id: OWNER_TG, type: 'private' }, from: { id: OWNER_TG, is_bot: false, first_name: 'Owner' }, text } });
async function askSparkie(message) {
  let v = (await call(act.token, 'ask_sparkie', { message })).value;
  for (const until = Date.now() + 60000 * SLOW; v?.status !== 'answered' && Date.now() < until;) v = (await call(act.token, 'ask_sparkie', { conversation: v.conversation })).value;
  assert.equal(v?.status, 'answered', JSON.stringify(v));
  return v;
}
async function useSetup(id) {
  const since = new Date().toISOString(), r = await api('/main/use', { method: 'POST', body: { preset: id } });
  assert.equal(r.status, 202, r.text);
  const job = await waitFor(async () => { const j = (await api(`/jobs/${r.json.id}`)).json; return j.status !== 'running' && j; }, { timeout: 240000, what: `the switch to ${id}` });
  assert.equal(job.status, 'completed', JSON.stringify(job.log));
  await waitFor(() => Object.values(profiles()).find(p => p.setup.id === id && p.at > since), { timeout: 60000, what: `the check after the switch to ${id}` });
}

describe('the rail', { concurrency: 1 }, () => {
  test('no eval on record: a clear change is one button, from the page, from Telegram and through the agent door; nothing runs; a lookup runs; sparkie_setup says why', { timeout: 180000 * SLOW }, async () => {
    const since = new Date().toISOString();
    assert.equal(LOCK().build, (await (await fetch(`${T.base}/health`)).json()).build, 'the stand-in fleet has this build’s lock');
    await aButton('the page', /^Sparkie asks before every change, one button each: /);
    const looked = await say(await newChat(), 'what\'s running?');
    assert.deepEqual(looked.message.tools.map(t => [t.name, t.ok]), [['running_models', true]], 'a lookup');
    assert.ok(!(looked.message.choices || []).length);
    const from = tgSent().length;
    await tgSay(`stop ${RADIX} on spark 4`);
    const [reply] = await waitFor(() => { const s = tgSent().slice(from); return s.length && s; }, { timeout: 60000, what: 'Sparkie’s answer on Telegram' });
    assert.match(reply.body.reply_markup?.inline_keyboard?.[0]?.[0]?.text || '', /^Stop sc-RadixArk/, JSON.stringify(reply.body));
    const door = await askSparkie(`stop ${RADIX} on spark 4`);
    assert.equal(door.choices?.length, 1, JSON.stringify(door));
    assert.match(door.choices[0].label, /^Stop sc-RadixArk/);
    assert.equal(stateOf('spark4', RADIX), 'running');
    assert.ok(!auditLines().some(l => l.at > since && ['remember', 'stop_model'].includes(l.action) && l.ok), 'nothing changed');
    // With a brain check on record and still no eval, the line says so.
    const at = new Date().toISOString();
    assert.equal((await api('/main/check', { method: 'POST', body: {} })).status, 202);
    await waitFor(() => Object.values(profiles()).find(p => p.at > at), { timeout: 60000, what: 'the brain check' });
    await aButton('checked, no eval', /^Sparkie asks before every change, one button each: the eval has not been run for this build\.$/);
  });

  test('a full, bar-met record needs the passkey once one is set up: sent without it, 428 and nothing kept; with it, kept and changes run at once', { timeout: 120000 * SLOW }, async () => {
    const b = await api('/auth/passkey/begin', { method: 'POST', body: { purpose: 'register' } });
    assert.equal((await api('/auth/passkey/register', { method: 'POST', body: KEY.register(b.json) })).status, 201);
    const before = readFileSync(PROFILES(), 'utf8'), rec = await record();
    const bare = await keep(rec, { confirm: false });
    assert.deepEqual([bare.status, bare.json.passkey], [428, 'confirm'], bare.text);
    assert.equal(readFileSync(PROFILES(), 'utf8'), before, 'nothing kept');
    await aButton('sent without the passkey');
    const k = await kept(rec);
    assert.equal(k.stored, true);
    const stored = Object.values(profiles()).find(p => p.key === rec.brain.key).evals[`${rec.reads}:${rec.set}`][0];
    assert.deepEqual([stored.keptWith, /^[0-9a-f]{64}$/.test(stored.seal), stored.setFile, stored.memorySwitches], ['passkey', true, 'test/eval/cases.json', { on: SWITCHES, off: [] }]);
    await atOnce('kept with the passkey');
    assert.match((await shown()).changes, /^Sparkie makes a change your words clearly ask for at once: the brain check passed, and the eval on record for this build \(\d{4}-\d\d-\d\d\) ran in full and met the bar\.$/);
  });

  test('the newest full run decides: one that missed the bar takes the pass away; newer partial runs neither give nor take; a passing one gives it back', { timeout: 120000 * SLOW }, async () => {
    assert.equal((await kept(await record({}, { passed: i => i >= 3 }))).stored, true);
    await aButton('the newest full run missed the bar', /didn’t meet the bar/);
    const two = LOCK().evalSet.cases.slice(0, 2);
    for (let i = 0; i < 6; i++) assert.equal((await kept(await record({}, { cases: two, runs: 1 }))).stored, true);
    await aButton('newer partial runs give nothing back', /didn’t meet the bar/);
    await kept(await record());
    await atOnce('a newer passing full run');
    for (let i = 0; i < 6; i++) await kept(await record({}, { cases: two, runs: 1 }));
    await atOnce('six newer partial runs push nothing out');
    const slot = Object.values(profiles()).find(p => p.setup.id === 'aphex').evals[`${LOCK().brainReads}:${LOCK().evalSet.version}`];
    assert.equal(slot.filter(x => x.score.full).length, 3, 'the three full runs are kept beside five partial ones');
  });

  test('records that never count, each the newest when kept: partial, bar not met, another mark, another case set, a memory set, a memory addition off, no set fields, a case id or expect not the lock’s, written by hand', { timeout: 300000 * SLOW }, async () => {
    // (a slot whose newest full run missed the bar: what follows would unlock if it counted)
    await kept(await record({}, { passed: i => i >= 3 }));
    await aButton('missed the bar');
    const cases = LOCK().evalSet.cases, memory = readFileSync(join(REPO, 'test', 'eval', 'memory.json')), sha = b => createHash('sha256').update(b).digest('hex');
    const never = [
      ['a partial run', await record({}, { cases: cases.slice(0, 5) })],
      ['its own score saying it met the bar over failing runs', await record({ full: true, score: { full: true, met: true, passOnce: 1, passAllRuns: 1, wrongChanges: 0, askedOnClear: 0 } }, { passed: i => i >= 3 })],
      ['another mark', await record({ reads: 'cd'.repeat(32) })],
      ['another case set', await record({ set: 'ef'.repeat(32) })],
      ['a memory-set full pass', await record({ set: sha(memory), setFile: 'test/eval/memory.json', setCases: JSON.parse(memory).length }, { cases: JSON.parse(memory).map(c => [c.id, c.expect]) })],
      ['a memory addition off', await record({ memorySwitches: { on: SWITCHES.slice(1), off: ['names'] } })],
      ['no setFile or memorySwitches', await record({ setFile: undefined, memorySwitches: undefined })],
      ['a case id not the lock’s', await record({}, { cases: cases.map(([id, e], i) => [i ? id : `${id}-x`, e]) })],
      ['an expect not the lock’s', await record({}, { cases: cases.map(([id, e], i) => [id, i ? e : (e === 'act' ? 'ask' : 'act')]) })],
    ];
    for (const [what, rec] of never) {
      assert.equal((await kept(rec)).stored, true, what);
      await aButton(what);
    }
    // Written into the file by hand: no seal.
    const file = JSON.parse(readFileSync(PROFILES(), 'utf8')), p = Object.values(file.profiles).find(x => x.setup.id === 'aphex'), slot = `${LOCK().brainReads}:${LOCK().evalSet.version}`;
    const valid = x => x.score.full && x.score.met && evalMain(x) && x.cases.every((c, i) => c.id === cases[i][0] && c.expect === cases[i][1]);
    const { seal, ...unsealed } = p.evals[slot].find(valid);
    p.evals[slot].unshift({ ...unsealed, at: new Date(tick += 1000).toISOString() });
    writeFileSync(PROFILES(), JSON.stringify(file), { mode: 0o600 });
    await aButton('written by hand, with no seal');
    assert.ok(seal);
    await kept(await record());
    await atOnce('a passing full run again');
  });

  test('another brain is another key: the image it runs, its weights, and a changed flag, image, toolRounds, maxChanges or toolCap; the narrow key of before', { timeout: 600000 * SLOW }, async () => {
    writeFileSync(mock('spark2', 'imageid-sparkie-main'), `sha256:${'c'.repeat(64)}`);
    await aButton('another image actually run', /no brain check is on record for this exact setup/);
    rmSync(mock('spark2', 'imageid-sparkie-main'));
    await atOnce('the image it ran before');
    const hub = join(T.fleet.root, 'spark2', '.cache', 'huggingface', 'hub', 'models--RadixArk--Qwen3.8-27B-NVFP4');
    cpSync(join(hub, 'snapshots', 'r1'), join(hub, 'snapshots', 'r2'), { recursive: true, verbatimSymlinks: true });
    writeFileSync(join(hub, 'refs', 'main'), 'r2');
    await aButton('another snapshot of its weights');
    writeFileSync(join(hub, 'refs', 'main'), 'r1');
    await atOnce('the weights it ran before');
    for (const id of ['rail-flag', 'rail-image', 'rail-rounds', 'rail-changes', 'rail-cap']) {
      await useSetup(id);
      await aButton(id, /the eval has not been run for this build/);
    }
    await useSetup('aphex');
    await atOnce('back on the setup the eval ran on');
    // A profile kept under the narrow key of before (model, engine, image, flags and how it is asked only), with a passing
    // record as the build before kept it.
    const was = readFileSync(PROFILES(), 'utf8'), m = JSON.parse(readFileSync(join(T.fleet.stateDir, 'main.json'), 'utf8')), s = m.presets.aphex;
    const narrow = createHash('sha256').update(JSON.stringify({ model: s.model.replace('--', '/'), draft: s.draft ? s.draft.replace('--', '/') : null, engine: s.engine, image: s.image, imageId: s.imageId || null,
      flags: s.args.map(String), env: s.env || {}, ropeScaling: s.ropeScaling || null, asked: { thinking: Boolean(s.thinking), maxTokens: s.maxTokens || 4096, sampling: s.sampling || null, templateKwargs: s.templateKwargs || null } })).digest('hex').slice(0, 16);
    const p = Object.values(JSON.parse(was).profiles).find(x => x.setup.id === 'aphex'), slot = `${LOCK().brainReads}:${LOCK().evalSet.version}`;
    const { seal, keptWith, ...old } = p.evals[slot].find(x => x.score.full && x.score.met);
    writeFileSync(PROFILES(), JSON.stringify({ profiles: { [narrow]: { ...p, key: narrow, evals: { [slot]: [old] } } } }), { mode: 0o600 });
    await aButton('the narrow key of before');
    assert.ok(seal && keptWith);
    writeFileSync(PROFILES(), was, { mode: 0o600 });
    await atOnce('the profile back');
  });

  test('the chat routed to another model; a missing or unreadable profile; a server error on the check keeps nothing', { timeout: 180000 * SLOW }, async t => {
    const other = (await api('/main/choices')).json.running.find(c => c.kind === 'endpoint' && c.reachable && c.url === `http://127.0.0.1:${T.fleet.benchPort}`);
    assert.ok(other, 'another model on Spark 2 to route the chat to');
    writeFileSync(join(T.fleet.dir, 'bench-tools'), '');
    t.after(() => rmSync(join(T.fleet.dir, 'bench-tools'), { force: true }));
    assert.equal((await api('/main/route', { method: 'POST', body: { role: 'chat', choice: other.id } })).status, 200);
    await aButton('the chat routed elsewhere', /routed to another model/);
    assert.equal((await api('/main/route', { method: 'POST', body: { role: 'chat', choice: 'main' } })).status, 200);
    await atOnce('the chat back on Sparkie’s model');
    const was = readFileSync(PROFILES(), 'utf8');
    rmSync(PROFILES());
    await aButton('no profile file', /no brain check is on record/);
    mkdirSync(PROFILES());
    await aButton('a profile file that can’t be read', /couldn’t be read/);
    rmSync(PROFILES(), { recursive: true });
    writeFileSync(PROFILES(), was, { mode: 0o600 });
    await atOnce('the profile back');
    // A brain that answers 500 to the check's tool requests: no answer, so nothing is kept (never "no tools").
    writeFileSync(mock('spark2', 'brain-kind'), 'server-error');
    t.after(() => rmSync(mock('spark2', 'brain-kind'), { force: true }));
    const since = new Date().toISOString();
    assert.equal((await api('/main/check', { method: 'POST', body: {} })).status, 202);
    const seen = await waitFor(async () => { const s = (await shown()).brainCheck; return s.lastTry?.at > since && s; }, { timeout: 60000, what: 'the failed try' });
    assert.match(seen.lastTry.problem, /answered 500, a server error, so the check couldn’t be made/);
    assert.equal(readFileSync(PROFILES(), 'utf8'), was, 'nothing kept');
    rmSync(mock('spark2', 'brain-kind'));
    await atOnce('the profile on record stands');
  });

  test('with the eval passed, a clear change through the agent door runs at once', { timeout: 120000 * SLOW }, async () => {
    const door = await askSparkie(`stop ${TESTORG} on spark 3`);
    assert.ok(!door.choices?.length, JSON.stringify(door));
    assert.ok(auditLines().some(l => l.action === 'stop_model' && l.ok && l.outcome === 'started' && l.args?.container === TESTORG), 'it started');
  });

  test('the eval’s runner refuses to ask the brain as another setup than the one serving', { timeout: 120000 * SLOW }, async () => {
    const r = await new Promise(resolve => {
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      const child = spawn(process.execPath, [join(REPO, 'test', 'eval.mjs'), '--brain-url', T.base, '--console', T.base, '--origin', T.origin, '--setup', 'aphex-agent',
        '--only', 'whats-running', '--runs', '1', '--out', join(TMP, 'x.json')], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', d => { out += d; });
      child.stderr.on('data', d => { out += d; });
      child.on('close', code => resolve({ code, out }));
    });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /serves aphex, and this run would ask the brain as aphex-agent/);
    assert.ok(!existsSync(join(TMP, 'x.json')), 'nothing scored');
  });
});

// A missing or unreadable lock: a fleet of its own each (the lock is read once, at the start), with a passing record kept.
for (const [what, lockAt] of [['no lock for this build', join(TMP, 'none.json')], ['a lock that can’t be read', TMP]]) {
  test(`${what}: a passing record kept, and still every change is a button`, { timeout: 180000 * SLOW }, async () => {
    const lock = LOCK(), fleet = await startMock({ watchMs: 60000, env: { SPARK_CONSOLE_WORKFLOW_LOCK: lockAt } });
    try {
      const head = { 'content-type': 'application/json', 'x-spark-console': '1', origin: fleet.origin }, post = (p, b) => fetch(`${fleet.base}${p}`, { method: 'POST', headers: head, body: JSON.stringify(b) });
      const since = new Date().toISOString();
      assert.equal((await post('/main/check', {})).status, 202);
      const p = await waitFor(() => { try { return Object.values(JSON.parse(readFileSync(join(fleet.stateDir, 'brain-profiles.json'), 'utf8')).profiles).find(x => x.at > since); } catch { return null; } }, { timeout: 60000, what: 'the check' });
      const rec = { kind: 'spark-console-eval', at: new Date().toISOString(), build: lock.build, reads: lock.brainReads, set: lock.evalSet.version, setFile: 'test/eval/cases.json', setCases: lock.evalSet.cases.length,
        cap: null, memorySwitches: { on: SWITCHES, off: [] }, runs: 3, brain: { standIn: true, key: p.key, setup: p.setup.id, model: p.model, engine: p.engine, image: p.image, flags: p.flags },
        cases: lock.evalSet.cases.map(([id, expect]) => ({ id, expect, runs: [1, 2, 3].map(() => ({ passed: true, asked: expect === 'ask', rounds: 1, seconds: 1, wrong: 0, unverified: 0, called: [], changed: [] })) })) };
      assert.equal((await post('/main/eval', rec)).status, 201);
      writeFileSync(join(fleet.dir, 'model-script.json'), JSON.stringify([{ match: '^remember that the lock test holds$', calls: [{ name: 'remember', arguments: { text: 'The lock test holds', kind: 'fact' } }] }]));
      const chat = (await (await post('/chats', {})).json()).id, text = await (await post(`/chats/${chat}/messages`, { text: 'remember that the lock test holds' })).text();
      const done = text.split('\n\n').map(x => x.trim()).filter(x => x.startsWith('data:')).map(x => JSON.parse(x.slice(5))).find(e => e.type === 'done');
      assert.deepEqual([done.message.tools.map(x => [x.name, x.outcome]), (done.message.choices || []).length], [[['remember', 'needs-ok']], 1], JSON.stringify(done.message));
      const changes = (await (await post('/actions/sparkie_setup', {})).json()).changes;
      assert.equal(changes, 'Sparkie asks before every change, one button each: there is no lock for this build, so what its brain reads isn’t known.');
    } finally { await fleet.stop(); }
  });
}
