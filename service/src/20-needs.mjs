/* ───────── what is waiting on the owner (H4) ───────── */
// Area: safety        Rules: R21, R26        Tests: needs.test.mjs
// Owns: none
// Timers: none        Wakes: none
// One list of open problems, built by code each time it is asked for, from facts Spark Console already holds: no model
// call, no look at another Spark, and no text from a log, an error, a container's output or the web (so fleet_status
// stays a read of the console's own numbers). Lock-out first, then the owner's data, then the fleet. A line stands while
// its cause does and goes when the cause goes, never because it was shown. Each cause is tried by itself, so one that
// throws never breaks /status. At most 8 lines are said (needsLines: the 8th counts the rest): in /status (page and
// Telegram), at the top of Sparkie's fleet notes, and as needsOwner in fleet_status ("Anything need me?"). Each entry's
// key is its kind and target, never a number or a time, so the needs-me line (20-tell.mjs) tells a new problem from one
// already told. Called only at run time (it reads lets of later parts).
const NEEDS_MAX = 8;
const SAVE_WHY = { ENOSPC: 'the disk is full', EDQUOT: 'the disk is full', EACCES: 'the folder can’t be written', EPERM: 'the folder can’t be written', EROFS: 'the folder can’t be written' };
const tilde = p => String(p).replace(homedir(), '~');
function openProblems() {
  const out = [], add = (key, text) => out.push({ key, text });
  const hereNode = NODES.find(n => n.host === 'local'), here = hereNode ? sparkName(hereNode) : 'the Spark that runs Spark Console';
  // (In this order, which is the order they are said in: a new source goes at the end of its group, not of the list.)
  const sources = [
    // Lock-out: who may sign in, and the other ways in.
    () => { ownAccess(); if (accessBad) add('access', `access.json can’t be read, so Spark Console is using its last good copy and who has access can’t be changed. Mend it, or copy access.json.good over it, in ${tilde(STATE_DIR)} on ${here}.`); },
    () => { if (SECRETS_FILE && secretsRead() === null) add('secrets', `The secrets file on ${here} can’t be read, so Telegram and recovery codes are off. Fix or remove ${tilde(SECRETS_FILE)} there; Spark Console never writes over it.`); },
    // The owner's data: chats kept only in memory (saveChats, 14-chats.mjs), then any other save that failed.
    () => { if (chatsUnsaved) add('chats', `Chats aren’t being saved: ${here}’s state folder can’t be written (full disk?). What you say now is lost at the next restart.`); },
    () => {
      // (a save that worked since, of any file, shows the folder takes writes again)
      const failed = [...saveFailed].filter(([, f]) => Date.parse(f.at) >= saveWorkedAt), names = failed.map(([name]) => name);
      if (!names.length) return;
      const code = failed.at(-1)[1].code;
      add('saves', `Spark Console couldn’t save ${names.slice(0, 4).join(', ')}${names.length > 4 ? ` and ${names.length - 4} more` : ''} (${SAVE_WHY[code] || 'the write failed'}). What changed since is only in memory and is lost at a restart. Free space or fix the folder ${tilde(STATE_DIR)} on ${here}.`);
    },
    () => {
      const free = gbOfGiB(statusCache?.value.nodes.find(n => n.id === hereNode?.id)?.diskFreeGiB);
      if (free !== null && free < 10) add('disk', `${here} has ${free} GB of disk left (under 10). When it fills, chats and settings stop saving. Free some space there.`);
    },
    () => {
      const names = [...new Set(readdirSync(STATE_DIR).map(f => /^([\w.-]+?\.jsonl?)\.unreadable-[\w-]+$/.exec(f)?.[1]).filter(Boolean))];
      if (names.length) add('aside', `Spark Console set aside ${names.length === 1 ? 'a file' : `${names.length} files`} it couldn’t read (${names.slice(0, 4).join(', ')}). What ${names.length === 1 ? 'it' : 'they'} held is kept in ${tilde(STATE_DIR)} on ${here}, with “.unreadable-” in the name. Look there; moving the kept file out of that folder clears this line.`);
    },
    // The state's copy: none newer than 7 days, with changes since (20-state-copy.mjs).
    () => { if (copyLateNow()) add('copy', copyLateWords(here)); },
    // The owner's wishes in memory outgrow what rides every message (20-memory-names.mjs).
    () => memoryNeeds(add),
    // The fleet: Docker not answering on a Spark that is on, then what should be running and isn't (not on a Spark that
    // is off, which the owner powers down on purpose, nor where Docker isn't answering, which is said once above).
    () => {
      for (const n of NODES) if (knowledge.sparks[n.id]?.dockerDownAt && !sparkOff(n.id)) add(`docker:${n.id}`, `Docker isn’t answering on ${sparkName(n)}, so Spark Console can’t see or change its containers. If it doesn’t come back by itself, run this on ${sparkName(n)}: sudo systemctl restart docker. It stops every container there: Sparkie’s model comes back by itself, and the rest need bringing back.`);
    },
    // A Spark Spark Console shut down but couldn't power off cleanly (its plug still drew power, so it was never cut):
    // the owner's to look at. A Spark it powered off as planned is off on purpose, never a line here (21-power.mjs).
    () => {
      for (const [id, r] of Object.entries(powerState().off)) if (r?.problem && nodeById(id)) add(`power:${id}`, `${sparkName(nodeById(id))}: ${r.problem}`);
    },
    () => {
      for (const x of (heldLast || []).filter(y => !y.sparkOff && !y.dockerDown)) add(`held:${keyOf(x)}`, `Should be running but isn’t: ${String(x.container).slice(0, 80)} on ${sparkName(nodeById(x.spark) || { id: x.spark })}. Say “bring back” and its name to start it again; “what should be running?” says why.`);
    },
    // Spark Console itself: restarted by the watchdog, or after an error, in the last day (23-http.mjs keeps both).
    () => {
      const since = Date.now() - 86400000;
      let n = 0, last = 0;
      try { for (const t of readFileSync(WATCHDOG_RESTARTS_FILE, 'utf8').split('\n').map(Number)) if (t > 1e9 && t * 1000 > since) { n++; last = Math.max(last, t * 1000); } } catch {}
      const crashAt = Date.parse(readJson(LAST_CRASH_FILE)?.at || '');
      if (crashAt > since) { n++; last = Math.max(last, crashAt); }
      if (n) add('restarts', `Spark Console stopped and was started again ${n} time${n === 1 ? '' : 's'} in the last day (last at ${new Date(last).toISOString().slice(11, 16)} UTC). If it keeps happening, ask Sparkie what went wrong.`);
    },
    // Its journal (20-journal.mjs): changes a restart cut off, writes failing, a journal past 20 GB.
    () => journalNeeds(add, here),
    // The outside heartbeat (20-beat.mjs) has failed for an hour.
    () => { if (beatLate()) add('heartbeat', `Spark Console hasn’t reached its outside check (hc-ping.com) for over an hour, so the check may say ${here} is down while it is up. Check that ${here} reaches the internet, and that the check still exists at Healthchecks.io.`); },
    // The ways in, watched ahead (20-ways-in.mjs): a Tailscale key near expiry, linger off, Funnel off.
    () => waysInNeeds(add, here),
    // GitHub refused the install's token at the last check_update (21-updates.mjs).
    () => updNeeds(add),
  ];
  for (const f of sources) { try { f(); } catch {} }
  return out;
}
// What is said: at most 8 lines, the 8th counting the rest.
function needsLines(list = openProblems()) {
  const lines = list.map(p => p.text);
  return lines.length > NEEDS_MAX ? [...lines.slice(0, NEEDS_MAX - 1), `And ${lines.length - (NEEDS_MAX - 1)} more. Fix the ones above first.`] : lines;
}
