// A stand-in Spark Console for test/install.test.mjs: just the routes the installer's Spark 2 half asks, on the socket
// Tailscale uses ($HOME/.local/state/spark-console/api.sock). The test puts `const MODE = '<mode>'; // <n>` in front of
// this file and stages it as server.mjs, so each variant is its own build (the first 12 hex of the sha256 of server.mjs,
// dig.mjs and passkey.mjs beside it, as /health reports it). Modes:
//   good       answers everything as a healthy console
//   dead       exits at once (never answers)
//   dies       answers, then exits 1.5 s after every start
//   not-owner  /whoami says nobody is the owner
//   no-tool    a chat turn finishes without calling a tool
//   tg-bad     /health says Telegram is "unreachable"
// Every request is logged to $HOME/requests.log (method, path, the login, X-Spark-Console and Origin); chats are kept in
// $HOME/standin-chats.json. $HOME/tg-state is Telegram's state for the other modes ("off" without it); $HOME/brain-down
// makes /main say Sparkie's model isn't healthy.
import http from 'node:http';
import { readFileSync, writeFileSync, appendFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HOME = process.env.HOME, DIR = dirname(fileURLToPath(import.meta.url));
const STATE = join(HOME, '.local', 'state', 'spark-console'), SOCK = join(STATE, 'api.sock'), CHATS = join(HOME, 'standin-chats.json');
const BUILD = createHash('sha256').update(Buffer.concat(['server.mjs', 'dig.mjs', 'passkey.mjs'].map(f => readFileSync(join(DIR, f))))).digest('hex').slice(0, 12);
const STARTED_AT = new Date().toISOString();
if (MODE === 'dead') process.exit(1);
if (MODE === 'dies') setTimeout(() => process.exit(1), 1500);

const read = (f, d) => { try { return readFileSync(f, 'utf8'); } catch { return d; } };
const chats = () => { try { return JSON.parse(read(CHATS, '[]')); } catch { return []; } };
const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const body = req => new Promise(resolve => { let d = ''; req.on('data', c => { d += c; }); req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } }); });

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://local').pathname;
  appendFileSync(join(HOME, 'requests.log'), `${JSON.stringify({ method: req.method, path, login: req.headers['tailscale-user-login'] || null,
    xsc: req.headers['x-spark-console'] || null, origin: req.headers.origin || null, build: BUILD })}\n`);
  if (req.method === 'GET' && path === '/health') {
    const telegram = MODE === 'tg-bad' ? 'unreachable' : read(join(HOME, 'tg-state'), 'off').trim() || 'off';
    return send(res, 200, { ok: true, build: BUILD, startedAt: STARTED_AT, jobsRunning: 0, replying: 0, telegram, workflows: {} });
  }
  const login = req.headers['tailscale-user-login'] || null, owner = MODE !== 'not-owner' && login === 'owner@test';
  if (req.method === 'GET' && path === '/whoami') return send(res, 200, { login, access: owner ? 'owner' : 'none' });
  if (path === '/mcp') return send(res, 403, { error: 'An agent needs its own key.' });
  if (req.method === 'GET' && path === '/v1/models') return send(res, 200, { object: 'list', data: [] });
  if (req.method === 'GET' && path === '/main') return send(res, 200, { configured: true, healthy: !existsSync(join(HOME, 'brain-down')) });
  if (req.method === 'GET' && path === '/chats') return send(res, 200, { chats: chats().map(c => ({ id: c.id, title: c.title, messageCount: c.messages, agent: null })) });
  if (req.method === 'POST' && path === '/chats') {
    const c = { id: `sc_${randomBytes(8).toString('hex')}`, title: 'New chat', messages: 0 };
    writeFileSync(CHATS, JSON.stringify([...chats(), c]));
    return send(res, 201, { id: c.id, title: c.title, messageCount: 0, agent: null, messages: [] });
  }
  const m = /^\/chats\/(sc_[0-9a-f]{16})\/messages$/.exec(path);
  if (req.method === 'POST' && m) {
    const { text } = await body(req), all = chats(), c = all.find(x => x.id === m[1]);
    if (!c) return send(res, 404, { error: 'No such chat.' });
    if (c.title === 'New chat') c.title = String(text || '').slice(0, 60);
    c.messages += 2;
    writeFileSync(CHATS, JSON.stringify(all));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ type: 'started' })}\n\n`);
    if (MODE !== 'no-tool') res.write(`data: ${JSON.stringify({ type: 'tool', name: 'fleet_status', title: 'Fleet status', ok: true, ms: 5, change: false })}\n\n`);
    return res.end(`data: ${JSON.stringify({ type: 'done', message: { role: 'assistant', content: '3 Sparks answer.' } })}\n\n`);
  }
  send(res, 404, { error: 'Not here.' });
});
mkdirSync(STATE, { recursive: true });
try { unlinkSync(SOCK); } catch {}
server.listen(SOCK);
process.on('SIGTERM', () => { server.close(); try { unlinkSync(SOCK); } catch {} process.exit(0); });
