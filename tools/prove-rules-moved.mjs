// Proves the rules moved out of docs/architecture.md without a changed byte. On 2026-11-13 section 5 of the map (a
// table, one row per rule) became docs/rules/R01.md … R40.md. This reads the old map from git, and for every rule
// compares the old Rule and Why cells with the Rule and Why paragraphs of its file, each line break read back as the
// one space it replaced. The Where and Checked by cells were rewritten on purpose (line pointers became names), so
// they are not compared.
//
//   node tools/prove-rules-moved.mjs                    the map as it was in commit eb81881 (git show)
//   node tools/prove-rules-moved.mjs --from old.md      the map from a file
//
// It prints one line per rule that differs and exits 1, or says that all of them are the same.
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = process.argv.indexOf('--from');
const old = from > 0
  ? readFileSync(process.argv[from + 1], 'utf8')
  : execFileSync('git', ['show', 'eb81881:docs/architecture.md'], { cwd: ROOT, encoding: 'utf8' });

const rows = new Map();
for (const line of old.split('\n')) {
  const m = line.match(/^\| \*\*R(\d+)\.\*\* /);
  if (!m) continue;
  const cells = line.slice(2, -2).split(' | ');
  if (cells.length !== 4) throw new Error(`R${m[1]}: ${cells.length} cells, not 4`);
  rows.set(Number(m[1]), { rule: cells[0], why: cells[1] });
}

const section = (text, name) => {
  const m = text.match(new RegExp(`^## ${name}\\n\\n([\\s\\S]*?)\\n\\n## `, 'm'));
  return m ? m[1].split('\n').join(' ') : null;
};

const files = readdirSync(join(ROOT, 'docs', 'rules')).filter(f => /^R\d\d\.md$/.test(f)).sort();
const bad = [];
for (const [id, cells] of rows) {
  const f = `R${String(id).padStart(2, '0')}.md`;
  if (!files.includes(f)) { bad.push(`R${id}: no docs/rules/${f}`); continue; }
  const text = readFileSync(join(ROOT, 'docs', 'rules', f), 'utf8');
  for (const [name, want] of [['Rule', cells.rule], ['Why', cells.why]]) {
    const got = section(text, name);
    if (got !== want) bad.push(`R${id}: its ${name} paragraph differs from the map's (${got == null ? 'missing' : `${Buffer.byteLength(got)} bytes, was ${Buffer.byteLength(want)}`})`);
  }
}
for (const f of files) if (!rows.has(Number(f.slice(1, 3)))) bad.push(`docs/rules/${f}: no such rule in the old map`);

if (bad.length) { for (const b of bad) console.error(b); process.exit(1); }
const bytes = [...rows.values()].reduce((n, c) => n + Buffer.byteLength(c.rule) + Buffer.byteLength(c.why), 0);
console.log(`All ${rows.size} rules: the Rule and Why text in docs/rules/ is the map's, byte for byte (${bytes} bytes compared).`);
