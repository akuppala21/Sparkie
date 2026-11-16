// Covers: The root helper (R42): deploy/spark-console-root, the proof of its walls, and the owner's one-time command,
// deploy/root-for-sparkie.sh. The exact settings of the look and run walls for ordinary and hostile commands, with the
// command's bytes held unchanged; every refusal; what a Spark must have and when the proof's mark is out of date; the
// proof naming each attempt that gets through, and failing when it could not show an attempt working outside the walls;
// the one-time command's order, its staging as root, a swapped copy caught, --check, --undo and the hub; and the real
// proof run with no wall. Rehearsals with stand-ins only: they build no wall, so a Spark's own proof decides the rest.
//
// Rehearsals only: the helper runs as this user against a made-up Spark in a temporary folder
// (SPARK_CONSOLE_REHEARSAL), with the stand-ins in test/mock/bin (systemd-run, systemctl, unshare, setpriv, visudo);
// the one-time command also gets stand-ins of its own here for ssh, sudo and systemd-id128, ahead of the power work's
// test/mock/bin/sudo on PATH. Nothing in the console calls the helper yet. No fleet starts.
// What this cannot show: the stand-ins build no wall. These tests show the helper asks for exactly the right walls and
// acts on the proof's answers; that a Spark grants them is decided by the proof itself, on each real Spark. The last
// group runs the proof's own attempts with no wall at all, to show each one does get through when nothing stops it.
// Linux only (GNU coreutils, bash 4 or newer): run it on a Spark with tools/test-on-spark.sh.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync, realpathSync, symlinkSync, readdirSync, copyFileSync, utimesSync, statSync, renameSync, lstatSync, readlinkSync } from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import './file-limit.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const MOCKBIN = join(REPO, 'test', 'mock', 'bin');
const HELPER_SRC = join(REPO, 'deploy', 'spark-console-root');
const SETUP_SRC = join(REPO, 'deploy', 'root-for-sparkie.sh');
const sha = s => createHash('sha256').update(s).digest('hex');
const temps = [];
process.on('exit', () => { for (const t of temps) rmSync(t, { recursive: true, force: true }); });
let ids = 0;
const newId = () => `call${String(++ids).padStart(6, '0')}`;

// A made-up Spark: the files the helper reads, under one folder. The owner (1000) is in adm, sudo, video, docker, lxd
// and render; another account (1001) has a key and a history of its own.
function spark({ installed = true, systemd, knobs = {} } = {}) {
  const R = realpathSync(mkdtempSync(join(tmpdir(), 'root-helper-')));
  temps.push(R);
  chmodSync(R, 0o755);
  const put = (p, text = '', mode) => {
    mkdirSync(dirname(join(R, p)), { recursive: true });
    writeFileSync(join(R, p), text);
    if (mode) chmodSync(join(R, p), mode);
  };
  const dir = p => mkdirSync(join(R, p), { recursive: true });
  dir('usr/local/sbin');
  if (installed) put('usr/local/sbin/spark-console-root', readFileSync(HELPER_SRC), 0o755);
  for (const d of ['usr/local/sbin', 'usr/local', 'usr']) chmodSync(join(R, d), 0o755);
  put('etc/passwd', 'root:x:0:0:root:/root:/bin/bash\ndaemon:x:1:1::/usr/sbin:/usr/sbin/nologin\n'
    + 'owner:x:1000:1000:The Owner:/home/owner:/bin/bash\nother:x:1001:1001::/home/other:/bin/bash\n'
    + 'nobody:x:65534:65534::/nonexistent:/usr/sbin/nologin\n');
  put('etc/group', 'root:x:0:\nadm:x:4:owner\nsudo:x:27:owner\nvideo:x:44:owner,other\nowner:x:1000:\nother:x:1001:\n'
    + 'docker:x:999:owner\nlxd:x:998:owner\nrender:x:992:owner\n');
  put('etc/shadow', 'secret');
  put('etc/gshadow', 'secret');
  put('etc/ssh/ssh_host_ed25519_key', 'private');
  put('etc/ssh/ssh_host_ed25519_key.pub', 'public');
  dir('etc/sudoers.d');
  put('proc/1/comm', 'systemd\n');
  put('proc/sys/kernel/osrelease', '6.11.0-1016-nvidia\n');
  put('proc/swaps', 'Filename\t\t\t\tType\t\tSize\t\tUsed\t\tPriority\n/swap.img                               file\t\t8388604\t\t0\t\t-2\n');
  put('swap.img');
  put('sys/fs/cgroup/cgroup.controllers', 'cpu io memory pids\n');
  for (const d of ['run/systemd/resolve', 'root', 'var/lib/docker', 'var/lib/tailscale']) dir(d);
  const h = 'home/owner';
  put(`${h}/.ssh/id_ed25519`, 'private');
  put(`${h}/.ssh/id_ed25519.pub`, 'public');
  put(`${h}/.ssh/authorized_keys`, 'keys');
  put(`${h}/.ssh/known_hosts`, 'hosts');
  symlinkSync('/etc/shadow', join(R, h, '.ssh/config'));   // a link is never put back
  put(`${h}/.bashrc`);
  put(`${h}/.profile`);
  // Every name the run wall holds that must be there (MUST_BE_THERE), as the one-time command leaves a home.
  for (const f of ['.bash_profile', '.bash_logout', '.bash_aliases', '.pam_environment']) put(`${h}/${f}`);
  for (const d of ['.docker', '.config/systemd', '.config/environment.d', '.config/autostart', '.config/user-tmpfiles.d',
    '.local/share/systemd', '.local/share/user-tmpfiles.d', '.cache/spark-console', '.local/share/spark-console',
    '.local/share/spark-portal/workspaces/shared/jobs']) dir(`${h}/${d}`);
  put(`${h}/.config/spark-console/secrets.json`, '{}');
  put(`${h}/.local/state/spark-console/api.sock`);
  put(`${h}/.local/state/spark-console/sessions.json`, '{}');
  put(`${h}/.local/state/spark-console/desired.json`, '{}');
  // What the owner and Sparkie said, as Spark 2 keeps it (with the copies beside it): never put back.
  for (const f of ['chats.json', 'memory.json', 'memory-past.json', 'audit.jsonl', 'saved-workflows.json', 'memory.json.prev', 'audit.jsonl.1']) {
    put(`${h}/.local/state/spark-console/${f}`, '"the owner said"');
  }
  put(`${h}/.cache/huggingface/token`, 'hf_x');
  dir(`${h}/spark-console-src`);
  dir(`${h}/models`);
  put('home/other/.ssh/id_rsa', 'private');
  put('home/other/.bash_history', 'ls');
  dir('standin');
  if (systemd) put('standin/systemd-version', systemd);
  for (const [k, v] of Object.entries(knobs)) put(`standin/${k}`, v);
  const work = join(R, 'work', 'a folder with spaces');
  mkdirSync(work, { recursive: true });
  const env = { PATH: `${MOCKBIN}:/usr/bin:/bin`, SPARK_CONSOLE_REHEARSAL: R, SUDO_UID: '1000', SUDO_USER: 'owner', SUDO_GID: '1000' };
  return { R, env, put, work };
}
const run = (s, args, { env = s.env, input, file = join(s.R, 'usr/local/sbin/spark-console-root') } = {}) =>
  spawnSync(file, args, { env, input, encoding: 'utf8', timeout: 120000 });
const calls = s => (existsSync(join(s.R, 'calls.log')) ? readFileSync(join(s.R, 'calls.log'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const unitCall = (s, unit) => calls(s).find(c => c[0] === 'systemd-run' && c.includes(`--unit=${unit}`));
const started = s => calls(s).filter(c => c[0] === 'systemd-run' && c.some(a => /^--unit=sw-(look|run)-/.test(a)));
const which = (s, cmd) => spawnSync('bash', ['-c', `command -v ${cmd}`], { env: s.env, encoding: 'utf8' }).stdout.trim();
function prove(s, id = newId()) {
  const r = run(s, ['prove', '--id', id]);
  return { ...r, id };
}
function look(s, cmd, { id = newId(), hash = sha(cmd), secs = 30, dir = s.work, extra = [] } = {}) {
  return { ...run(s, ['look', '--id', id, '--sha256', hash, '--seconds', String(secs), '--dir', dir, ...extra, '--', cmd]), id };
}
function change(s, cmd, { id = newId(), hash = sha(cmd), secs = 600, dir = s.work, extra = [], input } = {}) {
  return { ...run(s, ['run', '--id', id, '--sha256', hash, '--seconds', String(secs), '--dir', dir, ...extra, '--', cmd], { input }), id };
}
const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const refused = (r, why) => {
  assert.equal(r.status, 125, r.stdout + r.stderr);
  assert.match(r.stdout, new RegExp(`^${r.id ? `${r.id} ` : ''}refused: ${esc(why)}`), r.stdout);
  assert.equal(r.stdout.split('\n').length, 2, 'one line');
};

// The hidden list for the made-up Spark above, in the helper's order: folders, then single files, then what is put
// back read-only. /home/owner/.ssh/config is a link, so it stays hidden; the run wall adds name look-up. .docker is
// hidden whole, and so is the state folder, with its plain files but the sign-in files and the sockets put back.
// The owner's start files and the service manager's folders are hidden (R63), not only read-only.
const START = ['/home/owner/.profile', '/home/owner/.bashrc', '/home/owner/.bash_profile', '/home/owner/.bash_logout',
  '/home/owner/.bash_aliases', '/home/owner/.pam_environment'];
const UNIT_DIRS = ['/home/owner/.config/systemd', '/home/owner/.config/environment.d', '/home/owner/.config/autostart',
  '/home/owner/.config/user-tmpfiles.d', '/home/owner/.local/share/systemd', '/home/owner/.local/share/user-tmpfiles.d'];
const HIDDEN = (extra = []) => [
  ...['/home/owner/.ssh', ...UNIT_DIRS, '/home/owner/.config/spark-console', ...extra.filter(p => p.startsWith('/home/owner/')),
    '/home/owner/.docker', '/home/owner/.local/state/spark-console',
    '/home/other/.ssh', '/run', '/root', '/var/lib/tailscale', '/var/lib/docker', ...extra.filter(p => p.startsWith('/var/'))]
    .flatMap(p => ['-p', `TemporaryFileSystem=${p}:ro`]),
  ...[...START, '/home/owner/.cache/huggingface/token', '/home/other/.bash_history', '/etc/shadow', '/etc/gshadow',
    '/etc/ssh/ssh_host_ed25519_key', '/swap.img'].flatMap(p => ['-p', `InaccessiblePaths=${p}`]),
  ...['/home/owner/.ssh/authorized_keys', '/home/owner/.ssh/known_hosts', '/home/owner/.ssh/id_ed25519.pub',
    '/home/owner/.local/state/spark-console/desired.json'].flatMap(p => ['-p', `BindReadOnlyPaths=${p}`]),
];
// The read-only list of a plain change; with --open (no hidden list) the start files and units are read-only first.
const READ_ONLY = ['/home/owner/.cache/spark-console', '/home/owner/spark-console-src', '/usr/local/sbin/spark-console-root'];
const OPEN_READ_ONLY = [...START, ...UNIT_DIRS, ...READ_ONLY];
// The folders above a held path in the owner's home, each bound onto itself (so none can be moved), in order: with
// --open all of them; in a plain change only those inside the top's writable folders (the rest of the top is
// read-only, R63). The jobs' shared folder and their output folder are held places, bound with --open.
const SHARED_PINS = ['/home/owner/.local/share/spark-portal', '/home/owner/.local/share/spark-portal/workspaces',
  '/home/owner/.local/share/spark-portal/workspaces/shared', '/home/owner/.local/share/spark-portal/workspaces/shared/jobs'];
const PINS = ['/home/owner/.cache/huggingface'];
const HOME_RW = ['/home/owner/models', '/home/owner/.cache'];
const LAN = '10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10 fc00::/7 fe80::/10';
// Every look: the same settings, whatever the command says.
const LOOK_WALL = ['-p', 'DynamicUser=yes', '-p', 'AmbientCapabilities=CAP_DAC_READ_SEARCH',
  '-p', 'CapabilityBoundingSet=CAP_DAC_READ_SEARCH', '-p', 'NoNewPrivileges=yes', '-p', 'SystemCallFilter=~open_by_handle_at',
  '-p', 'SystemCallErrorNumber=EPERM', '-p', 'SystemCallArchitectures=native', '-p', 'ProtectSystem=strict',
  '-p', 'ProtectHome=read-only', '-p', 'ProtectKernelTunables=yes', '-p', 'ProtectControlGroups=yes', '-p', 'PrivateTmp=yes',
  '-p', 'PrivateIPC=yes', '-p', 'PrivateNetwork=yes', '-p', 'PrivateDevices=yes', '-p', 'TemporaryFileSystem=/dev/shm:ro',
  '-p', 'ReadOnlyPaths=/'];
function lookCall(s, id, hash, secs, hiddenExtra = ['/home/owner/.local/share/spark-console', '/var/lib/spark-console']) {
  return ['systemd-run', `--unit=sw-look-${id}`, `--description=Spark Console look ${id} sha256 ${hash}`, '--wait', '--pipe',
    '--collect', '--quiet', ...LOOK_WALL, ...HIDDEN(hiddenExtra), '-p', `BindReadOnlyPaths=/run/spark-console/${id}`,
    '-p', `RuntimeMaxSec=${secs}`, '-p', 'TimeoutStopSec=5', '-p', 'MemoryMax=2G', '-p', 'TasksMax=512',
    '--', which(s, 'bash'), '--noprofile', '--norc', `/run/spark-console/${id}/start`];
}
function runCall(s, id, hash, secs, { protect = [], pins = PINS, rw = HOME_RW, hiddenExtra = ['/home/owner/.local/share/spark-console', '/var/lib/spark-console'], memory = '8G' } = {}) {
  return ['systemd-run', `--unit=sw-run-${id}`, `--description=Spark Console run ${id} sha256 ${hash}`, '--wait', '--pipe',
    '--collect', '--quiet', '-p', 'NoNewPrivileges=yes', '-p', 'PrivateTmp=yes', '-p', `IPAddressDeny=localhost ${LAN}`,
    '-p', 'IPAddressAllow=127.0.0.53', '-p', 'PrivateIPC=yes', '-p', 'TemporaryFileSystem=/dev/shm:mode=1777,nosuid', '-p', 'PrivateDevices=yes',
    ...HIDDEN(hiddenExtra), '-p', 'BindReadOnlyPaths=/run/systemd/resolve',
    ...[...READ_ONLY, ...protect].flatMap(p => ['-p', `ReadOnlyPaths=${p}`]), '-p', 'ReadOnlyPaths=/home/owner',
    ...rw.flatMap(p => ['-p', `ReadWritePaths=${p}`]),
    ...[...pins].sort().flatMap(p => ['-p', `BindPaths=${p}`]), '-p', `BindReadOnlyPaths=/run/spark-console/${id}`,
    '-p', `RuntimeMaxSec=${secs}`, '-p', 'TimeoutStopSec=5', '-p', `MemoryMax=${memory}`, '-p', 'MemorySwapMax=0',
    '-p', 'CPUWeight=20', '-p', 'IOWeight=20', '-p', 'TasksMax=4096',
    '--', which(s, 'unshare'), '--pid', '--fork', '--kill-child', '--mount-proc',
    which(s, 'setpriv'), '--reuid=1000', '--regid=1000', '--groups=1000,44,992', '--inh-caps=-all', '--bounding-set=-all',
    which(s, 'bash'), '--noprofile', '--norc', `/run/spark-console/${id}/start`];
}
const proven = (opts) => { const s = spark(opts); const p = prove(s); assert.equal(p.status, 0, p.stdout + p.stderr); return s; };

describe('the walls asked for', () => {
  const s = proven();
  // Commands a brain could write: quotes, new lines, $() and backticks, a leading dash, %, ${…}, backslashes, a very
  // long line, words that look like the helper's own options.
  const HOSTILE = [
    [`printf '%s\\n' "it's \\"quoted\\"" 'single '"'"'mixed'"'"''`, `it's "quoted"\nsingle 'mixed'\n`],
    ["printf 'one\\n'\nprintf 'two\\n'\n", 'one\ntwo\n'],
    ["echo \"$(printf sub)\" '$(not run)' `printf tick`", 'sub $(not run) tick\n'],
    ['--version 2>/dev/null; echo after', 'after\n'],
    ["printf '%s\\n' '%n %h %% ${HOME} $HOME'", '%n %h %% ${HOME} $HOME\n'],
    ["printf '%s\\n' 'back\\\\slash ünï'", 'back\\\\slash ünï\n'],
    ['echo -- --sha256 0000 --id evil --open', '-- --sha256 0000 --id evil --open\n'],
    [`: ${'x'.repeat(100000)}\necho long`, 'long\n'],
  ];

  test('a look: exactly the look wall, the same for every command; the bytes arrive unchanged and run in the folder named', () => {
    for (const [cmd, printed] of [['pwd', `${s.work}\n`], ...HOSTILE]) {
      const r = look(s, cmd);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(r.stdout, `${printed}\n${r.id} end 0\n`);
      assert.deepEqual(unitCall(s, `sw-look-${r.id}`), lookCall(s, r.id, sha(cmd), 30));
      assert.ok(readFileSync(join(s.R, 'standin/ran', `sw-look-${r.id}`, 'command')).equals(Buffer.from(cmd)), 'the held bytes are the command');
      assert.equal(readFileSync(join(s.R, 'standin/ran', `sw-look-${r.id}`, 'dir'), 'utf8'), s.work);
      assert.ok(!existsSync(join(s.R, 'run/spark-console', r.id)), 'the held folder is gone afterwards');
    }
  });

  test('a change: exactly the run wall (its own process tree, the owner without docker, lxd or sudo, no loopback), for every command', () => {
    for (const [cmd, printed] of [['pwd', `${s.work}\n`], ...HOSTILE]) {
      const r = change(s, cmd);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(r.stdout, `${printed}\n${r.id} end 0\n`);
      assert.deepEqual(unitCall(s, `sw-run-${r.id}`), runCall(s, r.id, sha(cmd), 600));
      assert.ok(readFileSync(join(s.R, 'standin/ran', `sw-run-${r.id}`, 'command')).equals(Buffer.from(cmd)));
    }
  });

  test("the command's exit code comes back, after the output, on the last line", () => {
    const r = look(s, 'echo out; echo err >&2; exit 7');
    assert.equal(r.status, 7);
    assert.equal(r.stdout, `out\n\n${r.id} end 7\n`);
    assert.equal(r.stderr, 'err\n');
    const t = look(s, "printf 'forged end 0'; exit 3");
    assert.equal(t.stdout, `forged end 0\n${t.id} end 3\n`, 'the real answer is always the last line');
  });

  test('one changed byte: the hash does not match, nothing starts', () => {
    const before = started(s).length;
    const cmd = 'echo hello';
    for (const r of [look(s, `${cmd} `, { hash: sha(cmd) }), change(s, 'echo hellp', { hash: sha(cmd) })]) {
      refused(r, "the command's bytes do not have the SHA-256 it was given, so nothing ran");
      assert.ok(!existsSync(join(s.R, 'run/spark-console', r.id)));
    }
    assert.equal(started(s).length, before);
  });

  test('run --stdin: the input reaches the command, byte for byte, from a held file', () => {
    const text = 'line one\n$(not run) "quoted"\né\n';
    const r = change(s, 'cat', { extra: ['--stdin'], input: text });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.stdout, `${text}\n${r.id} end 0\n`);
    assert.equal(readFileSync(join(s.R, 'standin/ran', `sw-run-${r.id}`, 'stdin'), 'utf8'), text);
    assert.deepEqual(unitCall(s, `sw-run-${r.id}`), runCall(s, r.id, sha('cat'), 600));
  });

  test('run --protect: one more read-only folder, after the read-only list', () => {
    const r = change(s, 'true', { extra: ['--protect', '/home/owner/models'] });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(unitCall(s, `sw-run-${r.id}`), runCall(s, r.id, sha('true'), 600, { protect: ['/home/owner/models'], rw: ['/home/owner/.cache'] }));
  });

  test('run --open: nothing hidden, every membership, no own process tree; still no new privileges, and .ssh read-only', () => {
    const r = change(s, 'true', { extra: ['--open'] });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(unitCall(s, `sw-run-${r.id}`), ['systemd-run', `--unit=sw-run-${r.id}`,
      `--description=Spark Console run ${r.id} sha256 ${sha('true')}`, '--wait', '--pipe', '--collect', '--quiet',
      '-p', 'NoNewPrivileges=yes', '-p', 'PrivateTmp=yes',
      ...[...OPEN_READ_ONLY.slice(0, -1), '/home/owner/.ssh', OPEN_READ_ONLY.at(-1)].flatMap(p => ['-p', `ReadOnlyPaths=${p}`]),
      ...['/home/owner/.cache', '/home/owner/.config', '/home/owner/.local', '/home/owner/.local/share', ...SHARED_PINS].flatMap(p => ['-p', `BindPaths=${p}`]),
      '-p', `BindReadOnlyPaths=/run/spark-console/${r.id}`, '-p', 'RuntimeMaxSec=600', '-p', 'TimeoutStopSec=5',
      '-p', 'MemoryMax=8G', '-p', 'MemorySwapMax=0', '-p', 'CPUWeight=20', '-p', 'IOWeight=20', '-p', 'TasksMax=4096',
      '--', which(s, 'setpriv'), '--reuid=1000', '--regid=1000', '--groups=1000,4,27,44,999,998,992', '--inh-caps=-all',
      '--bounding-set=-all', which(s, 'bash'), '--noprofile', '--norc', `/run/spark-console/${r.id}/start`]);
  });

  test('what a caller cannot ask for is refused, and nothing starts', () => {
    const before = started(s).length;
    const ok = sha('true');
    const cases = [
      [['look', '--id', newId(), '--sha256', ok, '--seconds', '30', '--dir', s.work, '--open', '--', 'true'], 'a look never takes --open'],
      [['look', '--id', newId(), '--sha256', ok, '--seconds', '30', '--dir', s.work, '--stdin', '--', 'true'], 'a look takes no input'],
      [['look', '--id', newId(), '--sha256', ok, '--seconds', '61', '--dir', s.work, '--', 'true'], 'a look is held to 60 seconds'],
      [['look', '--id', newId(), '--sha256', ok, '--seconds', '30', '--dir', s.work, '--protect', '/home/owner/models', '--', 'true'], '--protect is for run'],
      [['run', '--id', newId(), '--sha256', ok, '--seconds', '7201', '--dir', s.work, '--', 'true'], 'a change is held to 120 minutes'],
      [['run', '--id', newId(), '--sha256', ok, '--seconds', '0', '--dir', s.work, '--', 'true'], '--seconds must be'],
      [['run', '--id', newId(), '--sha256', ok.toUpperCase(), '--seconds', '5', '--dir', s.work, '--', 'true'], '--sha256 must be'],
      [['run', '--id', newId(), '--sha256', ok, '--seconds', '5', '--dir', 'relative', '--', 'true'], '--dir must be'],
      [['run', '--id', newId(), '--sha256', ok, '--seconds', '5', '--dir', `${s.work}\nx`, '--', 'true'], '--dir must be'],
      [['run', '--id', newId(), '--sha256', ok, '--seconds', '5', '--dir', s.work, '--', 'true', 'two'], 'the command must be one word'],
      [['run', '--id', newId(), '--sha256', sha(''), '--seconds', '5', '--dir', s.work, '--', ''], 'the command is empty'],
      [['run', '--id', newId(), '--sha256', ok, '--seconds', '5', '--dir', s.work, 'true'], 'not understood'],
      [['run', '--id', newId(), '--sha256', ok, '--seconds', '5', '--dir', s.work, '--network', '--', 'true'], 'not understood'],
      [['run', '--id', newId(), '--id', newId(), '--sha256', ok, '--seconds', '5', '--dir', s.work, '--', 'true'], '--id is given twice'],
      [['run', '--id', newId(), '--sha256', ok, '--seconds', '5', '--dir', s.work, '--protect', 'home/owner/models', '--', 'true'], '--protect must name a whole path'],
      [['run', '--id', newId(), '--sha256', ok, '--seconds', '5', '--dir', s.work, '--protect', '/home/owner/my models', '--', 'true'], '--protect must name a whole path'],
      [['run', '--id', newId(), '--sha256', ok, '--seconds', '5', '--dir', s.work, '--protect', '/home/owner/nothing', '--', 'true'], '--protect must name a folder that is there'],
      [['run', '--id', newId(), '--sha256', ok, '--seconds', '5', '--dir', s.work, '--protect', '/home/owner/.ssh/config', '--', 'true'], '--protect must name a folder that is there'],
      [['run', '--id', newId(), '--sha256', ok, '--seconds', '5', '--dir', s.work, ...Array(9).fill(['--protect', '/home/owner/models']).flat(), '--', 'true'], 'at most 8 --protect'],
      [['check', '--id', newId(), '--seconds', '5'], 'check takes --id and nothing else'],
      [['prove', '--id', newId(), '--', 'true'], 'prove takes --id and nothing else'],
      [['look', '--id', 'UPPER-case', '--sha256', ok, '--seconds', '5', '--dir', s.work, '--', 'true'], 'no --id'],
      [['look', '--sha256', ok, '--seconds', '5', '--dir', s.work, '--', 'true'], 'no --id'],
      [['shell', '--id', newId()], 'no such verb'],
    ];
    for (const [args, why] of cases) {
      const r = run(s, args);
      const id = args[args.indexOf('--id') + 1];
      refused({ ...r, id: /^[a-z0-9]{8,40}$/.test(id) && args.indexOf('--id') >= 0 ? id : '' }, why);
    }
    const id = newId();
    mkdirSync(join(s.R, 'run/spark-console', id));   // a call with this id still under way
    refused(look(s, 'true', { id }), 'this id was used already');
    assert.equal(started(s).length, before);
  });

  test('a held folder left by a killed call is removed by a later one once no unit can still use it; a newer one stays', () => {
    const old = join(s.R, 'run/spark-console', 'killed000old'), recent = join(s.R, 'run/spark-console', 'killed000new');
    for (const d of [old, recent]) { mkdirSync(d); writeFileSync(join(d, 'command'), 'x'); }
    const then = new Date(Date.now() - 131 * 60000);
    utimesSync(old, then, then);
    assert.equal(look(s, 'true').status, 0);
    assert.ok(!existsSync(old), 'older than the longest unit (120 minutes and 10 more): removed');
    assert.ok(existsSync(recent), 'a newer one may still be in use: kept');
    assert.ok(existsSync(join(s.R, 'run/spark-console/prove.lock')), 'not a held folder: kept');
  });

  test('root is off until the owner turns it on: refused before anything else of the call is read', () => {
    const before = calls(s).length;
    const r = run(s, ['root', '--id', newId(), '--sha256', sha('id'), '--seconds', '5', '--dir', s.work, '--', 'id']);
    assert.equal(r.status, 125);
    assert.match(r.stdout, /^call\d+ refused: root is off on this Spark: the owner turns it on with the one command \(--with-root\)\n$/);
    assert.equal(calls(s).length, before, 'nothing was asked of systemd');
  });

  test('check: what the Spark has, whether the proof is current, and each wall', () => {
    const id = newId();
    const r = run(s, ['check', '--id', id]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.stdout, [
      `helper ${sha(readFileSync(HELPER_SRC))}`, 'systemd 255.4-1ubuntu8.4 ok', 'first-process ok', 'cgroup2 ok', 'unshare ok',
      'setpriv ok', 'python3 ok', 'files ok', 'kernel 6.11.0-1016-nvidia', 'proof current', 'look ready', 'run ready',
      'root off: the owner turns it on with the one command (--with-root)'].map(l => `${id} ${l}\n`).join(''));
  });
});

describe('who may call it, and from where', () => {
  const s = proven();
  test('only through sudo, by an ordinary account that /etc/passwd knows', () => {
    const base = { PATH: s.env.PATH, SPARK_CONSOLE_REHEARSAL: s.R };
    for (const [env, why] of [
      [base, 'not called through sudo by an account'],
      [{ ...base, SUDO_UID: '0', SUDO_USER: 'root' }, 'called by an account that is not an ordinary one'],
      [{ ...base, SUDO_UID: '999', SUDO_USER: 'owner' }, 'called by an account that is not an ordinary one'],
      [{ ...base, SUDO_UID: '1001', SUDO_USER: 'owner' }, 'the account sudo names is not in /etc/passwd with that number'],
      [{ ...base, SUDO_UID: '1000', SUDO_USER: 'Owner;x' }, 'not called through sudo by an account'],
    ]) {
      const id = newId();
      refused({ ...run(s, ['check', '--id', id], { env }), id }, why);
    }
  });
  test('run by anyone but root, it needs its rehearsal folder; and it runs only as the installed file', () => {
    const { SPARK_CONSOLE_REHEARSAL, ...noFolder } = s.env;
    refused(run(s, ['check', '--id', newId()], { env: noFolder }), 'only root runs this, through sudo');
    refused(run(s, ['check', '--id', newId()], { env: { ...s.env, SPARK_CONSOLE_REHEARSAL: 'relative' } }), 'only root runs this');
    refused(run(s, ['check', '--id', newId()], { file: HELPER_SRC }), 'this is not the installed helper, /usr/local/sbin/spark-console-root');
  });
  test('the helper refuses when another account could change it: its file, or a folder above it', () => {
    for (const p of ['usr/local/sbin/spark-console-root', 'usr/local/sbin', 'usr/local', 'usr', '']) {
      const t = proven();
      chmodSync(join(t.R, p), p.endsWith('root') ? 0o775 : 0o777);
      const shown = `/${p}`.replace(/^\/$/, '/');
      const c = run(t, ['check', '--id', newId()]);
      assert.match(c.stdout, new RegExp(`files ${shown.replace(/[.]/g, '\\.')} can be written by its group or by everyone\n`), c.stdout);
      assert.match(c.stdout, /look refuses: .* can be written by its group or by everyone\n/);
      refused(look(t, 'true'), `${shown} can be written by its group or by everyone`);
      refused(prove(t), `${shown} can be written by its group or by everyone`);
    }
  });
});

describe('what the run wall holds in the home', () => {
  test('a name it must hold that is not there (.bashrc): run is refused by name and starts nothing; a look still runs', () => {
    const s = proven();
    rmSync(join(s.R, 'home/owner/.bashrc'));
    const before = started(s).length;
    for (const extra of [[], ['--open']]) refused(change(s, 'true', { extra }), '/home/owner/.bashrc is not there, so it cannot be held: run the one-time command again');
    assert.equal(started(s).length, before, 'no unit');
    assert.equal(look(s, 'true').status, 0);
    const c = run(s, ['check', '--id', newId()]);
    assert.match(c.stdout, / look ready\n.* run refuses: \/home\/owner\/\.bashrc is not there, so it cannot be held/s, c.stdout);
  });
  test('a held name that is a link (.config/systemd), or a held name under a linked folder: run is refused by name', () => {
    const s = proven();
    const d = join(s.R, 'home/owner/.config/systemd');
    rmSync(d, { recursive: true });
    mkdirSync(join(s.R, 'home/owner/elsewhere'));
    symlinkSync(join(s.R, 'home/owner/elsewhere'), d);
    refused(change(s, 'true'), '/home/owner/.config/systemd is a link, or under one, so the wall would hold only what it points at');
    assert.equal(look(s, 'true').status, 0);
    const t = proven();
    const ui = join(t.R, 'home/owner/.local/share/user-tmpfiles.d');
    rmSync(ui, { recursive: true });
    symlinkSync(join(t.R, 'home/owner/.cache'), ui);
    refused(change(t, 'true'), '/home/owner/.local/share/user-tmpfiles.d is a link');
  });
  test('a held name under a linked folder (.local/share moved aside and linked back): run is refused by name', () => {
    const s = proven();
    const share = join(s.R, 'home/owner/.local/share');
    renameSync(share, join(s.R, 'home/owner/.local/share-real'));
    symlinkSync(join(s.R, 'home/owner/.local/share-real'), share);
    refused(change(s, 'true'), '/home/owner/.local/share/systemd is a link, or under one, so the wall would hold only what it points at');
    refused(look(s, 'true'), '/home/owner/.local/share/spark-console is a link, or under one, so a look would see what it points at');
  });
  test('a link a change left at a listed name that was not there is left alone in both walls, and check names it; changes still run', () => {
    const s = proven();
    symlinkSync('.profile', join(s.R, 'home/owner/.zshrc'));            // a dotfiles tool does this
    symlinkSync(join(s.R, 'home/owner'), join(s.R, 'home/owner/.npmrc')); // a link to the home at a hidden name
    const r = change(s, 'true'), l = look(s, 'true');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(l.status, 0, l.stdout + l.stderr);
    for (const c of [unitCall(s, `sw-run-${r.id}`), unitCall(s, `sw-look-${l.id}`)]) {
      assert.ok(!c.some(a => a.includes('.zshrc') || a.includes('.npmrc')), c.filter(a => a.includes('.zshrc') || a.includes('.npmrc')).join(' '));
    }
    const c = run(s, ['check', '--id', newId()]).stdout;
    assert.match(c, / links not held, left alone: \.zshrc \.npmrc\n/, c);   // (.zshrc is on the hidden list now, before .npmrc: R63)
    assert.match(c, / run ready\n/, c);
  });
  test('a login shell that is not bash, sh or dash: run is refused by name, and a look still runs', () => {
    const s = proven();
    s.put('etc/passwd', readFileSync(join(s.R, 'etc/passwd'), 'utf8').replace(':/home/owner:/bin/bash', ':/home/owner:/usr/bin/zsh'));
    const before = started(s).length;
    refused(change(s, 'true'), "the owner's login shell is zsh; the run wall holds bash's start files only");
    assert.equal(started(s).length, before);
    assert.equal(look(s, 'true').status, 0);
    s.put('etc/passwd', readFileSync(join(s.R, 'etc/passwd'), 'utf8').replace(':/usr/bin/zsh', ':/bin/dash'));
    assert.equal(change(s, 'true').status, 0, 'dash reads .profile, which is held');
  });
  test("the console's own folder on a compute Spark must be there (a change could make it, with a link inside)", () => {
    const s = proven();
    rmSync(join(s.R, 'home/owner/.local/share/spark-console'), { recursive: true });
    refused(change(s, 'true'), '/home/owner/.local/share/spark-console is not there, so it cannot be held: run the one-time command again');
  });
  test('a --protect folder under a read-only folder: no folder inside the read-only one is pinned (a pin there would be writable)', () => {
    const s = proven();
    mkdirSync(join(s.R, 'home/owner/.cache/spark-console/a/b'), { recursive: true });
    const r = change(s, 'true', { extra: ['--protect', '/home/owner/.cache/spark-console/a/b'] });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const c = unitCall(s, `sw-run-${r.id}`);
    assert.ok(c.includes('ReadOnlyPaths=/home/owner/.cache/spark-console/a/b'));
    assert.ok(!c.some(a => a.startsWith('BindPaths=/home/owner/.cache/spark-console')), c.filter(a => a.startsWith('BindPaths=')).join(' '));
  });
  test("the jobs' shared folder holds its place: it and its jobs folder are bound onto themselves, must be there, and must be real", () => {
    const s = proven();
    const r = change(s, 'true');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    // (a plain change: read-only with the top of the home, so not bound; with --open, bound onto itself)
    for (const p of SHARED_PINS) assert.ok(!unitCall(s, `sw-run-${r.id}`).includes(`BindPaths=${p}`) && unitCall(s, `sw-run-${r.id}`).includes('ReadOnlyPaths=/home/owner'), p);
    const o = change(s, 'true', { extra: ['--open'] });
    for (const p of SHARED_PINS) assert.ok(unitCall(s, `sw-run-${o.id}`).includes(`BindPaths=${p}`), p);
    const t = proven();
    rmSync(join(t.R, 'home/owner/.local/share/spark-portal/workspaces/shared/jobs'), { recursive: true });
    refused(change(t, 'true'), '/home/owner/.local/share/spark-portal/workspaces/shared/jobs is not there, so it cannot be held');
    const u = proven();
    const portal = join(u.R, 'home/owner/.local/share/spark-portal');
    renameSync(portal, join(u.R, 'home/owner/elsewhere'));
    symlinkSync(join(u.R, 'home/owner/elsewhere'), portal);   // the shared folder swapped for a link
    refused(change(u, 'true'), '/home/owner/.local/share/spark-portal/workspaces/shared is a link, or under one');
  });
  test('each folder above a held path is pinned (BindPaths onto itself), names at the top of the home need none, and none is a held path', () => {
    const s = proven();
    const r = change(s, 'true');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const c = unitCall(s, `sw-run-${r.id}`);
    assert.deepEqual(c.filter(a => a.startsWith('BindPaths=')).map(a => a.slice(10)), PINS);
    for (const p of PINS) assert.ok(!c.some(a => a !== `BindPaths=${p}` && a.endsWith(`=${p}`) && !a.startsWith('BindReadOnlyPaths=')), `${p} is not also a held path`);
    const l = look(s, 'true');
    assert.ok(!unitCall(s, `sw-look-${l.id}`).some(a => a.startsWith('BindPaths=')), 'a look pins nothing: it is read-only everywhere');
  });
  test('.docker is hidden whole; the state folder is one empty folder with its plain files put back and no sign-in file or socket', () => {
    const s = proven();
    for (const f of ['passkeys.json', 'agents.json', 'telegram.json', 'access.json', 'access.json.good', 'door.sock', 'lessons.json', 'plugs.json']) s.put(`home/owner/.local/state/spark-console/${f}`, '{}');
    const r = change(s, 'true');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const c = unitCall(s, `sw-run-${r.id}`).filter(a => a.includes('/home/owner/.docker') || a.includes('/.local/state/spark-console'));
    assert.deepEqual(c, ['TemporaryFileSystem=/home/owner/.docker:ro', 'TemporaryFileSystem=/home/owner/.local/state/spark-console:ro',
      ...['desired.json', 'lessons.json', 'plugs.json'].map(f => `BindReadOnlyPaths=/home/owner/.local/state/spark-console/${f}`)]);
  });
  test('no sign-in file and no socket of the state folder is put back, in a look or a change, with or without --open', () => {
    // These two were single hidden files (InaccessiblePaths=…/api.sock and …/sessions.json) before the state folder was
    // hidden whole; each sign-in name is still held here, by name.
    const s = proven();
    const SIGN_IN = ['api.sock', 'door.sock', 'sessions.json', 'passkeys.json', 'agents.json', 'telegram.json', 'access.json', 'access.json.good'];
    for (const f of SIGN_IN) s.put(`home/owner/.local/state/spark-console/${f}`, 'secret');
    for (const [wall, r] of [['look', look(s, 'true')], ['run', change(s, 'true')]]) {
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const c = unitCall(s, `sw-${wall}-${r.id}`);
      assert.ok(c.includes('TemporaryFileSystem=/home/owner/.local/state/spark-console:ro'), `${wall}: the state folder is hidden`);
      for (const f of SIGN_IN) assert.ok(!c.some(a => a.endsWith(`/.local/state/spark-console/${f}`)), `${wall}: ${f} is not put back`);
    }
    // --open drops the hidden list on purpose (asked first, outside the wall): it is the only way these are seen.
    const o = change(s, 'true', { extra: ['--open'] });
    assert.ok(!unitCall(s, `sw-run-${o.id}`).some(a => a.startsWith('BindReadOnlyPaths=/home/owner/.local/state/')), 'nothing is put back under --open: nothing is hidden');
  });
});

describe("the owner's words on Spark 2", () => {
  // The state folder is on Spark 2 only; the helper's lists are the same everywhere, so this is how the hub looks.
  const WORDS = ['chats.json', 'memory.json', 'memory-past.json', 'audit.jsonl', 'saved-workflows.json', 'memory.json.prev', 'audit.jsonl.1'];
  const LOOK_IN = 'cd "$WALL_VIEW/home/owner/.local/state/spark-console" && for f in ' + [...WORDS, 'desired.json', 'lessons.json'].join(' ')
    + '; do cat "$f" > /dev/null && echo "$f read"; done; true';
  test('a look and a change on the hub: the state folder is hidden, and no file of what was said is put back', () => {
    const s = proven();
    s.put('home/owner/.local/state/spark-console/lessons.json', '{}');
    for (const [wall, r] of [['look', look(s, LOOK_IN)], ['run', change(s, LOOK_IN)]]) {
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const c = unitCall(s, `sw-${wall}-${r.id}`);
      assert.ok(c.includes('TemporaryFileSystem=/home/owner/.local/state/spark-console:ro'), c.join(' '));
      for (const f of WORDS) assert.ok(!c.some(a => a.endsWith(`/.local/state/spark-console/${f}`)), `${f} is not put back`);
      assert.ok(c.includes('BindReadOnlyPaths=/home/owner/.local/state/spark-console/lessons.json'), 'what holds no words is');
      // A command in the wall: each file of what was said is not there; the rest is read.
      for (const f of WORDS) assert.match(r.stderr, new RegExp(`cat: ${esc(f)}: No such file or directory\n`));
      assert.match(r.stdout, /^desired\.json read\nlessons\.json read\n/);
    }
  });
  test('on a compute Spark (no state folder) nothing about it is asked for', () => {
    const s = proven();
    rmSync(join(s.R, 'home/owner/.local/state'), { recursive: true });
    for (const r of [look(s, 'true'), change(s, 'true')]) {
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const c = calls(s).filter(x => x[0] === 'systemd-run').at(-1);
      assert.ok(!c.some(a => a.includes('/.local/state')), c.join(' '));
    }
  });
});

describe('what a Spark must have', () => {
  test('systemd 247 is refused by name, 248 is enough', () => {
    const old = spark({ systemd: '247.3-7ubuntu3' });
    const c = run(old, ['check', '--id', newId()]);
    assert.match(c.stdout, / systemd 247\.3-7ubuntu3 too old \(needs 248 or newer\)\n/);
    refused(prove(old), 'systemd 247 is too old: the walls need 248 or newer');
    refused(look(old, 'true'), 'systemd 247 is too old');
    assert.equal(calls(old).filter(c => c[0] === 'systemd-run').length, 0);
    const p = prove(spark({ systemd: '248.3-1ubuntu8' }));
    assert.equal(p.status, 0, p.stdout + p.stderr);
  });
  test('an unshare without --kill-child, or a setpriv without --bounding-set, is refused by name', () => {
    refused(prove(spark({ knobs: { 'unshare-old': '' } })), 'unshare does not know --kill-child');
    refused(prove(spark({ knobs: { 'setpriv-old': '' } })), 'setpriv does not know --bounding-set');
    const t = spark({ knobs: { 'unshare-old': '' } });
    assert.match(run(t, ['check', '--id', newId()]).stdout, / unshare lacks --kill-child\n/);
  });
  test('no proof yet, or a mark from another systemd, kernel or helper: look and run refuse until it is proven again', () => {
    const fresh = spark();
    refused(look(fresh, 'true'), 'the wall proof is none on this Spark: prove first');
    refused(change(fresh, 'true'), 'the wall proof is none on this Spark: prove first');
    const s = proven();
    assert.equal(look(s, 'true').status, 0);
    const mark = readFileSync(join(s.R, 'var/lib/spark-console/proved'), 'utf8');
    assert.match(mark, new RegExp(`^helper ${sha(readFileSync(HELPER_SRC))}\nsystemd 255\\.4-1ubuntu8\\.4\nkernel 6\\.11\\.0-1016-nvidia\nproved \\d{4}-\\d\\d-\\d\\dT`));
    s.put('standin/systemd-version', '256.1-1ubuntu1');
    assert.match(run(s, ['check', '--id', newId()]).stdout, / proof out of date: systemd changed\n/);
    refused(look(s, 'true'), 'the wall proof is out of date: systemd changed on this Spark: prove first');
    refused(change(s, 'true'), 'the wall proof is out of date: systemd changed');
    assert.equal(prove(s).status, 0);
    assert.equal(look(s, 'true').status, 0);
    s.put('proc/sys/kernel/osrelease', '6.11.0-1017-nvidia\n');
    refused(look(s, 'true'), 'the wall proof is out of date: the kernel changed');
    assert.equal(prove(s).status, 0);
    const h = join(s.R, 'usr/local/sbin/spark-console-root');
    writeFileSync(h, `${readFileSync(h, 'utf8')}# changed\n`);
    refused(look(s, 'true'), 'the wall proof is out of date: the helper changed');
    chmodSync(join(s.R, 'var/lib/spark-console/proved'), 0o666);
    refused(look(s, 'true'), 'the wall proof is not trusted: another account could write it');
  });
});

describe('the proof of the walls', () => {
  const NAMES = ['', 'a write through a link', 'an open connection', "the Docker or Tailscale socket, api.sock or the door's socket",
    "another program's environment", 'a write that stays', "round the hiding, through another program's /proc",
    'a signal to a program outside the wall', 'more rights: sudo, the helper, a capability', 'starting something outside the wall',
    'a hidden key file', 'a disk device or the GPU', 'something left behind', 'root with no net',
    'moving a folder above a held one, and making a new one in its place', "stopping or changing the net's timer",
    "writing the net's copies or restore.sh", "taking away the net's pending mark", 'making keep count',
    "swapping a job's own output folder for a link", 'ending a unit through the helper', 'more memory, swap or share than the change was given',
    "a connection to this Spark's own address or the tailnet", 'a file or segment left in /dev/shm or IPC', "the home's own mode",
    "the owner's start files", 'a name made at the top of the home or in a dot folder',
    'a write where a change may write, refused (~/.cache, /dev/shm)', 'with --home, a name at the top of the home or in ~/.local/bin, refused',
    'a write in ~/.ssh'];
  const LOOK = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 17, 18, 20, 25, 26];
  const RUN = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 29];

  test('a pass: every attempt stopped in both walls, root refused, the mark written; the proof units ask for the same walls', () => {
    const s = spark();
    const p = prove(s);
    assert.equal(p.status, 0, p.stdout + p.stderr);
    for (const n of LOOK) assert.ok(p.stdout.includes(`${p.id} proof look ${n} blocked: ${NAMES[n]}\n`), `look ${n}`);
    for (const n of RUN) assert.ok(p.stdout.includes(`${p.id} proof run ${n} blocked: ${NAMES[n]}\n`), `run ${n}`);
    assert.match(p.stdout, new RegExp(`${p.id} proof look passed\n${p.id} proof run 1 `));
    assert.ok(p.stdout.includes(`${p.id} proof root 13 refused: root with no net\n`));
    assert.match(p.stdout, new RegExp(`${p.id} proof passed: the mark is written for this helper, systemd 255\\.4-1ubuntu8\\.4 and kernel 6\\.11\\.0-1016-nvidia\n$`));
    assert.ok(existsSync(join(s.R, 'var/lib/spark-console/proved')));
    // The units, in order: the proof's files, root's folders, the program outside, the attempts outside, inside each
    // wall, the check from outside afterwards (as the owner, then as root); then the program outside is stopped.
    const units = calls(s).filter(c => c[0] === 'systemd-run').map(c => c.find(a => a.startsWith('--unit=')).slice(7));
    // (and, after the program outside, a guard of the net for each wall to try: 15 to 18; stopped after the check)
    const g = p.id.slice(0, 38);
    assert.deepEqual(units, [...['prep', 'setup', 'target'].map(u => `sw-prove-${u}-${p.id}`), `sw-guard-${g}nl`, `sw-guard-${g}nr`,
      ...['outside', 'look', 'run', 'home', 'post', 'after'].map(u => `sw-prove-${u}-${p.id}`)]);
    assert.deepEqual(calls(s).filter(c => c[0] === 'systemctl' && c[1] !== 'show' && c[1] !== '--version'),
      [['systemctl', 'stop', `sw-guard-${g}nl.timer`], ['systemctl', 'stop', `sw-guard-${g}nr.timer`],
        ['systemctl', 'is-active', '--quiet', `sw-prove-target-${p.id}.service`], ['systemctl', 'stop', `sw-prove-target-${p.id}.service`]]);
    assert.ok(p.stdout.includes(`${p.id} proof outside 2 works: an open connection (the loopback, stand-in)\n`));
    assert.ok(p.stdout.includes(`${p.id} proof controls work: each attempt was seen working outside the walls, or is not there\n`));
    const py = which(s, 'python3'), proof = `/run/spark-console/${p.id}/proof.py`;
    const hidden = ['/home/owner/.local/share/spark-console'];
    const lookUnit = lookCall(s, p.id, 'x', 120, hidden);
    assert.deepEqual(unitCall(s, `sw-prove-look-${p.id}`), [...lookUnit.slice(0, 1), `--unit=sw-prove-look-${p.id}`,
      `--description=Spark Console wall proof look ${p.id}`, ...lookUnit.slice(3, lookUnit.indexOf('--') + 1), py, '-I', '-S', proof, 'look', ...LOOK.map(String)]);
    const ro = `/home/owner/.cache/.sparkie-proof-${p.id}/held/ro`;
    const runUnit = runCall(s, p.id, 'x', 120, { protect: [ro], hiddenExtra: hidden,
      memory: '2G', pins: [...PINS, `/home/owner/.cache/.sparkie-proof-${p.id}`, `/home/owner/.cache/.sparkie-proof-${p.id}/held`] });   // (its folder is in ~/.cache, where pins are real)
    assert.deepEqual(unitCall(s, `sw-prove-run-${p.id}`), [...runUnit.slice(0, 1), `--unit=sw-prove-run-${p.id}`,
      `--description=Spark Console wall proof run ${p.id}`, ...runUnit.slice(3, runUnit.indexOf(which(s, 'bash'))), py, '-I', '-S', proof, 'run', ...RUN.map(String)]);
    assert.deepEqual(unitCall(s, `sw-prove-outside-${p.id}`), ['systemd-run', `--unit=sw-prove-outside-${p.id}`,
      `--description=Spark Console wall proof outside ${p.id}`, '--wait', '--pipe', '--collect', '--quiet', '--uid=1000', '--gid=1000',
      '-p', 'RuntimeMaxSec=120', '-p', 'TimeoutStopSec=5', '--', py, '-I', '-S', proof, 'outside', ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14, 19, 20, 22, 25, 26].map(String)]);
    assert.deepEqual(unitCall(s, `sw-prove-target-${p.id}`), ['systemd-run', `--unit=sw-prove-target-${p.id}`,
      `--description=Spark Console wall proof target ${p.id}`, '--collect', '--quiet', '--uid=1000', '--gid=1000',
      '-p', `WorkingDirectory=/home/owner/.local/share/spark-console/proof-${p.id}`, '-p', `Environment=SPARK_PROOF_MARK=${p.id}`,
      '-p', 'RuntimeMaxSec=300', '-p', 'TimeoutStopSec=5', '--', py, '-I', '-S', proof, 'target']);
    assert.ok(!existsSync(join(s.R, 'run/spark-console', p.id)), 'the held folder is gone afterwards');
  });

  // The four of step 1 first, then the rest; each in each wall it applies to.
  const cases = [
    ...LOOK.map(n => [n, 'look', '']), ...RUN.map(n => [n, 'run', '']),
    [1, 'look', 'child'], [2, 'look', 'child'], [3, 'run', 'child'], [4, 'run', 'child'],
    [1, 'look', 'after'], [1, 'run', 'after'], [5, 'run', 'after'],
    [14, 'run', 'child'], [14, 'run', 'after'],
  ];
  for (const [n, wall, how] of cases) {
    test(`attempt ${n} gets through the ${wall} wall${how ? ` (${how === 'child' ? 'from a child process' : 'seen from outside afterwards'})` : ''}: the proof names it, writes no mark, and look and run refuse`, () => {
      const s = proven();
      assert.equal(look(s, 'true').status, 0, 'the walls worked before');
      s.put('standin/let-through', `${n} ${wall} ${how}\n`);
      const p = prove(s);
      assert.equal(p.status, 1, p.stdout + p.stderr);
      assert.ok(p.stdout.includes(`${p.id} proof ${wall} ${n} got through: ${NAMES[n]} (stand-in`), p.stdout);
      assert.ok(p.stdout.includes(`${p.id} proof ${wall} failed\n`));
      assert.ok(p.stdout.endsWith(`${p.id} proof failed: attempt ${n} in the ${wall} wall got through (${NAMES[n]}). No mark was written, so the look and run walls refuse on this Spark.\n`), p.stdout);
      assert.ok(!existsSync(join(s.R, 'var/lib/spark-console/proved')), 'no mark, not even the old one');
      refused(look(s, 'true'), 'the wall proof is none on this Spark: prove first');
      refused(change(s, 'true'), 'the wall proof is none on this Spark: prove first');
      assert.match(run(s, ['check', '--id', newId()]).stdout, / proof none\n.* look refuses: the wall proof is none on this Spark\n/s);
    });
  }

  // The controls: a "blocked" inside a wall shows something only when the same attempt worked outside it.
  const FAILED = why => new RegExp(`proof failed: ${esc(why)}\\. No mark was written, so the look and run walls refuse on this Spark\\.\n$`);
  const noMark = (s, p) => {
    assert.equal(p.status, 1, p.stdout + p.stderr);
    assert.ok(!existsSync(join(s.R, 'var/lib/spark-console/proved')), 'no mark');
    refused(look(s, 'true'), 'the wall proof is none on this Spark: prove first');
  };
  for (const n of [1, 4, 5, 6, 7, 8, 10]) {
    test(`attempt ${n} not seen working outside the walls (its own program, files or line): no mark, even with every wall holding`, () => {
      const s = proven();
      s.put('standin/outside', `${n} not-there stand-in\n`);
      const p = prove(s);
      noMark(s, p);
      assert.ok(p.stdout.includes(`${p.id} proof look passed\n`) && p.stdout.includes(`${p.id} proof run passed\n`), 'every wall said blocked');
      assert.match(p.stdout, FAILED(`attempt ${n} (${NAMES[n]}) could not be shown working outside the walls, so stopping it inside would show nothing`));
    });
  }
  test('attempt 14 not seen working outside the walls (the right to move its own folder): no mark, even with every wall holding', () => {
    const s = proven();
    s.put('standin/outside', '14 not-there stand-in\n');
    const p = prove(s);
    noMark(s, p);
    assert.match(p.stdout, FAILED(`attempt 14 (${NAMES[14]}) could not be shown working outside the walls, so stopping it inside would show nothing`));
  });
  test('attempt 2 that reaches other things outside but not its own program on the loopback: no mark', () => {
    const s = proven();
    s.put('standin/outside', '2 works the tailnet\n');
    const p = prove(s);
    noMark(s, p);
    assert.match(p.stdout, FAILED("attempt 2 could not reach the proof's own program on the loopback outside the walls, so the run wall's loopback rule would be shown by nothing"));
  });
  test('the sockets, a user manager and the devices may be absent: the proof says why, and passes', () => {
    const s = proven();
    s.put('standin/outside', '3 not-there no socket here\n9 not-there no user manager here\n11 not-there no device here\n');
    const p = prove(s);
    assert.equal(p.status, 0, p.stdout);
    assert.ok(p.stdout.includes(`${p.id} proof outside 3 not there: ${NAMES[3]} (no socket here)\n`), p.stdout);
    assert.ok(p.stdout.includes(`${p.id} proof outside 9 not there: ${NAMES[9]} (no user manager here)\n`));
    assert.ok(existsSync(join(s.R, 'var/lib/spark-console/proved')));
  });
  for (const [name, knob, why] of [
    ['never started', 'no-pid', "the proof's own program outside the walls did not start"],
    ['stopped before the end', 'target-dead', "the proof's own program outside the walls stopped before the end"],
  ]) {
    test(`the proof's own program outside the walls ${name}: no mark`, () => {
      const s = proven();
      s.put(`standin/${knob}`);
      const p = prove(s);
      noMark(s, p);
      assert.match(p.stdout, FAILED(why));
    });
  }
  test('the checks from outside afterwards did not see what the proof left there on purpose: no mark', () => {
    for (const [n, play] of [[5, 'V 12 outside works x\nV 5 look blocked x\nV 12 look blocked x\nV 12 run blocked x\n'],
      [12, 'V 5 outside works x\nV 5 look blocked x\nV 12 look blocked x\nV 12 run blocked x\n']]) {
      const s = proven();
      s.put('standin/play-after', play);
      const p = prove(s);
      noMark(s, p);
      assert.match(p.stdout, FAILED(`the check from outside afterwards for attempt ${n} (${NAMES[n]}) did not see what the proof left there on purpose`));
    }
  });
  test('no file handle for the key, or no folder on any disk: the proof cannot make its own files, and says what was missing', () => {
    for (const [part, line] of [['prep', 'S failed: no file handle for the proof key'], ['setup', 'S failed: no folder could be made on any disk']]) {
      const s = proven();
      s.put(`standin/play-${part}`, `${line}\n`);
      const p = prove(s);
      noMark(s, p);
      assert.ok(p.stdout.includes(`proof failed: the proof could not make its own files on this Spark (`) && p.stdout.includes(line), p.stdout);
      assert.equal(unitCall(s, `sw-prove-look-${p.id}`), undefined, 'no wall was tried');
    }
  });

  test("a wall's unit that systemd will not start fails the proof, and says so", () => {
    const s = proven();
    s.put('standin/refuse', 'sw-prove-look-');
    const p = prove(s);
    assert.equal(p.status, 1);
    assert.ok(p.stdout.includes(`${p.id} proof look 1 was not reported: a write through a link\n`), p.stdout);
    assert.match(p.stdout, /proof failed: the look wall's unit did not run \(systemd refused it, or something it needs is missing on this Spark\)\. No mark was written/);
    assert.ok(!existsSync(join(s.R, 'var/lib/spark-console/proved')));
  });

  test("a look's shared hold on the proof's lock makes a proof wait, not refuse; another proof's hold still refuses it", async () => {
    const s = proven();
    const lock = join(s.R, 'run/spark-console/prove.lock');
    const units = () => calls(s).filter(c => c[0] === 'systemd-run').length;
    // Holds the lock from outside, in its own process group (so it can be ended whole), until it says it holds it.
    const hold = async (how, secs) => {
      const h = spawn('flock', [how, lock, 'sh', '-c', `echo held; exec sleep ${secs}`], { env: s.env, detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
      await new Promise((ok, no) => { h.stdout.once('data', ok); h.once('exit', () => no(new Error('the hold ended before it held the lock'))); });
      return () => { try { process.kill(-h.pid, 'SIGKILL'); } catch { /* already ended */ } };
    };
    // A look's check holds it shared for a moment (21-work.mjs: flock -n -s); here for 1.5 s.
    let end = await hold('-s', 1.5);
    let t = Date.now();
    let p = prove(s);
    const waited = Date.now() - t;
    end();
    assert.equal(p.status, 0, p.stdout + p.stderr);
    assert.ok(waited >= 1000, `it waited for the look's hold to end (${waited} ms)`);
    // Another proof holds it whole, for minutes: after its few seconds' wait, this one is refused and starts nothing.
    end = await hold('-x', 60);
    const before = units();
    t = Date.now();
    p = prove(s);
    const tried = Date.now() - t;
    end();
    refused(p, 'another proof is running on this Spark');
    assert.ok(tried >= 4000, `it waited its few seconds first (${tried} ms)`);
    assert.equal(units(), before, 'nothing started');
    assert.ok(existsSync(join(s.R, 'var/lib/spark-console/proved')), "the passing proof's mark is left as it was");
  });
});

// --- the owner's one-time command ---------------------------------------------------------------------------------
const HUB_ID = '22222222222222222222222222222222', S3_ID = '33333333333333333333333333333333';
// Spark 2 (the hub, with the installed build in ~/spark-console-src), Spark 3 (a compute Spark), and stand-ins for
// ssh (it runs the far side's command here, as that Spark: its home and its machine id), sudo (as this user, with
// root's paths read under the Spark's rehearsal folder; without the sudo line, sudo -n is refused) and systemd-id128.
function fleet({ target = spark({ installed: false }) } = {}) {
  const T = realpathSync(mkdtempSync(join(tmpdir(), 'root-for-sparkie-')));
  temps.push(T);
  const src = join(T, 'spark2/spark-console-src');
  mkdirSync(join(src, 'deploy'), { recursive: true });
  mkdirSync(join(src, 'service'), { recursive: true });
  copyFileSync(SETUP_SRC, join(src, 'deploy/root-for-sparkie.sh'));
  copyFileSync(HELPER_SRC, join(src, 'deploy/spark-console-root'));
  writeFileSync(join(src, 'service/config.json'), JSON.stringify({ user: 'owner', nodes: [{ id: 'spark2', host: 'local' }, { id: 'spark3', host: 'spark3.test' }] }));
  mkdirSync(join(T, 'spark3'));
  mkdirSync(join(T, 'mac'));
  const bin = join(T, 'bin');
  mkdirSync(bin);
  const LOG = `python3 -c 'import json,sys; print(json.dumps(sys.argv[1:]))' "$(basename "$0")" "$@" >> "$SPARK_CONSOLE_REHEARSAL/calls.log"`;
  writeFileSync(join(bin, 'ssh'), `#!/bin/bash\n${LOG}\nwhile [ $# -gt 0 ]; do case "$1" in -t|-tt) shift ;; -o) shift 2 ;; *) break ;; esac; done\n`
    + `dest=$1; shift\ncase "$dest" in\n  *@spark3.test) home=$TEST_T/spark3; id=$(cat "$TEST_T/spark3.id" 2>/dev/null || echo ${S3_ID}) ;;\n`
    + `  *@spark2.test) home=$TEST_T/spark2; id=${HUB_ID} ;;\n  *) echo "ssh: no such Spark here: $dest" >&2; exit 255 ;;\nesac\n`
    + 'cd "$home" && exec env HOME="$home" STANDIN_MACHINE="$id" bash -c "$*"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'systemd-id128'), `#!/bin/bash\n[ "$1" = machine-id ] && echo "\${STANDIN_MACHINE:-${HUB_ID}}"\n`, { mode: 0o755 });
  writeFileSync(join(bin, 'sudo'), `#!/bin/bash\n${LOG}\nR=$SPARK_CONSOLE_REHEARSAL; n=0\n[ "$1" = -n ] && { n=1; shift; }\n[ "$1" = -v ] && exit 0\n`
    + 'if [ $n = 1 ] && [ ! -f "$R/etc/sudoers.d/spark-console-root" ]; then echo "sudo: a password is required" >&2; exit 1; fi\n'
    + 'rebase() { case "$1" in /usr/local/sbin/*|/etc/sudoers.d/*|/var/lib/spark-console/*) printf "%s" "$R$1" ;; *) printf "%s" "$1" ;; esac; }\n'
    + 'cmd=$1; shift; a=()\ncase "$cmd" in\n'
    + '  install) while [ $# -gt 0 ]; do case "$1" in -o|-g) shift 2 ;; -m) a+=("$1" "$2"); shift 2 ;; *) a+=("$(rebase "$1")"); shift ;; esac; done\n'
    // $TEST_T/swap-copy: another program swaps the staged copy after it was checked, just before root copies it.
    + '    for x in "${a[@]}"; do case "$x" in *.copy) [ -e "$TEST_T/swap-copy" ] && printf "#!/bin/bash\\necho swapped\\n" > "$x" ;; esac; done\n'
    + '    exec install "${a[@]}" ;;\n'
    + '  cat|rm|sha256sum|chmod|mv|tee|visudo) for x in "$@"; do a+=("$(rebase "$x")"); done; exec "$cmd" "${a[@]}" ;;\n'
    + '  /usr/local/sbin/spark-console-root) exec env SUDO_UID=1000 SUDO_USER=owner SUDO_GID=1000 "$R$cmd" "$@" ;;\n'
    + '  *) echo "sudo: these tests allow no $cmd" >&2; exit 1 ;;\nesac\n', { mode: 0o755 });
  const env = { PATH: `${bin}:${MOCKBIN}:/usr/bin:/bin`, HOME: join(T, 'spark2'), SPARK_CONSOLE_REHEARSAL: target.R, TEST_T: T };
  const cmd = (args, { home = join(T, 'spark2'), file = join(src, 'deploy/root-for-sparkie.sh'), extra = {} } = {}) =>
    spawnSync('bash', [file, ...args], { env: { ...env, HOME: home, ...extra }, cwd: home, encoding: 'utf8', timeout: 120000 });
  return { T, target, env, cmd };
}
const sudoCalls = f => calls(f.target).filter(c => c[0] === 'sudo').map(c => c.slice(1).join(' '));
const has = (f, p) => existsSync(join(f.target.R, p));
const LINE_TEXT = () => `${spawnSync('id', ['-un'], { encoding: 'utf8' }).stdout.trim()} ALL=(root) NOPASSWD: /usr/local/sbin/spark-console-root\n`;
// Every file under a folder, with its bytes: to show a run changed nothing.
function tree(dir) {
  const out = {};
  const walk = d => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (e.isFile()) out[p] = readFileSync(p, 'base64'); else out[p] = 'link'; } };
  walk(dir);
  return out;
}

// The lock-out net (R60; design A 2.8, step A13a, dark): run --net arms a put-back before the change, in the Spark's own
// systemd (the stand-ins show what is asked); a test fires the timer itself by running restore.sh, as systemd would.
describe('the lock-out net (R60)', () => {
  const G = (s, id) => join(s.R, 'var/lib/spark-console/guard', id);
  const net = (s, cmd, opts = {}) => change(s, cmd, { secs: 300, extra: ['--net'], ...opts });
  const fire = (s, id, why = 'timer', env = s.env) => spawnSync('bash', [join(G(s, id), 'restore.sh'), why], { env, encoding: 'utf8', timeout: 120000 });
  const keep = (s, id) => ({ ...run(s, ['keep', '--id', id]), id });
  const SSHD = 'etc/ssh/sshd_config';
  const BOOT = (s, id) => [join(s.R, `etc/systemd/system/sw-guard-boot-${id}.service`), join(s.R, `etc/systemd/system/multi-user.target.wants/sw-guard-boot-${id}.service`)];
  const timerWaits = (s, id) => existsSync(join(s.R, 'standin/timers', `sw-guard-${id}.timer`));
  const at = c => c.find(a => a.startsWith('--unit=')) || c.slice(0, 3).join(' ');
  const lstatExists = f => { try { lstatSync(f); return true; } catch { return false; } };
  const ARMED = id => new RegExp(`^${id} net armed: the ways in go back at \\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\dZ unless they are kept\\n`);
  const netted = () => { const s = proven(); s.put(SSHD, 'Port 22\n', 0o640); return s; };

  test('armed before the change: its timer (the time limit plus 600 s) and restart unit come first; a change that cannot start differs in nothing, and the guard waits for the console\'s word (A13b: never disarmed by itself)', () => {
    const s = netted();
    s.put('standin/refuse', 'sw-run-');
    const before = calls(s).length;
    const r = net(s, 'true');
    assert.match(r.stdout, ARMED(r.id));
    assert.match(r.stdout, new RegExp(`\\n${r.id} net open: nothing differs now; it is kept on the console's word, else at \\S+ what differs then goes back\\n${r.id} end 1\\n$`));
    const asked = calls(s).slice(before).map(at);
    const timer = asked.indexOf(`--unit=sw-guard-${r.id}`), change_ = asked.indexOf(`--unit=sw-run-${r.id}`);
    assert.ok(timer >= 0 && change_ > timer, `the timer is asked for before the change: ${asked.join(', ')}`);
    assert.equal(asked.indexOf(`systemctl stop sw-guard-${r.id}.timer`), -1, 'and not stopped after it');
    assert.deepEqual(unitCall(s, `sw-guard-${r.id}`), ['systemd-run', `--unit=sw-guard-${r.id}`, `--description=Spark Console net ${r.id}: what was not kept goes back`,
      '--on-active=900s', '--timer-property=AccuracySec=1s', '--quiet', '-p', 'Type=oneshot', '--', which(s, 'bash'),
      `/var/lib/spark-console/guard/${r.id}/restore.sh`, 'timer']);
    assert.ok(existsSync(join(G(s, r.id), 'pending')) && timerWaits(s, r.id), 'it waits');
    for (const f of BOOT(s, r.id)) assert.ok(lstatExists(f), f);
    assert.match(keep(s, r.id).stdout, / kept: /, "the console's word disarms it");
    assert.ok(!existsSync(join(G(s, r.id), 'pending')) && !timerWaits(s, r.id));
  });

  test('a change that breaks a way in stays armed and says what; the timer stops the change first, puts back the exact bytes, mode and owner, reloads ssh and leaves a result; once is all', () => {
    const s = netted(), file = join(s.R, SSHD), was = statSync(file);
    const r = net(s, 'printf "Port 2222\\n" >> "$SPARK_CONSOLE_REHEARSAL/etc/ssh/sshd_config"; chmod 0666 "$SPARK_CONSOLE_REHEARSAL/etc/ssh/sshd_config"');
    assert.match(r.stdout, ARMED(r.id));
    assert.match(r.stdout, new RegExp(`\\n${r.id} net open: 1 of the ways in differs \\(/etc/ssh\\) and goes back at \\S+ unless it is kept\\n${r.id} end 0\\n$`));
    assert.ok(existsSync(join(G(s, r.id), 'pending')) && timerWaits(s, r.id));
    for (const f of BOOT(s, r.id)) assert.ok(lstatExists(f), f);
    assert.match(readFileSync(BOOT(s, r.id)[0], 'utf8'), new RegExp(`ConditionPathExists=/var/lib/spark-console/guard/${r.id}/pending\\n[\\s\\S]*ExecStart=/bin/bash /var/lib/spark-console/guard/${r.id}/restore.sh boot\\n`));
    const before = calls(s).length;
    const f = fire(s, r.id);
    assert.equal(f.status, 0, f.stdout + f.stderr);
    assert.equal(readFileSync(file, 'utf8'), 'Port 22\n');
    const now = statSync(file);
    assert.deepEqual([now.mode & 0o7777, now.uid, now.gid], [was.mode & 0o7777, was.uid, was.gid]);
    const result = readFileSync(join(G(s, r.id), 'result'), 'utf8').split('\n');
    assert.match(result[0], /^put back at \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ: 1 went back, 0 did not$/);
    assert.equal(result[1], 'by its timer');
    assert.ok(result.includes('put back /etc/ssh/sshd_config'), result.join('\n'));
    assert.ok(result.includes('reload systemctl try-reload-or-restart ssh.service: ok'), result.join('\n'));
    const asked = calls(s).slice(before).map(c => c.join(' '));
    const stop = asked.indexOf(`systemctl stop -- sw-run-${r.id}.service`), reload = asked.indexOf('systemctl try-reload-or-restart ssh.service');
    assert.ok(stop >= 0 && reload > stop, `the change is stopped before anything goes back: ${asked.join(' | ')}`);
    assert.ok(!existsSync(join(G(s, r.id), 'pending')));
    for (const p of BOOT(s, r.id)) assert.ok(!lstatExists(p), p);
    // Once: the timer again (or a restart) changes nothing.
    writeFileSync(file, 'Port 3333\n');
    assert.equal(fire(s, r.id).status, 0);
    assert.equal(fire(s, r.id, 'boot').status, 0);
    assert.equal(readFileSync(file, 'utf8'), 'Port 3333\n');
  });

  test('kept while the timer waits: the change stays, the timer is stopped, and the timer firing after does nothing; a keep after the put-back says when it went back', () => {
    const s = netted();
    const r = net(s, 'printf "Port 2222\\n" > "$SPARK_CONSOLE_REHEARSAL/etc/ssh/sshd_config"');
    const k = keep(s, r.id);
    assert.equal(k.status, 0, k.stdout + k.stderr);
    assert.equal(k.stdout, `${r.id} kept: the change stays, and the copies stay beside it\n`);
    assert.ok(!timerWaits(s, r.id) && !existsSync(join(G(s, r.id), 'pending')));
    assert.ok(calls(s).some(c => c.join(' ') === `systemctl stop sw-guard-${r.id}.timer`));
    assert.equal(fire(s, r.id).status, 0);
    assert.equal(readFileSync(join(s.R, SSHD), 'utf8'), 'Port 2222\n', 'kept');
    assert.ok(!existsSync(join(G(s, r.id), 'result')));
    assert.match(keep(s, r.id).stdout, new RegExp(`^${r.id} kept already: kept \\S+\\n$`));
    // Another, not kept: the timer puts it back; a keep then answers when.
    const t = netted(), r2 = net(t, 'printf "Port 2222\\n" > "$SPARK_CONSOLE_REHEARSAL/etc/ssh/sshd_config"');
    assert.equal(fire(t, r2.id).status, 0);
    const late = keep(t, r2.id);
    assert.equal(late.status, 0, late.stdout + late.stderr);
    assert.match(late.stdout, new RegExp(`^${r2.id} already put back at \\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\dZ: 1 went back, 0 did not\\n$`));
    assert.equal(readFileSync(join(t.R, SSHD), 'utf8'), 'Port 22\n');
  });

  test('keep counts only while the timer waits and once its stop succeeded; otherwise it is refused and the change still goes back', () => {
    const s = netted();
    const r = net(s, 'printf "Port 2222\\n" > "$SPARK_CONSOLE_REHEARSAL/etc/ssh/sshd_config"');
    s.put('standin/timer-stop-fails', '');
    refused(keep(s, r.id), 'its timer could not be stopped, so keeping does not count: it goes back at');
    assert.ok(!existsSync(join(G(s, r.id), 'kept')) && existsSync(join(G(s, r.id), 'pending')));
    rmSync(join(s.R, 'standin/timer-stop-fails'));
    rmSync(join(s.R, 'standin/timers', `sw-guard-${r.id}.timer`));   // (it fired: the put-back has not run yet)
    refused(keep(s, r.id), "its timer is not waiting (inactive), so keeping does not count: what was not kept goes back, by a put-back already started or at the Spark's next restart");
    assert.equal(fire(s, r.id).status, 0);
    assert.equal(readFileSync(join(s.R, SSHD), 'utf8'), 'Port 22\n');
    refused(keep(s, 'nosuchguard1'), 'there is no guard nosuchguard1 on this Spark');
  });

  test('one guard a Spark: while one is open a second is refused and nothing runs; arming that fails leaves nothing and runs nothing', () => {
    const s = netted();
    const r = net(s, 'printf "Port 2222\\n" > "$SPARK_CONSOLE_REHEARSAL/etc/ssh/sshd_config"');
    const before = started(s).length;
    const second = net(s, 'touch "$SPARK_CONSOLE_REHEARSAL/second-ran"');
    refused(second, `another guard is open on this Spark (${r.id}): it is kept or goes back first, so nothing ran`);
    assert.equal(started(s).length, before);
    assert.ok(!existsSync(G(s, second.id)) && !existsSync(join(s.R, 'second-ran')));
    // Systemd will not take the timer: nothing is left, nothing runs (here, on a Spark with no guard open).
    const t = netted();
    t.put('standin/refuse', 'sw-guard-');
    const third = net(t, 'touch "$SPARK_CONSOLE_REHEARSAL/third-ran"');
    refused(third, 'the net could not be armed: systemd did not take its timer, so nothing ran');
    assert.ok(!existsSync(G(t, third.id)) && !existsSync(join(t.R, 'third-ran')) && !existsSync(join(t.R, 'run/spark-console', third.id)));
    for (const f of BOOT(t, third.id)) assert.ok(!lstatExists(f), f);
    assert.ok(!started(t).some(c => c.includes(`--unit=sw-run-${third.id}`)));
    // A look never takes the net; a change in it is held to 30 minutes.
    refused(look(t, 'true', { extra: ['--net'] }), 'a look changes nothing, so it never takes --net');
    refused(net(t, 'true', { secs: 1801 }), 'a change inside the net is held to 30 minutes');
  });

  test("stop ends the look or change this helper started for that id, waits until it is gone and says whether it was running; never the net's timer, nor any other unit; a walled command cannot call it", () => {
    const s = netted();
    const r = net(s, 'printf "Port 2222\\n" > "$SPARK_CONSOLE_REHEARSAL/etc/ssh/sshd_config"');
    s.put(`standin/active/sw-run-${r.id}.service`, '');
    const before = calls(s).length;
    const st = run(s, ['stop', '--id', r.id]);
    assert.equal(st.status, 0, st.stdout + st.stderr);
    assert.equal(st.stdout, `${r.id} stopped sw-run-${r.id}: it was running, and it is gone\n`);
    assert.deepEqual(calls(s).slice(before).filter(c => c[0] === 'systemctl' && c[1] !== 'show'), [['systemctl', 'stop', `sw-run-${r.id}.service`]]);
    assert.ok(timerWaits(s, r.id) && existsSync(join(G(s, r.id), 'pending')), "the net's timer is left as it was");
    assert.equal(run(s, ['stop', '--id', r.id]).stdout, `${r.id} stop: neither sw-run-${r.id} nor sw-look-${r.id} was running\n`);
    const id = newId();
    s.put(`standin/active/sw-look-${id}.service`, '');
    assert.equal(run(s, ['stop', '--id', id]).stdout, `${id} stopped sw-look-${id}: it was running, and it is gone\n`);
    refused({ ...run(s, ['stop', '--id', id, '--seconds', '5']), id }, 'stop takes --id and nothing else');
    const t = spark({ knobs: { 'let-through': '20 look\n' } });
    const q = prove(t);
    assert.equal(q.status, 1);
    assert.ok(q.stdout.includes(`${q.id} proof look 20 got through: ending a unit through the helper (stand-in, directly)\n`), q.stdout);
  });

  test('a restart inside the window: the restart unit puts back once, stops nothing and reloads nothing (they have not started yet); the timer after it does nothing', () => {
    const s = netted();
    const r = net(s, 'printf "Port 2222\\n" > "$SPARK_CONSOLE_REHEARSAL/etc/ssh/sshd_config"');
    const before = calls(s).length;
    const b = fire(s, r.id, 'boot');
    assert.equal(b.status, 0, b.stdout + b.stderr);
    assert.equal(readFileSync(join(s.R, SSHD), 'utf8'), 'Port 22\n');
    assert.deepEqual(calls(s).slice(before).filter(c => c[0] === 'systemctl' && c[1] !== 'show'), [['systemctl', 'stop', '--no-block', '--', `sw-run-${r.id}.service`]],
      'only the command\'s unit stopped (not there after a restart), without waiting; nothing reloaded');
    assert.equal(readFileSync(join(G(s, r.id), 'result'), 'utf8').split('\n')[1], 'after a restart inside the window');
    writeFileSync(join(s.R, SSHD), 'Port 4444\n');
    assert.equal(fire(s, r.id, 'boot').status, 0);
    assert.equal(fire(s, r.id).status, 0);
    assert.equal(readFileSync(join(s.R, SSHD), 'utf8'), 'Port 4444\n', 'once');
  });

  test('the put-back never follows a link out of its folder: a folder swapped for a link, a file swapped for one, a file added, all put back as they were, and what the links point at is untouched', () => {
    const s = netted(), keys = join(s.R, 'home/owner/.ssh/authorized_keys'), keysWas = statSync(keys);
    s.put('elsewhere/target', 'not ours');
    s.put('etc/sudoers.d/owner', 'owner ALL=(ALL) ALL\n', 0o440);
    const r = net(s, ['R="$SPARK_CONSOLE_REHEARSAL"', 'mv "$R/etc/ssh" "$R/etc/ssh-aside"', 'mkdir "$R/outside"', 'printf "x\\n" > "$R/outside/sshd_config"',
      'ln -s "$R/outside" "$R/etc/ssh"', 'rm "$R/home/owner/.ssh/authorized_keys"', 'ln -s "$R/elsewhere/target" "$R/home/owner/.ssh/authorized_keys"',
      'printf "evil ALL=(ALL) NOPASSWD: ALL\\n" > "$R/etc/sudoers.d/evil"'].join('; '));
    assert.match(r.stdout, /net open: 3 of the ways in differ \(\/etc\/ssh \/etc\/sudoers\.d \/home\/owner\/\.ssh\/authorized_keys\)/);
    const f = fire(s, r.id);
    assert.equal(f.status, 0, f.stdout + f.stderr);
    assert.ok(!lstatSync(join(s.R, 'etc/ssh')).isSymbolicLink() && lstatSync(join(s.R, 'etc/ssh')).isDirectory());
    assert.equal(readFileSync(join(s.R, SSHD), 'utf8'), 'Port 22\n');
    assert.equal(readFileSync(join(s.R, 'etc/ssh/ssh_host_ed25519_key'), 'utf8'), 'private');
    assert.equal(readFileSync(join(s.R, 'outside/sshd_config'), 'utf8'), 'x\n', 'what the link pointed at is untouched');
    assert.ok(!lstatSync(keys).isSymbolicLink());
    assert.equal(readFileSync(keys, 'utf8'), 'keys');
    assert.equal(statSync(keys).mode & 0o7777, keysWas.mode & 0o7777);
    assert.equal(readFileSync(join(s.R, 'elsewhere/target'), 'utf8'), 'not ours');
    assert.ok(!existsSync(join(s.R, 'etc/sudoers.d/evil')), 'what the change added is taken away');
    assert.equal(readFileSync(join(s.R, 'etc/sudoers.d/owner'), 'utf8'), 'owner ALL=(ALL) ALL\n');
    assert.equal(statSync(join(s.R, 'etc/sudoers.d/owner')).mode & 0o7777, 0o440);
  });

  test('a link already at a way in when the net copies is copied as a link, never followed, and put back as that link', () => {
    const s = netted();
    s.put('secret/hosts-target', 'SECRET-HOSTS');
    symlinkSync(join(s.R, 'secret/hosts-target'), join(s.R, 'etc/hosts'));
    const r = net(s, 'rm "$SPARK_CONSOLE_REHEARSAL/etc/hosts"; printf "1.2.3.4 x\\n" > "$SPARK_CONSOLE_REHEARSAL/etc/hosts"');
    const manifest = JSON.parse(readFileSync(join(G(s, r.id), 'manifest.json'), 'utf8'));
    assert.deepEqual([manifest.entries['/etc/hosts'].kind, manifest.entries['/etc/hosts'].to], ['link', join(s.R, 'secret/hosts-target')]);
    assert.equal(manifest.entries['/home/owner/.ssh/config'].kind, 'link', "the owner's ssh config, a link: as a link");
    const copied = spawnSync('grep', ['-rl', 'SECRET-HOSTS', G(s, r.id)], { encoding: 'utf8' }).stdout;
    assert.equal(copied, '', 'what the link points at is not in the copy');
    assert.equal(fire(s, r.id).status, 0);
    assert.equal(readlinkSync(join(s.R, 'etc/hosts')), join(s.R, 'secret/hosts-target'));
    assert.equal(readFileSync(join(s.R, 'secret/hosts-target'), 'utf8'), 'SECRET-HOSTS');
  });

  // Fix 1 (the review of 9fd3979): the same id sent again is refused and leaves the open guard as it was.
  test('the same id sent again while its guard is open: refused, and the open guard keeps its timer, restart unit and pending', () => {
    const s = netted();
    const r = net(s, 'printf "Port 2222\\n" > "$SPARK_CONSOLE_REHEARSAL/etc/ssh/sshd_config"');
    const again = net(s, 'true', { id: r.id });
    refused(again, 'this id was used already');   // (refused before the net is looked at: a call's id is used once, A13b's state)
    assert.ok(timerWaits(s, r.id), 'its timer still waits');
    for (const f of BOOT(s, r.id)) assert.ok(lstatExists(f), f);
    assert.ok(existsSync(join(G(s, r.id), 'pending')));
    assert.equal(fire(s, r.id).status, 0);
    assert.equal(readFileSync(join(s.R, SSHD), 'utf8'), 'Port 22\n', 'and it still goes back');
  });

  // Fix 2: the folders above a way in are kept as folders (mode and owner), up to the owner's home.
  test("the folders above a way in: ~/.ssh removed, swapped for a link or opened to all, and the console's state folder removed, each go back with exact bytes, mode and owner", () => {
    const cases = [
      ['removed', 'rm -rf "$R/home/owner/.ssh"', ['/home/owner/.ssh/authorized_keys', '/home/owner/.ssh/config', '/home/owner/.ssh'], 3],
      // (authorized_keys2, not there, is now under a link: named as differing; it is not there again once .ssh is)
      ['a link', 'mv "$R/home/owner/.ssh" "$R/home/owner/.ssh-aside"; mkdir "$R/home/owner/other"; printf "theirs" > "$R/home/owner/other/authorized_keys"; ln -s "$R/home/owner/other" "$R/home/owner/.ssh"',
        ['/home/owner/.ssh/authorized_keys', '/home/owner/.ssh/authorized_keys2', '/home/owner/.ssh/config', '/home/owner/.ssh'], 3],
      // (the home's own mode is put back by the helper right after the change, R63: only ~/.ssh is left to the net)
      ['opened', 'chmod 777 "$R/home/owner/.ssh" "$R/home/owner"', ['/home/owner/.ssh'], 1],
      ['the state folder', 'rm -rf "$R/home/owner/.local/state/spark-console"', ['/home/owner/.local/state/spark-console/passkeys.json', '/home/owner/.local/state/spark-console'], 2],
    ];
    for (const [what, cmd, named, back] of cases) {
      const s = netted(), ssh = join(s.R, 'home/owner/.ssh'), state = join(s.R, 'home/owner/.local/state/spark-console');
      s.put('home/owner/.local/state/spark-console/passkeys.json', '{}');
      chmodSync(ssh, 0o700);
      chmodSync(join(ssh, 'authorized_keys'), 0o600);
      const was = [join(s.R, 'home/owner'), ssh, join(ssh, 'authorized_keys'), state, join(state, 'passkeys.json')].map(f => { const x = statSync(f); return [x.mode & 0o7777, x.uid, x.gid]; });
      const r = net(s, `R="$SPARK_CONSOLE_REHEARSAL"; ${cmd}`);
      const list = named.join(' ').replace(/[.]/g, '\\.');
      assert.match(r.stdout, new RegExp(named.length === 1 ? `net open: 1 of the ways in differs \\(${list}\\) and goes back at ` : `net open: ${named.length} of the ways in differ \\(${list}\\) and go back at `), `${what}: ${r.stdout}`);
      const f = fire(s, r.id);
      assert.equal(f.status, 0, `${what}: ${f.stdout}${f.stderr}`);
      assert.ok(!lstatSync(ssh).isSymbolicLink() && lstatSync(ssh).isDirectory(), what);
      assert.equal(readFileSync(join(ssh, 'authorized_keys'), 'utf8'), 'keys', what);
      assert.equal(readlinkSync(join(ssh, 'config')), '/etc/shadow', what);
      assert.equal(readFileSync(join(state, 'passkeys.json'), 'utf8'), '{}', what);
      const now = [join(s.R, 'home/owner'), ssh, join(ssh, 'authorized_keys'), state, join(state, 'passkeys.json')].map(x => { const y = statSync(x); return [y.mode & 0o7777, y.uid, y.gid]; });
      assert.deepEqual(now, was, `${what}: modes and owners as they were`);
      if (what === 'a link') assert.equal(readFileSync(join(s.R, 'home/owner/other/authorized_keys'), 'utf8'), 'theirs', 'what the link pointed at is untouched');
      assert.match(readFileSync(join(G(s, r.id), 'result'), 'utf8'), new RegExp(`^put back at \\S+: ${back} went back, 0 did not\\n`), what);
      assert.ok(!existsSync(join(ssh, 'authorized_keys2')), what);
    }
  });

  // The second read: a link at the home, or at a folder between it and a way in, is left as it stands.
  test('a link at the home is left: what it points at is untouched, what is under it is named not put back, ways in elsewhere still go back, and no console restart is fired', () => {
    const s = netted();
    s.put('home/owner/.local/state/spark-console/passkeys.json', '{}');
    const r = net(s, ['R="$SPARK_CONSOLE_REHEARSAL"', 'printf "Port 2222\\n" > "$R/etc/ssh/sshd_config"', 'mv "$R/home/owner" "$R/home/owner-moved"',
      'ln -s "$R/home/owner-moved" "$R/home/owner"'].join('; '));
    const before = calls(s).length;
    assert.equal(fire(s, r.id).status, 0);
    assert.ok(lstatSync(join(s.R, 'home/owner')).isSymbolicLink(), 'the link stays');
    assert.equal(readFileSync(join(s.R, 'home/owner-moved/.ssh/authorized_keys'), 'utf8'), 'keys', 'what it points at is untouched');
    assert.ok(existsSync(join(s.R, 'home/owner-moved/models')) && existsSync(join(s.R, 'home/owner-moved/.ssh/id_ed25519')));
    assert.equal(readFileSync(join(s.R, SSHD), 'utf8'), 'Port 22\n', 'a way in outside the home still goes back');
    const result = readFileSync(join(G(s, r.id), 'result'), 'utf8').split('\n');
    for (const l of ['not put back /home/owner: it is a link now', 'not put back /home/owner/.ssh/authorized_keys: /home/owner is a link now',
      'not put back /home/owner/.local/state/spark-console/passkeys.json: /home/owner is a link now']) assert.ok(result.includes(l), `${l}\n${result.join('\n')}`);
    assert.ok(!calls(s).slice(before).some(c => c[0] === 'systemctl' && c.some(a => a.startsWith('--machine='))), 'no console restart');
  });

  test("a link at ~/.config is left: the folder it points at is untouched, the console's units under it are named not put back, and no console restart is fired", () => {
    const s = netted();
    s.put('home/owner/.config/systemd/user/spark-console-api.service', '[Unit]\n');
    const r = net(s, 'H="$SPARK_CONSOLE_REHEARSAL/home/owner"; mv "$H/.config" "$H/.config-moved"; ln -s "$H/.config-moved" "$H/.config"');
    const before = calls(s).length;
    assert.equal(fire(s, r.id).status, 0);
    assert.ok(lstatSync(join(s.R, 'home/owner/.config')).isSymbolicLink(), 'the link stays');
    assert.equal(readFileSync(join(s.R, 'home/owner/.config-moved/spark-console/secrets.json'), 'utf8'), '{}');
    assert.equal(readFileSync(join(s.R, 'home/owner/.config-moved/systemd/user/spark-console-api.service'), 'utf8'), '[Unit]\n');
    const result = readFileSync(join(G(s, r.id), 'result'), 'utf8').split('\n');
    for (const l of ['not put back /home/owner/.config: it is a link now',
      'not put back /home/owner/.config/systemd/user/spark-console-api.service: /home/owner/.config is a link now']) assert.ok(result.includes(l), `${l}\n${result.join('\n')}`);
    assert.match(result[0], /: 0 went back, \d+ did not$/);
    assert.ok(!calls(s).slice(before).some(c => c[0] === 'systemctl' && c.some(a => a.startsWith('--machine='))), 'no console restart');
  });

  test('a folder above that was not there when copied (the linger folder) loses only what the guard puts back as not there, and goes itself only when it is then empty', () => {
    const s = netted();
    const r = net(s, 'L="$SPARK_CONSOLE_REHEARSAL/var/lib/systemd/linger"; mkdir -p "$L"; : > "$L/owner"; : > "$L/other"');
    assert.equal(fire(s, r.id).status, 0);
    const linger = join(s.R, 'var/lib/systemd/linger');
    assert.ok(!existsSync(join(linger, 'owner')), "the owner's file the copy did not see goes");
    assert.ok(existsSync(join(linger, 'other')), 'what else is in it stays');
    const result = readFileSync(join(G(s, r.id), 'result'), 'utf8').split('\n');
    assert.ok(result.includes('not put back /var/lib/systemd/linger: it was not there, and it holds what the copy never saw'), result.join('\n'));
    assert.match(result[0], /: 1 went back, 1 did not$/);
    const t = netted();
    const q = net(t, 'L="$SPARK_CONSOLE_REHEARSAL/var/lib/systemd/linger"; mkdir -p "$L"; : > "$L/owner"');
    assert.equal(fire(t, q.id).status, 0);
    assert.ok(!existsSync(join(t.R, 'var/lib/systemd/linger')), 'empty once the rest went: it goes');
    assert.match(readFileSync(join(G(t, q.id), 'result'), 'utf8').split('\n')[0], /: 2 went back, 0 did not$/);
  });

  // Fix 3: guards that are done never block; arming cut off leaves nothing; the proof's own are marked and swept.
  test('a guard kept or put back that still has pending (cut off before the end) blocks no new guard; keep and the put-back finish its clean-up', () => {
    const s = netted();
    const r = net(s, 'printf "Port 2222\\n" > "$SPARK_CONSOLE_REHEARSAL/etc/ssh/sshd_config"');
    assert.match(keep(s, r.id).stdout, / kept: /);
    writeFileSync(join(G(s, r.id), 'pending'), '');
    const second = net(s, 'true');
    assert.match(second.stdout, ARMED(second.id), second.stdout);
    assert.match(keep(s, r.id).stdout, / kept already: /);
    assert.ok(!existsSync(join(G(s, r.id), 'pending')), 'keep finished it');
    const t = netted();
    const q = net(t, 'printf "Port 2222\\n" > "$SPARK_CONSOLE_REHEARSAL/etc/ssh/sshd_config"');
    assert.equal(fire(t, q.id).status, 0);
    writeFileSync(join(G(t, q.id), 'pending'), '');
    for (const f of BOOT(t, q.id)) { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, ''); }
    assert.match(net(t, 'true').stdout, /net armed: /);
    assert.equal(fire(t, q.id).status, 0);
    assert.ok(!existsSync(join(G(t, q.id), 'pending')), 'the put-back finished it');
    for (const f of BOOT(t, q.id)) assert.ok(!lstatExists(f), f);
  });

  test('a call hung up while it arms takes the half-made guard away: no folder, no restart unit, no timer, nothing ran', async () => {
    const s = netted();
    s.put('standin/guard-sleep', '20');
    const id = newId(), cmd = 'touch "$SPARK_CONSOLE_REHEARSAL/it-ran"';
    const child = spawn(join(s.R, 'usr/local/sbin/spark-console-root'), ['run', '--id', id, '--sha256', sha(cmd), '--seconds', '300', '--dir', s.work, '--net', '--', cmd],
      { env: s.env, detached: true, stdio: 'ignore' });
    for (let i = 0; i < 200 && !existsSync(join(G(s, id), 'pending')); i++) await new Promise(res => setTimeout(res, 50));
    assert.ok(existsSync(join(G(s, id), 'pending')), 'it was arming');
    const ended = new Promise(res => child.on('exit', res));
    process.kill(-child.pid, 'SIGTERM');
    assert.equal(await ended, 129);
    assert.ok(!existsSync(G(s, id)) && !existsSync(join(s.R, 'run/spark-console', id)) && !existsSync(join(s.R, 'it-ran')));
    for (const f of BOOT(s, id)) assert.ok(!lstatExists(f), f);
    assert.ok(!timerWaits(s, id));
    rmSync(join(s.R, 'standin/guard-sleep'));
    assert.match(net(s, 'true').stdout, /net armed: /, 'and the next guard is not blocked');
  });

  test("the proof's own guards carry its mark: one a cut-off proof left blocks no guard, and the next proof takes it away", () => {
    const s = netted(), old = join(s.R, 'var/lib/spark-console/guard', 'leftoverproof01nl');
    mkdirSync(old, { recursive: true });
    for (const f of ['proof', 'pending', 'restore.sh']) writeFileSync(join(old, f), '');
    const first = net(s, 'true');
    assert.match(first.stdout, /net armed: /);
    assert.match(keep(s, first.id).stdout, / kept: /);
    assert.equal(prove(s).status, 0);
    assert.ok(!existsSync(old), 'swept');
    // A guard without the mark is never taken away by a proof.
    const real = net(s, 'printf "Port 2222\\n" > "$SPARK_CONSOLE_REHEARSAL/etc/ssh/sshd_config"');
    assert.equal(prove(s).status, 0);
    assert.ok(existsSync(join(G(s, real.id), 'pending')) && timerWaits(s, real.id));
  });

  test('check names an open guard, when it goes back, and whether its timer still waits', () => {
    const s = netted();
    const r = net(s, 'printf "Port 2222\\n" > "$SPARK_CONSOLE_REHEARSAL/etc/ssh/sshd_config"');
    const at = /go back at (\S+) unless/.exec(r.stdout)[1];
    assert.ok(run(s, ['check', '--id', newId()]).stdout.endsWith(` net open: guard ${r.id} goes back at ${at} unless it is kept; its timer waits\n`));
    rmSync(join(s.R, 'standin/timers', `sw-guard-${r.id}.timer`));
    const left = run(s, ['check', '--id', newId()]).stdout;
    assert.ok(left.includes(` net open: guard ${r.id} goes back at ${at} unless it is kept; its timer is not waiting (inactive)\n`), left);
    assert.ok(left.endsWith(` net left: guard ${r.id} waits for no timer; putback --id ${r.id} puts it back now, keep --id ${r.id} keeps it\n`), left);
  });

  // Fix 4: what the helper says is what happens.
  test('what does not go back by itself is named apart; the result and keep count what went back and what did not; after a restart the two notes are left out', () => {
    const fw = s => {
      const bin = join(s.R, 'standin', 'bin');
      mkdirSync(bin, { recursive: true });
      writeFileSync(join(bin, 'iptables-save'), '#!/bin/bash\ncat "$SPARK_CONSOLE_REHEARSAL/standin/iptables"\n', { mode: 0o755 });
      s.put('standin/iptables', '*filter\n:INPUT ACCEPT [10:200]\nCOMMIT\n');
      return { ...s.env, PATH: `${bin}:${s.env.PATH}` };
    };
    const drop = 'printf -- "-A INPUT -p tcp --dport 22 -j DROP\\n" >> "$SPARK_CONSOLE_REHEARSAL/standin/iptables"';
    const netEnv = (s, env, cmd) => { const id = newId(); return { ...run(s, ['run', '--id', id, '--sha256', sha(cmd), '--seconds', '300', '--dir', s.work, '--net', '--', cmd], { env }), id }; };
    // Only a live rule differs: said apart, and the timer puts nothing back.
    let s = netted(), env = fw(s), r = netEnv(s, env, drop);
    assert.match(r.stdout, new RegExp(`\\n${r.id} net open: the live firewall rules differ, and do not go back by themselves; nothing else differs, so the timer at \\S+ puts nothing back\\n${r.id} end 0\\n$`), r.stdout);
    assert.equal(fire(s, r.id, 'timer', env).status, 0);
    const result = readFileSync(join(G(s, r.id), 'result'), 'utf8').split('\n');
    assert.match(result[0], /^put back at \S+: 0 went back, 1 did not$/);
    assert.ok(result.includes('differs, not put back: the live firewall rules (the net loads no rules)'));
    assert.match(keep(s, r.id).stdout, new RegExp(`^${r.id} already put back at \\S+: 0 went back, 1 did not\\n$`));
    // A way in and a live rule: the first goes back, the second is said.
    s = netted(); env = fw(s);
    r = netEnv(s, env, `${drop}; printf "Port 2222\\n" > "$SPARK_CONSOLE_REHEARSAL/etc/ssh/sshd_config"`);
    assert.match(r.stdout, new RegExp(`${r.id} net open: 1 of the ways in differs \\(/etc/ssh\\) and goes back at \\S+ unless it is kept; the live firewall rules differ too, and do not go back by themselves\\n`));
    // After a restart: the live rules are not said.
    s = netted(); env = fw(s); r = netEnv(s, env, drop);
    assert.equal(fire(s, r.id, 'boot', env).status, 0);
    assert.equal(readFileSync(join(G(s, r.id), 'result'), 'utf8').split('\n')[0].replace(/at \S+:/, 'at T:'), 'put back at T: nothing differed');
    assert.ok(!readFileSync(join(G(s, r.id), 'result'), 'utf8').includes('differs'));
    // Put right by hand before the timer: nothing differed, and keep says so.
    s = netted(); r = net(s, 'printf "Port 2222\\n" > "$SPARK_CONSOLE_REHEARSAL/etc/ssh/sshd_config"');
    writeFileSync(join(s.R, SSHD), 'Port 22\n');
    assert.equal(fire(s, r.id).status, 0);
    assert.match(keep(s, r.id).stdout, new RegExp(`^${r.id} already put back at \\S+: nothing differed\\n$`));
  });

  // Fix 6: more ways in, all files; one not there when copied and there after is taken away.
  test('more ways in: a line in hosts.deny, /etc/nologin made, ssh.service masked and the linger file removed all go back; systemd is told', () => {
    const s = netted();
    s.put('etc/hosts.deny', '# nothing here\n', 0o644);
    s.put('var/lib/systemd/linger/owner', '', 0o644);
    const r = net(s, ['R="$SPARK_CONSOLE_REHEARSAL"', 'printf "sshd: ALL\\n" >> "$R/etc/hosts.deny"', ': > "$R/etc/nologin"',
      'ln -s /dev/null "$R/etc/systemd/system/ssh.service"', 'rm "$R/var/lib/systemd/linger/owner"'].join('; '));
    assert.match(r.stdout, /net open: 4 of the ways in differ \(\/etc\/nologin \/etc\/hosts\.deny \/etc\/systemd\/system\/ssh\.service \/var\/lib\/systemd\/linger\/owner\) and go back at /, r.stdout);
    assert.equal(fire(s, r.id).status, 0);
    assert.equal(readFileSync(join(s.R, 'etc/hosts.deny'), 'utf8'), '# nothing here\n');
    assert.ok(!existsSync(join(s.R, 'etc/nologin')), 'what was not there is taken away');
    assert.ok(!lstatExists(join(s.R, 'etc/systemd/system/ssh.service')), 'the mask is taken away');
    assert.equal(statSync(join(s.R, 'var/lib/systemd/linger/owner')).mode & 0o7777, 0o644);
    assert.ok(readFileSync(join(G(s, r.id), 'result'), 'utf8').includes('reload systemctl daemon-reload: ok'));
  });

  // A13b, the helper's half: the running state, putback, what cannot be put back, and the put-back's failure paths.
  const binOf = (s, files) => {
    const bin = join(s.R, 'standin', 'bin');
    mkdirSync(bin, { recursive: true });
    for (const [name, body] of Object.entries(files)) writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
    return { ...s.env, PATH: `${bin}:${s.env.PATH}` };
  };
  const netIn = (s, env, cmd, extra = []) => { const id = newId(); return { ...run(s, ['run', '--id', id, '--sha256', sha(cmd), '--seconds', '300', '--dir', s.work, '--net', ...extra, '--', cmd], { env }), id }; };
  const UFW = 'f="$SPARK_CONSOLE_REHEARSAL/standin/ufw"; case "$*" in status) echo "Status: $(cat "$f")" ;; "--force enable") echo active > "$f" ;; disable) echo inactive > "$f" ;; esac';
  const SSH_CHANGE = 'printf "Port 2222\\n" > "$SPARK_CONSOLE_REHEARSAL/etc/ssh/sshd_config"';

  test('the running state is a way in: a unit masked and stopped and ufw turned off go back (unmask, enable, start; ufw on); after a restart the units are queued, never waited for', () => {
    const s = netted();
    s.put('standin/units/ssh.service', 'active enabled\n');
    s.put('standin/ufw', 'active\n');
    const env = binOf(s, { ufw: UFW });
    const r = netIn(s, env, 'systemctl mask ssh.service; systemctl stop ssh.service; ufw disable');
    assert.match(r.stdout, new RegExp(`${r.id} net open: 2 of the ways in differ \\(ssh\\.service ufw\\) and go back at \\S+ unless they are kept\\n`), r.stdout);
    const before = calls(s).length;
    assert.equal(fire(s, r.id, 'timer', env).status, 0);
    assert.equal(readFileSync(join(s.R, 'standin/units/ssh.service'), 'utf8').trim(), 'active enabled');
    assert.equal(readFileSync(join(s.R, 'standin/ufw'), 'utf8').trim(), 'active');
    const asked = calls(s).slice(before).filter(c => c[0] === 'systemctl' && c[1] !== 'show').map(c => c.slice(1).join(' '));
    for (const c of ['unmask ssh.service', 'enable ssh.service', 'start ssh.service']) assert.ok(asked.includes(c), asked.join(' | '));
    const result = readFileSync(join(G(s, r.id), 'result'), 'utf8').split('\n');
    assert.ok(result.includes('put back the unit ssh.service') && result.includes('put back ufw'), result.join('\n'));
    const t = netted();
    t.put('standin/units/ssh.service', 'active enabled\n');
    const q = net(t, 'systemctl mask ssh.service; systemctl stop ssh.service');
    const b0 = calls(t).length;
    assert.equal(fire(t, q.id, 'boot').status, 0);
    const queued = calls(t).slice(b0).filter(c => c[0] === 'systemctl').map(c => c.slice(1).join(' '));
    assert.ok(queued.includes('unmask ssh.service') && queued.includes('--no-block start ssh.service'), queued.join(' | '));
  });

  test('a unit caught passing at the copy (reloading, activating) is never stopped for it: only on to off or off to on counts, and the result says it was left', () => {
    const s = netted();
    s.put('standin/units/ssh.service', 'reloading enabled\n');
    const r = net(s, SSH_CHANGE);
    writeFileSync(join(s.R, 'standin/units/ssh.service'), 'active enabled\n');
    const before = calls(s).length;
    assert.equal(fire(s, r.id).status, 0);
    const asked = calls(s).slice(before).filter(c => c[0] === 'systemctl' && c[1] !== 'show').map(c => c.slice(1).join(' '));
    assert.ok(!asked.includes('stop ssh.service'), asked.join(' | '));
    assert.equal(readFileSync(join(s.R, 'standin/units/ssh.service'), 'utf8').trim(), 'active enabled');
    // After a restart: units start by themselves; none is queued or counted for its running state alone.
    const t = netted();
    t.put('standin/units/ssh.service', 'active enabled\n');
    const q = net(t, 'true');
    writeFileSync(join(t.R, 'standin/units/ssh.service'), 'inactive enabled\n');   // (the restart: not started yet)
    const b0 = calls(t).length;
    assert.equal(fire(t, q.id, 'boot').status, 0);
    assert.ok(!calls(t).slice(b0).some(c => c[0] === 'systemctl' && c.includes('start')), 'nothing queued');
    assert.match(readFileSync(join(G(t, q.id), 'result'), 'utf8').split('\n')[0], /: nothing differed$/);
  });

  test('a way-in unit on its way down at the put-back is waited for and counted by where it is headed: started again; one on its way up, stopped (second read, fix 2)', { timeout: 120000 }, () => {
    const s = netted();
    s.put('standin/units/tailscaled.service', 'active enabled\n');
    const r = net(s, 'true');
    writeFileSync(join(s.R, 'standin/units/tailscaled.service'), 'deactivating enabled\n');
    let before = calls(s).length;
    assert.equal(fire(s, r.id).status, 0);
    let asked = calls(s).slice(before).filter(c => c[0] === 'systemctl' && c[1] !== 'show').map(c => c.slice(1).join(' '));
    assert.ok(asked.includes('start tailscaled.service'), asked.join(' | '));
    const t = netted();
    t.put('standin/units/tailscaled.service', 'inactive disabled\n');
    const q = net(t, 'true');
    writeFileSync(join(t.R, 'standin/units/tailscaled.service'), 'activating disabled\n');
    before = calls(t).length;
    assert.equal(fire(t, q.id).status, 0);
    asked = calls(t).slice(before).filter(c => c[0] === 'systemctl' && c[1] !== 'show').map(c => c.slice(1).join(' '));
    assert.ok(asked.includes('stop tailscaled.service'), asked.join(' | '));
  });

  test('putback that fails leaves the timer to try again', { timeout: 120000 }, () => {
    const s = netted();
    const r = net(s, SSH_CHANGE);
    writeFileSync(join(G(s, r.id), 'manifest.json'), 'not json');
    const p = run(s, ['putback', '--id', r.id]);
    refused({ ...p, id: r.id }, 'the put-back failed');
    assert.ok(timerWaits(s, r.id), 'its timer still waits');
  });

  test('a later try starts what an earlier try stopped and reloads what it put back (the review\'s S4)', () => {
    const s = netted();
    const r = net(s, 'true');
    writeFileSync(join(G(s, r.id), 'stopped'), 'console tailscaled');
    writeFileSync(join(G(s, r.id), 'put'), '/etc/ssh/sshd_config\n');
    assert.equal(fire(s, r.id).status, 0);
    const result = readFileSync(join(G(s, r.id), 'result'), 'utf8').split('\n');
    for (const l of ['reload systemctl start tailscaled.service: ok', 'reload systemctl --machine=owner@.host --user start spark-console-api.service: ok',
      'reload systemctl try-reload-or-restart ssh.service: ok']) assert.ok(result.includes(l), `${l}\n${result.join('\n')}`);
    for (const f of ['stopped', 'put']) assert.ok(!existsSync(join(G(s, r.id), f)), `${f} is gone once the put-back is done`);
  });

  test('ufw is not turned on again while a file of its own could not be put back (S5)', () => {
    const s = netted();
    s.put('etc/ufw/user.rules', 'rules\n');
    s.put('standin/ufw', 'active\n');
    const env = binOf(s, { ufw: UFW });
    const r = netIn(s, env, 'ufw disable; printf "changed\\n" > "$SPARK_CONSOLE_REHEARSAL/etc/ufw/user.rules"');
    rmSync(join(G(s, r.id), 'files/etc/ufw/user.rules'));   // (its copy gone: that file cannot go back)
    assert.equal(fire(s, r.id, 'timer', env).status, 0);
    const result = readFileSync(join(G(s, r.id), 'result'), 'utf8').split('\n');
    assert.ok(result.some(l => l.startsWith('not put back /etc/ufw/user.rules: ')), result.join('\n'));
    assert.ok(!result.includes('put back ufw'), result.join('\n'));
    assert.equal(readFileSync(join(s.R, 'standin/ufw'), 'utf8').trim(), 'inactive', 'off, rather than on with the change\'s rules');
  });

  test('a unit masked and stopped at the copy, unmasked and started in the window, is masked and stopped again (S6)', () => {
    const s = netted();
    s.put('standin/units/ssh.service', 'inactive masked\n');
    const r = net(s, 'systemctl unmask ssh.service; systemctl start ssh.service');
    assert.equal(readFileSync(join(s.R, 'standin/units/ssh.service'), 'utf8').trim(), 'active disabled');
    assert.equal(fire(s, r.id).status, 0);
    assert.equal(readFileSync(join(s.R, 'standin/units/ssh.service'), 'utf8').trim(), 'inactive masked');
  });

  test('a unit counts as put back only when systemd said ok to each call (S9)', () => {
    const s = netted();
    s.put('standin/units/ssh.service', 'active enabled\n');
    const r = net(s, 'systemctl stop ssh.service');
    const env = binOf(s, { systemctl: `[ "$*" = "start ssh.service" ] && { echo "Job failed" >&2; exit 1; }; exec "${join(MOCKBIN, 'systemctl')}" "$@"` });
    assert.equal(fire(s, r.id, 'timer', env).status, 0);
    const result = readFileSync(join(G(s, r.id), 'result'), 'utf8').split('\n');
    assert.ok(result.includes('not put back the unit ssh.service: systemctl said exit 1'), result.join('\n'));
    assert.ok(!result.includes('put back the unit ssh.service'), result.join('\n'));
    assert.match(result[0], /: 0 went back, 1 did not$/);
  });

  test('a change to /etc/ssh that sshd -t refuses goes back at once, saying why (a refused reload bites only at the next start)', () => {
    const s = netted();
    s.put('standin/sshd-refuses', '/etc/ssh/sshd_config line 1: Bad configuration option: Prot\n');
    const r = net(s, 'printf "Prot 2222\\n" > "$SPARK_CONSOLE_REHEARSAL/etc/ssh/sshd_config"');
    assert.match(r.stdout, new RegExp(`\\n${r.id} net: sshd -t refuses the changed /etc/ssh \\(/etc/ssh/sshd_config line 1: Bad configuration option: Prot\\), `
      + `so what differs goes back now\\n${r.id} net put back at \\S+: 1 went back, 0 did not\\n${r.id} end 0\\n$`), r.stdout);
    assert.equal(readFileSync(join(s.R, SSHD), 'utf8'), 'Port 22\n');
    assert.ok(!timerWaits(s, r.id), 'its timer is stopped: nothing is left for it');
    // sshd takes it: the net stays open as before, and only a change under /etc/ssh is checked.
    const t = netted();
    const q = net(t, 'printf "Port 2222\\n" > "$SPARK_CONSOLE_REHEARSAL/etc/ssh/sshd_config"');
    assert.match(q.stdout, new RegExp(`\\n${q.id} net open: 1 of the ways in differs \\(/etc/ssh\\)`), q.stdout);
    assert.ok(calls(t).some(c => c[0] === 'sshd'));
    const u = netted();
    u.put('standin/sshd-refuses', 'never asked\n');
    const v = net(u, 'true');
    assert.ok(!calls(u).some(c => c[0] === 'sshd') && / net open: nothing differs now/.test(v.stdout), v.stdout);
  });

  test('a moved ssh port behind ssh.socket: after sshd_config goes back, systemd is told and the socket restarted', () => {
    const s = netted();
    s.put('standin/units/ssh.socket', 'active enabled\n');
    const r = net(s, SSH_CHANGE);
    const before = calls(s).length;
    assert.equal(fire(s, r.id).status, 0);
    const asked = calls(s).slice(before).filter(c => c[0] === 'systemctl' && c[1] !== 'show').map(c => c.slice(1).join(' '));
    assert.ok(asked.indexOf('daemon-reload') >= 0 && asked.indexOf('restart ssh.socket') > asked.indexOf('daemon-reload'), asked.join(' | '));
  });

  test('what cannot be put back is said by name, in the net\'s line and the result: Tailscale signed out or signed in as another key, a unit whose package went', () => {
    const TS = '[ "$1 $2" = "status --json" ] && cat "$SPARK_CONSOLE_REHEARSAL/standin/ts-status"';
    const ts = (state, key) => JSON.stringify({ BackendState: state, Self: { PublicKey: key } });
    for (const [what, cmd, said] of [
      ['signed out', `printf '%s' '${ts('NeedsLogin', 'nodekey:one')}' > "$SPARK_CONSOLE_REHEARSAL/standin/ts-status"`, 'Tailscale was signed out'],
      ['another key', `printf '%s' '${ts('Running', 'nodekey:two')}' > "$SPARK_CONSOLE_REHEARSAL/standin/ts-status"`, 'Tailscale was signed in again, as another key'],
      ['a package', 'rm "$SPARK_CONSOLE_REHEARSAL/standin/units/ssh.service"', 'ssh.service is gone (its package removed?)'],
    ]) {
      const s = netted();
      s.put('standin/ts-status', ts('Running', 'nodekey:one'));
      s.put('standin/units/ssh.service', 'active enabled\n');
      const env = binOf(s, { tailscale: TS });
      const r = netIn(s, env, cmd);
      assert.match(r.stdout, new RegExp(`${r.id} net open: cannot be put back: ${said.replace(/[().?]/g, '\\$&')}\\n${r.id} end 0\\n$`), `${what}: ${r.stdout}`);
      assert.equal(fire(s, r.id, 'timer', env).status, 0);
      assert.ok(readFileSync(join(G(s, r.id), 'result'), 'utf8').includes(`cannot be put back: ${said}\n`), what);
    }
  });

  test("putback puts back now, on the console's word, also when the timer is gone; after a keep it puts nothing back", () => {
    const s = netted();
    const r = net(s, SSH_CHANGE);
    assert.ok(existsSync(join(G(s, r.id), 'lock')), 'the lock is made when arming');
    rmSync(join(s.R, 'standin/timers', `sw-guard-${r.id}.timer`));
    const p = run(s, ['putback', '--id', r.id]);
    assert.equal(p.status, 0, p.stdout + p.stderr);
    assert.match(p.stdout, new RegExp(`^${r.id} put back at \\S+: 1 went back, 0 did not\\n$`));
    assert.equal(readFileSync(join(s.R, SSHD), 'utf8'), 'Port 22\n');
    assert.equal(readFileSync(join(G(s, r.id), 'result'), 'utf8').split('\n')[1], "on the console's word");
    assert.match(run(s, ['putback', '--id', r.id]).stdout, / already put back at /);
    const t = netted(), q = net(t, SSH_CHANGE);
    keep(t, q.id);
    assert.equal(run(t, ['putback', '--id', q.id]).stdout, `${q.id} kept already: nothing goes back\n`);
    assert.equal(readFileSync(join(t.R, SSHD), 'utf8'), 'Port 2222\n');
    refused({ ...run(t, ['putback', '--id', 'nosuchguard1']), id: 'nosuchguard1' }, 'there is no guard nosuchguard1 on this Spark');
  });

  test('copies older than 7 days go when a guard is armed; an open guard\'s never', () => {
    const s = netted();
    const r = net(s, SSH_CHANGE);
    keep(s, r.id);
    const old = new Date(Date.now() - 8 * 86400000), open = join(s.R, 'var/lib/spark-console/guard', 'oldopenguard1');
    mkdirSync(open);
    for (const f of ['pending', 'proof', 'restore.sh']) writeFileSync(join(open, f), '');
    utimesSync(G(s, r.id), old, old);
    utimesSync(open, old, old);
    const n = net(s, 'true');
    assert.match(n.stdout, /net armed: /);
    assert.ok(!existsSync(G(s, r.id)), 'the kept one, 8 days old, is gone');
    assert.ok(existsSync(open) && existsSync(G(s, n.id)), 'an open one never');
  });

  test('its timer stopped while the command ran (systemctl isolate, say): what differs goes back at once, and it says so', () => {
    const s = netted();
    const r = net(s, `${SSH_CHANGE}; rm -f "$SPARK_CONSOLE_REHEARSAL"/standin/timers/sw-guard-*.timer`);
    assert.match(r.stdout, new RegExp(`\\n${r.id} net: its timer is not waiting \\(inactive\\), so what differs goes back now\\n${r.id} net put back at \\S+: 1 went back, 0 did not\\n${r.id} end 0\\n$`), r.stdout);
    assert.equal(readFileSync(join(s.R, SSHD), 'utf8'), 'Port 22\n');
  });

  test('--net never with --open; --memory 1G to 8G only, for a change: its unit gets that cap, and the proof sees it held', () => {
    const s = netted();
    refused(net(s, 'true', { extra: ['--net', '--open'] }), "a change inside the net never takes --open: its groups could reach the net's timer");
    const r = change(s, 'true', { extra: ['--memory', '4G'] });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(unitCall(s, `sw-run-${r.id}`).includes('MemoryMax=4G'));
    for (const m of ['9G', '0G', '4', '4g', '16G']) refused(change(s, 'true', { extra: ['--memory', m] }), "--memory must be 1G to 8G (the run wall's own cap is 8G)");
    refused(look(s, 'true', { extra: ['--memory', '2G'] }), "--memory is for run: a look's memory is fixed");
    const t = spark({ knobs: { 'let-through': '21 run\n' } });
    const q = prove(t);
    assert.equal(q.status, 1);
    assert.ok(q.stdout.includes(`${q.id} proof run 21 got through: more memory, swap or share than the change was given (stand-in, directly)\n`), q.stdout);
  });

  test("Spark 2's sessions.json is not a way in: a change to it alone differs in nothing", () => {
    const s = netted();
    const r = net(s, 'printf "{\\"x\\":1}" > "$SPARK_CONSOLE_REHEARSAL/home/owner/.local/state/spark-console/sessions.json"');
    assert.match(r.stdout, / net open: nothing differs now; /);
    const manifest = JSON.parse(readFileSync(join(G(s, r.id), 'manifest.json'), 'utf8'));
    assert.ok(!('/home/owner/.local/state/spark-console/sessions.json' in manifest.entries));
  });

  test('the put-back\'s failure paths: one path that cannot be made does not stop the rest; a name a change left does not block a put; Tailscale and the console are stopped, put back, started; the restart unit has a time limit', () => {
    const s = netted();
    s.put('var/lib/tailscale/tailscaled.state', 'state-one');
    s.put('home/owner/.local/state/spark-console/passkeys.json', '{}');
    s.put('standin/ts-prefs', '{"RunSSH":false}');
    s.put('etc/hosts', '127.0.0.1 localhost\n');
    const env = binOf(s, { tailscale: '[ "$1 $2" = "debug prefs" ] && cat "$SPARK_CONSOLE_REHEARSAL/standin/ts-prefs"' });
    const R = '"$SPARK_CONSOLE_REHEARSAL"';
    const r = netIn(s, env, [`printf '{"RunSSH":true}' > ${R}/standin/ts-prefs`, `printf state-two > ${R}/var/lib/tailscale/tailscaled.state`,
      `printf '{"x":1}' > ${R}/home/owner/.local/state/spark-console/passkeys.json`, `mkdir ${R}/etc/.sw-guard-${'$'}(ls ${R}/var/lib/spark-console/guard | grep -v proof | tail -n 1)`,
      `printf "1.2.3.4 x\\n" >> ${R}/etc/hosts`].join('; '));
    assert.match(readFileSync(join(s.R, 'etc/systemd/system', `sw-guard-boot-${r.id}.service`), 'utf8'), /\nTimeoutStartSec=300\n/);
    const before = calls(s).length;
    assert.equal(fire(s, r.id, 'timer', env).status, 0);
    assert.equal(readFileSync(join(s.R, 'var/lib/tailscale/tailscaled.state'), 'utf8'), 'state-one');
    assert.equal(readFileSync(join(s.R, 'home/owner/.local/state/spark-console/passkeys.json'), 'utf8'), '{}');
    const asked = calls(s).slice(before).filter(c => c[0] === 'systemctl' && c[1] !== 'show').map(c => c.slice(1).join(' '));
    const at = c => asked.indexOf(c);
    assert.ok(at('stop tailscaled.service') >= 0 && at('start tailscaled.service') > at('stop tailscaled.service'), asked.join(' | '));
    assert.ok(at('--machine=owner@.host --user stop spark-console-api.service') >= 0
      && at('--machine=owner@.host --user start spark-console-api.service') > at('--machine=owner@.host --user stop spark-console-api.service'), asked.join(' | '));
    assert.ok(!readFileSync(join(s.R, 'etc/hosts'), 'utf8').includes('1.2.3.4'), 'a name a change left beside it did not block it');
    // A folder that cannot be made again ends that path only.
    const t = netted();
    t.put('var/lib/systemd/linger/owner', '');
    const q = net(t, `rm -rf ${R}/var/lib/systemd/linger; chmod 555 ${R}/var/lib/systemd; ${SSH_CHANGE}`);
    try {
      assert.equal(fire(t, q.id).status, 0);
      assert.equal(readFileSync(join(t.R, SSHD), 'utf8'), 'Port 22\n', 'the rest went back');
      assert.ok(readFileSync(join(G(t, q.id), 'result'), 'utf8').includes('not put back /var/lib/systemd/linger/owner: /var/lib/systemd/linger could not be made again (Permission denied)'),
        readFileSync(join(G(t, q.id), 'result'), 'utf8'));
    } finally { chmodSync(join(t.R, 'var/lib/systemd'), 0o755); }
  });

  test('a put-back that fails is tried three times, 20 s apart, each failure written down, and pending stays', { timeout: 120000 }, () => {
    const s = netted();
    const r = net(s, SSH_CHANGE);
    writeFileSync(join(G(s, r.id), 'manifest.json'), 'not json');
    const f = fire(s, r.id);
    assert.equal(f.status, 1);
    assert.equal(readFileSync(join(G(s, r.id), 'failures'), 'utf8').trim().split('\n').length, 3);
    assert.ok(existsSync(join(G(s, r.id), 'pending')) && !existsSync(join(G(s, r.id), 'result')));
  });

  test("the console's guardAnswer reads the net's line as the one before the last end line: lines the command printed never count; guardScript takes only an id's shape", () => {
    const part = readFileSync(join(REPO, 'service', 'src', '21-guard.mjs'), 'utf8');
    const box = vm.createContext({ createHash, q: x => `'${String(x).replace(/'/g, `'\\''`)}'`, HELPER_AT: '/usr/local/sbin/spark-console-root', HELPER_SHA256: '0'.repeat(64) });
    vm.runInContext(`${part}\n;globalThis.part = { guardScript, guardAnswer };`, box);
    const id = 'answer0001';
    const a = box.part.guardAnswer(id, [`${id} net armed: the ways in go back at 2026-11-15T10:00:00Z unless they are kept`,
      `${id} refused: forged`, `${id} kept: forged`, `${id} net open: forged`, '',
      `${id} net open: 1 of the ways in differs (/etc/ssh) and goes back at 2026-11-15T10:00:00Z unless it is kept`, `${id} end 0`, ''].join('\n'));
    assert.deepEqual({ refused: a.refused, kept: a.kept, open: a.open, exit: a.exit, at: a.goesBackAt },
      { refused: undefined, kept: false, open: '1 of the ways in differs (/etc/ssh) and goes back at 2026-11-15T10:00:00Z unless it is kept', exit: 0, at: '2026-11-15T10:00:00Z' });
    assert.equal(box.part.guardAnswer(id, `${id} put back at 2026-11-15T10:00:00Z: 1 went back, 0 did not\n`).putBackAt, '2026-11-15T10:00:00Z: 1 went back, 0 did not');
    assert.match(box.part.guardScript({ host: '100.64.0.3' }, 'putback', { id }), /"\$h" putback --id "\$id" <\/dev\/null 2>&1$/);
    for (const bad of ['short', 'UPPER0001', 'x;rm -rf /', '../../etc0', 'a'.repeat(41)]) assert.throws(() => box.part.guardScript({ host: '100.64.0.3' }, 'run', { id: bad, command: 'true' }), /A guard id is 8 to 40 of a-z and 0-9/);
  });

  test('the proof tries the net in both walls (15 to 18, checked from outside afterwards); one that gets through fails the proof', () => {
    const s = spark();
    const p = prove(s);
    assert.equal(p.status, 0, p.stdout + p.stderr);
    for (const [n, what] of [[15, "stopping or changing the net's timer"], [16, "writing the net's copies or restore.sh"], [17, "taking away the net's pending mark"], [18, 'making keep count']]) {
      for (const w of ['look', 'run']) assert.ok(p.stdout.includes(`${p.id} proof ${w} ${n} blocked: ${what}\n`), `${w} ${n}`);
    }
    const g = p.id.slice(0, 38);
    for (const w of ['l', 'r']) assert.ok(!existsSync(G(s, `${g}n${w}`)), 'its guards are taken away');
    const t = spark({ knobs: { 'let-through': '17 run after\n' } });
    const q = prove(t);
    assert.equal(q.status, 1);
    assert.ok(q.stdout.includes(`${q.id} proof run 17 got through: taking away the net's pending mark (stand-in, seen from outside afterwards)\n`), q.stdout);
    assert.ok(!existsSync(join(t.R, 'var/lib/spark-console/proved')));
  });

  test("the console's call (21-guard.mjs): run --net through sudo with the helper this build ships, armed then open; keep by the guard's id", () => {
    const s = netted(), home = mkdtempSync(join(tmpdir(), 'guard-home-')), bin = join(home, 'bin');
    temps.push(home);
    symlinkSync(s.R, join(home, '.rehearsal'));
    mkdirSync(bin);
    writeFileSync(join(bin, 'sudo'), '#!/bin/bash\n[ "$1" = -n ] && shift\nexec "$@"\n', { mode: 0o755 });
    const part = readFileSync(join(REPO, 'service', 'src', '21-guard.mjs'), 'utf8');
    const pinned = /const HELPER_SHA256 = '([0-9a-f]{64})'/.exec(readFileSync(join(REPO, 'service', 'src', '21-work.mjs'), 'utf8'))[1];
    const box = vm.createContext({ createHash, q: x => `'${String(x).replace(/'/g, `'\\''`)}'`, HELPER_AT: '"$HOME/.rehearsal"/usr/local/sbin/spark-console-root', HELPER_SHA256: pinned });
    vm.runInContext(`${part}\n;globalThis.part = { guardScript, guardAnswer };`, box);
    const env = { ...s.env, HOME: home, PATH: `${bin}:${s.env.PATH}` };
    const call = (verb, o) => spawnSync('bash', ['-s'], { input: box.part.guardScript({ host: '100.64.0.3' }, verb, o), env, encoding: 'utf8', timeout: 120000 });
    const id = 'guardcall' + Date.now().toString(36);
    const a = box.part.guardAnswer(id, call('run', { id, command: 'printf "Port 2222\\n" > "$SPARK_CONSOLE_REHEARSAL/etc/ssh/sshd_config"', seconds: 300 }).stdout);
    assert.match(a.goesBackAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/, JSON.stringify(a));
    assert.deepEqual({ open: /^1 of the ways in differs \(\/etc\/ssh\)/.test(a.open), exit: a.exit }, { open: true, exit: 0 });
    const k = box.part.guardAnswer(id, call('keep', { id }).stdout);
    assert.equal(k.kept, true, JSON.stringify(k));
    assert.equal(readFileSync(join(s.R, SSHD), 'utf8'), 'Port 2222\n');
    // A helper this build does not ship: nothing is asked of it.
    const other = vm.createContext({ ...box, HELPER_SHA256: '0'.repeat(64) });
    vm.runInContext(`${part}\n;globalThis.part = { guardScript, guardAnswer };`, other);
    const u = other.part.guardAnswer('guardother1', spawnSync('bash', ['-s'], { input: other.part.guardScript({ host: '100.64.0.3' }, 'run', { id: 'guardother1', command: 'true' }), env, encoding: 'utf8' }).stdout);
    assert.match(u.said, /^unknown [0-9a-f]{64}$/);
  });
});

// Section D of the wall analyst's read (2a179d2), for this helper change.
describe('the held lists, after the analyst', () => {
  test('a look refuses while .ssh, .docker or the console\'s own folder is a link (it would see what the link points at)', () => {
    for (const n of ['.ssh', '.docker', '.local/share/spark-console']) {
      const s = proven(), p = join(s.R, 'home/owner', n);
      renameSync(p, `${p}-real`);
      symlinkSync(`${p}-real`, p);
      const before = started(s).length;
      refused(look(s, 'true'), `/home/owner/${n} is a link, or under one, so a look would see what it points at: put the real folder there`);
      assert.equal(started(s).length, before, n);
      assert.match(run(s, ['check', '--id', newId()]).stdout, / look refuses: \/home\/owner\/\S+ is a link, or under one, so a look would see/);
    }
  });

  test('a held place under a --protect folder is not bound onto itself (that would make it writable inside the read-only one)', () => {
    const s = proven(), shared = '/home/owner/.local/share/spark-portal/workspaces/shared';
    const r = change(s, 'true', { extra: ['--protect', shared] });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const c = unitCall(s, `sw-run-${r.id}`);
    assert.ok(c.includes(`ReadOnlyPaths=${shared}`));
    assert.ok(!c.some(a => a === `BindPaths=${shared}` || a === `BindPaths=${shared}/jobs`), c.filter(a => a.startsWith('BindPaths=')).join(' '));
  });

  test("each job's own output folder that is there is bound onto itself in the run wall (not a link, not one under a --protect folder); a proof that sees one swapped fails", () => {
    const s = proven(), jobs = '/home/owner/.local/share/spark-portal/workspaces/shared/jobs';
    for (const n of ['sums', 'train.v2']) mkdirSync(join(s.R, jobs, n));
    s.put('elsewhere/x');
    symlinkSync(join(s.R, 'elsewhere'), join(s.R, jobs, 'linked'));
    s.put(`${jobs.slice(1)}/a-file`);
    const r = change(s, 'true');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    // (a plain change: read-only with the top of the home; with --open, each bound onto itself)
    assert.deepEqual(unitCall(s, `sw-run-${r.id}`).filter(a => a.startsWith(`BindPaths=${jobs}/`)), []);
    const o = change(s, 'true', { extra: ['--open'] });
    const binds = unitCall(s, `sw-run-${o.id}`).filter(a => a.startsWith(`BindPaths=${jobs}/`));
    assert.deepEqual(binds, [`BindPaths=${jobs}/sums`, `BindPaths=${jobs}/train.v2`]);
    const l = look(s, 'true');
    assert.ok(!unitCall(s, `sw-look-${l.id}`).some(a => a.startsWith('BindPaths=')), 'a look binds nothing');
    const p = change(s, 'true', { extra: ['--open', '--protect', jobs] });
    assert.ok(!unitCall(s, `sw-run-${p.id}`).some(a => a.startsWith(`BindPaths=${jobs}`)), 'under a --protect folder, nothing in it is bound');
    const t = spark({ knobs: { 'let-through': '19 run after\n' } });
    const q = prove(t);
    assert.equal(q.status, 1);
    assert.ok(q.stdout.includes(`${q.id} proof run 19 got through: swapping a job's own output folder for a link (stand-in, seen from outside afterwards)\n`), q.stdout);
  });

  test("the retired door's door.json and cloud.json are never put back in either wall", () => {
    const s = proven();
    for (const f of ['door.json', 'cloud.json']) s.put(`home/owner/.local/state/spark-console/${f}`, '{"token":"x"}');
    const r = change(s, 'true'), l = look(s, 'true');
    for (const c of [unitCall(s, `sw-run-${r.id}`), unitCall(s, `sw-look-${l.id}`)]) {
      assert.ok(c.includes('BindReadOnlyPaths=/home/owner/.local/state/spark-console/desired.json'), 'its other plain files are');
      assert.ok(!c.some(a => /door\.json|cloud\.json/.test(a)), c.filter(a => /door|cloud/.test(a)).join(' '));
    }
  });

  test(".config/spark-console must be there for a change; the one-time command makes it, and the console's own folders, the owner's alone", () => {
    const s = proven();
    rmSync(join(s.R, 'home/owner/.config/spark-console'), { recursive: true });
    refused(change(s, 'true'), '/home/owner/.config/spark-console is not there, so it cannot be held: run the one-time command again');
    const f = fleet(), home = join(f.T, 'spark3');
    const r = f.cmd(['3']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.stdout.includes('  made .config/spark-console (it was not there, and the run wall holds it)\n'));
    for (const n of ['.config/spark-console', '.local/share/spark-console', '.local/share/spark-portal/workspaces/shared', '.local/share/spark-portal/workspaces/shared/jobs']) {
      assert.equal(statSync(join(home, n)).mode & 0o777, 0o700, n);
    }
    assert.equal(statSync(join(home, '.config/systemd')).mode & 0o777, 0o755, 'the others as before');
  });
});

// What bounds a plain change (R63; the wall analyst's "what a sorter miss can cost"): each with its try in the proof.
describe('what bounds a plain change (R63)', () => {
  test("the home's own mode and owner are put back right after a change, and said", () => {
    const s = proven(), home = join(s.R, 'home/owner'), was = statSync(home).mode & 0o7777;
    const r = change(s, 'chmod 777 "$SPARK_CONSOLE_REHEARSAL/home/owner"');
    assert.equal(statSync(home).mode & 0o7777, was);
    assert.match(r.stdout, new RegExp(`\\n${r.id} the home's mode and owner were put back \\(${was.toString(8)}, not 777\\)\\n${r.id} end 0\\n$`), r.stdout);
    const q = change(s, 'true');
    assert.match(q.stdout, new RegExp(`^\\n${q.id} end 0\\n$`), 'nothing said when nothing changed');
  });

  test("the tools' key folders are hidden in both walls", () => {
    const s = proven();
    for (const d of ['.kaggle', '.config/rclone', '.config/gcloud', '.ollama', '.codex']) mkdirSync(join(s.R, 'home/owner', d), { recursive: true });
    s.put('home/owner/.claude.json', '{}');
    const r = change(s, 'true'), l = look(s, 'true');
    for (const c of [unitCall(s, `sw-run-${r.id}`), unitCall(s, `sw-look-${l.id}`)]) {
      for (const d of ['.kaggle', '.config/rclone', '.config/gcloud', '.ollama', '.codex']) assert.ok(c.includes(`TemporaryFileSystem=/home/owner/${d}:ro`), d);
      assert.ok(c.includes('InaccessiblePaths=/home/owner/.claude.json'));
    }
  });

  test('the top of the home is read-only but its plain folders and the download caches; ~/bin and a link there are not writable', () => {
    const s = proven();
    for (const d of ['work', 'bin', '.npm', '.cargo/registry', '.cargo/bin']) mkdirSync(join(s.R, 'home/owner', d), { recursive: true });
    mkdirSync(join(s.R, 'elsewhere'));
    symlinkSync(join(s.R, 'elsewhere'), join(s.R, 'home/owner/linked'));
    const r = change(s, 'true');
    const rw = unitCall(s, `sw-run-${r.id}`).filter(a => a.startsWith('ReadWritePaths=')).map(a => a.slice(15));
    assert.deepEqual(rw, ['/home/owner/models', '/home/owner/work', '/home/owner/.cache', '/home/owner/.npm', '/home/owner/.cargo/registry']);
    assert.ok(unitCall(s, `sw-run-${r.id}`).includes('ReadOnlyPaths=/home/owner'));
    const o = change(s, 'true', { extra: ['--open'] });
    assert.ok(!unitCall(s, `sw-run-${o.id}`).some(a => a === 'ReadOnlyPaths=/home/owner' || a.startsWith('ReadWritePaths=')), 'with --open, as before');
  });

  test('--fleet lifts the home network and the tailnet but not the loopback; --gpu keeps the devices; both for a change only', () => {
    const s = proven();
    const r = change(s, 'true', { extra: ['--fleet', '--gpu'] });
    const c = unitCall(s, `sw-run-${r.id}`);
    assert.ok(c.includes('IPAddressDeny=localhost') && !c.some(a => a.startsWith('IPAddressDeny=localhost ')));
    assert.ok(!c.includes('PrivateDevices=yes') && c.includes('TemporaryFileSystem=/dev/shm:mode=1777,nosuid') && c.includes('PrivateIPC=yes'));
    refused(look(s, 'true', { extra: ['--fleet'] }), '--fleet and --gpu are for run: a look reaches no network and no device');
    refused(look(s, 'true', { extra: ['--gpu'] }), '--fleet and --gpu are for run: a look reaches no network and no device');
  });

  test('--protect takes ~/ and a folder in the owner\'s home; ~user/, ~/../x, a bare ~ and a link under ~ are refused; up to 8', () => {
    const s = proven();
    for (const d of ['.cache/huggingface', '.local/share/spark-portal/workspaces/shared']) mkdirSync(join(s.R, 'home/owner', d), { recursive: true });
    const r = change(s, 'true', { extra: ['--protect', '~/models', '--protect', '~/.cache/huggingface', '--protect', '~/.local/share/spark-portal/workspaces/shared'] });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const c = unitCall(s, `sw-run-${r.id}`);
    for (const p of ['models', '.cache/huggingface', '.local/share/spark-portal/workspaces/shared']) assert.ok(c.includes(`ReadOnlyPaths=/home/owner/${p}`), p);
    for (const bad of ['~owner/models', '~/../other', '~', '~/']) refused(change(s, 'true', { extra: ['--protect', bad] }), '--protect');
    symlinkSync(join(s.R, 'home/owner/models'), join(s.R, 'home/owner/models-link'));
    refused(change(s, 'true', { extra: ['--protect', '~/models-link'] }), '--protect must name a folder that is there, with no link in its path');
    assert.equal(change(s, 'true', { extra: Array(8).fill(['--protect', '~/models']).flat() }).status, 0);
  });

  test('state --id: never (its call ended without starting it), running (or may still start), ended; unknown for an id never seen; an id is never used twice', async () => {
    const s = proven();
    const st = id => run(s, ['state', '--id', id]).stdout;
    assert.equal(st('neverseen01'), 'neverseen01 state unknown: no call with this id has begun here (since the Spark started)\n');
    const bad = change(s, 'true', { hash: '0'.repeat(64) });
    refused(bad, "the command's bytes do not have the SHA-256 it was given");
    assert.equal(st(bad.id), `${bad.id} state never: it never started, and its call has ended, so it cannot start now\n`);
    const id = newId(), cmd = 'for i in $(seq 200); do [ -e "$SPARK_CONSOLE_REHEARSAL/go-on" ] && exit 0; sleep 0.1; done; exit 3';
    const child = spawn(join(s.R, 'usr/local/sbin/spark-console-root'), ['run', '--id', id, '--sha256', sha(cmd), '--seconds', '60', '--dir', s.work, '--', cmd], { env: s.env, stdio: 'ignore' });
    const ended = new Promise(res => child.on('exit', res));
    let seen = '';
    for (let i = 0; i < 100 && !seen.includes(' state running'); i++) { await new Promise(res => setTimeout(res, 100)); seen = st(id); }
    assert.equal(seen, `${id} state running: it runs, or may still start\n`);
    writeFileSync(join(s.R, 'go-on'), '');
    assert.equal(await ended, 0);
    assert.equal(st(id), `${id} state ended: it ran and has ended\n`);
    refused(change(s, 'true', { id }), 'this id was used already');
    // A call hung up before it handed its unit to systemd (here while it arms the net): never.
    s.put('standin/guard-sleep', '20');
    const nid = newId();
    const c2 = spawn(join(s.R, 'usr/local/sbin/spark-console-root'), ['run', '--id', nid, '--sha256', sha('true'), '--seconds', '300', '--dir', s.work, '--net', '--', 'true'],
      { env: s.env, detached: true, stdio: 'ignore' });
    const pending = join(s.R, 'var/lib/spark-console/guard', nid, 'pending');
    for (let i = 0; i < 200 && !existsSync(pending); i++) await new Promise(res => setTimeout(res, 50));
    const gone = new Promise(res => c2.on('exit', res));
    process.kill(-c2.pid, 'SIGTERM');
    assert.equal(await gone, 129);
    assert.equal(st(nid), `${nid} state never: it never started, and its call has ended, so it cannot start now\n`);
  });

  test('state --id after the call died once its unit was handed over: each unit\'s state read whole ("inactive" is not running)', () => {
    const s = proven();
    const st = id => run(s, ['state', '--id', id]).stdout;
    const handed = () => { const id = newId(); s.put(`run/spark-console/.calls/${id}`, 'handed 999999 1\n'); return id; };
    // Both units inactive, the call's process gone (an out-of-memory kill, a kill -9): ended, never "running" for good.
    const a = handed();
    assert.equal(st(a), `${a} state ended: its call is gone and nothing of it runs\n`);
    // The change's unit still active: running.
    const b = handed();
    s.put(`standin/active/sw-run-${b}.service`, '');
    assert.equal(st(b), `${b} state running: it runs, or may still start\n`);
    // "inactive" for one, no answer at all for the other: the silent one may still run (second read).
    const c = handed();
    s.put(`standin/silent/sw-look-${c}.service`, '');
    assert.equal(st(c), `${c} state running: it runs, or may still start\n`);
    const c2 = handed();
    s.put(`standin/silent/sw-run-${c2}.service`, '');
    assert.equal(st(c2), `${c2} state running: it runs, or may still start\n`);
    // No answer for either (systemd not answering): it may still run, so never "ended" on that.
    const d = handed();
    s.put(`standin/silent/sw-run-${d}.service`, '');
    s.put(`standin/silent/sw-look-${d}.service`, '');
    assert.equal(st(d), `${d} state running: it runs, or may still start\n`);
  });

  test('systemd silent for a minute after the unit ran: the call leaves its mark "handed", and state asks systemd, never "ended" unasked (second read)', { timeout: 200000 }, () => {
    const s = proven();
    const id = newId();
    s.put(`standin/silent/sw-run-${id}.service`, '');
    const r = spawnSync(join(s.R, 'usr/local/sbin/spark-console-root'), ['run', '--id', id, '--sha256', sha('true'), '--seconds', '60', '--dir', s.work, '--', 'true'],
      { env: s.env, encoding: 'utf8', timeout: 180000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(readFileSync(join(s.R, 'run/spark-console/.calls', id), 'utf8'), /^handed /);
    assert.equal(run(s, ['state', '--id', id]).stdout, `${id} state running: it runs, or may still start\n`);
    rmSync(join(s.R, `standin/silent/sw-run-${id}.service`));
    assert.equal(run(s, ['state', '--id', id]).stdout, `${id} state ended: its call is gone and nothing of it runs\n`);
  });

  test('--home: the plain wall with the top of the home, ~/.local, ~/bin and ~/.cargo/bin writable; never with --open, never a look', () => {
    const s = proven();
    for (const d of ['bin', '.cargo/bin', '.local/bin', 'work']) mkdirSync(join(s.R, 'home/owner', d), { recursive: true });
    const r = change(s, 'true', { extra: ['--home'] });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const c = unitCall(s, `sw-run-${r.id}`);
    assert.ok(!c.includes('ReadOnlyPaths=/home/owner'), 'the top itself is writable');
    const rw = c.filter(a => a.startsWith('ReadWritePaths=')).map(a => a.slice(15));
    for (const p of ['/home/owner/bin', '/home/owner/.local', '/home/owner/.cargo/bin', '/home/owner/.cache', '/home/owner/work']) assert.ok(rw.includes(p), `${p} in ${rw}`);
    assert.ok(c.includes('ReadOnlyPaths=/home/owner/.config') && !rw.includes('/home/owner/.config'), 'other dot names stay read-only');
    for (const x of ['IPAddressAllow=127.0.0.53', 'PrivateDevices=yes', 'PrivateIPC=yes', 'TemporaryFileSystem=/home/owner/.ssh:ro', 'InaccessiblePaths=/home/owner/.bashrc', 'MemorySwapMax=0']) assert.ok(c.includes(x), x);
    assert.ok(c.includes('--groups=1000,44,992'), 'its groups as a plain change');
    for (const p of SHARED_PINS) assert.ok(c.includes(`BindPaths=${p}`), `${p}: held in place again, ~/.local being writable`);
    refused(change(s, 'true', { extra: ['--home', '--open'] }), '--home is the plain wall with the top of the home writable: never with --open');
    refused(look(s, 'true', { extra: ['--home'] }), '--home is for run: a look writes nothing');
  });

  test('the hidden list keeps the listeners\' tokens, browsers and more tool keys, and Ollama\'s folder whole with its models put back read-only; more download caches are writable', () => {
    const s = proven();
    for (const d of ['.local/share/jupyter/runtime', '.jupyter', '.mozilla', '.config/sops', '.ollama/models', '.m2', '.gradle']) mkdirSync(join(s.R, 'home/owner', d), { recursive: true });
    for (const f of ['.ollama/id_ed25519', '.ollama/history', '.env', '.cargo/credentials.toml']) s.put(`home/owner/${f}`, 'k');
    const r = change(s, 'true'), l = look(s, 'true');
    for (const c of [unitCall(s, `sw-run-${r.id}`), unitCall(s, `sw-look-${l.id}`)]) {
      for (const d of ['.local/share/jupyter', '.jupyter', '.mozilla', '.config/sops']) assert.ok(c.includes(`TemporaryFileSystem=/home/owner/${d}:ro`), d);
      for (const f of ['.env', '.cargo/credentials.toml']) assert.ok(c.includes(`InaccessiblePaths=/home/owner/${f}`), f);
      // (its key and what the owner typed to models stay hidden with the folder; the models are in view, read-only)
      assert.ok(c.includes('TemporaryFileSystem=/home/owner/.ollama:ro') && c.includes('BindReadOnlyPaths=/home/owner/.ollama/models'), "Ollama's folder");
      assert.ok(!c.some(a => /\.ollama\/(id_ed25519|history)/.test(a)), 'neither its key nor its history is put back');
    }
    const rw = unitCall(s, `sw-run-${r.id}`).filter(a => a.startsWith('ReadWritePaths=')).map(a => a.slice(15));
    for (const p of ['/home/owner/.m2', '/home/owner/.gradle']) assert.ok(rw.includes(p), p);
  });

  test('Bun\'s, Yarn\'s and pnpm\'s folders are never writable whole (each holds a folder on the PATH): only the cache inside (second read, fix 1)', () => {
    const s = proven();
    for (const d of ['.bun/bin', '.bun/install/cache', '.yarn/bin', '.yarn/berry', '.local/share/pnpm/store']) mkdirSync(join(s.R, 'home/owner', d), { recursive: true });
    for (const extra of [[], ['--home']]) {
      const r = change(s, 'true', { extra });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const rw = unitCall(s, `sw-run-${r.id}`).filter(a => a.startsWith('ReadWritePaths=')).map(a => a.slice(15));
      for (const p of ['.bun/install/cache', '.yarn/berry', '.local/share/pnpm/store']) assert.ok(rw.includes(`/home/owner/${p}`), `${extra} ${p}`);
      for (const p of ['.bun', '.yarn', '.bun/bin', '.yarn/bin', '.local/share/pnpm']) assert.ok(!rw.includes(`/home/owner/${p}`), `${extra} ${p} is not named writable`);
    }
  });

  test('a plain change answers at once: the disk watch holds none of the caller\'s pipes', () => {
    const s = proven();
    const t0 = Date.now();
    const r = change(s, 'true');
    assert.equal(r.status, 0);
    assert.ok(Date.now() - t0 < 4000, `${Date.now() - t0} ms`);
  });

  test('the disk floor: under 50 GB free a change does not start; one whose disk falls under it is ended, and says so', () => {
    const s = proven(), bin = join(s.R, 'standin', 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'df'), '#!/bin/bash\necho Avail\ncat "$SPARK_CONSOLE_REHEARSAL/standin/free"\n', { mode: 0o755 });
    const env = { ...s.env, PATH: `${bin}:${s.env.PATH}` };
    const go = cmd => { const id = newId(); return { ...run(s, ['run', '--id', id, '--sha256', sha(cmd), '--seconds', '120', '--dir', s.work, '--', cmd], { env }), id }; };
    s.put('standin/free', '49000000000\n');
    const before = started(s).length;
    refused(go('true'), 'the disk has 49 GB free; a plain change needs 50 GB free: free space first, by a change the owner asks for (it may start under the floor, and is ended if the free space falls under 5 GB)');
    assert.equal(started(s).length, before);
    for (const asked of [['--open'], ['--home']]) {   // (an asked change may free space: no floor, no watch)
      const id = newId();
      const a = run(s, ['run', '--id', id, '--sha256', sha('true'), '--seconds', '120', '--dir', s.work, ...asked, '--', 'true'], { env });
      assert.equal(a.status, 0, `${asked}: ${a.stdout}${a.stderr}`);
    }
    s.put('standin/free', '60000000000\n');
    const cmd = 'printf "40000000000\\n" > "$SPARK_CONSOLE_REHEARSAL/standin/free"; for i in $(seq 60); do sleep 0.5; ls "$SPARK_CONSOLE_REHEARSAL"/standin/stopped/sw-run-* > /dev/null 2>&1 && exit 9; done';
    const r = go(cmd);
    assert.match(r.stdout, new RegExp(`\\n${r.id} stopped: the disk's free space fell under 50 GB\\n${r.id} end 9\\n$`), r.stdout);
  });

  test('--asked (the owner pressed): no start floor, but the watch ends it under 5 GB; --home is watched the same; one started under 5 GB, 100 MB under its start', { timeout: 200000 }, () => {
    const setup = free => {
      const s = proven(), bin = join(s.R, 'standin', 'bin');
      mkdirSync(bin, { recursive: true });
      writeFileSync(join(bin, 'df'), '#!/bin/bash\necho Avail\ncat "$SPARK_CONSOLE_REHEARSAL/standin/free"\n', { mode: 0o755 });
      s.put('standin/free', `${free}\n`);
      return { s, env: { ...s.env, PATH: `${bin}:${s.env.PATH}` } };
    };
    const go = ({ s, env }, cmd, extra) => { const id = newId(); return { ...run(s, ['run', '--id', id, '--sha256', sha(cmd), '--seconds', '120', '--dir', s.work, ...extra, '--', cmd], { env }), id }; };
    const fill = to => `printf "${to}\\n" > "$SPARK_CONSOLE_REHEARSAL/standin/free"; for i in $(seq 60); do sleep 0.5; ls "$SPARK_CONSOLE_REHEARSAL"/standin/stopped/sw-run-* > /dev/null 2>&1 && exit 9; done`;
    const ended = (r, under) => assert.match(r.stdout, new RegExp(`\\n${r.id} stopped: the disk's free space fell under ${under}\\n${r.id} end 9\\n$`), r.stdout);
    // Under the floor and pressed: it starts, and is ended when the free space falls under 5 GB.
    ended(go(setup(40000000000), fill(4000000000), ['--asked']), '5 GB');
    // --home: the same watch (it had none).
    ended(go(setup(60000000000), fill(4000000000), ['--home']), '5 GB');
    // Started under 5 GB: a delete runs to its end; a change that fills the disk further is ended 100 MB under its start.
    const del = go(setup(3000000000), 'printf "3500000000\\n" > "$SPARK_CONSOLE_REHEARSAL/standin/free"; sleep 7; exit 0', ['--asked']);
    assert.match(del.stdout, new RegExp(`(^|\\n)${del.id} end 0\\n$`), del.stdout);
    assert.ok(!del.stdout.includes('stopped:'), del.stdout);
    ended(go(setup(3000000000), fill(2800000000), ['--asked']), '2.9 GB');
    // --asked is run's alone, and gives nothing else: the unit is a plain change's.
    const t = setup(60000000000);
    refused(look(t.s, 'true', { extra: ['--asked'] }), '--asked is for run: a look changes nothing');
    const p = go(t, 'true', []), q = go(t, 'true', ['--asked']);
    assert.equal(q.status, 0, q.stdout + q.stderr);
    const strip = c => c.filter(a => !a.startsWith('--unit=') && !a.startsWith('--description=') && !a.includes('/run/spark-console/'));
    assert.deepEqual(strip(unitCall(t.s, `sw-run-${q.id}`)), strip(unitCall(t.s, `sw-run-${p.id}`)));
  });

  test('the proof shows a change can write where it may (27), that --home writes the top (28) and still keeps ~/.ssh shut (29); one that fails, fails the proof', () => {
    for (const [n, wall, what] of [[27, 'run', 'a write where a change may write, refused (~/.cache, /dev/shm)'],
      [28, 'home', 'with --home, a name at the top of the home or in ~/.local/bin, refused'], [29, 'home', 'a write in ~/.ssh'], [14, 'home', 'moving a folder above a held one, and making a new one in its place']]) {
      const t = spark({ knobs: { 'let-through': `${n} ${wall} direct\n` } });
      const q = prove(t);
      assert.equal(q.status, 1, `${n}: ${q.stdout}`);
      assert.ok(q.stdout.includes(`${q.id} proof ${wall} ${n} got through: ${what} (stand-in, directly)\n`), `${n}: ${q.stdout}`);
    }
    const ok = prove(spark());
    for (const n of [3, 10, 14, 19, 25, 27, 28, 29]) assert.ok(ok.stdout.includes(` proof home ${n} blocked: `), `home ${n}`);
    assert.ok(ok.stdout.includes(' proof home passed\n'));
  });

  test('the proof tries each: the network, /dev/shm and IPC, the home\'s mode, the start files, the top of the home, the devices; one that gets through fails the proof', () => {
    for (const [n, wall, how, what] of [[22, 'run', 'direct', "a connection to this Spark's own address or the tailnet"],
      [23, 'run', 'after', 'a file or segment left in /dev/shm or IPC'], [24, 'run', 'after', "the home's own mode"],
      [25, 'look', 'direct', "the owner's start files"], [26, 'run', 'direct', 'a name made at the top of the home or in a dot folder'],
      [11, 'run', 'direct', 'a disk device or the GPU']]) {
      const t = spark({ knobs: { 'let-through': `${n} ${wall} ${how}\n` } });
      const q = prove(t);
      assert.equal(q.status, 1, `${n}: ${q.stdout}`);
      assert.ok(q.stdout.includes(`${q.id} proof ${wall} ${n} got through: ${what} (stand-in, ${how === 'after' ? 'seen from outside afterwards' : 'directly'})\n`), `${n}: ${q.stdout}`);
    }
  });
});

describe("the owner's one-time command", () => {
  test('a compute Spark: its steps in order, everything staged and checked as root before it is put in place, then the proof', () => {
    const f = fleet();
    const r = f.cmd(['3']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^Spark 3 \(spark3\.test\):\n/);
    assert.ok(r.stdout.includes(`the helper to install has SHA-256 ${sha(readFileSync(HELPER_SRC))}\n`), r.stdout);
    assert.match(r.stdout, /proof look passed\n[\s\S]*proof run passed\n[\s\S]*proof passed: the mark is written/);
    assert.match(r.stdout, /done: the helper is set up and its walls are proven on /);
    // As root, in this order: the line written to a name sudo skips and checked there; the helper copied to a name
    // nothing runs and hashed there; then both moved into place; then the proof. Nothing is installed or run from a
    // file your account can write after the password.
    const copy = join(f.T, 'spark3/.cache/spark-console/spark-console-root.copy');
    const L = '/etc/sudoers.d/spark-console-root', Hl = '/usr/local/sbin/spark-console-root';
    const order = ['-v', `cat ${L}`, `sha256sum ${Hl}`, `rm -f ${L}.new ${Hl}.new`, `tee ${L}.new`, `chmod 0440 ${L}.new`,
      `visudo -cf ${L}.new`, `install -o root -g root -m 0755 ${copy} ${Hl}.new`, `sha256sum ${Hl}.new`, `mv -f ${Hl}.new ${Hl}`,
      `mv -f ${L}.new ${L}`];
    const steps = sudoCalls(f);
    assert.deepEqual(steps.slice(0, order.length), order, steps.join('\n'));
    assert.match(steps[order.length], /^-n \/usr\/local\/sbin\/spark-console-root prove --id [0-9a-f]{16}$/);
    assert.equal(readFileSync(join(f.target.R, 'etc/sudoers.d/spark-console-root'), 'utf8'), LINE_TEXT());
    assert.deepEqual(calls(f.target).find(c => c[0] === 'visudo').slice(-1), [LINE_TEXT()], 'visudo checked exactly the one line');
    assert.ok(readFileSync(join(f.target.R, 'usr/local/sbin/spark-console-root')).equals(readFileSync(HELPER_SRC)), "the helper is Spark 2's build");
    assert.ok(has(f, 'var/lib/spark-console/proved') && !has(f, 'etc/sudoers.d/spark-console-root.new') && !has(f, 'usr/local/sbin/spark-console-root.new'));
    assert.deepEqual(readdirSync(join(f.T, 'spark3/.cache/spark-console')), [], 'the copy is gone');
    // Over ssh: the helper is copied; the set-up script is never written anywhere: it runs from the command line.
    const ssh = calls(f.target).filter(c => c[0] === 'ssh').map(c => c.slice(1));
    assert.equal(ssh.length, 2);
    assert.deepEqual(ssh[0], ['-o', 'ConnectTimeout=8', 'owner@spark3.test', 'mkdir -p ~/.cache/spark-console && cat > ~/.cache/spark-console/spark-console-root.copy']);
    assert.deepEqual(ssh[1].slice(0, 4), ['-t', '-o', 'ConnectTimeout=8', 'owner@spark3.test']);
    assert.ok(ssh[1][4].startsWith("bash -c '# The set-up half of spark-console's deploy/root-for-sparkie.sh".replace("'s", "'\\''s")), ssh[1][4].slice(0, 120));
    assert.ok(ssh[1][4].endsWith(`' root-setup install ${sha(readFileSync(HELPER_SRC))} ${HUB_ID} 0`));
  });

  test('a copy swapped after it was checked is caught where only root can change it: nothing is installed, and it says why', () => {
    const f = fleet();
    writeFileSync(join(f.T, 'swap-copy'), '');
    const r = f.cmd(['3']);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /Stopped on .*: the helper's copy changed after it arrived \(its SHA-256 is no longer the one Spark 2 sent\), so nothing was installed\.\n/);
    for (const p of ['usr/local/sbin/spark-console-root', 'usr/local/sbin/spark-console-root.new', 'etc/sudoers.d/spark-console-root',
      'etc/sudoers.d/spark-console-root.new', 'var/lib/spark-console/proved']) assert.ok(!has(f, p), p);
    const steps = sudoCalls(f);
    assert.ok(steps.includes('sha256sum /usr/local/sbin/spark-console-root.new'), 'the swap was caught by the hash taken as root');
    assert.ok(!steps.some(x => x.startsWith('mv ') || x.includes(' prove ')), steps.join('\n'));
    assert.match(r.stdout, /the helper to install has SHA-256 [0-9a-f]{64}\n/, 'the first check, as you, still saw the right bytes');
  });

  test('a second run changes nothing', () => {
    const f = fleet();
    assert.equal(f.cmd(['3']).status, 0);
    const before = tree(f.target.R), n = calls(f.target).length;
    const r = f.cmd(['3']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /already set up: this build's helper, its line and a current proof\. Nothing was changed\.\n/);
    const later = calls(f.target).slice(n).filter(c => c[0] !== 'ssh');
    assert.deepEqual(later.map(c => c[0] === 'sudo' ? c.slice(0, 3).join(' ') : c[0]),
      ['sudo -v', 'sudo cat /etc/sudoers.d/spark-console-root', 'sudo sha256sum /usr/local/sbin/spark-console-root',
        'sudo /usr/local/sbin/spark-console-root check', 'systemctl', 'unshare', 'setpriv'],
      JSON.stringify(later));
    const { [join(f.target.R, 'calls.log')]: _, ...after } = tree(f.target.R);
    const { [join(f.target.R, 'calls.log')]: __, ...was } = before;
    assert.deepEqual(after, was);
  });

  test('visudo refuses the line: nothing is put in place', () => {
    const f = fleet({ target: spark({ installed: false, knobs: { 'visudo-fails': '' } }) });
    const r = f.cmd(['3']);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /Stopped on .*: visudo did not accept the sudo line, so nothing was changed\.\n/);
    assert.ok(!sudoCalls(f).some(x => x.startsWith('install ')), sudoCalls(f).join('\n'));
    assert.ok(!has(f, 'usr/local/sbin/spark-console-root') && !has(f, 'etc/sudoers.d/spark-console-root') && !has(f, 'etc/sudoers.d/spark-console-root.new'));
  });

  test('the proof fails: the line and the helper are removed again, and it says which attempt got through', () => {
    const f = fleet({ target: spark({ installed: false, knobs: { 'let-through': '3 look\n' } }) });
    const r = f.cmd(['3']);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /proof failed: attempt 3 in the look wall got through \(the Docker or Tailscale socket, api\.sock or the door's socket\)/);
    assert.match(r.stdout, /the proof failed .*, so the sudo line and the helper were removed again\. Nothing half set up is left\.\n/);
    const steps = sudoCalls(f);
    assert.deepEqual(steps.slice(-2), ['rm -f /etc/sudoers.d/spark-console-root', 'rm -f /usr/local/sbin/spark-console-root']);
    assert.ok(!has(f, 'usr/local/sbin/spark-console-root') && !has(f, 'etc/sudoers.d/spark-console-root') && !has(f, 'var/lib/spark-console/proved'));
  });

  test('--check names what bash and the owner\'s start files read in the home that is not there, and the home folders they put on the PATH (second read)', () => {
    const f = fleet();
    const home = join(f.T, 'spark3');
    writeFileSync(join(home, '.profile'), 'if [ -d "$HOME/.local/bin" ] ; then\n    PATH="$HOME/.local/bin:$PATH"\nfi\n');
    writeFileSync(join(home, '.bashrc'), '[ -f ~/.extra_env ] && . ~/.extra_env\nexport PATH="$HOME/.bun/bin:$PATH"\n');
    writeFileSync(join(home, '.inputrc'), '');
    const r = f.cmd(['--check', '3']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, / {2}read by bash or your start files, but not there \(a --home change could make them\): \.bash_completion \.local\/share\/bash-completion \.extra_env \.bun\/bin \.local\/bin\n/);
    assert.match(r.stdout, / {2}folders in your home your start files put on the PATH \(a --home change may put programs there\): ~\/\.local\/bin ~\/\.bun\/bin\n/);
  });

  test("--with-root turns root on after a passing proof (root's switch: 0600, the day and this helper's SHA-256); --without-root and --undo turn it off; a plain run leaves it as it is", () => {
    const f = fleet();
    const r = f.cmd(['--with-root', '3']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /root is on here: Sparkie may run a command as root on .*, each time inside the put-back net, after your\n {2}press\. Turn it off again with --without-root\.\n/);
    const sw = join(f.target.R, 'var/lib/spark-console/root-on');
    assert.match(readFileSync(sw, 'utf8'), new RegExp(`^on \\d{4}-\\d\\d-\\d\\d helper ${sha(readFileSync(HELPER_SRC))}\\n$`));
    assert.equal(statSync(sw).mode & 0o777, 0o600);
    const steps = sudoCalls(f);
    const proved = steps.findIndex(x => / prove --id /.test(x)), on = steps.indexOf('tee /var/lib/spark-console/root-on.new');
    assert.ok(proved >= 0 && on > proved, `the switch only after the proof: ${steps.join(' | ')}`);
    assert.deepEqual(steps.slice(on, on + 3), ['tee /var/lib/spark-console/root-on.new', 'chmod 0600 /var/lib/spark-console/root-on.new',
      'mv -f /var/lib/spark-console/root-on.new /var/lib/spark-console/root-on']);
    assert.match(f.cmd(['--check', '3']).stdout, / {4}root ready: only inside the net \(--net\), 30 minutes at most, 10 in the lock-out class\n$/);
    assert.equal(f.cmd(['3']).status, 0);
    assert.ok(has(f, 'var/lib/spark-console/root-on'), 'a plain run leaves the switch as it is');
    const w = f.cmd(['--without-root', '3']);
    assert.equal(w.status, 0, w.stdout + w.stderr);
    assert.match(w.stdout, /root is off here: the helper refuses every root command on /);
    assert.ok(!has(f, 'var/lib/spark-console/root-on') && has(f, 'usr/local/sbin/spark-console-root'), 'only the switch went');
    assert.match(f.cmd(['--check', '3']).stdout, / {4}root off: the owner turns it on with the one command \(--with-root\)\n$/);
    assert.equal(f.cmd(['--with-root', '3']).status, 0);
    assert.equal(f.cmd(['--undo', '3']).status, 0);
    assert.ok(!has(f, 'var/lib/spark-console/root-on'));
    // After --undo root answers as before set-up: sudo asks for a password, which the console answers with the owner's
    // one command (work.test.mjs), and nothing runs.
    const u = spawnSync('sudo', ['-n', '/usr/local/sbin/spark-console-root', 'root', '--id', 'afterundo01', '--sha256', sha('true'), '--seconds', '5', '--dir', '/',
      '--net', '--', 'true'], { env: f.env, encoding: 'utf8', timeout: 60000 });
    assert.equal(u.status, 1, u.stdout + u.stderr);
    assert.match(u.stderr, /a password is required/);
    assert.ok(!calls(f.target).some(c => c[0] === 'systemd-run' && c.some(a => a.startsWith('--unit=sw-root-'))));
  });

  test('--with-root with a proof that fails leaves root off', () => {
    const f = fleet({ target: spark({ installed: false, knobs: { 'let-through': '3 look\n' } }) });
    const r = f.cmd(['--with-root', '3']);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.ok(!has(f, 'var/lib/spark-console/root-on') && !sudoCalls(f).some(x => x.startsWith('tee /var/lib/spark-console/root-on')), sudoCalls(f).join('\n'));
  });

  test("--undo: root's switch, then the line, then the helper, then the mark", () => {
    const f = fleet();
    assert.equal(f.cmd(['3']).status, 0);
    const n = sudoCalls(f).length;
    const r = f.cmd(['--undo', '3']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(sudoCalls(f).slice(n), ['-v', 'rm -f /var/lib/spark-console/root-on /var/lib/spark-console/root-on.new',
      'rm -f /etc/sudoers.d/spark-console-root /etc/sudoers.d/spark-console-root.new',
      'rm -f /usr/local/sbin/spark-console-root /usr/local/sbin/spark-console-root.new', 'rm -f /var/lib/spark-console/proved']);
    assert.ok(!has(f, 'usr/local/sbin/spark-console-root') && !has(f, 'etc/sudoers.d/spark-console-root') && !has(f, 'var/lib/spark-console/proved')
      && !has(f, 'var/lib/spark-console/root-on'));
  });

  test('--check changes nothing and asks no password, before and after set-up; every call is a read', () => {
    const f = fleet();
    const look = () => [tree(f.target.R), tree(join(f.T, 'spark3'))];
    const READS = c => (c[0] === 'ssh' && c.at(-1).startsWith('bash -s -- check '))
      || (c[0] === 'sudo' && c[1] === '-n' && c[2] === '/usr/local/sbin/spark-console-root' && c[3] === 'check')
      || (c[0] === 'systemctl' && c[1] === 'show') || (['unshare', 'setpriv'].includes(c[0]) && c[1] === '--help');
    for (const stage of ['before', 'after']) {
      if (stage === 'after') assert.equal(f.cmd(['3']).status, 0);
      const was = look(), n = calls(f.target).length;
      const r = f.cmd(['--check', '3']);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const made = calls(f.target).slice(n);
      assert.deepEqual(made.filter(c => !READS(c)), [], JSON.stringify(made));
      const [a, b] = look();
      delete a[join(f.target.R, 'calls.log')];
      delete was[0][join(f.target.R, 'calls.log')];
      assert.deepEqual([a, b], was, 'no file changed');
      if (stage === 'before') {
        assert.match(r.stdout, /checking: nothing is changed and no password is asked\n/);
        assert.match(r.stdout, /systemd 255\.4-1ubuntu8\.4 \(needs 248 or newer\): ok\n/);
        assert.match(r.stdout, /unshare knows --kill-child and --mount-proc: ok\n {2}setpriv knows --groups and --bounding-set: ok\n/);
        assert.match(r.stdout, /the helper \(\/usr\/local\/sbin\/spark-console-root\): not there\n/);
        assert.match(r.stdout, /look wall: not set up\n {2}run wall: not set up\n {2}root \(inside the net\): not set up\n$/);
      } else {
        assert.match(r.stdout, /the helper \(\/usr\/local\/sbin\/spark-console-root\): there, this build's\n/);
        assert.match(r.stdout, /its sudo line .*: works/);
        assert.match(r.stdout, / {4}proof current\n {4}look ready\n {4}run ready\n {4}root off: the owner turns it on with the one command \(--with-root\)\n$/);
      }
    }
  });

  test('a proof stopped half way (Ctrl-C): --check says plainly the helper is set up but unproven, and --undo removes it', () => {
    const f = fleet();
    assert.equal(f.cmd(['3']).status, 0);
    rmSync(join(f.target.R, 'var/lib/spark-console/proved'));   // as after an interrupted proof: the line and the helper, no mark
    const c = f.cmd(['--check', '3']);
    assert.equal(c.status, 0, c.stdout + c.stderr);
    assert.match(c.stdout, / {2}set up, but its walls are not proven \(a proof was stopped, failed, or is out of date\): look and run refuse here\n {2}until a proof passes\. Run this command again without --check to prove them, or --undo to remove the line and the helper\.\n/);
    assert.match(c.stdout, / {4}proof none\n {4}look refuses: the wall proof is none on this Spark\n/);
    const u = f.cmd(['--undo', '3']);
    assert.equal(u.status, 0, u.stdout + u.stderr);
    for (const p of ['usr/local/sbin/spark-console-root', 'etc/sudoers.d/spark-console-root', 'var/lib/spark-console/proved']) assert.ok(!has(f, p), p);
    assert.match(f.cmd(['--check', '3']).stdout, /the helper \(\/usr\/local\/sbin\/spark-console-root\): not there\n/);
  });

  test('the names the run wall must hold are made before the password, as you; .bash_profile is one line; a second run makes nothing', () => {
    const f = fleet(), home = join(f.T, 'spark3');
    writeFileSync(join(home, '.bashrc'), '# mine\n');
    const r = f.cmd(['3']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const made = ['.profile', '.bash_profile', '.bash_logout', '.bash_aliases', '.pam_environment', '.ssh', '.docker',
      '.config/systemd', '.config/environment.d', '.config/autostart', '.config/user-tmpfiles.d', '.local/share/systemd',
      '.local/share/user-tmpfiles.d', '.local/share/spark-console', '.local/share/spark-portal/workspaces/shared',
      '.local/share/spark-portal/workspaces/shared/jobs'];   // (.cache/spark-console is there already: the helper's copy came in it)
    assert.ok(existsSync(join(home, '.cache/spark-console')));
    const said = r.stdout.split('\n'), password = said.findIndex(l => l.includes('sudo asks for your password'));
    for (const n of made) {
      assert.ok(existsSync(join(home, n)), n);
      const at = said.indexOf(`  made ${n} (it was not there, and the run wall holds it)`);
      assert.ok(at >= 0 && at < password, `${n} is made, and said, before the password`);
    }
    assert.ok(!r.stdout.includes('made .bashrc'), 'what was there is left alone');
    assert.equal(readFileSync(join(home, '.bashrc'), 'utf8'), '# mine\n');
    assert.equal(readFileSync(join(home, '.bash_profile'), 'utf8'), '. "$HOME/.profile"\n');
    assert.equal(statSync(join(home, '.ssh')).mode & 0o777, 0o700);
    assert.ok(!sudoCalls(f).some(x => /mkdir|touch|\.bash_profile/.test(x)), 'none through sudo');
    const was = tree(home);
    const again = f.cmd(['3']);
    assert.equal(again.status, 0, again.stdout + again.stderr);
    assert.ok(!again.stdout.includes('  made '), again.stdout);
    assert.deepEqual(tree(home), was, 'a second run makes nothing');
  });

  test('a .bash_login of yours: the .bash_profile made reads it, as bash would have', () => {
    const f = fleet(), home = join(f.T, 'spark3');
    writeFileSync(join(home, '.bash_login'), '');
    assert.equal(f.cmd(['3']).status, 0);
    assert.equal(readFileSync(join(home, '.bash_profile'), 'utf8'), '. "$HOME/.bash_login"\n');
  });

  test('--check names what is missing, what is a link, PAM, units that run a program from the home, and Tailscale SSH; it changes nothing', () => {
    const f = fleet(), home = join(f.T, 'spark3');
    mkdirSync(join(home, 'real-systemd'));
    mkdirSync(join(home, '.config'));
    symlinkSync(join(home, 'real-systemd'), join(home, '.config/systemd'));
    mkdirSync(join(home, 'real-systemd/user/default.target.wants'), { recursive: true });
    for (const u of ['editor.service', 'kept.service']) symlinkSync('/dev/null', join(home, 'real-systemd/user/default.target.wants', u));
    f.target.put('standin/user-units', `editor.service ${home}/tools/editor\nkept.service ${home}/.local/opt/kept/bin/kept\n`);
    writeFileSync(join(f.T, 'bin/tailscale'), `#!/bin/bash\n[ "$1 $2" = "debug prefs" ] && echo '{"RunSSH": '$(cat "$TEST_T/runssh" 2>/dev/null || echo false)'}'\n`, { mode: 0o755 });
    const was = tree(home), wasR = tree(f.target.R);
    const r = f.cmd(['--check', '3']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /not there, made when you set up \(a change could make them\): \.bashrc \.profile \.bash_profile \.bash_logout \.bash_aliases \.pam_environment \.ssh \.docker \.config\/environment\.d/);
    assert.match(r.stdout, / {2}links, which the run wall refuses until each is the real file or folder: \.config\/systemd\n/);
    assert.match(r.stdout, / {2}PAM reads ~\/\.pam_environment: (yes \(.*\); the run wall holds it read-only|no)\n/);
    assert.match(r.stdout, / {2}enabled units of yours that run a program a change could rewrite: editor\.service \(.*\/tools\/editor\)\n/);
    assert.ok(!r.stdout.includes('kept.service'), 'a program on the read-only list is fine');
    assert.match(r.stdout, / {2}Tailscale SSH: off\n/);
    assert.match(r.stdout, / {2}your login shell: \S+/);
    symlinkSync('.profile', join(home, '.zshrc'));
    assert.match(f.cmd(['--check', '3']).stdout, / {2}links at other listed names, which both walls leave alone \(not held, and never followed\): \.zshrc\n/);
    rmSync(join(home, '.zshrc'));
    writeFileSync(join(f.T, 'runssh'), 'true');
    assert.match(f.cmd(['--check', '3']).stdout, / {2}Tailscale SSH: on\. Any program on your tailnet signed in as you can open a shell here with no key, outside every\n {2}wall/);
    const { [join(f.target.R, 'calls.log')]: _, ...nowR } = tree(f.target.R);
    const { [join(f.target.R, 'calls.log')]: __, ...beforeR } = wasR;
    assert.deepEqual([tree(home), nowR], [was, beforeR], 'nothing changed');
  });

  test('Spark 2 only with --hub, and --hub only for Spark 2: by its number here, by its machine id there', () => {
    const f = fleet();
    for (const [args, why] of [[['2'], /Stopped: Spark 2 runs Spark Console: it is the hub, set up last, after a compute Spark, and only with --hub: bash ~\/spark-console-src\/deploy\/root-for-sparkie\.sh --hub 2\n/],
      [['--check', '2'], /Stopped: Spark 2 runs Spark Console: it is the hub, .* --check --hub 2\n/], [['--hub', '3'], /Stopped: --hub is only for Spark 2 itself; Spark 3 is a compute Spark/],
      [['7'], /Stopped: Spark 7 is not on Spark Console's list/]]) {
      const r = f.cmd(args);
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, why);
    }
    assert.deepEqual(calls(f.target), [], 'nothing was asked of anything');
    // A compute Spark that turns out to be Spark 2 (the same machine id) refuses on the far side.
    writeFileSync(join(f.T, 'spark3.id'), HUB_ID);
    const r = f.cmd(['3']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Stopped on .*: this is Spark 2, the hub: it is set up last, and only with --hub\./);
    assert.deepEqual(sudoCalls(f), []);
    assert.ok(!existsSync(join(f.T, 'spark3/.cache/spark-console/spark-console-root.copy')), 'the copy is gone');
    // With --hub it runs on Spark 2 itself, no ssh.
    const hub = fleet({ target: spark({ installed: false }) });
    const h = hub.cmd(['--hub', '2']);
    assert.equal(h.status, 0, h.stdout + h.stderr);
    assert.match(h.stdout, /^Spark 2 \(this Spark, the hub\):\n/);
    assert.equal(calls(hub.target).filter(c => c[0] === 'ssh').length, 0);
    assert.ok(has(hub, 'usr/local/sbin/spark-console-root') && has(hub, 'var/lib/spark-console/proved'));
  });

  test("from the Mac it runs Spark 2's installed copy over ssh, which reaches the Spark", () => {
    const f = fleet();
    const r = f.cmd(['--check', '3'], { home: join(f.T, 'mac'), file: SETUP_SRC, extra: { SPARK2: 'owner@spark2.test' } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^Running Spark 2's installed copy \(owner@spark2\.test\), so what goes on the Spark is the installed build's\.\nSpark 3 \(spark3\.test\):\n/);
    const ssh = calls(f.target).filter(c => c[0] === 'ssh').map(c => c.slice(1));
    assert.deepEqual(ssh[0], ['-t', 'owner@spark2.test', 'bash ~/spark-console-src/deploy/root-for-sparkie.sh --check 3']);
    assert.match(ssh[1].at(-1), /^bash -s -- check [0-9a-f]{64} 2{32} 0$/);
    for (const bad of [['3', '4'], ['--check', '--undo', '3'], ['three'], []]) assert.equal(f.cmd(bad, { home: join(f.T, 'mac'), file: SETUP_SRC }).status, 2);
  });
});

// --- the proof's attempts, with no wall at all ----------------------------------------------------------------------
// The real proof.py, as the helper writes it, run here as this user with nothing stopping it. With its own program and
// files in place, each attempt must see what it is after, outside and "inside" alike (there is no wall here); with its
// program missing, every attempt must fail rather than say "blocked". (On a Spark, inside a wall, a working attempt
// must not get through: that is the proof.) Lines are matched by their start: on a machine with a network, a Docker
// socket or Tailscale (GitHub's runner, say), more is reached and the lines are longer.
const HANDLE_PROBE = `import ctypes, sys
class H(ctypes.Structure): _fields_ = [('b', ctypes.c_uint), ('t', ctypes.c_int), ('f', ctypes.c_ubyte * 128)]
h, m = H(), ctypes.c_int(); h.b = 128; open(sys.argv[1], 'w').close()
sys.exit(0 if ctypes.CDLL(None).name_to_handle_at(-100, sys.argv[1].encode(), ctypes.byref(h), ctypes.byref(m), 0) == 0 else 1)`;
// A folder where the kernel gives file handles (the proof needs one for its key): the temporary folder, or else a
// hidden folder in test/ (a container's own disk may give none). Null when neither does.
function handleFolder() {
  for (const [base, prefix] of [[tmpdir(), 'proof-'], [join(REPO, 'test'), '.proof-scratch-']]) {
    const T = realpathSync(mkdtempSync(join(base, prefix)));
    temps.push(T);
    if (spawnSync('python3', ['-I', '-S', '-c', HANDLE_PROBE, join(T, 'probe')]).status === 0) return T;
  }
  return null;
}
function realProof(id) {
  const T = handleFolder();
  if (!T) return null;
  const text = readFileSync(HELPER_SRC, 'utf8').split("cat <<'PROOF'\n")[1].split('\nPROOF\n')[0];
  const held = join(T, id), home = join(T, 'home');
  mkdirSync(held);
  mkdirSync(join(home, '.local/state/spark-console'), { recursive: true });
  writeFileSync(join(home, '.bashrc'), '');
  writeFileSync(join(held, 'proof.py'), text);
  writeFileSync(join(held, 'owner'), `${process.getuid()}\n${process.getgid()}\n${home}\n`);
  writeFileSync(join(held, 'target'), '0');
  writeFileSync(join(held, 'readonly'), `${home}/.bashrc\n`);
  const stay = join(T, 'disk', `.spark-console-proof-${id}`);
  mkdirSync(stay, { recursive: true, mode: 0o1777 });
  writeFileSync(join(held, 'stay'), stay);
  const py = (...a) => spawnSync('python3', ['-I', '-S', join(held, 'proof.py'), ...a.map(String)], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8', timeout: 120000 });
  return { held, home, stay, py, H: join(home, `.local/share/spark-console/proof-${id}`) };
}
const lines = r => r.stdout.split('\n').filter(Boolean);
// Attempt 2 always tries the loopback first; attempt 3 lists the Docker and Tailscale sockets before api.sock, and the
// door's socket after it.
const MATCH = {
  loopback: what => new RegExp(`^P 2 ${what} the loopback(, |$)`),
  apiSock: /^P 3 direct through (.*, )?api\.sock by its path, api\.sock by a second path(, |$)/,
};

describe("the proof's own attempts", () => {
  test('with no wall, each attempt is seen working outside and gets through inside: a link, a connection, a socket, an environment, /proc, a signal, a key, a write that stays, something left behind', async t => {
    const P = realProof('proofrunhere1');
    if (!P) return t.skip('no folder here gives file handles, which the proof needs for its key');
    assert.deepEqual(lines(P.py('prep')), ['S ok']);
    const target = spawn('python3', ['-I', '-S', join(P.held, 'proof.py'), 'target'], { env: { PATH: '/usr/bin:/bin', SPARK_PROOF_MARK: 'proofrunhere1' }, cwd: P.H, stdio: 'ignore' });
    const server = net.createServer(c => c.end());
    await new Promise(ok => server.listen(join(P.home, '.local/state/spark-console/api.sock'), ok));
    try {
      writeFileSync(join(P.held, 'target'), String(target.pid));
      // The controls: every attempt the helper requires works outside; the rest work, or are absent for a stated reason.
      const outside = lines(P.py('outside', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11));
      for (const n of [1, 3, 4, 5, 6, 7, 10]) assert.ok(outside.some(l => l.startsWith(`P ${n} outside works `)), `outside ${n}: ${outside.join('\n')}`);
      assert.ok(outside.some(l => MATCH.loopback('outside works').test(l)), outside.join('\n'));
      for (const n of [8, 9, 11]) assert.ok(outside.some(l => new RegExp(`^P ${n} outside (works|not-there) \\S`).test(l)), `outside ${n}: ${outside.join('\n')}`);
      assert.equal(outside.length, 11);
      const inside = lines(P.py('look', 1, 2, 3, 4, 6, 10));
      for (const n of [1, 2, 3, 4, 6, 10]) for (const how of ['direct', 'child']) {
        assert.ok(inside.some(l => l.startsWith(`P ${n} ${how} through `)), `look ${n} ${how}: ${inside.join('\n')}`);
      }
      assert.ok(inside.some(l => MATCH.loopback('direct through').test(l)), inside.join('\n'));
      assert.ok(inside.some(l => MATCH.apiSock.test(l)), inside.join('\n'));
      assert.ok(inside.some(l => /^P 10 direct through by its path, through a link, by \*/.test(l)), inside.join('\n'));
      const five = lines(P.py('look', 5, 12));
      assert.ok(five.some(l => l.startsWith('P 5 direct left ')) && five.some(l => l.startsWith('P 12 child left ')), five.join('\n'));
      assert.ok(lines(P.py('run', 5)).some(l => l.startsWith('P 5 direct through ')));
      const after = lines(P.py('after'));
      assert.ok(after.some(l => l.startsWith('V 5 outside works ')) && after.some(l => l.startsWith('V 12 outside works ')), after.join('\n'));
      assert.ok(after.some(l => l.startsWith('V 5 look through ')), after.join('\n'));
      assert.ok(after.includes('V 12 look through 2 still running'), after.join('\n'));
      assert.ok(lines(P.py('look', 7)).some(l => l.startsWith('P 7 direct through ')), 'a signal reached the program outside');
      const post = lines(P.py('post'));
      assert.ok(post.some(l => l.startsWith('V 1 look through ')) && post.some(l => l.startsWith('V 5 run through ')), post.join('\n'));
      assert.ok(!existsSync(P.H) && !existsSync(join(P.home, '.cache/spark-console/proof-proofrunhere1')), 'the proof cleans up after itself');
    } finally {
      target.kill('SIGKILL');
      server.close();
    }
  });

  test('with no wall, attempt 14 is seen working outside and gets through: the folder above the read-only one is moved and a new one made', async t => {
    const P = realProof('proofrunhere14');
    if (!P) return t.skip('no folder here gives file handles, which the proof needs for its key');
    assert.deepEqual(lines(P.py('prep')), ['S ok']);
    const target = spawn('python3', ['-I', '-S', join(P.held, 'proof.py'), 'target'], { env: { PATH: '/usr/bin:/bin', SPARK_PROOF_MARK: 'proofrunhere14' }, cwd: P.H, stdio: 'ignore' });
    try {
      writeFileSync(join(P.held, 'target'), String(target.pid));
      assert.ok(lines(P.py('outside', 14)).some(l => l.startsWith('P 14 outside works ')));
      const inside = lines(P.py('run', 14));
      assert.ok(inside.some(l => l.startsWith('P 14 direct through ')), inside.join('\n'));
      const post = lines(P.py('post'));
      assert.ok(post.some(l => l.startsWith('V 14 run through ')) && post.some(l => l.startsWith('V 1 run through ')), post.join('\n'));
      assert.ok(!existsSync(join(P.home, '.sparkie-proof-proofrunhere14')), 'the proof cleans up after itself');
    } finally {
      target.kill('SIGKILL');
    }
  });

  test("with its program outside the walls missing, no attempt says 'blocked', and the helper fails the proof on those lines", t => {
    const P = realProof('brokenstart1');
    if (!P) return t.skip('no folder here gives file handles, which the proof needs for its key');
    assert.deepEqual(lines(P.py('prep')), ['S ok']);
    // No program outside: 'target' stays 0 and there is no port. The reviewer's case: run 2 4 6 7.
    const run4 = lines(P.py('run', 2, 4, 6, 7));
    assert.equal(run4.length, 8);
    for (const l of run4) assert.match(l, /^P (2|4|6|7) (direct|child) failed /);
    const outside = P.py('outside', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11), look = P.py('look', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12);
    const run = P.py('run', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12);
    for (const r of [look, run]) assert.ok(!/ blocked /.test(r.stdout), r.stdout);
    assert.ok(lines(outside).every(l => / outside not-there /.test(l)), outside.stdout);
    P.py('post');
    // The helper, given exactly those lines for its outside, look and run units.
    const s = spark();
    s.put('standin/play-outside', outside.stdout);
    s.put('standin/play-look', look.stdout);
    s.put('standin/play-run', run.stdout);
    const p = prove(s);
    assert.equal(p.status, 1, p.stdout);
    assert.match(p.stdout, /proof failed: attempt 1 \(a write through a link\) could not be shown working outside the walls, so stopping it inside would show nothing\. No mark was written/);
    assert.ok(p.stdout.includes(`${p.id} proof look 1 was not reported: a write through a link\n`), p.stdout);
    assert.ok(!existsSync(join(s.R, 'var/lib/spark-console/proved')));
  });
});


// Root (R70; design A 2.13, step 12): a command as root, only inside the net armed in the same call, and only while root's
// switch is on (the owner's one-time command with --with-root). The stand-in runs it as the test's own account.
describe('root inside the net (R70)', () => {
  const HELPER_AT = s => join(s.R, 'usr/local/sbin/spark-console-root');
  const SWITCH = s => join(s.R, 'var/lib/spark-console/root-on');
  const G = (s, id) => join(s.R, 'var/lib/spark-console/guard', id);
  const rootOn = (s, line = `on 2026-11-15 helper ${sha(readFileSync(HELPER_AT(s)))}\n`) => {
    mkdirSync(dirname(SWITCH(s)), { recursive: true });
    chmodSync(dirname(SWITCH(s)), 0o755);
    writeFileSync(SWITCH(s), line, { mode: 0o600 });
    chmodSync(SWITCH(s), 0o600);
  };
  const rooted = () => { const s = proven(); s.put('etc/ssh/sshd_config', 'Port 22\n', 0o640); rootOn(s); return s; };
  const rootRun = (s, cmd, { id = newId(), hash = sha(cmd), secs = 60, extra = ['--net'], input } = {}) =>
    ({ ...run(s, ['root', '--id', id, '--sha256', hash, '--seconds', String(secs), '--dir', s.work, ...extra, '--', cmd], { input }), id });
  const OFF = 'root is off on this Spark: ';
  const ASK = 'the owner turns it on with the one command (--with-root)';
  const SSH_CHANGE = 'printf "Port 2222\\n" > "$SPARK_CONSOLE_REHEARSAL/etc/ssh/sshd_config"';
  const checkLine = s => { const id = newId(); return run(s, ['check', '--id', id]).stdout.split('\n').find(l => l.startsWith(`${id} root `)).slice(id.length + 1); };

  test("root's switch counts only as the one-time command writes it, and the refusal and check say why not", () => {
    const s = proven();
    const why = w => `${OFF}${w}, so its switch does not count: ${ASK}`;
    assert.equal(checkLine(s), `root off: ${ASK}`);
    const cases = [
      ['a link', t => { rootOn(t); renameSync(SWITCH(t), `${SWITCH(t)}.real`); symlinkSync(`${SWITCH(t)}.real`, SWITCH(t)); }, 'its switch, or the folder it is in, is a link'],
      ['a folder', t => mkdirSync(SWITCH(t), { recursive: true }), 'its switch is not a plain file'],
      ['a wider mode', t => { rootOn(t); chmodSync(SWITCH(t), 0o644); }, 'its switch has mode 644, not 600 (root alone)'],
      ['a folder others may change', t => { rootOn(t); chmodSync(dirname(SWITCH(t)), 0o775); }, 'the folder of its switch can be changed by another account than root'],
      ['a second line', t => rootOn(t, `on 2026-11-15 helper ${sha(readFileSync(HELPER_AT(t)))}\nand more\n`), 'its switch is not the one line the one-time command writes'],
      ['no line break', t => rootOn(t, `on 2026-11-15 helper ${sha(readFileSync(HELPER_AT(t)))}`), 'its switch is not the one line the one-time command writes'],
      ['another helper\'s hash', t => rootOn(t, `on 2026-11-15 helper ${'a'.repeat(64)}\n`), 'this helper is newer than the one root was turned on for'],
    ];
    for (const [name, make, words] of cases) {
      const t = proven();
      make(t);
      const before = calls(t).length;
      const r = rootRun(t, SSH_CHANGE);
      refused(r, why(words));
      assert.equal(calls(t).length, before, `${name}: nothing was asked of systemd`);
      assert.ok(!existsSync(G(t, r.id)), `${name}: no net was armed`);
      assert.equal(checkLine(t), words.startsWith('this helper is newer') ? `root off: ${words}` : `root off: ${why(words).slice(OFF.length)}`, name);
    }
    // (an account other than root owning the switch is refused the same way: the stand-in Spark has no second account)
    rootOn(s);
    assert.equal(checkLine(s), 'root ready: only inside the net (--net), 30 minutes at most, 10 in the lock-out class');
    // Read before anything else of the call: an option the helper does not know is not even looked at.
    const t = proven();
    refused({ ...run(t, ['root', '--id', 'offbefore01', '--made-up']), id: 'offbefore01' }, `${OFF}${ASK}`);
  });

  test('with the switch on and no --net, root is refused: it runs only inside the net armed in the same call', () => {
    const s = rooted();
    const before = calls(s).length;
    const r = rootRun(s, SSH_CHANGE, { extra: [] });
    refused(r, 'root runs only inside the net, armed in this same call: --net is missing');
    assert.equal(calls(s).length, before, 'nothing was asked of systemd');
    assert.ok(!existsSync(G(s, r.id)));
    assert.equal(readFileSync(join(s.R, 'etc/ssh/sshd_config'), 'utf8'), 'Port 22\n');
  });

  test('inside the net: the net is armed first, then sw-root-<id> runs the held bytes as root, said "as root"; the net\'s own line follows', () => {
    const s = rooted();
    const before = calls(s).length;
    const r = rootRun(s, SSH_CHANGE, { secs: 120 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`^${r.id} net armed: the ways in go back at \\S+ unless they are kept\\n${r.id} as root: sw-root-${r.id} runs the command `
      + `whose SHA-256 is ${sha(SSH_CHANGE)}, inside the net\\n\\n${r.id} net open: 1 of the ways in differs \\(/etc/ssh\\) and goes back at \\S+ unless it is kept\\n${r.id} end 0\\n$`), r.stdout);
    const asked = calls(s).slice(before).filter(c => c[0] === 'systemd-run').map(c => c.find(a => a.startsWith('--unit=')));
    assert.deepEqual(asked, [`--unit=sw-guard-${r.id}`, `--unit=sw-root-${r.id}`], 'the timer first');
    assert.ok(unitCall(s, `sw-guard-${r.id}`).includes('--on-active=720s'), 'its time limit plus 600 s');
    assert.deepEqual(unitCall(s, `sw-root-${r.id}`), ['systemd-run', `--unit=sw-root-${r.id}`, `--description=Spark Console root ${r.id} sha256 ${sha(SSH_CHANGE)}`,
      '--wait', '--pipe', '--collect', '--quiet', '-p', 'ReadOnlyPaths=/usr/local/sbin/spark-console-root', '-p', 'ReadOnlyPaths=-/etc/sudoers.d/spark-console-root',
      '-p', 'InaccessiblePaths=-/var/lib/spark-console', '-p', 'ReadOnlyPaths=/run/spark-console', '-p', 'RuntimeMaxSec=120', '-p', 'TimeoutStopSec=5',
      '-p', 'MemoryMax=8G', '-p', 'MemorySwapMax=0', '-p', 'TasksMax=4096', '--', which(s, 'bash'), '--noprofile', '--norc', `/run/spark-console/${r.id}/start`]);
    const ran = join(s.R, 'standin/ran', `sw-root-${r.id}`);
    assert.deepEqual(['command', 'home', 'user'].map(f => readFileSync(join(ran, f), 'utf8')), [SSH_CHANGE, '/root', 'root']);
    assert.equal(readFileSync(join(G(s, r.id), 'unit'), 'utf8'), `sw-root-${r.id}.service`);
    assert.equal(run(s, ['state', '--id', r.id]).stdout, `${r.id} state ended: it ran and has ended\n`);
  });

  test('held to 30 minutes, 10 in the lock-out class; the run wall\'s choices are not root\'s, nor root\'s choices another verb\'s', () => {
    const s = rooted();
    const before = calls(s).length;
    refused(rootRun(s, 'true', { secs: 1801 }), 'a root command is held to 30 minutes');
    refused(rootRun(s, 'true', { secs: 601, extra: ['--net', '--lockout'] }), 'a root command in the lock-out class is held to 10 minutes');
    for (const x of [['--open'], ['--home'], ['--fleet'], ['--gpu'], ['--memory', '2G'], ['--protect', '/srv']]) {
      refused(rootRun(s, 'true', { extra: ['--net', ...x] }), 'root takes no --open, --home, --fleet, --gpu, --memory or --protect: those bound the run wall, and root has no wall');
    }
    for (const x of [['--lockout'], ['--path', '/etc/hosts'], ['--unit', 'nginx.service']]) refused(change(s, 'true', { extra: x }), '--path, --unit and --lockout are for root');
    refused(rootRun(s, 'true', { extra: ['--net', ...Array(33).fill(['--path', '/etc/hosts']).flat()] }), 'at most 32 --path');
    refused(rootRun(s, 'true', { extra: ['--net', ...Array(17).fill(['--unit', 'nginx.service']).flat()] }), 'at most 16 --unit');
    refused(rootRun(s, 'true', { extra: ['--net', '--path', '/etc/a file'] }), '--path must name a whole path that can stand in a setting');
    for (const u of ['nginx', 'a b.service', '../x.service', 'x.service;y']) refused(rootRun(s, 'true', { extra: ['--net', '--unit', u] }), '--unit must name a unit: a name, then .service, .socket, .timer, .target, .mount or .path');
    refused(rootRun(s, 'true', { extra: ['--net', '--unit', 'sw-guard-x.timer'] }), "--unit never names one of this helper's own units (sw-)");
    assert.ok(!calls(s).slice(before).some(c => c[0] === 'systemd-run'), 'nothing ran, nothing was armed');
    const r = rootRun(s, 'true', { secs: 600, extra: ['--net', '--lockout'] });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(unitCall(s, `sw-guard-${r.id}`).includes('--on-active=1200s'));
    assert.ok(unitCall(s, `sw-root-${r.id}`).includes('RuntimeMaxSec=600'));
  });

  test('--path and --unit join the copy set before anything runs, and go back with the ways in: the file, the unit, its reload', () => {
    const s = rooted();
    s.put('opt/app/app.conf', 'old\n', 0o644);
    s.put('standin/units/nginx.service', 'active enabled\n');
    const cmd = 'printf "new\\n" > "$SPARK_CONSOLE_REHEARSAL/opt/app/app.conf"; systemctl stop nginx.service';
    const r = rootRun(s, cmd, { extra: ['--net', '--path', '/opt/app/app.conf', '--unit', 'nginx.service'] });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /net open: 2 of the ways in differ \(\/opt\/app\/app\.conf nginx\.service\)/, r.stdout);
    assert.ok(readFileSync(join(G(s, r.id), 'paths'), 'utf8').split('\0').includes('/opt/app/app.conf'));
    assert.equal(readFileSync(join(G(s, r.id), 'units'), 'utf8'), 'nginx.service\n');
    const before = calls(s).length;
    const f = spawnSync('bash', [join(G(s, r.id), 'restore.sh'), 'timer'], { env: s.env, encoding: 'utf8', timeout: 120000 });
    assert.equal(f.status, 0, f.stdout + f.stderr);
    assert.equal(readFileSync(join(s.R, 'opt/app/app.conf'), 'utf8'), 'old\n');
    assert.equal(readFileSync(join(s.R, 'standin/units/nginx.service'), 'utf8').trim(), 'active enabled');
    const asked = calls(s).slice(before).filter(c => c[0] === 'systemctl' && c[1] !== 'show').map(c => c.slice(1).join(' '));
    assert.ok(asked[0] === `stop -- sw-root-${r.id}.service`, `the root command's unit is stopped before anything goes back: ${asked.join(' | ')}`);
    for (const c of ['try-reload-or-restart nginx.service', 'start nginx.service']) assert.ok(asked.includes(c), asked.join(' | '));
  });

  test('a script as root: its bytes come on input, are read once and must have the SHA-256 the call names', () => {
    const s = rooted();
    const script = '#!/bin/bash\necho "from the script"\n';
    const id = newId();
    const r = { ...run(s, ['root', '--id', id, '--sha256', sha(script), '--seconds', '60', '--dir', s.work, '--net', '--stdin'], { input: script }), id };
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /\nfrom the script\n/);
    assert.equal(readFileSync(join(s.R, 'standin/ran', `sw-root-${id}`, 'command'), 'utf8'), script);
    const t = rooted();
    const n = calls(t).length;
    const bad = newId();
    refused({ ...run(t, ['root', '--id', bad, '--sha256', sha(script), '--seconds', '60', '--dir', t.work, '--net', '--stdin'], { input: script.replace('from', 'From') }), id: bad },
      "the command's bytes do not have the SHA-256 it was given, so nothing ran");
    const two = newId();
    refused({ ...run(t, ['root', '--id', two, '--sha256', sha(script), '--seconds', '60', '--dir', t.work, '--net', '--stdin', '--', 'true'], { input: script }), id: two },
      'with --stdin the command is what comes on input: nothing after --');
    const none = newId();
    refused({ ...run(t, ['root', '--id', none, '--sha256', sha(''), '--seconds', '60', '--dir', t.work, '--net', '--stdin'], { input: '' }), id: none }, 'the command is empty');
    assert.ok(!calls(t).slice(n).some(c => c[0] === 'systemd-run'), 'nothing ran, nothing was armed');
  });

  test('the guard on names: a root command that names the helper, its line, sudo\'s settings, PAM, the helper\'s folders or the net\'s timer, by word or through a link, runs nothing', () => {
    const s = rooted();
    const before = calls(s).length;
    mkdirSync(join(s.R, 'tmp'), { recursive: true });
    mkdirSync(join(s.R, 'etc/sudoers.d'), { recursive: true });
    symlinkSync(join(s.R, 'etc/sudoers.d'), join(s.R, 'tmp/s'));
    const said = (cmd, names, extra = ['--net']) => {
      const r = rootRun(s, cmd, { extra });
      refused(r, `a root command never names the helper, its sudo line, sudo's settings, PAM, the helper's folders or the net's timer (it names ${names}): those change only by the owner's one-time command, deploy/root-for-sparkie.sh`);
      assert.ok(!existsSync(G(s, r.id)), `${cmd}: no net was armed`);
    };
    said('cp x /usr/local/sbin/spark-console-root', 'spark-console-root');
    said('cat /etc/sudoers', 'sudoers');
    said('echo x > /etc/sud"o"ers.d/y', 'sudoers');
    said('cat /etc/sudo.conf', 'sudo.conf');
    said('sed -i s/a/b/ /etc/pam.d/sshd', 'pam.d');
    said('echo "* hard nofile 9" >> /etc/security/limits.conf', '/etc/security');
    said('cp x /lib/aarch64-linux-gnu/security/pam_unix.so', '/security/pam_');
    said('rm /var/lib/spark-console/root-on', '/var/lib/spark-console');
    said('ls /run/spark-console', '/run/spark-console');
    said('systemctl stop sw-guard-abc.timer', 'sw-guard-');
    said('echo x > /tmp/s/y', '/tmp/s/y');
    said('true', '/var/lib/spark-console', ['--net', '--path', '/var/lib/spark-console/root-on']);
    said('true', '/tmp/s/y', ['--net', '--path', '/tmp/s/y']);
    assert.ok(!calls(s).slice(before).some(c => c[0] === 'systemd-run'), 'nothing ran, nothing was armed');
    const ok = rootRun(s, 'true /etc/hosts /tmp/x');
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  });

  test('state, stop and putback find the root command\'s own unit: putback stops it before the first copy back', () => {
    const s = rooted();
    const r = rootRun(s, SSH_CHANGE);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const id = newId();
    s.put(`run/spark-console/.calls/${id}`, 'handed 999999 1\n');
    s.put(`standin/active/sw-root-${id}.service`, '');
    assert.equal(run(s, ['state', '--id', id]).stdout, `${id} state running: it runs, or may still start\n`);
    assert.equal(run(s, ['stop', '--id', id]).stdout, `${id} stopped sw-root-${id}: it was running, and it is gone\n`);
    assert.equal(run(s, ['state', '--id', id]).stdout, `${id} state ended: its call is gone and nothing of it runs\n`);
    // (as if the root command still ran when the owner pressed "put it back")
    s.put(`standin/active/sw-root-${r.id}.service`, '');
    const before = calls(s).length;
    const p = run(s, ['putback', '--id', r.id]);
    assert.match(p.stdout, new RegExp(`^${r.id} put back at `), p.stdout + p.stderr);
    const asked = calls(s).slice(before).filter(c => c[0] === 'systemctl' && c[1] !== 'show').map(c => c.slice(1).join(' '));
    assert.equal(asked[0], `stop -- sw-root-${r.id}.service`, asked.join(' | '));
    assert.ok(!existsSync(join(s.R, `standin/active/sw-root-${r.id}.service`)), 'it was stopped');
    assert.equal(readFileSync(join(s.R, 'etc/ssh/sshd_config'), 'utf8'), 'Port 22\n');
  });

  test('check: root off, root ready, or root refuses while the proof is not current; the proof tries root without --net, and with --net while it is off', () => {
    const s = proven();
    const off = prove(s);
    assert.equal(off.status, 0, off.stdout + off.stderr);
    assert.ok(off.stdout.includes(`${off.id} proof root 13 refused: root with no net\n`) && off.stdout.includes(`${off.id} proof root off refused: root --net while root is off on this Spark\n`), off.stdout);
    rootOn(s);
    const on = prove(s);
    assert.equal(on.status, 0, on.stdout + on.stderr);
    assert.ok(on.stdout.includes(`${on.id} proof root 13 refused: root with no net\n`) && !on.stdout.includes('proof root off'), on.stdout);
    assert.equal(checkLine(s), 'root ready: only inside the net (--net), 30 minutes at most, 10 in the lock-out class');
    rmSync(join(s.R, 'var/lib/spark-console/proved'));
    assert.equal(checkLine(s), 'root refuses: the wall proof is none on this Spark');
    refused(rootRun(s, 'true'), 'the wall proof is none on this Spark: prove first');
  });
});
