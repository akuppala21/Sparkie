// Covers: Long tasks (design E 2.1 as cut, step 6; contract 4.8; R66), what wakes a task and what does not (the second
// read of E6, its fix and the coordinator's rulings). A job's end told while a carry-on turn of its task is still
// answering is carried on with once that turn ends, in a turn of its own (it came after the turn's own line, so the
// turn did not see it). A press on the button of a request the owner has moved on from runs its own change and wakes
// nothing: the newer request still waits at its own button. An agent's press in its own conversation runs its change
// and never wakes the owner's task waiting there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, newChat, say, choose, chatMessages, waitFor, sleep, createActKey, call, SLOW } from './lib.mjs';

useFleet({ watchMs: 3000, env: { SPARK_CONSOLE_CONTINUE_MS: '1500' } });

const FINISHED = '^\\[Spark Console\\] What you started for the owner';
// (a carry-on turn's line, whichever way it was woken)
const CARRY = '^\\[Spark Console\\] (?:What you started for the owner|The owner answered your question|Your last reply stopped at the limit)';
const esc = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const containers = spark => join(T.fleet.root, spark, '.mock', 'containers');
const setState = (spark, name, state, status) => writeFileSync(containers(spark), readFileSync(containers(spark), 'utf8').replace(new RegExp(`^${name}\\|[^|]*\\|[^|]*\\|`, 'm'), `${name}|${state}|${status}|`));
const taskOf = id => JSON.parse(readFileSync(join(T.fleet.stateDir, 'chats.json'), 'utf8')).conversations.find(c => c.id === id)?.task ?? null;
const requests = () => { const f = join(T.fleet.dir, 'model-requests.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return {}; } }) : []; };
const shown = m => JSON.stringify(m.map(x => [x.role, x.auto ? 'auto' : '', x.notice ? 'notice' : '', x.operation ? 'op' : x.jobEnd ? 'jobEnd' : '', String(x.content).slice(0, 50)]));
const RUN = name => ({ name: 'run_workflow', arguments: { name } });
const yesOf = message => (message.choices || []).filter(c => !/^No\b/.test(c.label));
const save = async title => { const r = await api('/actions/save_workflow', { method: 'POST', body: { title, steps: [{ action: 'should_be_running', args: {} }] } }); assert.equal(r.status, 200, `set-up: saving “${title}”: ${r.text}`); };
const stopIn = chat => api(`/chats/${chat}/messages`, { method: 'POST', body: { text: '/stop' } });
// (lets the answer that waits go on; the stand-in takes the file away as it does)
const go = () => writeFileSync(join(T.fleet.dir, 'go'), '');

test('a job’s end that comes while a carry-on turn of its task is still answering is carried on with when that turn ends', { timeout: 500000 * SLOW }, async () => {
  const words = 'Run python:3.12-slim once as during-job on Spark 4: python3 -c print(42) and then tell me what it wrote', ended = x => x.notice && x.jobEnd === 'during-job';
  script([{ match: '^run python:3\\.12-slim once as during-job', calls: [{ name: 'keep_running', arguments: { spark: 'spark4', container: 'during-job', image: 'python:3.12-slim', once: true, command: ['python3', '-c', 'print(42)'] } }] },
    // (a carry-on turn looks at the fleet, and its answer then waits until this test lets it go)
    { match: FINISHED, calls: [{ name: 'fleet_status', arguments: {} }], answerWhen: 'go' }]);
  const chat = await newChat();
  try {
    const r = await say(chat, words);
    assert.deepEqual(r.message.tools.map(t => [t.name, t.outcome]), [['keep_running', 'started']], `set-up: ${r.text}`);
    // The start's result wakes the first carry-on turn; it has looked, and its answer now waits.
    await waitFor(() => requests().some(x => new RegExp(FINISHED).test(String(x.words || '')) && x.round === 1), { timeout: 180000 * SLOW, what: 'set-up: the first carry-on turn, held before its answer' });
    await waitFor(() => readFileSync(containers('spark4'), 'utf8').includes('during-job|'), { what: 'set-up: the job’s container' });
    // (the watcher's first look at a Spark only learns what is there, so it must have seen the job running first)
    await waitFor(async () => ((await api('/actions/workloads', { method: 'POST', body: { spark: 'spark4' } })).json.workloads || []).some(w => w.name === 'during-job' && w.state === 'running'), { timeout: 60000 * SLOW, what: 'set-up: the watcher seeing the job run' });
    // The job ends while that turn is still answering: the watcher tells its end in the chat.
    setState('spark4', 'during-job', 'exited', 'Exited (0) just now');
    await waitFor(async () => (await chatMessages(chat)).some(ended), { timeout: 60000 * SLOW, what: 'set-up: the job’s end in its chat' });
    const during = await chatMessages(chat), line = during.findIndex(x => x.auto);
    assert.equal(during.filter(x => x.auto).length, 1, `set-up: one carry-on turn so far: ${shown(during)}`);
    assert.ok(during.findIndex(ended) > line && !during.slice(line + 1).some(x => x.role === 'assistant' && !x.notice), `set-up: the job’s end came inside that turn: ${shown(during)}`);
    // The turn is let go and ends; a second carry-on turn comes for the job's end (not held back).
    go();
    let second = false;
    for (const until = Date.now() + 60000 * SLOW; Date.now() < until && !second;) { go(); await sleep(1000); second = (await chatMessages(chat)).filter(x => x.auto).length >= 2; }
    const m = await chatMessages(chat);
    assert.ok(second, `no turn carried on with the job’s end; the task on disk: ${JSON.stringify(taskOf(chat))}. Chat: ${shown(m)}`);
    const at = m.findLastIndex(x => x.auto);
    assert.ok(at > m.findIndex(ended), `it came after the job’s end: ${shown(m)}`);
    assert.match(m[at].content, new RegExp(FINISHED));
  } finally { go(); script([]); await stopIn(chat); }
});

test('a press on the button of a request the owner has moved on from runs its change and wakes nothing: the newer request still waits at its own button', { timeout: 300000 * SLOW }, async () => {
  await save('older check');
  await save('newer check');
  // (not every word of each title is in the words, so each saved workflow is a button)
  const w1 = 'run the older one, then tell me what it says', w2 = 'run the newer one, then tell me what it says', chat = await newChat();
  script([{ match: `^${esc(w1)}$`, calls: [RUN('older check')] }, { match: `^${esc(w2)}$`, calls: [RUN('newer check')] }, { match: CARRY, calls: [] }]);
  try {
    const r1 = await say(chat, w1);
    assert.deepEqual(r1.message.tools.map(t => [t.name, t.outcome]), [['run_workflow', 'needs-ok']], `set-up: ${r1.text}`);
    const r2 = await say(chat, w2);
    assert.deepEqual(r2.message.tools.map(t => [t.name, t.outcome]), [['run_workflow', 'needs-ok']], `set-up: ${r2.text}`);
    const t2 = taskOf(chat);
    assert.deepEqual([t2?.request, Boolean(t2?.parked)], [w2, true], `set-up: the newer request is the task, parked at its button: ${JSON.stringify(t2)}`);
    // The older request's button, still open: pressing it runs its own change.
    const pressed = await choose(chat, yesOf(r1.message)[0].id);
    assert.equal(pressed.status, 200, pressed.text);
    assert.equal(pressed.json.outcome, 'started', pressed.text);
    await sleep(10000 * SLOW);
    const m = await chatMessages(chat), t = taskOf(chat);
    assert.equal(m.filter(x => x.auto).length, 0, `the press was on another request’s button; the task now: ${JSON.stringify(t)}. Chat: ${shown(m)}`);
    assert.deepEqual([t?.request, Boolean(t?.parked)], [w2, true], `the newer request still waits at its button: ${JSON.stringify(t)}`);
  } finally { script([]); await stopIn(chat); }
});

test('an agent’s press in its own conversation runs its change and never wakes the owner’s task waiting there', { timeout: 300000 * SLOW }, async () => {
  await save('agent list check');
  const act = await createActKey('e6-wake'), words = 'run the agent list one, then tell me what it says';
  script([{ match: '^hello from the agent$', calls: [] }, { match: `^${esc(words)}$`, calls: [RUN('agent list check')] }, { match: CARRY, calls: [] }]);
  let chat = null;
  try {
    // The agent's conversation; the owner's own request with a next step, typed there, is a task parked at its button.
    const first = await call(act.token, 'ask_sparkie', { message: 'hello from the agent' });
    chat = first.value?.conversation;
    assert.ok(chat, `set-up: the agent’s conversation: ${first.raw}`);
    const r = await say(chat, words);
    assert.deepEqual(r.message.tools.map(t => [t.name, t.outcome]), [['run_workflow', 'needs-ok']], `set-up: ${r.text}`);
    const parked = taskOf(chat);
    assert.deepEqual([parked?.request, Boolean(parked?.parked)], [words, true], `set-up: ${JSON.stringify(parked)}`);
    // The agent presses it.
    const pressed = await call(act.token, 'ask_sparkie', { conversation: chat, choice: yesOf(r.message)[0].id });
    assert.ok(!pressed.isError, `set-up: the agent’s press: ${pressed.raw}`);
    await sleep(10000 * SLOW);
    const m = await chatMessages(chat), t = taskOf(chat);
    assert.equal(m.filter(x => x.auto).length, 0, `an agent pressed; the owner’s task now: ${JSON.stringify(t)}. Chat: ${shown(m)}`);
    assert.deepEqual([t?.request, Boolean(t?.parked)], [words, true], `it still waits for the owner: ${JSON.stringify(t)}`);
  } finally { script([]); if (chat) await stopIn(chat); }
});
