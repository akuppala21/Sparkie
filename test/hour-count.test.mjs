// Covers: run's changes count toward the hour's changes that pause agents (R9, S-11), on the stand-in fleet with the real
// root helper set up and proven for Spark 3 (test/rehearsal.mjs, run: true) and SPARK_CONSOLE_AGENT_CHANGES_PER_HOUR=2:
// Sparkie's looks count for nothing; its second change that ran in the hour pauses agents' changes (automatically), and
// the next change is refused while paused. Linux only: run it on a Spark with tools/test-on-spark.sh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { T, useFleet, api, agentSettings, newChat, say, waitFor, sleep, SLOW } from './lib.mjs';
import { rehearse } from './rehearsal.mjs';

useFleet({ env: { SPARK_CONSOLE_AGENT_CHANGES_PER_HOUR: '2', SPARK_CONSOLE_RUN_SECONDS: '6', SPARK_CONSOLE_ROUTE_MS: '1000', SPARK_CONSOLE_WIDE_MS: '1',
  SPARK_CONSOLE_NET: '0', SPARK_CONSOLE_HUB: '0' },
  prepare: ({ root }) => {
    rehearse(root, 'spark3', { run: true });
    const h = join(root, 'spark3');
    const put = (p, data) => { mkdirSync(dirname(join(h, p)), { recursive: true }); writeFileSync(join(h, p), data); chmodSync(join(h, p), 0o644); };
    put('notes/a.txt', 'a before\n');
    put('notes/b.txt', 'b before\n');
    put('notes/c.txt', 'c before\n');
  } }, async () => {
  const looks = () => (existsSync(join(T.fleet.dir, 'tailscale-calls')) ? readFileSync(join(T.fleet.dir, 'tailscale-calls'), 'utf8').split('\n').filter(l => l === 'status --json').length : 0);
  const n = looks();
  await waitFor(() => looks() >= n + 2, { timeout: 60000, what: 'two looks at the tailnet after a request' });
  await sleep(300);
});

const text = p => readFileSync(join(T.fleet.root, 'spark3', p), 'utf8');
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const RUN = command => ({ name: 'run', arguments: { on: 'spark3', command, dir: '~' } });
const settings = async () => (await api('/agents')).json.settings;
async function turn(words, call) {
  script([{ match: `^${words}$`, calls: [call] }]);
  try { return await say(await newChat(), words); } finally { rmSync(join(T.fleet.dir, 'model-script.json'), { force: true }); }
}

test('S-11: Sparkie\'s run changes count toward the hour; looks don\'t; the second pauses agents\' changes, and the third is refused', { timeout: 180000 * SLOW }, async () => {
  try {
    for (const n of [1, 2, 3]) {
      const look = await turn(`read note ${n} on spark 3`, RUN('cat notes/a.txt'));
      assert.equal(look.tools[0]?.outcome, 'look', JSON.stringify(look.tools));
    }
    assert.equal((await settings()).halted, false, 'looks count for nothing');
    const one = await turn('change a on spark 3', RUN('echo after > notes/a.txt'));
    assert.equal(one.tools[0]?.outcome, 'change', JSON.stringify(one.tools));
    assert.equal((await settings()).halted, false, 'not after the first');
    const two = await turn('change b on spark 3', RUN('echo after > notes/b.txt'));
    assert.equal(two.tools[0]?.outcome, 'change', JSON.stringify(two.tools));
    const st = await settings();
    assert.deepEqual([st.halted, st.autoPaused], [true, true], 'paused after the second, automatically');
    const three = await turn('change c on spark 3', RUN('echo after > notes/c.txt'));
    assert.notEqual(three.tools[0]?.outcome, 'change', JSON.stringify(three.tools));
    assert.equal(text('notes/c.txt'), 'c before\n', 'the third did not run');
  } finally { await agentSettings({ halted: false }); }
});
