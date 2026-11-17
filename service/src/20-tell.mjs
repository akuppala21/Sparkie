/* ───────── telling the owner on Telegram ───────── */
// Area: safety        Rules: R32        Tests: telegram.test.mjs, needs-me.test.mjs, tasks-telegram.test.mjs
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
// 20 owner messages a minute in, 20 sends a minute out, 6 results and carry-on lines an hour. Tests on the stand-in fleet
// may raise them (SPARK_CONSOLE_TELEGRAM_LIMITS="in,out,results"), only under ALL_LOCAL.
const TELL_LIMITS = (() => {
  const m = ALL_LOCAL && /^(\d+),(\d+),(\d+)$/.exec(process.env.SPARK_CONSOLE_TELEGRAM_LIMITS || '');
  return m ? { in: Number(m[1]), out: Number(m[2]), results: Number(m[3]) } : { in: 20, out: 20, results: 6 };
})();
const tellSends = [], tellResults = [];
let tellOwnerAt = 0;

// Up to 3 messages of 4,000 characters, split at paragraph ends; anything more is cut, with where the rest is.
function tellParts(text) {
  const parts = [];
  let rest = String(text).trim();
  while (rest && parts.length < 3) {
    if (rest.length <= TELL_PART) { parts.push(rest); rest = ''; break; }
    let at = rest.lastIndexOf('\n\n', TELL_PART);
    if (at < TELL_PART / 2) at = rest.lastIndexOf('\n', TELL_PART);
    if (at < TELL_PART / 2) at = rest.lastIndexOf(' ', TELL_PART);
    if (at < TELL_PART / 2) at = TELL_PART;
    parts.push(rest.slice(0, at).trimEnd());
    rest = rest.slice(at).trimStart();
  }
  if (rest) parts[parts.length - 1] = `${parts[parts.length - 1].slice(0, TELL_PART - 40).trimEnd()}\n\n(the rest is in Spark Console)`;
  return parts.filter(Boolean);
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
// pre: an exact command, sent whole in a fixed-width block after text, then tail (20-danger.mjs): one message, never cut;
// too long for one, and nothing is sent.
const tellBlock = (head, code, tail) => {
  const text = `${head.trim()}\n\n${code}${tail.trim() ? `\n\n${tail.trim()}` : ''}`;
  return code && text.length <= TELL_PART ? [{ text, entities: [{ type: 'pre', offset: head.trim().length + 2, length: code.length }] }] : [];
};
// true when it went; tellTry says why not: 'later' (Telegram not answering, slowing it down, a limit here holding it) or
// 'never' (nobody paired, nothing to send, or Telegram refused it: the chat gone, the bot blocked, a token refused).
async function tell(why, text, opts = {}) { return (await tellTry(why, text, opts)) === 'sent'; }
async function tellTry(why, text, { buttons = null, to = null, pre = null, tail = '', keep = [], last = false } = {}) {
  if (!TELL_WHY.has(why)) throw new Error(`Spark Console doesn’t send “${why}” to Telegram.`);
  const b = why === 'system' && to ? to : tgPaired();
  if (!b) return 'never';
  const now = Date.now();
  while (tellSends.length && now - tellSends[0] > 60000) tellSends.shift();
  while (tellResults.length && now - tellResults[0] > 3600000) tellResults.shift();
  const later = why === 'result' || why === 'carry';
  // 6 results and carry-on lines an hour (the rest stay in the page's chat), 20 sends a minute in all.
  // (a request's last reply is never held back by it: last)
  if (later && !last && tellResults.length >= TELL_LIMITS.results) { audit({ via: 'telegram', actor: 'Spark Console', action: 'telegram-held', args: { why }, ok: true }); return 'later'; }
  const parts = pre === null ? tellParts(tellClean(text, b.token, keep)) : tellBlock(tellClean(text, b.token), tellClean(pre, b.token), tellClean(tail, b.token));
  if (!parts.length) return 'never';
  if (tellSends.length + parts.length > TELL_LIMITS.out) { audit({ via: 'telegram', actor: 'Spark Console', action: 'telegram-held', args: { why, limit: 'minute' }, ok: true }); return 'later'; }
  if (later) tellResults.push(now);
  const silent = later && now - tellOwnerAt > TELL_QUIET_MS;
  let failed = null;
  for (const [i, p] of parts.entries()) {
    tellSends.push(Date.now());
    const sent = await tgSend(b, p.text ?? p, { silent, buttons: i === parts.length - 1 ? buttons : null, entities: p.entities });
    if (sent !== true) failed ||= sent || 'unreachable';
  }
  audit({ via: 'telegram', actor: 'Spark Console', action: 'telegram-send', args: { why, parts: parts.length, chars: parts.reduce((n, p) => n + (p.text ?? p).length, 0) }, ok: !failed });
  return !failed ? 'sent' : TELL_NEVER.has(failed) ? 'never' : 'later';
}
// Telegram's answers that will never turn into a send (tgCall's codes): a token refused (401, 404), a request refused
// (400, 403: the chat gone, the bot blocked), Telegram off here.
const TELL_NEVER = new Set(['refused', 'bad-request', 'off']);
// A result that must reach the paired chat (a task's report, an operation's line, a press's late result): a send that
// failed for now is tried again a few times with a growing wait (A-8: tgSend's own three tries span seconds), one that
// never will is not, and a dropped one is said in the journal. TELL_TRIES in all.
const TELL_TRIES = 4, TELL_RETRY_MS = Number(ALL_LOCAL && process.env.SPARK_CONSOLE_TELL_RETRY_MS) || 60000;
const tellWait = n => TELL_RETRY_MS * 2 ** Math.max(0, n - 1);
const tellDropped = (what, fields = {}) => { try { journal('event', { act: 'telegram-dropped', outcome: 'dropped', what, ...fields }); } catch {} };
// In memory (a restart forgets the tries left): an operation's line, a press's late result.
async function tellAgain(why, text, opts, what, fields = {}, n = 1) {
  const got = await tellTry(why, text, opts).catch(() => 'later');
  if (got === 'later' && n < TELL_TRIES) { setTimeout(() => tellAgain(why, text, opts, what, fields, n + 1).catch(() => {}), tellWait(n)).unref?.(); return got; }
  if (got !== 'sent') tellDropped(what, { ...fields, tries: n, err: got });
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
  return `${what} didn’t work. The details are in Spark Console.`;
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
  if (message && !message.error && String(message.content || '').trim()) return tell('carry', tellReplyText(message), { buttons: tellButtons(message), last });
  if (held.length) return tell('result', held.join('\n'));
  return false;
}
// What a Sparkie answer says on Telegram: its words, and a line for anything that waits in Spark Console (an owner-only
// button that went to Telegram as its own ask doesn't).
function tellReplyText(message) {
  const waiting = (message.choices || []).some(c => c.state === 'open' && pendingChoices.get(c.id)?.ownerOnly && !tgAsks.has(c.id));
  return `${String(message.content || '').trim()}${waiting ? '\n\nThat one waits for you in Spark Console.' : ''}`;
}
// Its buttons on Telegram: only the plain ones (never an owner-only one), at most 4.
const tellButtons = message => (message.choices || [])
  .filter(c => c.state === 'open' && pendingChoices.has(c.id) && !pendingChoices.get(c.id).ownerOnly)
  .slice(0, 4).map(c => ({ id: c.id, label: String(c.label).slice(0, 60) }));

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
