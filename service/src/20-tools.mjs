/* ───────── the sorter's tools that set a Spark up: packages, git, builds, services (design A 2.8) ───────── */
// Area: safety        Rules: R55        Tests: sort.test.mjs
// Owns: none
// Timers: none        Wakes: none
// The handlers 20-programs.mjs leaves to this part, added to SORT_HANDLERS: the package managers (apt, dpkg, pip, conda,
// npm, hf), git, Docker, the builds (make and its kin), and systemd (systemctl, service, loginctl). Each knows its
// sub-commands: one not on its list is a doubt (risky), and so is an option its spec (20-options.mjs) doesn't hold. A
// sub-command that runs another program (conda run, npm explore, yarn node, git bisect run, git rebase -x, git
// submodule foreach, git difftool -x) has that program sorted where it stands; such a handler returns how many words
// are its own, so the options check reads only those.
const sortPkgs = (names, ctx, r) => {
  for (const p of names) {
    if (/^(?:openssh-\S*|ssh|tailscale\S*|ufw|iptables\S*|nftables|firewalld|netplan\S*|network-manager\S*|sudo\S*|libpam\S*|passwd|login|systemd|systemd-resolved|dbus|dropbear\S*|telnetd|xrdp|cockpit\S*|ifupdown|resolvconf|wireguard\S*|fail2ban|cloud-init)(?:[:=]\S*)?[-+]?$/.test(p)) raise(r, 'lockout', `${sortQ(p)} is a package the ways in depend on.`);
    else if (/^(?:linux-\S+|nvidia-\S+|libnvidia-\S+|cuda-drivers\S*|\S*firmware\S*|\S+-dkms|grub\S*|shim\S*)$/.test(p)) raise(r, 'risky', `${sortQ(p)} is the kernel, a driver or firmware.`);
    else if (/^(?:docker|containerd)/.test(p)) raise(r, 'risky', `${sortQ(p)} is the Docker service.`);
    else if (/^[.~/]|\.deb$/.test(p)) sortRuns(p, ctx, r, `It installs the package file ${sortQ(p)}.`);
    if (/[^-]-$/.test(p)) sortGone(ctx, r, `${sortQ(p)} ends in -, which removes that package.`);
  }
};
// A command handed over as text that runs in folders the sorter can't place (a package's, each submodule's).
const sortElsewhere = (words, ctx, r, via) => {
  if (!words.length || words.some(w => w.unknown)) unsure(`${via} runs a command from a $ or a command, or none at all.`);
  const was = ctx.cwds;
  ctx.cwds = new Set([null]);
  try { sortInline(words.map(w => w.text).join(' '), ctx, r, via); } finally { ctx.cwds = was; }
};
const SYSTEMCTL_POWER = /^(?:reboot|poweroff|halt|suspend|hibernate|hybrid-sleep|suspend-then-hibernate|kexec|soft-reboot|rescue|emergency|isolate|default|exit)$/;
const SYSTEMCTL_CHANGE = /^(?:start|stop|restart|reload|try-restart|reload-or-restart|try-reload-or-restart|condrestart|force-reload|kill|clean|freeze|thaw|enable|disable|reenable|mask|unmask|edit|revert|set-property|preset|link|add-wants|add-requires|reset-failed|daemon-reload|daemon-reexec|set-default|set-environment|unset-environment|import-environment|preset-all)$/;
const GIT_LOOK = new Set('status log show diff rev-parse ls-files ls-tree cat-file blame describe shortlog grep whatchanged count-objects for-each-ref show-ref name-rev version help'.split(' '));
// git's sub-commands past a look (an alias the repository's settings define is none of them), and the settings a
// change may set (any other decides what later git commands run: hooks, pagers, helpers, aliases, transports).
const GIT_VERBS = new Set(Object.keys(SORT_OPTS).filter(k => k.startsWith('git:')).map(k => k.slice(4)));
const GIT_PLAIN_KEYS = /^(?:user\.(?:name|email)|pull\.(?:rebase|ff)|push\.(?:default|autoSetupRemote|followTags)|init\.defaultBranch|fetch\.(?:prune|pruneTags)|merge\.(?:ff|conflictStyle)|rebase\.(?:autoSquash|autoStash|updateRefs)|rerere\.enabled|color\.[\w.]+|advice\.\w+|status\.\w+|log\.\w+|tag\.sort|column\.ui|commit\.verbose|branch\.(?:sort|autoSetupMerge|autoSetupRebase|[\w./-]+\.(?:remote|merge|rebase))|remote\.[\w./-]+\.(?:url|fetch|pushurl|prune)|diff\.(?:algorithm|colorMoved|renames|mnemonicPrefix))$/i;
// What git itself writes in its work tree, or a clone: the folder is git's own after it, and later git there runs no
// settings another program brought, unless another program writes there afterwards (sortTouch takes it back).
const sortGitOwn = (dir, ctx, r) => {
  sortInto(dir, ctx, r);
  for (const d of dir ? (dir.unknown ? [] : sortPaths(dir.text, ctx)) : [...ctx.cwds]) if (d != null) ctx.cloned.add(d);
};
const SORT_BUILD_VERBS = { cargo: /^(?:build|b|check|c|test|t|run|r|bench|doc|fmt|clippy|clean|update|tree|metadata|new|init|add|remove|fetch|fix|search|version|help|vendor|package|generate-lockfile|locate-project|pkgid|verify-project|rustc|rustdoc)$/,
  go: /^(?:build|run|test|vet|fmt|mod|get|install|list|env|version|clean|generate|doc|work|tool|fix|help)$/ };
function sortBuild(a, ctx, r, x, name) {
  const o = sortOpts(SORT_OPTS[name], a), v = o.plain.find(w => !w.text.startsWith('+'));
  if (SORT_BUILD_VERBS[name] && !SORT_BUILD_VERBS[name].test(v?.text ?? 'build')) unsure(`The sorter doesn’t know ${sortQ(name)} ${sortQ(v?.text)}.`);
  if (name === 'go' && v?.text === 'run' && o.plain.some(w => /@/.test(w.text))) raise(r, 'risky', 'go run with a @version downloads a package and runs it: always asked.');
  if (name === 'go' && a.some(w => /-extld|-toolexec|-exec\b/.test(w.text))) unsure('go is told to run another program (-extld, -toolexec, -exec).');
  for (const f of /make$/.test(name) ? o.all('f', 'file', 'makefile') : name === 'ninja' ? o.all('f') : []) sortRuns(f.text, ctx, r, `${sortQ(name)} runs the file ${sortQ(f.text)}.`);
  sortUnshown(r, `the build files ${name} reads (a Makefile, a build script, a project's own settings)`);
  sortRuns(null, ctx, r, `${sortQ(name)} builds or runs code.`, o.all('C', 'directory').at(-1));
  // (what a compiler writes: -o and the word after it, or -ofile)
  if (/^(?:gcc|g\+\+|cc|c\+\+|clang|clang\+\+|nvcc|go|rustc)$/.test(name)) a.forEach((w, i) => { const t = a[i - 1]?.text === '-o' ? w : /^-o./.test(w.text) && name !== 'go' ? { ...w, text: w.text.slice(2) } : null; if (t) { r.deletes = true; sortTouch(t, ctx, r); } });
}
Object.assign(SORT_HANDLERS, {
  ...Object.fromEntries('make gmake cmake ninja meson cargo go rustc gcc g++ cc c++ clang clang++ nvcc javac mvn gradle bazel'.split(' ').map(n => [n, sortBuild])),
  git(a, ctx, r, x) {
    let k = 0, dir = null;
    for (; k < a.length && a[k].text.startsWith('-'); k++) {
      if (a[k].text === '-C') dir = a[++k];
      else if (!/^(?:--no-pager|-P|--paginate|-p|--bare|--no-optional-locks|--literal-pathspecs|--no-replace-objects)$/.test(a[k].text)) unsure(`git ${sortQ(a[k].text)} can make any git command run a program, or work on another repository.`);
    }
    if (a.some(w => /(?:^|[^\w])(?:ext|fd)::/.test(w.text))) unsure('git is handed an ext:: or fd:: address, which runs a command.');
    if (a[k]?.unknown) unsure('git’s sub-command comes from a $ or a command.');
    const v = a[k]?.text ?? '', own = a.slice(k + 1), rest = own.map(w => w.text), only = re => rest.every(s => re.test(s));
    if (GIT_LOOK.has(v) && rest.some(s => /^--(?:ext|textconv|open)|^-O/.test(s))) unsure(`git ${sortQ(v)} is told to run a program (--ext-diff, --textconv, -O or --open-files-in-pager).`);
    if (GIT_LOOK.has(v) ? !rest.some(s => /^--output/.test(s))
      : (/^(?:branch|tag)$/.test(v) && only(/^-(?:[arvl]+|-list|-all|-remotes|-show-current|-verbose)$/)) || (v === 'remote' && only(/^(?:-v|--verbose|show|get-url|[\w.-]+)$/) && !rest.some(s => /^(?:add|remove|rm|rename|set-\S+|prune|update)$/.test(s)))
        || (v === 'stash' && /^(?:list|show)$/.test(rest[0])) || (v === 'config' && rest.some(s => /^--(?:get\S*|list)$|^-l$/.test(s))) || (/^(?:worktree|reflog)$/.test(v) && /^(?:list|show)?$/.test(rest[0] ?? ''))) return;
    raise(r, 'change', `git ${sortQ(v)} changes the repository or its files.`);
    if (ctx.root) raise(r, 'risky', 'As root, a git command that changes something runs the repository’s hooks and settings: asked.');
    // (in a folder this command or the task wrote or fetched into, the repository's own settings came with it, and git
    // runs what they name: a credential helper, a gpg program, a filter, an ssh command)
    if ((dir ? (dir.unknown ? [null] : sortPaths(dir.text, ctx)) : [...ctx.cwds]).some(d => d == null || (![...ctx.cloned].some(c => d === c || d.startsWith(`${c}/`)) && (sortWrote(d, ctx) || sortWroteIn(d, ctx))))) raise(r, 'risky', `git ${sortQ(v)} works in a folder this command or the task wrote into, whose own git settings it runs.`);
    if (v === 'filter-branch') unsure('git filter-branch runs the shell code it is given on every commit, which the sorter does not read.');
    if (!GIT_VERBS.has(v) && !GIT_LOOK.has(v)) unsure(`The sorter doesn’t know git ${sortQ(v)}: an alias the repository’s settings define, or a sub-command it doesn’t read.`);
    // (bisect run and submodule foreach: git's own options stop where the command it runs begins)
    const at = { bisect: 'run', submodule: 'foreach' }[v], cut = at ? own.findIndex(w => w.text === at) : -1;
    const o = GIT_LOOK.has(v) ? sortOpts(SORT_NOOPTS, []) : sortOpts(SORT_OPTS[`git:${v}`], cut < 0 ? own : own.slice(0, cut + 1)), p = o.plain;
    for (const c of v === 'rebase' ? o.all('x', 'exec') : v === 'difftool' ? o.all('x', 'extcmd') : []) sortElsewhere([c], ctx, r, `git ${v} -x`);
    if (cut >= 0 && v === 'bisect') sortProgram(own.slice(cut + 1), ctx, r, x);
    if (cut >= 0 && v === 'submodule') { const s = own.slice(cut + 1), n = s.findIndex(w => !/^(?:--recursive|-q|--quiet)$/.test(w.text)); sortElsewhere(n < 0 ? [] : s.slice(n), ctx, r, 'git submodule foreach'); }
    // (timers that run git by themselves, or settings written for every repository)
    if ((v === 'maintenance' && /^(?:start|register|schedule)$/.test(p[0]?.text ?? '')) || (v === 'lfs' && /^(?:install|update)$/.test(p[0]?.text ?? ''))) raise(r, 'risky', `git ${sortQ(v)} ${sortQ(p[0].text)} sets timers or settings later git commands run by themselves.`);
    if (v === 'config') {
      if (o.has('global', 'system', 'file', 'f')) raise(r, 'risky', 'git config --global, --system or --file changes what every later git command runs (aliases, hooks, pagers).');
      if (p[0]?.text === 'edit') unsure('git config edit opens an editor.');
      // (unsetting, or removing or renaming a section, writes the settings as setting does)
      const key = /^(?:set|unset|get|remove-section|rename-section)$/.test(p[0]?.text) ? p[1] : p[0], sets = /^(?:set|unset|remove-section|rename-section)$/.test(p[0]?.text) || (p[0]?.text !== 'get' && p.length >= 2) || o.has('add', 'replace-all', 'unset', 'unset-all', 'remove-section', 'rename-section');
      if (key && sets && (key.unknown || !GIT_PLAIN_KEYS.test(key.text))) raise(r, 'risky', `git config sets ${sortQ(key.text)}, which can decide what later git commands run (hooks, helpers, pagers, aliases): asked.`);
    }
    if (v === 'push' && p[0] && (p[0].unknown || /:\/\/|^[^/:]+:/.test(p[0].text))) raise(r, 'risky', `git push to ${sortQ(p[0].text)} writes on another machine, outside every wall and copy: asked (a push to a named remote is a change).`);
    else if (v === 'push' && /^[~/.]/.test(p[0]?.text ?? '')) sortTouch(p[0], ctx, r, true);
    if (/^(?:clone|pull|fetch|submodule)$/.test(v) || (v === 'lfs' && /^(?:pull|fetch)$/.test(p[0]?.text))) ctx.fetched = ctx.fetchSeen = true;
    // (git with a Spark or the home network, over ssh or an address: inside the wall no key and no route, so asked)
    if (/^(?:clone|fetch|pull|push|ls-remote|remote|submodule)$/.test(v)) for (const w of p) if (!w.unknown) usesReach(usesHost(w.text), ctx);
    const near = p.find(w => !w.unknown && sortNear((/^[a-z][\w+.-]*:\/\/(?:[^@/]*@)?(\[[^\]]*\]|[^/:?#]*)/i.exec(w.text) ?? /^(?:[^@/:]*@)?([^/:]+):(?!\/\/)/.exec(w.text))?.[1] ?? '', ctx));
    if (near) raise(r, 'risky', `git ${sortQ(v)} reaches ${sortQ(near.text)}, a Spark or the home network: inside the wall there is no key and no route there, so it is asked.`);
    if (v === 'stash' && o.has('u', 'a', 'include-untracked', 'all')) raise(r, 'risky', 'git stash -u or -a takes files git doesn’t track (or ignores) out of the folder, which the copy first doesn’t cover.');
    if (/^(?:clean|restore)$/.test(v) || (v === 'reset' && o.has('hard')) || (v === 'checkout' && (o.has('f', 'force') || rest.some(s => /^(?:--|\.)$/.test(s)))) || (v === 'stash' && /^(?:drop|clear)$/.test(p[0]?.text))) sortGone(ctx, r, `git ${sortQ(v)} throws away files or changes it doesn’t copy first.`);
    // A sub-command that changes the work tree writes what the repository or a patch holds, not what its words say: it
    // reaches the folder it stands in (-C's, or where a cd left it), everything under it; a clone, the folder it makes.
    if (/^(?:pull|checkout|switch|restore|merge|rebase|cherry-pick|revert|clean|bisect|sparse-checkout|am)$/.test(v) || (v === 'apply' && !(o.has('check', 'stat', 'numstat', 'summary') && !o.has('apply')))
      || (v === 'reset' && o.has('hard', 'merge', 'keep')) || (v === 'stash' && !/^(?:drop|clear|list|show)$/.test(p[0]?.text ?? '')) || (v === 'submodule' && /^(?:update|add|init)$/.test(p[0]?.text)) || (v === 'lfs' && /^(?:pull|checkout)$/.test(p[0]?.text))) sortGitOwn(dir, ctx, r);
    else if (dir) sortTouch(dir, ctx, r, true, false);
    if (v === 'clone') {
      const u = p[0]?.text ?? '', to0 = p[1] ?? { ...p[0], text: u.replace(/\/+$|\.git$/g, '').split(/[/:]/).pop() || '.' }, to = dir && !/^[~/]/.test(to0.text) ? { ...to0, text: `${dir.text}/${to0.text}` } : to0;
      sortGitOwn(to, ctx, r);
    }
    // (the words that name files it writes: a look's, those of a sub-command that changes the work tree, and -o)
    for (const w of GIT_LOOK.has(v) ? own : [...(/^(?:checkout|restore|reset|clean|stash|rm|mv|add|init|worktree|submodule|sparse-checkout)$/.test(v) && cut < 0 ? p : []), ...o.all('o', 'output', 'output-directory')]) sortTouch(w, ctx, r, v === 'worktree');
    if (o.unknown) unsure(`The sorter doesn’t know git ${sortQ(v)}’s option ${sortQ(o.unknown)}.`);
  },
  apt(a, ctx, r, x, name = 'apt') {
    if (a.some(w => /^-[oc]|^--(?:option|config-file)/.test(w.text))) unsure(`${sortQ(name)} -o or -c can make it run any command.`);
    const o = sortOpts(SORT_OPTS.apt, a), p = o.plain.map(w => w.text), v = p[0] ?? '';
    if (/^(?:list|show|search|policy|showsrc|depends|rdepends|madison)$/.test(v)) return;
    raise(r, 'change', `${sortQ(name)} ${sortQ(v)} changes the packages on that Spark.`);
    if (!/^(?:install|reinstall|remove|purge|autoremove|autopurge|update|upgrade|full-upgrade|dist-upgrade|satisfy|clean|autoclean|source|build-dep|download|changelog|check|dselect-upgrade)$/.test(v)) unsure(`The sorter doesn’t know ${sortQ(name)} ${sortQ(v)}.`);
    if (o.has('allow-unauthenticated', 'force-yes', 'allow-downgrades', 'allow-remove-essential', 'allow-change-held-packages')) raise(r, 'risky', `${sortQ(name)} is told to skip a check of its own (unsigned packages, downgrades, essential or held packages).`);
    if (/^(?:remove|purge|autoremove|autopurge)$/.test(v)) sortGone(ctx, r, `${sortQ(name)} ${sortQ(v)} removes packages, which are not put back.`);
    if (/^(?:upgrade|full-upgrade|dist-upgrade|dselect-upgrade)$/.test(v)) raise(r, 'risky', `${sortQ(name)} ${sortQ(v)} upgrades every package, the kernel and drivers among them.`);
    if (/^(?:install|reinstall|update|upgrade|full-upgrade|dist-upgrade|dselect-upgrade|satisfy|source|build-dep|download|changelog)$/.test(v)) ctx.reach.add('internet');
    sortPkgs(p.slice(1), ctx, r);
  },
  dpkg(a, ctx, r) {
    const t = a.map(w => w.text), v = t.find(s => s.startsWith('-')) ?? '';
    if (/^-[lLsSpcI]$|^--(?:list|listfiles|status|search|print-avail|get-selections|print-architecture|contents|info|audit)$/.test(v)) return;
    if (/^-[rP]$|^--(?:remove|purge)$/.test(v)) return sortGone(ctx, r, 'dpkg removes packages, which are not put back.');
    if (!/^-i$|^--(?:install|configure|unpack)$/.test(v)) unsure(`The sorter doesn’t know dpkg ${sortQ(v)}.`);
    raise(r, 'change', 'dpkg installs packages.');
    sortPkgs(t.filter(s => !s.startsWith('-')), ctx, r);
    const odd = a.find(w => w.unknown || (w.text.startsWith('-') && !/^-[iR]$|^--(?:install|configure|unpack|recursive|refuse-downgrade|skip-same-version|no-act|dry-run|simulate|no-triggers|force-confdef|force-confold|force-confnew|force-confmiss)$/.test(w.text)));
    if (odd) unsure(`The sorter doesn’t know dpkg’s option ${sortQ(odd.text)}.`);
  },
  pip(a, ctx, r, x, name = 'pip') {
    const o = sortOpts(SORT_OPTS.pip, a), p = o.plain.map(w => w.text), v = p[0] ?? '', logs = o.all('log', 'report');
    for (const w of logs) { raise(r, 'change', `${sortQ(name)} writes its log or report to ${sortQ(w.text)}.`); sortTouch(w, ctx, r); }
    if (logs.length && /^(?:list|show|freeze|check|help|inspect|debug|index)$/.test(v)) return;
    if (!v || /^(?:list|show|freeze|check|help|inspect|debug|index)$/.test(v) || (/^(?:config|cache)$/.test(v) && /^(?:list|get|dir|info|debug)$/.test(p[1]))) return;
    raise(r, 'change', `${sortQ(name)} ${sortQ(v)} changes the Python packages there.`);
    if (!/^(?:install|download|uninstall|wheel|config|cache|hash|completion|search|lock)$/.test(v)) unsure(`The sorter doesn’t know ${sortQ(name)} ${sortQ(v)}.`);
    if (v === 'config') raise(r, 'risky', `${sortQ(name)} config changes where every later install comes from.`);
    if (v === 'uninstall') return sortGone(ctx, r, `${sortQ(name)} uninstall removes packages, which are not put back.`);
    for (const s of a.map(w => w.text)) if (/:\/\/|^git\+/.test(s)) raise(r, 'risky', `${sortQ(name)} ${sortQ(v)} installs code from an address: ${sortQ(s)}, always asked.`);
    // (a list it installs, a folder of packages it takes from, a local path with or without [extras]: code that runs)
    // (a local package, a folder of them or an editable one: its own setup code runs, and no word shows it)
    const local = [...o.all('e', 'editable', 'f', 'find-links').filter(w => !/:\/\//.test(w.text)), ...o.plain.slice(1).filter(w => /^[.~/]|^file:|\.(?:whl|zip|tar\.gz)(?:\[[^\]]*\])?$/.test(w.text))];
    if (local.length) sortUnshown(r, `the setup code of the local package ${local[0].text}`);
    for (const f of [...o.all('r', 'requirement', 'c', 'constraint'), ...local].filter(w => !/:\/\//.test(w.text)).map(w => ({ ...w, text: w.text.replace(/\[[^\]]*\]$/, '').replace(/^file:(?:\/\/)?/, '') }))) sortRuns(f.text, ctx, r, `${sortQ(name)} ${sortQ(v)} ${sortQ(f.text)} builds and runs local code, or installs what a list names.`);
    for (const d of o.all('t', 'target', 'prefix', 'root')) sortInto(d, ctx, r);
    for (const d of o.all('d', 'dest')) sortTouch(d, ctx, r);
    // (an address it is handed, or the default index when none replaces it)
    for (const w of a) if (!w.unknown && /:\/\//.test(w.text)) usesReach(usesHost(w.text.replace(/^[^:]*?=|^git\+/, '')), ctx);
    if (/^(?:install|download|wheel|lock)$/.test(v) && !o.has('no-index') && !o.has('i', 'index-url')) ctx.reach.add('internet');
  },
  conda(a, ctx, r, x, name = 'conda') {
    const g = sortOpts(SORT_OPTS.conda, a, null, []), v = a[g.end]?.text ?? '', o = sortOpts(SORT_OPTS.conda, a.slice(g.end + 1)), p = o.plain.map(w => w.text);
    if (!v || /^(?:list|info|search)$/.test(v) || (/^(?:env|config)$/.test(v) && (p[0] === 'list' || o.has('show', 'get')))) return;
    if (v === 'run') {
      const ro = sortOpts(SORT_OPTS['conda:run'], a.slice(g.end + 1), null, []);
      sortUnshown(r, `the activation scripts of the environment ${name} run sets up`);
      sortRuns(null, ctx, r, `${sortQ(name)} run runs a program inside an environment.`);
      sortProgram(a.slice(g.end + 1 + ro.end).length ? a.slice(g.end + 1 + ro.end) : unsure(`${sortQ(name)} run with no program.`), ctx, r, x);
      if (ro.unknown) unsure(`The sorter doesn’t know ${sortQ(name)} run’s option ${sortQ(ro.unknown)}.`);
      return g.end + 1;
    }
    if (v === 'init' || (v === 'shell' && /^(?:init|deinit)$/.test(p[0]))) return raise(r, 'lockout', `${sortQ(name)} ${sortQ(v)} writes the shell’s start files (.bashrc and its kin), which the ways in run.`);
    raise(r, 'change', `${sortQ(name)} ${sortQ(v)} changes a Python environment.`);
    if (!/^(?:install|create|remove|uninstall|update|upgrade|env|config|clean|rename|compare|package|notices|doctor)$/.test(v) && !(v === 'shell' && p[0] === 'hook')) unsure(`The sorter doesn’t know ${sortQ(name)} ${sortQ(v)}.`);
    if (v === 'config') raise(r, 'risky', `${sortQ(name)} config changes where every later install comes from.`);
    const t = a.map(w => w.text);
    // (a channel that is a folder here is packages whose scripts run)
    for (const c of o.all('c', 'channel')) if (/^(?:[.~/]|file:)/.test(c.text)) sortUnshown(r, `the scripts of the packages in the folder ${c.text}`), sortRuns(c.text.replace(/^file:(?:\/\/)?/, ''), ctx, r, `${sortQ(name)} installs from the folder ${sortQ(c.text)}, whose packages' scripts run.`);
    if (t.some((s, i) => /:\/\//.test(s) && (/^-c$|^--channel$/.test(t[i - 1] ?? '') || /^--channel=|^-c./.test(s)))) raise(r, 'risky', `${sortQ(name)} installs from a channel at an address: always asked.`);
    if (/^(?:remove|uninstall)$/.test(v) || (v === 'env' && p[0] === 'remove')) sortGone(ctx, r, `${sortQ(name)} ${sortQ(v)} removes packages or an environment, which are not put back.`);
    // (env export -f writes the list; elsewhere -f is a list it installs)
    if (v === 'env' && p[0] === 'export' && ctx.root) raise(r, 'risky', `As root, ${sortQ(name)} env export is asked.`);
    for (const f of o.all('f', 'file')) if (v === 'env' && p[0] === 'export') { r.deletes = true; sortTouch(f, ctx, r); } else sortRuns(f.text, ctx, r, `${sortQ(name)} installs what the file ${sortQ(f.text)} lists.`);
    for (const w of o.plain) if (/^(?:\.{0,2}\/|~|file:)|\.(?:conda|tar\.bz2)$/.test(w.text)) sortUnshown(r, `the scripts of the local package ${w.text}`), sortRuns(w.text.replace(/^file:\/*/, '/'), ctx, r, `${sortQ(name)} installs the local package ${sortQ(w.text)}, whose scripts run.`);
    for (const d of o.all('p', 'prefix')) sortInto(d, ctx, r);
    for (const s of t) if (/:\/\//.test(s)) usesReach(usesHost(s.replace(/^[^:]*?=/, '')), ctx);
    if (/^(?:install|create|update|upgrade)$/.test(v) && !t.includes('--offline')) ctx.reach.add('internet');
  },
  npm(a, ctx, r, x, name = 'npm') {
    const o = sortOpts(SORT_OPTS.npm, a), p = o.plain.map(w => w.text), t = a.map(w => w.text), v = p[0] ?? (name === 'yarn' ? 'install' : '');
    if (!v || (/^(?:ls|list|ll|la|view|info|show|outdated|root|prefix|help|explain|why|config|get)$/.test(v) && !/^(?:set|delete|edit)$/.test(p[1] ?? ''))) return;
    if (/^(?:config|c|set)$/.test(v)) return raise(r, 'risky', `${sortQ(name)} ${sortQ(v)} changes where every later install comes from.`);
    if (/^(?:exec|x|dlx)$/.test(v) || (/^(?:init|create|innit)$/.test(v) && p.length > 1)) return raise(r, 'risky', `${sortQ(name)} ${sortQ(v)} downloads a package and runs it: always asked.`);
    raise(r, 'change', `${sortQ(name)} ${sortQ(v)} changes the packages there.`);
    if (v === 'explore') { const i = t.indexOf('--'); sortElsewhere(i < 0 ? [] : a.slice(i + 1), ctx, r, `${name} explore`); return i; }
    if (v === 'node' && name === 'yarn') { const i = t.indexOf('node'); sortProgram(a.slice(i), ctx, r, x); return i; }
    if (!/^(?:install|i|in|isnt|add|ci|clean-install|it|cit|install-test|uninstall|remove|rm|r|un|unlink|update|up|upgrade|run|run-script|start|test|t|restart|stop|build|rebuild|pack|version|link|ln|prune|dedupe|audit|fund|doctor|cache|whoami|ping|search|pkg|query|sbom|shrinkwrap|global|store|import|env|init|create|innit)$/.test(v)) unsure(`The sorter doesn’t know ${sortQ(name)} ${sortQ(v)}.`);
    if (t.some(s => /:\/\/|^git\+|^github:|^--registry/.test(s))) raise(r, 'risky', `${sortQ(name)} installs code from an address or another registry: always asked.`);
    // (an address or registry it is handed, else the default registry for what fetches packages)
    for (const s of t) if (/:\/\//.test(s)) usesReach(usesHost(s.replace(/^[^:]*?=|^git\+/, '')), ctx);
    if (/^(?:install|i|in|isnt|add|ci|clean-install|it|cit|install-test|update|up|upgrade|global)$/.test(v) && !t.some(s => /^--(?:registry|offline)/.test(s))) ctx.reach.add('internet');
    if (/^(?:uninstall|remove|rm|r|un|unlink|prune)$/.test(v)) sortGone(ctx, r, `${sortQ(name)} ${sortQ(v)} removes packages, which are not put back.`);
    // (an install runs the scripts of the project it stands in, as a run does: asked when this command wrote or
    // fetched into that folder, or as root)
    else if (/^(?:run|run-script|start|test|t|restart|stop|build|rebuild|pack|version|install-test|it|cit|install|i|in|isnt|add|ci|clean-install|update|up|upgrade|global|link|ln)$/.test(v)) { sortUnshown(r, `the scripts the project's package.json holds (${name} ${v})`); sortRuns(null, ctx, r, `${sortQ(name)} ${sortQ(v)} runs the project’s scripts.`, o.all('prefix').at(-1)); }
    // (a package from a folder or a file is code whose install scripts run)
    for (const w of o.plain.slice(1)) if (/^(?:\.{0,2}\/|~|file:)|\.(?:tgz|tar\.gz|tar)$/.test(w.text)) { sortUnshown(r, `the install scripts of the local package ${w.text}`); sortRuns(w.text.replace(/^file:/, ''), ctx, r, `${sortQ(name)} ${sortQ(v)} installs the local package ${sortQ(w.text)}, whose scripts run.`); }
  },
  docker(a, ctx, r, x, name = 'docker') {
    r.simple = false;
    sortOpen(ctx, r, `${sortQ(name)} needs the Docker socket, which the run wall hides (Docker is root by another name): free-form, it is always asked.`);
    const v = a.filter(w => !w.text.startsWith('-')).map(w => w.text);
    if (/^(?:rmi|rm|prune)$/.test(v[0]) || (/^(?:image|volume|container|system|builder|network|buildx)$/.test(v[0]) && /^(?:rm|remove|prune)$/.test(v[1]))) ctx.kinds.add('delete');
    // (what an image, a container, a Dockerfile or a compose file runs is in none of its words)
    if (v.some(t => /^(?:run|create|start|exec|build|buildx|compose|up|restart)$/.test(t))) sortUnshown(r, `what the image, container or file ${name} runs holds`);
  },
  hf(a, ctx, r, x, name = 'hf') {
    const o = sortOpts(SORT_OPTS.hf, a), p = o.plain.map(w => w.text);
    if (/^(?:env|version|scan-cache)$/.test(p[0]) || (p[0] === 'cache' && /^(?:ls|scan|list)$/.test(p[1]))) return;
    raise(r, 'change', `${sortQ(name)} ${sortQ(p[0] ?? '')} downloads or changes model files.`);
    if (!/^(?:download|delete-cache|cache|whoami|upload|upload-large-folder|repo|repo-files|tag|lfs-enable-largefiles|lfs-multipart-upload|jobs|login|logout|auth)$/.test(p[0] ?? '')) unsure(`The sorter doesn’t know ${sortQ(name)} ${sortQ(p[0])}.`);
    if (/^(?:upload|upload-large-folder|repo|repo-files|tag|lfs-\S+|jobs)$/.test(p[0])) raise(r, 'risky', `${sortQ(name)} ${sortQ(p[0])} changes files or runs jobs on the Hugging Face hub, another machine.`);
    if (/^(?:login|logout|auth)$/.test(p[0])) raise(r, 'risky', `${sortQ(name)} ${sortQ(p[0])} changes the Hugging Face sign-in on that Spark.`);
    if (p[0] === 'delete-cache' || (p[0] === 'cache' && /^(?:rm|delete|prune)$/.test(p[1]))) sortGone(ctx, r, `${sortQ(name)} ${sortQ(p[0])} removes downloaded models.`);
    // (a download goes where it says, or into the model store under the repository's own name: the whole store when the
    // name, its kind or the store is not plain)
    const d = o.all('local-dir').at(-1), id = o.plain[1], kind = o.all('repo-type').at(-1), cd = o.all('cache-dir').at(-1);
    const store = cd ?? { text: '~/.cache/huggingface/hub', bare: '', tilde: true, plain: true, subs: [] }, sure = [id, kind, cd].every(w => !w || !(w.unknown || w.glob || w.brace));
    if (d) sortInto(d, ctx, r);
    else if (p[0] === 'download' && id) sortInto(sure ? { ...store, text: `${store.text.replace(/\/+$/, '')}/${kind?.text ?? 'model'}s--${id.text.replace(/\//g, '--')}` } : store, ctx, r);
    // (what download names is fetched by name, not written there; it reaches the hub unless told to stay offline)
    for (const w of o.plain.slice(1)) sortTouch(w, ctx, r, false, true, p[0] === 'download');
    if (!/^(?:cache|delete-cache)$/.test(p[0]) && !/^(?:1|true|yes|on)$/i.test(ctx.setTo.get('HF_HUB_OFFLINE') ?? '')) ctx.reach.add('internet');
  },
  systemctl(a, ctx, r) {
    const o = sortOpts(SORT_OPTS.systemctl, a), t = a.map(w => w.text), user = o.has('user'), bus = user ? 'the owner’s service manager' : 'systemd’s bus';
    if (t.some(s => /^(?:-H|--host|-M|--machine)/.test(s))) unsure('systemctl -H or -M reaches another machine.');
    const plain = o.plain, v = plain[0]?.text ?? 'list-units', at = ctx.root && !user;
    if (plain[0]?.unknown) unsure('systemctl’s sub-command comes from a $ or a command.');
    if (SYSTEMCTL_POWER.test(v)) return raise(r, 'risky', `systemctl ${sortQ(v)}: power, so what runs on that Spark stops.`);
    if (/^(?:status|show|cat|list-\S+|is-\S+|get-default|show-environment|help)$/.test(v)) return at ? raise(r, 'change', `systemctl ${sortQ(v)} needs systemd’s bus, which a look’s wall hides.`) : sortOpen(ctx, r, `systemctl ${sortQ(v)} needs ${bus}, which the run wall hides.`);
    if (!SYSTEMCTL_CHANGE.test(v)) unsure(`The sorter doesn’t know systemctl ${sortQ(v)}.`);
    for (const u of plain.slice(1)) {
      if (u.unknown) unsure('systemctl names a unit through a $ or a command.');
      // (systemctl matches a pattern itself, quoted or not; an instance, name@x, is its template's unit)
      const pat = u.glob || /[*?[]/.test(u.text), base = u.text.replace(/@.*$/, '').replace(/\.(?:service|socket)$/, '');
      const is = n => (pat ? [n, `${n}.service`, `${n}.socket`].some(m => sortGlob(base).test(m) || sortGlob(u.text).test(m)) : base === n);
      if (WAYS_UNITS.some(is) || /^user@/.test(u.text) || /getty|^(?:netplan-|wpa_supplicant|iwd$|ModemManager$|network-manager$|dhcpcd|dhclient|connman$|NetworkManager)/.test(base)) raise(r, 'lockout', `${sortQ(u.text)} is a way in (SSH, Tailscale, the network, the firewall, the logins, or Spark Console itself).`);
      else if (at && /^(?:systemd-.+|emergency|rescue|debug-shell|initrd-.+|kexec|halt|poweroff|reboot|suspend|hibernate|hybrid-sleep|sleep|ctrl-alt-del|dbus|polkit|udev|cron|atd|snapd?)$/.test(base)) raise(r, 'risky', `As root, ${sortQ(u.text)} is one of systemd's own units, or one that powers the Spark down or runs jobs: asked.`);
      else if (['docker', 'containerd'].some(is)) raise(r, 'risky', `${sortQ(u.text)} is the Docker service.`);
      else if (/\.timer$/.test(u.text) && /^(?:start|enable|reenable|restart|link|unmask)$/.test(v)) raise(r, 'risky', `${sortQ(u.text)} is a timer: a job that runs by itself.`);
      if (at && (pat || !/^[A-Za-z0-9_-]+(?:\.service)?$/.test(u.text))) raise(r, 'risky', `As root, systemctl changes at once only a service named plainly, not ${sortQ(u.text)} (a pattern, a target, a slice, an instance, a path or another kind of unit).`);
    }
    if (/^(?:daemon-\S+|set-default|\S+-environment|preset-all)$/.test(v)) raise(r, 'risky', `systemctl ${sortQ(v)} changes how systemd runs every service.`);
    if (at && !/^(?:start|stop|restart|reload|enable|disable)$/.test(v)) raise(r, 'risky', `As root, systemctl ${sortQ(v)} is asked: only start, stop, restart, reload, enable and disable run at once.`);
    if (!at) sortOpen(ctx, r, `systemctl ${sortQ(v)} needs ${bus}, which the run wall hides.`); else raise(r, 'change', `systemctl ${sortQ(v)} changes a service.`);
  },
  service: (a, ctx, r, x) => (a[0]?.text === '--status-all' ? sortOpen(ctx, r, 'service --status-all needs systemd’s bus, which the run wall hides.')
    : SORT_HANDLERS.systemctl([a[1] ?? { text: 'status', subs: [] }, ...(a[0] ? [a[0]] : []), ...a.slice(2)], ctx, r, x)),
  loginctl(a, ctx, r) {
    const v = a.find(w => !w.text.startsWith('-'))?.text ?? 'list-sessions';
    if (/^(?:list-\S+|show-\S+|\S+-status)$/.test(v)) return sortOpen(ctx, r, `loginctl ${sortQ(v)} needs the login manager’s bus, which the run wall hides.`);
    if (SYSTEMCTL_POWER.test(v)) return raise(r, 'risky', `loginctl ${sortQ(v)}: power, so what runs on that Spark stops.`);
    raise(r, 'lockout', `loginctl ${sortQ(v)} changes sessions or linger, which keep the ways in running.`);
  },
});
// (what git itself writes in its handler is git's own: it leaves the folder git's; a program git runs is not git)
const sortGitBody = SORT_HANDLERS.git;
SORT_HANDLERS.git = (a, ctx, r, x, n) => { const was = ctx.gitTouch; ctx.gitTouch = true; try { return sortGitBody(a, ctx, r, x, n); } finally { ctx.gitTouch = was; } };
