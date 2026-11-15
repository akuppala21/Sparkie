// Covers: Sparkie in the owner's chats: the stream starts with `started`; `tool` events, results in the answer, `tools`
// on the saved message; every action can be called (a tool that doesn't exist → `[error] No tool called …`); a static
// system prompt, the fleet record in the last user message. Requests run at once (a polite
// "can you …" too), also after reading a log; questions, "if …", "whether to …", "could you tell me …", "don't …", "…,
// actually don't", "keep … running", a model or container the words don't point to (a tie too), "everything on spark N"
// said in another message and more than 4 changes become a question with a button (`needs-ok`, labels only, no ids for
// the model; a model passing an id gets 403). A Spark the owner didn't name is dropped (the console picks one). A start
// that stops one of the console's models runs and says what it stopped. Buttons: `POST /chats/<id>/choose` (checks;
// runs as the owner, a notice with the outcome, the operation's result posted later); a whole-message "yes" presses the
// one open button without the model (also after an operation's result came in), "yes but …" doesn't; questions from
// actions and follow-up questions are buttons; "no" puts them away; another chat's button can't be pressed. Busy (409) and
// more than 4 at once (429) are plain HTTP errors.
//
// Sparkie in the owner's chats. The model is offered the core and its request's groups (R46) as OpenAI tools; its
// tool_calls run through the same checks as an agent's (runAction, via 'sparkie'), each shows on the page as a `tool`
// event, and the saved answer lists the tools it used. A change runs at once when the owner's message asks for that kind
// of change (a polite "can you …" counts; questions, "if …", "whether to …" and "could you tell me …" don't) and its
// target is what the words name (the container they point to; the model they match best, on its own). Reading a log or
// a web page first doesn't hold a workflow back (docs/contract.md 8.5 is for scripts). Anything unclear becomes a
// question with a button the owner presses (POST /chats/<id>/choose) or answers with a plain "yes"; the model never
// sees choice ids. A start that stops one of Spark Console's own models does it and says so (8.4).
// Operations started from a chat post their result there when they finish.
// The stand-in model (mock/model.mjs) calls tools from patterns in the owner's words, or from rules a test writes to
// $MOCK_DIR/model-script.json (a model misled by what it read, or one that looks something up and then acts).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, call, createKey, MEMBER, SPARKIE_TOOLS, CORE_TOOLS, TOOL_CAP, waitFor, auditLines, newChat, say, sseEvents, chatMessages, choose, SLOW } from './lib.mjs';

let look, small;   // small: a chat for the tests that don't care which
// knowledge: what the watcher knows about the containers is seeded (its first look is 15 s in): a container named in
// the owner's words is traced through it.
useFleet({ watchMs: 60000, knowledge: true }, async () => { look = (await createKey('sparkie-look')).token; small = await newChat(); });

const mock = (spark, file) => join(T.fleet.root, spark, '.mock', file);
const stateOf = (spark, name) => readFileSync(mock(spark, 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];
const requests = () => (existsSync(join(T.fleet.dir, 'model-requests.jsonl')) ? readFileSync(join(T.fleet.dir, 'model-requests.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []);
// What the misled model does: [{ match, calls: [{ name, arguments }] }] or [{ match, rounds: [[calls], [calls]] }].
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const noScript = () => rmSync(join(T.fleet.dir, 'model-script.json'), { force: true });
async function withScript(rules, fn) { script(rules); try { return await fn(); } finally { noScript(); } }
async function tool(name, args) {
  const r = await call(look, name, args);
  assert.equal(r.isError, false, `${name}: ${r.text}`);
  return r.value;
}
const operations = async () => (await tool('recent_operations', { limit: 50 })).operations;
// The tool results the model got back for one message (from the stand-in's log), in order.
const resultsFor = (from, words) => requests().slice(from).filter(x => x.words === words && x.lastRole === 'tool').flatMap(x => x.results.map(r => r.content));
// Waits for a notice (an operation's result) in a chat.
const notice = (chat, re, timeout = 60000) => waitFor(async () => (await chatMessages(chat)).find(m => m.notice && re.test(m.content)), { timeout, every: 500, what: `a notice ${re}` });
const RADIX = 'sc-RadixArk--Qwen3.8-27B-NVFP4', NOTHING = 'sc-nothing-here';
const isProposal = text => /"outcome":"needs-ok"/.test(text);
// restart_model on sc-gpt-oss-20b (running on spark2): run at once, there's nothing to do; as a proposal, it's a button.
const ran = text => /"outcome":"already"/.test(text);
const GPT = 'sc-gpt-oss-20b';

describe('Sparkie in the owner\'s chats', { concurrency: true }, () => {
  // (each group runs its own tests one at a time: at most one answer each, within the owner's 4 at once)
  describe('the tools, and the two lanes for a change', { concurrency: 1 }, () => {
    test('"what\'s running?" → running_models: the stream starts with `started`, a tool event, the result in the answer, and the saved message lists it', { timeout: 60000 * SLOW }, async () => {
      const chat = await newChat(), from = requests().length;
      const r = await say(chat, 'what\'s running?');
      const asked = requests().slice(from).filter(x => x.words === 'what\'s running?');
      assert.deepEqual(r.events[0], { type: 'started' });
      assert.equal(r.tools.length, 1, JSON.stringify(r.tools));
      const t = r.tools[0];
      assert.deepEqual({ name: t.name, title: t.title, ok: t.ok, change: t.change }, { name: 'running_models', title: 'Running models', ok: true, change: false });
      assert.ok(Number.isFinite(t.ms));
      assert.ok(r.events.indexOf(t) < r.events.findIndex(e => e.type === 'done'));
      assert.match(r.text, /running_models said: \{"observedAt"/);
      assert.deepEqual(r.message.tools.map(x => ({ name: x.name, ok: x.ok, change: x.change })), [{ name: 'running_models', ok: true, change: false }]);
      // The model was offered the core (R46: these words open no group), no more than the cap, then got the result back.
      assert.deepEqual([...asked[0].tools].sort(), [...CORE_TOOLS].sort());
      assert.ok(asked[0].tools.length <= TOOL_CAP, String(asked[0].tools.length));
      assert.equal(asked[0].toolChoice, 'auto');
      assert.equal(asked[1].lastRole, 'tool');
      assert.match(asked[1].results[0].content, /"models"/);
      // The system prompt is the same every time: no snapshot or record in it.
      assert.equal(asked[0].system, asked[1].system);
      assert.doesNotMatch(asked[0].system, /record|snapshot/i);
      const saved = (await api(`/chats/${chat}`)).json.messages;
      assert.equal(saved.length, 2);
      assert.deepEqual(saved[1].tools.map(x => x.name), ['running_models']);
    });
    test('every action can be called, offered or not (workflows and service_logs too); a tool that doesn\'t exist → "[error] No tool called …"', { timeout: 60000 * SLOW }, async () => {
      const from = requests().length, words = 'use the other tools please';
      const r = await withScript([{ match: '^use the other tools', calls: [{ name: 'format_disk', arguments: { spark: 'spark3' }, offered: false },
        { name: 'workflows', arguments: {} }] }], () => say(small, words).catch(e => e));
      assert.ok(!(r instanceof Error), String(r));
      assert.deepEqual(r.tools.map(t => [t.name, t.ok]), [['format_disk', false], ['workflows', true]]);
      const results = resultsFor(from, words);
      assert.match(results[0], /^\[error\] No tool called format_disk\./);
      assert.match(results[1], /"id":"start_model"/);
    });

    // (each one that runs looks at every Spark, which takes a moment, so only a few)
    const RAN = ['Please restart sc-gpt-oss-20b on spark 2.', 'can you restart sc-gpt-oss-20b on spark 2?', 'hey, could you please go restart sc-gpt-oss-20b on spark 2'];
    const PROPOSED = ['should I restart sc-gpt-oss-20b on spark 2?', 'what happens if I restart sc-gpt-oss-20b on spark 2?', 'if it crashes, restart sc-gpt-oss-20b on spark 2',
      'could you tell me whether to restart sc-gpt-oss-20b on spark 2', 'can it restart sc-gpt-oss-20b on spark 2?', 'whether to restart sc-gpt-oss-20b on spark 2 is up to you',
      'Look at spark 2. Tell me if I should restart sc-gpt-oss-20b on spark 2'];
    // Said not to, or both ways in one message: a button, never a refusal.
    const NEGATED = ['Don\'t restart sc-gpt-oss-20b on spark 2', 'Do not restart sc-gpt-oss-20b on spark 2.', 'restart sc-gpt-oss-20b on spark 2, actually don\'t',
      'restart sc-gpt-oss-20b on spark 2, never mind', 'I don\'t want you to restart sc-gpt-oss-20b on spark 2', 'restart sc-gpt-oss-20b on spark 2. Actually, do not restart anything'];
    test('requests run (a polite "can you …" too); questions, "if …", "whether to …", "could you tell me …" and "don\'t …" become a button', { timeout: 60000 * SLOW }, async () => {
      for (const [words, runs] of [...RAN.map(w => [w, true]), ...PROPOSED.map(w => [w, false]), ...NEGATED.map(w => [w, false])]) {
        const from = requests().length;
        const r = await say(small, words);
        assert.deepEqual(r.tools.map(t => t.name), ['restart_model'], words);
        const [result] = resultsFor(from, words);
        if (runs) assert.ok(ran(result), `${words} → should have run: ${result}`);
        else {
          assert.ok(isProposal(result), `${words} → should be a button: ${result}`);
          assert.equal(r.tools[0].ok, true, 'a proposal isn\'t an error');
          assert.deepEqual(r.message.choices.map(c => c.label), ['Restart sc-gpt-oss-20b on Spark 2']);
        }
      }
    });
    test('"keep it running", "leave it alone", "without stopping anything": a stop becomes a button', { timeout: 60000 * SLOW }, async () => {
      const calls = [{ name: 'stop_model', arguments: { spark: 'spark2', container: GPT } }];
      const said = ['keep sc-gpt-oss-20b on spark 2 running and stop sc-gpt-oss-20b on spark 2', 'leave sc-gpt-oss-20b on spark 2 alone, stop sc-gpt-oss-20b on spark 2',
        'stop sc-gpt-oss-20b on spark 2 without stopping anything', 'stop sc-gpt-oss-20b on spark 2 but avoid stopping sc-gpt-oss-20b on spark 2'];
      await withScript(said.map(w => ({ match: `^${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, calls })), async () => {
        for (const words of said) {
          const from = requests().length;
          await say(await newChat(), words);
          const [result] = resultsFor(from, words);
          assert.ok(isProposal(result), `${words} → should be a button: ${result}`);
        }
      });
      assert.equal(stateOf('spark2', GPT), 'running');
    });
    test('the container has to be the one the words point to; "everything on spark N" has to be said in this message', { timeout: 60000 * SLOW }, async () => {
      const restart = { name: 'restart_model', arguments: { spark: 'spark2', container: GPT } };
      await withScript([{ match: '^restart (everything|the gpt-oss)', calls: [restart] },
        { match: '^start the small gpt-oss', calls: [{ name: 'start_model', arguments: { model: 'gpt-oss-120b' } }] },
        { match: '^start gpt-oss-20b please', calls: [{ name: 'start_model', arguments: { model: 'gpt-oss-20b', spark: 'spark4' } }] }], async () => {
        // (each in a chat of its own, except where the message before matters)
        for (const [words, runs] of [['restart everything on spark 2', true], ['restart everything on spark 3', false],
          ['restart the gpt-oss 20b one on spark 2', true], ['restart the gpt-oss one on spark 2', false], // (sc-gpt-oss-120b is there too)
          // A Spark the owner didn't name is dropped (Spark Console picks one): gpt-oss-20b is named, so it runs (it's
          // running already). "the small gpt-oss" matches both gpt-oss models equally: a question.
          ['start the small gpt-oss', false], ['start gpt-oss-20b please', true]]) {
          const from = requests().length;
          await say(await newChat(), words);
          const [result] = resultsFor(from, words);
          assert.ok(runs ? ran(result) : isProposal(result), `${words} → ${runs ? 'run' : 'a button'}: ${result}`);
        }
        // "Everything on spark 2" said in the message before doesn't count.
        const chat = await newChat();
        await say(chat, 'what about everything on spark 2?');
        const from = requests().length;
        await say(chat, 'restart the gpt-oss one');
        assert.ok(isProposal(resultsFor(from, 'restart the gpt-oss one')[0]));
      });
    });
    test('reading outside text first (a container\'s log) doesn\'t hold back a workflow that was asked for', { timeout: 60000 * SLOW }, async () => {
      const words = 'Restart sc-gpt-oss-20b on spark 2 once you\'ve read its logs';
      const from = requests().length;
      const r = await say(small, words);
      assert.deepEqual(r.tools.map(t => t.name), ['container_logs', 'restart_model']);
      const results = resultsFor(from, words);
      assert.match(results[0], /"log"/);
      // It runs (it's running already, so there's nothing to do): no button.
      assert.match(results[1], /"outcome":"already"/);
      assert.ok(!r.message.choices, JSON.stringify(r.message.choices));
    });
    test('a button\'s result holds no ids: the model gets {outcome: "needs-ok", buttons: [label]}; the saved message has the choices', { timeout: 60000 * SLOW }, async () => {
      const chat = await newChat(), words = `should I stop ${NOTHING} on spark 4?`, from = requests().length;
      const r = await say(chat, words);
      const [result] = resultsFor(from, words);
      const v = JSON.parse(result);
      assert.equal(v.outcome, 'needs-ok');
      assert.deepEqual(v.buttons, [`Stop ${NOTHING} on Spark 4`]);
      assert.ok(!('choices' in v) && !('group' in v), result);
      const [c] = r.message.choices;
      assert.deepEqual(Object.keys(c).sort(), ['group', 'id', 'label', 'state']);
      assert.match(c.id, /^[a-f0-9]{10}$/);
      assert.equal(c.state, 'open');
      assert.ok(!requests().slice(from).some(x => JSON.stringify(x).includes(c.id)), 'the model never sees the id');
      assert.ok(!requests().slice(from).some(x => x.results.some(y => /\[not asked\]/.test(y.content))));
    });
    test('the model passing a choice id gets 403; "don\'t stop …" makes a stop a button', { timeout: 60000 * SLOW }, async () => {
      let words = 'pick it for me', from = requests().length;
      await withScript([{ match: '^pick it for me', calls: [{ name: 'start_model', arguments: { choice: 'ffffffffff' } }] }], () => say(small, words));
      assert.match(resultsFor(from, words)[0], /^\[error\] Choices are buttons for whoever asked; don’t pass choice ids\./);
      words = 'Don\'t stop sc-gpt-oss-20b on spark 2, just tell me how it is doing';
      from = requests().length;
      const r = await say(small, words);
      assert.deepEqual(r.tools.map(t => [t.name, t.ok]), [['stop_model', true]]);
      assert.ok(isProposal(resultsFor(from, words)[0]));
      assert.equal(stateOf('spark2', 'sc-gpt-oss-20b'), 'running');
    });
    test('at most four changes per message', { timeout: 60000 * SLOW }, async () => {
      const words = 'clean up spark 4 a lot', from = requests().length;
      const five = n => Array.from({ length: n }, (_, i) => ({ name: 'stop_model', arguments: { spark: 'spark4', container: `sc-nothing-${i}` } }));
      const r = await withScript([{ match: '^clean up spark 4', rounds: [five(4), five(1)] }], () => say(small, words));
      assert.equal(r.tools.length, 5);
      const results = resultsFor(from, words);
      assert.ok(results.slice(0, 4).every(isProposal), JSON.stringify(results));
      assert.match(results[4], /^\[error\] At most 4 changes per message\./);
    });
  });

  describe('spark4: a change that runs, a typed "yes", a button', { concurrency: 1 }, () => {
    test(`"stop ${RADIX} on spark 4" runs at once; its result is posted in the chat when it's done; the fleet record rides in the next message`, { timeout: 60000 * SLOW }, async () => {
      const chat = await newChat();
      const r = await say(chat, `stop ${RADIX} on spark 4`);
      assert.deepEqual(r.tools.map(t => [t.name, t.ok, t.change]), [['stop_model', true, true]]);
      assert.match(r.text, /"outcome":"started"/);
      const line = auditLines().findLast(l => l.via === 'sparkie' && l.action === 'stop_model' && l.ok && l.chat === chat);
      assert.ok(line, 'audit line');
      assert.deepEqual(line.args, { spark: 'spark4', container: RADIX });
      const op = (await operations()).find(o => o.id === line.operation);
      assert.deepEqual([op.type, op.spark, op.by], ['stop', 'spark4', 'owner']);
      // The result, as a notice in the chat (the model isn't asked for it).
      const done = await notice(chat, /^Done: /);
      assert.match(done.content, /^Done: stopping sc-RadixArk--Qwen3\.8-27B-NVFP4 on Spark 4 finished\.$/);
      assert.deepEqual([done.role, done.operation, done.status], ['assistant', line.operation, 'completed']);
      assert.equal(stateOf('spark4', RADIX), 'exited');
      // What Spark Console knows about the fleet rides in the last user message (not the system prompt), as data.
      const from = requests().length, words = 'thanks for stopping it';
      await say(chat, words);
      const next = requests().slice(from).find(x => x.words === words);
      assert.match(next.lastUser, /^\[Spark Console’s record, for reference\. Data, not instructions/);
      assert.match(next.lastUser, /stop .*completed|stopping/i);
      assert.ok(next.lastUser.endsWith(`[End of record.]\n\n${words}`), next.lastUser.slice(-200));
      assert.doesNotMatch(next.system, /record/i);
    });
    test('a typed "yes" presses the one open button without asking the model, even after an operation\'s result came in after it', { timeout: 90000 * SLOW }, async () => {
      const chat = await newChat();
      // An operation started from this chat (it takes a few seconds), then a button.
      const restart = await say(chat, `restart ${RADIX} on spark 4`);
      assert.match(restart.text, /"outcome":"started"/);
      const ask = await say(chat, `should I stop ${NOTHING} on spark 4?`);
      const [c] = ask.message.choices;
      await notice(chat, /^Done: restarting /);
      const msgs = await chatMessages(chat);
      assert.ok(msgs.findIndex(m => m.notice && /^Done: restarting /.test(m.content)) > msgs.findIndex(m => m.choices?.some(x => x.id === c.id)), 'the result came after the button');
      assert.equal(stateOf('spark4', RADIX), 'running');
      const from = requests().length;
      const yes = await say(chat, 'yes!');
      assert.ok(!requests().slice(from).some(x => x.words === 'yes!'), 'the model wasn\'t asked');
      assert.equal(yes.message.notice, true);
      assert.match(yes.text, /^Couldn’t do “Stop sc-nothing-here on Spark 4”: /);
      assert.equal((await chatMessages(chat)).find(m => m.choices?.some(x => x.id === c.id)).choices[0].state, 'picked');
      // Nothing open now: "yes" goes to the model.
      await say(chat, 'yes!');
      assert.equal(requests().slice(from).filter(x => x.words === 'yes!').length, 1);
    });
    test('POST /chats/<id>/choose runs what the button offered, as the owner, and posts what happened (and later the operation\'s result)', { timeout: 60000 * SLOW }, async () => {
      const chat = await newChat();
      const r = await say(chat, `should I stop ${RADIX} on spark 4?`);
      const [c] = r.message.choices;
      assert.equal(c.label, `Stop ${RADIX} on Spark 4`);
      assert.equal(stateOf('spark4', RADIX), 'running', 'asking stops nothing');
      // Checks first: the method, the id, who.
      assert.equal((await api(`/chats/${chat}/choose`)).status, 405);
      for (const choice of ['nope', 'ABCDEF0123', 42]) assert.equal((await choose(chat, choice)).status, 400, String(choice));
      assert.equal((await choose(chat, 'ffffffffff')).status, 409, 'an unknown button');
      const p = await choose(chat, c.id);
      assert.equal(p.status, 200, p.text);
      assert.equal(p.json.outcome, 'started');
      assert.match(p.json.operation, /^[0-9a-f]{12}$/);
      assert.equal(p.json.message.notice, true);
      assert.equal(p.json.message.content, `Stop ${RADIX} on Spark 4: under way. I’ll post the result here when it’s done.`);
      assert.equal(p.json.messages.at(-1).content, p.json.message.content);
      assert.equal(p.json.messages.find(m => m.choices)?.choices[0].state, 'picked');
      const line = auditLines().findLast(l => l.action === 'stop_model' && l.operation === p.json.operation);
      assert.deepEqual([line.via, line.actor, line.chat], ['page', 'owner', chat]);
      assert.match(line.request, /Pressed “Stop sc-RadixArk--Qwen3\.8-27B-NVFP4 on Spark 4”/);
      const done = await notice(chat, /^Done: stopping /);
      assert.equal(done.operation, p.json.operation);
      assert.equal(stateOf('spark4', RADIX), 'exited');
      assert.equal((await choose(chat, c.id)).status, 409, 'pressed twice');
    });
  });

    test('"start gpt-oss-20b on spark 3", whose plan stops one of Spark Console\'s models there, runs straight away and says what it stopped', { timeout: 60000 * SLOW }, async () => {
      const chat = await newChat(), words = 'start gpt-oss-20b on spark 3', from = requests().length;
      const r = await say(chat, words);
      assert.deepEqual(r.tools.map(t => [t.name, t.ok, t.change]), [['start_model', true, true]]);
      const v = JSON.parse(resultsFor(from, words)[0]);
      assert.equal(v.outcome, 'started', JSON.stringify(v));
      assert.deepEqual(v.stops, ['spark3/sc-testorg--Qwen3.8-27B-abliterated-GGUF']);
      assert.ok(!r.message.choices, 'no button');
      const line = auditLines().findLast(l => l.action === 'start_model' && l.operation === v.operation);
      assert.deepEqual([line.via, line.chat, line.outcome], ['sparkie', chat, 'started']);
      const op = (await operations()).find(o => o.id === v.operation);
      assert.deepEqual([op.type, op.model, op.spark, op.by], ['deploy', 'gpt-oss-20b', 'spark3', 'owner']);
      assert.notEqual(op.status, 'failed', JSON.stringify(op));
      // (change.test.mjs follows deploys to the end; this one is left to finish on its own)
    });

  describe('questions from actions become buttons', { concurrency: 1 }, () => {
    test('a question from an action becomes buttons too (no ids for the model); pressing one runs it as the owner', { timeout: 60000 * SLOW }, async () => {
      const chat = await newChat(), words = 'start qwen on spark 4', from = requests().length;
      const r = await say(chat, words);
      const v = JSON.parse(resultsFor(from, words)[0]);
      assert.equal(v.outcome, 'question');
      assert.ok(v.buttons.length >= 2 && v.buttons.every(b => typeof b === 'string'), JSON.stringify(v));
      assert.ok(!('choices' in v), 'no ids');
      assert.deepEqual(r.message.choices.map(c => c.label), v.buttons);
      // With several open, "yes" isn't taken as pressing one: the model gets it.
      const before = requests().length;
      await say(chat, 'yes');
      assert.ok(requests().slice(before).some(x => x.words === 'yes'), 'the model got it');
      const pick = (await chatMessages(chat)).find(m => m.choices).choices.find(c => /Qwen3-30B/.test(c.label));
      assert.equal(pick.state, 'open');
      const p = await choose(chat, pick.id);
      assert.equal(p.status, 200, p.text);
      // Qwen3-30B doesn't fit on spark4: refused for that, which shows the stored arguments (Spark 4 included) were used.
      assert.match(p.json.message.content, /^Couldn’t do “.*Qwen3-30B.*”: Can’t start Qwen3-30B-A3B-Instruct-2507 right now: not enough memory on Spark 4/);
      const states = (await chatMessages(chat)).find(m => m.choices).choices.map(c => c.state);
      assert.deepEqual(states.sort(), ['picked', ...Array(states.length - 1).fill('gone')].sort());
    });
    test('only a whole-message "yes" presses it: "yes but on spark 4", "ok no" and "do it on spark 3 instead" go to the model', { timeout: 60000 * SLOW }, async () => {
      for (const words of ['yes but on spark 4', 'ok no', 'do it on spark 3 instead']) {
        const chat = await newChat();
        const [c] = (await say(chat, `should I stop ${NOTHING} on spark 4?`)).message.choices;
        const from = requests().length;
        await say(chat, words);
        assert.ok(requests().slice(from).some(x => x.words === words), `${words}: the model was asked`);
        const state = (await chatMessages(chat)).find(m => m.choices?.some(x => x.id === c.id)).choices[0].state;
        assert.notEqual(state, 'picked', `${words}: not pressed`);
      }
      for (const words of ['ok thanks', 'do it!']) {
        const chat = await newChat();
        await say(chat, `should I stop ${NOTHING} on spark 4?`);
        const from = requests().length;
        const r = await say(chat, words);
        assert.ok(!requests().slice(from).some(x => x.words === words), `${words}: the model wasn't asked`);
        assert.match(r.text, /^Couldn’t do “Stop sc-nothing-here on Spark 4”: /, words);
      }
    });
    test('a follow-up question from a pressed button comes back as new buttons', { timeout: 60000 * SLOW }, async () => {
      const chat = await newChat();
      const r = await say(chat, 'should I start qwen on spark 4?');
      assert.deepEqual(r.message.choices.map(c => c.label), ['Start qwen on Spark 4']);
      const p = await choose(chat, r.message.choices[0].id);
      assert.equal(p.status, 200, p.text);
      assert.equal(p.json.outcome, 'question');
      assert.match(p.json.message.content, /could be several models/);
      assert.ok(p.json.message.choices.length >= 2 && p.json.message.choices.every(c => c.state === 'open' && /^[a-f0-9]{10}$/.test(c.id)), JSON.stringify(p.json.message));
      assert.notEqual(p.json.message.choices[0].group, r.message.choices[0].group);
    });
    test('"no" puts the buttons away; a button from another chat can\'t be pressed here', { timeout: 60000 * SLOW }, async () => {
      const a = await newChat(), b = await newChat();
      const qa = (await say(a, 'start qwen on spark 4')).message.choices;
      const qb = (await say(b, 'start qwen on spark 4')).message.choices;
      assert.equal((await choose(b, qa[0].id)).status, 409, 'chat a\'s button, pressed in chat b');
      await say(a, 'no, leave it');
      assert.ok((await chatMessages(a)).find(m => m.choices).choices.every(c => c.state === 'gone'));
      for (const c of qa) assert.equal((await choose(a, c.id)).status, 409);
      assert.ok((await chatMessages(b)).find(m => m.choices).choices.every(c => c.state === 'open'), 'chat b\'s are still there');
      assert.equal(qb.length, qa.length);
    });
  });
});

describe('refused before the answer starts: plain HTTP errors, not a stream', () => {
  const send = (chat, text, headers = {}) => api(`/chats/${chat}/messages`, { method: 'POST', body: { text }, headers });
  test('busy in that chat → 409; over the owner\'s 4 answers at once → 429', { timeout: 60000 * SLOW }, async () => {
    const chat = await newChat();
    const first = send(chat, 'hello, take 1 seconds');
    await new Promise(r => setTimeout(r, 400));
    const busy = await send(chat, 'and another thing');
    assert.equal(busy.status, 409, busy.text);
    assert.match(busy.json.error, /still answering/);
    const firstDone = await first;
    assert.equal(sseEvents(firstDone.text)[0].type, 'started');
    const chats = await Promise.all(Array.from({ length: 5 }, () => newChat()));
    const all = await Promise.all(chats.map((c, i) => new Promise(r => setTimeout(r, i * 150)).then(() => send(c, 'hello, take 1 seconds'))));
    assert.deepEqual(all.map(x => x.status).sort(), [200, 200, 200, 200, 429], all.map(x => x.text.slice(0, 80)).join(' | '));
    assert.match(all.find(x => x.status === 429).json.error, /4 answers coming/);
  });
});
