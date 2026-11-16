// Covers: the lock-out net's console half (21-net.mjs; R71, R60, R54, R61, R13, R43; design A 2.8, step A13b), on as in
// the build (only SPARK_CONSOLE_NET=0 turns it off; off, a lock-out change waits for the net: ladder.test.mjs): a lock-out change on
// a compute Spark is done only as root (as the owner it is answered "set root"), and as root it is the dangerous ask, with what goes back and why it can lock the owner out, and nothing runs before the press; the
// press arms the Spark's own timer first (the command's time limit plus 600 s), runs the change and checks the ways in
// from outside: all still work, so code keeps it; one stopped working, so it is put back at once (and, still not
// working after the put-back, said plainly: what the net puts back and what it doesn't, and what a restart clears); no answer, so the
// Spark's own timer puts it back, the Spark stays claimed, a second lock-out change there is refused before it is
// asked, /stop leaves the timer, and /putback puts it back by the owner's word; what the net can't put back (a
// Tailscale sign-out, a sign-in as another key) is not done; a restart of Spark Console inside the window puts it back
// at start and says so; a new connection and the helper down before the press: nothing runs; down after it: left to
// the Spark's own timer, said, the Spark claimed. Only the owner's own words ask (one sentence of their current message,
// netAsks); a write_file to a way in is refused. The net's seam (netGuarded, which A11's Spark 2 and A12's root call too)
// runs nothing with the net off, without the owner's press, with a time or folder out of shape, or with a guard open
// there, and passes --lockout for the lock-out class.
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
// --with-root writes it, and root's time limit this file's SECONDS; the journal's full-disk stand-in, mock/disk-full.mjs,
// acts only while its flag is there)
useFleet({ env: { NODE_OPTIONS: `--import=${join(REPO, 'test', 'mock', 'disk-full.mjs')}`, SPARK_CONSOLE_NET: '1', SPARK_CONSOLE_ROOT: '1', SPARK_CONSOLE_ROOT_SECONDS: String(SECONDS), SPARK_CONSOLE_RUN_SECONDS: String(SECONDS), SPARK_CONSOLE_ROUTE_MS: '1000', SPARK_CONSOLE_WIDE_MS: '1', SPARK_CONSOLE_DANGER_LATE_MS: '0' },
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
    assert.ok(shown.includes('It runs inside the lock-out net: unless Spark Console can still reach Spark 3 right after it (a new connection, the root helper, Tailscale), it goes back at once, and by itself 11 minutes after it starts at the latest. Only the ways-in files and units copied first go back: not live firewall or network state (iptables, nft, ip, nmcli), which a restart clears, nor anything else it changes.'), shown);
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
    assert.match(p.json.message.content, new RegExp(`^A change that could lock you out of Spark 3 \\(record ${g.record}\\) was put back at once: after it, its Tailscale connection stopped working \\(put back at \\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\dZ: 1 went back, 0 did not\\)\\. But even after the put-back, its Tailscale connection still doesn’t work: the net puts back only the ways-in files and units it copied first, not live firewall or network state \\(what iptables, nft, ip or nmcli change\\), nor anything else the change did, so something it doesn’t put back still cuts Spark 3 off\\. Restarting Spark 3 clears live firewall and network state: switch its plug off and on \\(Spark Console doesn’t switch the plug of a Spark that draws power but doesn’t answer\\)\\. A restart undoes nothing else the change did\\.$`));
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

// The final read's set-root-dead-end: "sudo ufw …" was answered "set root", and the same command with root set was then
// refused as "text Sparkie read first", though the refused call ran and read nothing.
test('a refused call reads nothing: after “leave out sudo and set root”, or “set root”, the same command as root is the dangerous ask', { timeout: 180000 * SLOW }, async () => {
  for (const [words, first] of [['allow port 8000 through the firewall on spark 3', RUN('sudo ufw allow 8000')], ['allow port 8004 through the firewall on spark 3', RUN('ufw allow 8004')]]) {
    const chat = await newChat(), port = words.match(/\d{4}/)[0];
    script([{ match: `^${words}$`, rounds: [[first], [RUN(`ufw allow ${port}`, { root: true })]] }]);
    try { await say(chat, words); } finally { noScript(); }
    const m = (await chatMessages(chat)).filter(x => x.danger).at(-1);
    const rounds = lines(join(T.fleet.dir, 'model-requests.jsonl')).filter(x => x.words === words && x.lastRole === 'tool').map(x => (x.results || []).map(r => String(r.content)));
    try {
      assert.match(rounds[0]?.[0] || '', /^\[error\] Nothing (?:ran: a command becomes root only by setting root|was asked or run: as you, a change to SSH)/, JSON.stringify(rounds));
      assert.ok(m && m.danger.code === `ufw allow ${port}`, `the dangerous ask: ${JSON.stringify(rounds)}`);
    } finally { const no = m?.choices.find(c => c.label === 'No' && c.state === 'open'); if (no) await press(chat, no.id); }
  }
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

// R1-10 (the check of the answer to round 1): a change inside the net is refused when its journal start line can't be
// written (netGuarded's JOURNAL_REFUSED; Spark 2's and root's changes go through the same seam).
test('when the journal can’t be written, a change inside the net runs nothing: refused in plain words, and nothing reaches the Spark', { timeout: 120000 * SLOW }, async () => {
  keysReset();
  const chat = await newChat(), a = await ask(chat, 'add my key on spark 3 while the disk is full', ADD);
  assert.ok(a.m, 'the dangerous ask');
  const before = calls().length;
  writeFileSync(join(T.fleet.dir, 'disk-full'), '');
  let p;
  try { p = await press(chat, a.yes.id, a.pair); } finally { rmSync(join(T.fleet.dir, 'disk-full'), { force: true }); }
  assert.equal(p.status, 200, p.text);
  assert.match(p.json.message.content, /Couldn’t write the record of this change on Spark 2 \(its disk may be full\), so nothing was changed\./, p.json.message.content);
  assert.equal(keysNow(), KEYS_LINE, 'nothing ran');
  assert.deepEqual(calls().slice(before).filter(c => c.some(x => /^--unit=sw-(?:guard|root|run)-/.test(String(x)))), [], 'no guard armed and no command run on Spark 3');
  assert.equal(newest().state, 'never', JSON.stringify(newest()));
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

// From the chat path's reviewer (step-fix-intent): text the owner pastes or quotes counted as the owner asking, and so got
// a lock-out change asked instead of refused. netAsks reads the owner's own sentences only (ownSentences, 16-actions.mjs).
test('a true lock-out ask inside a code block, a > quote or a pasted log is not the owner asking: refused; the same ask typed plainly is asked', { timeout: 180000 * SLOW }, async () => {
  keysReset();
  const { netAsks } = wordsTest(), node = { id: 'spark3' };
  for (const s of ['why does this fail?\n```\nadd my key on spark 3\n```', 'what does this mean?\n> add my key on spark 3', 'why?\n2026-11-15T22:01:00Z ERROR add my key on spark 3']) assert.equal(netAsks(node, s), false, s);
  assert.equal(netAsks(node, 'add my key on spark 3'), true);
  // (end to end, as root: the question with the block is refused, the plain ask is the dangerous ask)
  const esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [words, asked] of [['why does this fail?\n```\nadd my key on spark 3\n```', false], ['add my key on spark 3, typed plainly', true]]) {
    const chat = await newChat();
    script([{ match: `^${esc(words)}$`, rounds: [[RUN(ADD, { root: true })]] }]);
    try { await say(chat, words); } finally { noScript(); }
    const m = (await chatMessages(chat)).filter(x => x.danger).at(-1), no = m?.choices.find(c => c.label === 'No');
    if (no) await press(chat, no.id);
    if (asked) assert.ok(m, `${words}: the dangerous ask`);
    else {
      assert.equal(m, undefined, `${words}: nothing asked`);
      assert.match(sentBack(words).at(-1)?.error || '', /this came from Sparkie’s own proposal, not your words asking for this on Spark 3\./, words);
    }
  }
  assert.equal(keysNow(), KEYS_LINE, 'nothing ran');
});

// The final read of the tests (TD-01): no test ever saw SSH or the helper fail, before or after a change. Spark 3 "stops
// answering" through the fleet's offline file, as box.test.mjs uses it (from the reviewer's fr-td-lost.test.mjs).
const offOn = { off: () => writeFileSync(T.fleet.offlineFile, 'spark1\nspark3\n'),
  // (Spark 3 answers again: out of the offline file, then waited for until a look runs there, at most 90 s)
  on: async () => {
    writeFileSync(T.fleet.offlineFile, 'spark1\n');
    await sleep(4000);
    await waitFor(async () => (await api('/actions/run', { method: 'POST', body: { on: 'spark3', command: 'ls ~' } })).json?.ran === true, { timeout: 90000, every: 2000, what: 'a look on Spark 3 to run again' });
  } };
test('Spark 3 doesn’t answer a new connection when the press comes: nothing runs, and no guard goes on record', { timeout: 240000 * SLOW }, async () => {
  keysReset();
  const chat = await newChat(), a = await ask(chat, 'add my key on spark 3 while it is dark', ADD);
  assert.ok(a.m && a.yes && a.pair, 'the dangerous ask');
  const seen = netRecord().length;
  offOn.off();
  let p;
  try { p = await press(chat, a.yes.id, a.pair); } finally { await offOn.on(); }
  assert.match(String(p.json?.message?.content ?? p.text), /Spark 3 doesn’t answer a new connection now, so nothing ran\./, p.text);
  assert.equal(keysNow(), KEYS_LINE, 'nothing ran');
  assert.equal(netRecord().length, seen, 'no guard on record');
});

test('the change runs and then Spark 3 stops answering a new connection and the helper: not kept; the put-back can’t reach it, so its own timer is left to put it back, that is said, Spark 3 stays claimed, and /putback puts it back once it answers', { timeout: 300000 * SLOW }, async () => {
  keysReset();
  const chat = await newChat(), a = await ask(chat, 'add my key on spark 3 before it goes dark', `${ADD}; sleep 4`);
  assert.ok(a.m && a.yes && a.pair, 'the dangerous ask');
  const seen = netRecord().length, pressing = press(chat, a.yes.id, a.pair);
  let g;
  try {
    await waitFor(() => netRecord().length > seen && existsSync(join(guardDir(newest().id), 'pending')), { every: 100, timeout: 60000, what: 'the guard armed' });
    offOn.off();
    const p = await pressing;
    g = newest();
    assert.equal(p.status, 200, p.text);
    assert.equal(g.state, 'timer', JSON.stringify(g));
    assert.match(p.json.message.content, new RegExp(`^A change that could lock you out of Spark 3 \\(record ${g.record}\\) broke a new SSH connection, the root helper through its sudo line, and the put-back couldn’t reach Spark 3: its own timer puts it back at \\d\\d:\\d\\d UTC\\. Spark 3 stays claimed until then\\.$`), p.json.message.content);
    assert.ok(keysNow().includes(ADDED), 'the change is still there: nothing could put it back from outside');
    assert.ok(timerWaits(g.id), 'its timer still waits');
  } finally { await pressing.catch(() => {}); await offOn.on(); }
  // Still claimed once it answers again: a plain change there meets the net's claim.
  let plain;
  await waitFor(async () => { plain = await api('/actions/run', { method: 'POST', body: { on: 'spark3', command: 'touch fr-td-note.txt' } }); return plain.status === 409 && /a change inside the lock-out net/.test(plain.json?.error || ''); },
    { timeout: 60000, every: 2000, what: `the net’s claim on Spark 3 (${plain?.status} ${plain?.text?.slice(0, 200)})` });
  // The owner's /putback reaches it now.
  const w = await say(chat, '/putback');
  assert.match(w.text, new RegExp(`^/putback\\nPut back: the newest change made inside the lock-out net, on Spark 3 \\(record ${g.record}\\), at `), w.text);
  assert.equal(keysNow(), KEYS_LINE, 'put back');
  assert.equal(newest().state, 'put back');
});

// A lead from the final read of the tests: minutes given with a lock-out command was neither refused nor used.
test('a lock-out command given minutes is refused in plain words, nothing asked or run', { timeout: 60000 * SLOW }, async () => {
  keysReset();
  const r = await api('/actions/run', { method: 'POST', body: { on: 'spark3', command: ADD, dir: '~', minutes: 5 } });
  assert.deepEqual([r.status, r.json?.error], [403, 'Nothing was asked or run: a change to SSH, Tailscale, the firewall or users on Spark 3 runs only as root, inside the lock-out net, held to 10 minutes, so it takes no minutes. Leave out minutes and set root.'], r.text);
  assert.equal(keysNow(), KEYS_LINE, 'nothing ran');
});

// From the helper's builder: a call whose unit never started is refused by the helper after the net's own lines. The
// guard was left armed on the Spark until its timer, and blocked the next change there.
test('a change whose unit never starts runs nothing: said so, its guard taken away at once, and the next change there runs', { timeout: 180000 * SLOW }, async () => {
  keysReset();
  const knob = join(T.fleet.root, 'standin', 'start-fails');
  const chat = await newChat(), a = await ask(chat, 'add my key on spark 3 though systemd fails', ADD);
  assert.ok(a.m && a.yes, 'the dangerous ask');
  mkdirSync(dirname(knob), { recursive: true });
  writeFileSync(knob, 'sw-root- 226\n');
  let p;
  try { p = await press(chat, a.yes.id, a.pair); } finally { rmSync(knob, { force: true }); }
  assert.equal(p.status, 200, p.text);
  assert.match(p.json.message.content, /Nothing ran on Spark 3: its unit never started \(systemd answered 226\), so the command never ran\. The net it had armed there was taken away again, so Spark 3 is free for the next change\./, p.json.message.content);
  const g = newest();
  assert.equal(g.state, 'never', JSON.stringify(g));
  assert.equal(keysNow(), KEYS_LINE, 'nothing ran');
  assert.ok(!timerWaits(g.id) && !existsSync(join(guardDir(g.id), 'pending')), 'no guard left armed on Spark 3');
  // (the next change there: asked and, pressed, kept; not refused for a guard still open)
  const b = await ask(chat, 'add my key on spark 3 right after', ADD);
  assert.ok(b.m && b.yes, `the second dangerous ask: ${JSON.stringify(sentBack('add my key on spark 3 right after'))}`);
  const q = await press(chat, b.yes.id, b.pair);
  assert.equal(q.status, 200, q.text);
  assert.match(q.json.message.content, /: it is kept\.$/, q.json.message.content);
  assert.equal(keysNow(), `${KEYS_LINE}${ADDED}\n`);
});

// It kills this file's console: only the tests that need no fleet come after it.
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
  const own = /^function ownSentences\([\s\S]*?\n\}$/m.exec(acts)?.[0] || 'function ownSentences(t) { return t; }';
  const code = ['normQuotes', 'GENERIC', 'BARE_SPARKS', 'sparkNames', 'tokensOf', 'INFO_START', 'OWN_QUOTE_WORDS', 'OWN_PASTED'].map(n => grab(acts, n)).join('') + own
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

// The final read's ssh-probe: with the console's SSH shared (a ControlMaster in its ssh settings), the check after a change
// would ride an old connection that a firewall rule dropping new ones lets through.
test('the net’s check that a new SSH connection still works asks ssh for a new one, never a shared one', async () => {
  const ssh = readFileSync(join(REPO, 'service', 'src', '02-ssh.mjs'), 'utf8'), net = readFileSync(join(REPO, 'service', 'src', '21-net.mjs'), 'utf8');
  const spawnSrc = /^function spawnOn\([\s\S]*?\n\}$/m.exec(ssh)?.[0], probeSrc = /^async function netProbe\([\s\S]*?\n\}$/m.exec(net)?.[0];
  assert.ok(spawnSrc && probeSrc, 'spawnOn and netProbe');
  const seen = [], child = { on() {}, stdin: { end() {} } };
  const spawnOn = new Function('ALL_LOCAL', 'offlineNow', 'process', 'PATH_FIRST', 'PREAMBLE', 'CONFIG', 'spawn', `${spawnSrc}\nreturn spawnOn;`)(
    false, () => false, process, '', '', { user: 'u' }, (cmd, args) => { seen.push(args.join(' ')); return child; });
  spawnOn({ id: 'spark3', host: '100.64.0.3' }, { script: 'echo net-ok', limit: 25, fresh: true });
  spawnOn({ id: 'spark3', host: '100.64.0.3' }, { script: 'echo net-ok', limit: 25 });
  assert.match(seen[0], / -o ControlMaster=no -o ControlPath=none u@100\.64\.0\.3 /, seen[0]);
  assert.doesNotMatch(seen[1], /Control/, 'only where it is asked for');
  const asked = [];
  const netProbe = new Function('run', 'helperCall', 'netTailnet', `${probeSrc}\nreturn netProbe;`)(
    (n, s, o) => { asked.push([s, o]); return Promise.resolve({ code: 0, out: 'net-ok' }); }, () => Promise.resolve({ id: 'x', out: '' }), () => Promise.resolve(true));
  await netProbe({ id: 'spark3' });
  assert.deepEqual(asked.map(([s, o]) => [s, o?.fresh]), [['echo net-ok', true]]);
});

// The final read's putback-newest: a kept guard made after an open one (on another Spark) hid the open one from /putback.
test('/putback puts back the newest guard still open, never stopping at a newer one that was kept', async () => {
  const src = readFileSync(join(REPO, 'service', 'src', '21-net.mjs'), 'utf8'), fn = /^async function netPutbackWord\([\s\S]*?\n\}$/m.exec(src)?.[0];
  assert.ok(fn, 'netPutbackWord');
  const guards = [{ id: 'g3', spark: 'spark3', state: 'open', record: 'j_3', goesBackAt: '2099-01-01T00:00:00Z' }, { id: 'g4', spark: 'spark4', state: 'kept', record: 'j_4' }];
  const called = [], marks = [];
  const make = () => new Function('netNow', 'NET_OPEN', 'maskSecrets', 'nodeById', 'sparkName', 'guardAnswer', 'guardCall', 'netMark', 'netUnhold', 'netStillLost', 'netStillWords', 'NET_SLACK_MS', 'netHhmm', 'NET_LIVE', 'netRestart', `${fn}\nreturn netPutbackWord;`)(
    () => ({ guards }), ['arming', 'open', 'timer'], s => s, id => ({ id }), n => `Spark ${n.id.slice(5)}`, (id, out) => ({ putBackAt: out }),
    (node, verb, { id }) => { called.push([node.id, verb, id]); return Promise.resolve({ out: '2026-11-15T22:00:00Z: 1 went back, 0 did not' }); },
    (id, f) => marks.push([id, f.state]), () => {}, () => Promise.resolve([]), () => '', 60000, () => '22:00 UTC', '', () => '');
  const said = await make()();
  assert.deepEqual(called, [['spark3', 'putback', 'g3']], said);
  assert.match(said, /^Put back: the newest change made inside the lock-out net, on Spark 3 \(record j_3\)/);
  assert.deepEqual(marks, [['g3', 'put back']]);
});

// The final read's net-output: every leading and trailing line that began with the call's id was dropped, and a command
// can read its id from its own path, so it could keep lines out of the journal and the brain's view.
test('what a command inside the net printed keeps its own lines that begin with the call’s id; only the helper’s own lines come out', () => {
  const src = readFileSync(join(REPO, 'service', 'src', '21-net.mjs'), 'utf8');
  const part = name => new RegExp(`^(?:const ${name} = .*;|function ${name}\\([\\s\\S]*?\\n\\})$`, 'm').exec(src)?.[0];
  const netOutput = new Function(`${part('NET_OWN_END')}\n${part('netOutput')}\nreturn netOutput;`)();
  const id = 'abcdef0123456789abcdef01', L = (...xs) => `${xs.join('\n')}\n`;
  assert.equal(netOutput(id, L(`${id} net armed: the ways in go back at 2026-11-15T22:11:00Z unless they are kept`, `${id} as root: sw-root-${id} runs the command whose SHA-256 is 00, inside the net`,
    'hello', `${id} net open: made up by the command`, `${id} end 0`, `${id} net open: nothing differs now; it is kept on the console's word, else at 22:11 what differs then goes back`, `${id} end 0`)),
  ['hello', `${id} net open: made up by the command`, `${id} end 0`].join('\n'));
  assert.equal(netOutput(id, L(`${id} net armed: x unless they are kept`, 'out', `${id} net: sshd -t refuses the changed /etc/ssh (bad), so what differs goes back now`, `${id} net put back at 2026-11-15T22:00:00Z: 1 went back, 0 did not`, `${id} end 0`)), 'out');
  // (cut off, no end line: nothing at the end is taken for the helper's)
  assert.equal(netOutput(id, L(`${id} net armed: x unless they are kept`, 'out', `${id} net open: y`)), ['out', `${id} net open: y`].join('\n'));
});

// The final read's net-claim-restart: after a console restart a guard left to its timer held no claim on its Spark.
test('after a restart, a guard its Spark didn’t answer for keeps that Spark claimed until its time, then is looked at again', async () => {
  const src = readFileSync(join(REPO, 'service', 'src', '21-net.mjs'), 'utf8'), fn = /^async function netRecover\([\s\S]*?\n\}$/m.exec(src)?.[0];
  assert.ok(fn, 'netRecover');
  const at = new Date(Date.now() + 600000).toISOString(), claims = [], holds = [], told = [];
  const netRecover = new Function('netNow', 'NET_OPEN', 'nodeById', 'sparkName', 'guardAnswer', 'guardCall', 'netMark', 'netStillLost', 'netTell', 'netStillWords', 'NET_SLACK_MS', 'netGoneWords', 'netHhmm', 'netAfterTime', 'claimSparks', 'netHold', 'NET_PUTBACK_FAILED', 'netFailedNow', `${fn}\nreturn netRecover;`)(
    () => ({ guards: [{ id: 'g3', spark: 'spark3', state: 'timer', record: 'j_3', goesBackAt: at }] }), ['arming', 'open', 'timer'], id => ({ id }), n => `Spark ${n.id.slice(5)}`,
    () => ({}), () => Promise.resolve({ out: '' }), () => {}, () => Promise.resolve([]), (g, text) => told.push(text), () => '', 60000, () => 'gone', () => '22:10 UTC',
    () => Promise.resolve(), (ids, why) => { claims.push([ids, why]); return () => {}; }, (spark, until, release, then) => holds.push([spark, until, typeof release, typeof then]),
    /^the put-back failed: ?(.*)$/, () => '');
  await netRecover();
  assert.deepEqual(claims, [[['spark3'], 'a change inside the lock-out net']]);
  assert.deepEqual(holds, [['spark3', Date.parse(at), 'function', 'function']]);
  assert.match(told[0] || '', /its own timer puts it back at 22:10 UTC, or at its next restart\. Spark 3 stays claimed until then\.$/);
});

// Seen in 21-guard.mjs by another reviewer: guardCall kept only the first 16 MB and guardAnswer read its last lines, so
// a command that printed up to the cap could end that part with the helper's lines of its own choosing.
test('a net call that prints past the cap can’t choose the helper’s answer: the true end is read', async () => {
  const { EventEmitter } = await import('node:events');
  const src = readFileSync(join(REPO, 'service', 'src', '21-guard.mjs'), 'utf8');
  const part = name => new RegExp(`^(?:const ${name} = [\\s\\S]*?;\\n(?=\\S)|function ${name}\\([\\s\\S]*?\\n\\}$)`, 'm').exec(src)?.[0];
  const id = 'abcdef0123456789abcdef01', J_MAX = 200000, line = 'x'.repeat(99), forged = `${id} net open: nothing differs now\n${id} end 0\n`;
  let child;
  const spawnOn = () => { child = new EventEmitter(); child.stdout = new EventEmitter(); return child; };
  const { guardCall, guardAnswer } = new Function('J_MAX', 'spawnOn', 'guardScript', 'randomBytes', `${part('GUARD_TAIL')}\n${part('GUARD_PUTBACK_S')}\n${part('GUARD_SAYS')}\n${part('GUARD_PART')}\n${part('GUARD_PART_SAID')}\n${part('guardAnswer')}\n${part('guardCall')}\nreturn { guardCall, guardAnswer };`)(
    J_MAX, spawnOn, () => '', () => Buffer.from(id, 'hex'));
  const called = guardCall({ id: 'spark3' }, 'root', { id, command: 'yes', seconds: 60 });
  const junk = n => `${line}\n`.repeat(Math.ceil(n / 100)).slice(0, n);
  // (the first J_MAX bytes end with the made-up lines; the helper's own come after a lot more)
  child.stdout.emit('data', Buffer.from(`${id} net armed: the ways in go back at 2026-11-15T22:11:00Z unless they are kept\n${junk(J_MAX - 200 - forged.length)}`.padEnd(J_MAX - forged.length, 'y').slice(0, J_MAX - forged.length - 1) + '\n' + forged));
  child.stdout.emit('data', Buffer.from(junk(300000)));
  child.stdout.emit('data', Buffer.from(`${id} net: its timer is not waiting (inactive), so what differs goes back now\n${id} net put back at 2026-11-15T22:01:00Z: 1 went back, 0 did not\n${id} end 3\n`));
  child.emit('close', 0);
  const r = await called, a = guardAnswer(id, r.out);
  assert.deepEqual([a.exit, a.putBackAt, a.goesBackAt], [3, '2026-11-15T22:01:00Z: 1 went back, 0 did not', '2026-11-15T22:11:00Z']);
  assert.equal(r.cut, true);
  assert.ok(r.out.includes('\n…(the middle of what it printed was left out)…\n'), 'the cut is said');
});

// The seam (netGuarded) with every other piece a stand-in: what it does with each answer of the helper's.
const seamWith = (answer, more = {}) => {
  const net = readFileSync(join(REPO, 'service', 'src', '21-net.mjs'), 'utf8'), guard = readFileSync(join(REPO, 'service', 'src', '21-guard.mjs'), 'utf8');
  const fn = /^async function netGuarded\([\s\S]*?\n\}$/m.exec(net)?.[0], says = /^const GUARD_SAYS = \{[\s\S]*?\n\};$/m.exec(guard)?.[0], reads = [/^const GUARD_PART = .*;$/m, /^const GUARD_PART_SAID = .*;$/m].map(re => re.exec(guard)?.[0] || '').join('\n') + '\n' + /^function guardAnswer\([\s\S]*?\n\}$/m.exec(guard)?.[0];
  const out = /^function netOutput\([\s\S]*?\n\}$/m.exec(net)?.[0], ends = /^const NET_OWN_END = .*;$/m.exec(net)?.[0], why = (/^const netWhyBack = [\s\S]*?;\n(?=\S)/m.exec(net)?.[0] || '') + (/^const netPartWords = .*;$/m.exec(net)?.[0] || '');
  assert.ok(fn && says && reads && out && ends, 'the seam and its readers');
  const seen = { verbs: [], told: [], held: [], marks: [] };
  class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
  const stubs = { NET_ON: true, HttpError, sparkName: n => `Spark ${n.id.slice(5)}`, netOpenOn: () => null, netHhmm: () => '22:10 UTC', RUNNER_DIR: '~/work', RUNNER_SECONDS: 30,
    NET_LATE_MS: 45000, randomBytes: () => Buffer.from('abcdef0123456789abcdef01', 'hex'), claimSparks: () => () => {}, NET_PROBES: { ssh: 'a new SSH connection', helper: 'the root helper', tailnet: 'its Tailscale connection' },
    memNow: async () => ({ total: 128 * 2 ** 30, available: 100 * 2 ** 30 }), KEEP_FREE: 8 * 2 ** 30, netProbe: async () => ({ ssh: true, helper: true, tailnet: true }), netHelperFirst: async () => ({}), netSave: () => {}, NET_AFTER_S: 600, journal: () => 'j_000000000001', jSub: () => null,
    netMark: (id, f) => seen.marks.push(f.state || null), JOURNAL_REFUSED: 'no record', run: async () => ({ code: 0, out: '' }), lookClean: s => s, forBrain: s => ({ text: s }),
    netTell: (g, text) => seen.told.push(text), netHold: (spark) => seen.held.push(spark), netAfterTime: () => {}, netStillLost: async () => [], netStillWords: () => '', tripBreaker: () => {}, jErr: e => e.message, maskSecrets: s => s,
    guardCall: async (node, verb) => { seen.verbs.push(verb); return { out: verb === 'keep' ? 'abcdef0123456789abcdef01 kept: it stays\n' : answer }; }, ...more };
  const scope = new Proxy(stubs, { has: (t, k) => k in t });
  const netGuarded = new Function('scope', `with (scope) { ${says}\n${reads}\n${ends}\n${out}\n${why}\n${fn}\nreturn netGuarded; }`)(scope);
  return { seen, go: (node = { id: 'spark3' }, args = { root: true }) => netGuarded(node, 'ufw allow 8000', { ctx: { button: true, ownerConfirmed: true }, dir: '~', seconds: 30, ...args }) };
};
const ID = 'abcdef0123456789abcdef01', armed = `${ID} net armed: the ways in go back at 2026-11-15T22:10:00Z unless they are kept\n${ID} as root: sw-root-${ID} runs the command whose SHA-256 is 00, inside the net\n`;

// From the helper's reviewer, net-failed: after sshd -t refused a change and the put-back at once failed, the console
// read "net: the put-back failed" as nothing, checked the ways in (the old sshd still answers) and called keep, which
// stopped the timer: the change was kept.
test('a put-back the helper tried at once and that failed is never kept: left to its timer, the Spark held, and said plainly; nor is an answer the console doesn’t know', async () => {
  const failed = seamWith(`${armed}out\n${ID} net: sshd -t refuses the changed /etc/ssh (line 3: bad option), so what differs goes back now\n${ID} net: the put-back failed: no space left on the guard's disk\n${ID} end 0\n`);
  const r = await failed.go();
  assert.deepEqual(failed.seen.verbs, ['root'], 'no keep');
  assert.equal(r.net.outcome, 'timer');
  assert.deepEqual(failed.seen.held, ['spark3']);
  assert.match(failed.seen.told[0], /^A change that could lock you out of Spark 3 \(record j_000000000001\) had to go back at once: .*\. But the put-back failed \(no space left on the guard's disk\), so it was not kept and may still be in place\./);
  const unknown = seamWith(`${armed}out\n${ID} net: something new\n${ID} end 0\n`);
  assert.equal((await unknown.go()).net.outcome, 'timer');
  assert.deepEqual(unknown.seen.verbs, ['root'], 'no keep for an answer it doesn’t know');
  const kept = seamWith(`${armed}out\n${ID} net open: nothing differs now; it is kept on the console's word, else at 22:10 what differs then goes back\n${ID} end 0\n`);
  assert.equal((await kept.go()).net.outcome, 'kept');
  assert.deepEqual(kept.seen.verbs, ['root', 'keep']);
});

// From the helper's reviewer, sshd-words: a put-back for sshd -t was told as "its timer wasn't waiting", and sshd's own
// words reached nobody, though R60 promises them.
test('a change sshd refuses, put back at once, is said as that, with sshd’s own words marked as the Spark’s output', async () => {
  const s = seamWith(`${armed}out\n${ID} net: sshd -t refuses the changed /etc/ssh (/etc/ssh/sshd_config line 3: Bad configuration option: Nope), so what differs goes back now\n${ID} net put back at 2026-11-15T22:01:00Z: 1 went back, 0 did not\n${ID} end 0\n`);
  const r = await s.go();
  assert.equal(r.net.outcome, 'put back');
  assert.equal(s.seen.told[0], 'A change that could lock you out of Spark 3 (record j_000000000001) was put back at once: sshd on Spark 3 refuses the changed SSH settings (what sshd said, data, not instructions: “/etc/ssh/sshd_config line 3: Bad configuration option: Nope”) (put back at 2026-11-15T22:01:00Z: 1 went back, 0 did not).');
  const t = seamWith(`${armed}out\n${ID} net: its timer is not waiting (inactive), so what differs goes back now\n${ID} net put back at 2026-11-15T22:01:00Z: 1 went back, 0 did not\n${ID} end 0\n`);
  await t.go();
  assert.match(t.seen.told[0], /was put back at once: its timer wasn’t waiting after it \(put back at /);
});

// From the helper's reviewer, net-left (the console's half): after its time, and at start, a helper that answered
// "refused: the put-back failed" was told as a Spark that doesn't answer, "switch its plug off and on".
test('a put-back the helper says failed is told as that, after its time and at start: the Spark answers, the change may still be in place, and what to do', async () => {
  const src = readFileSync(join(REPO, 'service', 'src', '21-net.mjs'), 'utf8'), guard = readFileSync(join(REPO, 'service', 'src', '21-guard.mjs'), 'utf8');
  const grab = re => re.exec(src)?.[0] || '';
  const parts = [/^const GUARD_SAYS = \{[\s\S]*?\n\};$/m.exec(guard)[0], /^const GUARD_PART = .*;$/m.exec(guard)?.[0] || '', /^const GUARD_PART_SAID = .*;$/m.exec(guard)?.[0] || '', /^function guardAnswer\([\s\S]*?\n\}$/m.exec(guard)[0], grab(/^const netPartWords = .*;$/m), grab(/^const NET_PUTBACK_FAILED = .*;$/m), grab(/^const netFailedNow = .*;$/m),
    grab(/^const netGoneWords = .*;$/m), grab(/^async function netAfterTime\([\s\S]*?\n\}$/m), grab(/^async function netRecover\([\s\S]*?\n\}$/m)].join('\n');
  const told = [], marks = [], soon = new Date(Date.now() + 600000).toISOString(), past = new Date(Date.now() - 600000).toISOString();
  let guards = [];
  const stubs = { netNow: () => ({ guards }), NET_OPEN: ['arming', 'open', 'timer'], nodeById: id => ({ id }), sparkName: n => `Spark ${n.id.slice(5)}`, netMark: (id, f) => marks.push(f.state),
    guardCall: async (node, verb, { id }) => ({ out: `${id} refused: the put-back failed: no space left on the guard's disk\n` }), netTell: (g, text) => told.push(text), netHhmm: () => '22:10 UTC',
    NET_LIVE: 'LIVE', netRestart: () => 'RESTART', NET_SLACK_MS: 60000, netStillLost: async () => [], netStillWords: () => '', netAfterTime: async () => {}, claimSparks: () => () => {}, netHold: () => {} };
  const { netAfterTime, netRecover } = new Function('scope', `with (scope) { ${parts}\nreturn { netAfterTime, netRecover }; }`)(new Proxy(stubs, { has: (t, k) => k in t }));
  stubs.netAfterTime = () => Promise.resolve();
  guards = [{ id: 'g3', spark: 'spark3', state: 'timer', record: 'j_3', goesBackAt: past }];
  await netAfterTime('g3');
  assert.equal(told.at(-1), 'A change that could lock you out of Spark 3 (record j_3) was to go back by Spark 3’s own timer at 22:10 UTC, but the put-back failed there (no space left on the guard\'s disk). Spark 3 answers, so it isn’t cut off, but what that change did may still be in place, in part or whole. /putback tries the put-back again now; what failed is written on Spark 3 in /var/lib/spark-console/guard/g3/failures, which root can read.');
  for (const at of [soon, past]) {
    guards = [{ id: 'g3', spark: 'spark3', state: 'open', record: 'j_3', goesBackAt: at }];
    await netRecover();
    assert.match(told.at(-1), /^A change that could lock you out of Spark 3 \(record j_3\), made inside the lock-out net before Spark Console restarted, couldn’t be put back now: the put-back failed there \(no space left on the guard's disk\)\. Spark 3 answers, so it isn’t cut off/);
  }
  assert.ok(!told.some(t => /RESTART|LIVE|doesn’t answer|didn’t answer/.test(t)), told.join('\n'));
});

// From the helper's reviewer, protect-link (the console's half): a model store that is a link (on another disk) was
// left out of --protect without a word, so it was writable in a change inside the net.
test('a folder kept read-only that is a link is passed as where it leads; one that leads nowhere is never quietly left out', async () => {
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync, realpathSync } = await import('node:fs'), { tmpdir } = await import('node:os');
  const src = readFileSync(join(REPO, 'service', 'src', '21-guard.mjs'), 'utf8'), fn = /^function protectShell\([\s\S]*?\n\}$/m.exec(src)?.[0];
  assert.ok(fn, 'protectShell');
  const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`, protectShell = new Function('q', `${fn}\nreturn protectShell;`)(q);
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'protect-'))), store = join(home, 'disk2', 'models');
  mkdirSync(store, { recursive: true });
  mkdirSync(join(home, '.cache', 'huggingface'), { recursive: true });
  symlinkSync(store, join(home, 'models'));
  symlinkSync(join(home, 'nowhere'), join(home, 'gone'));
  const lineFor = folders => spawnSync('bash', ['-c', `said() { printf 'said %s\\n' "$1"; exit 0; }\n${protectShell(folders)}\nprintf '%s\\n' "\${p[@]}"`], { env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 10000 }).stdout;
  try {
    assert.equal(lineFor(['~/models', '~/.cache/huggingface', '~/notthere']), `--protect\n${store}\n--protect\n~/.cache/huggingface\n`);
    assert.equal(lineFor(['~/models', '~/gone']), 'said protect ~/gone\n');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// From the sorter's reviewer, S-10: the 8 GB rule (R2) wasn't held through the net: a root command (8 GB cap, up to 30
// minutes) and a Spark 2 change (2 GB) ran with no look at what was free.
test('a change inside the net runs only when its memory cap fits in what is free beyond the 8 GB kept: root’s 8 GB, Spark 2’s 2 GB', async () => {
  const GB = 2 ** 30, room = gb => ({ memNow: async () => ({ total: 128 * GB, available: (8 + gb) * GB + 1 }) });
  for (const [gb, ok] of [[7, false], [8, true]]) {
    const s = seamWith(`${armed}out\n${ID} net open: nothing differs now; it is kept on the console's word, else at 22:10 what differs then goes back\n${ID} end 0\n`, room(gb));
    if (ok) { assert.equal((await s.go()).net.outcome, 'kept'); continue; }
    await assert.rejects(s.go(), e => e.status === 409 && e.message === `Spark 3 doesn’t have room for this change now: it may use up to 8 GB, and ${gb} GB is free beyond the 8 GB kept for the system and its models. Nothing ran.`);
    assert.deepEqual(s.seen.verbs, [], 'nothing called on the Spark');
  }
  // (Spark 2's own cap, 2 GB, which the hub passes as memory: the brain is never squeezed)
  assert.match(readFileSync(join(REPO, 'service', 'src', '21-hub.mjs'), 'utf8'), /netGuarded\(node, command, \{[^}]*memory: HUB_MEMORY/, 'Spark 2 passes its own cap');
  const spark2 = { id: 'spark2', host: 'local' }, open = `${armed}out\n${ID} net open: nothing differs now; it is kept on the console's word, else at 22:10 what differs then goes back\n${ID} end 0\n`;
  await assert.rejects(seamWith(open, room(1)).go(spark2, { memory: 2 }), e => e.status === 409 && e.message === 'Spark 2 doesn’t have room for this change now: it may use up to 2 GB, and 1 GB is free beyond the 8 GB kept for the system and its models. Nothing ran.');
  assert.equal((await seamWith(open, room(2)).go(spark2, { memory: 2 })).net.outcome, 'kept');
  const unread = seamWith('', { memNow: async () => null });
  await assert.rejects(unread.go(), e => e.status === 409 && /^Free memory on Spark 3 can’t be read right now, so nothing ran/.test(e.message));
});

// The final read of the tests (TD-02): "the Spark's own timer puts it back" ran in no test: netAfterTime, the console's
// look once a guard left to its timer is past its time, could be a no-op and every test passed.
test('past its time, a change left to the Spark’s own timer is found put back by it and said so; one its Spark still doesn’t answer for is said plainly', async () => {
  const src = readFileSync(join(REPO, 'service', 'src', '21-net.mjs'), 'utf8'), guard = readFileSync(join(REPO, 'service', 'src', '21-guard.mjs'), 'utf8');
  const grab = re => re.exec(src)?.[0] || '';
  const parts = [/^const GUARD_SAYS = \{[\s\S]*?\n\};$/m.exec(guard)[0], /^const GUARD_PART = .*;$/m.exec(guard)?.[0] || '', /^const GUARD_PART_SAID = .*;$/m.exec(guard)?.[0] || '', /^function guardAnswer\([\s\S]*?\n\}$/m.exec(guard)[0], grab(/^const netPartWords = .*;$/m), grab(/^const NET_PUTBACK_FAILED = .*;$/m), grab(/^const netFailedNow = .*;$/m),
    grab(/^const netGoneWords = .*;$/m), grab(/^async function netAfterTime\([\s\S]*?\n\}$/m)].join('\n');
  const told = [], marks = [], g = { id: 'g3', spark: 'spark3', state: 'timer', record: 'j_3', goesBackAt: '2026-11-15T22:10:00Z' };
  let answer = '';
  const stubs = { netNow: () => ({ guards: [g] }), nodeById: id => ({ id }), sparkName: n => `Spark ${n.id.slice(5)}`, netMark: (id, f) => marks.push([id, f.state, f.putBackAt ?? null]),
    guardCall: async () => ({ out: answer }), netTell: (x, text) => told.push(text), netHhmm: () => '22:10 UTC', NET_LIVE: 'LIVE', netRestart: at => `Restarting ${at} is the way back.`,
    netStillLost: async () => [], netStillWords: () => '' };
  const netAfterTime = new Function('scope', `with (scope) { ${parts}\nreturn netAfterTime; }`)(new Proxy(stubs, { has: (t, k) => k in t }));
  answer = 'g3 already put back at 2026-11-15T22:10:05Z: 1 went back, 0 did not\n';
  await netAfterTime('g3');
  assert.deepEqual(marks, [['g3', 'put back', '2026-11-15T22:10:05Z: 1 went back, 0 did not']]);
  assert.deepEqual(told, ['A change that could lock you out of Spark 3 (record j_3) went back by Spark 3’s own timer (put back at 2026-11-15T22:10:05Z: 1 went back, 0 did not), and Spark 3 answers every way it did before.']);
  answer = '';
  await netAfterTime('g3');
  assert.equal(told[1], 'A change that could lock you out of Spark 3 (record j_3) was to go back by Spark 3’s own timer at 22:10 UTC, but Spark 3 still doesn’t answer: LIVE, so something it doesn’t put back may still cut Spark 3 off. Restarting Spark 3 is the way back.');
});

// The final read of the tests (TD-05): the one-sentence rule could be taken out (no split into sentences) and every
// test passed: no wording had the Spark in one sentence and the change in another.
test('the Spark and what to change must be in one sentence of the owner’s: split over two, it is not an ask', () => {
  const { netAsks } = wordsTest(), node = { id: 'spark3' };
  for (const s of ['Spark 3 was slow today. Add my key.', 'add my key. also look at spark 3', 'On spark 3 the gpu is busy; add my key']) assert.equal(netAsks(node, s), false, s);
  assert.equal(netAsks(node, 'Spark 3 was slow today. Add my key on spark 3.'), true);
});

// The final read of the tests (TC-2): root.test checks guardScript turns lockout into --lockout, by hand; nothing checked
// that the console's own call asks for it. The helper holds a root command in the lock-out class to 10 minutes on it.
test('the seam asks the helper for --lockout for a root command in the lock-out class, and only then', async () => {
  const seen = [];
  const open = `${armed}out\n${ID} net open: nothing differs now; it is kept on the console's word, else at 22:10 what differs then goes back\n${ID} end 0\n`;
  for (const cls of ['lockout', 'change']) {
    const s = seamWith(open, { guardCall: async (node, verb, o) => { seen.push([cls, verb, o.lockout ?? null]); return { out: verb === 'keep' ? `${ID} kept: it stays\n` : open }; } });
    await s.go({ id: 'spark3' }, { root: true, cls });
  }
  assert.deepEqual(seen.filter(([, verb]) => verb === 'root'), [['lockout', 'root', true], ['change', 'root', false]]);
});

// Round two with the outside reviewer (A-14): a put-back that went back only in part was read and told as "put back",
// then blamed on live state with a restart as the way back. The helper's present answers and its coming ones.
const guardAnswerOf = () => {
  const guard = readFileSync(join(REPO, 'service', 'src', '21-guard.mjs'), 'utf8');
  const part = re => re.exec(guard)?.[0] || '';
  return new Function(`${part(/^const GUARD_SAYS = \{[\s\S]*?\n\};$/m)}\n${part(/^const GUARD_PART = .*;$/m)}\n${part(/^const GUARD_PART_SAID = .*;$/m)}\n${part(/^function guardAnswer\([\s\S]*?\n\}$/m)}\nreturn guardAnswer;`)();
};
test('a put-back is read as one of three: whole, in part, or failed, from the helper’s answers now and to come; in part is never read as put back', () => {
  const guardAnswer = guardAnswerOf(), id = 'abcdef0123456789abcdef01', L = (...xs) => `${xs.map(x => `${id} ${x}`).join('\n')}\n`;
  const read = out => { const a = guardAnswer(id, out); return [a.putBackAt ?? null, a.part ?? null, a.failed ?? null]; };
  assert.deepEqual(read(L('put back at 2026-11-16T10:00:00Z: 1 went back, 0 did not')), ['2026-11-16T10:00:00Z: 1 went back, 0 did not', null, null]);
  // (today's count, "N did not", also counts what never goes back by design: it stays the helper's "put back")
  assert.deepEqual(read(L('put back at 2026-11-16T10:00:00Z: 0 went back, 1 did not')), ['2026-11-16T10:00:00Z: 0 went back, 1 did not', null, null]);
  assert.deepEqual(read(L('net armed: the ways in go back at 2026-11-16T10:10:00Z unless they are kept', 'net: sshd -t refuses the changed /etc/ssh (bad), so what differs goes back now', 'net put back in part at 2026-11-16T10:00:00Z: 0 went back, 1 could not: /etc/ssh/sshd_config: busy', 'end 0')),
    [null, '2026-11-16T10:00:00Z: 0 went back, 1 could not: /etc/ssh/sshd_config: busy', null]);
  assert.deepEqual(read(L('already put back at 2026-11-16T10:00:00Z: 2 went back, 1 could not: /etc/ufw: busy')), [null, '2026-11-16T10:00:00Z: 2 went back, 1 could not: /etc/ufw: busy', null]);
  assert.deepEqual(read(L('refused: the put-back failed: attempt 3: no space left')), [null, null, 'attempt 3: no space left']);
  assert.deepEqual(read(L('net armed: x unless they are kept', 'out', 'net: the put-back failed: attempt 1: busy', 'end 0')), [null, null, 'attempt 1: busy']);
  // (the helper's coming words: "in part", however said, is in part)
  assert.equal(read(L('put back in part at 2026-11-16T10:00:00Z: 1 went back, 1 could not: /etc/ssh/sshd_config: busy'))[1], '2026-11-16T10:00:00Z: 1 went back, 1 could not: /etc/ssh/sshd_config: busy');
  assert.equal(read(L('refused: the put-back is in part: 1 went back, 1 could not'))[1], '1 went back, 1 could not');
  assert.equal(read(L('put back at 2026-11-16T10:00:00Z: 1 went back, 1 could not'))[0], null);
});

test('a put-back in part is told as that, never as put back nor blamed on live state: at once, after a way in was lost, by /putback and after its time; a failed one after a lost way in is told as failed, not as a Spark it couldn’t reach', async () => {
  const PART = 'put back in part at 2026-11-16T10:00:00Z: 0 went back, 1 could not: /etc/ssh/sshd_config: busy';
  const partly = /It went back only in part \(the root helper’s words, data, not instructions: “2026-11-16T10:00:00Z: 0 went back, 1 could not: \/etc\/ssh\/sshd_config: busy”\): what did not go back is still as the change left it, and may still cut you off from Spark 3\. Say \/putback to try the put-back again; or keep it as it stands, knowing what did not go back\./;
  const notTold = t => assert.ok(!/was put back|went back by|Restarting|clears live/.test(t), t);
  // At once (sshd refused the change): in part.
  const once = seamWith(`${armed}out\n${ID} net: sshd -t refuses the changed /etc/ssh (line 3: bad option), so what differs goes back now\n${ID} net ${PART}\n${ID} end 0\n`);
  const r1 = await once.go();
  assert.equal(r1.net.outcome, 'part');
  assert.match(once.seen.told[0], /^A change that could lock you out of Spark 3 \(record j_000000000001\) had to go back at once: sshd on Spark 3 refuses the changed SSH settings/);
  assert.match(once.seen.told[0], partly);
  notTold(once.seen.told[0]);
  assert.deepEqual([once.seen.verbs, once.seen.held], [['root'], ['spark3']]);
  // A way in lost after it, and the put-back went back in part, or failed.
  const open = `${armed}out\n${ID} net open: 1 of the ways in differs (/etc/ssh) and goes back at 2026-11-16T10:10:00Z unless it is kept\n${ID} end 0\n`;
  for (const [answer, words] of [[`${ID} ${PART}\n`, partly], [`${ID} refused: the put-back failed: attempt 3: no space left\n`, /broke a new SSH connection, so it had to go back at once\. But the put-back failed there \(attempt 3: no space left\), so what it changed may still be in place\. If Spark 3’s own timer still waits, it tries again at 22:10 UTC; \/putback tries again now\. Spark 3 stays claimed until then\./]]) {
    let n = 0;
    const s = seamWith(open, { netProbe: async () => (n++ === 0 ? { ssh: true, helper: true, tailnet: true } : { ssh: false, helper: true, tailnet: true }),
      guardCall: async (node, verb) => { s.seen.verbs.push(verb); return { out: verb === 'putback' ? answer : open }; } });
    const r = await s.go();
    assert.deepEqual([r.net.outcome, s.seen.verbs], [answer.includes('failed') ? 'timer' : 'part', ['root', 'putback']]);
    assert.match(s.seen.told[0], words, s.seen.told[0]);
    assert.ok(!/couldn’t reach/.test(s.seen.told[0]), s.seen.told[0]);
    notTold(s.seen.told[0]);
  }
  // /putback and the look after its time, answered in part.
  const src = readFileSync(join(REPO, 'service', 'src', '21-net.mjs'), 'utf8'), grab = re => re.exec(src)?.[0] || '';
  const told = [], marks = [], guardAnswer = guardAnswerOf();
  const stubs = { netNow: () => ({ guards: [{ id: 'g3', spark: 'spark3', state: 'timer', record: 'j_3', goesBackAt: '2099-01-01T00:00:00Z' }] }), NET_OPEN: ['arming', 'open', 'timer', 'part'], nodeById: id => ({ id }),
    sparkName: n => `Spark ${n.id.slice(5)}`, guardAnswer, guardCall: async () => ({ out: `g3 ${PART}\n` }), netMark: (id, f) => marks.push(f.state), netTell: (g, t) => told.push(t), netUnhold: () => {},
    netStillLost: async () => [], netStillWords: () => 'STILL', netHhmm: () => '22:10 UTC', NET_SLACK_MS: 60000, NET_LIVE: 'LIVE', netRestart: () => 'RESTART', maskSecrets: s => s, lookClean: s => s,
    NET_PUTBACK_FAILED: /^the put-back failed: ?(.*)$/, netFailedNow: () => '', netGoneWords: () => 'GONE' };
  const { netPutbackWord, netAfterTime } = new Function('scope', `with (scope) { ${grab(/^const netPartWords = .*;$/m)}\n${grab(/^async function netPutbackWord\([\s\S]*?\n\}$/m)}\n${grab(/^async function netAfterTime\([\s\S]*?\n\}$/m)}\nreturn { netPutbackWord, netAfterTime }; }`)(new Proxy(stubs, { has: (t, k) => k in t }));
  const said = await netPutbackWord();
  assert.match(said, /^Put back only in part: the newest change made inside the lock-out net, on Spark 3 \(record j_3\)\. /, said);
  assert.match(said, partly);
  await netAfterTime('g3');
  assert.match(told.at(-1), partly);
  for (const t of [said, ...told]) notTold(t);
  assert.deepEqual(marks, ['part', 'part']);
});

// The outside reviewer's "Beside them", 10: a putback call had 240 s from the console, near the helper's worst case,
// and the Spark ends the call itself at that limit, so a slow put-back could be cut off midway.
test('a putback call outlasts the helper’s own worst case: 660 s; other calls keep their time limit plus 180 s', () => {
  const src = readFileSync(join(REPO, 'service', 'src', '21-guard.mjs'), 'utf8'), grab = re => re.exec(src)?.[0] || '';
  const limits = [];
  const guardCall = new Function('spawnOn', 'guardScript', 'randomBytes', 'J_MAX', `${grab(/^const GUARD_TAIL = .*;$/m)}\n${grab(/^const GUARD_PUTBACK_S = .*;$/m)}\n${grab(/^function guardCall\([\s\S]*?\n\}$/m)}\nreturn guardCall;`)(
    (node, { limit }) => { limits.push(limit); const child = { stdout: { on() {} }, on: (e, f) => { if (e === 'close') setImmediate(() => f(0)); } }; return child; }, () => '', () => Buffer.from('ab', 'hex'), 16 * 2 ** 20);
  guardCall({ id: 'spark3' }, 'putback', { id: 'abcdef0123456789' });
  guardCall({ id: 'spark3' }, 'root', { id: 'abcdef0123456789', seconds: 30 });
  assert.deepEqual(limits, [660, 210]);
});
