/* ───────── the coding trial: can the brain in use change Spark Console's own code (C8a; design C 2.5) ───────── */
// Area: features        Rules: R67, R52        Tests: trial.test.mjs, telegram-result-approvals.test.mjs
// Owns: none
// Timers: none        Wakes: none
// agentbar/trial.mjs gives the brain small, real tasks on a copy of this repository and scores each by code; its one
// record of a run is kept here, the way the eval's result is (21-brain-eval.mjs): in the profile of the brain serving
// now (brain-profiles.json, a `trial` field beside `evals`, saveBrainProfile), sealed, the newest five, tied to that
// brain's key (model, engine, image, flags, how it is asked, what it runs), what this build's brain reads (the lock's
// mark) and the task set's version (trialSetNow: agentbar/trial/tasks as this build has it). The bar is the contract's
// (10.4, T100): every task of the set passes at least 2 of 3 runs. Each run's result of each task is kept, so a stricter
// line can be read from a record later without a new run. POST /main/trial is the owner's alone; a result that meets
// the bar, posted once a passkey is set up, is not kept but waits for the owner's press of one button in their chat, on
// the page or paired Telegram chat, for that very record (its sha256 on the button and in the press). trialPassed() is the one
// read (propose_update asks it, C8): yes only for a sealed full run that met the bar, for this brain, this build and
// this task set (the newest full run decides; a partial run neither gives nor takes); no for no record, another brain,
// build or set, only a partial run, or a newest full run that missed the bar. Nothing here is offered to the brain.
const TRIAL_KEEP = 5;   // limit: trial results kept for one brain
const TRIAL_RUNS = 3;   // a full run: each task this many times at least (10.4)
const TRIAL_TASKS_DIR = ALL_LOCAL ? fileURLToPath(new URL('../agentbar/trial/tasks', import.meta.url)) : `${homedir()}/spark-console-src/agentbar/trial/tasks`;
const TRIAL_YES = 'keep_trial_result', TRIAL_CHAT = 'The coding trial’s result';

// The task set this build has: its version (as agentbar/trial-lib.mjs taskSetVersion makes it) and its task ids; null
// when it can't be read.
function trialSetNow() {
  try {
    const files = [], walk = d => { for (const n of readdirSync(d).sort()) { const p = `${d}/${n}`; if (statSync(p).isDirectory()) walk(p); else files.push(p.slice(TRIAL_TASKS_DIR.length + 1)); } };
    walk(TRIAL_TASKS_DIR);
    const h = createHash('sha256');
    for (const f of files.sort((a, b) => a.localeCompare(b))) h.update(`${f}\0${createHash('sha256').update(readFileSync(`${TRIAL_TASKS_DIR}/${f}`)).digest('hex')}\n`);
    const ids = readdirSync(TRIAL_TASKS_DIR).filter(t => existsSync(`${TRIAL_TASKS_DIR}/${t}/task.json`)).sort();
    return ids.length ? { version: h.digest('hex'), ids } : null;
  } catch { return null; }
}
// What a record lacks, said as what it needs; null when its shape fits.
function trialRecordProblem(r) {
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi, text = (v, max) => typeof v === 'string' && v.length <= max, ID = /^[a-z0-9][a-z0-9-]{0,59}$/;
  if (!r || typeof r !== 'object' || Array.isArray(r) || r.kind !== 'spark-console-trial') return 'kind "spark-console-trial" (the record agentbar/trial.mjs writes)';
  if (!/^[0-9a-f]{64}$/.test(String(r.reads))) return 'reads: what the brain read in the build that ran (64 hex digits)';
  if (!/^[0-9a-f]{12}$/.test(String(r.build))) return 'build: the build the trial ran on (12 hex digits)';
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(String(r.at)) || Number.isNaN(Date.parse(r.at)) || Date.parse(r.at) > Date.now() + 300000) return 'at: when it ran, as the runner writes it';
  const t = r.tasks;
  if (!t || !/^[0-9a-f]{64}$/.test(String(t.version)) || !Array.isArray(t.ids) || !t.ids.length || t.ids.length > 50 || !t.ids.every(x => ID.test(String(x))) || new Set(t.ids).size !== t.ids.length) return 'tasks: {version (64 hex digits), ids}';
  const b = r.brain;
  if (!b || typeof b !== 'object' || typeof b.standIn !== 'boolean' || !/^[0-9a-f]{16}$/.test(String(b.key)) || !['setup', 'model', 'engine', 'image'].every(k => b[k] == null || text(b[k], 300))
    || !Array.isArray(b.flags) || b.flags.length > 200 || !b.flags.every(f => text(f, 1000))) return 'brain: {standIn, key (16 hex digits), setup, model, engine, image, flags}';
  if (!int(r.runs, 1, 10)) return 'runs: 1 to 10';
  if (!Array.isArray(r.results) || r.results.length !== t.ids.length || r.results.some((x, i) => x?.id !== t.ids[i])) return 'results: one entry for each task, in the order of tasks.ids';
  for (const x of r.results) {
    if (!Array.isArray(x.runs) || x.runs.length !== r.runs || !x.runs.every(y => y && typeof y.passed === 'boolean' && int(y.rounds, 0, 1000) && typeof y.seconds === 'number' && y.seconds >= 0 && y.seconds <= 36000
      && Array.isArray(y.checks) && y.checks.length <= 10 && y.checks.every(c => c && text(c.name, 200) && typeof c.pass === 'boolean'))) return `results: ${x.id}'s runs, ${r.runs} of them, each with passed, rounds, seconds and checks`;
  }
  return null;
}
// The score, counted here from the runs, never taken from the record: a full run is every task at least 3 times; the
// bar is every task passing at least 2 of 3 runs (10.4), judged on a full run only.
function trialScore(r) {
  const need = Math.ceil((2 * r.runs) / 3), passes = r.results.map(x => ({ id: x.id, passed: x.runs.filter(y => y.passed).length }));
  const full = r.runs >= TRIAL_RUNS;
  return { full, need, passes, met: full ? passes.every(x => x.passed >= need) : null };
}
// The record's own sha256, as the runner prints it (evalCanon: its fields in name order): what the button shows.
const trialHash = r => createHash('sha256').update(evalCanon(r)).digest('hex');
const trialLine = rec => `${rec.score.passes.map(x => `${x.id} ${x.passed} of ${rec.runs}`).join(', ')}: ${rec.score.full ? `the bar ${rec.score.met ? 'met' : 'not met'}` : `a partial run (${rec.runs} run${rec.runs === 1 ? '' : 's'})`} (${String(rec.at).slice(0, 10)}, build ${rec.build})`;

// POST /main/trial: keeps one record in the profile of the brain serving now, or makes it wait for the owner's press.
function storeBrainTrial(r, viewer = null) {
  if (!MAIN) throw new HttpError(404, 'No main model is configured.');
  if (mainBusy()) throw new HttpError(409, 'Sparkie’s model is changing. Keep the result once that’s done.');
  const problem = trialRecordProblem(r);
  if (problem) throw new HttpError(400, `That isn’t a coding trial result Spark Console can keep. It needs ${problem}.`);
  if (r.dry || r.tried) throw new HttpError(409, `That was ${r.dry ? 'a dry run, with no brain' : 'a try of the runner (another short check, or commands outside a box)'}: it is no trial, so it isn’t kept.`);
  if (r.brain.standIn !== ALL_LOCAL) throw new HttpError(409, r.brain.standIn ? 'That result is from the stand-in brain, not Sparkie’s model, so it isn’t kept.' : 'That result is from a real brain, and this console’s brain is the stand-in, so it isn’t kept.');
  const now = brainInUse();
  if (r.brain.key !== now.key) throw new HttpError(409, `That result is for another brain setup than the one serving now (${now.setup}). It isn’t kept.`);
  const p = brainProfileOf(MAIN);
  if (!p) throw new HttpError(409, 'No brain check is on record for the brain serving now, and the trial’s result is kept in that profile. Ask for a check first (POST /console/api/main/check), then keep the result.');
  const set = trialSetNow();
  if (set && r.tasks.version === set.version && r.tasks.ids.join() !== set.ids.join()) throw new HttpError(400, 'That result’s tasks aren’t its task set’s.');
  const hash = trialHash(r), keep = ({ kind, at, build, reads, tasks, runs, brain, results }) => ({ kind, at, build, reads, tasks: { version: tasks.version, ids: tasks.ids }, runs,
    brain: { standIn: brain.standIn, key: brain.key, setup: brain.setup ?? null, model: brain.model ?? null, engine: brain.engine ?? null, image: brain.image ?? null, flags: brain.flags },
    results: results.map(x => ({ id: x.id, runs: x.runs.map(y => ({ passed: y.passed, rounds: y.rounds, seconds: y.seconds, checks: y.checks.map(c => ({ name: c.name, pass: c.pass })) })) })) });
  const rec = { ...maskDeep(keep(r)), hash, score: trialScore(r), keptAt: new Date().toISOString() };
  let keys = 1;
  try { keys = passkeys().length; } catch {}
  // (a result that meets the bar, once a passkey is set up, waits for the owner's press on the page)
  if (rec.score.met && keys) return trialWait(rec, p, now, viewer);
  return keepTrialRecord(p, { ...rec, keptWith: rec.score.met ? 'no passkey set up' : 'owner' }, now.setup);
}
// Keeps one record in the profile p, sealed: the store above, and the owner's press for a waiting result.
function keepTrialRecord(p, rec, setupId, ctx = {}) {
  if (!MAIN || p.key !== brainKey(MAIN)) throw new HttpError(409, 'Kept nothing: the brain check on record isn’t this brain’s.');
  const kept = (Array.isArray(p.trial) ? p.trial : []).filter(x => x && typeof x === 'object');
  if (kept.some(x => x.hash === rec.hash)) return { stored: false, passed: rec.score.met === true, setup: setupId, says: 'Already kept: this same result is on record. Nothing changed.' };
  const sealKey = evalSealKey(true);
  if (sealKey) rec.seal = evalSealOf(sealKey, p.key, rec);
  const trial = [rec, ...kept].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, TRIAL_KEEP), stored = trial.includes(rec);
  if (stored) saveBrainProfile(p, null, trial);
  audit({ via: ctx.via || 'page', actor: 'owner', action: 'brain-trial-kept', args: { reads: rec.reads, tasks: rec.tasks.version, build: rec.build, setup: setupId, met: rec.score.met, hash: rec.hash, keptWith: rec.keptWith }, ok: stored });
  return { stored, passed: rec.score.met === true, setup: setupId,
    says: stored ? `Kept with the profile of ${setupId}: ${trialLine(rec)}.` : `${TRIAL_KEEP} newer trial results are kept for this brain, so this older one wasn’t kept.` };
}

// The owner's press (R67, as the eval's, R52): one result at a time waits, in memory only (a restart forgets it), for
// this build's mark, its task set and the brain serving now; a newer post replaces it and voids the old button. The
// button is owner-only, in the owner's chat "The coding trial’s result", built here from the record, with the record's
// sha256; the press carries it, and keeps only the record held here with that sha256. Its call, TRIAL_YES, is no
// action: runAction hands it to trialYes, which takes only that button's verified owner press.
let trialWaiting = null;
function trialWait(rec, p, now, viewer) {
  const reads = brainReadsNow(), set = trialSetNow();
  const no = why => { throw new HttpError(409, `Kept nothing: ${why}. Only a full result for this build’s brain, what it reads and its task set can wait for your yes.`); };
  if (!reads || rec.reads !== reads) no('that result is for another version of what the brain reads than this build’s');
  if (!set || rec.tasks.version !== set.version) no('that result is for another task set than this build’s');
  trialWaitingGone();
  const owner = accessList().owner, at = new Date().toISOString(), token = randomBytes(16).toString('hex');
  let conv = chatData().conversations.find(c => c.login === owner && !c.agent && c.title === TRIAL_CHAT && c.messages.length < LIMITS.messages);
  if (!conv) { conv = { id: `sc_${randomBytes(8).toString('hex')}`, login: owner, title: TRIAL_CHAT, spark: null, createdAt: at, updatedAt: at, messages: [] }; chatData().conversations.push(conv); }
  const from = clean(viewer?.from, 60), how = viewer?.session ? 'from a device signed in as you' : 'over the tailnet as you';
  const text = [`A coding trial result is waiting for your yes: sha256 ${rec.hash}. It is for build ${rec.build}, ${clean(now.model, 200)} with ${clean(now.engine, 40)}, image ${clean(now.image, 200)} (the setup ${clean(now.setup, 60)} serving now), on the trial's ${rec.tasks.ids.length} tasks, run on ${checkWhen(rec.at)}.`,
    `${rec.score.passes.map(x => `${x.id}: ${x.passed} of ${rec.runs} runs passed`).join('; ')}. The bar is every task passing at least ${rec.score.need} of ${rec.runs}.`,
    `Spark Console can’t check that this run happened, or that it ran on this brain: it has only the post, sent ${how}${from ? ` from ${from}` : ''}. Keep it only for a run you started, and only if the sha256 above is the one the runner printed.`,
    'Keeping it is what later lets Sparkie propose changes to its own code, each still asked of you. Until then it can’t.'].join('\n\n');
  let asked = null;
  question({ ...viewer, login: owner, role: 'owner' }, { via: 'page', conv: conv.id, chat: conv.id, onQuestion: q => { asked = q; } }, text,
    [{ label: `Keep it (sha256 ${rec.hash.slice(0, 12)}…)`, call: { action: TRIAL_YES, args: { token, hash: rec.hash, keep: true } } }, { label: 'No, drop it', call: { action: TRIAL_YES, args: { token, hash: rec.hash, keep: false } } }],
    'question', { ownerOnly: true });
  // (it stays until it is answered, replaced or forgotten at a restart: not the 15 minutes of a chat's buttons)
  for (const c of asked.choices) if (pendingChoices.has(c.choice)) pendingChoices.get(c.choice).at = Date.now() + 30 * 86400000;
  conv.messages.push({ role: 'assistant', content: text, createdAt: at, notice: true, choices: sparkieMessageChoices(asked) });
  conv.updatedAt = at;
  saveChats();
  trialWaiting = { token, rec, profileKey: p.key, conv: conv.id, group: asked.group, setup: now.setup };
  audit({ via: 'page', actor: 'owner', action: 'brain-trial-waiting', args: { reads: rec.reads, tasks: rec.tasks.version, build: rec.build, setup: now.setup, hash: rec.hash }, ok: true });
  return { stored: false, waiting: true, passed: false, hash: rec.hash, setup: now.setup, chat: conv.id,
    says: `Waiting for the owner’s yes: a button in the chat “${TRIAL_CHAT}” on the page or in your paired Telegram chat; it names sha256 ${rec.hash}.` };
}
function trialWaitingGone() {
  if (!trialWaiting) return;
  for (const [k, c] of pendingChoices) if (c.group === trialWaiting.group) pendingChoices.delete(k);
  const conv = chatData().conversations.find(c => c.id === trialWaiting.conv);
  for (const m of conv?.messages || []) for (const x of m.choices || []) if (x.group === trialWaiting.group && x.state === 'open') x.state = 'gone';
  trialWaiting = null;
  saveChats();
}
// The press (runAction hands TRIAL_YES here): only its own owner-only button, approved by the verified owner, for the
// record with that sha256.
async function trialYes(args, viewer, ctx) {
  if (!(isOwnerPress(ctx) && viewer?.role === 'owner' && !viewer?.agentKey)) throw new HttpError(404, `No action called ${TRIAL_YES}.`);
  const w = trialWaiting, token = String(args?.token || ''), same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  if (!w || !same(token, w.token) || !same(String(args?.hash || ''), w.rec.hash)) throw new HttpError(409, 'That result isn’t waiting any more: a newer one came, it was answered, or Spark Console restarted. Nothing was kept.');
  trialWaiting = null;
  if (args.keep !== true) {
    audit({ via: ctx.via, actor: 'owner', action: 'brain-trial-dropped', args: { reads: w.rec.reads, build: w.rec.build, hash: w.rec.hash }, ok: true });
    return { outcome: 'dropped', note: 'Dropped: that coding trial result wasn’t kept.' };
  }
  await brainRanLook();
  const p = MAIN && !mainBusy() ? brainProfileOf(MAIN) : null;
  if (!p || p.key !== w.profileKey || brainReadsNow() !== w.rec.reads || trialSetNow()?.version !== w.rec.tasks.version) throw new HttpError(409, 'Kept nothing: Sparkie’s model or this build changed since that result was posted. Run the trial again.');
  let keys = 1;
  try { keys = passkeys().length; } catch {}
  if (!isOwnerPress(ctx) || viewer?.agentKey) throw new HttpError(409, 'That owner approval is no longer current. Nothing was kept.');
  const out = keepTrialRecord(p, { ...w.rec, keptWith: ctx.via === 'telegram' ? 'telegram' : keys ? 'passkey' : 'the owner’s press' }, w.setup, ctx);
  return { outcome: 'kept', note: out.stored ? `Kept: ${trialLine(w.rec)}.` : out.says };
}

// The read (C8's propose_update asks it): { passed, says }. Never throws.
function trialPassed() {
  const no = says => ({ passed: false, says });
  try {
    if (!MAIN) return no('Sparkie has no model set up.');
    const p = brainProfileOf(MAIN), reads = brainReadsNow(), set = trialSetNow();
    if (!p) return no('No brain check is on record for the brain serving now, so no trial result is either.');
    if (!reads) return no('What this build’s brain reads isn’t known (there is no lock for this build), so no trial result can count for it.');
    if (!set) return no('This build’s task set for the coding trial can’t be read, so no trial result can count for it.');
    // (newest first; of two at one moment, the one that missed the bar)
    const all = (Array.isArray(p.trial) ? p.trial : []).filter(x => x && typeof x === 'object' && !trialRecordProblem(x) && x.brain.key === p.key && x.brain.standIn === ALL_LOCAL && evalSealed(p.key, x))
      .map(x => ({ ...x, score: trialScore(x) })).sort((a, b) => String(b.at).localeCompare(String(a.at)) || (a.score.met === false ? -1 : 0) - (b.score.met === false ? -1 : 0));
    if (!all.length) return no('No coding trial result is on record for this brain. Run node agentbar/trial.mjs on the real brain, then keep it with --store.');
    const mine = all.filter(x => x.reads === reads && x.tasks.version === set.version && x.tasks.ids.join() === set.ids.join());
    if (!mine.length) return no(`The coding trial on record for this brain (${String(all[0].at).slice(0, 10)}, build ${all[0].build}) was for another build or task set, not this one. Run it again.`);
    // (the newest full run decides; a partial run neither gives nor takes)
    const newest = mine.find(x => x.score.full);
    if (!newest) return no(`The coding trial on record for this build is only a partial run: ${trialLine(mine[0])}. The bar needs every task 3 times.`);
    if (!newest.score.met) return no(`The newest full coding trial on record for this build didn’t meet the bar: ${trialLine(newest)}.`);
    return { passed: true, says: `The coding trial passed for this brain and build: ${trialLine(newest)}.` };
  } catch (e) { return no(`The trial’s record couldn’t be read: ${String(e?.message || e).slice(0, 160)}`); }
}
// GET /main/trial: the read, and whether a result waits for the owner's press.
const trialView = () => ({ ...trialPassed(), waiting: trialWaiting ? { hash: trialWaiting.rec.hash, chat: trialWaiting.conv } : null, tasks: trialSetNow() });
