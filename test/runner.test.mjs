// Covers: the runner for a change on a compute Spark (21-runner.mjs, 21-copies.mjs; R55, R13, R43; design A 2.8 and
// 2.13, step A7b), through run: the owner's own call (POST /actions/run) and the owner's chat runs a plain change at once.
// The copies first (bytes, mode and path; 16 MB a file and 128 MB a command; names that are hard to quote; links out
// of the home or planted among the copies), the journal's start line before the unit and its end line after, the run
// wall's time limit and exit codes, one change per Spark, the ways-in check (put back, paused, told), keys masked, a
// change a restart cut off, and undo_last_change putting a set back file by file.
// The stand-in fleet, with the real root helper set up and proven for Spark 3 (test/rehearsal.mjs: its home held by
// the run wall, and the command started there), driven by the stand-ins in test/mock/bin (sudo's rehearsal case;
// systemd-run, which ends a run unit at its time limit with everything it started; systemctl, unshare, setpriv). They
// build no wall: a command runs unwalled, as the owner, and the unit's settings show what a wall would hold.
// Linux only (GNU coreutils, bash 4 or newer): run it on a Spark with tools/test-on-spark.sh.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync, realpathSync, symlinkSync, readdirSync, renameSync,
  lstatSync, statSync, openSync, readSync, closeSync, truncateSync, cpSync, unlinkSync, utimesSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { T, useFleet, api, call, createActKey, newChat, say, waitFor, sleep, agentSettings, SLOW } from './lib.mjs';
import { startMock } from './start-mock.mjs';
import { rehearse } from './rehearsal.mjs';

// Made-up keys, shaped like a Hugging Face token.
const KEY = 'hf_Rq4Lm8Tz2Wx6Kc9Vb3Np7Hd1Fs5Gy0Ja', KEY2 = 'hf_Wd7Pk2Nx5Tq9Lb4Zm8Rc1Hv6Gs3Fj0Ye';
const SECONDS = 6;
const sha = b => createHash('sha256').update(b).digest('hex');
const BYTES = Buffer.from([...Array(256).keys()]);
const KEYS_LINE = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIStandIn owner@mac\n';
const later = [];
after(async () => { for (const f of later) await f.stop().catch(() => {}); });
const keys = {};
// (a cut-off set counts as its change's for the time limit and a second, not a minute: CUT)
const CUT = 1;
useFleet({ env: { SPARK_CONSOLE_RUN_SECONDS: String(SECONDS), SPARK_CONSOLE_CUT_SLACK: String(CUT) },
  prepare: ({ root }) => {
    rehearse(root, 'spark3', { run: true });
    const h = join(root, 'spark3'), out = join(root, 'outside-spark3');
    const put = (p, data, mode = 0o644) => { mkdirSync(dirname(join(h, p)), { recursive: true }); writeFileSync(join(h, p), data); chmodSync(join(h, p), mode); };
    put('notes/a.txt', 'old a\n', 0o640);
    put('notes/old.txt', 'old file\n');
    put('notes/b.txt', 'b before\n');
    put('notes/tree/with space.txt', 'space\n');
    put('notes/tree/-dash.txt', 'dash\n', 0o600);
    put('notes/tree/line\nbreak.txt', 'break\n');
    put('notes/tree/..dots', 'dots\n');
    put('notes/tree/sub/inner.txt', 'inner\n');
    chmodSync(join(h, 'notes/tree/sub'), 0o750);
    put('dots.txt', 'dots before\n');
    put('notes/r.txt', BYTES, 0o604);
    put('notes/s.txt', 'before s\n', 0o600);
    put('notes/p.txt', 'before p\n');
    put('notes/q.txt', 'before q\n');
    put('notes/r[1].txt', 'bracket\n');
    put('notes/r1.txt', 'plain one\n');
    put('notes/cpa.txt', 'cpa\n');
    put('notes/cpb.txt', 'cpb\n', 0o640);
    put('notes/h.txt', 'h before\n');
    put('notes/cut.txt', 'cut before\n');
    put('notes/cut2.txt', 'cut2 before\n');
    put('notes/live.txt', 'live before\n');
    put('p1/1.txt', 'it was 1\n');
    put('p1/b.txt', 'it was b\n');
    put('p1/a.txt', 'it was a\n');
    put('p2/1digit.txt', 'one\n');
    put('p2/adigit.txt', 'a digit\n');
    put('p3/[x]keep.txt', 'keep\n');
    put('data/one.csv', 'csv\n');
    put('p4/{a,b}.log', 'brace\n');
    put('p4/a.log', 'a log\n');
    for (let i = 0; i < 3000; i++) put(`notes/many2/f${i}.txt`, `${i}\n`);
    put('.ssh/authorized_keys', KEYS_LINE, 0o600);
    chmodSync(join(h, '.ssh'), 0o700);
    put('fix.sh', "printf 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOther other@else\\n' >> .ssh/authorized_keys\necho added\n", 0o755);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'target.txt'), 'outside\n');
    writeFileSync(join(out, 'f.txt'), 'outside f\n');
    symlinkSync(join(out, 'target.txt'), join(h, 'notes/out-link.txt'));
    symlinkSync(out, join(h, 'notes/linkdir'));
  } }, async () => {
  keys.act = await createActKey('runner-act');
  // (the console's first look at the tailnet, 1.5 s after it starts: until then no change runs at once, A7c)
  await waitFor(() => existsSync(join(T.fleet.dir, 'tailscale-calls')) && /^status --json$/m.test(readFileSync(join(T.fleet.dir, 'tailscale-calls'), 'utf8')), { what: 'the first look at the tailnet' });
  await sleep(500);
});

const H3 = () => join(T.fleet.root, 'spark3'), at3 = p => join(H3(), p), real = p => join(realpathSync(H3()), p);
const OUT = () => join(T.fleet.root, 'outside-spark3');
const text = p => readFileSync(at3(p), 'utf8');
const modeOf = p => lstatSync(p).mode & 0o7777;
const BEFORE = () => at3('.local/share/spark-console/before');
const sets = () => (existsSync(BEFORE()) ? readdirSync(BEFORE()).sort() : []);
const manifestOf = set => JSON.parse(readFileSync(join(BEFORE(), set, 'manifest.json'), 'utf8'));
const copyOf = (set, p) => { const e = manifestOf(set).entries.find(x => x.path === real(p)); return e && { ...e, bytes: e.kind === 'file' ? readFileSync(join(BEFORE(), set, 'files', String(e.n))) : null }; };
// (a change starts in ~ here, as these tests were written: the default is ~/work, A7c)
const run = (command, on = 'spark3') => api('/actions/run', { method: 'POST', body: { on, command, dir: '~' } });
const lines = file => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const files = dir => (existsSync(dir) ? readdirSync(dir).sort() : []);
// The journal's records about commands (its lines of kind cmd), and all its text.
const records = (dir = T.fleet.journalDir) => files(dir).filter(f => f.endsWith('.jsonl')).flatMap(f => lines(join(dir, f))).filter(r => r.k === 'cmd');
const everything = (dir = T.fleet.journalDir) => files(dir).map(f => readFileSync(join(dir, f), 'utf8')).join('\n');
// A command's start line (found by its command) and its end line (the same id).
function pair(command, dir) {
  const all = records(dir), s = all.find(r => r.start && r.act === 'run' && r.args?.command === command);
  return [s, s && all.find(r => r.end && r.id === s.id)];
}
function recordText(r, dir = T.fleet.journalDir) {
  const fd = openSync(join(dir, `journal-${r.at.slice(0, 7)}.out`), 'r'), buf = Buffer.alloc(r.o[1]);
  try { readSync(fd, buf, 0, r.o[1], r.o[0]); } finally { closeSync(fd); }
  return buf.toString();
}
// The run wall's units the helper asked systemd for (the rehearsal's own record).
const units = () => lines(join(H3(), '.rehearsal', 'calls.log')).filter(c => c[0] === 'systemd-run' && c.some(a => /^--unit=sw-run-/.test(a)));
// Sparkie's chat, its brain the stand-in: a script says which tool it calls for which words; what the tool answered is
// read in the next request the brain was sent (the whole result).
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const noScript = () => rmSync(join(T.fleet.dir, 'model-script.json'), { force: true });
async function inChat(chat, words, name, args = {}) {
  script([{ match: `^${words}$`, calls: [{ name, arguments: name === 'run' ? { dir: '~', ...args } : args }] }]);
  let r;
  try { r = await say(chat, words); } finally { noScript(); }
  const sent = lines(join(T.fleet.dir, 'model-requests.jsonl')).filter(x => x.words === words && x.lastRole === 'tool').at(-1)?.results?.[0]?.content;
  assert.ok(typeof sent === 'string', JSON.stringify(r.tools));
  return { tool: r.tools[0], value: sent.startsWith('[error] ') ? null : JSON.parse(sent), error: sent.startsWith('[error] ') ? sent.slice(8) : null };
}
const alive = pid => { try { return !/\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return false; } };

test('the runner refuses Spark 2, root, the root helper and anything but a plain change, whatever its caller says, before it takes the claim or copies anything', { timeout: 60000 * SLOW }, async () => {
  const u = units().length, s = sets().length;
  const hub = await run('echo new > notes/a.txt', 'spark2');
  assert.equal(hub.status, 403, hub.text);
  assert.equal(hub.json.error, 'Spark 2 runs Spark Console and the brain: a change there is always asked first, and the runner never runs one.');
  const root = await run('sudo touch notes/x.txt');
  assert.equal(root.status, 403, root.text);
  assert.equal(root.json.error, 'A change as root waits for the put-back net, which isn’t built yet, so nothing ran.');
  const helper = await run('bash ~/spark-console-src/deploy/root-for-sparkie.sh 3');
  assert.equal(helper.status, 403, helper.text);
  assert.match(helper.json.error, /^It calls the root helper or its sudo line/);
  const risky = await run('rm notes/*.tmp');
  assert.equal(risky.status, 409, risky.text);
  assert.equal(risky.json.error, 'That is not a plain change (the sorter calls it risky), so the runner didn’t run it.');
  assert.equal(units().length, u, 'no unit');
  assert.equal(sets().length, s, 'no copies');
  assert.ok(!existsSync(at3('notes/x.txt')));
  assert.equal(text('notes/a.txt'), 'old a\n');
  assert.deepEqual(records(), [], 'no journal line: nothing began');
});

test('the copies come first: a file\'s bytes, mode and path before it is overwritten or removed, in a set of its own (folder 0700, files 0600) that the start line names; a unit that never starts leaves the copy and changes nothing', { timeout: 120000 * SLOW }, async () => {
  const r = await run('echo new > notes/a.txt');
  assert.equal(r.status, 200, r.text);
  const v = r.json;
  assert.deepEqual([v.ran, v.change, v.outcome, v.exit, v.where, v.root], [true, true, 'change', 0, 'Spark 3', false], r.text);
  assert.match(v.set, /^s[0-9a-z]{8,24}$/);
  assert.match(v.record, /^j_[0-9a-f]{12}$/);
  assert.equal(v.kept, v.record, 'kept names the start and end record (one id)');
  assert.equal(v.tail, 'exit 0');
  assert.ok(!('putBack' in v), 'no way in changed');
  assert.equal(v.copied, 1, 'the one file of its own it keeps (the ways in, marks and folders are not counted)');
  assert.equal(v.notCovered, 'Put-back covers only the files counted in copied: anything else it wrote (a program’s own writes, a file the sorter could not place) isn’t copied first.');
  assert.equal(text('notes/a.txt'), 'new\n');
  const dir = join(BEFORE(), v.set), c = copyOf(v.set, 'notes/a.txt');
  assert.deepEqual([c.kind, c.mode, c.size, c.sha], ['file', 0o640, 6, sha('old a\n')]);
  assert.equal(c.bytes.toString(), 'old a\n');
  for (const d of [BEFORE(), dir, join(dir, 'files')]) assert.equal(modeOf(d), 0o700, d);
  for (const f of ['manifest.json', join('files', String(c.n))]) assert.equal(modeOf(join(dir, f)), 0o600, f);
  const [start, end] = pair('echo new > notes/a.txt');
  assert.deepEqual([start.class, start.where, start.root, start.set, start.sha], ['change', 'host', false, v.set, sha(readFileSync(join(dir, 'manifest.json')))]);
  assert.match(start.unit, /^sw-run-[0-9a-f]{24}$/);
  assert.deepEqual([end.ok, end.outcome, end.exit, end.unit, end.set], [true, 'ran', 0, start.unit, v.set]);
  assert.equal(recordText(end), '$ echo new > notes/a.txt\n');
  const unit = units().find(x => x.includes(`--unit=${start.unit}`));
  assert.ok(unit, 'the run wall\'s unit');
  assert.ok(unit.includes(`RuntimeMaxSec=${SECONDS}`) && unit.includes('MemoryMax=8G'), JSON.stringify(unit));
  // The copies are made by the console's own call, outside the unit; inside it their folder is an empty read-only one
  // (the stand-ins build no wall: what the unit is asked to be is what shows it).
  assert.ok(unit.includes('TemporaryFileSystem=/spark3/.local/share/spark-console:ro'), JSON.stringify(unit));
  // A removal: the copy holds the file.
  const gone = await run('rm notes/old.txt');
  assert.equal(gone.status, 200, gone.text);
  assert.ok(!existsSync(at3('notes/old.txt')));
  assert.equal(copyOf(gone.json.set, 'notes/old.txt').bytes.toString(), 'old file\n');
  // systemd refuses the unit: the copy and the start line are there, and nothing changed.
  const refuse = join(H3(), '.rehearsal', 'standin', 'refuse'), u = units().length;
  writeFileSync(refuse, 'sw-run-');
  let x;
  try { x = await run('echo changed > notes/b.txt'); } finally { rmSync(refuse, { force: true }); }
  assert.equal(x.status, 200, x.text);
  assert.equal(x.json.exit, 1, x.text);
  assert.match(x.json.output, /Failed to start transient service unit/);
  assert.equal(text('notes/b.txt'), 'b before\n');
  assert.equal(copyOf(x.json.set, 'notes/b.txt').bytes.toString(), 'b before\n');
  assert.equal(units().length, u + 1, 'asked for, and refused');
  assert.equal(pair('echo changed > notes/b.txt')[0].set, x.json.set);
});

test('a file over 16 MB, or past the 128 MB one command keeps, is not kept and the result says which; a command that removes or overwrites one runs nothing', { timeout: 180000 * SLOW }, async () => {
  const sparse = (p, size) => { mkdirSync(dirname(at3(p)), { recursive: true }); writeFileSync(at3(p), ''); truncateSync(at3(p), size); };
  sparse('notes/big/huge.bin', 16 * 2 ** 20 + 1);
  sparse('notes/many/huge.bin', 17 * 2 ** 20);
  for (let i = 0; i < 9; i++) sparse(`notes/many/part-${i}.bin`, 16 * 2 ** 20);
  // touch changes it without removing it: it runs, and says what wasn't kept.
  const t = await run('touch notes/big/huge.bin');
  assert.equal(t.status, 200, t.text);
  assert.equal(t.json.ran, true);
  assert.deepEqual(t.json.notKept, [{ path: '~/notes/big/huge.bin', why: 'over 16 MB' }]);
  assert.equal(copyOf(t.json.set, 'notes/big/huge.bin'), undefined);
  // rm -r would remove two files no copy holds: nothing runs, and the set made for it is gone.
  const before = sets(), u = units().length;
  const rm = await run('rm -r notes/many');
  assert.equal(rm.status, 200, rm.text);
  assert.equal(rm.json.ran, false, rm.text);
  assert.equal(rm.json.why, 'It removes or overwrites files, and 2 of them couldn’t be copied first (each says why), so nothing ran: what it removes couldn’t be put back.');
  assert.deepEqual(rm.json.notKept, [{ path: '~/notes/many/huge.bin', why: 'over 16 MB' }, { path: '~/notes/many/part-8.bin', why: 'past the 128 MB one change keeps' }]);
  assert.equal(readdirSync(at3('notes/many')).length, 10, 'nothing removed');
  assert.deepEqual(sets(), before);
  assert.equal(units().length, u, 'no unit');
  assert.equal(pair('rm -r notes/many')[0], undefined, 'no start line');
  rmSync(at3('notes/many'), { recursive: true, force: true });
  rmSync(at3('notes/big'), { recursive: true, force: true });
});

test('names with a space, a leading dash, a line break or two dots are copied and put back exactly; a link out of the home, or one planted among the copies, is never written through', { timeout: 180000 * SLOW }, async () => {
  const tree = { 'with space.txt': ['space\n', 0o644], '-dash.txt': ['dash\n', 0o600], 'line\nbreak.txt': ['break\n', 0o644], '..dots': ['dots\n', 0o644], 'sub/inner.txt': ['inner\n', 0o644] };
  const chat = await newChat();
  const ran = await inChat(chat, 'clean up the tree on spark 3', 'run', { on: 'spark3', command: 'rm -r notes/tree && echo z > notes/../dots.txt' });
  assert.equal(ran.value?.ran, true, ran.error);
  assert.ok(!existsSync(at3('notes/tree')));
  assert.equal(text('dots.txt'), 'z\n');
  assert.equal(copyOf(ran.value.set, 'dots.txt').bytes.toString(), 'dots before\n');
  for (const [n, [t]] of Object.entries(tree)) assert.equal(copyOf(ran.value.set, `notes/tree/${n}`).bytes.toString(), t, n);
  // what the page's line for it needs (A5): where, root as it ran, the record, the tail
  assert.deepEqual([ran.tool.where, ran.tool.root, ran.tool.kept, ran.tool.tail], ['Spark 3', false, ran.value.record, 'exit 0'], JSON.stringify(ran.tool));
  const undo = await inChat(chat, 'undo the tree', 'undo_last_change');
  assert.equal(undo.value?.outcome, 'restored', undo.error || JSON.stringify(undo.value));
  assert.deepEqual(undo.value.notRestored, []);
  for (const p of ['~/dots.txt', '~/notes/tree', '~/notes/tree/sub', ...Object.keys(tree).map(n => `~/notes/tree/${n}`)]) assert.ok(undo.value.restored.includes(p), p);
  assert.equal(text('dots.txt'), 'dots before\n');
  for (const [n, [t, m]] of Object.entries(tree)) { assert.equal(text(`notes/tree/${n}`), t, n); assert.equal(modeOf(at3(`notes/tree/${n}`)), m, n); }
  assert.equal(modeOf(at3('notes/tree/sub')), 0o750);
  // A link out of the home, named or in the folders above: what it points to can't be copied, so nothing runs.
  for (const [command, path, why] of [['echo evil > notes/out-link.txt', '~/notes/out-link.txt', 'a link: what it points to is not copied'],
    ['echo evil > notes/linkdir/f.txt', '~/notes/linkdir/f.txt', 'a link in the folders above it']]) {
    const r = await run(command);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.json.ran, r.json.notKept], [false, [{ path, why }]], r.text);
  }
  assert.deepEqual(readdirSync(OUT()).sort(), ['f.txt', 'target.txt']);
  assert.deepEqual([readFileSync(join(OUT(), 'target.txt'), 'utf8'), readFileSync(join(OUT(), 'f.txt'), 'utf8')], ['outside\n', 'outside f\n']);
  // The copies' own folder made a link out of the home: nothing is copied there, nothing runs, and the claim is let go.
  renameSync(BEFORE(), `${BEFORE()}.real`);
  symlinkSync(OUT(), BEFORE());
  let planted;
  try { planted = await run('echo planted > notes/c.txt'); } finally { unlinkSync(BEFORE()); renameSync(`${BEFORE()}.real`, BEFORE()); }
  assert.equal(planted.status, 409, planted.text);
  assert.equal(planted.json.error, 'The copies on Spark 3: ~/.local/share/spark-console/before is not a folder of this account (a link, or not a folder).');
  assert.ok(!existsSync(at3('notes/c.txt')));
  assert.deepEqual(readdirSync(OUT()).sort(), ['f.txt', 'target.txt']);
  assert.equal(pair('echo planted > notes/c.txt')[0], undefined, 'no start line');
  const next = await run('echo planted > notes/c.txt');
  assert.equal(next.status, 200, `the claim was let go after the throw: ${next.text}`);
  // A copy replaced by a link before the undo: that file is not put back (and what the link points to isn't read).
  const chat2 = await newChat();
  const p = await inChat(chat2, 'change p on spark 3', 'run', { on: 'spark3', command: 'echo new p > notes/p.txt' });
  assert.equal(p.value?.ran, true, p.error);
  const n = copyOf(p.value.set, 'notes/p.txt').n, file = join(BEFORE(), p.value.set, 'files', String(n));
  rmSync(file);
  symlinkSync(join(OUT(), 'target.txt'), file);
  const u2 = await inChat(chat2, 'undo p', 'undo_last_change');
  assert.equal(u2.value?.outcome, 'partly', u2.error || JSON.stringify(u2.value));
  assert.deepEqual(u2.value.notRestored, [{ path: '~/notes/p.txt', why: 'its copy is not a plain file any more' }]);
  assert.equal(text('notes/p.txt'), 'new p\n');
  assert.equal(readFileSync(join(OUT(), 'target.txt'), 'utf8'), 'outside\n');
  // A manifest changed since its start line: nothing is put back.
  const chat3 = await newChat();
  const q = await inChat(chat3, 'change q on spark 3', 'run', { on: 'spark3', command: 'echo new q > notes/q.txt' });
  assert.equal(q.value?.ran, true, q.error);
  const mf = join(BEFORE(), q.value.set, 'manifest.json'), m = JSON.parse(readFileSync(mf, 'utf8'));
  m.allow.push(OUT());
  m.entries.push({ path: join(OUT(), 'target.txt'), kind: 'file', mode: 0o644, size: 6, sha: sha('owned\n'), n: 99 });
  writeFileSync(mf, JSON.stringify(m));
  const u3 = await inChat(chat3, 'undo q', 'undo_last_change');
  assert.equal(u3.error, 'The copies on Spark 3: the record of that change\'s copies was changed since.', JSON.stringify(u3));
  assert.equal(text('notes/q.txt'), 'new q\n');
  assert.equal(readFileSync(join(OUT(), 'target.txt'), 'utf8'), 'outside\n');
});

test('the time limit ends the unit with everything it started; an exit code other than 0 is a result', { timeout: 120000 * SLOW }, async () => {
  const t0 = Date.now(), r = await run('sleep 30 & echo $! > notes/bg.pid; sleep 40');
  assert.equal(r.status, 200, r.text);
  assert.ok(Date.now() - t0 < (SECONDS + 8) * 1000, 'ended at its limit');
  assert.deepEqual([r.json.ran, r.json.exit], [true, null], r.text);
  assert.equal(r.json.ended, `It ran past its ${SECONDS} seconds and was ended, with everything it started.`);
  assert.equal(r.json.tail, 'ended before it finished (no exit code)');
  const pid = Number(text('notes/bg.pid'));
  assert.ok(pid > 1);
  await waitFor(() => !alive(pid), { timeout: 10000, what: 'what it started in the background to be gone' });
  const [, end] = pair('sleep 30 & echo $! > notes/bg.pid; sleep 40');
  assert.deepEqual([end.ok, end.outcome, end.exit], [true, 'ended', undefined]);
  const three = await run('touch notes/e.txt; exit 3');
  assert.equal(three.status, 200, three.text);
  assert.deepEqual([three.json.ran, three.json.exit, three.json.tail], [true, 3, 'exit 3'], three.text);
  assert.ok(existsSync(at3('notes/e.txt')));
  const [, end3] = pair('touch notes/e.txt; exit 3');
  assert.deepEqual([end3.ok, end3.outcome, end3.exit], [true, 'ran', 3]);
});

test('one change per Spark (R13): a change held by a model start does not run and says why; a model start held by a change is refused; the claim goes at every end', { timeout: 300000 * SLOW }, async () => {
  // A change holds Spark 3: a model start there is refused, naming it.
  const holding = run('touch notes/holding.txt; sleep 5');
  await waitFor(() => pair('touch notes/holding.txt; sleep 5')[0], { every: 100, what: 'the change\'s start line' });
  const refused = await call(keys.act.token, 'start_model', { model: 'gpt-oss-20b', spark: 'Spark 3' });
  assert.equal(refused.isError, true, refused.text);
  assert.match(refused.text, /^\[conflict(, retry later)?\] Something is already changing on Spark 3 \(a command Sparkie is running there\)\. Wait for it to finish\./);
  const h = await holding;
  assert.equal(h.status, 200, h.text);
  assert.equal(h.json.exit, 0);
  // That change has ended, so its claim is gone: the start goes ahead, and holds Spark 3 while docker run is slow.
  const slow = join(H3(), '.mock', 'slow-run');
  writeFileSync(slow, '12');
  let op;
  try {
    const x = await call(keys.act.token, 'start_model', { model: 'gpt-oss-20b', spark: 'Spark 3' });
    assert.equal(x.isError, false, x.text);
    assert.equal(x.value.outcome, 'started', x.text);
    op = x.value.operation;
    const s = sets().length, u = units().length;
    const r = await run('touch notes/while-starting.txt');
    assert.equal(r.status, 409, r.text);
    assert.match(r.json.error, /^Something is already changing on Spark 3 \(starting [^)]+\)\. Wait for it to finish\.$/);
    assert.ok(!existsSync(at3('notes/while-starting.txt')));
    assert.deepEqual([sets().length, units().length], [s, u], 'no copies, no unit');
    assert.equal(pair('touch notes/while-starting.txt')[0], undefined, 'no start line');
  } finally { rmSync(slow, { force: true }); }
  for (const until = Date.now() + 180000 * SLOW; ;) {
    const w = await call(keys.act.token, 'wait_operation', { id: op, seconds: 20 });
    assert.equal(w.isError, false, w.text);
    if (w.value.status !== 'running') { assert.equal(w.value.status, 'completed', w.text); break; }
    assert.ok(Date.now() < until, 'the start ended');
  }
  const after = await run('touch notes/while-starting.txt');
  assert.equal(after.status, 200, `the start's claim is gone: ${after.text}`);
});

test('a change that touches a way in: its copies are put back, Sparkie\'s and agents\' changes pause, and the owner is told what differed', { timeout: 120000 * SLOW }, async () => {
  const notices = () => lines(join(T.fleet.stateDir, 'events.jsonl')).filter(e => e.type === 'notice');
  const seen = notices().length;
  try {
    const r = await run('bash fix.sh');
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.ran, true);
    assert.match(r.json.output, /^added\n/);
    // (what the script writes is not the sorter's to place: none of it is counted as copied, and it says so)
    assert.equal(r.json.copied, 0);
    assert.equal(r.json.notCovered, 'Not covered by put-back: what a script or a program (an install, a build) writes on its own isn’t copied first, so undo can’t put that back.');
    assert.deepEqual(r.json.putBack, { differed: ['~/.ssh/authorized_keys'], restored: ['~/.ssh/authorized_keys'], notRestored: [] }, r.text);
    assert.equal(text('.ssh/authorized_keys'), KEYS_LINE);
    assert.equal(modeOf(at3('.ssh/authorized_keys')), 0o600);
    assert.equal((await api('/agents')).json.settings.halted, true);
    const told = notices().slice(seen).filter(e => /way in/.test(e.text));
    assert.equal(told.length, 1, JSON.stringify(told));
    assert.equal(told[0].text, `Agents’ changes were paused automatically: a change on Spark 3 (record ${r.json.record}) changed a way in: ~/.ssh/authorized_keys; what it had copied first is put back. Look at Activity, then resume them in your account menu → Agents and Telegram.`);
    const [, end] = pair('bash fix.sh');
    assert.deepEqual(end.putBack, ['~/.ssh/authorized_keys']);
    // Paused: the next change doesn't run, whoever asks.
    const next = await run('touch notes/paused.txt');
    assert.equal(next.status, 403, next.text);
    assert.equal(next.json.error, 'Sparkie’s and agents’ changes are paused (your account menu → Agents and Telegram), so nothing ran.');
    assert.ok(!existsSync(at3('notes/paused.txt')));
  } finally { await agentSettings({ halted: false }); }
});

test('a name holding [ ] is that file, copied before it is removed and put back by undo; a file the pattern matches is copied too, and left as it is', { timeout: 120000 * SLOW }, async () => {
  const chat = await newChat();
  const ran = await inChat(chat, 'clean up r one on spark 3', 'run', { on: 'spark3', command: "rm 'notes/r[1].txt'" });
  assert.equal(ran.value?.ran, true, ran.error || JSON.stringify(ran.value));
  assert.ok(!existsSync(at3('notes/r[1].txt')));
  assert.equal(copyOf(ran.value.set, 'notes/r[1].txt').bytes.toString(), 'bracket\n');
  assert.equal(copyOf(ran.value.set, 'notes/r1.txt').bytes.toString(), 'plain one\n');
  const undo = await inChat(chat, 'undo r one', 'undo_last_change');
  assert.equal(undo.value?.outcome, 'restored', undo.error || JSON.stringify(undo.value));
  assert.deepEqual([undo.value.restored, undo.value.notRestored], [['~/notes/r[1].txt'], []]);
  assert.deepEqual([text('notes/r[1].txt'), text('notes/r1.txt')], ['bracket\n', 'plain one\n']);
});

test('cp onto a file that is there runs: a path under a file is not there, not "unreadable"; undo puts the file back whole', { timeout: 120000 * SLOW }, async () => {
  const chat = await newChat();
  const ran = await inChat(chat, 'change cpb to cpa on spark 3', 'run', { on: 'spark3', command: 'cp notes/cpa.txt notes/cpb.txt' });
  assert.equal(ran.value?.ran, true, ran.error || JSON.stringify(ran.value));
  assert.deepEqual([ran.value.notKept, ran.value.copied], [[], 2], JSON.stringify(ran.value));
  assert.equal(text('notes/cpb.txt'), 'cpa\n');
  const undo = await inChat(chat, 'undo the copy', 'undo_last_change');
  assert.equal(undo.value?.outcome, 'restored', undo.error || JSON.stringify(undo.value));
  assert.deepEqual([undo.value.restored, undo.value.notRestored], [['~/notes/cpb.txt'], []]);
  assert.deepEqual([text('notes/cpb.txt'), modeOf(at3('notes/cpb.txt'))], ['cpb\n', 0o640]);
});

test('undo never puts back a set whose command did not run, nor, for a change cut off, a file written after its time', { timeout: 180000 * SLOW }, async () => {
  // The helper runs nothing (its sudo line gone): the owner's command, the set gone, and undo there finds nothing.
  const line = join(H3(), '.rehearsal', 'etc', 'sudoers.d', 'spark-console-root'), was = readFileSync(line);
  const before = sets(), chat = await newChat();
  let ran;
  rmSync(line);
  try { ran = await inChat(chat, 'edit h on spark 3', 'run', { on: 'spark3', command: 'echo attempt > notes/h.txt' }); } finally { writeFileSync(line, was); chmodSync(line, 0o440); }
  assert.equal(ran.value?.ran, false, ran.error || JSON.stringify(ran.value));
  assert.match(ran.value.why, /sudo line isn’t on Spark 3/);
  assert.deepEqual(sets(), before, 'the set made for it is gone');
  const [start, end] = pair('echo attempt > notes/h.txt');
  assert.deepEqual([end.ok, end.outcome, end.ran], [false, 'nosudo', false]);
  assert.ok(start.set);
  writeFileSync(at3('notes/h.txt'), 'by hand\n');
  const none = await inChat(chat, 'undo h', 'undo_last_change');
  assert.equal(none.value?.set, undefined, JSON.stringify(none));
  assert.equal(text('notes/h.txt'), 'by hand\n');
  // The Spark stops answering as the change starts (the connection drops; the command runs on): its end is unknown and
  // it has no after-look. A file of its set written later is left, and said; one as the change left it is put back.
  const drops = join(H3(), '.mock', 'sudo-drops'), chat2 = await newChat();
  // (the change dates a file it wrote years ahead: still its own, by the time it was changed)
  const command = 'echo cut > notes/cut.txt && echo cut > notes/cut2.txt && touch -d 2030-01-01 notes/cut2.txt && touch notes/cut-done';
  writeFileSync(drops, '');
  let cut;
  try { cut = await inChat(chat2, 'change the cut files on spark 3', 'run', { on: 'spark3', command }); } finally { rmSync(drops, { force: true }); }
  assert.match(cut.error || '', /^Spark 3 stopped answering while the change ran, so whether it finished is unknown/, JSON.stringify(cut));
  await waitFor(() => existsSync(at3('notes/cut-done')), { what: 'the change to finish on the Spark' });
  const [cs, ce] = pair(command);
  assert.equal(ce.outcome, 'unreachable');
  assert.ok(!existsSync(join(BEFORE(), cs.set, 'after.json')), 'no after-look');
  // Once its time is over, the owner puts a file of its set there, with an old date kept (as cp -p or mv would).
  const over = (manifestOf(cs.set).at + SECONDS + CUT + 1) * 1000;
  await waitFor(() => Date.now() > over, { every: 200, what: 'the change\'s time to run out' });
  writeFileSync(at3('notes/cut.txt'), 'by hand later\n');
  utimesSync(at3('notes/cut.txt'), new Date('2020-01-01'), new Date('2020-01-01'));
  const undo = await inChat(chat2, 'undo the cut', 'undo_last_change');
  assert.equal(undo.value?.outcome, 'partly', undo.error || JSON.stringify(undo.value));
  assert.ok(undo.value.restored.includes('~/notes/cut2.txt'), JSON.stringify(undo.value));
  const byPath = (x, y) => (x.path < y.path ? -1 : 1);
  assert.deepEqual(undo.value.notRestored.filter(x => x.path.startsWith('~/notes/')).sort(byPath), [{ path: '~/notes/cut-done', why: 'it was not there before the change: left as it is' },
    { path: '~/notes/cut.txt', why: 'written after that change\'s time ran out: left as it is' }].sort(byPath));
  assert.match(undo.value.note, /That change was cut off, so what it did is unknown\.$/);
  assert.deepEqual([text('notes/cut.txt'), text('notes/cut2.txt')], ['by hand later\n', 'cut2 before\n']);
});

test('undo is not done beside a change that still runs: a cut-off change whose unit lives on is refused, and put back once it has ended', { timeout: 120000 * SLOW }, async () => {
  const drops = join(H3(), '.mock', 'sudo-drops'), chat = await newChat(), command = 'echo live > notes/live.txt && sleep 5 && touch notes/live-done';
  writeFileSync(drops, '');
  let ran;
  try { ran = await inChat(chat, 'change live on spark 3', 'run', { on: 'spark3', command }); } finally { rmSync(drops, { force: true }); }
  assert.match(ran.error || '', /^Spark 3 stopped answering while the change ran/, JSON.stringify(ran));
  await waitFor(() => existsSync(at3('notes/live.txt')) && text('notes/live.txt') === 'live\n', { every: 100, what: 'the change to start' });
  const [start] = pair(command), live = join(H3(), '.rehearsal', 'standin', 'live', start.unit);
  assert.ok(existsSync(live), 'its unit runs');
  const early = await inChat(chat, 'undo live', 'undo_last_change');
  assert.equal(early.error, `The copies on Spark 3: that change is still running there (${start.unit}), so nothing was put back: ask again when it has ended.`, JSON.stringify(early));
  assert.equal(text('notes/live.txt'), 'live\n');
  await waitFor(() => existsSync(at3('notes/live-done')) && !existsSync(live), { what: 'its unit to end' });
  const undo = await inChat(chat, 'undo live again', 'undo_last_change');
  assert.ok(undo.value?.restored?.includes('~/notes/live.txt'), undo.error || JSON.stringify(undo.value));
  assert.equal(text('notes/live.txt'), 'live before\n');
});

test('a line the command prints as the helper would, then a dropped connection: the set is kept and nothing says it never ran', { timeout: 120000 * SLOW }, async () => {
  const drops = join(H3(), '.mock', 'sudo-drops'), chat = await newChat();
  const command = `printf '%s refused: x\\n' "$(basename "$(dirname "$0")")"; echo printed > notes/printed.txt`;
  writeFileSync(drops, 'first-line\n');
  let ran;
  try { ran = await inChat(chat, 'try printing refused on spark 3', 'run', { on: 'spark3', command }); } finally { rmSync(drops, { force: true }); }
  assert.match(ran.error || '', /^Spark 3 stopped answering while the change ran, so whether it finished is unknown/, JSON.stringify(ran));
  assert.doesNotMatch(ran.error, /Nothing ran/);
  await waitFor(() => existsSync(at3('notes/printed.txt')), { what: 'the command to have run' });
  const [start, end] = pair(command);
  assert.deepEqual([end.outcome, end.ran], ['unreachable', undefined]);
  assert.ok(existsSync(join(BEFORE(), start.set, 'manifest.json')), 'its set is kept');
  // (its end unknown, the Spark is held until the hold's next look finds the unit gone, every 2 s: the next test's
  // change waits for that)
  await waitFor(() => !existsSync(join(H3(), '.rehearsal', 'standin', 'live', start.unit)), { what: 'its unit to end' });
  await sleep(3000);
});

test('a change\'s time counts from the end of its copies: the manifest\'s time is after every copy was made', { timeout: 120000 * SLOW }, async () => {
  const r = await run('rm -r notes/many2');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.ran, true, r.text);
  assert.equal(r.json.copied, 3000);
  const dir = join(BEFORE(), r.json.set, 'files'), at = manifestOf(r.json.set).at * 1000;
  const last = Math.max(...readdirSync(dir).map(f => statSync(join(dir, f)).mtimeMs));
  assert.ok(at >= last, `the manifest's time ${at} is before the last copy ${last}`);
});

test('patterns as bash reads them ([^a], a class, a quoted [x]) and a quoted brace are copied first, and undo puts every file back', { timeout: 240000 * SLOW }, async () => {
  const cases = [
    ['sed -i.bak s/was/is/ p1/[^a]*.txt', { 'p1/1.txt': 'it was 1\n', 'p1/b.txt': 'it was b\n' }],
    ['echo new > p2/[^a]digit.txt', { 'p2/1digit.txt': 'one\n' }],
    ['echo teed | tee p2/[^a]digit.txt', { 'p2/1digit.txt': 'one\n' }],
    ['cp data/one.csv p2/[[:digit:]]digit.txt', { 'p2/1digit.txt': 'one\n' }],
    ["mv p3/'[x]'* data/", { 'p3/[x]keep.txt': 'keep\n' }],
    // (a quoted brace is the name as written: the sorter places it so, and that file is the one copied)
    ["echo new > 'p4/{a,b}.log'", { 'p4/{a,b}.log': 'brace\n' }],
  ];
  for (const [i, [command, files]] of cases.entries()) {
    const chat = await newChat();
    const ran = await inChat(chat, `change pattern ${i} on spark 3`, 'run', { on: 'spark3', command });
    assert.equal(ran.value?.ran, true, `${command}: ${ran.error || JSON.stringify(ran.value)}`);
    for (const [p, t] of Object.entries(files)) {
      assert.equal(copyOf(ran.value.set, p)?.bytes?.toString(), t, `${command}: the copy of ${p}`);
      assert.ok(!existsSync(at3(p)) || text(p) !== t, `${command} changed ${p}`);
    }
    const undo = await inChat(chat, `undo pattern ${i}`, 'undo_last_change');
    assert.ok(['restored', 'partly'].includes(undo.value?.outcome), `${command}: ${undo.error || JSON.stringify(undo.value)}`);
    for (const [p, t] of Object.entries(files)) assert.equal(text(p), t, `${command}: ${p} put back`);
  }
  assert.equal(text('p1/a.txt'), 'it was a\n');
  assert.equal(text('p2/adigit.txt'), 'a digit\n');
  assert.equal(text('p4/a.log'), 'a log\n');
});

test('a key in the command, or in what it printed, is masked in the result and the journal\'s lines', { timeout: 60000 * SLOW }, async () => {
  const command = `printf 'HF_TOKEN=%s' ${KEY} > notes/k.txt; cat notes/k.txt`;
  const r = await run(command);
  assert.equal(r.status, 200, r.text);
  assert.ok(!r.text.includes(KEY), r.text);
  assert.equal(r.json.output, 'HF_TOKEN=[hidden]');
  assert.equal(r.json.tail, 'HF_TOKEN=[hidden]\nexit 0');
  const masked = command.replace(KEY, '[hidden]'), [start, end] = pair(masked);
  assert.ok(start && end, 'its start and end lines, the command masked');
  assert.equal(recordText(end), `$ ${masked}\nHF_TOKEN=[hidden]`);
  assert.ok(!everything().includes(KEY), 'no journal file holds the key');
});

test('undo_last_change puts back the chat\'s last change file by file, exact bytes and mode, as a change with its own start and end lines; a file changed again since is left as it is, and said', { timeout: 120000 * SLOW }, async () => {
  const chat = await newChat();
  const command = 'echo changed > notes/r.txt && echo changed > notes/s.txt && chmod 600 notes/r.txt';
  const ran = await inChat(chat, 'change r and s on spark 3', 'run', { on: 'spark3', command });
  assert.equal(ran.value?.ran, true, ran.error);
  assert.deepEqual([text('notes/r.txt'), modeOf(at3('notes/r.txt'))], ['changed\n', 0o600]);
  writeFileSync(at3('notes/s.txt'), 'by hand\n');
  const undo = await inChat(chat, 'undo r and s', 'undo_last_change');
  const v = undo.value;
  assert.equal(v?.outcome, 'partly', undo.error || JSON.stringify(v));
  assert.equal(v.spark, 'spark3');
  assert.deepEqual(v.restored, ['~/notes/r.txt']);
  assert.deepEqual(v.notRestored, [{ path: '~/notes/s.txt', why: 'changed again since the change: left as it is' }]);
  assert.match(v.note, /^Put back on Spark 3: 1 file\. Not put back: 1 \(each says why\)\.$/);
  assert.ok(readFileSync(at3('notes/r.txt')).equals(BYTES), 'the exact bytes');
  assert.equal(modeOf(at3('notes/r.txt')), 0o604, 'and mode');
  assert.equal(text('notes/s.txt'), 'by hand\n');
  const mine = records().filter(r => r.act === 'undo_last_change' && r.chat === chat);
  assert.deepEqual(mine.map(r => [r.start || false, r.end || false, r.class || null, r.outcome || null, r.set]), [[true, false, 'restore', null, ran.value.set], [false, true, null, 'partly', ran.value.set]]);
  assert.equal(mine[0].id, mine[1].id);
  // That set is put back: undo again goes on to the chat's model changes (there are none).
  const again = await inChat(chat, 'undo again', 'undo_last_change');
  assert.notEqual(again.value?.set, ran.value.set, JSON.stringify(again));
  assert.equal(text('notes/s.txt'), 'by hand\n');
});

// The stand-in fleet's brain is on Spark 2; this console's runs on Spark 3 (its setup in main.json names that Spark).
// Spark Console has no brain across two Sparks yet: the brain's Sparks are its setup's one Spark and Spark 2.
test('a Spark that holds the brain is never run on: with Sparkie\'s model on Spark 3, the runner refuses Spark 3 by name', { timeout: 120000 * SLOW }, async () => {
  const F = await startMock({ watchMs: 600000, statusMs: 600000, prepare: ({ stateDir }) => {
    const f = join(stateDir, 'main.json'), m = JSON.parse(readFileSync(f, 'utf8'));
    m.presets[m.current].node = 'spark3';
    writeFileSync(f, JSON.stringify(m), { mode: 0o600 });
  } });
  later.push(F);
  const r = await fetch(`${F.base}/actions/run`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-spark-console': '1', origin: F.origin }, body: JSON.stringify({ on: 'spark3', command: 'touch notes/brain.txt', dir: '~' }) });
  const j = await r.json();
  assert.equal(r.status, 403, JSON.stringify(j));
  assert.equal(j.error, 'Spark 3 holds the brain, so the runner changes nothing there.');
  assert.ok(!existsSync(join(F.root, 'spark3', 'notes', 'brain.txt')));
  assert.ok(!existsSync(join(F.root, 'spark3', '.local', 'share', 'spark-console', 'before')), 'no copies');
  await F.stop();
});

// Last: it stops this file's console.
const copyTo = from => ({ dir, stateDir }) => {
  cpSync(join(from.stateDir, 'chats.json'), join(stateDir, 'chats.json'));
  cpSync(from.journalDir, join(dir, 'journal'), { recursive: true });
};
test('the start line is on disk before the unit runs: a console stopped between them tells the owner once, after its restart, what was running and where, that its end is unknown, and never runs it again', { timeout: 240000 * SLOW }, async () => {
  const chat = await newChat();
  const command = `touch notes/cut-started && sleep 30 # HF_TOKEN=${KEY2}`;
  script([{ match: '^try the long one on spark 3$', calls: [{ name: 'run', arguments: { on: 'spark3', command, dir: '~' } }] }]);
  say(chat, 'try the long one on spark 3').catch(() => {});
  await waitFor(() => existsSync(at3('notes/cut-started')), { every: 100, what: 'the unit to start' });
  const start = records().find(r => r.start && r.act === 'run' && r.chat === chat);
  assert.ok(start, 'the start line was on disk when the unit began');
  assert.equal(start.args.command, command.replace(KEY2, '[hidden]'));
  assert.equal(records().filter(r => r.id === start.id).length, 1, 'no end yet');
  process.kill(T.fleet.servicePid(), 'SIGKILL');
  await waitFor(() => T.fleet.serviceExit(), { what: 'the console to end' });
  noScript();
  const B = await startMock({ watchMs: 600000, statusMs: 600000, prepare: copyTo(T.fleet) });
  later.push(B);
  const cut = async f => (await (await fetch(`${f.base}/chats/${chat}`)).json()).messages.filter(x => x.notice && /cut off/.test(x.content));
  const notices = await waitFor(async () => { const m = await cut(B); return m.length && m; }, { what: 'the notice' });
  assert.equal(notices.length, 1);
  assert.match(notices[0].content, /^A restart of Spark Console cut off “Run a command on a Spark: \$ touch notes\/cut-started && sleep 30 # HF_TOKEN=\[hidden\] ” on Spark 3 before its end was written \(it began at \d\d:\d\d UTC\)\. It may or may not have happened, and it won’t be run again/);
  assert.ok(!notices[0].content.includes(KEY2));
  assert.deepEqual(records(B.journalDir).filter(r => r.id === start.id).map(r => [r.start || false, r.end || false, r.outcome || null]), [[true, false, null], [false, true, 'cut-off']]);
  // The needs-you line, which agents read too (fleet_status), names the change but not its command (R43, R59).
  const needs = (await (await fetch(`${B.base}/actions/fleet_status`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-spark-console': '1', origin: B.origin }, body: '{}' })).json()).needsOwner;
  const line = needs.find(l => /cut off/.test(l));
  assert.match(line || '', /^A restart of Spark Console cut off “Run a command on a Spark” on Spark 3 before its end was written/, JSON.stringify(needs));
  assert.ok(!line.includes('touch'), line);
  // Again: no second notice, and it never ran again.
  process.kill(B.servicePid(), 'SIGTERM');
  await waitFor(() => B.serviceExit(), { what: 'the console to end' });
  const C = await startMock({ watchMs: 600000, statusMs: 600000, prepare: copyTo(B) });
  later.push(C);
  await sleep(2000);
  assert.equal((await cut(C)).length, 1);
  assert.equal(records(C.journalDir).filter(r => r.start && r.act === 'run' && r.chat === chat).length, 1, 'never run again');
  assert.ok(!everything(C.journalDir).includes(KEY2), 'no journal file holds the key');
});
