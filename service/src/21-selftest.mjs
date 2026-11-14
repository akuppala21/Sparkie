/* ───────── the self-test: the fleet proved on its real hardware (design D 2.9) ───────── */
// "Run the self-test", "test the Sparks": one operation built from actions that exist, each run and waited on the way
// "Test the changes" runs its steps (stepRun), as Spark Console itself, because what it runs is fixed here and in
// config.json (selfTestImage), never chosen by the caller. On one compute Spark (computeSparks) that is on, free (no
// model, model server or GPU app runs there, and nothing is changing there) and has a small chat model on disk
// (testModels):
//   Model    start_model there, stopping nothing (noStops); it answers its test prompt, and is timed.
//   Healing  the drill: that model's container, by the id this run started and nothing else, is killed; self-healing
//            (the watcher, then maybeHeal) must start it again and see it answer.
//   Stop     stop_model.
//   App      keep_running: a small web page from selfTestImage; its link must answer; then it stops.
//   Job      keep_running once with the GPU: nvidia-smi into its /out folder (gpu.txt), waited on to its end (waitJobEnd).
//   Model address from a container: the same job asks the one model address for its list (models.json).
// A step that fails doesn't stop the later ones. Nothing is left running, nothing starts on the hub, and nothing that was
// running before is stopped (noStops; and the Spark is one where nothing runs that a step would stop). When start_model,
// stop_model or restart_model wait for their validation run, these runs are it (the drill's heal is restart_model's).
// The web page's and job's containers stay, stopped, and are used again next time (their names carry a hash of what they
// run, so a new image or address makes new ones). The model it starts never joins the list of what should be running
// (desiredAfter; its start, the drill's restart and its stop are marked selfTest), and a model that is on that list for
// the Spark is never the one it picks. It wakes nothing: with no compute Spark on, it says so and starts nothing. It is not
// a workflow (no lock entry): each step is an action with its own gate. What a run starts is kept in self-test.json as it
// starts (the model's container id as soon as Docker has one), so a restart of Spark Console in the middle stops exactly
// those at start-up (selfTestRecover); the file is cleared when the run ends.
const SELF_TEST_WEB_PORT = (ALL_LOCAL && Number(process.env.SPARK_CONSOLE_SELFTEST_PORT)) || 18990;
const SELF_TEST_JOB_MS = Number(process.env.SPARK_CONSOLE_SELFTEST_JOB_MS || 10 * 60000);
// How long the drill waits for self-healing to take it up: the watcher looks once a minute.
const SELF_TEST_HEAL_MS = Number(process.env.SPARK_CONSOLE_SELFTEST_HEAL_MS || Math.max(3 * 60000, 3 * WATCH_EVERY + 30000));
const SELF_TEST_WEB = ['python3', '-m', 'http.server', '8080', '--directory', '/tmp'];
// The job's words: sh runs nvidia-smi into gpu.txt, then the address check (Python, from the same image) into
// models.json, in its working folder (-w /out). Each part prints one line, "selftest <part> <exit> <seconds>", read back
// from its log by code (numbers only, never shown); the job ends 0 only when both worked.
const SELF_TEST_PY = 'import sys,json,urllib.request as u;d=u.urlopen(sys.argv[1],timeout=20).read();open("models.json","wb").write(d);sys.exit(json.loads(d).get("object")!="list")';
const SELF_TEST_SH = 's=$(date +%s); nvidia-smi > gpu.txt 2>&1; g=$?; echo selftest gpu $g $(($(date +%s) - s)); s=$(date +%s); python3 -c "$1" "$0" > address.txt 2>&1; m=$?; echo selftest address $m $(($(date +%s) - s)); [ $g = 0 ] && [ $m = 0 ]';
const selfTestJobCommand = address => ['sh', '-c', SELF_TEST_SH, address, SELF_TEST_PY];
// The one model address, as a program in a container on a compute Spark calls it (on the stand-in fleet, this service).
const selfTestAddress = () => {
  const base = ALL_LOCAL ? `http://127.0.0.1:${CONFIG.port}` : consoleOrigin();
  return /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(base) ? `${base}${API_MOUNT}/v1/models` : null;
};
const selfTestName = (kind, what) => `spark-selftest-${kind}-${createHash('sha256').update(JSON.stringify(what)).digest('hex').slice(0, 8)}`;
const wordList = list => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0] || '');
const firstLine = e => maskSecrets(String(e?.message || e || 'unknown').split('\n')[0]).slice(0, 300);

// Where it runs: a compute Spark that is on and free, with a small chat model on disk (Spark 1 last, as for "Test the
// changes"). Free: nothing is changing there (a claim, or any operation under way that names it: a download-then-start
// holds no claim while it downloads), and no model, model server or GPU app runs there (a fresh look at Docker for the
// GPU apps: the watcher's record of a job run again says "running" until its next look). Otherwise it says why, in plain
// words, and nothing is started.
async function selfTestPlace(spark) {
  const inv = await inventory(null), compute = computeSparks(), name = id => sparkName(nodeById(id) || { id });
  const on = inv.sparks.filter(sp => (spark ? sp.id === spark : compute.includes(sp.id)) && sp.online && sp.dockerOk);
  if (!on.length) {
    if (spark) throw new HttpError(409, `${name(spark)} is off or not answering, so the self-test didn’t run and nothing was started. It wakes nothing: turn it on, then ask again.`);
    if (!compute.length) throw new HttpError(409, 'There is no compute Spark on the list (only the hub, where nothing else runs), so the self-test didn’t run.');
    throw new HttpError(409, `No compute Spark is on: ${wordList(compute.map(name))} ${compute.length > 1 ? 'are' : 'is'} off or not answering, so the self-test didn’t run and nothing was started. It wakes nothing: turn one on, then ask again.`);
  }
  // (the owner's list of what should be running: a model on it for that Spark is the owner's, even while it is down, and
  // the test's stop would take it off. Read strictly: a list that can't be read isn't "empty".)
  let wanted;
  try { wanted = desired(true).running; } catch { throw new HttpError(409, 'The list of what should be running can’t be read just now, so the self-test didn’t run. Try again in a minute.'); }
  const listedOn = id => new Set(wanted.filter(x => (x.sparks || [x.spark]).includes(id)).flatMap(x => [x.container, `${x.container}-part2`]));
  const models = testModels(inv), why = [];
  for (const sp of on.sort((a, b) => (a.id === 'spark1') - (b.id === 'spark1'))) {
    if (busySparks.has(sp.id)) { why.push(`something is changing on ${name(sp.id)} now (${busySparks.get(sp.id)})`); continue; }
    const op = [...jobs.values()].find(x => x.status === 'running' && (x.nodes || [x.node]).includes(sp.id));
    if (op) { why.push(`${name(sp.id)} has an operation under way (${op.type}${op.model ? ` ${String(op.model).slice(0, 80)}` : ''})`); continue; }
    // (a GPU app or job running there has its GPU to itself, A13)
    const look = await run(nodeById(sp.id), `docker ps --filter label=spark.gpu=1 --format 'gpuapp\t{{.Names}}' 2>/dev/null && echo looked`, { timeout: 20000 });
    if (look.code !== 0 || !/^looked$/m.test(look.out)) { why.push(`Docker on ${name(sp.id)} didn’t answer just now`); continue; }
    const busy = [...sp.deployments.filter(d => d.state === 'running').map(d => d.container), ...sp.external.map(e => e.container), ...fields(look.out, 'gpuapp').map(([n]) => n)];
    if (busy.length) { why.push(`${name(sp.id)} runs ${wordList([...new Set(busy)])}`); continue; }
    const here = models.filter(m => m.copies?.includes(sp.id)), listed = listedOn(sp.id), model = here.find(m => !listed.has(containerName(m.name)));
    if (!here.length) { why.push(`${name(sp.id)} has no small chat model on disk`); continue; }
    if (!model) { why.push(`every small chat model on ${name(sp.id)} is on the list of what should be running there, and the self-test never touches those`); continue; }
    return { spark: sp.id, model };
  }
  throw new HttpError(409, `No compute Spark that is on is free for the self-test: ${why.join('; ')}. It stops nothing, so it didn’t run and nothing was started.`);
}

// The drill: the container this run started is killed by its id (a full id names that one container only), and
// self-healing has to start it again and see it answer. Returns the restart's operation; throws why not. A model left
// down is marked stopped on purpose, so no late restart brings it back after the test.
async function healDrill(j, node, container, id) {
  const spark = node.id, key = `${spark}/${container}`;
  if (!/^[0-9a-f]{64}$/.test(String(id || ''))) throw new Error('Its container’s id couldn’t be read, so nothing was stopped.');
  // The watcher has to have seen it running, or it couldn't tell that it stopped.
  for (const until = Date.now() + 3 * WATCH_EVERY + 15000; !(knowledge.workloads[key]?.id === id && knowledge.workloads[key].state === 'running'); await sleep(1000)) {
    cancelCheck(j);
    if (Date.now() > until) throw new Error('The watcher hadn’t seen it running yet, so nothing was stopped.');
  }
  const mark = `${spark}/${id}`, since = new Date().toISOString();
  healDrills.add(mark);
  try {
    step(j, `The healing drill: stopping ${container} hard, on purpose`);
    const release = claimSparks([spark], 'the self-test’s healing drill');
    let k;
    try { k = await run(node, `docker kill --signal KILL ${q(id)}`, { timeout: 30000 }); } finally { release(); }
    if (k.code !== 0) throw new Error(`Docker couldn’t stop it: ${firstLine(k.err || k.out)}`);
    note(j, `Stopped ${container} (${id.slice(0, 12)}) hard; waiting for self-healing`);
    let e = null;
    for (const until = Date.now() + SELF_TEST_HEAL_MS; ; await sleep(1000)) {
      cancelCheck(j);
      e = events.find(x => x.at >= since && x.spark === spark && x.container === container && ['healing', 'heal-skipped'].includes(x.type));
      if (e) break;
      if (Date.now() > until) throw new Error(`Self-healing didn’t start it again within ${Math.round(SELF_TEST_HEAL_MS / 60000)} minutes.`);
    }
    if (e.type === 'heal-skipped') throw new Error(`Self-healing didn’t start it again: ${e.why}.`);
    j.drillRestart = e.operation;
    note(j, `Self-healing is starting it again (operation ${e.operation})`);
    const done = await waitJob(e.operation, 45 * 60000);
    if (done?.status !== 'completed') throw new Error(`Self-healing’s restart didn’t work: ${firstLine(done?.error || done?.status || 'unknown')}`);
    return e.operation;
  } catch (err) {
    consoleStopped.set(key, Date.now());
    throw err;
  } finally { healDrills.delete(mark); }
}

// Why self-healing wouldn't restart the drill's model now, and when to ask again; null when it would. maybeHeal's own
// rules before it looks at the crash itself (18-workflows.mjs), asked before anything is killed: a drill that can't come
// back is never run, and isn't a failure.
const inAbout = at => { const m = Math.max(1, Math.ceil((at - Date.now()) / 60000)); return `in about ${m} minute${m === 1 ? '' : 's'}`; };
function drillHeldBack(node, container) {
  const s = agentSettings();
  if (!s.selfHeal) return 'Automatic restarts are off (Access → Agents), so the drill didn’t run.';
  if (s.halted && !s.autoPaused) return 'Agents’ changes are paused (Access → Agents), and self-healing waits too, so the drill didn’t run.';
  const tries = healTriesThisHour(`${node.id}/${container}`);
  if (tries.length >= 2) return `Self-healing restarted ${container} twice in the last hour, the most it does, so the drill didn’t run. Ask again ${inAbout(Math.min(...tries) + 3600000)}.`;
  if (workflowStatus('restart_model').state === 'untested') return 'The restart workflow hasn’t passed Spark Console’s tests, so self-healing restarts nothing and the drill didn’t run.';
  const flip = lastOnOff(node.id);
  if (flip) return `${sparkName(node)} went off or came on in the last half hour, and self-healing restarts nothing there for half an hour after that, so the drill didn’t run. Ask again ${inAbout(flip + 30 * 60000)}.`;
  return null;
}

// What a job printed about its two parts ("selftest gpu 0 3"), from the last lines of its log: numbers only.
async function selfTestJobParts(node, name) {
  const r = await run(node, `docker logs --tail 20 ${q(name)} 2>/dev/null`, { timeout: 20000 });
  const out = {};
  for (const [, part, code, secs] of String(r.out).matchAll(/^selftest (gpu|address) (\d{1,3}) (\d{1,7})$/gm)) out[part] = { code: Number(code), seconds: Number(secs) };
  return out;
}
// What the run under way started, for a restart in the middle (R20: writePrivate and readKept; no secret in it).
const SELF_TEST_FILE = `${STATE_DIR}/self-test.json`;
// As Spark Console: the starts and stops carry their validation run when their workflow waits for one (trusted only
// where a validation mark has to pass); its model's own operations are marked, so they never touch the list.
const selfTestCtx = spark => ({ via: 'page', actor: 'Self-test', request: `the self-test on ${sparkName(nodeById(spark) || { id: spark })}`, canChange: true, trusted: true, noStops: true, selfTest: true });
const selfTestNeed = id => (workflowStatus(id).state === 'needs-validation' ? id : null);
const selfTestMine = x => { x.selfTest = true; };
// Its model's stop (the Stop step, the clean-up, and after a restart). stop_model asked as the page first cancels every
// operation that changes models on that Spark; asked as a workflow's step it cancels only operations of the same actor,
// its own (17-changes.mjs). So when anything of anyone else's is under way there (an owner's download-then-start, say),
// that is how it asks. Always with stop_model's validation pass when that waits for its first run.
function selfTestStopModel(j, spark, container) {
  const others = [...jobs.values()].some(x => x.status === 'running' && x.actor !== 'Self-test' && holdsModelsOn(x, [spark]));
  const ctx = selfTestCtx(spark);
  return stepRun(j, healOwner(), others ? { ...ctx, via: 'workflow' } : ctx, 'stop_model', { spark, container }, selfTestNeed('stop_model'), undefined, selfTestMine);
}
// Its web page's or job's stop, through keep_running. One cut off before it joined the list (a restart while it was
// being started) is kept first, so that its stop takes it off again.
async function selfTestStopApp(j, spark, container) {
  const me = healOwner(), ctx = { ...selfTestCtx(spark), trusted: false };
  try { return await stepRun(j, me, ctx, 'keep_running', { spark, container, do: 'stop' }); } catch (e) {
    if (!/isn’t an app Spark Console keeps running/.test(String(e?.message))) throw e;
    await runAction('keep_running', me, { spark, container }, ctx);
    return stepRun(j, me, ctx, 'keep_running', { spark, container, do: 'stop' });
  }
}

// Each container's state and full id on a Spark (state "gone" when Docker has none by that name), from one fixed look
// per name. A name says nothing about whose a container is (another start makes a new one under the same name): the id
// does.
async function containerStates(node, names) {
  const r = await run(node, names.map(n => `printf 'state\\t%s\\t%s\\t%s\\n' ${q(n)} "$(docker inspect -f '{{.State.Status}}' ${q(n)} 2>/dev/null || echo gone)" "$(docker inspect -f '{{.Id}}' ${q(n)} 2>/dev/null)"`).join('\n'), { timeout: 30000 });
  return r.code === 0 ? Object.fromEntries(fields(r.out, 'state').map(([n, state, id]) => [n, { state, id: /^[0-9a-f]{64}$/.test(id || '') ? id : null }])) : null;
}

async function selfTest(j, asked, where, image) {
  const spark = where.spark, node = nodeById(spark), at = sparkName(node), m = where.model, title = m.repo || m.name, me = healOwner();
  const model = containerName(m.name), address = selfTestAddress();
  const web = selfTestName('web', [image, SELF_TEST_WEB_PORT, SELF_TEST_WEB]), job = selfTestName('job', [image, address, SELF_TEST_SH, SELF_TEST_PY]);
  // (the apps' own arguments are checked as any caller's)
  const ctx = selfTestCtx(spark), appCtx = { ...ctx, trusted: false }, mine = selfTestMine, need = selfTestNeed;
  // What it starts, kept as it starts (the chat it was asked in is known once runAction has returned).
  await sleep(0);
  const record = { operation: j.id, chat: j.conv || null, spark, since: j.createdAt, model: { container: model }, web: { container: web }, job: { container: job } };
  const keep = (what, id) => {
    if (what) record[what].id = id || null;
    try { writePrivate(SELF_TEST_FILE, record); } catch (e) { note(j, `Couldn’t keep a note of what the self-test starts (${firstLine(e)}); a restart of Spark Console now would leave it running.`); }
  };
  keep();
  const idOf = async name => (await containerStates(node, [name]).catch(() => null))?.[name]?.id || null;
  // (the model's id as soon as its container exists, while it loads: a restart then still knows it)
  const watchStart = x => {
    mine(x);
    (async () => {
      for (; x.status === 'running'; await sleep(2000)) {
        if (!(x.ranHere || []).includes(`${spark}/${model}`)) continue;
        const id = await idOf(model);
        if (id && id !== record.model.id) keep('model', id);
      }
    })().catch(() => {});
  };
  // (cancelling it, or the owner pausing changes, ends it at the next step; what it started is still stopped)
  const between = () => { cancelCheck(j); pausedCheck(asked); };
  const lines = [];
  const say = (what, result, began, words) => {
    const l = { what, result, seconds: began == null ? null : Math.round((Date.now() - began) / 1000), words: String(words || '') };
    lines.push(l);
    note(j, lineWords(l));
  };
  const lineWords = l => `${l.what}: ${l.result}${l.seconds == null ? '' : ` in ${l.seconds} s`}. ${l.words}`;
  const stopApp = name => selfTestStopApp(j, spark, name);
  const stopModel = () => selfTestStopModel(j, spark, model);
  let modelStarted = false, modelId = null;
  try {
    // Model: started there, stopping nothing, and it answers its test prompt.
    between();
    let t = Date.now();
    step(j, `Starting ${title} on ${at}, stopping nothing`);
    try {
      await stepRun(j, me, ctx, 'start_model', { model: m.name, spark }, need('start_model'), undefined, watchStart);
      modelStarted = true;
      // (the container this run started: only that one is ever killed or stopped by it, never another under that name)
      modelId = await idOf(model);
      keep('model', modelId);
      say('Model', 'worked', t, `${title} started on ${at} and answered its test prompt.`);
    } catch (e) { say('Model', 'failed', t, firstLine(e)); }

    // Healing: the drill.
    between();
    t = Date.now();
    const held = modelStarted ? drillHeldBack(node, model) : null;
    if (!modelStarted) say('Healing', 'not tried', null, 'The model didn’t start, so there was nothing to bring back.');
    else if (held) say('Healing', 'not tried', null, held);
    else {
      try {
        await healDrill(j, node, model, modelId);
        say('Healing', 'worked', t, `${model} was stopped hard on purpose (only the container this test started), and self-healing started it again; it answers again.`);
      } catch (e) { if (e?.cancelled) throw e; say('Healing', 'failed', t, firstLine(e)); }
    }

    // Stop.
    between();
    t = Date.now();
    if (!modelStarted) say('Stop', 'not tried', null, 'The model didn’t start.');
    else {
      try {
        const now = (await containerStates(node, [model]))?.[model];
        if (!now) throw new Error(`${at} didn’t answer, so whether ${model} runs isn’t known.`);
        if (now.state !== 'running') say('Stop', 'not tried', null, `${model} wasn’t running after the drill, so there was nothing to stop.`);
        else if (!modelId || now.id !== modelId) say('Stop', 'not tried', null, `${model} on ${at} is another container now (not the one this test started), so it was left alone.`);
        else {
          step(j, `Stopping ${model}`);
          await stopModel();
          say('Stop', 'worked', t, `${model} stopped, and Docker says it isn’t running.`);
        }
      } catch (e) { say('Stop', 'failed', t, firstLine(e)); }
    }

    // App: a small web page whose link answers; then it stops.
    between();
    t = Date.now();
    step(j, `A small web page on ${at}`);
    try {
      const out = await stepRun(j, me, appCtx, 'keep_running', { spark, container: web, image, port: `${SELF_TEST_WEB_PORT}:8080`, command: SELF_TEST_WEB, memoryGB: 1 });
      keep('web', await idOf(web));
      const link = jobs.get(out.operation)?.endpoint || null;
      const up = Math.round((Date.now() - t) / 1000);
      await stopApp(web);
      if (!link) throw new Error(`It ran, but its page didn’t answer at port ${SELF_TEST_WEB_PORT}, so there was no link. It was stopped.`);
      say('App', 'worked', t, `A small web page answered at its link after ${up} s, then stopped.`);
    } catch (e) { if (e?.cancelled) throw e; say('App', 'failed', t, firstLine(e)); }

    // Job: once, with the GPU; and the model address from inside its container.
    between();
    t = Date.now();
    step(j, `A job with the GPU on ${at}`);
    let parts = null;
    try {
      await stepRun(j, me, appCtx, 'keep_running', { spark, container: job, image, once: true, gpu: true, memoryGB: 2, command: selfTestJobCommand(address || '-') });
      keep('job', await idOf(job));
      let end;
      try { end = await waitJobEnd(node, job, { limitMs: SELF_TEST_JOB_MS, job: j }); } catch (e) {
        if (e?.stillRunning) await stopApp(job).catch(() => {});
        throw e;
      }
      parts = await selfTestJobParts(node, job);
      const files = `its output is in jobs/${job} in the shared folder on ${at}`;
      if (end.state !== 'exited') throw new Error(end.state === 'created' ? 'It was made but never ran.' : `It ended as “${end.state}”.`);
      if (end.oomKilled) throw new Error('It ran out of memory.');
      if (!parts.gpu) throw new Error(`It ended with exit ${end.exitCode ?? 'unknown'} before it ran nvidia-smi.`);
      if (parts.gpu.code !== 0) throw new Error(`nvidia-smi didn’t work inside the job (exit ${parts.gpu.code}); what it said is in jobs/${job}/gpu.txt in the shared folder on ${at}.`);
      say('Job', 'worked', t, `It ran once with the GPU, and nvidia-smi worked; ${files}.`);
    } catch (e) { if (e?.cancelled) throw e; say('Job', 'failed', t, firstLine(e)); }
    const a = parts?.address;
    if (!address) say('Model address from a container', 'not tried', null, 'Spark Console’s own address isn’t known.');
    else if (!a) say('Model address from a container', 'not tried', null, 'The job didn’t get that far.');
    else if (a.code === 0) say('Model address from a container', 'worked', Date.now() - a.seconds * 1000, `The job got the model list from ${address} from inside its container.`);
    else say('Model address from a container', 'failed', Date.now() - a.seconds * 1000, `The job couldn’t get the model list from ${address} from inside its container; what it said is in jobs/${job}/address.txt in the shared folder on ${at}.`);
  } finally {
    // Whatever this run started that still runs is stopped (a step's operation still going is cancelled first).
    // (its own: its steps, and the drill's restart of its model)
    const going = [...jobs.values()].filter(x => x !== j && x.status === 'running' && ((x.actor === 'Self-test' && x.createdAt >= j.createdAt) || x.id === j.drillRestart));
    if (going.length) await cancelJobsAndWait(going, 'the self-test');
    const now = await containerStates(node, [model, web, job]).catch(() => null);
    if (modelStarted && modelId && now?.[model]?.state === 'running' && now[model].id === modelId) await stopModel().catch(e => note(j, `Couldn’t stop ${model}: ${firstLine(e)}`));
    for (const name of [web, job].filter(n => now?.[n]?.state === 'running')) await stopApp(name).catch(e => note(j, `Couldn’t stop ${name}: ${firstLine(e)}`));
    // What is left, as Docker has it now (R21).
    const left = await containerStates(node, [model, web, job]).catch(() => null);
    // (the model's name counts only while it is still the container this run started)
    const ours = n => n !== model || (modelId && left?.[n]?.id === modelId);
    const running = left ? [model, web, job].filter(n => left[n]?.state === 'running' && ours(n)) : null;
    const stopped = left ? [web, job].filter(n => left[n] && !['running', 'gone'].includes(left[n].state)) : [];
    const modelLeft = left && ours(model) && left[model] && !['running', 'gone'].includes(left[model].state);
    const leftWords = !left ? `Left behind: unknown, ${at} didn’t answer the last look.`
      : running.length ? `Left behind: ${wordList(running)} still running on ${at}. Stop ${running.length > 1 ? 'them' : 'it'} there.`
        : `Left behind: nothing running.${modelLeft ? ` ${model} is stopped on ${at}, as after any stop.` : ''}${stopped.length ? ` ${wordList(stopped)} ${stopped.length > 1 ? 'are' : 'is'} stopped there and used again next time.` : ''}`;
    j.report = [...lines.map(lineWords), leftWords];
    note(j, leftWords);
    // (the run is over: nothing for a restart to stop)
    try { unlinkSync(SELF_TEST_FILE); } catch {}
    if (!left || running?.length) lines.push({ result: 'failed', what: 'Left behind' });
  }
  const bad = lines.filter(l => l.result === 'failed').map(l => l.what.toLowerCase());
  if (bad.length) throw new Error(`The self-test found ${bad.length === 1 ? 'a problem' : `${bad.length} problems`}: ${wordList(bad)}.`);
}

action({
  name: 'self_test', title: 'Test the Sparks (the self-test)', kind: 'change', scope: 'fleet:act', who: 'owner', group: 'checks',
  description: 'Use when the owner asks to run the self-test or to test the Sparks (the hardware, not the code). On one compute Spark that is on and free (never Sparkie’s), it starts a small model and checks it answers, stops its container hard to see self-healing bring it back, stops it, runs a small web page and checks its link, and runs a job with the GPU that also calls the model address from inside its container. It reports one line per check, with its seconds. It stops nothing that was running and leaves nothing running; it wakes no Spark. It returns an operation id at once, and its report is posted here when it ends (a few minutes). Give spark only if the owner named one.',
  input: { type: 'object', properties: {
    spark: { ...sparkArg, description: 'Only if the owner named the Spark to test (a compute Spark, never Sparkie’s).' },
  }, additionalProperties: false },
  run: async (input, viewer, ctx) => {
    const spark = input?.spark || null, args = spark ? { spark } : {};
    if (spark) notBrainsSpark([spark]);
    // From an agent (its own call, its key, or through Sparkie) it is the owner's question, as other changes it can't
    // make alone are: it runs a model, an app and a GPU job on a Spark for minutes.
    if ((ctx.via === 'agent' || viewer.agentKey || ctx.agent) && !ctx.ownerConfirmed) {
      const label = changeLabel('self_test', args);
      return question(viewer, ctx, `${label}? Running the self-test is the owner’s call.`, [{ label, call: { action: 'self_test', args } }, { label: 'No, not now', call: null }], 'question', { ownerOnly: true });
    }
    if (spark) mustUse(viewer, [spark]);
    if ([...jobs.values()].some(j => j.type === 'self-test' && j.status === 'running')) throw new HttpError(409, 'A self-test is running already. Its report is posted when it ends.');
    if (existsSync(SELF_TEST_FILE)) {
      let at = 'its Spark';
      try { at = sparkName(nodeById(readKept(SELF_TEST_FILE)?.spark) || { id: 'its Spark' }); } catch {}
      throw new HttpError(409, `The last self-test was cut off by a restart of Spark Console, and what it started on ${at} is stopped first (once ${at} answers). Ask again in a minute.`);
    }
    // The image is the owner's, in config.json, checked as keep_running checks any image.
    const image = String(CONFIG.selfTestImage || '');
    if (!new RegExp(ACTIONS.get('keep_running').input.properties.image.pattern).test(image)) throw new HttpError(409, 'No self-test image is set in config.json (selfTestImage), so the self-test can’t run.');
    const where = await selfTestPlace(spark);
    const job = newJob('self-test', { node: where.spark, model: where.model.repo || where.model.name, by: viewer.login, actor: ctx.actor || null, via: ctx.via || null,
      request: ctx.request ? String(ctx.request).slice(0, 300) : null });
    runJob(job, j => selfTest(j, ctx, where, image));
    return { outcome: 'started', operation: job.id, spark: where.spark, model: where.model.repo || where.model.name, container: containerName(where.model.name),
      note: `The self-test runs on ${sparkName(nodeById(where.spark))} for a few minutes. Its report is posted when it ends.`, next: `wait_operation {"id":"${job.id}"}` };
  },
});

// After a restart: what a self-test cut off in the middle had started, stopped if it still runs (its model only while it
// is the very container it started, by id; its web page and job by their own names, by id when known). Then one notice,
// also in the chat that asked. A Spark that doesn't answer is tried again a minute later; the file stays until then.
async function selfTestRecover() {
  let rec;
  try { rec = readKept(SELF_TEST_FILE); } catch (e) { console.error(`The self-test's note of what it started can't be read: ${e.message}`); return; }
  if (!rec || typeof rec !== 'object' || !rec.spark) return;
  if ([...jobs.values()].some(x => x.type === 'self-test' && x.status === 'running')) return;
  const node = nodeById(rec.spark);
  if (!node) { try { unlinkSync(SELF_TEST_FILE); } catch {} return; }
  const parts = [['model', rec.model], ['web', rec.web], ['job', rec.job]].filter(([, x]) => x && NAME_RE.test(String(x.container || '')));
  const now = await containerStates(node, parts.map(([, x]) => x.container)).catch(() => null);
  if (!now) { setTimeout(() => selfTestRecover().catch(() => {}), 60000).unref?.(); return; }
  const at = sparkName(node), quiet = { log: [] }, stopped = [], problems = [];
  for (const [what, x] of parts) {
    const c = now[x.container];
    if (c?.state !== 'running') continue;
    if (x.id ? c.id !== x.id : what === 'model') {
      if (!x.id) problems.push(`${x.container} runs there, and whether it is the one the test started isn’t known, so it was left alone: if it is, stop it`);
      continue;
    }
    try { await (what === 'model' ? selfTestStopModel(quiet, rec.spark, x.container) : selfTestStopApp(quiet, rec.spark, x.container)); stopped.push(x.container); }
    catch (e) { problems.push(`${x.container} couldn’t be stopped (${firstLine(e)}): stop it there`); }
  }
  try { unlinkSync(SELF_TEST_FILE); } catch {}
  const text = `Spark Console restarted while the self-test ran on ${at}. ${stopped.length ? `It stopped what the test had started there: ${wordList(stopped)}.` : 'Nothing the test had started was still running there.'}${problems.length ? ` ${problems.join('; ')}.` : ''} Nothing else was touched. Ask again to run the self-test.`;
  fleetEvent({ type: 'notice', spark: rec.spark, text });
  const conv = /^sc_[0-9a-f]{16}$/.test(String(rec.chat || '')) ? chatData().conversations.find(c => c.id === rec.chat && c.login === accessList().owner) : null;
  if (!conv) return;
  const at2 = new Date().toISOString();
  conv.messages.push({ role: 'assistant', content: maskSecrets(text), createdAt: at2, notice: true });
  conv.updatedAt = at2;
  saveChats();
  if (conv.channel === 'telegram') tell('result', text).catch(() => {});
}
setTimeout(() => selfTestRecover().catch(e => console.error(`Stopping what a cut-off self-test started: ${e.message}`)), Number(process.env.SPARK_CONSOLE_SELFTEST_RECOVER_MS || 5000)).unref?.();
// An operation a restart cut off that was the self-test's (its own, a step of it, or anything on its Spark since it began,
// such as its drill's restart): its clean-up above says what happened, and "start it again" would be wrong.
function selfTestCutOff(e) {
  if (e.operation === 'self-test' || e.actor === 'Self-test') return true;
  let rec = null;
  try { rec = readKept(SELF_TEST_FILE); } catch {}
  return Boolean(rec?.spark && (e.spark === rec.spark || (e.sparks || []).includes(rec.spark)) && String(e.at) >= String(rec.since || '~'));
}
