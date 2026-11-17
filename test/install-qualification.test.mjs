// Covers: install qualification binds UI, config, worker, modes and file names to lock.tree.
// Uses tiny local Git repositories and archives only; no fleet or installed service.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = join(REPO, 'tools', 'qualify-install.py');
const ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'install-tree-')), root = join(dir, 'source');
  mkdirSync(root);
  const put = (name, text) => { const file = join(root, name); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
  put('.gitignore', 'service/workflows.lock.json\nignored-file\n');
  for (const file of ['public/app.js', 'public/styles.css', 'service/config.json', 'service/worker.py', 'deploy/host-on-portal.sh', 'test/eval/memory-held-out.json', 'folder.a', 'folder/nested', '.github/workflows/example.yml']) put(file, `${file}\n`);
  chmodSync(join(root, 'deploy/host-on-portal.sh'), 0o755);
  symlinkSync('nested', join(root, 'folder/link'));
  const git = (...args) => {
    const r = spawnSync('git', ['-C', root, ...args], { env: ENV });
    assert.equal(r.status, 0, r.stderr.toString()); return r.stdout;
  };
  git('init', '-q'); git('add', '-A');
  const tree = git('write-tree').toString().trim();
  put('service/workflows.lock.json', JSON.stringify({ tree, build: '0123456789ab' }));
  const manifest = join(dir, 'manifest');
  writeFileSync(manifest, git('ls-tree', '-r', '-z', tree));
  const check = (at = root, extra = {}) => spawnSync('python3', ['-I', CHECK, at], { env: { ...ENV, SPARK_INSTALL_MANIFEST: '', ...extra }, encoding: 'utf8' });
  const archive = () => {
    const out = join(dir, 'archive'); mkdirSync(out);
    const unpacked = spawnSync('tar', ['-x', '-C', out], { input: git('archive', tree) });
    assert.equal(unpacked.status, 0, unpacked.stderr.toString());
    writeFileSync(join(out, 'service/workflows.lock.json'), readFileSync(join(root, 'service/workflows.lock.json')));
    return out;
  };
  return { dir, root, put, tree, manifest, check, archive };
}

test('a UI, worker or config edit cannot reuse a lock for the same API build', () => {
  const f = fixture();
  try {
    let r = f.check(); assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout.trim(), f.tree);
    f.put('ignored-file', 'local-only\n');
    assert.equal(f.check().status, 0, 'checkout follows the same Git exclusions as the suite');
    for (const file of ['public/app.js', 'public/styles.css', 'service/worker.py', 'service/config.json']) {
      const before = readFileSync(join(f.root, file)); f.put(file, 'changed\n');
      r = f.check(f.root, { SPARK_TEST_TREE: f.tree, SPARK_INSTALL_MANIFEST: f.manifest });
      assert.notEqual(r.status, 0, `${file} must refuse, including with an old manifest or claimed tree`);
      assert.match(r.stderr, /test lock is for tree/);
      f.put(file, before);
    }
    chmodSync(join(f.root, 'deploy/host-on-portal.sh'), 0o644);
    assert.notEqual(f.check().status, 0, 'executable mode is part of the qualified tree');
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('complete no-git archives qualify directly; pull archives prove their deliberately omitted held-out file with a checked manifest', () => {
  const f = fixture();
  try {
    const archive = f.archive();
    let r = f.check(archive); assert.equal(r.status, 0, r.stderr);
    rmSync(join(archive, 'test/eval/memory-held-out.json'));
    assert.notEqual(f.check(archive).status, 0, 'an incomplete archive alone is no proof');
    r = f.check(archive, { SPARK_INSTALL_MANIFEST: f.manifest }); assert.equal(r.status, 0, r.stderr);
    writeFileSync(join(archive, 'public/app.js'), 'changed\n');
    r = f.check(archive, { SPARK_INSTALL_MANIFEST: f.manifest }); assert.notEqual(r.status, 0); assert.match(r.stderr, /archive differs/);
    writeFileSync(join(archive, 'public/app.js'), 'public/app.js\n');
    writeFileSync(join(archive, 'extra-file'), 'unexpected\n');
    r = f.check(archive, { SPARK_INSTALL_MANIFEST: f.manifest }); assert.notEqual(r.status, 0); assert.match(r.stderr, /file list differs/);
    rmSync(join(archive, 'extra-file'));
    const fake = join(f.dir, 'fake-manifest');
    writeFileSync(fake, readFileSync(f.manifest).toString().replace(/\b[0-9a-f]{40}\tpublic\/app.js/, `${'a'.repeat(40)}\tpublic/app.js`));
    assert.notEqual(f.check(archive, { SPARK_INSTALL_MANIFEST: fake }).status, 0, 'manifest claims are checked against the lock and files');
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('the frozen retained source keeps root metadata and a verified sibling proof, and original edits cannot change it', () => {
  const f = fixture();
  try {
    const frozen = join(f.dir, 'retained');
    let r = spawnSync('python3', ['-I', CHECK, f.root, '--freeze', frozen], { env: ENV, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(frozen, '.gitignore')));
    assert.ok(existsSync(join(frozen, '.github/workflows/example.yml')));
    assert.ok(!existsSync(join(frozen, 'test/eval/memory-held-out.json')));
    assert.ok(existsSync(`${frozen}.manifest`));
    f.put('public/app.js', 'an edit after freezing\n');
    r = f.check(frozen); assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(join(frozen, 'public/app.js'), 'utf8'), 'public/app.js\n');
    writeFileSync(join(frozen, 'service/worker.py'), 'a later edit\n');
    assert.notEqual(f.check(frozen).status, 0, 'the retained proof never permits changes');
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('a file changed between qualification and copying prevents the frozen tree from being accepted', () => {
  const f = fixture();
  try {
    const script = `import pathlib, runpy, sys
ns = runpy.run_path(sys.argv[1])
original = pathlib.Path.read_bytes
reads = 0
def changed(path):
    global reads
    data = original(path)
    if str(path) == sys.argv[2] + '/public/app.js':
        reads += 1
        if reads == 2: return b'changed during copy'
    return data
pathlib.Path.read_bytes = changed
ns['qualify'](sys.argv[2], freeze=sys.argv[3])
`;
    const r = spawnSync('python3', ['-I', '-c', script, CHECK, f.root, join(f.dir, 'raced')], { env: ENV, encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /archive differs from its tested tree: public\/app.js/);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('the installer calls exact qualification before its first remote check, and pull supplies a tree manifest', () => {
  const installer = readFileSync(join(REPO, 'deploy/host-on-portal.sh'), 'utf8');
  const check = installer.indexOf('python3 -I "$HERE/tools/qualify-install.py" "$HERE" --freeze');
  assert.ok(check > 0);
  assert.ok(check < installer.indexOf('PRE=$(COPYFILE_DISABLE=1 tar'), 'qualification precedes staging on the hub');
  const pull = readFileSync(join(REPO, 'deploy/pull.sh'), 'utf8');
  assert.match(pull, /g ls-tree -r -z "\$c" > "\$W\/install-source-tree"/);
  assert.match(pull, /SPARK_INSTALL_MANIFEST="\$W\/install-source-tree"/);
});
