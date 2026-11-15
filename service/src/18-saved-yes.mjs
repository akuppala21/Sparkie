/* ───────── the yes at save covers a saved workflow's images (D6c) ───────── */
// Area: core        Rules: R35, R38        Tests: workloads-images.test.mjs
// Owns: none (saved-workflows.json's `approved`, written by writeSaved in 18-workflows.mjs)
// Timers: none        Wakes: none
// A new image is code that runs on a Spark, so keep_running starts one at once only for the owner on their tailnet, and
// otherwise asks the owner (R38). A saved workflow's steps run as `workflow`, so until now a step with a new image always
// asked. Now the owner's yes to the save is also the yes to the images its steps name (contract 9.27; design D 2.3, and
// its question 2 as recommended): save_workflow keeps `approved: {images, steps, by, at}` on the workflow when the save
// is the owner's own yes (savedImagesYes): the owner on their tailnet (page, API, their own chat with Sparkie; never a
// device signed in over the internet, an agent, an agent's chat or Telegram), or an owner-only button pressed on the page
// (Telegram's save waits for one). A save Sparkie makes at once counts only when every image is in the owner's own words,
// typed whole, as keep_running asks of a new image (appNamed); else it is saved without the yes, and says so.
// What the yes binds to: each image reference exactly as the save showed it, the tag as typed, or the digest when the
// reference carries one (name@sha256:…), compared as text; and `steps`, a hash of the saved steps exactly as they were
// saved. A run of that workflow passes a step's image as approved (stepImagesYes) only when the steps still hash the same,
// that step's image is literal (not from an input) and on the list, and the run is the owner's own (never an agent's
// key or an agent's chat). Anything else asks as before: a changed step, another tag or digest, an image from an input, a
// workflow an agent saved or replaced, an agent's run. A tag is a name: if it later points at another image, a Spark that
// already has the old one runs that copy (keep_running pulls only an image the Spark doesn't have), and a Spark that
// pulls gets what the tag names then; the owner pins one exactly by saving name@sha256:… .
const savedStepsHash = steps => createHash('sha256').update(JSON.stringify(steps)).digest('hex').slice(0, 16);
// The literal images a save's steps start from (a keep_running step that names one; one with an {input} isn't literal).
const savedImages = steps => [...new Set(steps.filter(st => st.action === 'keep_running' && typeof st.args?.image === 'string' && !placeholders(st.args.image).length).map(st => st.args.image))];
const savedImagesFromInputs = steps => steps.filter(st => st.action === 'keep_running' && typeof st.args?.image === 'string' && placeholders(st.args.image).length).map(st => st.args.image);
// Whether this save is the owner's own yes to `images`, as keep_running's own test for starting a new image at once.
function savedImagesYes(viewer, ctx, images) {
  if (!images.length) return false;
  if (ctx.ownerConfirmed) return true;
  const here = ['page', 'api', 'sparkie'].includes(ctx.via) && !viewer?.session && !viewer?.agentKey && !ctx.agent && !ctx.agentId && !ctx.channel;
  if (!here) return false;
  if (ctx.via !== 'sparkie' || ctx.button) return true;
  // (Sparkie saving at once: each image typed whole in the owner's words, as appNamed asks)
  const typed = new Set(normQuotes(String(ctx.said || ctx.request || '')).split(/\s+/).flatMap(w => [w, w.replace(/^["'“”(\[]+|["'“”)\].,;!?]+$/g, '')]).map(w => w.toLowerCase()));
  return images.every(img => typed.has(img.toLowerCase()));
}
// The images step `st` of saved workflow `w` may start without asking, in a run by this caller: [] or [its image].
function stepImagesYes(w, st, viewer, ctx) {
  const a = w.approved, img = st.args?.image;
  if (st.action !== 'keep_running' || !a || typeof img !== 'string' || placeholders(img).length || a.steps !== savedStepsHash(w.steps) || !a.images?.includes(img)) return [];
  return viewer?.agentKey || ctx.agent || ctx.agentId || !['page', 'api', 'sparkie'].includes(ctx.via) ? [] : [img];
}
