// Covers: the lock-out net's console half (21-net.mjs; R60, R54, R61, R13, R43; design A 2.8, step A13b), switched on
// for this fleet (SPARK_CONSOLE_NET=1; off, a lock-out change waits for the net: ladder.test.mjs): a lock-out change is
// the dangerous ask, with what goes back and why it can lock the owner out, and nothing runs before the press; the
// press arms the Spark's own timer first (the command's time limit plus 600 s), runs the change and checks the ways in
// from outside: all still work, so code keeps it; one stopped working, so it is put back at once; no answer, so the
// Spark's own timer puts it back, the Spark stays claimed, a second lock-out change there is refused before it is
// asked, /stop leaves the timer, and /putback puts it back by the owner's word; what the net can't put back (a
// Tailscale sign-out, a sign-in as another key) is not done; a restart of Spark Console inside the window puts it back
// at start and says so.
// The stand-in fleet, with the real root helper set up and proven for Spark 3 (test/rehearsal.mjs, run: true): its
// net's copies and timer are the rehearsal's (the stand-in systemd-run keeps a waiting timer as a file), and a change
// names the owner's authorized_keys from the Spark's own folder. The ways in tried from outside: a new connection (the
// stand-in fleet's local one), the helper through its sudo line, and Spark 3 online in Tailscale's status
// ($MOCK_DIR/status.json, which a test may change while a change runs). Linux only: run it on a Spark.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync, readdirSync, statSync, symlinkSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { T, useFleet, api, newChat, say, chatMessages, waitFor, sleep, SLOW } from './lib.mjs';
import { rehearse } from './rehearsal.mjs';
import { startMock } from './start-mock.mjs';

const SECONDS = 6;
const KEYS_LINE = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIStandIn owner@mac\n';
const ADDED = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINetAdded added@net';
const later = [];
after(async () => { for (const f of later) await f.stop().catch(() => {}); });
useFleet({ env: { SPARK_CONSOLE_NET: '1', SPARK_CONSOLE_RUN_SECONDS: String(SECONDS), SPARK_CONSOLE_ROUTE_MS: '1000', SPARK_CONSOLE_WIDE_MS: '1', SPARK_CONSOLE_DANGER_LATE_MS: '0' },
  prepare: ({ root }) => {
    rehearse(root, 'spark3', { run: true });
    const h = join(root, 'spark3');
    mkdirSync(join(h, '.ssh'), { recursive: true });
    chmodSync(join(h, '.ssh'), 0o700);
    writeFileSync(join(h, '.ssh/authorized_keys'), KEYS_LINE, { mode: 0o600 });
  } }, async () => {
  // (the console's looks at the tailnet: until two have read it after a request, no plain change runs at once, A7c)
  const looks = () => (existsSync(join(T.fleet.dir, 'tailscale-calls')) ? readFileSync(join(T.fleet.dir, 'tailscale-calls'), 'utf8').split('\n').filter(l => l === 'status --json').length : 0);
  const n = looks();
  await waitFor(() => looks() >= n + 2, { what: 'two looks at the tailnet' });
  await sleep(300);
});

const keysFile = (f = T.fleet) => join(f.root, 'spark3', '.ssh', 'authorized_keys');
const keysNow = () => readFileSync(keysFile(), 'utf8');
// (each test starts from the owner's one key, whatever the one before it left)
const keysReset = () => writeFileSync(keysFile(), KEYS_LINE, { mode: 0o600 });
const guardDir = id => join(T.fleet.root, 'var/lib/spark-console/guard', id);
const timerWaits = id => existsSync(join(T.fleet.root, 'standin/timers', `sw-guard-${id}.timer`));
const netRecord = (f = T.fleet) => { try { return JSON.parse(readFileSync(join(f.stateDir, 'net.json'), 'utf8')).guards; } catch { return []; } };
const newest = (f = T.fleet) => netRecord(f).at(-1);
const lines = file => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const journalLines = (dir = T.fleet.journalDir) => readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort().flatMap(f => lines(join(dir, f)));
const calls = () => lines(join(T.fleet.root, 'spark3', '.rehearsal', 'calls.log'));
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const noScript = () => rmSync(join(T.fleet.dir, 'model-script.json'), { force: true });
const RUN = command => ({ name: 'run', arguments: { on: 'spark3', command, dir: '~' } });
const ADD = `printf '%s\\n' '${ADDED}' >> .ssh/authorized_keys`;
// Spark 3 seen by Tailscale as offline (or as the stand-in has it, with no file).
const TAILNET = online => ({ BackendState: 'Running', Self: { HostName: 'akspark2', TailscaleIPs: ['100.64.0.2'] }, Peer: {
  'nodekey:1': { HostName: 'akspark1', TailscaleIPs: ['100.64.0.1'], Online: true }, 'nodekey:3': { HostName: 'akspark3', TailscaleIPs: ['100.64.0.3'], Online: online },
  'nodekey:4': { HostName: 'akspark4', TailscaleIPs: ['100.64.0.4'], Online: true } } });
const tailnet = online => (online ? rmSync(join(T.fleet.dir, 'status.json'), { force: true }) : writeFileSync(join(T.fleet.dir, 'status.json'), JSON.stringify(TAILNET(false))));
// One owner's message in a chat, the stand-in brain calling run once; then the dangerous ask it raised, as the owner's
// page reads it (its pair), or null.
async function ask(chat, words, command) {
  script([{ match: `^${words}$`, rounds: [[RUN(command)]] }]);
  let r;
  try { r = await say(chat, words); } finally { noScript(); }
  const m = (await chatMessages(chat)).filter(x => x.danger).at(-1);
  return { r, m, yes: m?.choices.find(c => c.pair), no: m?.choices.find(c => c.label === 'No'), pair: m?.pair };
}
const press = (chat, choice, pair) => api(`/chats/${chat}/choose`, { method: 'POST', body: { choice, pair } });
// What a run call answered the brain (the newest), parsed.
const sentBack = words => {
  const x = lines(join(T.fleet.dir, 'model-requests.jsonl')).filter(m => m.words === words && m.lastRole === 'tool').at(-1);
  return (x?.results || []).map(r => (String(r.content).startsWith('[error] ') ? { error: String(r.content).slice(8) } : JSON.parse(r.content)));
};

test('a lock-out change is the dangerous ask: what goes back and when, why it can lock you out, the exact command; nothing runs before the press', { timeout: 120000 * SLOW }, async () => {
  const chat = await newChat();
  const a = await ask(chat, 'add my key on spark 3', ADD);
  assert.ok(a.m, 'the dangerous ask');
  const shown = a.m.danger.lines.join('\n');
  assert.match(shown, /^CAN LOCK YOU OUT of Spark 3\n/);
  assert.ok(shown.includes('It runs inside the lock-out net: unless Spark Console can still reach Spark 3 right after it (a new connection, the root helper, Tailscale), it goes back at once, and by itself 11 minutes after it starts at the latest.'), shown);
  assert.match(shown, /\nWhy it can lock you out: .*authorized_keys/);
  assert.equal(a.m.danger.code, ADD);
  assert.equal(keysNow(), KEYS_LINE, 'nothing ran');
  assert.equal(newest(), undefined, 'no guard');
  // No: nothing runs.
  const no = await press(chat, a.no.id);
  assert.equal(no.status, 200, no.text);
  assert.equal(keysNow(), KEYS_LINE);
});

test('pressed: the timer is armed first (its time limit plus 600 s), the change runs, the ways in still work from outside, so code keeps it, and says so once', { timeout: 180000 * SLOW }, async () => {
  keysReset();
  const chat = await newChat();
  const a = await ask(chat, 'add my key on spark 3 now', ADD);
  const before = calls().length;
  const p = await press(chat, a.yes.id, a.pair);
  assert.equal(p.status, 200, p.text);
  const g = newest();
  assert.equal(g.state, 'kept', JSON.stringify(g));
  assert.match(p.json.message.content, new RegExp(`^A change that could lock you out of Spark 3 \\(record ${g.record}\\) ran inside the lock-out net, and Spark 3 still answers every way it did before \\(a new connection, the root helper, Tailscale\\): it is kept\\.$`));
  assert.equal(keysNow(), `${KEYS_LINE}${ADDED}\n`, 'kept');
  // (the timer was asked for before the change, and stopped by the keep; nothing waits for it)
  const asked = calls().slice(before).map(c => c.find(x => String(x).startsWith('--unit=')) || c.slice(0, 3).join(' '));
  const timer = asked.indexOf(`--unit=sw-guard-${g.id}`), change = asked.indexOf(`--unit=sw-run-${g.id}`);
  assert.ok(timer >= 0 && change > timer, `the timer first: ${asked.join(', ')}`);
  assert.ok(calls().slice(before).some(c => c[0] === 'systemd-run' && c.includes(`--unit=sw-guard-${g.id}`) && c.includes(`--on-active=${SECONDS + 600}s`)), 'its time limit plus 600 s');
  assert.ok(!timerWaits(g.id) && !existsSync(join(guardDir(g.id), 'pending')), 'kept: no timer, nothing pending');
  // The journal: a start line before, an end line after, with the guard's id.
  const rec = journalLines().filter(x => x.id === g.record);
  assert.deepEqual(rec.map(x => [Boolean(x.start), Boolean(x.end), x.class || null, x.outcome || null, x.net]), [[true, false, 'lockout', null, g.id], [false, true, null, 'kept', g.id]]);
  // Told once in the chat: the press's own answer says it, and no notice of the net's says it again.
  assert.equal((await chatMessages(chat)).filter(m => !m.danger && /it is kept\.$/.test(m.content || '')).length, 1, 'once in the chat');
});

test('a way in that worked before stops working after it: put back at once, and said', { timeout: 180000 * SLOW }, async () => {
  keysReset();
  const chat = await newChat();
  const a = await ask(chat, 'add my key on spark 3 again', `${ADD}; sleep 4`);
  const seen = netRecord().length;
  const pressing = press(chat, a.yes.id, a.pair);
  try {
    // (Spark 3 leaves the tailnet while the change runs: the check after it sees Tailscale's status say so)
    await waitFor(() => netRecord().length > seen && existsSync(join(guardDir(newest().id), 'pending')), { every: 100, what: 'the guard armed' });
    tailnet(false);
    const p = await pressing;
    assert.equal(p.status, 200, p.text);
    const g = newest();
    assert.equal(g.state, 'put back', JSON.stringify(g));
    assert.match(p.json.message.content, new RegExp(`^A change that could lock you out of Spark 3 \\(record ${g.record}\\) was put back at once: after it, its Tailscale connection stopped working \\(put back at \\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\dZ: 1 went back, 0 did not\\)\\.$`));
    assert.equal(keysNow(), KEYS_LINE, 'put back');
    assert.ok(!timerWaits(g.id) && !existsSync(join(guardDir(g.id), 'pending')));
    assert.equal(readFileSync(join(guardDir(g.id), 'result'), 'utf8').split('\n')[1], "on the console's word");
  } finally { tailnet(true); await pressing.catch(() => {}); }
});

test('no answer after it: the Spark’s own timer puts it back, Spark 3 stays claimed, a second lock-out change is refused before it is asked, /stop leaves the timer, and /putback puts it back', { timeout: 240000 * SLOW }, async () => {
  keysReset();
  const chat = await newChat();
  const a = await ask(chat, 'add my key on spark 3 once more', ADD);
  // (the connection drops right after the helper's first line, its "armed": the helper goes on, as on a Spark)
  const drops = join(T.fleet.root, 'spark3', '.mock', 'sudo-drops');
  mkdirSync(dirname(drops), { recursive: true });
  writeFileSync(drops, 'first-line\n');
  let g;
  // (left open by a failure here, it would hold Spark 3 for the tests after it: put back then)
  const cleanUp = async () => { if (['open', 'timer', 'arming'].includes(newest()?.state)) await say(chat, '/putback').catch(() => {}); };
  try {
    const p = await press(chat, a.yes.id, a.pair);
    assert.equal(p.status, 200, p.text);
    g = newest();
    assert.equal(g.state, 'timer', JSON.stringify(g));
    assert.match(p.json.message.content, new RegExp(`^A change that could lock you out of Spark 3 \\(record ${g.record}\\) ran inside the lock-out net, but Spark 3 didn’t answer after it, so it wasn’t checked: Spark 3’s own timer puts it back at \\d\\d:\\d\\d UTC\\. Spark 3 stays claimed until then\\.$`));
  } finally { rmSync(drops, { force: true }); }
  try {
  await waitFor(() => keysNow().includes(ADDED), { what: 'the change, which ran on' });
  assert.ok(timerWaits(g.id), 'its timer waits');
  // A second lock-out change there: refused before it is asked.
  const asks = (await chatMessages(chat)).filter(x => x.danger).length;
  await ask(chat, 'add the other key on spark 3', `printf '%s\\n' 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOther other@net' >> .ssh/authorized_keys`);
  assert.equal((await chatMessages(chat)).filter(x => x.danger).length, asks, 'no new ask');
  const [refused] = sentBack('add the other key on spark 3');
  assert.match(refused?.error || '', new RegExp(`^A change that can lock you out of Spark 3 is still open there \\(record ${g.record}\\): it is kept or goes back first, at \\d\\d:\\d\\d UTC at the latest\\. Nothing was asked or run\\.$`));
  // Any other change there meets its claim (a plain one, which the owner's call would run at once).
  const plain = await api('/actions/run', { method: 'POST', body: { on: 'spark3', command: 'touch net-note.txt' } });
  assert.equal(plain.status, 409, plain.text);
  assert.match(plain.json.error, /Something is already changing on Spark 3 \(a change inside the lock-out net\)/);
  // /stop ends Sparkie's answer, never the Spark's own timer.
  await say(chat, '/stop');
  assert.ok(timerWaits(g.id), 'the timer still waits after /stop');
  // /putback: the owner's word, by code: put back now, and the Spark is let go.
  const w = await say(chat, '/putback');
  assert.match(w.text, new RegExp(`^/putback\\nPut back: the newest change made inside the lock-out net, on Spark 3 \\(record ${g.record}\\), at \\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\dZ: 1 went back, 0 did not\\.$`));
  assert.equal(keysNow(), KEYS_LINE, 'put back');
  assert.ok(!timerWaits(g.id));
  assert.equal(newest().state, 'put back');
  const after = await api('/actions/run', { method: 'POST', body: { on: 'spark3', command: 'touch net-note.txt' } });
  assert.equal(after.status, 200, after.text);
  assert.equal(after.json.ran, true, after.text);
  // The newest open or kept one now is the one kept earlier: it stays, and that is said.
  const again = await say(chat, '/putback');
  assert.match(again.text, /^\/putback\nNothing was put back: the newest change made inside the lock-out net, on Spark 3 \(record j_[0-9a-f]{12}\) was kept, and once kept the net puts nothing back\./);
  } finally { await cleanUp(); }
});

test('what the net can’t put back is not done, and nothing is asked: a Tailscale sign-out, or a sign-in as another key', { timeout: 120000 * SLOW }, async () => {
  const chat = await newChat();
  for (const [words, command, why] of [['sign spark 3 out of tailscale', 'tailscale logout', 'A Tailscale logout needs a sign-in in a browser to undo; the net can’t put it back'],
    ['switch spark 3 to my work tailnet', 'tailscale switch work', 'tailscale “switch” signs in again, as another key or account; the net can’t put that back'],
    ['sign spark 3 in again', 'tailscale up --force-reauth', 'tailscale “up” signs in again, as another key or account; the net can’t put that back']]) {
    const asks = (await chatMessages(chat)).filter(x => x.danger).length;
    const a = await ask(chat, words, command);
    assert.equal((await chatMessages(chat)).filter(x => x.danger).length, asks, `${command}: no ask`);
    const [r] = sentBack(words);
    assert.ok(String(r?.error || '').startsWith(`Not done: ${why}. `), `${command}: ${JSON.stringify(r)}`);
    assert.match(r.error, /Nothing was asked or run\.$/);
    assert.ok(a);
  }
});

// Last: it stops this file's console.
test('a restart of Spark Console inside the window puts the change back at start, and says so in the chat it was asked in', { timeout: 300000 * SLOW }, async () => {
  keysReset();
  const chat = await newChat();
  const a = await ask(chat, 'add my key on spark 3 slowly', `${ADD}; sleep 30`);
  const seen = netRecord().length;
  press(chat, a.yes.id, a.pair).catch(() => {});
  await waitFor(() => netRecord().length > seen && keysNow().includes(ADDED), { every: 100, what: 'the change running' });
  const g = newest();
  assert.equal(g.state, 'arming');
  process.kill(T.fleet.servicePid(), 'SIGKILL');
  await waitFor(() => T.fleet.serviceExit(), { what: 'the console to end' });
  // (the same Spark 3, its rehearsal and the guard on it; the record and the chat as they were)
  const A = T.fleet;
  const B = await startMock({ watchMs: 600000, statusMs: 600000, prepare: ({ root, dir, stateDir }) => {
    rmSync(join(root, 'spark3'), { recursive: true, force: true });
    symlinkSync(join(A.root, 'spark3'), join(root, 'spark3'));
    for (const f of ['chats.json', 'net.json']) cpSync(join(A.stateDir, f), join(stateDir, f));
    cpSync(A.journalDir, join(dir, 'journal'), { recursive: true });
  } });
  later.push(B);
  const told = await waitFor(async () => (await (await fetch(`${B.base}/chats/${chat}`)).json()).messages.find(x => x.notice && /restarted/.test(x.content)), { what: 'the notice' });
  assert.match(told.content, new RegExp(`^A change that could lock you out of Spark 3 \\(record ${g.record}\\), made inside the lock-out net before Spark Console restarted, was put back at \\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\dZ: 1 went back, 0 did not\\.$`));
  assert.equal(readFileSync(keysFile(A), 'utf8'), KEYS_LINE, 'put back');
  assert.equal(newest(B).state, 'put back');
  // (said once: not also as a change the restart cut off)
  const msgs = (await (await fetch(`${B.base}/chats/${chat}`)).json()).messages;
  assert.equal(msgs.filter(x => x.notice && /cut off/.test(x.content)).length, 0, JSON.stringify(msgs.filter(x => x.notice).map(x => x.content)));
  assert.ok(statSync(keysFile(A)).isFile());
  await sleep(10);
});
