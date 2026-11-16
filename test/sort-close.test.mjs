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

// Item 5 (net 13): commands that cut a way in were a plain ROOT ask, not the lock-out class.
test('the lock-out class\'s misses: a way-in process killed by name, radios, links, tunnels, firewall sets, init scripts, targets, the clock, and a way in started later by a timer', () => {
  const MISSES = ['pkill sshd', 'killall tailscaled', 'killall5 -9', 'fuser -k 22/tcp', 'rfkill block all', 'networkctl down eth0', 'wg-quick down wg0',
    'iwctl station wlan0 disconnect', 'dhclient -r', 'brctl delbr br0', 'bridge link set dev eth0 state 0', 'ipset flush', 'conntrack -F', 'netfilter-persistent flush',
    'iptables-apply', '/etc/init.d/ssh stop', 'invoke-rc.d ssh stop', 'update-rc.d ssh disable', 'snap stop tailscale', 'systemctl stop systemd-user-sessions',
    'systemctl isolate rescue.target', 'telinit 1', 'systemd-run --on-active=60 ufw enable', "echo 'ufw enable' | at now + 2 min",
    "echo '@reboot root ufw enable' >> /etc/crontab", 'date -s 2020-01-01',
    // (and spellings of our own: by a pattern, by a command line, by a user; other init forms; other timers; other clocks)
    'pkill -f tailscaled', 'pkill ss', 'pkill -f "s.*d"', 'pkill -u owner', 'killall -r ssh', 'pkill $P', 'kill -9 -1', 'skill -KILL -u owner', '/etc/rc2.d/S01ssh stop',
    'init 1', 'systemctl rescue', 'systemctl set-default rescue.target', 'systemd-run --user --on-calendar=daily tailscale logout', "at now + 1 hour <<< 'systemctl stop ssh'",
    "echo 'ip link set eth0 down' | crontab -", "printf '[Service]\\nExecStart=/usr/sbin/ufw enable\\n' > ~/.config/systemd/user/x.service",
    'timedatectl set-time 2020-01-01', 'hwclock --hctosys', 'date --set="2020-01-01"', 'hostnamectl set-hostname x', 'systemctl stop wpa_supplicant', 'wg set wg0 peer x remove'];
  assert.deepEqual(check(MISSES.map(c => [c]), r => is('lockout', r)), []);
  assert.deepEqual(check(MISSES.filter(c => !/\$P/.test(c)).map(c => [c, null, ROOT]), r => is('lockout', r)), []);
  assert.deepEqual(check(['kill 1234', 'kill -9 4321'].map(c => [c, null, ROOT]), r => is('lockout', r)), []);
  // (a way in started later, after the net has kept or put back, or one that stops the net's own timer: lasting)
  assert.deepEqual(check(['systemd-run --on-active=60 ufw enable', "echo 'ufw enable' | at now + 2 min", "echo '@reboot root ufw enable' >> /etc/crontab",
    'systemctl set-default rescue.target', 'systemctl isolate rescue.target', 'telinit 1', "echo 'ip link set eth0 down' | crontab -"].map(c => [c, null, ROOT]), r => (r.lasting ? null : 'not lasting')), []);
  // (what kills or reads nothing of a way in keeps its answer: everyday kills, the read forms, the clock read, a timer for something else)
  assert.deepEqual(check(['pkill python', 'pkill -f train.py', 'pkill -f "python train.py"', 'pkill -f "python.*train"', 'killall vllm', 'kill 1234', 'kill -l', 'fuser 22/tcp',
    'systemctl restart nginx', 'systemd-run --user --wait touch /tmp/x', 'echo hi | at now', 'telinit 6', 'reboot'].map(c => [c]), r => is('risky', r)), []);
  assert.deepEqual(check(['rfkill', 'rfkill list', 'networkctl status', 'wg show', 'ipset list', 'conntrack -L', 'brctl show'].map(c => [c]), r => is('change', r)), []);
  assert.deepEqual(check(['date', 'date +%s', 'systemctl status ssh'].map(c => [c]), r => is('look', r)), []);
});

// Item 6 (net, seen outside): docker stop qwen-recipe-<x> on a compute Spark was an ordinary risky button.
test('a protected container is never stopped or changed by a command, by any spelling; one that can\'t be told is the dangerous ask, saying so', () => {
  const P = { protect: ['qwen-recipe-*'] };
  const NEVER = ['docker stop qwen-recipe-chisel', 'docker kill qwen-recipe-x', 'docker rm -f qwen-recipe-x', 'docker restart qwen-recipe-x', 'docker pause qwen-recipe-x',
    'docker update --restart=no qwen-recipe-x', 'docker stop sparkie-main',
    // (and spellings of our own: the long form, other engines, options first, an exec or a rename, the pattern itself, on Spark 2, as root, inside a shell)
    'docker container stop qwen-recipe-x', 'podman stop qwen-recipe-x', 'nerdctl kill qwen-recipe-x', 'docker stop -t 5 sparkie-main', 'docker exec qwen-recipe-x pkill python',
    'docker rename qwen-recipe-x y', "docker stop 'qwen-recipe-*'", 'docker -H unix:///run/docker.sock stop qwen-recipe-x', "bash -c 'docker stop qwen-recipe-x'"];
  assert.deepEqual(check(NEVER.map(c => [c, null, P]), r => is('notdone', r)), []);
  // (on Spark 2 the hub's own rules refuse it on the kind, in their words, 21-hub.mjs: the sorter marks it brain and asks)
  assert.deepEqual(check(NEVER.map(c => [c, null, { ...P, at: 'hub' }]), r => (['risky', 'notdone'].includes(r.class) && r.kinds.includes('brain') ? null : 'not marked brain on Spark 2')), []);
  assert.deepEqual(check(NEVER.map(c => [c, null, { ...P, root: true }]), r => is('notdone', r)), []);
  // (an id that may be a protected one's prefix, a $, a compose project, every container through the Docker service)
  const MAYBE = ['docker stop 3f2a', 'docker rm -f 0123abcd', 'docker stop $(docker ps -q)', 'docker stop "qwen-recipe-$X"', 'docker compose down', 'docker compose -p x stop',
    'docker-compose down'];
  assert.deepEqual(check(MAYBE.map(c => [c, null, P]), r => (r.class === 'risky' && r.kinds.includes('brain') && /protected container/.test(r.why) ? null : 'not the dangerous ask saying a protected container may be among them')), []);
  assert.deepEqual(check(['systemctl stop docker', 'systemctl restart containerd'].map(c => [c, null, { ...P, root: true }]), r => (r.kinds.includes('brain') ? null : 'no brain kind')), []);
  // (a container of the owner's own that matches nothing: one plain button, as before)
  assert.deepEqual(check(['docker stop my-app', 'docker rm old-job', 'docker restart web'].map(c => [c, null, P]), r => (r.class === 'risky' && !r.kinds.includes('brain') ? null : 'changed')), []);
  // (the console's own list, when the caller gives none)
  assert.equal(sortCommand('docker stop x', {}).class, 'risky');
});

// Item 8 and S-1 (keys, in passing; the sorter's final read): a rewrite in place was deletes: false, so it ran when its
// file could not be copied first.
test('a command that writes over or removes a file\'s old content is marked deletes, and overwrites names what it writes', () => {
  const OVER = ["sed -i 's/a/b/' big.jsonl", "sed -i '1,$d' big.jsonl", 'sed -i d big.jsonl', 'sed --in-place=.bak s/a/b/ big.jsonl', "perl -pi -e 's/a/b/' big.jsonl",
    "ruby -pi -e 'x' big.jsonl", 'sort -o big.jsonl small.txt', 'patch big.jsonl fix.diff', 'rsync -a small.txt big.jsonl', 'scp small.txt big.jsonl',
    'uniq small.txt big.jsonl', 'xxd -r small.hex big.jsonl', '7z x a.7z', 'git apply fix.diff', 'git rm -f big.jsonl', 'git rm -rf data',
    // (and the in-place editors the brief names, and kin of our own)
    'ed big.jsonl', 'ex big.jsonl', 'vim big.jsonl', 'truncate -s 0 big.jsonl', 'echo x | tee big.jsonl', 'echo x > big.jsonl', 'dd if=/dev/zero of=big.jsonl count=1',
    'mv small.txt big.jsonl', 'install small.txt big.jsonl', 'rsync -a --delete src/ dst/', 'tar czf big.tgz src', 'zip -r big.zip src', 'git mv a b', 'cp small.txt big.jsonl',
    "awk -i inplace '{print}' big.jsonl", 'gzip big.jsonl', 'split -l 10 big.jsonl'];
  assert.deepEqual(check(OVER.map(c => [c, null, { dir: '~/work' }]), r => (r.deletes && r.overwrites.length > 0 ? null : `deletes ${r.deletes}, overwrites ${JSON.stringify(r.overwrites)}`)), []);
  // (the file it writes is named, and git rm -r reaches everything under its folder)
  assert.deepEqual(sort("sed -i 's/a/b/' big.jsonl", { dir: '~/work' }).overwrites, ['~/work/big.jsonl']);
  assert.deepEqual(sort('git rm -rf data', { dir: '~/work' }).wide, ['~/work/data']);
  assert.ok(!sort('tar czf ~/b.tgz ~/work/src').overwrites.includes('~/work/src'), 'what tar only reads is not overwritten');
  // (what writes nothing over: no mark, and no list)
  for (const c of ['mkdir x', 'touch y', 'cat a >> b', 'hf download Qwen/Q --local-dir ~/m', 'ls']) assert.deepEqual([c, sort(c).deletes, sort(c).overwrites], [c, false, []]);
});

// S-5 (the sorter's final read): a git kind covered git bisect run rm …; npm audit fix and dedupe got a kind, ran at once
// in a folder the task fetched into, and reached nothing.
test('no kind covers a command that runs another program or fetched code: git bisect run, rebase -x, submodule foreach, npm audit fix, dedupe', () => {
  const NONE = ['git bisect run rm -rf src', 'git bisect run sed -i s/a/b/ x', 'git bisect run cp a b', 'git rebase -x "rm x" main', 'git submodule foreach rm -rf x',
    'git -c core.hooksPath=/tmp/h commit -m x', 'npm audit fix', 'npm audit fix --force', 'npm dedupe', 'npm ddp', 'yarn dedupe', 'npm install', 'bash -c "rm x"'];
  assert.deepEqual(check(NONE.map(c => [c, null, { dir: '~/work' }]), r => (!r.simple && r.program === null ? null : `simple ${r.simple}, program ${r.program}`)), []);
  assert.deepEqual(check(['npm audit fix', 'npm dedupe', 'yarn dedupe', 'npm audit'].map(c => [c, null, { dir: '~/work' }]), r => (r.reach.includes('internet') ? null : 'reaches nothing')), []);
  // (in a folder the task fetched into, an install that runs the project's scripts is asked, as npm install is)
  const W = { dir: '~/work', written: ['~/work/proj'] };
  assert.deepEqual(check(['cd ~/work/proj && npm audit fix', 'cd ~/work/proj && npm dedupe', 'cd ~/work/proj && npm install'].map(c => [c, null, W]), r => is('risky', r)), []);
  // (git's own commands keep their kind)
  for (const c of ['git pull', 'git commit -m x', 'git status']) assert.equal(sort(c, { dir: '~/work' }).program === 'git' || sort(c, { dir: '~/work' }).class === 'look', true, c);
});

// S-14 (the sorter's final read): set -k; git pull GIT_CONFIG_COUNT=0 was a plain change and undid the runner's git settings.
test('set -k, set -o keyword and a shell started with -k are a doubt: a later NAME=value word becomes a setting', () => {
  assert.deepEqual(check(['set -k; git pull GIT_CONFIG_COUNT=0', 'set -k; git commit -m x GIT_CONFIG_COUNT=0', 'set -o keyword; git pull GIT_CONFIG_COUNT=0', 'set -ek; git pull',
    'bash -k -c "git pull GIT_CONFIG_COUNT=0"', 'sh -ek -c "git pull"', 'bash -o keyword -c "git pull"', 'bash -c "set -k; git pull X=1"'].map(c => [c, null, { dir: '~/work' }]), r => is('risky', r)), []);
  assert.deepEqual(check(['set -e; git pull', 'set -eu; make', 'set -o pipefail; make'].map(c => [c, null, { dir: '~/work' }]), r => is('change', r)), []);
});

// The sorter's final read, "smaller": one-liners holding /.* were sorted lock-out ("It names /.*, one of the ways in").
test('a regular expression in a program\'s text is no pattern of dot files: an in-place rewrite is sorted as one; a home\'s pattern still counts', () => {
  assert.deepEqual(check(["perl -pi -e 's/.*//' f", "sed -i 's/.*//' f", "python3 -c \"import re; re.sub(r'/.*', '', x)\"", "python3 -c \"import glob; glob.glob('src/.*')\"",
    "awk '{ sub(/.*/, \"\"); print > \"out\" }' f", "perl -pi -e 's/^.+$//' notes.txt"].map(c => [c, null, { dir: '~/work' }]), r => is('change', r)), []);
  assert.equal(sort("perl -pi -e 's/.*//' f", { dir: '~/work' }).deletes, true);
  assert.deepEqual(check(["python3 -c \"import glob,os; [os.remove(f) for f in glob.glob(os.path.expanduser('~/.*'))]\"", 'rm -rf ~/.*',
    "python3 -c \"open('/home/owner/.bashrc','w')\""].map(c => [c, null, { dir: '~/work', home: '/home/owner' }]), r => is('lockout', r)), []);
});
