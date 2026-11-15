// Covers: The stand-in fleet itself (start-mock.mjs). Its start: a port taken by someone else in the moment before the
// service listens (another file's fleet, four files at once) is noticed at once and the start made again, clean, on new
// ports. Its clean-up, stop(): a process that outlives the guard and still writes in the fleet's temporary folder
// (stop() tries again until it is done), and a folder that can't be removed at all (one line on stderr, never an
// error). A leftover temporary folder is not a product failure: it must never fail a test or hide the error a test's
// own body threw from inside `try { … } finally { await fleet.stop(); }`. The stand-ins that read a request body read a
// character whose bytes arrive in two pieces whole (the stand-in brain's is in lock.test.mjs).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, chmodSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';
import { SLOW, waitFor, postInTwo, REPO } from './lib.mjs';
import { startMock } from './start-mock.mjs';

const cheap = () => startMock({ watchMs: 600000, statusMs: 600000 });

// A straggler: writes new files in the folder in a tight loop, in a process group of its own (so stopping the guard's
// group never stops it), until a second after the guard has gone (at most 30 s), so it is still writing when stop()
// first tries to remove the folder. It ends early, without a word, once the folder itself is gone.
const WRITER = `
const { writeFileSync } = require('node:fs');
const [dir, guard, after] = process.argv.slice(1);
const alive = () => { try { process.kill(Number(guard), 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const cap = Date.now() + 30000;
let gone = 0;
for (let i = 0; ; i++) {
  try { writeFileSync(dir + '/straggler-' + i, ''); } catch (e) { if (e.code === 'ENOENT') break; throw e; }
  if (i % 10) continue;
  const now = Date.now();
  if (!gone && !alive()) gone = now;
  if ((gone && now - gone > Number(after)) || now > cap) break;
}
`;

describe('the stand-in fleet: its start and its clean-up', { concurrency: 1, timeout: 60000 * SLOW }, () => {
  test('the service\'s port taken before it listens: a clean start on new ports, at once, each with its own prepare', async () => {
    // The first attempt's port is one this test holds open (a listener that answers nothing).
    const held = net.createServer(s => s.destroy());
    await new Promise(r => held.listen(0, '127.0.0.1', r));
    const taken = held.address().port, timeoutMs = 30000 * SLOW, prepared = [];
    let fleet;
    try {
      const t0 = Date.now();
      fleet = await startMock({ watchMs: 600000, statusMs: 600000, timeoutMs, firstPort: taken, prepare: ({ dir, stateDir }) => {
        prepared.push(dir);
        appendFileSync(join(stateDir, 'prepared'), 'one prepare\n');
      } });
      const took = Date.now() - t0;
      assert.ok(took < timeoutMs / 2, `it noticed the exit instead of waiting it out: ${took} ms`);
      assert.notEqual(fleet.port, taken);
      assert.equal((await fetch(`${fleet.base}/health`)).ok, true);
      assert.equal(prepared.length, 2, 'prepare ran once per attempt');
      assert.equal(prepared[1], fleet.dir);
      assert.equal(existsSync(prepared[0]), false, 'the first attempt\'s folder is gone');
      assert.equal(readFileSync(join(fleet.stateDir, 'prepared'), 'utf8'), 'one prepare\n');
      assert.doesNotMatch(fleet.logText(), /is in use|EADDRINUSE/);
    } finally {
      await fleet?.stop();
      held.close();
    }
  });

  test('a process still writing in the folder after the guard has gone: stop() doesn\'t throw and the folder is removed', async () => {
    const fleet = await cheap();
    const writer = spawn(process.execPath, ['-e', WRITER, fleet.dir, String(fleet.pid), '1000'], { detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let said = '';
    writer.stderr.on('data', d => { said += d; });
    const ended = new Promise(r => writer.once('exit', code => r(code)));
    try {
      await waitFor(() => existsSync(join(fleet.dir, 'straggler-0')), { timeout: 10000, every: 10, what: 'the writer\'s first file' });
      await fleet.stop();
      assert.equal(existsSync(fleet.dir), false, 'the folder is gone once stop() returns');
      assert.equal(await ended, 0, `the writer ran to its end: ${said}`);
    } finally {
      if (writer.exitCode === null && writer.signalCode === null) { try { process.kill(writer.pid, 'SIGKILL'); } catch {} await ended; }
      rmSync(fleet.dir, { recursive: true, force: true });
    }
  });

  test('a folder that can\'t be removed: the body\'s own error comes out, and stderr has one plain line naming the folder', { skip: process.getuid?.() === 0 ? 'root can remove a read-only folder' : false }, async () => {
    const fleet = await cheap();
    // A file in a folder its owner may not write: no one but root can remove it, on macOS or Linux.
    const locked = join(fleet.dir, 'locked');
    mkdirSync(locked);
    writeFileSync(join(locked, 'kept'), '');
    chmodSync(locked, 0o500);
    const write = process.stderr.write;
    let err = '';
    try {
      process.stderr.write = chunk => { err += chunk; return true; };
      await assert.rejects(async () => {
        try { throw new Error('the real failure'); } finally { await fleet.stop(); }
      }, { message: 'the real failure' });
    } finally {
      process.stderr.write = write;
      chmodSync(locked, 0o700);
      rmSync(fleet.dir, { recursive: true, force: true });
    }
    const lines = err.split('\n').filter(Boolean);
    assert.equal(lines.length, 1, err);
    assert.ok(lines[0].includes(fleet.dir), lines[0]);
    assert.match(lines[0], /\bE[A-Z]{3,}\b/, 'it names the error code');
  });
});

// 2026-11-14: each piece of a body was decoded on its own, so a character cut between two pieces became replacement
// marks: in what the Telegram stand-in recorded, and in what the editor stand-in counted.
describe('the stand-ins that read a request body', { timeout: 60000 * SLOW }, () => {
  test('a character whose bytes arrive in two pieces is read whole: Telegram records the message as sent, the editor counts it once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stand-ins-'));
    const freePort = async () => { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const { port } = s.address(); await new Promise(r => s.close(r)); return port; };
    const tg = await freePort(), ed = await freePort();
    const kids = [spawn(process.execPath, [join(REPO, 'test', 'mock', 'telegram.mjs')], { env: { ...process.env, MOCK_TELEGRAM_PORT: String(tg), MOCK_DIR: dir }, stdio: 'ignore' }),
      spawn(process.execPath, [join(REPO, 'test', 'mock', 'editor.mjs')], { env: { ...process.env, MOCK_EDITOR_PORT: String(ed) }, stdio: 'ignore' })];
    try {
      await waitFor(() => fetch(`http://127.0.0.1:${tg}/__mode`, { method: 'POST', body: '{}' }).then(r => r.ok).catch(() => false), { what: 'the Telegram stand-in' });
      await waitFor(() => fetch(`http://127.0.0.1:${ed}/login`).then(r => r.ok).catch(() => false), { what: 'the editor stand-in' });
      const text = 'Spark’s port 3000 ✓ — €5';
      const sent = await postInTwo(`http://127.0.0.1:${tg}/bot1234567:${'a'.repeat(35)}/sendMessage`, JSON.stringify({ chat_id: 42, text }));
      assert.equal(sent.status, 200, sent.text);
      assert.equal(JSON.parse(sent.text).result.text, text);
      const calls = readFileSync(join(dir, 'telegram-calls.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
      assert.equal(calls.at(-1).body.text, text);
      const echoed = await postInTwo(`http://127.0.0.1:${ed}/upload`, text, { from: 8 });
      assert.equal(echoed.text, `got ${text.length} bytes`);
    } finally {
      for (const k of kids) k.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
