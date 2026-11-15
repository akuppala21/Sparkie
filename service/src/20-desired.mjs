/* ───────── what should be running (docs/contract.md 6.13, 8.8–8.10) ───────── */
// Area: record        Rules: R9, R20, R21, R22, R38        Tests: desired.test.mjs, desired-look.test.mjs
// Owns: desired.json (writers: desiredAfter, keepApp, forgetApp, watchHeld, markUndone, handler, parkDesired)
// Timers: watchHeld (every 60 s; its first round seeds desired.json)        Wakes: none
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
  if (job.status !== 'completed') return;
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
  // (21-power.mjs) runs again, so its mark goes (no revision either).
  if (!stopped.length && started.every(k => d.running.some(x => keyOf(x) === k))) {
    const parked = d.running.filter(x => x.parked && started.includes(keyOf(x)));
    for (const x of parked) delete x.parked;
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
// Tells the owner once when something on the list becomes held.
const heldSaid = new Set();
let heldLast = [];
async function watchHeld() {
  try {
    // First time: what Spark Console already runs is what should be running.
    if (!existsSync(DESIRED_FILE)) {
      const inv = await recentInventory().catch(() => null);
      if (!inv) return;
      // (Not the brain's Spark: Sparkie's model looks after itself there, and nothing else starts there. Not the
      // self-test's own model, R22: it would be the owner's from then on. A note that can't be read: next time.)
      const test = selfTestModels(lookBegan.get(inv) ?? Date.now());
      const running = inv.sparks.filter(sp => sp.online && !brainSparks().includes(sp.id)).flatMap(sp => sp.deployments.filter(d => d.state === 'running' && d.role !== 'main' && !d.rank && !test.has(`${sp.id}/${d.container}`))
        .map(d => ({ spark: sp.id, container: d.container, model: d.model, ...(d.cluster ? { sparks: d.cluster.split('+') } : {}), since: new Date().toISOString(), by: 'already running' })));
      writePrivate(DESIRED_FILE, { revision: 1, running, revisions: [{ revision: 1, at: new Date().toISOString(), by: 'Spark Console', chat: null, operation: null, added: running.map(keyOf), removed: [], before: [], seeded: true }] });
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
const CHANGES_MODELS = new Set(['deploy', 'deploy-cluster', 'start-model', 'restart', 'stop', 'undo', 'power-off', 'power-on']);
const holdsModelsOn = (j, ids) => j.status === 'running' && CHANGES_MODELS.has(j.type) && (j.nodes || [j.node]).some(id => ids.includes(id));
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
  name: 'should_be_running', title: 'What should be running', kind: 'read', scope: 'fleet:read', who: 'owner', group: 'core',
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
action({
  name: 'undo_last_change', title: 'Undo the last change', kind: 'change', scope: 'fleet:act', who: 'owner', group: 'control',
  description: 'Use when the owner says "undo" (or "put it back") in a chat: reverses that chat’s last change. What it started is stopped, and what it stopped is started again. Only that chat’s own last change. It runs as an operation: it returns straight away, and posts to the chat when it’s done.',
  input: { type: 'object', properties: {}, additionalProperties: false },
  run: async (input, viewer, ctx) => {
    if (!ctx.conv) throw new HttpError(409, 'Say "undo" in the chat where the change was made: undo goes back on that chat’s last change.');
    const undoing = [...jobs.values()].find(j => j.status === 'running' && j.type === 'undo' && j.conv === ctx.conv);
    if (undoing) return { outcome: 'already', operation: undoing.id, note: 'An undo is already running in this chat; it posts here when it’s done.' };
    // This chat's change still running: undo is cancelling it (it puts back what it did, and posts here when it has).
    const running = [...jobs.values()].find(j => j.status === 'running' && j.conv === ctx.conv && !j.undo);
    if (running) { cancelJob(running, ctx.actor || viewer.login); return { outcome: 'cancelling', operation: running.id, note: 'It was still running, so it’s being cancelled: what it did is put back, and this chat hears when it has been.' }; }
    const d = desired(), rev = [...d.revisions].reverse().find(r => r.chat === ctx.conv && !r.undo && !r.undone && Date.now() - Date.parse(r.at) < 24 * 3600000);
    if (!rev) return { outcome: 'already', note: 'This chat hasn’t changed anything in the last day that can be undone.' };
    if (rev.app) throw new HttpError(409, 'This chat’s last change was to an app, and undo only reverses model changes. Say "stop <app> on Spark N" or "keep <app> running" instead.');
    // Someone else changed those Sparks since: reversing it would undo theirs too (8.9), so it's the owner's call.
    const sparks = new Set([...rev.added, ...rev.removed].map(k => k.split('/')[0]));
    const later = d.revisions.filter(r => r.revision > rev.revision && !r.undo && !r.app && r.chat !== ctx.conv && [...r.added, ...r.removed].some(k => sparks.has(k.split('/')[0])));
    if (later.length) throw new HttpError(409, `Since then, ${later[later.length - 1].by || 'someone'} changed ${[...sparks].join(', ')} too, so undoing would reverse that as well. Say exactly what to stop or start instead.`);
    // Marked now, so a second "undo" while this one runs doesn't pick the same change.
    const markUndone = () => { try { const fresh = desired(true); const r = fresh.revisions.find(x => x.revision === rev.revision); if (r) { r.undone = true; writePrivate(DESIRED_FILE, fresh); } } catch {} };
    markUndone();
    // Its own steps don't post to the chat one by one (the undo posts once), and never count as a change to undo.
    // (agentId: null, so an undo an agent asked for finishes even if that agent is removed while it runs, R9)
    const by = { ...ctx, via: ctx.via === 'sparkie' ? 'sparkie-undo' : ctx.via, conv: null, undo: true, trusted: true, request: `undo revision ${rev.revision}`, agentId: null };
    const job = newJob('undo', { by: viewer.login, actor: ctx.actor || viewer.login, via: ctx.via, conv: ctx.conv, undo: true, revision: rev.revision });
    runJob(job, async j => {
      const problems = [];
      const follow = async (what, out) => {
        if (!out?.operation) { if (out?.outcome && !['already', 'already-starting', 'kept'].includes(out.outcome)) problems.push(`${what}: ${out.note || out.question || out.outcome}`); return; }
        note(j, `${what}: operation ${out.operation}`);
        const done = await waitJob(out.operation, 45 * 60000);
        if (done?.status !== 'completed') problems.push(`${what}: ${String(done?.error || done?.status).split('\n')[0]}`);
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
      if (problems.length) throw new Error(`Part of the undo didn’t work: ${problems.join('; ')}`);
    });
    return { outcome: 'started', operation: job.id, undoing: { stops: rev.added, startsAgain: rev.removed },
      note: 'Putting things back as they were before that change: what it started stops, then what it stopped starts again. This chat hears when it’s done.' };
  },
});
