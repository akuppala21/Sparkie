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
//   no-begin   a passkey sign-in doesn't begin (/auth/signin/begin answers 500)
// As the console does: /health answers before every gate (through Funnel only {"ok":true}); through Funnel (its header)
// only /whoami and the sign-in routes answer, and /whoami says who a visitor from the internet is (access none; signin
// when a passkey is on file in $STATE/passkeys.json); a request carrying a Spark's own address (an ip in config.json's
// nodes, the last X-Forwarded-For) is refused with 403 on every path but /health and /v1/.
// Every request is logged to $HOME/requests.log (method, path, the login, X-Spark-Console and Origin); chats are kept in
// $HOME/standin-chats.json. $HOME/tg-state is Telegram's state for the other modes ("off" without it); $HOME/brain-down
// makes /main say Sparkie's model isn't healthy; $HOME/standin-busy, a number, is the jobs /health says are running.
import http from 'node:http';
import { readFileSync, writeFileSync, appendFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HOME = process.env.HOME, DIR = dirname(fileURLToPath(import.meta.url));
const STATE = join(HOME, '.local', 'state', 'spark-console'), SOCK = join(STATE, 'api.sock'), CHATS = join(HOME, 'standin-chats.json');
const BUILD = createHash('sha256').update(Buffer.concat(['server.mjs', 'dig.mjs', 'passkey.mjs'].map(f => readFileSync(join(DIR, f))))).digest('hex').slice(0, 12);
const STARTED_AT = new Date().toISOString();
const SPARKS = (() => { try { return new Set(JSON.parse(readFileSync(join(DIR, 'config.json'), 'utf8')).nodes.map(n => n.ip).filter(Boolean)); } catch { return new Set(); } })();
if (MODE === 'dead') process.exit(1);
if (MODE === 'dies') setTimeout(() => process.exit(1), 1500);

const read = (f, d) => { try { return readFileSync(f, 'utf8'); } catch { return d; } };
const chats = () => { try { return JSON.parse(read(CHATS, '[]')); } catch { return []; } };
const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
// (decoded as one stream: a character whose bytes arrive in two pieces stays whole)
const body = req => new Promise(resolve => { let d = ''; req.setEncoding('utf8'); req.on('data', c => { d += c; }); req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } }); });

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://local').pathname;
  appendFileSync(join(HOME, 'requests.log'), `${JSON.stringify({ method: req.method, path, login: req.headers['tailscale-user-login'] || null,
    xsc: req.headers['x-spark-console'] || null, origin: req.headers.origin || null, build: BUILD })}\n`);
  const funnel = Boolean(req.headers['tailscale-funnel-request']), from = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
  if (req.method === 'GET' && path === '/health') {
    if (funnel) return send(res, 200, { ok: true });
    const telegram = MODE === 'tg-bad' ? 'unreachable' : read(join(HOME, 'tg-state'), 'off').trim() || 'off';
    return send(res, 200, { ok: true, build: BUILD, startedAt: STARTED_AT, jobsRunning: Number(read(join(HOME, 'standin-busy'), '0').trim()) || 0, replying: 0, telegram, workflows: {} });
  }
  if (funnel && path !== '/whoami' && !path.startsWith('/auth/')) return send(res, 401, { error: 'Sign in to see more.' });
  if (from && SPARKS.has(from) && !path.startsWith('/v1/')) return send(res, 403, { error: 'Requests from the Sparks themselves can’t act as a person. Open Spark Console from your own device.' });
  const keys = (() => { try { const k = JSON.parse(read(join(STATE, 'passkeys.json'), '{}')).keys; return Array.isArray(k) ? k : []; } catch { return []; } })();
  if (funnel && req.method === 'GET' && path === '/whoami') return send(res, 200, { login: null, access: 'none', signin: MODE !== 'not-owner' && keys.length > 0, recovery: false, session: null, via: 'internet' });
  if (req.method === 'POST' && path === '/auth/signin/begin') {
    if (req.headers['x-spark-console'] !== '1') return send(res, 403, { error: 'Cross-site request blocked.' });
    if (MODE === 'no-begin') return send(res, 500, { error: 'Not today.' });
    if (!keys.length) return send(res, 409, { error: 'Signing in with a passkey isn’t set up yet.' });
    const challenge = randomBytes(40).toString('base64url');
    return send(res, 200, { challengeId: challenge, challenge, allow: keys.map(k => ({ id: k.id, rpId: k.rpId })) });
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
