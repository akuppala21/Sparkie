// Covers: Long tasks (design E 2.1 as cut, step 6; R66), second and third pieces (E6b, E6c): a job's end wakes the task
// it was started for, as an operation's result does, and the task waits for it (the carry-on turn after the start owes
// the job's end); a task that reaches its limit of carry-on turns stops, its last reply says how to go on and carries
// the mark, and it stands as one needs-you line until the owner writes there; "go on", as that reply says, gives it a
// fresh budget of the same size. A carry-on turn the brain never answers, or one that can't start while four answers
// are coming, isn't counted and is tried again (the failed try's lines give way to the next one's). Started on
// Telegram, its initial continuation, final reply and stop line reach the phone exactly once without a result quota. With no eval on record, a carry-on turn's own change is a button too. A reply that offered a button parks its task (contract 4.8): no carry-on turn by itself, its hours
// stop, one needs-you line; a press that runs the button wakes it with that time given back. The brain here has a
// context of 1,000 tokens, so one long lookup ends a reply at the output budget and a task carries on in a fresh turn
// 1.5 seconds later. The round limit is a budget as the steps and the output are (R50): a task's carry-on turn the
// rounds end at its own limit of turns stops with the mark (a fleet of its own, the task seeded one turn from it); so
// does one the brain's token budget ends (a setup with a tokenBudget, the stand-in brain counting more).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, newChat, say, choose, chatMessages, waitFor, sleep, SLOW } from './lib.mjs';
import { startMock } from './start-mock.mjs';

const TG_TOKEN = '123456789:AAEtestTokenForSparkConsoleXYZ_abcdefghij', OWNER_TG = 5550001;
// Telegram paired; legacy result-limit settings must not suppress any result that the task sends.
useFleet({ telegram: true, watchMs: 3000, env: { SPARK_CONSOLE_CONTINUE_MS: '1500', SPARK_CONSOLE_TASK_RETRY_MS: '3000', SPARK_CONSOLE_TELEGRAM_LIMITS: '20,20,1' }, prepare: ({ dir, stateDir }) => {
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
const LONG = { name: 'workflows', arguments: {} };
const containers = spark => join(T.fleet.root, spark, '.mock', 'containers');
const setState = (spark, name, state, status) => writeFileSync(containers(spark), readFileSync(containers(spark), 'utf8').replace(new RegExp(`^${name}\\|[^|]*\\|[^|]*\\|`, 'm'), `${name}|${state}|${status}|`));
const taskOf = id => JSON.parse(readFileSync(join(T.fleet.stateDir, 'chats.json'), 'utf8')).conversations.find(c => c.id === id)?.task ?? null;
const needs = async () => (await api('/actions/fleet_status', { method: 'POST', body: {} })).json.needsOwner;
const autos = async chat => (await chatMessages(chat)).filter(m => m.auto).length;
// (the stop's line, as Telegram gets it)
const STOPPED = /^Stopped carrying on with your request: it reached its 8 carry-on turns\. What is already running finishes, and its result comes here\. Say “carry on” for another 2 hours and 8 turns\.$/;

test('a job’s end wakes the task it was started for', { timeout: 300000 * SLOW }, async () => {
  // ("print(42)" a whole word, as the owner typed it: a new image's command words are checked, appNamed, 21-apps.mjs)
  const words = 'Run python:3.12-slim once as tally-job on Spark 4: python3 -c print(42) and then tell me what it wrote';
  script([{ match: '^run python:3\\.12-slim once as tally-job', calls: [{ name: 'keep_running', arguments: { spark: 'spark4', container: 'tally-job', image: 'python:3.12-slim', once: true, command: ['python3', '-c', 'print(42)'] } }] },
    { match: FINISHED, calls: [] }, { match: CARRIED, calls: [] }]);
  try {
    const chat = await newChat(), r = await say(chat, words);
    assert.deepEqual(r.message.tools.map(t => [t.name, t.outcome]), [['keep_running', 'started']], r.text);
    // The start's result wakes it once; then it waits for the job.
    await waitFor(async () => (await autos(chat)) === 1 && (await chatMessages(chat)).at(-1).role === 'assistant', { timeout: 120000 * SLOW, what: 'the carry-on turn after the start' });
    assert.ok(taskOf(chat), 'the task waits for the job');
    await waitFor(() => readFileSync(containers('spark4'), 'utf8').includes('tally-job|'), { what: 'the job’s container' });
    // (the watcher's first look at a Spark only learns what is there, so it must have seen the job running first)
    await waitFor(async () => ((await api('/actions/workloads', { method: 'POST', body: { spark: 'spark4' } })).json.workloads || []).some(w => w.name === 'tally-job' && w.state === 'running'), { timeout: 60000 * SLOW, what: 'the watcher seeing the job run' });
    setState('spark4', 'tally-job', 'exited', 'Exited (0) just now');
    const end = await waitFor(async () => (await chatMessages(chat)).find(m => m.notice && /^tally-job on Spark 4 finished\b/.test(m.content)), { timeout: 60000 * SLOW, what: 'the job’s end in its chat' });
    assert.equal(end.operation, undefined, 'a job’s end is no operation');
    await waitFor(async () => (await autos(chat)) === 2, { timeout: 60000 * SLOW, what: 'the carry-on turn after the job ended' });
    const m = await chatMessages(chat), at = m.findLastIndex(x => x.auto);
    assert.ok(at > m.indexOf(m.find(x => x.notice && x.jobEnd === 'tally-job')), 'it came after the job’s end');
    assert.match(m[at].content, new RegExp(FINISHED));
  } finally { noScript(); }
});

test('at its limit of turns a task stops, its last reply says how to go on and carries the mark, it stands as one needs line; “go on”, as that reply says, gives it a fresh budget of the same size', { timeout: 400000 * SLOW }, async () => {
  const words = 'read the workflows, then tell me which one stops a model', chat = await newChat();
  script([{ match: `^${esc(words)}$`, rounds: [[LONG]] }, { match: CARRIED, rounds: [[LONG]] }, { match: FINISHED, calls: [] }, { match: '^go on$', rounds: [[LONG]] }]);
  try {
    await say(chat, words);
    const stop = await waitFor(async () => (await chatMessages(chat)).find(m => m.stopped), { timeout: 300000 * SLOW, what: 'the stop at the limit' });
    // (the reply that reached it: no line of its own, so the chat reads as it did)
    assert.deepEqual([stop.role, stop.notice ?? null, stop.stopped], ['assistant', null, 'turns']);
    assert.match(stop.content, /\nSay “go on” to carry on\.$/, stop.content.slice(-200));
    await sleep(5000 * SLOW);
    assert.equal(await autos(chat), 8, 'eight carry-on turns, no more');
    assert.equal((await chatMessages(chat)).filter(m => m.stopped).length, 1, 'said once');
    // (E7: the task's report comes right after the stop, and nothing after it)
    const shown = await waitFor(async () => { const m = await chatMessages(chat); return m.at(-1)?.report ? m : null; }, { timeout: 30000 * SLOW, what: 'the report after the stop', every: 250 }), report = shown.at(-1);
    assert.deepEqual(shown.at(-2), stop, 'the stop, right before the report');
    assert.deepEqual([report.role, report.notice, typeof report.report, report.stopped ?? null], ['assistant', true, 'string', null]);
    assert.equal(report.content.split('\n')[0], `Report on your request “${words}”: stopped at its 8 carry-on turns.`);
    assert.equal(report.content.split('\n').at(-1), 'It stopped at its 8 carry-on turns: say “carry on” for another 2 hours and 8 turns.');
    await sleep(5000 * SLOW);
    assert.equal((await chatMessages(chat)).length, shown.length, 'nothing after it');
    assert.deepEqual((await needs()).filter(l => /^Sparkie stopped carrying on/.test(l)), ['Sparkie stopped carrying on with one of your requests at its limit (turns). Say “carry on” in that chat to go on, or anything else to leave it.']);
    // "go on", as the reply says: the same request, a fresh 2 hours and 8 turns; the line goes.
    const before = taskOf(chat);
    const again = await say(chat, 'go on');
    assert.ok(again.text, again.text);
    const t = taskOf(chat);
    assert.ok(t, 'the same request is carried on');
    assert.deepEqual([t.request, t.continuations, t.steps, t.stopped ?? null, t.hours, t.turns], [before.request, 0, 0, null, 2, 8]);
    assert.ok(t.at > before.at, 'its hours start again');
    assert.deepEqual((await needs()).filter(l => /^Sparkie stopped carrying on/.test(l)), []);
  } finally { noScript(); await api(`/chats/${chat}/messages`, { method: 'POST', body: { text: '/stop' } }); }
});

test('a carry-on turn the brain never answers, or one that can’t start while four answers are coming, isn’t counted and is tried again', { timeout: 400000 * SLOW }, async () => {
  const hung = join(T.fleet.root, 'spark2', '.mock', 'brain-hung');
  const words = 'read the workflows twice, then tell me which one stops a model', words2 = 'read the workflows thrice, then tell me which one stops a model';
  const [chat, chat2, ...four] = await Promise.all(Array.from({ length: 6 }, () => newChat()));
  script([{ match: `^${esc(words)}$`, rounds: [[LONG]] }, { match: `^${esc(words2)}$`, rounds: [[LONG]] }, { match: CARRIED, calls: [] }, { match: '^answer slowly', calls: [] }]);
  try {
    // The brain stops answering as the reply ends: the carry-on turn fails before a word.
    await say(chat, words);
    writeFileSync(hung, '');
    const t = await waitFor(() => (taskOf(chat)?.retries >= 1) && taskOf(chat), { timeout: 60000 * SLOW, every: 200, what: 'the try the brain never answered' });
    assert.equal(t.continuations, 0, 'not counted');
    let m = await chatMessages(chat);
    assert.deepEqual([m.filter(x => x.auto).length, Boolean(m.at(-1).error)], [1, true], 'the try is in the chat, with its error');
    // It answers again: the next try runs, and the failed one's lines gave way to it.
    rmSync(hung, { force: true });
    await waitFor(async () => { const x = await chatMessages(chat); return x.at(-1).role === 'assistant' && !x.at(-1).error && x.at(-2)?.auto; }, { timeout: 120000 * SLOW, what: 'the try that ran' });
    m = await chatMessages(chat);
    assert.deepEqual([m.filter(x => x.auto).length, m.filter(x => x.error).length], [1, 0]);
    // Four answers already coming: the carry-on turn can't start; not counted, and it runs once one is free.
    await say(chat2, words2);
    const slow = four.map(c => say(c, 'answer slowly, take 12 seconds'));
    const t2 = await waitFor(() => (taskOf(chat2)?.retries >= 1) && taskOf(chat2), { timeout: 30000 * SLOW, every: 200, what: 'the try that couldn’t start' });
    assert.equal(t2.continuations, 0, 'not counted');
    assert.equal((await chatMessages(chat2)).filter(x => x.auto).length, 0, 'nothing of it in the chat');
    await Promise.all(slow);
    await waitFor(async () => { const x = await chatMessages(chat2); return x.at(-1).role === 'assistant' && x.at(-2)?.auto; }, { timeout: 120000 * SLOW, what: 'the carry-on turn once an answer was free' });
  } finally { rmSync(hung, { force: true }); noScript(); }
});

// E6c (contract 4.8): a reply that offered a button parks its task.
const WAITING = 'Sparkie is waiting for your answer to a question in one of your chats before it carries on with your request. Press a button there, say “carry on” to be asked again, or anything else to leave it.';
test('a task waits at a button: no carry-on turn by itself, its hours stop, one needs line; a press that runs the button wakes it, with the time it waited given back', { timeout: 300000 * SLOW }, async () => {
  const saved = await api('/actions/save_workflow', { method: 'POST', body: { title: 'list check', steps: [{ action: 'should_be_running', args: {} }] } });
  assert.equal(saved.status, 200, saved.text);
  // (not every word of its name is in these words, so the saved workflow is a button)
  const words = 'run the list one, then tell me what it says', chat = await newChat();
  // (its carry-on turns read on, so the task is still there to look at after the first; /stop ends it)
  script([{ match: `^${esc(words)}$`, rounds: [[{ name: 'run_workflow', arguments: { name: 'list check' } }], [LONG]] }, { match: CARRIED, rounds: [[LONG]] }, { match: FINISHED, rounds: [[LONG]] }]);
  try {
    const r = await say(chat, words);
    assert.deepEqual(r.message.tools.map(t => [t.name, t.outcome ?? null]), [['run_workflow', 'needs-ok'], ['workflows', null]], r.text);
    const parked = taskOf(chat);
    assert.ok(parked?.parked, JSON.stringify(parked));
    await sleep(7000 * SLOW);
    assert.equal(await autos(chat), 0, 'no carry-on turn while it waits');
    assert.deepEqual((await needs()).filter(l => l === WAITING), [WAITING]);
    const yes = r.message.choices.find(c => c.label.startsWith('Run'));
    assert.ok(yes, JSON.stringify(r.message.choices));
    const pressed = await choose(chat, yes.id);
    assert.equal(pressed.status, 200, pressed.text);
    await waitFor(async () => (await autos(chat)) >= 1 && (await chatMessages(chat)).at(-1).role === 'assistant', { timeout: 120000 * SLOW, what: 'the carry-on turn after the press' });
    const t = taskOf(chat);
    assert.ok(t, 'it carries on');
    assert.equal(t.parked ?? null, null);
    assert.ok(Date.parse(t.at) - Date.parse(parked.at) >= 7000, `the hours it waited are given back: ${parked.at} → ${t.at}`);
    assert.deepEqual((await needs()).filter(l => l === WAITING), []);
  } finally { noScript(); await api(`/chats/${chat}/messages`, { method: 'POST', body: { text: '/stop' } }); }
});

// The coordinator's ruling (contract 4.8 for the first step too): with no eval on record every change Sparkie makes is a
// button, and a request with a next step still carries on once the owner presses it.
// (a stop, not a restart: the stand-in answers a restart of a running model with "already", which runs nothing)
test('with no eval on record, a request with a next step whose first change is a button is a task parked there: the press runs it, the carry-on turn reports, and nothing else changed without a button', { timeout: 300000 * SLOW }, async () => {
  const RADIX = 'sc-RadixArk--Qwen3.8-27B-NVFP4', words = `stop ${RADIX} on spark 4, then tell me how it went`;
  // (its brain up a minute already, so the first reply finds it answering)
  const F = await startMock({ watchMs: 60000, evalOnRecord: false, env: { SPARK_CONSOLE_CONTINUE_MS: '1500' }, prepare: ({ root }) => writeFileSync(join(root, 'spark2', '.mock', 'up-sparkie-main'), String(Math.floor(Date.now() / 1000) - 60)) });
  try {
    writeFileSync(join(F.dir, 'model-script.json'), JSON.stringify([{ match: `^${esc(words)}$`, calls: [{ name: 'stop_model', arguments: { spark: 'spark4', container: RADIX } }] }, { match: FINISHED, calls: [] }]));
    const post = async (path, body) => { const r = await fetch(`${F.base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-spark-console': '1', origin: F.origin }, body: JSON.stringify(body) }); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {} return { status: r.status, text, json }; };
    const messages = async id => (await (await fetch(`${F.base}/chats/${id}`)).json()).messages;
    const ops = async () => (await post('/actions/recent_operations', { limit: 50 })).json.operations;
    const taskIn = id => JSON.parse(readFileSync(join(F.stateDir, 'chats.json'), 'utf8')).conversations.find(c => c.id === id)?.task ?? null;
    const chat = (await post('/chats', {})).json.id;
    const asked = await post(`/chats/${chat}/messages`, { text: words });
    assert.equal(asked.status, 200, asked.text);
    const done = asked.text.split('\n\n').map(x => x.trim()).filter(x => x.startsWith('data:')).map(x => JSON.parse(x.slice(5))).find(e => e.type === 'done').message;
    assert.deepEqual(done.tools.map(t => [t.name, t.outcome]), [['stop_model', 'needs-ok']], done.content);
    const buttons = done.choices.filter(c => c.label !== 'No');
    assert.equal(buttons.length, 1, JSON.stringify(done.choices));
    const t = taskIn(chat);
    assert.deepEqual([t?.request, Boolean(t?.parked)], [words, true], JSON.stringify(t));
    assert.deepEqual((await post('/actions/fleet_status', {})).json.needsOwner.filter(l => l === WAITING), [WAITING]);
    assert.equal((await ops()).length, 0, 'nothing ran before the press');
    // The owner presses it: the stop runs, its result comes, and the carry-on turn reports.
    const pressed = await post(`/chats/${chat}/choose`, { choice: buttons[0].id });
    assert.equal(pressed.status, 200, pressed.text);
    assert.equal(pressed.json.outcome, 'started', pressed.text);
    const m = await waitFor(async () => { const x = await messages(chat), i = x.findIndex(y => y.auto); return i > 0 && x[i + 1]?.role === 'assistant' && x; }, { timeout: 180000 * SLOW, what: 'the carry-on turn after the stop' });
    const at = m.findIndex(y => y.auto);
    assert.match(m[at].content, new RegExp(FINISHED));
    assert.ok(m.slice(0, at).some(y => y.notice && y.operation && y.status === 'completed'), 'after the stop’s result');
    assert.deepEqual(m[at + 1].tools ?? [], [], 'the report changed nothing');
    assert.equal((await ops()).length, 1, `one change, the one pressed: ${JSON.stringify((await ops()).map(o => o.type))}`);
    await waitFor(() => taskIn(chat) === null, { timeout: 15000 * SLOW, what: 'the done request off the record' });
  } finally { await F.stop(); }
});

// (final read TE-12: the carry-on turn after the press asks for a change the owner's words make clear, "everything on spark
// 3", which a checked brain would run at once; with no eval on record it is a button too, and nothing more runs)
test('with no eval on record, a carry-on turn’s own change is a button too: after the pressed stop, the second stop the words make clear waits for its own press', { timeout: 300000 * SLOW }, async () => {
  const RADIX = 'sc-RadixArk--Qwen3.8-27B-NVFP4', GGUF = 'sc-testorg--Qwen3.8-27B-abliterated-GGUF', words = `stop ${RADIX} on spark 4, then stop everything on spark 3`;
  const F = await startMock({ watchMs: 60000, evalOnRecord: false, env: { SPARK_CONSOLE_CONTINUE_MS: '1500' }, prepare: ({ root }) => writeFileSync(join(root, 'spark2', '.mock', 'up-sparkie-main'), String(Math.floor(Date.now() / 1000) - 60)) });
  try {
    writeFileSync(join(F.dir, 'model-script.json'), JSON.stringify([{ match: `^${esc(words)}$`, calls: [{ name: 'stop_model', arguments: { spark: 'spark4', container: RADIX } }] },
      { match: FINISHED, calls: [{ name: 'stop_model', arguments: { spark: 'spark3', container: GGUF } }] }]));
    const post = async (path, body) => { const r = await fetch(`${F.base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-spark-console': '1', origin: F.origin }, body: JSON.stringify(body) }); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {} return { status: r.status, text, json }; };
    const messages = async id => (await (await fetch(`${F.base}/chats/${id}`)).json()).messages;
    const ops = async () => (await post('/actions/recent_operations', { limit: 50 })).json.operations;
    const taskIn = id => JSON.parse(readFileSync(join(F.stateDir, 'chats.json'), 'utf8')).conversations.find(c => c.id === id)?.task ?? null;
    const state = (spark, name) => readFileSync(join(F.root, spark, '.mock', 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];
    const chat = (await post('/chats', {})).json.id;
    const asked = await post(`/chats/${chat}/messages`, { text: words });
    const done = asked.text.split('\n\n').map(x => x.trim()).filter(x => x.startsWith('data:')).map(x => JSON.parse(x.slice(5))).find(e => e.type === 'done').message;
    assert.deepEqual(done.tools.map(t => [t.name, t.outcome]), [['stop_model', 'needs-ok']], done.content);
    const pressed = await post(`/chats/${chat}/choose`, { choice: done.choices.find(c => c.label !== 'No').id });
    assert.equal(pressed.json?.outcome, 'started', pressed.text);
    const m = await waitFor(async () => { const x = await messages(chat), i = x.findIndex(y => y.auto); return i > 0 && x[i + 1]?.role === 'assistant' && x; }, { timeout: 180000 * SLOW, what: 'the carry-on turn after the stop' });
    const reply = m[m.findIndex(y => y.auto) + 1];
    assert.deepEqual((reply.tools ?? []).map(t => [t.name, t.outcome]), [['stop_model', 'needs-ok']], reply.content);
    assert.equal((await ops()).length, 1, `only the change pressed ran: ${JSON.stringify((await ops()).map(o => o.type))}`);
    assert.equal(state('spark3', GGUF), 'running', 'the second model still runs');
    assert.equal(Boolean(taskIn(chat)?.parked), true, 'the task waits at its new button');
  } finally { await F.stop(); }
});

// The paired Telegram chat (stand-in Bot API).
const tgPost = async (p, body) => (await fetch(`http://127.0.0.1:${T.fleet.telegramPort}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const tgSent = () => { const f = join(T.fleet.dir, 'telegram-calls.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(c => c.method === 'sendMessage').map(c => String(c.body?.text || '')) : []; };
let msgId = 700;
const tgSay = text => tgPost('/__push', { message: { message_id: msgId++, date: Math.floor(Date.now() / 1000), chat: { id: OWNER_TG, type: 'private' }, from: { id: OWNER_TG, is_bot: false, first_name: 'Owner' }, text } });

test('from Telegram, the initial continuation, final reply and stop arrive exactly once without a result quota', { timeout: 400000 * SLOW }, async () => {
  const words = 'read the workflows from here, then tell me which one stops a model', from = tgSent().length;
  script([{ match: `^${esc(words)}$`, rounds: [[LONG]] }, { match: CARRIED, rounds: [[LONG]] }, { match: FINISHED, calls: [] }]);
  try {
    await tgSay(words);
    const got = await waitFor(() => { const s = tgSent().slice(from); return s.some(x => STOPPED.test(x)) && s.some(x => /Say “go on” to carry on/.test(x)) && s; }, { timeout: 300000 * SLOW, what: 'the last reply and the stop on Telegram' });
    assert.equal(got.filter(x => /Carrying on with your request in a fresh turn/.test(x)).length, 1, 'the initial continuation reaches the owner once');
    assert.equal(got.filter(x => STOPPED.test(x)).length, 1, 'one stop line');
    assert.equal(got.filter(x => /Say “go on” to carry on/.test(x)).length, 1, 'one final reply');
    const chat = (await api('/chats')).json.chats.find(x => x.channel === 'telegram');
    const messages = await chatMessages(chat.id);
    const last = messages.findLast(x => x.stopped);
    assert.ok(last && got.includes(last.content), 'the exact saved final reply reaches Telegram');
  } finally { noScript(); }
});

// R50 (the rounds' follow-up of the final read): a carry-on turn the round limit ends, at its task's own limit of turns,
// stops the task with the mark on its reply, as the steps and the output do; it is not taken as done.
test('a task the round limit ends at its own limit of turns stops with the mark on its reply, and is not taken as done', { timeout: 240000 * SLOW }, async () => {
  const words = 'look around the fleet, then tell me what you found', chat = 'sc_50500000000000a1', id = 'j_505000000001', at = new Date(Date.now() - 60000).toISOString();
  // (eight rounds of lookups scripted: as many as a brain not checked may take; a checked one's six end it sooner)
  const F = await startMock({ watchMs: 60000, env: { SPARK_CONSOLE_CONTINUE_MS: '300', SPARK_CONSOLE_TASKS_AFTER_MS: '1000', SPARK_CONSOLE_TASK_RETRY_MS: '2000' }, prepare: ({ dir, root, stateDir }) => {
    writeFileSync(join(root, 'spark2', '.mock', 'up-sparkie-main'), String(Math.floor(Date.now() / 1000) - 60));
    writeFileSync(join(stateDir, 'chats.json'), JSON.stringify({ conversations: [{ id: chat, login: 'owner@test', title: 'rounds', spark: null, createdAt: at, updatedAt: at,
      messages: [{ role: 'user', content: words, createdAt: at }, { role: 'assistant', content: 'Looked at some of it.\nCarrying on with your request in a fresh turn.', createdAt: at }],
      task: { id, since: at, request: words, at, continuations: 7, hours: 2, turns: 8, carry: true } }] }), { mode: 0o600 });
    writeFileSync(join(dir, 'model-script.json'), JSON.stringify([{ match: CARRIED, rounds: Array(8).fill([{ name: 'guide', arguments: { tools: 'past' } }]) }]));
  } });
  try {
    const messages = async () => (await (await fetch(`${F.base}/chats/${chat}`)).json()).messages;
    const m = await waitFor(async () => { const x = await messages(), i = x.findIndex(y => y.auto); return i > 0 && x[i + 1]?.role === 'assistant' && x; }, { timeout: 120000, what: 'the carry-on turn' });
    const reply = m[m.findIndex(y => y.auto) + 1];
    assert.match(reply.content, /Stopped here: one message may take \d+ rounds of tools, and this one has\./, reply.content.slice(-400));
    assert.equal(reply.stopped, 'turns', reply.content.slice(-400));
    const t = JSON.parse(readFileSync(join(F.stateDir, 'chats.json'), 'utf8')).conversations.find(c => c.id === chat)?.task;
    assert.equal(t?.stopped, 'turns', JSON.stringify(t));
  } finally { await F.stop(); }
});

// R50 (the tokens' follow-up): a carry-on turn the brain's token budget ends, at its task's own limit of turns, stops the
// task with the mark on its reply, as the other budgets do. The setup's budget is 4,000 tokens, and the stand-in brain
// counts 5,000 for each answer (model-habits.json usage): one round of tools, then the last.
test('a task the token budget ends at its own limit of turns stops with the mark on its reply, and is not taken as done', { timeout: 240000 * SLOW }, async () => {
  const words = 'look over the fleet, then tell me what you found', chat = 'sc_50500000000000b1', id = 'j_505000000002', at = new Date(Date.now() - 60000).toISOString();
  const F = await startMock({ watchMs: 60000, env: { SPARK_CONSOLE_CONTINUE_MS: '300', SPARK_CONSOLE_TASKS_AFTER_MS: '1000', SPARK_CONSOLE_TASK_RETRY_MS: '2000' }, prepare: ({ dir, root, stateDir }) => {
    writeFileSync(join(root, 'spark2', '.mock', 'up-sparkie-main'), String(Math.floor(Date.now() / 1000) - 60));
    const f = join(stateDir, 'main.json'), main = JSON.parse(readFileSync(f, 'utf8'));
    main.presets[main.current] = { ...main.presets[main.current], tokenBudget: 4000 };
    writeFileSync(f, JSON.stringify(main), { mode: 0o600 });
    writeFileSync(join(dir, 'model-habits.json'), JSON.stringify({ usage: 5000 }));
    writeFileSync(join(stateDir, 'chats.json'), JSON.stringify({ conversations: [{ id: chat, login: 'owner@test', title: 'tokens', spark: null, createdAt: at, updatedAt: at,
      messages: [{ role: 'user', content: words, createdAt: at }, { role: 'assistant', content: 'Looked at some of it.\nCarrying on with your request in a fresh turn.', createdAt: at }],
      task: { id, since: at, request: words, at, continuations: 7, hours: 2, turns: 8, carry: true } }] }), { mode: 0o600 });
    writeFileSync(join(dir, 'model-script.json'), JSON.stringify([{ match: CARRIED, rounds: Array(3).fill([{ name: 'guide', arguments: { tools: 'past' } }]) }]));
  } });
  try {
    const messages = async () => (await (await fetch(`${F.base}/chats/${chat}`)).json()).messages;
    const m = await waitFor(async () => { const x = await messages(), i = x.findIndex(y => y.auto); return i > 0 && x[i + 1]?.role === 'assistant' && x; }, { timeout: 120000, what: 'the carry-on turn' });
    const reply = m[m.findIndex(y => y.auto) + 1];
    assert.match(reply.content, /Stopped here: one message may use 4,000 of the brain’s tokens \(what it reads and writes\), and this one has\./, reply.content.slice(-400));
    assert.equal(reply.stopped, 'turns', reply.content.slice(-400));
    const t = JSON.parse(readFileSync(join(F.stateDir, 'chats.json'), 'utf8')).conversations.find(c => c.id === chat)?.task;
    assert.equal(t?.stopped, 'turns', JSON.stringify(t));
  } finally { await F.stop(); }
});
