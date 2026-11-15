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
// The way back (C4b, the second describe): armed from the installed build before the new one's installer runs, and
// gone after either ending; refused with nothing changed when its timer can't start or the real address doesn't answer
// for the build running now; the build from before back and answering when the new one never answers, when its own
// installer keeps a dead build or its own put-back does nothing, when it calls tailscale despite SKIP_ROUTES, when the
// real address stops answering or answers 502 after the install, and after a restart of Spark 2 in the middle. R53: with
// a `.curlrc` and a user-site `.pth` in Spark 2's home, setup, check, an install kept through the way back and one put
// back by it read neither (pull.sh, update-guard.sh and the installer run Python as -I and curl as -q).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, statSync, lstatSync, readlinkSync, copyFileSync, chmodSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { REPO, MOCK } from './start-mock.mjs';
import { SLOW, waitFor } from './lib.mjs';

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
function treeFiles(n, mode = 'good', { installer = INSTALLER_TEXT } = {}) {
  const server = `const MODE = '${mode}'; // ${n}\n${STANDIN}`;
  const f = {
    'service/src/00-standin.mjs': { text: server }, 'service/server.mjs': { text: server },
    'service/dig.mjs': { text: '// stand-in dig.mjs\n' }, 'service/passkey.mjs': { text: '// stand-in passkey.mjs\n' },
    // (a Spark to reach over ssh: the installer must not try it here)
    'service/config.json': { text: '{"nodes":[{"id":"spark2","host":"local"},{"id":"spark3","host":"spark3.test"}],"user":"standin"}\n' },
    'service/catalog.json': { text: '[]\n' }, 'service/worker.py': { text: '# stand-in worker\n' },
    'deploy/host-on-portal.sh': { text: installer, mode: '100755' },
    'deploy/update-guard.sh': { text: read(REPO, 'deploy', 'update-guard.sh'), mode: '100755' },
    'deploy/go-back.sh': { text: read(REPO, 'deploy', 'go-back.sh'), mode: '100755' },
    'deploy/RECOVERY.txt': { text: read(REPO, 'deploy', 'RECOVERY.txt') },
    'deploy/path-check.sh': { text: read(REPO, 'deploy', 'path-check.sh'), mode: '100755' },
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
# The update guard's timer: started, it runs its service's ExecStart once OnActiveSec has passed (and is then done);
# enabled, the test's reboot starts it again; $HOME/fail-guard makes it fail to start.
if [ "$unit" = spark-console-update-guard.timer ]; then
  tf="$HOME/.config/systemd/user/spark-console-update-guard.timer"; sf="$HOME/.config/systemd/user/spark-console-update-guard.service"
  tp="$HOME/guard-timer.pid"
  talive() { [ -f "$tp" ] && kill -0 "$(cat "$tp")" 2>/dev/null; }
  tstop() { if talive; then kill -KILL "$(cat "$tp")" 2>/dev/null; fi; rm -f "$tp"; }
  case "$verb" in
    enable|start|restart)
      [ ! -f "$HOME/fail-guard" ] || exit 1
      [ "$verb" != enable ] || : > "$HOME/guard-enabled"
      tstop
      s=$(sed -n 's/^OnActiveSec=\\([0-9]*\\)s$/\\1/p' "$tf"); c=$(sed -n 's/^ExecStart=//p' "$sf" | sed "s#%h#$HOME#g")
      nohup bash -c "sleep $s; rm -f '$tp'; echo fired >> '$HOME/guard-fired.log'; $c" </dev/null >>"$HOME/guard-timer.log" 2>&1 &
      echo $! > "$tp" ;;
    stop) tstop ;;
    disable) tstop; rm -f "$HOME/guard-enabled" ;;
    is-active) talive; exit $? ;;
  esac
  exit 0
fi
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
// The real address's stand-in, one a home, as Tailscale serve routes it: /console/api/… to the console's socket, the
// rest to the page's folder. $HOME/door-down: no answer at all; $HOME/door-502: the API route answers 502;
// $HOME/door-funnel: /health is the console's own answer cut to {"ok":true}, as through Funnel (502 when the console
// is down, as Tailscale answers then); $HOME/door-kill-console: the next /health asked there stops the console first
// (once); $HOME/door-stale-page: every version.json is
// that file's text. Each path asked is written to $HOME/door.log.
const doors = new Map();
function startDoor(home) {
  const server = http.createServer((req, res) => {
    if (existsSync(join(home, 'door-down'))) { req.socket.destroy(); return; }
    const path = new URL(req.url, 'http://door').pathname;
    try { writeFileSync(join(home, 'door.log'), `${path}\n`, { flag: 'a' }); } catch {}
    if (path === '/console/api/health' && existsSync(join(home, 'door-kill-console'))) {
      rmSync(join(home, 'door-kill-console'));
      spawnSync('bash', [join(home, 'bin', 'systemctl'), '--user', 'stop', 'spark-console-api'], { env: envFor(home) });
    }
    if (path === '/console/api/health' && existsSync(join(home, 'door-funnel'))) {
      const up = http.get({ socketPath: join(home, '.local', 'state', 'spark-console', 'api.sock'), path: '/health' }, r => {
        let d = '';
        r.on('data', c => { d += c; });
        r.on('end', () => { let ok = false; try { ok = JSON.parse(d).ok === true; } catch {} res.writeHead(ok ? 200 : 502); res.end(ok ? '{"ok":true}' : 'Bad Gateway'); });
      });
      up.on('error', () => { res.writeHead(502); res.end('Bad Gateway'); });
      return;
    }
    if (path.endsWith('version.json') && existsSync(join(home, 'door-stale-page'))) { res.writeHead(200); res.end(readFileSync(join(home, 'door-stale-page'))); return; }
    if (path.startsWith('/console/api/')) {
      if (existsSync(join(home, 'door-502'))) { res.writeHead(502); res.end('Bad Gateway'); return; }
      const up = http.request({ socketPath: join(home, '.local', 'state', 'spark-console', 'api.sock'), path: path.slice('/console/api'.length), method: req.method }, r => {
        res.writeHead(r.statusCode, r.headers); r.pipe(res);
      });
      up.on('error', () => { res.writeHead(502); res.end(); });
      req.pipe(up);
      return;
    }
    const rel = path.replace(/^\/console\//, '/').replace(/\/$/, '/index.html');
    try { const body = readFileSync(join(home, 'spark-console', rel)); res.writeHead(200); res.end(body); } catch { res.writeHead(404); res.end(); }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => { doors.set(home, server); resolve(); }));
}
async function sparkTwo() {
  const home = shortHome('scp-'), bin = join(home, 'bin');
  await startDoor(home);
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
  for (const f of ['pull.sh', 'update-guard.sh']) {
    copyFileSync(join(REPO, 'deploy', f), join(home, '.local', 'share', 'spark-console', f));
    chmodSync(join(home, '.local', 'share', 'spark-console', f), 0o700);
  }
  return home;
}
const envFor = (home, extra = {}) => ({ HOME: home, USER: 'standin', PATH: `${join(home, 'bin')}:${NODE_DIR}:${process.env.PATH}`, TMPDIR: join(home, 'tmp'),
  SPARK_CONSOLE_INSTALL_WAIT_S: String(6 * SLOW), SPARK_CONSOLE_INSTALL_SETTLE_S: '3', DBUS_SESSION_BUS_ADDRESS: '', XDG_RUNTIME_DIR: join(home, 'run'),
  LANG: 'C.UTF-8', SPARK_CONSOLE_ALL_LOCAL: '1', SPARK_CONSOLE_REPO_URL: GH,
  SPARK_CONSOLE_DOOR_URL: doors.has(home) ? `http://127.0.0.1:${doors.get(home).address().port}` : '',
  SPARK_CONSOLE_UPDATE_GUARD_S: String(120 * SLOW), SPARK_CONSOLE_UPDATE_CONFIRM_S: String(20 * SLOW), ...extra });
// The pull.sh at the fixed path, as the owner runs it.
// onOut(all output so far, the child) is called as output comes; detached runs it in a process group of its own.
function pull(home, args, { input = '', extra, onOut = null, detached = false } = {}) {
  return new Promise(resolve => {
    const p = spawn('bash', [join(home, '.local', 'share', 'spark-console', 'pull.sh'), ...args], { env: envFor(home, extra), stdio: ['pipe', 'pipe', 'pipe'], detached });
    let out = '';
    p.stdout.on('data', d => { out += d; onOut?.(out, p); });
    p.stderr.on('data', d => { out += d; onOut?.(out, p); });
    // A pull.sh that stops before it reads (a bad repository name) has closed its end; on a loaded machine the write
    // can come after that and before node has seen it exit. That is the script's answer, not the test's error.
    p.stdin.on('error', e => { if (e.code !== 'EPIPE') throw e; });
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
    spawnSync('bash', [join(home, 'bin', 'systemctl'), '--user', 'stop', 'spark-console-update-guard.timer'], { env: envFor(home) });
    doors.get(home)?.close();
    // Nothing that may never run here was called, in any case.
    assert.ok(!existsSync(join(home, 'never-called.log')), existsSync(join(home, 'never-called.log')) ? read(home, 'never-called.log') : '');
    rmSync(home, { recursive: true, force: true });
  }
  if (WORK) rmSync(WORK, { recursive: true, force: true });
});

const CASE = { timeout: 180000 * SLOW };
describe('pull.sh against a bare repository standing in for GitHub', { concurrency: 1 }, () => {
  let home, b1, b6, last;
  // The cases build on each other (one Spark 2, one history). Each marks that it ran to its end; one that needs an
  // earlier case says so plainly instead of failing on what that case would have left behind.
  const ran = new Set();
  const needs = (...cases) => { for (const c of cases) assert.ok(ran.has(c), `The ${c} case didn't run to its end, so this one can't run: read that case's failure.`); };

  test('setup: the token is tried, then kept in the secrets file beside what was there; never on a command line or in git’s config', CASE, async () => {
    b1 = push(treeFiles(1), 'The first build');
    mark(b1);
    home = await sparkTwo();
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
    ran.add('setup');
  });

  test('check: names what is installed and the newest tested build, and changes nothing', CASE, async () => {
    needs('setup');
    const was = installedNow(home);
    const r = await pull(home, ['check']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Installed: build -/);
    assert.match(r.out, new RegExp(`main: commit ${b1.commit.slice(0, 12)}, tree ${b1.t12}, tested\\.`));
    assert.match(r.out, new RegExp(`install ${b1.t12}`));
    assert.deepEqual(installedNow(home), was);
    assert.ok(!existsSync(join(home, '.local', 'state', 'spark-console', 'update-result.json')));
    ran.add('check');
  });

  test('install: exactly the tagged tree goes in through its own installer and is kept; then pull.sh is its copy. No tailscale, sudo or ssh', CASE, async () => {
    needs('setup');
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
    ran.add('install');
  });

  test('install refuses, with nothing changed: an untagged head of main, a tag that changes other files, a lock for another tree or build', CASE, async () => {
    needs('setup');
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
    ran.add('refusals');
  });

  test('install refuses a link, a submodule, an export- attribute, an older tested tree and one only on another branch', CASE, async () => {
    needs('setup');
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
    ran.add('more refusals');
  });

  test('a newer tested build is kept over the first, with a snapshot; one that dies goes back, and pull.sh stays the kept build’s', CASE, async () => {
    needs('install', 'more refusals');
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
    ran.add('newer');
  });

  test('main moved as tools/land.mjs moves it (a merge onto the branch, then a fast-forward): the newest tested build is the head before; never older than the installed one', CASE, async () => {
    needs('newer');
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

// Installers of a tree's own that misbehave, made from this tree's.
const variant = (text, from, to) => { assert.ok(text.includes(from), from); return text.replace(from, to); };
const MISS = `miss() {
  echo "  The new build ($API_BUILD) didn't pass: $1. Its last log lines:" >&2
  journalctl --user -u spark-console-api -n 30 --no-pager 2>&1 | sed 's/^/    /' >&2 || true
  exit 1
}`;
// (its checks taken out: it keeps whatever it installed)
const NO_CHECKS = variant(INSTALLER_TEXT, MISS, 'miss() { echo "  (this installer\'s checks are taken out: $1)"; }');
// (its own put-back does nothing, and says the previous version is back)
const NO_PUT_BACK = variant(INSTALLER_TEXT, 'bash "$SNAP/restore.sh" > "$SNAP/restore.log" 2>&1; back=$?', ': > "$SNAP/restore.log"; back=0');
// (it leaves no version.json: the page isn't served as the new one)
const NO_VERSION = variant(INSTALLER_TEXT, 'cp "$IN/ui/version.json" "$HOME/spark-console/"', 'rm -f "$HOME/spark-console/version.json"');
// (it checks the routes whatever SKIP_ROUTES says)
const ROUTES_ANYWAY = variant(INSTALLER_TEXT, 'if [ "${SKIP_ROUTES:-}" = 1 ]; then echo "The /console routes', 'if false; then echo "The /console routes');

describe('the way back for an update from GitHub, armed by the build installed now', { concurrency: 1 }, () => {
  let home, base;
  const ran = new Set();
  const needs = (...cases) => { for (const c of cases) assert.ok(ran.has(c), `The ${c} case didn't run to its end, so this one can't run: read that case's failure.`); };
  const sysctl = (...a) => spawnSync('bash', [join(home, 'bin', 'systemctl'), '--user', ...a], { env: envFor(home), encoding: 'utf8' });
  const share = (...p) => join(home, '.local', 'share', 'spark-console', ...p);
  const mark0 = () => (existsSync(share('install-mark')) ? read(share('install-mark')) : null);
  // Nothing armed: no copy, no timer unit, not enabled, not running.
  function nothingArmed() {
    assert.ok(!existsSync(share('update-guard')), 'the copy of the build from before is gone');
    for (const u of ['spark-console-update-guard.timer', 'spark-console-update-guard.service']) {
      assert.ok(!existsSync(join(home, '.config', 'systemd', 'user', u)), `${u} is gone`);
    }
    assert.ok(!existsSync(join(home, 'guard-enabled')), 'the timer is not enabled');
    assert.notEqual(sysctl('is-active', '--quiet', 'spark-console-update-guard.timer').status, 0, 'the timer is not running');
  }
  // The build from before answers again, with its files, its pull.sh and its install mark.
  async function fromBefore(r, mark) {
    assert.equal((await health(home))?.build, buildOf(base.files), r.out);
    assert.equal(read(home, 'spark-console-service', 'server.mjs'), base.files['service/server.mjs'].text);
    assert.equal(fixedPull(home), base.files['deploy/pull.sh'].text);
    assert.equal(mark0(), mark);
    nothingArmed();
  }

  test('kept: armed before the new build\'s installer runs, confirmed through the real address, and nothing left armed', CASE, async () => {
    const g0 = push(treeFiles(40), 'The first build here');
    mark(g0);
    home = await sparkTwo();
    assert.equal((await pull(home, ['setup', OWNER_REPO], { input: `${TOKEN}\n` })).code, 0);
    let r = await pull(home, ['install', g0.t12]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /isn't answering now, so there is no working build to go back to/);
    nothingArmed();
    base = push(treeFiles(41), 'A second build');
    mark(base);
    const from = lines(home, 'systemctl.log').length;
    r = await pull(home, ['install', base.t12]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /The way back is armed/);
    assert.match(r.out, /Through the real address: the new build answers, and its page is served\./);
    const calls = lines(home, 'systemctl.log').slice(from), at = re => calls.findIndex(l => re.test(l));
    const armed = at(/enable --now spark-console-update-guard\.timer/), restarted = at(/restart spark-console-api$/), disarmed = at(/disable --now spark-console-update-guard\.timer/);
    assert.ok(armed >= 0 && armed < restarted && restarted < disarmed, calls.join('\n'));
    assert.equal((await health(home))?.build, buildOf(base.files));
    assert.deepEqual([resultOf(home).tree, resultOf(home).result], [base.t12, 'kept']);
    assert.match(resultOf(home).why, /the real address answers with it/);
    assert.ok(lines(home, 'door.log').filter(l => l === '/console/api/health').length >= 2, 'asked through the real address before and after');
    nothingArmed();
    ran.add('kept');
  });

  test('refused, nothing changed and nothing armed: the timer can\'t start; the real address doesn\'t answer for the build running now', CASE, async () => {
    needs('kept');
    const g = push(treeFiles(42), 'Refused twice');
    mark(g);
    const was = { server: read(home, 'spark-console-service', 'server.mjs'), releases: releases(home), mark: mark0() };
    writeFileSync(join(home, 'fail-guard'), '');
    let r = await pull(home, ['install', g.t12]);
    unlinkSync(join(home, 'fail-guard'));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /couldn't be started in your systemd/);
    assert.match(r.out, /The way back couldn't be armed \(see above\), so the new build wasn't installed\. Nothing was changed\./);
    assert.deepEqual({ server: read(home, 'spark-console-service', 'server.mjs'), releases: releases(home), mark: mark0() }, was);
    assert.deepEqual([resultOf(home).tree, resultOf(home).result], [g.t12, 'refused']);
    nothingArmed();
    writeFileSync(join(home, 'door-down'), '');
    r = await pull(home, ['install', g.t12]);
    unlinkSync(join(home, 'door-down'));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /The real address \(http:\/\/127\.0\.0\.1:\d+\) doesn't answer with the build running now \([0-9a-f]{12}; it answered nothing\), so a new build couldn't be confirmed through it\. Nothing was changed\./);
    assert.deepEqual({ server: read(home, 'spark-console-service', 'server.mjs'), releases: releases(home), mark: mark0() }, was);
    assert.equal((await health(home))?.build, buildOf(base.files));
    nothingArmed();
    ran.add('refused');
  });

  test('not kept, the build from before back and answering: one that never answers; one its installer keeps with its checks taken out; one whose installer\'s put-back does nothing', CASE, async () => {
    needs('kept');
    for (const [n, installer, why] of [[43, INSTALLER_TEXT, /The update was not kept/], [44, NO_CHECKS, /its installer said it kept build [0-9a-f]{12}, but the build answering is none/],
      [45, NO_PUT_BACK, /The update was not kept\. The previous version is running again/]]) {
      const g = push(treeFiles(n, 'dead', { installer }), `Never answers, ${n}`);
      mark(g);
      const mk = mark0(), r = await pull(home, ['install', g.t12]);
      assert.equal(r.code, 1, r.out);
      assert.deepEqual([resultOf(home).tree, resultOf(home).result], [g.t12, 'not kept']);
      assert.match(resultOf(home).why, why);
      await fromBefore(r, mk);
    }
    ran.add('not kept');
  });

  test('SKIP_ROUTES enforced, not trusted: an installer that checks the routes anyway is refused tailscale, and its build doesn\'t stay', CASE, async () => {
    needs('kept');
    const g = push(treeFiles(46, 'good', { installer: ROUTES_ANYWAY }), 'Routes anyway');
    mark(g);
    const mk = mark0(), r = await pull(home, ['install', g.t12]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /Not kept: its installer ran tailscale, which an install from pull\.sh never does \(refused\)/);
    assert.match(resultOf(home).why, /its installer ran tailscale, which an install from pull\.sh never does \(refused\)/);
    await fromBefore(r, mk);
    assert.ok(!existsSync(join(home, 'never-called.log')), 'the stand-in tailscale was never reached');
  });

  test('the real address stops answering after the install (no proof against the build), or answers 502: not kept, the build from before back', CASE, async () => {
    needs('kept');
    for (const [n, flag, why] of [[47, 'door-down', /the real address \(http:\/\/127\.0\.0\.1:\d+\) didn't answer at all in the 4 seconds after the install\. That isn't proof the new build is bad/],
      [49, 'door-502', /through the real address \(http:\/\/127\.0\.0\.1:\d+\) the new build didn't answer as itself in 4 seconds \(its service answered nothing\)/]]) {
      const g = push(treeFiles(n), `The address goes, ${n}`);
      mark(g);
      const mk = mark0(), r = await pull(home, ['install', g.t12], { extra: { SPARK_CONSOLE_UPDATE_CONFIRM_S: '4' },
        onOut: out => { if (out.includes('Installing tree') && !existsSync(join(home, flag))) writeFileSync(join(home, flag), ''); } });
      unlinkSync(join(home, flag));
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /kept: build [0-9a-f]{12} passed its checks/, 'its own installer had kept it');
      assert.match(resultOf(home).why, why);
      await fromBefore(r, mk);
    }
  });

  test('Spark 2 restarts in the middle: the new build runs unconfirmed until the timer, armed again at the start, puts the build from before back; nothing is left armed', { timeout: 300000 * SLOW }, async () => {
    needs('kept');
    const g = push(treeFiles(48), 'Cut by a restart');
    mark(g);
    const mk = mark0(), down = join(home, 'door-down');
    let child = null, stage = 0;
    const done = pull(home, ['install', g.t12], { detached: true, extra: { SPARK_CONSOLE_UPDATE_GUARD_S: String(30 * SLOW) }, onOut: (out, p) => {
      child = p;
      if (stage === 0 && out.includes('Installing tree')) { stage = 1; writeFileSync(down, ''); }
      if (stage === 1 && out.includes('Checking the new build through the real address')) stage = 2;
    } });
    let ended = null;
    done.then(r => { ended = r; });
    await waitFor(() => stage === 2 || ended, { timeout: 120000 * SLOW, what: 'its installer done, and pull.sh waiting on the real address' });
    assert.equal(ended, null, `pull.sh ended before the restart: ${ended?.out}`);
    // The power goes: pull.sh and everything it started stop at once, the console and the timer's wait included.
    process.kill(-child.pid, 'SIGKILL');
    await done;
    unlinkSync(down);
    // The restart: the user's services start again, the console (the new build's files are in place) and the timer,
    // which was enabled.
    assert.ok(existsSync(join(home, 'guard-enabled')), 'the timer is enabled, so it starts with the user\'s services');
    sysctl('start', 'spark-console-api');
    sysctl('start', 'spark-console-update-guard.timer');
    await waitFor(async () => (await health(home))?.build === buildOf(g.files), { timeout: 30000 * SLOW, what: 'the new build answering, unconfirmed' });
    await waitFor(async () => (await health(home))?.build === buildOf(base.files) && !existsSync(share('update-guard')),
      { timeout: (30 * SLOW + 60) * 1000, what: 'the build from before, put back by the timer' });
    const res = resultOf(home);
    assert.deepEqual([res.tree, res.build, res.result], [g.t12, buildOf(g.files), 'not kept']);
    assert.match(res.why, new RegExp(`^nothing confirmed the new build through the real address in time; the build from before \\(${buildOf(base.files)}\\) was put back and answers$`));
    assert.deepEqual(lines(home, 'guard-fired.log'), ['fired']);
    await fromBefore({ out: res.why }, mk);
  });

  // (the review of C4b: each case below failed before its fix)
  const HAND = ['go-back.sh', 'RECOVERY.txt', 'pull.sh', 'update-guard.sh', 'watchdog.sh', 'install-mark'];
  const hand = () => Object.fromEntries(HAND.map(f => [f, existsSync(share(f)) ? read(share(f)) : null]));
  const bash = (...a) => spawnSync('bash', a, { env: envFor(home), encoding: 'utf8' });
  // (a process group that is never this test's: inside a container the test's own can be 1)
  const OTHER_PGID = '2147483646';

  test('a copy that isn\'t whole is never put back from: by hand it says so and changes nothing; a half-made one is cleared by the next install', CASE, async () => {
    needs('kept');
    const was = { server: read(home, 'spark-console-service', 'server.mjs'), hand: hand() };
    assert.ok(Object.values(was.hand).every(Boolean), JSON.stringify(Object.keys(was.hand).filter(f => !was.hand[f])));
    let r = bash(share('update-guard.sh'), 'arm', 'abcdefabcdef', '0123456789ab', buildOf(base.files), OTHER_PGID);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    // Cut off while it was being removed: its guard file, its by-hand files and its server.mjs already gone.
    rmSync(share('update-guard', 'guard'));
    rmSync(share('update-guard', 'share'), { recursive: true });
    rmSync(share('update-guard', 'service', 'server.mjs'));
    r = bash(share('update-guard', 'update-guard.sh'), 'put-back', 'hand');
    assert.notEqual(r.status, 0, r.stdout);
    assert.match(r.stdout, /isn't whole .* so nothing is put back from it\. It is removed\./);
    assert.deepEqual({ server: read(home, 'spark-console-service', 'server.mjs'), hand: hand() }, was);
    assert.equal((await health(home))?.build, buildOf(base.files));
    nothingArmed();
    // Half-made (cut off while arm copied): only the page's copy. The next install clears it and arms its own.
    mkdirSync(share('update-guard', 'ui'), { recursive: true });
    const g = push(treeFiles(50), 'After a half-made copy');
    mark(g);
    r = await pull(home, ['install', g.t12]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /The way back is armed/);
    nothingArmed();
    base = g;
  });

  test('through Funnel /health is only {"ok":true}: kept when the page\'s version.json there names the new page, put back when it names the old one', CASE, async () => {
    needs('kept');
    writeFileSync(join(home, 'door-funnel'), '');
    try {
      const g = push(treeFiles(51), 'Through Funnel, kept');
      mark(g);
      let r = await pull(home, ['install', g.t12]);
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /Through the real address: a service answers, and the new page is served\./);
      assert.equal((await health(home))?.build, buildOf(g.files));
      nothingArmed();
      base = g;
      const g2 = push(treeFiles(52), 'Through Funnel, the old page');
      mark(g2);
      writeFileSync(join(home, 'door-stale-page'), read(home, 'spark-console', 'version.json'));
      const mk = mark0();
      r = await pull(home, ['install', g2.t12], { extra: { SPARK_CONSOLE_UPDATE_CONFIRM_S: '4' } });
      assert.equal(r.code, 1, r.out);
      assert.match(resultOf(home).why, /the new build didn't answer as itself in 4 seconds \(its service answered ok\)/);
      await fromBefore(r, mk);
    } finally { rmSync(join(home, 'door-funnel'), { force: true }); rmSync(join(home, 'door-stale-page'), { force: true }); }
  });

  test('a build installed but silent on its socket: no install starts unguarded; refused, nothing changed', CASE, async () => {
    needs('kept');
    const g = push(treeFiles(53), 'Over a silent build');
    mark(g);
    sysctl('stop', 'spark-console-api');
    try {
      const was = read(home, 'spark-console-service', 'server.mjs'), r = await pull(home, ['install', g.t12]);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /installed but doesn't answer on its socket, so the way back couldn't be armed .*Nothing was changed\./);
      assert.equal(read(home, 'spark-console-service', 'server.mjs'), was);
      assert.deepEqual([resultOf(home).tree, resultOf(home).result], [g.t12, 'refused']);
      nothingArmed();
    } finally { sysctl('start', 'spark-console-api'); }
    await waitFor(async () => (await health(home))?.build === buildOf(base.files), { timeout: 30000 * SLOW, what: 'the build answering again' });
  });

  test('a put-back whose build from before stays silent: the result says so (not the last install\'s "kept")', CASE, async () => {
    needs('kept');
    const g = push(treeFiles(54, 'dead'), 'Back to a silent build');
    mark(g);
    // The copy of the build from before turns out dead too.
    const r = await pull(home, ['install', g.t12], { onOut: out => {
      const copy = share('update-guard', 'service', 'server.mjs');
      if (out.includes('Installing tree') && existsSync(copy) && !read(copy).startsWith("const MODE = 'dead'")) writeFileSync(copy, `const MODE = 'dead'; // copy\n${STANDIN}`);
    } });
    try {
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /put back, but it doesn't answer/);
      const res = resultOf(home);
      assert.deepEqual([res.tree, res.result], [g.t12, 'not kept']);
      assert.match(res.why, new RegExp(`the build answering now is none, installed from tree ${base.t12}$`));
      nothingArmed();
    } finally {
      writeFileSync(join(home, 'spark-console-service', 'server.mjs'), base.files['service/server.mjs'].text);
      sysctl('restart', 'spark-console-api');
      await waitFor(async () => (await health(home))?.build === buildOf(base.files), { timeout: 30000 * SLOW, what: 'the build from before answering again' });
    }
  });

  test('an install made outside an armed update (from the Mac, or by hand) disarms that update\'s way back first, so its timer can\'t undo it', CASE, async () => {
    needs('kept');
    let r = bash(share('update-guard.sh'), 'arm', 'abcdefabcdef', '0123456789ab', buildOf(base.files), OTHER_PGID);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const g = push(treeFiles(55), 'Installed by hand');
    const dir = join(home, 'tmp', 'by-hand');
    mkdirSync(dir);
    const x = spawnSync('sh', ['-c', `'${REAL_GIT}' --git-dir '${GH}' archive ${g.commit} | tar -x -C '${dir}'`], { env: GIT_ENV, encoding: 'utf8' });
    assert.equal(x.status, 0, x.stderr);
    writeFileSync(join(dir, 'service', 'workflows.lock.json'), JSON.stringify({ build: buildOf(g.files), versions: {} }));
    r = await new Promise(resolve => {
      const p = spawn('bash', [join(dir, 'deploy', 'host-on-portal.sh'), 'local'], { env: envFor(home, { SKIP_ROUTES: '1', ASSUME_YES: '1' }), stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      p.stdout.on('data', d => { stdout += d; });
      p.stderr.on('data', d => { stdout += d; });
      p.on('close', status => resolve({ status, stdout, stderr: '' }));
    });
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /An update from GitHub left its way back armed; this install takes over, so it is disarmed first\./);
    assert.equal((await health(home))?.build, buildOf(g.files), r.stdout.slice(-1500));
    nothingArmed();
    rmSync(dir, { recursive: true, force: true });
    base = g;
  });

  // (the second read of C4b, its Later list: each case below failed before its change)
  // A tree installed by hand, outside pull.sh (as from the Mac): its own installer, run with `local`.
  async function byHand(g) {
    const dir = join(home, 'tmp', `by-hand-${g.t12}`);
    mkdirSync(dir);
    const x = spawnSync('sh', ['-c', `'${REAL_GIT}' --git-dir '${GH}' archive ${g.commit} | tar -x -C '${dir}'`], { env: GIT_ENV, encoding: 'utf8' });
    assert.equal(x.status, 0, x.stderr);
    writeFileSync(join(dir, 'service', 'workflows.lock.json'), JSON.stringify({ build: buildOf(g.files), versions: {} }));
    const r = await new Promise(resolve => {
      const p = spawn('bash', [join(dir, 'deploy', 'host-on-portal.sh'), 'local'], { env: envFor(home, { SKIP_ROUTES: '1', ASSUME_YES: '1' }), stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      p.stdout.on('data', d => { out += d; });
      p.stderr.on('data', d => { out += d; });
      p.on('close', code => resolve({ code, out }));
    });
    rmSync(dir, { recursive: true, force: true });
    return r;
  }

  test('the console stops after its installer kept it, on both legs (its own /health, and through Funnel): not kept, the build from before back', CASE, async () => {
    needs('kept');
    for (const [n, funnel] of [[56, false], [57, true]]) {
      if (funnel) writeFileSync(join(home, 'door-funnel'), '');
      try {
        const g = push(treeFiles(n), `The console stops, ${n}`);
        mark(g);
        let flagged = false;
        const mk = mark0(), r = await pull(home, ['install', g.t12], { extra: { SPARK_CONSOLE_UPDATE_CONFIRM_S: '4' }, onOut: out => {
          if (!flagged && out.includes('Installing tree')) { flagged = true; writeFileSync(join(home, 'door-kill-console'), ''); }
        } });
        assert.equal(r.code, 1, r.out);
        assert.match(r.out, /kept: build [0-9a-f]{12} passed its checks/, 'its own installer had kept it');
        assert.match(resultOf(home).why, /through the real address \(http:\/\/127\.0\.0\.1:\d+\) the new build didn't answer as itself in 4 seconds \(its service answered nothing\)/);
        await fromBefore(r, mk);
      } finally { rmSync(join(home, 'door-funnel'), { force: true }); rmSync(join(home, 'door-kill-console'), { force: true }); }
    }
  });

  test('the new page not served at the real address (its version.json gone): not kept, even with the build named there', CASE, async () => {
    needs('kept');
    const g = push(treeFiles(58, 'good', { installer: NO_VERSION }), 'No version.json');
    mark(g);
    const mk = mark0(), r = await pull(home, ['install', g.t12], { extra: { SPARK_CONSOLE_UPDATE_CONFIRM_S: '4' } });
    assert.equal(r.code, 1, r.out);
    assert.match(resultOf(home).why, /through the real address \(http:\/\/127\.0\.0\.1:\d+\) the new build answers, but its page isn't served there in 4 seconds \(its version\.json names nothing\)/, r.out);
    await fromBefore(r, mk);
  });

  test('an install cut off while it waits on the real address: the result names what answers, not a fixed sentence', CASE, async () => {
    needs('kept');
    const g = push(treeFiles(59), 'Cut off');
    mark(g);
    const mk = mark0(), down = join(home, 'door-down');
    let stage = 0;
    const r = await pull(home, ['install', g.t12], { extra: { SPARK_CONSOLE_UPDATE_CONFIRM_S: '60' }, onOut: (out, p) => {
      if (stage === 0 && out.includes('Installing tree')) { stage = 1; writeFileSync(down, ''); }
      if (stage === 1 && out.includes('Checking the new build through the real address')) { stage = 2; p.kill('SIGTERM'); }
    } });
    rmSync(down, { force: true });
    assert.equal(r.code, 130, r.out);
    const res = resultOf(home);
    assert.deepEqual([res.tree, res.result], [g.t12, 'not kept']);
    const tree = JSON.parse(read(home, 'spark-console-service', 'workflows.lock.json')).tree;
    assert.equal(res.why, `the install was interrupted; the build answering now is ${buildOf(base.files)}${tree ? `, installed from tree ${tree.slice(0, 12)}` : ''}`);
    await fromBefore(r, mk);
  });

  test('a build installed but silent: a yes at the terminal installs without a way back (no terminal is still refused)', CASE, async () => {
    needs('kept');
    const g = push(treeFiles(60), 'Over a silent build, with a yes');
    mark(g);
    sysctl('stop', 'spark-console-api');
    writeFileSync(join(home, 'tmp', 'terminal'), 'y\n');
    const r = await pull(home, ['install', g.t12], { extra: { SPARK_CONSOLE_TERMINAL: join(home, 'tmp', 'terminal') } });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Going on without a way back, as you said\./);
    assert.doesNotMatch(r.out, /The way back is armed/);
    assert.equal((await health(home))?.build, buildOf(g.files));
    nothingArmed();
    base = g;
  });

  test('an install from outside while that update\'s pull.sh still runs is refused; once it has gone, or on another boot with the same group number, it goes on', CASE, async () => {
    needs('kept');
    // pull.sh still running: a process group whose leader is pull.sh
    const still = spawn('bash', ['-c', 'exec -a pull.sh sleep 600'], { detached: true, stdio: 'ignore' });
    let r0, g, r;
    try {
      await new Promise(res => setTimeout(res, 500));
      r0 = bash(share('update-guard.sh'), 'arm', 'abcdefabcdef', '0123456789ab', buildOf(base.files), String(still.pid));
      assert.equal(r0.status, 0, r0.stdout + r0.stderr);
      g = push(treeFiles(61), 'From outside');
      r = await byHand(g);
      assert.notEqual(r.code, 0, r.out);
      assert.match(r.out, new RegExp(`An update from GitHub is still running \\(its pull\\.sh, process group ${still.pid}\\)\\. Let it finish, then run this again\\. Nothing was changed\\.`));
      assert.equal((await health(home))?.build, buildOf(base.files));
      assert.ok(existsSync(share('update-guard', 'guard')), 'still armed');
    } finally { try { process.kill(-still.pid, 'SIGKILL'); } catch {} }
    await new Promise(res => setTimeout(res, 500));
    r = await byHand(g);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /this install takes over, so it is disarmed first/);
    assert.equal((await health(home))?.build, buildOf(g.files));
    nothingArmed();
    base = g;
    // The same process group number as this install's own, on another boot: not "inside that update".
    const mine = spawnSync('ps', ['-o', 'pgid=', '-p', String(process.pid)], { encoding: 'utf8' }).stdout.trim();
    r0 = bash(share('update-guard.sh'), 'arm', 'abcdefabcdef', '0123456789ab', buildOf(base.files), mine);
    assert.equal(r0.status, 0, r0.stdout + r0.stderr);
    writeFileSync(share('update-guard', 'guard'), read(share('update-guard', 'guard')).replace(/^boot=.*$/m, 'boot=another-boot'));
    const g2 = push(treeFiles(62), 'From outside, after a restart');
    r = await byHand(g2);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /this install takes over, so it is disarmed first/);
    nothingArmed();
    base = g2;
  });

  test('an install from outside over a cut-off update\'s half-copied files, which then fails: it goes back to the confirmed build, not the half copy', CASE, async () => {
    needs('kept');
    const r0 = bash(share('update-guard.sh'), 'arm', 'abcdefabcdef', '0123456789ab', buildOf(base.files), OTHER_PGID);
    assert.equal(r0.status, 0, r0.stdout + r0.stderr);
    // The cut-off update left a service that doesn't run.
    writeFileSync(join(home, 'spark-console-service', 'server.mjs'), `const MODE = 'dead'; // half\n${STANDIN}`);
    sysctl('restart', 'spark-console-api');
    await new Promise(r => setTimeout(r, 1500));
    assert.equal(await health(home), null);
    // An install from outside whose build fails its own checks (sign-in).
    const g = push(treeFiles(63, 'not-owner'), 'From outside, failing');
    const r = await byHand(g);
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /The build from before that update is put back first/);
    await waitFor(async () => (await health(home))?.build === buildOf(base.files), { timeout: 30000 * SLOW, what: 'the confirmed build answering' });
    assert.equal(read(home, 'spark-console-service', 'server.mjs'), base.files['service/server.mjs'].text);
    nothingArmed();
  });

  // (the third read of C4b: the questions at the terminal, and the terminal gone)
  test('the questions at the terminal are shown: the busy one, and the one for an install without a way back', CASE, async () => {
    needs('kept');
    const g = push(treeFiles(64), 'Asked at the terminal');
    mark(g);
    const was = read(home, 'spark-console-service', 'server.mjs'), term = join(home, 'tmp', 'terminal');
    writeFileSync(join(home, 'standin-busy'), '2');
    writeFileSync(term, 'n\n');
    try {
      const r = await pull(home, ['install', g.t12], { extra: { SPARK_CONSOLE_TERMINAL: term } });
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /Spark Console is busy: 2 job\(s\) running.*\nUpdate anyway\? \[y\/N\] /s);
      assert.match(r.out, /Spark Console is busy, and the update wasn't confirmed/);
    } finally { rmSync(join(home, 'standin-busy'), { force: true }); }
    sysctl('stop', 'spark-console-api');
    try {
      const r = await pull(home, ['install', g.t12], { extra: { SPARK_CONSOLE_TERMINAL: term } });
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /Install the new build without a way back\? \[y\/N\] /);
      assert.equal(read(home, 'spark-console-service', 'server.mjs'), was);
    } finally { sysctl('start', 'spark-console-api'); }
    await waitFor(async () => (await health(home))?.build === buildOf(base.files), { timeout: 30000 * SLOW, what: 'the build answering again' });
    nothingArmed();
  });

  test('ASSUME_YES=1 doesn\'t answer the question for an install without a way back (the console starts pull.sh with no terminal)', CASE, async () => {
    needs('kept');
    const g = push(treeFiles(65), 'ASSUME_YES over a silent build');
    mark(g);
    const was = read(home, 'spark-console-service', 'server.mjs');
    sysctl('stop', 'spark-console-api');
    try {
      const r = await pull(home, ['install', g.t12], { extra: { ASSUME_YES: '1' } });
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /nobody at this terminal said to go on without one/);
      assert.equal(read(home, 'spark-console-service', 'server.mjs'), was);
      assert.deepEqual([resultOf(home).tree, resultOf(home).result], [g.t12, 'refused']);
    } finally { sysctl('start', 'spark-console-api'); }
    await waitFor(async () => (await health(home))?.build === buildOf(base.files), { timeout: 30000 * SLOW, what: 'the build answering again' });
    nothingArmed();
  });

  test('the terminal gone while the install waits on the real address (a dropped session): pull.sh itself still puts the build from before back', CASE, async () => {
    needs('kept');
    const g = push(treeFiles(66), 'Session dropped');
    mark(g);
    const mk = mark0(), down = join(home, 'door-down');
    let stage = 0;
    const r = await pull(home, ['install', g.t12], { extra: { SPARK_CONSOLE_UPDATE_CONFIRM_S: '60' }, onOut: (out, p) => {
      if (stage === 0 && out.includes('Installing tree')) { stage = 1; writeFileSync(down, ''); }
      if (stage === 1 && out.includes('Checking the new build through the real address')) {
        stage = 2;
        // The terminal goes: nothing reads what pull.sh writes any more, and the session's hang-up arrives.
        p.stdout.destroy(); p.stderr.destroy(); p.kill('SIGHUP');
      }
    } });
    rmSync(down, { force: true });
    assert.equal(stage, 2, r.out);
    // Put back by pull.sh's own handler, at once: not left to the timer (its 120 s here have not passed).
    assert.equal((await health(home))?.build, buildOf(base.files));
    assert.ok(!existsSync(join(home, 'guard-fired.log')) || lines(home, 'guard-fired.log').length === 1, 'the timer did not do it');
    const res = resultOf(home);
    assert.deepEqual([res.tree, res.result], [g.t12, 'not kept']);
    assert.match(res.why, /^the install was interrupted; the build answering now is /);
    await fromBefore(r, mk);
  });

  test('Python as -I and curl as -q: with a .curlrc and a user-site .pth in Spark 2\'s home, setup, check, an install kept through the way back and one put back by it read neither', { timeout: 300000 * SLOW }, async () => {
    const h = await sparkTwo(), rc = join(h, 'curlrc-read'), pth = join(h, 'pth-ran');
    writeFileSync(join(h, '.curlrc'), `trace-ascii = "${rc}"\n`);
    const site = spawnSync('python3', ['-c', 'import site; print(site.getusersitepackages())'], { env: envFor(h), encoding: 'utf8' }).stdout.trim();
    mkdirSync(site, { recursive: true });
    writeFileSync(join(site, 'zz-planted.pth'), `import os; open(${JSON.stringify(pth)}, 'a').close()\n`);
    // (a plain python3 and curl here do read them)
    spawnSync('python3', ['-c', 'pass'], { env: envFor(h) });
    spawnSync('curl', ['-s', '-m', '2', 'http://127.0.0.1:1/'], { env: envFor(h) });
    assert.deepEqual([existsSync(pth), existsSync(rc)], [true, true], 'the planted files are read on this machine');
    rmSync(pth); rmSync(rc);
    assert.equal((await pull(h, ['setup', OWNER_REPO], { input: `${TOKEN}\n` })).code, 0);
    const g1 = push(treeFiles(67), 'Home reads: the first build');
    mark(g1);
    let r = await pull(h, ['install', g1.t12]);
    assert.equal(r.code, 0, r.out);
    const g2 = push(treeFiles(68), 'Home reads: kept through the way back');
    mark(g2);
    r = await pull(h, ['install', g2.t12]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /The way back is armed/);
    assert.deepEqual([resultOf(h).tree, resultOf(h).result], [g2.t12, 'kept']);
    const g3 = push(treeFiles(69, 'dead'), 'Home reads: put back');
    mark(g3);
    r = await pull(h, ['install', g3.t12]);
    assert.equal(r.code, 1, r.out);
    assert.deepEqual([resultOf(h).tree, resultOf(h).result], [g3.t12, 'not kept']);
    assert.equal((await health(h))?.build, buildOf(g2.files));
    assert.equal((await pull(h, ['check'])).code, 0);
    assert.equal((await pull(h, ['check', '--json'])).code, 0);
    assert.ok(!existsSync(pth), 'a python3 without -I ran');
    assert.ok(!existsSync(rc), `a curl without -q read ~/.curlrc: ${existsSync(rc) ? read(rc).slice(0, 300) : ''}`);
  });
});
