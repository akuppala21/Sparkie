// The brain's tool list (R46, design F 2.4): each round Sparkie's brain is offered the core and the groups the request
// opened, at most TOOL_CAP tools, never every action. The owner's words open groups (GROUP_WORDS), and so does state (an
// operation of the chat running, its last operation failing, a web search this turn); with a third group the oldest
// one opened by words closes; groups last through the request's carry-on turns. Hidden is not forbidden: a call to an
// action that wasn't offered still runs through runAction and opens its group, and guide {tools} opens one. Prompt lines
// follow their tools. The agent door hides nothing. The tested mark (brainReads) covers every group, not just one turn.
// The stand-in brain calls a scripted tool whether or not it was offered, so what is offered is checked here, from what
// the stand-in brain logged (model-requests.jsonl).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { T, useFleet, api, call, rpc, createKey, createActKey, newChat, say, chatMessages, waitFor, auditLines, ALL_TOOLS, CORE_TOOLS, TOOL_CAP, DOOR_READ, DOOR_ACT, ASK, SLOW } from './lib.mjs';
import { startMock } from './start-mock.mjs';
import { brainSent, brainReadsOf } from './lock.mjs';

// (no earlier build to go back to: undo_update answers that, and never goes back)
const RELEASES = mkdtempSync(join(tmpdir(), 'sct-tools-releases-'));
process.on('exit', () => rmSync(RELEASES, { recursive: true, force: true }));
let catalog;
useFleet({ watchMs: 60000, knowledge: true, env: { SPARK_CONSOLE_RELEASES: RELEASES } }, async () => { catalog = (await api('/actions')).json; });

const requestsOf = fleet => (existsSync(join(fleet.dir, 'model-requests.jsonl')) ? readFileSync(join(fleet.dir, 'model-requests.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []);
const requests = () => requestsOf(T.fleet);
// What the brain was offered for these words, round by round (the last turn that said them).
const rounds = (words, from = 0) => requests().slice(from).filter(x => x.words === words);
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const noScript = () => rmSync(join(T.fleet.dir, 'model-script.json'), { force: true });
async function withScript(rules, fn) { script(rules); try { return await fn(); } finally { noScript(); } }
// Every other message calls nothing (the stand-in's own patterns, "run …" or "start …", stay out of it).
const QUIET = { match: '.', calls: [] };
const inGroup = g => catalog.actions.filter(a => a.group === g).map(a => a.name);
const sorted = list => [...list].sort();
const coreAnd = (...groups) => sorted([...CORE_TOOLS, ...groups.flatMap(inGroup)]);
const mock = (spark, file) => join(T.fleet.root, spark, '.mock', file);
const notice = (chat, re, timeout = 120000) => waitFor(async () => (await chatMessages(chat)).find(m => m.notice && re.test(m.content)), { timeout, every: 500, what: `a notice ${re}` });
const results = (words, from) => rounds(words, from).filter(x => x.lastRole === 'tool').flatMap(x => x.results.map(r => r.content));

describe('the brain\'s tool list', { concurrency: 1 }, () => {
  test('every action has one group; the core is the twelve every round carries; TOOL_CAP is the service\'s', () => {
    assert.deepEqual(sorted(catalog.actions.map(a => a.name)), sorted(ALL_TOOLS));
    for (const a of catalog.actions) assert.ok(a.group === 'core' || catalog.brain.groups.some(g => g.group === a.group), `${a.name}: ${a.group}`);
    assert.deepEqual(sorted(inGroup('core')), sorted(CORE_TOOLS));
    assert.deepEqual(sorted(catalog.brain.core), sorted(CORE_TOOLS));
    assert.equal(catalog.brain.toolCap, TOOL_CAP);
    for (const g of catalog.brain.groups) assert.ok(inGroup(g.group).length <= catalog.brain.groupSize, g.group);
    assert.ok(CORE_TOOLS.length + 2 * catalog.brain.groupSize <= TOOL_CAP);
  });

  test('every round is sent at most the cap, never every action (today every round carried them all)', { timeout: 120000 * SLOW }, async () => {
    const from = requests().length;
    await withScript([{ match: '^why did it fail, which models fit on spark 4', rounds: [[{ name: 'recent_operations', arguments: {} }], [{ name: 'guide', arguments: { tools: 'past' } }]] }, QUIET], async () => {
      for (const words of ['what\'s running?', 'why did it fail, which models fit on spark 4, and what is the plan? look it up', 'show me the notes.md file in my shared folder']) await say(await newChat(), words);
    });
    const sent = requests().slice(from).filter(x => x.tools.length);
    assert.ok(sent.length >= 5, `${sent.length} rounds`);
    for (const x of sent) {
      assert.ok(x.tools.length <= TOOL_CAP, `${x.words} (round ${x.round}): ${x.tools.length} tools`);
      assert.ok(x.tools.length < ALL_TOOLS.length, x.words);
      for (const t of CORE_TOOLS) assert.ok(x.tools.includes(t), `${t} offered for ${x.words}`);
    }
  });

  test('a "why did it fail" request is offered the core and dig, and nothing else', { timeout: 60000 * SLOW }, async () => {
    const words = 'why did my job on spark 3 fail?', from = requests().length;
    await withScript([QUIET], async () => say(await newChat(), words));
    const [first] = rounds(words, from);
    assert.deepEqual(sorted(first.tools), coreAnd('dig'));
    assert.ok(first.tools.includes('container_logs') && first.tools.includes('operation_log'));
  });

  // One request for each group, whose words open it: the exact set offered, and the prompt lines that come with it.
  const OPENED_BY = {
    find: 'which models fit on spark 3?',
    sparks: 'are spark 3 and 4 linked by a cable?',
    dig: 'why did my job on spark 3 fail?',
    past: 'what happened on the fleet yesterday?',
    reading: 'show me the notes.md file in my shared folder',
    routines: 'list my saved workflows',
    control: 'cancel the operation that is running',
    memory: 'what do you remember about me?',
    updates: 'is there a newer build of spark console?',
    checks: 'run the self-test please',
    power: 'is spark 4 asleep?',
  };
  test('each group: words that open it, and exactly the core and that group offered; a line naming a tool comes only with it', { timeout: 300000 * SLOW }, async () => {
    assert.deepEqual(sorted(Object.keys(OPENED_BY)), sorted(catalog.brain.groups.map(g => g.group)), 'a request for every group');
    const from = requests().length;
    await withScript([QUIET], async () => { for (const words of Object.values(OPENED_BY)) await say(await newChat(), words); });
    const LINES = { read_page: /read one or two good results with read_page/, forget_memory: /forget_memory removes a line\./, workflows: /The workflows tool lists every workflow/,
      power_off: /To shut a Spark down or turn it on, call power_off/ };
    for (const [group, words] of Object.entries(OPENED_BY)) {
      const [first] = rounds(words, from);
      assert.deepEqual(sorted(first.tools), coreAnd(group), `${group}: “${words}”`);
      for (const [tool, line] of Object.entries(LINES)) {
        assert.equal(line.test(first.system), first.tools.includes(tool), `${group}: the line for ${tool}`);
      }
    }
  });

  test('the core prompt: under 2,500 characters, and it names only core tools', { timeout: 60000 * SLOW }, async () => {
    const words = 'hello there', from = requests().length;
    await withScript([QUIET], async () => say(await newChat(), words));
    const [first] = rounds(words, from);
    assert.deepEqual(sorted(first.tools), sorted(CORE_TOOLS));
    const fixed = first.system.split('\nWhat the owner asked you to remember')[0];
    assert.ok(fixed.length < 2500, `${fixed.length} characters`);
    const named = [...new Set(fixed.match(/\b[a-z]+(?:_[a-z]+)+\b/g))];
    assert.ok(named.length >= 5, named.join(', '));
    for (const n of named) assert.ok(CORE_TOOLS.includes(n), `the core prompt names ${n}`);
    assert.doesNotMatch(fixed, /\bread_page\b|\bforget_memory\b|workflows tool/);
  });

  test('state opens groups: a web search this turn opens reading for its next round', { timeout: 60000 * SLOW }, async () => {
    const words = 'what is the newest vllm version?', from = requests().length;
    await withScript([{ match: '^what is the newest vllm version', rounds: [[{ name: 'search_web', arguments: { query: 'newest vllm version' } }]] }, QUIET],
      async () => say(await newChat(), words));
    const [first, second] = rounds(words, from);
    assert.deepEqual(sorted(first.tools), sorted(CORE_TOOLS));
    assert.deepEqual(sorted(second.tools), coreAnd('reading'));
    assert.match(second.system, /read one or two good results with read_page/);
  });

  test('a third group closes the oldest one opened by words', { timeout: 60000 * SLOW }, async () => {
    const words = 'why did it fail, which models fit on spark 4, and what would the plan be?', from = requests().length;
    await withScript([QUIET], async () => say(await newChat(), words));
    const [first] = rounds(words, from);
    // dig (why, fail) came first in the words, then find (models, fit), then sparks (plan): dig closed.
    assert.deepEqual(sorted(first.tools), coreAnd('find', 'sparks'));
  });

  test('guide {tools} lists a group and opens it for the next round; guide {} lists every group', { timeout: 60000 * SLOW }, async () => {
    const words = 'look around for me', from = requests().length;
    await withScript([{ match: '^look around for me', rounds: [[{ name: 'guide', arguments: { tools: 'past' } }], [{ name: 'guide', arguments: {} }]] }, QUIET],
      async () => say(await newChat(), words));
    const [first, second] = rounds(words, from);
    assert.deepEqual(sorted(first.tools), sorted(CORE_TOOLS));
    assert.deepEqual(sorted(second.tools), coreAnd('past'));
    const [listed, all] = results(words, from).map(r => JSON.parse(r));
    assert.equal(listed.group, 'past');
    assert.deepEqual(listed.tools.map(t => t.name), inGroup('past'));
    assert.equal(listed.next, 'These are offered from your next round.');
    assert.deepEqual(all.groups.map(g => g.group), catalog.brain.groups.map(g => g.group));
    assert.deepEqual(sorted(all.core), sorted(CORE_TOOLS));
  });

  describe('hidden is not forbidden: a call to a tool that wasn\'t offered runs through runAction, and opens its group', { concurrency: 1 }, () => {
    for (const [tool, args, words, group] of [
      ['undo_last_change', {}, 'please do the thing from before', 'control'],
      ['cancel_operation', { id: '0123456789ab' }, 'please drop the thing from earlier', 'control'],
      // ("revert" opens control by its words, not updates, so undo_update isn't offered)
      ['undo_update', {}, 'revert that', 'updates'],
    ]) {
      test(`${tool}`, { timeout: 60000 * SLOW }, async () => {
        const from = requests().length, audits = auditLines().length;
        const r = await withScript([{ match: `^${words}$`, rounds: [[{ name: tool, arguments: args }]] }, QUIET], async () => say(await newChat(), words));
        const [first, second] = rounds(words, from);
        assert.ok(!first.tools.includes(tool), `${tool} was offered`);
        assert.deepEqual(r.tools.map(t => t.name), [tool]);
        // It reached runAction, which answered as it does for a call that was offered: a button for a change the words
        // didn't ask for; undo_update, asked for by "revert", ran (and found no earlier build to go back to).
        const [result] = results(words, from);
        assert.doesNotMatch(result, /No tool called/);
        if (tool === 'undo_update') {
          assert.match(result, /no earlier build to go back to/);
          assert.ok(auditLines().slice(audits).some(l => l.action === tool && l.via === 'sparkie'), 'runAction’s record');
        } else assert.ok(r.message.choices?.length, result);
        assert.ok(inGroup(group).every(t => second.tools.includes(t)), `${group} offered next: ${second.tools}`);
      });
    }
  });

  test('state opens groups: an operation of this chat running opens control', { timeout: 120000 * SLOW }, async () => {
    const container = 'sc-testorg--Qwen3.8-27B-abliterated-GGUF', stop = `stop ${container} on spark 3`, words = 'how is it going?';
    writeFileSync(mock('spark3', 'slow-stop'), '20');
    try {
      const chat = await newChat(), from = requests().length;
      await withScript([{ match: `^${stop}$`, calls: [{ name: 'stop_model', arguments: { spark: 'spark3', container } }] }, QUIET], async () => {
        const r = await say(chat, stop);
        assert.deepEqual(r.message.tools.map(t => [t.name, t.outcome]), [['stop_model', 'started']], JSON.stringify(r.message.tools));
        await say(chat, words);
      });
      const [first] = rounds(words, from);
      assert.deepEqual(sorted(first.tools), coreAnd('control'));
      await notice(chat, /Done: stopping /);
    } finally { rmSync(mock('spark3', 'slow-stop'), { force: true }); }
  });

  test('groups last through the request\'s carry-on turns', { timeout: 180000 * SLOW }, async () => {
    const container = 'sc-RadixArk--Qwen3.8-27B-NVFP4', words = `stop ${container} on spark 4, then tell me how it went`, from = requests().length;
    // The request opens memory with guide; its carry-on turn, after the stop, still has it (its own words open nothing).
    script([{ match: `^stop ${container}`, rounds: [[{ name: 'stop_model', arguments: { spark: 'spark4', container } }], [{ name: 'guide', arguments: { tools: 'memory' } }]] },
      { match: '^\\[Spark Console\\] What you started', calls: [] }, QUIET]);
    try {
      const chat = await newChat();
      const r = await say(chat, words);
      assert.deepEqual(r.message.tools.map(t => t.name), ['stop_model', 'guide'], JSON.stringify(r.message.tools));
      const carried = await waitFor(() => requests().slice(from).find(x => /^\[Spark Console\] What you started/.test(x.words) && x.words.includes(container)), { timeout: 120000, what: 'the carry-on turn' });
      assert.deepEqual(sorted(carried.tools), coreAnd('memory'));
      const [first] = rounds(words, from);
      assert.deepEqual(sorted(first.tools), sorted(CORE_TOOLS));
    } finally { noScript(); }
  });

  test('state opens groups: the chat\'s last operation failing opens dig', { timeout: 180000 * SLOW }, async () => {
    const start = 'start gemma-3-12b-it on spark 4', words = 'and now?';
    const chat = await newChat(), from = requests().length;
    await withScript([{ match: `^${start}$`, calls: [{ name: 'start_model', arguments: { model: 'gemma-3-12b-it', spark: 'spark4' } }] }, QUIET], async () => {
      const r = await say(chat, start);
      assert.deepEqual(r.message.tools.map(t => [t.name, t.outcome]), [['start_model', 'started']], JSON.stringify(r.message.tools));
      await notice(chat, / failed: /);
      await say(chat, words);
    });
    const [first] = rounds(words, from);
    assert.deepEqual(sorted(first.tools), coreAnd('dig'));
  });

  test('the agent door hides nothing: tools/list is every action in the key\'s scope, the instructions say to call guide first, and guide answers there', { timeout: 60000 * SLOW }, async () => {
    const look = await createKey('tools-look'), act = await createActKey('tools-act');
    assert.deepEqual(sorted((await rpc(look.token, 'tools/list')).json.result.tools.map(t => t.name)), sorted(DOOR_READ));
    assert.deepEqual(sorted((await rpc(act.token, 'tools/list')).json.result.tools.map(t => t.name)), sorted(DOOR_ACT));
    assert.match((await rpc(look.token, 'initialize', { protocolVersion: '2025-06-18' })).json.result.instructions, /^Call guide first: it lists the tools by group/m);
    const g = await call(look.token, 'guide', { tools: 'dig' });
    assert.equal(g.isError, false, g.text);
    assert.deepEqual(g.value.tools.map(t => t.name), inGroup('dig'));
    assert.equal(g.value.next, 'Every tool is offered here: call them by name.');
    const bad = await call(look.token, 'guide', { tools: 'everything' });
    assert.equal(bad.isError, true);
    assert.match(bad.text, /^\[invalid\] tools should be one of: /);
  });

  test('an agent talking through ask_sparkie gets Sparkie\'s groups', { timeout: 90000 * SLOW }, async () => {
    const act = await createActKey('tools-ask'), words = 'why did my job on spark 3 fail?', from = requests().length;
    await withScript([QUIET], async () => {
      const r = await call(act.token, ASK, { message: words });
      assert.equal(r.isError, false, r.text);
    });
    const [first] = rounds(words, from);
    assert.deepEqual(sorted(first.tools), coreAnd('dig'));
  });

  test('the tested mark covers every group: a tool a "Hello" turn isn\'t offered, its group\'s lines and words, the cap and the setup all change it', { timeout: 120000 * SLOW }, async () => {
    // What a round that opens dig sends is what the catalog holds for those tools.
    await withScript([QUIET], async () => say(await newChat(), 'why did my job on spark 3 fail?'));
    const dug = JSON.parse(readFileSync(join(T.fleet.dir, 'brain-sent.json'), 'utf8'));
    assert.ok(dug.tools.some(t => t.function.name === 'container_logs'));
    const sent = await brainSent(T.fleet);
    for (const t of dug.tools) {
      const a = sent.catalog.actions.find(x => x.name === t.function.name);
      assert.deepEqual([a.description, a.input], [t.function.description, t.function.parameters], t.function.name);
    }
    assert.ok(!sent.tools.some(t => t.function.name === 'container_logs'), 'a "Hello" turn doesn\'t offer container_logs');
    const reads = brainReadsOf(sent);
    assert.equal(brainReadsOf(structuredClone(sent)), reads);
    const changed = edit => { const c = structuredClone(sent); edit(c); return brainReadsOf(c); };
    assert.notEqual(changed(c => { c.catalog.actions.find(a => a.name === 'container_logs').description += ' Now also something else.'; }), reads);
    assert.notEqual(changed(c => { c.catalog.actions.find(a => a.name === 'container_logs').group = 'past'; }), reads);
    assert.notEqual(changed(c => { c.catalog.brain.lines.find(l => l.tools.includes('read_page')).text += ' '; }), reads);
    assert.notEqual(changed(c => { c.catalog.brain.groups.find(g => g.group === 'dig').words += '|\\bhmm\\b'; }), reads);
    assert.notEqual(changed(c => { c.catalog.brain.toolCap += 1; }), reads);
    assert.notEqual(changed(c => { c.catalog.brain.setup.maxChanges = 99; }), reads);
    assert.notEqual(changed(c => { c.params.temperature = 0.01; }), reads);
  });

  test('the cap is a setting: a brain\'s setup lowers it; an eval run on the stand-in fleet can offer every tool', { timeout: 240000 * SLOW }, async () => {
    const words = 'why did it fail, and which models fit on spark 4?', QUIET_ONLY = JSON.stringify([QUIET]);
    const ask = async fleet => {
      writeFileSync(join(fleet.dir, 'model-script.json'), QUIET_ONLY);
      const headers = { 'content-type': 'application/json', 'x-spark-console': '1', origin: fleet.origin };
      const chat = (await (await fetch(`${fleet.base}/chats`, { method: 'POST', headers, body: '{}' })).json()).id;
      await (await fetch(`${fleet.base}/chats/${chat}/messages`, { method: 'POST', headers, body: JSON.stringify({ text: words }) })).text();
      return requestsOf(fleet).find(x => x.words === words);
    };
    // A setup with toolCap 18: the core and one group, the newer one the words opened.
    const lower = await startMock({ watchMs: 60000, prepare: ({ stateDir }) => {
      const f = join(stateDir, 'main.json'), m = JSON.parse(readFileSync(f, 'utf8'));
      for (const p of Object.values(m.presets)) p.toolCap = 18;
      writeFileSync(f, JSON.stringify(m));
    } });
    try {
      const x = await ask(lower);
      assert.ok(x.tools.length <= 18, String(x.tools.length));
      assert.deepEqual(sorted(x.tools), coreAnd('find'));
    } finally { await lower.stop(); }
    // SPARK_CONSOLE_TOOL_CAP=all (test/eval.mjs --cap all): every action, every round, as before the groups.
    const all = await startMock({ watchMs: 60000, env: { SPARK_CONSOLE_TOOL_CAP: 'all' } });
    try {
      const x = await ask(all);
      assert.deepEqual(sorted(x.tools), sorted(ALL_TOOLS));
      assert.match(x.system, /read one or two good results with read_page/);
    } finally { await all.stop(); }
  });
});
