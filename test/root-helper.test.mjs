// The root helper (R42; design A 2.13, step 1a): deploy/spark-console-root, the proof of its walls, and the owner's
// one-time command, deploy/root-for-sparkie.sh. Nothing in the console calls the helper yet. Rehearsals only: the
// helper runs as this user against a made-up Spark in a temporary folder (SPARK_CONSOLE_REHEARSAL), with the stand-ins
// in test/mock/bin (systemd-run, systemctl, unshare, setpriv, visudo); the one-time command also gets stand-ins of its
// own here for ssh, sudo and systemd-id128 (test/mock/bin/sudo belongs to the power work). No fleet starts.
// What this cannot show: the stand-ins build no wall. These tests show the helper asks for exactly the right walls and
// acts on the proof's answers; that a Spark grants them is decided by the proof itself, on each real Spark. The last
// group runs the proof's own attempts with no wall at all, to show each one does get through when nothing stops it.
// Linux only (GNU coreutils, bash 4 or newer): run it on a Spark with tools/test-on-spark.sh.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync, realpathSync, symlinkSync, readdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

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
  put(`${h}/.config/spark-console/secrets.json`, '{}');
  put(`${h}/.local/state/spark-console/api.sock`);
  put(`${h}/.local/state/spark-console/sessions.json`, '{}');
  put(`${h}/.local/state/spark-console/desired.json`, '{}');
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
// back read-only. /home/owner/.ssh/config is a link, so it stays hidden; the run wall adds name look-up.
const HIDDEN = (extra = []) => [
  ...['/home/owner/.ssh', '/home/owner/.config/spark-console', ...extra.filter(p => p.startsWith('/home/owner/')),
    '/home/other/.ssh', '/run', '/root', '/var/lib/tailscale', '/var/lib/docker', ...extra.filter(p => p.startsWith('/var/'))]
    .flatMap(p => ['-p', `TemporaryFileSystem=${p}:ro`]),
  ...['/home/owner/.cache/huggingface/token', '/home/owner/.local/state/spark-console/api.sock',
    '/home/owner/.local/state/spark-console/sessions.json', '/home/other/.bash_history', '/etc/shadow', '/etc/gshadow',
    '/etc/ssh/ssh_host_ed25519_key', '/swap.img'].flatMap(p => ['-p', `InaccessiblePaths=${p}`]),
  ...['/home/owner/.ssh/authorized_keys', '/home/owner/.ssh/known_hosts', '/home/owner/.ssh/id_ed25519.pub']
    .flatMap(p => ['-p', `BindReadOnlyPaths=${p}`]),
];
const READ_ONLY = ['/home/owner/.profile', '/home/owner/.bashrc', '/home/owner/spark-console-src', '/usr/local/sbin/spark-console-root'];
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
function runCall(s, id, hash, secs, { protect = [], hiddenExtra = ['/home/owner/.local/share/spark-console', '/var/lib/spark-console'] } = {}) {
  return ['systemd-run', `--unit=sw-run-${id}`, `--description=Spark Console run ${id} sha256 ${hash}`, '--wait', '--pipe',
    '--collect', '--quiet', '-p', 'NoNewPrivileges=yes', '-p', 'PrivateTmp=yes', '-p', 'IPAddressDeny=localhost',
    '-p', 'IPAddressAllow=127.0.0.53', ...HIDDEN(hiddenExtra), '-p', 'BindReadOnlyPaths=/run/systemd/resolve',
    ...[...READ_ONLY, ...protect].flatMap(p => ['-p', `ReadOnlyPaths=${p}`]), '-p', `BindReadOnlyPaths=/run/spark-console/${id}`,
    '-p', `RuntimeMaxSec=${secs}`, '-p', 'TimeoutStopSec=5', '-p', 'MemoryMax=8G', '-p', 'TasksMax=4096',
    '--', which(s, 'unshare'), '--pid', '--fork', '--kill-child', '--mount-proc',
    which(s, 'setpriv'), '--reuid=1000', '--regid=1000', '--groups=1000,4,44,992', '--inh-caps=-all', '--bounding-set=-all',
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
    assert.deepEqual(unitCall(s, `sw-run-${r.id}`), runCall(s, r.id, sha('true'), 600, { protect: ['/home/owner/models'] }));
  });

  test('run --open: nothing hidden, every membership, no own process tree; still no new privileges, and .ssh read-only', () => {
    const r = change(s, 'true', { extra: ['--open'] });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(unitCall(s, `sw-run-${r.id}`), ['systemd-run', `--unit=sw-run-${r.id}`,
      `--description=Spark Console run ${r.id} sha256 ${sha('true')}`, '--wait', '--pipe', '--collect', '--quiet',
      '-p', 'NoNewPrivileges=yes', '-p', 'PrivateTmp=yes',
      ...[...READ_ONLY.slice(0, 3), '/home/owner/.ssh', READ_ONLY[3]].flatMap(p => ['-p', `ReadOnlyPaths=${p}`]),
      '-p', `BindReadOnlyPaths=/run/spark-console/${r.id}`, '-p', 'RuntimeMaxSec=600', '-p', 'TimeoutStopSec=5',
      '-p', 'MemoryMax=8G', '-p', 'TasksMax=4096',
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
      [['run', '--id', newId(), '--sha256', ok, '--seconds', '5', '--dir', s.work, '--net', '--', 'true'], 'not understood'],
      [['run', '--id', newId(), '--id', newId(), '--sha256', ok, '--seconds', '5', '--dir', s.work, '--', 'true'], '--id is given twice'],
      [['run', '--id', newId(), '--sha256', ok, '--seconds', '5', '--dir', s.work, '--protect', 'home/owner/models', '--', 'true'], '--protect must name a whole path'],
      [['run', '--id', newId(), '--sha256', ok, '--seconds', '5', '--dir', s.work, '--protect', '/home/owner/my models', '--', 'true'], '--protect must name a whole path'],
      [['run', '--id', newId(), '--sha256', ok, '--seconds', '5', '--dir', s.work, '--protect', '/home/owner/nothing', '--', 'true'], '--protect must name a folder that is there'],
      [['run', '--id', newId(), '--sha256', ok, '--seconds', '5', '--dir', s.work, '--protect', '/home/owner/.ssh/config', '--', 'true'], '--protect must name a folder that is there'],
      [['run', '--id', newId(), '--sha256', ok, '--seconds', '5', '--dir', s.work, ...Array(5).fill(['--protect', '/home/owner/models']).flat(), '--', 'true'], 'at most 4 --protect'],
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

  test('root refuses, always: the put-back net is not built yet', () => {
    const before = calls(s).length;
    const r = run(s, ['root', '--id', newId(), '--sha256', sha('id'), '--seconds', '5', '--dir', s.work, '--', 'id']);
    assert.equal(r.status, 125);
    assert.match(r.stdout, /^call\d+ refused: root needs the put-back net, which is not built yet: root is refused on every Spark\n$/);
    assert.equal(calls(s).length, before, 'nothing was asked of systemd');
  });

  test('check: what the Spark has, whether the proof is current, and each wall', () => {
    const id = newId();
    const r = run(s, ['check', '--id', id]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.stdout, [
      `helper ${sha(readFileSync(HELPER_SRC))}`, 'systemd 255.4-1ubuntu8.4 ok', 'first-process ok', 'cgroup2 ok', 'unshare ok',
      'setpriv ok', 'python3 ok', 'files ok', 'kernel 6.11.0-1016-nvidia', 'proof current', 'look ready', 'run ready',
      'root refuses: the put-back net is not built yet'].map(l => `${id} ${l}\n`).join(''));
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
    'a hidden key file', 'a disk device or the GPU', 'something left behind'];
  const LOOK = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], RUN = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12];

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
    assert.deepEqual(units, ['prep', 'setup', 'target', 'outside', 'look', 'run', 'post', 'after'].map(u => `sw-prove-${u}-${p.id}`));
    assert.deepEqual(calls(s).filter(c => c[0] === 'systemctl' && c[1] !== 'show' && c[1] !== '--version'),
      [['systemctl', 'is-active', '--quiet', `sw-prove-target-${p.id}.service`], ['systemctl', 'stop', `sw-prove-target-${p.id}.service`]]);
    assert.ok(p.stdout.includes(`${p.id} proof outside 2 works: an open connection (the loopback, stand-in)\n`));
    assert.ok(p.stdout.includes(`${p.id} proof controls work: each attempt was seen working outside the walls, or is not there\n`));
    const py = which(s, 'python3'), proof = `/run/spark-console/${p.id}/proof.py`;
    const hidden = ['/home/owner/.local/share/spark-console'];
    const lookUnit = lookCall(s, p.id, 'x', 120, hidden);
    assert.deepEqual(unitCall(s, `sw-prove-look-${p.id}`), [...lookUnit.slice(0, 1), `--unit=sw-prove-look-${p.id}`,
      `--description=Spark Console wall proof look ${p.id}`, ...lookUnit.slice(3, lookUnit.indexOf('--') + 1), py, '-I', '-S', proof, 'look', ...LOOK.map(String)]);
    const ro = `/home/owner/.cache/spark-console/proof-${p.id}-ro`;
    const runUnit = runCall(s, p.id, 'x', 120, { protect: [ro], hiddenExtra: hidden });
    assert.deepEqual(unitCall(s, `sw-prove-run-${p.id}`), [...runUnit.slice(0, 1), `--unit=sw-prove-run-${p.id}`,
      `--description=Spark Console wall proof run ${p.id}`, ...runUnit.slice(3, runUnit.indexOf(which(s, 'bash'))), py, '-I', '-S', proof, 'run', ...RUN.map(String)]);
    assert.deepEqual(unitCall(s, `sw-prove-outside-${p.id}`), ['systemd-run', `--unit=sw-prove-outside-${p.id}`,
      `--description=Spark Console wall proof outside ${p.id}`, '--wait', '--pipe', '--collect', '--quiet', '--uid=1000', '--gid=1000',
      '-p', 'RuntimeMaxSec=120', '-p', 'TimeoutStopSec=5', '--', py, '-I', '-S', proof, 'outside', ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(String)]);
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

  test('--undo: the line, then the helper, then the mark', () => {
    const f = fleet();
    assert.equal(f.cmd(['3']).status, 0);
    const n = sudoCalls(f).length;
    const r = f.cmd(['--undo', '3']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(sudoCalls(f).slice(n), ['-v', 'rm -f /etc/sudoers.d/spark-console-root /etc/sudoers.d/spark-console-root.new',
      'rm -f /usr/local/sbin/spark-console-root /usr/local/sbin/spark-console-root.new', 'rm -f /var/lib/spark-console/proved']);
    assert.ok(!has(f, 'usr/local/sbin/spark-console-root') && !has(f, 'etc/sudoers.d/spark-console-root') && !has(f, 'var/lib/spark-console/proved'));
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
        assert.match(r.stdout, /look wall: not set up\n {2}run wall: not set up\n {2}root \(the net\): not built yet, refused on every Spark\n$/);
      } else {
        assert.match(r.stdout, /the helper \(\/usr\/local\/sbin\/spark-console-root\): there, this build's\n/);
        assert.match(r.stdout, /its sudo line .*: works/);
        assert.match(r.stdout, / {4}proof current\n {4}look ready\n {4}run ready\n {4}root refuses: the put-back net is not built yet\n$/);
      }
    }
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
// must not get through: that is the proof.)
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
      assert.ok(outside.includes('P 2 outside works the loopback'), outside.join('\n'));
      for (const n of [8, 9, 11]) assert.ok(outside.some(l => new RegExp(`^P ${n} outside (works|not-there) \\S`).test(l)), `outside ${n}: ${outside.join('\n')}`);
      assert.equal(outside.length, 11);
      const inside = lines(P.py('look', 1, 2, 3, 4, 6, 10));
      for (const n of [1, 2, 3, 4, 6, 10]) for (const how of ['direct', 'child']) {
        assert.ok(inside.some(l => l.startsWith(`P ${n} ${how} through `)), `look ${n} ${how}: ${inside.join('\n')}`);
      }
      assert.ok(inside.includes('P 2 direct through the loopback') && inside.includes('P 3 direct through api.sock by its path, api.sock by a second path'), inside.join('\n'));
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
