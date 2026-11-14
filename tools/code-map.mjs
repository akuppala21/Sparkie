// docs/code-map.md is written from the code, so it can't go out of date: every part of the service with what it is for,
// the actions it defines, the state files it owns, its timers and its functions. It is how an agent (or Sparkie) finds
// where something lives before changing it. docs/architecture.md says how the parts fit; docs/rules/ holds the rules.
//
//   node tools/code-map.mjs           writes docs/code-map.md
//   node tools/code-map.mjs --check   exits 1 if docs/code-map.md isn't what the code makes (test/build.test.mjs runs this)
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'service', 'src'), OUT = join(ROOT, 'docs', 'code-map.md');
const uniq = xs => [...new Set(xs)];

// A part's title (its banner comment) and the comment lines under it: what the part is for, in its author's words.
function about(text) {
  const lines = text.split('\n');
  const banner = lines.findIndex(l => /^\/\* ─+ .+ ─+ \*\/$/.test(l.trim()));
  const title = banner >= 0 ? lines[banner].replace(/^\/\* ─+ | ─+ \*\/$/g, '').trim() : null;
  const intro = [];
  for (const l of lines.slice(banner + 1)) { if (!l.startsWith('//')) break; intro.push(l.replace(/^\/\/ ?/, '')); }
  return { title, intro: intro.join(' ').replace(/\s+/g, ' ').trim() };
}
function partOf(file) {
  const text = readFileSync(join(SRC, file), 'utf8'), { title, intro } = about(text);
  const actions = [...text.matchAll(/^\s*name: '([a-z_]+)', title: '([^']+)', kind: '(read|change)'/gm)].map(m => ({ name: m[1], title: m[2], kind: m[3], file }));
  const functions = uniq([...text.matchAll(/^(?:async )?function\*? ([A-Za-z_$][\w$]*)|^const ([A-Za-z_$][\w$]*) = (?:async )?(?:\([^)]*\)|[A-Za-z_$][\w$]*) =>/gm)].map(m => m[1] || m[2]));
  const state = uniq([...text.matchAll(/`\$\{STATE_DIR\}\/([\w.-]+)`/g)].map(m => m[1]));
  const timers = uniq([...text.matchAll(/setInterval\(\s*(?:\(\) => )?([A-Za-z_$][\w$]*)/g)].map(m => m[1]));
  return { file, title, intro, lines: text.split('\n').length - 1, actions, functions, state, timers };
}

export function codeMap() {
  const parts = readdirSync(SRC).filter(f => /^\d{2}-[a-z0-9-]+\.mjs$/.test(f)).sort().map(partOf);
  const actions = parts.flatMap(p => p.actions);
  const out = [
    '# Code map',
    '',
    'Written by `node tools/code-map.mjs` from the code; don’t edit it by hand (a test fails when it’s out of date).',
    'How the parts fit together is in `docs/architecture.md`; the rules every change must keep are in `docs/rules/`. What to read first is in `AGENTS.md`.',
    '',
    `The service is ${parts.length} parts in \`service/src/\`, joined in name order into \`service/server.mjs\` (${parts.reduce((n, p) => n + p.lines, 0)} lines in all). They share one scope, so a function in any part can be called from any other at run time; code that runs while the file loads can only use earlier parts.`,
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
      `- **Lines:** ${p.lines}`,
      ...(p.actions.length ? [`- **Actions:** ${p.actions.map(a => `\`${a.name}\``).join(', ')}`] : []),
      ...(p.state.length ? [`- **State files it names:** ${p.state.map(s => `\`${s}\``).join(', ')}`] : []),
      ...(p.timers.length ? [`- **Runs on a timer:** ${p.timers.map(t => `\`${t}\``).join(', ')}`] : []),
      `- **Functions:** ${p.functions.map(f => `\`${f}\``).join(', ') || 'none at the top level'}`,
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
