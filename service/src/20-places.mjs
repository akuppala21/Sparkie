/* ───────── the sorter's places: which paths and names are ways in, risky or the helper's (design A 2.8) ───────── */
// Area: safety        Rules: R55        Tests: sort.test.mjs
// Owns: none
// Timers: none        Wakes: none
// What a path a command names is, for the sorter (20-sort.mjs): one of the ways in (lockout), the root helper or its sudo
// line (not done), a risky place (a disk or device, the kernel, a schedule, Docker's settings), a program or setting that
// something outside the wall later runs or reads (risky when written), Spark Console's own files or the brain's
// (risky). A path is placed as ~/… (any home) or /…, from each folder a cd may have left the command in, with
// /proc/<id>/root taken off the front. "Wide" is a command that reaches everything under a folder it names (rm -r, chmod,
// a folder an archive unpacks into): then a folder above a protected path counts too. A glob counts when it could match
// one, or when its fixed folder is at or under one; it is matched segment by segment, with no regular expression, so no
// word can make the sorter slow. Written (touched true): also Python at the top of the home (x.py, .pyc, .so, .pth,
// x/__init__.py), and a git hook or a repository's settings. Named anywhere in a change (touched 'seen', a path word,
// or 'bare', a plain word read from where the command starts): the lists above; as root, a path word or a written
// path outside the folders a root command may change at once is risky.
const SORT_CWDS = 8, SORT_STEPS = 20000, SORT_PLACED = 256, SORT_PATH = 1000;
// A piece of the command inside a reason: one line, no control signs, cut short, marked as the command's own text.
const sortQ = s => { const t = String(s ?? '').replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]+/g, ' ').trim(); return `“${t.length > 60 ? `${t.slice(0, 59)}…` : t}”`; };

// Paths, as ~/… or /…; /proc/<id>/root is the same tree, and /proc/<id>/cwd or /fd lead somewhere the text can't show.
// Only the owner's home (home) becomes ~; root's (/root), another user's home, /home itself, or a path that climbs out
// of the home stays what it is (root's ways in are listed under /root too). With no home known, ~ is a home no path spells.
function sortNorm(p, r = null, home = null) {
  const out = [], h = home ?? '/home/~';
  for (const s of String(p).replace(/^~(?=\/|$)/, h).split('/').slice(1)) { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s); }
  let n = `/${out.join('/')}`;
  for (let m; (m = /^\/proc\/(?:self|thread-self|\d+)(?:\/task\/\d+)?\/root(?=\/|$)/.exec(n));) n = n.slice(m[0].length) || '/';
  // (and /dev/fd/N or /dev/stdin as a folder, or a descriptor past the three a command starts with)
  if (/^\/proc\/[^/]+\/(?:cwd|fd|fdinfo|root|map_files)(?:\/|$)|^\/dev\/(?:fd|std(?:in|out|err))(?:\/|$)/.test(n)) {
    if (r && (LOCK_NAMES.has(n.slice(n.lastIndexOf('/') + 1)) || SIGNIN.test(n))) raise(r, 'lockout', `It names ${sortQ(n)}, one of the ways in.`);
    unsure(`It reaches a file through ${sortQ(n)}, which the sorter can't place.`);
  }
  return n === h || n.startsWith(`${h}/`) ? `~${n.slice(h.length)}` : n;
}
// (a glob that could match the owner's home, /home/*, is that home too)
const sortAtHome = (p, home) => {
  if (!home || !/[*?[]/.test(p)) return [p];
  const hs = home.split('/'), ps = p.split('/'), k = Math.min(ps.length, hs.length);
  if (!hs.slice(0, k).every((s, i) => sortSeg(ps[i], s))) return [p];
  return [p, ps.length >= hs.length ? ['~', ...ps.slice(hs.length)].join('/') : hs.slice(0, k).join('/')];
};
const sortPaths = (c0, ctx, r = null) => {
  const c = String(c0).replace(/^\/proc\/(?:self|thread-self)(?:\/task\/\d+)?\/cwd(?:\/|$)/, '').replace(/^$/, '.');
  return (/^[~/]/.test(c) ? [sortNorm(c, r, ctx.home)] : [...ctx.cwds].map(d => (d == null ? unsure(`It names ${sortQ(c)} after a cd the sorter can't follow.`) : sortNorm(`${d}/${c}`, r, ctx.home))))
    .flatMap(p => sortAtHome(p, ctx.home));
};
// A folder a cd may leave the command in; past SORT_CWDS of them a relative path can't be placed.
function sortCd(p, ctx) {
  ctx.cwds.add(p);
  if (ctx.cwds.size > SORT_CWDS) unsure(`It changes folder more than ${SORT_CWDS} ways, more than the sorter follows.`);
}
// A glob as bash matches it, one segment against one segment: * ? [abc] [!a-z], no dot file unless the word says so.
function sortGlob(g) {
  const segs = String(g).split('/');
  return { test: s => { const t = String(s).split('/'); return t.length === segs.length && segs.every((p, i) => sortSeg(p, t[i])); } };
}
function sortSeg(p, s) {
  if (s.startsWith('.') && !p.startsWith('.') && !p.startsWith('[.')) return false;
  let i = 0, j = 0, star = -1, mark = 0;
  while (j < s.length) {
    const k = p[i] === '*' ? -2 : p[i] === '[' ? sortClass(p, i, s[j]) : p[i] !== undefined && (p[i] === '?' || p[i] === s[j]) ? i + 1 : -1;
    if (k === -2) { star = i++; mark = j; continue; }
    if (k >= 0) { i = k; j++; continue; }
    if (star < 0) return false;
    i = star + 1; j = ++mark;
  }
  while (p[i] === '*') i++;
  return i === p.length;
}
function sortClass(p, i, ch) {
  // (a ] first in the set, after ! or ^ too, is one of its signs; a [ is a class only before : . or =)
  const neg0 = p[i + 1] === '!' || p[i + 1] === '^', inner = p.indexOf('[', i + 1), first = p.indexOf(']', i + (neg0 ? 3 : 2));
  if (inner > i && (first < 0 || inner < first) && /[:.=]/.test(p[inner + 1] ?? '')) {
    const c = p.slice(inner).search(/[:.=]\]/), end = c < 0 ? -1 : p.indexOf(']', inner + c + 2);
    return end < 0 ? (ch === '[' ? i + 1 : -1) : end + 1;
  }
  const e = first;
  if (e < 0) return ch === '[' ? i + 1 : -1;
  const neg = p[i + 1] === '!' || p[i + 1] === '^', body = p.slice(neg ? i + 2 : i + 1, e);
  let hit = false;
  for (let k = 0; k < body.length; k++) {
    if (body[k + 1] === '-' && k + 2 < body.length) { hit ||= ch >= body[k] && ch <= body[k + 2]; k += 2; } else hit ||= ch === body[k];
  }
  return hit !== neg ? e + 1 : -1;
}
const sortUp = q => q.split('/').slice(0, -1).map((_, j, a) => a.slice(0, j + 1).join('/') || '/');
// A {…} as bash reads it: one holding another (even {}) and making words is a doubt, as is a range padded below zero.
const sortNested = s => { for (let i = s.indexOf('{'); i >= 0; i = s.indexOf('{', i + 1)) { let d = 0, inner = false, top = false; for (let j = i; j < s.length; j++) { if (s[j] === '{') { if (++d > 1) inner = true; } else if (s[j] === '}') { if (--d === 0) break; } else if (d === 1 && (s[j] === ',' || s.startsWith('..', j))) top = true; } if (inner && top) return true; } return false; };
// A word's {…} spelled out as bash does: the first {…} with a comma at its own level, or a range, left to right, each
// part again; one with neither stays as written ({}, {b}). A range is spelled in full (1..3; 01..10 and 1..010 padded
// and not, as bash 4 and later and older bash read it; a..d); a step, ends of two kinds, or a padded one below zero is a
// doubt. One inside another is spelled out too, for the places it may reach, and is then a doubt (doubt, after).
function sortBraces(s) {
  const nested = sortNested(s);
  const one = t => {
    for (let i = t.indexOf('{'); i >= 0; i = t.indexOf('{', i + 1)) {
      let d = 0, j = i;
      const commas = [];
      for (; j < t.length; j++) { if (t[j] === '{') d++; else if (t[j] === '}') { if (--d === 0) break; } else if (t[j] === ',' && d === 1) commas.push(j); }
      if (j >= t.length) continue;
      const body = t.slice(i + 1, j), pre = t.slice(0, i), post = t.slice(j + 1);
      if (commas.length) return [i + 1, ...commas.map(c => c + 1)].map((k, x) => pre + t.slice(k, x < commas.length ? commas[x] : j) + post);
      if (!body.includes('..') || /[{}]/.test(body)) continue;
      const n = /^(?:(-?\d+)\.\.(-?\d+)|([a-z])\.\.([a-z]))$/i.exec(body);
      if (!n) unsure('It holds a {…} range the sorter does not spell out (a step, or ends of two kinds).');
      const [lo, hi] = n[1] != null ? [+n[1], +n[2]] : [n[3].charCodeAt(0), n[4].charCodeAt(0)];
      if (Math.abs(hi - lo) > 64) unsure('It holds a {a..b} range too long to read.');
      if (n[1] != null && (/^-0\d/.test(n[1]) || /^-0\d/.test(n[2]))) unsure('It holds a {…} range padded below zero, which the sorter does not spell out.');
      const pad = n[1] != null && (/^0\d/.test(n[1]) || /^0\d/.test(n[2])) ? Math.max(n[1].length, n[2].length) : 0, run = Array.from({ length: Math.abs(hi - lo) + 1 }, (_, k) => Math.min(lo, hi) + k);
      return (n[1] != null ? [...new Set([...run.map(v => String(v).padStart(pad, '0')), ...run.map(String)])] : run.map(v => String.fromCharCode(v))).map(x => pre + x + post);
    }
    return null;
  };
  let out = [s];
  for (let round = 0; round < 16; round++) {
    let more = false;
    out = out.flatMap(t => { const x = one(t); if (x) more = true; return x ?? [t]; });
    if (out.length > 64) unsure('It holds {…} that makes too many words to read.');
    if (!more) return Object.assign(out, { doubt: nested ? 'It holds a {…} inside a {…}, which the sorter does not spell out as bash does.' : null });
  }
  return unsure('It holds {…} nested too deep to read.');
}
// Whether a path p (a glob when glob) reaches q: q itself, a path under q, or, when wide, a folder above q. Loose, a glob
// with its wildcard in its last part also reaches what is under the folder it is in (the careful reading of a way in).
function sortReach(p, glob, wide, loose = true) {
  if (!glob) return q => p === q || p.startsWith(`${q}/`) || (wide && (q.startsWith(`${p}/`) || p === '/' || (p === '/home' && q.startsWith('~'))));
  const g = sortGlob(p), fixed = p.slice(0, p.search(/[*?[]/)).replace(/\/[^/]*$/, '') || '/', dir = sortGlob(p.slice(0, p.lastIndexOf('/')) || '/');
  const last = loose && !/[*?[]/.test(p.slice(0, p.lastIndexOf('/'))), segs = p.split('/'), at = fixed === '/' ? 1 : fixed.split('/').length;
  const under = q => { const n = q.split('/').length; return n < segs.length && sortGlob(segs.slice(0, n).join('/')).test(q); };
  return q => g.test(q) || dir.test(q) || under(q) || fixed === q || fixed.startsWith(`${q}/`) || (last && q.startsWith(`${fixed === '/' ? '' : fixed}/`) && sortSeg(segs[at] ?? '', q.split('/')[at] ?? '')) || (wide && sortUp(q).some(a => g.test(a)));
}

// The ways in (design A 2.8's lock-out class): SSH, users and sudo, PAM and the shell's start files, the network and the
// firewall, Tailscale, linger, logins, the units that start them, Spark Console's own sign-in.
const LOCK_PATHS = ['/etc/ssh', '/etc/ssh/sshd_config', '~/.ssh', '~/.ssh/authorized_keys', '/etc/sudoers', '/etc/sudoers.d', '/etc/sudo.conf',
  '/etc/passwd', '/etc/passwd-', '/etc/group', '/etc/group-', '/etc/shadow', '/etc/gshadow', '/etc/subuid', '/etc/subgid', '/etc/login.defs',
  '/etc/pam.d', '/etc/security', '/etc/nsswitch.conf', '/etc/profile', '/etc/profile.d', '/etc/bash.bashrc', '/etc/environment', '/etc/zsh',
  '~/.config/environment.d', '/etc/netplan', '/etc/NetworkManager', '/etc/network', '/etc/hosts', '/etc/hostname', '/etc/resolv.conf',
  '/etc/systemd/network', '/etc/systemd/resolved.conf', '/etc/systemd/resolved.conf.d', '/etc/hosts.allow', '/etc/hosts.deny', '/etc/iproute2',
  '/etc/wpa_supplicant', '/etc/ufw', '/etc/default/ufw', '/etc/iptables', '/etc/nftables.conf', '/etc/firewalld', '/var/lib/tailscale',
  '/etc/default/tailscaled', '/etc/default/ssh', '/var/lib/systemd/linger', '/etc/nologin', '/run/nologin', '~/.config/spark-console',
  '/etc/systemd/system/multi-user.target.wants/ssh.service', '/etc/systemd/system/multi-user.target.wants/tailscaled.service',
  '/etc/systemd/system/sockets.target.wants/ssh.socket', '/etc/systemd/system/sshd.service',
  ...'access.json sessions.json passkeys.json agents.json telegram.json api.sock'.split(' ').map(f => `~/.local/state/spark-console/${f}`)];
LOCK_PATHS.push(...LOCK_PATHS.filter(p => p.startsWith('~/')).map(p => `/root${p.slice(1)}`));
const LOCK_NAMES = new Set('authorized_keys authorized_keys2 sshd_config sudoers .ssh .bashrc .bash_aliases .bash_profile .bash_login .bash_logout .profile .zshrc .zprofile .zshenv .zlogin .pam_environment .cshrc .tcshrc .login .kshrc .mkshrc'.split(' '));
const WAYS_UNITS = ['ssh', 'sshd', 'tailscaled', 'NetworkManager', 'systemd-networkd', 'systemd-resolved', 'networking', 'ufw', 'nftables',
  'netfilter-persistent', 'firewalld', 'iptables', 'wpa_supplicant', 'systemd-logind', 'dbus', 'spark-console-api', 'spark-console-watchdog'];
const WAYS_FILE = new RegExp(`(?:^|/)(?:${WAYS_UNITS.join('|')})\\.(?:service|socket|timer)(?:\\.d)?(?:/|$)`);
const SIGNIN = /spark-console\/(?:access\.json|sessions\.json|passkeys\.json|agents\.json|telegram\.json|agent-settings\.json)|(?:^|\/)api\.sock$|spark-console-(?:api|watchdog)/;
// The root helper and its sudo line: changed only by the owner's one-time command.
const HELPER_PATHS = ['/usr/local/sbin/spark-console-root', '/etc/sudoers.d/spark-console-root'];
// Risky to name in a change: [the test, what it is, whether what goes can't be put back, the places a glob may match].
const RISKY_PATHS = [
  [/^\/dev\/(?!(?:null|zero|full|random|urandom|tty|stdin|stdout|stderr|shm|pts|fd)(?:\/|$))|^\/etc\/(?:fs|crypt)tab$/, 'a disk or a device', true, '/dev/sda /dev/nvme0n1 /dev/mem /etc/fstab /etc/crypttab'],
  [/^\/(?:boot|lib\/modules|usr\/lib\/modules|lib\/firmware|usr\/lib\/firmware|proc\/sys|sys)(?:\/|$)|^\/proc\/sysrq-trigger$|^\/etc\/(?:default\/grub|modprobe\.d|modules|modules-load\.d|sysctl\.conf|sysctl\.d|initramfs-tools|dkms)(?:\/|$)/, 'the kernel, a driver or firmware', false,
    '/boot /lib/modules /usr/lib/modules /lib/firmware /usr/lib/firmware /proc/sys /sys /proc/sysrq-trigger /etc/default/grub /etc/modprobe.d /etc/modules /etc/modules-load.d /etc/sysctl.conf /etc/sysctl.d /etc/initramfs-tools /etc/dkms'],
  [/^\/etc\/(?:cron|anacrontab)|^\/var\/spool\/(?:cron|at)(?:\/|$)|\.timer$/, 'a schedule, a job that runs by itself', false, '/etc/crontab /etc/cron.d /etc/cron.daily /etc/cron.hourly /etc/anacrontab /var/spool/cron /var/spool/at'],
  [/^\/(?:etc|var\/lib)\/(?:docker|containerd)(?:\/|$)|(?:^|\/)docker\.sock$/, 'the Docker service and its settings', false, '/etc/docker /var/lib/docker /etc/containerd /var/lib/containerd /var/run/docker.sock /run/docker.sock'],
].map(([x, what, del, at]) => [x, what, del, at.split(' ')]);
// Written, risky: what something outside the wall later runs or reads (the PATH, user units, start-up, tool settings,
// the Python a worker imports, the console's own folders).
const LATER_PATHS = ['~/.local/bin', '~/bin', '~/.config/systemd', '~/.config/autostart', '~/.config/user-tmpfiles.d', '~/.config/fish',
  '~/.local/share/systemd', '~/.local/share/user-tmpfiles.d', '~/.curlrc', '~/.config/curlrc', '~/.docker', '~/.local/opt', '~/.local/lib',
  '~/.config/code-server', '~/.local/share/code-server', '~/.cache/spark-console', '~/.gitconfig', '~/.config/git', '~/.npmrc', '~/.pip',
  '~/.config/pip', '~/.condarc', '~/.pypirc', '/bin', '/sbin', '/usr/bin', '/usr/sbin', '/usr/local/bin', '/usr/local/sbin', '/etc/ld.so.preload',
  '/etc/ld.so.conf', '/etc/ld.so.conf.d', '/etc/apt/sources.list', '/etc/apt/sources.list.d', '/etc/apt/apt.conf.d', '/etc/pip.conf', '/etc/gitconfig'];
LATER_PATHS.push(...LATER_PATHS.filter(p => p.startsWith('~/')).map(p => `/root${p.slice(1)}`));
// Where a root command may write at once: a home (the owner's, root's), /etc less the lists above, /opt, /srv, /mnt, /data, /tmp, /var/tmp,
// /var/www, and below /usr/local but its bin and sbin.
const ROOT_OK = /^(?:~(?:\/|$)|\/root(?:\/|$)|\/(?:etc|opt|srv|mnt|data|tmp|var\/tmp|var\/www)\/|\/usr\/local\/(?!s?bin(?:\/|$)))/;

// Names that are risky wherever they stand in a change: Spark Console's own files and units, the brain's names (a
// folder that is only a * counts where they live).
const SORT_HOLDERS = /^(?:~\/\.config(?:\/systemd\/user)?|~\/\.local\/(?:state|share)|~\/\.cache(?:\/huggingface\/hub)?|~\/models|\/etc\/systemd\/system|\/opt|\/var\/lib\/docker\/\w+)$/;
function sortNames(p, ctx, r, glob = false) {
  const segs = glob ? p.split('/').filter((s, i, a) => /[*?[]/.test(s) && (/[^*?]/.test(s.replace(/\[[^\]]*\]/g, '')) || SORT_HOLDERS.test(a.slice(0, i).join('/')))) : [];
  const bits = segs.flatMap(s => s.split(/[*?[\]]/)).filter(b => b.length >= 4);
  const names = n => p.includes(n) || bits.some(b => n.includes(b)) || segs.some(s => sortSeg(s, n) || sortSeg(s, `models--${n}`));
  if (/spark-console-root|root-for-sparkie/.test(p)) { r.answer = 'owner command'; raise(r, 'notdone', 'It names the root helper or its sudo line, which only the owner’s one-time command puts in place or changes.'); }
  if (SIGNIN.test(p)) raise(r, 'lockout', `${sortQ(p)} is Spark Console’s own unit or one of its sign-in files, a way in.`);
  else if (['spark-console', 'spark-portal'].some(names)) raise(r, 'risky', `It names Spark Console’s own files, state or units: ${sortQ(p)}.`);
  for (const b of ctx.brain) if (names(b)) { ctx.kinds.add('brain'); raise(r, 'risky', `It names the brain (its container, model files or setup): ${sortQ(p)}.`); }
}
function sortPlace(p, glob0, ctx, r, wide, touched = false) {
  if (++ctx.steps > SORT_STEPS) unsure('It names more places than the sorter reads.');
  const glob = glob0 && /[*?[]/.test(p);
  if (p.length > SORT_PATH) unsure(`It names a path longer than the ${SORT_PATH} signs the sorter places.`);
  sortNames(p, ctx, r, glob);
  const hits = sortReach(p, glob, wide), base = p.slice(p.lastIndexOf('/') + 1);
  if (HELPER_PATHS.some(sortReach(p, glob, wide, false))) { r.answer = 'owner command'; raise(r, 'notdone', `It reaches ${sortQ(p)}, the root helper or its sudo line, which only the owner’s one-time command changes.`); }
  if (LOCK_PATHS.some(hits) || WAYS_FILE.test(p) || (glob && /\/systemd\//.test(p) && p.split('/').some(g => /[*?[]/.test(g) && WAYS_UNITS.some(u => ['service', 'socket', 'timer'].some(x => sortSeg(g, `${u}.${x}`) || sortSeg(g, `${u}.${x}.d`))))) || (glob ? (base.startsWith('.') || base.replace(/[*?]|\[[^\]]*\]/g, '').length > 2) && [...LOCK_NAMES].some(n => sortGlob(base).test(n)) : LOCK_NAMES.has(base))) raise(r, 'lockout', `It names ${sortQ(p)}, one of the ways in (SSH, users and sudo, shell start files, the network, the firewall, Tailscale, or Spark Console’s sign-in).`);
  for (const [x, what, del, at] of RISKY_PATHS) if (x.test(p) || (wide && p === '/') || ((glob || wide) && at.some(hits))) { if (del) ctx.kinds.add('delete'); raise(r, 'risky', `It names ${sortQ(p)}: ${what}.`); }
  if (!touched) return;
  if (touched === true && /^\/home(?:\/|$)/.test(p)) raise(r, 'risky', `It changes ${sortQ(p)}, under /home but outside the owner’s home.`);
  if (LATER_PATHS.some(hits) || (touched === true && (/^~\/[^/]+\.(?:py|pyc|pth|so)$|^~\/[^/]+\/__init__\.py$/.test(p) || sortGitSet(p)))) raise(r, 'risky', `It changes ${sortQ(p)}: a program or a setting that something outside the wall later runs or reads.`);
  if (ctx.root && touched !== 'bare' && !(touched === 'seen' && /^\/dev\/(?:null|zero|u?random|std(?:in|out|err))$/.test(p)) && !ROOT_OK.test(glob ? `${p.slice(0, p.search(/[*?[]/)).replace(/\/[^/]*$/, '') || '/'}/x` : p)) raise(r, 'risky', `As root it changes ${sortQ(p)}, outside the folders a root command may change at once.`);
}
// A git hook or a repository's settings, written: under a .git (its modules' too) or a bare x.git, by glob too.
const sortGitSet = p => { const g = p.split('/'), at = g.findIndex(x => sortSeg(x, '.git') || /\.git$/.test(x)); return at >= 0 && g.slice(at + 1).some((x, k, a) => sortSeg(x, 'hooks') || (k === a.length - 1 && sortSeg(x, 'config'))); };
// A word as the paths it can name: itself, what follows = or @, what follows a one-letter option (-opath), file://.
const sortTails = t => { const m = /^-([A-Za-z]{1,26})/.exec(t); return m ? Array.from({ length: m[1].length }, (_, k) => t.slice(k + 2)).filter(Boolean) : []; };
const sortCands = t => [...new Set([/^-/.test(t) ? null : t, /^-[^=]*=(.+)$/.exec(t)?.[1], /^[A-Za-z_]\w*=(.+)$/.exec(t)?.[1], ...sortTails(t), /^[\w-]*=?@(.+)$/.exec(t)?.[1],
  /^file:(?:\/\/)?(\/.*)$/.exec(t)?.[1]].filter(c => c && !c.startsWith('-')))];
// A word the command changes ({a,b} spelled out), wide when it reaches everything under a folder it names; what it
// writes is kept, so a file this same command wrote and then runs is known, and every place it changes (changes: what
// the runner copies first, at most SORT_PLACED places of at most SORT_PATH signs, none with a control sign).
// (read: a known program only reads it, a copy's or an archive's source: still placed, for the copy first, and noted
// apart, R64)
// (a redirection's word, and a word after --, is a name whatever its first sign: the word itself is a place too, R64)
const sortCandsOf = (w, t) => (w?.literal ? [...new Set([t, ...sortCands(t)])] : sortCands(t));
function sortTouch(w, ctx, r, wide = false, write = true, read = false) {
  if (!w) return;
  if (w.unknown) unsure(`It names a file through a $ or a command, so the sorter can't know what it changes: ${sortQ(w.text || '…')}.`);
  ctx.touched?.add(w);
  if (/[\x00-\x1f\x7f]/.test(w.text)) unsure('It names a file with a line break, a tab or another control sign in its name.');
  // (the class from every reading: each {…} spelled out, a quoted ~ as the home and as a folder named ~; the lists from
  // what bash writes: the word as written, spelled out only when the brace is bash's, a quoted ~ as a folder too)
  const all = sortBraces(w.text), lit = w.tilde === false && /^~(?:\/|$)/.test(w.text), at = (c, t) => (lit && c === t ? [c, `./${c}`] : [c]);
  for (const t of all) for (const c of sortCandsOf(w, t)) for (const p of new Set([...sortPaths(c, ctx, r), ...(lit && c === t ? sortPaths(`./${c}`, ctx, r) : [])])) {
    sortPlace(p, w.glob, ctx, r, wide, true);
    if (write) (wide ? ctx.under : ctx.written).add(p);
  }
  if (all.doubt) unsure(all.doubt);
  // (a write by another program where git owned the folder: its settings may have come with it)
  if (!ctx.gitTouch && ctx.cloned?.size) for (const t of all) for (const c of sortCandsOf(w, t)) for (const p of sortPaths(c, ctx, r)) for (const g of ctx.cloned) if (p === g || p.startsWith(`${g}/`) || g.startsWith(`${p}/`)) ctx.cloned.delete(g);
  if (!ctx.changes) return;
  for (const t of new Set([w.text, ...(w.brace ? all : [])])) for (const c of sortCandsOf(w, t)) for (const p of new Set(at(c, t).flatMap(x => sortPaths(x, ctx, r)))) {
    if (p.length > SORT_PATH) unsure(`It names a path longer than the ${SORT_PATH} signs the sorter places.`);
    if (!ctx.changes.has(p) && ctx.changes.size >= SORT_PLACED) unsure(`It changes more than ${SORT_PLACED} places, more than the sorter lists for the copy first.`);
    ctx.changes.set(p, ctx.changes.get(p) || wide);
    (read ? ctx.readOnly : ctx.wrote)?.add(p);
  }
}
const sortWrote = (p, ctx) => ctx.written.has(p) || [...ctx.under].some(u => p === u || p.startsWith(`${u}/`))
  || (ctx.before.length > 0 && ([p, ...sortUp(p)].some(a => ctx.beforePlain.has(a)) || ctx.beforeGlob.some(b => sortBefore(b, p, ctx))));
// A path written before this command (opts.written, a * kept): p is it or under it.
// (each pattern tested against p and each folder above it is a step of the work bound, so a full list can't make the
// sorter slow)
const sortBefore = (b, p, ctx) => {
  if (b === '/') return true;
  if (!/[*?[]/.test(b)) return p === b || p.startsWith(`${b}/`);
  const up = [p, ...sortUp(p)];
  if ((ctx.steps += up.length) > SORT_STEPS) unsure('It names more places than the sorter reads against what the task wrote before.');
  return up.some(a => sortGlob(b).test(a));
};
// Names in text the words alone don't show (inside a one-liner, a command over ssh, text the sorter couldn't read);
// with progs, programs too.
function sortScan(text, ctx, r, progs, touched = false) {
  for (const s of text.replace(/\$\{HOME\}|\$HOME\b/g, '~').split(/[\s;&|()<>`'"=,{}]+/)) {
    if (!s || (s.length > SORT_PATH && !touched)) continue;
    for (const p of sortCands(s)) {
      if (/^[~/.]/.test(p) || (p.includes('/') && !p.includes('://'))) for (const q of sortPaths(p, ctx, r)) sortPlace(q, /[*?[]/.test(p), ctx, r, false, touched);
      else sortNames(p, ctx, r);
    }
    if (LOCK_NAMES.has(s.split('/').pop())) raise(r, 'lockout', `It names ${sortQ(s)}, one of the ways in.`);
    const g = progs && SORT_PROGS[s];
    if (g) raise(r, { delete: 'risky', open: 'risky', device: 'change' }[g.cls] ?? g.cls, `It names ${sortQ(s)} inside text it runs: ${g.why}.`);
  }
}
// Every word of a command that is not a look, as a place it may change (relative ones from where a cd may have left it).
function sortSee(words, ctx, r) {
  for (const w of words) {
    if (w.unknown || ctx.programs.has(w)) continue;
    const all = sortBraces(w.text);
    for (const t of all) for (const c of sortCandsOf(w, t)) for (const p of sortPaths(c, ctx, r)) sortPlace(p, w.glob, ctx, r, false, /^[~/.]|\//.test(c) ? 'seen' : 'bare');
    if (all.doubt) unsure(all.doubt);
    sortScan(w.text, ctx, r, false, 'seen');
  }
}
