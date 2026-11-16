// Covers: The box filled from an exact tree and read back as data (21-box-fill.mjs; R62; design C 2.5, step C8b),
// reached here only through run's test door (SPARK_CONSOLE_BOX_FILL_DOOR). A tree from the console's own bare copy
// (here a local bare repository at the stand-in hub's ~/.local/share/spark-console/repo.git) fills the caller's box as
// files under spark-console/, byte for byte, the exec bit kept; a second fill finds other work and changes nothing.
// Refused before the box is touched: a link, a submodule, a control character, "..", ".git", two names that differ only
// by case or Unicode form, a file over 8 MiB, over 64 MiB in all, over 5,000 entries, a commit id, and an archive that
// doesn't hold exactly the tree (export-ignore). Read back right after a fill: nothing differs; after files change in
// the box: each changed, added, mode-changed or removed path with its new blob id, each blob in the bare copy. A real
// link, hard link or fifo in the box refuses the read; so does each hostile tar made here byte by byte (a link, a hard
// link, a device, a fifo, an unknown type, a pax link or unknown key, "..", an absolute path, a path outside the
// folder, case and Unicode twins, ".git", a control character, a name that isn't UTF-8, a damaged header, another tar
// form, bytes after the end, a cut stream, a file over 8 MiB, over 5,000 entries, over the bounds in all, a file and a
// folder of one name, a path twice, a path over 255 bytes), naming the entry masked and bounded. With agents paused,
// an agent's fill and read back are refused; with no eval on record, Sparkie's fill is a button and opens nothing. Each
// fill and read back is a journal record. A box removed and opened again by the same caller (the same name, on the same
// Spark, another container) isn't the box that was filled: read back refuses it. An eval set the console's installed
// source lacks (here the held-out one, with that source a folder made here) never goes into
// a box: a fill leaves it out, a read back never says it went, and a file of its name in the box refuses the read. Starts stand-in fleets: run it on a
// Spark.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, readdirSync, statSync, unlinkSync, chmodSync, symlinkSync, linkSync, rmSync, existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { T, useFleet, api, call, createActKey, agentSettings, newChat, say, REPO, SLOW } from './lib.mjs';
import { startMock } from './start-mock.mjs';

const IMAGE = JSON.parse(readFileSync(join(REPO, 'service', 'config.json'), 'utf8')).work.images.python;
const MiB = 2 ** 20;
const DOOR = { SPARK_CONSOLE_BOX_FILL_DOOR: '1' };
// The console's own source as the installer ships it, whose test/eval/ is the list of eval sets a box may hold (R47,
// 21-box-fill.mjs): one set, without the held-out one. The repository the stand-in fleet runs from has that one too.
const SOURCE = mkdtempSync(join(tmpdir(), 'sct-fill-source-'));
mkdirSync(join(SOURCE, 'test', 'eval'), { recursive: true });
writeFileSync(join(SOURCE, 'test', 'eval', 'cases.json'), '[]\n');
after(() => rmSync(SOURCE, { recursive: true, force: true }));
const T_ = {};   // the trees made in prepare, by name

// git on the bare copy, with nothing from the machine's git config.
function gitIn(dir, args, input) {
  const r = spawnSync('git', ['--git-dir', dir, ...args], { input, maxBuffer: 2 ** 28, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.invalid' } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}
// A tree from { name: Buffer | string | { data, mode } | { link } | { commit } | { tree: {...} } }.
function makeTree(dir, spec) {
  const lines = Object.entries(spec).map(([name, v]) => {
    // (plain contents first: a string's own .link is String.prototype.link)
    if (Buffer.isBuffer(v) || typeof v === 'string') return `100644 blob ${gitIn(dir, ['hash-object', '-w', '--stdin'], v).toString().trim()}\t${name}\0`;
    if (v.tree) return `040000 tree ${makeTree(dir, v.tree)}\t${name}\0`;
    if (v.link) return `120000 blob ${gitIn(dir, ['hash-object', '-w', '--stdin'], v.link).toString().trim()}\t${name}\0`;
    if (v.commit) return `160000 commit ${'1'.repeat(40)}\t${name}\0`;
    return `${v.mode || '100644'} blob ${gitIn(dir, ['hash-object', '-w', '--stdin'], v.data).toString().trim()}\t${name}\0`;
  });
  return gitIn(dir, ['mktree', '-z', '--missing'], Buffer.from(lines.join(''))).toString().trim();
}
const LONG = `docs/${'d'.repeat(60)}/${'f'.repeat(60)}.md`;
const GOOD = { 'README.md': 'hello\n', 'run.sh': { data: '#!/bin/sh\necho hi\n', mode: '100755' }, service: { tree: { 'a.mjs': 'export const a = 1;\n' } },
  docs: { tree: { [`${'d'.repeat(60)}`]: { tree: { [`${'f'.repeat(60)}.md`]: 'long\n' } } } }, notes: { tree: { 'café.txt': 'é\n' } } };
function prepareRepo(root) {
  const dir = join(root, 'spark2', '.local', 'share', 'spark-console', 'repo.git');
  mkdirSync(dir, { recursive: true });
  gitIn(dir, ['init', '-q', '--bare']);
  const big = Buffer.alloc(8 * MiB, 7);
  T_.dir = dir;
  T_.good = makeTree(dir, GOOD);
  T_.link = makeTree(dir, { ...GOOD, 'link-to-readme': { link: 'README.md' } });
  T_.sub = makeTree(dir, { ...GOOD, vendor: { commit: true } });
  T_.ctrl = makeTree(dir, { ...GOOD, 'bell\u0007.txt': 'x\n' });
  T_.dotdot = makeTree(dir, { ...GOOD, '..': 'up\n' });
  T_.dotgit = makeTree(dir, { ...GOOD, '.git': { tree: { config: '[core]\n' } } });
  T_.case = makeTree(dir, { ...GOOD, 'Readme.MD': 'twin\n' });
  T_.nfd = makeTree(dir, { ...GOOD, notes: { tree: { 'café.txt': 'é\n', 'café.txt': 'é\n' } } });
  T_.bigfile = makeTree(dir, { ...GOOD, 'big.bin': Buffer.concat([big, Buffer.from('!')]) });
  T_.total = makeTree(dir, { ...GOOD, ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`part${i}.bin`, big])) });
  T_.many = makeTree(dir, { many: { tree: Object.fromEntries(Array.from({ length: 5001 }, (_, i) => [`f${i}`, 'x'])) } });
  T_.attr = makeTree(dir, { ...GOOD, '.gitattributes': 'README.md export-ignore\n' });
  T_.commit = gitIn(dir, ['commit-tree', T_.good, '-m', 'c'], '').toString().trim();
  // (shaped like main: the stand-in fleet's model cache keeps links under test/mock/root/, which a fill leaves out)
  const hub = { snap: { tree: { 'config.json': { link: '../blobs/cfg1' }, 'real.txt': 'kept\n' } }, blobs: { tree: { cfg1: '{}\n' } } };
  T_.mainlike = makeTree(dir, { ...GOOD, test: { tree: { mock: { tree: { root: { tree: { spark2: { tree: { hub: { tree: hub } } } } } } } } } });
  T_.linkelse = makeTree(dir, { ...GOOD, test: { tree: { mock: { tree: { evil: { link: '/etc/passwd' } } } } } });
  T_.heldout = makeTree(dir, { ...GOOD, test: { tree: { eval: { tree: { 'memory-held-out.json': '{"questions":["held"]}\n', 'cases.json': '[]\n' } } } } });
}
function prepare({ root }) {
  for (const sp of ['spark3', 'spark4']) appendFileSync(join(root, sp, '.mock', 'images'), `${IMAGE}\n`);
  prepareRepo(root);
}
useFleet({ watchMs: 2000, env: { ...DOOR, SPARK_CONSOLE_SOURCE_DIR: SOURCE }, prepare }, async () => { T_.agent = await createActKey('fill-agent'); T_.agent2 = await createActKey('fill-agent-2'); });
const later = [];
after(async () => { for (const F of later) await F.stop().catch(() => {}); });

const boxName = key => `spark-console-box-${createHash('sha256').update(key).digest('hex').slice(0, 12)}`;
const API_BOX = boxName('api owner');
const mock = (spark, F = T.fleet) => join(F.root, spark, '.mock');
const folder = (name, spark = 'spark3', F = T.fleet) => join(F.root, spark, '.local/share/spark-console/work', name);
const filled = (...p) => join(folder(API_BOX), 'spark-console', ...p);
const run = command => api('/actions/run', { method: 'POST', body: { on: 'box', command } });
const blobOf = data => createHash('sha1').update(`blob ${Buffer.byteLength(data)}\0`).update(data).digest('hex');
const journal = () => readdirSync(T.fleet.journalDir).filter(f => f.endsWith('.jsonl')).flatMap(f => readFileSync(join(T.fleet.journalDir, f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)));
async function refused(command, re) {
  const r = await run(command);
  assert.equal(r.status, 409, `${command}: ${r.status} ${r.text}`);
  assert.match(r.json.error, re, r.text);
  return r.json.error;
}

test('a tree fills the box byte for byte under spark-console/, the exec bit kept; a second fill finds other work and changes nothing', { timeout: 180000 * SLOW }, async () => {
  const r = await run(`/fill ${T_.good}`);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual({ ...r.json, observedAt: null }, { filled: true, box: API_BOX, spark: 'spark3', tree: T_.good, folder: 'spark-console', files: 5, bytes: 52, observedAt: null });
  assert.equal(readFileSync(filled('README.md'), 'utf8'), 'hello\n');
  assert.equal(readFileSync(filled('service', 'a.mjs'), 'utf8'), 'export const a = 1;\n');
  assert.equal(readFileSync(filled(LONG), 'utf8'), 'long\n', 'a path too long for a ustar name alone');
  assert.equal(readFileSync(filled('notes', 'café.txt'), 'utf8'), 'é\n');
  assert.equal(statSync(filled('run.sh')).mode & 0o111, 0o111, 'run.sh keeps its exec bit');
  assert.equal(statSync(filled('README.md')).mode & 0o111, 0);
  assert.deepEqual(readdirSync(folder(API_BOX)), ['spark-console'], 'one folder, nothing else');
  const again = await refused(`/fill ${T_.good}`, /^This chat’s box on Spark 3 holds other work \(1 thing in its folder\), so nothing was put in it\.$/);
  assert.ok(again);
  assert.deepEqual(readdirSync(folder(API_BOX)), ['spark-console']);
  for (const spark of ['spark2', 'spark4']) assert.ok(!readFileSync(join(mock(spark), 'containers'), 'utf8').includes('spark-console-box-'), spark);
});

test('refused before the box is touched: a link, a submodule, a control character, "..", ".git", case and Unicode twins, a file over 8 MiB, over 64 MiB in all, over 5,000 entries, a commit, and an archive that isn’t the tree', { timeout: 240000 * SLOW }, async () => {
  const before = readdirSync(filled());
  await refused(`/fill ${T_.link}`, /^the tree holds a link: link-to-readme\. Nothing was changed\.$/);
  await refused(`/fill ${T_.linkelse}`, /^the tree holds a link: test\/mock\/evil\. Nothing was changed\.$/);
  await refused(`/fill ${T_.sub}`, /^the tree holds a link to another repository \(a submodule\): vendor\./);
  await refused(`/fill ${T_.ctrl}`, /^a name holds a control character: bell\?\.txt\./);
  await refused(`/fill ${T_.dotdot}`, /^a path leaves the folder: \.\.\./);
  await refused(`/fill ${T_.dotgit}`, /^a path holds a \.git: \.git\./);
  await refused(`/fill ${T_.case}`, /^a name differs only by case or Unicode form from (README\.md|Readme\.MD): (Readme\.MD|README\.md)\./);
  await refused(`/fill ${T_.nfd}`, /^a name differs only by case or Unicode form from notes\/caf/);
  await refused(`/fill ${T_.bigfile}`, /^a file is over 8 MiB: big\.bin\./);
  await refused(`/fill ${T_.total}`, /^the tree’s files are over 64 MiB in all\. Nothing was changed\.$/);
  await refused(`/fill ${T_.many}`, /^the tree has more than 5,000 files and folders\./);
  await refused(`/fill ${T_.commit}`, new RegExp(`^${T_.commit} isn’t a tree in Spark Console’s copy of the repository\\.`));
  await refused(`/fill ${T_.attr}`, /^git’s archive of the tree doesn’t hold exactly the tree/);
  assert.deepEqual(readdirSync(filled()), before, 'the box is as it was');
});

// The final read of the tests (TD-09): the test above sends its bad trees from a caller whose box is already open and
// full, so "before the box is touched" held there for another reason; a fill that opened the box first would pass it.
test('a bad tree from a caller with no box opens none: no container and no folder for it on any Spark', { timeout: 120000 * SLOW }, async () => {
  const k = await createActKey('fill-agent-none'), name = boxName(`agent ${k.id}`);
  for (const [tree, re] of [[T_.link, /the tree holds a link: link-to-readme\./], [T_.dotgit, /a path holds a \.git: \.git\./]]) {
    const r = await call(k.token, 'run', { on: 'box', command: `/fill ${tree}` });
    assert.ok(r.isError, r.text);
    assert.match(r.text, re);
  }
  for (const spark of ['spark2', 'spark3', 'spark4']) {
    const f = join(mock(spark), 'containers');
    assert.ok(!existsSync(f) || !readFileSync(f, 'utf8').includes(name), `${spark}: no container`);
    assert.ok(!existsSync(folder(name, spark)), `${spark}: no folder`);
  }
});

test('read back: nothing differs right after a fill; changed, added, mode-changed and removed paths come back with their new blob ids, each blob in the bare copy', { timeout: 120000 * SLOW }, async () => {
  const same = await run('/read-back');
  assert.equal(same.status, 200, same.text);
  assert.deepEqual([same.json.box, same.json.spark, same.json.tree, same.json.folder, same.json.changes, same.json.files], [API_BOX, 'spark3', T_.good, 'spark-console', [], 5]);
  // (what the brain would do there: change, add, take out, and change a mode)
  writeFileSync(filled('README.md'), 'changed\n');
  mkdirSync(filled('new'));
  writeFileSync(filled('new', 'file.txt'), 'new file\n');
  unlinkSync(filled('service', 'a.mjs'));
  chmodSync(filled('run.sh'), 0o644);
  const r = await run('/read-back');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.changes, [
    { path: 'README.md', blob: blobOf('changed\n'), mode: '100644' },
    { path: 'new/file.txt', blob: blobOf('new file\n'), mode: '100644' },
    { path: 'run.sh', blob: blobOf('#!/bin/sh\necho hi\n'), mode: '100644' },
    { path: 'service/a.mjs', blob: null, mode: null },
  ]);
  for (const c of r.json.changes.filter(x => x.blob)) assert.equal(gitIn(T_.dir, ['cat-file', 'blob', c.blob]).toString(), c.path === 'run.sh' ? '#!/bin/sh\necho hi\n' : c.path === 'README.md' ? 'changed\n' : 'new file\n');
  const recs = journal().filter(j => j.where === 'box' && /^(fill|read back)/.test(j.args?.command || '')).map(j => [j.args.command.split(' ')[0], j.outcome, j.ok]).filter(x => !['open', 'opened'].includes(x[1]));   // (the box's own open and reuse records)
  assert.deepEqual(recs.filter(x => x[2]), [['fill', 'filled', true], ['read', 'read', true], ['read', 'read', true]]);
  assert.ok(recs.some(x => x[1] === 'busy' && !x[2]), JSON.stringify(recs));
});

test('a real link, hard link or fifo in the box refuses the whole read, naming it', { timeout: 120000 * SLOW }, async () => {
  for (const [make, re] of [
    [p => symlinkSync('/etc/passwd', p), /^an entry is a link: spark-console\/odd\. Nothing was changed\.$/],
    [p => linkSync(filled('README.md'), p), /^an entry is a hard link: spark-console\/(odd|README\.md)\./],
    [p => spawnSync('mkfifo', [p]), /^an entry is a fifo: spark-console\/odd\./],
  ]) {
    make(filled('odd'));
    try { await refused('/read-back', re); } finally { rmSync(filled('odd'), { force: true }); }
  }
  assert.equal((await run('/read-back')).status, 200, 'readable again once it is gone');
});

// One ustar header and its data, byte by byte. name and prefix may be Buffers (a name that isn't UTF-8).
function entry(name, { type = '0', data = Buffer.alloc(0), mode = 0o644, link = '', prefix = '', magic = 'ustar\0', version = '00', badSum = false, size = null } = {}) {
  const h = Buffer.alloc(512), put = (s, at, n) => (Buffer.isBuffer(s) ? s : Buffer.from(String(s), 'utf8')).copy(h, at, 0, n);
  const body = Buffer.isBuffer(data) ? data : Buffer.from(data);
  put(name, 0, 100); put(`${mode.toString(8).padStart(7, '0')}\0`, 100, 8); put('0000000\0', 108, 8); put('0000000\0', 116, 8);
  put(`${(size ?? body.length).toString(8).padStart(11, '0')}\0`, 124, 12); put('00000000000\0', 136, 12); put('        ', 148, 8);
  h[156] = type.charCodeAt(0); put(link, 157, 100); put(magic, 257, 6); put(version, 263, 2); put(prefix, 345, 155);
  let sum = 0;
  for (const b of h) sum += b;
  put(`${(badSum ? sum + 1 : sum).toString(8).padStart(6, '0')}\0 `, 148, 8);
  return Buffer.concat([h, body, Buffer.alloc((512 - (body.length % 512)) % 512)]);
}
const pax = (records, type = 'x') => entry('PaxHeader', { type, data: Buffer.from(Object.entries(records).map(([k, v]) => {
  const rest = ` ${k}=${v}\n`;
  let n = rest.length + 1;
  while (String(n).length + rest.length !== n) n = String(n).length + rest.length;
  return `${n}${rest}`;
}).join('')) });
const END = Buffer.alloc(1024);
const tar = (...parts) => Buffer.concat([entry('spark-console/', { type: '5', mode: 0o755 }), ...parts, END]);
const KEY = 'hf_Q7wErTy8UiOp2AsDfGh5JkLzXc';

test('each hostile tar refuses the whole read with the entry’s name, masked and bounded; nothing is kept', { timeout: 300000 * SLOW }, async () => {
  const f = join(mock('spark3'), `box-tar-${API_BOX}`), ok = entry('spark-console/README.md', { data: 'hello\n' });
  const cases = [
    ['a link', tar(entry('spark-console/evil', { type: '2', link: '/etc/passwd' })), /^an entry is a link: spark-console\/evil\./],
    ['a hard link', tar(ok, entry('spark-console/twin', { type: '1', link: 'spark-console/README.md' })), /^an entry is a hard link: spark-console\/twin\./],
    ['a character device', tar(entry('spark-console/tty', { type: '3' })), /^an entry is a device: spark-console\/tty\./],
    ['a block device', tar(entry('spark-console/disk', { type: '4' })), /^an entry is a device: spark-console\/disk\./],
    ['a fifo', tar(entry('spark-console/pipe', { type: '6' })), /^an entry is a fifo: spark-console\/pipe\./],
    ['a GNU long name', tar(entry('././@LongLink', { type: 'L', data: 'spark-console/x\0' })), /^an entry is of a type the reader doesn’t know: \.\/\.\/@LongLink\./],
    ['a pax link', tar(pax({ linkpath: '/etc/shadow', path: 'spark-console/sneaky' }), ok), /^an entry is a link: spark-console\/sneaky\./],
    ['a pax key it doesn’t know', tar(pax({ 'SCHILY.xattr.security.capability': 'x' }), ok), /^an extended header holds a key the reader doesn’t know \(SCHILY\.xattr\.security\.capability\): PaxHeader\./],
    ['".."', tar(entry('spark-console/../escape', { data: 'x' })), /^a path leaves the folder: spark-console\/\.\.\/escape\./],
    ['an absolute path', tar(entry('/etc/cron.d/evil', { data: 'x' })), /^a path leaves the folder: \/etc\/cron\.d\/evil\./],
    ['outside the folder', tar(entry('other/x', { data: 'x' })), /^an entry is outside the folder spark-console: other\/x\./],
    ['case twins', tar(ok, entry('spark-console/readme.md', { data: 'x' })), /^a name differs only by case or Unicode form from README\.md: spark-console\/readme\.md\./],
    ['Unicode twins', tar(entry('spark-console/café', { data: 'x' }), entry('spark-console/café', { data: 'y' })), /^a name differs only by case or Unicode form from café: spark-console\/cafe/],
    ['.git', tar(entry('spark-console/.git/hooks/pre-commit', { data: '#!/bin/sh\n', mode: 0o755 })), /^a path holds a \.git: spark-console\/\.git\/hooks\/pre-commit\./],
    ['a control character', tar(entry('spark-console/bell\u0007', { data: 'x' })), /^a name holds a control character: spark-console\/bell\?\./],
    ['a name that isn’t UTF-8', tar(entry(Buffer.from([...Buffer.from('spark-console/bad'), 0xff, 0xfe]), { data: 'x' })), /^a name isn’t UTF-8: spark-console\/bad/],
    ['a damaged header', tar(entry('spark-console/x', { data: 'x', badSum: true })), /^an entry’s header is damaged \(its checksum doesn’t match\): spark-console\/x\./],
    ['another tar form', tar(entry('spark-console/x', { data: 'x', magic: 'ustar ', version: ' \0' })), /^an entry isn’t in the one tar form the reader knows \(ustar\): spark-console\/x\./],
    ['bytes after the end', Buffer.concat([tar(ok), Buffer.from('trailing')]), /^there are bytes after the stream’s end\. Nothing was changed\.$/],
    ['a cut stream', tar(ok).subarray(0, 1536), /^the stream ends before its end mark\./],
    ['a cut entry', Buffer.concat([entry('spark-console/x', { size: 4096 }), Buffer.alloc(512)]), /^the stream ends inside an entry: spark-console\/x\./],
    ['a file over 8 MiB', tar(entry('spark-console/big', { data: Buffer.alloc(8 * MiB + 1) })), /^a file is over 8 MiB: spark-console\/big\./],
    ['over 5,000 entries', tar(...Array.from({ length: 5001 }, (_, i) => entry(`spark-console/f${i}`, { data: 'x' }))), /^there are more than 5,000 files and folders\./],
    ['over the bounds in all', tar(...Array.from({ length: 9 }, (_, i) => entry(`spark-console/p${i}`, { data: Buffer.alloc(8 * MiB) }))), /^(the box’s folder is over the bounds|the files are over 64 MiB in all)/],
    // (over 64 MiB in all but under the stream's own cap: only the reader's bound refuses it; final read TD-08)
    ['over 64 MiB in all, under the stream’s cap', tar(...Array.from({ length: 8 }, (_, i) => entry(`spark-console/p${i}`, { data: Buffer.alloc(8 * MiB) })), entry('spark-console/q', { data: Buffer.alloc(MiB) })), /^the files are over 64 MiB in all\. Nothing was changed\.$/],
    ['a file and a folder of one name', tar(entry('spark-console/x', { data: 'x' }), entry('spark-console/x/y', { data: 'y' })), /^a file and a folder have one name: spark-console\/x\/y\./],
    ['a path twice', tar(ok, ok), /^a path is there twice: spark-console\/README\.md\./],
    ['a path over 255 bytes', tar(pax({ path: `spark-console/${'p'.repeat(300)}` }), entry('spark-console/short', { data: 'x' })), /^a path is over 255 bytes: spark-console\/p+\. Nothing was changed\.$/],
    ['a key in a name', tar(entry(`spark-console/${KEY}`, { type: '2', link: 'x' })), /^an entry is a link: spark-console\//],
  ];
  const blobsBefore = gitIn(T_.dir, ['count-objects', '-v']).toString();
  try {
    for (const [what, bytes, re] of cases) {
      writeFileSync(f, bytes);
      const said = await refused('/read-back', re);
      assert.ok(said.length < 400, `${what}: bounded (${said.length})`);
      assert.ok(!said.includes(KEY.slice(3, 15)), `${what}: the key is masked`);
    }
  } finally { rmSync(f, { force: true }); }
  assert.equal(gitIn(T_.dir, ['count-objects', '-v']).toString(), blobsBefore, 'no refused read wrote a blob');
});

test('a tree shaped like main’s fills without the stand-in fleet’s links under test/mock/root/, and reads back clean: the links are not said to be gone', { timeout: 120000 * SLOW }, async () => {
  const name = boxName(`agent ${T_.agent2.id}`), at = (...p) => join(folder(name), 'spark-console', 'test', 'mock', 'root', 'spark2', 'hub', ...p);
  const f = await call(T_.agent2.token, 'run', { on: 'box', command: `/fill ${T_.mainlike}` });
  assert.equal(f.isError, false, f.text);
  assert.deepEqual([f.value.filled, f.value.box, f.value.tree, f.value.files], [true, name, T_.mainlike, 7]);
  assert.equal(readFileSync(at('snap', 'real.txt'), 'utf8'), 'kept\n');
  assert.equal(readFileSync(at('blobs', 'cfg1'), 'utf8'), '{}\n');
  assert.ok(!readdirSync(at('snap')).includes('config.json'), 'the link is left out');
  const r = await call(T_.agent2.token, 'run', { on: 'box', command: '/read-back' });
  assert.equal(r.isError, false, r.text);
  assert.deepEqual([r.value.tree, r.value.changes, r.value.files], [T_.mainlike, [], 7]);
});

test('with agents paused, an agent’s fill and read back are refused; with no eval on record, Sparkie’s fill is a button and opens nothing', { timeout: 240000 * SLOW }, async () => {
  await agentSettings({ halted: true });
  try {
    for (const command of [`/fill ${T_.good}`, '/read-back']) {
      const r = await call(T_.agent.token, 'run', { on: 'box', command });
      assert.equal(r.isError, true, `${command}: ${r.text}`);
      assert.match(r.text, /Agents’ changes are paused .*filling or reading back a box is a change/);
    }
  } finally { await agentSettings({ halted: false }); }
  assert.ok(!readFileSync(join(mock('spark3'), 'containers'), 'utf8').includes(boxName(`agent ${T_.agent.id}`)), 'the agent’s box never opened');
  const F = await startMock({ watchMs: 600000, statusMs: 600000, evalOnRecord: false, env: DOOR, prepare });
  later.push(F);
  writeFileSync(join(F.dir, 'model-script.json'), JSON.stringify([{ match: '^fill the box', calls: [{ name: 'run', arguments: { on: 'box', command: `/fill ${T_.good}` } }] }]));
  const chat = await (await fetch(`${F.base}/chats`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-spark-console': '1', origin: F.origin }, body: '{}' })).json();
  const res = await fetch(`${F.base}/chats/${chat.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-spark-console': '1', origin: F.origin }, body: JSON.stringify({ text: 'fill the box with the tree' }) });
  const done = (await res.text()).split('\n\n').map(b => b.trim()).filter(b => b.startsWith('data:')).map(b => JSON.parse(b.slice(5))).find(e => e.type === 'done');
  assert.ok(done?.message?.choices?.length >= 1, JSON.stringify(done?.message));
  assert.ok(!readFileSync(join(F.root, 'spark3', '.mock', 'containers'), 'utf8').includes('spark-console-box-'), 'no box opened');
  // The owner's press is the owner's own: the box opens and is filled.
  const press = await fetch(`${F.base}/chats/${chat.id}/choose`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-spark-console': '1', origin: F.origin }, body: JSON.stringify({ choice: done.message.choices[0].id }) });
  assert.equal(press.status, 200, await press.text());
  assert.equal(readFileSync(join(folder(boxName(`chat ${chat.id}`), 'spark3', F), 'spark-console', 'README.md'), 'utf8'), 'hello\n', 'filled by the press');
});

test('a box removed and opened again by the same caller has the same name and Spark but isn’t the box that was filled: read back refuses it', { timeout: 180000 * SLOW }, async () => {
  const k = await createActKey('fill-again'), name = boxName(`agent ${k.id}`);
  // (as Docker does, each container made under a name gets an id of its own)
  for (const sp of ['spark3', 'spark4']) writeFileSync(join(mock(sp), 'ids-per-run'), '');
  try {
    const f = await call(k.token, 'run', { on: 'box', command: `/fill ${T_.good}` });
    assert.equal(f.isError, false, f.text);
    const at = f.value.spark;
    const stop = await call(k.token, 'run', { on: 'box', command: '/stop' });
    assert.equal(stop.value?.box, 'removed', stop.raw);
    // (opened again, and something put where the filled tree was)
    const again = await call(k.token, 'run', { on: 'box', command: 'mkdir -p spark-console && printf "hello\\n" > spark-console/README.md' });
    assert.deepEqual([again.value?.box, again.value?.name, again.value?.spark], ['opened', name, at], again.raw);
    const r = await call(k.token, 'run', { on: 'box', command: '/read-back' });
    assert.ok(r.isError, r.raw);
    assert.match(r.text, /The box that was filled has ended \(or was opened again since\), so there is nothing to read back\./);
  } finally { for (const sp of ['spark3', 'spark4']) rmSync(join(mock(sp), 'ids-per-run'), { force: true }); }
});

test('the eval’s held-out set never goes into a box: a fill leaves it out, a read back never says it went, and a file of its name in the box refuses the read', { timeout: 180000 * SLOW }, async () => {
  const k = await createActKey('fill-held'), name = boxName(`agent ${k.id}`);
  const f = await call(k.token, 'run', { on: 'box', command: `/fill ${T_.heldout}` });
  assert.equal(f.isError, false, f.text);
  assert.deepEqual([f.value.filled, f.value.files], [true, 6], f.text);
  const at = (...p) => join(folder(name, f.value.spark), 'spark-console', 'test', 'eval', ...p);
  assert.ok(existsSync(at('cases.json')) && !existsSync(at('memory-held-out.json')), 'the held-out set was left out of the box');
  const r = await call(k.token, 'run', { on: 'box', command: '/read-back' });
  assert.deepEqual([r.isError, r.value?.changes], [false, []], r.raw);
  writeFileSync(at('memory-held-out.json'), '{"questions":[]}\n');
  const again = await call(k.token, 'run', { on: 'box', command: '/read-back' });
  assert.ok(again.isError, again.raw);
  assert.match(again.text, /an eval set the installer doesn’t ship is never taken from a box: spark-console\/test\/eval\/memory-held-out\.json\. Nothing was changed\./);
});
