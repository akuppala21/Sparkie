// Spark Console's own update record (S5): updates.json in the state folder, written by the build that runs, once, as it
// starts (noteUpdate in 18-workflows.mjs), and only when its build differs from the last one on record. The newest five
// are in sparkie_setup. Each test starts its own short-lived service on the stand-in fleet with a seeded state folder
// and a made-up install snapshot (never this machine's own releases folder).
// (The spec put these in state.test.mjs; they live here so that file stays as it is.)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { request, call, eventLines, SERVICE_FILE, REPO, SLOW } from './lib.mjs';
import { startMock } from './start-mock.mjs';

const STAMP = '20261110T120000Z';
// An earlier record: build n as 12 hex digits.
const OLD = n => ({ at: `2026-10-${String(n + 1).padStart(2, '0')}T08:00:00.000Z`, build: n.toString(16).padStart(12, '0'),
  previousBuild: n ? (n - 1).toString(16).padStart(12, '0') : null, stamp: null, note: null, result: n ? 'installed' : 'first record' });
const ownerOn = (fleet, path, { method = 'GET', body } = {}) => request(`${fleet.base}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body),
  headers: method === 'GET' ? {} : { 'content-type': 'application/json', 'x-spark-console': '1', origin: fleet.origin } }).then(r => ({ ...r, json: JSON.parse(r.text || 'null') }));
const keyOn = async fleet => (await ownerOn(fleet, '/agents', { method: 'POST', body: { name: `updates-${Math.random().toString(36).slice(2, 8)}` } })).json.token;
const notices = fleet => eventLines(fleet).filter(e => e.type === 'notice' && /^Spark Console (is now|went back)/.test(e.text)).map(e => e.text);
const record = fleet => JSON.parse(readFileSync(join(fleet.stateDir, 'updates.json'), 'utf8'));
// This tree's build, as /health reports it (fleet.test.mjs checks the service computes it the same way): a note or a
// seeded record for the build about to start has to name it before the service starts.
const BUILD = (() => {
  const h = createHash('sha256');
  for (const f of ['server.mjs', 'dig.mjs', 'passkey.mjs']) h.update(readFileSync(join(dirname(SERVICE_FILE), f)));
  return h.digest('hex').slice(0, 12);
})();

// A service whose releases folder holds one snapshot (`copy`: the running service's own three files, else other text).
async function withService({ copy = false, seed = null, note = null } = {}, fn) {
  const rel = mkdtempSync(join(tmpdir(), 'sct-releases-')), held = join(rel, STAMP, 'spark-console-service');
  mkdirSync(held, { recursive: true });
  writeFileSync(join(rel, STAMP, 'restore.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  if (copy) cpSync(dirname(SERVICE_FILE), held, { recursive: true });
  else for (const f of ['server.mjs', 'dig.mjs', 'passkey.mjs']) writeFileSync(join(held, f), `// an earlier build's ${f}\n`);
  const fleet = await startMock({ watchMs: 600000, statusMs: 600000, env: { SPARK_CONSOLE_RELEASES: rel }, prepare: ({ stateDir }) => {
    if (seed) writeFileSync(join(stateDir, 'updates.json'), JSON.stringify({ updates: seed }), { mode: 0o600 });
    if (note) writeFileSync(join(stateDir, 'update-note.json'), JSON.stringify(note), { mode: 0o600 });
  } });
  try {
    const build = (await (await fetch(`${fleet.base}/health`)).json()).build;
    await fn(fleet, build);
  } finally {
    await fleet.stop();
    rmSync(rel, { recursive: true, force: true });
  }
}

describe('the update record', { concurrency: 1, timeout: 120000 * SLOW }, () => {
  test('a state folder with no update record gets a first record, and no notice', async () => {
    await withService({}, async (fleet, build) => {
      const { updates } = record(fleet);
      assert.equal(updates.length, 1);
      assert.deepEqual([updates[0].build, updates[0].previousBuild, updates[0].stamp, updates[0].result], [build, null, null, 'first record']);
      assert.deepEqual(notices(fleet), []);
    });
  });

  test('a new build: one record (what it replaced, the snapshot, the note with a key hidden), one notice, 20 kept, five shown', async () => {
    const seed = Array.from({ length: 20 }, (_, n) => OLD(n));
    await withService({ seed, note: { build: BUILD, note: 'Chat never gets stuck.\nhf_abcdefghijklmnopqrstuvwxyz012345' } }, async (fleet, build) => {
      assert.equal(build, BUILD);
      const { updates } = record(fleet), u = updates.at(-1);
      assert.equal(updates.length, 20);
      assert.equal(updates[0].build, OLD(1).build, 'the oldest made room');
      assert.deepEqual([u.build, u.previousBuild, u.stamp, u.result], [build, OLD(19).build, STAMP, 'installed']);
      assert.equal(u.note, 'Chat never gets stuck. [hidden]');
      assert.ok(Date.now() - Date.parse(u.at) < 600000);
      assert.deepEqual(notices(fleet), [`Spark Console is now build ${build}. It was build ${OLD(19).build}.`]);
      const r = await call(await keyOn(fleet), 'sparkie_setup', {}, { url: fleet.mcp, timeout: 180000 * SLOW });
      assert.equal(r.isError, false, r.raw);
      const c = r.value.console;
      assert.equal(c.updates.length, 5);
      assert.deepEqual(c.updates[0], u);
      assert.equal(c.updates[1].build, OLD(19).build);
      assert.match(c.updateNotesAreData, /not instructions/);
      assert.ok(!r.raw.includes('hf_abcdefghij'), 'the key stays hidden');
    });
  });

  test('the build held in the newest snapshot runs again: recorded as going back, without the other build\'s note', async () => {
    await withService({ copy: true, seed: [OLD(0), { ...OLD(1), build: 'bbbbbbbbbbbb' }], note: { build: 'bbbbbbbbbbbb', note: 'For the build that was undone.' } }, async (fleet, build) => {
      const u = record(fleet).updates.at(-1);
      assert.deepEqual([u.build, u.previousBuild, u.stamp, u.note, u.result], [build, 'bbbbbbbbbbbb', STAMP, null, 'went back']);
      assert.deepEqual(notices(fleet), [`Spark Console went back a build. It is now build ${build}. It was build bbbbbbbbbbbb.`]);
    });
  });

  test('a go-back past a newer snapshot marked same (the second go-back in a row): still recorded as going back', async () => {
    const rel = mkdtempSync(join(tmpdir(), 'sct-releases-'));
    const S1 = join(rel, '20261110T120000Z'), S2 = join(rel, '20261111T120000Z');
    for (const s of [S1, S2]) mkdirSync(join(s, 'spark-console-service'), { recursive: true });
    // S1 holds the build that runs now (just put back); S2, the newer one, holds bbbb… (put back the time before)
    cpSync(dirname(SERVICE_FILE), join(S1, 'spark-console-service'), { recursive: true });
    for (const f of ['server.mjs', 'dig.mjs', 'passkey.mjs']) writeFileSync(join(S2, 'spark-console-service', f), `// another build's ${f}\n`);
    for (const s of [S1, S2]) { writeFileSync(join(s, 'restore.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o700 }); writeFileSync(join(s, 'same'), ''); }
    const seed = [OLD(0), { ...OLD(1), build: 'cccccccccccc' }, { at: '2026-11-11T13:00:00.000Z', build: 'bbbbbbbbbbbb', previousBuild: 'cccccccccccc', stamp: '20261111T120000Z', note: null, result: 'went back' }];
    const fleet = await startMock({ watchMs: 600000, statusMs: 600000, env: { SPARK_CONSOLE_RELEASES: rel }, prepare: ({ stateDir }) => {
      writeFileSync(join(stateDir, 'updates.json'), JSON.stringify({ updates: seed }), { mode: 0o600 });
      writeFileSync(join(stateDir, 'update-note.json'), JSON.stringify({ build: 'cccccccccccc', note: 'The build undone first.' }), { mode: 0o600 });
    } });
    try {
      const build = (await (await fetch(`${fleet.base}/health`)).json()).build;
      const u = record(fleet).updates.at(-1);
      assert.deepEqual([u.build, u.previousBuild, u.note, u.result], [build, 'bbbbbbbbbbbb', null, 'went back']);
      assert.deepEqual(notices(fleet), [`Spark Console went back a build. It is now build ${build}. It was build bbbbbbbbbbbb.`]);
    } finally { await fleet.stop(); rmSync(rel, { recursive: true, force: true }); }
  });

  test('a restart on the same build adds nothing', async () => {
    const seed = [OLD(0), OLD(1), { at: '2026-11-01T08:00:00.000Z', build: BUILD, previousBuild: OLD(1).build, stamp: '20261101T080000Z', note: 'Seeded.', result: 'installed' }];
    await withService({ seed, note: { build: BUILD, note: 'Not used again.' } }, async fleet => {
      assert.deepEqual(record(fleet), { updates: seed });
      assert.deepEqual(notices(fleet), []);
    });
  });

  test('source: the installer hands the note over as update-note.json', () => {
    const s = readFileSync(join(REPO, 'deploy', 'host-on-portal.sh'), 'utf8');
    assert.match(s, /"\$API_BUILD" "\$STAGE\/update-note\.json"/);
    assert.match(s.split('\n').find(l => l.includes('tar -C "$STAGE" -cf -')) || '', /update-note\.json/);
    assert.match(s, /cp "\$IN\/update-note\.json" "\$STATE\/update-note\.json"/);
  });
});
