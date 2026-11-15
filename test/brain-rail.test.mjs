// Covers: The rail (R52; contract 3.11; the one page, milestone 5): a change Sparkie is clearly asked for runs at once
// only while its brain is checked: the brain check passed for this exact brain, and the eval on record for this build's
// mark and case set is a full run that met the bar, recounted from the record. With no eval on record every change is one
// button and nothing runs at once, from the page, from Telegram and through the agent door; a lookup, the owner's own
// call and press, a saved workflow's step, self-healing and the self-test are never affected; sparkie_setup says why.
// Once a passkey is set up, a passing result posted to POST /main/eval waits for the owner's yes: nothing kept, one
// owner-only button in their chat "The brain eval’s result" built from the record, said in sparkie_setup and /status,
// never asked on Telegram; pressed on the page with the passkey it is kept and changes run at once; "No" drops it. Against
// an agent's key, a stranger, a forged seal, another build, a record's own score, two at once, a replayed or stale press,
// an agent's press and a restart; the ask names the brain from the console's own record, never the poster's words. A
// kept record is never replaced (the same record again: already kept; another with its at and build is kept beside it,
// and of two at one moment the one that missed the bar decides), at is only the runner's form, and an entry
// counts only under the key computed from the brain serving. What never counts: a partial run; a run that missed the bar (also when its own score
// says it met it); another mark; another case set; a memory-set run; one with a memory addition off; one missing those
// fields; a case id or expect that isn't the lock's; a record written into the file by hand; another key (a changed
// flag, image, image actually run, weights' snapshot, toolRounds, maxChanges, toolCap) or the narrow key of before; the
// chat routed to another model; a missing or unreadable profile or lock. The newest full run decides: one that missed
// the bar takes the pass away, and newer partial runs never push a full one out. A server error on the brain check
// keeps nothing. The eval's runner refuses to ask the brain as another setup than the one serving.
// The mark of what the brain reads holds a turn in the paired Telegram chat too: only its prompt or tools changed is
// another mark, and a Telegram turn there is a button until an eval for that mark is kept.
// E5b: what runs is the snapshot the container loaded (its arguments, or its overlay's links), never one downloaded
// since. The loop's limits are the profile's: the careful ones (8 rounds) while not checked, its own once checked, held
// to 40 rounds and 12 changes a message. A carry-on turn with no eval kept asks with a button. The mark covers the fixed
// words the brain is sent outside its prompt and tools. A 429 or 404 on the check keeps nothing; a record that doesn't
// name every memory addition on never counts; the press of a waiting result says what the rail says; a seal's key that
// can't be read is named.
// T136 (part): a switch to a brain with no eval on record makes every change a button; once the eval has passed for this
// brain and build, a clear change runs at once.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, mkdtempSync, cpSync, appendFileSync, readdirSync, readlinkSync, symlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { T, REPO, useFleet, api, call, createActKey, newChat, say, choose, chatMessages, auditLines, waitFor, sleep, SLOW } from './lib.mjs';
import { serviceConfig, startMock } from './start-mock.mjs';
import { Authenticator, passkeyHeader } from './authenticator.mjs';
import { brainSent, brainReadsOf } from './lock.mjs';

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
    writeFileSync(join(dir, 'secrets', 'secrets.json'), JSON.stringify({ telegram: { token: TOKEN, bot: 'spark_test_bot', chatId: OWNER_TG, userId: OWNER_TG, name: 'Owner', approve: true } }), { mode: 0o600 });
    const f = join(stateDir, 'main.json'), m = JSON.parse(readFileSync(f, 'utf8')), base = m.presets[m.current];
    Object.assign(m.presets, { 'rail-flag': { ...base, args: [...base.args, '--enable-cache-report'] }, 'rail-image': { ...base, imageId: OTHER_IMAGE },
      'rail-rounds': { ...base, toolRounds: 7 }, 'rail-changes': { ...base, maxChanges: 3 }, 'rail-cap': { ...base, toolCap: 20 },
      // (E5b: a setup that asks for more rounds and changes than any may have)
      'rail-huge': { ...base, toolRounds: 1e9, maxChanges: 1e9 } });
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
// What the stand-in brain was asked for these words: each request's round and the tools it was offered.
const requests = words => { const f = join(T.fleet.dir, 'model-requests.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(x => x.words === words) : []; };
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
// POST /main/eval as the owner (as the runner's --store sends it). kept: one that can't unlock, kept at once (201).
const keep = rec => api('/main/eval', { method: 'POST', body: rec });
const kept = async rec => { const r = await keep(rec); assert.equal(r.status, 201, r.text); return r.json; };
// A request the owner confirms with the passkey (the page's way).
async function confirmed(method, path, body) {
  const b = await api('/auth/passkey/begin', { method: 'POST', body: { purpose: 'confirm', method, path, body } });
  assert.equal(b.status, 200, b.text);
  return api(path, { method, body, headers: { 'x-spark-passkey': passkeyHeader(KEY.sign(b.json)) } });
}
// The owner's chat "The brain eval’s result": its newest message with buttons still open, and those buttons.
async function waiting() {
  const c = (await api('/chats')).json.chats.find(x => x.title === 'The brain eval’s result');
  const messages = c ? (await api(`/chats/${c.id}`)).json.messages : [], m = messages.findLast(x => x.choices?.some(y => y.state === 'open'));
  return { conv: c?.id, messages, message: m, open: messages.flatMap(x => x.choices || []).filter(y => y.state === 'open'),
    keep: m?.choices.find(x => /^Keep it/.test(x.label)), no: m?.choices.find(x => /^No, drop it$/.test(x.label)) };
}
const press = (w, choice) => confirmed('POST', `/chats/${w.conv}/choose`, { choice: choice.id });
// A passing result for this build, posted (202: it waits) and kept by the owner's press with the passkey.
async function yes(rec) {
  const r = await keep(rec);
  assert.equal(r.status, 202, r.text);
  const w = await waiting(), p = await press(w, w.keep);
  assert.equal(p.status, 200, p.text);
  assert.ok(Object.values(profiles()).some(x => x.evals?.[`${rec.reads}:${rec.set}`]?.some(y => y.at === rec.at && y.keptWith === 'passkey')), 'kept with the passkey');
}

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

  test('no eval on record, and still the rail is only the brain’s: the owner’s own call, the owner’s press of a button and a saved workflow’s step run as before', { timeout: 120000 * SLOW }, async () => {
    const own = await api('/actions/remember', { method: 'POST', body: { text: 'Rail own call holds', kind: 'fact' } });
    assert.deepEqual([own.status, own.json.outcome], [200, 'remembered'], own.text);
    const words = 'remember that the rail press holds', chat = await newChat();
    script([{ match: `^${words}$`, calls: [{ name: 'remember', arguments: { text: 'The rail press holds', kind: 'fact' } }] }]);
    const asked = (await say(chat, words)).message;
    assert.equal(asked.choices?.length, 1, JSON.stringify(asked));
    const pressed = await choose(chat, asked.choices[0].id);
    assert.equal(pressed.status, 200, pressed.text);
    assert.equal(pressed.json.outcome, 'remembered', pressed.text);
    const saved = await api('/actions/save_workflow', { method: 'POST', body: { title: 'rail step', steps: [{ action: 'stop_model', args: { spark: 'spark4', container: RADIX } }] } });
    assert.equal(saved.status, 200, saved.text);
    const run = await api('/actions/run_workflow', { method: 'POST', body: { name: 'rail step' } });
    assert.equal(run.status, 200, run.text);
    assert.notEqual(run.json.outcome, 'question', run.text);
    await waitFor(() => stateOf('spark4', RADIX) === 'exited', { timeout: 60000, what: 'the workflow’s stop step to run' });
    assert.ok(auditLines().some(l => l.via === 'workflow' && l.action === 'stop_model' && l.ok), 'the step ran as the workflow');
  });

  test('once a passkey is set up a passing result waits for the owner’s yes: nothing kept, one button in their chat built from the record, said in sparkie_setup and /status, never asked on Telegram; pressed with the passkey it is kept and changes run at once; a second press is refused', { timeout: 180000 * SLOW }, async () => {
    const b = await api('/auth/passkey/begin', { method: 'POST', body: { purpose: 'register' } });
    assert.equal((await api('/auth/passkey/register', { method: 'POST', body: KEY.register(b.json) })).status, 201);
    const before = readFileSync(PROFILES(), 'utf8'), rec = await record(), tgFrom = tgSent().length;
    const posted = await keep(rec);
    assert.deepEqual([posted.status, posted.json.stored, posted.json.waiting], [202, false, true], posted.text);
    assert.match(posted.json.says, /^Waiting for the owner’s yes: a button in the chat “The brain eval’s result” in Spark Console/);
    assert.equal(readFileSync(PROFILES(), 'utf8'), before, 'nothing kept');
    await aButton('waiting for the yes', /An eval result for this build is waiting for your yes in the chat “The brain eval’s result”\.$/);
    const w = await waiting(), lock = LOCK(), total = lock.evalSet.cases.length * 3;
    assert.deepEqual(w.open.map(c => c.label), ['Keep it: Sparkie makes the changes you ask for at once again', 'No, drop it']);
    const serving = (await shown()).brainCheck.inUse;
    assert.equal(w.message.content, [`A brain eval result is waiting for your yes. It is for build ${lock.build}, ${serving.model} with ${serving.engine}, image ${serving.image} (the setup ${serving.setup} serving now), on the case set test/eval/cases.json (${lock.evalSet.cases.length} cases, 3 runs each), run on ${rec.at.slice(0, 10)} at ${rec.at.slice(11, 16)} UTC.`,
      `${total} of ${total} runs passed (the bar is ${Math.ceil(total * 0.95)}); ${lock.evalSet.cases.length} of ${lock.evalSet.cases.length} cases passed every run (the bar is ${Math.ceil(lock.evalSet.cases.length * 0.9)}); no wrong change; it asked on 0 of ${3 * lock.evalSet.cases.filter(([, e]) => ['act', 'answer'].includes(e)).length} clear requests (the bar is at most ${Math.floor(3 * lock.evalSet.cases.filter(([, e]) => ['act', 'answer'].includes(e)).length * 0.05)}).`,
      'Spark Console can’t check that this run happened, or that it ran on this brain: it has only the post, sent over the tailnet as you. Keep it only for a run you started.',
      'Keeping it means Sparkie makes the changes your words clearly ask for at once again, as before this install. Until then it asks before every change.'].join('\n\n'));
    const status = await say(await newChat(), '/status');
    assert.match(status.text, /Needs you:\n(?:- .*\n)*- A brain eval result for this build is waiting for your yes: press its button in the chat “The brain eval’s result” in Spark Console\./);
    await sleep(3000);
    assert.ok(!tgSent().slice(tgFrom).some(c => /eval/i.test(c.body.text)), 'nothing asked on Telegram');
    const bare = await api(`/chats/${w.conv}/choose`, { method: 'POST', body: { choice: w.keep.id } });
    assert.deepEqual([bare.status, bare.json.passkey], [428, 'confirm'], bare.text);
    assert.equal(readFileSync(PROFILES(), 'utf8'), before, 'nothing kept without the passkey');
    const p = await press(w, w.keep);
    assert.equal(p.status, 200, p.text);
    assert.equal((await press(w, w.keep)).status, 409, 'a press replayed');
    const stored = Object.values(profiles()).find(x => x.key === rec.brain.key).evals[`${rec.reads}:${rec.set}`][0];
    assert.deepEqual([stored.keptWith, /^[0-9a-f]{64}$/.test(stored.seal), stored.setFile, stored.memorySwitches], ['passkey', true, 'test/eval/cases.json', { on: SWITCHES, off: [] }]);
    await atOnce('kept with the passkey');
    assert.match((await shown()).changes, /^Sparkie makes a change your words clearly ask for at once: the brain check passed, and the eval on record for this build \(\d{4}-\d\d-\d\d\) ran in full and met the bar\.$/);
  });

  test('the way out holds against an agent, a stranger, a forged seal, another build, a record’s own score, two at once and a stale press; "No" drops it; an agent can’t press it', { timeout: 180000 * SLOW }, async () => {
    // (the newest full run on record missed the bar, so Sparkie asks: nothing below may change that)
    await kept(await record({}, { passed: i => i >= 3 }));
    await aButton('a run that missed the bar');
    const before = readFileSync(PROFILES(), 'utf8');
    // (an agent's key gets nothing from the route; nobody, the same)
    assert.equal((await api('/main/eval', { method: 'POST', body: await record(), headers: { authorization: `Bearer ${act.token}`, 'tailscale-funnel-request': '?1' } })).status, 401);
    assert.equal((await api('/main/eval', { method: 'POST', body: await record(), headers: { 'tailscale-user-login': 'stranger@test' } })).status, 401);
    // (another build's mark: refused, nothing waits)
    const other = await keep(await record({ reads: 'cd'.repeat(32) }));
    assert.equal(other.status, 409, other.text);
    assert.match(other.json.error, /^Kept nothing: that result is for another version of what the brain reads than this build’s\./);
    // (its own score says it met the bar over failing runs: recounted, kept as a run that missed it, and no button)
    const own = await keep(await record({ score: { full: true, met: true, passOnce: 1, passAllRuns: 1, wrongChanges: 0, askedOnClear: 0 } }, { passed: i => i >= 3 }));
    assert.equal(own.status, 201, own.text);
    assert.match(own.json.says, /It doesn’t let Sparkie change things without asking: the bar wasn’t met\.$/);
    assert.equal((await waiting()).open.length, 0, 'no button for either');
    // (a forged seal and keptWith in what was posted count for nothing: it waits like any other)
    const forged = await keep({ ...(await record()), keptWith: 'passkey', seal: 'ab'.repeat(32) });
    assert.equal(forged.status, 202, forged.text);
    await aButton('posted with a forged seal');
    // (two at once: one waits, the newer; the older's buttons are gone)
    const [r1, r2] = [await record(), await record()];
    const both = await Promise.all([keep(r2), keep(r1)]);
    assert.ok(both.some(x => x.status === 202), JSON.stringify(both.map(x => x.status)));
    let w = await waiting();
    assert.equal(w.open.length, 2, 'one waiting result’s two buttons');
    assert.ok(w.message.content.includes(`${r2.at.slice(0, 10)} at ${r2.at.slice(11, 16)} UTC`));
    // (a press of a button after a newer result arrived)
    const stale = w, newest = await record();
    assert.equal((await keep(newest)).status, 202);
    assert.equal((await press(stale, stale.keep)).status, 409, 'the older button');
    // (an agent can't press it: the owner's chat isn't its conversation)
    w = await waiting();
    const door = await call(act.token, 'ask_sparkie', { conversation: w.conv, choice: w.keep.id });
    assert.equal(door.isError, true, door.text);
    // ("No" drops it: nothing kept, nothing waits)
    assert.equal((await press(w, w.no)).status, 200);
    assert.doesNotMatch((await shown()).changes, /waiting for your yes/);
    await aButton('dropped');
    const keptAts = Object.values(profiles()).flatMap(x => Object.values(x.evals || {}).flat()).map(y => y.at);
    assert.ok(![r1, r2, newest].some(x => keptAts.includes(x.at)), 'none of the waiting ones was kept');
    assert.equal(JSON.parse(before).profiles !== undefined, true);
  });

  test('a kept record is never replaced, and only the runner’s own form of when it ran is taken', { timeout: 180000 * SLOW }, async () => {
    // (a pass kept with the owner's yes, then a newer full run that missed the bar: Sparkie asks)
    await yes(await record());
    await atOnce('a pass kept');
    const fail = await record({}, { passed: i => i >= 3 });
    assert.equal((await keep(fail)).status, 201);
    await aButton('the newest full run missed the bar');
    // (the same record posted again: already kept, nothing written)
    const before = readFileSync(PROFILES(), 'utf8');
    const same = await keep(fail);
    assert.deepEqual([same.status, same.json.stored], [200, false], same.text);
    assert.match(same.json.says, /^Already kept: this same result is on record/);
    assert.equal(readFileSync(PROFILES(), 'utf8'), before, 'nothing written');
    await aButton('the failing run still decides', /didn’t meet the bar/);
    // (only the runner's own form of when it ran: "9" would sort above every date as text and stay "the newest")
    for (const at of ['9', '2026-11-15T09:40:00Z', '2026-11-15 09:40:00.000Z']) {
      const r = await keep(await record({ at }, { passed: i => i >= 3 }));
      assert.equal(r.status, 400, `${at}: ${r.text}`);
      assert.match(r.json.error, /at: when it ran, as the runner writes it/);
    }
    await yes(await record());
    await atOnce('the owner’s newer pass decides');
  });

  // (review of the fix pass, 1: "already kept" is the same record, never only the same at and build)
  const oneCase = at => record({ at }, { cases: LOCK().evalSet.cases.slice(0, 1), runs: 1 });
  test('a one-case record that took a failing run’s at and build first doesn’t keep that run off: it is kept beside it, and it takes the pass away', { timeout: 180000 * SLOW }, async () => {
    await yes(await record());
    await atOnce('an older pass on record');
    const fail = await record({}, { passed: i => i >= 3 });
    assert.equal((await keep(await oneCase(fail.at))).status, 201, 'the one-case record, first');
    const r = await keep(fail);
    assert.deepEqual([r.status, r.json.stored], [201, true], r.text);
    await aButton('the failing run decides', /didn’t meet the bar/);
  });

  test('a one-case record that took a waiting pass’s at and build doesn’t keep the pass off: pressed with the passkey, it is kept and decides', { timeout: 180000 * SLOW }, async () => {
    const pass = await record();
    assert.equal((await keep(pass)).status, 202, 'the pass waits');
    assert.equal((await keep(await oneCase(pass.at))).status, 201, 'the one-case record');
    const w = await waiting(), p = await press(w, w.keep);
    assert.equal(p.status, 200, p.text);
    assert.doesNotMatch(p.json.note || '', /Already kept/, p.text);
    const slot = profiles()[(await shown()).brainCheck.inUse.key].evals[`${pass.reads}:${pass.set}`];
    assert.ok(slot.some(x => x.at === pass.at && x.keptWith === 'passkey' && x.score.full), 'the pass is on record');
    await atOnce('the pass decides');
  });

  test('a failing full run carrying a kept pass’s own at and build is kept beside it and takes the pass away', { timeout: 180000 * SLOW }, async () => {
    const pass = await record();
    await yes(pass);
    await atOnce('the pass');
    const r = await keep(await record({ at: pass.at }, { passed: i => i >= 3 }));
    assert.deepEqual([r.status, r.json.stored], [201, true], r.text);
    await aButton('of two full runs at one moment, the one that missed the bar decides', /didn’t meet the bar/);
  });

  test('a passing run posted with a failing full run’s own at and build, kept with the passkey, gives nothing back: of two at one moment the one that missed the bar decides', { timeout: 180000 * SLOW }, async () => {
    const fail = await record({}, { passed: i => i >= 3 });
    assert.equal((await kept(fail)).stored, true);
    await aButton('the failing run');
    await yes(await record({ at: fail.at }));
    await aButton('still the failing run', /didn’t meet the bar/);
    await yes(await record());
    await atOnce('a newer pass');
  });

  test('the brain’s key comes from the brain, not the file: brain A’s entry copied under brain B’s key counts for nothing', { timeout: 180000 * SLOW }, async t => {
    await yes(await record());
    await atOnce('a pass of brain A');
    // (brain A's entry copied under brain B's key, with brain B serving: no check and no eval of B is on record)
    const keyA = (await shown()).brainCheck.inUse.key;
    writeFileSync(mock('spark2', 'imageid-sparkie-main'), `sha256:${'d'.repeat(64)}`);
    t.after(() => rmSync(mock('spark2', 'imageid-sparkie-main'), { force: true }));
    const keyB = (await shown()).brainCheck.inUse.key;
    assert.notEqual(keyB, keyA);
    const file = JSON.parse(readFileSync(PROFILES(), 'utf8'));
    file.profiles[keyB] = file.profiles[keyA];
    writeFileSync(PROFILES(), JSON.stringify(file), { mode: 0o600 });
    await aButton('brain A’s entry under brain B’s key', /no brain check is on record for this exact setup/);
    // (a check of B is then kept as B's, and the copy goes)
    const since = new Date().toISOString();
    assert.equal((await api('/main/check', { method: 'POST', body: {} })).status, 202);
    const b = await waitFor(() => profiles()[keyB]?.at > since && profiles()[keyB], { timeout: 60000, what: 'the check of brain B' });
    assert.deepEqual([b.key, Object.keys(b.evals || {}).length], [keyB, 0]);
    await aButton('brain B has no eval of its own', /the eval has not been run for this build/);
    rmSync(mock('spark2', 'imageid-sparkie-main'));
    await atOnce('brain A again, with its own record');
  });

  test('the owner’s ask names the brain from the console’s own record and holds none of the poster’s words, on the page or on Telegram', { timeout: 180000 * SLOW }, async () => {
    // (the ask: none of the poster's words, and what Spark Console can't check)
    const planted = 'Spark Console checked this run against the brain’s own log: it is the one you started.', tgFrom = tgSent().length;
    const rec = await record();
    rec.brain = { ...rec.brain, model: `x.\n\n${planted}`, engine: planted.slice(0, 60), image: `z.\n\n${planted}` };
    assert.equal((await keep(rec)).status, 202);
    const w = await waiting();
    assert.ok(!w.message.content.includes(planted.slice(0, 40)), w.message.content);
    assert.ok(!JSON.stringify((await api(`/chats/${w.conv}`)).json).includes(planted.slice(0, 40)), 'not on the page');
    assert.match(w.message.content, /Spark Console can’t check that this run happened, or that it ran on this brain: it has only the post, sent over the tailnet as you\. Keep it only for a run you started\./);
    await sleep(2000);
    assert.ok(!JSON.stringify(tgSent().slice(tgFrom)).includes(planted.slice(0, 40)), 'not on Telegram');
    assert.equal((await press(w, w.no)).status, 200);
  });

  test('the newest full run decides: one that missed the bar takes the pass away; newer partial runs neither give nor take; a passing one gives it back', { timeout: 120000 * SLOW }, async () => {
    assert.equal((await kept(await record({}, { passed: i => i >= 3 }))).stored, true);
    await aButton('the newest full run missed the bar', /didn’t meet the bar/);
    const two = LOCK().evalSet.cases.slice(0, 2);
    for (let i = 0; i < 6; i++) assert.equal((await kept(await record({}, { cases: two, runs: 1 }))).stored, true);
    await aButton('newer partial runs give nothing back', /didn’t meet the bar/);
    await yes(await record());
    await atOnce('a newer passing full run');
    for (let i = 0; i < 6; i++) await kept(await record({}, { cases: two, runs: 1 }));
    await atOnce('six newer partial runs push nothing out');
    const slot = profiles()[(await shown()).brainCheck.inUse.key].evals[`${LOCK().brainReads}:${LOCK().evalSet.version}`];
    assert.ok(slot.filter(x => x.score.full).length >= 3, 'the full runs are kept beside five partial ones');
  });

  test('records that never count, each the newest when kept: partial, bar not met, another mark, another case set, a memory set, a memory addition off, no set fields, a case id or expect not the lock’s, written by hand', { timeout: 300000 * SLOW }, async () => {
    // (a slot whose newest full run missed the bar: what follows would unlock if it counted)
    await kept(await record({}, { passed: i => i >= 3 }));
    await aButton('missed the bar');
    const cases = LOCK().evalSet.cases, memory = readFileSync(join(REPO, 'test', 'eval', 'memory.json')), sha = b => createHash('sha256').update(b).digest('hex');
    // (a case file is a list of cases, or {about, cases})
    const memoryCases = (v => (Array.isArray(v) ? v : v.cases))(JSON.parse(memory));
    // (kept, never counting)
    const never = [
      ['a partial run', await record({}, { cases: cases.slice(0, 5) })],
      ['its own score saying it met the bar over failing runs', await record({ full: true, score: { full: true, met: true, passOnce: 1, passAllRuns: 1, wrongChanges: 0, askedOnClear: 0 } }, { passed: i => i >= 3 })],
      ['a memory-set full pass', await record({ set: sha(memory), setFile: 'test/eval/memory.json', setCases: memoryCases.length }, { cases: memoryCases.map(c => [c.id, c.expect]) })],
      ['a memory addition off', await record({ memorySwitches: { on: SWITCHES.slice(1), off: ['names'] } })],
      ['no setFile or memorySwitches', await record({ setFile: undefined, memorySwitches: undefined })],
    ];
    for (const [what, rec] of never) {
      assert.equal((await kept(rec)).stored, true, what);
      await aButton(what);
    }
    // (refused, nothing kept and nothing waiting: they could unlock, but not for this build, its case set and its cases)
    for (const [what, rec] of [['another mark', await record({ reads: 'cd'.repeat(32) })], ['another case set', await record({ set: 'ef'.repeat(32) })],
      ['a case id not the lock’s', await record({}, { cases: cases.map(([id, e], i) => [i ? id : `${id}-x`, e]) })],
      ['an expect not the lock’s', await record({}, { cases: cases.map(([id, e], i) => [id, i ? e : (e === 'act' ? 'ask' : 'act')]) })]]) {
      const r = await keep(rec);
      assert.equal(r.status, 409, `${what}: ${r.text}`);
      await aButton(what);
    }
    // Written into the file by hand: no seal.
    const serving = (await shown()).brainCheck.inUse.key;
    const file = JSON.parse(readFileSync(PROFILES(), 'utf8')), p = file.profiles[serving], slot = `${LOCK().brainReads}:${LOCK().evalSet.version}`;
    const valid = x => x.score.full && x.score.met && evalMain(x) && x.cases.every((c, i) => c.id === cases[i][0] && c.expect === cases[i][1]);
    const { seal, ...unsealed } = p.evals[slot].find(valid);
    p.evals[slot].unshift({ ...unsealed, at: new Date(tick += 1000).toISOString() });
    writeFileSync(PROFILES(), JSON.stringify(file), { mode: 0o600 });
    await aButton('written by hand, with no seal');
    assert.ok(seal);
    await yes(await record());
    await atOnce('a passing full run again');
  });

  test('a record that doesn’t name every memory addition on never counts: kept at once, and Sparkie still asks', { timeout: 120000 * SLOW }, async () => {
    await kept(await record({}, { passed: i => i >= 3 }));
    await aButton('missed the bar');
    for (const on of [['names'], [...SWITCHES, 'more'], []]) {
      const r = await kept(await record({ memorySwitches: { on, off: [] } }));
      assert.equal(r.stored, true, JSON.stringify(on));
      await aButton(`on: ${on.join(', ') || 'none'}`, /didn’t meet the bar/);
    }
    await yes(await record());
    await atOnce('a passing full run with every addition on');
  });

  test('the press of a waiting result says what the rail says now: kept beside a newer run that missed the bar, Sparkie still asks', { timeout: 120000 * SLOW }, async () => {
    const pass = await record();
    assert.equal((await keep(pass)).status, 202);
    assert.equal((await kept(await record({}, { passed: i => i >= 3 }))).stored, true, 'a newer full run that missed the bar');
    const w = await waiting(), p = await press(w, w.keep);
    assert.equal(p.status, 200, p.text);
    assert.equal(p.json.outcome, 'kept', p.text);
    assert.match(p.json.note, /^Kept\. Sparkie asks before every change, one button each: the newest full run of the eval on record for this build \(\d{4}-\d\d-\d\d\) didn’t meet the bar\./, p.text);
    await aButton('the newer failing run decides');
    await yes(await record());
    await atOnce('a newer pass');
  });

  test('another brain is another key: the image it runs, its weights, and a changed flag, image, toolRounds, maxChanges or toolCap; the narrow key of before', { timeout: 600000 * SLOW }, async () => {
    writeFileSync(mock('spark2', 'imageid-sparkie-main'), `sha256:${'c'.repeat(64)}`);
    await aButton('another image actually run', /no brain check is on record for this exact setup/);
    rmSync(mock('spark2', 'imageid-sparkie-main'));
    await atOnce('the image it ran before');
    // (E5b: the weights it loaded, never the snapshot a start would serve now)
    const hub = join(T.fleet.root, 'spark2', '.cache', 'huggingface', 'hub', 'models--RadixArk--Qwen3.8-27B-NVFP4');
    cpSync(join(hub, 'snapshots', 'r1'), join(hub, 'snapshots', 'r2'), { recursive: true, verbatimSymlinks: true });
    writeFileSync(join(hub, 'refs', 'main'), 'r2');
    await atOnce('a newer snapshot downloaded while it runs: not what it loaded, so the same brain');
    // (a start that loaded it, served from the overlay its rope settings need: the overlay's links name r2)
    const overlay = join(T.fleet.root, 'spark2', '.cache', 'spark-console', 'overlay', 'qwen-aphex', 'model');
    const relink = (from, to) => { for (const f of readdirSync(overlay)) { const at = join(overlay, f); let l; try { l = readlinkSync(at); } catch { continue; } rmSync(at); symlinkSync(l.replace(`/snapshots/${from}/`, `/snapshots/${to}/`), at); } };
    relink('r1', 'r2');
    await aButton('the snapshot it loaded, from the overlay', /no brain check is on record for this exact setup/);
    relink('r2', 'r1');
    await atOnce('the overlay as it was');
    // (one served straight from the cache: the snapshot in the container's own arguments)
    const args = mock('spark2', 'args-sparkie-main'), argsWere = readFileSync(args, 'utf8');
    writeFileSync(args, JSON.stringify(['-m', 'sglang.launch_server', '--model-path', '/hf/models--RadixArk--Qwen3.8-27B-NVFP4/snapshots/r2', '--speculative-draft-model-path', '/hf/models--z-lab--Qwen3.8-27B-DFlash2/snapshots/z1']));
    await aButton('the snapshot it loaded, from its arguments', /no brain check is on record for this exact setup/);
    writeFileSync(args, argsWere);
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
    const p = JSON.parse(was).profiles[(await shown()).brainCheck.inUse.key], slot = `${LOCK().brainReads}:${LOCK().evalSet.version}`;
    const { seal, keptWith, ...old } = p.evals[slot].find(x => x.score.full && x.score.met);
    writeFileSync(PROFILES(), JSON.stringify({ profiles: { [narrow]: { ...p, key: narrow, evals: { [slot]: [old] } } } }), { mode: 0o600 });
    await aButton('the narrow key of before');
    assert.ok(seal && keptWith);
    writeFileSync(PROFILES(), was, { mode: 0o600 });
    await atOnce('the profile back');
  });

  // E5b: the loop's limits from the brain's profile.
  test('the loop’s limits come from the brain’s profile: the careful ones (8 rounds) while not checked; once checked its own, held to 40 rounds and 12 changes a message', { timeout: 300000 * SLOW }, async () => {
    await useSetup('rail-huge');
    const GUIDE = { name: 'guide', arguments: { tools: 'past' } };
    const offered = async words => {
      script([{ match: `^${words}$`, rounds: Array(45).fill([GUIDE]) }]);
      await say(await newChat(), words);
      return requests(words).map(x => x.tools.length > 0);
    };
    const upTo = n => [...Array(n).fill(true), false];
    assert.deepEqual(await offered('huge rounds while not checked'), upTo(8), 'the careful limits');
    await yes(await record());
    await atOnce('checked');
    assert.deepEqual(await offered('huge rounds once checked'), upTo(40), 'its own, held to 40');
    const words = 'remember that the huge facts hold', fact = i => ({ name: 'remember', arguments: { text: `Huge fact ${i} holds`, kind: 'fact' } });
    script([{ match: `^${words}$`, rounds: [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11], [12]].map(r => r.map(fact)) }]);
    const { message } = await say(await newChat(), words);
    assert.deepEqual(message.tools.map(t => [t.name, t.ok, t.outcome || null]), [...Array(12).fill(['remember', true, 'remembered']), ['remember', false, null]]);
    assert.ok(requests(words).at(-1).results.some(x => x.content === '[error] At most 12 changes per message. Say what’s done and what’s left.'), JSON.stringify(requests(words).at(-1).results));
    await useSetup('aphex');
    await atOnce('back on the setup the eval ran on');
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

  test('a 429 or a 404 to the brain check’s tool requests is no answer either: nothing is kept, never “never calls a tool”', { timeout: 180000 * SLOW }, async t => {
    const was = readFileSync(PROFILES(), 'utf8');
    t.after(() => rmSync(mock('spark2', 'brain-kind'), { force: true }));
    for (const code of [429, 404]) {
      writeFileSync(mock('spark2', 'brain-kind'), `status-${code}`);
      const since = new Date().toISOString();
      assert.equal((await api('/main/check', { method: 'POST', body: {} })).status, 202);
      const seen = await waitFor(async () => { const s = (await shown()).brainCheck; return s.lastTry?.at > since && s; }, { timeout: 60000, what: `the try with ${code}` });
      assert.match(seen.lastTry.problem, new RegExp(`answered ${code}, so the check couldn’t be made`), String(code));
      assert.equal(readFileSync(PROFILES(), 'utf8'), was, `nothing kept on a ${code}`);
    }
    rmSync(mock('spark2', 'brain-kind'));
    await atOnce('the profile on record stands');
  });

  // E5b, item 3: a carry-on turn meets the rail as any turn of the chat does.
  test('a carry-on turn with no eval kept: the change it asks for is one button, and nothing runs', { timeout: 240000 * SLOW }, async t => {
    await yes(await record());
    await atOnce('checked for the request itself');
    const words = `stop ${TESTORG} on spark 3, then start it again`;
    script([{ match: `^${words}$`, calls: [{ name: 'stop_model', arguments: { spark: 'spark3', container: TESTORG } }] },
      { match: '^\\[Spark Console\\] What you started', calls: [{ name: 'restart_model', arguments: { spark: 'spark3', container: TESTORG } }] }]);
    // (the stop takes a few seconds, so the eval can be taken away before its result wakes the carry-on turn)
    writeFileSync(mock('spark3', 'slow-stop'), String(Math.round(4 * SLOW)));
    t.after(() => rmSync(mock('spark3', 'slow-stop'), { force: true }));
    const chat = await newChat(), first = (await say(chat, words)).message;
    assert.deepEqual(first.tools.map(x => [x.name, x.outcome]), [['stop_model', 'started']]);
    const was = readFileSync(PROFILES(), 'utf8'), file = JSON.parse(was), key = (await shown()).brainCheck.inUse.key;
    file.profiles[key].evals = {};
    writeFileSync(PROFILES(), JSON.stringify(file), { mode: 0o600 });
    const carried = await waitFor(async () => (await chatMessages(chat)).find(m => m.role === 'assistant' && !m.notice && (m.tools || []).some(x => x.name === 'restart_model')), { timeout: 120000 * SLOW, what: 'the carry-on turn' });
    assert.deepEqual(carried.tools.map(x => [x.name, x.outcome]), [['restart_model', 'needs-ok']]);
    assert.equal(carried.choices?.length, 1, JSON.stringify(carried));
    assert.match((await shown()).changes, /the eval has not been run for this build/);
    await sleep(2000);
    assert.equal(stateOf('spark3', TESTORG), 'exited', 'the stop ran, and nothing started it again');
    // (as it was: the eval back, and the model running for the tests after)
    writeFileSync(PROFILES(), was, { mode: 0o600 });
    const own = await api('/actions/restart_model', { method: 'POST', body: { spark: 'spark3', container: TESTORG } });
    assert.equal(own.status, 200, own.text);
    await waitFor(() => stateOf('spark3', TESTORG) === 'running', { timeout: 120000, what: `${TESTORG} running again` });
    await atOnce('the eval back');
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

// The mark holds a turn in the paired Telegram chat too (its prompt and tools differ from the page's): a change to only
// that is another mark, and a Telegram turn on a build with that mark is a button until an eval for it is kept.
test('the mark holds what a Telegram turn is sent: only its prompt or its tools changed is another mark, and a Telegram turn is then a button', { timeout: 300000 * SLOW }, async t => {
  // (on a fresh stand-in fleet, as test/lock.mjs measures it: the lock's own mark for this tree, before and now)
  const fresh = await startMock({ evalOnRecord: false });
  let sent;
  try { sent = await brainSent(fresh); } finally { await fresh.stop(); }
  const reads = brainReadsOf(sent), tg = sent.catalog.telegram;
  assert.match(tg.system, /writing from Telegram/);
  assert.notEqual(tg.system, sent.system);
  const pageOnly = brainReadsOf({ ...sent, catalog: { ...sent.catalog, telegram: undefined } });
  t.diagnostic(`the mark: ${pageOnly} for the page's turn alone (as before), ${reads} with the Telegram turn`);
  assert.notEqual(pageOnly, reads);
  const changed = edit => { const c = structuredClone(sent); edit(c.catalog.telegram); return brainReadsOf(c); };
  const promptOnly = changed(x => { x.system += ' One more line for Telegram.'; }), toolsOnly = changed(x => { x.tools = x.tools.filter(f => f.function.name !== 'remember'); });
  assert.ok(tg.tools.some(f => f.function.name === 'remember'));
  assert.ok(![promptOnly, toolsOnly].includes(reads) && promptOnly !== toolsOnly);
  // A build whose mark moved only for Telegram (its lock names promptOnly), holding a passing record of the mark before.
  const lock = { ...LOCK(), brainReads: promptOnly }, lockFile = join(TMP, 'telegram-lock.json');
  writeFileSync(lockFile, JSON.stringify(lock));
  const fleet = await startMock({ telegram: true, knowledge: true, watchMs: 60000, env: { SPARK_CONSOLE_WORKFLOW_LOCK: lockFile }, prepare: ({ dir }) => {
    mkdirSync(join(dir, 'secrets'), { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, 'secrets', 'secrets.json'), JSON.stringify({ telegram: { token: TOKEN, bot: 'spark_test_bot', chatId: OWNER_TG, userId: OWNER_TG, name: 'Owner' } }), { mode: 0o600 });
  } });
  try {
    const head = { 'content-type': 'application/json', 'x-spark-console': '1', origin: fleet.origin }, post = (p, b) => fetch(`${fleet.base}${p}`, { method: 'POST', headers: head, body: JSON.stringify(b) });
    const since = new Date().toISOString();
    assert.equal((await post('/main/check', {})).status, 202);
    const p = await waitFor(() => { try { return Object.values(JSON.parse(readFileSync(join(fleet.stateDir, 'brain-profiles.json'), 'utf8')).profiles).find(x => x.at > since); } catch { return null; } }, { timeout: 60000, what: 'the check' });
    const keep = async marked => {
      const rec = { kind: 'spark-console-eval', at: new Date(tick += 1000).toISOString(), build: lock.build, reads: marked, set: lock.evalSet.version, setFile: 'test/eval/cases.json', setCases: lock.evalSet.cases.length,
        cap: null, memorySwitches: { on: SWITCHES, off: [] }, runs: 3, brain: { standIn: true, key: p.key, setup: p.setup.id, model: p.model, engine: p.engine, image: p.image, flags: p.flags },
        cases: lock.evalSet.cases.map(([id, expect]) => ({ id, expect, runs: [1, 2, 3].map(() => ({ passed: true, asked: expect === 'ask', rounds: 1, seconds: 1, wrong: 0, unverified: 0, called: [], changed: [] })) })) };
      assert.equal((await post('/main/eval', rec)).status, 201);
    };
    const calls = () => { const f = join(fleet.dir, 'telegram-calls.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(c => c.method === 'sendMessage') : []; };
    const fromTelegram = async text => {
      const from = calls().length;
      await fetch(`http://127.0.0.1:${fleet.telegramPort}/__push`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: { message_id: msgId++, date: Math.floor(Date.now() / 1000), chat: { id: OWNER_TG, type: 'private' }, from: { id: OWNER_TG, is_bot: false, first_name: 'Owner' }, text } }) });
      return (await waitFor(() => { const s = calls().slice(from); return s.length && s; }, { timeout: 60000, what: 'the answer on Telegram' }))[0].body;
    };
    const radix = () => readFileSync(join(fleet.root, 'spark4', '.mock', 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${RADIX}|`))?.split('|')[1];
    await keep(reads);
    const asked = await fromTelegram(`stop ${RADIX} on spark 4`);
    assert.match(asked.reply_markup?.inline_keyboard?.[0]?.[0]?.text || '', /^Stop sc-RadixArk/, JSON.stringify(asked));
    assert.equal(radix(), 'running');
    const changes = (await (await post('/actions/sparkie_setup', {})).json()).changes;
    assert.equal(changes, 'Sparkie asks before every change, one button each: the eval has not been run for this build.');
    await keep(promptOnly);
    const ran = await fromTelegram(`stop ${RADIX} on spark 4`);
    assert.equal(ran.reply_markup, undefined, JSON.stringify(ran));
    await waitFor(() => radix() === 'exited', { timeout: 60000, what: `${RADIX} stopped from Telegram` });
  } finally { await fleet.stop(); }
});

// The rail is the brain's alone: on a fleet with no eval on record, self-healing still restarts a crashed model of Spark
// Console's, and the owner's self-test still starts (neither becomes a question).
test('no eval on record: self-healing restarts a crashed model, and the owner’s self-test starts, neither a question', { timeout: 240000 * SLOW }, async () => {
  const name = 'sc-rail-heal';
  const fleet = await startMock({ watchMs: 3000, evalOnRecord: false, env: { SPARK_CONSOLE_HEAL_MIN_RUN_MS: '60000' }, prepare: ({ root, stateDir }) => {
    const f = join(root, 'spark4', '.mock', 'containers');
    writeFileSync(f, `${readFileSync(f, 'utf8')}${name}|running|Up 1 hour|1|Qwen--Qwen3-32B|||\n`);
    writeFileSync(join(root, 'spark4', '.mock', `up-${name}`), String(Math.floor(Date.now() / 1000) - 3600));
    writeFileSync(join(stateDir, 'desired.json'), JSON.stringify({ revision: 1, running: [], revisions: [] }), { mode: 0o600 });
    // (Spark 3 free for the self-test, as selftest.test.mjs makes it)
    const s3 = join(root, 'spark3', '.mock', 'containers');
    writeFileSync(s3, readFileSync(s3, 'utf8').replace(new RegExp(`^(${TESTORG.replace(/[.]/g, '\\.')})\\|running\\|[^|]*\\|`, 'm'), '$1|exited|Exited (0) 2 hours ago|'));
  } });
  try {
    const head = { 'content-type': 'application/json', 'x-spark-console': '1', origin: fleet.origin };
    const seen = async () => ((await (await fetch(`${fleet.base}/actions/workloads`, { method: 'POST', headers: head, body: JSON.stringify({ spark: 'spark4' }) })).json()).workloads || []).some(w => w.name === name && w.running);
    const events = () => { try { return readFileSync(join(fleet.stateDir, 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
    const containers = join(fleet.root, 'spark4', '.mock', 'containers');
    const shown = await (await fetch(`${fleet.base}/actions/sparkie_setup`, { method: 'POST', headers: head, body: '{}' })).json();
    assert.match(shown.changes, /^Sparkie asks before every change, one button each: /);
    // (the watcher has to have seen it running: its first look is 15 s after the start)
    await waitFor(seen, { timeout: 60000, every: 1000, what: `the watcher seeing ${name} running` });
    const since = new Date().toISOString();
    writeFileSync(containers, readFileSync(containers, 'utf8').replace(new RegExp(`^${name}\\|running\\|[^|]*\\|`, 'm'), `${name}|exited|Exited (1) just now|`));
    rmSync(join(fleet.root, 'spark4', '.mock', `up-${name}`), { force: true });
    const healing = await waitFor(() => events().find(e => e.at >= since && e.container === name && e.type === 'healing'), { timeout: 90000, every: 1000, what: 'self-healing' });
    assert.match(healing.operation, /^[0-9a-f]{12}$/, JSON.stringify(healing));
    assert.ok(auditLines(fleet).some(l => l.via === 'watcher' && l.action === 'restart_model' && l.ok === true && l.operation === healing.operation), 'the restart ran as self-healing, not a question');
    const test = await (await fetch(`${fleet.base}/actions/self_test`, { method: 'POST', headers: head, body: '{}' })).json();
    assert.equal(test.outcome, 'started', JSON.stringify(test));
  } finally { await fleet.stop(); }
});

// A waiting result lives in memory only: a restart forgets it, so a restart can't be used to slip one in.
test('a result waiting for the owner’s yes is forgotten at a restart: its old button is refused after it, nothing is kept and nothing waits', { timeout: 240000 * SLOW }, async () => {
  const on = f => async (path, body, headers = {}) => {
    const r = await fetch(`${f.base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', 'x-spark-console': '1', origin: f.origin, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text };
  };
  const one = await startMock({ watchMs: 60000, evalOnRecord: false, keep: true });
  let two = null;
  try {
    const at1 = on(one), since = new Date().toISOString();
    const b = await at1('/auth/passkey/begin', { purpose: 'register' });
    assert.equal((await at1('/auth/passkey/register', KEY.register(b.json))).status, 201);
    assert.equal((await at1('/main/check', {})).status, 202);
    const p = await waitFor(() => { try { return Object.values(JSON.parse(readFileSync(join(one.stateDir, 'brain-profiles.json'), 'utf8')).profiles).find(x => x.at > since); } catch { return null; } }, { timeout: 60000, what: 'the check' });
    const lock = JSON.parse(readFileSync(join(one.dir, 'workflows.lock.json'), 'utf8')), lockFile = join(TMP, 'restart-lock.json');
    writeFileSync(lockFile, JSON.stringify(lock));
    const rec = { kind: 'spark-console-eval', at: new Date(tick += 1000).toISOString(), build: lock.build, reads: lock.brainReads, set: lock.evalSet.version, setFile: 'test/eval/cases.json', setCases: lock.evalSet.cases.length,
      cap: null, memorySwitches: { on: SWITCHES, off: [] }, runs: 3, brain: { standIn: true, key: p.key, setup: p.setup.id, model: p.model, engine: p.engine, image: p.image, flags: p.flags },
      cases: lock.evalSet.cases.map(([id, expect]) => ({ id, expect, runs: [1, 2, 3].map(() => ({ passed: true, asked: expect === 'ask', rounds: 1, seconds: 1, wrong: 0, unverified: 0, called: [], changed: [] })) })) };
    assert.equal((await at1('/main/eval', rec)).status, 202);
    const conv = (await at1('/chats')).json.chats.find(c => c.title === 'The brain eval’s result');
    const keepIt = (await at1(`/chats/${conv.id}`)).json.messages.flatMap(m => m.choices || []).find(c => c.state === 'open' && /^Keep it/.test(c.label));
    assert.ok(keepIt);
    await one.stop();
    two = await startMock({ watchMs: 60000, evalOnRecord: false, env: { SPARK_CONSOLE_WORKFLOW_LOCK: lockFile }, prepare: ({ stateDir }) => {
      for (const f of ['chats.json', 'passkeys.json', 'brain-profiles.json']) writeFileSync(join(stateDir, f), readFileSync(join(one.stateDir, f)), { mode: 0o600 });
    } });
    const at2 = on(two);
    assert.match((await at2('/actions/sparkie_setup', {})).json.changes, /^Sparkie asks before every change, one button each: (?!.*waiting for your yes)/);
    const pressed = await at2(`/chats/${conv.id}/choose`, { choice: keepIt.id });
    assert.equal(pressed.status, 409, pressed.text);
    assert.ok(!Object.values(JSON.parse(readFileSync(join(two.stateDir, 'brain-profiles.json'), 'utf8')).profiles).some(x => Object.values(x.evals || {}).flat().some(y => y.at === rec.at)), 'nothing kept');
  } finally {
    await two?.stop();
    await one.stop();
    rmSync(one.dir, { recursive: true, force: true });
  }
});

// E5b, item 2: what the brain is sent outside its prompt and tools is in the mark too.
test('the mark covers the fixed words the brain is sent outside its prompt and tools: a build whose carry-on line differs has another', { timeout: 300000 * SLOW }, async () => {
  const words = (await (await fetch(`${T.base}/actions`)).json()).brain.words;
  assert.deepEqual(Object.keys(words), ['carryOn', 'notRun', 'notShown', 'report', 'digest', 'cards', 'seenBefore']);
  assert.ok(Object.values(words).every(v => /^[0-9a-f]{16}$/.test(v)), JSON.stringify(words));
  // (a copy of this tree whose carry-on line says one word otherwise, its server made again)
  const copy = join(TMP, 'words-tree');
  for (const d of ['service', 'test', 'tools', 'deploy', 'public']) cpSync(join(REPO, d), join(copy, d), { recursive: true, verbatimSymlinks: true });
  const chats = join(copy, 'service', 'src', '14-chats.mjs'), text = readFileSync(chats, 'utf8');
  assert.ok(text.includes('Carry on with that request:'));
  writeFileSync(chats, text.replace('Carry on with that request:', 'Carry on with the request:'));
  const made = spawnSync(process.execPath, [join(copy, 'tools', 'build-server.mjs')], { cwd: copy, encoding: 'utf8' });
  assert.equal(made.status, 0, made.stdout + made.stderr);
  const { startMock: startCopy } = await import(pathToFileURL(join(copy, 'test', 'start-mock.mjs')).href);
  const other = await startCopy({ evalOnRecord: false });
  let theirs;
  try { theirs = (await (await fetch(`${other.base}/actions`)).json()).brain; } finally { await other.stop(); }
  assert.notEqual(theirs.words.carryOn, words.carryOn, 'the carry-on line');
  assert.deepEqual({ ...theirs.words, carryOn: null }, { ...words, carryOn: null }, 'the other words are the same');
  // (the catalog is in the mark: test/lock.mjs, brainReadsOf)
  const ours = (await (await fetch(`${T.base}/actions`)).json()).brain;
  assert.notEqual(brainReadsOf({ system: '', tools: [], catalog: { brain: ours } }), brainReadsOf({ system: '', tools: [], catalog: { brain: { ...ours, words: theirs.words } } }));
});

// Review of the rail, Later 2: a seal's key that can't be read is named, not taken for a bad run.
test('a seal’s key that can’t be read: a passing record kept is said to be unsealed, and Sparkie says the seal is why it asks', { timeout: 240000 * SLOW }, async () => {
  const fleet = await startMock({ watchMs: 60000, evalOnRecord: false, prepare: ({ dir }) => {
    mkdirSync(join(dir, 'secrets'), { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, 'secrets', 'eval-seal.json'), 'not a key\n', { mode: 0o600 });
  } });
  try {
    const head = { 'content-type': 'application/json', 'x-spark-console': '1', origin: fleet.origin }, post = async (p, b) => { const r = await fetch(`${fleet.base}${p}`, { method: 'POST', headers: head, body: JSON.stringify(b) }); return { status: r.status, json: await r.json() }; };
    const since = new Date().toISOString();
    assert.equal((await post('/main/check', {})).status, 202);
    const p = await waitFor(() => { try { return Object.values(JSON.parse(readFileSync(join(fleet.stateDir, 'brain-profiles.json'), 'utf8')).profiles).find(x => x.at > since); } catch { return null; } }, { timeout: 60000, what: 'the check' });
    const lock = JSON.parse(readFileSync(join(fleet.dir, 'workflows.lock.json'), 'utf8'));
    const rec = { kind: 'spark-console-eval', at: new Date(tick += 1000).toISOString(), build: lock.build, reads: lock.brainReads, set: lock.evalSet.version, setFile: 'test/eval/cases.json', setCases: lock.evalSet.cases.length,
      cap: null, memorySwitches: { on: SWITCHES, off: [] }, runs: 3, brain: { standIn: true, key: p.key, setup: p.setup.id, model: p.model, engine: p.engine, image: p.image, flags: p.flags },
      cases: lock.evalSet.cases.map(([id, expect]) => ({ id, expect, runs: [1, 2, 3].map(() => ({ passed: true, asked: expect === 'ask', rounds: 1, seconds: 1, wrong: 0, unverified: 0, called: [], changed: [] })) })) };
    const r = await post('/main/eval', rec);
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.match(r.json.says, /It isn’t sealed \(the eval seal’s key, eval-seal\.json beside the secrets file, can’t be read or made\), so it counts for nothing\.$/);
    assert.equal(readFileSync(join(fleet.dir, 'secrets', 'eval-seal.json'), 'utf8'), 'not a key\n', 'never written over');
    const changes = (await post('/actions/sparkie_setup', {})).json.changes;
    assert.equal(changes, 'Sparkie asks before every change, one button each: no eval result on record counts for this brain and build: the eval seal’s key (eval-seal.json, beside the secrets file) can’t be read, so no record on file is sealed.');
  } finally { await fleet.stop(); }
});
