// Covers: The ways in, watched ahead (ledger 5b, addition 6; R47; 20-ways-in.mjs). Spark Console reads, and only reads, what can
// close a way in with no warning, on looks it already takes, and puts each on the needs-you list with what stops, when
// and what to do: a Tailscale key, Spark 2's own and a compute Spark's, within 14 days of expiring or expired; linger off
// for its user on Spark 2; Funnel off while its record says it was on. An answer it can't read is "couldn't check",
// never silence. Each line goes when its cause does, and the needs-me line on Telegram tells it once. A console whose
// tailscale never answers still starts and serves the owner. The stand-in tailscale answers `status --json` from
// $MOCK_DIR/status.json and `serve status --json` from serve.json, the stand-in loginctl answers Spark 2's
// ~/.mock/linger, and both keep every call they get. The looks run every second here (SPARK_CONSOLE_ROUTE_MS; every
// 60 s for real). Last, deploy/open-to-internet.sh --undo (closed on purpose) removes the console's Funnel record.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { T, REPO, useFleet, api, request, sleep, waitFor, SLOW } from './lib.mjs';
import { startMock, serviceConfig } from './start-mock.mjs';

const TOKEN = '123456789:AAEtestTokenForSparkConsoleXYZ_abcdefghij', OWNER_TG = 5550001;
const SETTLE = 3000 * SLOW, DAY = 86400000, HOST = new URL(serviceConfig().origin).host;
useFleet({ telegram: true, env: { SPARK_CONSOLE_ROUTE_MS: '1000', SPARK_CONSOLE_NEEDS_MS: '400', SPARK_CONSOLE_NEEDS_SETTLE_MS: String(SETTLE) },
  prepare: ({ dir, stateDir }) => {
    // Paired, with the needs-me line on (as after the owner switched it on with the passkey).
    mkdirSync(join(dir, 'secrets'), { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, 'secrets', 'secrets.json'), JSON.stringify({ telegram: { token: TOKEN, bot: 'spark_test_bot', chatId: OWNER_TG, userId: OWNER_TG, name: 'Owner', needsMe: true } }), { mode: 0o600 });
    // (an empty should-run list, so nothing else is held while the service seeds one)
    writeFileSync(join(stateDir, 'desired.json'), JSON.stringify({ revision: 1, running: [], revisions: [] }), { mode: 0o600 });
  } });

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dayOf = t => { const d = new Date(t); return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const iso = t => new Date(t).toISOString();
const needsOf = async base => {
  const r = await request(`${base}/actions/fleet_status`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-spark-console': '1', origin: serviceConfig().origin }, body: '{}' });
  assert.equal(r.status, 200, r.text);
  return JSON.parse(r.text).needsOwner;
};
const needs = () => needsOf(T.base);
const has = (re, what) => waitFor(async () => (await needs()).find(l => re.test(l)), { timeout: 30000, what: `a line like ${re} (${what})` });
const gone = (re, what) => waitFor(async () => !(await needs()).some(l => re.test(l)), { timeout: 30000, what: `no line like ${re} (${what})` });
const lines = (f, dir = T.fleet.dir) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean) : []);
// Two more looks than now, each one answered (the stand-in keeps the call as it starts, so the one after is a whole one).
async function looks(file = 'tailscale-calls', match = /^status --json$/) {
  const from = lines(file).filter(l => match.test(l)).length;
  await waitFor(() => lines(file).filter(l => match.test(l)).length >= from + 2, { timeout: 20000, what: `two more looks (${file})` });
  await sleep(300);
}
const status = st => writeFileSync(join(T.fleet.dir, 'status.json'), typeof st === 'string' ? st : JSON.stringify(st));
const tailnet = (self = {}, peers = {}) => ({ BackendState: 'Running', Self: { HostName: 'akspark2', TailscaleIPs: ['100.64.0.2'], ...self }, Peer: peers });
const spark3 = extra => ({ 'nodekey:3': { HostName: 'akspark3', DNSName: 'akspark3.example.ts.net.', TailscaleIPs: ['100.64.0.3'], ...extra } });
const linger = v => { const f = join(T.fleet.root, 'spark2', '.mock', 'linger'); if (v === null) rmSync(f, { force: true }); else writeFileSync(f, `${v}\n`); };
const serve = funnel => writeFileSync(join(T.fleet.dir, 'serve.json'), JSON.stringify({ TCP: { 8443: { HTTPS: true } }, Web: { [HOST]: { Handlers: { '/': { Path: '/x' } } } }, ...(funnel ? { AllowFunnel: { [HOST]: true } } : {}) }));
const health = async () => JSON.parse((await request(`${T.base}/health`)).text);
const needsSent = () => lines('telegram-calls.jsonl').map(l => JSON.parse(l)).filter(c => c.method === 'sendMessage' && /^Spark Console: \d+ things? needs? you\./.test(c.body.text));

const KEY2 = /^Spark 2’s Tailscale key/, KEY3 = /^Spark 3’s Tailscale key/, UNREAD = /^Spark Console couldn’t read Tailscale’s state on Spark 2/;
const LINGER = /^Spark Console stops when you log out of Spark 2/, LINGER_UNREAD = /^Spark Console couldn’t check whether it starts by itself/;
const FUNNEL = /^Funnel is off/, WAYS = [KEY2, KEY3, UNREAD, LINGER, LINGER_UNREAD, FUNNEL];

describe('the ways in, on the needs-you list', { concurrency: 1 }, () => {
  test('nothing waits while every way in is fine: the looks ran, and no line', { timeout: 60000 * SLOW }, async () => {
    await looks();
    await looks('loginctl-calls', /^show-user /);
    assert.deepEqual(await needs(), []);
  });

  test('Spark 2’s key: 20 days away gives no line; 10 days away gives one naming the day, told once on Telegram; expiry off clears it', { timeout: 90000 * SLOW }, async () => {
    status(tailnet({ KeyExpiry: iso(Date.now() + 20 * DAY) }));
    await looks();
    assert.ok(!(await needs()).some(l => KEY2.test(l)), 'no line 20 days ahead');
    const at = Date.now() + 10 * DAY;
    status(tailnet({ KeyExpiry: iso(at) }));
    const line = await has(KEY2, '10 days ahead');
    assert.equal(line, `Spark 2’s Tailscale key expires in 10 days, on ${dayOf(at)}. After that, only Telegram reaches Spark Console. Before then: Tailscale’s admin page → Machines → akspark2 → Disable key expiry.`);
    // Told once: the line stays through many looks (every second here), and one needs-me line goes, not one a look.
    await waitFor(() => needsSent().length >= 1, { timeout: 30000, what: 'the needs-me line' });
    for (let i = 0; i < 3; i++) await looks();
    await sleep(SETTLE);
    assert.equal(needsSent().length, 1, 'told once, not again while it stays');
    assert.equal(needsSent()[0].body.text, 'Spark Console: 1 thing needs you. Send /status to see it.');
    assert.equal((await needs()).filter(l => KEY2.test(l)).length, 1);
    status(tailnet());
    await gone(KEY2, 'key expiry turned off');
  });

  test('a compute Spark’s key (the peer with its tailnet address) and an expired key: each a line, gone when renewed', { timeout: 90000 * SLOW }, async () => {
    const at = Date.now() + 5 * DAY;
    status(tailnet({}, spark3({ KeyExpiry: iso(at) })));
    assert.equal(await has(KEY3, '5 days ahead'), `Spark 3’s Tailscale key expires in 5 days, on ${dayOf(at)}. After that, Spark Console can’t reach Spark 3. Before then: Tailscale’s admin page → Machines → akspark3 → Disable key expiry.`);
    status(tailnet({}, spark3({ KeyExpiry: iso(Date.now() + 30 * DAY) })));
    await gone(KEY3, 'renewed for 30 days');
    const was = Date.now() - 2 * DAY;
    status(tailnet({ KeyExpiry: iso(was), Expired: true }));
    assert.equal(await has(KEY2, 'expired'), `Spark 2’s Tailscale key expired on ${dayOf(was)}, so only Telegram reaches Spark Console. To fix it, sign in to Tailscale again on Spark 2, then turn off key expiry in Tailscale’s admin page (Machines → akspark2).`);
    status(tailnet());
    await gone(KEY2, 'signed in again, expiry off');
  });

  test('an answer that can’t be read says “couldn’t check”, not fine, and keeps what was last known; a good one clears it', { timeout: 90000 * SLOW }, async () => {
    const at = Date.now() + 10 * DAY;
    status(tailnet({ KeyExpiry: iso(at) }));
    await has(KEY2, '10 days ahead');
    status('{"BackendState": "Runn');
    assert.equal(await has(UNREAD, 'not JSON'), 'Spark Console couldn’t read Tailscale’s state on Spark 2, so it can’t warn before a Tailscale key expires. Check that Tailscale is running there: tailscale status');
    assert.ok((await needs()).some(l => KEY2.test(l)), 'the key line from the last answer stays');
    status('{"BackendState":"NoState"}');
    await looks();
    assert.ok((await needs()).some(l => UNREAD.test(l)), 'an answer without Spark 2 in it is not a look either');
    status(tailnet());
    await gone(UNREAD, 'a readable answer');
    await gone(KEY2, 'expiry off');
  });

  test('linger off: one line with the command; on: none; an answer that can’t be read: “couldn’t check”', { timeout: 90000 * SLOW }, async () => {
    linger('no');
    assert.equal(await has(LINGER, 'linger off'), 'Spark Console stops when you log out of Spark 2, and after a restart it stays off until you log in. To keep it running, run this once on Spark 2: sudo loginctl enable-linger $USER');
    linger('yes');
    await gone(LINGER, 'linger on');
    linger('fail');
    assert.equal(await has(LINGER_UNREAD, 'loginctl failed'), 'Spark Console couldn’t check whether it starts by itself after Spark 2 restarts. Check on Spark 2: loginctl show-user $USER -p Linger');
    linger(null);
    await gone(LINGER_UNREAD, 'loginctl answers again');
    assert.deepEqual((await needs()).filter(l => WAYS.some(re => re.test(l))), []);
  });

  test('Funnel off is a line only while the console’s record says it was on; on again, or the record removed (closed on purpose), clears it', { timeout: 90000 * SLOW }, async () => {
    const record = join(T.fleet.stateDir, 'funnel-seen.json');
    serve(false);
    await waitFor(async () => (await health()).internet === false, { what: 'Funnel known off' });
    await looks('tailscale-calls', /^serve status --json$/);
    assert.ok(!existsSync(record));
    assert.ok(!(await needs()).some(l => FUNNEL.test(l)), 'off, never seen on: no line');
    serve(true);
    await waitFor(() => existsSync(record), { what: 'the record that Funnel is on' });
    assert.ok(!Number.isNaN(Date.parse(JSON.parse(readFileSync(record, 'utf8')).seenOnAt)));
    assert.equal((await health()).internet, true);
    assert.ok(!(await needs()).some(l => FUNNEL.test(l)));
    serve(false);
    assert.equal(await has(FUNNEL, 'Funnel switched off'), 'Funnel is off, so Spark Console can’t be reached from the internet: only devices with Tailscale on get in. To open it again: bash spark-console/deploy/open-to-internet.sh. Closed on purpose? Run it with --undo and this line goes.');
    serve(true);
    await gone(FUNNEL, 'Funnel on again');
    serve(false);
    await has(FUNNEL, 'off again');
    rmSync(record);
    await gone(FUNNEL, 'the record removed, as --undo does');
    await looks('tailscale-calls', /^serve status --json$/);
    assert.ok(!existsSync(record), 'not written again while Funnel is off');
  });

  test('every call to the stand-ins was a read', async () => {
    const ts = lines('tailscale-calls'), lc = lines('loginctl-calls');
    assert.ok(ts.includes('status --json') && ts.includes('serve status --json') && lc.length, `the looks ran: ${ts.length} and ${lc.length} calls`);
    const uid = process.getuid();
    assert.deepEqual(ts.filter(c => !/^(ip|ip -4|status --json|serve status --json)$/.test(c)), [], 'tailscale: status reads only');
    assert.deepEqual(lc.filter(c => c !== `show-user ${uid} -p Linger --value`), [], 'loginctl: the linger read only');
  });
});

describe('a console whose tailscale never answers', () => {
  test('starts, serves the owner, and says it couldn’t check; the line goes once tailscale answers', { timeout: 120000 * SLOW }, async () => {
    const fleet = await startMock({ env: { SPARK_CONSOLE_ROUTE_MS: '1000' }, prepare: ({ dir }) => writeFileSync(join(dir, 'tailscale-hangs'), '') });
    try {
      assert.equal((await request(`${fleet.base}/health`)).status, 200);
      const line = await waitFor(async () => (await needsOf(fleet.base)).find(l => UNREAD.test(l)), { timeout: 40000, what: 'the couldn’t-check line' });
      assert.ok(line);
      assert.ok(lines('tailscale-calls', fleet.dir).some(c => c === 'status --json'), 'it was asked');
      rmSync(join(fleet.dir, 'tailscale-hangs'));
      await waitFor(async () => !(await needsOf(fleet.base)).some(l => UNREAD.test(l)), { timeout: 40000, what: 'the line gone' });
    } finally { await fleet.stop(); }
  });
});

// The owner's own script closes Funnel on purpose: it removes the console's record (and nothing else in the state
// folder), so the console stops saying Funnel is off. A stand-in ssh runs the Spark 2 half here, and a stand-in tailscale
// keeps its calls.
describe('deploy/open-to-internet.sh --undo', () => {
  const homes = [];
  after(() => { for (const h of homes) rmSync(h, { recursive: true, force: true }); });
  test('removes funnel-seen.json, leaves the rest of the state, and changes only port 8443’s Funnel switch', { timeout: 60000 * SLOW }, async () => {
    // (a short folder name: the socket's path stays under the 104 characters macOS allows)
    const h = mkdtempSync(join(tmpdir(), 'scw-')), bin = join(h, 'bin'), st = join(h, '.local', 'state', 'spark-console');
    homes.push(h);
    mkdirSync(bin); mkdirSync(st, { recursive: true });
    writeFileSync(join(bin, 'ssh'), '#!/bin/bash\n[ "$1" = -t ] && shift\nshift\nexec bash -c "$1"\n', { mode: 0o755 });
    writeFileSync(join(bin, 'sudo'), '#!/bin/bash\necho "sudo $*" >> "$HOME/calls"\nexit 1\n', { mode: 0o755 });
    writeFileSync(join(bin, 'tailscale'), `#!/bin/bash\necho "$*" >> "$HOME/calls"\ncase "$*" in\n  'serve status') printf '|-- / (Path)\\n|-- /console/ (Path)\\n|-- /console/api (Proxy)\\n' ;;\nesac\nexit 0\n`, { mode: 0o755 });
    writeFileSync(join(st, 'funnel-seen.json'), '{"seenOnAt":"2026-11-14T00:00:00.000Z"}');
    writeFileSync(join(st, 'api-locked'), 'x\n');
    const sock = join(st, 'api.sock'), server = net.createServer();
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(sock, resolve); });
    try {
      const r = await new Promise(resolve => {
        const c = spawn('bash', [join(REPO, 'deploy', 'open-to-internet.sh'), '--undo'], { env: { PATH: `${bin}:${process.env.PATH}`, HOME: h } });
        let out = '', err = '';
        c.stdout.on('data', d => { out += d; });
        c.stderr.on('data', d => { err += d; });
        c.on('close', code => resolve({ code, out, err }));
      });
      assert.equal(r.code, 0, r.err + r.out);
      assert.ok(!existsSync(join(st, 'funnel-seen.json')), 'the record is gone');
      assert.ok(existsSync(join(st, 'api-locked')), 'the rest of the state stays');
      const calls = readFileSync(join(h, 'calls'), 'utf8').trim().split('\n');
      assert.deepEqual(calls.filter(c => !/^(serve|funnel) status$/.test(c)), [`serve --bg --https=8443 --set-path=/console/api unix:${sock}`]);
    } finally { server.close(); }
  });
});
