/* ───────── the dangerous ask: hard to tap by reflex (A10b) ───────── */
// Area: safety        Rules: R54        Tests: danger.test.mjs
// Owns: none
// Timers: none        Wakes: none
// Before root, a lock-out change, an install of Spark Console, a delete that cannot be put back and the brain (design A
// 2.14; contract 8.18), a raiser calls dangerAsk in place of question(). The ask is a message of its own that holds no
// word of the brain's: facts built by code (what and where, whether the owner asked, whether it goes back, what came
// from outside), the exact bytes the press runs in a fixed-width block, then the two digits to type with its own yes.
// One is open at a time in the whole console. The digits live only with the open ask in memory and in its own text
// (the Telegram message; the page's copy, filled in when the owner's page reads the chat): never in chats.json, the
// journal, the audit, a button's label, a tool result or an event. On the page one request carries the press and the
// pair; in the paired Telegram chat the press is answered and the owner's next message there is compared. No, 15
// minutes, the third wrong pair, a restart, a new pairing, /stop in its chat, /pause and a change in what it would run
// close it; /lock and the switch going off close its Telegram side. run's ladder raises one for a risky delete and for
// the brain's names on a compute Spark (21-ladder.mjs, A7c); the rest come with A12, A13, C5 and D12; on the stand-in
// fleet a test raises one through dangerForTest.
const DANGER_KINDS = ['root', 'lockout', 'delete', 'brain', 'install'];
// Each kind's words for line 1, and how it names the place ("on Spark 3", "of Spark 3").
const DANGER_HEAD = { root: ['ROOT', 'on'], lockout: ['CAN LOCK YOU OUT', 'of'], delete: ['DELETES FOR GOOD', 'on'], brain: ['THE BRAIN', 'on'], install: ['INSTALLS SPARK CONSOLE', 'on'] };
// (an ask's life is 15 minutes, every button's, and a third inside ten minutes waits one; the stand-in fleet may shorten
// either, so most tests are not held up by the ones before them)
const dangerEnvMs = (name, ms) => (ALL_LOCAL && /^\d+$/.test(process.env[name] || '') ? Number(process.env[name]) : ms);
const DANGER_MS = dangerEnvMs('SPARK_CONSOLE_DANGER_MS', 15 * 60000), DANGER_LATE_MS = dangerEnvMs('SPARK_CONSOLE_DANGER_LATE_MS', 60000), DANGER_LONG = 300;
const DANGER_READS = 40, DANGER_READ_BYTES = 64 * 2 ** 20, DANGER_FROM_LINES = 8, DANGER_ANSWERS = 20;
// The one open ask; when recent ones were built (the third inside ten minutes is sent a minute late); the buttons of
// asks that closed, so a later press is told so (the newest 200); the ask closed last, for a pair typed after it.
let dangerOpen = null, dangerLastPair = null, dangerRecent = null;
const dangerBuilt = [], dangerGoneIds = new Map();
// An agent's conversation whose ask was just declined, and when: it waits a minute before it may ask again.
const dangerDeclined = new Map(), DANGER_AGENT_WAIT_MS = 60000;
// Text that is not the command: one line, no control or invisible character, cut. Names, labels and facts pass here,
// so nothing from elsewhere can make a line of its own.
const dangerPlain = (s, n = 200) => String(s ?? '').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Co}\p{Cn}\p{Default_Ignorable_Code_Point}\u2800]+/gu, ' ').replace(/\s+/g, ' ').trim()
  .slice(0, n).replace(/[\ud800-\udbff]$/, '');
// The command may hold line breaks, tabs and plain spaces, never another control, format, invisible or unassigned
// character, nor a space that is not a space to the shell: what is shown is what runs.
const DANGER_HIDDEN = /(?![\n\t ])[\p{Cc}\p{Cf}\p{Zs}\p{Zl}\p{Zp}\p{Cs}\p{Co}\p{Cn}\p{Default_Ignorable_Code_Point}\u2800]/u;
const dangerHhmm = t => { const d = new Date(t); return Number.isNaN(d.getTime()) ? '?' : d.toTimeString().slice(0, 5); };
const dangerSha = s => createHash('sha256').update(s).digest('hex');
const dangerSame = (typed, digits) => typeof digits === 'string' && /^\d{2}$/.test(typed) && timingSafeEqual(Buffer.from(typed), Buffer.from(digits));

// Line 1: the kinds and the place, in capitals. A command of two kinds is one ask: "ROOT on Spark 2 · CAN LOCK YOU OUT".
function dangerHead(kinds, where) {
  const place = where ? sparkName(nodeById(where) || { id: dangerPlain(where, 40) }) : 'Spark Console';
  return kinds.map((k, i) => (i ? DANGER_HEAD[k][0] : `${DANGER_HEAD[k][0]} ${DANGER_HEAD[k][1]} ${place}`)).join(' · ');
}
// Line 7, the bytes the press runs: a command; a file's path with its lines that change; a script's text.
function dangerCodeOf(shown) {
  if (typeof shown.script === 'string') return { text: shown.script, before: [`The script's SHA-256 begins ${dangerSha(shown.script).slice(0, 12)}.`] };
  if (typeof shown.path === 'string') {
    const rows = (sign, t) => String(t ?? '').split('\n').filter((l, i, all) => l || i < all.length - 1).map(l => `${sign} ${l}`);
    return { text: [...rows('-', shown.before), ...rows('+', shown.after)].join('\n'), before: [`The file ${dangerPlain(shown.path, 400)}: the lines that change, old (-) and new (+).`] };
  }
  return { text: String(shown.command ?? ''), before: [] };
}
// Line 3: whether it goes back, from typed facts (the net's time; how many files are copied; what would go).
function dangerBack(f) {
  if (f.backAt) return [`It goes back by itself at ${dangerHhmm(f.backAt)} unless you confirm.`];
  if (Number.isInteger(f.kept) && f.kept > 0) return [`Can be put back: ${f.kept} file${f.kept === 1 ? ' is' : 's are'} copied first.`];
  if (f.gone) return [`This cannot be put back: ${dangerPlain(f.gone.what ?? f.gone, 200)}${Number(f.gone.bytes) > 0 ? ` (${sizeWords(Number(f.gone.bytes))})` : ''}.`];
  return [];
}
// Lines 5 and 6: the ways-in files a command names; an install's tree, when it was tested, what differs, what the brain
// reads; why it runs outside the wall.
function dangerMore(f) {
  const out = [];
  if (Array.isArray(f.waysIn) && f.waysIn.length) out.push(`It changes these ways in: ${f.waysIn.slice(0, 8).map(p => dangerPlain(p, 200)).join(', ')}.`);
  if (f.install) {
    const d = Array.isArray(f.install.differs) ? f.install.differs : [];
    out.push(`The tree ${dangerPlain(f.install.tree, 80)}, tested ${f.install.testedAt ? dangerHhmm(f.install.testedAt) : 'never'}.`,
      d.length ? `${d.length} file${d.length === 1 ? ' differs' : 's differ'} from the build installed now: ${d.slice(0, 8).map(x => dangerPlain(x, 120)).join(', ')}${d.length > 8 ? ` and ${d.length - 8} more` : ''}.` : 'No file differs from the build installed now.');
    if (f.install.brainReads) out.push(dangerPlain(f.install.brainReads, 300));
  }
  if (f.outsideWall) out.push(`Runs outside the wall: ${dangerPlain(f.outsideWall, 200)}.`);
  return out;
}

// The things line 4 looks for, from the bytes of line 7 (and a file's path): every address (with a scheme or without
// one: a host with its path whole, or a host alone), path, IP address, and package or image name after install, add,
// pull or run of the programs that fetch them, or after a runner (npx). Printable ASCII only, no spaces.
const DANGER_HOST = '(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,24}';
function dangerThings(text) {
  let t = String(text || '');
  const out = new Set(), add = x => { const v = x.replace(/[.,;:)\]'"]+$/, ''); if (v.length >= 3) out.add(v.slice(0, 200)); };
  const take = re => { for (const m of t.matchAll(re)) add(m[1] ?? m[0]); t = t.replace(re, ' '); };
  take(/\b(?:https?|ftp):\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+/gi);
  // (packages and images before addresses with no scheme: an image's name can look like one)
  const named = [];
  for (const m of t.matchAll(/\b(?:pip(?:\d+(?:\.\d+)?)?|pipx|uv|npm|pnpm|yarn|bun|apt|apt-get|dnf|yum|conda|mamba|brew|cargo|go|docker|podman|snap|gem)\s+(?:pip\s+)?(?:install|add|pull|run)\b((?:[ \t]+[^\s;&|<>]+)+)/gi)) {
    for (const w of m[1].trim().split(/\s+/)) if (!w.startsWith('-') && /^[A-Za-z0-9@][A-Za-z0-9._@/:=<>~+-]*$/.test(w)) named.push(w);
  }
  for (const m of t.matchAll(/\b(?:npx|pnpx|bunx|uvx)\b((?:[ \t]+[^\s;&|<>]+)+)/gi)) {
    const w = m[1].trim().split(/\s+/).find(x => !x.startsWith('-'));
    if (w && /^[A-Za-z0-9@][A-Za-z0-9._@/:=<>~+-]*$/.test(w)) named.push(w);
  }
  for (const w of named) { add(w); t = t.split(w).join(' '); }
  take(new RegExp(`(?<![\\w/.@-])${DANGER_HOST}\\/[A-Za-z0-9._~%/+=-]*`, 'gi'));
  for (const m of t.matchAll(/(?:^|[\s"'`=:(<>|;&])((?:~|\.{1,2})?\/[A-Za-z0-9._@%+~/-]+)/g)) add(m[1]);
  for (const m of t.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) add(m[0]);
  for (const m of t.matchAll(new RegExp(`(?<![\\w/.@-])${DANGER_HOST}(?![\\w/-])`, 'gi'))) add(m[0]);
  return [...out];
}
// A thing the owner wrote stands whole in their words: never a piece of a longer word, address or path ("hub.com" in
// "github.com", "/srv" in "/srv/old", "torch" in "pytorch").
function dangerWhole(text, thing) {
  for (let i = text.indexOf(thing); i >= 0; i = text.indexOf(thing, i + 1)) {
    const before = text[i - 1] || '', after = text[i + thing.length] || '', next = text[i + thing.length + 1] || '';
    if (/[A-Za-z0-9._/-]/.test(before) || /[A-Za-z0-9_-]/.test(after) || (/[./]/.test(after) && /[A-Za-z0-9_-]/.test(next))) continue;
    return true;
  }
  return false;
}
// "Came from" (line 4), with no model call: for each thing, nothing when the owner's own messages of this request hold
// it whole (ignoring case); else the first read that holds it, newest first, then the first of Sparkie's earlier answers. A
// pure function: reads are [{label, at, text}] (the text read back from the journal, only searched, never shown; the
// newest 40 and 64 MB in all), answers [{at, text}] (the newest 20). A label is built by code and never quotes its source.
function cameFrom(things, ownerMessages, reads, answers) {
  const own = (ownerMessages || []).map(m => String(m).toLowerCase()).join('\n');
  const newest = (a, b) => String(b.at || '').localeCompare(String(a.at || ''));
  const rs = [...(reads || [])].sort(newest);
  let cut = rs.length > DANGER_READS || rs.some(r => r.cut), budget = DANGER_READ_BYTES;
  const searched = [];
  for (const r of rs.slice(0, DANGER_READS)) {
    const text = String(r.text ?? '');
    if (text.length > budget) { cut = true; break; }
    budget -= text.length;
    searched.push({ what: dangerPlain(r.label, 120) || 'something read', at: r.at, lower: text.toLowerCase() });
  }
  const said = [...(answers || [])].sort(newest).slice(0, DANGER_ANSWERS).map(a => ({ at: a.at, lower: String(a.text ?? '').toLowerCase() }));
  const lines = [], labels = [];
  for (const thing of things || []) {
    const t = String(thing).toLowerCase();
    if (!t || dangerWhole(own, t)) continue;
    const r = searched.find(x => x.lower.includes(t));
    if (r) { lines.push(`${thing}: ${r.what} (read ${dangerHhmm(r.at)})`); labels.push(r.what); continue; }
    const a = said.find(x => x.lower.includes(t));
    if (a) { lines.push(`${thing}: Sparkie’s earlier answer (${dangerHhmm(a.at)})`); labels.push('Sparkie’s earlier answer'); }
  }
  return { lines: lines.slice(0, DANGER_FROM_LINES), more: Math.max(0, lines.length - DANGER_FROM_LINES), cut, labels: [...new Set(labels)] };
}
// A read's long text, read back from the journal by its id (never shown; only searched by cameFrom).
function dangerJournalText(id, max) {
  if (!/^j_[0-9a-f]{12}$/.test(String(id || ''))) return null;
  for (const f of journalFiles()) for (const line of jLinesOf(f)) {
    if (!line.includes(`"id":"${id}"`)) continue;
    const r = jParse(line);
    if (r?.id !== id || !Array.isArray(r.o)) continue;
    const [offset, length] = r.o, n = Math.max(0, Math.min(length, max));
    let fd;
    try { fd = openSync(jFile(f.slice(8, 15), 'out'), 'r'); } catch { return null; }
    // (and a record the journal itself cut at its size counts as not all searched)
    try { const buf = Buffer.alloc(n); readSync(fd, buf, 0, n, offset); return { text: buf.toString(), cut: length > max || Boolean(r.cut) }; } finally { closeSync(fd); }
  }
  return null;
}
// What this request read ({id, label, at}, newest first; a test may hand in {label, at, text}), with its text.
function dangerReadsLoaded(reads) {
  let left = DANGER_READ_BYTES, cut = false;
  const out = [];
  for (const r of [...(Array.isArray(reads) ? reads : [])].sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))).slice(0, DANGER_READS)) {
    const got = typeof r.text === 'string' ? { text: r.text.slice(0, left), cut: r.text.length > left } : dangerJournalText(r.id, left);
    // (a read whose text can't be read back was not searched, and the ask says so)
    if (!got) { cut = true; continue; }
    out.push({ label: r.label, at: r.at, text: got.text, cut: got.cut });
    left -= got.text.length;
    if (got.cut || left <= 0) { cut = true; break; }
  }
  if (cut || (Array.isArray(reads) && reads.length > DANGER_READS)) out.push({ label: '', at: '', text: '', cut: true });
  return out;
}
// Line 2: the gate's own answer for this call, as sparkieCheck's: the owner's words in this request ask for this
// action's kind of change (never a question, a "don't" or a mixed one) and name this Spark. An action with no kind is
// "not asked" unless its raiser, which knows better (rule 2 of A 2.5, R25's word kinds), says so with facts.asked.
function dangerAskedFor(ctx, conv, where, action) {
  if (conv.agent || ctx.agent || !['sparkie', 'page'].includes(ctx.via)) return false;
  const kinds = ACTION_KIND[action] || [], i = ctx.intent || {}, has = (list, k) => (list || []).includes(k);
  return kinds.length > 0 && kinds.some(k => has(i.asked, k)) && !kinds.some(k => has(i.negated, k) || has(i.mixed, k))
    && Boolean(where) && tokensOf(ctx.said || ctx.request || '').has(where);
}
// The owner's own messages of this request: the one that began it and the later ones (never an agent's or a carry-on's).
function dangerOwnerWords(conv) {
  const own = conv.messages.filter(m => m.role === 'user' && !m.from && !m.auto);
  const since = conv.task?.at ? own.filter(m => String(m.createdAt) >= String(conv.task.at)) : [];
  return (since.length ? since : own.slice(-1)).map(m => String(m.content || ''));
}

// kinds: some of DANGER_KINDS (code names them, never the brain); where: the Spark; facts: what lines 2, 3, 5 and 6
// say ({asked, backAt, kept, gone, waysIn, install, outsideWall, whoApproves, switchBrain, recheck}); shown: the exact
// bytes the press runs ({command}, {path, before, after}, {script}; none for an install); call: {action, args}, what the
// yes runs. ctx.reads: what this request read ({id, label, at}). Returns what the caller (the brain, an agent) is told.
function dangerAsk(viewer, ctx, { kinds, where = null, facts = {}, shown = {}, call } = {}) {
  const ks = DANGER_KINDS.filter(k => (kinds || []).includes(k));
  if (!ks.length || !call?.action || !ACTIONS.has(call.action)) throw new Error('A dangerous ask needs one of its kinds and the action it runs.');
  const install = ks.includes('install'), code = install ? null : dangerCodeOf(shown || {});
  if ((code && DANGER_HIDDEN.test(code.text)) || DANGER_HIDDEN.test(String(shown?.path || ''))) {
    throw new HttpError(400, 'What it would run holds invisible characters, so what would be shown isn’t what would run. Nothing was asked or run.');
  }
  // Shown whole or not asked: a part the masks would hide is a part the owner could not read before saying yes.
  const masked = x => maskSecrets(x) !== x;
  if ((code && masked(code.text)) || masked(String(shown?.path || ''))) {
    throw new HttpError(400, 'What it would run holds something shaped like a key or password, so it can’t be shown whole: give the key by its name. Nothing was asked or run.');
  }
  const head = dangerHead(ks, where), yesWords = install ? 'Install it' : facts.switchBrain ? 'Switch the brain' : 'Run it';
  const conv = ctx?.conv ? chatData().conversations.find(c => c.id === ctx.conv) : null;
  // No conversation to show it in (an agent's own tool call, POST /actions, a saved step even when run from a chat,
  // which carries the chat but no way to answer, as question() judges it), or not the owner's: nowhere.
  if (!conv || String(conv.login || '').toLowerCase() !== String(accessList().owner || '').toLowerCase() || viewer?.role !== 'owner' || (!ctx.onQuestion && ctx.via !== 'page')) {
    return { outcome: 'question', question: head, choices: [{ label: yesWords, choice: null }, { label: 'No', choice: null }],
      note: 'Only the owner can answer this one, and nothing was done or shown anywhere. The owner asks Sparkie for this in their own chat in Spark Console. Tell them that.' };
  }
  const byAgent = Boolean(conv.agent || ctx.agent);
  let open = dangerLive();
  // The owner's own chat goes ahead of an agent's conversation for the one place.
  if (open && open.agent && !byAgent) { dangerClose(open, 'the owner asked'); open = null; }
  // (an agent is told only that it waits, never what the open ask is about)
  if (open) return byAgent ? { outcome: 'waiting', question: 'An ask waits for the owner.', note: 'Waiting: another ask is open for the owner. Nothing was asked or run.' }
    : { outcome: 'waiting', question: open.head, note: `Waiting for your answer to the ask already open (${open.head}). Nothing was asked or run.` };
  if (byAgent && Date.now() - (dangerDeclined.get(conv.id) || 0) < DANGER_AGENT_WAIT_MS) {
    return { outcome: 'waiting', question: 'An ask waits for the owner.', note: 'Asked again too soon: the owner just declined an ask in this conversation. Wait a minute. Nothing was asked or run.' };
  }
  const now = Date.now();
  while (dangerBuilt.length && now - dangerBuilt[0] > 600000) dangerBuilt.shift();
  const opensAt = dangerBuilt.length >= 2 ? now + DANGER_LATE_MS : now;
  dangerBuilt.push(now);
  const asked = typeof facts.asked === 'boolean' ? facts.asked : dangerAskedFor(ctx, conv, where, call.action), agent = byAgent ? dangerPlain(conv.agent?.name, 60) || 'An agent' : null;
  const answers = conv.messages.filter(m => m.role === 'assistant' && !m.notice && !m.danger && m.content).map(m => ({ at: m.createdAt, text: m.content }));
  const from = install ? null : cameFrom(dangerThings(`${code.text}\n${shown?.path || ''}`), dangerOwnerWords(conv), dangerReadsLoaded(ctx.reads), answers);
  const lines = [head, asked ? 'You asked for this.' : agent ? `You did not ask for this. ${agent} did.` : 'You did not ask for this.', ...dangerBack(facts),
    ...(from?.lines.length ? ['Came from, not from you:', ...from.lines.map(l => `  ${l}`), ...(from.more ? [`  and ${from.more} more`] : [])] : []),
    ...(from?.cut ? ['Not all of what was read was searched.'] : []), ...dangerMore(facts), ...(code?.before || [])].map(l => maskSecrets(l));
  const longLine = code && code.text.length >= DANGER_LONG ? 'Long: read all of it before you answer.' : null;
  const id = randomBytes(6).toString('hex');
  let q = null;
  question(viewer, { ...ctx, onQuestion: x => { q = x; } }, head, [{ label: yesWords, call }, { label: 'No', call: null }], 'question', { ownerOnly: true, danger: id });
  const [yes, no] = q.choices.map(c => c.choice);
  // (its fifteen minutes start when it is sent)
  for (const c of [yes, no]) pendingChoices.get(c).at = opensAt;
  let digits;
  do digits = String(randomInt(10, 100)); while (digits === dangerLastPair);
  dangerLastPair = digits;
  const recheck = typeof facts.recheck === 'function' ? facts.recheck : null;
  const a = { id, head, kinds: ks, where, act: call.action, yes, no, group: q.group, conv: conv.id, digits, tries: 0, opensAt, asked, agent, yesWords, lines, longLine,
    code: code ? code.text : null, from: from?.labels || [], whoApproves: Boolean(facts.whoApproves), recheck, wall: facts.wall || null, raw: code?.text ?? null,
    pressedAt: 0, pairOk: false, taken: false, telegram: null };
  // What it binds: its kinds, Spark, wall, verb and arguments and the exact bytes; and what a script holds now.
  a.sha = dangerBound(a, call.action, call.args);
  // (what recheck gives at the press must be the very text shown: a script read again, which may take a while)
  a.bytesSha = recheck ? dangerSha(code?.text ?? '') : null;
  conv.messages.push({ role: 'assistant', notice: true, createdAt: new Date().toISOString(),
    // (in an agent's conversation the words its tools read back say only that it waits: the ask itself is the owner's)
    content: agent ? 'Spark Console asked the owner about this as its own message. Only the owner can answer it.'
      : [...lines, ...(longLine ? [longLine] : []), ...(a.code !== null ? [a.code] : []), `To run it: press ${yesWords}, then type the two digits shown with this ask.`].join('\n'),
    danger: { ask: id, lines, long: Boolean(longLine), code: a.code, yes: yesWords },
    choices: [{ id: yes, label: yesWords, state: 'open', group: q.group, pair: true }, { id: no, label: 'No', state: 'open', group: q.group }] });
  conv.updatedAt = new Date().toISOString();
  saveChats();
  dangerOpen = a;
  dangerJournal(a, 'asked', { via: ctx.via || null, actor: ctx.actor || null });
  if (opensAt > now) setTimeout(() => { dangerTell(a).catch(() => {}); }, opensAt - now).unref?.();
  else dangerTell(a).catch(() => {});
  // (an agent is told only that it waits; a button's notice and a saved step's failure name the ask's first line)
  return { outcome: 'question', question: agent ? 'An ask waits for the owner.' : head, asked: 'as its own message', note: agent
    ? 'asked: it waits for the owner. Only the owner answers it, in Spark Console or their paired Telegram chat; you can answer nothing.'
    : 'Asked as its own message in this chat (and in the owner’s Telegram while approvals from there are on), with what it changes and the exact command: only the owner answers it. Say in one short line why you proposed it, then stop. Don’t repeat the command.' };
}
const dangerBound = (a, action, args) => dangerSha(JSON.stringify([a.kinds, a.where, a.wall, action, args ?? null, a.raw]));
// The journal's line for the ask, its answer and its end (2.11): never the digits.
function dangerJournal(a, outcome, more = {}) {
  journal('call', { act: a.act, chat: a.conv, ...more, danger: a.kinds, asked: a.asked, from: a.from, outcome, sub: jSub(a.where) });
}

// The open ask, or null once it closed: answered, No, void, or 15 minutes after it was sent.
function dangerLive() {
  const a = dangerOpen;
  if (!a) return null;
  if (a.taken) return null;
  if (pendingChoices.has(a.yes) && Date.now() - a.opensAt <= DANGER_MS) return a;
  dangerClose(a, pendingChoices.has(a.yes) ? 'expired' : 'gone');
  return null;
}
// Closes it: no button of it answers again (a later press or pair is told so), and its buttons go grey on the page.
function dangerClose(a, why, more = {}) {
  if (!a || a.closedAt) { if (dangerOpen === a) dangerOpen = null; return; }
  Object.assign(a, { closedAt: Date.now(), closed: why, digits: null, pressedAt: 0, pairOk: false, taken: true });
  if (dangerOpen === a) dangerOpen = null;
  dangerRecent = a;
  if (a.agent && (why === 'no' || why === 'gone')) dangerDeclined.set(a.conv, Date.now());
  for (const id of [a.yes, a.no]) { pendingChoices.delete(id); tgAsks.delete(id); dangerGoneIds.set(id, Date.now()); }
  while (dangerGoneIds.size > 200) dangerGoneIds.delete(dangerGoneIds.keys().next().value);
  if (why !== 'answered' && why !== 'no') {
    const conv = chatData().conversations.find(c => c.id === a.conv);
    for (const m of conv?.messages || []) for (const x of m.choices || []) if (x.group === a.group && x.state === 'open') x.state = 'gone';
    if (conv) saveChats();
  }
  dangerJournal(a, why === 'answered' ? 'answered' : why === 'no' ? 'declined' : 'void', { ...(why !== 'answered' && why !== 'no' ? { why } : {}), ...more });
}
const dangerGone = id => (dangerGoneIds.has(String(id)) ? 'That ask is no longer open. Ask again.' : null);
// What an approval of it from Telegram is echoed as on the page (tgApproved): its first line, not its yes words.
const dangerHeadOf = id => (dangerRecent?.id === id ? dangerRecent.head : dangerOpen?.id === id ? dangerOpen.head : null);
// /stop in the chat that asked; /pause; a new pairing: closed. /lock and the switch off: its Telegram side only.
function dangerStopped(conv) { const a = conv && dangerLive(); if (!a || a.conv !== conv.id) return false; dangerClose(a, 'stopped'); return true; }
function dangerPaused() { if (dangerOpen) dangerClose(dangerOpen, 'paused'); }
function dangerTelegramGone(everywhere) {
  if (!dangerOpen) return;
  if (everywhere) return dangerClose(dangerOpen, 'a new pairing');
  Object.assign(dangerOpen, { telegram: null, pressedAt: 0, pairOk: false });
}
// A task parked at a dangerous ask is not carried past it by the loop's budgets (budgetCarries, 14-rounds.mjs).
const dangerParked = conv => Boolean(conv && dangerLive()?.conv === conv.id);
// The owner's page reads the chat (GET /chats/:id): the open ask's copy carries its digits once it is sent.
const dangerShown = messages => (dangerLive() && dangerOpen && !dangerOpen.taken
  ? messages.map(m => (m.danger?.ask !== dangerOpen.id ? m : Date.now() < dangerOpen.opensAt ? { ...m, opensAt: new Date(dangerOpen.opensAt).toISOString() } : { ...m, pair: dangerOpen.digits }))
  : messages);

// Sends it to the paired chat while approvals from there are on: its facts, the command as a fixed-width block, then the
// digits, with its two buttons. Over 3,500 characters, or when it changes who may approve: the facts, and that it waits
// in Spark Console, with no button.
async function dangerTell(a) {
  const p = tgPaired();
  if (!p || !tgApproveOn() || dangerOpen !== a || a.taken) return false;
  const head = a.lines.join('\n'), end = `To run it: press ${a.yesWords}, then type ${a.digits}.`;
  if (a.whoApproves || (a.code !== null && a.code.length > TG_ASK_MAX) || head.length + (a.code?.length || 0) + 200 > TELL_PART) return tell('ask', `${head}\n\nThis one waits for you in Spark Console.`);
  const sent = { chatId: p.chatId, userId: p.userId, pairedAt: p.pairedAt || null, group: a.group, conv: a.conv };
  for (const id of [a.yes, a.no]) tgAsks.set(id, sent);
  a.telegram = sent;
  const buttons = [{ id: a.yes, label: a.yesWords }, { id: a.no, label: 'No' }];
  const ok = a.code === null ? await tell('ask', `${head}\n\n${end}`, { buttons }) : await tell('ask', `${head}${a.longLine ? `\n${a.longLine}` : ''}`, { buttons, pre: a.code, tail: end });
  if (!ok) { for (const id of [a.yes, a.no]) if (tgAsks.get(id) === sent) tgAsks.delete(id); if (a.telegram === sent) a.telegram = null; }
  return ok;
}
// Its yes pressed in the paired chat (tgApproving, once A10a's checks pass): answered, and the next message is compared.
function dangerPressedHere(choice) {
  const a = dangerLive();
  if (!a || a.yes !== choice || !a.telegram) return dangerGone(choice) || 'That ask is no longer open. Ask again.';
  if (Date.now() < a.opensAt) return `This ask opens at ${dangerHhmm(a.opensAt)}: read it meanwhile.`;
  a.pressedAt = Date.now();
  return 'Type the two digits from the ask to run it.';
}
function dangerWrong(a) {
  a.tries += 1;
  if (a.tries >= 3) { dangerClose(a, 'three wrong pairs'); return 'That was the third wrong pair, so the ask is closed and nothing was run. Ask again.'; }
  return 'Those aren’t the two digits from the ask, so nothing was run. Type them again, or press No.';
}
// The owner's next message in the paired chat (tgUpdate): after a press, the pair (spaces or punctuation around it
// allowed) is compared, and anything else forgets the press; the pair with no press is told to press first. While an
// ask is open, a message that holds its pair as a number of its own never goes on to Sparkie (nor so to the chat file
// or the journal). null: not about an ask (it goes on to Sparkie).
function dangerTypedHere(text) {
  const t = String(text).trim(), a = dangerLive(), pair = /^[^\p{L}\p{N}]{0,4}(\d{2})[^\p{L}\p{N}]{0,4}$/u.exec(t)?.[1] || null;
  const holds = Boolean(a?.digits) && !pair && new RegExp(`(?:^|[^0-9])${a.digits}(?:[^0-9]|$)`).test(t);
  if (!a || !a.telegram) {
    if (a && (pair || holds)) return tell('system', 'That ask isn’t answered here: answer it in Spark Console.');
    return pair && dangerRecent && Date.now() - dangerRecent.closedAt < DANGER_MS ? tell('system', 'That ask is no longer open. Ask again.') : null;
  }
  if (!a.pressedAt) return pair ? tell('system', `Press ${a.yesWords} first.`) : holds ? tell('system', `Press ${a.yesWords} first, then type only the two digits.`) : null;
  if (holds) return tell('system', 'Type only the two digits.');
  if (!pair) { a.pressedAt = 0; return null; }
  if (!dangerSame(pair, a.digits)) return tell('system', dangerWrong(a));
  const c = pendingChoices.get(a.yes), conv = chatData().conversations.find(x => x.id === a.conv);
  if (!c || !conv || !tgAskOpen(a.yes, c)) return tell('system', 'That ask isn’t answered here: answer it in Spark Console.');
  const held = tgApprovalsHeld();
  if (held) return tell('system', held);
  if (tg.busy || replying.has(conv.id)) return tell('system', 'Still answering the last one. Type the two digits again when I’m done.');
  a.pairOk = true;
  return tgRun(conv, a.yes, { c, conv });
}
// runChoice's check of any press on a dangerous ask, before anything runs: open, the owner's own press with its pair,
// and what it shows still what would run. A refusal throws (it says why) and runs nothing.
async function dangerPress(id, c, by) {
  const no = (status, why) => Object.assign(new HttpError(status, why), { danger: true });
  const a = dangerLive();
  if (!a || (a.yes !== id && a.no !== id)) throw no(409, 'That ask is no longer open. Ask again.');
  if (!['page', 'telegram'].includes(by.via) || by.agentId) throw no(403, 'Only the owner answers this one, in Spark Console or their paired Telegram chat.');
  if (Date.now() < a.opensAt) throw no(409, `This ask opens at ${dangerHhmm(a.opensAt)}: read it meanwhile.`);
  if (id === a.no) return dangerClose(a, 'no', { gate: `asked:${by.via}` });
  if (by.via === 'page') {
    const pair = String(by.pair ?? '').trim();
    if (!/^\d{2}$/.test(pair)) throw no(400, `Type the two digits from the ask, then press ${a.yesWords}.`);
    if (!dangerSame(pair, a.digits)) { const why = dangerWrong(a); throw no(a.closedAt ? 409 : 403, why); }
  } else if (!(a.pairOk && a.pressedAt)) throw no(403, 'Type the two digits from the ask to run it.');
  // (taken now: a second press, here or in the other place, at the same instant or later, runs nothing)
  a.taken = true;
  let same = dangerBound(a, c.action, c.args) === a.sha;
  try { if (same && a.recheck) same = dangerSha(String(await a.recheck())) === a.bytesSha; } catch { same = false; }
  if (!same) { dangerClose(a, 'changed'); throw no(409, 'What that ask showed is no longer what would run, so nothing was run. Ask again: a new ask shows the new text.'); }
  dangerClose(a, 'answered', { gate: `asked:${by.via}` });
}

// On the stand-in fleet only: a test raises a dangerous ask through the next owner-only question (question(),
// 17-changes.mjs), from STATE_DIR/.test-danger.json ({kinds, where, facts, shown, reads}; shown.file: a script on this
// machine, read again at the press). Never on a real console, where nothing raises one yet.
function dangerForTest(viewer, ctx, choices) {
  if (!ALL_LOCAL) return null;
  const f = `${STATE_DIR}/.test-danger.json`;
  if (!existsSync(f)) return null;
  let t;
  try { t = JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
  const call = choices.find(c => c.call)?.call, file = t.shown?.file;
  if (!call) return null;
  return dangerAsk(viewer, { ...ctx, reads: t.reads || [] }, { kinds: t.kinds, where: t.where, facts: { ...(t.facts || {}), ...(file ? { recheck: () => sleep(400).then(() => readFileSync(file, 'utf8')) } : {}) },
    shown: file ? { script: readFileSync(file, 'utf8') } : t.shown || {}, call });
}
