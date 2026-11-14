// ask_sparkie: another agent talks with Sparkie in plain words through the agent door (and `spark ask` in the CLI).
// {message} starts a conversation tagged with the agent; {conversation} waits for or fetches the answer;
// {conversation, choice} takes one of Sparkie's buttons (a key the owner let act only). The answer is
// {conversation, status: answered|thinking|failed, reply, looked, choices?, next}. Sparkie uses its own tools with the
// agent's rights, the owner sees these conversations in Sparkie's list, and each call is an audit line.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';
import { T, useFleet, api, call, createKey, createActKey, deleteKey, auditLines, chatMessages, waitFor, sleep, CLI, ASK, SLOW } from './lib.mjs';

const keys = {};
// (knowledge: Sparkie traces a container an agent names through the watcher's record, so its stop runs at once)
useFleet({ watchMs: 60000, knowledge: true }, async () => {
  keys.look = await createKey('ask-look');
  keys.act = await createActKey('ask-act');
  keys.other = await createActKey('ask-other');
});
const home = mkdtempSync(join(tmpdir(), 'spark-ask-home-'));
after(() => rmSync(home, { recursive: true, force: true }));

const mock = (spark, file) => join(T.fleet.root, spark, '.mock', file);
const stateOf = (spark, name) => readFileSync(mock(spark, 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];
const ask = (key, args) => call(key.token, ASK, args);
async function answer(key, args) {
  const r = await ask(key, args);
  assert.equal(r.isError, false, `${JSON.stringify(args)}: ${r.text}`);
  return r.value;
}
const refused = async (key, args, code, re) => {
  const r = await ask(key, args);
  assert.equal(r.isError, true, `${JSON.stringify(args)} should be refused: ${r.text}`);
  assert.match(r.text, new RegExp(`^\\[${code}(, retry later)?\\] `), r.text);
  if (re) assert.match(r.text, re);
  return r.text;
};
// Polls a conversation until its reply matches.
const until = (key, conversation, re, timeout = 60000) => waitFor(async () => { const v = await answer(key, { conversation }); return re.test(v.reply || '') && v; },
  { timeout, every: 1000, what: `a reply matching ${re}` });
const TESTORG = 'sc-testorg--Qwen3.8-27B-abliterated-GGUF';

// An answer that takes 45 s, through the CLI: the first call comes back "thinking" after 40 s and `spark ask` calls again.
async function longAnswer() {
  const env = { PATH: process.env.PATH, HOME: home, SPARK_CONSOLE_URL: T.mcp, SPARK_CONSOLE_KEY: keys.other.token };
  const cli = new Promise(resolve => execFile(process.execPath, [CLI, 'ask', 'hello, take 45 seconds'], { env, timeout: 110000 * SLOW },
    (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr })));
  // While it's answering, the conversation takes no other message.
  const conv = await waitFor(async () => (await api('/chats')).json.chats.find(c => c.agent === keys.other.name && /take 45 seconds/.test(c.title)), { timeout: 10000, what: 'the conversation' });
  assert.equal(conv.replying, true);
  await refused(keys.other, { conversation: conv.id, message: 'are you there?' }, 'conflict', /still answering/);
  const r = await cli;
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /Sparkie is still answering …/);
  assert.match(r.stdout, /You asked: \*\*hello, take 45 seconds\*\*/);
  assert.match(r.stdout, new RegExp(`\\(conversation ${conv.id}\\)`));
}

// (two agents at a time at most: 'talking' and the slow answer run side by side, then the rest)
describe('ask_sparkie', { concurrency: 1 }, () => {
 describe('talking, and a slow answer', { concurrency: true }, () => {
  describe('talking', { concurrency: 1 }, () => {
    test('{message} → a new conversation tagged with the agent: the answer, what Sparkie looked at, what to do next', { timeout: 60000 * SLOW }, async () => {
      const v = await answer(keys.look, { message: 'what\'s running?' });
      assert.match(v.conversation, /^sc_[0-9a-f]{16}$/);
      assert.equal(v.status, 'answered');
      assert.match(v.reply, /running_models said: /);
      assert.deepEqual(v.looked, ['running_models']);
      assert.ok(!('choices' in v));
      assert.equal(typeof v.next, 'string');
      // The owner sees it in Sparkie's list, with the agent's name; its messages say who sent them.
      const listed = (await api('/chats')).json.chats.find(c => c.id === v.conversation);
      assert.equal(listed?.agent, keys.look.name);
      assert.ok(listed.title.startsWith(`${keys.look.name}: `), listed.title);
      const msgs = await chatMessages(v.conversation);
      assert.deepEqual([msgs[0].role, msgs[0].from, msgs[0].content], ['user', keys.look.name, 'what\'s running?']);
      assert.equal(msgs[1].role, 'assistant');
      // {conversation} alone fetches the same answer.
      const again = await answer(keys.look, { conversation: v.conversation });
      assert.deepEqual([again.status, again.reply], ['answered', v.reply]);
      const lines = auditLines().filter(l => l.action === ASK && l.agent === keys.look.id && l.conversation === v.conversation);
      assert.equal(lines.length, 2, JSON.stringify(lines));
      assert.ok(lines.every(l => l.ok && l.name === keys.look.name && Number.isFinite(l.ms)));
      assert.deepEqual(lines[0].args, { message: 'what\'s running?' });
      // A message continuing it.
      const more = await answer(keys.look, { conversation: v.conversation, message: 'and on spark 4?' });
      assert.equal(more.conversation, v.conversation);
      assert.match(more.reply, /You asked: \*\*and on spark 4\?\*\*/);
      assert.equal((await chatMessages(v.conversation)).length, 4);
    });

    test('a key that only looks: Sparkie turns its change requests down in its reply, and nothing changes', { timeout: 60000 * SLOW }, async () => {
      const before = stateOf('spark3', 'sc-gpt-oss-20b');
      const v = await answer(keys.look, { message: 'start gpt-oss-20b on spark 3' });
      assert.equal(v.status, 'answered');
      assert.deepEqual(v.looked, ['start_model']);
      assert.match(v.reply, /start_model said: \[error\] This agent may look but not change things/);
      assert.ok(!v.choices);
      assert.equal(stateOf('spark3', 'sc-gpt-oss-20b'), before);
    });

    test('another agent\'s conversation, or the owner\'s own chat, isn\'t there for it (404)', async () => {
      const v = await answer(keys.look, { message: 'hello' });
      await refused(keys.other, { conversation: v.conversation }, 'not_found', /no conversation with that id/);
      await refused(keys.other, { conversation: v.conversation, message: 'hi' }, 'not_found');
      const own = (await api('/chats', { method: 'POST', body: {} })).json.id;
      await refused(keys.look, { conversation: own }, 'not_found');
      await refused(keys.look, { conversation: 'sc_0123456789abcdef' }, 'not_found');
    });

    test('its arguments are checked', async () => {
      for (const [args, re] of [[{}, /Send a message/], [{ choice: '0123456789' }, /Send a message/],
        [{ conversation: 'sc_0123456789abcdef', message: 'x', choice: '0123456789' }, /a choice or a message, not both/],
        [{ conversation: 'nope' }, /conversation/], [{ message: '' }, /message/], [{ message: 'x'.repeat(4001) }, /message/],
        [{ message: 'hi', bogus: 1 }, /Unknown argument: bogus/], [{ message: 42 }, /message should be text/]]) {
        await refused(keys.look, args, 'invalid', re);
      }
    });
  });

  test('an answer that takes over 40 s comes back as "thinking"; `spark ask` keeps waiting and prints the reply', { timeout: 120000 * SLOW }, longAnswer);
 });

  describe('changes', { concurrency: 1 }, () => {
    test('an agent that can act: a change that wasn\'t clearly asked for comes back as choices; {conversation, choice} takes one, and the result is posted later', { timeout: 90000 * SLOW }, async () => {
      const v = await answer(keys.act, { message: `should I stop ${TESTORG} on spark 3?` });
      assert.equal(v.status, 'answered');
      assert.deepEqual(v.looked, ['stop_model']);
      assert.equal(v.choices.length, 1);
      assert.match(v.choices[0].id, /^[a-f0-9]{10}$/);
      assert.equal(v.choices[0].label, `Stop ${TESTORG} on Spark 3`);
      assert.match(v.next, /choice/);
      assert.equal(stateOf('spark3', TESTORG), 'running', 'asking stops nothing');
      // Another agent can't take it, even naming the conversation.
      await refused(keys.other, { conversation: v.conversation, choice: v.choices[0].id }, 'not_found');
      const t = await answer(keys.act, { conversation: v.conversation, choice: v.choices[0].id });
      assert.equal(t.status, 'answered');
      assert.match(t.reply, new RegExp(`Stop ${TESTORG.replace(/[.]/g, '\\.')} on Spark 3: under way`));
      assert.ok(!t.choices, 'taken');
      const line = auditLines().findLast(l => l.action === 'stop_model' && l.chat === v.conversation);
      assert.deepEqual([line.via, line.actor, line.outcome], ['agent', keys.act.name, 'started']);
      await refused(keys.act, { conversation: v.conversation, choice: v.choices[0].id }, 'conflict', /expired/);
      const done = await until(keys.act, v.conversation, /Done: stopping /);
      assert.match(done.reply, /Done: stopping .*Qwen3\.8-27B-abliterated-GGUF on Spark 3 finished\./);
      assert.equal(stateOf('spark3', TESTORG), 'exited');
    });

    test('a start whose plan stops one of Spark Console\'s models runs straight away and says so; a failed operation\'s result is posted in the conversation too', { timeout: 90000 * SLOW }, async () => {
      const v = await answer(keys.act, { message: 'start gemma-3-12b-it on spark 4' });
      assert.match(v.reply, /start_model said: \{"outcome":"started",.*"stops":\["spark4\/sc-RadixArk--Qwen3\.8-27B-NVFP4"\]/);
      assert.ok(!v.choices?.length, JSON.stringify(v.choices));
      const failed = await until(keys.act, v.conversation, /failed: /);
      assert.match(failed.reply, /Starting gemma-3-12b-it on Spark 4 failed: The model server stopped while loading/);
      const notice = (await chatMessages(v.conversation)).find(m => m.notice && /failed/.test(m.content));
      assert.deepEqual([notice.role, notice.status], ['assistant', 'failed']);
      assert.match(notice.operation, /^[0-9a-f]{12}$/);
    });

    test('only a key that may act can take a choice: one made look-only since gets Sparkie\'s refusal', { timeout: 60000 * SLOW }, async () => {
      const k = await createActKey('ask-flip');
      const v = await answer(k, { message: 'should I stop sc-nothing-here on spark 4?' });
      assert.equal(v.choices?.length, 1, JSON.stringify(v));
      assert.equal((await api(`/agents/${k.id}`, { method: 'PUT', body: { act: false } })).status, 200);
      const t = await answer(k, { conversation: v.conversation, choice: v.choices[0].id });
      assert.match(t.reply, /Couldn’t do “Stop sc-nothing-here on Spark 4”: This agent can look but not change things/);
    });
  });

  // A-1 (review with Astra, 2026-11-14): the owner removes an agent, or makes it look-only, while Sparkie is still
  // answering it. A change later in that reply is refused; what already runs keeps running and posts its result (R9).
  describe('an agent taken away while Sparkie answers it', { concurrency: 1 }, () => {
    const RADIX = 'sc-RadixArk--Qwen3.8-27B-NVFP4', GPT = 'sc-gpt-oss-20b';
    const requests = () => { try { return readFileSync(join(T.fleet.dir, 'model-requests.jsonl'), 'utf8'); } catch { return ''; } };
    const running = () => waitFor(() => stateOf('spark4', RADIX) === 'running', { timeout: 60000, what: `${RADIX} running` });
    // The agent asks for a stop it may make; the stand-in model holds its first answer while the owner takes the key away.
    async function takenAway(prefix, takeAway) {
      await running();
      const k = await createActKey(prefix);
      const words = `Stop ${RADIX} on spark 4; take ${Math.round(3 * SLOW) + 3} seconds.`;
      const asked = ask(k, { message: words });
      await waitFor(() => requests().includes(words), { every: 50, what: 'the request at the model' });
      assert.equal((await takeAway(k)).status, 200);
      const r = await asked;
      assert.equal(r.isError, false, r.text);
      assert.match(r.value.reply, /stop_model said: \[error\] This agent was removed \(or may only look now\), so nothing was changed\./);
      const conv = r.value.conversation, m = (await chatMessages(conv)).find(x => x.role === 'assistant' && !x.notice);
      assert.deepEqual(m.tools.map(t => [t.name, t.ok]), [['stop_model', false]]);
      assert.ok(!auditLines().some(l => l.action === 'stop_model' && l.chat === conv && l.ok), 'no stop on the record');
      await sleep(2000);
      assert.equal(stateOf('spark4', RADIX), 'running');
    }
    test('an agent removed while Sparkie is answering it: the change in that reply is refused and nothing stops', { timeout: 90000 * SLOW },
      () => takenAway('ask-gone', k => deleteKey(k.id)));
    test('an agent made look-only while Sparkie is answering it: the change in that reply is refused and nothing stops', { timeout: 90000 * SLOW },
      () => takenAway('ask-down', k => api(`/agents/${k.id}`, { method: 'PUT', body: { act: false } })));

    test('an undo it asked for keeps running after the agent is removed: what it stopped runs again', { timeout: 300000 * SLOW }, async t => {
      const job = async op => waitFor(async () => { const j = (await api(`/jobs/${op}`)).json; return j?.status !== 'running' && j; }, { timeout: 180000, what: `operation ${op}` });
      // The testorg model runs on Spark 3 (the owner's own restart; a test above stopped it).
      if (stateOf('spark3', TESTORG) !== 'running') {
        const r = await api('/actions/restart_model', { method: 'POST', body: { spark: 'spark3', container: TESTORG } });
        assert.equal((await job(r.json?.operation)).status, 'completed', r.text);
      }
      const k = await createActKey('ask-undo');
      // Its start stops the testorg model for the port: that is this conversation's change, and "undo that" reverses it
      // in two steps, the stop of what it started, then the start of what it stopped.
      const v = await answer(k, { message: 'start gpt-oss-20b on spark 3' });
      assert.match(v.reply, /start_model said: \{"outcome":"started"/, v.reply);
      assert.match((await until(k, v.conversation, /Done: | failed: /, 180000)).reply, /Done: /);
      assert.deepEqual([stateOf('spark3', GPT), stateOf('spark3', TESTORG)], ['running', 'exited']);
      writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify([{ match: '^undo that', calls: [{ name: 'undo_last_change', arguments: {} }] }]));
      writeFileSync(mock('spark3', 'slow-stop'), String(Math.round(3 * SLOW) + 3));
      t.after(() => { rmSync(join(T.fleet.dir, 'model-script.json'), { force: true }); rmSync(mock('spark3', 'slow-stop'), { force: true }); });
      const u = await answer(k, { conversation: v.conversation, message: 'undo that' });
      assert.match(u.reply, /undo_last_change said: \{"outcome":"started"/, u.reply);
      // (removed while the undo's first step is still going)
      assert.equal(stateOf('spark3', GPT), 'running');
      assert.equal((await deleteKey(k.id)).status, 200);
      const done = await waitFor(async () => (await chatMessages(v.conversation)).find(m => m.notice && /^(?:Done: undoing|Undoing)/.test(m.content)), { timeout: 180000, what: 'the undo’s result' });
      assert.match(done.content, /^Done: undoing the last change finished/, done.content);
      assert.deepEqual([stateOf('spark3', GPT), stateOf('spark3', TESTORG)], ['exited', 'running']);
    });

    // (last: it leaves RADIX stopped)
    test('an operation it started keeps running after the agent is removed, and its result is posted in the conversation', { timeout: 90000 * SLOW }, async t => {
      await running();
      writeFileSync(mock('spark4', 'slow-stop'), String(Math.round(3 * SLOW) + 3));
      t.after(() => rmSync(mock('spark4', 'slow-stop'), { force: true }));
      const k = await createActKey('ask-op');
      const v = await answer(k, { message: `Stop ${RADIX} on spark 4` });
      assert.match(v.reply, /stop_model said: \{"outcome":"started"/, v.reply);
      const op = auditLines().findLast(l => l.action === 'stop_model' && l.chat === v.conversation && l.ok)?.operation;
      assert.match(op || '', /^[0-9a-f]{12}$/);
      assert.equal((await api(`/jobs/${op}`)).json.status, 'running');
      assert.equal((await deleteKey(k.id)).status, 200);
      const done = await waitFor(async () => (await chatMessages(v.conversation)).find(m => m.notice && m.operation === op), { timeout: 60000, what: 'the stop’s result in the conversation' });
      assert.deepEqual([done.status, /^Done: stopping /.test(done.content)], ['completed', true], done.content);
      assert.equal(stateOf('spark4', RADIX), 'exited');
    });
  });


  test('agents answer in slots of their own: one conversation at a time each, two agents at once, never taking the owner\'s', { timeout: 60000 * SLOW }, async () => {
    // (long enough that both are still answering when the third agent asks, even on a slow machine)
    const hold = `hello, take ${Math.round(3 * SLOW) + 3} seconds`;
    const slow = (key, words) => ask(key, { message: words });
    const first = slow(keys.look, hold);
    await new Promise(r => setTimeout(r, 500));
    await refused(keys.look, { message: 'and another thing' }, 'busy', /answer/);
    const second = slow(keys.act, hold);
    await new Promise(r => setTimeout(r, 500));
    await refused(keys.other, { message: 'me too' }, 'busy');
    // The owner's own chats aren't held up by them.
    const chat = (await api('/chats', { method: 'POST', body: {} })).json.id;
    const owner = await api(`/chats/${chat}/messages`, { method: 'POST', body: { text: 'hello' } });
    assert.equal(owner.status, 200, owner.text);
    for (const r of await Promise.all([first, second])) assert.equal(r.isError, false, r.text);
    assert.equal((await answer(keys.other, { message: 'now?' })).status, 'answered');
  });
});
