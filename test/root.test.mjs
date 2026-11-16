// Covers: a command as root, the console's half (A12; 21-root.mjs; R70, R60, R54; design A 2.13, step 12), switched on
// for this fleet (SPARK_CONSOLE_ROOT=1, with the net, SPARK_CONSOLE_NET=1; off, run has no root in its schema: the
// last test starts a console with it off). run with root: true is always the dangerous ask, "ROOT on Spark 3" (with
// "CAN LOCK YOU OUT" for the lock-out class), with the net's line and root's own, and no go-ahead button: never at once,
// even when the owner's words ask for it; nothing runs before the press. The press runs it through the root helper's
// `root --net` (its unit sw-root-<id>, the net's timer first; --lockout for the lock-out class), checked from outside and
// kept, and the journal says root. Where root's switch is off on that Spark, the answer is the owner's one command with
// --with-root and nothing is asked. sudo in a plain command is answered "set root"; root with sudo, a key or minutes is
// refused. The stand-in fleet, with the real root helper set up and proven for Spark 3 (test/rehearsal.mjs, run: true)
// and root's switch on there as the one-time command writes it. Linux only: run it on a Spark.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { T, useFleet, api, newChat, say, chatMessages, REPO, SLOW } from './lib.mjs';
import { rehearse } from './rehearsal.mjs';
import { startMock } from './start-mock.mjs';

const later = [];
after(async () => { for (const f of later) await f.stop().catch(() => {}); });
const sha = s => createHash('sha256').update(s).digest('hex');
const SWITCH = () => join(T.fleet.root, 'var/lib/spark-console/root-on');
// (a root command's time limit is the helper's own, 30 minutes; here 15 seconds, so one can be seen ended at it)
useFleet({ env: { SPARK_CONSOLE_NET: '1', SPARK_CONSOLE_ROOT: '1', SPARK_CONSOLE_ROOT_SECONDS: '15', SPARK_CONSOLE_RUN_SECONDS: '6', SPARK_CONSOLE_ROUTE_MS: '1000', SPARK_CONSOLE_WIDE_MS: '1', SPARK_CONSOLE_DANGER_LATE_MS: '0' },
  prepare: ({ root }) => {
    rehearse(root, 'spark3', { run: true });
    // (root's switch, as the owner's one-time command with --with-root writes it: 0600, the day and this helper's SHA-256)
    const sw = join(root, 'var/lib/spark-console/root-on');
    mkdirSync(join(root, 'var/lib/spark-console'), { recursive: true });
    chmodSync(join(root, 'var/lib/spark-console'), 0o755);
    writeFileSync(sw, `on 2026-11-15 helper ${sha(readFileSync(join(root, 'usr/local/sbin/spark-console-root')))}\n`, { mode: 0o600 });
    chmodSync(sw, 0o600);
    mkdirSync(join(root, 'spark3', '.ssh'), { recursive: true });
    chmodSync(join(root, 'spark3', '.ssh'), 0o700);
    writeFileSync(join(root, 'spark3', '.ssh/authorized_keys'), 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIStandIn owner@mac\n', { mode: 0o600 });
  } });

const lines = file => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const journalLines = () => readdirSync(T.fleet.journalDir).filter(f => f.endsWith('.jsonl')).sort().flatMap(f => lines(join(T.fleet.journalDir, f)));
const calls = () => lines(join(T.fleet.root, 'spark3', '.rehearsal', 'calls.log'));
const netRecord = () => { try { return JSON.parse(readFileSync(join(T.fleet.stateDir, 'net.json'), 'utf8')).guards; } catch { return []; } };
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const noScript = () => rmSync(join(T.fleet.dir, 'model-script.json'), { force: true });
// One owner's message, the stand-in brain calling run once as root; then the dangerous ask it raised, or null.
async function ask(chat, words, command) {
  script([{ match: `^${words}$`, rounds: [[{ name: 'run', arguments: { on: 'spark3', command, dir: '~', root: true } }]] }]);
  let r;
  try { r = await say(chat, words); } finally { noScript(); }
  const m = (await chatMessages(chat)).filter(x => x.danger).at(-1);
  return { r, m, yes: m?.choices.find(c => c.pair), no: m?.choices.find(c => c.label === 'No'), pair: m?.pair };
}
const press = (chat, choice, pair) => api(`/chats/${chat}/choose`, { method: 'POST', body: { choice, pair } });
const sentBack = words => {
  const x = lines(join(T.fleet.dir, 'model-requests.jsonl')).filter(m => m.words === words && m.lastRole === 'tool').at(-1);
  return (x?.results || []).map(r => (String(r.content).startsWith('[error] ') ? { error: String(r.content).slice(8) } : JSON.parse(r.content)));
};
const ROOTED = 'printf root > rooted.txt';

test('as root: always the dangerous ask, ROOT on Spark 3, with the net’s line and root’s own and no go-ahead button, even when the owner asks for it; nothing before the press, and No runs nothing', { timeout: 120000 * SLOW }, async () => {
  const chat = await newChat();
  const a = await ask(chat, 'as root on spark 3, write rooted.txt', ROOTED);
  assert.ok(a.m, 'the dangerous ask');
  let no;
  try {
    const shown = a.m.danger.lines.join('\n');
    assert.match(shown, /^ROOT on Spark 3\n/);
    assert.ok(shown.includes('It runs inside the lock-out net: unless Spark Console can still reach Spark 3 right after it'), shown);
    assert.ok(shown.includes('It runs as root on Spark 3, with no wall around it: the net puts back the ways in (SSH, Tailscale, the firewall, the sign-in files), never anything else it changes.'), shown);
    assert.equal(a.m.danger.code, ROOTED);
    // (only the press and No: no "don't ask again" and no standing approval)
    assert.deepEqual(a.m.choices.map(c => Boolean(c.pair || c.label === 'No')), a.m.choices.map(() => true), JSON.stringify(a.m.choices));
    assert.ok(!a.m.choices.some(c => c.ahead || c.always), 'no go-ahead');
    assert.ok(!existsSync(join(T.fleet.root, 'spark3', 'rooted.txt')), 'nothing ran');
  } finally { no = await press(chat, a.no.id); }
  assert.equal(no.status, 200, no.text);
  assert.ok(!existsSync(join(T.fleet.root, 'spark3', 'rooted.txt')));
});

test('pressed: it runs through the root helper’s root verb inside the net (the timer first, its unit sw-root-<id>), is checked from outside and kept, and the journal says root', { timeout: 180000 * SLOW }, async () => {
  const chat = await newChat();
  const a = await ask(chat, 'as root on spark 3, write rooted.txt now', ROOTED);
  const before = calls().length;
  const p = await press(chat, a.yes.id, a.pair);
  assert.equal(p.status, 200, p.text);
  const g = netRecord().at(-1);
  assert.equal(g.state, 'kept', JSON.stringify(g));
  assert.match(p.json.message.content, /ran inside the lock-out net, and Spark 3 still answers every way it did before .*: it is kept\.$/);
  assert.equal(readFileSync(join(T.fleet.root, 'spark3', 'rooted.txt'), 'utf8'), 'root');
  const asked = calls().slice(before).map(c => c.find(x => String(x).startsWith('--unit=')) || '');
  const timer = asked.indexOf(`--unit=sw-guard-${g.id}`), change = asked.indexOf(`--unit=sw-root-${g.id}`);
  assert.ok(timer >= 0 && change > timer, `the timer first, then the root unit: ${asked.join(', ')}`);
  const start = journalLines().find(x => x.id === g.record && x.start);
  assert.equal(start.root, true, JSON.stringify(start));
  assert.equal(start.unit, `sw-root-${g.id}`);
});

test('as root: a script is never run (its text isn’t on the button); the time limit is the helper’s own, said on the button, and one ended at it says so; with no root helper on a Spark, the owner’s command and nothing asked', { timeout: 180000 * SLOW }, async () => {
  const c1 = await newChat(), s = await ask(c1, 'as root on spark 3, run the fix script', 'bash ~/work/fix.sh');
  assert.equal(s.m, undefined, 'nothing asked');
  assert.match(sentBack('as root on spark 3, run the fix script')[0]?.error || '', /^Nothing was asked or run: as root, give the command itself, not a script \(~\/work\/fix\.sh\)/);
  const c2 = await newChat(), t = await ask(c2, 'as root on spark 3, wait a while in ~', 'sleep 30 && ls ~');
  assert.ok(t.m, 'the dangerous ask');
  const shown = t.m.danger.lines.join('\n');
  assert.ok(shown.includes('\nIt may run 15 seconds; at that limit it is ended, and the result says so.\nAs root, ~ is /root, not your own home.'), shown);
  const p = await press(c2, t.yes.id, t.pair);
  assert.equal(p.status, 200, p.text);
  assert.match(p.json.message.content, /The command itself was ended at its time limit \(15 seconds\), before it finished\./, p.json.message.content);
  const g = netRecord().at(-1), start = journalLines().find(x => x.id === g.record && x.start);
  assert.equal(start.seconds, 15, JSON.stringify(start));
  // (no root helper on Spark 4: the owner's one command, and nothing is asked)
  const n = await api('/actions/run', { method: 'POST', body: { on: 'spark4', command: 'printf x > rooted4.txt', dir: '~', root: true } });
  assert.equal(n.status, 200, n.text);
  assert.equal(n.json.ran, false, n.text);
  assert.match(n.json.ownerCommand || '', /root-for-sparkie\.sh 4'?$/, n.text);
});

test('the lock-out class as root: ROOT on Spark 3 · CAN LOCK YOU OUT, and the helper is called with --lockout', { timeout: 120000 * SLOW }, async () => {
  const chat = await newChat();
  const a = await ask(chat, 'as root on spark 3, add the other key', "printf '%s\\n' 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOther other@net' >> .ssh/authorized_keys");
  assert.ok(a.m, 'the dangerous ask');
  try {
    assert.match(a.m.danger.lines.join('\n'), /^ROOT on Spark 3 · CAN LOCK YOU OUT\n/);
    assert.match(a.m.danger.lines.join('\n'), /\nWhy it can lock you out: .*authorized_keys/);
  } finally { await press(chat, a.no.id); }
  // (the script the press runs: the helper's root verb, inside the net, held to the lock-out class's 10 minutes)
  const src = readFileSync(join(REPO, 'service', 'src', '21-guard.mjs'), 'utf8');
  const fn = /^function guardScript\([\s\S]*?\n\}$/m.exec(src)?.[0];
  assert.ok(fn, 'guardScript');
  const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const guardScript = new Function('createHash', 'q', 'HELPER_AT', 'HELPER_SHA256', `${fn}\nreturn guardScript;`)(createHash, q, '/usr/local/sbin/spark-console-root', 'f'.repeat(64));
  const at = (verb, opts) => guardScript({ host: '100.64.0.3' }, verb, { id: 'abcdefgh1234', command: 'echo x', seconds: 30, ...opts }).split('\n').at(-1);
  assert.equal(at('root', { lockout: true }), `exec sudo -n "$h" root --id "$id" --sha256 ${sha('echo x')} --seconds 30 --dir "$HOME" --net --lockout -- 'echo x' </dev/null 2>&1`);
  assert.equal(at('root', { dir: '~/work' }), `exec sudo -n "$h" root --id "$id" --sha256 ${sha('echo x')} --seconds 30 --dir "$HOME"'/work' --net -- 'echo x' </dev/null 2>&1`);
});

test('root off on Spark 3: the owner’s one command with --with-root, and nothing is asked', { timeout: 120000 * SLOW }, async () => {
  const chat = await newChat();
  renameSync(SWITCH(), `${SWITCH()}.away`);
  try {
    const asks = (await chatMessages(chat)).filter(x => x.danger).length;
    await ask(chat, 'as root on spark 3, write rooted.txt once more', ROOTED);
    assert.equal((await chatMessages(chat)).filter(x => x.danger).length, asks, 'no ask');
    const [r] = sentBack('as root on spark 3, write rooted.txt once more');
    assert.equal(r.ran, false, JSON.stringify(r));
    assert.match(r.ownerCommand, /root-for-sparkie\.sh --with-root 3'?$/);
    assert.match(r.why, /^Root is off on Spark 3: the owner turns it on with the one command \(--with-root\), so nothing ran there\.$/);
  } finally { renameSync(`${SWITCH()}.away`, SWITCH()); }
});

test('sudo in a plain command is answered “set root”; root with sudo, a key or minutes is refused, and nothing runs', { timeout: 60000 * SLOW }, async () => {
  const run = body => api('/actions/run', { method: 'POST', body: { on: 'spark3', ...body } });
  const sudo = await run({ command: 'sudo touch /etc/rooted' });
  assert.equal(sudo.status, 403, sudo.text);
  assert.equal(sudo.json.error, 'Nothing ran: a command becomes root only by setting root (run with root: true), which is always asked as root and runs inside the lock-out net. Leave out sudo and set root.');
  const both = await run({ command: 'sudo ls', root: true });
  assert.equal(both.status, 400, both.text);
  assert.match(both.json.error, /^Leave out sudo: with root set, the whole command runs as root\./);
  const key = await run({ command: 'ls', root: true, keys: ['HF_TOKEN'] });
  assert.equal(key.status, 403, key.text);
  assert.equal(key.json.error, 'Nothing ran: a command as root is never given a key.');
  const long = await run({ command: 'ls', root: true, minutes: 5 });
  assert.equal(long.status, 400, long.text);
  assert.ok(!existsSync(join(T.fleet.root, 'etc', 'rooted')));
});

test('off: run has no root in its schema, so what the brain reads is as before; on, it has', { timeout: 120000 * SLOW }, async () => {
  const on = (await api('/actions')).json.actions.find(a => a.name === 'run');
  assert.equal(on.input.properties.root?.type, 'boolean');
  const B = await startMock({ env: { SPARK_CONSOLE_NET: '1' } });
  later.push(B);
  const off = (await (await fetch(`${B.base}/actions`)).json()).actions.find(a => a.name === 'run');
  assert.ok(off && !('root' in off.input.properties), JSON.stringify(off?.input.properties));
  assert.deepEqual(Object.keys(off.input.properties), Object.keys(on.input.properties).filter(k => k !== 'root'));
});
