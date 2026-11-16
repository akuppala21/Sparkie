/* ───────── Telegram: the owner talks to Sparkie from any phone or laptop ───────── */
// Area: features        Rules: R32, R34        Tests: telegram.test.mjs
// Owns: telegram.json (writers: tgSave)
// Timers: tgLoop (the long poll, one at a time, with a pause after a failure), tgTyping (“typing…” every 4.5 s while
//   Sparkie answers, 5 minutes at most)
// Wakes: none
// Spark 2 asks Telegram for new messages over one outbound HTTPS connection (long polling): no route, port or Funnel,
// so it works with Tailscale off on the owner's devices and with the console tailnet-only. One private chat, paired
// with a one-time code only the passkey page shows, is a turn in the owner's own Sparkie chat with the same gates as
// the page. Everyone else gets silence. Going back a build, memory and saved workflows wait as an owner-only button in
// Spark Console; access, agent keys, passkeys and devices have no path from here at all. (docs/architecture.md R32,
// docs/analysis-2026-11-11/09-telegram-design.md.)
const TG_HOST = 'https://api.telegram.org';
// Tests point it at a stand-in on this machine; under ALL_LOCAL without one, Telegram is off.
const TG_API = ALL_LOCAL ? (/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.SPARK_CONSOLE_TELEGRAM_API || '') ? process.env.SPARK_CONSOLE_TELEGRAM_API : null) : TG_HOST;
const TG_FILE = `${STATE_DIR}/telegram.json`;
const TG_POLL_S = Math.max(1, Math.round(Number(process.env.SPARK_CONSOLE_TELEGRAM_POLL_MS || 25000) / 1000));
const TG_CODE_MS = Number(process.env.SPARK_CONSOLE_TELEGRAM_CODE_MS || 600000);
const TG_STALE_MS = Number(process.env.SPARK_CONSOLE_TELEGRAM_STALE_MS || 300000);
const TG_RETRY_MS = Number(process.env.SPARK_CONSOLE_TELEGRAM_RETRY_MS || 2000);
const TG_TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{30,64}$/, TG_TOKEN_IN = /\b\d{6,12}:[A-Za-z0-9_-]{30,64}\b/;
const TG_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TG_BRAIN_DOWN = 'Sparkie’s model isn’t answering. /status shows where things stand, and /restart sparkie restarts it from here.';
// The pairing line, also the answer to /start and /help.
const TG_HELLO = 'Paired with Spark Console. Say what you need, as you would in the chat there. /new starts a new chat, /status says where things stand, /pause pauses agents’ changes, /restart sparkie restarts Sparkie’s model, /stop ends Sparkie’s answer here, /lock stops approvals from here, /unpair disconnects this chat.';

// The token and the paired chat live in the secrets file (03-secrets.mjs), never in the state folder.
// Disconnecting turns Telegram off in memory at once, even if the file can't be changed (until a new token is pasted).
let tgForgotten = false;
const tgBinding = () => { if (tgForgotten) return null; const t = secretsRead()?.telegram; return t && TG_TOKEN_RE.test(String(t.token || '')) ? t : null; };
const tgPaired = () => { const b = tgBinding(); return b && Number.isSafeInteger(b.chatId) && Number.isSafeInteger(b.userId) ? b : null; };
// What only this Spark needs to remember: the next update to ask for, the current chat, a turn under way, operations
// started from Telegram that haven't reported. No secret.
let tgFile = null;
const tgSaved = () => (tgFile ||= readJson(TG_FILE) || {});
let tgSavedAt = 0, tgSaveTimer = null;
function tgSave() {
  clearTimeout(tgSaveTimer); tgSaveTimer = null;
  tgSavedAt = Date.now();
  try { writePrivate(TG_FILE, tgSaved()); } catch (e) { console.error(`telegram.json wasn’t saved: ${e.message}`); }
}
// Strangers' updates move the offset in memory; the file is written at most once a second for them.
function tgSaveSoon() {
  if (tgSaveTimer) return;
  tgSaveTimer = setTimeout(tgSave, Math.max(0, 1000 - (Date.now() - tgSavedAt)));
  tgSaveTimer.unref?.();
}
const tg = { state: 'off', since: null, lastMessageAt: null, strangers: 0, code: null, running: false, abort: null, busy: false, toldBusy: false, inHits: [], toldTooMany: false };
function tgSetState(state) {
  if (tg.state === state) return;
  tg.state = state;
  tg.since = new Date().toISOString();
  if (state === 'token-refused') fleetEvent({ type: 'notice', text: 'Telegram: the bot’s token stopped working. Paste a new one under your account menu → Agents and Telegram.' });
}
const TG_WORDS = {
  'forget-failed': 'Telegram is off, but the secrets file couldn’t be changed. Remove ~/.config/spark-console/secrets.json on Spark 2 by hand before Spark Console restarts.',
  'in-use': 'Another program is using this bot. Make a new token in @BotFather and paste it.',
  'not-paired': 'Connected to the bot, but no chat is paired. Show a new pairing code.',
  off: 'Not connected.',
  ok: 'Working.',
  pairing: 'Connected to the bot; waiting for you to send it the pairing code.',
  'secrets-unreadable': 'The secrets file can’t be read, so Telegram is off. Spark Console tries again every minute. If it stays off, fix or remove ~/.config/spark-console/secrets.json on Spark 2.',
  'token-refused': 'The bot’s token stopped working. Make a new token in @BotFather and paste it.',
  unreachable: 'Can’t reach Telegram. Trying again by itself.',
};
const tgProblem = () => ['token-refused', 'in-use', 'unreachable', 'secrets-unreadable', 'forget-failed'].includes(tg.state);
// What the page (GET /telegram), /health and sparkie_setup show. Never the token; the pairing code only in the answer to
// the passkey-confirmed request that made it (withCode), never to a plain read.
function telegramView(withCode = false) {
  const b = tgBinding(), p = tgPaired();
  return { connected: Boolean(b), bot: b?.bot || null, paired: Boolean(p), name: p ? String(p.name || '').slice(0, 40) : null, pairedAt: p?.pairedAt || null,
    state: tg.state, since: tg.since, whatToDo: TG_WORDS[tg.state] || null, lastMessageAt: tg.lastMessageAt, strangersIgnored: tg.strangers, needsMe: p?.needsMe === true, approve: tgApproveOn(),
    code: withCode && tg.code && tg.code.exp > Date.now() && b ? { link: `https://t.me/${b.bot}?start=${tg.code.value}`, expiresAt: new Date(tg.code.exp).toISOString() } : null };
}

// The only place Telegram's address is used. Errors come back as fixed codes, never the URL (which holds the token).
class TgError extends Error { constructor(code, retryAfter = 0) { super(code); this.code = code; this.retryAfter = retryAfter; } }
async function tgCall(token, method, body = {}, { timeoutMs = 15000, signal = null } = {}) {
  if (!TG_API) throw new TgError('off');
  let res, data = null;
  // (the time limit and the loop's stop, combined by hand: AbortSignal.any needs a newer Node than the installer asks for)
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeoutMs);
  const stop = () => ctl.abort();
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) ctl.abort();
  try {
    res = await fetch(`${TG_API}/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: ctl.signal });
    data = await res.json().catch(() => null);
  } catch { throw new TgError(signal?.aborted ? 'stopped' : 'unreachable'); } finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); }
  if (res.status === 200 && data?.ok) return data.result;
  if (res.status === 401 || res.status === 404) throw new TgError('refused');
  if (res.status === 409) throw new TgError('in-use');
  if (res.status === 429) throw new TgError('slow-down', Math.min(30, Math.max(1, Number(data?.parameters?.retry_after) || 1)));
  if (res.status >= 400 && res.status < 500) throw new TgError('bad-request');
  throw new TgError('unreachable');
}
// One message out (only tell() calls this). Tried 3 times; a 429 is obeyed once.
async function tgSend(b, text, { silent = false, buttons = null, entities = null } = {}) {
  const body = { chat_id: b.chatId, text, link_preview_options: { is_disabled: true }, ...(silent ? { disable_notification: true } : {}), ...(entities?.length ? { entities } : {}),
    ...(buttons?.length ? { reply_markup: { inline_keyboard: buttons.map(x => [{ text: x.label, callback_data: x.id }]) } } : {}) };
  for (let i = 0, waited = false; i < 3; i++) {
    try { await tgCall(b.token, 'sendMessage', body); return true; } catch (e) {
      if (e.code === 'slow-down' && !waited) { waited = true; await sleep(e.retryAfter * 1000); continue; }
      if (e.code === 'unreachable') { await sleep(1000 * (i + 1)); continue; }
      return false;
    }
  }
  return false;
}
// "typing…" while Sparkie answers: every 4.5 s, for 5 minutes at most.
function tgTyping() {
  const b = tgPaired(), t0 = Date.now();
  if (!b) return { stop() {} };
  const once = () => tgCall(b.token, 'sendChatAction', { chat_id: b.chatId, action: 'typing' }, { timeoutMs: 5000 }).catch(() => {});
  once();
  const timer = setInterval(() => (Date.now() - t0 > 300000 ? clearInterval(timer) : once()), 4500);
  timer.unref?.();
  return { stop() { clearInterval(timer); } };
}

// The loop: one at a time, started once the local port is bound (a second copy of the service never gets there).
async function tgLoop() {
  if (tg.running || draining) return;
  tg.running = true;
  let wait = 0;
  try {
    while (!draining) {
      const b = tgBinding();
      if (tgForgotten) break;
      // A read that failed (too many open files, a half-written file) never ends Telegram for good: a minute's wait,
      // then the file is read again. A stop during the wait (shutdown, a new token, a disconnect) only cuts it short:
      // the checks above decide whether the loop ends.
      if (secretsProblem) {
        tgSetState('secrets-unreadable');
        const ac = new AbortController();
        tg.abort = ac;
        await new Promise(r => { const t = setTimeout(r, TG_RETRY_MS * 30); ac.signal.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true }); });
        continue;
      }
      if (!b || !TG_API) { tgSetState('off'); break; }
      const paired = tgPaired(), pairing = tg.code && tg.code.exp > Date.now();
      if (!paired && !pairing) { tgSetState('not-paired'); break; }
      const ac = new AbortController();
      tg.abort = ac;
      try {
        const updates = await tgCall(b.token, 'getUpdates', { offset: tgSaved().offset || 0, timeout: TG_POLL_S, limit: 100, allowed_updates: ['message', 'callback_query'] },
          { timeoutMs: (TG_POLL_S + 15) * 1000, signal: ac.signal });
        wait = 0;
        tgSetState(paired ? 'ok' : 'pairing');
        for (const u of (Array.isArray(updates) ? updates : []).slice(0, 100)) {
          // (a new token or a disconnect mid-batch: the rest belong to the old bot)
          if (ac.signal.aborted) break;
          try { await tgUpdate(u); } catch (e) { console.error(`A Telegram update wasn’t handled: ${e.message}`); }
        }
      } catch (e) {
        if (e.code === 'stopped' || draining) break;
        // 401: stop until a new token is pasted. 409: someone else holds the token; back off, never fight.
        if (e.code === 'refused') { tgSetState('token-refused'); break; }
        if (e.code === 'in-use') { tgSetState('in-use'); wait = wait >= TG_RETRY_MS * 30 ? TG_RETRY_MS * 150 : TG_RETRY_MS * 30; }
        else if (e.code === 'slow-down') wait = e.retryAfter * 1000;
        else { tgSetState('unreachable'); wait = Math.min(TG_RETRY_MS * 30, Math.max(TG_RETRY_MS, wait * 2)); }
        await new Promise(r => { const t = setTimeout(r, wait); ac.signal.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true }); });
        if (ac.signal.aborted) break;
      }
    }
  } finally { tg.running = false; tg.abort = null; }
}
function tgStop() { tg.abort?.abort(); }
function tgRestart() { tgStop(); setTimeout(() => tgLoop().catch(e => console.error(`Telegram: ${e.message}`)), 50); }

// The owner, as Sparkie's turns from Telegram see them.
const tgOwner = () => ({ login: accessList().owner, role: 'owner', nodeIds: null, permissions: ownerPermissions(), chat: true });

async function tgUpdate(u) {
  const id = Number(u?.update_id);
  if (!Number.isSafeInteger(id)) return;
  const st = tgSaved();
  if (id < (st.offset || 0)) return;
  st.offset = id + 1;
  const m = u.message || null, cq = u.callback_query || null;
  if (!m && !cq) { tgSaveSoon(); return; }
  const paired = tgPaired(), chat = m ? m.chat : cq.message?.chat, from = m ? m.from : cq.from;
  const owner = paired && chat?.type === 'private' && chat.id === paired.chatId && from?.id === paired.userId && !from.is_bot;
  if (!owner) {
    if (!paired && m && tgTryPair(m)) return;
    // Strangers: no reply, no chat, no brain, no write per update.
    tg.strangers++;
    tgSaveSoon();
    return;
  }
  // The owner's: the offset is saved before acting, so a restart never runs "stop X" twice.
  tgSave();
  tg.lastMessageAt = new Date().toISOString();
  tellOwnerAt = Date.now();
  // /lock only ever turns approvals off, so it counts however late it is read and however full the minute is: neither
  // rule below may drop it while approvals are on (20-tg-approve.mjs).
  if (m && tgApproveOn() && typeof m.text === 'string' && /^\/lock(?:@\w+)?(?:\s|$)/i.test(m.text.trim())) return tell('system', tgLock());
  // At most 20 messages a minute from the owner's chat; then one line and silence until the minute frees.
  tg.inHits = tg.inHits.filter(t => Date.now() - t < 60000);
  if (tg.inHits.length >= TELL_LIMITS.in) { if (!tg.toldTooMany) { tg.toldTooMany = true; await tell('system', 'Too many messages. Wait a minute.'); } return; }
  tg.inHits.push(Date.now());
  tg.toldTooMany = false;
  if (cq) return tgPress(cq);
  // A key in the owner's words is taken out first, an old message's too: the message is deleted (20-keys.mjs, R51).
  if (await tgKeys(m)) return;
  if (Date.now() - Number(m.date) * 1000 > TG_STALE_MS) return tell('system', 'I was away when you sent that. Say it again if you still want it.');
  // Someone else's words (forwarded, or sent through another bot) never count as the owner's.
  if (m.forward_origin || m.forward_from || m.forward_from_chat || m.forward_date || m.via_bot) return tell('system', 'Type it in your own words: forwarded messages aren’t read here.');
  if (typeof m.text !== 'string' || !m.text.trim()) return tell('system', 'I only read text here.');
  const text = m.text.slice(0, 4000).trim();
  if (TG_TOKEN_IN.test(text)) return tell('system', 'That looks like a bot token. Revoke it in @BotFather and paste the new one in Spark Console.');
  // The two digits of a dangerous ask pressed here, or why not; never sent on to Sparkie (20-danger.mjs).
  const pair = dangerTypedHere(text);
  if (pair) return pair;
  // The owner's words (R34) are answered by code before the one-turn check, so they work while Sparkie answers. Never
  // resume or /undo update here (R32): /undo update goes to Sparkie, whose undo_update waits for the page.
  const word = ownerWord(text);
  if (word === '/pause') return tell('system', pauseWord('telegram'));
  if (word === '/restart sparkie') return tell('system', await restartWord('telegram'));
  if (word === '/stop') return tell('system', await stopWord(chatData().conversations.find(c => c.id === st.conv && c.channel === 'telegram')));
  // (/undo: this chat's last change put back, also while changes are paused, 20-words.mjs)
  if (word === '/undo') return tell('system', (await undoChangeWord(tgOwner(), tgConv(), 'telegram')).reply);
  // (/putback: the newest change made inside the lock-out net put back, by code, with no brain, 21-net.mjs)
  if (word === '/putback') return tell('system', await netPutbackWord());
  const cmd = /^\/(new|status|unpair|start|help|lock)(?:@\w+)?(?:\s|$)/i.exec(text)?.[1]?.toLowerCase();
  if (cmd === 'unpair') { tgForget(); return; }
  // (approvals from here off at once, also while Sparkie answers: 20-tg-approve.mjs)
  if (cmd === 'lock') return tell('system', tgLock());
  if (cmd === 'start' || cmd === 'help') return tell('system', TG_HELLO);
  if (cmd === 'status') return tell('system', await tgStatusText());
  if (tg.busy) { if (!tg.toldBusy) { tg.toldBusy = true; await tell('system', 'Still answering the last one. Send that again when I’m done.'); } return; }
  if (cmd === 'new') { st.conv = null; tgSave(); tgConv(); return tell('system', 'New chat. What do you need?'); }
  tgTurn(text).catch(e => console.error(`Telegram turn: ${e.message}`));
}

// Pairing: "/start <code>" from a person in a private chat. Wrong codes count per sender (3 a code), never against the
// code, so a stranger can't burn the owner's.
function tgTryPair(m) {
  const b = tgBinding(), from = m.from, chat = m.chat;
  if (!b || !tg.code || tg.code.exp < Date.now() || chat?.type !== 'private' || !from || from.is_bot || !Number.isSafeInteger(from.id) || chat.id !== from.id) return false;
  const said = /^\/start(?:@\w+)?\s+([A-Za-z0-9]{8})\s*$/.exec(String(m.text || ''))?.[1]?.toUpperCase();
  if (!said) return false;
  const tries = tg.code.tries.get(from.id) || 0;
  if (tries >= 3) return false;
  const a = Buffer.from(said), want = Buffer.from(tg.code.value);
  if (a.length !== want.length || !timingSafeEqual(a, want)) { tg.code.tries.set(from.id, tries + 1); return false; }
  const name = String(from.first_name || '').replace(/[\x00-\x1f]/g, '').slice(0, 40);
  try { secretsWrite(s => ({ ...s, telegram: { ...s.telegram, chatId: chat.id, userId: from.id, name, pairedAt: new Date().toISOString(), approve: true } })); } catch (e) {
    console.error(`Pairing Telegram wasn’t saved: ${e.message}`);
    fleetEvent({ type: 'notice', text: 'Pairing Telegram didn’t work: the secrets file couldn’t be written. Try again; the code still works.' });
    return true;
  }
  tg.code = null;
  tgNewPairing();
  tgSave();
  // (a task from the chat paired before this one ends: its carry-on turns would go on, and be told, here)
  try { endTasksFrom({ channel: 'telegram' }); } catch (e) { console.error(`Pairing Telegram: the last pairing's tasks weren’t ended (${e.message}).`); }
  audit({ via: 'telegram', actor: 'owner on Telegram', action: 'telegram-paired', args: { name }, ok: true });
  tgSetState('ok');
  tellOwnerAt = Date.now();
  tell('system', TG_HELLO).catch(() => {});
  return true;
}
function tgNewCode() {
  const bytes = randomBytes(8);
  tg.code = { value: [...bytes].map(x => TG_CODE_CHARS[x % TG_CODE_CHARS.length]).join(''), exp: Date.now() + TG_CODE_MS, tries: new Map() };
}
// Disconnect: the token and the chat are forgotten, the loop stops. Never needs the passkey.
function tgForget() {
  const was = tgPaired();
  // Off at once, whatever happens to the file.
  tgForgotten = true;
  tg.code = null;
  tgStop();
  const st = tgSaved();
  delete st.conv; delete st.answering;
  tgSave();
  // (a task started from Telegram ends with it: its carry-on turns would go on with Telegram's rights)
  try { endTasksFrom({ channel: 'telegram' }); } catch (e) { console.error(`Disconnecting Telegram: its tasks weren’t ended (${e.message}).`); }
  let removed = false;
  try {
    const now = secretsRead();
    if (now !== null) { if (now.telegram) secretsWrite(s => { const { telegram, ...rest } = s; return rest; }); removed = true; }
  } catch (e) { console.error(`Disconnecting Telegram: the secrets file couldn’t be changed (${e.message}).`); }
  tgSetState(removed ? 'off' : 'forget-failed');
  if (was && removed) tell('system', 'Disconnected from Spark Console. Pair again from Spark Console to use it here.', { to: was }).catch(() => {});
  return removed;
}

// The owner's current Telegram chat: one of their chats in Spark Console, tagged as from Telegram. A full one rolls over.
function tgConv() {
  const st = tgSaved();
  let conv = chatData().conversations.find(c => c.id === st.conv && c.channel === 'telegram');
  if (conv && conv.messages.length < LIMITS.messages - 2) return conv;
  if (conv) tell('system', 'That chat was full, so this starts a new one in Spark Console.').catch(() => {});
  const now = new Date().toISOString();
  conv = { id: `sc_${randomBytes(8).toString('hex')}`, login: accessList().owner, title: 'New chat', spark: null, createdAt: now, updatedAt: now, messages: [], channel: 'telegram' };
  chatData().conversations.push(conv);
  saveChats();
  st.conv = conv.id;
  tgSave();
  return conv;
}
async function tgTurn(text) {
  tg.busy = true;
  tg.toldBusy = false;
  const st = tgSaved();
  st.answering = { at: new Date().toISOString() };
  tgSave();
  const typing = tgTyping();
  try {
    let message;
    try { message = await sparkieTurn({ viewer: tgOwner(), conv: tgConv(), text, channel: 'telegram' }); } catch (e) {
      return await tell('reply', e.status === 429 ? 'Sparkie is busy with other chats. Try again in a minute.'
        : /still answering/i.test(e.message) ? 'Still answering in Spark Console. Send that again when it’s done.'
          : /expired/i.test(e.message) ? 'That button has expired. Ask again.'
            : /No model is set up|can only reach a model/i.test(e.message) ? TG_BRAIN_DOWN : 'That didn’t work. The details are in Spark Console.');
    }
    // (stopped with /stop: its line was the answer)
    if (message.error === TURN_STOPPED) return;
    if (message.error && !String(message.content || '').trim()) return await tell('reply', TG_BRAIN_DOWN);
    await tell('reply', tellReplyText(message), { buttons: tellButtons(message) });
  } finally {
    typing.stop();
    tg.busy = false;
    delete st.answering;
    tgSave();
  }
}
// A button pressed in Telegram: a plain button of the owner's Telegram chat; or an owner-only one this console asked
// here, which counts as the owner's yes only within 20-tg-approve.mjs's limits (runChoice refuses every other owner-only
// press but the page's). The answer is a fixed line.
async function tgPress(cq) {
  const b = tgPaired();
  tgCall(b.token, 'answerCallbackQuery', { callback_query_id: String(cq.id || '') }, { timeoutMs: 5000 }).catch(() => {});
  const choice = String(cq.data || '');
  const ask = tgApproving(choice);
  if (ask?.answer) return tell('system', ask.answer);
  const conv = ask ? ask.conv : /^[a-f0-9]{10}$/.test(choice) ? chatData().conversations.find(c => c.channel === 'telegram' && c.login === accessList().owner && c.messages.some(m => (m.choices || []).some(x => x.id === choice))) : null;
  if (!conv) return tell('system', 'That button has expired. Ask again.');
  return tgRun(conv, choice, ask);
}
// A press that may run, or a dangerous ask's right pair (20-danger.mjs): one at a time, answered with a fixed line.
async function tgRun(conv, choice, ask) {
  if (tg.busy || replying.has(conv.id)) return tell('system', 'Still answering the last one. Press it again when I’m done.');
  tg.busy = true;
  try {
    if (ask) tgApprovalCounted(ask);
    const r = await runChoice(tgOwner(), conv, choice, { via: 'telegram', actor: 'owner on Telegram', ...(ask ? { approved: true } : {}) });
    if (ask) tgApproved(ask, conv, r);
    // (a question that went here as its own ask isn't said again)
    if (r.outcome === 'question' || r.outcome === 'needs-ok') return tgAskedThere(r.message) || await tell('reply', tellReplyText(r.message), { buttons: tellButtons(r.message) });
    if (r.outcome === 'declined') return await tell('system', 'Okay, left as it is.');
    if (r.outcome === 'error') return await tell('system', /paused/i.test(r.error || '') ? 'Changes are paused in Spark Console.' : 'That didn’t work. The details are in Spark Console.');
    if (r.operation) return await tell('system', 'Under way. I’ll tell you here when it’s done.');
    return await tell('system', 'Done.');
  } catch (e) {
    // (a dangerous ask's refusals are fixed lines of code's own: 20-danger.mjs)
    return tell('system', e.danger ? e.message : e.status === 409 ? 'That button has expired. Ask again.' : e.status === 403 ? 'That one waits for you in Spark Console.' : 'That didn’t work. The details are in Spark Console.');
  } finally { tg.busy = false; }
}
// /status: from Spark Console's own record, no brain.
async function tgStatusText() { return `${await statusText()}\n${tgApprovalsLine()}`; }
// After a restart: a turn that was cut off, and operations started from Telegram that didn't report, get one line each.
function tgAfterRestart() {
  const st = tgSaved(), cut = (st.awaiting || []).filter(x => !jobs.has(x.id));
  if (!st.answering && !cut.length) return;
  const lines = [st.answering ? 'Spark Console restarted while I was answering. Send that again.' : null,
    ...cut.slice(0, 4).map(x => `A restart cut off ${String(x.what).charAt(0).toLowerCase()}${String(x.what).slice(1)}. Check it in Spark Console.`)].filter(Boolean);
  delete st.answering;
  st.awaiting = (st.awaiting || []).filter(x => jobs.has(x.id));
  tgSave();
  tell('system', lines.join('\n')).catch(() => {});
}

// The page's routes (owner only, below the passkey gate).
async function telegramRoute(req, res, path, viewer) {
  if (req.method === 'GET' && path === '/telegram') return send(res, 200, telegramView());
  if (req.method === 'DELETE' && path === '/telegram') {
    const removed = tgForget();
    audit({ via: 'page', actor: 'owner', action: 'telegram-disconnected', args: { fileChanged: removed }, ok: true });
    return send(res, 200, telegramView());
  }
  // The needs-me line (20-tell.mjs, H5): on needs the passkey (the gate) and a paired chat; off never does.
  if (req.method === 'PUT' && path === '/telegram/needs') {
    const on = (await readBody(req, 2000))?.on;
    if (typeof on !== 'boolean') throw new HttpError(400, 'Send {"on": true} or {"on": false}.');
    if (on && !tgPaired()) throw new HttpError(409, 'Pair your Telegram chat first.');
    if (tgBinding()) secretsWrite(s => ({ ...s, telegram: { ...s.telegram, needsMe: on } }));
    // Switched on: what is open now counts as new, once. The day's count stays.
    if (on) { const st = tgSaved(); st.needs = { sent: st.needs?.sent || [] }; tgSave(); }
    audit({ via: 'page', actor: 'owner', action: 'telegram-needs-me', args: { on }, ok: true });
    return send(res, 200, telegramView());
  }
  // Approve from Telegram (20-tg-approve.mjs): on needs the passkey (the gate) and a paired chat; off never does.
  if (req.method === 'PUT' && path === '/telegram/approve') return send(res, 200, await tgApproveRoute(req));
  if (!passkeys().length) throw new HttpError(409, 'Set up your passkey first (your account menu → Your passkey): connecting Telegram needs it.');
  if (!SECRETS_FILE) throw new HttpError(409, 'This copy of Spark Console keeps no secrets, so Telegram can’t be connected here.');
  if (!TG_API) throw new HttpError(409, 'Telegram is off on this copy of Spark Console.');
  if (req.method === 'PUT' && path === '/telegram') {
    const body = await readBody(req, 2000), token = String(body?.token || '').trim();
    if (!TG_TOKEN_RE.test(token)) throw new HttpError(400, 'Paste the token @BotFather gave you (numbers, a colon, then letters).');
    let me;
    try { me = await tgCall(token, 'getMe', {}); } catch (e) {
      throw new HttpError(400, e.code === 'refused' ? 'Telegram didn’t accept that token. Copy it again from @BotFather.' : 'Couldn’t reach Telegram just now. Try again.');
    }
    const bot = String(me?.username || '');
    if (!/^[A-Za-z0-9_]{5,64}$/.test(bot) || me?.is_bot !== true) throw new HttpError(400, 'That token isn’t a bot’s. Make one with @BotFather.');
    // A webhook would keep updates from this console: cleared once, here, never by the loop.
    await tgCall(token, 'deleteWebhook', { drop_pending_updates: true }).catch(() => {});
    tgStop();
    secretsWrite(s => ({ ...s, telegram: { token, bot } }));
    tgForgotten = false;
    // (a new bot drops the pairing: a task from it ends, as at Disconnect)
    try { endTasksFrom({ channel: 'telegram' }); } catch (e) { console.error(`Connecting Telegram: the last pairing's tasks weren’t ended (${e.message}).`); }
    const st = tgSaved();
    st.offset = 0; delete st.conv; delete st.answering;
    tgSave();
    tgNewCode();
    audit({ via: 'page', actor: 'owner', action: 'telegram-connected', args: { bot }, ok: true });
    tgRestart();
    return send(res, 200, telegramView(true));
  }
  if (req.method === 'POST' && path === '/telegram/pair') {
    if (!tgBinding()) throw new HttpError(409, 'Paste the bot’s token first.');
    tgNewCode();
    audit({ via: 'page', actor: 'owner', action: 'telegram-pairing-code', args: {}, ok: true });
    tgRestart();
    return send(res, 200, telegramView(true));
  }
  throw new HttpError(405, 'Use GET, PUT, POST /telegram/pair, PUT /telegram/needs or DELETE.');
}
