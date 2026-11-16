// Covers: The documents match the code (`tools/check-docs.mjs`): on this tree, and on a made-up tree with one fault at
// a time (an id, a path, a name, an action, a line pointer, a typed count, a size, a heading, the task table, a stale
// rules index); dated records are never checked, nor the lock's path. `--sizes`: every document's bytes, limit and
// free bytes, the fullest first. `node tools/make.mjs --check` passes and changes
// nothing. The parts' headers (`tools/parts.mjs`): every part has one and it matches its code, `docs/registry.md` is
// current, and `desired.json`'s six writers are found; on made-up parts, one fault each (no header, a missing key, a
// header cut short, with the registry and code map still made, a rule or test that isn't there, an undeclared or a
// declared-but-absent writer, a state file nobody owns, a helper writing a file it is given, an undeclared repeating
// timer, an unlisted event or job type, a part outside its band, brackets it can't read). Each test file's “Covers:”
// comment and `test/covers.md` made from them: no comment, an empty one, a name in it the code doesn't have, a stale
// table. `docs/status.md` (`tools/status.mjs`): a row per rule and contract requirement; built, partly from tests that
// hold part of an acceptance test (`// T2 (part): …`), and a part mark that says no part fails. The meaning diff
// (`tools/meaning.mjs`): between two made-up trees, by id, exactly the contract requirements, acceptance tests, section
// words, Rule paragraphs and glossary meanings whose words changed, and rule files added or removed; never a re-wrap, a
// text moved, a Where line or a pointer fixed; the command's output and exit, and a commit as a tree.
//
// The documents match the code: tools/check-docs.mjs, the same code tools/make.mjs runs. File reads only, no server.
// First on this tree; then on a small made-up tree that passes, with one fault added at a time, so each check is
// shown to fail on the drift it is for.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { REPO } from './start-mock.mjs';
import { checkDocs, rulesIndex, coversOf, coversTable, sizesReport, sizesText, describe as say } from '../tools/check-docs.mjs';
import { checkParts, readParts, registry, owned } from '../tools/parts.mjs';
import { codeMap } from '../tools/code-map.mjs';
import { checkStatus, statusTable } from '../tools/status.mjs';
import { meaningDiff, treeAt } from '../tools/meaning.mjs';

test('this tree: the documents match the code', () => {
  const problems = checkDocs(REPO);
  assert.deepEqual(problems.map(say), []);
});

test('node tools/make.mjs --check passes here and changes nothing', () => {
  const files = ['service/server.mjs', 'docs/code-map.md', 'docs/rules.md'];
  const before = files.map(f => [readFileSync(join(REPO, f), 'utf8'), statSync(join(REPO, f)).mtimeMs]);
  const r = spawnSync(process.execPath, [join(REPO, 'tools', 'make.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(files.map(f => [readFileSync(join(REPO, f), 'utf8'), statSync(join(REPO, f)).mtimeMs]), before);
});

// A small tree with every kind of thing the checks read: two parts, a test file, the contract, a rule, a card.
const RULE = n => `# R${n}\n\n## Rule\n\n**R${n}.** Every change goes through \`runAction\`. Today: one page route skips it.\n\n## Why\n\nOne way in.\n\n## Today\n\nMarked “Today:” in the Rule text above.\n\n## Where\n\n- \`16-actions.mjs\` (\`runAction\`)\n\n## Checked by\n\n- test: \`change.test.mjs\` (“a choice is used once”)\n`;
const CARD = `# Add an action\n\n## Touch\n\n- \`action\` in \`16-actions.mjs\`.\n\n## Also update\n\n- \`TOOLS\` in \`test/lib.mjs\`.\n\n## Never\n\n- A second route.\n\n## Rules\n\n- R1.\n\n## Tests\n\n- \`change.test.mjs\`.\n\n## Copy from\n\n- \`fleet_status\` in \`16-actions.mjs\`.\n`;
const BASE = {
  'service/src/16-actions.mjs': `function action(a) {}\nasync function runAction(name) {}\naction({\n  name: 'fleet_status', title: 'Fleet status', kind: 'read',\n});\n// R1, contract 8.3, T1\n`,
  'service/src/17-changes.mjs': 'async function startModel(args) {}\n',
  'test/change.test.mjs': "// T1: a start\ntest('a choice is used once, alone, and only by whoever was asked', () => {});\n",
  'test/lib.mjs': "export const TOOLS = ['fleet_status'];\n",
  'docs/contract.md': '# Contract\n\n## 8. What it may do\n\n- 8.3 It never changes SSH.\n\n## 11. Acceptance tests\n\n| # | Request |\n|---|---|\n| T1 | "start a model" |\n',
  'docs/rules/R01.md': RULE(1),
  'docs/how/add-an-action.md': CARD,
  'AGENTS.md': '# Working on it\n\nRead this, then one card. Keep R1. Never change SSH (contract 8.3).\n\n| I want to … | Card |\n|---|---|\n| add an action | `docs/how/add-an-action.md` |\n',
  'docs/architecture.md': '# The map\n\n`runAction` (`16-actions.mjs`) runs every action; `startModel` in `17-changes.mjs` starts a model.\n',
};

function makeTree(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'docs-check-'));
  const files = { ...BASE, ...extra };
  for (const [f, text] of Object.entries(files)) {
    if (text == null) continue;
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), text);
  }
  if (!('docs/rules.md' in extra)) writeFileSync(join(root, 'docs/rules.md'), rulesIndex(root));
  return root;
}
const problemsWith = extra => { const root = makeTree(extra); try { return checkDocs(root); } finally { rmSync(root, { recursive: true, force: true }); } };
// The fault is found, by the check it is for, and nothing else is.
function fails(extra, check, pattern) {
  const problems = problemsWith(extra);
  assert.ok(problems.length > 0, `no problem found for ${JSON.stringify(Object.keys(extra))}`);
  for (const p of problems) {
    assert.equal(p.check, check, say(p));
    assert.match(p.message, pattern, say(p));
  }
}
const doc = text => ({ 'docs/notes.md': `# Notes\n\n${text}\n` });

test('the made-up tree passes as it is', () => {
  assert.deepEqual(problemsWith({}).map(say), []);
});

test('a .gitattributes anywhere, in any case, is a problem: git archive would obey it, and pull.sh refuses the tree', () => {
  for (const f of ['public/.gitattributes', 'docs/.GitAttributes', '.gitattributes']) {
    fails({ [f]: 'app.js export-ignore\n' }, 'attributes', /is a \.gitattributes file: git archive obeys it/);
  }
});

describe('ids', () => {
  test('a rule id no file defines', () => fails(doc('Keep R41.'), 'ids', /R41/));
  test('a contract id the contract does not define', () => fails(doc('As contract 8.99 says.'), 'ids', /contract 8\.99/));
  test('an acceptance test the contract does not have', () => fails(doc('T7 checks it.'), 'ids', /T7/));
  test('in a part', () => fails({ 'service/src/17-changes.mjs': '// R77 says so\nasync function startModel(args) {}\n' }, 'ids', /R77/));
  test('in a test file, in a comment', () => fails({ 'test/change.test.mjs': "// T99: gone\ntest('a choice is used once, alone', () => {});\n" }, 'ids', /T99/));
});

describe('paths', () => {
  test('a document that moved away', () => fails(doc('See `docs/sparkie-actions.md`.'), 'paths', /docs\/sparkie-actions\.md/));
  test('a test file that is gone', () => fails(doc('Run `test/gone.test.mjs`.'), 'paths', /test\/gone\.test\.mjs/));
  test('a part that is gone', () => fails(doc('It is in `99-gone.mjs`.'), 'paths', /99-gone\.mjs/));
  test('a part named without .mjs', () => fails(doc('It is in `21-gone`.'), 'paths', /21-gone/));
  // A fresh clone, GitHub and the copy sent to a Spark have no lock until node test/lock.mjs writes one, and that
  // runs this test first. The made-up tree never has it, so this fails without the line in NOT_PATHS on any machine.
  test('the lock, which git does not keep, is never a missing path', () => {
    assert.deepEqual(problemsWith(doc('The lock is `service/workflows.lock.json`.')).map(say), []);
  });
});

describe('names', () => {
  test('a function given with the wrong part', () => fails(doc('`17-changes.mjs` (`runAction`)'), 'names', /runAction.*17-changes/));
  test('a function put in the wrong part', () => fails(doc('`runAction` in `17-changes.mjs` runs it.'), 'names', /runAction.*17-changes/));
  test('a test name that no test has', () => fails(doc('`change.test.mjs` (“a choice is used twice”)'), 'names', /a choice is used twice/));
  test('a function that is nowhere in the code', () => fails(doc('`noSuchThing` does it.'), 'names', /noSuchThing/));
  test('an action that does not exist', () => fails(doc('Sparkie calls `propose_start`.'), 'actions', /propose_start/));
});

describe('line pointers', () => {
  test('a part and a line', () => fails(doc('See `16-actions.mjs:286`.'), 'lines', /16-actions\.mjs:286/));
  test('more lines after a comma', () => fails(doc('`16-actions.mjs` (`runAction`), :154'), 'lines', /:154/));
  test('a line on its own', () => fails(doc('`runAction` (`:220`)'), 'lines', /:220/));
});

describe('typed counts', () => {
  test('reads and changes', () => fails(doc('The registry holds 26 reads, 15 changes.'), 'counts', /26 reads, 15 changes/));
  test('parts', () => fails(doc('The service is 37 parts.'), 'counts', /37 parts/));
  test('every rule as a range', () => fails(doc('Keep R1–R1 always.'), 'counts', /R1–R1/));
  for (const limit of ['at most 24 tools', 'up to 12 tools', 'runs in 2 parts', '3 tools at once', '4 tools a round']) {
    test(`a limit is not a count: “${limit}”`, () => assert.deepEqual(problemsWith(doc(`The brain gets ${limit}.`)).map(say), []));
  }
});

describe('sizes', () => {
  test('AGENTS.md over 8 KB', () => fails({ 'AGENTS.md': `${BASE['AGENTS.md']}${'Short line.\n'.repeat(700)}` }, 'sizes', /over its limit of 8192/));
  test('the contract over 120 KB: made flat, it has no higher ceiling', () => fails({ 'docs/contract.md': `${BASE['docs/contract.md']}${'Short line.\n'.repeat(10500)}` }, 'sizes', /over its limit of 122880/));
  test('a card over 4 KB', () => fails({ 'docs/how/add-an-action.md': CARD.replace('- A second route.', `${'- A second route.\n'.repeat(250)}`) }, 'sizes', /over its limit of 4096/));
  test('a line over 400 characters', () => fails(doc('word '.repeat(90)), 'sizes', /line of 45\d characters/));
  test('docs/state-outside.md over 16 KB', () => fails({ 'docs/state-outside.md': `# Outside\n\n${'Short line.\n'.repeat(1400)}` }, 'sizes', /over its limit of 16384/));
});

// What is filling up: every document's bytes, limit and free bytes, the fullest first (node tools/check-docs.mjs --sizes).
describe('the sizes report', () => {
  test('each document with its bytes, its limit (its ceiling where it has one) and what is free, the fullest first', () => {
    const files = {
      'docs/how/add-an-action.md': CARD.replace('- A second route.', `- A second route.${' x'.repeat((4000 - Buffer.byteLength(CARD)) / 2)}`),
      'docs/agent-door.md': `# The agent door\n\n${'Short line.\n'.repeat(1300)}`,
      'docs/notes.md': `# Notes\n\n${'Short line.\n'.repeat(1300)}`,
      'REVIEW-GUIDE.md': '# Review\n\nOnly its paths are checked.\n',
    };
    const root = makeTree(files);
    try {
      const rows = sizesReport(root);
      const want = { 'docs/how/add-an-action.md': 4096, 'docs/agent-door.md': 17408, 'docs/notes.md': 16384, 'AGENTS.md': 8192, 'docs/contract.md': 122880,
        'docs/rules/R01.md': 8192, 'docs/architecture.md': 24576 };
      assert.deepEqual(rows.map(r => r.file).sort(), Object.keys(want).sort(), 'every document the size check reads, and no other');
      for (const r of rows) {
        assert.equal(r.bytes, Buffer.byteLength(readFileSync(join(root, r.file))), r.file);
        assert.equal(r.limit, want[r.file], r.file);
        assert.equal(r.free, r.limit - r.bytes, r.file);
      }
      assert.deepEqual(rows.map(r => r.free), rows.map(r => r.free).sort((a, b) => a - b), 'the fullest first');
      assert.deepEqual(rows.slice(0, 2).map(r => [r.file, r.free]), [['docs/how/add-an-action.md', 96], ['docs/notes.md', 775]]);
      // over its limit: the free bytes go below zero, and it comes first
      writeFileSync(join(root, 'docs/notes.md'), `# Notes\n\n${'Short line.\n'.repeat(1400)}`);
      assert.deepEqual([sizesReport(root)[0].file, sizesReport(root)[0].free], ['docs/notes.md', 16384 - Buffer.byteLength(readFileSync(join(root, 'docs/notes.md')))]);
      assert.ok(sizesReport(root)[0].free < 0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  test('the command prints that report for this tree, a line a document under its header, and exits 0', () => {
    const r = spawnSync(process.execPath, [join(REPO, 'tools', 'check-docs.mjs'), '--sizes'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, `${sizesText(sizesReport(REPO))}\n`);
    const lines = r.stdout.trim().split('\n');
    assert.match(lines[0], /^Document\s+Bytes\s+Limit\s+Free$/);
    const rows = lines.slice(1).map(l => l.trim().split(/\s+/));
    assert.ok(rows.every(c => c.length === 4 && Number(c[2]) - Number(c[1]) === Number(c[3])), 'bytes, limit and free add up on every line');
    assert.deepEqual(rows.map(c => Number(c[3])), rows.map(c => Number(c[3])).sort((a, b) => a - b), 'the fullest first');
    for (const [f, limit] of [['docs/state.md', '24576'], ['docs/state-outside.md', '16384']]) assert.equal(rows.find(c => c[0] === f)?.[2], limit, f);
  });
});

describe('shape', () => {
  test('a rule file without its Today heading', () => fails({ 'docs/rules/R01.md': RULE(1).replace('## Today\n\nMarked “Today:” in the Rule text above.\n\n', '') }, 'shape', /Today/));
  test('a card without its Never heading', () => fails({ 'docs/how/add-an-action.md': CARD.replace('## Never\n\n- A second route.\n\n', '') }, 'shape', /Never/));
  test('a card the task table does not list', () => fails({ 'docs/how/add-a-route.md': CARD.replace('Add an action', 'Add a route') }, 'shape', /add-a-route\.md/));
  test('a task table row whose card is gone', () => {
    const problems = problemsWith({ 'docs/how/add-an-action.md': null });
    assert.ok(problems.some(p => p.check === 'shape' && /no such card/.test(p.message)), problems.map(say).join('\n'));
  });
  test('docs/rules.md not what docs/rules/ makes', () => fails({ 'docs/rules.md': '# Rules\n\n- R1: something else.\n' }, 'shape', /docs\/rules\/.*make\.mjs/));
});

describe('tool groups (R46)', () => {
  // A tree whose actions part has GROUP_WORDS: each action's group is read from its own line.
  const WORDS = "const GROUP_WORDS = [\n  ['dig', 'why something failed', /\\bwhy\\b/i],\n  ['find', 'which model', /\\bmodels?\\b/i],\n];\n";
  const grouped = list => ({ 'service/src/16-actions.mjs': `function action(a) {}\nasync function runAction(name) {}\n${WORDS}${list.map(([name, group]) =>
    `action({\n  name: '${name}', title: 'A ${name}', kind: 'read', scope: 'fleet:read', who: 'owner',${group ? ` group: '${group}',` : ''}\n});\n`).join('')}// R1, contract 8.3, T1\n` });
  // (action names are letters and underscores)
  const many = (n, group) => Array.from({ length: n }, (_, i) => [`look_${group}_${String.fromCharCode(97 + i)}`, group]);
  test('every action in a group, the core within 12 and each group within 6: no problem', () => {
    assert.deepEqual(problemsWith(grouped([['fleet_status', 'core'], ...many(11, 'core'), ...many(6, 'dig'), ...many(1, 'find')])).map(say), []);
  });
  test('an action with no group: the message says what to add, and where', () => fails(grouped([['fleet_status', 'core'], ['operation_log', null]]), 'groups',
    /^the action operation_log has no group: add group: '…' at the end of its line \(name: 'operation_log', title: …\), with core or one of dig, find \(GROUP_WORDS in service\/src\/16-actions\.mjs\)$/));
  test('a group GROUP_WORDS doesn’t have', () => fails(grouped([['fleet_status', 'core'], ['operation_log', 'digging']]), 'groups', /operation_log has the group digging, which isn’t one/));
  test('a group over six', () => fails(grouped([['fleet_status', 'core'], ...many(7, 'dig')]), 'groups', /^the group dig has 7 actions .*at most 6/));
  test('a core over twelve', () => fails(grouped([['fleet_status', 'core'], ...many(12, 'core')]), 'groups', /^the core has 13 actions .*at most 12/));
});

describe('what is never checked', () => {
  test('dated records: docs/history/, docs/design-2026-11-13/ and docs/review-astra/', () => {
    const fault = '# Old\n\nR99, `16-actions.mjs:286`, 26 reads, 15 changes, `propose_start`, `docs/gone.md`.\n';
    assert.deepEqual(problemsWith({ 'docs/history/old.md': fault, 'docs/design-2026-11-13/x.md': fault, 'docs/review-astra/reply.md': fault }).map(say), []);
    assert.ok(problemsWith({ 'docs/notes.md': fault }).length > 0, 'the same text outside them is found');
  });
  test('REVIEW-GUIDE.md: only its paths', () => {
    assert.deepEqual(problemsWith({ 'REVIEW-GUIDE.md': '# Review\n\nThe service is 37 parts; `16-actions.mjs:286`.\n' }).map(say), []);
    fails({ 'REVIEW-GUIDE.md': '# Review\n\nRead `docs/reviews-2026-11-11.md`.\n' }, 'paths', /docs\/reviews-2026-11-11\.md/);
  });
});

// test/covers.md (tools/check-docs.mjs, the same code tools/make.mjs runs): one row per test file, the comment at its
// very top (“// Covers: …”), which is the only place a test file's description is written.
test('this tree: test/covers.md is what the test files’ “Covers:” comments make', () => {
  assert.equal(readFileSync(join(REPO, 'test/covers.md'), 'utf8'), coversTable(REPO));
});

// The made-up tree with its test file headed and its table made; each test below adds one fault.
const HEADED = { 'test/change.test.mjs': `// Covers: A choice is used once, alone, by whoever was asked (\`runAction\` in\n// \`16-actions.mjs\`).\n//\n${BASE['test/change.test.mjs']}` };
function coversTree(extra) {
  const root = makeTree({ ...HEADED, ...extra });
  if (!('test/covers.md' in extra)) writeFileSync(join(root, 'test/covers.md'), coversTable(root));
  return root;
}
const coversProblems = extra => { const root = coversTree(extra); try { return checkDocs(root); } finally { rmSync(root, { recursive: true, force: true }); } };
const coversMade = extra => { const root = coversTree(extra); try { return readFileSync(join(root, 'test/covers.md'), 'utf8'); } finally { rmSync(root, { recursive: true, force: true }); } };
function coversFail(extra, check, pattern) {
  const problems = coversProblems(extra);
  assert.ok(problems.length > 0, `no problem found for ${JSON.stringify(Object.keys(extra))}`);
  for (const p of problems) {
    assert.equal(p.check, check, say(p));
    assert.match(`${p.file}: ${p.message}`, pattern, say(p));
  }
}

describe('what each test file covers', () => {
  test('the made-up tree passes as it is, and its table has the comment as the file’s row', () => {
    assert.deepEqual(coversProblems({}).map(say), []);
    assert.match(coversMade({}), /^\| `change\.test\.mjs` \| A choice is used once, alone, by whoever was asked \(`runAction` in `16-actions\.mjs`\)\. \|$/m);
  });
  test('the comment is the first line and the lines below it that start with “// ”, up to “//” alone or code', () => {
    assert.equal(coversOf('// Covers: one\n// two\n//\n// three\ntest();\n'), 'one two');
    assert.equal(coversOf('// Covers: one\n// two\ntest();\n'), 'one two');
    assert.equal(coversOf("import x from 'y';\n// Covers: too late\n"), null);
    assert.equal(coversOf('// Covers:\n//\ntest();\n'), '');
  });
  test('a test file with no “Covers:” comment', () => coversFail({ 'test/change.test.mjs': BASE['test/change.test.mjs'] }, 'covers', /^test\/change\.test\.mjs: has no “Covers:” comment at its top/));
  test('a comment at the top that isn’t “Covers:”', () => coversFail({ 'test/change.test.mjs': `// A choice is used once.\n${BASE['test/change.test.mjs']}` }, 'covers', /^test\/change\.test\.mjs: has no “Covers:” comment/));
  test('a “Covers:” comment with nothing after it', () => coversFail({ 'test/change.test.mjs': `// Covers:\n//\n${BASE['test/change.test.mjs']}` }, 'covers', /^test\/change\.test\.mjs: .*nothing after it/));
  test('a name in the comment that the code doesn’t have', () => coversFail({ 'test/change.test.mjs': `// Covers: \`noSuchThing\` is used once.\n${BASE['test/change.test.mjs']}` }, 'names', /^test\/change\.test\.mjs: .*noSuchThing/));
  test('a table made before a test file was added', () => coversFail({ 'test/stop.test.mjs': "// Covers: A stop is confirmed.\ntest('a stop', () => {});\n", 'test/covers.md': coversMade({}) }, 'covers', /^test\/covers\.md: is not what .* make: run node tools\/make\.mjs/));
  test('a table edited by hand', () => coversFail({ 'test/covers.md': coversMade({}).replace('used once', 'used twice') }, 'covers', /^test\/covers\.md: is not what/));
});

// The parts' headers (tools/parts.mjs, the same code tools/make.mjs runs): what a header declares by hand (its area,
// rules, tests, the state files it owns and their writers, its timers) is checked against what the code does.
test('this tree: every part has its header, and each header matches its code', () => {
  assert.deepEqual(checkParts(REPO).map(say), []);
});

test('this tree: docs/registry.md is what the parts make', () => {
  assert.equal(readFileSync(join(REPO, 'docs/registry.md'), 'utf8'), registry(REPO));
});

// R22 listed desired.json's six writers by hand; the scanner finds each of them in the code, and what it finds is
// exactly what 20-desired's header declares (a new writer joins the header, not this test).
test('this tree: desired.json’s six writers are found in the code', () => {
  const tree = readParts(REPO), found = new Set(tree.writes.filter(w => w.file === 'desired.json').map(w => w.who));
  for (const w of ['desiredAfter', 'watchHeld', 'markUndone', 'handler', 'keepApp', 'forgetApp']) assert.ok(found.has(w), `${w} isn’t found writing desired.json`);
  const owns = tree.parts.find(p => p.file === '20-desired.mjs').header.fields.Owns;
  assert.deepEqual([...found].sort(), owned(owns).find(o => o.file === 'desired.json').writers.sort());
});

// A small tree of parts with headers that pass; each test below adds one fault.
const HEAD = (title, { area = 'core', rules = 'R1', tests = 'change.test.mjs', owns = 'none', timers = 'none' } = {}) =>
  `/* ───────── ${title} ───────── */\n// Area: ${area}        Rules: ${rules}        Tests: ${tests}\n// Owns: ${owns}\n// Timers: ${timers}        Wakes: none\n`;
const DESIRED = "const DESIRED_FILE = `${STATE_DIR}/desired.json`;\nfunction desiredAfter(job) {\n  try { writePrivate(DESIRED_FILE, { running: [] }); } catch {}\n  fleetEvent({ type: job.ok ? 'started' : 'notice' });\n}\nasync function watchHeld() {}\nsetInterval(watchHeld, 60000);\n";
const PARTS = {
  'service/src/07-jobs.mjs': `${HEAD('jobs', { area: 'ground' })}function runJob(job) { return newJob(job.two ? 'deploy-cluster' : 'deploy', {}); }\n`,
  'service/src/16-actions.mjs': `${HEAD('actions')}${BASE['service/src/16-actions.mjs']}const EVENT_TYPES = ['started', 'notice'];\n`,
  'service/src/17-changes.mjs': `${HEAD('changes')}${BASE['service/src/17-changes.mjs']}`,
  'service/src/20-desired.mjs': `${HEAD('what should be running', { area: 'record', owns: 'desired.json (writers: desiredAfter)', timers: 'watchHeld (every 60 s)' })}${DESIRED}`,
  'docs/rules/R13.md': RULE(13).replace('Every change goes through', 'Jobs `deploy` and `deploy-cluster` claim; every change goes through'),
};
const partsProblems = extra => { const root = makeTree({ ...PARTS, ...extra }); try { return checkParts(root); } finally { rmSync(root, { recursive: true, force: true }); } };
function partsFail(extra, pattern) {
  const problems = partsProblems(extra);
  assert.ok(problems.length > 0, `no problem found for ${JSON.stringify(Object.keys(extra))}`);
  for (const p of problems) {
    assert.equal(p.check, 'parts', say(p));
    assert.match(p.message, pattern, say(p));
  }
  return problems;
}
const part = (name, head, body) => ({ [`service/src/${name}`]: `${head}${body}` });

describe('headers', () => {
  test('the made-up parts pass as they are', () => assert.deepEqual(partsProblems({}).map(say), []));
  test('a part with no header, and the message gives the header to add', () => {
    const [p] = partsFail({ 'service/src/20-desired.mjs': DESIRED }, /has no header/);
    assert.match(p.message, /\/\* ─+ .+ ─+ \*\/\n\/\/ Area: record or safety {2,}Rules: .+ {2,}Tests: .+\n\/\/ Owns: desired\.json \(writers: desiredAfter\)\n\/\/ Timers: watchHeld \(every …\) {2,}Wakes: none/);
  });
  test('a header without one of its keys', () => partsFail({ 'service/src/17-changes.mjs': PARTS['service/src/17-changes.mjs'].replace('        Wakes: none', '') }, /without Wakes/));
  test('a rule no file defines', () => partsFail(part('17-changes.mjs', HEAD('changes', { rules: 'R1, R77' }), BASE['service/src/17-changes.mjs']), /R77/));
  test('a test file that is not in test/', () => partsFail(part('17-changes.mjs', HEAD('changes', { tests: 'gone.test.mjs' }), BASE['service/src/17-changes.mjs']), /gone\.test\.mjs/));
  test('a writer of a state file its owner doesn’t declare', () => partsFail(part('24-handler.mjs', HEAD('handler', { area: 'ways in' }), 'async function handler(req, res) {\n  const d = {};\n  writePrivate(DESIRED_FILE, d);\n}\n'), /doesn’t declare handler \(24-handler\.mjs, writePrivate\) as a writer of desired\.json/));
  test('a declared writer that doesn’t write the file', () => partsFail(part('20-desired.mjs', HEAD('what should be running', { area: 'record', owns: 'desired.json (writers: desiredAfter, keepApp)', timers: 'watchHeld (every 60 s)' }), DESIRED), /declares keepApp as a writer of desired\.json/));
  test('a state file its part doesn’t own', () => partsFail({ 'service/src/17-changes.mjs': `${PARTS['service/src/17-changes.mjs']}const MEMORY_FILE = \`\${STATE_DIR}/memory.json\`;\n` }, /keeps memory\.json but its Owns line doesn’t list it: add “memory\.json \(writers: none\)”/));
  test('a function that writes a file it is given', () => partsFail({ 'service/src/17-changes.mjs': `${PARTS['service/src/17-changes.mjs']}function saveJson(file, value) { writeFileSync(\`\${file}.tmp\`, JSON.stringify(value)); }\n` }, /saveJson writes a file it is given/));
  test('a repeating timer nobody declared', () => partsFail({ 'service/src/17-changes.mjs': `${PARTS['service/src/17-changes.mjs']}setInterval(() => startModel({}), 5000);\n` }, /repeating timer nobody declared \(setInterval in top level, calling startModel\)/));
  test('a timeout that calls its own function again repeats too', () => partsFail({ 'service/src/17-changes.mjs': `${PARTS['service/src/17-changes.mjs']}function poll() { setTimeout(() => poll(), 1000); }\n` }, /calling poll/));
  test('a declared timer the part doesn’t have', () => partsFail(part('20-desired.mjs', HEAD('what should be running', { area: 'record', owns: 'desired.json (writers: desiredAfter)', timers: 'watchHeld (every 60 s), gone (hourly)' }), DESIRED), /declares the timer gone/));
  test('an event type EVENT_TYPES doesn’t list', () => partsFail({ 'service/src/17-changes.mjs': `${PARTS['service/src/17-changes.mjs']}function boom() { fleetEvent({ type: 'exploded' }); }\n` }, /“exploded” \(boom in 17-changes\.mjs\).*EVENT_TYPES/));
  test('an event type that can’t be read', () => partsFail({ 'service/src/17-changes.mjs': `${PARTS['service/src/17-changes.mjs']}function boom(kind) { fleetEvent({ type: kind }); }\n` }, /type can’t be read/));
  test('an operation type R13 doesn’t name', () => partsFail({ 'service/src/17-changes.mjs': `${PARTS['service/src/17-changes.mjs']}function powerOff() { return newJob('power-off', {}); }\n` }, /“power-off” \(powerOff in 17-changes\.mjs\).*R13/));
  test('a part outside its band', () => partsFail(part('07-jobs.mjs', HEAD('jobs', { area: 'core' }), PARTS['service/src/07-jobs.mjs'].split('\n').slice(4).join('\n')), /numbered 07, but its Area, core, is the band 16–19/));
  test('an area that isn’t one', () => partsFail(part('17-changes.mjs', HEAD('changes', { area: 'workloads' }), BASE['service/src/17-changes.mjs']), /an area is one of/));
  test('a ground part with an action', () => partsFail({ 'service/src/07-jobs.mjs': `${PARTS['service/src/07-jobs.mjs']}action({\n  name: 'jobs_list', title: 'Jobs', kind: 'read',\n});\n` }, /ground part .* defines jobs_list/));
  test('a part whose brackets don’t match can’t be read', () => partsFail({ 'service/src/17-changes.mjs': `${PARTS['service/src/17-changes.mjs']}function half() {\n` }, /can’t be read/));
  // tools/make.mjs makes the registry and the code map before it runs the check, so neither may throw on a part a
  // builder hasn't headed yet: the check is what says which lines to add.
  test('no header, a title only, a header that stops before Timers: the registry and code map are made, and the check gives the lines to add', () => {
    const root = makeTree({ ...PARTS,
      'service/src/20-desired.mjs': DESIRED,
      'service/src/17-changes.mjs': `${HEAD('changes').split('\n')[0]}\n${BASE['service/src/17-changes.mjs']}`,
      'service/src/16-actions.mjs': PARTS['service/src/16-actions.mjs'].replace('// Timers:', '\n// Timers:') });
    try {
      for (const make of [registry, codeMap]) assert.doesNotMatch(make(root), /undefined/);
      const problems = checkParts(root);
      for (const [file, said] of [['20-desired.mjs', /has no header/], ['17-changes.mjs', /without Area, Rules, Tests, Owns, Timers, Wakes/], ['16-actions.mjs', /without Timers, Wakes/]]) {
        const p = problems.find(x => x.file === `service/src/${file}`);
        assert.ok(p, `${file} isn’t named: ${problems.map(say).join('\n')}`);
        assert.match(p.message, said);
        assert.match(p.message, /\n\/\/ Area: .+\n\/\/ Owns: .+\n\/\/ Timers: .+ {2,}Wakes: none$/);
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  test('comments, strings and regular expressions are not code', () => {
    const quiet = "// writePrivate(DESIRED_FILE, x); setInterval(watchHeld, 1);\nconst NOTE = 'newJob(\"power-off\") fleetEvent({ type: \"boom\" })';\nconst RE = /setInterval\\(x\\)|[/(]/g;\nconst T = `writeFileSync(${'${'}NOTE}) ${'${'}RE.source}`;\n";
    assert.deepEqual(partsProblems({ 'service/src/17-changes.mjs': `${PARTS['service/src/17-changes.mjs']}${quiet}` }).map(say), []);
  });
});

// docs/status.md (tools/status.mjs, the same code tools/make.mjs runs): one row per rule and per contract requirement,
// made from the rule files' "Checked by" and "Today" and from the tests that hold an acceptance test (`// T54:`).
test('this tree: docs/status.md is what the rule files and the tests make, and every test it names is here', () => {
  assert.deepEqual(checkStatus(REPO).map(say), []);
});

// The made-up tree with its status table made; each test below adds one fault. A hand edit or a stale table is also
// found as stale, so each test checks that its own fault is named and that only the status check fails.
function statusTree(extra) {
  const root = makeTree(extra);
  if (!('docs/status.md' in extra)) writeFileSync(join(root, 'docs/status.md'), statusTable(root));
  return root;
}
const statusProblems = extra => { const root = statusTree(extra); try { return checkStatus(root); } finally { rmSync(root, { recursive: true, force: true }); } };
const statusOf = extra => { const root = statusTree(extra); try { return readFileSync(join(root, 'docs/status.md'), 'utf8'); } finally { rmSync(root, { recursive: true, force: true }); } };
function statusFails(extra, pattern) {
  const problems = statusProblems(extra);
  assert.ok(problems.some(p => pattern.test(p.message)), problems.map(say).join('\n') || 'no problem found');
  for (const p of problems) assert.equal(p.check, 'status', say(p));
}
const R1_ROW = /^\| \[R1\]\(rules\/R01\.md\) \|.*$/m;

describe('status', () => {
  test('the made-up tree passes as it is', () => assert.deepEqual(statusProblems({}).map(say), []));
  test('a rule with no row', () => statusFails({ 'docs/rules/R02.md': RULE(2), 'docs/status.md': statusOf({}) }, /no row for R2\b/));
  test('a contract requirement with no row', () => {
    const contract = BASE['docs/contract.md'].replace('- 8.3 It never changes SSH.\n', '- 8.3 It never changes SSH.\n- 8.4 It asks before stopping what is in use.\n');
    statusFails({ 'docs/contract.md': contract, 'docs/status.md': statusOf({}) }, /no row for 8\.4\b/);
  });
  test('a built row that names no test', () => statusFails({ 'docs/status.md': statusOf({}).replace(R1_ROW, '| [R1](rules/R01.md) | built |  |  |') }, /R1 built, but names no test/));
  test('a test it names is gone', () => statusFails({ 'docs/status.md': statusOf({}).replace(R1_ROW, '| [R1](rules/R01.md) | built | `test/gone.test.mjs` |  |') }, /test\/gone\.test\.mjs, which is gone/));
  test('a test name no test there has', () => statusFails({ 'docs/status.md': statusOf({}).replace('“a choice is used once”', '“a choice is used twice”') }, /a choice is used twice/));
  test('a test that is skipped is no proof', () => {
    statusFails({ 'test/change.test.mjs': "// T1: a start\ntest.skip('a choice is used once, alone, and only by whoever was asked', () => {});\n" }, /skipped or marked to-do/);
  });
  test('a version mark still in the contract', () => {
    for (const mark of ['*(v3)*', '*(changed in v3)*', '*(2026-11-11)*', '*(changed 2026-11-12, the owner’s decision 6)*']) {
      statusFails({ 'docs/contract.md': BASE['docs/contract.md'].replace('- 8.3 It never', `- 8.3 ${mark} It never`) }, new RegExp(`version mark \\(${mark.replace(/[.*()]/g, '\\$&')}\\)`));
    }
  });
  test('a row the rule files and the tests do not make', () => statusFails({ 'docs/status.md': statusOf({}).replace('| partly |', '| no test yet |') }, /run node tools\/make\.mjs/));
  test('a rule with no test says so; an acceptance test held by a test makes its requirement built', () => {
    const contract = BASE['docs/contract.md']
      .replace('| # | Request |\n|---|---|\n| T1 | "start a model" |', '| # | Request | Rules |\n|---|---|---|\n| T1 | "start a model" | 8.3 |\n| T2 | "stop it" | 8.4 |')
      .replace('- 8.3 It never changes SSH.\n', '- 8.3 It never changes SSH.\n- 8.4 It asks first.\n');
    const rule = RULE(2).replace('- test: `change.test.mjs` (“a choice is used once”)', '- review\n- test (to add): a stop list that is stale');
    const table = statusOf({ 'docs/contract.md': contract, 'docs/rules/R02.md': rule });
    assert.match(table, /^\| \[R1\]\(rules\/R01\.md\) \| partly \| `test\/change\.test\.mjs` \(“a choice is used once”\) \| falls short today: its file says where \|$/m);
    assert.match(table, /^\| \[R2\]\(rules\/R02\.md\) \| no test yet \|  \| review; test \(to add\): a stop list that is stale; falls short today: its file says where \|$/m);
    assert.match(table, /^\| 8\.3 \| built \| `test\/change\.test\.mjs` \(“a choice is used once, alone, and only by whoever was asked”\) \| holds T1 \|$/m);
    assert.match(table, /^\| 8\.4 \| no test yet \|  \| T2: no test holds it yet \|$/m);
    assert.deepEqual(statusProblems({ 'docs/contract.md': contract, 'docs/rules/R02.md': rule }).map(say), []);
  });
  // A test that holds part of an acceptance test says which part (`// T2 (part): …`); its requirement is partly built.
  const PARTS = '| # | Request | Rules |\n|---|---|---|\n| T1 | "start a model" | 8.3 |\n| T2 | "stop it" | 8.3 |\n| T3 | "ask first" | 8.4 |';
  const partsContract = BASE['docs/contract.md'].replace('| # | Request |\n|---|---|\n| T1 | "start a model" |', PARTS)
    .replace('- 8.3 It never changes SSH.\n', '- 8.3 It never changes SSH.\n- 8.4 It asks first.\n');
  const stopTests = "// T2 (part): the stop is confirmed, not the put-back\ntest('a stop is confirmed', () => {});\n// T3 (part): it asks first, then\n// stops nothing. The rest waits.\ntest('asks before stopping', () => {});\n";
  test('only part marks: partly, with the tests and the parts they hold; a whole mark and a part mark for another of its acceptance tests: partly', () => {
    const extra = { 'docs/contract.md': partsContract, 'test/stop.test.mjs': stopTests };
    const table = statusOf(extra);
    assert.match(table, /^\| 8\.4 \| partly \| `test\/stop\.test\.mjs` \(“asks before stopping”\) \| holds part of T3: “it asks first, then stops nothing\.” \|$/m);
    assert.match(table, /^\| 8\.3 \| partly \| `test\/change\.test\.mjs` \(“a choice is used once, alone, and only by whoever was asked”\); `test\/stop\.test\.mjs` \(“a stop is confirmed”\) \| holds T1; holds part of T2: “the stop is confirmed, not the put-back” \|$/m);
    assert.deepEqual(statusProblems(extra).map(say), []);
  });
  test('whole marks alone: built', () => {
    const extra = { 'docs/contract.md': partsContract, 'test/stop.test.mjs': stopTests.replace('// T2 (part): the stop is confirmed, not the put-back', '// T2: the stop') };
    assert.match(statusOf(extra), /^\| 8\.3 \| built \| `test\/change\.test\.mjs` \(“a choice is used once, alone, and only by whoever was asked”\); `test\/stop\.test\.mjs` \(“a stop is confirmed”\) \| holds T1, T2 \|$/m);
    assert.deepEqual(statusProblems(extra).map(say), []);
  });
  test('a part mark with no words after it', () => statusFails({ 'test/change.test.mjs': "// T1 (part):\ntest('a choice is used once, alone, and only by whoever was asked', () => {});\n" }, /^marks part of T1 with no words after “\(part\):”/));
});

// The meaning diff (tools/meaning.mjs, `node tools/check-docs.mjs --meaning <base>`): the texts whose meaning is the
// owner's, by id, that differ between two trees. A made-up pair of trees, then the command itself.
const meaningRule = (n, rule, where = '- `16-actions.mjs` (`runAction`)', today = 'Nothing marked.', checked = '- `change.test.mjs`') =>
  `# R${n}\n\n## Rule\n\n${rule}\n\n## Why\n\nOne way in.\n\n## Today\n\n${today}\n\n## Where\n\n${where}\n\n## Checked by\n\n${checked}\n`;
const meaningContract = (reqs, tests = '| T1 | "what do you remember?" | It lists every line. | 5.1, 5.3 |\n| T2 | "forget my old address" | It retires the line. | 5.1 |') =>
  `# Contract\n\nChanges to this contract need the owner's OK.\n\n## 5. Memory\n\nWhat Sparkie keeps.\n\n${reqs}\n\n## 11. Acceptance tests\n\n| # | Request | Must | Rules |\n|---|---|---|---|\n${tests}\n`;
const REQ = {
  '5.1': '- 5.1 **Every line.** Memory keeps every line the owner says, and a line is only retired,\n  never erased, unless the owner asks.',
  '5.2': '- 5.2 **The owner\'s words.** Sparkie does not believe a line an agent saved.',
  '5.3': '- 5.3 **Shown in chat.** Memory is shown in chat when asked.',
};
const glossary = rows => `# Words\n\nMeanings are the owner's.\n\n| Word | What it means | Name in code | Don't say |\n|---|---|---|---|\n${rows.join('\n')}\n`;
const HUB = '| hub | The Spark that runs the console and the brain | `brainSparks` | portal host |';
const BOX = '| box | A throwaway container one command runs in | none yet | sandbox |';
const MEANING_BASE = {
  'service/src/16-actions.mjs': 'async function runAction(name) {}\nasync function startModel(args) {}\nfunction jobEnded(row) {}\n',
  'docs/contract.md': meaningContract([REQ['5.1'], REQ['5.2'], REQ['5.3']].join('\n')),
  'docs/rules/R01.md': meaningRule(1, '**R1.** Every change goes through `runAction`.'),
  'docs/rules/R02.md': meaningRule(2, '**R2.** One change per Spark: claim before the job exists,\nalways release.'),
  'docs/rules/R03.md': meaningRule(3, '**R3.** A stop is confirmed by Docker.'),
  'docs/rules/R04.md': meaningRule(4, '**R4.** Docker is the truth.'),
  'docs/glossary.md': glossary([HUB, BOX]),
};
function writeFiles(files) {
  const root = mkdtempSync(join(tmpdir(), 'meaning-'));
  for (const [f, text] of Object.entries(files)) {
    if (text == null) continue;
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), text);
  }
  return root;
}
// The ids that differ from MEANING_BASE once `head` is laid over it, each with how it changed.
function meaningOf(head, base = {}) {
  const a = writeFiles({ ...MEANING_BASE, ...base }), b = writeFiles({ ...MEANING_BASE, ...base, ...head });
  try { return meaningDiff(a, b); } finally { for (const r of [a, b]) rmSync(r, { recursive: true, force: true }); }
}
const ids = items => items.map(i => `${i.id} ${i.change}`);

describe('the meaning diff', () => {
  test('the same trees: nothing', () => assert.deepEqual(meaningOf({}), []));
  test('a Rule paragraph gains a word, a requirement loses a “not”, a glossary meaning changes, a rule only re-wrapped, a Where line, a rule file added and one removed: exactly the right ids', () => {
    const items = meaningOf({
      'docs/contract.md': meaningContract([
        REQ['5.3'],                                                                    // moved above the other two
        '- 5.1 **Every line.** Memory keeps every line the owner says, and a line is only\n  retired, never erased, unless the owner asks.',   // wrapped again
        REQ['5.2'].replace('does not believe', 'does believe'),
      ].join('\n')),
      'docs/rules/R01.md': meaningRule(1, '**R1.** Every change goes through `runAction` first.'),
      'docs/rules/R02.md': meaningRule(2, '**R2.** One change per Spark: claim\nbefore the job exists, always release.'),
      'docs/rules/R03.md': meaningRule(3, '**R3.** A stop is confirmed by Docker.', '- `16-actions.mjs` (`runAction`, `startModel`)', 'A stop on a dark Spark waits.', '- `stop.test.mjs`'),
      'docs/rules/R04.md': null,
      'docs/rules/R05.md': meaningRule(5, '**R5.** Every Spark has one plug.'),
      'docs/glossary.md': glossary([BOX.replace('one command runs in', 'one command or a whole task runs in'), HUB]),
    });
    assert.deepEqual(ids(items), ['5.2 changed', 'R1 changed', 'R5 added', 'R4 removed', 'box changed']);
    const [req, rule, added, removed, word] = items;
    assert.deepEqual([req.kind, req.old, req.new], ['requirement', REQ['5.2'], REQ['5.2'].replace('does not believe', 'does believe')]);
    assert.deepEqual([rule.kind, rule.old, rule.new], ['rule', '**R1.** Every change goes through `runAction`.', '**R1.** Every change goes through `runAction` first.']);
    assert.deepEqual([added.old, added.new, removed.old, removed.new], [null, '**R5.** Every Spark has one plug.', '**R4.** Docker is the truth.', null]);
    assert.deepEqual([word.kind, word.file, word.old, word.new], ['word', 'docs/glossary.md', 'A throwaway container one command runs in', 'A throwaway container one command or a whole task runs in']);
  });
  test('an acceptance test reworded, and a section’s own words; a paragraph moved within its section is no change', () => {
    const contract = meaningContract([REQ['5.1'], REQ['5.2'], REQ['5.3']].join('\n'), '| T1 | "what do you remember?" | It lists every line. | 5.1, 5.3 |\n| T2 | "forget my old address" | It erases the line. | 5.1 |');
    assert.deepEqual(ids(meaningOf({ 'docs/contract.md': contract })), ['T2 changed']);
    const prose = MEANING_BASE['docs/contract.md'].replace('What Sparkie keeps.', 'What Sparkie keeps, and for how long.');
    assert.deepEqual(meaningOf({ 'docs/contract.md': prose }).map(i => [i.id, i.what, i.old, i.new]), [['§5', 'contract text outside the numbered rules', 'What Sparkie keeps.', 'What Sparkie keeps, and for how long.']]);
    const moved = MEANING_BASE['docs/contract.md'].replace("Changes to this contract need the owner's OK.\n\n", '').replace('## 5. Memory\n\n', "## 5. Memory\n\nChanges to this contract need the owner's OK.\n\n");
    assert.deepEqual(ids(meaningOf({ 'docs/contract.md': moved })), ['§0 changed', '§5 changed'], 'moved to another section: it left one and came into the other');
    const within = MEANING_BASE['docs/contract.md'].replace('## 5. Memory\n\nWhat Sparkie keeps.\n\n', '## 5. Memory\n\n').replace(`${REQ['5.3']}\n`, `${REQ['5.3']}\n\nWhat Sparkie keeps.\n`);
    assert.deepEqual(ids(meaningOf({ 'docs/contract.md': within })), []);
  });
  test('a pointer fixed is no change (a typo, or a name the code renamed); a pointer pointed at another name, or a number in backticks, is', () => {
    const rule = text => ({ 'docs/rules/R01.md': meaningRule(1, `**R1.** ${text}`) });
    assert.deepEqual(meaningOf(rule('Every change goes through `runAction`.'), rule('Every change goes through `runActon`.')), [], 'a typo fixed');
    const renamed = { 'service/src/16-actions.mjs': MEANING_BASE['service/src/16-actions.mjs'].replace('jobEnded', 'jobFinished'), ...rule('A job that ends is told once (`jobFinished`).') };
    assert.deepEqual(meaningOf(renamed, rule('A job that ends is told once (`jobEnded`).')), [], 'a rename followed');
    assert.deepEqual(ids(meaningOf(rule('Every change goes through `startModel`.'), rule('Every change goes through `runAction`.'))), ['R1 changed']);
    assert.deepEqual(ids(meaningOf(rule('At most `16` tools a round.'), rule('At most `24` tools a round.'))), ['R1 changed']);
    assert.deepEqual(ids(meaningOf(rule('Every change goes through `runAction`, and `startModel`.'), rule('Every change goes through `runAction`.'))), ['R1 changed']);
  });
  test('the command: the ids with their old and new text, exit 1; the same trees, exit 0; a commit as a tree', () => {
    const a = writeFiles(MEANING_BASE), b = writeFiles({ ...MEANING_BASE, 'docs/rules/R01.md': meaningRule(1, '**R1.** Every change goes through `runAction` first.') });
    const repo = mkdtempSync(join(tmpdir(), 'meaning-git-'));
    try {
      const run = (...args) => spawnSync(process.execPath, [join(REPO, 'tools', 'check-docs.mjs'), '--meaning', ...args], { encoding: 'utf8' });
      const json = run(a, b, '--json');
      assert.equal(json.status, 1, json.stderr);
      assert.deepEqual(JSON.parse(json.stdout), [{ id: 'R1', kind: 'rule', what: 'Rule paragraph', change: 'changed', old: '**R1.** Every change goes through `runAction`.', new: '**R1.** Every change goes through `runAction` first.', file: 'docs/rules/' }]);
      const text = run(a, b);
      assert.equal(text.status, 1, text.stderr);
      assert.match(text.stdout, /^R1, Rule paragraph \(docs\/rules\/\): reworded\n {2}was: \*\*R1\.\*\* Every change goes through `runAction`\.\n {2}now: \*\*R1\.\*\* Every change goes through `runAction` first\.$/m);
      const same = run(a, a);
      assert.equal(same.status, 0, same.stderr);
      assert.match(same.stdout, /^No meaning text differs/);
      assert.equal(run('--json').status, 2);
      assert.equal(run('no-such-commit', a).status, 2);
      // Two commits of a repository, each written out by git archive.
      const git = (...args) => { const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
      for (const [f, t] of Object.entries(MEANING_BASE)) { mkdirSync(dirname(join(repo, f)), { recursive: true }); writeFileSync(join(repo, f), t); }
      git('init', '-q'); git('add', '-A'); git('commit', '-q', '-m', 'base');
      writeFileSync(join(repo, 'docs/glossary.md'), glossary([HUB.replace('and the brain', 'the brain and the journal'), BOX]));
      git('commit', '-q', '-am', 'head');
      const trees = [treeAt('HEAD~1', repo), treeAt('HEAD', repo)];
      try { assert.deepEqual(ids(meaningDiff(trees[0].root, trees[1].root)), ['hub changed']); } finally { for (const t of trees) t.done(); }
    } finally {
      for (const r of [a, b, repo]) rmSync(r, { recursive: true, force: true });
    }
  });
});
