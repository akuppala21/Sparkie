/* ───────── the paired owner’s confirmations on Telegram ───────── */
// Area: safety        Rules: R32, R06        Tests: tg-approve.test.mjs, telegram-parity-transport.test.mjs
// Owns: none
// Timers: none        Wakes: none
// The current paired owner has the same choices as the page. A confirmation becomes usable only after every part
// is acknowledged. Its group, action, arguments and pairing stay bound; a lock, expiry or re-pair revokes it.
const tgAsks = new Map();
let tgApproveOff = false;
const tgApproveOn = () => { const p = tgPaired(); return Boolean(p && p.approve === true && !tgApproveOff); };
const tgApprovalsLine = () => (!tgPaired() ? 'Approvals from Telegram: off (no Telegram chat is paired).'
  : tgApproveOn() ? 'Approvals from Telegram: on. Your paired chat has the same owner controls as the page; /lock turns approvals off.'
    : 'Approvals from Telegram: off. Turn them on again in your owner controls.');
const tgAskable = c => Boolean(c && typeof c.ownerOnly === 'boolean');
const tgUnlockChoice = c => c?.action === OWNER_ADMIN && c.args?.op === 'telegram_approvals' && c.args?.on === true;
const tgAskFingerprint = c => createHash('sha256').update(JSON.stringify([c.group, c.action, c.args, c.label, c.question ?? null, c.always || null, c.covers || null, c.ahead || null, c.danger || null])).digest('hex');
function tgAskBinding(ids, group, conv) {
  const p = tgPaired(), choices = ids.map(id => pendingChoices.get(id));
  if (!p || !ids.length || choices.some(c => !tgAskable(c))) return null;
  const unlock = choices.some(tgUnlockChoice) && choices.every(c => !c.action || tgUnlockChoice(c));
  const plain = choices.every(c => !c.ownerOnly);
  if (!tgApproveOn() && !unlock && !plain) return null;
  const sent = { chatId: p.chatId, userId: p.userId, pairedAt: p.pairedAt || null, group, conv, ids, unlock, plain, ready: false,
    fingerprints: Object.fromEntries(ids.map((id, i) => [id, tgAskFingerprint(choices[i])])) };
  for (const id of ids) tgAsks.set(id, sent);
  return sent;
}
function tgAskCurrent(sent) {
  const p = tgPaired();
  return Boolean(sent && p && sent.chatId === p.chatId && sent.userId === p.userId && sent.pairedAt === (p.pairedAt || null)
    && (tgApproveOn() || sent.unlock || sent.plain) && sent.ids.every(id => {
      const c = pendingChoices.get(id);
      return tgAsks.get(id) === sent && c && c.group === sent.group && Date.now() - c.at <= 15 * 60000 && tgAskFingerprint(c) === sent.fingerprints[id];
    }));
}
function tgAskDrop(sent) { for (const id of sent?.ids || []) if (tgAsks.get(id) === sent) tgAsks.delete(id); }
function tgAskDelivered(sent) {
  if (!tgAskCurrent(sent)) { tgAskDrop(sent); return; }
  sent.ready = true;
}
function tgAskText(q) {
  const question = String(q.question || '');
  const yes = (q.choices || []).filter(c => c.choice && pendingChoices.get(c.choice)?.action).map(c => String(c.label)).filter(l => !question.includes(l));
  return [question, ...yes].join('\n\n');
}
function tgAsk(viewer, ctx, q, text = null) {
  try {
    const owner = String(accessList().owner || '').toLowerCase();
    const conv = ctx?.conv ? chatData().conversations.find(c => c.id === ctx.conv) : null;
    if (!conv || String(conv.login || '').toLowerCase() !== owner || viewer?.role !== 'owner') return false;
    const shown = (q.choices || []).filter(c => c.choice);
    const sent = tgAskBinding(shown.map(c => c.choice), q.group, conv.id);
    if (!sent) return false;
    const name = maskSecrets(String(conv.agent?.name || ctx.actor || 'An agent')).replace(/\s+/g, ' ').slice(0, 80);
    const words = `${conv.agent || ctx.agent || ctx.agentId || viewer.agentKey ? `Agent “${name}” asked. Only your confirmation runs it.\n\n` : ''}${text ?? tgAskText(q)}`;
    tellAgain('ask', words, {
      buttons: shown.slice(0, 4).map(c => ({ id: c.choice, label: String(c.label).slice(0, 60) })), keep: Array.isArray(q.whole) ? q.whole : [],
      isCurrent: () => tgAskCurrent(sent), onSent: () => tgAskDelivered(sent), onDropped: () => tgAskDrop(sent),
    }, 'owner-confirmation', { chat: conv.id }).catch(() => tgAskDrop(sent));
    return true;
  } catch (e) { console.error(`Asking on Telegram: ${e.message}`); return false; }
}
function tgAskOpen(id, c) {
  const sent = tgAsks.get(id);
  return Boolean(sent?.ready && c && tgAskCurrent(sent) && sent.fingerprints[id] === tgAskFingerprint(c));
}
const tgAskedThere = message => { const open = (message?.choices || []).filter(c => c.state === 'open'); return open.length > 0 && open.every(c => tgAsks.has(c.id)); };
// Counts remain useful on the record; they never reduce the owner’s permissions on one channel.
const tgApprovals = () => (tgSaved().approvals || []).filter(t => Number.isFinite(t) && Date.now() - t < 86400000);
const tgApprovalsHeld = () => null;
function tgApproving(choice) {
  const c = pendingChoices.get(choice), sent = tgAsks.get(choice);
  if (!c || !sent) return { answer: dangerGone(choice) || 'That button has expired. Ask again.' };
  const conv = chatData().conversations.find(x => x.id === sent.conv && sparkieWho(tgOwner(), x.id) === c.who);
  if (!conv) return { answer: 'That button has expired. Ask again.' };
  if (sent && !sent.ready && tgAskCurrent(sent)) return { answer: 'The full confirmation is still being sent. Try its button again in a moment.' };
  if (!tgAskOpen(choice, c)) return { answer: 'That confirmation is no longer open here. Ask again.' };
  if (c.danger && c.action) return { answer: dangerPressedHere(choice) };
  return { conv, c };
}
function tgApprovalCounted(ask) {
  if (!ask.c.action) return;
  const st = tgSaved(); st.approvals = [...tgApprovals(), Date.now()]; tgSave();
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
  // (every chat's go-ahead goes with the old pairing, 21-ahead.mjs)
  aheadEndAll();
  tgApproveOff = false;
}
// /lock revokes existing Telegram confirmations. A fresh approvals-on owner confirmation can unlock it.
function tgLock() {
  const was = tgApproveOn();
  tgApproveOff = true;
  tgAsksVoid(false);
  let kept = true;
  try { if (tgBinding()) secretsWrite(s => ({ ...s, telegram: { ...s.telegram, approve: false } })); } catch (e) { kept = false; console.error(`/lock wasn’t saved: ${e.message}`); }
  audit({ via: 'telegram', actor: 'owner on Telegram', action: 'telegram-approve', args: { on: false, word: '/lock' }, ok: kept });
  if (was) fleetEvent({ type: 'notice', text: 'Approvals from Telegram were turned off from Telegram (/lock). Only you can turn them on again, with a fresh confirmation in your owner controls.' });
  return `${was ? 'Locked' : 'Already locked'}: nothing is approved from here now. Turn approvals on again with a fresh confirmation in your owner controls.${kept ? '' : ' Spark Console couldn’t save this, so it holds only until it restarts: turn them off there too.'}`;
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
