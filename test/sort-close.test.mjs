// Covers: The sorter's closing fixes of 2026-11-15 (R55, R64; the final reads `net`, `keys` and the sorter's own): when
// it cannot tell what a command does it falls to the stricter side. Code a command does not show (`unshown`: root
// refuses on it; fed from input or a start-file setting it is asked); Docker that reaches the host and nsenter, chroot
// and unshare (the lock-out class); a command for Spark 2 from a compute Spark (not done; a host that can't be told is
// the dangerous ask); what the net can't put back (`lasting`: a Tailscale sign-out or sign-in by any spelling, a way-in
// package removed, a way-in word in an inline program); the lock-out class's misses (kills by name, radios, links,
// tunnels, init scripts, timers, the clock); protected containers (not done; an id that can't be told is asked the
// dangerous way); a rewrite in place marked `deletes`, with `overwrites` listing what it writes; kinds that run another
// program; `set -k`; a regular expression in a one-liner. Each list: the reviewers' examples and spellings of our own.
// Pure: no stand-in fleet, no port.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..'), SRC = join(REPO, 'service', 'src');
// The sorter's parts and 21-work.mjs, as test/sort.test.mjs loads them, with the few names they take from other parts stubbed.
const dir = mkdtempSync(join(tmpdir(), 'sct-sort-close-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
writeFileSync(join(dir, 'sort.mjs'), [
  "import { createHash, randomBytes } from 'node:crypto';",
  'const ALL_LOCAL = true, CONFIG = { user: "owner" }, J_MAX = 16 * 2 ** 20, NODES = [];',
  String.raw`const q = s => "'" + String(s).replace(/'/g, "'\\''") + "'";`,
  'class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }',
  'const ACTIONS = new Map(), action = a => ACTIONS.set(a.name, a), sparkArg = { type: "string" };',
  'const node = { id: "spark3", host: "100.0.0.3" }, sparkOf = () => node, sparkName = () => "Spark 3", journalId = () => "j_test";',
  'const journal = () => {}, jErr = () => null, jSub = () => [], noteReach = () => {}, maskSecrets = String, agentKeys = () => [];',
  'const consoleOrigin = () => "", sizeWords = String, hooks = { offline: true, spawn: null, ladder: [], sortOpts: null }, knownOffline = () => hooks.offline;',
  'const spawnOn = (n, o) => hooks.spawn(n, o);',
  'const RUNNER_DIR = "~/work", runnerSortOpts = () => hooks.sortOpts || {}, workChange = async (n, c, s) => { hooks.ladder.push(c); return { ladder: s.class }; };',
  ...readdirSync(SRC).filter(f => /^20-(?:options|places|programs|remote|shape|shell|sort|tables|tools|uses)\.mjs$/.test(f)).sort().map(f => readFileSync(join(SRC, f), 'utf8')),
  readFileSync(join(SRC, '21-work.mjs'), 'utf8'),
  'export { sortCommand };',
].join('\n'));
const { sortCommand } = await import(pathToFileURL(join(dir, 'sort.mjs')).href);

const HOSTS = { spark1: 'compute', spark2: 'hub', spark3: 'compute', spark4: 'compute', '100.122.49.9': 'compute', akspark2: 'hub', '100.64.0.2': 'hub' };
const BRAIN = ['sparkie-main', 'RadixArk--Qwen3.8-27B-NVFP4'];
const sort = (command, o = {}) => sortCommand(command, { hosts: HOSTS, brain: BRAIN, ...o });
const ROOT = { root: true };
// Each command's answer against what it must be: every one that differs, with the sorter's reason.
const check = (rows, f) => rows.flatMap(row => { const r = sort(row[0], row[2]), bad = f(r, row); return bad ? [`${JSON.stringify(row[0])}${row[2] ? ` ${JSON.stringify(row[2])}` : ''}: ${bad} (${r.class}: ${r.why})`] : []; });
const is = (want, r) => (r.class === want ? null : `${r.class}, not ${want}`);

// Item 2 (net 4): "as root, never a script" held only for a file named as a word.
test('code a command does not show: unshown says what runs unseen; as root every form has it; fed from input it is asked as the owner too, while builds stay plain', () => {
  const FORMS = ['bash < fix.sh', 'cat fix.sh | bash', 'python3 < fix.py', 'python3 -m fix', 'make install', 'npm run setup', 'env BASH_ENV=~/work/fix.sh bash -c true',
    'node -r ./hook.js -e 1', 'source fix.sh', '. fix.sh', 'echo fix.sh | xargs sh',
    // (and kin of our own)
    'sh -s < fix.sh', 'ruby < x.rb', 'perl -MFix -e 1', 'cargo build', 'yarn test', 'cmake --build build', 'LD_PRELOAD=./x.so ls', 'PYTHONSTARTUP=x.py python3',
    "find . -name '*.sh' -exec bash {} \\;", 'bash -c "$(cat fix.sh)"', 'ed notes.txt < cmds', 'docker compose up -d', 'crontab jobs.txt', 'conda run -n x python3 t.py',
    'pip install -e .', 'npm install ./pkg', 'python3 fix.py', './fix.sh', 'awk -f prog.awk data'];
  assert.deepEqual(check(FORMS.map(c => [c, null, ROOT]), r => (r.unshown && typeof r.unshown === 'string' && !/[\n\r]/.test(r.unshown) ? null : 'no unshown')), []);
  assert.deepEqual(check(FORMS.map(c => [c]), r => (r.unshown ? null : 'no unshown')), []);
  // (fed from input, or a start-file setting: asked as the owner too)
  assert.deepEqual(check(['bash < fix.sh', 'sh < ./fix.sh', 'python3 < fix.py', 'python3 - < x.py', 'ruby < x.rb', 'cat fix.sh | bash', 'echo fix.sh | xargs sh',
    'env BASH_ENV=~/work/fix.sh bash -c true', 'LD_PRELOAD=./x.so ls', 'NODE_OPTIONS=--require=./x.js node t.js'].map(c => [c]), r => is('risky', r)), []);
  // (the everyday forms stay a plain change, the wall bounding them: their code is unshown, but not asked for that)
  assert.deepEqual(check(['make', 'make -j8', 'npm install', 'npm run build', 'cargo build --release', 'python3 -m venv .venv', 'python3 -m json.tool < out.json',
    'pip install -e .', 'python3 train.py', 'cmake --build build -j8'].map(c => [c]), r => is('change', r)), []);
  // (what shows its code is not unshown: a one-liner, here-text, a look)
  for (const c of ["bash -c 'touch /tmp/x'", "python3 -c 'print(1)'", 'bash <<EOF\ntouch /tmp/x\nEOF', 'ls -la', 'apt install -y htop']) assert.equal(sort(c).unshown, null, c);
  assert.equal(sort('apt install -y htop').simple, true);
});

// Item 1 (net 3): Docker that reaches the host was one plain button, run with --open, no net, no owner's words.
test('Docker that reaches the host, and nsenter, chroot and unshare, are the lock-out class; a container that reaches no further stays risky', () => {
  const HOSTY = ['docker run --rm --privileged --net=host alpine iptables -P INPUT DROP', 'docker run --privileged --pid=host alpine nsenter -t 1 -m -u -n -i sh -c "systemctl stop ssh"',
    'docker run -v /:/host alpine chroot /host passwd -l bob', 'docker run -v /etc:/mnt alpine sh -c "rm /mnt/ssh/ssh_host_ed25519_key.pub"',
    'docker run -v /var/lib/tailscale:/t alpine rm -rf /t', 'docker exec -u 0 x iptables -F', 'nsenter -t 1 -m -u -n -i sh', 'chroot /host', 'unshare -r sh',
    // (and spellings of our own: each flag of the ruling, other ways to name a mount, other programs)
    'docker run --network host img', 'docker run --net=host img', 'docker run --ipc=host img', 'docker run --pid host img', 'docker run --userns=host img',
    'docker run --cgroupns=host img', 'docker run --uts=host img', 'docker run --network container:other img', 'docker run --cap-add NET_ADMIN img',
    'docker run --cap-add=ALL img', 'docker run --device /dev/net/tun img', 'docker run --security-opt seccomp=unconfined img', 'docker run --volumes-from other img',
    'docker run -v /var/run/docker.sock:/var/run/docker.sock img', 'docker run -v /run:/run img', 'docker run -v /proc:/hp img', 'docker run -v /sys:/s:ro img',
    'docker run -v /root:/r img', 'docker run -v /home:/h img', 'docker run -v ~:/h img', 'docker run -v ~/.ssh:/k:ro img', 'docker run -v /var:/v img',
    'docker run --mount type=bind,source=/,target=/h img', 'docker run --mount=type=bind,src=/etc,dst=/e img', 'docker run -v/etc:/e img', 'docker create --privileged img',
    'docker container run --privileged img', 'podman run --privileged img', 'nerdctl run --net=host img', 'docker run $OPTS img', 'docker run -v "$D":/d img',
    'docker exec x ufw disable', 'docker exec x tailscale logout', 'ctr run --privileged img x', 'crictl exec -it c sh', 'machinectl shell root@.host',
    'systemd-nspawn -D /var/lib/machines/x', 'runc exec x sh', 'sudo nsenter -t 1 -a', 'bash -c "chroot / passwd -l bob"'];
  assert.deepEqual(check(HOSTY.map(c => [c]), r => is(r.class === 'notdone' ? 'notdone' : 'lockout', r)), []);
  assert.deepEqual(check(HOSTY.filter(c => !/^sudo/.test(c)).map(c => [c, null, ROOT]), r => is('lockout', r)), []);
  // (one that reaches no further than its own container: risky, as before)
  assert.deepEqual(check(['docker run -d --name x -p 8000:8000 img', 'docker run --rm -v ~/work:/w --gpus all img', 'docker run -e HF_TOKEN="$T" img',
    'docker run --security-opt no-new-privileges img', 'docker logs x', 'docker restart my-app', 'docker run -v /data/models:/m:ro img'].map(c => [c]), r => is('risky', r)), []);
});

// Item 3 (net 7): ssh spark2 '…' from a compute Spark was a plain risky ask with --open; the hub's refusals never applied.
test('a command for Spark 2 from a compute Spark is not done, by any of its names; a host that can\'t be told is the dangerous ask', () => {
  const HUB = ["ssh spark2 'docker run -d --name x img'", "ssh spark2 'pkill -f server.mjs'", "ssh spark2 'docker stop sparkie-main'",
    // (and spellings of our own: its other names and addresses, each program the ruling names, the host behind an option)
    'ssh akspark2 uptime', 'ssh owner@akspark2.tailab9aa9.ts.net uptime', 'ssh owner@100.64.0.2 ls', 'ssh -p 22 spark2 ls', 'scp x spark2:/tmp/',
    'scp spark2:/etc/hosts .', 'rsync -a ~/x/ akspark2:x/', 'rsync -a rsync://spark2/mod/ /tmp/m/', 'sftp spark2', 'git clone spark2:repo',
    'git push ssh://akspark2/home/owner/r.git main', 'docker -H ssh://spark2 ps', 'docker --host=tcp://akspark2:2375 run img', 'DOCKER_HOST=ssh://spark2 docker ps',
    'tailscale ssh spark2 uptime', 'ssh -J spark2 spark3 ls', 'ssh -o HostName=akspark2 spark3 ls', "bash -c 'ssh spark2 reboot'"];
  assert.deepEqual(check(HUB.map(c => [c]), r => is('notdone', r)), []);
  assert.deepEqual(check(HUB.map(c => [c, null, ROOT]), r => is('notdone', r)), []);
  // (where it can't be told: a $, a name ssh's own settings point anywhere, a tailnet address the console doesn't know, a context)
  const MAYBE = ['ssh $H uptime', 'ssh buildbox uptime', 'ssh 100.100.1.1 ls', 'scp "$F" spark3:/tmp/', 'docker --context remote ps', 'DOCKER_HOST=$X docker ps',
    'ssh -F ~/cfg spark3 ls', 'rsync -a x box:/tmp/'];
  assert.deepEqual(check(MAYBE.map(c => [c]), r => (r.class === 'risky' && r.kinds.includes('brain') && /may be Spark 2/.test(r.why) ? null : 'not the dangerous ask saying it may be Spark 2')), []);
  // (another compute Spark, a public host and the local Docker stay as they were; on Spark 2 itself nothing of this applies)
  assert.deepEqual(check(['ssh spark3 uptime', 'scp spark3:~/work/out.json .', 'ssh github.com', 'docker -H unix:///run/docker.sock ps'].map(c => [c]),
    r => (r.class === 'risky' && !r.kinds.includes('brain') ? null : 'changed')), []);
  assert.equal(sort('ssh spark3 uptime', { at: 'hub' }).class, 'risky');
});

// Item 4 (net 8): what the net can't put back was refused only in its plainest spelling.
test('what the net can\'t put back is lasting by any spelling: a Tailscale sign-out or sign-in, a way-in package removed, an inline program that names one', () => {
  const LASTING = ['tailscale --socket /run/tailscale/tailscaled.sock logout', 'echo logout | xargs tailscale', 'tailscale $(echo logout)', 'tailscale up --login-server https://hs.example',
    'tailscale up --authkey=tskey-abc', 'apt-get purge -y openssh-server', 'apt remove tailscale', 'dpkg -P openssh-server', 'dpkg --purge tailscale', 'apt-get autoremove -y',
    "python3 -c \"import os; os.system('tailscale logout')\"",
    // (and spellings of our own: other options first, the verb from elsewhere, other package tools and forms, other interpreters)
    'tailscale --socket=/tmp/s login', 'tailscale switch other', 'tailscale up --force-reauth', 'tailscale up --auth-key=$K', 'tailscale lock sign x', 'tailscale debug x',
    "bash -c 'tailscale logout'", 'T=logout; tailscale $T', 'apt install openssh-server-', 'apt purge "sudo"', 'aptitude remove ufw', 'dpkg -r $P', 'snap remove tailscale',
    'echo openssh-server | xargs apt-get purge -y', 'echo bob | xargs userdel', "node -e \"require('child_process').execSync('userdel bob')\"",
    "perl -e 'system(qw(tailscale logout))'", "python3 -c \"import subprocess; subprocess.run(['apt','purge','-y','openssh-server'])\""];
  assert.deepEqual(check(LASTING.map(c => [c]), r => (r.lasting && ['lockout', 'notdone'].includes(r.class) ? null : 'not lasting')), []);
  assert.deepEqual(check(LASTING.filter(c => !/\$[A-Z]|\$\(/.test(c)).map(c => [c, null, ROOT]), r => (r.lasting ? null : 'not lasting as root')), []);
  // (a lock-out change the net puts back is not lasting; nor is an ordinary package removed)
  assert.deepEqual(check(['tailscale up', 'tailscale down', 'tailscale set --ssh=false', 'snap stop tailscale', 'ufw enable', 'userdel bob', 'apt remove htop', 'dpkg -r htop',
    "perl -e 'system(\"loginctl disable-linger owner\")'", "python3 -c \"import os; os.system('ip link set eth0 down')\""].map(c => [c]), r => (r.lasting ? 'lasting' : null)), []);
  // (a way in named inside an inline program is the lock-out class, never a plain change)
  assert.deepEqual(check(["perl -e 'system(\"loginctl disable-linger owner\")'", "python3 -c \"import os; os.system('ip link set eth0 down')\"",
    "python3 -c \"import os; os.system('systemctl stop ssh')\"", "ruby -e 'system(\"sysctl -w net.ipv4.ip_forward=0\")'"].map(c => [c, null, ROOT]), r => is('lockout', r)), []);
  assert.match(sort('tailscale logout').lasting, /Tailscale logout/);
});
