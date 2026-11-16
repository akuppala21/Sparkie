// Covers: The sorter's closing fixes of 2026-11-15 (R55, R64; the final reads `net`, `keys` and the sorter's own): when
// it cannot tell what a command does it falls to the stricter side. Code a command does not show (`unshown`: root
// refuses on it; fed from input or a start-file setting it is asked); Docker that reaches the host and nsenter, chroot
// and unshare (the lock-out class); a command for Spark 2 from a compute Spark (not done; a host that can't be told is
// the dangerous ask); what the net can't put back (`lasting`: a Tailscale sign-out or sign-in by any spelling, a way-in
// package removed, a way-in word in an inline program); the lock-out class's misses (kills by name, radios, links,
// tunnels, init scripts, timers, the clock); protected containers (not done; an id that can't be told is asked the
// dangerous way); a rewrite in place marked `deletes`, with `overwrites` listing what it writes; kinds that run another
// program; `set -k`; a regular expression in a one-liner. Each list: the reviewers' examples and spellings of our own.
// Pure: no stand-in fleet, no port.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..'), SRC = join(REPO, 'service', 'src');
// The sorter's parts and 21-work.mjs, as test/sort.test.mjs loads them, with the few names they take from other parts stubbed.
const dir = mkdtempSync(join(tmpdir(), 'sct-sort-close-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
writeFileSync(join(dir, 'sort.mjs'), [
  "import { createHash, randomBytes } from 'node:crypto';",
  'const ALL_LOCAL = true, CONFIG = { user: "owner" }, J_MAX = 16 * 2 ** 20, NODES = [];',
  String.raw`const q = s => "'" + String(s).replace(/'/g, "'\\''") + "'";`,
  'class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }',
  'const ACTIONS = new Map(), action = a => ACTIONS.set(a.name, a), sparkArg = { type: "string" };',
  'const node = { id: "spark3", host: "100.0.0.3" }, sparkOf = () => node, sparkName = () => "Spark 3", journalId = () => "j_test";',
  'const journal = () => {}, jErr = () => null, jSub = () => [], noteReach = () => {}, maskSecrets = String, agentKeys = () => [];',
  'const consoleOrigin = () => "", sizeWords = String, hooks = { offline: true, spawn: null, ladder: [], sortOpts: null }, knownOffline = () => hooks.offline;',
  'const spawnOn = (n, o) => hooks.spawn(n, o);',
  'const RUNNER_DIR = "~/work", runnerSortOpts = () => hooks.sortOpts || {}, workChange = async (n, c, s) => { hooks.ladder.push(c); return { ladder: s.class }; };',
  ...readdirSync(SRC).filter(f => /^20-(?:options|places|programs|remote|shape|shell|sort|tables|tools|uses)\.mjs$/.test(f)).sort().map(f => readFileSync(join(SRC, f), 'utf8')),
  readFileSync(join(SRC, '21-work.mjs'), 'utf8'),
  'export { sortCommand };',
].join('\n'));
const { sortCommand } = await import(pathToFileURL(join(dir, 'sort.mjs')).href);

const HOSTS = { spark1: 'compute', spark2: 'hub', spark3: 'compute', spark4: 'compute', '100.122.49.9': 'compute', akspark2: 'hub', '100.64.0.2': 'hub' };
const BRAIN = ['sparkie-main', 'RadixArk--Qwen3.8-27B-NVFP4'];
const sort = (command, o = {}) => sortCommand(command, { hosts: HOSTS, brain: BRAIN, ...o });
const ROOT = { root: true };
// Each command's answer against what it must be: every one that differs, with the sorter's reason.
const check = (rows, f) => rows.flatMap(row => { const r = sort(row[0], row[2]), bad = f(r, row); return bad ? [`${JSON.stringify(row[0])}${row[2] ? ` ${JSON.stringify(row[2])}` : ''}: ${bad} (${r.class}: ${r.why})`] : []; });
const is = (want, r) => (r.class === want ? null : `${r.class}, not ${want}`);

// Item 2 (net 4): "as root, never a script" held only for a file named as a word.
test('code a command does not show: unshown says what runs unseen; as root every form has it; fed from input it is asked as the owner too, while builds stay plain', () => {
  const FORMS = ['bash < fix.sh', 'cat fix.sh | bash', 'python3 < fix.py', 'python3 -m fix', 'make install', 'npm run setup', 'env BASH_ENV=~/work/fix.sh bash -c true',
    'node -r ./hook.js -e 1', 'source fix.sh', '. fix.sh', 'echo fix.sh | xargs sh',
    // (and kin of our own)
    'sh -s < fix.sh', 'ruby < x.rb', 'perl -MFix -e 1', 'cargo build', 'yarn test', 'cmake --build build', 'LD_PRELOAD=./x.so ls', 'PYTHONSTARTUP=x.py python3',
    "find . -name '*.sh' -exec bash {} \\;", 'bash -c "$(cat fix.sh)"', 'ed notes.txt < cmds', 'docker compose up -d', 'crontab jobs.txt', 'conda run -n x python3 t.py',
    'pip install -e .', 'npm install ./pkg', 'python3 fix.py', './fix.sh', 'awk -f prog.awk data'];
  assert.deepEqual(check(FORMS.map(c => [c, null, ROOT]), r => (r.unshown && typeof r.unshown === 'string' && !/[\n\r]/.test(r.unshown) ? null : 'no unshown')), []);
  assert.deepEqual(check(FORMS.map(c => [c]), r => (r.unshown ? null : 'no unshown')), []);
  // (fed from input, or a start-file setting: asked as the owner too)
  assert.deepEqual(check(['bash < fix.sh', 'sh < ./fix.sh', 'python3 < fix.py', 'python3 - < x.py', 'ruby < x.rb', 'cat fix.sh | bash', 'echo fix.sh | xargs sh',
    'env BASH_ENV=~/work/fix.sh bash -c true', 'LD_PRELOAD=./x.so ls', 'NODE_OPTIONS=--require=./x.js node t.js'].map(c => [c]), r => is('risky', r)), []);
  // (the everyday forms stay a plain change, the wall bounding them: their code is unshown, but not asked for that)
  assert.deepEqual(check(['make', 'make -j8', 'npm install', 'npm run build', 'cargo build --release', 'python3 -m venv .venv', 'python3 -m json.tool < out.json',
    'pip install -e .', 'python3 train.py', 'cmake --build build -j8'].map(c => [c]), r => is('change', r)), []);
  // (what shows its code is not unshown: a one-liner, here-text, a look)
  for (const c of ["bash -c 'touch /tmp/x'", "python3 -c 'print(1)'", 'bash <<EOF\ntouch /tmp/x\nEOF', 'ls -la', 'apt install -y htop']) assert.equal(sort(c).unshown, null, c);
  assert.equal(sort('apt install -y htop').simple, true);
});
