/* ───────── jobs ───────── */
// Area: ground
// Rules: R7, R9, R13, R14, R15, R16, R21
// Tests: change.test.mjs, state.test.mjs, pause.test.mjs, workloads-receipts.test.mjs
// Owns: none
// Timers: none        Wakes: none
const jobs = new Map();
// Set while the service is stopping: no new operations start (running ones get a moment to finish).
let draining = false, agentFailuresInARow = [];
function newJob(type, meta) {
  if (draining) throw new HttpError(503, 'Spark Console is restarting. Try again in a minute.');
  const job = { id: randomBytes(6).toString('hex'), type, ...meta, status: 'running', step: 'Starting', log: [], progress: null, createdAt: new Date().toISOString() };
  job.checkPause = () => cancelCheck(job);
  // Cancelling ends the job's long commands (downloads, copies, pulls) straight away.
  Object.defineProperty(job, 'abort', { value: new AbortController(), enumerable: false });
  jobs.set(job.id, job);
  opEnergyStart(job);
  // Its start goes on the fleet's record (on disk), so an operation cut off by a restart is reported, never forgotten.
  try { fleetEvent({ type: 'operation', id: job.id, operation: type, status: 'started', model: job.model || null, spark: job.node || null, ...(job.nodes ? { sparks: job.nodes } : {}),
    ...(job.actor ? { actor: job.actor } : {}), ...(Array.isArray(meta?.stops) && meta.stops.length ? { stops: meta.stops } : {}) }); } catch {}
  // The last 50 are kept, and never one still running (a daily research burst could push out a start in progress).
  for (const [id] of [...jobs].filter(([, j]) => j.status !== 'running').slice(0, Math.max(0, jobs.size - 50))) jobs.delete(id);
  return job;
}
// An operation's record holds no key: each log line, its step and its error are masked as they are written (as the
// fleet's record masks them), so every view of it (/jobs, wait_operation, the journal) shows them masked (R7).
function note(job, line) {
  job.log.push(`${new Date().toTimeString().slice(0, 8)}  ${maskSecrets(String(line))}`);
  journalNote(job, line);
  if (job.log.length > 300) job.log.splice(0, job.log.length - 300);
}
function step(job, text) { job.step = maskSecrets(String(text)); note(job, text); }
const jobMasked = v => (v == null ? v : maskSecrets(String(v)));
const publicJob = ({ release, ...job }) => ({ ...job, log: job.log.slice(-120) });
// One change at a time on each Spark (deploys, stops, Sparkie's model), claimed before anything else happens, so two
// clicks or two agents can't both start changing the same Spark. Released when the operation ends.
const busySparks = new Map();
function claimSparks(ids, what) {
  const taken = ids.find(id => busySparks.has(id));
  if (taken) throw new HttpError(409, `Something is already changing on ${sparkName(nodeById(taken) || { id: taken })} (${busySparks.get(taken)}). Wait for it to finish.`);
  for (const id of ids) busySparks.set(id, what);
  let done = false;
  return () => { if (!done) { done = true; for (const id of ids) busySparks.delete(id); } };
}
// Runs an operation while holding its Sparks; if it can't start, they're released straight away.
function claimed(ids, what, start) {
  const release = claimSparks(ids, what);
  try { const job = start(); job.release = release; return job; } catch (e) { release(); throw e; }
}
// The containers a deploy was shown stopping, as "spark/container"; null when an older page didn't send the list.
function stopList(v) {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v) || v.length > 40 || !v.every(x => /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(String(x)))) throw new HttpError(400, 'Invalid list of containers to stop.');
  return v.map(String);
}

function runJob(job, fn) {
  fn(job).then(async () => {
    job.finishedAt = new Date().toISOString();
    // Keep the claim and a running status until this operation's own resource ids are recorded (A-22).
    try { desiredAfter({ ...job, status: 'completed' }); } catch (e) { console.error(`Couldn’t update what should be running: ${e.message}`); }
    try { await captureStartedReceipts(job); } catch (e) { note(job, `Couldn’t record what this operation started; automatic clean-up will leave it alone: ${e.message}`); }
    job.status = 'completed';
    job.step = 'Done';
    note(job, 'Done');
    if (job.via && !['page', 'watcher'].includes(job.via)) agentFailuresInARow = [];
  }).catch(e => {
    // Cancelled on purpose isn't a failure: no retries, no rollback offer, and it doesn't count against agents.
    if (e?.cancelled || job.cancelled) {
      job.status = 'cancelled';
      job.error = jobMasked(e?.message);
      note(job, e.message);
      return;
    }
    job.status = 'failed';
    job.error = jobMasked(e?.message);
    note(job, `Failed: ${e.message}`);
    // Three failed operations in a row pause agents (R9). The owner's own never count: the page, self-healing, a saved
    // workflow's steps, a /v1 start, POST /actions (api), a press, a typed yes or /undo in the paired Telegram chat
    // (telegram: only the paired owner reaches it; agents come as agent), and what Sparkie started in the owner's own
    // chat (runAction marks that job ownersOwn). Anything else, and any new via, counts as an agent.
    // (a start that a power-on operation runs for its asker, 21-power.mjs, fails that operation too: counted there, once)
    if (job.via && !job.ownersOwn && !job.partOf && !['page', 'watcher', 'workflow', 'gateway', 'api', 'telegram'].includes(job.via)) {
      agentFailuresInARow = [...agentFailuresInARow.filter(t => Date.now() - t < 3600000), Date.now()];
      if (agentFailuresInARow.length >= 3) tripBreaker('three of their operations failed in a row');
    }
  }).finally(() => {
    job.finishedAt = new Date().toISOString();
    job.release?.();
    // What agents see is fresh after anything changed, and the operation goes on the fleet's record.
    agentCache.clear();
    recordWorkflowRun(job);
    if (job.conv) try { postResult(job); } catch (e) { console.error(`Couldn’t post ${job.id}’s result: ${e.message}`); }
    // (one started from Telegram whose chat is gone: off the list that restarts report)
    if (job.channel) try { tellAwaitDone(job.id); } catch {}
    fleetEvent({ type: 'operation', id: job.id, operation: job.type, status: job.status, model: job.model || null, spark: job.node || null, ...(job.nodes ? { sparks: job.nodes } : {}), ...(job.actor ? { actor: job.actor } : {}),
      ...(job.error ? { error: maskSecrets(String(job.error).slice(0, 500)).slice(0, 300) } : {}), by: !job.by ? null : String(job.by).toLowerCase() === String(accessList().owner || '').toLowerCase() ? 'owner' : 'Spark Console' });
    learnFrom(job, journalOp(job));
  });
  return job;
}

// Stream the folder from the models Spark through this host into the target Spark. It lands in a hidden
// staging folder and moves into place only when complete, so an interrupted copy never looks like a model.
// A Hugging Face cache entry goes into the target's cache as its served snapshot with the links followed (real
// files, no blobs/), plus refs/ when there is one. That also works when blobs/ itself can't be listed.
// Following links hands their bytes over, so before anything is sent each file the copy would follow passes the
// cache's link rule (hfEachFile, R17), with weight files that lead out at least 16 MiB: a link put in the entry must not
// bring a key of this Spark onto the next one as an ordinary file.
async function copyModel(job, name, from, to, total, store = 'models') {
  const [base, folder] = store === 'hf' ? [HF_HUB, `models--${name}`] : [`"$HOME/${CONFIG.modelsDir}"`, name];
  const staging = store === 'hf' ? `${HF_HUB}/.spark-console-incoming` : `"$HOME/${CONFIG.modelsDir}/.incoming"`;
  const checked = store === 'hf' ? await run(from, `cd ${HF_HUB} || exit 0; ${hfSnap(q(folder))}; [ -n "$snap" ] || exit 0; dir=$PWD/${q(folder)}; ${HF_OWN}
${hfEachFile('snapshots/$snap', ':', 16 * 2 ** 20)}
[ -d "$dir/refs" ] || exit 0
${hfEachFile('refs', ':', 16 * 2 ** 20)}`, { timeout: 120000 }) : { code: 0 };
  if (checked.code) throw new Error(`${name} wasn’t copied from ${from.id}: ${String(checked.err || checked.out || '').trim().split('\n').pop() || 'its files couldn’t be checked'}`);
  // Both ends first: the receiving Spark only unpacks into its staging folder (A-21: a sender that ends badly after a
  // whole archive, a file it couldn't read left out, must never leave a copy that looks whole). Anything but 0 is a
  // failure: a process ended by a signal (a cancel kills both) closes with null.
  let { failed, errText } = await new Promise(resolve => {
    const src = spawnOn(from, { command: store === 'hf'
      ? `cd ${HF_HUB} || exit 1; ${hfSnap(q(folder))}; [ -n "$snap" ] || exit 1; tar -chf - ${q(folder)}/snapshots/"$snap" $([ -d ${q(folder)}/refs ] && echo ${q(folder)}/refs)`
      : `tar -C ${base} -cf - ${q(folder)}` });
    const dst = spawnOn(to, { command: `rm -rf ${staging}/${q(folder)} && mkdir -p ${staging} && tar -C ${staging} -xf -` });
    let done = 0, errText = '', closed = 0, failed = false;
    const abort = () => { errText += '\n(cancelled)'; src.kill('SIGKILL'); dst.kill('SIGKILL'); };
    if (job.abort?.signal.aborted) abort(); else job.abort?.signal.addEventListener('abort', abort, { once: true });
    // (the Spark it copies from is in use while it does: the idle power-off counts this like a call, 21-power.mjs)
    src.stdout.on('data', chunk => { done += chunk.length; job.progress = { done, total }; sparkCalls.set(from.id, Date.now()); });
    src.stdout.pipe(dst.stdin);
    for (const p of [src, dst]) {
      p.stderr.on('data', d => { errText = (errText + d).slice(-4000); });
      p.on('close', code => {
        if (code !== 0) failed = true;
        if (++closed === 2) { job.abort?.signal.removeEventListener('abort', abort); resolve({ failed, errText }); }
      });
    }
  });
  // Both ended 0: a second command moves it into place, and the copy counts only if that ended 0 too.
  if (!failed) {
    const moved = await run(to, `rm -rf ${base}/${q(folder)} && mv ${staging}/${q(folder)} ${base}/${q(folder)} && { rmdir ${staging} 2>/dev/null || true; }`, { timeout: 600000 });
    if (moved.code === 0) return;
    // Only the move failed, on the receiving Spark (W-9: often files a container left there as root): the whole copy is
    // kept in staging, never shown as a model, and the words say which Spark and the one command that finishes it there.
    // (The next start copies again from the start: the staging folder is cleared before each copy.)
    const [home, stage] = store === 'hf' ? ['~/.cache/huggingface/hub', '~/.cache/huggingface/hub/.spark-console-incoming'] : [`~/${CONFIG.modelsDir}`, `~/${CONFIG.modelsDir}/.incoming`];
    const said = String(moved.err || moved.out || '').trim().split('\n').pop().slice(0, 300) || (moved.code === 255 ? `${to.id} didn’t answer` : 'no reason given');
    throw new Error(`Copy failed: the copy reached ${to.id} but couldn’t be moved into place there (${said}). The whole copy is kept there in ${stage}/${folder}. To finish it, on ${to.id} run: sudo chown -R $USER ${home}/${folder} && rm -rf ${home}/${folder} && mv ${stage}/${folder} ${home}/${folder}`);
  }
  // Otherwise what was copied goes, and whether it went is looked at: left there, it would hold up to a whole model.
  const gone = await run(to, `rm -rf ${staging}/${q(folder)}`, { timeout: 600000 });
  const left = gone.code ? `\nThe part-copied folder on ${to.id} couldn’t be removed: on ${to.id} run rm -rf ${store === 'hf' ? `~/.cache/huggingface/hub/.spark-console-incoming/${folder}` : `~/${CONFIG.modelsDir}/.incoming/${folder}`}` : '';
  throw new Error(/Permission denied/.test(errText)
    ? `Copy failed: some files on ${from.id} can’t be read as your user (a container downloaded them as root). On ${from.id} run: sudo chown -R $USER ${store === 'hf' ? `~/.cache/huggingface/hub/${folder}` : `~/${CONFIG.modelsDir}/${folder}`}${left}`
    : `Copy failed: ${errText.trim() || 'connection closed'}${left}`);
}

// What a plan stops beyond what was shown and approved (`approved`: "spark/container" strings), so nothing that started
// using the GPU after the plan was shown is stopped unseen. Without a list (an older page), the plan is followed.
function unapprovedStops(steps, nodeId, keep, approved) {
  if (!approved) return [];
  return steps.filter(s => s.kind === 'stop' && !keep.includes(s.container) && !approved.includes(`${nodeId}/${s.container}`)).map(s => s.container);
}
// How long a one-Spark start waits for its model to answer (settable on the stand-in fleet only: ALL_LOCAL, as the
// press and door waits are; a stray variable on any other console moves nothing).
const START_READY_MS = Number(ALL_LOCAL && process.env.SPARK_CONSOLE_READY_MS) || 45 * 60000;
const planMoved = (extra, where) => new Error(`${extra.join(', ')} started using ${where}’s GPU after the plan was shown, so nothing was stopped or started. Ask for it again to see the new plan.`);
async function deploy(job, modelName, nodeId, viewer, keep = [], how = null, approved = null, fix = {}) {
  const p = await plan(modelName, nodeId, viewer, null, null, how);
  const extra = unapprovedStops(p.steps, nodeId, keep, approved);
  if (extra.length) throw planMoved(extra, nodeId);
  job.checkPause?.();
  const kept = p.steps.filter(s => s.kind === 'stop' && keep.includes(s.container));
  for (const s of kept) note(job, `Keeping ${s.container} running, as asked`);
  const node = nodeById(nodeId), cname = containerName(modelName);
  const model = withoutRejected(withHow((await inventory(null)).library.find(m => m.name === modelName), how), fix);
  for (const s of p.steps.filter(s => s.kind === 'stop' && !keep.includes(s.container))) await stopContainer(job, nodeId, s.container, viewer);
  // A running copy of this model that this start stopped is set aside under another name, not removed, so it can
  // start again if this doesn't (as a start across two Sparks does, 08-cluster.mjs). Before, a failed start left nothing
  // to put back (F9).
  if ((job.stoppedHere || []).includes(`${nodeId}/${cname}`) && !(job.asideHere || []).some(a => a.node === nodeId && a.name === cname)) {
    const aside = `${cname}-before-${job.id}`;
    const r = await run(node, `docker rename ${q(cname)} ${q(aside)}`, { timeout: 30000 });
    if (r.code) throw new Error(`Couldn’t set ${cname} on ${nodeId} aside to make room for the new start: ${(r.err || r.out).trim().slice(-300)}`);
    (job.asideHere ||= []).push({ node: nodeId, name: cname, aside });
  }
  try {
    await run(node, `docker rm -f ${q(cname)} >/dev/null 2>&1; true`);
    const copy = p.steps.find(s => s.kind === 'copy');
    job.checkPause?.();
    if (copy) {
      step(job, `Copying ${modelName} from ${copy.from} (first time on ${nodeId})`);
      await copyModel(job, modelName, nodeById(copy.from), node, copy.bytes, copy.store);
      job.progress = null;
    }
    const pull = p.steps.find(s => s.kind === 'pull');
    if (pull) {
      step(job, `Downloading the ${engineOf(model)} image`);
      const r = await run(node, `docker pull ${q(pull.image)}`, { timeout: 3600000, signal: job.abort?.signal, onLine: line => { job.detail = line.slice(0, 200); } });
      if (r.code) throw new Error(`Image download failed: ${r.err || r.out.slice(-500)}`);
    }
    job.checkPause?.();
    step(job, `Starting ${modelName} with ${ENGINES[engineOf(model)].title}`);
    const measured = await memNow(node);
    const share = [...memoryShare(model, [measured ? { node: nodeId, steps: [], memory: { ...p.memory, ...measured } } : { ...p, node: nodeId }], keep), ...fixFlags(model, fix)];
    if (share.length && share[0] === ENGINES[engineOf(model)].memFlag) note(job, `Letting it use ${Math.round(Number(share[1]) * 100)}% of ${nodeId}’s memory (what’s free)`);
    const started = await run(node, dockerRunCommand(model, p.tsip, p.store, share), { timeout: 120000 });
    // (one that timed out, or whose Spark stopped answering, may still have made the container: the put-back stops it too)
    if (!started.code || unanswered(started)) (job.ranHere ||= []).push(`${nodeId}/${cname}`);
    if (started.code) throw new Error(`Docker couldn’t start it: ${started.err || started.out}`);
    consoleStopped.delete(`${nodeId}/${cname}`);
    step(job, 'Loading the model; this can take a few minutes');
    const deadline = Date.now() + START_READY_MS;
    for (let i = 0; Date.now() < deadline; i++) {
      await sleep(5000);
      job.checkPause?.();
      const h = await run(node, `if curl -sf -m 4 http://127.0.0.1:${CONFIG.servePort}/v1/models >/dev/null; then echo up; else docker inspect -f '{{.State.Status}}' ${q(cname)} 2>/dev/null || echo missing; fi
docker logs --tail 1 ${q(cname)} 2>&1 | tail -1`, { timeout: 20000 });
      const [state, last] = h.out.split('\n');
      if (last) job.detail = last.slice(0, 200);
      if (state === 'up') {
        const checkAt = node.host === 'local' || ALL_LOCAL ? '127.0.0.1' : p.tsip;
        if (!checkAt) throw new Error(`It’s up, but ${nodeId}’s address is unknown, so it couldn’t be checked with a test prompt.`);
        await answers(job, checkAt, CONFIG.servePort);
        job.endpoint = p.endpoint;
        note(job, `Serving at ${p.endpoint || `port ${CONFIG.servePort}`}`);
        await recordVerified(job, { model, engine: engineOf(model), image: imageOf(model), args: [...(model.manifest?.args || []).map(String), ...share],
          env: model.manifest?.env || {}, nodes: [nodeId], host: node.host === 'local' || ALL_LOCAL ? '127.0.0.1' : p.tsip, port: CONFIG.servePort, viewer, how });
        // It runs: the copy it replaced goes, as it always did. (run never throws, so nothing here can put back a model
        // that works.)
        for (const a of job.asideHere || []) {
          const gone = await run(nodeById(a.node), `docker rm ${q(a.aside)} >/dev/null 2>&1`, { timeout: 30000 });
          if (gone.code) note(job, `Couldn’t remove ${a.aside} on ${a.node} (the earlier copy this start replaced); remove it there with docker rm ${a.aside}`);
        }
        job.asideHere = [];
        return;
      }
      if (['exited', 'dead', 'missing'].includes(state)) {
        const logs = await run(node, `docker logs --tail 400 ${q(cname)} 2>&1`, { timeout: 20000 });
        throw new Error(`The model server stopped while loading.\n${causeLines(logs.out)}${logs.out.trim().slice(-2500)}`);
      }
    }
    // (the put-back that follows stops it, and says so if it couldn't: A-23)
    throw new Error(`The model didn’t become ready within ${spanOf(START_READY_MS)}, so the start gave up on it. Its log (container_logs) may say why.`);
  } catch (e) {
    // It didn't start: the copy that was set aside gets its name back and starts again.
    await asideBack(job);
    throw e;
  }
}

// Stopping a container that's one part of a model running across Sparks stops every part: one part alone is useless,
// and a lone head can hang waiting for its partner.
async function stopContainer(job, nodeId, container, viewer = null) {
  const inv = await inventory(null);
  const dep = inv.sparks.find(sp => sp.id === nodeId)?.deployments.find(d => d.container === container);
  const parts = dep?.cluster
    ? inv.sparks.flatMap(sp => sp.deployments.filter(d => d.cluster === dep.cluster && d.model === dep.model).map(d => [sp.id, d.container]))
    : [[nodeId, container]];
  if (viewer) mustUse(viewer);
  for (const [id, name] of parts.sort((a, b) => b[0].localeCompare(a[0]))) {
    consoleStopped.set(`${id}/${name}`, Date.now());
    step(job, `Stopping ${name} on ${id}`);
    const r = await run(nodeById(id), `docker stop --time 30 ${q(name)}`, { timeout: 120000 });
    if (r.code && !/No such container/.test(r.err)) throw new Error(r.err || r.out || 'docker stop failed');
    // What this operation stopped, so a put-back starts exactly these again.
    if (!r.code) (job.stoppedHere ||= []).push(`${id}/${name}`);
  }
}

