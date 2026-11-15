/* ───────── the ladder: a change on a Spark at once, asked first, or not done (A7c) ───────── */
// Area: features        Rules: R61, R55, R54        Tests: ladder.test.mjs
// Owns: none
// Timers: none        Wakes: none
// run hands every command the sorter does not call a look to workChange (21-work.mjs). Code alone decides, from the
// sorter's answer (20-sort.mjs) and the request (design A 2.5 and 2.8; the one page, section 4). Not done, whatever is
// said: what the sorter calls not done; root (set root, a later build); any change on Spark 2 or a Spark holding the
// brain (asked first, a later build); the lock-out class (it waits for the lock-out net, which can put it back). At
// once, through the runner (21-runner.mjs: copies first, inside the run wall): a plain change when hostClear holds.
// Otherwise asked: one button for the owner with the exact command, built here, on the page and in the paired Telegram
// chat; a risky change of a dangerous kind (a delete it cannot see, the brain's names) is the dangerous ask (20-danger.mjs).
// The owner's press runs it, sorted again then; the hash of each script it runs is taken when it is asked and taken
// again at the press, and a script that changed between voids the press and asks again. What a request read from
// outside (its records, for the dangerous ask's "came from") and what its changes wrote (passed to the sorter as
// opts.written, so a command that runs one is asked) are kept with the turn's ctx and its task (14-chats.mjs).
const WORK_READS = 40, WORK_WRITTEN = 1024, WORK_SCRIPTS = 8, WORK_ASK_MS = 15 * 60000;
// The request's reads and writes, from its task: what turnRequest puts on ctx.
const workTask = task => ({ reads: Array.isArray(task?.reads) ? task.reads.slice(-WORK_READS) : [],
  written: Array.isArray(task?.written) ? task.written.slice(-WORK_WRITTEN) : [] });
// …and back onto the task at the turn's end (keepTask).
function workKeep(task, ctx) {
  if (Array.isArray(ctx?.reads) && ctx.reads.length) task.reads = ctx.reads.slice(-WORK_READS);
  if (Array.isArray(ctx?.written) && ctx.written.length) task.written = ctx.written.slice(-WORK_WRITTEN);
}
// One read from outside, by its journal record: a label built by code (the tool's title and its Spark), never its words.
function workRead(ctx, id, title, args) {
  if (!Array.isArray(ctx?.reads) || !/^j_[0-9a-f]{12}$/.test(String(id || ''))) return;
  let on = null;
  try { const a = JSON.parse(args || '{}'); on = a?.on ?? a?.spark ?? null; } catch {}
  const node = typeof on === 'string' ? nodeById(sparkIdOf(on) || '') : null;
  ctx.reads.push({ id, label: `${String(title || 'a read').slice(0, 80)}${node ? ` on ${sparkName(node)}` : ''}`, at: new Date().toISOString() });
  if (ctx.reads.length > WORK_READS) ctx.reads.splice(0, ctx.reads.length - WORK_READS);
}
// What a change that ran wrote, as the sorter placed it, for the commands after it in this request.
function workWrote(ctx, sorted) {
  if (!Array.isArray(ctx?.written)) return;
  for (const p of [...(sorted?.placed || []), ...(sorted?.wide || [])]) if (typeof p === 'string' && !ctx.written.includes(p)) ctx.written.push(p);
  if (ctx.written.length > WORK_WRITTEN) ctx.written.splice(0, ctx.written.length - WORK_WRITTEN);
}

// Whether a change runs at once (design A 2.5): why not, or null when it may. 1, the owner (their chats, Telegram, the
// API; never an agent). 4, the sorter calls it a plain change. 2, in a chat: the owner's words ask for work
// (CHANGE_WORDS' kind `work`) and name the Spark. 3, nothing read from outside since, in the turn or its task. (5, the
// Spark's claim, is the runner's: taken, it answers so.) The first that fails is the reason the button gives.
function hostClear(node, sorted, viewer, ctx) {
  if (ctx.agent || ctx.agentId || viewer?.agentKey) return 'an agent asked for it';
  // (the sorter's own reason first: it says what the button is about)
  if (sorted.class !== 'change') return `it is risky: ${sorted.why}`;
  if (ctx.via === 'sparkie') {
    const i = ctx.intent || {}, has = (l, k) => Array.isArray(l) && l.includes(k);
    if (!has(i.asked, 'work') || has(i.negated, 'work') || has(i.mixed, 'work')) return 'your words don’t ask for a change';
    if (!tokensOf(ctx.said || ctx.request || '').has(node.id)) return `your words don’t name ${sparkName(node)}`;
    if (ctx.readOutside) return 'Sparkie read text from outside first';
  } else if (!['api', 'page'].includes(ctx.via)) return 'it wasn’t asked for in your words';
  return null;
}

// The scripts a command runs, hashed on the Spark now: {path: SHA-256, or null when it isn't a plain file there}.
async function workScripts(node, scripts) {
  const list = (scripts || []).filter(s => typeof s === 'string' && s && !/[\x00-\x1f]/.test(s)).slice(0, WORK_SCRIPTS);
  if (!list.length) return {};
  const word = s => (s === '~' || s.startsWith('~/') ? `"$HOME"${q(s.slice(1))}` : q(s));
  const r = await run(node, `cd -- "$HOME" 2>/dev/null; ${list.map(s => `if [ -f ${word(s)} ] && [ ! -L ${word(s)} ]; then sha256sum < ${word(s)}; else echo -; fi`).join('; ')}`, { timeout: 20000 });
  if (r.code !== 0) throw new HttpError(r.code === 255 ? 503 : 502, `The scripts it runs on ${sparkName(node)} couldn’t be read, so nothing was asked or run.`);
  const sums = r.out.trim().split('\n').map(l => /^([0-9a-f]{64})\b/.exec(l)?.[1] || null);
  return Object.fromEntries(list.map((s, i) => [s, sums[i] ?? null]));
}
// The asks waiting for a press (by chat, Spark and command): the scripts' hashes when asked. Gone after 15 minutes, as
// the buttons are.
const workAsks = new Map();
const workKey = (node, command, ctx) => createHash('sha256').update(`${ctx.conv || ''}\n${node.id}\n${command}`).digest('hex');

// The button's words, built by code: the exact command, the Spark, why it is asked, what put-back covers, what Sparkie
// read before proposing it, each script's hash.
function workLabel(node, command, sorted, why, ctx, hashes) {
  const at = sparkName(node), reads = (ctx.reads || []).slice(-4).map(r => r.label);
  const scripts = Object.entries(hashes).map(([p, h]) => (h ? `It runs ${p} (SHA-256 ${h.slice(0, 12)}…); what that script reads later isn’t checked.` : `It runs ${p}, which isn’t a plain file there now.`));
  return [`Run this on ${at}?`, `$ ${command}`, `Asked because ${why}.`,
    sorted.scripts?.length || !(sorted.placed?.length || sorted.wide?.length) ? RUNNER_NOT_COVERED : 'The files it names are copied first, so undo can put them back. Anything else it writes isn’t covered by put-back.',
    ...(reads.length ? [`Sparkie read this before proposing it: ${reads.join('; ')}.`] : []), ...scripts].join('\n');
}
async function workAsk(node, command, sorted, viewer, ctx, why) {
  // (what is shown is what runs: nothing hidden, nothing a mask would hide)
  if (maskSecrets(command) !== command) throw new HttpError(400, 'It holds something shaped like a key or password, so it can’t be shown whole on a button: give the key by its name. Nothing was asked or run.');
  const hashes = await workScripts(node, sorted.scripts);
  for (const [k, v] of workAsks) if (Date.now() - v.at > WORK_ASK_MS) workAsks.delete(k);
  workAsks.set(workKey(node, command, ctx), { hashes, at: Date.now() });
  const call = { action: 'run', args: { on: node.id, command } };
  const dangerous = (sorted.kinds || []).filter(k => ['delete', 'brain'].includes(k));
  if (dangerous.length) {
    return dangerAsk(viewer, ctx, { kinds: dangerous, where: node.id, shown: { command }, call,
      facts: dangerous.includes('delete') ? { gone: { what: String(sorted.why || '').replace(/\s*That cannot be put back\.?$/, '') } } : {} });
  }
  return question(viewer, ctx, workLabel(node, command, sorted, why, ctx, hashes), [{ label: 'Run it', call }, { label: 'No', call: null }], 'proposal', { ownerOnly: true });
}

// A change on a Spark (run, 21-work.mjs): not done, at once, or asked.
async function workChange(node, command, sorted, viewer, ctx) {
  whoMayLook(viewer, ctx);
  const at = sparkName(node);
  // (Spark 2, a brain Spark, root, the root helper named, a pause: the runner's own words, 21-runner.mjs)
  runnerNever(node, sorted, ctx);
  if (sorted.class === 'notdone') throw new HttpError(403, `Not done: ${sorted.why}`);
  if (sorted.class === 'lockout') throw new HttpError(403, `It can lock you out of ${at} (${sorted.why}), so it waits for the lock-out net, which puts such a change back unless you confirm it: a later build. Nothing ran.`);
  // The owner's yes, pressed (on the page, or in the paired Telegram chat while approvals from there are on).
  if (ctx.button && ctx.ownerConfirmed) {
    const key = workKey(node, command, ctx), was = workAsks.get(key);
    if (was && Object.keys(was.hashes).length) {
      const now = await workScripts(node, sorted.scripts);
      if (Object.keys(was.hashes).some(p => was.hashes[p] !== now[p])) {
        workAsks.delete(key);
        return workAsk(node, command, sorted, viewer, { ...ctx, button: false, ownerConfirmed: false }, 'a script it runs changed after you were asked, so that yes was void');
      }
    }
    workAsks.delete(key);
    return runChange(node, command, viewer, ctx, { asked: true });
  }
  const why = hostClear(node, sorted, viewer, ctx);
  // (at once; or the owner's own call with no chat to show a button in, the API: the runner answers it, and refuses
  // anything but a plain change in its own words)
  if (!why || (!ctx.conv && !ctx.onQuestion && !ctx.agent && !ctx.agentId && !viewer?.agentKey)) return runChange(node, command, viewer, ctx);
  return workAsk(node, command, sorted, viewer, ctx, why);
}
