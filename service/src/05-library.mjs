/* ───────── model library and deployments ───────── */
// Area: ground        Rules: R2, R8, R17, R21, R38        Tests: change.test.mjs, across.test.mjs, context-start.test.mjs
// Owns: none
// Timers: none        Wakes: none
const INVENTORY_SCRIPT = `dir=${MODELS}
if [ -d "$dir" ]; then
  for d in "$dir"/*/; do
    [ -d "$d" ] || continue
    # (a plain name only: one holding a line break or a tab would add lines of its own to this answer, R53)
    name=\${d%/}; name=\${name##*/}
    case "$name" in ''|*[!A-Za-z0-9._-]*) continue ;; esac
    size=$(du -sb "$d" 2>/dev/null | cut -f1)
    manifest=$(cat "$d/spark.json" 2>/dev/null | base64 | tr -d '\\n')
    config=$(head -c 65536 "$d/config.json" 2>/dev/null | base64 | tr -d '\\n')
    ggufs=$(cd "$d" 2>/dev/null && ls *.gguf */*.gguf 2>/dev/null | head -60 | base64 | tr -d '\\n')
    printf 'model\\t%s\\t%s\\t%s\\t%s\\t%s\\n' "$name" "$size" "$manifest" "$config" "$ggufs"
  done
fi
# Hugging Face cache: models--<org>--<repo>/snapshots/<commit>, whose files link into blobs/.
# Only snapshots with a config.json or GGUF files count. State: 0 complete, 1 still downloading (blobs marked
# .incomplete), 2 no weight files (only the config was fetched, e.g. by a tool reading it). Size follows the snapshot's links:
# a container that downloaded as root can leave blobs/ unlistable to this user. locked=1 when some files can't be
# read here, so they can be served (containers run as root) but not copied.
hub=${HF_HUB}
for d in "$hub"/models--*/; do
  [ -d "$d" ] || continue
  dir=\${d%/}; key=\${dir##*/models--}
  case "$key" in ''|*[!A-Za-z0-9._-]*) continue ;; esac
  ${hfSnap('"$dir"')}
  [ -n "$snap" ] || continue
  case "$snap" in *[!A-Za-z0-9._-]*) continue ;; esac
  ggufs=$(cd "$dir/snapshots/$snap" 2>/dev/null && ls *.gguf */*.gguf 2>/dev/null | head -60 | base64 | tr -d '\\n')
  { [ -e "$dir/snapshots/$snap/config.json" ] || [ -n "$ggufs" ]; } || continue
  partial=0
  if ls "$dir/blobs" 2>/dev/null | grep -q '\\.incomplete$'; then partial=1
  elif [ -z "$(find -L "$dir/snapshots/$snap" -maxdepth 3 -type f \\( -name '*.safetensors' -o -name '*.bin' -o -name '*.gguf' -o -name '*.pt' -o -name '*.pth' \\) 2>/dev/null | head -1)" ]; then partial=2
  fi
  locked=0; for f in "$dir/snapshots/$snap"/*; do [ -r "$f" ] || { locked=1; break; }; done
  size=$(du -sbL "$dir/snapshots/$snap" 2>/dev/null | cut -f1)
  config=$(head -c 262144 "$dir/snapshots/$snap/config.json" 2>/dev/null | base64 | tr -d '\\n')
  printf 'hf\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' "$key" "$size" "$partial" "$locked" "$config" "$ggufs"
done
docker ps -a --filter label=spark.console=1 --format 'deploy\t{{.Names}}\t{{.State}}\t{{.Status}}\t{{.Label "spark.model"}}\tr{{.Label "spark.role"}}\tk{{.Label "spark.cluster"}}\tn{{.Label "spark.rank"}}' 2>/dev/null && printf 'docker\\tok\\n'
# Model servers started outside the console (benchmarks, the portal's own): any other running container whose
# published port (or --port, with host networking) answers /v1/models. Read-only: one GET per candidate port. (Not an
# app Spark Console started, spark.app=1: that stays an app whatever it answers, R38.)
docker ps --filter status=running --format '{{.ID}}\t{{.Names}}\tc{{.Label "spark.console"}}{{.Label "spark.app"}}\t{{.Status}}' 2>/dev/null |
while IFS="$(printf '\\t')" read -r id name ours status; do
  [ "$ours" = c ] || continue
  ports=$(docker port "$id" 2>/dev/null | sed -nE 's/.*:([0-9]+)$/\\1/p' | sort -u)
  if [ -z "$ports" ] && [ "$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$id" 2>/dev/null)" = host ]; then
    ports=$(docker inspect --format '{{json .Config.Entrypoint}} {{json .Config.Cmd}}' "$id" 2>/dev/null | tr ',[]" =' '\\n' | grep -A1 -x -- '--port' | grep -E '^[0-9]+$' | head -1)
    ports=\${ports:-8000}
  fi
  for p in $ports; do
    out=$(curl -s -m 2 "http://127.0.0.1:$p/v1/models" 2>/dev/null) || continue
    case "$out" in *'"data"'*) printf 'ext\\t%s\\t%s\\t%s\\t%s\\n' "$name" "$status" "$p" "$(printf '%s' "$out" | head -c 8192 | base64 | tr -d '\\n')"; break ;; esac
  done
done
mi="\${SPARK_MEMINFO:-/proc/meminfo}"; [ -r "$mi" ] || mi="$HOME/.mock/meminfo"
printf 'mem\\t%s\\n' "$(awk '/MemTotal/ {printf "%.0f", $2 * 1024}' "$mi" 2>/dev/null)"
printf 'memavail\\t%s\\n' "$(awk '/MemAvailable/ {printf "%.0f", $2 * 1024}' "$mi" 2>/dev/null)"
printf 'tsip\\t%s\\n' "$(tailscale ip -4 2>/dev/null | head -1)"
printf 'disk\\t%s\\n' "$(df -B1 --output=avail "$HOME" 2>/dev/null | tail -1 | tr -d ' ')"`;

// GGUF files on disk (from the scan, base64 of one name per line): the quantizations present, best first.
function ggufOnDisk(b64) {
  const files = b64 ? Buffer.from(b64, 'base64').toString('utf8').split('\n').filter(Boolean) : [];
  return files.length ? { format: 'gguf', ggufQuants: dig.ggufFiles(files).quants.map(x => x.file), architecture: 'GGUF' } : {};
}
// Text from a model's own files (config.json, spark.json) is kept only when it is short and plain: a change on a Spark
// can write those files. It is still text from outside (a sentence fits): models_on_disk, which hands it to the brain, is
// an outside read (R26, R53), and nothing the brain reads as the console's own carries it.
const plainText = v => (typeof v === 'string' && /^[A-Za-z0-9 ._+/()-]{1,80}$/.test(v) ? v : null);
// A name from a Spark (a container, a model, a link) as an inside read or the record ahead of the owner's words may carry
// it (R26, A-17): one word of letters, digits and ._-/:@+, at most NAME_SHOWN signs, no space; anything else is no name
// (null). A word can still be a sentence with hyphens for spaces, which no shape tells from a name, so a name shown is
// kept as short as real ones are (F2, C6): 64 signs hold every name in config.json and the tests, every app container
// keep_running takes (63 at most), Linux link names (15) and addresses, and 211 of the catalog's 213 models as the
// console names their containers (sc-<org>--<repo>-part2; the longest is 82). A longer word is said, never shown
// (nameShown): "(a long name: <the outside read that has it> has it)".
const NAME_SHOWN = 64, NAME_WORD = /^[A-Za-z0-9][A-Za-z0-9._\-/:@+]*$/;
const bareName = v => (typeof v === 'string' && v.length <= NAME_SHOWN && NAME_WORD.test(v) ? v : null);
const nameShown = (v, where) => bareName(v) ?? (typeof v === 'string' && NAME_WORD.test(v) ? `(a long name: ${where} has it)` : null);
// The same for spark.json's image and setting names: a setting name not shaped like one is left out; an image not
// shaped like an image reference is never shown (plainImage: the plans' steps), though a start still tries it as named
// and fails there. True when either was found; the plans say so (PLAIN_NOTE), never what it was.
const plainImage = v => (typeof v === 'string' && /^[A-Za-z0-9._/:@-]{1,200}$/.test(v) ? v : null);
const PLAIN_NOTE = 'its spark.json holds an image or setting names that aren’t plain, so Spark Console shows none of them and leaves those settings out';
function plainManifest(m) {
  let out = m.image !== undefined && !plainImage(m.image);
  for (const env of [m.env, m.cluster?.env]) {
    if (env && typeof env === 'object') for (const k of Object.keys(env)) if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(k)) { delete env[k]; out = true; }
  }
  return out;
}
function describe(config, manifest) {
  if (!config && !manifest) return {};
  const quant = config?.quantization_config, architecture = plainText(config?.architectures?.[0]);
  return {
    architecture,
    // Speculative-decoding drafters (DFlash, EAGLE, ...) only run alongside their main model.
    role: /draft|eagle|medusa/i.test(architecture || '') ? 'draft' : null,
    modelType: plainText(config?.model_type),
    dtype: plainText(quant?.quant_method || quant?.quant_algo || config?.torch_dtype),
    // (vision-language models such as Qwen 3.8 keep it under text_config; a whole number only)
    contextLength: [config?.max_position_embeddings, config?.text_config?.max_position_embeddings].find(n => Number.isInteger(n) && n > 0) || null,
  };
}

// The library is every online Spark's ~/models plus its Hugging Face cache. A model on several Sparks is one entry
// with several copies; `stores` says where each copy lives. Details come from the preferred home (modelsHost) when it
// has one. Cache entries are named <org>--<repo>, like their cache folder.
async function inventory(viewer) {
  const nodes = NODES;
  const results = await Promise.all(nodes.map(async node => [node, await run(node, INVENTORY_SCRIPT, { timeout: 45000 })]));
  const byName = new Map(), spark = [], incomplete = [];
  for (const [node, r] of results) {
    const online = r.code === 0;
    // The script prints "docker ok" only when docker ps itself worked. Without it, an empty list of deployments means
    // "couldn't read" (Docker isn't answering there), never "nothing there" (F6).
    const dockerOk = online && fields(r.out, 'docker').length > 0;
    const folders = fields(r.out, 'model').map(([name, size, manifest, config, ggufs]) => {
      const m = b64json(manifest), c = b64json(config);
      if (m && m.title !== undefined && !plainText(m.title)) delete m.title;
      const notPlain = Boolean(m && typeof m === 'object' && plainManifest(m));
      return { name, sizeBytes: Number(size) || 0, manifest: m, store: 'models', ...describe(c, m), ...ggufOnDisk(ggufs), ...(notPlain ? { settingsNotPlain: true } : {}) };
    });
    const cached = fields(r.out, 'hf').filter(([key]) => NAME_RE.test(key)).map(([key, size, partial, locked, config, ggufs]) => ({
      name: key, repo: key.replace('--', '/'), sizeBytes: Number(size) || 0, manifest: null, store: 'hf', locked: locked === '1',
      partial: partial === '1' ? 'downloading' : partial === '2' ? 'no-weights' : null, ...describe(b64json(config), null), ...ggufOnDisk(ggufs),
    }));
    for (const m of cached.filter(m => m.partial)) incomplete.push({ repo: m.repo, node: node.id, reason: m.partial });
    // A folder in ~/models wins over a cache entry of the same name on the same Spark.
    const models = [...folders, ...cached.filter(m => !m.partial && !folders.some(f => f.name === m.name))];
    const deployments = fields(r.out, 'deploy').map(([container, state, status, model, role, cluster, rank]) => ({
      container, state, status, model, role: (role || 'r').slice(1) || null,
      // Part of one model running across Sparks: the group ("spark3+spark4") and this Spark's part (0 serves the API).
      cluster: (cluster || 'k').slice(1) || null, rank: (rank || 'n').slice(1) === '' ? null : Number((rank || 'n').slice(1)),
    }));
    const external = fields(r.out, 'ext').map(([container, status, port, served]) => ({
      container, status, port: Number(port) || null, models: (b64json(served)?.data || []).map(m => m?.id).filter(Boolean).slice(0, 4),
    }));
    const [mem] = fields(r.out, 'mem')[0] || [], [memAvail] = fields(r.out, 'memavail')[0] || [];
    const [tsip] = fields(r.out, 'tsip')[0] || [], [disk] = fields(r.out, 'disk')[0] || [];
    spark.push({
      id: node.id, online, dockerOk, error: online ? null : (r.err || 'Not reachable').split('\n').slice(-1)[0],
      memTotal: Number(mem) || null, memAvailable: Number(memAvail) || null, diskFree: Number(disk) || null, tsip: tsip || null,
      models: models.map(m => m.name), deployments: deployments.map(d => ({ ...d, endpoint: tsip && d.state === 'running' && d.role !== 'main' && !d.rank ? `http://${tsip}:${CONFIG.servePort}/v1` : null })),
      external,
    });
    for (const { partial, ...m } of models) {
      const entry = byName.get(m.name);
      if (!entry) { byName.set(m.name, { ...m, copies: [node.id], stores: { [node.id]: m.store }, locked: { [node.id]: Boolean(m.locked) } }); continue; }
      entry.copies.push(node.id);
      entry.stores[node.id] = m.store;
      entry.locked[node.id] = Boolean(m.locked);
      if (node.id === CONFIG.modelsHost || (!entry.manifest && m.manifest)) Object.assign(entry, { ...m, copies: entry.copies, stores: entry.stores, locked: entry.locked });
    }
  }
  const library = [...byName.values()].sort((a, b) => (a.role === 'draft') - (b.role === 'draft') || (a.repo || a.name).localeCompare(b.repo || b.name));
  return {
    modelsHost: CONFIG.modelsHost, modelsDir: `~/${CONFIG.modelsDir}`, hfDir: '~/.cache/huggingface/hub',
    libraryOnline: spark.some(s => s.online), library, incomplete, sparks: spark,
  };
}

const containerName = model => `sc-${model}`;
// Every engine the console can start, all speaking the OpenAI API on port 8000 inside the container: its default image
// (pinned in config.json under images), how it's started, and the flags for host, port and the name it answers to.
// vLLM and SGLang also run across two Sparks; TensorRT-LLM and llama.cpp run on one. llama.cpp serves GGUF files.
const ENGINES = {
  vllm: { title: 'vLLM', entry: 'vllm', head: ['serve'], tail: served => ['--host', '0.0.0.0', '--port', '8000', '--served-model-name', served], memFlag: '--gpu-memory-utilization', ctxFlag: '--max-model-len', pairs: true },
  sglang: { title: 'SGLang', entry: 'python3', head: ['-m', 'sglang.launch_server', '--model-path'], tail: served => ['--host', '0.0.0.0', '--port', '8000', '--served-model-name', served], memFlag: '--mem-fraction-static', ctxFlag: '--context-length', pairs: true },
  trtllm: { title: 'TensorRT-LLM', entry: 'trtllm-serve', head: [], tail: () => ['--host', '0.0.0.0', '--port', '8000'], memFlag: '--kv_cache_free_gpu_memory_fraction', ctxFlag: '--max_seq_len' },
  'llama.cpp': { title: 'llama.cpp', entry: 'llama-server', head: ['-m'], tail: served => ['--host', '0.0.0.0', '--port', '8000', '--alias', served, '-ngl', '999'], ctxFlag: '-c', gguf: true },
};
const engineOf = model => (ENGINES[model.manifest?.engine] ? model.manifest.engine : model.format === 'gguf' ? 'llama.cpp' : 'vllm');
// The flag that turns on a model server's own counters at /metrics, which the idle power-off reads to see the model used
// at its own address (21-power.mjs): SGLang and llama.cpp have them only when asked; vLLM always; TensorRT-LLM gives no
// counter there. Added by the start commands themselves (dockerRunCommand, clusterRunCommand), not in ENGINES, so
// only the start workflows change with it; never twice, when a setup's own flags have it already.
const metricsFlags = (engine, args = []) => (f => (f && !args.includes(f) ? [f] : []))({ sglang: '--enable-metrics', 'llama.cpp': '--metrics' }[engine] || null);
const imageOf = model => model.manifest?.image || CONFIG.images[engineOf(model)] || null;

function gpuUsersScript(image) {
  return `nvidia-smi --query-compute-apps=pid,used_memory,process_name --format=csv,noheader,nounits 2>/dev/null | while IFS=, read -r pid mem pname; do
  pid=$(echo $pid); cid=$(grep -oE '[0-9a-f]{64}' /proc/$pid/cgroup 2>/dev/null | head -1); cname=""
  [ -n "$cid" ] && cname=$(docker inspect --format '{{.Name}}' "$cid" 2>/dev/null | sed 's#^/##')
  printf 'gpu\\t%s\\t%s\\t%s\\t%s\\n' "$pid" "$(echo $mem)" "$(echo $pname)" "$cname"
done
docker ps --format 'run\t{{.Names}}\t{{.Label "spark.protect"}}\t{{.Label "spark.console"}}\t{{.Label "spark.gpu"}}' 2>/dev/null
docker image inspect ${q(image)} >/dev/null 2>&1 && printf 'image\\tyes\\n' || printf 'image\\tno\\n'
printf 'port\\t%s\\n' "$(ss -ltnH 2>/dev/null | awk '{print $4}' | grep -E ':${CONFIG.servePort}$' | head -1)"
printf 'tsip\\t%s\\n' "$(tailscale ip -4 2>/dev/null | head -1)"`;
}

// `probes` shares one GPU check per Spark and image across many plans (the deploy picker plans every model at once).
// How a model runs, when a deploy names a setup (from Recipes) or a verified run: engine, image, flags and env.
const withHow = (model, how) => (model && how?.contextOnly ? { ...model, manifest: { ...(model.manifest || {}), args: how.args } } : model && how ? { ...model, manifest: { ...(model.manifest || {}), engine: how.engine, image: how.image, args: how.args, env: how.env, cluster: { env: how.env }, ...(how.file ? { file: how.file } : {}) } } : model);
async function plan(modelName, nodeId, viewer, known = null, probes = null, how = null) {
  if (!NAME_RE.test(modelName || '')) throw new HttpError(400, 'Unknown model.');
  const node = nodeById(nodeId);
  if (!node) throw new HttpError(400, 'Unknown Spark.');
  if (!canUse(viewer)) throw new HttpError(403, 'Only the owner can do that.');
  const inv = known || await inventory(null);
  const model = withHow(inv.library.find(m => m.name === modelName), how);
  if (!model) throw new HttpError(404, `No online Spark has ${modelName} right now.`);
  if (model.role === 'draft') throw new HttpError(409, `${model.repo || model.name} is a draft model for speculative decoding. It runs alongside its main model, not on its own.`);
  const target = inv.sparks.find(s => s.id === nodeId);
  if (!target?.online) throw new HttpError(409, `${nodeId} isn’t reachable right now.`);
  const image = imageOf(model);
  if (!image) throw new HttpError(409, `No ${ENGINES[engineOf(model)].title} image is set up yet. Add one under images in config.json, or use a setup from Recipes that names one.`);
  const probe = () => run(node, gpuUsersScript(image), { timeout: 30000 });
  const key = `${nodeId}\n${image}`;
  if (probes && !probes.has(key)) probes.set(key, probe());
  const r = probes ? await probes.get(key) : await probe();
  const gpu = fields(r.out, 'gpu').map(([pid, mem, pname, container]) => ({ pid, memMiB: Number(mem) || 0, process: pname, container }));
  // (gpuApp: an app or job keep_running started with the GPU, spark.gpu=1: it has the GPU even while nvidia-smi lists
  // nothing for it, A13)
  const running = fields(r.out, 'run').map(([name, protect, ours, gpuApp]) => ({ name, protect: isProtected(name, protect), ours: Boolean(ours), gpuApp: gpuApp === '1' }));
  const ours = containerName(modelName);
  // Parts of models running across Sparks: stopping one stops its partner too, so say where that is.
  const groups = new Map(target.deployments.filter(d => d.cluster).map(d => [d.container, d]));
  const groupReason = name => { const d = groups.get(name); return d ? `Runs across ${d.cluster.split('+').map(id => sparkName(nodeById(id) || { id })).join(' + ')}; both parts stop` : null; };
  const stop = new Map();
  for (const g of gpu) {
    const c = running.find(x => x.name === g.container);
    if (c && !c.protect) stop.set(c.name, { kind: 'stop', container: c.name, gpuMiB: (stop.get(c.name)?.gpuMiB || 0) + g.memMiB, reason: groupReason(c.name) || 'Uses the GPU', required: c.ours, group: groups.get(c.name)?.cluster || null });
  }
  // The console's own deploys share one port per Spark, so another one there always has to stop.
  for (const c of running) if (c.ours && !c.protect && !stop.has(c.name)) stop.set(c.name, { kind: 'stop', container: c.name, gpuMiB: 0, reason: groupReason(c.name) || (c.name === ours ? 'Older copy of this model' : 'Another model on your Sparks'), required: true, group: groups.get(c.name)?.cluster || null });
  // A GPU app or job has its Spark's GPU to itself (one GPU thing per Spark, A13): a model starts there only if it stops,
  // and that is always asked (it isn't one of Spark Console's models). Idle, nvidia-smi doesn't list it, so it is held
  // here by its label, whatever it uses now.
  for (const c of running) if (c.gpuApp && !c.protect) stop.set(c.name, { kind: 'stop', container: c.name, gpuMiB: stop.get(c.name)?.gpuMiB || 0, reason: 'A GPU app or job: it has this Spark’s GPU to itself', required: false, hold: true, group: null });
  const warnings = [];
  for (const g of gpu.filter(g => !g.container)) warnings.push(`${g.process || 'A process'} (PID ${g.pid}, ${Math.round(g.memMiB / 1024)} GB) uses the GPU outside Docker and will keep running.`);
  // Sparkie's own model is meant to keep running; the fit already accounts for it, so it isn't a warning.
  for (const c of running.filter(c => c.protect && c.name !== MAIN?.container)) warnings.push(`${c.name} is protected and won’t be stopped.`);
  const [port] = fields(r.out, 'port')[0] || [], [tsip] = fields(r.out, 'tsip')[0] || [];
  const portBusy = Boolean(port) && !stop.has(ours) && !running.some(c => c.name === ours);
  if (portBusy) warnings.push(`Port ${CONFIG.servePort} is already in use on ${nodeId} (${port}); the model may not start.`);
  const needsCopy = !target.models.includes(modelName);
  // Copy from the preferred home when its copy is readable here, else from any Spark whose copy is.
  const readable = model.copies.filter(id => id !== nodeId && !model.locked?.[id]);
  const source = readable.includes(CONFIG.modelsHost) ? CONFIG.modelsHost : readable[0];
  if (needsCopy && !source) {
    throw new HttpError(409, model.copies.some(id => model.locked?.[id])
      ? `${model.repo || modelName} can’t be copied: its files on ${model.copies.join(', ')} belong to root (a container downloaded them). ` +
        `Deploy it there, or on that Spark run: sudo chown -R $USER ~/.cache/huggingface/hub/models--${modelName}`
      : `No other online Spark has ${modelName} to copy from.`);
  }
  if (needsCopy && target.diskFree && target.diskFree < model.sizeBytes * 1.05) throw new HttpError(409, `${nodeId} doesn’t have enough free disk for ${modelName}.`);
  const needsImage = fields(r.out, 'image')[0]?.[0] !== 'yes';
  // Where the target's copy lives: where it already is, else wherever the copy comes from.
  const store = model.stores[nodeId] || model.stores[source];
  const steps = [
    ...stop.values(),
    needsCopy ? { kind: 'copy', from: source, bytes: model.sizeBytes, store } : null,
    needsImage ? { kind: 'pull', image } : null,
    { kind: 'start', engine: engineOf(model), image, port: CONFIG.servePort },
  ].filter(Boolean);
  // Rough memory need: the manifest's figure, else weights plus ~15% for the engine and a small KV cache.
  const need = model.manifest?.memoryGiB ? model.manifest.memoryGiB * 2 ** 30 : Math.round(model.sizeBytes * 1.15);
  return {
    model: { name: model.name, repo: model.repo || null, sizeBytes: model.sizeBytes, engine: engineOf(model) },
    node: nodeId, store, steps, warnings, endpoint: tsip ? `http://${tsip}:${CONFIG.servePort}/v1` : null, tsip: tsip || null,
    memory: { total: target.memTotal, available: target.memAvailable, need },
    // Sparkie's own model is never stopped for a deploy; when it's what leaves too little room, the page says so.
    sparkieHere: Boolean(MAIN && MAIN.node === nodeId && running.some(c => c.name === MAIN.container)),
  };
}

// Where a model fits best right now: its plan on every online Spark, with the fewest things that would have to stop
// for it to fit (largest GPU users first). Ranked: fits without stopping anything, then fewest stops, then no copy
// needed, then most memory to spare; Sparks where it won't fit even stopping everything come last.
function fitOf(p) {
  const need = p.memory?.need || 0, stops = p.steps.filter(s => s.kind === 'stop');
  // (a held one, a GPU app or job, always stops: A13)
  const required = stops.filter(s => s.required || s.hold), optional = stops.filter(s => !s.required && !s.hold).sort((a, b) => b.gpuMiB - a.gpuMiB);
  // Free memory unknown: don't guess; stop only what has to stop.
  if (!Number.isFinite(p.memory?.available) || !need) return { node: p.node, plan: p, fits: true, unknown: true, stop: required.map(s => s.container), copy: p.steps.some(s => s.kind === 'copy'), spare: 0 };
  let free = (p.memory?.available || 0) + required.reduce((t, s) => t + s.gpuMiB * 2 ** 20, 0);
  const chosen = required.map(s => s.container);
  for (const s of optional) {
    if (free >= need) break;
    chosen.push(s.container);
    free += s.gpuMiB * 2 ** 20;
  }
  return { node: p.node, plan: p, fits: free >= need, stop: chosen, copy: p.steps.some(s => s.kind === 'copy'), spare: free - need };
}
async function plansFor(modelName, viewer, known = null, probes = null) {
  const inv = known || await inventory(null);
  const sparks = inv.sparks.filter(sp => sp.online);
  const results = await Promise.all(sparks.map(sp => plan(modelName, sp.id, viewer, inv, probes).then(fitOf, e => ({ node: sp.id, error: e.message }))));
  const ok = results.filter(r => !r.error)
    .sort((a, b) => b.fits - a.fits || a.stop.length - b.stop.length || a.copy - b.copy || b.spare - a.spare);
  const pairs = await pairOptions(modelName, viewer, inv, probes);
  const single = ok.find(r => r.fits)?.node || null, pair = !single ? pairs.find(p => p.fits) : null;
  return { model: modelName, recommended: single || (pair ? pair.nodes.join('+') : null), sparks: [...ok, ...results.filter(r => r.error)], pairs };
}
// The same for each pair of Sparks whose cable tested good: what would stop on each, with half the model on each.
async function pairOptions(modelName, viewer, inv, probes) {
  const model = inv.library.find(m => m.name === modelName);
  if (!model || model.role === 'draft' || !ENGINES[engineOf(model)].pairs) return [];
  const online = new Set(inv.sparks.filter(sp => sp.online).map(sp => sp.id));
  const linked = (lastCheck?.pairs || []).filter(p => p.fastLink === 'full' && online.has(p.a) && online.has(p.b));
  const out = await Promise.all(linked.map(p => clusterPlan(modelName, [p.a, p.b], viewer, inv, probes).then(cp => ({
    nodes: cp.nodes, fits: cp.fits, each: cp.each, copy: cp.members.some(m => m.copy), spare: Math.min(...cp.members.map(m => m.spare)),
    sparkie: cp.members.filter(m => !m.fits && m.sparkieHere).map(m => m.node),
    stop: cp.members.flatMap(m => m.stop.map(container => ({ container, node: m.node }))),
  }), e => ({ nodes: [p.a, p.b], error: e.message }))));
  return out.sort((a, b) => Boolean(b.fits) - Boolean(a.fits) || (a.stop?.length ?? 99) - (b.stop?.length ?? 99) || (b.spare || 0) - (a.spare || 0));
}
// What can be deployed right now: every library model's best Spark and what would have to stop there, from one GPU
// check per Spark. Models already running say where.
async function deployOptions(viewer) {
  const inv = await inventory(null), probes = new Map();
  const seen = inv.sparks.filter(sp => sp.online);
  const models = inv.library.filter(m => m.role !== 'draft');
  return {
    models: await Promise.all(models.map(async m => {
      const r = await plansFor(m.name, viewer, inv, probes);
      const best = r.sparks.find(f => !f.error && f.fits), pair = !best ? r.pairs.find(p => p.fits) : null;
      const errors = r.sparks.filter(f => f.error);
      return {
        model: m.name,
        running: seen.filter(sp => sp.deployments.some(x => x.model === m.name && x.state === 'running' && !x.rank)).map(sp => sp.id),
        across: seen.flatMap(sp => sp.deployments.filter(x => x.model === m.name && x.state === 'running' && x.cluster && !x.rank).map(x => x.cluster.split('+')))[0] || null,
        best: best ? { node: best.node, stop: best.stop, copy: best.copy, unknown: Boolean(best.unknown) } : null,
        pair: pair ? { nodes: pair.nodes, stop: pair.stop } : null,
        // Too big for any one Spark: it needs two linked Sparks even when nothing else runs.
        needsTwo: !best && !pair && r.sparks.some(f => f.plan) && r.sparks.filter(f => f.plan).every(f => f.plan.memory.need > 0.9 * (f.plan.memory.total || Infinity)),
        error: !best && !pair && errors.length === r.sparks.length ? errors[0]?.error || 'No Spark is reachable.' : null,
      };
    })),
  };
}

// A ~/models folder is mounted at /model. A Hugging Face cache entry is mounted whole (its snapshot files are
// symlinks into blobs/) and served from the snapshot refs/main points at, under its repo id.
// vLLM reserves --gpu-memory-utilization of the GPU's whole memory (90% by default; SGLang's --mem-fraction-static is
// similar). A Spark's memory is shared with everything else running there, so unless the model's setup chooses, the
// share is sized to what will be free after the planned stops, less a little headroom.
// 8 GB of each Spark's memory is always left for everything else (the system, SSH, Tailscale): memory is shared by CPU
// and GPU, so running out freezes the whole Spark. A model that doesn't fit in what's free beyond that isn't started.
const KEEP_FREE = 8 * 2 ** 30;
function memoryShare(model, plans, keep = []) {
  const args = Array.isArray(model.manifest?.args) ? model.manifest.args.map(String) : [];
  const flag = ENGINES[engineOf(model)].memFlag;
  const shares = plans.map(p => {
    const total = p.memory?.total, avail = p.memory?.available, need = p.memory?.need;
    if (!Number.isFinite(total) || !Number.isFinite(avail) || !total) throw new Error(`Free memory on ${p.node || 'that Spark'} can’t be read right now, so nothing was started (it could freeze the Spark).`);
    const freed = p.steps.filter(s => s.kind === 'stop' && !keep.includes(s.container)).reduce((t, s) => t + s.gpuMiB * 2 ** 20, 0);
    const room = avail + freed - KEEP_FREE;
    if (need && room < need) {
      throw new Error(`Not enough free memory on ${p.node || 'that Spark'} to start it safely: it needs about ${Math.round(need / 1e9)} GB and ${Math.max(0, Math.round(room / 1e9))} GB is free beyond the 8 GB kept for the system. Nothing was started.`);
    }
    return Math.min(0.9, Math.floor((room / total) * 100) / 100);
  });
  if (!flag) return [];
  // A setup (or a past run) that names its own share gets at most the measured one: the later flag wins in these engines.
  const safe = Math.min(...shares), own = shareIn(args, flag);
  return own != null && own <= safe ? [] : [flag, String(safe)];
}
const SHARE_FLAGS = new Set(['--gpu-memory-utilization', '--mem-fraction-static']);
// The share a list of flags sets for this flag (the last one wins), or null.
function shareIn(args, flag) {
  let v = null;
  args.forEach((a, i) => { const [k, eq] = String(a).split('='); if (dig.flagKey(k) === dig.flagKey(flag)) v = Number(eq ?? args[i + 1]); });
  return Number.isFinite(v) ? v : null;
}
// Flags without a memory share: what's recorded and replayed is the setup, the share is measured each time.
function withoutShare(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]);
    if (SHARE_FLAGS.has(dig.flagKey(a.split('=')[0]))) { if (!a.includes('=')) i++; continue; }
    out.push(a);
  }
  return out;
}
// A Spark's memory right now (after stops), so the share is measured, not estimated.
async function memNow(node) {
  const r = await run(node, `mi="\${SPARK_MEMINFO:-/proc/meminfo}"; [ -r "$mi" ] || mi="$HOME/.mock/meminfo"; awk '/MemTotal/ {t=$2*1024} /MemAvailable/ {a=$2*1024} END {if (t != "") printf "%.0f", t; printf " "; if (a != "") printf "%.0f", a; printf "\\n"}' "$mi"`, { timeout: 20000 });
  const [total, available] = r.out.trim().split(/\s+/).map(Number);
  return r.code === 0 && total > 0 && Number.isFinite(available) ? { total, available } : null;
}

// Each start keeps its engine's compiled kernels and tuning on its Spark, in a folder for that engine image
// (~/.cache/spark-console/engines/<image>), so a restart reuses them instead of compiling and tuning again: GLM-5.3-Flash
// spent about 6 of its 11 minutes on that at every start (2026-11-11). Per image, so one engine version never reads
// another's. The brain keeps its own (~/.cache/spark-console/kernels). A recipe's own cache settings still win.
const ENGINE_CACHE_ENV = { XDG_CACHE_HOME: '/spark-cache/xdg', VLLM_CACHE_ROOT: '/spark-cache/vllm', TRITON_CACHE_DIR: '/spark-cache/triton',
  TORCHINDUCTOR_CACHE_DIR: '/spark-cache/inductor', TORCH_EXTENSIONS_DIR: '/spark-cache/torch-extensions', CUDA_CACHE_PATH: '/spark-cache/nv',
  FLASHINFER_WORKSPACE_BASE: '/spark-cache/flashinfer',
  // CuTe DSL's compiled kernels (b12x, the FP4 MoE path NVIDIA's GLM recipe uses) default to /tmp in the container, lost
  // at every start (review, 2026-11-11).
  CUTE_DSL_CACHE_DIR: '/spark-cache/cute' };
const engineCacheDir = image => `"$HOME/.cache/spark-console/engines/"${q(String(image || 'engine').replace(/[^\w.-]+/g, '_').slice(0, 120))}`;
// (b12x keeps its own tuning in ~/.cache/b12x, which NVIDIA's recipe mounts: kept per image too.)
const engineCache = image => ({ prelude: `mkdir -p ${engineCacheDir(image)}/b12x 2>/dev/null\n`,
  mount: ['-v', `${engineCacheDir(image)}:/spark-cache`, '-v', `${engineCacheDir(image)}/b12x:/root/.cache/b12x`] });

function dockerRunCommand(model, tsip, store = 'models', extra = []) {
  const name = model.name, args = [...(Array.isArray(model.manifest?.args) ? model.manifest.args.map(String) : []), ...extra];
  const fromCache = store === 'hf', served = fromCache ? model.repo || name : name, eng = ENGINES[engineOf(model)];
  const [head, tail] = [['--entrypoint', eng.entry, imageOf(model), ...eng.head], eng.tail(served)];
  const binds = ['-p', `127.0.0.1:${CONFIG.servePort}:8000`, ...(tsip ? ['-p', `${tsip}:${CONFIG.servePort}:8000`] : [])];
  const env = Object.entries({ ...ENGINE_CACHE_ENV, ...(model.manifest?.env || {}) }).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  const parts = ['docker', 'run', '-d', '--name', containerName(name), '--label', 'spark.console=1', '--label', `spark.model=${name}`,
    '--gpus', 'all', '--ipc', 'host', '--ulimit', 'memlock=-1', '--ulimit', 'stack=67108864', ...binds, ...env].map(q);
  const mount = fromCache ? `${HF_HUB}/models--${name}:/hf:ro` : `"$HOME/${CONFIG.modelsDir}/${name}":/model:ro`;
  let prelude = fromCache
    ? `dir=${HF_HUB}/models--${name}; ${hfSnap('"$dir"')}; [ -n "$snap" ] || { echo "No snapshot of ${name} in the Hugging Face cache." >&2; exit 1; }\n${hfMounts()}`
    : '';
  let path = fromCache ? `/hf/snapshots/"$snap"` : q('/model'), vision = '';
  if (eng.gguf) {
    // llama.cpp loads one GGUF file: the chosen quantization (first part if split), plus the vision projector if present.
    const want = model.manifest?.file || model.ggufQuants?.[0] || 'Q4_K_M';
    const root = fromCache ? '"$dir/snapshots/$snap"' : `"$HOME/${CONFIG.modelsDir}/${name}"`;
    // The file whose name ends in the choice ("…-Q4_K_M.gguf", or its first part), before any file that merely contains it.
    const exact = String(want).replace(/[^\w.-]/g, '').replace(/\./g, '\\.');
    prelude += `in=${fromCache ? '/hf/snapshots/$snap' : '/model'}
gguf=$(cd ${root} 2>/dev/null && ls *.gguf */*.gguf 2>/dev/null | grep -vi mmproj | grep -iE -- ${q(`(^|[/._-])${exact}(-00001-of-[0-9]+)?\\.gguf$`)} | sort | head -1)
[ -n "$gguf" ] || gguf=$(cd ${root} 2>/dev/null && ls *.gguf */*.gguf 2>/dev/null | grep -vi mmproj | grep -iF -- ${q(want)} | sort | head -1)
mm=$(cd ${root} 2>/dev/null && ls *.gguf */*.gguf 2>/dev/null | grep -i mmproj | sort | head -1)
[ -n "$gguf" ] || { echo ${q(`${name} has no ${want} GGUF file on this Spark.`)} >&2; exit 1; }
`;
    path = '"$in/$gguf"';
    vision = ' ${mm:+--mmproj "$in/$mm"}';
  }
  const cache = engineCache(imageOf(model));
  return prelude + cache.prelude + [...parts, ...(fromCache ? ['"${hfmounts[@]}"'] : ['-v', mount]), ...cache.mount, ...head.map(q), path, ...[...tail, ...metricsFlags(engineOf(model), args), ...args].map(q)].join(' ') + vision;
}

