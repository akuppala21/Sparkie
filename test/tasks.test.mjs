// Covers: Long tasks (design E 2.1 as cut, step 6; R66), first piece (E6a): a task's limits come from the owner's own
// instruction when it is made and are kept on it in chats.json: an ordinary request with a next step has 2 hours and 8
// carry-on turns, "on your own", "overnight" or "while I'm away" 4 hours and 60, hours it is asked to work for ("for 6
// hours") those hours and 15 turns an hour, bounded at 72 hours; a question, words after a "not", words about something
// else ("it crashed overnight") and a pasted log line pick nothing. A new request in a task's chat ends the task on disk
// at once, before its reply ends. The task survives a restart of Spark Console: killed with a carry-on turn due, the
// console comes back and carries on, still under "don't stop anything" (a saved workflow that stops a model is a button,
// and the model runs), and a task past 8 turns whose words gave it 60 goes on; one at its own limit of turns, one at 120
// work steps in all, one started on Telegram that is no longer paired and one from a device whose sign-in is gone do
// not; a record from before these limits is dropped with no word; a request made just after the start is no survivor
// (no line about a restart), and once it has run to its end its task is off the record. A state put back from a copy
// ends every task in it, also at a second put-back under the hold. (E6b) After the restart a task at its limit says
// which in a line of its own, a task whose chat is full stops with a line and a needs-you line, and the owner's "carry
// on" gives a stopped one a fresh budget of its size. The brain here has a context of 1,000 tokens, so one long lookup
// ends a reply at the output budget and the request carries on.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, newChat, say, chatMessages, waitFor, sleep, request, SLOW } from './lib.mjs';
import { startMock } from './start-mock.mjs';

// (a carry-on turn here waits 10 minutes, so the tasks this file makes stay as they are made)
useFleet({ watchMs: 60000, env: { SPARK_CONSOLE_CONTINUE_MS: '600000' }, prepare: ({ stateDir }) => {
  const f = join(stateDir, 'main.json'), m = JSON.parse(readFileSync(f, 'utf8'));
  m.presets[m.current] = { ...m.presets[m.current], contextTokens: 1000 };
  writeFileSync(f, JSON.stringify(m), { mode: 0o600 });
} });

const script = (rules, fleet = T.fleet) => writeFileSync(join(fleet.dir, 'model-script.json'), JSON.stringify(rules));
const noScript = () => rmSync(join(T.fleet.dir, 'model-script.json'), { force: true });
const esc = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CARRIED = '^\\[Spark Console\\] Your last reply stopped at the limit of one message';
const FINISHED = '^\\[Spark Console\\] What you started for the owner';
const RESTARTED = 'Spark Console restarted while this request was being carried on';
const LONG = { name: 'workflows', arguments: {} };
const RADIX = 'sc-RadixArk--Qwen3.8-27B-NVFP4', GGUF = 'sc-testorg--Qwen3.8-27B-abliterated-GGUF';
const ago = ms => new Date(Date.now() - ms).toISOString();
const BUDGET_END = /\nCarrying on with your request in a fresh turn\.$/;
const chatsOf = (fleet = T.fleet) => JSON.parse(readFileSync(join(fleet.stateDir, 'chats.json'), 'utf8')).conversations;
const taskOf = id => chatsOf().find(c => c.id === id)?.task;
const limits = t => (t ? { hours: t.hours, turns: t.turns } : null);

// A request in a chat of its own whose reply reaches the output budget, so it is kept as a task.
async function tasked(words, before = null) {
  const chat = await newChat(), rules = [{ match: `^${esc(words)}$`, rounds: [[LONG]] }];
  if (before) rules.push({ match: `^${esc(before)}$`, calls: [] });
  script(rules);
  try {
    if (before) await say(chat, before);
    const r = await say(chat, words);
    assert.match(r.text, BUDGET_END, `${words}: ${r.text.slice(-300)}`);
  } finally { noScript(); }
  await waitFor(() => taskOf(chat), { what: `the task of “${words}” on disk` });
  return chat;
}

const made = {};
test('a task\'s hours and turns come from the owner\'s own instruction, bounded, and are kept with it on disk', { timeout: 300000 * SLOW }, async () => {
  const save = await api('/actions/save_workflow', { method: 'POST', body: { title: 'night mode', steps: [{ action: 'stop_model', args: { spark: 'spark4', container: RADIX } }] } });
  assert.equal(save.status, 200, save.text);
  made.guarded = await tasked('run night mode, then tell me how it went', 'Don’t stop anything.');
  made.away = await tasked('read the workflows on your own, then tell me which one stops a model');
  made.long = await tasked('read the workflows for 100 hours, then tell me which one stops a model');
  made.six = await tasked('read the workflows again for 6 hours, then tell me which one stops a model');
  made.asked = await tasked('Should I leave it on its own? Read the workflows, then tell me which one stops a model');
  made.not = await tasked('Not on your own: read the workflows, then tell me which one stops a model');
  made.plain = await tasked('read the workflows once more, then tell me which one stops a model');
  // (an instruction only: words about something else, and a pasted log line, pick nothing)
  made.crashed = await tasked('It crashed overnight. Read the workflows, then tell me which one stops a model');
  made.pasted = await tasked('Here is the log:\nretrying for 72 hours before giving up\nRead the workflows, then tell me which one stops a model');
  made.overnight = await tasked('Work through the workflows overnight, then tell me which one stops a model');
  made.away2 = await tasked('Read the workflows while I’m away, then tell me which one stops a model');
  // (a word of time that is the subject of a look, not part of an instruction to work)
  made.lookAt = await tasked('Look at what happened overnight, then tell me which one stops a model');
  // (a "not", and a pasted line, each where the rule under test is the only thing that picks nothing: final read TE-08)
  made.notOvernight = await tasked('Work through the workflows, but not overnight, then tell me which one stops a model');
  made.pastedWork = await tasked('Here is the log:\nwork on it for 72 hours\n\nRead the workflows, then tell me which one stops a model');
  assert.deepEqual(limits(taskOf(made.guarded)), { hours: 2, turns: 8 });
  assert.equal(taskOf(made.guarded).noStops, true, 'the guard is kept on disk');
  assert.deepEqual(limits(taskOf(made.away)), { hours: 4, turns: 60 });
  assert.deepEqual(limits(taskOf(made.long)), { hours: 72, turns: 1080 });
  assert.deepEqual(limits(taskOf(made.six)), { hours: 6, turns: 90 });
  assert.deepEqual(limits(taskOf(made.asked)), { hours: 2, turns: 8 });
  assert.deepEqual(limits(taskOf(made.not)), { hours: 2, turns: 8 });
  assert.deepEqual(limits(taskOf(made.plain)), { hours: 2, turns: 8 });
  assert.deepEqual(limits(taskOf(made.crashed)), { hours: 2, turns: 8 }, 'words about something else');
  assert.deepEqual(limits(taskOf(made.pasted)), { hours: 2, turns: 8 }, 'a pasted log line');
  assert.deepEqual(limits(taskOf(made.overnight)), { hours: 4, turns: 60 });
  assert.deepEqual(limits(taskOf(made.away2)), { hours: 4, turns: 60 });
  assert.deepEqual(limits(taskOf(made.lookAt)), { hours: 2, turns: 8 }, 'what happened overnight is what to look at');
  assert.deepEqual(limits(taskOf(made.notOvernight)), { hours: 2, turns: 8 }, 'words after a "not" pick nothing');
  assert.deepEqual(limits(taskOf(made.pastedWork)), { hours: 2, turns: 8 }, 'a pasted line picks nothing');
  for (const id of Object.values(made)) assert.equal(taskOf(id).carry, true, 'each waits for its carry-on turn');
  // (the two added for the final read end here, so the restart below carries on with the same tasks as before)
  for (const id of [made.notOvernight, made.pastedWork]) {
    assert.equal((await api(`/chats/${id}/messages`, { method: 'POST', body: { text: '/stop' } })).status, 200);
    await waitFor(() => !taskOf(id), { timeout: 15000 * SLOW, what: `the task in ${id} ended` });
  }
});

test('a new request in a task’s chat takes the task off the record on disk at once, while its reply is still coming', { timeout: 120000 * SLOW }, async () => {
  assert.ok(made.plain, 'the test above made the tasks');
  script([{ match: '^answer slowly, take 8 seconds$', calls: [] }]);
  try {
    const slow = say(made.plain, 'answer slowly, take 8 seconds');
    await waitFor(() => chatsOf().find(c => c.id === made.plain).task === null, { timeout: 6000 * SLOW, every: 200, what: 'the old request off the record on disk' });
    assert.equal((await api(`/chats/${made.plain}`)).json.replying, true, 'before the new reply ends');
    await slow;
  } finally { noScript(); }
});

// The restart: fleet B, started from fleet A's disk as it was when A was killed, with a hand-written chat or two. Each
// test below looks at one thing of it.
let B = null;
after(async () => { await B?.stop().catch(() => {}); }, { timeout: 60000 });
const messagesOn = async id => (await (await fetch(`${B.base}/chats/${id}`)).json()).messages;
const bPost = async (path, body) => { const r = await fetch(`${B.base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-spark-console': '1', origin: B.origin }, body: JSON.stringify(body) }); return { status: r.status, text: await r.text() }; };
const carriedIn = id => waitFor(async () => { const m = await messagesOn(id), i = m.findIndex(x => x.auto); return i >= 0 && m[i + 1]?.role === 'assistant' && m[i + 1]; }, { timeout: 120000 * SLOW, what: `the carry-on turn in ${id}` });
const STOP = `stop ${GGUF} on spark 3, then tell me how it went`;
const NEAR = 'read the workflows near the end, then tell me which one stops a model', LOOK = { name: 'run', arguments: { on: 'spark3', command: 'uptime' } };

test('set-up: killed with every carry-on turn due, started again from that disk; a request is made before the look for tasks', { timeout: 300000 * SLOW }, async () => {
  assert.ok(made.plain, 'the tests above made the tasks');
  process.kill(T.fleet.servicePid(), 'SIGKILL');
  await waitFor(() => T.fleet.serviceExit(), { what: 'the console to end' });
  const chats = chatsOf(), set = (id, fields) => Object.assign(chats.find(c => c.id === id).task, fields);
  // As if each had got this far: the away one past 8 turns; the long one at its own 1,080; one at 120 steps; one started
  // on Telegram (not paired after the restart); one from a device whose sign-in is gone.
  set(made.away, { continuations: 8 });
  set(made.long, { continuations: 1080 });
  set(made.six, { steps: 120 });
  set(made.asked, { channel: 'telegram' });
  set(made.not, { away: true, session: 'abcdef123456' });
  // A task kept by a build from before these limits (none on it), its request long done.
  const words = 'read the workflows, then tell me which one stops a model';
  made.old = 'sc_00000000000000e6';
  chats.push({ id: made.old, login: chats[0].login, title: 'from before', spark: null, createdAt: ago(4 * 3600000), updatedAt: ago(3 * 3600000),
    messages: [{ role: 'user', content: words, createdAt: ago(4 * 3600000) }, { role: 'assistant', content: 'I looked: night mode stops a model.', createdAt: ago(3 * 3600000) }],
    task: { request: words, at: ago(4 * 3600000), continuations: 1 } });
  // (E6b) A task whose chat is full, owed a carry-on turn: no turn can come there.
  // (the swap to E5b's count) A task 3 commands short of its 120, owed a carry-on turn that asks for 4.
  made.near = 'sc_00000000000000f2';
  chats.push({ id: made.near, login: chats[0].login, title: 'near the end', spark: null, createdAt: ago(600000), updatedAt: ago(60000),
    messages: [{ role: 'user', content: NEAR, createdAt: ago(120000) }, { role: 'assistant', content: 'I looked.\n\nStopped here: one message may read 1,200 characters of tool results, so 1 result wasn’t read.\nCarrying on with your request in a fresh turn.', createdAt: ago(100000) }],
    task: { request: NEAR, at: ago(60000), continuations: 0, hours: 2, turns: 8, steps: 117, carry: true } });
  made.full = 'sc_00000000000000f1';
  chats.push({ id: made.full, login: chats[0].login, title: 'full', spark: null, createdAt: ago(600000), updatedAt: ago(60000),
    messages: Array.from({ length: 200 }, (_, i) => (i % 2 ? { role: 'assistant', content: `answer ${i}`, createdAt: ago(100000) } : { role: 'user', content: `question ${i}`, createdAt: ago(120000) })),
    task: { request: `${words} on your own`, at: ago(60000), continuations: 3, hours: 4, turns: 60, carry: true } });
  const saved = readFileSync(join(T.fleet.stateDir, 'saved-workflows.json'));
  // (the look for tasks comes 30 seconds after the start, after the watcher's first look at 15; a stop on Spark 3 takes
  // 40 seconds there)
  B = await startMock({ watchMs: 60000, env: { SPARK_CONSOLE_CONTINUE_MS: '1500', SPARK_CONSOLE_TASKS_AFTER_MS: '30000' }, prepare: ({ stateDir, root }) => {
    writeFileSync(join(stateDir, 'chats.json'), JSON.stringify({ conversations: chats }), { mode: 0o600 });
    writeFileSync(join(stateDir, 'saved-workflows.json'), saved, { mode: 0o600 });
    writeFileSync(join(root, 'spark3', '.mock', 'slow-stop'), '40');
    // (its brain up a minute already, so the eval the harness keeps for it finds it answering)
    writeFileSync(join(root, 'spark2', '.mock', 'up-sparkie-main'), String(Math.floor(Date.now() / 1000) - 60));
  } });
  // (with no eval on record every change of Sparkie's is a button: wait until B's is kept)
  await waitFor(async () => /makes a change your words clearly ask for at once/.test((await bPost('/actions/sparkie_setup', {})).text), { timeout: 60000 * SLOW, what: 'an eval on record for B' });
  // (and the words name a model only once the watcher has seen what runs: its first look)
  await waitFor(async () => (JSON.parse((await bPost('/actions/workloads', { spark: 'spark3' })).text).workloads || []).some(w => w.name === GGUF && w.state === 'running'), { timeout: 60000 * SLOW, what: 'B’s watcher seeing Spark 3' });
  const run = { name: 'run_workflow', arguments: { name: 'night mode' } };
  script([{ match: `^${esc(STOP)}$`, calls: [{ name: 'stop_model', arguments: { spark: 'spark3', container: GGUF } }] },
    { match: `${CARRIED}.*${esc(NEAR)}`, rounds: [Array(4).fill(LOOK)] },
    { match: `${CARRIED}.*run night mode`, rounds: [[run]] }, { match: CARRIED, calls: [] }, { match: FINISHED, calls: [] }, { match: '^carry on$', calls: [run] }], B);
  // A request made after the start and before the look, whose stop is still under way when the look comes.
  made.fresh = JSON.parse((await bPost('/chats', {})).text).id;
  const asked = await bPost(`/chats/${made.fresh}/messages`, { text: STOP });
  assert.equal(asked.status, 200, asked.text);
  const done = asked.text.split('\n\n').map(x => x.trim()).filter(x => x.startsWith('data:')).map(x => JSON.parse(x.slice(5))).find(e => e.type === 'done');
  assert.deepEqual(done?.message.tools.map(t => [t.name, t.outcome]), [['stop_model', 'started']], asked.text.slice(-400));
  // The guarded task's carry-on turn, and the away one's: by then the look has been, and every wake it made has had time.
  made.g = await carriedIn(made.guarded);
  await carriedIn(made.away);
  await sleep(6000 * SLOW);
});

test('after the restart the guarded task carries on under its guard: its saved workflow is still a button, and the model runs', { timeout: 60000 * SLOW }, async () => {
  assert.ok(made.g, 'set-up');
  assert.deepEqual(made.g.tools.map(t => [t.name, t.outcome]), [['run_workflow', 'needs-ok']], JSON.stringify(made.g));
  const stateOf = name => readFileSync(join(B.root, 'spark4', '.mock', 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];
  assert.equal(stateOf(RADIX), 'running');
  // (a task waiting on its carry-on turn needs no line about the restart)
  assert.ok(!(await messagesOn(made.guarded)).some(x => String(x.content).startsWith(RESTARTED)));
});

test('after the restart the one sent off on its own went on past 8 turns; the others at their limits, or whose way in is gone, did not', { timeout: 60000 * SLOW }, async () => {
  assert.ok(made.g, 'set-up');
  assert.ok((await messagesOn(made.away)).some(x => x.auto), 'the away one carried on');
  for (const id of [made.long, made.six, made.asked, made.not]) {
    const m = await messagesOn(id);
    assert.equal(m.filter(x => x.auto).length, 0, `${id}: ${JSON.stringify(m.map(x => [x.role, Boolean(x.auto), String(x.content).slice(0, 60)]))}`);
  }
  const after = chatsOf(B);
  assert.equal(after.find(c => c.id === made.asked).task ?? null, null, 'the Telegram task ended');
  assert.equal(after.find(c => c.id === made.not).task ?? null, null, 'the signed-out device\'s task ended');
});

test('after the restart a record from before these limits is dropped: no line, no turn', { timeout: 60000 * SLOW }, async () => {
  assert.ok(made.g, 'set-up');
  assert.equal(chatsOf(B).find(c => c.id === made.old).task ?? null, null, 'the record from before');
  const m = await messagesOn(made.old);
  assert.equal(m.length, 2, JSON.stringify(m.slice(2)));
});

test('a request made after the start is no survivor of the restart: no line about one', { timeout: 60000 * SLOW }, async () => {
  assert.ok(made.g, 'set-up');
  // (the request was made before the look for tasks, which made the guarded task's first carry-on turn: else this would
  // pass whatever the look did; final read TE-16)
  const asked = (await messagesOn(made.fresh)).find(x => x.role === 'user'), carried = (await messagesOn(made.guarded)).find(x => x.auto);
  assert.ok(asked && carried && Date.parse(asked.createdAt) < Date.parse(carried.createdAt), `the request (${asked?.createdAt}) came before the look's first carry-on turn (${carried?.createdAt})`);
  assert.ok(!(await messagesOn(made.fresh)).some(x => String(x.content).startsWith(RESTARTED)), JSON.stringify((await messagesOn(made.fresh)).map(x => String(x.content).slice(0, 60))));
});

test('a request that has run to its end is off the record: its stop’s result, its carry-on turn, then nothing of it is kept', { timeout: 240000 * SLOW }, async () => {
  assert.ok(made.g, 'set-up');
  await waitFor(async () => { const m = await messagesOn(made.fresh), i = m.findIndex(x => x.auto); return i > 0 && m[i + 1]?.role === 'assistant'; }, { timeout: 180000 * SLOW, what: 'the carry-on turn after the stop' });
  await waitFor(() => (chatsOf(B).find(c => c.id === made.fresh).task ?? null) === null, { timeout: 15000 * SLOW, what: 'the done request off the record' });
  assert.ok(!(await messagesOn(made.fresh)).some(x => String(x.content).startsWith(RESTARTED)));
});

test('(E6b) after the restart the two at a limit say which, once, in a line of their own: no reply of theirs reached it', { timeout: 60000 * SLOW }, async () => {
  assert.ok(made.g, 'set-up');
  for (const [id, which, line] of [[made.long, 'turns', /^Stopped carrying on with your request: it reached its 1080 carry-on turns\. .* Say “carry on” for another 72 hours and 1080 turns\.$/],
    [made.six, 'steps', /^Stopped carrying on with your request: it reached its 120 commands\. .* Say “carry on” for another 6 hours and 90 turns\.$/]]) {
    const s = (await messagesOn(id)).filter(x => x.stopped);
    assert.deepEqual(s.map(x => [x.notice, x.stopped]), [[true, which]], id);
    assert.match(s[0].content, line);
  }
  const after = chatsOf(B);
  assert.deepEqual([after.find(c => c.id === made.long).task.stopped, after.find(c => c.id === made.six).task.stopped], ['turns', 'steps']);
});

test('(E6b) a task whose chat is full stops, said in a line of its own past its 200 messages, and stands as one needs-you line', { timeout: 60000 * SLOW }, async () => {
  assert.ok(made.g, 'set-up');
  assert.equal(chatsOf(B).find(c => c.id === made.full).task?.stopped, 'full');
  const m = await messagesOn(made.full);
  assert.deepEqual([m.length, m.filter(x => x.auto).length], [201, 0]);
  assert.match(m.at(-1).content, /^Stopped carrying on with your request: this chat is full, so no turn can come here\. .* Start a new chat and ask again there\.$/);
  assert.ok(JSON.parse((await bPost('/actions/fleet_status', {})).text).needsOwner.includes('Sparkie stopped carrying on with one of your requests: its chat is full. Start a new chat and ask again there.'));
});

// (its turn asks a button, so the task waits there and can be looked at: B's brain has a large context, so a long
// lookup wouldn't end its reply at a budget)
test('(E6b) the owner’s “carry on” in a chat stopped at its 120 commands: the same request, a fresh 6 hours and 90 turns', { timeout: 120000 * SLOW }, async () => {
  assert.ok(made.g, 'set-up');
  const before = chatsOf(B).find(c => c.id === made.six).task;
  const said = await bPost(`/chats/${made.six}/messages`, { text: 'carry on' });
  assert.equal(said.status, 200, said.text);
  const t = chatsOf(B).find(c => c.id === made.six).task;
  assert.deepEqual([t?.request, t?.continuations, t?.steps, t?.stopped ?? null, t?.hours, t?.turns], ['read the workflows again for 6 hours, then tell me which one stops a model', 0, 0, null, 6, 90]);
  // (its hours start again, and it waits at the button its turn asked)
  assert.ok(Date.parse(t.at) > Date.parse(before.at), `its hours start again: ${before.at} → ${t.at}`);
  assert.ok(t.parked, JSON.stringify(t));
});

test('a task’s 120 commands are one count: the carry-on turn that reaches them is stopped by it, the task stops at its limit with that reply, and its record holds 120', { timeout: 120000 * SLOW }, async () => {
  assert.ok(made.g, 'set-up');
  const t = await waitFor(() => { const x = chatsOf(B).find(c => c.id === made.near).task; return x?.stopped && x; }, { timeout: 100000, what: 'the task stopped at its 120' });   // (waitFor multiplies by SLOW itself: this ends before the test's own limit, with words)
  assert.deepEqual([t.steps, t.stopped, t.continuations], [120, 'steps', 1], JSON.stringify(t));
  const m = await messagesOn(made.near), last = m.at(-1);
  assert.deepEqual([last.role, last.stopped, last.notice ?? null], ['assistant', 'steps', null]);
  assert.match(last.content, /\n\nStopped here: one task may run 120 commands, and this one has \(3 in this message\); 1 more was asked for and not run\.\nSay “go on” to carry on\.$/, last.content.slice(-300));
  assert.equal(m.filter(x => x.stopped).length, 1, 'said once: by the reply');
  assert.ok(JSON.parse((await bPost('/actions/fleet_status', {})).text).needsOwner.includes('Sparkie stopped carrying on with one of your requests at its limit (120 commands). Say “carry on” in that chat to go on, or anything else to leave it.'));
});

test('a state put back from a copy ends every task in it, also at a second put-back under the hold: a line in each chat, and nothing carries on', { timeout: 200000 * SLOW }, async () => {
  const id = 'sc_00000000000000e7', words = 'read the workflows, then tell me which one stops a model';
  // (the state's number below the secrets file's, and a hold already there: a second put-back under it)
  const C = await startMock({ watchMs: 60000, env: { SPARK_CONSOLE_CONTINUE_MS: '1500', SPARK_CONSOLE_TASKS_AFTER_MS: '3000' }, prepare: ({ dir, stateDir }) => {
    mkdirSync(join(dir, 'secrets'), { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, 'secrets', 'secrets.json'), JSON.stringify({ auth: { serial: 3, hold: { since: ago(600000), state: 1, again: [], signedOut: 0, parked: 0 } } }), { mode: 0o600 });
    writeFileSync(join(stateDir, 'auth-serial.json'), JSON.stringify({ serial: 1 }), { mode: 0o600 });
    writeFileSync(join(stateDir, 'chats.json'), JSON.stringify({ conversations: [{ id, login: 'owner@test', title: 'put back', spark: null, createdAt: ago(120000), updatedAt: ago(60000),
      messages: [{ role: 'user', content: words, createdAt: ago(120000) }, { role: 'assistant', content: 'I looked.\n\nCarrying on with your request in a fresh turn.', createdAt: ago(100000) }],
      task: { request: words, at: ago(120000), continuations: 0, hours: 2, turns: 8, carry: true } }] }), { mode: 0o600 });
  } });
  try {
    script([{ match: CARRIED, calls: [] }, { match: FINISHED, calls: [] }], C);
    await sleep(8000 * SLOW);
    const conv = chatsOf(C).find(c => c.id === id);
    assert.equal(conv.task ?? null, null, 'ended at the start');
    assert.match(conv.messages.at(-1).content, /^Spark Console’s state was put back from a copy, so “read the workflows, then tell me which one stops a model” isn’t carried on\./);
    assert.equal(conv.messages.filter(m => m.auto).length, 0, 'no carry-on turn');
  } finally { await C.stop(); }
});
