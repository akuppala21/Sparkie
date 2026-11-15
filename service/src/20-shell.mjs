/* ───────── how bash reads a command: words, pipelines, here-documents (for the sorter) ───────── */
// Area: safety        Rules: R55        Tests: sort.test.mjs
// Owns: none
// Timers: none        Wakes: none
// The one tokenizer the sorter reads a command with (design A 2.8; 20-sort.mjs). It reads as bash does, and anything it
// can't read whole (a quote that never closes, a loop, arithmetic, a ${ … } form, a here-document that runs commands, an
// end word bash reads differently, a line that runs on with \) throws a SortDoubt, which the sorter answers as risky.
class SortDoubt extends Error {}
const unsure = why => { throw new SortDoubt(why); };
const sortWs = s => new Set(s.split(' ')), SHELL_NEST = 16;

// The shell's words as bash reads them: quotes off, $HOME and a leading ~ as ~, each $( … ), `…` and <( … ) parsed in
// its place (word.subs), operators and redirections apart, here-documents read whole. What it can't read is a doubt.
function shellLex(src, inner = false, start = 0, nest = 0) {
  if (nest > SHELL_NEST) unsure(`It nests $( … ) or backticks more than ${SHELL_NEST} deep.`);
  const toks = [], heres = [];
  let i = start, w = null, depth = 0, want = null;
  const word = () => (w ??= { text: '', lit: '', bare: '', plain: true, quoted: false, glob: false, unknown: false, subs: [] });
  const opaque = () => { const x = word(); x.plain = false; return x; };
  const end = () => {
    if (!w) return;
    w.brace = /\{[^{}]*(?:,|\.\.)[^{}]*\}/.test(w.bare);
    toks.push({ w });
    if (want) { heres.push({ ...want, quoted: w.quoted, delim: w.text }); want = null; }
    w = null;
  };
  const sub = j => { const r = shellLex(src, true, j, nest + 1), x = opaque(); x.subs.push(shellParse(r.toks)); x.unknown = true; return r.end; };
  const named = (name, j) => { const x = opaque(); if (name === 'HOME' && !x.text) x.text = '~'; else x.unknown = true; return j; };
  const dollar = j => {
    const n = src[j + 1];
    if (want) unsure('Its here-document’s end word holds a $, which bash reads as it is written and the sorter does not.');
    if (n === '[') unsure('It holds an arithmetic $[ … ], which the sorter does not read.');
    if (src.startsWith('$((', j)) unsure('It holds an arithmetic $(( … )), which the sorter does not read.');
    if (n === '(') return sub(j + 2);
    if (n === "'" || n === '"') unsure(`It holds a $${n} … ${n} quote, which the sorter does not read.`);
    if (n === '{') { const k = src.indexOf('}', j), v = src.slice(j + 2, k); if (k < 0 || !/^[A-Za-z_]\w*$/.test(v)) unsure('It holds a ${ … } form the sorter does not read.'); return named(v, k + 1); }
    const m = /[A-Za-z_]\w*/y; m.lastIndex = j + 1;
    if (m.exec(src)) return named(src.slice(j + 1, m.lastIndex), m.lastIndex);
    if (n && '0123456789@*#?$!-'.includes(n)) { opaque().unknown = true; return j + 2; }
    word().text += '$'; return j + 1;
  };
  const tick = (j, inQuotes = false) => {
    if (want) unsure('Its here-document’s end word holds a command, which bash reads as it is written and the sorter does not.');
    let k = j + 1, body = '';
    for (; k < src.length && src[k] !== '`'; k++) body += src[k] === '\\' && (inQuotes ? '`$\\"' : '`$\\').includes(src[k + 1] ?? 'x') ? src[++k] : src[k];
    if (k >= src.length) unsure('It holds a ` that never closes.');
    const x = opaque(); x.subs.push(shellParse(shellLex(body, false, 0, nest + 1).toks)); x.unknown = true;
    return k + 1;
  };
  const dquote = j => {
    const x = opaque(); x.quoted = true;
    for (;;) {
      const c = src[j];
      if (c === undefined) unsure('It holds a " that never closes.');
      if (c === '"') return j + 1;
      if (c === '\\' && '$`"\\\n'.includes(src[j + 1] ?? 'x')) { if (src[j + 1] !== '\n') x.text += src[j + 1]; j += 2; }
      else if (c === '$') j = dollar(j);
      else if (c === '`') j = tick(j, true);
      else { x.text += c; j++; }
    }
  };
  const bodies = j => {
    for (const h of heres.splice(0)) {
      const lines = [];
      for (;;) {
        if (j >= src.length) unsure('It holds a here-document with no end.');
        const e = src.indexOf('\n', j) < 0 ? src.length : src.indexOf('\n', j), line = src.slice(j, e);
        j = e + 1;
        if (!h.quoted && line.endsWith('\\')) unsure('Its here-document has a line that ends in \\, which bash joins to the next.');
        if ((h.strip ? line.replace(/^\t+/, '') : line) === h.delim) break;
        lines.push(line);
      }
      h.tok.body = lines.join('\n');
      if (!h.quoted && /\$\(|`|\$\{|<\(/.test(h.tok.body)) unsure('Its here-document runs commands of its own ($( … ) or `…`).');
    }
    return j;
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { if (src[i + 1] !== '\n') { const x = opaque(); x.text += src[i + 1] ?? ''; x.quoted = true; } i += 2; continue; }
    if (c === "'") { const k = src.indexOf("'", i + 1); if (k < 0) unsure("It holds a ' that never closes."); const x = opaque(); x.text += src.slice(i + 1, k); x.quoted = true; i = k + 1; continue; }
    if (c === '"') { i = dquote(i + 1); continue; }
    if (c === '$') { i = dollar(i); continue; }
    if (c === '`') { i = tick(i); continue; }
    if (c === '#' && !w) { const k = src.indexOf('\n', i); i = k < 0 ? src.length : k; continue; }
    if (c === ' ' || c === '\t') { end(); i++; continue; }
    if (c === '\n') { end(); if (want) unsure('It holds << with no word after it.'); toks.push({ op: '\n' }); i = bodies(i + 1); continue; }
    if ((c === '<' || c === '>') && src[i + 1] === '(') { i = sub(i + 2); continue; }
    const m = /^(?:&>>?|<<<|<<-?|<>|[<>]&|>>|>\||[<>])/.exec(src.slice(i, i + 3));
    if (m) {
      let fd = null;
      if (w && w.plain && /^\d+$/.test(w.text)) { fd = w.text; w = null; } else if (w && /^\{\w+\}$/.test(w.text)) unsure('It holds a {name}> redirection.');
      end();
      if (want) unsure('It holds << with no word after it.');
      const tok = { redir: m[0], fd };
      toks.push(tok);
      if (m[0] === '<<' || m[0] === '<<-') want = { strip: m[0] === '<<-', tok };
      i += m[0].length;
      continue;
    }
    const o = /^(?:;;&?|;&|\|\||&&|\|&|[|&;()])/.exec(src.slice(i, i + 3));
    if (o) {
      if (o[0] === ')' && inner && !depth) { end(); if (want || heres.length) unsure('It holds a here-document with no end.'); return { toks, end: i + 1 }; }
      depth += o[0] === '(' ? 1 : o[0] === ')' ? -1 : 0;
      end(); toks.push({ op: o[0] }); i += o[0].length;
      continue;
    }
    if (c === '~' && !w && src[i + 1] !== undefined && !/[/\s;&|()<>:]/.test(src[i + 1])) opaque().unknown = true;
    const x = word();
    if ('*?['.includes(c)) x.glob = true;
    x.text += c; x.bare += c; if (x.plain) x.lit += c;
    i++;
  }
  if (inner) unsure('It holds a $( … ) or <( … ) that never closes.');
  end();
  if (want || heres.length) unsure('It holds a here-document with no end.');
  return { toks, end: i };
}
const SHELL_WORDS = sortWs('if then else elif fi do done case esac while until for select function in [[ ]] coproc');
// Commands from the words: a list of pipelines, each a list of commands {assigns, words, redirs} or groups.
function shellParse(toks) {
  let k = 0, nest = 0;
  const t = () => toks[k], is = v => t()?.op === v, bare = v => t()?.w && !t().w.quoted && t().w.text === v;
  const what = x => (!x ? 'the end' : x.op === '\n' ? 'a new line' : `“${x.op ?? x.redir ?? x.w.text}”`);
  const closes = stop => (stop === ')' ? is(')') : stop === '}' && bare('}'));
  const nl = () => { while (is('\n')) k++; };
  function list(stop) {
    const items = [];
    if (++nest > SHELL_NEST) unsure(`It nests ( … ) or { … } more than ${SHELL_NEST} deep.`);
    nl();
    while (k < toks.length && !closes(stop)) {
      const pipe = [command()];
      while (is('|') || is('|&')) { k++; nl(); pipe.push(command()); }
      items.push(pipe);
      if (is(';') || is('&') || is('\n')) k++;
      else if (is('&&') || is('||')) { k++; nl(); if (k >= toks.length || closes(stop)) unsure('It ends with && or ||.'); }
      else if (k < toks.length && !closes(stop)) unsure(`It holds ${what(t())} where the sorter didn't expect one.`);
      nl();
    }
    if (stop && k >= toks.length) unsure(`It holds a ${stop === ')' ? '(' : '{'} that never closes.`);
    if (!items.length) unsure('It holds an empty command.');
    nest--;
    return items;
  }
  function command() {
    const cmd = { assigns: [], words: [], redirs: [] };
    while (bare('!')) k++;
    if (bare('time')) { k++; if (bare('-p')) k++; }
    if (is('(') && toks[k + 1]?.op === '(') unsure('It holds (( … )), arithmetic the sorter does not read.');
    if (is('(')) { k++; cmd.group = list(')'); k++; } else if (bare('{')) { k++; cmd.group = list('}'); k++; }
    else if (t()?.w && !t().w.quoted && SHELL_WORDS.has(t().w.text)) unsure(`It holds the shell word ${t().w.text}: a loop, a test or a function the sorter does not read.`);
    for (let x = t(); x && (x.w || x.redir); x = t()) {
      k++;
      if (x.redir) { const y = t(); if (!y?.w) unsure(`It holds ${x.redir} with no word after it.`); k++; cmd.redirs.push({ op: x.redir, fd: x.fd, w: y.w, body: x.body }); continue; }
      if (cmd.group) unsure('It holds a word after a ( … ) or { … } group.');
      if (!cmd.words.length && /^[A-Za-z_]\w*\+?=/.test(x.w.lit)) cmd.assigns.push(x.w); else cmd.words.push(x.w);
    }
    if (is('(')) unsure('It holds a ( right after a word (a function or an array).');
    if (!cmd.group && !cmd.words.length && !cmd.assigns.length && !cmd.redirs.length) unsure(`It holds ${what(t())} where a command should be.`);
    return cmd;
  }
  const items = list(null);
  if (k < toks.length) unsure(`It holds ${what(t())} where the sorter didn't expect one.`);
  return items;
}

// A sed script that only prints: no w, W or e command and no w or e flag on an s (GNU sed's own way to write or run).
function sortSedSafe(s) {
  let i = 0;
  const field = d => { for (i++; i < s.length && s[i] !== d; i++) if (s[i] === '\\') i++; return i < s.length; };
  while (i < s.length) {
    const c = s[i];
    if (/[\s;{}!,$~+0-9]/.test(c)) { i++; continue; }
    if (c === '/' || c === '\\') { if (c === '\\') i++; if (!s[i] || !field(s[i])) return false; i++; continue; }
    i++;
    if (c === 's' || c === 'y') {
      const d = s[i];
      if (!d || /[\s\\]/.test(d) || !field(d) || !field(d)) return false;
      i++;
      const flags = /^[^;\n}]*/.exec(s.slice(i))[0];
      if (c === 's' && /[we]/i.test(flags)) return false;
      i += flags.length;
    } else if ('aicrRbtT:'.includes(c)) { while (i < s.length && s[i] !== '\n' && !(s[i] === ';' && 'btT:'.includes(c))) i++; }
    else if (!'dDgGhHlnNpPqQxz=Fv'.includes(c)) return false;
  }
  return true;
}
