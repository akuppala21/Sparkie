// Covers: Which Spark is the hub, for the scripts under `deploy/`: one source, `deploy/hub.env` (read by `deploy/hub.sh`),
// where Spark 1 is the hub, and `service/config.json` saying the same. The installer's default target is the hub, and it
// refuses another Spark, a target it doesn't know and a build whose two lists disagree; its far half refuses a build
// whose hub isn't the one the console installed there runs as. `power-setup.sh` refuses the hub by every name and sets
// up Spark 2, and its `--undo` reaches the hub directly; `power-check.sh` looks at every compute Spark through the hub;
// `plugs.sh` keeps the hub's plug read-only (pair and name), never as another Spark's, and runs only on the hub;
// `root-for-sparkie.sh` from the Mac runs the hub's installed copy; `open-to-internet.sh` never touches port 443;
// `cutover.sh` on a hub with no portal only adds the :8443/ route;
// `copy-hub-state.sh` copies the hub's files but the sign-ins, moves aside what was there, tells the copied `main.json`
// its new hub (and back), and refuses while a console runs or with no Node.js where it goes; no file under `deploy/` names a Spark outside `hub.env`. Starts no stand-in fleet: each script runs against
// stand-ins for ssh, docker, tailscale, systemctl and curl in a made-up home.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, statSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import http from 'node:http';
import { REPO, SLOW } from './lib.mjs';

const DEPLOY = join(REPO, 'deploy');
const HUB_ENV = readFileSync(join(DEPLOY, 'hub.env'), 'utf8');
const val = (text, k) => (new RegExp(`^${k}=(.*)$`, 'm').exec(text) || [])[1];
const SPARKS = { spark1: '100.119.233.101', spark2: '100.79.155.126', spark3: '100.122.49.9', spark4: '100.109.240.15' };
const S1 = `akuppala@${SPARKS.spark1}`;
const NOT_YET = [];
const TIMEOUT = 60000 * SLOW;
const dirs = [];
const tmp = prefix => { const d = mkdtempSync(join(tmpdir(), prefix)); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const sh = (file, text) => writeFileSync(file, text, { mode: 0o755 });
const lines = file => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : []);
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
// A config.json that says what hub.env says (the hub local, the others at their addresses).
const configOf = hub => ({ port: 8810, origin: `https://${val(hub, 'HUB_NAME')}.${val(hub, 'TAILNET')}:8443`, user: val(hub, 'LOGIN'),
  nodes: Object.keys(SPARKS).filter(s => val(hub, s)).map(s => ({ id: s, host: s === val(hub, 'HUB') ? 'local' : val(hub, s) })) });

describe('deploy/hub.env, the one source', () => {
  test('Spark 1 is the hub; each Spark is one line, and one line of sed reads Spark 3’s or Spark 4’s address', () => {
    assert.deepEqual(['HUB', 'HUB_NAME', 'LOGIN', 'TAILNET'].map(k => val(HUB_ENV, k)), ['spark1', 'akspark1', 'akuppala', 'tailab9aa9.ts.net']);
    for (const [s, a] of Object.entries(SPARKS)) assert.equal(val(HUB_ENV, s), a, s);
    for (const s of ['spark3', 'spark4']) {
      const r = spawnSync('sed', ['-n', `s/^${s}=//p`, join(DEPLOY, 'hub.env')], { encoding: 'utf8', timeout: TIMEOUT });
      assert.equal(r.stdout, `${SPARKS[s]}\n`);
    }
    const r = spawnSync('bash', ['-c', `set -euo pipefail; . ${JSON.stringify(join(DEPLOY, 'hub.sh'))}
echo "$HUB|$HUB_SAYS|$HUB_N|$HUB_HOST|$HUB_URL|$COMPUTE|$(spark_of akuppala@${SPARKS.spark2})|$(spark_of akspark1.tailab9aa9.ts.net)|$(spark_of 4)"`], { encoding: 'utf8', timeout: TIMEOUT });
    assert.equal(r.stdout.trim(), `spark1|Spark 1|1|${S1}|https://akspark1.tailab9aa9.ts.net:8443|spark2 spark3 spark4|spark2|spark1|spark4`, r.stderr);
  });

  test('service/config.json names the same hub (its Spark with host "local"), login, address and Sparks', () => {
    const c = readJson(join(REPO, 'service', 'config.json')), want = configOf(HUB_ENV);
    assert.deepEqual(c.nodes.map(n => ({ id: n.id, host: n.host })), want.nodes);
    assert.equal(c.user, want.user);
    assert.equal(String(c.origin).replace(/\/$/, ''), want.origin);
  });

  test('no file under deploy/ holds a Spark’s address, its Tailscale name or the words “Spark 2”, but hub.env', () => {
    // (each Spark's own address; Tailscale's fixed ones, 100.64.0.0/10 and 100.100.100.100, are no Spark's)
    const NAMED = new RegExp(['akspark\\d', '\\bSpark 2\\b', '\\bSPARK2\\b', ...Object.values(SPARKS).map(a => `\\b${a.replaceAll('.', '\\.')}\\b`)].join('|'));
    for (const f of readdirSync(DEPLOY)) {
      if (f === 'hub.env' || NOT_YET.includes(f)) continue;
      readFileSync(join(DEPLOY, f), 'utf8').split('\n').forEach((l, i) => {
        assert.doesNotMatch(l, NAMED, `deploy/${f}:${i + 1}`);
      });
    }
  });
});

describe('the installer goes to the hub only', () => {
  // A made-up tree with the installer, hub.sh, a hub.env and a config.json: it stops right after the hub checks, at
  // "service/server.mjs doesn't match", so a run that gets there passed them. ssh is a stand-in that is never reached.
  const tree = ({ hub = HUB_ENV, config = configOf(HUB_ENV), withHub = true } = {}) => {
    const root = tmp('shd-tree-');
    for (const d of ['deploy', 'service', 'bin']) mkdirSync(join(root, d));
    for (const f of ['host-on-portal.sh', 'hub.sh']) copyFileSync(join(DEPLOY, f), join(root, 'deploy', f));
    if (withHub) writeFileSync(join(root, 'deploy', 'hub.env'), hub);
    writeFileSync(join(root, 'service', 'config.json'), JSON.stringify(config));
    sh(join(root, 'bin', 'ssh'), '#!/bin/sh\necho "ssh $*" >> "$HOME/ssh.log"\nexit 97\n');
    return root;
  };
  const install = (root, args = []) => spawnSync('bash', [join(root, 'deploy', 'host-on-portal.sh'), ...args],
    { env: { PATH: `${join(root, 'bin')}:${process.env.PATH}`, HOME: root }, encoding: 'utf8', timeout: TIMEOUT });
  const PAST = /service\/server\.mjs doesn't match service\/src/;

  test('with no target it installs onto Spark 1, the hub; Spark 1 by any of its names goes on too', () => {
    const root = tree();
    for (const args of [[], [S1], [SPARKS.spark1], ['akspark1'], ['akspark1.tailab9aa9.ts.net']]) {
      const r = install(root, args);
      assert.equal(r.status, 1, `${args}: ${r.stdout}${r.stderr}`);
      assert.match(r.stdout, new RegExp(`^Installing onto Spark 1 \\((${args[0] || S1}).*\\), the hub\\.$`, 'm'));
      assert.match(r.stderr, PAST, 'it got past the hub checks');
    }
    assert.ok(!existsSync(join(root, 'ssh.log')));
  });

  test('Spark 2, by any of its names, is refused before anything is sent, saying why; so is a target hub.env doesn’t name', () => {
    const root = tree();
    for (const t of [`akuppala@${SPARKS.spark2}`, SPARKS.spark2, 'akspark2', 'akspark2.tailab9aa9.ts.net', 'spark2']) {
      const r = install(root, [t]);
      assert.equal(r.status, 2, `${t}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, new RegExp(`^Stopped: ${t.replace(/[.]/g, '\\.')} is Spark 2, and this build runs Spark Console on Spark 1, the hub .*Installed on Spark 2, it would take that Spark for Spark 1\\. To install it on the hub: bash .* \\(or ${S1.replace(/[.]/g, '\\.')}\\)\\. Nothing was changed\\.$`, 'm'));
      assert.doesNotMatch(r.stderr, PAST);
    }
    const r = install(root, ['someone@10.0.0.9']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /^Stopped: someone@10\.0\.0\.9 isn't one of the Sparks in deploy\/hub\.env, so it can't be told to be Spark 1/m);
    assert.ok(!existsSync(join(root, 'ssh.log')), 'nothing was sent');
  });

  test('a build whose hub.env and config.json disagree is refused, whichever target; on the hub itself (local) only config.json counts', () => {
    // (config.json as it was before the move: Spark 2 the hub)
    const before = { ...configOf(HUB_ENV), origin: 'https://akspark2.tailab9aa9.ts.net:8443',
      nodes: [{ id: 'spark1', host: SPARKS.spark1 }, { id: 'spark2', host: 'local' }, { id: 'spark3', host: SPARKS.spark3 }, { id: 'spark4', host: SPARKS.spark4 }] };
    for (const args of [[], [S1]]) {
      const r = install(tree({ config: before }), args);
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /^Stopped: this build's two lists of the Sparks disagree: hub\.env makes spark1 the hub, but config\.json has it at 100\.119\.233\.101; spark2 is at 100\.79\.155\.126 in hub\.env and local in config\.json; the address is https:\/\/akspark2\.tailab9aa9\.ts\.net:8443 in config\.json and https:\/\/akspark1\.tailab9aa9\.ts\.net:8443 in hub\.env\./m);
    }
    const r = install(tree({ config: { ...configOf(HUB_ENV), user: 'someone' } }));
    assert.match(r.stderr, /the login is someone in config\.json and akuppala in hub\.env/);
    const none = install(tree({ config: { ...configOf(HUB_ENV), nodes: [] } }));
    assert.equal(none.status, 2);
    assert.match(none.stderr, /names no one Spark with host "local"/);
    // local: what pull.sh runs on the hub; hub.env isn't read (the far half's own check is below)
    const l = install(tree({ withHub: false }), ['local']);
    assert.equal(l.status, 1, l.stdout + l.stderr);
    assert.match(l.stderr, PAST);
  });
});

describe('the installer’s half on the hub refuses a build whose hub isn’t the one installed there', () => {
  const INSTALLER = readFileSync(join(DEPLOY, 'host-on-portal.sh'), 'utf8');
  const a = INSTALLER.indexOf("<<'REMOTE'\n"), b = INSTALLER.indexOf('\nREMOTE\n', a);
  const INSTALL_SH = INSTALLER.slice(a + "<<'REMOTE'\n".length, b + 1);
  const home = (incoming, installed) => {
    const h = tmp('shd-far-'), IN = join(h, 'in');
    mkdirSync(join(IN, 'service'), { recursive: true });
    mkdirSync(join(h, 'bin'));
    writeFileSync(join(IN, 'install.sh'), INSTALL_SH);
    copyFileSync(join(DEPLOY, 'path-check.sh'), join(IN, 'path-check.sh'));
    writeFileSync(join(IN, 'service', 'config.json'), JSON.stringify({ nodes: [{ id: incoming, host: 'local' }], user: 'x' }));
    if (installed) {
      mkdirSync(join(h, 'spark-console-service'));
      writeFileSync(join(h, 'spark-console-service', 'config.json'), JSON.stringify({ nodes: [{ id: installed, host: 'local' }], user: 'x' }));
    }
    for (const f of ['systemctl', 'ssh', 'sudo', 'tailscale', 'systemd-run']) sh(join(h, 'bin', f), `#!/bin/sh\necho "${f} $*" >> "$HOME/never-called.log"\nexit 97\n`);
    return h;
  };
  const run = (h, args) => spawnSync('bash', [join(h, 'in', 'install.sh'), ...args, '--stand-in'], { encoding: 'utf8', timeout: TIMEOUT,
    env: { HOME: h, USER: 'standin', LANG: 'C.UTF-8', PATH: `${join(h, 'bin')}:${dirname(process.execPath)}:${process.env.PATH}` } });

  test('the console here runs as Spark 2 and the build’s hub is Spark 1: check and install are refused, nothing changes', () => {
    const h = home('spark1', 'spark2');
    const refused = /STOP: Spark Console runs here as Spark 2 \(its installed config\.json\), and this build runs it on Spark 1, the hub\. Installed here, it would take this Spark for Spark 1\. Install it on Spark 1 instead\. Nothing was changed\./;
    const c = run(h, ['check']);
    assert.equal(c.status, 1, c.stdout + c.stderr);
    assert.match(c.stderr, refused);
    assert.doesNotMatch(c.stdout, /^busy /m);
    const i = run(h, ['install', '20261116T000000Z', 'abcdefabcdef', 'local']);
    assert.equal(i.status, 1, i.stdout + i.stderr);
    assert.match(i.stderr, refused);
    assert.deepEqual([existsSync(join(h, '.local', 'share', 'spark-console')), existsSync(join(h, 'spark-console')), lines(join(h, 'never-called.log'))], [false, false, []]);
  });

  test('the same hub, or nothing installed yet (the new hub’s first install), goes on', () => {
    for (const installed of ['spark1', null]) {
      const r = run(home('spark1', installed), ['check']);
      assert.equal(r.status, 0, `${installed}: ${r.stdout}${r.stderr}`);
      assert.match(r.stdout, /^busy /m);
    }
  });
});

describe('power-setup.sh and power-check.sh follow the hub', () => {
  // A stand-in ssh: notes each call, gives a machine id, keeps the script sent for the far side; never connects.
  const bin = () => {
    const d = tmp('shd-power-');
    sh(join(d, 'ssh'), `#!/bin/bash\nprintf '%s\\n' "$*" >> "$HOME/ssh.log"\ncase "$*" in *machine-id*) echo 0123abcd ;; *'cat >'*) cat >> "$HOME/sent.sh" ;; *) cat > /dev/null ;; esac\nexit 0\n`);
    return d;
  };
  const run = (d, script, args) => spawnSync('bash', [join(DEPLOY, script), ...args], { env: { PATH: `${d}:${process.env.PATH}`, HOME: d }, encoding: 'utf8', timeout: TIMEOUT });

  test('power-setup.sh refuses Spark 1, the hub, by its number, id, address, name or as localhost, before it connects', () => {
    const d = bin();
    for (const t of ['1', 'spark1', SPARKS.spark1, S1, 'akspark1', 'akspark1.tailab9aa9.ts.net', 'localhost']) {
      const r = run(d, 'power-setup.sh', [SPARKS.spark3, t]);
      assert.equal(r.status, 2, `${t}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, new RegExp(`^Refused: ${t.replace(/[.]/g, '\\.')} is Spark 1\\. It runs Spark Console and Sparkie and is never set up to shut down\\.$`, 'm'));
    }
    assert.deepEqual(lines(join(d, 'ssh.log')), [], 'it never connected');
  });

  test('power-setup.sh sets Spark 2 up through Spark 1, whose machine id the far side refuses; with no Spark named, all three compute Sparks', () => {
    for (const t of ['2', SPARKS.spark2]) {
      const d = bin(), r = run(d, 'power-setup.sh', [t]);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.deepEqual(lines(join(d, 'ssh.log')), [`${S1} cat /etc/machine-id`,
        `${S1} ssh -o ConnectTimeout=8 ${SPARKS.spark2} 'mkdir -p ~/.cache/spark-console && cat > ~/.cache/spark-console/power-setup-remote.sh'`,
        `-t ${S1} ssh -t -o ConnectTimeout=8 ${SPARKS.spark2} 'bash ~/.cache/spark-console/power-setup-remote.sh 0'`]);
      assert.match(readFileSync(join(d, 'sent.sh'), 'utf8'), /^HUB_ID='0123abcd'\n\[ "\$\(cat \/etc\/machine-id 2>\/dev\/null\)" = "\$HUB_ID" \] && \{ echo 'Refused: this is Spark 1\./);
      assert.match(r.stdout, /Setting up 100\.79\.155\.126 \(through Spark 1\)/);
    }
    const d = bin(), r = run(d, 'power-setup.sh', []);
    assert.equal(r.status, 0, r.stderr);
    const hops = lines(join(d, 'ssh.log')).map(l => / ssh -t? ?-o ConnectTimeout=8 (\S+) /.exec(l)?.[1]).filter(Boolean);
    assert.deepEqual([...new Set(hops)], [SPARKS.spark2, SPARKS.spark3, SPARKS.spark4]);
  });

  test('power-setup.sh --undo 1 takes the rule off Spark 1 straight from here, with the plain undo script; --undo alone, the compute Sparks', () => {
    const d = bin(), r = run(d, 'power-setup.sh', ['--undo', '1']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(lines(join(d, 'ssh.log')), [`${S1} mkdir -p ~/.cache/spark-console && cat > ~/.cache/spark-console/power-setup-remote.sh`,
      `-t ${S1} bash ~/.cache/spark-console/power-setup-remote.sh 1`]);
    assert.match(readFileSync(join(d, 'sent.sh'), 'utf8'), /^UNDO="\$1"\n/);
    const all = bin(), u = run(all, 'power-setup.sh', ['--undo']);
    assert.equal(u.status, 0, u.stderr);
    const hops = lines(join(all, 'ssh.log')).map(l => / ssh -t? ?-o ConnectTimeout=8 (\S+) /.exec(l)?.[1]).filter(Boolean);
    assert.deepEqual([...new Set(hops)], [SPARKS.spark2, SPARKS.spark3, SPARKS.spark4]);
  });

  test('power-check.sh looks at Spark 1, then from it at the three compute Sparks, and names them', () => {
    const d = bin(), r = run(d, 'power-check.sh', []);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(lines(join(d, 'ssh.log')), [`-o ConnectTimeout=10 ${S1} bash -s`,
      ...[SPARKS.spark2, SPARKS.spark3, SPARKS.spark4].map(a => `-o ConnectTimeout=10 ${S1} ssh -o BatchMode=yes -o ConnectTimeout=8 ${a} 'bash -s'`)]);
    assert.match(r.stdout, /^Checking from Spark 1, the hub \(akuppala@100\.119\.233\.101\), then from there on the compute Sparks: Spark 2, Spark 3, Spark 4 …$/m);
  });
});

// A stand-in ssh for the scripts that send their far half and run it: options and the control connection are passed
// over, and the command runs here, in the made-up home.
const LOCAL_SSH = `#!/bin/bash
while [ $# -gt 0 ]; do case "$1" in -o) shift 2 ;; -O|-fN) exit 0 ;; -t) shift ;; *) break ;; esac; done
echo "$1" >> "$HOME/ssh-hosts.log"; shift
exec bash -c "$*"
`;

describe('plugs.sh keeps the hub’s plug read-only, and runs only on the hub', () => {
  // A stand-in docker: the controller is running and up to date; `docker exec … node -e <helper> <command> <args>`
  // answers as the Matter controller does, from ctl.json, and notes each command. Every plug's access list holds this
  // controller with Administer; an "on" is refused for access (status 126), as a read-only plug does.
  const DOCKER = `#!/usr/bin/env node
const fs = require('fs'), H = process.env.HOME, a = process.argv.slice(2);
if (a[0] === 'inspect') { console.log(a[a.indexOf('-f') + 1].includes('State.Running') ? 'true' : '2'); process.exit(0); }
if (a[0] !== 'exec') { fs.appendFileSync(H + '/docker.log', JSON.stringify({ cmd: a[0] }) + '\\n'); process.exit(0); }
const [cmd, argsJson] = a.slice(6), args = argsJson ? JSON.parse(argsJson) : {};
fs.appendFileSync(H + '/docker.log', JSON.stringify({ cmd, args }) + '\\n');
const ctl = JSON.parse(fs.readFileSync(H + '/ctl.json', 'utf8'));
const mac = id => Buffer.from(ctl.macs[id].split('-').map(x => parseInt(x, 16))).toString('base64');
const node = id => ({ node_id: id, available: true, attributes: { '0/51/0': [{ 4: mac(id) }], '0/62/5': 1, '0/31/0': [{ 1: 5, 2: 2, 3: [112233], 254: 1 }], '1/6/0': true, '1/144/8': 40000 } });
switch (cmd) {
  case 'commission': fs.readFileSync(0); console.log(JSON.stringify({ node_id: ctl.next })); break;
  case 'get_node': console.log(JSON.stringify(node(args.node_id))); break;
  case 'nodes': console.log(JSON.stringify(Object.keys(ctl.macs).map(Number).map(node))); break;
  case 'set_acl_entry': console.log('[{"status":0}]'); break;
  case 'device_command': console.log(JSON.stringify({ refused: true, error_code: 1, details: 'UnsupportedAccess', status: 126 })); process.exit(1);
  case 'remove_node': console.log('null'); break;
  default: process.exit(3);
}
`;
  const MAC = { 4: '58-D8-12-C2-00-01', 2: '58-D8-12-C2-00-03', 9: '58-D8-12-C2-00-09' };
  const home = ({ plugs, installedAs = 'spark1', macs = MAC }) => {
    const h = tmp('shd-plugs-'), st = join(h, '.local', 'state', 'spark-console');
    mkdirSync(join(h, 'bin')); mkdirSync(st, { recursive: true }); mkdirSync(join(h, 'spark-console-service'));
    sh(join(h, 'bin', 'ssh'), LOCAL_SSH);
    sh(join(h, 'bin', 'docker'), DOCKER);
    writeFileSync(join(h, 'ctl.json'), JSON.stringify({ macs, next: 9 }));
    writeFileSync(join(h, 'spark-console-service', 'config.json'), JSON.stringify({ nodes: [{ id: installedAs, host: 'local' }], user: 'x' }));
    writeFileSync(join(st, 'plugs.json'), JSON.stringify(plugs));
    return h;
  };
  const plugsSh = (h, args, input = '') => spawnSync('bash', [join(DEPLOY, 'plugs.sh'), ...args], { input, encoding: 'utf8', timeout: TIMEOUT,
    env: { PATH: `${join(h, 'bin')}:${process.env.PATH}`, HOME: h } });
  const plugsJson = h => readJson(join(h, '.local', 'state', 'spark-console', 'plugs.json'));
  const sent = h => lines(join(h, 'docker.log')).map(l => JSON.parse(l));
  const aclTo = (h, node) => sent(h).filter(c => c.cmd === 'set_acl_entry' && c.args.node_id === node).map(c => c.args.entry.map(e => e.privilege));

  test('name <p> 1: Spark 1’s plug, paired with full rights before it became the hub, is lowered to View and proven, then kept read-only', () => {
    const h = home({ plugs: { spark1: { node: 4, mac: MAC[4] }, spark3: { node: 2 } } });
    const r = plugsSh(h, ['name', '4', '1']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(aclTo(h, 4), [[1]], 'its own rights lowered to View');
    assert.ok(sent(h).some(c => c.cmd === 'device_command' && c.args.node_id === 4 && c.args.command_name === 'on'), 'the proof: an "on" refused');
    assert.deepEqual(plugsJson(h), { spark1: { node: 4, readOnly: true, mac: MAC[4] }, spark3: { node: 2 } });
    assert.match(r.stdout, /Spark 1's plug is read-only here/);
    assert.match(r.stdout, /plug 4: Spark 1 \(read-only\)/);
    assert.deepEqual(lines(join(h, 'ssh-hosts.log')), [S1, S1], 'it went to the hub');
  });

  test('pair 1 pairs the hub’s plug read-only, proven; the status line flags a hub plug that isn’t', () => {
    const h = home({ plugs: { spark3: { node: 2 } } });
    const r = plugsSh(h, ['pair', '1'], '12345678901\n');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(aclTo(h, 9), [[1]]);
    assert.deepEqual(plugsJson(h).spark1, { node: 9, readOnly: true, mac: MAC[9] });
    const s = home({ plugs: { spark1: { node: 4, mac: MAC[4] } } }), st = plugsSh(s, ['status']);
    assert.equal(st.status, 0, st.stderr);
    assert.match(st.stdout, /plug 4: Spark 1 \(the hub's, NOT read-only yet: plugs\.sh name 4 1\)/);
  });

  test('the hub’s plug is never kept as another Spark’s: pair 3 with its MAC is unpaired again, name with its node is refused', () => {
    const h = home({ plugs: { spark1: { node: 4, readOnly: true, mac: MAC[9] } } });
    const r = plugsSh(h, ['pair', '3'], '12345678901\n');
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /That's the hub's plug \(Spark 1's, MAC 58-D8-12-C2-00-09\)\. It's only ever kept read-only, by: bash spark-console\/deploy\/plugs\.sh pair 1/);
    assert.ok(sent(h).some(c => c.cmd === 'remove_node' && c.args.node_id === 9), 'unpaired again');
    assert.deepEqual(plugsJson(h), { spark1: { node: 4, readOnly: true, mac: MAC[9] } });
    const n = home({ plugs: { spark1: { node: 4, readOnly: true, mac: MAC[4] } } }), x = plugsSh(n, ['name', '4', '3']);
    assert.equal(x.status, 2, x.stdout + x.stderr);
    assert.match(x.stderr, /Plug 4 is the hub's \(Spark 1's\), which stays read-only\./);
    assert.deepEqual([plugsJson(n), aclTo(n, 4)], [{ spark1: { node: 4, readOnly: true, mac: MAC[4] } }, []]);
  });

  test('on a Spark whose installed console isn’t the hub’s it stops before the controller is asked anything; a Spark hub.env doesn’t name is refused', () => {
    for (const [args, input] of [[['status']], [['pair', '1'], '12345678901\n'], [['name', '4', '1']], [['install']]]) {
      const h = home({ plugs: {}, installedAs: 'spark2' }), r = plugsSh(h, args, input);
      assert.equal(r.status, 2, `${args}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /Stopped: the plug controller runs only on the hub, Spark 1, and Spark Console here runs as Spark 2\. Nothing was changed\./);
      assert.deepEqual(sent(h), []);
    }
    const h = home({ plugs: {} }), r = plugsSh(h, ['pair', '5'], '12345678901\n');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Say which Spark the plug is on, by its number: pair <n> \(deploy\/hub\.env: spark1 spark2 spark3 spark4\)\./);
    assert.ok(!existsSync(join(h, 'ssh-hosts.log')));
  });
});

describe('root-for-sparkie.sh from the Mac goes to the hub', () => {
  test('it runs Spark 1’s installed copy at the hub’s address; --with-root --hub is refused for Spark 1 before anything', () => {
    const h = tmp('shd-root-');
    mkdirSync(join(h, 'bin'));
    sh(join(h, 'bin', 'ssh'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$HOME/ssh.log"\nexit 0\n');
    const run = args => spawnSync('bash', [join(DEPLOY, 'root-for-sparkie.sh'), ...args], { env: { PATH: `${join(h, 'bin')}:${process.env.PATH}`, HOME: h }, cwd: h, encoding: 'utf8', timeout: TIMEOUT });
    const r = run(['--check', '3']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^Running Spark 1's installed copy \(akuppala@100\.119\.233\.101\), so what goes on the Spark is the installed build's\.$/m);
    assert.deepEqual(lines(join(h, 'ssh.log')), [`-t ${S1} bash ~/spark-console-src/deploy/root-for-sparkie.sh --check 3`]);
    const w = run(['--with-root', '--hub', '1']);
    assert.equal(w.status, 2);
    assert.match(w.stderr, /^Stopped: root is never turned on on Spark 1, the hub: /);
    assert.equal(lines(join(h, 'ssh.log')).length, 1, 'nothing more was sent');
  });
});

describe('open-to-internet.sh and cutover.sh on the hub', () => {
  // A stand-in tailscale keeping a serve config as tailscaled does: port 443 already serves something else, with
  // Funnel on (as Spark 1's does), and 8443 holds Spark Console's three routes. Every call is noted.
  const TAILSCALE = `#!/usr/bin/env node
const fs = require('fs'), H = process.env.HOME, f = H + '/serve.json', a = process.argv.slice(2), hp = p => 'akspark1.tailab9aa9.ts.net:' + p;
fs.appendFileSync(H + '/calls', a.join(' ') + '\\n');
const cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
if (a[1] === 'status') {
  if (a[2] === '--json') { console.log(JSON.stringify(cfg)); process.exit(0); }
  for (const [k, v] of Object.entries(cfg.Web || {})) {
    console.log('https://' + k + (a[0] === 'funnel' ? (cfg.AllowFunnel?.[k] ? ' (Funnel on)' : ' (tailnet only)') : ''));
    if (a[0] === 'serve') for (const [p, h] of Object.entries(v.Handlers)) console.log('|-- ' + p + ' ' + (h.Path ? 'path  ' + h.Path : 'proxy ' + h.Proxy));
  }
  process.exit(0);
}
const port = (a.find(x => x.startsWith('--https=')) || '').slice(8), path = (a.find(x => x.startsWith('--set-path=')) || '').slice(11), to = a[a.length - 1];
if (!port || !path || to === 'off') process.exit(1);
for (const k of ['TCP', 'Web', 'AllowFunnel']) cfg[k] ||= {};
cfg.TCP[port] = { HTTPS: true };
const p = path === '/console' ? '/console/' : path;
cfg.Web[hp(port)] = { Handlers: { ...(cfg.Web[hp(port)]?.Handlers || {}), [p]: to.startsWith('/') ? { Path: to } : { Proxy: to } } };
if (a[0] === 'funnel') cfg.AllowFunnel[hp(port)] = true; else delete cfg.AllowFunnel[hp(port)];
fs.writeFileSync(f, JSON.stringify(cfg));
`;
  const PORT443 = { Handlers: { '/': { Proxy: 'http://127.0.0.1:3000' } } };
  const setup = routes => {
    const h = mkdtempSync('/tmp/shd-'), st = join(h, '.local', 'state', 'spark-console');
    dirs.push(h);
    mkdirSync(join(h, 'bin')); mkdirSync(st, { recursive: true }); mkdirSync(join(h, 'spark-console'));
    sh(join(h, 'bin', 'ssh'), LOCAL_SSH);
    sh(join(h, 'bin', 'tailscale'), TAILSCALE);
    sh(join(h, 'bin', 'sudo'), '#!/bin/sh\necho "sudo $*" >> "$HOME/calls"\nexit 1\n');
    writeFileSync(join(h, 'serve.json'), JSON.stringify({ TCP: { 443: { HTTPS: true }, 8443: { HTTPS: true } },
      Web: { 'akspark1.tailab9aa9.ts.net:443': PORT443, 'akspark1.tailab9aa9.ts.net:8443': { Handlers: routes(h) } },
      AllowFunnel: { 'akspark1.tailab9aa9.ts.net:443': true } }));
    return h;
  };
  const cfgOf = h => readJson(join(h, 'serve.json'));
  const writes = h => lines(join(h, 'calls')).filter(c => !/^(serve|funnel) status/.test(c));
  const spawnIn = (h, script, args) => new Promise((resolve, reject) => {
    const c = spawn('bash', [join(DEPLOY, script), ...args], { env: { PATH: `${join(h, 'bin')}:${process.env.PATH}`, HOME: h }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const limit = setTimeout(() => { c.kill('SIGKILL'); reject(new Error(`${script} ${args.join(' ')} didn't end within ${TIMEOUT} ms: ${out}${err}`)); }, TIMEOUT);
    c.stdout.on('data', d => { out += d; });
    c.stderr.on('data', d => { err += d; });
    c.on('close', status => { clearTimeout(limit); resolve({ status, out, err }); });
  });

  test('open-to-internet.sh, open and --undo, switches only 8443’s Funnel: no command names port 443, and 443 is as it was', async () => {
    const sock = h => join(h, '.local', 'state', 'spark-console', 'api.sock');
    const h = setup(x => ({ '/': { Path: join(x, 'spark-console') }, '/console/': { Path: join(x, 'spark-console') }, '/console/api': { Proxy: `unix:${sock(x)}` } }));
    const server = http.createServer((req, res) => res.end('{"signin":true,"access":"public"}'));
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(sock(h), resolve); });
    try {
      const o = await spawnIn(h, 'open-to-internet.sh', []);
      assert.equal(o.status, 0, o.out + o.err);
      assert.deepEqual(writes(h), [`funnel --bg --https=8443 --set-path=/console/api unix:${sock(h)}`]);
      assert.equal(cfgOf(h).AllowFunnel['akspark1.tailab9aa9.ts.net:8443'], true);
      assert.match(o.out, /Spark Console is open to the internet at https:\/\/akspark1\.tailab9aa9\.ts\.net:8443\//);
      const u = await spawnIn(h, 'open-to-internet.sh', ['--undo']);
      assert.equal(u.status, 0, u.out + u.err);
      assert.deepEqual(writes(h).slice(1), [`serve --bg --https=8443 --set-path=/console/api unix:${sock(h)}`]);
      assert.equal(cfgOf(h).AllowFunnel['akspark1.tailab9aa9.ts.net:8443'], undefined);
      for (const c of lines(join(h, 'calls')).map(x => x.replace(sock(h), '<socket>'))) assert.doesNotMatch(c, /(^|[^0-9])443([^0-9]|$)|\boff\b|^sudo/, c);
      assert.deepEqual([cfgOf(h).TCP[443], cfgOf(h).Web['akspark1.tailab9aa9.ts.net:443'], cfgOf(h).AllowFunnel['akspark1.tailab9aa9.ts.net:443']], [{ HTTPS: true }, PORT443, true]);
    } finally { await new Promise(resolve => server.close(resolve)); }
  });

  test('cutover.sh on a hub that never ran the portal adds the :8443/ route only and switches nothing off; --rollback refuses there', async () => {
    const h = setup(x => ({ '/console/': { Path: join(x, 'spark-console') }, '/console/api': { Proxy: `unix:${join(x, '.local/state/spark-console/api.sock')}` } }));
    writeFileSync(join(h, '.local', 'state', 'spark-console', 'access.json'), '{"ownerLogin":"owner@test"}');
    writeFileSync(join(h, 'spark-console', 'app.js'), "const CONSOLE_API = '/console/api/';\n");
    sh(join(h, 'bin', 'systemctl'), '#!/bin/sh\necho "systemctl $*" >> "$HOME/calls"\ncase "$*" in *is-active*) echo inactive; exit 3 ;; esac\nexit 1\n');
    // (the answers the checks from the Mac look for: the page at :8443/, its API, no portal API, 443 answering)
    sh(join(h, 'bin', 'curl'), `#!/bin/bash
u="\${@: -1}"
case "$*" in *%{http_code}*) case "$u" in */api/bootstrap) [[ $u == */console/api/bootstrap ]] && echo 200 || echo 404 ;; *) echo 200 ;; esac ;;
  *) echo '<title>Spark Console</title>' ;; esac
`);
    const r = await spawnIn(h, 'cutover.sh', []);
    assert.equal(r.status, 0, r.out + r.err);
    assert.deepEqual(writes(h).filter(c => !c.startsWith('systemctl')), [`serve --bg --https=8443 --set-path=/ ${join(h, 'spark-console')}`]);
    assert.deepEqual(writes(h).filter(c => c.startsWith('systemctl')).filter(c => !/ (cat|is-active) /.test(c)), [], 'nothing switched off');
    assert.match(r.out, /There's no portal on this Spark, so there's nothing to switch off\./);
    assert.match(r.out, /Done: https:\/\/akspark1\.tailab9aa9\.ts\.net:8443\/ is Spark Console\./);
    const n = writes(h).length, b = await spawnIn(h, 'cutover.sh', ['--rollback']);
    assert.notEqual(b.status, 0);
    assert.match(b.err, /There's no portal on this Spark to put back/);
    assert.deepEqual(writes(h).slice(n).filter(c => !c.startsWith('systemctl')), []);
    assert.deepEqual(cfgOf(h).Web['akspark1.tailab9aa9.ts.net:443'], PORT443);
  });
});

describe('copy-hub-state.sh: the hub’s files from one Spark to another', () => {
  // Each Spark is a folder named by its address; a stand-in ssh runs the far half there, and stand-in systemctl and
  // docker answer from its .standin folder (the console stopped and no plug controller, unless a case says so).
  const fleet = () => {
    const root = tmp('shd-copy-'), bin = join(root, 'bin'), hosts = join(root, 'hosts');
    mkdirSync(bin); mkdirSync(hosts);
    for (const a of Object.values(SPARKS)) mkdirSync(join(hosts, a, '.standin'), { recursive: true });
    sh(join(bin, 'ssh'), `#!/bin/bash
while [ $# -gt 0 ]; do case "$1" in -o) shift 2 ;; -O) exit 0 ;; -t) shift ;; *) break ;; esac; done
export HOME=${JSON.stringify(hosts)}/"\${1#*@}"; shift
cd "$HOME" || exit 255
exec bash -c "$*"
`);
    sh(join(bin, 'systemctl'), '#!/bin/sh\nf="$HOME/.standin/${4:-$3}"\nif [ -f "$f" ]; then cat "$f"; else echo inactive; exit 3; fi\n');
    sh(join(bin, 'docker'), '#!/bin/sh\n[ -f "$HOME/.standin/plugs" ] && cat "$HOME/.standin/plugs" || exit 1\n');
    const at = (s, ...p) => join(hosts, SPARKS[s], ...p);
    const put = (s, p, text, mode = 0o644) => { mkdirSync(dirname(at(s, p)), { recursive: true }); writeFileSync(at(s, p), text, { mode }); };
    // Spark 2, the hub until now
    put('spark2', '.local/state/spark-console/access.json', '{"ownerLogin":"owner@test"}');
    put('spark2', '.local/state/spark-console/chats/sc_1.json', '{"title":"x"}');
    put('spark2', '.local/state/spark-console/auth-serial.json', '{"n":3}');
    put('spark2', '.local/state/spark-console/sessions.json', '{"signed":"in"}');
    put('spark2', '.local/state/spark-console/api.sock', '');
    put('spark2', '.local/state/spark-console/x.json.tmp', 'half');
    put('spark2', '.config/spark-console/secrets.json', '{"auth":{"n":3}}', 0o600);
    put('spark2', '.config/spark-console/eval-seal.json', '{"k":1}', 0o600);
    put('spark2', '.config/spark-console/matter/node-1.json', '{}');
    put('spark2', '.local/share/spark-console/journal/journal-2026-11.jsonl', '{"k":"op"}\n');
    put('spark2', '.local/share/spark-console/repo.git/HEAD', 'ref: refs/heads/main\n');
    put('spark2', '.local/share/spark-console/releases/20261115T000000Z/build', 'abc\n');
    // Spark 1: what was there already
    put('spark1', '.local/state/spark-console/old.json', '{"old":true}');
    const copy = (args, { path = process.env.PATH } = {}) => spawnSync('bash', [join(DEPLOY, 'copy-hub-state.sh'), ...args], { encoding: 'utf8', timeout: TIMEOUT,
      env: { PATH: `${bin}:${path}`, HOME: root } });
    const tree = s => spawnSync('find', ['.', '-path', './.standin', '-prune', '-o', '-print'], { cwd: at(s), encoding: 'utf8', timeout: TIMEOUT }).stdout.split('\n').filter(Boolean).sort();
    return { at, put, copy, tree };
  };

  test('2 to 1: the state but the sign-ins, sockets and half-written files, the secrets, the seal, the plug keys, the journal and the repository copy; what was there is moved aside', () => {
    const f = fleet(), was2 = f.tree('spark2'), r = f.copy(['2', '1']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    for (const p of ['.local/state/spark-console/access.json', '.local/state/spark-console/chats/sc_1.json', '.local/state/spark-console/auth-serial.json',
      '.config/spark-console/secrets.json', '.config/spark-console/eval-seal.json', '.config/spark-console/matter/node-1.json',
      '.local/share/spark-console/journal/journal-2026-11.jsonl', '.local/share/spark-console/repo.git/HEAD']) {
      assert.equal(readFileSync(f.at('spark1', p), 'utf8'), readFileSync(f.at('spark2', p), 'utf8'), p);
    }
    for (const p of ['sessions.json', 'api.sock', 'x.json.tmp', 'old.json']) assert.ok(!existsSync(f.at('spark1', '.local/state/spark-console', p)), p);
    assert.ok(!existsSync(f.at('spark1', '.local/share/spark-console/releases')), 'only the listed files go');
    assert.equal(statSync(f.at('spark1', '.config/spark-console/secrets.json')).mode & 0o777, 0o600);
    const aside = readdirSync(f.at('spark1', '.local/state')).filter(d => d.startsWith('spark-console.before-'));
    assert.equal(aside.length, 1, aside.join(' '));
    assert.equal(readFileSync(f.at('spark1', '.local/state', aside[0], 'old.json'), 'utf8'), '{"old":true}');
    assert.deepEqual(f.tree('spark2'), was2, 'Spark 2 is as it was');
    assert.match(r.stdout, /^Spark 1 holds the hub's files as Spark 2 had them/m);
    assert.match(r.stdout, /^ {2}main\.json: none to tell\nDone\.$/m);
  });

  // main.json as the service writes it (JSON.stringify): a setup made from a Library model on the old hub, one on
  // Spark 3, the chat route to a model on the old hub's loopback, the agents' route to Spark 2's tailnet address.
  const MAIN = { current: 'lib-q', leftDown: '2026-11-16T00:00:00.000Z',
    presets: { 'lib-q': { node: 'spark2', title: 'Q on spark2', served: 'q', port: 30100, from: 'spark2' }, 'lib-r': { node: 'spark3', title: 'R', port: 30101 } },
    chat: { kind: 'endpoint', url: 'http://127.0.0.1:30100', model: 'q', title: 'Q', node: 'spark2' },
    agents: { kind: 'endpoint', url: `http://${SPARKS.spark2}:8000`, model: 'm', title: 'M', node: 'spark2' } };
  const MAIN_AT = '.local/state/spark-console/main.json';
  const swapped = (m, from, to) => JSON.parse(JSON.stringify(m).replaceAll(`"node":"${from}"`, `"node":"${to}"`));

  test('main.json on the new hub names it: a saved setup’s Spark and a route to the old hub’s loopback move; another Spark, a title, a tailnet route stay', () => {
    const f = fleet();
    f.put('spark2', MAIN_AT, JSON.stringify(MAIN), 0o600);
    const r = f.copy(['2', '1']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const want = JSON.parse(JSON.stringify(MAIN));
    want.presets['lib-q'].node = 'spark1';
    want.chat.node = 'spark1';
    assert.equal(readFileSync(f.at('spark1', MAIN_AT), 'utf8'), JSON.stringify(want), 'only those two fields changed, written as the service writes it');
    assert.equal(statSync(f.at('spark1', MAIN_AT)).mode & 0o777, 0o600);
    const kept = readdirSync(f.at('spark1', '.local/state/spark-console')).filter(n => n.startsWith('main.json.before-rewrite-'));
    assert.equal(kept.length, 1, kept.join(' '));
    assert.equal(readFileSync(f.at('spark1', '.local/state/spark-console', kept[0]), 'utf8'), JSON.stringify(MAIN), 'the copy as it arrived');
    assert.match(r.stdout, /^ {2}main\.json: presets\.lib-q\.node: spark2 -> spark1\n {2}main\.json: chat\.node: spark2 -> spark1\n/m);
    assert.equal(readFileSync(f.at('spark2', MAIN_AT), 'utf8'), JSON.stringify(MAIN), 'Spark 2’s own is as it was');
  });

  test('a main.json with nothing naming the old hub is left byte for byte; the way back (1 to 2) moves them the other way', () => {
    const f = fleet(), plain = JSON.stringify({ current: 'lib-r', presets: { 'lib-r': { node: 'spark3', title: 'spark2 R' } }, chat: { kind: 'main' }, agents: { kind: 'same' } });
    f.put('spark2', MAIN_AT, plain, 0o600);
    const r = f.copy(['2', '1']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(readFileSync(f.at('spark1', MAIN_AT), 'utf8'), plain);
    assert.deepEqual(readdirSync(f.at('spark1', '.local/state/spark-console')).filter(n => n.startsWith('main.json.before-rewrite-')), []);
    assert.match(r.stdout, /main\.json: nothing in it names the old hub; left as it was/);
    const back = fleet(), onHub1 = swapped(MAIN, 'spark2', 'spark1');
    onHub1.agents = MAIN.agents;
    back.put('spark1', MAIN_AT, JSON.stringify(onHub1), 0o600);
    const b = back.copy(['1', '2']);
    assert.equal(b.status, 0, b.stdout + b.stderr);
    assert.equal(readFileSync(back.at('spark2', MAIN_AT), 'utf8'), JSON.stringify(MAIN));
  });

  test('without Node.js on the Spark it goes to, it stops before anything is copied', () => {
    // (the runners' Node is in /usr/local/bin: a PATH of /usr/bin and /bin has none)
    assert.equal(spawnSync('bash', ['-c', 'command -v node || true'], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8', timeout: TIMEOUT }).stdout, '', 'no node on /usr/bin:/bin here');
    const f = fleet(), before = [f.tree('spark1'), f.tree('spark2')], r = f.copy(['2', '1'], { path: '/usr/bin:/bin' });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /^Stopped: Node\.js isn't on Spark 1, and the copied main\.json needs it to be told its new hub\..*Nothing was changed\.$/m);
    assert.deepEqual([f.tree('spark1'), f.tree('spark2')], before);
  });

  test('it refuses, changing nothing: a console, its watchdog or the plug controller running on either Spark, an armed update, no state, the same Spark twice, a Spark hub.env doesn’t name', () => {
    for (const [what, set, re, args = ['2', '1']] of [
      ['the console on Spark 1', f => f.put('spark1', '.standin/spark-console-api', 'active'), /Spark Console is running on Spark 1\. Stop it first, from the Mac: ssh akuppala@100\.119\.233\.101 'systemctl --user disable --now spark-console-api spark-console-watchdog\.timer'/],
      ['the console on Spark 2', f => f.put('spark2', '.standin/spark-console-api', 'activating'), /Spark Console is running on Spark 2/],
      ['the watchdog on Spark 2', f => f.put('spark2', '.standin/spark-console-watchdog.timer', 'active'), /watchdog is on on Spark 2/],
      ['the plug controller on Spark 2', f => f.put('spark2', '.standin/plugs', 'true'), /the plug controller is running on Spark 2, .*docker stop spark-console-plugs/],
      ['an armed update on Spark 2', f => f.put('spark2', '.local/share/spark-console/update-guard/guard', 'pgid=1\n'), /an update from GitHub on Spark 2 still has its way back armed/],
      ['no state on Spark 3', () => {}, /Spark 3 has no state folder to copy/, ['3', '1']],
      ['the same Spark twice', () => {}, /Spark 2 is named twice/, ['2', '2']],
      ['a Spark hub.env doesn’t name', () => {}, /5 or 1 isn't a Spark in deploy\/hub\.env/, ['5', '1']],
    ]) {
      const f = fleet();
      set(f);
      const before = [f.tree('spark1'), f.tree('spark2')], r = f.copy(args);
      assert.equal(r.status, 2, `${what}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, re, what);
      assert.match(r.stderr, /Nothing was changed\.$/m, what);
      assert.deepEqual([f.tree('spark1'), f.tree('spark2')], before, `${what}: nothing changed`);
    }
  });
});
