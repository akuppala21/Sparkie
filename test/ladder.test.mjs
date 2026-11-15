// Covers: run's ladder for a change on a compute Spark (21-ladder.mjs, with 21-runner.mjs; R61, R55, R54; design A
// 2.5 and 2.8, step A7c), end to end on the stand-in fleet: a plain change the owner's words ask for runs at once with
// no button and undo puts it back; a risky one is a button, built by code, and the owner's press runs it; a file this
// request wrote and then runs is asked (the sorter's written); a script that changed after its ask voids the press; a
// risky delete is the dangerous ask, which names what came from what the request read; an agent's change is a
// button; not done, the lock-out class and Spark 2 are refused; what put-back does not cover is said; the run unit
// gets git with no hooks; the claim is held past a change whose end is unknown; /undo works while changes are paused;
// the memory cap's working-out; what the page's line for a command shows.
// The stand-in fleet, with the real root helper set up and proven for Spark 3 (test/rehearsal.mjs, run: true), the
// stand-ins in test/mock/bin, and the stand-in brain told by a script which tools to call. Linux only: run it on a
// Spark with tools/test-on-spark.sh.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync, statSync, readdirSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { T, useFleet, api, call, createActKey, newChat, say, choose, chatMessages, waitFor, sleep, agentSettings, REPO, SLOW } from './lib.mjs';
import { rehearse } from './rehearsal.mjs';

const SECONDS = 6;
const KEYS_LINE = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIStandIn owner@mac\n';
const keys = {};
// (the tailnet is read every second here, so a test that changes what it says is seen soon)
useFleet({ env: { SPARK_CONSOLE_RUN_SECONDS: String(SECONDS), SPARK_CONSOLE_ROUTE_MS: '1000' },
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
  // (the console's first look at the tailnet, 1.5 s after it starts: until then no change runs at once, A7c)
  await waitFor(() => existsSync(join(T.fleet.dir, 'tailscale-calls')) && readFileSync(join(T.fleet.dir, 'tailscale-calls'), 'utf8').includes('status --json'), { what: 'the first look at the tailnet' });
  await sleep(500);
});

const H3 = () => join(T.fleet.root, 'spark3'), at3 = p => join(H3(), p), text = p => readFileSync(at3(p), 'utf8');
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
  const [, second] = sentBack('fix the script on spark 3');
  assert.equal(second?.outcome, 'needs-ok', JSON.stringify(second));
  assert.match(second.question, /Asked because it is risky: “bash” runs the file “notes\/w\.sh”\. It runs a file this same command wrote/);
  assert.match(second.question, /\nIt runs notes\/w\.sh \(SHA-256 [0-9a-f]{12}…\); what that script reads later isn’t checked\./);
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

test('a change runs git with no hooks and no file-system monitor, from the unit\'s own first line', { timeout: 60000 * SLOW }, async () => {
  // (that a command setting or unsetting these is asked is the sorter's row: step A7a-git)
  const r = await run('printenv GIT_CONFIG_COUNT GIT_CONFIG_KEY_0 GIT_CONFIG_VALUE_0 GIT_CONFIG_KEY_1 GIT_CONFIG_VALUE_1 > notes/git.txt');
  assert.equal(r.status, 200, r.text);
  assert.equal(text('notes/git.txt'), '2\ncore.hooksPath\n/dev/null\ncore.fsmonitor\nfalse\n');
});

test('a change whose end is unknown holds its Spark until its time limit has passed: no second change starts beside it', { timeout: 120000 * SLOW }, async () => {
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
  const r = await run('echo w > here.txt', 'spark3', null);
  assert.equal(r.status, 200, r.text);
  assert.equal(text('work/here.txt'), 'w\n');
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

test('a change the sorter places in the model store is asked, and runs after the yes; until the helper takes ~/ for --protect none is passed', { timeout: 120000 * SLOW }, async () => {
  mkdirSync(at3('models/m1'), { recursive: true });
  const chat = await newChat();
  const r = await turn(chat, 'fix the model settings on spark 3', [[RUN('touch models/m1/spark.json')]]);
  const [asked] = sentBack('fix the model settings on spark 3');
  assert.match(asked?.question || '', /\nAsked because it changes ~\/models, which a change gets only after your yes\.\n/, JSON.stringify(asked));
  assert.ok(!existsSync(at3('models/m1/spark.json')));
  const p = await choose(chat, r.choices.find(c => c.label === 'Run it').id);
  assert.equal(p.status, 200, p.text);
  assert.ok(existsSync(at3('models/m1/spark.json')), p.text);
  // (the owner's own call is refused, in the runner's words: no button to show there)
  const d = await run('touch models/m1/other.json');
  assert.equal(d.status, 409, d.text);
  assert.match(d.json.error, /^It changes ~\/models, which a change gets only after the owner’s yes, so nothing ran\.$/);
  // (HELPER_TAKES.homeProtect: off until the helper that takes --protect '~/…' is pinned; then the unit gets them)
  assert.match(readFileSync(join(REPO, 'service', 'src', '21-runner.mjs'), 'utf8'), /^const HELPER_TAKES = \{ homeProtect: false, memory: false \};$/m);
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
