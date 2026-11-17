/* ───────── a failed model start's unfinished put-back ───────── */
// Area: core        Rules: R1, R2, R7, R13, R15, R16, R18, R20, R21, R22
// Tests: t45-return.test.mjs, t45-adopt-job.test.mjs, t45-job-folder.test.mjs, t45-recovery-words.test.mjs, t45-owner-wish.test.mjs, t45-cleanup-adoption.test.mjs
// Owns: none
// Timers: none        Wakes: none
// The original start's authority, kept before it changes anything. A restart never replays its create commands.
// Target receipts and the attempt fence settle late commands before an original container can be started again.
const ROLLBACK_INSIDE = Symbol('finish an original start put-back');
const rollbackKey = x => `${x.spark}/${x.container}`;
const rollbackSame = (a, b) => !!a && !!b && a.id === b.id && a.startedAt === b.startedAt;
function rollbackShape(r) {
  const obj = x => x && typeof x === 'object' && !Array.isArray(x), token = x => typeof x === 'string' && /^[0-9a-f]{12}$/.test(x);
  const sparks = new Set(computeSparks()), node = x => typeof x === 'string' && sparks.has(x);
  const text = x => typeof x === 'string' && x.length > 0 && x.length <= 120;
  const identity = x => obj(x) && /^[0-9a-f]{12,64}$/.test(x.id || '') && text(x.startedAt);
  const seen = x => identity(x) && NAME_RE.test(x.name || '') && ['running', 'paused', 'restarting', 'created', 'exited', 'dead', 'removing'].includes(x.state)
    && obj(x.labels) && Object.entries(x.labels).length <= 100 && Object.entries(x.labels).every(([k,v]) => typeof k === 'string' && typeof v === 'string' && k.length < 200 && v.length < 1000);
  const result = x => obj(x) && typeof x.terminal === 'boolean' && text(x.boot)
    && ['notIssued', 'rebooted', 'changed', 'missing', 'guardFailed'].every(k => x[k] === undefined || typeof x[k] === 'boolean')
    && (x.code === undefined || Number.isInteger(x.code) && x.code >= -128 && x.code <= 255)
    && (x.failure === undefined || typeof x.failure === 'string' && x.failure.length <= 700 && (/^(?:port is already allocated|CUDA out of memory|the image could not be found|Docker refused the start|The model files could not be prepared)$/.test(x.failure) || /^([A-Za-z0-9_.-]{1,128}) in the Hugging Face cache copy of ([A-Za-z0-9_.-]{1,128}) links outside the model’s folder\.$/.test(x.failure) || /^unrecognized arguments: (?:--[a-zA-Z][a-zA-Z0-9_-]{0,63} ?){1,8}$/.test(x.failure) || /^docker: Error response from daemon: could not select device driver \"(?:nvidia)?\" with capabilities: \[\[gpu\]\]\.$/.test(x.failure)))
    && (x.guardPath === undefined || typeof x.guardPath === 'string' && /^\.local\/share\/spark-portal\/workspaces\/shared(?:\/jobs(?:\/[A-Za-z0-9][A-Za-z0-9_.-]{0,127})?)?$/.test(x.guardPath))
    && (x.seen === undefined || x.seen === null || seen(x.seen));
  const member = x => obj(x) && node(x.spark) && NAME_RE.test(x.container || '') && identity(x.original)
    && (x.stopReturn === undefined || typeof x.stopReturn === 'boolean')
    && (x.gpuBefore === undefined || Array.isArray(x.gpuBefore) && x.gpuBefore.length <= 200 && x.gpuBefore.every(row => Array.isArray(row) && row.length === 4 && row.every(v => typeof v === 'string' && v.length < 2048)))
    && typeof x.wasRunning === 'boolean' && Number.isSafeInteger(x.need) && x.need >= 0
    && NAME_RE.test(x.aside || '') && (x.listed === null || obj(x.listed) && node(x.listed.spark) && NAME_RE.test(x.listed.container || '') && text(x.listed.since))
    && ['waiting', 'restored', 'superseded'].includes(x.state);
  const key = x => typeof x === 'string' && x.split('/').length === 2 && node(x.split('/')[0]) && NAME_RE.test(x.split('/')[1]);
  return !!(obj(r) && r.kind === 'start-rollback' && token(r.operation) && text(r.since)
    && (r.chat === null || /^sc_[0-9a-f]{16}$/.test(r.chat || ''))
    && Array.isArray(r.targets) && r.targets.length > 0 && r.targets.length <= 8 && new Set(r.targets).size === r.targets.length && r.targets.every(node)
    && ['active', 'returning', 'committed'].includes(r.phase) && Array.isArray(r.units) && r.units.length <= 40
    && r.units.every(u => obj(u) && token(u.id) && Array.isArray(u.members) && u.members.length > 0 && u.members.length <= 2
      && u.members.every(m => member(m) && r.targets.includes(m.spark)))
    && (r.wishes === undefined || Array.isArray(r.wishes) && r.wishes.length <= 80 && r.wishes.every(key))
    && (r.stopWishes === undefined || Array.isArray(r.stopWishes) && r.stopWishes.length <= 80 && r.stopWishes.every(k => key(k) && r.targets.includes(k.split('/')[0])))
    && (r.blocked === undefined || Array.isArray(r.blocked) && r.blocked.every(x => r.targets.includes(x)))
    && Array.isArray(r.attempts) && r.attempts.length <= 40 && r.attempts.every(a => obj(a) && token(a.id) && obj(a.boots) && Array.isArray(a.commands)
      && a.commands.length <= 200 && a.commands.every(c => obj(c) && token(c.id) && r.targets.includes(c.spark)
        && ['run', 'start', 'stop', 'rename', 'remove'].includes(c.action) && NAME_RE.test(c.name || '')
        && (c.expected === null || identity(c.expected)) && (c.result === undefined || result(c.result)))));
}
function rollbackRecords() { return Object.values(savedRunsNow().runs).filter(r => r.kind === 'start-rollback'); }
function rollbackRead(id) { const r = savedRunsNow().runs[id]; return r?.kind === 'start-rollback' ? r : null; }
function rollbackSave(f) {
  writePrivate(SAVED_RUNS_FILE, f);
  const fd = openSync(STATE_DIR, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function rollbackWrite(r) {
  if (!rollbackShape(r)) throw new Error('The note of the unfinished put-back is invalid. Nothing else was changed.');
  const f = savedRunsNow();
  if (f.runs[r.operation] && f.runs[r.operation].kind !== 'start-rollback') throw new Error('The put-back operation already has another note.');
  f.runs[r.operation] = r;
  rollbackSave(f);
}
function rollbackForget(id) {
  const f = savedRunsNow();
  if (f.runs[id]?.kind !== 'start-rollback') return;
  delete f.runs[id];
  // An empty durable map revokes authority even when an old .prev or unlink failure survives.
  rollbackSave(f);
}
function rollbackHeld(ids) {
  try { return rollbackRecords().some(r => r.phase !== 'committed' && r.targets.some(id => ids.includes(id))); }
  catch { return true; }
}
function rollbackSupersede(keys, reason = 'the owner changed what should run', onlyIf = null, stopReturn = true, afterStart = null) {
  // Strict even when no desired row or running container remains. No swallowed desiredWish save authorizes revival.
  const f = savedRunsNow(); let changed = false;
  for (const r of Object.values(f.runs).filter(x => x.kind === 'start-rollback')) {
    const linked = backUnits([...new Set(r.attempts.flatMap(a => a.commands.filter(c => c.action === 'run').map(c => `${c.spark}/${c.name}`)))]).filter(u => u.items.some(k => keys.includes(k))).flatMap(u => u.items);
    const wishKeys = [...new Set([...keys, ...linked])].filter(k => r.targets.includes(k.split('/')[0]));
    if (!onlyIf && !stopReturn && r.phase === 'returning') {
      const commands = r.attempts.flatMap(a => a.commands).filter(c => wishKeys.includes(`${c.spark}/${c.name}`) && ['run', 'start', 'stop', 'remove'].includes(c.action));
      if (commands.some(c => ['stop', 'remove'].includes(c.action) && !c.result?.terminal))
        throw new Error('The earlier stop or removal is still finishing. Wait for it to end, then ask again.');
      for (const key of wishKeys) {
        const last = [...commands].reverse().find(c => `${c.spark}/${c.name}` === key && !c.result?.notIssued);
        if (!last || !['stop', 'remove'].includes(last.action)) continue;
        const seen = last.result?.seen, started = afterStart?.[key];
        const running = last.result?.terminal && seen?.id === last.expected?.id && ['running', 'paused', 'restarting'].includes(seen?.state);
        const newlyStarted = /^[0-9a-f]{64}$/.test(started?.id || '') && typeof started?.startedAt === 'string' && started.startedAt.length > 0;
        if (!running && !newlyStarted) throw new Error('The earlier cleanup has stopped that container. Wait for it to finish, then ask to start it again.');
      }
    }
    if (!onlyIf && wishKeys.length) {
      r.wishes = stopReturn ? (r.wishes || []).filter(k => !wishKeys.includes(k)) : [...new Set([...(r.wishes || []), ...wishKeys])];
      r.stopWishes = stopReturn ? [...new Set([...(r.stopWishes || []), ...wishKeys])] : (r.stopWishes || []).filter(k => !wishKeys.includes(k));
      changed = true;
    }
    for (const u of r.units) if (u.members.some(m => keys.includes(rollbackKey(m)) && (!onlyIf || onlyIf.id === m.original.id))) {
      for (const m of u.members) { m.state = 'superseded'; m.why = reason; m.stopReturn = stopReturn; }
      changed = true;
    }
  }
  if (changed) rollbackSave(f);
}
function rollbackBeforeRerun(keys) {
  // Under the new start's claim, before Docker: an older command can still finish on this Spark.
  const sparks = [...new Set(keys.map(key => key.split('/')[0]))];
  if (rollbackRecords().some(r => r.phase !== 'committed' && r.targets.some(spark => sparks.includes(spark))
    && r.attempts.some(a => a.commands.some(c => sparks.includes(c.spark) && !c.result?.terminal))))
    throw new Error('An earlier command is still finishing on this Spark. Wait for its put-back check, then ask again.');
}
function rollbackAdoptStart(job) {
  if (job.cancelled) throw new Error('That start is being stopped. Wait for it to finish before asking to start it again.');
  const r = job.rollbackOperation ? rollbackRead(job.rollbackOperation) : null;
  if (r?.phase === 'returning') throw new Error('That start failed and is putting earlier work back. Wait for it to finish, then ask again.');
  const keys = [...new Set([...(job.ranHere || []), ...(r?.attempts || []).flatMap(a => a.commands.filter(c => c.action === 'run' && c.name !== ENGINE_CHECK_NAME).map(c => `${c.spark}/${c.name}`))])].filter(key => key.split('/')[1] !== ENGINE_CHECK_NAME);
  if (keys.length) desiredWish(keys); // exact current source intents are durable before the owner gets an answer
  savedRunReceipts({ ...job, ownersWish: true }, true);
  // Before the first create, a crash has nothing to stop. Its first command transfers this flag into the same
  // durable write-ahead intent before any target can create a container.
  job.ownersWish = true;
}
async function rollbackRetireSuperseded(claimedIds) {
  // An owner can adopt a job that a failed start could not put back. Retire only that settled positive debt,
  // under every target's existing claim. No start, stop or delete is issued here; uncertain work stays held.
  const eligible = r => r?.phase === 'returning' && r.targets.every(id => claimedIds.includes(id))
    && r.units.length > 0 && r.units.every(u => u.members.every(m => m.state === 'superseded' && m.stopReturn === false))
    && jobs.get(r.operation)?.status !== 'running';
  for (const record of rollbackRecords().filter(eligible)) {
    let settled = true;
    try {
      for (const spark of record.targets) {
        if (!(await rollbackFence(rollbackRead(record.operation), spark))) { settled = false; break; }
        const owned = await rollbackOwned(rollbackRead(record.operation), spark);
        if (owned.some(x => x.name === ENGINE_CHECK_NAME || !STOPPED_STATES.includes(x.state))) { settled = false; break; }
      }
      // The owner's stop or another wish may have arrived during a target look. Never erase that newer debt.
      if (settled && eligible(rollbackRead(record.operation))) rollbackForget(record.operation);
    } catch { /* A missing receipt or failed strict save keeps the existing obligation. */ }
  }
}
async function rollbackPrepare(job, targets, stops, inv) {
  if (job.rollbackOperation) return;
  const keys = new Set(stops), stoppedPairs = new Set(), all = inv.sparks.flatMap(sp => sp.deployments.map(d => ({ ...d, spark: sp.id })));
  for (const key of [...keys]) {
    const d = all.find(x => `${x.spark}/${x.container}` === key);
    if (d?.cluster) {
      const head = d.container.replace(/-part2$/, '');
      const pair = d.cluster.split('+').map((spark, rank) => `${spark}/${head}${rank ? '-part2' : ''}`);
      // A wholly stopped historical pair has no running mate to put back. Preserve only the local copy this
      // start replaces; claiming its former peer could otherwise pull the hub into a compute-only start.
      if (pair.every(k => { const old = all.find(x => `${x.spark}/${x.container}` === k); return old && STOPPED_STATES.includes(old.state); })) {
        stoppedPairs.add(key);
        continue;
      }
      for (const key of pair) keys.add(key);
    }
  }
  const ids = [...new Set([...targets, ...[...keys].map(k => k.split('/')[0])])].sort();
  notBrainsSpark(ids);
  const extra = ids.filter(id => !targets.includes(id));
  const releaseExtra = extra.length ? claimSparks(extra, 'putting back the complete earlier model if this start fails') : null;
  try {
    if (rollbackRecords().some(r => r.operation !== job.id && r.phase !== 'committed' && r.targets.some(id => ids.includes(id)))) throw new Error('Earlier work still needs putting back on these Sparks. Wait for that check before another start.');
    const before = desired(true), originals = [], gpuByNode = new Map();
    for (const spark of ids) {
      const g = await run(nodeById(spark), gpuUsersScript(''), { timeout: 30000 });
      if (g.code) throw new Error('The earlier GPU use couldn’t be recorded. Nothing was stopped.');
      gpuByNode.set(spark, fields(g.out, 'gpu'));
    }
    for (const key of keys) {
      const [spark, container] = key.split('/'), seen = await rollbackLook(spark, container);
      if (!seen?.id || !seen.startedAt) throw new Error(`The earlier ${container} on ${spark} couldn’t be recorded. Nothing was stopped.`);
      if (stoppedPairs.has(key) && !STOPPED_STATES.includes(seen.state)) throw new Error(`The earlier pair on ${spark} changed after its plan. Nothing was stopped; ask again.`);
      const deployment = all.find(x => x.spark === spark && x.container === container), model = inv.library.find(x => x.name === deployment?.model);
      const listed = before.running.find(x => keyOf(x) === key || x.sparks?.includes(spark) && (x.container === container || `${x.container}-part2` === container)) || null;
      const measured = (gpuByNode.get(spark) || []).filter(([, , , name]) => name === container).reduce((n, [, mb]) => n + Number(mb) * 2 ** 20, 0);
      const estimate = Math.ceil(model?.manifest?.memoryGiB ? model.manifest.memoryGiB * 2 ** 30 : model?.sizeBytes ? model.sizeBytes * 1.15 : listed?.memoryGB ? listed.memoryGB * 2 ** 30 : seen.memory || 0);
      const need = Math.max(estimate, Number.isFinite(measured) ? measured : 0);
      if (seen.state === 'running' && !need) throw new Error(`The memory used by ${container} couldn’t be recorded. Nothing was stopped.`);
      originals.push({ spark, container, gpuBefore: gpuByNode.get(spark) || [], wasRunning: seen.state === 'running', need, original: { id: seen.id, startedAt: seen.startedAt }, aside: `${container}-before-${job.id}`,
        listed, state: 'waiting' });
    }
    const units = backUnits(originals.map(rollbackKey)).map(u => ({ id: randomBytes(6).toString('hex'), members: u.items.map(k => originals.find(x => rollbackKey(x) === k)) }));
    const record = { kind: 'start-rollback', operation: job.id, since: job.createdAt, chat: job.conv || null, phase: 'active', targets: ids, units, attempts: [] };
    rollbackWrite(record);
    job.rollbackOperation = job.id;
    job.rollbackTargets = targets;
    job.claimedNodes = ids;
    const release = job.release;
    job.release = () => { releaseExtra?.(); release?.(); };
  } catch (e) { releaseExtra?.(); throw e; }
}
async function rollbackAttempt(job) {
  const r = rollbackRead(job.rollbackOperation); if (!r) throw new Error('The original start’s put-back note is missing.');
  if (job.rollbackAttempt) return r.attempts.find(a => a.id === job.rollbackAttempt);
  if (r.attempts.length >= 40) throw new Error('Automatic put-back has reached its safe limit. The owner needs to check what is running before starting earlier work again.');
  const a = { id: randomBytes(6).toString('hex'), boots: {}, commands: [] };
  r.attempts.push(a); rollbackWrite(r); job.rollbackAttempt = a.id;
  return a;
}
async function rollbackOriginal(job, spark, name) {
  const r = rollbackRead(job.rollbackOperation);
  return r?.units.flatMap(u => u.members).find(m => m.spark === spark && m.container === name) || null;
}
async function rollbackStopOriginal(job, spark, name) {
  const original = await rollbackOriginal(job, spark, name);
  if (!original) throw new Error(`The earlier ${name} on ${spark} wasn’t recorded. Nothing was stopped.`);
  await rollbackCommand(job, spark, 'stop', name, original.original);
  if (!(job.stoppedHere ||= []).includes(`${spark}/${name}`)) job.stoppedHere.push(`${spark}/${name}`);
}
async function rollbackAside(job, spark, name) {
  const original = await rollbackOriginal(job, spark, name);
  if (!original) return;
  await rollbackCommand(job, spark, 'rename', name, original.original, { to: original.aside });
  const now = rollbackRead(job.rollbackOperation); now.units.flatMap(u => u.members).find(m => m.spark === spark && m.container === name).asideUsed = true; rollbackWrite(now);
  if (!(job.asideHere ||= []).some(a => a.node === spark && a.name === name)) job.asideHere.push({ node: spark, name, aside: original.aside });
}
async function rollbackRemove(job, spark, name) {
  const seen = await rollbackLook(spark, name); if (!seen) return;
  // A stopped pre-existing container may be removed only if it was recorded and set aside. Unrelated work stays.
  const r = rollbackRead(job.rollbackOperation);
  const ours = seen.labels?.['spark.operation'] === r.operation && r.attempts.some(a => a.id === seen.labels?.['spark.attempt']
    && a.commands.some(c => c.id === seen.labels?.['spark.command'] && c.action === 'run'));
  if (!ours || !STOPPED_STATES.includes(seen.state)) throw new Error(`${name} on ${spark} is still there. It was left alone.`);
  if (r.phase === 'returning' && (r.wishes || []).includes(`${spark}/${name}`)) return false;
  try {
    await rollbackCommand(job, spark, 'remove', name, { id: seen.id, startedAt: seen.startedAt }, () => {
      const fresh = rollbackRead(r.operation);
      if (fresh.phase === 'returning' && (fresh.wishes || []).includes(`${spark}/${name}`))
        throw Object.assign(new Error('The owner’s newer work was left alone.'), { rollbackNoStop: true });
      return {};
    });
  } catch (e) { if (e.rollbackNoStop) return false; throw e; }
}
async function rollbackOwned(record, spark) {
  // Enumerate after EVERY source attempt is fenced. A reboot ends old clients, not the containers they created.
  const out = await run(nodeById(spark), `docker ps -a --filter ${q(`label=spark.operation=${record.operation}`)} --format '{{.ID}}'`, { timeout: 20000 });
  if (out.code) throw new Error(`Docker on ${spark} couldn’t list what this start left running.`);
  const ids = out.out.split(/\s+/).filter(Boolean);
  if (!ids.every(x => /^[0-9a-f]{12,64}$/.test(x))) throw new Error(`Docker on ${spark} returned an incomplete list.`);
  const owned = [];
  for (const id of ids) {
    const x = await rollbackLook(spark, id); if (!x) continue;
    const fresh = rollbackRead(record.operation);
    if (!fresh) throw new Error('The failed start’s recovery note changed during its look.');
    const a = fresh.attempts.find(a => a.id === x.labels?.['spark.attempt']);
    const c = a?.commands.find(c => c.id === x.labels?.['spark.command'] && c.action === 'run' && c.spark === spark);
    if (x.labels?.['spark.operation'] !== fresh.operation || !c || x.name !== c.name) throw new Error(`The identity of this start’s container on ${spark} couldn’t be proved.`);
    // The owner can adopt while either Docker look is awaited. A stale inventory grants no stop authority.
    if ((fresh.wishes || []).includes(`${spark}/${x.name}`)) continue;
    const known = c.result?.seen;
    if (known && !rollbackSame(known, x)) throw new Error(`${x.name} on ${spark} was started again since this attempt. It was left alone.`);
    owned.push(x);
  }
  return owned;
}
function rollbackDesiredChanged(member, list, record) {
  const saved = member.listed, now = list.find(x => keyOf(x) === (saved ? keyOf(saved) : rollbackKey(member)));
  if (saved ? !now || now.since !== saved.since : now) return true;
  const mine = saved?.since || record.since;
  return list.some(x => (x.sparks || [x.spark]).includes(member.spark) && keyOf(x) !== (saved ? keyOf(saved) : rollbackKey(member)) && String(x.since || '') > String(mine));
}
async function rollbackTransfer(record, member, seen) {
  // A saved workflow's earlier step owns this original too. Move its exact receipt before releasing the claim.
  // The strict update may fail AFTER Docker starts it: the obligation stays and retries only this write next pass.
  const f = savedRunsNow(); let changed = false;
  for (const r of Object.values(f.runs).filter(r => r.kind !== 'start-rollback')) for (const field of ['started', 'pending', 'awaiting']) {
    for (const x of r[field] || []) if (x.spark === member.spark && x.container === member.container && x.seen?.id === member.original.id) {
      x.seen = x.kind === 'job' ? { id: seen.id, startedAt: seen.startedAt } : { id: seen.id, since: member.listed?.since || null };
      changed = true;
    }
  }
  if (changed) rollbackSave(f);
  for (const items of runsRan.values()) for (const x of items) if (x.spark === member.spark && x.container === member.container && x.seen?.id === member.original.id)
    x.seen = x.kind === 'job' ? { id: seen.id, startedAt: seen.startedAt } : { id: seen.id, since: member.listed?.since || null };
}
function rollbackResult(job, record) {
  const waiting = record.units.filter(u => u.members.some(m => m.state === 'waiting'));
  const blocked = new Set(record.blocked || []);
  const commands = record.attempts.flatMap(a => a.commands);
  // A successful exact-ID remove proves that created container cannot still run. Other uncertainty on this Spark
  // remains held; reporting a removed engine check as live would tell the owner to stop something already gone.
  const removed = c => c.result?.seen?.id && commands.some(x => x.spark === c.spark && x.name === c.name && x.action === 'remove'
    && x.expected?.id === c.result.seen.id && x.result?.terminal === true && x.result.code === 0 && x.result.seen === null);
  const still = [...new Set(commands.filter(c => c.action === 'run' && blocked.has(c.spark) && !removed(c)).map(c => `${c.spark}/${c.name}`))];
  const held = waiting.flatMap(u => u.members.filter(m => m.wasRunning)).sort((a, b) => Number(!!a.asideUsed) - Number(!!b.asideUsed)).map(rollbackKey);
  const asides = waiting.flatMap(u => u.members.filter(m => m.asideUsed).map(m => ({ node: m.spark, name: m.container, aside: m.aside })));
  const pairs = backUnits(held).filter(u => u.model);
  job.ranHere = still;
  job.stoppedHere = held;
  job.asideHere = asides;
  const runningAsides = asides.filter(a => waiting.some(u => u.members.some(m => m.spark === a.node && m.container === a.name && m.wasRunning)));
  const owed = still.length ? owedWords(still, held, runningAsides, pairs) : [], notBack = [];
  // Name a refused restoration only with its latest exact-ID terminal receipt and a stopped post-check.
  // An unanswered command, changed identity or unresolved target keeps the general uncertainty warning instead.
  for (const u of waiting) {
    if (u.members.some(m => blocked.has(m.spark))) continue;
    const failed = u.members.find(m => {
      const c = commands.filter(c => c.action === 'start' && c.spark === m.spark && c.name === m.container && c.expected?.id === m.original.id).at(-1);
      return c?.result?.terminal === true && c.result.code > 0 && !c.result.changed && !c.result.guardFailed
        && c.result.seen?.id === m.original.id && ['created', 'exited', 'dead'].includes(c.result.seen.state);
    });
    if (!failed) continue;
    const pair = backUnits(u.members.map(rollbackKey)).find(x => x.model);
    const words = pair ? `${pair.model} couldn’t be started again across ${pair.sparks.map(id => sparkName(nodeById(id) || { id })).join(' + ')}; start ${pair.model} across both again`
      : `${failed.container} couldn’t be started again on ${sparkName(nodeById(failed.spark) || { id: failed.spark })}; start it from Spark Console`;
    owed.push(words);
    notBack.push({ items: u.members.filter(m => m.wasRunning).map(rollbackKey), words });
  }
  if (notBack.length) job.notBack = notBack; else delete job.notBack;
  const followUp = 'Earlier work still needs putting back. Spark Console will check again when its Spark answers. A Spark that stays silent may need a power cycle.';
  if (waiting.length || record.blocked?.length) job.cleanUp = owed.length ? owed.map(x => `${x}.`).join('\n') : followUp;
  else delete job.cleanUp;
  for (const line of owed) note(job, line);
  if (job.cleanUp) note(job, followUp);
}
async function rollbackReturn(job) {
  let record = rollbackRead(job.rollbackOperation || job.rollbackSource);
  if (!record || record.phase === 'committed') return;
  note(job, 'Checking and putting back earlier work');
  record.phase = 'returning'; rollbackWrite(record);
  const clear = new Set(), blocked = [];
  for (const spark of record.targets) {
    try { if (await rollbackReconcile(job, spark)) clear.add(spark); else blocked.push(spark); }
    catch { blocked.push(spark); }
  }
  // Fresh attempt: every preceding attempt is now fenced wherever it is safe to continue. A failed command is never
  // reissued from a previous attempt; its outcome is settled, then a distinct recorded compensation can proceed.
  delete job.rollbackAttempt;
  job.rollbackOperation = record.operation;
  for (const spark of clear) {
    try {
      await rollbackStopCancelled(job, rollbackRead(record.operation), spark);
      const survivors = await rollbackOwned(rollbackRead(record.operation), spark);
      for (const x of survivors) {
        const adopted = () => (rollbackRead(record.operation).wishes || []).includes(`${spark}/${x.name}`);
        if (adopted()) continue;
        try {
          if (!STOPPED_STATES.includes(x.state)) await rollbackCommand(job, spark, 'stop', x.name, { id: x.id, startedAt: x.startedAt }, () => {
            if (adopted()) throw Object.assign(new Error('The owner’s newer work was left alone.'), { rollbackNoStop: true });
            return {};
          });
        } catch (e) { if (e.rollbackNoStop) continue; throw e; }
        const looked = await rollbackLook(spark, x.id);
        if (adopted()) continue;
        if (looked && !STOPPED_STATES.includes(looked.state)) throw new Error('Its new container did not stop.');
        const provedStop = rollbackRead(record.operation).attempts.some(a => a.commands.some(c => c.spark === spark && c.action === 'stop' && c.expected?.id === x.id
          && c.result?.terminal === true && c.result.code === 0 && rollbackSame(c.result.seen, looked) && STOPPED_STATES.includes(c.result.seen.state)));
        if (looked && rollbackSame(x, looked) && provedStop) selfTestRollbackStopped(spark, x);
        if (looked && x.name === ENGINE_CHECK_NAME) await rollbackRemove(job, spark, x.name);
      }
    } catch {
      // The cleanup stop itself may have outlived its observer. Settle only its proven disposable target before
      // restoring any original; all other uncertainty keeps this Spark blocked.
      let settled = false;
      try {
        const fresh = rollbackRead(record.operation);
        const uncertainStop = fresh.attempts.some(a => a.commands.some(c => c.spark === spark && c.action === 'stop' && !c.result?.terminal && !rollbackStopDisposed(fresh, spark, c)));
        if (uncertainStop && await rollbackReconcile(job, spark)) {
          const remaining = await rollbackOwned(rollbackRead(record.operation), spark);
          settled = remaining.every(x => STOPPED_STATES.includes(x.state) && x.name !== ENGINE_CHECK_NAME);
        }
      } catch {}
      if (!settled) { clear.delete(spark); blocked.push(spark); }
    }
  }
  record = rollbackRead(record.operation);
  for (const unit of record.units) {
    if (!unit.members.some(m => m.state === 'waiting') || unit.members.some(m => !clear.has(m.spark))) continue;
    let current = rollbackRead(record.operation), u = current.units.find(x => x.id === unit.id);
    const d = desired(true);
    if (u.members.some(m => m.state === 'superseded' || rollbackDesiredChanged(m, d.running, current))) {
      for (const m of u.members) { m.state = 'superseded'; m.why = 'a newer wish replaced the earlier one'; }
      rollbackWrite(current); continue;
    }
    const back = [];
    try {
      const settings = agentSettings();
      if (settings.halted && !settings.autoPaused) throw new Error('Put-back waits while agents are paused.');
      // Check EVERY member before starting the first half of an old pair.
      for (const m of u.members) {
        const original = await rollbackLook(m.spark, m.original.id), named = await rollbackLook(m.spark, m.container);
        const ownReturn = current.attempts.flatMap(a => a.commands).filter(c => c.action === 'start' && c.expected?.id === m.original.id).map(c => c.result?.seen).find(x => rollbackSame(x, original));
        if (!original || (!rollbackSame(original, m.original) && !ownReturn)) throw Object.assign(new Error('The earlier container was replaced or started again.'), { superseded: true });
        if (named && named.id !== original.id) {
          await rollbackRemove(job, m.spark, m.container);
        }
        if (![m.container, m.aside].includes(original.name)) throw Object.assign(new Error('The earlier container was renamed by someone else.'), { superseded: true });
        back.push({ m, seen: original });
      }
      await rollbackRoom(back);
      const restored = [];
      try {
        for (const { m, seen } of back) {
          if (seen.name === m.aside) await rollbackCommand(job, m.spark, 'rename', m.container, { id: seen.id, startedAt: seen.startedAt }, { to: m.container });
          if (m.wasRunning && seen.state !== 'running') {
            // The target checks the job's named folder inside its supervised start, then starts the exact old ID.
            await rollbackCommand(job, m.spark, 'start', m.container, { id: seen.id, startedAt: seen.startedAt }, { guard: jobMountsReal(m.container) });
          }
          const now = await rollbackLook(m.spark, m.original.id);
          if (!now || (m.wasRunning ? now.state !== 'running' : !STOPPED_STATES.includes(now.state))) throw new Error('The earlier container did not return to its original state.');
          restored.push({ m, seen: now });
          const intent = rollbackRead(record.operation).units.find(x => x.id === unit.id).members.find(x => rollbackKey(x) === rollbackKey(m));
          if (intent.state === 'superseded' && intent.stopReturn && now.state === 'running') {
            await rollbackStopCancelled(job, rollbackRead(record.operation), m.spark);
            const latest = rollbackRead(record.operation).units.find(x => x.id === unit.id).members.find(x => rollbackKey(x) === rollbackKey(m));
            if (latest.state === 'superseded' && latest.stopReturn) throw new Error('The owner’s newer stop was kept.');
          }
        }
      } catch (e) {
        if (u.members.length > 1) for (const x of restored) {
          const adopted = () => {
            const fresh = rollbackRead(record.operation), member = fresh.units.find(y => y.id === unit.id)?.members.find(m => rollbackKey(m) === rollbackKey(x.m));
            return (fresh.wishes || []).includes(rollbackKey(x.m)) || member?.state === 'superseded' && member.stopReturn === false;
          };
          if (adopted()) continue;
          try {
            await rollbackCommand(job, x.m.spark, 'stop', x.m.container, { id: x.seen.id, startedAt: x.seen.startedAt }, () => {
              if (adopted()) throw Object.assign(new Error('The owner’s newer work was left alone.'), { rollbackNoStop: true });
              return {};
            });
          } catch (e) { if (e.rollbackNoStop) continue; throw e; }
          const checked = await rollbackLook(x.m.spark, x.seen.id);
          if (!adopted() && checked && !STOPPED_STATES.includes(checked.state)) blocked.push(x.m.spark);
        }
        throw e;
      }
      for (const x of restored) {
        await rollbackTransfer(current, x.m, x.seen);
        current = rollbackRead(record.operation);
        const member = current.units.find(x => x.id === unit.id).members.find(m => rollbackKey(m) === rollbackKey(x.m));
        if (member.state === 'waiting') member.state = 'restored';
        rollbackWrite(current);
        consoleStopped.delete(rollbackKey(x.m));
        note(job, x.m.wasRunning ? `Started ${x.m.container} on ${x.m.spark} again` : `Put ${x.m.container} on ${x.m.spark} back, still stopped`);
      }
    } catch (e) {
      current = rollbackRead(record.operation);
      if (e.superseded) for (const m of current.units.find(x => x.id === unit.id).members) { m.state = 'superseded'; m.why = 'the earlier container changed'; }
      else note(job, `Earlier work on ${u.members.map(m => m.spark).join(' and ')} couldn’t be put back yet. ${String(e.message).split('\n')[0]}`);
      rollbackWrite(current);
    }
  }
  record = rollbackRead(record.operation);
  // Fresh compensation commands can also outlive their observer. Superseded originals do not erase those debts.
  for (const spark of record.targets) {
    try { if (!(await rollbackFence(rollbackRead(record.operation), spark))) blocked.push(spark); }
    catch { blocked.push(spark); }
  }
  // A final receipt may have arrived only in the fence above. Honor a stop/forget that arrived while that
  // original start was unanswered, before retiring even an entirely superseded set of originals.
  delete job.rollbackAttempt;
  for (const spark of record.targets.filter(id => !blocked.includes(id))) {
    try { await rollbackStopCancelled(job, rollbackRead(record.operation), spark); }
    catch { blocked.push(spark); }
  }
  for (const spark of record.targets.filter(id => !blocked.includes(id))) {
    try { if (!(await rollbackFence(rollbackRead(record.operation), spark))) blocked.push(spark); }
    catch { blocked.push(spark); }
  }
  record = rollbackRead(record.operation); record.blocked = [...new Set(blocked)]; rollbackWrite(record);
  rollbackResult(job, record);
  // Even a record with no originals retains the obligation to stop all late failed-attempt containers.
  if (!record.blocked.length && record.units.every(u => u.members.every(m => m.state !== 'waiting'))) rollbackForget(record.operation);
}
async function rollbackCommit(job) {
  if (!job.rollbackOperation) return;
  let r = rollbackRead(job.rollbackOperation); if (!r) return;
  const createdOf = record => new Map(record.attempts.flatMap(a => a.commands).filter(c => c.action === 'run' && c.name !== ENGINE_CHECK_NAME && !/-part2$/.test(c.name)).map(c => [`${c.spark}/${c.name}`, c]));
  const stoppedNow = record => {
    const keys = [...new Set([...createdOf(record).keys(), ...(job.ranHere || []).filter(key => !/-part2$/.test(key) && key.split('/')[1] !== ENGINE_CHECK_NAME)])];
    return job.cancelled || keys.some(key => (record.stopWishes || []).includes(key))
      || record.units.flatMap(u => u.members).some(m => keys.includes(rollbackKey(m)) && m.state === 'superseded' && m.stopReturn === true);
  };
  const stopped = () => { job.ownersWish = false; throw Object.assign(new Error('The owner stopped it while its start was ending. Its newer wish was kept.'), { cancelled: true }); };
  if (stoppedNow(r)) stopped();
  const wishedBefore = [...createdOf(r).keys()].filter(key => (r.wishes || []).includes(key));
  if (job.ownersWish || wishedBefore.length) {
    const captured = await captureStartedReceipts(job, false); // read only; publish no unproved receipt
    r = rollbackRead(job.rollbackOperation);
    if (!r) throw new Error('The owner’s wish could not be handed over because its recovery note changed.');
    const created = createdOf(r), keys = [...new Set((job.ranHere || []).filter(key => !/-part2$/.test(key)))];
    const revoked = wishedBefore.some(key => !(r.wishes || []).includes(key));
    if (revoked || stoppedNow(r)) stopped();
    for (const key of keys) {
      if (!rollbackSame(created.get(key)?.result?.seen, captured?.[key])) throw new Error('The owner’s wish could not be matched to this start’s exact container.');
    }
    if (!Object.keys(captured || {}).length) throw new Error('The owner’s wish has no exact start receipt yet.');
    job.ownersWish = true; job.startedReceipts = captured;
    savedRunReceipts(job, true); // a failed write leaves the source note, including its newer wish, intact
  }
  r.phase = 'committed'; rollbackWrite(r);
  rollbackForget(r.operation);
}
async function rollbackBeforeRetry(job) {
  if (!job.rollbackOperation) return;
  const r = rollbackRead(job.rollbackOperation);
  for (const spark of r.targets) if (!(await rollbackFence(rollbackRead(r.operation), spark))) throw new Error('The previous attempt hasn’t ended on every Spark. It wasn’t retried. A Spark may need a power cycle.');
  delete job.rollbackAttempt;
  for (const spark of r.targets) for (const x of await rollbackOwned(rollbackRead(r.operation), spark)) {
    if (!STOPPED_STATES.includes(x.state)) await rollbackCommand(job, spark, 'stop', x.name, { id: x.id, startedAt: x.startedAt });
    const seen = await rollbackLook(spark, x.id);
    if (seen && !STOPPED_STATES.includes(seen.state)) throw new Error('The previous attempt is still running. It wasn’t retried.');
  }
}
let rollbackPassing = false;
async function rollbackPass() {
  if (rollbackPassing) return;
  rollbackPassing = true;
  try {
    for (const r of rollbackRecords()) {
      if (r.phase === 'committed') { rollbackForget(r.operation); continue; }
      if (jobs.get(r.operation)?.status === 'running') continue;
      const ids = [...new Set(r.targets)].sort();
      if (ids.some(id => busySparks.has(id) || consoleOff(id))) continue;
      const first = r.units.flatMap(u => u.members)[0];
      // Existing action door, tested workflow and journal. Only this module holds the private continuation token.
      await runAction('restart_model', healOwner(), { spark: first?.spark || ids[0], container: first?.container || 'unfinished-start', __validate: 'restart_model' },
        { via: 'watcher', actor: 'Put-back', canChange: true, trusted: true, ownerWord: true, rollback: ROLLBACK_INSIDE, rollbackSource: r.operation });
    }
  } catch (e) { console.error(`Finishing a failed start’s put-back: ${savedRunWords(e)}`); }
  finally { rollbackPassing = false; }
}
function rollbackContinue(input, viewer, ctx) {
  if (ctx.rollback !== ROLLBACK_INSIDE) return null;
  const r = rollbackRead(ctx.rollbackSource);
  if (!r || r.phase === 'committed') return { outcome: 'already' };
  const ids = [...new Set(r.targets)].sort(); notBrainsSpark(ids);
  const job = claimed(ids, 'putting back earlier work', () => newJob('start-rollback', { node: ids[0], nodes: ids, rollbackSource: r.operation, by: viewer.login, via: 'watcher' }));
  runJob(job, async j => { await rollbackReturn(j); if (j.cleanUp) throw new Error(j.cleanUp); });
  return { outcome: 'started', operation: job.id };
}
function rollbackNeeds(add) {
  try {
    for (const r of rollbackRecords().filter(x => x.phase !== 'committed')) add(`put-back:${r.operation}`,
      r.attempts.length >= 40 ? 'Automatic put-back reached its safe limit. Check the earlier work on its Sparks before starting it again.' : 'Earlier work still needs putting back after a failed start. Spark Console will check again when its Sparks answer. A Spark that stays silent may need a power cycle.');
  } catch { add('put-back-note', 'The note of unfinished put-backs couldn’t be read. Fix saved-runs.json before asking Spark Console to change models.'); }
}
function rollbackKnown(spark, container) {
  return rollbackRecords().some(r => r.units.some(u => u.members.some(m => m.spark === spark && m.container === container))
    || r.attempts.some(a => a.commands.some(c => c.spark === spark && c.name === container)));
}
async function rollbackStopCancelled(job, record, spark) {
  for (const m of record.units.flatMap(u => u.members).filter(m => m.spark === spark && m.state === 'superseded' && m.stopReturn)) {
    const starts = record.attempts.flatMap(a => a.commands).filter(c => c.spark === spark && c.action === 'start' && c.expected?.id === m.original.id);
    if (!starts.length) continue;
    const last = starts[starts.length - 1];
    if (!last.result?.terminal) throw new Error('The earlier start has not finished.');
    if (last.result.notIssued || last.result.changed || last.result.missing) continue;
    const stillStopped = () => {
      const fresh = rollbackRead(record.operation), member = fresh.units.flatMap(u => u.members).find(x => x.spark === spark && x.container === m.container && x.original.id === m.original.id);
      return member?.state === 'superseded' && member.stopReturn === true && !(fresh.wishes || []).includes(`${spark}/${m.container}`);
    };
    const now = await rollbackLook(spark, m.original.id);
    if (!stillStopped() || !now || STOPPED_STATES.includes(now.state)) continue;
    if (!rollbackSame(now, last.result.seen)) throw new Error('The earlier start ended without its exact running identity. It was left alone.');
    try {
      await rollbackCommand(job, spark, 'stop', m.container, { id: now.id, startedAt: now.startedAt }, () => {
        if (!stillStopped()) throw Object.assign(new Error('The owner’s newer work was left alone.'), { rollbackNoStop: true });
        return {};
      });
    } catch (e) { if (e.rollbackNoStop) continue; throw e; }
    const checked = await rollbackLook(spark, now.id);
    if (stillStopped() && checked && !STOPPED_STATES.includes(checked.state)) throw new Error('The earlier start has not stopped.');
  }
}
