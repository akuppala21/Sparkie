/* ───────── the yes at save covers a saved workflow's images (D6c) ───────── */
// Area: core        Rules: R35, R38        Tests: workloads-images.test.mjs
// Owns: none (saved-workflows.json's `approved`, written by writeSaved in 18-workflows.mjs)
// Timers: none        Wakes: none
// A new image is code that runs on a Spark, so keep_running starts one at once only for the owner on their tailnet, and
// otherwise asks the owner (R38). A saved workflow's steps run as `workflow`, so until now a step with a new image always
// asked. Now the owner's yes to a save is also the yes to the images its steps name (contract 9.27; design D 2.3, and
// its question 2 as recommended). The yes is a button the owner presses, whose label lists every step with its image
// (pageOnlyLabel, stepWords): Sparkie's save button pressed on the page by the owner on their tailnet, or an owner-only
// button pressed there with the passkey (a save from Telegram waits for one). A save with no button (the owner's own
// POST /actions, a save Sparkie makes at once) showed nobody the images, so it isn't the yes; nor is anything an agent,
// an agent's chat or a device signed in over the internet without the passkey does. Then save_workflow keeps
// `approved: {images, steps, by, at}` on the workflow, and its answer says which images it covers (savedImagesWords).
// What the yes binds to: each image reference exactly as the button showed it, the tag as typed, or the digest when the
// reference carries one (name@sha256:…), compared as text; and `steps`, a hash of the saved steps exactly as they were
// saved. A run of that workflow passes a step's image as approved (stepImagesYes) only when the steps still hash the same,
// that step's image is literal (not from an input) and on the list, and the run is the owner's own (never an agent's
// key or an agent's chat). Anything else asks as before: a changed step, another tag or digest, an image from an input, a
// workflow saved with no button or by an agent, an agent's run. A tag is a name: if it later points at another image, a
// Spark that already has the old one runs that copy (keep_running pulls only an image the Spark doesn't have), and a
// Spark that pulls gets what the tag names then; the owner pins one exactly by saving name@sha256:… .
const savedStepsHash = steps => createHash('sha256').update(JSON.stringify(steps)).digest('hex').slice(0, 16);
// The literal images a save's steps start from (a keep_running step that names one; one with an {input} isn't literal).
const savedImages = steps => [...new Set(steps.filter(st => st.action === 'keep_running' && typeof st.args?.image === 'string' && !placeholders(st.args.image).length).map(st => st.args.image))];
const savedImagesFromInputs = steps => steps.filter(st => st.action === 'keep_running' && typeof st.args?.image === 'string' && placeholders(st.args.image).length).map(st => st.args.image);
// Whether this save is the owner's own yes to `images`: a pressed button that listed them (see above).
function savedImagesYes(viewer, ctx, images) {
  if (!images.length) return false;
  if (ctx.ownerConfirmed) return true;
  return Boolean(ctx.button) && ctx.via === 'page' && !viewer?.session && !viewer?.agentKey && !ctx.agent && !ctx.agentId;
}
// What the save's answer says of its images: those its yes covers, or that a run asks.
function savedImagesWords(images, fromInputs, yes) {
  const one = list => list.length > 1 ? 'them' : 'it';
  return [...(images.length ? [yes ? `Your yes to this save covers ${images.join(', ')}: a run of exactly these steps starts ${one(images)} without asking again.`
    : `A run asks before it starts ${images.join(', ')}: only your yes to a save’s button, which lists its steps, covers the images ${one(images)} names.`] : []),
    ...(fromInputs.length ? [`${fromInputs.join(', ')} ${fromInputs.length > 1 ? 'come' : 'comes'} from an input, so a run asks for ${one(fromInputs)}.`] : [])].join(' ');
}
// The images step `st` of saved workflow `w` may start without asking, in a run by this caller: [] or [its image].
function stepImagesYes(w, st, viewer, ctx) {
  const a = w.approved, img = st.args?.image;
  if (st.action !== 'keep_running' || !a || typeof img !== 'string' || placeholders(img).length || a.steps !== savedStepsHash(w.steps) || !a.images?.includes(img)) return [];
  return viewer?.agentKey || ctx.agent || ctx.agentId || !['page', 'api', 'sparkie'].includes(ctx.via) ? [] : [img];
}
