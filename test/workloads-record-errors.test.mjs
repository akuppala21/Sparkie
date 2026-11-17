// Covers: Saved-workflow record errors carry fixed words, never malformed file contents, into Keep, Done and
// Receipts notes or the recovery log. An input-echoing parser and a read error with untrusted text cannot disclose it;
// invalid record shapes remain content-free too. The primary stays byte for byte unchanged. Pure source fixtures,
// without a service, fleet, secret masker or assumptions about the Node version's JSON error wording.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('../service/src/18-run-record.mjs', import.meta.url)), 'utf8');
const PRIVATE = 'quiet orchard umbrella';
for (const [name, text, failedRead] of [
  ['an input-echoing parser', `${PRIVATE} malformed JSON`, false],
  ['a read error quoting untrusted text', `${PRIVATE} unreadable primary`, true],
  ['an invalid shape with arbitrary data', JSON.stringify({ runs: [], message: PRIVATE }), false],
]) {
  test(`${name} cannot put primary content in run notes or recovery logs`, async t => {
    const dir = mkdtempSync(join(tmpdir(), 'saved-record-errors-')), file = join(dir, 'saved-runs.json');
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(file, text);
    const notes = [], logs = [];
    const read = (...args) => {
      if (failedRead) throw Object.assign(new Error(`read failed near ${PRIVATE}`), { code: 'EACCES' });
      return readFileSync(...args);
    };
    // Newer parsers quote input in their exceptions. Force that behavior so the regression also holds on older Node.
    const parser = { parse: value => {
      try { return JSON.parse(value); }
      catch { throw new SyntaxError(`Unexpected data near ${value}`); }
    } };
    // No masking: the reader itself must remove untrusted error text before any reporter sees it.
    const f = new Function('STATE_DIR', 'readFileSync', 'note', 'maskSecrets', 'console', 'JSON', `${source}\nreturn { savedRunsNow, savedRunKeep, savedRunDone, savedRunReceipts, savedRunCutOff, savedRunsRecover };`)(
      dir, read, (_job, line) => notes.push(line), String, { error: line => logs.push(line) }, parser);
    assert.throws(() => f.savedRunsNow(), error => {
      assert.ok(!error.message.includes(PRIVATE), error.message);
      assert.match(error.message, /^The note of saved workflows under way /);
      return true;
    });
    const job = { id: '012345abcdef', createdAt: '2026-11-17T00:00:00.000Z' };
    assert.doesNotThrow(() => f.savedRunKeep(job, { title: 'a run' }));
    assert.doesNotThrow(() => f.savedRunDone(job));
    assert.doesNotThrow(() => f.savedRunReceipts({ id: 'fedcba654321', startedReceipts: { 'spark4/example': { id: 'a'.repeat(64) } } }));
    assert.equal(f.savedRunCutOff({ id: job.id }), false);
    await f.savedRunsRecover();
    assert.equal(notes.length, 3, 'Keep, Done and Receipts each report their failure');
    assert.equal(logs.length, 1, 'recovery logs its safe read failure');
    for (const line of [...notes, ...logs]) assert.ok(!line.includes(PRIVATE), line);
    assert.equal(readFileSync(file, 'utf8'), text, 'no reporter rewrote or moved the primary');
  });
}
