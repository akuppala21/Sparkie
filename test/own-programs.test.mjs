// Covers: every program the console's call to the root helper runs on a Spark (`helperScript` for each verb, its key
// check and its exact forms, in 21-work.mjs) and the copies a change makes first (`copiesOn` in 21-copies.mjs) is on
// `PATH_PROGRAMS` (01-setup.mjs; R53), so the status round's look names it when a Spark lacks it. The programs are read
// out of the scripts' own text: a new one there that the list lacks fails here. Pure: no stand-in fleet, so it may run
// on the Mac.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..'), SRC = join(REPO, 'service', 'src');
const PATH_PROGRAMS = /^const PATH_PROGRAMS = '([^']*)';$/m.exec(readFileSync(join(SRC, '01-setup.mjs'), 'utf8'))[1].split(' ');
// 21-work.mjs and 21-copies.mjs, with the few names they take from other parts stubbed; run keeps each command it is
// handed (and answers as the copies' program does).
const dir = mkdtempSync(join(tmpdir(), 'sct-own-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
writeFileSync(join(dir, 'own.mjs'), [
  "import { createHash, randomBytes } from 'node:crypto';",
  'const ALL_LOCAL = false, CONFIG = { user: "owner" }, J_MAX = 16 * 2 ** 20, NODES = [];',
  String.raw`const q = s => "'" + String(s).replace(/'/g, "'\\''") + "'";`,
  'class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }',
  'const ACTIONS = new Map(), action = a => ACTIONS.set(a.name, a), sparkArg = { type: "string" };',
  'const sparkName = () => "Spark 3", maskSecrets = String, ran = [];',
  'const run = async (node, command) => { ran.push(command); return { code: 0, out: `\\nRESULT ${Buffer.from("{}").toString("base64")}\\n` }; };',
  readFileSync(join(SRC, '21-work.mjs'), 'utf8'),
  readFileSync(join(SRC, '21-copies.mjs'), 'utf8'),
  'export { helperScript, lookForm, LOOK_FORMS, KEY_SCRIPT, q, copiesOn, ran };',
].join('\n'));
const own = await import(pathToFileURL(join(dir, 'own.mjs')).href);

// The programs a shell text calls, read from its words: here-documents (the copies' Python) and quoted text left out (a
// caller's command is one quoted word), case patterns too; what starts each command (past assignments, the shell's
// own words and `exec`/`timeout N` in front) is a program unless it is the shell's own or a function the text defines.
const SHELL = new Set('[ [[ case esac if then else elif fi for in do done while until return exit shift set shopt cd printf echo read local export true false test eval trap wait break continue declare unset type command'.split(' '));
const FRONT = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', 'exec', 'timeout', 'command']);
function programsOf(text) {
  // (a program the copies' Python starts itself: subprocess.run(['name', …]))
  const out = new Set([...text.matchAll(/subprocess\.\w+\(\[\s*'([a-z][\w.+-]*)'/g)].map(m => m[1])), t = text.replace(/<<-?\s*'?(\w+)'?[^\n]*\n[\s\S]*?\n\1(?=\n|$)/g, ' ')
    .replace(/\$'(?:[^'\\]|\\.)*'/g, ' Q ').replace(/'[^']*'/g, ' Q ').replace(/"(?:[^"\\]|\\.)*"/g, ' Q ')
    .replace(/(\bin|;;)[ \t]*[^;()\n]*?\)/g, '$1 ');
  const fns = new Set([...t.matchAll(/([A-Za-z_][\w-]*)\(\)\s*\{/g)].map(m => m[1]));
  for (const seg of t.split(/\$\(|&&|\|\||[;|&(){}`\n]/)) {
    const w = seg.trim().split(/\s+/).filter(Boolean);
    for (;;) {
      if (w.length && /^[A-Za-z_]\w*=/.test(w[0])) w.shift();
      else if (w.length && FRONT.has(w[0])) { if (w[0] === 'timeout') out.add('timeout'); w.shift(); while (w.length && /^(?:-\S*|\d+)$/.test(w[0])) w.shift(); }
      else break;
    }
    if (w[0] && /^[a-z][a-z0-9._+-]*$/.test(w[0]) && !SHELL.has(w[0]) && !fns.has(w[0])) out.add(w[0]);
  }
  return out;
}

test('every program the call to the root helper and the copies run is on PATH_PROGRAMS', async () => {
  const far = { id: 'spark3', host: '100.0.0.3' }, hub = { id: 'spark2', host: 'local' }, texts = [];
  for (const node of [far, hub]) {
    texts.push(own.helperScript(node, 'look', { id: 'abcdefgh1234', command: 'cat x', seconds: 30, words: ['x'], walks: ['y'] }));
    texts.push(own.helperScript(node, 'run', { id: 'abcdefgh1234', command: 'touch x', seconds: 30, dir: '~/work', protect: ['~/models', '~/.cache/huggingface'] }));
    texts.push(own.helperScript(node, 'prove', { id: 'abcdefgh1234' }));
  }
  // Each exact form, by a command that is that form (every row of the table is reached).
  const forms = ['docker ps', 'docker ps -a', 'docker images', 'docker stats --no-stream', 'nvidia-smi', 'tailscale status', 'ip addr', 'ip route',
    'ss -tln', 'systemctl status ssh', 'systemctl --user status x', 'systemctl --failed', 'systemctl --user --failed'];
  assert.equal(own.LOOK_FORMS.filter(([re]) => forms.some(f => re.test(f))).length, own.LOOK_FORMS.length, 'a command here for every exact form');
  for (const f of forms) texts.push(own.helperScript(far, 'check', { id: 'abcdefgh1234', seconds: 30, form: own.lookForm(f) }));
  // The key check runs as one quoted word (bash -c '…'): its own text is read too.
  assert.ok(texts[0].includes(own.q(own.KEY_SCRIPT)), 'the key check is in a look\'s script');
  texts.push(own.KEY_SCRIPT);
  for (const mode of ['copy', 'after', 'restore', 'drop']) await own.copiesOn(far, mode, { set: 's1', placed: [], wide: [], ways: [], sha: '0'.repeat(64) });
  assert.equal(own.ran.length, 4);
  texts.push(...own.ran);
  const called = new Set(texts.flatMap(t => [...programsOf(t)]));
  // (the reading finds what is plainly there)
  for (const p of ['sha256sum', 'flock', 'sudo', 'systemd-run', 'timeout', 'bash', 'realpath', 'find', 'python3', 'docker', 'nvidia-smi', 'systemctl']) assert.ok(called.has(p), `${p} is read out of the scripts`);
  assert.ok(programsOf(own.ran[0]).has('systemctl'), 'the copies\' own call of systemctl is read');
  assert.deepEqual([...called].filter(p => !PATH_PROGRAMS.includes(p)).sort(), [], `called but not on PATH_PROGRAMS (read: ${[...called].sort().join(' ')})`);
});
