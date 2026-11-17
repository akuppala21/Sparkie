/* ───────── a saved workflow's run: steps placed, job steps waited on, and what a failed run started stopped (D6a, D6b, D6d) ───────── */
// Area: core        Rules: R35, R38        Tests: steps.test.mjs, workloads.test.mjs, workloads-place.test.mjs, workloads-receipts.test.mjs
// Owns: none
// Timers: none        Wakes: none
// A step that runs a job (keep_running with once true, or one whose answer says it is a job: run again, or already
// running) is done when the job's container has ended, not when it started (contract 9.27; design D 2.3 as cut by
// critic-simplicity.md). run_workflow waits for the step's own operation as for any step (stepOpEnd), then calls
// jobStepEnd, which follows the job with waitJobEnd: its one fixed `docker inspect` of that container every 10 s through
// `run` (the look the self-test uses; no new timer), for STEP_JOB_MS at most (6 hours, D 2.3). Exit 0 goes on to the
// next step. Anything else ends the run there: the error names the step and how the job ended, then its last lines (the
// job's own output: masked, cut, labelled as data), which stay out of the chat line (postResult posts the first line
// only). Cancelling the run ends the wait at once (sleepUnless, and the look under way is stopped by the operation's
// abort signal), and cancels the step's own operation under way, which puts back what it did. /stop never cancels an
// operation (R34), so it doesn't end the run.
// What a run started is stopped again, newest first, and only that (contract 9.27, design D 2.3; stopWhatRan): each step
// whose answer was `started` is noted as it finishes (startedBy): a model a start or restart ran (stop_model), an app
// keep_running started (its stop, which takes it off the list) and a job (the same, only while it still runs). A step
// that answered `already` (it was running before the run) is never stopped, a step saved with keep: true is left
// running, and what a step stopped stays stopped. When: a run that ends badly (a step failed or asked, a job ended badly
// or ran past the limit, or the run was cancelled), every run (runCleanUp); a run that ends well, only a workload, a run
// with a job step (j.workload, set by jobStepEnd): its models and apps were started for its job (runEndWell), and its
// jobs, which have ended, stay with their files. A run with no job step (a routine, a stack) keeps what it started.
// Each stop is an ordinary action call as the run (via workflow), so the pause and the claims hold; one that fails is
// said after the first error, never in its place. What was stopped and what was kept is said in the run's result.
const STEP_JOB_MS = Number(process.env.SPARK_CONSOLE_STEP_JOB_MS || 6 * 3600000);
const STEP_JOB_LINES = 10;
const forHowLong = ms => (ms >= 3600000 ? `${+(ms / 3600000).toFixed(1)} hours` : ms >= 60000 ? `${Math.round(ms / 60000)} minutes` : `${Math.round(ms / 1000)} seconds`);
// A sleep that ends early when `signal` aborts (a cancelled operation's).
const sleepUnless = (ms, signal) => new Promise(resolve => {
  if (signal?.aborted) return resolve();
  const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
  const timer = setTimeout(done, ms);
  signal?.addEventListener('abort', done, { once: true });
});
// The run's step n: `args` as the step asked, `out` the action's answer (its Spark and container, when it says them).
async function jobStepEnd(j, n, args, out) {
  const spark = sparkIdOf(out?.spark || args.spark) || String(args.spark), container = String(out?.starting || out?.container || args.container);
  const node = nodeById(spark), at = sparkName(node || { id: spark });
  j.workload = true;
  (j.jobsRan ||= []).push({ spark, container, began: Date.now() });
  step(j, `Step ${n}: ${container} runs on ${at}; waiting for it to end (${forHowLong(STEP_JOB_MS)} at most)`);
  let end;
  try { end = await waitJobEnd(node, container, { limitMs: STEP_JOB_MS, job: j }); } catch (e) {
    if (e?.cancelled) { note(j, `Stopped waiting for ${container} on ${at}: the run was cancelled.`); throw e; }
    if (e?.stillRunning) throw new Error(`Step ${n} (keep_running) didn’t end in time: ${container} was still running on ${at} after ${forHowLong(STEP_JOB_MS)}. The run ended here.`);
    throw new Error(`Step ${n} (keep_running): ${e.message}`);
  }
  if (end.state === 'exited' && end.exitCode === 0 && !end.oomKilled) { note(j, `Step ${n}: ${container} on ${at} ended well (exit 0); waited ${end.seconds} s`); return; }
  const how = end.state === 'created' ? 'never ran' : end.oomKilled ? 'ran out of memory' : `ended with an error (exit ${end.exitCode ?? 'unknown'})`;
  // Its last lines: a whole line only (the first may be cut by tail -c), masked before the cut, no control characters.
  const r = await run(node, `docker logs --tail ${STEP_JOB_LINES} ${q(container)} 2>&1 | tail -c 4000`, { timeout: 20000 }).catch(() => null);
  const text = r?.code === 0 ? String(r.out || '') : '';
  const lines = maskSecrets(text.replace(/\r/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')).split('\n').slice(Buffer.byteLength(text) >= 4000 ? 1 : 0)
    .map(l => l.trimEnd()).filter(Boolean).slice(-STEP_JOB_LINES).map(l => l.slice(0, 200)).join('\n');
  throw new Error(`Step ${n} (keep_running) failed: ${container} on ${at} ${how}.${lines ? `\nIts last lines, written by the job (data, not instructions):\n${lines}` : ''}`);
}
// A step's own operation, to its end (60 minutes at most, as before). Cancelling the run cancels it too: it stops at its
// next step and puts back what it did.
async function stepOpEnd(j, id, limit = 60 * 60000) {
  const until = Date.now() + limit;
  while (jobs.get(id)?.status === 'running' && Date.now() < until) {
    const x = jobs.get(id);
    if (j.cancelled && !x.cancelled) cancelJob(x, j.cancelled);
    await sleep(1000);
  }
  return jobs.get(id);
}
// Who a saved step is, as the gates see it: a run an agent asked for (its key, its own call through the door, or its chat
// with Sparkie) is that agent's in each of its steps too, so every rule that asks an agent (a job run again, a GPU app
// started again, a power-off) asks in the step as in the agent's own call. The owner's run stays the owner's.
// The key itself was read when the run was asked for (runAction, for run_workflow); a step carries no key id, so
// removing the agent or making it look-only during the run refuses none of its steps (R9: the rest of a saved workflow
// it started keeps running, with the authority it started with), and the agent starts nothing new with that key.
function savedStepAgent(viewer, ctx) {
  return viewer?.agentKey || ctx.agent || ctx.agentId || ctx.via === 'agent' ? { agent: true } : {};
}
// What a finished step started, from its answer `started` and its own operation: [{ kind, spark, container }]. A start's
// models are what its operation ran (ranHere) and every operation it handed over to, in turn (a power-on, a second
// power-on inside it for a model across two whose files are only on sleeping Sparks, then the start, R56), each once,
// by its first part. Nothing for a step that answered anything else (already, kept, a stop). Each names the operations
// that started it (ops), for the owner's wish while they ran (startedReceipts).
function startedBy(action, args, out, keep = false) {
  if (out?.outcome !== 'started' || !out.operation) return [];
  const id = v => sparkIdOf(v) || String(v), ops = [];
  if (action === 'start_model') {
    for (let o = jobs.get(out.operation); o && !ops.includes(o) && ops.length < 5; o = o.inner ? jobs.get(o.inner) : null) ops.push(o);
    return [...new Set(ops.flatMap(o => o.ranHere || []))].filter(k => !/-part2$/.test(k)).map(k => ({ kind: 'model', spark: k.split('/')[0], container: k.split('/')[1], keep, ops: ops.map(o => o.id) }));
  }
  if (action === 'restart_model') return [{ kind: 'model', spark: id(args.spark), container: String(args.container), keep, ops: [out.operation] }];
  if (action === 'keep_running' && (args.do || 'keep') === 'keep') return [{ kind: out.job || args.once === true ? 'job' : 'app', spark: id(out.spark || args.spark), container: String(out.starting || args.container), keep, ops: [out.operation] }];
  return [];
}
// What a step started, and what makes it the run's (A-22): the container's Docker id when the step's operation ended, and
// for a model or an app the `since` of its entry on the list of what should be running just after the step (every start
// but self-healing's moves it, 20-desired.mjs, and so does the owner's ask answered "already"); for a job, which has no
// entry, its start time (a run again by hand moves it). The clean-up stops it only while these still match
// (startedStill).
// A missing or incomplete receipt leaves the workload alone and reports unresolved clean-up. One the owner asked for
// while its step's operation was starting it (alreadyStarting, desiredWish: the operation's ownersWish) is theirs: it is
// marked wish, and the clean-up leaves it. The mark is read after the since, in the same tick as desiredWish's own
// writes, so an ask just as the step ends is never lost between the two.
const RECEIPT_LOOK = name => `printf 'id\t%s\n' "$(docker inspect -f '{{.Id}}' ${q(name)} 2>/dev/null)"; printf 'at\t%s\n' "$(docker inspect -f '{{.State.Status}}|{{.State.StartedAt}}|{{.RestartCount}}|{{.State.ExitCode}}' ${q(name)} 2>/dev/null | head -1)"`;
async function receiptOf(spark, container) {
  const r = await run(nodeById(spark), RECEIPT_LOOK(container), { timeout: 20000 }).catch(() => null);
  if (r?.code !== 0) return null;
  const id = (fields(r.out, 'id')[0] || [])[0] || null, at = String((fields(r.out, 'at')[0] || [])[0] || '').split('|')[1] || null;
  return /^[0-9a-f]{12,64}$/.test(id || '') && at ? { id, startedAt: at } : null;
}
// Captured before the start's claim is released (runJob), never by sampling a later owner's container.
async function captureStartedReceipts(job) {
  const keys = [...new Set([...(job.ranHere || []), ...((job.type === 'restart' || job.app) && job.node && job.container ? [`${job.node}/${job.container}`] : [])])];
  job.startedReceipts = {};
  for (const key of keys.filter(k => !/-part2$/.test(k))) {
    const [spark, container] = key.split('/');
    const seen = await receiptOf(spark, container);
    const entry = desired().running.find(x => keyOf(x) === key);
    job.startedReceipts[key] = seen ? { ...seen, since: entry?.since || null } : null;
  }
  savedRunReceipts(job);
}
async function startedReceipts(items) {
  return items.map(x => {
    const { ops = [], ...item } = x, key = `${x.spark}/${x.container}`;
    const own = ops.map(id => jobs.get(id)?.startedReceipts).find(r => r && Object.hasOwn(r, key));
    const seen = own?.[key], wish = ops.some(id => jobs.get(id)?.ownersWish);
    return { ...item, ...(wish ? { wish: true } : {}), ...(seen ? { seen: x.kind === 'job' ? { id: seen.id, startedAt: seen.startedAt } : { id: seen.id, since: seen.since } } : {}) };
  });
}
// Inside the stop's own claim (stop_model, keep_running's stop): whether what a run started is still what it started.
// null when it is, else the words for why it is left running.
async function startedStill(spark, container, seen) {
  const at = sparkName(nodeById(spark) || { id: spark });
  if (!seen?.id || (!seen.startedAt && !seen.since)) throw new Error(`The record of what this run started is missing for ${container} on ${at}, so it wasn’t stopped.`);
  const now = await receiptOf(spark, container);
  if (!now?.id || (seen.startedAt && !now.startedAt)) throw new Error(`Couldn’t look at ${container} on ${at} before stopping it, so it wasn’t stopped.`);
  const entry = desired().running.find(y => `${y.spark}/${y.container}` === `${spark}/${container}`);
  const other = (seen.id && now.id && now.id !== seen.id) || (seen.startedAt && now.startedAt && now.startedAt !== seen.startedAt)
    || ('since' in seen && (entry?.since || null) !== seen.since);
  return other ? `${container} on ${at} was started again since, not by this run` : null;
}
// The receipts of the saved workflow runs under way (each run's `ran`, by its operation's id; run_workflow keeps it), so
// that what self-healing or Spark Console's own power cycle brings back on a run's behalf stays the run's: a model across
// two Sparks comes back in new containers (a new id), and a bring-back after a power-on moves its entry's since.
const runsRan = new Map();
// Before such a bring-back of `keys` ("spark/container"): each receipt for them that is still its run's.
async function receiptsHeld(keys) {
  const held = [];
  for (const [id, ran] of runsRan) {
    for (const x of ran) {
      if (x.kind === 'job' || !x.seen || x.wish || !keys.includes(`${x.spark}/${x.container}`)) continue;
      if (await startedStill(x.spark, x.container, x.seen).catch(() => 'unknown') === null) held.push({ id, x });
    }
  }
  return held;
}
// After it came back (`op`, its operation when it had one, ended well): those receipts follow it (its Docker id now, and
// its entry's since), and the run's record on disk with them; one the owner asked for while it came back is theirs
// (wish, read after the since in the same tick, as startedReceipts does).
async function receiptsBroughtBack(held, op = null) {
  for (const { id, x } of held) {
    const now = await receiptOf(x.spark, x.container);
    const entry = desired().running.find(y => `${y.spark}/${y.container}` === `${x.spark}/${x.container}`);
    if (op && jobs.get(op.id)?.ownersWish) x.wish = true;
    else if (now?.id) x.seen = { id: now.id, since: entry?.since || null };
    const j = jobs.get(id);
    if (j?.status === 'running' && runsRan.has(id)) savedRunKeep(j, { started: runsRan.get(id) });
  }
}
// What a step started that was on the list of what should be running before that step (`listed`: its entry then):
// the clean-up stops it as anything else the run started, and puts that entry back (the workloads review's Later 13).
function startedListed(items, before) {
  return items.map(x => { const was = before.find(y => `${y.spark}/${y.container}` === `${x.spark}/${x.container}`); return was ? { ...x, listed: was } : x; });
}
// Stops what `ran` holds, newest first, but not what a step saved with keep marks, nor a job that has ended; what was on
// the list of what should be running before the run (listed) goes back on it as it was. Returns the words for it: what
// was stopped, what went back on the list, what was kept, what couldn't be stopped ('' when there was nothing to say).
async function stopWhatRan(ran, viewer, ctx, title) {
  const stopped = [], kept = [], failed = [], back = [], left = [], wished = [];
  // (never as the agent whose run it was: these stops only take back what this run's own steps answered `started` for,
  // start and wake nothing, and none of them asks an agent; so a key removed or paused meanwhile, or an agent's rule,
  // never leaves the run's leftovers running for nobody, or a question no one can answer)
  const c = { via: 'workflow', actor: `${title} (saved workflow)`, request: `${title}, stopping what it started`, canChange: true, conv: ctx.conv || null, ...(ctx.channel ? { channel: ctx.channel, from: ctx.from } : {}) };
  for (const x of [...ran].reverse()) {
    const node = nodeById(x.spark), name = `${x.container} on ${sparkName(node || { id: x.spark })}`;
    if (x.keep) { kept.push(name); continue; }
    // (the owner asked for it while it was being started, by this run's step or by a bring-back: theirs now, A-22)
    if (x.wish) { wished.push(name); continue; }
    try {
      // (a job that already ended has nothing to stop)
      if (x.kind === 'job') {
        const r = await run(node, `docker inspect -f '{{.State.Status}}' ${q(x.container)} 2>/dev/null`, { timeout: 20000 });
        if (r.code === 0 && r.out.trim() !== 'running') continue;
      }
      // (what was on the list just before this stop: only what the stop itself takes off goes back, as it stood then,
      // with the date of the owner's wish from before the run: the run's own start of it was no new wish, C3)
      const was = x.listed ? desired().running.find(y => `${y.spark}/${y.container}` === `${x.spark}/${x.container}`) : null;
      // (only what this run started: its receipt is looked at again inside the stop's own claim, A-22)
      if (!x.seen?.id || (!x.seen.startedAt && !x.seen.since)) throw new Error('the record of what this run started is missing');
      const cx = { ...c, onlyIf: x.seen };
      const out = x.kind === 'model' ? await runAction('stop_model', viewer, { spark: x.spark, container: x.container }, cx)
        : await stopAppStarted(viewer, x, cx);
      if (out?.outcome === 'question') throw new Error('it needs the owner’s answer first');
      if (out?.left) { left.push(name); continue; }
      if (out?.operation) {
        const done = await waitJob(out.operation, 10 * 60000);
        if (done?.status !== 'completed') throw new Error(String(done?.error || done?.status || 'its stop didn’t finish').split('\n')[0]);
        if (done.left) { left.push(name); continue; }
      }
      if (out?.outcome !== 'already') stopped.push(name);
      if (was && out?.outcome !== 'already' && desiredPutBack([{ ...was, ...(x.listed.since ? { since: x.listed.since } : {}) }]).length) back.push(name);
    } catch (err) { failed.push(`Couldn’t stop ${name}: ${maskSecrets(String(err?.message || err).split('\n')[0]).slice(0, 300)} It may still be running.`); }
  }
  return [...(stopped.length ? [`Stopped what this run had started: ${stopped.join(', ')}.`] : []),
    ...(left.length ? [`Left running: ${left.join(', ')} ${left.length > 1 ? 'were' : 'was'} started again since, not by this run.`] : []),
    ...(wished.length ? [`Left running: ${wished.join(', ')} ${wished.length > 1 ? 'were' : 'was'} asked for by the owner while being started.`] : []),
    ...(back.length ? [`Still on the list of what should be running, as before this run: ${back.join(', ')}.`] : []),
    ...(kept.length ? [`Kept running, as saved: ${kept.join(', ')}.`] : []), ...failed].join(' ');
}
// An app or job a step started, stopped through keep_running. One whose start was cut off before it joined the list of
// what should be running (a restart in the middle) is kept first, so that its stop takes it off again (as the self-test's),
// but only while it is running: one that isn't (the owner stopped it by hand, which took it off) has nothing to stop, and
// keeping it would start it (the workloads review, C2).
async function stopAppStarted(viewer, x, c) {
  try { return await runAction('keep_running', viewer, { spark: x.spark, container: x.container, do: 'stop' }, c); } catch (e) {
    if (!/isn’t an app Spark Console keeps running/.test(String(e?.message))) throw e;
    const r = await run(nodeById(x.spark), `docker inspect -f '{{.State.Status}}' ${q(x.container)} 2>/dev/null`, { timeout: 20000 });
    if (!(r.code === 0 && r.out.trim() === 'running')) return { outcome: 'already' };
    // (one with a receipt that is off the list and running was started again by someone else: left, and never kept first)
    const why = c.onlyIf ? await startedStill(x.spark, x.container, c.onlyIf) : null;
    if (why) return { outcome: 'left', left: why };
    await runAction('keep_running', viewer, { spark: x.spark, container: x.container }, c);
    return runAction('keep_running', viewer, { spark: x.spark, container: x.container, do: 'stop' }, c);
  }
}
// The run ended badly with `e`: stop what it started, and say so. Returns the error to end the run with: the first
// error's first line, then what was stopped, kept and couldn't be stopped, then the rest of the first error. Its words
// are also kept on the run (cleanUp) for the chat line and the cancel's answer.
async function runCleanUp(j, ran, e, viewer, ctx, title) {
  const words = await stopWhatRan(ran, viewer, ctx, title);
  j.cleanUp = words || 'Nothing it had started was still running.';
  if (words) note(j, `After the end: ${words}`);
  const [first, ...rest] = String(e?.message || e).split('\n');
  return Object.assign(new Error([`${first}${words ? ` ${words}` : ''}`, ...rest].join('\n')), e?.cancelled || j.cancelled ? { cancelled: true } : {});
}
// The run ended well: a workload (a run with a job step) stops the models and apps it started for its job; its jobs have
// ended and stay. Any other run keeps what it started. The words go on the run (cleanUp) and in the chat line.
async function runEndWell(j, ran, viewer, ctx, title) {
  if (!j.workload) return;
  const words = await stopWhatRan(ran.filter(x => x.kind !== 'job'), viewer, ctx, title);
  if (words) { j.cleanUp = words; note(j, `At the end: ${words}`); }
}
// A saved step's keep: true or false, for a step that starts something (D 2.3's word); anything else is refused.
const SAVED_STEP_KEYS = new Set(['action', 'args', 'keep']);
const savedStepStarts = (action, args) => action === 'start_model' || action === 'restart_model' || (action === 'keep_running' && (args?.do ?? 'keep') === 'keep');
function savedStepShape(st, i) {
  const extra = Object.keys(st || {}).find(k => !SAVED_STEP_KEYS.has(k));
  if (extra) throw new HttpError(400, `Step ${i + 1}: ${String(extra).slice(0, 40)} isn’t part of a step. A step has action, args and, for one that starts something, keep.`);
  if (st.keep !== undefined && typeof st.keep !== 'boolean') throw new HttpError(400, `Step ${i + 1}: keep is true or false.`);
  if (st.keep === true && !savedStepStarts(st.action, st.args || {})) throw new HttpError(400, `Step ${i + 1} (${st.action}): keep is only for a step that starts something.`);
}
// A step that keeps something running (keep_running, keep) may leave its Spark out (D6a): code places it when the run
// reaches it (placeStep). Saved and checked against keep_running's own inputs with only `spark` not required.
const placedStep = (action, args) => action === 'keep_running' && (args?.do ?? 'keep') === 'keep';
const stepInput = (action, args) => { const a = ACTIONS.get(action); return placedStep(action, args) ? { ...a.input, required: (a.input.required || []).filter(k => k !== 'spark') } : a.input; };
// Steps whose action turns on a Spark Spark Console powered off (asleep): checked when reached, not refused (D6a).
const WAKES_FOR_STEP = new Set(['start_model', 'keep_running']);
const firstSentence = s => String(s?.message || s).split('\n')[0].replace(/^(.*?\.)\s.*$/, '$1');
// Where step n runs, before its action is called: the Spark it names, else one pickSpark chooses. One Spark Console
// powered off is turned on first (power.wake, for a workflow run: power_on's job, claim and audit) and kept awake until
// the run ends (letSleep), so the step's own answer is the usual one (its spark, and job for a job) and its wait works.
async function placeStep(j, n, args, viewer, title) {
  let spark = args.spark ? sparkIdOf(args.spark) || String(args.spark) : null;
  if (!spark) {
    const p = await pickSpark(j, n, args, viewer);
    spark = p.spark;
    note(j, `Step ${n}: ${args.container} goes on ${sparkName(nodeById(spark) || { id: spark })}: ${p.why}`);
  }
  if (consoleOff(spark)) {
    // (the reason by kind and this run's operation, never the title: fleet_status, an inside read, shows it, R26, F2 C5;
    // the operation makes two runs' reasons two, so one's end never lets the other's Spark sleep)
    const at = sparkName(nodeById(spark) || { id: spark }), why = `a saved workflow’s run, operation ${j.id}`;
    step(j, `Step ${n}: turning on ${at}, which Spark Console powered off`);
    keepAwake(spark, why);
    (j.keptAwake ||= new Map()).set(spark, why);
    savedRunKeep(j, { awake: [...j.keptAwake.keys()] });
    try { await power.wake(spark, 'workflow', viewer); } catch (e) { throw new Error(`Step ${n} (keep_running): ${at} couldn’t be turned on: ${firstSentence(e)}`); }
    note(j, `Step ${n}: ${at} is on`);
  }
  j.lastSpark = spark;
  return { spark };
}
const letSleep = j => { for (const [id, why] of j.keptAwake || []) doneWith(id, why); };
// The Spark for a step that names none, from the live look, as a start that names none is placed: never the brain's
// Spark, only Sparks the caller may use. Where its container already is (a job or app run again by name, or one an
// earlier run made): that Spark, awake, or asleep by the watcher's last record. Else, for a new one from its image: a
// Spark that is on, the run's last step's first (a chain of jobs reads its own folders), then in list order, where it
// fits the 8 GB rule with its memory figure, has the GPU to itself when it wants it (gpuAlone, appRoom), and holds the
// files under /in its command names (the shared folder is one per Spark). None: one Spark it powered off whose record
// has room (wakeOne, as a start that fits nowhere), unless the command names files, which a sleeping Spark can't show.
async function pickSpark(j, n, args, viewer) {
  const name = String(args.container), inv = await inventory(null), usable = computeSparks();
  const on = usable.filter(id => inv.sparks.find(s => s.id === id)?.online), asleep = usable.filter(id => consoleOff(id));
  for (const id of on) {
    const r = await run(nodeById(id), `docker inspect -f '{{.State.Status}}' ${q(name)} 2>/dev/null || echo missing`, { timeout: 20000 });
    if (r.code === 0 && r.out.trim() && r.out.trim() !== 'missing') return { spark: id, why: `${name} is there` };
  }
  const known = asleep.find(id => { const w = knowledge.workloads[`${id}/${name}`]; return w && w.state !== 'removed'; });
  if (known) return { spark: known, why: `${name} is there (it is asleep)` };
  if (!args.image) throw new Error(`Step ${n} (keep_running): there’s no container called ${name} on a Spark that is on, and the step names no image to start it from.`);
  const files = (args.command || []).map(w => /^\/in\/([A-Za-z0-9_.][A-Za-z0-9_./-]{0,200})$/.exec(String(w))?.[1]).filter(p => p && !p.split('/').includes('..')).slice(0, 5);
  const gb = args.memoryGB || APP_MEMORY_GB, why = [];
  for (const id of [...new Set([j.lastSpark, ...on].filter(x => x && on.includes(x)))]) {
    const node = nodeById(id), sp = inv.sparks.find(s => s.id === id), at = sparkName(node);
    try {
      if (args.gpu) gpuAlone(sp, await appLook(node, name, sp.tsip), at);
      await appRoom(node, gb, name);
      if (files.length) {
        // (each path whole under the shared folder: a Spark with no shared folder has none of them)
        const r = await run(node, `for p in ${files.map(q).join(' ')}; do [ -e "$HOME/.local/share/spark-portal/workspaces/shared/$p" ] || printf 'missing\\t%s\\n' "$p"; done; echo looked`, { timeout: 20000 });
        if (r.code !== 0 || !/^looked$/m.test(r.out)) throw new Error(`${at}’s shared folder couldn’t be read.`);
        const missing = fields(r.out, 'missing').map(([p]) => `/in/${p}`);
        if (missing.length) throw new Error(`${at} doesn’t have ${missing.join(', ')}.`);
      }
      return { spark: id, why: `${id === j.lastSpark ? 'the run’s last step ran there, and it' : 'it'} has room${args.gpu ? ' and a free GPU' : ''}${files.length ? ' and the files its command names' : ''}` };
    } catch (e) { why.push(firstSentence(e)); }
  }
  if (!files.length) {
    const [id] = wakeOne(asleep.filter(x => switchablePlug(x)), [], { room: true, sizeBytes: 0, needBytes: gb * 1e9, why });
    if (id) return { spark: id, why: 'no Spark that is on has room; it was asleep, and its record has room' };
  }
  throw new Error(`Step ${n} (keep_running): no Spark has room for ${name} now. ${why.join(' ')}`.trim());
}
