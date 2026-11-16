// Covers: The agent door's own handling of a call (R73, Astra's A-25): a call of a tool that can change something
// (run here) that outlasts the door's 50 seconds is told it is still going, never to try again, and keeps its slot of
// the three at once until its work truly ends; the same call again while it runs joins it and runs nothing twice. A
// change sent again by the same agent (a fresh JSON-RPC id each time) while it, or the operation it started, still
// runs gets the first's answer and does the work once: run_workflow (which has no check of its own), stop_model,
// start_model and restart_model; once that work has ended (save_file and remember end as they answer), each change's
// own check answers the repeat (already, a conflict). The stand-in fleet, with the root helper rehearsed for Spark 3 (test/rehearsal.mjs,
// run: true) and a look's and a box command's limit of 58 seconds. Linux only: run it on a Spark.
// T58 (part): the same call twice runs the start once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, post, createActKey, auditLines, waitFor, sleep, SLOW } from './lib.mjs';
import { rehearse } from './rehearsal.mjs';

const keys = {};
useFleet({ watchMs: 60000, env: { SPARK_CONSOLE_LOOK_SECONDS: '58', SPARK_CONSOLE_BOX_RUN_SECONDS: '58', SPARK_CONSOLE_RUN_SECONDS: '6', SPARK_CONSOLE_ROUTE_MS: '1000',
  SPARK_CONSOLE_WIDE_MS: '1', SPARK_CONSOLE_NET: '0', SPARK_CONSOLE_HUB: '0' },
  prepare: ({ root }) => { rehearse(root, 'spark3', { run: true }); } },
async () => { keys.act = await createActKey('door-repeat'); });

let rpcId = 7000;
// One tools/call, each with an id of its own.
async function send(name, args) {
  const r = await post({ jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } }, { token: keys.act.token, timeout: 90000 * SLOW });
  const text = r.json?.result?.content?.[0]?.text;
  let value; try { value = JSON.parse(text); } catch { value = undefined; }
  return { isError: r.json?.result?.isError, text: String(text ?? r.text), value };
}
const lines = file => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const journalLines = () => readdirSync(T.fleet.journalDir).filter(f => f.endsWith('.jsonl')).sort().flatMap(f => lines(join(T.fleet.journalDir, f)));
// What the action itself did for this agent (runAction's own audit lines that went through), and the door's lines for it.
const ran = action => auditLines().filter(l => l.via === 'agent' && l.actor === keys.act.name && l.action === action && l.ok !== false).length;
const doorLines = action => auditLines().filter(l => l.agent === keys.act.id && l.action === action);
async function finished(id) {
  return waitFor(async () => { const j = (await api(`/jobs/${id}`)).json; return j && j.status !== 'running' && j; }, { timeout: 240000, every: 500, what: `operation ${id} to end` });
}

// (the box's image is fetched once, before the first box opens)
test('the box is ready', { timeout: 300000 * SLOW }, async () => {
  await waitFor(async () => (await send('run', { on: 'box', command: 'true' })).value?.ran === true, { timeout: 240000, every: 3000, what: 'the box to open' });
});

test('a run that outlasts the door is told it is still going, never to try again; it keeps its slot until its work ends; the same call again joins it', { timeout: 240000 * SLOW }, async () => {
  const A = { on: 'spark3', command: 'sleep 55' }, B = { on: 'spark3', command: 'sleep 56' }, C = { on: 'box', command: 'sleep 55' };
  const three = await Promise.all([send('run', A), send('run', B), send('run', C)]);
  for (const r of three) {
    assert.equal(r.isError, true, r.text);
    assert.match(r.text, /^\[still_running\] run took over 50 seconds and is still going: nothing was started twice\./, r.text);
    assert.ok(!/try again/i.test(r.text.split('.')[0]) && !/Try again in a minute/.test(r.text), r.text);
  }
  // Their work still runs, so their slots are still taken.
  const busy = await send('fleet_status', {});
  assert.equal(busy.isError, true, busy.text);
  assert.match(busy.text, /^\[busy, retry later\] This agent already has 3 tools running\./);
  // The same call again joins the first: its answer is the first's, when the look ends, and the look ran once.
  const again = await send('run', A);
  assert.equal(again.isError, false, again.text);
  assert.equal(again.value?.outcome, 'look', again.text);
  await sleep(500);
  const looks = journalLines().filter(x => x.k === 'cmd' && x.class === 'look' && x.args?.command === 'sleep 55' && x.args?.spark === 'spark3');
  assert.equal(looks.length, 1, JSON.stringify(looks));
  assert.ok(doorLines('run').some(l => l.joined), 'the repeat’s line says joined');
  // Once all three have ended, the slots are free again.
  await waitFor(async () => !(await send('fleet_status', {})).isError, { timeout: 30000, every: 1000, what: 'the slots to be free' });
});

test('a change sent again while it, or its operation, still runs gets the first\'s answer and does the work once; once it has ended, its own check answers', { timeout: 600000 * SLOW }, async () => {
  const slow = (cmd, n) => writeFileSync(join(T.fleet.root, 'spark3', '.mock', `slow-${cmd}`), String(n));
  try {
    for (const c of ['run', 'stop', 'start']) slow(c, 3);
    // run_workflow has no check of its own: two at once and one more while its run goes are one run. (Its step starts
    // gpt-oss-20b on Spark 3.)
    const saved = await api('/actions/save_workflow', { method: 'POST', body: { title: 'door repeat', steps: [{ action: 'start_model', args: { model: 'gpt-oss-20b', spark: 'spark3' } }] } });
    assert.equal(saved.status, 200, saved.text);
    const runs = async () => (await api('/jobs')).json.jobs.filter(j => j.type === 'workflow-run' && j.model === 'door repeat');
    const [w1, w2] = await Promise.all([send('run_workflow', { name: 'door repeat' }), send('run_workflow', { name: 'door repeat' })]);
    const w3 = await send('run_workflow', { name: 'door repeat' });
    for (const w of [w1, w2, w3]) assert.equal(w.isError, false, w.text);
    assert.equal((await runs()).length, 1, JSON.stringify([w1.value, w2.value, w3.value]));
    assert.ok(w1.value.operation && w2.value.operation === w1.value.operation && w3.value.operation === w1.value.operation, JSON.stringify([w1.value, w2.value, w3.value]));
    assert.equal(ran('run_workflow'), 1);
    assert.equal((await finished(w1.value.operation)).status, 'completed');
    // stop_model, then start_model, then restart_model, each slow: again while its operation runs is the same answer;
    // once it has ended, its own "already".
    for (const [name, args] of [['stop_model', { spark: 'spark3', container: 'sc-gpt-oss-20b' }], ['start_model', { model: 'gpt-oss-20b', spark: 'spark3' }],
      ['stop_model', { spark: 'spark3', container: 'sc-gpt-oss-20b' }], ['restart_model', { spark: 'spark3', container: 'sc-gpt-oss-20b' }]]) {
      const before = ran(name);
      const one = await send(name, args);
      assert.equal(one.value?.outcome, 'started', `${name}: ${one.text}`);
      const two = await send(name, args);
      assert.deepEqual([two.value?.outcome, two.value?.operation], ['started', one.value.operation], name);
      assert.equal(ran(name), before + 1, name);
      assert.equal((await finished(one.value.operation)).status, 'completed', name);
      const three = await send(name, args);
      assert.equal(three.value?.outcome, 'already', `${name}: ${three.text}`);
    }
  } finally { for (const c of ['run', 'stop', 'start']) rmSync(join(T.fleet.root, 'spark3', '.mock', `slow-${c}`), { force: true }); }
  // save_file and remember start no operation and answer at once: a repeat after the answer is the action's own
  // conflict or "already", and the work was done once.
  const f = { spark: 'spark4', path: 'door-repeat.txt', text: 'one\n' };
  const f1 = await send('save_file', f), f2 = await send('save_file', f);
  assert.equal(f1.value?.outcome, 'saved', f1.text);
  assert.equal(f2.isError, true);
  assert.match(f2.text, /^\[conflict, retry later\] door-repeat\.txt is already in the shared folder on Spark 4/);
  assert.equal(ran('save_file'), 1);
  const m = { text: 'The door repeat test ran here once.' };
  const m1 = await send('remember', m), m2 = await send('remember', m);
  assert.equal(m1.value?.outcome, 'remembered', m1.text);
  assert.equal(m2.value?.outcome, 'already', m2.text);
});
