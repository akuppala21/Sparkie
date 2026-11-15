/* ───────── the sorter's programs: what each one it knows does (design A 2.8) ───────── */
// Area: safety        Rules: R55        Tests: sort.test.mjs
// Owns: none
// Timers: none        Wakes: none
// One function a program the sorter (20-sort.mjs) reads past its name: shells and interpreters, the shell's built-ins
// that set a name, the package managers, git, Docker, systemd, archives, sudo and su (the network's tools and other
// machines are in 20-remote.mjs). A program in no table is unknown, and so risky; an option a handler doesn't read is a doubt, and so risky.
// A program that unpacks or downloads under names it picks reaches everything under the folder it writes to (wide).
function sortShell(args, ctx, r, x, name) {
  r.simple = false;
  if (!/^(?:bash|sh|dash|ash)$/.test(name)) unsure(`${sortQ(name)} reads its text another way than bash, and the sorter reads only bash's.`);
  const dash = name !== 'bash';
  let k = 0, code = null, input = false;
  for (; k < args.length && !args[k].unknown; k++) {
    const t = args[k].text;
    if (t === '--' || t === '-') { input ||= t === '-'; k++; break; }
    if (/^--(?:norc|noprofile|posix|login|noediting|restricted|verbose)$/.test(t)) continue;
    if (/^[-+][oO]$/.test(t)) { k++; continue; }
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
  if (typeof x.stdin === 'string') return inline(x.stdin);
  if (x.inPipe) raise(r, 'risky', ctx.piped ? `It pipes what it fetched from the network into ${sortQ(name)}: code fetched and run is always asked.` : `It pipes into ${sortQ(name)} commands an earlier part makes, which can’t be shown before they run.`);
  sortRuns(null, ctx, r, `${sortQ(name)} runs the commands it reads from its input, which the sorter can’t see.`);
}
function sortInterp(args, ctx, r, x, name) {
  r.simple = false;
  if (args.length && args.every(a => /^(?:-V|-VV|--version|--help|-h)$/.test(a.text))) return;
  for (let k = 0; k < args.length; k++) {
    const a = args[k], t = a.text;
    if (a.unknown) { if (a.fetches) ctx.fetched = true; else unsure(`${sortQ(name)}’s words hold a $ or a command, so the sorter can't know what it runs.`); return sortRuns(null, ctx, r, `${sortQ(name)} runs code a command makes.`); }
    if (/^-\w*c$/.test(t) || (!/^python/.test(name) && /^-\w*[eEr]$|^-p$|^--(?:eval|print)$/.test(t))) {
      const code = args[k + 1];
      if (!code || code.unknown) unsure(`The code handed to ${sortQ(name)} comes from a $ or a command, so the sorter can't read it.`);
      sortScan(code.text, ctx, r, true, 'seen');
      return sortRuns(null, ctx, r, `It runs a ${sortQ(name)} one-liner, which the sorter does not read.`);
    }
    if (t === '-m') return /^pip3?$/.test(args[k + 1]?.text ?? '') ? SORT_HANDLERS.pip(args.slice(k + 2), ctx, r, x, 'pip') : sortRuns(null, ctx, r, `It runs the ${sortQ(name)} module ${sortQ(args[k + 1]?.text ?? '')}.`);
    if (/^-[WX]$/.test(t)) { k++; continue; }
    if (t === '-') break;
    if (!t.startsWith('-')) return sortRuns(t, ctx, r, `It runs the ${sortQ(name)} file ${sortQ(t)}.`);
  }
  if (typeof x.stdin === 'string') sortScan(x.stdin, ctx, r, true, 'seen');
  if (x.inPipe) raise(r, 'risky', ctx.piped ? `It pipes what it fetched from the network into ${sortQ(name)}: code fetched and run is always asked.` : `It pipes into ${sortQ(name)} code an earlier part makes, which can’t be shown before it runs.`);
  sortRuns(null, ctx, r, `${sortQ(name)} runs the code it reads from its input, which the sorter does not read.`);
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
  if (a.some(w => /^-\w*[fnFi]/.test(w.text))) unsure(`${sortQ(name)} with -f, -n or -i makes a function, a name that points at another, or a value worked out as arithmetic.`);
  sortSets(a.filter(w => !w.text.startsWith('-')), ctx, r, name);
};
const sortZip = (a, ctx, r, x, name) => {
  const o = a.findIndex(w => /^-o$|^--output$/.test(w.text)), glued = a.find(w => /^--output=|^-o./.test(w.text));
  if (o >= 0 || glued) { raise(r, 'change', `${sortQ(name)} writes a file.`); r.deletes = true; return sortTouch(o >= 0 ? a[o + 1] : { ...glued, text: glued.text.replace(/^--output=|^-o/, '') }, ctx, r); }
  return a.some(w => /^-\w*[clt]|^--(?:stdout|to-stdout|list|test)$/.test(w.text)) ? undefined : sortFile(name, 'over', a, ctx, r);
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
const sortPkgs = (names, ctx, r) => {
  for (const p of names) {
    if (/^(?:openssh-\S*|ssh|tailscale\S*|ufw|iptables\S*|nftables|firewalld|netplan\S*|network-manager\S*|sudo\S*|libpam\S*|passwd|login|systemd|systemd-resolved|dbus|dropbear\S*|telnetd|xrdp|cockpit\S*|ifupdown|resolvconf|wireguard\S*|fail2ban|cloud-init)(?:[:=]\S*)?[-+]?$/.test(p)) raise(r, 'lockout', `${sortQ(p)} is a package the ways in depend on.`);
    else if (/^(?:linux-\S+|nvidia-\S+|libnvidia-\S+|cuda-drivers\S*|\S*firmware\S*|\S+-dkms|grub\S*|shim\S*)$/.test(p)) raise(r, 'risky', `${sortQ(p)} is the kernel, a driver or firmware.`);
    else if (/^(?:docker|containerd)/.test(p)) raise(r, 'risky', `${sortQ(p)} is the Docker service.`);
    else if (/^[.~/]|\.deb$/.test(p)) sortRuns(p, ctx, r, `It installs the package file ${sortQ(p)}.`);
    if (/[^-]-$/.test(p)) sortGone(ctx, r, `${sortQ(p)} ends in -, which removes that package.`);
  }
};
// Where a program that writes under names it picks puts them: the folder given, or the folders it may start in.
const sortInto = (dir, ctx, r) => (dir ? sortTouch(dir, ctx, r, true) : [...ctx.cwds].forEach(d => sortTouch({ text: d ?? '', unknown: d == null, subs: [] }, ctx, r, true)));
const SYSTEMCTL_POWER = /^(?:reboot|poweroff|halt|suspend|hibernate|hybrid-sleep|suspend-then-hibernate|kexec|soft-reboot|rescue|emergency|isolate|default|exit)$/;
const SYSTEMCTL_CHANGE = /^(?:start|stop|restart|reload|try-restart|reload-or-restart|try-reload-or-restart|condrestart|force-reload|kill|clean|freeze|thaw|enable|disable|reenable|mask|unmask|edit|revert|set-property|preset|link|add-wants|add-requires|reset-failed|daemon-reload|daemon-reexec|set-default|set-environment|unset-environment|import-environment|preset-all)$/;
const GIT_LOOK = new Set('status log show diff rev-parse ls-files ls-tree cat-file blame describe shortlog grep whatchanged count-objects for-each-ref show-ref name-rev version help'.split(' '));
const TAR_LONG = 'list extract get create append update diff compare delete file directory gzip gunzip xz bzip2 zstd lzma auto-compress verbose to-stdout keep-old-files skip-old-files overwrite no-same-owner same-owner no-same-permissions preserve-permissions numeric-owner strip-components exclude wildcards totals one-file-system owner group mode mtime sort no-overwrite-dir'.split(' ');
const SORT_HANDLERS = {
  ...Object.fromEntries('bash sh dash ash zsh ksh mksh fish'.split(' ').map(n => [n, sortShell])),
  ...Object.fromEntries('python python2 python3 perl ruby node nodejs php lua luajit Rscript julia deno bun tclsh wish pwsh'.split(' ').map(n => [n, sortInterp])),
  ...Object.fromEntries('vi vim nvim view ex ed nano emacs joe micro'.split(' ').map(n => [n, (a, ctx, r) => { for (const w of a.filter(w => !w.text.startsWith('-') && !w.unknown)) sortTouch(w, ctx, r); sortRuns(null, ctx, r, `${sortQ(n)} is an editor, which can run anything it is told.`); }])),
  ...Object.fromEntries('make gmake cmake ninja meson cargo go rustc gcc g++ cc c++ clang clang++ nvcc javac mvn gradle bazel'.split(' ').map(n => [n, (a, ctx, r) => sortRuns(null, ctx, r, `${sortQ(n)} builds or runs code.`)])),
  ...Object.fromEntries('alias unalias hash enable trap shopt complete compgen bind fc history disown suspend caller let'.split(' ').map(n => [n, sortDoubts(n)])),
  ...Object.fromEntries('export declare typeset local readonly'.split(' ').map(n => [n, sortDeclare])),
  ...Object.fromEntries('gzip gunzip bzip2 bunzip2 xz unxz zstd unzstd lz4'.split(' ').map(n => [n, sortZip])),
  ...Object.fromEntries('su doas pkexec runuser sudoedit sg newgrp'.split(' ').map(n => [n, sortBecome])),
  read(a, ctx, r) { const t = a.map(w => w.text); sortSets(a.filter((w, i) => !w.text.startsWith('-') && !/^-[dnNptui]$/.test(t[i - 1] ?? '') || t[i - 1] === '-a'), ctx, r, 'read'); },
  printf(a, ctx, r) { if (a[0]?.text === '-v') sortSets([a[1]], ctx, r, 'printf -v'); else if (/^-v./.test(a[0]?.text ?? '')) unsure('printf -v sets a name the sorter can’t read.'); },
  getopts(a, ctx, r) { sortSets([a.filter(w => !w.text.startsWith('-'))[1]], ctx, r, 'getopts'); },
  unset(a, ctx, r) { sortSets(a.filter(w => !w.text.startsWith('-')), ctx, r, 'unset'); },
  test(a) { if (a.some(w => w.text === '-v') && a.some(w => /\[/.test(w.text) && !/^[[\]]$/.test(w.text))) unsure('test -v works out an index as arithmetic, running what is in it.'); },
  awk(a, ctx, r, x, name = 'awk') {
    let k = 0;
    for (; k < a.length; k++) {
      const t = a[k].text;
      if (t === '--') { k++; break; }
      if (/^-[Fv]$/.test(t)) { k++; continue; }
      if (/^-[Fv].|^-[bcCNOPrSstMn]$|^--(?:posix|traditional|characters-as-bytes|sandbox|re-interval)$/.test(t)) continue;
      if (t.startsWith('-')) return sortRuns(null, ctx, r, `${sortQ(name)} ${sortQ(t)} reads its program from a file, loads code or writes a file.`);
      break;
    }
    const p = a[k];
    if (!p || p.unknown) unsure(`${sortQ(name)}’s program comes from a $ or a command, so the sorter can't read it.`);
    if (/\bsystem\b|getline|[|>]|@(?:load|include)/.test(p.text)) { sortScan(p.text, ctx, r, true, 'seen'); sortRuns(null, ctx, r, `The ${sortQ(name)} program writes, pipes or starts something.`); }
  },
  sed(a, ctx, r) {
    const scripts = [], files = [];
    let inPlace = false;
    const LONG = ['expression=', 'file=', 'in-place', 'quiet', 'silent', 'regexp-extended', 'separate', 'unbuffered', 'null-data', 'zero-terminated', 'line-length=', 'posix', 'debug', 'sandbox', 'follow-symlinks', 'help', 'version'];
    for (let k = 0; k < a.length; k++) {
      const t = a[k].text;
      if (t.startsWith('--') && t.length > 2) {
        const [n, v] = [t.slice(2).split('=')[0], t.includes('=') ? t.slice(t.indexOf('=') + 1) : null], hits = LONG.filter(l => l.replace(/=$/, '').startsWith(n));
        if (hits.length !== 1) unsure(`The sorter doesn't know sed’s option ${sortQ(t)}.`);
        if (hits[0] === 'expression=') scripts.push(v != null ? { text: v } : a[++k]);
        else if (hits[0] === 'file=') return sortRuns(null, ctx, r, 'sed runs a script file, which the sorter does not read.');
        else if (hits[0] === 'in-place') inPlace = true;
        else if (hits[0] === 'line-length=' && v == null) k++;
        continue;
      }
      if (/^-./.test(t)) {
        for (let j = 1; j < t.length; j++) {
          const c = t[j];
          if (c === 'i') { inPlace = true; break; }
          if (c === 'e') { scripts.push(j < t.length - 1 ? { text: t.slice(j + 1) } : a[++k]); break; }
          if (c === 'f') return sortRuns(null, ctx, r, 'sed runs a script file, which the sorter does not read.');
          if (c === 'l') { if (j === t.length - 1) k++; break; }
          if (!'nErsuz'.includes(c)) unsure(`The sorter doesn't know sed’s option ${sortQ(`-${c}`)}.`);
        }
        continue;
      }
      (scripts.length ? files : scripts).push(a[k]);
    }
    if (scripts.some(s => !s || s.unknown)) unsure('A sed script comes from a $ or a command, so the sorter can’t read it.');
    if (inPlace) { raise(r, 'change', 'sed -i rewrites the files it names.'); for (const f of files) sortTouch(f, ctx, r); }
    if (!scripts.every(s => sortSedSafe(s.text))) { sortScan(scripts.map(s => s.text).join('\n'), ctx, r, true, 'seen'); sortRuns(null, ctx, r, 'The sed script writes a file or runs a command (w, W or e).'); }
  },
  find(a, ctx, r) {
    let k = 0;
    while (k < a.length && /^-(?:[HLP]|D|O\d)$/.test(a[k].text)) k += a[k].text === '-D' ? 2 : 1;
    const starts = [];
    for (; k < a.length && !/^[-(!)]/.test(a[k].text); k++) starts.push(a[k]);
    if (a.some(w => w.unknown || w.glob || w.brace)) unsure('A $, * or {…} among find’s words could become -delete or -exec, so the sorter can’t know what it does.');
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
      } else if (/^-f(?:print0?|printf|ls)$/.test(t)) { raise(r, 'change', `find ${sortQ(t)} writes ${sortQ(a[k + 1]?.text)}.`); sortTouch(a[k + 1], ctx, r); }
    }
  },
  eval(a, ctx, r) { if (a.some(w => w.unknown)) unsure('eval runs text from a $ or a command, which the sorter can’t read.'); if (a.length) sortInline(a.map(w => w.text).join(' '), ctx, r, 'eval'); },
  source(a, ctx, r) {
    const f = a[0] ?? unsure('source with no file.');
    if (/^\/dev\/(?:stdin|fd\/)|^\/proc\/self\/fd\//.test(f.text)) unsure('It reads shell code from its input, which can’t be shown.');
    if (f.fetches) ctx.fetched = true; else if (f.unknown) unsure('It runs a shell file named by a $ or a command.');
    sortRuns(f.text || '<( … )', ctx, r, `It runs the shell file ${sortQ(f.text || 'a command makes')} in this shell.`);
  },
  set(a) { if (!a.every(w => /^[-+][a-zA-Z]+$|^(?:pipefail|errexit|nounset|xtrace|noglob|noclobber|errtrace|functrace)$/.test(w.text))) unsure('set with these words changes the shell’s own arguments or options.'); },
  cd(a, ctx) { const t = a.find(w => !/^-[LPe@]$|^--$/.test(w.text)); for (const p of !t ? ['~'] : t.unknown || t.glob || t.text === '-' ? [null] : sortPaths(t.text, ctx)) sortCd(p, ctx); },
  pushd(a, ctx) { sortCd(null, ctx); },
  hostname(a, ctx, r) { if (!SORT_LOCK_READS.hostname(a.map(w => w.text))) raise(r, 'lockout', 'hostname with a name renames the Spark, which its ways in go by.'); },
  journalctl: (a, ctx, r) => (a.some(w => /^--vac/.test(w.text)) ? sortGone(ctx, r, 'journalctl --vacuum removes old logs.') : sortReads('journalctl', SORT_READS.journalctl, a, ctx, r)),
  'nvidia-smi': (a, ctx, r) => (a.some(w => /^-(?:pm|pl|r|c|e|ac|rac|lgc|rgc|lmc|rmc|mig|cgi|dgi|cci|dci|acp|am|caa)$|^--(?:persistence|power-limit|gpu-reset|compute-mode|ecc|applications-clocks|reset-|lock-|multi-instance|auto-boost)|^--?\w*(?:set|lock|reset|enable|disable|apply)/.test(w.text))
    ? raise(r, 'risky', 'nvidia-smi changes a GPU setting (the driver’s).') : raise(r, 'change', 'nvidia-smi here needs the GPU, which a look’s wall hides (nvidia-smi as the whole command is a look).')),
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
  },
  tar(a, ctx, r) {
    // What it unpacks over is checked first; an option that runs something, or one the sorter doesn't know, comes after,
    // so the more dangerous answer stands.
    const t = a.map(w => w.text), RUNS = ['to-command', 'use-compress-program', 'checkpoint-action', 'info-script', 'new-volume-script', 'rsh-command', 'rmt-command', 'index-file', 'volno-file'];
    let runs = null, odd = null;
    for (const s of t.filter(s => /^--./.test(s))) {
      const n = s.slice(2).split('=')[0];
      if (RUNS.some(l => l.startsWith(n))) runs ??= s;
      else if (!TAR_LONG.some(l => l.startsWith(n)) && !/^(?:exclude|transform|xform|warning)$/.test(n)) odd ??= s;
    }
    // (an option that takes a word may have it glued: -f/tmp/x.tar, -C/opt; the letters stop there)
    const letters = [t[0] && !t[0].startsWith('-') ? t[0] : '', ...t.filter(s => /^-[A-Za-z]/.test(s)).map(s => /^[^fCbHKLNVTXgIF]*[fCbHKLNVTXgIF]?/.exec(s.slice(1))[0])].join('');
    if (/[IFgGTX]/.test(letters.replace(/[^A-Za-z]/g, ''))) runs ??= 'its -I, -F, -g, -T or -X';
    const longs = t.join(' '), list = /t/.test(letters) || /--(?:list|diff|compare)/.test(longs), write = /[xcruA]/.test(letters) || /--(?:extract|get|create|append|update|delete|concat)/.test(longs);
    const after = () => { if (runs) sortRuns(null, ctx, r, `tar ${sortQ(runs)} runs a program or writes a file it is given.`); if (odd) unsure(`The sorter doesn’t know tar’s option ${sortQ(odd)}.`); };
    if (list && !write) return after();
    raise(r, 'change', 'tar writes files.');
    const c = t.findIndex(s => /^-C$|^--directory$/.test(s)), glued = t.find(s => /^-C.|^--directory=/.test(s));
    if (/x/.test(letters) || /--(?:extract|get)/.test(longs) || !write) { r.deletes = true; sortInto(c >= 0 ? a[c + 1] : glued ? { text: glued.replace(/^-C|^--directory=/, ''), subs: [] } : null, ctx, r); }
    a.forEach((w, i) => { if (i !== c + 1 || c < 0) sortTouch(w, ctx, r, false); });
    after();
  },
  unzip(a, ctx, r) {
    if (a.some(w => /^-[lvtZzp]/.test(w.text))) return;
    raise(r, 'change', 'unzip writes the files it holds.');
    r.deletes = true;
    const d = a.findIndex(w => w.text === '-d');
    sortInto(d >= 0 ? a[d + 1] : null, ctx, r);
    a.forEach((w, i) => { if (i !== d + 1) sortTouch(w, ctx, r, false); });
  },
  '7z'(a, ctx, r) {
    const v = a.find(w => !w.text.startsWith('-'))?.text;
    if (/^[lt]$/.test(v ?? '')) return;
    raise(r, 'change', '7z writes files.');
    if (/^[xe]$/.test(v ?? '')) { const o = a.find(w => /^-o./.test(w.text)); sortInto(o ? { text: o.text.slice(2), subs: [] } : null, ctx, r); }
    for (const w of a) sortTouch(w, ctx, r);
  },
  patch(a, ctx, r) {
    raise(r, 'change', 'patch changes the files its diff names.');
    const d = a.findIndex(w => /^-d$|^--directory$/.test(w.text)), o = a.findIndex(w => /^-o$|^--output$/.test(w.text));
    if (o >= 0) sortTouch(a[o + 1], ctx, r); else sortInto(d >= 0 ? a[d + 1] : null, ctx, r);
    for (const w of a.filter(w => !w.text.startsWith('-'))) sortTouch(w, ctx, r, false, false);
  },
  zip(a, ctx, r) { if (a.some(w => /^-\w*TT|^--unzip-command/.test(w.text))) sortRuns(null, ctx, r, 'zip -TT runs the command it is given.'); sortFile('zip', '', a, ctx, r); },
  'ssh-keygen'(a, ctx, r) {
    const t = a.map(w => w.text);
    if (t.some(s => /^-\w*A/.test(s))) return raise(r, 'lockout', 'ssh-keygen -A makes the Spark’s own SSH host keys.');
    if (t.some(s => /^-\w*[lLyFBQ]/.test(s)) && !t.some(s => /^-\w*R/.test(s))) return;
    raise(r, 'change', 'ssh-keygen writes a key or known_hosts.');
    a.forEach((w, i) => { if (t[i - 1] === '-f') sortTouch(w, ctx, r); });
  },
  hf(a, ctx, r, x, name = 'hf') {
    const p = a.filter(w => !w.text.startsWith('-')).map(w => w.text), t = a.map(w => w.text);
    if (/^(?:env|version|scan-cache)$/.test(p[0]) || (p[0] === 'cache' && /^(?:ls|scan|list)$/.test(p[1]))) return;
    raise(r, 'change', `${sortQ(name)} ${sortQ(p[0] ?? '')} downloads or changes model files.`);
    if (p[0] === 'delete-cache' || (p[0] === 'cache' && /^(?:rm|delete|prune)$/.test(p[1]))) sortGone(ctx, r, `${sortQ(name)} ${sortQ(p[0])} removes downloaded models.`);
    const d = t.findIndex(s => s === '--local-dir'), glued = t.find(s => s.startsWith('--local-dir='));
    if (d >= 0 || glued) sortInto(d >= 0 ? a[d + 1] : { text: glued.slice(12), subs: [] }, ctx, r);
    for (const w of a) sortTouch(w, ctx, r, false);
  },
  git(a, ctx, r) {
    let k = 0, dir = null;
    for (; k < a.length && a[k].text.startsWith('-'); k++) {
      if (a[k].text === '-C') dir = a[++k];
      else if (!/^(?:--no-pager|-P|--paginate|-p|--bare|--no-optional-locks|--literal-pathspecs|--no-replace-objects)$/.test(a[k].text)) unsure(`git ${sortQ(a[k].text)} can make any git command run a program, or work on another repository.`);
    }
    const v = a[k]?.text ?? '', rest = a.slice(k + 1).map(w => w.text), only = re => rest.every(s => re.test(s));
    if (GIT_LOOK.has(v) ? !rest.some(s => /^--(?:output|ext|textconv)|^-O|^--open/.test(s))
      : (/^(?:branch|tag)$/.test(v) && only(/^-(?:[arvl]+|-list|-all|-remotes|-show-current|-verbose)$/)) || (v === 'remote' && only(/^(?:-v|--verbose|show|get-url|[\w.-]+)$/) && !rest.some(s => /^(?:add|remove|rm|rename|set-\S+|prune|update)$/.test(s)))
        || (v === 'stash' && /^(?:list|show)$/.test(rest[0])) || (v === 'config' && rest.some(s => /^--(?:get\S*|list)$|^-l$/.test(s))) || (/^(?:worktree|reflog)$/.test(v) && /^(?:list|show)?$/.test(rest[0] ?? ''))) return;
    raise(r, 'change', `git ${sortQ(v)} changes the repository or its files.`);
    if (ctx.root) raise(r, 'risky', 'As root, a git command that changes something runs the repository’s hooks and settings: asked.');
    if (rest.some(s => /^--(?:upload-pack|receive-pack|exec|template|config)|^-[uc]$|^ext::/.test(s))) unsure('git is told to run a program, or to take its settings from another place.');
    if (v === 'config' && rest.some(s => /^--(?:global|system)$/.test(s))) raise(r, 'risky', 'git config --global or --system changes what every later git command runs (aliases, hooks, pagers).');
    if (/^(?:clone|pull|fetch|submodule)$/.test(v) || (v === 'lfs' && /^(?:pull|fetch)$/.test(rest[0]))) ctx.fetched = ctx.fetchSeen = true;
    if (/^(?:clean|restore)$/.test(v) || (v === 'reset' && rest.includes('--hard')) || (v === 'checkout' && rest.some(s => /^(?:--|\.|-f|--force)$/.test(s))) || (v === 'stash' && /^(?:drop|clear)$/.test(rest[0]))) sortGone(ctx, r, `git ${sortQ(v)} throws away files or changes it doesn’t copy first.`);
    if (dir) sortTouch(dir, ctx, r, true, false);
    for (const w of a.slice(k + 1)) sortTouch(w, ctx, r);
  },
  apt(a, ctx, r, x, name = 'apt') {
    if (a.some(w => /^-[oc]|^--(?:option|config-file)/.test(w.text))) unsure(`${sortQ(name)} -o or -c can make it run any command.`);
    const p = a.filter(w => !w.text.startsWith('-')).map(w => w.text), v = p[0] ?? '';
    if (/^(?:list|show|search|policy|showsrc|depends|rdepends|madison)$/.test(v)) return;
    raise(r, 'change', `${sortQ(name)} ${sortQ(v)} changes the packages on that Spark.`);
    if (/^(?:remove|purge|autoremove|autopurge)$/.test(v)) sortGone(ctx, r, `${sortQ(name)} ${sortQ(v)} removes packages, which are not put back.`);
    if (/^(?:upgrade|full-upgrade|dist-upgrade)$/.test(v)) raise(r, 'risky', `${sortQ(name)} ${sortQ(v)} upgrades every package, the kernel and drivers among them.`);
    sortPkgs(p.slice(1), ctx, r);
  },
  dpkg(a, ctx, r) {
    const t = a.map(w => w.text), v = t.find(s => s.startsWith('-')) ?? '';
    if (/^-[lLsSpcI]$|^--(?:list|listfiles|status|search|print-avail|get-selections|print-architecture|contents|info|audit)$/.test(v)) return;
    if (/^-[rP]$|^--(?:remove|purge)$/.test(v)) return sortGone(ctx, r, 'dpkg removes packages, which are not put back.');
    if (!/^-i$|^--(?:install|configure|unpack)$/.test(v)) unsure(`The sorter doesn’t know dpkg ${sortQ(v)}.`);
    raise(r, 'change', 'dpkg installs packages.');
    sortPkgs(t.filter(s => !s.startsWith('-')), ctx, r);
  },
  pip(a, ctx, r, x, name = 'pip') {
    const t = a.map(w => w.text), k = t.findIndex(s => !s.startsWith('-')), v = t[k] ?? '';
    if (k < 0 || /^(?:list|show|freeze|check|help|inspect|debug|index)$/.test(v) || (/^(?:config|cache)$/.test(v) && /^(?:list|get|dir|info|debug)$/.test(t[k + 1]))) return;
    raise(r, 'change', `${sortQ(name)} ${sortQ(v)} changes the Python packages there.`);
    if (v === 'config') raise(r, 'risky', `${sortQ(name)} config changes where every later install comes from.`);
    if (v === 'uninstall') return sortGone(ctx, r, `${sortQ(name)} uninstall removes packages, which are not put back.`);
    for (const s of t) {
      if (/:\/\/|^git\+/.test(s)) raise(r, 'risky', `${sortQ(name)} ${sortQ(v)} installs code from an address: ${sortQ(s)}, always asked.`);
      else if (/^(?:[.~/]|-e$|--editable$|-r$|--requirement$|-c$)|\.(?:whl|zip|tar\.gz)$/.test(s) && t.indexOf(s) > k) sortRuns(null, ctx, r, `${sortQ(name)} ${sortQ(v)} ${sortQ(s)} builds and runs local code, or installs what a list names.`);
    }
  },
  conda(a, ctx, r, x, name = 'conda') {
    const p = a.filter(w => !w.text.startsWith('-')).map(w => w.text), t = a.map(w => w.text), v = p[0] ?? '';
    if (!v || /^(?:list|info|search)$/.test(v) || (/^(?:env|config)$/.test(v) && (p[1] === 'list' || a.some(w => /^--(?:show|get)/.test(w.text))))) return;
    if (v === 'run') return sortRuns(null, ctx, r, `${sortQ(name)} run runs a program inside an environment.`);
    raise(r, 'change', `${sortQ(name)} ${sortQ(v)} changes a Python environment.`);
    if (v === 'config') raise(r, 'risky', `${sortQ(name)} config changes where every later install comes from.`);
    if (t.some((s, i) => /:\/\//.test(s) && (/^-c$|^--channel$/.test(t[i - 1] ?? '') || /^--channel=/.test(s)))) raise(r, 'risky', `${sortQ(name)} installs from a channel at an address: always asked.`);
    if (/^(?:remove|uninstall)$/.test(v) || (v === 'env' && p[1] === 'remove')) sortGone(ctx, r, `${sortQ(name)} ${sortQ(v)} removes packages or an environment, which are not put back.`);
  },
  npm(a, ctx, r, x, name = 'npm') {
    const p = a.filter(w => !w.text.startsWith('-')).map(w => w.text), t = a.map(w => w.text), v = p[0] ?? '';
    if (!v || (/^(?:ls|list|ll|la|view|info|show|outdated|root|prefix|help|explain|why|config|get)$/.test(v) && !/^(?:set|delete|edit)$/.test(p[1] ?? ''))) return;
    if (/^(?:config|c|set)$/.test(v)) return raise(r, 'risky', `${sortQ(name)} ${sortQ(v)} changes where every later install comes from.`);
    if (/^(?:exec|x|dlx)$/.test(v) || (/^(?:init|create|innit)$/.test(v) && p.length > 1)) return raise(r, 'risky', `${sortQ(name)} ${sortQ(v)} downloads a package and runs it: always asked.`);
    raise(r, 'change', `${sortQ(name)} ${sortQ(v)} changes the packages there.`);
    if (t.some(s => /:\/\/|^git\+|^github:|^--registry/.test(s))) raise(r, 'risky', `${sortQ(name)} installs code from an address or another registry: always asked.`);
    if (/^(?:uninstall|remove|rm|r|un|unlink|prune)$/.test(v)) sortGone(ctx, r, `${sortQ(name)} ${sortQ(v)} removes packages, which are not put back.`);
    else if (/^(?:run|run-script|start|test|t|restart|stop|build|rebuild)$/.test(v)) sortRuns(null, ctx, r, `${sortQ(name)} ${sortQ(v)} runs the project’s scripts.`);
  },
  docker(a, ctx, r, x, name = 'docker') {
    r.simple = false;
    sortOpen(ctx, r, `${sortQ(name)} needs the Docker socket, which the run wall hides (Docker is root by another name): free-form, it is always asked.`);
    const v = a.filter(w => !w.text.startsWith('-')).map(w => w.text);
    if (/^(?:rmi|rm|prune)$/.test(v[0]) || (/^(?:image|volume|container|system|builder|network|buildx)$/.test(v[0]) && /^(?:rm|remove|prune)$/.test(v[1]))) ctx.kinds.add('delete');
  },
  systemctl(a, ctx, r) {
    const t = a.map(w => w.text), user = t.includes('--user'), bus = user ? 'the owner’s service manager' : 'systemd’s bus';
    if (t.some(s => /^(?:-H|--host|-M|--machine)/.test(s))) unsure('systemctl -H or -M reaches another machine.');
    const plain = a.filter(w => !w.text.startsWith('-')), v = plain[0]?.text ?? 'list-units';
    if (SYSTEMCTL_POWER.test(v)) return raise(r, 'risky', `systemctl ${sortQ(v)}: power, so what runs on that Spark stops.`);
    if (/^(?:status|show|cat|list-\S+|is-\S+|get-default|show-environment|help)$/.test(v)) return ctx.root && !user ? raise(r, 'change', `systemctl ${sortQ(v)} needs systemd’s bus, which a look’s wall hides.`) : sortOpen(ctx, r, `systemctl ${sortQ(v)} needs ${bus}, which the run wall hides.`);
    if (!SYSTEMCTL_CHANGE.test(v)) unsure(`The sorter doesn’t know systemctl ${sortQ(v)}.`);
    for (const u of plain.slice(1)) {
      if (u.unknown) unsure('systemctl names a unit through a $ or a command.');
      const is = n => (u.glob ? sortGlob(u.text).test(n) || sortGlob(u.text).test(`${n}.service`) : u.text.replace(/\.(?:service|socket)$/, '') === n);
      if (WAYS_UNITS.some(is) || /^user@/.test(u.text)) raise(r, 'lockout', `${sortQ(u.text)} is a way in (SSH, Tailscale, the network, the firewall, the logins, or Spark Console itself).`);
      else if (['docker', 'containerd'].some(is)) raise(r, 'risky', `${sortQ(u.text)} is the Docker service.`);
      else if (/\.timer$/.test(u.text) && /^(?:start|enable|reenable|restart|link|unmask)$/.test(v)) raise(r, 'risky', `${sortQ(u.text)} is a timer: a job that runs by itself.`);
    }
    if (/^(?:daemon-\S+|set-default|\S+-environment|preset-all)$/.test(v)) raise(r, 'risky', `systemctl ${sortQ(v)} changes how systemd runs every service.`);
    if (user || !ctx.root) sortOpen(ctx, r, `systemctl ${sortQ(v)} needs ${bus}, which the run wall hides.`); else raise(r, 'change', `systemctl ${sortQ(v)} changes a service.`);
  },
  service: (a, ctx, r, x) => (a[0]?.text === '--status-all' ? sortOpen(ctx, r, 'service --status-all needs systemd’s bus, which the run wall hides.')
    : SORT_HANDLERS.systemctl([a[1] ?? { text: 'status', subs: [] }, ...(a[0] ? [a[0]] : []), ...a.slice(2)], ctx, r, x)),
  loginctl(a, ctx, r) {
    const v = a.find(w => !w.text.startsWith('-'))?.text ?? 'list-sessions';
    if (/^(?:list-\S+|show-\S+|\S+-status)$/.test(v)) return sortOpen(ctx, r, `loginctl ${sortQ(v)} needs the login manager’s bus, which the run wall hides.`);
    if (SYSTEMCTL_POWER.test(v)) return raise(r, 'risky', `loginctl ${sortQ(v)}: power, so what runs on that Spark stops.`);
    raise(r, 'lockout', `loginctl ${sortQ(v)} changes sessions or linger, which keep the ways in running.`);
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
