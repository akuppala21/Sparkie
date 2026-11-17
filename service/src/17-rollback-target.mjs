/* ───────── a failed start’s target command receipts and persistent fence ───────── */
// Area: core        Rules: R1, R7, R13, R15, R16, R20, R21, R22
// Tests: t45-return.test.mjs, t45-target.test.mjs, t45-fleet.test.mjs, t45-job-folder.test.mjs, t45-created-receipt.test.mjs, t45-late-outcome.test.mjs, t45-owner-wish.test.mjs, t45-cleanup-adoption.test.mjs
// Owns: none
// Timers: none        Wakes: none
// Only fixed internal model mutations reach this adapter, after strict hub write-ahead state and Spark claims.
// One target process for one fixed model mutation. It survives the SSH observer, holds the SAME attempt lock across
// its mutation, and never runs again after that attempt is fenced. Scripts come only from the two model builders;
// they stay in memory. The file holds only ids, states and bounded errors; no command, environment or model output.
const ROLLBACK_TARGET_PY = String.raw`
import base64, fcntl, json, os, re, subprocess, sys, time
p = json.loads(base64.b64decode(sys.argv[1])); home = os.path.expanduser('~/.local/state/spark-console/start-rollback')
assert re.fullmatch('[0-9a-f]{12}', p['operation']) and re.fullmatch('[0-9a-f]{12}', p['attempt'])
root = os.path.join(home, p['operation'], p['attempt'])
try: boot = open('/proc/sys/kernel/random/boot_id').read().strip()
except FileNotFoundError:
    boot = subprocess.check_output(['sysctl', '-n', 'kern.boottime'], text=True).strip()
if not boot: raise RuntimeError('The target boot identity is missing')
def read(name):
    try:
        with open(os.path.join(root, name)) as f: return json.load(f)
    except FileNotFoundError: return None
def save(name, value):
    target = os.path.join(root, name); temp = target + '.%d.tmp' % os.getpid()
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as f: json.dump(value, f); f.flush(); os.fsync(f.fileno())
    os.replace(temp, target)
    fd = os.open(root, os.O_RDONLY); os.fsync(fd); os.close(fd)
def emit(v): print('rollback\t' + json.dumps(v), flush=True)
def docker(args):
    return subprocess.run(['docker'] + args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
def inspect(ref):
    r = docker(['inspect', ref])
    if r.returncode:
        healthy = docker(['ps', '-q'])
        if healthy.returncode == 0 and ('No such' in r.stderr or r.stdout.strip() == '[]'): return None
        raise RuntimeError('Docker did not answer the container look')
    v = json.loads(r.stdout)
    if not isinstance(v, list) or len(v) != 1: raise RuntimeError('Docker returned an incomplete container look')
    x = v[0]; return {'id': x['Id'], 'name': x['Name'].lstrip('/'), 'startedAt': x['State']['StartedAt'], 'state': x['State']['Status'], 'labels': x['Config'].get('Labels') or {}, 'memory': x.get('HostConfig', {}).get('Memory', 0)}
def same(a, b): return a and b and a['id'] == b['id'] and a['startedAt'] == b['startedAt']
if p['mode'] == 'look':
    emit({'seen': inspect(p['name']), 'boot': boot}); sys.exit(0)
os.makedirs(root, mode=0o700, exist_ok=True)
lock = open(os.path.join(root, 'attempt.lock'), 'a+')
if p['mode'] == 'fence':
    try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError: emit({'active': True, 'boot': boot}); sys.exit(0)
    save('fenced.json', {'boot': boot})
    results = {}
    for command in p['commands']:
        assert re.fullmatch('[0-9a-f]{12}', command)
        r = read(command + '.done.json'); issued = read(command + '.issued.json')
        if r is None and issued is None: r = {'terminal': True, 'notIssued': True, 'boot': boot}
        elif issued is not None and issued.get('boot') != boot and (r is None or not r.get('terminal')): r = {'terminal': True, 'rebooted': True, 'boot': boot}
        elif r is None: r = {'terminal': False, 'boot': boot}
        results[command] = r
    emit({'active': False, 'fenced': True, 'boot': boot, 'results': results}); sys.exit(0)
assert re.fullmatch('[0-9a-f]{12}', p['command'])
if p['mode'] == 'receipt':
    emit({'result': read(p['command'] + '.done.json'), 'boot': boot}); sys.exit(0)
# Detach before acknowledging dispatch. The observer may time out; that never kills the actual Docker client.
if os.fork(): emit({'dispatched': True, 'boot': boot}); sys.exit(0)
os.setsid()
if os.fork(): os._exit(0)
fd = os.open(os.devnull, os.O_RDWR)
for n in (0, 1, 2): os.dup2(fd, n)
fcntl.flock(lock, fcntl.LOCK_EX)
command = p['command']; result = {'terminal': False, 'boot': boot}
try:
    if read('fenced.json') is not None:
        save(command + '.done.json', {'terminal': True, 'notIssued': True, 'boot': boot}); os._exit(0)
    if read(command + '.issued.json') is not None: os._exit(0)
    save(command + '.issued.json', {'boot': boot, 'action': p['action']})
    expected = p.get('expected'); before = inspect(expected['id'] if expected else p['name'])
    if expected and not same(before, expected):
        result = {'terminal': True, 'changed': True, 'seen': before, 'boot': boot}
    elif p['action'] == 'run':
        if before is not None: result = {'terminal': True, 'changed': True, 'seen': before, 'boot': boot}
        else:
            r = subprocess.run(['bash', '-c', p['script']], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            # Only success is terminal proof for a create. A killed/failed client can leave a daemon request in flight.
            normal = r.returncode == 0 or (r.returncode > 0 and 'Error response from daemon:' in r.stderr)
            result = {'terminal': normal, 'code': r.returncode, 'boot': boot}
            if r.returncode:
                error = r.stderr.lower()
                driver = re.search(r'could not select device driver (\"(?:nvidia)?\") with capabilities: \[\[gpu\]\]', r.stderr)
                clause = re.search(r'unrecognized arguments:[ \t]*([^\r\n]{1,700})', r.stderr, re.I)
                flag = re.search(r'(?:unknown (?:flag|option)|no such option):?[ \t]*(--[a-z][a-z0-9_-]{0,63})(?=$|[\s=,:])', r.stderr, re.I)
                flags = re.findall(r'(?<!\S)--[a-zA-Z][a-zA-Z0-9_-]{0,63}(?=$|[\s=,:])', clause.group(1))[:8] if clause else [flag.group(1)] if flag else []
                result['failure'] = ('docker: Error response from daemon: could not select device driver ' + driver.group(1) + ' with capabilities: [[gpu]].' if driver else 'unrecognized arguments: ' + ' '.join(flags) if flags else 'port is already allocated' if 'port is already allocated' in error else 'CUDA out of memory' if 'out of memory' in error else 'the image could not be found' if 'manifest unknown' in error else 'Docker refused the start')
            if r.returncode == 0:
                seen = inspect(p['name'])
                if not seen or seen['labels'].get('spark.operation') != p['operation'] or seen['labels'].get('spark.attempt') != p['attempt'] or seen['labels'].get('spark.command') != p['command']: raise RuntimeError('The new container identity was not proved')
                result['seen'] = seen
            elif re.fullmatch('[0-9a-f]{64}', r.stdout.strip()):
                # A returned full create ID is positive evidence only for this exact labelled command. Preserve the
                # client's failure, but let compensation stop this proven container instead of holding forever.
                created = r.stdout.strip(); seen = inspect(created)
                if seen and seen['id'] == created and seen['name'] == p['name'] and seen['labels'].get('spark.operation') == p['operation'] and seen['labels'].get('spark.attempt') == p['attempt'] and seen['labels'].get('spark.command') == p['command']:
                    result['terminal'] = True; result['seen'] = seen
    else:
        if before is None: result = {'terminal': True, 'missing': True, 'boot': boot}
        else:
            action = p['action']; args = {'start': ['start', before['id']], 'stop': ['stop', '--time', '20', before['id']], 'rename': ['rename', before['id'], p.get('to', p['name'])], 'remove': ['rm', before['id']]}[action]
            if action == 'start' and before['labels'].get('spark.job') == '1':
                guard = p.get('guard')
                if not isinstance(guard, str) or not guard: raise RuntimeError('The job folder check is missing')
                checked = subprocess.run(['bash', '-c', guard], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                if checked.returncode:
                    found = re.search(r'not real: (\.local/share/spark-portal/workspaces/shared(?:/jobs(?:/[A-Za-z0-9][A-Za-z0-9_.-]{0,127})?)?)(?:\s|$)', checked.stdout)
                    result = {'terminal': True, 'notIssued': True, 'guardFailed': True, 'code': checked.returncode, 'boot': boot}
                    if found: result['guardPath'] = found.group(1)
                    save(command + '.done.json', result); os._exit(0)
                after_guard = inspect(before['id'])
                if not same(after_guard, expected):
                    save(command + '.done.json', {'terminal': True, 'changed': True, 'seen': after_guard, 'boot': boot}); os._exit(0)
            r = docker(args)
            # Signal, timeout, or an unproved daemon failure never means that its request is finished.
            normal = r.returncode == 0 or (r.returncode > 0 and 'Error response from daemon:' in r.stderr)
            result = {'terminal': normal, 'code': r.returncode, 'boot': boot}
            if normal: result['seen'] = inspect(before['id'])
    save(command + '.done.json', result)
except BaseException:
    try: save(command + '.done.json', {'terminal': False, 'boot': boot})
    except BaseException: pass
os._exit(0)
`;
async function rollbackTarget(spark, payload, timeout = 20000) {
  const r = await run(nodeById(spark), `python3 -c ${q(ROLLBACK_TARGET_PY)} ${q(Buffer.from(JSON.stringify(payload)).toString('base64'))}`, { timeout });
  const rows = fields(r.out, 'rollback');
  if (r.code || rows.length !== 1 || rows[0].length !== 1) throw new Error(`${sparkName(nodeById(spark))} didn’t finish the put-back check. It may need a power cycle.`);
  let x; try { x = JSON.parse(rows[0][0]); } catch { throw new Error('The put-back check returned an incomplete answer.'); }
  return x;
}
async function rollbackLook(spark, name) {
  // A look uses a throw-away receipt namespace; it does not authorize a mutation.
  return (await rollbackTarget(spark, { operation: '000000000000', attempt: '000000000000', command: '000000000000', mode: 'look', name })).seen;
}

async function rollbackCommand(job, spark, action, name, expected = null, fields = {}, observeMs = 120000) {
  const attempt = await rollbackAttempt(job), r = rollbackRead(job.rollbackOperation), a = r.attempts.find(x => x.id === attempt.id);
  if (action === 'start' && r.phase === 'returning') {
    const original = r.units.flatMap(u => u.members).find(m => m.spark === spark && m.original.id === expected?.id);
    if (!original || original.state !== 'waiting' || rollbackDesiredChanged(original, desired(true).running, r)) throw new Error('The earlier start was superseded. It wasn’t started again.');
    if (job.type === 'start-rollback' && job.cancelled) throw new Error('This put-back was stopped before another start.');
  }
  const command = { id: randomBytes(6).toString('hex'), spark, action, name, expected };
  if (action === 'run' && name !== ENGINE_CHECK_NAME) {
    const key = `${spark}/${name}`;
    if ((r.stopWishes || []).includes(key)) throw Object.assign(new Error('The owner stopped this start before its next command.'), { cancelled: true });
    if (job.ownersWish) r.wishes = [...new Set([...(r.wishes || []), key])];
  }
  a.commands.push(command); rollbackWrite(r); // must succeed BEFORE the target may receive anything that mutates
  const data = typeof fields === 'function' ? fields({ operation: r.operation, attempt: a.id, command: command.id }) : fields;
  await rollbackTarget(spark, { operation: r.operation, attempt: a.id, command: command.id, mode: 'dispatch', action, name, expected, ...data });
  // Poll by the SAME lock without fencing this still-live attempt. The completed receipt is read in a separate mode.
  const end = performance.now() + Math.min(120000, Math.max(1, observeMs));
  while (performance.now() < end) {
    const out = await rollbackTarget(spark, { operation: r.operation, attempt: a.id, command: command.id, mode: 'receipt' });
    if (out.result) {
      const now = rollbackRead(r.operation), cmd = now.attempts.find(x => x.id === a.id).commands.find(x => x.id === command.id);
      cmd.result = out.result; rollbackWrite(now);
      if (!out.result.terminal) throw new Error(`${spark} didn’t give a final answer to ${action}. It may need a power cycle before earlier work can return.`);
      if (out.result.changed) throw new Error(`${name} on ${spark} changed since it was recorded, so it was left alone.`);
      if (out.result.guardFailed) throw jobNotReal(nodeById(spark), name, { out: out.result.guardPath ? `not real: ${out.result.guardPath}` : '' });
      if (out.result.code) throw new Error(`Docker couldn’t ${action} ${name} on ${spark}: ${out.result.failure || 'Docker refused the change'}.`);
      return out.result;
    }
    await sleep(performance.now() + 119000 < end ? 250 : 1000);
  }
  throw Object.assign(new Error(`${spark} didn’t finish ${action}. Earlier work stays stopped there until that command is known to have ended. It may need a power cycle.`), { rollbackObserverTimeout: true });
}
async function rollbackRun(job, spark, name, build) {
  try {
    const result = await rollbackCommand(job, spark, 'run', name, null, ids => ({ script: build(ids) }));
    return { code: 0, out: result.seen?.id || '', err: '' };
  } catch (e) {
    // The caller still reports its 120-second timeout. Compensation may later prove how that command ended.
    if (e.rollbackObserverTimeout) return { code: 124, out: '', err: '(timed out)' };
    throw e;
  }
}
// Only a failed stop of a positively identified NEW container is eligible for disposal. A late stop of an original
// could stop it again after restoration; no later look, elapsed time or failed client settles that uncertainty.
function rollbackStopCreated(record, spark, command) {
  if (record.phase !== 'returning' || command.action !== 'stop' || command.spark !== spark || command.result?.terminal !== false
    || !/^[0-9a-f]{64}$/.test(command.expected?.id || '') || !command.expected.startedAt
    || record.units.some(u => u.members.some(m => m.original.id === command.expected.id))
    || (record.wishes || []).includes(`${spark}/${command.name}`)) return null;
  const ordered = record.attempts.flatMap(a => a.commands.map(c => ({ a, c })));
  const at = ordered.findIndex(x => x.c.id === command.id && x.c.spark === spark);
  if (at < 0) return null;
  const creates = ordered.slice(0, at).filter(({ a, c }) => {
    const seen = c.result?.seen;
    return c.action === 'run' && c.spark === spark && c.name === command.name && c.result?.terminal === true
      && Number.isInteger(c.result.code) && !c.result.notIssued && !c.result.changed && !c.result.rebooted
      && seen?.id === command.expected.id && seen.startedAt === command.expected.startedAt && seen.name === command.name
      && seen.labels?.['spark.operation'] === record.operation && seen.labels?.['spark.attempt'] === a.id && seen.labels?.['spark.command'] === c.id;
  });
  return creates.length === 1 ? creates[0].c.result.seen : null;
}
function rollbackStopDisposed(record, spark, command) {
  if (!rollbackStopCreated(record, spark, command)) return false;
  const ordered = record.attempts.flatMap(a => a.commands), at = ordered.findIndex(c => c.id === command.id && c.spark === spark);
  return ordered.slice(at + 1).some(c => c.action === 'remove' && c.spark === spark && c.name === command.name
    && rollbackSame(c.expected, command.expected) && c.result?.terminal === true && c.result.code === 0 && c.result.seen === null
    && !c.result.notIssued && !c.result.changed && !c.result.missing && !c.result.rebooted);
}
// Collect every receipt before judging it: a later confirmed removal can dispose of an older uncertain stop's exact
// target. The old receipt stays nonterminal. Every producer lock must be free and persistently fenced first.
async function rollbackFenceState(record, spark) {
  const checked = new Set();
  for (const a of record.attempts) {
    const commands = a.commands.filter(c => c.spark === spark); if (!commands.length) continue;
    const out = await rollbackTarget(spark, { operation: record.operation, attempt: a.id, mode: 'fence', commands: commands.map(c => c.id) });
    if (out.active || !out.fenced) return { fenced: false, active: out.active === true, clear: false };
    const fresh = rollbackRead(record.operation);
    for (const c of commands) {
      const result = out.results?.[c.id];
      if (!result || typeof result.terminal !== 'boolean') return { fenced: false, clear: false };
      fresh.attempts.find(x => x.id === a.id).commands.find(x => x.id === c.id).result = result;
      checked.add(`${a.id}/${c.id}`);
    }
    rollbackWrite(fresh);
  }
  const fresh = rollbackRead(record.operation);
  if (fresh.attempts.some(a => a.commands.some(c => c.spark === spark && !checked.has(`${a.id}/${c.id}`)))) return { fenced: false, clear: false };
  const unresolved = fresh.attempts.flatMap(a => a.commands).filter(c => c.spark === spark && !c.result?.terminal && !rollbackStopDisposed(fresh, spark, c));
  return { fenced: true, clear: unresolved.length === 0, unresolved };
}
async function rollbackFence(record, spark) {
  const state = await rollbackFenceState(record, spark);
  return state.fenced && state.clear;
}
// A bounded continuation of this put-back under its existing claims. No scheduler, new authority or replayed create.
// A free fenced producer with only uncertain stops of proven new IDs may dispose of those IDs in a fresh attempt.
async function rollbackReconcile(job, spark, until = performance.now() + 90000) {
  let record = rollbackRead(job.rollbackOperation || job.rollbackSource);
  if (!record || record.phase !== 'returning' || !record.targets.includes(spark)) return false;
  if (await rollbackFence(record, spark)) { delete job.rollbackAttempt; return true; }
  if (!record.attempts.some(a => a.commands.some(c => c.spark === spark))) return false;
  let state;
  do {
    state = await rollbackFenceState(rollbackRead(record.operation), spark);
    if (state.clear) { delete job.rollbackAttempt; return true; }
    if (state.fenced || !state.active || performance.now() >= until) break;
    await sleep(Math.min(1000, Math.max(1, until - performance.now())));
  } while (performance.now() < until);
  if (!state.fenced || !state.unresolved?.length || performance.now() >= until) return false;
  record = rollbackRead(record.operation);
  if (!state.unresolved.every(c => rollbackStopCreated(record, spark, c))) return false;
  const targets = [...new Map(state.unresolved.map(c => [c.expected.id, c])).values()];
  delete job.rollbackAttempt;
  job.rollbackOperation = record.operation;
  const current = command => {
    const fresh = rollbackRead(record.operation), c = fresh.attempts.flatMap(a => a.commands).find(x => x.id === command.id && x.spark === spark);
    const created = c && rollbackStopCreated(fresh, spark, c);
    if (!created) throw new Error('The failed start’s exact container is no longer eligible for disposal.');
    return created;
  };
  try {
    for (const command of targets) {
      const created = current(command), seen = await rollbackLook(spark, created.id);
      if (!rollbackSame(created, seen) || seen.name !== created.name || ['spark.operation', 'spark.attempt', 'spark.command'].some(k => seen.labels?.[k] !== created.labels[k])) return false;
      if (performance.now() >= until) return false;
      // Always obtain a successful stop receipt; a stopped look alone grants no disposal proof.
      const stopped = await rollbackCommand(job, spark, 'stop', created.name, command.expected, () => { current(command); return {}; }, until - performance.now());
      if (!stopped.terminal || stopped.code !== 0 || stopped.notIssued || stopped.changed || stopped.missing || stopped.rebooted || !rollbackSame(created, stopped.seen) || !STOPPED_STATES.includes(stopped.seen.state)) return false;
      if (performance.now() >= until) return false;
      const removed = await rollbackCommand(job, spark, 'remove', created.name, command.expected, () => { current(command); return {}; }, until - performance.now());
      if (!removed.terminal || removed.code !== 0 || removed.seen !== null || removed.changed || removed.notIssued || removed.missing) return false;
    }
    return await rollbackFence(rollbackRead(record.operation), spark);
  } catch { return false; }
  finally { delete job.rollbackAttempt; } // A fenced compensation attempt must never receive the restoration.
}

async function rollbackStopNew(job, spark, name) {
  const seen = await rollbackLook(spark, name);
  if (!seen) return 'stopped';
  // Read intent after the asynchronous look: an owner's adoption may have arrived while Docker was answering.
  const r = rollbackRead(job.rollbackOperation), a = r.attempts.find(a => a.id === seen.labels?.['spark.attempt']);
  const created = a?.commands.find(c => c.id === seen.labels?.['spark.command'] && c.action === 'run' && c.name === name && c.spark === spark);
  if (seen.labels?.['spark.operation'] !== r.operation || !created || (r.wishes || []).includes(`${spark}/${name}`)
    || created.result?.seen && !rollbackSame(created.result.seen, seen)) return 'unknown';
  if (!STOPPED_STATES.includes(seen.state)) {
    try {
      await rollbackCommand(job, spark, 'stop', name, { id: seen.id, startedAt: seen.startedAt }, () => {
        // rollbackAttempt may yield before dispatch. Never stop a wish that arrived during that boundary either.
        const fresh = rollbackRead(r.operation), proof = fresh.attempts.find(x => x.id === a.id)?.commands.find(c => c.id === created.id)?.result?.seen;
        if ((fresh.wishes || []).includes(`${spark}/${name}`) || proof && !rollbackSame(proof, seen))
          throw Object.assign(new Error('The owner’s newer work was left alone.'), { rollbackNoStop: true });
        return {};
      });
    } catch (e) {
      if (e.rollbackNoStop) return 'unknown';
      // Reporting only: an observer timeout is not proof that the Spark is unreachable. A fresh unchanged exact
      // identity may prove it still runs, but even a stopped look cannot settle the unanswered stop receipt.
      const now = await rollbackLook(spark, seen.id).catch(() => null);
      return rollbackSame(seen, now) && now.name === seen.name && ['spark.operation', 'spark.attempt', 'spark.command'].every(k => now.labels?.[k] === seen.labels[k])
        && !STOPPED_STATES.includes(now.state) ? 'running' : 'unknown';
    }
  }
  const after = await rollbackLook(spark, seen.id);
  return !after || STOPPED_STATES.includes(after.state) ? 'stopped' : 'running';
}

async function rollbackRoom(parts) {
  for (const { m, seen } of parts) {
    if (!m.wasRunning || seen.state === 'running') continue;
    const memory = await memNow(nodeById(m.spark));
    if (!memory || memory.available < m.need + HEADROOM) throw new Error(`There isn’t enough free memory to put ${m.container} back and keep 8 GB free.`);
    const r = await run(nodeById(m.spark), `${gpuUsersScript('')}\ndocker ps -q >/dev/null 2>&1 && printf 'rollback-docker\\tok\\n'\nnvidia-smi --query-compute-apps=pid --format=csv,noheader >/dev/null 2>&1 && printf 'rollback-gpu\\tok\\n'`, { timeout: 30000 });
    if (r.code || fields(r.out, 'rollback-docker').length !== 1 || fields(r.out, 'rollback-gpu').length !== 1) throw new Error('Current GPU use couldn’t be checked.');
    const allowed = new Set(parts.filter(x => x.m.spark === m.spark).map(x => x.m.container));
    const gpu = fields(r.out, 'gpu');
    if (gpu.some(([pid, , process, name]) => !allowed.has(name) && !(name === '' && (m.gpuBefore || []).some(([oldPid, , oldProcess, oldName]) => oldName === '' && oldPid === pid && oldProcess === process)))) throw new Error('Other work is using the GPU now, so it was left running.');
    const users = fields(r.out, 'run');
    if (users.some(([name, , ours, gpuApp]) => !allowed.has(name) && (ours || gpuApp === '1'))) throw new Error('Other work is using this Spark now, so it was left running.');
  }
}

