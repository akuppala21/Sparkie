// What a Spark read before it went dark (service/src/19-watcher.mjs; round two, item 2: "why did Spark 4 go dark?").
// The status check keeps the GPU's numbers, the watcher adds the board's hottest sensor, the NVMe drive and the fan from
// sysfs (the stand-in fleet's $MOCK_ROOT/<spark>/sys). Going dark keeps the last reading if it is under three minutes
// old; coming back says how long the Spark has been up; spark_diagnostics lists the dark periods with one finding
// worded "consistent with". ~/.mock/status.json sets the stand-in worker's numbers (GPU load, watts, uptime).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, call, createKey, waitFor, sleep, request, say, newChat, SLOW } from './lib.mjs';
import { startMock } from './start-mock.mjs';

const keys = {};
useFleet({ watchMs: 2000, statusMs: 3000, env: { SPARK_CONSOLE_HEAL_OFFLINE_MS: '1000' } }, async () => { keys.look = await createKey('dark-look'); });

const home = spark => join(T.fleet.root, spark);
const put = (spark, path, text) => { const f = join(home(spark), 'sys', path); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, `${text}\n`); };
const setStatus = (spark, v) => writeFileSync(join(home(spark), '.mock', 'status.json'), JSON.stringify(v));
// (these tests poll hard through one key: over the door's 120 calls a minute, a call waits out the limit and is asked
// again, rather than failing as if the reading were wrong)
const look = async (name, args) => {
  let r;
  for (const until = Date.now() + 90000 * SLOW; ;) {
    r = await call(keys.look.token, name, args);
    const limited = r.status === 429 || /\b429\b|a minute|rate/i.test(JSON.stringify(r.json?.error || ''));
    if (!limited || Date.now() > until) break;
    await sleep(Math.min(10, Number(r.headers?.['retry-after']) || 2) * 1000);
  }
  assert.equal(r.isError, false, `${name}: ${r.status} ${r.text ?? r.raw}`);
  return r.value;
};
const sparkIn = async id => (await look('fleet_status', {})).sparks.find(s => s.id === id);
const eventsSince = async since => (await look('fleet_events', { since, limit: 200 })).events;
async function offline(id) {
  const since = new Date().toISOString();
  writeFileSync(T.fleet.offlineFile, `spark1\n${id}\n`);
  return waitFor(async () => (await eventsSince(since)).find(e => e.type === 'spark-offline' && e.spark === id), { timeout: 40000 * SLOW, what: `${id} going offline` });
}
async function online(id) {
  const since = new Date().toISOString();
  await sleep(1500); // dark longer than the 1 s that counts here (90 s on the real fleet)
  writeFileSync(T.fleet.offlineFile, 'spark1\n');
  return waitFor(async () => (await eventsSince(since)).find(e => e.type === 'spark-online' && e.spark === id), { timeout: 40000 * SLOW, what: `${id} coming back` });
}
const lastDark = async id => (await look('spark_diagnostics', { spark: id })).darkPeriods;
const requests = () => (existsSync(join(T.fleet.dir, 'model-requests.jsonl')) ? readFileSync(join(T.fleet.dir, 'model-requests.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

describe('what a Spark read before it went dark', { concurrency: 1 }, () => {
  test('fleet_status shows the board\'s hottest sensor and the drive beside the GPU\'s temperature; bad files are skipped', { timeout: 60000 * SLOW }, async () => {
    put('spark4', 'class/thermal/thermal_zone0/temp', '64000');
    put('spark4', 'class/thermal/thermal_zone1/temp', '71500');
    put('spark4', 'class/thermal/thermal_zone2/temp', 'not a number');
    put('spark4', 'class/hwmon/hwmon0/name', 'nvme');
    put('spark4', 'class/hwmon/hwmon0/temp1_input', '48900');
    put('spark4', 'class/hwmon/hwmon1/name', 'fan');
    put('spark4', 'class/hwmon/hwmon1/fan1_input', '2400');
    const s = await waitFor(async () => { const x = await sparkIn('spark4'); return x?.hottestC === 71.5 ? x : null; }, { timeout: 30000 * SLOW, what: 'the readings' });
    assert.equal(s.nvmeC, 48.9);
    assert.equal(typeof s.temperatureC, 'number', 'the GPU\'s own temperature is still there');
    // A sensor out of range (999 °C) is skipped, never passed on; the others still count.
    put('spark4', 'class/thermal/thermal_zone1/temp', '999000');
    await waitFor(async () => (await sparkIn('spark4'))?.hottestC === 64, { timeout: 30000 * SLOW, what: 'the out-of-range reading dropped' });
    put('spark4', 'class/thermal/thermal_zone1/temp', '71500');
  });

  test('a Spark with no sensor files is still watched: a crash there is still announced', { timeout: 60000 * SLOW }, async () => {
    assert.equal((await sparkIn('spark3'))?.hottestC ?? null, null, 'spark3 has no thermal files here');
    const f = join(home('spark3'), '.mock', 'containers'), since = new Date().toISOString();
    writeFileSync(f, readFileSync(f, 'utf8').replace(/^qwen-recipe-chisel\|running\|[^|]*\|/m, 'qwen-recipe-chisel|exited|Exited (1) 1 second ago|'));
    const ev = await waitFor(async () => (await eventsSince(since)).find(e => e.type === 'crashed' && e.container === 'qwen-recipe-chisel'), { timeout: 30000 * SLOW, what: 'the crash event' });
    assert.equal(ev.spark, 'spark3');
  });

  test('went dark under GPU load and restarted: the event keeps the last reading; the finding says "consistent with"', { timeout: 120000 * SLOW }, async t => {
    t.after(() => rmSync(join(home('spark4'), '.mock', 'status.json'), { force: true }));
    setStatus('spark4', { gpuUtilization: 92, gpuPowerWatts: 140 });
    await waitFor(async () => (await sparkIn('spark4'))?.gpuPowerWatts === 140, { timeout: 30000 * SLOW, what: 'the loaded reading' });
    const off = await offline('spark4');
    const saved = () => JSON.parse(readFileSync(join(T.fleet.stateDir, 'knowledge.json'), 'utf8')).sparks.spark4.online;
    assert.equal(saved(), false, 'written at once, so a console restart while dark doesn\'t say it went dark again');
    assert.equal(off.last.gpuBusyPercent, 92);
    assert.equal(off.last.gpuWatts, 140);
    assert.equal(off.last.hottestC, 71.5);
    assert.equal(off.last.nvmeC, 48.9);
    assert.equal(off.last.fanRpm, 2400);
    assert.ok(off.last.ageSeconds >= 0 && off.last.ageSeconds < 180, `age ${off.last.ageSeconds}`);
    // While it's dark, fleet_status gives the last reading, and the dark period is "still dark".
    const dark = await sparkIn('spark4');
    assert.equal(dark.state === 'online', false);
    assert.equal(dark.wentDarkAt, off.at);
    assert.equal(dark.lastReadingBeforeDark.gpuWatts, 140);
    assert.match(dark.lastReadingWords, /^\d+ s before it went dark: GPU 92% busy, 140 W, hottest sensor 71\.5 °C$/);
    assert.equal((await lastDark('spark4')).periods[0].finding, 'still dark');
    setStatus('spark4', { gpuUtilization: 3, gpuPowerWatts: 9, uptimeSeconds: 40 });
    const on = await online('spark4');
    assert.equal(saved(), true);
    assert.equal(on.upSeconds, 40);
    const d = await lastDark('spark4');
    assert.ok(d.since, 'the window is the events still kept');
    assert.ok(d.periods.length >= 1 && d.periods.length <= 5);
    const p = d.periods[0];
    assert.equal(p.wentDarkAt, off.at);
    assert.equal(p.cameBackAt, on.at);
    assert.equal(p.upSecondsWhenBack, 40);
    assert.equal(p.finding, 'restarted; it was under GPU load when it went dark (consistent with a power or heat cut-off under load)');
  });

  test('went dark idle and restarted; went dark without restarting: two different findings, neither a fault verdict', { timeout: 180000 * SLOW }, async t => {
    t.after(() => rmSync(join(home('spark4'), '.mock', 'status.json'), { force: true }));
    setStatus('spark4', { gpuUtilization: 2, gpuPowerWatts: 11 });
    await waitFor(async () => (await sparkIn('spark4'))?.gpuPowerWatts === 11, { timeout: 30000 * SLOW, what: 'the idle reading' });
    await offline('spark4');
    setStatus('spark4', { gpuUtilization: 2, gpuPowerWatts: 11, uptimeSeconds: 25 });
    await online('spark4');
    assert.equal((await lastDark('spark4')).periods[0].finding, 'restarted; it was idle when it went dark (consistent with being switched off by hand or a power cut, not counted as a fault)');
    setStatus('spark4', { gpuUtilization: 2, gpuPowerWatts: 11, uptimeSeconds: 900000 });
    await waitFor(async () => (await sparkIn('spark4'))?.uptimeHours > 200, { timeout: 30000 * SLOW, what: 'the long uptime' });
    await offline('spark4');
    await online('spark4');
    const d = await lastDark('spark4');
    assert.equal(d.periods[0].finding, 'stopped answering without restarting (consistent with the network, sleep, or being too busy to answer)');
    assert.ok(d.periods.length <= 5, 'at most five');
  });

  test('a reading with no GPU numbers is "can\'t tell", never "idle"', { timeout: 120000 * SLOW }, async t => {
    t.after(() => rmSync(join(home('spark4'), '.mock', 'status.json'), { force: true }));
    setStatus('spark4', { gpuUtilization: null, gpuPowerWatts: null });
    await waitFor(async () => { const x = await sparkIn('spark4'); return x && x.gpuPowerWatts === null && x.gpuUtilizationPercent === null; }, { timeout: 30000 * SLOW, what: 'no GPU numbers' });
    await offline('spark4');
    setStatus('spark4', { gpuUtilization: null, gpuPowerWatts: null, uptimeSeconds: 30 });
    await online('spark4');
    assert.equal((await lastDark('spark4')).periods[0].finding, 'restarted; the last reading had no GPU numbers, so Spark Console can’t tell whether it was under load');
  });

  test('a Spark never seen dark has no dark periods; every online Spark carries the board readings', { timeout: 30000 * SLOW }, async () => {
    assert.deepEqual((await lastDark('spark2')).periods, []);
    const s = await look('fleet_status', {});
    assert.ok(s.sparks.every(x => x.state !== 'online' || 'hottestC' in x));
  });

  // F16 (2026-11-12): a Spark that is off or not answering never has containers "running now". The stored rows stay as
  // they are (healing and the gates read them); only the workloads action and Sparkie's record show them as last seen.
  test('while a Spark is dark, its containers read as last seen, not running, in workloads and in Sparkie\'s record; they read as running again when it is back', { timeout: 150000 * SLOW }, async t => {
    t.after(() => writeFileSync(T.fleet.offlineFile, 'spark1\n'));
    // (its own key: the tests above use most of a key's 120 calls a minute)
    const token = (await createKey('dark-f16')).token;
    const look = async (name, args) => { const r = await call(token, name, args); assert.equal(r.isError, false, `${name}: ${r.text}`); return r.value; };
    const offline = async id => { const since = new Date().toISOString(); writeFileSync(T.fleet.offlineFile, `spark1\n${id}\n`);
      return waitFor(async () => (await look('fleet_events', { since, limit: 200 })).events.find(e => e.type === 'spark-offline' && e.spark === id), { timeout: 40000 * SLOW, what: `${id} going offline` }); };
    const online = async id => { const since = new Date().toISOString(); await sleep(1500); writeFileSync(T.fleet.offlineFile, 'spark1\n');
      return waitFor(async () => (await look('fleet_events', { since, limit: 200 })).events.find(e => e.type === 'spark-online' && e.spark === id), { timeout: 40000 * SLOW, what: `${id} coming back` }); };
    const names = r => r.workloads.map(w => w.name).sort();
    const before = names(await waitFor(async () => { const r = await look('workloads', { spark: 'spark4', running: true }); return r.count > 0 ? r : null; }, { timeout: 30000 * SLOW, what: 'spark4\'s containers' }));
    await offline('spark4');
    assert.equal((await look('workloads', { spark: 'spark4', running: true })).count, 0, 'nothing on a dark Spark is running now');
    const dark = await look('workloads', { spark: 'spark4' });
    for (const n of before) {
      const w = dark.workloads.find(x => x.name === n);
      assert.deepEqual([w?.running, w?.state, w?.lastSeenRunning], [false, 'unknown (Spark off or not answering)', true], n);
    }
    // Its own last look, which stops moving while it is dark; the other Sparks are still watched. (Wait for the
    // fleet's next look instead of a fixed 5 s: on a loaded machine one look can take longer. Every 2 s, as the key has
    // 120 calls a minute.)
    await sleep(5000);
    const all = await waitFor(async () => { const a = await look('workloads', {}); return a.observedAt > dark.observedAt ? a : null; }, { timeout: 30000 * SLOW, every: 2000, what: 'the other Sparks looked at again' });
    const later = await look('workloads', { spark: 'spark4' });
    assert.equal(later.observedAt, dark.observedAt, 'spark4’s rows carry spark4’s own time');
    assert.ok(all.observedAt > later.observedAt, `${all.observedAt} > ${later.observedAt}`);
    // An online Spark is unchanged.
    const three = await look('workloads', { spark: 'spark3', running: true });
    assert.ok(three.count > 0 && three.workloads.every(w => w.running === true && !('lastSeenRunning' in w)));
    // Sparkie's record says so in one line.
    const chat = await newChat(), from = requests().length;
    await say(chat, 'good morning');
    const record = requests().slice(from).find(x => x.words === 'good morning')?.lastUser || '';
    const four = record.split('\n').filter(l => l.startsWith('Spark 4: '));
    assert.equal(four.length, 1, record.slice(0, 2000));
    assert.match(four[0], /^Spark 4: off or not answering since \d{4}-\d\d-\d\d \d\d:\d\d UTC, so nothing there is known to be running\. Last seen running: /);
    for (const n of before) assert.ok(four[0].includes(n), n);
    // Back on: the same rows read as running again (they were never changed).
    await online('spark4');
    assert.deepEqual(names(await look('workloads', { spark: 'spark4', running: true })), before);
  });
});

// A second fleet, started as if Spark Console restarted while Spark 4 was dark: its going dark 10 minutes ago is in the
// kept events, and the old record still says it was online with a 10-minute-old reading (as before the knowledge was
// written at once). Short dark periods count only from 20 s here.
describe('after a console restart while a Spark is dark', { concurrency: 1 }, () => {
  let F;
  const WENT = new Date(Date.now() - 10 * 60000).toISOString(), OLD = new Date(Date.now() - 3 * 86400000).toISOString();
  const LAST = { ageSeconds: 20, gpuBusyPercent: 92, gpuWatts: 140, gpuC: 60, hottestC: 71.5, nvmeC: 48.9, fanRpm: 2400 };
  before(async () => {
    F = await startMock({ watchMs: 2000, statusMs: 3000, env: { SPARK_CONSOLE_HEAL_OFFLINE_MS: '20000' }, prepare: ({ dir, stateDir }) => {
      writeFileSync(join(dir, 'offline'), 'spark1\nspark4\n');
      // (and an old dark spell on Spark 3 never matched by a came-back, three days ago)
      writeFileSync(join(stateDir, 'events.jsonl'), `${JSON.stringify({ at: OLD, type: 'spark-offline', spark: 'spark3', last: LAST })}\n${JSON.stringify({ at: WENT, type: 'spark-offline', spark: 'spark4', last: LAST })}\n`, { mode: 0o600 });
      writeFileSync(join(stateDir, 'knowledge.json'), JSON.stringify({ workloads: {}, sparks: { spark4: { online: true, gpu: { at: WENT, busy: 92, watts: 140 } } } }), { mode: 0o600 });
    } });
  }, { timeout: 180000 });
  after(() => F?.stop(), { timeout: 30000 });
  const act = async (name, args = {}) => {
    const r = await request(`${F.base}/actions/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-spark-console': '1', origin: F.origin }, body: JSON.stringify(args) });
    assert.equal(r.status, 200, r.text);
    return JSON.parse(r.text);
  };

  test('the real dark time and its reading stay; a reading over 3 minutes old is never passed on', { timeout: 90000 * SLOW }, async () => {
    const again = await waitFor(async () => (await act('fleet_events', { limit: 50 })).events.find(e => e.type === 'spark-offline' && e.spark === 'spark4' && e.at !== WENT), { timeout: 40000 * SLOW, what: 'spark4 noted dark again' });
    assert.equal(again.last, null, 'the 10-minute-old reading isn\'t passed on');
    const p = (await act('spark_diagnostics', { spark: 'spark4' })).darkPeriods.periods[0];
    assert.equal(p.wentDarkAt, WENT, 'the first time it went dark counts');
    assert.deepEqual(p.lastReading, LAST);
    assert.equal(p.finding, 'still dark');
    const s = (await act('fleet_status')).sparks.find(x => x.id === 'spark4');
    assert.equal(s.wentDarkAt, WENT);
    assert.equal(s.lastReadingBeforeDark.gpuWatts, 140);
  });

  test('dark for less than the floor (20 s here) isn\'t a dark period', { timeout: 120000 * SLOW }, async () => {
    const since = new Date().toISOString();
    writeFileSync(F.offlineFile, 'spark1\n');
    await waitFor(async () => (await act('fleet_events', { since, limit: 50 })).events.find(e => e.type === 'spark-online' && e.spark === 'spark4'), { timeout: 40000 * SLOW, what: 'spark4 back' });
    const before = (await act('spark_diagnostics', { spark: 'spark4' })).darkPeriods.periods.length;
    const s2 = new Date().toISOString();
    writeFileSync(F.offlineFile, 'spark1\nspark4\n');
    await waitFor(async () => (await act('fleet_events', { since: s2, limit: 50 })).events.find(e => e.type === 'spark-offline' && e.spark === 'spark4'), { timeout: 40000 * SLOW, what: 'spark4 dark again' });
    const s3 = new Date().toISOString();
    writeFileSync(F.offlineFile, 'spark1\n');
    await waitFor(async () => (await act('fleet_events', { since: s3, limit: 50 })).events.find(e => e.type === 'spark-online' && e.spark === 'spark4'), { timeout: 40000 * SLOW, what: 'spark4 back again' });
    assert.equal((await act('spark_diagnostics', { spark: 'spark4' })).darkPeriods.periods.length, before, 'the short one isn\'t listed');
  });

  test('an old dark spell never matched by a came-back gives way to a real one with a reading', { timeout: 120000 * SLOW }, async () => {
    const s1 = new Date().toISOString();
    writeFileSync(F.offlineFile, 'spark1\nspark3\n');
    const off = await waitFor(async () => (await act('fleet_events', { since: s1, limit: 50 })).events.find(e => e.type === 'spark-offline' && e.spark === 'spark3'), { timeout: 40000 * SLOW, what: 'spark3 dark' });
    assert.ok(off.last, 'a live one has a reading');
    await sleep(21000); // longer than the floor here
    const s2 = new Date().toISOString();
    writeFileSync(F.offlineFile, 'spark1\n');
    await waitFor(async () => (await act('fleet_events', { since: s2, limit: 50 })).events.find(e => e.type === 'spark-online' && e.spark === 'spark3'), { timeout: 40000 * SLOW, what: 'spark3 back' });
    const p = (await act('spark_diagnostics', { spark: 'spark3' })).darkPeriods.periods[0];
    assert.equal(p.wentDarkAt, off.at, 'the real one, not the three-day-old one');
  });
});
