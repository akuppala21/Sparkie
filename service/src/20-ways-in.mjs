/* ───────── the ways in, watched ahead: Tailscale's keys, linger, Funnel (ledger 5b, addition 6) ───────── */
// Area: safety        Rules: R49        Tests: ways-in.test.mjs
// Owns: funnel-seen.json (writers: noteFunnel; deploy/open-to-internet.sh --undo removes it)
// Timers: none        Wakes: none
// The owner reaches Spark Console through ways in that can each close with no warning: a Tailscale key that expires
// (Spark 2's takes every way in but Telegram with it; a compute Spark's cuts that Spark off), the console's user without
// linger on Spark 2 (its services stop at logout and stay off after a reboot until someone logs in), and Funnel switched
// off. Each is read on a look the console already takes, never on a timer of its own: Tailscale's own status
// (`tailscale status --json`, read by refreshBlocked in 23-http.mjs every 60 s: Spark 2 is Self, a compute Spark the peer
// holding its tailnet address, so no command runs on another Spark), and linger and Funnel with the route check
// (checkRoute, at start and every 60 s). Each look only reads. What they found is kept in memory (a restart looks again
// within a minute), and waysInNeeds turns it into needs-you lines (20-needs.mjs): a key within 14 days of expiring, or
// expired; linger off; Funnel off while funnel-seen.json says it was on. An answer that can't be read, or none for three
// looks, is "couldn't check", never silence. A line's key is its kind and Spark (never a date), so the needs-me line
// (20-tell.mjs) tells it once. Disk space is the status loop's line in 20-needs.mjs: the state folder and the journal sit
// under the home folder whose free space worker.py reports. The GitHub token isn't watched here: its expiry is known only
// by asking GitHub. (docs/rules/R49.md)
const KEY_SOON_MS = 14 * 86400000;
// How often the route check and Tailscale's status are read: every 60 s (tests shorten it, only under ALL_LOCAL).
const ROUTE_MS = ALL_LOCAL && Number(process.env.SPARK_CONSOLE_ROUTE_MS) > 0 ? Number(process.env.SPARK_CONSOLE_ROUTE_MS) : 60000;
// No answer for three looks is "couldn't check"; one look waits 10 s at most.
const LOOK_STALE_MS = 3 * ROUTE_MS + 10000, LOOK_WAIT_MS = 10000;
const FUNNEL_SEEN = `${STATE_DIR}/funnel-seen.json`;
const WAYS_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WAYS_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const waysDay = t => { const d = new Date(t); return `${WAYS_WEEKDAYS[d.getDay()]} ${d.getDate()} ${WAYS_MONTHS[d.getMonth()]}`; };
// The last readable answers and when they came (keysAt, lingerAt); a miss is the latest answer, unreadable.
const waysIn = { from: Date.now(), keys: null, keysAt: 0, keysMiss: false, linger: null, lingerAt: 0, lingerMiss: false, lingerBusy: false };

// Tailscale's status, as refreshBlocked read it: each Spark's key expiry (none: expiry is off for it) and whether
// Tailscale says it has expired, with the machine's name as Tailscale's admin page shows it (a plain name, or none).
function noteTailnet(code, out) {
  let st = null;
  try { st = code === 0 ? JSON.parse(out) : null; } catch {}
  if (!st || typeof st !== 'object' || !st.Self || typeof st.Self !== 'object') { waysIn.keysMiss = true; return; }
  const peers = Object.values(st.Peer && typeof st.Peer === 'object' ? st.Peer : {}).filter(p => p && typeof p === 'object'), keys = {}, ssh = {};
  for (const n of NODES) {
    const p = n.host === 'local' ? st.Self : peers.find(x => Array.isArray(x.TailscaleIPs) && x.TailscaleIPs.some(ip => ip && (ip === n.ip || ip === n.host)));
    if (!p) continue;
    const t = Date.parse(typeof p.KeyExpiry === 'string' ? p.KeyExpiry : ''), name = [String(p.DNSName || '').split('.')[0], p.HostName].find(x => /^[a-z0-9][a-z0-9-]{0,62}$/i.test(x || ''));
    keys[n.id] = { expires: Number.isFinite(t) ? t : null, expired: p.Expired === true, machine: name || null };
    // (whether that Spark advertises Tailscale SSH: its entry carries host keys for it; the ladder asks while one does,
    // 21-ladder.mjs. "Off" only for this machine or a peer that is online now; an offline one, or a Spark not in the
    // answer, is null or no entry here: "can't tell", never "off".)
    ssh[n.id] = Array.isArray(p.sshHostKeys) && p.sshHostKeys.length > 0 ? true : p === st.Self || p.Online === true ? false : null;
  }
  Object.assign(waysIn, { keys, ssh, keysAt: Date.now(), keysMiss: false });
}

// Linger for the console's own user on Spark 2, read as the installer reads it. One look at a time.
function lookLinger() {
  const hub = NODES.find(n => n.host === 'local');
  if (!hub || waysIn.lingerBusy) return;
  waysIn.lingerBusy = true;
  let out = '';
  const child = spawnOn(hub, { command: `loginctl show-user ${Number(process.getuid?.() ?? -1)} -p Linger --value` });
  const timer = setTimeout(() => child.kill('SIGKILL'), LOOK_WAIT_MS);
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', () => {});
  child.on('error', () => {});
  child.on('close', code => {
    clearTimeout(timer);
    waysIn.lingerBusy = false;
    const v = code === 0 ? out.trim() : '';
    if (v === 'yes' || v === 'no') Object.assign(waysIn, { linger: v === 'yes', lingerAt: Date.now(), lingerMiss: false });
    else waysIn.lingerMiss = true;
  });
}

// The console's record that Funnel should be on: written the first time the route check sees Funnel on for the main
// address. Only the owner's `deploy/open-to-internet.sh --undo` (closing it on purpose) removes it.
function noteFunnel() {
  if (funnelOn !== true || existsSync(FUNNEL_SEEN)) return;
  try { writePrivate(FUNNEL_SEEN, { seenOnAt: new Date().toISOString() }); } catch {}
}

// The needs-you lines (openProblems, 20-needs.mjs). Each is tried by itself.
function waysInNeeds(add, here) {
  const now = Date.now(), stale = at => now - (at || waysIn.from) > LOOK_STALE_MS;
  const keyLines = () => {
    for (const n of NODES) {
      const k = waysIn.keys?.[n.id], name = sparkName(n), hub = n.host === 'local';
      if (!k) continue;
      const gone = k.expired || (k.expires !== null && k.expires <= now);
      if (!gone && (k.expires === null || k.expires - now > KEY_SOON_MS)) continue;
      const machine = k.machine || name, cut = hub ? 'only Telegram reaches Spark Console' : `Spark Console can’t reach ${name}`;
      if (gone) add(`tailscale-key:${n.id}`, `${name}’s Tailscale key expired${k.expires !== null ? ` on ${waysDay(k.expires)}` : ''}, so ${cut}. To fix it, sign in to Tailscale again on ${name}, then turn off key expiry in Tailscale’s admin page (Machines → ${machine}).`);
      else {
        const days = Math.ceil((k.expires - now) / 86400000);
        add(`tailscale-key:${n.id}`, `${name}’s Tailscale key expires in ${days} day${days === 1 ? '' : 's'}, on ${waysDay(k.expires)}. After that, ${cut}. Before then: Tailscale’s admin page → Machines → ${machine} → Disable key expiry.`);
      }
    }
  };
  const tries = [
    keyLines,
    () => { if (waysIn.keysMiss || stale(waysIn.keysAt)) add('tailscale-unread', `Spark Console couldn’t read Tailscale’s state on ${here}, so it can’t warn before a Tailscale key expires. Check that Tailscale is running there: tailscale status`); },
    () => { if (waysIn.linger === false) add('linger', `Spark Console stops when you log out of ${here}, and after a restart it stays off until you log in. To keep it running, run this once on ${here}: sudo loginctl enable-linger $USER`); },
    () => { if (waysIn.lingerMiss || stale(waysIn.lingerAt)) add('linger-unread', `Spark Console couldn’t check whether it starts by itself after ${here} restarts. Check on ${here}: loginctl show-user $USER -p Linger`); },
    () => { if (funnelOn === false && existsSync(FUNNEL_SEEN)) add('funnel', 'Funnel is off, so Spark Console can’t be reached from the internet: only devices with Tailscale on get in. To open it again: bash spark-console/deploy/open-to-internet.sh. Closed on purpose? Run it with --undo and this line goes.'); },
  ];
  for (const f of tries) { try { f(); } catch {} }
}
