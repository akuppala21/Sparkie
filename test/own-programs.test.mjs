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
// 21-work.mjs and 21-copies.mjs (with its pruning, 21-copies-prune.mjs), with the few names they take from other parts stubbed; run keeps each command it is
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
  readFileSync(join(SRC, '21-copies-prune.mjs'), 'utf8'),
  readFileSync(join(SRC, '21-copies.mjs'), 'utf8'),
  // (the net's own sentences, 21-guard.mjs: GUARD_SAYS alone, as that part keeps it)
  /^const GUARD_SAYS = \{[\s\S]*?\n\};$/m.exec(readFileSync(join(SRC, '21-guard.mjs'), 'utf8'))[0],
  'export { helperScript, lookForm, LOOK_FORMS, KEY_SCRIPT, q, copiesOn, ran, HELPER_SAYS, GUARD_SAYS };',
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
    texts.push(own.helperScript(node, 'run', { id: 'abcdefgh1234', command: 'touch x', seconds: 30, dir: '~', memory: 4, fleet: true, gpu: true }));
    texts.push(own.helperScript(node, 'run', { id: 'abcdefgh1234', command: 'touch x', seconds: 30, dir: '~/work', open: true }));
    texts.push(own.helperScript(node, 'state', { id: 'abcdefgh1234' }));
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

test('the call to the root helper: a change\'s cap and widenings as the helper takes them, and never a quiet ~ for a dir it can\'t take', () => {
  const far = { id: 'spark3', host: '100.0.0.3' }, at = opts => own.helperScript(far, 'run', { id: 'abcdefgh1234', command: 'touch x', seconds: 30, ...opts });
  assert.match(at({ dir: '~', memory: 4, fleet: true, gpu: true }), / --dir "\$HOME" --memory 4G --fleet --gpu -- 'touch x'/);
  assert.match(at({ dir: '~/work', memory: 8, open: true, fleet: true }), / --dir "\$HOME"'\/work' --memory 8G --open -- 'touch x'/);
  assert.match(at({ dir: '~', memory: 2, home: true, gpu: true }), / --dir "\$HOME" --memory 2G --home --gpu -- 'touch x'/);
  assert.match(at({ dir: '~', open: true, home: true }), / --open -- 'touch x'/, 'never --home with --open');
  assert.match(own.helperScript(far, 'state', { id: 'abcdefgh1234' }), /"\$h" state --id "\$id"/);
  for (const dir of ['/tmp', '~/../x', 'work', '~/a b', '~/.']) {
    assert.throws(() => at({ dir }), e => e.status === 400 && /^dir isn’t in the right form for a change/.test(e.message), dir);
  }
});

// Every sentence of the helper's that the console reads (HELPER_SAYS, and the net's GUARD_SAYS) is one the helper can
// print, as its own file says: a sentence the helper changes fails here, not on a Spark (the disk floor's, 2026-11-15).
test('every helper sentence the console reads is one deploy/spark-console-root prints', () => {
  const helper = readFileSync(join(REPO, 'deploy', 'spark-console-root'), 'utf8');
  const render = t => t.replace(/\$\(\([^)]*\)\)/g, '12').replace(/\$\([^)]*\)/g, 'X').replace(/\$\{[^}]*\}/g, 'X').replace(/\$[A-Za-z_][A-Za-z0-9_]*/g, 'X')
    .replace(/\\"/g, '"').replace(/%s/g, '12').replace(/\\n/g, '\n');
  // (a double-quoted word as bash reads it: a $( … ) inside it may hold quotes of its own)
  const quoted = (t, i) => {
    let depth = 0, out = '';
    for (; i < t.length; i++) {
      const c = t[i];
      if (c === '\\') { out += c + t[++i]; continue; }
      if (c === '$' && t[i + 1] === '(') { depth++; out += '$('; i++; continue; }
      if (c === ')' && depth) { depth--; out += c; continue; }
      if (c === '"' && !depth) return out;
      out += c;
    }
    return out;
  };
  const said = [];
  for (const m of helper.matchAll(/\b(say|refuse)\s+"/g)) said.push((m[1] === 'refuse' ? 'refused: ' : '') + render(quoted(helper, m.index + m[0].length)));
  for (const m of helper.matchAll(/\bprintf\s+'([^']*)'/g)) said.push(render(m[1]));
  for (const m of helper.matchAll(/\btail\+=\("/g)) said.push(render(quoted(helper, m.index + m[0].length)));
  const lines = said.flatMap(s => s.split('\n')).map(s => s.trim()).filter(Boolean);
  // (a line as said, without the id or the line break printf puts before it, and refuse's way of passing a found reason)
  const seen = [...new Set(lines.flatMap(l => [l, l.replace(/^\S+ /, ''), `refused: ${l}`, `refused: ${l.replace(/^\S+ /, '')}`]))];
  assert.ok(seen.length > 100, `the helper's sentences were read: ${seen.length}`);
  for (const [name, re] of Object.entries({ ...own.HELPER_SAYS, ...own.GUARD_SAYS })) assert.ok(seen.some(l => re.test(l)), `${name} (${re}) matches nothing the helper prints`);
});
