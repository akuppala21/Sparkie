/* ───────── verified deployments ───────── */
// Area: ground        Rules: R15, R22        Tests: change.test.mjs, detail.test.mjs
// Owns: verified.json (writers: recordVerified)
// Timers: none        Wakes: none
// Every deploy that comes up healthy is recorded with exactly how it ran (model, image, flags, memory share, Sparks) and a
// quick speed test on these Sparks: time to the first token and tokens per second over one 256-token answer. Recipes and
// the deploy dialog show these as "Verified on your Sparks", next to what others reported.
const VERIFIED_FILE = `${STATE_DIR}/verified.json`;
const verifiedList = () => { const v = readKept(VERIFIED_FILE); return Array.isArray(v?.deployments) ? v.deployments : []; };

function httpJson(host, port, path, body, { timeout = 120000, onData } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const r = http.request({ hostname: host, port, path, method: payload ? 'POST' : 'GET', timeout,
      headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {} }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; onData?.(chunk); });
      res.on('end', () => (res.statusCode >= 400 ? reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 200)}`)) : resolve(text)));
      res.on('error', reject);
    });
    r.on('timeout', () => r.destroy(new Error('timed out')));
    r.on('error', reject);
    r.end(payload);
  });
}

// "Done" means it answers: a short real prompt has to come back with words (a chat, or a plain completion for a base
// model), within a minute and a half of it loading (SPARK_CONSOLE_ANSWER_TEST_MS).
const ANSWER_TEST_MS = Number(process.env.SPARK_CONSOLE_ANSWER_TEST_MS || 90000);
async function answerTest(host, port) {
  const until = Date.now() + ANSWER_TEST_MS;
  let last = 'no answer';
  for (;;) {
    try {
      const listed = JSON.parse(await httpJson(host, port, '/v1/models', null, { timeout: 15000 }));
      const model = listed.data?.[0]?.id;
      if (!model) throw new Error('it lists no model');
      const text = await httpJson(host, port, '/v1/chat/completions', { model, max_tokens: 16, temperature: 0, stream: false,
        chat_template_kwargs: { enable_thinking: false }, messages: [{ role: 'user', content: 'Say hello in five words.' }] }, { timeout: 60000 })
        .catch(e => httpJson(host, port, '/v1/completions', { model, max_tokens: 16, temperature: 0, stream: false, prompt: 'Hello, my name is' }, { timeout: 60000 }).catch(() => { throw e; }));
      const j = JSON.parse(text), c = j.choices?.[0];
      const words = String(c?.message?.content || c?.message?.reasoning_content || c?.message?.reasoning || c?.text || '').trim();
      // Some builds load on GB10 but answer with one character over and over ("!!!!"): that isn't answering.
      if (words && /^(.)\1*$/su.test(words.replace(/\s+/g, '')) && words.replace(/\s+/g, '').length >= 4) {
        throw Object.assign(new Error(`It loaded but answers only garbage (“${words.slice(0, 20)}”)`), { garbage: true });
      }
      if (words) return words;
      // A thinking model can spend its few tokens thinking: tokens came back, so it answers.
      if (Number(j.usage?.completion_tokens) > 0) return `${j.usage.completion_tokens} tokens`;
      last = 'it answered with no words';
    } catch (e) { if (e.garbage) throw e; last = e.message; }
    if (Date.now() >= until) throw Object.assign(new Error(`It loaded but didn’t answer a test prompt: ${String(last).slice(0, 300)}`), { noAnswer: true });
    await sleep(Math.min(5000, Math.max(500, until - Date.now())));
  }
}
async function answers(job, host, port) {
  step(job, 'Checking it answers a test prompt');
  const words = await answerTest(host, port);
  note(job, `It answers a test prompt (${words.replace(/\s+/g, ' ').slice(0, 60)}${words.length > 60 ? '…' : ''})`);
}

async function measureSpeed(host, port) {
  const models = JSON.parse(await httpJson(host, port, '/v1/models', null, { timeout: 15000 }));
  const model = models.data?.[0]?.id;
  if (!model) throw new Error('it lists no model');
  const ask = max => ({ model, max_tokens: max, temperature: 0, stream: true, stream_options: { include_usage: true },
    chat_template_kwargs: { enable_thinking: false },
    messages: [{ role: 'user', content: 'Write a detailed, 400-word story about a lighthouse keeper who finds a message in a bottle.' }] });
  await httpJson(host, port, '/v1/chat/completions', ask(8));
  let first = null, buf = '', usage = null, pieces = 0;
  const start = Date.now();
  await httpJson(host, port, '/v1/chat/completions', ask(256), { onData: chunk => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:') || line.includes('[DONE]')) continue;
      try {
        const ev = JSON.parse(line.slice(5));
        const delta = ev.choices?.[0]?.delta;
        if (delta && (delta.content || delta.reasoning_content)) { pieces++; first ??= Date.now(); }
        if (ev.usage) usage = ev.usage;
      } catch {}
    }
  } });
  const end = Date.now(), tokens = usage?.completion_tokens || pieces;
  if (!first || tokens < 8) throw new Error('the answer was too short to time');
  return { decodeTokS: Math.round(((tokens - 1) / ((end - first) / 1000)) * 10) / 10, ttftMs: first - start, outputTokens: tokens };
}

// Records (or updates) one way of running a model, keyed by everything that affects how it runs.
async function recordVerified(job, { model, engine, image, args: rawArgs = [], env = {}, nodes, host, port, viewer, onlyIfNew = false, how = null, brain = false }) {
  const args = withoutShare(rawArgs.map(String));
  // A GGUF model's runs differ by the file (quantization) that ran.
  const file = engine === 'llama.cpp' ? how?.file || model.manifest?.file || model.ggufQuants?.[0] || null : null;
  const keyOf = n => JSON.stringify([model.repo || model.name, engine, image, n, args, env, ...(file ? [file] : [])]);
  if (onlyIfNew && verifiedList().some(v => v.key === keyOf(nodes.length))) return;
  let measured = null;
  step(job, 'Measuring its speed');
  try {
    measured = await measureSpeed(host, port);
    job.measured = measured;
    note(job, `Measured ${measured.decodeTokS} tokens/s, first token in ${(measured.ttftMs / 1000).toFixed(1)} s`);
  } catch (e) { note(job, `Couldn’t measure its speed: ${e.message}`); }
  const sparks = nodes.length, key = keyOf(sparks);
  const list = verifiedList(), now = new Date().toISOString(), found = list.find(v => v.key === key);
  const entry = found || { key, model: model.name, repo: model.repo || null, title: model.manifest?.title || model.repo || model.name, engine, image, args, env, sparks, ...(file ? { file } : {}), firstAt: now, runs: 0 };
  Object.assign(entry, { nodes, lastAt: now, by: viewer?.login || null, runs: entry.runs + 1, sizeBytes: model.sizeBytes || entry.sizeBytes || null,
    setupId: how?.setupId || entry.setupId || null, sourceUrl: how?.sourceUrl || entry.sourceUrl || null, ...(brain ? { brain: true } : {}) });
  if (measured) {
    entry.measured = { ...measured, at: now, nodes };
    if (!entry.best || measured.decodeTokS > entry.best.decodeTokS) entry.best = entry.measured;
  }
  try { writePrivate(VERIFIED_FILE, { deployments: found ? list : [...list, entry] }); } catch (e) { note(job, `Couldn’t save it as verified: ${e.message}`); }
}
// Whatever is already running when the service starts (deployed before this was recorded, or by hand) is adopted once,
// so every model that's ever been deployed ends up in Recipes.
async function adoptRunning() {
  const job = { log: [] };
  try {
    if (MAIN) {
      const m = await mainStatus();
      if (m.healthy) await recordVerified(job, { model: { name: MAIN.model, repo: repoOf(MAIN.model), manifest: { title: MAIN.title } }, engine: MAIN.engine, image: MAIN.image,
        args: (MAIN.args || []).map(String), env: MAIN.env || {}, nodes: [MAIN.node], host: '127.0.0.1', port: MAIN.port, onlyIfNew: true, brain: true });
      if (m.healthy) checkBrainSoon('start', { ifNone: true });
    }
    const inv = await inventory(null);
    for (const sp of inv.sparks.filter(x => x.online)) {
      for (const d of sp.deployments.filter(x => x.state === 'running' && x.role !== 'main' && !x.rank)) {
        const model = inv.library.find(m => m.name === d.model);
        if (!model) continue;
        const local = ALL_LOCAL || nodeById(sp.id)?.host === 'local', host = local && !d.cluster ? '127.0.0.1' : sp.tsip;
        // Only one that really answers counts as having worked (not one still loading or broken).
        if (!host || !(await servedModel(`http://${host}:${CONFIG.servePort}`).then(() => true, () => false))) continue;
        await recordVerified(job, { model, engine: engineOf(model), image: imageOf(model), args: (model.manifest?.args || []).map(String),
          env: d.cluster ? model.manifest?.cluster?.env || {} : {}, nodes: d.cluster ? d.cluster.split('+') : [sp.id],
          host: local && !d.cluster ? '127.0.0.1' : sp.tsip, port: CONFIG.servePort, onlyIfNew: true });
      }
    }
  } catch (e) { console.error(`Adopting running models: ${e.message}`); }
}
setTimeout(adoptRunning, 60000);

const verifiedView = v => ({ key: v.key, setupId: v.setupId || null, sourceUrl: v.sourceUrl || null, model: v.model, repo: v.repo, title: v.title, engine: v.engine, image: v.image, args: v.args, env: v.env, sparks: v.sparks, file: v.file || null,
  nodes: v.nodes, firstAt: v.firstAt, lastAt: v.lastAt, runs: v.runs, measured: v.measured || null, best: v.best || null });

