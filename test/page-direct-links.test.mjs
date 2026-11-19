// Covers: A Spark's overview and chat snapshot use current ConnectX interface readings, with separate unavailable and
// unchecked states. Historical pair checks and worker counts cannot supply a live reading. Direct navigation loads the
// read, and the overview names only the hub's Always on policy or a configured smart plug as the power method.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const APP = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const REFRESH = 5 * 60000;
function page() {
  const names = ['directLinkSummary', 'sparkPowerMethod', 'factChips', 'nodeLine', 'refreshFabricReading', 'loadFabric'];
  const source = names.map(name => {
    const code = new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\) \\{\\n[\\s\\S]*?^\\}`, 'm').exec(APP);
    assert.ok(code, `${name} is in public/app.js`);
    return code[0];
  }).join('\n');
  const state = { status: { power: { switchable: ['spark2'] } }, fabric: {} };
  const now = { value: 2000000 }, requests = [], replies = [];
  const n = { id: 'spark2', name: 'Spark 2', online: true, dockerAccessible: true,
    network: { highSpeedLinksConfigured: 0, highSpeedLinksUp: 0 },
    power: { sleepModes: ['off'], remoteWakeVerified: true } };
  const ui = vm.runInNewContext(`${source}\n({ ${names.join(', ')} })`, {
    state, Date: { now: () => now.value }, FABRIC_REFRESH_MS: REFRESH, isUp: n => n.online,
    plural: (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`, portalHostId: () => 'spark1',
    h: (...parts) => parts, icon: name => name, hardware: () => 'DGX Spark', conn: () => null,
    num: Number.isFinite, wallState: () => ({ has: false }),
    fmt: { pct: () => '0%', gib: () => '—', temp: () => '—', watts: () => '—', disk: () => '—' },
    runLive() {},
    async capi(path) {
      requests.push(path);
      assert.ok(replies.length, 'unexpected fabric request');
      const response = replies.shift();
      if (response instanceof Error) throw response;
      return response;
    },
  });
  return { ui, state, n, now, requests, replies };
}
const reading = states => ({ id: 'spark2', online: true, links: states.map(up => ({ up })) });

test('actual interface readings take precedence over worker counts and historical pair checks', () => {
  const { ui, state, n, now } = page();
  state.fabric = {
    at: now.value, sparks: [reading([false, false, false, false])],
    pairs: [{ a: 'spark1', b: 'spark2', fastLink: 'full' }], checkedAt: '2026-11-01T00:00:00Z',
  };
  assert.equal(ui.directLinkSummary(n).text, 'No active direct links');
  assert.match(ui.nodeLine(n), /No active direct links/);
  assert.doesNotMatch(ui.nodeLine(n), /0 of 0|direct cables|spark1/);

  state.fabric.sparks = [reading([true, false, true, false])];
  assert.equal(ui.directLinkSummary(n).text, '2 direct network interfaces up');
  assert.match(ui.nodeLine(n), /2 direct network interfaces up/);
  n.network = { highSpeedLinksConfigured: 4, highSpeedLinksUp: 0 };
  assert.equal(ui.factChips(n).length, 0);
});

test('unchecked, stale, offline and unavailable reads never claim that zero links are active', () => {
  const { ui, state, n, now } = page();
  assert.equal(ui.directLinkSummary(n).text, 'Not checked yet');
  assert.doesNotMatch(ui.nodeLine(n), /No active direct links/);
  state.fabric = { at: now.value - REFRESH - 1, sparks: [reading([false])] };
  assert.equal(ui.directLinkSummary(n).text, 'Not checked yet');
  assert.doesNotMatch(ui.nodeLine(n), /No active direct links/);
  state.fabric.at = now.value;
  state.fabric.error = 'The scan failed.';
  assert.equal(ui.directLinkSummary(n).text, 'Unavailable');
  assert.doesNotMatch(ui.nodeLine(n), /No active direct links/);
  delete state.fabric.error;
  state.fabric.sparks[0].online = false;
  assert.equal(ui.directLinkSummary(n).text, 'Unavailable');
  n.online = false;
  assert.equal(ui.directLinkSummary(n).text, 'Unavailable');
});

test('a direct Spark view refreshes the interface reading without testing the cables or retrying a failure in a loop', async () => {
  assert.match(APP, /TABS\[tab\]\(content, n0, r\);\n  live\(refreshFabricReading\);/);
  const { ui, state, n, now, requests, replies } = page();
  let finish;
  replies.push(new Promise(resolve => { finish = resolve; }));
  const first = ui.refreshFabricReading();
  ui.refreshFabricReading();
  assert.deepEqual(requests, ['fabric']);
  finish({ sparks: [reading([true])], checkedAt: '2026-11-01T00:00:00Z' });
  await first;
  assert.equal(ui.directLinkSummary(n).text, '1 direct network interface up');
  await ui.refreshFabricReading();
  assert.deepEqual(requests, ['fabric']);

  now.value += REFRESH + 1;
  replies.push(new Error('Reading failed.'));
  await ui.refreshFabricReading();
  await ui.refreshFabricReading();
  assert.deepEqual(requests, ['fabric', 'fabric']);
  assert.equal(state.fabric.error, 'Reading failed.');
  assert.equal(ui.directLinkSummary(n).text, 'Unavailable');
});

test('the overview describes the hub or the known smart plug and ignores a worker wake flag', () => {
  const { ui, state, n } = page();
  assert.equal(ui.sparkPowerMethod({ id: 'spark1' }), 'Always on');
  assert.equal(ui.sparkPowerMethod(n), 'Smart plug');
  state.status.power.switchable = [];
  assert.equal(ui.sparkPowerMethod(n), null);
  assert.doesNotMatch(APP, /Wake over the network|remoteWakeVerified/);
});
