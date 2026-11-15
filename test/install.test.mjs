// Covers: The installer's Spark 2 half against a stand-in console and a stand-in `systemctl` (F4): kept, never answers,
// dies after answering, copy fails, chat or sign-in broken, brain down (and `SKIP_CHAT_CHECK=1`), no room, unfinished
// snapshot, same update twice, Telegram, `restore.sh` with a failing copy, the watchdog counting `activating`, a cut
// session; `go-back.sh`, `RECOVERY.txt` and the update note land where they should; nothing calls ssh, sudo, tailscale
// or systemd-run; `install.sh verify` against the real service; which snapshot undo picks. R53: the watchdog reads its
// miss count as text (what the file holds never runs); `path-check.sh` is asked before anything changes, and a miss
// refuses check and install naming each program, with nothing changed; `restore.sh` and the watchdog take their
// programs from the fixed path (`path-check.sh`'s); a `.curlrc` and a user-site `.pth` in the home are never read by
// install.sh, restore.sh or the watchdog, and every Python and curl call in the three scripts says `-I` and `-q`. The
// stand-in switch is an argument only (--stand-in): set in their environment, it switches nothing. The watchdog writes
// its three files whole, by rename, never through a link that is there. E10f: the console runs on a Node of Spark 2's own
// (from the fixed path), never code-server's: with only that one, an install is refused before anything changes. On
// macOS it runs under bash 3.2 with `tar` and `find` shims; a Linux run is the full proof.
//
// The installer's Spark 2 half (the install.sh inside deploy/host-on-portal.sh), its restore.sh and its watchdog, run on
// this machine (F4, H1, S5). Nothing real is touched: each case gets its own short HOME, stand-ins come first on PATH
// (systemctl starts and stops a small runner for the stand-in console, test/mock/standin-console.mjs; ssh, sudo,
// tailscale and systemd-run fail closed and are never called), and DBUS_SESSION_BUS_ADDRESS is empty so a real
// `systemctl --user` couldn't reach a user manager. --stand-in, as the stand-in fleet's tests say it, keeps that PATH in
// restore.sh, the watchdog and go-back.sh, and has install.sh read ~/.mock/off-path-<program> for its path look; a case
// that runs them as on Spark 2 leaves it out. The Mac half (tailscale serve, sudo) is never run here.
// Part B runs `install.sh verify` against the real service on the stand-in fleet, and checks which snapshot undo picks.
// On macOS, bash 3.2 runs it with small tar and find shims (GNU options); a Linux run is the full proof.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, statSync, symlinkSync, unlinkSync, copyFileSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { startMock, REPO, MOCK } from './start-mock.mjs';
import { SLOW, waitFor, request } from './lib.mjs';

const INSTALLER = readFileSync(join(REPO, 'deploy', 'host-on-portal.sh'), 'utf8');
const INSTALL_SH = (() => {
  const a = INSTALLER.indexOf("<<'REMOTE'\n"), b = INSTALLER.indexOf('\nREMOTE\n', a);
  assert.ok(a > 0 && b > a, 'the Spark 2 half is in deploy/host-on-portal.sh');
  return INSTALLER.slice(a + "<<'REMOTE'\n".length, b + 1);
})();
const STANDIN = readFileSync(join(MOCK, 'standin-console.mjs'), 'utf8');
const NODE_DIR = dirname(process.execPath);
const homes = [];

// A HOME short enough for the socket under it (macOS allows 104 characters; a longer path gives EINVAL).
function shortHome(prefix) {
  let home = mkdtempSync(join(tmpdir(), prefix));
  if (`${home}/.local/state/spark-console/api.sock`.length >= 100) { rmSync(home, { recursive: true, force: true }); home = mkdtempSync(join('/tmp', prefix)); }
  homes.push(home);
  return home;
}
const sh = (file, text) => writeFileSync(file, text, { mode: 0o755 });
const gnuTar = spawnSync('tar', ['--version'], { encoding: 'utf8' }).stdout?.includes('GNU');
const findPrintf = spawnSync('find', ['.', '-maxdepth', '0', '-printf', ''], { encoding: 'utf8' }).status === 0;

// The stand-in systemd for spark-console-api: restart/start/stop run or stop a runner that starts the installed
// server.mjs again 1 s after it exits (Restart=always) and stops it on SIGTERM.
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
  show) if [ -f "$HOME/unit-state" ]; then cat "$HOME/unit-state"; elif alive; then echo active; else echo inactive; fi ;;
esac
exit 0
`;
function makeHome() {
  const home = shortHome('sci-'), bin = join(home, 'bin');
  mkdirSync(bin);
  mkdirSync(join(home, 'run'));
  writeFileSync(join(bin, 'runner.mjs'), RUNNER);
  sh(join(bin, 'systemctl'), SYSTEMCTL);
  for (const f of ['journalctl', 'logger']) sh(join(bin, f), '#!/bin/sh\nexit 0\n');
  sh(join(bin, 'loginctl'), '#!/bin/sh\necho yes\n');
  for (const f of ['ssh', 'sudo', 'tailscale', 'systemd-run']) sh(join(bin, f), `#!/bin/sh\necho "${f} $*" >> "$HOME/never-called.log"\nexit 97\n`);
  sh(join(bin, 'cp'), `#!/bin/bash
if [ -f "$HOME/fail-cp" ]; then
  want=$(cat "$HOME/fail-cp")
  case " $* " in *"$want"*) rm -f "$HOME/fail-cp"; echo "cp: No space left on device" >&2; exit 1 ;; esac
fi
PATH="\${PATH#*:}" exec cp "$@"
`);
  sh(join(bin, 'df'), `#!/bin/bash
if [ -f "$HOME/df-free-kb" ]; then
  echo "Filesystem 1024-blocks Used Available Capacity Mounted on"
  echo "/dev/standin 100000000 99000000 $(cat "$HOME/df-free-kb") 99% /"
  exit 0
fi
PATH="\${PATH#*:}" exec df "$@"
`);
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
  // The stage folder, as the Mac half sends it.
  const IN = join(home, 'in');
  mkdirSync(join(IN, 'ui'), { recursive: true });
  mkdirSync(join(IN, 'service'));
  writeFileSync(join(IN, 'install.sh'), INSTALL_SH);
  for (const f of ['go-back.sh', 'RECOVERY.txt', 'path-check.sh']) copyFileSync(join(REPO, 'deploy', f), join(IN, f));
  const S = join(IN, 'service');
  writeFileSync(join(S, 'dig.mjs'), '// stand-in dig.mjs\n');
  writeFileSync(join(S, 'passkey.mjs'), '// stand-in passkey.mjs\n');
  writeFileSync(join(S, 'config.json'), '{"nodes":[],"user":"x"}\n');
  writeFileSync(join(S, 'catalog.json'), '[]\n');
  writeFileSync(join(S, 'worker.py'), '# stand-in worker\n');
  writeFileSync(join(S, 'workflows.lock.json'), '{}\n');
  const state = join(home, '.local', 'state', 'spark-console');
  mkdirSync(state, { recursive: true, mode: 0o700 });
  writeFileSync(join(state, 'access.json'), '{"ownerLogin":"owner@test"}\n');
  return home;
}
// Puts a variant in the stage folder; returns its build (as 01-setup.mjs computes it).
function stage(home, mode, n) {
  const IN = join(home, 'in'), S = join(IN, 'service');
  writeFileSync(join(S, 'server.mjs'), `const MODE = '${mode}'; // ${n}\n${STANDIN}`);
  writeFileSync(join(IN, 'ui', 'index.html'), `<!doctype html><title>build ${n}</title>\n`);
  writeFileSync(join(IN, 'ui', 'version.json'), `{"build":"ui-${n}"}\n`);
  const h = createHash('sha256');
  for (const f of ['server.mjs', 'dig.mjs', 'passkey.mjs']) h.update(readFileSync(join(S, f)));
  return h.digest('hex').slice(0, 12);
}
const envFor = (home, extra = {}) => ({ HOME: home, USER: 'standin', PATH: `${join(home, 'bin')}:${NODE_DIR}:${process.env.PATH}`,
  SPARK_CONSOLE_INSTALL_WAIT_S: '6', SPARK_CONSOLE_INSTALL_SETTLE_S: '3', DBUS_SESSION_BUS_ADDRESS: '', XDG_RUNTIME_DIR: join(home, 'run'), LANG: 'C.UTF-8',
  SPARK_CONSOLE_ALL_LOCAL: '1', ...extra });
// (--stand-in, as the stand-in fleet's tests say it; a case run as on Spark 2 sets SPARK_CONSOLE_ALL_LOCAL empty, or
// passes standIn false)
function run(home, args, extra = {}, standIn = extra.SPARK_CONSOLE_ALL_LOCAL !== '') {
  return new Promise(resolve => {
    const p = spawn('bash', [join(home, 'in', 'install.sh'), ...args, ...(standIn ? ['--stand-in'] : [])], { env: envFor(home, extra), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += d; });
    p.on('close', code => resolve({ code, out }));
  });
}
const install = (home, stamp, build, extra) => run(home, ['install', stamp, build, 'local'], extra);
let stampN = 0;
const nextStamp = () => `202611${String(10 + Math.floor(stampN / 24)).padStart(2, '0')}T${String(stampN++ % 24).padStart(2, '0')}0000Z`;
// A first install of `good`, then the stage holds the variant.
async function firstGood(home) {
  const b = stage(home, 'good', 1);
  const r = await install(home, nextStamp(), b);
  assert.equal(r.code, 0, r.out);
  return b;
}
const health = home => new Promise(resolve => {
  const req = http.get({ socketPath: join(home, '.local', 'state', 'spark-console', 'api.sock'), path: '/health', timeout: 2000 }, res => {
    let d = ''; res.on('data', c => { d += c; }); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
  });
  req.on('error', () => resolve(null));
  req.on('timeout', () => { req.destroy(); resolve(null); });
});
const read = (home, ...p) => readFileSync(join(home, ...p), 'utf8');
const installed = home => ({ version: read(home, 'spark-console', 'version.json'), server: read(home, 'spark-console-service', 'server.mjs') });
const staged = home => ({ version: read(home, 'in', 'ui', 'version.json'), server: read(home, 'in', 'service', 'server.mjs') });
const snaps = home => { try { return readdirSync(join(home, '.local', 'share', 'spark-console', 'releases')).sort(); } catch { return []; } };
const snapDir = (home, stamp) => join(home, '.local', 'share', 'spark-console', 'releases', stamp);
const requests = home => (existsSync(join(home, 'requests.log')) ? read(home, 'requests.log').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const systemctlLog = home => (existsSync(join(home, 'systemctl.log')) ? read(home, 'systemctl.log').split('\n').filter(Boolean) : []);
const apiVerbs = home => systemctlLog(home).map(l => l.split(' ')).filter(w => w.includes('spark-console-api')).map(w => w.filter(x => x !== '--user')[0]);
const runnerAlive = home => { try { process.kill(Number(read(home, 'runner.pid')), 0); return true; } catch { return false; } };
// The H1 files at the fixed path: byte-equal to deploy/, go-back.sh mode 0700.
function byHandFiles(home) {
  const d = join(home, '.local', 'share', 'spark-console');
  assert.equal(read(home, '.local', 'share', 'spark-console', 'go-back.sh'), readFileSync(join(REPO, 'deploy', 'go-back.sh'), 'utf8'));
  assert.equal(statSync(join(d, 'go-back.sh')).mode & 0o777, 0o700);
  assert.equal(read(home, '.local', 'share', 'spark-console', 'RECOVERY.txt'), readFileSync(join(REPO, 'deploy', 'RECOVERY.txt'), 'utf8'));
}
function stopRunner(home) { spawnSync('bash', [join(home, 'bin', 'systemctl'), '--user', 'stop', 'spark-console-api'], { env: envFor(home) }); }

after(() => {
  for (const home of homes) {
    if (existsSync(join(home, 'bin', 'systemctl'))) stopRunner(home);
    // 15. Nothing an install must never call was called, in any home.
    assert.ok(!existsSync(join(home, 'never-called.log')), existsSync(join(home, 'never-called.log')) ? read(home, 'never-called.log') : '');
    rmSync(home, { recursive: true, force: true });
  }
});

// (each case installs twice, with 3 s of settling: about 15 to 40 s each on a slow laptop)
const CASE = { timeout: 150000 * SLOW };
describe('the installer\'s Spark 2 half, against a stand-in console', () => {
  test('1. a good update is kept: it settles, the ways in and one chat turn are checked as the owner; by-hand files and the note land', CASE, async () => {
    const home = makeHome(), old = await firstGood(home);
    byHandFiles(home);
    const b = stage(home, 'good', 2), stamp = nextStamp();
    // (the Mac half writes this from NOTE=…)
    writeFileSync(join(home, 'in', 'update-note.json'), JSON.stringify({ build: b, note: 'Test note' }));
    const r = await install(home, stamp, b);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(installed(home), staged(home));
    assert.equal((await health(home))?.build, b);
    const snap = snapDir(home, stamp);
    assert.ok(existsSync(join(snap, 'restore.sh')));
    assert.equal(read(home, '.local', 'share', 'spark-console', 'releases', stamp, 'build').trim(), old);
    assert.ok(!existsSync(join(snap, 'same')));
    const mine = requests(home).filter(q => q.build === b && q.login === 'owner@test');
    assert.ok(mine.some(q => q.method === 'GET' && q.path === '/whoami'));
    assert.ok(mine.some(q => q.method === 'POST' && q.path === '/mcp'));
    assert.ok(mine.some(q => q.method === 'GET' && q.path === '/v1/models'));
    assert.ok(mine.some(q => q.method === 'POST' && /^\/chats\/sc_[0-9a-f]{16}\/messages$/.test(q.path) && q.xsc === '1' && q.origin === 'https://localhost'), JSON.stringify(mine));
    assert.match(r.out, /ways in: ok/);
    assert.match(r.out, /chat: ok/);
    assert.match(r.out, new RegExp(`kept: build ${b} passed its checks`));
    byHandFiles(home);
    assert.deepEqual(JSON.parse(read(home, '.local', 'state', 'spark-console', 'update-note.json')), { build: b, note: 'Test note' });
  });

  test('2. a build that never answers: the old files go back and answer; the snapshot is marked same', CASE, async () => {
    const home = makeHome(), old = await firstGood(home);
    const before = installed(home), stamp = nextStamp();
    const r = await install(home, stamp, stage(home, 'dead', 2));
    assert.notEqual(r.code, 0, r.out);
    assert.deepEqual(installed(home), before);
    assert.equal((await health(home))?.build, old);
    assert.ok(existsSync(join(snapDir(home, stamp), 'same')), r.out);
    assert.match(r.out, /The update was not kept\. The previous version is running again/);
    byHandFiles(home);
  });

  test('3. a build that answers, then dies: sent back', CASE, async () => {
    const home = makeHome(), old = await firstGood(home);
    const before = installed(home);
    const r = await install(home, nextStamp(), stage(home, 'dies', 2));
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /stopped or restarted by itself/);
    assert.deepEqual(installed(home), before);
    assert.equal((await health(home))?.build, old);
  });

  test('4. a copy that fails part-way: the previous files go back', CASE, async () => {
    const home = makeHome(), old = await firstGood(home);
    const before = installed(home);
    writeFileSync(join(home, 'fail-cp'), '/spark-console-service/');
    const r = await install(home, nextStamp(), stage(home, 'good', 2));
    assert.notEqual(r.code, 0, r.out);
    assert.deepEqual(installed(home), before);
    assert.equal((await health(home))?.build, old);
  });

  test('5. Sparkie can\'t call a tool: sent back, and it says chat', CASE, async () => {
    const home = makeHome(); await firstGood(home);
    const before = installed(home);
    const r = await install(home, nextStamp(), stage(home, 'no-tool', 2));
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /chat: Sparkie didn.t call a tool/);
    assert.deepEqual(installed(home), before);
  });

  test('6. the owner isn\'t the owner to the new build: sent back, and it says sign-in', CASE, async () => {
    const home = makeHome(); await firstGood(home);
    const before = installed(home);
    const r = await install(home, nextStamp(), stage(home, 'not-owner', 2));
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /sign-in: owner@test isn.t the owner/);
    assert.deepEqual(installed(home), before);
  });

  test('7. Sparkie\'s model down before the update: refused with nothing changed; SKIP_CHAT_CHECK=1 updates without the chat turn', CASE, async () => {
    const home = makeHome(); await firstGood(home);
    const before = installed(home), had = snaps(home), restarts = apiVerbs(home).filter(v => v === 'restart').length;
    writeFileSync(join(home, 'brain-down'), '');
    const b = stage(home, 'good', 2);
    const r = await install(home, nextStamp(), b);
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /\/restart sparkie/);
    assert.match(r.out, /SKIP_CHAT_CHECK=1/);
    assert.deepEqual(snaps(home), had);
    assert.deepEqual(installed(home), before);
    assert.equal(apiVerbs(home).filter(v => v === 'restart').length, restarts);
    const posts = () => requests(home).filter(q => q.method === 'POST' && /\/messages$/.test(q.path)).length, n = posts();
    const s = await install(home, nextStamp(), b, { SKIP_CHAT_CHECK: '1' });
    assert.equal(s.code, 0, s.out);
    assert.match(s.out, /chat: not checked \(switched off with SKIP_CHAT_CHECK=1\)/);
    assert.equal(posts(), n);
    assert.equal((await health(home))?.build, b);
  });

  test('8. no room for the snapshot and the new files: refused, nothing changed', CASE, async () => {
    const home = makeHome(); await firstGood(home);
    const before = installed(home), had = snaps(home);
    writeFileSync(join(home, 'df-free-kb'), '1000');
    const r = await install(home, nextStamp(), stage(home, 'good', 2));
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /MB free/);
    assert.deepEqual(snaps(home), had);
    assert.deepEqual(installed(home), before);
  });

  test('9. a snapshot that can\'t be finished is removed, and nothing changed', CASE, async () => {
    const home = makeHome(); await firstGood(home);
    const before = installed(home), stamp = nextStamp();
    writeFileSync(join(home, 'fail-cp'), '/releases/');
    const r = await install(home, stamp, stage(home, 'good', 2));
    assert.notEqual(r.code, 0, r.out);
    assert.ok(!existsSync(snapDir(home, stamp)), r.out);
    assert.deepEqual(installed(home), before);
  });

  test('10. the same update again: kept, its snapshot marked same, the check\'s chat reused', CASE, async () => {
    const home = makeHome(); await firstGood(home);
    const b = stage(home, 'good', 2);
    assert.equal((await install(home, nextStamp(), b)).code, 0);
    const stamp = nextStamp(), r = await install(home, stamp, b);
    assert.equal(r.code, 0, r.out);
    assert.ok(existsSync(join(snapDir(home, stamp), 'same')));
    const chats = JSON.parse(read(home, 'standin-chats.json'));
    assert.equal(chats.length, 1, JSON.stringify(chats));
    assert.equal(chats[0].messages, 4);
    assert.match(chats[0].title, /^Update check\./);
  });

  test('11. Telegram polled before, and doesn\'t in the new build: sent back', CASE, async () => {
    const home = makeHome(); writeFileSync(join(home, 'tg-state'), 'ok'); await firstGood(home);
    const before = installed(home);
    const r = await install(home, nextStamp(), stage(home, 'tg-bad', 2));
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /Telegram was working before this update/);
    assert.deepEqual(installed(home), before);
  });

  test('12. restore.sh whose copy fails still ends with the unit started', CASE, async () => {
    const home = makeHome(); await firstGood(home);
    const stamp = nextStamp();
    assert.equal((await install(home, stamp, stage(home, 'good', 2))).code, 0);
    writeFileSync(join(home, 'fail-cp'), '/spark-console-service/');
    const r = spawnSync('bash', [join(snapDir(home, stamp), 'restore.sh'), '--stand-in'], { env: envFor(home), encoding: 'utf8', timeout: 60000 * SLOW });
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.equal(apiVerbs(home).at(-1), 'start', systemctlLog(home).join('\n'));
    assert.ok(runnerAlive(home));
  });

  test('13. the watchdog counts a console systemd keeps trying to start (activating), and restarts it after 3', CASE, async () => {
    const home = makeHome(); await firstGood(home);
    stopRunner(home);
    writeFileSync(join(home, 'unit-state'), 'activating');
    const S = join(home, '.local', 'state', 'spark-console'), dog = join(home, '.local', 'share', 'spark-console', 'watchdog.sh');
    const misses = () => (existsSync(join(S, 'watchdog-misses')) ? readFileSync(join(S, 'watchdog-misses'), 'utf8').trim() : null);
    const restarts = () => apiVerbs(home).filter(v => v === 'restart').length, n = restarts();
    spawnSync('bash', [dog, '--stand-in'], { env: envFor(home) });
    assert.equal(misses(), '1');
    spawnSync('bash', [dog, '--stand-in'], { env: envFor(home) });
    assert.equal(misses(), '2');
    spawnSync('bash', [dog, '--stand-in'], { env: envFor(home) });
    assert.equal(restarts(), n + 1, systemctlLog(home).join('\n'));
    assert.equal(readFileSync(join(S, 'watchdog-restarts'), 'utf8').split('\n').filter(Boolean).length, 1);
    unlinkSync(join(home, 'unit-state'));
  });

  test('14. the session drops part-way: the previous install is put back by itself', CASE, async () => {
    const home = makeHome(), old = await firstGood(home);
    const before = installed(home), b = stage(home, 'good', 2);
    const code = await new Promise(resolve => {
      const p = spawn('bash', [join(home, 'in', 'install.sh'), 'install', nextStamp(), b, 'local', '--stand-in'], { env: envFor(home), stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      p.stdout.on('data', d => { out += d; if (out.includes('Installing the UI')) { p.stdout.destroy(); p.stderr.destroy(); } });
      p.on('exit', resolve);
    });
    assert.notEqual(code, 0);
    await waitFor(async () => (await health(home))?.build === old, { timeout: 30000, what: 'the old build answering again' });
    assert.deepEqual(installed(home), before);
  });

  test('15. a fix that misses, over a build that had died: one go-back.sh reaches the last good build', { timeout: 300000 * SLOW }, async () => {
    const home = makeHome(), good = await firstGood(home);
    assert.equal((await install(home, nextStamp(), stage(home, 'good', 2))).code, 0);
    // The kept build dies later: its installed copy exits as it starts.
    writeFileSync(join(home, 'spark-console-service', 'server.mjs'), `const MODE = 'dead'; // 2\n${STANDIN}`);
    spawnSync('bash', [join(home, 'bin', 'systemctl'), '--user', 'restart', 'spark-console-api'], { env: envFor(home) });
    await new Promise(r => setTimeout(r, 1500));
    assert.equal(await health(home), null, 'the console is dead');
    // A fix that misses its checks: the installer puts the dead build back.
    assert.notEqual((await install(home, nextStamp(), stage(home, 'not-owner', 3))).code, 0);
    const g = spawnSync('bash', [join(home, '.local', 'share', 'spark-console', 'go-back.sh'), '--stand-in'], { env: envFor(home), encoding: 'utf8' });
    await waitFor(async () => (await health(home))?.build === good, { timeout: 30000, what: `the last good build answering (go-back.sh: ${g.stdout}${g.stderr})` });
  });

  test('19. the watchdog goes back a build once after 15 minutes of silence within a day of an install; not sooner, not while an update\'s way back is armed, not a day after', { timeout: 300000 * SLOW }, async () => {
    const home = makeHome(), good = await firstGood(home);
    assert.equal((await install(home, nextStamp(), stage(home, 'good', 2))).code, 0);
    const D = join(home, '.local', 'share', 'spark-console'), S = join(home, '.local', 'state', 'spark-console'), markFile = join(D, 'install-mark');
    const mark = readFileSync(markFile, 'utf8');
    assert.match(mark, /^\d+ [0-9a-f]{12}\n$/, 'the install left its mark');
    // The kept build goes silent: its installed copy exits as it starts, and systemd keeps starting it.
    writeFileSync(join(home, 'spark-console-service', 'server.mjs'), `const MODE = 'dead'; // 2\n${STANDIN}`);
    spawnSync('bash', [join(home, 'bin', 'systemctl'), '--user', 'restart', 'spark-console-api'], { env: envFor(home) });
    await new Promise(r => setTimeout(r, 1500));
    const dog = () => spawnSync('bash', [join(D, 'watchdog.sh'), '--stand-in'], { env: envFor(home) });
    const silentFor = minutes => writeFileSync(join(S, 'watchdog-silent-since'), `${Math.floor(Date.now() / 1000) - minutes * 60}\n`);
    silentFor(14); dog();
    assert.equal(await health(home), null, 'not after 14 minutes');
    silentFor(16); mkdirSync(join(D, 'update-guard')); dog(); rmSync(join(D, 'update-guard'), { recursive: true });
    assert.equal(await health(home), null, 'not while an update\'s way back is armed');
    writeFileSync(markFile, `${Math.floor(Date.now() / 1000) - 25 * 3600} ${mark.split(' ')[1]}`);
    silentFor(16); dog();
    assert.equal(await health(home), null, 'not a day after the install');
    writeFileSync(markFile, mark);
    silentFor(16); dog();
    await waitFor(async () => (await health(home))?.build === good, { timeout: 30000, what: 'the build before, put back by the watchdog' });
    assert.ok(!existsSync(markFile), 'once: the mark is gone');
  });

  test('20. a ps that fails doesn\'t end an install: with no update\'s way back armed, it goes on as before', CASE, async () => {
    const home = makeHome();
    sh(join(home, 'bin', 'ps'), '#!/bin/sh\nexit 1\n');
    const b = stage(home, 'good', 1), r = await install(home, nextStamp(), b);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /kept: build [0-9a-f]{12} passed its checks/);
    assert.equal((await health(home))?.build, b);
  });

  // (E2d: the Mac half stages it with the other recovery files, RECOVERY_FILES; rebuild.test.mjs checks that list)
  test('21. the rebuild steps (REBUILD.txt) land beside RECOVERY.txt at the fixed path, byte for byte', CASE, async () => {
    const home = makeHome();
    copyFileSync(join(REPO, 'deploy', 'REBUILD.txt'), join(home, 'in', 'REBUILD.txt'));
    await firstGood(home);
    assert.equal(read(home, '.local', 'share', 'spark-console', 'REBUILD.txt'), readFileSync(join(REPO, 'deploy', 'REBUILD.txt'), 'utf8'));
    byHandFiles(home);
  });

  test('22. the watchdog reads its miss count as text: a file holding a[$(touch ran)] runs nothing, and the count goes to 1', CASE, async () => {
    const home = makeHome(); await firstGood(home);
    stopRunner(home);
    writeFileSync(join(home, 'unit-state'), 'active');
    const S = join(home, '.local', 'state', 'spark-console');
    writeFileSync(join(S, 'watchdog-misses'), 'a[$(touch ran)]\n');
    spawnSync('bash', [join(home, '.local', 'share', 'spark-console', 'watchdog.sh'), '--stand-in'], { env: envFor(home), cwd: home });
    assert.ok(!existsSync(join(home, 'ran')), 'what the file held ran');
    assert.equal(readFileSync(join(S, 'watchdog-misses'), 'utf8').trim(), '1');
    unlinkSync(join(home, 'unit-state'));
  });

  test('23. install.sh asks path-check.sh first: a program missing from the fixed path refuses check and install, naming it, with nothing changed', CASE, async () => {
    const home = makeHome(); await firstGood(home);
    const before = installed(home), snapsBefore = snaps(home), calls = systemctlLog(home).length, b = stage(home, 'good', 2);
    // As on Spark 2 (not the stand-in fleet): path-check.sh as it was staged, here one that finds two programs missing.
    sh(join(home, 'in', 'path-check.sh'), '#!/bin/sh\necho "Not on the fixed path (/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin): docker tailscale"\nexit 1\n');
    const onSpark2 = { SPARK_CONSOLE_ALL_LOCAL: '' };
    const refused = /STOP: Spark 2 is missing programs Spark Console's commands call\. Not on the fixed path \([^)]*\): docker tailscale\. Nothing was changed\./;
    const c = await run(home, ['check'], onSpark2);
    assert.equal(c.code, 1, c.out);
    assert.match(c.out, refused);
    assert.doesNotMatch(c.out, /^busy /m);
    const r = await install(home, nextStamp(), b, onSpark2);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, refused);
    assert.deepEqual([installed(home), snaps(home), systemctlLog(home).length], [before, snapsBefore, calls]);
    // On the stand-in fleet the list is path-check.sh's own, and ~/.mock/off-path-<program> marks one missing.
    copyFileSync(join(REPO, 'deploy', 'path-check.sh'), join(home, 'in', 'path-check.sh'));
    mkdirSync(join(home, '.mock'));
    writeFileSync(join(home, '.mock', 'off-path-nvidia-smi'), '');
    const m = await install(home, nextStamp(), b);
    assert.equal(m.code, 1, m.out);
    assert.match(m.out, /STOP: Spark 2 is missing programs Spark Console's commands call\. Not on the fixed path: nvidia-smi\. Nothing was changed\./);
    assert.deepEqual([installed(home), snaps(home)], [before, snapsBefore]);
    rmSync(join(home, '.mock'), { recursive: true });
    const k = await install(home, nextStamp(), b);
    assert.equal(k.code, 0, k.out);
  });

  test('24. restore.sh and the watchdog take their programs from the fixed path (path-check.sh\'s): a systemctl first on the PATH they are given never runs', CASE, async () => {
    const home = makeHome(); await firstGood(home);
    const stamp = nextStamp();
    assert.equal((await install(home, stamp, stage(home, 'good', 2))).code, 0);
    const restore = join(snapDir(home, stamp), 'restore.sh'), dog = join(home, '.local', 'share', 'spark-console', 'watchdog.sh');
    const fixed = /^PATH=(\S+)$/m.exec(readFileSync(join(REPO, 'deploy', 'path-check.sh'), 'utf8'))?.[1];
    assert.ok(fixed);
    for (const f of [restore, dog]) {
      assert.equal(/^\[ "\$\{SPARK_CONSOLE_ALL_LOCAL:-\}" = 1 \] \|\| \{ PATH=(\S+); export PATH; \}$/m.exec(readFileSync(f, 'utf8'))?.[1], fixed, f);
    }
    // As on Spark 2: the stand-in systemctl is first on the PATH they are given (a real one can't reach a user manager).
    const n = systemctlLog(home).length, onSpark2 = envFor(home, { SPARK_CONSOLE_ALL_LOCAL: '' });
    spawnSync('bash', [dog], { env: onSpark2, cwd: home, timeout: 60000 * SLOW });
    spawnSync('bash', [restore], { env: onSpark2, cwd: home, timeout: 60000 * SLOW });
    assert.deepEqual(systemctlLog(home).slice(n), [], 'the systemctl in the home ran');
  });

  test('25. Python as -I and curl as -q: a .curlrc and a user-site .pth in the home are never read by install.sh (check, install, a put-back), restore.sh or the watchdog; every call in the three scripts says so', CASE, async () => {
    for (const f of ['host-on-portal.sh', 'pull.sh', 'update-guard.sh']) {
      for (const l of readFileSync(join(REPO, 'deploy', f), 'utf8').split('\n').filter(x => !/^\s*#/.test(x))) {
        for (const m of l.matchAll(/\bpython3\b(?![\w.-])/g)) assert.match(l.slice(m.index), /^python3 -I /, `${f}: ${l}`);
        for (const m of l.matchAll(/\bcurl\b(?![\w.-])/g)) assert.match(l.slice(m.index), /^curl -q /, `${f}: ${l}`);
      }
    }
    const home = makeHome(), rc = join(home, 'curlrc-read'), pth = join(home, 'pth-ran');
    writeFileSync(join(home, '.curlrc'), `trace-ascii = "${rc}"\n`);
    const site = spawnSync('python3', ['-c', 'import site; print(site.getusersitepackages())'], { env: envFor(home), encoding: 'utf8' }).stdout.trim();
    mkdirSync(site, { recursive: true });
    writeFileSync(join(site, 'zz-planted.pth'), `import os; open(${JSON.stringify(pth)}, 'a').close()\n`);
    // (a plain python3 and curl here do read them)
    spawnSync('python3', ['-c', 'pass'], { env: envFor(home) });
    spawnSync('curl', ['-s', '-m', '2', 'http://127.0.0.1:1/'], { env: envFor(home) });
    assert.deepEqual([existsSync(pth), existsSync(rc)], [true, true], 'the planted files are read on this machine');
    rmSync(pth); rmSync(rc);
    const good = stage(home, 'good', 1);
    let r = await run(home, ['check']);
    assert.equal(r.code, 0, r.out);
    r = await install(home, nextStamp(), good);
    assert.equal(r.code, 0, r.out);
    r = await run(home, ['check']);
    assert.match(r.out, /^busy 0 0$/m);
    r = await install(home, nextStamp(), stage(home, 'not-owner', 2));
    assert.notEqual(r.code, 0, r.out);
    assert.equal((await health(home))?.build, good, r.out);
    spawnSync('bash', [join(home, '.local', 'share', 'spark-console', 'watchdog.sh'), '--stand-in'], { env: envFor(home), cwd: home });
    assert.ok(!existsSync(pth), 'a python3 without -I ran');
    assert.ok(!existsSync(rc), `a curl without -q read ~/.curlrc: ${existsSync(rc) ? readFileSync(rc, 'utf8').slice(0, 300) : ''}`);
  });

  // (the fourth read of C4b, later list 1 and 2)
  test('26. the stand-in switch is an argument only: in their environment it switches nothing, in restore.sh, the watchdog or install.sh\'s path look', CASE, async () => {
    const home = makeHome(); await firstGood(home);
    const stamp = nextStamp();
    assert.equal((await install(home, stamp, stage(home, 'good', 2))).code, 0);
    // The switch set in the environment, no --stand-in: the stand-in systemctl first on the PATH never runs.
    const n = systemctlLog(home).length, env = envFor(home, { SPARK_CONSOLE_ALL_LOCAL: '1' });
    spawnSync('bash', [join(home, '.local', 'share', 'spark-console', 'watchdog.sh')], { env, cwd: home, timeout: 60000 * SLOW });
    spawnSync('bash', [join(snapDir(home, stamp), 'restore.sh')], { env, cwd: home, timeout: 60000 * SLOW });
    assert.deepEqual(systemctlLog(home).slice(n), [], 'the systemctl in the home ran');
    // install.sh's path look: with the switch only in its environment, it asks path-check.sh (here one that finds
    // nothing missing), not ~/.mock, which marks nvidia-smi missing.
    sh(join(home, 'in', 'path-check.sh'), '#!/bin/sh\nexit 0\n');
    mkdirSync(join(home, '.mock'));
    writeFileSync(join(home, '.mock', 'off-path-nvidia-smi'), '');
    const c = await run(home, ['check'], { SPARK_CONSOLE_ALL_LOCAL: '1' }, false);
    assert.equal(c.code, 0, c.out);
    assert.match(c.out, /^busy /m);
    // (and with --stand-in the same look reads ~/.mock, with path-check.sh's own list)
    copyFileSync(join(REPO, 'deploy', 'path-check.sh'), join(home, 'in', 'path-check.sh'));
    const m = await run(home, ['check'], {}, true);
    assert.match(m.out, /Not on the fixed path: nvidia-smi\./);
  });

  test('27. the watchdog writes its three files whole, by rename: a link left in their place is replaced, and what it pointed at is untouched', CASE, async () => {
    const home = makeHome(); await firstGood(home);
    stopRunner(home);
    writeFileSync(join(home, 'unit-state'), 'active');
    const S = join(home, '.local', 'state', 'spark-console'), dog = join(home, '.local', 'share', 'spark-console', 'watchdog.sh');
    const outside = f => join(home, `outside-${f}`);
    const plant = f => { writeFileSync(outside(f), 'kept\n'); rmSync(join(S, f), { force: true }); symlinkSync(outside(f), join(S, f)); };
    plant('watchdog-misses'); plant('watchdog-silent-since');
    spawnSync('bash', [dog, '--stand-in'], { env: envFor(home), cwd: home });
    for (const f of ['watchdog-misses', 'watchdog-silent-since']) {
      assert.equal(readFileSync(outside(f), 'utf8'), 'kept\n', `${f}: written through the link`);
      assert.ok(!lstatSync(join(S, f)).isSymbolicLink(), `${f}: still a link`);
    }
    assert.equal(readFileSync(join(S, 'watchdog-misses'), 'utf8').trim(), '1');
    // The third miss restarts the console: the restarts file, a link here, is written whole too.
    writeFileSync(join(S, 'watchdog-misses'), '2\n');
    plant('watchdog-restarts');
    spawnSync('bash', [dog, '--stand-in'], { env: envFor(home), cwd: home });
    assert.equal(readFileSync(outside('watchdog-restarts'), 'utf8'), 'kept\n', 'watchdog-restarts: written through the link');
    assert.ok(!lstatSync(join(S, 'watchdog-restarts')).isSymbolicLink());
    assert.match(readFileSync(join(S, 'watchdog-restarts'), 'utf8'), /^\d+\n$/);
    assert.equal(readFileSync(join(S, 'watchdog-misses'), 'utf8').trim(), '0');
    unlinkSync(join(home, 'unit-state'));
  });

  // (E10f: Spark 2's own Node, never code-server's)
  // code-server's Node, as code-server installs it under the home (here it runs this machine's node).
  const codeServerNode = home => {
    const dir = join(home, '.local', 'opt', 'code-server-4.96.2', 'lib');
    mkdirSync(dir, { recursive: true });
    sh(join(dir, 'node'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} "$@"\n`);
    return dir;
  };
  const FIXED = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin';
  const fixedNode = spawnSync('sh', ['-c', 'command -v node'], { env: { PATH: FIXED }, encoding: 'utf8' }).stdout.trim();
  test('28. the console runs on Spark 2\'s own Node, from the fixed path: with code-server\'s first on the PATH, install.sh takes the other', { ...CASE, skip: !fixedNode && 'no node on the fixed path here' }, async () => {
    const home = makeHome(), cs = codeServerNode(home);
    sh(join(home, 'in', 'path-check.sh'), '#!/bin/sh\nexit 0\n');
    const r = await run(home, ['check'], { PATH: `${cs}:${envFor(home).PATH}` }, false);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, new RegExp(`Node\\.js v\\d+[^ ]* \\(${fixedNode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\): ok`));
    assert.doesNotMatch(r.out, /code-server/);
  });

  test('29. with only code-server\'s Node on Spark 2, an install is refused before anything changes, saying what to install', CASE, async () => {
    const home = makeHome(), cs = codeServerNode(home), b = stage(home, 'good', 1);
    // (no node on the PATH given: the stand-in fleet's tests take Node from it)
    const r = await install(home, nextStamp(), b, { PATH: `${join(home, 'bin')}:/usr/bin:/bin` });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, new RegExp(`STOP: Spark 2 has no Node\\.js of its own, and Spark Console no longer runs on code-server's \\(${join(cs, 'node').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\): that goes when Spark 2 is cleared\\. Install Node\\.js 18 or newer from the system's packages, so it is at /usr/bin/node or /usr/local/bin/node \\(on Spark 2: sudo apt install nodejs, then node --version\\), then run this again\\. Nothing was changed\\.`));
    assert.deepEqual([snaps(home), existsSync(join(home, 'spark-console-service')), systemctlLog(home)], [[], false, []]);
  });
});

describe('install.sh verify and undo\'s snapshot, against the real service', { concurrency: 1 }, () => {
  let fleet, rel, home, script;
  before(async () => {
    rel = mkdtempSync(join(tmpdir(), 'sct-inst-rel-'));
    homes.push(rel);
    fleet = await startMock({ watchMs: 600000, env: { SPARK_CONSOLE_RELEASES: rel } });
    home = shortHome('scv-');
    const S = join(home, '.local', 'state', 'spark-console');
    mkdirSync(S, { recursive: true });
    symlinkSync(fleet.socket, join(S, 'api.sock'));
    symlinkSync(join(fleet.stateDir, 'access.json'), join(S, 'access.json'));
    mkdirSync(join(home, 'in'));
    script = join(home, 'in', 'install.sh');
    writeFileSync(script, INSTALL_SH);
  }, { timeout: 180000 * SLOW });
  after(async () => { await fleet?.stop(); });
  const verify = () => {
    const r = spawnSync('bash', [script, 'verify'], { env: { HOME: home, USER: 'standin', PATH: `${NODE_DIR}:${process.env.PATH}`, LANG: 'C.UTF-8' }, encoding: 'utf8', timeout: 300000 * SLOW });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  // (a fresh connection each: a kept-alive one can be reset while verify holds this process)
  const ownerApi = async path => JSON.parse((await request(`${fleet.base}${path}`)).text);

  test('16. verify: sign-in, the agent door, the model address and one chat turn with a tool call; its chat is reused', { timeout: 300000 * SLOW }, async () => {
    writeFileSync(join(fleet.dir, 'model-script.json'), JSON.stringify([{ match: '^Update check\\.', calls: [{ name: 'fleet_status', arguments: {} }] }]));
    const r = verify();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ways in: ok .* chat: ok/);
    let checks = (await ownerApi('/chats')).chats.filter(c => /^Update check\./.test(c.title));
    assert.equal(checks.length, 1);
    assert.equal(checks[0].messageCount, 2);
    const answer = (await ownerApi(`/chats/${checks[0].id}`)).messages.at(-1);
    assert.deepEqual((answer.tools || []).map(t => [t.name, t.ok]), [['fleet_status', true]]);
    assert.equal(answer.choices, undefined);
    const again = verify();
    assert.equal(again.code, 0, again.out);
    checks = (await ownerApi('/chats')).chats.filter(c => /^Update check\./.test(c.title));
    assert.equal(checks.length, 1);
    assert.equal(checks[0].messageCount, 4);
  });

  test('17. verify misses: someone else named as the owner (sign-in); a model that calls no tool (chat)', { timeout: 300000 * SLOW }, async () => {
    const access = join(home, '.local', 'state', 'spark-console', 'access.json');
    unlinkSync(access);
    writeFileSync(access, '{"ownerLogin":"stranger@test"}\n');
    try {
      const r = verify();
      assert.notEqual(r.code, 0, r.out);
      assert.match(r.out, /sign-in/);
    } finally { unlinkSync(access); symlinkSync(join(fleet.stateDir, 'access.json'), access); }
    rmSync(join(fleet.dir, 'model-script.json'), { force: true });
    const r = verify();
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /chat/);
  });

  test('18. undo picks the newest whole snapshot not marked same', async () => {
    const make = (stamp, ...files) => { mkdirSync(join(rel, stamp)); for (const f of files) writeFileSync(join(rel, stamp, f), f === 'restore.sh' ? '#!/bin/sh\nexit 0\n' : ''); };
    make('20261101T000000Z', 'restore.sh');
    make('20261102T000000Z', 'restore.sh', 'same');
    make('20261103T000000Z');
    assert.deepEqual(await ownerApi('/rollback'), { available: true, stamp: '20261101T000000Z' });
    rmSync(join(rel, '20261101T000000Z'), { recursive: true });
    assert.deepEqual(await ownerApi('/rollback'), { available: false, stamp: null });
  });
});
