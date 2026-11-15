// Covers: Operations on the record (`events.jsonl`) when they start and end, under one id; one cut off by a restart
// reported as `interrupted` with a notice (a bad line skipped); SIGTERM: new operations get 503, a running one
// finishes, then the service exits 0; a second copy on a used port exits 1 and the first keeps its socket; the daily
// copy of the state (`state-YYYY-MM-DD.tgz` on Spark 3, no sockets; `/health` `lastBackup`); `/health` `agentsPaused`,
// `sparksOnline`; unreadable `verified.json`, `added-models.json`, `main.json` set aside as `<file>.unreadable-<time>`
// with a notice, one that can't be read at all → 503 and left alone; a Spark that freezes (`.mock/stall`): two
// timed-out commands mark it offline for a minute, a slow read → `[still_running]`. The chat keeps answering when
// `memory.json` can't be read (five turns, none 409 or 429, the prompt says memory is missing) and when the state
// folder can't be written (a new chat and a turn answer, the next good save keeps them; skipped as root); a turn that
// throws while it is set up (events with no time, a fleet of its own) frees its chat and its slot. The fleet group,
// each on a fleet of its own: a `readKept` file that isn't JSON falls back to `<file>.prev` (the copy from before its
// last save) with a notice that the last change may be missing, or starts empty and says so; a missing file never falls
// back; sign-in files get no `.prev`; `writePrivate` syncs before the rename (S1). `access.json` cut short at start:
// the last good copy (`access.json.good`) answers with one notice and the file is left alone, and once mended the copy
// still matches it (S2). `desired.json` and `validations.json` that can't be read as a stop
// finishes (a link to a folder in their place) are not saved over, Forget answers 503, and both entries of each are
// there once they read again (F12). The daily copy's record survives a restart (`/health` `lastBackup.good`); with
// every other Spark off nothing is tried and nothing is said on day 3, and past day 7 with changes there is one notice
// and one line in `needsOwner`, once, even after an older build's daily notice; a copy cut short (`.mock/gzip-bad`)
// never replaces the file there; with Spark 3 off it lands on Spark 4, is recorded, and no second copy is made that day
// (F17).
//
// What Spark Console keeps, and how it stops and starts: every operation on the fleet's record (events.jsonl) when it
// starts and when it ends, under one id; one cut off by a restart reported as interrupted when the service is back; on
// SIGTERM no new operations while running ones finish; a second copy on a port in use leaves the first alone; a daily
// copy of the state on another Spark; unreadable state files set aside, never overwritten; and two timed-out commands
// in a row counting a Spark as offline (the stand-in Spark freezes with ~/.mock/stall). Sparkie's chat keeps answering
// when memory.json can't be read, when the state folder can't be written (a full disk), and when a turn throws while it
// is set up. The fleet group (2026-11-12): a file that isn't JSON falls back to the copy from before its last save (S1);
// access.json that can't be read answers from its last good copy (S2); a list or record that can't be read as an
// operation finishes is never saved over (F12); the daily copy's record survives a restart, nothing is tried while
// every other Spark is off, a copy is checked, and a week without one is said once (F17).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync, rmSync, chmodSync, renameSync, symlinkSync, lstatSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import http from 'node:http';
import { T, useFleet, api, call, request, createActKey, createKey, eventLines, waitFor, sleep, bug, newChat, say, SERVICE_FILE, SLOW } from './lib.mjs';
import { startMock, REPO } from './start-mock.mjs';

// An operation from before a restart that never ended, and one that did (only the first is reported).
const CUT_OFF = { at: '2026-11-04T10:00:00.000Z', type: 'operation', id: 'abcdefabcdef', operation: 'deploy', status: 'started', model: 'gpt-oss-20b', spark: 'spark3', stops: ['spark3/sc-old-model'] };
const ENDED = [{ at: '2026-11-04T10:00:00.000Z', type: 'operation', id: '0123456789ab', operation: 'stop', status: 'started', spark: 'spark4' },
  { at: '2026-11-04T10:00:05.000Z', type: 'operation', id: '0123456789ab', operation: 'stop', status: 'completed', spark: 'spark4' }];
// The day the daily copies are named for, held for this file's run (2026-11-14: a run that crossed midnight UTC made one
// copy named for the 14th and a later one for the 15th). Each service here that makes copies runs on mock/clock.mjs, its
// whole clock: the real time, except that one started after 23:00 UTC that day (or past midnight) is set back to 23:00,
// so for an hour it doesn't see the date change.
const DAY = new Date().toISOString().slice(0, 10);
const HOLD_DAY = { NODE_OPTIONS: `--import=${join(REPO, 'test', 'mock', 'clock.mjs')}`, MOCK_CLOCK_DATES: '1' };
const holdDay = dir => writeFileSync(join(dir, 'clock-offset'), String(Math.min(0, Date.parse(`${DAY}T23:00:00.000Z`) - Date.now())));
const keys = {};
useFleet({
  watchMs: 60000,
  // A first copy of the state 3 s after starting, then every minute.
  env: { SPARK_CONSOLE_BACKUP_FIRST_MS: '3000', SPARK_CONSOLE_BACKUP_MS: '60000', ...HOLD_DAY },
  prepare: ({ dir, stateDir }) => {
    holdDay(dir);
    // (a line that isn't JSON among them: only that line is dropped)
    writeFileSync(join(stateDir, 'events.jsonl'), [JSON.stringify(CUT_OFF), '{"type": "operation", broken', ...ENDED.map(e => JSON.stringify(e))].map(l => `${l}\n`).join(''), { mode: 0o600 });
    writeFileSync(join(stateDir, 'stray.sock'), 'not a real socket', { mode: 0o600 });
    // A leftover of the retired web copy, holding its push token: it never goes into a copy.
    writeFileSync(join(stateDir, 'cloud.json'), JSON.stringify({ url: 'https://example.test', token: 'not-for-backups' }), { mode: 0o600 });
  },
}, async () => { keys.act = await createActKey('state-act'); keys.look = await createKey('state-look'); });

const health = async (base = T.base) => (await fetch(`${base}/health`)).json();
async function ok(name, args, token = keys.act.token) {
  const r = await call(token, name, args);
  assert.equal(r.isError, false, `${name} ${JSON.stringify(args)}: ${r.text}`);
  return r.value;
}
async function finished(id) {
  for (;;) {
    const w = await ok('wait_operation', { id, seconds: 20 }, keys.look.token);
    if (w.status !== 'running') return w;
  }
}
const operationEvents = id => eventLines().filter(e => e.type === 'operation' && e.id === id);
const RADIX = 'sc-RadixArk--Qwen3.8-27B-NVFP4';

// Services side by side: this file's own (its tests one after the other, SIGTERM last), one with unreadable state files,
// one each for the fleet group's state cases, and one whose Sparks freeze.
describe('state', { concurrency: true }, () => {
describe('the main service', { concurrency: 1 }, () => {
  describe('the fleet\'s record of operations', () => {
    test('one cut off by a restart is reported once the service is back: interrupted, with a notice; one that ended isn\'t (a bad line in between is skipped)', async () => {
      const ev = await waitFor(() => operationEvents(CUT_OFF.id).find(e => e.status === 'interrupted'), { timeout: 10000, what: 'the interrupted report' });
      assert.deepEqual([ev.operation, ev.model, ev.spark], ['deploy', 'gpt-oss-20b', 'spark3']);
      const notice = eventLines().find(e => e.type === 'notice' && /cut off deploy gpt-oss-20b on spark3/.test(e.text));
      assert.ok(notice, JSON.stringify(eventLines().filter(e => e.type === 'notice')));
      assert.match(notice.text, /it was to stop spark3\/sc-old-model/);
      assert.equal(operationEvents(ENDED[0].id).length, 2, 'nothing more about the one that ended');
      // Agents see it too.
      const seen = await ok('fleet_events', { type: 'operation', since: '2026-11-04T00:00:00Z' }, keys.look.token);
      assert.ok(seen.events.some(e => e.status === 'interrupted'), JSON.stringify(seen.events));
    });

    test('every operation goes on the record when it starts and when it ends, under one id', { timeout: 60000 * SLOW }, async () => {
      const x = await ok('stop_model', { spark: 'spark4', container: RADIX });
      const started = operationEvents(x.operation);
      assert.equal(started.length, 1);
      assert.deepEqual([started[0].status, started[0].operation, started[0].spark, started[0].actor], ['started', 'stop', 'spark4', keys.act.name]);
      assert.equal((await finished(x.operation)).status, 'completed');
      const both = await waitFor(() => operationEvents(x.operation).length === 2 && operationEvents(x.operation), { timeout: 5000, what: 'the end' });
      assert.deepEqual(both.map(e => e.status), ['started', 'completed']);
      assert.equal(both[1].by, 'owner');
      const y = await ok('restart_model', { spark: 'spark4', container: RADIX });
      assert.equal((await finished(y.operation)).status, 'completed');
      assert.deepEqual(operationEvents(y.operation).map(e => e.status), ['started', 'completed']);
    });
  });

  describe('the daily copy of the state', () => {
    test('lands on Spark 3 as state-YYYY-MM-DD.tgz, without sockets or cloud.json, and /health says so', { timeout: 30000 * SLOW }, async () => {
      const h = await waitFor(async () => { const x = await health(); return x.lastBackup && x; }, { timeout: 20000, what: 'the first copy' });
      assert.equal(h.lastBackup.ok, true, JSON.stringify(h.lastBackup));
      assert.equal(h.lastBackup.to, 'spark3');
      const name = `state-${DAY}.tgz`;
      assert.equal(h.lastBackup.file, name);
      const dir = join(T.fleet.root, 'spark3', '.local', 'share', 'spark-console', 'backups');
      assert.deepEqual(readdirSync(dir), [name], 'no .part left behind');
      const listed = execFileSync('tar', ['-tzf', join(dir, name)], { encoding: 'utf8' }).split('\n').filter(Boolean);
      assert.ok(listed.some(f => /(^|\/)access\.json$/.test(f)), listed.join(' '));
      assert.ok(listed.some(f => /(^|\/)events\.jsonl$/.test(f)));
      assert.ok(!listed.some(f => /\.sock$/.test(f)), `sockets: ${listed.filter(f => /\.sock$/.test(f))}`);
      assert.ok(!listed.some(f => /(^|\/)cloud\.json$/.test(f)), 'not cloud.json');
    });
    // The first command is the ssh command itself, so the far user's login shell reads it. Under zsh a file pattern that
    // matches nothing is an error, and no copy would ever land (the review of A-9). The stand-in gzip keeps the command
    // it was run from; here that text runs under zsh in an empty home (a space in its name), then with a stale .part.
    const ZSH = (() => { try { execFileSync('zsh', ['-fc', 'true'], { stdio: 'ignore' }); return true; } catch { return false; } })();
    test('its first command on the far Spark ends well under zsh too, with no .part there and with a stale one', { timeout: 30000 * SLOW, skip: ZSH ? false : 'no zsh here' }, async () => {
      const name = `state-${DAY}.tgz`, from = join(T.fleet.root, 'spark3', '.mock', 'gzip-from');
      const copy = join(T.fleet.root, 'spark3', '.local', 'share', 'spark-console', 'backups', name);
      await waitFor(() => existsSync(copy) && existsSync(from), { timeout: 20000, what: 'the first copy' });
      const sent = readFileSync(from, 'utf8').trim();
      assert.match(sent, /^umask 077 && mkdir -p "\$HOME\/\.local\/share\/spark-console\/backups" && /);
      const home = join(T.fleet.dir, 'a home for zsh'), there = join(home, '.local', 'share', 'spark-console', 'backups');
      mkdirSync(home);
      const zsh = () => spawnSync('zsh', ['-c', sent], { cwd: home, env: { ...process.env, HOME: home }, input: readFileSync(copy) });
      let r = zsh();
      assert.equal(r.status, 0, String(r.stderr));
      assert.deepEqual(readdirSync(there), [`${name}.part`]);
      writeFileSync(join(there, 'state-2026-01-01.tgz.part'), 'left by an earlier try');
      r = zsh();
      assert.equal(r.status, 0, String(r.stderr));
      assert.deepEqual(readdirSync(there), [`${name}.part`], 'the stale .part is gone');
    });
  });

  describe('/health', () => {
    test('says whether agents are paused, the last copy of the state, and how many Sparks are online', async () => {
      const h = await health();
      assert.equal(h.agentsPaused, false);
      // (spark1 counts as offline once two looks at it have failed)
      await waitFor(async () => (await health()).sparksOnline === 3, { timeout: 20000, what: 'sparksOnline 3 (spark1 is offline)' });
      assert.ok('lastBackup' in h);
      assert.equal((await api('/agents/settings', { method: 'PUT', body: { halted: true } })).status, 200);
      try { assert.equal((await health()).agentsPaused, true); } finally { await api('/agents/settings', { method: 'PUT', body: { halted: false } }); }
    });
  });

  describe('a second copy', () => {
    test('started on a port that\'s in use, it exits 1 and leaves the first one\'s API socket working', { timeout: 30000 * SLOW }, async () => {
      const second = spawn(process.execPath, [SERVICE_FILE], { cwd: REPO, env: T.fleet.env, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      second.stdout.on('data', d => { out += d; });
      second.stderr.on('data', d => { out += d; });
      const code = await new Promise(r => second.on('exit', c => r(c)));
      assert.equal(code, 1, out);
      assert.match(out, /already running/);
      const viaSocket = await new Promise((resolve, reject) => {
        http.get({ socketPath: T.fleet.socket, path: '/console/api/health' }, res => {
          let d = '';
          res.on('data', c => { d += c; });
          res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(d) }));
        }).on('error', reject);
      });
      assert.equal(viaSocket.status, 200);
      assert.equal(viaSocket.json.startedAt, (await health()).startedAt, 'still the first one');
      assert.ok(existsSync(T.fleet.socket));
    });
  });

  // F2 (review, 2026-11-11): a chat is never left "still answering", and a read or write problem never ends a turn.
  describe('the chat keeps answering', () => {
    const modelLog = () => (existsSync(join(T.fleet.dir, 'model-requests.jsonl')) ? readFileSync(join(T.fleet.dir, 'model-requests.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []);
    test('memory.json can\'t be read: five turns answer without memory, none refused as busy, the file is left alone', { timeout: 120000 * SLOW }, async () => {
      const file = join(T.fleet.stateDir, 'memory.json'), words = 'hello, no memory this time';
      assert.equal(existsSync(file), false);
      // (a folder where the file goes: every read fails, as wrong permissions or too many open files would)
      mkdirSync(file);
      try {
        const a = await newChat(), b = await newChat(), c = await newChat(), d = await newChat();
        for (const chat of [a, a, b, c, d]) assert.ok((await say(chat, words)).text, chat);
        const asked = modelLog().filter(x => x.words === words);
        assert.equal(asked.length, 5);
        for (const x of asked) assert.match(x.system, /Your memory .* couldn’t be read for this message/);
        assert.equal((await health()).replying, 0);
        assert.ok(statSync(file).isDirectory(), 'left as it was');
      } finally { rmSync(file, { recursive: true, force: true }); }
      await say(await newChat(), 'hello, memory again');
      assert.doesNotMatch(modelLog().findLast(x => x.words === 'hello, memory again').system, /couldn’t be read/);
    });

    test('the state folder can\'t be written, as on a full disk: a new chat and a turn answer; the next good save keeps them', { timeout: 90000 * SLOW, skip: process.getuid?.() === 0 ? 'root can write to a read-only folder' : false }, async () => {
      const file = join(T.fleet.stateDir, 'chats.json');
      let chat;
      chmodSync(T.fleet.stateDir, 0o500);
      try {
        chat = await newChat();
        assert.ok((await say(chat, 'hello there')).text);
        assert.ok(!readFileSync(file, 'utf8').includes(chat), 'not saved while the folder can\'t be written');
      } finally { chmodSync(T.fleet.stateDir, 0o700); }
      // (on Spark Console's record, so Sparkie can say chats said meanwhile would be lost at a restart)
      const faults = (await api('/actions/sparkie_setup', { method: 'POST', body: {} })).json.console.faults;
      assert.ok(faults.some(f => f.where === 'saving chats'), JSON.stringify(faults));
      assert.ok((await say(chat, 'hello again')).text);
      const saved = JSON.parse(readFileSync(file, 'utf8')).conversations.find(c => c.id === chat);
      assert.ok(saved?.messages.some(m => m.content === 'hello there'), 'kept in memory and saved by the next good save');
    });
  });

  // Last for this service: it stops it.
  describe('stopping (SIGTERM)', () => {
    // (a stop and a restart: each look at the stand-in fleet can take ~20 s under the whole suite's load)
    test('new operations get 503 while a running one finishes; then it exits', { timeout: 180000 * SLOW }, async () => {
      const x = await ok('stop_model', { spark: 'spark4', container: RADIX });
      assert.equal((await finished(x.operation)).status, 'completed');
      // A restart that waits for the model to answer, held loading (the stand-in curl) until the test lets it answer.
      const down = join(T.fleet.root, 'spark4', '.mock', 'serve-down');
      writeFileSync(down, '');
      const y = await ok('restart_model', { spark: 'spark4', container: RADIX });
      process.kill(T.fleet.servicePid(), 'SIGTERM');
      await sleep(300);
      const h = await health();
      assert.equal(h.jobsRunning, 1, 'it\'s still running');
      const r = await call(keys.act.token, 'stop_model', { spark: 'spark3', container: 'sc-testorg--Qwen3.8-27B-abliterated-GGUF' });
      assert.equal(r.isError, true, r.text);
      assert.match(r.text, /^\[unreachable, retry later\] Spark Console is restarting/);
      assert.equal(T.fleet.serviceExit(), null, 'still there while it runs');
      // The running one finishes (on the record), and then the service exits by itself.
      rmSync(down);
      await waitFor(() => operationEvents(y.operation).some(e => e.status !== 'started'), { timeout: 60000, what: 'the restart to end' });
      assert.deepEqual(operationEvents(y.operation).map(e => e.status), ['started', 'completed'], 'it finished on the record');
      assert.equal(await waitFor(() => T.fleet.serviceExit(), { timeout: 10000, what: 'the service to exit' }), '0');
    });
  });
});

  // F2: a throw while a turn is set up (events with no time make the fleet record Sparkie gets throw) frees the chat and
  // the owner's slot. Statuses only: the turn's error text may change if that record is made safe one day.
  describe('a throw while a turn is being set up frees the chat', () => {
    let fleet;
    before(async () => {
      fleet = await startMock({ watchMs: 600000, statusMs: 600000, prepare: ({ stateDir }) => writeFileSync(join(stateDir, 'events.jsonl'),
        Array.from({ length: 10 }, (_, i) => `${JSON.stringify({ type: 'notice', text: `a line with no time ${i}` })}\n`).join(''), { mode: 0o600 }) });
    }, { timeout: 60000 * SLOW });
    after(() => fleet?.stop());
    test('a chat answers again after a turn that threw, and four more chats aren\'t refused as too many', { timeout: 120000 * SLOW }, async () => {
      const post = (path, body) => request(`${fleet.base}${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-spark-console': '1', origin: fleet.origin } });
      const chat = async () => { const r = await post('/chats', {}); assert.equal(r.status, 201, r.text); return JSON.parse(r.text).id; };
      const a = await chat();
      for (const [id, words] of [[a, 'hello'], [a, 'hello again'], [await chat(), 'hello'], [await chat(), 'hello'], [await chat(), 'hello'], [await chat(), 'hello']]) {
        const r = await post(`/chats/${id}/messages`, { text: words });
        assert.equal(r.status, 200, `${words}: ${r.status} ${r.text.slice(0, 300)}`);
      }
      assert.equal(JSON.parse((await request(`${fleet.base}/health`)).text).replying, 0);
    });
  });

  /* ───────── unreadable state files ───────── */
  // A service of its own (not this file's), driven with its own owner requests and agent key.
  const ownerOn = (fleet, path, { method = 'GET', body } = {}) => request(`${fleet.base}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: method === 'GET' ? {} : { 'content-type': 'application/json', 'x-spark-console': '1', origin: fleet.origin } }).then(r => ({ ...r, json: JSON.parse(r.text || 'null') }));
  const keyOn = async (fleet, act = false) => {
    const k = (await ownerOn(fleet, '/agents', { method: 'POST', body: { name: `state-${Math.random().toString(36).slice(2, 8)}` } })).json;
    if (act) await ownerOn(fleet, `/agents/${k.id}`, { method: 'PUT', body: { act: true } });
    return k.token;
  };
  const callOn = (fleet, token, name, args) => call(token, name, args, { url: fleet.mcp, timeout: 180000 * SLOW });

  describe('unreadable state files: set aside when they aren\'t JSON, never overwritten; another read error is "try again"', { concurrency: 1 }, () => {
    const BROKEN = ['verified.json', 'added-models.json', 'main.json'];
    let fleet;
    before(async () => {
      fleet = await startMock({ watchMs: 600000, prepare: ({ stateDir }) => {
        for (const f of BROKEN) writeFileSync(join(stateDir, f), `{"broken": ${f}`, { mode: 0o600 });
        // found-setups.json can't be read at all (a folder in its place).
        mkdirSync(join(stateDir, 'found-setups.json'));
      } });
    }, { timeout: 60000 * SLOW });
    after(() => fleet?.stop());
    test('each is renamed <file>.unreadable-<time> with a notice, and what it held is kept', { timeout: 60000 * SLOW }, async () => {
      // (what reads them: Sparkie's setups at start, the recipes that worked, the recipe finder)
      await ownerOn(fleet, '/verified');
      const token = await keyOn(fleet);
      await callOn(fleet, token, 'find_recipes', { query: 'qwen' });
      await callOn(fleet, token, 'sparkie_setup', {});
      await waitFor(() => BROKEN.every(f => readdirSync(fleet.stateDir).some(x => x.startsWith(`${f}.unreadable-`))), { timeout: 20000, what: 'all three set aside' });
      const names = readdirSync(fleet.stateDir);
      const events = readFileSync(join(fleet.stateDir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
      for (const f of BROKEN) {
        const aside = names.find(x => x.startsWith(`${f}.unreadable-`));
        assert.match(aside, new RegExp(`^${f.replace('.', '\\.')}\\.unreadable-\\d{4}-\\d\\d-\\d\\dT[\\d-]+Z$`));
        assert.equal(readFileSync(join(fleet.stateDir, aside), 'utf8'), `{"broken": ${f}`, `${f}: what it held is kept`);
        if (existsSync(join(fleet.stateDir, f))) assert.doesNotThrow(() => JSON.parse(readFileSync(join(fleet.stateDir, f), 'utf8')), `${f}: a good one in its place, or none`);
        // (main.json's notice: below)
        if (f !== 'main.json') assert.ok(events.some(e => e.type === 'notice' && e.text.includes(`${f} couldn’t be read, so it was set aside as ${aside}`)), `${f}: a notice`);
      }
      assert.equal(names.filter(x => /\.unreadable-/.test(x)).length, 3, 'once each');
    });
    test('one that can\'t be read at all: 503 "try again", and it\'s left where it is', { timeout: 60000 * SLOW }, async () => {
      const token = await keyOn(fleet);
      const r = await callOn(fleet, token, 'find_recipes', { query: 'qwen' });
      assert.equal(r.isError, true, r.text);
      assert.match(r.text, /^\[unreachable, retry later\] found-setups\.json couldn’t be read just now \(EISDIR\)\. Try again\./);
      assert.ok(statSync(join(fleet.stateDir, 'found-setups.json')).isDirectory());
      assert.ok(!readdirSync(fleet.stateDir).some(x => x.startsWith('found-setups.json.unreadable')));
    });
    test('main.json, set aside as the service starts, gets its notice in Activity too',
      {}, async () => {
        assert.match(readFileSync(join(fleet.stateDir, 'events.jsonl'), 'utf8'), /main\.json couldn’t be read, so it was set aside/);
      });
  });

  /* ───────── a file that isn't JSON falls back to the copy from before its last save (S1) ───────── */
  describe('a state file that isn\'t JSON (what a power cut can leave) falls back to the copy from before its last save', { concurrency: 1 }, () => {
    let fleet;
    before(async () => { fleet = await startMock({ watchMs: 600000, statusMs: 600000 }); }, { timeout: 60000 * SLOW });
    after(() => fleet?.stop());
    const act = (name, body = {}) => ownerOn(fleet, `/actions/${name}`, { method: 'POST', body });
    const lines = async () => (await act('memory')).json.entries.map(e => e.text);
    const asides = name => readdirSync(fleet.stateDir).filter(x => x.startsWith(`${name}.unreadable-`));
    const noticeOf = name => eventLines(fleet).find(e => e.type === 'notice' && e.text.startsWith(`${name} couldn’t be read, so it was set aside as `));

    test('an empty memory.json is set aside, the copy from before the last save takes its place, and the notice says the last change may be missing', { timeout: 60000 * SLOW }, async () => {
      assert.equal((await act('remember', { text: 'Spark 3 is where models go', kind: 'preference' })).json.outcome, 'remembered');
      assert.equal((await act('remember', { text: 'Spark 4 is on Wi-Fi only', kind: 'fact' })).json.outcome, 'remembered');
      const prev = join(fleet.stateDir, 'memory.json.prev');
      assert.deepEqual(JSON.parse(readFileSync(prev, 'utf8')).entries.map(e => e.text), ['Spark 3 is where models go']);
      assert.equal(statSync(prev).mode & 0o777, 0o600);
      // Sign-in files never get one (an old copy could bring back a removed key or device).
      await keyOn(fleet, true);
      for (const f of ['agents.json', 'access.json', 'sessions.json', 'passkeys.json']) assert.ok(!existsSync(join(fleet.stateDir, `${f}.prev`)), f);
      writeFileSync(join(fleet.stateDir, 'memory.json'), '');
      assert.deepEqual(await lines(), ['Spark 3 is where models go']);
      assert.equal(asides('memory.json').length, 1);
      assert.equal(readFileSync(join(fleet.stateDir, asides('memory.json')[0]), 'utf8'), '');
      const n = await waitFor(() => noticeOf('memory.json'), { timeout: 10000, what: 'the notice' });
      assert.match(n.text, /The copy from before the last save is in use, so the last change may be missing\.$/);
      assert.ok(!eventLines(fleet).some(e => /nothing was lost/.test(e.text || '')));
      assert.equal((await act('remember', { text: 'GLM needs sockets over the cable', kind: 'lesson' })).json.outcome, 'remembered');
      assert.deepEqual(await lines(), ['Spark 3 is where models go', 'GLM needs sockets over the cable']);
      // A missing file is just empty: it never falls back.
      rmSync(join(fleet.stateDir, 'memory.json'));
      assert.deepEqual(await lines(), []);
      assert.equal(asides('memory.json').length, 1);
    });

    test('with no earlier copy it starts empty, and the notice says so', { timeout: 60000 * SLOW }, async () => {
      writeFileSync(join(fleet.stateDir, 'saved-workflows.json'), '{"workflows": [', { mode: 0o600 });
      assert.deepEqual((await act('workflows')).json.saved, []);
      const n = await waitFor(() => noticeOf('saved-workflows.json'), { timeout: 10000, what: 'the notice' });
      assert.match(n.text, /It starts empty now\. What it held is still in that file\.$/);
      assert.equal(readFileSync(join(fleet.stateDir, asides('saved-workflows.json')[0]), 'utf8'), '{"workflows": [');
    });

    test('writePrivate syncs the file to disk before it takes the old one\'s place (a power cut can\'t be staged here, so this reads the code)', () => {
      const src = readFileSync(join(REPO, 'service', 'src', '03-identity.mjs'), 'utf8');
      const body = /\nfunction writePrivate\([\s\S]*?\n}\n/.exec(src)?.[0] || '';
      const sync = body.indexOf('fsyncSync('), swap = body.indexOf('renameSync(tmp, file)');
      assert.ok(sync > 0 && swap > sync, body);
    });
  });

  /* ───────── access.json that can't be read (S2) ───────── */
  describe('access.json that can\'t be read: the last good copy answers, and the bad file is left alone', { concurrency: 1 }, () => {
    const CUT = '{\n  "version": 1,\n  "ownerLogin": "owner@te'; // as a power cut can leave it
    let fleet, good;
    const file = name => join(fleet.stateDir, name);
    const who = async login => JSON.parse((await request(`${fleet.base}/whoami`, { headers: login ? { 'tailscale-user-login': login } : {} })).text).access;
    const notices = () => eventLines(fleet).filter(e => e.type === 'notice' && /^access\.json can’t be read \(not JSON\)/.test(e.text));
    before(async () => {
      fleet = await startMock({ watchMs: 600000, statusMs: 600000, prepare: ({ stateDir }) => {
        good = readFileSync(join(stateDir, 'access.json'), 'utf8');
        writeFileSync(join(stateDir, 'access.json.good'), good, { mode: 0o600 });
        writeFileSync(join(stateDir, 'access.json'), CUT, { mode: 0o600 });
      } });
    }, { timeout: 60000 * SLOW });
    after(() => fleet?.stop());

    test('the owner is still the owner, with one notice', { timeout: 60000 * SLOW }, async () => {
      assert.equal(await who(), 'owner');
      assert.equal(await who('stranger@test'), 'none');
      await waitFor(() => notices().length === 1, { timeout: 10000, what: 'the notice' });
      assert.match(notices()[0].text, /using its last good copy, access\.json\.good/);
    });

    test('the bad file is left exactly as it is', { timeout: 60000 * SLOW }, async () => {
      assert.equal(readFileSync(file('access.json'), 'utf8'), CUT);
      assert.ok(!readdirSync(fleet.stateDir).some(x => x.startsWith('access.json.unreadable')));
      assert.equal(readFileSync(file('access.json.good'), 'utf8'), good);
      assert.equal(notices().length, 1, 'one notice, not one per read');
    });

    test('mended, the copy still matches it; a new break gives a new notice', { timeout: 60000 * SLOW }, async () => {
      // Mended by hand, with one thing changed, so the copy can only match by following it.
      writeFileSync(file('access.json'), JSON.stringify({ ...JSON.parse(good), userName: 'Mended by hand' }, null, 2));
      // (the service reads the file again: the access change removed above used to make it read; fleet_status reads it)
      await ownerOn(fleet, '/actions/fleet_status', { method: 'POST', body: {} });
      const copy = JSON.parse(readFileSync(file('access.json.good'), 'utf8'));
      assert.deepEqual(copy, JSON.parse(readFileSync(file('access.json'), 'utf8')));
      assert.equal(copy.userName, 'Mended by hand');
      assert.equal(statSync(file('access.json.good')).mode & 0o777, 0o600);
      writeFileSync(file('access.json'), CUT);
      await ownerOn(fleet, '/actions/fleet_status', { method: 'POST', body: {} });
      assert.equal(await who(), 'owner');
      assert.equal(await who('member@test'), 'none');
      await waitFor(() => notices().length === 2, { timeout: 10000, what: 'a new break, a new notice' });
    });
  });

  /* ───────── a read that fails as an operation finishes (F12) ───────── */
  // What should be running and the workflows' record are read and saved again when an operation finishes. Each has a
  // link to a folder in its place when a stop finishes: it can't be read (EISDIR), but a save would go over it. (A plain
  // folder wouldn't show the fault: a file can't be renamed over a folder, so that save fails by itself.)
  describe('a state file that can\'t be read when an operation finishes is never saved over', { concurrency: 1 }, () => {
    const TESTORG = 'sc-testorg--Qwen3.8-27B-abliterated-GGUF', AT = '2026-11-04T10:00:00.000Z';
    const LIST = { revision: 1, running: [{ spark: 'spark3', container: TESTORG, model: 'testorg--Qwen3.8-27B-abliterated-GGUF', since: AT, by: 'owner@test' },
      { spark: 'spark4', container: RADIX, model: 'RadixArk--Qwen3.8-27B-NVFP4', since: AT, by: 'owner@test' }],
    revisions: [{ revision: 1, at: AT, by: 'Spark Console', chat: null, operation: null, added: [`spark3/${TESTORG}`, `spark4/${RADIX}`], removed: [], before: [], seeded: true }] };
    const RECORD = { start_model: { runs: 3, succeeded: 3, lastRunAt: AT, version: 'aaaaaaaaaaaa', at: AT, operation: '0123456789ab' },
      restart_model: { runs: 1, succeeded: 1, lastRunAt: AT, version: 'bbbbbbbbbbbb', at: AT, operation: 'abcdefabcdef' } };
    const FILES = { 'desired.json': LIST, 'validations.json': RECORD };
    let fleet;
    before(async () => {
      fleet = await startMock({ watchMs: 600000, prepare: ({ stateDir }) => {
        for (const [f, v] of Object.entries(FILES)) writeFileSync(join(stateDir, f), JSON.stringify(v, null, 2), { mode: 0o600 });
      } });
    }, { timeout: 60000 * SLOW });
    after(() => fleet?.stop());
    test('a stop that finishes then: both entries of each file are still there', { timeout: 240000 * SLOW }, async () => {
      const at = f => join(fleet.stateDir, f), token = await keyOn(fleet, true);
      mkdirSync(at('in-the-way'));
      for (const f of Object.keys(FILES)) { renameSync(at(f), at(`${f}.kept`)); symlinkSync('in-the-way', at(f)); }
      try {
        // The owner's Forget reads the list before it saves it: "try again", not "that isn't on the list".
        const forget = await ownerOn(fleet, '/desired/forget', { method: 'POST', body: { spark: 'spark4', container: RADIX } });
        assert.equal(forget.status, 503, forget.text);
        assert.match(forget.json.error, /^desired\.json couldn’t be read just now \(EISDIR\)\. Try again\./);
        const s = await callOn(fleet, token, 'stop_model', { spark: 'spark3', container: TESTORG });
        assert.equal(s.value?.outcome, 'started', s.text);
        // (its "completed" line on the record is the last thing a finished operation writes, after both saves)
        await waitFor(() => eventLines(fleet).some(e => e.type === 'operation' && e.id === s.value.operation && e.status === 'completed'), { timeout: 150000, what: 'the stop to finish' });
        for (const f of Object.keys(FILES)) assert.ok(lstatSync(at(f)).isSymbolicLink(), `${f}: nothing was saved over it`);
        assert.match(fleet.logText(), /Couldn’t update what should be running: desired\.json couldn’t be read just now \(EISDIR\)/);
        assert.match(fleet.logText(), /Couldn’t read the workflow record, so this run isn’t counted: validations\.json couldn’t be read just now \(EISDIR\)/);
      } finally {
        for (const f of Object.keys(FILES)) { rmSync(at(f), { force: true }); renameSync(at(`${f}.kept`), at(f)); }
      }
      // Readable again: what each held is all still there.
      const list = (await ownerOn(fleet, '/desired')).json;
      assert.deepEqual(list.running.map(x => `${x.spark}/${x.container}`), [`spark3/${TESTORG}`, `spark4/${RADIX}`]);
      assert.equal(list.revision, 1);
      assert.deepEqual(JSON.parse(readFileSync(at('validations.json'), 'utf8')), RECORD);
    });
  });

  /* ───────── the daily copy, across restarts and with the other Sparks off (F17) ───────── */
  // As if Spark Console restarted with every other Spark off: its record names a good copy from three days ago, and an
  // older build's daily notice went out yesterday (noticedOn). The hourly look runs 2 s after the start, then every 3 s
  // here (every hour on the Sparks).
  describe('the daily copy: its record survives a restart; with every other Spark off nothing is tried; a copy cut short is never moved in; a week without one is said once', { concurrency: 1 }, () => {
    const GOOD = { at: new Date(Date.now() - 3 * 86400000).toISOString(), to: 'spark3', file: 'state-old.tgz' };
    const OLDER_NOTICE = new Date(Date.parse(`${DAY}T12:00:00.000Z`) - 86400000).toISOString().slice(0, 10);
    const today = () => `state-${DAY}.tgz`;
    let F;
    const copies = spark => join(F.root, spark, '.local', 'share', 'spark-console', 'backups');
    const record = async () => (await health(F.base)).lastBackup;
    const nextTry = last => waitFor(async () => { const b = await record(); return b && b.at !== last?.at && b; }, { timeout: 40000, what: 'the next try' });
    const needsOn = async () => (await ownerOn(F, '/actions/fleet_status', { method: 'POST', body: {} })).json.needsOwner;
    const asRestarted = { watchMs: 600000, statusMs: 3000,
      env: { SPARK_CONSOLE_BACKUP_FIRST_MS: '2000', SPARK_CONSOLE_BACKUP_MS: '3000', ...HOLD_DAY },
      prepare: ({ dir, stateDir }) => {
        holdDay(dir);
        writeFileSync(join(dir, 'offline'), 'spark1\nspark3\nspark4\n');
        writeFileSync(join(stateDir, 'backup.json'), JSON.stringify({ at: GOOD.at, ok: true, to: GOOD.to, file: GOOD.file, good: GOOD, noticedOn: OLDER_NOTICE }), { mode: 0o600 });
      } };
    before(async () => { F = await startMock(asRestarted); }, { timeout: 180000 });
    after(() => F?.stop(), { timeout: 30000 });

    test('after a restart /health still names the last good copy', { timeout: 30000 * SLOW }, async () => {
      assert.deepEqual((await record()).good, GOOD);
    });

    // Contract 6.25 and 4.7 as the owner approved them on 2026-11-14 (design E 2.5, R23): a copy rides on a Spark that is
    // awake anyway, none is woken for it, and the owner hears only after 7 days with changes and no copy. Until E2a this
    // test held the old rule: a try every hour with every other Spark off, and a notice and a line from day 1.
    // (On a fleet of its own, from the same fixture: it moves the clock days ahead, and moving it back would leave the
    // Sparks it couldn't reach counted unreachable for those days, so the tests after it couldn't run on that fleet.)
    describe('every other Spark off, on a fleet of its own', () => {
      let G;
      before(async () => { G = await startMock(asRestarted); }, { timeout: 180000 });
      after(() => G?.stop(), { timeout: 30000 });
      test('every other Spark off: on day 3 nothing is tried, woken or said; past day 7 with changes, one notice and one needs line in exact words, once, even after an older build’s daily notice', { timeout: 150000 * SLOW }, async () => {
        const record = async () => (await health(G.base)).lastBackup;
        const needsOn = async () => (await ownerOn(G, '/actions/fleet_status', { method: 'POST', body: {} })).json.needsOwner;
        const kept = () => JSON.parse(readFileSync(join(G.stateDir, 'backup.json'), 'utf8'));
        const fixture = kept(), sevenDays = () => eventLines(G).filter(e => e.type === 'notice' && /copied to another Spark/.test(e.text || ''));
        assert.equal(fixture.noticedOn, OLDER_NOTICE);
        // Day 3: the status check has seen every other Spark off, and the look has run three times since.
        await waitFor(async () => (await ownerOn(G, '/status?fresh=1')).json.nodes.filter(n => n.id !== 'spark2').every(n => n.state !== 'online'), { timeout: 30000, what: 'every other Spark seen off' });
        await sleep(10000);
        assert.deepEqual(kept(), fixture, 'backup.json records no new try');
        assert.deepEqual(await record(), fixture);
        assert.deepEqual(sevenDays(), [], 'no notice on day 3');
        assert.ok(!(await needsOn()).some(l => /copied to another Spark/.test(l)), 'no needs line on day 3');
        const ops = (await ownerOn(G, '/actions/recent_operations', { method: 'POST', body: { limit: 50 } })).json.operations;
        assert.ok(!ops.some(o => o.type === 'power-on'), JSON.stringify(ops));
        assert.ok(!eventLines(G).some(e => e.type === 'spark-powered-on'), 'nothing was woken');
        assert.deepEqual(readFileSync(G.offlineFile, 'utf8').split(/\s+/).filter(Boolean).sort(), ['spark1', 'spark3', 'spark4']);
        // The same record carried past day 7, with the state changed: one notice, in these words, and the same needs line.
        const held = Number(readFileSync(join(G.dir, 'clock-offset'), 'utf8')) || 0;
        const words = `Spark Console’s state hasn’t been copied to another Spark for over 7 days (the newest copy is from ${GOOD.at.slice(0, 10)}, on Spark 3), and it has changed since. A copy goes by itself the next time another Spark is on; none is turned on for it, so turn one on for a few minutes. Until then, losing Spark 2’s disk would lose what changed.`;
        {
          assert.equal((await ownerOn(G, '/agents/settings', { method: 'PUT', body: { selfHeal: true } })).status, 200);
          writeFileSync(join(G.dir, 'clock-offset'), String(held + 4.5 * 86400000));
          const n = await waitFor(() => sevenDays()[0], { timeout: 20000, what: 'the notice past day 7' });
          assert.equal(n.text, words);
          assert.deepEqual((await needsOn()).filter(l => /copied to another Spark/.test(l)), [words]);
          await sleep(7000);
          assert.equal(sevenDays().length, 1, 'one notice, not one a look');
          assert.deepEqual(kept(), { ...fixture, noticedOn: n.at.slice(0, 10) }, 'noticedOn set once; still no try');
          // The next day: no second notice, and the line stands.
          writeFileSync(join(G.dir, 'clock-offset'), String(held + 5.5 * 86400000));
          await sleep(7000);
          assert.equal(sevenDays().length, 1, 'no second notice the next day');
          assert.equal(kept().noticedOn, n.at.slice(0, 10));
          assert.deepEqual((await needsOn()).filter(l => /copied to another Spark/.test(l)), [words]);
        }
      });
    });

    test('a copy that arrives cut short is not moved into place: the earlier file stays', { timeout: 90000 * SLOW }, async () => {
      mkdirSync(copies('spark3'), { recursive: true });
      writeFileSync(join(copies('spark3'), today()), 'an earlier good copy');
      writeFileSync(join(F.root, 'spark3', '.mock', 'gzip-bad'), '');
      writeFileSync(F.offlineFile, 'spark1\nspark4\n');
      // (two tries after Spark 3 is known to be back: at least one reached it)
      await sleep(4000);
      const last = await nextTry(await nextTry(await record()));
      assert.equal(last.ok, false);
      assert.match(last.error, /Spark 3/);
      assert.deepEqual(readdirSync(copies('spark3')), [today()], 'no .part left behind');
      assert.equal(readFileSync(join(copies('spark3'), today()), 'utf8'), 'an earlier good copy');
      assert.deepEqual((await record()).good, GOOD);
    });

    test('Spark 3 off and Spark 4 on: the copy lands on Spark 4, is recorded as the last good one, and no second copy is made that day', { timeout: 240000 * SLOW }, async () => {
      // (what Spark Console writes by itself a minute after it starts, the list of what should be running and the brain's
      // first check, is written before the window opens: a copy follows a change of the state now, and those are changes)
      await waitFor(() => existsSync(join(F.stateDir, 'desired.json')), { timeout: 120000, every: 1000, what: 'the start-up look' });
      await waitFor(() => existsSync(join(F.stateDir, 'brain-profiles.json')), { timeout: 60000, every: 1000, what: 'the brain’s first check' }).catch(() => {});
      await sleep(5000);
      rmSync(join(F.root, 'spark3', '.mock', 'gzip-bad'), { force: true });
      writeFileSync(F.offlineFile, 'spark1\nspark3\n');
      const b = await waitFor(async () => { const x = await record(); return x?.ok && x; }, { timeout: 40000, what: 'a good copy' });
      assert.equal(b.to, 'spark4');
      assert.equal(b.file, today());
      assert.deepEqual(b.good, { at: b.at, to: 'spark4', file: today() });
      assert.deepEqual(readdirSync(copies('spark4')), [today()]);
      const listed = execFileSync('tar', ['-tzf', join(copies('spark4'), today())], { encoding: 'utf8' }).split('\n');
      assert.ok(listed.some(f => /(^|\/)access\.json$/.test(f)));
      assert.deepEqual(JSON.parse(readFileSync(join(F.stateDir, 'backup.json'), 'utf8')), b);
      assert.ok(!(await needsOn()).some(l => /hasn’t been copied/.test(l)), 'the line goes');
      writeFileSync(F.offlineFile, 'spark1\n');
      await sleep(8000);
      assert.equal((await record()).at, b.at, 'no second copy that day');
    });
  });

  // The far side keeps the stream as <name>.part, read back, and moves it in (and prunes) only once this side knows tar
  // ended well too (A-9): a tar that ends badly after a whole stream (a file it couldn't read) replaces nothing and prunes
  // nothing. A fleet of its own: only Spark 3 takes copies; today's copy and 14 older ones are there; tried 2 s after the
  // start, then every 20 s (a quiet spell after each try, so its folder is read between two).
  describe('the daily copy: a tar that ends badly after a whole stream replaces nothing and prunes nothing', { concurrency: 1 }, () => {
    const today = () => `state-${DAY}.tgz`;
    const OLDER = Array.from({ length: 14 }, (_, i) => `state-2026-10-${String(i + 1).padStart(2, '0')}.tgz`);
    // GNU tar ends 2 after a file it can't read; BSD tar (macOS) ends 1, which the copy accepts. Root reads any file.
    const GNU_TAR = (() => { try { return /GNU tar/.test(execFileSync('tar', ['--version'], { encoding: 'utf8' })); } catch { return false; } })();
    let F;
    const copies = () => join(F.root, 'spark3', '.local', 'share', 'spark-console', 'backups');
    const record = async () => (await health(F.base)).lastBackup;
    const nextTry = last => waitFor(async () => { const b = await record(); return b && b.at !== last?.at && b; }, { timeout: 60000, what: 'the next try' });
    // Nothing replaced, nothing pruned, no .part left, and the try recorded as failed with no good copy.
    const untouched = async last => {
      assert.equal(last.ok, false, JSON.stringify(last));
      assert.match(last.error, /Spark 3/);
      assert.equal(last.good, null);
      assert.deepEqual(readdirSync(copies()).sort(), [...OLDER, today()].sort(), 'no .part left, none pruned');
      assert.equal(readFileSync(join(copies(), today()), 'utf8'), 'an earlier good copy');
      OLDER.forEach((f, i) => assert.equal(readFileSync(join(copies(), f), 'utf8'), `an older copy ${i + 1}`, f));
    };
    before(async () => {
      F = await startMock({ watchMs: 600000, statusMs: 3000,
        env: { SPARK_CONSOLE_BACKUP_FIRST_MS: '2000', SPARK_CONSOLE_BACKUP_MS: '20000', ...HOLD_DAY },
        prepare: ({ dir, root }) => {
          holdDay(dir);
          writeFileSync(join(dir, 'offline'), 'spark1\nspark4\n');
          // (the stand-in tar runs the real one to its end, then ends 2)
          writeFileSync(join(dir, 'tar-fails'), '');
          const b = join(root, 'spark3', '.local', 'share', 'spark-console', 'backups');
          mkdirSync(b, { recursive: true });
          OLDER.forEach((f, i) => { writeFileSync(join(b, f), `an older copy ${i + 1}`); const t = new Date(Date.UTC(2026, 9, i + 1)); utimesSync(join(b, f), t, t); });
          writeFileSync(join(b, today()), 'an earlier good copy');
        } });
    }, { timeout: 180000 });
    after(() => F?.stop(), { timeout: 30000 });

    test('tar ends 2 after a whole stream (the stand-in): the try fails, today’s file and the 14 older ones stay as they were, no .part is left', { timeout: 90000 * SLOW }, async () => {
      // (the try after whatever is recorded now: its folder is read in the quiet spell before the next)
      await untouched(await nextTry(await record()));
    });

    test('on Linux, a state file tar can’t read (mode 000): GNU tar ends 2, and the same holds', { timeout: 90000 * SLOW,
      skip: !GNU_TAR ? 'GNU tar only: BSD tar ends 1 for a file it can’t read, which the copy accepts' : process.getuid?.() === 0 ? 'root reads a mode-000 file' : false }, async () => {
      const stray = join(F.stateDir, 'unreadable-by-tar.json');
      writeFileSync(stray, '{}');
      chmodSync(stray, 0o000);
      try {
        rmSync(join(F.dir, 'tar-fails'), { force: true });
        // (the second try from now: the first may have started with the stand-in still failing)
        await untouched(await nextTry(await nextTry(await record())));
      } finally { chmodSync(stray, 0o600); rmSync(stray, { force: true }); }
    });

    test('tar ending well again: the copy lands as today’s file, and the oldest of the 14 goes', { timeout: 90000 * SLOW }, async () => {
      const last = await record();
      rmSync(join(F.dir, 'tar-fails'), { force: true });
      const b = await waitFor(async () => { const x = await record(); return x?.ok && x.at !== last?.at && x; }, { timeout: 60000, what: 'a good copy' });
      assert.deepEqual({ to: b.to, file: b.file }, { to: 'spark3', file: today() });
      assert.deepEqual(readdirSync(copies()).sort(), [...OLDER.slice(1), today()].sort(), 'the newest 14, no .part');
      const listed = execFileSync('tar', ['-tzf', join(copies(), today())], { encoding: 'utf8' }).split('\n');
      assert.ok(listed.some(f => /(^|\/)access\.json$/.test(f)), listed.join(' '));
    });
  });

  /* ───────── a Spark that freezes ───────── */
  // (spark2's, then spark4's: one after the other, since any command a Spark answers clears its count of misses)
  describe('timed-out commands', () => {
    let fleet, token;
    before(async () => {
      // No status checks, watcher, self-healing pass or held-list check in the way (the last two look at every Spark
      // each minute while anything is on the list); an offline Spark stays known as offline for a minute.
      fleet = await startMock({ watchMs: 600000, statusMs: 600000,
        env: { SPARK_CONSOLE_OFFLINE_TTL_MS: '60000', SPARK_CONSOLE_HEAL_MS: '600000', SPARK_CONSOLE_DESIRED_MS: '600000' } });
      token = await keyOn(fleet, true);
    }, { timeout: 60000 * SLOW });
    after(() => fleet?.stop());
    const offline = text => /isn’t reachable \(checked in the last minute\)/.test(text);
    test('two in a row count a Spark as offline for a minute (it isn\'t asked again meanwhile); a slow read says still_running', { timeout: 150000 * SLOW }, async () => {
      // (the service tests the Sparks' cables 20 s after it starts, which would count as an answer)
      await sleep(Math.max(0, 22000 - (Date.now() - Date.parse((await ownerOn(fleet, '/health')).json.startedAt))));
      writeFileSync(join(fleet.root, 'spark2', '.mock', 'stall'), '40');
      // (Spark 2 is the brain's, so nothing starts there: the second command is a look at it.)
      const [setup, look] = await Promise.all([callOn(fleet, token, 'sparkie_setup', {}), callOn(fleet, token, 'spark_diagnostics', { spark: 'spark2' })]);
      assert.ok(/didn’t answer in time|timed out|isn’t reachable/.test(look.text), look.text);
      const detail = await waitFor(async () => { const d = await callOn(fleet, token, 'spark_detail', { spark: 'spark2' }); return offline(d.text) && d; }, { timeout: 60000, every: 2000, what: 'spark2 known as offline' });
      assert.match(detail.text, /^\[unreachable, retry later\] /);
      const t0 = Date.now();
      assert.ok(offline((await callOn(fleet, token, 'spark_diagnostics', { spark: 'spark2' })).text));
      assert.ok(Date.now() - t0 < 3000, 'answered at once');
      // A read held up by the frozen Spark either says still_running at 50 s, or comes back with the Spark's check timed out.
      assert.ok(setup.isError ? /^\[still_running\] sparkie_setup took over 50 seconds/.test(setup.text) : /timed out|isn’t reachable/.test(setup.text), setup.text);
    });
    // (the waits inside are the service's own, so the limit has a fixed part: at SLOW=1 they need about 200 s)
    test('timed-out worker calls count too', { timeout: 150000 * SLOW + 150000 }, async () => {
      // Only its worker freezes, so any other command spark4 answers in between (the cable test 20 s after the service
      // starts, its one look at what's already running at 60 s, a look at every Spark from another call) rightly clears
      // the count. So this starts after those one-off looks, with nothing else asking spark4 meanwhile.
      const started = Date.parse((await ownerOn(fleet, '/health')).json.startedAt);
      await sleep(Math.max(0, 60000 + 20000 * SLOW - (Date.now() - started)));
      writeFileSync(join(fleet.root, 'spark4', '.mock', 'stall-worker'), '120');
      // The first call waits out the stall; by the second, the Spark may already count as offline (the status look
      // timed out on it too, which counts the same way).
      assert.match((await callOn(fleet, token, 'spark_diagnostics', { spark: 'spark4' })).text, /didn’t answer in time/);
      const second = (await callOn(fleet, token, 'spark_diagnostics', { spark: 'spark4' })).text;
      assert.ok(/didn’t answer in time/.test(second) || offline(second), second);
      // A third is answered at once (known offline), not after another wait.
      const d = await call(token, 'spark_diagnostics', { spark: 'spark4' }, { url: fleet.mcp, timeout: 5000 }).catch(e => ({ text: `no answer within 5 s (${e.message})` }));
      assert.ok(offline(d.text || ''), `a third: ${String(d.text).slice(0, 160)}`);
    });
  });
});
