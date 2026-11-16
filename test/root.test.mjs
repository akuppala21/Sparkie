// Covers: a command as root, the console's half (A12; 21-root.mjs; R70, R60, R54; design A 2.13, step 12), on as in
// the build (only SPARK_CONSOLE_ROOT=0 or SPARK_CONSOLE_NET=0 turns it off; off, run has no root in its schema: one
// test starts a console with it off). run with root: true is always the dangerous ask, "ROOT on Spark 3" (with
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
import { T, useFleet, api, call, createActKey, newChat, say, chatMessages, REPO, SLOW } from './lib.mjs';
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

// The chat's row for the command (A5's tool step; the page shows ", as root" when it says root): a root call's row
// says root, from what code answered (the dangerous ask "ROOT on Spark 3"), never from the brain's arguments; a root
// call refused says nothing of root, and a plain change's row does not.
test('the chat’s row for a root command says root, from what code answered, so the page shows “as root”; a refused root call’s row and a plain change’s row do not', { timeout: 120000 * SLOW }, async () => {
  const chat = await newChat(), cmd = 'printf row > rowed.txt';
  const a = await ask(chat, 'as root on spark 3, write rowed.txt', cmd);
  assert.ok(a.m, 'the dangerous ask');
  // (the ask is answered whatever happens here, so the next test's ask isn't told to wait for it)
  let p = null;
  try {
    const [step] = a.r.tools;
    assert.deepEqual([step.name, step.where, step.line, step.root, step.tail], ['run', 'Spark 3', `$ ${cmd}`, true, 'Asked first, as its own message: nothing ran yet.'], JSON.stringify(step));
    const saved = (await chatMessages(chat)).flatMap(m => m.tools || []).find(t => t.line === `$ ${cmd}`);
    assert.equal(saved?.root, true, 'kept so in the chat, which the page reads');
    p = await press(chat, a.yes.id, a.pair);
  } finally { if (!p) await press(chat, a.no.id).catch(() => {}); }
  assert.equal(p.status, 200, p.text);
  assert.equal(readFileSync(join(T.fleet.root, 'spark3', 'rowed.txt'), 'utf8'), 'row');
  // (the brain's root: true on Spark 2 is refused: the row says nothing of root)
  const c2 = await newChat();
  script([{ match: '^as root on spark 2, write rowed.txt$', rounds: [[{ name: 'run', arguments: { on: 'spark2', command: cmd, dir: '~', root: true } }]] }]);
  let r2;
  try { r2 = await say(c2, 'as root on spark 2, write rowed.txt'); } finally { noScript(); }
  assert.deepEqual([r2.tools[0].ok, r2.tools[0].root], [false, false], JSON.stringify(r2.tools[0]));
  // A plain change's row: not root.
  const c3 = await newChat();
  script([{ match: '^write the plain row note on spark 3$', rounds: [[{ name: 'run', arguments: { on: 'spark3', command: 'printf plain > plain-row.txt', dir: '~' } }]] }]);
  let r3;
  try { r3 = await say(c3, 'write the plain row note on spark 3'); } finally { noScript(); }
  assert.deepEqual([r3.tools[0].where, r3.tools[0].root], ['Spark 3', false], JSON.stringify(r3.tools[0]));
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

test('a root command in the lock-out class from an agent is refused, never asked (contract 8.3): only the owner’s own words ask for one', { timeout: 60000 * SLOW }, async () => {
  const k = await createActKey('root-agent');
  const ag = await call(k.token, 'run', { on: 'spark3', command: "printf '%s\\n' 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAgent agent@net' >> .ssh/authorized_keys", dir: '~', root: true });
  assert.ok(ag.isError, ag.text);
  assert.ok(ag.text.includes('Nothing was asked or run: Sparkie changes SSH, Tailscale, the firewall or users only when you ask for it yourself; this came from an agent.'), ag.text);
});

test('a root command in the lock-out class after the owner’s question, or after a change to something else, is refused, never asked, and the refusal says how to ask (the owner’s words, R71)', { timeout: 120000 * SLOW }, async () => {
  const keyAdd = "printf '%s\\n' 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAsked asked@net' >> .ssh/authorized_keys";
  for (const words of ['why is ssh open on spark 3 as root', 'as root on spark 3, fix the build']) {
    const chat = await newChat(), a = await ask(chat, words, keyAdd);
    if (a.no) await press(chat, a.no.id);
    assert.equal(a.m, undefined, `${words}: refused, never asked`);
    assert.equal(sentBack(words)[0]?.error, 'Nothing was asked or run: Sparkie changes SSH, Tailscale, the firewall or users only when you ask for it yourself; this came from Sparkie’s own proposal, not your words asking for this on Spark 3. To ask, say it yourself in one sentence: what to change, and on which Spark. For example: “Add my laptop’s SSH key on Spark 3.”', words);
  }
  assert.ok(!readFileSync(join(T.fleet.root, 'spark3', '.ssh', 'authorized_keys'), 'utf8').includes('asked@net'), 'nothing ran');
});

// The final read's ask-no-dir: the root ask showed neither the folder the command starts in nor that it deletes.
test('the root ask shows the folder the command starts in, and says when it deletes for good, as the other asks do', { timeout: 120000 * SLOW }, async () => {
  mkdirSync(join(T.fleet.root, 'spark3', 'notes', 'old'), { recursive: true });
  const chat = await newChat(), words = 'as root on spark 3, clear the old folder in notes';
  script([{ match: `^${words}$`, rounds: [[{ name: 'run', arguments: { on: 'spark3', command: 'find old -delete', dir: '~/notes', root: true } }]] }]);
  try { await say(chat, words); } finally { noScript(); }
  const m = (await chatMessages(chat)).filter(x => x.danger).at(-1), no = m?.choices.find(c => c.label === 'No');
  try {
    assert.ok(m, `the root ask (${JSON.stringify(sentBack(words))})`);
    assert.equal(m.danger.lines[0], 'ROOT on Spark 3 · DELETES FOR GOOD', m.danger.lines.join('\n'));
    assert.ok(m.danger.lines.includes('It starts in ~/notes.'), m.danger.lines.join('\n'));
    assert.ok(m.danger.lines.some(l => l.startsWith('This cannot be put back: find -delete removes files')), m.danger.lines.join('\n'));
  } finally { if (no) await press(chat, no.id); }
  assert.ok(existsSync(join(T.fleet.root, 'spark3', 'notes', 'old')), 'nothing ran');
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
  const before = calls().length;
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
  assert.match(long.json.error, /it takes no minutes, fleet or gpu\.$/);
  assert.ok(!existsSync(join(T.fleet.root, 'etc', 'rooted')));
  // (the final read's TC-8: the file above could not be made even if a command ran; the helper was asked for no unit)
  assert.ok(!calls().slice(before).some(c => c[0] === 'systemd-run' && c.some(a => /^--unit=sw-(run|root|look)-/.test(a))), JSON.stringify(calls().slice(before)));
});

test('off: run has no root in its schema, so what the brain reads is as before; on, it has', { timeout: 120000 * SLOW }, async () => {
  const on = (await api('/actions')).json.actions.find(a => a.name === 'run');
  assert.equal(on.input.properties.root?.type, 'boolean');
  const B = await startMock({ env: { SPARK_CONSOLE_NET: '1', SPARK_CONSOLE_ROOT: '0' } });
  later.push(B);
  const off = (await (await fetch(`${B.base}/actions`)).json()).actions.find(a => a.name === 'run');
  assert.ok(off && !('root' in off.input.properties), JSON.stringify(off?.input.properties));
  assert.deepEqual(Object.keys(off.input.properties), Object.keys(on.input.properties).filter(k => k !== 'root'));
});

// The final read's root-script: "as root, never a script" held only for a file named as a word. The sorter's next step
// names what runs unseen in its field `unshown`; root refuses on it, and on scripts as before (stand-in sorted objects).
// Round two with the outside reviewer (A-16, root's own half): root refuses on the sorter's fields alone, unshown and
// later (work it starts later, off the button and outside the net), and its words say the plain truth: root never runs
// code it doesn't show, so no way round it is offered (a file run by name included). A program the sorter doesn't know
// (unknownProgram) is asked, not refused.
test('as root, code the command doesn’t show is never run, nor work it starts later: a script it names, or what the sorter says runs unseen or later', () => {
  const src = readFileSync(join(REPO, 'service', 'src', '21-root.mjs'), 'utf8'), fn = /^function rootUnseen\([\s\S]*?\n\}$/m.exec(src)?.[0];
  assert.ok(fn, 'rootUnseen');
  const rootUnseen = new Function(`${fn}\nreturn rootUnseen;`)();
  assert.equal(rootUnseen({ class: 'change', scripts: [] }), null);
  assert.equal(rootUnseen({ class: 'change', scripts: [], unshown: null }), null);
  assert.match(rootUnseen({ class: 'risky', scripts: ['~/work/fix.sh'] }), /^Nothing was asked or run: as root, give the command itself, not a script \(~\/work\/fix\.sh\)/);
  assert.equal(rootUnseen({ class: 'risky', scripts: [], unshown: 'bash runs what comes in through < or a pipe.' }),
    'Nothing was asked or run: as root, Spark Console never runs code the button doesn’t show, and this runs code that isn’t on it (bash runs what comes in through < or a pipe). Give its steps as plain commands instead, each one on the button.');
  assert.equal(rootUnseen({ class: 'risky', scripts: [], unshown: null, later: null }), null);
  assert.equal(rootUnseen({ class: 'risky', scripts: [], unshown: null, later: 'systemd-run starts work later, by itself, outside this command and the net' }),
    'Nothing was asked or run: as root, Spark Console never starts work that runs later, off the button and outside the net, and this does (systemd-run starts work later, by itself, outside this command and the net). Run the work itself now, as its own command; a timer, schedule, unit or drop-in meant to stay is made by hand on the Spark, over SSH.');
  assert.equal(rootUnseen({ class: 'risky', scripts: [], unshown: null, later: null, unknownProgram: 'frobnicate' }), null, 'a program it doesn’t know is asked');
  for (const s of [{ scripts: ['~/work/fix.sh'] }, { scripts: [], unshown: 'the code a python3 one-liner runs and loads' }, { scripts: [], later: 'at starts work later' }]) assert.doesNotMatch(rootUnseen(s), /in a file|by name|\bfile\b/, JSON.stringify(s));
});

// A-16's last part: the root ask says in one line that Sparkie doesn't know the program (the sorter's unknownProgram).
test('the root ask names, in one line, a program Sparkie doesn’t know; a known program adds no line', () => {
  const src = readFileSync(join(REPO, 'service', 'src', '21-root.mjs'), 'utf8'), fn = /^function rootLines\([\s\S]*?\n\}$/m.exec(src)?.[0], line = /^const rootLine = .*;$/m.exec(src)?.[0];
  assert.ok(fn && line, 'rootLines and rootLine');
  const rootLines = new Function('netTimeWords', 'workStartsIn', `${line}\n${fn}\nreturn rootLines;`)(s => `${s} seconds at most`, d => `It starts in ${d}.`);
  const known = rootLines('Spark 3', 600, 'apt-get install -y htop', '~/work', { class: 'change', unknownProgram: null });
  const odd = rootLines('Spark 3', 600, 'frobnicate --all', '~/work', { class: 'risky', unknownProgram: 'frobnicate' });
  assert.deepEqual(odd.slice(0, -1), known);
  assert.equal(odd.at(-1), 'Sparkie doesn’t know the program frobnicate, so it can’t tell you what it does as root: read the command before you answer.');
  assert.equal(odd.filter(l => l.includes('frobnicate')).length, 1);
});

// From the helper's reviewer, root-mount: root's unit has its own mount table, so a mount, unmount or swap made in it never
// reaches the Spark, and was told as done and kept.
test('as root, a mount, unmount or swap is refused with how to do it instead: read by the sorter’s own reader, past wrappers and into sh -c', async () => {
  const shell = readFileSync(join(REPO, 'service', 'src', '20-shell.mjs'), 'utf8'), src = readFileSync(join(REPO, 'service', 'src', '21-root.mjs'), 'utf8');
  const grab = re => re.exec(src)?.[0];
  assert.ok(grab(/^function rootMounts\([\s\S]*?\n\}$/m), 'rootMounts');
  const rootMounts = new Function(`${shell}\n${grab(/^const ROOT_MOUNTS = .*;$/m)}\n${grab(/^const ROOT_WRAPS = .*;$/m)}\n${grab(/^function rootMounts\([\s\S]*?\n\}$/m)}\nreturn rootMounts;`)();
  for (const [c, prog] of [['mount /dev/sdb1 /data', 'mount'], ['umount /data', 'umount'], ['env FOO=1 swapon /swapfile', 'swapon'], ['timeout 10 swapoff -a', 'swapoff'],
    ["bash -c 'umount /data'", 'umount'], ['zfs mount tank/data', 'zfs mount'], ['zpool import tank', 'zpool'], ['echo $(mount -a)', 'mount'], ['cd /mnt && umount -l x', 'umount']]) assert.equal(rootMounts(c), prog, c);
  for (const c of ['zfs list', 'findmnt', 'cat /etc/fstab', 'systemctl start data.mount', 'echo mount']) assert.equal(rootMounts(c), null, c);
  // (end to end, the owner's own call: refused before anything is asked)
  const r = await api('/actions/run', { method: 'POST', body: { on: 'spark3', command: 'mount /dev/sdb1 /data', root: true } });
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.error, 'Nothing was asked or run: a root command runs with its own view of the disks, so a mount in it never reaches Spark 3 (it would end with the command, and be told as done). Do it through systemd instead: a line in /etc/fstab (or a .mount or .swap unit), then systemctl daemon-reload and systemctl start <its name>.mount (or .swap), as root.');
});

// Round two with the outside reviewer (A-16, root's own half): an interpreter given its program inline carried no unshown
// mark, so root accepted programs that load a file the button never shows. The sorter marks every such run in its field
// unshown (its own step, A-16), and root refuses on that field alone (rootUnseen), with no list of root's own; a command
// the sorter's reader can't read whole is refused too (rootUnreadable). End to end: one-liners of python3, node and perl
// that load a file, a program piped into python3, and work started later, by systemd-run or a drop-in written (later).
test('as root, code the sorter says runs unseen, or work it says starts later, is refused end to end by its field alone, and so is a command the reader can’t read whole', async () => {
  const shell = readFileSync(join(REPO, 'service', 'src', '20-shell.mjs'), 'utf8'), src = readFileSync(join(REPO, 'service', 'src', '21-root.mjs'), 'utf8');
  const fn = /^function rootUnreadable\([\s\S]*?\n\}$/m.exec(src)?.[0];
  assert.ok(fn, 'rootUnreadable');
  const rootUnreadable = new Function(`${shell}\n${fn}\nreturn rootUnreadable;`)();
  for (const c of ['python3 --version', 'apt-get install -y python3', 'echo python3 -c', 'chmod 600 /etc/x', 'ufw allow 8002', 'printf root > rooted.txt', 'find old -delete', `python3 -c "print(1)"`]) assert.equal(rootUnreadable(c), null, c);
  assert.match(rootUnreadable('for f in a b; do echo $f; done') || '', /loop/);
  assert.doesNotMatch(src, /ROOT_INTERPRETERS|ROOT_INLINE/, 'no list of root’s own');
  // (end to end, the owner's own call: refused before anything is asked)
  const r = await api('/actions/run', { method: 'POST', body: { on: 'spark3', command: 'cat /tmp/repair.py | python3', root: true } });
  assert.deepEqual([r.status, r.json?.error], [403, 'Nothing was asked or run: as root, Spark Console never runs code the button doesn’t show, and this runs code that isn’t on it (the python3 code it reads from its input). Give its steps as plain commands instead, each one on the button.'], r.text);
  for (const [command, prog] of [[`python3 -c "exec(open('/tmp/repair.py').read())"`, 'python3'], [`node -e "require('/tmp/repair.js')"`, 'node'], [`perl -e 'do "/tmp/x.pl"'`, 'perl']]) {
    const x = await api('/actions/run', { method: 'POST', body: { on: 'spark3', command, root: true } });
    assert.equal(x.status, 403, `${command}: ${x.text}`);
    assert.match(x.json.error, new RegExp(`^Nothing was asked or run: as root, Spark Console never runs code the button doesn’t show, and this runs code that isn’t on it \\(the code a ${prog} one-liner runs and loads .*\\)\\. Give its steps as plain commands instead, each one on the button\\.$`), command);
  }
  for (const [command, via] of [['systemd-run --on-active=60 touch /x', 'systemd-run'], [`printf '[Service]\\nExecStart=/bin/true\\n' > /etc/systemd/system/x.service.d/override.conf`, 'a schedule or a unit written']]) {
    const x = await api('/actions/run', { method: 'POST', body: { on: 'spark3', command, root: true } });
    assert.deepEqual([x.status, x.json?.error], [403, `Nothing was asked or run: as root, Spark Console never starts work that runs later, off the button and outside the net, and this does (${via} starts work later, by itself, outside this command and the net). Run the work itself now, as its own command; a timer, schedule, unit or drop-in meant to stay is made by hand on the Spark, over SSH.`], command);
  }
  const loop = await api('/actions/run', { method: 'POST', body: { on: 'spark3', command: 'for f in a b; do touch $f; done', root: true } });
  assert.equal(loop.status, 403, loop.text);
  assert.match(loop.json.error, /^Nothing was asked or run: as root, a command is run only when Spark Console can read it whole, and this one it can’t \(/);
});

// A-16's last part, end to end: the sorter names a program it doesn't know (unknownProgram), and the root ask says so.
test('the root ask, end to end, says in one line that Sparkie doesn’t know the program; nothing runs before the press', { timeout: 120000 * SLOW }, async () => {
  const chat = await newChat(), words = 'as root on spark 3, run frobnicate', a = await ask(chat, words, 'frobnicate --all');
  assert.ok(a.m, `the root ask (${JSON.stringify(sentBack(words))})`);
  try {
    assert.equal(a.m.danger.lines[0], 'ROOT on Spark 3', a.m.danger.lines.join('\n'));
    assert.equal(a.m.danger.lines.filter(l => l === 'Sparkie doesn’t know the program frobnicate, so it can’t tell you what it does as root: read the command before you answer.').length, 1, a.m.danger.lines.join('\n'));
  } finally { await press(chat, a.no.id); }
});

// The helper's round two: its one-time command refuses --with-root --hub (root is never on Spark 2). The console never
// gives it: the owner's command for Spark 2 has no --with-root, whatever is asked; another Spark's keeps it.
test('the owner’s one-time command never carries --with-root for Spark 2, which it refuses; for another Spark it does', () => {
  const src = readFileSync(join(REPO, 'service', 'src', '21-work.mjs'), 'utf8'), fn = /^function ownerCommand\([\s\S]*?\n\}$/m.exec(src)?.[0];
  assert.ok(fn, 'ownerCommand');
  const ownerCommand = new Function('consoleOrigin', 'CONFIG', 'q', `${fn}\nreturn ownerCommand;`)(() => '', { user: 'owner' }, s => `'${s}'`);
  assert.equal(ownerCommand({ id: 'spark2', host: 'local' }, true), 'bash ~/spark-console-src/deploy/root-for-sparkie.sh --hub 2');
  assert.equal(ownerCommand({ id: 'spark2', host: 'local' }), 'bash ~/spark-console-src/deploy/root-for-sparkie.sh --hub 2');
  assert.equal(ownerCommand({ id: 'spark3', host: '100.64.0.3' }, true), 'bash ~/spark-console-src/deploy/root-for-sparkie.sh --with-root 3');
});

// Round two with the outside reviewer (root's own half): rootChange sorted a root command as the owner's (runnerSortOpts
// sets root: false), so the sorter's root-only rules never applied there: kill -9 812 or kill 1 as root, where a number
// can be any process (a way in among them), was asked as plain ROOT, outside the lock-out class's own path. Sorted as
// root, each is the lock-out class: its ask, and from anything but the owner's own words, refused.
test('as root, kill -9 812 and kill 1 are the lock-out class: ROOT on Spark 3 · CAN LOCK YOU OUT, and from Sparkie’s own proposal refused, never asked', { timeout: 180000 * SLOW }, async () => {
  for (const [words, command] of [['as root on spark 3, stop the ssh process 812', 'kill -9 812'], ['as root on spark 3, stop sshd', 'kill 1']]) {
    const chat = await newChat(), a = await ask(chat, words, command);
    assert.ok(a.m, `${command}: the dangerous ask (${JSON.stringify(sentBack(words))})`);
    try {
      assert.equal(a.m.danger.lines[0], 'ROOT on Spark 3 · CAN LOCK YOU OUT', `${command}: ${a.m.danger.lines.join('\n')}`);
      assert.match(a.m.danger.lines.join('\n'), /\nWhy it can lock you out: “kill” as root may kill any process, a way in among them/, command);
    } finally { await press(chat, a.no.id); }
  }
  // (the lock-out class's own path: words that ask for no lock-out change are refused, never asked)
  const words = 'as root on spark 3, kill process 812', chat = await newChat(), a = await ask(chat, words, 'kill -9 812');
  if (a.no) await press(chat, a.no.id);
  assert.equal(a.m, undefined, 'refused, never asked');
  assert.match(sentBack(words)[0]?.error || '', /^Nothing was asked or run: Sparkie changes SSH, Tailscale, the firewall or users only when you ask for it yourself; this came from Sparkie’s own proposal/);
});
