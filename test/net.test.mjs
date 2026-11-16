// Covers: the lock-out net's console half (21-net.mjs; R71, R60, R54, R61, R13, R43; design A 2.8, step A13b), switched on
// for this fleet (SPARK_CONSOLE_NET=1; off, a lock-out change waits for the net: ladder.test.mjs): a lock-out change on
// a compute Spark is done only as root (as the owner it is answered "set root"), and as root it is the dangerous ask, with what goes back and why it can lock the owner out, and nothing runs before the press; the
// press arms the Spark's own timer first (the command's time limit plus 600 s), runs the change and checks the ways in
// from outside: all still work, so code keeps it; one stopped working, so it is put back at once (and, still not
// working after the put-back, said plainly: live state the net holds no copy of, the restart the way back); no answer, so the
// Spark's own timer puts it back, the Spark stays claimed, a second lock-out change there is refused before it is
// asked, /stop leaves the timer, and /putback puts it back by the owner's word; what the net can't put back (a
// Tailscale sign-out, a sign-in as another key) is not done; a restart of Spark Console inside the window puts it back
// at start and says so. The net's seam (netGuarded, which A11's Spark 2 and A12's root call too) runs nothing with the
// net off, without the owner's press, with a time or folder out of shape, or with a guard open there.
// The stand-in fleet, with the real root helper set up and proven for Spark 3 (test/rehearsal.mjs, run: true): its
// net's copies and timer are the rehearsal's (the stand-in systemd-run keeps a waiting timer as a file), and a change
// names the owner's authorized_keys from the Spark's own folder. The ways in tried from outside: a new connection (the
// stand-in fleet's local one), the helper through its sudo line, and Spark 3 online in Tailscale's status
// ($MOCK_DIR/status.json, which a test may change while a change runs). Linux only: run it on a Spark.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync, readdirSync, statSync, symlinkSync, cpSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { T, useFleet, api, call, createActKey, newChat, say, chatMessages, waitFor, sleep, SLOW, REPO } from './lib.mjs';
import { rehearse } from './rehearsal.mjs';
import { startMock } from './start-mock.mjs';

const SECONDS = 6;
const KEYS_LINE = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIStandIn owner@mac\n';
const ADDED = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINetAdded added@net';
const later = [];
after(async () => { for (const f of later) await f.stop().catch(() => {}); });
// (a lock-out change on a compute Spark is done only as root, R70: root's switch on here, as the one-time command with
// --with-root writes it, and root's time limit this file's SECONDS)
useFleet({ env: { SPARK_CONSOLE_NET: '1', SPARK_CONSOLE_ROOT: '1', SPARK_CONSOLE_ROOT_SECONDS: String(SECONDS), SPARK_CONSOLE_RUN_SECONDS: String(SECONDS), SPARK_CONSOLE_ROUTE_MS: '1000', SPARK_CONSOLE_WIDE_MS: '1', SPARK_CONSOLE_DANGER_LATE_MS: '0' },
  prepare: ({ root }) => {
    rehearse(root, 'spark3', { run: true });
    const sw = join(root, 'var/lib/spark-console/root-on');
    mkdirSync(join(root, 'var/lib/spark-console'), { recursive: true });
    chmodSync(join(root, 'var/lib/spark-console'), 0o755);
    writeFileSync(sw, `on 2026-11-15 helper ${createHash('sha256').update(readFileSync(join(root, 'usr/local/sbin/spark-console-root'))).digest('hex')}\n`, { mode: 0o600 });
    chmodSync(sw, 0o600);
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
const RUN = (command, more = {}) => ({ name: 'run', arguments: { on: 'spark3', command, dir: '~', ...more } });
const ADD = `printf '%s\\n' '${ADDED}' >> .ssh/authorized_keys`;
// Spark 3 seen by Tailscale as offline (or as the stand-in has it, with no file).
const TAILNET = online => ({ BackendState: 'Running', Self: { HostName: 'akspark2', TailscaleIPs: ['100.64.0.2'] }, Peer: {
  'nodekey:1': { HostName: 'akspark1', TailscaleIPs: ['100.64.0.1'], Online: true }, 'nodekey:3': { HostName: 'akspark3', TailscaleIPs: ['100.64.0.3'], Online: online },
  'nodekey:4': { HostName: 'akspark4', TailscaleIPs: ['100.64.0.4'], Online: true } } });
const tailnet = online => (online ? rmSync(join(T.fleet.dir, 'status.json'), { force: true }) : writeFileSync(join(T.fleet.dir, 'status.json'), JSON.stringify(TAILNET(false))));
// One owner's message in a chat, the stand-in brain calling run once (as root unless more says otherwise: a lock-out
// change is done only as root); then the dangerous ask it raised, as the owner's page reads it (its pair), or null.
async function ask(chat, words, command, more = { root: true }) {
  script([{ match: `^${words}$`, rounds: [[RUN(command, more)]] }]);
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
  let no;
  try {
    const shown = a.m.danger.lines.join('\n');
    assert.match(shown, /^ROOT on Spark 3 · CAN LOCK YOU OUT\n/);
    assert.ok(shown.includes('It runs inside the lock-out net: unless Spark Console can still reach Spark 3 right after it (a new connection, the root helper, Tailscale), it goes back at once, and by itself 11 minutes after it starts at the latest. Files and units go back, not live network or firewall state (iptables, nft, ip, nmcli): if that cuts Spark 3 off, restarting Spark 3 is the way back.'), shown);
    assert.match(shown, /\nWhy it can lock you out: .*authorized_keys/);
    assert.equal(a.m.danger.code, ADD);
    assert.equal(keysNow(), KEYS_LINE, 'nothing ran');
    assert.equal(newest(), undefined, 'no guard');
  } finally {
    // No: nothing runs (pressed also when a line above failed, so no ask is left open for the tests after it).
    no = await press(chat, a.no.id);
  }
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
  const timer = asked.indexOf(`--unit=sw-guard-${g.id}`), change = asked.indexOf(`--unit=sw-root-${g.id}`);
  assert.ok(timer >= 0 && change > timer, `the timer first: ${asked.join(', ')}`);
  assert.ok(calls().slice(before).some(c => c[0] === 'systemd-run' && c.includes(`--unit=sw-guard-${g.id}`) && c.includes(`--on-active=${SECONDS + 600}s`)), 'its time limit plus 600 s');
  assert.ok(!timerWaits(g.id) && !existsSync(join(guardDir(g.id), 'pending')), 'kept: no timer, nothing pending');
  // The journal: a start line before, an end line after, with the guard's id.
  const rec = journalLines().filter(x => x.id === g.record);
  assert.deepEqual(rec.map(x => [Boolean(x.start), Boolean(x.end), x.class || null, x.outcome || null, x.net]), [[true, false, 'lockout', null, g.id], [false, true, null, 'kept', g.id]]);
  // Told once in the chat: the press's own answer says it, and no notice of the net's says it again.
  assert.equal((await chatMessages(chat)).filter(m => !m.danger && /it is kept\.$/.test(m.content || '')).length, 1, 'once in the chat');
});

test('a way in that worked before stops working after it: put back at once, and said; still not working after the put-back, it is said plainly: live state the net holds no copy of, and restarting the Spark is the way back', { timeout: 180000 * SLOW }, async () => {
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
    // (Spark 3 stays off the tailnet after the put-back, as a link taken down or a firewall rule loaded would leave it:
    // the helper's own words say "put back", and the owner is told the truth after them)
    assert.match(p.json.message.content, new RegExp(`^A change that could lock you out of Spark 3 \\(record ${g.record}\\) was put back at once: after it, its Tailscale connection stopped working \\(put back at \\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\dZ: 1 went back, 0 did not\\)\\. But even after the put-back, its Tailscale connection still doesn’t work: the net puts back files and units, not live network or firewall state \\(what iptables, nft, ip or nmcli change\\), and that most likely still cuts Spark 3 off\\. Restarting Spark 3 is the way back: switch its plug off and on \\(Spark Console doesn’t switch the plug of a Spark that draws power but doesn’t answer\\)\\.$`));
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
    const a = await ask(chat, words, command, {});
    assert.equal((await chatMessages(chat)).filter(x => x.danger).length, asks, `${command}: no ask`);
    const [r] = sentBack(words);
    assert.ok(String(r?.error || '').startsWith(`Not done: ${why}. `), `${command}: ${JSON.stringify(r)}`);
    assert.match(r.error, /Nothing was asked or run\.$/);
    assert.ok(a);
  }
});

// Last: it stops this file's console.
test('a lock-out change runs only when the owner asks for it in their own words (contract 8.3): an agent’s, or one after Sparkie read text from outside, is refused, never asked; a saved workflow can’t hold one; the owner’s own words are asked', { timeout: 120000 * SLOW }, async () => {
  const NOT = 'Nothing was asked or run: Sparkie changes SSH, Tailscale, the firewall or users only when you ask for it yourself; this came from';
  // An agent's key.
  const k = await createActKey('net-agent');
  const ag = await call(k.token, 'run', { on: 'spark3', command: ADD, dir: '~' });
  assert.ok(ag.isError, ag.text);
  assert.ok(ag.text.includes(`${NOT} an agent.`), ag.text);
  // Text read from outside first (a look's output), in the owner's own chat.
  const c1 = await newChat(), words = 'add my key on spark 3 after a look';
  script([{ match: `^${words}$`, rounds: [[RUN('ls ~')], [RUN(ADD)]] }]);
  try { await say(c1, words); } finally { noScript(); }
  assert.ok((sentBack(words).at(-1)?.error || '').startsWith(`${NOT} text Sparkie read first`), JSON.stringify(sentBack(words)));
  assert.ok(!(await chatMessages(c1)).some(m => m.danger), 'nothing asked');
  // Sparkie's own proposal, the owner's words asking for none.
  const c2 = await newChat(), idle = 'how is spark 3 today';
  script([{ match: `^${idle}$`, rounds: [[RUN(ADD)]] }]);
  try { await say(c2, idle); } finally { noScript(); }
  assert.ok((sentBack(idle).at(-1)?.error || '').startsWith(`${NOT} Sparkie’s own proposal, not your words asking for this on Spark 3`), JSON.stringify(sentBack(idle)));
  // A saved workflow's step: run is never one.
  const wf = await api('/actions/save_workflow', { method: 'POST', body: { title: 'add the key', steps: [{ action: 'run', args: { on: 'spark3', command: ADD } }] } });
  assert.equal(wf.status, 400, wf.text);
  assert.match(wf.json.error, /run can’t be a step in a saved workflow/);
  // The owner's own words: asked, as before.
  const c3 = await newChat(), a = await ask(c3, 'add my key on spark 3 myself', ADD);
  assert.ok(a.m, 'the dangerous ask');
  await press(c3, a.no.id);
  assert.ok(!readFileSync(join(T.fleet.root, 'spark3', '.ssh', 'authorized_keys'), 'utf8').includes(ADDED), 'nothing ran');
});

test('the owner’s words ask for a lock-out change only in one sentence that names the Spark and what to change in the lock-out class, as an instruction: a question, a change to something else, a “don’t” or another Spark is refused, never asked, and the refusal says how to ask', { timeout: 300000 * SLOW }, async () => {
  keysReset();
  // (the same lock-out command each time, the stand-in brain's own proposal: only the owner's words differ)
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const proposed = async words => {
    const chat = await newChat();
    script([{ match: `^${esc(words)}$`, rounds: [[RUN(ADD, { root: true })]] }]);
    try { await say(chat, words); } finally { noScript(); }
    const m = (await chatMessages(chat)).filter(x => x.danger).at(-1);
    return { chat, m, no: m?.choices.find(c => c.label === 'No') };
  };
  const REFUSED = 'Nothing was asked or run: Sparkie changes SSH, Tailscale, the firewall or users only when you ask for it yourself; this came from Sparkie’s own proposal, not your words asking for this on Spark 3. To ask, say it yourself in one sentence: what to change, and on which Spark. For example: “Add my laptop’s SSH key on Spark 3.”';
  for (const words of ['Why is ssh open on Spark 3?', 'Fix the build on Spark 3', 'is tailscale up on spark 3', 'don’t change ssh on spark 3', 'add my key on spark 4',
    'start a model on spark 3 with port 8000', 'tell me how to add a key on spark 3']) {
    const p = await proposed(words);
    if (p.no) await press(p.chat, p.no.id);
    assert.equal(p.m, undefined, `${words}: refused, never asked`);
    assert.equal(sentBack(words).at(-1)?.error, REFUSED, words);
  }
  assert.equal(keysNow(), KEYS_LINE, 'nothing ran');
  // True asks, in different words: still the dangerous ask (each answered No, so nothing runs).
  for (const words of ['open port 8022 on spark 3', 'allow user bob to sign in on spark 3', 'turn off Tailscale SSH on spark 3', 'can you add my laptop’s ssh key on spark 3?',
    'Please add a key for my laptop to authorized_keys on Spark 3.', 'restart sshd on spark 3', 'I can’t log in to spark 3, reset my password']) {
    const p = await proposed(words);
    assert.ok(p.m, `${words}: the dangerous ask (${JSON.stringify(sentBack(words))})`);
    assert.equal((await press(p.chat, p.no.id)).status, 200);
  }
  assert.equal(keysNow(), KEYS_LINE, 'nothing ran');
});

// The final read's ask-line-2: a true lock-out ask said "You did not ask for this.", and the message before still counted.
test('a lock-out ask the owner’s words let through says “You asked for this.”; only the current message counts, so the next message, which asks for nothing, gets no ask', { timeout: 180000 * SLOW }, async () => {
  const chat = await newChat();
  const a = await ask(chat, 'allow port 8002 through the firewall on spark 3', 'ufw allow 8002');
  assert.ok(a.m, `the dangerous ask (${JSON.stringify(sentBack('allow port 8002 through the firewall on spark 3'))})`);
  try { assert.equal(a.m.danger.lines[1], 'You asked for this.', a.m.danger.lines.join('\n')); } finally { assert.equal((await press(chat, a.no.id)).status, 200); }
  const words = 'thanks, how is the gpu doing', b = await ask(chat, words, 'ufw disable');
  if (b.no && b.m?.danger?.code === 'ufw disable') await press(chat, b.no.id);
  assert.ok(!b.m || b.m.danger.code !== 'ufw disable', 'no second ask');
  assert.match(sentBack(words).at(-1)?.error || '', /^Nothing was asked or run: Sparkie changes SSH, Tailscale, the firewall or users only when you ask for it yourself; this came from Sparkie’s own proposal, not your words asking for this on Spark 3\./);
});

// The final read's findings net-no-copy and nonroot-lockout-noop: as the owner a lock-out change ran in the run wall,
// which keeps ~/.ssh and the start files read-only (so it changed nothing), with no copy first and the model store
// writable, after a dangerous press.
test('as the owner, a lock-out change on a compute Spark asks nothing and runs nothing: it can change nothing there (it needs root), so the answer is to set root; where root is off on that Spark, the owner’s one command with --with-root', { timeout: 120000 * SLOW }, async () => {
  keysReset();
  mkdirSync(join(T.fleet.root, 'spark3', 'keepme'), { recursive: true });
  writeFileSync(join(T.fleet.root, 'spark3', 'keepme', 'data.txt'), 'precious\n');
  const AS_ROOT = 'Nothing was asked or run: as you, a change to SSH, Tailscale, the firewall or users on Spark 3 can change nothing (it needs root), so it is done only as root. Set root (run with root: true): it is then asked as root, and runs inside the lock-out net.';
  for (const [words, command] of [['add my key on spark 3 as me', ADD], ['remove my old shell aliases and the keepme folder on spark 3', 'rm -rf keepme .bash_aliases']]) {
    const chat = await newChat(), a = await ask(chat, words, command, {});
    if (a.no) await press(chat, a.no.id);
    assert.equal(a.m, undefined, `${words}: nothing asked`);
    assert.equal(sentBack(words).at(-1)?.error, AS_ROOT, words);
  }
  // (the owner's own call, POST /actions: the same answer)
  const own = await api('/actions/run', { method: 'POST', body: { on: 'spark3', command: ADD, dir: '~' } });
  assert.deepEqual([own.status, own.json?.error], [403, AS_ROOT], own.text);
  assert.equal(keysNow(), KEYS_LINE, 'nothing ran');
  assert.equal(readFileSync(join(T.fleet.root, 'spark3', 'keepme', 'data.txt'), 'utf8'), 'precious\n', 'nothing ran');
  // Root off on Spark 3: the owner's one command with --with-root, and nothing asked.
  const sw = join(T.fleet.root, 'var/lib/spark-console/root-on');
  renameSync(sw, `${sw}.away`);
  try {
    const off = await api('/actions/run', { method: 'POST', body: { on: 'spark3', command: ADD, dir: '~' } });
    assert.equal(off.status, 200, off.text);
    assert.equal(off.json.ran, false, off.text);
    assert.match(off.json.ownerCommand || '', /root-for-sparkie\.sh --with-root 3'?$/, off.text);
  } finally { renameSync(`${sw}.away`, sw); }
  assert.equal(keysNow(), KEYS_LINE, 'nothing ran');
});

test('with no root helper on a Spark, a lock-out change answers with the owner’s one command, and nothing is asked', { timeout: 60000 * SLOW }, async () => {
  const n = await api('/actions/run', { method: 'POST', body: { on: 'spark4', command: 'chmod 600 ~/.ssh/authorized_keys', dir: '~' } });
  assert.equal(n.status, 200, n.text);
  assert.equal(n.json.ran, false, n.text);
  assert.match(n.json.ownerCommand || '', /root-for-sparkie\.sh 4'?$/, n.text);
});

test('a write_file to a way in is refused, never a net ask: the net runs only a plain command (step-train; before the restart below, which stops this fleet)', { timeout: 60000 * SLOW }, async () => {
  const w = await api('/actions/write_file', { method: 'POST', body: { on: 'spark3', path: '~/.ssh/authorized_keys', text: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOther other@else\n' } });
  assert.equal(w.status, 403, w.text);
  assert.match(w.json.error, /^Nothing ran: a change that can lock you out of Spark 3 runs only as a plain command inside the lock-out net, never as write_file\./);
});

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

test('the net’s seam (netGuarded, A11 and A12 call it too): nothing runs with the net off, without the owner’s press, a time or folder out of shape, or a guard open there; past those it takes the Spark’s claim, Spark 2 as any other', async () => {
  const src = readFileSync(join(REPO, 'service', 'src', '21-net.mjs'), 'utf8');
  const fn = /^async function netGuarded\([\s\S]*?\n\}$/m.exec(src)?.[0];
  assert.ok(fn, 'netGuarded');
  class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
  const open = new Map([['spark4', { id: 'g1', record: 'j_1', goesBackAt: '2026-11-15T17:00:00Z' }]]);
  const make = on => new Function('NET_ON', 'HttpError', 'sparkName', 'netOpenOn', 'netHhmm', 'RUNNER_DIR', 'RUNNER_SECONDS', 'randomBytes', 'claimSparks', `${fn}\nreturn netGuarded;`)(
    on, HttpError, n => `Spark ${n.id.slice(5)}`, s => open.get(s) || null, () => '17:00 UTC', '~/work', 1800, () => Buffer.from('0123456789ab'), s => { throw new Error(`claimed ${s.join(',')}`); });
  const pressed = { button: true, ownerConfirmed: true };
  const refused = (p, status, words) => assert.rejects(p, e => e.status === status && words.test(e.message));
  await refused(make(false)({ id: 'spark3' }, 'true', { ctx: pressed }), 403, /^Nothing ran: the lock-out net is off/);
  const seam = make(true);
  await refused(seam({ id: 'spark3' }, 'true', {}), 403, /only the owner’s yes/);
  await refused(seam({ id: 'spark3' }, 'true', { ctx: { button: true } }), 403, /only the owner’s yes/);
  for (const seconds of [0, 1801, 1.5, '60']) await refused(seam({ id: 'spark3' }, 'true', { ctx: pressed, seconds }), 400, /1 to 1,800 seconds/);
  for (const dir of ['/etc', '~/../x', '~/a/./b', 'work']) await refused(seam({ id: 'spark3' }, 'true', { ctx: pressed, dir }), 400, /starts in ~ or a folder under it/);
  await refused(seam({ id: 'spark4' }, 'true', { ctx: pressed }), 409, /still open there \(record j_1\)/);
  // (past its gates the seam takes the Spark's claim: Spark 2 as any other, its caller having said yes)
  for (const [id, node, root] of [['spark2', { id: 'spark2', host: 'local' }, false], ['spark3', { id: 'spark3' }, true]]) await assert.rejects(seam(node, 'true', { ctx: pressed, seconds: 600, dir: '~', root }), e => e.message === `claimed ${id}`);
  // (on a compute Spark only as root: as the owner a lock-out change can change nothing)
  await refused(seam({ id: 'spark3' }, 'true', { ctx: pressed, seconds: 600, dir: '~' }), 403, /^Nothing ran: on Spark 3 a change inside the lock-out net runs only as root\.$/);
});

// The owner's words for a lock-out change (netWhose, netAsks; R71), as code: built from the parts as the service has them,
// with a stand-in chat. Only the newest message the owner typed counts: not the one before, not a carry-on turn's (its
// newest message is marked auto), not "carry on".
const wordsTest = () => {
  const acts = readFileSync(join(REPO, 'service', 'src', '16-actions.mjs'), 'utf8'), net = readFileSync(join(REPO, 'service', 'src', '21-net.mjs'), 'utf8');
  const grab = (src, name) => { const m = new RegExp(`^const ${name} = [\\s\\S]*?;\\n(?=\\S)`, 'm').exec(src); assert.ok(m, name); return m[0]; };
  const fn = name => { const m = new RegExp(`^function ${name}\\([\\s\\S]*?\\n\\}$`, 'm').exec(net); assert.ok(m, name); return m[0]; };
  const consts = net.match(/^const NET_[A-Z_]+ = /gm).map(x => x.slice(6, -3)).filter(n => !['NET_ON', 'NET_FILE', 'NET_AFTER_S', 'NET_PROBES', 'NET_LIVE', 'NET_OPEN'].includes(n) && !/^NET_(?:SLACK|KEPT|LATE)/.test(n));
  const chats = { conversations: [] };
  const code = ['normQuotes', 'GENERIC', 'BARE_SPARKS', 'sparkNames', 'tokensOf', 'INFO_START'].map(n => grab(acts, n)).join('')
    + consts.map(n => grab(net, n)).join('') + ['netAsks', 'netWhose', 'netNowSaid'].map(fn).join('\n') + '\nreturn { netAsks, netWhose };';
  return { chats, ...new Function('NODES', 'chatData', 'sparkName', code)([{ id: 'spark3' }, { id: 'spark4' }], () => chats, n => `Spark ${n.id.slice(5)}`) };
};

test('only the owner’s current message asks for a lock-out change: the message before, a carry-on turn’s and “carry on” never do', () => {
  const { chats, netWhose } = wordsTest(), node = { id: 'spark3' };
  const say = (...msgs) => { chats.conversations = [{ id: 'c1', messages: msgs.map(m => (typeof m === 'string' ? { role: 'user', content: m } : { role: 'user', ...m })) }]; return netWhose(node, { role: 'owner' }, { via: 'sparkie', conv: 'c1', reads: [] }); };
  assert.equal(say('allow port 8002 through the firewall on spark 3'), null);
  assert.match(say('allow port 8002 through the firewall on spark 3', 'thanks, how is the gpu doing'), /^Sparkie’s own proposal/);
  assert.match(say('allow port 8002 through the firewall on spark 3', { content: 'allow port 8002 through the firewall on spark 3', auto: true }), /^Sparkie’s own proposal/, 'a carry-on turn');
  assert.match(say('allow port 8002 through the firewall on spark 3', 'carry on'), /^Sparkie’s own proposal/);
  assert.match(say('allow port 8002 through the firewall on spark 3', { content: 'allow port 8002 through the firewall on spark 3', from: 'helper-agent' }), /^Sparkie’s own proposal/, 'an agent’s message');
});

// The final read's net-asks-port: work sentences that name a way in only as a place or inside another thing's name.
test('a way-in word counts only as what the verb changes: not after a place word (on, in, of, from, at), not as part of another thing’s name', () => {
  const { netAsks } = wordsTest(), node = { id: 'spark3' };
  for (const s of ['Start the app on port 8080 on Spark 3', 'Build the app in the access folder on spark 3', 'Fix the shell script in ~/work on spark 3',
    'Update my profile picture script on spark 3', 'Install the ssh extension for vscode on spark 3', 'update the network drivers on spark 3',
    'create a group chat app on spark 3', 'Rename the users table in the db on spark 3', 'make a password generator on spark 3']) assert.equal(netAsks(node, s), false, s);
  for (const s of ['open port 8022 on spark 3', 'allow user bob to sign in on spark 3', 'turn off Tailscale SSH on spark 3', 'can you add my laptop’s ssh key on spark 3?',
    'Please add a key for my laptop to authorized_keys on Spark 3.', 'restart sshd on spark 3', 'I can’t log in to spark 3, reset my password',
    'add bob to the sudo group on spark 3', 'add an alias to my .bashrc on spark 3', 'change the firewall rules on spark 3', 'change the password of bob on spark 3']) assert.equal(netAsks(node, s), true, s);
});
