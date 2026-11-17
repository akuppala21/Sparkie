// Affected tests only (design C, 2.4): the test files a change needs, from a map of which test files ran each function
// of the service's parts. The map is recorded, not kept by hand. A whole run with SPARK_TEST_MAP=1 (test/lock.mjs) runs
// every test file with Node's own coverage (NODE_V8_COVERAGE, one folder per test file) and, after it passes, writes
// test/affected-map.json:
//
//   {tree, tests: [test files], fns: {"21-apps.mjs:keepApp@120-188": [3, 17]}, missed: [{file, fns, at}]}
//
// (a function by its part, name and lines there; the test files that ran it by their place in tests). The Spark runner
// brings it back beside its lock as <name>.affected-map.json. The pick never decides an install: that still needs the
// whole suite on the exact build (R29). A wrong pick costs time, not safety.
//
//   node tools/affected.mjs pick [--landing] [base]   the test files this folder's change needs against base (main
//                                              when not given): one per line, or the one word all; why on stderr
//   node tools/affected.mjs build <coverage folder> [--tree <hash>] [--out <file>]
//   node tools/affected.mjs missed [--landing] <a whole run's log> [ref]
//        the files that failed there but the pick for the change since the last tested build would not have run,
//        printed and kept in that build's map, so the next pick adds them for those functions
//
// The pick is the files that ran the changed functions, every changed test file, and always the short check. It is
// all whenever 2.4 says so: no map for the base or a commit before it, a part added or removed, a changed line
// outside any function, a function most test files run, more than 8 parts changed, or any of the paths in ALWAYS.
// Documents alone pick the documents test alone. That strict pick is for GitHub's quick job and Sparkie's own changes.
// --landing is the pick tools/land.mjs uses: nearly every step touches a core part, and the whole suite runs after
// every landing anyway, so the core parts use the map like any other and service/config.json adds only the short
// check; still all with no map, a part added or removed, a line outside any function, more than 8 parts, or a path
// every test depends on (LANDING_ALWAYS, LANDING_ALWAYS_PARTS). Maps are read from test/affected-map.json and from the runner's
// results folders (SPARK_TEST_OUT, and every spark-test-runs* folder beside this one); the newest commit of base
// whose tree has one is the base the change is measured from.
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blank, ALWAYS_PARTS, LANDING_ALWAYS_PARTS } from './parts.mjs';
// (the two lists of parts live in parts.mjs, with the check tools/make.mjs runs on them: make loads only tools that can
// run nothing, and this one runs git)
export { ALWAYS_PARTS, LANDING_ALWAYS_PARTS, checkAffected } from './parts.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MAP_FILE = 'test/affected-map.json';
const PART = /^service\/src\/(\d{2}-[a-z0-9-]+\.mjs)$/;
// Sign-in, lock-out safety, Sparkie's own rules and the one way to change a Spark: any change to these, or to one of
// ALWAYS_PARTS (in parts.mjs), runs everything.
export const ALWAYS = [/^service\/(passkey|dig)\.mjs$/, /^service\/worker\.py$/, /^service\/config\.json$/, /^deploy\//,
  /^test\/lib\.mjs$/, /^test\/start-mock\.mjs$/, /^test\/mock\//, /^test\/lock\.mjs$/, /^tools\//, /^\.github\//];
// What every test depends on: all, even in a landing (and LANDING_ALWAYS_PARTS, in parts.mjs).
export const LANDING_ALWAYS = [/^service\/(passkey|dig)\.mjs$/, /^service\/worker\.py$/, /^deploy\//, /^test\/lib\.mjs$/,
  /^test\/start-mock\.mjs$/, /^test\/mock\//, /^test\/lock\.mjs$/, /^tools\//];
// Everything starts and answers, sign-in works, the installer can still read the service.
export const SHORT_CHECK = ['build', 'fleet', 'api', 'door', 'passkey', 'internet', 'sparkie', 'install', 'go-back'].map(n => `test/${n}.test.mjs`);
export const UI_CHECK = ['build', 'page', 'page-preview', 'api', 'door', 'passkey', 'internet', 'sparkie'].map(n => `test/${n}.test.mjs`);
export const DOCS_TEST = 'test/docs.test.mjs';
// Direct-import tests do not execute server.mjs, so its coverage map cannot discover this edge.
export const DIRECT_TESTS = { '17-context.mjs': ['test/context-policy.test.mjs'], '13-ask.mjs': ['test/brain-ask.test.mjs'] };
const MOST = 0.5;          // a function run by more than this share of the test files: everything
const MAX_PARTS = 8;       // more parts changed than this: everything
const HISTORY = 500;       // how far back along base a map is looked for
const isDoc = f => /\.md$/.test(f) || /^docs\//.test(f);
const isTest = f => /^test\/[^/]+\.test\.mjs$/.test(f);
// Every test file of a whole run, as test/lock.mjs runs them ('test/*.test.mjs').
export const testFiles = (root = ROOT) => readdirSync(join(root, 'test')).filter(f => f.endsWith('.test.mjs')).sort().map(f => `test/${f}`);

function git(top, args, { allowFail = false } = {}) {
  const r = spawnSync('git', ['-C', top, '-c', 'core.quotePath=false', ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) { if (allowFail) return null; throw new Error(`git ${args.join(' ')}: ${(r.stderr || '').trim()}`); }
  return r.stdout;
}
export const gitTop = (dir = process.cwd()) => git(dir, ['rev-parse', '--show-toplevel']).trim();
const commitOf = (top, ref) => git(top, ['rev-parse', '--verify', '-q', `${ref}^{commit}`], { allowFail: true })?.trim() || null;
const short = c => String(c).slice(0, 7);

// ── The map ─────────────────────────────────────────────────────────────────────────────────────────────────────────

// The parts as server.mjs joins them, with where each starts in it and where each of its lines starts (offsets in
// UTF-16 units, as V8 counts them).
function partsOf(root) {
  const src = join(root, 'service', 'src');
  let at = 0;
  return readdirSync(src).filter(f => /^\d{2}-[a-z0-9-]+\.mjs$/.test(f)).sort().map(name => {
    const text = readFileSync(join(src, name), 'utf8'), lines = [0];
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines.push(i + 1);
    const p = { name, start: at, end: at + text.length, lines };
    at += text.length;
    return p;
  });
}
// The last index i with xs[i] <= v.
function below(xs, v, get = x => x) {
  let lo = 0, hi = xs.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (get(xs[mid]) <= v) lo = mid; else hi = mid - 1; }
  return lo;
}
function keyOf(parts, name, from, to) {
  const p = parts[below(parts, from, q => q.start)];
  if (!p || from < p.start || to > p.end) return null;
  return `${p.name}:${name || '(anonymous)'}@${below(p.lines, from - p.start) + 1}-${below(p.lines, to - 1 - p.start) + 1}`;
}

// The map from one run's coverage: <folder>/<test file name>/coverage-*.json, written by every process a test file
// started (the service among them). Only the service's own server.mjs counts, and only the exact one these parts make.
export function buildMap(folder, { root = ROOT, tests, tree = null }) {
  const parts = partsOf(root), total = parts.at(-1)?.end ?? 0;
  const place = new Map(tests.map((t, i) => [t, i]));
  const fns = new Map();
  for (const d of readdirSync(folder)) {
    const i = place.get(`test/${d}`);
    if (i === undefined) continue;
    let files = [];
    try { files = readdirSync(join(folder, d)).filter(f => f.endsWith('.json')); } catch { continue; }
    for (const f of files) {
      const raw = readFileSync(join(folder, d, f), 'utf8');
      if (!raw.includes('server.mjs')) continue;
      let cov;
      try { cov = JSON.parse(raw); } catch { continue; }
      for (const s of cov.result || []) {
        if (!/\/server\.mjs$/.test(s.url || '') || !s.functions?.some(fn => fn.ranges?.[0]?.startOffset === 0 && fn.ranges[0].endOffset === total)) continue;
        for (const fn of s.functions) {
          const r = fn.ranges?.[0];
          if (!r || (r.startOffset === 0 && r.endOffset === total)) continue;
          const key = keyOf(parts, fn.functionName, r.startOffset, r.endOffset);
          if (!key) continue;
          if (!fns.has(key)) fns.set(key, new Set());
          if (r.count > 0) fns.get(key).add(i);
        }
      }
    }
  }
  return { tree, tests, fns: Object.fromEntries([...fns.keys()].sort().map(k => [k, [...fns.get(k)].sort((a, b) => a - b)])), missed: [] };
}

const isMap = m => m && typeof m === 'object' && Array.isArray(m.tests) && m.fns && typeof m.fns === 'object';
// Every map this folder can see: its own test/affected-map.json and the runner's results beside it.
export function findMaps(top, env = process.env) {
  const base = dirname(top), dirs = new Set(env.SPARK_TEST_OUT ? [env.SPARK_TEST_OUT] : []);
  try { for (const d of readdirSync(base)) if (/^spark-test-runs/.test(d)) dirs.add(join(base, d)); } catch {}
  const files = [join(top, MAP_FILE)];
  for (const d of dirs) { try { for (const f of readdirSync(d)) if (f.endsWith('.affected-map.json')) files.push(join(d, f)); } catch {} }
  const out = [], seen = new Set();
  for (const file of files) {
    try {
      const real = realpathSync(file);
      if (seen.has(real)) continue;
      seen.add(real);
      const map = JSON.parse(readFileSync(file, 'utf8'));
      if (isMap(map)) out.push({ file, map });
    } catch {}
  }
  return out;
}

// The newest commit of ref (or before it) whose tree has a map: the last tested build.
export function lastTested(top, ref, maps) {
  const byTree = new Map();
  for (const m of maps) if (/^[0-9a-f]{40}$/.test(m.map.tree || '') && !byTree.has(m.map.tree)) byTree.set(m.map.tree, m);
  if (!byTree.size) return null;
  const lines = (git(top, ['log', '--format=%H %T', '-n', String(HISTORY), ref], { allowFail: true }) || '').trim().split('\n').filter(Boolean);
  for (const [i, l] of lines.entries()) {
    const [commit, tree] = l.split(' ');
    if (byTree.has(tree)) return { commit, behind: i, ...byTree.get(tree) };
  }
  return null;
}

// ── The change ──────────────────────────────────────────────────────────────────────────────────────────────────────

// What changed from one commit to another, or to this folder as it is (to null: committed or not, untracked files as
// added): [{path, status: A|M|D, hunks: [{s, n, add: [new lines]}]}], s and n in the old file's lines.
export function changesBetween(top, from, to = null) {
  const args = ['diff', '-U0', '--no-renames', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', from, ...(to ? [to] : [])];
  const out = parsePatch(git(top, args));
  if (!to) {
    for (const f of git(top, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)) out.push({ path: f, status: 'A', hunks: [] });
  }
  return out;
}
function parsePatch(text) {
  const out = [];
  let cur = null, hunk = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      cur = { path: /^diff --git a\/(.*) b\//.exec(line)?.[1] ?? null, status: 'M', hunks: [] };
      out.push(cur); hunk = null;
      continue;
    }
    if (!cur) continue;
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (h) { hunk = { s: Number(h[1]), n: h[2] === undefined ? 1 : Number(h[2]), t: Number(h[3]), add: [] }; cur.hunks.push(hunk); continue; }
    if (hunk) { if (line.startsWith('+')) hunk.add.push(line.slice(1)); continue; }
    if (line.startsWith('new file mode')) cur.status = 'A';
    else if (line.startsWith('deleted file mode')) cur.status = 'D';
    else if (line.startsWith('+++ b/')) cur.path = line.slice(6);
    else if (line.startsWith('--- a/')) cur.path = line.slice(6);
  }
  return out.filter(c => c.path);
}

// A function's first line, when nothing else on it is code of the scope around it (a declaration, a method, an
// object's key), and a line that only closes it.
const DECL = /^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\b|^\s*(?:export\s+)?(?:const|let|var)\s+[\w$]+\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[\w$]+\s*=>)|^\s*(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?[\w$]+\s*\([^)]*\)\s*\{\s*$|^\s*[\w$]+\s*:\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[\w$]+\s*=>)/;
const CLOSE = /^\s*\}\s*[;,]?\s*$/;
// In a landing only: a hunk of comments and blank lines changes nothing that runs, and one that only adds whole
// functions at the top level (a declaration at the margin, its body indented, its closing brace) runs only when a
// changed caller calls it. Both are still all in the plain pick (2.4: a changed line outside any function). Lines are
// read as tools/parts.mjs reads code (blank: comments, strings and regular expressions made spaces, positions kept),
// so a brace in a string or a comment is not code; a comment is a line that blanks to nothing and starts as one.
const COMMENT = /^\s*(?:\/\/|\/\*|\*\/|\*(?:\s|$)|$)/;
const isComment = (line, blanked) => !blanked.trim() && COMMENT.test(line);
function onlyNewFunctions(blanked) {
  const code = blanked.filter(l => l.trim());
  return code.length > 0 && /^\S/.test(code[0]) && DECL.test(code[0])
    && code.every(l => /^\s/.test(l) || DECL.test(l) || CLOSE.test(l)) && (CLOSE.test(code.at(-1)) || /;\s*$/.test(code.at(-1)));
}
const span = f => f.el - f.sl;
const smallest = fs => fs.reduce((a, f) => (!a || span(f) < span(a) ? f : a), null);

// The function a hunk is inside (old lines s..s+n-1, or an insertion after line s), or null: outside any function.
function ownerOf(fns, old, { s, n, add }) {
  if (n === 0) return smallest(fns.filter(f => f.sl <= s && s + 1 <= f.el));
  const e = s + n - 1;
  const inner = smallest(fns.filter(f => f.sl < s && e < f.el));
  if (inner) return inner;
  // Its first or last line is part of the hunk: only when that line, before and after, is the function's own.
  const f = smallest(fns.filter(x => x.sl <= s && e <= x.el));
  if (!f) return null;
  if (s === f.sl && !(DECL.test(old[s - 1] ?? '') && DECL.test(add[0] ?? ''))) return null;
  if (e === f.el && f.el !== f.sl && !(CLOSE.test(old[e - 1] ?? '') && CLOSE.test(add.at(-1) ?? ''))) return null;
  return f;
}

const fnsByPart = map => {
  const by = new Map();
  for (const [key, tests] of Object.entries(map.fns)) {
    const m = /^([^:]+):(.*)@(\d+)-(\d+)$/.exec(key);
    if (!m) continue;
    if (!by.has(m[1])) by.set(m[1], []);
    by.get(m[1]).push({ key, part: m[1], name: m[2], sl: Number(m[3]), el: Number(m[4]), tests });
  }
  return by;
};
const plainKey = key => key.replace(/@\d+-\d+$/, '');
const list = xs => (xs.length > 3 ? `${xs.slice(0, 3).join(', ')} and ${xs.length - 3} more` : xs.join(', '));

// The pick for changes measured from the map's own tree. oldText(path) gives a part as it was there, newText(path) as it
// is now (a landing reads both). missed: every
// map's missed entries (a file that failed once though not picked for these functions).
export function choose({ map, changes, oldText, newText, missed = [], landing = false }) {
  const all = why => ({ all: true, files: null, fns: [], why });
  const always = landing ? LANDING_ALWAYS : ALWAYS, alwaysParts = landing ? LANDING_ALWAYS_PARTS : ALWAYS_PARTS;
  const byPart = fnsByPart(map), owners = new Map(), tests = new Set(), parts = new Set();
  let docs = false, generated = false, config = false, added = 0;
  for (const c of changes) {
    const part = PART.exec(c.path)?.[1];
    if (always.some(r => r.test(c.path))) return all(`${c.path} is on the list that always runs everything`);
    if (part) {
      if (c.status !== 'M') return all(`a part was ${c.status === 'A' ? 'added' : 'removed'}: ${part}`);
      if (alwaysParts.includes(part)) return all(`${part} is on the list that always runs everything`);
      parts.add(part);
      const was = oldText(c.path), old = was.split('\n'), fns = byPart.get(part) || [];
      const now = landing ? newText(c.path) : '', oldB = landing ? blank(was).split('\n') : [], nowB = landing ? blank(now).split('\n') : [];
      for (const h of c.hunks) {
        const gone = [h.s - 1, h.s - 1 + h.n], came = [h.t - 1, h.t - 1 + h.add.length];
        if (landing && old.slice(...gone).every((l, k) => isComment(l, oldB[gone[0] + k]))
          && now.split('\n').slice(...came).every((l, k) => isComment(l, nowB[came[0] + k]))) continue;
        const f = ownerOf(fns, old, h);
        if (!f && landing && h.n === 0 && onlyNewFunctions(nowB.slice(...came))) return all(`new functions have no measured coverage yet: ${part}`);
        if (!f) return all(`a changed line outside any function: ${part} line ${h.s}`);
        owners.set(f.key, f);
      }
    } else if (isTest(c.path)) { if (c.status !== 'D') tests.add(c.path); }
    else if (isDoc(c.path)) docs = true;
    else if (c.path === 'service/server.mjs') generated = true;
    else if (landing && c.path === 'service/config.json') config = true;
    else return all(`${c.path} is not in the map (it holds the service's parts only)`);
  }
  if (generated && !parts.size) return all('service/server.mjs changed but none of its parts did');
  if (parts.size > MAX_PARTS) return all(`${parts.size} parts changed (more than ${MAX_PARTS})`);
  const picked = new Set(SHORT_CHECK);
  for (const part of parts) for (const file of DIRECT_TESTS[part] || []) picked.add(file);
  for (const f of owners.values()) {
    if (!f.tests.length || f.tests.some(i => !map.tests[i])) return all(`${f.part} ${f.name} has no reliable measured test coverage`);
    if (!landing && f.tests.length > map.tests.length * MOST) return all(`${f.part} ${f.name} is run by ${f.tests.length} of ${map.tests.length} test files`);
    for (const i of f.tests) if (map.tests[i]) picked.add(map.tests[i]);
  }
  const plain = new Set([...owners.keys()].map(plainKey));
  const again = missed.filter(m => m.fns?.some(k => plain.has(k))).map(m => m.file).filter(isTest);
  for (const f of [...tests, ...again]) picked.add(f);
  if (docs) picked.add(DOCS_TEST);
  const said = [
    owners.size && `${owners.size} function${owners.size === 1 ? '' : 's'} in ${list([...parts].sort())}`,
    added && `${added} new function${added === 1 ? '' : 's'} (run by the changed callers' tests)`,
    tests.size && `${tests.size} changed test file${tests.size === 1 ? '' : 's'}`,
    again.length && `${again.length} once missed by the pick`,
    docs && 'the documents',
    config && 'service/config.json',
    'the short check',
  ].filter(Boolean);
  return { all: false, files: [...picked].sort(), fns: [...owners.keys()].sort(), why: said.join('; ') };
}

// The pick for this folder (to null) or a commit, against base.
export function pick({ top = gitTop(), base = 'main', to = null, maps = findMaps(top), landing = false } = {}) {
  const baseCommit = commitOf(top, base);
  if (!baseCommit) throw new Error(`No commit called ${base} here.`);
  const own = changesBetween(top, baseCommit, to);
  if (!own.length) return { all: false, files: [], fns: [], why: `nothing changed against ${base}` };
  if (own.every(c => isDoc(c.path))) return { all: false, files: [DOCS_TEST], fns: [], why: 'documents only: the documents test alone' };
  // UI-only edits have a bounded integration surface even before a service coverage map exists.
  // New public files and combined service changes still take the ordinary conservative route.
  if (own.some(c => /^public\/(app\.js|styles\.css|index\.html)$/.test(c.path))
    && own.every(c => (c.status === 'M' && /^public\/(app\.js|styles\.css|index\.html)$/.test(c.path)) || isDoc(c.path) || isTest(c.path))) {
    return { all: false, files: [...new Set([...UI_CHECK, ...own.filter(c => isTest(c.path) && c.status !== 'D').map(c => c.path), ...(own.some(c => isDoc(c.path)) ? [DOCS_TEST] : [])])].sort(), fns: [], why: 'UI changes: browser contracts, API and access integration' };
  }
  const tested = lastTested(top, baseCommit, maps);
  if (!tested) return { all: true, files: null, fns: [], why: `no map for ${base} or the ${HISTORY} commits before it (no whole run has recorded one yet)` };
  const r = choose({
    map: tested.map, changes: changesBetween(top, tested.commit, to),
    oldText: p => git(top, ['show', `${tested.commit}:${p}`]),
    newText: p => (to ? git(top, ['show', `${to}:${p}`]) : readFileSync(join(top, p), 'utf8')),
    missed: maps.flatMap(m => (Array.isArray(m.map.missed) ? m.map.missed : [])), landing,
  });
  const from = `from ${short(tested.commit)}, the last tested build${tested.behind ? ` (${tested.behind} commit${tested.behind === 1 ? '' : 's'} before ${base})` : ''}`;
  if (!r.all && !to) r.files = r.files.filter(f => existsSync(join(top, f)));
  return { ...r, tested, why: `${r.why} (${from})` };
}

// ── Missed by the pick ──────────────────────────────────────────────────────────────────────────────────────────────

// The files a whole run's log names as failed (the table test/file-times.mjs prints at its end).
export const failedIn = log => [...String(log).matchAll(/^\s*[\d.]+\s+FAIL\s+(test\/[^\s/]+\.test\.mjs)\s*$/gm)].map(m => m[1]);

// A whole run of ref failed: the failed files the pick for the change since the last tested build would not have run.
// Printed by the caller; kept in that build's map (missed), so the next pick adds them for those functions.
export function noteMissed({ top = gitTop(), failed, ref = 'HEAD', maps = findMaps(top), at = new Date().toISOString(), landing = false }) {
  const commit = commitOf(top, ref);
  const tested = commit && lastTested(top, commit, maps);
  if (!tested || !failed.length) return { missed: [], why: tested ? 'nothing failed' : 'no tested build before it to compare with' };
  if (tested.commit === commit || git(top, ['rev-parse', `${commit}^{tree}`]).trim() === tested.map.tree) {
    return { missed: [], why: 'this tree passed before: nothing changed to have picked from' };
  }
  const r = pick({ top, base: tested.commit, to: commit, maps, landing });
  if (r.all) return { missed: [], why: `the pick was everything: ${r.why}` };
  const missed = [...new Set(failed)].filter(f => !r.files.includes(f)).sort();
  const fns = r.fns.map(plainKey);
  if (missed.length && fns.length) {
    const kept = JSON.parse(readFileSync(tested.file, 'utf8'));
    kept.missed = [...(Array.isArray(kept.missed) ? kept.missed : []), ...missed.map(file => ({ file, fns, at }))];
    writeFileSync(tested.file, JSON.stringify(kept) + '\n');
  }
  return { missed, fns, tested, why: r.why };
}

// ── By hand ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (isMain()) {
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = name => { const i = rest.indexOf(name); return i >= 0 ? rest.splice(i, 2)[1] : null; };
  try {
    if (cmd === 'pick') {
      const landing = rest[0] === '--landing';
      const r = pick({ base: rest[landing ? 1 : 0] || 'main', landing });
      console.log(r.all ? 'all' : r.files.join('\n'));
      console.error(r.all ? `All: ${r.why}.` : `Picked ${r.files.length} test file${r.files.length === 1 ? '' : 's'}: ${r.why}.`);
    } else if (cmd === 'build' && rest[0]) {
      const tree = opt('--tree'), out = opt('--out') || join(ROOT, MAP_FILE);
      const tests = testFiles();
      const map = buildMap(rest[0], { tests, tree });
      writeFileSync(out, JSON.stringify(map) + '\n');
      console.log(`Wrote ${out}: ${Object.keys(map.fns).length} functions, ${tests.length} test files.`);
    } else if (cmd === 'missed' && rest.some(a => a !== '--landing')) {
      const landing = rest[0] === '--landing', [log, ref] = rest.filter(a => a !== '--landing');
      const r = noteMissed({ failed: failedIn(readFileSync(log, 'utf8')), ref: ref || 'HEAD', landing });
      for (const f of r.missed) console.log(`missed by the pick: ${f}`);
      console.error(r.missed.length ? `Kept in ${basename(r.tested.file)}: the next pick adds them for ${list(r.fns)}.` : `Nothing missed by the pick: ${r.why}.`);
    } else {
      console.error('Use: node tools/affected.mjs pick [--landing] [base] | build <coverage folder> [--tree <hash>] [--out <file>] | missed [--landing] <log> [ref]');
      process.exit(2);
    }
  } catch (e) { console.error(e.message); process.exit(1); }
}
