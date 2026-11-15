// Covers: `deploy/go-back.sh` against a made-up home: runs the newest complete snapshot's `restore.sh` not marked
// `same`, with no options, refuses options, says so when there is none; `RECOVERY.txt` names the fixed path and
// commands; the installer lists and copies both before it replaces anything.
//
// deploy/go-back.sh and deploy/RECOVERY.txt (H1): the by-hand way back when Spark Console doesn't answer. go-back.sh
// runs against a made-up home (no fleet, no real snapshot); the installer is only read here (install.test.mjs runs its
// copy step).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO } from './lib.mjs';

const GO_BACK = join(REPO, 'deploy', 'go-back.sh');
function home(...snaps) {
  const h = mkdtempSync(join(tmpdir(), 'sct-goback-'));
  const rel = join(h, '.local', 'share', 'spark-console', 'releases');
  for (const [name, ...files] of snaps) {
    mkdirSync(join(rel, name), { recursive: true });
    for (const f of files) writeFileSync(join(rel, name, f), f === 'restore.sh' ? `#!/bin/sh\nprintf '%s|%s\\n' ${name} "$*" >> "$HOME/ran"\n` : '', { mode: 0o700 });
  }
  return h;
}
const run = (h, ...args) => spawnSync('bash', [GO_BACK, ...args], { env: { PATH: process.env.PATH, HOME: h }, encoding: 'utf8' });
const ran = h => (existsSync(join(h, 'ran')) ? readFileSync(join(h, 'ran'), 'utf8') : null);

describe('go-back.sh: the newest complete snapshot\'s restore.sh, by hand', () => {
  test('runs the newest complete snapshot not marked same, with no options; passes over half-made ones and other folders', () => {
    const h = home(['20261109T100000Z', 'restore.sh'], ['20261110T120000Z', 'restore.sh'], ['20261111T090000Z'], ['notes', 'restore.sh']);
    try {
      const r = run(h);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(ran(h), '20261110T120000Z|\n');
      assert.match(r.stdout, /Going back to the build saved before the update on 20261110T120000Z/);
    } finally { rmSync(h, { recursive: true, force: true }); }
  });
  test('passes over a snapshot marked same (what is installed now), as undo does', () => {
    const h = home(['20261109T100000Z', 'restore.sh'], ['20261110T120000Z', 'restore.sh', 'same']);
    try {
      const r = run(h);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(ran(h), '20261109T100000Z|\n');
    } finally { rmSync(h, { recursive: true, force: true }); }
  });
  test('refuses options (--with-state is for restore.sh by hand)', () => {
    const h = home(['20261110T120000Z', 'restore.sh']);
    try {
      const r = run(h, '--with-state');
      assert.equal(r.status, 2);
      assert.equal(ran(h), null);
    } finally { rmSync(h, { recursive: true, force: true }); }
  });
  test('says so when there is nothing to go back to', () => {
    for (const h of [mkdtempSync(join(tmpdir(), 'sct-goback-')), home(['20261111T090000Z']), home(['20261110T120000Z', 'restore.sh', 'same'])]) {
      try {
        const r = run(h);
        assert.equal(r.status, 1);
        assert.match(r.stderr, /no earlier build to go back to/);
        assert.equal(ran(h), null);
      } finally { rmSync(h, { recursive: true, force: true }); }
    }
  });
  test('RECOVERY.txt names the fixed path and the by-hand commands', () => {
    const t = readFileSync(join(REPO, 'deploy', 'RECOVERY.txt'), 'utf8');
    for (const s of ['bash ~/.local/share/spark-console/go-back.sh', 'systemctl --user restart spark-console-api', 'journalctl --user -u spark-console-api', '/undo update']) assert.ok(t.includes(s), s);
  });
  test('go-back.sh never touches sudo, SSH, Tailscale, the firewall, users or any model', () => {
    const code = readFileSync(GO_BACK, 'utf8').split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
    assert.doesNotMatch(code, /\b(sudo|ssh|tailscale|ufw|iptables|nft|docker|useradd|usermod|passwd)\b/);
  });
  test('the installer lists both files, sends them, and copies them before it replaces anything', () => {
    const s = readFileSync(join(REPO, 'deploy', 'host-on-portal.sh'), 'utf8');
    assert.match(s, /RECOVERY_FILES=\(go-back\.sh RECOVERY\.txt\)/);
    assert.match(s, /source\.tar "\$\{RECOVERY_FILES\[@\]\}"/);
    const cp = s.indexOf('cp "$IN/go-back.sh" "$IN/RECOVERY.txt" "$HOME/.local/share/spark-console/"');
    assert.ok(cp >= 0 && cp < s.indexOf('Installing the UI in ~/spark-console'));
  });
});
