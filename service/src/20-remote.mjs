/* ───────── the sorter's programs that reach the network or another machine (design A 2.8) ───────── */
// Area: safety        Rules: R55, R75        Tests: sort.test.mjs
// Owns: none
// Timers: none        Wakes: none
// The handlers 20-programs.mjs leaves to this part, added to SORT_HANDLERS: the network's own tools (ip, arp, ss), the
// downloaders (curl, wget, aria2c), Tailscale, and ssh, scp, rsync and sftp. On another machine there is no wall and no
// copy first, so a command that runs or writes there is asked (risky) whatever it is, and still sorted as a command
// there for lockout or not done; a host that isn't one of the Sparks is risky, a tunnel through one is not done. As
// root no wall stands in front of the Spark's own ports, so a root download that names a host by number, localhost, a
// one-word name, a name of the fleet or of a service that turns a name into the number in it (nip.io), or forces an
// address (--resolve, --connect-to, a proxy, a socket) is asked; a name that DNS alone turns into the Spark is not seen.
const sortHost = (ctx, h) => ctx.hosts[h] ?? ctx.hosts[String(h).toLowerCase()];
// A host of the fleet or the home network: a one-word name, a fleet name, a private, link-local or tailnet address, or a
// name under .local, .lan, .home.arpa, .internal or .ts.net.
const sortNear = (h, ctx) => !!h && (!h.includes('.') || !!sortHost(ctx, h.split('.')[0]) || /^(?:10|127)\.|^192\.168\.|^172\.(?:1[6-9]|2\d|3[01])\.|^169\.254\.|^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|^\[|(?:^|\.)(?:local|lan|home\.arpa|internal|ts\.net|localhost)\.?$/i.test(h));
const sortDns = (h, ctx) => /^(?=[^/]*[a-z])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\.?$/i.test(h) && !h.split('.').some(l => /^\d+$|^0x/i.test(l) || sortHost(ctx, l))
  && !/(?:^|\.)(?:localhost|local|localdomain|internal|lan|home\.arpa|ts\.net|nip\.io|sslip\.io|xip\.io|localtest\.me|lvh\.me|vcap\.me|traefik\.me|localhost\.direct)\.?$/i.test(h);
// A command for the hub from a compute Spark (the final read `net`, 7): ssh, scp, rsync, sftp, git, docker -H or
// DOCKER_HOST, tailscale ssh. The hub by any name or address the console knows is not done: commands for the hub go
// through the hub's own path (run with on: its id), where its rules hold. A host that can't be told (a $, a name ssh's own
// settings may point anywhere, an address of the tailnet or the home network the console doesn't know, a host option)
// may be the hub: the dangerous ask (kind brain, the hub being the brain's), saying so.
const sortHubHost = (h, ctx) => { const x = String(h ?? '').replace(/^\[|\]$/g, '').replace(/\.$/, ''); return sortHost(ctx, x) ?? sortHost(ctx, x.split('.')[0]); };
function sortToHub(h, ctx, r, via, unknown = false) {
  if (ctx.at !== 'compute') return;
  const place = unknown ? null : sortHubHost(h, ctx);
  if (place === 'hub') return raise(r, 'notdone', `${via} reaches ${hubName()} (${sortQ(h)}): a command for ${hubName()} is run on ${hubName()} (run with on: "${hubId()}"), where its own rules hold, never from another Spark.`);
  if (place === 'compute') return;
  if (unknown || !String(h ?? '').includes('.') || sortNear(String(h), ctx)) {
    ctx.kinds.add('brain');
    // (the dangerous ask's reason says why, before any other risky one)
    raise(r, 'risky', '');
    if (r.class === 'risky') r.why = `${via} reaches ${unknown ? 'a host named by a $, a command or an option' : sortQ(h)}, which may be ${hubName()} (a name ssh’s own settings or the tailnet point anywhere): ${hubName()} runs the console and the brain, so it is asked the dangerous way.`;
  }
}
// The names the hub goes by that its callers may leave out: the console's own address and its first label, and the
// hub's id, alias and address on the list of Sparks (as runnerSortOpts gives the compute Sparks').
function sortHubNames(ctx) {
  try { const h = new URL(String(CONFIG.origin)).hostname.toLowerCase(); if (h) { ctx.hosts[h] ??= 'hub'; ctx.hosts[h.split('.')[0]] ??= 'hub'; } } catch { /* no address */ }
  try { for (const n of NODES) if (n?.host === 'local') for (const k of [n.id, n.alias, n.ip, n.name]) if (typeof k === 'string' && k) ctx.hosts[k] ??= 'hub'; } catch { /* no list */ }
}
// A far path, from the far home ('' and . are the home), placed as a path there (wide when it is where a copy lands).
const sortFar = (path, ctx, r, wide) => sortPlace(sortNorm(/^[~/]/.test(path) ? path : `~/${path}`, null, ctx.home), /[*?[]/.test(path), ctx, r, wide, true);
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
    const o = sortOpts(SORT_OPTS[name], a), t = a.map(w => w.text), urls = [...o.plain, ...o.all('url')].map(w => w.text);
    const last = u => u.replace(/[?#].*$/, '').replace(/^[a-z][\w+.-]*:\/\/[^/]*/i, '').split('/').pop();
    raise(r, 'change', `${sortQ(name)} reaches the network, which a look’s wall has none of.`);
    // (what it uploads is what it sends: -T, a @file of -d, -F or --json, wget's --post-file and --body-file)
    for (const [n, v] of o.opts) if (typeof v?.text === 'string' && !v.unknown) {
      if (/^(?:T|upload-file|post-file|body-file)$/.test(n)) ctx.srcs.push(v.text);
      else if (/^(?:d|data|data-binary|data-raw|data-ascii|data-urlencode|json|F|form|form-string)$/.test(n)) { const f = /(?:^|=)@?<?@([^;,]+)/.exec(v.text)?.[1] ?? /^@(.+)$/.exec(v.text)?.[1]; if (f) ctx.srcs.push(f); }
    }
    ctx.piped = ctx.fetchSeen = ctx.fetched = true;
    if (t.some(s => /^--(?:abstract-)?unix-socket|(?:^|\/\/|@)(?:localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1?\])(?=[:/]|$)/i.test(s))) sortOpen(ctx, r, `${sortQ(name)} reaches a local-only port or socket on its own Spark, which the run wall hides.`);
    const near = urls.find(u => sortNear(/^(?:[a-z][\w+.-]*:\/\/)?(?:[^@/]*@)?(\[[^\]]*\]|[^/:?#]*)/i.exec(u)?.[1] ?? '', ctx));
    if (near) raise(r, 'risky', `${sortQ(name)} reaches ${sortQ(near)}, a Spark or the home network: inside the wall there is no route there, so it is asked.`);
    for (const w of [...o.plain, ...o.all('url')]) if (!w.unknown) usesReach(usesHost(w.text) ?? (/^[^/:]+(?=[:/]|$)/.exec(w.text)?.[0]), ctx);
    // (an option that decides where it connects, or reads its addresses from a file, may point at the same: asked)
    const via = o.opts.find(([n]) => (name === 'curl' ? /^(?:resolve|connect-to|x|proxy|preproxy|socks\w*|dns-servers|doh-url)$/ : /^(?:i|input-file|B|base|e|execute)$/).test(n));
    if (via) raise(r, 'risky', `${sortQ(name)} ${sortQ(`${via[0].length > 1 ? '--' : '-'}${via[0]}`)} decides where it connects, maybe a Spark or the home network: asked.`);
    // (and where that option points, when its words show it: a proxy's host, the address --resolve or --connect-to gives)
    if (name === 'curl') for (const [n, v] of o.opts) if (typeof v?.text === 'string' && !v.unknown && /^(?:x|proxy|preproxy|socks\w*|resolve|connect-to|dns-servers|doh-url)$/.test(n)) for (const s of v.text.split(',')) usesReach(/^(?:resolve|connect-to)$/.test(n) ? /([^:[\]]+|\[[^\]]*\])$/.exec(s)?.[1] : usesHost(s) ?? /^[^/:]+/.exec(s)?.[0], ctx);
    if (ctx.root) {
      const odd = urls.find(u => !sortDns(/^(?:[a-z][\w+.-]*:\/\/)?(?:[^@/]*@)?(\[[^\]]*\]|[^/:?#]*)/i.exec(u)?.[1] ?? '', ctx));
      const forced = o.opts.find(([n]) => /^(?:resolve|connect-to|unix-socket|abstract-unix-socket|x|proxy|noproxy|i|input-file|B|base)$/.test(n));
      if (odd !== undefined || forced) raise(r, 'risky', `As root, ${sortQ(name)} reaches ${sortQ(odd ?? `--${forced[0]}`)}, which could be the Spark’s own port; as root no wall stands in front of it.`);
    }
    const dir = o.all('output-dir', 'P', 'directory-prefix', 'd', 'dir').at(-1) ?? null, at = f => (dir ? { ...dir, text: `${dir.text}/${f}`, subs: [] } : { text: f, subs: [] });
    if (name === 'curl') {
      // (curl fills #1 in -o from the address's {a,b} or [1-9]: any name; every -O names a file from its address's
      // last part, which may hold the same; -J takes what the server says)
      const any = (w, text) => ({ ...w, text: text.replace(/#\d+|\{[^}]*\}|\[[^\]]*\]/g, '*'), glob: w.glob || /#\d|\{|\[/.test(text) });
      for (const w of o.all('o', 'output')) if (w.text !== '-') { sortTouch(any(w, w.text), ctx, r); if (dir) sortTouch(any(w, at(w.text).text), ctx, r); }
      // (and -w's %output{file} writes the rest of what -w prints to that file)
      if (o.all('w', 'write-out').some(w => w.text.startsWith('@'))) unsure(`${sortQ(name)} -w @file reads its format from a file nobody read.`);
      for (const w of o.all('w', 'write-out')) for (const m of w.text.matchAll(/%output\{>{0,2}([^}]*)\}/g)) sortTouch(any(w, m[1]), ctx, r);
      if (o.has('J', 'remote-header-name')) sortInto(dir, ctx, r);
      else if (o.has('O', 'remote-name', 'remote-name-all')) for (const u of urls) if (last(u)) sortTouch(any(at(last(u)), at(last(u)).text), ctx, r);
    } else if (name === 'wget') {
      const out = o.all('O', 'output-document');
      for (const w of o.all('o', 'output-file', 'a', 'append-output')) sortTouch(w, ctx, r);
      if (out.length) { for (const w of out) if (w.text !== '-') sortTouch(w, ctx, r); }
      else if (o.has('r', 'm', 'x', 'i', 'p', 'recursive', 'mirror', 'force-directories', 'content-disposition', 'trust-server-names', 'input-file', 'page-requisites')) sortInto(dir, ctx, r);
      else for (const u of urls) if (last(u)) sortTouch(at(last(u)), ctx, r);
    } else sortInto(dir, ctx, r);
    if (t.some(s => /^-[^-]*K|^--conf/.test(s))) unsure(`${sortQ(name)} reads more options from a file, which the sorter does not read.`);
  },
  ssh(a, ctx, r, x) {
    r.simple = false;
    let k = 0, relay = null, user = null, odd = null;
    // (every host it may connect to: a jump host, a HostName given as an option, then the one it names)
    const via = [];
    for (; k < a.length && a[k].text.startsWith('-'); k++) {
      const t = a[k].text;
      for (let j = 1; j < t.length; j++) {
        const c = t[j];
        if ('bcDEeFIiJLlmOopQRSWw'.includes(c)) {
          const v = j < t.length - 1 ? t.slice(j + 1) : a[++k]?.text ?? '';
          if (c === 'J' || (c === 'o' && /^(?:ProxyJump|HostName)\b/i.test(v))) via.push(...(c === 'J' ? v : v.replace(/^\w+\s*=?\s*/, '')).split(',').map(x => x.replace(/^[^@]*@/, '').replace(/:\d+$/, '')));
          if ('RDLWwJ'.includes(c)) relay ??= `ssh -${c}`;
          if (c === 'l') user = v;
          if (c === 'p' || (c === 'o' && /^(?:HostName|HostKeyAlias|Port|Hostname)\b/i.test(v))) odd = v;
          if (c === 'o' && /^User\s*=?\s*(\S+)/i.test(v)) user = /^User\s*=?\s*(\S+)/i.exec(v)[1];
          if (c === 'o' && /^(?:ProxyCommand|LocalCommand|KnownHostsCommand|RemoteCommand)/i.test(v)) sortUnshown(r, `the command ssh -o ${v.split(/[= ]/)[0]} runs, which the sorter does not read`);
          if (/^(?:Proxy|\w*Forward|Tunnel)/i.test(v) && c === 'o') relay ??= `ssh -o ${v.split(/[= ]/)[0]}`;
          else if ('FES'.includes(c) || (c === 'o' && /^(?:LocalCommand|PermitLocalCommand|RemoteCommand|Control|Include|KnownHostsCommand|PKCS11Provider)/i.test(v))) sortToHub('', ctx, r, 'ssh', true), unsure('ssh is given an option that runs a command, or shares a connection, the sorter can’t see.');
          break;
        }
        if (!'46AaCfGgKkMNnqsTtVvXxYy'.includes(c)) unsure(`The sorter doesn’t know ssh’s option ${sortQ(`-${c}`)}.`);
      }
    }
    if (!a[k] || a.slice(0, k + 1).some(w => w.unknown)) sortToHub('', ctx, r, 'ssh', true);
    if (!a[k] || a.some(w => w.unknown)) unsure('ssh’s host or command holds a $ or a command, which the sorter can’t read.');
    if (a[k + 1]?.text.startsWith('-')) unsure('ssh takes options after the host too, which the sorter does not read there.');
    const dest = a[k].text, host = dest.replace(/^[^@]*@/, ''), place = sortHost(ctx, host), remote = a.slice(k + 1).map(w => w.text).join(' ');
    for (const h of [...via, host.replace(/^ssh:\/\/|[:/].*$/g, '')]) sortToHub(h, ctx, r, 'ssh');
    usesReach(host.replace(/^ssh:\/\/|[:/].*$/g, ''), ctx);
    user ??= /^([^@]*)@/.exec(dest)?.[1] ?? null;
    if (user === 'root') ctx.kinds.add('root');
    if (relay) return raise(r, place ? 'risky' : 'notdone', place ? `${sortQ(relay)} opens a tunnel between Sparks.` : `${sortQ(relay)} would open a tunnel or relay through ${sortQ(host)}, outside the fleet, round a network filter.`);
    raise(r, 'risky', place ? `It runs a command on ${sortQ(host)} over ssh, outside every wall and copy there: a command on another Spark is asked (to look there, run it there).` : `It connects to ${sortQ(host)}, which isn’t one of the Sparks.`);
    if (odd) raise(r, 'risky', `ssh is told to reach another host or port than the one it names: ${sortQ(odd)}.`);
    const fed = remote || (typeof x.stdin === 'string' ? x.stdin : '');
    if (!fed) return;
    if (!place) return sortScan(fed, ctx, r, true);
    // (what it changes there is not a place here: the runner copies nothing for it)
    const was = [ctx.at, ctx.root, ctx.cwds, ctx.changes], c = sortFresh();
    Object.assign(ctx, { at: place, root: user === 'root', cwds: new Set(['~']), changes: null });
    try { sortInline(fed, ctx, c, 'ssh'); sortAt(c, ctx); } finally { [ctx.at, ctx.root, ctx.cwds, ctx.changes] = was; sortMerge(r, c); }
  },
  scp(a, ctx, r, x, name = 'scp') {
    raise(r, 'change', `${sortQ(name)} copies files.`);
    if (a.some(w => w.unknown)) sortToHub('', ctx, r, name, true);
    if (a.some(w => /^--(?:del|remove-source)/.test(w.text))) sortGone(ctx, r, `${sortQ(name)} --delete removes files it doesn’t name.`);
    const o = sortOpts(SORT_OPTS[name], a), plain = o.plain, rec = name === 'sftp' || o.has('r', 'a', 'recursive', 'archive');
    if (name === 'sftp') {
      const host = plain.at(-1)?.text.replace(/^[^@]*@/, '').replace(/:.*$/, '') ?? '';
      usesReach(host, ctx);
      sortToHub(host, ctx, r, name);
      return raise(r, 'risky', sortHost(ctx, host) ? `sftp to ${sortQ(host)} can write any file there, outside every wall and copy: asked.` : `It connects to ${sortQ(host)}, which isn’t one of the Sparks.`);
    }
    plain.forEach((w, i) => {
      const m = /^(?:[^@/:]*@)?([^/:]+):+(.*)$/s.exec(w.text), lastOne = i === plain.length - 1;
      // (a local source is only read, unless it is moved away)
      // (a local target is written over: what was there goes, unless it is copied first; a local source is what it sends)
      if (!m && !lastOne) ctx.srcs.push(w.text);
      // (into a folder there, surely one, each local source by the name it lands under: a key to a key's place, K3)
      if (m && lastOne) {
        const to = sortNorm(/^[~/]/.test(m[2]) ? m[2] : `~/${m[2]}`, null, ctx.home), locals = plain.slice(0, -1).filter(v => !/^(?:[^@/:]*@)?[^/:]+:/.test(v.text)).map(v => v.text.replace(/\/+$/, '').split('/').pop());
        ctx.farDests.push(...(/(?:^|\/)\.?$/.test(m[2]) && locals.length && locals.every(Boolean) ? locals.map(b => `${to.replace(/\/+$/, '')}/${b}`) : [to]));
      }
      if (!m) { if (lastOne || a.some(v => /^--remove-source/.test(v.text))) r.deletes = true; return sortTouch(w, ctx, r, rec && lastOne, true, !lastOne && !a.some(v => /^--remove-source/.test(v.text))); }
      usesReach(/^rsync:\/\//.test(w.text) ? usesHost(w.text) : m[1], ctx);
      sortToHub(/^rsync:\/\//.test(w.text) ? usesHost(w.text) : m[1], ctx, r, name);
      const place = sortHost(ctx, m[1]);
      if (!place) raise(r, 'risky', `It copies to or from ${sortQ(m[1])}, which isn’t one of the Sparks.`);
      else if (lastOne) raise(r, 'risky', `It writes files on ${sortQ(m[1])}, outside every wall and copy there: a copy onto another Spark is asked.`);
      // (a copy from another Spark too: inside the wall it has no key and no route, so it is asked, not left to fail)
      else raise(r, 'risky', `It copies from ${sortQ(m[1])}, another Spark: inside the wall there is no key and no route there, so it is asked.`);
      sortFar(m[2], ctx, r, rec && lastOne);
    });
    // (each source lands in the folder under its own name, a source ending in / as what it holds; rsync -b keeps what
    // it replaces with a suffix, ~ unless --suffix says)
    const dest = plain.at(-1), far = dest && /^(?:[^@/:]*@)?([^/:]+):+(.*)$/s.exec(dest.text);
    const bk = name === 'rsync' && o.has('b', 'backup') && !o.has('backup-dir') ? o.all('suffix').at(-1)?.text ?? '~' : null;
    if (bk != null && dest && !far) sortTouch({ ...dest, text: dest.text.replace(/\/+$/, '') + bk }, ctx, r);
    for (const w of plain.length > 1 ? plain.slice(0, -1) : []) {
      const b = w.text.replace(/^(?:[^@/:]*@)?[^/:]+:+/, ''), base = b.replace(/\/+$/, '').split('/').pop();
      if (!base || (/\/$/.test(b) && name === 'rsync')) { if (rec) { if (far) sortFar(far[2], ctx, r, true); else sortTouch(dest, ctx, r, true); } continue; }
      if (far) sortFar(`${far[2] || '.'}/${base}`, ctx, r, rec); else sortTouch({ ...dest, text: `${dest.text.replace(/\/+$/, '')}/${base}`, glob: dest.glob || /[*?[]/.test(base) }, ctx, r, rec);
      if (bk != null && !far) sortTouch({ ...dest, text: `${dest.text.replace(/\/+$/, '')}/${base}${bk}`, glob: dest.glob || /[*?[]/.test(base) }, ctx, r, rec);
    }
    if (a.some(w => (name !== 'rsync' && /^-[^-]*[oFJS]/.test(w.text)) || /^-e$|^--(?:rsh|rsync-path)/.test(w.text) || (name === 'rsync' && /^-[a-zA-Z]*e/.test(w.text)))) unsure(`${sortQ(name)} is given an option that runs a command or goes through a host the sorter can’t see.`);
  },
  tailscale(a, ctx, r, x = {}) {
    // (its own options come before the verb: --socket takes a path)
    let k = 0;
    while (k < a.length && !a[k].unknown && a[k].text.startsWith('-')) k += a[k].text === '--socket' ? 2 : 1;
    const vw = a[k], v = vw?.text ?? '', rest = a.slice(k + 1);
    // (tailscale ssh is ssh over the tailnet: sorted as ssh, its host too)
    if (v === 'ssh' && !vw.unknown) return SORT_HANDLERS.ssh(rest, ctx, r, x);
    if (!x.unknownArgs && !a.some(w => w.unknown) && /^(?:status|ip|netcheck|ping|whois|version|bugreport|metrics|licenses)$/.test(v)) return sortOpen(ctx, r, `tailscale ${sortQ(v)} needs Tailscale’s socket, which the run wall hides.`);
    // What the net can't put back, by any spelling: a sign-out; a sign-in again, as another key or to another server (the
    // old state file put back would bring back the old key over the new one, A13a); the tailnet's own lock; and what it
    // can't read: words from its input or a $, a verb it doesn't know.
    if (x.unknownArgs || a.some(w => w.unknown) || !vw) r.lasting ??= 'tailscale is given words the sorter can’t read (from its input, a $ or a command): it may sign Tailscale out, which the net can’t put back.';
    else if (v === 'logout') r.lasting ??= 'A Tailscale logout needs a sign-in in a browser to undo; the net can’t put it back.';
    else if (/^(?:login|switch)$/.test(v) || rest.some(w => /^--(?:force-reauth|auth-?key|login-server)(?:=|$)/.test(w.text))) r.lasting ??= `tailscale ${sortQ(v)} signs in again, as another key or account; the net can’t put that back.`;
    else if (v === 'lock') r.lasting ??= 'tailscale lock changes the tailnet’s own lock, on every machine of it; the net can’t put that back.';
    else if (!/^(?:up|down|set|serve|funnel|cert|file|web|exit-node|drive|dns|configure|completion|update)$/.test(v)) r.lasting ??= `The sorter doesn’t know tailscale ${sortQ(v)}, so whether the net can put it back can’t be told.`;
    raise(r, 'lockout', `tailscale ${sortQ(v)} changes Tailscale, a way in.`);
  },
});
