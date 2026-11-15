/* ───────── approving from Telegram: the owner's yes from the paired chat (A10a) ───────── */
// Area: safety        Rules: R32, R06        Tests: tg-approve.test.mjs
// Owns: none
// Timers: none        Wakes: none
// The owner's yes may come from Telegram (owner decisions 20 and 22; contract 8.7, 8.17). A question only the owner
// answers (`question(…, { ownerOnly: true })`, 17-changes.mjs: today's owner-only buttons, and whatever a later step
// calls risky) asked in one of the owner's own chats is also sent to the paired chat as one ask, built by code: the
// question and each yes in full, with the page's own buttons. A press there is the owner's yes only when all hold:
// - "Approve from Telegram" is on: `approve` beside the pairing in the secrets file. On needs the passkey, off never
//   does; a new pairing turns it on; a pairing made before the switch existed reads as off. `/lock` in the paired chat
//   turns it off at once, and only the page turns it on again;
// - this console sent that ask to the chat paired now, and it is still open (one press; 15 minutes, as every button);
// - its action may run from a channel (never one in PAGE_ONLY: going back a build, memory, saved workflows);
// - fewer than 3 approvals from Telegram in the last hour and 10 in the last 24 hours. Their times are kept in
//   telegram.json, so a restart forgets none; over either, the ask waits for the page.
// A typed "ok" never answers one (sparkieTurn's typed yes skips owner-only buttons). Every approval is echoed on the
// page: a line in the chat that asked, and a notice. An ask's Telegram side is void after /lock or the switch off; the
// whole ask is void after a new pairing, and after a restart (asks live in memory only). Over 3,500 characters an ask
// is answered on the page only. An agent's conversation is not asked here (that is the dangerous ask's, A10b).
const TG_ASK_MAX = 3500;
const TG_APPROVALS = { hour: 3, day: 10 };
// Each button of an ask sent to the paired chat: the pairing it went to, its group, and the chat it belongs to here.
const tgAsks = new Map();
// Off at once (/lock, the switch off), whatever happens to the secrets file.
let tgApproveOff = false;
const tgApproveOn = () => { const p = tgPaired(); return Boolean(p && p.approve === true && !tgApproveOff); };
// Whether approvals from Telegram are on, in one plain line (sparkie_setup, and /status in the paired chat).
const tgApprovalsLine = () => (!tgPaired() ? 'Approvals from Telegram: off (no Telegram chat is paired).'
  : tgApproveOn() ? `Approvals from Telegram: on. A press in your paired chat counts as your yes for a change Spark Console asks about, at most ${TG_APPROVALS.hour} an hour and ${TG_APPROVALS.day} a day; /lock there turns it off.`
    : 'Approvals from Telegram: off. What needs your yes waits for you in Spark Console; turn it on there (your account menu → Agents and Telegram), with your passkey.');
// A pending choice whose answer may come from Telegram: owner-only, and not an action that never runs from a channel.
const tgAskable = c => Boolean(c?.ownerOnly && !(c.action && PAGE_ONLY.has(c.action)));

// The ask's words, all built by code: the question, then each yes it doesn't already hold, whole.
function tgAskText(q) {
  const question = String(q.question || '');
  const yes = (q.choices || []).filter(c => c.choice && pendingChoices.get(c.choice)?.action).map(c => String(c.label)).filter(l => !question.includes(l));
  return [question, ...yes].join('\n\n');
}
// question() calls this for an owner-only question with buttons. It sends one ask, or nothing: approvals off, a chat
// that isn't the owner's own, a page-only action, or more than 3,500 characters. text: a later step's own words for it.
function tgAsk(viewer, ctx, q, text = null) {
  try {
    const p = tgPaired(), owner = String(accessList().owner || '').toLowerCase();
    const conv = ctx?.conv ? chatData().conversations.find(c => c.id === ctx.conv) : null;
    if (!p || !tgApproveOn() || !conv || conv.agent || ctx.agent || String(conv.login || '').toLowerCase() !== owner || viewer?.role !== 'owner') return false;
    const shown = (q.choices || []).filter(c => c.choice);
    if (!shown.length || !shown.every(c => tgAskable(pendingChoices.get(c.choice)))) return false;
    const words = text ?? tgAskText(q);
    // Nobody approves what they can't read.
    if (words.length > TG_ASK_MAX) return false;
    for (const id of tgAsks.keys()) if (!pendingChoices.has(id)) tgAsks.delete(id);
    // (kept before it is sent, so a press that comes back at once finds it; dropped if it never went)
    const sent = { chatId: p.chatId, userId: p.userId, pairedAt: p.pairedAt || null, group: q.group, conv: conv.id };
    for (const c of shown) tgAsks.set(c.choice, sent);
    const drop = () => { for (const c of shown) if (tgAsks.get(c.choice) === sent) tgAsks.delete(c.choice); };
    tell('ask', words, { buttons: shown.slice(0, 4).map(c => ({ id: c.choice, label: String(c.label).slice(0, 60) })) }).then(ok => { if (!ok) drop(); }, drop);
    return true;
  } catch (e) { console.error(`Asking on Telegram: ${e.message}`); return false; }
}
// runChoice's check of a press from Telegram: an ask sent to the chat paired now, approvals on, its action allowed there.
function tgAskOpen(id, c) {
  const sent = tgAsks.get(id), p = tgPaired();
  return Boolean(sent && p && c && sent.chatId === p.chatId && sent.userId === p.userId && sent.pairedAt === (p.pairedAt || null)
    && sent.group === c.group && tgApproveOn() && tgAskable(c));
}
// Every open choice of a message went to Telegram as an ask (so a reply there would only say it again).
const tgAskedThere = message => { const open = (message?.choices || []).filter(c => c.state === 'open'); return open.length > 0 && open.every(c => tgAsks.has(c.id)); };

// The approvals from Telegram in the last 24 hours (their times, in telegram.json: a restart forgets none).
const tgApprovals = () => (tgSaved().approvals || []).filter(t => Number.isFinite(t) && Date.now() - t < 86400000);
function tgApprovalsHeld() {
  const day = tgApprovals(), hour = day.filter(t => Date.now() - t < 3600000);
  if (hour.length >= TG_APPROVALS.hour) return `That’s ${TG_APPROVALS.hour} approvals from Telegram in the last hour, the most it may give. This one waits for you in Spark Console.`;
  if (day.length >= TG_APPROVALS.day) return `That’s ${TG_APPROVALS.day} approvals from Telegram in the last 24 hours, the most it may give. This one waits for you in Spark Console.`;
  return null;
}
// A press in the paired chat (tgPress): null when it isn't on one of the owner's owner-only buttons (a plain button goes
// on as before); { answer } when it runs nothing, and why; { conv, c } when it may run, as the owner's yes.
function tgApproving(choice) {
  const c = pendingChoices.get(choice), sent = tgAsks.get(choice);
  if (!c?.ownerOnly) {
    if (sent) tgAsks.delete(choice);
    // (a dangerous ask's button after it closed: 20-danger.mjs)
    return sent || dangerGone(choice) ? { answer: dangerGone(choice) || 'That button has expired. Ask again.' } : null;
  }
  const conv = chatData().conversations.find(x => sparkieWho(tgOwner(), x.id) === c.who);
  if (!conv) return { answer: 'That button has expired. Ask again.' };
  // Not sent here, sent to a chat paired before this one, or approvals off or locked: the page answers it.
  if (!tgAskOpen(choice, c)) return { answer: 'That one waits for you in Spark Console.' };
  if (putBackHeld()) return { answer: PUTBACK_TG };
  const held = c.action ? tgApprovalsHeld() : null;
  if (held) {
    audit({ via: 'telegram', actor: 'owner on Telegram', action: 'telegram-approval-held', args: { chat: conv.id }, ok: true });
    return { answer: held };
  }
  // A dangerous ask's yes runs only with its two digits, typed as the next message here (20-danger.mjs).
  if (c.danger && c.action) return { answer: dangerPressedHere(choice) };
  return { conv, c };
}
// Counted before it runs: a yes that then fails still counts.
function tgApprovalCounted(ask) {
  if (!ask.c.action) return;
  const st = tgSaved();
  st.approvals = [...tgApprovals(), Date.now()];
  tgSave();
}
// Every approval is echoed on the page: runChoice's line in the chat says so, and this notice.
function tgApproved(ask, conv, r) {
  if (!ask.c.action || r?.outcome === 'declined') return;
  const label = maskSecrets(String((ask.c.danger && dangerHeadOf(ask.c.danger)) || ask.c.label || '')).slice(0, 200);
  audit({ via: 'telegram', actor: 'owner on Telegram', action: 'telegram-approved', args: { label, chat: conv.id }, ok: r?.outcome !== 'error' });
  fleetEvent({ type: 'notice', text: `Approved from Telegram: “${label}”. If that wasn’t you, send /lock there, or turn approvals from Telegram off in your account menu → Agents and Telegram.` });
}

// everywhere: the whole ask is void (a new pairing: the page's buttons go grey too); else only its Telegram side.
function tgAsksVoid(everywhere) {
  dangerTelegramGone(everywhere);
  if (everywhere && tgAsks.size) {
    const groups = new Set([...tgAsks.values()].map(x => x.group)), convs = new Set([...tgAsks.values()].map(x => x.conv));
    for (const [id, c] of pendingChoices) if (groups.has(c.group)) pendingChoices.delete(id);
    for (const conv of chatData().conversations.filter(x => convs.has(x.id))) {
      for (const m of conv.messages) for (const x of m.choices || []) if (groups.has(x.group) && x.state === 'open') x.state = 'gone';
    }
    saveChats();
  }
  tgAsks.clear();
}
// A new pairing (tgTryPair): what was asked of the chat paired before is void everywhere, and approvals are on (the
// pairing wrote approve: true; its code came only from the passkey page).
function tgNewPairing() {
  tgAsksVoid(true);
  tgApproveOff = false;
}
// /lock in the paired chat: approvals from Telegram off at once, and every ask's Telegram side void. Only the page turns
// them on again.
function tgLock() {
  const was = tgApproveOn();
  tgApproveOff = true;
  tgAsksVoid(false);
  let kept = true;
  try { if (tgBinding()) secretsWrite(s => ({ ...s, telegram: { ...s.telegram, approve: false } })); } catch (e) { kept = false; console.error(`/lock wasn’t saved: ${e.message}`); }
  audit({ via: 'telegram', actor: 'owner on Telegram', action: 'telegram-approve', args: { on: false, word: '/lock' }, ok: kept });
  if (was) fleetEvent({ type: 'notice', text: 'Approvals from Telegram were turned off from Telegram (/lock). Only you can turn them on again, in your account menu → Agents and Telegram, with your passkey.' });
  return `${was ? 'Locked' : 'Already locked'}: nothing is approved from here now. What needs your yes waits for you in Spark Console, where you can turn approvals from Telegram on again with your passkey.${kept ? '' : ' Spark Console couldn’t save this, so it holds only until it restarts: turn them off there too.'}`;
}
// PUT /telegram/approve {on} (telegramRoute): on needs the passkey (the gate) and a paired chat; off never does.
async function tgApproveRoute(req) {
  const on = (await readBody(req, 2000))?.on;
  if (typeof on !== 'boolean') throw new HttpError(400, 'Send {"on": true} or {"on": false}.');
  if (on && !tgPaired()) throw new HttpError(409, 'Pair your Telegram chat first.');
  // Off at once, whatever happens to the file; on only once it is saved.
  if (!on) { tgApproveOff = true; tgAsksVoid(false); }
  if (tgBinding()) secretsWrite(s => ({ ...s, telegram: { ...s.telegram, approve: on } }));
  if (on) tgApproveOff = false;
  audit({ via: 'page', actor: 'owner', action: 'telegram-approve', args: { on }, ok: true });
  return telegramView();
}
