/* ───────── the sorter's programs that reach the network or another machine (design A 2.8) ───────── */
// Area: safety        Rules: R55        Tests: sort.test.mjs
// Owns: none
// Timers: none        Wakes: none
// The handlers 20-programs.mjs leaves to this part, added to SORT_HANDLERS: the network's own tools (ip, arp, ss), the
// downloaders (curl, wget, aria2c), Tailscale, and ssh, scp, rsync and sftp. On another machine there is no wall and no
// copy first, so a command that runs or writes there is asked (risky) whatever it is, and still sorted as a command
// there for lockout or not done; a host that isn't one of the Sparks is risky, a tunnel through one is not done.
const sortHost = (ctx, h) => ctx.hosts[h] ?? ctx.hosts[String(h).toLowerCase()];
// A far path, from the far home ('' and . are the home), placed as a path there (wide when it is where a copy lands).
const sortFar = (path, ctx, r, wide) => sortPlace(sortNorm(/^[~/]/.test(path) ? path : `~/${path}`), /[*?[]/.test(path), ctx, r, wide, true);
Object.assign(SORT_HANDLERS, {
  ip(a, ctx, r) {
    const t = a.map(w => w.text), o = [];
    for (let k = 0; k < t.length; k++) {
      if (/^-(?:b|ba\w*|force|n|ne\w*)$|^exec$/.test(t[k])) unsure('ip -batch, -netns or netns exec does what the sorter can’t see.');
      if (/^-(?:f|fa\w*|rc\w*)$/.test(t[k])) { k++; continue; }
      if (!t[k].startsWith('-')) o.push(t[k]);
    }
    if (!sortShows(o, 0)) return raise(r, 'lockout', 'ip changes the network interfaces, addresses or routes (only show, list and get only read).');
    raise(r, 'change', 'ip reads the real network, which a look’s wall has none of (ip addr and ip route alone are looks).');
  },
  arp: (a, ctx, r) => (a.some(w => /^-\w*[sdfDS]|^--(?:set|delete|file)/.test(w.text) || w.text === ';') ? raise(r, 'lockout', 'arp changes the network’s address table, a way in.') : raise(r, 'change', 'arp reads the real network, which a look’s wall has none of.')),
  ss: (a, ctx, r) => (a.some(w => /^-\w*K|^--kill/.test(w.text)) ? raise(r, 'risky', 'ss -K closes connections, maybe the owner’s own.') : raise(r, 'change', 'ss reads the real network, which a look’s wall has none of (ss -tln alone is a look).')),
  curl(a, ctx, r, x, name = 'curl') {
    const t = a.map(w => w.text), url = t.find(s => /^[a-z][\w+.-]*:\/\//i.test(s)) ?? '', last = url.replace(/[?#].*$/, '').split('/').pop();
    raise(r, 'change', `${sortQ(name)} reaches the network, which a look’s wall has none of.`);
    ctx.piped = ctx.fetchSeen = ctx.fetched = true;
    if (t.some(s => /^-\w*K$|^--config/.test(s))) unsure(`${sortQ(name)} reads more options from a file, which the sorter does not read.`);
    if (t.some(s => /^--(?:abstract-)?unix-socket|(?:^|\/\/|@)(?:localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1?\])(?=[:/]|$)/i.test(s))) sortOpen(ctx, r, `${sortQ(name)} reaches a local-only port or socket on its own Spark, which the run wall hides.`);
    const dirOf = re => { const i = t.findIndex(s => re.test(s)); return i < 0 ? null : t[i].includes('=') ? { text: t[i].slice(t[i].indexOf('=') + 1), subs: [] } : a[i + 1]; };
    if (name === 'curl') {
      t.forEach((s, i) => { if (/^(?:-o|--output)$/.test(s) && t[i + 1] !== '-') sortTouch(a[i + 1], ctx, r); });
      const dir = dirOf(/^--output-dir/);
      if (t.some(s => /^-\w*J|^--remote-header-name/.test(s))) sortInto(dir, ctx, r);
      else if (t.some(s => /^-\w*O|^--remote-name/.test(s)) && last) { if (dir) sortTouch({ ...dir, text: `${dir.text}/${last}` }, ctx, r); else sortTouch({ text: last, subs: [] }, ctx, r); }
    } else if (name === 'wget') {
      const o = t.findIndex(s => /^-\w*O$|^--output-document$/.test(s)), dir = dirOf(/^-P$|^--directory-prefix/);
      if (o >= 0) { if (t[o + 1] !== '-') sortTouch(a[o + 1], ctx, r); }
      else if (t.some(s => /^-\w*[rmx]|^--(?:recursive|mirror|force-directories|content-disposition|trust-server-names)/.test(s))) sortInto(dir, ctx, r);
      else if (!t.some(s => /^-\w*O-$|^--output-document=/.test(s)) && last) sortTouch({ text: dir ? `${dir.text}/${last}` : last, subs: [] }, ctx, r);
    } else sortInto(dirOf(/^-d$|^--dir/), ctx, r);
  },
  ssh(a, ctx, r, x) {
    r.simple = false;
    let k = 0, relay = null, user = null, odd = null;
    for (; k < a.length && a[k].text.startsWith('-'); k++) {
      const t = a[k].text;
      for (let j = 1; j < t.length; j++) {
        const c = t[j];
        if ('bcDEeFIiJLlmOopQRSWw'.includes(c)) {
          const v = j < t.length - 1 ? t.slice(j + 1) : a[++k]?.text ?? '';
          if ('RDLWwJ'.includes(c)) relay ??= `ssh -${c}`;
          if (c === 'l') user = v;
          if (c === 'p' || (c === 'o' && /^(?:HostName|HostKeyAlias|Port|Hostname)\b/i.test(v))) odd = v;
          if (c === 'o' && /^User\s*=?\s*(\S+)/i.test(v)) user = /^User\s*=?\s*(\S+)/i.exec(v)[1];
          if (/^(?:Proxy|\w*Forward|Tunnel)/i.test(v) && c === 'o') relay ??= `ssh -o ${v.split(/[= ]/)[0]}`;
          else if ('FES'.includes(c) || (c === 'o' && /^(?:LocalCommand|PermitLocalCommand|RemoteCommand|Control|Include|KnownHostsCommand|PKCS11Provider)/i.test(v))) unsure('ssh is given an option that runs a command, or shares a connection, the sorter can’t see.');
          break;
        }
        if (!'46AaCfGgKkMNnqsTtVvXxYy'.includes(c)) unsure(`The sorter doesn’t know ssh’s option ${sortQ(`-${c}`)}.`);
      }
    }
    if (!a[k] || a.some(w => w.unknown)) unsure('ssh’s host or command holds a $ or a command, which the sorter can’t read.');
    if (a[k + 1]?.text.startsWith('-')) unsure('ssh takes options after the host too, which the sorter does not read there.');
    const dest = a[k].text, host = dest.replace(/^[^@]*@/, ''), place = sortHost(ctx, host), remote = a.slice(k + 1).map(w => w.text).join(' ');
    user ??= /^([^@]*)@/.exec(dest)?.[1] ?? null;
    if (user === 'root') ctx.kinds.add('root');
    if (relay) return raise(r, place ? 'risky' : 'notdone', place ? `${sortQ(relay)} opens a tunnel between Sparks.` : `${sortQ(relay)} would open a tunnel or relay through ${sortQ(host)}, outside the fleet, round a network filter.`);
    raise(r, 'risky', place ? `It runs a command on ${sortQ(host)} over ssh, outside every wall and copy there: a command on another Spark is asked (to look there, run it there).` : `It connects to ${sortQ(host)}, which isn’t one of the Sparks.`);
    if (odd) raise(r, 'risky', `ssh is told to reach another host or port than the one it names: ${sortQ(odd)}.`);
    const fed = remote || (typeof x.stdin === 'string' ? x.stdin : '');
    if (!fed) return;
    if (!place) return sortScan(fed, ctx, r, true);
    const was = [ctx.at, ctx.root, ctx.cwds], c = sortFresh();
    Object.assign(ctx, { at: place, root: user === 'root', cwds: new Set(['~']) });
    try { sortInline(fed, ctx, c, 'ssh'); sortAt(c, ctx); } finally { [ctx.at, ctx.root, ctx.cwds] = was; sortMerge(r, c); }
  },
  scp(a, ctx, r, x, name = 'scp') {
    raise(r, 'change', `${sortQ(name)} copies files.`);
    if (a.some(w => /^-\w*[oFJS]$|^-e$|^--(?:rsh|rsync-path)/.test(w.text) || (name === 'rsync' && /^-[a-zA-Z]*e/.test(w.text)))) unsure(`${sortQ(name)} is given an option that runs a command or goes through a host the sorter can’t see.`);
    if (a.some(w => /^--(?:del|remove-source)/.test(w.text))) sortGone(ctx, r, `${sortQ(name)} --delete removes files it doesn’t name.`);
    const plain = a.filter(w => !w.text.startsWith('-')), rec = name === 'sftp' || a.some(w => /^-\w*[ra]|^--(?:recursive|archive)$/.test(w.text));
    if (name === 'sftp') {
      const host = plain.at(-1)?.text.replace(/^[^@]*@/, '').replace(/:.*$/, '') ?? '';
      return raise(r, 'risky', sortHost(ctx, host) ? `sftp to ${sortQ(host)} can write any file there, outside every wall and copy: asked.` : `It connects to ${sortQ(host)}, which isn’t one of the Sparks.`);
    }
    plain.forEach((w, i) => {
      const m = /^(?:[^@/:]*@)?([^/:]+):+(.*)$/s.exec(w.text), lastOne = i === plain.length - 1;
      if (!m) return sortTouch(w, ctx, r, rec && lastOne);
      const place = sortHost(ctx, m[1]);
      if (!place) raise(r, 'risky', `It copies to or from ${sortQ(m[1])}, which isn’t one of the Sparks.`);
      else if (lastOne) raise(r, 'risky', `It writes files on ${sortQ(m[1])}, outside every wall and copy there: a copy onto another Spark is asked.`);
      sortFar(m[2], ctx, r, rec && lastOne);
    });
  },
  tailscale(a, ctx, r) {
    const v = a.find(w => !w.text.startsWith('-'))?.text ?? '';
    if (/^(?:status|ip|netcheck|ping|whois|version|bugreport|metrics|licenses)$/.test(v)) return sortOpen(ctx, r, `tailscale ${sortQ(v)} needs Tailscale’s socket, which the run wall hides.`);
    if (v === 'logout') r.lasting = 'A Tailscale logout needs a sign-in in a browser to undo; the net can’t put it back.';
    raise(r, 'lockout', `tailscale ${sortQ(v)} changes Tailscale, a way in.`);
  },
});
