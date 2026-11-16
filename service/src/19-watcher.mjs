/* ───────── watching the fleet: what runs, what changed, and what it learns ───────── */
// Area: core
// Rules: R7, R19, R21, R23, R24, R38
// Tests: fleet.test.mjs, dark.test.mjs, docker-down.test.mjs, state.test.mjs
// Owns: knowledge.json (writers: saveKnowledge), events.jsonl (writers: fleetEvent)
// Timers: watchFleet (15 s after start, then every 60 s)        Wakes: none
// Every minute the console looks at every container on every Spark (models, services, dev boxes, anything started by
// hand) and remembers how each was started: image, command (secrets hidden), ports, mounts, GPU use, and the names
// (never the values) of its environment variables. Changes become events: started, stopped, crashed, removed, a Spark
// going offline or coming back, and the console's own operations. A model server someone started by hand, from an
// image source the console trusts, is saved as a recipe ("worked before"), so it can be started again like any other.
// Sparkie and agents read all of it (workloads, fleet_events, and Sparkie's chats), so whatever happens, they know.
const KNOWLEDGE_FILE = `${STATE_DIR}/knowledge.json`, EVENTS_FILE = `${STATE_DIR}/events.jsonl`;
const WATCH_EVERY = Number(process.env.SPARK_CONSOLE_WATCH_MS || 60000);
let knowledge = readJson(KNOWLEDGE_FILE);
if (!knowledge || typeof knowledge.workloads !== 'object' || !knowledge.workloads) knowledge = { workloads: {}, sparks: {} };
knowledge.sparks ||= {};
const events = (() => {
  let lines = [];
  try { lines = readFileSync(EVENTS_FILE, 'utf8').trim().split('\n').slice(-500); } catch { return []; }
  return lines.flatMap(l => { try { const e = JSON.parse(l); return e && typeof e === 'object' && typeof e.type === 'string' ? [e] : []; } catch { return []; } });
})();
// Operations a restart cut off (started on the record, never finished) are reported once, when the service is back.
setTimeout(() => {
  const ended = new Set(events.filter(e => e.type === 'operation' && e.id && e.status !== 'started').map(e => e.id));
  for (const e of events.filter(x => x.type === 'operation' && x.id && x.status === 'started' && !ended.has(x.id))) {
    const where = (e.sparks || [e.spark]).filter(Boolean).join(' + ');
    fleetEvent({ type: 'operation', id: e.id, operation: e.operation, status: 'interrupted', model: e.model || null, spark: e.spark || null, ...(e.sparks ? { sparks: e.sparks } : {}) });
    // (the self-test's own: its clean-up after the restart says what it stopped, 21-selftest.mjs)
    if (selfTestCutOff(e)) continue;
    // (a saved workflow's run on record, or one of its steps: its clean-up after the restart says what it did, 18-run-record.mjs)
    if (savedRunCutOff(e)) continue;
    // (a long command, run with minutes: the journal's own cut-off notice, in the chat that asked, says what became of
    // it; it is never started again, 21-long.mjs)
    if (e.operation === 'run') continue;
    fleetEvent({ type: 'notice', text: `A restart of Spark Console cut off ${e.operation} ${e.model || ''}${where ? ` on ${where}` : ''}${e.stops?.length ? ` (it was to stop ${e.stops.join(', ')})` : ''}. Check it’s running; if not, start it (or what it stopped) again.` });
  }
  savedRunsRecover().catch(e => console.error(`Stopping what a cut-off saved workflow started: ${e.message}`));
}, 0);
function fleetEvent(e) {
  const x = { at: new Date().toISOString(), ...e };
  events.push(x);
  if (events.length > 500) events.splice(0, events.length - 500);
  try {
    if (existsSync(EVENTS_FILE) && statSync(EVENTS_FILE).size > 5e6) renameSync(EVENTS_FILE, `${EVENTS_FILE}.1`);
    appendFileSync(EVENTS_FILE, `${JSON.stringify(x)}\n`, { mode: 0o600 });
  } catch {}
  journalEvent(x);
}
const describeEvent = e => (e.type === 'operation' ? `${e.operation} ${e.model || ''} ${e.status}${e.error ? ` (${e.error})` : ''}`
  // (powered off or on by Spark Console on purpose, 21-power.mjs: not a fault)
  : e.type === 'spark-powered-off' ? `${e.spark} was powered off by Spark Console on purpose (${e.why || 'asked'})${e.parked?.length ? `; parked ${e.parked.join(', ')}` : ''}`
  : e.type === 'spark-powered-on' ? `${e.spark} was turned on again (${e.why || 'asked'})`
  : e.type.startsWith('spark-') ? `${e.spark} went ${e.type.slice(6)}${e.poweredOff ? ` (powered off by Spark Console on purpose: ${e.poweredOff})` : ''}${e.last ? ` (last reading ${e.last.ageSeconds} s before: ${readingWords(e.last)})` : ''}`
    : e.type === 'learned' ? `learned ${e.model} from ${e.container} on ${e.spark}${e.recipe ? ' (saved as a recipe)' : ''}`
      : e.type === 'healing' ? (e.why ? `bringing back ${e.container} on ${e.spark}: ${e.why}` : `restarting ${e.container} on ${e.spark} after it crashed`)
        : e.type === 'heal-skipped' ? `didn’t restart ${e.container} on ${e.spark}: ${e.why}`
        : e.type === 'notice' ? String(e.text || '')
      : `${e.container} ${e.type} on ${e.spark}${e.exitCode ? ` (exit ${e.exitCode})` : ''}${e.oomKilled ? ' (out of memory)' : ''}${e.drill ? ' (the self-test’s healing drill, on purpose)' : ''}${e.outside ? ', started outside Spark Console' : ''}`).replace(/\s+/g, ' ').trim();

// What a Spark read last, for "why did Spark 4 go dark?" (round two, item 2). The status check keeps the GPU's numbers
// (busy, watts, temperature, uptime); the watcher adds the hottest sensor on the board, the NVMe drive and the fan from
// sysfs. Numbers or null only, and nothing here decides anything. The readings print first: they never change how the
// script ends, so a missing file can't drop the watcher's round.
// (SPARK_SYSFS: the stand-in fleet's own folder, as for the network links in 06-links.mjs.)
const readingsScript = `SYS=\${SPARK_SYSFS:-/sys}
z=; for f in "$SYS"/class/thermal/thermal_zone*/temp; do t=$(cat "$f" 2>/dev/null) || continue; case "$t" in ''|*[!0-9]*) continue ;; esac; [ "$t" -le 150000 ] || continue; { [ -z "$z" ] || [ "$t" -gt "$z" ]; } && z=$t; done
nv=; fan=; for d in "$SYS"/class/hwmon/hwmon*; do [ -z "$nv" ] && [ "$(cat "$d/name" 2>/dev/null)" = nvme ] && nv=$(cat "$d/temp1_input" 2>/dev/null); [ -z "$fan" ] && [ -r "$d/fan1_input" ] && fan=$(cat "$d/fan1_input" 2>/dev/null); done
printf 'read\\t%s\\t%s\\t%s\\n' "$z" "$nv" "$fan"`;
const reading = (v, div, max) => { const n = Number(v) / div; return v !== '' && v != null && Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 10) / 10 : null; };
const FRESH_READING_MS = 3 * 60000;
// The last readings, if under three minutes old (a console restart or Spark 2 being down leaves none near the time).
function lastReading(s) {
  const fresh = x => (x?.at && Date.now() - Date.parse(x.at) < FRESH_READING_MS ? x : null), g = fresh(s?.gpu), r = fresh(s?.readings), w = fresh(s?.wall);
  if (!g && !r) return null;
  const newest = Math.max(Date.parse(g?.at || 0) || 0, Date.parse(r?.at || 0) || 0);
  return { ageSeconds: Math.round((Date.now() - newest) / 1000), gpuBusyPercent: g?.busy ?? null, gpuWatts: g?.watts ?? null, gpuC: g?.tempC ?? null,
    hottestC: r?.hottestC ?? null, nvmeC: r?.nvmeC ?? null, fanRpm: r?.fanRpm ?? null, ...(w ? { wallWatts: w.watts } : {}) };
}
const readingWords = l => (l ? [l.gpuBusyPercent != null ? `GPU ${l.gpuBusyPercent}% busy` : null, l.gpuWatts != null ? `${l.gpuWatts} W` : null,
  l.hottestC != null ? `hottest sensor ${l.hottestC} °C` : null, l.wallWatts != null ? `${l.wallWatts} W at the wall` : null].filter(Boolean).join(', ') : '');

// The times a Spark went dark (offline at least as long as self-healing counts as a power cycle), newest first, with one
// finding picked by code and worded "consistent with": never a verdict, and never "not heat" because the last reading
// was cool. The window is the events Spark Console still keeps.
function darkPeriods(spark, max = 5) {
  const list = [];
  let off = null;
  const add = (o, on) => {
    const darkMs = (on ? Date.parse(on.at) : Date.now()) - Date.parse(o.at);
    if (on && darkMs < HEAL_OFFLINE_MS) return;
    const last = o.last || null, up = on && Number.isFinite(on.upSeconds) ? on.upSeconds : null, restarted = up === null ? null : up * 1000 <= darkMs + 60000;
    const loaded = last && ((last.gpuBusyPercent ?? 0) >= 50 || (last.gpuWatts ?? 0) >= 60);
    // (Spark Console powered it off itself, 21-power.mjs: on purpose, never a fault)
    const finding = o.poweredOff ? `powered off on purpose by Spark Console (${o.poweredOff}), not a fault${on ? '; turned on again' : ''}`
      : !on ? 'still dark'
      : restarted === null ? 'came back; Spark Console can’t tell whether it restarted'
        : !restarted ? 'stopped answering without restarting (consistent with the network, sleep, or being too busy to answer)'
          : !last ? 'restarted; there was no reading near the time it went dark'
            : last.gpuBusyPercent == null && last.gpuWatts == null ? 'restarted; the last reading had no GPU numbers, so Spark Console can’t tell whether it was under load'
            : loaded ? 'restarted; it was under GPU load when it went dark (consistent with a power or heat cut-off under load)'
              : 'restarted; it was idle when it went dark (consistent with being switched off by hand or a power cut, not counted as a fault)';
    list.push({ wentDarkAt: o.at, cameBackAt: on?.at || null, darkMinutes: Math.round(darkMs / 6000) / 10, lastReading: last, upSecondsWhenBack: up, finding });
  };
  for (const e of events) {
    if (e.spark !== spark) continue;
    // (the first offline of a dark period counts: one repeated after a console restart carries no reading and doesn't
    // replace it; an old one never matched by a came-back gives way to a later one that has a reading)
    if (e.type === 'spark-offline') off = off && !e.last ? off : e;
    else if (e.type === 'spark-online' && off) { add(off, e); off = null; }
  }
  if (off) add(off, null);
  return { since: events[0]?.at || null, periods: list.reverse().slice(0, max) };
}

// One look per Spark: every container's id, name and state; and the full inspect only for ones that are new or changed.
const watchScript = known => `${readingsScript}
known=${q(known)}
docker ps -a --no-trunc --format '{{.ID}}|{{.Names}}|{{.State}}' 2>/dev/null | while IFS='|' read -r id name state; do
  printf 'ps\\t%s\\t%s\\t%s\\n' "$id" "$name" "$state"
  case " $known " in *" $id:$state "*) ;; *) printf 'inspect\\t%s\\t%s\\n' "$id" "$(docker inspect "$id" 2>/dev/null | head -c 300000 | base64 | tr -d '\\n')" ;; esac
done
# (docker ps itself worked: without this line the look is "couldn't read", never "nothing there"; an if, so the script
# still ends as before)
if [ "\${PIPESTATUS[0]}" = 0 ]; then printf 'docker\\tok\\n'; fi`;
const MODEL_IMAGES = /vllm|sglang|tensorrt|trtllm|llama\.?cpp|llama-server|ollama|text-generation-inference|\btgi\b|\/nim\/|tritonserver|lmdeploy|mlc-llm|exllama/i;
const SERVICE_IMAGES = /open-?webui|comfyui|jupyter|code-server|qdrant|milvus|chroma|weaviate|postgres|pgvector|redis|valkey|mongo|minio|grafana|prometheus|n8n|langflow|flowise|searxng|neo4j|elasticsearch|opensearch|nginx|caddy|traefik/i;
function learnedFrom(spark, c) {
  const cfg = c.Config || {}, host = c.HostConfig || {}, st = c.State || {}, labels = cfg.Labels || {}, image = String(cfg.Image || '');
  const name = String(c.Name || '').replace(/^\//, ''), main = name === MAIN?.container || labels['spark.role'] === 'main';
  return {
    spark, name, id: c.Id, image, imageId: String(c.Image || ''),
    // (an app Spark Console started, 21-apps.mjs: never a model, whatever its image)
    kind: main ? 'sparkie' : labels['spark.app'] ? 'service' : labels['spark.console'] ? 'model' : MODEL_IMAGES.test(image) ? 'model' : SERVICE_IMAGES.test(image) ? 'service' : 'other',
    byConsole: labels['spark.console'] === '1' || labels['spark.app'] === '1' || main,
    command: maskDeep([...(cfg.Entrypoint || []), ...(cfg.Cmd || [])].map(String).slice(0, 120)),
    envNames: (cfg.Env || []).map(e => String(e).split('=')[0]).filter(Boolean).slice(0, 80),
    ports: Object.entries(host.PortBindings || {}).map(([p, b]) => `${(b || []).map(x => x.HostPort).filter(Boolean).join(',') || '?'}→${p}`).slice(0, 20),
    network: host.NetworkMode || null, mounts: (c.Mounts || []).map(m => `${m.Source || m.Name}:${m.Destination}${m.RW === false ? ':ro' : ''}`).slice(0, 20),
    gpu: Boolean(host.DeviceRequests?.length || host.Runtime === 'nvidia'), privileged: Boolean(host.Privileged), restart: host.RestartPolicy?.Name || 'no',
    labels: Object.fromEntries(Object.entries(labels).filter(([k]) => /^spark\.|^com\.docker\.compose\.(project|service)$/.test(k)).slice(0, 20)),
    createdAt: c.Created || null, startedAt: st.StartedAt && !String(st.StartedAt).startsWith('0001') ? st.StartedAt : null,
    finishedAt: st.FinishedAt && !String(st.FinishedAt).startsWith('0001') ? st.FinishedAt : null,
    exitCode: Number.isInteger(st.ExitCode) ? st.ExitCode : null, oomKilled: st.OOMKilled === true, protected: isProtected(name, labels['spark.protect']),
  };
}

async function watchSpark(node) {
  const mine = Object.values(knowledge.workloads).filter(w => w.spark === node.id && w.id && w.state !== 'removed');
  const sent = new Map(mine.map(w => [w.id, w.state]));
  const r = await run(node, watchScript(mine.map(w => `${w.id}:${w.state}`).join(' ')), { timeout: 45000 });
  const [rd] = fields(r.out, 'read');
  if (rd) (knowledge.sparks[node.id] ||= {}).readings = { at: new Date().toISOString(), hottestC: reading(rd[0], 1000, 150), nvmeC: reading(rd[1], 1000, 120), fanRpm: reading(rd[2], 1, 30000) };
  if (r.code !== 0) return false;
  const s = (knowledge.sparks[node.id] ||= {}), now = new Date().toISOString();
  // Docker didn't answer this look (its service is restarting, or slow): that is "couldn't read", never "nothing there"
  // (F6). What is known stays as it was, and the owner hears once per outage.
  if (!fields(r.out, 'docker').length) {
    if (!s.dockerDownAt) {
      s.dockerDownAt = now;
      fleetEvent({ type: 'notice', spark: node.id, text: `Docker isn’t answering on ${sparkName(node)}, so Spark Console can’t see or change its containers. Nothing was changed. If it doesn’t come back by itself in a few minutes, run this on ${sparkName(node)}: sudo systemctl restart docker. It stops every container there: Sparkie’s model comes back by itself, and the rest need bringing back.` });
      saveKnowledge();
    }
    return false;
  }
  const dockerBack = Boolean(s.dockerDownAt);
  delete s.dockerDownAt;
  // The first look Docker answered at a Spark only learns what's there; after that, changes are announced. sawContainers
  // marks that look (kept in knowledge.json under its old name), also when it found nothing: a Spark first seen empty
  // has had its first look, so the first job that ends there before the next look is told. Docker answered (the return
  // above), so an empty list here means nothing there, not "couldn't read".
  const first = !s.sawContainers;
  s.sawContainers = true;
  s.watchedAt = now;
  s.lastSeenAt = now;
  const inspected = new Map(fields(r.out, 'inspect').map(([id, b64]) => [id, b64json(b64)?.[0]]).filter(([, c]) => c && c.Id));
  const seen = new Set();
  // (the first look is a change, so the mark is saved: a restart before the next save would make the next look a first
  // again)
  let changed = dockerBack || first;
  for (const [id, name, state] of fields(r.out, 'ps')) {
    // The engine check before a two-Spark start runs for about a minute; it isn't a workload.
    if (!id || !name || name === ENGINE_CHECK_NAME) continue;
    const key = `${node.id}/${name}`, before = knowledge.workloads[key], c = inspected.get(id);
    seen.add(key);
    if (!before && !c) continue;
    // (a row changed while this look ran, a job run again: this look's state for it is from before, so the next look,
    // which reads it afresh, decides)
    if (before && !c && sent.has(id) && sent.get(id) !== before.state) continue;
    const next = c ? { ...(before && before.id === id ? before : { firstSeenAt: now }), ...learnedFrom(node.id, c) } : { ...before };
    Object.assign(next, { state, running: state === 'running', lastSeenAt: now });
    delete next.removedAt;
    knowledge.workloads[key] = next;
    if (!before || before.id !== id || before.state !== state) changed = true;
    // A job (keep_running once, A13) is told once when it ends (21-apps.mjs jobEnded), and again only after it ran again.
    // The first look at a Spark only marks what had ended.
    if (next.labels?.['spark.job'] === '1') {
      if (state === 'running') delete next.endTold;
      else if (['exited', 'dead'].includes(state) && !next.endTold) { next.endTold = true; changed = true; if (!first) try { jobEnded(node, next); } catch (e) { console.error(`Telling ${name}’s end: ${e.message}`); } }
    }
    // The first look at a Spark only learns what's there; changes after that are announced.
    if (first) continue;
    const base = { spark: node.id, container: name, kind: next.kind, ...(next.byConsole ? {} : { outside: true }) };
    if (!before || before.id !== id || before.state === 'removed') fleetEvent({ type: state === 'running' ? 'started' : 'created', ...base, image: next.image });
    else if (before.state !== state) {
      if (state === 'running') fleetEvent({ type: 'started', ...base });
      else if (before.state === 'running') {
        // (the self-test's healing drill killed this very container on purpose: a crash, said as the drill's, 18-workflows.mjs)
        const drill = healDrills.has(`${node.id}/${id}`);
        const crashed = next.oomKilled || (next.exitCode !== null && ![0, 137, 143].includes(next.exitCode)) || drill;
        fleetEvent({ type: crashed ? 'crashed' : 'stopped', ...base, exitCode: next.exitCode, ...(next.oomKilled ? { oomKilled: true } : {}), ...(drill ? { drill: true } : {}) });
        if (crashed) maybeHeal(node, next).catch(e => console.error(`Self-healing ${name}: ${e.message}`));
      }
    }
  }
  for (const [key, w] of Object.entries(knowledge.workloads)) {
    if (w.spark !== node.id || seen.has(key) || w.state === 'removed') continue;
    Object.assign(w, { state: 'removed', running: false, removedAt: now });
    changed = true;
    if (!first) fleetEvent({ type: 'removed', spark: node.id, container: w.name, kind: w.kind });
  }
  return changed;
}

// Model servers started by hand: which models they serve (from the library scan), and, when the image comes from a
// source the console trusts and the command can be repeated, a recipe to start it again.
const ENGINE_OF_IMAGE = [[/sglang/i, 'sglang'], [/tensorrt|trtllm/i, 'trtllm'], [/llama\.?cpp|llama-server/i, 'llama.cpp'], [/vllm/i, 'vllm']];
function learnRecipe(spark, w, inv) {
  const engine = ENGINE_OF_IMAGE.find(([re]) => re.test(w.image))?.[1], model = (w.servedModels || []).map(id => libraryModel(inv, id)).find(Boolean);
  const done = (why, candidate = null) => {
    fleetEvent({ type: 'learned', spark, container: w.name, kind: 'model', model: model?.repo || model?.name || w.servedModels?.[0] || null, recipe: false, why });
    return { saved: false, why, ...(candidate ? { candidate } : {}) };
  };
  if (!model) return done('the model it serves isn’t in the library');
  if (!engine) return done(`its engine isn’t one Spark Console starts (${w.image})`);
  if (!(CONFIG.imageSources || []).some(p => w.image.startsWith(p))) return done(`its image (${w.image}) isn’t from a source Spark Console trusts`);
  const command = w.command || [], from = command.findIndex(t => String(t).startsWith('-'));
  if (command.some(t => String(t).includes('[hidden]'))) return done('its command has hidden values (keys or tokens)');
  const { args, problems } = dig.cleanFlags(from < 0 ? [] : command.slice(from), model.repo || model.name);
  if (problems.length) return done(`its flags ${problems[0]}`);
  // Anyone who can start a container could otherwise create a one-click recipe, so it waits for the owner's OK.
  return done('saved as a candidate; it becomes a one-click recipe once the owner approves it', { model: model.name, repo: model.repo || null, engine, image: w.image, args,
    pinned: w.image.includes('@sha256:'), envNames: (w.envNames || []).slice(0, 20) });
}
async function learnModels() {
  const inv = await recentInventory().catch(() => null);
  if (!inv) return false;
  let changed = false;
  for (const sp of inv.sparks.filter(x => x.online)) for (const e of sp.external) {
    const w = knowledge.workloads[`${sp.id}/${e.container}`], models = e.models.filter(m => /^[\w./:@-]{1,200}$/.test(String(m)));
    if (!w || !models.length) continue;
    if (w.kind !== 'model' || String(w.servedModels) !== String(models)) { Object.assign(w, { kind: 'model', servedModels: models, port: e.port }); changed = true; }
    if (w.learnedRecipe === undefined && w.running) { w.learnedRecipe = learnRecipe(sp.id, w, inv); changed = true; }
  }
  return changed;
}

// Sparks coming and going (from the status check every 30 seconds).
function noteSparkStates(nodes) {
  for (const n of nodes) {
    const s = (knowledge.sparks[n.id] ||= {}), online = n.state === 'online', now = new Date().toISOString();
    if (online) {
      s.lastSeenAt = now;
      s.gpu = { at: now, busy: reading(n.gpuUtilization, 1, 100), watts: reading(n.gpuPowerWatts, 1, 2000), tempC: reading(n.temperature, 1, 150), upSeconds: reading(n.uptimeSeconds, 1, 1e9) };
      // The whole Spark at the wall, from its smart plug (12-plugs.mjs), so a Spark that goes dark keeps that too.
      if (n.wall?.answering && typeof n.wall.watts === 'number') s.wall = { at: now, watts: n.wall.watts };
    }
    // Going dark keeps the last readings (under three minutes old); coming back says how long it has been up.
    const flipped = s.online !== undefined && s.online !== online, cameOn = online && s.online !== true;
    // (one Spark Console powered off itself says so, with why: on purpose, not a fault, 21-power.mjs)
    const off = !online && flipped ? powerState().off[n.id] : null;
    // (planned: a sleep Spark Console put it to, or a wake from one (its record still there, a power operation on it, or a
    // power-on since it went dark), never an outage: crash restarts aren't held back after it, maybeHeal, D4)
    const wake = online && flipped && (consoleOff(n.id) || powerOpOn([n.id]) || plannedWake(n.id));
    if (flipped) fleetEvent(online ? { type: 'spark-online', spark: n.id, upSeconds: s.gpu?.upSeconds ?? null, ...(wake ? { planned: true } : {}) } : { type: 'spark-offline', spark: n.id, last: lastReading(s), ...(off ? { poweredOff: POWER_WHY[off.why] || off.why || 'asked', planned: true } : {}) });
    s.online = online;
    // Written at once, so a console restart while a Spark is dark doesn't announce it going dark again.
    if (flipped) saveKnowledge();
    // (a Spark back on, or seen on for the first time, gets the state's copy if the state changed: with idle Sparks
    // powered off, one may be on only now and then, 20-state-copy.mjs)
    if (cameOn) try { copyOnWake(n.id); } catch {}
  }
}
function saveKnowledge() {
  const all = Object.entries(knowledge.workloads);
  if (all.length > 400) {
    for (const [key] of all.filter(([, w]) => !w.running).sort((a, b) => String(a[1].lastSeenAt).localeCompare(String(b[1].lastSeenAt))).slice(0, all.length - 400)) delete knowledge.workloads[key];
  }
  try { writePrivate(KNOWLEDGE_FILE, knowledge); } catch (e) { console.error(`Couldn’t save what the watcher learned: ${e.message}`); }
}
let watching = false, watchRounds = 0;
async function watchFleet() {
  if (watching) return;
  watching = true;
  try {
    await refreshNodes(null);
    const changed = (await Promise.all(NODES.map(n => watchSpark(n).catch(() => false)))).some(Boolean);
    // The library scan is heavier: after a change, and every fifth round.
    const learned = changed || ++watchRounds % 5 === 0 ? await learnModels().catch(() => false) : false;
    if (changed || learned) saveKnowledge();
  } finally { watching = false; }
}
setTimeout(() => { watchFleet(); setInterval(watchFleet, WATCH_EVERY).unref(); }, 15000).unref();

// A Spark that is off or not answering (the status check's word, saved at once when it flips): what the watcher last
// saw there stays in the record as it was (healing, the passkey gate and the intent gate read it), but no view calls
// it running now (F16). Called only at run time, never at load.
const sparkOff = id => knowledge.sparks[id]?.online === false;
// A Spark Spark Console turned on since it last went dark (a spark-powered-on after its last spark-offline): a planned wake.
function plannedWake(id) {
  const dark = Math.max(0, ...events.filter(e => e.type === 'spark-offline' && e.spark === id).map(e => Date.parse(e.at) || 0));
  return events.some(e => e.type === 'spark-powered-on' && e.spark === id && (Date.parse(e.at) || 0) >= dark);
}
// What Sparkie is told about the fleet in the owner's chats: built here from what the watcher saw, not by the browser.
function fleetNotes(viewer) {
  if (viewer.role !== 'owner') return null;
  const running = Object.values(knowledge.workloads).filter(w => w.running);
  const apps = new Set(desired().running.filter(x => x.app).map(keyOf));
  const lines = NODES.map(n => {
    const ws = running.filter(w => w.spark === n.id), off = sparkOff(n.id) ? powerMark(n.id) : null;
    // (powered off by Spark Console on purpose, 21-power.mjs: said as asleep, never as dark)
    // (a record with a problem, a wake that failed, is said as that: no "asleep")
    if (off) return `${sparkName(n)}: ${off.problem ? '' : 'asleep, on purpose (not a fault). '}${off.words}`;
    if (ws.length && sparkOff(n.id)) {
      const at = knowledge.sparks[n.id].lastSeenAt;
      return `${sparkName(n)}: off or not answering${at ? ` since ${String(at).slice(0, 16).replace('T', ' ')} UTC` : ''}, so nothing there is known to be running. Last seen running: ${ws.map(w => `${w.name} (${w.kind})`).join('; ')}`;
    }
    return ws.length ? `${sparkName(n)}: ${ws.map(w => `${w.name} (${w.kind}${w.servedModels?.length ? `, serves ${w.servedModels.join(', ')}` : ''}${w.byConsole ? '' : ', started outside Spark Console'}${apps.has(`${w.spark}/${w.name}`) ? ', an app kept running (keep_running restarts or stops it)' : ''})`).join('; ')}` : null;
  }).filter(Boolean);
  const recentEv = events.slice(-10).reverse().map(e => `${e.at.slice(0, 16).replace('T', ' ')} UTC: ${describeEvent(e)}`);
  const off = WORKFLOWS.map(w => workflowStatus(w.id)).filter(st => st.state !== 'active').map(st => `${st.id}: ${st.state === 'untested' ? 'off (this version wasn’t tested)' : 'not validated yet (the owner’s first run validates it)'}`);
  // What should be running but isn't (held), from the last look: the owner can bring it back or forget it.
  const held = (heldLast || []).map(x => `${x.container} on ${x.spark}: held (${x.why})`);
  // Telegram, only while it has a problem (the owner fixes a token or a pairing; Sparkie says how).
  const telegram = tgProblem() ? [`Telegram: ${TG_WORDS[tg.state]}`] : [];
  // What is waiting on the owner (20-needs.mjs), first, only when there is something.
  const needs = needsLines().map(t => `- ${t}`);
  if (!lines.length && !recentEv.length && !off.length && !held.length && !telegram.length && !needs.length) return null;
  return [...(needs.length ? ['Waiting on the owner now (built by Spark Console):', ...needs] : []), 'Containers running now, as Spark Console last saw them:', ...lines, ...(recentEv.length ? ['Recent events, newest first:', ...recentEv] : []),
    ...(off.length ? ['Workflows not active:', ...off] : []), ...(held.length ? ['Should be running but held (the owner can bring it back or forget it):', ...held] : []), ...telegram].join('\n').slice(0, 5000);
}

