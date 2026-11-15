// Fails when the hand-written documents drift from the code. File reads only: no server, no network, a few seconds.
//
//   node tools/check-docs.mjs     prints each problem and exits 1 if there is any (tools/make.mjs runs it last)
//
// test/docs.test.mjs runs the same code on the real tree, and on small made-up trees, one fault each.
// What it checks, in every hand-written document (any *.md outside the dated records and the generated files):
//   ids      every rule id (R1, …), contract id (contract 8.3) and acceptance test (T54) cited is defined; parts and
//            tests are read for ids too
//   paths    every file or folder named (service/…, docs/…, a part, a test file) exists
//   names    a name given with its file is in that file; every other code name in backticks is somewhere in the code;
//            a snake_case name is an action, or at least a name the code uses
//   lines    no line pointer (`16-actions.mjs:286`, `, :154`): they drift, names don't
//   counts   no typed count of actions, parts or rules (`26 reads, 15 changes`, `37 parts`, `R1–R40`)
//   sizes    each document within its limit in bytes, and no line over 400 characters
//   shape    each rule file and each card has its fixed headings; AGENTS.md's task table and docs/how/ agree;
//            docs/rules.md is what docs/rules/ makes
// Dated records are never checked: docs/history/, docs/design-2026-11-13/ and docs/review-astra/.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KB = 1024;

// Dated records: kept as they were written, never checked.
// docs/review-astra/ holds a review with an outside reviewer (its evidence quotes line numbers and old names on purpose).
const DATED = [/^docs\/history\//, /^docs\/design-2026-11-13\//, /^docs\/review-astra\//];
// Written by tools: never edited by hand. tools/make.mjs rebuilds them; build.test.mjs and this checker compare them.
const GENERATED = ['docs/code-map.md', 'docs/registry.md', 'docs/rules.md', 'docs/status.md'];
// Not the app's documents: the agent bar (a separate trial harness that names its own run outputs) and anything inside
// the stand-in fleet.
const NOT_DOCS = [/^agentbar\//, /^test\/mock\//];
// A dated guide kept at the top level for the owner's reviewer: only the paths it names are checked.
const PATHS_ONLY = ['REVIEW-GUIDE.md'];

// Limits in bytes (docs/design-2026-11-13/f-structure.md, 2.1). A third number is a ceiling for a document that is over
// its limit today: it may only shrink, and the second wave cuts it (the contract made flat; the two READMEs cut down).
const LIMITS = [
  [/^AGENTS\.md$/, 8 * KB],
  [/^docs\/architecture\.md$/, 24 * KB],
  [/^docs\/glossary\.md$/, 8 * KB],
  [/^docs\/state\.md$/, 24 * KB],
  [/^docs\/rules\/R\d\d\.md$/, 8 * KB],
  [/^docs\/how\/[a-z0-9-]+\.md$/, 4 * KB],
  [/^docs\/contract\.md$/, 120 * KB],
  [/^README\.md$/, 4 * KB, 15 * KB],
  [/^test\/README\.md$/, 12 * KB, 48 * KB],
  [/^docs\/agent-door\.md$/, 16 * KB, 17 * KB],
  [/./, 16 * KB],
];
const LINE_MAX = 400;
// Documents with longer lines today (a table moved whole, rows written before the limit): a ceiling, never raised.
const LONG_LINES = { 'test/README.md': 3256, 'docs/agent-door.md': 1395, 'docs/state.md': 1148 };

// Names a document may quote that belong to other software, not to this code.
const NOT_OURS = {
  idempotentHint: 'an MCP tool annotation',
  init_world_group: 'PyTorch', _create_gloo_process_group: 'PyTorch',
  HEAD_IP: 'the vLLM cluster script', ETH_IF: 'the vLLM cluster script', IB_IF: 'the vLLM cluster script',
  MASTER_PORT: 'the vLLM cluster script',
};

// Words that look like paths but aren't one to look for.
const NOT_PATHS = {
  'tools/list': 'an MCP method', 'tools/call': 'an MCP method',
  'deploy/short-address.sh': 'retired 2026-11-11; the contract names it as gone',
  'deploy/web-page.sh': 'retired 2026-11-11; the contract names it as gone',
  'service/workflows.lock.json': 'written by node test/lock.mjs; not kept in git',
};

const RULE_HEADINGS = ['Rule', 'Why', 'Today', 'Where', 'Checked by'];
const CARD_HEADINGS = ['Touch', 'Also update', 'Never', 'Rules', 'Tests', 'Copy from'];
// Where a file named without its folder is looked for.
const SEARCH = ['service/src', 'service', 'test', 'test/mock', 'tools', 'deploy', 'public', 'agentbar', ''];
const TOP = '(?:service|public|deploy|tools|test|docs|agentbar)';
// This checker and its test hold made-up faults on purpose (names, ids): they are not read as code or as citations.
const SELF = ['tools/check-docs.mjs', 'test/docs.test.mjs'];

const read = (root, f) => readFileSync(join(root, f), 'utf8');
const isFile = p => { try { return statSync(p).isFile(); } catch { return false; } };
const isDir = p => { try { return statSync(p).isDirectory(); } catch { return false; } };
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const lineAt = (text, i) => text.slice(0, i).split('\n').length;
const plainQuotes = s => s.replace(/\\(['"])/g, '$1').replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

function walk(root, dir = '', out = []) {
  for (const f of readdirSync(join(root, dir))) {
    if (f.startsWith('.') || f === 'node_modules') continue;
    const p = dir ? `${dir}/${f}` : f;
    if (isDir(join(root, p))) walk(root, p, out); else out.push(p);
  }
  return out;
}

// Everything the checks compare against, read once.
function readTree(root) {
  const all = walk(root);
  const docs = all.filter(f => f.endsWith('.md') && !DATED.some(r => r.test(f)) && !GENERATED.includes(f) && !NOT_DOCS.some(r => r.test(f)));
  const parts = {};
  for (const f of existsSync(join(root, 'service/src')) ? readdirSync(join(root, 'service/src')) : []) {
    if (/^\d{2}-[a-z0-9-]+\.mjs$/.test(f)) parts[f] = read(root, `service/src/${f}`);
  }
  const actions = new Set(Object.values(parts).flatMap(t => [...t.matchAll(/^\s*name: '([a-z_]+)', title: '[^']+', kind: '(?:read|change)'/gm)].map(m => m[1])));
  const code = all.filter(f => new RegExp(`^${TOP}/`).test(f) && !/^docs\//.test(f) && !f.endsWith('.md') && !SELF.includes(f));
  const words = new Set();
  for (const f of code) { let t = ''; try { t = read(root, f); } catch { continue; } for (const m of t.matchAll(/[A-Za-z_$][\w$]*/g)) words.add(m[0]); }
  const tests = all.filter(f => /^test\/[^/]+\.test\.mjs$/.test(f) && !SELF.includes(f));
  const rules = existsSync(join(root, 'docs/rules')) ? readdirSync(join(root, 'docs/rules')).filter(f => /^R\d\d\.md$/.test(f)).sort() : [];
  const contract = existsSync(join(root, 'docs/contract.md')) ? read(root, 'docs/contract.md') : '';
  const ids = {
    rules: new Set(rules.map(f => Number(f.slice(1, 3)))),
    contract: new Set([...contract.matchAll(/^\s*- (\d+\.\d+)\s/gm)].map(m => m[1])),
    sections: new Set([...contract.matchAll(/^## (\d+)\./gm)].map(m => m[1])),
    tests: new Set([...contract.matchAll(/^\| T(\d+) \|/gm)].map(m => Number(m[1]))),
  };
  return { root, all, docs, parts, actions, words, tests, rules, ids };
}

// A file named in a document: the path it stands for, or null when it isn't one this checker can look for.
function resolveFile(tree, name) {
  if (/\bNN\b|\bnn\b/.test(name)) return null;                         // a pattern, not a file
  if (name.includes('/')) return new RegExp(`^${TOP}/`).test(name) ? name : null;
  if (!/\.mjs$/.test(name)) return null;
  for (const d of SEARCH) { const p = d ? `${d}/${name}` : name; if (isFile(join(tree.root, p))) return p; }
  return `?${name}`;
}
const exists = (tree, p) => isFile(join(tree.root, p)) || isDir(join(tree.root, p.replace(/\/$/, '')));

// Code comments only: ids in strings and test data are not citations.
const commentsOf = t => [...t.matchAll(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g)].map(m => m[0]).join('\n');

function checkIds(tree, file, text, out, { code = false } = {}) {
  const say = (i, msg) => out.push({ check: 'ids', file, line: lineAt(text, i), message: msg });
  for (const m of text.matchAll(/\bR(\d{1,3})\b/g)) {
    if (!tree.ids.rules.has(Number(m[1]))) say(m.index, `cites R${m[1]}, which no file in docs/rules/ defines`);
  }
  const prose = code ? commentsOf(text) : text;
  const at = m => (code ? text.indexOf(m[0]) : m.index);
  for (const m of prose.matchAll(/\bcontract(?:[’']s)? (?:§ ?|section |rules? )?(\d{1,2}(?:\.\d{1,2})?)\b/g)) {
    const id = m[1], ok = id.includes('.') ? tree.ids.contract.has(id) : tree.ids.sections.has(id);
    if (!ok) say(at(m), `cites contract ${id}, which docs/contract.md does not define`);
  }
  for (const m of prose.matchAll(/(?<![\w}$-])T([1-9]\d{0,2})\b/g)) {
    if (!tree.ids.tests.has(Number(m[1]))) say(at(m), `cites T${m[1]}, which is not an acceptance test in docs/contract.md`);
  }
}

function checkPaths(tree, file, text, out) {
  const say = (i, msg) => out.push({ check: 'paths', file, line: lineAt(text, i), message: msg });
  for (const m of text.matchAll(new RegExp(`(?<![\\w/.~-])(${TOP}/[\\w./-]*)`, 'g'))) {
    const p = m[1].replace(/[.]+$/, '');
    if (/\bNN\b|\bnn\b/.test(p) || NOT_PATHS[p]) continue;
    if (!exists(tree, p)) say(m.index, `names ${p}, which does not exist`);
  }
  for (const m of text.matchAll(/(?<![\w/.-])([\w-]+\.mjs)\b/g)) {
    const p = resolveFile(tree, m[1]);
    if (p?.startsWith('?')) say(m.index, `names ${m[1]}, which is not in ${SEARCH.filter(Boolean).join(', ')} or the top folder`);
  }
  for (const m of text.matchAll(/`(\d{2}-[a-z][a-z0-9-]*)`|\((\d{2}-[a-z][a-z0-9-]*)[,)]/g)) {
    const part = `${m[1] || m[2]}.mjs`;
    if (!tree.parts[part]) say(m.index, `names the part ${m[1] || m[2]}, which is not in service/src/`);
  }
}

// The text inside the brackets that open at text[i] ('('), backticked spans skipped, or null.
function bracketed(text, i) {
  let depth = 0, tick = false;
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (c === '`') tick = !tick;
    else if (!tick && c === '(') depth++;
    else if (!tick && c === ')' && --depth === 0) return text.slice(i + 1, j);
  }
  return null;
}
const inFile = (body, name) => (/^[A-Za-z_$][\w$]*$/.test(name) ? new RegExp(`(?<![\\w$])${esc(name)}(?![\\w$])`).test(body) : body.includes(name));

function checkNames(tree, file, text, out) {
  const say = (i, msg, check = 'names') => out.push({ check, file, line: lineAt(text, i), message: msg });
  const fileText = p => { try { return read(tree.root, p); } catch { return null; } };
  // A file, then its names in brackets: `16-actions.mjs` (`runAction`, `sparkieCheck`), or a test file and part of
  // a test's name: change.test.mjs (“a GPU app or job holds its Spark’s GPU”).
  const FILE = /`?((?:[\w.-]+\/)*[\w.-]+\.(?:mjs|py|sh))`?(?:: ?\d[\d, :-]*)?\s*\(/g;
  for (const m of text.matchAll(FILE)) {
    const p = resolveFile(tree, m[1]);
    if (!p || p.startsWith('?')) continue;
    const body = fileText(p);
    const inside = bracketed(text, m.index + m[0].length - 1)?.replace(/\n\s*/g, ' ');
    if (body == null || inside == null) continue;
    for (const n of inside.matchAll(/`([^`\n]+)`/g)) {
      const name = n[1].replace(/\(\)$/, '');
      if (resolveFile(tree, name) || /\s/.test(name)) continue;
      if (!inFile(body, name)) say(m.index, `gives \`${name}\` with ${m[1]}, but ${p} has no such name`);
    }
    if (/\.test\.mjs$/.test(p)) {
      for (const q of inside.matchAll(/[“"]([^”"\n]{6,})[”"]/g)) {
        if (!plainQuotes(body).includes(plainQuotes(q[1]))) say(m.index, `quotes a test “${q[1]}” in ${m[1]}, but no test there has those words`);
      }
    }
  }
  // A name, then its file: `startModel` in `17-changes.mjs`, or `startModel` (`17-changes.mjs`).
  for (const m of text.matchAll(/`([A-Za-z_$][\w$]*)(?:\(\))?`\s+(?:in\s+|\()`((?:[\w.-]+\/)*[\w.-]+\.(?:mjs|py|sh))`/g)) {
    const p = resolveFile(tree, m[2]);
    if (!p || p.startsWith('?')) continue;
    const body = fileText(p);
    if (body != null && !inFile(body, m[1])) say(m.index, `puts \`${m[1]}\` in ${m[2]}, but ${p} has no such name`);
  }
  // Every other code name in backticks: camelCase, snake_case or UPPER_CASE must be somewhere in the code.
  for (const m of text.matchAll(/`([A-Za-z_$][\w$]*)(?:\(\))?`/g)) {
    const n = m[1];
    if (!/[a-z][A-Z]|_/.test(n) || n.endsWith('_') || NOT_OURS[n] || tree.actions.has(n) || tree.words.has(n)) continue;
    if (/^[A-Z][A-Z0-9_]+$/.test(n) && tree.words.has(`SPARK_CONSOLE_${n}`)) continue;   // a switch named without its prefix
    if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(n)) say(m.index, `names \`${n}\`, which is not an action (or any name the code uses)`, 'actions');
    else say(m.index, `names \`${n}\`, which the code does not have`);
  }
}

function checkLinePointers(file, text, out) {
  for (const m of text.matchAll(/[\w.-]+\.(?:mjs|js|py|sh):\d+|, :\d+(?:-\d+)?\b|`:\d+(?:-\d+)?`/g)) {
    out.push({ check: 'lines', file, line: lineAt(text, m.index), message: `points at a line (${m[0].replace(/^, /, '')}): give the part and its function names, or the test file and part of the test's name` });
  }
}

function checkCounts(file, text, out) {
  const COUNTS = [
    // (a limit is not a count: “at most 24 tools”, “up to 12 tools”, “in 2 parts”, “3 tools at once”, “4 tools a round”)
    /(?<!\b(?:at most|up to|in) )\b\d+ (?:read |change |top-level )?(?:actions|lookups|tools|parts|rules)\b(?! at once| a round)/g,
    /\b\d+ (?:reads|lookups),? (?:and )?\d+ changes\b/g,
    /\bR1 ?(?:–|-|to) ?R\d+\b/g,
  ];
  for (const re of COUNTS) for (const m of text.matchAll(re)) {
    out.push({ check: 'counts', file, line: lineAt(text, m.index), message: `types a count (“${m[0]}”): counts drift; say “every …”, or name the list (the code map has the numbers)` });
  }
}

function checkSize(file, text, out) {
  const [, limit, today] = LIMITS.find(([re]) => re.test(file));
  const bytes = Buffer.byteLength(text), max = today ?? limit;
  if (bytes > max) out.push({ check: 'sizes', file, line: 1, message: `is ${bytes} bytes, over its ${today ? `ceiling of ${max} (the limit is ${limit}; it may only shrink)` : `limit of ${max}`}` });
  const lineMax = LONG_LINES[file] ?? LINE_MAX;
  text.split('\n').forEach((l, i) => {
    if (l.length > lineMax) out.push({ check: 'sizes', file, line: i + 1, message: `has a line of ${l.length} characters (at most ${lineMax})` });
  });
}

const headings = text => [...text.matchAll(/^## (.+)$/gm)].map(m => m[1].trim());

function checkShape(tree, out) {
  const say = (file, msg, line = 1) => out.push({ check: 'shape', file, line, message: msg });
  for (const f of tree.rules) {
    const t = read(tree.root, `docs/rules/${f}`), n = Number(f.slice(1, 3));
    if (t.split('\n')[0] !== `# R${n}`) say(`docs/rules/${f}`, `starts with “${t.split('\n')[0]}”, not “# R${n}”`);
    if (headings(t).join('|') !== RULE_HEADINGS.join('|')) say(`docs/rules/${f}`, `has the headings ${headings(t).join(', ') || 'none'}; a rule file has ${RULE_HEADINGS.join(', ')}, in that order`);
  }
  const cards = existsSync(join(tree.root, 'docs/how')) ? readdirSync(join(tree.root, 'docs/how')).filter(f => f.endsWith('.md')).sort() : [];
  for (const f of cards) {
    const t = read(tree.root, `docs/how/${f}`);
    if (!/^# \S/.test(t)) say(`docs/how/${f}`, 'has no title (“# …”) on its first line');
    if (headings(t).join('|') !== CARD_HEADINGS.join('|')) say(`docs/how/${f}`, `has the headings ${headings(t).join(', ') || 'none'}; a card has ${CARD_HEADINGS.join(', ')}, in that order`);
  }
  const agents = existsSync(join(tree.root, 'AGENTS.md')) ? read(tree.root, 'AGENTS.md') : '';
  const listed = [...agents.matchAll(/^\|[^|\n]+\|\s*`?docs\/how\/([a-z0-9-]+\.md)`?\s*\|\s*$/gm)].map(m => m[1]);
  for (const f of cards) if (!listed.includes(f)) say('AGENTS.md', `has no row in its task table for docs/how/${f}`);
  for (const f of listed) if (!cards.includes(f)) say('AGENTS.md', `lists docs/how/${f} in its task table, but there is no such card`);
  if (tree.rules.length && existsSync(join(tree.root, 'docs/rules.md')) && read(tree.root, 'docs/rules.md') !== rulesIndex(tree.root)) {
    say('docs/rules.md', 'is not what docs/rules/ makes: run node tools/make.mjs');
  }
}

// The Rule paragraph of a rule file, its lines joined: the text as it was in the map's table.
export function ruleText(text) {
  const m = text.match(/^## Rule\n\n([\s\S]*?)\n\n## /m);
  return m ? m[1].split('\n').join(' ') : null;
}

// docs/rules.md: one line per rule, the first sentence of its Rule paragraph (cut at 180 characters). Generated;
// tools/make.mjs writes it.
export function rulesIndex(root = ROOT) {
  const files = readdirSync(join(root, 'docs/rules')).filter(f => /^R\d\d\.md$/.test(f)).sort();
  const lines = files.map(f => {
    const text = (ruleText(read(root, `docs/rules/${f}`)) || '').replace(/^\*\*R\d+\.\*\* /, '');
    const first = text.match(/^.*?\.(?= |$)/)?.[0] || text;   // its first sentence
    let cut = first.length > 180 ? first.slice(0, 180).replace(/\s+\S*$/, '') : first;
    if ((cut.match(/`/g) || []).length % 2) cut = cut.slice(0, cut.lastIndexOf('`')).trimEnd();   // never half a code span
    if (cut !== first) cut += ' …';
    return `- [R${Number(f.slice(1, 3))}](rules/${f}): ${cut}`;
  });
  return [
    '# Rules every change keeps',
    '',
    'Written by `node tools/make.mjs` from `docs/rules/`; don’t edit it by hand. One line per rule: the start of its',
    'Rule paragraph. Its file has the rest: why, where the code falls short today, where it lives, and what checks it.',
    '',
    ...lines,
    '',
  ].join('\n');
}

export function checkDocs(root = ROOT) {
  const tree = readTree(root), out = [];
  for (const f of tree.docs) {
    const text = read(root, f);
    checkPaths(tree, f, text, out);
    if (PATHS_ONLY.includes(f)) continue;
    checkIds(tree, f, text, out);
    checkNames(tree, f, text, out);
    checkLinePointers(f, text, out);
    checkCounts(f, text, out);
    checkSize(f, text, out);
  }
  for (const [f, text] of Object.entries(tree.parts)) checkIds(tree, `service/src/${f}`, text, out, { code: true });
  for (const f of tree.tests) checkIds(tree, f, read(root, f), out, { code: true });
  checkShape(tree, out);
  return out;
}

export const describe = p => `${p.file}:${p.line}: ${p.message} [${p.check}]`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = checkDocs();
  for (const p of problems) console.error(describe(p));
  if (problems.length) {
    console.error(`\nThe documents have drifted from the code (${problems.length} problem${problems.length === 1 ? '' : 's'}). Fix the document, or the code if the document is right.`);
    process.exit(1);
  }
  console.log('The documents match the code.');
}
