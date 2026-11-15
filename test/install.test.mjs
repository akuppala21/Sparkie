// Covers: The installer's Spark 2 half against a stand-in console and a stand-in `systemctl` (F4): kept, never answers,
// dies after answering, copy fails, chat or sign-in broken, brain down (and `SKIP_CHAT_CHECK=1`), no room, unfinished
// snapshot, same update twice, Telegram, `restore.sh` with a failing copy, the watchdog counting `activating`, a cut
// session; `go-back.sh`, `RECOVERY.txt` and the update note land where they should; nothing calls ssh, sudo, tailscale
// or systemd-run; `install.sh verify` against the real service; which snapshot undo picks. On macOS it runs under bash
// 3.2 with `tar` and `find` shims; a Linux run is the full proof.
//
// The installer's Spark 2 half (the install.sh inside deploy/host-on-portal.sh), its restore.sh and its watchdog, run on
// this machine (F4, H1, S5). Nothing real is touched: each case gets its own short HOME, stand-ins come first on PATH
// (systemctl starts and stops a small runner for the stand-in console, test/mock/standin-console.mjs; ssh, sudo,
// tailscale and systemd-run fail closed and are never called), and DBUS_SESSION_BUS_ADDRESS is empty so a real
// `systemctl --user` couldn't reach a user manager. The Mac half (tailscale serve, sudo) is never run here.
// Part B runs `install.sh verify` against the real service on the stand-in fleet, and checks which snapshot undo picks.
// On macOS, bash 3.2 runs it with small tar and find shims (GNU options); a Linux run is the full proof.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, statSync, symlinkSync, unlinkSync, copyFileSync } from 'node:fs';
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
  for (const f of ['go-back.sh', 'RECOVERY.txt']) copyFileSync(join(REPO, 'deploy', f), join(IN, f));
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
  SPARK_CONSOLE_INSTALL_WAIT_S: '6', SPARK_CONSOLE_INSTALL_SETTLE_S: '3', DBUS_SESSION_BUS_ADDRESS: '', XDG_RUNTIME_DIR: join(home, 'run'), LANG: 'C.UTF-8', ...extra });
function run(home, args, extra = {}) {
  return new Promise(resolve => {
    const p = spawn('bash', [join(home, 'in', 'install.sh'), ...args], { env: envFor(home, extra), stdio: ['ignore', 'pipe', 'pipe'] });
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
    const r = spawnSync('bash', [join(snapDir(home, stamp), 'restore.sh')], { env: envFor(home), encoding: 'utf8', timeout: 60000 * SLOW });
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
    spawnSync('bash', [dog], { env: envFor(home) });
    assert.equal(misses(), '1');
    spawnSync('bash', [dog], { env: envFor(home) });
    assert.equal(misses(), '2');
    spawnSync('bash', [dog], { env: envFor(home) });
    assert.equal(restarts(), n + 1, systemctlLog(home).join('\n'));
    assert.equal(readFileSync(join(S, 'watchdog-restarts'), 'utf8').split('\n').filter(Boolean).length, 1);
    unlinkSync(join(home, 'unit-state'));
  });

  test('14. the session drops part-way: the previous install is put back by itself', CASE, async () => {
    const home = makeHome(), old = await firstGood(home);
    const before = installed(home), b = stage(home, 'good', 2);
    const code = await new Promise(resolve => {
      const p = spawn('bash', [join(home, 'in', 'install.sh'), 'install', nextStamp(), b, 'local'], { env: envFor(home), stdio: ['ignore', 'pipe', 'pipe'] });
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
    const g = spawnSync('bash', [join(home, '.local', 'share', 'spark-console', 'go-back.sh')], { env: envFor(home), encoding: 'utf8' });
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
    const dog = () => spawnSync('bash', [join(D, 'watchdog.sh')], { env: envFor(home) });
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

  // (E2d: the Mac half stages it with the other recovery files, RECOVERY_FILES; rebuild.test.mjs checks that list)
  test('20. the rebuild steps (REBUILD.txt) land beside RECOVERY.txt at the fixed path, byte for byte', CASE, async () => {
    const home = makeHome();
    copyFileSync(join(REPO, 'deploy', 'REBUILD.txt'), join(home, 'in', 'REBUILD.txt'));
    await firstGood(home);
    assert.equal(read(home, '.local', 'share', 'spark-console', 'REBUILD.txt'), readFileSync(join(REPO, 'deploy', 'REBUILD.txt'), 'utf8'));
    byHandFiles(home);
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
