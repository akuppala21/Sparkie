/* ───────── a saved workflow's job is handed the one model address (D7) ───────── */
// Area: core        Rules: R57, R36        Tests: workloads-address.test.mjs
// Owns: none
// Timers: none        Wakes: none
// The address rule (design D 2.4 and 2.3's "handing results on", as cut): a job a saved workflow's run starts from its
// image (keep_running with once and an image) is told where its model is, in its settings: SPARK_MODEL_URL, Spark
// Console's one OpenAI-compatible address (the one the self-test's job calls from inside its container, 9.9);
// SPARK_MODEL_NAME, the model to ask there; SPARK_MODEL_PARALLEL, how many calls it may make at once. Which model: the
// one the step's own settings name (SPARK_MODEL_NAME), else the one an earlier step of this run started or found running
// (jobModel: a start's model, or a restarted container's), else Sparkie's ("sparkie", the brain). Settings the step names
// itself are kept as they are; only the missing ones are added. The brain is handed only when its setup says it can
// chat (`can` on the setup, ["chat"] when not said) and answers at least 2 calls at once: a job then gets its
// --max-running-requests less two (at least 1), which with R36's cap on app calls (its slots less one) leaves one place
// for another app and one for the owner's chat; a setup that doesn't say how many gets 1. A model of the run's own gets
// JOB_MODEL_PARALLEL (4). Only a job that is made in this run is handed them: one whose container is there already runs
// again as it was made, with the settings it was made with (keep_running refuses other settings than a container has),
// whether its step names its image or not, and the run says so and which model it was made to ask (the workloads
// review, C1). Nothing here touches what a save's yes covers (D6c binds the image and the saved steps, not these
// run-time settings).
// Real use waits on the self-test's fifth line passing on the real Sparks: a container reaches the one address (R57's
// Today).
const JOB_MODEL_PARALLEL = 4;
const JOB_MODEL_KEYS = ['SPARK_MODEL_URL', 'SPARK_MODEL_NAME', 'SPARK_MODEL_PARALLEL'];
// The one address as a container on a compute Spark sees it (the self-test's, less its /models).
const jobModelAddress = () => selfTestAddress()?.replace(/\/models$/, '') || null;
// The model a finished step leaves the run with, from its answer: a start's (started or already running), a restart's.
function jobModel(action, args, out) {
  if (action === 'start_model' && ['started', 'already'].includes(out?.outcome) && out.model) return { name: String(out.model) };
  if (action === 'restart_model' && out?.outcome === 'started') return { spark: sparkIdOf(args.spark) || String(args.spark), container: String(args.container) };
  return null;
}
const jobFromImage = (action, args) => action === 'keep_running' && args.once === true && typeof args.image === 'string' && (args.do || 'keep') === 'keep';
// Whether step's job container is there already on its Spark (and the model it was made to ask), from one look; a look
// that fails counts as not there (keep_running looks again itself).
async function jobThere(args) {
  const node = nodeById(sparkIdOf(args.spark) || String(args.spark || ''));
  if (!node) return null;
  const look = await appLook(node, String(args.container), null).catch(() => null);
  if (!look || look.state === 'missing') return null;
  return { at: sparkName(node), model: look.env.find(e => e.startsWith('SPARK_MODEL_NAME='))?.slice(17) || null };
}
// The model this run would hand a job, and how many calls at once ({name, parallel}), or why it hands none ({why}).
async function jobPick(j, given) {
  const named = given('SPARK_MODEL_NAME'), m = named ? { name: named } : j.jobModel || null;
  if (m && m.name !== SPARKIE_ID) {
    const name = m.name || (await inventory(null).catch(() => null))?.sparks.find(sp => sp.id === m.spark)?.deployments.find(d => d.container === m.container && d.state === 'running')?.model;
    return name ? { name, parallel: JOB_MODEL_PARALLEL } : { why: `isn’t handed a model: ${m.container} isn’t running on ${sparkName(nodeById(m.spark) || { id: m.spark })} any more` };
  }
  const can = Array.isArray(MAIN?.can) ? MAIN.can : ['chat'], slots = mainArg('--max-running-requests');
  const why = !MAIN ? 'no model is set up for Sparkie' : !can.includes('chat') ? 'its setup doesn’t say it can chat'
    : slots === 1 ? 'it answers one call at a time, and that place is the owner’s' : null;
  return why ? { why: `isn’t handed Sparkie’s model: ${why}` } : { name: SPARKIE_ID, parallel: slots ? Math.max(1, slots - 2) : 1 };
}
// The settings to add to step n's job (null when none): what it lacks of the three, and a note of what it was handed.
async function jobModelEnv(j, n, args) {
  const env = Array.isArray(args.env) ? args.env : [], given = k => env.find(e => e.startsWith(`${k}=`))?.slice(k.length + 1);
  if (JOB_MODEL_KEYS.every(given)) return null;
  const there = await jobThere(args), pick = await jobPick(j, given);
  if (there) {
    // (made to ask another model than this run would hand it: refused in those words, never run asking the old one; the
    // model review, D: "a later run with no model uses" the kept winner, so from the second winner on this is the case)
    if (there.model && pick.name && there.model !== pick.name) {
      throw new Error(`Step ${n} (keep_running): ${args.container} is there already on ${there.at}, made to ask ${there.model}, and this run would hand it ${pick.name}. A job keeps the settings it was made with: remove ${args.container}, or save the step with another container name, to run it for ${pick.name}.`);
    }
    note(j, `Step ${n}: ${args.container} is there already on ${there.at}, so it runs again as it was made${there.model ? `, asking ${there.model}` : ''}: a job is handed a model only when it is made`);
    return null;
  }
  const url = given('SPARK_MODEL_URL') || jobModelAddress();
  if (!url) { note(j, `Step ${n}: ${args.container} isn’t handed a model address: Spark Console’s own address isn’t known.`); return null; }
  if (pick.why) { note(j, `Step ${n}: ${args.container} ${pick.why}.`); return null; }
  const { name, parallel } = pick;
  const add = [['SPARK_MODEL_URL', url], ['SPARK_MODEL_NAME', name], ['SPARK_MODEL_PARALLEL', String(given('SPARK_MODEL_PARALLEL') || parallel)]].filter(([k]) => !given(k));
  note(j, `Step ${n}: ${args.container} is handed ${name} at ${url}, ${given('SPARK_MODEL_PARALLEL') || parallel} at once`);
  return { env: [...env, ...add.map(([k, v]) => `${k}=${v}`)] };
}
