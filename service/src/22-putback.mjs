/* ───────── state put back from a copy lets no device or key in by itself ───────── */
// Area: ways in        Rules: R23, R33        Tests: putback.test.mjs
// Owns: auth-serial.json (writers: putBackSerialWrite), auth-unnoted.json (writers: putBackUnnotedSave)
// Timers: putBackRetry (every 60 s: a removal's note that couldn't be written yet)        Wakes: none
// Contract 6.25 (design E 2.5, P-3). One number, the auth serial, is kept twice: in the state folder (auth-serial.json,
// so every copy and install snapshot carries the number it had then) and in the secrets file (never copied). A state
// that holds a passkey or an agent key always has one: 1 from the first (putBackSeed, at start too). It goes up by one at
// each removal by the owner: a device signed out, a passkey, an agent key, a right taken from an agent key (look-only,
// tailnet-only), agents' changes paused, an "always allowed" kind taken away (/allowed off, 21-ahead.mjs). The secrets
// file also notes what was removed (kind and id; for a narrowing, the right it took), first, before the removal is saved
// (putBackRemoval); a note that can't be written is kept, said and tried again. Nothing else writes either number;
// restore.sh --with-state removes the state's. (Grants that never travel with a state copy need none: the go-ahead and
// open asks live in memory; the Telegram pairing, its approvals switch and recovery codes in the secrets file; root's
// switch on its Spark, read there at each command. Not covered: a saved workflow's yes to its images, R23's Today.)
// At start (putBackAtStart, before the sockets open), the state was put back (by restore.sh --with-state, or by hand from
// a copy) when something the secrets file notes as removed is in the state again, whatever the numbers say; or when the
// state's number is below the secrets file's (a state with no number is one when the secrets file has a number); or when
// the state has a number and the secrets file none (a new disk). Nothing in the state folder, no agent and no walled
// command can lower the secrets file's number. A copy made before this build, on a new disk, has no number: no hold.
// Then, before anything is answered: what the owner removed since is removed again, every device is signed out (also
// sessions an older copy or snapshot still held), the owner's own pause comes back, and a task under way is parked, with
// a line in its chat. The hold follows until the owner, on the tailnet, looks at the list of what came back and presses
// "Keep these" (with the passkey, if one is set up). While it holds, from the internet nothing signs a device in (a
// passkey, a recovery code, a device code) and no agent key works: each gets one plain line (PUTBACK_LINE). Agents'
// changes are refused on the tailnet too, and an approval from Telegram waits. The tailnet door is the owner at once,
// the owner's own chat and Telegram requests work, and go-back.sh and an update's way back (program files only) never
// trip it. A secrets file that can't be read keeps the last answer read while Spark Console runs, so a hold doesn't lift;
// after a start with the file unreadable, nothing is held until it reads again; a hold whose own write fails is held in
// memory until the next start, and said. The check runs only at a start: an older copy untarred under a running Spark
// Console is live until then (R23's Today). A right the owner gave back to a key
// after taking it is taken again at a put-back (the owner gives it back again).
const PUTBACK_FILE = `${STATE_DIR}/auth-serial.json`;
const PUTBACK_LINE = 'Spark Console’s state was put back from a copy. Open it once on your tailnet and look at the list of what came back; after that, sign-in from the internet works again.';
const PUTBACK_AGENTS = 'Spark Console’s state was put back from a copy, so agents can’t change anything until the owner has looked at what came back, on the tailnet, and kept it.';
const PUTBACK_TG = 'Spark Console’s state was put back from a copy, so this waits until you have looked at what came back: open Spark Console once on your tailnet.';
const PUTBACK_KEPT_MAX = 500;
// The state's own number: 0 when there is none.
function putBackSerial() {
  const v = readJson(PUTBACK_FILE);
  return Number.isInteger(v?.serial) && v.serial > 0 ? v.serial : 0;
}
const putBackSerialWrite = n => writePrivate(PUTBACK_FILE, { serial: n });
// The secrets file's part (auth: serial, removed, halted, hold): read again only when the file changed.
const putBackSeen = { at: 0, mtime: null, auth: {} };
function putBackAuth() {
  if (!SECRETS_FILE) return {};
  if (Date.now() - putBackSeen.at < 500) return putBackSeen.auth;
  putBackSeen.at = Date.now();
  let mtime = null;
  try { mtime = statSync(SECRETS_FILE).mtimeMs; } catch {}
  if (mtime !== putBackSeen.mtime) {
    const s = secretsRead();
    // (one that can't be read keeps the last answer while this process runs: a hold doesn't lift; there is none yet
    // after a start, so then nothing is held until it reads again)
    if (s === null) return putBackSeen.auth;
    putBackSeen.auth = s.auth && typeof s.auth === 'object' && !Array.isArray(s.auth) ? s.auth : {};
    putBackSeen.mtime = mtime;
  }
  return putBackSeen.auth;
}
// A hold that couldn't be written to the secrets file at a start is held in memory until the next start (said).
let putBackMemHold = null;
const putBackHold = () => putBackAuth().hold || putBackMemHold;
const putBackHeld = () => Boolean(putBackHold());
const putBackRemovedList = a => (Array.isArray(a.removed) ? a.removed.filter(r => r && typeof r === 'object') : []);

// A removal by the owner (P-3, round two): the note goes first, then the removal's own save, then the state's number.
// The note is the secrets file's number (one above the higher of the two) and what went; if the save then throws, the
// note is taken out again and the error is the route's, as before. A stop between the note and the save leaves the
// secrets file ahead with the removal noted: the next start holds and removes it again (the safe side). A note that
// can't be written (the secrets file can't be written or read just then) never stops the removal: it is done at once,
// the state's number still goes up, and the note is kept in the state folder (auth-unnoted.json, which an older copy
// untarred over the folder doesn't hold, so it stays), said in the removal's answer and on the needs-you list, and
// written at the next removal, each minute (putBackRetry), and at the next start before anything is judged. items: one
// or more of { kind, id, name, extra }; kind: session, passkey, agent, narrowed (with the right it took: extra
// { act: false } or { internet: false }, or both), paused, allowed (an "always allowed" kind, by its id); resumed notes
// the owner's resume and changes no number. Returns null when it was noted, else the sentence for the answer.
const PUTBACK_UNNOTED_FILE = `${STATE_DIR}/auth-unnoted.json`;
const PUTBACK_RETRY_MS = Number(process.env.SPARK_CONSOLE_PUTBACK_RETRY_MS || 60000);
const PUTBACK_UNNOTED_SAID = 'Done. Its note outside the state (in the secrets file) couldn’t be written just now, so an older copy of the state put back by hand could bring it back: Spark Console tries again every minute and says so on the needs-you list until it is written.';
const putBackUnnoted = { why: null };
function putBackUnnotedRead() {
  const v = readJson(PUTBACK_UNNOTED_FILE);
  return Array.isArray(v?.notes) ? v.notes.filter(x => x && typeof x === 'object' && typeof x.kind === 'string').slice(-PUTBACK_KEPT_MAX) : [];
}
function putBackUnnotedSave(notes) {
  if (notes.length) writePrivate(PUTBACK_UNNOTED_FILE, { notes: notes.slice(-PUTBACK_KEPT_MAX) });
  else if (existsSync(PUTBACK_UNNOTED_FILE)) unlinkSync(PUTBACK_UNNOTED_FILE);
}
// Writes notes into the secrets file: its number at least `serial`, what went added, the pause as the last pause or resume
// left it. Throws when the file can't be read or written.
function putBackNoteWrite(notes, serial) {
  const s = secretsRead();
  if (s === null) throw new Error('the secrets file can’t be read');
  secretsWrite(x => {
    const a = { ...(x.auth && typeof x.auth === 'object' && !Array.isArray(x.auth) ? x.auth : {}) };
    a.serial = Math.max(serial, Number.isInteger(a.serial) ? a.serial : 0);
    for (const r of notes) {
      // (a resume is noted only over a pause that was: nothing else to put right later)
      if (r.kind === 'paused' || r.kind === 'resumed') { if (r.kind === 'paused' || a.halted === true) a.halted = r.kind === 'paused'; continue; }
      a.removed = [...putBackRemovedList(a), { kind: r.kind, id: String(r.id), ...(r.name ? { name: clean(r.name, 60) } : {}), ...(r.extra || {}), at: r.at || new Date().toISOString() }].slice(-PUTBACK_KEPT_MAX);
    }
    return { ...x, auth: a };
  });
  putBackSeen.at = 0;
}
function putBackRemoval(items, save) {
  const now = new Date().toISOString(), notes = [].concat(items).map(r => ({ ...r, at: now }));
  if (!SECRETS_FILE) { save(); return null; }
  const pending = putBackUnnotedRead(), raises = notes.some(r => r.kind !== 'resumed');
  let n = null, had, noted = false;
  try {
    const s = secretsRead();
    if (s === null) throw new Error('the secrets file can’t be read');
    had = s.auth;
    n = Math.max(putBackSerial(), Number.isInteger(s.auth?.serial) ? s.auth.serial : 0) + (raises ? 1 : 0);
    putBackNoteWrite([...pending, ...notes], n);
    noted = true;
  } catch (e) { putBackUnnoted.why = e.message; console.error(`What was removed couldn’t be noted outside the state just now (it is tried again): ${e.message}`); }
  try { save(); } catch (e) {
    // (the removal itself failed: its note is taken out again, and the error is the route's)
    if (noted) try { secretsWrite(x => { const y = { ...x }; if (had === undefined) delete y.auth; else y.auth = had; return y; }); putBackSeen.at = 0; } catch (e2) { console.error(`A note of a removal that failed couldn’t be taken out again: ${e2.message}`); }
    throw e;
  }
  if (noted) {
    try { if (raises) putBackSerialWrite(n); } catch (e) { console.error(`The state’s number couldn’t be raised (the secrets file is ahead, so the next start holds): ${e.message}`); }
    try { if (pending.length) putBackUnnotedSave([]); putBackUnnoted.why = null; } catch (e) { console.error(`The note of earlier removals stays on disk: ${e.message}`); }
    return null;
  }
  // (not noted: the removal stands; the state's number still goes up, and the note waits on disk)
  try { if (raises) putBackSerialWrite(Math.max(putBackSerial(), Number.isInteger(putBackAuth().serial) ? putBackAuth().serial : 0) + 1); } catch (e) { console.error(`The state’s number couldn’t be raised: ${e.message}`); }
  try { putBackUnnotedSave([...pending, ...notes]); } catch (e) { console.error(`The removal couldn’t be kept to note later either: ${e.message}`); }
  return PUTBACK_UNNOTED_SAID;
}
// The notes still waiting, written now if the secrets file takes them (each minute, and at a start before the check).
function putBackRetry() {
  if (!SECRETS_FILE) return true;
  let pending;
  try { pending = putBackUnnotedRead(); } catch { return false; }
  if (!pending.length) { putBackUnnoted.why = null; return true; }
  try {
    putBackNoteWrite(pending, putBackSerial());
    putBackUnnotedSave([]);
    putBackUnnoted.why = null;
    console.error(`What was removed is noted outside the state now (${pending.length} removal${pending.length === 1 ? '' : 's'}).`);
    return true;
  } catch (e) { putBackUnnoted.why = e.message; return false; }
}
setInterval(() => { try { putBackRetry(); } catch {} }, PUTBACK_RETRY_MS).unref?.();

// A state that holds a passkey or an agent key and no number, with none in the secrets file either, is given 1 in both
// (at start, and after a passkey or a key is added), so every copy and snapshot made of it carries one. Either number
// alone reads as a put-back at the next start (the secrets file's alone, an older copy; the state's alone, a new disk),
// so a failed write leaves neither: the secrets file first (if that fails, nothing was written), then the state; if the
// state's write fails, the secrets file's number is taken out again. (Only a stop between the two writes, or both
// writes to the secrets file failing, leaves the secrets file's alone: a hold, which the owner's "Keep these" ends.)
function putBackSeed() {
  if (!SECRETS_FILE) return;
  try {
    const s = secretsRead();
    if (s === null || putBackSerial() || (Number.isInteger(s.auth?.serial) && s.auth.serial > 0) || !(passkeys().length || agentKeys().length)) return;
    const had = s.auth;
    secretsWrite(x => ({ ...x, auth: { ...(x.auth && typeof x.auth === 'object' && !Array.isArray(x.auth) ? x.auth : {}), serial: 1 } }));
    try { putBackSerialWrite(1); } catch (e) {
      try { secretsWrite(x => { const y = { ...x }; if (had === undefined) delete y.auth; else y.auth = had; return y; }); } catch (e2) { console.error(`The secrets file’s number couldn’t be taken out again: ${e2.message}`); }
      throw e;
    } finally { putBackSeen.at = 0; }
  } catch (e) { console.error(`The state’s number couldn’t be started: ${e.message}`); }
}

// At start, before the sockets open (25-backup-and-start.mjs). Never throws. While it holds, each start removes again
// what the owner removed and signs every device out again (a second put-back under the hold can bring either back);
// each one ends the tasks the state holds, with a line in each chat; only the first brings back the owner's pause and
// says so.
function putBackAtStart() {
  if (!SECRETS_FILE) return;
  try {
    // (removals the last run couldn't note outside the state are noted now, before anything is judged: a number levelled
    // since never forgets what went, and what an older copy brought back is removed again)
    if (!putBackRetry()) console.error(`Removals still not noted outside the state: ${putBackUnnoted.why}`);
    const s = secretsRead();
    if (s === null) { console.error('The secrets file can’t be read, so whether the state was put back from a copy can’t be told.'); return; }
    const a = s.auth && typeof s.auth === 'object' && !Array.isArray(s.auth) ? s.auth : {}, t = putBackSerial();
    const n = Number.isInteger(a.serial) && a.serial > 0 ? a.serial : 0, first = !a.hold;
    const removed = putBackRemovedList(a), gone = kind => new Set(removed.filter(r => r.kind === kind).map(r => String(r.id)));
    // Something the owner removed is in the state again: put back, whatever the numbers say (a snapshot with no number
    // put back over a state with one, by an older snapshot's restore.sh or by hand).
    let back = false;
    try {
      const [p, k, d, w] = [gone('passkey'), gone('agent'), gone('session'), gone('allowed')];
      back = passkeys().some(x => p.has(String(x.id))) || agentKeys().some(x => k.has(String(x.id))) || sessionList().some(x => d.has(String(x.id)))
        || allowedList().some(x => w.has(String(x.id)));
    } catch {}
    if (first && !back && n && t > n) { secretsWrite(x => ({ ...x, auth: { ...(x.auth || {}), serial: t } })); return; }
    if (first && !back && (n ? t >= n : !t)) { putBackSeed(); return; }
    const again = [];
    try {
      const keys = passkeys(), drop = gone('passkey'), kept = keys.filter(k => !drop.has(String(k.id)));
      if (kept.length < keys.length) { savePasskeys(kept); again.push(...keys.filter(k => drop.has(String(k.id))).map(k => ({ kind: 'passkey', name: clean(k.name, 60) }))); }
    } catch (e) { console.error(`The passkeys after a put-back: ${e.message}`); }
    try {
      const keys = agentKeys(), drop = gone('agent'), kept = keys.filter(k => !drop.has(String(k.id)));
      let changed = kept.length < keys.length;
      again.push(...keys.filter(k => drop.has(String(k.id))).map(k => ({ kind: 'agent key', name: clean(k.name, 60) })));
      // A right the owner took from a key (each narrowing notes the right it took): taken again, never given.
      const took = (k, right) => removed.some(r => r.kind === 'narrowed' && String(r.id) === String(k.id) && r[right] === false);
      for (const k of kept) {
        if (took(k, 'act') && (k.scopes || []).includes('fleet:act')) { k.scopes = ['fleet:read']; changed = true; again.push({ kind: 'agent key’s right to change things', name: clean(k.name, 60) }); }
        if (took(k, 'internet') && k.internet !== false) { k.internet = false; changed = true; again.push({ kind: 'agent key’s use from the internet', name: clean(k.name, 60) }); }
      }
      if (changed) writePrivate(AGENTS_FILE, { keys: kept });
    } catch (e) { console.error(`The agent keys after a put-back: ${e.message}`); }
    // An "always allowed" kind the owner took away (/allowed off): taken away again.
    try {
      const list = allowedList(), drop = gone('allowed'), back2 = list.filter(e => drop.has(String(e.id)));
      if (back2.length) {
        setAgentSettings({ allowed: list.filter(e => !drop.has(String(e.id))) });
        again.push(...back2.map(e => ({ kind: 'always-allowed command', name: clean(`${e.program} in ${e.under} on ${sparkName(nodeById(e.spark) || { id: e.spark })}`, 60) })));
      }
    } catch (e) { console.error(`The always-allowed list after a put-back: ${e.message}`); }
    let signedOut = 0;
    try { signedOut = sessionList().length; if (signedOut || existsSync(SESSIONS_FILE)) saveSessions([]); } catch (e) { console.error(`The devices after a put-back: ${e.message}`); }
    // Every task in the state ends, with a line in its chat: also at a second put-back under the hold, so a copy never
    // brings back a request that would run by itself after the start (14-tasks.mjs).
    let parked = 0;
    try {
      const at = new Date().toISOString();
      for (const conv of chatData().conversations.filter(c => c.task)) {
        const request = String(conv.task.request || '').slice(0, 200), was = conv.task;
        conv.task = null;
        taskEnded(conv, was, 'put-back');
        conv.messages.push({ role: 'assistant', content: maskSecrets(`Spark Console’s state was put back from a copy, so “${request}” isn’t carried on. Once you have looked at what came back (open Spark Console on your tailnet), say “carry on” if it’s still wanted.`), createdAt: at, notice: true });
        conv.updatedAt = at;
        parked++;
      }
      if (parked) saveChats();
    } catch (e) { console.error(`The tasks after a put-back: ${e.message}`); }
    if (!first) return;
    try { if (typeof a.halted === 'boolean' && agentSettings().halted !== a.halted) setAgentSettings({ halted: a.halted, autoPaused: false }); } catch (e) { console.error(`The agents’ pause after a put-back: ${e.message}`); }
    const since = new Date().toISOString(), hold = { since, state: t, again: again.slice(0, 50), signedOut, parked };
    // (a hold that can't be written is held in memory all the same, until the next start, and said)
    let kept = true;
    try { secretsWrite(x => ({ ...x, auth: { ...(x.auth || {}), hold } })); } catch (e) { kept = false; putBackMemHold = { ...hold, unsaved: e.message }; console.error(`The hold couldn’t be saved, so it holds only until Spark Console next starts: ${e.message}`); }
    putBackSeen.at = 0;
    audit({ via: 'start', actor: 'Spark Console', action: 'state-put-back', args: { state: t, secrets: n || null, removedAgain: again.length, signedOut, parked }, ok: true });
    // (names typed by whoever set each one up: masked, as every notice that names what someone typed)
    fleetEvent({ type: 'notice', text: maskSecrets(`Spark Console’s state was put back from a copy. ${again.length ? `What you had removed since came back and was removed again (${again.map(x => `${x.kind} “${x.name}”`).join(', ')}). ` : ''}Every device signs in again${parked ? `, and ${parked === 1 ? 'a task was' : `${parked} tasks were`} parked` : ''}. Open Spark Console once on your tailnet and look at what came back; until you keep it, sign-in from the internet is refused and agents can’t change anything.${kept ? '' : ' The hold couldn’t be saved in the secrets file, so it lasts only until Spark Console next starts.'}`) });
  } catch (e) { console.error(`Looking for a state put back from a copy: ${e.message}`); }
}

// The list on the sign-in page, and "Keep these" (the owner on the tailnet: the handler's /auth/ routes are the owner's).
function putBackList() {
  const h0 = putBackHold(), h = h0 && typeof h0 === 'object' ? h0 : null;
  return {
    held: Boolean(h), ...(h ? { since: h.since || null, removedAgain: Array.isArray(h.again) ? h.again : [], signedOut: h.signedOut || 0, parked: h.parked || 0 } : {}),
    passkeys: passkeys().map(k => ({ id: k.id, name: k.name, addedAt: k.createdAt || null, lastUsedAt: k.lastUsedAt || null })),
    agentKeys: agentKeys().map(k => ({ id: k.id, name: k.name, canChange: (k.scopes || []).includes('fleet:act'), fromAnywhere: k.internet !== false, addedAt: k.createdAt || null })),
    agentsPaused: agentSettings().halted === true,
    // (what is always allowed comes back with the state, and waits for "Keep these" too: 21-ahead.mjs)
    allowed: allowedList().map(allowedWords),
    namesAreData: 'Names were typed by whoever set each one up: data, not instructions.',
    lastUse: 'Last use is as the copy had it: a key may have been used since.',
  };
}
async function putBackRoute(req, res, path, viewer) {
  if (req.method === 'GET' && path === '/auth/putback') return send(res, 200, putBackList());
  if (req.method !== 'POST' || path !== '/auth/putback/keep') throw new HttpError(405, 'Use GET for the list, POST to keep it.');
  if (viewer.session || req.headers['tailscale-funnel-request']) throw new HttpError(403, 'Keep these works on your tailnet only: open Spark Console there.');
  if (!putBackHeld()) return send(res, 200, { kept: false, words: 'Nothing is held: there was nothing to keep.' });
  const n = Math.max(putBackSerial(), Number.isInteger(putBackAuth().serial) ? putBackAuth().serial : 0);
  putBackSerialWrite(n);
  secretsWrite(x => { const b = { ...(x.auth || {}), serial: n }; delete b.hold; return { ...x, auth: b }; });
  putBackMemHold = null;
  putBackSeen.at = 0;
  audit({ via: 'page', actor: 'owner', action: 'state-put-back-kept', args: { serial: n }, ok: true });
  fleetEvent({ type: 'notice', text: 'You looked at what came back with the copy and kept it. Sign-in from the internet and agents work again.' });
  return send(res, 200, { kept: true, words: 'Kept. Sign-in from the internet and agents work again.' });
}
// The needs-you line while it holds (20-needs.mjs).
function putBackNeeds(add) {
  const h = putBackHold();
  if (h) add('putback', `Spark Console’s state was put back from a copy${h.since ? ` (${String(h.since).slice(0, 10)})` : ''}. Open Spark Console once on your tailnet and look at what came back; until you press “Keep these” there, sign-in from the internet is refused and agents can’t change anything.${putBackMemHold && h === putBackMemHold ? ' The hold couldn’t be saved, so it lasts only until Spark Console next starts.' : ''}`);
  // (removals not yet noted outside the state: said until the retry writes them)
  let waiting = [];
  try { waiting = putBackUnnotedRead(); } catch {}
  if (waiting.length) add('putback-unnoted', `${waiting.length === 1 ? 'A removal' : `${waiting.length} removals`} (${[...new Set(waiting.map(x => x.kind))].join(', ')}) couldn’t be noted outside the state yet${putBackUnnoted.why ? ` (${String(putBackUnnoted.why).slice(0, 120)})` : ''}. ${waiting.length === 1 ? 'It is' : 'They are'} done; Spark Console tries the note again every minute. Until it is written, an older copy of the state put back by hand could bring ${waiting.length === 1 ? 'it' : 'them'} back.`);
}
