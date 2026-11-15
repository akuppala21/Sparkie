// docs/code-map.md is written from the code, so it can't go out of date: every part of the service with what it is for,
// its header (area, rules, tests, the state files it owns and their writers, timers, what it may wake), the actions it
// defines, its functions, and who uses what: the names it takes from other parts, and the parts that use it. It is how
// an agent (or Sparkie) finds where something lives before changing it. docs/architecture.md says how the parts fit;
// docs/rules/ holds the rules; docs/registry.md lists actions, state files, timers, events and operations.
//
//   node tools/code-map.mjs           writes docs/code-map.md
//   node tools/code-map.mjs --check   exits 1 if docs/code-map.md isn't what the code makes (test/build.test.mjs runs this)
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readParts } from './parts.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'code-map.md');
const names = xs => xs.map(x => `\`${x}\``).join(', ');

// A part's title (its banner comment) and the comment lines under its header: what the part is for, in its author's
// words.
function about(p) {
  const lines = p.text.split('\n');
  const banner = p.header ? 0 : lines.findIndex(l => /^\/\* ─+ .+ ─+ \*\/$/.test(l.trim()));
  const title = p.header?.title || (banner >= 0 ? lines[banner].replace(/^\/\* ─+ | ─+ \*\/$/g, '').trim() : null);
  const intro = [];
  for (const l of lines.slice(p.header ? p.header.lines : banner + 1)) { if (!l.startsWith('//')) break; intro.push(l.replace(/^\/\/ ?/, '')); }
  return { title, intro: intro.join(' ').replace(/\s+/g, ' ').trim() };
}

export function codeMap(root = ROOT) {
  const tree = readParts(root);
  const usedBy = new Map();
  for (const p of tree.parts) for (const q of p.uses?.keys() || []) usedBy.set(q, [...(usedBy.get(q) || []), p.file]);
  const parts = tree.parts.map(p => ({ ...p, ...about(p), h: p.header?.fields || {}, usedBy: usedBy.get(p.file) || [] }));
  const actions = parts.flatMap(p => p.actions);
  const out = [
    '# Code map',
    '',
    'Written by `node tools/code-map.mjs` from the code; don’t edit it by hand (a test fails when it’s out of date).',
    'How the parts fit together is in `docs/architecture.md`; the rules every change must keep are in `docs/rules/`; actions, state files, timers, events and operations are in `docs/registry.md`. What to read first is in `AGENTS.md`.',
    '',
    `The service is ${parts.length} parts in \`service/src/\`, joined in name order into \`service/server.mjs\` (${parts.reduce((n, p) => n + p.lines, 0)} lines in all). They share one scope, so a function in any part can be called from any other at run time; code that runs while the file loads can only use earlier parts. Each part starts with its header (docs/rules/R28.md). “Uses” lists the names a part takes from each other part (a name counts when it is a top-level name of exactly one other part); “Used by”, the parts that take a name from it.`,
    '',
    '## Every action, and where it lives',
    '',
    `${actions.filter(a => a.kind === 'read').length} lookups and ${actions.filter(a => a.kind === 'change').length} changes. The same list is what Sparkie, the agent door (\`/mcp\`) and \`POST /console/api/actions/<name>\` offer.`,
    '',
    '| Action | Kind | What it is | Part |',
    '|---|---|---|---|',
    ...actions.map(a => `| \`${a.name}\` | ${a.kind} | ${a.title} | \`${a.file}\` |`),
    '',
    '## Every part',
    '',
    ...parts.flatMap(p => [
      `### \`${p.file}\`${p.title ? `: ${p.title}` : ''}`,
      '',
      ...(p.intro ? [p.intro.length > 600 ? `${p.intro.slice(0, 600).replace(/\s+\S*$/, '')} …` : p.intro, ''] : []),
      ...(p.header?.whole ? [`- **Area:** ${p.h.Area}. **Rules:** ${p.h.Rules}. **Tests:** ${p.h.Tests}`] : ['- **No header** (`node tools/make.mjs --check` says what to add)']),
      `- **Lines:** ${p.lines}`,
      ...(p.actions.length ? [`- **Actions:** ${names(p.actions.map(a => a.name))}`] : []),
      ...(p.header?.whole ? [`- **Owns:** ${p.h.Owns}`, `- **Timers:** ${p.h.Timers}`, `- **Wakes:** ${p.h.Wakes}`] : []),
      `- **Functions:** ${names(p.functions) || 'none at the top level'}`,
      `- **Uses:** ${[...(p.uses || new Map())].sort(([a], [b]) => a.localeCompare(b)).map(([q, ns]) => `\`${q.slice(0, -4)}\` (${names([...ns])})`).join(', ') || 'nothing from other parts'}`,
      `- **Used by:** ${names(p.usedBy.sort().map(q => q.slice(0, -4))) || 'no other part'}`,
      '',
    ]),
  ];
  return `${out.join('\n').trimEnd()}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const made = codeMap();
  if (process.argv.includes('--check')) {
    let current = '';
    try { current = readFileSync(OUT, 'utf8'); } catch {}
    if (current !== made) {
      console.error('docs/code-map.md is out of date: run node tools/code-map.mjs.');
      process.exit(1);
    }
    console.log('docs/code-map.md matches the code.');
  } else {
    writeFileSync(OUT, made);
    console.log(`Wrote docs/code-map.md (${made.split('\n').length} lines).`);
  }
}
