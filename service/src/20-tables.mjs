/* ───────── the sorter's tables: the programs it knows by what they do, and the wrappers ───────── */
// Area: safety        Rules: R55        Tests: sort.test.mjs
// Owns: none
// Timers: none        Wakes: none
// Moved out of 20-sort.mjs as it was (2026-11-15, no word changed): the programs that only read (SORT_READS), the file
// tools (SORT_FILES), the programs past a change by class (SORT_PROGS), the lock-out programs' forms that only read
// (SORT_VERBS, sortShows, SORT_LOCK_READS), and the wrappers that run the command after their own options (SORT_WRAP,
// sortWrap). 20-sort.mjs reads a command through them.
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
  ['risky', 'dockerd containerd setcap capsh mknod nc ncat netcat update-alternatives', 'the system itself, outside what the ladder covers'],
  ['open', 'ctr crictl busctl dbus-send gdbus machinectl kill pkill killall skill snice renice snap hostnamectl timedatectl localectl', 'needs a socket or another program'],
  ['lockout', 'rfkill networkctl wg wg-quick iwctl dhclient dhcpcd udhcpc brctl bridge ipset conntrack netfilter-persistent iptables-apply ip6tables-apply resolvconf', 'radios, links, tunnels, address leases, firewall sets and tracked connections: the network, a way in'],
  ['lockout', 'nsenter chroot unshare systemd-nspawn runc lxc-attach lxc-execute', 'it enters the host’s own namespaces or root folder, or makes new ones, where SSH, the firewall and users are a command away: a way in'],
  ['device', 'nvidia-smi ss netstat ping ping6 traceroute tracepath mtr dig nslookup host blkid dmidecode lshw iptables-save ip6tables-save', 'a device or the network'],
  ['notdone', 'ngrok cloudflared frpc frps bore chisel sshuttle autossh socat localtunnel lt pagekite inlets rathole zrok tor', 'a relay or tunnel round a network filter is not done'],
  ['risky', 'npx pnpx bunx uvx', 'it downloads a package and runs it'],
  ['lockout', 'useradd adduser userdel deluser usermod passwd chpasswd chage chsh chfn groupadd addgroup groupdel delgroup groupmod gpasswd newusers vipw vigr visudo pwconv pwunconv grpconv grpunconv pam-auth-update faillock ssh-copy-id sshd tailscaled iptables ip6tables iptables-legacy iptables-nft iptables-restore ip6tables-restore ebtables arptables nft ufw firewall-cmd netplan nmcli nmtui ifup ifdown ifconfig route iw iwconfig wpa_cli wpa_supplicant tc resolvectl systemd-resolve ethtool', 'users and passwords, SSH, the firewall or the network settings, ways in'],
]) for (const n of names.split(' ')) SORT_PROGS[n] = { cls, why };
// Programs with a handler of their own that can change a way in (their handler says when): named inside text the sorter
// does not read as a command (a one-liner, a container's words), each counts as the lock-out class.
// The way-in processes as pkill and killall see them: their names (at most 15 signs, as the kernel keeps them), and
// their command lines (pkill -f).
const SORT_WAY_PROCS = 'sshd sshd-session sshd-auth tailscaled NetworkManager systemd-network systemd-resolve systemd-logind wpa_supplicant dhclient dhcpcd dbus-daemon dbus-broker systemd init agetty login sudo'.split(' ');
const SORT_WAY_CMDS = ['/usr/sbin/sshd -D', 'sshd: owner@pts/0', 'sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups', '/usr/sbin/tailscaled --state=/var/lib/tailscale/tailscaled.state --socket=/run/tailscale/tailscaled.sock',
  '/usr/sbin/NetworkManager --no-daemon', '/lib/systemd/systemd-networkd', '/lib/systemd/systemd-resolved', '/lib/systemd/systemd-logind', '/sbin/wpa_supplicant -u -s -O /run/wpa_supplicant',
  '/usr/bin/dbus-daemon --system --address=systemd: --nofork --nopidfile --systemd-activation --syslog-only', '/lib/systemd/systemd --user', '/sbin/init', '/sbin/agetty -o -p -- \\u --noclear tty1 linux', 'node /home/owner/spark-console-service/server.mjs'];
const SORT_LOCK_HANDLERS = new Set('tailscale ip arp systemctl service loginctl userdel deluser sysctl hostname ssh-keygen'.split(' '));
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
// (the network tools of the final read's list that only read in these forms)
Object.assign(SORT_LOCK_READS, {
  rfkill: a => a.length === 0 || (/^(?:list|event)$/.test(a[0]) && !a.some(t => /[;\n]/.test(t))), networkctl: a => /^(?:|list|status|lldp|label|cat)$/.test(a.find(t => !t.startsWith('-')) ?? '') && !a.some(t => /[;\n]/.test(t)),
  wg: a => /^(?:|show|showconf)$/.test(a[0] ?? ''), ipset: a => /^(?:-?L|list|-S|save|-?n|--list|--save)$/.test(a.find(t => !/^-o$|^-(?:t|terse|n|name|s|sorted|q|quiet)$/.test(t)) ?? ''),
  conntrack: a => a.length > 0 && a.every(t => /^-[LSC]$|^--(?:dump|stats|count)$|^-[pofsdn]|^--(?:proto|output|family|src|dst|zone)|^[\w.:-]+$/.test(t)) && a.some(t => /^-[LSC]$|^--(?:dump|stats|count)$/.test(t)),
  brctl: a => /^(?:show|showmacs|showstp)$/.test(a[0] ?? ''), bridge: a => sortShows(a, 0), iwctl: a => a.length > 1 && /^(?:list|show|get-networks|get-hidden-access-points)$/.test(a.at(-1)),
});

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
    if (a.unknown || a.glob) { sortUnshown(r, `what ${name} runs, named by a $ or a *`); unsure(`${sortQ(name)}’s words hold a $ or a *, so the sorter can't know what it runs.`); }
    if (t === '--') { k++; break; }
    if (name === 'env' && /^[A-Za-z_]\w*=/.test(t)) { sortAssign(t.split('=')[0], ctx, r, true, args[k].unknown ? null : t.slice(t.indexOf('=') + 1)); continue; }
    // (env -u takes a name away, as unset does; env -i or a lone -, and exec -c, empty the environment, where the run
    // wall keeps git's hooks off: asked)
    if (name === 'env' && (/^-[^-]*u/.test(t) || /^--unset(?:=|$)/.test(t))) sortAssign((/^--unset=(.*)$/.exec(t)?.[1] ?? /^-[^-]*?u(.+)$/.exec(t)?.[1] ?? args[k + 1]?.text ?? '').trim() || '?', ctx, r, false);
    if ((name === 'env' && (t === '-' || /^-[^-]*i|^--ignore-environment$/.test(t))) || (name === 'exec' && /^-[^-]*c/.test(t))) raise(r, 'risky', `${sortQ(name)} empties the environment, where the run wall keeps git’s hooks and settings off: asked.`);
    if (name === 'env' && t === '-') continue;
    if (!t.startsWith('-') || t === '-') break;
    if (name === 'nice' && /^-\d+$/.test(t)) continue;
    // (an option it doesn't read, env -S among them, may make it run words that aren't on the button)
    if (t.startsWith('--')) { if (!longs.split(' ').includes(t.includes('=') ? `${t.slice(2).split('=')[0]}=` : t.slice(2))) { sortUnshown(r, `what ${name} runs with its option ${t.split('=')[0]}`); unsure(`The sorter doesn't know ${sortQ(name)}’s option ${sortQ(t)}.`); } continue; }
    for (let j = 1; j < t.length; j++) {
      if (takes.includes(t[j])) { if (j === t.length - 1) k++; break; }
      if (!flags.includes(t[j])) { sortUnshown(r, `what ${name} runs with its option -${t[j]}`); unsure(`The sorter doesn't know ${sortQ(name)}’s option ${sortQ(`-${t[j]}`)}.`); }
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
