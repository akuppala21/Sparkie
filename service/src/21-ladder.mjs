/* ───────── the ladder: a change on a Spark at once, asked first, or not done (A7c) ───────── */
// Area: features        Rules: R61, R55, R54, R52        Tests: ladder.test.mjs
// Owns: none
// Timers: none        Wakes: none
// run hands every command the sorter does not call a look to workChange (21-work.mjs). Code alone decides, from the
// sorter's answer (20-sort.mjs) and the request (design A 2.5 and 2.8; the one page, section 4). Not done, whatever is
// said: what the sorter calls not done; root (set root, a later build); any change on Spark 2 or a Spark holding the
// brain (asked first, a later build); the lock-out class (it waits for the lock-out net, which can put it back). At
// once, through the runner (21-runner.mjs: copies first, inside the run wall, starting in ~/work): a plain change when
// hostClear holds, which it never does while a Spark advertises Tailscale SSH (or that can't be told) or for a change
// placed in the model store, the Hugging Face cache or the shared folder. Otherwise asked: one button for the owner
// with the exact command, built here, on the page and in the paired Telegram chat; a risky change of a dangerous kind
// (a delete it cannot see, the brain's names) is the dangerous ask (20-danger.mjs). The owner's press runs it, sorted
// again then; the hash of each script it runs is taken when it is asked and taken again at the press, and a script that
// changed between voids the press and asks again. What a request read from outside (its records, for the dangerous
// ask's "came from") and what its changes wrote (passed to the sorter as opts.written, so a command that runs one is
// asked) are kept with the turn's ctx and its task (14-chats.mjs).
const WORK_READS = 40, WORK_WRITTEN = 1024, WORK_SCRIPTS = 8, WORK_ASK_MS = 15 * 60000;
// The request's reads and writes, from its task: what turnRequest puts on ctx.
const workTask = task => ({ reads: Array.isArray(task?.reads) ? task.reads.slice(-WORK_READS) : [],
  written: Array.isArray(task?.written) ? task.written.slice(0, WORK_WRITTEN + 1) : [] });
// …and back onto the task at the turn's end (keepTask).
function workKeep(task, ctx) {
  if (Array.isArray(ctx?.reads) && ctx.reads.length) task.reads = ctx.reads.slice(-WORK_READS);
  if (Array.isArray(ctx?.written) && ctx.written.length) task.written = ctx.written.slice(0, WORK_WRITTEN + 1);
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
// (never trimmed: kept past 1,024, where the sorter doubts, so the commands after it are asked)
function workWrote(ctx, sorted) {
  if (!Array.isArray(ctx?.written)) return;
  // (a place it only read is no write: the sorter's reads, R64)
  const reads = new Set(Array.isArray(sorted?.reads) ? sorted.reads : []);
  for (const p of [...(sorted?.placed || []).filter(x => !reads.has(x)), ...(sorted?.wide || [])]) if (typeof p === 'string' && ctx.written.length <= WORK_WRITTEN && !ctx.written.includes(p)) ctx.written.push(p);
}

// Whether a change runs at once (design A 2.5): why not, or null when it may. 1, the owner (their chats, Telegram, the
// API; never an agent). 4, the sorter calls it a plain change, one that reaches no protected folder (nor starts in
// one), would not fail inside the run wall (runnerOutside) and needs neither another Spark nor the GPU (runnerWiden).
// 2, in a chat: the owner's words ask for work (CHANGE_WORDS' kind `work`) and name the Spark. 3, nothing read from
// outside since, in the turn or its task. (5, the Spark's claim, is the runner's: taken, it answers so.) The first that
// fails is the reason the button gives.
function hostClear(node, sorted, viewer, ctx, dir = RUNNER_DIR, command = '', widen = {}, topDirs = [], listeners = null, file = false) {
  if (ctx.agent || ctx.agentId || viewer?.agentKey) return 'an agent asked for it';
  // (the sorter's own reason first: it says what the button is about)
  if (sorted.class !== 'change') return `it is risky: ${String(sorted.why).replace(/\.$/, '')}`;
  const reached = runnerProtected(sorted, dir);
  if (reached.length) return `it ${reached.some(d => dir === d || dir.startsWith(`${d}/`)) ? 'starts in' : 'changes'} ${reached.join(', ')}, which a change gets only after your yes`;
  const walls = runnerWalls(sorted, command, dir, topDirs);
  if (walls.open.length) return `${walls.open[0]}, so it runs outside that wall after your yes`;
  if (walls.home.length) return `${walls.home[0]}, so it runs after your yes with the top of your home writable`;
  const wide = runnerWiden(node, file ? '' : command, widen, sorted);
  if (wide.fleet) return 'it reaches another Spark of this fleet';
  if (wide.home) return 'it reaches your home network';
  if (wide.gpu) return 'it uses the GPU';
  // (no change runs at once while a Spark offers a shell with no key: Tailscale SSH, from the tailnet's own answer)
  const ts = workTailnetSsh();
  if (ts.on.length) return `Tailscale SSH is on for ${ts.on.join(', ')}, so a command could reach a shell there with no key`;
  if (ts.unknown.length) return `whether Tailscale SSH is on for ${ts.unknown.join(', ')} couldn’t be told`;
  // (nor while a program there listens on every address, but sshd and what the console published: the wall closes
  // ranges, not ports, and 127.0.0.53, the resolver it leaves open, reaches such a program)
  if (!listeners?.ok) return `whether something listens on every address on ${sparkName(node)} couldn’t be told`;
  const own = workOwnPorts(node), wideOpen = listeners.wide.filter(x => !own.has(x.port));
  if (wideOpen.length) return `${wideOpen.slice(0, 3).map(x => `port ${x.port}${x.prog ? ` (${x.prog})` : ''}`).join(', ')} ${wideOpen.length === 1 ? 'listens' : 'listen'} on every address on ${sparkName(node)}, which a change could reach`;
  if (ctx.via === 'sparkie') {
    const i = ctx.intent || {}, has = (l, k) => Array.isArray(l) && l.includes(k);
    if (!has(i.asked, 'work') || has(i.negated, 'work') || has(i.mixed, 'work')) return 'your words don’t ask for a change';
    if (!tokensOf(ctx.said || ctx.request || '').has(node.id)) return `your words don’t name ${sparkName(node)}`;
    if (ctx.readOutside) return 'Sparkie read text from outside first';
  } else if (!['api', 'page'].includes(ctx.via)) return 'it wasn’t asked for in your words';
  return null;
}

// What listens on every address on a Spark (the helper's read, fix 4): one look (ss -tlnp, the owner's own view, so a
// program's name only for the owner's own), kept a short while like the tailnet's; a look that fails can't tell.
const WORK_WIDE_MS = Number(ALL_LOCAL && process.env.SPARK_CONSOLE_WIDE_MS) || 60000;
const workWideSeen = new Map();
async function workListeners(node) {
  const was = workWideSeen.get(node.id);
  if (was && Date.now() - was.at <= WORK_WIDE_MS) return was;
  const r = await run(node, 'ss -tlnpH', { timeout: 15000 }).catch(() => ({ code: -1, out: '' }));
  const seen = { at: Date.now(), ok: r.code === 0, wide: [] };
  for (const line of seen.ok ? String(r.out).split('\n') : []) {
    const f = line.trim().split(/\s+/), m = /^(?:\*|0\.0\.0\.0|\[::\]|::|\[::ffff:0\.0\.0\.0\])(?:%\S+)?:(\d{1,5})$/.exec(f[3] || '');
    if (m && !seen.wide.some(x => x.port === Number(m[1]))) seen.wide.push({ port: Number(m[1]), prog: /users:\(\("([^"]{1,40})"/.exec(line)?.[1] || null });
  }
  workWideSeen.set(node.id, seen);
  return seen;
}
// The ports there that may listen wide: sshd's, and what the console itself published (its models' serve port, its
// apps' ports, desired.json).
function workOwnPorts(node) {
  const own = new Set([22, Number(CONFIG.servePort)]);
  try { for (const x of desired().running || []) if (x.spark === node.id && x.app && x.port) own.add(Number(String(x.port).split(':')[0])); } catch {}
  return own;
}

// Tailscale SSH on the fleet, from the tailnet's own answer (noteTailnet, 20-ways-in.mjs): the Sparks that advertise it,
// and those it can't tell for (an answer that couldn't be read or is older than three looks; a Spark missing from it,
// or offline).
function workTailnetSsh() {
  const fresh = !waysIn.keysMiss && waysIn.keysAt > 0 && Date.now() - waysIn.keysAt <= LOOK_STALE_MS, on = [], unknown = [];
  for (const n of NODES) {
    const v = fresh ? waysIn.ssh?.[n.id] : undefined;
    if (v === true) on.push(sparkName(n)); else if (v !== false) unknown.push(sparkName(n));
  }
  return { on, unknown };
}

// Where a command reads each script it runs (the A7c review, fix 1): a name as typed, from the folder the change starts
// in (dir) and from each folder a cd or pushd in it names (from dir); a ~ or whole path as it is. A cd the ladder can't
// read (a $, a quote, a pattern, a ..) is said on the button: what runs after it isn't hashed.
function workScriptPaths(scripts, dir, command) {
  const bases = [dir], odd = [], ok = t => t.startsWith('/') || t === '~' || t.startsWith('~/');
  for (const m of String(command).matchAll(/(?:^|[;&|(]\s*)(?:cd|pushd)(?:\s+(?:--\s+)?([^\s;&|)]+))?/g)) {
    const t = m[1] ?? '~';
    if (/[$`'"\\*?[\]{}]|(?:^|\/)\.\.?(?:\/|$)/.test(t)) { odd.push(t); continue; }
    const b = ok(t) ? t : `${dir}/${t}`.replace(/\/+$/, '');
    if (!bases.includes(b)) bases.push(b);
  }
  const paths = [];
  for (const s of scripts) for (const p of (ok(s) ? [s] : bases.map(b => `${b}/${s.replace(/^(?:\.\/)+/, '')}`))) if (!paths.includes(p)) paths.push(p);
  return { paths: paths.slice(0, WORK_SCRIPTS), bases, odd };
}
// The scripts a command runs, hashed on the Spark now where it reads them: {sums: {path: SHA-256, or null when it
// isn't a plain file there}, bases, odd}.
async function workScripts(node, scripts, dir = RUNNER_DIR, command = '') {
  const list = (scripts || []).filter(s => typeof s === 'string' && s && !/[\x00-\x1f]/.test(s)).slice(0, WORK_SCRIPTS);
  if (!list.length) return { sums: {}, bases: [dir], odd: [] };
  const { paths, bases, odd } = workScriptPaths(list, dir, command);
  const word = s => (s === '~' || s.startsWith('~/') ? `"$HOME"${q(s.slice(1))}` : q(s));
  const r = await run(node, `cd -- "$HOME" 2>/dev/null; ${paths.map(s => `if [ -f ${word(s)} ] && [ ! -L ${word(s)} ]; then sha256sum < ${word(s)}; else echo -; fi`).join('; ')}`, { timeout: 20000 });
  if (r.code !== 0) throw new HttpError(r.code === 255 ? 503 : 502, `The scripts it runs on ${sparkName(node)} couldn’t be read, so nothing was asked or run.`);
  const sums = r.out.trim().split('\n').map(l => /^([0-9a-f]{64})\b/.exec(l)?.[1] || null);
  return { sums: Object.fromEntries(paths.map((s, i) => [s, sums[i] ?? null])), bases, odd, names: list };
}
// The asks waiting for a press (by chat, Spark, folder and command): the scripts' hashes when asked. Gone after 15
// minutes, as the buttons are.
const workAsks = new Map();
const workKey = (node, command, ctx, dir = RUNNER_DIR) => createHash('sha256').update(`${ctx.conv || ''}\n${node.id}\n${dir}\n${command}`).digest('hex');

// The button's words, built by code: the exact command, the Spark, why it is asked, what put-back covers, what it
// would run outside the wall or widen after the yes, what Sparkie read before proposing it, each script's hash.
function workLabel(node, command, sorted, why, ctx, scripts, dir = RUNNER_DIR, widen = {}, topDirs = [], spec = null) {
  const at = sparkName(node), reads = (ctx.reads || []).slice(-4).map(r => r.label), { sums = {}, bases = [dir], odd = [], names = [] } = spec ? {} : scripts;
  const lines = Object.entries(sums).filter(([, h]) => h).map(([p, h]) => `It runs ${p} (SHA-256 ${h.slice(0, 12)}…); what that script reads later isn’t checked.`);
  for (const n of names) if (!Object.entries(sums).some(([p, h]) => h && (p === n || p.endsWith(`/${n.replace(/^(?:\.\/)+/, '')}`)))) lines.push(`It runs ${n}, which isn’t a plain file in ${bases.join(' or ')} now.`);
  if (odd.length) lines.push(`It changes folder (cd ${odd[0].slice(0, 60)}) in a way that isn’t read here: a script it runs there isn’t hashed.`);
  const walls = runnerWalls(sorted, command, dir, topDirs), wide = runnerWiden(node, spec ? '' : command, widen, sorted);
  const wideLines = [wide.fleet && RUNNER_WIDE.fleet, wide.home && RUNNER_WIDE.home, wide.gpu && RUNNER_WIDE.gpu].filter(Boolean);
  // (write_file, A7d: the path and the lines that change, old and new, design A 2.14 row 7)
  return [...(spec ? spec.lines(at) : [`Run this on ${at}?`, `$ ${command}`]), `Asked because ${why}.`,
    // (outside the plain wall, with its stark words; or the top of the home writable, keys still hidden; or what widens)
    ...(walls.open.length ? [`Runs outside the plain wall: ${[...walls.open, ...walls.home].join('; ')}.`, RUNNER_OPEN_HOLDS]
      : walls.home.length ? [`Runs with the top of your home writable: ${walls.home.join('; ')}. Keys stay hidden and it cannot reach Docker.`, ...wideLines] : wideLines),
    ...(wide.internet ? [RUNNER_WIDE.internet] : []),
    sorted.scripts?.length || !(sorted.placed?.length || sorted.wide?.length) ? RUNNER_NOT_COVERED : 'The files it names are copied first, so undo can put them back. Anything else it writes isn’t covered by put-back.',
    ...(reads.length ? [`Sparkie read this before proposing it: ${reads.join('; ')}.`] : []), ...lines].join('\n');
}
async function workAsk(node, command, sorted, viewer, ctx, why, dir = RUNNER_DIR, widen = {}, topDirs = [], spec = null) {
  // (what is shown is what runs: nothing hidden, nothing a mask would hide)
  if (!spec && maskSecrets(command) !== command) throw new HttpError(400, 'It holds something shaped like a key or password, so it can’t be shown whole on a button: give the key by its name. Nothing was asked or run.');
  // (write_file's: the file's own SHA-256 as it was read for this ask, so a press after it changed is void)
  const scripts = spec ? { sums: spec.sums } : await workScripts(node, sorted.scripts, dir, command);
  for (const [k, v] of workAsks) if (Date.now() - v.at > WORK_ASK_MS) workAsks.delete(k);
  workAsks.set(workKey(node, spec?.key ?? command, ctx, dir), { sums: scripts.sums, at: Date.now() });
  const call = spec ? { action: 'write_file', args: spec.args }
    : { action: 'run', args: { on: node.id, command, ...(dir !== RUNNER_DIR ? { dir } : {}), ...(widen.fleet === true ? { fleet: true } : {}), ...(widen.gpu === true ? { gpu: true } : {}) } };
  const dangerous = (sorted.kinds || []).filter(k => ['delete', 'brain'].includes(k));
  if (dangerous.length) {
    return dangerAsk(viewer, ctx, { kinds: dangerous, where: node.id, shown: spec ? spec.file : { command }, call,
      facts: dangerous.includes('delete') ? { gone: { what: String(sorted.why || '').replace(/\s*That cannot be put back\.?$/, '') } } : {} });
  }
  // (write_file's lines the button shows whole: Telegram's ask and the page's copy of a press; the records keep them masked)
  return question(viewer, ctx, workLabel(node, command, sorted, why, ctx, scripts, dir, widen, topDirs, spec), [{ label: 'Run it', call }, { label: 'No', call: null }], 'proposal',
    { ownerOnly: true, ...(spec?.whole ? { whole: spec.whole(sparkName(node)) } : {}) });
}

// A change on a Spark (run, 21-work.mjs): not done, at once, or asked.
// spec (write_file, 21-write.mjs): its own call, key and lines for the button, and what the runner runs in its place
// (as); command is then the plain write the sorter was handed.
async function workChange(node, command, sorted, viewer, ctx, dir = RUNNER_DIR, widen = {}, spec = null) {
  whoMayLook(viewer, ctx);
  const at = sparkName(node);
  // (Spark 2, a brain Spark, root, the root helper named, a pause: the runner's own words, 21-runner.mjs)
  runnerNever(node, sorted, ctx);
  if (sorted.class === 'notdone') throw new HttpError(403, `Not done: ${sorted.why}`);
  if (sorted.class === 'lockout') throw new HttpError(403, `Nothing ran: a change that can lock you out of ${at} waits for the lock-out net (a later build), which puts it back unless you confirm it. ${sorted.why}`);
  // (which folders at the top of the home it names are there now: writing inside one isn't at the top, R63)
  const topDirs = await runnerTopDirs(node, sorted);
  // The owner's yes, pressed (on the page, or in the paired Telegram chat while approvals from there are on).
  if (ctx.button && ctx.ownerConfirmed) {
    const key = workKey(node, spec?.key ?? command, ctx, dir), was = workAsks.get(key);
    if (was && Object.keys(was.sums).length) {
      const now = spec ? spec.sums : (await workScripts(node, sorted.scripts, dir, command)).sums;
      if ([...new Set([...Object.keys(was.sums), ...Object.keys(now)])].some(p => was.sums[p] !== now[p])) {
        workAsks.delete(key);
        return workAsk(node, command, sorted, viewer, { ...ctx, button: false, ownerConfirmed: false }, `${spec ? 'the file changed' : 'a script it runs changed'} after you were asked, so that yes was void`, dir, widen, topDirs, spec);
      }
    }
    workAsks.delete(key);
    return runChange(node, spec?.run ?? command, viewer, ctx, { asked: true, dir, widen, topDirs, as: spec?.as });
  }
  let why = hostClear(node, sorted, viewer, ctx, dir, command, widen, topDirs, await workListeners(node), Boolean(spec)) || spec?.ask || null;
  // (Sparkie's own call runs at once only while its brain is checked: the rail, 21-brain-rail.mjs, R52; run is a
  // lookup to runAction, so the ladder asks the rail itself, last, as it looks at Sparkie's model)
  if (!why && ctx.via === 'sparkie') { const rail = await brainRail(); if (!rail.checked) why = `Sparkie asks before every change: ${rail.why}`; }
  if (!why) return runChange(node, spec?.run ?? command, viewer, ctx, { dir, widen, topDirs, as: spec?.as });
  // The owner's own call with no chat to show a button in (the API): nothing is asked there. A change the runner
  // won't run unasked gets its own words; any other reason is said.
  if (!ctx.conv && !ctx.onQuestion && !ctx.agent && !ctx.agentId && !viewer?.agentKey) {
    const w = runnerWiden(node, spec ? '' : command, widen, sorted);
    if (sorted.class !== 'change' || runnerProtected(sorted, dir).length || runnerOutside(sorted, command, dir, topDirs).length || w.fleet || w.gpu || w.home) return runChange(node, spec?.run ?? command, viewer, ctx, { dir, widen, topDirs, as: spec?.as });
    throw new HttpError(409, `Not run at once: ${why}. Ask for it in your chat with Sparkie, where it is asked with a button. Nothing ran.`);
  }
  return workAsk(node, command, sorted, viewer, ctx, why, dir, widen, topDirs, spec);
}
