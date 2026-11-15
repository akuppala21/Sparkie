// Covers: Using Sparkie from an app (R36): `running_models {client}` gives one generic card built by code (values, one
// block, what `sparkie` means here, how many at once, the reach line, nothing secret-shaped), the same through `POST
// /actions`; an app without its own card gets a caution; Codex and Claude Code get "not yet"; Sparkie's answer carries
// the block exactly once and the model never sees it. `/v1` keeps one place on the brain for the owner's chat: a second
// app call at once gets 429 with Retry-After while the owner's chat still answers, and an app that hangs up frees its
// place. Two more fleets: a brain that answers 4 at once (apps get 3; the 4th gets 429 saying one place stays) and one
// whose setup doesn't say (no cap).
//
// Using Sparkie from an app (round two, item 4; service/src/16-reads.mjs pasteCard, 15-routes.mjs gateway). The owner
// chose one generic card: running_models {client} adds it, built by code from the console's own setup; Sparkie only
// hears it's there and Spark Console puts the block under the answer exactly as built. Codex and Claude Code get a plain
// "not yet". The /v1 address keeps one place on Sparkie's model for the owner's chat: apps get at most its
// --max-running-requests minus one at once (the stand-in brain is the "aphex" setup: 1 at once, so apps get 1).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, call, createKey, newChat, say, sleep, SLOW } from './lib.mjs';
import { startMock } from './start-mock.mjs';

const keys = {};
useFleet({ watchMs: 60000 }, async () => { keys.look = await createKey('paste-look'); });
const card = async client => {
  const r = await call(keys.look.token, 'running_models', client === undefined ? {} : { client });
  assert.equal(r.isError, false, r.text);
  return r.value;
};
const requests = () => (existsSync(join(T.fleet.dir, 'model-requests.jsonl')) ? readFileSync(join(T.fleet.dir, 'model-requests.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const v1 = (words, signal) => fetch(`${T.base}/v1/chat/completions`, { method: 'POST', signal,
  headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'sparkie', messages: [{ role: 'user', content: words }] }) });

describe('a paste card for apps', { concurrency: 1 }, () => {
  test('any app: the values, one block, and what sparkie means here; nothing that looks like a secret', { timeout: 60000 * SLOW }, async () => {
    const v = await card('any app');
    const base = `${new URL(T.origin).origin}/console/api/v1`;
    assert.equal(v.paste.fits, true);
    assert.deepEqual(v.paste.values, { baseUrl: base, model: 'sparkie', key: 'any text works (your Tailscale login is what counts)', contextTokens: 262144 });
    assert.equal(v.paste.block, [`OPENAI_BASE_URL=${base}`, 'OPENAI_API_KEY=any', 'OPENAI_MODEL=sparkie', '',
      `curl ${base}/chat/completions -H 'content-type: application/json' -d '{"model":"sparkie","messages":[{"role":"user","content":"Say hi"}]}'`].join('\n'));
    assert.deepEqual(v.paste.notes, [
      'Here, sparkie is Sparkie’s model alone: no fleet tools and no memory. For the fleet itself, an agent uses the agent door (your account menu → Agents and Telegram).',
      'Sparkie’s model answers 1 request at once, shared with your own chats; apps get at most 1, so an app’s request makes your chat wait.',
      'Context: give apps at most 262,144 tokens (its server allows 1,000,000).',
      'It works from your own devices on your tailnet, signed in to Tailscale as you. A network that blocks ts.net addresses can’t reach it, and Spark Console offers no way around that.',
    ]);
    const all = JSON.stringify(v.paste);
    for (const bad of ['[hidden]', 'sck_', 'Bearer ', '{{']) assert.ok(!all.includes(bad), bad);
    // The same through POST /actions as through the agent door.
    const viaApi = (await api('/actions/running_models', { method: 'POST', body: { client: 'any app' } })).json;
    assert.deepEqual(viaApi.paste ?? viaApi.value?.paste, v.paste);
  });

  test('an app with no card of its own gets the same values and a plain caution; Codex and Claude Code: not yet', { timeout: 60000 * SLOW }, async () => {
    const w = await card('Open WebUI');
    assert.equal(w.paste.fits, true);
    assert.equal(w.paste.notes.at(-1), 'Spark Console has no card made for Open WebUI: use these values wherever it asks for an OpenAI-compatible endpoint. If Open WebUI sends requests through its maker’s servers, it can’t reach a tailnet address; don’t give it an agent key.');
    const codex = await card('Codex');
    assert.equal(codex.paste.fits, false);
    assert.match(codex.paste.says, /^Codex isn’t set up to use Sparkie yet\. It calls \/v1\/responses with its own tools, which hasn’t been checked with Sparkie’s model\./);
    assert.ok(!codex.paste.block);
    const claude = await card('claude code');
    assert.match(claude.paste.says, /^claude code isn’t set up to use Sparkie yet\. It speaks Anthropic’s API, and this address speaks OpenAI’s\./);
    assert.ok(!('paste' in await card()), 'no client, no card: running_models answers as before');
  });

  test('Sparkie: the block goes under the answer exactly once, as built; the model never sees it', { timeout: 90000 * SLOW }, async () => {
    writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify([{ match: '^how do i use sparkie from curl', calls: [{ name: 'running_models', arguments: { client: 'curl' } }] }]));
    try {
      const from = requests().length;
      const r = await say(await newChat(), 'how do I use sparkie from curl?');
      const block = (await card('curl')).paste.block;
      assert.equal(r.message.content.split('```').length, 3, 'exactly one block');
      assert.ok(r.message.content.endsWith(`Paste card, from Spark Console:\n\`\`\`\n${block}\n\`\`\``), r.message.content);
      const seen = requests().slice(from).flatMap(x => x.results.map(y => y.content)).join('\n');
      assert.ok(seen.includes('Spark Console shows this card’s block under your answer'), 'told it\'s shown');
      assert.ok(!seen.includes('OPENAI_BASE_URL'), 'the model never saw the block');
    } finally { rmSync(join(T.fleet.dir, 'model-script.json'), { force: true }); }
  });
});

describe('one place on Sparkie\'s model stays for the owner\'s chat', { concurrency: 1 }, () => {
  test('a second app call at once gets 429 with Retry-After; the owner\'s chat still answers; then apps get in again', { timeout: 90000 * SLOW }, async () => {
    const first = v1('take 4 seconds please');
    await sleep(800);
    const second = await v1('hello');
    assert.equal(second.status, 429);
    assert.equal(second.headers.get('retry-after'), '10');
    assert.match((await second.json()).error.message, /already answering 1 app request, and it answers one request at a time\./);
    // The owner's own chat isn't counted at this address.
    const chatting = say(await newChat(), 'hello there');
    const answered = await first;
    assert.equal(answered.status, 200);
    await answered.text(); // the call ends when its answer has been read
    await chatting;
    assert.equal((await v1('hello again')).status, 200, 'the place is free again');
  });

  test('an app that hangs up mid-answer frees its place', { timeout: 60000 * SLOW }, async () => {
    const stop = new AbortController();
    const gone = v1('take 5 seconds please', stop.signal).catch(() => null);
    await sleep(800);
    stop.abort();
    await gone;
    await sleep(500);
    assert.equal((await v1('hello')).status, 200, 'not stuck at 429');
  });
});

// The same with other brain setups, each on a fleet of its own: "aphex-agent" answers 4 at once (apps get 3, one place
// stays for the chat); a setup that doesn't say how many has no cap here.
for (const [name, setup, change] of [['4 at once', 'aphex-agent', null], ['not said', 'aphex-agent', args => args.filter((a, i, all) => a !== '--max-running-requests' && all[i - 1] !== '--max-running-requests')]]) {
  describe(`a brain setup that answers ${name}`, { concurrency: 1 }, () => {
    let F;
    before(async () => {
      F = await startMock({ watchMs: 60000, prepare: ({ stateDir }) => {
        const f = join(stateDir, 'main.json'), m = JSON.parse(readFileSync(f, 'utf8'));
        if (change) m.presets[setup].args = change(m.presets[setup].args);
        writeFileSync(f, JSON.stringify({ ...m, current: setup }), { mode: 0o600 });
      } });
    }, { timeout: 180000 });
    after(() => F?.stop(), { timeout: 30000 });
    const call1 = words => fetch(`${F.base}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'sparkie', messages: [{ role: 'user', content: words }] }) });
    test(change ? 'no cap: four app calls at once all answer' : 'apps get 3 at once; the 4th gets 429 saying one place stays for the owner\'s chat; the card says so', { timeout: 120000 * SLOW }, async () => {
      const slow = [1, 2, 3].map(() => call1('take 4 seconds please'));
      await sleep(800);
      const fourth = await call1('hello');
      if (change) assert.equal(fourth.status, 200);
      else {
        assert.equal(fourth.status, 429);
        assert.match((await fourth.json()).error.message, /already answering 3 app requests, and one place stays for the owner’s chat\./);
      }
      for (const r of await Promise.all(slow)) { assert.equal(r.status, 200); await r.text(); }
      const card = JSON.parse((await (await fetch(`${F.base}/actions/running_models`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-spark-console': '1', origin: F.origin }, body: JSON.stringify({ client: 'any app' }) })).text())).paste;
      assert.equal(card.notes[1], change ? 'How many requests it answers at once isn’t known here.' : 'Sparkie’s model answers 4 requests at once, shared with your own chats; apps get at most 3.');
      assert.equal(card.notes[2], 'Context: 262,144 tokens (its server’s setting).');
    });
  });
}
