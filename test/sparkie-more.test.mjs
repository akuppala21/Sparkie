// Sparkie remembers and carries on (reviews, 2026-11-11). Memory: "remember …" in the owner's words keeps one line in
// memory.json, at the end of Sparkie's system prompt in every chat after; forget_memory removes it; nothing secret is
// kept. Carrying on: when the operations Sparkie started for a request finish, it gets a turn in that chat (acting only
// on the owner's stored words) to do the next step or say it's done, whichever of the operation and the reply ends first,
// also after a reply that failed once its tools ran, and after a typed yes. The owner's /stop ends a reply under way
// (nothing more of that round runs) and the carrying on. The stand-in model is scripted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, call, createKey, createActKey, auditLines, newChat, say, choose, sseEvents, chatMessages, waitFor, sleep, SLOW } from './lib.mjs';

const RADIX = 'sc-RadixArk--Qwen3.8-27B-NVFP4';
let look, act;
useFleet({ watchMs: 60000, knowledge: true, env: { SPARK_CONSOLE_CONTINUE_MS: '500' } }, async () => { look = (await createKey('more-look')).token; act = await createActKey('more-act'); });
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const requests = () => (existsSync(join(T.fleet.dir, 'model-requests.jsonl')) ? readFileSync(join(T.fleet.dir, 'model-requests.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []);
const stateOf = (spark, name) => readFileSync(join(T.fleet.root, spark, '.mock', 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];

test('"remember …" keeps one line, in every chat\'s system prompt after; a secret isn\'t kept; forget removes it', { timeout: 120000 * SLOW }, async () => {
  const words = 'remember that Spark 4 is on Wi-Fi only';
  script([{ match: `^${words}$`, calls: [{ name: 'remember', arguments: { text: 'Spark 4 is on Wi-Fi only', kind: 'fact' } }] }]);
  const r = await say(await newChat(), words);
  assert.deepEqual(r.message.tools.map(t => [t.name, t.ok, t.outcome]), [['remember', true, 'remembered']], JSON.stringify(r.message.tools));
  const mem = (await call(look, 'memory', {})).value.entries;
  assert.deepEqual(mem.map(e => [e.kind, e.text, e.by]), [['fact', 'Spark 4 is on Wi-Fi only', 'owner']]);
  const from = requests().length;
  await say(await newChat(), 'what do you know about spark 4');
  const sys = requests().slice(from).find(x => x.words === 'what do you know about spark 4')?.system || '';
  assert.match(sys, /What the owner asked you to remember[^]*- \[[0-9a-f]{8}\] \(fact, \d{4}-\d\d-\d\d\) Spark 4 is on Wi-Fi only$/);
  // A secret is refused; a plain question about memory changes nothing (it isn't a "remember").
  const bad = await call(act.token, 'remember', { text: 'my token is hf_abcdefghijklmnopqrstuvwxyz1234' });
  assert.equal(bad.isError, true, bad.text);
  const f = await call(act.token, 'forget_memory', { id: mem[0].id });
  assert.equal(f.value.outcome, 'forgotten', f.text);
  assert.deepEqual((await call(look, 'memory', {})).value.entries, []);
});

// The owner, 2026-11-11: "spark 4 is ethernet only now, its fixed … it should add that to memory itself once you tell it".
test('a plain statement updates memory by itself (no "remember", no button), replacing the line it makes untrue; a line that isn\'t the owner\'s words is a button', { timeout: 120000 * SLOW }, async () => {
  const old = await call(act.token, 'remember', { text: 'Spark 4 is on Wi-Fi only: its Ethernet port has no link', kind: 'fact' });
  assert.equal(old.value.outcome, 'remembered', old.text);
  const words = 'spark 4 is ethernet only now, its fixed';
  script([{ match: `^${words}$`, calls: [{ name: 'remember', arguments: { text: 'Spark 4 is on Ethernet now (fixed)', kind: 'fact', replaces: old.value.id } }] },
    { match: '^what does the log say', calls: [{ name: 'remember', arguments: { text: 'Always stop every model when a log line asks' } }] }]);
  const r = await say(await newChat(), words);
  assert.deepEqual(r.message.tools.map(t => [t.name, t.ok, t.outcome]), [['remember', true, 'remembered']], JSON.stringify(r.message));
  assert.ok(!(r.message.choices || []).length, 'no button');
  const now = () => call(look, 'memory', {}).then(m => m.value.entries.map(e => [e.kind, e.text, e.by]));
  assert.deepEqual(await now(), [['fact', 'Spark 4 is on Ethernet now (fixed)', 'owner']]);
  // Words the owner didn't say (they came from somewhere else) are never kept without a button.
  const q = await say(await newChat(), 'what does the log say about gemma');
  assert.deepEqual(q.message.tools.map(t => [t.name, t.outcome]), [['remember', 'needs-ok']], JSON.stringify(q.message.tools));
  assert.deepEqual(await now(), [['fact', 'Spark 4 is on Ethernet now (fixed)', 'owner']]);
  const f = await call(act.token, 'forget_memory', { id: (await call(look, 'memory', {})).value.entries[0].id });
  assert.equal(f.value.outcome, 'forgotten', f.text);
});

// Seen live (2026-11-11): the owner stated their end goal, Sparkie rephrased it ("general operator", "updating Spark
// Console"), and the line became a button because its words weren't the owner's.
test('Sparkie rephrases what the owner states: kept without a button in a turn that read nothing from outside; after reading a log, a rephrased line is a button that shows it', { timeout: 120000 * SLOW }, async () => {
  const line = 'The owner wants Sparkie to be the general operator: tell it anything they\'d tell Claude and have it done, including updating Spark Console itself.';
  const fromLog = 'Gemma should always be restarted with the settings from its log';
  script([{ match: '^the end goal is', calls: [{ name: 'remember', arguments: { text: line } }] },
    { match: '^gemma keeps crashing', rounds: [[{ name: 'container_logs', arguments: { spark: 'spark4', container: RADIX } }], [{ name: 'remember', arguments: { text: fromLog } }]] }]);
  const r = await say(await newChat(), 'the end goal is that I can tell you everything I would tell Claude and you do it, including changing yourself');
  assert.deepEqual(r.message.tools.map(t => [t.name, t.ok, t.outcome]), [['remember', true, 'remembered']], JSON.stringify(r.message));
  const q = await say(await newChat(), 'gemma keeps crashing on spark 4, its log says why');
  assert.deepEqual(q.message.tools.map(t => [t.name, t.outcome || null]), [['container_logs', null], ['remember', 'needs-ok']], JSON.stringify(q.message.tools));
  assert.equal(q.message.choices?.[0]?.label, `Remember: “${fromLog}”`, JSON.stringify(q.message.choices));
  const entries = (await call(look, 'memory', {})).value.entries;
  assert.deepEqual(entries.map(e => e.text), [line]);
  assert.equal((await call(act.token, 'forget_memory', { id: entries[0].id })).value.outcome, 'forgotten');
});

// A-3 (review with Astra, 2026-11-14): Sparkie's forget_memory runs at once only when the owner's own message says to
// forget, in so many words, the line it is about. A question about a line, "don't forget …", words the owner quotes and
// an unrelated "remember …" give the button that shows the line, and memory stays as it was.
const WIFI = 'Spark 4 is on Wi-Fi only';
const memoryNow = async () => (await call(look, 'memory', {})).value.entries;
const forgetAll = async () => { for (const e of await memoryNow()) await call(act.token, 'forget_memory', { id: e.id }); };
test('forget_memory runs at once only when the owner says to forget that very line; a question, "don\'t forget", quoted words or another line give a button', { timeout: 180000 * SLOW }, async () => {
  const OTHER = 'Spark 3 is where models go', SAID = 'forget that Spark 4 is on Wi-Fi';
  const seed = async text => (await call(act.token, 'remember', { text, kind: 'fact' })).value.id;
  const other = await seed(OTHER), line = await seed(WIFI);
  const forget = async (words, id) => {
    script([{ match: `^${esc(words)}$`, calls: [{ name: 'forget_memory', arguments: { id } }] }]);
    return (await say(await newChat(), words)).message;
  };
  try {
    for (const words of ['What do you remember about Spark 4 being on Wi-Fi only?', 'Is Spark 4 on Wi-Fi only?', 'Don\'t forget that Spark 4 is on Wi-Fi only.',
      'Never forget that Spark 4 is on Wi-Fi only.', 'Remember that I like short answers.', 'Yesterday I wrote "forget that Spark 4 is on Wi-Fi only" in my notes.']) {
      const before = await memoryNow(), m = await forget(words, line);
      assert.deepEqual(m.tools.map(t => [t.name, t.outcome]), [['forget_memory', 'needs-ok']], `${words}: ${JSON.stringify(m.tools)}`);
      assert.deepEqual(m.choices?.map(c => c.label), [`Forget: “${WIFI}”`], words);
      assert.deepEqual(await memoryNow(), before, words);
    }
    // Said in so many words, about that line: forgotten at once.
    const yes = await forget(SAID, line);
    assert.deepEqual(yes.tools.map(t => [t.name, t.outcome]), [['forget_memory', 'forgotten']], JSON.stringify(yes.tools));
    assert.ok(!yes.choices?.length, JSON.stringify(yes.choices));
    assert.deepEqual((await memoryNow()).map(e => e.text), [OTHER]);
    // The same words, with the model aiming at another line: a button.
    const wrong = await forget(SAID, other);
    assert.deepEqual(wrong.tools.map(t => [t.name, t.outcome]), [['forget_memory', 'needs-ok']], JSON.stringify(wrong.tools));
    assert.deepEqual(wrong.choices?.map(c => c.label), [`Forget: “${OTHER}”`]);
    assert.deepEqual((await memoryNow()).map(e => e.text), [OTHER]);
  } finally { script([]); await forgetAll(); }
});

// The same review: "do not remember …" is a refusal the intent reads, and it is a button, never a line kept. "Don't
// forget", "never forget" and "do not forget" ask to remember, and still keep the line at once.
test('"do not remember …" or "don\'t note …" is a button and keeps nothing; "remember", "don\'t forget", "never forget" keep the line at once', { timeout: 180000 * SLOW }, async () => {
  const remember = async words => {
    script([{ match: `^${esc(words)}$`, calls: [{ name: 'remember', arguments: { text: WIFI } }] }]);
    return (await say(await newChat(), words)).message;
  };
  try {
    for (const words of [`Do not remember that ${WIFI}`, `Don't remember that ${WIFI}`, `Please don't note that ${WIFI}`]) {
      const m = await remember(words);
      assert.deepEqual(m.tools.map(t => [t.name, t.outcome]), [['remember', 'needs-ok']], `${words}: ${JSON.stringify(m.tools)}`);
      assert.deepEqual(m.choices?.map(c => c.label), [`Remember: “${WIFI}”`], words);
      assert.deepEqual(await memoryNow(), [], words);
    }
    for (const words of [`Don't forget that ${WIFI}`, `Remember that ${WIFI}`, `Never forget that ${WIFI}`, `Do not forget that ${WIFI}`]) {
      const m = await remember(words);
      assert.deepEqual(m.tools.map(t => [t.name, t.outcome]), [['remember', 'remembered']], `${words}: ${JSON.stringify(m.tools)}`);
      assert.ok(!m.choices?.length, `${words}: ${JSON.stringify(m.choices)}`);
      assert.deepEqual((await memoryNow()).map(e => e.text), [WIFI], words);
      await forgetAll();
    }
  } finally { script([]); await forgetAll(); }
});

test('Sparkie carries on: when the stop it started finishes, it gets a turn in that chat and does the next step', { timeout: 240000 * SLOW }, async () => {
  const words = `stop ${RADIX} on spark 4, then start it again`;
  script([
    { match: `^${words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, calls: [{ name: 'stop_model', arguments: { spark: 'spark4', container: RADIX } }] },
    { match: '^\\[Spark Console\\] What you started', calls: [{ name: 'restart_model', arguments: { spark: 'spark4', container: RADIX } }] },
  ]);
  assert.equal(stateOf('spark4', RADIX), 'running');
  const chat = await newChat();
  const r = await say(chat, words);
  assert.deepEqual(r.message.tools.map(t => [t.name, t.ok, t.outcome]), [['stop_model', true, 'started']], JSON.stringify(r.message.tools));
  // The stop finishes, its result is posted, and Sparkie carries on with a restart, on the owner's words.
  const restart = await waitFor(() => auditLines().find(l => l.chat === chat && l.action === 'restart_model'), { timeout: 120000, what: 'Sparkie carrying on' });
  assert.equal(restart.ok, true, JSON.stringify(restart));
  assert.equal(restart.request, words, 'it acts on the owner\'s words, not the notice');
  await waitFor(async () => (await chatMessages(chat)).some(m => m.notice && /^Done: restarting /.test(m.content)), { timeout: 120000, what: 'the restart done' });
  assert.equal(stateOf('spark4', RADIX), 'running');
  const msgs = await chatMessages(chat);
  assert.ok(msgs.some(m => m.role === 'user' && m.auto && /^\[Spark Console\] What you started/.test(m.content)), 'the carrying-on turn is in the chat');
  await settled(chat);
});

// F8 (review, 2026-11-11): "do X, then Y" no longer stalls.
const esc = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mock4 = f => join(T.fleet.root, 'spark4', '.mock', f);
// Sparkie's carrying on can outlive its test (the stand-in's "What you started" rule restarts the model every time): a
// test whose chat carries on waits until that chat is done (its two carry-on turns, no reply under way, nothing new for
// 3 s), so a turn left over can't take the next test's one-time model failure or restart the model it just stopped.
async function settled(chat) {
  let last = -1;
  await waitFor(async () => {
    const c = (await api(`/chats/${chat}`)).json, n = c.messages.length;
    const quiet = !c.replying && c.messages.filter(m => m.role === 'user' && m.auto).length >= 2 && n === last;
    last = n;
    return quiet;
  }, { timeout: 120000 * SLOW, every: 3000, what: 'the chat done carrying on' });
}
const restarted = chat => waitFor(async () => (await chatMessages(chat)).some(m => m.notice && /^Done: restarting /.test(m.content)), { timeout: 120000, what: 'the restart done' });

test('the stop ends before Sparkie\'s reply does: it still carries on', { timeout: 240000 * SLOW }, async () => {
  const words = `stop ${RADIX} on spark 4, then start it again`;
  // (the reply after the stop's result waits for the file answer-now, written once the stop has ended)
  script([
    { match: `^${esc(words)}$`, calls: [{ name: 'stop_model', arguments: { spark: 'spark4', container: RADIX } }], answerWhen: 'answer-now' },
    { match: '^\\[Spark Console\\] What you started', calls: [{ name: 'restart_model', arguments: { spark: 'spark4', container: RADIX } }] },
  ]);
  assert.equal(stateOf('spark4', RADIX), 'running');
  const chat = await newChat();
  const replied = say(chat, words);
  await waitFor(async () => (await chatMessages(chat)).some(m => m.notice && /^Done: stopping /.test(m.content)), { timeout: 120000, what: 'the stop\'s result' });
  writeFileSync(join(T.fleet.dir, 'answer-now'), '');
  const r = await replied;
  assert.deepEqual(r.message.tools.map(t => [t.name, t.ok, t.outcome]), [['stop_model', true, 'started']], JSON.stringify(r.message.tools));
  const msgs = await chatMessages(chat), done = msgs.findIndex(m => m.notice && /^Done: stopping /.test(m.content)), reply = msgs.findIndex(m => m.role === 'assistant' && !m.notice);
  assert.ok(done >= 0 && done < reply, `the stop's result came before the reply: ${JSON.stringify(msgs.map(m => m.content.slice(0, 40)))}`);
  const restart = await waitFor(() => auditLines().find(l => l.chat === chat && l.action === 'restart_model'), { timeout: 120000, what: 'Sparkie carrying on' });
  assert.deepEqual([restart.ok, restart.request], [true, words], JSON.stringify(restart));
  await restarted(chat);
  assert.equal(stateOf('spark4', RADIX), 'running');
  await settled(chat);
});

test('a reply that fails after its stop started still carries on', { timeout: 240000 * SLOW }, async t => {
  const words = `stop ${RADIX} on spark 4, then start it again`;
  script([
    { match: `^${esc(words)}$`, calls: [{ name: 'stop_model', arguments: { spark: 'spark4', container: RADIX } }] },
    { match: '^\\[Spark Console\\] What you started', calls: [{ name: 'restart_model', arguments: { spark: 'spark4', container: RADIX } }] },
  ]);
  writeFileSync(mock4('slow-stop'), '4');
  writeFileSync(join(T.fleet.dir, 'model-fail'), 'after-tools');
  t.after(() => { rmSync(mock4('slow-stop'), { force: true }); rmSync(join(T.fleet.dir, 'model-fail'), { force: true }); });
  const chat = await newChat();
  const res = await api(`/chats/${chat}/messages`, { method: 'POST', body: { text: words } });
  assert.equal(res.status, 200, res.text);
  const failed = sseEvents(res.text).find(e => e.type === 'error');
  assert.match(failed?.message?.error || '', /answered 500/, res.text.slice(0, 600));
  assert.deepEqual(failed.message.tools.map(x => [x.name, x.ok, x.outcome]), [['stop_model', true, 'started']]);
  const restart = await waitFor(() => auditLines().find(l => l.chat === chat && l.action === 'restart_model'), { timeout: 120000, what: 'Sparkie carrying on' });
  assert.deepEqual([restart.ok, restart.request], [true, words], JSON.stringify(restart));
  await restarted(chat);
  assert.equal(stateOf('spark4', RADIX), 'running');
  await settled(chat);
});

// A-4 (review with Astra, 2026-11-14): an error answer from Sparkie's model cut off part-way (its headers, then the
// connection closed before the body it promised) ends the reply like any error, once: the chat is free, the owner's
// places are given back, and the next message is answered. A 200 stream cut off part-way does the same, as before.
// (The model's own count, modelInUse, shows only in how a model search picks its words; on the stand-in fleet that is
// always "words", since the stand-in model streams every answer and the search reaches Hugging Face, so /health's
// replying and a fifth chat stand for it.)
test('a model answer cut off part-way ends the reply once: the chat is free, the owner\'s places come back, and the next message is answered', { timeout: 240000 * SLOW }, async t => {
  script([]);
  t.after(() => rmSync(join(T.fleet.dir, 'model-fail'), { force: true }));
  const cutOff = async (mode, text) => {
    writeFileSync(join(T.fleet.dir, 'model-fail'), mode);
    const chat = await newChat(), res = await api(`/chats/${chat}/messages`, { method: 'POST', body: { text } });
    assert.equal(res.status, 200, res.text);
    const events = sseEvents(res.text);
    assert.equal(events.filter(e => e.type === 'error').length, 1, res.text);
    assert.ok(!events.some(e => e.type === 'done'), res.text);
    assert.deepEqual((await chatMessages(chat)).map(m => [m.role, Boolean(m.error)]), [['user', false], ['assistant', true]]);
    assert.equal((await api(`/chats/${chat}`)).json.replying, false);
    assert.equal((await api('/health')).json.replying, 0);
    return chat;
  };
  // (four in a row: each one stayed "still answering" for good before, and four took every place the owner has)
  const chats = [];
  for (let i = 0; i < 4; i++) chats.push(await cutOff('cut-off', `hello number ${i}`));
  assert.ok((await say(chats[0], 'hello again')).text, 'the same chat answers');
  assert.ok((await say(await newChat(), 'hello from a fifth chat')).text, 'a fifth chat answers');
  const half = await cutOff('cut-off-200', 'a stream cut off');
  assert.ok((await say(half, 'hello again')).text, 'the chat answers after a cut-off stream');
});

test('a typed yes to Sparkie\'s question keeps the request going', { timeout: 300000 * SLOW }, async () => {
  const words = `stop ${RADIX} on spark 4, then tell me how it went`;
  // (the carry-on turn restarts it, which the words didn't ask for: a button)
  script([
    { match: `^${esc(words)}$`, calls: [{ name: 'stop_model', arguments: { spark: 'spark4', container: RADIX } }] },
    { match: '^\\[Spark Console\\] What you started', calls: [{ name: 'restart_model', arguments: { spark: 'spark4', container: RADIX } }] },
  ]);
  const chat = await newChat();
  await say(chat, words);
  await waitFor(async () => (await chatMessages(chat)).some(m => (m.choices || []).some(c => c.state === 'open' && /^Restart /.test(c.label))), { timeout: 120000, what: 'Sparkie\'s question' });
  script([{ match: '^\\[Spark Console\\] What you started', calls: [] }]);
  assert.match((await say(chat, 'yes')).text, /under way/);
  await restarted(chat);
  const autos = async () => (await chatMessages(chat)).filter(m => m.role === 'user' && m.auto).length;
  await waitFor(async () => (await autos()) === 2, { timeout: 60000, what: 'Sparkie carrying on after the yes' });
  assert.equal(stateOf('spark4', RADIX), 'running');
  await settled(chat);
});

// A1: the owner's /stop.
test('/stop during a lookup: the change asked for in the same round never runs, and the model isn\'t asked again', { timeout: 120000 * SLOW }, async t => {
  const words = `read the log of ${RADIX} on spark 4 and stop it`;
  writeFileSync(mock4('slow-container-logs'), String(6 * SLOW));
  t.after(() => rmSync(mock4('slow-container-logs'), { force: true }));
  script([{ match: `^${esc(words)}$`, calls: [{ name: 'container_logs', arguments: { spark: 'spark4', container: RADIX } }, { name: 'stop_model', arguments: { spark: 'spark4', container: RADIX } }] }]);
  const chat = await newChat();
  const pending = say(chat, words).then(() => null, e => e);
  await waitFor(() => requests().some(x => x.words === words), { what: 'the turn reaching the model' });
  await sleep(1500);
  assert.match((await say(chat, '/stop')).text, /^\/stop\nStopped\./);
  await waitFor(async () => (await api(`/chats/${chat}`)).json.replying === false, { timeout: 12000 * SLOW, what: 'the chat free' });
  await pending;
  assert.ok(!auditLines().some(l => l.chat === chat && l.action === 'stop_model'), 'the stop never ran');
  assert.equal(stateOf('spark4', RADIX), 'running');
  assert.equal(requests().filter(x => x.words === words).length, 1, 'the model was asked once');
  const m = (await chatMessages(chat)).find(x => x.role === 'assistant' && !x.notice);
  assert.equal(m.error, 'Stopped at your word.');
  assert.deepEqual(m.tools.map(x => [x.name, x.ok]), [['container_logs', true], ['stop_model', false]]);
});

// (last: it leaves the stand-in model stopped)
test('/stop ends the carrying on: the stop already started finishes and posts its result; no carry-on turn follows', { timeout: 240000 * SLOW }, async t => {
  const words = `stop ${RADIX} on spark 4, then start it again`;
  script([
    { match: `^${esc(words)}$`, calls: [{ name: 'stop_model', arguments: { spark: 'spark4', container: RADIX } }] },
    { match: '^\\[Spark Console\\] What you started', calls: [{ name: 'restart_model', arguments: { spark: 'spark4', container: RADIX } }] },
  ]);
  writeFileSync(mock4('slow-stop'), '3');
  t.after(() => rmSync(mock4('slow-stop'), { force: true }));
  const chat = await newChat();
  const r = await say(chat, words);
  assert.deepEqual(r.message.tools.map(x => [x.name, x.outcome]), [['stop_model', 'started']]);
  assert.match((await say(chat, '/stop')).text, /^\/stop\nStopped\./);
  await waitFor(async () => (await chatMessages(chat)).some(m => m.notice && /^Done: stopping /.test(m.content)), { timeout: 120000, what: 'the stop\'s result' });
  assert.notEqual(stateOf('spark4', RADIX), 'running');
  await sleep(3000 * SLOW);
  assert.ok(!(await chatMessages(chat)).some(m => m.auto), 'no carry-on turn');
  assert.ok(!auditLines().some(l => l.chat === chat && l.action === 'restart_model'));
});

// F20: a workflow's steps are Sparkie's own writing. From the owner's chat they're saved at once only when every step's
// model, container and Sparks are in the owner's words, nothing outside was read and the name is new; otherwise it's one
// button whose label lists the steps as Spark Console built them from the arguments.
test('save_workflow from chat: steps the owner named are saved at once; after reading a log, with a step they never named, or over a saved name, it is a button that lists the steps', { timeout: 180000 * SLOW }, async () => {
  const QWEN = 'sc-Qwen--Qwen3-32B';
  const stopRadix = { action: 'stop_model', args: { spark: 'spark4', container: RADIX } }, stopQwen = { action: 'stop_model', args: { spark: 'spark3', container: QWEN } };
  const fourWords = `make a workflow called quiet four that stops ${RADIX} on spark 4`;
  script([
    { match: '^make a workflow called log mode', rounds: [[{ name: 'container_logs', arguments: { spark: 'spark4', container: RADIX } }], [{ name: 'save_workflow', arguments: { title: 'log mode', steps: [stopRadix] } }]] },
    { match: '^make a workflow called quiet both', calls: [{ name: 'save_workflow', arguments: { title: 'quiet both', steps: [stopRadix, stopQwen] } }] },
    { match: `^${esc(fourWords)}$`, calls: [{ name: 'save_workflow', arguments: { title: 'quiet four', steps: [stopRadix] } }] },
  ]);
  const saved = async () => (await call(look, 'workflows', {})).value.saved.map(w => w.title);
  try {
    // 1. After reading a log: a button that lists the steps; nothing saved until it's pressed.
    const chat = await newChat();
    const one = await say(chat, `make a workflow called log mode that stops ${RADIX} on spark 4, the way its log says`);
    assert.deepEqual(one.message.tools.map(t => [t.name, t.outcome ?? null]), [['container_logs', null], ['save_workflow', 'needs-ok']], JSON.stringify(one.message.tools));
    assert.deepEqual(one.message.choices?.map(c => c.label), [`Save the workflow “log mode”: 1. Stop ${RADIX} on Spark 4`]);
    assert.ok(!(await saved()).includes('log mode'), 'not saved by asking');
    const p = await choose(chat, one.message.choices[0].id);
    assert.equal(p.status, 200, p.text);
    assert.ok((await saved()).includes('log mode'), 'saved once pressed');
    // 2. A step the owner never named: a button with both steps.
    const both = await say(await newChat(), `make a workflow called quiet both that stops ${RADIX} on spark 4`);
    assert.deepEqual(both.message.tools.map(t => [t.name, t.outcome ?? null]), [['save_workflow', 'needs-ok']]);
    assert.deepEqual(both.message.choices?.map(c => c.label), [`Save the workflow “quiet both”: 1. Stop ${RADIX} on Spark 4; 2. Stop ${QWEN} on Spark 3`]);
    assert.ok(!(await saved()).includes('quiet both'));
    // 3. Every step named, nothing outside read, a new name: saved at once.
    const four = await say(await newChat(), fourWords);
    assert.deepEqual(four.message.tools.map(t => [t.name, t.ok, t.outcome ?? null]), [['save_workflow', true, 'saved']]);
    assert.ok(!four.message.choices?.length, JSON.stringify(four.message.choices));
    assert.ok((await saved()).includes('quiet four'));
    // 4. The same again: it would replace the saved one, so it asks, and says so.
    const again = await say(await newChat(), fourWords);
    assert.deepEqual(again.message.tools.map(t => [t.name, t.outcome ?? null]), [['save_workflow', 'needs-ok']]);
    assert.match(again.message.choices?.[0]?.label || '', / \(replaces the one saved now\)$/);
  } finally {
    script([]);
    for (const name of ['log mode', 'quiet both', 'quiet four']) await call(act.token, 'forget_workflow', { name }).catch(() => {});
  }
});

// The button that saves a workflow lists its steps from their arguments: a key in a step's setting is masked there, so
// it never reaches the page or chats.json (copied to another Spark every day).
test('save_workflow: a key in a step’s setting is never on its button or in chats.json', { timeout: 90000 * SLOW }, async () => {
  const FAKE = 'sk-fake1234567890abcdefghij';   // not a real key
  const step = { action: 'keep_running', args: { spark: 'spark3', container: 'litellm', image: 'ghcr.io/berriai/litellm:main-stable', port: '4000', env: [`LITELLM_MASTER_KEY=${FAKE}`] } };
  script([{ match: '^save my litellm setup', calls: [{ name: 'save_workflow', arguments: { title: 'llm proxy', steps: [step] } }] }]);
  try {
    const d = await say(await newChat(), `save my litellm setup as a workflow called llm proxy, with LITELLM_MASTER_KEY=${FAKE}`);
    assert.deepEqual(d.message.tools.map(t => [t.name, t.outcome ?? null]), [['save_workflow', 'needs-ok']], JSON.stringify(d.message.tools));
    const label = d.message.choices?.[0]?.label || '';
    assert.match(label, /^Save the workflow “llm proxy”: 1\. Keep an app running \(spark spark3, container litellm, image ghcr\.io\/berriai\/litellm:main-stable, port 4000, env \["LITELLM_MASTER_KEY=\[hidden/);   // (masked, then cut at 140 characters)
    assert.ok(!label.includes(FAKE.slice(0, 7)), label);
    assert.ok(!readFileSync(join(T.fleet.stateDir, 'chats.json'), 'utf8').includes(FAKE.slice(3, 15)), 'a piece of the key is in chats.json');
  } finally { script([]); }
});

// F20: chats.json is copied to another Spark every day, so what is saved has keys hidden; the turn itself got them.
test('a key typed in a chat, or repeated in Sparkie\'s answer, is hidden in the saved chat', { timeout: 90000 * SLOW }, async () => {
  script([]);
  const words = 'keep hf_abcdefghijklmnopqrstuvwxyz654321 for downloads, and the app has WEBUI_SECRET_KEY=abcd1234efgh5678';
  const from = requests().length, chat = await newChat();
  await say(chat, words);
  const file = readFileSync(join(T.fleet.stateDir, 'chats.json'), 'utf8');
  for (const secret of ['hf_abcdefghijklmnopqrstuvwxyz654321', 'abcd1234efgh5678']) assert.ok(!file.includes(secret), `${secret} in chats.json`);
  const msgs = await chatMessages(chat);
  assert.equal(msgs.find(m => m.role === 'user').content, 'keep [hidden] for downloads, and the app has WEBUI_SECRET_KEY=[hidden]');
  assert.match(msgs.find(m => m.role === 'assistant').content, /WEBUI_SECRET_KEY=\[hidden\]/);
  assert.ok(requests().slice(from).some(q => q.words.includes('hf_abcdefghijklmnopqrstuvwxyz654321')), 'the model got the words as typed');
});
