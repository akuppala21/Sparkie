/* ───────── finding setups ───────── */
// Area: knowledge        Rules: R10, R22, R27        Tests: dig.test.mjs, setups-look.test.mjs
// Owns: none
// Timers: none        Wakes: none
// For one Recipes model, every published way of running its versions on DGX Spark: NVIDIA's recipes, recipes.vllm.ai,
// Spark Arena's and eugr's recipe files, NVIDIA's developer forums and the model's own card (its code blocks only).
// The commands are read out of those by the service itself (dig.mjs), never written by a model. Sparkie only reads
// forum posts to say which speed belongs to which command, quoting the post, and the quote is checked against it. Each
// setup then goes through the same checks as the catalog's; its image is pinned to the exact build published now.
const webCache = new Map();
async function webGet(url, { ttl = 6 * 3600000, json = false, timeout = 20000 } = {}) {
  const hit = webCache.get(url);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const r = await fetch(url, { headers: { 'user-agent': 'spark-console', accept: json ? 'application/json' : '*/*' }, signal: AbortSignal.timeout(timeout) });
  if (r.status === 404) { webCache.set(url, { at: Date.now(), value: null }); return null; }
  if (!r.ok) throw Object.assign(new Error(`${new URL(url).host} answered ${r.status}`), { status: r.status });
  const text = await r.text();
  if (text.length > 4e6) throw new Error(`${new URL(url).host} sent too much`);
  const value = json ? JSON.parse(text) : text;
  webCache.set(url, { at: Date.now(), value });
  if (webCache.size > 1000) webCache.delete(webCache.keys().next().value);
  return value;
}
// Recipe files are YAML; Python's safe loader reads them (nothing in them runs).
function parseYaml(texts) {
  const py = `import sys, json
try:
    import yaml
except ImportError:
    print(json.dumps({"error": "PyYAML isn't installed on this Spark (sudo apt install python3-yaml)"})); sys.exit(0)
out = []
for t in json.load(sys.stdin):
    try:
        out.append(yaml.safe_load(t))
    except Exception:
        out.append(None)
print(json.dumps({"docs": out}, default=str))`;
  return new Promise(resolve => {
    const child = spawn('python3', ['-I', '-c', py], { stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
    child.stdout.on('data', d => { out += d; });
    child.on('error', () => resolve({ error: 'python3 isn’t available' }));
    child.on('close', () => {
      clearTimeout(timer);
      try { const r = JSON.parse(out); resolve(r.error ? { error: r.error } : { docs: r.docs }); } catch { resolve({ error: 'couldn’t read the recipe files' }); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(texts));
  });
}
const GH_RAW = 'https://raw.githubusercontent.com';
const indexes = new Map();
async function cachedIndex(name, build) {
  const hit = indexes.get(name);
  if (hit && Date.now() - hit.at < 6 * 3600000) return hit.value;
  const value = await build();
  indexes.set(name, { at: Date.now(), value });
  return value;
}
async function ghFiles(repo, test) {
  const tree = await webGet(`https://api.github.com/repos/${repo}/git/trees/main?recursive=1`, { json: true });
  if (!tree?.tree) throw new Error(tree?.message || `couldn’t list ${repo}`);
  return tree.tree.filter(x => x.type === 'blob' && test(x.path)).map(x => x.path);
}
// NVIDIA's recipes for DGX Spark (1, 2 or 4 Sparks), each with its measured performance when there is one.
const nvidiaIndex = () => cachedIndex('nvidia', async () => {
  const repo = 'NVIDIA/local-ai-inference-recipes';
  const all = new Set(await ghFiles(repo, p => p.startsWith('models/')));
  const paths = [...all].filter(p => /\/dgx-spark(-\dgpu)?\/linux\/.+\/recipe\.yaml$/.test(p)).slice(0, 150);
  const files = paths.flatMap(p => [p, p.replace(/recipe\.yaml$/, 'performance.yaml')]);
  const texts = await inBatches(files, 8, p => (all.has(p) ? webGet(`${GH_RAW}/${repo}/main/${p}`) : null));
  const parsed = await parseYaml(texts.map(t => t || ''));
  if (parsed.error) throw new Error(parsed.error);
  return paths.map((p, i) => dig.fromNvidia(parsed.docs[2 * i], parsed.docs[2 * i + 1], p)).filter(Boolean);
});
// Recipe files in the sparkrun format: Spark Arena's registry and eugr's spark-vllm-docker.
const sparkrunIndex = (name, repo, test, meta) => cachedIndex(name, async () => {
  const paths = (await ghFiles(repo, test)).slice(0, 150);
  const texts = await inBatches(paths, 8, p => webGet(`${GH_RAW}/${repo}/main/${p}`));
  const parsed = await parseYaml(texts.map(t => t || ''));
  if (parsed.error) throw new Error(parsed.error);
  return paths.map((p, i) => dig.fromSparkrun(parsed.docs[i], p, { ...meta, url: `https://github.com/${repo}/blob/main/${p}` })).filter(Boolean);
});
const arenaIndex = () => sparkrunIndex('arena', 'spark-arena/recipe-registry', p => /^(official|experimental)-recipes\/.+\.ya?ml$/.test(p), { kind: 'spark-arena', author: 'Spark Arena' });
const eugrIndex = () => sparkrunIndex('eugr', 'eugr/spark-vllm-docker', p => /^recipes\/.+\.ya?ml$/.test(p), { kind: 'eugr', author: 'eugr (spark-vllm-docker)' });
async function vllmRecipeSetups(repos) {
  const out = await inBatches(repos.slice(0, 8), 4, async repo => {
    const j = await webGet(`https://recipes.vllm.ai/${repo}/hw/dgx_spark_gb10.json`, { json: true }).catch(() => null);
    return j && dig.fromVllmRecipes(j, `https://recipes.vllm.ai/${repo}`);
  });
  return out.filter(Boolean);
}
// The model's own card on Hugging Face, for each of its own versions (never a base model's). A card that can't be read
// without signing in (a gated model) counts as no card. The stand-in fleet reads it from its dig fixture, never the web.
async function cardText(repo) {
  if (DIG_FIXTURE) return hfFixture(repo)?.card || null;
  return webGet(`https://huggingface.co/${repo}/raw/main/README.md`).catch(e => { if (e.status === 401 || e.status === 403) return null; throw e; });
}
async function cardSetups(repos) {
  const out = [];
  for (const repo of repos.slice(0, 8)) out.push(...dig.fromCard(await cardText(repo), repo));
  return out;
}
const squash = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// A container image named by tag is pinned to the exact build the tag points at now (its digest), and checked for an
// ARM64 build. Docker Hub, GitHub's and NVIDIA's registries answer anonymous reads.
const pinCache = new Map();
async function pinImage(image) {
  if (dig.isDigest(image)) return { image, arm64: null };
  const hit = pinCache.get(image);
  if (hit && Date.now() - hit.at < 6 * 3600000) return hit.value;
  const m = /^(?:([\w-]+(?:\.[\w-]+)+(?::\d+)?)\/)?([a-z0-9]+(?:[._/-][a-z0-9]+)*)(?::(\w[\w.-]{0,127}))?$/.exec(image);
  if (!m) throw new Error('not an image name');
  let [, host = 'docker.io', path, tag = 'latest'] = m;
  if (host === 'docker.io' && !path.includes('/')) path = `library/${path}`;
  const registry = host === 'docker.io' ? 'registry-1.docker.io' : host;
  const tokenUrl = { 'docker.io': `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${path}:pull`,
    'ghcr.io': `https://ghcr.io/token?scope=repository:${path}:pull`, 'nvcr.io': `https://nvcr.io/proxy_auth?scope=repository:${path}:pull` }[host];
  if (!tokenUrl) throw new Error(`images on ${host} can’t be checked`);
  const { token } = await (await fetch(tokenUrl, { signal: AbortSignal.timeout(15000) })).json();
  const auth = { authorization: `Bearer ${token}` };
  const r = await fetch(`https://${registry}/v2/${path}/manifests/${tag}`, { headers: { ...auth, accept: 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw Object.assign(new Error(r.status === 404 ? 'its image tag doesn’t exist any more' : `${host} answered ${r.status}`), { status: r.status });
  const bytes = Buffer.from(await r.arrayBuffer());
  const digest = r.headers.get('docker-content-digest') || `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const body = JSON.parse(bytes.toString('utf8'));
  let arm64 = null;
  if (Array.isArray(body.manifests)) arm64 = body.manifests.some(x => x.platform?.architecture === 'arm64');
  else if (body.config?.digest) {
    const c = await fetch(`https://${registry}/v2/${path}/blobs/${body.config.digest}`, { headers: auth, signal: AbortSignal.timeout(20000) }).then(x => (x.ok ? x.json() : null)).catch(() => null);
    arm64 = c?.architecture ? c.architecture === 'arm64' : null;
  }
  const value = { image: `${image}@${digest}`, arm64 };
  pinCache.set(image, { at: Date.now(), value });
  return value;
}
const SOURCE_RANK = { nvidia: 0, 'vllm-recipes': 1, 'spark-arena': 2, eugr: 3, forum: 4, 'model-card': 5 };
// The stand-in fleet can't reach the web: SPARK_CONSOLE_DIG_FIXTURE there is a JSON list of raw setups, as the sources
// give them (dig.fromNvidia's shape), read instead of NVIDIA's recipes and the rest.
// Without one (most of the stand-in fleets), a look reads nothing, so no test reaches the web.
const DIG_FIXTURE = ALL_LOCAL ? process.env.SPARK_CONSOLE_DIG_FIXTURE || 'none' : null;
async function digModel(job, viewer, modelId) {
  const m = recipeCatalog().models.find(x => x.id === modelId);
  if (!m) throw new Error('That model isn’t in Recipes any more.');
  // It starts from the model's own versions (the catalog's and the owner's), never from what an earlier search added.
  const before = foundSetups()[m.id]?.variants || [];
  const own = m.variants.filter(v => !before.some(x => sameRepo(x.repo, v.repo)) || addedModels().some(a => a.variants.some(x => sameRepo(x.repo, v.repo))));
  // (versions the owner added come first: a repo that joined a big family, A9, is read even past its first twelve)
  const mine = v => addedModels().some(a => a.variants.some(x => sameRepo(x.repo, v.repo)));
  const repos = [...new Set([...own.filter(mine), ...own].map(v => v.repo).filter(r => REPO_RE.test(String(r))))].slice(0, 12);
  step(job, `Reading ${m.title} on Hugging Face`);
  // A version quantized from another repo is the same model, so setups for that repo count too. A fine-tune (abliterated,
  // merged, adapted) is not: its base model's setups belong to the base.
  const bases = new Set();
  await inBatches(DIG_FIXTURE ? [] : repos.slice(0, 8), 4, async repo => {
    const info = await hfJson(`/api/models/${repo}?expand[]=tags`);
    for (const t of info.tags || []) {
      // Uploaders sometimes tag a fine-tune's quantization as quantized from the original, so the names must agree too.
      const b = /^base_model:quantized:(.+)$/.exec(t)?.[1], mine = modelKey(repo), theirs = modelKey(b);
      if (REPO_RE.test(String(b)) && mine.startsWith(theirs) && !FINETUNE.test(mine.slice(theirs.length))) bases.add(b);
    }
  });
  const all = [...new Set([...repos, ...bases])];
  const keys = new Set(all.map(modelKey)), lower = new Set(all.map(r => r.toLowerCase()));
  const ours = r => r?.about || (Boolean(r?.repo) && !SKIP_REPO.test(r.repo) && (lower.has(String(r.repo).toLowerCase()) || keys.has(modelKey(r.repo))));
  // (last: the model's own card, for its own versions only)
  const card = ['the model’s card on Hugging Face', async () => (await cardSetups(repos)).filter(ours)];
  const sources = DIG_FIXTURE ? [['NVIDIA’s DGX Spark recipes', async () => (DIG_FIXTURE === 'none' ? [] : JSON.parse(readFileSync(DIG_FIXTURE, 'utf8')).filter(ours))], card] : [
    ['NVIDIA’s DGX Spark recipes', async () => (await nvidiaIndex()).filter(ours)],
    ['vLLM recipes', async () => (await vllmRecipeSetups(all)).filter(ours)],
    ['Spark Arena', async () => (await arenaIndex()).filter(ours)],
    ['eugr’s spark-vllm-docker', async () => (await eugrIndex()).filter(ours)],
    card,
  ];
  const raws = [], report = [];
  for (const [name, fn] of sources) {
    step(job, `Looking in ${name}`);
    try {
      const found = await fn();
      raws.push(...found);
      report.push({ name, found: found.length });
      note(job, `${name}: ${found.length} found`);
    } catch (e) {
      report.push({ name, found: 0, error: e.message.slice(0, 160) });
      note(job, `${name}: couldn’t read it (${e.message})`);
    }
  }
  step(job, 'Checking each one’s image and flags');
  const rules = { engines: ENGINES, sources: CONFIG.imageSources, defaultImage: e => CONFIG.images[e] || null };
  const setups = [], seen = new Set();
  for (const raw of raws) {
    if (raw.image && !dig.isDigest(raw.image) && dig.imageApproved(raw.image, CONFIG.imageSources)) {
      try { const p = await pinImage(raw.image); raw.image = p.image; raw.arm64 = p.arm64; } catch (e) { if (e.status === 404) raw.why ||= e.message; }
    }
    const st = dig.vetSetup(raw, rules);
    if (!st) continue;
    // A setup on fewer Sparks than its version needs can't hold it (model cards often show a bigger GPU's command).
    const v = st.repo && own.find(x => sameRepo(x.repo, st.repo));
    if (v?.sparks && st.sparks < v.sparks && !st.report) Object.assign(st, { deployable: false, why: `${st.repo.split('/')[1]} needs ${v.sparks} Sparks; this setup uses ${st.sparks}` });
    // The same command found in two places counts once; the more official source is kept.
    const same = st.report ? st.id : JSON.stringify([String(st.repo).toLowerCase(), st.engine, st.sparks, st.args, st.file || null]);
    if (seen.has(st.id) || seen.has(same)) continue;
    seen.add(st.id); seen.add(same);
    setups.push(st);
  }
  setups.sort((a, b) => b.deployable - a.deployable || (SOURCE_RANK[a.source.kind] ?? 9) - (SOURCE_RANK[b.source.kind] ?? 9) || (b.perf.decodeTokS || 0) - (a.perf.decodeTokS || 0));
  step(job, 'Reading the versions those setups use');
  const newRepos = [...new Set(setups.map(s => s.repo).filter(r => r && REPO_RE.test(r) && !own.some(v => sameRepo(v.repo, r))))].slice(0, 8);
  const variants = (await inBatches(DIG_FIXTURE ? [] : newRepos, 4, versionOf)).filter(Boolean).map(v => ({ ...variantFields(v), community: true }));
  const result = { found: setups.length, oneClick: setups.filter(s => s.deployable).length };
  // A look where a source failed never loses what an earlier look found from it, and isn't stamped as fresh (so the
  // next look that needs it tries again, not one a week later): review, 2026-11-11.
  const earlier = foundSetups()[m.id], failedSources = new Set(report.filter(r => r.error).map(r => r.name));
  const kept = failedSources.size && earlier?.setups ? earlier.setups.filter(st => !setups.some(x => x.id === st.id)) : [];
  const at = failedSources.size && earlier?.at ? earlier.at : new Date().toISOString();
  writePrivate(FOUND_FILE, { models: { ...foundSetups(), [m.id]: { at, by: viewer.login, sources: report, variants, setups: [...setups, ...kept].slice(0, 40) } } });
  note(job, `${m.title}: ${result.found} setup${result.found === 1 ? '' : 's'} found, ${result.oneClick} one click`);
  job.result ||= result;
  return result;
}
const startDig = (viewer, id, title) => {
  if ([...jobs.values()].some(j => j.status === 'running' && j.type === 'dig' && j.modelId === id)) return null;
  return runJob(newJob('dig', { model: title, modelId: id, by: viewer.login }), j => digModel(j, viewer, id));
};

// Spark Console looks for a model's best setups by itself (2026-11-11, the owner: every time it should know the best
// and be able to start it, researched ahead of time): after a download, before a start picks the setup for a model it
// just downloaded, and before recipe_detail answers (lookedUp); each only when the last look is over a
// week old. A look reads NVIDIA's recipe files,
// vLLM's recipes, Spark Arena, eugr's spark-vllm-docker and the model's own card, and keeps the setups with their
// commands (found-setups.json).
const SETUPS_FRESH_MS = 7 * 24 * 3600000;
const AUTO_DIG = !ALL_LOCAL || (Boolean(DIG_FIXTURE) && DIG_FIXTURE !== 'none');
const LOOKER = { login: 'Spark Console', role: 'owner' };
const recipeIdOf = repo => recipeCatalog().models.find(m => m.variants.some(v => sameRepo(v.repo, repo)))?.id || null;
function setupsStale(id) { const at = Date.parse(foundSetups()[id]?.at || ''); return !at || Date.now() - at > SETUPS_FRESH_MS; }
async function refreshSetups(viewer, repo, { job = null, wait = false } = {}) {
  const id = AUTO_DIG && recipeIdOf(repo);
  if (!id || !setupsStale(id)) return null;
  const title = recipeCatalog().models.find(m => m.id === id)?.title || repo;
  const d = [...jobs.values()].find(j => j.status === 'running' && j.type === 'dig' && j.modelId === id) || startDig(viewer || LOOKER, id, title);
  if (job) note(job, `Looking for ${title}’s best setups (NVIDIA’s recipe files, vLLM’s, Spark Arena, eugr’s, its model card)`);
  if (wait && d) await waitJob(d.id, 150000);
  return d;
}
// Nothing looks by the clock (owner decision 5; contract 7.11 and 8.0; design C step 7, as cut on 2026-11-14): the daily
// look is gone. The lookup that reads a model's setups (recipe_detail) looks first, as a start does, when the last look
// is over a week old (SETUPS_FRESH_MS) or there was none; it waits up to 40 s (a call is cut at 50), then answers from
// the list as it is. A look that couldn't read a source keeps what it had (digModel), and the answer says how old it is.
async function lookedUp(m) {
  if (!m) return m;
  const repo = m.variants.map(v => v.repo).find(r => recipeIdOf(r) === m.id);
  const look = repo ? await refreshSetups(LOOKER, repo).catch(() => null) : null;
  if (look) await waitJob(look.id, 40000);
  const now = recipeCatalog().models.find(x => x.id === m.id) || m, f = foundSetups()[m.id];
  const days = f?.at ? Math.floor((Date.now() - Date.parse(f.at)) / 86400000) : null;
  const failed = (f?.sources || []).filter(s => s.error).map(s => s.name);
  const when = days === null ? 'never' : days < 1 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`;
  const why = look?.status === 'running' ? `hasn’t finished (operation ${look.id})` : failed.length ? `couldn’t read ${failed.join(' or ')}` : 'didn’t work';
  now.lookedUp = { at: f?.at || null, when, ...(failed.length ? { couldntRead: failed } : {}),
    ...(look && setupsStale(m.id) ? { note: `Looking again just now ${why}, so ${days === null ? 'only Recipes’ own setups are listed' : `these setups are from ${when}`}.` } : {}) };
  return now;
}

const catalogSetup = id => { for (const m of recipeCatalog().models) for (const st of m.setups || []) if (st.id === id) return { model: m, setup: st }; return null; };
const sameRepo = (a, b) => Boolean(a && b) && String(a).toLowerCase() === String(b).toLowerCase();

// A setup that runs speculative decoding with a separate draft model, without saying where that draft is. An ordinary
// start doesn't fetch or mount a draft model, so the engine would refuse to start ("DFLASH speculative decoding
// requires setting --speculative-draft-model-path", seen 2026-11-08 when the brain's own setup was reused on Spark 3).
// N-gram speculation needs no draft.
function needsDraftModel(args = []) {
  const a = args.map(String), i = a.indexOf('--speculative-algorithm');
  const alg = (i >= 0 ? a[i + 1] : a.find(x => x.startsWith('--speculative-algorithm='))?.split('=')[1] || '').toUpperCase();
  return Boolean(alg) && alg !== 'NGRAM' && !a.some(x => x.startsWith('--speculative-draft-model-path'));
}
// The brain's proven run, made ordinary for another Spark: the same engine, image and settings (proven on these Sparks
// for this exact model), without what ties it to the hub: the speculative draft model, a context stretched past the
// model's own, and the brain's cache folders. Checked like any other setup.
function plainFromBrain(v, model, viewer) {
  if (!(CONFIG.imageSources || []).some(p => String(v.image || '').startsWith(p))) return null;
  const a = withoutShare((v.args || []).map(String)), out = [], native = Number(model?.contextLength) || 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], [flag, inline] = x.split('=');
    const value = inline !== undefined ? inline : a[i + 1] !== undefined && !String(a[i + 1]).startsWith('--') ? a[++i] : undefined;
    if (flag.startsWith('--speculative-')) continue;
    if (flag === '--context-length' || flag === '--max-model-len') {
      const n = Number(value);
      // Stretched (YaRN on the hub) past the model's own: back to the model's own, or left to the engine.
      if (native) out.push(flag, String(Math.min(n, native)));
      else if (n && n <= 262144) out.push(flag, String(n));
      continue;
    }
    out.push(flag, ...(value !== undefined ? [value] : []));
  }
  const check = dig.cleanFlags(out, v.repo || model?.repo);
  if (check.problems.length || dig.remoteCode(check.args)) return null;
  const env = Object.fromEntries(Object.entries(v.env || {}).filter(([k, val]) => !String(val).startsWith('/kernel-cache') && k !== 'SGLANG_ALLOW_OVERWRITE_LONGER_CONTEXT_LEN'));
  return { engine: v.engine, image: v.image, args: check.args, env: dig.cleanEnv(env), file: v.file || null, setupId: null, sourceUrl: null, fromBrain: true };
}
// Turns a deploy's named setup or verified run into how to run it, after checking it may run as-is: it must fit this
// many Sparks, match the model on disk, be one-click, have only flags that are safe as written (checked again here,
// whatever the setup's source said), and only the owner may let a model run its own code.
function resolveHow(body, viewer, modelName, sparks, library) {
  const model = library.find(m => m.name === modelName);
  let how = null;
  if (body.setup) {
    const hit = catalogSetup(String(body.setup));
    if (!hit) throw new HttpError(404, 'That setup isn’t in Recipes any more.');
    const st = hit.setup;
    if (!st.deployable) throw new HttpError(409, `That setup isn’t one-click: ${st.why}.`);
    if (st.repo && model && !(model.repo ? sameRepo(st.repo, model.repo) : onDiskAs(model, st.repo))) throw new HttpError(409, `That setup is for ${st.repo}, not ${model.repo || model.name}.`);
    if (st.sparks !== sparks) throw new HttpError(409, `That setup is for ${st.sparks} Spark${st.sparks > 1 ? 's' : ''}.`);
    const check = dig.cleanFlags(st.args, st.repo);
    if (check.problems.length) throw new HttpError(409, `That setup can’t run as written: it ${check.problems[0]}.`);
    if (needsDraftModel(check.args)) throw new HttpError(409, 'That setup needs a separate draft model for speculative decoding, which an ordinary start doesn’t load yet.');
    how = { engine: st.engine, image: st.image, args: check.args, env: dig.cleanEnv(st.env), file: st.file || null, setupId: st.id, sourceUrl: st.source?.url || null };
  } else if (body.verified) {
    const v = verifiedList().find(x => x.key === String(body.verified));
    if (!v) throw new HttpError(404, 'That verified run isn’t recorded any more.');
    if (v.model !== modelName && !sameRepo(v.repo, model?.repo)) throw new HttpError(409, 'That verified run is for another model.');
    if (v.sparks !== sparks) throw new HttpError(409, `That run used ${v.sparks} Spark${v.sparks > 1 ? 's' : ''}.`);
    // The brain's own runs (the hub, with its draft model and stretched context) are recipes to look at, not to repeat.
    if (v.brain || needsDraftModel(v.args)) throw new HttpError(409, `That run is the brain’s own setup, with a draft model and context only ${hubName()} has, so it can’t be repeated as an ordinary start.`);
    if (v.source === 'seen' && v.approved !== true) throw new HttpError(409, 'That run was learned from a container started outside Spark Console; it needs the owner’s OK before it can be deployed.');
    // Every past run is checked again, as strictly as a new setup: its image source, its flags and its environment.
    if (!(CONFIG.imageSources || []).some(p => String(v.image || '').startsWith(p))) throw new HttpError(409, `That run’s image (${v.image}) isn’t from a source Spark Console trusts.`);
    const check = dig.cleanFlags(withoutShare(v.args || []), v.repo || model?.repo);
    if (check.problems.length) throw new HttpError(409, `That run can’t be repeated as written: it ${check.problems[0]}.`);
    how = { engine: v.engine, image: v.image, args: check.args, env: dig.cleanEnv(v.env), file: v.file || null, setupId: v.setupId || null, sourceUrl: v.sourceUrl || null };
  }
  if (how && dig.remoteCode(how.args)) {
    if (viewer.role !== 'owner') throw new HttpError(403, 'This setup lets the model run its own code. Only the owner can allow that.');
    if (body.allowRemoteCode !== true) throw new HttpError(409, 'This setup lets the model run its own code. Allow it to deploy.');
  }
  return how;
}

// (plain names only, as in the library's scan: a line break in a folder's name would add a model of its own, R53)
const SCAN_SCRIPT = `for d in ${MODELS}/*; do n=\${d##*/}; case "$n" in ''|*[!A-Za-z0-9._-]*) continue ;; esac; printf 'model\\t%s\\n' "$n"; done
for d in ${HF_HUB}/models--*; do n=\${d##*/models--}; case "$n" in ''|*[!A-Za-z0-9._-]*) continue ;; esac; printf 'hf\\t%s\\n' "$n"; done
printf 'disk\\t%s\\n' "$(df -B1 --output=avail "$HOME" 2>/dev/null | tail -1 | tr -d ' ')"`;

// Download targets are the online Sparks; the default is the preferred home, else the one with the most free disk.
async function downloadTargets(viewer) {
  const scans = await Promise.all(NODES.map(async n => [n, await run(n, SCAN_SCRIPT, { timeout: 20000 })]));
  const present = new Set(), targets = [], where = new Map();
  const at = (key, id) => { present.add(key); where.set(key, [...(where.get(key) || []), id]); };
  for (const [n, r] of scans) {
    if (r.code !== 0) continue;
    for (const [name] of fields(r.out, 'model')) at(name, n.id);
    for (const [key] of fields(r.out, 'hf')) at(`hf:${key}`, n.id);
    targets.push({ id: n.id, diskFree: Number((fields(r.out, 'disk')[0] || [])[0]) || null });
  }
  const best = targets.find(t => t.id === CONFIG.modelsHost) || [...targets].sort((a, b) => (b.diskFree || 0) - (a.diskFree || 0))[0];
  return { present, where, targets, defaultTarget: best?.id || null };
}

async function recipes(viewer) {
  const catalog = recipeCatalog();
  const { where, targets, defaultTarget } = await downloadTargets(viewer);
  const onDisk = repo => where.get(`hf:${String(repo).replace('/', '--')}`) || where.get(String(repo).split('/').pop()) || [];
  const ver = verifiedList().map(verifiedView);
  const repos = new Set(catalog.models.flatMap(m => m.variants.map(v => String(v.repo).toLowerCase())));
  return {
    modelsHost: CONFIG.modelsHost, libraryOnline: targets.length > 0, targets, defaultTarget, updated: catalog.updated,
    models: catalog.models.map(m => ({ ...m, variants: m.variants.map(v => ({ ...v, onDisk: onDisk(v.repo) })),
      verified: ver.filter(x => m.variants.some(v => sameRepo(v.repo, x.repo))) })),
    // Deploys that aren't in the catalog still get a recipe: "From your deploys".
    yours: ver.filter(x => !x.repo || !repos.has(String(x.repo).toLowerCase())),
    playbooks: catalog.playbooks,
  };
}

// Engine images that carry the Hugging Face library, and the download run with it (see downloadVersion).
const HF_IMAGES = 'lmsysorg/sglang|vllm/vllm-openai|nvcr\\.io/nvidia/vllm|nvcr\\.io/nvidia/sglang|eugr/spark-vllm[^ ]*';
const HF_PULL_PY = String.raw`
import json, sys
from huggingface_hub import snapshot_download
repo, allow, ignore = sys.argv[1], json.loads(sys.argv[2]), json.loads(sys.argv[3])
snapshot_download(repo, allow_patterns=allow or None, ignore_patterns=ignore or None, max_workers=16)
print('downloaded', repo, flush=True)
`;
// A version goes into the Spark's Hugging Face cache, where the library and deploys find it. Weights in pickle formats
// and duplicate copies (original/, consolidated) are skipped; safetensors, configs and tokenizers come down. A GGUF
// version downloads only the chosen quantization's files (and its vision projector, if it has one).
async function downloadVersion(job, repo, host, quant = null) {
  const dir = `${HF_HUB}/models--${repo.replace('/', '--')}`;
  let what = `--exclude 'original/*' '*.pth' '*.bin' '*.pt' 'consolidated*'`;
  if (quant) {
    const info = await hfJson(`/api/models/${repo}?blobs=true&expand[]=siblings`, 20000);
    const { quants, mmproj } = dig.ggufFiles(info.siblings);
    const pick = quants.find(x => x.file === quant);
    if (!pick) throw new Error(`${repo} has no ${quant} files any more.`);
    what = [...pick.files, ...(mmproj ? [mmproj] : [])].map(q).join(' ');
    job.total = pick.bytes || job.total;
  }
  step(job, `Downloading ${repo}${quant ? ` (${quant})` : ''} to ${host.id}`);
  let done = false;
  const watch = (async () => {
    while (!done) {
      await sleep(4000);
      const s = await run(host, `du -sb ${dir} 2>/dev/null | cut -f1`, { timeout: 20000 });
      if (!done && Number(s.out)) job.progress = { done: Number(s.out), total: job.total || null };
    }
  })();
  // Without the hf command on the Spark, the Hugging Face library inside an engine image already there does it (they
  // all carry it; the models already on Spark 3 and 4 came down that way). It runs as the owner where the cache is
  // theirs, so the files stay theirs (2026-11-11: neither Spark had the command, and GLM-5.3-Flash couldn't download).
  // Only the cache (and the sign-in token) come from the Spark; the library's own home (xet's logs and chunk cache) is
  // the container's /tmp, which any user can write (/hf wasn't, and xet stopped with "Permission denied").
  const allow = quant ? what.split(' ').map(x => x.replace(/^'|'$/g, '')) : [], ignore = quant ? [] : ['original/*', '*.pth', '*.bin', '*.pt', 'consolidated*'];
  const hostCli = !(ALL_LOCAL && existsSync(`${process.env.MOCK_ROOT}/${host.id}/.mock/no-hf`));
  const inImage = `img=$(docker images --format '{{.Repository}} {{.ID}}' 2>/dev/null | grep -E ${q(`^(${HF_IMAGES}) `)} | head -1)
if [ -z "$img" ]; then echo "NO_HF_CLI"; exit 3; fi
echo "HF_IN_IMAGE \${img% *}"
hub=${HF_HUB}; tok="\${HF_HOME:-$HOME/.cache/huggingface}/token"; mkdir -p "$hub" 2>/dev/null
set -- -v "$hub":/hf/hub; [ -f "$tok" ] && set -- "$@" -v "$tok":/hf/token:ro -e HF_TOKEN_PATH=/hf/token; [ -w "$hub" ] && { [ ! -e "$hub/.locks" ] || [ -w "$hub/.locks" ]; } && set -- "$@" --user "$(id -u):$(id -g)"
docker run --rm --network host -e HOME=/tmp -e HF_HOME=/tmp/hf -e HF_HUB_CACHE=/hf/hub -e HF_XET_HIGH_PERFORMANCE=1 "$@" --entrypoint python3 "\${img#* }" -c ${q(HF_PULL_PY)} ${q(repo)} ${q(JSON.stringify(allow))} ${q(JSON.stringify(ignore))}`;
  // Many files at once, and xet's high-performance mode (more connections per file): the defaults fetched GLM-5.3-Flash
  // at about 17 MB/s on a 500 Mbit/s line (2026-11-11).
  const r = await run(host, hostCli ? `export HF_XET_HIGH_PERFORMANCE=1
if command -v hf >/dev/null 2>&1; then hf download ${q(repo)} ${what} --max-workers 16
elif command -v huggingface-cli >/dev/null 2>&1; then huggingface-cli download ${q(repo)} ${what} --max-workers 16
else
${inImage}
fi` : inImage, { timeout: 6 * 3600000, signal: job.abort?.signal, onLine: line => { job.detail = line.slice(0, 200); } });
  done = true;
  await watch;
  cancelCheck(job);
  if (r.out.includes('NO_HF_CLI')) throw new Error(`${host.id} has nothing to download with: downloads go through the Hugging Face library inside an engine image (SGLang or vLLM), and there is none on ${host.id} yet. Pull one there (the image a recipe for that engine names), then try again.`);
  const used = /HF_IN_IMAGE (\S+)/.exec(r.out)?.[1];
  if (used && !r.code) note(job, `Downloaded with the Hugging Face library inside ${used} (${host.id} has no hf command)`);
  if (r.code) {
    const why = (r.err || r.out).slice(-1500);
    // A refusal is Hugging Face's answer (401/403, gated), not a traceback's line number (", line 401,").
    throw new Error(/\b(?:401|403)\b(?! in )(?:[^\n]{0,40}(?:Client Error|Unauthorized|Forbidden))|gated repo|is gated|Access to model[^\n]{0,120}is restricted|accept the (?:license|conditions)/i.test(why) ? `Hugging Face refused the download. Accept the model’s license on huggingface.co and sign in on ${host.id} with: hf auth login\n${why}` : why);
  }
  job.progress = null;
}


