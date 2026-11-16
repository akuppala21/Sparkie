/* ───────── the go-ahead: yes to one command, or one kind, for the rest of a task (A9a), or always (A9b) ───────── */
// Area: features        Rules: R65        Tests: ahead.test.mjs, allowed.test.mjs
// Owns: none
// Timers: none        Wakes: none
// On a change's button (21-ladder.mjs workAsk) the owner may answer "Run it, and don't ask again for this task: …".
// For the rest of that request (the turns that carry it on), a command of that kind then runs without a button: the
// kind is a plain change's tool (the program the sorter resolved, 20-sort.mjs), its place (the folder its places are
// under) and the Spark, all built here by code from the sorter's answer, never from words the brain or a page gave. A
// command with no kind (not one simple program, or working at the top of the home or outside it) gets "this same
// command" instead.
// One list a chat, in memory, for the request it was given in: gone when that request ends (a No, the way in it came
// by gone, the owner's next request), at /stop, at a new pairing, and at a restart. A press in the paired Telegram chat
// may give it too. It stands in only for the request's own rules (2 and 3 of design A 2.5: the owner's words asked for
// a change and named the Spark, and nothing was read since): the sorter, the wall, the pause, the rail (R52), the
// copies and the journal all still apply, and the run's record says gate "go-ahead". Never ahead (aheadWhyNot), and so
// never offered: an agent's change; Spark 2 or a Spark holding the brain; root; a key read or sent; a script (its hash
// is for one press); what an earlier command of the task fetched or wrote; what came from what Sparkie read (R54's
// "came from"); a dangerous ask's kinds; anything the sorter calls risky, lock-out, open or not done; a protected
// folder; a change that runs with --home or --open after its yes; an install (the sorter's installs); the GPU; a reach
// beyond the Spark itself (another Spark, the home network, the internet).
// "Always allow" (A9b) is the same kind kept across tasks: one list in agent-settings.json (`allowed`, 50 at most), added
// only by the owner's press of that answer on the page while a passkey is set up (the press needs it; Telegram never
// shows that answer), taken away by /allowed off. In the owner's chats it stands in for the naming of the Spark and for
// nothing read since; the words must still ask for a change. Held after a state put-back until "Keep these".
const AHEAD_MAX = 20, ALLOWED_MAX = 50;
// Each chat's go-ahead: {at (its request's time), epoch, entries}; the request whose go-ahead ended there (/stop, its
// end), so a later press of that request's button gives none; a new pairing's count.
const aheadLists = new Map(), aheadDone = new Map();
let aheadEpoch = 0;

// The request a chat is on: the time its task began with (kept on the task under a symbol when keepTask makes it: never
// written to chats.json, so a task read back after a restart has none; its own start moves when it waits at a button
// or carries on), else the owner's last message of their own (a carry-on's is not one).
const AHEAD_SINCE = Symbol('the request a task began with');
function aheadMark(conv) {
  if (conv?.task && !conv.task.ended) return String(conv.task[AHEAD_SINCE] || '');
  const m = (conv?.messages || []).findLast(x => x.role === 'user' && !x.auto && !x.from);
  return m ? String(m.createdAt || '') : '';
}
// What a command is, for a kind, from the sorter's answer alone: a plain change's tool (its one program) and the
// folders it works in (each place's folder, a wide place itself; none placed, where it starts).
function aheadFacts(sorted, command, dir) {
  if (sorted?.class !== 'change' || !sorted.simple || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,40}$/.test(String(sorted.program || ''))) return null;
  const places = [...(sorted.placed || []).map(p => String(p).replace(/\/[^/]*$/, '')), ...(sorted.wide || [])];
  const folders = places.length ? places : [String(dir)];
  if (folders.some(p => !/^~(?:\/[A-Za-z0-9._@+-]+)+$/.test(p) || /(?:^|\/)\.\.?(?:\/|$)/.test(p))) return null;
  return { program: sorted.program, folders: [...new Set(folders)] };
}
// The kind, or null: the deepest folder all of them are under, never the home itself.
function aheadKind(sorted, command, dir) {
  const f = aheadFacts(sorted, command, dir);
  if (!f) return null;
  const parts = f.folders.map(p => p.split('/')), common = [];
  for (let i = 0; i < parts[0].length && parts.every(x => x[i] === parts[0][i]); i++) common.push(parts[0][i]);
  return common.length >= 2 ? { program: f.program, under: common.join('/') } : null;
}
const aheadIn = (p, under) => p === under || p.startsWith(`${under}/`);
// Whether a command falls in an entry: that same command where it started, or one of its kind with every folder under its folder.
function aheadFits(e, sorted, command, dir) {
  if (e.command != null) return e.command === command && e.dir === dir;
  const f = aheadFacts(sorted, command, dir);
  return Boolean(f && f.program === e.program && f.folders.every(p => aheadIn(p, e.under)));
}
// The answer's words, built here: the kind, or "this same command".
const aheadWords = (e, at) => (e.command != null ? 'this same command' : `“${e.program}” in ${e.under} on ${at}`);
// What an earlier command of the task wrote or fetched (its places, ctx.written): a place inside one, or a wide place
// over one, is that.
const aheadWritten = (sorted, written) => (Array.isArray(written) ? written : []).some(w => typeof w === 'string'
  && ((sorted?.placed || []).some(p => aheadIn(p, w.replace(/\/+$/, ''))) || (sorted?.wide || []).some(p => aheadIn(p, w.replace(/\/+$/, '')) || aheadIn(w, p))));
// Why a command may never run on a go-ahead, or null. f: {agent, hub, brain, root, written, from (cameFrom's answer),
// reached (protected folders), outside (runnerOutside: --open or --home after the yes), widen (runnerWiden)}; the
// sorter's own installs, gpu and reach too.
function aheadWhyNot(sorted, command, f) {
  if (f.agent) return 'an agent asked for it';
  if (f.hub) return 'it is on Spark 2';
  if (f.brain) return 'that Spark holds the brain';
  if (f.root || sorted?.kinds?.includes('root') || sorted?.answer) return 'it runs as root';
  if (maskSecrets(command) !== command || lookWords(command).words.some(w => keyWord(w))) return 'it reads or sends a key';
  if (sorted?.scripts?.length) return 'it runs a script, whose text can change after a yes';
  if (aheadWritten(sorted, f.written)) return 'it uses what an earlier command of this task fetched or wrote';
  if (f.from?.lines?.length || f.from?.cut) return 'part of it came from what Sparkie read';
  if (sorted?.kinds?.includes('lockout')) return 'it could lock you out';
  if (sorted?.kinds?.length) return `it ${sorted.kinds.includes('delete') ? 'deletes what can’t be put back' : 'names the brain'}, which is a dangerous ask`;
  if (sorted?.class !== 'change') return sorted?.class === 'lockout' ? 'it could lock you out' : sorted?.class === 'notdone' ? 'it is never done' : sorted?.open ? 'it needs what the run wall hides' : 'the sorter calls it risky';
  if (f.reached?.length) return `it reaches ${f.reached.join(', ')}`;
  if (f.outside?.length) return 'it runs outside the plain wall after a yes';
  if (sorted?.installs?.length) return 'it installs programs where the plain wall keeps them read-only';
  if (sorted?.gpu || f.widen?.gpu) return 'it uses the GPU';
  const reach = new Set([...(Array.isArray(sorted?.reach) ? sorted.reach : []), ...(f.widen?.fleet ? ['fleet'] : []), ...(f.widen?.home ? ['home'] : [])]);
  if (reach.size) return `it reaches ${reach.has('fleet') ? 'another Spark of this fleet' : reach.has('home') ? 'your home network' : 'the internet'}`;
  return null;
}
// The facts for aheadWhyNot, from the request (ctx) and the Spark; the chat's earlier answers and what was read go to
// cameFrom (20-came-from.mjs), as for the dangerous ask.
function aheadNot(node, command, sorted, viewer, ctx, conv, dir, topDirs, widen) {
  const answers = conv.messages.filter(m => m.role === 'assistant' && !m.notice && !m.danger && m.content).map(m => ({ at: m.createdAt, text: m.content }));
  // (a command that names no thing came from nowhere: nothing to look for, nor a read to load)
  const things = dangerThings(command);
  return aheadWhyNot(sorted, command, { agent: Boolean(ctx.agent || ctx.agentId || viewer?.agentKey || conv.agent), hub: node.host === 'local',
    brain: brainSparks().includes(node.id), root: Boolean(ctx.root), written: ctx.written,
    from: things.length ? cameFrom(things, dangerOwnerWords(conv), dangerReadsLoaded(ctx.reads), answers) : null,
    reached: runnerProtected(sorted, dir), outside: runnerOutside(sorted, command, dir, topDirs), widen: runnerWiden(node, command, widen, sorted) });
}
// The owner's own chat this call is in (Sparkie's turn in it, the owner viewing), or null.
function aheadChat(viewer, ctx) {
  if (!ctx?.conv || ctx.via !== 'sparkie' || ctx.agent || ctx.agentId || viewer?.role !== 'owner') return null;
  const conv = chatData().conversations.find(c => c.id === ctx.conv);
  return conv && !conv.agent && String(conv.login || '').toLowerCase() === String(accessList().owner || '').toLowerCase() ? conv : null;
}

// workAsk's extra answers, or null: the go-ahead's label and what its press gives; and, for a kind while a passkey is
// set up, "Always allow …" (page only).
function aheadOffer(node, command, sorted, viewer, ctx, dir, topDirs, widen) {
  try {
    const conv = aheadChat(viewer, ctx);
    if (!conv || aheadNot(node, command, sorted, viewer, ctx, conv, dir, topDirs, widen)) return null;
    const kind = aheadKind(sorted, command, dir), entry = kind ? { spark: node.id, ...kind } : { spark: node.id, command, dir }, words = aheadWords(entry, sparkName(node));
    return { label: `Run it, and don’t ask again for this task: ${words}`, ahead: { conv: conv.id, at: aheadMark(conv), epoch: aheadEpoch, entry },
      ...(kind && passkeys().length ? { always: { label: `Always allow ${words} (on this page, with your passkey)`, entry: { spark: node.id, ...kind } } } : {}) };
  } catch (e) { console.error(`The go-ahead's answer: ${e.message}`); return null; }
}
// runChoice, after the press of that answer ran: the go-ahead is kept for the request it was asked in, while that
// request is still the chat's and has not ended. The line it adds to the press's notice, or null.
function aheadGive(conv, ahead, by = {}) {
  const at = aheadMark(conv), e = ahead?.entry;
  if (!e || ahead.conv !== conv.id || !at || at !== ahead.at || ahead.epoch !== aheadEpoch || aheadDone.get(conv.id) === at) return null;
  let l = aheadLists.get(conv.id);
  if (!l || l.at !== at) aheadLists.set(conv.id, (l = { at, entries: [] }));
  const words = aheadWords(e, sparkName(nodeById(e.spark) || { id: e.spark }));
  if (!l.entries.some(x => JSON.stringify({ ...x, since: 0, by: 0 }) === JSON.stringify({ ...e, since: 0, by: 0 }))) {
    if (l.entries.length >= AHEAD_MAX) return `Not kept: this task already has ${AHEAD_MAX} go-aheads.`;
    l.entries.push({ ...e, since: new Date().toISOString(), by: by.via === 'telegram' ? 'telegram' : 'page' });
    audit({ via: by.via || 'page', actor: by.actor || 'owner', action: 'go-ahead', args: { chat: conv.id, spark: e.spark, words: maskSecrets(words).slice(0, 200) }, ok: true });
  }
  return `For the rest of this task, ${words} runs without asking.`;
}
// workChange: whether a command may run on this chat's go-ahead (gate go-ahead) or a standing entry (always:<id>), or
// null.
function aheadCover(node, command, sorted, viewer, ctx, dir, topDirs, widen) {
  const l = ctx?.conv ? aheadLists.get(ctx.conv) : null, kept = putBackHeld() ? [] : allowedList();
  if (!l?.entries.length && !kept.length) return null;
  const conv = aheadChat(viewer, ctx);
  if (!conv) return null;
  const task = l && aheadMark(conv) === l.at && aheadDone.get(conv.id) !== l.at && l.entries.some(x => x.spark === node.id && aheadFits(x, sorted, command, dir));
  const always = task ? null : kept.find(x => x.spark === node.id && aheadFits(x, sorted, command, dir));
  if ((!task && !always) || aheadNot(node, command, sorted, viewer, ctx, conv, dir, topDirs, widen)) return null;
  return task ? { gate: 'go-ahead', always: false } : { gate: `always:${always.id}`, always: true };
}

// The standing list as kept (a hand edit or a copy put back may hold anything: only well-formed kinds count).
const allowedList = () => (Array.isArray(agentSettings().allowed) ? agentSettings().allowed : []).filter(e => e && typeof e === 'object' && /^[0-9a-f]{8}$/.test(String(e.id))
  && typeof e.spark === 'string' && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,40}$/.test(String(e.program)) && /^~(?:\/[A-Za-z0-9._@+-]+)+$/.test(String(e.under)) && !/(?:^|\/)\.\.?(?:\/|$)/.test(String(e.under))).slice(0, ALLOWED_MAX);
const allowedWords = e => aheadWords(e, sparkName(nodeById(e.spark) || { id: e.spark }));
// runChoice, after the press of "Always allow …" on the page ran: the kind is kept. The line for the press's notice.
function aheadKeep(always, by = {}) {
  const e = always?.entry;
  if (!e || by.via !== 'page' || !passkeys().length) return null;
  const list = allowedList(), words = allowedWords(e);
  if (list.some(x => x.spark === e.spark && x.program === e.program && x.under === e.under)) return `${words[0].toUpperCase()}${words.slice(1)} was already always allowed.`;
  if (list.length >= ALLOWED_MAX) return `Not kept: ${ALLOWED_MAX} kinds are always allowed already. /allowed lists them.`;
  const id = randomBytes(4).toString('hex');
  setAgentSettings({ allowed: [...list, { id, spark: e.spark, program: e.program, under: e.under, addedAt: new Date().toISOString() }] });
  audit({ via: 'page', actor: by.actor || 'owner', action: 'always-allowed', args: { id, spark: e.spark, words: maskSecrets(words).slice(0, 200) }, ok: true });
  return `From now on, ${words} runs without asking in your chats when your words ask for a change. /allowed lists it and takes it away.`;
}
// /allowed (20-words.mjs, on the page and in the paired chat): the list, numbered; /allowed off 2, /allowed off all.
function allowedWord(word, via) {
  const list = allowedList(), off = /^\/allowed off (all|\d{1,2})$/.exec(word)?.[1];
  if (off) {
    const gone = off === 'all' ? list : list[Number(off) - 1] ? [list[Number(off) - 1]] : [];
    if (!gone.length) return list.length ? `There is no ${off} in the list (${list.length} kept). /allowed lists them.` : 'Nothing is always allowed.';
    setAgentSettings({ allowed: list.filter(e => !gone.includes(e)) });
    // (a removal that raises the put-back number, as a passkey's or a key's does: a copy from before it put back by
    // hand holds, and the entry is taken away again, 22-putback.mjs)
    for (const e of gone) putBackRemoved('allowed', e.id, allowedWords(e));
    audit({ via, actor: via === 'telegram' ? 'owner on Telegram' : 'owner', action: 'always-removed', args: { ids: gone.map(e => e.id) }, ok: true });
    return `Taken away: ${gone.map(allowedWords).join('; ')}. ${gone.length === 1 ? 'It is' : 'They are'} asked again.`;
  }
  if (!list.length) return 'Nothing is always allowed. A change’s button offers “Always allow …” on the page, with your passkey.';
  return [`Always allowed in your chats (${list.length}):`, ...list.map((e, i) => `${i + 1}. ${allowedWords(e)}`),
    ...(putBackHeld() ? ['Held: Spark Console’s state was put back from a copy, so these wait until you press “Keep these” on your tailnet.'] : []),
    '/allowed off 2 takes one away; /allowed off all takes every one.'].join('\n');
}
// The go-ahead ends: this chat's (its request ended, /stop), or every chat's (a new pairing).
function aheadEnd(conv) {
  if (!conv?.id) return;
  aheadLists.delete(conv.id);
  const at = aheadMark(conv);
  if (at) aheadDone.set(conv.id, at);
}
function aheadEndAll() {
  for (const [id, l] of aheadLists) aheadDone.set(id, l.at);
  aheadLists.clear();
  aheadEpoch++;
}
// A new request in a chat: the last one's go-ahead is gone with it.
const aheadNewRequest = conv => { aheadLists.delete(conv.id); aheadDone.delete(conv.id); };
// What the chat's page reads (GET /chats/:id): the go-ahead holding now, in its own words.
function aheadShown(conv) {
  const l = aheadLists.get(conv?.id);
  if (!l || aheadMark(conv) !== l.at) return [];
  return l.entries.map(e => ({ words: aheadWords(e, sparkName(nodeById(e.spark) || { id: e.spark })), since: e.since, by: e.by }));
}
