/* ───────── the sorter: what one command on a Spark is (design A 2.8) ───────── */
// Area: safety        Rules: R42        Tests: sort.test.mjs
// Owns: none
// Timers: none        Wakes: none
// sortCommand(command, {at, root, dir, hosts, brain}) says what one command for run is before anything runs, from its
// text and where it runs alone: no model call, no file read. Five classes, in their order of danger (when two could
// apply, the later wins): look (only reads: at once), change (design A 2.5's ladder), risky (always asked), lockout
// (asked, and inside the net), notdone (never, and not for want of a yes). The rule of doubt: what it can't read whole
// or doesn't know (an unknown program, a loop, a $ where a program or a path goes, a sign that isn't plain ASCII) is
// risky: never a look, never at once. A look keeps run's own checks (21-work.mjs: lookForm's exact forms, no sudo or
// key word by lookWords and keyWord), and every program in it only reads, with no flag that writes, no redirection but
// to /dev/null, no here-document. How it fits the walls once step A7c wires it into run (dark until then: run sends
// every command to the look wall): a look runs in the look wall, so a wrong "look" still can't write or send; anything
// else goes to the run wall with the copy first, to an ask, or nowhere. So the mistake that matters is a "change", run
// at once, that should have been risky, lockout or notdone: that is where its tests aim, and a change that merely
// names a way in (even to read it) is lockout.
// at: 'compute' or 'hub' (Spark 2: any change there is risky). root: the typed root (a look stays a look; a script, a
// one-liner or more than one program as root is risky). dir: where it starts (~). hosts: the fleet's names and
// addresses → 'compute' or 'hub' (a command over ssh is sorted as one there; any other host is risky). brain: the brain's
// container and model names (a change that names one is risky, kind brain).
// The result: class; why (plain words for the owner); kinds (design A 2.14's dangerous asks it raises: root, lockout,
// delete, brain); form (run's exact form); simple (one program, no chaining, redirection or wrapper: only that may have
// an "always" kind); open (it needs what the run wall hides); deletes (it removes or overwrites a named file: risky
// unless every one is copied first, A7b); scripts (files it runs, to hash for the ask); answer ('set root' for sudo or
// su, 'owner command' for the root helper or its line); lasting (a lock-out change the net can't put back).
const SORT_ORDER = ['look', 'change', 'risky', 'lockout', 'notdone'], SORT_MAX = 16384, SORT_DEPTH = 4;
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

// Paths, as ~/… (any home: the owner's, root's) or /…; a relative one from each folder a cd may have left it in.
function sortNorm(p) {
  const out = [];
  for (const s of p.replace(/^~(?=\/|$)/, '/home/~').split('/').slice(1)) { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s); }
  return `/${out.join('/')}`.replace(/^\/home\/[^/]+(?=\/|$)|^\/root(?=\/|$)/, '~');
}
const sortPaths = (c, ctx) => (/^[~/]/.test(c) ? [sortNorm(c)] : [...ctx.cwds].map(d => (d == null ? unsure(`It names ${c} after a cd the sorter can't follow.`) : sortNorm(`${d}/${c}`))));
const sortGlob = g => new RegExp(`^${g.split('/').map(s => s.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/^(?=\[\^\/\])/, '(?!\\.)')).join('/')}$`);
const sortUp = q => q.split('/').slice(0, -1).map((_, j, a) => a.slice(0, j + 1).join('/') || '/');
function sortBraces(s) {
  let out = [s];
  for (let round = 0; round < 8; round++) {
    let more = false;
    out = out.flatMap(t => {
      const m = /\{([^{}]*(?:,|\.\.)[^{}]*)\}/.exec(t), n = m && /^(-?\d+|[a-z])\.\.(-?\d+|[a-z])$/i.exec(m[1]);
      if (!m) return [t];
      more = true;
      if (n && /\d/.test(n[1]) && Math.abs(n[2] - n[1]) > 64) unsure('It holds a {a..b} range too long to read.');
      const each = !n ? m[1].split(',') : /\d/.test(n[1]) ? Array.from({ length: Math.abs(n[2] - n[1]) + 1 }, (_, j) => String(Math.min(+n[1], +n[2]) + j)) : [n[1], n[2]];
      return each.map(x => t.slice(0, m.index) + x + t.slice(m.index + m[0].length));
    });
    if (out.length > 64) unsure('It holds {…} that makes too many words to read.');
    if (!more) return out;
  }
  return unsure('It holds {…} nested too deep to read.');
}

// What a path or a name is, past being a file: the lock-out class (design A 2.8's ways in), risky places, the helper.
const LOCK_PATHS = ['/etc/ssh', '/etc/ssh/sshd_config', '~/.ssh', '~/.ssh/authorized_keys', '/etc/sudoers', '/etc/sudoers.d', '/etc/passwd',
  '/etc/passwd-', '/etc/group', '/etc/group-', '/etc/shadow', '/etc/gshadow', '/etc/subuid', '/etc/subgid', '/etc/login.defs', '/etc/pam.d',
  '/etc/security', '/etc/nsswitch.conf', '/etc/profile', '/etc/profile.d', '/etc/bash.bashrc', '/etc/environment', '/etc/zsh',
  '~/.config/environment.d', '/etc/netplan', '/etc/NetworkManager', '/etc/network', '/etc/hosts', '/etc/hostname', '/etc/resolv.conf',
  '/etc/systemd/network', '/etc/systemd/resolved.conf', '/etc/systemd/resolved.conf.d', '/etc/hosts.allow', '/etc/hosts.deny',
  '/etc/iproute2', '/etc/wpa_supplicant', '/etc/ufw', '/etc/default/ufw', '/etc/iptables', '/etc/nftables.conf', '/etc/firewalld',
  '/var/lib/tailscale', '/etc/default/tailscaled', '/var/lib/systemd/linger', '~/.config/spark-console', '/etc/sudo.conf',
  ...'access.json sessions.json passkeys.json agents.json telegram.json api.sock'.split(' ').map(f => `~/.local/state/spark-console/${f}`)];
const LOCK_NAMES = sortWs('authorized_keys authorized_keys2 sshd_config sudoers .ssh .bashrc .bash_profile .bash_login .bash_logout .profile .zshrc .zprofile .zshenv .zlogin .pam_environment');
const WAYS_UNITS = ['ssh', 'sshd', 'tailscaled', 'NetworkManager', 'systemd-networkd', 'systemd-resolved', 'networking', 'ufw', 'nftables',
  'netfilter-persistent', 'firewalld', 'iptables', 'wpa_supplicant', 'systemd-logind', 'dbus', 'spark-console-api', 'spark-console-watchdog'];
const WAYS_FILE = new RegExp(`(?:^|/)(?:${WAYS_UNITS.join('|')})\\.(?:service|socket|timer)(?:\\.d)?(?:/|$)`);
const SIGNIN = /spark-console\/(?:access\.json|sessions\.json|passkeys\.json|agents\.json|telegram\.json|agent-settings\.json)|(?:^|\/)api\.sock$|spark-console-(?:api|watchdog)/;
const RISKY_PATHS = [
  [/^\/dev\/(?:sd|hd|vd|xvd|nvme|mmcblk|md|dm-|loop|mapper|disk)|^\/etc\/(?:fs|crypt)tab$/, 'a disk', true],
  [/^\/(?:boot|lib\/modules|usr\/lib\/modules|lib\/firmware|usr\/lib\/firmware|proc\/sys|sys)(?:\/|$)|^\/proc\/sysrq-trigger$|^\/etc\/(?:default\/grub|modprobe\.d|modules|modules-load\.d|sysctl\.conf|sysctl\.d|initramfs-tools|dkms)(?:\/|$)/, 'the kernel, a driver or firmware'],
  [/^\/etc\/(?:cron|anacrontab)|^\/var\/spool\/(?:cron|at)(?:\/|$)|\.timer$/, 'a schedule, a job that runs by itself'],
  [/^\/(?:etc|var\/lib)\/(?:docker|containerd)(?:\/|$)|(?:^|\/)docker\.sock$/, 'the Docker service and its settings'],
  [/^(?:~\/(?:\.local\/bin|bin|\.gitconfig|\.config\/git|\.npmrc|\.pip|\.config\/pip|\.condarc|\.pypirc)|\/(?:usr\/)?(?:local\/)?s?bin|\/etc\/(?:ld\.so\.preload|ld\.so\.conf|ld\.so\.conf\.d|apt\/sources\.list|apt\/sources\.list\.d|apt\/apt\.conf\.d|pip\.conf|gitconfig))(?:\/|$)/, 'a program on the PATH, or settings later commands load and run', false, true],
];
function sortNames(p, ctx, r) {
  if (/spark-console-root|root-for-sparkie/.test(p)) { r.answer = 'owner command'; raise(r, 'notdone', 'It names the root helper or its sudo line, which only the owner’s one-time command puts in place or changes.'); }
  if (SIGNIN.test(p)) raise(r, 'lockout', `${p} is Spark Console’s own unit or one of its sign-in files, a way in.`);
  else if (/spark-(?:console|portal)/.test(p)) raise(r, 'risky', `It names Spark Console’s own files, state or units (${p}).`);
  for (const b of ctx.brain) if (p.includes(b)) { ctx.kinds.add('brain'); raise(r, 'risky', `It names the brain (${b}): its container, model files or setup.`); }
}
function sortPlace(p, glob, ctx, r, wide, touched = false) {
  sortNames(p, ctx, r);
  const re = glob ? sortGlob(p) : null, base = p.slice(p.lastIndexOf('/') + 1);
  const hits = q => (glob ? re.test(q) || (wide && sortUp(q).some(a => re.test(a))) || q.startsWith(`${p.slice(0, p.search(/[*?[]/)).replace(/\/[^/]*$/, '')}/`) && !/[*?[]/.test(p.slice(0, p.lastIndexOf('/')))
    : p === q || q === '/' || p.startsWith(`${q}/`) || (wide && (q.startsWith(`${p}/`) || p === '/' || (p === '/home' && q.startsWith('~')))));
  if (LOCK_PATHS.some(hits) || WAYS_FILE.test(p) || (glob ? base.replace(/[*?]|\[[^\]]*\]/g, '').length > 2 && [...LOCK_NAMES].some(n => sortGlob(base).test(n)) : LOCK_NAMES.has(base))) raise(r, 'lockout', `It names ${p}, one of the ways in (SSH, users and sudo, shell start files, the network, the firewall, Tailscale, or Spark Console’s sign-in).`);
  for (const [x, what, del, written] of RISKY_PATHS) if ((x.test(p) && (touched || !written)) || (wide && p === '/')) { if (del) ctx.kinds.add('delete'); raise(r, 'risky', `It names ${p}: ${what}.`); }
}
// A word the command changes: each file it can name ({a,b} spelled out, --opt=path and -opath too), wide when the
// command reaches everything under a folder it names (rm -r, chmod -R, mv's sources).
function sortTouch(w, ctx, r, wide = false) {
  if (!w) return;
  if (w.unknown) unsure(`It names a file through a $ or a command (${w.text || '…'}), so the sorter can't know what it changes.`);
  for (const t of sortBraces(w.text)) for (const c of [t, /^-[^=]*=(.+)$/.exec(t)?.[1], /^-\w([~/].*)$/.exec(t)?.[1], /^[\w-]*=?@([~/].*)$/.exec(t)?.[1]]) {
    if (c && !(c.startsWith('-') && c === t)) for (const p of sortPaths(c, ctx)) sortPlace(p, w.glob, ctx, r, wide, true);
  }
}
// Names in text the words alone don't show (a path inside a one-liner, inside a command over ssh, or in text the sorter
// couldn't read); with progs, programs too.
function sortScan(text, ctx, r, progs) {
  for (const s of text.replace(/\$\{HOME\}|\$HOME\b/g, '~').split(/[\s;&|()<>`'"=,{}]+/)) {
    if (!s) continue;
    const p = s.replace(/^-\w(?=[~/])|^@(?=[~/])/, '');
    if (/^[~/]/.test(p)) sortPlace(sortNorm(p), /[*?[]/.test(p), ctx, r, false); else sortNames(p, ctx, r);
    if (LOCK_NAMES.has(p.split('/').pop())) raise(r, 'lockout', `It names ${p}, one of the ways in.`);
    const g = progs && SORT_PROGS[p];
    if (g) raise(r, { delete: 'risky', open: 'risky', device: 'change' }[g.cls] ?? g.cls, `It names ${p} inside text it runs: ${g.why}.`);
  }
}

// What may come before a program: a name that decides what runs (risky), and one a look may carry.
const DANGER_ENV = /^(?:PATH|LD_\w+|BASH_ENV|ENV|BASH_FUNC_\S+|SHELLOPTS|BASHOPTS|IFS|PS4|PROMPT_COMMAND|CDPATH|GLOBIGNORE|HOME|PYTHON(?!UNBUFFERED$)\w*|PERL\w*|RUBY\w*|NODE_\w+|GIT_\w+|SSH_\w+|DOCKER_\w+|SYSTEMD_\w+|DBUS_\w+|XDG_\w+|SUDO_\w+|TMPDIR|\w*PAGER|EDITOR|VISUAL|LESS\w*|TAR_OPTIONS|GCONV_PATH|HOSTALIASES|RES_OPTIONS|LOCALDOMAIN)$/;
const SAFE_ENV = /^(?:LC_\w+|LANG|LANGUAGE|TZ|TERM|COLUMNS|LINES|NO_COLOR|FORCE_COLOR|CUDA_VISIBLE_DEVICES|OMP_NUM_THREADS|PYTHONUNBUFFERED|DEBIAN_FRONTEND)$/;
function sortAssign(name, ctx, r, prefix) {
  if (DANGER_ENV.test(name)) raise(r, 'risky', `It sets ${name}, which decides what programs run or what they load.`);
  else if (prefix && !SAFE_ENV.test(name)) raise(r, 'change', `It hands ${name} to the program, which may change what it does.`);
}
function sortList(items, ctx, r) {
  if (items.length > 1) r.simple = false;
  for (const pipe of items) {
    if (pipe.length > 1) r.simple = false;
    const was = ctx.piped;
    ctx.piped = false;
    pipe.forEach((cmd, i) => sortCmd(cmd, ctx, r, i > 0));
    ctx.piped = was;
  }
}
function sortCmd(cmd, ctx, r, inPipe) {
  const c = sortFresh(), all = [...cmd.assigns, ...cmd.words, ...cmd.redirs.map(d => d.w)];
  for (const w of all.filter(x => x.subs.length)) {
    c.simple = false;
    const seen = ctx.fetchSeen;
    ctx.fetchSeen = false;
    for (const s of w.subs) sortList(s, ctx, c);
    w.fetches = ctx.fetchSeen;
    ctx.fetchSeen ||= seen;
  }
  if (cmd.group) { c.simple = false; sortList(cmd.group, ctx, c); }
  let stdin = null;
  for (const d of cmd.redirs) {
    c.simple = false;
    if (/^<</.test(d.op)) { raise(c, 'change', 'It hands a program text to read (a here-document).'); stdin = d.op === '<<<' ? (d.w.unknown ? null : d.w.text) : d.body; continue; }
    if (/^[<>]&$/.test(d.op) && /^(?:\d+-?|-)$/.test(d.w.text) && !d.w.unknown) continue;
    if (d.op === '<') { if (!d.w.unknown) ctx.seen.push(d.w.text); continue; }
    if (!d.w.unknown && !d.w.glob && /^\/dev\/(?:null|stdout|stderr|fd\/[12])$/.test(d.w.text)) continue;
    raise(c, 'change', `It writes ${d.w.text || 'a file'} (a redirection).`);
    if (/^(?:>|>\||&>)$/.test(d.op)) c.deletes = true;
    sortTouch(d.w, ctx, c);
  }
  for (const a of cmd.assigns) sortAssign(a.lit.split(/\+?=/)[0], ctx, c, cmd.words.length > 0);
  if (cmd.words.length) sortProgram(cmd.words, ctx, c, { inPipe, stdin });
  if (c.class !== 'look') for (const w of all) sortScan(w.text, ctx, c, false);
  sortMerge(r, c);
}

// Code runs: a script file, a one-liner, a build. A change; asked when it fetched that code from the network in this
// command, or as root (design A 2.8).
function sortRuns(file, ctx, r, why) {
  r.simple = false;
  if (file) r.scripts.push(file);
  raise(r, 'change', why);
  if (ctx.fetched) raise(r, 'risky', `${why} It runs what this command fetched from the network: an installer from an address is always asked.`);
  if (ctx.root) raise(r, 'risky', `${why} As root, a script or a one-liner is always asked.`);
}
const sortGone = (ctx, r, why) => { ctx.kinds.add('delete'); raise(r, 'risky', `${why} That cannot be put back.`); };
const sortOpen = (ctx, r, why) => { r.open = !ctx.root; raise(r, 'risky', why); };
// A command handed over as text (bash -c, eval, watch, ssh): read and sorted like the rest.
function sortInline(text, ctx, r, via) {
  if (ctx.depth >= SORT_DEPTH) unsure(`It nests commands in commands more than ${SORT_DEPTH} deep.`);
  const c = sortFresh();
  ctx.depth++;
  try { sortList(shellParse(shellLex(text).toks), ctx, c); } finally { ctx.depth--; }
  if (ctx.root && c.class !== 'look') raise(c, 'risky', `As root, a ${via} one-liner is always asked.`);
  c.simple = false;
  sortMerge(r, c);
}
function sortProgram(words, ctx, r, x) {
  const [w0, ...args] = words;
  if (w0.unknown || w0.glob || w0.brace) unsure(`The program it runs comes from ${w0.unknown ? 'a $ or a command' : 'a * or {…}'}, so the sorter can't know what runs.`);
  for (const a of args) if (!a.unknown) for (const t of [a.text, /=(.+)$/.exec(a.text)?.[1], /@([~/].*)$/.exec(a.text)?.[1]].filter(Boolean)) ctx.seen.push(t, ...[...ctx.cwds].filter(d => d && !/^[~/]/.test(t)).map(d => `${d}/${t}`));
  let name = w0.text;
  if (name.includes('/')) {
    const p = sortPaths(name, ctx)[0];
    if (!/^\/(?:usr\/)?(?:local\/)?s?bin\/[^/]+$/.test(p)) { sortNames(p, ctx, r); return sortRuns(name, ctx, r, `It runs the file ${name}.`); }
    name = p.slice(p.lastIndexOf('/') + 1);
  }
  if (/^(?:mkfs|fsck)\.\w+$/.test(name)) name = name.split('.')[0];
  const h = SORT_HANDLERS[name] ?? (SORT_WRAP[name] && sortWrap), reads = SORT_READS[name], file = SORT_FILES[name], g = SORT_PROGS[name];
  if (h == null && reads == null && file == null && !g) unsure(`The sorter doesn't know the program ${name}.`);
  if (args.length === 1 && /^(?:--version|--help|-V|version)$/.test(args[0].text)) return;
  if (x.unknownArgs && (file != null || (reads && reads !== ''))) {
    if (file === 'del') ctx.kinds.add('delete');
    return raise(r, 'risky', `${name} gets words it reads from its input, which the sorter can't see.`);
  }
  if (h) return h(args, ctx, r, x, name);
  if (reads != null) return sortReads(name, reads, args, ctx, r);
  if (file != null) return sortFile(name, file, args, ctx, r, x);
  if (g.cls === 'open') return sortOpen(ctx, r, `${name} ${g.why}, which the run wall hides.`);
  if (g.cls === 'device') return raise(r, 'change', `${name} needs ${g.why}, which a look’s wall hides, so it runs as a change.`);
  if (g.cls === 'delete') return sortGone(ctx, r, `${name} works on ${g.why}.`);
  if (g.cls === 'lockout' && SORT_LOCK_READS[name]?.(args.map(a => a.text))) return raise(r, 'change', `${name} here only reads the network or firewall settings, which a look’s wall hides.`);
  raise(r, g.cls, `${name}: ${g.why}.`);
}
// A program that only reads, unless a flag in its list (a long one also by the letters that begin it) or more plain
// words than #n makes it write or run something; then it is a change, and the files it names are checked.
function sortReads(name, spec, args, ctx, r) {
  const bad = spec.split(' ').filter(Boolean), most = Number(/#(\d)/.exec(spec)?.[1] ?? Infinity);
  if (bad.length && args.some(a => a.unknown || a.glob || a.brace)) unsure(`A $, * or {…} among ${name}’s words could become a flag that writes, so the sorter can't know what it does.`);
  const hit = args.map(a => a.text).find(t => bad.some(b => (b.startsWith('--') ? t.length > 2 && t.startsWith('--') && b.startsWith(t.split('=')[0]) : /^-[^-]/.test(b) && /^-[^-]/.test(t) && t.includes(b[1]))));
  if (!hit && args.filter(a => !a.text.startsWith('-')).length <= most) return;
  raise(r, 'change', `${name} ${hit ?? 'with that many files'} writes or runs something, so it is a change, not a look.`);
  for (const a of args) sortTouch(a, ctx, r);
}
// The file tools: del removes what it names (a $, * or {…} there, or words it reads, and what goes isn't named), over may
// replace a file, wide reaches everything under a folder with -R.
function sortFile(name, kind, args, ctx, r) {
  const plain = args.filter(a => a.unknown || !a.text.startsWith('-')), rec = args.some(a => /^-[a-zA-Z]*[rR]|^--recursive$/.test(a.text));
  raise(r, 'change', `${name} changes files.`);
  if (/del|over/.test(kind)) r.deletes = true;
  if (kind === 'del' && plain.some(a => a.unknown || a.glob || a.brace)) sortGone(ctx, r, `${name} removes files it doesn't name (a $, a * or a {…}).`);
  if (name === 'chmod' && args.some(a => /^0?[2-7][0-7]{3}$|^[ugoa]*[-+=][rwxXt]*s/.test(a.text))) raise(r, 'risky', 'chmod sets a set-user-id or set-group-id bit: such a program runs as its owner, root by another name.');
  const into = /^(?:cp|install)$/.test(name) && args.some(a => /^-\w*[rRa]|^--(?:recursive|archive)$/.test(a.text)) ? plain.at(-1) : null;
  for (const a of args) sortTouch(a, ctx, r, (kind === 'del' || kind === 'wide') && rec ? true : (name === 'mv' && a !== plain.at(-1)) || a === into);
}

// Programs that only read: the string lists what makes one write or run something (see sortReads).
const SORT_READS = {
  ...Object.fromEntries(('ls dir vdir cat tac nl head tail wc du df free uptime uname arch whoami id groups logname pwd echo printf true false test [ seq '
    + 'sleep nproc getconf locale printenv tty stat readlink realpath basename dirname which whereis type lsblk lscpu lspci lsusb lsmod modinfo lsof ps '
    + 'pgrep pidof pstree vmstat iostat mpstat sensors md5sum sha1sum sha224sum sha256sum sha384sum sha512sum b2sum cksum sum base32 base64 cut tr '
    + 'paste join comm column fold fmt expand unexpand strings od hexdump grep egrep fgrep zgrep zcat bzcat xzcat zstdcat lz4cat more jq diff cmp last '
    + 'lastlog w who users getent lsattr getfacl findmnt namei numfmt expr ldd lsb_release apt-cache dpkg-query top cd wait read : exit return shift '
    + 'break continue umask ulimit getopts times').split(' ').map(n => [n, ''])),
  less: '-o -O --log-file --LOG-FILE', sort: '-o -T --output --compress-program --temporary-directory', uniq: '#1', rg: '--pre', tree: '-o',
  file: '-C --compile', xxd: '-r --revert #1', date: '-s --set', dmesg: '-c -C -D -E -n --clear --read-clear --console-off --console-on --console-level',
  journalctl: '--setup-keys --rotate --flush --sync --relinquish-var --smart-relinquish-var --update-catalog --vacuum-size --vacuum-time --vacuum-files',
};
const SORT_FILES = Object.fromEntries(Object.entries({ over: 'cp mv ln install tee', del: 'rm rmdir unlink shred truncate', wide: 'chmod chown chgrp chattr setfacl',
  '': 'mkdir touch mkfifo mktemp patch split csplit zip gzip gunzip bzip2 bunzip2 xz unxz zstd unzstd 7z lz4' }).flatMap(([k, v]) => v.split(' ').map(n => [n, k])));
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
  ['device', 'nvidia-smi ss netstat ping ping6 traceroute tracepath mtr dig nslookup host blkid dmidecode lshw iptables-save ip6tables-save arp', 'a device or the network'],
  ['notdone', 'ngrok cloudflared frpc frps bore chisel sshuttle autossh socat localtunnel lt pagekite inlets rathole zrok tor', 'a relay or tunnel round a network filter is not done'],
  ['risky', 'npx pnpx bunx uvx', 'it downloads a package and runs it'],
  ['lockout', 'useradd adduser userdel deluser usermod passwd chpasswd chage chsh chfn groupadd addgroup groupdel delgroup groupmod gpasswd newusers vipw vigr visudo pwconv pwunconv grpconv grpunconv pam-auth-update faillock ssh-copy-id sshd tailscaled iptables ip6tables iptables-legacy iptables-nft iptables-restore ip6tables-restore ebtables arptables nft ufw firewall-cmd netplan nmcli nmtui ifup ifdown ifconfig route iw iwconfig wpa_cli wpa_supplicant tc resolvectl systemd-resolve ethtool', 'users and passwords, SSH, the firewall or the network settings, ways in'],
]) for (const n of names.split(' ')) SORT_PROGS[n] = { cls, why };
const SORT_LOCK_READS = {
  iptables: a => a.every(t => /^(?:-[LSnvx]+|-t|--(?:list|list-rules|numeric|verbose|line-numbers|exact)|filter|nat|mangle|raw|security|[A-Z][A-Z_-]*)$/.test(t)),
  nft: a => a.find(t => !t.startsWith('-')) === 'list', ufw: a => /^(?:status|show)$/.test(a[0] ?? ''), route: a => a.every(t => /^-[nev]+$/.test(t)),
  ifconfig: a => a.length <= 1 && !/^-[^as]/.test(a[0] ?? ''), tc: a => a.some(t => /^(?:show|list|ls)$/.test(t)), sshd: a => a.length > 0 && a.every(t => /^-[tT]$/.test(t)),
  ethtool: a => a.length === 1 || (a.length === 2 && /^-[iSkgaclTPm]$|^--(?:driver|statistics|show-\w+)$/.test(a[0])),
  hostname: a => a.every(t => /^-[aAdfiIsy]+$|^--(?:all-fqdns|all-ip-addresses|domain|fqdn|ip-address|short|long|alias)$/.test(t)),
};
SORT_LOCK_READS.ip6tables = SORT_LOCK_READS['iptables-legacy'] = SORT_LOCK_READS['iptables-nft'] = SORT_LOCK_READS.iptables;

// Wrappers run the command after their own options: [flags, flags that take a word, plain words first, long options
// (name= takes its value attached)]. An option the sorter doesn't know is a doubt: it could take the next word.
const SORT_WRAP = {
  env: ['i0v', 'uC', 0, 'ignore-environment null unset= chdir='], nice: ['', 'n', 0, 'adjustment='], ionice: ['t', 'cn', 0, 'class= classdata='],
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
    if (a.unknown || a.glob) unsure(`${name}’s words hold a $ or a *, so the sorter can't know what it runs.`);
    if (t === '--') { k++; break; }
    if (name === 'env' && /^[A-Za-z_]\w*=/.test(t)) { sortAssign(t.split('=')[0], ctx, r, true); continue; }
    if (!t.startsWith('-') || t === '-') break;
    if (name === 'nice' && /^-\d+$/.test(t)) continue;
    if (t.startsWith('--')) { if (!longs.split(' ').includes(t.includes('=') ? `${t.slice(2).split('=')[0]}=` : t.slice(2))) unsure(`The sorter doesn't know ${name}’s option ${t}.`); continue; }
    for (let j = 1; j < t.length; j++) {
      if (takes.includes(t[j])) { if (j === t.length - 1) k++; break; }
      if (!flags.includes(t[j])) unsure(`The sorter doesn't know ${name}’s option -${t[j]}.`);
    }
  }
  const rest = args.slice(k + pos);
  if (name === 'flock') { raise(r, 'change', 'flock makes its lock file.'); sortTouch(args[k], ctx, r); }
  if (name === 'xargs') raise(r, 'change', 'xargs runs the command after it with words it reads, which the sorter can’t see.');
  if (!rest.length) return;
  if (name === 'watch' && !args.slice(0, k).some(a => /^-\w*x$|^--exec$/.test(a.text))) {
    if (rest.some(a => a.unknown)) unsure('watch runs words that hold a $ or a command.');
    return sortInline(rest.map(a => a.text).join(' '), ctx, r, 'watch');
  }
  sortProgram(rest, ctx, r, { ...x, unknownArgs: x.unknownArgs || name === 'xargs' });
}
// After the parts: on Spark 2 a change is risky; as root, more than one plain program is risky (design A 2.7, 2.8).
function sortAt(r, ctx) {
  if (ctx.at === 'hub' && r.class === 'change') raise(r, 'risky', 'It changes Spark 2, which runs the console and the brain: anything that changes Spark 2 is asked first.');
  if (ctx.root && r.class === 'change' && !r.simple) raise(r, 'risky', 'As root, only a plain command (one program, with no chaining, redirection or wrapper) runs at once: this one is asked.');
}
function sortCommand(command, opts = {}) {
  const at = opts.at ?? 'compute';
  if (at !== 'compute' && at !== 'hub') throw new TypeError(`sortCommand: at is 'compute' or 'hub', not ${at}`);
  const text = String(command ?? ''), r = sortFresh();
  const ctx = { at, root: !!opts.root, hosts: opts.hosts || {}, brain: (opts.brain || []).filter(b => typeof b === 'string' && b.length > 2), depth: 0,
    cwds: new Set([opts.dir ? sortNorm(String(opts.dir).replace(/^(?![~/])/, '~/')) : '~']), fetched: false, fetchSeen: false, piped: false, seen: [], kinds: new Set() };
  let form = null;
  try {
    if (!text.trim()) unsure('The command is empty.');
    if (text.length > SORT_MAX) unsure(`It is ${text.length} characters long, past the ${SORT_MAX} the sorter reads whole.`);
    const hidden = UNSEEN.exec(text.replace(/[\t\n]/g, ''));
    if (hidden) raise(r, 'notdone', `It holds a sign that doesn’t show (U+${hidden[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}): what is shown would not be what runs.`);
    else {
      const odd = /[^\t\n\x20-\x7e]/u.exec(text);
      if (odd) unsure(`It holds “${odd[0]}” (U+${odd[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}), which isn’t plain ASCII: such a sign can look like ; | > or a quote and not be one.`);
      form = lookForm(text);
      if (form) r.why = 'It is one of the exact forms a look runs as code’s own text.'; else sortList(shellParse(shellLex(text).toks), ctx, r);
    }
  } catch (e) {
    if (!(e instanceof SortDoubt)) throw e;
    raise(r, 'risky', e.message);
    if (text.length <= SORT_MAX) sortScan(text, ctx, r, true);
  }
  if (r.class !== 'notdone') {
    // run's own look checks (21-work.mjs), so a look is one definition: no sudo word, no key word.
    const lw = lookWords(text), key = [...lw.words, ...ctx.seen].find(keyWord);
    if (r.class === 'look' && lw.sudo) raise(r, 'change', 'It holds the word sudo, which a look refuses: a command becomes root only by setting root.');
    if (key && r.class === 'look') raise(r, 'notdone', `It would show ${key}, which is a key or holds one: a key is never shown back.`);
    else if (key) sortOpen(ctx, r, `It names ${key}, key material the run wall hides, so it would run outside the wall.`);
  }
  sortAt(r, ctx);
  if (r.class === 'lockout') ctx.kinds.add('lockout');
  if (ctx.root) ctx.kinds.add('root');
  const kinds = r.class === 'look' ? [] : ['root', 'lockout', 'delete', 'brain'].filter(k => ctx.kinds.has(k));
  return { class: r.class, why: r.why, kinds, form, simple: r.simple, open: r.open, deletes: r.deletes, scripts: [...new Set(r.scripts)], answer: r.answer, lasting: r.lasting };
}
