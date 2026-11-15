/* ───────── the sorter's programs: what each one it knows does (design A 2.8) ───────── */
// Area: safety        Rules: R55        Tests: sort.test.mjs
// Owns: none
// Timers: none        Wakes: none
// One function a program the sorter (20-sort.mjs) reads past its name: shells and interpreters, editors, the shell's
// built-ins that set a name, archives, the system's own tools, sudo and su (the package managers, git, the builds and
// systemd are in 20-tools.mjs; the network's tools and other machines in 20-remote.mjs). A program in no table is
// unknown, and so risky; an option a handler doesn't know is a doubt, and so risky (each reads its options by its spec
// in 20-options.mjs, or as written here). A program that unpacks or downloads under names it picks reaches everything
// under the folder it writes to (wide).
function sortShell(args, ctx, r, x, name) {
  r.simple = false;
  if (!/^(?:bash|sh|dash|ash)$/.test(name)) unsure(`${sortQ(name)} reads its text another way than bash, and the sorter reads only bash's.`);
  const dash = name !== 'bash';
  let k = 0, code = null, input = false;
  for (; k < args.length && !args[k].unknown; k++) {
    const t = args[k].text;
    if (t === '--' || t === '-') { input ||= t === '-'; k++; break; }
    if (/^--(?:norc|noprofile|posix|login|noediting|restricted|verbose)$/.test(t)) continue;
    if (/^[-+]O$/.test(t)) unsure(`${sortQ(name)} ${sortQ(t)} sets a shell option (dotglob, nocaseglob) that changes what its globs match.`);
    if (/^[-+]o$/.test(t)) { k++; continue; }
    if (!/^[-+]/.test(t)) break;
    if (/^--|[^euxvnfabhkmtBCHPETlrcs]/.test(t.slice(1))) unsure(`The sorter doesn't know ${sortQ(name)}’s option ${sortQ(t)}.`);
    if (t[0] === '-' && t.includes('c')) { code = args[k + 1] ?? unsure(`${sortQ(name)} -c with nothing after it.`); break; }
    if (t.includes('s')) input = true;
  }
  const inline = text => { if (dash && text.includes('&>')) unsure(`${sortQ(name)} reads &> another way than bash.`); return sortInline(text, ctx, r, `${name} -c`); };
  if (code) { if (code.unknown) unsure(`The command handed to ${sortQ(name)} -c comes from a $ or a command, so the sorter can't read it.`); return inline(code.text); }
  const file = input ? null : args[k];
  if (/^\/dev\/(?:stdin|fd\/)|^\/proc\/self\/fd\//.test(file?.text ?? '')) unsure(`${sortQ(name)} reads its code from its input, which can’t be shown.`);
  if (file) {
    if (file.fetches) ctx.fetched = true; else if (file.unknown) unsure(`${sortQ(name)} runs a file named by a $ or a command.`);
    return sortRuns(file.text || '<( … )', ctx, r, `${sortQ(name)} runs the file ${sortQ(file.text || 'a command makes')}.`);
  }
  if (x.opaque) unsure(`${sortQ(name)} reads text with a $ or a \` from <<< or a here-document, which the sorter can’t read as written.`);
  if (typeof x.stdin === 'string') return inline(x.stdin);
  if (x.inPipe) raise(r, 'risky', ctx.piped ? `It pipes what it fetched from the network into ${sortQ(name)}: code fetched and run is always asked.` : `It pipes into ${sortQ(name)} commands an earlier part makes, which can’t be shown before they run.`);
  sortRuns(null, ctx, r, `${sortQ(name)} runs the commands it reads from its input, which the sorter can’t see.`);
}
// An interpreter's options before its script (code:<name> in 20-options.mjs; one with no spec takes none): the letters
// that hand it code (-c, -e), a file of code (php -f), and those after which its own options end. perl and ruby -i
// take the rest of their letters as a backup's suffix (-pi.bak, even -pie), and change the files named after the code.
const SORT_CODE = { python: ['c', '', ['c', 'm']], perl: ['eE', '', []], node: ['ep', '', ['e', 'p', 'eval', 'print']], ruby: ['e', '', []], php: ['rBRE', 'fF', ['r', 'f']], lua: ['e', '', []] };
const sortSuffix = (w, takes) => { const t = w.text; for (let j = 1; j < t.length && !w.unknown && /^-[^-]/.test(t); j++) { if (t[j] === 'i') return { ...w, text: t.slice(0, j + 1), suffix: t.slice(j + 1) }; if (takes.includes(t[j])) break; } return w; };
function sortInterp(args, ctx, r, x, name) {
  r.simple = false;
  if (args.length && args.every(a => /^(?:-V|-VV|--version|--help|-h)$/.test(a.text))) return;
  const key = { python2: 'python', python3: 'python', nodejs: 'node', luajit: 'lua' }[name] ?? name, [code, files, ends] = SORT_CODE[key] ?? ['', '', []];
  const cut = key === 'perl' ? args.map(w => sortSuffix(w, 'eEIMmx0F')) : key === 'ruby' ? args.map(w => sortSuffix(w, 'eEIrF0')) : args, bk = cut.find(w => w.suffix)?.suffix;
  const o = sortOpts(SORT_OPTS[`code:${key}`], cut, null, ends);
  const fin = () => { if (o.unknown) unsure(`The sorter doesn’t know ${sortQ(name)}’s option ${sortQ(o.unknown)}.`); };
  const codes = o.opts.filter(([n]) => n.length === 1 ? code.includes(n) : /^(?:eval|print)$/.test(n)).map(([, v]) => v);
  for (const c of codes) { if (!c.unknown) sortScan(c.text, ctx, r, true, 'seen'); else if (c.fetches) ctx.fetched = true; else unsure(`The code handed to ${sortQ(name)} comes from a $ or a command, so the sorter can't read it.`); }
  if (codes.length) { sortRuns(null, ctx, r, `It runs a ${sortQ(name)} one-liner, which the sorter does not read.`); if (o.has('i')) for (const w of o.plain) { sortTouch(w, ctx, r); if (bk) sortTouch({ ...w, text: bk.includes('*') ? (bk.includes('/') ? '' : w.text.replace(/[^/]*$/, '')) + bk.replace(/\*/g, w.text.split('/').pop()) : w.text + bk }, ctx, r); } return fin(); }
  for (const f of o.all(...files)) sortRuns(f.text, ctx, r, `It runs the ${sortQ(name)} file ${sortQ(f.text)}.`);
  const mod = o.all('m')[0], file = o.plain[0];
  if (mod) { if (/^pip3?$/.test(mod.text) && !mod.unknown) sortProgram([mod, ...o.plain], ctx, r, x); else sortRuns(null, ctx, r, `It runs the ${sortQ(name)} module ${sortQ(mod.text)}.`); return fin(); }
  if (/^(?:deno|bun)$/.test(key)) { if (/^(?:x|dlx)$/.test(file?.text) || o.plain.some(w => /^(?:npm|jsr):/.test(w.text))) raise(r, 'risky', `${sortQ(name)} downloads a package and runs it: always asked.`); sortRuns(null, ctx, r, `${sortQ(name)} runs code.`); return fin(); }
  if (file?.unknown) { if (file.fetches) ctx.fetched = true; else unsure(`${sortQ(name)}’s words hold a $ or a command, so the sorter can't know what it runs.`); sortRuns(null, ctx, r, `${sortQ(name)} runs code a command makes.`); return fin(); }
  if (file && file.text !== '-') { sortRuns(file.text, ctx, r, `It runs the ${sortQ(name)} file ${sortQ(file.text)}.`); return fin(); }
  if (x.opaque) unsure(`${sortQ(name)} reads code with a $ or a \` from <<< or a here-document, which the sorter can’t read as written.`);
  if (typeof x.stdin === 'string') sortScan(x.stdin, ctx, r, true, 'seen');
  if (x.inPipe) raise(r, 'risky', ctx.piped ? `It pipes what it fetched from the network into ${sortQ(name)}: code fetched and run is always asked.` : `It pipes into ${sortQ(name)} code an earlier part makes, which can’t be shown before it runs.`);
  sortRuns(null, ctx, r, `${sortQ(name)} runs the code it reads from its input, which the sorter does not read.`);
  fin();
}
const sortDoubts = name => () => unsure(`It uses the shell’s ${sortQ(name)}, which can change what later words run.`);
// Built-ins that set a name (declare, read, printf -v, getopts, unset): each name is an assignment; a name with [ (an
// index bash works out as arithmetic, running what is in it) or a value worked out as arithmetic (-i) is a doubt.
function sortSets(names, ctx, r, how) {
  for (const n of names) {
    if (!n || n.unknown || /\[/.test(n.text)) unsure(`${sortQ(how)} sets a name the sorter can't read (an index worked out as arithmetic, or a $).`);
    const m = /^[A-Za-z_]\w*/.exec(n.text)?.[0];
    if (m) sortAssign(m, ctx, r, false);
  }
}
const sortDeclare = (a, ctx, r, x, name) => {
  if (a.some(w => /^[-+]\w*[fnFi]/.test(w.text))) unsure(`${sortQ(name)} with -f, -n or -i makes a function, a name that points at another, or a value worked out as arithmetic.`);
  const odd = a.find(w => w.unknown ? /^[-+]/.test(w.lit ?? '') || !w.lit : /^[-+]/.test(w.text) && /[^aAgprxlut]/.test(w.text.slice(1)));
  if (odd) unsure(`The sorter doesn’t know ${sortQ(name)}’s option ${sortQ(odd.text || '$…')}.`);
  sortSets(a.filter(w => !/^[-+]/.test(w.text)), ctx, r, name);
};
// The zippers and un-zippers write the name they read with its suffix put on or taken off (-S says which, .tgz gives
// .tar); -N takes the name stored in the file, so the folder it is in is reached; -r works on every file under a folder.
const ZIP_SUFFIX = { gzip: '.gz -gz .z -z _z .Z .tgz .taz', bzip2: '.bz2 .bz .tbz2 .tbz', xz: '.xz .lzma .txz .tlz', zstd: '.zst .tzst', lz4: '.lz4' };
const sortZip = (a, ctx, r, x, name) => {
  const o = sortOpts(SORT_OPTS[name], a), out = o.all('o', 'output'), kin = { gunzip: 'gzip', bunzip2: 'bzip2', unxz: 'xz', unzstd: 'zstd' }[name] ?? name;
  if (!out.length && !o.has('rm') && (o.has('t', 'test', 'list', 'c', 'stdout', 'to-stdout') || (kin !== 'lz4' && o.has('l')))) return;
  raise(r, 'change', `${sortQ(name)} writes a file.`);
  r.deletes = true;
  if (out.length) { for (const w of [...out, ...(o.has('rm') ? o.plain : [])]) sortTouch(w, ctx, r); return; }
  sortFile(name, 'over', a, ctx, r);
  const down = kin !== name || o.has('d', 'decompress', 'uncompress'), suf = o.all('S', 'suffix').at(-1)?.text;
  for (const w of o.plain) {
    if (o.has('r', 'recursive') || (down && o.has('N', 'name'))) { sortTouch(o.has('r', 'recursive') ? w : { ...w, text: w.text.includes('/') ? w.text.replace(/\/[^/]*$/, '') || '/' : '.' }, ctx, r, true); continue; }
    const hit = (suf ? [suf] : ZIP_SUFFIX[kin]?.split(' ') ?? []).find(e => w.text.endsWith(e) && w.text.length > e.length);
    if (!down) sortTouch({ ...w, text: w.text + (suf ?? ZIP_SUFFIX[kin]?.split(' ')[0] ?? '') }, ctx, r);
    else if (hit) sortTouch({ ...w, text: w.text.slice(0, -hit.length) + (/^\.t/.test(hit) ? '.tar' : '') }, ctx, r);
  }
};
const sortBecome = (a, ctx, r, x, name) => {
  r.answer = 'set root';
  raise(r, 'risky', `${sortQ(name)} becomes another user: a command becomes root only by setting root, so it is answered “set root”.`);
  const c = a.findIndex(w => /^-c$|^--command$/.test(w.text));
  if (c < 0 || !a[c + 1] || a[c + 1].unknown) return;
  const was = ctx.root;
  ctx.root = true;
  try { sortInline(a[c + 1].text, ctx, r, `${name} -c`); } finally { ctx.root = was; }
};
// Where a program that writes under names it picks puts them: the folder given, or the folders it may start in.
const sortInto = (dir, ctx, r) => (dir ? sortTouch(dir, ctx, r, true) : [...ctx.cwds].forEach(d => sortTouch({ text: d ?? '', unknown: d == null, subs: [] }, ctx, r, true)));
// tar's options (its old form, tar xzf a.tar, read as -x -z -f a.tar): T, X and g read names from a file, I and F and
// the long ones that name a program run it.
const TAR_SPEC = sortSpec('AcdrtuxvzjJaZkmopsSwWOhPlBiMGnRUb:f:C:H:K:L:N:V:T:X:g:F:I: --list --extract --get --create --append --update --diff --compare --delete --concatenate --catenate --file= --directory= --gzip --gunzip --xz --bzip2 --zstd --lzma --auto-compress --verbose --to-stdout --keep-old-files --skip-old-files --keep-newer-files --overwrite --overwrite-dir --no-overwrite-dir --no-same-owner --same-owner --no-same-permissions --preserve-permissions --same-permissions --numeric-owner --strip-components= --exclude= --exclude-vcs --exclude-caches --wildcards --no-wildcards --totals --one-file-system --owner= --group= --mode= --mtime= --sort= --warning= --newer= --after-date= --format= --blocking-factor= --label= --absolute-names --dereference --hard-dereference --ignore-zeros --recursion --no-recursion --remove-files --force-local --sparse --checkpoint --null --files-from= --exclude-from= --listed-incremental= --use-compress-program= --to-command= --checkpoint-action= --info-script= --new-volume-script= --rsh-command= --rmt-command= --index-file= --volno-file= --help --version');
const READ_SPEC = sortSpec('ersa:d:i:n:N:p:t:u:');
const FIND_ONE = new Set('name iname path ipath wholename iwholename regex iregex regextype type xtype size mtime mmin atime amin ctime cmin newer anewer cnewer perm user group uid gid links inum samefile maxdepth mindepth lname ilname fstype used context printf'.split(' '));
const FIND_ZERO = new Set('print print0 ls prune quit true false not and or a o depth mount xdev follow noleaf daystart readable writable executable empty nouser nogroup help version warn nowarn ignore_readdir_race noignore_readdir_race'.split(' '));
const SORT_HANDLERS = {
  ...Object.fromEntries('bash sh dash ash zsh ksh mksh fish'.split(' ').map(n => [n, sortShell])),
  ...Object.fromEntries('python python2 python3 perl ruby node nodejs php lua luajit Rscript julia deno bun tclsh wish pwsh'.split(' ').map(n => [n, sortInterp])),
  ...Object.fromEntries('vi vim nvim view ex ed nano emacs joe micro'.split(' ').map(n => [n, (a, ctx, r) => {
    sortRuns(null, ctx, r, `${sortQ(n)} is an editor, which can run anything it is told.`);
    for (const w of a.filter(w => !w.unknown && !/^[-+]/.test(w.text))) sortTouch(w, ctx, r);
    const odd = a.find(w => w.unknown || /^[-+]/.test(w.text));
    if (odd) unsure(`${sortQ(n)} ${sortQ(odd.text || '$…')}: an editor’s option or + command can run anything, and the sorter reads none.`);
  }])),
  ...Object.fromEntries('alias unalias hash enable trap shopt complete compgen bind fc history disown suspend caller let'.split(' ').map(n => [n, sortDoubts(n)])),
  ...Object.fromEntries('export declare typeset local readonly'.split(' ').map(n => [n, sortDeclare])),
  ...Object.fromEntries('gzip gunzip bzip2 bunzip2 xz unxz zstd unzstd lz4'.split(' ').map(n => [n, sortZip])),
  ...Object.fromEntries('su doas pkexec runuser sudoedit sg newgrp'.split(' ').map(n => [n, sortBecome])),
  read(a, ctx, r) { const o = sortOpts(READ_SPEC, a); sortSets([...o.all('a'), ...o.plain], ctx, r, 'read'); if (o.unknown) unsure(`The sorter doesn’t know read’s option ${sortQ(o.unknown)}.`); },
  wait(a, ctx, r) { sortSets(sortOpts(SORT_OPTS.wait, a).all('p'), ctx, r, 'wait -p'); },
  printf(a, ctx, r) { if (a[0]?.text === '-v') sortSets([a[1]], ctx, r, 'printf -v'); else if (/^-v./.test(a[0]?.text ?? '')) unsure('printf -v sets a name the sorter can’t read.'); },
  getopts(a, ctx, r) { sortSets([a.filter(w => !w.text.startsWith('-'))[1]], ctx, r, 'getopts'); },
  unset(a, ctx, r) { sortSets(a.filter(w => !w.text.startsWith('-')), ctx, r, 'unset'); },
  test(a) { if (a.some(w => w.text === '-v') && a.some(w => /\[/.test(w.text) && !/^[[\]]$/.test(w.text))) unsure('test -v works out an index as arithmetic, running what is in it.'); },
  awk(a, ctx, r, x, name = 'awk') {
    const o = sortOpts(SORT_OPTS.awk, a, null, []), files = o.all('f', 'file', 'E'), libs = o.all('i', 'include', 'l', 'load'), inline = o.all('e', 'source');
    for (const f of [...files, ...libs]) sortRuns(f.text, ctx, r, `${sortQ(name)} runs the program in ${sortQ(f.text)}, or loads code, which the sorter does not read.`);
    const progs = files.length || inline.length ? inline : [o.plain[0]];
    // (gawk -i inplace rewrites each file it reads)
    if (libs.some(l => /(?:^|\/)inplace(?:\.awk)?$/.test(l.text))) { raise(r, 'change', `${sortQ(name)} -i inplace rewrites the files it reads.`); r.deletes = true; for (const w of a.slice(o.end + (files.length || inline.length ? 0 : 1))) if (!/^[A-Za-z_]\w*=/.test(w.text)) sortTouch(w, ctx, r); }
    for (const p of progs) {
      if (!p || p.unknown) unsure(`${sortQ(name)}’s program comes from a $ or a command, so the sorter can't read it.`);
      if (/\bsystem\b|getline|[|>]|@(?:load|include)/.test(p.text)) { sortScan(p.text, ctx, r, true, 'seen'); sortRuns(null, ctx, r, `The ${sortQ(name)} program writes, pipes or starts something.`); }
    }
    return files.length || inline.length ? o.end : o.end + 1;
  },
  sed(a, ctx, r) {
    const scripts = [], files = [];
    let inPlace = false, suffix = '';
    const LONG = ['expression=', 'file=', 'in-place', 'quiet', 'silent', 'regexp-extended', 'separate', 'unbuffered', 'null-data', 'zero-terminated', 'line-length=', 'posix', 'debug', 'sandbox', 'follow-symlinks', 'help', 'version'];
    for (let k = 0; k < a.length; k++) {
      const t = a[k].text;
      if (t.startsWith('--') && t.length > 2) {
        const [n, v] = [t.slice(2).split('=')[0], t.includes('=') ? t.slice(t.indexOf('=') + 1) : null], hits = LONG.filter(l => l.replace(/=$/, '').startsWith(n));
        if (hits.length !== 1) unsure(`The sorter doesn't know sed’s option ${sortQ(t)}.`);
        if (hits[0] === 'expression=') scripts.push(v != null ? { text: v } : a[++k]);
        else if (hits[0] === 'file=') { const f = v ?? a[++k]?.text ?? null; scripts.push({ text: '', file: f }); sortRuns(f, ctx, r, 'sed runs a script file, which the sorter does not read.'); }
        else if (hits[0] === 'in-place') { inPlace = true; suffix = v ?? ''; }
        else if (hits[0] === 'line-length=' && v == null) k++;
        continue;
      }
      if (/^-./.test(t)) {
        for (let j = 1; j < t.length; j++) {
          const c = t[j];
          if (c === 'i') { inPlace = true; suffix = t.slice(j + 1); break; }
          if (c === 'e') { scripts.push(j < t.length - 1 ? { text: t.slice(j + 1) } : a[++k]); break; }
          if (c === 'f') { const f = j < t.length - 1 ? t.slice(j + 1) : a[++k]?.text ?? null; scripts.push({ text: '', file: f }); sortRuns(f, ctx, r, 'sed runs a script file, which the sorter does not read.'); break; }
          if (c === 'l') { if (j === t.length - 1) k++; break; }
          if (!'nErsuz'.includes(c)) unsure(`The sorter doesn't know sed’s option ${sortQ(`-${c}`)}.`);
        }
        continue;
      }
      (scripts.length ? files : scripts).push(a[k]);
    }
    if (scripts.some(s => !s || s.unknown)) unsure('A sed script comes from a $ or a command, so the sorter can’t read it.');
    if (inPlace) {
      raise(r, 'change', 'sed -i rewrites the files it names.');
      // (and with a suffix keeps the old one beside it, or where a / in the suffix says)
      for (const f of files) { sortTouch(f, ctx, r); if (suffix) sortTouch({ ...f, text: suffix.includes('*') ? (suffix.includes('/') ? '' : f.text.replace(/[^/]*$/, '')) + suffix.replace(/\*/g, f.text.split('/').pop()) : f.text + suffix }, ctx, r); }
    }
    if (!scripts.every(s => sortSedSafe(s.text))) { sortScan(scripts.map(s => s.text).join('\n'), ctx, r, true, 'seen'); sortRuns(null, ctx, r, 'The sed script writes a file or runs a command (w, W or e).'); }
  },
  find(a, ctx, r) {
    let k = 0;
    while (k < a.length && /^-(?:[HLP]|D|O\d)$/.test(a[k].text)) k += a[k].text === '-D' ? 2 : 1;
    const starts = [];
    for (; k < a.length && !/^[-(!)]/.test(a[k].text); k++) starts.push(a[k]);
    if (a.some(w => w.unknown || w.glob || w.brace)) unsure('A $, * or {…} among find’s words could become -delete or -exec, so the sorter can’t know what it does.');
    let odd = null, value = -1;
    for (; k < a.length; k++) {
      const t = a[k].text;
      if (t === '-delete') { r.deletes = true; for (const s of starts) sortTouch(s, ctx, r, true, false); sortGone(ctx, r, 'find -delete removes files it doesn’t name.'); }
      else if (/^-(?:exec|execdir|ok|okdir)$/.test(t)) {
        const e = a.findIndex((w, j) => j > k + 1 && /^[;+]$/.test(w.text));
        if (e < 0) unsure(`find ${sortQ(t)} with no command, or no ; or + after it.`);
        raise(r, 'change', `find ${sortQ(t)} runs ${sortQ(a[k + 1].text)} on each file it finds.`);
        r.simple = false;
        // (every file under where it starts, unless what it runs only reads)
        if (SORT_READS[a[k + 1].text.split('/').pop()] !== '') for (const s of starts) sortTouch(s, ctx, r, true, false);
        sortProgram(a.slice(k + 1, e), ctx, r, { unknownArgs: true });
        k = e;
      } else if (/^-f(?:print0?|printf|ls)$/.test(t)) { raise(r, 'change', `find ${sortQ(t)} writes ${sortQ(a[k + 1]?.text)}.`); sortTouch(a[k + 1], ctx, r); value = k + (t === '-fprintf' ? 2 : 1); }
      // (a primary's value is read as a value, but a value spelled -delete or -exec still counts: the careful reading)
      else if (FIND_ONE.has(t.slice(1)) || /^-newer[aBcmt][aBcmt]t?$/.test(t)) value = k + 1;
      else if (/^-./.test(t) && !FIND_ZERO.has(t.slice(1)) && k > value) odd ??= t;
    }
    if (odd) unsure(`The sorter doesn’t know find’s ${sortQ(odd)}.`);
  },
  eval(a, ctx, r) { if (a.some(w => w.unknown)) unsure('eval runs text from a $ or a command, which the sorter can’t read.'); if (a.length) sortInline(a.map(w => w.text).join(' '), ctx, r, 'eval'); },
  source(a, ctx, r) {
    const f = a[0] ?? unsure('source with no file.');
    if (/^\/dev\/(?:stdin|fd\/)|^\/proc\/self\/fd\//.test(f.text)) unsure('It reads shell code from its input, which can’t be shown.');
    if (f.fetches) ctx.fetched = true; else if (f.unknown) unsure('It runs a shell file named by a $ or a command.');
    sortRuns(f.text || '<( … )', ctx, r, `It runs the shell file ${sortQ(f.text || 'a command makes')} in this shell.`);
  },
  set(a) { if (!a.every(w => /^[-+][a-zA-Z]+$|^(?:pipefail|errexit|nounset|xtrace|noglob|noclobber|errtrace|functrace)$/.test(w.text))) unsure('set with these words changes the shell’s own arguments or options.'); },
  cd(a, ctx) { const t = a.find(w => !/^-[LPe@]+$|^--$/.test(w.text)); ctx.cdTo = !t ? ['~'] : t.unknown || t.glob || t.text.startsWith('-') ? [null] : sortPaths(t.text, ctx); for (const p of ctx.cdTo) sortCd(p, ctx); },
  pushd(a, ctx) { sortCd(null, ctx); ctx.cdTo = [null]; },
  // (crontab -l only lists; anything else is a job that runs by itself)
  crontab: (a, ctx, r) => (/^(?:-u \S+ )?-l(?: -u \S+)?$/.test(a.map(w => w.text).join(' ')) ? raise(r, 'change', 'crontab -l lists the jobs, which a look’s wall hides.') : raise(r, 'risky', 'crontab: a job that runs by itself, outside the wall.')),
  hostname(a, ctx, r) { if (!SORT_LOCK_READS.hostname(a.map(w => w.text))) raise(r, 'lockout', 'hostname with a name renames the Spark, which its ways in go by.'); },
  journalctl: (a, ctx, r) => (a.some(w => /^--vac/.test(w.text)) ? sortGone(ctx, r, 'journalctl --vacuum removes old logs.') : sortReads('journalctl', SORT_READS.journalctl, a, ctx, r)),
  'nvidia-smi': (a, ctx, r) => { for (const f of sortOpts(SORT_OPTS['nvidia-smi'], a).all('-f', '--filename')) sortTouch(f, ctx, r); return (!/^(?:dmon|pmon|topo|nvlink)$/.test(a[0]?.text ?? '') && a.some(w => /^-(?:pm|pl|r|c|e|ac|rac|lgc|rgc|lmc|rmc|mig|cgi|dgi|cci|dci|acp|am|caa)$|^--(?:persistence|power-limit|gpu-reset|compute-mode|ecc|applications-clocks|reset-|lock-|multi-instance|auto-boost)|^--?\w*(?:set|lock|reset|enable|disable|apply)/.test(w.text))
    ? raise(r, 'risky', 'nvidia-smi changes a GPU setting (the driver’s).') : raise(r, 'change', 'nvidia-smi here needs the GPU, which a look’s wall hides (nvidia-smi as the whole command is a look).')); },
  sysctl(a, ctx, r) {
    const t = a.map(w => w.text);
    if (t.some(s => /^-\w*[wpf]|^--(?:write|load|system)|=/.test(s))) raise(r, t.some(s => /^net\.|^-\w*[pf]|^--(?:load|system)/.test(s)) ? 'lockout' : 'risky', 'sysctl changes kernel settings, maybe the network’s.');
  },
  mount: (a, ctx, r) => (a.length ? sortGone(ctx, r, 'mount works on a disk.') : undefined),
  swapon: (a, ctx, r) => (a.length && !a.every(w => /^--?(?:s|show\S*|summary|bytes|noheadings|raw)$/.test(w.text)) ? sortGone(ctx, r, 'swapon works on a disk.') : undefined),
  dd(a, ctx, r) {
    raise(r, 'change', 'dd copies raw bytes.');
    for (const w of a) {
      const m = /^(if|of)=(.*)$/.exec(w.text);
      if (!m || m[1] === 'if') continue;
      if (w.unknown) unsure('dd names a file through a $ or a command.');
      r.deletes = true;
      if (/^\/dev\/(?!null$|zero$|std(?:out|err)$)/.test(sortNorm(m[2]))) sortGone(ctx, r, `dd writes ${sortQ(m[2])}, a disk or a device, directly.`);
      sortTouch({ ...w, text: m[2] }, ctx, r);
    }
    const odd = a.find(w => w.unknown || !/^(?:if|of|bs|ibs|obs|cbs|count|skip|seek|iseek|oseek|conv|iflag|oflag|status)=/.test(w.text));
    if (odd) unsure(`The sorter doesn’t know dd’s word ${sortQ(odd.text || '$…')}.`);
  },
  tar(a, ctx, r) {
    // What it unpacks over is checked first; a program it runs, or an option the sorter doesn't know, after, so the
    // more dangerous answer stands. -P (--absolute-names) lets its members go anywhere: it reaches / then.
    const old = a[0] && !a[0].unknown && /^[A-Za-z]+$/.test(a[0].text) ? a[0] : null, rest = a.slice(old ? 1 : 0), args = [];
    let q = 0;
    for (const c of old?.text ?? '') { args.push({ ...old, text: `-${c}` }); if (TAR_SPEC.short.get(c)) args.push(rest[q++] ?? { text: '', subs: [] }); }
    const o = sortOpts(TAR_SPEC, [...args, ...rest.slice(q)]);
    const runs = o.all('I', 'F', 'use-compress-program', 'to-command', 'checkpoint-action', 'info-script', 'new-volume-script', 'rsh-command', 'rmt-command')
      .filter((p, i, all) => !(o.all('I', 'use-compress-program').includes(p) && /^(?:gzip|pigz|unpigz|zstd|pzstd|unzstd|xz|pixz|bzip2|lbzip2|pbzip2|lz4|lzma|lzip|plzip|brotli)(?: -[\w-]+)*$/.test(p.text) && !/ --?files/.test(p.text)));
    if (o.all('f', 'file').some(w => /^[^/]*:/.test(w.text)) && !o.has('force-local')) raise(r, 'risky', 'tar is handed host:file, which it reaches on another machine through ssh: asked.');
    const lists = o.has('T', 'X', 'g', 'files-from', 'exclude-from', 'listed-incremental', 'index-file', 'volno-file');
    const list = o.has('t', 'd', 'list', 'diff', 'compare'), write = o.has('x', 'c', 'r', 'u', 'A', 'extract', 'get', 'create', 'append', 'update', 'delete', 'concatenate', 'catenate');
    const after = () => {
      for (const p of runs) sortRuns(p.text || null, ctx, r, `tar runs the program it is given: ${sortQ(p.text)}.`);
      if (lists) sortRuns(null, ctx, r, 'tar reads names from a file, or writes one it is given.');
      if (o.unknown) unsure(`The sorter doesn’t know tar’s option ${sortQ(o.unknown)}.`);
    };
    if (list && !write) return after();
    raise(r, 'change', 'tar writes files.');
    if (o.has('x', 'extract', 'get') || !write) { r.deletes = true; sortInto(o.has('P', 'absolute-names') ? { text: '/', subs: [] } : o.all('C', 'directory').at(-1) ?? null, ctx, r); }
    for (const w of o.plain) sortTouch(w, ctx, r, false, false);
    for (const w of o.all('f', 'file')) sortTouch(w, ctx, r, false, o.has('c', 'r', 'u', 'A', 'create', 'append', 'update', 'concatenate', 'catenate'));
    if (o.has('remove-files')) { r.deletes = true; sortGone(ctx, r, 'tar --remove-files removes what it packs.'); }
    after();
  },
  unzip(a, ctx, r) {
    if (a.some(w => /^-[lvtZzp]/.test(w.text))) return;
    raise(r, 'change', 'unzip writes the files it holds.');
    r.deletes = true;
    // (-: and -^ let its members leave the folder: it reaches / then)
    const o = sortOpts(SORT_OPTS.unzip, a);
    sortInto(a.some(w => /^-[^-]*[:^]/.test(w.text)) ? { text: '/', subs: [] } : o.all('d').at(-1) ?? null, ctx, r);
    for (const w of o.plain) sortTouch(w, ctx, r, false);
  },
  '7z'(a, ctx, r) {
    const v = a.find(w => !w.text.startsWith('-'))?.text;
    const odd = a.find(w => w.unknown || (w.text.startsWith('-') && !/^-(?:o.+|y|p.*|r-?|t\w+|m\S+|[xi][!@r]\S*|ao[asut]|bb\d?|bd|bs\S*|so|si\S*|w\S*|scs\S*|mmt\S*|v\d+\w?|sse|ssc-?|slt|-)$/.test(w.text)));
    if (!/^[lt]$/.test(v ?? '')) {
      raise(r, 'change', '7z writes files.');
      if (/^[xe]$/.test(v ?? '')) { const o = a.find(w => /^-o./.test(w.text)); sortInto(o ? { ...o, text: o.text.slice(2), subs: [] } : null, ctx, r); }
      for (const w of a) sortTouch(w, ctx, r);
    }
    if (odd) unsure(`The sorter doesn’t know 7z’s switch ${sortQ(odd.text || '$…')}.`);
  },
  patch(a, ctx, r) {
    raise(r, 'change', 'patch changes the files its diff names.');
    const o = sortOpts(SORT_OPTS.patch, a), out = o.all('o', 'output');
    if (out.length) for (const w of out) sortTouch(w, ctx, r); else sortInto(o.all('d', 'directory').at(-1) ?? null, ctx, r);
    for (const w of [...o.plain, ...o.all('i', 'input')]) sortTouch(w, ctx, r, false, false);
  },
  'ssh-keygen'(a, ctx, r) {
    // (-f names the key it writes, and its .pub beside it)
    const t = a.map(w => w.text);
    if (t.some(s => /^-\w*A/.test(s))) return raise(r, 'lockout', 'ssh-keygen -A makes the Spark’s own SSH host keys.');
    if (t.some(s => /^-\w*[lLyFBQ]/.test(s)) && !t.some(s => /^-\w*R/.test(s))) return;
    raise(r, 'change', 'ssh-keygen writes a key or known_hosts.');
    const o = sortOpts(SORT_OPTS['ssh-keygen'], a), fs = o.all('f');
    if (!fs.length && !o.has('R', 'H')) fs.push({ text: `~/.ssh/id_${o.all('t').at(-1)?.text ?? 'ed25519'}`, subs: [] });
    for (const f of fs) { sortTouch(f, ctx, r); sortTouch({ ...f, text: `${f.text}.pub` }, ctx, r); }
  },
  userdel(a, ctx, r) { if (a.some(w => /^-\w*r|^--remove/.test(w.text))) { ctx.kinds.add('delete'); r.lasting = 'A deleted user’s home can’t be put back.'; } raise(r, 'lockout', 'userdel removes a user, a way in.'); },
  sudo(a, ctx, r, x) {
    r.answer = 'set root';
    r.simple = false;
    raise(r, 'change', 'It says sudo: a command becomes root only by setting root, so it is answered “set root”.');
    let k = 0;
    for (; k < a.length && a[k].text.startsWith('-'); k++) {
      const t = a[k].text;
      if (t === '--') { k++; break; }
      if (/^-[ughpCDrtTU]$/.test(t)) k++;
      else if (!/^-[AbEHKklnPSVv]+$/.test(t)) unsure(`sudo ${sortQ(t)} opens a shell, edits a file or does what the sorter doesn’t read.`);
    }
    if (k >= a.length) return;
    const was = ctx.root;
    ctx.root = true;
    try { sortProgram(a.slice(k), ctx, r, x); } finally { ctx.root = was; }
  },
};
for (const [n, to] of Object.entries({ popd: 'pushd', '.': 'source', '[': 'test', 'apt-get': 'apt', aptitude: 'apt', pip3: 'pip', mamba: 'conda', micromamba: 'conda',
  pnpm: 'npm', yarn: 'npm', podman: 'docker', nerdctl: 'docker', 'docker-compose': 'docker', wget: 'curl', aria2c: 'curl', sftp: 'scp', rsync: 'scp',
  'huggingface-cli': 'hf', gawk: 'awk', mawk: 'awk', nawk: 'awk', deluser: 'userdel' })) SORT_HANDLERS[n] = (a, ctx, r, x) => SORT_HANDLERS[to](a, ctx, r, x, n);
