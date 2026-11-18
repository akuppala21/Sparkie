// Covers: tarRead discards a prelisted fixture symlink together with its local PAX linkpath header after resolving
// the following entry name. Git's actual 119-byte GitHub checkout target and path-bearing PAX links leave only the
// original regular files for extraction. Read back, other links, type confusion, traversal, unknown/global keys,
// chained or unfinished metadata remain refused. Direct source fixture; run on a compute Spark.
import './file-limit.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, mkdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const source = readFileSync(new URL('../service/src/21-box-fill.mjs', import.meta.url), 'utf8');
const first = source.indexOf('const FILL_FOLDER ='), last = source.indexOf('// One command on a Spark with bytes in');
assert.ok(first >= 0 && last > first, 'load the production archive reader and its own constants');
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const { tarRead } = vm.runInNewContext(`${source.slice(first, last)}\n;({tarRead})`, {
  Buffer, TextDecoder, createHash, HttpError, maskSecrets: s => s,
}, { filename: 'service/src/21-box-fill.mjs' });

const ROOT = 'spark-console', LINK = 'test/mock/root/cache/config.json';
const TARGET = '/home/runner/work/Sparkie/Sparkie/test/mock/root/spark2/.cache/huggingface/hub/models--Qwen--Qwen3-32B/blobs/cfgc0mmit1';
const END = Buffer.alloc(1024), kept = () => entry(`${ROOT}/kept.txt`, { data: 'kept\n' });
const files = got => Array.from(got.files, f => ({ path: f.path, mode: f.mode, data: f.data.toString() }));
const cleanStream = (buf, drop) => Buffer.concat([...Array.from(drop, ([from], i) => buf.subarray(i ? drop[i - 1][1] : 0, from)), buf.subarray(drop.at(-1)?.[1] ?? 0)]);

// Independent ustar/PAX fixture writer. Actual git output below is also read and extracted.
function entry(name, { type = '0', data = '', prefix = '', link = '' } = {}) {
  const h = Buffer.alloc(512), body = Buffer.from(data);
  const put = (value, at, length) => Buffer.from(value).copy(h, at, 0, length);
  put(name, 0, 100); put('0000644\0', 100, 8); put('0000000\0', 108, 8); put('0000000\0', 116, 8);
  put(`${body.length.toString(8).padStart(11, '0')}\0`, 124, 12); put('00000000000\0', 136, 12);
  put('        ', 148, 8); h[156] = type.charCodeAt(0); put(link, 157, 100);
  put('ustar\0', 257, 6); put('00', 263, 2); put(prefix, 345, 155);
  const sum = h.reduce((a, b) => a + b, 0);
  put(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  return Buffer.concat([h, body, Buffer.alloc((512 - body.length % 512) % 512)]);
}
function pax(records, type = 'x') {
  const data = Object.entries(records).map(([k, v]) => {
    const rest = ` ${k}=${v}\n`;
    let length = Buffer.byteLength(rest) + 1;
    while (String(length).length + Buffer.byteLength(rest) !== length) length = String(length).length + Buffer.byteLength(rest);
    return `${length}${rest}`;
  }).join('');
  return entry('metadata.paxheader', { type, data });
}
const tar = (...parts) => Buffer.concat([...parts, END]);
const refuse = (bytes, skip, re = /an entry is a link/) => assert.throws(() => tarRead(bytes, ROOT, skip), e => e.status === 409 && re.test(e.message));

test('GitHub 119-byte link target with no PAX path is dropped with its metadata, leaving the next file intact', () => {
  assert.equal(Buffer.byteLength(TARGET), 119);
  assert.equal(createHash('sha1').update(`blob 119\0${TARGET}`).digest('hex'), '0003fece9d79830267fd7ab1584786dfe0d84945');
  const meta = pax({ linkpath: TARGET }), link = entry('config.json', { prefix: `${ROOT}/test/mock/root/cache`, type: '2', link: 'see metadata.paxheader' });
  const bytes = tar(meta, link, kept()), got = tarRead(bytes, ROOT, new Set([LINK]));
  assert.deepEqual(files(got), [{ path: 'kept.txt', mode: '100644', data: 'kept\n' }]);
  assert.deepEqual(Array.from(got.drop, p => Array.from(p)), [[0, meta.length + link.length]]);
  assert.deepEqual(cleanStream(bytes, got.drop), tar(kept()), 'no PAX bytes survive to affect extraction');
});

test('a PAX path chooses the exact skipped link; a later regular file keeps its original name and contents', () => {
  const meta = pax({ path: `${ROOT}/${LINK}`, linkpath: TARGET });
  const bytes = tar(meta, entry('placeholder', { type: '2' }), kept()), got = tarRead(bytes, ROOT, new Set([LINK]));
  assert.deepEqual(files(got), [{ path: 'kept.txt', mode: '100644', data: 'kept\n' }]);
  assert.deepEqual(cleanStream(bytes, got.drop), tar(kept()));
});

test('actual git archive of long fixture links is read and extracted without either link or its metadata', () => {
  const d = mkdtempSync(join(tmpdir(), 'sct-pax-')), repo = join(d, 'repo.git'), output = join(d, 'out');
  const env = { PATH: process.env.PATH, HOME: d, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' };
  const git = (args, input) => {
    const r = spawnSync('git', ['--git-dir', repo, '-c', 'core.hooksPath=/dev/null', ...args], { env, input, timeout: 20000, maxBuffer: 2 ** 20 });
    assert.equal(r.status, 0, `git ${args[0]}: ${r.error || r.stderr}`);
    return r.stdout;
  };
  const blob = value => git(['hash-object', '-w', '--stdin'], value).toString().trim();
  const tree = spec => git(['mktree', '-z'], Object.entries(spec).map(([name, v]) => typeof v === 'string'
    ? `100644 blob ${blob(v)}\t${name}\0`
    : v.link ? `120000 blob ${blob(v.link)}\t${name}\0` : `040000 tree ${tree(v)}\t${name}\0`).join('')).toString().trim();
  try {
    git(['init', '-q', '--bare']);
    const longName = 'p'.repeat(110), id = tree({ 'kept.txt': 'kept\n', test: { mock: { root: { cache: { 'config.json': { link: TARGET } }, [longName]: { link: TARGET } } } }, 'z-last.txt': 'last\n' });
    const bytes = git(['archive', '--format=tar', `--prefix=${ROOT}/`, id]);
    assert.equal(bytes.toString().split('linkpath=').length - 1, 2, 'real writer exercises both extended link targets');
    const got = tarRead(bytes, ROOT, new Set([LINK, `test/mock/root/${longName}`]));
    assert.deepEqual(files(got), [{ path: 'kept.txt', mode: '100644', data: 'kept\n' }, { path: 'z-last.txt', mode: '100644', data: 'last\n' }]);
    assert.equal(got.drop.length, 2);
    const cleaned = cleanStream(bytes, got.drop);
    assert.ok(!cleaned.includes(Buffer.from('linkpath=')), 'all link metadata removed');
    assert.deepEqual(files(tarRead(cleaned, ROOT)), files(got), 'clean stream needs no skip exemption');
    mkdirSync(output);
    const unpack = spawnSync('tar', ['--extract', '--file=-', '--directory', output, '--no-same-owner', '--no-same-permissions', '--keep-old-files'], { input: cleaned, timeout: 20000 });
    assert.equal(unpack.status, 0, String(unpack.stderr));
    assert.equal(readFileSync(join(output, ROOT, 'kept.txt'), 'utf8'), 'kept\n');
    assert.equal(readFileSync(join(output, ROOT, 'z-last.txt'), 'utf8'), 'last\n');
    for (const path of [LINK, `test/mock/root/${longName}`]) assert.throws(() => lstatSync(join(output, ROOT, path)), { code: 'ENOENT' });
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('read back preserves its original PAX-link refusal with or without a PAX path', () => {
  for (const [records, name] of [[{ linkpath: TARGET }, 'metadata.paxheader'], [{ path: `${ROOT}/${LINK}`, linkpath: TARGET }, `${ROOT}/${LINK}`]]) {
    assert.throws(() => tarRead(tar(pax(records), entry(`${ROOT}/${LINK}`, { type: '2' })), ROOT), {
      status: 409, message: `an entry is a link: ${name}. Nothing was changed.`,
    });
  }
});

test('an exact skip never admits another link, a hard link, a file or folder carrying link metadata', () => {
  const skip = new Set([LINK]);
  for (const type of ['0', '\0', '1', '5', '3', '6']) refuse(tar(pax({ linkpath: TARGET }), entry(`${ROOT}/${LINK}`, { type }), kept()), skip);
  refuse(tar(pax({ linkpath: TARGET }), entry(`${ROOT}/${LINK}.other`, { type: '2' })), skip);
  refuse(tar(pax({ path: `${ROOT}/${LINK}.other`, linkpath: TARGET }), entry(`${ROOT}/${LINK}`, { type: '2' })), skip);
  refuse(tar(pax({ path: `${ROOT}/../escape`, linkpath: TARGET }), entry(`${ROOT}/${LINK}`, { type: '2' })), skip);
  refuse(tar(pax({ path: '/etc/escape', linkpath: TARGET }), entry(`${ROOT}/${LINK}`, { type: '2' })), skip);
  refuse(tar(pax({ linkpath: TARGET }, 'g'), entry(`${ROOT}/${LINK}`, { type: '2' })), skip);
});

test('unknown keys, chained metadata and an unfinished extended header cannot survive a skipped entry', () => {
  const skip = new Set([LINK]), link = entry(`${ROOT}/${LINK}`, { type: '2' });
  refuse(tar(pax({ linkpath: TARGET, 'SCHILY.xattr.security.capability': 'x' }), link), skip, /Nothing was changed\.$/);
  for (const next of [pax({ path: `${ROOT}/${LINK}` }), pax({ comment: 'global' }, 'g')]) {
    refuse(tar(pax({ linkpath: TARGET }), next, link, kept()), skip, /Nothing was changed\.$/);
  }
  refuse(tar(pax({ path: `${ROOT}/${LINK}`, linkpath: TARGET })), skip, /Nothing was changed\.$/);
  refuse(tar(pax({ path: `${ROOT}/${LINK}` })), skip, /an extended header is damaged/);
});

test('path overrides without links keep the original traversal protection', () => {
  for (const path of [`${ROOT}/../escape`, '/etc/escape']) refuse(tar(pax({ path }), kept()), new Set([LINK]), /a path leaves the folder/);
});
