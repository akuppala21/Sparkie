// Covers: "Save that as nightly" (D6e): save_workflow {title, from: "this request"} saves the changes the owner's request
// just before made in that chat, read from the journal: after "start gpt-oss-20b on spark 3, then run wl-y on spark 4",
// the button lists those two steps and its press saves them with the arguments they were made with, and nothing a
// change in another chat did meanwhile; a request that changed nothing saves nothing and says so; an agent's key, and
// the owner's POST /actions (no chat), can't use from; steps and from together are refused.
//
// The stand-in fleet: Spark 3's model of Spark Console's is stopped first, so gpt-oss-20b starts there without a
// question; on Spark 4 the owner has made two jobs that end at once (~/.mock/jobs-run), run again by name in the chat
// once the watcher (every 3 s here) has seen them.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, call, createActKey, newChat, say, choose, waitFor, SLOW } from './lib.mjs';

const RADIX = 'sc-RadixArk--Qwen3.8-27B-NVFP4', GPT20 = 'sc-gpt-oss-20b';
const SINCE = '2026-11-12T08:00:00.000Z';
const SEEDED_RUNNING = [{ spark: 'spark4', container: RADIX, model: 'RadixArk--Qwen3.8-27B-NVFP4', since: SINCE, by: 'owner' }];
const keys = {};
useFleet({ watchMs: 3000,
  prepare: ({ root, stateDir }) => {
    const list = join(root, 'spark3', '.mock', 'containers');
    writeFileSync(list, readFileSync(list, 'utf8').replace(/^(sc-testorg--Qwen3\.8-27B-abliterated-GGUF)\|running\|[^|]*\|/m, '$1|exited|Exited (0) 2 hours ago|'));
    writeFileSync(join(stateDir, 'desired.json'), JSON.stringify({ revision: 1, running: SEEDED_RUNNING, revisions: [{ revision: 1, at: SINCE, by: 'owner', chat: null, operation: null, added: [`spark4/${RADIX}`], removed: [], before: [] }] }), { mode: 0o600 });
    writeFileSync(join(root, 'spark4', '.mock', 'jobs-run'), '');
  } }, async () => { keys.act = await createActKey('save-from'); });

const act = (name, body) => api(`/actions/${name}`, { method: 'POST', body });
const opEnd = (id, what) => waitFor(async () => { const o = (await api(`/jobs/${id}`)).json; return o?.status && o.status !== 'running' ? o : null; }, { timeout: 120000, what, every: 250 });
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const noScript = () => rmSync(join(T.fleet.dir, 'model-script.json'), { force: true });
const saved = async name => (await act('workflows', {})).json.saved.find(w => w.name === name) || null;
const stateOf = (spark, name) => readFileSync(join(T.fleet.root, spark, '.mock', 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];

describe('save that as …: a saved workflow from the request before (D6e)', { concurrency: 1 }, () => {
  before(async () => {
    for (const container of ['wl-y', 'wl-z']) {
      const r = await act('keep_running', { spark: 'spark4', container, image: 'python:3.12-slim', once: true, command: ['sh', '-c', `echo ${container}`] });
      assert.equal(r.json?.outcome, 'started', r.text);
      assert.equal((await opEnd(r.json.operation, `${container} made`)).status, 'completed');
    }
    // (Sparkie traces a container named in the owner's words through what the watcher has seen)
    await waitFor(async () => { const w = (await act('workloads', { spark: 'spark4' })).json?.workloads || []; return ['wl-y', 'wl-z'].every(n => w.some(x => x.name === n)); }, { timeout: 60000, what: 'the watcher seeing wl-y and wl-z' });
  }, { timeout: 120000 * SLOW });

  test('after "start gpt-oss-20b on spark 3, then run wl-y on spark 4", "save that as nightly" saves those two steps with their arguments, and nothing from another chat', { timeout: 300000 * SLOW }, async t => {
    const START = { name: 'start_model', arguments: { model: 'gpt-oss-20b', spark: 'spark3' } }, RUN_Y = { name: 'keep_running', arguments: { spark: 'spark4', container: 'wl-y' } };
    script([
      { match: '^start gpt-oss-20b on spark 3, then run wl-y on spark 4$', calls: [START, RUN_Y] },
      { match: '^run wl-z on spark 4$', calls: [{ name: 'keep_running', arguments: { spark: 'spark4', container: 'wl-z' } }] },
      { match: '^save that as nightly$', calls: [{ name: 'save_workflow', arguments: { title: 'nightly', from: 'this request' } }] },
      // (the carry-on turn, once both operations have ended, starts the model again: "already", the same step)
      { match: '^\\[Spark Console\\] What you started', calls: [START] },
    ]);
    t.after(async () => {
      noScript();
      await act('forget_workflow', { name: 'nightly' }).catch(() => {});
      if (stateOf('spark3', GPT20) === 'running') { const s = await api('/stop', { method: 'POST', body: { node: 'spark3', container: GPT20 } }); if (s.json?.id) await opEnd(s.json.id, 'the stop'); }
    });
    const chat = await newChat(), other = await newChat();
    const asked = await say(chat, 'start gpt-oss-20b on spark 3, then run wl-y on spark 4');
    assert.deepEqual(asked.message.tools.map(x => [x.name, x.ok, x.outcome ?? null]), [['start_model', true, 'started'], ['keep_running', true, 'started']], JSON.stringify(asked.message.tools));
    // Meanwhile, a change in another chat.
    const elsewhere = await say(other, 'run wl-z on spark 4');
    assert.deepEqual(elsewhere.message.tools.map(x => [x.name, x.ok, x.outcome ?? null]), [['keep_running', true, 'started']]);
    await waitFor(async () => stateOf('spark3', GPT20) === 'running', { timeout: 120000, what: 'gpt-oss-20b running' });
    // (the request's carry-on turn, part of the request, has run and ended)
    await waitFor(async () => { const c = (await api(`/chats/${chat}`)).json; return c.messages.some(m => m.role === 'user' && m.auto) && !c.replying && c.messages.at(-1)?.role === 'assistant'; }, { timeout: 120000, what: 'the carry-on turn' });
    const s = await say(chat, 'save that as nightly');
    assert.deepEqual(s.message.tools.map(x => [x.name, x.outcome ?? null]), [['save_workflow', 'needs-ok']], JSON.stringify(s.message.tools));
    const label = s.message.choices?.[0]?.label || '';
    assert.match(label, /^Save the workflow “nightly”: 1\. [^;]*gpt-oss-20b[^;]*Spark 3[^;]*; 2\. [^;]*wl-y[^;]*$/, label);
    assert.equal(await saved('nightly'), null, 'not saved by asking');
    const p = await choose(chat, s.message.choices[0].id);
    assert.equal(p.status, 200, p.text);
    const w = await saved('nightly');
    assert.deepEqual(w?.steps, [{ action: 'start_model', args: { model: 'gpt-oss-20b', spark: 'spark3' } }, { action: 'keep_running', args: { spark: 'spark4', container: 'wl-y' } }], JSON.stringify(w));
  });

  test('a request that changed nothing saves nothing, and says so', { timeout: 180000 * SLOW }, async t => {
    script([
      { match: '^what runs on spark 4\\?$', calls: [{ name: 'running_models', arguments: {} }] },
      { match: '^save that as idle$', calls: [{ name: 'save_workflow', arguments: { title: 'idle', from: 'this request' } }] },
    ]);
    t.after(noScript);
    const chat = await newChat();
    await say(chat, 'what runs on spark 4?');
    const s = await say(chat, 'save that as idle');
    assert.deepEqual(s.message.tools.map(x => [x.name, x.ok]), [['save_workflow', false]], JSON.stringify(s.message.tools));
    assert.match(s.text, /The request before this one in this chat changed nothing that can be saved, so nothing was saved\./, s.text);
    assert.equal(await saved('idle'), null);
    // The first words in a chat have no request before them.
    script([{ match: '^save that as first$', calls: [{ name: 'save_workflow', arguments: { title: 'first', from: 'this request' } }] }]);
    const first = await say(await newChat(), 'save that as first');
    assert.match(first.text, /There’s no request before this one in this chat, so nothing was saved\./, first.text);
  });

  test('an agent\'s key can\'t use from, nor the owner\'s POST /actions (no chat); steps and from together are refused', { timeout: 60000 * SLOW }, async () => {
    const agent = await call(keys.act.token, 'save_workflow', { title: 'agent copy', from: 'this request' });
    assert.equal(agent.isError, true);
    assert.match(agent.text, /from “this request” works only in your own chat with Sparkie/);
    const api403 = await act('save_workflow', { title: 'api copy', from: 'this request' });
    assert.equal(api403.status, 403, api403.text);
    assert.match(api403.json.error, /works only in your own chat with Sparkie/);
    const both = await act('save_workflow', { title: 'both', from: 'this request', steps: [{ action: 'find_setups', args: { model: 'glm-5.3-flash' } }] });
    assert.equal(both.status, 400, both.text);
    assert.match(both.json.error, /^Give steps or from, not both\.$/);
    const odd = await act('save_workflow', { title: 'odd', from: 'that thing' });
    assert.equal(odd.status, 400, odd.text);
    for (const n of ['agent copy', 'api copy', 'both', 'odd']) assert.equal(await saved(n.replace(' ', '-')), null);
  });
});
