/* ───────── a saved workflow's run, kept on disk so a restart of Spark Console finishes it (D6f) ───────── */
// Area: core        Rules: R32, R57        Tests: workloads-restart.test.mjs, workloads-receipts.test.mjs, tasks-telegram.test.mjs
// Owns: saved-runs.json (writers: savedRunKeep, savedRunDone, savedRunsRecover)
// Timers: none        Wakes: none
// Design D 2.3: "after a console restart, code stops in reverse order what this run started". A run keeps a small record
// of itself in saved-runs.json (R20: writePrivate and readKept; names, Spark ids and the chat id, no secret), rewritten as
// it goes: its title, the chat that asked, how many steps and which one it is at, what its finished steps started
// (`started`, as stopWhatRan reads it), what a step under way has answered `started` for and is still bringing up
// (`pending`: a restart_model or keep_running step's container, known from its own arguments; a start's container is
// known only once its operation has ended, so a start under way is kept as its operation, `starting`), and the Sparks
// it keeps awake. `awaiting` names a pending start whose resource identity has not been captured yet: recovery leaves
// it alone and reports uncertainty. The operation moves it to `pending` with its own receipt while still holding its
// claim (savedRunReceipts). The record goes when the run ends, however it
// ends. At start-up the watcher's report of operations a restart cut off (19-watcher.mjs, its existing one-shot look,
// no new timer) calls savedRunsRecover: for each run still on record, what it started is stopped newest first under the
// same rules as a failure (stopWhatRan: keep: true and "already" left alone, a job only while it still runs), the
// keep-awake holds are already gone with the old process, one notice says what happened (in the chat that asked too),
// and nothing is run again. The generic "a restart cut off …, start it again" line is not given for the run's own
// operation or its steps' (savedRunCutOff), but for a start under way it is: the notice above says what is true, and
// never that nothing was running when the run was cut inside a start. No state copy holds the file (sendCopy,
// COPY_IGNORES) and restore.sh --with-state removes it: a start on a record from back then would stop what runs now.
const SAVED_RUNS_FILE = `${STATE_DIR}/saved-runs.json`;
const savedRunsNow = () => { const f = readKept(SAVED_RUNS_FILE); return f && typeof f.runs === 'object' && f.runs && !Array.isArray(f.runs) ? f : { runs: {} }; };
const savedRunWords = e => maskSecrets(String(e?.message || e || 'unknown').split('\n')[0]).slice(0, 300);
// Merges `fields` into run j's record. A record that can't be written is said once in the run's log: then a restart
// would leave what it started running, as before this record existed.
function savedRunKeep(j, fields) {
  try {
    const f = savedRunsNow();
    f.runs[j.id] = { ...(f.runs[j.id] || { operation: j.id, since: j.createdAt }), ...fields };
    writePrivate(SAVED_RUNS_FILE, f);
  } catch (e) {
    if (j.runRecordLost) return;
    j.runRecordLost = true;
    note(j, `Couldn’t keep a note of what this run starts (${savedRunWords(e)}); a restart of Spark Console now would leave it running.`);
  }
}
function savedRunDone(j) {
  try {
    const f = savedRunsNow();
    if (!f.runs[j.id]) return;
    delete f.runs[j.id];
    if (Object.keys(f.runs).length) writePrivate(SAVED_RUNS_FILE, f); else unlinkSync(SAVED_RUNS_FILE);
  } catch {}
}
// What a step that answered `started` is still bringing up, while its own operation runs.
function savedRunPending(action, args, out, keep) {
  if (out?.outcome !== 'started' || !out.operation) return [];
  const id = v => sparkIdOf(v) || String(v);
  if (action === 'restart_model') return [{ kind: 'model', spark: id(args.spark), container: String(args.container), keep, operation: out.operation }];
  if (action === 'keep_running' && (args.do || 'keep') === 'keep') return [{ kind: out.job || args.once === true ? 'job' : 'app', spark: id(out.spark || args.spark), container: String(out.starting || args.container), keep, operation: out.operation }];
  return [];
}
// A step not yet known to have made a resource is awaiting its own operation's receipt. Once captured under that
// operation's claim it joins pending with its id/start time, so a restart can clean up even while the app is loading.
function savedRunReceipts(op) {
  if (!op.startedReceipts || !Object.keys(op.startedReceipts).length) return;
  for (const r of Object.values(savedRunsNow().runs)) {
    const matching = (r.awaiting || []).filter(x => x.operation === op.id);
    const pending = (r.pending || []).map(x => x.operation === op.id && op.ownersWish ? { ...x, wish: true } : x);
    const wished = pending.some((x, i) => x !== r.pending[i]);
    if (!matching.length && !wished) continue;
    const awaiting = [...(r.awaiting || [])];
    for (const x of matching) {
      const seen = op.startedReceipts[`${x.spark}/${x.container}`];
      if (!seen?.id || !seen.startedAt) continue;
      pending.push({ ...x, seen: { id: seen.id, startedAt: seen.startedAt }, ...(op.ownersWish ? { wish: true } : {}) });
      awaiting.splice(awaiting.indexOf(x), 1);
    }
    const j = jobs.get(r.operation);
    if (j && (wished || pending.length !== (r.pending || []).length)) savedRunKeep(j, { pending, awaiting });
  }
}
// An operation the start-up report found cut off that a run on record will speak for: the run's own, or one of its
// steps' (its actor, since the run began).
// A start step's own operation is not one of those: its container is known only once it ends, so the run can't stop it,
// and its own line says to check it (`starting`, the workloads review, C5).
function savedRunCutOff(e) {
  let runs = [];
  try { runs = Object.values(savedRunsNow().runs); } catch { return false; }
  if (runs.some(r => r?.starting === e.id)) return false;
  return runs.some(r => r?.operation === e.id || (r?.title && e.actor === `${r.title} (saved workflow)` && String(e.at) >= String(r.since || '~')));
}
async function savedRunsRecover() {
  let f;
  try { f = savedRunsNow(); } catch (e) { console.error(`The note of saved workflows under way can't be read: ${e.message}`); return; }
  const cut = Object.values(f.runs).filter(r => r && typeof r === 'object' && typeof r.operation === 'string' && !jobs.has(r.operation));
  if (!cut.length) return;
  for (const r of cut) {
    const title = String(r.title || 'a saved workflow').slice(0, 80);
    const items = [...(Array.isArray(r.started) ? r.started : []), ...(Array.isArray(r.pending) ? r.pending : []), ...(Array.isArray(r.awaiting) ? r.awaiting : [])]
      .filter(x => x && ['model', 'app', 'job'].includes(x.kind) && nodeById(x.spark) && NAME_RE.test(String(x.container || '')));
    let words;
    try { words = await stopWhatRan(items, healOwner(), {}, title); } catch (e) { words = `What it started couldn’t be stopped: ${savedRunWords(e)}.`; }
    const awake = (Array.isArray(r.awake) ? r.awake : []).filter(id => nodeById(id));
    // (a run cut inside a start step: what that start brought up may be running; its own line says so)
    const none = r.starting ? `The start at step ${r.step} was still under way: its own line says what to check.` : 'Nothing it had started was still running.';
    const text = `A restart of Spark Console cut off the saved workflow “${title}”${r.step ? ` at step ${r.step} of ${r.steps}` : ''}. ${words || none}`
      + `${awake.length ? ` ${awake.map(id => sparkName(nodeById(id))).join(' and ')}, which it had turned on, ${awake.length > 1 ? 'are' : 'is'} no longer held awake for it.` : ''} Nothing was run again: ask for it again if it’s still wanted.`;
    fleetEvent({ type: 'notice', text });
    const conv = /^sc_[0-9a-f]{16}$/.test(String(r.chat || '')) ? chatData().conversations.find(c => c.id === r.chat && c.login === accessList().owner) : null;
    if (conv) {
      const at = new Date().toISOString();
      conv.messages.push({ role: 'assistant', content: maskSecrets(text), createdAt: at, notice: true });
      conv.updatedAt = at;
      saveChats();
      if (conv.channel === 'telegram') tellAgain('result', text, {}, 'saved-run', { chat: conv.id, op: r.operation }).catch(() => {});
    }
  }
  try {
    const now = savedRunsNow();
    for (const r of cut) delete now.runs[r.operation];
    if (Object.keys(now.runs).length) writePrivate(SAVED_RUNS_FILE, now); else unlinkSync(SAVED_RUNS_FILE);
  } catch (e) { console.error(`The note of saved workflows under way couldn't be cleared: ${e.message}`); }
}
