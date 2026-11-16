/* ───────── choosing what Sparkie and agents use ───────── */
// Area: brain        Rules: R5, R36        Tests: gateway.test.mjs, paste.test.mjs
// Owns: none
// Timers: none        Wakes: none
// Running models this service can point Sparkie or agents at: its own main model, console deploys (they listen on the
// tailnet too), and other model servers on its own Spark. Servers that only listen on another Spark's own address
// are listed but can't be reached from here.
async function runningChoices() {
  const inv = await inventory(null), list = [];
  if (MAIN) {
    const m = await mainStatus();
    list.push({ id: 'main', title: MAIN.title, node: MAIN.node, kind: 'main', running: ['running', 'restarting'].includes(m.state), healthy: m.healthy, reachable: true });
  }
  for (const sp of inv.sparks.filter(x => x.online)) {
    const local = ALL_LOCAL || nodeById(sp.id)?.host === 'local';
    for (const d of sp.deployments.filter(x => x.state === 'running' && x.role !== 'main' && !x.rank)) {
      // A model across Sparks listens only on its answering Spark's Tailscale address (host networking), not 127.0.0.1.
      const entry = inv.library.find(m => m.name === d.model), host = local && !d.cluster ? '127.0.0.1' : sp.tsip;
      const title = entry?.repo || entry?.manifest?.title || d.model;
      list.push({ id: `deploy:${sp.id}:${d.container}`, title: d.cluster ? `${title} (across ${d.cluster.split('+').map(id => sparkName(nodeById(id) || { id })).join(' + ')})` : title, node: sp.id, kind: 'endpoint', running: true,
        url: host ? `http://${host}:${CONFIG.servePort}` : null, reachable: Boolean(host) });
    }
    for (const e of sp.external) {
      list.push({ id: `ext:${sp.id}:${e.container}`, title: e.models[0] || e.container, node: sp.id, kind: 'endpoint', running: true, container: e.container,
        url: local ? `http://127.0.0.1:${e.port}` : null, reachable: local, reason: local ? null : `listens only on ${sp.id} itself` });
    }
  }
  return list;
}

// The model id a server answers to, which also proves this service can reach it.
function servedModel(url) {
  return new Promise((resolve, reject) => {
    const r = http.get(`${url}/v1/models`, { timeout: 5000 }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => { try { const id = JSON.parse(body).data?.[0]?.id; id ? resolve(id) : reject(new Error('It didn’t name a model.')); } catch { reject(new Error('It didn’t answer like a model server.')); } });
    });
    r.on('timeout', () => r.destroy(new Error('It didn’t answer in time.')));
    r.on('error', e => reject(new Error(e.code === 'ECONNREFUSED' ? 'Nothing is listening there.' : e.message)));
  });
}

async function setRoute(role, choice) {
  if (role === 'agents' && choice === 'same') ROUTES.agents = { kind: 'same' };
  else if (choice === 'main') {
    if (!MAIN) throw new HttpError(409, 'Sparkie has no model of its own set up.');
    ROUTES[role] = { kind: 'main' };
  } else {
    const c = (await runningChoices()).find(x => x.id === choice);
    if (!c) throw new HttpError(404, 'That model isn’t running any more.');
    if (!c.reachable) throw new HttpError(409, `${c.title} ${c.reason || 'can’t be reached from here'}.`);
    let model;
    try { model = await servedModel(c.url); } catch (e) { throw new HttpError(409, `${c.title} on ${c.node}: ${e.message}`); }
    ROUTES[role] = { kind: 'endpoint', url: c.url, model, title: c.title, node: c.node };
  }
  saveRoutes();
}

// What each route points at right now, for the console.
async function routeView(route) {
  const t = routeTarget(route);
  if (!t) return null;
  let healthy = false;
  if (t.kind === 'main') healthy = (await mainStatus()).healthy;
  else healthy = await servedModel(`http://${t.host}:${t.port}`).then(() => true, () => false);
  return { kind: t.kind, title: t.title, node: t.node, healthy };
}

/* ───────── Sparkie for agents ───────── */
// One stable, OpenAI-compatible address for agents and tools: https://<portal>:8443/console/api/v1, model "sparkie",
// whatever model is behind it. Access follows Tailscale identity (anyone allowed to chat); any API key string works,
// since clients usually insist on sending one. Requests and replies, streamed or not, pass straight through.
const SPARKIE_ID = 'sparkie';
// Every model at this one address too (docs/contract.md 9.9): each model Spark Console runs, by the name it's served as
// (or its library or repo name), wherever it runs now. A model that isn't running starts when it's called (8.0), if
// that needs nothing stopped and the start workflow is active; the call gets 503 with Retry-After while it loads.
// Calls are remembered for 30 minutes, so a start that would stop a model in use asks first (8.4).
const IN_USE_MS = 30 * 60000;
const inUse = new Map();   // "spark/container" → { at, by }
const usedRecently = key => { const u = inUse.get(key); return u && Date.now() - u.at < IN_USE_MS ? u : null; };
// When a call at this address last reached a model on each Spark (both Sparks of a model across two): the idle
// power-off (21-power.mjs) never powers off a Spark called within its idle time. In memory only.
const sparkCalls = new Map();   // spark → time
async function runningModels(viewer = null) {
  const inv = await recentInventory(), lib = new Map(inv.library.map(m => [m.name, m]));
  return inv.sparks.filter(sp => sp.online && (!viewer || viewer.role === 'owner')).flatMap(sp => sp.deployments.filter(d => d.state === 'running' && !d.rank && d.role !== 'main' && d.endpoint)
    .map(d => { const m = lib.get(d.model); return { spark: sp.id, sparks: d.cluster ? d.cluster.split('+') : [sp.id], container: d.container, endpoint: d.endpoint, names: [d.model, m?.repo, m?.stores?.[sp.id] === 'hf' ? m.repo : d.model].filter(Boolean) }; }));
}
async function proxyModel(req, res, path, body, url, served) {
  const u = new URL(url), payload = JSON.stringify({ ...body, model: served });
  await new Promise(resolve => {
    const up = http.request({ hostname: u.hostname, port: u.port, path, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } }, r => {
      res.writeHead(r.statusCode, { 'content-type': r.headers['content-type'] || 'application/json', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
      r.pipe(res);
      r.on('end', resolve);
      r.on('error', resolve);
    });
    up.on('error', e => {
      if (!res.headersSent) send(res, 503, { error: { message: e.code === 'ECONNREFUSED' ? 'That model isn’t answering right now.' : e.message, type: 'unavailable' } });
      else res.end();
      resolve();
    });
    res.on('close', () => { if (!res.writableFinished) up.destroy(); });
    up.end(payload);
  });
}
// A call to a model that isn't running starts it through the start workflow, only when all of these hold: it's on disk
// already (a call never downloads), in Recipes or on the list of what should be running, nothing has to stop for it,
// it wasn't stopped in the last 30 minutes, and it isn't already starting or failing. At most 3 such starts in 10
// minutes, and they don't count toward agents' changes.
const callStarts = { inFlight: new Map(), failedAt: new Map(), recent: [] };
async function startOnCall(viewer, name) {
  const key = String(name).toLowerCase().slice(0, 200);
  if (callStarts.inFlight.has(key)) throw Object.assign(new HttpError(503, `${name} is starting (operation ${callStarts.inFlight.get(key)}); try again in a minute or two.`), { retryAfter: 60, type: 'model_starting' });
  const failed = callStarts.failedAt.get(key);
  if (failed && Date.now() - failed < 5 * 60000) throw new HttpError(409, `${name} failed to start a few minutes ago; it isn’t tried again on a call for a while. Ask Sparkie, or start it from Spark Console.`);
  callStarts.recent = callStarts.recent.filter(t => Date.now() - t < 10 * 60000);
  if (callStarts.recent.length >= 3) throw new HttpError(429, 'Three models were started by calls in the last 10 minutes; ask Sparkie, or start this one from Spark Console.');
  // A model parked when Spark Console powered its Spark off (21-power.mjs) comes back on its next call: its Spark is
  // turned on first if it's off (its files are there, so it isn't looked for on the Sparks that are on).
  const parked = parkedFor(String(name).slice(0, 200));
  let m = null, asleep = false;
  if (!parked) {
    const inv = await recentInventory();
    let found;
    try { found = await resolveModelName(String(name).slice(0, 200), inv); } catch { throw new HttpError(404, `No model called “${String(name).slice(0, 80)}” at this address, and none by that name to start. Use "${SPARKIE_ID}", or a name from GET /v1/models.`); }
    m = found.lib;
    // (a Recipes model on no Spark that is on, while Spark Console has one powered off: its files may be there, so the
    // start turns that Spark on first; it still never downloads, start_model refuses a call that would)
    // (only a Spark whose record lists it, or one with no list, is looked at: one known not to hold it never wakes for a call)
    asleep = !m && Boolean(found.recipe?.id) && offFor(Object.keys(powerState().off).filter(id => nodeById(id)), wakeNames(String(name).slice(0, 200), found), true).length > 0;
    if (!m && !asleep) throw new HttpError(409, `${String(name).slice(0, 80)} isn’t running, and it isn’t on your Sparks: a call doesn’t download models. Ask Sparkie, or start it from Spark Console.`);
  }
  if (m) {
    const stoppedAt = Math.max(0, ...[...consoleStopped].filter(([k]) => k.endsWith(`/${containerName(m.name)}`)).map(([, t]) => t));
    if (Date.now() - stoppedAt < IN_USE_MS) throw new HttpError(409, `${m.repo || m.name} was stopped on purpose ${Math.max(1, Math.round((Date.now() - stoppedAt) / 60000))} min ago, so a call doesn’t start it again. Ask Sparkie, or start it from Spark Console.`);
    const listed = desired().running.some(x => x.model === m.name || x.container === containerName(m.name));
    if (!inRecipes(m) && !listed) throw new HttpError(409, `${m.repo || m.name} isn’t running, and only models in your recipes (or on your list of what should run) start on a call.`);
  }
  // (a parked model starts where it ran: across the same two Sparks is that workflow, checked before anything is turned on)
  const args = parked ? { model: parked.model, ...(parked.sparks ? { sparks: parked.sparks } : { spark: parked.spark }) } : { model: m ? m.name : String(name).slice(0, 200) };
  let out;
  try {
    out = await runAction('start_model', viewer, args, { via: 'gateway', actor: 'A call to the model address', request: '', said: '', canChange: true, noStops: true });
  } catch (e) {
    // (refused for who is asking, or agents' changes being paused, isn't a start that failed: the next call may go)
    if (e.status !== 403) callStarts.failedAt.set(key, Date.now());
    if (e.status === 404) throw new HttpError(404, `No model called “${String(name).slice(0, 80)}” at this address, and none by that name to start. Use "${SPARKIE_ID}", or a name from GET /v1/models.`);
    throw new HttpError(409, `${String(name).slice(0, 80)} isn’t running, and it can’t be started on its own: ${e.message}`);
  }
  if (out?.outcome === 'started' || out?.outcome === 'already-starting') {
    if (out.outcome === 'started') {
      callStarts.recent.push(Date.now());
      callStarts.inFlight.set(key, out.operation);
      waitJob(out.operation).then(j => { callStarts.inFlight.delete(key); if (j?.status !== 'completed') callStarts.failedAt.set(key, Date.now()); });
    }
    throw Object.assign(new HttpError(503, `${out.model || name} is starting (operation ${out.operation}); try again in a minute or two.`), { retryAfter: 60, type: 'model_starting' });
  }
  if (out?.outcome === 'already') throw Object.assign(new HttpError(503, `${name} is just coming up; try again in a moment.`), { retryAfter: 10, type: 'model_starting' });
  throw new HttpError(409, `${String(name).slice(0, 80)} isn’t running, and starting it needs a choice: ${out?.question || 'ask Sparkie, or start it from Spark Console'}.`);
}
// The OpenAI-style paths passed through to a model (2026-11-11: /v1/responses for Codex, embeddings and rerank for
// the models that serve them; the model server answers 404 for what it doesn't do).
const V1_PATHS = ['/v1/chat/completions', '/v1/completions', '/v1/responses', '/v1/embeddings', '/v1/rerank'];
async function sparkieApi(req, res, path, viewer = null) {
  const agents = agentTarget(), main = MAIN ? routeTarget({ kind: 'main' }) : null;
  if (req.method === 'GET' && path === '/v1/models') {
    const running = await runningModels(viewer).catch(() => []);
    const seen = new Set();
    // (and the brain serving now, as the eval's runner keys its record by it, from a compute Spark: R52; apps poll this,
    // so a look up to 5 seconds old does)
    if (MAIN) await brainRanLook({ within: 5000 }).catch(() => null);
    return send(res, 200, { object: 'list', ...(MAIN ? { spark_console: { brain: brainInUse() } } : {}), data: [
      agents ? { id: SPARKIE_ID, object: 'model', created: 0, owned_by: 'spark-console', title: agents.title } : null,
      main ? { id: main.model, object: 'model', created: 0, owned_by: 'spark-console', title: main.title } : null,
      ...running.map(r => ({ id: r.names[r.names.length - 1], object: 'model', created: 0, owned_by: 'spark-console', spark: r.spark })),
    ].filter(x => x && !seen.has(x.id) && seen.add(x.id)) });
  }
  if (req.method !== 'POST' || !V1_PATHS.includes(path)) throw new HttpError(404, 'Not found.');
  const body = await readBody(req, 8e6);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Send a JSON object.');
  // Fields that would make the model server run code the caller sends (SGLang/vLLM logits processors) never pass.
  for (const k of ['custom_logit_processor', 'logits_processors']) delete body[k];
  // A model name this address doesn't serve is an error, not a quiet switch to Sparkie's model (an agent asking for
  // "gpt-oss" should learn it isn't here, not get another model's answer).
  const known = [SPARKIE_ID, agents?.model, main?.model].filter(Boolean);
  if (body.model !== undefined && body.model !== null && body.model !== '' && !known.includes(body.model)) {
    const hit = (await runningModels(viewer).catch(() => [])).find(r => r.names.some(n => String(n).toLowerCase() === String(body.model).toLowerCase()));
    if (hit) {
      inUse.set(`${hit.spark}/${hit.container}`, { at: Date.now(), by: viewer?.agentName || viewer?.login || 'an app' });
      for (const id of hit.sparks) sparkCalls.set(id, Date.now());
      return proxyModel(req, res, path, body, hit.endpoint.replace(/\/v1$/, ''), hit.names[hit.names.length - 1]);
    }
    // An agent's key from the internet (4.10) starts a model on a call only if it may change things; a program on one
    // of the Sparks (it calls as the owner) never does (review, 2026-11-11).
    const fromSpark = (ALL_LOCAL ? sparkAddresses() : blockedAddresses)?.has(clientAddress(req));
    if (fromSpark) throw new HttpError(409, `${String(body.model).slice(0, 80)} isn’t running. A program on a Spark can use the models that run, but doesn’t start one by calling it.`);
    if (viewer && (!viewer.agentKey || viewer.agentKey.scopes.includes('fleet:act'))) return startOnCall(viewer, body.model);
    if (viewer) throw new HttpError(409, `${String(body.model).slice(0, 80)} isn’t running, and this agent may only look, so a call doesn’t start it.`);
    throw new HttpError(404, `No model called “${String(body.model).slice(0, 80)}” at this address. Use "${SPARKIE_ID}"${main ? ` (now ${main.title})` : ''}; GET /v1/models lists what’s here.`);
  }
  const target = main && body.model === main.model ? main : agents;
  if (!target) throw new HttpError(503, 'Sparkie has no model set up.');
  if (!target.reachable) throw new HttpError(503, `${target.title} runs on ${target.node}, which this service can’t reach directly.`);
  const payload = JSON.stringify({ ...body, model: target.model });
  // One place on Sparkie's model stays for the owner's chat (round two, item 4): apps calling it here get at most its
  // --max-running-requests minus one at once (at least one). The console's own chats aren't counted here.
  const brainCall = target.kind === 'main', slots = brainCall ? mainArg('--max-running-requests') : null;
  if (brainCall && slots && gatewayBrainCalls >= Math.max(1, slots - 1)) {
    throw Object.assign(new HttpError(429, `Sparkie’s model is already answering ${gatewayBrainCalls} app request${gatewayBrainCalls === 1 ? '' : 's'}, ${slots === 1 ? 'and it answers one request at a time' : 'and one place stays for the owner’s chat'}. Try again in a few seconds.`), { retryAfter: 10, type: 'busy' });
  }
  if (brainCall) gatewayBrainCalls++;
  try { await proxyBrain(req, res, path, target, payload); } finally { if (brainCall) gatewayBrainCalls--; }
}
let gatewayBrainCalls = 0;
function proxyBrain(req, res, path, target, payload) {
  return new Promise(resolve => {
    const up = http.request({ hostname: target.host, port: target.port, path, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } }, r => {
      res.writeHead(r.statusCode, { 'content-type': r.headers['content-type'] || 'application/json', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
      r.pipe(res);
      // (every way a call can end settles it, so the count of app calls on the brain never sticks)
      r.on('end', resolve);
      r.on('error', resolve);
      r.on('close', resolve);
    });
    up.on('error', e => {
      if (!res.headersSent) send(res, 503, { error: { message: e.code === 'ECONNREFUSED' ? `${target.title} isn’t running right now.` : e.message, type: 'unavailable' } });
      else res.end();
      resolve();
    });
    // The agent hung up: stop generating.
    res.on('close', () => { if (!res.writableFinished) up.destroy(); resolve(); });
    up.end(payload);
  });
}

