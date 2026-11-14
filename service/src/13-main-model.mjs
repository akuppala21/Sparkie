/* ───────── Sparkie's main model ───────── */
// Sparkie is the one main LLM; which model runs behind it is the owner's choice. This service runs it on its own Spark
// so chats and agents can reach it at 127.0.0.1. It starts with --restart unless-stopped, so it comes back after
// reboots until someone stops it here, and it's labeled protected, so deploys never stop it.
// Setups come from config.json (`main`, or `main.presets`) plus any made from Library models in the console; the one
// in use is saved in main.json next to the chats, so it survives restarts and installs.
const MAIN_FILE = `${STATE_DIR}/main.json`;
const MAIN_DEFAULTS = { container: 'sparkie-main', port: 30100, engine: 'vllm', store: 'hf', shmGiB: 16, thinking: false, maxTokens: 4096, env: {}, args: [] };
const configPresets = () => (!CONFIG.main ? {} : CONFIG.main.presets || { [CONFIG.main.id || 'default']: CONFIG.main });
const mainPresets = () => ({ ...configPresets(), ...(readKept(MAIN_FILE)?.presets || {}) });
const mainSetup = (id, preset = mainPresets()[id]) => (preset ? { ...MAIN_DEFAULTS, ...preset, id } : null);
function loadMainSetup() {
  const presets = mainPresets(), saved = readJson(MAIN_FILE)?.current;
  const id = presets[saved] ? saved : Object.keys(presets)[0];
  return id ? mainSetup(id, presets[id]) : null;
}
let MAIN = loadMainSetup();
function saveMainChoice(m) {
  const saved = readJson(MAIN_FILE) || {};
  const presets = { ...(saved.presets || {}) };
  if (!configPresets()[m.id]) {
    const { id, ...preset } = m;
    presets[m.id] = preset;
  }
  writeMainFile({ ...saved, current: m.id, presets });
}
function writeMainFile(value) {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(`${MAIN_FILE}.tmp`, JSON.stringify(value), { mode: 0o600 });
  renameSync(`${MAIN_FILE}.tmp`, MAIN_FILE);
}
// The left-down mark (the brain keeper's, 20-heal.mjs): `leftDown` in main.json says Spark Console itself took Sparkie's
// model down (a start that removed its container, a switch that stopped it) and hasn't seen it answer since. A start or
// switch that fails, or is cut off by a restart of Spark Console, leaves it there. It never blocks a start: if the file
// can't be read or written there is just no mark.
const brainLeftDown = () => Boolean(readJson(MAIN_FILE)?.leftDown);
function markBrainLeftDown(on) {
  try {
    const { leftDown, ...rest } = readKept(MAIN_FILE) || {};
    if (Boolean(leftDown) !== on) writeMainFile(on ? { ...rest, leftDown: new Date().toISOString() } : rest);
  } catch (e) { console.error(`Couldn’t ${on ? 'set' : 'clear'} the left-down mark for Sparkie’s model: ${e.message}`); }
}

// Where Sparkie's chats and the agents' address go. chat: { kind: 'main' } (the model above, run by this service) or
// { kind: 'endpoint', url, model, title, node } (any running model this service can reach). agents: the same, or
// { kind: 'same' } to follow chat.
let ROUTES = { chat: { kind: 'main' }, agents: { kind: 'same' }, ...(() => { const r = readJson(MAIN_FILE) || {}; return { ...(r.chat ? { chat: r.chat } : {}), ...(r.agents ? { agents: r.agents } : {}) }; })() };
function saveRoutes() { writeMainFile({ ...(readJson(MAIN_FILE) || {}), chat: ROUTES.chat, agents: ROUTES.agents }); }
function routeTarget(route) {
  if (route?.kind === 'endpoint') {
    const u = new URL(route.url);
    return { kind: 'endpoint', title: route.title, node: route.node, host: u.hostname, port: Number(u.port) || 80, model: route.model, reachable: true };
  }
  if (!MAIN) return null;
  const node = mainNode();
  return { kind: 'main', title: MAIN.title, node: MAIN.node, host: '127.0.0.1', port: MAIN.port, model: MAIN.served, reachable: Boolean(node) && (ALL_LOCAL || node.host === 'local') };
}
const chatTarget = () => routeTarget(ROUTES.chat);
const agentTarget = () => routeTarget(ROUTES.agents.kind === 'same' ? ROUTES.chat : ROUTES.agents);
const mainNode = (m = MAIN) => (m ? nodeById(m.node) : null);
const repoOf = key => String(key).replace('--', '/');
const ASSISTANT_NAME = 'Sparkie';
const mainBusy = () => [...jobs.values()].some(j => j.status === 'running' && ['main-start', 'main-stop', 'main-switch'].includes(j.type));

// Resolve the served snapshots of the model and its draft into $model and $draft (in the Hugging Face cache).
// A model in a ~/models folder has no snapshot; $model is just set.
function mainSnapshots(m = MAIN) {
  if (m.store === 'models') return `cd "$HOME/${CONFIG.modelsDir}" 2>/dev/null || cd "$HOME"
model=${q(m.model)}; draft=`;
  return [`cd ${HF_HUB} 2>/dev/null || { echo "No Hugging Face cache on this Spark." >&2; exit 1; }`,
    `${hfSnap(q(`models--${m.model}`))}; model="$snap"`,
    m.draft ? `${hfSnap(q(`models--${m.draft}`))}; draft="$snap"` : 'draft=']
    .join('\n');
}

const mainStatusScript = (m = MAIN) => `${mainSnapshots(m)}
# docker inspect prints an empty line before failing on a container that doesn't exist.
c=$(docker inspect -f '{{.State.Status}}|{{.State.StartedAt}}|{{.RestartCount}}|{{.State.ExitCode}}' ${q(m.container)} 2>/dev/null | head -1)
printf 'container\\t%s\\n' "\${c:-missing}"
printf 'health\\t%s\\n' "$(curl -s -m 3 -o /dev/null -w '%{http_code}' http://127.0.0.1:${m.port}/v1/models 2>/dev/null)"
${m.store === 'models' ? `[ -e ${q(m.model)}/config.json ]` : `{ [ -n "$model" ] && [ -e ${q(`models--${m.model}`)}/snapshots/"$model"/config.json ]; }`} && printf 'model\\tyes\\n' || printf 'model\\tno\\n'
${m.draft ? `{ [ -n "$draft" ] && [ -e ${q(`models--${m.draft}`)}/snapshots/"$draft"/config.json ]; } && printf 'draft\\tyes\\n' || printf 'draft\\tno\\n'` : `printf 'draft\\tyes\\n'`}
docker image inspect ${q(m.imageId || m.image)} >/dev/null 2>&1 && printf 'image\\tyes\\n' || printf 'image\\tno\\n'`;

async function mainStatus(m = MAIN) {
  if (!m) return { configured: false };
  const node = mainNode(m);
  const base = {
    configured: true, node: m.node, title: m.title || repoOf(m.model), served: m.served, engine: m.engine,
    model: repoOf(m.model), draft: m.draft ? repoOf(m.draft) : null, port: m.port, about: m.about || null,
    busy: mainBusy(),
  };
  if (!node) return { ...base, online: false, error: `${m.node} isn’t in the Spark list.` };
  const r = await run(node, mainStatusScript(m), { timeout: 20000 });
  if (r.code === 255) return { ...base, online: false, error: `${m.node} isn’t reachable right now.` };
  if (r.code) return { ...base, online: false, error: `Couldn’t check ${m.node}: ${(r.err || r.out).trim().split('\n').slice(-1)[0] || `exit ${r.code}`}` };
  const get = k => (fields(r.out, k)[0] || [])[0] || '';
  const [state, startedAt, restarts, exitCode] = get('container').split('|');
  return {
    ...base, online: true, local: ALL_LOCAL || node.host === 'local',
    state, startedAt: state === 'missing' ? null : startedAt || null, restarts: Number(restarts) || 0, exitCode: Number(exitCode) || 0,
    healthy: get('health') === '200',
    ready: { model: get('model') === 'yes', draft: get('draft') === 'yes', image: get('image') === 'yes' },
  };
}

// What starting it means: what else on that Spark's GPU stops (with Keep running choices, like deploys), whether
// the image needs downloading, and whether memory is enough.
async function mainPlan(m = MAIN) {
  if (!m) throw new HttpError(404, 'No main model is configured.');
  const node = mainNode(m), status = await mainStatus(m);
  if (!status.online) throw new HttpError(409, status.error);
  if (!status.ready.model && !m.copyFrom) throw new HttpError(409, `${status.model} isn’t on ${m.node}.`);
  if (!status.ready.draft) throw new HttpError(409, `${status.draft} (its draft model) isn’t in ${m.node}’s Hugging Face cache.`);
  const r = await run(node, `${gpuUsersScript(m.imageId || m.image)}
mi="\${SPARK_MEMINFO:-/proc/meminfo}"
printf 'mem\\t%s\\t%s\\n' "$(awk '/MemTotal/ {printf "%.0f", $2 * 1024}' "$mi" 2>/dev/null)" "$(awk '/MemAvailable/ {printf "%.0f", $2 * 1024}' "$mi" 2>/dev/null)"`, { timeout: 30000 });
  const gpu = fields(r.out, 'gpu').map(([pid, mem, pname, container]) => ({ pid, memMiB: Number(mem) || 0, process: pname, container }));
  const running = fields(r.out, 'run').map(([name, protect]) => ({ name, protect: isProtected(name, protect) }));
  const stop = new Map();
  for (const g of gpu) {
    const c = running.find(x => x.name === g.container);
    if (c && c.name !== m.container && !c.protect) stop.set(c.name, { kind: 'stop', container: c.name, gpuMiB: (stop.get(c.name)?.gpuMiB || 0) + g.memMiB, reason: 'Uses the GPU' });
  }
  const warnings = [];
  for (const g of gpu.filter(g => !g.container)) warnings.push(`${g.process || 'A process'} (PID ${g.pid}, ${Math.round(g.memMiB / 1024)} GB) uses the GPU outside Docker and will keep running.`);
  for (const c of running.filter(c => c.protect && c.name !== m.container)) warnings.push(`${c.name} is protected and won’t be stopped.`);
  const [total, available] = (fields(r.out, 'mem')[0] || []).map(Number);
  const fraction = Number(m.args[m.args.indexOf('--mem-fraction-static') + 1]) || 0.8;
  return {
    node: m.node, title: status.title, state: status.state,
    steps: [...stop.values(), !status.ready.model && m.copyFrom ? { kind: 'copy', from: m.copyFrom, bytes: m.sizeBytes || 0 } : null,
      status.ready.image ? null : { kind: 'pull', image: m.image }, { kind: 'start', engine: m.engine, port: m.port }].filter(Boolean),
    warnings, memory: { total: total || null, available: available || null, need: total ? Math.round(total * fraction) : null },
  };
}

function mainRunCommand(m = MAIN) {
  const env = { HF_HUB_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1', ...m.env };
  const flags = ['docker', 'run', '-d', '--name', m.container, '--restart', 'unless-stopped',
    '--label', 'spark.console=1', '--label', 'spark.protect=true', '--label', 'spark.role=main', '--label', `spark.model=${m.served}`,
    '--gpus', 'all', '--shm-size', `${m.shmGiB}g`, ...(m.memoryGiB ? ['--memory', `${m.memoryGiB}g`] : []),
    '-p', `127.0.0.1:${m.port}:8000`, ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`])].map(q);
  // With ropeScaling (e.g. YaRN for a longer context), each model is served from an overlay: links to every file of
  // its cached snapshot (as container paths under /hf) plus a config.json with the rope settings changed. The cache
  // itself is never modified.
  const folder = m.store === 'models', overlay = Boolean(m.ropeScaling) && !folder;
  const mounts = [...(folder ? ['-v', `"$HOME/${CONFIG.modelsDir}/"${q(m.model)}:/model:ro`] : ['-v', `${HF_HUB}:/hf:ro`]),
    '-v', '"$HOME/.cache/spark-console/kernels":/kernel-cache', ...(overlay ? ['-v', '"$ov":/overlay:ro'] : [])];
  const modelPath = folder ? '/model' : overlay ? '/overlay/model' : `/hf/${q(`models--${m.model}`)}/snapshots/"$model"`;
  const draftPath = overlay ? '/overlay/draft' : `/hf/${q(`models--${m.draft}`)}/snapshots/"$draft"`;
  const serve = m.engine === 'vllm'
    ? [...['--entrypoint', 'vllm'].map(q), '"$img"', q('serve'), modelPath]
    : [...['--entrypoint', 'python3'].map(q), '"$img"', ...['-m', 'sglang.launch_server', '--model-path'].map(q), modelPath,
      ...(m.draft && !folder ? [q('--speculative-draft-model-path'), draftPath] : [])];
  return `${mainSnapshots(m)}
[ -n "$model" ] || { echo "${repoOf(m.model)} isn’t on this Spark." >&2; exit 1; }
${m.draft ? `[ -n "$draft" ] || { echo "${repoOf(m.draft)} isn’t in this Spark’s Hugging Face cache." >&2; exit 1; }` : ''}
img=${q(m.imageId || m.image)}; docker image inspect "$img" >/dev/null 2>&1 || img=${q(m.image)}
mkdir -p "$HOME/.cache/spark-console/kernels/home" "$HOME/.cache/spark-console/kernels/sglang"
${overlay ? mainOverlayScript(m) : ''}
${[...flags, ...mounts, ...serve, ...['--served-model-name', m.served, '--host', '0.0.0.0', '--port', '8000', ...m.args.map(String)].map(q)].join(' ')}`;
}

function mainOverlayScript(m = MAIN) {
  const build = (key, snapVar, dir) => `overlay ${q(`models--${key}`)} "${snapVar}" "$ov/${dir}" || exit 1`;
  return `ov="$HOME/.cache/spark-console/overlay/"${q(m.served)}
rm -rf "$ov" && mkdir -p "$ov/model" "$ov/draft" || exit 1
overlay() {
  for f in $(ls -A "$1/snapshots/$2"); do [ "$f" = config.json ] || ln -s "/hf/$1/snapshots/$2/$f" "$3/$f" || return 1; done
  python3 - "$1/snapshots/$2/config.json" "$3/config.json" ${q(JSON.stringify(m.ropeScaling))} <<'PY'
import json, sys
src, dst, rope = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
if isinstance(rope.get('factor'), int):
    rope['factor'] = float(rope['factor'])  # JSON drops the .0; configs expect a float
cfg, changed = json.load(open(src)), []
def walk(o):
    if isinstance(o, dict):
        if 'rope_type' in o:
            o.update(rope)
            changed.append(1)
        for v in list(o.values()):
            walk(v)
    elif isinstance(o, list):
        for v in o:
            walk(v)
walk(cfg)
if not changed:
    sys.exit('No rope settings found in ' + src + '; not starting with an unchanged config.')
json.dump(cfg, open(dst, 'w'), indent=2)
PY
}
${build(m.model, '$model', 'model')}
${m.draft ? build(m.draft, '$draft', 'draft') : ''}`;
}

async function startMain(job, keep = [], m = MAIN) {
  const p = await mainPlan(m), node = mainNode(m);
  // (the brain keeper's start: self-healing never stops, copies or downloads anything to bring the brain back)
  if (job.noStops && p.steps.some(s => s.kind !== 'start')) throw new Error('Starting it now would stop, copy or download something, and self-healing never does that.');
  for (const s of p.steps.filter(s => s.kind === 'stop' && keep.includes(s.container))) note(job, `Keeping ${s.container} running, as asked`);
  for (const s of p.steps.filter(s => s.kind === 'stop' && !keep.includes(s.container))) {
    await stopContainer(job, node.id, s.container);
  }
  const copy = p.steps.find(s => s.kind === 'copy');
  if (copy) {
    step(job, `Copying ${m.title} from ${copy.from}`);
    await copyModel(job, m.model, nodeById(copy.from), node, copy.bytes, m.store);
    job.progress = null;
  }
  if (p.steps.some(s => s.kind === 'pull')) {
    step(job, `Downloading ${m.image}`);
    const r = await run(node, `docker pull ${q(m.image)}`, { timeout: 3600000, onLine: line => { job.detail = line.slice(0, 200); } });
    if (r.code) throw new Error(`Image download failed: ${r.err || r.out.slice(-500)}`);
  }
  markBrainLeftDown(true);
  await run(node, `docker rm -f ${q(m.container)} >/dev/null 2>&1; true`);
  step(job, `Starting ${p.title}`);
  const started = await run(node, mainRunCommand(m), { timeout: 120000 });
  if (started.code) throw new Error(`Docker couldn’t start it: ${started.err || started.out}`);
  step(job, 'Loading the model; the first start compiles kernels and can take a while');
  const deadline = Date.now() + 45 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(5000);
    const h = await run(node, `if curl -sf -m 4 http://127.0.0.1:${m.port}/v1/models >/dev/null; then echo up; else docker inspect -f '{{.State.Status}}' ${q(m.container)} 2>/dev/null || echo missing; fi
docker logs --tail 1 ${q(m.container)} 2>&1 | tail -1`, { timeout: 20000 });
    const [state, last] = h.out.split('\n');
    if (last) job.detail = last.slice(0, 200);
    if (state === 'up') {
      markBrainLeftDown(false);
      note(job, `${p.title} is answering on port ${m.port}`);
      await recordVerified(job, { model: { name: m.model, repo: repoOf(m.model), manifest: { title: m.title } }, engine: m.engine, image: m.image,
        args: (m.args || []).map(String), env: m.env || {}, nodes: [m.node], host: '127.0.0.1', port: m.port, viewer: null, brain: true });
      return;
    }
    if (['exited', 'dead', 'missing'].includes(state)) {
      const logs = await run(node, `docker logs --tail 25 ${q(m.container)} 2>&1`, { timeout: 20000 });
      throw new Error(`The model server stopped while loading.\n${logs.out.trim().slice(-2500)}`);
    }
  }
  throw new Error('It didn’t answer within 45 minutes. It may still be loading; check its logs.');
}

// A Library model as a Sparkie setup: its own serving settings (spark.json), served on Sparkie's Spark and port.
async function setupFromLibrary(name) {
  const node = MAIN?.node || CONFIG.modelsHost;
  const m = (await inventory(null)).library.find(x => x.name === name);
  if (!m) throw new HttpError(404, `No online Spark has ${name} right now.`);
  if (m.role === 'draft') throw new HttpError(409, `${m.repo || name} is a draft model; it can’t be Sparkie’s model on its own.`);
  const readable = m.copies.filter(id => id !== node && !m.locked?.[id]);
  const copyFrom = m.copies.includes(node) ? null : readable.includes(CONFIG.modelsHost) ? CONFIG.modelsHost : readable[0];
  if (!m.copies.includes(node) && !copyFrom) throw new HttpError(409, `${m.repo || name} isn’t on ${node}, and no other Spark has a copy it can read.`);
  const engine = m.manifest?.engine === 'sglang' ? 'sglang' : 'vllm';
  return mainSetup(`lib-${name}`, {
    title: m.manifest?.title || m.repo || name, served: name.toLowerCase(), node, engine,
    image: m.manifest?.image || CONFIG.images[engine], model: name, store: m.stores[node] || m.stores[copyFrom],
    args: Array.isArray(m.manifest?.args) ? m.manifest.args.map(String) : [],
    about: [m.contextLength ? `${Math.round(m.contextLength / 1024)}k context` : null, m.dtype].filter(Boolean).join(' · ') || null,
    copyFrom, sizeBytes: m.sizeBytes,
  });
}

// Switching Sparkie's model: plan the new one first (a setup that can't start leaves the one in use untouched), stop
// the one in use, start the new one, and keep the choice only once it answers. If the new one fails, the previous one
// is started again, and the error says whether it came back.
async function switchMain(job, target, keep) {
  const previous = MAIN;
  try { await mainPlan(target); } catch (e) { throw new Error(`${target.title} can’t start, and nothing was stopped: ${e.message}`); }
  if (previous) { markBrainLeftDown(true); await stopMain(job, previous); }
  try {
    await startMain(job, keep, target);
  } catch (e) {
    note(job, `${target.title} didn’t start: ${e.message.split('\n')[0]}`);
    let back = false;
    if (previous) {
      step(job, `Going back to ${previous.title}`);
      try { await startMain(job, [], previous); back = true; } catch (e2) {
        note(job, `${previous.title} didn’t come back either: ${e2.message.split('\n')[0]}`);
        // No half-started container stays behind: Docker would keep restarting it, and "/restart sparkie" must find it
        // gone and start the saved setup, never the one that just failed.
        await run(mainNode(previous), `docker rm -f ${q(previous.container)} >/dev/null 2>&1; true`, { timeout: 60000 });
      }
    }
    const outcome = !previous ? '' : back ? `, so ${ASSISTANT_NAME} is back on ${previous.title}`
      : `, and ${previous.title} didn’t come back either, so ${ASSISTANT_NAME} is down. To start it again, type /restart sparkie in Spark Console’s chat`;
    throw new Error(`${target.title} didn’t start${outcome}. ${e.message}`);
  }
  const { copyFrom, sizeBytes, ...kept } = target;
  MAIN = kept;
  saveMainChoice(kept);
  ROUTES.chat = { kind: 'main' };
  saveRoutes();
  note(job, `${kept.title} is now ${ASSISTANT_NAME}’s model`);
}

async function stopMain(job, m = MAIN) {
  step(job, `Stopping ${m.title || m.container}`);
  const r = await run(mainNode(m), `docker stop --time 60 ${q(m.container)}`, { timeout: 180000 });
  if (r.code && !/No such container/.test(r.err)) throw new Error(r.err || r.out || 'docker stop failed');
}

