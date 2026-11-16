// Covers: The journal (B1, R43): Spark Console's own record of what was said, called, run and seen, in a folder of its
// own outside the state folder (here each stand-in fleet's own journal/), read back with recall. A look writes one
// line; keys are hidden before anything is written, also where a key falls across two pieces of a long text (pieces
// shortened here with SPARK_CONSOLE_JOURNAL_PIECE); a failed start leaves its log, its attempt and its operation, and
// recall still finds them after a restart (operation_log says expired); text recall returned isn't the owner's words,
// so remember needs a button after it. A change that is written down first (save_file, keep_running with an image)
// answers "couldn't write the record, nothing was changed" when the journal can't be written (mock/disk-full.mjs: a
// full disk under the journal only), and nothing runs, while a look, /stop and stop_model still work. A console killed
// between a start line and its end leaves, after the restart, one "cut off" notice in the chat that asked and one
// needs-you line, and a second restart adds neither. Past its limit (shortened with SPARK_CONSOLE_JOURNAL_MAX_BYTES) a
// record's text stops and the record says so.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, call, createKey, createActKey, newChat, say, waitFor, sleep, ASK, MEMBER, SLOW } from './lib.mjs';
import { startMock, TEST_DIR } from './start-mock.mjs';

const keys = {};
useFleet({ watchMs: 60000, knowledge: true,
  env: { NODE_OPTIONS: `--import=${join(TEST_DIR, 'mock', 'disk-full.mjs')}`, SPARK_CONSOLE_JOURNAL_PIECE: '256' } },
async () => { keys.look = await createKey('journal-look'); keys.act = await createActKey('journal-act'); });

const later = [];
after(async () => { for (const f of later) await f.stop().catch(() => {}); }, { timeout: 60000 });

// What a journal folder holds: every record (one line each), and a record's text from the .out file of its month.
// (a line still being written is left out)
const records = (dir = T.fleet.journalDir) => (existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort()
  .flatMap(f => readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } })) : []);
const textOf = (rec, dir = T.fleet.journalDir) => readFileSync(join(dir, `journal-${rec.at.slice(0, 7)}.out`)).subarray(rec.o[0], rec.o[0] + rec.o[1]).toString();
const everything = (dir = T.fleet.journalDir) => readdirSync(dir).map(f => readFileSync(join(dir, f), 'utf8')).join('\n');
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const mock = (spark, file, fleet = T.fleet) => join(fleet.root, spark, '.mock', file);
const stateOf = (spark, name) => readFileSync(mock(spark, 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];
async function ok(name, args, token = keys.act.token, base = undefined) {
  const r = await call(token, name, args, base ? { url: `${base}/mcp` } : {});
  assert.equal(r.isError, false, `${name} ${JSON.stringify(args)}: ${r.text}`);
  return r.value;
}
async function finished(id, token = keys.look.token) {
  for (const until = Date.now() + 240000 * SLOW; ;) {
    const w = await ok('wait_operation', { id, seconds: 20 }, token);
    if (w.status !== 'running') return w;
    if (Date.now() > until) throw new Error(`operation ${id} still running`);
  }
}
// Another console (after a restart): a request to it as the owner, a key there, and its needs-you lines.
const post = (fleet, path, body) => fetch(`${fleet.base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-spark-console': '1', origin: fleet.origin }, body: JSON.stringify(body) });
const keyOn = async fleet => (await (await post(fleet, '/agents', { name: `journal-${Math.random().toString(16).slice(2, 8)}` })).json()).token;
const needsOn = async fleet => (await ok('fleet_status', {}, await keyOn(fleet), fleet.base)).needsOwner;
const FAKE = 'hf_abcdefghijklmnopqrstuvwxyz0123';
const RADIX = 'sc-RadixArk--Qwen3.8-27B-NVFP4', GEMMA = 'sc-gemma-3-12b-it';
// Fake keys, each a 49-character line: the failed start's error keeps its log's last 2,500 characters, which then start
// at a line's beginning, and the shortened pieces (256 characters) fall inside keys.
const KEYS = Array.from({ length: 80 }, (_, i) => `hf_${(`${i}`.padStart(3, '0') + 'k'.repeat(10) + Array.from({ length: 33 }, (_, j) => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'[(i * 31 + j * 17 + j * j) % 55]).join(''))}`);
const leaks = text => KEYS.flatMap(k => Array.from({ length: k.length - 11 }, (_, i) => k.slice(i, i + 12))).filter(f => text.includes(f));
// A key's pieces of 12 characters: none may be in the journal, whole or cut. (Each key below follows a dash: a key
// glued to a word is masked nowhere.)
const piecesOf = key => Array.from({ length: key.length - 11 }, (_, i) => key.slice(i, i + 12));
const SUBKEY = 'hf_Zq7Wm2Xr9Tb4Lk8Hs3Fd6Gp1Nc5Vy0Uj', EVKEY = 'hf_Pa4Ke8Rt2Wq6Yz0Bn3Mx7Lc1Vg5Hd9Js';
let failedOp = null, refusedId = null;

test('its folder is outside the state folder (0700, files 0600); a look writes one line; a key in an agent\'s arguments is [hidden] in the file', async () => {
  const before = records().length;
  await ok('find_recipes', { query: `qwen ${FAKE}` }, keys.look.token);
  const mine = records().slice(before).filter(r => r.act === 'find_recipes');
  assert.equal(mine.length, 1, JSON.stringify(mine));
  assert.deepEqual([mine[0].k, mine[0].via, mine[0].actor, mine[0].ok, mine[0].start], ['call', 'agent', keys.look.name, true, undefined]);
  assert.equal(mine[0].args.query, 'qwen [hidden]');
  assert.ok(!everything().includes(FAKE), 'the key is nowhere in the journal');
  assert.ok(!T.fleet.journalDir.startsWith(T.fleet.stateDir), 'outside the state folder');
  assert.equal(statSync(T.fleet.journalDir).mode & 0o777, 0o700);
  for (const f of readdirSync(T.fleet.journalDir)) assert.equal(statSync(join(T.fleet.journalDir, f)).mode & 0o777, 0o600, f);
});

test('a failed start: its log (keys hidden, also across two pieces), its attempt and the operation, with the events', { timeout: 300000 * SLOW }, async () => {
  writeFileSync(mock('spark4', `logs-${GEMMA}`), `${KEYS.join('\n')}\n`);
  try {
    const x = await ok('start_model', { model: 'gemma-3-12b-it', spark: 'spark4' });
    assert.equal(x.outcome, 'started', JSON.stringify(x));
    assert.equal((await finished(x.operation)).status, 'failed');
    failedOp = x.operation;
    const op = await waitFor(() => records().find(r => r.k === 'op' && r.op === x.operation), { what: 'the operation\'s record' });
    assert.deepEqual([op.act, op.ok, op.outcome, op.via], ['deploy', false, 'failed', 'agent']);
    assert.ok(op.sub.includes('gemma-3-12b-it') && op.sub.includes('spark4'), JSON.stringify(op.sub));
    const text = textOf(op);
    assert.match(text, /Starting gemma-3-12b-it/);
    assert.match(text, /Error:\nThe model server stopped while loading\./);
    assert.ok(op.o[1] > 4 * 256, `long enough to be written in several pieces: ${op.o[1]}`);
    assert.ok((text.match(/\[hidden\]/g) || []).length >= 40, text);
    assert.deepEqual(leaks(everything()), [], 'no piece of any key, whole or split');
    // A key across the cut of a name the record is about (its model, cut at 120 characters): masked before the cut.
    const named = await call(keys.look.token, 'where_it_fits', { model: `${'m'.repeat(104)}-${SUBKEY}` });
    assert.equal(named.isError, true, named.text);
    const about = await waitFor(() => records().find(r => r.act === 'where_it_fits' && (r.sub || []).some(n => n.startsWith('mmmm'))), { what: 'the look\'s record' });
    assert.ok(about.sub.some(n => n.includes('[hidden]')), JSON.stringify(about.sub));
    assert.deepEqual(piecesOf(SUBKEY).filter(f => everything().includes(f)), [], 'no piece of the key in a name');
    const attempt = records().find(r => r.k === 'attempt' && r.op === x.operation);
    assert.deepEqual([attempt?.n, attempt?.failure], [1, 'unknown'], JSON.stringify(attempt ?? null));
    const ev = records().filter(r => r.k === 'event' && r.op === x.operation).map(r => r.outcome);
    assert.deepEqual(ev, ['started', 'failed']);
  } finally { rmSync(mock('spark4', `logs-${GEMMA}`), { force: true }); }
});

test('Sparkie\'s turn: the owner\'s words, each tool call with its result, the turn; after recall, remember needs a button', { timeout: 120000 * SLOW }, async () => {
  const words = 'look up what happened to gemma when it failed to start on spark 4, and remember it';
  const line = 'gemma failed to start on spark4: the engine stopped while loading';
  script([{ match: '^look up what happened to gemma', rounds: [[{ name: 'recall', arguments: { about: 'gemma' } }], [{ name: 'remember', arguments: { text: line, kind: 'fact' } }]] }]);
  const chat = await newChat();
  const r = await say(chat, words);
  assert.deepEqual(r.message.tools.map(t => [t.name, t.ok, t.outcome || null]), [['recall', true, null], ['remember', true, 'needs-ok']], JSON.stringify(r.message.tools));
  assert.equal(r.message.choices?.[0]?.label, `Remember: “${line}”`, JSON.stringify(r.message.choices));
  assert.deepEqual((await ok('memory', {}, keys.look.token)).entries, [], 'nothing kept without the button');
  const said = records().find(x => x.k === 'said' && x.chat === chat);
  assert.deepEqual([said?.via, said?.words], ['page', words]);
  const tools = records().filter(x => x.k === 'tool' && x.turn === said.id);
  assert.deepEqual(tools.map(x => [x.act, x.chat, x.ok]), [['recall', chat, true], ['remember', chat, true]]);
  assert.match(textOf(tools[0]), new RegExp(`"op":"${failedOp}"`), 'recall found the failed start');
  const turn = records().find(x => x.k === 'turn' && x.turn === said.id);
  assert.deepEqual([turn?.chat, turn?.rounds, turn?.tools, turn?.toolErrors, turn?.ok], [chat, 2, 2, 0, true]);
});

// What the owner's calls carried (a line to remember, a file's name) comes back only on the owner's own call; another
// caller sees who, what, when and whether it worked, and the arguments of its own calls (follow-up to the review of B1:
// a line the owner remembered, forgot and erased stayed readable in the remember call's arguments).
test('an agent sees who, what and when of the owner\'s calls but not what they carried; its own calls whole', { timeout: 120000 * SLOW }, async () => {
  const line = 'the side door opens with code quorvix', owner = (name, body) => api(`/actions/${name}`, { method: 'POST', body });
  const kept = await owner('remember', { text: line, kind: 'fact' });
  assert.equal(kept.json.outcome, 'remembered', kept.text);
  assert.equal((await owner('forget_memory', { id: kept.json.id })).json.outcome, 'forgotten');
  assert.equal((await owner('forget_memory', { id: kept.json.id, erase: true })).json.outcome, 'erased');
  // A failed call of the owner's whose error names its file.
  for (let i = 0; i < 2; i++) await owner('save_file', { spark: 'spark3', path: 'door-quorvix.md', text: 'x\n' });
  const remembered = records().find(r => r.k === 'call' && r.act === 'remember' && r.via === 'api' && /quorvix/.test(JSON.stringify(r.args)));
  const failed = records().find(r => r.k === 'call' && r.act === 'save_file' && r.end && /quorvix/.test(r.err || ''));
  assert.ok(remembered && failed, 'the journal holds both, for the owner');
  // Keys of their own, so each one's own calls (which it sees whole, these words too) are told apart by name.
  const look = await createKey('recall-look'), act = await createActKey('recall-act'), asker = await createKey('recall-ask');
  await ok('find_recipes', { query: 'zebra unicorn' }, look.token);
  const asks = [{ kind: 'call', limit: 20 }, { about: 'side door' }, { about: 'quorvix' }, { about: 'remember' }, { id: remembered.id }, { id: failed.id }];
  const blind = text => !/quorvix|side door/.test(text);
  for (const k of [look, act]) {
    for (const args of asks) {
      const r = await call(k.token, 'recall', args);
      assert.equal(r.isError, false, r.text);
      const others = (r.value.records || [r.value.record]).filter(v => v.actor !== k.name);
      assert.ok(blind(JSON.stringify(others)), `${JSON.stringify(args)}: ${r.text}`);
      for (const v of others) if (v.via === 'api') assert.ok(!('args' in v) && !('error' in v), JSON.stringify(v));
    }
    const probe = (await call(k.token, 'recall', { about: 'quorvix', limit: 20 })).value.records.filter(v => v.actor !== k.name);
    assert.deepEqual(probe, [], 'the owner\'s words match nothing of the owner\'s');
  }
  // Its own call it sees whole; another key doesn't.
  const mine = (await call(look.token, 'recall', { kind: 'call', about: 'zebra' })).value.records;
  assert.ok(mine.some(v => v.act === 'find_recipes' && /zebra unicorn/.test(v.args)), JSON.stringify(mine));
  assert.equal((await call(act.token, 'recall', { kind: 'call', about: 'zebra' })).value.count, 0);
  // Through ask_sparkie: no more than the agent's own call.
  // (four calls a round at most)
  script([{ match: '^what did the owner keep', rounds: [asks.slice(0, 4).map(a => ({ name: 'recall', arguments: a })), [...asks.slice(4), { id: 'j_000000000000' }].map(a => ({ name: 'recall', arguments: a }))] }]);
  const from = readFileSync(join(T.fleet.dir, 'model-requests.jsonl'), 'utf8').length;
  assert.equal((await call(asker.token, ASK, { message: 'what did the owner keep about doors?' })).isError, false);
  await waitFor(() => readFileSync(join(T.fleet.dir, 'model-requests.jsonl'), 'utf8').slice(from).includes('no record j_000000000000'), { what: 'the tool results at the brain' });
  await sleep(1000);
  assert.ok(blind(readFileSync(join(T.fleet.dir, 'model-requests.jsonl'), 'utf8').slice(from)), 'what the brain was sent for the agent');
  // The owner reads everything.
  const all = (await owner('recall', { about: 'quorvix', limit: 20 })).json.records;
  assert.ok(all.some(v => v.id === remembered.id && v.args.includes(line)) && all.some(v => v.id === failed.id && /door-quorvix\.md/.test(v.error)), JSON.stringify(all));
});

// The owner's words and a chat's tool results come back only on the owner's own call (review of B1, 2026-11-14): never
// to an agent's key that looks or acts, or an agent through ask_sparkie.
test('words said to Sparkie and a chat\'s tool results: only the owner\'s own call reads them back', { timeout: 120000 * SLOW }, async () => {
  const chat = await newChat();
  await say(chat, 'the NAS password is hunter2; what\'s running?');
  const said = records().find(r => r.k === 'said' && r.chat === chat), tool = records().find(r => r.k === 'tool' && r.turn === said?.id && r.o);
  assert.ok(said && tool, JSON.stringify(records().filter(r => r.chat === chat)));
  const asks = [{ kind: 'said', limit: 20 }, { about: 'hunter2' }, { about: 'password' }, { kind: 'tool', limit: 20 }, { id: said.id }, { id: tool.id }];
  const blind = text => !/hunter2/.test(text) && !text.includes(textOf(tool).slice(0, 60));
  for (const token of [keys.look.token, keys.act.token]) {
    for (const args of asks) {
      const r = await call(token, 'recall', args);
      assert.ok(blind(r.text), `${JSON.stringify(args)}: ${r.text}`);
      if (args.id === said.id) assert.match(r.text, /^\[not_allowed\] Words said in a chat/);
    }
  }
  // Through ask_sparkie: Sparkie's recall for an agent gets no more than the agent's own call.
  script([{ match: '^recall what the owner said', rounds: [asks.slice(0, 4).map(arguments_ => ({ name: 'recall', arguments: arguments_ })), asks.slice(4).map(arguments_ => ({ name: 'recall', arguments: arguments_ }))] }]);
  const from = existsSync(join(T.fleet.dir, 'model-requests.jsonl')) ? readFileSync(join(T.fleet.dir, 'model-requests.jsonl'), 'utf8').length : 0;
  // (a key of its own: an agent sees its own calls whole, and the keys above searched for these words)
  const v = await call((await createKey('said-ask')).token, ASK, { message: 'recall what the owner said about the NAS' });
  assert.equal(v.isError, false, v.text);
  await waitFor(() => readFileSync(join(T.fleet.dir, 'model-requests.jsonl'), 'utf8').slice(from).includes('Words said in a chat'), { what: 'the tool results at the brain' });
  assert.ok(blind(readFileSync(join(T.fleet.dir, 'model-requests.jsonl'), 'utf8').slice(from)), 'what the brain was sent for the agent');
  // The owner's own call reads both.
  const own = await api('/actions/recall', { method: 'POST', body: { kind: 'said', limit: 20 } });
  assert.ok(own.json.records.some(r => r.id === said.id && /hunter2/.test(r.said)), own.text);
  assert.equal((await api('/actions/recall', { method: 'POST', body: { id: tool.id } })).json.text, textOf(tool).slice(0, 8000));
});

// T123 (part): with the journal unwritable, a file write (save_file, and an app from an image) runs nothing and the
// owner is told why. Undo restoring a file waits for the copies the command runner makes (milestone 2).
test('with the journal\'s disk full, a change written down first answers "couldn\'t write the record, nothing was changed" and nothing runs; a look, /stop and stop_model still work', { timeout: 180000 * SLOW }, async () => {
  const file = join(T.fleet.root, 'spark3', '.local/share/spark-portal/workspaces/shared', 'full-disk.md');
  const size = () => readdirSync(T.fleet.journalDir).reduce((n, f) => n + statSync(join(T.fleet.journalDir, f)).size, 0);
  writeFileSync(join(T.fleet.dir, 'disk-full'), '');
  try {
    const before = size();
    const s = await call(keys.act.token, 'save_file', { spark: 'spark3', path: 'full-disk.md', text: 'not written\n' });
    assert.equal(s.isError, true, s.text);
    assert.match(s.text, /^\[failed\] Couldn[’']t write the record of this change.*so nothing was changed/);
    assert.ok(!existsSync(file), 'the file wasn\'t written');
    const k = await call(keys.act.token, 'keep_running', { spark: 'spark3', container: 'journal-app', image: 'redis:7', port: '6391' });
    assert.equal(k.isError, true, k.text);
    assert.match(k.text, /nothing was changed/);
    assert.equal(stateOf('spark3', 'journal-app'), undefined, 'no container');
    // A look, the owner's /stop and a stop.
    const f = await ok('fleet_status', {}, keys.look.token);
    assert.ok(f.needsOwner.some(l => /can’t write its journal/.test(l)), JSON.stringify(f.needsOwner));
    const stop = await say(await newChat(), '/stop');
    assert.match(stop.text, /nothing to stop/);
    const x = await ok('stop_model', { spark: 'spark4', container: RADIX });
    assert.equal((await finished(x.operation)).status, 'completed');
    assert.equal(stateOf('spark4', RADIX), 'exited');
    assert.equal(size(), before, 'nothing was added to the journal');
  } finally { rmSync(join(T.fleet.dir, 'disk-full'), { force: true }); }
  await ok('fleet_status', {}, keys.look.token);
  assert.ok(!(await ok('fleet_status', {}, keys.look.token)).needsOwner.some(l => /journal/.test(l)), 'the line goes once a write works');
});

// A failing disk can take the line and then fail its sync: the change is refused, its end goes in at once, and the
// restart below doesn't report it as cut off.
test('a start line written but not synced: the change is refused and its end is written at once', { timeout: 60000 * SLOW }, async () => {
  writeFileSync(join(T.fleet.dir, 'fsync-fail'), '');
  try {
    const s = await call(keys.act.token, 'save_file', { spark: 'spark3', path: 'fsync-fail.md', text: 'not written\n' });
    assert.match(s.text, /^\[failed\] Couldn[’']t write the record of this change.*so nothing was changed/);
    assert.ok(!existsSync(join(T.fleet.root, 'spark3', '.local/share/spark-portal/workspaces/shared', 'fsync-fail.md')));
  } finally { rmSync(join(T.fleet.dir, 'fsync-fail'), { force: true }); }
  const start = records().find(r => r.start && r.args?.path === 'fsync-fail.md');
  refusedId = start?.id;
  assert.deepEqual(records().filter(r => r.id === refusedId).map(r => [r.start || false, r.end || false, r.outcome || null]), [[true, false, null], [false, true, 'refused']]);
});

// The console killed between the start line of save_file (its worker stalled) and its end; then started again on the
// same state and journal, twice. B is the console after the first restart.
let B = null, cutChat = null;
const copyTo = (from, events = []) => ({ dir, stateDir }) => {
  cpSync(join(from.stateDir, 'chats.json'), join(stateDir, 'chats.json'));
  cpSync(from.journalDir, join(dir, 'journal'), { recursive: true });
  if (events.length) writeFileSync(join(stateDir, 'events.jsonl'), events.map(e => `${JSON.stringify(e)}\n`).join(''), { mode: 0o600 });
};
// An operation a restart cut off, whose notice (“A restart of Spark Console cut off deploy <model>…”) holds a key across
// the 600 characters an event's text keeps: it is masked before the cut.
const CUT_PREFIX = 'A restart of Spark Console cut off deploy ';
const CUT_OP = { at: '2026-11-04T10:00:00.000Z', type: 'operation', id: 'fedcba987654', operation: 'deploy', status: 'started', model: `${'m'.repeat(584 - CUT_PREFIX.length)}-${EVKEY}`, spark: 'spark3' };
const env = { SPARK_CONSOLE_JOURNAL_MAX_BYTES: '2048', SPARK_CONSOLE_JOURNAL_NEEDS_BYTES: '1' };
// T123 (part): killed while a file write changes a Spark, after the restart one "cut off" notice, and it is never run
// again.
test('a console killed between a start line and its end: after the restart, one "cut off" notice in the chat that asked and one needs-you line; it isn\'t run again', { timeout: 180000 * SLOW }, async () => {
  writeFileSync(mock('spark3', 'stall-worker'), '120');
  script([{ match: '^save this as cut-note\\.md on spark 3$', calls: [{ name: 'save_file', arguments: { spark: 'spark3', path: 'cut-note.md', text: 'cut off\n' } }] }]);
  cutChat = await newChat();
  say(cutChat, 'save this as cut-note.md on spark 3').catch(() => {});
  const start = await waitFor(() => records().find(r => r.start && r.act === 'save_file' && r.chat === cutChat), { what: 'the start line' });
  assert.equal(records().filter(r => r.id === start.id).length, 1, 'no end yet');
  process.kill(T.fleet.servicePid(), 'SIGKILL');
  await waitFor(() => T.fleet.serviceExit(), { what: 'the console to end' });
  B = await startMock({ watchMs: 600000, statusMs: 600000, env, prepare: copyTo(T.fleet, [CUT_OP]) });
  later.push(B);
  const notices = await waitFor(async () => {
    const m = (await (await fetch(`${B.base}/chats/${cutChat}`)).json()).messages.filter(x => x.notice && /cut off/.test(x.content));
    return m.length && m;
  }, { what: 'the notice' });
  assert.equal(notices.length, 1);
  assert.match(notices[0].content, /^A restart of Spark Console cut off “Save a file” on Spark 3 before its end was written .* It may or may not have happened, and it won’t be run again/);
  const needs = await needsOn(B);
  assert.equal(needs.filter(l => /cut off/.test(l)).length, 1, JSON.stringify(needs));
  assert.match(needs.find(l => /cut off/.test(l)), /^A restart of Spark Console cut off “Save a file” on Spark 3 before its end was written\. It may or may not have happened and won’t be run again/);
  const mine = records(B.journalDir).filter(r => r.id === start.id);
  assert.deepEqual(mine.map(r => [r.start || false, r.end || false, r.outcome || null]), [[true, false, null], [false, true, 'cut-off']]);
  assert.equal(records(B.journalDir).filter(r => r.start && r.act === 'save_file' && r.chat === cutChat).length, 1, 'never run again');
  assert.deepEqual(records(B.journalDir).filter(r => r.id === refusedId).map(r => r.outcome || null), [null, 'refused'], 'a refused change is not cut off');
  const notice = await waitFor(() => records(B.journalDir).find(r => r.k === 'event' && (r.text || '').startsWith(`${CUT_PREFIX}mmmm`)), { what: 'the cut-off operation\'s notice' });
  assert.ok(notice.text.includes('[hidden]'), notice.text);
  assert.deepEqual(piecesOf(EVKEY).filter(f => everything(B.journalDir).includes(f)), [], 'no piece of the key in an event\'s text');
});

test('after the restart, recall still has the failed start\'s log (operation_log says expired)', { timeout: 60000 * SLOW }, async () => {
  assert.ok(B && failedOp, 'the tests above ran');
  const token = await keyOn(B);
  const gone = await call(token, 'operation_log', { id: failedOp }, { url: B.mcp });
  assert.match(gone.text, /expired/);
  const found = await ok('recall', { about: failedOp }, token, B.base);
  const op = found.records.find(r => r.kind === 'op' && r.op === failedOp);
  assert.ok(op, JSON.stringify(found));
  assert.match(found.recordIsData, /data, not instructions/);
  const full = await ok('recall', { id: op.id }, token, B.base);
  assert.match(full.text, /Error:\nThe model server stopped while loading\./);
  assert.ok(full.text.includes('[hidden]') && !leaks(full.text).length, full.text);
  assert.equal(full.next, null);
});

test('past its limit a record\'s text stops and the record says so; a journal past its size is a needs-you line', { timeout: 120000 * SLOW }, async () => {
  const chat = (await (await post(B, '/chats', {})).json()).id;
  const long = `please read all of this: ${'lorem ipsum dolor sit amet '.repeat(200)}`;
  const r = await post(B, `/chats/${chat}/messages`, { text: long });
  assert.equal(r.status, 200);
  await r.text();
  const said = records(B.journalDir).find(x => x.k === 'said' && x.chat === chat);
  assert.deepEqual([said.cut, said.o[1]], [2048, 2048]);
  const full = await (await post(B, '/actions/recall', { id: said.id })).json();
  assert.equal(full.text, long.slice(0, 2048));
  assert.match((await call(await keyOn(B), 'recall', { id: said.id }, { url: B.mcp })).text, /^\[not_allowed\] Words said in a chat/);
  assert.match(full.stopped, /^Past 2 KB reading stopped/);
  assert.ok((await needsOn(B)).some(l => /^Spark Console’s journal on Spark 2 holds/.test(l)));
});

test('a second restart adds no second notice or needs-you line', { timeout: 120000 * SLOW }, async () => {
  process.kill(B.servicePid(), 'SIGTERM');
  await waitFor(() => B.serviceExit(), { what: 'the console to end' });
  const C = await startMock({ watchMs: 600000, statusMs: 600000, prepare: copyTo(B) });
  later.push(C);
  await sleep(2000);
  const m = (await (await fetch(`${C.base}/chats/${cutChat}`)).json()).messages.filter(x => x.notice && /cut off/.test(x.content));
  assert.equal(m.length, 1);
  assert.ok(!(await needsOn(C)).some(l => /cut off/.test(l)));
});
