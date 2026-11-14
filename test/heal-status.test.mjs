// Self-healing after a power-on waits until the status check has seen the Spark back (REVIEW-GUIDE section 6, done with
// the smart-plug work, 21-power.mjs). Until then the status check still has the Spark as off, and what self-healing
// knows of power-ons is the one before: one under 6 hours old that wasn't acted on for this model would bring it back at
// once, without the settle wait. Here Spark 4 answers SSH and Docker, but its status check hangs (the stand-in worker
// stalls), so Spark Console's record still says it's off; an older power cycle of Spark 4 (30 minutes ago) is on the
// record, and its model stopped when the power went (exit 255).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, waitFor, sleep, eventLines, SLOW } from './lib.mjs';

const MODEL = 'RadixArk--Qwen3.8-27B-NVFP4', R4 = `sc-${MODEL}`;
useFleet({ watchMs: 2000, statusMs: 2000,
  env: { SPARK_CONSOLE_HEAL_MS: '1000', SPARK_CONSOLE_HEAL_SETTLE_MS: '2000', SPARK_CONSOLE_HEAL_OFFLINE_MS: '1000', SPARK_CONSOLE_DESIRED_MS: '2000' },
  prepare: ({ root, stateDir }) => {
    const m = f => join(root, 'spark4', '.mock', f), now = Date.now(), iso = ms => new Date(now - ms).toISOString();
    // Its model stopped when the power went, and Spark 4's status check hangs.
    writeFileSync(m('containers'), readFileSync(m('containers'), 'utf8').replace(`${R4}|running|Up 1 second|`, `${R4}|exited|Exited (255) 30 minutes ago|`));
    rmSync(m(`up-${R4}`), { force: true });
    writeFileSync(m('stall-worker'), '600');
    // Spark Console's record: Spark 4 is off now; it went off 40 minutes ago and came back 30 minutes ago.
    writeFileSync(join(stateDir, 'knowledge.json'), JSON.stringify({ workloads: {}, sparks: { spark4: { online: false, lastSeenAt: iso(60000) } } }), { mode: 0o600 });
    writeFileSync(join(stateDir, 'events.jsonl'), `${[{ at: iso(40 * 60000), type: 'spark-offline', spark: 'spark4' }, { at: iso(30 * 60000), type: 'spark-online', spark: 'spark4', upSeconds: 60 }]
      .map(e => JSON.stringify(e)).join('\n')}\n`, { mode: 0o600 });
    writeFileSync(join(stateDir, 'desired.json'), JSON.stringify({ revision: 1, running: [{ spark: 'spark4', container: R4, model: MODEL, since: iso(3600000), by: 'test' }],
      revisions: [{ revision: 1, at: iso(3600000), by: 'test', chat: null, operation: null, added: [`spark4/${R4}`], removed: [], before: [], seeded: true }] }), { mode: 0o600 });
  },
});

const stateOf = () => readFileSync(join(T.fleet.root, 'spark4', '.mock', 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${R4}|`))?.split('|')[1];
const healed = since => eventLines().filter(e => e.at > since && ['healing', 'heal-skipped'].includes(e.type) && e.container === R4);

test('while the status check still has Spark 4 as off, an older power-on brings nothing back', { timeout: 120000 * SLOW }, async () => {
  // (Spark 4 answers: what should be running there is seen, stopped, while its status says off)
  await waitFor(async () => (await api('/desired')).json?.running?.some(x => x.container === R4 && x.state === 'held'), { what: 'the model seen there, stopped' });
  const since = new Date(0).toISOString();
  await sleep(12000 * SLOW);   // many heal passes, each with Spark 4 answering and Docker there answering
  assert.deepEqual(healed(since), [], JSON.stringify(healed(since)));
  assert.equal(stateOf(), 'exited');
});

test('once the status check sees it back, it comes back as "came back on", after the settle wait', { timeout: 180000 * SLOW }, async () => {
  rmSync(join(T.fleet.root, 'spark4', '.mock', 'stall-worker'), { force: true });
  const on = await waitFor(() => eventLines().find(e => e.type === 'spark-online' && e.spark === 'spark4' && Date.parse(e.at) > Date.now() - 600000), { timeout: 90000, what: 'Spark 4 seen back' });
  const ev = await waitFor(() => healed(on.at).find(e => e.type === 'healing'), { timeout: 90000, what: 'self-healing bringing it back' });
  assert.match(ev.why, /^Spark 4 came back on$/, JSON.stringify(ev));
  assert.ok(Date.parse(ev.at) - Date.parse(on.at) >= 2000, 'after the settle wait');
});
