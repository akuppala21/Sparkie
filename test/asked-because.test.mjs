// Covers: A typed change Sparkie is asked about says which gate asked (askedBecause, code's own short words, on the
// tool result the brain gets and the eval's record keeps): "words" when the owner's words don't ask for it clearly (a
// question about it), "rail" when they do but Sparkie's brain isn't checked (no eval on record here, R52). Nothing runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, newChat, say, SLOW } from './lib.mjs';

// No eval on record: a clear change is a button because of the rail, an unclear one because of the words.
// (knowledge: the watcher's record of what runs where, so the words can point at a container from the first message)
useFleet({ watchMs: 60000, knowledge: true, evalOnRecord: false });

const RADIX = 'sc-RadixArk--Qwen3.8-27B-NVFP4';
const stateOf = (spark, name) => readFileSync(join(T.fleet.root, spark, '.mock', 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];
const requests = () => (existsSync(join(T.fleet.dir, 'model-requests.jsonl')) ? readFileSync(join(T.fleet.dir, 'model-requests.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []);
// What the brain was handed back for its tool call in the turn that began with these words.
async function resultOf(words) {
  writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify([{ match: `^${words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, calls: [{ name: 'stop_model', arguments: { spark: 'spark4', container: RADIX } }] }]));
  try {
    const from = requests().length;
    const r = await say(await newChat(), words);
    assert.deepEqual(r.tools.map(t => [t.name, t.outcome]), [['stop_model', 'needs-ok']], JSON.stringify(r.tools));
    const [content] = requests().slice(from).filter(x => x.words === words && x.lastRole === 'tool').flatMap(x => x.results.map(y => y.content));
    return JSON.parse(content);
  } finally { rmSync(join(T.fleet.dir, 'model-script.json'), { force: true }); }
}

test('a question about a change, not a request for it: asked because of the words', { timeout: 120000 * SLOW }, async () => {
  const v = await resultOf(`should I stop ${RADIX} on spark 4?`);
  assert.equal(v.outcome, 'needs-ok');
  assert.equal(v.askedBecause, 'words');
  assert.equal(stateOf('spark4', RADIX), 'running');
});

test('a clear request while the brain isn\'t checked: asked because of the rail', { timeout: 120000 * SLOW }, async () => {
  const v = await resultOf(`stop ${RADIX} on spark 4`);
  assert.equal(v.outcome, 'needs-ok');
  assert.equal(v.askedBecause, 'rail');
  assert.equal(stateOf('spark4', RADIX), 'running');
});
