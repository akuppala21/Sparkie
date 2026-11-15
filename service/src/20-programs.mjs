/* ───────── the sorter's programs: what each one it knows does (design A 2.8) ───────── */
// Area: safety        Rules: R42        Tests: sort.test.mjs
// Owns: none
// Timers: none        Wakes: none
// One function a program the sorter (20-sort.mjs) reads past its name: shells and interpreters, the package managers,
// git, Docker, systemd, Tailscale, the network, ssh and copies, archives, sudo and su. A program in no table is unknown,
// and so risky.
function sortShell(args, ctx, r, x, name) {
  r.simple = false;
  let k = 0, code = null, input = false;
  for (; k < args.length && !args[k].unknown; k++) {
    const t = args[k].text;
    if (t === '--' || t === '-') { input = t === '-'; k++; break; }
    if (/^--(?:norc|noprofile|posix|login|noediting|restricted|verbose)$/.test(t)) continue;
    if (/^[-+][oO]$/.test(t)) { k++; continue; }
    if (!/^[-+]/.test(t)) break;
    if (/^--|[^euxvnfabhkmtBCHPETlrcs]/.test(t.slice(1))) unsure(`The sorter doesn't know ${name}’s option ${t}.`);
    if (t[0] === '-' && t.includes('c')) { code = args[k + 1] ?? unsure(`${name} -c with nothing after it.`); break; }
    if (t.includes('s')) input = true;
  }
  if (code) { if (code.unknown) unsure(`The command handed to ${name} -c comes from a $ or a command, so the sorter can't read it.`); return sortInline(code.text, ctx, r, `${name} -c`); }
  const file = input ? null : args[k];
  if (/^\/dev\/(?:stdin|fd\/)|^\/proc\/self\/fd\//.test(file?.text ?? '')) unsure(`${name} reads its code from its input (${file.text}), which can’t be shown.`);
  if (file) {
    if (file.fetches) ctx.fetched = true; else if (file.unknown) unsure(`${name} runs a file named by a $ or a command.`);
    return sortRuns(file.text || '<( … )', ctx, r, `${name} runs the file ${file.text || 'a command makes'}.`);
  }
  if (typeof x.stdin === 'string') return sortInline(x.stdin, ctx, r, `${name} here-document`);
  if (x.inPipe) raise(r, 'risky', ctx.piped ? `It pipes what it fetched from the network into ${name}: code fetched and run is always asked.` : `It pipes into ${name} commands an earlier part makes, which can’t be shown before they run.`);
  sortRuns(null, ctx, r, `${name} runs the commands it reads from its input, which the sorter can’t see.`);
}
function sortInterp(args, ctx, r, x, name) {
  r.simple = false;
  if (args.length && args.every(a => /^(?:-V|-VV|--version|--help|-h)$/.test(a.text))) return;
  for (let k = 0; k < args.length; k++) {
    const a = args[k], t = a.text;
    if (a.unknown) { if (a.fetches) ctx.fetched = true; else unsure(`${name}’s words hold a $ or a command, so the sorter can't know what it runs.`); return sortRuns(null, ctx, r, `${name} runs code a command makes.`); }
    if (/^-\w*c$/.test(t) || (!/^python/.test(name) && /^-\w*[eEr]$|^-p$|^--(?:eval|print)$/.test(t))) {
      if (args[k + 1] && !args[k + 1].unknown) sortScan(args[k + 1].text, ctx, r, true);
      return sortRuns(null, ctx, r, `It runs a ${name} one-liner, which the sorter does not read.`);
    }
    if (t === '-m') return /^pip3?$/.test(args[k + 1]?.text ?? '') ? SORT_HANDLERS.pip(args.slice(k + 2), ctx, r, x, 'pip') : sortRuns(null, ctx, r, `It runs the ${name} module ${args[k + 1]?.text ?? ''}.`);
    if (/^-[WX]$/.test(t)) { k++; continue; }
    if (t === '-') break;
    if (!t.startsWith('-')) return sortRuns(t, ctx, r, `It runs the ${name} file ${t}.`);
  }
  if (typeof x.stdin === 'string') sortScan(x.stdin, ctx, r, true);
  if (x.inPipe) raise(r, 'risky', ctx.piped ? `It pipes what it fetched from the network into ${name}: code fetched and run is always asked.` : `It pipes into ${name} code an earlier part makes, which can’t be shown before it runs.`);
  sortRuns(null, ctx, r, `${name} runs the code it reads from its input, which the sorter does not read.`);
}
const sortDoubts = name => () => unsure(`It uses the shell’s ${name}, which can change what later words run.`);
const sortDeclare = (a, ctx, r, x, name) => {
  for (const w of a) {
    if (/^-\w*[fnF]/.test(w.text)) unsure(`${name} -f or -n makes a function, or a name that points at another.`);
    const n = /^[A-Za-z_]\w*/.exec(w.text)?.[0];
    if (n) sortAssign(n, ctx, r, false);
  }
};
const sortZip = (a, ctx, r, x, name) => (a.some(w => /^-\w*[clt]|^--(?:stdout|to-stdout|list|test)$/.test(w.text)) ? undefined : sortFile(name, 'over', a, ctx, r));
const sortBecome = (a, ctx, r, x, name) => {
  r.answer = 'set root';
  raise(r, 'risky', `${name} becomes another user: a command becomes root only by setting root, so it is answered “set root”.`);
  const c = a.findIndex(w => /^-c$|^--command$/.test(w.text));
  if (c < 0 || !a[c + 1] || a[c + 1].unknown) return;
  const was = ctx.root;
  ctx.root = true;
  try { sortInline(a[c + 1].text, ctx, r, `${name} -c`); } finally { ctx.root = was; }
};
const sortPkgs = (names, ctx, r) => {
  for (const p of names) {
    if (/^(?:openssh-\S*|ssh|tailscale\S*|ufw|iptables\S*|nftables|firewalld|netplan\S*|network-manager\S*|sudo\S*|libpam\S*|passwd|login|systemd|systemd-resolved|dbus)(?:[:=]\S*)?$/.test(p)) raise(r, 'lockout', `${p} is a package the ways in depend on.`);
    else if (/^(?:linux-\S+|nvidia-\S+|libnvidia-\S+|cuda-drivers\S*|\S*firmware\S*|\S+-dkms|grub\S*|shim\S*)$/.test(p)) raise(r, 'risky', `${p} is the kernel, a driver or firmware.`);
    else if (/^(?:docker|containerd)/.test(p)) raise(r, 'risky', `${p} is the Docker service.`);
    else if (/^[.~/]|\.deb$/.test(p)) sortRuns(p, ctx, r, `It installs the package file ${p}.`);
  }
};
const SYSTEMCTL_POWER = /^(?:reboot|poweroff|halt|suspend|hibernate|hybrid-sleep|suspend-then-hibernate|kexec|soft-reboot|rescue|emergency|isolate|default|exit)$/;
const SYSTEMCTL_CHANGE = /^(?:start|stop|restart|reload|try-restart|reload-or-restart|try-reload-or-restart|condrestart|force-reload|kill|clean|freeze|thaw|enable|disable|reenable|mask|unmask|edit|revert|set-property|preset|link|add-wants|add-requires|reset-failed|daemon-reload|daemon-reexec|set-default|set-environment|unset-environment|import-environment|preset-all)$/;
const GIT_LOOK = new Set('status log show diff rev-parse ls-files ls-tree cat-file blame describe shortlog grep whatchanged count-objects for-each-ref show-ref name-rev version help'.split(' '));
const SORT_OUT = { curl: /^(?:-o|--output)$/, wget: /^(?:-O|--output-document|-P|--directory-prefix)$/, aria2c: /^(?:-d|--dir|-o|--out)$/ };
const SORT_HANDLERS = {
  ...Object.fromEntries('bash sh dash zsh ksh mksh fish'.split(' ').map(n => [n, sortShell])),
  ...Object.fromEntries('python python2 python3 perl ruby node nodejs php lua luajit Rscript julia deno bun tclsh wish pwsh'.split(' ').map(n => [n, sortInterp])),
  ...Object.fromEntries('vi vim nvim view ex ed nano emacs joe micro'.split(' ').map(n => [n, (a, ctx, r, x) => sortRuns(null, ctx, r, `${n} is an editor, which can run anything it is told.`)])),
  ...Object.fromEntries('make gmake cmake ninja meson cargo go rustc gcc g++ cc c++ clang clang++ nvcc javac mvn gradle bazel'.split(' ').map(n => [n, (a, ctx, r) => sortRuns(null, ctx, r, `${n} builds or runs code.`)])),
  ...Object.fromEntries('alias unalias hash enable trap shopt complete compgen bind fc history disown suspend caller'.split(' ').map(n => [n, sortDoubts(n)])),
  ...Object.fromEntries('export declare typeset local readonly unset'.split(' ').map(n => [n, sortDeclare])),
  ...Object.fromEntries('gzip gunzip bzip2 bunzip2 xz unxz zstd unzstd lz4'.split(' ').map(n => [n, sortZip])),
  ...Object.fromEntries('su doas pkexec runuser sudoedit sg newgrp'.split(' ').map(n => [n, sortBecome])),
  awk(a, ctx, r, x, name = 'awk') {
    let k = 0;
    for (; k < a.length; k++) {
      const t = a[k].text;
      if (t === '--') { k++; break; }
      if (/^-[Fv]$/.test(t)) { k++; continue; }
      if (/^-[Fv].|^-[bcCNOPrSstMn]$|^--(?:posix|traditional|characters-as-bytes|sandbox|re-interval)$/.test(t)) continue;
      if (t.startsWith('-')) return sortRuns(null, ctx, r, `${name} ${t} reads its program from a file, loads code or writes a file.`);
      break;
    }
    const p = a[k];
    if (!p || p.unknown) unsure(`${name}’s program comes from a $ or a command, so the sorter can't read it.`);
    if (/\bsystem\b|getline|[|>]|@(?:load|include)/.test(p.text)) { sortScan(p.text, ctx, r, true); sortRuns(null, ctx, r, `The ${name} program writes, pipes or starts something.`); }
  },
  sed(a, ctx, r) {
    const scripts = [], files = [];
    let inPlace = false;
    for (let k = 0; k < a.length; k++) {
      const t = a[k].text;
      if (/^-(?:e|-expression)$/.test(t)) { scripts.push(a[++k]); continue; }
      if (t.startsWith('--expression=')) { scripts.push({ text: t.slice(13) }); continue; }
      if (/^-(?:f|-file)/.test(t)) return sortRuns(null, ctx, r, 'sed runs a script file, which the sorter does not read.');
      if (/^-[^-]*i|^--in-place/.test(t)) inPlace = true;
      if (/^-(?:l|-line-length)$/.test(t)) k++;
      else if (!t.startsWith('-') || t === '-') (scripts.length ? files : scripts).push(a[k]);
    }
    if (scripts.some(s => !s || s.unknown)) unsure('A sed script comes from a $ or a command, so the sorter can’t read it.');
    if (inPlace) { raise(r, 'change', 'sed -i rewrites the files it names.'); for (const f of files) sortTouch(f, ctx, r); }
    if (!scripts.every(s => sortSedSafe(s.text))) { sortScan(scripts.map(s => s.text).join('\n'), ctx, r, true); sortRuns(null, ctx, r, 'The sed script writes a file or runs a command (w, W or e).'); }
  },
  find(a, ctx, r) {
    let k = 0;
    while (k < a.length && /^-(?:[HLP]|D|O\d)$/.test(a[k].text)) k += a[k].text === '-D' ? 2 : 1;
    const starts = [];
    for (; k < a.length && !/^[-(!)]/.test(a[k].text); k++) starts.push(a[k]);
    if (a.some(w => w.unknown || w.glob || w.brace)) unsure('A $, * or {…} among find’s words could become -delete or -exec, so the sorter can’t know what it does.');
    for (; k < a.length; k++) {
      const t = a[k].text;
      if (t === '-delete') { r.deletes = true; for (const s of starts) sortTouch(s, ctx, r, true); sortGone(ctx, r, 'find -delete removes files it doesn’t name.'); }
      else if (/^-(?:exec|execdir|ok|okdir)$/.test(t)) {
        const e = a.findIndex((w, j) => j > k + 1 && /^[;+]$/.test(w.text));
        if (e < 0) unsure(`find ${t} with no command, or no ; or + after it.`);
        raise(r, 'change', `find ${t} runs ${a[k + 1].text} on each file it finds.`);
        r.simple = false;
        for (const s of starts) sortTouch(s, ctx, r, true);
        sortProgram(a.slice(k + 1, e), ctx, r, { unknownArgs: true });
        k = e;
      } else if (/^-f(?:print0?|printf|ls)$/.test(t)) { raise(r, 'change', `find ${t} writes ${a[k + 1]?.text}.`); sortTouch(a[k + 1], ctx, r); }
    }
  },
  eval(a, ctx, r) { if (a.some(w => w.unknown)) unsure('eval runs text from a $ or a command, which the sorter can’t read.'); if (a.length) sortInline(a.map(w => w.text).join(' '), ctx, r, 'eval'); },
  source(a, ctx, r) {
    const f = a[0] ?? unsure('source with no file.');
    if (/^\/dev\/(?:stdin|fd\/)|^\/proc\/self\/fd\//.test(f.text)) unsure(`It reads shell code from its input (${f.text}), which can’t be shown.`);
    if (f.fetches) ctx.fetched = true; else if (f.unknown) unsure('It runs a shell file named by a $ or a command.');
    sortRuns(f.text || '<( … )', ctx, r, `It runs the shell file ${f.text || 'a command makes'} in this shell.`);
  },
  set(a) { if (!a.every(w => /^[-+][a-zA-Z]+$|^(?:pipefail|errexit|nounset|xtrace|noglob|noclobber|errtrace|functrace)$/.test(w.text))) unsure('set with these words changes the shell’s own arguments or options.'); },
  cd(a, ctx) { const t = a.find(w => !/^-[LPe@]$/.test(w.text)); for (const p of !t ? ['~'] : t.unknown || t.glob || t.text === '-' ? [null] : sortPaths(t.text, ctx)) ctx.cwds.add(p); },
  pushd(a, ctx) { ctx.cwds.add(null); },
  hostname(a, ctx, r) { if (!SORT_LOCK_READS.hostname(a.map(w => w.text))) raise(r, 'lockout', 'hostname with a name renames the Spark, which its ways in go by.'); },
  journalctl: (a, ctx, r) => (a.some(w => /^--vac/.test(w.text)) ? sortGone(ctx, r, 'journalctl --vacuum removes old logs.') : sortReads('journalctl', SORT_READS.journalctl, a, ctx, r)),
  'nvidia-smi': (a, ctx, r) => (a.some(w => /^-(?:pm|pl|r|c|e|ac|rac|lgc|rgc|lmc|rmc|mig|cgi|dgi|cci|dci|acp|am|caa)$|^--(?:persistence|power-limit|gpu-reset|compute-mode|ecc|applications-clocks|reset-|lock-|multi-instance|auto-boost)/.test(w.text))
    ? raise(r, 'risky', 'nvidia-smi changes a GPU setting (the driver’s).') : raise(r, 'change', 'nvidia-smi here needs the GPU, which a look’s wall hides (nvidia-smi as the whole command is a look).')),
  ip(a, ctx, r) {
    const t = a.map(w => w.text);
    if (t.some(s => /^(?:-b|-ba\w*|-force|exec|-n|-ne\w*)$/.test(s))) unsure('ip -batch, -netns or netns exec does what the sorter can’t see.');
    if (t.some(s => /^(?:add|del|delete|change|chg|replace|set|flush|append|prepend|save|restore|attach|detach|up|down)$/.test(s))) return raise(r, 'lockout', 'ip changes the network interfaces, addresses or routes.');
    raise(r, 'change', 'ip reads the real network, which a look’s wall has none of (ip addr and ip route alone are looks).');
  },
  ss: (a, ctx, r) => (a.some(w => /^-\w*K|^--kill/.test(w.text)) ? raise(r, 'risky', 'ss -K closes connections, maybe the owner’s own.') : raise(r, 'change', 'ss reads the real network, which a look’s wall has none of (ss -tln alone is a look).')),
  sysctl(a, ctx, r) {
    const t = a.map(w => w.text);
    if (t.some(s => /^-\w*[wp]|^--(?:write|load|system)|=/.test(s))) raise(r, t.some(s => /^net\.|^-\w*p|^--(?:load|system)/.test(s)) ? 'lockout' : 'risky', 'sysctl changes kernel settings, maybe the network’s.');
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
      if (/^\/dev\/(?!null$|zero$|std(?:out|err)$)/.test(m[2])) sortGone(ctx, r, `dd of=${m[2]} writes a disk directly.`);
      sortTouch({ ...w, text: m[2] }, ctx, r);
    }
  },
  curl(a, ctx, r, x, name = 'curl') {
    const t = a.map(w => w.text);
    raise(r, 'change', `${name} reaches the network, which a look’s wall has none of.`);
    ctx.piped = ctx.fetchSeen = true;
    if (t.some(s => /^--(?:abstract-)?unix-socket|(?:^|\/\/|@)(?:localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1?\])(?=[:/]|$)/i.test(s))) sortOpen(ctx, r, `${name} reaches a local-only port or socket on its own Spark, which the run wall hides.`);
    if (name === 'wget' ? !t.some((s, i) => (/^-\w*O$/.test(s) && t[i + 1] === '-') || /^-\w*O-$|^--output-document=-$/.test(s)) : name === 'aria2c' || t.some(s => /^-\w*[oOJ]$|^--(?:output|remote-name)/.test(s))) ctx.fetched = true;
    t.forEach((s, i) => { if (SORT_OUT[name].test(s) && t[i + 1] !== '-') sortTouch(a[i + 1], ctx, r); });
  },
  ssh(a, ctx, r) {
    r.simple = false;
    let k = 0, relay = null;
    for (; k < a.length && a[k].text.startsWith('-'); k++) {
      const t = a[k].text;
      for (let j = 1; j < t.length; j++) {
        const c = t[j];
        if ('bcDEeFIiJLlmOopQRSWw'.includes(c)) {
          const v = j < t.length - 1 ? t.slice(j + 1) : a[++k]?.text ?? '';
          if ('RDLWwJ'.includes(c)) relay ??= `ssh -${c}`;
          if (/^(?:Proxy|\w*Forward|Tunnel)/i.test(v) && c === 'o') relay ??= `ssh -o ${v.split(/[= ]/)[0]}`;
          else if ('FES'.includes(c) || (c === 'o' && /^(?:LocalCommand|PermitLocalCommand|RemoteCommand|Control|Include)/i.test(v))) unsure(`ssh -${c} ${v} runs a command or shares a connection the sorter can’t see.`);
          break;
        }
        if (!'46AaCfGgKkMNnqsTtVvXxYy'.includes(c)) unsure(`The sorter doesn’t know ssh’s option -${c}.`);
      }
    }
    if (!a[k] || a[k].unknown || a.some(w => w.unknown)) unsure('ssh’s host or command holds a $ or a command, which the sorter can’t read.');
    if (a[k + 1]?.text.startsWith('-')) unsure('ssh takes options after the host too, which the sorter does not read there.');
    const host = a[k].text.replace(/^[^@]*@/, ''), place = ctx.hosts[host] ?? ctx.hosts[host.toLowerCase()], remote = a.slice(k + 1).map(w => w.text).join(' ');
    if (relay) return raise(r, place ? 'risky' : 'notdone', place ? `${relay} opens a tunnel between Sparks.` : `${relay} would open a tunnel or relay through ${host}, outside the fleet, round a network filter.`);
    if (!place) { sortScan(remote, ctx, r, true); return raise(r, 'risky', `It connects to ${host}, which isn’t one of the Sparks.`); }
    raise(r, 'change', `It runs a command on ${host} over ssh.`);
    if (ctx.root) raise(r, 'risky', 'As root, ssh uses root’s own keys to run a command on another Spark: always asked.');
    if (!remote) return;
    const was = [ctx.at, ctx.root, ctx.cwds], c = sortFresh();
    Object.assign(ctx, { at: place, root: false, cwds: new Set(['~']) });
    try { sortInline(remote, ctx, c, 'ssh'); sortAt(c, ctx); } finally { [ctx.at, ctx.root, ctx.cwds] = was; }
    sortMerge(r, c);
  },
  scp(a, ctx, r, x, name = 'scp') {
    raise(r, 'change', `${name} copies files.`);
    if (a.some(w => /^-\w*[oFJ]$|^-e$|^--(?:rsh|rsync-path)/.test(w.text))) unsure(`${name}’s -o, -F, -J or -e runs a command or goes through a host the sorter can’t see.`);
    if (a.some(w => /^--(?:del|remove-source)/.test(w.text))) sortGone(ctx, r, `${name} --delete removes files it doesn’t name.`);
    const plain = a.filter(w => !w.text.startsWith('-')), rec = a.some(w => /^-\w*[ra]|^--(?:recursive|archive)$/.test(w.text));
    plain.forEach((w, i) => {
      const m = /^(?:[^@/:]*@)?([^/:]+):+/.exec(w.text);
      if (!m) return sortTouch(w, ctx, r, rec && i === plain.length - 1);
      const place = ctx.hosts[m[1]] ?? ctx.hosts[m[1].toLowerCase()];
      if (!place) raise(r, 'risky', `It copies to or from ${m[1]}, which isn’t one of the Sparks.`);
      else if (place === 'hub' && i === plain.length - 1) raise(r, 'risky', 'It copies files onto Spark 2: anything that changes Spark 2 is asked first.');
      sortScan(w.text.slice(m[0].length), ctx, r, false);
    });
  },
  tar(a, ctx, r) {
    const t = a.map(w => w.text), mode = [t[0] ?? '', ...t.filter(s => /^-[A-Za-z]+$|^--(?:list|extract|get|create|append|update|delete|concatenate|catenate)$/.test(s))].join(' ');
    if (t.some(s => /^--(?:to-command|use-compress-program|checkpoint-action|info-script|new-volume-script|rsh-command)|^-[A-Za-z]*[IF]$/.test(s))) return sortRuns(null, ctx, r, 'tar runs a program it is given.');
    if (/^-?[A-Za-z]*t|--list/.test(mode) && !/(?:^| )-?[A-Za-z]*[xcruA]|--(?:extract|get|create|append|update|delete|concatenate|catenate)/.test(mode)) return;
    raise(r, 'change', 'tar writes files.');
    if (/(?:^| )-?[A-Za-z]*x|--extract|--get/.test(mode)) {
      r.deletes = true;
      // (as root, into the folder it starts in: the run wall holds an ordinary user's start files and .ssh read-only)
      if (ctx.root && !t.some(s => /^-C$|^--directory/.test(s))) for (const d of ctx.cwds) sortTouch({ text: d ?? '', unknown: d == null, subs: [] }, ctx, r, true);
    }
    a.forEach((w, i) => sortTouch(w, ctx, r, /^-C$|^--directory$/.test(t[i - 1] ?? '')));
  },
  unzip(a, ctx, r) { if (a.some(w => /^-[lvtZzp]/.test(w.text))) return; raise(r, 'change', 'unzip writes the files it holds.'); r.deletes = true; a.forEach((w, i) => sortTouch(w, ctx, r, a[i - 1]?.text === '-d')); },
  'ssh-keygen'(a, ctx, r) {
    const t = a.map(w => w.text);
    if (t.some(s => /^-\w*A/.test(s))) return raise(r, 'lockout', 'ssh-keygen -A makes the Spark’s own SSH host keys.');
    if (t.some(s => /^-\w*[lLyFBQ]/.test(s)) && !t.some(s => /^-\w*R/.test(s))) return;
    raise(r, 'change', 'ssh-keygen writes a key or known_hosts.');
    a.forEach((w, i) => { if (t[i - 1] === '-f') sortTouch(w, ctx, r); });
  },
  hf(a, ctx, r, x, name = 'hf') {
    const p = a.filter(w => !w.text.startsWith('-')).map(w => w.text);
    if (/^(?:env|version|scan-cache)$/.test(p[0]) || (p[0] === 'cache' && /^(?:ls|scan|list)$/.test(p[1]))) return;
    raise(r, 'change', `${name} ${p[0] ?? ''} downloads or changes model files.`);
    if (p[0] === 'delete-cache' || (p[0] === 'cache' && /^(?:rm|delete|prune)$/.test(p[1]))) sortGone(ctx, r, `${name} ${p[0]} removes downloaded models.`);
    for (const w of a) sortTouch(w, ctx, r);
  },
  git(a, ctx, r) {
    let k = 0;
    for (; k < a.length && a[k].text.startsWith('-'); k++) {
      if (a[k].text === '-C') k++;
      else if (!/^(?:--no-pager|-P|--paginate|-p|--bare|--no-optional-locks|--literal-pathspecs|--no-replace-objects)$/.test(a[k].text)) unsure(`git ${a[k].text} can make any git command run a program, or work on another repository.`);
    }
    const v = a[k]?.text ?? '', rest = a.slice(k + 1).map(w => w.text), only = re => rest.every(s => re.test(s));
    if (GIT_LOOK.has(v) ? !rest.some(s => /^--(?:output|ext-diff|textconv)|^-O|^--open-files/.test(s))
      : (/^(?:branch|tag)$/.test(v) && only(/^-(?:[arvl]+|-list|-all|-remotes|-show-current|-verbose)$/)) || (v === 'remote' && only(/^(?:-v|--verbose|show|get-url|[\w.-]+)$/) && !rest.some(s => /^(?:add|remove|rm|rename|set-\S+|prune|update)$/.test(s)))
        || (v === 'stash' && /^(?:list|show)$/.test(rest[0])) || (v === 'config' && rest.some(s => /^--(?:get\S*|list)$|^-l$/.test(s))) || (/^(?:worktree|reflog)$/.test(v) && /^(?:list|show)?$/.test(rest[0] ?? ''))) return;
    raise(r, 'change', `git ${v} changes the repository or its files.`);
    if (v === 'config' && rest.some(s => /^--(?:global|system)$/.test(s))) raise(r, 'risky', 'git config --global or --system changes what every later git command runs (aliases, hooks, pagers).');
    if (/^(?:clone|pull|fetch|submodule)$/.test(v) || (v === 'lfs' && /^(?:pull|fetch)$/.test(rest[0]))) ctx.fetched = ctx.fetchSeen = true;
    if (/^(?:clean|restore)$/.test(v) || (v === 'reset' && rest.includes('--hard')) || (v === 'checkout' && rest.some(s => /^(?:--|\.|-f|--force)$/.test(s))) || (v === 'stash' && /^(?:drop|clear)$/.test(rest[0]))) sortGone(ctx, r, `git ${v} throws away files or changes it doesn’t copy first.`);
    for (const w of a.slice(k + 1)) sortTouch(w, ctx, r);
  },
  apt(a, ctx, r, x, name = 'apt') {
    if (a.some(w => /^-[oc]|^--(?:option|config-file)/.test(w.text))) unsure(`${name} -o or -c can make it run any command.`);
    const p = a.filter(w => !w.text.startsWith('-')).map(w => w.text), v = p[0] ?? '';
    if (/^(?:list|show|search|policy|showsrc|depends|rdepends|madison)$/.test(v)) return;
    raise(r, 'change', `${name} ${v} changes the packages on that Spark.`);
    if (/^(?:remove|purge|autoremove|autopurge)$/.test(v)) sortGone(ctx, r, `${name} ${v} removes packages, which are not put back.`);
    if (/^(?:upgrade|full-upgrade|dist-upgrade)$/.test(v)) raise(r, 'risky', `${name} ${v} upgrades every package, the kernel and drivers among them.`);
    sortPkgs(p.slice(1), ctx, r);
  },
  dpkg(a, ctx, r) {
    const t = a.map(w => w.text), v = t.find(s => s.startsWith('-')) ?? '';
    if (/^-[lLsSpcI]$|^--(?:list|listfiles|status|search|print-avail|get-selections|print-architecture|contents|info|audit)$/.test(v)) return;
    if (/^-[rP]$|^--(?:remove|purge)$/.test(v)) return sortGone(ctx, r, 'dpkg removes packages, which are not put back.');
    if (!/^-i$|^--(?:install|configure|unpack)$/.test(v)) unsure(`The sorter doesn’t know dpkg ${v}.`);
    raise(r, 'change', 'dpkg installs packages.');
    sortPkgs(t.filter(s => !s.startsWith('-')), ctx, r);
  },
  pip(a, ctx, r, x, name = 'pip') {
    const t = a.map(w => w.text), k = t.findIndex(s => !s.startsWith('-')), v = t[k] ?? '';
    if (k < 0 || /^(?:list|show|freeze|check|help|inspect|debug|index)$/.test(v) || (/^(?:config|cache)$/.test(v) && /^(?:list|get|dir|info|debug)$/.test(t[k + 1]))) return;
    raise(r, 'change', `${name} ${v} changes the Python packages there.`);
    if (v === 'config') raise(r, 'risky', `${name} config changes where every later install comes from.`);
    if (v === 'uninstall') return sortGone(ctx, r, `${name} uninstall removes packages, which are not put back.`);
    for (const s of t.slice(k + 1)) {
      if (/:\/\/|^git\+/.test(s)) raise(r, 'risky', `${name} ${v} ${s} installs code from an address: always asked.`);
      else if (/^(?:[.~/]|-e$|--editable$|-r$|--requirement$|-c$)|\.(?:whl|zip|tar\.gz)$/.test(s)) sortRuns(null, ctx, r, `${name} ${v} ${s} builds and runs local code, or installs what a list names.`);
    }
  },
  conda(a, ctx, r, x, name = 'conda') {
    const p = a.filter(w => !w.text.startsWith('-')).map(w => w.text), v = p[0] ?? '';
    if (!v || /^(?:list|info|search)$/.test(v) || (/^(?:env|config)$/.test(v) && (p[1] === 'list' || a.some(w => /^--(?:show|get)/.test(w.text))))) return;
    if (v === 'run') return sortRuns(null, ctx, r, `${name} run runs a program inside an environment.`);
    raise(r, 'change', `${name} ${v} changes a Python environment.`);
    if (v === 'config') raise(r, 'risky', `${name} config changes where every later install comes from.`);
    if (/^(?:remove|uninstall)$/.test(v) || (v === 'env' && p[1] === 'remove')) sortGone(ctx, r, `${name} ${v} removes packages or an environment, which are not put back.`);
  },
  npm(a, ctx, r, x, name = 'npm') {
    const p = a.filter(w => !w.text.startsWith('-')).map(w => w.text), v = p[0] ?? '';
    if (!v || (/^(?:ls|list|ll|la|view|info|show|outdated|root|prefix|help|explain|why|config|get)$/.test(v) && !/^(?:set|delete|edit)$/.test(p[1] ?? ''))) return;
    if (v === 'config') return raise(r, 'risky', `${name} config changes where every later install comes from.`);
    if (/^(?:exec|x|dlx)$/.test(v)) return raise(r, 'risky', `${name} ${v} downloads a package and runs it: always asked.`);
    raise(r, 'change', `${name} ${v} changes the packages there.`);
    if (/^(?:uninstall|remove|rm|r|un|unlink|prune)$/.test(v)) sortGone(ctx, r, `${name} ${v} removes packages, which are not put back.`);
    else if (/^(?:run|run-script|start|test|t|restart|stop|build|rebuild)$/.test(v)) sortRuns(null, ctx, r, `${name} ${v} runs the project’s scripts.`);
  },
  docker(a, ctx, r, x, name = 'docker') {
    r.simple = false;
    sortOpen(ctx, r, `${name} needs the Docker socket, which the run wall hides (Docker is root by another name): free-form ${name} is always asked.`);
    const v = a.filter(w => !w.text.startsWith('-')).map(w => w.text);
    if (/^(?:rmi|rm|prune)$/.test(v[0]) || (/^(?:image|volume|container|system|builder|network|buildx)$/.test(v[0]) && /^(?:rm|remove|prune)$/.test(v[1]))) ctx.kinds.add('delete');
  },
  systemctl(a, ctx, r) {
    const t = a.map(w => w.text), user = t.includes('--user'), bus = user ? 'the owner’s service manager' : 'systemd’s bus';
    if (t.some(s => /^(?:-H|--host|-M|--machine)/.test(s))) unsure('systemctl -H or -M reaches another machine.');
    const plain = a.filter(w => !w.text.startsWith('-')), v = plain[0]?.text ?? 'list-units';
    if (SYSTEMCTL_POWER.test(v)) return raise(r, 'risky', `systemctl ${v}: power, so what runs on that Spark stops.`);
    if (/^(?:status|show|cat|list-\S+|is-\S+|get-default|show-environment|help)$/.test(v)) return ctx.root && !user ? raise(r, 'change', `systemctl ${v} needs systemd’s bus, which a look’s wall hides.`) : sortOpen(ctx, r, `systemctl ${v} needs ${bus}, which the run wall hides.`);
    if (!SYSTEMCTL_CHANGE.test(v)) unsure(`The sorter doesn’t know systemctl ${v}.`);
    for (const u of plain.slice(1)) {
      if (u.unknown) unsure('systemctl names a unit through a $ or a command.');
      const is = n => (u.glob ? sortGlob(u.text).test(n) || sortGlob(u.text).test(`${n}.service`) : u.text.replace(/\.(?:service|socket)$/, '') === n);
      if (WAYS_UNITS.some(is) || /^user@/.test(u.text)) raise(r, 'lockout', `${u.text} is a way in (SSH, Tailscale, the network, the firewall, the logins, or Spark Console itself).`);
      else if (['docker', 'containerd'].some(is)) raise(r, 'risky', `${u.text} is the Docker service.`);
      else if (/\.timer$/.test(u.text) && /^(?:start|enable|reenable|restart|link|unmask)$/.test(v)) raise(r, 'risky', `${u.text} is a timer: a job that runs by itself.`);
    }
    if (/^(?:daemon-\S+|set-default|\S+-environment|preset-all)$/.test(v)) raise(r, 'risky', `systemctl ${v} changes how systemd runs every service.`);
    if (user || !ctx.root) sortOpen(ctx, r, `systemctl ${v} needs ${bus}, which the run wall hides.`); else raise(r, 'change', `systemctl ${v} changes a service.`);
  },
  service: (a, ctx, r, x) => (a[0]?.text === '--status-all' ? sortOpen(ctx, r, 'service --status-all needs systemd’s bus, which the run wall hides.')
    : SORT_HANDLERS.systemctl([a[1] ?? { text: 'status', subs: [] }, ...(a[0] ? [a[0]] : []), ...a.slice(2)], ctx, r, x)),
  tailscale(a, ctx, r) {
    const v = a.find(w => !w.text.startsWith('-'))?.text ?? '';
    if (/^(?:status|ip|netcheck|ping|whois|version|bugreport|metrics|licenses)$/.test(v)) return sortOpen(ctx, r, `tailscale ${v} needs Tailscale’s socket, which the run wall hides.`);
    if (v === 'logout') r.lasting = 'A Tailscale logout needs a sign-in in a browser to undo; the net can’t put it back.';
    raise(r, 'lockout', `tailscale ${v} changes Tailscale, a way in.`);
  },
  loginctl(a, ctx, r) {
    const v = a.find(w => !w.text.startsWith('-'))?.text ?? 'list-sessions';
    if (/^(?:list-\S+|show-\S+|\S+-status)$/.test(v)) return sortOpen(ctx, r, `loginctl ${v} needs the login manager’s bus, which the run wall hides.`);
    if (SYSTEMCTL_POWER.test(v)) return raise(r, 'risky', `loginctl ${v}: power, so what runs on that Spark stops.`);
    raise(r, 'lockout', `loginctl ${v} changes sessions or linger, which keep the ways in running.`);
  },
  userdel(a, ctx, r) { if (a.some(w => /^-\w*r|^--remove/.test(w.text))) { ctx.kinds.add('delete'); r.lasting = 'A deleted user’s home can’t be put back.'; } raise(r, 'lockout', 'userdel removes a user, a way in.'); },
};
for (const [n, to] of Object.entries({ pushd: 'pushd', popd: 'pushd', '.': 'source', 'apt-get': 'apt', aptitude: 'apt', pip3: 'pip', mamba: 'conda', micromamba: 'conda',
  pnpm: 'npm', yarn: 'npm', podman: 'docker', nerdctl: 'docker', 'docker-compose': 'docker', wget: 'curl', aria2c: 'curl', sftp: 'scp', rsync: 'scp',
  'huggingface-cli': 'hf', gawk: 'awk', mawk: 'awk', nawk: 'awk', deluser: 'userdel', sudo: 'sudo' })) if (to !== n) SORT_HANDLERS[n] = (a, ctx, r, x) => SORT_HANDLERS[to](a, ctx, r, x, n);
SORT_HANDLERS.sudo = (a, ctx, r, x) => {
  r.answer = 'set root';
  r.simple = false;
  raise(r, 'change', 'It says sudo: a command becomes root only by setting root, so it is answered “set root”.');
  let k = 0;
  for (; k < a.length && a[k].text.startsWith('-'); k++) {
    const t = a[k].text;
    if (t === '--') { k++; break; }
    if (/^-[ughpCDrtTU]$/.test(t)) k++;
    else if (!/^-[AbEHKklnPSVv]+$/.test(t)) unsure(`sudo ${t} opens a shell, edits a file or does what the sorter doesn’t read.`);
  }
  if (k >= a.length) return;
  const was = ctx.root;
  ctx.root = true;
  try { sortProgram(a.slice(k), ctx, r, x); } finally { ctx.root = was; }
};
