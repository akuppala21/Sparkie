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
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync, statSync, readdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { T, useFleet, api, call, createActKey, newChat, say, choose, waitFor, sleep, agentSettings, REPO, SLOW } from './lib.mjs';
import { rehearse } from './rehearsal.mjs';
import { startMock } from './start-mock.mjs';

const UNREAD = 'kept from a look\n';
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
    // (its owner may write it and nobody may read it: the stand-in's look runs as this account, so it can't read it)
    put('notes/unread.txt', UNREAD, 0o200);
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
// A text as base64, at each of the three alignments it can take inside a longer run of bytes (its ends cut where they
// hang on the bytes beside it).
function base64Forms(v) {
  const bytes = Buffer.from(v), out = new Set([bytes.toString('base64')]);
  for (let k = 0; k < 3; k++) {
    const b = Buffer.concat([Buffer.alloc(k), bytes]).toString('base64');
    out.add(b.slice(k ? 4 : 0, (k + bytes.length) % 3 ? b.length - 4 : b.length));
  }
  return [...out].filter(f => f.length >= 8);
}

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
  // (nor as base64, the form the bytes take on the helper's input, at any of its three alignments)
  for (const b of base64Forms(`e after ${marker}\n`)) {
    assert.ok(!JSON.stringify(calls()).includes(b) && !JSON.stringify(start).includes(b), `base64 ${b.slice(0, 12)}…`);
    assert.ok(!readFileSync(join(H3(), '.rehearsal', 'standin', 'ran', start.unit, 'command'), 'utf8').includes(b), `base64 ${b.slice(0, 12)}… in the command`);
  }
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
  assert.equal(none.json.error, 'Lines 1 to 1 need ~/notes/none.txt there as a plain text file of at most 256 KB a look may read, and it isn’t. Nothing was written.');
  assert.ok(!existsSync(at3('notes/none.txt')), 'nothing made');
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
  assert.match(keysFile.json.error, /^Nothing ran: the lock-out net is switched off in this console, and a change that can lock you out of Spark 3 runs only inside it\./);
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
  assert.match(r.back[0].question, /^Write this file on Spark 3\?\n~\/work\/server\.key: its old text is hidden \(a key, or a file a look may not read\), so only the new text is shown\n\+ still a placeholder\nAsked because it is risky: It names “\.\/server\.key”, key material the run wall hides, so it would run outside the wall\.\n/, r.back[0].question);
  assert.ok(!r.back[0].question.includes('- placeholder'));
  assert.equal(text('work/server.key'), 'placeholder\n');
});

test('a write is a work step, as run is: one message writes at most as many as its steps allow', { timeout: 180000 * SLOW }, async () => {
  // (words that don't name the Spark: each write is asked, so a round's four don't meet the Spark's claim)
  const w = n => WRITE(`~/notes/step${n}.txt`, `${n}\n`), words = 'fix the step notes';
  const r = await turn(await newChat(), words, [[w(1), w(2), w(3), w(4)], [w(5), w(6), w(7), w(8)], [w(9), w(10), w(11), w(12)], [w(13)]]);
  // (twelve steps spent: the turn answers, and the thirteenth is never called)
  assert.match(r.message.content, /\n\nStopped here: one message may run 12 commands, and 12 were tried and none ran; 12 wait for your yes\./, r.message.content.slice(-300));
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
  // (in the path too: the schema stops control signs only, not a zero-width or direction mark)
  const hiddenPath = await writeApi({ path: `~/notes/zw${String.fromCharCode(0x200b)}.txt`, text: 'x\n' });
  assert.equal(hiddenPath.status, 400, hiddenPath.text);
  assert.match(hiddenPath.json.error, /a sign that doesn’t show/);
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

// A-19 (the outside reviewer's, round two): a second writer between the program's look and its publish. The program,
// lifted as above, waits in old.hold (a folder the test gives it: it makes `at` there and waits for `go`, at most 30 s)
// after the text is staged and before it is published; the test writes the file there meanwhile. The other writer's
// file must stay as it is, the program end 3 and leave nothing behind. Real GNU tools and python3 (Linux).
const A19 = mkdtempSync(join(tmpdir(), 'sct-a19-'));
process.on('exit', () => rmSync(A19, { recursive: true, force: true }));
const BEFORE = 'the file as it was read\n', NEWER = 'another program’s newer edit\n', WANTED = 'Sparkie’s text\n';
const sha = s => createHash('sha256').update(s).digest('hex');
const liftWrite = () => {
  const fn = /^function writeProgram\(rel, old\) \{[\s\S]*?\n\}$/m.exec(readFileSync(join(REPO, 'service', 'src', '21-write.mjs'), 'utf8'))?.[0];
  assert.ok(fn, 'writeProgram');
  return new Function('q', `${fn}\nreturn writeProgram;`)(s => `'${String(s).replace(/'/g, "'\\''")}'`);
};
const a19Dir = name => { const d = join(A19, name); mkdirSync(d, { recursive: true }); return d; };
const a19Left = d => readdirSync(d).filter(f => f.startsWith('.write_file.') || f.startsWith('.spark-console-put-back-'));
// A hidden file's signature as code takes it: the format in writeOld's look at the name.
const SIG_FORMAT = /echo "file \$\(stat -c '([^']+)' -- "\$p"\)"/.exec(readFileSync(join(REPO, 'service', 'src', '21-write.mjs'), 'utf8'))?.[1];
const sigOf = (f, env = {}) => spawnSync('stat', ['-c', SIG_FORMAT, '--', f], { encoding: 'utf8', timeout: 10000, env: { ...process.env, ...env } }).stdout.trim();
const shq = s => `'${String(s).replace(/'/g, "'\\''")}'`;
// A program first on the PATH of a test's own: `first` (shell), then the real one.
function shimmed(dir, name, first) {
  const bin = join(dir, 'bin'), real = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8', timeout: 10000 }).stdout.trim();
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, name), `#!/bin/sh\n${first}\nexec ${real} "$@"\n`, { mode: 0o755 });
  return { PATH: `${bin}:${process.env.PATH}` };
}
// Runs `argv` in `dir` with `input` on its input; when it waits in `hold`, `during()` runs, then it may go on.
async function held(argv, dir, hold, input, during, env = {}) {
  mkdirSync(hold, { recursive: true });
  const p = spawn(argv[0], argv.slice(1), { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  let out = '', err = '';
  p.stdout.on('data', d => { out += d; });
  p.stderr.on('data', d => { err += d; });
  const closed = new Promise(r => p.on('close', code => r(code)));
  p.stdin.end(input);
  try {
    await waitFor(() => existsSync(join(hold, 'at')), { timeout: 20000, every: 20, what: 'the program to wait between its look and its publish' });
    await during(p.pid);
    writeFileSync(join(hold, 'go'), '');
    const code = await Promise.race([closed, sleep(30000 * SLOW).then(() => 'never ended')]);
    return { code, out, err: err.trim() };
  } finally { p.kill('SIGKILL'); }
}

test('A-19: a replace never loses an edit another program makes between the look and the publish: what it displaced is checked and put back, and nothing is left', { timeout: 60000 * SLOW }, async () => {
  const d = a19Dir('replace'), f = join(d, 'notes.txt'), writeProgram = liftWrite();
  writeFileSync(f, BEFORE);
  const hold = join(d, 'hold1');
  const r = await held(['bash', '-c', writeProgram('./notes.txt', { kind: 'file', sha: sha(BEFORE), hold })], d, hold, WANTED, () => writeFileSync(f, NEWER));
  assert.equal(r.code, 3, r.err);
  assert.match(r.err, /^write_file: the file changed since it was read here, so nothing was written\.$/);
  assert.equal(readFileSync(f, 'utf8'), NEWER, 'the other program’s edit is there');
  assert.deepEqual(a19Left(d), []);
  // (nobody else writing: written, with the old permission bits only)
  writeFileSync(f, BEFORE);
  chmodSync(f, 0o640);
  const hold2 = join(d, 'hold2');
  const ok = await held(['bash', '-c', writeProgram('./notes.txt', { kind: 'file', sha: sha(BEFORE), hold: hold2 })], d, hold2, WANTED, () => {});
  assert.equal(ok.code, 0, ok.err);
  assert.deepEqual([readFileSync(f, 'utf8'), statSync(f).mode & 0o777, a19Left(d)], [WANTED, 0o640, []]);
});

test('A-19: a new file another program makes between the look and the publish stays theirs (a link, never a move over it)', { timeout: 60000 * SLOW }, async () => {
  const d = a19Dir('new'), g = join(d, 'new.txt'), hold = join(d, 'hold');
  const r = await held(['bash', '-c', liftWrite()('./new.txt', { kind: 'none', hold })], d, hold, WANTED, () => writeFileSync(g, NEWER));
  assert.equal(r.code, 3, r.err);
  assert.match(r.err, /the file changed since it was read here/);
  assert.equal(readFileSync(g, 'utf8'), NEWER, 'their file is kept');
  assert.deepEqual(a19Left(d), []);
});

test('A-19: where there is no exchange, the program compares once more just before its one move', { timeout: 60000 * SLOW }, async () => {
  const d = a19Dir('no-exchange'), f = join(d, 'notes.txt'), bin = join(d, 'bin');
  // (a python3 that says this libc or filesystem has no exchange, as the program's own exchange answers then)
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'python3'), '#!/bin/sh\nexit 4\n', { mode: 0o755 });
  const env = { PATH: `${bin}:${process.env.PATH}` }, writeProgram = liftWrite();
  writeFileSync(f, BEFORE);
  const hold = join(d, 'hold1');
  const r = await held(['bash', '-c', writeProgram('./notes.txt', { kind: 'file', sha: sha(BEFORE), hold })], d, hold, WANTED, () => writeFileSync(f, NEWER), env);
  assert.equal(r.code, 3, r.err);
  assert.equal(readFileSync(f, 'utf8'), NEWER, 'the other program’s edit is there');
  assert.deepEqual(a19Left(d), []);
  writeFileSync(f, BEFORE);
  const hold2 = join(d, 'hold2');
  const ok = await held(['bash', '-c', writeProgram('./notes.txt', { kind: 'file', sha: sha(BEFORE), hold: hold2 })], d, hold2, WANTED, () => {}, env);
  assert.equal(ok.code, 0, ok.err);
  assert.equal(readFileSync(f, 'utf8'), WANTED);
});

test('A-19: a hidden file, whose text is never read, is compared by its inode, size and time: an edit since the look is kept', { timeout: 60000 * SLOW }, async () => {
  const d = a19Dir('hidden'), f = join(d, 'server.key'), writeProgram = liftWrite();
  const sig = () => sigOf(f);
  writeFileSync(f, BEFORE, { mode: 0o600 });
  const hold = join(d, 'hold1');
  const r = await held(['bash', '-c', writeProgram('./server.key', { kind: 'hidden', sig: sig(), hold })], d, hold, WANTED, () => writeFileSync(f, NEWER));
  assert.equal(r.code, 3, r.err);
  assert.equal(readFileSync(f, 'utf8'), NEWER, 'the other program’s edit is there');
  assert.deepEqual(a19Left(d), []);
  // (changed since the ask, before the program even starts: it stops at its first compare; unchanged: written)
  const stale = spawnSync('bash', ['-c', writeProgram('./server.key', { kind: 'hidden', sig: `${sig()}x` })], { cwd: d, input: WANTED, encoding: 'utf8', timeout: 20000 });
  assert.equal(stale.status, 3, stale.stderr);
  assert.equal(readFileSync(f, 'utf8'), NEWER);
  const hold3 = join(d, 'hold3');
  const ok = await held(['bash', '-c', writeProgram('./server.key', { kind: 'hidden', sig: sig(), hold: hold3 })], d, hold3, WANTED, () => {});
  assert.equal(ok.code, 0, ok.err);
  assert.deepEqual([readFileSync(f, 'utf8'), statSync(f).mode & 0o777], [WANTED, 0o600]);
});

// The final read of the A-19 fix (S-10): the second writer lands after the program's last compare, just before the
// publishing call itself (old.late). Compare-last then a move would lose it; the exchange keeps it.
test('A-19: an edit landing after the last compare, just before the publish itself, is kept: the exchange checks what it displaced, where compare-last would lose it', { timeout: 60000 * SLOW }, async () => {
  const d = a19Dir('late'), f = join(d, 'notes.txt'), late = join(d, 'late');
  writeFileSync(f, BEFORE);
  const r = await held(['bash', '-c', liftWrite()('./notes.txt', { kind: 'file', sha: sha(BEFORE), late })], d, late, WANTED, () => writeFileSync(f, NEWER));
  assert.equal(r.code, 3, r.err);
  assert.equal(readFileSync(f, 'utf8'), NEWER, 'the other program’s edit is there');
  assert.deepEqual(a19Left(d), []);
});

// S-6: the unit ended just after the exchange, as what it displaced is checked (its time, a cancel, a stop: TERM). A
// sha256sum first on the PATH sends the program's shell TERM at that check, once the test asks for it.
test('A-19: a unit ended just after the exchange puts back what it displaced: another program’s edit is never lost', { timeout: 60000 * SLOW }, async () => {
  const d = a19Dir('ended'), f = join(d, 'notes.txt'), hold = join(d, 'hold'), flag = join(d, 'end-now'), sent = join(d, 'ended'), pid = join(d, 'pid');
  const env = shimmed(d, 'sha256sum', `if [ -e ${shq(flag)} ]; then mv ${shq(flag)} ${shq(sent)}; kill -TERM "$(cat ${shq(pid)})"; fi`);
  writeFileSync(f, BEFORE);
  const r = await held(['bash', '-c', liftWrite()('./notes.txt', { kind: 'file', sha: sha(BEFORE), hold })], d, hold, WANTED, shell => {
    writeFileSync(f, NEWER);
    writeFileSync(pid, String(shell));
    writeFileSync(flag, '');
  }, env);
  assert.ok(existsSync(sent), 'the TERM was sent at the check of what was displaced');
  assert.equal(r.code, 143, r.err);
  assert.equal(readFileSync(f, 'utf8'), NEWER, 'what the exchange displaced, the other program’s edit, is back at the name');
  assert.deepEqual(a19Left(d), []);
});

test('A-19: an exchange back that fails says what is at the name and where the other text is kept, exit 5', { timeout: 60000 * SLOW }, async () => {
  const d = a19Dir('back-fails'), f = join(d, 'notes.txt'), hold = join(d, 'hold'), count = join(d, 'count');
  // (python3's first call, the exchange, is the real one; the second, the exchange back, fails)
  const env = shimmed(d, 'python3', `n=$(cat ${shq(count)} 2>/dev/null || echo 0); echo $((n + 1)) > ${shq(count)}; [ "$n" = 0 ] || exit 1`);
  writeFileSync(f, BEFORE);
  const r = await held(['bash', '-c', liftWrite()('./notes.txt', { kind: 'file', sha: sha(BEFORE), hold })], d, hold, WANTED, () => writeFileSync(f, NEWER), env);
  assert.equal(r.code, 5, r.err);
  const kept = /and what was there is kept as (\/\S+\.write_file\.\w+)\.$/.exec(r.err)?.[1];
  assert.ok(kept && r.err.startsWith('write_file: the file changed since it was read here and couldn’t be put back: the name holds the new text'), r.err);
  assert.deepEqual([readFileSync(f, 'utf8'), readFileSync(kept, 'utf8')], [WANTED, NEWER]);
});

// The write builder's line, routed to the runner: after exit 5 the runner answered "Nothing was written: …", which is
// untrue: the name holds the new text. Its answer (runnerWriteAnswer, 21-runner.mjs) now carries the program's own
// line as wroteOver, a field of its own; the program here is the real one, reaching exit 5 as the test above does.
test('A-19: the runner’s answer to exit 5 says what is at the name and where the other text is (wroteOver), never “Nothing was written”', { timeout: 60000 * SLOW }, async () => {
  const d = a19Dir('back-fails-answer'), f = join(d, 'notes.txt'), hold = join(d, 'hold'), count = join(d, 'count');
  const env = shimmed(d, 'python3', `n=$(cat ${shq(count)} 2>/dev/null || echo 0); echo $((n + 1)) > ${shq(count)}; [ "$n" = 0 ] || exit 1`);
  writeFileSync(f, BEFORE);
  const r = await held(['bash', '-c', liftWrite()('./notes.txt', { kind: 'file', sha: sha(BEFORE), hold })], d, hold, WANTED, () => writeFileSync(f, NEWER), env);
  assert.equal(r.code, 5, r.err);
  const fn = /^function runnerWriteAnswer\(exit, last\) \{[\s\S]*?\n\}$/m.exec(readFileSync(join(REPO, 'service', 'src', '21-runner.mjs'), 'utf8'))?.[0];
  assert.ok(fn, 'runnerWriteAnswer is in 21-runner.mjs');
  const answer = new Function('maskSecrets', `${fn}\nreturn runnerWriteAnswer;`)(t => String(t));
  const said = answer(r.code, r.err.split('\n').pop());
  assert.equal(said.notWritten, undefined, JSON.stringify(said));
  assert.ok(String(said.wroteOver).startsWith('The file changed since it was read here and couldn’t be put back: the name holds the new text, and what was there is kept as /'), JSON.stringify(said));
  const kept = /and what was there is kept as (\/\S+\.write_file\.\w+)\.$/.exec(said.wroteOver)?.[1];
  assert.deepEqual([readFileSync(f, 'utf8'), readFileSync(kept, 'utf8')], [WANTED, NEWER], 'the name holds the new text, the other text is where the answer says');
  assert.deepEqual([answer(3, 'write_file: the file changed since it was read here, so nothing was written.'), answer(null, '')],
    [{ notWritten: 'Nothing was written: write_file: the file changed since it was read here, so nothing was written.' }, { notWritten: 'Whether it was written isn’t known: it was ended before it finished.' }]);
});

// S-11: a disk with no hard links (a FAT or exFAT one): `ln` fails though nothing is at the name, as an ln first on
// the PATH makes it.
test('A-19: where the disk has no hard links, a new file is made only if nothing is at the name, and a file made meanwhile stays theirs', { timeout: 60000 * SLOW }, async () => {
  const d = a19Dir('no-links'), env = shimmed(d, 'ln', `echo "ln: failed to create hard link: Operation not permitted" >&2; exit 1`), writeProgram = liftWrite();
  const ok = await held(['bash', '-c', writeProgram('./new.txt', { kind: 'none', hold: join(d, 'hold1') })], d, join(d, 'hold1'), WANTED, () => {}, env);
  assert.equal(ok.code, 0, ok.err);
  assert.deepEqual([readFileSync(join(d, 'new.txt'), 'utf8'), statSync(join(d, 'new.txt')).mode & 0o777, a19Left(d)], [WANTED, 0o644, []]);
  const theirs = await held(['bash', '-c', writeProgram('./new2.txt', { kind: 'none', hold: join(d, 'hold2') })], d, join(d, 'hold2'), WANTED, () => writeFileSync(join(d, 'new2.txt'), NEWER), env);
  assert.equal(theirs.code, 3, theirs.err);
  assert.deepEqual([readFileSync(join(d, 'new2.txt'), 'utf8'), a19Left(d)], [NEWER, []]);
});

// The reviewer's open question: a hidden file's signature, taken over SSH at the ask and inside the unit at the
// write, must not depend on the time zone either sees.
test('A-19: a hidden file’s signature carries no time zone: a look and a unit in different zones agree', { timeout: 60000 * SLOW }, async () => {
  const program = liftWrite()('./server.key', { kind: 'hidden', sig: 'x' });
  assert.ok(SIG_FORMAT && program.includes(`stat -c '${SIG_FORMAT}'`), `the look and the program use one format: ${SIG_FORMAT}`);
  const d = a19Dir('zones'), f = join(d, 'server.key');
  writeFileSync(f, BEFORE, { mode: 0o600 });
  const r = spawnSync('bash', ['-c', liftWrite()('./server.key', { kind: 'hidden', sig: sigOf(f, { TZ: 'UTC0' }) })], { cwd: d, input: WANTED, encoding: 'utf8', timeout: 20000, env: { ...process.env, TZ: 'EST5' } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(f, 'utf8'), WANTED);
});

// Undo's put-back (A-19, beside): the copies' program (21-copies.mjs), lifted with its pruning part, run with python3
// as the console runs it, in a home of its own: copy, the change, after, then restore waiting in A.hold between its
// look and its put-back while the test writes the file. What another program wrote since stays, and is said.
async function copiesPy() {
  const d = a19Dir('copies-program'), S = join(REPO, 'service', 'src');
  writeFileSync(join(d, 'copies.mjs'), ["import { randomBytes } from 'node:crypto';", 'const ALL_LOCAL = false;',
    'class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }',
    'const sparkName = () => "Spark 3", maskSecrets = String, run = async () => ({ code: 0, out: "" });',
    readFileSync(join(S, '21-copies-prune.mjs'), 'utf8'), readFileSync(join(S, '21-copies.mjs'), 'utf8'),
    'export { COPIES_PY, COPIES_FILE_MAX, COPIES_SET_MAX };'].join('\n'));
  const m = await import(pathToFileURL(join(d, 'copies.mjs')).href);
  // (as copiesOn sends it: the limits, and the ways in, none here)
  const arg = A => Buffer.from(JSON.stringify({ fileMax: m.COPIES_FILE_MAX, allMax: m.COPIES_SET_MAX, ways: [], ...A })).toString('base64');
  const answer = (out, err) => { const x = /^RESULT ([A-Za-z0-9+/=]+)$/m.exec(out); assert.ok(x, `no answer: ${out.slice(-300)} ${String(err).slice(-600)}`); return JSON.parse(Buffer.from(x[1], 'base64').toString('utf8')); };
  return {
    once: (home, A, env = {}) => { const r = spawnSync('python3', ['-', arg(A)], { input: m.COPIES_PY, env: { ...process.env, HOME: home, ...env }, encoding: 'utf8', timeout: 30000 }); return answer(String(r.stdout), r.stderr); },
    held: async (home, A, hold, during, env = {}) => { const r = await held(['python3', '-', arg({ ...A, hold })], home, hold, m.COPIES_PY, during, { HOME: home, ...env }); assert.equal(r.code, 0, r.err); return answer(r.out, r.err); },
  };
}

test('A-19, undo: the put-back never replaces an edit another program made since its look; a file the change removed is put back only where nothing is', { timeout: 60000 * SLOW }, async () => {
  const P = await copiesPy(), home = a19Dir('home'), notes = join(home, 'notes');
  mkdirSync(notes, { recursive: true });
  writeFileSync(join(notes, 'a.txt'), BEFORE);
  writeFileSync(join(notes, 'b.txt'), BEFORE);
  const set = 'sa19test0001', c = P.once(home, { mode: 'copy', set, ways: [], placed: ['~/notes/a.txt', '~/notes/b.txt'], wide: [] });
  assert.ok(c.sha, JSON.stringify(c));
  // (the change: a.txt rewritten, b.txt removed; then its after-look)
  writeFileSync(join(notes, 'a.txt'), 'what the change wrote\n');
  unlinkSync(join(notes, 'b.txt'));
  P.once(home, { mode: 'after', set, sha: c.sha });
  // A second writer while the put-back waits between its look and its put-back, one file a time: a.txt edited, then
  // b.txt made anew.
  for (const [name, i] of [['a.txt', 1], ['b.txt', 2]]) {
    const r = await P.held(home, { mode: 'restore', set, sha: c.sha, check: true, only: [`~/notes/${name}`] }, join(home, `hold${i}`), () => writeFileSync(join(notes, name), NEWER));
    assert.deepEqual([r.restored, r.notRestored.map(e => [e.path, e.why])], [[], [[`~/notes/${name}`, 'changed again since the change: left as it is']]], JSON.stringify(r));
    assert.equal(readFileSync(join(notes, name), 'utf8'), NEWER, `what the other program wrote in ${name} is there`);
  }
  assert.deepEqual(a19Left(notes), []);
});

// S-11, undo: a disk with no hard links. Python's os.link fails there though nothing is at the name; a sitecustomize
// first on its path makes it fail so.
test('A-19, undo: where the disk has no hard links, a removed file is put back only where nothing is', { timeout: 60000 * SLOW }, async () => {
  const P = await copiesPy(), home = a19Dir('home-no-links'), notes = join(home, 'notes'), site = a19Dir('no-links-site');
  writeFileSync(join(site, 'sitecustomize.py'), 'import errno, os\ndef _no(*a, **k):\n    raise OSError(errno.EPERM, "Operation not permitted")\nos.link = _no\n');
  const env = { PYTHONPATH: site };
  mkdirSync(notes, { recursive: true });
  writeFileSync(join(notes, 'b.txt'), BEFORE, { mode: 0o640 });
  writeFileSync(join(notes, 'c.txt'), BEFORE);
  const set = 'sa19test0003', c = P.once(home, { mode: 'copy', set, placed: ['~/notes/b.txt', '~/notes/c.txt'], wide: [] }, env);
  unlinkSync(join(notes, 'b.txt'));
  unlinkSync(join(notes, 'c.txt'));
  P.once(home, { mode: 'after', set, sha: c.sha }, env);
  const r = await P.held(home, { mode: 'restore', set, sha: c.sha, check: true, only: ['~/notes/b.txt'] }, join(home, 'hold1'), () => {}, env);
  assert.deepEqual([r.restored, r.notRestored], [['~/notes/b.txt'], []], JSON.stringify(r));
  assert.deepEqual([readFileSync(join(notes, 'b.txt'), 'utf8'), statSync(join(notes, 'b.txt')).mode & 0o777], [BEFORE, 0o640]);
  const t = await P.held(home, { mode: 'restore', set, sha: c.sha, check: true, only: ['~/notes/c.txt'] }, join(home, 'hold2'), () => writeFileSync(join(notes, 'c.txt'), NEWER), env);
  assert.deepEqual([t.restored, t.notRestored.map(e => [e.path, e.why])], [[], [['~/notes/c.txt', 'changed again since the change: left as it is']]], JSON.stringify(t));
  assert.deepEqual([readFileSync(join(notes, 'c.txt'), 'utf8'), a19Left(notes)], [NEWER, []]);
});

test('A-19, undo: with nobody else writing, the put-back puts both back, exactly', { timeout: 60000 * SLOW }, async () => {
  const P = await copiesPy(), home = a19Dir('home2'), notes = join(home, 'notes');
  mkdirSync(notes, { recursive: true });
  writeFileSync(join(notes, 'a.txt'), BEFORE, { mode: 0o640 });
  writeFileSync(join(notes, 'b.txt'), BEFORE);
  const set = 'sa19test0002', c = P.once(home, { mode: 'copy', set, ways: [], placed: ['~/notes/a.txt', '~/notes/b.txt'], wide: [] });
  writeFileSync(join(notes, 'a.txt'), 'what the change wrote\n');
  unlinkSync(join(notes, 'b.txt'));
  P.once(home, { mode: 'after', set, sha: c.sha });
  const r = await P.held(home, { mode: 'restore', set, sha: c.sha, check: true }, join(home, 'hold'), () => {});
  assert.deepEqual([...r.restored].sort(), ['~/notes/a.txt', '~/notes/b.txt'], JSON.stringify(r));
  assert.deepEqual([readFileSync(join(notes, 'a.txt'), 'utf8'), statSync(join(notes, 'a.txt')).mode & 0o777, readFileSync(join(notes, 'b.txt'), 'utf8')], [BEFORE, 0o640, BEFORE]);
  assert.deepEqual(a19Left(notes), []);
});

test('write_file\'s own entry: refused while changes are paused; an agent\'s call is answered with a question for the owner, with no button to press', { timeout: 60000 * SLOW }, async () => {
  await agentSettings({ halted: true });
  try {
    const r = await writeApi({ path: '~/notes/paused.txt', text: 'x\n' });
    assert.equal(r.status, 403, r.text);
    assert.match(r.json.error, /changes are paused/);
  } finally { await agentSettings({ halted: false }); }
  const a = await call(keys.act.token, 'write_file', { on: 'spark3', path: '~/notes/agent.txt', text: 'x\n' });
  assert.equal(a.isError, false, a.text);
  assert.equal(a.value.outcome, 'question', a.text);
  // (asked of a direct call, an owner-only question keeps no choice: the owner asks for it in their own chat)
  assert.ok(Array.isArray(a.value.choices) && a.value.choices.length > 0 && a.value.choices.every(c => c.choice === null), a.text);
  assert.match(a.value.note, /^Only the owner can answer this one, from Spark Console, and nothing was done\. There’s no choice to send back/, a.text);
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

// The final read, K1: an old line (-) comes from the file on the Spark, which nothing checked. A password the mask hides
// by its shape, and a kept key, each holding signs that run something, stay hidden on the ask as the page and Telegram
// get it; a new line (+) with such signs is still shown whole.
test('an old line\'s password or kept key is never shown whole on the ask, on the page or on Telegram; a new line still is', { timeout: 240000 * SLOW }, async () => {
  const TG = 5550001, PW = 'Tr0ub4dor&3(x)', KEPT = 'pg://u:Pa$$w0rd&more';
  const fleet = await startMock({ evalOnRecord: false, telegram: true, env: { SPARK_CONSOLE_RUN_SECONDS: '6', SPARK_CONSOLE_ROUTE_MS: '1000', SPARK_CONSOLE_WIDE_MS: '1' },
    prepare: ({ root, dir }) => {
      rehearse(root, 'spark3', { run: true }); mkdirSync(join(root, 'spark3', 'notes'), { recursive: true });
      writeFileSync(join(root, 'spark3', 'notes', 'settings.txt'), `import os\nDB_PASSWORD = "${PW}"\nURL=${KEPT}\nDEBUG = False\n`);
      mkdirSync(join(dir, 'secrets'), { recursive: true, mode: 0o700 });
      writeFileSync(join(dir, 'secrets', 'secrets.json'), JSON.stringify({ telegram: { token: '123456789:AAEtestTokenForSparkConsoleXYZ_abcdefghij', bot: 'spark_test_bot', chatId: TG, userId: TG, name: 'Owner', pairedAt: '2026-11-10T00:00:00.000Z', approve: true },
        keys: { DB_URL: { value: KEPT, at: '2026-11-10T00:00:00.000Z' } } }), { mode: 0o600 });
    } });
  const was = { fleet: T.fleet, base: T.base, mcp: T.mcp, origin: T.origin };
  Object.assign(T, { fleet, base: fleet.base, mcp: fleet.mcp, origin: fleet.origin });
  try {
    const chat = await newChat(), mark = '(shown whole: what would be hidden here holds signs that run something)';
    const leaks = s => [PW, KEPT, 'Pa$$w0rd', encodeURIComponent(KEPT)].filter(x => String(s).includes(x));
    const r = await turn(chat, 'fix the settings note on spark 3', [[WRITE('~/notes/settings.txt', 'URL = None\ntoken=$(reboot)\n', { from: 2, to: 3 })]]);
    const q = r.back[0]?.question || '';
    assert.match(q, /^Write this file on Spark 3\?\n~\/notes\/settings\.txt: lines 2 to 3 replaced \(4 lines now\)\n- DB_PASSWORD = "\[hidden\]" \(a value on this line is hidden here\)\n- URL=\[hidden\] \(a value on this line is hidden here\)\n\+ URL = None\n\+ token=\[hidden\] /, q);
    // (the paired chat's ask: the new line whole, the old ones masked)
    const sent = await waitFor(() => lines(join(fleet.dir, 'telegram-calls.jsonl')).find(c => c.method === 'sendMessage' && c.body?.reply_markup), { what: 'the ask in the paired chat' });
    assert.ok(sent.body.text.includes(`+ token=$(reboot) ${mark}`), sent.body.text);
    assert.ok(sent.body.text.includes('- DB_PASSWORD = "[hidden]"') && sent.body.text.includes('- URL=[hidden]'), sent.body.text);
    assert.deepEqual(leaks(sent.body.text), [], sent.body.text);
    // (the page: on the reply and on a later read)
    const page = r.message.asks?.[0]?.text || '';
    assert.ok(page.includes(`+ token=$(reboot) ${mark}`) && page.includes('- DB_PASSWORD = "[hidden]"') && page.includes('- URL=[hidden]'), page);
    assert.deepEqual(leaks(page), [], page);
    assert.equal((await api(`/chats/${chat}`)).json.messages.at(-1).asks?.[0]?.text, page);
    assert.deepEqual(leaks(JSON.stringify(lines(join(fleet.dir, 'telegram-calls.jsonl')))), [], 'in no Telegram call');
    assert.deepEqual(leaks(readFileSync(join(fleet.stateDir, 'chats.json'), 'utf8')), [], 'in chats.json');
    for (const f of readdirSync(fleet.journalDir)) assert.deepEqual(leaks(readFileSync(join(fleet.journalDir, f), 'utf8')), [], `in ${f}`);
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

// The final read, K3: the lines a write's ask shows whole on the page are held in memory beside the chat file; a value
// typed before it was given with /key is hidden there too, as in the chat file.
test('a value in a write ask\'s lines, given later with /key, is hidden in the page\'s copy held in memory and in the chat file', { timeout: 120000 * SLOW }, async () => {
  const X = `kz${createHash('sha256').update(`${Date.now()} ${Math.random()}`).digest('hex').slice(0, 30)}`, mark = '(shown whole: what would be hidden here holds signs that run something)';
  const chat = await newChat();
  const r = await turn(chat, 'fix the registry note', [[WRITE('~/notes/registry.txt', `token=$(reboot)\nregistry ${X}\n`)]]);
  const page = r.message.asks?.[0]?.text || '';
  assert.ok(page.includes(`+ token=$(reboot) ${mark}`) && page.includes(`+ registry ${X}`), page);
  const k = await say(chat, `/key REGISTRY_NOTE ${X}`);
  assert.match(k.text, /^Kept your key REGISTRY_NOTE\./);
  const got = (await api(`/chats/${chat}`)).json, ask = got.messages.find(m => m.asks?.length)?.asks[0].text || '';
  assert.ok(ask.includes(`+ token=$(reboot) ${mark}`) && ask.includes('+ registry [hidden]'), ask);
  assert.ok(!JSON.stringify(got).includes(X), JSON.stringify(got).slice(0, 2000));
  assert.ok(!readFileSync(join(T.fleet.stateDir, 'chats.json'), 'utf8').includes(X), 'chats.json');
  assert.ok(!existsSync(at3('notes/registry.txt')), 'nothing written');
});

// The final read, TB2: a file the look may not read, under a name the sorter calls a plain change, is asked for that
// reason alone (the key file above is asked for the sorter's own reason first), and stays as it was.
test('a file a look may not read is asked because its old text is hidden, even when the words ask for it there, and stays as it was', { timeout: 120000 * SLOW }, async () => {
  const r = await turn(await newChat(), 'fix the unread note on spark 3', [[WRITE('~/notes/unread.txt', 'new\n')]]);
  assert.equal(r.back[0]?.outcome, 'needs-ok', JSON.stringify(r.back));
  assert.match(r.back[0].question, /^Write this file on Spark 3\?\n~\/notes\/unread\.txt: its old text is hidden \(a key, or a file a look may not read\), so only the new text is shown\n\+ new\nAsked because its old text is hidden from a look, so you see only the new text\.\n/, r.back[0].question);
  assert.equal(statSync(at3('notes/unread.txt')).size, UNREAD.length, 'not written');
});

// The final read, TB3: in a chat whose words ask for it there, a write into the model store and one at the top of the
// home are each asked for that reason (the runner's own refusal is not the ask), and the press writes them.
test('in a chat, a write into the model store is asked for that reason, and the press writes it', { timeout: 120000 * SLOW }, async () => {
  const chat = await newChat();
  const r = await turn(chat, 'fix the store config on spark 3', [[WRITE('~/models/m1/config.json', '{}\n')]]);
  assert.equal(r.back[0]?.outcome, 'needs-ok', JSON.stringify(r.back));
  assert.match(r.back[0].question, /\nAsked because it changes ~\/models, which a change gets only after your yes\.\n/, r.back[0].question);
  assert.ok(!existsSync(at3('models/m1/config.json')), 'nothing written before the press');
  const p = await choose(chat, r.choices.find(c => c.label === 'Run it').id);
  assert.equal(p.status, 200, p.text);
  assert.equal(existsSync(at3('models/m1/config.json')) && text('models/m1/config.json'), '{}\n', `the press wrote it: ${p.text.slice(0, 1500)}`);
});

test('in a chat, a write at the top of the home is asked for that reason, and the press writes it with the top of the home writable', { timeout: 120000 * SLOW }, async () => {
  const chat = await newChat();
  const r = await turn(chat, 'fix the top note on spark 3', [[WRITE('~/top.txt', 'top\n')]]);
  assert.equal(r.back[0]?.outcome, 'needs-ok', JSON.stringify(r.back));
  assert.match(r.back[0].question, /\nAsked because it writes ~\/top\.txt at the top of the home, which the plain wall keeps read-only, so it runs after your yes with the top of your home writable\.\n/, r.back[0].question);
  assert.ok(!existsSync(at3('top.txt')), 'nothing written before the press');
  const p = await choose(chat, r.choices.find(c => c.label === 'Run it').id);
  assert.equal(p.status, 200, p.text);
  assert.equal(existsSync(at3('top.txt')) && text('top.txt'), 'top\n', `the press wrote it: ${p.text.slice(0, 1500)}`);
  assert.equal(startOf('~/top.txt')?.wall, 'home', JSON.stringify(startOf('~/top.txt')));
});

// The final read, TB7: writeKey's other two kinds, a kept key's exact value and a private key block (the token shape is
// above); each refused by name, nothing written.
test('a kept key\'s exact value in the text is refused by name; nothing is written', { timeout: 60000 * SLOW }, async () => {
  const V = `kw${createHash('sha256').update(`${Date.now()} ${Math.random()}`).digest('hex').slice(0, 30)}`;
  assert.match((await say(await newChat(), `/key WRITE_DEMO_KEY ${V}`)).text, /^Kept your key WRITE_DEMO_KEY\./);
  const kept = await writeApi({ path: '~/notes/kept.txt', text: `TOKEN_FOR_DEMO=${V}\n` });
  assert.equal(kept.status, 400, kept.text);
  assert.equal(kept.json.error, 'The text holds the value of a key you gave Sparkie, so it isn’t written or shown on a button: give the key by its name. Nothing was written.');
  assert.ok(!existsSync(at3('notes/kept.txt')));
});

test('a private key block in the text is refused by name; nothing is written', { timeout: 60000 * SLOW }, async () => {
  const block = await writeApi({ path: '~/notes/block.txt', text: '-----BEGIN PRIVATE KEY-----\nnot a key: a test\'s made-up words\n-----END PRIVATE KEY-----\n' });
  assert.equal(block.status, 400, block.text);
  assert.equal(block.json.error, 'The text holds a private key block, so it isn’t written or shown on a button: give the key by its name. Nothing was written.');
  assert.ok(!existsSync(at3('notes/block.txt')));
});
