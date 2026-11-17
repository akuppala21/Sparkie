// Covers: The rebuild steps, `deploy/REBUILD.txt` (E2d; design E 2.5): what the owner does when Spark 2's disk is gone.
// The installer ships them with the recovery files (`RECOVERY_FILES` gains the file, and its Spark 2 half copies it to
// `~/.local/share/spark-console/` before anything is replaced); every repository path, script, chat word and page label
// they name exists in the tree; every command line they give uses only tools a fresh Spark 2 has; the 7 days and the
// left-out `sessions.json` are the code's own; plain size. The copy landing at the fixed path is install.test.mjs's
// case 21; `/help` naming it is words.test.mjs's.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './start-mock.mjs';

const TEXT = readFileSync(join(REPO, 'deploy', 'REBUILD.txt'), 'utf8');
const INSTALLER = readFileSync(join(REPO, 'deploy', 'host-on-portal.sh'), 'utf8');
const src = f => readFileSync(join(REPO, 'service', 'src', f), 'utf8');
const isFile = p => { try { return statSync(p).isFile(); } catch { return false; } };
// What the installer puts in ~/.local/share/spark-console/: RECOVERY_FILES, every line that sets or adds to it.
const RECOVERY = [...INSTALLER.matchAll(/^RECOVERY_FILES\+?=\(([^)]*)\)/gm)].flatMap(m => m[1].trim().split(/\s+/));

describe('deploy/REBUILD.txt, the rebuild steps', () => {
  test('the installer ships it with the recovery files, and its Spark 2 half copies it beside RECOVERY.txt before it replaces anything', () => {
    assert.ok(RECOVERY.includes('REBUILD.txt'), RECOVERY.join(' '));
    assert.ok(RECOVERY.includes('RECOVERY.txt'));
    const at = INSTALLER.indexOf('cp "$IN/REBUILD.txt" "$HOME/.local/share/spark-console/"');
    assert.ok(at > INSTALLER.indexOf('cp "$IN/go-back.sh" "$IN/RECOVERY.txt" "$HOME/.local/share/spark-console/"'), 'after the way back is copied');
    assert.ok(at < INSTALLER.indexOf('Installing the UI in ~/spark-console'), 'before anything is replaced');
  });

  test('every repository path and script it names exists in the tree', () => {
    const paths = [...TEXT.matchAll(/(?<![\w/.~-])((?:deploy|service|tools|docs|test|public)\/[\w./-]*[\w])/g)].map(m => m[1]);
    assert.ok(paths.length >= 6, paths.join(' '));
    for (const p of paths) assert.ok(existsSync(join(REPO, p)), `${p} is named and is not in the repository`);
    for (const [, s] of TEXT.matchAll(/(?<![\w/.-])([\w-]+\.(?:sh|mjs|py))\b/g)) {
      assert.ok(['deploy', 'tools', 'service'].some(d => isFile(join(REPO, d, s))), `${s} is named and is not in deploy/, tools/ or service/`);
    }
  });

  test('every file it names on Spark 2 at the fixed folder is one an install puts there, and the copies’ folder is the one the copy writes to', () => {
    for (const [, f] of TEXT.matchAll(/~\/\.local\/share\/spark-console\/([\w.-]+)(?![\w/])/g)) {
      assert.ok(RECOVERY.includes(f), `~/.local/share/spark-console/${f} is named, and no install puts it there`);
    }
    assert.ok(TEXT.includes('~/.local/share/spark-console/backups/state-*.tgz'));
    assert.ok(src('25-backup-and-start.mjs').includes('"$HOME/.local/share/spark-console/backups"'), 'the copy still lands in that folder');
    assert.ok(src('25-backup-and-start.mjs').includes('state-${day}.tgz'), 'and is still named state-<day>.tgz');
    assert.ok(TEXT.includes('-C ~/.local/state/spark-console'));
    assert.ok(src('01-setup.mjs').includes('/.local/state/spark-console`'), 'the state folder it untars into is the one the service reads');
  });

  test('the chat words and page labels it names are the code’s own', () => {
    for (const w of [...TEXT.matchAll(/(?<![\w/~.])\/(status|restart sparkie|key|pause|stop|help|undo update)\b/g)].map(m => m[0])) {
      assert.ok(src('20-words.mjs').includes(w), `${w} is not a word Spark Console answers`);
    }
    for (const label of ['Agents and Telegram', 'Your passkey']) {
      if (TEXT.includes(label)) assert.ok(readFileSync(join(REPO, 'public', 'app.js'), 'utf8').includes(`'${label}'`), `the page has no “${label}”`);
    }
  });

  test('each command line uses only what a fresh Spark 2 (DGX OS) or the Mac already has', () => {
    const HAS = new Set(['ls', 'head', 'scp', 'mkdir', 'chmod', 'tar', 'sudo', 'bash', 'for', 'do', 'done', 'grep', 'rm', 'ssh-copy-id', 'rsync', 'find']);
    const lines = TEXT.split('\n').filter(l => /^ {5}\S/.test(l));
    assert.ok(lines.length >= 6, lines.join('\n'));
    for (const l of lines) {
      for (const part of l.trim().split(/\s*(?:;|&&|\|\||\|)\s*/)) {
        const w = part.split(/\s+/)[0];
        if (w) assert.ok(HAS.has(w), `“${l.trim()}” needs ${w}`);
      }
    }
  });

  test('model recovery copies link targets without carrying root ownership, and checks both links and ownership', () => {
    assert.match(TEXT, /rsync -rLt <spark>:\.cache\/huggingface\/hub\/models--<model>/);
    assert.match(TEXT, /rsync -rLt <spark>:\.cache\/huggingface\/hub\/models--<draft>/);
    assert.match(TEXT, /find -L ~\/\.cache\/huggingface\/hub -type l -print/);
    assert.match(TEXT, /find ~\/\.cache\/huggingface\/hub ! -user "\$USER" -print/);
    assert.match(TEXT, /Stop on any copy error/);
    assert.match(TEXT, /Both find checks must print nothing/);
    assert.doesNotMatch(TEXT, /(?:chmod|chown) -R/);
  });

  test('the 7 days and the sign-ins left out are the code’s own; plain words, in a size a phone shows', () => {
    assert.match(TEXT, /up to 7 days old/);
    assert.match(src('20-state-copy.mjs'), /const COPY_LATE_MS = 7 \* 86400000;/);
    assert.match(TEXT, /--exclude=\.\/sessions\.json/);
    assert.match(src('25-backup-and-start.mjs'), /'--exclude=\.\/sessions\.json'/);
    assert.ok(Buffer.byteLength(TEXT) <= 4096, `${Buffer.byteLength(TEXT)} bytes`);
    assert.ok(TEXT.split('\n').every(l => l.length <= 125), 'no line a phone has to scroll far for');
    assert.doesNotMatch(TEXT, /\b100\.\d+\.\d+\.\d+\b|tailab9aa9|akuppala/, 'no address or account name');
  });
});
