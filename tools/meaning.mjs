// The meaning diff: which texts whose meaning is the owner's differ between two trees (design F 2.2 and 2.7, check 13).
// Design C's button for a change Sparkie proposes to its own code shows this list, so the owner sees exactly these.
//
//   node tools/check-docs.mjs --meaning <base> [<head>] [--json]
//
// <base> and <head> are each a folder or a commit git knows in this repository; <head> is this folder when left out.
// It prints each text by its id, with the words it had and the words it has (--json: the same, as one JSON list a
// button can show), and exits 1 when there is any, 0 when there is none, 2 when a tree can't be read.
//
// What it compares, each by its id, so a text that only moved is no change:
//   docs/contract.md     each requirement (`- 6.6 …`, with the indented lines under it), each acceptance test row
//                        (`| T54 | … |`), each open choice (`- **O1 …`), and each section's other words (its heading and
//                        paragraphs, as a set: `§7`; `§0` is the part before section 1)
//   docs/rules/Rnn.md    the Rule paragraph only: not Why, Today, Where or Checked by
//   docs/glossary.md     each word's meaning (its second column), by the word
// Not a change: lines wrapped again (all white space is one space), a text moved, and a pointer fixed: a name in
// backticks that named nothing in the base tree, now one that names something; or one the code renamed (the old name
// is gone from the code, the new one is new). Any other changed word, number or mark is a change.
import { readFileSync, readdirSync, existsSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTree, ruleText } from './check-docs.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KINDS = {
  requirement: 'contract requirement', test: 'acceptance test', choice: 'open choice',
  text: 'contract text outside the numbered rules', rule: 'Rule paragraph', word: 'glossary meaning',
};

const isDir = p => { try { return statSync(p).isDirectory(); } catch { return false; } };
const readIf = (root, f) => (existsSync(join(root, f)) ? readFileSync(join(root, f), 'utf8') : '');
const flat = s => s.replace(/\s+/g, ' ').trim();

// docs/contract.md: id → { kind, text }. A requirement or open choice runs on over the lines below it that are
// indented or blank; the words of each section that are in none of them are its paragraphs, kept as a list.
export function contractTexts(text) {
  const items = new Map(), item = (id, kind) => items.get(id) || items.set(id, { kind, lines: [] }).get(id);
  let section = '0', open = null, para = null;
  for (const line of text.split('\n')) {
    if (open && (line === '' || /^\s/.test(line))) { open.lines.push(line); continue; }
    open = null;
    const heading = line.match(/^## (\d+)\./);
    if (heading) section = heading[1];
    const m = line.match(/^- (\d+\.\d+) /) || line.match(/^- \*\*(O\d+)\b/);
    if (m) { (open = item(m[1], /^O/.test(m[1]) ? 'choice' : 'requirement')).lines.push(line); para = null; continue; }
    const t = line.match(/^\| (T\d+) \|/);
    if (t) { item(t[1], 'test').lines.push(line); para = null; continue; }
    if (!line.trim()) { para = null; continue; }
    if (!para || /^(?:#|- |\| |\d+\. |```)/.test(line)) item(`§${section}`, 'text').lines.push(para = []);
    para.push(line);
  }
  return new Map([...items].map(([id, { kind, lines }]) => [id, kind === 'text'
    ? { kind, paragraphs: lines.map(p => flat(p.join(' '))) }
    : { kind, text: flat(lines.join(' ')) }]));
}

// docs/glossary.md: word → its meaning (the table's first two columns; the header row left out).
export function glossaryTexts(text) {
  const out = new Map(), lines = text.split('\n');
  lines.forEach((line, i) => {
    if (!/^\|/.test(line) || /^\|\s*:?-/.test(line) || /^\|\s*:?-/.test(lines[i + 1] || '')) return;
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map(c => c.trim());
    if (cells[0]) out.set(cells[0], { kind: 'word', text: flat(cells[1] || '') });
  });
  return out;
}

// docs/rules/: R46 → its Rule paragraph.
export function ruleTexts(root) {
  const dir = join(root, 'docs/rules'), out = new Map();
  for (const f of existsSync(dir) ? readdirSync(dir).filter(f => /^R\d\d\.md$/.test(f)).sort() : []) {
    out.set(`R${Number(f.slice(1, 3))}`, { kind: 'rule', text: flat(ruleText(readFileSync(join(dir, f), 'utf8')) || '') });
  }
  return out;
}

// What a name in backticks points at in a tree: true or false, or null when it isn't a pointer (a command, a number,
// a pattern). A pointer is a code name (one the tree's code uses, or an action) or a file or folder of the tree.
function pointsIn(root) {
  let tree = null;
  return span => {
    const n = span.replace(/\(\)$/, '');
    if (/^[A-Za-z_$][\w$]*$/.test(n)) { tree ??= readTree(root); return tree.words.has(n) || tree.actions.has(n); }
    if (!/^[\w.-]*[\w-](?:\/[\w.-]+)*\/?$/.test(n) || !/[./]/.test(n) || !/[A-Za-z]/.test(n)) return null;
    tree ??= readTree(root);
    const p = n.replace(/\/$/, '');
    return tree.all.some(f => f === p || f.endsWith(`/${p}`) || f.startsWith(`${p}/`));
  };
}

// Two texts say the same when their words are the same, in order, but for pointers fixed (see the top).
const WORDS = /`[^`]*`|[^\s`]+/g;
function sameWords(a, b, look) {
  if (a === b) return true;
  const x = a.match(WORDS) || [], y = b.match(WORDS) || [];
  return x.length === y.length && x.every((w, i) => w === y[i] || pointerFixed(w, y[i], look));
}
function pointerFixed(a, b, look) {
  if (!/^`.+`$/.test(a) || !/^`.+`$/.test(b)) return false;
  const was = a.slice(1, -1), is = b.slice(1, -1);
  const wasThen = look.base(was), isNow = look.head(is);
  if (wasThen == null || isNow == null || !isNow) return false;
  return !wasThen || (!look.head(was) && !look.base(is));   // a typo fixed, or a rename followed
}

// Each item of a section's paragraphs that the other side has no paragraph for.
function unmatched(was, is, look) {
  const left = [...was], right = [...is];
  for (const pass of [(p, q) => p === q, (p, q) => sameWords(p, q, look)]) {
    for (let i = left.length - 1; i >= 0; i--) {
      const j = right.findIndex(q => pass(left[i], q));
      if (j >= 0) { left.splice(i, 1); right.splice(j, 1); }
    }
  }
  return [left, right];
}

// Every meaning text that differs between the trees at baseRoot and headRoot (folders): a list of
// { id, kind, what, change: 'changed' | 'added' | 'removed', old, new, file }, in the head tree's order.
export function meaningDiff(baseRoot, headRoot) {
  const look = { base: pointsIn(baseRoot), head: pointsIn(headRoot) };
  const sources = [
    ['docs/contract.md', root => contractTexts(readIf(root, 'docs/contract.md'))],
    ['docs/rules/', ruleTexts],
    ['docs/glossary.md', root => glossaryTexts(readIf(root, 'docs/glossary.md'))],
  ];
  const out = [];
  for (const [file, texts] of sources) {
    const was = texts(baseRoot), is = texts(headRoot);
    for (const id of [...new Set([...is.keys(), ...was.keys()])]) {
      const a = was.get(id), b = is.get(id), kind = (b || a).kind;
      const item = (change, old, now) => out.push({ id, kind, what: KINDS[kind], change, old, new: now, file });
      if (kind === 'text') {
        const [gone, came] = unmatched(a?.paragraphs || [], b?.paragraphs || [], look);
        if (gone.length || came.length) item(!a ? 'added' : !b ? 'removed' : 'changed', gone.join('\n') || null, came.join('\n') || null);
      } else if (!a) item('added', null, b.text);
      else if (!b) item('removed', a.text, null);
      else if (!sameWords(a.text, b.text, look)) item('changed', a.text, b.text);
    }
  }
  return out;
}

// A tree to read: a folder as it is, or a commit written out by git archive into a folder that done() removes.
export function treeAt(where, cwd = ROOT) {
  if (isDir(where)) return { root: resolve(where), done() {} };
  if (where.startsWith('-')) throw new Error(`${where} is not a folder or a commit`);
  const tar = spawnSync('git', ['archive', '--format=tar', where], { cwd, maxBuffer: 1 << 30 });
  if (tar.status !== 0) throw new Error(`${where} is neither a folder nor a commit git knows in ${cwd}: ${String(tar.stderr).trim()}`);
  const root = mkdtempSync(join(tmpdir(), 'meaning-'));
  const x = spawnSync('tar', ['-x', '-C', root], { input: tar.stdout });
  if (x.status !== 0) { rmSync(root, { recursive: true, force: true }); throw new Error(`could not unpack ${where}: ${String(x.stderr).trim()}`); }
  return { root, done: () => rmSync(root, { recursive: true, force: true }) };
}

const CHANGE = { changed: 'reworded', added: 'new', removed: 'gone' };
export function describeMeaning(items, base, head) {
  if (!items.length) return `No meaning text differs between ${base} and ${head}.`;
  const lines = [`${items.length} meaning text${items.length === 1 ? '' : 's'} differ${items.length === 1 ? 's' : ''} between ${base} and ${head}; each needs the owner's word.`];
  for (const i of items) {
    lines.push('', `${i.kind === 'word' ? `“${i.id}”` : i.id}, ${i.what} (${i.file}): ${CHANGE[i.change]}`);
    if (i.old != null) lines.push(...i.old.split('\n').map(l => `  was: ${l}`));
    if (i.new != null) lines.push(...i.new.split('\n').map(l => `  now: ${l}`));
  }
  return lines.join('\n');
}

// The command: node tools/check-docs.mjs --meaning <base> [<head>] [--json]. Returns the exit code.
export function meaningCli(args, cwd = ROOT) {
  const [base, head] = args.filter(a => !a.startsWith('--')), json = args.includes('--json');
  if (!base) { console.error('Use: node tools/check-docs.mjs --meaning <base> [<head>] [--json] (a folder or a commit each; head: this folder)'); return 2; }
  const trees = [];
  try {
    trees.push(treeAt(base, cwd));
    trees.push(head ? treeAt(head, cwd) : { root: cwd, done() {} });
    const items = meaningDiff(trees[0].root, trees[1].root);
    console.log(json ? JSON.stringify(items, null, 2) : describeMeaning(items, base, head || 'this folder'));
    return items.length ? 1 : 0;
  } catch (e) {
    console.error(e.message);
    return 2;
  } finally {
    for (const t of trees) t.done();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(meaningCli(process.argv.slice(2)));
