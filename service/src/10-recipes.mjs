/* ───────── recipes ───────── */
// Recipes: service/catalog.json (built by tools/build-catalog.py from the research): models → versions → setups, plus
// models the owner added (~/.local/state/spark-console/added-models.json) and the setups the finder dug up for any
// model (found-setups.json, one entry per model, replaced each time it looks again).
const ADDED_FILE = `${STATE_DIR}/added-models.json`;
const FOUND_FILE = `${STATE_DIR}/found-setups.json`;
const addedModels = () => { const a = readKept(ADDED_FILE); return Array.isArray(a?.models) ? a.models : []; };
const foundSetups = () => { const f = readKept(FOUND_FILE); return f?.models && typeof f.models === 'object' ? f.models : {}; };
function recipeCatalog() {
  const base = readJsonFile('catalog.json') || { models: [], playbooks: [] };
  const models = base.models.map(m => ({ ...m, setups: [...(m.setups || [])] }));
  for (const a of addedModels()) {
    const same = models.find(m => m.id === a.id);
    if (same) same.variants = [...same.variants, ...a.variants.filter(v => !same.variants.some(x => sameRepo(x.repo, v.repo)))];
    else models.push({ ...a, setups: [...(a.setups || [])] });
  }
  const found = foundSetups();
  for (const m of models) {
    const f = found[m.id];
    if (!f) continue;
    m.variants = [...m.variants, ...(f.variants || []).filter(v => !m.variants.some(x => sameRepo(x.repo, v.repo)))];
    const have = new Set(m.setups.map(s => s.id));
    m.setups = [...m.setups, ...(f.setups || []).filter(s => !have.has(s.id))];
    m.dug = { at: f.at, by: f.by, sources: f.sources || [] };
  }
  // NVIDIA's list of tested models names each one's image and settings, but not its command, so the catalog's entries
  // from it have no flags: one-click, they'd run the engine's defaults (2026-11-11: 16 of them, GLM-5.3-Flash and
  // MiniMax M2.7 among them). They aren't one-click; the setup from NVIDIA's recipe file (Find setups) has the command.
  for (const m of models) {
    for (const [i, s] of m.setups.entries()) {
      if (s.deployable === false || (s.args || []).length || s.source?.kind !== 'nvidia') continue;
      const twin = m.setups.find(x => x !== s && x.deployable !== false && (x.args || []).length && x.sparks === s.sparks && sameRepo(x.repo, s.repo)
        && /github\.com\/NVIDIA\//.test(x.source?.url || ''));
      m.setups[i] = { ...s, deployable: false, ...(twin ? { replacedBy: twin.id } : {}),
        why: twin ? 'NVIDIA’s model list gives its image, not its command; the setup from NVIDIA’s recipe file has the command'
          : 'NVIDIA’s model list gives its image, not its command; Find setups reads NVIDIA’s recipe file, which has it' };
    }
    // Only setups that hold up (the owner, 2026-11-11: confirmed ones people talk about, not one-offs with numbers
    // nobody else reports): low-credibility ones (single unverified posts, experimental registry entries) aren't
    // listed, nor is an NVIDIA list entry once its recipe file is known.
    m.setups = m.setups.filter(s => s.credibility !== 'low' && !s.replacedBy);
  }
  return { ...base, models };
}

/* ───────── finding models on Hugging Face ───────── */
// Sparkie turns what someone types into search terms; it only ever sees their words, never anything from the web.
// The service then searches Hugging Face itself and reads each candidate's real size, gated status and quantization
// from its own files. Safetensors are served by vLLM, SGLang or TensorRT-LLM; GGUF files by llama.cpp. Abliterated
// and other community fine-tunes are models like any other.
const QUANT_SUFFIX = /[-_.](nvfp4|mxfp4|fp8(-dynamic)?|fp4(-local)?|bf16|fp16|awq|gptq|int4(-autoround)?|int8|w4a16|w8a8|autoround|4bit|8bit|gguf)$/i;
function modelKey(repo) {
  let s = String(repo || '').split('/').pop().toLowerCase();
  for (let i = 0; i < 5; i++) s = s.replace(QUANT_SUFFIX, '').replace(/[-.](instruct|it|chat|hf)$/, '');
  return s;
}
// Left out: formats no engine here serves (MLX, ONNX, OpenVINO, phone builds, EXL) and draft models (DFlash, EAGLE,
// MTP heads), which speed up a main model and don't run on their own.
const SKIP_REPO = /mlx|-exl\d|onnx|openvino|litert|coreml|-qnn|dflash|dspark|eagle|-draft|-mtp\b/i;
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
// Words that mark a fine-tune of a model rather than the model itself.
const FINETUNE = /abliterat|uncensor|heretic|merge|distill|finetune|lora|dpo|sft|roleplay|\brp\b/i;
// The stand-in fleet never reaches Hugging Face (tests on GitHub's machines would be rate-limited): there
// SPARK_CONSOLE_HF_FIXTURE is a JSON list of what /api/models/<repo> answers, one entry per repo, and a search lists the
// entries whose id holds every word searched. 'none', the default there, answers as Hugging Face does when it can't be
// reached. Ignored on the real Sparks.
const HF_FIXTURE = ALL_LOCAL ? process.env.SPARK_CONSOLE_HF_FIXTURE || 'none' : null;
function hfFixtureAnswer(path) {
  if (HF_FIXTURE === 'none') throw new Error('the stand-in fleet doesn’t reach Hugging Face');
  let list = [];
  try { list = JSON.parse(readFileSync(HF_FIXTURE, 'utf8')); } catch {}
  if (!Array.isArray(list)) list = [];
  const u = new URL(path, 'https://huggingface.co'), one = /^\/api\/models\/([^/]+\/[^/]+)$/.exec(u.pathname);
  const hit = one && list.find(x => sameRepo(x?.id, decodeURIComponent(one[1])));
  if (hit) return structuredClone(hit);
  if (u.pathname !== '/api/models') throw Object.assign(new Error('Hugging Face answered 404'), { status: 404 });
  const words = String(u.searchParams.get('search') || '').toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter(x => typeof x?.id === 'string' && words.every(w => x.id.toLowerCase().includes(w)))
    .sort((a, b) => (b.downloads || 0) - (a.downloads || 0)).slice(0, Number(u.searchParams.get('limit')) || 30)
    .map(x => ({ id: x.id, downloads: x.downloads || 0, tags: x.tags || [] }));
}
async function hfJson(path, timeout = 15000) {
  if (HF_FIXTURE) return hfFixtureAnswer(path);
  const r = await fetch(`https://huggingface.co${path}`, { headers: { accept: 'application/json', 'user-agent': 'spark-console' }, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw Object.assign(new Error(`Hugging Face answered ${r.status}`), { status: r.status });
  return r.json();
}
function quantOf(cfg, repo) {
  const q = cfg?.quantization_config || {};
  const m = String(q.quant_method || '').toLowerCase(), fmt = String(q.format || '').toLowerCase(), algo = String(q.quant_algo || '').toUpperCase();
  if (m === 'modelopt') return algo.includes('FP4') || algo === 'MIXED_PRECISION' ? 'NVFP4' : algo || (/(NVFP4|FP8)/i.exec(repo)?.[1] || 'NVFP4').toUpperCase();
  if (m === 'compressed-tensors') return fmt.includes('nvfp4') ? 'NVFP4' : fmt.includes('float') ? 'FP8' : fmt.includes('pack') ? 'INT4' : 'compressed';
  if (m) return { fp8: 'FP8', mxfp4: 'MXFP4', awq: 'INT4 (AWQ)', gptq: 'INT4 (GPTQ)', bitsandbytes: '4/8-bit' }[m] || m.toUpperCase();
  return (/(NVFP4|MXFP4|FP8|AWQ|GPTQ|INT4|INT8)/i.exec(repo)?.[1] || 'BF16').toUpperCase();
}
const QUANT_ORDER = ['NVFP4', 'FP8', 'MXFP4', 'INT4 (AWQ)', 'INT4', 'INT4 (GPTQ)', 'BF16'];
const round1 = x => Math.round(x * 10) / 10;
const needOf = gb => (gb ? Math.round(gb * 1.15 + 4) : null);
const fitSparks = need => (need ? (need <= 105 ? 1 : need <= 210 ? 2 : need <= 315 ? 3 : need <= 420 ? 4 : null) : null);
const VARIANT_KEYS = ['repo', 'quant', 'sizeGB', 'needGB', 'sparks', 'gated', 'engine', 'file', 'quants', 'mmproj', 'vision', 'kind'];
const variantFields = v => Object.fromEntries(VARIANT_KEYS.filter(k => v[k] != null).map(k => [k, v[k]]));

// One version of a repository, read from Hugging Face: what it weighs on disk, whether its license must be accepted,
// and its quantization. A GGUF repository holds many quantizations; it's offered as one version whose file you pick,
// defaulting to the best that fits one Spark (llama.cpp runs on one). Repos with neither safetensors nor GGUF: null.
// The stand-in fleet can't reach Hugging Face. An entry {"hf": {…what /api/models/<repo> answers…}, "card": "<README.md>"}
// in its dig fixture (SPARK_CONSOLE_DIG_FIXTURE, 11-setups.mjs) stands in for one repo; any other repo is read as before.
function hfFixture(repo) {
  if (!DIG_FIXTURE || DIG_FIXTURE === 'none') return null;
  try { return JSON.parse(readFileSync(DIG_FIXTURE, 'utf8')).find(x => sameRepo(x?.hf?.id, repo)) || null; } catch { return null; }
}
async function versionOf(repo) {
  const info = hfFixture(repo)?.hf || await hfJson(`/api/models/${repo}?blobs=true&expand[]=gated&expand[]=config&expand[]=downloads&expand[]=lastModified&expand[]=pipeline_tag&expand[]=tags&expand[]=siblings&expand[]=cardData`, 20000);
  const id = info.id || repo, siblings = info.siblings || [];
  const common = { repo: id, gated: Boolean(info.gated), downloads: info.downloads || 0, updated: info.lastModified || null, kind: info.pipeline_tag || null,
    base: [].concat(info.cardData?.base_model || []).filter(b => REPO_RE.test(String(b))).slice(0, 3) };
  const { quants, mmproj } = dig.ggufFiles(siblings);
  if (quants.length) {
    const options = quants.map(x => ({ file: x.file, sizeGB: round1(x.bytes / 1e9), needGB: needOf(x.bytes / 1e9) }));
    const pick = options.find(o => o.needGB && o.needGB <= 105) || options[0];
    return { ...common, quant: `GGUF ${pick.file}`, engine: 'llama.cpp', file: pick.file, sizeGB: pick.sizeGB, needGB: pick.needGB,
      sparks: pick.needGB && pick.needGB <= 105 ? 1 : null, quants: options.slice(0, 12), mmproj, vision: Boolean(mmproj) };
  }
  const weights = siblings.filter(f => /\.safetensors$/.test(f.rfilename) && !/^original\/|consolidated/.test(f.rfilename));
  if (!weights.length) return null;
  const gb = weights.reduce((t, f) => t + (f.size || f.lfs?.size || 0), 0) / 1e9 || null;
  return { ...common, quant: quantOf(info.config, id), sizeGB: gb ? round1(gb) : null, needGB: needOf(gb), sparks: fitSparks(needOf(gb)),
    vision: /image-text|vision|video/.test(info.pipeline_tag || '') || undefined };
}
async function inBatches(items, n, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += n) out.push(...await Promise.all(items.slice(i, i + n).map(x => Promise.resolve().then(() => fn(x)).catch(() => null))));
  return out;
}
async function searchTerms(query) {
  // The words themselves are searched only when they look like a name (a few words at most).
  const plain = /^[\w.\- ]{2,60}$/.test(query) && query.trim().split(/\s+/).length <= 3 ? query.trim() : null;
  // Sparkie's own knowledge stops before this year's models, so it's handed the current catalog to choose from first.
  const known = recipeCatalog().models.slice(0, 90).map(m => `${m.title} (${(m.categories || []).join(', ')}; ${m.variants[0]?.repo || ''})`).join('\n');
  const target = chatTarget();
  // While Sparkie is answering someone, its one model slot isn't taken for this: the words are searched as they are.
  if (!target?.reachable || modelInUse > 0) return { terms: [plain || query.slice(0, 60)], by: 'words' };
  const body = { model: target.model, max_tokens: 200, temperature: 0, chat_template_kwargs: { enable_thinking: false },
    messages: [{ role: 'system', content: `You turn a request for an open-weights AI model into Hugging Face search terms. Reply with JSON only: {"terms": ["...", "..."]} with up to 3 short model-name terms, written the way repository names are (for example "Qwen3.8-27B", "Qwen3-Coder", "gemma-4"). Keep words like "abliterated" or "GGUF" when the request asks for them. Your own knowledge of models is out of date. These are the current models known to run well on DGX Spark (November 2026); pick from them first when they fit the request, then add a newer name only if you're sure it exists:\n${known}\nNo other text.` },
      { role: 'user', content: query.slice(0, 300) }] };
  try {
    const raw = JSON.parse(await httpJson(target.host, target.port, '/v1/chat/completions', body, { timeout: 30000 }));
    const text = String(raw.choices?.[0]?.message?.content || '');
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    const terms = (Array.isArray(json.terms) ? json.terms : []).map(t => String(t).replace(/[^\w.\- ]/g, '').trim().slice(0, 60)).filter(Boolean);
    const all = [...new Set([plain, ...terms].filter(Boolean))].slice(0, 4);
    return { terms: all.length ? all : [query.slice(0, 60)], by: 'sparkie' };
  } catch { return { terms: [plain || query.slice(0, 60)], by: 'words' }; }
}
const searchCache = new Map();
// At most 200 searches are remembered (10 minutes each); the oldest go first.
function rememberSearch(key, value) {
  searchCache.delete(key);
  searchCache.set(key, { at: Date.now(), value });
  for (const [k, v] of searchCache) if (searchCache.size > 200 || Date.now() - v.at > 600000) searchCache.delete(k); else break;
}
async function searchModels(query) {
  const key = query.trim().toLowerCase();
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.at < 600000) return hit.value;
  const started = Date.now(), { terms, by } = await searchTerms(query);
  const lists = await Promise.all(terms.map(t => hfJson(`/api/models?search=${encodeURIComponent(t)}&sort=downloads&direction=-1&limit=30`).catch(() => [])));
  const seen = new Map();
  for (const m of lists.flat()) if (m?.id && !seen.has(m.id) && !SKIP_REPO.test(m.id) && !(m.tags || []).some(t => /^mlx$/i.test(t))) seen.set(m.id, m);
  const candidates = [...seen.values()].sort((a, b) => (b.downloads || 0) - (a.downloads || 0)).slice(0, 20);
  const details = await inBatches(candidates.map(c => c.id), 6, versionOf);
  const catalog = recipeCatalog().models, groups = new Map();
  for (const v of details.filter(Boolean)) {
    if (v.sparks == null && v.sizeGB) continue; // too big: for 4 Sparks, or (GGUF) for one
    const k = modelKey(v.repo);
    groups.set(k, [...(groups.get(k) || []), v]);
  }
  const results = [...groups].map(([k, versions]) => {
    const inRecipes = catalog.find(m => m.id === k || m.variants.some(x => modelKey(x.repo) === k || versions.some(v => sameRepo(v.repo, x.repo))));
    versions.sort((a, b) => (QUANT_ORDER.indexOf(a.quant) + 1 || 99) - (QUANT_ORDER.indexOf(b.quant) + 1 || 99) || b.downloads - a.downloads);
    const top = [...versions].sort((a, b) => b.downloads - a.downloads)[0];
    return { key: k, title: top.repo.split('/').pop().replace(QUANT_SUFFIX, ''), inRecipes: inRecipes ? { id: inRecipes.id, title: inRecipes.title } : null,
      downloads: versions.reduce((t, v) => t + v.downloads, 0), versions };
  }).sort((a, b) => b.downloads - a.downloads).slice(0, 10);
  const value = { query, terms, by, results, took: Date.now() - started };
  rememberSearch(key, value);
  return value;
}
// The owner adds versions to Recipes: each is re-read on Hugging Face first. They join the Recipes model with the same
// name (quantization suffixes aside) when there is one, else become a new model.
async function addModel(viewer, { title, repos }) {
  if (!Array.isArray(repos) || !repos.length || repos.length > 12) throw new HttpError(400, 'Pick the versions to add.');
  const variants = [];
  for (const repo of repos) {
    if (!REPO_RE.test(String(repo)) || SKIP_REPO.test(repo)) throw new HttpError(400, `${repo} can’t be added: it isn’t a format these engines serve.`);
    const v = await versionOf(repo).catch(e => { throw new HttpError(e.status === 404 || e.status === 401 ? 404 : 502, e.status === 404 || e.status === 401 ? `${repo} isn’t on Hugging Face.` : `Couldn’t read ${repo} on Hugging Face: ${e.message}`); });
    if (!v) throw new HttpError(409, `${repo} has no safetensors or GGUF weights, so no engine here can serve it.`);
    variants.push({ ...variantFields(v), community: false });
  }
  const key = modelKey(variants[0].repo);
  const existing = recipeCatalog().models.find(m => m.id === key || m.variants.some(x => modelKey(x.repo) === key));
  const id = existing?.id || key, list = addedModels(), prev = list.find(m => m.id === id);
  const entry = prev
    ? { ...prev, variants: [...prev.variants.filter(x => !variants.some(v => sameRepo(v.repo, x.repo))), ...variants] }
    : { id, family: String(variants[0].repo).split('/')[0], title: String(title || '').slice(0, 80) || variants[0].repo.split('/').pop().replace(QUANT_SUFFIX, ''),
      released: null, categories: variants.some(v => v.vision) ? ['chat', 'vision'] : ['chat'], about: null, rank: 3, variants, setups: [],
      added: true, addedBy: viewer.login, addedAt: new Date().toISOString() };
  writePrivate(ADDED_FILE, { models: [...list.filter(m => m.id !== id), entry] });
  return { ...entry, title: existing?.title || entry.title };
}
// Pasted Hugging Face links or names ("org/model", huggingface.co/org/model/tree/main, hf.co/…), at most 20.
function parseRepoList(text) {
  const out = [];
  for (let word of String(text || '').split(/[\s,;]+/)) {
    word = word.replace(/^<|>$/g, '').replace(/^https?:\/\//, '').replace(/^(www\.)?(huggingface\.co|hf\.co)\//, '').replace(/[?#].*$/, '');
    if (/^(datasets|spaces|collections|docs|blog|papers)\//.test(word)) continue;
    const repo = word.split('/').slice(0, 2).join('/');
    if (REPO_RE.test(repo) && !out.some(r => sameRepo(r, repo))) out.push(repo);
  }
  return out;
}
async function addList(job, viewer, repos) {
  const groups = new Map();
  for (const r of repos) groups.set(modelKey(r), [...(groups.get(modelKey(r)) || []), r]);
  const added = [];
  for (const group of groups.values()) {
    step(job, `Adding ${group.join(', ')}`);
    try { added.push(await addModel(viewer, { repos: group })); } catch (e) { note(job, `Skipped ${group.join(', ')}: ${e.message}`); }
  }
  if (!added.length) throw new Error('None of those could be added.');
  job.result = { added: added.map(m => m.title), found: 0, oneClick: 0 };
  for (const m of added) {
    try {
      const r = await digModel(job, viewer, m.id);
      job.result.found += r.found;
      job.result.oneClick += r.oneClick;
    } catch (e) { note(job, `Couldn’t look for setups for ${m.title}: ${e.message}`); }
  }
}

