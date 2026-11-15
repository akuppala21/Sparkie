/* ───────── the yes at save covers a saved workflow's images (D6c) ───────── */
// Area: core        Rules: R35, R38        Tests: workloads-images.test.mjs
// Owns: none (saved-workflows.json's `approved`, written by writeSaved in 18-workflows.mjs)
// Timers: none        Wakes: none
// A new image is code that runs on a Spark, so keep_running starts one at once only for the owner on their tailnet, and
// otherwise asks the owner (R38). A saved workflow's steps run as `workflow`, so until now a step with a new image always
// asked. Now the owner's yes to a save is also the yes to the images its steps name (contract 9.27; design D 2.3, and
// its question 2 as recommended). The yes is a button the owner presses, whose label lists every step, a keep_running
// step with an image whole, and says the press is also the yes to those images and that a tag can change (pageOnlyLabel,
// stepWords, savedImagesLabel): Sparkie's save button pressed on the page by the owner on their tailnet, or an
// owner-only button pressed there with the passkey (a save from Telegram waits for one), never one whose call carried
// `from` (its label listed no steps). A save with no button (the owner's own POST /actions, a save Sparkie makes at
// once) showed nobody the images, so it isn't the yes; nor is anything an agent, an agent's chat or a device signed in
// over the internet without the passkey does. Then save_workflow keeps `approved: {images, steps, by, at}` on the
// workflow, and its answer and the chat line after the press say which images it covers (savedImagesWords). It covers
// only what the button showed whole (stepCovered): a step with an {input} in any argument, or with part of its line
// hidden as a key, is asked on every run (the workloads review, A1 and A2).
// What the yes binds to: each image reference exactly as the button showed it, the tag as typed, or the digest when the
// reference carries one (name@sha256:…), compared as text; and `steps`, a hash of the saved steps exactly as they were
// saved. A run of that workflow passes a step's image as approved (stepImagesYes) only when the steps still hash the same,
// that step is covered and its image on the list, and the run is the owner's own (never an agent's key or an agent's
// chat). Anything else asks as before: a changed step, another tag or digest, an input in the step, a workflow saved
// with no button or by an agent, an agent's run. A tag is a name: if it later points at another image, a
// Spark that already has the old one runs that copy (keep_running pulls only an image the Spark doesn't have), and a
// Spark that pulls gets what the tag names then; the owner pins one exactly by saving name@sha256:… .
const savedStepsHash = steps => createHash('sha256').update(JSON.stringify(steps)).digest('hex').slice(0, 16);
// A step the yes covers: keep_running from a literal image, with no {input} in any of its arguments (a run's input is on
// no button, the workloads review's A2), and its line on the button whole: nothing in it hidden as a key (A1).
const stepCovered = st => st?.action === 'keep_running' && typeof st.args?.image === 'string' && !placeholders(st.args).length && !stepLine(st).includes('[hidden]');
// The images a save's yes covers, and the steps naming an image that a run asks about all the same.
const savedImages = steps => [...new Set(steps.filter(stepCovered).map(st => st.args.image))];
const savedStepsAsked = steps => steps.map((st, i) => (st?.action === 'keep_running' && st.args?.image !== undefined && !stepCovered(st) ? i + 1 : 0)).filter(Boolean);
const TAG_WORDS = 'a tag is a name and can later point at another image (name@sha256:… pins one)';
// What the save button adds when its press would cover images: that runs then start them without asking again.
function savedImagesLabel(steps) {
  const images = Array.isArray(steps) ? savedImages(steps) : [];
  return images.length ? `. Pressing it is also your yes to ${images.join(', ')}: runs of exactly these steps start ${images.length > 1 ? 'them' : 'it'} without asking again, and ${TAG_WORDS}` : '';
}
// Whether this save is the owner's own yes to `images`: a pressed button that listed them (see above).
function savedImagesYes(viewer, ctx, images) {
  if (!images.length) return false;
  if (ctx.ownerConfirmed) return true;
  return Boolean(ctx.button) && ctx.via === 'page' && !viewer?.session && !viewer?.agentKey && !ctx.agent && !ctx.agentId;
}
// What the save's answer, and the chat line after its press, say of its images: those its yes covers, or that a run asks.
function savedImagesWords(images, asked, yes) {
  const one = list => list.length > 1 ? 'them' : 'it';
  return [...(images.length ? [yes ? `Your yes to this save covers ${images.join(', ')}: a run of exactly these steps starts ${one(images)} without asking again; ${TAG_WORDS}.`
    : `A run asks before it starts ${images.join(', ')}: only your yes to a save’s button, which lists its steps, covers the images ${one(images)} names.`] : []),
    ...(asked.length ? [`A run asks before ${asked.length > 1 ? 'steps' : 'step'} ${asked.join(', ')} ${asked.length > 1 ? 'start' : 'starts'} an image: a step that takes an input, or with part of it hidden as a key, isn’t covered by a yes.`] : [])].join(' ');
}
// The images step `st` of saved workflow `w` may start without asking, in a run by this caller: [] or [its image].
function stepImagesYes(w, st, viewer, ctx) {
  const a = w.approved, img = st.args?.image;
  if (!a || !stepCovered(st) || a.steps !== savedStepsHash(w.steps) || !a.images?.includes(img)) return [];
  return viewer?.agentKey || ctx.agent || ctx.agentId || !['page', 'api', 'sparkie'].includes(ctx.via) ? [] : [img];
}
