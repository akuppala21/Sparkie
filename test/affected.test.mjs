// Covers: Affected tests only (tools/affected.mjs, design C 2.4 and section 4 step 6): a made-up map and real git diffs
// in a made-up repository give the right test files; every path on the "always" list, and a missing map, answer all; a
// documents-only change picks the documents test alone; a changed test file is always picked. And the map itself, from
// real coverage of two small test files run the way test/lock.mjs runs them. Each part the "always" lists name by its
// file name is in service/src/, and one that isn't is said (checkAffected, which tools/make.mjs runs). No fleet: git,
// node and temporary folders.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { choose, pick, buildMap, findMaps, noteMissed, failedIn, checkAffected, ALWAYS_PARTS, LANDING_ALWAYS_PARTS, SHORT_CHECK, DOCS_TEST } from '../tools/affected.mjs';
import { EACH_FILE } from './lock.mjs';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@test', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@test' };
const git = (dir, ...args) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', env: ENV });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
const put = (dir, f, text) => { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), text); };
const edit = (dir, f, from, to) => { const t = readFileSync(join(dir, f), 'utf8'); assert.ok(t.includes(from), `${f} has ${from}`); writeFileSync(join(dir, f), t.replace(from, to)); };

const ALPHA = [
  '// alpha',                      // 1
  'function one(x) {',             // 2
  '  const y = x + 1;',            // 3
  '  return y * 2;',               // 4
  '}',                             // 5
  '',                              // 6
  'function two() {',              // 7
  '  return [1, 2].map(n => {',    // 8
  '    return n + 1;',             // 9
  '  });',                         // 10
  '}',                             // 11
  'const TABLE = { a: 1 };',       // 12
  '',
].join('\n');
const BETA = [
  'function three() {',            // 1
  '  return 3;',                   // 2
  '}',                             // 3
  'setInterval(() => {',           // 4
  '  three();',                    // 5
  '}, 1000);',                     // 6
  '',
].join('\n');
const SMALL = name => `function ${name}() {\n  return 1;\n}\n`;
const OTHER_PARTS = Array.from({ length: 9 }, (_, i) => `4${i}-p${i}.mjs`);
const TESTS = ['test/a.test.mjs', 'test/b.test.mjs', 'test/c.test.mjs', 'test/d.test.mjs', ...SHORT_CHECK, DOCS_TEST].sort();
const at = f => TESTS.indexOf(f);
// One path for each entry on the list that always runs everything.
const ALWAYS_PATHS = ['service/passkey.mjs', 'service/dig.mjs', 'service/worker.py', 'service/config.json', 'deploy/host-on-portal.sh',
  'test/lib.mjs', 'test/start-mock.mjs', 'test/mock/bin/docker', 'test/lock.mjs', 'tools/make.mjs', '.github/workflows/full-run.yml'];

let base, top, mapFile, tested;
before(() => {
  base = mkdtempSync(join(tmpdir(), 'sct-affected-'));
  top = join(base, 'spark-console');
  mkdirSync(top);
  git(top, 'init', '-q', '-b', 'main');
  put(top, 'service/src/30-alpha.mjs', ALPHA);
  put(top, 'service/src/31-beta.mjs', BETA);
  for (const p of [...ALWAYS_PARTS, ...OTHER_PARTS]) put(top, `service/src/${p}`, SMALL(`f${p.slice(0, 2)}${p.length}`));
  for (const f of ALWAYS_PATHS) put(top, f, '# a file\n');
  for (const f of TESTS) put(top, f, '// a test\n');
  put(top, 'docs/guide.md', '# Guide\n');
  put(top, 'README.md', '# Read me\n');
  put(top, 'public/app.js', 'console.log(1);\n');
  put(top, 'service/server.mjs', '// the parts joined\n');
  git(top, 'add', '-A');
  git(top, 'commit', '-q', '-m', 'base');
  tested = git(top, 'rev-parse', 'HEAD');
  const fns = {
    '30-alpha.mjs:one@2-5': [at('test/a.test.mjs')],
    '30-alpha.mjs:two@7-11': [at('test/b.test.mjs')],
    '30-alpha.mjs:(anonymous)@8-10': [at('test/b.test.mjs')],
    '31-beta.mjs:three@1-3': TESTS.slice(0, 9).map(at),                 // most test files run it
    '31-beta.mjs:(anonymous)@4-6': [at('test/c.test.mjs')],
    ...Object.fromEntries(OTHER_PARTS.map(p => [`${p}:f${p.slice(0, 2)}${p.length}@1-3`, [at('test/d.test.mjs')]])),
    ...Object.fromEntries(ALWAYS_PARTS.map(p => [`${p}:f${p.slice(0, 2)}${p.length}@1-3`, [at('test/c.test.mjs')]])),
  };
  mkdirSync(join(base, 'spark-test-runs'));
  mapFile = join(base, 'spark-test-runs', 'whole-1.affected-map.json');
  writeFileSync(mapFile, JSON.stringify({ tree: git(top, 'rev-parse', 'HEAD^{tree}'), tests: TESTS, fns, missed: [] }));
});
after(() => rmSync(base, { recursive: true, force: true }));

// The pick for the folder as it is, then everything put back.
function pickNow(change, opts = {}) {
  change();
  try { return pick({ top, base: 'main', maps: findMaps(top, {}), ...opts }); } finally {
    git(top, 'reset', '-q', '--hard', 'HEAD');
    git(top, 'clean', '-q', '-fd');
  }
}
const withShort = (...files) => [...new Set([...SHORT_CHECK, ...files])].sort();

describe('pick', () => {
  test('a changed line in a function picks the test files that ran it, and always the short check', () => {
    const r = pickNow(() => edit(top, 'service/src/30-alpha.mjs', 'x + 1', 'x + 2'));
    assert.equal(r.all, false, r.why);
    assert.deepEqual(r.files, withShort('test/a.test.mjs'));
    assert.deepEqual(r.fns, ['30-alpha.mjs:one@2-5']);
    assert.match(r.why, /1 function in 30-alpha\.mjs; the short check \(from [0-9a-f]{7}, the last tested build\)/);
    // A nested function's own line: its test files; a function's first line when it only declares it: that function's.
    assert.deepEqual(pickNow(() => edit(top, 'service/src/30-alpha.mjs', 'n + 1', 'n + 2')).fns, ['30-alpha.mjs:(anonymous)@8-10']);
    assert.deepEqual(pickNow(() => edit(top, 'service/src/30-alpha.mjs', 'function one(x) {', 'function one(x, z) {')).files, withShort('test/a.test.mjs'));
    // A line added inside a function belongs to it; two functions in two parts give both.
    const both = pickNow(() => {
      edit(top, 'service/src/30-alpha.mjs', '  return y * 2;', '  return y * 2;\n  // more');
      edit(top, 'service/src/41-p1.mjs', 'return 1', 'return 2');
    });
    assert.deepEqual(both.files, withShort('test/a.test.mjs', 'test/d.test.mjs'));
  });

  test('a changed line outside any function answers all: top-level code, a top-level call\'s own line, a new function between two', () => {
    for (const change of [
      () => edit(top, 'service/src/30-alpha.mjs', 'a: 1', 'a: 2'),
      () => edit(top, 'service/src/31-beta.mjs', '}, 1000);', '}, 2000);'),
      () => edit(top, 'service/src/30-alpha.mjs', '}\n\nfunction two', '}\n\nfunction added() {\n  return 0;\n}\n\nfunction two'),
    ]) {
      const r = pickNow(change);
      assert.equal(r.all, true);
      assert.match(r.why, /^a changed line outside any function: 3\d-(alpha|beta)\.mjs line \d+/);
    }
  });

  test('every path on the always list answers all, each part on it too, and so do a part added or removed', () => {
    for (const f of [...ALWAYS_PATHS, ...ALWAYS_PARTS.map(p => `service/src/${p}`)]) {
      const r = pickNow(() => appendFileSync(join(top, f), '// changed\n'));
      assert.equal(r.all, true, f);
      assert.match(r.why, /is on the list that always runs everything/, f);
    }
    assert.match(pickNow(() => put(top, 'service/src/50-new.mjs', SMALL('fresh'))).why, /^a part was added: 50-new\.mjs/);
    assert.match(pickNow(() => rmSync(join(top, 'service/src/41-p1.mjs'))).why, /^a part was removed: 41-p1\.mjs/);
    // Not a part, a test or a document, and nothing in the map: all.
    const ui = pickNow(() => appendFileSync(join(top, 'public/app.js'), '// changed\n'), { maps: [] });
    assert.equal(ui.all, false);
    assert.ok(ui.files.includes('test/page.test.mjs'));
    assert.ok(ui.files.includes('test/page-preview.test.mjs'));
    assert.ok(ui.files.includes('test/door.test.mjs'));
    assert.ok(!ui.files.includes('test/install.test.mjs'));
    assert.equal(pickNow(() => put(top, 'public/new.js', 'new file')).all, true);
  });

  test('no map for the base or before it answers all; so do more than 8 parts and a function most test files run', () => {
    const change = () => edit(top, 'service/src/30-alpha.mjs', 'x + 1', 'x + 2');
    for (const maps of [[], [{ file: mapFile, map: { tree: '0'.repeat(40), tests: TESTS, fns: {}, missed: [] } }]]) {
      const r = pickNow(change, { maps });
      assert.equal(r.all, true);
      assert.match(r.why, /^no map for main or the 500 commits before it/);
    }
    const nine = pickNow(() => { for (const p of OTHER_PARTS) edit(top, `service/src/${p}`, 'return 1', 'return 9'); });
    assert.equal(nine.all, true);
    assert.match(nine.why, /^9 parts changed \(more than 8\)/);
    const most = pickNow(() => edit(top, 'service/src/31-beta.mjs', 'return 3', 'return 4'));
    assert.equal(most.all, true);
    assert.match(most.why, /^31-beta\.mjs three is run by 9 of 14 test files/);
  });

  test('documents alone pick the documents test alone, even with no map; with code they add it', () => {
    const r = pickNow(() => { appendFileSync(join(top, 'docs/guide.md'), 'More.\n'); appendFileSync(join(top, 'README.md'), 'More.\n'); }, { maps: [] });
    assert.deepEqual(r, { all: false, files: [DOCS_TEST], fns: [], why: 'documents only: the documents test alone' });
    const mixed = pickNow(() => { appendFileSync(join(top, 'docs/guide.md'), 'More.\n'); edit(top, 'service/src/30-alpha.mjs', 'x + 1', 'x + 2'); });
    assert.deepEqual(mixed.files, withShort('test/a.test.mjs', DOCS_TEST));
  });

  test('a changed or new test file is always picked; a removed one is not asked for', () => {
    assert.deepEqual(pickNow(() => appendFileSync(join(top, 'test/c.test.mjs'), '// more\n')).files, withShort('test/c.test.mjs'));
    assert.deepEqual(pickNow(() => put(top, 'test/e.test.mjs', '// new\n')).files, withShort('test/e.test.mjs'));
    assert.deepEqual(pickNow(() => rmSync(join(top, 'test/c.test.mjs'))).files, withShort());
  });
});

describe('the landing pick (--landing, what tools/land.mjs uses)', () => {
  const landing = { landing: true };
  test('the core parts use the map and the short check; so does a function most test files run', () => {
    for (const p of ALWAYS_PARTS.filter(p => !LANDING_ALWAYS_PARTS.includes(p))) {
      const change = () => edit(top, `service/src/${p}`, 'return 1', 'return 2');
      assert.equal(pickNow(change).all, true, p);
      const r = pickNow(change, landing);
      assert.equal(r.all, false, `${p}: ${r.why}`);
      assert.deepEqual(r.files, withShort('test/c.test.mjs'), p);
    }
    const most = pickNow(() => edit(top, 'service/src/31-beta.mjs', 'return 3', 'return 4'), landing);
    assert.deepEqual(most.files, withShort(...TESTS.slice(0, 9)));
  });

  test('comments alone add nothing; new functions require coverage before a narrow pick', () => {
    const comment = () => edit(top, 'service/src/30-alpha.mjs', '// alpha\n', '// alpha, said better\n// over two lines\n');
    assert.equal(pickNow(comment).all, true);
    assert.deepEqual(pickNow(comment, landing).files, withShort());
    const fresh = () => edit(top, 'service/src/30-alpha.mjs', '}\n\nfunction two', '}\n\n// A new one.\nfunction added(x) {\n  return x;\n}\n\nfunction two');
    assert.equal(pickNow(fresh).all, true);
    const r = pickNow(fresh, landing);
    assert.equal(r.all, true);
    assert.match(r.why, /^new functions have no measured coverage yet/);
    // A new function and a call of it at the top level: that call runs in every test.
    const called = () => edit(top, 'service/src/30-alpha.mjs', '}\n\nfunction two', '}\n\nfunction added(x) {\n  return x;\n}\nadded(1);\n\nfunction two');
    assert.match(pickNow(called, landing).why, /^a changed line outside any function: 30-alpha\.mjs line \d+/);
    // A comment beside code in the same hunk is code.
    assert.equal(pickNow(() => edit(top, 'service/src/30-alpha.mjs', 'const TABLE = { a: 1 };', '// a table\nconst TABLE = { a: 2 };'), landing).all, true);
  });

  test('service/config.json adds only the short check; what every test depends on still answers all', () => {
    const config = pickNow(() => appendFileSync(join(top, 'service/config.json'), '# changed\n'), landing);
    assert.deepEqual([config.all, config.files], [false, withShort()]);
    assert.match(config.why, /^service\/config\.json; the short check/);
    for (const f of [...ALWAYS_PATHS.filter(f => f !== 'service/config.json'), ...LANDING_ALWAYS_PARTS.map(p => `service/src/${p}`)]) {
      const r = pickNow(() => appendFileSync(join(top, f), '// changed\n'), landing);
      assert.equal(r.all, true, f);
      assert.match(r.why, /is on the list that always runs everything|is not in the map/, f);
    }
    // And the rest of 2.4's list holds: no map, a part added, a line outside any function, more than eight parts.
    const alpha = () => edit(top, 'service/src/30-alpha.mjs', 'x + 1', 'x + 2');
    assert.equal(pickNow(alpha, { ...landing, maps: [] }).all, true);
    assert.equal(pickNow(() => put(top, 'service/src/50-new.mjs', SMALL('fresh')), landing).all, true);
    assert.equal(pickNow(() => edit(top, 'service/src/30-alpha.mjs', 'a: 1', 'a: 2'), landing).all, true);
    assert.equal(pickNow(() => { for (const p of OTHER_PARTS) edit(top, `service/src/${p}`, 'return 1', 'return 9'); }, landing).all, true);
  });
});

describe('the base, and what the pick missed', () => {
  test('the change is measured from the newest commit of main with a map; a file once missed comes back for those functions', () => {
    // main moves on with no whole run behind it: the commit after the tested one changes one().
    edit(top, 'service/src/30-alpha.mjs', 'x + 1', 'x + 3');
    git(top, 'commit', '-q', '-am', 'one');
    const landed = git(top, 'rev-parse', 'HEAD');
    try {
      const r = pickNow(() => edit(top, 'service/src/30-alpha.mjs', 'n + 1', 'n + 2'));
      assert.deepEqual(r.files, withShort('test/a.test.mjs', 'test/b.test.mjs'));
      assert.equal(r.tested.commit, tested);
      assert.match(r.why, /the last tested build \(1 commit before main\)/);

      // Main's whole run then failed in c and a: a was picked for one(), c was not, so c is missed and kept.
      const log = '\nSeconds per test file, longest first (3 files):\n   12.0  FAIL  test/c.test.mjs\n    3.1  FAIL  test/a.test.mjs\n    1.0  pass  test/b.test.mjs\n';
      assert.deepEqual(failedIn(log), ['test/c.test.mjs', 'test/a.test.mjs']);
      const m = noteMissed({ top, failed: failedIn(log), ref: landed, maps: findMaps(top, {}), at: '2026-11-14T00:00:00Z' });
      assert.deepEqual(m.missed, ['test/c.test.mjs']);
      assert.deepEqual(JSON.parse(readFileSync(mapFile, 'utf8')).missed, [{ file: 'test/c.test.mjs', fns: ['30-alpha.mjs:one'], at: '2026-11-14T00:00:00Z' }]);
      const again = pickNow(() => edit(top, 'service/src/30-alpha.mjs', '  return y * 2;', '  return y * 4;'));
      assert.deepEqual(again.files, withShort('test/a.test.mjs', 'test/c.test.mjs'));
      assert.match(again.why, /1 once missed by the pick/);
    } finally {
      git(top, 'reset', '-q', '--hard', tested);
      const map = JSON.parse(readFileSync(mapFile, 'utf8'));
      writeFileSync(mapFile, JSON.stringify({ ...map, missed: [] }));
    }
  });
});

describe('build', () => {
  test('a map from real coverage: a function only one of two test files runs lists only that one', { timeout: 120000 }, () => {
    const root = mkdtempSync(join(tmpdir(), 'sct-affected-build-')), cover = join(root, 'cover');
    try {
      put(root, 'service/src/30-x.mjs', 'function onlyOne() {\n  return 1;\n}\nfunction both() {\n  return [2].map(n => n);\n}\n');
      put(root, 'service/src/31-y.mjs', 'both();\nif (process.argv[2] === \'one\') onlyOne();\n');
      writeFileSync(join(root, 'service/server.mjs'), ['30-x.mjs', '31-y.mjs'].map(f => readFileSync(join(root, 'service/src', f), 'utf8')).join(''));
      for (const n of ['one', 'two']) {
        put(root, `test/${n}.test.mjs`, `import { test } from 'node:test';\nimport { execFileSync } from 'node:child_process';\n`
          + `test('${n}', () => { execFileSync(process.execPath, [new URL('../service/server.mjs', import.meta.url).pathname, '${n}']); });\n`);
      }
      // As test/lock.mjs runs the suite with SPARK_TEST_MAP=1: each file's coverage in a folder named after it.
      const { NODE_TEST_CONTEXT: _, ...env } = process.env;
      const r = spawnSync(process.execPath, ['--test', `--import=${EACH_FILE}`, 'test/*.test.mjs'], { cwd: root, encoding: 'utf8', env: { ...env, NODE_V8_COVERAGE: cover } });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const map = buildMap(cover, { root, tests: ['test/one.test.mjs', 'test/two.test.mjs'], tree: 'a'.repeat(40) });
      assert.equal(map.tree, 'a'.repeat(40));
      assert.deepEqual(map.missed, []);
      assert.deepEqual(map.fns, {
        '30-x.mjs:onlyOne@1-3': [0],
        '30-x.mjs:both@4-6': [0, 1],
        '30-x.mjs:(anonymous)@5-5': [0, 1],
      });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

// The "always" lists name parts by their file name: one renamed would drop off them in silence, so a change to it would
// stop running everything. checkAffected says so, and tools/make.mjs fails with it.
test('each part the always lists name is in service/src/; one that isn’t is said, with the list it is on', () => {
  const root = mkdtempSync(join(tmpdir(), 'affected-names-'));
  try {
    mkdirSync(join(root, 'service', 'src'), { recursive: true });
    const gone = '14-rounds.mjs', landingGone = '22-sessions.mjs';
    for (const p of new Set([...ALWAYS_PARTS, ...LANDING_ALWAYS_PARTS])) if (p !== gone && p !== landingGone) writeFileSync(join(root, 'service', 'src', p), '\n');
    writeFileSync(join(root, 'service', 'src', '14-turns.mjs'), '\n');
    assert.deepEqual(checkAffected(root).map(p => [p.check, p.file, p.message.split(':')[0]]), [
      ['affected', 'tools/parts.mjs', `names ${gone} (ALWAYS_PARTS), which service/src/ doesn’t have`],
      ['affected', 'tools/parts.mjs', `names ${landingGone} (ALWAYS_PARTS, LANDING_ALWAYS_PARTS), which service/src/ doesn’t have`]]);
    assert.deepEqual(checkAffected(), [], 'this tree');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Importing a pure part directly must not make its tests disappear from the generated-server coverage pick.
test('a changed brain adapter includes its direct-import tests as well as measured integration coverage', () => {
  const r = choose({ landing: true,
    map: { tests: ['test/brain.test.mjs'], fns: { '13-ask.mjs:askBlock@1-3': [0] } },
    changes: [{ path: 'service/src/13-ask.mjs', status: 'M', hunks: [{ s: 2, n: 1, t: 2, add: ['  return 2;'] }] }],
    oldText: () => 'function askBlock() {\n  return 1;\n}',
    newText: () => 'function askBlock() {\n  return 2;\n}',
  });
  assert.equal(r.all, false, r.why);
  assert.ok(r.files.includes('test/brain-ask.test.mjs'));
  assert.ok(existsSync(new URL('./brain-ask.test.mjs', import.meta.url)), 'the declared direct test exists');
  assert.ok(r.files.includes('test/brain.test.mjs'));
});

// Source fixtures also bypass server.mjs coverage, including masking at the agent door.
test('context policy and intent fixtures stay selected when their source changes', () => {
  for (const [part, direct] of [
    ['17-context.mjs', 'test/context-policy.test.mjs'],
    ['16-actions.mjs', 'test/context-intent.test.mjs'],
    ['16-actions.mjs', 'test/intent-isolation.test.mjs'],
    ['20-mcp.mjs', 'test/context-intent.test.mjs'],
  ]) {
    const r = choose({ landing: true,
      map: { tests: ['test/context-start.test.mjs'], fns: { [`${part}:sample@1-3`]: [0] } },
      changes: [{ path: `service/src/${part}`, status: 'M', hunks: [{ s: 2, n: 1, t: 2, add: ['  return 2;'] }] }],
      oldText: () => 'function sample() {\n  return 1;\n}',
      newText: () => 'function sample() {\n  return 2;\n}',
    });
    assert.equal(r.all, false, r.why);
    assert.ok(r.files.includes(direct), `${part} selects ${direct} without measured coverage`);
    assert.ok(existsSync(new URL(`../${direct}`, import.meta.url)), 'the declared test exists');
    assert.ok(r.files.includes('test/context-start.test.mjs'), 'measured integration coverage stays selected');
    for (const required of SHORT_CHECK) assert.ok(r.files.includes(required), required);
  }
});

// Recovery error fixtures exercise the primary reader directly, outside measured service coverage.
test('saved-run record edits select the content-free error regression', () => {
  const r = choose({ landing: true,
    map: { tests: ['test/workloads-record.test.mjs'], fns: { '18-run-record.mjs:savedRunsNow@1-3': [0] } },
    changes: [{ path: 'service/src/18-run-record.mjs', status: 'M', hunks: [{ s: 2, n: 1, t: 2, add: ['  return 2;'] }] }],
    oldText: () => 'function savedRunsNow() {\n  return 1;\n}',
    newText: () => 'function savedRunsNow() {\n  return 2;\n}',
  });
  assert.equal(r.all, false, r.why);
  assert.ok(r.files.includes('test/workloads-record-errors.test.mjs'));
  assert.ok(existsSync(new URL('./workloads-record-errors.test.mjs', import.meta.url)));
  assert.ok(r.files.includes('test/workloads-record.test.mjs'), 'measured service coverage is retained');
  for (const required of SHORT_CHECK) assert.ok(r.files.includes(required), required);
});


// Ownership fixtures call source functions directly; service coverage cannot account for those boundary cases.
test('self-test ownership fixtures stay selected without a measured edge to their source', () => {
  for (const part of ['17-changes.mjs', '17-rollback.mjs', '18-step-jobs.mjs', '20-desired.mjs', '21-apps.mjs', '21-selftest.mjs']) {
    const r = choose({ landing: true,
      map: { tests: ['test/selftest.test.mjs'], fns: { [`${part}:sample@1-3`]: [0] } },
      changes: [{ path: `service/src/${part}`, status: 'M', hunks: [{ s: 2, n: 1, t: 2, add: ['  return 2;'] }] }],
      oldText: () => 'function sample() {\n  return 1;\n}',
      newText: () => 'function sample() {\n  return 2;\n}',
    });
    assert.equal(r.all, false, r.why);
    assert.ok(r.files.includes('test/selftest-ownership.test.mjs'), `${part} selects the ownership boundary cases`);
    assert.ok(r.files.includes('test/selftest.test.mjs'), 'measured integration coverage stays selected');
    for (const required of SHORT_CHECK) assert.ok(r.files.includes(required), required);
  }
  assert.ok(existsSync(new URL('./selftest-ownership.test.mjs', import.meta.url)), 'the selected fixture exists');
});
