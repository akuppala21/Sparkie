// Turning published ways of running a model into Spark Console setups, and checking them.
// Pure functions only: the service fetches pages and files; this reads commands out of them and decides what may run.
//
// A setup is the one format every source becomes (the same as service/catalog.json's):
//   { id, repo, quant, file?, engine, image, sparks, parallel, args[], env{}, speculative, perf{decodeTokS, context, tool},
//     source{url, author, date, kind}, credibility, notes, deployable, why }
// "deployable" means one click: a known engine on 1 or 2 Sparks, a pinned image from an approved source, and only flags
// that are safe to run as written. Everything else is still listed, with why it isn't one click.
import { createHash } from 'node:crypto';

/* ───────── reading shell commands ───────── */
// Splits shell text into commands of words, the way a shell would quote them. Comments, line continuations, separators
// (newline ; && || |) are handled; nothing is expanded, so "$VAR" stays as written and is caught later.
export function shellCommands(text) {
  const src = String(text || '');
  const commands = [];
  let words = [], cur = '', inWord = false, i = 0;
  const endWord = () => { if (inWord) words.push(cur); cur = ''; inWord = false; };
  const endCommand = () => { endWord(); if (words.length) commands.push(words); words = []; };
  while (i < src.length) {
    const c = src[i];
    if (c === '\\' && src[i + 1] === '\n') { i += 2; continue; }
    if (c === '\\' && src[i + 1] === '\r' && src[i + 2] === '\n') { i += 3; continue; }
    if (c === '\\') { cur += src[i + 1] ?? ''; inWord = true; i += 2; continue; }
    if (c === "'") {
      const end = src.indexOf("'", i + 1);
      cur += src.slice(i + 1, end < 0 ? src.length : end); inWord = true; i = end < 0 ? src.length : end + 1; continue;
    }
    if (c === '"') {
      i++; inWord = true;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && '"\\$`\n'.includes(src[i + 1])) { if (src[i + 1] !== '\n') cur += src[i + 1]; i += 2; continue; }
        cur += src[i++];
      }
      i++; continue;
    }
    if (c === '#' && !inWord) { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '\n' || c === ';') { endCommand(); i++; continue; }
    if ((c === '&' && src[i + 1] === '&') || (c === '|' && src[i + 1] === '|')) { endCommand(); i += 2; continue; }
    if (c === '|' || c === '&') { endCommand(); i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { endWord(); i++; continue; }
    cur += c; inWord = true; i++;
  }
  endCommand();
  return commands;
}

const base = s => String(s || '').split('/').pop();
const isFlag = s => /^-{1,2}[A-Za-z]/.test(String(s));
export function flagValue(words, names) {
  for (let i = 0; i < words.length; i++) {
    const w = String(words[i]);
    for (const n of names) {
      if (w === n && words[i + 1] != null && !isFlag(words[i + 1])) return String(words[i + 1]);
      if (w.startsWith(`${n}=`)) return w.slice(n.length + 1);
    }
  }
  return null;
}

// The engine's own command: vllm serve, python -m sglang.launch_server, sglang serve, trtllm-serve, llama-server.
function engineCommand(w) {
  const b0 = base(w[0]);
  let engine = null, model = null, i = 0;
  if (b0 === 'vllm' && w[1] === 'serve') { engine = 'vllm'; i = 2; if (w[i] && !isFlag(w[i])) model = w[i++]; }
  else if (/^python(3(\.\d+)?)?$/.test(b0) && w[1] === '-m') {
    if (w[2] === 'sglang.launch_server') engine = 'sglang';
    else if (/^vllm\.entrypoints\.(openai\.)?api_server$/.test(w[2] || '')) engine = 'vllm';
    else return null;
    i = 3;
  } else if (b0 === 'sglang' && w[1] === 'serve') { engine = 'sglang'; i = 2; }
  else if (b0 === 'trtllm-serve') { engine = 'trtllm'; i = 1; if (w[i] === 'serve') i++; if (w[i] && !isFlag(w[i])) model = w[i++]; }
  else if (b0 === 'llama-server') { engine = 'llama.cpp'; i = 1; }
  else return null;
  const args = w.slice(i);
  model ||= flagValue(args, ['--model', '--model-path', '-m', '-hf', '-hfr', '--hf-repo']);
  return { engine, model, args };
}

// docker run [options] IMAGE [command]: the image, its -e variables, and the engine command inside.
const DOCKER_VALUE = new Set(['-e', '--env', '-v', '--volume', '-p', '--publish', '--name', '--gpus', '--ipc', '--network', '--net',
  '--shm-size', '--ulimit', '--entrypoint', '--memory', '-m', '--memory-swap', '--user', '-u', '-w', '--workdir', '--runtime',
  '--security-opt', '--cap-add', '--cap-drop', '--device', '--label', '-l', '--env-file', '--mount', '--platform', '--pull',
  '--restart', '--cpus', '--cpuset-cpus', '--hostname', '-h', '--add-host', '--log-driver', '--log-opt', '--pid', '--uts',
  '--cgroupns', '--group-add', '--tmpfs', '--stop-signal', '--stop-timeout', '--dns', '--ip', '--mac-address', '--userns']);
function dockerCommand(w) {
  if (!(base(w[0]) === 'docker' && w[1] === 'run')) return null;
  const env = {};
  let i = 2, entry = null;
  while (i < w.length && String(w[i]).startsWith('-')) {
    const t = String(w[i]), eq = t.startsWith('--') ? t.indexOf('=') : -1;
    const name = eq > 0 ? t.slice(0, eq) : t, inline = eq > 0 ? t.slice(eq + 1) : null;
    const takes = inline == null && DOCKER_VALUE.has(name);
    const value = inline ?? (takes ? w[i + 1] : null);
    if ((name === '-e' || name === '--env') && value && value.includes('=')) env[value.slice(0, value.indexOf('='))] = value.slice(value.indexOf('=') + 1);
    if (name === '--entrypoint') entry = value;
    i += takes ? 2 : 1;
  }
  const image = w[i];
  if (!image) return null;
  const rest = w.slice(i + 1);
  if (entry && /^(ba|z)?sh$/.test(base(entry))) {
    const k = rest.indexOf('-c');
    const inner = k >= 0 && rest[k + 1] ? findServe(rest[k + 1]) : null;
    return inner ? { ...inner, image, env: { ...env, ...inner.env } } : { engine: null, image, env, args: [] };
  }
  const hit = engineCommand(entry ? [entry, ...rest] : rest) || imageDefault(image, rest);
  return hit ? { ...hit, image, env } : { engine: null, image, env, args: [] };
}
// Images whose own entrypoint is the engine: vLLM's runs `vllm serve`, llama.cpp's server image runs llama-server.
function imageDefault(image, rest) {
  if (/vllm/i.test(image)) {
    const model = rest[0] && !isFlag(rest[0]) ? rest[0] : null;
    return { engine: 'vllm', model: model || flagValue(rest, ['--model']), args: model ? rest.slice(1) : rest };
  }
  if (/llama[.-]cpp/i.test(image)) return { engine: 'llama.cpp', model: flagValue(rest, ['-m', '--model', '-hf', '--hf-repo']), args: rest };
  if (/sglang/i.test(image) && rest.length && isFlag(rest[0])) return { engine: 'sglang', model: flagValue(rest, ['--model-path', '--model']), args: rest };
  return null;
}

// The first engine command in a snippet (the head, when a snippet starts a head and its workers), with the variables
// exported before it.
export function findServe(text) {
  const env = {};
  for (const words of shellCommands(text)) {
    // (the words before the command are passed by index: taking them off one by one is quadratic on a hostile card)
    let k = 0;
    for (; k < words.length; k++) {
      const a = words[k];
      if (a === 'export') { for (const e of words.slice(k + 1)) if (/^[A-Za-z_]\w*=/.test(e)) env[e.slice(0, e.indexOf('='))] = e.slice(e.indexOf('=') + 1); k = words.length; break; }
      if (/^[A-Za-z_]\w*=/.test(a)) { env[a.slice(0, a.indexOf('='))] = a.slice(a.indexOf('=') + 1); continue; }
      if (['sudo', 'env', 'exec', 'nohup', 'time', 'command'].includes(a)) continue;
      break;
    }
    const w = words.slice(k);
    if (!w.length) continue;
    const hit = dockerCommand(w) || engineCommand(w);
    if (hit?.engine) return { ...hit, env: { ...env, ...(hit.env || {}) } };
  }
  return null;
}

// How many Sparks a command spans: one GPU per Spark, so tensor × pipeline parallel, or the node count it names.
export function sparksOf(args, fallback = 1) {
  const n = k => Number(flagValue(args, k)) || null;
  const nodes = n(['--nnodes']);
  const tp = n(['--tensor-parallel-size', '-tp', '--tp', '--tp-size', '--tp_size']) || 1;
  const pp = n(['--pipeline-parallel-size', '-pp', '--pp', '--pp-size', '--pp_size']) || 1;
  return Math.max(nodes || 1, tp * pp, fallback || 1);
}

/* ───────── reading pages ───────── */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export const decodeEntities = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m);
export const htmlText = html => decodeEntities(String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d|pre|tr)>/gi, '\n').replace(/<[^>]+>/g, ' '))
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
// Code blocks from Markdown (``` fences) or from a forum post's HTML (<pre><code>).
export function codeBlocks(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/```[^\n]*\n([\s\S]*?)```/g)) out.push(m[1]);
  for (const m of String(text || '').matchAll(/<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi)) out.push(decodeEntities(m[1].replace(/<[^>]+>/g, '')));
  return out;
}
// Speeds stated in a text ("42 tok/s", "38.5 tokens/s", "55 t/s", llama.cpp's "52 tg/s"), each with the words around it.
// Each is read in its own clause: prefill ("1058 pp/s", "1,000 tok/s prefill"), several users at once ("52 tok/s @ 4
// concurrent", "multi-agent") or one user's decode speed.
export function speedsIn(text) {
  const src = String(text || ''), out = [];
  const re = /(\d{1,2},\d{3}|\d{1,5}(?:\.\d{1,2})?)\s*(pp\/s|tg\/s|tok(?:en)?s?\s*\/\s*s(?:ec)?\b|t\/s\b|tps\b|tokens? per second)/gi;
  for (const m of src.matchAll(re)) {
    const value = Number(m[1].replace(',', '')), unit = m[2].toLowerCase(), end = m.index + m[0].length;
    const before = src.slice(Math.max(0, m.index - 30), m.index).split(/[,;|\n]|\s\/\s/).pop().toLowerCase();
    const after = src.slice(end, end + 30).split(/[,;|\n(]|\s\/\s/)[0].toLowerCase();
    const clause = `${before} ${after}`;
    const kind = unit === 'pp/s' || (unit !== 'tg/s' && /prefill|prompt processing|\bpp\b|ingest/.test(clause)) ? 'prefill'
      : /concurren|parallel|multi|aggregate|batch|users|agents|@\s*\d|\bat\s+\d+\s*(x|users|req)/.test(clause) ? 'aggregate' : 'decode';
    if (value < 1 || value > (kind === 'decode' ? 600 : 50000)) continue;
    out.push({ value, kind, quote: src.slice(Math.max(0, m.index - 60), end + 20).replace(/\s+/g, ' ').trim() });
  }
  return out;
}
// What a post or a thread title says about one run when it gives no command to copy: the engine, how many Sparks,
// and its speeds as stated. Read with patterns only; null when it states no decode speed.
export function reportIn(text) {
  const src = String(text || '');
  const decode = speedsIn(src).find(x => x.kind === 'decode');
  if (!decode && !speedsIn(src).some(x => x.kind === 'aggregate')) return null;
  const prefill = speedsIn(src).find(x => x.kind === 'prefill'), many = speedsIn(src).find(x => x.kind === 'aggregate');
  const eng = /\b(vllm|sglang|llama\.cpp|llama-server|trt-?llm|tensorrt-llm|ollama|lm ?studio)\b/i.exec(src)?.[1]?.toLowerCase() || null;
  const engine = !eng ? 'other' : eng.startsWith('llama') ? 'llama.cpp' : /trt|tensorrt/.test(eng) ? 'trtllm' : eng.replace(/\s/g, '');
  const n = /\b([1-4])\s*[x×]\s*(?:nvidia\s+)?(?:dgx\s*)?sparks?\b/i.exec(src)?.[1] || /\b([1-4])\s*(?:nvidia\s+)?(?:dgx\s+)?sparks\b/i.exec(src)?.[1]
    || (/\b(dual|two)\s+(?:nvidia\s+)?(?:dgx\s+)?sparks?\b/i.test(src) ? 2 : /\b(single|one)\s+(?:nvidia\s+)?(?:dgx\s+)?spark\b/i.test(src) ? 1 : null);
  return { engine, sparks: n ? Number(n) : 1, perf: { ...(decode ? { decodeTokS: decode.value, quote: decode.quote } : { quote: speedsIn(src)[0].quote }), ...(prefill ? { prefillTokS: prefill.value } : {}), ...(many ? { aggregateTokS: many.value } : {}) } };
}
export const normalizeSpace = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

/* ───────── fitting placeholders (sparkrun / eugr recipe files) ───────── */
// "{port}"-style placeholders are filled from the recipe's defaults; "{{"/"}}" are literal braces. Ones without a value
// stay as written and make the setup not one-click.
export function fillTemplate(text, values) {
  return String(text || '').replace(/\{\{/g, '\u0001').replace(/\}\}/g, '\u0002')
    .replace(/\{(\w+)\}/g, (m, k) => (values[k] != null && typeof values[k] !== 'object' ? String(values[k]) : m))
    .replace(/\u0001/g, '{').replace(/\u0002/g, '}');
}

/* ───────── checking ───────── */
// Flags the console sets itself (where it serves, the name, and how it spreads a model over Sparks): dropped.
export const OWN = new Set(['--model', '--model-path', '--host', '--port', '--served-model-name', '--tensor-parallel-size', '-tp', '--tp',
  '--tp-size', '--tp_size', '--nnodes', '--node-rank', '--master-addr', '--master-port', '--headless', '--dist-init-addr',
  '--pipeline-parallel-size', '-pp', '--pp', '--pp-size', '--pp_size', '--data-parallel-size', '-dp', '--dp', '--dp-size',
  '--revision', '--distributed-executor-backend', '-m', '-hf', '-hfr', '--hf-repo', '-hff', '--hf-file', '--alias', '-a',
  '--mmproj', '-mm', '--api-server-count']);
// Flags a recipe may not set: they load code or files, send data somewhere, or change who can call the model.
export const UNSAFE = new Set(['--middleware', '--worker-cls', '--worker-extension-cls', '--otlp-traces-endpoint', '--tool-parser-plugin',
  '--reasoning-parser-plugin', '--download-dir', '--chat-template', '--allowed-local-media-path', '--ssl-keyfile', '--ssl-certfile',
  '--api-key', '--root-path', '--log-config-file', '--logits-processors', '--hf-token', '-hft', '--ssl-key-file', '--ssl-cert-file',
  '--path', '--chat-template-file', '--grammar-file', '--lora', '--lora-scaled', '--control-vector', '--slot-save-path',
  '--extra_llm_api_options', '--extra-llm-api-options', '--custom-module-dirs', '--plugins', '--allowed-origins', '--rpc', '--tool-server',
  '--lora-modules', '--kv-transfer-config', '--enable-custom-logit-processor', '--logits-processor-pattern', '--custom-weight-loader',
  '--ec-transfer-config', '--config']);
// Flags whose value is JSON (never a file path).
const JSON_FLAGS = new Set(['--speculative-config', '--compilation-config', '--reasoning-config', '--hf-overrides', '--override-generation-config',
  '--kv-transfer-config', '--limit-mm-per-prompt', '--mm-processor-kwargs', '--rope-scaling', '--json-model-override-args']);
// Flags that never take a value (so the next word isn't swallowed as one).
const BOOL_FLAGS = new Set(['--trust-remote-code', '--enable-prefix-caching', '--enable-auto-tool-choice', '--enforce-eager', '--headless',
  '--jinja', '--no-enable-prefix-caching', '--disable-log-requests', '--disable-log-stats', '--enable-chunked-prefill', '--cont-batching',
  '--no-webui', '--disable-cuda-graph', '--enable-torch-compile', '--disable-radix-cache', '--enable-expert-parallel', '--async-scheduling']);
// Engines read --some_flag and --some-flag alike, so checks compare the dashed spelling.
export const flagKey = name => (String(name).startsWith('--') ? `--${String(name).slice(2).replace(/_/g, '-')}` : String(name));
const has = (set, name) => set.has(name) || set.has(flagKey(name));
// Engines (Python argparse) also accept any unambiguous start of a flag: --trust-rem is --trust-remote-code. So a flag
// that is the start of a blocked one counts as that one, and a start of --trust-remote-code is written out in full,
// which keeps it behind the owner's opt-in.
// Real flags that happen to be the start of a blocked one are themselves, not abbreviations (argparse prefers an exact match).
const REAL_FLAGS = new Set(['--reasoning-parser', '--tool-call-parser', '--tool-parser', '--chat-template-content-format', '--lora-dtype', '--config-format']);
const abbreviates = (set, name) => { const k = flagKey(name); return k.length >= 5 && !REAL_FLAGS.has(k) && [...set].some(u => u !== k && flagKey(u).startsWith(k)); };
const REMOTE_CODE = '--trust-remote-code';
export const isRemoteCode = name => { const k = flagKey(String(name).split('=')[0]); return k === REMOTE_CODE || (k.length >= 5 && REMOTE_CODE.startsWith(k)); };
export const remoteCode = args => (args || []).some(a => String(a).startsWith('-') && isRemoteCode(a));
// Environment variables that load code or files from elsewhere: never from a recipe.
const ENV_NEVER = /^(VLLM_TRUST_REMOTE_CODE|VLLM_ALLOW_INSECURE_SERIALIZATION|VLLM_PLUGINS|VLLM_USE_MODELSCOPE|VLLM_ALLOW_RUNTIME_LORA_UPDATING)$/;
// Settings that load or point at code or files (a library to inject, a plugin, a logging config, a path), or that reopen
// flags cleanFlags keeps out (llama.cpp's LLAMA_ARG_* beyond a few tuning ones): never, whatever the prefix.
const ENV_LOADS_CODE = /INJECTION|PLUGIN|PRELOAD|LOGGING_CONFIG|DEV_MODE|(?:PATH|_DIR|_FILE|_HOME)$|^LD_|^LLAMA_ARG_(?!(?:CTX_SIZE|N_PARALLEL|N_GPU_LAYERS|FLASH_ATTN|BATCH|UBATCH|THREADS|CACHE_TYPE_[KV]|DEFRAG_THOLD|CONT_BATCHING)$)/;
const sameRepoName = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const looksJson = v => /^\s*[[{]/.test(v) && (() => { try { JSON.parse(v); return true; } catch { return false; } })();
const dynamic = v => /\$[({\w]|`/.test(v);
const ENV_OK = /^(VLLM_|SGLANG_|NCCL_|CUDA_|TORCH|PYTORCH_|TRITON_|FLASHINFER_|TOKENIZERS_|OMP_|CUTE_DSL_|B12X_|LLAMA_|GGML_|TRTLLM_|TLLM_|HF_HUB_ENABLE_HF_TRANSFER$|SAFETENSORS_FAST_GPU$|HF_HUB_OFFLINE$)/;

export function cleanFlags(list, repo) {
  const out = [], problems = [];
  const words = (list || []).map(String);
  for (let i = 0; i < words.length; i++) {
    const t = words[i];
    if (!t.startsWith('-')) {
      if (repo && t.toLowerCase().split(':')[0] === String(repo).toLowerCase()) continue;
      problems.push(`has words that aren’t flags (${t.slice(0, 24)})`);
      continue;
    }
    const eq = t.startsWith('--') ? t.indexOf('=') : -1;
    const name = eq > 0 ? t.slice(0, eq) : t;
    const next = words[i + 1];
    const takes = eq < 0 && !has(BOOL_FLAGS, name) && next != null && !(next.startsWith('-') && !/^-\d/.test(next));
    const value = eq > 0 ? t.slice(eq + 1) : takes ? next : null;
    if (takes) i++;
    if (has(OWN, name)) continue;
    // --flag.key=value sets one key of a JSON option (a way around the checks on it).
    // Allowed only for JSON options that are safe as JSON too (--speculative-config.model x is the same as the JSON form).
    if (name.startsWith('--') && name.includes('.')) {
      const base = flagKey(name.slice(0, name.indexOf('.')));
      if (!JSON_FLAGS.has(base) || ['--hf-overrides', '--kv-transfer-config'].includes(base) || has(UNSAFE, base)) { problems.push(`uses a dotted flag (${name})`); continue; }
    }
    if (has(UNSAFE, name) || abbreviates(UNSAFE, name)) { problems.push(`uses ${name}`); continue; }
    if (flagKey(name) === '--tokenizer' && value != null && repo && !sameRepoName(value, repo)) { problems.push(`takes its tokenizer from another repo (${value.slice(0, 60)})`); continue; }
    if (isRemoteCode(name) && flagKey(name) !== REMOTE_CODE) { out.push(REMOTE_CODE); continue; }
    // A model config override can point at code to download and run (auto_map): never from a recipe.
    if (flagKey(name) === '--hf-overrides' && value != null && /auto_map/i.test(value)) { problems.push(`uses ${name} with auto_map`); continue; }
    if (dynamic(t) || (value != null && dynamic(value))) { problems.push(`uses shell variables (${name})`); continue; }
    if (value != null && !looksJson(value) && /\{\w+\}/.test(value)) { problems.push(`has a blank to fill in (${name})`); continue; }
    if (value != null && !has(JSON_FLAGS, name) && !looksJson(value) && (/^(\/|~|\.\.?\/)/.test(value) || /\.(ya?ml|jinja2?|json|py|txt|gguf)$/i.test(value))) {
      problems.push(`needs a file from the author’s machine (${name})`);
      continue;
    }
    out.push(t);
    if (takes) out.push(value);
  }
  return { args: out, problems: [...new Set(problems)] };
}

export function cleanEnv(env) {
  const out = {};
  for (const [k, v] of Object.entries(env || {})) {
    const value = String(v ?? '');
    if (ENV_OK.test(k) && !ENV_NEVER.test(k) && !ENV_LOADS_CODE.test(k) && !dynamic(value) && !value.startsWith('<') && value.length < 400) out[k] = value;
  }
  return out;
}

export const PINNED_TAG = /^(v?\d[\w.\-+]*|\d{2}\.\d{2}[\w.\-]*|nightly-\d{8}[\w.\-]*|[\w.\-]*\d{8}[\w.\-]*)$/;
export const isDigest = image => /@sha256:[0-9a-f]{64}$/.test(String(image || ''));
// docker.io/x and x are the same image; library images get their implied prefix.
export const imageName = image => String(image || '').replace(/^docker\.io\//, '').replace(/^registry-1\.docker\.io\//, '');
export const imageApproved = (image, sources) => sources.some(p => imageName(image).startsWith(p));

// Every source becomes this. `rules` = { engines: {name: {pairs}}, sources: [approved image prefixes],
// defaultImage: engine => image }. Returns null for setups that can't run on 4 Sparks at all.
export function vetSetup(raw, rules) {
  const engine = { vllm: 'vllm', sglang: 'sglang', trtllm: 'trtllm', 'tensorrt-llm': 'trtllm', 'llama.cpp': 'llama.cpp', 'llama-cpp': 'llama.cpp' }[String(raw.engine || '').toLowerCase()] || String(raw.engine || 'other');
  const sparks = Math.max(1, Math.round(Number(raw.sparks) || 1));
  if (sparks > 4) return null;
  const { args, problems } = cleanFlags(raw.args, raw.repo);
  const env = cleanEnv(raw.env);
  let image = raw.image ? String(raw.image).trim() : null, imageNote = null;
  if (!image && !raw.report && rules.defaultImage?.(engine)) { image = rules.defaultImage(engine); imageNote = 'Spark Console’s own image for this engine'; }
  const why = [...(raw.why ? [raw.why] : [])];
  if (raw.report) why.push('a report of how it ran, with no command to copy');
  else if (!rules.engines[engine]) why.push(`${engine} isn’t one-click yet`);
  else if (sparks > 2) why.push(`${sparks}-Spark setups aren’t one-click yet`);
  else if (sparks > 1 && !rules.engines[engine].pairs) why.push(`${engine} across Sparks isn’t one-click yet`);
  if (raw.report) { /* nothing to run */ }
  else if (!image) why.push('no container image given');
  else if (/\s|<|\{/.test(image)) why.push('its image name has blanks to fill in');
  else if (!image.includes('/') && !image.includes(':')) why.push('uses an image the author built themselves');
  else if (!imageApproved(image, rules.sources)) why.push('uses a community-built image');
  else if (!isDigest(image) && !PINNED_TAG.test(image.split('@')[0].split(':').slice(1).join(':'))) why.push('uses an unpinned image');
  if (raw.arm64 === false) why.push('its image has no ARM64 build');
  why.push(...problems);
  const perf = raw.perf || {};
  const src = raw.source || {};
  const id = createHash('sha1').update(JSON.stringify([raw.repo || null, engine, image, sparks, args, env, raw.file || null, src.url || null])).digest('hex').slice(0, 10);
  return {
    id, repo: raw.repo || null, quant: raw.quant || null, ...(raw.file ? { file: raw.file } : {}), engine, image, ...(imageNote ? { imageNote } : {}),
    sparks, parallel: raw.parallel || null, args, env, speculative: raw.speculative || null,
    perf: Object.fromEntries(['decodeTokS', 'prefillTokS', 'aggregateTokS', 'concurrency', 'context', 'tool', 'quote'].filter(k => perf[k] != null).map(k => [k, perf[k]])),
    source: { url: src.url || null, author: src.author || null, date: src.date || null, kind: src.kind || 'found' },
    credibility: raw.credibility || 'medium', notes: String(raw.notes || '').slice(0, 280),
    deployable: why.length === 0, why: why[0] || null, found: true, ...(raw.report ? { report: true } : {}),
  };
}

/* ───────── each source's format ───────── */
const str = v => (v == null ? null : String(v));
const dateOf = v => (v ? String(v).slice(0, 10) : null);

// NVIDIA's local-ai-inference-recipes: recipe.yaml (+ performance.yaml beside it), one per hardware/engine/precision.
export function fromNvidia(recipe, perf, path) {
  const cmd = recipe?.serve?.command;
  const hit = cmd ? findServe(cmd) : null;
  if (!hit) return null;
  const nodes = Number(recipe.topology?.node_count) || (/dgx-spark-(\d)gpu/.exec(path)?.[1] ? Number(/dgx-spark-(\d)gpu/.exec(path)[1]) : 1);
  const profiles = Array.isArray(perf?.profiles) ? perf.profiles : [];
  const one = profiles.filter(p => Number(p?.workload?.concurrency) === 1 && Number(p?.results?.decode_tokens_per_second_mean));
  const best = one.sort((a, b) => b.results.decode_tokens_per_second_mean - a.results.decode_tokens_per_second_mean)[0];
  const digest = /^sha256:[0-9a-f]{64}$/.test(String(perf?.software?.runtime_revision || '')) ? perf.software.runtime_revision : null;
  const image = str(recipe.runtime?.image);
  return {
    repo: str(recipe.checkpoint?.target_label) || hit.model, quant: str(recipe.precision?.label), engine: str(recipe.backend) || hit.engine,
    image: image && digest && !isDigest(image) ? `${image}@${digest}` : image, sparks: nodes, parallel: str(recipe.topology?.summary),
    args: hit.args, env: hit.env, speculative: str(recipe.checkpoint?.draft_label),
    perf: best ? { decodeTokS: Math.round(best.results.decode_tokens_per_second_mean * 10) / 10, concurrency: 1,
      context: `${one.length} workload${one.length > 1 ? 's' : ''} at 1 user; fastest: ${best.workload?.category || best.id}`, tool: perf?.harness?.name || null } : {},
    source: { url: `https://github.com/NVIDIA/local-ai-inference-recipes/blob/main/${path}`, author: 'NVIDIA', date: dateOf(recipe.validation?.validated_at || perf?.measured_at), kind: 'nvidia' },
    credibility: 'high', notes: [str(recipe.title), ...(Array.isArray(recipe.limitations) ? recipe.limitations.map(String) : [])].filter(Boolean).join(' · '),
  };
}

// sparkrun-style recipe files (Spark Arena's registry, eugr's spark-vllm-docker): model, container, defaults, env, command.
export function fromSparkrun(doc, path, { kind, author, url }) {
  if (!doc || typeof doc !== 'object' || !doc.command) return null;
  const defaults = { ...(doc.defaults || {}), model: doc.model, model_revision: doc.model_revision };
  const hit = findServe(fillTemplate(doc.command, defaults));
  if (!hit) return null;
  const folder = Number(/(\d)x-spark/.exec(path)?.[1]) || 1;
  const tp = Number(defaults.tensor_parallel) || 1, pp = Number(defaults.pipeline_parallel) || 1;
  const sparks = Math.max(folder, Number(doc.min_nodes) || 1, tp * pp, sparksOf(hit.args));
  const mods = Array.isArray(doc.mods) && doc.mods.length;
  return {
    repo: str(doc.model) || hit.model, quant: null, engine: str(doc.runtime) || hit.engine, image: str(doc.container), sparks,
    parallel: [tp > 1 ? `TP=${tp}` : null, pp > 1 ? `PP=${pp}` : null].filter(Boolean).join(' ') || null,
    args: hit.args, env: { ...(doc.env || {}), ...hit.env },
    source: { url, author, date: null, kind }, credibility: /experimental/.test(path) ? 'low' : 'medium',
    why: mods ? 'needs patches (mods) applied when it starts' : null,
    notes: str(doc.metadata?.description || doc.description || doc.name),
  };
}

// recipes.vllm.ai: one JSON per model and hardware with the exact argv, env, image and node count.
export function fromVllmRecipes(j, url) {
  if (!j || !Array.isArray(j.argv)) return null;
  const hit = engineCommand(j.argv.map(String));
  if (!hit) return null;
  return {
    repo: hit.model, engine: 'vllm', image: str(j.docker_image), sparks: Number(j.node_count) || sparksOf(hit.args),
    parallel: str(j.strategy), args: hit.args, env: j.env || {}, source: { url, author: 'vLLM recipes', date: null, kind: 'vllm-recipes' },
    credibility: 'medium', notes: [j.strategy, j.variant].filter(Boolean).join(' · '),
  };
}

// A command found in a forum post or a model card, as written there.
export function fromText(hit, { url, author, date, kind, credibility, quote, decodeTokS, sparks, notes }) {
  const model = hit.model ? String(hit.model) : null;
  const [repo, file] = hit.engine === 'llama.cpp' && model && /^[\w.-]+\/[\w.-]+:[\w.-]+$/.test(model) ? model.split(':') : [model, null];
  return {
    repo: repo && /^[\w.-]+\/[\w.-]+$/.test(repo) ? repo : null, file, engine: hit.engine, image: hit.image || null,
    sparks: sparks || sparksOf(hit.args), args: hit.args, env: hit.env, source: { url, author, date, kind }, credibility,
    perf: decodeTokS ? { decodeTokS, concurrency: 1, quote } : {}, notes,
  };
}
// A card's ``` code blocks, in one pass over its lines: a block opens on a line starting with three backticks (after any
// indent) and closes on the next such line; one never closed is left out. Linear in the card's length, whatever it holds
// (codeBlocks' patterns take seconds on a hostile card), and no HTML <pre>: a card is Markdown.
function cardBlocks(text) {
  const out = [];
  let block = null;
  for (const line of text.split('\n')) {
    if (!line.trimStart().startsWith('```')) { if (block) block.push(line); continue; }
    if (block) { out.push(block.length ? `${block.join('\n')}\n` : ''); block = null; } else block = [];
  }
  return out;
}
// A model's own card (its README.md on Hugging Face): the engine commands in its code blocks that serve this very repo.
// Only code blocks are read, never the card's words. At most 6 a card; a command of over 60 words, or with a word
// over 300 characters, is skipped.
export function fromCard(text, repo) {
  const out = [], seen = new Set(), own = String(repo || '').toLowerCase();
  if (!own) return out;
  for (const block of cardBlocks(String(text || '').slice(0, 400000))) {
    const hit = findServe(block);
    if (!hit || String(hit.model || '').split(':')[0].toLowerCase() !== own) continue;
    if (hit.args.length > 60 || hit.args.some(a => String(a).length > 300)) continue;
    const key = JSON.stringify([hit.engine, hit.image || null, hit.args]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...fromText(hit, { url: `https://huggingface.co/${repo}`, author: String(repo).split('/')[0], date: null, kind: 'model-card', credibility: 'medium', notes: 'From the model’s own card on Hugging Face' }), repo });
    if (out.length >= 6) break;
  }
  return out;
}

/* ───────── GGUF files ───────── */
// A GGUF repository holds many quantizations (Q4_K_M, Q8_0, …), some split into parts; mmproj files add vision.
const GGUF_QUANT = /(?:^|[-_.\/])((?:UD-)?(?:I?Q\d(?:_[A-Z0-9]+)*|BF16|F16|F32|MXFP4(?:_MOE)?))(?=[-_.\/]|$)/i;
export const GGUF_PREFER = ['Q4_K_M', 'UD-Q4_K_XL', 'Q4_K_XL', 'MXFP4_MOE', 'MXFP4', 'Q5_K_M', 'Q4_K_S', 'Q6_K', 'Q8_0', 'UD-Q5_K_XL',
  'IQ4_XS', 'IQ4_NL', 'Q4_0', 'Q3_K_M', 'UD-Q3_K_XL', 'Q2_K', 'UD-Q2_K_XL', 'BF16', 'F16'];
export const ggufQuantOf = file => GGUF_QUANT.exec(String(file).replace(/\.gguf$/i, ''))?.[1]?.toUpperCase() || null;
export function ggufFiles(siblings) {
  // One option per file; a file split into parts ("-00001-of-00003") is one option whose parts add up. When a repo has
  // several different files at one quantization (plain, vision, MTP builds), each is named by its file instead.
  const stems = new Map();
  for (const s of siblings || []) {
    const f = String(s.rfilename || s.path || s);
    if (!/\.gguf$/i.test(f) || /mmproj/i.test(f)) continue;
    const quant = ggufQuantOf(f);
    if (!quant) continue;
    const stem = f.replace(/\.gguf$/i, '').replace(/-\d{5}-of-\d{5}$/i, '');
    const e = stems.get(stem) || { quant, stem, bytes: 0, files: [] };
    e.bytes += Number(s.size || s.lfs?.size || 0);
    e.files.push(f);
    stems.set(stem, e);
  }
  const perQuant = new Map();
  for (const e of stems.values()) perQuant.set(e.quant, (perQuant.get(e.quant) || 0) + 1);
  const rank = q => (GGUF_PREFER.indexOf(q) + 1) || 99;
  const quants = [...stems.values()].map(e => ({ file: perQuant.get(e.quant) > 1 ? e.stem.split('/').pop() : e.quant, quant: e.quant, bytes: e.bytes, files: e.files.sort() }))
    .sort((a, b) => rank(a.quant) - rank(b.quant) || a.file.length - b.file.length || a.bytes - b.bytes);
  const mmprojs = (siblings || []).map(s => String(s.rfilename || s.path || s)).filter(f => /mmproj.*\.gguf$/i.test(f));
  const mmproj = mmprojs.sort((a, b) => /f16/i.test(b) - /f16/i.test(a) || a.length - b.length)[0] || null;
  return { quants, mmproj };
}
