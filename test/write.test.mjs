// Covers: write_file on a compute Spark (21-write.mjs, through run's ladder and runner; R68, R61; design A 2.9 and
// 2.14 row 7, step A7d), end to end on the stand-in fleet: a file the owner's words ask for is written at once, copied
// first, with its old mode, and undo puts it back; its bytes reach the unit on the helper's input, never a command
// line; asked, the button shows the path and the lines that change, old and new, and the press writes them; lines
// from to to are replaced in place; a file changed after the ask voids the press; the same ladder as run: the model
// store and the top of the home asked, the ways in and Spark 2 refused, a link in its folders never written through;
// a key in the text and a text over 128 KB refused; a script it wrote and a later command of the request runs is asked.
// The stand-in fleet, with the real root helper set up and proven for Spark 3 (test/rehearsal.mjs, run: true), the
// stand-ins in test/mock/bin, and the stand-in brain told by a script which tools to call. Linux only: run it on a
// Spark with tools/test-on-spark.sh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync, statSync, readdirSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { T, useFleet, api, newChat, say, choose, waitFor, sleep, SLOW } from './lib.mjs';
import { rehearse } from './rehearsal.mjs';

useFleet({ env: { SPARK_CONSOLE_RUN_SECONDS: '6', SPARK_CONSOLE_ROUTE_MS: '1000', SPARK_CONSOLE_WIDE_MS: '1' },
  prepare: ({ root }) => {
    rehearse(root, 'spark3', { run: true });
    const h = join(root, 'spark3');
    const put = (p, data, mode = 0o644) => { mkdirSync(dirname(join(h, p)), { recursive: true }); writeFileSync(join(h, p), data); chmodSync(join(h, p), mode); };
    put('notes/e.txt', 'e before\n', 0o640);
    put('notes/five.txt', 'one\ntwo\nthree\nfour\nfive\n');
    put('notes/ask.txt', 'before\n');
    put('notes/late.txt', 'late before\n');
    put('notes/real/inner.txt', 'inner\n');
    mkdirSync(join(h, 'models', 'm1'), { recursive: true });
    put('.ssh/authorized_keys', 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIStandIn owner@mac\n', 0o600);
    chmodSync(join(h, '.ssh'), 0o700);
  } }, async () => {
  // (no change runs at once until the console has read the tailnet: two looks after a request, A7c)
  const looks = () => (existsSync(join(T.fleet.dir, 'tailscale-calls')) ? readFileSync(join(T.fleet.dir, 'tailscale-calls'), 'utf8').split('\n').filter(l => l === 'status --json').length : 0);
  await api('/health');
  const n = looks();
  await waitFor(() => looks() >= n + 2, { what: 'two looks at the tailnet after a request' });
  await sleep(300);
});

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
  assert.match(key.json.error, /shaped like a key or password/);
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
