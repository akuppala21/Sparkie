// The parts of the service as the code map, docs/registry.md and the header check read them: each part's header
// (declared by hand), and what is made from the code: its top-level names, its actions, who writes each state file,
// every timer, every event and operation type, and which names a part uses from the others.
//
// Patterns, not a parser. Comments, strings and regular expressions are blanked first (positions kept), so code is read
// only where it is code. Top-level names start at column 0, as they do today. What it can't read it says so: a write it
// can't place, an event type it can't tell, brackets that don't match. tools/make.mjs runs checkParts; so does
// test/docs.test.mjs, on this tree and on small made-up ones.
//
// The header, at the very top of every part (docs/rules/R28.md):
//   /* ───────── what the part is, in a few words ───────── */
//   // Area: core        Rules: R1, R11        Tests: change.test.mjs
//   // Owns: desired.json (writers: desiredAfter, keepApp)
//   // Timers: watchHeld (every 60 s)        Wakes: none
// Keys may share a line (two spaces apart) or run on over lines that start with "//" and three spaces.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PART = /^\d{2}-[a-z0-9-]+\.mjs$/;
export const KEYS = ['Area', 'Rules', 'Tests', 'Owns', 'Timers', 'Wakes'];
const TITLE = /^\/\* ─+ (.+?) ─+ \*\/$/;

// The number bands (docs/design-2026-11-13/f-structure.md, 2.3): the two digits set load order only, and each band takes
// the areas listed. A part's Area says which band it belongs in.
export const BANDS = [
  { from: 1, to: 9, areas: ['ground'], what: 'ground: setup, SSH, identity, the library, jobs; no actions' },
  { from: 10, to: 15, areas: ['knowledge', 'brain'], what: 'knowledge and the brain' },
  { from: 16, to: 19, areas: ['core'], what: 'the action core: registry, gate, changes, workflows, watcher' },
  { from: 20, to: 20, areas: ['record', 'safety'], what: 'record and safety, called by the core' },
  { from: 21, to: 21, areas: ['features'], what: 'features with their own actions' },
  { from: 22, to: 24, areas: ['ways in'], what: 'ways in' },
  { from: 25, to: 25, areas: ['start'], what: 'start-up, always last' },
];
// Parts outside their band today, numbered before the bands existed. Moving one changes load order, so it waits for its
// own step; this list may only shrink.
export const BAND_TODAY = {
  '20-mcp.mjs': 'the agent door is a way in (22–24), loaded before the 21 parts',
};

// Calls that write a file, and which of their arguments are paths. writePrivate is the service's own (R20).
const WRITES = { writePrivate: [0], writeFileSync: [0], appendFileSync: [0], renameSync: [0, 1], copyFileSync: [1], unlinkSync: [0], rmSync: [0], truncateSync: [0], openSync: [0] };
// Functions that write a file they are given. Their callers are the writers (writePrivate), or they only put a damaged
// file aside and its earlier copy back, so their callers read (readKept). A new one goes here, or its callers are missed.
export const HELPERS = {
  writePrivate: 'writes the file it is given: whoever calls it writes that file (R20)',
  readKept: 'sets a file it can’t read aside and its earlier copy back: whoever calls it reads (R20)',
};
// Files under the state folder that are not state: sockets (the daily copy leaves them out too).
const NOT_STATE = /\.sock$/;

const IDENT = /[A-Za-z_$][\w$]*/y;
const KEYWORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const NOT_NAMES = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'new', 'await', 'async', 'const', 'let', 'var', 'of', 'in', 'do', 'else', 'try', 'finally', 'throw', 'class', 'this', 'null', 'true', 'false', 'undefined', 'delete', 'void', 'yield', 'instanceof', 'case', 'default', 'break', 'continue', 'import', 'export', 'from', 'static', 'get', 'set', 'super', 'extends']);

// Comments, string and template text and regular expressions become spaces (newlines and the quote marks stay, and a
// template's ${…} stays code), so every position in the result is the same position in the source.
export function blank(src) {
  const out = src.split('');
  const wipe = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  const modes = [{ tpl: false, depth: 0 }];
  let prev = '', word = '', i = 0;
  const n = src.length;
  while (i < n) {
    const m = modes[modes.length - 1], c = src[i];
    if (m.tpl) {
      if (c === '\\') { wipe(i, i + 2); i += 2; continue; }
      if (c === '`') { modes.pop(); i++; prev = '`'; word = ''; continue; }
      if (c === '$' && src[i + 1] === '{') { modes.push({ tpl: false, depth: 0 }); i += 2; prev = '{'; word = ''; continue; }
      if (c !== '\n') out[i] = ' ';
      i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') { let j = src.indexOf('\n', i); if (j < 0) j = n; wipe(i, j); i = j; continue; }
    if (c === '/' && src[i + 1] === '*') { let j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; wipe(i, j); i = j; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      wipe(i + 1, j); i = j + 1; prev = c; word = '';
      continue;
    }
    if (c === '`') { modes.push({ tpl: true }); i++; continue; }
    if (c === '/') {
      const regex = /[\w$]/.test(prev) ? KEYWORDS.has(word) : !prev || !/[)\]'"`0-9]/.test(prev);
      if (regex) {
        let j = i + 1, cls = false;
        while (j < n && src[j] !== '\n') {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '[') cls = true;
          else if (src[j] === ']') cls = false;
          else if (src[j] === '/' && !cls) break;
          j++;
        }
        if (j < n && src[j] === '/') {
          wipe(i + 1, j); i = j + 1;
          while (i < n && /[a-z]/.test(src[i])) i++;
          prev = ')'; word = '';
          continue;
        }
      }
      prev = '/'; word = ''; i++;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) { IDENT.lastIndex = i; const w = IDENT.exec(src)[0]; prev = 'a'; word = w; i += w.length; continue; }
    if (/[0-9]/.test(c)) { while (i < n && /[\w.]/.test(src[i])) i++; prev = '0'; word = ''; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '{') m.depth++;
    if (c === '}') {
      if (m.depth === 0 && modes.length > 1) { modes.pop(); i++; continue; }
      m.depth--;
    }
    prev = c; word = ''; i++;
  }
  return out.join('');
}

// Every bracket's partner in blanked code, or the first one that has none.
function pairs(code) {
  const close = new Map(), open = new Map(), stack = [];
  const want = { ')': '(', ']': '[', '}': '{' };
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') stack.push(i);
    else if (c in want) {
      const o = stack.pop();
      if (o === undefined || code[o] !== want[c]) return { bad: i };
      close.set(o, i); open.set(i, o);
    }
  }
  return stack.length ? { bad: stack.pop() } : { close, open };
}
const nextCode = (code, i) => { while (i < code.length && /\s/.test(code[i])) i++; return i; };
const lineAt = (text, i) => text.slice(0, i).split('\n').length;
// The names in a stretch of blanked code, in order: not a member (`a.b` gives a), but a spread (`...b`) is one.
const idents = s => [...s.matchAll(/(?<![\w$])[A-Za-z_$][\w$]*/g)]
  .filter(m => !NOT_NAMES.has(m[0]) && (s[m.index - 1] !== '.' || s.slice(Math.max(0, m.index - 3), m.index) === '...'));
const words = s => idents(s).map(m => m[0]);

// The parts of one argument list: [start, end) spans of the text between the brackets at open and close.
function args(code, close, open) {
  const out = [];
  let start = open + 1, depth = 0;
  for (let i = open + 1; i < close.get(open); i++) {
    const c = code[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) { out.push([start, i]); start = i + 1; }
  }
  if (code.slice(start, close.get(open)).trim()) out.push([start, close.get(open)]);
  return out;
}

// A part's header: its title line, then the keyed lines. null fields are missing.
export function header(text) {
  const lines = text.split('\n');
  const t = TITLE.exec(lines[0] || '');
  const fields = {}, seen = [];
  let last = null, end = 1;
  const keyRe = new RegExp(`^(${KEYS.join('|')}): ?`);
  for (let k = 1; t && k < lines.length; k++) {
    const l = lines[k];
    const cont = /^\/\/ {3,}(\S.*)$/.exec(l);
    if (cont && last) { fields[last] = `${fields[last]} ${cont[1].trim()}`.trim(); end = k + 1; continue; }
    const body = /^\/\/ (.*)$/.exec(l)?.[1];
    if (body == null || !keyRe.test(body)) break;
    for (const seg of body.split(new RegExp(`\\s{2,}(?=(?:${KEYS.join('|')}): )`))) {
      const m = keyRe.exec(seg);
      if (!m) { last = null; break; }
      if (m[1] in fields) seen.push(m[1]);
      fields[m[1]] = seg.slice(m[0].length).trim();
      last = m[1];
    }
    end = k + 1;
  }
  return t ? { title: t[1].trim(), fields, twice: seen, lines: end, whole: KEYS.every(k => k in fields) } : null;
}

// Splits "a (x, y), b, c (z)" at the commas outside brackets.
const items = s => {
  const out = [];
  let depth = 0, cur = '';
  for (const c of s) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
};
const none = v => /^none\b/i.test(v || '');

// Owns: "access.json (writers: changeAccess, ownAccess), audit.jsonl (writers: none; the installer writes it)"
export function owned(value) {
  if (!value || none(value)) return [];
  return items(value).map(it => {
    const m = /^`?([\w.-]+)`?\s*(?:\((.*)\))?$/.exec(it);
    if (!m) return { file: it, writers: null };
    const w = /^writers?: ([^;]*)(?:;\s*(.*))?$/.exec((m[2] || '').trim());
    return { file: m[1], writers: w ? (none(w[1]) ? [] : w[1].split(',').map(s => s.trim().replace(/^`|`$/g, '')).filter(Boolean)) : null, note: w?.[2]?.trim() || '' };
  });
}
// Timers: "watchHeld (every 60 s), healPass (every HEAL_PASS_MS)": each item's first name (or "top level").
export const timerNames = value => (!value || none(value) ? [] : items(value).map(it => (/^top level\b/.test(it) ? 'top level' : /^`?([A-Za-z_$][\w$]*)/.exec(it)?.[1] || it)));

// One part, read: its header, top-level names, functions, actions, and the writes, timers, events and operations in it.
function readPart(file, text) {
  const code = blank(text), pr = pairs(code);
  const part = { file, text, code, header: header(text), lines: text.split('\n').length - 1, bad: pr.bad ?? null, top: [], fns: [], acts: [] };
  part.actions = [...text.matchAll(/^\s*name: '([a-z_]+)', title: '([^']+)', kind: '(read|change)'.*$/gm)].map(m => ({ name: m[1], title: m[2], kind: m[3], file,
    group: m[0].match(/\bgroup: '([a-z]+)'/)?.[1] || null }));
  part.functions = [...new Set([...text.matchAll(/^(?:async )?function\*? ([A-Za-z_$][\w$]*)|^const ([A-Za-z_$][\w$]*) = (?:async )?(?:\([^)]*\)|[A-Za-z_$][\w$]*) =>/gm)].map(m => m[1] || m[2]))];
  if (part.bad != null) return part;
  const { close, open } = pr;
  part.close = close;
  // Top-level names: declarations that start at column 0.
  for (const m of code.matchAll(/^(?:export )?(?:async )?(?:function\*?|class) ([A-Za-z_$][\w$]*)/gm)) part.top.push({ name: m[1], at: m.index });
  for (const m of code.matchAll(/^(?:export )?(?:const|let|var) /gm)) {
    let i = m.index + m[0].length, depth = 0, start = i;
    const decl = [];
    for (; i < code.length; i++) {
      const c = code[i];
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth--;
      else if (depth === 0 && (c === ',' || c === ';')) { decl.push([start, i]); start = i + 1; if (c === ';') break; }
      else if (depth === 0 && c === '\n' && /^[^\s)\]}.?:+\-*/&|,]/.test(code.slice(i + 1, i + 2))) break;
    }
    if (i >= code.length || code[i] !== ';') decl.push([start, i]);
    for (const [a, b] of decl) {
      const name = /^\s*([A-Za-z_$][\w$]*)/.exec(code.slice(a, b))?.[1];
      if (name) part.top.push({ name, at: a, init: [a, b] });
    }
  }
  // Functions: declarations, and function or arrow expressions, with their parameters and body. Named when declared with
  // a name or bound to one (const x = () => …, x = function …).
  const bodyOf = from => {
    const j = nextCode(code, from);
    if (code[j] === '{') return [j, close.get(j)];
    let depth = 0, k = j;
    for (; k < code.length; k++) {
      const c = code[k];
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
      else if (depth === 0 && (c === ',' || c === ';')) break;
    }
    return [j, k];
  };
  const boundName = at => /(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?$/.exec(code.slice(Math.max(0, at - 80), at))?.[1] || null;
  for (const m of code.matchAll(/\bfunction\b\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\(/g)) {
    const p = m.index + m[0].length - 1, pe = close.get(p);
    const [b, e] = bodyOf(pe + 1);
    part.fns.push({ name: m[1] || boundName(m.index), params: words(code.slice(p + 1, pe)), start: b, end: e });
  }
  for (const m of code.matchAll(/=>/g)) {
    let k = m.index - 1;
    while (k >= 0 && /\s/.test(code[k])) k--;
    let ps, params;
    if (code[k] === ')') { ps = open.get(k); params = words(code.slice(ps + 1, k)); } else {
      const w = /([A-Za-z_$][\w$]*)$/.exec(code.slice(Math.max(0, k - 60), k + 1));
      if (!w) continue;
      ps = k + 1 - w[1].length; params = [w[1]];
    }
    let s = ps;
    const before = code.slice(Math.max(0, s - 6), s);
    if (/async\s*$/.test(before)) s -= before.length - before.search(/async\s*$/);
    const [b, e] = bodyOf(m.index + 2);
    part.fns.push({ name: boundName(s), params, start: b, end: e });
  }
  // Actions: action({ name: '…', … }) at the top level.
  for (const m of code.matchAll(/^action\(/gm)) {
    const p = m.index + m[0].length - 1;
    const name = /name: '([a-z_]+)'/.exec(text.slice(p, close.get(p)))?.[1];
    if (name) part.acts.push({ name, start: p, end: close.get(p) });
  }
  return part;
}

// Where a position is: the functions around it (innermost first), the nearest named one, and how it is named here
// (that function, else the action it is in, else "top level").
function around(part, at) {
  const fns = part.fns.filter(f => f.start <= at && at < f.end).sort((a, b) => b.start - a.start);
  const named = fns.find(f => f.name);
  const act = part.acts.find(a => a.start <= at && at < a.end);
  return { fns, named, who: named && (!act || named.start > act.start) ? named.name : act ? act.name : 'top level' };
}

// Reads every part of a tree, with the facts made from the code.
export function readParts(root = ROOT) {
  const dir = join(root, 'service/src');
  const files = existsSync(dir) ? readdirSync(dir).filter(f => PART.test(f)).sort() : [];
  const parts = files.map(f => readPart(f, readFileSync(join(dir, f), 'utf8')));
  const topOf = new Map();
  for (const p of parts) for (const t of p.top) topOf.set(t.name, [...(topOf.get(t.name) || []), p.file]);
  // State files: a top-level constant whose value is a path in the state folder (or in the home folder), and the ones
  // made from those (`${ACCESS_FILE}.good`).
  const state = new Map();
  for (const p of parts) for (const t of p.top) {
    if (!t.init || !/^[A-Z][A-Z0-9_]*$/.test(t.name)) continue;
    const init = p.text.slice(t.init[0], t.init[1]);
    const m = /`\$\{STATE_DIR\}\/([\w.-]+)`/.exec(init) || /`\$\{homedir\(\)\}\/[\w./-]*?([\w.-]+\.json)`/.exec(init);
    if (m && !NOT_STATE.test(m[1])) state.set(t.name, { file: m[1], part: p.file, inState: /STATE_DIR/.test(m[0]) });
  }
  for (const p of parts) for (const t of p.top) {
    const m = t.init && /^\s*[A-Z][A-Z0-9_]*\s*=\s*`\$\{([A-Z][A-Z0-9_]*)\}([\w.-]+)`\s*$/.exec(p.text.slice(t.init[0], t.init[1]));
    if (m && state.has(m[1]) && !state.has(t.name)) state.set(t.name, { file: state.get(m[1]).file + m[2], part: p.file, inState: state.get(m[1]).inState });
  }
  const tree = { root, parts, topOf, state, writes: [], timers: [], events: [], ops: [], problems: [] };
  for (const p of parts) if (p.bad == null) scan(tree, p);
  return tree;
}

// What a path argument stands for: state files, or a path the function was given.
function resolve(tree, part, at, span, seen = new Set()) {
  const out = { files: new Set(), given: false, inline: [] };
  const src = part.text.slice(span[0], span[1]), code = part.code.slice(span[0], span[1]);
  for (const m of src.matchAll(/\$\{STATE_DIR\}\/([\w.-]+)/g)) out.inline.push(m[1]);
  const { fns } = around(part, at);
  for (const w of words(code)) {
    if (seen.has(w)) continue;
    seen.add(w);
    let local = null, param = false;
    for (const f of fns) {
      const d = [...part.code.slice(f.start, at).matchAll(new RegExp(`(?:\\b(?:const|let|var)\\s+|,\\s*)${w.replace(/\$/g, '\\$')}\\s*=(?![=>])`, 'g'))].pop();
      if (d) { local = f.start + d.index + d[0].length; break; }
      if (f.params.includes(w)) { param = true; break; }
    }
    if (local != null) {
      let depth = 0, k = local;
      for (; k < part.code.length; k++) {
        const c = part.code[k];
        if ('([{'.includes(c)) depth++;
        else if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
        else if (depth === 0 && (c === ',' || c === ';' || c === '\n')) break;
      }
      const r = resolve(tree, part, local, [local, k], seen);
      r.files.forEach(f => out.files.add(f)); out.given ||= r.given; out.inline.push(...r.inline);
    } else if (param) out.given = true;
    else if (tree.state.has(w)) out.files.add(tree.state.get(w).file);
  }
  return out;
}

// The quoted values an expression can give: 'a', or each branch of `x ? 'a' : 'b'`. null when one isn't quoted.
function results(code, text, s, e) {
  let depth = 0, q = -1;
  for (let k = s; k < e; k++) {
    const c = code[k];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === '?' && depth === 0 && code[k + 1] !== '.' && code[k + 1] !== '?' && code[k - 1] !== '?') { q = k; break; }
  }
  if (q >= 0) {
    let nest = 0;
    depth = 0;
    for (let k = q + 1; k < e; k++) {
      const c = code[k];
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth--;
      else if (depth === 0 && c === '?' && code[k + 1] !== '.' && code[k + 1] !== '?' && code[k - 1] !== '?') nest++;
      else if (depth === 0 && c === ':') {
        if (nest) { nest--; continue; }
        const a = results(code, text, q + 1, k), b = results(code, text, k + 1, e);
        return a && b ? [...a, ...b] : null;
      }
    }
    return null;
  }
  const m = /^\s*\(?\s*'([a-z][a-z-]*)'\s*\)?\s*$/.exec(text.slice(s, e));
  return m ? [m[1]] : null;
}

function scan(tree, part) {
  const { code, text, close } = part;
  const at = i => lineAt(text, i);
  const say = (i, message) => tree.problems.push({ check: 'parts', file: `service/src/${part.file}`, line: at(i), message });
  const callAt = re => [...code.matchAll(re)].filter(m => !/\bfunction\s+$/.test(code.slice(Math.max(0, m.index - 12), m.index)));
  // Writes to state files.
  for (const m of callAt(new RegExp(`(?<![\\w$.])(${Object.keys(WRITES).join('|')})\\s*\\(`, 'g'))) {
    const p = m.index + m[0].length - 1, a = args(code, close, p), call = m[1];
    if (call === 'openSync' && !/['"][^'"]*[wa+]/.test(text.slice(...(a[1] || [p, p])))) continue;
    const where = around(part, m.index);
    const files = new Set();
    let given = false;
    for (const k of WRITES[call]) {
      if (!a[k]) continue;
      const r = resolve(tree, part, m.index, a[k]);
      r.files.forEach(f => files.add(f));
      for (const f of r.inline) say(m.index, `${where.who} writes \`\${STATE_DIR}/${f}\` (${call}) without a constant: give the file a top-level constant (\`const X_FILE = \`\${STATE_DIR}/${f}\`\`) and write through it`);
      given ||= r.given;
    }
    if (files.size) for (const f of files) tree.writes.push({ file: f, who: where.who, part: part.file, call, line: at(m.index) });
    else if (given && !HELPERS[where.named?.name]) say(m.index, `${where.named?.name || where.who} writes a file it is given (${call}): if it is a helper for state files, add it to HELPERS (and WRITES) in tools/parts.mjs so its callers are found`);
  }
  // Timers. A setInterval repeats; so does a setTimeout that calls the function it is in again, or that ends a sleep
  // inside a loop.
  const loops = [];
  for (const m of code.matchAll(/\b(?:while|for)\s*\(/g)) {
    const p = m.index + m[0].length - 1, b = nextCode(code, close.get(p) + 1);
    if (code[b] === '{') loops.push([b, close.get(b)]);
  }
  for (const m of code.matchAll(/\bdo\s*\{/g)) { const b = m.index + m[0].length - 1; loops.push([b, close.get(b)]); }
  for (const m of callAt(/(?<![\w$.])set(Interval|Timeout)\s*\(/g)) {
    const p = m.index + m[0].length - 1, a = args(code, close, p);
    if (!a[0]) continue;
    const cb = code.slice(...a[0]).trim(), where = around(part, m.index);
    const plain = /^[A-Za-z_$][\w$]*$/.test(cb) ? cb : null;
    const sleep = plain && where.fns.some(f => f.params.includes(plain) && !f.name) && loops.some(([s, e]) => s <= m.index && m.index < e && s > (where.named?.start ?? -1));
    // (named by what it calls: the function given, else the first top-level name in its body; failing both, by the
    // function it is in, which doesn't make it repeat)
    const calls = plain && !sleep ? plain : !plain ? words(cb).find(w => tree.topOf.has(w)) || null : null;
    const key = calls || where.named?.name || 'top level';
    const repeats = m[1] === 'Interval' || sleep || Boolean(calls && where.named && calls === where.named.name);
    tree.timers.push({ key, part: part.file, repeats, call: `set${m[1]}`, in: where.who, line: at(m.index) });
  }
  // Events and operation types.
  for (const m of callAt(/(?<![\w$.])fleetEvent\s*\(/g)) {
    const p = m.index + m[0].length - 1, span = [p + 1, close.get(p)], where = around(part, m.index);
    const types = [];
    for (const t of code.slice(...span).matchAll(/\btype\s*:/g)) {
      let k = span[0] + t.index + t[0].length, depth = 0;
      const s = k;
      for (; k < span[1]; k++) {
        const c = code[k];
        if ('([{'.includes(c)) depth++;
        else if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
        else if (depth === 0 && c === ',') break;
      }
      const lits = results(code, text, s, k);
      if (!lits) say(m.index, `${where.who} sends an event whose type can’t be read (\`${text.slice(s, k).trim()}\`): give it as a quoted type, or each choice of one`);
      types.push(...(lits || []));
    }
    if (!types.length && !/\btype\s*:/.test(code.slice(...span))) say(m.index, `${where.who} sends an event whose type can’t be read: call fleetEvent with an object that has \`type: '…'\``);
    for (const type of types) tree.events.push({ type, who: where.who, part: part.file, line: at(m.index) });
  }
  for (const m of callAt(/(?<![\w$.])newJob\s*\(/g)) {
    const p = m.index + m[0].length - 1, a = args(code, close, p), where = around(part, m.index);
    const lits = (a[0] && results(code, text, ...a[0])) || [];
    if (!lits.length) say(m.index, `${where.who} starts an operation whose type can’t be read: give newJob its type quoted, or each choice of one`);
    for (const type of lits) tree.ops.push({ type, who: where.who, part: part.file, line: at(m.index) });
  }
  // Uses: a name that is a top-level name of exactly one other part.
  const mine = new Set(part.top.map(t => t.name));
  part.uses = new Map();
  for (const m of idents(code)) {
    const w = m[0], where = tree.topOf.get(w);
    if (mine.has(w) || !where || where.length !== 1) continue;
    // (an object's key, `{ jobs: 1 }`, isn't a use; a ternary's `? a : b` is)
    if (/:\s*$/.test(code.slice(m.index + w.length, m.index + w.length + 3)) && /[{,]\s*$/.test(code.slice(Math.max(0, m.index - 20), m.index))) continue;
    const q = where[0];
    if (!part.uses.has(q)) part.uses.set(q, new Set());
    part.uses.get(q).add(w);
  }
}

// The text a missing or wrong header should have, filled in from the code where it can be.
export function suggest(tree, part) {
  const n = Number(part.file.slice(0, 2)), band = BANDS.find(b => n >= b.from && n <= b.to);
  const ruleDir = join(tree.root, 'docs/rules');
  const rules = existsSync(ruleDir) ? readdirSync(ruleDir).filter(f => /^R\d\d\.md$/.test(f)).sort()
    .filter(f => { const t = readFileSync(join(ruleDir, f), 'utf8'); const w = t.split(/^## Where$/m)[1]?.split(/^## /m)[0] || ''; return w.includes(part.file); })
    .map(f => `R${Number(f.slice(1, 3))}`) : [];
  const testName = `${part.file.slice(3, -4)}.test.mjs`;
  const own = [...tree.state.entries()].filter(([, s]) => s.part === part.file).map(([, s]) => s.file);
  const owns = own.map(f => `${f} (writers: ${[...new Set(tree.writes.filter(w => w.file === f).map(w => w.who))].join(', ') || 'none'})`);
  const timers = [...new Set(tree.timers.filter(t => t.part === part.file && t.repeats).map(t => `${t.key} (every …)`))];
  const title = part.header?.title || TITLE.exec(part.text.split('\n')[0])?.[1] || 'what this part is, in a few words';
  return [
    `/* ───────── ${title} ───────── */`,
    `// Area: ${band ? band.areas.join(' or ') : '?'}        Rules: ${rules.join(', ') || 'none'}        Tests: ${existsSync(join(tree.root, 'test', testName)) ? testName : '<its test files>'}`,
    `// Owns: ${owns.join(', ') || 'none'}`,
    `// Timers: ${timers.join(', ') || 'none'}        Wakes: none`,
  ].join('\n');
}

// The header check (docs/design-2026-11-13/f-structure.md, 2.7 row 6): every part has its header; the tests and rules it
// names exist; the functions that write a state file are exactly the writers its owner declares; every repeating timer
// is declared; every event type is in EVENT_TYPES and every operation type is named in R13; every part is in its band.
export function checkParts(root = ROOT, tree = readParts(root)) {
  const out = [...tree.problems];
  const say = (part, line, message) => out.push({ check: 'parts', file: `service/src/${part}`, line, message });
  const ruleIds = new Set(existsSync(join(root, 'docs/rules')) ? readdirSync(join(root, 'docs/rules')).filter(f => /^R\d\d\.md$/.test(f)).map(f => Number(f.slice(1, 3))) : []);
  const declared = new Map();
  for (const p of tree.parts) {
    if (p.bad != null) { say(p.file, lineAt(p.text, p.bad), `can’t be read: a bracket here has no partner once comments, strings and regular expressions are set aside`); continue; }
    const h = p.header, hand = 'declared by hand from what the code does; docs/rules/R28.md';
    if (!h) { say(p.file, 1, `has no header. Put these lines at its very top (a title, then the six keys, ${hand}):\n${suggest(tree, p)}`); continue; }
    const missing = KEYS.filter(k => !(k in h.fields));
    if (missing.length) { say(p.file, 1, `has a header without ${missing.join(', ')}. Its title line stays; the keys go right under it (${hand}), for example:\n${suggest(tree, p).split('\n').slice(1).join('\n')}`); continue; }
    if (h.twice.length) say(p.file, 1, `gives ${h.twice.join(', ')} twice in its header`);
    const f = h.fields, n = Number(p.file.slice(0, 2)), band = BANDS.find(b => n >= b.from && n <= b.to);
    // Area and band.
    const areaBand = BANDS.find(b => b.areas.includes(f.Area));
    if (!areaBand) say(p.file, 2, `has the Area “${f.Area}”; an area is one of ${BANDS.flatMap(b => b.areas).join(', ')}`);
    else if (areaBand !== band && !BAND_TODAY[p.file]) say(p.file, 2, `is numbered ${p.file.slice(0, 2)}, but its Area, ${f.Area}, is the band ${String(areaBand.from).padStart(2, '0')}–${String(areaBand.to).padStart(2, '0')} (${areaBand.what}): number it in that band, or give the area of the band it is in (${band ? band.areas.join(' or ') : 'none'})`);
    else if (areaBand === band && BAND_TODAY[p.file]) say(p.file, 2, `is in its band now: take it off BAND_TODAY in tools/parts.mjs`);
    if (band && band.to <= 9 && p.actions.length) say(p.file, 2, `is a ground part (01–09), which has no actions, but defines ${p.actions.map(a => a.name).join(', ')}`);
    // Rules and tests named exist.
    const rules = none(f.Rules) ? [] : items(f.Rules);
    for (const r of rules) {
      if (!/^R\d+$/.test(r)) say(p.file, 2, `has “${r}” in Rules; give rule ids (R1, R20), comma-separated, or none`);
      else if (!ruleIds.has(Number(r.slice(1)))) say(p.file, 2, `names ${r} in Rules, which no file in docs/rules/ defines`);
    }
    for (const t of none(f.Tests) ? [] : items(f.Tests)) {
      if (!/^[\w.-]+\.mjs$/.test(t)) say(p.file, 2, `has “${t}” in Tests; give test file names (state.test.mjs), comma-separated, or none`);
      else if (!existsSync(join(root, 'test', t))) say(p.file, 2, `names ${t} in Tests, which is not in test/`);
    }
    // Owns.
    for (const o of owned(f.Owns)) {
      if (!o.writers) { say(p.file, 1, `has “${o.file}” in Owns without its writers: write it as ${o.file} (writers: name, name), or (writers: none; who does)`); continue; }
      if (declared.has(o.file)) say(p.file, 1, `owns ${o.file}, which ${declared.get(o.file).part} owns too`);
      declared.set(o.file, { part: p.file, writers: o.writers });
    }
    // Timers.
    const names = timerNames(f.Timers), have = tree.timers.filter(t => t.part === p.file);
    for (const t of have.filter(t => t.repeats && !names.includes(t.key))) say(p.file, t.line, `has a repeating timer nobody declared (${t.call} in ${t.in}, calling ${t.key}): add “${t.key} (every …)” to its Timers line`);
    for (const t of names.filter(x => !have.some(h2 => h2.key === x))) say(p.file, 1, `declares the timer ${t}, which the part doesn’t have (a timer is named by the function it calls, else the first top-level name it uses, else the function it is in)`);
  }
  // Every state file is owned by the part that defines it, and its writers are exactly the declared ones.
  const files = new Map();
  for (const [, s] of tree.state) files.set(s.file, s);
  for (const [file, s] of files) {
    const d = declared.get(file), found = [...new Set(tree.writes.filter(w => w.file === file).map(w => w.who))];
    const where = name => tree.writes.find(w => w.file === file && w.who === name);
    if (!d) { if (tree.parts.find(p => p.file === s.part)?.header?.fields?.Owns != null) say(s.part, 1, `keeps ${file} but its Owns line doesn’t list it: add “${file} (writers: ${found.join(', ') || 'none'})”`); continue; }
    if (d.part !== s.part) say(d.part, 1, `owns ${file}, which ${s.part} defines: the part that defines a state file owns it`);
    for (const w of found.filter(x => !d.writers.includes(x))) say(d.part, 1, `doesn’t declare ${w} (${where(w).part}, ${where(w).call}) as a writer of ${file}: add it to “${file} (writers: …)”, or write the file only where it is declared`);
    for (const w of d.writers.filter(x => !found.includes(x))) say(d.part, 1, `declares ${w} as a writer of ${file}, but nothing by that name writes it`);
  }
  for (const [file, d] of declared) if (!files.has(file)) say(d.part, 1, `owns ${file}, which no part keeps (a state file is a top-level constant: \`\${STATE_DIR}/${file}\`)`);
  // Event and operation types.
  const listed = eventTypes(tree);
  if (tree.events.length && !listed) out.push({ check: 'parts', file: 'service/src', line: 1, message: 'has no EVENT_TYPES list, so the event types sent can’t be checked' });
  // (one problem per type, at the first place it is sent, naming every place)
  const firsts = xs => [...new Map(xs.map(x => [x.type, xs.filter(y => y.type === x.type)])).values()];
  const places = xs => [...new Set(xs.map(x => `${x.who} in ${x.part}`))].join(', ');
  for (const es of firsts(tree.events.filter(e => listed && !listed.includes(e.type)))) say(es[0].part, es[0].line, `sends the event type “${es[0].type}” (${places(es)}), which EVENT_TYPES doesn’t list: add it there (16-reads.mjs) and to describeEvent (19-watcher.mjs)`);
  const r13 = existsSync(join(root, 'docs/rules/R13.md')) ? readFileSync(join(root, 'docs/rules/R13.md'), 'utf8') : '';
  for (const os of firsts(tree.ops.filter(o => !r13.includes(`\`${o.type}\``)))) say(os[0].part, os[0].line, `starts operations of type “${os[0].type}” (${places(os)}), which docs/rules/R13.md doesn’t name: name it there, in backticks, saying whether it takes a claim`);
  return out;
}

export function eventTypes(tree) {
  for (const p of tree.parts) {
    const m = /^const EVENT_TYPES = \[([^\]]*)\]/m.exec(p.text);
    if (m) return [...m[1].matchAll(/'([a-z][a-z-]*)'/g)].map(x => x[1]);
  }
  return null;
}

// A Set(['a', 'b']) or { a: ['x'] } table in the parts, read as text.
function table(tree, name) {
  for (const p of tree.parts) {
    const s = new RegExp(`^const ${name} = new Set\\(\\[([^\\]]*)\\]\\)`, 'm').exec(p.text);
    if (s) return new Set([...s[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]));
    const o = new RegExp(`^const ${name} = \\{([\\s\\S]*?)\\};`, 'm').exec(p.text);
    if (o) return new Map([...o[1].matchAll(/([a-z_]+): \[([^\]]*)\]/g)].map(x => [x[1], [...x[2].matchAll(/'([a-z]+)'/g)].map(y => y[1])]));
  }
  return null;
}

// Who calls a top-level function: the function, action or "top level" around each use of its name, in any part.
export function callers(tree, name) {
  const out = [];
  for (const p of tree.parts) {
    if (p.bad != null) continue;
    for (const m of idents(p.code)) {
      if (m[0] !== name) continue;
      const w = around(p, m.index);
      if (w.who !== name && !p.top.some(t => t.name === name && t.at <= m.index && m.index < t.at + name.length + 40)) out.push({ who: w.who, part: p.file });
    }
  }
  return out;
}

const cell = s => String(s).replace(/\|/g, '\\|');
const list = xs => xs.map(x => `\`${x}\``).join(', ');
const by = (xs, part) => [...new Set(xs.map(x => (x.part === part ? `\`${x.who}\`` : `\`${x.who}\` (${x.part.slice(0, -4)})`)))].join(', ');

// docs/registry.md, made from the parts and their headers.
export function registry(root = ROOT, tree = readParts(root)) {
  const parts = tree.parts.filter(p => p.bad == null);
  const actions = parts.flatMap(p => p.actions);
  const kinds = table(tree, 'ACTION_KIND'), pageOnly = table(tree, 'PAGE_ONLY'), notStep = table(tree, 'NOT_A_STEP'), inside = table(tree, 'INSIDE_READS');
  const files = [...new Map([...tree.state.values()].map(s => [s.file, s])).values()].sort((a, b) => a.file.localeCompare(b.file));
  const kept = new Set(parts.flatMap(p => [...p.code.matchAll(/(?<![\w$.])readKept\s*\(/g)].flatMap(m => {
    const a = args(p.code, p.close, m.index + m[0].length - 1)[0];
    return a ? [...resolve(tree, p, m.index, a).files] : [];
  })));
  const timers = parts.flatMap(p => {
    const names = timerNames(p.header?.fields?.Timers);
    return items(none(p.header?.fields?.Timers) ? '' : p.header?.fields?.Timers || '').map((it, i) => ({ part: p.file, name: names[i], text: it.slice(names[i].length).trim().replace(/^\((.*)\)$/, '$1') }));
  });
  const ops = [...new Set(tree.ops.map(o => o.type))].sort();
  const evs = eventTypes(tree) || [];
  const out = [
    '# Registry',
    '',
    'Written by `node tools/make.mjs` from the parts and their headers (`tools/parts.mjs`); don’t edit it by hand. What',
    'a header declares (the owner of a state file, its writers, the timers) is checked against the code on every run.',
    '',
    '## Actions',
    '',
    'Kind: a lookup runs at once; a change goes through the checks in `runAction`. Answers to: the words of the owner’s',
    'request it may follow (`ACTION_KIND`). Page only: never run from a channel (`PAGE_ONLY`). Step: may be a step of a',
    'saved workflow (not in `NOT_A_STEP`). Text: a lookup whose result is the console’s own (`INSIDE_READS`), or text',
    'from outside. Group: the tool group Sparkie is offered it in (R46; the core is in every round).',
    '',
    '| Action | Kind | Part | Group | Answers to | Page only | Step | Text |',
    '|---|---|---|---|---|---|---|---|',
    ...actions.map(a => `| \`${a.name}\` | ${a.kind} | \`${a.file.slice(0, -4)}\` | ${a.group || '—'} | ${(kinds?.get?.(a.name) || []).join(', ') || '—'} | ${pageOnly?.has(a.name) ? 'yes' : '—'} | ${notStep?.has(a.name) ? 'no' : 'yes'} | ${a.kind === 'read' ? (inside?.has(a.name) ? 'inside' : 'outside') : '—'} |`),
    '',
    '## State files and their writers',
    '',
    'Each file is owned by the part that names it; its writers are found in the code and must be the ones its owner’s',
    'header declares. Copied daily: in the state folder, so in the daily copy and every install snapshot. Read kept: read',
    'with `readKept`, which sets an unreadable file aside and keeps one earlier copy (R20).',
    '',
    '| File | Owner | Writers | Copied daily | Read kept |',
    '|---|---|---|---|---|',
    ...files.map(s => {
      const w = tree.writes.filter(x => x.file === s.file);
      const o = owned(parts.find(p => p.file === s.part)?.header?.fields?.Owns || '').find(x => x.file === s.file);
      // (a writer that is a function of its own, called from a few named places: those, as R22 used to list them)
      const through = [...new Set(w.map(x => x.who))].filter(x => tree.topOf.has(x)).map(x => {
        const c = [...new Set(callers(tree, x).map(y => y.who))].filter(y => y !== 'top level');
        return c.length && c.length <= 4 ? `\`${x}\` is called by ${list(c)}` : '';
      }).filter(Boolean);
      const writers = [by(w, s.part) || 'none', o?.note, ...through].filter(Boolean).join('; ');
      return `| \`${s.file}\` | \`${s.part.slice(0, -4)}\` | ${cell(writers)} | ${s.inState ? 'yes' : 'no'} | ${kept.has(s.file) ? 'yes' : 'no'} |`;
    }),
    '',
    '## Timers, and what may wake',
    '',
    'Every repeating timer, as its part declares it (one that runs once after start may be listed too). A timer is',
    'named by the function it calls. What each part may wake is its own line: a Spark is woken only where it says so.',
    '',
    '| Timer | Part | When |',
    '|---|---|---|',
    ...timers.map(t => `| \`${t.name}\` | \`${t.part.slice(0, -4)}\` | ${cell(t.text) || '—'} |`),
    '',
    ...(() => {
      const wakes = parts.filter(p => p.header?.fields.Wakes && !none(p.header.fields.Wakes));
      return wakes.length ? ['| Part | May wake |', '|---|---|', ...wakes.map(p => `| \`${p.file.slice(0, -4)}\` | ${cell(p.header.fields.Wakes)} |`)] : ['No part may wake a Spark: every header says `Wakes: none`.'];
    })(),
    '',
    '## Events and operation types',
    '',
    'An event is a line in the fleet’s record (`fleetEvent`); its type must be in `EVENT_TYPES`. An operation is a job',
    '(`newJob`); its type must be named in R13, which says whether it takes a claim.',
    '',
    '| Event | Sent by |',
    '|---|---|',
    ...evs.map(t => `| \`${t}\` | ${[...new Set(tree.events.filter(e => e.type === t).map(e => `\`${e.who}\` (${e.part.slice(0, -4)})`))].join(', ') || '—'} |`),
    '',
    '| Operation | Started by |',
    '|---|---|',
    ...ops.map(t => `| \`${t}\` | ${[...new Set(tree.ops.filter(o => o.type === t).map(o => `\`${o.who}\` (${o.part.slice(0, -4)})`))].join(', ')} |`),
  ];
  return `${out.join('\n').trimEnd()}\n`;
}
