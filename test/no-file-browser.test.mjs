// Covers: The file browser and the editor's leftovers are out of Spark Console (E10e; the one page, milestone 4;
// design E 2.6; R37). The worker (service/worker.py, run here on its own with a made-up home) lists, reads and writes in
// a Spark's shared folder and answers nothing else there: no delete, rename or new folder, no personal folder
// (~/workspaces), no member folder, no editor folder in a listing, no editor restart and no editor log; a member's or
// the personal folder left on a Spark is not touched. The service's old file route (POST /nodes/<spark>/files) answers
// the owner as an unknown path does, and the editor's log as a log Spark Console doesn't have; service_logs offers
// console and sparkie only, and the page's Logs tab has no VS Code choice. Starts a stand-in fleet: run it on a Spark.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO, useFleet, api, SLOW } from './lib.mjs';

const WORKER = join(REPO, 'service', 'worker.py');
const read = f => readFileSync(join(REPO, f), 'utf8');

// One request to the worker, as the service sends it over SSH: JSON on stdin, JSON lines out.
function worker(home, config) {
  const r = spawnSync('python3', [WORKER], { input: JSON.stringify(config), env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 60000 * SLOW });
  const last = r.stdout.split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(x => x.type !== 'heartbeat').pop();
  assert.ok(last, `no answer: ${r.stderr}`);
  return last;
}
const refused = (x, message, what) => {
  assert.equal(x.type, 'error', `${what}: ${JSON.stringify(x)}`);
  if (message) assert.equal(x.error, message, what);
};
const b64 = s => Buffer.from(s).toString('base64');

describe('the worker: list, read and write in the shared folder, nothing else', () => {
  const home = mkdtempSync(join(tmpdir(), 'no-file-browser-'));
  const shared = (...p) => join(home, '.local/share/spark-portal/workspaces/shared', ...p);
  const personal = join(home, 'workspaces'), member = join(home, '.local/share/spark-portal/workspaces/member-0123456789abcdef');
  for (const dir of [personal, member]) { mkdirSync(dir, { recursive: true, mode: 0o700 }); writeFileSync(join(dir, 'kept.txt'), 'left by an older build\n'); }
  const files = (config) => worker(home, { action: 'workspace-files', workspaceScope: 'shared', ...config });
  after(() => rmSync(home, { recursive: true, force: true }));

  test('it writes a new file, reads it back and lists it; a listing names no editor folder', () => {
    const w = files({ operation: 'write', path: 'notes.md', data: b64('# Notes\n') });
    assert.equal(w.type, 'result', JSON.stringify(w));
    assert.equal(w.result.saved, true);
    assert.equal(readFileSync(shared('notes.md'), 'utf8'), '# Notes\n');
    const r = files({ operation: 'read', path: 'notes.md' });
    assert.equal(Buffer.from(r.result.data, 'base64').toString(), '# Notes\n');
    const l = files({ operation: 'list', path: '' });
    assert.deepEqual(l.result.entries.map(e => e.name), ['notes.md']);
    assert.deepEqual(Object.keys(l.result).sort(), ['entries', 'limit', 'maxFileBytes', 'nextOffset', 'offset', 'path', 'total', 'totalExact', 'truncated']);
  });

  test('it never deletes, renames or makes a folder', () => {
    refused(files({ operation: 'delete', path: 'notes.md' }), 'Unsupported file operation.', 'delete');
    refused(files({ operation: 'rename', path: 'notes.md', destination: 'moved.md' }), 'Unsupported operation settings.', 'rename with a destination');
    refused(files({ operation: 'rename', path: 'notes.md' }), 'Unsupported file operation.', 'rename');
    refused(files({ operation: 'mkdir', path: 'new-folder' }), 'Unsupported file operation.', 'a new folder');
    assert.deepEqual(readdirSync(shared()).filter(n => !n.startsWith('.portal-')), ['notes.md'], 'the folder is as it was');
  });

  test('it works in no other folder: not the personal one, not a member’s; what an older build left there stays', () => {
    refused(worker(home, { action: 'workspace-files', operation: 'list', path: '' }), 'Invalid workspace scope.', 'no area named');
    for (const op of [{ operation: 'list', path: '' }, { operation: 'read', path: 'kept.txt' }, { operation: 'write', path: 'new.txt', data: b64('x') }]) {
      refused(files({ ...op, workspaceScope: 'personal' }), 'Invalid workspace scope.', `personal ${op.operation}`);
      refused(files({ ...op, workspaceScope: 'member' }), 'Invalid workspace scope.', `member ${op.operation}`);
      refused(files({ ...op, workspaceScope: 'member', memberId: '0123456789abcdef' }), 'Unsupported operation settings.', `member's own ${op.operation}`);
    }
    for (const dir of [personal, member]) assert.deepEqual(readdirSync(dir), ['kept.txt'], dir);
  });

  test('it has no editor: no restart, no log, nothing in its code that reads or reports one', () => {
    refused(worker(home, { action: 'editor-restart' }), 'Unsupported operation settings.', 'editor-restart');
    refused(worker(home, { action: 'logs', service: 'editor' }), 'Choose console or sparkie logs.', 'the editor log');
    const src = readFileSync(WORKER, 'utf8');
    for (const w of ['editorReady', 'editor-restart', 'spark-portal-editor.service', 'editorFolder', 'editorRoot', 'memberId', "'Editor'"]) assert.ok(!src.includes(w), w);
  });
});

describe('the service and the page', () => {
  useFleet({ watchMs: 60000 });

  test('the owner’s POST /nodes/<spark>/files answers as an unknown path does, whatever it asks', { timeout: 120000 * SLOW }, async () => {
    const bodies = [{ operation: 'list', path: '' }, { operation: 'list', path: '', area: 'shared' }, { operation: 'read', path: 'notes.md' },
      { operation: 'write', path: 'x.txt', data: b64('x') }, { operation: 'delete', path: 'x.txt' }, { operation: 'rename', path: 'x.txt', destination: 'y.txt' },
      { operation: 'mkdir', path: 'folder' }];
    for (const body of [undefined, ...bodies]) {
      const method = body ? 'POST' : 'GET';
      const [a, b] = [await api('/nodes/spark3/files', { method, body }), await api('/nodes/spark3/no-such-route', { method, body })];
      assert.deepEqual([a.status, a.json], [b.status, b.json], `${method} ${JSON.stringify(body)} → ${a.status} ${a.text}`);
    }
  });

  test('the editor’s log answers as a log Spark Console doesn’t have; console and sparkie still answer', { timeout: 120000 * SLOW }, async () => {
    const [a, b] = [await api('/nodes/spark3/logs/editor'), await api('/nodes/spark3/logs/nope')];
    assert.deepEqual([a.status, a.json], [b.status, b.json], a.text);
    assert.equal(a.status, 400);
    for (const s of ['console', 'sparkie']) assert.equal((await api(`/nodes/spark3/logs/${s}`)).status, 200, s);
  });

  test('service_logs: console or sparkie, never the editor', { timeout: 60000 * SLOW }, async () => {
    const a = (await api('/actions')).json.actions.find(x => x.name === 'service_logs');
    assert.deepEqual(a.input.properties.service.enum, ['console', 'sparkie']);
    assert.ok(!/editor|VS Code/i.test(JSON.stringify(a)), a.description);
    const r = await api('/actions/service_logs', { method: 'POST', body: { spark: 'spark3', service: 'editor' } });
    assert.equal(r.status, 400, r.text);
    assert.match(r.json.error, /service should be one of: console, sparkie/);
  });

  test('the page: no VS Code log choice; with nothing to show, the Logs tab says so', () => {
    const app = read('public/app.js');
    assert.ok(!app.includes("['editor', 'VS Code']"), 'no VS Code log');
    assert.ok(!/keywords: '[^']*\beditor\b/.test(app), 'no editor in the palette’s words');
    assert.ok(app.includes('so there is no log to show'), 'an empty Logs tab says so');
  });
});
