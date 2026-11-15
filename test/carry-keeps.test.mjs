// Covers: A task keeps the guards of the turn that made it (review after the chat loop, fix 1; Later 3 and 4). After
// "Don't stop anything.", the carry-on turn of the next request (whether a budget or an operation's end starts it)
// still runs nothing that stops a model: a saved workflow that stops one stays a button, and a start that only fits by
// stopping one is refused. A reply that read outside text (a container's log) makes its carry-on turns as strict:
// `remember` with a line partly the owner's words, and `save_workflow`, are buttons there. A pressed "No" ends the
// carrying on, and so do disconnecting Telegram (a task started there) and signing out the device a task came from:
// no further carry-on turn runs. The brain here has a context of 1,000 tokens (1,200 characters of tool output a
// message), so one long lookup ends a reply at the output budget and a task carries on in a fresh turn 3 seconds later.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, newChat, say, choose, chatMessages, waitFor, sleep, SLOW } from './lib.mjs';

const TG_TOKEN = '123456789:AAEtestTokenForSparkConsoleXYZ_abcdefghij', OWNER_TG = 5550001;
useFleet({ telegram: true, watchMs: 60000, env: { SPARK_CONSOLE_CONTINUE_MS: '3000', SPARK_CONSOLE_TELEGRAM_LIMITS: '1000,1000,1000' }, prepare: ({ dir, stateDir }) => {
  // (Telegram paired already; the brain's context small)
  mkdirSync(join(dir, 'secrets'), { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, 'secrets', 'secrets.json'), JSON.stringify({ telegram: { token: TG_TOKEN, bot: 'spark_test_bot', chatId: OWNER_TG, userId: OWNER_TG, name: 'Owner', pairedAt: new Date().toISOString() } }), { mode: 0o600 });
  const f = join(stateDir, 'main.json'), m = JSON.parse(readFileSync(f, 'utf8'));
  m.presets[m.current] = { ...m.presets[m.current], contextTokens: 1000 };
  writeFileSync(f, JSON.stringify(m), { mode: 0o600 });
} }, () => waitFor(async () => (await api('/telegram')).json.state === 'ok', { what: 'Telegram polling' }));

const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const noScript = () => rmSync(join(T.fleet.dir, 'model-script.json'), { force: true });
const esc = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CARRIED = '^\\[Spark Console\\] Your last reply stopped at the limit of one message';
const FINISHED = '^\\[Spark Console\\] What you started for the owner';
const QUIET = [{ match: CARRIED, calls: [] }, { match: FINISHED, calls: [] }];
const LONG = { name: 'workflows', arguments: {} };
const RADIX = 'sc-RadixArk--Qwen3.8-27B-NVFP4', GGUF = 'sc-testorg--Qwen3.8-27B-abliterated-GGUF';
const stateOf = (spark, name) => readFileSync(join(T.fleet.root, spark, '.mock', 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];
const operations = async () => (await api('/actions/recent_operations', { method: 'POST', body: { limit: 50 } })).json.operations;
const settled = () => waitFor(async () => { await sleep(2500); return !(await operations()).some(o => o.status === 'running'); }, { timeout: 180000 * SLOW, what: 'every operation to end' });
const save = async (title, steps) => { const r = await api('/actions/save_workflow', { method: 'POST', body: { title, steps } }); assert.equal(r.status, 200, r.text); };
const changes = async () => (await operations()).filter(o => ['stop', 'workflow-run', 'deploy'].includes(o.type));
const shown = m => JSON.stringify(m.map(x => [x.role, Boolean(x.auto), (x.tools || []).map(t => `${t.name}:${t.outcome || t.ok}`).join(','), String(x.content).slice(0, 90)]));
// The carry-on turn after a reply in this chat: Spark Console's line, then Sparkie's answer.
const carryOn = chat => waitFor(async () => { const x = await chatMessages(chat), i = x.findIndex(y => y.auto); return i > 0 && x[i + 1]?.role === 'assistant' && x[i + 1]; }, { timeout: 120000 * SLOW, what: 'the carry-on turn' });
const noCarryOn = async chat => { await sleep(7000 * SLOW); const m = await chatMessages(chat); assert.equal(m.filter(x => x.auto).length, 0, `no carry-on turn: ${shown(m)}`); };
const BUDGET_END = /\nCarrying on with your request in a fresh turn\.$/;

test('a start that only fits by stopping a model is refused in the carry-on turn too', { timeout: 400000 * SLOW }, async () => {
  assert.equal(stateOf('spark3', GGUF), 'running');
  const words = 'start gemma-3-12b-it on spark 3, then tell me how fast it is', START = { name: 'start_model', arguments: { model: 'gemma-3-12b-it', spark: 'spark3' } };
  script([{ match: '^Don.t stop anything\\.$', calls: [] }, { match: `^${esc(words)}$`, rounds: [[START], [LONG]] }, { match: CARRIED, rounds: [[START]] }, { match: FINISHED, calls: [] }]);
  try {
    const before = (await changes()).length, chat = await newChat();
    await say(chat, 'Don’t stop anything.');
    const r = await say(chat, words);
    assert.equal(r.message.tools[0].ok, false, r.text);
    assert.match(r.text, BUDGET_END, r.text.slice(-300));
    const next = await carryOn(chat);
    script(QUIET);
    assert.deepEqual(next.tools.map(t => [t.name, t.ok]), [['start_model', false]], shown(await chatMessages(chat)));
    await settled();
    assert.equal(stateOf('spark3', GGUF), 'running', 'the owner said not to stop anything');
    assert.equal((await changes()).length, before, 'nothing was stopped or started');
  } finally { noScript(); }
});

test('“don’t stop anything”, then a task whose reply reaches a budget: its carry-on turn still offers the saved workflow that stops a model as a button, and the model runs', { timeout: 400000 * SLOW }, async () => {
  await save('night mode', [{ action: 'stop_model', args: { spark: 'spark4', container: RADIX } }]);
  assert.equal(stateOf('spark4', RADIX), 'running');
  const before = (await changes()).length, words = 'run night mode, then tell me how it went', chat = await newChat(), RUN = { name: 'run_workflow', arguments: { name: 'night mode' } };
  script([{ match: '^Don.t stop anything\\.$', calls: [] }, { match: `^${words}$`, rounds: [[RUN], [LONG]] }, { match: CARRIED, rounds: [[RUN]] }, { match: FINISHED, calls: [] }]);
  try {
    await say(chat, 'Don’t stop anything.');
    const r = await say(chat, words);
    assert.deepEqual(r.message.tools.map(t => [t.name, t.outcome ?? null]), [['run_workflow', 'needs-ok'], ['workflows', null]], r.text);
    assert.match(r.text, BUDGET_END, r.text.slice(-300));
    const next = await carryOn(chat);
    script(QUIET);
    assert.deepEqual(next.tools.map(t => [t.name, t.outcome]), [['run_workflow', 'needs-ok']], shown(await chatMessages(chat)));
    await settled();
    assert.equal(stateOf('spark4', RADIX), 'running', 'the owner said not to stop anything');
    assert.equal((await changes()).length, before, 'no saved workflow ran and nothing was stopped');
  } finally { noScript(); }
});

test('the same when an operation’s end starts the carry-on turn', { timeout: 600000 * SLOW }, async () => {
  await save('morning mode', [{ action: 'stop_model', args: { spark: 'spark3', container: GGUF } }]);
  assert.equal(stateOf('spark3', GGUF), 'running');
  const FIND = { name: 'find_setups', arguments: { model: 'glm-5.3-flash' } }, words = 'refresh the setups for glm-5.3-flash, then run morning mode';
  script([{ match: '^Don.t stop anything\\.$', calls: [] }, { match: `^${esc(words)}$`, rounds: [[FIND, { name: 'run_workflow', arguments: { name: 'morning mode' } }]] },
    { match: `${FINISHED}.*run morning mode`, rounds: [[{ name: 'run_workflow', arguments: { name: 'morning mode' } }]] }, { match: CARRIED, calls: [] }]);
  try {
    const before = (await changes()).length, chat = await newChat();
    await say(chat, 'Don’t stop anything.');
    const r = await say(chat, words);
    assert.deepEqual(r.message.tools.map(t => [t.name, t.outcome]), [['find_setups', 'started'], ['run_workflow', 'needs-ok']], r.text);
    const m = await waitFor(async () => { const x = await chatMessages(chat), i = x.findIndex(y => y.auto); return i > 0 && x[i + 1]?.role === 'assistant' && [x[i], x[i + 1]]; }, { timeout: 240000 * SLOW, what: 'the carry-on turn after the lookup ended' });
    script(QUIET);
    assert.match(m[0].content, new RegExp(FINISHED), 'the carry-on turn an operation’s end starts');
    assert.deepEqual(m[1].tools.map(t => [t.name, t.outcome]), [['run_workflow', 'needs-ok']], shown(await chatMessages(chat)));
    await settled();
    assert.equal(stateOf('spark3', GGUF), 'running', 'the owner said not to stop anything');
    assert.equal((await changes()).length, before, 'no saved workflow ran and nothing was stopped');
  } finally { noScript(); }
});

test('a reply that read a container’s log makes its carry-on turn as strict: a memory line partly the owner’s words and a saved workflow are buttons there', { timeout: 400000 * SLOW }, async () => {
  const words = 'read the log of qwen-recipe-chisel on spark 3, then save a workflow called chisel check and tell me why the chisel recipe runs slow';
  const LOGS = { name: 'container_logs', arguments: { spark: 'spark3', container: 'qwen-recipe-chisel' } };
  // (four of its seven words are the owner's: enough with no outside text read, not after it)
  const LINE = 'The chisel recipe runs slow when its cache is cold on weekdays';
  script([{ match: `^${esc(words)}$`, rounds: [[LOGS], [LONG]] }, { match: CARRIED, rounds: [[{ name: 'remember', arguments: { text: LINE, kind: 'fact' } },
    { name: 'save_workflow', arguments: { title: 'chisel check', steps: [{ action: 'should_be_running', args: {} }] } }]] }, { match: FINISHED, calls: [] }]);
  try {
    const chat = await newChat(), r = await say(chat, words);
    assert.match(r.text, BUDGET_END, r.text.slice(-300));
    const next = await carryOn(chat);
    script(QUIET);
    // (a button each: the owner presses it, or not)
    assert.deepEqual(next.tools.map(t => [t.name, ['needs-ok', 'question'].includes(t.outcome)]), [['remember', true], ['save_workflow', true]], shown(await chatMessages(chat)));
    assert.ok(!(await api('/actions/memory', { method: 'POST', body: {} })).json.entries.some(e => e.text === LINE), 'no line kept');
    assert.ok(!(await api('/actions/workflows', { method: 'POST', body: {} })).json.saved.some(w => w.title === 'chisel check'), 'no workflow saved');
  } finally { noScript(); }
});

test('a pressed “No” ends the carrying on', { timeout: 300000 * SLOW }, async () => {
  // (erasing a memory line for good is always a question, with a No)
  const made = await api('/actions/remember', { method: 'POST', body: { text: 'The rack in the hall opens with code 7731', kind: 'fact' } });
  assert.equal(made.json?.outcome, 'remembered', made.text);
  const words = 'erase the line about the rack code for good, then tell me what is left', chat = await newChat();
  script([{ match: `^${esc(words)}$`, rounds: [[{ name: 'forget_memory', arguments: { id: made.json.id, erase: true } }], [LONG]] }, ...QUIET]);
  try {
    const r = await say(chat, words);
    assert.match(r.text, BUDGET_END, r.text.slice(-300));
    const no = r.message.choices?.find(c => /^No\b/.test(c.label));
    assert.ok(no, JSON.stringify(r.message.choices));
    const pressed = await choose(chat, no.id);
    assert.equal(pressed.status, 200, pressed.text);
    await noCarryOn(chat);
  } finally {
    noScript();
    await api('/actions/forget_memory', { method: 'POST', body: { id: made.json.id, erase: true } });
  }
});

// The paired Telegram chat (stand-in Bot API).
const tgPost = async (p, body) => (await fetch(`http://127.0.0.1:${T.fleet.telegramPort}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
let msgId = 900;
const tgSay = text => tgPost('/__push', { message: { message_id: msgId++, date: Math.floor(Date.now() / 1000), chat: { id: OWNER_TG, type: 'private' }, from: { id: OWNER_TG, is_bot: false, first_name: 'Owner' }, text } });
const tgChat = async () => (await api('/chats')).json.chats.find(c => c.channel === 'telegram');

test('disconnecting Telegram ends a task started there: no further carry-on turn runs', { timeout: 300000 * SLOW }, async () => {
  const words = 'read the workflows, then tell me which one stops a model';
  script([{ match: `^${esc(words)}$`, rounds: [[LONG]] }, ...QUIET]);
  try {
    await tgSay(words);
    const chat = await waitFor(async () => { const c = await tgChat(); if (!c) return null; const m = await chatMessages(c.id); return m.some(x => x.role === 'assistant' && BUDGET_END.test(x.content)) && c.id; }, { timeout: 120000 * SLOW, what: 'the reply on Telegram' });
    const off = await api('/telegram', { method: 'DELETE' });
    assert.equal(off.status, 200, off.text);
    await noCarryOn(chat);
  } finally { noScript(); }
});

// A device signed in over the internet with a recovery code (there is no passkey on this fleet).
const FUNNEL = { 'tailscale-funnel-request': '?1', 'x-forwarded-for': '203.0.113.44' };
const cookieOf = r => /^sc_session=(scs_[A-Za-z0-9_-]{43});/.exec(String(r.headers['set-cookie'] || r.headers.get?.('set-cookie') || ''))?.[1] || null;

test('signing out the device a task came from ends that task: no further carry-on turn runs', { timeout: 300000 * SLOW }, async () => {
  const codes = await api('/auth/recovery', { method: 'POST', body: {} });
  assert.equal(codes.status, 200, codes.text);
  const signed = await api('/auth/signin/recovery', { method: 'POST', body: { code: codes.json.codes[0], name: 'Phone' }, headers: FUNNEL });
  assert.equal(signed.status, 200, signed.text);
  const cookie = cookieOf(signed), away = { ...FUNNEL, cookie: `sc_session=${cookie}` };
  assert.ok(cookie, JSON.stringify(signed.headers));
  const words = 'read the workflows again, then tell me which one stops a model';
  script([{ match: `^${esc(words)}$`, rounds: [[LONG]] }, ...QUIET]);
  try {
    const made = await api('/chats', { method: 'POST', body: {}, headers: away });
    assert.equal(made.status, 201, made.text);
    const chat = made.json.id;
    const sent = await api(`/chats/${chat}/messages`, { method: 'POST', body: { text: words }, headers: away });
    assert.equal(sent.status, 200, sent.text);
    assert.match(sent.text, /Carrying on with your request in a fresh turn\./);
    const out = await api('/auth/signout', { method: 'POST', body: {}, headers: away });
    assert.equal(out.status, 200, out.text);
    await noCarryOn(chat);
  } finally { noScript(); }
});
