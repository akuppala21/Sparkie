// Covers: When the copy of the state goes (20-state-copy.mjs; contract 6.25; design E 2.5 and build step 2, its first
// half). A Spark coming online with the state unchanged gets no copy, also through a power-off and on; one that wakes
// after the state changed gets one while it is awake. With every compute Spark off and the state changing for three
// days (the clock stand-in), nothing is woken and nothing is sent, and no needs line shows before day 7; at day 7 one
// line and one notice; the Spark that comes back gets one copy, not three, and the line goes. A copy is not use: an idle
// Spark that keeps receiving copies is still powered off at its idle limit. Before Spark Console powers off the Spark
// that holds the newest copy, it copies the state there first, inside the power-off; a copy that fails is on the record
// and the power-off still happens; a power-off that arrives while a copy goes to that Spark waits for it, then goes
// ahead.
//
// Two stand-in fleets, each with the stand-in plug controller tied to Sparks 3 and 4 (test/mock/plugs.mjs) and the
// stand-in sudo, as in power.test.mjs; nothing runs on Sparks 3 and 4, so a power-off stops nothing. The first looks
// every 3 s (the hourly look, made short) and runs on the clock stand-in (mock/clock.mjs, its dates too); the second
// looks only once, 2 s after it starts, so a copy before a power-off can only come from the power-off itself.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, appendFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { request, eventLines, waitFor, sleep, REPO, SLOW } from './lib.mjs';
import { startMock } from './start-mock.mjs';
import { startPlugs } from './mock/plugs.mjs';

// spark3's plug is node 2, spark4's node 3, Spark 2's (read-only) node 5 (as in power.test.mjs).
const PLUG_NODES = () => [
  { node_id: 2, available: true, attributes: { '1/6/0': true, '1/144/8': 0, '1/144/4': 121000, '1/144/5': 0 } },
  { node_id: 3, available: true, attributes: { '1/6/0': true, '1/144/8': 0, '1/144/4': 121000, '1/144/5': 0 } },
  { node_id: 5, available: true, readOnly: true, attributes: { '1/6/0': true, '1/144/8': 150000, '1/144/4': 121000, '1/144/5': 1300 } },
];
const POWER_ENV = url => ({
  SPARK_CONSOLE_PLUGS_URL: url, SPARK_CONSOLE_PLUGS_MS: '500',
  SPARK_CONSOLE_POWER_MS: '1000', SPARK_CONSOLE_POWER_FIRST_MS: '1000', SPARK_CONSOLE_IDLE_MINUTE_MS: String(1000 * SLOW),
  SPARK_CONSOLE_POWER_POLL_MS: '300', SPARK_CONSOLE_POWER_OFF_WAIT_MS: String(8000 * SLOW), SPARK_CONSOLE_POWER_ON_WAIT_MS: String(30000 * SLOW),
  SPARK_CONSOLE_POWER_CYCLE_MS: '300', SPARK_CONSOLE_POWER_HOLD_MS: String(3000 * SLOW), SPARK_CONSOLE_HEAL_MS: '1500', SPARK_CONSOLE_DESIRED_MS: '1500',
  SPARK_CONSOLE_HEAL_SETTLE_MS: '2000', SPARK_CONSOLE_HEAL_OFFLINE_MS: '1000', SPARK_CONSOLE_CONNECT_MS: String(20000 * SLOW),
});
// The plugs paired; the idle power-off off; nothing on Sparks 3 and 4 (no hand-started benchmark, none of Spark
// Console's models running); nothing on the list of what should be running.
function prepare({ root, stateDir }) {
  writeFileSync(join(stateDir, 'plugs.json'), JSON.stringify({ spark2: { node: 5, readOnly: true }, spark3: { node: 2 }, spark4: { node: 3 } }), { mode: 0o600 });
  writeFileSync(join(stateDir, 'power.json'), JSON.stringify({ idleMinutes: 0, off: {} }), { mode: 0o600 });
  for (const spark of ['spark3', 'spark4']) {
    const m = join(root, spark, '.mock'), f = join(m, 'containers');
    writeFileSync(f, readFileSync(f, 'utf8').split('\n').filter(l => l && !l.startsWith('qwen-recipe-')).map(l => l.replace(/^([^|]*)\|running\|[^|]*\|/, '$1|exited|Exited (0) 1 hour ago|')).join('\n') + '\n');
    for (const u of readdirSync(m).filter(x => x.startsWith('up-'))) rmSync(join(m, u), { force: true });
  }
  const at = new Date().toISOString();
  writeFileSync(join(stateDir, 'desired.json'), JSON.stringify({ revision: 1, running: [],
    revisions: [{ revision: 1, at, by: 'test', chat: null, operation: null, added: [], removed: [], before: [], seeded: true }] }), { mode: 0o600 });
}

const ownerOn = (F, path, { method = 'GET', body } = {}) => request(`${F.base}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body),
  headers: method === 'GET' ? {} : { 'content-type': 'application/json', 'x-spark-console': '1', origin: F.origin } }).then(r => ({ ...r, json: JSON.parse(r.text || 'null') }));
const act = (F, name, args = {}) => ownerOn(F, `/actions/${name}`, { method: 'POST', body: args });
const record = async F => (await ownerOn(F, '/health')).json.lastBackup;
const copies = (F, spark) => { try { return readdirSync(join(F.root, spark, '.local', 'share', 'spark-console', 'backups')).sort(); } catch { return []; } };
const offline = F => readFileSync(F.offlineFile, 'utf8').split(/\s+/).filter(Boolean);
const setOffline = (F, spark, off) => writeFileSync(F.offlineFile, `${[...offline(F).filter(x => x !== spark), ...(off ? [spark] : [])].join('\n')}\n`);
const seenOnline = (F, id, on) => waitFor(async () => ((await ownerOn(F, '/status?fresh=1')).json.nodes.find(n => n.id === id)?.state === 'online') === on,
  { timeout: 60000 * SLOW, what: `${id} ${on ? 'online' : 'offline'}` });
const needsCopy = async F => (await act(F, 'fleet_status')).json.needsOwner.filter(l => /copied to another Spark/.test(l));
const lateNotices = F => eventLines(F).filter(e => e.type === 'notice' && /^Spark Console’s state hasn’t been copied to another Spark for over 7 days/.test(e.text || ''));
// A change to the state: the owner's self-healing switch (agent-settings.json).
async function change(F, selfHeal) {
  const r = await ownerOn(F, '/agents/settings', { method: 'PUT', body: { selfHeal } });
  assert.equal(r.status, 200, r.text);
}
// A file as a copy on a Spark holds it.
const inCopy = (F, spark, file, name) => JSON.parse(execFileSync('tar', ['-xzOf', join(F.root, spark, '.local', 'share', 'spark-console', 'backups', file), `./${name}`], { encoding: 'utf8' }));
// An operation to its end, completed; with its whole log (each line starts with the time).
async function done(F, r) {
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.outcome, 'started', r.text);
  for (const until = Date.now() + 240000 * SLOW; ;) {
    const w = (await act(F, 'wait_operation', { id: r.json.operation, seconds: 20 })).json;
    if (w.status !== 'running') {
      assert.equal(w.status, 'completed', JSON.stringify(w));
      return { ...w, log: (await ownerOn(F, `/jobs/${r.json.operation}`)).json.log };
    }
    assert.ok(Date.now() < until, `still running: ${JSON.stringify(w)}`);
  }
}
// An operation found by id, to its end, completed.
async function ended(F, id) {
  for (const until = Date.now() + 240000 * SLOW; ;) {
    const w = (await act(F, 'wait_operation', { id, seconds: 20 })).json;
    if (w.status !== 'running') { assert.equal(w.status, 'completed', JSON.stringify(w)); return w; }
    assert.ok(Date.now() < until, `still running: ${JSON.stringify(w)}`);
  }
}
// Until no new copy has been recorded for 10 s (more than three looks): what Spark Console writes as it starts (the
// brain's first check a minute in, among others) has been copied.
async function quiet(F) {
  let last = await record(F), since = Date.now();
  for (const until = Date.now() + 120000 * SLOW; Date.now() - since < 10000;) {
    assert.ok(Date.now() < until, 'the copies never settled');
    await sleep(1000);
    const b = await record(F);
    if (b?.at !== last?.at) { last = b; since = Date.now(); }
  }
  return last;
}

describe('the copy of the state', { concurrency: true }, () => {
  describe('rides on a Spark that is awake, and never wakes one', { concurrency: 1 }, () => {
    let F, plugs;
    const clock = days => writeFileSync(join(F.dir, 'clock-offset'), String(Math.round(days * 86400000)));
    before(async () => {
      plugs = await startPlugs(PLUG_NODES());
      F = await startMock({ statusMs: 1500, watchMs: 5000, prepare,
        env: { ...POWER_ENV(plugs.url), SPARK_CONSOLE_BACKUP_FIRST_MS: '2000', SPARK_CONSOLE_BACKUP_MS: '3000',
          NODE_OPTIONS: `--import=${join(REPO, 'test', 'mock', 'clock.mjs')}`, MOCK_CLOCK_DATES: '1' } });
      plugs.attach({ offlineFile: F.offlineFile, sparks: { 2: 'spark3', 3: 'spark4' }, bootMs: 1500 });
      const first = await waitFor(async () => { const b = await record(F); return b?.ok && b; }, { timeout: 30000 * SLOW, what: 'the first copy' });
      assert.equal(first.to, 'spark3');
      // (the brain's first check, a minute after the start, writes its profile: copied, then quiet)
      await waitFor(() => existsSync(join(F.stateDir, 'brain-profiles.json')), { timeout: 150000 * SLOW, every: 1000, what: 'the brain’s first profile' }).catch(() => {});
      await quiet(F);
    }, { timeout: 400000 * SLOW });
    after(async () => { await F?.stop(); await plugs?.close(); }, { timeout: 30000 });

    test('a Spark coming online with the state unchanged gets no copy; a power-off and on with nothing changed sends none either', { timeout: 300000 * SLOW }, async () => {
      const r0 = await record(F);
      // Dark and back (the owner's hand, a cable): no copy.
      setOffline(F, 'spark4', true);
      await seenOnline(F, 'spark4', false);
      setOffline(F, 'spark4', false);
      await seenOnline(F, 'spark4', true);
      await sleep(7000);
      assert.equal((await record(F)).at, r0.at, 'no copy for a Spark that came back');
      // Powered off and on by Spark Console: no copy before it goes (Spark 3 holds the newest), none when it is back.
      await done(F, await act(F, 'power_off', { spark: 'spark4' }));
      assert.ok(offline(F).includes('spark4'));
      await done(F, await act(F, 'power_on', { spark: 'spark4' }));
      await seenOnline(F, 'spark4', true);
      await sleep(7000);
      assert.equal((await record(F)).at, r0.at, 'no copy before the power-off or after the power-on');
      assert.deepEqual(copies(F, 'spark4'), [], 'Spark 4 was never sent one');
    });

    // T135 (part): Spark 3 wakes after the state changed, and a copy is taken while it is awake.
    test('Spark 3 wakes after the state changed: it gets a copy while it is awake; nothing was sent while every compute Spark was off', { timeout: 300000 * SLOW }, async () => {
      await done(F, await act(F, 'power_off', { sparks: ['spark3', 'spark4'] }));
      const r1 = await record(F);
      await change(F, false);
      await sleep(7000);
      assert.equal((await record(F)).at, r1.at, 'none was sent with every compute Spark off');
      await done(F, await act(F, 'power_on', { spark: 'spark3' }));
      const b = await waitFor(async () => { const x = await record(F); return x?.ok && x.at !== r1.at && x; }, { timeout: 30000 * SLOW, what: 'a copy to Spark 3' });
      assert.equal(b.to, 'spark3');
      assert.equal(inCopy(F, 'spark3', b.file, 'agent-settings.json').selfHeal, false, 'the copy holds the change');
      assert.deepEqual(copies(F, 'spark4'), []);
    });

    test('every compute Spark off and the state changing for three days: nothing is woken or sent, no needs line; at day 7 one line and one notice; the Spark that comes back gets one copy, not three, and the line goes', { timeout: 400000 * SLOW }, async () => {
      await done(F, await act(F, 'power_off', { spark: 'spark3' }));
      const r2 = await record(F), on = plugs.commands.length, ops = (await act(F, 'recent_operations', { limit: 50 })).json.operations.length;
      const had3 = copies(F, 'spark3'), had4 = copies(F, 'spark4');
      assert.ok(offline(F).includes('spark3') && offline(F).includes('spark4'));
      for (const day of [1, 2, 3]) {
        clock(day);
        await change(F, day % 2 === 0);
        await sleep(5000);
      }
      assert.deepEqual(plugs.commands.slice(on), [], 'no plug was switched');
      assert.ok(offline(F).includes('spark3') && offline(F).includes('spark4'), 'both stay off');
      assert.equal((await act(F, 'recent_operations', { limit: 50 })).json.operations.length, ops, 'no operation began');
      assert.equal((await record(F)).at, r2.at, 'nothing was sent, or tried');
      assert.deepEqual([copies(F, 'spark3'), copies(F, 'spark4')], [had3, had4]);
      assert.deepEqual(await needsCopy(F), [], 'no needs line on day 3');
      // Just short of 7 days since the newest copy: still none.
      clock(6.9);
      await sleep(5000);
      assert.deepEqual(await needsCopy(F), [], 'no needs line before day 7');
      assert.deepEqual(lateNotices(F), []);
      // Day 7: one line and one notice, whatever the looks after.
      clock(7.01);
      const lines = await waitFor(async () => { const l = await needsCopy(F); return l.length && l; }, { timeout: 30000 * SLOW, what: 'the needs line' });
      assert.equal(lines.length, 1);
      assert.match(lines[0], /^Spark Console’s state hasn’t been copied to another Spark for over 7 days \(the newest copy is from \d{4}-\d\d-\d\d, on Spark 3\), and it has changed since\. A copy goes by itself the next time another Spark is on; none is turned on for it/);
      await waitFor(() => lateNotices(F).length, { timeout: 30000 * SLOW, what: 'the notice' });
      await sleep(7000);
      assert.equal(lateNotices(F).length, 1, 'one notice, not one a look');
      assert.equal((await needsCopy(F)).length, 1);
      assert.deepEqual(plugs.commands.slice(on), [], 'still nothing switched');
      // Spark 4 is turned on: one copy, not one for each day it missed, and the line goes.
      await done(F, await act(F, 'power_on', { spark: 'spark4' }));
      const c = await waitFor(async () => { const x = await record(F); return x?.ok && x.at !== r2.at && x; }, { timeout: 30000 * SLOW, what: 'the copy to Spark 4' });
      assert.equal(c.to, 'spark4');
      await sleep(8000);
      assert.equal((await record(F)).at, c.at, 'one copy');
      assert.deepEqual(copies(F, 'spark4'), [...had4, c.file].sort(), 'one new file');
      assert.equal(inCopy(F, 'spark4', c.file, 'agent-settings.json').selfHeal, false, 'the last change is in it');
      assert.deepEqual(await needsCopy(F), [], 'the line goes');
    });

    test('a copy is not use: an idle Spark that keeps receiving copies is still powered off at its idle limit', { timeout: 300000 * SLOW }, async () => {
      // Spark 4 is on, idle (GPU 0%, load 0.1, nothing running there), and the idle power-off is 10 "minutes" of a second
      // each. The state changes every 2 s, so the look (every 3 s) keeps sending Spark 4 a copy.
      const status = join(F.root, 'spark4', '.mock', 'status.json');
      writeFileSync(status, JSON.stringify({ gpuUtilization: 0, load1Minute: 0.1 }));
      try {
        assert.equal((await act(F, 'power_settings', { idleMinutes: 10 })).json.outcome, 'saved');
        const landed = new Set();
        let op = null, flip = false;
        for (const until = Date.now() + 120000 * SLOW; !op;) {
          assert.ok(Date.now() < until, `not powered off while it took ${landed.size} copies`);
          await change(F, flip = !flip);
          await sleep(2000);
          const b = await record(F);
          if (b?.ok && b.to === 'spark4') landed.add(b.at);
          op = (await act(F, 'recent_operations', { limit: 50 })).json.operations.find(o => o.type === 'power-off' && o.actor === 'Idle power-off');
        }
        assert.ok(landed.size >= 3, `copies landed on Spark 4 while it waited out its idle minutes: ${landed.size}`);
        assert.equal(op.spark, 'spark4');
        await ended(F, op.id);
        assert.ok(offline(F).includes('spark4'));
        assert.equal(JSON.parse(readFileSync(join(F.stateDir, 'power.json'), 'utf8')).off.spark4?.why, 'idle');
      } finally { await act(F, 'power_settings', { idleMinutes: 0 }); rmSync(status, { force: true }); }
    });
  });

  describe('before a power-off', { concurrency: 1 }, () => {
    let F, plugs;
    before(async () => {
      plugs = await startPlugs(PLUG_NODES());
      F = await startMock({ statusMs: 1500, watchMs: 5000, prepare,
        env: { ...POWER_ENV(plugs.url), SPARK_CONSOLE_BACKUP_FIRST_MS: '2000', SPARK_CONSOLE_BACKUP_MS: '600000' } });
      plugs.attach({ offlineFile: F.offlineFile, sparks: { 2: 'spark3', 3: 'spark4' }, bootMs: 1500 });
      const first = await waitFor(async () => { const b = await record(F); return b?.ok && b; }, { timeout: 30000 * SLOW, what: 'the first copy' });
      assert.equal(first.to, 'spark3');
    }, { timeout: 180000 * SLOW });
    after(async () => { await F?.stop(); await plugs?.close(); }, { timeout: 30000 });

    test('Spark 3 holds the newest copy and the state changed: it gets a copy first, inside the power-off, before it goes down', { timeout: 300000 * SLOW }, async () => {
      const since = new Date().toISOString();
      await change(F, false);
      const w = await done(F, await act(F, 'power_off', { spark: 'spark3' }));
      assert.ok(w.log.some(l => /Copying Spark Console’s state to Spark 3 first$/.test(l)), JSON.stringify(w.log));
      assert.ok(w.log.some(l => /Spark Console’s state was copied to Spark 3 first$/.test(l)), JSON.stringify(w.log));
      const b = await record(F);
      assert.equal(b.ok, true, JSON.stringify(b));
      assert.equal(b.to, 'spark3');
      assert.ok(b.at > since, `${b.at} after ${since}`);
      const down = eventLines(F).find(e => e.type === 'spark-powered-off' && e.spark === 'spark3' && e.at > since);
      assert.ok(down && b.at < down.at, `the copy (${b.at}) before the power-off (${down?.at})`);
      assert.equal(inCopy(F, 'spark3', b.file, 'agent-settings.json').selfHeal, false, 'the copy holds the change');
      assert.ok(offline(F).includes('spark3'));
    });

    test('that copy fails: the power-off still happens, and the miss is on the record', { timeout: 300000 * SLOW }, async () => {
      await done(F, await act(F, 'power_on', { spark: 'spark3' }));
      await seenOnline(F, 'spark3', true);
      // (whatever Spark 3's coming back sent has landed)
      await sleep(4000);
      const was = await record(F), since = new Date().toISOString();
      writeFileSync(join(F.dir, 'tar-fails'), '');
      try {
        await change(F, true);
        const w = await done(F, await act(F, 'power_off', { spark: 'spark3' }));
        assert.ok(w.log.some(l => /Spark Console’s state couldn’t be copied first \(Spark 3 and Spark 4 didn’t take it\), so Spark 3 goes down without it\. The newest copy is from \d{4}-\d\d-\d\d, on Spark 3\.$/.test(l)),
          JSON.stringify(w.log));
        const b = await record(F);
        assert.equal(b.ok, false, JSON.stringify(b));
        assert.ok(b.at > since);
        assert.match(b.error, /Spark 3/);
        assert.deepEqual(b.good, was.good, 'the newest good copy is as it was');
        assert.ok(offline(F).includes('spark3'), 'it went down');
        const p = JSON.parse(readFileSync(join(F.stateDir, 'power.json'), 'utf8')).off.spark3;
        assert.equal(p?.plugCut, true, JSON.stringify(p));
      } finally { rmSync(join(F.dir, 'tar-fails'), { force: true }); }
    });

    test('a power-off that arrives while a copy goes to that Spark waits for it to land, then goes ahead', { timeout: 300000 * SLOW }, async () => {
      // Spark 4 goes dark; meanwhile the state grows by 192 MB of random bytes (they don't shrink), so its copy takes
      // seconds; Spark 4 comes back and the copy goes to it; the owner's power-off of Spark 4 arrives during it.
      const big = join(F.stateDir, 'big.bin');
      setOffline(F, 'spark4', true);
      await seenOnline(F, 'spark4', false);
      try {
        for (let i = 0; i < 12; i++) appendFileSync(big, randomBytes(16 * 1024 * 1024));
        const was = await record(F);
        setOffline(F, 'spark4', false);
        await waitFor(() => copies(F, 'spark4').some(f => f.endsWith('.part')), { timeout: 30000 * SLOW, every: 100, what: 'the copy to Spark 4 under way' });
        const w = await done(F, await act(F, 'power_off', { spark: 'spark4' }));
        const b = await record(F);
        assert.equal(b.ok, true, JSON.stringify(b));
        assert.equal(b.to, 'spark4');
        assert.notEqual(b.at, was.at);
        const down = eventLines(F).find(e => e.type === 'spark-powered-off' && e.spark === 'spark4');
        assert.ok(down && b.at < down.at, `the copy landed (${b.at}) before Spark 4 went down (${down?.at})`);
        assert.ok(execFileSync('tar', ['-tzf', join(F.root, 'spark4', '.local', 'share', 'spark-console', 'backups', b.file)], { encoding: 'utf8', maxBuffer: 1 << 26 }).split('\n').includes('./big.bin'));
        assert.ok(w.log.some(l => /Waiting for the copy of Spark Console’s state that is under way$/.test(l)), JSON.stringify(w.log));
        assert.ok(w.log.some(l => /That copy landed on Spark 4$/.test(l)), JSON.stringify(w.log));
        assert.ok(offline(F).includes('spark4'), 'it went down');
      } finally { rmSync(big, { force: true }); }
    });
  });
});
