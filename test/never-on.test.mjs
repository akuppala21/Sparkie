// Covers: What Sparkie says it never changes, with the pieces turned on (M2w; R3): with the lock-out net, changes on
// Spark 2 and root on, as they are by default, the prompt, the abilities text and run's own text say what is true, and
// the code does it: a lock-out change on Spark 3 is asked as its own message, a change on Spark 2 is asked with a
// button, a lock-out change on Spark 2 is refused, and sudo in a plain command is told to set root instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, newChat, say, SLOW } from './lib.mjs';
import { rehearse } from './rehearsal.mjs';
import { brainSent } from './lock.mjs';

useFleet({ watchMs: 60000, prepare: ({ root }) => { rehearse(root, 'spark3', { run: true }); rehearse(root, 'spark2'); } });
// (the root helper on both, so each change is asked: one Spark a fleet runs changes in a rehearsal, so Spark 2's is a
// look's rehearsal; nothing here is pressed)
const ASKED = 'On a compute Spark a change to SSH, Tailscale, the firewall or users runs only inside the put-back net, after the owner’s press. A command as root runs only on a compute Spark where the owner turned root on, always asked and always inside that net. On Spark 2 every change is asked and runs inside the net; one that could lock the owner out is refused, and so is a long one (minutes).';
// One owner's message whose stand-in brain calls run once: the reply's step for it.
async function runInChat(words, on, command) {
  writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify([{ match: `^${words}$`, calls: [{ name: 'run', arguments: { on, command, dir: '~' } }] }]));
  const r = await say(await newChat(), words);
  writeFileSync(join(T.fleet.dir, 'model-script.json'), '[]');
  return r.tools.find(t => t.name === 'run');
}

test('the pieces on: the prompt, the abilities text and run\'s text say what is true, and the code does it', { timeout: 240000 * SLOW }, async () => {
  const sent = await brainSent(T.fleet), runText = sent.tools.find(t => t.function?.name === 'run')?.function?.description || '';
  assert.ok(sent.system.includes(`You never change Spark Console’s own keys, or who may use Spark Console, and never turn Spark Console off. If asked, say the owner does that by hand. ${ASKED}`), sent.system);
  const ab = (await api('/actions/sparkie_setup', { method: 'POST', body: { about: 'abilities' } })).json;
  assert.deepEqual([ab.limits[0], ab.limits.at(-1)], ['Sparkie never changes Spark Console’s own keys, or who may use Spark Console, and never turns Spark Console off. The owner does those by hand.', ASKED]);
  assert.ok(runText.includes(' On Spark 2 every change is asked, and one that could lock the owner out is refused. On a compute Spark anything that could lock the owner out runs only inside the put-back net, after the owner’s press; as root (root: true, never sudo) only where the owner turned root on, always asked and always inside that net.'), runText);
  assert.equal((await runInChat('fix the keys on spark 3', 'spark3', 'chmod 600 ~/.ssh/authorized_keys')).tail, 'Asked first, as its own message: nothing ran yet.');
  assert.equal((await runInChat('fix the notes on spark 2', 'spark2', 'touch notes/x.txt')).tail, 'Asked first, with a button: nothing ran yet.');
  assert.match((await runInChat('fix the keys on spark 2', 'spark2', 'chmod 600 ~/.ssh/authorized_keys')).tail, /^Not done on Spark 2 yet: a change that can lock you out of Spark 2/);
  const root = await api('/actions/run', { method: 'POST', body: { on: 'spark3', command: 'sudo touch notes/root.txt', dir: '~' } });
  assert.deepEqual([root.status, root.json.error], [403, 'Nothing ran: a command becomes root only by setting root (run with root: true), which is always asked as root and runs inside the lock-out net. Leave out sudo and set root.']);
});
