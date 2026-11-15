// docs/status.md: what is built, and the test that holds it. One row per rule (docs/rules/) and per contract
// requirement, made from what the repository already states; tools/make.mjs writes it, never a hand.
//   a rule                   the tests its file names under "Checked by"; its "Today" says whether the code falls short
//   a contract requirement   the acceptance tests that list it (their last column); a test holds an acceptance test
//                            when a comment in it starts with that test's id (`// T54: …`)
//
// checkStatus fails when a rule or a requirement has no row, a built or partly row names no test, a test a row names is
// gone (no file, no test with those words, or skipped or marked to-do), or the table is not what this file makes; and
// when the contract carries a version mark (`*(v3)*`, `*(changed)*`, `*(2026-11-11)*`): status lives here, not there.
// tools/make.mjs runs it; so does test/docs.test.mjs, on this tree and on small made-up ones.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATUS = 'docs/status.md';
const STATUSES = ['built', 'partly', 'no test yet'];
// A version mark: the contract states each rule as it must hold now, and its history is in docs/history/.
const MARK = /\*\((?:v\d[\d.]*|new|changed\b[^)\n]*|\d{4}-\d{2}-\d{2}\b[^)\n]*)\)\*/g;
// The checker's own test holds made-up faults on purpose: it is not read for acceptance tests.
const SELF = ['docs.test.mjs'];

const read = (root, f) => readFileSync(join(root, f), 'utf8');
const isFile = p => { try { return statSync(p).isFile(); } catch { return false; } };
const plainQuotes = s => s.replace(/\\(['"])/g, '$1').replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
const cell = s => s.replace(/\|/g, '\\|');
const sectionOf = (text, heading) => {
  const s = text.split(/^## /m).find(p => p.startsWith(`${heading}\n`));
  return s == null ? '' : s.slice(heading.length + 1);
};
const bulletsOf = body => body.trim().split(/\n(?=- )/).map(b => b.replace(/^- /, '').replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
const ruleFiles = root => (existsSync(join(root, 'docs/rules')) ? readdirSync(join(root, 'docs/rules')).filter(f => /^R\d\d\.md$/.test(f)).sort() : []);
const contractOf = root => (existsSync(join(root, 'docs/contract.md')) ? read(root, 'docs/contract.md') : '');
const requirements = contract => [...new Set([...contract.matchAll(/^\s*- (\d+\.\d+)\s/gm)].map(m => m[1]))];

// The test files a line names, each with the parts of test names quoted after it (“…”), merged by file.
function testsIn(line, into = []) {
  const marks = [...line.matchAll(/`?(?:test\/)?([\w.-]+\.test\.mjs)`?/g)];
  marks.forEach((m, i) => {
    const file = `test/${m[1]}`, rest = line.slice(m.index + m[0].length, marks[i + 1]?.index ?? line.length);
    let t = into.find(x => x.file === file);
    if (!t) into.push(t = { file, names: [] });
    for (const q of rest.matchAll(/“([^”]+)”/g)) if (!t.names.includes(q[1])) t.names.push(q[1]);
  });
  return into;
}

// The test a `// T54:` comment belongs to: the one right below it, or the one it sits in. Part of its name.
function testAround(lines, i) {
  const CALL = /^\s*(?:test|it)(?:\.(?:skip|todo|only))?\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/;
  const next = lines.slice(i + 1).find(l => l.trim() && !/^\s*\/\//.test(l));
  const m = next?.match(CALL) || lines.slice(0, i).reverse().map(l => l.match(CALL)).find(Boolean);
  if (!m) return null;
  const name = m[2].replace(/\\(.)/g, '$1').split('; ')[0];
  return name.length > 80 ? name.slice(0, 80).replace(/\s+\S*$/, '') : name;
}

const proofCell = tests => tests.map(t => `\`${t.file}\`${t.names.length ? ` (${t.names.map(n => `“${n}”`).join(', ')})` : ''}`).join('; ');

export function statusTable(root = ROOT) {
  const ruleRows = ruleFiles(root).map(f => {
    const text = read(root, `docs/rules/${f}`), tests = [], notes = [];
    for (const b of bulletsOf(sectionOf(text, 'Checked by'))) { if (testsIn(b).length) testsIn(b, tests); else notes.push(b); }
    const short = sectionOf(text, 'Today').trim() !== 'Nothing marked.';
    if (short) notes.push('falls short today: its file says where');
    const status = !tests.length ? 'no test yet' : short || notes.some(n => /\(to add\)/.test(n)) ? 'partly' : 'built';
    return `| [R${Number(f.slice(1, 3))}](rules/${f}) | ${status} | ${cell(proofCell(tests))} | ${cell(notes.join('; '))} |`;
  });
  const contract = contractOf(root);
  const lists = new Map();   // acceptance test → the requirements its last column names
  for (const m of contract.matchAll(/^\| T(\d+) \|(.*)\|[ \t]*$/gm)) lists.set(Number(m[1]), [...m[2].split('|').pop().matchAll(/\b(\d+\.\d+)\b/g)].map(x => x[1]));
  const held = new Map();    // acceptance test → the tests that hold it
  const tests = existsSync(join(root, 'test')) ? readdirSync(join(root, 'test')).filter(f => /\.test\.mjs$/.test(f) && !SELF.includes(f)).sort() : [];
  for (const f of tests) {
    const lines = read(root, `test/${f}`).split('\n');
    lines.forEach((l, i) => {
      const m = l.match(/^\s*\/\/ (T\d+(?:, T\d+)*):/);
      if (!m) return;
      const name = testAround(lines, i);
      for (const t of m[1].split(', ').map(x => Number(x.slice(1)))) testsIn(`\`${f}\`${name ? ` “${name}”` : ''}`, held.get(t) || held.set(t, []).get(t));
    });
  }
  const contractRows = requirements(contract).map(id => {
    const acc = [...lists].filter(([, reqs]) => reqs.includes(id)).map(([t]) => t), on = acc.filter(t => held.has(t)), off = acc.filter(t => !held.has(t));
    const proof = [];
    for (const t of on) for (const x of held.get(t)) testsIn(`\`${x.file}\` ${x.names.map(n => `“${n}”`).join(', ')}`, proof);
    const status = !on.length ? 'no test yet' : off.length ? 'partly' : 'built';
    const note = [
      on.length && `holds ${on.map(t => `T${t}`).join(', ')}`,
      off.length && `${off.map(t => `T${t}`).join(', ')}: no test holds ${off.length > 1 ? 'them' : 'it'} yet`,
      !acc.length && 'no acceptance test lists it',
    ].filter(Boolean);
    return `| ${id} | ${status} | ${cell(proofCell(proof))} | ${cell(note.join('; '))} |`;
  });
  return [
    '# What is built, and the test that holds it',
    '',
    'Written by `node tools/make.mjs` from the rule files and the tests; don’t edit it by hand. One row per rule and per',
    'contract requirement. To change a row, change what it is made from: a rule file’s “Checked by” and “Today”, or a',
    'test that holds an acceptance test (a comment in it that starts with the test’s id, like `// T54:`).',
    '',
    '- **built**: a test that is here today holds it, and nothing is marked short.',
    '- **partly**: a test holds part of it. The rule’s file marks where the code falls short today or a test still to',
    '  add, or only some of the requirement’s acceptance tests have a test.',
    '- **no test yet**: no test holds it. It may still be in the code; the note says what checks it instead, if anything.',
    '',
    '## Rules (`docs/rules/`)',
    '',
    '| Rule | Status | Tests | Note |',
    '|---|---|---|---|',
    ...ruleRows,
    '',
    '## Contract requirements (`docs/contract.md`)',
    '',
    '| Requirement | Status | Tests | Note |',
    '|---|---|---|---|',
    ...contractRows,
    '',
  ].join('\n');
}

// A test a status row names is gone, has no test with those words, or is skipped or marked to-do: the reason, or null.
function deadTest(root, { file, names }) {
  if (!isFile(join(root, file))) return `names ${file}, which is gone`;
  const body = plainQuotes(read(root, file));
  for (const n of names) {
    const i = body.indexOf(plainQuotes(n));
    if (i < 0) return `quotes a test “${n}” in ${file}, but no test there has those words`;
    const end = body.indexOf('\n', i), line = body.slice(body.lastIndexOf('\n', i) + 1, end < 0 ? body.length : end);
    if (/\b(?:test|it|describe)\.(?:skip|todo)\(|\b(?:skip|todo):\s*(?:true\b|['"`])/.test(line)) return `quotes a test “${n}” in ${file}, which is skipped or marked to-do`;
  }
  return null;
}

export function checkStatus(root = ROOT) {
  const out = [], say = (message, line = 1) => out.push({ check: 'status', file: STATUS, line, message });
  if (!existsSync(join(root, STATUS))) { say('is missing: run node tools/make.mjs'); return out; }
  const text = read(root, STATUS), rows = new Map();
  text.split('\n').forEach((l, i) => {
    const cells = l.split(/(?<!\\)\|/).slice(1, -1).map(c => c.trim().replace(/\\\|/g, '|'));
    const id = cells[0]?.match(/^\[(R\d+)\]\(|^(\d+\.\d+)$/);
    if (!id) return;
    const key = id[1] || id[2];
    if (rows.has(key)) say(`has two rows for ${key}`, i + 1);
    rows.set(key, { status: cells[1], tests: testsIn(cells[2] || ''), line: i + 1 });
  });
  const ids = [...ruleFiles(root).map(f => `R${Number(f.slice(1, 3))}`), ...requirements(contractOf(root))];
  for (const id of ids) if (!rows.has(id)) say(`has no row for ${id}: every ${/^R/.test(id) ? 'rule' : 'contract requirement'} has one`);
  for (const [id, r] of rows) {
    if (!ids.includes(id)) say(`has a row for ${id}, which ${/^R/.test(id) ? 'no file in docs/rules/ defines' : 'docs/contract.md does not define'}`, r.line);
    if (!STATUSES.includes(r.status)) say(`gives ${id} the status “${r.status}”, which is not one of ${STATUSES.join(', ')}`, r.line);
    if (['built', 'partly'].includes(r.status) && !r.tests.length) say(`marks ${id} ${r.status}, but names no test that holds it`, r.line);
    for (const t of r.tests) { const dead = deadTest(root, t); if (dead) say(`row ${id} ${dead}`, r.line); }
  }
  if (text !== statusTable(root)) say('is not what the rule files and the tests make: run node tools/make.mjs');
  const contract = contractOf(root);
  for (const m of contract.matchAll(MARK)) {
    out.push({ check: 'status', file: 'docs/contract.md', line: contract.slice(0, m.index).split('\n').length, message: `has a version mark (${m[0]}): state the rule as it must hold now; what is built is in ${STATUS}` });
  }
  return out;
}
