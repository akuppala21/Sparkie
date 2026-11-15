/* ───────── actions that change things: say it, and it's done (checked inside) ───────── */
// Area: core
// Rules: R1, R2, R3, R7, R8, R9, R12, R13, R15, R16, R17, R27, R35, R37, R38
// Tests: change.test.mjs, hub.test.mjs, pause.test.mjs, files.test.mjs
// Owns: agent-settings.json (writers: setAgentSettings)
// Timers: none        Wakes: none
// Sparkie, your agents (with "can change things" on their key) and the spark command all go through these, and each is
// checked the same way before anything happens:
//   1. inputs (checkInput)  2. a fresh plan, never the cached view  3. the rails below, in code  4. one change per Spark
//   (claimSparks)  5. inside the operation the plan is made again and has to match what was approved (deploy's stop
//   list), and a pause by the owner stops it there  6. memory is measured after the stops and 8 GB is always kept free
//   7. it has to answer before it counts  8. on failure, what was stopped is started again.
// It asks only when the request truly has two answers (a name matching several models; room that needs stopping
// something Spark Console didn't start; a repo that isn't in Recipes). The choices are kept here, for that person and
// that conversation, and used once. Sparkie can only use the one the owner's next message picks; an outside agent the
// owner allowed to change things answers with its own user's reply, on the owner's authority.
// Never actions, for anyone: SSH, Tailscale, firewall and network, users, keys and sudo, people and access, turning
// Spark Console off. Anything that could lock the owner out isn't something an agent can even ask for.
const HEADROOM = 8 * 2 ** 30;
const SETTINGS_FILE = `${STATE_DIR}/agent-settings.json`;
// The owner's two switches (Access → Agents): pause every agent's changes; restart crashed models by themselves.
function agentSettings() {
  const v = readJson(SETTINGS_FILE);
  // Unreadable (not just missing): treat it as paused, never as "go ahead".
  if (!v && existsSync(SETTINGS_FILE)) return { halted: true, selfHeal: false, unreadable: true };
  return { halted: false, selfHeal: true, ...(v || {}) };
}
function setAgentSettings(change) {
  // After an unreadable file the owner's choice starts from the defaults, not from the paused fallback.
  const now = agentSettings(), from = now.unreadable ? { halted: true, selfHeal: true } : now;
  const next = { ...from, ...change, changedAt: new Date().toISOString() };
  delete next.unreadable;
  writePrivate(SETTINGS_FILE, next);
  return next;
}
// (Self-healing goes on through the automatic pause for a looping agent, as in runAction; only the owner's own pause
// stops it. Without this its job failed at its first line and used up a try: audit, 2026-11-11.)
// Why nothing may stop: the owner said so, it is self-healing bringing something back (it never stops anything else), or
// it is the self-test (21-selftest.mjs).
const noStopWords = ctx => (ctx?.via === 'watcher' ? 'and self-healing never stops anything else to bring something back'
  : ctx?.selfTest ? 'and the self-test never stops anything' : 'and the owner said not to stop anything');
const pausedCheck = ctx => {
  const s = agentSettings();
  if (ctx?.via && ctx.via !== 'page' && s.halted && !(ctx.via === 'watcher' && s.autoPaused)) throw new Error('Stopped: agents’ changes are paused.');
};

// Questions and their choices. Each choice's arguments stay here; the caller only gets an id to answer with.
const pendingChoices = new Map();
// In a Sparkie conversation, choices belong to the conversation (whoever is in it presses them); elsewhere, to the caller.
const sparkieWho = (viewer, convId) => `${String(viewer?.login || '').toLowerCase()}|conv|${convId}`;
const whoAsks = (viewer, ctx) => (ctx.conv ? sparkieWho(viewer, ctx.conv) : `${viewer?.login || ''}|${ctx.via || ''}|${ctx.actor || ''}|${ctx.chat || ''}`);
// ownerOnly: only the owner answers it, from Spark Console (stopping something started outside it, or that answers
// Sparkie). An agent gets it as "ask the owner". During a validation run, follow-up choices carry it on.
// A validation run's choice is taken on purpose, by whoever asked (the owner, or an agent that may change things,
// v3.1): pressed or picked by its id, never by a typed "yes".
function question(viewer, ctx, text, choices, kind = 'question', { ownerOnly = false } = {}) {
  // An owner-only question asked of a direct call (an agent's tool call, POST /actions, a saved step): no conversation
  // shows its button and nobody else may answer it, so it hands back no choice ids. It says how the owner says yes.
  if (ownerOnly && !ctx.onQuestion && ctx.via !== 'page') {
    const yes = choices.find(c => c.call)?.label;
    return { outcome: 'question', question: text, choices: choices.slice(0, 4).map(c => ({ label: c.label, choice: null })),
      note: `Only the owner can answer this one, from Spark Console, and nothing was done. There’s no choice to send back: the owner asks Sparkie for it in their own chat there${yes ? ` (“${yes}”)` : ''} and presses the button it shows, or does it on the page. Tell them that.` };
  }
  if (ctx.validating) choices = choices.map(c => (c.call ? { ...c, call: { ...c.call, args: { ...c.call.args, __validate: ctx.validating } } } : c));
  const validation = choices.some(c => c.call?.args?.__validate);
  for (const [id, c] of pendingChoices) if (Date.now() - c.at > 15 * 60000) pendingChoices.delete(id);
  while (pendingChoices.size > 300) pendingChoices.delete(pendingChoices.keys().next().value);
  const group = randomBytes(4).toString('hex');
  // In a conversation every choice is a button, "No" too (it puts them away).
  const shown = choices.slice(0, 4).map(c => {
    if (!c.call && !ctx.conv) return { label: c.label, choice: null };
    const id = randomBytes(5).toString('hex');
    pendingChoices.set(id, { who: whoAsks(viewer, ctx), action: c.call?.action || null, args: c.call?.args || null, label: c.label, at: Date.now(), group, ownerOnly, validation });
    return { label: c.label, choice: id, ...(c.call ? { call: { action: c.call.action, args: { choice: id } } } : {}) };
  });
  const out = { outcome: kind === 'proposal' ? 'needs-ok' : 'question', question: text, choices: shown, group,
    note: ownerOnly ? 'Only the owner can answer this one, from Spark Console. Tell them what it asks; don’t answer it yourself.'
      : validation ? 'This change’s workflow hasn’t had its first run on the Sparks yet. If you were asked to make this change, run it as that first run: call the action again with only {"choice": "<id>"} of the "Yes, run it as its validation" choice. Otherwise leave it.'
        : 'Ask the owner this, in plain words, with these choices, and wait for their answer. Then call the action with only {"choice": "<id>"} of the one they pick. Don’t choose for them.' };
  if (ctx.onQuestion) ctx.onQuestion(out);
  // Sparkie gets the words, not the ids: the buttons run it.
  if (ctx.conv && ctx.via === 'sparkie') {
    return { outcome: out.outcome, question: text, buttons: shown.map(c => c.label),
      note: kind === 'proposal' ? 'Not done yet: it’s offered as a choice to take (a button on the page). Say in one short line what it would do, then stop. Don’t call it again.'
        : 'Offered as choices to take (buttons on the page). Ask this in plain words and stop.' };
  }
  return out;
}
// What a change does, in plain words, for its button.
function changeLabel(name, input) {
  const sp = id => sparkName(nodeById(id) || { id });
  const where = input.sparks ? ` across ${input.sparks.map(sp).join(' + ')}` : input.spark ? ` on ${sp(input.spark)}` : '';
  const what = input.model || input.container || 'it';
  // A saved workflow's button names it, and lists the steps it would save (16-actions.mjs pageOnlyLabel, F20).
  if (name === 'save_workflow' || name === 'forget_workflow') return pageOnlyLabel(name, input);
  // A memory button says the line it would keep or drop. (Labels are saved in chats.json: a key in the line, or in a saved
  // workflow's value, is hidden before the cut, A-5, 2026-11-14.)
  if (name === 'remember') return `Remember: “${maskSecrets(String(input.text || '')).slice(0, 200)}”`;
  if (name === 'forget_memory') return `${input.erase ? 'Erase for good' : 'Forget'}: “${String(memoryText(input.id) || 'that line').slice(0, 200)}”`;
  if (name === 'run_workflow') {
    const given = Object.entries(input.inputs || {}).map(([k, v]) => `${k} ${maskSecrets(String(v)).slice(0, 60)}`);
    return `Run the saved workflow “${String(findSaved(String(input.name || ''))?.title || input.name || '').slice(0, 80)}”${given.length ? ` with ${given.join(', ')}` : ''}`;
  }
  if (name === 'keep_running') {
    const c = String(input.container || 'it').slice(0, 80);
    if (input.do === 'restart') return `Restart ${c}${where}`;
    if (input.do === 'stop') return `Stop ${c}${where} and take it off the list of what should be running`;
    if (!input.image) return `Keep ${c} running${where}`;
    const [host, inside = host] = String(input.port || '').split(':');
    // (A13: the GPU, its memory figure, the whole command, and for a job where its files go; the command's words are
    // masked one by one, so code-server's "--auth none" reads as typed; a known dev box's no-sign-in words when none is said)
    const words = appCommand(input), cmd = words.length ? `, running ${commandWords(words).join(' ')}` : '';
    const how = `${cmd}${input.gpu ? ', with the GPU' : ''}${input.memoryGB ? `, up to ${input.memoryGB} GB` : ''}`;
    const port = input.port ? `, opened at port ${host}${inside !== host ? ` (the app’s ${inside})` : ''}` : '';
    const rest = maskSecrets(`${input.volumes?.length ? `, keeping its data in ${input.volumes.join(', ')}` : ''}${input.env?.length ? `, with ${input.env.join(', ')}` : ''}`);
    const open = devBox(input) ? `. ${DEV_BOX_WORDS.replace(/\.$/, '')}` : '';
    if (input.once) return `Run ${c}${where} once from the image ${maskSecrets(input.image)}${how}${port}${rest}; its files go to jobs/${c} in the shared folder${open}`;
    return `Start ${c}${where} from the image ${maskSecrets(input.image)}${how}${port}${rest}, and keep it running${open}`;
  }
  // Turning Sparks off or on, and the idle time (21-power.mjs): the Sparks by name.
  const sparksSaid = [input.spark, ...(input.sparks || [])].filter(Boolean).map(sp).join(' and ');
  if (name === 'power_off') return `Power off ${sparksSaid || 'a Spark'} (its models are parked first)`;
  if (name === 'power_on') return `Turn on ${sparksSaid || 'a Spark'}`;
  if (name === 'power_settings') return input.idleMinutes ? `Power off idle Sparks after ${input.idleMinutes} minute${input.idleMinutes === 1 ? '' : 's'}` : 'Stop powering off idle Sparks';
  // (the self-test: what it runs is fixed by code; the button says where, and that it stops nothing)
  if (name === 'self_test') return `Run the self-test${where || ' on a compute Spark that is free'}: a small model with the healing drill, a web page and a job with the GPU, stopping nothing`;
  // (a button shows all it would do: never cut, keys masked)
  if (name === 'save_file') return `Save ${String(input.path || 'a file')} in the shared folder${where} (${sizeWords(Buffer.byteLength(String(input.text ?? '')))})`;
  return `${{ start_model: 'Start', stop_model: 'Stop', restart_model: 'Restart' }[name] || name} ${what}${where}${input.setup ? ` with recipe setup ${input.setup}` : ''}`;
}
// A change Sparkie suggests but wasn't clearly asked for: one button, which runs exactly this when pressed.
function propose(viewer, ctx, name, input) {
  const label = `${changeLabel(name, input)}${input.__validate ? ' (its first run, which validates it)' : ''}`;
  return question(viewer, ctx, `${label}?`, [{ label, call: { action: name, args: input } }], 'proposal');
}
function redeemChoice(viewer, ctx, action, id) {
  const c = pendingChoices.get(id);
  if (!c || c.action !== action || c.who !== whoAsks(viewer, ctx) || Date.now() - c.at > 15 * 60000) {
    throw new HttpError(409, 'That choice has expired or belongs to someone else. Ask again.');
  }
  if (c.ownerOnly && ctx.via !== 'page') throw new HttpError(403, 'Only the owner can answer this one, from Spark Console.');
  pendingChoices.delete(id);
  return c.args;
}
// Sparks whose Spark Console model answers Sparkie's chats or apps: stopping it there is the owner's call.
const routedSparks = () => new Set([ROUTES.chat, ROUTES.agents].filter(r => r?.kind === 'endpoint' && r.node).map(r => r.node));

// The rails for one Spark's part of a plan: what it would stop, and whether there's room to spare.
function railsFor(p, f, allowStop) {
  const at = sparkName(nodeById(p.node) || { id: p.node });
  if (f.error) return { ok: false, why: f.error };
  if (f.unknown) return { ok: false, why: `free memory on ${at} is unknown right now, so it can’t be checked` };
  if (!f.fits) return { ok: false, why: `not enough memory on ${at}, even stopping what can stop` };
  const steps = new Map(p.steps.filter(s => s.kind === 'stop').map(s => [s.container, s]));
  // A model running across two Sparks only stops on purpose (stop_model), never as a side effect: its partner isn't claimed.
  const paired = f.stop.filter(c => steps.get(c)?.group);
  if (paired.length) return { ok: false, why: `${paired.join(', ')} on ${at} runs across two Sparks; stop it first (stop_model) if that’s what the owner wants` };
  const outside = f.stop.filter(c => !steps.get(c)?.required && !allowStop.includes(c));
  // (a GPU app or job holds the GPU, A13: asked about in its own words)
  const held = outside.filter(c => steps.get(c)?.hold), others = outside.filter(c => !steps.get(c)?.hold);
  if (outside.length) {
    return { ok: false, ask: 'outside', containers: outside, why: [held.length ? `${held.join(', ')} ${held.length > 1 ? 'have' : 'has'} ${at}’s GPU to itself` : null,
      others.length ? `${at} only has room if ${others.join(', ')} (not started by Spark Console) stops` : null].filter(Boolean).join('; ') };
  }
  const routed = routedSparks().has(p.node) ? f.stop.filter(c => steps.get(c)?.required && !allowStop.includes(c)) : [];
  if (routed.length) return { ok: false, ask: 'routed', containers: routed, why: `${routed.join(', ')} on ${at} answers Sparkie’s chats or apps` };
  if (f.spare < HEADROOM) return { ok: false, why: `it would leave less than 8 GB free on ${at}` };
  return { ok: true, stop: f.stop, keep: [...steps.keys()].filter(c => !f.stop.includes(c)) };
}
// What a model on disk would run with, from its own spark.json: for an agent's start it has to be as safe as a recipe.
const inRecipes = m => recipeCatalog().models.some(r => r.variants.some(v => onDiskAs(m, v.repo)));
function agentSafeSetup(m) {
  const args = Array.isArray(m.manifest?.args) ? m.manifest.args.map(String) : [];
  const own = args.filter(a => a.startsWith('-') && dig.OWN.has(dig.flagKey(a.split('=')[0])));
  if (own.length) return `its spark.json sets flags Spark Console sets itself (${own.join(', ')}); the owner can start it from Deploy`;
  if (dig.remoteCode(args)) return `it needs to run its own code, which only the owner can allow, from Spark Console’s Deploy`;
  const flags = dig.cleanFlags(args, m.repo || m.name);
  if (flags.problems.length) return `its spark.json ${flags.problems[0]}; the owner can start it from Deploy`;
  const env = { ...(m.manifest?.env || {}), ...(m.manifest?.cluster?.env || {}) }, cleaned = dig.cleanEnv(env);
  const dropped = Object.keys(env).filter(k => !(k in cleaned));
  if (dropped.length) return `its spark.json sets ${dropped.join(', ')}; the owner can start it from Deploy`;
  const image = m.manifest?.image;
  if (image && !(String(image).includes('@sha256:') && (CONFIG.imageSources || []).some(p => String(image).startsWith(p)))) {
    return `its spark.json names its own image (${image}), which isn’t from a trusted source pinned by digest; the owner can start it from Deploy`;
  }
  return null;
}

// Where a model on disk goes: the Spark asked for, the pair asked for, or the best place with room. Spark Console's own
// Spark (Sparkie and the console run there) is never used (docs/contract.md 8.3).
async function placeModel(m, inv, viewer, { spark, sparks, allowStop = [], noStops = false }) {
  // Parts of a model across two Sparks run with more privileges (for the direct cable), so only models from Recipes.
  if (sparks && !inRecipes(m)) return { ok: false, why: `${m.repo || m.name} isn’t in Recipes, and only models from Recipes run across two Sparks` };
  if (sparks) {
    const link = (lastCheck?.pairs || []).find(p => sparks.includes(p.a) && sparks.includes(p.b))?.fastLink || 'not tested';
    if (link !== 'full') return { ok: false, why: `the ${sparks.join('–')} cable is “${link}”; it has to pass the connection test first (Clusters → Test connections)` };
    const cp = await clusterPlan(m.name, sparks, viewer, inv);
    const parts = cp.members.map(x => ({ x, r: railsFor({ node: x.node, steps: x.steps }, { fits: x.fits, stop: x.stop, spare: x.spare, unknown: !Number.isFinite(x.memory.available) }, allowStop) }));
    const bad = parts.find(y => !y.r.ok);
    // (a question carries the pair, so its Yes starts the same two, F11)
    if (bad) return { ...bad.r, node: bad.x.node, two: true, nodes: cp.nodes };
    return { ok: true, nodes: cp.nodes, two: true, stop: parts.flatMap(y => y.r.stop.map(c => `${y.x.node}/${c}`)), keep: [...new Set(parts.flatMap(y => y.r.keep))], endpoint: cp.endpoint };
  }
  if (spark) {
    const p = await plan(m.name, spark, viewer, inv), r = railsFor(p, fitOf(p), allowStop);
    return r.ok ? { ok: true, nodes: [spark], two: false, stop: r.stop.map(c => `${spark}/${c}`), keep: r.keep, endpoint: p.endpoint } : { ...r, node: spark };
  }
  const all = await plansFor(m.name, viewer, inv, new Map()), compute = computeSparks();
  const tried = all.sparks.filter(f => compute.includes(f.node)).map(f => ({ f, r: f.error ? { ok: false, why: f.error } : railsFor(f.plan, f, allowStop) }));
  // When nothing may stop ("don't stop anything", or a start on call), a Spark with room as it is comes first.
  const one = (noStops && tried.find(t => t.r.ok && !t.r.stop.length)) || tried.find(t => t.r.ok);
  if (one) return { ok: true, nodes: [one.f.node], two: false, stop: one.r.stop.map(c => `${one.f.node}/${c}`), keep: one.r.keep, endpoint: one.f.plan.endpoint };
  // A pair that only needs the owner's yes (something started outside Spark Console holds one side) is asked about
  // when no single Spark can ask (F11).
  let pairAsk = null;
  for (const pr of inRecipes(m) ? all.pairs.filter(x => x.fits && x.nodes.every(id => compute.includes(id))) : []) {
    const two = await placeModel(m, inv, viewer, { sparks: pr.nodes, allowStop });
    if (two.ok) return two;
    if (two.ask) pairAsk ||= two;
  }
  const askable = tried.find(t => t.r.ask);
  if (askable) return { ...askable.r, node: askable.f.node };
  if (pairAsk) return pairAsk;
  const hub = brainSparks();
  return { ok: false, why: `${tried.map(t => t.r.why).filter(Boolean).join('; ') || 'no other Spark has room'}${hub.length ? ` (${hub.join(' and ')} ${hub.length > 1 ? 'are' : 'is'} Sparkie’s, so nothing else starts there)` : ''}` };
}

// The setup to run it with: the fastest run that worked here before, else the best one-click setup, else defaults.
function bestHow(m, sparks, viewer, library) {
  const runs = verifiedList().filter(v => (v.model === m.name || (m.repo && sameRepo(v.repo, m.repo))) && v.sparks === sparks && (v.source !== 'seen' || v.approved === true))
    .sort((a, b) => (b.best?.decodeTokS || 0) - (a.best?.decodeTokS || 0));
  const setups = recipeCatalog().models.flatMap(r => r.setups || []).filter(s => s.deployable !== false && s.sparks === sparks && m.repo && sameRepo(s.repo, m.repo) && s.source?.kind !== 'forum')
    .sort((a, b) => (CREDIBILITY[a.credibility] ?? 3) - (CREDIBILITY[b.credibility] ?? 3) || (b.perf?.decodeTokS || 0) - (a.perf?.decodeTokS || 0));
  const tryHow = body => { try { const how = resolveHow(body, viewer, m.name, sparks, library); return how && !dig.remoteCode(how.args) ? how : null; } catch { return null; } };
  // Ordinary runs first; then the brain's proven run, made ordinary (its draft model and stretched context are Spark
  // 2's); then Recipes' one-click setups. The brain runs on one Spark; across two, the same engine and settings split
  // the model over the cable (the start adds its own two-Spark flags), which beats the engine's defaults: those
  // couldn't start the brain's hybrid Qwen at all (2026-11-08).
  for (const v of runs.filter(x => !x.brain && !needsDraftModel(x.args || []))) { const how = tryHow({ verified: v.key }); if (how) return how; }
  const brainRuns = sparks === 1 ? runs : verifiedList().filter(v => (v.model === m.name || (m.repo && sameRepo(v.repo, m.repo))) && v.sparks === 1 && (v.source !== 'seen' || v.approved === true)
    && ['sglang', 'vllm'].includes(v.engine)).sort((a, b) => (b.best?.decodeTokS || 0) - (a.best?.decodeTokS || 0));
  for (const v of brainRuns.filter(x => x.brain || needsDraftModel(x.args || []))) { const how = plainFromBrain(v, m, viewer); if (how) return how; }
  for (const s of setups) { const how = tryHow({ setup: s.id }); if (how) return how; }
  return null;
}

// Starts the model where placed; if it fails, stops the new parts and starts again what it stopped.
async function deployPlaced(job, viewer, ctx, m, placed, how) {
  pausedCheck(ctx);
  job.checkPause = () => { cancelCheck(job); pausedCheck(ctx); };
  await startWithFixes(job, m, placed, how, (h, fix) => (placed.two
    ? clusterDeploy(job, m.name, placed.nodes, viewer, placed.keep, h, placed.stop, fix)
    : deploy(job, m.name, placed.nodes[0], viewer, placed.keep, h, placed.stop, fix)));
}

// What can go wrong starting a model: how to tell (from the error and the last lines of its log), the fix to try
// (next() gives the next attempt's settings, or null when there's nothing more to try), and what to do when it's out
// of fixes.
const START_FAILURES = [
  // First: its message carries the parts' logs, which another problem's signs could match.
  // Two Sparks whose connection check passed, but whose engines never connected (2026-11-10, Spark 3 + 4: both parts sat
  // at "Init parallel begin.", in Gloo's setup). Found by the engine check before the start, or by the stall check.
  // NCCL stuck with RoCE on: plain sockets on the same cable are slower but don't need RoCE. Stuck in Gloo (torch's
  // plain-TCP setup), no NCCL setting helps, so there's no second try.
  { id: 'never-connected', title: 'the two parts never connected to each other',
    sign: /didn’t connect to each other over the cable within|couldn’t connect their engines over the cable/,
    fix: 'Starting it again with NCCL over plain sockets on the cable instead of RoCE (slower, but it doesn’t need RoCE).',
    advice: 'The lines below say which step each part was stuck at: Gloo (torch’s plain-TCP setup) or NCCL (the GPUs’ link), in its own words.',
    next: ({ fix, message }) => (!fix.sockets && /with NCCL over RoCE/.test(message) && !/stuck in Gloo/.test(message) ? { fix: { ...fix, sockets: true } } : null) },
  { id: 'memory-share', title: 'the engine saw less free memory than its memory share',
    sign: /Free memory on device[^\n]{0,200}less than desired GPU memory utilization|Not enough memory\. Please try to increase --mem-fraction-static/i,
    advice: 'On GB10, memory the system caches can count as used: free some (stop a model, or drop caches), or start it with a smaller memory share.', next: () => null },
  { id: 'garbage', title: 'it loaded but answers only garbage',
    sign: /answers only garbage/,
    advice: 'Known on GB10 with some NVFP4 builds: another image of the engine, or its Marlin backend, usually fixes it.', next: () => null },
  { id: 'out-of-memory', title: 'it ran out of memory while loading',
    sign: /out of memory|OutOfMemoryError|cudaMalloc|insufficient memory|not enough (?:GPU )?memory|no available memory for the cache blocks|larger than the maximum number of tokens that can be stored in KV cache|KV cache[^\n]{0,80}(?:insufficient|too small|exceed)|(?:max_model_len|max_seq_len|context.length)[^\n]{0,80}(?:larger|greater|exceed)/i,
    fix: 'Starting it with a shorter context (32,768 tokens, then 8,192).',
    advice: 'Even a short context didn’t fit: it needs a Spark with more free memory, or a smaller version of the model.',
    next: ({ fix }) => (!fix.contextCap ? { fix: { ...fix, contextCap: 32768 } } : fix.contextCap > 8192 ? { fix: { ...fix, contextCap: 8192 } } : null) },
  { id: 'bad-flag', title: 'the engine didn’t accept one of the settings',
    sign: /unrecognized arguments|no such option|error: argument|invalid choice|unexpected keyword argument|unknown (?:argument|option)/i,
    fix: 'Starting it again without the setting the engine rejected (the rest of the setup stays).',
    advice: 'The log below names the setting; take it out of the recipe, or try another version of the engine.',
    next: ({ fix, message }) => {
      const drop = rejectedFlags(message).filter(f => !(fix.dropFlags || []).includes(f) && !dig.OWN.has(dig.flagKey(f)));
      return drop.length ? { fix: { ...fix, dropFlags: [...(fix.dropFlags || []), ...drop] } } : null;
    } },
  { id: 'image', title: 'the engine’s image couldn’t be downloaded',
    sign: /Image download (?:on \S+ )?failed[^\n]*(?:pull access denied|TLS handshake timeout|connection reset by peer|i\/o timeout|EOF|503|502|unexpected)/i,
    fix: 'Trying the download once more (it’s often a passing network problem).',
    advice: 'Check that Spark’s internet connection, and the image name in the recipe.',
    next: ({ fix, tried }) => (tried.filter(t => t === 'image').length > 1 ? null : { fix }) },
  { id: 'gated', title: 'the model needs a Hugging Face sign-in or license',
    sign: /is gated|gated repo|401 Client Error|Access to model [^\n]{0,120} is restricted|accept the (?:license|conditions)/i,
    advice: 'On that Spark, run hf auth login and accept the model’s license on Hugging Face, then ask again.', next: () => null },
  { id: 'port-busy', title: 'another program holds the model port',
    advice: 'Something outside Spark Console uses that port: stop it, or start the model on another Spark.',
    sign: /port is already allocated|address already in use/i, next: () => null },
  { id: 'no-answer', title: 'it loaded but didn’t answer a test prompt',
    sign: /didn’t answer a test prompt/,
    advice: 'Its log (container_logs) usually says why: often a missing chat template, or an engine that doesn’t suit it.', next: () => null },
];
const knownStartFailure = message => START_FAILURES.find(f => f.sign.test(String(message || ''))) || null;
// The lines of a long log that name a known problem (engines often print the real cause well above their last lines),
// to put first in the error so it's seen and recognised.
function causeLines(log) {
  const lines = String(log || '').split('\n'), hits = [];
  for (const l of lines) if (START_FAILURES.some(f => f.id !== 'no-answer' && f.sign.test(l)) && !hits.includes(l)) hits.push(l.slice(0, 400));
  return hits.length ? `${hits.slice(-5).join('\n')}\n…\n` : '';
}
// The flags an engine named as not accepted ("unrecognized arguments: --foo 1 --bar"), as flag names.
const rejectedFlags = message => [...new Set([...String(message || '').matchAll(/unrecognized arguments: ([^\n]+)/g)].flatMap(m => m[1].split(/\s+/).filter(a => a.startsWith('-')).map(a => a.split('=')[0])))];
// A model's setup without the flags a fix took out.
const withoutRejected = (model, fix = {}) => (model && fix.dropFlags?.length && Array.isArray(model.manifest?.args)
  ? { ...model, manifest: { ...model.manifest, args: withoutFlags(model.manifest.args.map(String), fix.dropFlags) } } : model);
// Args without the named flags (and the value after each, when it has one).
function withoutFlags(args, names) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]);
    if (names.includes(a.split('=')[0])) { if (!a.includes('=') && args[i + 1] != null && !String(args[i + 1]).startsWith('-')) i++; continue; }
    out.push(a);
  }
  return out;
}
// The flags a fix adds: a shorter context (never longer than the setup's own).
function fixFlags(model, fix = {}) {
  const flag = ENGINES[engineOf(model)]?.ctxFlag;
  if (!fix.contextCap || !flag) return [];
  const args = Array.isArray(model.manifest?.args) ? model.manifest.args.map(String) : [];
  const own = shareIn(args, flag) ?? (flag === '-c' ? shareIn(args, '--ctx-size') : null);
  return [flag, String(own != null && own < fix.contextCap ? own : fix.contextCap)];
}
// A start with the workflow's known fixes: when it fails in a known way that has a fix, it tries again with that fix,
// up to 3 attempts in all and not after 30 minutes. Then whatever was stopped to make room is put back.
const FIX_WINDOW_MS = Number(process.env.SPARK_CONSOLE_FIX_WINDOW_MS || 30 * 60000);
async function startWithFixes(job, m, placed, how, attempt) {
  const began = Date.now(), tried = [];
  let fix = {};
  for (let n = 1; ; n++) {
    try {
      await attempt(how, fix);
      if (tried.length) {
        const gaveUp = [fix.contextCap ? `a context of ${fix.contextCap.toLocaleString('en-US')} tokens` : null,
          fix.dropFlags?.length ? `without ${fix.dropFlags.join(', ')}` : null, fix.sockets ? 'NCCL over plain sockets on the cable instead of RoCE' : null].filter(Boolean).join(', ');
        job.fixed = { problems: tried, gaveUp: gaveUp || null };
        note(job, `Started after fixing: ${tried.map(id => START_FAILURES.find(f => f.id === id)?.title || id).join('; ')}${gaveUp ? ` (it runs with ${gaveUp})` : ''}`);
      }
      return;
    } catch (e) {
      // Cancelled: put back what this did, and stop there (no fix to try).
      if (job.cancelled) { await putBack(job, m, placed); throw Object.assign(new Error(`Cancelled by ${job.cancelled}. What it had changed was put back.`), { cancelled: true }); }
      const known = knownStartFailure(e.message);
      if (known) tried.push(known.id);
      const next = known && n < 3 && Date.now() - began < FIX_WINDOW_MS ? known.next({ fix, how, tried, message: e.message }) : null;
      if (!next) {
        await putBack(job, m, placed);
        if (!known && n > 1) throw new Error(`It didn’t start after ${n} attempts (it fixed ${tried.map(id => START_FAILURES.find(f => f.id === id)?.title || id).join('; ')}, then failed another way): ${e.message}`);
        if (!known) throw e;
        throw new Error(`It didn’t start: ${known.title}${n > 1 ? ` (${n} attempts)` : ''}. ${known.advice}\n${e.message}`);
      }
      // What the failed attempt said (its first line), kept: the next attempt replaces its containers and their logs.
      note(job, `Attempt ${n}: ${String(e.message).split('\n')[0].slice(0, 600)}`);
      note(job, `Known problem: ${known.title}. ${known.fix} (attempt ${n + 1} of 3)`);
      fix = next.fix || fix;
      if ('how' in next) how = next.how;
    }
  }
}
function launch(viewer, ctx, m, placed, how) {
  const ids = placed.nodes, title = m.repo || m.name;
  const job = claimed(ids, `starting ${title}`, () => newJob(placed.two ? 'deploy-cluster' : 'deploy', {
    model: m.name, node: ids[0], ...(placed.two ? { nodes: ids } : {}), by: viewer.login, actor: ctx.actor || null, via: ctx.via || null,
    request: ctx.request ? String(ctx.request).slice(0, 300) : null, setup: how?.setupId || null, stops: placed.stop || [] }));
  runJob(job, j => deployPlaced(j, viewer, ctx, m, placed, how));
  return job;
}
async function putBack(job, m, placed) {
  step(job, 'It didn’t start, so putting back what was there');
  // Only what this operation did (not what it planned): the containers it started are stopped again, and the ones it
  // stopped are started again.
  const ran = [...new Set(job.ranHere || [])], stopped = [...new Set(job.stoppedHere || [])].filter(x => !ran.includes(x));
  for (const x of ran) consoleStopped.set(x, Date.now());
  await Promise.all(ran.map(x => { const [id, c] = x.split('/'); return run(nodeById(id), `docker stop --time 20 ${q(c)} >/dev/null 2>&1; true`, { timeout: 90000 }); }));
  for (const x of stopped) {
    const [id, container] = x.split('/');
    consoleStopped.delete(x);
    const r = await run(nodeById(id), `docker start ${q(container)} >/dev/null 2>&1`, { timeout: 90000 });
    note(job, r.code ? `Couldn’t start ${container} on ${id} again; start it from Spark Console.` : `Started ${container} on ${id} again`);
  }
  job.ranHere = []; job.stoppedHere = [];
}

// Turning a name into one model: on disk, a recipe, a Hugging Face repo, or a question when it could be several.
async function resolveModelName(name, inv) {
  const q0 = String(name).trim(), lib = libraryModel(inv, q0);
  if (lib) return { lib };
  const cat = recipeCatalog().models;
  const recipe = cat.find(x => x.id === q0) || cat.find(x => x.variants.some(v => sameRepo(v.repo, q0)));
  if (recipe) return { recipe, repo: recipe.variants.find(v => sameRepo(v.repo, q0))?.repo || null };
  if (REPO_RE.test(q0)) {
    const v = await versionOf(q0).catch(() => null);
    if (v) return { recipe: { id: null, title: v.repo, variants: [v] }, repo: v.repo, outsideRecipes: true };
    throw new HttpError(404, `${q0} isn’t a model Hugging Face knows (or it has no safetensors or GGUF weights).`);
  }
  const words = q0.toLowerCase().split(/\s+/).filter(Boolean).map(wordStart);
  const onDisk = inv.library.filter(m => m.role !== 'draft' && words.every(re => re.test(`${m.name} ${m.repo || ''} ${m.manifest?.title || ''}`.toLowerCase())));
  const recipes = cat.filter(m => words.every(re => re.test([m.id, m.title, m.family, ...m.variants.map(v => v.repo)].join(' ').toLowerCase()))).sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
  const onDiskRecipes = recipes.filter(r => inv.library.some(m => r.variants.some(v => onDiskAs(m, v.repo))));
  if (onDisk.length === 1) return { lib: onDisk[0] };
  if (!onDisk.length && recipes.length === 1) return { recipe: recipes[0] };
  if (!onDisk.length && onDiskRecipes.length === 1) return { lib: inv.library.find(m => onDiskRecipes[0].variants.some(v => onDiskAs(m, v.repo))) };
  const choices = [...onDisk.map(m => ({ label: `${m.repo || m.name} (on ${m.copies.map(id => sparkName(nodeById(id) || { id })).join(', ')})`, model: m.name })),
    ...recipes.filter(r => !onDisk.some(m => r.variants.some(v => onDiskAs(m, v.repo)))).map(r => ({ label: `${r.title} (recipe, downloads first)`, model: r.id }))];
  if (!choices.length) throw new HttpError(404, `No model on disk or in the recipes matches “${q0}”. Try find_recipes or search_huggingface, then start it by its repo.`);
  return { choices };
}

// For a model not on disk yet: the version to download (best quantization that fits now), and where. Spark Console's own
// Spark isn't chosen; a repo from outside Recipes only goes on one Spark.
async function pickVersion(recipe, repo, viewer, outside, only = null) {
  const status = await statusFor(viewer, false);
  const online = status.nodes.filter(n => n.state === 'online' && canUse(viewer, n.id) && (only ? only.includes(n.id) : computeSparks().includes(n.id)));
  const free = id => gbOfGiB(online.find(n => n.id === id)?.memoryFreeGiB) ?? 0, disk = id => gbOfGiB(online.find(n => n.id === id)?.diskFreeGiB) ?? 0;
  const pairs = (lastCheck?.pairs || []).filter(p => p.fastLink === 'full' && online.some(n => n.id === p.a) && online.some(n => n.id === p.b));
  const versions = recipe.variants.filter(v => (!repo || sameRepo(v.repo, repo)) && v.needGB != null && v.sizeGB != null && (v.sparks ?? 1) <= (outside ? 1 : 2))
    .sort((a, b) => (QUANT_ORDER.indexOf(a.quant) + 1 || 99) - (QUANT_ORDER.indexOf(b.quant) + 1 || 99) || a.needGB - b.needGB);
  const order = ids => [...ids].sort((a, b) => free(b) - free(a));
  for (const v of versions) {
    if ((v.sparks ?? 1) === 1 && (!only || only.length === 1)) {
      const node = order(online.map(n => n.id)).find(id => free(id) >= v.needGB + 8 && disk(id) >= v.sizeGB * 1.1 + 20);
      if (node) return { version: v, nodes: [node], two: false };
    } else if ((v.sparks ?? 1) === 2 && (!only || only.length === 2)) {
      const pair = pairs.find(p => [p.a, p.b].every(id => free(id) >= v.needGB / 2 + 12) && disk(p.a) >= v.sizeGB * 1.1 + 20);
      if (pair) return { version: v, nodes: [pair.a, pair.b], two: true };
    }
  }
  return null;
}

// A start of this model already under way: asking again (say, after a timeout) gets that operation, not a second copy.
function startingNow(names, where = null) {
  const want = new Set(names.filter(Boolean).map(s => String(s).toLowerCase()));
  return [...jobs.values()].find(j => j.status === 'running' && ['deploy', 'deploy-cluster', 'start-model', 'power-on'].includes(j.type) && !j.handedOver && want.has(String(j.model || '').toLowerCase())
    && (!where?.length || where.every(id => (j.nodes || [j.node]).includes(id))));
}
const alreadyStarting = (j, model) => ({ outcome: 'already-starting', operation: j.id, model, sparks: j.nodes || [j.node], step: j.step,
  note: 'It’s already being started; nothing new was done.', next: `wait_operation {"id":"${j.id}"} to follow it.` });
// Sparkie's Spark (Spark 2) is the brain's: no other workload starts there, named or not (docs/contract.md 8.3).
// The brain's Spark: where Sparkie's model runs, and the one Spark Console itself runs on.
function brainSparks() { return [...new Set([MAIN?.node, NODES.find(n => n.host === 'local')?.id].filter(Boolean))]; }
// The compute Sparks: every Spark on the list but the hub (the brain's and the console's own). Placement that names no
// Spark only ever picks among these (R1), so nothing lands on the console's Spark even while the brain runs elsewhere.
function computeSparks() { const hub = brainSparks(); return NODES.map(n => n.id).filter(id => !hub.includes(id)); }
function notBrainsSpark(ids) {
  for (const brain of brainSparks()) {
    if (ids.includes(brain)) throw new HttpError(403, `${sparkName(nodeById(brain) || { id: brain })} is Sparkie’s (the brain’s), so no other workload starts there. Pick another Spark.`);
  }
}
// When Spark Console places a start across two Sparks itself (none were named), it's the across-Sparks workflow, with
// its own state: untested is refused, and not yet validated is refused unless this is its validation run.
function acrossGate(two, args, ctx, what) {
  if (!two || ctx.workflow !== 'start_model') return null;
  const st = workflowStatus('start_model_across');
  if (st.state === 'untested') throw new HttpError(409, offMessage(st));
  if (st.state === 'needs-validation' && args.__validate !== 'start_model_across' && !(ctx.via === 'sparkie' && ctx.auto === true)) {
    throw new HttpError(409, `${what} only fits across two Sparks, and “${st.title}” hasn’t been validated on these Sparks yet. The owner can ask to start it across two named Sparks, which runs that validation.`);
  }
  return { workflow: 'start_model_across', workflowVersion: st.version };
}
// Does this model already run where a start names it? One Spark named: a one-Spark copy of it runs there. Two named:
// both parts of one pair run on exactly those two, named in either order. Anything else (another Spark, one part down,
// a pair when one Spark was named) is not "already": the start is judged as before (F10).
function runsWhereNamed(inv, name, spark, sparks) {
  const on = id => inv.sparks.find(sp => sp.id === id)?.deployments.filter(d => d.model === name && d.state === 'running') || [];
  if (spark) return on(spark).some(d => !d.cluster);
  if (!Array.isArray(sparks)) return false;
  const thisPair = d => { const ids = String(d.cluster || '').split('+'); return ids.length === sparks.length && sparks.every(id => ids.includes(id)); };
  return sparks.every(id => on(id).some(thisPair));
}
// The asker's own words name this Hugging Face repo in full: the owner's message to Sparkie, the owner's own
// POST /actions call, or the label of a button they pressed. An agent's direct call carries no words, so it is asked.
const namedInFull = (ctx, repo) => Boolean(repo) && String(ctx.said || ctx.request || '').toLowerCase().includes(String(repo).toLowerCase());
async function startModel(args, viewer, ctx) {
  if (args.spark && args.sparks) throw new HttpError(400, 'Give spark or sparks, not both.');
  // A model parked when Spark Console powered its Spark off (21-power.mjs) starts where it ran, unless another place was
  // named; a Spark Spark Console powered off is turned on first, in the same operation (contract 9.22).
  const parkedAt = !args.spark && !args.sparks ? parkedFor(args.model) : null;
  if (parkedAt) args = { ...args, model: parkedAt.model, ...(parkedAt.sparks ? { sparks: parkedAt.sparks } : { spark: parkedAt.spark }) };
  const { model, spark, sparks, setup, allowStop = [], confirmOutside = false } = args;
  // (why no Spark Spark Console powered off was turned on for a start that fits nowhere, for its answer: wakeOne, D5)
  const notWoken = [];
  notBrainsSpark([spark, ...(sparks || [])]);
  for (const id of [spark, ...(sparks || [])].filter(Boolean)) mustUse(viewer, [id]);
  if (!ctx.poweredOn) {
    // (a Spark being turned on for this very model: that operation, not a second one)
    const early = [...jobs.values()].find(j => j.status === 'running' && j.type === 'power-on' && !j.handedOver && String(j.model || '').toLowerCase() === String(model).toLowerCase());
    if (early) return alreadyStarting(early, model);
    const first = powerFirst(args, viewer, ctx);
    if (first) return first;
  }
  const inv = await inventory(null);
  let found;
  try { found = await resolveModelName(model, inv); } catch (e) {
    // (what's on a Spark Spark Console powered off isn't seen until it's on: said, so the owner knows where to look)
    const off = Object.keys(powerState().off).filter(id => nodeById(id));
    if (e.status === 404 && off.length) throw new HttpError(404, `${e.message} ${sparksWords(off)} ${off.length > 1 ? 'are' : 'is'} powered off by Spark Console, so what’s on ${off.length > 1 ? 'their disks' : 'its disk'} can’t be seen now: turn ${off.length > 1 ? 'them' : 'it'} on to look there.`);
    throw e;
  }
  // Not on any Spark that is on, with a Spark Spark Console powered off whose record lists it (or has no list): its files
  // are there, so that one Spark is turned on first, before anything is downloaded or stopped (wakeOne, D5). One whose
  // record doesn't list it isn't woken here: the download goes to a Spark that is on, or, when none has room, below.
  if (!found.lib && !found.choices && !ctx.poweredOn) {
    const first = powerFirst(args, viewer, ctx, 'all', wakeNames(model, found));
    if (first) return first;
  }
  if (found.choices) {
    return question(viewer, ctx, `“${model}” could be several models. Which one?`, found.choices.map(c => ({ label: c.label, call: { action: 'start_model', args: { model: c.model, ...(spark ? { spark } : {}), ...(sparks ? { sparks } : {}) } } })));
  }
  if (found.lib) {
    const m = found.lib, running = inv.sparks.flatMap(sp => sp.deployments.filter(d => d.model === m.name && d.state === 'running' && !d.rank).map(d => ({ spark: sp.id, endpoint: d.endpoint })));
    const going = startingNow([m.name, m.repo], spark ? [spark] : sparks);
    if (going) return alreadyStarting(going, m.repo || m.name);
    // Already running: anywhere when no Spark was named, or exactly where the request names it. (A start that names a
    // setup and a place goes on as before: which setup the running copy uses isn't known here.)
    const there = !setup && runsWhereNamed(inv, m.name, spark, sparks);
    if (running.length && ((!spark && !sparks) || there)) {
      return { outcome: 'already', model: m.repo || m.name, runningOn: there ? running.filter(r => r.spark === spark || sparks?.includes(r.spark)) : running, note: 'It’s already running; nothing changed.' };
    }
    if (m.role === 'draft') throw new HttpError(409, `${m.repo || m.name} is a draft model; it only runs alongside its main model.`);
    const unsafe = agentSafeSetup(m);
    if (unsafe) throw new HttpError(403, `${m.repo || m.name} can’t be started by an agent: ${unsafe}.`);
    // Making room by stopping Spark Console's own models is done and said (contract 8.4), unless the owner said not to.
    // Stopping something started outside Spark Console (by hand, a benchmark) or that answers Sparkie is always asked.
    const placed = await placeModel(m, inv, viewer, { spark, sparks, allowStop, noStops: Boolean(ctx.noStops) });
    // (room only by stopping something Spark Console didn't start: a Spark it powered off is turned on first instead)
    if (!placed.ok && placed.ask && !spark && !sparks && !ctx.poweredOn) { const first = powerFirst(args, viewer, ctx, 'any', [m.name, m.repo].filter(Boolean), { sizeBytes: m.sizeBytes }); if (first) return first; }
    if (!placed.ok && placed.ask) {
      if (ctx.noStops) throw new HttpError(409, `${placed.why}, ${noStopWords(ctx)}.`);
      // (its Yes repeats the same start: on that Spark, or across the same two, F11)
      const sp = id => sparkName(nodeById(id) || { id });
      const across = placed.two ? `across ${placed.nodes.map(sp).join(' + ')}` : null;
      return question(viewer, ctx, `${placed.why}. Stop ${placed.containers.join(' and ')} so ${m.repo || m.name} can start ${across || 'there'}?`, [
        { label: across ? `Yes, stop ${placed.containers.join(', ')} on ${sp(placed.node)} and start it ${across}` : `Yes, stop ${placed.containers.join(', ')} on ${placed.node}`,
          call: { action: 'start_model', args: { model: m.name, ...(placed.two ? { sparks: placed.nodes } : { spark: placed.node }), ...(setup ? { setup } : {}), allowStop: [...allowStop, ...placed.containers] } } },
        { label: 'No, leave it running', call: null },
      ], 'question', { ownerOnly: true });
    }
    // (nothing fits on the Sparks that are on: one Spark Console powered off is turned on first, and the start follows)
    if (!placed.ok && !spark && !sparks && !ctx.poweredOn) { const first = powerFirst(args, viewer, ctx, 'any', [m.name, m.repo].filter(Boolean), { sizeBytes: m.sizeBytes, why: notWoken }); if (first) return first; }
    if (!placed.ok) throw new HttpError(409, `Can’t start ${m.repo || m.name} right now: ${placed.why}.${notWoken.length ? ` ${notWoken[0]}` : ''}`);
    // (it fits only by stopping one of Spark Console's own models: a Spark it powered off is turned on first, and the start
    // is placed again; a call still never stops a model to make room)
    if (placed.stop.length && !spark && !sparks && !ctx.poweredOn) { const first = powerFirst(args, viewer, ctx, 'any', [m.name, m.repo].filter(Boolean), { sizeBytes: m.sizeBytes }); if (first) return first; }
    if (ctx.noStops && placed.stop.length) throw new HttpError(409, `${m.repo || m.name} only fits if ${placed.stop.join(', ')} stops, ${noStopWords(ctx)}.`);
    const across = acrossGate(placed.two, args, ctx, m.repo || m.name);
    // A model in use (it answered calls at the one address in the last 30 minutes) stops only after asking (8.4).
    const busy = placed.stop.filter(x => usedRecently(x) && !(args.allowBusy || []).includes(x));
    if (busy.length) {
      const names = busy.map(x => x.split('/').pop()).join(', ');
      return question(viewer, ctx, `${names} ${busy.length > 1 ? 'are' : 'is'} in use (it answered calls in the last 30 minutes, from ${usedRecently(busy[0]).by}). Stop it so ${m.repo || m.name} can start?`, [
        { label: `Yes, stop ${names} and start ${m.repo || m.name}`, call: { action: 'start_model', args: { model: m.name, ...(placed.two ? { sparks: placed.nodes } : { spark: placed.nodes[0] }), ...(setup ? { setup } : {}), allowStop, allowBusy: [...(args.allowBusy || []), ...busy] } } },
        { label: 'No, leave it running', call: null },
      ]);
    }
    const how = setup ? resolveHow({ setup }, viewer, m.name, placed.two ? 2 : 1, inv.library) : bestHow(m, placed.two ? 2 : 1, viewer, inv.library);
    if (!setup && m.repo) refreshSetups(viewer, m.repo).catch(() => null);
    if (how && dig.remoteCode(how.args)) throw new HttpError(403, 'That setup lets the model run its own code; only the owner can allow it, from Spark Console’s Deploy.');
    const job = launch(viewer, ctx, m, placed, how);
    if (how?.fromBrain) note(job, `Using the brain’s proven setup for this model${placed.two ? ', split across both Sparks,' : ''} without its draft model and stretched context (those are Spark 2’s)`);
    return { outcome: 'started', operation: job.id, ...(across || {}), model: m.repo || m.name, sparks: placed.nodes, stops: placed.stop, setup: how?.setupId || (how ? (how.fromBrain ? 'the brain’s proven setup, without its draft model' : 'a run that worked here before') : 'the engine’s defaults'),
      endpointWhenReady: placed.endpoint || null, next: `wait_operation {"id":"${job.id}"} to follow it; loading can take several minutes.` };
  }
  // Not on disk yet: download the best version that fits now, then start it, in one operation. Never for a call at the
  // model address: a call doesn't download models.
  if (ctx.via === 'gateway') throw new HttpError(409, `${found.repo || model} isn’t on your Sparks: a call doesn’t download models. Ask Sparkie, or start it from Spark Console.`);
  const fetching = startingNow([found.repo, ...(found.recipe?.variants || []).map(x => x.repo)], spark ? [spark] : sparks);
  if (fetching) return alreadyStarting(fetching, fetching.model);
  if (sparks && found.outsideRecipes) throw new HttpError(409, `${found.repo} isn’t in Recipes, and only models from Recipes run across two Sparks.`);
  if (found.outsideRecipes && !confirmOutside && !namedInFull(ctx, found.repo)) {
    return question(viewer, ctx, `${found.repo} isn’t in your recipes. Download it from Hugging Face, add it to your recipes and start it with the best setup found for it (no code of its own)?`, [
      { label: `Yes, download and start ${found.repo}`, call: { action: 'start_model', args: { model: found.repo, confirmOutside: true, ...(spark ? { spark } : {}) } } },
      { label: 'No', call: null },
    ]);
  }
  const pick = await pickVersion(found.recipe, found.repo, viewer, found.outsideRecipes, spark ? [spark] : sparks || null);
  if (!pick && !spark && !sparks && !ctx.poweredOn) { const first = powerFirst(args, viewer, ctx, 'any', wakeNames(model, found), { versions: found.recipe?.variants, why: notWoken }); if (first) return first; }
  if (!pick) throw new HttpError(409, `${found.recipe.title}: no version fits ${spark ? `on ${spark}` : sparks ? `on ${sparks.join(' + ')}` : 'on the Sparks'} right now with room to spare (8 GB headroom and disk). Stop something or free disk, then ask again.${notWoken.length ? ` ${notWoken[0]}` : ''}`);
  const v = pick.version, target = nodeById(pick.nodes[0]);
  mustUse(viewer, pick.nodes);
  const acrossPick = acrossGate(pick.two, args, ctx, v.repo);
  const going = startingNow([v.repo, found.repo], spark ? [spark] : sparks);
  if (going) return alreadyStarting(going, v.repo);
  if (v.gated) throw new HttpError(409, `${v.repo} is gated on Hugging Face: sign in on ${target.id} (hf auth login) and accept its license, then ask again.`);
  const job = newJob('start-model', { model: v.repo, node: target.id, ...(pick.two ? { nodes: pick.nodes } : {}), by: viewer.login, actor: ctx.actor || null, via: ctx.via || null,
    request: ctx.request ? String(ctx.request).slice(0, 300) : null, total: v.sizeGB ? Math.round(v.sizeGB * 1e9) : null });
  runJob(job, async j => {
    pausedCheck(ctx);
    await downloadVersion(j, v.repo, target, v.engine === 'llama.cpp' ? v.file || null : null);
    job.progress = null;
    pausedCheck(ctx);
    const fresh = await inventory(null), m = libraryModel(fresh, v.repo);
    if (!m) throw new Error(`Downloaded ${v.repo}, but the library doesn’t show it yet. Start it from Models in a minute.`);
    // A model started by its full Hugging Face name joins Recipes once its download worked (A9). If Hugging Face
    // doesn't answer, it starts as before.
    if (found.outsideRecipes) {
      try { note(j, `Added ${(await addModel(viewer, { repos: [v.repo] })).title} to Recipes`); }
      catch (e) { note(j, `Couldn’t add ${v.repo} to Recipes (${String(e.message).slice(0, 160)}), so no setups were looked up for it`); }
    }
    const unsafe = agentSafeSetup(m);
    if (unsafe) throw new Error(`Downloaded ${v.repo}, but ${unsafe}.`);
    const placed = await placeModel(m, fresh, viewer, pick.two ? { sparks: pick.nodes } : { spark: target.id });
    if (!placed.ok) throw new Error(`Downloaded ${v.repo}, but it can’t start now: ${placed.why}. The download is kept.`);
    // Nothing is stopped on the way unless it was OK'd: say so, and it starts in one more step (a button).
    const busyNow = placed.stop.filter(x => usedRecently(x));
    if (busyNow.length) throw new Error(`Downloaded ${v.repo}. Starting it on ${placed.nodes.join(' + ')} would stop ${busyNow.map(x => x.split('/').pop()).join(', ')}, which answered calls in the last 30 minutes, so it wasn’t started; ask again to choose.`);
    if (placed.stop.length && ctx.noStops) {
      throw new Error(`Downloaded ${v.repo}. Starting it on ${placed.nodes.join(' + ')} would stop ${placed.stop.map(st => st.split('/').pop()).join(', ')}, ${noStopWords(ctx)}, so it wasn’t started.`);
    }
    // Its best setups are looked for first (a model just downloaded may never have been looked up), then picked.
    await refreshSetups(viewer, v.repo, { job: j, wait: true }).catch(() => null);
    const how = bestHow(m, placed.two ? 2 : 1, viewer, fresh.library);
    note(j, how?.setupId ? `Starting it with recipe setup ${how.setupId}` : how ? 'Starting it with a run that worked here before' : 'No setup is known for it, so it starts with the engine’s defaults');
    const release = claimSparks(placed.nodes, `starting ${v.repo}`);
    try { await deployPlaced(j, viewer, ctx, m, placed, how); } finally { release(); }
  });
  return { outcome: 'started', operation: job.id, ...(acrossPick || {}), model: v.repo, quantization: v.quant || null, downloadGB: v.sizeGB, sparks: pick.nodes,
    ...(found.outsideRecipes ? { note: 'It isn’t in your recipes yet: after the download it is added, and its setups are looked up before it starts.' } : {}),
    next: `wait_operation {"id":"${job.id}"} to follow it; downloading ${v.sizeGB} GB and loading can take a while.` };
}
const choiceArg = { type: 'string', pattern: '^[a-f0-9]{10}$', description: 'The id of the choice the owner picked, from a question this action asked. Send it alone.' };
action({
  name: 'start_model', title: 'Start a model', kind: 'change', scope: 'fleet:act', who: 'owner', destructive: true, group: 'core',
  description: 'Use when the owner asks to start, run or deploy a model. Pass the model as the owner named it (library name, Hugging Face repo, recipe id, or their words like "qwen coder"); it finds it, downloads it first if needed, picks the Spark (or two linked Sparks) with room, starts it with the best known setup, and checks it answers. A Hugging Face repo that isn’t in Recipes is added to them after its download, and its setups (its model card’s too) are looked up before it starts. For one already on disk, find_setups adds it. Give spark or sparks only if the owner said where. It may come back with a question for the owner instead; answer it with {"choice": id}. It returns an operation id at once; follow it with wait_operation.',
  input: { type: 'object', properties: {
    model: { ...modelArg, pattern: '^[A-Za-z0-9][A-Za-z0-9._/:+ -]{0,199}$', description: 'The model, as the owner named it.' },
    spark: { ...sparkArg, description: 'Only if the owner said which Spark.' },
    sparks: { ...sparksArg, description: 'Only if the owner asked to run it across two Sparks, like ["spark3","spark4"].' },
    setup: { type: 'string', pattern: '^[a-z0-9]{4,32}$', description: 'A recipe setup id (recipe_detail), only if the owner chose one.' },
    choice: choiceArg,
  }, additionalProperties: false },
  run: async (input, viewer, ctx) => {
    if (input.choice) {
      if (Object.keys(input).length > 1) throw new HttpError(400, 'Send the choice alone: {"choice": id}.');
      return startModel(redeemChoice(viewer, ctx, 'start_model', input.choice), viewer, ctx);
    }
    if (!input.model) throw new HttpError(400, 'Missing argument: model.');
    return startModel(input, viewer, ctx);
  },
});

action({
  name: 'stop_model', title: 'Stop a model', kind: 'change', scope: 'fleet:act', who: 'owner', destructive: true, group: 'core',
  description: 'Use when the owner asks to stop a model Spark Console started. Stops both parts of a model running across two Sparks. Container names come from running_models. Never stops Sparkie’s own model or protected containers. It may ask the owner first; answer with {"choice": id}.',
  input: { type: 'object', properties: { spark: sparkArg, container: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$', description: 'The container, from running_models.' }, choice: choiceArg },
    additionalProperties: false },
  run: async (input, viewer, ctx) => {
    if (input.choice && Object.keys(input).length > 1) throw new HttpError(400, 'Send the choice alone: {"choice": id}.');
    const { spark, container, confirmRouted = false } = input.choice ? redeemChoice(viewer, ctx, 'stop_model', input.choice) : input;
    if (!spark || !container) throw new HttpError(400, 'Missing argument: spark and container.');
    sparkOf(viewer, spark);
    const dep = (await inventory(null)).sparks.find(sp => sp.id === spark)?.deployments.find(d => d.container === container);
    if (!dep) throw new HttpError(404, `${container} isn’t one of Spark Console’s models on ${spark}. Only those can be stopped this way; running_models lists them.`);
    if (dep.role === 'main') throw new HttpError(403, 'Sparkie’s own model is started and stopped by the owner, on Models.');
    const label = await run(nodeById(spark), `docker inspect -f '{{index .Config.Labels "spark.protect"}}' ${q(container)} 2>/dev/null`, { timeout: 20000 });
    if (isProtected(container, label.out.trim())) throw new HttpError(403, `${container} is protected.`);
    if (dep.state !== 'running') return { outcome: 'already', note: `${container} isn’t running.` };
    const parts = dep.cluster ? dep.cluster.split('+') : [spark];
    if (!confirmRouted && parts.some(id => routedSparks().has(id))) {
      return question(viewer, ctx, `${container} answers Sparkie’s chats or apps. Stop it anyway?`, [
        { label: `Yes, stop ${container}`, call: { action: 'stop_model', args: { spark, container, confirmRouted: true } } }, { label: 'No, leave it running', call: null }], 'question', { ownerOnly: true });
    }
    const owners = ctx.via === 'page' || ctx.via === 'telegram' || (ctx.via === 'sparkie' && !ctx.agent);
    const holding = [...jobs.values()].filter(j => holdsModelsOn(j, parts) && (owners || (ctx.actor && j.actor === ctx.actor)));
    if (holding.length) await cancelJobsAndWait(holding, ctx.actor || viewer.login);
    const job = claimed(parts, `stopping ${container}`, () => newJob('stop', { node: spark, container, by: viewer.login, actor: ctx.actor || null, via: ctx.via || null, request: ctx.request ? String(ctx.request).slice(0, 300) : null }));
    runJob(job, async j => { pausedCheck(ctx); await stopContainer(j, spark, container, viewer); await stoppedForSure(j, spark, container); });
    return { outcome: 'started', operation: job.id, stopping: container, sparks: parts, next: `wait_operation {"id":"${job.id}"}` };
  },
});

// A stop is done when the container really isn't running any more.
async function stoppedForSure(job, spark, container) {
  const r = await run(nodeById(spark), `docker inspect -f '{{.State.Status}}' ${q(container)} 2>/dev/null || echo gone`, { timeout: 20000 });
  if (r.code !== 0) throw new Error(`Couldn’t check that ${container} stopped: ${spark} didn’t answer.`);
  if (r.out.trim() === 'running') throw new Error(`${container} is still running on ${spark} after stopping it.`);
  note(job, `Checked: ${container} isn’t running`);
}

// Starts one of Spark Console's stopped models again, on one Spark, after the same memory check as a start, and waits
// until it answers.
async function restartChecked(viewer, ctx, spark, container) {
  const inv = await inventory(null), sp = inv.sparks.find(x => x.id === spark), dep = sp?.deployments.find(d => d.container === container);
  if (!dep) throw new HttpError(404, `${container} isn’t one of Spark Console’s models on ${spark}.`);
  if (dep.role === 'main') throw new HttpError(403, 'Sparkie’s own model restarts by itself; the owner manages it on Models.');
  if (dep.cluster) throw new HttpError(409, 'It runs across two Sparks; use start_model to start it again.');
  if (dep.state === 'running') return null;
  notBrainsSpark([spark]);
  const m = inv.library.find(x => x.name === dep.model);
  if (!m) throw new HttpError(409, `${dep.model} isn’t in the library on ${spark} any more.`);
  // Room for it now, beyond the 8 GB kept free, without stopping anything else.
  const p = await plan(m.name, spark, viewer, inv), avail = p.memory.available, total = p.memory.total;
  // A GPU app or job there has the GPU to itself (A13): a restart never stops it.
  const held = p.steps.find(s => s.hold);
  if (held) throw new HttpError(409, `${held.container} has ${sparkName(nodeById(spark) || { id: spark })}’s GPU now. start_model can ask to stop it.`);
  // It comes back with the share it was started with, so that's what it takes: the larger of that and the estimate.
  const cmd = await run(nodeById(spark), `docker inspect -f '{{json .Config.Cmd}}' ${q(container)} 2>/dev/null`, { timeout: 20000 });
  let own = null;
  try { const args = JSON.parse(cmd.out.trim() || '[]'); own = shareIn(args, '--gpu-memory-utilization') ?? shareIn(args, '--mem-fraction-static'); } catch {}
  const need = Math.max(p.memory.need || 0, own != null && Number.isFinite(total) ? own * total : 0);
  if (!Number.isFinite(avail) || !need) throw new HttpError(409, `free memory on ${spark} is unknown right now, so it can’t be checked`);
  if (avail - KEEP_FREE < need) throw new HttpError(409, `${spark} doesn’t have room for ${container} now (it takes about ${Math.round(need / 1e9)} GB beyond the 8 GB kept free). start_model can make room.`);
  return restartJob(viewer, ctx, spark, container);
}
function restartJob(viewer, ctx, spark, container) {
  const node = nodeById(spark);
  const job = claimed([spark], `restarting ${container}`, () => newJob('restart', { node: spark, container, by: viewer?.login || null, actor: ctx.actor || null, via: ctx.via || null, request: ctx.request ? String(ctx.request).slice(0, 300) : null }));
  runJob(job, async j => {
    pausedCheck(ctx);
    step(j, `Starting ${container} on ${spark}`);
    const r = await run(node, `docker start ${q(container)}`, { timeout: 90000 });
    if (r.code) throw new Error(`Docker couldn’t start it: ${r.err || r.out}`);
    // Started again on purpose: if it crashes from now on, self-healing may bring it back.
    consoleStopped.delete(`${spark}/${container}`);
    step(j, 'Loading the model; this can take a few minutes');
    const deadline = Date.now() + 30 * 60 * 1000;
    while (Date.now() < deadline) {
      await sleep(5000);
      if (j.cancelled) {
        consoleStopped.set(`${spark}/${container}`, Date.now());
        await run(node, `docker stop --time 20 ${q(container)} >/dev/null 2>&1; true`, { timeout: 90000 });
        cancelCheck(j);
      }
      const h = await run(node, `if curl -sf -m 4 http://127.0.0.1:${CONFIG.servePort}/v1/models >/dev/null; then echo up; else docker inspect -f '{{.State.Status}}' ${q(container)} 2>/dev/null || echo missing; fi`, { timeout: 20000 });
      const s = h.out.trim();
      if (s === 'up') {
        const tsip = node.host === 'local' || ALL_LOCAL ? '127.0.0.1' : (await inventory(null)).sparks.find(x => x.id === spark)?.tsip;
        try {
          if (!tsip) throw new Error(`It’s up, but ${spark}’s address is unknown, so it couldn’t be checked with a test prompt.`);
          await answers(j, tsip, CONFIG.servePort);
        } catch (e) {
          consoleStopped.set(`${spark}/${container}`, Date.now());
          await run(node, `docker stop --time 20 ${q(container)} >/dev/null 2>&1; true`, { timeout: 90000 });
          note(j, `Stopped ${container} again`);
          throw e;
        }
        return;
      }
      if (h.code === 0 && ['exited', 'dead', 'missing'].includes(s)) throw new Error(`${container} stopped again while loading. container_logs shows why.`);
    }
    throw new Error('It didn’t answer within 30 minutes.');
  });
  return job;
}
action({
  name: 'restart_model', title: 'Restart a model', kind: 'change', scope: 'fleet:act', who: 'owner', group: 'core',
  description: 'Use when one of Spark Console’s models (on one Spark) has stopped or crashed and the owner wants it back. Starts the same container again if there’s room, and checks it answers. For a model across two Sparks, use start_model.',
  input: { type: 'object', properties: { spark: sparkArg, container: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$', description: 'The container, from running_models (stopped) or workloads.' }, choice: choiceArg }, additionalProperties: false },
  run: async (input, viewer, ctx) => {
    // A choice this action offered (its validation run, v3.1) is sent alone, as for stop_model.
    if (input.choice && Object.keys(input).length > 1) throw new HttpError(400, 'Send the choice alone: {"choice": id}.');
    const { spark, container } = input.choice ? redeemChoice(viewer, ctx, 'restart_model', input.choice) : input;
    if (!spark || !container) throw new HttpError(400, 'Missing argument: spark and container.');
    sparkOf(viewer, spark);
    mustUse(viewer, [spark]);
    const job = await restartChecked(viewer, ctx, spark, container);
    if (!job) return { outcome: 'already', note: `${container} is running.` };
    return { outcome: 'started', operation: job.id, restarting: container, next: `wait_operation {"id":"${job.id}"}` };
  },
});

/* ───────── research (v3.1, 2026-11-11) ───────── */
// Looking up a model's setups now, when the owner asks (Spark Console also does it by itself, see refreshSetups). It
// reads only maintained sources, and Recipes lists only setups that hold up (recipeCatalog).
action({
  name: 'find_setups', title: 'Find setups for a model', kind: 'change', scope: 'fleet:act', who: 'owner', group: 'find',
  description: 'Use when the owner wants a model’s setups (configs, recipes, speeds) looked up now, or recipe_detail shows they were never looked up or are over a week old. Reads NVIDIA’s DGX Spark recipe files, vLLM’s recipes, Spark Arena’s registry, eugr’s spark-vllm-docker and the model’s own card on Hugging Face, and keeps each setup with its command, image and the speed its source measured; Recipes lists only those that hold up. Changes nothing on the Sparks and downloads nothing. Spark Console also does this by itself every day, so usually recipe_detail already has them. A Hugging Face repo that isn’t in Recipes yet is added first (it may ask; answer with {"choice": id}).',
  input: { type: 'object', properties: { model: modelArg, choice: choiceArg }, additionalProperties: false },
  run: async (input, viewer, ctx) => {
    if (input.choice && Object.keys(input).length > 1) throw new HttpError(400, 'Send the choice alone: {"choice": id}.');
    const { model, confirmOutside = false } = input.choice ? redeemChoice(viewer, ctx, 'find_setups', input.choice) : input;
    if (!model) throw new HttpError(400, 'Missing argument: model.');
    const found = await resolveModelName(model, await inventory(null));
    if (found.choices) return question(viewer, ctx, `“${model}” could be several models. Which one?`, found.choices.map(c => ({ label: c.label, call: { action: 'find_setups', args: { model: c.model } } })));
    let id = found.recipe?.id || (found.lib ? recipeIdOf(found.lib.repo || found.lib.name) : null), added = false;
    // A Hugging Face repo that isn't in Recipes joins them first (A9): at once when the asker named it in full, else after a yes.
    const repo = found.repo || found.lib?.repo || null;
    if (!id && repo && REPO_RE.test(repo)) {
      if (!confirmOutside && !namedInFull(ctx, repo)) {
        return question(viewer, ctx, `${repo} isn’t in your recipes. Add it and look up its setups?`, [
          { label: `Yes, add ${repo} and look up its setups`, call: { action: 'find_setups', args: { model: repo, confirmOutside: true } } }, { label: 'No', call: null }]);
      }
      id = (await addModel(viewer, { repos: [repo] })).id;   // its own plain errors pass through (not on Hugging Face, no weights)
      added = true;
    }
    const recipe = id ? recipeCatalog().models.find(m => m.id === id) : null;
    if (!recipe) throw new HttpError(404, `${found.repo || found.lib?.repo || model} isn’t in Recipes, so there’s nothing to look up for it yet.`);
    const job = [...jobs.values()].find(j => j.status === 'running' && j.type === 'dig' && j.modelId === recipe.id) || startDig(viewer, recipe.id, recipe.title);
    return { outcome: 'started', operation: job.id, model: recipe.title, ...(added ? { addedToRecipes: true } : {}), next: `wait_operation {"id":"${job.id}"}, then recipe_detail {"id":"${recipe.id}"} for what it found` };
  },
});

/* ───────── one new file in a Spark's shared folder (R37) ───────── */
// Writes through the worker's workspace-files with no revision, so the worker creates the file and never replaces one
// (a name that's taken is a conflict). It runs inside runAction (owner, schema, the pause, the intent gate, audit) and is
// quick: no job and no claim. Every check passes before anything is written.
action({
  name: 'save_file', title: 'Save a file', kind: 'change', scope: 'fleet:act', who: 'owner', group: 'reading',
  description: 'Use when the owner asks to save or write something as a file on a Spark (“save this as notes.md on Spark 3”). Writes one new text file in that Spark’s shared folder, with exactly the text you pass. Pass the Spark and the file name as the owner said them. It never replaces a file that is already there, never makes a folder and never writes hidden files; if the name is taken it says so and writes nothing.',
  input: { type: 'object', properties: {
    spark: { ...sparkArg, description: 'The Spark the owner named.' },
    path: { ...filePathArg, pattern: SAVE_PATH, description: 'The new file’s name, like notes.md, or inside a folder that is already there, like notes/todo.md.' },
    text: { type: 'string', maxLength: 65536, description: 'The whole text of the file (at most 64 KB).' },
  }, required: ['spark', 'path', 'text'], additionalProperties: false },
  run: async ({ spark, path, text }, viewer, ctx) => {
    const node = sparkOf(viewer, spark), at = sparkName(node), name = filePath(path);
    if (!text.trim()) throw new HttpError(400, 'There’s no text to save.');
    if (text.includes('\0') || text !== Buffer.from(text).toString()) throw new HttpError(400, 'Only plain text can be saved.');
    const data = Buffer.from(text);
    if (data.length > FILE_SAVE_BYTES) throw new HttpError(413, `That’s ${sizeWords(data.length)}. A file saved from here holds at most 64 KB.`);
    // (the shared folder is readable by members. Refused only for key shapes: a known token format, a private key, a
    // setting like SECRET_KEY=<random>, a password inside an address. Plain notes and code save, R37.)
    if (hideKeys(text) !== text) throw new HttpError(400, 'That text looks like it has a key, token or password in it. Files saved from here never hold those.');
    let r;
    try { r = await sharedFolder(viewer, node, { operation: 'write', path: name, data: data.toString('base64') }); } catch (e) {
      if (e.status === 409) throw new HttpError(409, `${name} is already in the shared folder on ${at}. Nothing was written: a file that’s there is never replaced from here. Save it under another name.`);
      if (e.status === 404) throw new HttpError(404, `That folder isn’t in the shared folder on ${at}, and folders aren’t made from here. Nothing was written.`);
      // (the worker's 64 MiB and 1,000-entry limit counts jobs' outputs, R37)
      if (e.status === 400 && /limit reached/i.test(e.message)) {
        throw new HttpError(400, `The shared folder on ${at} is full: it holds at most 64 MiB and 1,000 files and folders, and jobs’ outputs (in jobs/ there) count too, so they are most likely what filled it. Nothing was written. To clear them, delete the job folders you no longer need on ${at} (rm -rf ~/.local/share/spark-portal/workspaces/shared/jobs/<name>; files with folder jobs lists them), then save again.`);
      }
      throw e;
    }
    // (runAction's own line keeps only the first 1,000 characters of the arguments: this one always names the file)
    audit({ via: ctx.via || null, actor: ctx.actor || null, ...(ctx.chat ? { chat: ctx.chat } : {}), action: 'file-saved', args: { spark: node.id, file: r.path, sizeBytes: r.size, sha256: r.revision }, ok: true });
    return { outcome: 'saved', spark: node.id, file: r.path, sizeBytes: r.size, note: `Saved ${r.path} in the shared folder on ${at} (${sizeWords(r.size)}).` };
  },
});
