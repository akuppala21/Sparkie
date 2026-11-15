// Covers: Spark Console's own errors on the record (H3), caused inside the service by `mock/fault.mjs`: a route that
// throws answers 500 and is counted in `sparkie_setup`'s `console.faults` (the route without ids, how often, the top
// frame, secrets hidden); a refusal isn't; an agent's tool and `ask_sparkie` that fail unexpectedly are; a promise
// nobody caught is; an uncaught error writes `last-crash.json` (0600, masked) before the service exits 1, and the next
// start shows it as `lastCrash` with the watchdog's last five restarts.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, call, createKey, newChat, waitFor, SERVICE_FILE, REPO, SLOW } from './lib.mjs';
import { TEST_DIR } from './start-mock.mjs';

const RESTARTS = [1762900000, 1762900060, 1762900120, 1762903600, 1762907200, 1762910800];
const TOKEN = 'hf_abcdefghijklmnopqrstuvwxyz0123';
useFleet({ watchMs: 60000, env: { NODE_OPTIONS: `--import=${join(TEST_DIR, 'mock', 'fault.mjs')}` },
  prepare: ({ stateDir }) => writeFileSync(join(stateDir, 'watchdog-restarts'), RESTARTS.map(n => `${n}\n`).join(''), { mode: 0o600 }) });

const FAULT = { 'x-mock-fault': '1' };
const record = async () => { const r = await api('/actions/sparkie_setup', { method: 'POST', body: {} }); assert.equal(r.status, 200, r.text); return r.json.console; };
const mock = c => c.faults.filter(f => /^mock /.test(f.error));
let second = null;
after(() => second?.kill('SIGKILL'));

test('before anything goes wrong: no faults, no crash, the watchdog\'s last five restarts', async () => {
  const c = await record();
  assert.deepEqual(mock(c), []);
  assert.equal(c.lastCrash, null);
  assert.deepEqual(c.watchdogRestarts, RESTARTS.slice(-5).map(n => new Date(n * 1000).toISOString()));
  assert.match(c.faultsNote, /not instructions/);
});

test('a route that throws answers 500 and is counted; a refusal is not', async () => {
  for (let i = 0; i < 2; i++) {
    const r = await api('/agents', { headers: FAULT });
    assert.equal(r.status, 500, r.text);
    assert.match(r.json.error, /^mock fault in a route/);
  }
  const chat = await newChat();
  assert.equal((await api(`/chats/${chat}`, { headers: FAULT })).status, 500);
  assert.equal((await api('/actions/format_disk', { method: 'POST', body: {} })).status, 404);
  const faults = mock(await record());
  assert.deepEqual(faults.map(f => [f.where, f.count]).sort(), [['GET /agents', 2], ['GET /chats/…', 1]]);
  for (const f of faults) {
    assert.equal(f.error, 'mock fault in a route [hidden]');
    assert.match(f.frame, /^at /);
    assert.ok(f.firstAt <= f.lastAt);
    assert.ok(!JSON.stringify(f).includes(TOKEN));
  }
  assert.match(T.fleet.logText(), /Fault in GET \/agents: TypeError: mock fault in a route/);
});

test('an agent\'s tool and ask_sparkie that fail unexpectedly are counted', async () => {
  const { token } = await createKey('faults');
  const tool = await call(token, 'sparkie_setup', {}, { headers: FAULT });
  assert.equal(tool.isError, true, tool.raw);
  assert.match(tool.text, /^\[failed\] mock fault in a route \[hidden\]/);
  const ask = await call(token, 'ask_sparkie', { message: 'hello' }, { headers: FAULT });
  assert.equal(ask.isError, true, ask.raw);
  const where = mock(await record()).map(f => f.where);
  assert.ok(where.includes('agent tool sparkie_setup') && where.includes('ask_sparkie'), JSON.stringify(where));
});

test('a promise nobody caught is counted, and the service stays up', async () => {
  writeFileSync(join(T.fleet.dir, 'fault-reject'), '');
  await waitFor(async () => mock(await record()).some(f => f.where === 'background work' && f.error === 'mock rejection [hidden]'), { timeout: 10000, what: 'the rejection on the record' });
  assert.equal(T.fleet.serviceExit(), null);
});

test('an uncaught error writes last-crash.json before the service ends; the next start shows it', { timeout: 90000 * SLOW }, async () => {
  const { build } = (await api('/health')).json;
  writeFileSync(join(T.fleet.dir, 'fault-throw'), '');
  assert.equal(await waitFor(() => T.fleet.serviceExit(), { timeout: 10000, what: 'the service to exit' }), '1');
  const file = join(T.fleet.stateDir, 'last-crash.json'), text = readFileSync(file, 'utf8'), crash = JSON.parse(text);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(crash.build, build);
  assert.equal(crash.error, 'mock crash [hidden]');
  assert.ok(crash.stack.length >= 1 && crash.stack.length <= 5 && crash.stack.every(l => /^at /.test(l)), JSON.stringify(crash.stack));
  assert.ok(!text.includes(TOKEN));
  assert.ok(Date.now() - Date.parse(crash.at) < 60000);
  // Started again on the same state, as systemd would.
  second = spawn(process.execPath, [SERVICE_FILE], { cwd: REPO, env: T.fleet.env, stdio: 'ignore' });
  await waitFor(async () => (await api('/health').catch(() => null))?.status === 200, { timeout: 30000, what: 'the service back' });
  const c = await record();
  assert.deepEqual(c.lastCrash, { at: crash.at, build: crash.build, error: crash.error, stack: crash.stack });
  assert.deepEqual(mock(c), []);
});
