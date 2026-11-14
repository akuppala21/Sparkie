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
import { checkDocs, rulesIndex, describe as say } from '../tools/check-docs.mjs';

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
  test('a card over 4 KB', () => fails({ 'docs/how/add-an-action.md': CARD.replace('- A second route.', `${'- A second route.\n'.repeat(250)}`) }, 'sizes', /over its limit of 4096/));
  test('a line over 400 characters', () => fails(doc('word '.repeat(90)), 'sizes', /line of 45\d characters/));
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
