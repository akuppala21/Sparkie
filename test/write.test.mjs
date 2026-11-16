// Covers: write_file on a compute Spark (21-write.mjs, through run's ladder and runner; R68, R61; design A 2.9 and
// 2.14 row 7, step A7d), end to end on the stand-in fleet: a file the owner's words ask for is written at once, copied
// first, with its old mode, and undo puts it back; its bytes reach the unit on the helper's input, never a command
// line; asked, the button shows the path and the lines that change, old and new, and the press writes them; lines
// from to to are replaced in place; a file changed after the ask voids the press; the same ladder as run: the model
// store and the top of the home asked, the ways in and Spark 2 refused, a link in its folders never written through;
// a key in the text and a text over 128 KB refused; a script it wrote and a later command of the request runs is asked.
// Its read pass: the old text read only through the look wall (a key's hidden, and asked); a work step as run is; a
// name that starts with a dash placed as the file it is, and paths that name no file refused; "wrote" only when it was;
// the button marks a cut line and a hidden value, refuses a sign that doesn't show, and shows what is written; a link,
// a folder or a read-only file refused by name; the unit's own program (its check, one move, the permission bits,
// 0644, no file left behind); the pause, an agent's call, and the rail with no eval on record.
// The stand-in fleet, with the real root helper set up and proven for Spark 3 (test/rehearsal.mjs, run: true), the
// stand-ins in test/mock/bin, and the stand-in brain told by a script which tools to call. Linux only: run it on a
// Spark with tools/test-on-spark.sh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync, statSync, readdirSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { T, useFleet, api, call, createActKey, newChat, say, choose, waitFor, sleep, agentSettings, REPO, SLOW } from './lib.mjs';
import { rehearse } from './rehearsal.mjs';
import { startMock } from './start-mock.mjs';

// (the lock-out net is off for this fleet: a write to a way in is its off side; net.test has the on side)
useFleet({ env: { SPARK_CONSOLE_RUN_SECONDS: '6', SPARK_CONSOLE_ROUTE_MS: '1000', SPARK_CONSOLE_WIDE_MS: '1', SPARK_CONSOLE_NET: '0' },
  prepare: ({ root }) => {
    rehearse(root, 'spark3', { run: true });
    const h = join(root, 'spark3');
    const put = (p, data, mode = 0o644) => { mkdirSync(dirname(join(h, p)), { recursive: true }); writeFileSync(join(h, p), data); chmodSync(join(h, p), mode); };
    put('notes/e.txt', 'e before\n', 0o640);
    put('notes/five.txt', 'one\ntwo\nthree\nfour\nfive\n');
    put('notes/ask.txt', 'before\n');
    put('notes/late.txt', 'late before\n');
    put('notes/real/inner.txt', 'inner\n');
    put('notes/ro.txt', 'read only\n', 0o444);
    put('notes/nobreak.txt', 'a\nb');
    // (a Latin-1 byte, e9, on line 1: not UTF-8 text)
    put('notes/latin1.txt', Buffer.from('636166e90a6c696e6520320a', 'hex'));
    put('notes/long.txt', 'x\n');
    put('work/server.key', 'placeholder\n', 0o600);
    symlinkSync('real/inner.txt', join(h, 'notes', 'lnk.txt'));
    mkdirSync(join(h, 'models', 'm1'), { recursive: true });
    put('.ssh/authorized_keys', 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIStandIn owner@mac\n', 0o600);
    chmodSync(join(h, '.ssh'), 0o700);
  } }, async () => {
  keys.act = await createActKey('write-act');
  // (no change runs at once until the console has read the tailnet: two looks after a request, A7c)
  const looks = () => (existsSync(join(T.fleet.dir, 'tailscale-calls')) ? readFileSync(join(T.fleet.dir, 'tailscale-calls'), 'utf8').split('\n').filter(l => l === 'status --json').length : 0);
  await api('/health');
  const n = looks();
  await waitFor(() => looks() >= n + 2, { what: 'two looks at the tailnet after a request' });
  await sleep(300);
});

const keys = {};
const H3 = () => join(T.fleet.root, 'spark3'), at3 = p => join(H3(), p), text = p => readFileSync(at3(p), 'utf8');
const lines = file => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const journal = () => readdirSync(T.fleet.journalDir).filter(f => f.endsWith('.jsonl')).sort().flatMap(f => lines(join(T.fleet.journalDir, f)));
const startOf = path => journal().filter(x => x.k === 'cmd' && x.start && x.args?.tool === 'write_file' && x.args?.path === path).at(-1);
const calls = () => lines(join(H3(), '.rehearsal', 'calls.log'));
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const noScript = () => rmSync(join(T.fleet.dir, 'model-script.json'), { force: true });
const WRITE = (path, txt, more = {}) => ({ name: 'write_file', arguments: { on: 'spark3', path, text: txt, ...more } });
// One owner's message, the stand-in brain calling these rounds of tools; its steps, its buttons, what it was answered.
async function turn(chat, words, rounds) {
  script([{ match: `^${words}$`, rounds }]);
  try {
    const r = await say(chat, words);
    const sent = lines(join(T.fleet.dir, 'model-requests.jsonl')).filter(m => m.words === words && m.lastRole === 'tool').at(-1);
    const back = (sent?.results || []).map(x => (String(x.content).startsWith('[error] ') ? { error: String(x.content).slice(8) } : JSON.parse(x.content)));
    return { tools: r.tools, choices: r.message.choices || [], message: r.message, back };
  } finally { noScript(); }
}
const writeApi = body => api('/actions/write_file', { method: 'POST', body: { on: 'spark3', ...body } });

test('a file the owner\'s words ask for is written at once, copied first, with its old mode; its bytes never on a command line; undo puts it back', { timeout: 120000 * SLOW }, async () => {
  const chat = await newChat(), marker = 'MARKER-7f3a-written';
  const r = await turn(chat, 'fix the e notes on spark 3', [[WRITE('~/notes/e.txt', `e after ${marker}\n`)]]);
  const [res] = r.back;
  assert.equal(res?.ran, true, JSON.stringify(res));
  assert.deepEqual(res.wrote, { path: '~/notes/e.txt', bytes: Buffer.byteLength(`e after ${marker}\n`) });
  assert.deepEqual(r.choices, [], 'no button');
  assert.equal(text('notes/e.txt'), `e after ${marker}\n`);
  assert.equal(statSync(at3('notes/e.txt')).mode & 0o777, 0o640, 'its old mode');
  assert.equal(r.tools[0].line, '$ write_file ~/notes/e.txt');
  // (the bytes came on the helper's input: no unit's command line, nor the command the unit ran, holds them)
  const start = startOf('~/notes/e.txt');
  assert.ok(start?.unit && start.copied === 1, JSON.stringify(start));
  assert.ok(!JSON.stringify(calls()).includes(marker), 'not on a command line');
  assert.ok(!readFileSync(join(H3(), '.rehearsal', 'standin', 'ran', start.unit, 'command'), 'utf8').includes(marker), 'not in the command');
  assert.ok(!JSON.stringify(start).includes(marker), 'not on the journal\'s start line');
  const undo = await turn(chat, 'undo that', [[{ name: 'undo_last_change', arguments: {} }]]);
  assert.equal(undo.back[0]?.outcome, 'restored', JSON.stringify(undo.back));
  assert.equal(text('notes/e.txt'), 'e before\n');
});

test('asked, the button shows the path and the lines that change, old and new; the press writes them; a file changed after the ask voids the press', { timeout: 120000 * SLOW }, async () => {
  const chat = await newChat();
  // (words that don't name the Spark: a button)
  const r = await turn(chat, 'fix the ask note', [[WRITE('~/notes/ask.txt', 'after\n')]]);
  assert.equal(r.back[0]?.outcome, 'needs-ok', JSON.stringify(r.back));
  assert.match(r.back[0].question, /^Write this file on Spark 3\?\n~\/notes\/ask\.txt: from line 1, 1 line out, 1 in \(1 line now\)\n- before\n\+ after\nAsked because your words don’t name Spark 3\.\n/);
  assert.equal(text('notes/ask.txt'), 'before\n', 'nothing written yet');
  const p = await choose(chat, r.choices.find(c => c.label === 'Run it').id);
  assert.equal(p.status, 200, p.text);
  assert.equal(text('notes/ask.txt'), 'after\n');
  // The file changes between the ask and the press: the yes is void, and it is asked again.
  const c2 = await newChat();
  const r2 = await turn(c2, 'fix the late note', [[WRITE('~/notes/late.txt', 'late after\n')]]);
  writeFileSync(at3('notes/late.txt'), 'changed by hand\n');
  const p2 = await choose(c2, r2.choices.find(c => c.label === 'Run it').id);
  assert.equal(p2.status, 200, p2.text);
  assert.match(p2.json.message.content, /Asked because the file changed after you were asked, so that yes was void\./);
  assert.equal(text('notes/late.txt'), 'changed by hand\n');
});

test('lines from to to are replaced in place, as cat -n numbered them; out of range or without the file, nothing is written', { timeout: 120000 * SLOW }, async () => {
  const chat = await newChat();
  const r = await turn(chat, 'change the five notes', [[WRITE('~/notes/five.txt', 'TWO\nTHREE', { from: 2, to: 3 })]]);
  assert.match(r.back[0]?.question || '', /^Write this file on Spark 3\?\n~\/notes\/five\.txt: lines 2 to 3 replaced \(5 lines now\)\n- two\n- three\n\+ TWO\n\+ THREE\n/, JSON.stringify(r.back));
  const p = await choose(chat, r.choices.find(c => c.label === 'Run it').id);
  assert.equal(p.status, 200, p.text);
  assert.equal(text('notes/five.txt'), 'one\nTWO\nTHREE\nfour\nfive\n');
  const far = await writeApi({ path: '~/notes/five.txt', text: 'x', from: 5, to: 9 });
  assert.equal(far.status, 400, far.text);
  assert.equal(far.json.error, '~/notes/five.txt has 5 lines, so lines 5 to 9 aren’t all there. Nothing was written.');
  const none = await writeApi({ path: '~/notes/none.txt', text: 'x', from: 1, to: 1 });
  assert.equal(none.status, 400, none.text);
  const half = await writeApi({ path: '~/notes/five.txt', text: 'x', from: 1 });
  assert.equal(half.status, 400, half.text);
  assert.match(half.json.error, /^from and to go together/);
  assert.equal(text('notes/five.txt'), 'one\nTWO\nTHREE\nfour\nfive\n');
});

test('the same ladder as run: the model store and the top of the home asked, the ways in and Spark 2 refused, a link in its folders never written through', { timeout: 120000 * SLOW }, async () => {
  const store = await writeApi({ path: '~/models/m1/config.json', text: '{}\n' });
  assert.equal(store.status, 409, store.text);
  assert.equal(store.json.error, 'It changes ~/models, which a change gets only after the owner’s yes, so nothing ran.');
  const top = await writeApi({ path: '~/top.txt', text: 'top\n' });
  assert.equal(top.status, 409, top.text);
  assert.match(top.json.error, /^It would fail inside the plain wall \(it writes ~\/top\.txt at the top of the home/);
  const keysFile = await writeApi({ path: '~/.ssh/authorized_keys', text: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOther other@else\n' });
  assert.equal(keysFile.status, 403, keysFile.text);
  assert.match(keysFile.json.error, /^Nothing ran: a change that can lock you out of Spark 3 waits for the lock-out net/);
  const hub = await api('/actions/write_file', { method: 'POST', body: { on: 'spark2', path: '~/x.txt', text: 'x\n' } });
  assert.equal(hub.status, 403, hub.text);
  symlinkSync('real', at3('notes/via'));
  const linked = await writeApi({ path: '~/notes/via/inner.txt', text: 'through\n' });
  assert.equal(linked.status, 200, linked.text);
  assert.deepEqual([linked.json.ran, linked.json.notKept], [false, [{ path: '~/notes/via/inner.txt', why: 'a link in the folders above it' }]], linked.text);
  assert.equal(text('notes/real/inner.txt'), 'inner\n', 'never written through');
  for (const [r, f] of [[store, 'models/m1/config.json'], [top, 'top.txt']]) assert.ok(!existsSync(at3(f)), f);
});

test('a key in the text and a text over 128 KB are refused; nothing is written', { timeout: 60000 * SLOW }, async () => {
  const key = await writeApi({ path: '~/notes/k.txt', text: 'HF_TOKEN=hf_abcdefghijklmnopqrstuvwxyzABCDEF0123\n' });
  assert.equal(key.status, 400, key.text);
  assert.equal(key.json.error, 'The text holds a token of a kind Sparkie knows (it begins "hf_a"), so it isn’t written or shown on a button: give the key by its name. Nothing was written.');
  const big = await writeApi({ path: '~/notes/big.txt', text: 'é'.repeat(70000) });
  assert.equal(big.status, 400, big.text);
  assert.equal(big.json.error, 'The text is over 128 KB, the most write_file writes. Nothing was written.');
  assert.ok(!existsSync(at3('notes/k.txt')) && !existsSync(at3('notes/big.txt')));
});

test('a script write_file wrote, and a later command of the same request runs, is asked (written)', { timeout: 120000 * SLOW }, async () => {
  const chat = await newChat(), words = 'fix the go script on spark 3';
  const r = await turn(chat, words, [[WRITE('~/notes/go.sh', 'echo went > notes/went.txt\n')], [{ name: 'run', arguments: { on: 'spark3', command: 'bash notes/go.sh', dir: '~' } }]]);
  assert.equal(text('notes/go.sh'), 'echo went > notes/went.txt\n', 'written at once');
  const [ran] = r.back;
  assert.equal(ran?.outcome, 'needs-ok', JSON.stringify(r.back));
  assert.match(ran.question, /Asked because it is risky: “bash” runs the file “notes\/go\.sh”\. It runs a file this same command wrote/);
  assert.ok(!existsSync(at3('notes/went.txt')), 'not run');
});

test('the old text is read only through the look wall: a key\'s is hidden, the button says so, and it is asked', { timeout: 120000 * SLOW }, async () => {
  const looks = () => calls().filter(c => c[0] === 'systemd-run' && c.some(a => /^--unit=sw-look-/.test(a))).length, before = looks();
  const plain = await turn(await newChat(), 'fix the e notes again on spark 3', [[WRITE('~/notes/e.txt', 'e again\n')]]);
  assert.equal(plain.back[0]?.ran, true, JSON.stringify(plain.back));
  assert.equal(looks(), before + 1, 'its old text was read through the look wall');
  const chat = await newChat();
  const r = await turn(chat, 'fix the server key file on spark 3', [[WRITE('server.key', 'still a placeholder\n')]]);
  assert.equal(r.back[0]?.outcome, 'needs-ok', JSON.stringify(r.back));
  // (every key name the look's own check hides, the sorter asks for too, and its reason comes first)
  assert.match(r.back[0].question, /^Write this file on Spark 3\?\n~\/work\/server\.key: its old text is hidden \(a key, or a file a look may not read\), so only the new text is shown\n\+ still a placeholder\nAsked because /);
  assert.ok(!r.back[0].question.includes('- placeholder'));
  assert.equal(text('work/server.key'), 'placeholder\n');
});

test('a write is a work step, as run is: one message writes at most as many as its steps allow', { timeout: 180000 * SLOW }, async () => {
  // (words that don't name the Spark: each write is asked, so a round's four don't meet the Spark's claim)
  const w = n => WRITE(`~/notes/step${n}.txt`, `${n}\n`), words = 'fix the step notes';
  const r = await turn(await newChat(), words, [[w(1), w(2), w(3), w(4)], [w(5), w(6), w(7), w(8)], [w(9), w(10), w(11), w(12)], [w(13)]]);
  // (twelve steps spent: the turn answers, and the thirteenth is never called)
  assert.match(r.message.content, /\n\nStopped here: one message may run 12 commands, and 12 ran\./, r.message.content.slice(-300));
  assert.ok(!JSON.stringify(r.back).includes('step13'), 'the thirteenth not called');
});

test('a name that starts with a dash is the file it names, and a later run of it is asked; a path that names no file is refused', { timeout: 120000 * SLOW }, async () => {
  const words = 'fix the dash script on spark 3';
  const r = await turn(await newChat(), words, [[WRITE('-x.sh', 'echo dashed > dashed.txt\n')], [{ name: 'run', arguments: { on: 'spark3', command: 'bash ./-x.sh' } }]]);
  assert.equal(text('work/-x.sh'), 'echo dashed > dashed.txt\n');
  assert.equal(startOf('~/work/-x.sh')?.args?.path, '~/work/-x.sh');
  assert.equal(r.back[0]?.outcome, 'needs-ok', JSON.stringify(r.back));
  assert.match(r.back[0].question, /It runs a file this same command wrote/);
  assert.ok(!existsSync(at3('work/dashed.txt')));
  for (const [path, re] of [['~//tmp/y', /^~\/\/ isn’t a path/], ['./', /^Give the file’s name/], ['', /^path isn’t in the right form|^Give the file’s name/], ['~/notes/', /names a folder, not a file/]]) {
    const no = await writeApi({ path, text: 'x\n' });
    assert.equal(no.status, 400, `${path}: ${no.text}`);
    assert.match(no.json.error, re, path);
  }
});

test('the result says what was written only when it was; otherwise what happened', { timeout: 60000 * SLOW }, async () => {
  const r = await writeApi({ path: '~/notes/nofolder/x.txt', text: 'x\n' });
  assert.equal(r.status, 200, r.text);
  assert.ok(!('wrote' in r.json), r.text);
  assert.match(r.json.notWritten || '', /^Nothing was written: /, r.text);
});

test('the button: a cut line and a hidden value are marked, a sign that doesn\'t show is refused, and the lines it shows are what is written', { timeout: 120000 * SLOW }, async () => {
  const long = 'y'.repeat(300), many = Array.from({ length: 35 }, (_, i) => `line ${i + 1}`).join('\n');
  const chat = await newChat(), r = await turn(chat, 'change the long note', [[WRITE('~/notes/long.txt', `${long}\napi_key = "abc12345def6789"\n${many}\n`)]]);
  const q = r.back[0]?.question || '';
  assert.ok(q.includes(`\n+ ${'y'.repeat(200)}… (100 more signs on this line not shown)\n`), q);
  assert.ok(q.includes('\n+ api_key = "[hidden]" (a value on this line is hidden here; it is written as given)\n'), q);
  assert.ok(q.includes('\n+ … and 7 more lines\n'), q);
  const p = await choose(chat, r.choices.find(c => c.label === 'Run it').id);
  assert.equal(p.status, 200, p.text);
  assert.ok(text('notes/long.txt').includes('\napi_key = "abc12345def6789"\n'), 'written as given');
  const hidden = await writeApi({ path: '~/notes/rtl.txt', text: `safe ${String.fromCharCode(0x202e)}txt.exe\n` });
  assert.equal(hidden.status, 400, hidden.text);
  assert.match(hidden.json.error, /a sign that doesn’t show/);
  // A line put after a last line with no line break starts a line of its own, as the button shows it.
  const c = await newChat(), add = await turn(c, 'change the nobreak note', [[WRITE('~/notes/nobreak.txt', 'c', { from: 3, to: 2 })]]);
  assert.match(add.back[0]?.question || '', /^Write this file on Spark 3\?\n~\/notes\/nobreak\.txt: new lines before line 3 \(2 lines now\)\n\+ c\n/, JSON.stringify(add.back));
  const pressed = await choose(c, add.choices.find(x => x.label === 'Run it').id);
  assert.equal(pressed.status, 200, pressed.text);
  assert.equal(text('notes/nobreak.txt'), 'a\nb\nc\n');
});

test('a link, a folder or a read-only file at the path is refused by name, before any ask', { timeout: 60000 * SLOW }, async () => {
  for (const [path, re] of [['~/notes/lnk.txt', /is a link: write_file never writes through one/], ['~/notes/real', /isn’t a plain file/], ['~/notes/ro.txt', /is read-only/]]) {
    const r = await writeApi({ path, text: 'x\n' });
    assert.equal(r.status, 400, `${path}: ${r.text}`);
    assert.match(r.json.error, re, path);
  }
  assert.equal(text('notes/real/inner.txt'), 'inner\n');
  assert.equal(text('notes/ro.txt'), 'read only\n');
});

test('the unit\'s own program: it checks the file, writes beside it and makes one move, keeps only the permission bits, makes a new file 0644, and leaves nothing behind', { timeout: 60000 * SLOW }, () => {
  const src = readFileSync(join(REPO, 'service', 'src', '21-write.mjs'), 'utf8');
  const fn = /^function writeProgram\(rel, old\) \{[\s\S]*?\n\}$/m.exec(src)?.[0];
  assert.ok(fn);
  const q = s => `'${String(s).replace(/'/g, "'\\''")}'`, writeProgram = new Function('q', `${fn}\nreturn writeProgram;`)(q);
  const dir = mkdtempSync(join(tmpdir(), 'sct-write-')), sha = s => createHash('sha256').update(s).digest('hex');
  const go = (rel, old, input, umask = '022') => spawnSync('bash', ['-c', `umask ${umask}; ${writeProgram(rel, old)}`], { cwd: dir, input, encoding: 'utf8' });
  const left = () => readdirSync(dir).filter(f => f.startsWith('.write_file.'));
  try {
    writeFileSync(join(dir, 'a.sh'), 'old\n');
    chmodSync(join(dir, 'a.sh'), 0o4755);
    let r = go('./a.sh', { kind: 'file', sha: sha('old\n') }, 'new\n');
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual([readFileSync(join(dir, 'a.sh'), 'utf8'), statSync(join(dir, 'a.sh')).mode & 0o7777, left()], ['new\n', 0o755, []]);
    r = go('./a.sh', { kind: 'file', sha: sha('something else\n') }, 'newer\n');
    assert.equal(r.status, 3);
    assert.match(r.stderr, /the file changed since it was read here/);
    assert.deepEqual([readFileSync(join(dir, 'a.sh'), 'utf8'), left()], ['new\n', []]);
    r = go('./b.txt', { kind: 'none' }, 'b\n', '077');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(statSync(join(dir, 'b.txt')).mode & 0o777, 0o644);
    writeFileSync(join(dir, 'ro.txt'), 'ro\n');
    chmodSync(join(dir, 'ro.txt'), 0o444);
    r = go('./ro.txt', { kind: 'file', sha: sha('ro\n') }, 'x\n');
    assert.equal(r.status, 3);
    assert.match(r.stderr, /read-only/);
    // Ended between the write and the move (its input still open): the temporary file goes.
    // (a unit's end stops every program in it: the whole group here)
    const p = spawn('bash', ['-c', writeProgram('./c.txt', { kind: 'none' })], { cwd: dir, stdio: ['pipe', 'ignore', 'ignore'], detached: true });
    p.stdin.write('part');
    return new Promise(resolve => setTimeout(() => {
      assert.equal(left().length, 1, 'the temporary file while it writes');
      p.on('exit', () => { assert.deepEqual(left(), []); assert.ok(!existsSync(join(dir, 'c.txt'))); resolve(); });
      process.kill(-p.pid, 'SIGTERM');
    }, 500));
  } finally { setTimeout(() => rmSync(dir, { recursive: true, force: true }), 2000); }
});

test('write_file\'s own entry: refused while changes are paused; an agent\'s call is a button for the owner', { timeout: 60000 * SLOW }, async () => {
  await agentSettings({ halted: true });
  try {
    const r = await writeApi({ path: '~/notes/paused.txt', text: 'x\n' });
    assert.equal(r.status, 403, r.text);
    assert.match(r.json.error, /changes are paused/);
  } finally { await agentSettings({ halted: false }); }
  const a = await call(keys.act.token, 'write_file', { on: 'spark3', path: '~/notes/agent.txt', text: 'x\n' });
  assert.equal(a.isError, false, a.text);
  assert.equal(a.value.outcome, 'question', a.text);
  assert.ok(!existsSync(at3('notes/paused.txt')) && !existsSync(at3('notes/agent.txt')));
});

// The second read, fix 1: lines from to to are put together as text, so a file that isn't UTF-8 would change elsewhere.
test('lines from to to are refused for a file that isn’t UTF-8 text, and the file is as it was', { timeout: 60000 * SLOW }, async () => {
  const before = readFileSync(at3('notes/latin1.txt'));
  const r = await writeApi({ path: '~/notes/latin1.txt', text: 'two\n', from: 2, to: 2 });
  assert.equal(r.status, 400, r.text);
  assert.match(r.json.error, /^~\/notes\/latin1\.txt isn’t UTF-8 text, so lines 2 to 2 can’t be put in it without changing other bytes: write the whole file\./);
  assert.ok(readFileSync(at3('notes/latin1.txt')).equals(before), 'unchanged');
});

// The second read, fix 2: a hidden part that holds a sign that runs something is shown whole on the button (the paired
// chat's ask), marked; the records keep it masked.
test('a hidden part holding a sign that runs something is shown whole on the button, marked; the records keep it masked', { timeout: 240000 * SLOW }, async () => {
  const TG = 5550001, fleet = await startMock({ evalOnRecord: false, telegram: true, env: { SPARK_CONSOLE_RUN_SECONDS: '6', SPARK_CONSOLE_ROUTE_MS: '1000', SPARK_CONSOLE_WIDE_MS: '1' },
    prepare: ({ root, dir }) => {
      rehearse(root, 'spark3', { run: true }); mkdirSync(join(root, 'spark3', 'notes'), { recursive: true });
      mkdirSync(join(dir, 'secrets'), { recursive: true, mode: 0o700 });
      writeFileSync(join(dir, 'secrets', 'secrets.json'), JSON.stringify({ telegram: { token: '123456789:AAEtestTokenForSparkConsoleXYZ_abcdefghij', bot: 'spark_test_bot', chatId: TG, userId: TG, name: 'Owner', pairedAt: '2026-11-10T00:00:00.000Z', approve: true } }), { mode: 0o600 });
    } });
  const was = { fleet: T.fleet, base: T.base, mcp: T.mcp, origin: T.origin };
  Object.assign(T, { fleet, base: fleet.base, mcp: fleet.mcp, origin: fleet.origin });
  try {
    const chat = await newChat(), mark = '(shown whole: what would be hidden here holds signs that run something)';
    const r = await turn(chat, 'write the runs note on spark 3', [[WRITE('~/notes/runs.txt', 'token=$(reboot)\npassword=hunter2xyz\n')]]);
    // (the brain's copy is masked again, with the mark; the plain hidden value has none)
    const q = r.back[0]?.question || '';
    assert.ok(q.includes(`\n+ token=[hidden] ${mark}\n`), q);
    assert.ok(q.includes('\n+ password=[hidden] (a value on this line is hidden here; it is written as given)\n'), q);
    // (the paired chat's ask shows it whole, and only it)
    const sent = await waitFor(() => lines(join(fleet.dir, 'telegram-calls.jsonl')).find(c => c.method === 'sendMessage' && c.body?.reply_markup), { what: 'the ask in the paired chat' });
    assert.ok(sent.body.text.includes(`+ token=$(reboot) ${mark}`), sent.body.text);
    assert.ok(sent.body.text.includes('+ password=[hidden]'), sent.body.text);
    // (the page gets the ask's own lines with its button: whole on the reply and on a later read, masked in the file)
    const page = r.message.asks?.[0]?.text || '';
    assert.match(page, /^Write this file on Spark 3\?\n~\/notes\/runs\.txt: /, page);
    assert.ok(page.includes(`+ token=$(reboot) ${mark}`) && page.includes('+ password=[hidden]'), page);
    assert.equal((await api(`/chats/${chat}`)).json.messages.at(-1).asks?.[0]?.text, page);
    assert.ok(JSON.parse(readFileSync(join(fleet.stateDir, 'chats.json'), 'utf8')).conversations.find(c => c.id === chat).messages.at(-1).asks[0].text.includes(`+ token=[hidden] ${mark}`));
    // (a run's ask the same: its exact command and why it is asked)
    const run = await turn(await newChat(), 'touch the run note on spark 3', [[{ name: 'run', arguments: { on: 'spark3', command: 'touch notes/run-note.txt' } }]]);
    assert.match(run.message.asks?.[0]?.text || '', /^Run this on Spark 3\?\n\$ touch notes\/run-note\.txt\n(?:[^\n]*\n)*Asked because /, JSON.stringify(run.message));
    // (the chat file and the journal keep it masked)
    assert.ok(!readFileSync(join(fleet.stateDir, 'chats.json'), 'utf8').includes('token=$(reboot)'), 'masked in chats.json');
    for (const f of readdirSync(fleet.journalDir)) assert.ok(!readFileSync(join(fleet.journalDir, f), 'utf8').includes('token=$(reboot)'), `masked in ${f}`);
  } finally { Object.assign(T, was); await fleet.stop(); }
});

// The rail (R52): with no eval on record, a plain write Sparkie proposes is a button, and the owner's press writes it.
test('with no eval on record, a plain write Sparkie proposes is a button, and the owner\'s press writes it', { timeout: 240000 * SLOW }, async () => {
  const fleet = await startMock({ evalOnRecord: false, env: { SPARK_CONSOLE_RUN_SECONDS: '6', SPARK_CONSOLE_ROUTE_MS: '1000', SPARK_CONSOLE_WIDE_MS: '1' },
    prepare: ({ root }) => { rehearse(root, 'spark3', { run: true }); mkdirSync(join(root, 'spark3', 'notes'), { recursive: true }); } });
  const was = { fleet: T.fleet, base: T.base, mcp: T.mcp, origin: T.origin };
  Object.assign(T, { fleet, base: fleet.base, mcp: fleet.mcp, origin: fleet.origin });
  try {
    const chat = await newChat(), looks = () => readFileSync(join(fleet.dir, 'tailscale-calls'), 'utf8').split('\n').filter(l => l === 'status --json').length;
    await waitFor(() => existsSync(join(fleet.dir, 'tailscale-calls')), { what: 'a look at the tailnet' });
    const n = looks();
    await waitFor(() => looks() >= n + 2, { what: 'two looks at the tailnet after a request' });
    await sleep(300);
    const r = await turn(chat, 'fix the rail note on spark 3', [[WRITE('~/notes/rail.txt', 'railed\n')]]);
    assert.match(r.back[0]?.question || '', /\nAsked because Sparkie asks before every change: [^\n]+\.\n/, JSON.stringify(r.back));
    assert.ok(!existsSync(join(fleet.root, 'spark3', 'notes', 'rail.txt')));
    const p = await choose(chat, r.choices.find(c => c.label === 'Run it').id);
    assert.equal(p.status, 200, p.text);
    assert.equal(readFileSync(join(fleet.root, 'spark3', 'notes', 'rail.txt'), 'utf8'), 'railed\n');
  } finally { Object.assign(T, was); await fleet.stop(); }
});
