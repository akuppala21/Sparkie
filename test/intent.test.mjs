// Covers: How the owner says it (the stand-in brain scripted to make the calls): "free up spark 4" and "clear spark 4"
// stop what runs there; "start … on 4" (a bare number names that Spark) and "switch spark 4 to …" start the model on
// Spark 4. Each runs at once, with no button, and its audit line keeps the Spark as said.
//
// How the owner says it (review of Sparkie's gate, 2026-11-11): a bare Spark number after "on" / "across" / "from" /
// "to" names that Spark ("start gemma on 3" ran wherever there was room before), and "switch … to", "swap", "replace",
// "set up", "install", "use …" ask for a start, "free up spark N" for stopping what runs there. Each runs at once, on
// the Spark the words name, with no button. The stand-in model is scripted (model-script.json) to make the calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, call, createKey, auditLines, newChat, say, waitFor, SLOW } from './lib.mjs';

// (a model in Recipes that agents may start: it runs no code of its own, and it runs on Spark 4 at first)
const MODEL = 'RadixArk--Qwen3.8-27B-NVFP4', CONTAINER = `sc-${MODEL}`;
let look;
useFleet({ watchMs: 60000, knowledge: true }, async () => { look = (await createKey('intent-look')).token; });
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const stateOf = (spark, name) => readFileSync(join(T.fleet.root, spark, '.mock', 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];
async function finished(id) {
  for (const until = Date.now() + 240000 * SLOW; ;) {
    const w = (await call(look, 'wait_operation', { id, seconds: 20 })).value;
    if (w.status !== 'running') return w;
    assert.ok(Date.now() < until, 'still running');
  }
}
// The Spark the change ran with, and where it came from (the owner's words, or Spark Console's own pick).
const sparkInPlan = line => { const i = line.plan?.inputs?.find(x => x.name === 'spark'); return i ? [i.value, i.source] : JSON.stringify(line.plan); };
// One request, scripted to one call: it ran at once (no button), as the audit line says, with these arguments.
async function ranAtOnce(words, name, args) {
  script([{ match: `^${words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, calls: [{ name, arguments: args }] }]);
  const chat = await newChat();
  const r = await say(chat, words);
  assert.ok(!(r.message.choices || []).length, `a button for "${words}": ${JSON.stringify(r.message.choices)}`);
  assert.deepEqual(r.message.tools.map(t => [t.name, t.ok]), [[name, true]], JSON.stringify({ tools: r.message.tools, audit: auditLines().filter(l => l.chat === chat) }));
  const line = await waitFor(() => auditLines().findLast(l => l.via === 'sparkie' && l.action === name && l.chat === chat), { what: 'the audit line' });
  assert.equal(line.outcome, 'started', JSON.stringify(line));
  const w = await finished(line.operation);
  assert.equal(w.status, 'completed', JSON.stringify(w));
  return line;
}

test('"free up spark 4" stops what runs there, at once', { timeout: 180000 * SLOW }, async () => {
  await ranAtOnce('free up spark 4', 'stop_model', { spark: 'spark4', container: CONTAINER });
  assert.notEqual(stateOf('spark4', CONTAINER), 'running');
});

test('"start … on 4": the bare number names Spark 4, and the start runs there', { timeout: 300000 * SLOW }, async () => {
  const line = await ranAtOnce(`start ${MODEL} on 4`, 'start_model', { model: MODEL, spark: 'spark4' });
  assert.deepEqual(sparkInPlan(line), ['spark4', 'said'], 'the Spark the owner named stays');
  assert.equal(stateOf('spark4', CONTAINER), 'running');
});

test('"switch spark 4 to …" is a start, run at once on Spark 4', { timeout: 300000 * SLOW }, async () => {
  await ranAtOnce('clear spark 4', 'stop_model', { spark: 'spark4', container: CONTAINER });
  const line = await ranAtOnce(`switch spark 4 to ${MODEL}`, 'start_model', { model: MODEL, spark: 'spark4' });
  assert.deepEqual(sparkInPlan(line), ['spark4', 'said']);
  assert.equal(stateOf('spark4', CONTAINER), 'running');
});
