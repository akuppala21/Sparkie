/* ───────── telling the owner on Telegram ───────── */
// Area: safety        Rules: R32        Tests: telegram.test.mjs, needs-me.test.mjs, tasks-telegram.test.mjs, telegram-parity-transport.test.mjs
// Owns: none
// Timers: tellAgain (a result Telegram didn't take, again after 1, 2 and 4 minutes)        Wakes: none
// tell() is the only thing that sends to Telegram, and it sends only what the owner asked for (docs/contract.md 13,
// docs/architecture.md R32): a reply to a message sent there, the result of work started there, Sparkie carrying on
// with a request made there, Spark Console's own fixed lines (pairing, /status, "restarted while answering"), and an ask
// that waits for the owner's yes, with its buttons (20-tg-approve.mjs, only while approvals from Telegram are on). Never
// heals, crashes nobody asked about, notices, sign-ins or digests, with one exception the owner switches on: the
// needs-me line at the end of this part. Every send is plain text with link previews off and secrets hidden, and is on
// the record (its kind and size, never its text).
const TELL_WHY = new Set([
  'ask',
  'carry',
  'needs',
  'reply',
  'result',
  'system',
]);
// A result or carry-on line long after the owner's last message there arrives silently.
const TELL_QUIET_MS = Number(process.env.SPARK_CONSOLE_TELL_QUIET_MS || 30 * 60000);
const TELL_PART = 4000;
// Brain-bound messages retain their input flood guard; owner controls and sends use transport backoff.
const TELL_LIMITS = (() => {
  const m = ALL_LOCAL && /^(\d+),(\d+),(\d+)$/.exec(process.env.SPARK_CONSOLE_TELEGRAM_LIMITS || '');
  return { in: m ? Number(m[1]) : 20 };
})();
const TELL_SECRET = Symbol('new owner secret, delivered once');
const tellSends = [], tellResults = [];
let tellOwnerAt = 0;

// Full text, split only at transport boundaries. Preserve every character and avoid splitting a surrogate pair.
function tellParts(text) {
  const parts = []; let rest = String(text ?? '');
  while (rest) {
    if (rest.length <= TELL_PART) { parts.push(rest); break; }
    let at = rest.lastIndexOf('\n', TELL_PART - 1) + 1;
    if (at < TELL_PART / 2) at = TELL_PART;
    const before = rest.charCodeAt(at - 1), after = rest.charCodeAt(at);
    if (before >= 0xD800 && before <= 0xDBFF && after >= 0xDC00 && after <= 0xDFFF) at--;
    parts.push(rest.slice(0, at)); rest = rest.slice(at);
  }
  return parts;
}
// Secrets hidden, and the bot's own token replaced wherever it appears. keep: whole lines code built to be shown as they
// are (question()'s whole): each one found in the text goes as it is, but for the bot's token.
const tellClean = (text, token, keep = []) => {
  const clean = s => { let t = maskSecrets(String(s || '')); if (token) t = t.split(token).join('[hidden]'); return t; };
  const lines = String(text || '').split('\n'), kept = new Set((Array.isArray(keep) ? keep : []).filter(k => typeof k === 'string' && k && !k.includes('\n')));
  if (!kept.size) return clean(text);
  return lines.map(l => (kept.has(l) ? (token ? l.split(token).join('[hidden]') : l) : clean(l))).join('\n');
};

// to: the binding just forgotten, for the one "Disconnected" line (a system line only).
// pre: the full command, in one block when it fits or complete fixed-width chunks when it does not.
const tellBlock = (head, code, tail) => {
  const text = `${head.trim()}\n\n${code}${tail.trim() ? `\n\n${tail.trim()}` : ''}`;
  if (!code) return tellParts(text);
  if (text.length <= TELL_PART) return [{ text, entities: [{ type: 'pre', offset: head.trim().length + 2, length: code.length }] }];
  return [...tellParts(head.trim()), ...tellParts(code).map(text => ({ text, entities: [{ type: 'pre', offset: 0, length: text.length }] })), ...tellParts(tail.trim())];
};
// true when it went; tellTry says why not: 'later' (Telegram not answering, slowing it down, a limit here holding it) or
// 'never' (nobody paired, nothing to send, or Telegram refused it: the chat gone, the bot blocked, a token refused).
async function tell(why, text, opts = {}) { return (await tellTry(why, text, opts)) === 'sent'; }
async function tellTry(why, text, opts = {}) {
  const { buttons = null, to = null, pre = null, tail = '', keep = [], last = false, isCurrent = null, onSent = null } = opts;
  const secret = opts[TELL_SECRET] === true;
  if (!TELL_WHY.has(why)) throw new Error(`Spark Console doesn’t send “${why}” to Telegram.`);
  const b = why === 'system' && to ? to : tgPaired();
  if (!b) return 'never';
  const mark = why === 'system' && to ? null : tgPairingMark(b);
  const current = () => (mark === null || mark === tgPairingMark()) && (!isCurrent || isCurrent());
  if (!current()) return 'never';
  const bound = [], made = [], groups = new Map();
  for (const button of buttons || []) {
    const c = pendingChoices.get(button.id); if (!c) return 'never';
    if (!groups.has(c.group)) groups.set(c.group, []); groups.get(c.group).push(button.id);
  }
  for (const [group, ids] of groups) {
    let sent = tgAsks.get(ids[0]);
    // Reusing an id never replaces what its first send bound, even after a partial delivery.
    if (sent && (!ids.every(id => tgAsks.get(id) === sent) || !tgAskCurrent(sent))) { made.forEach(tgAskDrop); return 'never'; }
    if (!sent) {
      const c = pendingChoices.get(ids[0]), conv = chatData().conversations.find(x => sparkieWho(tgOwner(), x.id) === c.who);
      if (!conv) return 'never'; sent = tgAskBinding(ids, group, conv.id); if (!sent) return 'never'; made.push(sent);
    }
    bound.push(sent);
  }
  const deliverable = () => current() && bound.every(tgAskCurrent);
  const now = Date.now();
  while (tellSends.length && now - tellSends[0] > 60000) tellSends.shift();
  while (tellResults.length && now - tellResults[0] > 3600000) tellResults.shift();
  const later = why === 'result' || why === 'carry';
  // Telegram transport backoff applies equally to replies, results and confirmations.
  const parts = pre === null ? tellParts(secret ? String(text) : tellClean(text, b.token, keep)) : tellBlock(tellClean(text, b.token), tellClean(pre, b.token), tellClean(tail, b.token));
  if (!parts.length) return 'never';
  const silent = later && now - tellOwnerAt > TELL_QUIET_MS;
  let failed = null;
  for (const [i, p] of parts.entries()) {
    if (!deliverable()) { made.forEach(tgAskDrop); return 'never'; }
    tellSends.push(Date.now());
    const sent = await tgSend(b, p.text ?? p, { silent, buttons: i === parts.length - 1 ? buttons : null, entities: p.entities, mark });
    if (sent !== true) { failed = sent || 'unreachable'; break; }
  }
  audit({ via: 'telegram', actor: 'Spark Console', action: 'telegram-send', args: { why, parts: parts.length, chars: parts.reduce((n, p) => n + (p.text ?? p).length, 0) }, ok: !failed });
  // The send counters are metadata only, never channel permissions.
  if (later && !failed) tellResults.push(now);
  if (!failed && !deliverable()) { made.forEach(tgAskDrop); return 'never'; }
  // A retry keeps this inactive exact binding; it cannot bind old text to changed arguments or facts.
  if (!failed) bound.forEach(tgAskDelivered);
  if (!failed && onSent) onSent();
  return !failed ? 'sent' : TELL_NEVER.has(failed) ? 'never' : 'later';
}
// Only newly generated owner credentials use this path. Their value never joins a chat, retry record or audit.
async function tellOwnerSecret(text, ctx) {
  if (!isOwnerPress(ctx) || !tgOwnerContextValid(ctx)) throw new HttpError(403, 'Only your confirmed paired Telegram request can receive a new key here.');
  return tell('system', text, { [TELL_SECRET]: true });
}
// Telegram's answers that will never turn into a send (tgCall's codes): a token refused (401, 404), a request refused
// (400, 403: the chat gone, the bot blocked), Telegram off here. Tried again: 429 (slow down) and 409 ("in-use": another
// program is reading the bot's updates, which says nothing about this message; it can stop), and no answer.
const TELL_NEVER = new Set(['refused', 'bad-request', 'off']);
// A result that must reach the paired chat (a task's report, an operation's line, a press's late result): a send that
// failed for now is tried again a few times with a growing wait (A-8: tgSend's own three tries span seconds), one that
// never will is not, and a dropped one is said in the journal. TELL_TRIES in all.
const TELL_TRIES = 4, TELL_RETRY_MS = Number(ALL_LOCAL && process.env.SPARK_CONSOLE_TELL_RETRY_MS) || 60000;
const tellWait = n => TELL_RETRY_MS * 2 ** Math.max(0, n - 1);
const tellDropped = (what, fields = {}) => { try { journal('event', { act: 'telegram-dropped', outcome: 'dropped', what, ...fields }); } catch {} };
// In memory (a restart forgets the tries left): an operation's line, a press's late result. Each try goes only to the
// pairing it was meant for (mark, taken at the first: final read C4); paired with another since, it is dropped.
// Also used by job ends, recovery notes, install results and carry-on replies; no delivery claim survives a restart.
async function tellAgain(why, text, opts, what, fields = {}, n = 1, mark = tgPairingMark()) {
  if (mark !== tgPairingMark()) { opts?.onDropped?.(); tellDropped(what, { ...fields, tries: n - 1, err: 'another pairing' }); return 'never'; }
  const got = await tellTry(why, text, opts).catch(() => 'later');
  if (got === 'later' && n < TELL_TRIES) { setTimeout(() => tellAgain(why, text, opts, what, fields, n + 1, mark).catch(() => {}), tellWait(n)).unref?.(); return got; }
  if (got !== 'sent') { opts?.onDropped?.(); tellDropped(what, { ...fields, tries: n, err: got }); }
  return got;
}

// An operation's result on Telegram: a fixed line from its type, name, Spark and status. No error text, log line,
// endpoint or address (the page's chat keeps the full notice).
const TELL_OPS = {
  deploy: 'Starting',
  'deploy-cluster': 'Starting',
  'power-off': 'Powering off',
  'power-on': 'Turning on',
  restart: 'Restarting',
  'restart-model': 'Restarting',
  run: 'The command',
  'self-test': 'The self-test with',
  'start-model': 'Starting',
  stop: 'Stopping',
  'stop-model': 'Stopping',
  undo: 'Undoing the last change',
};
const tellName = s => String(s || '').replace(/[^A-Za-z0-9._/:-]/g, '').slice(0, 60);
function tellWhat(job) {
  const name = tellName(job.model || job.container);
  const where = (job.nodes || [job.node]).filter(Boolean).map(id => sparkName(nodeById(id) || { id: tellName(id) })).join(' + ');
  if (/^power-/.test(job.type)) return `${TELL_OPS[job.type]} ${where || 'a Spark'}${name ? ` for “${name}”` : ''}`;
  return `${TELL_OPS[job.type] || 'The operation'}${name ? ` “${name}”` : ''}${where ? ` on ${where}` : ''}`;
}
function tellResultLine(job) {
  const what = tellWhat(job);
  // (a saved workflow's clean-up stop that left it running: never "finished", A-22)
  if (job.status === 'completed' && job.left) return `${what}: left running, as it was started again since, not by this run.`;
  // (a long command's exit code, a number: an exit other than 0 is a result, told as one, 21-long.mjs)
  if (job.status === 'completed') return `Done: ${what.charAt(0).toLowerCase()}${what.slice(1)} finished${job.type === 'run' && Number.isInteger(job.exit) ? ` with exit code ${job.exit}` : ''}.`;
  if (job.status === 'cancelled') return `${what} was cancelled.`;
  return maskSecrets(`${what} didn’t work.${job.error ? `\n${job.error}` : ' Ask for its operation log.'}${job.cleanUp ? `\n${job.cleanUp}` : ''}`);
}
// Operations started from Telegram are noted in telegram.json until they report, so one cut off by a restart still
// gets its line afterwards.
function tellAwait(job) {
  const st = tgSaved();
  st.awaiting = [...(st.awaiting || []).filter(x => x.id !== job.id), { id: job.id, what: tellWhat(job) }].slice(-20);
  tgSave();
}
function tellAwaitDone(id) {
  const st = tgSaved();
  if (!(st.awaiting || []).some(x => x.id === id)) return;
  st.awaiting = st.awaiting.filter(x => x.id !== id);
  tgSave();
}
// One message per request: while Sparkie will carry on with it, results wait, and go only if that turn can't answer.
const tellHeld = new Map();
function tellResult(job, conv) {
  tellAwaitDone(job.id);
  const line = tellResultLine(job);
  if (conv.task?.channel === 'telegram') { tellHeld.set(conv.id, [...(tellHeld.get(conv.id) || []), line].slice(-4)); return; }
  // (lines held for a request the owner has since moved on from go out with this one)
  const held = tellHeld.get(conv.id) || [];
  tellHeld.delete(conv.id);
  // (a send that failed for now is tried again, A-8)
  tellAgain('result', [...held, line].join('\n'), {}, 'result', { op: job.id, chat: conv.id }).catch(() => {});
}
async function tellCarry(convId, message, last = false) {
  const held = tellHeld.get(convId) || [];
  tellHeld.delete(convId);
  if (message && !message.error && String(message.content || '').trim()) return (await tellAgain('carry', tellReplyText(message), { buttons: tellButtons(message), last }, 'carry', { chat: convId })) === 'sent';
  if (held.length) return (await tellAgain('result', held.join('\n'), {}, 'carry', { chat: convId })) === 'sent';
  return false;
}
// The pending choice owns its full code-built question, even after the page's eight-ask display limit or in a
// pressed follow-up. Model words cannot replace those facts. Owner-only and dangerous asks have their own sender.
function tellReplyText(message) {
  const content = String(message.content || '').trim();
  const open = (message.choices || []).filter(c => c.state === 'open').map(c => pendingChoices.get(c.id)).filter(Boolean);
  const plain = open.filter(c => !c.ownerOnly && !c.danger), facts = [], groups = new Set();
  const add = text => { if (text && !content.includes(text) && !facts.some(x => x.includes(text))) facts.push(text); };
  for (const c of plain) {
    if (typeof c.question !== 'string') continue;
    if (!groups.has(c.group)) { groups.add(c.group); add(c.question); }
    add(String(c.label || ''));
  }
  const waiting = (message.choices || []).some(c => c.state === 'open' && pendingChoices.get(c.id)?.ownerOnly && !tgAsks.has(c.id));
  const incomplete = plain.some(c => typeof c.question !== 'string');
  return [content, ...facts, ...(waiting ? ['That confirmation has not been delivered here. Ask for it again.'] : []),
    ...(incomplete ? ['That choice has no complete question here. Ask for it again.'] : [])].filter(Boolean).join('\n\n');
}
// Only plain choices with their canonical question can use this sender; the label comes from that same pending call.
const tellButtons = message => (message.choices || [])
  .filter(c => { const p = pendingChoices.get(c.id); return c.state === 'open' && p && !p.ownerOnly && !p.danger && typeof p.question === 'string'; })
  .slice(0, 4).map(c => ({ id: c.id, label: String(pendingChoices.get(c.id).label).slice(0, 60) }));

/* ───────── the needs-me line (H5, R32; the owner's decision 6, 2026-11-11) ───────── */
// Off until the owner switches it on in Spark Console with the passkey (PUT /telegram/needs; kept with the binding in
// the secrets file, so disconnecting or a new token turns it off). Then, when something new joins the open-problems list
// (20-needs.mjs) and has stayed on it 5 minutes, one fixed line goes to the paired chat: a count and where to look, nothing
// from the list. At most 3 in 24 hours, never while Telegram isn't working. A problem already told counts as new again
// only after 6 hours off the list. What was told and when is in telegram.json, so a restart repeats nothing. No brain
// turn, no action.
const NEEDS_MS = Number(process.env.SPARK_CONSOLE_NEEDS_MS || 60000), NEEDS_A_DAY = 3, NEEDS_AGAIN_MS = 6 * 3600000;
const NEEDS_SETTLE_MS = Number(process.env.SPARK_CONSOLE_NEEDS_SETTLE_MS || 300000);
const needsLine = n => `Spark Console: ${n === 1 ? '1 thing needs' : `${n} things need`} you. Send /status to see ${n === 1 ? 'it' : 'them'}.`;
// Told problems that are off the list, and when this process first saw each gone (memory only: a restart forgets nothing told).
const needsGone = new Map();
// Open problems and when this process first saw each open (memory only). One counts as new only once it has stayed open
// NEEDS_SETTLE_MS, so what puts itself right (a Docker look missed once, a model held while its Spark wakes) sends
// nothing; one that closes and opens again starts its clock again.
const needsSince = new Map();
let needsBusy = false;
async function needsMeTick() {
  if (needsBusy || draining) return;
  needsBusy = true;
  try {
    if (tgPaired()?.needsMe !== true) { needsSince.clear(); return; }
    const open = [...new Set(openProblems().map(p => String(p.key)))], now = Date.now();
    for (const k of needsSince.keys()) if (!open.includes(k)) needsSince.delete(k);
    for (const k of open) if (!needsSince.has(k)) needsSince.set(k, now);
    if (tg.state !== 'ok') return;
    const settled = open.filter(k => now - needsSince.get(k) >= NEEDS_SETTLE_MS);
    const st = tgSaved(), n = st.needs || {};
    const told = (n.told || []).filter(k => {
      if (open.includes(k)) { needsGone.delete(k); return true; }
      if (!needsGone.has(k)) needsGone.set(k, now);
      return now - needsGone.get(k) < NEEDS_AGAIN_MS;
    });
    const sent = (n.sent || []).filter(t => now - t < 86400000);
    if (!settled.some(k => !told.includes(k)) || sent.length >= NEEDS_A_DAY) return;
    if (!await tell('needs', needsLine(open.length))) return;
    st.needs = { told: [...new Set([...told, ...settled])], sent: [...sent, now] };
    tgSave();
  } catch (e) { console.error(`The needs-me line: ${e.message}`); } finally { needsBusy = false; }
}
