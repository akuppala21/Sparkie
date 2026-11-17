// A stand-in for Telegram's Bot API on 127.0.0.1:$MOCK_TELEGRAM_PORT, started by test/start-mock.mjs when a test asks
// for Telegram (the service reaches it through SPARK_CONSOLE_TELEGRAM_API, honoured only under ALL_LOCAL). Without the
// port (a bare `node --test`) it does nothing.
//   /bot<token>/getMe, getUpdates (long polling with Telegram's offset rules; a second open poll gets 409),
//   sendMessage (400 over 4,096 characters), sendChatAction, answerCallbackQuery, deleteWebhook, deleteMessage.
// Every call is appended to $MOCK_DIR/telegram-calls.jsonl. A test drives it with:
//   POST /__push  { message } or { callback_query } (or a list): queued as updates, each given the next update_id
//   POST /__mode  { refuse, inUse, down, slowDown }  refuse: 401 on everything; inUse: 409 on getUpdates;
//                 down: 502 on everything; slowDown: N sendMessage calls answer 429 with retry_after 1;
//                 noDelete: deleteMessage answers 400, as Telegram does for a message it can't delete
//                 blocked: sendMessage answers 403, as Telegram does when the owner blocked the bot
//                 hold: N, sendMessage waits N ms before it answers (a slow Telegram), then as the rest says
// A sendMessage that went (answered 200) is also written to $MOCK_DIR/telegram-delivered.jsonl: { at, chat_id, text }.
import http from 'node:http';
import { appendFileSync } from 'node:fs';

const PORT = Number(process.env.MOCK_TELEGRAM_PORT), DIR = process.env.MOCK_DIR;
if (!PORT || !DIR) process.exit(0);
const BOT = { id: 7000001, is_bot: true, first_name: 'Spark test bot', username: 'spark_test_bot' };
let updates = [], nextId = 1, mode = {}, polling = 0, messageId = 100;
const waiting = new Set();
const log = entry => { try { appendFileSync(`${DIR}/telegram-calls.jsonl`, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`); } catch {} };
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const ok = (res, result) => json(res, 200, { ok: true, result });
const fail = (res, status, description, extra = {}) => json(res, status, { ok: false, error_code: status, description, ...extra });
// (decoded as one stream: a character whose bytes arrive in two pieces stays whole)
const readBody = req => new Promise(resolve => { let b = ''; req.setEncoding('utf8'); req.on('data', d => { b += d; }); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve(null); } }); });

http.createServer(async (req, res) => {
  const body = await readBody(req);
  if (req.url === '/__push' && req.method === 'POST') {
    const ids = [];
    for (const u of Array.isArray(body) ? body : [body]) { const x = { update_id: nextId++, ...u }; updates.push(x); ids.push(x.update_id); }
    for (const w of [...waiting]) w();
    return ok(res, ids);
  }
  if (req.url === '/__mode' && req.method === 'POST') { mode = body || {}; return ok(res, mode); }
  const m = /^\/bot([^/]+)\/(\w+)$/.exec(req.url || '');
  if (!m) return fail(res, 404, 'Not Found');
  const [, token, method] = m;
  log({ method, token, body });
  if (mode.down) return fail(res, 502, 'Bad Gateway');
  if (mode.refuse || !/^\d{6,12}:[A-Za-z0-9_-]{30,64}$/.test(token) || token.startsWith('999')) return fail(res, 401, 'Unauthorized');
  if (body === null) return fail(res, 400, 'Bad Request: can’t parse JSON');
  if (method === 'getMe') return ok(res, BOT);
  if (method === 'deleteWebhook') return ok(res, true);
  if (method === 'getUpdates') {
    if (mode.inUse) return fail(res, 409, 'Conflict: terminated by other getUpdates request');
    if (polling > 0) return fail(res, 409, 'Conflict: terminated by other getUpdates request; make sure that only one bot instance is running');
    const offset = Number(body.offset) || 0;
    // Asking from an offset confirms (forgets) every update before it.
    if (offset > 0) updates = updates.filter(u => u.update_id >= offset);
    const ready = () => updates.filter(u => u.update_id >= offset).slice(0, Math.min(100, Number(body.limit) || 100));
    if (!ready().length && Number(body.timeout) > 0) {
      polling++;
      await new Promise(resolve => {
        const done = () => { waiting.delete(done); clearTimeout(t); resolve(); };
        const t = setTimeout(done, Number(body.timeout) * 1000);
        waiting.add(done);
        // (the request body was read already, so the response's close is what says the poller went away)
        res.on('close', done);
      });
      polling--;
    }
    if (res.destroyed) return;
    return ok(res, ready());
  }
  if (method === 'sendMessage') {
    if (mode.hold > 0) await new Promise(r => setTimeout(r, Number(mode.hold)));
    if (mode.slowDown > 0) { mode.slowDown--; return fail(res, 429, 'Too Many Requests: retry after 1', { parameters: { retry_after: 1 } }); }
    if (mode.blocked) return fail(res, 403, 'Forbidden: bot was blocked by the user');
    if (typeof body.text !== 'string' || !body.text.length || body.text.length > 4096) return fail(res, 400, 'Bad Request: message is too long');
    try { appendFileSync(`${DIR}/telegram-delivered.jsonl`, `${JSON.stringify({ at: new Date().toISOString(), chat_id: body.chat_id, text: body.text })}\n`); } catch {}
    return ok(res, { message_id: messageId++, chat: { id: body.chat_id, type: 'private' }, date: Math.floor(Date.now() / 1000), text: body.text });
  }
  if (method === 'sendChatAction' || method === 'answerCallbackQuery') return ok(res, true);
  if (method === 'deleteMessage') return mode.noDelete ? fail(res, 400, 'Bad Request: message can\'t be deleted') : ok(res, true);
  return fail(res, 404, 'Not Found: method not found');
}).listen(PORT, '127.0.0.1', () => console.log(`mock telegram on 127.0.0.1:${PORT}`));
