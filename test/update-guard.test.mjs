// Covers: the update's way back (deploy/update-guard.sh, R30) and an install snapshot's restore.sh (R30), with no fleet:
// the real scripts, a folder standing in for Spark 2's home and a stand-in systemctl that keeps the service's state.
// A put-back cut off between its last move and the restart leaves the service stopped; the same command again starts
// it, and the copy goes only once the service is seen started; one whose service can't be started keeps its copy;
// a run cut off at its stop and then one that can't copy back still ends with the service started (the trap first);
// arm changes nothing without the lock; a staged copy that isn't the saved one (cp said yes) changes nothing live;
// restore.sh with --in-place-if-no-room puts back in place, checked, when there is no room beside, and says when
// that isn't whole (exit 3). The final read of round two, S-5, S-7 and S-10.
// Timer-triggered recovery gets at most three persisted attempts within 30 minutes of its first; direct-pull
// rollback and recovery by hand keep their existing paths. Native limits, transient failure,
// exhaustion across restarts, elapsed time, safe disarm and a later install are covered with the real guard script.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { REPO } from './start-mock.mjs';
import { SLOW, waitFor } from './lib.mjs';

const GUARD_SH = join(REPO, 'deploy', 'update-guard.sh');
const INSTALLER_TEXT = readFileSync(join(REPO, 'deploy', 'host-on-portal.sh'), 'utf8');
const BY = ['go-back.sh', 'RECOVERY.txt', 'REBUILD.txt', 'pull.sh', 'update-guard.sh', 'watchdog.sh', 'install-mark'];
const HAS_FLOCK = spawnSync('sh', ['-c', 'command -v flock'], { timeout: 5000 }).status === 0;
const put = (h, p, text, mode = 0o644) => { mkdirSync(dirname(join(h, p)), { recursive: true }); writeFileSync(join(h, p), text); chmodSync(join(h, p), mode); };
const get = (h, p) => (existsSync(join(h, p)) ? readFileSync(join(h, p), 'utf8') : null);
const share = (h, ...p) => join(h, '.local', 'share', 'spark-console', ...p);
const env = (h, extra = {}) => ({ HOME: h, PATH: `${join(h, 'bin')}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`, LANG: 'C.UTF-8', SPARK_CONSOLE_ALL_LOCAL: '1', ...extra });
const run = (h, argv, { limit = false, extra } = {}) => spawnSync('bash', limit ? ['-c', 'trap "" XFSZ; ulimit -f 100; exec "$@"', 'limit', 'bash', ...argv] : argv, { env: env(h, extra), encoding: 'utf8', timeout: 240000 * SLOW });
const calls = h => (get(h, 'systemctl.log') || '').split('\n').filter(Boolean);
const armed = h => existsSync(share(h, 'update-guard', 'guard'));
const svc = h => (get(h, 'svc-state') || 'active\n').trim();
const BIG = 300000, OLD_SERVER = `// old\n${'x'.repeat(BIG)}\n`, NEW_SERVER = `// new\n${'y'.repeat(BIG - 50000)}\n`;
// A stand-in systemctl with the service's state: start and restart make it active, unless ~/cant-start is there; stop
// makes it inactive; is-active says which (exit 0 only for active). With ~/kill-at-<verb>, that verb (after its state
// change) ends its caller with SIGKILL, as an out-of-memory kill would: no trap runs.
const SYSTEMCTL = `#!/bin/sh
echo "$*" >> "$HOME/systemctl.log"
v=''; for a in "$@"; do case "$a" in --*) ;; *) [ -n "$v" ] || v="$a" ;; esac; done
case "$*" in *spark-console-api*)
  case "$v" in
    start|restart) if [ -e "$HOME/cant-start" ]; then echo failed > "$HOME/svc-state"; else echo active > "$HOME/svc-state"; fi ;;
    stop) echo inactive > "$HOME/svc-state" ;;
    is-active) s=$(cat "$HOME/svc-state" 2>/dev/null || echo active); case "$*" in *--quiet*) ;; *) echo "$s" ;; esac; [ "$s" = active ]; exit $? ;;
  esac ;;
esac
if [ -e "$HOME/kill-at-$v" ]; then mv "$HOME/kill-at-$v" "$HOME/killed"; kill -9 "$PPID"; sleep 1; fi
exit 0
`;
// Spark 2's home with the build from before installed, the way back armed from it, then the new build's files in.
function armedHome({ big = false, unit = true } = {}) {
  const h = mkdtempSync(join(tmpdir(), 'ugd-'));
  put(h, 'bin/systemctl', SYSTEMCTL, 0o755);
  put(h, 'spark-console/index.html', 'old page\n');
  put(h, 'spark-console-service/server.mjs', big ? OLD_SERVER : 'old server\n');
  if (unit) put(h, '.config/systemd/user/spark-console-api.service', '[Unit]\nDescription=old\n');
  for (const f of BY) put(h, `.local/share/spark-console/${f}`, `old ${f}\n`, 0o700);
  put(h, 'spark-console-src/README.md', 'old source\n');
  const r = run(h, [GUARD_SH, 'arm', 'aaaaaaaaaaaa', 'bbbbbbbbbbbb', 'cccccccccccc', '2147483646']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  put(h, 'spark-console/index.html', 'new page\n');
  put(h, 'spark-console-service/server.mjs', big ? NEW_SERVER : 'new server\n');
  writeFileSync(join(h, 'systemctl.log'), '');
  return h;
}
const putBack = (h, opts) => run(h, [share(h, 'update-guard', 'update-guard.sh'), 'put-back', 'hand', 'a test'], opts);

describe('the way back: the service started whatever happens, and the copy kept until it is seen started (S-5)', { concurrency: 1 }, () => {
  test('a put-back cut off between its last move and the restart: the same command again starts the service, and only then does the copy go', { timeout: 300000 * SLOW }, () => {
    const h = armedHome();
    writeFileSync(join(h, 'kill-at-daemon-reload'), '');
    putBack(h);
    assert.ok(existsSync(join(h, 'killed')), 'cut off at its daemon-reload');
    assert.deepEqual([get(h, 'spark-console/index.html'), get(h, 'spark-console-service/server.mjs'), svc(h), armed(h)], ['old page\n', 'old server\n', 'inactive', true], 'moved back, stopped, still armed');
    writeFileSync(join(h, 'systemctl.log'), '');
    const r = putBack(h);
    assert.equal(r.status, 1, r.stdout + r.stderr);   // (nothing answers on a socket here)
    assert.equal(svc(h), 'active', `started again: ${calls(h).join(' | ')}`);
    assert.ok(!existsSync(share(h, 'update-guard')), 'the copy went, once the service was seen started');
  });

  test('a service that can\'t be started keeps the copy armed, with both ways on; once it can, the same command lets it go', { timeout: 300000 * SLOW }, () => {
    const h = armedHome();
    writeFileSync(join(h, 'cant-start'), '');
    let r = putBack(h);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /The files of the build from before the update are back, but its service couldn't be started\. Its copy is kept, and the way back stays armed\. To go on: .*put-back hand\. Or, if it can never go back, .*update-guard\.sh disarm/);
    assert.ok(armed(h), 'still armed');
    assert.equal(JSON.parse(get(h, '.local/state/spark-console/update-result.json')).wayBackArmed, true);
    rmSync(join(h, 'cant-start'));
    r = putBack(h);
    assert.equal(svc(h), 'active');
    assert.ok(!existsSync(share(h, 'update-guard')), r.stdout);
  });

  test('cut off at its stop, then a run that can\'t copy back: it still ends with the service started (the start-again trap is set first)', { timeout: 300000 * SLOW }, () => {
    const h = armedHome({ big: true });
    writeFileSync(join(h, 'kill-at-stop'), '');
    putBack(h);
    assert.ok(existsSync(join(h, 'killed')), 'cut off at its stop');
    assert.equal(svc(h), 'inactive');
    const r = putBack(h, { limit: true });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /it couldn't be copied back \(is the disk full\?\), so this run changed none of its files/);
    assert.equal(svc(h), 'active', `started: ${calls(h).join(' | ')}`);
    assert.ok(armed(h), 'still armed');
  });
});

describe('the way back: its guards (S-10)', { concurrency: 1 }, () => {
  test('arm changes nothing without the lock', { timeout: 120000 * SLOW, skip: !HAS_FLOCK && 'no flock here' }, async () => {
    const h = mkdtempSync(join(tmpdir(), 'ugl-'));
    put(h, 'bin/systemctl', SYSTEMCTL, 0o755);
    put(h, 'spark-console-service/server.mjs', 'old server\n');
    mkdirSync(share(h), { recursive: true });
    const lock = share(h, 'update-guard.lock'), free = () => spawnSync('flock', ['-n', lock, 'true'], { timeout: 5000 }).status === 0;
    writeFileSync(lock, '');
    const holder = spawn('flock', ['-x', lock, 'sleep', '300'], { detached: true, stdio: 'ignore' });
    try {
      await waitFor(() => !free(), { timeout: 10000, what: 'another run holding the way back\'s lock' });
      const r = run(h, [GUARD_SH, 'arm', 'aaaaaaaaaaaa', 'bbbbbbbbbbbb', 'cccccccccccc', '2147483646'], { extra: { SPARK_CONSOLE_UPDATE_LOCK_S: '2' } });
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stdout, /Another run of the way back still holds its lock/);
      assert.ok(!existsSync(share(h, 'update-guard')), 'no copy made');
      assert.deepEqual(calls(h), [], 'no timer armed');
    } finally {
      try { process.kill(-holder.pid, 'SIGKILL'); } catch {}
      await waitFor(free, { timeout: 10000, what: 'the lock let go' });
    }
  });

  // (a cp that says yes but leaves a copy that isn't the saved one: only the compare after it can tell)
  const BAD_CP = `#!/bin/sh
/bin/cp "$@" || exit $?
for d; do :; done
case "$d" in *.putback*) if [ -d "$d" ]; then f=$(find "$d" -type f | head -n 1); [ -z "$f" ] || echo spoiled >> "$f"; else echo spoiled >> "$d"; fi ;; esac
exit 0
`;
  test('a staged copy that isn\'t the saved one (cp said yes) changes nothing live: the page and the service, then a by-hand file', { timeout: 300000 * SLOW }, () => {
    // (no unit file here: the unit's own compare would catch it too, and this is about the folders' staging)
    let h = armedHome({ unit: false });
    put(h, 'bin/cp', BAD_CP, 0o755);
    let r = putBack(h);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /it couldn't be copied back/);
    assert.deepEqual([get(h, 'spark-console/index.html'), get(h, 'spark-console-service/server.mjs'), armed(h)], ['new page\n', 'new server\n', true]);
    // (the page and the service the same as the copy: only pull.sh differs)
    h = mkdtempSync(join(tmpdir(), 'ugp-'));
    put(h, 'bin/systemctl', SYSTEMCTL, 0o755);
    put(h, 'spark-console/index.html', 'old page\n');
    put(h, 'spark-console-service/server.mjs', 'old server\n');
    for (const f of BY) put(h, `.local/share/spark-console/${f}`, `old ${f}\n`, 0o700);
    r = run(h, [GUARD_SH, 'arm', 'aaaaaaaaaaaa', 'bbbbbbbbbbbb', 'cccccccccccc', '2147483646']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    put(h, '.local/share/spark-console/pull.sh', 'new pull.sh\n', 0o700);
    put(h, 'bin/cp', BAD_CP, 0o755);
    r = putBack(h);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /some of its files couldn't be copied back/);
    assert.equal(get(h, '.local/share/spark-console/pull.sh'), 'new pull.sh\n', 'untouched, not spoiled');
    assert.ok(armed(h));
  });
});

describe('restore.sh in a snapshot, when room is what failed (S-7)', { concurrency: 1 }, () => {
  const text = /cat > "\$SNAP\/restore\.sh" <<'RESTORE'\n([\s\S]*?)\nRESTORE\n/.exec(INSTALLER_TEXT)[1];
  // A snapshot of the build from before, and the live files a failed install left; cp refuses any copy that names
  // ~/cp-refuses' text, as a full disk would.
  function snapHome() {
    const h = mkdtempSync(join(tmpdir(), 'ugr-')), snap = join(h, 'releases', '20261116T000000Z');
    put(h, 'bin/systemctl', SYSTEMCTL, 0o755);
    put(h, 'bin/cp', '#!/bin/sh\nif [ -f "$HOME/cp-refuses" ]; then case " $* " in *"$(cat "$HOME/cp-refuses")"*) echo "cp: No space left on device" >&2; exit 1 ;; esac; fi\nexec /bin/cp "$@"\n', 0o755);
    put(snap, 'spark-console/index.html', 'old page\n');
    put(snap, 'spark-console-service/server.mjs', 'old server\n');
    put(snap, 'spark-console-api.service', '[Unit]\nDescription=old\n');
    put(snap, 'restore.sh', `${text}\n`, 0o700);
    put(h, 'spark-console/index.html', 'new page\n');
    put(h, 'spark-console-service/server.mjs', 'new server, cut sh');
    return { h, snap };
  }
  test('no room for the checked copy beside, from the installer (--in-place-if-no-room): put back in place, checked', { timeout: 120000 * SLOW }, () => {
    const { h, snap } = snapHome();
    writeFileSync(join(h, 'cp-refuses'), '.spark-console-service.restore');
    const r = run(h, [join(snap, 'restore.sh'), '--stand-in', '--in-place-if-no-room']);
    assert.equal(r.status, 1, r.stdout + r.stderr);   // (back, and nothing answers here)
    assert.match(r.stderr, /There isn't room for a checked copy beside the live one, so the saved install is put back in place and checked after\./);
    assert.deepEqual([get(h, 'spark-console/index.html'), get(h, 'spark-console-service/server.mjs')], ['old page\n', 'old server\n']);
    assert.ok(existsSync(join(snap, 'same')));
  });
  test('in place, and still not whole: exit 3, said with the line to run once there is room; the snapshot stays as it is', { timeout: 120000 * SLOW }, () => {
    const { h, snap } = snapHome();
    writeFileSync(join(h, 'cp-refuses'), '/spark-console-service/');
    let r = run(h, [join(snap, 'restore.sh'), '--stand-in', '--in-place-if-no-room']);
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.match(r.stderr, new RegExp(`The saved install couldn't be put back whole \\(is the disk full\\?\\)\\. Make room, then run this again: bash ${join(snap, 'restore.sh').replace(/[.]/g, '\\.')}`));
    assert.ok(!existsSync(join(snap, 'same')));
    assert.equal(svc(h), 'active', 'and the service is started again');
    rmSync(join(h, 'cp-refuses'));
    r = run(h, [join(snap, 'restore.sh'), '--stand-in']);
    assert.deepEqual([get(h, 'spark-console/index.html'), get(h, 'spark-console-service/server.mjs')], ['old page\n', 'old server\n'], r.stdout + r.stderr);
  });
});

// A small stand-in for the generated service's restart policy. Time moves by events; the real copied guard runs
// on each event. This checks scheduling and retained-state behavior, not a real systemd manager.
function retryManager(h) {
  const unit = get(h, '.config/systemd/user/spark-console-update-guard.service');
  const value = key => new RegExp(`^${key}=(.*)$`, 'm').exec(unit)?.[1];
  let starts = 0, pending = true, sinceLog = calls(h).length;
  return {
    get pending() { return pending; },
    get starts() { return starts; },
    step() {
      if (calls(h).slice(sinceLog).some(line => line === '--user stop spark-console-update-guard.service')) pending = false;
      if (!pending || !armed(h) || starts >= Number(value('StartLimitBurst'))) return null;
      starts++;
      const r = run(h, [share(h, 'update-guard', 'update-guard.sh'), 'put-back', 'timer']);
      pending = r.status !== 0 && value('Restart') === 'on-failure' && armed(h) && starts < Number(value('StartLimitBurst'));
      sinceLog = calls(h).length;
      return r;
    }
  };
}
const retryFields = h => Object.fromEntries(get(h, '.local/share/spark-console/update-guard/guard').trim().split('\n').map(line => line.split('=')));
const failCopy = h => put(h, 'bin/cp', '#!/bin/sh\nif [ -e "$HOME/cant-copy" ]; then echo "cp: No space left on device" >&2; exit 1; fi\nexec /bin/cp "$@"\n', 0o755);
const answerOld = h => put(h, 'bin/curl', '#!/bin/sh\nprintf \'%s\\n\' \'{"ok":true,"build":"cccccccccccc"}\'\n', 0o755);

describe('the update timer retries safely within one saved budget', { concurrency: 1 }, () => {
  test('the generated service bounds attempts, work, stop time and waits; only a whole guard can trigger it', () => {
    const h = armedHome(), unit = get(h, '.config/systemd/user/spark-console-update-guard.service');
    for (const line of ['ConditionPathExists=%h/.local/share/spark-console/update-guard/guard', 'StartLimitIntervalSec=infinity', 'StartLimitBurst=3', 'Restart=on-failure', 'RestartSec=60s', 'TimeoutStartSec=9min', 'TimeoutStopSec=10s'])
      assert.ok(unit.split('\n').includes(line), line);
    assert.ok(3 * (9 * 60 + 10) + 2 * 60 < 30 * 60, 'timer work plus termination and restart delays fit its recovery budget');
    // Where it is installed, systemd's parser also checks the real generated unit, without starting it.
    if (spawnSync('sh', ['-c', 'command -v systemd-analyze']).status === 0) {
      const checked = spawnSync('systemd-analyze', ['verify', '--man=no', join(h, '.config/systemd/user/spark-console-update-guard.service')], { encoding: 'utf8' });
      assert.equal(checked.status, 0, checked.stdout + checked.stderr);
    }
  });

  test('a timer copy failure schedules another attempt; after room returns the retained copy is restored without reboot or owner retry', () => {
    const h = armedHome(); answerOld(h); failCopy(h); put(h, 'cant-copy', '');
    const manager = retryManager(h), first = manager.step();
    assert.equal(first.status, 1, first.stdout + first.stderr);
    assert.ok(manager.pending, 'the generated policy schedules another attempt');
    assert.equal(retryFields(h).autoTries, '1');
    assert.deepEqual([get(h, 'spark-console/index.html'), get(h, 'spark-console-service/server.mjs')], ['new page\n', 'new server\n']);
    rmSync(join(h, 'cant-copy'));
    const second = manager.step();
    assert.equal(second.status, 0, second.stdout + second.stderr);
    assert.equal(manager.starts, 2);
    assert.equal(manager.pending, false);
    assert.deepEqual([get(h, 'spark-console/index.html'), get(h, 'spark-console-service/server.mjs'), svc(h), armed(h)], ['old page\n', 'old server\n', 'active', false]);
    assert.equal(JSON.parse(get(h, '.local/state/spark-console/update-result.json')).wayBackArmed, false);
    assert.ok(!calls(h).includes('--user stop spark-console-update-guard.service'), 'the timer never stops its own process before durable completion');
  });

  test('three persistent failures keep the saved copy and say recovery by hand is needed; restarting the manager cannot spend a fourth attempt', () => {
    const h = armedHome(); answerOld(h); failCopy(h); put(h, 'cant-copy', '');
    const manager = retryManager(h);
    for (let i = 1; i <= 3; i++) { const r = manager.step(); assert.equal(r.status, 1, r.stdout + r.stderr); assert.equal(retryFields(h).autoTries, String(i)); }
    assert.equal(manager.pending, false);
    assert.equal(manager.step(), null);
    assert.match(JSON.parse(get(h, '.local/state/spark-console/update-result.json')).why, /three tries; recovery by hand is needed/);
    const afterRestart = retryManager(h).step();
    assert.equal(afterRestart.status, 0, afterRestart.stdout + afterRestart.stderr);
    assert.match(afterRestart.stdout, /three-try or thirty-minute limit/);
    assert.equal(retryFields(h).autoTries, '3');
    assert.equal(get(h, 'spark-console-service/server.mjs'), 'new server\n');
    assert.equal(JSON.parse(get(h, '.local/state/spark-console/update-result.json')).wayBackArmed, true);
    rmSync(join(h, 'cant-copy'));
    const byHand = putBack(h);
    assert.equal(byHand.status, 0, byHand.stdout + byHand.stderr);
    assert.equal(armed(h), false, 'the owner can still recover by hand after the automatic budget is exhausted');
  });

  test('too little time left, a reversed clock or a malformed retry record leaves live files alone and keeps the copy', () => {
    for (const fields of [
      `autoTries=1\nautoSince=${Math.floor(Date.now() / 1000) - 1300}\n`,
      `autoTries=1\nautoSince=${Math.floor(Date.now() / 1000) + 60}\n`,
      'autoTries=wrong\nautoSince=0\n'
    ]) {
      const h = armedHome(); answerOld(h);
      const path = share(h, 'update-guard', 'guard'); writeFileSync(path, readFileSync(path, 'utf8') + fields);
      const r = retryManager(h).step();
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /recovery by hand/);
      assert.deepEqual([get(h, 'spark-console/index.html'), get(h, 'spark-console-service/server.mjs'), armed(h)], ['new page\n', 'new server\n', true]);
      assert.ok(!calls(h).some(line => /(?:daemon-reload|(?:start|stop|restart) spark-console-api)$/.test(line)), 'budget refusal starts no live service work, including exit traps');
    }
  });

  test('disarm cancels a pending restart, and a later arm stops any old restart before creating its copy and resets the native limit', () => {
    const h = armedHome(); failCopy(h); put(h, 'cant-copy', '');
    const manager = retryManager(h);
    assert.equal(manager.step().status, 1);
    const r = run(h, [share(h, 'update-guard', 'update-guard.sh'), 'disarm']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(calls(h).includes('--user stop spark-console-update-guard.service'));
    assert.equal(manager.step(), null, 'the old queued restart is canceled');
    rmSync(join(h, 'cant-copy')); writeFileSync(join(h, 'systemctl.log'), '');
    // Fail arm if it tries to stop the old service after the new guard already exists.
    put(h, 'bin/systemctl', SYSTEMCTL.replace('v=\'\';', 'case "$*" in *"stop spark-console-update-guard.service"*) [ ! -e "$HOME/.local/share/spark-console/update-guard/guard" ] || exit 1 ;; esac\nv=\'\';'), 0o755);
    const next = run(h, [GUARD_SH, 'arm', 'dddddddddddd', 'eeeeeeeeeeee', 'bbbbbbbbbbbb', '2147483646']);
    assert.equal(next.status, 0, next.stdout + next.stderr);
    const log = calls(h), stop = log.indexOf('--user stop spark-console-update-guard.service'), reset = log.indexOf('--user reset-failed spark-console-update-guard.service'), enable = log.indexOf('--user enable --now spark-console-update-guard.timer');
    assert.ok(stop >= 0 && reset > stop && enable > reset, log.join('\n'));
    assert.equal(retryFields(h).autoTries, undefined, 'a later install starts with a fresh budget');
  });
});
