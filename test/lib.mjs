// Shared helpers for the Spark Console tests. No dependencies: node:test + node:http (Node 20+).
// Each test file calls useFleet() once: it starts its own service on the stand-in fleet (start-mock.mjs) before the
// tests and, after them, removes every agent key it made and stops everything.
import { before, after } from 'node:test';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import { startMock, REPO, OWNER, MEMBER } from './start-mock.mjs';

// A slower machine (one whose security software checks every process the stand-in fleet starts, say) gives the tests
// more time: SPARK_TEST_SLOW=3 triples every time limit. 1 everywhere else.
export const SLOW = Math.max(1, Number(process.env.SPARK_TEST_SLOW) || 1);

export { REPO, OWNER, MEMBER };
export const CLI = join(REPO, 'tools', 'spark.mjs');
export const SERVICE_FILE = join(REPO, 'service', 'server.mjs');

// Filled in by useFleet's before hook: { fleet, base, mcp, origin }. Root-level before hooks of one file run
// concurrently, so a file's own setup goes in useFleet's second argument (it runs once the service answers).
export const T = {};
export function useFleet(opts = {}, setup = null) {
  before(async () => {
    T.fleet = await startMock(opts);
    Object.assign(T, { base: T.fleet.base, mcp: T.fleet.mcp, origin: T.fleet.origin });
    await setup?.();
  }, { timeout: 180000 });
  after(async () => {
    await cleanupKeys().catch(() => {});
    await T.fleet?.stop();
  }, { timeout: 30000 });
  return T;
}

// Known product bugs are marked todo (so the suite stays a regression signal) unless SPARK_TEST_STRICT=1.
export const bug = reason => (process.env.SPARK_TEST_STRICT ? {} : { todo: `PRODUCT BUG: ${reason}` });

// The agent door's actions: the ones that read (every key sees them) and the ones that change things (only keys the
// owner let act, scope fleet:act). One a line, in name order.
export const TOOLS = [
  'cluster_plan',
  'container_logs',
  'deploy_plan',
  'files',
  'find_recipes',
  'fleet_events',
  'fleet_status',
  'guide',
  'linked_sparks',
  'memory',
  'models_on_disk',
  'operation_log',
  'read_page',
  'recall',
  'recent_operations',
  'recipe_detail',
  'running_models',
  'search_huggingface',
  'search_web',
  'service_logs',
  'should_be_running',
  'spark_detail',
  'spark_diagnostics',
  'sparkie_setup',
  'wait_operation',
  'where_it_fits',
  'workflows',
  'workloads',
];
export const CHANGE_TOOLS = [
  'cancel_operation',
  'find_setups',
  'forget_memory',
  'forget_workflow',
  'keep_running',
  'power_off',
  'power_on',
  'power_settings',
  'remember',
  'restart_model',
  'run_workflow',
  'save_file',
  'save_workflow',
  'self_test',
  'start_model',
  'stop_model',
  'test_changes',
  'undo_last_change',
  'undo_update',
];
export const ALL_TOOLS = [...TOOLS, ...CHANGE_TOOLS];
// Talking with Sparkie: every key sees it in tools/list (it isn't one of the actions GET /actions lists), beside every
// read action (a key that only looks) or every action (one that can act).
export const ASK = 'ask_sparkie';
export const DOOR_READ = [...TOOLS, ASK], DOOR_ACT = [...ALL_TOOLS, ASK];
// Every tool Sparkie can call in the owner's chats: every action (lookups and workflows), the same as agents.
export const SPARKIE_TOOLS = [...ALL_TOOLS];
// What every round offers Sparkie (R46): the core, at most TOOL_CAP tools with the groups a request opens (TOOL_CAP in
// 21-guide.mjs; test/tools.test.mjs checks the service agrees).
export const CORE_TOOLS = ['fleet_status', 'running_models', 'workloads', 'should_be_running', 'sparkie_setup', 'start_model', 'stop_model', 'restart_model',
  'keep_running', 'remember', 'search_web', 'guide'];
export const TOOL_CAP = 24;

let rpcId = 1;
export const nextId = () => rpcId++;
const parse = text => { try { return text ? JSON.parse(text) : null; } catch { return null; } };

// One request on a connection of its own: fetch reusing a kept-alive connection after about a second idle can stall for
// a second or two (seen on Node 26), which adds up over a run that polls. Rejects like fetch on a dropped connection.
export function request(url, { method = 'GET', headers = {}, body, timeout = 120000 * SLOW } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(body);
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; clearTimeout(timer); fn(v); } };
    const req = http.request(url, { method, agent: false, headers: { ...headers, ...(data ? { 'content-length': data.length } : {}) } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const h = res.headers;
        done(resolve, { status: res.statusCode, headers: { get: k => h[String(k).toLowerCase()] ?? null, raw: h }, text: Buffer.concat(chunks).toString('utf8') });
      });
      res.on('error', e => done(reject, e));
    });
    const timer = setTimeout(() => req.destroy(Object.assign(new Error(`timed out after ${timeout} ms`), { name: 'TimeoutError' })), timeout);
    req.on('error', e => {
      const fail = () => done(reject, Object.assign(new Error(`request failed: ${e.message}`), { cause: e }));
      // A server refusing an oversized body answers (413) and closes while the body is still being sent; on a slow
      // machine the write can break first. Its answer is what counts, so give it a moment to arrive.
      if (['EPIPE', 'ECONNRESET'].includes(e.code) && data) setTimeout(fail, 2000); else fail();
    });
    req.end(data);
  });
}

// Raw POST to the MCP door. Returns { status, headers, text, json }.
export async function post(body, { token, headers = {}, method = 'POST', url = T.mcp, timeout = 120000 * SLOW } = {}) {
  const h = { 'content-type': 'application/json', ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  for (const [k, v] of Object.entries(h)) if (v === null) delete h[k];
  const r = await request(url, { method, headers: h, body: method === 'GET' || method === 'HEAD' || body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)), timeout });
  return { ...r, json: parse(r.text) };
}

export const rpc = (token, method, params, opts = {}) => post({ jsonrpc: '2.0', id: nextId(), method, ...(params !== undefined ? { params } : {}) }, { token, ...opts });

// tools/call; returns { status, json, raw, isError, text, value (parsed JSON or undefined) }.
export async function call(token, name, args, opts = {}) {
  const params = { name };
  if (args !== undefined) params.arguments = args;
  const r = await rpc(token, 'tools/call', params, opts);
  const content = r.json?.result?.content;
  const text = Array.isArray(content) ? content.filter(c => c.type === 'text').map(c => c.text).join('\n') : undefined;
  return { ...r, raw: r.text, isError: r.json?.result?.isError, text, value: text === undefined ? undefined : parse(text) ?? undefined };
}

// Page (non-MCP) API as the owner: writes carry X-Spark-Console: 1 and the configured Origin, like the page does.
export async function api(path, { method = 'GET', body, headers = {}, rawBody } = {}) {
  const h = { ...(method === 'GET' ? {} : { 'content-type': 'application/json', 'x-spark-console': '1', origin: T.origin }), ...headers };
  for (const [k, v] of Object.entries(h)) if (v === null) delete h[k];
  const r = await request(`${T.base}${path}`, { method, headers: h, body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)), timeout: 60000 * SLOW });
  return { status: r.status, headers: r.headers, json: parse(r.text), text: r.text };
}

// Agent keys this process made, so they're always removed at the end.
const made = new Set();
export async function createKey(prefix = 'test') {
  const name = `${prefix}-${randomBytes(4).toString('hex')}`;
  const r = await api('/agents', { method: 'POST', body: { name } });
  if (r.status !== 201) throw new Error(`creating agent key failed: ${r.status} ${r.text}`);
  made.add(r.json.id);
  return { id: r.json.id, token: r.json.token, name, created: r.json };
}
// A key the owner let change things (Sharing & access → Agents → can act).
export async function createActKey(prefix = 'act') {
  const k = await createKey(prefix);
  const r = await api(`/agents/${k.id}`, { method: 'PUT', body: { act: true } });
  if (r.status !== 200) throw new Error(`letting agent key act failed: ${r.status} ${r.text}`);
  return { ...k, scopes: r.json.scopes };
}
// The owner's switches for agents' changes: { halted, selfHeal }.
export async function agentSettings(change) {
  const r = await api('/agents/settings', { method: 'PUT', body: change });
  if (r.status !== 200) throw new Error(`changing agent settings failed: ${r.status} ${r.text}`);
  return r.json.settings;
}
export async function deleteKey(id) {
  const r = await api(`/agents/${id}`, { method: 'DELETE' });
  made.delete(id);
  return r;
}
export async function cleanupKeys() {
  for (const id of [...made]) await deleteKey(id).catch(() => {});
}

// The door allows 120 requests a minute per key: hand out a fresh key every `per` uses (keys that can act with act: true).
export class KeyPool {
  constructor(prefix, per = 100, { act = false } = {}) { this.prefix = prefix; this.per = per; this.act = act; this.cur = null; this.used = 0; }
  async token() {
    if (!this.cur || this.used >= this.per) {
      const old = this.cur;
      this.cur = await (this.act ? createActKey : createKey)(this.prefix);
      this.used = 0;
      if (old) await deleteKey(old.id).catch(() => {}); // keep few keys alive
    }
    this.used++;
    return this.cur.token;
  }
}

// The service's own records: audit.jsonl (who changed what) and events.jsonl (the fleet's record, Activity).
// (a line that isn't JSON, as a test may write, is left out)
const jsonLines = file => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } }) : []);
export const auditLines = (fleet = T.fleet) => jsonLines(join(fleet.stateDir, 'audit.jsonl'));
export const eventLines = (fleet = T.fleet) => jsonLines(join(fleet.stateDir, 'events.jsonl'));

// Sparkie's chats, as the page uses them. say() sends one message and returns the server-sent events, the tool events
// and the answer as saved (`started` comes first; `done` carries the message).
export async function newChat(headers = {}) {
  const r = await api('/chats', { method: 'POST', body: {}, headers });
  if (r.status !== 201) throw new Error(`POST /chats: ${r.status} ${r.text}`);
  return r.json.id;
}
export const sseEvents = text => text.split('\n\n').map(b => b.trim()).filter(b => b.startsWith('data:')).map(b => JSON.parse(b.slice(5)));
export async function say(chat, text, headers = {}) {
  const r = await api(`/chats/${chat}/messages`, { method: 'POST', body: { text }, headers });
  if (r.status !== 200) throw Object.assign(new Error(`POST /chats/${chat}/messages: ${r.status} ${r.text}`), { status: r.status, json: r.json });
  const events = sseEvents(r.text);
  const done = events.find(e => e.type === 'done'), error = events.find(e => e.type === 'error');
  if (!done) throw new Error(`no answer: ${JSON.stringify(error || events.slice(-2))}`);
  return { events, tools: events.filter(e => e.type === 'tool'), message: done.message, text: done.message.content };
}
export const chatMessages = async chat => (await api(`/chats/${chat}`)).json.messages;
// Presses one of Sparkie's buttons in a chat (as the page does).
export const choose = (chat, choice, headers = {}) => api(`/chats/${chat}/choose`, { method: 'POST', body: { choice }, headers });

export const sleep = ms => new Promise(r => setTimeout(r, ms));
// Polls fn until it returns something truthy (or throws after `timeout`).
export async function waitFor(fn, { timeout: limit = 45000, every = 500, what = 'condition' } = {}) {
  const timeout = limit * SLOW, until = Date.now() + timeout;
  let last;
  for (;;) {
    last = await fn();
    if (last) return last;
    if (Date.now() > until) throw new Error(`timed out after ${timeout} ms waiting for ${what}`);
    await sleep(every);
  }
}

// A POST whose body reaches the server in two pieces, cut inside a character of several bytes (the first one that ends
// at or after byte `from`), a moment apart so the server reads them separately: what a long body, or a slow sender,
// does by chance. Resolves with the status, the answer's text and where the cut was.
export function postInTwo(url, text, { from = 0, headers = {}, pause = 200 } = {}) {
  const bytes = Buffer.from(text);
  let cut = Math.max(1, from);
  while (cut < bytes.length && (bytes[cut] & 0xc0) !== 0x80) cut++;
  if (cut >= bytes.length) throw new Error(`no character of several bytes after byte ${from} to cut inside`);
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: u.hostname, port: u.port, path: `${u.pathname}${u.search}`, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': bytes.length, ...headers } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8'), cut }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('socket', s => s.setNoDelay(true));
    req.write(bytes.subarray(0, cut));
    setTimeout(() => req.end(bytes.subarray(cut)), pause * SLOW);
  });
}
