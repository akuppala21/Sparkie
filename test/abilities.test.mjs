// Covers: “What can you do?” (A3): `sparkie_setup {about: "abilities"}` lists every action by its title straight from
// the registry (the same set as `TOOLS` and `CHANGE_TOOLS`), with the limits (what Sparkie never changes, when a change
// asks first, Sparkie's own Spark, what waits in the console from Telegram); the same text through `POST /actions` and
// the agent door (masking changes nothing); without `about` the answer is as before; in chat the stand-in brain makes
// one lookup, no change and no button, and Sparkie's prompt carries the same never-list and the line that says to call
// it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, call, createKey, newChat, say, TOOLS, CHANGE_TOOLS, SLOW } from './lib.mjs';

let look;
useFleet({ watchMs: 60000 }, async () => { look = (await createKey('abilities-look')).token; });
const requests = () => (existsSync(join(T.fleet.dir, 'model-requests.jsonl')) ? readFileSync(join(T.fleet.dir, 'model-requests.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
async function viaApi() {
  const r = await api('/actions/sparkie_setup', { method: 'POST', body: { about: 'abilities' } });
  assert.equal(r.status, 200, r.text);
  return r.json;
}
const NEVER = 'Spark Console’s own keys, or who may use Spark Console';

test('sparkie_setup {about: "abilities"}: every action by its title, from the list as it is now, with the limits; the same through POST /actions and the agent door', { timeout: 60000 * SLOW }, async () => {
  const x = await viaApi();
  assert.deepEqual(Object.keys(x), ['observedAt', 'canLookUp', 'canChange', 'limits', 'says']);
  const titleOf = Object.fromEntries((await api('/actions')).json.actions.map(a => [a.name, a.title]));
  // The live registry: no count is pinned, so a new action needs no edit here.
  assert.deepEqual([...x.canLookUp].sort(), TOOLS.map(n => titleOf[n]).sort());
  assert.deepEqual([...x.canChange].sort(), CHANGE_TOOLS.map(n => titleOf[n]).sort());
  assert.equal(x.limits.length, 5, JSON.stringify(x.limits));
  assert.equal(x.limits[0], `Sparkie never changes ${NEVER}, and never turns Spark Console off. The owner does those by hand.`);
  assert.equal(x.limits[1], 'In chat, a change runs at once only when the owner’s own words ask for it and name what it is about. Anything less clear comes back as one question with a button.');
  assert.equal(x.limits[2], 'Spark 2 is Sparkie’s own, so no other model or workload starts there.');
  assert.match(x.limits[3], /^From Telegram, these wait in Spark Console, pressed there with the passkey: /);
  for (const n of ['undo_update', 'remember', 'forget_memory', 'save_workflow', 'forget_workflow']) assert.ok(x.limits[3].includes(titleOf[n]), n);
  assert.equal(x.says, 'This is everything Sparkie can do today. Anything not listed here, it can’t do yet.');
  assert.ok(JSON.stringify(x).length < 3500, String(JSON.stringify(x).length));
  // The agent door masks and POST /actions doesn't: the same text, so masking changes nothing.
  const d = await call(look, 'sparkie_setup', { about: 'abilities' });
  assert.equal(d.isError, false, d.text);
  assert.ok(!d.text.includes('[hidden]'), d.text);
  assert.deepEqual({ ...d.value, observedAt: 0 }, { ...x, observedAt: 0 });
  // Without the argument, as before.
  const plain = (await call(look, 'sparkie_setup', {})).value;
  assert.ok('model' in plain && 'console' in plain && !('canChange' in plain), JSON.stringify(plain).slice(0, 300));
  const wrong = await call(look, 'sparkie_setup', { about: 'everything' });
  assert.equal(wrong.isError, true, wrong.text);
  assert.match(wrong.text, /^\[invalid\] about should be one of: abilities\./);
});

test('asked in chat: one lookup, no change, no button; Sparkie reads the same list, and its prompt names the same things it never changes', { timeout: 90000 * SLOW }, async () => {
  writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify([{ match: '^what can you do', calls: [{ name: 'sparkie_setup', arguments: { about: 'abilities' } }] }]));
  try {
    const from = requests().length, words = 'What can you do?';
    const r = await say(await newChat(), words);
    assert.deepEqual(r.message.tools.map(t => [t.name, t.ok, t.change]), [['sparkie_setup', true, false]]);
    assert.ok(!r.message.choices?.length, JSON.stringify(r.message.choices));
    const asked = requests().slice(from).filter(q => q.words === words);
    const seen = JSON.parse(asked.filter(q => q.lastRole === 'tool').flatMap(q => q.results.map(y => y.content))[0]);
    assert.deepEqual({ ...seen, observedAt: 0 }, { ...(await viaApi()), observedAt: 0 });
    assert.ok(asked[0].system.includes('When asked what you can do, call sparkie_setup with about "abilities"'), asked[0].system);
    assert.ok(asked[0].system.includes(`You never change ${NEVER}, and never turn Spark Console off.`), asked[0].system);
  } finally {
    rmSync(join(T.fleet.dir, 'model-script.json'), { force: true });
  }
});
