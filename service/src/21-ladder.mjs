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
// fails is the reason the button gives. ahead: a go-ahead of this task covers it (21-ahead.mjs), which stands in for 2 and
// 3 only.
function hostClear(node, sorted, viewer, ctx, dir = RUNNER_DIR, command = '', widen = {}, topDirs = [], listeners = null, ahead = false) {
  if (ctx.agent || ctx.agentId || viewer?.agentKey) return 'an agent asked for it';
  // (the sorter's own reason first: it says what the button is about)
  if (sorted.class !== 'change') return `it is risky: ${String(sorted.why).replace(/\.$/, '')}`;
  const reached = runnerProtected(sorted, dir);
  if (reached.length) return `it ${reached.some(d => dir === d || dir.startsWith(`${d}/`)) ? 'starts in' : 'changes'} ${reached.join(', ')}, which a change gets only after your yes`;
  const walls = runnerWalls(sorted, command, dir, topDirs);
  if (walls.open.length) return `${walls.open[0]}, so it runs outside that wall after your yes`;
  if (walls.home.length) return `${walls.home[0]}, so it runs after your yes with the top of your home writable`;
  const wide = runnerWiden(node, command, widen, sorted);
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
  if (ahead) return null;
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

// Where a command reads each script it runs, only where that is plain (the A7c review, fix 1): a script named as
// written (no $, quote, pattern or ..), from the folder the change starts in (dir), or from the one folder a first
// `cd <plain folder> &&` names; a ~ or whole path as it is. Anything else (a second cd, a cd anywhere else or with an
// option, a script's name that isn't plain) pins nothing: the button says the script's text isn't pinned by a hash.
const WORK_PLAIN = /^[^\s$`'"\\*?[\]{}]+$/, workPlainName = t => WORK_PLAIN.test(t) && !t.startsWith('-') && !/(?:^|\/)\.\.?(?:\/|$)/.test(t);
function workScriptPaths(scripts, dir, command) {
  const c = String(command), cds = [...c.matchAll(/(?<![\w./-])(?:cd|pushd|popd)(?![\w./-])/g)].length;
  const first = /^\s*cd\s+(\S+)\s*&&/.exec(c), ok = t => t.startsWith('/') || t === '~' || t.startsWith('~/');
  const base = cds === 0 ? dir : cds === 1 && first && workPlainName(first[1]) ? (ok(first[1]) ? first[1] : `${dir}/${first[1]}`).replace(/\/+$/, '') : null;
  const paths = [], unpinned = [];
  for (const s of scripts) {
    if (!workPlainName(s.replace(/^(?:\.\/)+/, '')) || (!ok(s) && base === null)) { unpinned.push(s); continue; }
    const p = ok(s) ? s : `${base}/${s.replace(/^(?:\.\/)+/, '')}`;
    if (!paths.includes(p)) paths.push(p);
  }
  return { paths: paths.slice(0, WORK_SCRIPTS), unpinned };
}
// The scripts a command runs, hashed on the Spark now where it reads them, through the root helper's look (R42): what
// the look wall hides reads as not there, and a key's name is refused before it, so a hash never says more of a file
// than a look may. {sums: {path: SHA-256, or null when it isn't a file there}, unpinned (the names not pinned)}; or,
// when the look gave no answer of its own (no helper, walls not proven, refused, the Spark silent), no sums and unread:
// why.
async function workScripts(node, scripts, dir = RUNNER_DIR, command = '') {
  const list = (scripts || []).filter(s => typeof s === 'string' && s && !/[\x00-\x1f]/.test(s)).slice(0, WORK_SCRIPTS);
  if (!list.length) return { sums: {}, unpinned: [] };
  const { paths, unpinned } = workScriptPaths(list, dir, command);
  if (!paths.length) return { sums: {}, unpinned };
  // (a look starts in the home: a ~ path is read from there)
  const word = s => q(s === '~' ? '.' : s.startsWith('~/') ? `./${s.slice(2)}` : s);
  const look = paths.map((s, i) => `if [ -f ${word(s)} ] && h=$(sha256sum < ${word(s)} 2>/dev/null); then printf 'h${i} %s\\n' "\${h%% *}"; else echo 'h${i} -'; fi`).join('; ');
  const a = helperAnswer(await helperCall(node, 'look', { command: look, seconds: LOOK_SECONDS, words: paths, walks: [] }));
  const got = new Map([...String(a.kind === 'ran' && !a.cut ? a.output : '').matchAll(/^h(\d+) ([0-9a-f]{64}|-)$/gm)].map(m => [Number(m[1]), m[2]]));
  if (a.kind !== 'ran' || paths.some((_, i) => !got.has(i))) return { sums: {}, unpinned, unread: WORK_UNREAD[a.kind] || 'the look didn’t answer the way it does' };
  return { sums: Object.fromEntries(paths.map((s, i) => [s, got.get(i) === '-' ? null : got.get(i)])), unpinned };
}
// Why the scripts couldn't be read, by the look's answer, for the button.
const WORK_UNREAD = { none: 'the root helper isn’t set up there yet', unknown: 'its root helper is one this build doesn’t know', nosudo: 'the root helper’s sudo line isn’t there',
  proof: 'the root helper’s walls aren’t proven there', failed: 'the root helper’s walls aren’t proven there', proving: 'its walls are being proven right now',
  key: 'one of them is a key file, which a look never reads', walk: 'one of them is a key file, which a look never reads', slow: 'the check for keys took too long',
  refused: 'the look wall refused it', unreachable: 'the Spark didn’t answer', ended: 'the Spark didn’t answer in time' };
// The asks waiting for a press, each under its yes button's own id (pendingChoices; a dangerous ask's too): the Spark,
// folder and command, the wall its button showed, and the scripts' hashes then (or that they couldn't be read). Gone
// after 16 minutes: the buttons' 15, and the minute a dangerous ask may open late.
const workAsks = new Map();
function workRecord(args, record) {
  for (const [k, v] of workAsks) if (Date.now() - v.at > WORK_ASK_MS + DANGER_LATE_MS) workAsks.delete(k);
  for (const [id, c] of pendingChoices) if (c.args === args) workAsks.set(id, record);
}
const WORK_WALLS = { plain: 'in the plain wall', home: 'with the top of your home writable', open: 'outside the plain wall' };

// What both asks show of the wall it runs in after the yes, built by code: outside the plain wall, its stark words; the
// top of the home writable, what that leaves; and what it widens and reaches. wall: the one it runs in.
function workWallLines(node, command, sorted, dir = RUNNER_DIR, widen = {}, topDirs = []) {
  const walls = runnerWalls(sorted, command, dir, topDirs), wide = runnerWiden(node, command, widen, sorted);
  const wideLines = [wide.fleet && RUNNER_WIDE.fleet, wide.home && RUNNER_WIDE.home, wide.gpu && RUNNER_WIDE.gpu].filter(Boolean);
  return { walls, wall: walls.open.length ? 'open' : walls.home.length ? 'home' : 'plain',
    outside: walls.open.length ? [...walls.open, ...walls.home].join('; ') : null,
    lines: [...(walls.open.length ? [RUNNER_OPEN_HOLDS] : walls.home.length ? [...runnerHomeLines(node, walls, wide), ...wideLines] : wideLines),
      ...(wide.internet ? [RUNNER_WIDE.internet] : [])] };
}
// Each script's hash, or why it has none.
function workScriptLines(scripts) {
  const { sums = {}, unpinned = [], unread = null } = scripts, not = n => `It runs ${n}; its text isn’t pinned by a hash, so a change to it after this ask isn’t seen.`;
  if (unread) return [`The scripts it runs couldn’t be read here (${unread}), so none is hashed: a change to one after this ask isn’t seen.`];
  return [...Object.entries(sums).map(([p, h]) => (h ? `It runs ${p} (SHA-256 ${h.slice(0, 12)}…); what that script reads later isn’t checked.` : not(p))), ...unpinned.slice(0, 4).map(n => not(n.slice(0, 120)))];
}

// The button's words, built by code: the exact command, the Spark, why it is asked, the wall it runs in after the yes
// and what that lets it do, what put-back covers, what Sparkie read before proposing it, each script's hash.
function workLabel(node, command, sorted, why, ctx, scripts, dir = RUNNER_DIR, shown = workWallLines(node, command, sorted, dir)) {
  const at = sparkName(node), reads = (ctx.reads || []).slice(-4).map(r => r.label);
  return [`Run this on ${at}?`, `$ ${command}`, `Asked because ${why}.`, ...(shown.outside ? [`Runs outside the plain wall: ${shown.outside}.`] : []), ...shown.lines,
    sorted.scripts?.length || !(sorted.placed?.length || sorted.wide?.length) ? RUNNER_NOT_COVERED : 'The files it names are copied first, so undo can put them back. Anything else it writes isn’t covered by put-back.',
    ...(reads.length ? [`Sparkie read this before proposing it: ${reads.join('; ')}.`] : []), ...workScriptLines(scripts)].join('\n');
}
async function workAsk(node, command, sorted, viewer, ctx, why, dir = RUNNER_DIR, widen = {}, topDirs = []) {
  // (what is shown is what runs: nothing hidden, nothing a mask would hide)
  if (maskSecrets(command) !== command) throw new HttpError(400, 'It holds something shaped like a key or password, so it can’t be shown whole on a button: give the key by its name. Nothing was asked or run.');
  const scripts = await workScripts(node, sorted.scripts, dir, command), shown = workWallLines(node, command, sorted, dir, widen, topDirs);
  const call = { action: 'run', args: { on: node.id, command, ...(dir !== RUNNER_DIR ? { dir } : {}), ...(widen.fleet === true ? { fleet: true } : {}), ...(widen.gpu === true ? { gpu: true } : {}) } };
  const dangerous = (sorted.kinds || []).filter(k => ['delete', 'brain'].includes(k));
  // (and, when it may be, "Run it, and don't ask again for this task: …", 21-ahead.mjs: its button shares the call, so it
  // keeps the ask's record too)
  const offer = dangerous.length ? null : aheadOffer(node, command, sorted, viewer, ctx, dir, topDirs, widen);
  // (the dangerous ask says the same of its wall, what it reaches and its scripts; its yes binds the wall, R54)
  const out = dangerous.length ? dangerAsk(viewer, ctx, { kinds: dangerous, where: node.id, shown: { command }, call,
    facts: { ...(dangerous.includes('delete') ? { gone: { what: String(sorted.why || '').replace(/\s*That cannot be put back\.?$/, '') } } : {}),
      ...(shown.outside ? { outsideWall: shown.outside } : {}), wall: shown.wall, lines: [...shown.lines, ...workScriptLines(scripts)] } })
    : question(viewer, ctx, workLabel(node, command, sorted, why, ctx, scripts, dir, shown),
      [{ label: 'Run it', call }, ...(offer ? [{ label: offer.label, call, ahead: offer.ahead }] : []), { label: 'No', call: null }], 'proposal', { ownerOnly: true });
  // (kept under the yes button's own id, when one was made: no button, no record, and nothing to press)
  workRecord(call.args, { spark: node.id, command, dir, wall: shown.wall, sums: scripts.sums, unread: scripts.unread || null, at: Date.now() });
  return out;
}

// A change on a Spark (run, 21-work.mjs): not done, at once, or asked.
async function workChange(node, command, sorted, viewer, ctx, dir = RUNNER_DIR, widen = {}) {
  whoMayLook(viewer, ctx);
  const at = sparkName(node);
  // (Spark 2, a brain Spark, root, the root helper named, a pause: the runner's own words, 21-runner.mjs)
  runnerNever(node, sorted, ctx);
  if (sorted.class === 'notdone') throw new HttpError(403, `Not done: ${sorted.why}`);
  if (sorted.class === 'lockout') throw new HttpError(403, `Nothing ran: a change that can lock you out of ${at} waits for the lock-out net (a later build), which puts it back unless you confirm it. ${sorted.why}`);
  // (which folders at the top of the home it names are there now: writing inside one isn't at the top, R63. A look that
  // fails stops here: "none is there" would widen the wall)
  const topDirs = await runnerTopDirs(node, sorted);
  if (!topDirs) throw new HttpError(503, `Which folders at the top of the home it names are there on ${at} couldn’t be read, so nothing was ${ctx.button ? '' : 'asked or '}run.`);
  // The owner's yes, pressed (on the page, or in the paired Telegram chat while approvals from there are on): it runs
  // as its button showed it, by the ask's record under that button's id, or it is asked again.
  if (ctx.button && ctx.ownerConfirmed) {
    const was = workAsks.get(String(ctx.pressed || ''));
    workAsks.delete(String(ctx.pressed || ''));
    const again = why => workAsk(node, command, sorted, viewer, { ...ctx, button: false, ownerConfirmed: false }, `${why}, so that yes was void`, dir, widen, topDirs);
    if (!was || was.spark !== node.id || was.command !== command || was.dir !== dir) return again('the ask that button answered isn’t known here any more');
    const wall = workWallLines(node, command, sorted, dir, widen, topDirs).wall;
    if (wall !== was.wall) return again(`it would run ${WORK_WALLS[wall]} now, and you were asked for it ${WORK_WALLS[was.wall]}`);
    if (!was.unread && Object.keys(was.sums).length) {
      const now = await workScripts(node, sorted.scripts, dir, command);
      if (now.unread) throw new HttpError(503, `The scripts it runs couldn’t be read again on ${at} (${now.unread}), so nothing ran.`);
      if ([...new Set([...Object.keys(was.sums), ...Object.keys(now.sums)])].some(p => was.sums[p] !== now.sums[p])) return again('a script it runs changed after you were asked');
    }
    return runChange(node, command, viewer, ctx, { asked: true, dir, widen, topDirs });
  }
  const listeners = await workListeners(node);
  let why = hostClear(node, sorted, viewer, ctx, dir, command, widen, topDirs, listeners), gate = null;
  // (asked only for the request's own rules, and a go-ahead of this task covers it: it runs, its record says so)
  if (why && aheadCover(node, command, sorted, viewer, ctx, dir, topDirs, widen) && !hostClear(node, sorted, viewer, ctx, dir, command, widen, topDirs, listeners, true)) [why, gate] = [null, 'go-ahead'];
  // (Sparkie's own call runs at once only while its brain is checked: the rail, 21-brain-rail.mjs, R52; run is a
  // lookup to runAction, so the ladder asks the rail itself, last, as it looks at Sparkie's model)
  if (!why && ctx.via === 'sparkie') { const rail = await brainRail(); if (!rail.checked) why = `Sparkie asks before every change: ${rail.why}`; }
  if (!why) return runChange(node, command, viewer, gate ? { ...ctx, gate } : ctx, { dir, widen, topDirs });
  // The owner's own call with no chat to show a button in (the API): nothing is asked there. A change the runner
  // won't run unasked gets its own words; any other reason is said.
  if (!ctx.conv && !ctx.onQuestion && !ctx.agent && !ctx.agentId && !viewer?.agentKey) {
    const w = runnerWiden(node, command, widen, sorted);
    if (sorted.class !== 'change' || runnerProtected(sorted, dir).length || runnerOutside(sorted, command, dir, topDirs).length || w.fleet || w.gpu || w.home) return runChange(node, command, viewer, ctx, { dir, widen, topDirs });
    throw new HttpError(409, `Not run at once: ${why}. Ask for it in your chat with Sparkie, where it is asked with a button. Nothing ran.`);
  }
  return workAsk(node, command, sorted, viewer, ctx, why, dir, widen, topDirs);
}
