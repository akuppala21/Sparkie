// Covers: Sparkie's own model when a change goes wrong. Switching: a setup that can't start is refused before anything
// stops; a failed switch says whether the old model came back, and leaves no half-started container when it didn't. The
// brain keeper (R19): a brain the console left down itself (a brain start that fails after its container is removed)
// comes back with the same setup once self-healing is on (a `healing` event, a `main-start` operation by Self-healing,
// the mark gone from `main.json`); a second try that would have to stop a container refuses and stops nothing, then one
// notice and never a third; the owner's Stop clears the mark, and so does the brain answering again; nothing is started
// then. Another brain's habits (B9, R50), said by its setup's `ask` block, never by the chat loop: today's setup is asked
// as before; a block's field goes over the one beside it; with `mergeRoles` a stand-in brain that refuses two user
// messages in a row gets none; one that prints its thinking between tags leaves none in the saved answer; thinking sent
// as `reasoning` is read as thinking; past the setup's `tokenBudget`, by the brain's own `usage`, the next round offers no
// tools; a Library model's spark.json `ask` block is kept with its setup, checked, and its brain is asked that way.
// At the brain's own 45-minute limit (pure: startMain and switchMain from their part, with a clock that runs on): a
// start leaves the container loading and says it may still be loading; a switch with a setup to go back to removes it
// and says so, as does the setup gone back to when it too stays silent; a first switch with none leaves it loading.
//
// Sparkie's own model (the brain) when a change of Spark Console's goes wrong. Switching it: a setup that can't start is
// refused before anything stops; a failed switch says whether the old model came back, and leaves no half-started
// container when it didn't (F3). The brain keeper (H2): a brain Spark Console left down itself (its `leftDown` mark in
// main.json) comes back with the same setup, twice in 6 hours at most, stopping nothing; one stopped by the owner never
// does. The stand-in brain is sparkie-main on spark2; ~/.mock/reject-flag makes its start exit at once, and the stand-in
// docker exits any model whose name has "gemma".
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, agentSettings, auditLines, eventLines, waitFor, sleep, SLOW, newChat, say, chatMessages, REPO } from './lib.mjs';

// B9: the ask blocks of a setup and of a Library model's spark.json (with fields the check leaves out: a limit, a
// sampling key it doesn't know, tags that aren't two strings).
const B9_ASK = { maxTokens: 6000, mergeRoles: true, tokenBudget: 4000 };
const LIBRARY_ASK = { thinking: true, maxTokens: 8192, sampling: { temperature: 0.6, top_p: 0.95, top_k: 20, color: 3 }, mergeRoles: true, tokenBudget: 4000,
  thinkTags: '<think>', toolRounds: 99 };
useFleet({
  watchMs: 60000,
  // (self-healing looks every 2 s, and a brain stopped for 3 s is "down", so the keeper acts within seconds)
  env: { SPARK_CONSOLE_HEAL_MS: '2000', SPARK_CONSOLE_HEAL_SETTLE_MS: '3000' },
  prepare: ({ root, stateDir }) => {
    const f = join(stateDir, 'main.json'), m = JSON.parse(readFileSync(f, 'utf8')), base = m.presets[m.current];
    m.presets['f3-not-here'] = { ...base, title: 'Not here', model: 'nobody--not-here' };
    m.presets['f3-crashes'] = { node: base.node, title: 'Crashes at start', served: 'gemma-brain', engine: base.engine, image: base.image, imageId: base.imageId, model: 'Qwen--Qwen3-32B', port: base.port, args: [] };
    // (B9: today's brain asked another way, by its ask block; and a Library model whose spark.json carries one)
    m.presets['b9-asks'] = { ...base, title: 'Asked another way', ask: B9_ASK };
    const lib = join(root, 'spark2', 'models', 'next-brain');
    mkdirSync(lib, { recursive: true });
    writeFileSync(join(lib, 'config.json'), readFileSync(join(root, 'spark2', 'models', 'gpt-oss-20b', 'config.json')));
    writeFileSync(join(lib, 'model.safetensors'), '');
    writeFileSync(join(lib, 'spark.json'), JSON.stringify({ title: 'Next brain', engine: 'vllm', args: [], ask: LIBRARY_ASK }));
    writeFileSync(f, JSON.stringify(m), { mode: 0o600 });
  },
}, async () => { await agentSettings({ selfHeal: false }); });

const mock = f => join(T.fleet.root, 'spark2', '.mock', f);
const brainState = () => readFileSync(mock('containers'), 'utf8').split('\n').find(l => l.startsWith('sparkie-main|'))?.split('|')[1] || 'missing';
const setBrain = state => writeFileSync(mock('containers'), readFileSync(mock('containers'), 'utf8').replace(/^sparkie-main\|[^|]*\|/m, `sparkie-main|${state}|`));
const mainFile = () => JSON.parse(readFileSync(join(T.fleet.stateDir, 'main.json'), 'utf8'));
const tries = () => { try { return JSON.parse(readFileSync(join(T.fleet.stateDir, 'heal-tries.json'), 'utf8'))['keep:spark2/sparkie-main'] || []; } catch { return []; } };
const keeperStarts = async () => (await api('/jobs')).json.jobs.filter(j => j.type === 'main-start' && j.actor === 'Self-healing');
const ended = id => waitFor(async () => { const j = (await api(`/jobs/${id}`)).json; return j.status !== 'running' && j; }, { timeout: 180000 * SLOW, what: `operation ${id} to end` });
const answering = () => waitFor(async () => { const m = (await api('/main')).json; return m.state === 'running' && m.healthy === true; }, { timeout: 90000 * SLOW, what: 'Sparkie answering' });
const draft = () => join(T.fleet.root, 'spark2', '.cache', 'huggingface', 'hub', 'models--z-lab--Qwen3.8-27B-DFlash2');
async function brainJob(path, body = {}) {
  const r = await api(path, { method: 'POST', body });
  assert.equal(r.status, 202, r.text);
  return ended(r.json.id);
}
// The owner's own brain start, failing after Spark Console removed the container (the stand-in engine rejects a flag).
async function failedStart() {
  writeFileSync(mock('reject-flag'), '--tp-size');
  const j = await brainJob('/main/start');
  assert.equal(j.status, 'failed', JSON.stringify(j.log));
  assert.equal(brainState(), 'exited');
  rmSync(mock('reject-flag'), { force: true });
}

describe('switching Sparkie\'s model', { concurrency: 1 }, () => {
  test('a switch to a setup that can\'t start leaves Sparkie\'s model untouched', { timeout: 120000 * SLOW }, async () => {
    await answering();
    const up = readFileSync(mock('up-sparkie-main'), 'utf8'), id = (await api('/main')).json.id;
    const j = await brainJob('/main/use', { preset: 'f3-not-here' });
    assert.equal(j.status, 'failed');
    assert.match(j.error, /^Not here can’t start, and nothing was stopped: nobody\/not-here isn’t on spark2\./);
    assert.ok(!j.log.some(l => /Stopping/.test(l)), JSON.stringify(j.log));
    assert.equal(brainState(), 'running');
    assert.equal(readFileSync(mock('up-sparkie-main'), 'utf8'), up, 'never restarted');
    assert.equal((await api('/main')).json.id, id);
    assert.equal(mainFile().leftDown, undefined);
  });

  test('a failed switch says the truth about the way back', { timeout: 400000 * SLOW }, async t => {
    t.after(() => { if (existsSync(`${draft()}.aside`)) renameSync(`${draft()}.aside`, draft()); });
    const id = (await api('/main')).json.id;
    // The new setup crashes; the old one comes back.
    let j = await brainJob('/main/use', { preset: 'f3-crashes' });
    assert.equal(j.status, 'failed');
    assert.match(j.error, /^Crashes at start didn’t start, so Sparkie is back on /);
    await answering();
    // The new setup crashes, and the old one can't start either (its draft model is gone): it says so, and no
    // half-started container is left for Docker or the word to bring back.
    renameSync(draft(), `${draft()}.aside`);
    j = await brainJob('/main/use', { preset: 'f3-crashes' });
    assert.equal(j.status, 'failed');
    assert.doesNotMatch(j.error, /is back on/);
    assert.match(j.error, /didn’t come back either, so Sparkie is down\. To start it again, type \/restart sparkie/);
    const m = (await api('/main')).json;
    assert.deepEqual([m.state, m.id], ['missing', id]);
    assert.ok(mainFile().leftDown, 'Spark Console took it down: marked');
    // (put back: the owner's own start)
    renameSync(`${draft()}.aside`, draft());
    assert.equal((await brainJob('/main/start')).status, 'completed');
    await answering();
    assert.equal(mainFile().leftDown, undefined, 'answering again: the mark is gone');
  });
});

describe('the brain keeper', { concurrency: 1 }, () => {
  test('a brain Spark Console left down itself comes back with the same setup', { timeout: 300000 * SLOW }, async () => {
    await answering();
    const id = (await api('/main')).json.id;
    await failedStart();
    assert.ok(mainFile().leftDown, 'the failed start left the mark');
    const from = eventLines().length;
    await agentSettings({ selfHeal: true });
    try {
      await waitFor(() => eventLines().slice(from).some(e => e.type === 'healing' && e.container === 'sparkie-main' && /^Spark Console left Sparkie’s model down/.test(e.why)),
        { timeout: 60000 * SLOW, what: 'the keeper' });
      const [job] = await keeperStarts();
      assert.equal((await ended(job.id)).status, 'completed', JSON.stringify(job));
      await answering();
      assert.equal((await api('/main')).json.id, id);
      const args = readFileSync(mock('last-run-args'), 'utf8').split('\n');
      assert.equal(args[args.indexOf('--served-model-name') + 1], 'qwen-aphex');
      assert.equal(mainFile().leftDown, undefined);
      assert.equal(tries().length, 1);
      assert.ok(auditLines().some(l => l.action === 'start_sparkie' && l.actor === 'Self-healing' && l.operation === job.id));
    } finally { await agentSettings({ selfHeal: false }); }
  });

  test('the second try refuses to stop anything; then one notice, and never a third', { timeout: 300000 * SLOW }, async t => {
    await failedStart();
    // Something else on Spark 2's GPU: starting the brain now would stop it.
    writeFileSync(mock('gpu'), '4242, 20000, python3, sc-gpt-oss-20b\n');
    t.after(() => rmSync(mock('gpu'), { force: true }));
    const from = eventLines().length, twice = () => eventLines().slice(from).filter(e => e.type === 'notice' && /tried twice in the last 6 hours to start Sparkie’s model again on Spark 2/.test(e.text || ''));
    await agentSettings({ selfHeal: true });
    try {
      await waitFor(() => twice().length, { timeout: 60000 * SLOW, what: 'the notice' });
      await sleep(10000);
      assert.equal(twice().length, 1, 'one notice');
      assert.match(twice()[0].text, /\/restart sparkie/);
      const starts = await keeperStarts();
      assert.equal(starts.length, 2, 'never a third');
      assert.equal(starts[0].status, 'failed');
      assert.match(starts[0].error, /would stop, copy or download something/);
      assert.match(readFileSync(mock('containers'), 'utf8'), /^sc-gpt-oss-20b\|running\|/m);
      assert.equal(tries().length, 2);
      assert.equal(mainFile().leftDown, undefined);
      assert.equal(brainState(), 'exited');
    } finally { await agentSettings({ selfHeal: false }); }
    rmSync(mock('gpu'), { force: true });
    assert.equal((await brainJob('/main/start')).status, 'completed');
    await answering();
  });

  test('the owner\'s Stop clears the mark, and so does the brain answering again however it came back: nothing is started', { timeout: 300000 * SLOW }, async () => {
    const before = (await keeperStarts()).length;
    await failedStart();
    assert.ok(mainFile().leftDown);
    assert.equal((await brainJob('/main/stop')).status, 'completed');
    assert.equal(mainFile().leftDown, undefined, 'the owner\'s Stop');
    await agentSettings({ selfHeal: true });
    try {
      await sleep(12000);
      assert.equal((await keeperStarts()).length, before, 'stopped by the owner: never started by itself');
      assert.equal(brainState(), 'exited');
    } finally { await agentSettings({ selfHeal: false }); }
    // Left down by a failed start, then brought back by hand: once it answers, the mark goes.
    await failedStart();
    assert.ok(mainFile().leftDown);
    setBrain('running');
    writeFileSync(mock('up-sparkie-main'), String(Math.floor(Date.now() / 1000) - 60));
    await answering();
    await agentSettings({ selfHeal: true });
    try {
      await waitFor(() => mainFile().leftDown === undefined, { timeout: 30000 * SLOW, what: 'the mark to go' });
      assert.equal((await keeperStarts()).length, before);
    } finally { await agentSettings({ selfHeal: false }); }
  });
});

// B9 (R50): what one brain needs is said by its setup's ask block (13-ask.mjs), never by the chat loop. The stand-in
// brain takes other brains' habits from $MOCK_DIR/model-habits.json (test/mock/model.mjs).
describe('another brain\'s habits, said by its setup', { concurrency: 1 }, () => {
  const requests = () => (existsSync(join(T.fleet.dir, 'model-requests.jsonl')) ? readFileSync(join(T.fleet.dir, 'model-requests.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []);
  const habits = h => (h ? writeFileSync(join(T.fleet.dir, 'model-habits.json'), JSON.stringify(h)) : rmSync(join(T.fleet.dir, 'model-habits.json'), { force: true }));
  const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
  // A reply that fails: its answer is left out of what the brain is sent next, so the owner's two messages meet.
  async function failedReply(chat, words) {
    writeFileSync(join(T.fleet.dir, 'model-fail'), 'answer-500\n{"error":{"message":"stand-in failure"}}');
    const r = await api(`/chats/${chat}/messages`, { method: 'POST', body: { text: words } });
    assert.match(r.text, /"type":"error"/);
  }
  async function use(body) {
    const j = await brainJob('/main/use', body);
    assert.equal(j.status, 'completed', JSON.stringify(j.log));
    await answering();
  }
  const THOUGHT = /Let me look|at the snapshot|<\/?think>|<thi|ink>/;
  after(async () => { habits(null); rmSync(join(T.fleet.dir, 'model-script.json'), { force: true }); if (mainFile().current !== 'aphex') await use({ preset: 'aphex' }); });

  test('today\'s setup is asked as before: two user messages in a row go as two, and no count of tokens is asked for', { timeout: 120000 * SLOW }, async () => {
    await answering();
    assert.equal(mainFile().current, 'aphex');
    const chat = await newChat();
    await failedReply(chat, 'first words, before a failure');
    const from = requests().length;
    await say(chat, 'second words, after it');
    const [asked] = requests().slice(from).filter(x => x.lastUser.endsWith('second words, after it'));
    assert.deepEqual(asked.roles, ['system', 'user', 'user']);
    assert.equal(asked.usageAsked, false);
    assert.equal(asked.params.max_tokens, 4096);
  });

  test('a setup\'s ask block goes over the fields beside it', { timeout: 180000 * SLOW }, async () => {
    await use({ preset: 'b9-asks' });
    const chat = await newChat(), from = requests().length;
    await say(chat, 'hello from a setup asked another way');
    const [asked] = requests().slice(from).filter(x => x.words === 'hello from a setup asked another way');
    assert.equal(asked.params.max_tokens, 6000, 'the block\'s maxTokens, not the 4096 beside it');
    assert.equal(asked.usageAsked, true, 'a token budget asks for the brain\'s own count');
  });

  test('a stand-in brain that refuses two user messages in a row gets none', { timeout: 120000 * SLOW }, async () => {
    habits({ alternating: true });
    try {
      const chat = await newChat();
      await failedReply(chat, 'first words, before a failure');
      const from = requests().length;
      const r = await say(chat, 'second words, after it');
      assert.ok(r.text.trim(), 'it answered');
      const [asked] = requests().slice(from).filter(x => x.lastUser.endsWith('second words, after it'));
      assert.deepEqual(asked.roles, ['system', 'user'], 'the two went as one');
      assert.match(asked.lastUser, /^first words, before a failure\n\n(\[Spark Console’s record[\s\S]*\[End of record\.\]\n\n)?second words, after it$/);
      assert.ok(requests().slice(from).every(x => x.roles.every((role, i) => i === 0 || role !== x.roles[i - 1] || !['user', 'assistant'].includes(role))), 'none, in any round');
    } finally { habits(null); }
  });

  test('a stand-in brain that prints its thinking leaves none in the saved answer', { timeout: 120000 * SLOW }, async () => {
    habits({ thinksAloud: true });
    try {
      const chat = await newChat();
      const plain = await say(chat, 'hello, thinking out loud');
      assert.match(plain.text, /^You asked: \*\*hello, thinking out loud\*\*/);
      // (a tool round too: each call's answer starts with its thinking)
      const looked = await say(await newChat(), 'what\'s running?');
      assert.ok(looked.tools.length >= 1, JSON.stringify(looked.tools));
      assert.match(looked.text, /^I checked\. running_models said:/);
      for (const r of [plain, looked]) {
        assert.doesNotMatch(r.text, THOUGHT);
        assert.doesNotMatch(r.events.filter(e => e.type === 'delta').map(e => e.text).join(''), THOUGHT, 'nor on the page as it came');
        assert.ok(r.events.some(e => e.type === 'thinking'), 'the page is told it was thinking');
      }
      assert.ok((await chatMessages(chat)).every(m => !THOUGHT.test(m.content)));
    } finally { habits(null); }
  });

  test('thinking sent as reasoning, vLLM\'s newer name, is read as thinking', { timeout: 120000 * SLOW }, async () => {
    habits({ reasoningField: true });
    try {
      const r = await say(await newChat(), 'hello, reasoning');
      assert.ok(r.events.some(e => e.type === 'thinking'), JSON.stringify(r.events.map(e => e.type)));
      assert.doesNotMatch(r.text, THOUGHT);
    } finally { habits(null); }
  });

  test('tokens from the brain\'s own usage: past the setup\'s token budget the next round offers no tools', { timeout: 180000 * SLOW }, async () => {
    const look = { name: 'running_models', arguments: {} };
    script([{ match: '^look three times', rounds: [[look], [look], [look]] }]);
    try {
      // 5,000 tokens by the brain's count, over the setup's 4,000: one round of tools, then it answers.
      habits({ usage: 5000 });
      let from = requests().length;
      let r = await say(await newChat(), 'look three times');
      assert.equal(r.tools.length, 1, JSON.stringify(r.tools.map(t => t.name)));
      const asked = requests().slice(from).filter(x => x.words === 'look three times');
      assert.deepEqual(asked.map(x => [x.round, x.tools.length > 0, x.usageAsked]), [[0, true, true], [1, false, true]]);
      // 100 tokens: under it, every round the script asks for.
      habits({ usage: 100 });
      from = requests().length;
      r = await say(await newChat(), 'look three times');
      assert.equal(r.tools.length, 3, JSON.stringify(r.tools.map(t => t.name)));
    } finally { habits(null); rmSync(join(T.fleet.dir, 'model-script.json'), { force: true }); }
  });

  test('a Library model\'s spark.json ask block is kept with its setup, checked, and its brain is asked that way', { timeout: 180000 * SLOW }, async () => {
    await use({ model: 'next-brain' });
    const m = mainFile(), lib = m.presets['lib-next-brain'];
    assert.equal(m.current, 'lib-next-brain');
    assert.deepEqual(lib.ask, { thinking: true, maxTokens: 8192, sampling: { temperature: 0.6, top_p: 0.95, top_k: 20 }, mergeRoles: true, tokenBudget: 4000 });
    assert.equal(lib.toolRounds, undefined, 'a limit is no ask: a spark.json doesn\'t set it');
    assert.equal(lib.port, m.presets.aphex.port, 'served on Sparkie\'s port');
    const from = requests().length;
    await say(await newChat(), 'hello from the next brain');
    const [asked] = requests().slice(from).filter(x => x.words === 'hello from the next brain');
    assert.deepEqual(asked.params, { temperature: 0.6, top_p: 0.95, top_k: 20, max_tokens: 8192, thinking: true });
    assert.equal(asked.usageAsked, true);
  });
});

// What happens at the brain's own 45-minute limit, and what the words say (the reply's check of the landed fixes,
// 2026-11-16): startMain leaves the container there loading, so "it may still be loading" is true; a switch that goes
// back to the setup before removes it (the same container name, docker rm -f), so its words say that instead.
describe('the brain’s 45-minute limit: the words say what happened to the container', () => {
  const src = readFileSync(join(REPO, 'service', 'src', '13-main-model.mjs'), 'utf8');
  const lift = head => { const at = src.indexOf(head); assert.ok(at >= 0, head); return src.slice(at, src.indexOf('\n}\n', at) + 2); };
  const slow = /^const MAIN_SLOW = .*$/m.exec(src)?.[0] || '';
  // A stand-in Spark 2: each setup either answers once started or stays silent ("loading") for good; every command is
  // kept, in order. The clock moves a minute each time it is read.
  function brainWith(silent, main) {
    const cmds = [], notes = [];
    let current = null, clock = 0;
    const run = async (node, script) => {
      cmds.push(script);
      if (script.startsWith('START ')) { current = script.slice(6); return { code: 0, out: '', err: '' }; }
      if (script.includes('curl -sf')) return { code: 0, out: silent.includes(current) ? 'running\nLoading safetensors' : 'up\n', err: '' };
      return { code: 0, out: '', err: '' };
    };
    const names = ['run', 'note', 'step', 'mainPlan', 'mainNode', 'nodeById', 'stopContainer', 'copyModel', 'markBrainLeftDown', 'mainRunCommand',
      'sleep', 'Date', 'repoOf', 'recordVerified', 'q', 'stopMain', 'ASSISTANT_NAME', 'saveMainChoice', 'ROUTES', 'saveRoutes', 'checkBrainSoon', 'initial'];
    const make = new Function(...names, `let MAIN = initial;\n${slow}\n${lift('async function startMain(')}\n${lift('async function switchMain(')}\nreturn { startMain, switchMain };`);
    const fns = make(run, (job, t) => notes.push(t), (job, t) => notes.push(`step: ${t}`), async m => ({ title: m.title, steps: [] }), () => ({ id: 'spark2' }), () => ({ id: 'spark2' }),
      async () => {}, async () => {}, () => {}, m => `START ${m.title}`, async () => {}, { now: () => (clock += 60000) }, x => x, async () => {}, x => `'${x}'`,
      async (job, m) => { cmds.push(`STOP ${m.title}`); }, 'Sparkie', () => {}, {}, () => {}, () => false, main);
    return { ...fns, cmds, notes, job: {} };
  }
  const OLD = { title: 'Old', container: 'sparkie-main', node: 'spark2', port: 30100 }, NEW = { title: 'New', container: 'sparkie-main', node: 'spark2', port: 30100 };
  const since = (cmds, from) => cmds.slice(cmds.lastIndexOf(from) + 1).filter(c => !c.includes('curl -sf'));

  test('a start (the page’s Start, /restart sparkie, the brain keeper): it is left loading, and the words say it may still be loading', async () => {
    const b = brainWith(['Old'], OLD);
    await assert.rejects(b.startMain(b.job, [], OLD), e => /^It didn’t answer within 45 minutes\. It may still be loading; check its logs\.$/.test(e.message));
    assert.deepEqual(since(b.cmds, 'START Old'), [], 'nothing stops or removes it after its start');
  });
  test('a switch with a setup to go back to: the new one is removed for it, and the words say so, never that it may still be loading', async () => {
    const b = brainWith(['New'], OLD);
    let err;
    await b.switchMain(b.job, NEW, []).catch(e => { err = e; });
    assert.equal(err?.message, 'New didn’t start, so Sparkie is back on Old. It didn’t answer within 45 minutes, so it was removed to start Old again.');
    assert.match(since(b.cmds, 'START New')[0], /^docker rm -f 'sparkie-main'/, 'going back removes it first');
    assert.ok(b.notes.includes('New didn’t start: It didn’t answer within 45 minutes; going back to Old removes it.'), b.notes.join('\n'));
    assert.doesNotMatch([...b.notes, err.message].join('\n'), /may still be loading/);
  });
  test('a switch whose setup gone back to stays silent too: both are removed, and the words say so', async () => {
    const b = brainWith(['New', 'Old'], OLD);
    let err;
    await b.switchMain(b.job, NEW, []).catch(e => { err = e; });
    assert.equal(err?.message, 'New didn’t start, and Old didn’t come back either, so Sparkie is down. To start it again, type /restart sparkie in Spark Console’s chat. It didn’t answer within 45 minutes, so it was removed to start Old again.');
    assert.match(since(b.cmds, 'START Old').at(-1), /^docker rm -f 'sparkie-main'/, 'the one gone back to is removed too');
    assert.ok(b.notes.includes('Old didn’t come back either: It didn’t answer within 45 minutes; it is removed too.'), b.notes.join('\n'));
    assert.doesNotMatch([...b.notes, err.message].join('\n'), /may still be loading/);
  });
  test('a first switch, with no setup before it: it is left loading, and the words say it may still be loading', async () => {
    const b = brainWith(['New'], null);
    let err;
    await b.switchMain(b.job, NEW, []).catch(e => { err = e; });
    assert.equal(err?.message, 'New didn’t start. It didn’t answer within 45 minutes. It may still be loading; check its logs.');
    assert.deepEqual(since(b.cmds, 'START New'), [], 'nothing stops or removes it after its start');
  });
});
