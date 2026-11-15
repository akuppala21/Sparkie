// Covers: pruning the runner's copy sets (A8; 21-copies-prune.mjs, 21-runner.mjs; R61). When a new set opens on a
// Spark, older ones there go: past the copies' size on that Spark (2 GB; 3.5 MB here, SPARK_CONSOLE_COPIES_BYTES),
// oldest first; all but the newest 20; any older than 7 days. One journal line names each set that went, why, and the
// owner's files it held. Never a set whose change still runs (its unit is live), nor the newest set of a chat that can
// still undo it; once its unit has ended, a set that is no chat's to undo goes. A pruned set keeps its manifest, so an
// undo that comes to it (after the chat's model change was undone first) says, file by file, that its copy was pruned;
// /undo, the owner's word, says the same.
// Ages are the sets' folder times, set here as they would be days later. The stand-in fleet with the real root helper
// set up for Spark 3 (test/rehearsal.mjs), as in runner.test.mjs. Linux only: run it on a Spark.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync, readdirSync, statSync, utimesSync, realpathSync, openSync, readSync, closeSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { T, useFleet, api, newChat, say, waitFor, sleep, SLOW } from './lib.mjs';
import { rehearse } from './rehearsal.mjs';

const SECONDS = 20, RADIX = 'sc-RadixArk--Qwen3.8-27B-NVFP4';
// (run reaches the runner through its ladder, A7c: the owner's own call, or chat words that ask for work on Spark 3,
// starting in ~ as these commands are written; the tailnet is read every second)
useFleet({ knowledge: true, env: { SPARK_CONSOLE_RUN_SECONDS: String(SECONDS), SPARK_CONSOLE_CUT_SLACK: '1', SPARK_CONSOLE_COPIES_BYTES: String(3.5 * 2 ** 20), SPARK_CONSOLE_ROUTE_MS: '1000' },
  prepare: ({ root }) => {
    rehearse(root, 'spark3', { run: true });
    const h = join(root, 'spark3');
    for (const [p, data] of [['notes/x1.txt', 'x1 before\n'], ['notes/x2.txt', 'x2 before\n'], ['notes/p1.txt', 'p1 before\n']]) {
      mkdirSync(dirname(join(h, p)), { recursive: true });
      writeFileSync(join(h, p), data);
    }
  } }, async () => {
  // (no change runs at once until the console has read the tailnet, A7c: two looks after a request, which gave it the
  // Sparks' addresses)
  const looks = () => (existsSync(join(T.fleet.dir, 'tailscale-calls')) ? readFileSync(join(T.fleet.dir, 'tailscale-calls'), 'utf8').split('\n').filter(l => l === 'status --json').length : 0);
  await api('/health');
  const n = looks();
  await waitFor(() => looks() >= n + 2, { what: 'two looks at the tailnet after a request' });
  await sleep(300);
});

const H3 = () => join(T.fleet.root, 'spark3'), at3 = p => join(H3(), p), text = p => readFileSync(at3(p), 'utf8');
const BEFORE = () => at3('.local/share/spark-console/before'), setDir = n => join(BEFORE(), n);
const isSet = n => /^s[0-9a-z]{8,24}$/.test(n);
// The sets on Spark 3 that still hold copies; a pruned one (its manifest and a pruned.json left, its copies gone).
const live = () => readdirSync(BEFORE()).filter(n => isSet(n) && !existsSync(join(setDir(n), 'pruned.json')));
const pruned = n => existsSync(join(setDir(n), 'pruned.json')) && existsSync(join(setDir(n), 'manifest.json')) && !existsSync(join(setDir(n), 'files'));
const intact = n => existsSync(join(setDir(n), 'files')) && !existsSync(join(setDir(n), 'pruned.json'));
// A set's folder dated days ago (a set's age is its folder's time).
const age = (n, days) => { const t = new Date(Date.now() - days * 86400000); utimesSync(setDir(n), t, t); };
let seq = 0;
// A set as the copies program leaves one, made here: one file of bytes, a manifest naming it, dated days ago.
function fake({ days = 0, bytes = 0 } = {}) {
  const n = `sfake${String(seq++).padStart(6, '0')}${Math.random().toString(16).slice(2, 8).padEnd(6, '0')}`;
  mkdirSync(join(setDir(n), 'files'), { recursive: true, mode: 0o700 });
  writeFileSync(join(setDir(n), 'files', '0'), Buffer.alloc(bytes));
  writeFileSync(join(setDir(n), 'manifest.json'), JSON.stringify({ set: n, entries: [{ path: `${realpathSync(H3())}/notes/fake-${n}.txt`, kind: 'file', mode: 420, size: bytes, sha: '0'.repeat(64), n: 0 }], notKept: [], allow: [] }));
  age(n, days);
  return n;
}
const run = command => api('/actions/run', { method: 'POST', body: { on: 'spark3', command, dir: '~' } });
const lines = file => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const records = () => readdirSync(T.fleet.journalDir).filter(f => f.endsWith('.jsonl')).sort().flatMap(f => lines(join(T.fleet.journalDir, f))).filter(r => r.k === 'cmd');
const prunes = () => records().filter(r => r.act === 'prune');
function recordText(r) {
  const fd = openSync(join(T.fleet.journalDir, `journal-${r.at.slice(0, 7)}.out`), 'r'), buf = Buffer.alloc(r.o[1]);
  try { readSync(fd, buf, 0, r.o[1], r.o[0]); } finally { closeSync(fd); }
  return buf.toString();
}
const setOf = command => records().find(r => r.start && r.act === 'run' && r.args?.command === command)?.set;
// Sparkie's chat, its brain the stand-in: one scripted call for these words, and what that tool answered.
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
async function inChat(chat, words, name, args = {}) {
  script([{ match: `^${words}$`, calls: [{ name, arguments: args }] }]);
  try { await say(chat, words); } finally { rmSync(join(T.fleet.dir, 'model-script.json'), { force: true }); }
  const sent = lines(join(T.fleet.dir, 'model-requests.jsonl')).filter(x => x.words === words && x.lastRole === 'tool').at(-1)?.results?.[0]?.content;
  assert.ok(typeof sent === 'string', words);
  return sent.startsWith('[error] ') ? { error: sent.slice(8) } : { value: JSON.parse(sent) };
}
const finished = op => waitFor(async () => { const j = (await api(`/jobs/${op}`)).json; return j?.status !== 'running' && j; }, { timeout: 180000 * SLOW, what: `operation ${op}` });

test('past the copies\' size on a Spark (3.5 MB here) the oldest sets go first, until the rest fit; one journal line names each, why, and the files it held', { timeout: 120000 * SLOW }, async () => {
  mkdirSync(BEFORE(), { recursive: true, mode: 0o700 });
  // (five sets of 1 MB, the first the oldest)
  const big = [0, 1, 2, 3, 4].map(i => fake({ days: (5 - i) * 1e-4, bytes: 2 ** 20 }));
  const r = await run('echo size > notes/x1.txt');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.ran, true, r.text);
  assert.deepEqual(big.map(pruned), [true, true, false, false, false]);
  assert.ok(intact(r.json.set), 'the new set');
  const [line] = prunes();
  assert.deepEqual(line.pruned, [big[0], big[1]].map(set => ({ set, why: 'past the 3.5 MB the copies on this Spark keep', files: 1, bytes: 2 ** 20 })));
  assert.deepEqual([line.args, line.outcome, line.class], [{ spark: 'spark3' }, 'pruned', 'prune']);
  assert.match(recordText(line), new RegExp(`^${big[0]} \\(past the 3\\.5 MB the copies on this Spark keep\\): 1 file, [^\\n]+\\n  ~/notes/fake-${big[0]}\\.txt\\n`));
});

test('all but the newest 20 sets on a Spark go when a new one opens (the new one counts)', { timeout: 120000 * SLOW }, async () => {
  for (let i = 0; i < 20; i++) fake({ days: (20 - i) * 1e-5 });
  const before = live().map(n => [statSync(setDir(n)).mtimeMs, n]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
  assert.ok(before.length > 20, String(before.length));
  const r = await run('echo count > notes/x2.txt');
  assert.equal(r.json?.ran, true, r.text);
  assert.deepEqual(before.filter(pruned), before.slice(19), 'the new one and the 19 newest stay');
  assert.deepEqual(before.slice(0, 19).filter(n => !intact(n)), []);
  assert.deepEqual(prunes().at(-1).pruned.map(p => [p.set, p.why]).sort(), before.slice(19).map(n => [n, 'past the newest 20 sets on this Spark']).sort());
  assert.equal(live().length, 20);
});

test('past 7 days a set goes, but never one whose change still runs nor the newest set of a chat that can still undo it; once its unit ends, a set no chat can undo goes', { timeout: 300000 * SLOW }, async () => {
  const chat = await newChat();
  const one = await inChat(chat, 'first change on spark 3', 'run', { on: 'spark3', command: 'echo one > notes/x1.txt', dir: '~' });
  const two = await inChat(chat, 'second change on spark 3', 'run', { on: 'spark3', command: 'echo two > notes/x2.txt', dir: '~' });
  assert.ok(one.value?.set && two.value?.set, JSON.stringify([one, two]));
  // A change cut off while its unit lives on (the connection drops as it starts; the command runs on), here past its
  // time limit too (a systemd that failed to end it: the stand-in's past-limit). A new change opens a set beside one
  // whose change may still run only once the console's hold on Spark 3 has ended (A7c), below.
  const drops = join(H3(), '.mock', 'sudo-drops'), command = 'echo live > notes/live.txt && sleep 40 && touch notes/live-done';
  const pastLimit = join(H3(), '.rehearsal', 'standin', 'past-limit');
  writeFileSync(drops, '');
  writeFileSync(pastLimit, '');
  let cut;
  try { cut = await run(command); } finally { rmSync(drops, { force: true }); }
  assert.equal(cut.status, 503, cut.text);
  const running = setOf(command), unit = records().find(r => r.start && r.set === running)?.unit;
  await waitFor(() => existsSync(at3('notes/live.txt')), { every: 100, what: 'the cut-off change to start' });
  const old = fake({ days: 8 });
  for (const n of [one.value.set, two.value.set, running]) age(n, 8);
  assert.ok(existsSync(join(H3(), '.rehearsal', 'standin', 'live', unit)), 'its unit still runs');
  rmSync(pastLimit, { force: true });
  // (the hold asks the root helper, state --id, and stays while it says the call runs. With its mark of the call lost,
  // as a Spark's restart or the helper's own sweep loses it, it says "unknown": the hold then ends once the call's time
  // limit and the 6 s systemd is given to stop it have passed, though the unit still runs, and the guard here keeps its
  // set)
  rmSync(join(H3(), '.rehearsal', 'run', 'spark-console', '.calls', unit.slice('sw-run-'.length)), { force: true });
  const started = Date.parse(records().find(r => r.start && r.set === running).at);
  await sleep(Math.max(0, started + (SECONDS + 6) * 1000 + 3000 - Date.now()));
  const r = await run('echo week > notes/week.txt');
  assert.equal(r.json?.ran, true, r.text);
  assert.ok(existsSync(join(H3(), '.rehearsal', 'standin', 'live', unit)), 'its unit still ran while the set opened');
  assert.deepEqual([pruned(old), pruned(one.value.set), intact(two.value.set), intact(running)], [true, true, true, true]);
  const line = prunes().at(-1);
  for (const n of [old, one.value.set]) assert.ok(line.pruned.some(p => p.set === n && p.why === 'older than 7 days'), JSON.stringify(line.pruned));
  // Once the unit has ended, the cut-off change's set is no chat's to undo, and the next set takes it.
  await waitFor(() => existsSync(at3('notes/live-done')) && !existsSync(join(H3(), '.rehearsal', 'standin', 'live', unit)), { timeout: 60000 * SLOW, what: 'its unit to end' });
  // (and the helper to say so: its own mark of the call, "ended", which the guard asks for)
  const callMark = join(H3(), '.rehearsal', 'run', 'spark-console', '.calls', unit.slice('sw-run-'.length));
  await waitFor(() => existsSync(callMark) && readFileSync(callMark, 'utf8').startsWith('ended'), { what: 'the helper\'s mark of its end' });
  const again = await run('echo again > notes/week.txt');
  assert.equal(again.json?.ran, true, again.text);
  assert.deepEqual([pruned(running), intact(two.value.set)], [true, true]);
});

test('undo that comes to a pruned set says, file by file, that its copy was pruned, and puts nothing back', { timeout: 600000 * SLOW }, async () => {
  const chat = await newChat();
  const change = await inChat(chat, 'change p on spark 3', 'run', { on: 'spark3', command: 'echo p changed > notes/p1.txt', dir: '~' });
  assert.ok(change.value?.set, JSON.stringify(change));
  // Then a model change in the same chat: its undo comes first, so the set is not this chat's to undo now.
  const stop = await inChat(chat, `stop ${RADIX} on spark 4`, 'stop_model', { spark: 'spark4', container: RADIX });
  assert.ok(stop.value?.operation, JSON.stringify(stop));
  assert.equal((await finished(stop.value.operation)).status, 'completed');
  age(change.value.set, 8);
  const r = await run('echo prune > notes/x1.txt');
  assert.equal(r.json?.ran, true, r.text);
  assert.ok(pruned(change.value.set), 'pruned: the chat could not undo it then');
  // The model change is undone first; the next undo comes to the pruned set.
  const first = await inChat(chat, 'undo that', 'undo_last_change');
  assert.ok(first.value?.operation, JSON.stringify(first));
  assert.equal((await finished(first.value.operation)).status, 'completed');
  const undo = await inChat(chat, 'undo again', 'undo_last_change');
  const v = undo.value;
  assert.equal(v?.outcome, 'pruned', undo.error || JSON.stringify(v));
  assert.deepEqual(v.restored, []);
  assert.deepEqual(v.notRestored.filter(x => x.path.startsWith('~/notes/')), [{ path: '~/notes/p1.txt', why: `pruned: its copy was removed on ${v.pruned.at} (older than 7 days)` }]);
  assert.match(v.note, new RegExp(`^Nothing was put back on Spark 3: the copies of that change were pruned on ${v.pruned.at} \\(older than 7 days\\)\\. Not put back: \\d+ \\(each says why\\)\\.$`));
  assert.equal(text('notes/p1.txt'), 'p changed\n');
  const end = records().filter(x => x.act === 'undo_last_change' && x.end && x.set === change.value.set).at(-1);
  assert.equal(end?.outcome, 'pruned');
});

// /undo, the owner's word (A7c), where A8 meets it: it answers with undo_last_change's own words for a pruned set.
test('/undo, the owner\'s word, says of a pruned set what undo_last_change says: nothing put back, and why', { timeout: 600000 * SLOW }, async () => {
  const chat = await newChat();
  const change = await inChat(chat, 'change p again on spark 3', 'run', { on: 'spark3', command: 'echo p again > notes/p1.txt', dir: '~' });
  assert.ok(change.value?.set, JSON.stringify(change));
  const stop = await inChat(chat, `stop ${RADIX} on spark 4`, 'stop_model', { spark: 'spark4', container: RADIX });
  assert.ok(stop.value?.operation, JSON.stringify(stop));
  assert.equal((await finished(stop.value.operation)).status, 'completed');
  age(change.value.set, 8);
  const r = await run('echo prune again > notes/x2.txt');
  assert.equal(r.json?.ran, true, r.text);
  assert.ok(pruned(change.value.set), 'pruned: the chat could not undo it then');
  const first = await inChat(chat, 'undo that', 'undo_last_change');
  assert.equal((await finished(first.value.operation)).status, 'completed');
  const word = await say(chat, '/undo');
  assert.match(word.text, /^\/undo\nNothing was put back on Spark 3: the copies of that change were pruned on [^\n]+ \(older than 7 days\)\. Not put back: \d+ \(each says why\)\.$/);
  assert.equal(text('notes/p1.txt'), 'p again\n');
  const end = records().filter(x => x.act === 'undo_last_change' && x.end && x.set === change.value.set).at(-1);
  assert.equal(end?.outcome, 'pruned');
});
