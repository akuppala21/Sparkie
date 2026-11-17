/* ───────── the sorter: what one command on a Spark is (design A 2.8) ───────── */
// Area: safety        Rules: R55, R75        Tests: sort.test.mjs
// Owns: none
// Timers: none        Wakes: none
// sortCommand(command, {at, root, dir, home, hosts, brain, written, protect}) says what one command for run is before anything runs, from its
// text and where it runs alone: no model call, no file read, a bounded amount of work, and never a throw for anything
// JSON can carry (a getter or a toString that throws is caught too). Five classes, in
// their order of danger (when two could apply, the later wins): look (only reads: at once), change (design A 2.5's
// ladder), risky (always asked), lockout (only as root: asked, inside the net), notdone (never, and not for want of a yes).
// The careful answer is the default: a command is a change only when the sorter can show it is one, a program it knows,
// called by a name or path it resolves to that program, with every word that decides what it does in view, touching
// only places it can place (20-places.mjs). Anything else is risky: an unknown program, option or sub-command (each
// program's list is in 20-options.mjs), a loop, a $ where an option, a program or a path goes, a sign that isn't plain
// ASCII, words a program reads from its input, code fetched or written by this same command, a command or a copy on
// another machine (no wall there). A look keeps run's own checks (21-work.mjs:
// lookForm's exact forms, no sudo or key word by lookWords and keyWord), and every program in it only reads, with no
// flag that writes, no redirection but to /dev/null, no here-document. run sorts each command with it (A7c): a look runs
// in the look wall, so a wrong "look" still can't write or send; anything else goes to the ladder (21-ladder.mjs): the
// run wall with the copy first, an ask, or nowhere. The mistake that matters is a
// "change", run at once, that should have been asked: a change that names a way in anywhere (even to read it) is lockout.
// at: 'compute' or 'hub' (Spark 2: any change there is risky). root: the typed root (a look stays a look; a script, a
// one-liner, more than one program, or a write outside the root folders is risky). dir: where it starts (~). hosts: the
// fleet's names → 'compute' or the hub. brain: the brain's container and model names (naming one is risky, kind brain).
// home: the owner's home there. written: what the task's earlier commands wrote (as placed lists it), counted as written here.
// protect: the protected containers' name patterns (CONFIG.protect when not given): stopping one is not done.
// The result: class; why (the sorter's own words; a piece of the command in it is one quoted line, cut short); kinds
// (design A 2.14's dangerous asks: root, lockout, delete, brain); form (run's exact form); simple (one program, no
// chaining, redirection, wrapper or name set before it: only that may have an "always" kind); program (a simple
// command's program, as the sorter resolved it, else null); open (it needs what the
// run wall hides); deletes (it removes or overwrites a named file: risky unless every one is copied first, A7b); scripts
// (files it runs, to hash for the ask); unshown (code it runs that is not all on the button, in the sorter's words: root
// refuses on it); unpinnable (each piece of it that is no file named as a word, so no script's hash pins it, all of them);
// later (work it starts later, outside the button and the net: root refuses on it); unknownProgram (a
// program it doesn't know, by name); overwrites (with
// deletes, the places whose old content it removes or writes over); answer ('set root' for sudo or su, 'owner command' for the root helper or its
// line); lasting (a lock-out change the net can't put back); placed and wide (each place a program the sorter reads
// writes, removes or changes, as the sorter placed it, ~/… or a whole path, a * kept: wide the folders it reaches
// everything under, placed the rest; what the runner copies first, A7b; a superset: sources and the words an option may
// name count too). scripts, placed and wide hold no control sign or line break: a name with one is refused (risky).
const SORT_ORDER = ['look', 'change', 'risky', 'lockout', 'notdone'], SORT_MAX = 16384, SORT_DEPTH = 4, SORT_WRAPS = 32, SORT_SEEN = 8 * SORT_MAX;
const raise = (r, cls, why) => { if (SORT_ORDER.indexOf(cls) > SORT_ORDER.indexOf(r.class)) Object.assign(r, { class: cls, why }); };
const sortFresh = () => ({ class: 'look', why: 'It only reads.', simple: true, open: false, deletes: false, scripts: [], answer: null, lasting: null, unshown: null, unpinnable: [], later: null, unreadable: null });
function sortMerge(r, c) {
  raise(r, c.class, c.why);
  Object.assign(r, { simple: r.simple && c.simple, open: r.open || c.open, deletes: r.deletes || c.deletes, answer: r.answer ?? c.answer, lasting: r.lasting ?? c.lasting, unshown: r.unshown ?? c.unshown, later: r.later ?? c.later, unreadable: r.unreadable ?? c.unreadable });
  r.scripts.push(...c.scripts);
  for (const u of c.unpinnable) if (r.unpinnable.length < 16 && !r.unpinnable.includes(u)) r.unpinnable.push(u);
}
// Code it runs that the command does not show (unshown, in the sorter's own words): a file of code named as a word (in
// scripts too, to hash), a shell or an interpreter fed its code from input, a module or a package's scripts run by name,
// a build, a start file a setting names, a file words from input name. Root refuses on it; for a change as the owner only
// code fed from input or a start-file setting is asked: a script, a build, a module or a project's scripts runs inside
// the run wall, which is what bounds it, as a plain change does.
// (unpinnable: every such code that is not a file named as a word, whose hash can't pin it: all of them, not the first)
const sortUnshown = (r, what, file = false) => { const w = String(what).slice(0, 200); r.unshown ??= w; if (!file && !r.unpinnable.includes(w) && r.unpinnable.length < 16) r.unpinnable.push(w); r.simple = false; };
// Signs that don't show (controls but tab and new line, format and private ones, lone halves, selectors, blank fillers):
// refused, since what is shown would not be what runs (design A 2.5).
const UNSEEN = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}͏ᅟᅠ឴឵᠋-᠏⠀ㅤ︀-️ﾠ\u{e0100}-\u{e01ef}]/u;

// What may come before a program: a name that decides what runs, what it loads or where it fetches from (risky), and
// the few a look may carry.
const DANGER_ENV = /^(?:PATH|LD_\w+|BASH_ENV|ENV|BASH_FUNC_\S+|SHELLOPTS|BASHOPTS|IFS|PS4|PROMPT_COMMAND|CDPATH|GLOBIGNORE|HOME|PYTHON(?!UNBUFFERED$)\w*|PERL\w*|RUBY\w*|NODE_\w+|GIT_\w+|SSH_\w+|DOCKER_\w+|SYSTEMD_\w+|DBUS_\w+|XDG_\w+|SUDO_\w+|TMPDIR|\w*PAGER|EDITOR|VISUAL|LESS\w*|TAR_OPTIONS|GCONV_PATH|HOSTALIASES|RES_OPTIONS|LOCALDOMAIN|PIP_\w+|UV_\w+|NPM_CONFIG_\w+|YARN_\w+|CONDA_\w+|APT_CONFIG|CURL_HOME|WGETRC|\w*_PROXY|HF_ENDPOINT|OPENSSL_\w+|SIMPLE_BACKUP_SUFFIX|VERSION_CONTROL|AWKPATH|AWKLIBPATH|MAKEFLAGS|MFLAGS|GNUMAKEFLAGS|MAKEFILES|GZIP|BZIP2?|XZ_OPT|XZ_DEFAULTS)$/i;
const SAFE_ENV = /^(?:LC_\w+|LANG|LANGUAGE|TZ|TERM|COLUMNS|LINES|NO_COLOR|FORCE_COLOR|CUDA_VISIBLE_DEVICES|OMP_NUM_THREADS|PYTHONUNBUFFERED|DEBIAN_FRONTEND)$/;
function sortAssign(name, ctx, r, prefix, value = null) {
  ctx.sets?.add(name);
  ctx.setTo?.set(name, value);
  // (where Docker connects: a host there that is Spark 2, or one that can't be told, R64)
  if (/^DOCKER_(?:HOST|CONTEXT)$/i.test(name)) { if (value == null || /CONTEXT/i.test(name)) sortToHub('', ctx, r, name, true); else if (!/^(?:unix|fd|npipe):|^$/.test(value)) sortToHub(usesHost(value) ?? value.replace(/:\d+$/, ''), ctx, r, name); }
  if (DANGER_ENV.test(name)) { if (!/^(?:DOCKER_\w+|\w*_PROXY|HF_ENDPOINT|TMPDIR|IFS|CDPATH|GLOBIGNORE|HOSTALIASES|RES_OPTIONS|LOCALDOMAIN|SIMPLE_BACKUP_SUFFIX|VERSION_CONTROL|GZIP|BZIP2?|XZ_OPT|XZ_DEFAULTS|DBUS_\w+|SYSTEMD_\w+|SUDO_\w+)$/i.test(name)) sortUnshown(r, `what ${name} names: a program, a start file or a library loaded by itself`); raise(r, 'risky', `It sets ${sortQ(name)}, which decides what programs run, what they load or where they fetch from.`); }
  else if (prefix && !SAFE_ENV.test(name)) { r.simple = false; raise(r, 'change', `It hands ${sortQ(name)} to the program, which may change what it does.`); }
}
// Each pipeline's first part reads what the command was handed (a group's commands inside a pipe too); the later parts
// read the part before them. ctx.piped says an earlier part of this pipeline fetched from the network. One form alone
// narrows where the command stands: its very first word is cd, with one plain folder and no option, and && follows; then
// the rest of that && chain stands there. Any other cd (a second one, after ||, with an option, a later chain) narrows
// nothing: the command stands in every folder a cd may have left it in, the start included. A subshell, a $( ) or a
// pipe's part changes no folder after it (the folders it may be in only grow).
const sortIsCd = p => p.length === 1 && !p[0].group && /^(?:cd|pushd)$/.test(p[0].words[0]?.text ?? '') && !p[0].words[0].unknown;
const sortOneCd = p => sortIsCd(p) && !p[0].neg && p[0].words[0].text === 'cd' && p[0].words.length === 2 && !p[0].assigns.length && !p[0].redirs.length
  && p[0].words[1].plain && !/^-/.test(p[0].words[1].text) && !p[0].words[1].glob && !p[0].words[1].brace;
// A doubt in one part (one simple command of a list or a pipe, a group's, a subshell's, a $( )'s) is that part's: the
// parts after it are still sorted, and the answer is the strictest of all (F1). onward: what these parts print goes on to
// another program, a $( ) or a file (a key's text leaving, sortCmd).
function sortList(items, ctx, r, inPipe = false, top = false, onward = false) {
  if (items.length > 1) r.simple = false;
  let start = new Set(ctx.cwds), reached = [], narrowed = false;
  items.forEach((pipe, n) => {
    if (pipe.length > 1) r.simple = false;
    const was = ctx.piped;
    if (!inPipe) ctx.piped = false;
    ctx.cdTo = null;
    pipe.forEach((cmd, i) => { try { sortCmd(cmd, ctx, r, inPipe || i > 0, onward || i < pipe.length - 1); } catch (e) { sortDoubted(e, cmd, ctx, r); } });
    ctx.piped = was;
    if (sortIsCd(pipe) && ctx.cdTo) {
      reached.push(...ctx.cdTo);
      let e = n;
      while (e < items.length - 1 && /^(?:&&|\|\|)$/.test(items[e].op ?? '')) e++;
      if (top && n === 0 && pipe.op === '&&' && sortOneCd(pipe) && items[e].op !== '&') { ctx.cwds = new Set(ctx.cdTo); narrowed = true; }
      else ctx.cwds = new Set([...ctx.cwds, ...ctx.cdTo]);
    }
    // (once the && chain after the first cd is left, or after ||, it may stand anywhere a cd reached, or where it began)
    if (narrowed && pipe.op !== '&&') { ctx.cwds = new Set([...start, ...reached, ...ctx.cwds]); narrowed = false; }
    else if (!narrowed) ctx.cwds = new Set([...start, ...reached, ...ctx.cwds]);
  });
}
// A part's doubt: risky, said; unreadable when the sorter could not read on; and the part's words still read by the
// tables that need no option's meaning (programs and ways in named, the helper's names, keys by the check at the end).
function sortDoubted(e, cmd, ctx, r) {
  if (!(e instanceof SortDoubt) || e.bound) throw e;
  raise(r, 'risky', e.message);
  if (e.unreadable) { r.unreadable ??= e.message; sortUnshown(r, 'a part of the command the sorter could not read'); }
  if (ctx.steps > SORT_STEPS) return;
  for (const w of [...cmd.assigns, ...cmd.words, ...cmd.redirs.map(d => d.w)]) {
    if (w.unknown || w.text.length > SORT_PATH) continue;
    try { sortScan(w.text, ctx, r, true); } catch (x) { if (!(x instanceof SortDoubt)) throw x; if (x.unreadable) r.unreadable ??= x.message; }
  }
}
const sortKeep = (ctx, f) => { const was = new Set(ctx.cwds); try { f(); } finally { ctx.cwds = new Set([...was, ...ctx.cwds]); } };
function sortCmd(cmd, ctx, r, inPipe, onward = false) {
  const c = sortFresh(), all = [...cmd.assigns, ...cmd.words, ...cmd.redirs.map(d => d.w)], later = [], wasOn = ctx.onward;
  ctx.onward = onward;
  // (what this part reads and where it writes, for a key's text leaving: sortKeyLeaves)
  const mark = { srcs: ctx.srcs.length, outs: ctx.outs.length, far: ctx.farDests.length, reach: ctx.reach.size, wrote: new Set(ctx.wrote) };
  for (const d of cmd.redirs) if (d.op === '<' && !d.w.unknown) ctx.srcs.push(d.w.text);
  if (++ctx.steps > SORT_STEPS) sortBound('It holds more commands than the sorter reads.');
  ctx.words.push(...all);
  // (a {…} bash expands that the sorter can't spell out as bash does: with quoted or $ parts, or one inside another)
  const odd = all.find(w => (w.brace && !w.plain) || sortNested(w.bare ?? ''));
  const was = ctx.cmd;
  // (the files its own output redirections write are not code it runs: they are written after it is sorted)
  ctx.cmd = [...cmd.assigns, ...cmd.words, ...cmd.redirs.filter(d => /^<(?!>)/.test(d.op)).map(d => d.w)];
  const wasIn = ctx.inputs;
  ctx.inputs = cmd.redirs.filter(d => d.op === '<').map(d => d.w);
  // (what was found before a doubt is kept: the doubt only adds "risky")
  try {
    for (const w of all.filter(x => x.subs.length)) {
      c.simple = false;
      const seen = ctx.fetchSeen;
      ctx.fetchSeen = false;
      for (const s of w.subs) sortKeep(ctx, () => sortList(s, ctx, c, false, false, true));
      w.fetches = ctx.fetchSeen;
      ctx.fetchSeen ||= seen;
    }
    if (cmd.group) { c.simple = false; if (cmd.sub || inPipe) sortKeep(ctx, () => sortList(cmd.group, ctx, c, inPipe, false, onward)); else sortList(cmd.group, ctx, c, inPipe, false, onward); }
    let stdin = null, opaque = false;
    for (const d of cmd.redirs) {
      c.simple = false;
      if (/^<</.test(d.op)) {
        raise(c, 'change', 'It hands a program text to read (a here-document).');
        // (text with a $ or a ` the sorter can't read as written: a shell or an interpreter reading it is a doubt)
        opaque = d.op === '<<<' ? d.w.unknown : !d.quoted && /[$`]/.test(d.body ?? '');
        stdin = opaque ? null : d.op === '<<<' ? d.w.text : d.body;
        continue;
      }
      if (/^[<>]&$/.test(d.op) && /^(?:\d+-?|-)$/.test(d.w.text) && !d.w.unknown) continue;
      d.w.literal = true;
      if (d.op === '<') { if (!d.w.unknown) ctx.seen.push(d.w.text); stdin = false; continue; }
      if (!d.w.unknown && !d.w.glob && /^\/dev\/(?:null|stdout|stderr|fd\/[12])$/.test(d.w.text)) continue;
      raise(c, 'change', `It writes ${sortQ(d.w.text || 'a file')} (a redirection).`);
      if (/^(?:>|>\||&>)$/.test(d.op)) c.deletes = true;
      later.push(d.w);
    }
    for (const a of cmd.assigns) sortAssign(a.lit.split(/\+?=/)[0], ctx, c, cmd.words.length > 0, a.unknown ? null : a.text.replace(/^[^=]*=/, ''));
    // (the text a program is handed on its input, here-text: what a file written from it holds, sortLaterPlace)
    const wasText = ctx.stdinText;
    ctx.stdinText = typeof stdin === 'string' ? stdin : null;
    try { if (cmd.words.length) sortProgram(cmd.words, ctx, c, { inPipe, stdin, opaque }); } finally { for (const w of later) sortTouch(w, ctx, c); ctx.stdinText = wasText; }
    // (after what it does, so the more dangerous answer stands)
    if (odd) unsure(`${sortQ(odd.text)} holds a {…} the sorter does not spell out as bash does (quoted or $ parts, or one inside another).`);
  } finally {
    // (a key this part reads, when its bytes leave: shown, onward, a file or a machine not a key's, code it doesn't read)
    if (!ctx.keyShown) ctx.keyShown = sortKeyLeaves(cmd, ctx, c, onward, mark);
    ctx.cmd = was; ctx.inputs = wasIn; ctx.onward = wasOn; sortMerge(r, c);
  }
}

// The programs that can run other code, by name or by handler: a doubt inside one sets unshown (S1).
const SORT_CODERUN = /^(?:n?vim?|view|ex|ed|nano|emacs|joe|micro|awk|gawk|mawk|nawk|sed|find|tar|git|apt|apt-get|aptitude|dpkg|npm|yarn|pnpm|pip|pip3|conda|mamba|micromamba|ssh|scp|rsync|sftp|docker|podman|nerdctl|docker-compose|systemd-run|at|batch|crontab|eval|source|\.|watch|trap|alias|su|doas|pkexec|runuser|sg|sudo|deno|bun|hf|uv|accelerate|torchrun|pytest|taskset|numactl|chrt|strace|ltrace|script|parallel|expect|java|man)$/;
const sortRunsCode = name => SORT_CODERUN.test(name) || SORT_WRAP[name] != null || [sortShell, sortInterp, sortBuild].includes(SORT_HANDLERS[name]);
// A program handed a shell, an interpreter, -c with text, or a script file among its words (strace -f bash x.sh, chroot /
// bash x.sh, parallel bash ::: x.sh, java -jar x.jar): what it runs isn't read (S2).
const SORT_CODE_NAMES = /^(?:ba|da|z|k|mk|fi|a)?sh$|^(?:python|pypy|perl|ruby|php|lua|luajit|node|nodejs|tclsh|deno|bun|java|Rscript|julia|pwsh|expect)[\d.]*$/;
function sortHandedCode(name, args, r) {
  const hit = args.find((a, i) => !a.unknown && (SORT_CODE_NAMES.test(a.text.split('/').pop()) || /\.(?:sh|bash|py|pyc|js|mjs|cjs|ts|pl|rb|lua|php|jar|exp|tcl|R|jl)$/.test(a.text) || (/^(?:-c|--command)$/.test(a.text) && args[i + 1])));
  if (hit) sortUnshown(r, `what ${name} runs (it is handed ${sortQ(hit.text)}), which the sorter does not read`);
}
// Code runs: a script file, a one-liner, a build. A change; asked when an earlier part of this command fetched from the
// network, when any word of the command that runs it names a file this same command wrote (its text was never
// sorted) or holds an address (what it fetches is never shown), when it runs from a folder this command wrote into
// (make alone, a one-liner that imports from where it starts), when a word names a folder it wrote into (pip install
// /tmp/p, node /tmp/p), or as root.
const sortWroteIn = (d, ctx) => [...ctx.written].some(p => p.startsWith(d === '/' ? '/' : `${d}/`)) || [...ctx.under].some(u => d === u || d.startsWith(`${u}/`) || u.startsWith(`${d}/`))
  || (ctx.before.length > 0 && ((ctx.steps += Math.ceil(ctx.before.length / 64)) > SORT_STEPS ? sortBound('It names more places than the sorter reads against what the task wrote before.')
    : ctx.before.some(b => b.startsWith(d === '/' ? '/' : `${d}/`)) || [d, ...sortUp(d)].some(a => ctx.beforePlain.has(a)) || ctx.beforeGlob.some(b => sortBefore(b, d, ctx))));
function sortRuns(file, ctx, r, why, dir = null) {
  r.simple = false;
  ctx.unread = true;
  if (file && /[\x00-\x1f\x7f]/.test(file)) unsure('It runs a file with a line break or a control sign in its name.');
  if (file) { r.scripts.push(file); sortUnshown(r, `the file ${file}`, true); }
  raise(r, 'change', why);
  // (a file to run named by a pattern or a {…}, or a shell's input by one: what it names can't be matched to what was written)
  if ((file && /[*?[]|\{[^{}]*(?:,|\.\.)[^{}]*\}/.test(file)) || (ctx.inputs ?? []).some(w => w.glob || w.brace)) unsure(`${why} It names the file it runs by a pattern or a {…}.`);
  if (ctx.fetched || ctx.piped) raise(r, 'risky', `${why} This command fetched from the network before it: code fetched and run is always asked.`);
  if (file && !/^<\(/.test(file) && sortPaths(file, ctx).some(p => sortWrote(p, ctx) || sortWroteIn(p, ctx))) raise(r, 'risky', `${why} It runs a file this same command wrote, whose text the sorter never read.`);
  for (const w of ctx.cmd ?? []) {
    if (w.unknown) continue;
    if (w.text.includes('://')) raise(r, 'risky', `${why} It is handed an address, ${sortQ(w.text)}: what code there does is never shown.`);
    else if (sortCandsOf(w, w.text).some(c => sortPaths(c, ctx).some(p => sortWrote(p, ctx) || sortWroteIn(p, ctx)))) raise(r, 'risky', `${why} Its word ${sortQ(w.text)} names a file this same command wrote, or a folder it wrote into, whose text the sorter never read.`);
  }
  if (dir?.unknown) unsure('It runs code in a folder named by a $ or a command.');
  if (!file) for (const d of dir ? sortPaths(dir.text, ctx) : ctx.cwds) if (d != null && sortWroteIn(d, ctx)) raise(r, 'risky', `${why} It runs from ${sortQ(d)}, where this same command wrote first.`);
  if (ctx.root) raise(r, 'risky', `${why} As root, a script or a one-liner is always asked.`);
}
// What a timer or a schedule runs later (systemd-run, at, crontab, a schedule or a unit written), sorted into c: when it
// is the lock-out class it is lasting too, since it runs after the net has kept or put back (the final read `net`, 13).
// later: what it starts runs outside the button and the net, whatever it is (root refuses it, A-16).
function sortLater(c, ctx, r, via) {
  sortMerge(r, c);
  r.later ??= `${via} starts work later, by itself, outside this command and the net`;
  raise(r, 'risky', `${sortQ(via)}: a job or a unit that runs by itself, outside the wall.`);
  if (/^(?:lockout|notdone)$/.test(c.class)) { raise(r, 'lockout', `${sortQ(via)} starts a change to a way in later, by itself: ${c.why}`); r.lasting ??= `${via} starts a change to a way in later, by itself, after the net has kept or put it back: the net can’t put that back.`; }
}
// …when what it runs is text among the command's words or on its input: each word read for a way-in program it names
// (a way-in file it names is the lock-out class already, and one the net puts back).
function sortLaterWords(ctx, r, via, x = {}) {
  const c = sortFresh(), text = [...ctx.words.map(w => w.text), typeof x?.stdin === 'string' ? x.stdin : ''].join('\n');
  for (const s of text.length <= SORT_MAX * 2 ? text.split(/[\s;&|()<>`'"=,{}]+/) : []) {
    const b = s.split('/').pop(), g = SORT_PROGS[b];
    if (g?.cls === 'lockout' || g?.cls === 'notdone' || SORT_LOCK_HANDLERS.has(b)) raise(c, g?.cls === 'notdone' ? 'notdone' : 'lockout', `it names ${sortQ(b)}, a program that changes a way in.`);
  }
  sortLater(c, ctx, r, via);
}
const sortGone = (ctx, r, why) => { ctx.kinds.add('delete'); raise(r, 'risky', `${why} That cannot be put back.`); };
const sortOpen = (ctx, r, why) => { r.open = !ctx.root; raise(r, 'risky', why); };
// A command handed over as text (bash -c, eval, watch, ssh): read and sorted like the rest.
function sortInline(text, ctx, r, via) {
  // (a command run by another is never one simple program, even when what it runs is a doubt: no kind covers it, S-5)
  r.simple = false;
  if (ctx.depth >= SORT_DEPTH) sortBound(`It nests commands in commands more than ${SORT_DEPTH} deep.`);
  const c = sortFresh();
  ctx.depth++;
  try { sortKeep(ctx, () => sortList(sortRead(text), ctx, c, false, true, ctx.onward)); } finally { ctx.depth--; sortMerge(r, c); }
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
  if (w0.unknown || w0.glob || w0.brace) sortUnshown(r, 'a program a $, a pattern or a {…} names'), unsure(`The program it runs comes from ${w0.unknown ? 'a $ or a command' : 'a * or {…}'}, so the sorter can't know what runs.`);
  if (++ctx.wraps > SORT_WRAPS || ++ctx.steps > SORT_STEPS) sortBound('It wraps commands in commands more than the sorter reads.');
  const gitTouch = ctx.gitTouch;
  ctx.gitTouch = false;
  ctx.programs.add(w0);

  for (const a of args) if (!a.unknown) for (const t of [a.text, /=(.+)$/.exec(a.text)?.[1], /@([~/].*)$/.exec(a.text)?.[1], /^file:\/\/(\/.*)$/.exec(a.text)?.[1]].filter(Boolean)) ctx.seen.push(t, ...[...ctx.cwds].filter(d => d && !/^[~/]/.test(t)).map(d => `${d}/${t}`));
  try {
    // (via: the path it is run by, or, for python -m pip, the interpreter's: where an install lands, R64)
    let name = w0.text, via = x.module ? x.via ?? null : null;
    if (name.includes('/')) {
      // A file it runs; and, when its last part names a program the sorter knows, that program too.
      const p = sortPaths(name, ctx)[0], base = p.slice(p.lastIndexOf('/') + 1);
      // (an init script is its service: /etc/init.d/ssh stop is service ssh stop)
      if (/^\/etc\/(?:init\.d|rc[0-6S]?\.d)\/[^/]+$/.test(p)) return sortProgram([{ ...w0, text: 'service' }, { ...w0, text: base.replace(/^[SK]\d\d/, '') }, ...args], ctx, r, x);
      via = p;
      if (!/^\/(?:usr\/)?(?:local\/)?s?bin\/[^/]+$/.test(p)) { sortNames(p, ctx, r); sortRuns(name, ctx, r, `It runs the file ${sortQ(name)}.`); if (!sortKnown(base.replace(/^(mkfs|fsck)\.\w+$/, '$1'))) return; }
      name = base;
    }
    if (/^(?:mkfs|fsck)\.\w+$/.test(name)) name = name.split('.')[0];
    // (an interpreter or a shell by its real name, python3.12, pypy3, lua5.4, node22: its plain form, S2)
    if (!sortKnown(name)) { const m = /^(python|pypy|perl|ruby|php|lua|luajit|node|nodejs|tclsh|bash|zsh|ksh)(\d[\d.]*)$/.exec(name); if (m) name = m[1] === 'pypy' ? 'python' : m[1]; }
    // (the first program it resolves: a simple command's tool, for a go-ahead's kind, 21-ahead.mjs)
    ctx.program ??= name;
    const h = SORT_HANDLERS[name] ?? (SORT_WRAP[name] && sortWrap), reads = SORT_READS[name], file = SORT_FILES[name], g = SORT_PROGS[name];
    sortInstall(name, args, ctx, via);
    // (a program it doesn't know: said by name, so an ask can say what the sorter doesn't check; what it is handed by find
    // -exec or xargs as its own name, {}, is code from the file system)
    // (one it doesn't know, or one of the system's that enters another place, handed a shell, an interpreter or a file to
    // run, runs code the sorter doesn't read; one it doesn't know reads what it is handed, and where that goes isn't
    // known: a key among it leaves, S2, K2)
    if (!sortKnown(name) || ['lockout', 'risky', 'open'].includes(g?.cls) && !h) sortHandedCode(name, args, r);
    if (!sortKnown(name)) { ctx.srcs.push(...args.filter((a, i) => !a.unknown && !/^-/.test(a.text) && !/^(?:-o|--output|-out|--out|-O)$/.test(args[i - 1]?.text ?? '')).map(a => a.text)); ctx.outs.push('a program the sorter does not know'); }
    if (/^(?:nc|ncat|netcat|socat|telnet)$/.test(name)) ctx.outs.push('another machine');
    if (!sortKnown(name)) { ctx.unknownProgram ??= name.replace(/[^\w.+@-]/g, '').slice(0, 60) || null; if (x.unknownArgs && /^\{\}$/.test(name)) sortUnshown(r, 'a program find or xargs names from what it finds'); unsure(`The sorter doesn't know the program ${sortQ(name)}.`); }
    if (args.length === 1 && /^--(?:version|help)$/.test(args[0].text)) return;
    // Words it reads from its input (after xargs, in find -exec): only a plain reader stays as it was.
    if (x.unknownArgs && reads !== '') { if (file === 'del') ctx.kinds.add('delete'); raise(r, 'risky', `${sortQ(name)} gets words it reads from its input, which the sorter can't see.`); }
    // (a shell, an interpreter, an editor or a build handed its file by words from its input: what it runs isn't shown)
    if (x.unknownArgs && sortRunsCode(name)) sortUnshown(r, `a file ${name} is handed by words from its input`);
    if (g?.cls === 'risky' && /^(?:npx|pnpx|bunx|uvx)$/.test(name)) sortUnshown(r, `the package ${name} downloads and runs`);
    // (a program whose worst the net can't put back, handed its words by its input: sorted by that worst)
    if (x.unknownArgs && /^(?:userdel|deluser|apt|apt-get|aptitude|dpkg|snap)$/.test(name)) { raise(r, 'lockout', `${sortQ(name)} gets words it reads from its input, which may change a way in.`); r.lasting ??= `${name} gets words the sorter can’t read, which may remove a user’s home or a package the ways in depend on: the net can’t put those back.`; }
    let own = args.length;
    // (a doubt inside a program that runs other code: what it runs isn't read whole, S1)
    try {
    if (h) { const n = h(args, ctx, r, { ...x, via, module: false }, name); if (typeof n === 'number' && n >= 0) own = n; }
    else if (reads != null) sortReads(name, reads, args, ctx, r);
    else if (file != null) sortFile(name, file, args, ctx, r, x);
    else if (g.cls === 'open') sortOpen(ctx, r, `${sortQ(name)} ${g.why}, which the run wall hides.`);
    else if (g.cls === 'device') raise(r, 'change', `${sortQ(name)} needs ${g.why}, which a look’s wall hides, so it runs as a change.`);
    else if (g.cls === 'delete') sortGone(ctx, r, `${sortQ(name)} works on ${g.why}.`);
    else if (g.cls === 'lockout' && SORT_LOCK_READS[name]?.(args.map(a => a.text))) raise(r, 'change', `${sortQ(name)} here only reads the network or firewall settings, which a look’s wall hides.`);
    else raise(r, g.cls, `${sortQ(name)}: ${g.why}.`);
    // (after what it does, so the more dangerous answer stands; a handler that runs another program reads its own words)
    // (words a handler read itself as safe, apt's one -o form, are not options for this check)
    const so = SORT_OPTS[name] && sortOpts(SORT_OPTS[name], args.slice(0, own).filter(w => !w.optOk), SORT_MODES[name]), u = so?.unknown;
    // (a {…} that makes an option word: what the program gets is not the words the sorter read; after what it does)
    for (const a of args.slice(0, own)) if (a.brace && sortBraces(a.text).some(t => t.startsWith('-'))) unsure(`A {…} makes ${sortQ(a.text)} into option words, which the sorter does not read as the program would.`);
    // (a file an option names to write, and a folder it writes names of its own into, from the same table)
    for (const w of so?.writes ?? []) { raise(r, 'change', `${sortQ(name)} writes ${sortQ(w.text)}.`); r.deletes = true; sortTouch(w, ctx, r); }
    for (const w of so?.dirs ?? []) { raise(r, 'change', `${sortQ(name)} writes into ${sortQ(w.text)}.`); sortInto(w, ctx, r); }
    if (u) unsure(`The sorter doesn’t know ${sortQ(name)}’s option ${sortQ(u)}: an option it doesn’t read could take the next word, write a file or run a program.`);
    } catch (e) { if (e instanceof SortDoubt && sortRunsCode(name)) sortUnshown(r, `what ${name} runs, which the sorter could not read whole`); throw e; }
    if (ctx.root && r.class !== 'look' && SORT_ROOT_OPTS[name] && args.some(a => a.text.startsWith('-') && !SORT_ROOT_OPTS[name].test(a.text))) raise(r, 'risky', `As root, ${sortQ(name)} with an option the sorter doesn't know as safe is asked.`);
  } finally { ctx.wraps--; ctx.gitTouch = gitTouch; }
}
// A program that only reads, unless a flag in its list (a long one also by the letters that begin it) or more plain
// words than #n makes it write or run something; then it is a change, and the files it names are checked. A flag
// marked ! runs the program it is given (rg --pre, sort --compress-program).
function sortReads(name, spec, args, ctx, r) {
  const bad = spec.split(' ').filter(Boolean), most = Number(/#(\d)/.exec(spec)?.[1] ?? Infinity);
  // (what it reads goes where its output goes)
  ctx.srcs.push(...args.filter(a => !a.unknown && !a.text.startsWith('-')).map(a => a.text));
  if (bad.length && args.some(a => a.unknown || a.glob || a.brace)) unsure(`A $, * or {…} among ${sortQ(name)}’s words could become a flag that writes, so the sorter can't know what it does.`);
  const is = (t, b) => (b.startsWith('--') ? t.length > 2 && t.startsWith('--') && b.startsWith(t.split('=')[0]) : /^-[^-]/.test(b) && /^-[^-]/.test(t) && t.includes(b[1]));
  const hit = args.map(a => a.text).find(t => bad.some(b => is(t, b.replace(/^!/, ''))));
  if (!hit && args.filter(a => !a.text.startsWith('-')).length <= most) return;
  raise(r, 'change', `${sortQ(name)} ${hit ? sortQ(hit) : 'with that many files'} writes or runs something, so it is a change, not a look.`);
  // (what it writes there, sort -o, uniq's second file, xxd -r's, replaces what was in it)
  r.deletes = true;
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
  if (/del|over/.test(kind) || /^(?:zip|c?split)$/.test(name)) r.deletes = true;
  if (kind === 'del' && plain.some(a => a.unknown || a.glob || a.brace)) sortGone(ctx, r, `${sortQ(name)} removes files it doesn't name (a $, a * or a {…}).`);
  const mode = name === 'chmod' ? plain[0]?.text : name === 'install' ? o.all('m', 'mode').at(-1)?.text : null;
  if (mode && mode.split(',').some(sortSetuid)) raise(r, 'risky', `${sortQ(name)} sets a set-user-id or set-group-id bit: such a program runs as its owner, root by another name.`);
  // (a mode or an owner first is no path; an empty file or folder made new holds nothing that runs)
  const files = /^(?:chmod|chown|chgrp|chattr)$/.test(name) ? plain.slice(1) : plain, writes = kind === 'over' || (kind === '' && !/^(?:mkdir|touch|mkfifo|mktemp)$/.test(name));
  // (split and csplit read their input and write a prefix and a suffix they count: every name it can make)
  // (zip adds .zip to an archive name with none)
  if (name === 'zip' && plain[0] && !/\.[^/]*$/.test(plain[0].text)) sortTouch({ ...plain[0], text: `${plain[0].text}.zip` }, ctx, r);
  if (/^c?split$/.test(name)) { const pre = name === 'split' ? plain[1] ?? { text: 'x', subs: [] } : o.all('f', 'prefix').at(-1) ?? { text: 'xx', subs: [] }; return sortTouch({ ...pre, text: `${pre.text}*`, glob: true }, ctx, r); }
  const t = o.all('t', 'target-directory').at(-1), dir = /^(?:cp|mv|install|ln)$/.test(name) ? t ?? (files.length > 1 ? files.at(-1) : null) : null;
  const into = /^(?:cp|install)$/.test(name) && o.has('r', 'R', 'a', 'recursive', 'archive') ? dir : null;
  // (a backup is the name it replaces with a suffix, ~ unless -S says; --parents keeps the source's whole path)
  const bk = /^(?:cp|mv|install|ln)$/.test(name) && o.has('b', 'backup', 'S', 'suffix') ? o.all('S', 'suffix').at(-1)?.text ?? '~' : null;
  const to = (w, text) => { const x = { ...w, text, glob: w.glob || !!dir?.glob, unknown: w.unknown || !!dir?.unknown, tilde: dir?.tilde ?? w.tilde }; sortTouch(x, ctx, r, false); if (bk != null) sortTouch({ ...x, text: text + bk }, ctx, r, false); };
  for (const a of files) {
    if (a === dir) continue;
    const src = !!dir, at = dir?.text.replace(/\/+$/, '');
    // (a copy's source, and what zip packs, are only read: not cp's links, nor zip -m, which moves them in)
    const read = (src && /^(?:cp|install)$/.test(name) && !o.has('l', 's', 'link', 'symbolic-link')) || (name === 'zip' && a !== plain[0] && !o.has('m', 'move'));
    // (a copy's, move's or link's source, and what zip packs: their bytes go where it writes; a removal or a move away
    // leaves no work behind, nor does an empty file or a mode)
    if ((src && /^(?:cp|install|ln|mv)$/.test(name)) || (name === 'zip' && a !== plain[0] && !(args.findIndex(w => /^-[xi]$|^--(?:exclude|include)$/.test(w.text)) >= 0 && args.indexOf(a) > args.findIndex(w => /^-[xi]$|^--(?:exclude|include)$/.test(w.text))))) ctx.srcs.push(a.text);
    Object.assign(ctx, { removing: kind === 'del' || (name === 'mv' && src), noContent: kind === 'wide' || /^(?:touch|mkdir|mkfifo|mktemp)$/.test(name) });
    try { sortTouch(a, ctx, r, kind === 'wide' || (kind === 'del' && rec) || (name === 'mv' && src) || (name === 'ln' && src), writes, read); } finally { Object.assign(ctx, { removing: false, noContent: false }); }
    if (src) to(a, `${at}/${a.text.replace(/\/+$/, '').split('/').pop()}`);
    if (src && o.has('parents')) to(a, `${at}/${a.text.replace(/^\/+/, '')}`);
  }
  // (install -d, and mkdir with a mode, set the mode of each folder they name: a folder above a way in reaches it)
  if ((name === 'install' && o.has('d', 'directory')) || (/^(?:mkdir|mkfifo)$/.test(name) && o.has('m', 'mode'))) { for (const a of files) sortTouch(a, ctx, r, true, false); return; }
  // (a folder it copies into, surely one: what lands is judged by the name under it, sortKeyLeaves)
  if (dir && !dir.unknown && (/\/$/.test(dir.text) || t || files.length > 2)) ctx.intoDirs.push(...sortPaths(dir.text.replace(/\/+$/, '') || '/', ctx));
  if (dir) { sortTouch(dir, ctx, r, dir === into, true); if (bk != null) sortTouch({ ...dir, text: dir.text.replace(/\/+$/, '') + bk }, ctx, r, false); }
}

// A key carried out (the second checker, cmd-refused): a command that names a key and writes a place that isn't itself a
// key's (a copy, a move, an archive, a link, a redirection, dd, tee), or sends one to another machine (a word of the key
// beside an address: not ssh's -i or IdentityFile, which use it), puts the key where a look shows it back. The place, or
// null. A move or copy to another key's name (.env.example to .env, id_x to ~/.ssh/id_x.old) and chmod stay asked.
// A key one part of the command reads as the source of its bytes (what a reader, a copy, a move, a link, an archive, dd,
// tee, a redirection, an upload, git add or docker cp reads: not an address, an option that uses or leaves out the file,
// ssh's -i), and where those bytes go: shown (a look), on to another program or a $( ), a file or another machine that
// isn't a key's place (a name a look refuses: KEY_NOT's *.pub and ssh's config are not), or code it doesn't read. For a
// copy into a folder, the name it lands under. Null, or { key, where } (F1 item 3; K1 to K3).
function sortKeyLeaves(cmd, ctx, c, onward, mark) {
  const key = w => { for (const p of [w, ...(/^[~/]/.test(w) ? [] : [...ctx.cwds].filter(Boolean).map(d => `${d}/${w}`))]) if (keyWord(p)) return p; return null; };
  const srcs = ctx.srcs.slice(mark.srcs), keys = srcs.map(key).filter(Boolean);
  if (!keys.length) return null;
  const wrote = [...ctx.wrote].filter(p => !mark.wrote.has(p) && !srcs.includes(p) && !/^\/dev\/(?:null|stdout|stderr)$/.test(p));
  const dest = wrote.find(p => !keyWord(p) && !keys.includes(p) && !ctx.intoDirs.includes(p));
  // (sent to another machine, unless each key lands under a key's name there: the one name given, or its own in a folder)
  const far = ctx.farDests.slice(mark.far), landed = k => (far.length === 1 ? far[0] : far.find(p => p.endsWith(`/${k.replace(/\/+$/, '').split('/').pop()}`)));
  const sent = ctx.reach.size > mark.reach && !(far.length && keys.every(k => { const p = landed(k); return p != null && keyWord(p); }));
  const where = c.class === 'look' ? 'what it shows' : onward ? 'the next program, or the words of another' : ctx.outs.slice(mark.outs)[0] ?? dest ?? (sortPartOut(cmd) ? 'a file' : null)
    ?? (sent ? 'another machine' : null) ?? (c.unshown ? 'code the sorter does not read' : null);
  return where ? { key: keys[0], where } : null;
}
const sortPartOut = cmd => cmd.redirs.some(d => /^(?:>|>>|>\||&>|&>>)$/.test(d.op) && (d.fd == null || d.fd === '1') && (d.w.unknown || (!keyWord(d.w.text) && d.w.text !== '/dev/null')));
// After the parts: on Spark 2 a change is risky; as root, more than one plain program is risky (design A 2.7, 2.8).
function sortAt(r, ctx) {
  if (ctx.at === 'hub' && r.class === 'change') raise(r, 'risky', 'It changes Spark 2, which runs the console and the brain: anything that changes Spark 2 is asked first.');
  if (ctx.root && r.class === 'change' && !r.simple) raise(r, 'risky', 'As root, only a plain command (one program, with no chaining, redirection or wrapper) runs at once: this one is asked.');
}
function sortCommand(command, opts) {
  const r = sortFresh(), ctx = { at: 'compute', root: false, hosts: Object.create(null), brain: [], home: null, depth: 0, cwds: new Set(), fetched: false, fetchSeen: false, piped: false,
    seen: [], kinds: new Set(), words: [], programs: new Set(), written: new Set(), under: new Set(), before: [], beforePlain: new Set(), beforeGlob: [], cloned: new Set(), touched: new Set(), sets: new Set(), readOnly: new Set(), wrote: new Set(), installs: new Set(), reach: new Set(), setTo: new Map(), changes: new Map(), cmd: [], steps: 0, wraps: 0, srcs: [], outs: [], farDests: [], intoDirs: [] };
  let text = '', form = null;
  try {
    const o = opts && typeof opts === 'object' ? opts : {};
    text = String(command ?? '');
    for (const [k, v] of Object.entries(o.hosts && typeof o.hosts === 'object' ? o.hosts : {})) ctx.hosts[k] = v === 'compute' ? 'compute' : 'hub';
    sortHubNames(ctx);
    Object.assign(ctx, { at: o.at ?? 'compute', root: !!o.root, brain: (Array.isArray(o.brain) ? o.brain : []).filter(b => typeof b === 'string' && b.length > 2) });
    // (the protected containers' name patterns, * for anything: given, or the console's own list, CONFIG.protect)
    ctx.protect = (Array.isArray(o.protect) ? o.protect : typeof CONFIG === 'object' && Array.isArray(CONFIG?.protect) ? CONFIG.protect : []).filter(g => typeof g === 'string' && g && g.length <= 200).slice(0, 64);
    // (the owner's home on that Spark: given, or the configured user's; a path is placed against it alone)
    const home = o.home != null ? String(o.home).replace(/\/+$/, '') : typeof CONFIG === 'object' && /^[a-z_][a-z0-9_-]*$/i.test(String(CONFIG?.user)) ? `/home/${CONFIG.user}` : null;
    if (home != null && (!/^(?:\/[\w.@+-]+)+$/.test(home) || /\/\.\.?(?:\/|$)/.test(home))) unsure('The owner’s home is not one the sorter can place.');
    ctx.home = home;
    // (what earlier commands of the task wrote or fetched, as placed lists them: counted as written by this one)
    if (o.written != null && (!Array.isArray(o.written) || o.written.length > SORT_PLACED * 4)) unsure('The paths written before are not a list the sorter reads.');
    for (const b of o.written ?? []) {
      if (typeof b !== 'string' || !/^(?:~(?:\/|$)|\/)/.test(b) || /[\x00-\x1f\x7f]/.test(b) || b.length > SORT_PATH) unsure('A path written before is not one the sorter can place.');
      ctx.before.push(sortNorm(b, null, home));
    }
    ctx.beforePlain = new Set(ctx.before.filter(b => !/[*?[]/.test(b)));
    ctx.beforeGlob = ctx.before.filter(b => /[*?[]/.test(b));
    if (ctx.at !== 'compute' && ctx.at !== 'hub') { ctx.at = 'hub'; unsure('Where it runs is not one the sorter knows.'); }
    const dir = o.dir == null ? '~' : String(o.dir);
    if (/[$`\\\x00-\x1f\x7f]|^~[^/]|(?:^|\/)proc(?:\/|$)/.test(dir)) unsure('The folder it starts in is not one the sorter can place.');
    ctx.cwds.add(sortNorm(dir.replace(/^(?![~/])/, '~/'), null, ctx.home));
    if (!text.trim()) unsure('The command is empty.');
    if (text.length > SORT_MAX) sortBound(`It is ${text.length} characters long, past the ${SORT_MAX} the sorter reads whole.`);
    // (a for loop over plain names, the whole command, is its body once for each name: a script it runs is then named,
    // and pinned; any other loop the reader refuses, and is unreadable; item 4 of F1's round)
    const loop = text.length <= 2000 && /^\s*for\s/.test(text) && /\bdone\s*$/.test(text) && /^\s*for\s+([A-Za-z_]\w*)\s+in\s+([\w./~@+-]+(?:[ \t]+[\w./~@+-]+){0,15})[ \t]*(?:;|\n)\s*do\s+([^]*?)\s*;?\s*done\s*$/.exec(text);
    if (loop && !/\b(?:for|while|until|if|case|function|do|done)\b/.test(loop[3])) {
      const v = new RegExp(`"?\\$(?:\\{${loop[1]}\\}|${loop[1]}(?!\\w))"?`, 'g');
      text = loop[2].split(/[ \t]+/).map(i => loop[3].replace(v, () => i)).join('; ');
    }
    const hidden = UNSEEN.exec(text.replace(/[\t\n]/g, ''));
    if (hidden) raise(r, 'notdone', `It holds a sign that doesn’t show (U+${hidden[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}): what is shown would not be what runs.`);
    else {
      const odd = /[^\t\n\x20-\x7e]/u.exec(text);
      // (asked, said, and the command still read: a sign in a comment or a quoted word hides no part, F1)
      if (odd) raise(r, 'risky', `It holds the sign U+${odd[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}, which isn’t plain ASCII: such a sign can look like ; | > or a quote and not be one.`);
      form = lookForm(text);
      if (form) r.why = 'It is one of the exact forms a look runs as code’s own text.';
      else { const items = sortRead(text); sortList(items, ctx, r, false, true); ctx.shape = sortShape(items, ctx); }
      if (r.class !== 'look') sortSee(ctx.words, ctx, r);
    }
  } catch (e) {
    raise(r, 'risky', e instanceof SortDoubt ? e.message : 'The sorter could not read this command.');
    // (what stops the whole read: the reader can't split it, a bound, where it runs or starts; F1)
    r.unreadable ??= e instanceof SortDoubt ? e.message : 'The sorter could not read this command.';
    sortUnshown(r, 'the command, which the sorter could not read');
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
      if (ctx.keyShown) raise(r, 'notdone', ctx.keyShown.where === 'what it shows' ? `It would show ${sortQ(ctx.keyShown.key)}, which is a key or holds one: a key is never shown back.`
        : `It would put ${sortQ(ctx.keyShown.key)}, which is a key or holds one, where it can be shown back (${sortQ(ctx.keyShown.where)}): a key is never shown back.`);
      if (key && r.class === 'look') raise(r, 'notdone', `It would show ${sortQ(key)}, which is a key or holds one: a key is never shown back.`);
      else if (key) sortOpen(ctx, r, `It names ${sortQ(key)}, key material the run wall hides, so it would run outside the wall.`);
      // (the plain shape, R64: a change not of it is asked, a look only for a {…}; stronger answers stand)
      if (ctx.shape && (r.class === 'change' || (r.class === 'look' && ctx.shape.brace))) raise(r, 'risky', ctx.shape.why);
    }
    sortAt(r, ctx);
  } catch { raise(r, 'risky', 'The sorter could not read this command.'); }
  if (r.class === 'lockout') ctx.kinds.add('lockout');
  if (ctx.root) ctx.kinds.add('root');
  const kinds = r.class === 'look' ? [] : ['root', 'lockout', 'delete', 'brain'].filter(k => ctx.kinds.has(k)), plain = p => !/[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(p);
  const why = r.why.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]+/g, ' ').slice(0, 400), changes = [...ctx.changes].filter(([p]) => plain(p));
  let uses = { reads: [], installs: [], reach: [] };
  try { uses = sortUses(ctx, r, text, form); uses.reads = uses.reads.filter(plain); } catch { /* the fields add, never decide */ }
  return { class: r.class, why, kinds, form, simple: r.simple, program: r.simple && typeof ctx.program === 'string' ? ctx.program : null, open: r.open, deletes: r.deletes, scripts: [...new Set(r.scripts)].filter(plain).map(s => s.slice(0, 400)), answer: r.answer, lasting: r.lasting,
    unshown: (r.class === 'look' && !ctx.root) || r.unshown == null ? null : r.unshown.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]+/g, ' '),
    // (each piece of unseen code that no script's hash can pin: a module, a build, a pipe into a shell, a one-liner…)
    unpinnable: (r.class === 'look' && !ctx.root) ? [] : [...new Set(r.unpinnable)].slice(0, 16).map(u => u.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]+/g, ' ')),
    // (work it starts later, outside the button and the net; a program the sorter doesn't know, by name)
    later: r.class === 'look' || r.later == null ? null : r.later.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]+/g, ' '),
    unknownProgram: r.class === 'look' || typeof ctx.unknownProgram !== 'string' ? null : ctx.unknownProgram,
    // (a part of the command the sorter could not read at all, in its own words, F1)
    unreadable: r.unreadable == null ? null : String(r.unreadable).replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]+/g, ' ').slice(0, 300),
    placed: changes.filter(([, w]) => !w).map(([p]) => p), wide: changes.filter(([, w]) => w).map(([p]) => p), ...uses,
    // (with deletes: the places whose old content it removes or writes over, placed less what it only reads, and wide)
    overwrites: r.deletes ? changes.filter(([p, w]) => w || !uses.reads.includes(p)).map(([p]) => p) : [] };
}
