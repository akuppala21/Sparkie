/* ───────── the ladder: a change on a Spark at once, asked first, or not done (A7c) ───────── */
// Area: features        Rules: R61, R55, R54, R52        Tests: ladder.test.mjs
// Owns: none
// Timers: none        Wakes: none
// run hands every command the sorter does not call a look to workChange (21-work.mjs). Code alone decides, from the
// sorter's answer (20-sort.mjs) and the request (design A 2.5 and 2.8; the one page, section 4). Not done, whatever is
// said: what the sorter calls not done; a change on a Spark holding the brain; sudo in a command (answered "set root":
// root is run's root: true, 21-root.mjs). Handed on: a change on Spark 2 to hubChange (21-hub.mjs: always asked, inside
// the net) and the lock-out class to netChange (21-net.mjs: done only as root, so answered "set root"); a write_file or a
// command given a key is refused in both.
// At once, through the runner (21-runner.mjs: copies first, inside the run wall, starting in ~/work): a plain change when
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

// The names a command gives that a later message's follow-up may have taken from what was read (P-5's "the message
// before"): the dangerous ask's things (addresses, whole paths, packages: dangerThings) and each word of the command
// with a / or a . inside (a file, a relative path, a host), never a program run by its bare name nor an option; and the
// folder it starts in, when it isn't the usual one. Each name with its other spellings: a path without ~/, $HOME/ or the
// home folder before it, and a file's own name. A bare word (a service's or a process's name) is not looked for.
function workNames(node, command, dir) {
  const home = `/home/${node?.user || CONFIG.user}/`, out = new Map();
  const forms = p => {
    let rel = p.replace(/^(?:~|\$HOME|\$\{HOME\})\//, '').replace(/^(?:\.\/)+/, '');
    if (rel.startsWith(home)) rel = rel.slice(home.length);
    const base = rel.split('/').filter(Boolean).pop() || '';
    return [...new Set([p, rel, /[A-Za-z0-9_-]\.[A-Za-z0-9]/.test(base) ? base : ''])].filter(f => f.length >= 3);
  };
  const add = w => { const f = forms(w); if (f.length && !out.has(w)) out.set(w, f); };
  for (const t of dangerThings(command)) add(t);
  // (the first word of each command, past NAME=value, is its program; the word after < or > is a file)
  let program = true;
  for (const t of shellWords(String(command || ''))) {
    if (t.op) { program = !['<', '>'].includes(t.op); continue; }
    const set = /^[A-Za-z_]\w*=/.test(t.w), first = program && !set;
    if (!set) program = false;
    const w = t.w.replace(/^[A-Za-z_]\w*=/, '').replace(/^--?[\w-]+=/, '');
    if ((first && !w.includes('/')) || w.startsWith('-') || !/[A-Za-z]/.test(w) || /[\s$`]/.test(w.replace(/^\$(?:HOME|\{HOME\})\//, ''))) continue;
    if (w.includes('/') || /[A-Za-z0-9_-]\.[A-Za-z0-9]/.test(w)) add(w);
  }
  if (dir && dir !== RUNNER_DIR && dir !== '~') add(String(dir));
  return [...out.values()].slice(0, 32);
}
// 3 across this chat's messages (contract 8.5, "a command quoted from an earlier answer counts as read"): a change that
// names what an earlier read or an earlier answer of Sparkie's holds, and no message of the owner's in this chat does, is
// asked; a name the owner typed in any of their messages here is theirs. Why, or null. (chatEarlier, 14-chats.mjs;
// cameFrom, 20-came-from.mjs, the dangerous ask's line 4, searched the same way.)
function workEarlier(node, ctx, command, dir) {
  const conv = ctx?.conv ? chatData().conversations.find(c => c.id === ctx.conv) : null;
  if (!conv) return null;
  const own = (conv.messages || []).filter(m => m.role === 'user' && !m.from && !m.auto).map(m => String(m.content || '')).join('\n').toLowerCase();
  const theirs = workNames(node, command, dir).filter(forms => !forms.some(f => dangerWhole(own, f.toLowerCase())));
  if (!theirs.length) return null;
  const e = chatEarlier(conv, ctx);
  if (!e.reads.length && !e.answers.length) return null;
  const all = [...new Set(theirs.flat())], from = cameFrom(all, [], e.reads, e.answers);
  const line = from.lines[0];
  if (line) {
    const name = all.filter(f => line.startsWith(`${f}: `)).sort((a, b) => b.length - a.length)[0] || '';
    return `it names ${dangerPlain(name, 120)}, which came from ${line.slice(name.length + 2)}, not from your words`;
  }
  if (from.cut) return `it names ${dangerPlain(theirs[0][0], 120)}, which isn’t in your words, and what was read earlier in this chat couldn’t all be searched`;
  return null;
}

// Whether a change runs at once (design A 2.5): why not, or null when it may. 1, the owner (their chats, Telegram, the
// API; never an agent). 4, the sorter calls it a plain change, one that reaches no protected folder (nor starts in
// one), would not fail inside the run wall (runnerOutside) and needs neither another Spark nor the GPU (runnerWiden).
// 2, in a chat: the owner's words ask for work (CHANGE_WORDS' kind `work`) and name the Spark. 3, nothing read from
// outside since, in the turn or its task, and no name taken from an earlier message's read or answer (workEarlier).
// (5, the Spark's claim, is the runner's: taken, it answers so.) The first that
// fails is the reason the button gives. file: write_file's (its path's words name no Spark, A7d). ahead (21-ahead.mjs):
// 'task', a go-ahead of this task covers it, which stands in for 2 and 3; 'always', a standing entry, which stands in for
// the naming of the Spark and for 3.
function hostClear(node, sorted, viewer, ctx, dir = RUNNER_DIR, command = '', widen = {}, topDirs = [], listeners = null, file = false, ahead = false) {
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
  if (ahead === 'task') return null;
  if (ctx.via === 'sparkie') {
    const i = ctx.intent || {}, has = (l, k) => Array.isArray(l) && l.includes(k);
    if (!has(i.asked, 'work') || has(i.negated, 'work') || has(i.mixed, 'work')) return 'your words don’t ask for a change';
    if (ahead) return null;
    if (!tokensOf(ctx.said || ctx.request || '').has(node.id)) return `your words don’t name ${sparkName(node)}`;
    if (ctx.readOutside) return 'Sparkie read text from outside first';
    const earlier = workEarlier(node, ctx, command, dir);
    if (earlier) return earlier;
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

// Where a command reads each script it runs, only where that can be told (the A7c review, fix 1; S-6), from the
// command's words as bash splits them (shellWords, 21-work.mjs: quotes and backslashes taken off, so c\d and c''d are
// cd): a script named as written (no $, quote, pattern or ..) is read from the folder the change starts in (dir) when
// no word is cd, pushd or popd, none holds one (sh -c '…'), and no program is told another folder (-C, --directory,
// --chdir, --cwd, --prefix, --git-dir, --work-tree, -execdir: git -C proj, make -C proj); with one cd that is the very
// first words, `cd <plain folder> &&`, from that folder; a ~ or whole path as it is. Anything else pins nothing: the
// button says the script's text isn't pinned by a hash.
const WORK_PLAIN = /^[^\s$`'"\\*?[\]{}]+$/, workPlainName = t => WORK_PLAIN.test(t) && !t.startsWith('-') && !/(?:^|\/)\.\.?(?:\/|$)/.test(t);
const WORK_MOVES = /^(?:cd|pushd|popd)$/, WORK_TOLD = /^(?:-C|--(?:directory|chdir|cwd|prefix|git-dir|work-tree)(?:=|$)|-(?:exec|ok)dir$)/;
function workScriptPaths(scripts, dir, command) {
  const toks = shellWords(String(command)), words = toks.filter(t => t.w !== undefined).map(t => t.w), ok = t => t.startsWith('/') || t === '~' || t.startsWith('~/');
  const moves = words.filter(w => WORK_MOVES.test(w)).length, inside = words.some(w => !WORK_MOVES.test(w) && /(?:^|[^\w./-])(?:cd|pushd|popd)(?:[^\w./-]|$)/.test(w));
  const first = moves === 1 && toks[0]?.w === 'cd' && typeof toks[1]?.w === 'string' && toks[2]?.op === '&&' ? toks[1].w : null;
  const base = inside || words.some(w => WORK_TOLD.test(w)) ? null : moves === 0 ? dir : first !== null && workPlainName(first) ? (ok(first) ? first : `${dir}/${first}`).replace(/\/+$/, '') : null;
  const paths = [], unpinned = [];
  for (const s of scripts) {
    if (!workPlainName(s.replace(/^(?:\.\/)+/, '')) || (!ok(s) && base === null)) { unpinned.push(s); continue; }
    const p = ok(s) ? s : `${base}/${s.replace(/^(?:\.\/)+/, '')}`;
    if (!paths.includes(p)) paths.push(p);
  }
  // (past the eighth a script is neither read nor pinned: said so, as any other not pinned is)
  return { paths: paths.slice(0, WORK_SCRIPTS), unpinned: [...unpinned, ...paths.slice(WORK_SCRIPTS)] };
}
// The scripts a command runs, hashed on the Spark now where it reads them, through the root helper's look (R42): what
// the look wall hides reads as not there, and a key's name is refused before it, so a hash never says more of a file
// than a look may. With each hash, the script's text as that look read it (its first WORK_TEXT bytes; for a script no
// longer than that the hash is of those very bytes), and how many lines it has, for the button (workScriptLines).
// {sums: {path: SHA-256, or null when it isn't a file there}, texts: {path: {text, lines, whole}}, unpinned (the names
// not pinned: past the eighth, reached through a link, or one the root helper can't copy)}; or, when the look gave no
// answer of its own (no helper, walls not proven, refused, the Spark silent), no sums and unread: why. Every script
// named is in sums or unpinned, past the eighth too.
const WORK_TEXT = 256 * 1024, WORK_TEXT_LINES = 40, WORK_SCRIPT_MAX = 4 * 1024 * 1024;
// Whether the root helper can pin a script (its --script, deploy/spark-console-root): ~/ and a file, or a whole path in
// the owner's home, each part of A-Z a-z 0-9 . _ @ + -, no . or .. part.
function workHelperPins(path, node = null) {
  const p = String(path), home = `/home/${node?.user || CONFIG.user}`;
  const rest = p.startsWith('~/') ? p.slice(2) : p.startsWith(`${home}/`) ? p.slice(home.length + 1) : null;
  return rest !== null && rest.split('/').every(x => /^[A-Za-z0-9._@+-]+$/.test(x) && x !== '.' && x !== '..');
}
async function workScripts(node, scripts, dir = RUNNER_DIR, command = '', sorted = null) {
  const named = (scripts || []).filter(s => typeof s === 'string' && s && !/[\x00-\x1f]/.test(s));
  const list = named.slice(0, WORK_SCRIPTS), past = named.slice(WORK_SCRIPTS);
  if (!list.length) return { sums: {}, texts: {}, unpinned: past, written: [] };
  // (one this same command writes is neither read nor pinned: what is there now may not be what runs, workWrittenFirst)
  const r = workScriptPaths(list, dir, command), written = r.paths.filter(p => workWrittenFirst(sorted, p));
  const paths = r.paths.filter(p => !written.includes(p)), unpinned = [...r.unpinned, ...past];
  if (!paths.length) return { sums: {}, texts: {}, unpinned, written };
  // (a look starts in the home: a ~ path is read from there)
  const word = s => q(s === '~' ? '.' : s.startsWith('~/') ? `./${s.slice(2)}` : s);
  // (a file reached through a link, anywhere in its path, is "L": the root helper copies no such script, R72)
  const look = paths.map((s, i) => `if [ -f ${word(s)} ] && { [ -L ${word(s)} ] || [ "$(realpath -e -- ${word(s)} 2>/dev/null)" != "$(realpath -s -- ${word(s)} 2>/dev/null)" ]; }; then echo 'h${i} L'; elif [ -f ${word(s)} ] && h=$(sha256sum < ${word(s)} 2>/dev/null) && n=$(wc -l < ${word(s)}) && z=$(stat -c %s -- ${word(s)}); then printf 'h${i} %s %s %s\\n' "\${h%% *}" "\${n// /}" "$z"; head -c ${WORK_TEXT} -- ${word(s)} | base64 -w0; echo; else echo 'h${i} -'; fi`).join('; ');
  const a = helperAnswer(await helperCall(node, 'look', { command: look, seconds: LOOK_SECONDS, words: paths, walks: [] }));
  const got = new Map([...String(a.kind === 'ran' && !a.cut ? a.output : '').matchAll(/^h(\d+) (?:([0-9a-f]{64}) (\d+) (\d+)\n([A-Za-z0-9+/=]*)|-|(L))$/gm)].map(m => [Number(m[1]), m[2] ? { sha: m[2], lines: Number(m[3]), size: Number(m[4]), bytes: Buffer.from(m[5], 'base64') } : m[6] ? 'linked' : null]));
  if (a.kind !== 'ran' || paths.some((_, i) => !got.has(i))) return { sums: {}, texts: {}, unpinned, written, unread: WORK_UNREAD[a.kind] || 'the look didn’t answer the way it does' };
  const sums = {}, texts = {};
  for (const [i, s] of paths.entries()) {
    const g = got.get(i);
    if (!g) { sums[s] = null; continue; }
    if (g === 'linked') { unpinned.push(s); continue; }
    // (read whole: the hash is of the bytes read, so the text shown is what was hashed; one that changed between the
    // two reads of the look is said not pinned)
    const whole = g.bytes.length < WORK_TEXT;
    if (whole && createHash('sha256').update(g.bytes).digest('hex') !== g.sha) { unpinned.push(s); continue; }
    // (only what the root helper can copy is pinned: a file in the owner's home, a plain path, 4 MB at most)
    if (!workHelperPins(s, node) || g.size > WORK_SCRIPT_MAX) { unpinned.push(s); continue; }
    sums[s] = g.sha;
    texts[s] = { text: g.bytes.toString('utf8'), lines: g.lines, whole };
  }
  return { sums, texts, unpinned, written };
}
// A script this same command writes, fetches or unpacks (curl -o i.sh … && bash i.sh; cat > f <<EOF && bash f;
// git clone … repo && bash repo/install.sh): the sorter's placed, overwrites or wide hold it, or a folder above it. What
// is there as the owner is asked may not be what runs, so it is neither read nor shown, nor pinned (the helper's
// read-only copy would also stop the command writing it), and a key is refused for it.
function workWrittenFirst(sorted, path) {
  const at = [...(sorted?.placed || []), ...(sorted?.overwrites || []), ...(sorted?.wide || [])].filter(x => typeof x === 'string' && x).map(x => x.replace(/\/+$/, '') || '/');
  return at.some(w => path === w || path.startsWith(w === '/' ? '/' : `${w}/`));
}
const workWrittenLine = p => `It runs ${p}, which this same command writes, so what runs may not be there yet as you’re asked: its text can’t be shown or pinned, and a key is refused for it.`;
const WORK_WRITTEN_KEY = 'Not run: it runs a script this same command writes, so its text can’t be shown or pinned before you say yes, and a key goes only to code you are shown. Write or download the script first, then ask to run it with the key. Nothing was asked or run.';
// What the press does with a pinned script (R72), said once on the run's own asks (not Spark 2's, which the net runs:
// 21-hub.mjs): read again after the Spark's claim is taken, then checked once more by the unit's own first lines
// (runnerPins, 21-runner.mjs), and run by its path.
const workPinLines = scripts => (Object.values(scripts?.sums || {}).some(h => typeof h === 'string') ? ['Each script runs from the root helper’s own copy of it, read at your press and bound over its path for the whole run: if that copy hasn’t the hash shown here, nothing runs and you are asked again.'] : []);
// Each pinned script's text on a plain button (P-5): its first WORK_TEXT_LINES lines as the ask's look read them, each
// after "│ " (as a command's own lines are, workCommandText), then how many more; the whole text as read is one journal
// record, which the button names (workScriptRecord). Masked as every ask is.
function workScriptText(scripts) {
  const out = [], h = scripts?.sums || {};
  for (const [p, t] of Object.entries(scripts?.texts || {})) {
    const lines = t.text.split(/\r\n|[\r\n\v\f\x85\u2028\u2029]/);
    if (lines.at(-1) === '') lines.pop();
    const more = Math.max(0, (t.whole ? lines.length : t.lines) - WORK_TEXT_LINES), whole = t.whole ? '' : `, read to its first ${WORK_TEXT / 1024} KB`;
    out.push(`The script ${p} as read for this ask (${t.lines} line${t.lines === 1 ? '' : 's'}${whole}, SHA-256 ${String(h[p]).slice(0, 12)}…), each line after │:`,
      ...lines.slice(0, WORK_TEXT_LINES).map(l => `│ ${l.slice(0, 300)}`),
      ...(more ? [`│ … and ${more} more line${more === 1 ? '' : 's'}${scripts.record ? `: all of it as read is record ${scripts.record} (recall {"id":"${scripts.record}"} reads it)` : ''}.`] : []));
  }
  return out;
}
// The scripts' texts as the ask read them, kept whole in one journal record (masked as a look's output is), so the
// button can name it; its id on scripts.record. None when no script's text was read.
function workScriptRecord(node, ctx, scripts) {
  const texts = Object.entries(scripts?.texts || {});
  if (!texts.length) return scripts;
  const id = journal('cmd', { act: 'run', where: 'host', class: 'look', gate: 'ask', chat: ctx.chat || null, via: ctx.via || null, actor: ctx.actor || null,
    args: { spark: node.id, command: `(the scripts read for an ask) ${texts.map(([p]) => p).join(' ')}`.slice(0, 600) }, ok: true, outcome: 'ran', sub: jSub(node.id) },
  texts.map(([p, t]) => `--- ${p} (SHA-256 ${scripts.sums[p]})${t.whole ? '' : `, its first ${WORK_TEXT / 1024} KB`} ---\n${lookClean(t.text)}`).join('\n'));
  return id ? { ...scripts, record: id } : scripts;
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
// spec: write_file's (21-write.mjs), whose plain write widens nothing by its words.
function workWallLines(node, command, sorted, dir = RUNNER_DIR, widen = {}, topDirs = [], spec = null) {
  const walls = runnerWalls(sorted, command, dir, topDirs), wide = runnerWiden(node, spec ? '' : command, widen, sorted);
  const wideLines = [wide.fleet && RUNNER_WIDE.fleet, wide.home && RUNNER_WIDE.home, wide.gpu && RUNNER_WIDE.gpu].filter(Boolean);
  return { walls, wall: walls.open.length ? 'open' : walls.home.length ? 'home' : 'plain',
    outside: walls.open.length ? [...walls.open, ...walls.home].join('; ') : null,
    lines: [...(walls.open.length ? [RUNNER_OPEN_HOLDS] : walls.home.length ? [...runnerHomeLines(node, walls, wide), ...wideLines] : wideLines),
      ...(wide.internet ? [RUNNER_WIDE.internet] : [])] };
}
// Each script's hash, or why it has none.
function workScriptLines(scripts) {
  const { sums = {}, unpinned = [], unread = null, written = [] } = scripts, not = n => `It runs ${n}; its text isn’t pinned by a hash, so a change to it after this ask isn’t seen.`;
  const first = written.slice(0, 4).map(p => workWrittenLine(String(p).slice(0, 120)));
  if (unread) return [`The scripts it runs couldn’t be read here (${unread}), so none is hashed: a change to one after this ask isn’t seen.`, ...first];
  return [...Object.entries(sums).map(([p, h]) => (h ? `It runs ${p} (SHA-256 ${h.slice(0, 12)}…); what that script reads later isn’t checked.` : not(p))), ...unpinned.slice(0, 4).map(n => not(n.slice(0, 120))), ...first];
}

// The folder a change starts in, as run took it (~ or a folder under it, no . or .. part: 21-work.mjs), on both asks.
const workStartsIn = dir => `It starts in ${dir}.`;
// The button's words, built by code: the exact command, the Spark, why it is asked, the wall it runs in after the yes
// and what that lets it do, the folder it starts in, what put-back covers, what Sparkie read before proposing it, each
// script's hash.
// (write_file, A7d: the path and the lines that change, old and new, design A 2.14 row 7; the file's own hash, no script;
// its path is whole, so no folder line)
// more: code's own lines after these (a command given keys, 21-run-keys.mjs), kept above a framed command.
function workLabel(node, command, sorted, why, ctx, scripts, dir = RUNNER_DIR, shown = workWallLines(node, command, sorted, dir), spec = null, more = '') {
  const at = sparkName(node), reads = (ctx.reads || []).slice(-4).map(r => r.label);
  const most = ctx.long ? longHeld(ctx.long.minutes, 'asked').minutes : 0;
  // (the folder it starts in: `rm -rf build` reads the same in ~/work as in a project the owner cares about)
  const lines = [`Asked because ${why}.`,
    ...(most ? [`It runs as an operation for up to ${most} minute${most === 1 ? '' : 's'}; its result is posted here when it ends.`] : []),
    ...(shown.outside ? [`Runs outside the plain wall: ${shown.outside}.`] : []), ...shown.lines, ...(spec ? [] : [workStartsIn(dir)]),
    sorted.scripts?.length || !(sorted.placed?.length || sorted.wide?.length) ? RUNNER_NOT_COVERED : 'The files it names are copied first, so undo can put them back. Anything else it writes isn’t covered by put-back.',
    ...(reads.length ? [`Sparkie read this before proposing it: ${reads.join('; ')}.`] : []), ...workKeyLines(command, spec), ...workUnshownLines(sorted), ...workUnknownLines(sorted), ...workScriptLines(scripts), ...(spec ? [] : workPinLines(scripts)), ...(spec ? [] : workScriptText(scripts))];
  return spec ? `${[...spec.lines(at), ...lines].join('\n')}${more}` : workCommandText(`Run this on ${at}?`, command, lines, more);
}
// The text of a command's button, built by code: its first line, the command, code's lines (S-4). One function for both
// Sparks' buttons: Spark 2's (21-hub.mjs, hubCommandLines) reads the same and can call this one. A plain one-line
// command is on its own "$ " line; one with a line break, or a sign that doesn't show (a control, format, unassigned
// or private sign, a line or paragraph break, a space but the plain one), is said in how many lines it has, each after
// "│ ", so no line of it can pass for one of the button's own. more: text of code's after its lines.
const WORK_UNPLAIN = /(?!\t)[\p{Cc}\p{Cf}\p{Cn}\p{Co}\p{Zl}\p{Zp}]|(?! )\p{Zs}/u;
function workCommandText(head, command, lines, more = '') {
  const c = String(command), parts = c.split(/\r\n|[\r\n\v\f\x85\u2028\u2029]/);
  const shown = parts.length === 1 && !WORK_UNPLAIN.test(c) ? [head, `$ ${c}`]
    : [`${head} ${parts.length === 1 ? 'Its command holds a sign that doesn’t show; it is shown after │:' : `Its command has ${parts.length} lines, each shown after │:`}`, ...parts.map(l => `│ ${l}`)];
  return `${[...shown, ...lines].join('\n')}${more}`;
}
// What it runs that the command doesn't show, by the sorter's own words (unshown: a script fed by a redirect or a pipe,
// -m module, a build tool's or a package's own scripts, start-file variables): one line on either ask, nothing when the
// sorter says nothing. Never a reason to ask by itself.
function workUnshownLines(sorted) {
  const u = sorted?.unshown;
  if (!u) return [];
  const w = typeof u === 'string' ? u.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim().replace(/\.$/, '').slice(0, 200) : '';
  return [`What runs is in a file this button doesn’t show${w ? ` (${w})` : ''}.`];
}
// A program the sorter doesn't know (its unknownProgram): one line on either ask, nothing when the field is absent.
function workUnknownLines(sorted) {
  const n = typeof sorted?.unknownProgram === 'string' ? sorted.unknownProgram.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').trim().slice(0, 80) : '';
  return n ? [`It runs “${n}”, a program the sorter doesn’t know, so what it does isn’t read: only you can judge it.`] : [];
}
// On the dangerous ask, whose lines are one line each: where each script's text as read is kept (workScriptRecord).
const workScriptRecordLines = scripts => (scripts?.record ? Object.entries(scripts.texts || {}).map(([p, t]) => `The script ${p}, ${t.lines} line${t.lines === 1 ? '' : 's'}: its text as read for this ask is record ${scripts.record} (recall reads it).`) : []);
// A change that names a key file (S-8): asked, the button saying so, and what it prints never shown back (21-runner.mjs).
const workKeyed = command => lookWords(String(command)).words.find(keyWord) || null;
const workKeyLines = (command, spec = null) => { const k = spec ? null : workKeyed(command); return k ? [`It names a key file (${k.slice(0, 120)}): what it prints isn’t shown back or kept, and the file’s content never is.`] : []; };
// more: what the runner found it can't do unasked (workAfter): bare, the protect folders whose link leads to no folder,
// which the press then runs without; gone, the files it removes or overwrites that couldn't be copied first ({path,
// why}): the dangerous ask's delete, which names each.
async function workAsk(node, command, sorted, viewer, ctx, why, dir = RUNNER_DIR, widen = {}, topDirs = [], spec = null, keys = [], more = {}) {
  // (what is shown is what runs: nothing hidden, nothing a mask would hide; write_file's own lines mark what they hide)
  if (!spec && maskSecrets(command) !== command) throw new HttpError(400, 'It holds something shaped like a key or password, so it can’t be shown whole on a button: give the key by its name. Nothing was asked or run.');
  // (write_file's: the file's own SHA-256 as it was read for this ask, so a press after it changed is void)
  const scripts = spec ? { sums: spec.sums } : workScriptRecord(node, ctx, await workScripts(node, sorted.scripts, dir, command, sorted)), shown = workWallLines(node, command, sorted, dir, widen, topDirs, spec);
  // (a key goes only to a script pinned by its hash, R51: one whose text isn't, or couldn't be read, is refused)
  if (keys.length && scripts.written?.length) throw new HttpError(409, WORK_WRITTEN_KEY);
  if (keys.length && (scripts.unread || scripts.unpinned?.length)) throw new HttpError(409, RUNKEY_SCRIPT_UNPINNED);
  const call = spec ? { action: 'write_file', args: spec.args }
    : { action: 'run', args: { on: node.id, command, ...(dir !== RUNNER_DIR ? { dir } : {}), ...(widen.fleet === true ? { fleet: true } : {}), ...(widen.gpu === true ? { gpu: true } : {}),
      ...(ctx.long ? { minutes: ctx.long.minutes } : {}), ...(keys.length ? { keys } : {}) } };
  const dangerous = [...new Set([...(sorted.kinds || []).filter(k => ['delete', 'brain'].includes(k)), ...(more.gone?.length ? ['delete'] : [])])];
  // (and, when it may be, "Run it, and don't ask again for this task: …", 21-ahead.mjs: its button shares the call, so it
  // keeps the ask's record too)
  // (never for a write_file, nor for a command given a key: those are always asked)
  const offer = dangerous.length || spec || keys.length ? null : aheadOffer(node, command, sorted, viewer, ctx, dir, topDirs, widen);
  // (the dangerous ask says the same of its wall, what it reaches and its scripts; its yes binds the wall, R54)
  // (the sorter's reason is on the ask for each kind: a delete's on line 3, one outside the wall on its own line, the
  // brain's (it may be Spark 2, a protected container's id) on a line of its own when neither already says it)
  const sorterWhy = String(sorted.why || '').replace(/\s*That cannot be put back\.?$/, ''), whyShown = (dangerous.includes('delete') && !more.gone?.length) || String(shown.outside || '').includes(sorterWhy.replace(/\.$/, ''));
  const out = dangerous.length ? dangerAsk(viewer, ctx, { kinds: dangerous, where: node.id, shown: spec ? spec.file : { command }, call,
    facts: { ...(dangerous.includes('delete') ? { gone: { what: more.gone?.length ? `it removes or overwrites ${more.gone.length === 1 ? 'a file' : `${more.gone.length} files`} that couldn’t be copied first` : sorterWhy } } : {}),
      ...(shown.outside ? { outsideWall: shown.outside } : {}), wall: shown.wall, lines: [...(dangerous.includes('brain') && sorterWhy && !whyShown ? [`Why it is asked: ${sorterWhy}`] : []), ...workGoneLines(more.gone), ...shown.lines, ...(spec ? [] : [...workKeyLines(command), ...workUnshownLines(sorted), ...workUnknownLines(sorted), ...workScriptLines(scripts), ...workPinLines(scripts), ...workScriptRecordLines(scripts), workStartsIn(dir)])],
      ...(ctx.long ? { minutes: longHeld(ctx.long.minutes, 'asked').minutes } : {}) } })
    // (write_file's lines the button shows whole: Telegram's ask and the page's copy; the records keep them masked)
    : question(viewer, ctx, workLabel(node, command, sorted, why, ctx, scripts, dir, shown, spec, runKeysLabel(node, command, keys, sorted)),
      [{ label: 'Run it', call }, ...(offer ? [{ label: offer.label, call, ahead: offer.ahead }] : []), ...(offer?.always ? [{ label: offer.always.label, call, always: offer.always }] : []),
        { label: 'No', call: null }], 'proposal', { ownerOnly: true, ...(spec?.whole ? { whole: spec.whole(sparkName(node)) } : {}) });
  // (kept under the yes button's own id, when one was made: no button, no record, and nothing to press)
  workRecord(call.args, { spark: node.id, command: spec?.key ?? command, dir, wall: shown.wall, sums: scripts.sums, unread: scripts.unread || null, bare: more.bare || [],
    gone: more.gone?.length ? more.gone.map(x => String(x.path)) : dangerous.includes('delete') ? true : null, at: Date.now() });
  return out;
}

// Whether a press may run what the sorter says now: a delete it can't see, or the brain's names (the dangerous kinds),
// only from the dangerous ask's own press, which carries its two digits (ctx.danger, runChoice, 14-chats.mjs).
const workPressCovers = (sorted, ctx) => !(sorted?.kinds || []).some(k => ['delete', 'brain'].includes(k)) || Boolean(ctx?.danger);
// An installer run from an address as it is fetched (curl … | sh, wget -O- … | bash, bash <(curl …), sh -c "$(curl …)"):
// no ask can show or pin what it runs, so it is answered how to do it instead (P-5): download it to a file, one change;
// then run the file, asked with its text shown and pinned. Read from the command's words as bash splits them: a fetcher
// whose pipeline ends in a shell or an interpreter (past sudo, env and their kin), or a shell or an interpreter handed a
// fetcher's output by <( … ), $( … ) or backticks. A pipe into an interpreter handed its code another way (-c, -m, -e,
// a file) hands it data (curl … | python3 -m json.tool), and is no installer.
const WORK_FETCHERS = /^(?:curl|wget|fetch|aria2c)$/, WORK_INTERP = /^(?:(?:ba|da|z|k|a|mk|fi)?sh|python[\d.]*|perl|ruby|node|php|source|\.)$/;
const WORK_FETCHRUN = 'Not run: it runs code it fetches from the network as it runs, so no ask could show you that code or pin it. Download it to a file first (for example: curl -fsSL -o install.sh <address>), then run that file: the download is one change, and the run is asked with the file’s text shown and pinned. Nothing ran.';
function workFetchRun(command) {
  const t = shellWords(String(command)), base = w => String(w).split('/').pop(), word = j => t[j] && t[j].w !== undefined;
  let fetched = false;
  for (let i = 0; i < t.length; i++) {
    const x = t[i];
    if (x.op && x.op !== '|') fetched = false;
    if (word(i) && WORK_FETCHERS.test(base(x.w))) fetched = true;
    if (x.op === '|' && fetched) {
      let j = i + 1;
      while (word(j) && (/^(?:sudo|doas|env|nice|nohup|time|command|exec|stdbuf|ionice|timeout)$/.test(base(t[j].w)) || /^-|^[A-Za-z_]\w*=|^\d+[smhd]?$/.test(t[j].w))) j++;
      // (an interpreter handed code by -c, -m, -e or a file reads what comes in as data, not code; -s or - reads code)
      if (word(j) && WORK_INTERP.test(base(t[j].w))) {
        let k = j + 1, data = false;
        for (; word(k); k++) if (/^-(?:\w*[cme]\w*)$/.test(t[k].w) && !/^-s$/.test(t[k].w) || (!t[k].w.startsWith('-') && t[k].w !== '-')) { data = true; break; }
        if (!data) return true;
      }
    }
    if (word(i) && WORK_INTERP.test(base(x.w))) {
      if (t[i + 1]?.op === '<' && t[i + 2]?.op === '(' && word(i + 3) && WORK_FETCHERS.test(base(t[i + 3].w))) return true;
      for (let j = i + 1; word(j); j++) if (/(?:\$\(|`)\s*(?:\S*\/)?(?:curl|wget|fetch|aria2c)\b/.test(t[j].w)) return true;
    }
  }
  return false;
}
// A key goes only to code the owner is shown (R51; P-5, A-16's "beside it"): never to a command the sorter says runs
// code it doesn't show (a module run by name, a build tool's or a package's own scripts, a one-liner's file, what a pipe
// hands a shell), but a script it names, which the ask reads, shows and pins (workScripts). The sorter lists every such
// piece that is not a script named as a word (its unpinnable); with an older sorter that has only unshown (the first
// it met), "the file <script>" counts as shown only when that script is one it named.
function workKeyCode(sorted) {
  const list = Array.isArray(sorted?.unpinnable) ? sorted.unpinnable.filter(x => typeof x === 'string' && x)
    : typeof sorted?.unshown === 'string' && !(sorted.scripts || []).some(s => sorted.unshown === `the file ${s}`) ? [sorted.unshown] : [];
  if (!list.length) return;
  const said = list.slice(0, 3).map(u => u.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\.$/, '').slice(0, 120)).join('; ');
  throw new HttpError(409, `Not run: it runs code the command doesn’t show (${said}), and a key goes only to code you are shown before you say yes. Put what it runs in one script, run that script by its name with the key, and ask again. Nothing ran.`);
}
// An agent's change while Spark Console's state, put back from a copy, waits for the owner's look (22-putback.mjs):
// refused in the words every other agent change gets (runAction, 16-actions.mjs), its own call or through Sparkie
// (S-12). run is a lookup to runAction, so the ladder asks this itself; root does too (runCommand). A look is not a
// change and still runs.
function workHeld(viewer, ctx) {
  if ((ctx.agentId || ctx.agent || viewer?.agentKey) && putBackHeld()) throw new HttpError(403, PUTBACK_AGENTS);
}
// A change on a Spark (run, 21-work.mjs): not done, at once, or asked.
// spec (write_file, 21-write.mjs): its own call, key and lines for the button, and what the runner runs in its place
// (as); command is then the plain write the sorter was handed. keys (run's, 21-run-keys.mjs): the names it is given.
async function workChange(node, command, sorted, viewer, ctx, dir = RUNNER_DIR, widen = {}, spec = null, keys = []) {
  whoMayLook(viewer, ctx);
  workHeld(viewer, ctx);
  // (an installer run from an address as it is fetched: download it first, workFetchRun)
  if (!spec && workFetchRun(command)) throw new HttpError(409, WORK_FETCHRUN);
  // (a command given keys: what is never given one comes first, in its own words, 21-run-keys.mjs)
  if (keys.length) runKeysNever(node, command, sorted, ctx, keys);
  const at = sparkName(node);
  // (Spark 2, with its switch on: always asked, inside the net, 21-hub.mjs; off, not done, as below. Never a write_file's
  // plain write nor a command given a key, which the hub would run bare: those are refused there, as below)
  if (node.host === 'local' && HUB_ON && !spec && !keys.length) return hubChange(node, command, sorted, viewer, ctx, dir, widen);
  // (Spark 2, a brain Spark, root, the root helper named, a pause: the runner's own words, 21-runner.mjs)
  runnerNever(node, sorted, ctx);
  if (sorted.class === 'notdone') throw new HttpError(403, `Not done: ${sorted.why}`);
  // (the lock-out class: the net's, 21-net.mjs; with the net switched off (a stand-in fleet's) refused, saying so. Never a write_file's,
  // whose command is only the plain write the sorter was handed, nor one given a key: the net runs a command bare)
  if (sorted.class === 'lockout' && (spec || keys.length)) {
    throw new HttpError(403, NET_ON ? `Nothing ran: a change that can lock you out of ${at} runs only as a plain command inside the lock-out net, never ${spec ? 'as write_file' : 'with a key'}. ${sorted.why}`
      : `Nothing ran: the lock-out net is switched off in this console, and a change that can lock you out of ${at} runs only inside it. ${sorted.why}`);
  }
  if (sorted.class === 'lockout') return netChange(node, command, sorted, viewer, ctx, dir);
  // (which folders at the top of the home it names are there now: writing inside one isn't at the top, R63. A look that
  // fails stops here: "none is there" would widen the wall)
  const topDirs = await runnerTopDirs(node, sorted);
  if (!topDirs) throw new HttpError(503, `Which folders at the top of the home it names are there on ${at} couldn’t be read, so nothing was ${ctx.button ? '' : 'asked or '}run.`);
  if (keys.length) runKeysOutside(runnerWalls(sorted, command, dir, topDirs).open);
  // (then code it runs unseen, workKeyCode: after the walls' own refusal, whose words come first)
  if (keys.length) workKeyCode(sorted);
  // The owner's yes, pressed (on the page, or in the paired Telegram chat while approvals from there are on): it runs
  // as its button showed it, by the ask's record under that button's id, or it is asked again.
  if (ctx.button && ctx.ownerConfirmed) {
    const was = workAsks.get(String(ctx.pressed || ''));
    workAsks.delete(String(ctx.pressed || ''));
    const again = why => workAsk(node, command, sorted, viewer, { ...ctx, button: false, ownerConfirmed: false }, `${why}, so that yes was void`, dir, widen, topDirs, spec, keys);
    if (!was || was.spark !== node.id || was.command !== (spec?.key ?? command) || was.dir !== dir) return again('the ask that button answered isn’t known here any more');
    const wall = workWallLines(node, command, sorted, dir, widen, topDirs, spec).wall;
    if (wall !== was.wall) return again(`it would run ${WORK_WALLS[wall]} now, and you were asked for it ${WORK_WALLS[was.wall]}`);
    // (a press that wasn't the dangerous ask's, of a command the sorter now calls a dangerous kind (the brain's names
    // changed since its plain ask): asked again, as the dangerous ask, as Spark 2's press is, 21-hub.mjs)
    if (!workPressCovers(sorted, ctx)) return again('it now deletes for good or names the brain, which only the dangerous ask, with its two digits, can run');
    // (the Spark's claim first, so nothing else of this console changes it between the scripts' read below and the run;
    // let go just before runChange, which takes it again in this same tick, with nothing awaited between, R72)
    const held = claimSparks([node.id], 'a command Sparkie is running there');
    try {
      if (!was.unread && Object.keys(was.sums).length) {
        // (write_file's: the file as it is read again for this press, 21-write.mjs)
        const now = spec ? { sums: spec.sums } : await workScripts(node, sorted.scripts, dir, command, sorted);
        if (now.unread) throw new HttpError(503, `The scripts it runs couldn’t be read again on ${at} (${now.unread}), so nothing ran.`);
        if ([...new Set([...Object.keys(was.sums), ...Object.keys(now.sums)])].some(p => was.sums[p] !== now.sums[p])) {
          if (keys.length) throw new HttpError(409, RUNKEY_SCRIPT_CHANGED);
          held();
          return await again(spec ? 'the file changed after you were asked' : 'a script it runs changed after you were asked');
        }
      }
    } finally { held(); }
    // (each script's hash, checked once more by the unit's own first lines: runnerPins, 21-runner.mjs)
    const pins = spec ? null : Object.fromEntries(Object.entries(was.sums || {}).filter(([, h]) => typeof h === 'string'));
    return workAfter(await runChange(node, spec?.run ?? command, viewer, ctx, { asked: true, dir, widen, topDirs, as: spec?.as, keys, bare: was.bare || [], gone: was.gone ?? null, pins }), node, command, sorted, viewer, ctx, dir, widen, topDirs, spec, keys);
  }
  const listeners = await workListeners(node);
  let why = hostClear(node, sorted, viewer, ctx, dir, command, widen, topDirs, listeners, Boolean(spec)) || spec?.ask || null, gate = null;
  // (asked only for the request's own rules, and a go-ahead of this task covers it: it runs, its record says so. Never a
  // write_file, nor a command given a key, which is always asked)
  const cover = why && !spec && !keys.length ? aheadCover(node, command, sorted, viewer, ctx, dir, topDirs, widen) : null;
  if (cover && !hostClear(node, sorted, viewer, ctx, dir, command, widen, topDirs, listeners, false, cover.always ? 'always' : 'task')) [why, gate] = [null, cover.gate];
  // (a long command over what runs at once is asked, so the owner's press gives it its time, A6, 21-long.mjs)
  if (!why && ctx.long && ctx.long.minutes > LONG_MOST.atOnce) why = `it may run for ${ctx.long.minutes} minutes`;
  // (a command given a key is always asked, R51: the button names each key and each new place)
  if (!why && keys.length) why = runKeysWhy(node, command, keys, sorted) || 'it is given a key, which is always asked';
  // (Sparkie's own call runs at once only while its brain is checked: the rail, 21-brain-rail.mjs, R52; run is a
  // lookup to runAction, so the ladder asks the rail itself, last, as it looks at Sparkie's model)
  if (!why && ctx.via === 'sparkie') { const rail = await brainRail(); if (!rail.checked) why = `Sparkie asks before every change: ${rail.why}`; }
  if (!why) return workAfter(await runChange(node, spec?.run ?? command, viewer, gate ? { ...ctx, gate } : ctx, { dir, widen, topDirs, as: spec?.as, keys }), node, command, sorted, viewer, ctx, dir, widen, topDirs, spec, keys);
  // The owner's own call with no chat to show a button in (the API): nothing is asked there. A change the runner
  // won't run unasked gets its own words; any other reason is said.
  if (!ctx.conv && !ctx.onQuestion && !ctx.agent && !ctx.agentId && !viewer?.agentKey) {
    const w = runnerWiden(node, spec ? '' : command, widen, sorted);
    if (sorted.class !== 'change' || runnerProtected(sorted, dir).length || runnerOutside(sorted, command, dir, topDirs).length || w.fleet || w.gpu || w.home) return workAfter(await runChange(node, spec?.run ?? command, viewer, ctx, { dir, widen, topDirs, as: spec?.as, keys }), node, command, sorted, viewer, ctx, dir, widen, topDirs, spec, keys);
    throw new HttpError(409, `Not run at once: ${why}. Ask for it in your chat with Sparkie, where it is asked with a button. Nothing ran.`);
  }
  return workAsk(node, command, sorted, viewer, ctx, why, dir, widen, topDirs, spec, keys);
}
// What the runner found it can't do unasked (runChange's asks, 21-runner.mjs), asked in the chat (R61): a protect
// folder whose link leads to no folder there, which after the yes it runs without (bare); files it removes or
// overwrites that couldn't be copied first, the dangerous ask's delete naming each (gone). With no chat to ask in (the
// API, or write_file's own call), the runner's own answer: nothing ran, and why.
async function workAfter(r, node, command, sorted, viewer, ctx, dir, widen, topDirs, spec, keys) {
  if (!r?.asks) return r;
  const { asks, protect, lost, ...said } = r;
  if (spec || (!ctx.conv && !ctx.onQuestion)) return said;
  const c = { ...ctx, button: false, ownerConfirmed: false };
  if (asks === 'protect') return workAsk(node, command, sorted, viewer, c, `${protect} on ${sparkName(node)} is a link that leads to no folder there, so a change can’t get it read-only; after your yes it runs without it`, dir, widen, topDirs, spec, keys, { bare: [protect] });
  // (a script that changed between the press and the unit's start: that yes was void, as at the press)
  if (asks === 'pinned') return workAsk(node, command, sorted, viewer, c, 'a script it runs changed after you were asked, so that yes was void', dir, widen, topDirs, spec, keys);
  if (asks === 'uncopied' && Array.isArray(lost) && lost.length) return workAsk(node, command, sorted, viewer, c, 'what it removes or overwrites couldn’t be copied first', dir, widen, topDirs, spec, keys, { gone: lost });
  return said;
}
// The files the dangerous ask names that can't be put back, each with why it wasn't copied, a line each (the paths
// masked by the ask, as all its lines are).
const workGoneLines = gone => (Array.isArray(gone) && gone.length ? [...gone.slice(0, 6).map(x => `Not copied first, so gone for good: ${x.path} (${x.why}).`), ...(gone.length > 6 ? [`And ${gone.length - 6} more not copied first.`] : [])] : []);
