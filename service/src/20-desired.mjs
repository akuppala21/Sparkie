/* ───────── what should be running (docs/contract.md 6.13, 8.8–8.10) ───────── */
// Area: record        Rules: R9, R20, R21, R22, R38, R41, R57        Tests: power.test.mjs, desired.test.mjs, desired-look.test.mjs, workloads.test.mjs, t45-return.test.mjs, t45-fleet.test.mjs, t45-owner-wish.test.mjs
// Owns: desired.json (writers: desiredAfter, keepApp, forgetApp, seedDesired, markUndone, handler, parkDesired, desiredPutBack, desiredWish, desiredSelfTestWish)
// Timers: watchHeld (every 60 s; seeds desired.json if missing)        Wakes: none
// The owner's list of what should be running on each Spark: every model a change started, in numbered revisions. A
// start adds to it and a stop takes away, when they finish. Self-healing keeps crashed ones running (6.12). One that
// isn't running and won't come back by itself (cut off by a power loss, crash-looping, stopped outside Spark Console,
// its Spark gone) is *held*: the owner brings it back with one click, or forgets it. Nothing here ever stops anything.
// "Cancel" stops an operation at its next step and puts back what it did; "undo" goes back to the revision before this
// chat's last change.
const DESIRED_FILE = `${STATE_DIR}/desired.json`;
// A lookup gets an empty list when the file can't be read just now. Whatever saves the list reads it with
// desired(true): the read error goes up (readKept's "try again"), so a save never goes over a list that's still there (F12).
function desired(strict = false) {
  let d = null;
  try { d = readKept(DESIRED_FILE); } catch (e) { if (strict) throw e; }
  return d && Array.isArray(d.running) && Array.isArray(d.revisions) ? d : { revision: 0, running: [], revisions: [] };
}
const keyOf = x => `${x.spark}/${x.container}`;
// A finished operation changes the list: what it started is added, what it stopped is taken away. The brain's Spark
// isn't on it.
function desiredAfter(job) {
  if (job.status !== 'completed' || job.type === 'start-rollback') return;
  // The self-test's own model (21-selftest.mjs) isn't the owner's wish: its start, the drill's restart and its stop
  // (marked by the self-test and by maybeHeal) leave the list as it is.
  if (job.selfTest) return;
  const started = [...new Set([...(job.ranHere || []), ...(job.type === 'restart' && job.node && job.container ? [`${job.node}/${job.container}`] : [])])]
    .filter(x => !/-part2$/.test(x) && !brainSparks().includes(x.split('/')[0]));
  const stopped = [...new Set(job.stoppedHere || [])].filter(x => !started.includes(x) && !/-part2$/.test(x));
  if (!started.length && !stopped.length) return;
  const d = desired(true), before = d.running.map(x => ({ ...x }));
  // Bringing back what's already on the list (a restart, self-healing) changes nothing on it: no revision, so it never
  // stands in the way of undoing the owner's last change there. One parked while its Spark was powered off
  // (21-power.mjs), or put back by a run's clean-up (desiredPutBack), runs again, so its mark goes (no revision either).
  if (!stopped.length && started.every(k => d.running.some(x => keyOf(x) === k))) {
    const parked = d.running.filter(x => (x.parked || x.putBack) && started.includes(keyOf(x)));
    for (const x of parked) { delete x.parked; delete x.putBack; }
    let save = parked.length > 0;
    // (The owner's own start of one that's on the list makes it the newest wish for its Sparks. Self-healing brings
    // back only the newest model wanted on a Spark, displacedBy in 20-heal.mjs, so its date moves; still no revision.)
    if (job.actor !== 'Self-healing') {
      const at = job.finishedAt || new Date().toISOString();
      for (const x of d.running) if (started.includes(keyOf(x))) x.since = at;
      save = true;
    }
    if (save) try { writePrivate(DESIRED_FILE, d); } catch (e) { console.error(`Couldn’t save what should be running: ${e.message}`); }
    return;
  }
  const add = started.map(x => {
    const [spark, container] = x.split('/');
    // An app kept running (keep_running, 21-apps.mjs): no model (the /v1 start-on-call matches on it), its port and memory.
    if (job.app) return { spark, container, app: true, ...(job.port ? { port: job.port } : {}), ...(job.memoryGB ? { memoryGB: job.memoryGB } : {}), since: job.finishedAt || new Date().toISOString(), by: job.actor || job.by || null };
    return { spark, container, model: job.model || container.replace(/^sc-/, ''), ...(job.nodes?.length > 1 ? { sparks: job.nodes } : {}),
      since: job.finishedAt || new Date().toISOString(), by: job.actor || job.by || null };
  });
  const gone = new Set([...stopped, ...add.map(keyOf)]);
  d.running = [...d.running.filter(x => !gone.has(keyOf(x))), ...add];
  d.revision += 1;
  d.revisions.push({ revision: d.revision, at: new Date().toISOString(), operation: job.id, chat: job.conv || null, by: job.actor || job.by || null,
    added: add.map(keyOf), removed: stopped, before, ...(job.undo ? { undo: true } : {}), ...(job.app ? { app: true } : {}) });
  if (d.revisions.length > 50) d.revisions.splice(0, d.revisions.length - 50);
  try { writePrivate(DESIRED_FILE, d); } catch (e) { console.error(`Couldn’t save what should be running: ${e.message}`); }
}
// The owner's own ask for what already runs (a start, a restart or a keep answered "already", A-22): their newest wish
// for it, so its entry's since moves (no revision), and a saved workflow's clean-up leaves it (startedStill). Not a run's
// step, self-healing, an agent or the self-test. An operation that started it, or is still starting it (a run's step
// loading it), is marked too, in the same tick: the run takes its receipt when that ends, so the wish outlives it.
const ownersAsk = (viewer, ctx) => !viewer?.agentKey && !ctx?.agent && !ctx?.agentId && !ctx?.selfTest && ['page', 'api', 'sparkie', 'telegram'].includes(ctx?.via);
function desiredWish(keys, { afterStart = null } = {}) {
  if (afterStart) rollbackSupersede(keys, 'the owner asked for it again', null, false, afterStart);
  else rollbackSupersede(keys, 'the owner asked for it again', null, false);
  for (const j of jobs.values()) if ((j.ranHere || []).some(k => keys.includes(k)) || (j.node && j.container && keys.includes(`${j.node}/${j.container}`))) {
    j.ownersWish = true;
    try { savedRunReceipts(j); } catch (e) { console.error(`Couldn’t keep the owner’s wish with the pending start: ${e.message}`); }
  }
  try {
    const d = readKept(DESIRED_FILE);
    if (!d || !Array.isArray(d.running)) return;
    const at = new Date().toISOString(), hit = d.running.filter(x => keys.includes(keyOf(x)));
    for (const x of hit) x.since = at;
    if (hit.length) writePrivate(DESIRED_FILE, d);
  } catch (e) { console.error(`Couldn’t note the owner’s wish on what should be running: ${e.message}`); }
}
// Explicit owner adoption of the self-test's exact model. This adds intent, not a completed operation: an absent
// row gets the ordinary revision/before record, while an existing row keeps its revision and other settings. The
// note remains pending until this strict save and its directory sync finish; a newer stop permanently cancels retry.
function desiredSelfTestWish(operation) {
  const rec = selfTestRecord();
  if (!rec || rec.operation !== operation || !rec.model.wish || rec.model.wishSaved || rec.model.wishStopped) return;
  if (typeof rec.model.name !== 'string' || !rec.model.name) throw new Error('The self-test’s exact model name is missing. Its owner request was kept for another try.');
  const key = `${rec.spark}/${rec.model.container}`, d = desired(true), at = new Date().toISOString();
  if (!d.running.some(x => keyOf(x) === key)) {
    const before = d.running.map(x => ({ ...x }));
    d.running.push({ spark: rec.spark, container: rec.model.container, model: rec.model.name, since: at, by: accessList().owner });
    d.revision += 1;
    d.revisions.push({ revision: d.revision, at, operation: null, chat: rec.chat || null, by: accessList().owner, added: [key], removed: [], before });
    if (d.revisions.length > 50) d.revisions.splice(0, d.revisions.length - 50);
    try {
      writePrivate(DESIRED_FILE, d);
      const fd = openSync(STATE_DIR, 'r');
      try { fsyncSync(fd); } finally { closeSync(fd); }
    } catch { throw new Error('Your model request could not be fully saved. Its self-test note was kept. Try again.'); }
  }
  selfTestWishSaved([key], operation);
}
// An app already on a Spark joins the list (keep_running, 21-apps.mjs): read with readKept itself, so a file that can't
// be read is never saved over. A new entry is a revision of its own (undo leaves apps alone).
function keepApp(x, by, chat) {
  const read = readKept(DESIRED_FILE), d = read && Array.isArray(read.running) && Array.isArray(read.revisions) ? read : { revision: 0, running: [], revisions: [] };
  const k = keyOf(x), before = d.running.map(y => ({ ...y })), had = d.running.find(y => keyOf(y) === k);
  const entry = { spark: x.spark, container: x.container, app: true, ...(x.port ? { port: x.port } : {}), ...(x.memoryGB ? { memoryGB: x.memoryGB } : {}),
    since: had?.since || new Date().toISOString(), by: by || null };
  d.running = [...d.running.filter(y => keyOf(y) !== k), entry];
  if (!had) {
    d.revision += 1;
    d.revisions.push({ revision: d.revision, at: new Date().toISOString(), operation: null, chat: chat || null, by: by || null, added: [k], removed: [], before, app: true });
    if (d.revisions.length > 50) d.revisions.splice(0, d.revisions.length - 50);
  }
  writePrivate(DESIRED_FILE, d);
}
// An app comes off the list with nothing stopped (keep_running's stop while its Spark is off): a revision of its own,
// marked as an app's, so undo leaves it alone. false when it wasn't on the list (or the file can't be read).
function forgetApp(x, by, chat) {
  const d = readKept(DESIRED_FILE), k = keyOf(x);
  if (!d || !Array.isArray(d.running) || !Array.isArray(d.revisions) || !d.running.some(y => y.app && keyOf(y) === k)) return false;
  const before = d.running.map(y => ({ ...y }));
  d.running = d.running.filter(y => !(y.app && keyOf(y) === k));
  d.revision += 1;
  d.revisions.push({ revision: d.revision, at: new Date().toISOString(), operation: null, chat: chat || null, by: by || null, added: [], removed: [k], before, app: true, forgotten: true });
  if (d.revisions.length > 50) d.revisions.splice(0, d.revisions.length - 50);
  writePrivate(DESIRED_FILE, d);
  return true;
}
// Parking (21-power.mjs, contract 9.22): entries Spark Console stopped to power their Spark off stay on the list with
// parked (when), so healing leaves them alone and nothing calls them missing; they come back when their Spark is turned
// on, or on their next call (and the mark goes when they run again, desiredAfter). Read with readKept itself, so a file
// that can't be read is never saved over; no revision (what should run hasn't changed). The keys it marked.
function parkDesired(keys, on) {
  const d = readKept(DESIRED_FILE);
  if (!d || !Array.isArray(d.running) || !Array.isArray(d.revisions)) return [];
  const hit = d.running.filter(x => keys.includes(keyOf(x)) && Boolean(x.parked) !== on);
  for (const x of hit) { if (on) x.parked = new Date().toISOString(); else delete x.parked; }
  if (hit.length) writePrivate(DESIRED_FILE, d);
  return hit.map(keyOf);
}
// A saved workflow's clean-up stopped something that was on the list before its run had a step start it again, and its
// stop took it off (stopWhatRan, 18-step-jobs.mjs): its entry goes back as it stood just before that stop, so the list
// is what it was before the run. It carries putBack (when), so self-healing leaves it alone as it leaves a parked one
// (the stop is the run's, not a crash: the workloads review, C4); the mark goes when it next runs (desiredAfter). Read
// with readKept itself, so a file that can't be read is never saved over; no revision (what should run hasn't changed
// since before the run). The keys it put back.
function desiredPutBack(entries) {
  const d = readKept(DESIRED_FILE);
  if (!d || !Array.isArray(d.running) || !Array.isArray(d.revisions)) return [];
  const back = entries.filter(x => x && typeof x === 'object' && !d.running.some(y => keyOf(y) === keyOf(x)));
  if (back.length) { const at = new Date().toISOString(); d.running.push(...back.map(x => ({ ...x, putBack: at }))); writePrivate(DESIRED_FILE, d); }
  return back.map(keyOf);
}
// Each entry, with how it is now: running, changing (an operation holds its Spark), parked (stopped while Spark Console
// powered its Spark off, 21-power.mjs), or held, and why. An app also has its link, and (check) whether it answers there
// now.
async function desiredNow({ check = false } = {}) {
  const d = desired(), inv = await recentInventory().catch(() => null);
  // The look at the Sparks is shared for a few seconds: an operation that ended after it began changed what's there
  // since, so its Sparks count as changing until a fresh look (gate, 2026-11-13: a model a restart had just started
  // showed as held, and the owner was told it should be running but isn't).
  const began = (inv && lookBegan.get(inv)) ?? Date.now();
  const busy = new Set([...jobs.values()].filter(j => j.status === 'running' || (Date.parse(j.finishedAt) || 0) >= began).flatMap(j => j.nodes || [j.node]).filter(Boolean));
  // (apps: their containers' states, read only on the online Sparks that have apps on the list)
  const appSparks = [...new Set(d.running.filter(x => x.app).map(x => x.spark))].filter(id => inv?.sparks.find(s => s.id === id)?.online && nodeById(id));
  const states = new Map(await Promise.all(appSparks.map(async id => [id, await appStates(nodeById(id)).catch(() => null)])));
  return { revision: d.revision, running: await Promise.all(d.running.map(async x => {
    const sp = inv?.sparks.find(s => s.id === x.spark), dep = sp?.deployments.find(y => y.container === x.container);
    // (parked: not running on purpose; with its Spark off on purpose, nothing about it is the owner's to fix)
    // (the mark is kept now, not read from the look, so only an operation running there now makes it changing)
    if (x.parked && dep?.state !== 'running' && !(x.app && sp?.online && (states.get(x.spark) || []).some(c => c.name === x.container && c.state === 'running'))) {
      if ([...jobs.values()].some(j => j.status === 'running' && (j.nodes || [j.node]).includes(x.spark))) return { ...x, state: 'changing' };
      return { ...x, ...(x.app ? { kind: 'app' } : {}), state: 'parked', why: parkedWhy(x) };
    }
    if (x.app) return { ...(await appNow(x, sp, busy, check, states.get(x.spark) ?? null)), ...(poweredOffNow(x) ? { poweredOff: true } : {}) };
    if (dep?.state === 'running') return { ...x, state: 'running' };
    if (busy.has(x.spark)) return { ...x, state: 'changing' };
    const w = knowledge.workloads?.[Object.keys(knowledge.workloads || {}).find(k => knowledge.workloads[k].spark === x.spark && knowledge.workloads[k].name === x.container)];
    const skipped = [...events].reverse().find(e => e.type === 'heal-skipped' && e.spark === x.spark && e.container === x.container);
    const why = !sp?.online ? `${sparkName(nodeById(x.spark) || { id: x.spark })} isn’t reachable`
      : !sp.dockerOk ? `Docker isn’t answering on ${sparkName(nodeById(x.spark) || { id: x.spark })}`
      : !dep ? 'its container is gone'
        : Number(w?.exitCode) === 255 ? 'it stopped when the Spark lost power or restarted'
          : skipped ? skipped.why
            : 'it isn’t running';
    // (its Spark off, or its Docker not answering: whether it runs isn't known, and it isn't the owner's to fix by itself)
    return { ...x, state: 'held', why, ...(!sp?.online ? { sparkOff: true } : !sp.dockerOk ? { dockerDown: true } : {}), ...(poweredOffNow(x) ? { poweredOff: true } : {}) };
  })) };
}
// First look, or a power-off before the watcher's first round: remember what is running before stopping it.
// Check after the caller's awaited look, in the same tick as the save: another operation may have made the list.
// Only a missing file is seeded. An unreadable file, a link or an existing list is never replaced.
function seedDesired(inv) {
  try { lstatSync(DESIRED_FILE); return; } catch (e) { if (e.code !== 'ENOENT') throw e; }
  // Not the brain's Spark or the self-test's own model. A self-test note that can't be read refuses the seed.
  const test = selfTestModels(lookBegan.get(inv) ?? Date.now());
  const running = inv.sparks.filter(sp => sp.online && !brainSparks().includes(sp.id)).flatMap(sp => sp.deployments.filter(d => d.state === 'running' && d.role !== 'main' && !d.rank && !test.has(`${sp.id}/${d.container}`))
    .map(d => ({ spark: sp.id, container: d.container, model: d.model, ...(d.cluster ? { sparks: d.cluster.split('+') } : {}), since: new Date().toISOString(), by: 'already running' })));
  writePrivate(DESIRED_FILE, { revision: 1, running, revisions: [{ revision: 1, at: new Date().toISOString(), by: 'Spark Console', chat: null, operation: null, added: running.map(keyOf), removed: [], before: [], seeded: true }] });
}
// Tells the owner once when something on the list becomes held.
const heldSaid = new Set();
let heldLast = [];
async function watchHeld() {
  try {
    if (!existsSync(DESIRED_FILE)) {
      const inv = await recentInventory().catch(() => null);
      if (!inv) return;
      // A first look during an unfinished start can see its unproved new container. Observation is not a newer
      // owner wish: wait for compensation to settle before making the first list from what is running.
      if (rollbackRecords().some(r => {
        if (r.phase === 'committed') return false;
        const job = jobs.get(r.operation);
        // A live self-test displaces no running work and seedDesired excludes its exact model. Other debt
        // still holds the whole seed, including a failed self-test whose compensation has not settled.
        return !(r.phase === 'active' && job?.status === 'running' && job.selfTest && r.units.every(u => u.members.every(m => !m.wasRunning)));
      })) return;
      seedDesired(inv);
    }
    if (!desired().running.length) { heldLast = []; return; }
    const inv = await recentInventory().catch(() => null);
    if (!inv) return;
    const now = await desiredNow();
    heldLast = now.running.filter(x => x.state === 'held');
    for (const x of now.running) {
      const k = keyOf(x);
      if (x.state !== 'held') { heldSaid.delete(k); continue; }
      // Docker isn't answering there: the watcher said so once, and whether it runs isn't known (F6). Its Spark powered
      // off by Spark Console (21-power.mjs): off on purpose, nothing to tell.
      if (x.dockerDown || x.poweredOff) continue;
      if (heldSaid.has(k)) continue;
      heldSaid.add(k);
      fleetEvent({ type: 'notice', text: `${x.container} on ${sparkName(nodeById(x.spark) || { id: x.spark })} should be running but isn’t (${x.why}). Bring it back, or forget it, in Activity.` });
    }
  } catch {}
}
setInterval(watchHeld, Number(process.env.SPARK_CONSOLE_DESIRED_MS || 60000)).unref?.();

// Cancelling an operation: it stops at its next step and puts back what it did. Agents cancel only their own.
function cancelJob(job, by) {
  if (job.status !== 'running') return false;
  job.cancelled = by || 'someone';
  note(job, `Cancelling (${job.cancelled})`);
  job.abort?.abort();
  return true;
}
function cancelCheck(job) {
  if (job?.cancelled) throw Object.assign(new Error(`Cancelled by ${job.cancelled}.`), { cancelled: true });
}
// A stop never waits behind a start (8.8): what's changing those Sparks is cancelled, and put back, first.
// The operations a stop cancels on its Sparks: the ones that start, stop or bring back models there, so a stop never
// waits behind a start. A download, a search for setups or a Spark action touches no model and goes on (2026-11-11: a
// stop on Spark 3 cancelled GLM-5.3-Flash's 178 GB download there).
const CHANGES_MODELS = new Set(['deploy', 'deploy-cluster', 'start-model', 'restart', 'stop', 'undo', 'power-off', 'power-on', 'start-rollback']);
const holdsModelsOn = (j, ids) => j.status === 'running' && CHANGES_MODELS.has(j.type) && (j.claimedNodes || j.nodes || [j.node]).some(id => ids.includes(id));
async function cancelRunningOn(ids, by) {
  return cancelJobsAndWait([...jobs.values()].filter(j => holdsModelsOn(j, ids)), by);
}
async function cancelJobsAndWait(holding, by) {
  for (const j of holding) cancelJob(j, by);
  for (const until = Date.now() + 120000; holding.some(j => j.status === 'running') && Date.now() < until;) await sleep(500);
}
async function waitJob(id, ms = 30 * 60000) {
  for (const until = Date.now() + ms; jobs.get(id)?.status === 'running' && Date.now() < until;) await sleep(1000);
  return jobs.get(id);
}

action({
  name: 'should_be_running', title: 'What should be running', kind: 'read', scope: 'fleet:read', who: 'owner', group: 'control',
  description: 'Use to see the owner’s list of what should be running on each Spark (every model a change started, and every app kept running with keep_running, with its link and whether it answers now), and how each is now: running, changing, or held (and why). Held ones can be brought back.',
  input: { type: 'object', properties: {}, additionalProperties: false },
  run: async () => ({ observedAt: new Date().toISOString(), ...(await desiredNow({ check: true })) }),
});
action({
  name: 'cancel_operation', title: 'Cancel an operation', kind: 'change', scope: 'fleet:act', who: 'owner', group: 'control',
  description: 'Use when the owner (or you, for your own) wants a running operation stopped: it stops at its next step and puts back what it did. Agents can cancel only operations they started.',
  input: { type: 'object', properties: { id: { type: 'string', pattern: '^[0-9a-f]{12}$', description: 'The operation id.' } }, required: ['id'], additionalProperties: false },
  run: async ({ id }, viewer, ctx) => {
    const j = jobs.get(id);
    if (!j) throw new HttpError(404, 'No operation with that id (Spark Console keeps the last 50).');
    if (j.status !== 'running') return { outcome: 'already', note: `It already ${j.status}.` };
    const mine = ctx.via === 'page' || (ctx.conv && j.conv === ctx.conv) || (ctx.via === 'agent' && ctx.actor && j.actor === ctx.actor);
    if (!mine) throw new HttpError(403, 'Only the owner can cancel an operation someone else started.');
    cancelJob(j, ctx.actor || viewer.login);
    // (Sparkie's tools answer within 50 s: a chat waits 40 s at most, and hears when the putting back is done.)
    const done = await waitJob(id, ctx.via === 'page' ? 120000 : 40000);
    return done?.status === 'running'
      ? { outcome: 'cancelling', operation: id, status: 'running', note: 'It’s stopping and putting back what it did; that can take a few minutes.' }
      : { outcome: 'cancelled', operation: id, status: done?.status, note: done?.cleanUp || 'What it had done was put back.' };
  },
});
// When a chat's last model change not undone was made: undo puts back a command's files only when they are newer
// (runnerUndo), and pruning keeps a set that undo would put back (runnerKeep, 21-runner.mjs).
const undoSince = (conv, revisions = desired().revisions) => [...revisions].reverse().find(r => r.chat === conv && !r.undo && !r.undone)?.at || '';
// The chat's newest change undo can't put back (C-16), from the journal's two newest months: a command inside the
// lock-out net (a lock-out change on a compute Spark, root, every change on the hub: its start line carries `net` and no
// set of copies) unless it never ran, or a change other than a model's or an app's (those are the list's revisions,
// below) that did something: power, a file saved, memory, a saved workflow, an update, a cancel. Undo's own lines and
// what changes nothing on the Sparks (find_setups, test_changes, the self-test) are none.
const UNDO_OWN_KINDS = new Set(['start_model', 'stop_model', 'restart_model', 'keep_running', 'undo_last_change', 'find_setups', 'test_changes', 'self_test']);
const UNDO_NOTHING_DONE = new Set(['question', 'needs-ok', 'already', 'already-starting', 'refused', 'waiting', 'declined', 'noroom', 'failed', 'error', 'look', 'box', 'asked', 'pending']);
function undoNotMine(conv) {
  const tag = `"chat":${JSON.stringify(conv)}`, starts = new Map(), ends = new Map(), found = [];
  for (const f of journalFiles().slice(0, 2)) {
    for (const line of jLinesOf(f)) {
      if (!line.includes(tag)) continue;
      const r = jParse(line);
      if (!r || r.chat !== conv || !((r.k === 'cmd' && r.act === 'run' && r.net) || (r.k === 'call' && ACTIONS.get(r.act)?.kind === 'change' && !UNDO_OWN_KINDS.has(r.act)))) continue;
      if (r.end) ends.set(r.id, r); else if (r.start) starts.set(r.id, r); else if (r.ok && !UNDO_NOTHING_DONE.has(r.outcome)) found.push(r);
    }
  }
  for (const [id, r] of starts) {
    const e = ends.get(id);
    if (!e || (r.k === 'cmd' ? e.ran !== false && e.outcome !== 'refused' : e.ok && !UNDO_NOTHING_DONE.has(e.outcome))) found.push(r);
  }
  return found.sort((a, b) => String(b.at).localeCompare(String(a.at)))[0] || null;
}
const undoWhere = id => (id ? ` on ${sparkName(nodeById(id) || { id })}` : '');
const undoRevWords = rev => [...rev.added.map(k => `started ${k.split('/')[1]}${undoWhere(k.split('/')[0])}`), ...rev.removed.map(k => `stopped ${k.split('/')[1]}${undoWhere(k.split('/')[0])}`)].join(' and ') || `changed the list (revision ${rev.revision})`;
// What undo says when the chat's last change is one it can't put back: that one, and the older one it leaves as it is.
function undoCantWords(r, older) {
  const spark = r.args?.spark || (r.sub || []).find(x => nodeById(x)) || null;
  const what = r.net ? `a command${r.root ? ' as root' : ''}${undoWhere(spark)} that ran inside the lock-out net (record ${r.id})` : `“${ACTIONS.get(r.act)?.title || r.act}”${undoWhere(spark)} (record ${r.id})`;
  return `Nothing was undone: this chat’s last change was ${what}, and undo has no way to put that back.${r.net ? ' While its guard is still open, /putback puts back what it changed.' : ''}${older ? ` The change before it is left as it is too (${older}): undo goes back only on a chat’s last change. To change that one, say exactly what to stop, start or put back.` : ''}`;
}
action({
  name: 'undo_last_change', title: 'Undo the last change', kind: 'change', scope: 'fleet:act', who: 'owner', group: 'control',
  description: 'Use when the owner says "undo" (or "put it back") in a chat: reverses that chat’s last change. What it started is stopped, and what it stopped is started again. Only that chat’s own last change. It runs as an operation: it returns straight away, and posts to the chat when it’s done.',
  input: { type: 'object', properties: {}, additionalProperties: false },
  run: async (input, viewer, ctx) => {
    if (!ctx.conv) throw new HttpError(409, 'Say "undo" in the chat where the change was made: undo goes back on that chat’s last change.');
    const undoing = [...jobs.values()].find(j => j.status === 'running' && j.type === 'undo' && j.conv === ctx.conv);
    if (undoing) return { outcome: 'already', operation: undoing.id, note: 'An undo is already running in this chat; it posts here when it’s done.' };
    // The chat's last change of any kind, newest first (C-16): a command's files (21-runner.mjs), a change still running,
    // a model change on the list, or one undo can't put back. Never an older one in its place.
    const since = undoSince(ctx.conv), set = runnerLatest(ctx.conv), other = undoNotMine(ctx.conv);
    const running = [...jobs.values()].find(j => j.status === 'running' && j.conv === ctx.conv && !j.undo);
    const last = [[other?.at, 'other'], [set?.at, 'files'], [running?.createdAt, 'running'], [since, 'model']].filter(([at]) => at).sort((a, b) => String(b[0]).localeCompare(String(a[0])))[0]?.[1];
    if (last === 'other') {
      const rev = since ? [...desired().revisions].reverse().find(r => r.chat === ctx.conv && !r.undo && !r.undone) : null;
      const older = [[set?.at, set && `a command’s files${undoWhere(set.spark)}, record ${set.id}`], [running?.createdAt, running && `operation ${running.id}, still running`], [since, rev && `it ${undoRevWords(rev)}`]]
        .filter(([at, w]) => at && w).sort((a, b) => String(b[0]).localeCompare(String(a[0])))[0]?.[1] || null;
      throw new HttpError(409, undoCantWords(other, older));
    }
    // A command's change on a Spark that came after this chat's last model change: its files are put back (21-runner.mjs).
    if (last === 'files') { const files = await runnerUndo(viewer, ctx, since); if (files) return files; }
    // This chat's change still running: undo is cancelling it (it puts back what it did, and posts here when it has).
    if (last === 'running') { cancelJob(running, ctx.actor || viewer.login); return { outcome: 'cancelling', operation: running.id, note: 'It was still running, so it’s being cancelled: what it did is put back, and this chat hears when it has been.' }; }
    const d = desired(), rev = [...d.revisions].reverse().find(r => r.chat === ctx.conv && !r.undo && !r.undone && Date.now() - Date.parse(r.at) < 24 * 3600000);
    if (!rev) return { outcome: 'already', note: 'This chat hasn’t changed anything in the last day that can be undone.' };
    if (rev.app) throw new HttpError(409, 'This chat’s last change was to an app, and undo only reverses model changes. Say "stop <app> on Spark N" or "keep <app> running" instead.');
    // Someone else changed those Sparks since: reversing it would undo theirs too (8.9), so it's the owner's call.
    const sparks = new Set([...rev.added, ...rev.removed].map(k => k.split('/')[0]));
    const later = d.revisions.filter(r => r.revision > rev.revision && !r.undo && !r.app && r.chat !== ctx.conv && [...r.added, ...r.removed].some(k => sparks.has(k.split('/')[0])));
    if (later.length) throw new HttpError(409, `Since then, ${later[later.length - 1].by || 'someone'} changed ${[...sparks].join(', ')} too, so undoing would reverse that as well. Say exactly what to stop or start instead.`);
    // Marked now, so a second "undo" while this one runs doesn't pick the same change; the mark goes again when the undo
    // didn't put it all back (R1-01), so the next "undo" is this change again, never the one before it.
    const markUndone = (on = true) => { try { const fresh = desired(true); const r = fresh.revisions.find(x => x.revision === rev.revision); if (r) { if (on) r.undone = true; else delete r.undone; writePrivate(DESIRED_FILE, fresh); } } catch {} };
    markUndone();
    // Its own steps don't post to the chat one by one (the undo posts once), and never count as a change to undo.
    // (agentId: null, so an undo an agent asked for finishes even if that agent is removed while it runs, R9)
    const by = { ...ctx, via: ctx.via === 'sparkie' ? 'sparkie-undo' : ctx.via, conv: null, undo: true, trusted: true, request: `undo revision ${rev.revision}`, agentId: null };
    const job = newJob('undo', { by: viewer.login, actor: ctx.actor || viewer.login, via: ctx.via, conv: ctx.conv, undo: true, revision: rev.revision });
    runJob(job, async j => { try { await undoSteps(j); } catch (e) { markUndone(false); throw e; } });
    async function undoSteps(j) {
      const problems = [];
      let worked = 0;
      const follow = async (what, out) => {
        if (!out?.operation) { if (out?.outcome && !['already', 'already-starting', 'kept'].includes(out.outcome)) problems.push(`${what}: ${out.note || out.question || out.outcome}`); else worked += 1; return; }
        note(j, `${what}: operation ${out.operation}`);
        const done = await waitJob(out.operation, 45 * 60000);
        if (done?.status !== 'completed') problems.push(`${what}: ${String(done?.error || done?.status).split('\n')[0]}`); else worked += 1;
      };
      // What it started stops first (that frees the room), then what it stopped starts again.
      for (const k of rev.added) {
        cancelCheck(j);
        const [spark, container] = k.split('/');
        step(j, `Stopping ${container} on ${sparkName(nodeById(spark) || { id: spark })}`);
        try { await follow(`stopping ${container}`, await runAction('stop_model', viewer, { spark, container }, by)); } catch (e) { problems.push(`stopping ${container}: ${e.message}`); }
      }
      for (const k of rev.removed) {
        cancelCheck(j);
        const [spark, container] = k.split('/'), was = rev.before.find(x => keyOf(x) === k);
        step(j, `Starting ${container} again on ${sparkName(nodeById(spark) || { id: spark })}`);
        try {
          // (an app a model start stopped to make room comes back as an app, with its memory figure; Docker has its port)
          await follow(`starting ${container} again`, was?.app ? await runAction('keep_running', viewer, { spark, container, ...(was.memoryGB ? { memoryGB: was.memoryGB } : {}) }, by)
            : was?.sparks ? await runAction('start_model', viewer, { model: was.model, sparks: was.sparks }, by)
              : await runAction('restart_model', viewer, { spark, container }, by));
        } catch (e) { problems.push(`starting ${container} again: ${e.message}`); }
      }
      if (problems.length) throw new Error(`${worked ? 'Part of the undo didn’t work' : 'Nothing was put back'}: ${problems.join('; ')}. That change is still this chat’s last one, so “undo” tries it again.`);
    }
    return { outcome: 'started', operation: job.id, undoing: { stops: rev.added, startsAgain: rev.removed },
      note: `Putting back this chat’s last change (it ${undoRevWords(rev)}): what it started stops, then what it stopped starts again. This chat hears when it’s done.` };
  },
});
