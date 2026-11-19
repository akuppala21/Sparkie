// The root helper (deploy/spark-console-root) set up on a stand-in Spark as the owner's one-time command leaves it, as a
// rehearsal: a made-up root (/etc, /proc, /sys, /usr/local/sbin) with the real helper and its sudo line, reached from
// that Spark's home as ~/.rehearsal, and the helper's proof of its walls passed there. The stand-ins in test/mock/bin run
// it: sudo (its rehearsal case), systemd-run, systemctl, unshare and setpriv. They build no wall: a command runs unwalled.
// A look needs only that (the made-up root is ~/.rehearsal itself). A change (run: true) needs the owner's home where the
// helper reads it, <made-up root> + the home /etc/passwd names, as a real folder holding every name the run wall holds:
// so the made-up root is the fleet's root folder, ~/.rehearsal a link to it, the home in /etc/passwd /<spark> (the
// Spark's own folder), and the names the run wall holds are made as the one-time command makes them. One Spark a fleet.
// The command then runs with HOME=/<spark>, which is not there: it starts in the Spark's folder (run's --dir), so a
// command names its files from there. With home: true (the eval's practice Spark, test/eval.mjs) the stand-in
// systemd-run gives a run, look or root unit the made-up root's view of that home (<rehearsal>/standin/home), so its HOME
// is the Spark's folder and ~ is there, as the owner's home is on a Spark.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, chmodSync, realpathSync, symlinkSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MOCKBIN = join(REPO, 'test', 'mock', 'bin');
export const HELPER_SRC = join(REPO, 'deploy', 'spark-console-root');
export const rehearsalEnv = (home, R) => ({ PATH: `${MOCKBIN}:/usr/bin:/bin`, HOME: home, SPARK_CONSOLE_REHEARSAL: R, SUDO_UID: '1000', SUDO_USER: 'owner', SUDO_GID: '1000' });

// The inactive, root-owned socket inode systemd creates at boot. Close the socket without listening.
export function systemdMaskSocket(R) {
  const dir = join(R, 'run/systemd/inaccessible');
  if (existsSync(join(dir, 'sock'))) return;
  mkdirSync(dir, { recursive: true });
  const made = spawnSync('python3', ['-I', '-S', '-c', 'import socket\nwith socket.socket(socket.AF_UNIX) as s:\n    s.bind("sock")'], { cwd: dir, encoding: 'utf8' });
  assert.equal(made.status, 0, made.stdout + made.stderr);
  chmodSync(join(dir, 'sock'), 0o000);
}

// The names the run wall holds in the owner's home (the helper's MUST_BE_THERE), made where missing as
// deploy/root-for-sparkie.sh makes them: .ssh 0700, .bash_profile reading .profile, the other start files empty, folders.
function makeMissing(home) {
  const must = /^MUST_BE_THERE='([^']*)'/m.exec(readFileSync(HELPER_SRC, 'utf8'))?.[1].split(/\s+/).filter(Boolean);
  assert.ok(must?.length, 'the helper names what must be there');
  for (const n of must) {
    const p = join(home, n);
    if (existsSync(p)) continue;
    if (n === '.ssh') mkdirSync(p, { mode: 0o700 });
    else if (n === '.bash_profile') writeFileSync(p, '. "$HOME/.profile"\n');
    else if (['.bashrc', '.profile', '.bash_logout', '.bash_aliases', '.pam_environment'].includes(n)) writeFileSync(p, '');
    else mkdirSync(p, { recursive: true });
  }
}

export function rehearse(root, spark, { prove = true, knobs = {}, run = false, home: homeThere = false } = {}) {
  const home = join(root, spark), R = run ? root : join(home, '.rehearsal');
  const put = (p, text = '', mode) => { mkdirSync(dirname(join(R, p)), { recursive: true }); writeFileSync(join(R, p), text); if (mode) chmodSync(join(R, p), mode); };
  mkdirSync(join(R, 'usr/local/sbin'), { recursive: true });
  for (const d of ['', 'usr', 'usr/local', 'usr/local/sbin']) chmodSync(join(R, d), 0o755);
  systemdMaskSocket(R);
  if (run) { symlinkSync('..', join(home, '.rehearsal')); makeMissing(home); }
  put('usr/local/sbin/spark-console-root', readFileSync(HELPER_SRC), 0o755);
  put('etc/passwd', `root:x:0:0:root:/root:/bin/bash\nowner:x:1000:1000::${run ? `/${spark}` : realpathSync(home)}:/bin/bash\n`);
  put('etc/group', 'root:x:0:\nowner:x:1000:\ndocker:x:999:owner\n');
  put('etc/sudoers.d/spark-console-root', 'owner ALL=(root) NOPASSWD: /usr/local/sbin/spark-console-root\n', 0o440);
  put('proc/1/comm', 'systemd\n');
  put('proc/sys/kernel/osrelease', '6.11.0-1016-nvidia\n');
  put('proc/swaps', 'Filename\tType\tSize\tUsed\tPriority\n');
  put('sys/fs/cgroup/cgroup.controllers', 'cpu io memory pids\n');
  mkdirSync(join(R, 'standin'), { recursive: true });
  for (const [k, v] of Object.entries(knobs)) put(`standin/${k}`, v);
  if (homeThere) put('standin/home');
  if (prove) {
    const real = realpathSync(R), p = spawnSync(join(real, 'usr/local/sbin/spark-console-root'), ['prove', '--id', 'prepared00001'], { env: rehearsalEnv(realpathSync(home), real), encoding: 'utf8', timeout: 120000 });
    assert.equal(p.status, 0, p.stdout + p.stderr);
  }
  return R;
}
