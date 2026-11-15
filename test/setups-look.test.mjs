// Nothing looks for setups by the clock (design C step 7, as cut on 2026-11-14; owner decision 5; contract 7.11 and
// 8.0; R27). The service runs on mock/clock.mjs with MOCK_CLOCK_DATES=1, so moving its clock days ahead moves Date.now()
// and a look's date (new Date()) together. The stand-in for the setups' sources is a copy of mock/dig-fixture.json
// (SPARK_CONSOLE_DIG_FIXTURE): each look reads it once, as one `dig` operation. Left alone with its clock a day and two
// days on, the console looks for nothing and opens no connection outside the stand-in fleet (no heartbeat address is
// saved, so the heartbeat sends nothing either). Asked (find_setups), it looks at once. recipe_detail on setups over a
// week old looks once, then answers from the fresh list. A look that can't read its source keeps the old list in use,
// and recipe_detail says how old that is. SPARK_CONSOLE_DIG_EVERY_MS was the stand-in's day for the daily look, which is
// gone: it is set here so that a build that still has that timer shows it.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { T, REPO, useFleet, api, newChat, say, sleep, waitFor, SLOW } from './lib.mjs';

const DAY = 86400000, MODEL = 'glm-5.3-flash';
const HERE = mkdtempSync(join(tmpdir(), 'setups-look-'));
after(() => rmSync(HERE, { recursive: true, force: true }));
const FIXTURE = join(HERE, 'dig-fixture.json');
copyFileSync(join(REPO, 'test', 'mock', 'dig-fixture.json'), FIXTURE);
// Every connection the service opens, written to $MOCK_DIR/connections.jsonl: loaded into the service only, beside the
// clock. A connection to the web goes through net.Socket's connect, whether it is fetch, http, https or tls.
function recorder() {
  if (!/\/service\/server\.mjs$/.test(process.argv[1] || '') || process.execArgv.includes('-e') || !process.env.MOCK_DIR) return;
  const file = `${process.env.MOCK_DIR}/connections.jsonl`, connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...a) {
    const o = Array.isArray(a[0]) ? a[0][0] : a[0];
    const to = o && typeof o === 'object' ? { host: o.host ?? null, port: o.port ?? null, path: o.path ?? null }
      : typeof o === 'string' && !/^\d+$/.test(o) ? { host: null, port: null, path: o } : { host: typeof a[1] === 'string' ? a[1] : null, port: o ?? null, path: null };
    try { appendFileSync(file, `${JSON.stringify(to)}\n`); } catch {}
    return connect.apply(this, a);
  };
}
const RECORDER = join(HERE, 'connections.mjs');
writeFileSync(RECORDER, `import net from 'node:net';\nimport { appendFileSync } from 'node:fs';\n(${recorder})();\n`);

useFleet({ watchMs: 60000, statusMs: 20000, env: {
  NODE_OPTIONS: `--import=${join(REPO, 'test', 'mock', 'clock.mjs')} --import=${RECORDER}`, MOCK_CLOCK_DATES: '1',
  SPARK_CONSOLE_DIG_FIXTURE: FIXTURE, SPARK_CONSOLE_DIG_EVERY_MS: '3000' } });

const setClock = async days => { writeFileSync(join(T.fleet.dir, 'clock-offset'), String(days * DAY)); await sleep(400); };
// The looks, newest first (each one is one call to the setups' sources).
const looks = async () => (await api('/jobs')).json.jobs.filter(j => j.type === 'dig');
const found = () => { const f = join(T.fleet.stateDir, 'found-setups.json'); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).models || {} : {}; };
const ended = id => waitFor(async () => { const j = (await api(`/jobs/${id}`)).json; return j.status !== 'running' && j; }, { timeout: 60000, what: `operation ${id}` });
async function detail(id) {
  const r = await api('/actions/recipe_detail', { method: 'POST', body: { id, all: true } });
  assert.equal(r.status, 200, r.text);
  return r.json;
}
async function ask(model) {
  const r = await api('/actions/find_setups', { method: 'POST', body: { model } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.outcome, 'started', r.text);
  assert.equal((await ended(r.json.operation)).status, 'completed');
  return r.json.operation;
}
const LOCAL = new Set(['127.0.0.1', 'localhost', '::1', '::ffff:127.0.0.1', null]);
const connections = () => { const f = join(T.fleet.dir, 'connections.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []; };

describe('setups are looked up when something needs them, never by the clock', () => {
  test('left alone a day and two days, it looks for nothing and reaches nothing outside the fleet', { timeout: 60000 * SLOW }, async () => {
    for (const day of [1, 2]) { await setClock(day); await sleep(4000 * SLOW); }
    assert.deepEqual((await looks()).map(j => j.modelId), [], 'no look started by itself');
    assert.deepEqual(found(), {}, 'no look was saved');
    assert.deepEqual(connections().filter(c => !c.path && !LOCAL.has(c.host)), [], 'a connection outside the stand-in fleet');
    // The recorder sees what the service opens: a chat turn's call to the stand-in brain (inside the fleet).
    await say(await newChat(), 'hello');
    assert.ok(connections().some(c => Number(c.port) === T.fleet.modelPort && LOCAL.has(c.host)), JSON.stringify(connections()));
  });
  test('asked, it looks at once, even when the setups are fresh; a lookup of fresh setups doesn’t look', { timeout: 120000 * SLOW }, async () => {
    const n = (await looks()).length;
    await ask(MODEL);
    const first = found()[MODEL]?.at;
    assert.ok(first, JSON.stringify(found()));
    await ask(MODEL);
    assert.equal((await looks()).length, n + 2);
    const d = await detail(MODEL);
    assert.equal((await looks()).length, n + 2, 'recipe_detail looked again at fresh setups');
    assert.equal(d.setupsLookedUp?.at, found()[MODEL].at, JSON.stringify(d.setupsLookedUp));
    assert.equal(d.setupsLookedUp.when, 'today');
    assert.ok(!('note' in d.setupsLookedUp), JSON.stringify(d.setupsLookedUp));
  });
  test('a lookup of setups over a week old looks once, then answers from the fresh list', { timeout: 120000 * SLOW }, async () => {
    const was = found()[MODEL].at, n = (await looks()).length;
    await setClock(10);
    await sleep(4000 * SLOW);
    assert.equal((await looks()).length, n, 'nothing looked by itself once the setups were over a week old');
    const d = await detail(MODEL), now = await looks();
    assert.equal(now.length, n + 1, 'one look');
    assert.deepEqual({ model: now[0].modelId, status: now[0].status }, { model: MODEL, status: 'completed' });
    const fresh = found()[MODEL];
    assert.ok(Date.parse(fresh.at) - Date.parse(was) > 7 * DAY, `${was} → ${fresh.at}`);
    assert.deepEqual({ at: d.setupsLookedUp?.at, when: d.setupsLookedUp?.when }, { at: fresh.at, when: 'today' }, 'answered from the fresh list');
    assert.ok(d.setups.some(s => fresh.setups.some(x => x.id === s.id) && /NVIDIA\/local-ai-inference-recipes/.test(s.sourceUrl)), JSON.stringify(d.setups.map(s => s.id)));
    await detail(MODEL);
    assert.equal((await looks()).length, n + 1, 'fresh now: no second look');
  });
  test('a look that can’t read its source keeps the old list in use, and recipe_detail says how old it is', { timeout: 120000 * SLOW }, async () => {
    const was = found()[MODEL], n = (await looks()).length;
    writeFileSync(FIXTURE, '{ not json');
    await setClock(18);
    const d = await detail(MODEL), now = await looks();
    assert.equal(now.length, n + 1, 'one look');
    assert.ok(now[0].log.some(l => /NVIDIA’s DGX Spark recipes: couldn’t read it/.test(l)), now[0].log.join('\n'));
    assert.equal(found()[MODEL].at, was.at, 'the old list keeps its date');
    assert.deepEqual(d.setupsLookedUp, { at: was.at, when: '8 days ago', couldntRead: ['NVIDIA’s DGX Spark recipes'],
      note: 'Looking again just now couldn’t read NVIDIA’s DGX Spark recipes, so these setups are from 8 days ago.' });
    const old = was.setups.map(s => s.id);
    assert.ok(d.setups.some(s => old.includes(s.id)), `the old list is still in use: ${JSON.stringify(d.setups.map(s => s.id))}`);
  });
});
