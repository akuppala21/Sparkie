/* ───────── the sorter: what one command on a Spark is (design A 2.8) ───────── */
// Area: safety        Rules: R55        Tests: sort.test.mjs
// Owns: none
// Timers: none        Wakes: none
// sortCommand(command, {at, root, dir, hosts, brain}) says what one command for run is before anything runs, from its
// text and where it runs alone: no model call, no file read, a bounded amount of work, and never a throw for anything
// JSON can carry (a getter or a toString that throws is caught too). Five classes, in
// their order of danger (when two could apply, the later wins): look (only reads: at once), change (design A 2.5's
// ladder), risky (always asked), lockout (asked, and inside the net), notdone (never, and not for want of a yes).
// The careful answer is the default: a command is a change only when the sorter can show it is one, a program it knows,
// called by a name or path it resolves to that program, with every word that decides what it does in view, touching
// only places it can place (20-places.mjs). Anything else is risky: an unknown program, option or sub-command (each
// program's list is in 20-options.mjs), a loop, a $ where an option, a program or a path goes, a sign that isn't plain
// ASCII, words a program reads from its input, code fetched or written by this same command, a command or a copy on
// another machine (no wall there). A look keeps run's own checks (21-work.mjs:
// lookForm's exact forms, no sudo or key word by lookWords and keyWord), and every program in it only reads, with no
// flag that writes, no redirection but to /dev/null, no here-document. Once step A7c wires it into run (dark until then:
// run sends every command to the look wall): a look runs in the look wall, so a wrong "look" still can't write or send;
// anything else goes to the run wall with the copy first, to an ask, or nowhere. The mistake that matters is a
// "change", run at once, that should have been asked: a change that names a way in anywhere (even to read it) is lockout.
// at: 'compute' or 'hub' (Spark 2: any change there is risky). root: the typed root (a look stays a look; a script, a
// one-liner, more than one program, or a write outside the root folders is risky). dir: where it starts (~). hosts: the
// fleet's names → 'compute' or the hub. brain: the brain's container and model names (naming one is risky, kind brain).
// The result: class; why (the sorter's own words; a piece of the command in it is one quoted line, cut short); kinds
// (design A 2.14's dangerous asks: root, lockout, delete, brain); form (run's exact form); simple (one program, no
// chaining, redirection, wrapper or name set before it: only that may have an "always" kind); open (it needs what the
// run wall hides); deletes (it removes or overwrites a named file: risky unless every one is copied first, A7b); scripts
// (files it runs, to hash for the ask); answer ('set root' for sudo or su, 'owner command' for the root helper or its
// line); lasting (a lock-out change the net can't put back); placed and wide (each place a program the sorter reads
// writes, removes or changes, as the sorter placed it, ~/… or a whole path, a * kept: wide the folders it reaches
// everything under, placed the rest; what the runner copies first, A7b; a superset: sources and the words an option may
// name count too). scripts, placed and wide hold no control sign or line break: a name with one is refused (risky).
const SORT_ORDER = ['look', 'change', 'risky', 'lockout', 'notdone'], SORT_MAX = 16384, SORT_DEPTH = 4, SORT_WRAPS = 32, SORT_SEEN = 8 * SORT_MAX;
const raise = (r, cls, why) => { if (SORT_ORDER.indexOf(cls) > SORT_ORDER.indexOf(r.class)) Object.assign(r, { class: cls, why }); };
const sortFresh = () => ({ class: 'look', why: 'It only reads.', simple: true, open: false, deletes: false, scripts: [], answer: null, lasting: null });
function sortMerge(r, c) {
  raise(r, c.class, c.why);
  Object.assign(r, { simple: r.simple && c.simple, open: r.open || c.open, deletes: r.deletes || c.deletes, answer: r.answer ?? c.answer, lasting: r.lasting ?? c.lasting });
  r.scripts.push(...c.scripts);
}
// Signs that don't show (controls but tab and new line, format and private ones, lone halves, selectors, blank fillers):
// refused, since what is shown would not be what runs (design A 2.5).
const UNSEEN = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}͏ᅟᅠ឴឵᠋-᠏⠀ㅤ︀-️ﾠ\u{e0100}-\u{e01ef}]/u;

// What may come before a program: a name that decides what runs, what it loads or where it fetches from (risky), and
// the few a look may carry.
const DANGER_ENV = /^(?:PATH|LD_\w+|BASH_ENV|ENV|BASH_FUNC_\S+|SHELLOPTS|BASHOPTS|IFS|PS4|PROMPT_COMMAND|CDPATH|GLOBIGNORE|HOME|PYTHON(?!UNBUFFERED$)\w*|PERL\w*|RUBY\w*|NODE_\w+|GIT_\w+|SSH_\w+|DOCKER_\w+|SYSTEMD_\w+|DBUS_\w+|XDG_\w+|SUDO_\w+|TMPDIR|\w*PAGER|EDITOR|VISUAL|LESS\w*|TAR_OPTIONS|GCONV_PATH|HOSTALIASES|RES_OPTIONS|LOCALDOMAIN|PIP_\w+|UV_\w+|NPM_CONFIG_\w+|YARN_\w+|CONDA_\w+|APT_CONFIG|CURL_HOME|WGETRC|\w*_PROXY|HF_ENDPOINT|OPENSSL_\w+|SIMPLE_BACKUP_SUFFIX|VERSION_CONTROL|GZIP|BZIP2?|XZ_OPT|XZ_DEFAULTS)$/i;
const SAFE_ENV = /^(?:LC_\w+|LANG|LANGUAGE|TZ|TERM|COLUMNS|LINES|NO_COLOR|FORCE_COLOR|CUDA_VISIBLE_DEVICES|OMP_NUM_THREADS|PYTHONUNBUFFERED|DEBIAN_FRONTEND)$/;
function sortAssign(name, ctx, r, prefix) {
  if (DANGER_ENV.test(name)) raise(r, 'risky', `It sets ${sortQ(name)}, which decides what programs run, what they load or where they fetch from.`);
  else if (prefix && !SAFE_ENV.test(name)) { r.simple = false; raise(r, 'change', `It hands ${sortQ(name)} to the program, which may change what it does.`); }
}
// Each pipeline's first part reads what the command was handed (a group's commands inside a pipe too); the later parts
// read the part before them. ctx.piped says an earlier part of this pipeline fetched from the network. A cd followed by
// && (or by || exit) leaves the command in that folder alone until the && chain ends; after it, or after ; or a new
// line, it may also still be where it was (the cd may have failed). A subshell, a $( ) or a pipe's part changes no
// folder after it (the folders it may be in only grow).
const sortIsCd = p => p.length === 1 && !p[0].group && /^(?:cd|pushd)$/.test(p[0].words[0]?.text ?? '') && !p[0].words[0].unknown;
const sortIsExit = p => p?.length === 1 && /^(?:exit|return)$/.test(p[0].words[0]?.text ?? '');
function sortList(items, ctx, r, inPipe = false) {
  if (items.length > 1) r.simple = false;
  let back = null;
  items.forEach((pipe, n) => {
    if (pipe.length > 1) r.simple = false;
    const was = ctx.piped, before = new Set(ctx.cwds);
    if (!inPipe) ctx.piped = false;
    ctx.cdTo = null;
    pipe.forEach((cmd, i) => sortCmd(cmd, ctx, r, inPipe || i > 0));
    ctx.piped = was;
    if (sortIsCd(pipe) && ctx.cdTo && (pipe.op === '&&' || (pipe.op === '||' && sortIsExit(items[n + 1])))) {
      if (pipe.op === '&&') back ??= before;
      ctx.cwds = new Set(ctx.cdTo);
    } else if (back && pipe.op !== '&&') { ctx.cwds = new Set([...back, ...ctx.cwds]); back = null; }
  });
  if (back) ctx.cwds = new Set([...back, ...ctx.cwds]);
}
const sortKeep = (ctx, f) => { const was = new Set(ctx.cwds); try { f(); } finally { ctx.cwds = new Set([...was, ...ctx.cwds]); } };
function sortCmd(cmd, ctx, r, inPipe) {
  const c = sortFresh(), all = [...cmd.assigns, ...cmd.words, ...cmd.redirs.map(d => d.w)], later = [];
  if (++ctx.steps > SORT_STEPS) unsure('It holds more commands than the sorter reads.');
  ctx.words.push(...all);
  const was = ctx.cmd;
  // (the files its own output redirections write are not code it runs: they are written after it is sorted)
  ctx.cmd = [...cmd.assigns, ...cmd.words, ...cmd.redirs.filter(d => /^<(?!>)/.test(d.op)).map(d => d.w)];
  // (what was found before a doubt is kept: the doubt only adds "risky")
  try {
    for (const w of all.filter(x => x.subs.length)) {
      c.simple = false;
      const seen = ctx.fetchSeen;
      ctx.fetchSeen = false;
      for (const s of w.subs) sortKeep(ctx, () => sortList(s, ctx, c));
      w.fetches = ctx.fetchSeen;
      ctx.fetchSeen ||= seen;
    }
    if (cmd.group) { c.simple = false; if (cmd.sub || inPipe) sortKeep(ctx, () => sortList(cmd.group, ctx, c, inPipe)); else sortList(cmd.group, ctx, c, inPipe); }
    let stdin = null;
    for (const d of cmd.redirs) {
      c.simple = false;
      if (/^<</.test(d.op)) { raise(c, 'change', 'It hands a program text to read (a here-document).'); stdin = d.op === '<<<' ? (d.w.unknown ? null : d.w.text) : d.body; continue; }
      if (/^[<>]&$/.test(d.op) && /^(?:\d+-?|-)$/.test(d.w.text) && !d.w.unknown) continue;
      if (d.op === '<') { if (!d.w.unknown) ctx.seen.push(d.w.text); stdin = false; continue; }
      if (!d.w.unknown && !d.w.glob && /^\/dev\/(?:null|stdout|stderr|fd\/[12])$/.test(d.w.text)) continue;
      raise(c, 'change', `It writes ${sortQ(d.w.text || 'a file')} (a redirection).`);
      if (/^(?:>|>\||&>)$/.test(d.op)) c.deletes = true;
      later.push(d.w);
    }
    for (const a of cmd.assigns) sortAssign(a.lit.split(/\+?=/)[0], ctx, c, cmd.words.length > 0);
    try { if (cmd.words.length) sortProgram(cmd.words, ctx, c, { inPipe, stdin }); } finally { for (const w of later) sortTouch(w, ctx, c); }
  } finally { ctx.cmd = was; sortMerge(r, c); }
}

// Code runs: a script file, a one-liner, a build. A change; asked when an earlier part of this command fetched from the
// network, when any word of the command that runs it names a file this same command wrote (its text was never
// sorted) or holds an address (what it fetches is never shown), when it runs from a folder this command wrote into
// (make alone, a one-liner that imports from where it starts), when a word names a folder it wrote into (pip install
// /tmp/p, node /tmp/p), or as root.
const sortWroteIn = (d, ctx) => [...ctx.written].some(p => p.startsWith(d === '/' ? '/' : `${d}/`)) || [...ctx.under].some(u => d === u || d.startsWith(`${u}/`) || u.startsWith(`${d}/`));
function sortRuns(file, ctx, r, why, dir = null) {
  r.simple = false;
  if (file && /[\x00-\x1f\x7f]/.test(file)) unsure('It runs a file with a line break or a control sign in its name.');
  if (file) r.scripts.push(file);
  raise(r, 'change', why);
  if (ctx.fetched || ctx.piped) raise(r, 'risky', `${why} This command fetched from the network before it: code fetched and run is always asked.`);
  if (file && !/^<\(/.test(file) && sortPaths(file, ctx).some(p => sortWrote(p, ctx))) raise(r, 'risky', `${why} It runs a file this same command wrote, whose text the sorter never read.`);
  for (const w of ctx.cmd ?? []) {
    if (w.unknown) continue;
    if (w.text.includes('://')) raise(r, 'risky', `${why} It is handed an address, ${sortQ(w.text)}: what code there does is never shown.`);
    else if (sortCands(w.text).some(c => sortPaths(c, ctx).some(p => sortWrote(p, ctx) || sortWroteIn(p, ctx)))) raise(r, 'risky', `${why} Its word ${sortQ(w.text)} names a file this same command wrote, or a folder it wrote into, whose text the sorter never read.`);
  }
  if (dir?.unknown) unsure('It runs code in a folder named by a $ or a command.');
  if (!file) for (const d of dir ? sortPaths(dir.text, ctx) : ctx.cwds) if (d != null && sortWroteIn(d, ctx)) raise(r, 'risky', `${why} It runs from ${sortQ(d)}, where this same command wrote first.`);
  if (ctx.root) raise(r, 'risky', `${why} As root, a script or a one-liner is always asked.`);
}
const sortGone = (ctx, r, why) => { ctx.kinds.add('delete'); raise(r, 'risky', `${why} That cannot be put back.`); };
const sortOpen = (ctx, r, why) => { r.open = !ctx.root; raise(r, 'risky', why); };
// A command handed over as text (bash -c, eval, watch, ssh): read and sorted like the rest.
function sortInline(text, ctx, r, via) {
  if (ctx.depth >= SORT_DEPTH) unsure(`It nests commands in commands more than ${SORT_DEPTH} deep.`);
  const c = sortFresh();
  ctx.depth++;
  try { sortKeep(ctx, () => sortList(shellParse(shellLex(text).toks), ctx, c)); } finally { ctx.depth--; sortMerge(r, c); }
  if (ctx.root && c.class !== 'look') raise(r, 'risky', `As root, ${via} with a command in it is always asked.`);
  r.simple = false;
}
const sortKnown = n => SORT_HANDLERS[n] != null || SORT_WRAP[n] != null || SORT_READS[n] != null || SORT_FILES[n] != null || SORT_PROGS[n] != null;
// Options a program may take as root and stay a plain change (a root command with any other is asked).
const SORT_ROOT_OPTS = {
  tar: /^(?:-?[xcvzjJftpkmoCa]+|--(?:extract|create|list|file|directory|gzip|xz|bzip2|zstd|verbose|strip-components|no-same-owner|same-owner|preserve-permissions|exclude|overwrite|keep-old-files|skip-old-files|one-file-system|numeric-owner)(?:=.*)?)$/,
  rsync: /^(?:-[avzrlptgoDhPHAXn]+|--(?:archive|verbose|compress|recursive|progress|partial|exclude|include|dry-run|human-readable|checksum|update|links|perms|times|numeric-ids)(?:=.*)?)$/,
  curl: /^(?:-[fsSLkI]+|-[oHXd]|--(?:fail|silent|show-error|location|output|header|request|insecure|retry|max-time|connect-timeout|compressed|create-dirs)(?:=.*)?)$/,
  wget: /^(?:-[qcnNv]+|-[OP]|--(?:quiet|continue|output-document|directory-prefix|no-verbose|tries|timeout)(?:=.*)?)$/,
  pip: /^(?:-[Uqvre]|--(?:upgrade|requirement|editable|no-deps|no-cache-dir|user|break-system-packages|pre|quiet|verbose|force-reinstall|ignore-installed|upgrade-strategy)(?:=.*)?)$/,
  zip: /^-[rqv0-9jDXy]+$/, git: /^$/,
};
function sortProgram(words, ctx, r, x) {
  const [w0, ...args] = words;
  if (w0.unknown || w0.glob || w0.brace) unsure(`The program it runs comes from ${w0.unknown ? 'a $ or a command' : 'a * or {…}'}, so the sorter can't know what runs.`);
  if (++ctx.wraps > SORT_WRAPS || ++ctx.steps > SORT_STEPS) unsure('It wraps commands in commands more than the sorter reads.');
  ctx.programs.add(w0);
  for (const a of args) if (!a.unknown) for (const t of [a.text, /=(.+)$/.exec(a.text)?.[1], /@([~/].*)$/.exec(a.text)?.[1], /^file:\/\/(\/.*)$/.exec(a.text)?.[1]].filter(Boolean)) ctx.seen.push(t, ...[...ctx.cwds].filter(d => d && !/^[~/]/.test(t)).map(d => `${d}/${t}`));
  try {
    let name = w0.text;
    if (name.includes('/')) {
      // A file it runs; and, when its last part names a program the sorter knows, that program too.
      const p = sortPaths(name, ctx)[0], base = p.slice(p.lastIndexOf('/') + 1);
      if (!/^\/(?:usr\/)?(?:local\/)?s?bin\/[^/]+$/.test(p)) { sortNames(p, ctx, r); sortRuns(name, ctx, r, `It runs the file ${sortQ(name)}.`); if (!sortKnown(base.replace(/^(mkfs|fsck)\.\w+$/, '$1'))) return; }
      name = base;
    }
    if (/^(?:mkfs|fsck)\.\w+$/.test(name)) name = name.split('.')[0];
    const h = SORT_HANDLERS[name] ?? (SORT_WRAP[name] && sortWrap), reads = SORT_READS[name], file = SORT_FILES[name], g = SORT_PROGS[name];
    if (!sortKnown(name)) unsure(`The sorter doesn't know the program ${sortQ(name)}.`);
    if (args.length === 1 && /^--(?:version|help)$/.test(args[0].text)) return;
    // Words it reads from its input (after xargs, in find -exec): only a plain reader stays as it was.
    if (x.unknownArgs && reads !== '') { if (file === 'del') ctx.kinds.add('delete'); raise(r, 'risky', `${sortQ(name)} gets words it reads from its input, which the sorter can't see.`); }
    let own = args.length;
    if (h) { const n = h(args, ctx, r, x, name); if (typeof n === 'number' && n >= 0) own = n; }
    else if (reads != null) sortReads(name, reads, args, ctx, r);
    else if (file != null) sortFile(name, file, args, ctx, r, x);
    else if (g.cls === 'open') sortOpen(ctx, r, `${sortQ(name)} ${g.why}, which the run wall hides.`);
    else if (g.cls === 'device') raise(r, 'change', `${sortQ(name)} needs ${g.why}, which a look’s wall hides, so it runs as a change.`);
    else if (g.cls === 'delete') sortGone(ctx, r, `${sortQ(name)} works on ${g.why}.`);
    else if (g.cls === 'lockout' && SORT_LOCK_READS[name]?.(args.map(a => a.text))) raise(r, 'change', `${sortQ(name)} here only reads the network or firewall settings, which a look’s wall hides.`);
    else raise(r, g.cls, `${sortQ(name)}: ${g.why}.`);
    // (after what it does, so the more dangerous answer stands; a handler that runs another program reads its own words)
    const so = SORT_OPTS[name] && sortOpts(SORT_OPTS[name], args.slice(0, own), SORT_MODES[name]), u = so?.unknown;
    // (a file an option names to write, and a folder it writes names of its own into, from the same table)
    for (const w of so?.writes ?? []) { raise(r, 'change', `${sortQ(name)} writes ${sortQ(w.text)}.`); r.deletes = true; sortTouch(w, ctx, r); }
    for (const w of so?.dirs ?? []) { raise(r, 'change', `${sortQ(name)} writes into ${sortQ(w.text)}.`); sortInto(w, ctx, r); }
    if (u) unsure(`The sorter doesn’t know ${sortQ(name)}’s option ${sortQ(u)}: an option it doesn’t read could take the next word, write a file or run a program.`);
    if (ctx.root && r.class !== 'look' && SORT_ROOT_OPTS[name] && args.some(a => a.text.startsWith('-') && !SORT_ROOT_OPTS[name].test(a.text))) raise(r, 'risky', `As root, ${sortQ(name)} with an option the sorter doesn't know as safe is asked.`);
  } finally { ctx.wraps--; }
}
// A program that only reads, unless a flag in its list (a long one also by the letters that begin it) or more plain
// words than #n makes it write or run something; then it is a change, and the files it names are checked. A flag
// marked ! runs the program it is given (rg --pre, sort --compress-program).
function sortReads(name, spec, args, ctx, r) {
  const bad = spec.split(' ').filter(Boolean), most = Number(/#(\d)/.exec(spec)?.[1] ?? Infinity);
  if (bad.length && args.some(a => a.unknown || a.glob || a.brace)) unsure(`A $, * or {…} among ${sortQ(name)}’s words could become a flag that writes, so the sorter can't know what it does.`);
  const is = (t, b) => (b.startsWith('--') ? t.length > 2 && t.startsWith('--') && b.startsWith(t.split('=')[0]) : /^-[^-]/.test(b) && /^-[^-]/.test(t) && t.includes(b[1]));
  const hit = args.map(a => a.text).find(t => bad.some(b => is(t, b.replace(/^!/, ''))));
  if (!hit && args.filter(a => !a.text.startsWith('-')).length <= most) return;
  raise(r, 'change', `${sortQ(name)} ${hit ? sortQ(hit) : 'with that many files'} writes or runs something, so it is a change, not a look.`);
  args.forEach((a, i) => { if (bad.some(b => b.startsWith('!') && is(a.text, b.slice(1)))) sortRuns((a.text.includes('=') ? a.text.slice(a.text.indexOf('=') + 1) : args[i + 1]?.text) || null, ctx, r, `${sortQ(name)} ${sortQ(a.text)} runs the program it is given.`); });
  for (const a of args) sortTouch(a, ctx, r);
}
// A mode that sets the set-user-id or set-group-id bit: a number with 2, 4 or 6 in that place, or an s.
const sortSetuid = m => (/^[0-7]{1,6}$/.test(m) ? (parseInt(m, 8) & 0o6000) !== 0 : /^[-+=]?[0-7]{4,6}$/.test(m) ? (parseInt(m.replace(/^[-+=]/, ''), 8) & 0o6000) !== 0 : /[ugoa]*[-+=][rwxXst]*s/.test(m));
// The file tools: del removes what it names (a $, * or {…} there, and what goes isn't named), over may replace a file,
// wide (chmod and its kin) reaches what is under a folder, and a folder above a way in (sshd refuses keys then).
// A copy into a folder makes folder + each source's name; a link makes what it points at reachable elsewhere.
function sortFile(name, kind, args, ctx, r) {
  const o = sortOpts(SORT_OPTS[name], args, SORT_MODES[name]), plain = o.plain, rec = o.has('r', 'R', 'recursive');
  raise(r, 'change', `${sortQ(name)} changes files.`);
  if (/del|over/.test(kind)) r.deletes = true;
  if (kind === 'del' && plain.some(a => a.unknown || a.glob || a.brace)) sortGone(ctx, r, `${sortQ(name)} removes files it doesn't name (a $, a * or a {…}).`);
  const mode = name === 'chmod' ? plain[0]?.text : name === 'install' ? o.all('m', 'mode').at(-1)?.text : null;
  if (mode && mode.split(',').some(sortSetuid)) raise(r, 'risky', `${sortQ(name)} sets a set-user-id or set-group-id bit: such a program runs as its owner, root by another name.`);
  // (a mode or an owner first is no path; an empty file or folder made new holds nothing that runs)
  const files = /^(?:chmod|chown|chgrp|chattr)$/.test(name) ? plain.slice(1) : plain, writes = kind === 'over' || (kind === '' && !/^(?:mkdir|touch|mkfifo|mktemp)$/.test(name));
  // (split and csplit read their input and write a prefix and a suffix they count: every name it can make)
  if (/^c?split$/.test(name)) { const pre = name === 'split' ? plain[1] ?? { text: 'x', subs: [] } : o.all('f', 'prefix').at(-1) ?? { text: 'xx', subs: [] }; return sortTouch({ ...pre, text: `${pre.text}*`, glob: true }, ctx, r); }
  const t = o.all('t', 'target-directory').at(-1), dir = /^(?:cp|mv|install|ln)$/.test(name) ? t ?? (files.length > 1 ? files.at(-1) : null) : null;
  const into = /^(?:cp|install)$/.test(name) && o.has('r', 'R', 'a', 'recursive', 'archive') ? dir : null;
  // (a backup is the name it replaces with a suffix, ~ unless -S says; --parents keeps the source's whole path)
  const bk = /^(?:cp|mv|install|ln)$/.test(name) && o.has('b', 'backup', 'S', 'suffix') ? o.all('S', 'suffix').at(-1)?.text ?? '~' : null;
  const to = (w, text) => { const x = { ...w, text, glob: w.glob || !!dir?.glob, unknown: w.unknown || !!dir?.unknown }; sortTouch(x, ctx, r, false); if (bk != null) sortTouch({ ...x, text: text + bk }, ctx, r, false); };
  for (const a of files) {
    if (a === dir) continue;
    const src = !!dir, at = dir?.text.replace(/\/+$/, '');
    sortTouch(a, ctx, r, kind === 'wide' || (kind === 'del' && rec) || (name === 'mv' && src) || (name === 'ln' && src), writes);
    if (src) to(a, `${at}/${a.text.replace(/\/+$/, '').split('/').pop()}`);
    if (src && o.has('parents')) to(a, `${at}/${a.text.replace(/^\/+/, '')}`);
  }
  if (dir) { sortTouch(dir, ctx, r, dir === into, true); if (bk != null) sortTouch({ ...dir, text: dir.text.replace(/\/+$/, '') + bk }, ctx, r, false); }
}

// Programs that only read: the string lists what makes one write or run something (see sortReads).
const SORT_READS = {
  ...Object.fromEntries(('ls dir vdir cat tac nl head tail wc du df free uptime uname arch whoami id groups logname pwd echo true false seq '
    + 'sleep nproc getconf locale printenv tty stat readlink realpath basename dirname which whereis type lsblk lscpu lspci lsusb lsmod modinfo lsof ps '
    + 'pgrep pidof pstree vmstat iostat mpstat sensors md5sum sha1sum sha224sum sha256sum sha384sum sha512sum b2sum cksum sum base32 base64 cut tr '
    + 'paste join comm column fold fmt expand unexpand strings od hexdump grep egrep fgrep zgrep zcat bzcat xzcat more jq diff cmp last '
    + 'lastlog w who users getent lsattr getfacl findmnt namei numfmt expr ldd lsb_release apt-cache dpkg-query top cd wait : exit return shift '
    + 'break continue umask ulimit times').split(' ').map(n => [n, ''])),
  less: '-o -O --log-file --LOG-FILE', sort: '-o -T --output !--compress-program --temporary-directory', uniq: '#1', rg: '!--pre !--pre-glob', tree: '-o',
  zstdcat: '-o --output #1', lz4cat: '#1',
  file: '-C --compile', xxd: '-r --revert #1', date: '-s --set', dmesg: '-c -C -D -E -n --clear --read-clear --console-off --console-on --console-level',
  journalctl: '--setup-keys --rotate --flush --sync --relinquish-var --smart-relinquish-var --update-catalog --vacuum-size --vacuum-time --vacuum-files',
};
const SORT_FILES = Object.fromEntries(Object.entries({ over: 'cp mv ln install tee', del: 'rm rmdir unlink shred truncate', wide: 'chmod chown chgrp chattr setfacl',
  '': 'mkdir touch mkfifo mktemp split csplit zip' }).flatMap(([k, v]) => v.split(' ').map(n => [n, k])));
// Programs past a change, by class: open (needs what the run wall hides), device (needs a device or the network a look
// lacks: a change), delete (a disk: risky, kind delete), and the rest by name.
const SORT_PROGS = {};
for (const [cls, names, why] of [
  ['risky', 'shutdown reboot poweroff halt telinit rtcwake pm-suspend pm-hibernate', 'power, so what runs on that Spark stops'],
  ['risky', 'modprobe insmod rmmod depmod update-grub grub-install grub-mkconfig update-initramfs mkinitramfs dracut dkms fwupdmgr fwupdtool ubuntu-drivers do-release-upgrade mokutil efibootmgr kexec', 'the kernel, a driver, firmware or a release upgrade'],
  ['delete', 'mkfs mke2fs mkswap fdisk sfdisk gdisk sgdisk cfdisk parted partprobe wipefs blkdiscard hdparm sdparm nvme losetup cryptsetup mdadm pvcreate pvremove vgcreate vgremove vgextend vgreduce lvcreate lvremove lvextend lvresize lvreduce fsck e2fsck tune2fs resize2fs xfs_repair xfs_growfs btrfs zpool zfs debugfs fstrim umount swapoff smartctl', 'a disk'],
  ['risky', 'crontab at batch atrm anacron systemd-run', 'a job or a unit that runs by itself, outside the wall'],
  ['risky', 'dockerd containerd chroot unshare setcap capsh mknod nc ncat netcat update-alternatives', 'the system itself, outside what the ladder covers'],
  ['open', 'ctr crictl busctl dbus-send gdbus machinectl kill pkill killall skill snice renice nsenter snap hostnamectl timedatectl localectl', 'needs a socket or another program'],
  ['device', 'nvidia-smi ss netstat ping ping6 traceroute tracepath mtr dig nslookup host blkid dmidecode lshw iptables-save ip6tables-save', 'a device or the network'],
  ['notdone', 'ngrok cloudflared frpc frps bore chisel sshuttle autossh socat localtunnel lt pagekite inlets rathole zrok tor', 'a relay or tunnel round a network filter is not done'],
  ['risky', 'npx pnpx bunx uvx', 'it downloads a package and runs it'],
  ['lockout', 'useradd adduser userdel deluser usermod passwd chpasswd chage chsh chfn groupadd addgroup groupdel delgroup groupmod gpasswd newusers vipw vigr visudo pwconv pwunconv grpconv grpunconv pam-auth-update faillock ssh-copy-id sshd tailscaled iptables ip6tables iptables-legacy iptables-nft iptables-restore ip6tables-restore ebtables arptables nft ufw firewall-cmd netplan nmcli nmtui ifup ifdown ifconfig route iw iwconfig wpa_cli wpa_supplicant tc resolvectl systemd-resolve ethtool', 'users and passwords, SSH, the firewall or the network settings, ways in'],
]) for (const n of names.split(' ')) SORT_PROGS[n] = { cls, why };
// The lock-out programs' forms that only read (the object, then nothing or a word that begins show, list or get; no ;).
const SORT_VERBS = 'add append attach change chg del delete detach flush prepend replace restore save set update up down monitor exec batch'.split(' ');
const sortShows = (a, from = 0) => {
  const p = a.filter(t => !t.startsWith('-')), v = p[from + 1];
  return !a.some(t => /[;\n]/.test(t)) && !p.slice(from + 2).some(t => SORT_VERBS.includes(t))
    && (v === undefined || ((['show', 'list', 'get', 'help'].some(s => s.startsWith(v)) || /^l(?:s|st)$/.test(v)) && !SORT_VERBS.some(s => s.startsWith(v))));
};
const SORT_LOCK_READS = {
  iptables: a => a.every(t => /^(?:-[LSnvx]+|-t|--(?:list|list-rules|numeric|verbose|line-numbers|exact)|filter|nat|mangle|raw|security|[A-Z][A-Z_-]*)$/.test(t)),
  nft: a => a.find(t => !t.startsWith('-')) === 'list' && !a.some(t => /[;\n]|^-\w*f/.test(t)), ufw: a => /^(?:status|show)$/.test(a[0] ?? '') && !a.some(t => /[;\n]/.test(t)), route: a => a.every(t => /^-[nev]+$/.test(t)),
  ifconfig: a => a.length <= 1 && !/^-[^as]/.test(a[0] ?? ''), tc: a => !a.some(t => /^-(?:b|ba\w*|force)$/.test(t)) && a.filter(t => !t.startsWith('-')).length > 1 && /^(?:show|list|ls)$/.test(a.filter(t => !t.startsWith('-'))[1]) && sortShows(a), sshd: a => a.length > 0 && a.every(t => /^-[tT]$/.test(t)),
  ethtool: a => a.length === 1 || (a.length === 2 && /^-[iSkgaclTPm]$|^--(?:driver|statistics|show-\w+)$/.test(a[0])),
  hostname: a => a.every(t => /^-[aAdfiIsy]+$|^--(?:all-fqdns|all-ip-addresses|domain|fqdn|ip-address|short|long|alias)$/.test(t)),
};
SORT_LOCK_READS.ip6tables = SORT_LOCK_READS['iptables-legacy'] = SORT_LOCK_READS['iptables-nft'] = SORT_LOCK_READS.iptables;

// Wrappers run the command after their own options: [flags, flags that take a word, plain words first, long options
// (name= takes its value attached)]. An option the sorter doesn't know is a doubt: it could take the next word, or
// change where the command runs (env -C).
const SORT_WRAP = {
  env: ['i0v', 'u', 0, 'ignore-environment null unset='], nice: ['', 'n', 0, 'adjustment='], ionice: ['t', 'cn', 0, 'class= classdata='],
  nohup: ['', '', 0, ''], timeout: ['v', 'sk', 1, 'signal= kill-after= preserve-status foreground verbose'], stdbuf: ['', 'ioe', 0, 'input= output= error='],
  time: ['pv', 'f', 0, 'portability verbose format='], command: ['p', '', 0, ''], exec: ['cl', 'a', 0, ''], builtin: ['', '', 0, ''],
  setsid: ['cfw', '', 0, 'ctty fork wait'], unbuffer: ['p', '', 0, ''], flock: ['senuxo', 'wE', 1, 'shared exclusive unlock nonblock close wait= conflict-exit-code='],
  watch: ['bcdeghtpwx', 'nq', 0, 'interval= differences beep color errexit chgexit exec no-title precise no-wrap'], busybox: ['', '', 0, ''],
  xargs: ['0prtxiel', 'aEILnPsd', 0, 'null no-run-if-empty verbose interactive exit open-tty arg-file= delimiter= replace= max-lines= max-args= max-procs= max-chars= eof='],
};
function sortWrap(args, ctx, r, x, name) {
  const [flags, takes, pos, longs] = SORT_WRAP[name];
  r.simple = false;
  if (name === 'command' && /^-[vV]$/.test(args[0]?.text)) return;
  let k = 0;
  for (; k < args.length; k++) {
    const a = args[k], t = a.text;
    if (a.unknown || a.glob) unsure(`${sortQ(name)}’s words hold a $ or a *, so the sorter can't know what it runs.`);
    if (t === '--') { k++; break; }
    if (name === 'env' && /^[A-Za-z_]\w*=/.test(t)) { sortAssign(t.split('=')[0], ctx, r, true); continue; }
    if (!t.startsWith('-') || t === '-') break;
    if (name === 'nice' && /^-\d+$/.test(t)) continue;
    if (t.startsWith('--')) { if (!longs.split(' ').includes(t.includes('=') ? `${t.slice(2).split('=')[0]}=` : t.slice(2))) unsure(`The sorter doesn't know ${sortQ(name)}’s option ${sortQ(t)}.`); continue; }
    for (let j = 1; j < t.length; j++) {
      if (takes.includes(t[j])) { if (j === t.length - 1) k++; break; }
      if (!flags.includes(t[j])) unsure(`The sorter doesn't know ${sortQ(name)}’s option ${sortQ(`-${t[j]}`)}.`);
    }
  }
  const rest = args.slice(k + pos);
  if (name === 'flock') { raise(r, 'change', 'flock makes its lock file.'); sortTouch(args[k], ctx, r); }
  if (name === 'xargs') raise(r, 'change', 'xargs runs the command after it with words it reads, which the sorter can’t see.');
  if (!rest.length) return;
  if (name === 'watch' && !args.slice(0, k).some(a => /^-\w*x$|^--exec$/.test(a.text))) {
    if (rest.some(a => a.unknown)) unsure('watch runs words that hold a $ or a command.');
    const text = rest.map(a => a.text).join(' ');
    if (text.includes('&>')) unsure('watch hands its words to sh, which reads &> another way than bash.');
    return sortInline(text, ctx, r, 'watch');
  }
  sortProgram(rest, ctx, r, { ...x, unknownArgs: x.unknownArgs || name === 'xargs' });
}
// After the parts: on Spark 2 a change is risky; as root, more than one plain program is risky (design A 2.7, 2.8).
function sortAt(r, ctx) {
  if (ctx.at === 'hub' && r.class === 'change') raise(r, 'risky', 'It changes Spark 2, which runs the console and the brain: anything that changes Spark 2 is asked first.');
  if (ctx.root && r.class === 'change' && !r.simple) raise(r, 'risky', 'As root, only a plain command (one program, with no chaining, redirection or wrapper) runs at once: this one is asked.');
}
function sortCommand(command, opts) {
  const r = sortFresh(), ctx = { at: 'compute', root: false, hosts: Object.create(null), brain: [], home: null, depth: 0, cwds: new Set(), fetched: false, fetchSeen: false, piped: false,
    seen: [], kinds: new Set(), words: [], programs: new Set(), written: new Set(), under: new Set(), changes: new Map(), cmd: [], steps: 0, wraps: 0 };
  let text = '', form = null;
  try {
    const o = opts && typeof opts === 'object' ? opts : {};
    text = String(command ?? '');
    for (const [k, v] of Object.entries(o.hosts && typeof o.hosts === 'object' ? o.hosts : {})) ctx.hosts[k] = v === 'compute' ? 'compute' : 'hub';
    Object.assign(ctx, { at: o.at ?? 'compute', root: !!o.root, brain: (Array.isArray(o.brain) ? o.brain : []).filter(b => typeof b === 'string' && b.length > 2) });
    // (the owner's home on that Spark: given, or the configured user's; a path is placed against it alone)
    const home = o.home != null ? String(o.home).replace(/\/+$/, '') : typeof CONFIG === 'object' && /^[a-z_][a-z0-9_-]*$/i.test(String(CONFIG?.user)) ? `/home/${CONFIG.user}` : null;
    if (home != null && (!/^(?:\/[\w.@+-]+)+$/.test(home) || /\/\.\.?(?:\/|$)/.test(home))) unsure('The owner’s home is not one the sorter can place.');
    ctx.home = home;
    if (ctx.at !== 'compute' && ctx.at !== 'hub') { ctx.at = 'hub'; unsure('Where it runs is not one the sorter knows.'); }
    const dir = o.dir == null ? '~' : String(o.dir);
    if (/[$`\\\x00-\x1f\x7f]|^~[^/]|(?:^|\/)proc(?:\/|$)/.test(dir)) unsure('The folder it starts in is not one the sorter can place.');
    ctx.cwds.add(sortNorm(dir.replace(/^(?![~/])/, '~/'), null, ctx.home));
    if (!text.trim()) unsure('The command is empty.');
    if (text.length > SORT_MAX) unsure(`It is ${text.length} characters long, past the ${SORT_MAX} the sorter reads whole.`);
    const hidden = UNSEEN.exec(text.replace(/[\t\n]/g, ''));
    if (hidden) raise(r, 'notdone', `It holds a sign that doesn’t show (U+${hidden[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}): what is shown would not be what runs.`);
    else {
      const odd = /[^\t\n\x20-\x7e]/u.exec(text);
      if (odd) unsure(`It holds the sign U+${odd[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}, which isn’t plain ASCII: such a sign can look like ; | > or a quote and not be one.`);
      form = lookForm(text);
      if (form) r.why = 'It is one of the exact forms a look runs as code’s own text.'; else sortList(shellParse(shellLex(text).toks), ctx, r);
      if (r.class !== 'look') sortSee(ctx.words, ctx, r);
    }
  } catch (e) {
    raise(r, 'risky', e instanceof SortDoubt ? e.message : 'The sorter could not read this command.');
    try { if (text.length <= SORT_MAX) { ctx.steps = 0; sortScan(text, ctx, r, true); } } catch { /* the scan is a backstop: it adds, never decides */ }
  }
  try {
    if (r.class !== 'notdone' && text.length <= SORT_MAX) {
      // run's own look checks (21-work.mjs), so a look is one definition: no sudo word, no key word.
      // (each word once, and no more of them than SORT_SEEN signs in all: past that it is asked, never a look)
      const lw = lookWords(text);
      let budget = SORT_SEEN, key;
      for (const w of new Set([...lw.words, ...ctx.seen])) { if ((budget -= w.length) < 0) { raise(r, 'risky', 'It names more than the sorter reads for a key.'); break; } if (keyWord(w)) { key = w; break; } }
      if (r.class === 'look' && lw.sudo) raise(r, 'change', 'It runs sudo, which a look refuses: a command becomes root only by setting root.');
      if (key && r.class === 'look') raise(r, 'notdone', `It would show ${sortQ(key)}, which is a key or holds one: a key is never shown back.`);
      else if (key) sortOpen(ctx, r, `It names ${sortQ(key)}, key material the run wall hides, so it would run outside the wall.`);
    }
    sortAt(r, ctx);
  } catch { raise(r, 'risky', 'The sorter could not read this command.'); }
  if (r.class === 'lockout') ctx.kinds.add('lockout');
  if (ctx.root) ctx.kinds.add('root');
  const kinds = r.class === 'look' ? [] : ['root', 'lockout', 'delete', 'brain'].filter(k => ctx.kinds.has(k)), plain = p => !/[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(p);
  const why = r.why.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]+/g, ' ').slice(0, 400), changes = [...ctx.changes].filter(([p]) => plain(p));
  return { class: r.class, why, kinds, form, simple: r.simple, open: r.open, deletes: r.deletes, scripts: [...new Set(r.scripts)].filter(plain).map(s => s.slice(0, 400)), answer: r.answer, lasting: r.lasting,
    placed: changes.filter(([, w]) => !w).map(([p]) => p), wide: changes.filter(([, w]) => w).map(([p]) => p) };
}
