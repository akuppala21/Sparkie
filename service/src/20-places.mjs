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
// word can make the sorter slow. Written (touched true): also a .py at the top of the home, and as root a path outside
// the folders a root command may change at once. Named anywhere in a change (touched 'seen'): the lists above.
const SORT_CWDS = 8, SORT_STEPS = 20000;
// A piece of the command inside a reason: one line, no control signs, cut short, marked as the command's own text.
const sortQ = s => { const t = String(s ?? '').replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]+/g, ' ').trim(); return `“${t.length > 60 ? `${t.slice(0, 59)}…` : t}”`; };

// Paths, as ~/… or /…; /proc/<id>/root is the same tree, and /proc/<id>/cwd or /fd lead somewhere the text can't show.
function sortNorm(p, r = null) {
  const out = [];
  for (const s of String(p).replace(/^~(?=\/|$)/, '/home/~').split('/').slice(1)) { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s); }
  let n = `/${out.join('/')}`;
  for (let m; (m = /^\/proc\/(?:self|thread-self|\d+)\/root(?=\/|$)/.exec(n));) n = n.slice(m[0].length) || '/';
  if (/^\/proc\/[^/]+\/(?:cwd|fd|fdinfo|root|map_files)(?:\/|$)/.test(n)) {
    if (r && (LOCK_NAMES.has(n.slice(n.lastIndexOf('/') + 1)) || SIGNIN.test(n))) raise(r, 'lockout', `It names ${sortQ(n)}, one of the ways in.`);
    unsure(`It reaches a file through ${sortQ(n)}, which the sorter can't place.`);
  }
  return n.replace(/^\/home\/[^/]+(?=\/|$)|^\/root(?=\/|$)/, '~');
}
const sortPaths = (c0, ctx, r = null) => {
  const c = String(c0).replace(/^\/proc\/(?:self|thread-self)\/cwd(?:\/|$)/, '').replace(/^$/, '.');
  return /^[~/]/.test(c) ? [sortNorm(c, r)] : [...ctx.cwds].map(d => (d == null ? unsure(`It names ${sortQ(c)} after a cd the sorter can't follow.`) : sortNorm(`${d}/${c}`, r)));
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
  const e = p.indexOf(']', i + 2);
  if (e < 0) return ch === '[' ? i + 1 : -1;
  const neg = p[i + 1] === '!' || p[i + 1] === '^', body = p.slice(neg ? i + 2 : i + 1, e);
  let hit = false;
  for (let k = 0; k < body.length; k++) {
    if (body[k + 1] === '-' && k + 2 < body.length) { hit ||= ch >= body[k] && ch <= body[k + 2]; k += 2; } else hit ||= ch === body[k];
  }
  return hit !== neg ? e + 1 : -1;
}
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
// Whether a path p (a glob when glob) reaches q: q itself, a path under q, or, when wide, a folder above q. Loose, a glob
// with its wildcard in its last part also reaches what is under the folder it is in (the careful reading of a way in).
function sortReach(p, glob, wide, loose = true) {
  if (!glob) return q => p === q || p.startsWith(`${q}/`) || (wide && (q.startsWith(`${p}/`) || p === '/' || (p === '/home' && q.startsWith('~'))));
  const g = sortGlob(p), fixed = p.slice(0, p.search(/[*?[]/)).replace(/\/[^/]*$/, '') || '/', dir = sortGlob(p.slice(0, p.lastIndexOf('/')) || '/');
  const last = loose && !/[*?[]/.test(p.slice(0, p.lastIndexOf('/'))), segs = p.split('/');
  const under = q => { const n = q.split('/').length; return n < segs.length && sortGlob(segs.slice(0, n).join('/')).test(q); };
  return q => g.test(q) || dir.test(q) || under(q) || fixed === q || fixed.startsWith(`${q}/`) || (last && q.startsWith(`${fixed === '/' ? '' : fixed}/`)) || (wide && sortUp(q).some(a => g.test(a)));
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
const LOCK_NAMES = new Set('authorized_keys authorized_keys2 sshd_config sudoers .ssh .bashrc .bash_profile .bash_login .bash_logout .profile .zshrc .zprofile .zshenv .zlogin .pam_environment .cshrc .tcshrc .login .kshrc .mkshrc'.split(' '));
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
// Where a root command may write at once: a home, /etc less the lists above, /opt, /srv, /mnt, /data, /tmp, /var/tmp,
// /var/www, and below /usr/local but its bin and sbin.
const ROOT_OK = /^(?:~(?:\/|$)|\/(?:etc|opt|srv|mnt|data|tmp|var\/tmp|var\/www)\/|\/usr\/local\/(?!s?bin(?:\/|$)))/;

// Names that are risky wherever they stand in a change: Spark Console's own files and units, the brain's names.
function sortNames(p, ctx, r, glob = false) {
  const bits = glob ? p.split(/[*?/]|\[[^\]]*\]/).filter(b => b.length >= 4) : [], names = n => p.includes(n) || bits.some(b => n.includes(b));
  if (/spark-console-root|root-for-sparkie/.test(p)) { r.answer = 'owner command'; raise(r, 'notdone', 'It names the root helper or its sudo line, which only the owner’s one-time command puts in place or changes.'); }
  if (SIGNIN.test(p)) raise(r, 'lockout', `${sortQ(p)} is Spark Console’s own unit or one of its sign-in files, a way in.`);
  else if (['spark-console', 'spark-portal'].some(names)) raise(r, 'risky', `It names Spark Console’s own files, state or units: ${sortQ(p)}.`);
  for (const b of ctx.brain) if (names(b)) { ctx.kinds.add('brain'); raise(r, 'risky', `It names the brain (its container, model files or setup): ${sortQ(p)}.`); }
}
function sortPlace(p, glob, ctx, r, wide, touched = false) {
  if (++ctx.steps > SORT_STEPS) unsure('It names more places than the sorter reads.');
  sortNames(p, ctx, r, glob);
  const hits = sortReach(p, glob, wide), base = p.slice(p.lastIndexOf('/') + 1);
  if (HELPER_PATHS.some(sortReach(p, glob, wide, false))) { r.answer = 'owner command'; raise(r, 'notdone', `It reaches ${sortQ(p)}, the root helper or its sudo line, which only the owner’s one-time command changes.`); }
  if (LOCK_PATHS.some(hits) || WAYS_FILE.test(p) || (glob && /\/systemd\//.test(p) && WAYS_UNITS.some(u => ['service', 'socket', 'timer'].some(x => sortGlob(base).test(`${u}.${x}`)))) || (glob ? base.replace(/[*?]|\[[^\]]*\]/g, '').length > 2 && [...LOCK_NAMES].some(n => sortGlob(base).test(n)) : LOCK_NAMES.has(base))) raise(r, 'lockout', `It names ${sortQ(p)}, one of the ways in (SSH, users and sudo, shell start files, the network, the firewall, Tailscale, or Spark Console’s sign-in).`);
  for (const [x, what, del, at] of RISKY_PATHS) if (x.test(p) || (wide && p === '/') || ((glob || wide) && at.some(hits))) { if (del) ctx.kinds.add('delete'); raise(r, 'risky', `It names ${sortQ(p)}: ${what}.`); }
  if (!touched) return;
  if (LATER_PATHS.some(hits) || (touched === true && /^~\/[^/]+\.py$/.test(p))) raise(r, 'risky', `It changes ${sortQ(p)}: a program or a setting that something outside the wall later runs or reads.`);
  if (touched === true && ctx.root && !ROOT_OK.test(glob ? `${p.slice(0, p.search(/[*?[]/)).replace(/\/[^/]*$/, '') || '/'}/x` : p)) raise(r, 'risky', `As root it changes ${sortQ(p)}, outside the folders a root command may change at once.`);
}
// A word as the paths it can name: itself, what follows = or @, what follows a one-letter option (-opath), file://.
const sortCands = t => [...new Set([/^-/.test(t) ? null : t, /^-[^=]*=(.+)$/.exec(t)?.[1], /^[A-Za-z_]\w*=(.+)$/.exec(t)?.[1], /^-\w(.+)$/.exec(t)?.[1], /^[\w-]*=?@(.+)$/.exec(t)?.[1],
  /^file:\/\/(\/.*)$/.exec(t)?.[1]].filter(c => c && !c.startsWith('-')))];
// A word the command changes ({a,b} spelled out), wide when it reaches everything under a folder it names; what it
// writes is kept, so a file this same command wrote and then runs is known.
function sortTouch(w, ctx, r, wide = false, write = true) {
  if (!w) return;
  if (w.unknown) unsure(`It names a file through a $ or a command, so the sorter can't know what it changes: ${sortQ(w.text || '…')}.`);
  if (w.text.includes('\n')) unsure('It names a file with a line break in its name.');
  for (const t of sortBraces(w.text)) for (const c of sortCands(t)) for (const p of sortPaths(c, ctx, r)) {
    sortPlace(p, w.glob, ctx, r, wide, true);
    if (write) (wide ? ctx.under : ctx.written).add(p);
  }
}
const sortWrote = (p, ctx) => ctx.written.has(p) || [...ctx.under].some(u => p === u || p.startsWith(`${u}/`));
// Names in text the words alone don't show (inside a one-liner, a command over ssh, text the sorter couldn't read);
// with progs, programs too.
function sortScan(text, ctx, r, progs, touched = false) {
  for (const s of text.replace(/\$\{HOME\}|\$HOME\b/g, '~').split(/[\s;&|()<>`'"=,{}]+/)) {
    if (!s) continue;
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
    for (const t of sortBraces(w.text)) for (const c of sortCands(t)) for (const p of sortPaths(c, ctx, r)) sortPlace(p, w.glob, ctx, r, false, 'seen');
    sortScan(w.text, ctx, r, false, 'seen');
  }
}
