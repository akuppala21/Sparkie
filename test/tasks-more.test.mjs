// Covers: Long tasks (design E 2.1 as cut, step 6; R50), second piece (E6b): a job's end wakes the task it was started
// for, as an operation's result does, and the task waits for it (the carry-on turn after the start owes the job's end);
// a task that reaches its limit of carry-on turns stops, its last reply says how to go on and carries the mark, and it
// stands as one needs-you line until the owner writes there; "go on", as that reply says, gives it a fresh budget of the
// same size. A carry-on turn the brain never answers, or one that can't start while four answers are coming, isn't
// counted and is tried again (the failed try's lines give way to the next one's). Started on Telegram, its last reply
// and the stop line reach the phone even past the six results an hour, and the replies in between don't. The brain
// here has a context of 1,000 tokens, so one long lookup ends a reply at the output budget and a task carries on in a
// fresh turn 1.5 seconds later.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, newChat, say, chatMessages, waitFor, sleep, SLOW } from './lib.mjs';

const TG_TOKEN = '123456789:AAEtestTokenForSparkConsoleXYZ_abcdefghij', OWNER_TG = 5550001;
// (Telegram paired, with its usual limits: six results and carry-on lines an hour)
useFleet({ telegram: true, watchMs: 3000, env: { SPARK_CONSOLE_CONTINUE_MS: '1500', SPARK_CONSOLE_TASK_RETRY_MS: '3000' }, prepare: ({ dir, stateDir }) => {
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
    assert.deepEqual((await chatMessages(chat)).at(-1), stop, 'nothing after it');
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

// The paired Telegram chat (stand-in Bot API).
const tgPost = async (p, body) => (await fetch(`http://127.0.0.1:${T.fleet.telegramPort}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const tgSent = () => { const f = join(T.fleet.dir, 'telegram-calls.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(c => c.method === 'sendMessage').map(c => String(c.body?.text || '')) : []; };
let msgId = 700;
const tgSay = text => tgPost('/__push', { message: { message_id: msgId++, date: Math.floor(Date.now() / 1000), chat: { id: OWNER_TG, type: 'private' }, from: { id: OWNER_TG, is_bot: false, first_name: 'Owner' }, text } });

test('from Telegram, a task’s last reply and its stop reach the phone past six results an hour; the replies in between don’t', { timeout: 400000 * SLOW }, async () => {
  const words = 'read the workflows from here, then tell me which one stops a model', from = tgSent().length;
  script([{ match: `^${esc(words)}$`, rounds: [[LONG]] }, { match: CARRIED, rounds: [[LONG]] }, { match: FINISHED, calls: [] }]);
  try {
    await tgSay(words);
    const got = await waitFor(() => { const s = tgSent().slice(from); return s.some(x => STOPPED.test(x)) && s.some(x => /Say “go on” to carry on/.test(x)) && s; }, { timeout: 300000 * SLOW, what: 'the last reply and the stop on Telegram' });
    assert.ok(got.filter(x => /Carrying on with your request in a fresh turn/.test(x)).length <= 1, `the replies in between stay in Spark Console: ${JSON.stringify(got.map(x => x.slice(-80)))}`);
  } finally { noScript(); }
});
