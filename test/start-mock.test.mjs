// The stand-in fleet itself (start-mock.mjs). Its start: a port taken by someone else in the moment before the service
// listens (another file's fleet, four files at once) is noticed at once and the start made again, clean, on new ports.
// Its clean-up, stop(): a process that outlives the guard and still writes in the fleet's temporary folder (stop() tries
// again until it is done), and a folder that can't be removed at all (one line on stderr, never an error). A leftover
// temporary folder is not a product failure: it must never fail a test or hide the error a test's own body threw from
// inside `try { … } finally { await fleet.stop(); }`.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import net from 'node:net';
import { SLOW, waitFor } from './lib.mjs';
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
