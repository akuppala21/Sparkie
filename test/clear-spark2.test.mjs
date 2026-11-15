// Covers: deploy/clear-spark2.sh (E10a, design E 2.6): the look at Spark 2, the hub, and the never list every later
// mode of the script keeps. `--check` runs against a made-up home whose PATH holds nothing but stand-in systemctl,
// docker, ss, tailscale, ps, du and sort: each records its call, so any other command the script tried would fail
// ("command not found"), and every recorded call must be a read. The made-up home, the working folder and TMPDIR must
// be exactly as they were. Starts no stand-in fleet (it may run on the Mac too).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, lstatSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { REPO } from './lib.mjs';

const SCRIPT_PATH = join(REPO, 'deploy', 'clear-spark2.sh');
const which = c => spawnSync('sh', ['-c', `command -v ${c}`], { encoding: 'utf8' }).stdout.trim();
const BASH = existsSync('/bin/bash') ? '/bin/bash' : which('bash');
const CONSOLE = "Spark Console's", BRAIN = "the brain's", OTHER = 'something else';

// One stand-in for every command: it records [command, ...arguments], then answers from fixture.json.
const STANDIN = `const fs = require('fs'), { spawnSync } = require('child_process');
const [cmd, ...args] = process.argv.slice(2), dir = process.env.STANDIN_DIR;
fs.appendFileSync(dir + '/calls.jsonl', JSON.stringify([cmd, ...args]) + '\\n');
const fx = JSON.parse(fs.readFileSync(dir + '/fixture.json', 'utf8'));
const out = s => process.stdout.write(s), lines = a => a.map(l => l + '\\n').join('');
const fail = (msg, code = 1) => { process.stderr.write(msg + '\\n'); process.exit(code); };
switch (cmd) {
  case 'systemctl': {
    const user = args.includes('--user');
    if (user && fx.userManagerDown) fail('Failed to connect to bus: No medium found');
    if (args.includes('list-unit-files')) out(lines(user ? fx.userUnitFiles : []));
    else if (args.includes('list-units')) out(lines(user ? fx.userUnits : fx.systemUnits));
    else fail('stand-in systemctl: not a read it knows', 3);
    break;
  }
  case 'docker': {
    if (fx.dockerDenied) fail('permission denied while trying to connect to the Docker daemon socket');
    if (args[0] !== 'ps') fail('stand-in docker: not a read it knows', 3);
    const f = args.find(a => a.startsWith('--format=')), fmt = f ? f.slice(9) : args[args.indexOf('--format') + 1];
    for (const c of fx.containers) out(fmt.replace(/\\{\\{\\.(\\w+)(?: "([^"]+)")?\\}\\}/g, (_, k, label) => (k === 'Label' ? c.labels[label] || '' : c[k] ?? '')).replace(/\\\\t/g, '\\t') + '\\n');
    break;
  }
  case 'ss': out(lines(fx.ss)); break;
  case 'tailscale': if (fx.tailscaleDenied) fail('access denied'); out(fx.serveStatus); break;
  case 'ps': out(lines(fx.ps)); break;
  case 'du': {
    const p = args[args.length - 1], d = fx.du[p.slice(process.env.HOME.length + 1)];
    out((d ? d.kb : 8) + '\\t' + p + '\\n');
    if (d && d.denied) fail("du: cannot read directory '" + p + "/hub/models--x': Permission denied");
    break;
  }
  case 'sort': { const r = spawnSync(fx.realSort, args, { stdio: 'inherit' }); process.exit(r.status == null ? 1 : r.status); }
  default: fail('stand-in ' + cmd + ': unknown', 3);
}
`;
const COMMANDS = ['systemctl', 'docker', 'ss', 'tailscale', 'ps', 'du', 'sort'];
// What each stand-in may be asked: reads only. ss never with -K (it closes sockets) or -D (it writes a file); sort never
// with -o (it writes a file) or a program to run.
const READ_ONLY = {
  systemctl: a => { const v = a.filter(x => !x.startsWith('-')); return v.length === 1 && ['list-units', 'list-unit-files'].includes(v[0]); },
  docker: a => a[0] === 'ps',
  ss: a => a.length > 0 && a.every(x => /^-[Hatlnpu46]+$/.test(x)),
  tailscale: a => ['serve status', 'funnel status', 'status'].includes(a.join(' ')),
  ps: a => a.every(x => typeof x === 'string'),
  du: a => a.length === 2 && a[0] === '-sk',
  sort: a => !a.some(x => /^(-o|--output|--compress-program)/.test(x)),
};

const CS = '.local/opt/code-server-4.96.2';
const FIXTURE = {
  realSort: which('sort'),
  userUnits: [
    'spark-console-api.service loaded active running Spark Console API (live metrics, model library, deploys)',
    'spark-console-watchdog.service loaded inactive dead Spark Console watchdog (restarts the console if it stops answering)',
    'spark-console-watchdog.timer loaded active waiting Spark Console watchdog, every minute',
    'spark-portal-editor.service loaded active running code-server',
    'spark-portal-tunnel-spark3.service loaded active running Editor tunnel to Spark 3',
    'dbus.service loaded active running D-Bus User Message Bus',
    'pipewire.service loaded inactive dead PipeWire Multimedia Service',
    'syncthing.service loaded failed failed Syncthing',
  ],
  userUnitFiles: [
    'dbus.service static -', 'notes-sync.service enabled enabled', 'spark-console-api.service enabled enabled',
    'spark-console-watchdog.service static -', 'spark-console-watchdog.timer enabled enabled',
    'spark-portal-editor.service enabled enabled', 'spark-portal-tunnel-spark3.service enabled enabled',
    'spark-portal.service disabled enabled', 'syncthing.service enabled enabled',
  ],
  systemUnits: [
    'containerd.service loaded active running containerd container runtime',
    'cups.service loaded active running CUPS Scheduler',
    'docker.service loaded active running Docker Application Container Engine',
    'ssh.service loaded active running OpenBSD Secure Shell server',
    'tailscaled.service loaded active running Tailscale node agent',
  ],
  containers: [
    { Names: 'sparkie-main', State: 'running', Image: 'lmsysorg/sglang:v0.5.23', Ports: '127.0.0.1:30100->8000/tcp', labels: { 'spark.role': 'main', 'spark.console': '1', 'spark.protect': 'true' } },
    { Names: 'qwen-recipe-aphex3k', State: 'exited', Image: 'lmsysorg/sglang:v0.5.23', Ports: '', labels: {} },
    { Names: 'spark-console-plugs', State: 'running', Image: 'ghcr.io/matter-js/matterjs-server:1.5.5', Ports: '', labels: { 'spark.protect': 'true' } },
    { Names: 'sc-notes-app', State: 'running', Image: 'example/notes:1', Ports: '127.0.0.1:9100->80/tcp', labels: { 'spark.app': '1' } },
    { Names: 'open-webui', State: 'running', Image: 'example/open-webui:main', Ports: '0.0.0.0:3000->8080/tcp, [::]:3000->8080/tcp', labels: {} },
  ],
  ss: [
    'LISTEN 0      511        127.0.0.1:8810       0.0.0.0:*    users:(("node",pid=2001,fd=21))',
    'LISTEN 0      4096       127.0.0.1:30100      0.0.0.0:*',
    'LISTEN 0      511        127.0.0.1:8801       0.0.0.0:*    users:(("node",pid=2101,fd=19))',
    'LISTEN 0      128        127.0.0.1:8802       0.0.0.0:*    users:(("ssh",pid=2201,fd=5))',
    'LISTEN 0      4096         0.0.0.0:22         0.0.0.0:*',
    'LISTEN 0      4096            [::]:22            [::]:*',
    'LISTEN 0      4096         0.0.0.0:3000       0.0.0.0:*',
    'LISTEN 0      4096            [::]:3000          [::]:*',
    'LISTEN 0      4096       127.0.0.1:9100       0.0.0.0:*',
    'LISTEN 0      4096       127.0.0.1:5580       0.0.0.0:*    users:(("node",pid=2301,fd=30))',
    'LISTEN 0      4096   127.0.0.53%lo:53         0.0.0.0:*',
    'LISTEN 0      5            0.0.0.0:7777       0.0.0.0:*    users:(("python3",pid=2401,fd=3))',
  ],
  serveStatus: 'https://spark2.example.ts.net:8443 (Funnel on)\n|-- /            path  /home/owner/spark-console\n|-- /console/api proxy unix:/home/owner/.local/state/spark-console/api.sock\n',
  ps: [' 9876543 root     python3', ' 1200000 owner    node', '  480000 owner    node', '    9000 root     sshd'],
  du: { '.cache/huggingface': { kb: 104857600, denied: true }, 'spark-console-src': { kb: 30720 }, [CS]: { kb: 524288 } },
};

const homes = [];
function makeHome(change = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sct-clear-'));
  homes.push(root);
  const home = join(root, 'home'), bin = join(root, 'bin'), sd = join(root, 'standin'), tmp = join(root, 'tmp'), cwd = join(root, 'cwd');
  for (const d of [home, bin, sd, tmp, cwd]) mkdirSync(d);
  const put = (rel, text = '') => { mkdirSync(dirname(join(home, rel)), { recursive: true }); writeFileSync(join(home, rel), text); };
  const unit = exec => `[Unit]\nDescription=made up\n\n[Service]\nExecStart=${exec}\n`;
  const node = `${home}/${CS}/lib/node`;
  put('.config/systemd/user/spark-console-api.service', unit(`${node} %h/spark-console-service/server.mjs`));
  put('.config/systemd/user/spark-console-watchdog.service', unit('/bin/bash %h/.local/share/spark-console/watchdog.sh'));
  put('.config/systemd/user/spark-console-watchdog.timer', '[Timer]\nOnUnitActiveSec=1min\n');
  put('.config/systemd/user/spark-portal.service', unit('/usr/bin/python3 %h/spark-portal/server.py'));
  put('.config/systemd/user/spark-portal-editor.service', unit(`%h/${CS}/bin/code-server --bind-addr 127.0.0.1:8801`));
  put('.config/systemd/user/spark-portal-tunnel-spark3.service', unit('/usr/bin/ssh -N -L 127.0.0.1:8802:127.0.0.1:8080 spark3'));
  put('.config/systemd/user/notes-sync.service', unit('/usr/bin/rclone sync a b'));
  put(`${CS}/lib/node`); put(`${CS}/bin/code-server`);
  // two kept snapshots: the older one starts Spark Console with code-server's Node, the newer one with a Node of its own
  put('.local/share/spark-console/releases/20261110T120000Z/spark-console-api.service', unit(`${node} %h/spark-console-service/server.mjs`));
  put('.local/share/spark-console/releases/20261111T090000Z/spark-console-api.service', unit('/usr/bin/node %h/spark-console-service/server.mjs'));
  for (const d of ['spark-console', 'spark-console-service', 'spark-console-src', '.local/state/spark-console', '.config/spark-console',
    '.cache/spark-console/kernels', '.local/state/spark-portal', '.local/share/spark-portal/workspaces/shared', 'workspaces',
    '.cache/huggingface/hub', 'spark-portal', '.config/spark-portal', 'qwen-bench', 'Downloads']) mkdirSync(join(home, d), { recursive: true });
  writeFileSync(join(sd, 'fixture.json'), JSON.stringify({ ...FIXTURE, ...change }));
  writeFileSync(join(sd, 'standin.cjs'), STANDIN);
  for (const c of COMMANDS) writeFileSync(join(bin, c), `#!${BASH}\nexec "${process.execPath}" "${join(sd, 'standin.cjs')}" ${c} "$@"\n`, { mode: 0o755 });
  return { root, home, bin, sd, tmp, cwd, node };
}
const run = (h, args) => spawnSync(BASH, [SCRIPT_PATH, ...args], {
  cwd: h.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000,
  env: { PATH: h.bin, HOME: h.home, USER: 'owner', LANG: 'C', TMPDIR: h.tmp, STANDIN_DIR: h.sd },
});
const calls = h => (existsSync(join(h.sd, 'calls.jsonl')) ? readFileSync(join(h.sd, 'calls.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
// every file and folder under dir, with its kind, size and times: equal before and after means nothing changed there
function snapshot(dir) {
  const out = {};
  (function walk(d) {
    for (const f of readdirSync(d).sort()) {
      const p = join(d, f), s = lstatSync(p);
      out[p.slice(dir.length)] = `${s.mode}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
      if (s.isDirectory()) walk(p);
    }
  })(dir);
  return out;
}
const snapAll = h => ({ home: snapshot(h.home), cwd: snapshot(h.cwd), tmp: snapshot(h.tmp) });
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const marked = (out, kind, name) => new RegExp(`^  ${esc(kind)} +${esc(name)}(\\s|$)`, 'm').test(out);
const section = (out, from, to) => { const a = out.indexOf(from); assert.ok(a >= 0, `no “${from}” in:\n${out}`); const b = to ? out.indexOf(to, a) : out.length; return out.slice(a, b < 0 ? out.length : b); };
function onlyReads(h) {
  const c = calls(h);
  for (const [cmd, ...args] of c) assert.ok(READ_ONLY[cmd]?.(args), `not a read: ${cmd} ${args.join(' ')}`);
  return c;
}
const cleanup = () => { for (const r of homes.splice(0)) rmSync(r, { recursive: true, force: true }); };

describe('clear-spark2.sh --check: the look at Spark 2', { concurrency: false }, () => {
  test('--check lists the units, containers, ports and folders it was given, each marked Spark Console\'s, the brain\'s or something else, and runs only reads', () => {
    const h = makeHome(), before = snapAll(h);
    try {
      const r = run(h, ['--check']);
      const out = r.stdout;
      assert.equal(r.status, 0, r.stderr + out);
      assert.doesNotMatch(r.stdout + r.stderr, /command not found|No such file/);
      const expect = [
        // units: yours (from your folder, and anything running or failed), then the system's running services
        [CONSOLE, 'spark-console-api.service'], [CONSOLE, 'spark-console-watchdog.service'], [CONSOLE, 'spark-console-watchdog.timer'],
        [OTHER, 'spark-portal.service'], [OTHER, 'spark-portal-editor.service'], [OTHER, 'spark-portal-tunnel-spark3.service'],
        [OTHER, 'notes-sync.service'], [OTHER, 'syncthing.service'], [OTHER, 'dbus.service'],
        [OTHER, 'docker.service'], [OTHER, 'containerd.service'], [OTHER, 'tailscaled.service'], [OTHER, 'ssh.service'], [OTHER, 'cups.service'],
        // containers
        [BRAIN, 'sparkie-main'], [BRAIN, 'qwen-recipe-aphex3k'], [CONSOLE, 'spark-console-plugs'], [CONSOLE, 'sc-notes-app'], [OTHER, 'open-webui'],
        // ports: by the container that publishes them, else by their number
        [CONSOLE, '8810'], [BRAIN, '30100'], [CONSOLE, '9100'], [CONSOLE, '5580'], [OTHER, '8801'], [OTHER, '8802'],
        [OTHER, '3000'], [OTHER, '22'], [OTHER, '53'], [OTHER, '7777'],
        // folders
        [CONSOLE, '~/spark-console'], [CONSOLE, '~/spark-console-src'], [CONSOLE, '~/.local/state/spark-console'],
        [CONSOLE, '~/.local/share/spark-console'], [CONSOLE, '~/.local/share/spark-portal'], [CONSOLE, '~/.local/state/spark-portal'],
        [CONSOLE, '~/workspaces'], [BRAIN, '~/.cache/huggingface'], [OTHER, '~/spark-portal'], [OTHER, '~/.config/spark-portal'],
        [OTHER, `~/${CS}`], [OTHER, '~/qwen-bench'], [OTHER, '~/Downloads'],
      ];
      for (const [kind, name] of expect) assert.ok(marked(out, kind, name), `${name} should be marked ${kind}:\n${out}`);
      assert.doesNotMatch(out, /pipewire/, 'a stopped unit of the system\'s own is left out');
      assert.match(out, /spark-portal\.service +stopped, disabled: the old portal .*; deleted later/);
      assert.match(out, /spark-portal-editor\.service +running, enabled: code-server, the browser editor \(port 8801\); stopped later/);
      assert.match(out, /spark-portal-tunnel-spark3\.service +running, enabled: an editor tunnel \(port 8802\); stopped later/);
      assert.match(out, /^  something else +22 +0\.0\.0\.0, \[::\] +- +SSH, never touched$/m, 'one line a port, its addresses together');
      assert.match(out, /^  the brain's +30100 .*published by the container sparkie-main, never touched$/m);
      assert.match(out, /~\/\.cache\/huggingface +at least 100\.0 GB/);
      // what the later step would change: only the editor, its tunnels, the old portal and code-server
      const later = section(out, 'What the later clearing step would change', 'What it never touches');
      assert.ok(later.includes(`Today it starts with ${h.node}: code-server's own Node`), later);
      for (const s of ['spark-portal-editor.service', 'spark-portal-tunnel-spark3.service', 'Their ports open now: 8801, 8802.',
        'spark-portal.service', '~/spark-portal ', `~/${CS}`, 'today 1 of the 2 kept snapshots do']) assert.ok(later.includes(s), `${s} in:\n${later}`);
      for (const s of ['sparkie-main', 'qwen-recipe', 'open-webui', 'notes-sync', 'syncthing', 'spark-console-api', 'spark-portal/', '~/.config/spark-portal', 'docker', 'tailscale']) {
        assert.ok(!later.includes(s), `${s} is not for the later step to change:\n${later}`);
      }
      const never = section(out, 'What it never touches', 'What this look could not see');
      for (const s of ["the brain's model server", 'qwen-recipe-*', 'the public Funnel on port 443', 'the firewall, users and SSH', '~/.config/spark-portal']) assert.ok(never.includes(s), `${s} in:\n${never}`);
      const unseen = section(out, 'What this look could not see', 'Nothing was changed.');
      assert.ok(unseen.includes('~/.cache/huggingface'), unseen);
      assert.ok(unseen.includes('Which program holds 5 of the 10 ports'), unseen);
      assert.match(out, /Nothing was changed\.\n$/);
      // only reads, and it really looked
      const c = onlyReads(h);
      for (const cmd of ['systemctl', 'docker', 'ss', 'tailscale']) assert.ok(c.some(([x]) => x === cmd), `it should ask ${cmd}`);
      assert.deepEqual(snapAll(h), before, 'nothing in the home, the working folder or TMPDIR changed');
    } finally { cleanup(); }
  });

  test('where a look fails it says what it could not see, asks for nothing and still changes nothing', () => {
    const h = makeHome({ userManagerDown: true, dockerDenied: true, tailscaleDenied: true }), before = snapAll(h);
    try {
      const r = run(h, ['--check']);
      const out = r.stdout;
      assert.equal(r.status, 0, r.stderr + out);
      assert.doesNotMatch(r.stdout + r.stderr, /command not found|No such file/);
      const unseen = section(out, 'What this look could not see', 'Nothing was changed.');
      for (const s of ["systemd for your user didn't answer (Failed to connect to bus", "Docker didn't answer (permission denied", "Tailscale didn't answer (access denied"]) assert.ok(unseen.includes(s), `${s} in:\n${unseen}`);
      // your own unit files are still listed, their state unknown rather than guessed
      assert.match(out, /^  Spark Console's +spark-console-api\.service +unknown/m);
      assert.match(out, /^  something else +spark-portal-editor\.service +unknown/m);
      onlyReads(h);
      assert.deepEqual(snapAll(h), before);
    } finally { cleanup(); }
  });

  test('a run without --check refuses: it exits non-zero, runs nothing and changes nothing', () => {
    for (const args of [[], ['--everything'], ['check'], ['--check', '--now']]) {
      const h = makeHome(), before = snapAll(h);
      try {
        const r = run(h, args);
        assert.notEqual(r.status, 0, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
        assert.match(r.stderr, /Nothing was changed/);
        assert.match(r.stderr, /--check/);
        assert.deepEqual(calls(h), [], `${args.join(' ')} ran nothing`);
        assert.deepEqual(snapAll(h), before);
      } finally { cleanup(); }
    }
  });
});

describe('clear-spark2.sh: the never list, in this script and any later mode of it', () => {
  const script = readFileSync(SCRIPT_PATH, 'utf8');
  // Only the code: the never list itself is comment text and names the commands it forbids.
  const code = script.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
  test('the never list is in the script, as text the later step keeps', () => {
    const header = script.split('\n').filter(l => /^#/.test(l)).join('\n');
    assert.match(header, /^# Never, in this script or any later mode of it/m);
    for (const s of ['stop, remove or restart a qwen-recipe-* container or the brain\'s model server', 'the Docker service they run in',
      '`tailscale serve ... off`', '`tailscale funnel ... off`', 'the public Funnel on port 443', 'the tailscaled service',
      'change a firewall, a user or SSH']) assert.ok(header.includes(s), `the never list names: ${s}`);
  });
  test('the script holds no command that breaks it: no container change, no Tailscale change, no firewall, user or SSH change', () => {
    const NEVER = [
      [/\bdocker\s+(?!ps\b|inspect\b|images?\b|info\b|version\b)[\w-]+/, 'a docker command that is not a read (the brain\'s or a qwen-recipe container)'],
      [/\b(kill|pkill|killall)\b/, 'killing a process (the brain\'s model server)'],
      [/\bsystemctl\b[^\n]*\b(docker|containerd|tailscaled|ssh|sshd|ufw|nftables|firewalld|iptables)\b/, 'systemctl on Docker, Tailscale, SSH or the firewall'],
      [/\btailscale\s+(?!(?:serve\s+|funnel\s+)?status\b)/, 'a tailscale command that is not a status read'],
      [/\b(tailscale|funnel)\b[^\n]*\boff\b/, 'tailscale … off'],
      [/--https?=443\b|\bfunnel\s+443\b/, 'the public Funnel on port 443'],
      [/\b(ufw|iptables|ip6tables|nft|firewall-cmd)\b/, 'the firewall'],
      [/\b(useradd|usermod|userdel|adduser|deluser|passwd|chpasswd|chsh|chage|gpasswd|groupadd|groupmod|groupdel|visudo)\b|\/etc\/sudoers/, 'a user'],
      [/\bloginctl\s+(?!show|list)/, 'a user (loginctl)'],
      [/\b(ssh|sshd|scp|sftp|ssh-keygen|ssh-copy-id|ssh-add)\s|authorized_keys|\/etc\/ssh\b/, 'SSH'],
    ];
    for (const [re, what] of NEVER) { const m = code.match(re); assert.equal(m, null, `the script's code touches ${what}: “${m?.[0]}”`); }
  });
  test('it refuses to run as root, and asks for no root itself', () => {
    assert.match(code, /if \[ "\$EUID" = 0 \]; then/);
    assert.doesNotMatch(code, /\bsudo\b|\bsu\s|\bpkexec\b|\bdoas\b/);
  });
});
