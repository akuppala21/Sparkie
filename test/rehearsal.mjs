// The root helper (deploy/spark-console-root) set up on a stand-in Spark as the owner's one-time command leaves it, as a
// rehearsal: ~/.rehearsal under that Spark's home holds a made-up root (/etc, /proc, /sys, /usr/local/sbin) with the real
// helper and its sudo line, and the helper's proof of its walls has passed there. The stand-ins in test/mock/bin run it:
// sudo (its rehearsal case), systemd-run, systemctl, unshare and setpriv. They build no wall: a command runs unwalled.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, chmodSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MOCKBIN = join(REPO, 'test', 'mock', 'bin');
export const HELPER_SRC = join(REPO, 'deploy', 'spark-console-root');
export const rehearsalEnv = (home, R) => ({ PATH: `${MOCKBIN}:/usr/bin:/bin`, HOME: home, SPARK_CONSOLE_REHEARSAL: R, SUDO_UID: '1000', SUDO_USER: 'owner', SUDO_GID: '1000' });

export function rehearse(root, spark, { prove = true, knobs = {} } = {}) {
  const home = join(root, spark), R = join(home, '.rehearsal');
  const put = (p, text = '', mode) => { mkdirSync(dirname(join(R, p)), { recursive: true }); writeFileSync(join(R, p), text); if (mode) chmodSync(join(R, p), mode); };
  mkdirSync(join(R, 'usr/local/sbin'), { recursive: true });
  for (const d of ['', 'usr', 'usr/local', 'usr/local/sbin']) chmodSync(join(R, d), 0o755);
  put('usr/local/sbin/spark-console-root', readFileSync(HELPER_SRC), 0o755);
  put('etc/passwd', `root:x:0:0:root:/root:/bin/bash\nowner:x:1000:1000::${realpathSync(home)}:/bin/bash\n`);
  put('etc/group', 'root:x:0:\nowner:x:1000:\ndocker:x:999:owner\n');
  put('etc/sudoers.d/spark-console-root', 'owner ALL=(root) NOPASSWD: /usr/local/sbin/spark-console-root\n', 0o440);
  put('proc/1/comm', 'systemd\n');
  put('proc/sys/kernel/osrelease', '6.11.0-1016-nvidia\n');
  put('proc/swaps', 'Filename\tType\tSize\tUsed\tPriority\n');
  put('sys/fs/cgroup/cgroup.controllers', 'cpu io memory pids\n');
  mkdirSync(join(R, 'standin'), { recursive: true });
  for (const [k, v] of Object.entries(knobs)) put(`standin/${k}`, v);
  if (prove) {
    const real = realpathSync(R), p = spawnSync(join(real, 'usr/local/sbin/spark-console-root'), ['prove', '--id', 'prepared00001'], { env: rehearsalEnv(realpathSync(home), real), encoding: 'utf8', timeout: 120000 });
    assert.equal(p.status, 0, p.stdout + p.stderr);
  }
  return R;
}
