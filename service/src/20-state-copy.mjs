/* ───────── when the state's copy goes: only while another Spark is awake anyway ───────── */
// Area: safety        Rules: R23, R41        Tests: copy.test.mjs, state.test.mjs
// Owns: none
// Timers: none        Wakes: none
// What a copy is, and how it lands, is 25-backup-and-start.mjs's (sendCopy, backupState, backup.json). This part says
// when one goes and where, so a copy never wakes a Spark and nothing is sent when nothing changed (owner decision 5,
// contract 6.25):
// - a compute Spark comes online (the status check sees it come back, or sees it on for the first time: by itself, by
//   the owner's hand, or turned on by Spark Console): it gets a copy if the state changed since the newest good copy
//   (copyOnWake, from 19-watcher.mjs);
// - just before Spark Console powers a Spark off: if the state changed since the newest good copy, that Spark gets one
//   first, inside the power-off's operation (copyBeforeOff, from 21-power.mjs). It waits for a copy already under way
//   and then for its own, each no longer than a copy may take (sendCopy: 3 minutes for the stream, 1 for the move). A
//   copy that fails is on the record (backup.json's last try, and a line in the operation's log), and the power-off
//   goes ahead;
// - the hourly look (backupIfDue): it sends only while a Spark is on and the state changed.
// A copy is not use of a Spark: the idle power-off doesn't count it, so copies never keep a Spark on.
// A copy goes only to a Spark that is awake (copyAwake): one the status check's last look saw on, and never one Spark
// Console powered off or is powering off. Nothing here turns a Spark on.
// "Changed" is one mark of the state folder (stateMark): each file's name, size and time, less what Spark Console
// rewrites by itself as it watches and logs (COPY_IGNORES). The newest good copy keeps its mark (goodMark in
// backup.json). No copy newer than 7 days, with changes since: one needs-you line (copyLateWords) and one notice
// (copyLate), until a copy lands. Never before day 7: the owner takes up to a week of changes over waking a Spark.
const COPY_LATE_MS = 7 * 86400000;
// How long a power-off waits for a copy already under way before it looks again (a copy takes 4 minutes at most).
const COPY_WAIT_MS = 5 * 60000;
// Files Spark Console rewrites by itself as it watches and logs: in every copy, but a change to them alone makes none
// due. The copy's own record; the fleet's record and the audit log; what the watcher, the status check, the cable test,
// healing, power and Telegram keep; the watchdog's counts; a crash record; and cloud.json, which no copy carries.
const COPY_IGNORES = new Set(['backup.json', 'events.jsonl', 'audit.jsonl', 'knowledge.json', 'energy.json', 'links.json', 'heal-tries.json',
  'power.json', 'telegram.json', 'watchdog-misses', 'watchdog-restarts', 'api-locked', 'last-crash.json', 'cloud.json']);

// The state folder as one mark: each file's name, size and time, in name order, less COPY_IGNORES, sockets, a save under
// way (.tmp) and the copy from before a save (.prev). null when it can't be read: a copy is then due.
function stateMark() {
  try {
    const h = createHash('sha256');
    const walk = (dir, rel, depth) => {
      for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
        const name = rel ? `${rel}/${e.name}` : e.name;
        if (COPY_IGNORES.has(name) || /\.(sock|tmp|prev)$/.test(e.name)) continue;
        if (e.isDirectory()) { if (depth < 4) walk(`${dir}/${e.name}`, name, depth + 1); continue; }
        if (!e.isFile()) continue;
        const s = statSync(`${dir}/${e.name}`);
        h.update(`${name}\0${s.size}\0${s.mtimeMs}\n`);
      }
    };
    walk(STATE_DIR, '', 0);
    return h.digest('hex').slice(0, 16);
  } catch { return null; }
}
// The state changed since the newest good copy (with none yet, or no mark kept with it: changed).
const copyDue = () => BACKUP_ON && !(lastBackup?.good && lastBackup.goodMark && lastBackup.goodMark === stateMark());
// What a try adds to backup.json (backupState): the state's mark at the newest good copy, and, while there has never been
// a good copy, since when one has been tried, where the 7 days start.
function keepMarks(rec, before, mark) {
  rec.goodMark = rec.ok ? mark : before?.goodMark ?? null;
  if (!rec.good) rec.since = before?.since || rec.at;
}
// Awake for a copy: the status check's last look saw it on, Spark Console didn't power it off, and isn't powering it off.
const copyAwake = id => statusCache?.value.nodes.find(x => x.id === id)?.state === 'online' && !consoleOff(id)
  && ![...jobs.values()].some(j => j.status === 'running' && j.type === 'power-off' && (j.nodes || [j.node]).includes(id));

// A Spark came online: if it may take a copy and the state changed, it gets one (another awake Spark if it fails).
function copyOnWake(id) {
  if (!copyDue() || !backupTargets(id).some(n => n.id === id)) return;
  backupState(id).catch(e => console.error(`The copy of the state when ${id} came online: ${e.message}`));
}

// Inside a power-off (powerOffJob): the Sparks about to go down get the copy first if the state changed. Never throws;
// says in the operation's log what happened when a copy was tried.
async function copyBeforeOff(j, ids) {
  if (!BACKUP_ON) return;
  try {
    for (const id of ids) {
      for (let i = 0; i < 3 && copyDue(); i++) {
        if (backingUp) {
          step(j, 'Waiting for the copy of Spark Console’s state that is under way');
          const was = lastBackup;
          for (const until = Date.now() + COPY_WAIT_MS; backingUp && Date.now() < until;) await sleep(500);
          const b = lastBackup;
          note(j, backingUp ? 'That copy is still going after 5 minutes; powering off without waiting longer.'
            : b !== was && b?.ok ? `That copy landed on ${sparkName(nodeById(b.to) || { id: b.to })}` : 'That copy didn’t land');
        }
        if (backingUp || !copyDue()) break;
        const name = sparkName(nodeById(id) || { id }), before = lastBackup;
        step(j, `Copying Spark Console’s state to ${name} first`);
        await backupState(id);
        const b = lastBackup;
        // (another copy began first: wait for it, then look again)
        if (b === before) continue;
        const g = b.good, hold = g && sparkName(nodeById(g.to) || { id: g.to });
        note(j, b.ok ? `Spark Console’s state was copied to ${hold} first`
          : `Spark Console’s state couldn’t be copied first (${b.error}), so ${name} goes down without it. ${g ? `The newest copy is from ${String(g.at).slice(0, 10)}, on ${hold}.` : 'There is no good copy yet.'}`);
        break;
      }
    }
  } catch (e) { note(j, `The copy of Spark Console’s state before the power-off didn’t run (${String(e?.message || e).split('\n')[0].slice(0, 200)}); powering off anyway.`); }
}

// No copy newer than 7 days, with changes since (none ever: 7 days from the first try).
function copyLateNow() {
  if (!BACKUP_ON || !lastBackup) return false;
  const from = Date.parse(lastBackup.good?.at || lastBackup.since || '');
  return Number.isFinite(from) && Date.now() - from >= COPY_LATE_MS && copyDue();
}
// The words, for the needs-you list and the notice. Code-built: Spark names, days, and the last try's own fixed phrase.
function copyLateWords(here) {
  const b = lastBackup, g = b.good, hold = g && sparkName(nodeById(g.to) || { id: g.to });
  const tried = b.ok === false && b.error && (!g || String(b.at) > String(g.at)) ? ` The last try, on ${String(b.at).slice(0, 10)}, didn’t work: ${b.error}.` : '';
  return `${g ? `Spark Console’s state hasn’t been copied to another Spark for over 7 days (the newest copy is from ${String(g.at).slice(0, 10)}, on ${hold}), and it has changed since.`
    : 'Spark Console’s state has never been copied to another Spark, and no copy has landed in over 7 days.'}${tried} A copy goes by itself the next time another Spark is on; none is turned on for it, so turn one on for a few minutes. Until then, losing ${here}’s disk would lose what changed.`;
}
// The notice (R23): once when the copy goes late, and not again until a copy lands (noticedOn: the day it went out; one
// from the day it went late or after was this late spell's).
function copyLate() {
  if (!copyLateNow()) return;
  const late = dayOf(Date.parse(lastBackup.good?.at || lastBackup.since) + COPY_LATE_MS);
  if (lastBackup.noticedOn && lastBackup.noticedOn >= late) return;
  lastBackup.noticedOn = dayOf(Date.now());
  try { writePrivate(BACKUP_FILE, lastBackup); } catch (e) { console.error(`Couldn’t save the copy’s record: ${e.message}`); }
  const hub = NODES.find(n => n.host === 'local');
  fleetEvent({ type: 'notice', text: copyLateWords(hub ? sparkName(hub) : 'the Spark that runs Spark Console') });
}
