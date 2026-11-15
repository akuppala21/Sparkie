/* ───────── compare_models: a saved workload run with each candidate model, and the winner kept (D8) ───────── */
// Area: features        Rules: R57, R13        Tests: compare.test.mjs, compare-asleep.test.mjs, compare-brain.test.mjs
// Owns: none (saved-workflows.json's `compared` and `best`, through writeSaved in 18-workflows.mjs)
// Timers: none        Wakes: none
// "Run my workload on whatever is best, keep the winner" (contract 9.27, T141; design D 2.5's first block, as cut).
// compare_models {workflow, candidates, sample} runs a saved workflow that declares a `model` input once for each
// candidate, one after another, as run_workflow runs it (its own code, called with the compare's caller: placing, job
// waits, D7's model address, D6c's yes, and a workload's end stopping what that run started all hold). It is one
// operation, `compare`, which holds no claim itself. The brain ("sparkie") goes first when listed: its run leaves out
// the steps that start, stop or restart `{model}` (compareBrainView), and it is tried only when its setup can chat and
// answers more than one call at once; nothing starts, stops or wakes for it. Each candidate's job made from its image
// gets the compare's own name suffix (compareStep), so it is a new container with that candidate's settings, and the
// number of items in SPARK_SAMPLE beside D7's SPARK_MODEL_NAME and SPARK_MODEL_URL: its job learns the candidate from
// its settings, never from an {input} in it, and only the {model} step's model is handed on (run_workflow). A
// candidate's run stops nothing to make room (noStops: the owner's models stay as they were), and it is the owner's own
// unless an agent asked (ownersOwn: one that fails doesn't count toward pausing agents). Refused before anything
// starts, by name (compareWontReach), a workflow a candidate's run would not reach: a job step with an {input} in it
// (asked on every run, D6c: a run's input is on no button), a job step that names its own SPARK_MODEL_NAME or
// SPARK_MODEL_URL (D7 keeps a step's own settings, so every candidate's job would ask that one model), a keep_running
// step with no image that names a job Spark Console made (run again by name, it keeps the settings it was made with),
// a workflow with no job made from an image (nothing to score), and one that starts no {model} before its last job
// (every candidate's job would ask the same model). A run with no model given runs the brain's view when the brain is
// the one kept (run_workflow), and a job made for another model is refused in those words (jobModelEnv).
// The score: `result.json` in the folder of the run's last job (jobs/<container> on the Spark it ran on), read by code
// through the worker (no link followed), only when it is at most 4 KB, JSON, and written after that job began; only
// `score` (0 to 1), `ok` (true or false) and `items` (a whole number) are taken, as numbers, and nothing else of the
// file is kept or shown. The winner, by code: of the candidates whose run ended well and whose ok isn't false, the best
// score when it leads the next by more than 0.05 and every one has a score; then it is kept on the saved workflow (best:
// model, score, items, seconds, sample, at) and a later run with no model uses it. Closer, or with no score: the owner
// picks, from buttons in the chat it was asked in (compare_models {workflow, keep}), or by saying it. From Telegram the
// keeping waits for the owner in Spark Console, as other changes to saved workflows do (an owner-only button). Every
// run's results are kept too (compared), for the keep. One hour in all (COMPARE_MS): at the hour the run under way is
// cancelled, which stops what it started, and the best so far is kept or offered. A candidate that won't start is listed
// with why and the loop goes on.
const COMPARE_MS = Number(process.env.SPARK_CONSOLE_COMPARE_MS || 3600000);
const COMPARE_MARGIN = 0.05;
const COMPARE_FILE_MAX = 4096;
const compareWords = e => maskSecrets(String(e?.message || e || 'unknown').split('\n')[0]).slice(0, 300);
const compareIsBrain = m => String(m).toLowerCase() === SPARKIE_ID;
const compareSkips = st => ['start_model', 'stop_model', 'restart_model'].includes(st.action) && placeholders(st.args).includes('model');
// The workflow as the brain runs it: the steps that start, stop or restart {model} left out; a save's yes (D6c) still
// covers the rest only when it covered the steps as saved.
function compareBrainView(w) {
  const steps = w.steps.filter(st => !compareSkips(st));
  const approved = w.approved && w.approved.steps === savedStepsHash(w.steps) ? { ...w.approved, steps: savedStepsHash(steps) } : null;
  return { ...w, steps, approved };
}
// Why a candidate's run of saved workflow w would not reach its job (see above), or null. A job made before is known
// from what the watcher last saw, else from a look at the Sparks that are on: nothing is woken.
async function compareWontReach(w) {
  const wont = await compareStepWont(w);
  if (wont) return wont;
  // (with no job made from an image nothing is scored, and the last candidate stays running; with no start of {model}
  // before the last job every candidate's job asks the same model)
  const last = w.steps.map((st, i) => (jobFromImage(st.action, stepArgs(st)) ? i : -1)).filter(i => i >= 0).pop();
  if (last === undefined) return `“${w.title}” runs no job made from an image, so no candidate would be scored (a score is the job’s result.json). Save it with its job.`;
  if (!w.steps.slice(0, last).some(st => ['start_model', 'restart_model'].includes(st.action) && placeholders(st.args).includes('model'))) {
    return `“${w.title}” starts no {model} before its job (step ${last + 1}), so every candidate’s job would ask the same model. Save it with a start of {model} before the job.`;
  }
  return null;
}
async function compareStepWont(w) {
  for (const [i, st] of w.steps.entries()) {
    const a = stepArgs(st), n = `Step ${i + 1} of “${w.title}”`, job = jobFromImage(st.action, a);
    if (job && placeholders(st.args).length) return `${n} is a job with an {input} in it, so every run of it stops at a question. Its job gets the model to ask in its settings (SPARK_MODEL_NAME, SPARK_MODEL_URL) and how many items to do in SPARK_SAMPLE: save it without the {input}.`;
    const own = job ? (Array.isArray(a.env) ? a.env : []).map(e => String(e).split('=')[0]).find(k => ['SPARK_MODEL_NAME', 'SPARK_MODEL_URL'].includes(k)) : null;
    if (own) return `${n} is a job that names its own ${own}, so every candidate’s run would ask that one model. Save it without ${own}: each candidate’s job is handed it.`;
    if (st.action === 'keep_running' && a.image === undefined && (a.do || 'keep') === 'keep' && !placeholders(st.args).length && await compareIsJob(String(a.container), a.spark)) {
      return `${n} runs the job ${a.container} again by name, which keeps the settings it was made with, so no candidate would reach it. Save it with its image, so each candidate gets a job of its own.`;
    }
  }
  return null;
}
async function compareIsJob(name, spark) {
  const ids = spark ? [String(spark)] : computeSparks();
  if (ids.some(id => { const x = knowledge.workloads?.[`${id}/${name}`]; return x && x.state !== 'removed' && x.labels?.['spark.job'] === '1'; })) return true;
  const inv = await inventory(null).catch(() => null);
  for (const sp of (inv?.sparks || []).filter(x => ids.includes(x.id) && x.online && nodeById(x.id))) {
    if ((await appLook(nodeById(sp.id), name, sp.tsip).catch(() => null))?.job) return true;
  }
  return false;
}
// run_workflow's loop asks this of each step of a candidate's run: a job made from its image gets the compare's suffix,
// and the number of items in its settings (unless it sets them itself).
function compareStep(j, n, st, args, c) {
  if (!jobFromImage(st.action, args)) return;
  args.container = `${String(args.container).slice(0, 62 - c.tag.length)}-${c.tag}`;
  const env = Array.isArray(args.env) ? args.env : [];
  if (!env.some(e => String(e).startsWith('SPARK_SAMPLE='))) args.env = [...env, `SPARK_SAMPLE=${c.sample}`];
}
// Why the brain isn't tried, or null.
function compareBrainWhy() {
  const can = Array.isArray(MAIN?.can) ? MAIN.can : ['chat'], slots = mainArg('--max-running-requests');
  return !MAIN ? 'no model is set up for Sparkie' : !can.includes('chat') ? 'its setup doesn’t say it can chat'
    : slots === 1 ? 'it answers one call at a time, and that place is the owner’s' : null;
}
// A candidate's run, to its end; at the hour (or when the compare is cancelled) it is cancelled, which stops what it
// started.
async function compareWait(j, id, until) {
  while (jobs.get(id)?.status === 'running') {
    const x = jobs.get(id);
    if ((j.cancelled || Date.now() >= until) && !x.cancelled) cancelJob(x, j.cancelled ? j.cancelled : 'the compare: its hour was up');
    await sleep(1000);
  }
  return jobs.get(id);
}
// The score a candidate's run left: { score, ok, items } (numbers, each only when it is one), or { scoreWhy }.
async function compareScore(run) {
  const last = (run.jobsRan || []).at(-1);
  if (!last) return { scoreWhy: 'its run had no job' };
  const node = nodeById(last.spark), folder = `jobs/${last.container}`, me = healOwner();
  let list;
  try { list = await sharedFolder(me, node, { operation: 'list', path: folder, limit: 200 }); } catch (e) { return { scoreWhy: `its job’s folder couldn’t be read: ${compareWords(e)}` }; }
  const f = list.entries.find(x => x.name === 'result.json' && x.kind === 'file');
  if (!f) return { scoreWhy: 'its job wrote no result.json' };
  if (f.size > COMPARE_FILE_MAX) return { scoreWhy: 'its result.json is over 4 KB' };
  if (f.modifiedAt * 1000 < last.began - 2000) return { scoreWhy: 'its result.json was written before this run’s job began' };
  let text;
  try { text = Buffer.from((await sharedFolder(me, node, { operation: 'read', path: `${folder}/result.json` })).data, 'base64').toString('utf8'); } catch (e) { return { scoreWhy: `its result.json couldn’t be read: ${compareWords(e)}` }; }
  let v;
  try { v = JSON.parse(text); } catch { return { scoreWhy: 'its result.json isn’t JSON' }; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { scoreWhy: 'its result.json isn’t an object' };
  const out = {};
  if (typeof v.score === 'number' && Number.isFinite(v.score) && v.score >= 0 && v.score <= 1) out.score = Math.round(v.score * 10000) / 10000;
  if (typeof v.ok === 'boolean') out.ok = v.ok;
  if (Number.isInteger(v.items) && v.items >= 0 && v.items <= 1e9) out.items = v.items;
  if (out.score === undefined) out.scoreWhy = 'its result.json has no score from 0 to 1';
  return out;
}
const compareLine = r => `${r.model}: ${r.result === 'ran' ? `${r.score !== undefined ? `score ${r.score}` : `no score (${r.scoreWhy})`}${r.items !== undefined ? `, ${r.items} items` : ''}${r.ok === false ? ', not ok' : ''}, ${r.seconds} s`
  : `${r.result}: ${r.why}`}`;
// Keeps `best` (and the results) on the saved workflow, through its one writer.
function compareKeepOn(w, best, compared) {
  writeSaved(savedWorkflows().map(x => (x.id === w.id ? { ...x, ...(compared ? { compared } : {}), ...(best ? { best } : {}) } : x)));
}
const compareBest = (r, sample) => ({ model: r.model, ...(r.score !== undefined ? { score: r.score } : {}), ...(r.items !== undefined ? { items: r.items } : {}), seconds: r.seconds, sample, at: new Date().toISOString() });
async function compareRun(j, w, cands, sample, viewer, ctx) {
  const until = Date.now() + COMPARE_MS, results = [], tag = j.id.slice(0, 6);
  for (const [i, model] of cands.entries()) {
    if (j.cancelled) break;
    if (Date.now() >= until) { results.push({ model, result: 'not tried', why: 'the hour was up' }); continue; }
    const brain = compareIsBrain(model), why = brain ? compareBrainWhy() : null;
    if (why) { results.push({ model, result: 'not tried', why }); note(j, `${model}: not tried: ${why}`); continue; }
    step(j, `Candidate ${i + 1} of ${cands.length}: ${model}`);
    const inputs = { model: brain ? SPARKIE_ID : model, ...('sample' in (w.inputs || {}) ? { sample } : {}) };
    const c = { ...ctx, conv: null, onQuestion: null, request: `comparing models for ${w.title}: ${model}`, compare: { tag: `${tag}${i + 1}`, sample, ...(brain ? { workflow: compareBrainView(w) } : {}) } };
    let out;
    try { out = await ACTIONS.get('run_workflow').run({ name: w.title, inputs }, viewer, c); } catch (e) { results.push({ model, result: 'failed', why: compareWords(e) }); note(j, `${model}: failed: ${compareWords(e)}`); continue; }
    // (the owner asked for the compare, so its candidate runs are the owner's own, as runAction marks a run Sparkie
    // starts in the owner's chat: one that fails doesn't count toward pausing agents; an agent's compare's runs do)
    if (!savedStepAgent(viewer, ctx).agent && jobs.has(out.operation)) jobs.get(out.operation).ownersOwn = true;
    const run = await compareWait(j, out.operation, until);
    const seconds = Math.round((Date.parse(run?.finishedAt) - Date.parse(run?.createdAt)) / 1000) || 0;
    const r = run?.status === 'completed' ? { model, result: 'ran', seconds, ...(await compareScore(run)) }
      : { model, result: run?.status === 'cancelled' ? 'stopped' : 'failed', seconds, why: run?.status === 'cancelled' && !j.cancelled ? 'the hour was up' : compareWords(run?.error || run?.status) };
    results.push(r);
    note(j, compareLine(r));
  }
  cancelCheck(j);
  const passed = results.filter(r => r.result === 'ran' && r.ok !== false), scored = [...passed].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const clear = scored.length && scored.every(r => r.score !== undefined) && (scored.length === 1 || scored[0].score - scored[1].score > COMPARE_MARGIN);
  const compared = { at: new Date().toISOString(), sample, results: results.map(r => ({ ...r })) };
  const lines = results.map(compareLine);
  if (!passed.length) { compareKeepOn(w, null, compared); j.report = [...lines, 'No candidate ended well, so nothing was kept.']; return; }
  const winner = clear ? scored[0] : null;
  // From Telegram the keeping waits for the owner in Spark Console, as other changes to saved workflows do.
  if (winner && !ctx.channel) {
    compareKeepOn(w, compareBest(winner, sample), compared);
    j.report = [...lines, `Kept ${winner.model} for “${w.title}”: a run of it with no model given uses it.`];
    return;
  }
  compareKeepOn(w, null, compared);
  const offer = winner ? [winner] : scored;
  const said = winner ? `${winner.model} won; keeping it for “${w.title}” waits for you in Spark Console.` : `Too close to call (within ${COMPARE_MARGIN}, or without a score): pick the one to keep for “${w.title}”.`;
  j.report = [...lines, said];
  if (!ctx.conv) { j.report.push(`To keep one: compare_models {"workflow": "${w.title}", "keep": "<model>"}.`); return; }
  // (the question as asked, with its choices' ids, for the buttons under the result in the chat)
  let asked = null;
  question(viewer, { ...ctx, onQuestion: q => { asked = q; } }, said, offer.slice(0, 4).map(r => ({ label: `Keep ${r.model} (${r.score !== undefined ? `score ${r.score}, ` : ''}${r.seconds} s)`, call: { action: 'compare_models', args: { workflow: w.title, keep: r.model } } })), 'question', { ownerOnly: Boolean(ctx.channel) });
  if (asked?.choices) j.choices = sparkieMessageChoices(asked);
}
// The owner's pick after a compare: keeps that candidate of the last compare of this workflow.
function compareKeep(w, keep, viewer, ctx) {
  const r = (w.compared?.results || []).find(x => x.model === keep && x.result === 'ran' && x.ok !== false);
  if (!r) throw new HttpError(409, `${String(keep).slice(0, 80)} isn’t one of the candidates that ended well in the last compare of “${w.title}”, so nothing was kept.`);
  if (ctx.channel && !ctx.ownerConfirmed) {
    const label = `Keep ${r.model} for “${w.title}”`;
    return question(viewer, ctx, `${label}? That one waits for you in Spark Console.`, [{ label, call: { action: 'compare_models', args: { workflow: w.title, keep: r.model } } }, { label: 'No, leave it', call: null }], 'question', { ownerOnly: true });
  }
  compareKeepOn(w, compareBest(r, w.compared.sample), null);
  return { outcome: 'kept', workflow: w.title, model: r.model, note: `${r.model} is kept for “${w.title}”: a run of it with no model given uses it.` };
}

action({
  name: 'compare_models', title: 'Compare models on a saved workload', kind: 'change', scope: 'fleet:act', who: 'owner', group: 'routines',
  description: 'Use when the owner wants a saved workload run with several models to find the best one ("run my workload on whatever is best", "compare X against Y on nightly", "keep the winner"). The saved workflow must declare an input called model, start {model} before its job, and run a job made from its image. Runs it once for each candidate, one after another: each starts what it needs, stopping nothing to make room; its job learns the model to ask from its settings (SPARK_MODEL_NAME, SPARK_MODEL_URL, handed to it: the step names neither) and how many items to do from SPARK_SAMPLE, never from an {input} in it, and is made from its image (not a job run again by name), and writes result.json with a score from 0 to 1; what the run started is stopped. Keeps the winner on the saved workflow (a later run with no model uses it); when the scores are within 0.05 the owner picks. "sparkie" means Sparkie\'s own model. One hour in all. It returns an operation id at once; the scores are posted when it ends. With keep, it keeps that candidate of the last compare instead (the owner\'s pick).',
  input: { type: 'object', properties: {
    workflow: { type: 'string', minLength: 2, maxLength: 80, description: 'The saved workflow’s name, from workflows (saved); it declares an input called model.' },
    candidates: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', minLength: 1, maxLength: 200, pattern: '^[A-Za-z0-9][^\\n\\r\\x00-\\x1f]{0,199}$' }, description: 'The models to try, as start_model takes them; "sparkie" is Sparkie’s own model.' },
    sample: { type: 'integer', minimum: 1, maximum: 200, description: 'How many items each candidate’s job does (SPARK_SAMPLE in its settings, and the workflow’s sample input if it has one); 10 when not said.' },
    keep: { type: 'string', minLength: 1, maxLength: 200, description: 'Only after a compare whose scores were close: the candidate the owner picked.' },
  }, required: ['workflow'], additionalProperties: false },
  run: async (input, viewer, ctx) => {
    const w = findSaved(input.workflow);
    if (!w) throw new HttpError(404, `No saved workflow called “${input.workflow}”. Saved: ${savedWorkflows().map(x => x.title).join(', ') || 'none yet'}.`);
    if (!Object.hasOwn(w.inputs || {}, 'model')) throw new HttpError(409, `“${w.title}” has no input called model, so it can’t be run with each candidate. Save it with {model} where the model’s name goes (its start step; its job gets the model in SPARK_MODEL_NAME).`);
    if (input.keep !== undefined) {
      if (input.candidates !== undefined || input.sample !== undefined) throw new HttpError(400, 'Give keep alone, with the workflow.');
      return compareKeep(w, input.keep, viewer, ctx);
    }
    if (!input.candidates) throw new HttpError(400, 'Missing argument: candidates.');
    // (one a candidate's run would not reach: refused by name before anything starts)
    const wont = await compareWontReach(w);
    if (wont) throw new HttpError(409, wont);
    const cands = [...new Set(input.candidates.map(String))].sort((a, b) => compareIsBrain(b) - compareIsBrain(a));
    if ([...jobs.values()].some(x => x.type === 'compare' && x.status === 'running' && x.model === w.title)) throw new HttpError(409, `A compare of “${w.title}” is running already. Its scores are posted when it ends.`);
    const sample = input.sample ?? 10;
    const job = newJob('compare', { model: w.title, by: viewer.login, actor: ctx.actor || null, via: ctx.via || null, request: ctx.request ? String(ctx.request).slice(0, 300) : null });
    runJob(job, j => compareRun(j, w, cands, sample, viewer, ctx));
    return { outcome: 'started', operation: job.id, workflow: w.title, candidates: cands, sample,
      next: `wait_operation {"id":"${job.id}"}` };
  },
});
