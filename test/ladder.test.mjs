// Covers: run's ladder for a change on a compute Spark (21-ladder.mjs, with 21-runner.mjs; R61, R55, R54; design A
// 2.5 and 2.8, step A7c), end to end on the stand-in fleet: a plain change the owner's words ask for runs at once with
// no button and undo puts it back; a risky one is a button, built by code, and the owner's press runs it; a file this
// request wrote and then runs is asked (the sorter's written); a script that changed after its ask voids the press,
// each button by its own ask, and is hashed through the root helper's look; the press runs in the wall its button
// showed; a risky delete is the dangerous ask, which names what came from what the request read and says its wall; an
// agent's change is a button; not done, the lock-out class and Spark 2 are refused; what put-back does not cover is
// said; the run unit's git reads none of the owner's settings but name and mail; the claim is held past a change whose
// end is unknown, "unknown" too; the protect folders stay read-only with the top of the home writable; /undo works
// while changes are paused; the memory cap's working-out; what the page's line for a command shows; with no eval on
// record (the rail, R52), Sparkie's plain change is a button too, and the owner's press runs it.
// The stand-in fleet, with the real root helper set up and proven for Spark 3 (test/rehearsal.mjs, run: true), the
// stand-ins in test/mock/bin, and the stand-in brain told by a script which tools to call. Linux only: run it on a
// Spark with tools/test-on-spark.sh.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync, statSync, readdirSync, symlinkSync, renameSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { T, useFleet, api, call, createActKey, newChat, say, choose, chatMessages, waitFor, sleep, agentSettings, REPO, SLOW } from './lib.mjs';
import { rehearse } from './rehearsal.mjs';
import { startMock } from './start-mock.mjs';

const SECONDS = 6;
const KEYS_LINE = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIStandIn owner@mac\n';
const keys = {};
// (the tailnet is read every second here, so a test that changes what it says is seen soon; a dangerous ask is never
// sent a minute late, as the tests raise several inside ten minutes. The lock-out net and Spark 2's changes are off for
// this fleet: its tests are their off side, net.test and hub-change.test their on side)
useFleet({ env: { SPARK_CONSOLE_RUN_SECONDS: String(SECONDS), SPARK_CONSOLE_ROUTE_MS: '1000', SPARK_CONSOLE_WIDE_MS: '1', SPARK_CONSOLE_DANGER_LATE_MS: '0',
  SPARK_CONSOLE_NET: '0', SPARK_CONSOLE_HUB: '0' },
  prepare: ({ root }) => {
    rehearse(root, 'spark3', { run: true });
    const h = join(root, 'spark3');
    const put = (p, data, mode = 0o644) => { mkdirSync(dirname(join(h, p)), { recursive: true }); writeFileSync(join(h, p), data); chmodSync(join(h, p), mode); };
    put('notes/e.txt', 'e before\n');
    put('notes/u.txt', 'u before\n');
    put('notes/list.txt', 'notes/xa.txt\n');
    put('notes/todo.txt', 'to do: rm ~/notes/*.tmp\n');
    put('notes/a.tmp', 'a\n');
    put('.ssh/authorized_keys', KEYS_LINE, 0o600);
    chmodSync(join(h, '.ssh'), 0o700);
    put('fix.sh', "printf 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOther other@else\\n' >> .ssh/authorized_keys\n", 0o755);
  } }, async () => {
  keys.act = await createActKey('ladder-act');
  // (the console's looks at the tailnet, the first 1.5 s after it starts: until one has read it, no change runs at once,
  // A7c. The Sparks' tailnet addresses come with the first request, so two looks after this one count)
  const looks = () => (existsSync(join(T.fleet.dir, 'tailscale-calls')) ? readFileSync(join(T.fleet.dir, 'tailscale-calls'), 'utf8').split('\n').filter(l => l === 'status --json').length : 0);
  const n = looks();
  await waitFor(() => looks() >= n + 2, { what: 'two looks at the tailnet after a request' });
  await sleep(300);
});

const H3 = () => join(T.fleet.root, 'spark3'), at3 = p => join(H3(), p), text = p => readFileSync(at3(p), 'utf8');
// A change's start line (by its command), and the settings its unit was given (the rehearsal's own record of them). In
// this rehearsal the owner's home, as the helper reads it from /etc/passwd, is /spark3.
const journalLines = () => readdirSync(T.fleet.journalDir).filter(f => f.endsWith('.jsonl')).sort().flatMap(f => lines(join(T.fleet.journalDir, f)));
const startOf = command => journalLines().filter(x => x.k === 'cmd' && x.start && x.args?.command === command).at(-1);
const propsOf = command => lines(join(H3(), '.rehearsal', 'calls.log')).find(c => c[0] === 'systemd-run' && c.includes(`--unit=${startOf(command)?.unit}`)) || [];
const sha = s => createHash('sha256').update(s).digest('hex');
// (most changes here start in ~, as written; the work folder's own test leaves dir out)
const run = (command, on = 'spark3', dir = '~') => api('/actions/run', { method: 'POST', body: { on, command, ...(dir ? { dir } : {}) } });
const lines = file => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const noScript = () => rmSync(join(T.fleet.dir, 'model-script.json'), { force: true });
const RUN = (command, dir = '~') => ({ name: 'run', arguments: { on: 'spark3', command, ...(dir ? { dir } : {}) } });
// One owner's message in a chat, the stand-in brain calling these rounds of tools; its tool steps and its buttons.
async function turn(chat, words, rounds) {
  script([{ match: `^${words}$`, rounds }]);
  try {
    const r = await say(chat, words);
    return { tools: r.tools, choices: r.message.choices || [], message: r.message };
  } finally { noScript(); }
}
// What a tool answered the brain (the newest), parsed.
const sentBack = words => {
  const x = lines(join(T.fleet.dir, 'model-requests.jsonl')).filter(m => m.words === words && m.lastRole === 'tool').at(-1);
  return (x?.results || []).map(r => (String(r.content).startsWith('[error] ') ? { error: String(r.content).slice(8) } : JSON.parse(r.content)));
};
const NOT_COVERED = 'Not covered by put-back: what a script or a program (an install, a build) writes on its own isn’t copied first, so undo can’t put that back.';

test('everyday: a plain change the owner asks for runs at once with no button, its line says where it ran and what it kept, and undo puts it back', { timeout: 120000 * SLOW }, async () => {
  const chat = await newChat();
  const r = await turn(chat, 'fix the notes on spark 3', [[RUN('echo fixed > notes/e.txt')]]);
  assert.deepEqual(r.choices, [], 'no button');
  assert.equal(text('notes/e.txt'), 'fixed\n');
  const [step] = r.tools;
  assert.deepEqual([step.name, step.ok, step.outcome, step.where, step.root, step.tail, step.putBack], ['run', true, 'change', 'Spark 3', false, 'exit 0', undefined], JSON.stringify(step));
  assert.match(step.kept, /^j_[0-9a-f]{12}$/);
  const u = await turn(chat, 'undo that', [[{ name: 'undo_last_change', arguments: {} }]]);
  assert.equal(u.tools[0].ok, true, JSON.stringify(u.tools));
  assert.equal(text('notes/e.txt'), 'e before\n');
});

test('everyday: a risky change is a button with the exact command and why; nothing runs until the owner presses it', { timeout: 120000 * SLOW }, async () => {
  const chat = await newChat();
  const r = await turn(chat, 'fix the list on spark 3', [[RUN('xargs touch < notes/list.txt')]]);
  const [step] = r.tools;
  assert.equal(step.tail, 'Asked first, with a button: nothing ran yet.', JSON.stringify(step));
  const [asked] = sentBack('fix the list on spark 3');
  assert.equal(asked.outcome, 'needs-ok', JSON.stringify(asked));
  assert.match(asked.question, /^Run this on Spark 3\?\n\$ xargs touch < notes\/list\.txt\nAsked because it is risky: “touch” gets words it reads from its input/);
  assert.ok(!existsSync(at3('notes/xa.txt')), 'nothing ran');
  const yes = r.choices.find(c => c.label === 'Run it');
  assert.ok(yes, JSON.stringify(r.choices));
  const p = await choose(chat, yes.id);
  assert.equal(p.status, 200, p.text);
  assert.ok(existsSync(at3('notes/xa.txt')), `the press ran it: ${p.text}`);
});

test('a file this request wrote, then run, is asked (the sorter is told what it wrote); a script changed after its ask voids the press and is asked again', { timeout: 180000 * SLOW }, async () => {
  const chat = await newChat();
  const r = await turn(chat, 'fix the script on spark 3', [[RUN("echo 'echo hi > notes/ran.txt' > notes/w.sh")], [RUN('bash notes/w.sh')]]);
  assert.equal(text('notes/w.sh'), 'echo hi > notes/ran.txt\n', 'the write ran at once');
  const [second] = sentBack('fix the script on spark 3');
  assert.equal(second?.outcome, 'needs-ok', JSON.stringify(second));
  assert.match(second.question, /Asked because it is risky: “bash” runs the file “notes\/w\.sh”\. It runs a file this same command wrote/);
  assert.match(second.question, /\nIt runs ~\/notes\/w\.sh \(SHA-256 [0-9a-f]{12}…\); what that script reads later isn’t checked\./);
  assert.ok(!existsSync(at3('notes/ran.txt')));
  // The script changes before the press: the press runs nothing and asks again, with the new hash.
  writeFileSync(at3('notes/w.sh'), 'echo changed > notes/ran.txt\n');
  const yes = r.choices.find(c => c.label === 'Run it');
  const p = await choose(chat, yes.id);
  assert.equal(p.status, 200, p.text);
  assert.ok(!existsSync(at3('notes/ran.txt')), 'the changed script did not run on the old yes');
  assert.match(p.json.message.content, /Asked because a script it runs changed after you were asked, so that yes was void\./);
  const again = p.json.message.choices.find(c => c.label === 'Run it');
  const p2 = await choose(chat, again.id);
  assert.equal(p2.status, 200, p2.text);
  assert.equal(text('notes/ran.txt'), 'changed\n');
});

test('a risky delete is the dangerous ask, and it names what came from what the request read', { timeout: 120000 * SLOW }, async () => {
  const chat = await newChat();
  await turn(chat, 'clean up the tmp files on spark 3', [[RUN('cat notes/todo.txt')], [RUN('rm ~/notes/*.tmp')]]);
  const ask = (await chatMessages(chat)).find(m => m.danger);
  assert.ok(ask, 'the dangerous ask');
  const shown = ask.danger.lines.join('\n');
  assert.match(shown, /^DELETES FOR GOOD on Spark 3/);
  assert.match(shown, /\nCame from, not from you:\n {2}~\/notes\/: Run a command on a Spark on Spark 3 \(read \d\d:\d\d\)/, shown);
  assert.ok(existsSync(at3('notes/a.tmp')), 'nothing ran');
  // (closed again, so the next tests ask nothing open)
  const no = ask.choices.find(c => c.label === 'No');
  await choose(chat, no.id);
});

test('an agent\'s change is a button for the owner; not done, the lock-out class and Spark 2 are refused, with their own words on the line', { timeout: 120000 * SLOW }, async () => {
  const a = await call(keys.act.token, 'run', { on: 'spark3', command: 'touch notes/agent.txt', dir: '~' });
  assert.equal(a.isError, false, a.text);
  assert.equal(a.value.outcome, 'question', a.text);
  assert.match(a.value.note, /^Only the owner can answer this one, from Spark Console, and nothing was done\./);
  assert.ok(!existsSync(at3('notes/agent.txt')));
  const zw = `touch notes/zw${String.fromCharCode(0x200b)}.txt`;
  const nd = await run(zw);
  assert.equal(nd.status, 403, nd.text);
  assert.match(nd.json.error, /^Not done: It holds a sign that doesn’t show \(U\+200B\)/);
  const chat = await newChat();
  const r = await turn(chat, 'fix the keys on spark 3', [[RUN('chmod 600 ~/.ssh/authorized_keys')]]);
  assert.equal(r.tools[0].ok, false);
  assert.match(r.tools[0].tail, /^Nothing ran: a change that can lock you out of Spark 3 waits for the lock-out net \(a later build\)/);
  const [lock] = sentBack('fix the keys on spark 3');
  assert.match(lock.error, /\. It names “~\/\.ssh\/authorized_keys”, one of the ways in/, JSON.stringify(lock));
  const hub = await run('touch notes/x.txt', 'spark2');
  assert.equal(hub.status, 403, hub.text);
  assert.equal(hub.json.error, 'Spark 2 runs Spark Console and the brain: a change there is always asked first, and the runner never runs one.');
});

test('what put-back does not cover is said: on the button, and in the result when the sorter placed nothing', { timeout: 120000 * SLOW }, async () => {
  const command = `python3 -c "open('notes/py.txt','w').write('x')"`;
  const chat = await newChat();
  // ("run" asks to start something, not for work on the Spark: a button)
  const r = await turn(chat, 'run my tool on spark 3', [[RUN(command)]]);
  const [asked] = sentBack('run my tool on spark 3');
  assert.match(asked?.question || '', /\nAsked because your words don’t ask for a change\.\n/, JSON.stringify(asked));
  assert.ok(asked.question.includes(`\n${NOT_COVERED}`), asked.question);
  assert.ok(!existsSync(at3('notes/py.txt')));
  const direct = await run(command);
  assert.equal(direct.status, 200, direct.text);
  assert.equal(direct.json.notCovered, NOT_COVERED);
  assert.equal(direct.json.copied, 0);
  assert.equal(text('notes/py.txt'), 'x');
  await choose(chat, r.choices.find(c => c.label === 'No').id);
});

test('a change runs git with none of the owner\'s or the system\'s settings, no attributes file, no hooks and no file-system monitor, from the unit\'s own first lines', { timeout: 60000 * SLOW }, async () => {
  // (that a command setting or unsetting these is asked is the sorter's row: step A7a-git. The stand-in unit's home is the
  // owner's as /etc/passwd names it, /spark3, which isn't there here: no name or mail is carried over)
  const r = await run('git config --list > notes/git.txt');
  assert.equal(r.status, 200, r.text);
  assert.equal(text('notes/git.txt'), 'core.hookspath=/dev/null\ncore.fsmonitor=false\ncore.attributesfile=/dev/null\n');
  const env = await run('printenv GIT_CONFIG_GLOBAL GIT_CONFIG_NOSYSTEM GIT_ATTR_NOSYSTEM > notes/git-env.txt');
  assert.equal(env.status, 200, env.text);
  assert.equal(text('notes/git-env.txt'), '/dev/null\n1\n1\n');
});

test('the unit\'s git lines with a .gitconfig an earlier change left (an editor, an attributes file, another source for a pull): git gets none of it, only the owner\'s name and mail', () => {
  const src = readFileSync(join(REPO, 'service', 'src', '21-runner.mjs'), 'utf8');
  const decl = /^const RUNNER_GIT = \[[\s\S]*?\]\.join\('\\n'\);$/m.exec(src)?.[0];
  assert.ok(decl, 'RUNNER_GIT in 21-runner.mjs');
  const RUNNER_GIT = new Function(`${decl}\nreturn RUNNER_GIT;`)();
  const home = mkdtempSync(join(tmpdir(), 'sct-git-')), clean = { PATH: process.env.PATH, HOME: home, LANG: 'C' };
  try {
    const list = () => spawnSync('bash', ['--noprofile', '--norc', '-c', `${RUNNER_GIT}git config --list`], { cwd: home, env: clean, encoding: 'utf8' }).stdout;
    writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Stand In\n\temail = owner@example.invalid\n[core]\n\teditor = planted-editor\n\tattributesFile = ~/planted-attributes\n\tsshCommand = planted-ssh\n[url "https://example.invalid/"]\n\tinsteadOf = https://github.com/\n');
    assert.equal(list(), 'core.hookspath=/dev/null\ncore.fsmonitor=false\ncore.attributesfile=/dev/null\nuser.name=Stand In\nuser.email=owner@example.invalid\n');
    // (none set: none carried over, so git says so itself rather than take an empty one)
    writeFileSync(join(home, '.gitconfig'), '[core]\n\teditor = planted-editor\n');
    assert.equal(list(), 'core.hookspath=/dev/null\ncore.fsmonitor=false\ncore.attributesfile=/dev/null\n');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('a change whose end is unknown holds its Spark until the root helper says it has ended: no second change starts beside it', { timeout: 120000 * SLOW }, async () => {
  const drops = join(H3(), '.mock', 'sudo-drops'), t0 = Date.now();
  writeFileSync(drops, '');
  let first;
  try { first = await run('echo held > notes/held.txt && sleep 4 && touch notes/held-done'); } finally { rmSync(drops, { force: true }); }
  assert.equal(first.status, 503, first.text);
  const second = await run('touch notes/beside.txt');
  assert.equal(second.status, 409, second.text);
  assert.match(second.json.error, /^Something is already changing on Spark 3 \(a command Sparkie is running there\)/);
  assert.ok(!existsSync(at3('notes/beside.txt')));
  // (systemd says its unit is gone: the Spark is let go then, before the time limit)
  await waitFor(() => existsSync(at3('notes/held-done')), { every: 200, what: 'the change to end on the Spark' });
  await waitFor(async () => (await run('touch notes/beside.txt')).status === 200, { every: 500, timeout: 5000, what: 'the Spark to be let go once its unit is gone' });
  assert.ok(Date.now() - t0 < (SECONDS + 6) * 1000, 'let go before the time limit');
});

test('a held change the root helper has no mark of ("unknown") is over with its outcome unknown, never "never": its Spark stays held until its time limit has passed', { timeout: 120000 * SLOW }, async () => {
  const drops = join(H3(), '.mock', 'sudo-drops'), command = 'echo unk > notes/unk.txt && sleep 2 && touch notes/unk-done';
  writeFileSync(drops, '');
  let first;
  try { first = await run(command); } finally { rmSync(drops, { force: true }); }
  assert.equal(first.status, 503, first.text);
  const start = startOf(command), t0 = Date.parse(start.at);
  // (its mark can't be read from now on, as after state sweeps it at 130 minutes or a restart of the Spark: the helper
  // answers "unknown". A folder in its place, so the call's own last mark, written when its unit is gone, goes inside)
  const calls = join(H3(), '.rehearsal', 'run', 'spark-console', '.calls'), id = start.unit.slice('sw-run-'.length);
  await waitFor(() => existsSync(join(calls, id)), { every: 100, what: 'the call\'s mark' });
  mkdirSync(join(H3(), '.rehearsal', 'marks-aside'), { recursive: true });
  renameSync(join(calls, id), join(H3(), '.rehearsal', 'marks-aside', id));
  mkdirSync(join(calls, id));
  await waitFor(() => existsSync(at3('notes/unk-done')), { every: 200, what: 'the change to end on the Spark' });
  // (its unit has ended, but the helper can't say so: still held, as "never" or "ended" would not be)
  await sleep(3000);
  const beside = await run('touch notes/unk-beside.txt');
  assert.equal(beside.status, 409, beside.text);
  assert.match(beside.json.error, /^Something is already changing on Spark 3 \(a command Sparkie is running there\)/);
  assert.ok(Date.now() < t0 + (SECONDS + 6) * 1000, 'still inside its time limit');
  // (once its time limit has surely passed: let go)
  await waitFor(async () => (await run('touch notes/unk-beside.txt')).status === 200, { every: 1000, timeout: 30000, what: 'the Spark to be let go after the time limit' });
  assert.ok(Date.now() >= t0 + (SECONDS + 6) * 1000, 'not before its time limit');
});

test('/undo, the owner\'s word, puts back this chat\'s last change while changes are paused', { timeout: 120000 * SLOW }, async () => {
  const chat = await newChat();
  await turn(chat, 'change u on spark 3', [[RUN('echo after > notes/u.txt')]]);
  assert.equal(text('notes/u.txt'), 'after\n');
  await agentSettings({ halted: true });
  try {
    const r = await say(chat, '/undo');
    assert.match(r.text, /^\/undo\nPut back on Spark 3: 1 file\./, r.text);
    assert.equal(text('notes/u.txt'), 'u before\n');
  } finally { await agentSettings({ halted: false }); }
});

test('a change that touches a way in: its line carries the put-back mark of its own', { timeout: 120000 * SLOW }, async () => {
  const chat = await newChat();
  try {
    const r = await turn(chat, 'fix the keys script on spark 3', [[RUN('bash fix.sh')]]);
    assert.deepEqual([r.tools[0].ok, r.tools[0].putBack], [true, true], JSON.stringify(r.tools[0]));
    assert.equal(text('.ssh/authorized_keys'), KEYS_LINE);
  } finally { await agentSettings({ halted: false }); }
});

test('the unit\'s memory cap, worked out from what is free beyond the 8 GB kept: 1 GB at least, 8 at most, none below 1', () => {
  const src = readFileSync(join(REPO, 'service', 'src', '21-runner.mjs'), 'utf8');
  const fn = /^function runnerMemoryCap\(available\) \{[\s\S]*?\n\}$/m.exec(src)?.[0];
  assert.ok(fn, 'runnerMemoryCap');
  const cap = new Function('KEEP_FREE', `${fn}\nreturn runnerMemoryCap;`)(8 * 2 ** 30);
  const G = 2 ** 30;
  assert.deepEqual([7 * G, 8.5 * G, 9 * G, 12.5 * G, 16 * G, 100 * G].map(cap), [null, null, 1, 4, 8, 8]);
});

test('a change starts in the work folder, ~/work, which the console makes first (owner only); dir ~ starts it in the home', { timeout: 60000 * SLOW }, async () => {
  rmSync(at3('work'), { recursive: true, force: true });
  // (12 GB free: a cap of 4 GB, what is free beyond the 8 GB kept)
  const meminfo = at3('.mock/meminfo'), memWas = existsSync(meminfo) ? readFileSync(meminfo, 'utf8') : null;
  mkdirSync(dirname(meminfo), { recursive: true });
  writeFileSync(meminfo, 'MemTotal:       131072000 kB\nMemAvailable:   12582912 kB\n');
  let r;
  try { r = await run('echo w > here.txt', 'spark3', null); } finally { if (memWas === null) rmSync(meminfo, { force: true }); else writeFileSync(meminfo, memWas); }
  assert.equal(r.status, 200, r.text);
  assert.equal(text('work/here.txt'), 'w\n');
  // (on the real helper's rehearsal: the top of the home read-only for a plain change, ~/work one of its writable
  // folders, R63; the unit's memory cap, 1 to 8 GB, what is free beyond the 8 GB kept)
  const wall = propsOf('echo w > here.txt');
  assert.ok(wall.includes('ReadOnlyPaths=/spark3') && wall.includes('ReadWritePaths=/spark3/work'), JSON.stringify(wall));
  assert.ok(wall.includes('MemoryMax=4G') && r.json.memoryCap === '4 GB', JSON.stringify([r.json.memoryCap, wall]));
  // (a folder at the top of the home that is there is one of those writable folders: writing into it runs at once)
  const into = await run('cp work/here.txt notes/', 'spark3', '~');
  assert.equal(into.status, 200, into.text);
  assert.equal(text('notes/here.txt'), 'w\n');
  assert.ok(!existsSync(at3('here.txt')));
  assert.equal(statSync(at3('work')).mode & 0o777, 0o700);
  const held = unit => readFileSync(join(H3(), '.rehearsal', 'standin', 'ran', unit, 'dir'), 'utf8');
  const unitOf = command => lines(join(T.fleet.journalDir, readdirSync(T.fleet.journalDir).filter(f => f.endsWith('.jsonl')).sort().at(-1)))
    .filter(x => x.k === 'cmd' && x.start && x.args?.command === command).at(-1)?.unit;
  assert.equal(held(unitOf('echo w > here.txt')), join(H3(), 'work'), 'the unit was handed ~/work');
  const h = await run('echo h > notes/home.txt', 'spark3', '~');
  assert.equal(h.status, 200, h.text);
  assert.equal(held(unitOf('echo h > notes/home.txt')), H3());
  // An at-once change's time limit: 30 seconds on a Spark (this fleet shortens it), as the unit was given it.
  assert.match(readFileSync(join(REPO, 'service', 'src', '21-runner.mjs'), 'utf8'), /^const RUNNER_SECONDS = Number\(ALL_LOCAL && process\.env\.SPARK_CONSOLE_RUN_SECONDS\) \|\| 30;$/m);
  const unit = lines(join(H3(), '.rehearsal', 'calls.log')).find(c => c[0] === 'systemd-run' && c.includes(`--unit=${unitOf('echo h > notes/home.txt')}`));
  assert.ok(unit?.includes(`RuntimeMaxSec=${SECONDS}`), JSON.stringify(unit));
  // dir names ~/work, or a folder under ~ that is there; a link, or a folder that isn't there, is refused by the copies'
  // program before any unit (only ~/work is made), and nothing ran.
  const w = await run('echo k > kept.txt', 'spark3', '~/work');
  assert.equal(w.status, 200, w.text);
  assert.equal(held(unitOf('echo k > kept.txt')), join(H3(), 'work'));
  const n = await run('echo n > n.txt', 'spark3', '~/notes');
  assert.equal(n.status, 200, n.text);
  assert.equal(text('notes/n.txt'), 'n\n');
  symlinkSync('notes', at3('linked'));
  const linked = await run('echo l > l.txt', 'spark3', '~/linked');
  assert.equal(linked.status, 409, linked.text);
  assert.equal(linked.json.error, 'The copies on Spark 3: ~/linked is not a folder of this account (a link, or not a folder).');
  const gone = await run('echo g > g.txt', 'spark3', '~/not-there');
  assert.equal(gone.status, 409, gone.text);
  assert.equal(gone.json.error, 'The copies on Spark 3: ~/not-there is not there, and a change starts only in a folder that is (~/work alone is made when missing).');
  assert.ok(!existsSync(at3('notes/l.txt')) && !existsSync(at3('not-there')), 'nothing ran, nothing made');
  assert.equal(unitOf('echo l > l.txt'), undefined);
});

test('a change the sorter places in the model store is asked and runs after the yes, without that folder read-only; every other change gets the model store read-only, through a link too; one that starts there is asked', { timeout: 120000 * SLOW }, async () => {
  mkdirSync(at3('models/m1'), { recursive: true });
  writeFileSync(at3('models/m1/config.json'), 'a\n');
  const chat = await newChat();
  const r = await turn(chat, 'fix the model settings on spark 3', [[RUN('touch models/m1/spark.json')]]);
  const [asked] = sentBack('fix the model settings on spark 3');
  assert.match(asked?.question || '', /\nAsked because it changes ~\/models, which a change gets only after your yes\.\n/, JSON.stringify(asked));
  assert.ok(!existsSync(at3('models/m1/spark.json')));
  const p = await choose(chat, r.choices.find(c => c.label === 'Run it').id);
  assert.equal(p.status, 200, p.text);
  assert.ok(existsSync(at3('models/m1/spark.json')), p.text);
  assert.ok(!propsOf('touch models/m1/spark.json').includes('ReadOnlyPaths=/spark3/models'), 'after the yes, without the folder it was asked for');
  // (the owner's own call is refused, in the runner's words: no button to show there)
  const d = await run('touch models/m1/other.json');
  assert.equal(d.status, 409, d.text);
  assert.match(d.json.error, /^It changes ~\/models, which a change gets only after the owner’s yes, so nothing ran\.$/);
  // A link into the model store, which the sorter can't see: the change runs at once, and the wall keeps the store
  // read-only for it (--protect '~/models', from the owner's home): on a Spark sed's write fails there.
  mkdirSync(at3('work'), { recursive: true });
  rmSync(at3('work/model'), { force: true });
  symlinkSync('../models/m1', at3('work/model'));
  const l = await run('sed -i s/a/b/ model/config.json', 'spark3', null);
  assert.equal(l.status, 200, l.text);
  assert.ok(propsOf('sed -i s/a/b/ model/config.json').includes('ReadOnlyPaths=/spark3/models'), JSON.stringify(propsOf('sed -i s/a/b/ model/config.json')));
  // Starting in the model store (make, npm install: nothing placed there) is asked; the owner's own call is refused.
  const m = await run('make', 'spark3', '~/models/m1');
  assert.equal(m.status, 409, m.text);
  assert.equal(m.json.error, 'It starts in ~/models, which a change gets only after the owner’s yes, so nothing ran.');
  const c2 = await newChat();
  await turn(c2, 'fix the model build on spark 3', [[RUN('make', '~/models/m1')]]);
  const [built] = sentBack('fix the model build on spark 3');
  assert.match(built?.question || '', /\nAsked because it starts in ~\/models, which a change gets only after your yes\.\n/, JSON.stringify(built));
  assert.equal(startOf('make'), undefined, 'nothing ran');
});

test('no change runs at once while a Spark advertises Tailscale SSH, or while that can\'t be told (a Spark missing, offline, or the answer unread)', { timeout: 120000 * SLOW }, async () => {
  const status = join(T.fleet.dir, 'status.json');
  const peer = (n, extra = {}) => ({ [`nodekey:${n}`]: { HostName: `akspark${n}`, TailscaleIPs: [`100.64.0.${n}`], Online: true, ...extra } });
  const tailnet = peers => JSON.stringify({ BackendState: 'Running', Self: { HostName: 'akspark2', TailscaleIPs: ['100.64.0.2'] }, Peer: Object.assign({}, ...peers) });
  const asks = async (n, re) => {
    await sleep(2500);
    const chat = await newChat(), words = `fix the notes ${n} on spark 3`;
    const r = await turn(chat, words, [[RUN(`echo ${n} > notes/ts${n}.txt`)]]);
    const [asked] = sentBack(words);
    assert.match(asked?.question || '', re, JSON.stringify(asked));
    assert.ok(!existsSync(at3(`notes/ts${n}.txt`)), 'nothing ran');
    await choose(chat, r.choices.find(c => c.label === 'No').id);
  };
  try {
    writeFileSync(status, tailnet([peer(1), peer(3, { sshHostKeys: ['ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIStandInHostKey'] }), peer(4)]));
    await asks(1, /\nAsked because Tailscale SSH is on for Spark 3, so a command could reach a shell there with no key\.\n/);
    writeFileSync(status, tailnet([peer(1), peer(3)]));
    await asks(2, /\nAsked because whether Tailscale SSH is on for Spark 4 couldn’t be told\.\n/);
    writeFileSync(status, tailnet([peer(1), peer(3), peer(4, { Online: false })]));
    await asks(3, /\nAsked because whether Tailscale SSH is on for Spark 4 couldn’t be told\.\n/);
    writeFileSync(status, 'not json');
    await asks(4, /\nAsked because whether Tailscale SSH is on for Spark 1, Spark 2, Spark 3, Spark 4 couldn’t be told\.\n/);
  } finally { rmSync(status, { force: true }); }
  await sleep(2500);
  const chat = await newChat();
  const r = await turn(chat, 'fix the notes 5 on spark 3', [[RUN('echo 5 > notes/ts5.txt')]]);
  assert.deepEqual(r.choices, [], 'at once again');
  assert.equal(text('notes/ts5.txt'), '5\n');
});

test('no change runs at once while something on that Spark listens on every address, but sshd and what the console published; a look that fails is asked', { timeout: 120000 * SLOW }, async () => {
  const listens = at3('.mock/ss'), fails = at3('.mock/ss-fails');
  const asks = async (n, re) => {
    const chat = await newChat(), words = `fix the port notes ${n} on spark 3`;
    const r = await turn(chat, words, [[RUN(`echo ${n} > notes/port${n}.txt`)]]);
    const [asked] = sentBack(words);
    assert.match(asked?.question || '', re, JSON.stringify(asked));
    assert.ok(!existsSync(at3(`notes/port${n}.txt`)), 'nothing ran');
    await choose(chat, r.choices.find(c => c.label === 'No').id);
  };
  try {
    writeFileSync(listens, 'LISTEN 0 128 0.0.0.0:8888 0.0.0.0:* users:(("jupyter-lab",pid=4242,fd=5))\n');
    await asks(1, /\nAsked because port 8888 \(jupyter-lab\) listens on every address on Spark 3, which a change could reach\.\n/);
    writeFileSync(listens, 'LISTEN 0 128 [::]:5432 [::]:*\n');
    await asks(2, /\nAsked because port 5432 listens on every address on Spark 3, which a change could reach\.\n/);
    // sshd, the console's own serve port, and what listens on the loopback alone: at once
    writeFileSync(listens, `LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=1,fd=3))\nLISTEN 0 128 *:${T.fleet.servePort} *:*\nLISTEN 0 128 127.0.0.1:9999 0.0.0.0:*\n`);
    const ok = await turn(await newChat(), 'fix the port notes 3 on spark 3', [[RUN('echo 3 > notes/port3.txt')]]);
    assert.deepEqual(ok.choices, [], 'at once');
    assert.equal(text('notes/port3.txt'), '3\n');
    rmSync(listens, { force: true });
    writeFileSync(fails, '');
    await asks(4, /\nAsked because whether something listens on every address on Spark 3 couldn’t be told\.\n/);
  } finally { rmSync(listens, { force: true }); rmSync(fails, { force: true }); }
  const back = await turn(await newChat(), 'fix the port notes 5 on spark 3', [[RUN('echo 5 > notes/port5.txt')]]);
  assert.deepEqual(back.choices, [], 'at once again');
});

// The hold asks the root helper (state --id): after the console stopped waiting for a change (its own time-out) the
// Spark stays held while the helper says the call runs, and its after-look waits for the helper's "ended".
test('after a change the console stopped waiting for, its Spark is held while the root helper says it runs, and its after-look waits for its end', { timeout: 120000 * SLOW }, async () => {
  const pastLimit = join(H3(), '.rehearsal', 'standin', 'past-limit'), command = 'echo t > notes/t.txt && sleep 24 && touch notes/t-done';
  writeFileSync(pastLimit, '');
  const pending = run(command, 'spark3', '~');
  try { await waitFor(() => existsSync(at3('notes/t.txt')), { every: 100, what: 'the change to start' }); } finally { rmSync(pastLimit, { force: true }); }
  const first = await pending;
  assert.equal(first.status, 200, first.text);
  assert.match(first.json.ended || '', /didn’t answer within 14 seconds, so whether it finished is unknown/, first.text);
  const afterLook = join(H3(), '.local/share/spark-console/before', first.json.set, 'after.json');
  await sleep(2500);
  const beside = await run('touch notes/t-beside.txt', 'spark3', '~');
  assert.equal(beside.status, 409, beside.text);
  assert.match(beside.json.error, /^Something is already changing on Spark 3/);
  assert.ok(!existsSync(afterLook), 'no after-look while it may still run');
  await waitFor(() => existsSync(at3('notes/t-done')), { timeout: 40000, every: 500, what: 'the change to end' });
  let last = null;
  try {
    await waitFor(async () => (last = await run('touch notes/t-beside.txt', 'spark3', '~')).status === 200, { every: 1000, timeout: 15000, what: 'the Spark let go once the helper says it has ended' });
  } catch (e) {
    // (what the helper's own mark of the call says, and whether that program still runs: so a failure says why)
    const unit = startOf(command)?.unit || '', mark = join(H3(), '.rehearsal', 'run', 'spark-console', '.calls', unit.slice('sw-run-'.length));
    const m = existsSync(mark) ? readFileSync(mark, 'utf8').trim() : '(no mark)', pid = /^\S+ (\d+)$/.exec(m)?.[1];
    const st = pid && existsSync(`/proc/${pid}/stat`) ? readFileSync(`/proc/${pid}/stat`, 'utf8').split(' ').slice(0, 3).join(' ') : '(gone)';
    assert.fail(`${e.message}; the helper's mark: ${m}; its program: ${st}; live: ${existsSync(join(H3(), '.rehearsal', 'standin', 'live', unit))}; last: ${last?.status} ${last?.text?.slice(0, 200)}`);
  }
  assert.ok(existsSync(afterLook), 'the after-look, once it ended');
});

test('an asked change may reach the other Sparks (--fleet) or the GPU (--gpu), each said on the button; never at once', { timeout: 120000 * SLOW }, async () => {
  const chat = await newChat(), cmd = 'curl -s http://spark4:8000/v1/models -o notes/models.json';
  const r = await turn(chat, 'fix the models list on spark 3', [[RUN(cmd)]]);
  const [asked] = sentBack('fix the models list on spark 3');
  // (the sorter's own reason first, when it calls it risky: R64 asks for a command that reaches another Spark)
  assert.match(asked?.question || '', /\nAsked because [^\n]*(?:another Spark|a Spark or the home network)[^\n]*[^.]\.\nWith your yes it may also reach the other Sparks and your home network \(their addresses are closed to a change otherwise\)\.\n/, JSON.stringify(asked));
  assert.equal(startOf(cmd), undefined, 'nothing ran');
  const p = await choose(chat, r.choices.find(c => c.label === 'Run it').id);
  assert.equal(p.status, 200, p.text);
  const fleet = propsOf(cmd);
  assert.ok(fleet.includes('IPAddressDeny=localhost') && fleet.includes('PrivateDevices=yes'), JSON.stringify(fleet));
  // (the owner's own call: refused, in the runner's words)
  const api = await run(cmd);
  assert.equal(api.status, 409, api.text);
  assert.equal(api.json.error, 'It reaches another Spark of this fleet, which a change gets only after the owner’s yes, so nothing ran.');
  const g = 'echo g > notes/g.txt', c2 = await newChat();
  const gr = await turn(c2, 'fix the gpu notes on spark 3', [[{ name: 'run', arguments: { on: 'spark3', command: g, dir: '~', gpu: true } }]]);
  const [gasked] = sentBack('fix the gpu notes on spark 3');
  assert.match(gasked?.question || '', /\nAsked because it uses the GPU\.\nWith your yes it may also use the GPU and the other devices \(closed to a change otherwise\)\.\n/, JSON.stringify(gasked));
  const gp = await choose(c2, gr.choices.find(c => c.label === 'Run it').id);
  assert.equal(gp.status, 200, gp.text);
  const gpu = propsOf(g);
  assert.ok(!gpu.includes('PrivateDevices=yes') && gpu.some(a => a.startsWith('IPAddressDeny=localhost 10.0.0.0/8')), JSON.stringify(gpu));
  // (a look takes neither)
  const look = await api_('ls', { gpu: true });
  assert.equal(look.status, 400, look.text);
  assert.equal(look.json.error, 'A look reaches no network and no device: fleet and gpu are for a change, asked first.');
});
const api_ = (command, extra = {}) => api('/actions/run', { method: 'POST', body: { on: 'spark3', command, dir: '~', ...extra } });

test('a change that would fail inside the plain wall is asked, not run to fail: a write at the top of the home runs with it writable (--home), another dot folder outside the plain wall (--open); pip install --user', { timeout: 120000 * SLOW }, async () => {
  const chat = await newChat(), cmd = 'echo top > top.txt';
  const r = await turn(chat, 'fix the top note on spark 3', [[RUN(cmd)]]);
  const [asked] = sentBack('fix the top note on spark 3');
  assert.match(asked?.question || '', /\nAsked because it writes ~\/top\.txt at the top of the home, which the plain wall keeps read-only, so it runs after your yes with the top of your home writable\.\nIt writes where a plain change can’t: ~\/top\.txt at the top of your home\.\nIt runs walled: no Docker, no keys, no other Spark\. But it may add or replace programs and settings that your own terminal on Spark 3 runs by itself\. If the command is not what it says, your next terminal there runs what it left\.\nIt is ended if the disk’s free space falls under 5 GB \(or, when less was free at its start, 100 MB under that\)\.\n/, JSON.stringify(asked));
  assert.ok(!existsSync(at3('top.txt')), 'nothing ran');
  const p = await choose(chat, r.choices.find(c => c.label === 'Run it').id);
  assert.equal(p.status, 200, p.text);
  assert.equal(text('top.txt'), 'top\n');
  // (the plain wall with the top of the home writable: still no network ranges, no devices)
  const homeWall = propsOf(cmd);
  assert.ok(!homeWall.includes('ReadOnlyPaths=/spark3') && homeWall.some(a => a.startsWith('IPAddressDeny=localhost 10.0.0.0/8')) && homeWall.includes('PrivateDevices=yes'), JSON.stringify(homeWall));
  assert.deepEqual([startOf(cmd).outside, startOf(cmd).wall], [['it writes ~/top.txt at the top of the home, which the plain wall keeps read-only'], 'home']);
  // Another dot folder at the top: outside the plain wall (--open), with its stark words.
  const dot = 'echo c > .myapp/c.txt', c3 = await newChat();
  mkdirSync(at3('.myapp'), { recursive: true });
  const rd = await turn(c3, 'fix the app config on spark 3', [[RUN(dot)]]);
  const [askedDot] = sentBack('fix the app config on spark 3');
  assert.match(askedDot?.question || '', /\nAsked because it writes ~\/\.myapp\/c\.txt, which the plain wall keeps read-only, so it runs outside that wall after your yes\.\nRuns outside the plain wall: it writes ~\/\.myapp\/c\.txt, which the plain wall keeps read-only\.\nThere it runs as you with all your groups, Docker’s too, and Docker on a Spark is as good as root: it can do anything there that root can\. Every address \(the other Sparks, your home network\) and the GPU are open to it, and so are the keys and tokens in your home\. ~\/\.ssh and the start files stay read-only, but not to what it does through Docker\.\n/, JSON.stringify(askedDot));
  const pd = await choose(c3, rd.choices.find(c => c.label === 'Run it').id);
  assert.equal(pd.status, 200, pd.text);
  const openWall = propsOf(dot);
  assert.ok(!openWall.includes('ReadOnlyPaths=/spark3') && !openWall.some(a => a.startsWith('IPAddressDeny=')) && !openWall.includes('PrivateDevices=yes'), JSON.stringify(openWall));
  assert.equal(startOf(dot).wall, 'open');
  // The press ran exactly what the button showed (the unit's own held command, after code's git line).
  assert.ok(readFileSync(join(H3(), '.rehearsal', 'standin', 'ran', startOf(cmd).unit, 'command'), 'utf8').endsWith(`\n${cmd}`));
  // Nothing takes that path without the owner's press: the brain's arguments can't ask for it, an agent's call is a
  // button for the owner, and the owner's own call (no button to show) is refused; nothing ran.
  const c2 = await newChat(), forced = 'echo forced > forced.txt';
  await turn(c2, 'fix the forced note on spark 3', [[{ name: 'run', arguments: { on: 'spark3', command: forced, dir: '~', open: true } }]]);
  const [bad] = sentBack('fix the forced note on spark 3');
  assert.match(bad?.error || '', /^Unknown argument: open\./, JSON.stringify(bad));
  const agent = await call(keys.act.token, 'run', { on: 'spark3', command: forced, dir: '~' });
  assert.ok(!agent.isError && /^(?:needs-ok|question)$/.test(agent.value?.outcome || ''), agent.text);
  const own = await run(forced, 'spark3', '~');
  assert.equal(own.status, 409, own.text);
  assert.ok(!existsSync(at3('forced.txt')) && !startOf(forced), 'nothing ran, nothing started');
  const pip = await run('pip install --user requests', 'spark3', null);
  assert.equal(pip.status, 409, pip.text);
  assert.equal(pip.json.error, 'It would fail inside the plain wall (it installs into ~/.local, which the plain wall keeps read-only), so it runs with the top of the home writable, and only after the owner’s yes. Nothing ran.');
  assert.ok(!readFileSync(join(REPO, 'service', 'src', '21-work.mjs'), 'utf8').includes('pip install --user'), 'run’s words no longer give it as a change that works');
});

test('a script is hashed where the change reads it (dir, ~/work by default): the button shows that file; changing it voids the press; a same-named file in the home does not matter', { timeout: 120000 * SLOW }, async () => {
  mkdirSync(at3('work'), { recursive: true });
  writeFileSync(at3('work/run.sh'), 'echo from work > ran-here.txt\n');
  writeFileSync(at3('run.sh'), 'echo from home\n');
  const chat = await newChat();
  // (words that don't name the Spark: a button)
  const r = await turn(chat, 'fix it with the run script', [[RUN('bash run.sh', null)]]);
  const [asked] = sentBack('fix it with the run script');
  assert.ok((asked?.question || '').includes(`\nIt runs ~/work/run.sh (SHA-256 ${sha('echo from work > ran-here.txt\n').slice(0, 12)}…)`), JSON.stringify(asked));
  // A same-named file in the home changes: the press runs.
  writeFileSync(at3('run.sh'), 'echo changed in home\n');
  const p = await choose(chat, r.choices.find(c => c.label === 'Run it').id);
  assert.equal(p.status, 200, p.text);
  assert.equal(text('work/ran-here.txt'), 'from work\n');
  // The file that runs changes between the ask and the press: the yes is void, and it is asked again.
  const c2 = await newChat();
  const r2 = await turn(c2, 'fix it with the run script again', [[RUN('bash run.sh', null)]]);
  writeFileSync(at3('work/run.sh'), 'echo changed in work > ran-here.txt\n');
  const p2 = await choose(c2, r2.choices.find(c => c.label === 'Run it').id);
  assert.equal(p2.status, 200, p2.text);
  assert.match(p2.json.message.content, /Asked because a script it runs changed after you were asked, so that yes was void\./);
  assert.equal(text('work/ran-here.txt'), 'from work\n', 'the changed script did not run on the old yes');
});

test('a script\'s hash is pinned only where the folder it is read from is plain (none, or one first cd <folder> &&); any other cd, or a name with .., says its text isn\'t pinned', { timeout: 120000 * SLOW }, async () => {
  mkdirSync(at3('work/a/b'), { recursive: true });
  writeFileSync(at3('work/a/x.sh'), 'echo a > ax.txt\n');
  writeFileSync(at3('work/a/b/x.sh'), 'echo ab\n');
  const chat = await newChat(), r = await turn(chat, 'fix it with the a script', [[RUN('cd a && bash x.sh', null)]]);
  const [one] = sentBack('fix it with the a script');
  assert.ok((one?.question || '').includes(`\nIt runs ~/work/a/x.sh (SHA-256 ${sha('echo a > ax.txt\n').slice(0, 12)}…); what that script reads later isn’t checked.`), JSON.stringify(one));
  await choose(chat, r.choices.find(c => c.label === 'No').id);
  for (const [n, cmd] of [[1, 'cd a && cd b && bash x.sh'], [2, '{ cd a; bash x.sh; }'], [3, "bash -c 'cd a && bash x.sh'"], [4, 'mkdir -p c && cd c && bash ../a/x.sh']]) {
    const c = await newChat(), words = `fix it with the x script ${n}`, rr = await turn(c, words, [[RUN(cmd, null)]]);
    const [q] = sentBack(words);
    assert.ok(/\nIt runs [^\n]*x\.sh; its text isn’t pinned by a hash, so a change to it after this ask isn’t seen\./.test(q?.question || '') && !/SHA-256/.test(q.question), `${cmd}: ${JSON.stringify(q)}`);
    await choose(c, rr.choices.find(x => x.label === 'No').id);
  }
});

test('each button keeps its own ask: of two buttons for one command in a chat, the second, pressed after its script changed, is asked again', { timeout: 120000 * SLOW }, async () => {
  mkdirSync(at3('work'), { recursive: true });
  writeFileSync(at3('work/twice.sh'), 'echo first >> twice.txt\n');
  const chat = await newChat();
  const a = await turn(chat, 'fix it with the twice script', [[RUN('bash twice.sh', null)]]);
  const b = await turn(chat, 'fix it once more with the twice script', [[RUN('bash twice.sh', null)]]);
  const yesA = a.choices.find(c => c.label === 'Run it'), yesB = b.choices.find(c => c.label === 'Run it');
  assert.ok(yesA && yesB && yesA.id !== yesB.id, JSON.stringify([a.choices, b.choices]));
  const pa = await choose(chat, yesA.id);
  assert.equal(pa.status, 200, pa.text);
  assert.equal(text('work/twice.txt'), 'first\n');
  writeFileSync(at3('work/twice.sh'), 'echo changed >> twice.txt\n');
  const pb = await choose(chat, yesB.id);
  assert.equal(pb.status, 200, pb.text);
  assert.match(pb.json.message.content, /Asked because a script it runs changed after you were asked, so that yes was void\./);
  assert.equal(text('work/twice.txt'), 'first\n', 'the changed script did not run on the other button\'s yes');
  await choose(chat, pb.json.message.choices.find(c => c.label === 'No').id);
});

test('the press runs in the wall its button showed: a folder at the top of the home gone since the ask makes it asked again, with the new wall\'s words', { timeout: 120000 * SLOW }, async () => {
  mkdirSync(at3('proj3'), { recursive: true });
  const chat = await newChat(), cmd = 'cp notes/e.txt proj3';
  const r = await turn(chat, 'fix the project copy', [[RUN(cmd)]]);
  const [asked] = sentBack('fix the project copy');
  assert.equal(asked?.outcome, 'needs-ok', JSON.stringify(asked));
  assert.ok(!/top of your home|outside the plain wall/.test(asked.question), asked.question);
  rmSync(at3('proj3'), { recursive: true });
  const p = await choose(chat, r.choices.find(c => c.label === 'Run it').id);
  assert.equal(p.status, 200, p.text);
  assert.match(p.json.message.content, /\nAsked because it would run with the top of your home writable now, and you were asked for it in the plain wall, so that yes was void\.\nIt writes where a plain change can’t: ~\/proj3 at the top of your home\.\n/, p.json.message.content);
  assert.ok(!existsSync(at3('proj3')) && !startOf(cmd), 'nothing ran');
  await choose(chat, p.json.message.choices.find(c => c.label === 'No').id);
});

test('both asks say the folder the change starts in: the button and the dangerous ask', { timeout: 120000 * SLOW }, async () => {
  mkdirSync(at3('proj-dl'), { recursive: true });
  const chat = await newChat(), r = await turn(chat, 'fix the project note', [[RUN('touch dl.txt', '~/proj-dl')]]);
  const [asked] = sentBack('fix the project note');
  assert.ok((asked?.question || '').includes('\nIt starts in ~/proj-dl.\n'), JSON.stringify(asked));
  await choose(chat, r.choices.find(c => c.label === 'No').id);
  const c2 = await newChat(), r2 = await turn(c2, 'fix the work note', [[RUN('touch dl.txt', null)]]);
  const [plain] = sentBack('fix the work note');
  assert.ok((plain?.question || '').includes('\nIt starts in ~/work.\n'), JSON.stringify(plain));
  await choose(c2, r2.choices.find(c => c.label === 'No').id);
  writeFileSync(at3('notes/x.dl'), 'x\n');
  const c3 = await newChat();
  await turn(c3, 'clean the dl files on spark 3', [[RUN('rm notes/*.dl')]]);
  const ask = (await chatMessages(c3)).findLast(m => m.danger);
  assert.ok(ask?.danger.lines.includes('It starts in ~.'), JSON.stringify(ask?.danger?.lines));
  await choose(c3, ask.choices.find(c => c.label === 'No').id);
});

test('the dangerous ask says the wall it runs in after the yes and what that lets it do, and its press runs there', { timeout: 120000 * SLOW }, async () => {
  writeFileSync(at3('notes/b.tmp'), 'b\n');
  const chat = await newChat(), cmd = 'rm notes/*.tmp && echo x > top2.txt';
  await turn(chat, 'clean the tmp files and write the top note on spark 3', [[RUN(cmd)]]);
  const ask = (await chatMessages(chat)).findLast(m => m.danger);
  assert.ok(ask, 'the dangerous ask');
  const shown = ask.danger.lines.join('\n');
  assert.match(shown, /^DELETES FOR GOOD on Spark 3/);
  assert.match(shown, /\nIt writes where a plain change can’t: ~\/top2\.txt at the top of your home\.\nIt runs walled: no Docker, no keys, no other Spark\. But it may add or replace programs and settings that your own terminal on Spark 3 runs by itself\. If the command is not what it says, your next terminal there runs what it left\.\nIt is ended if the disk’s free space falls under 5 GB \(or, when less was free at its start, 100 MB under that\)\.(?:\n|$)/, shown);
  const pair = (await api(`/chats/${chat}`)).json.messages.find(m => m.danger?.ask === ask.danger.ask)?.pair;
  const p = await api(`/chats/${chat}/choose`, { method: 'POST', body: { choice: ask.choices.find(c => c.pair).id, pair } });
  assert.equal(p.status, 200, p.text);
  assert.equal(text('top2.txt'), 'x\n');
  assert.equal(startOf(cmd)?.wall, 'home');
  // Docker: outside the plain wall, with its stark words.
  const c2 = await newChat();
  await turn(c2, 'remove the web container on spark 3', [[RUN('docker rm -f web')]]);
  const ask2 = (await chatMessages(c2)).findLast(m => m.danger);
  assert.ok(ask2, 'the dangerous ask');
  assert.match(ask2.danger.lines.join('\n'), /\nRuns outside the wall: “docker” needs the Docker socket, which the run wall hides \(Docker is root by another name\): free-form, it is always asked\.\nThere it runs as you with all your groups, Docker’s too, and Docker on a Spark is as good as root: it can do anything there that root can\. Every address \(the other Sparks, your home network\) and the GPU are open to it, and so are the keys and tokens in your home\. ~\/\.ssh and the start files stay read-only, but not to what it does through Docker\.(?:\n|$)/, ask2.danger.lines.join('\n'));
  await choose(c2, ask2.choices.find(c => c.label === 'No').id);
});

test('a script is hashed through the root helper\'s look; when that look gives no answer of its own, the button says none is hashed, and the press runs as it said', { timeout: 120000 * SLOW }, async () => {
  mkdirSync(at3('work'), { recursive: true });
  writeFileSync(at3('work/s6.sh'), 'echo s6 > s6.txt\n');
  const chat = await newChat();
  const r = await turn(chat, 'fix it with the s6 script', [[RUN('bash s6.sh', null)]]);
  const [asked] = sentBack('fix it with the s6 script');
  assert.ok((asked?.question || '').includes(`\nIt runs ~/work/s6.sh (SHA-256 ${sha('echo s6 > s6.txt\n').slice(0, 12)}…)`), JSON.stringify(asked));
  const ran = join(H3(), '.rehearsal', 'standin', 'ran'), cmdOf = u => (existsSync(join(ran, u, 'command')) ? readFileSync(join(ran, u, 'command'), 'utf8') : '');
  assert.ok(readdirSync(ran).some(u => u.startsWith('sw-look-') && cmdOf(u).includes("sha256sum < './work/s6.sh'")), 'hashed inside a look unit');
  await choose(chat, r.choices.find(c => c.label === 'No').id);
  // The look gives no answer of its own (systemd refuses its unit): no hash, no word of whether the file is there.
  const refuse = join(H3(), '.rehearsal', 'standin', 'refuse'), c2 = await newChat();
  writeFileSync(refuse, 'sw-look-');
  let r2;
  try { r2 = await turn(c2, 'fix it with the s6 script again', [[RUN('bash s6.sh', null)]]); } finally { rmSync(refuse, { force: true }); }
  const [asked2] = sentBack('fix it with the s6 script again');
  assert.match(asked2?.question || '', /\nThe scripts it runs couldn’t be read here \([^)\n]+\), so none is hashed: a change to one after this ask isn’t seen\.$/, JSON.stringify(asked2));
  assert.ok(!/SHA-256|isn’t a file in/.test(asked2.question), asked2.question);
  // (the press runs it as that button said: unchecked)
  writeFileSync(at3('work/s6.sh'), 'echo s6 changed > s6.txt\n');
  const p = await choose(c2, r2.choices.find(c => c.label === 'Run it').id);
  assert.equal(p.status, 200, p.text);
  assert.equal(text('work/s6.txt'), 's6 changed\n');
});

test('what a pressed change wrote joins its request\'s task, so a later command of that request that runs it is asked', { timeout: 180000 * SLOW }, async () => {
  const RADIX = 'sc-RadixArk--Qwen3.8-27B-NVFP4', chat = await newChat(), words = `stop ${RADIX} on spark 4 and then fix the notes on spark 3`;
  const r = await turn(chat, words, [[{ name: 'stop_model', arguments: { spark: 'spark4', container: RADIX } }], [{ name: 'run', arguments: { on: 'spark3', command: 'echo echo hi > notes/w2.sh', dir: '~', gpu: true } }]]);
  const task = () => JSON.parse(readFileSync(join(T.fleet.stateDir, 'chats.json'), 'utf8')).conversations.find(c => c.id === chat)?.task;
  assert.ok(task(), 'the request has a task (a model stopped, and a next step)');
  assert.ok(!(task().written || []).includes('~/notes/w2.sh'));
  const p = await choose(chat, r.choices.find(c => c.label === 'Run it').id);
  assert.equal(p.status, 200, p.text);
  assert.ok((task().written || []).includes('~/notes/w2.sh'), JSON.stringify(task()));
});

test('the root helper\'s disk floor is said plainly: under 50 GB free nothing runs at once; a change the owner pressed goes with --asked and runs', { timeout: 60000 * SLOW }, async () => {
  const free = join(H3(), '.rehearsal', 'standin', 'free');
  writeFileSync(free, '49000000000\n');
  let r, p;
  try {
    r = await run('echo d > notes/d.txt', 'spark3', '~');
    const chat = await newChat(), asked = await turn(chat, 'fix the d note', [[RUN('echo d > notes/d2.txt')]]);
    p = await choose(chat, asked.choices.find(c => c.label === 'Run it').id);
  } finally { rmSync(free, { force: true }); }
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json.error, 'Nothing ran: Spark 3’s disk has 49 GB free, and a change that runs at once needs 50 GB free (the root helper’s floor). With your yes it may start under the floor, and is ended if the free space falls under 5 GB: ask for it in your chat, or free space there first.');
  assert.ok(!existsSync(at3('notes/d.txt')));
  assert.equal(p.status, 200, p.text);
  assert.equal(text('notes/d2.txt'), 'd\n', 'pressed, it ran under the floor');
});

test('a plain change that ends with the signs of no GPU says so: the GPU isn\'t open to a plain change, GPU work is a job, or ask again with gpu', { timeout: 60000 * SLOW }, async () => {
  const r = await run("echo 'RuntimeError: No CUDA GPUs are available' > notes/gpu.log; cat notes/gpu.log; exit 1", 'spark3', '~');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.notes, ['The GPU isn’t open to a plain change (it gets no devices): GPU work is a job (keep_running with once and gpu), or ask for this again with gpu, which is asked first.']);
  const fine = await run('echo plain > notes/gpu.log', 'spark3', '~');
  assert.equal(fine.json.notes, undefined);
});

test('the root helper\'s own last lines (the disk floor ended it, the home put back) come apart from what the command printed, said plainly', () => {
  const src = readFileSync(join(REPO, 'service', 'src', '21-work.mjs'), 'utf8'), rsrc = readFileSync(join(REPO, 'service', 'src', '21-runner.mjs'), 'utf8');
  const fn = /^function helperAnswer\([^)]*\) \{[\s\S]*?\n\}$/m.exec(src)?.[0], note = /^const runnerNote = .*$/m.exec(rsrc)?.[0];
  // (the helper's sentences the console reads, one table both use: 21-work.mjs)
  const says = /^const HELPER_SAYS = \{[\s\S]*?\n\};$/m.exec(src)?.[0];
  assert.ok(fn && note && says);
  const HELPER_SAYS = new Function(`${says}\nreturn HELPER_SAYS;`)();
  const helperAnswer = new Function('maskSecrets', 'HELPER_SAYS', `${fn}\nreturn helperAnswer;`)(String, HELPER_SAYS), runnerNote = new Function('HELPER_SAYS', `${note}\nreturn runnerNote;`)(HELPER_SAYS);
  const id = 'abcdefgh1234';
  const a = helperAnswer({ id, code: 0, out: `hello\n\n${id} the home's mode and owner were put back (700, not 777)\n${id} end 0\n` });
  assert.deepEqual([a.kind, a.output, a.exit, a.notes], ['ran', 'hello\n', 0, ["the home's mode and owner were put back (700, not 777)"]]);
  const b = helperAnswer({ id, code: 9, out: `part\n${id} stopped: the disk's free space fell under 50 GB\n${id} end 9\n` });
  assert.deepEqual([b.output, b.exit, b.notes], ['part', 9, ["stopped: the disk's free space fell under 50 GB"]]);
  assert.equal(runnerNote(b.notes[0]), "It was stopped: the disk's free space fell under 50 GB (the root helper's floor).");
  assert.equal(runnerNote(a.notes[0]), "The home's mode and owner were put back (700, not 777).");
  const c = helperAnswer({ id, code: 0, out: `plain\n\n${id} end 0\n` });
  assert.deepEqual([c.output, c.notes], ['plain\n', undefined]);
});

// The sorter's own fields (R64) in the ladder: what a command only reads, where an install lands, the GPU, where it
// reaches.
test('a place the command only reads is no write: a source at the top of the home runs at once, and isn\'t "written"', { timeout: 60000 * SLOW }, async () => {
  writeFileSync(at3('k.sh'), 'echo k\n');
  const r = await run('cp k.sh notes/k-copy.sh', 'spark3', '~');
  assert.equal(r.status, 200, r.text);
  assert.equal(text('notes/k-copy.sh'), 'echo k\n');
  const src = readFileSync(join(REPO, 'service', 'src', '21-ladder.mjs'), 'utf8'), fn = /^function workWrote\(ctx, sorted\) \{[\s\S]*?\n\}$/m.exec(src)?.[0];
  const workWrote = new Function('WORK_WRITTEN', `${fn}\nreturn workWrote;`)(1024), ctx = { written: [] };
  workWrote(ctx, { placed: ['~/k.sh', '~/notes/k-copy.sh'], reads: ['~/k.sh'], wide: [] });
  assert.deepEqual(ctx.written, ['~/notes/k-copy.sh']);
});

test('an install that lands where the plain wall keeps programs read-only is asked, the button naming where (the sorter\'s installs)', { timeout: 60000 * SLOW }, async () => {
  const api = await run('pip install requests', 'spark3', null);
  assert.equal(api.status, 409, api.text);
  assert.equal(api.json.error, 'It would fail inside the plain wall (it installs into ~/.local, which the plain wall keeps read-only), so it runs with the top of the home writable, and only after the owner’s yes. Nothing ran.');
  await turn(await newChat(), 'fix the npm tool on spark 3', [[RUN('npm i -g x')]]);
  const [asked] = sentBack('fix the npm tool on spark 3');
  assert.match(asked?.question || '', /\nRuns outside the plain wall: it installs into the system’s own folders \(npm -g\), which the plain wall keeps read-only\.\n/, JSON.stringify(asked));
});

test('a command that plainly uses the GPU is asked, never at once, and offered --gpu (the sorter\'s gpu)', { timeout: 60000 * SLOW }, async () => {
  const api = await run('python3 train.py --gpus 1', 'spark3', '~');
  assert.equal(api.status, 409, api.text);
  assert.equal(api.json.error, 'It uses the GPU, which a change gets only after the owner’s yes, so nothing ran.');
  await turn(await newChat(), 'fix the training on spark 3', [[RUN('python3 train.py --gpus 1')]]);
  const [asked] = sentBack('fix the training on spark 3');
  assert.match(asked?.question || '', /\nAsked because it uses the GPU\.\nWith your yes it may also use the GPU and the other devices \(closed to a change otherwise\)\.\n/, JSON.stringify(asked));
});

test('where a change reaches is said on its button (the sorter\'s reach): the home network gets no --fleet, the internet is named', { timeout: 120000 * SLOW }, async () => {
  const chat = await newChat(), cmd = 'curl -s http://192.168.1.10/x -o notes/home.json';
  const r = await turn(chat, 'fix the home fetch on spark 3', [[RUN(cmd)]]);
  const [asked] = sentBack('fix the home fetch on spark 3');
  assert.ok((asked?.question || '').includes('\nIt reaches your home network, which a change can’t reach, even after your yes: there it will fail.\n'), JSON.stringify(asked));
  const p = await choose(chat, r.choices.find(c => c.label === 'Run it').id);
  assert.equal(p.status, 200, p.text);
  assert.ok(propsOf(cmd).some(a => a.startsWith('IPAddressDeny=localhost 10.0.0.0/8')), JSON.stringify(propsOf(cmd)));
  await turn(await newChat(), 'fix the page fetch', [[RUN('curl -s https://example.com/x -o notes/page.html')]]);
  const [named] = sentBack('fix the page fetch');
  assert.ok((named?.question || '').includes('\nIt reaches the internet.\n'), JSON.stringify(named));
});

// The rail (R52): Sparkie's own call makes a change at once only while an eval is on record for its brain. A fleet of
// its own with none: the plain change the owner's words ask for is one button, nothing runs, and the press runs it.
test('with no eval on record, a plain change Sparkie proposes is a button like any other, and the owner\'s own press runs it', { timeout: 240000 * SLOW }, async () => {
  const fleet = await startMock({ evalOnRecord: false, env: { SPARK_CONSOLE_RUN_SECONDS: String(SECONDS), SPARK_CONSOLE_ROUTE_MS: '1000', SPARK_CONSOLE_WIDE_MS: '1' },
    prepare: ({ root }) => {
      rehearse(root, 'spark3', { run: true });
      mkdirSync(join(root, 'spark3', 'notes'), { recursive: true });
      writeFileSync(join(root, 'spark3', 'notes', 'r.txt'), 'r before\n');
    } });
  const was = { fleet: T.fleet, base: T.base, mcp: T.mcp, origin: T.origin };
  Object.assign(T, { fleet, base: fleet.base, mcp: fleet.mcp, origin: fleet.origin });
  try {
    // (as the setup waits: two looks at the tailnet after a request, which gave the console the Sparks' addresses)
    const chat = await newChat(), looks = () => readFileSync(join(fleet.dir, 'tailscale-calls'), 'utf8').split('\n').filter(l => l === 'status --json').length;
    await waitFor(() => existsSync(join(fleet.dir, 'tailscale-calls')), { what: 'a look at the tailnet' });
    const n = looks();
    await waitFor(() => looks() >= n + 2, { what: 'two looks at the tailnet after a request' });
    await sleep(300);
    const r = await turn(chat, 'fix the notes r on spark 3', [[RUN('echo railed > notes/r.txt')]]);
    assert.equal(r.tools[0]?.tail, 'Asked first, with a button: nothing ran yet.', JSON.stringify(r.tools));
    const [asked] = sentBack('fix the notes r on spark 3');
    assert.match(asked?.question || '', /^Run this on Spark 3\?\n\$ echo railed > notes\/r\.txt\nAsked because Sparkie asks before every change: [^\n]+\.\n/, JSON.stringify(asked));
    assert.equal(text('notes/r.txt'), 'r before\n', 'nothing ran');
    const p = await choose(chat, r.choices.find(c => c.label === 'Run it').id);
    assert.equal(p.status, 200, p.text);
    assert.equal(text('notes/r.txt'), 'railed\n', 'the owner\'s press ran it');
  } finally {
    Object.assign(T, was);
    await fleet.stop();
  }
});

test('a change with the top of the home writable still gets the model store, the Hugging Face cache and the shared folder read-only', { timeout: 120000 * SLOW }, async () => {
  const kept = ['models', '.cache/huggingface', '.local/share/spark-portal/workspaces/shared'];
  for (const d of kept) mkdirSync(at3(d), { recursive: true });
  const chat = await newChat(), cmd = 'echo p > top-protect.txt';
  const r = await turn(chat, 'write the protect note on spark 3', [[RUN(cmd)]]);
  const p = await choose(chat, r.choices.find(c => c.label === 'Run it').id);
  assert.equal(p.status, 200, p.text);
  assert.equal(text('top-protect.txt'), 'p\n');
  assert.equal(startOf(cmd)?.wall, 'home');
  const props = propsOf(cmd);
  for (const d of kept) assert.ok(props.includes(`ReadOnlyPaths=/spark3/${d}`), `${d}: ${JSON.stringify(props)}`);
});
