// Covers: deploy/pull.sh (design C 2.3, step 4; R29, R30): installing a tested build on Spark 2 from GitHub, without
// the Mac. A bare repository on this machine stands in for GitHub; each commit on its main is a small tree whose
// service is the stand-in console (test/mock/standin-console.mjs) and whose deploy/ is this tree's own installer and
// pull.sh, and its tested/<tree> tags are made as the mark job makes them (the commit plus the lock). A short HOME
// stands in for Spark 2: stand-ins come first on PATH (systemctl runs the stand-in console; ssh, sudo, tailscale and
// systemd-run fail closed and log), and SPARK_CONSOLE_REPO_URL (with SPARK_CONSOLE_ALL_LOCAL=1) points pull.sh at the
// bare repository. Covered: setup keeps the token in the secrets file beside what was there, never on a command line or
// in git's config; check changes nothing; install puts in exactly the tagged tree through its own installer, kept, and
// only then copies its pull.sh; the stand-in fleet's links under test/mock/root/ (as the repository has them) pass and
// stay links; every refusal (an untagged head, a tag that changes other files, a lock for another tree or build, a link
// anywhere else or pointing out of test/mock/root/, a submodule, an export- attribute, an older tested tree, a tree
// only on another branch, a tree older than the installed one) changes nothing; a build that dies goes back; a tree
// with the installed build's service code is "kept" only when its installer kept it; main moved the way tools/land.mjs
// moves it (a merge, then a fast-forward) still names the newest tested build; nothing calls tailscale, sudo or ssh.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, statSync, lstatSync, readlinkSync, copyFileSync, chmodSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { REPO, MOCK } from './start-mock.mjs';
import { SLOW } from './lib.mjs';

const PULL_TEXT = readFileSync(join(REPO, 'deploy', 'pull.sh'), 'utf8');
const INSTALLER_TEXT = readFileSync(join(REPO, 'deploy', 'host-on-portal.sh'), 'utf8');
const UI_FILES = INSTALLER_TEXT.match(/^UI_FILES=\(([^)]*)\)/m)[1].split(/\s+/).filter(Boolean);
const STANDIN = readFileSync(join(MOCK, 'standin-console.mjs'), 'utf8');
const NODE_DIR = dirname(process.execPath);
const REAL_GIT = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
const TOKEN = 'testtoken_made_up_0123456789';   // not a real token
const OWNER_REPO = 'someone/spark-console';
const LOCK = 'service/workflows.lock.json';
const homes = [];

// A HOME short enough for the socket under it (macOS allows 104 characters).
function shortHome(prefix) {
  let home = mkdtempSync(join(tmpdir(), prefix));
  if (`${home}/.local/state/spark-console/api.sock`.length >= 100) { rmSync(home, { recursive: true, force: true }); home = mkdtempSync(join('/tmp', prefix)); }
  homes.push(home);
  return home;
}
const sh = (file, text) => writeFileSync(file, text, { mode: 0o755 });
const gnuTar = spawnSync('tar', ['--version'], { encoding: 'utf8' }).stdout?.includes('GNU');
const findPrintf = spawnSync('find', ['.', '-maxdepth', '0', '-printf', ''], { encoding: 'utf8' }).status === 0;
const read = (...p) => readFileSync(join(...p), 'utf8');
const sha12 = (...texts) => createHash('sha256').update(texts.join('')).digest('hex').slice(0, 12);

// ── GitHub's stand-in: a bare repository, written with git's plumbing (each commit from its whole file map). ──
let WORK, GH, mainHead = null, indexN = 0;
const GIT_ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@test',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@test' };
function gh(args, { env = {}, input } = {}) {
  const r = spawnSync(REAL_GIT, ['-C', GH, ...args], { encoding: 'utf8', env: { ...GIT_ENV, ...env }, input });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
// files: { path: { text, mode } } (mode 120000 is a link to text; 160000 a submodule at commit `sha`).
function commitOf(parent, files, subject) {
  const env = { GIT_INDEX_FILE: join(WORK, `index-${indexN++}`) };
  for (const [path, v] of Object.entries(files)) {
    if (!v) continue;
    const obj = v.mode === '160000' ? v.sha : gh(['hash-object', '-w', '--stdin'], { input: v.text });
    gh(['update-index', '--add', '--cacheinfo', `${v.mode || '100644'},${obj},${path}`], { env });
  }
  const tree = gh(['write-tree'], { env });
  const commit = gh(['commit-tree', tree, ...[].concat(parent || []).flatMap(p => ['-p', p]), '-m', subject]);
  return { commit, tree, t12: tree.slice(0, 12), files };
}
const HF = 'test/mock/root/spark2/.cache/huggingface/hub/models--x--y', OVERLAY = 'test/mock/root/spark2/.cache/spark-console/overlay/m/config.json';
const buildOf = files => sha12(files['service/server.mjs'].text, files['service/dig.mjs'].text, files['service/passkey.mjs'].text);
// A whole tree: the stand-in console as the service, this tree's installer and pull.sh (marked with n, so a copy can
// be told apart), and the page's files.
function treeFiles(n, mode = 'good') {
  const server = `const MODE = '${mode}'; // ${n}\n${STANDIN}`;
  const f = {
    'service/src/00-standin.mjs': { text: server }, 'service/server.mjs': { text: server },
    'service/dig.mjs': { text: '// stand-in dig.mjs\n' }, 'service/passkey.mjs': { text: '// stand-in passkey.mjs\n' },
    // (a Spark to reach over ssh: the installer must not try it here)
    'service/config.json': { text: '{"nodes":[{"id":"spark2","host":"local"},{"id":"spark3","host":"spark3.test"}],"user":"standin"}\n' },
    'service/catalog.json': { text: '[]\n' }, 'service/worker.py': { text: '# stand-in worker\n' },
    'deploy/host-on-portal.sh': { text: INSTALLER_TEXT, mode: '100755' },
    'deploy/go-back.sh': { text: read(REPO, 'deploy', 'go-back.sh'), mode: '100755' },
    'deploy/RECOVERY.txt': { text: read(REPO, 'deploy', 'RECOVERY.txt') },
    'deploy/pull.sh': { text: `${PULL_TEXT}# tree ${n}\n`, mode: '100755' },
  };
  for (const u of UI_FILES) f[`public/${u}`] = { text: u === 'app.js' ? "const BUILD = 'dev';\n" : `${u} ${n}\n` };
  // The stand-in fleet's links, shaped as the repository's: one into the cache's blobs, one at /hf/ (a container path).
  Object.assign(f, { [`${HF}/blobs/cfg`]: { text: '{}\n' }, [`${HF}/snapshots/c1/config.json`]: { text: '../../blobs/cfg', mode: '120000' },
    [OVERLAY]: { text: '/hf/models--x--y/snapshots/c1/config.json', mode: '120000' } });
  return f;
}
function push(files, subject) {
  const c = commitOf(mainHead, files, subject);
  gh(['update-ref', 'refs/heads/main', c.commit]);
  mainHead = c.commit;
  return c;
}
// The mark job's tag: the commit plus the lock (lock fields and other files can be changed for the refusals).
function mark(c, { lock = {}, also = {} } = {}) {
  const L = { build: buildOf(c.files), testedAt: '2026-11-14T09:30:00.000Z', versions: { start_model: '24486d74dd19' }, tree: c.tree, commit: c.commit, ...lock };
  const t = commitOf(c.commit, { ...c.files, [LOCK]: { text: `${JSON.stringify(L, null, 2)}\n` }, ...also }, `Tested: build ${L.build}, tree ${c.t12}`);
  gh(['update-ref', `refs/tags/tested/${c.t12}`, t.commit]);
}

// ── Spark 2's stand-in: the stand-in systemd runs the installed server.mjs (as test/install.test.mjs does). ──
const RUNNER = `import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
const home = process.env.HOME, out = openSync(home + '/service.log', 'a');
let child = null, stopping = false;
const start = () => {
  child = spawn(process.execPath, [home + '/spark-console-service/server.mjs'], { cwd: home, stdio: ['ignore', out, out] });
  child.on('error', () => {});
  child.on('exit', () => { child = null; if (stopping) process.exit(0); setTimeout(() => { if (!stopping) start(); }, 1000); });
};
process.on('SIGTERM', () => { stopping = true; if (child) child.kill('SIGTERM'); else process.exit(0); setTimeout(() => process.exit(0), 3000); });
start();
`;
const SYSTEMCTL = `#!/bin/bash
echo "$*" >> "$HOME/systemctl.log"
verb=''; unit=''
for a in "$@"; do case "$a" in --user) ;; -*) ;; *) if [ -z "$verb" ]; then verb="$a"; else unit="$a"; fi ;; esac; done
[ "$unit" = spark-console-api ] || [ "$unit" = spark-console-api.service ] || exit 0
pidf="$HOME/runner.pid"
alive() { [ -f "$pidf" ] && kill -0 "$(cat "$pidf")" 2>/dev/null; }
stop_it() {
  if alive; then p=$(cat "$pidf"); kill -TERM "$p" 2>/dev/null
    for _ in $(seq 1 60); do kill -0 "$p" 2>/dev/null || break; sleep 0.1; done; fi
  rm -f "$pidf"
}
start_it() { alive && return 0; nohup node "$HOME/bin/runner.mjs" </dev/null >>"$HOME/runner.log" 2>&1 & echo $! > "$pidf"; }
case "$verb" in
  restart) stop_it; start_it ;;
  start) start_it ;;
  stop) stop_it ;;
  show) if alive; then echo active; else echo inactive; fi ;;
esac
exit 0
`;
function sparkTwo() {
  const home = shortHome('scp-'), bin = join(home, 'bin');
  for (const d of ['bin', 'run', 'tmp']) mkdirSync(join(home, d));
  writeFileSync(join(bin, 'runner.mjs'), RUNNER);
  sh(join(bin, 'systemctl'), SYSTEMCTL);
  for (const f of ['journalctl', 'logger']) sh(join(bin, f), '#!/bin/sh\nexit 0\n');
  sh(join(bin, 'loginctl'), '#!/bin/sh\necho yes\n');
  for (const f of ['ssh', 'sudo', 'tailscale', 'systemd-run']) sh(join(bin, f), `#!/bin/sh\necho "${f} $*" >> "$HOME/never-called.log"\nexit 97\n`);
  // (the installer's look for the retired web page: this Spark has no containers)
  sh(join(bin, 'docker'), '#!/bin/sh\nexit 0\n');
  // git as it is, with what each call was given on its command line and in GIT_CONFIG_VALUE_0 written down.
  sh(join(bin, 'git'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/git-args.log"\nprintf '%s\\n' "\${GIT_CONFIG_VALUE_0:-}" >> "$HOME/git-env.log"\nexec '${REAL_GIT}' "$@"\n`);
  if (!gnuTar) sh(join(bin, 'tar'), `#!/bin/bash
args=(); for a in "$@"; do case "$a" in --warning=*) ;; *) args+=("$a") ;; esac; done
PATH="\${PATH#*:}" exec tar "\${args[@]}"
`);
  if (!findPrintf) sh(join(bin, 'find'), `#!/bin/bash
args=(); base=''; skip=''
for a in "$@"; do
  if [ -n "$skip" ]; then skip=''; continue; fi
  case "$a" in -printf) base=1; skip=1 ;; *) args+=("$a") ;; esac
done
if [ -n "$base" ]; then PATH="\${PATH#*:}" find "\${args[@]}" | sed 's#.*/##'; else PATH="\${PATH#*:}" exec find "\${args[@]}"; fi
`);
  const state = join(home, '.local', 'state', 'spark-console');
  mkdirSync(state, { recursive: true, mode: 0o700 });
  writeFileSync(join(state, 'access.json'), '{"ownerLogin":"owner@test"}\n');
  // Telegram's entry, already in the secrets file.
  mkdirSync(join(home, '.config', 'spark-console'), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, '.config', 'spark-console', 'secrets.json'), '{"telegram":{"token":"tg-standin"}}\n', { mode: 0o600 });
  // The build that holds this step, installed from the Mac, left pull.sh at the fixed path.
  mkdirSync(join(home, '.local', 'share', 'spark-console'), { recursive: true, mode: 0o700 });
  copyFileSync(join(REPO, 'deploy', 'pull.sh'), join(home, '.local', 'share', 'spark-console', 'pull.sh'));
  chmodSync(join(home, '.local', 'share', 'spark-console', 'pull.sh'), 0o700);
  return home;
}
const envFor = (home, extra = {}) => ({ HOME: home, USER: 'standin', PATH: `${join(home, 'bin')}:${NODE_DIR}:${process.env.PATH}`, TMPDIR: join(home, 'tmp'),
  SPARK_CONSOLE_INSTALL_WAIT_S: String(6 * SLOW), SPARK_CONSOLE_INSTALL_SETTLE_S: '3', DBUS_SESSION_BUS_ADDRESS: '', XDG_RUNTIME_DIR: join(home, 'run'),
  LANG: 'C.UTF-8', SPARK_CONSOLE_ALL_LOCAL: '1', SPARK_CONSOLE_REPO_URL: GH, ...extra });
// The pull.sh at the fixed path, as the owner runs it.
function pull(home, args, { input = '', extra } = {}) {
  return new Promise(resolve => {
    const p = spawn('bash', [join(home, '.local', 'share', 'spark-console', 'pull.sh'), ...args], { env: envFor(home, extra), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += d; });
    p.stdin.end(input);
    p.on('close', code => resolve({ code, out }));
  });
}
const health = home => new Promise(resolve => {
  const req = http.get({ socketPath: join(home, '.local', 'state', 'spark-console', 'api.sock'), path: '/health', timeout: 2000 }, res => {
    let d = ''; res.on('data', c => { d += c; }); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
  });
  req.on('error', () => resolve(null));
  req.on('timeout', () => { req.destroy(); resolve(null); });
});
const fixedPull = home => read(home, '.local', 'share', 'spark-console', 'pull.sh');
const resultOf = home => JSON.parse(read(home, '.local', 'state', 'spark-console', 'update-result.json'));
const releases = home => { try { return readdirSync(join(home, '.local', 'share', 'spark-console', 'releases')).sort(); } catch { return []; } };
const lines = (home, f) => (existsSync(join(home, f)) ? read(home, f).split('\n').filter(Boolean) : []);
// What an install would change: the installed files, the snapshots, the service's restarts, the fixed pull.sh.
const installedNow = home => ({ server: existsSync(join(home, 'spark-console-service', 'server.mjs')) ? read(home, 'spark-console-service', 'server.mjs') : null,
  version: existsSync(join(home, 'spark-console', 'version.json')) ? read(home, 'spark-console', 'version.json') : null,
  releases: releases(home), systemctl: lines(home, 'systemctl.log').length, pull: fixedPull(home) });
function refused(home, r, tree, why, was) {
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, why);
  assert.match(r.out, /Nothing was changed\./);
  assert.deepEqual(installedNow(home), was, 'nothing installed changed');
  const res = resultOf(home);
  assert.deepEqual([res.tree, res.result], [tree, 'refused']);
  assert.match(res.why, why);
}

before(() => {
  WORK = mkdtempSync(join(tmpdir(), 'scp-gh-'));
  GH = join(WORK, 'gh.git');
  spawnSync(REAL_GIT, ['-c', 'init.defaultBranch=main', 'init', '-q', '--bare', GH], { env: GIT_ENV });
});
after(() => {
  for (const home of homes) {
    spawnSync('bash', [join(home, 'bin', 'systemctl'), '--user', 'stop', 'spark-console-api'], { env: envFor(home) });
    // Nothing that may never run here was called, in any case.
    assert.ok(!existsSync(join(home, 'never-called.log')), existsSync(join(home, 'never-called.log')) ? read(home, 'never-called.log') : '');
    rmSync(home, { recursive: true, force: true });
  }
  if (WORK) rmSync(WORK, { recursive: true, force: true });
});

const CASE = { timeout: 180000 * SLOW };
describe('pull.sh against a bare repository standing in for GitHub', { concurrency: 1 }, () => {
  let home, b1, b6, last;

  test('setup: the token is tried, then kept in the secrets file beside what was there; never on a command line or in git’s config', CASE, async () => {
    b1 = push(treeFiles(1), 'The first build');
    mark(b1);
    home = sparkTwo();
    const secrets = join(home, '.config', 'spark-console', 'secrets.json'), was = read(secrets);
    // Refused, with nothing saved: a name that isn't owner/repository; something that isn't a token; a secrets file
    // that can't be read (it is never written over).
    assert.equal((await pull(home, ['setup', 'not a repo'], { input: `${TOKEN}\n` })).code, 2);
    let r = await pull(home, ['setup', OWNER_REPO], { input: 'not a token\n' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /isn't a GitHub token/);
    assert.equal(read(secrets), was);
    writeFileSync(secrets, '{"telegram": ');
    r = await pull(home, ['setup', OWNER_REPO], { input: `${TOKEN}\n` });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /can't be read as it is, so it wasn't written over/);
    assert.equal(read(secrets), '{"telegram": ');
    writeFileSync(secrets, was);

    r = await pull(home, ['setup', OWNER_REPO], { input: `${TOKEN}\n` });
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(JSON.parse(read(secrets)), { telegram: { token: 'tg-standin' }, github: { repo: OWNER_REPO, token: TOKEN } });
    assert.equal(statSync(secrets).mode & 0o777, 0o600);
    assert.equal(statSync(dirname(secrets)).mode & 0o777, 0o700);
    // The bare copy holds main and the tag, and nowhere in it is the token.
    const repo = join(home, '.local', 'share', 'spark-console', 'repo.git');
    const local = args => spawnSync(REAL_GIT, ['-C', repo, ...args], { encoding: 'utf8', env: GIT_ENV }).stdout.trim();
    assert.equal(local(['rev-parse', '--is-bare-repository']), 'true');
    assert.equal(local(['rev-parse', 'refs/heads/main']), b1.commit);
    assert.equal(local(['rev-parse', `refs/tags/tested/${b1.t12}`]).length, 40);
    const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    for (const f of walk(repo)) assert.ok(!readFileSync(f).includes(TOKEN), `${f} holds the token`);
    // git got it only in its environment, as the header for github.com, never as an argument.
    assert.ok(lines(home, 'git-args.log').length > 0);
    assert.ok(!lines(home, 'git-args.log').some(l => l.includes(TOKEN)), 'the token on a command line');
    assert.ok(lines(home, 'git-env.log').includes(`Authorization: basic ${Buffer.from(`x-access-token:${TOKEN}`).toString('base64')}`));
    assert.match(r.out, new RegExp(`To install it: bash \\S+/pull\\.sh install ${b1.t12}`));
  });

  test('check: names what is installed and the newest tested build, and changes nothing', CASE, async () => {
    const was = installedNow(home);
    const r = await pull(home, ['check']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Installed: build -/);
    assert.match(r.out, new RegExp(`main: commit ${b1.commit.slice(0, 12)}, tree ${b1.t12}, tested\\.`));
    assert.match(r.out, new RegExp(`install ${b1.t12}`));
    assert.deepEqual(installedNow(home), was);
    assert.ok(!existsSync(join(home, '.local', 'state', 'spark-console', 'update-result.json')));
  });

  test('install: exactly the tagged tree goes in through its own installer and is kept; then pull.sh is its copy. No tailscale, sudo or ssh', CASE, async () => {
    const r = await pull(home, ['install', b1.t12]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /kept: build/);
    assert.match(r.out, /The \/console routes on port 8443 weren't checked \(SKIP_ROUTES=1/);
    assert.match(r.out, /Not checked here: whether this machine reaches the other Sparks \(SKIP_ROUTES=1/);
    assert.equal(read(home, 'spark-console-service', 'server.mjs'), b1.files['service/server.mjs'].text);
    assert.equal(JSON.parse(read(home, 'spark-console-service', 'workflows.lock.json')).tree, b1.tree);
    assert.equal((await health(home))?.build, buildOf(b1.files));
    assert.deepEqual((({ tree, build, result }) => ({ tree, build, result }))(resultOf(home)), { tree: b1.t12, build: buildOf(b1.files), result: 'kept' });
    assert.match(JSON.parse(read(home, '.local', 'state', 'spark-console', 'update-note.json')).note, new RegExp(`^Installed from GitHub with pull\\.sh: tree ${b1.t12}, commit ${b1.commit.slice(0, 12)}, tested at 2026-11-14T09:30:00\\.000Z\\.$`));
    // The kept build's pull.sh, renamed into place at the fixed path, owner-only.
    assert.equal(fixedPull(home), b1.files['deploy/pull.sh'].text);
    assert.equal(statSync(join(home, '.local', 'share', 'spark-console', 'pull.sh')).mode & 0o777, 0o700);
    assert.ok(existsSync(join(home, 'spark-console-src', 'deploy', 'pull.sh')));
    for (const [l, to] of [[`${HF}/snapshots/c1/config.json`, '../../blobs/cfg'], [OVERLAY, '/hf/models--x--y/snapshots/c1/config.json']]) {
      assert.ok(lstatSync(join(home, 'spark-console-src', l)).isSymbolicLink(), l);
      assert.equal(readlinkSync(join(home, 'spark-console-src', l)), to);
    }
    assert.ok(!existsSync(join(home, 'never-called.log')), existsSync(join(home, 'never-called.log')) ? read(home, 'never-called.log') : '');
  });

  test('install refuses, with nothing changed: an untagged head of main, a tag that changes other files, a lock for another tree or build', CASE, async () => {
    const was = installedNow(home);
    const b2 = push(treeFiles(2), 'Not tested yet');
    refused(home, await pull(home, ['install', b2.t12]), b2.t12, /head of main, has no tested\/[0-9a-f]{12} tag/, was);
    mark(b2, { also: { 'service/dig.mjs': { text: '// changed by the tag\n' } } });
    refused(home, await pull(home, ['install', b2.t12]), b2.t12, /changes more than adding service\/workflows\.lock\.json/, was);
    mark(b2, { lock: { tree: b1.tree } });
    refused(home, await pull(home, ['install', b2.t12]), b2.t12, new RegExp(`is for tree ${b1.t12}, not this tree`), was);
    mark(b2, { lock: { tree: undefined } });
    refused(home, await pull(home, ['install', b2.t12]), b2.t12, /names no tree/, was);
    mark(b2, { lock: { build: '000000000000' } });
    refused(home, await pull(home, ['install', b2.t12]), b2.t12, /is for build 000000000000, but this code is build/, was);
  });

  test('install refuses a link, a submodule, an export- attribute, an older tested tree and one only on another branch', CASE, async () => {
    const was = installedNow(home);
    const b3 = push({ ...treeFiles(3), 'public/icon-192.png': { text: '/proc/self/environ', mode: '120000' } }, 'A link');
    mark(b3);
    refused(home, await pull(home, ['install', b3.t12]), b3.t12, /holds a link that isn't allowed \(public\/icon-192\.png\)/, was);
    // Under test/mock/root/, but pointing out of it: by .. to elsewhere in the tree or out of it, outside /hf/, or out
    // of /hf/ by .. (the link sits ten folders deep).
    for (const [n, to] of [[30, `${'../'.repeat(10)}service/config.json`], [31, `${'../'.repeat(14)}etc/passwd`], [32, '/proc/self/environ'], [33, '/hf/../etc/passwd']]) {
      const b = push({ ...treeFiles(n), [`${HF}/snapshots/c1/config.json`]: { text: to, mode: '120000' } }, `A link out, ${n}`);
      mark(b);
      refused(home, await pull(home, ['install', b.t12]), b.t12, new RegExp(`holds a link that isn't allowed \\(${HF.replace(/[.]/g, '\\.')}/snapshots/c1/config\\.json\\)`), was);
    }
    const b4 = push({ ...treeFiles(4), 'vendor/thing': { mode: '160000', sha: b1.commit } }, 'A submodule');
    mark(b4);
    refused(home, await pull(home, ['install', b4.t12]), b4.t12, /isn't a file or a link \(vendor\/thing\): a submodule/, was);
    const b5 = push({ ...treeFiles(5), 'public/.gitattributes': { text: 'app.js export-subst\n' } }, 'An attribute');
    mark(b5);
    refused(home, await pull(home, ['install', b5.t12]), b5.t12, /public\/\.gitattributes with export-/, was);
    refused(home, await pull(home, ['install', b1.t12]), b1.t12, new RegExp(`older tested build\\. Only the newest tested build on main is installed from here: tree ${b5.t12}`), was);
    const side = commitOf(b1.commit, treeFiles(9), 'Only on a branch');
    mark(side);
    refused(home, await pull(home, ['install', side.t12]), side.t12, /has a tested\/ tag, but no commit on main holds it/, was);
    refused(home, await pull(home, ['install', 'abcdefabcdef']), 'abcdefabcdef', new RegExp(`no tested/abcdefabcdef tag\\. The newest tested build on main is tree ${b5.t12}`), was);
    // Not a tree's name at all: the usage line, and no record.
    const before = read(home, '.local', 'state', 'spark-console', 'update-result.json');
    for (const args of [['install'], ['install', 'main'], ['install', `${b5.t12}0`], ['fetch']]) assert.equal((await pull(home, args)).code, 2, args.join(' '));
    assert.equal(read(home, '.local', 'state', 'spark-console', 'update-result.json'), before);
    assert.deepEqual(installedNow(home), was);
  });

  test('a newer tested build is kept over the first, with a snapshot; one that dies goes back, and pull.sh stays the kept build’s', CASE, async () => {
    b6 = push(treeFiles(6), 'Good again');
    mark(b6);
    // check names it, with the subjects since the installed commit (newest first), and the command.
    let r = await pull(home, ['check']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, new RegExp(`Installed: build ${buildOf(b1.files)}, tree ${b1.t12}, commit ${b1.commit.slice(0, 12)}`));
    assert.match(r.out, /since the installed one[^\n]*\n {4}[0-9a-f]+ Good again\n {4}[0-9a-f]+ An attribute\n/);
    assert.match(r.out, new RegExp(`To install it: bash \\S+/pull\\.sh install ${b6.t12}`));
    const snaps = releases(home);
    r = await pull(home, ['install', b6.t12]);
    assert.equal(r.code, 0, r.out);
    assert.equal((await health(home))?.build, buildOf(b6.files));
    const added = releases(home).filter(s => !snaps.includes(s));
    assert.equal(added.length, 1);
    assert.equal(read(home, '.local', 'share', 'spark-console', 'releases', added[0], 'build').trim(), buildOf(b1.files));
    assert.equal(fixedPull(home), b6.files['deploy/pull.sh'].text);
    assert.equal(resultOf(home).result, 'kept');

    const b7 = push(treeFiles(7, 'dies'), 'One that dies');
    mark(b7);
    r = await pull(home, ['install', b7.t12]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /Not kept: the build answering now is [0-9a-f]{12}/);
    assert.equal((await health(home))?.build, buildOf(b6.files));
    assert.equal(read(home, 'spark-console-service', 'server.mjs'), b6.files['service/server.mjs'].text);
    assert.equal(fixedPull(home), b6.files['deploy/pull.sh'].text, 'a build that was not kept never replaces pull.sh');
    const res = resultOf(home);
    assert.deepEqual([res.tree, res.build, res.result], [b7.t12, buildOf(b7.files), 'not kept']);
    assert.match(res.why, new RegExp(`the build answering now is ${buildOf(b6.files)}, installed from tree ${b6.t12}$`));

    // The same service code (a page-only change): its installer refuses (Sparkie's model is down) and changes nothing,
    // and the build answering is still that build. Not "kept": the installed lock names the old tree.
    const b8 = push({ ...treeFiles(6), 'public/index.html': { text: 'a page-only change\n' } }, 'A page-only change');
    mark(b8);
    assert.equal(buildOf(b8.files), buildOf(b6.files));
    writeFileSync(join(home, 'brain-down'), '');
    r = await pull(home, ['install', b8.t12]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, new RegExp(`Not kept: the build answering now is ${buildOf(b6.files)}, installed from tree ${b6.t12}\\.`));
    assert.deepEqual([resultOf(home).tree, resultOf(home).result], [b8.t12, 'not kept']);
    assert.match(resultOf(home).why, /Sparkie's model isn't answering right now/);
    unlinkSync(join(home, 'brain-down'));
    r = await pull(home, ['install', b8.t12]);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual([resultOf(home).tree, resultOf(home).result], [b8.t12, 'kept']);
    assert.equal(JSON.parse(read(home, 'spark-console-service', 'workflows.lock.json')).tree, b8.tree);
    last = b8;
  });

  test('main moved as tools/land.mjs moves it (a merge onto the branch, then a fast-forward): the newest tested build is the head before; never older than the installed one', CASE, async () => {
    // A step's branch starts from main; another step lands, tested, and is installed; the step then merges main in
    // (first parent its own branch) and main fast-forwards to that merge, not tested yet.
    const step = commitOf(last.commit, treeFiles(10), 'A step, on its own branch');
    const h1 = push(treeFiles(11), 'Another step lands');
    mark(h1);
    let r = await pull(home, ['install', h1.t12]);
    assert.equal(r.code, 0, r.out);
    const merged = commitOf([step.commit, h1.commit], treeFiles(12), "Merge main into the step's branch");
    gh(['update-ref', 'refs/heads/main', merged.commit]);
    mainHead = merged.commit;
    const was = installedNow(home);
    r = await pull(home, ['check']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, new RegExp(`main: commit ${merged.commit.slice(0, 12)}, tree ${merged.t12}, not tested yet`));
    assert.match(r.out, new RegExp(`The newest tested build on main \\(tree ${h1.t12}\\) is the one installed\\.`));
    assert.doesNotMatch(r.out, /To install it/);
    // The build before it on the step's own line is older: refused, not installed over the newer one.
    refused(home, await pull(home, ['install', last.t12]), last.t12, new RegExp(`older tested build\\. Only the newest tested build on main is installed from here: tree ${h1.t12}`), was);
    // Installed from the Mac ahead of GitHub's mark (its lock names the merge): the newest tested build is older, so
    // check offers nothing and install refuses it.
    const lockFile = join(home, 'spark-console-service', 'workflows.lock.json'), lock = read(lockFile);
    writeFileSync(lockFile, JSON.stringify({ ...JSON.parse(lock), tree: merged.tree, commit: merged.commit }));
    try {
      r = await pull(home, ['check']);
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, new RegExp(`It is not newer than the installed build \\(commit ${merged.commit.slice(0, 12)}\\), so there is nothing to install from here\\.`));
      assert.doesNotMatch(r.out, /To install it/);
      refused(home, await pull(home, ['install', h1.t12]), h1.t12, new RegExp(`isn't newer than the installed build \\(commit ${merged.commit.slice(0, 12)}\\)`), was);
    } finally { writeFileSync(lockFile, lock); }
  });
});
