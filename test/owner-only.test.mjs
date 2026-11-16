// Covers: Spark Console has one user, the owner (E10d; contract 2.1; the one page, milestone 4). The state an older
// build wrote stays where it is: access.json still holds two members, two requests to be let in and a share link,
// sessions.json a former member's browser cookie and terminal token, agents.json a key made for a former member. With
// all of that present the owner works as before, over the tailnet, signed in from the internet, and with an agent key;
// access.json is never rewritten, and the leftover rows are still there for a build that goes back. Nobody else gets
// in: for every route the handler serves (read from 24-handler.mjs, so a new route has to be listed here), a former
// member and a stranger on the tailnet, nobody from the internet, a former member's cookie, terminal token or agent
// key, and a former member's login carrying the owner's agent key all get 401; the public routes answer a former member
// exactly as they answer a stranger; the removed routes (/access…, /access/ask, /public/ask) answer the owner as an
// unknown path does; the app door and a WebSocket refuse them too. The checks that lived in member code now admit only
// the owner (canUse, canManage, mustUse), and the owner's own paths through them still work. No answer, notice or page
// names a view the page no longer has (Access → Agents, People, Models, Clusters), outside one string in runAction,
// named below. Starts a stand-in fleet: run it on a Spark.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import http from 'node:http';
import netSocket from 'node:net';
import { T, useFleet, api, createKey, call, rpc, newChat, say, agentSettings, REPO, MEMBER, SLOW } from './lib.mjs';
import { serviceConfig } from './start-mock.mjs';

const ORIGIN = serviceConfig().origin, HOST = new URL(ORIGIN).hostname, DOOR_HOST = `${HOST}:10000`;
const read = f => readFileSync(join(REPO, f), 'utf8');
const sha = t => createHash('sha256').update(t).digest('hex');
const now = new Date().toISOString();
// What an older build left: a browser cookie and a terminal token of the owner's and of a former member's, and a key
// made for a former member (a key's owner is the login it was made for).
const token = c => `scs_${c.repeat(43)}`;
const OWNER_BROWSER = token('o'), MEMBER_BROWSER = token('m'), MEMBER_TERMINAL = token('n');
const MEMBER_KEY = `sck_${'k'.repeat(43)}`;
const RUNNER = 'runner@test';   // a former member who could run models
const LEFT = {
  requests: [{ login: 'asker@test', name: 'Asker', note: 'let me in', verified: true, at: now }, { login: 'mail@example.test', name: 'Mail', note: '', verified: false, at: now }],
  invite: { url: 'https://login.tailscale.com/admin/invite/abcd1234', at: now },
  runner: { id: 'fedcba9876543210', login: RUNNER, permissions: { nodeIds: ['spark1', 'spark2', 'spark3', 'spark4'], chat: true, files: 'write', sharedFiles: 'write', concurrentChats: 2, deploy: true }, addedAt: now },
};
const session = (id, t, kind, login) => ({ id, hash: sha(t), kind, name: kind === 'browser' ? 'Phone' : 'Terminal', login, via: kind === 'browser' ? 'passkey' : 'code',
  from: '203.0.113.9', lastFrom: '203.0.113.9', createdAt: now, lastUsedAt: now, passkeyAt: now });
let accessBefore, ownerKey;

useFleet({
  prepare: ({ stateDir }) => {
    const access = JSON.parse(readFileSync(join(stateDir, 'access.json'), 'utf8'));   // member@test is in it already
    Object.assign(access, { members: [...access.members, LEFT.runner], requests: LEFT.requests, invite: LEFT.invite });
    writeFileSync(join(stateDir, 'access.json'), JSON.stringify(access, null, 2), { mode: 0o600 });
    writeFileSync(join(stateDir, 'sessions.json'), JSON.stringify({ sessions: [session('a0a0a0a0a0a0', OWNER_BROWSER, 'browser', 'owner@test'),
      session('c0c0c0c0c0c0', MEMBER_BROWSER, 'browser', MEMBER), session('d0d0d0d0d0d0', MEMBER_TERMINAL, 'terminal', MEMBER)] }), { mode: 0o600 });
    writeFileSync(join(stateDir, 'agents.json'), JSON.stringify({ keys: [{ id: '0f0f0f0f0f0f', name: 'a member’s agent', login: MEMBER, hash: sha(MEMBER_KEY),
      scopes: ['fleet:read', 'fleet:act'], internet: true, createdAt: now, lastUsedAt: null }] }), { mode: 0o600 });
    accessBefore = readFileSync(join(stateDir, 'access.json'), 'utf8');
  },
}, async () => { ownerKey = (await createKey('owner-only')).token; });

const state = name => join(T.fleet.stateDir, name);
const FUNNEL = { 'tailscale-funnel-request': '?1', 'x-forwarded-for': '203.0.113.50' };
// Everyone who isn't the owner, with what they bring.
const NOT_OWNER = () => ({
  'a former member on the tailnet': { 'tailscale-user-login': MEMBER },
  'a former member who could run models, on the tailnet': { 'tailscale-user-login': RUNNER },
  'a stranger on the tailnet': { 'tailscale-user-login': 'stranger@test' },
  'nobody, from the internet': FUNNEL,
  'a former member’s cookie, from the internet': { ...FUNNEL, cookie: `sc_session=${MEMBER_BROWSER}` },
  'a former member’s terminal token, from the internet': { ...FUNNEL, authorization: `Bearer ${MEMBER_TERMINAL}` },
  'a former member’s agent key, from the internet': { ...FUNNEL, authorization: `Bearer ${MEMBER_KEY}` },
  'a former member’s agent key, on the tailnet as nobody in particular': { 'tailscale-user-login': 'stranger@test', authorization: `Bearer ${MEMBER_KEY}` },
  'a former member’s login with the owner’s agent key': { 'tailscale-user-login': MEMBER, authorization: `Bearer ${ownerKey}` },
});

/* ───────── the routes the handler serves ───────── */
// One concrete path for each way 24-handler.mjs matches a path; checked against the source below, so a route added
// there without a line here fails this file.
const ROUTES = ['/actions', '/actions/fleet_status', '/agents', '/agents/0123456789ab', '/agents/settings', '/auth/passkey/begin', '/auth/passkey/register',
  '/auth/passkeys', `/auth/passkeys/${'A'.repeat(20)}`, '/auth/putback', '/auth/putback/keep', '/auth/recovery', '/auth/device/approve', '/auth/sessions', '/auth/anything-else', '/bootstrap', '/chats',
  '/chats/sc_0123456789abcdef', '/chats/sc_0123456789abcdef/messages', '/chats/sc_0123456789abcdef/choose', '/connections', '/deploy', '/deploy/cluster',
  '/deploy/cluster-plan', '/deploy/options', '/deploy/plan', '/deploy/plans', '/desired', '/desired/bring-back', '/desired/forget', '/fabric', '/gpu',
  '/heartbeat', '/jobs', '/jobs/0123456789ab', '/jobs/0123456789ab/cancel', '/main', '/main/check', '/main/choices', '/main/eval', '/main/trial', '/main/plan', '/main/route',
  '/main/start', '/main/stop', '/main/use', '/mcp', '/metrics', '/models', '/nodes/spark3/workloads', '/nodes/spark3/diagnostics', '/nodes/spark3/logs/console',
  `/nodes/spark3/logs/container-${'a'.repeat(64)}`, '/recipes', '/recipes/add', '/recipes/add-list', '/recipes/dig', '/recipes/download',
  '/recipes/search', '/rollback', '/status', '/stop', '/telegram', '/telegram/approve', '/telegram/needs', '/telegram/pair', '/verified', '/v1/models', '/v1/chat/completions',
  '/workflows', '/workflows/validate',
  // gone with members and sharing (E10d): unknown paths now
  '/access', '/access/ask', '/access/requests', '/access/invite', '/access/0123456789abcdef', '/public/ask',
  // gone with the file browser (E10e): an unknown path now
  '/nodes/spark3/files'];
// Public: they answer whoever asks (the sign-in routes are how the owner signs in).
const SIGNIN = ['/auth/signin/begin', '/auth/signin', '/auth/signin/recovery', '/auth/signout', '/auth/device/start', '/auth/device/poll'];
const PUBLIC = ['/health', '/public/fleet', '/whoami', ...SIGNIN];

test('the list here holds every route 24-handler.mjs serves', () => {
  const src = read('service/src/24-handler.mjs');
  for (const [, p] of src.matchAll(/path === '([^']+)'/g)) assert.ok(ROUTES.includes(p) || PUBLIC.includes(p), `${p} is served but not checked here`);
  for (const [, p] of src.matchAll(/path\.startsWith\('([^']+)'\)/g)) assert.ok(ROUTES.some(r => r.startsWith(p)), `${p}… is served but not checked here`);
  for (const re of [...src.matchAll(/path\.match\(\/(\^.*?\$)\/\)|\/(\^\\\/[^ ]*?)\/\.test\(path\)/g)].map(m => m[1] || m[2])) {
    assert.ok(ROUTES.some(r => new RegExp(re).test(r)), `/${re}/ is served but not checked here`);
  }
  assert.match(src, /const PUBLIC_ROUTES = \['\/public\/fleet', '\/whoami', \.\.\.SIGNIN_ROUTES\];/, 'the public routes are these');
  assert.match(read('service/src/22-sessions.mjs'), new RegExp(`const SIGNIN_ROUTES = \\[${SIGNIN.map(p => `'${p.replace(/\//g, '\\/')}'`).join(', ')}\\];`));
});

describe('with an older build’s members, requests, sessions and keys still in the state', () => {
  test('the owner signs in and works as before: tailnet, a browser signed in from the internet, an agent key', { timeout: 120000 * SLOW }, async () => {
    const boot = await api('/bootstrap');
    assert.equal(boot.status, 200, boot.text);
    assert.deepEqual([boot.json.viewer.role, boot.json.userName], ['owner', 'Test Owner']);
    for (const p of ['/status', '/agents', '/jobs', '/chats', '/workflows']) assert.equal((await api(p)).status, 200, p);
    assert.equal((await api('/whoami')).json.access, 'owner');
    // From the internet, the owner's browser cookie.
    const away = { ...FUNNEL, cookie: `sc_session=${OWNER_BROWSER}` };
    const b = await api('/bootstrap', { headers: away });
    assert.equal(b.status, 200, b.text);
    assert.deepEqual([b.json.viewer.role, b.json.session.kind], ['owner', 'browser']);
    assert.equal((await api('/status', { headers: away })).status, 200);
    // A chat answers, and the owner's agent key works at the agent door.
    const chat = await newChat();
    assert.ok(chat, 'a new chat');
    assert.equal((await say(chat, 'hello')).message.role, 'assistant');
    assert.equal((await rpc(ownerKey, 'tools/list')).status, 200);
    assert.equal((await call(ownerKey, 'fleet_status', {})).isError, false);
  });

  test('the older state is left as it was: access.json untouched, the former members’ rows still there for a build that goes back', async () => {
    assert.equal(readFileSync(state('access.json'), 'utf8'), accessBefore, 'access.json is never rewritten');
    const good = JSON.parse(readFileSync(state('access.json.good'), 'utf8'));
    assert.deepEqual(good.members.map(m => m.login).sort(), [MEMBER, RUNNER].sort(), 'the last good copy is the whole file, leftovers too');
    assert.deepEqual([good.requests.length, good.invite.url], [2, LEFT.invite.url]);
    const s = JSON.parse(readFileSync(state('sessions.json'), 'utf8')).sessions;
    assert.deepEqual(s.filter(x => x.login === MEMBER).map(x => x.id).sort(), ['c0c0c0c0c0c0', 'd0d0d0d0d0d0'], 'the former member’s sessions are still on file');
    assert.ok(JSON.parse(readFileSync(state('agents.json'), 'utf8')).keys.some(k => k.login === MEMBER), 'and the key made for them');
  });
});

describe('nobody else gets in', () => {
  test('every route: 401 for everyone who isn’t the owner, whatever they bring', { timeout: 300000 * SLOW }, async () => {
    for (const [who, headers] of Object.entries(NOT_OWNER())) {
      for (const path of ROUTES) {
        for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
          const r = await api(path, { method, headers, ...(method === 'GET' ? {} : { body: {} }) });
          assert.equal(r.status, 401, `${who}: ${method} ${path} → ${r.status} ${r.text.slice(0, 200)}`);
        }
      }
    }
  });

  test('the public routes answer a former member just as they answer a stranger', { timeout: 120000 * SLOW }, async () => {
    for (const member of [MEMBER, RUNNER]) {
      for (const path of PUBLIC) {
        const [m, s] = [await api(path, { headers: { 'tailscale-user-login': member } }), await api(path, { headers: { 'tailscale-user-login': 'stranger@test' } })];
        assert.equal(m.status, s.status, `${member}: GET ${path} → ${m.status}, a stranger ${s.status}`);
      }
      const w = (await api('/whoami', { headers: { 'tailscale-user-login': member } })).json;
      assert.deepEqual(w, { login: member, access: 'none', signin: false, recovery: false, session: null, via: 'tailnet' });
    }
  });

  test('the routes members and sharing had answer the owner as an unknown path does', async () => {
    for (const path of ['/access', '/access/ask', '/access/requests', '/access/invite', '/access/0123456789abcdef', '/public/ask']) {
      for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
        const body = method === 'GET' ? undefined : { login: 'x@test', decision: 'approve', preset: 'run', permissions: LEFT.runner.permissions, url: '', email: 'x@test' };
        const [a, b] = [await api(path, { method, body }), await api('/no-such-route', { method, body })];
        assert.deepEqual([a.status, a.json], [b.status, b.json], `the owner: ${method} ${path} → ${a.status} ${a.text}`);
      }
    }
    assert.equal(readFileSync(state('access.json'), 'utf8'), accessBefore, 'nothing was written');
  });

  test('a WebSocket on the API, and the app door (HTTP and WebSocket), refuse them too', { timeout: 120000 * SLOW }, async () => {
    for (const [who, headers] of Object.entries(NOT_OWNER())) {
      assert.equal(await upgrade('api', '/console/api/bootstrap', headers), 'HTTP/1.1 404 Not Found', `${who}: a WebSocket on the API`);
      for (const path of ['/console/api/open/spark4/notebook', '/']) {
        const r = await door(path, { ...headers, 'sec-fetch-site': 'none' });
        assert.ok([401, 403].includes(r.status), `${who}: the app door ${path} → ${r.status} ${r.text.slice(0, 120)}`);
        assert.ok(!/__Host-sc_door=[^;]/.test(String(r.headers['set-cookie'] || '')), `${who}: no door ticket`);
      }
      assert.match(String(await upgrade('door', '/ws', { ...headers, origin: `https://${DOOR_HOST}` })), /^HTTP\/1\.1 40[13]/, `${who}: a WebSocket at the door`);
    }
  });
});

describe('no check that lived in member code lets anyone else through, and the owner still gets through it', () => {
  test('canUse, canManage and mustUse admit the owner only; a viewer is the owner or nobody', () => {
    const src = read('service/src/03-identity.mjs');
    assert.match(src, /\nconst canUse = viewer => viewer\?\.role === 'owner';\n/);
    assert.match(src, /\nconst canManage = viewer => viewer\?\.role === 'owner';\n/);
    assert.match(src, /\nfunction mustUse\(viewer\) \{\n  if \(!canManage\(viewer\)\) throw new HttpError\(403, 'Only the owner can do that\.'\);\n\}\n/);
    const who = /\nfunction viewerForLogin\(login\) \{[\s\S]*?\n\}\n/.exec(src)?.[0] || '';
    assert.match(who, /return \{ login, role: 'owner', nodeIds: null, chat: true, permissions: ownerPermissions\(\) \};/);
    assert.ok(!/member/i.test(who.replace(/^\s*\/\/.*$/gm, '')), 'no member path in it');
    // Every viewer the service makes for itself (healing, Telegram, the self-test, a carried-on task) is the owner.
    const server = read('service/server.mjs');
    for (const m of server.matchAll(/\{ login: [^{}]*?nodeIds: null[^{}]*?\}/g)) assert.match(m[0], /role: 'owner'/, m[0]);
    assert.ok(!/\brole: 'member'/.test(server), 'nothing makes a member');
  });

  test('the owner’s paths through those checks still work: a deploy plan, every operation, four answers at once', { timeout: 120000 * SLOW }, async () => {
    // (was "the owner, or a member allowed to run models")
    assert.equal((await api('/deploy/options')).status, 200);
    const plan = await api('/deploy/plan?model=testorg--Qwen3.8-27B-abliterated-GGUF&node=spark3');
    assert.ok(![401, 403].includes(plan.status), plan.text);
    // (was "the owner sees every operation; a member the ones they started")
    const j = await api('/jobs');
    assert.equal(j.status, 200, j.text);
    // (was "the owner 4 answers at once, a member theirs")
    const chats = await Promise.all(Array.from({ length: 4 }, () => newChat()));
    const all = await Promise.all(chats.map(c => api(`/chats/${c}/messages`, { method: 'POST', body: { text: 'hello, take 1 seconds' } })));
    assert.deepEqual(all.map(x => x.status), [200, 200, 200, 200], all.map(x => x.text.slice(0, 80)).join(' | '));
  });
});

describe('no answer, notice or page names a view the page no longer has', () => {
  const GONE = /Access →|Access ->|→ People|→ Agents(?! and Telegram)|\bon Models\b|Models →|Clusters →|Preview as a member|Request access|\b(?:Home|Files|Models|Access|People) (?:page|view|tab)\b/;
  // In runAction, which the rail's builder holds: known, and nothing else.
  const KNOWN = [
    'The owner can resume them in Access → Agents.',
  ];

  test('the service: nothing but the one known line', () => {
    const server = read('service/server.mjs');
    const lines = server.split('\n').filter(l => GONE.test(l));
    const unknown = lines.filter(l => !KNOWN.some(k => l.includes(k)));
    assert.deepEqual(unknown, [], unknown.join('\n'));
    for (const k of KNOWN) assert.equal(server.split(k).length - 1, 1, k);
  });

  test('the page: no member preview, no asking to be let in, no removed view', () => {
    for (const f of ['public/app.js', 'public/index.html', 'public/styles.css']) {
      const text = read(f);
      assert.ok(!GONE.test(text), `${f}: ${text.match(GONE)?.[0]}`);
      for (const w of ['memberPreview', 'preview-ribbon', 'access/ask', 'public/ask', 'openAsk', 'Members sign in']) assert.ok(!text.includes(w), `${f}: ${w}`);
    }
  });

  test('/pause says where the switch is now, and /help too', { timeout: 120000 * SLOW }, async () => {
    const chat = await newChat();
    try {
      const p = await say(chat, '/pause');
      assert.match(p.text, /\nTo resume: your account menu → Agents and Telegram, with your passkey\./);
      assert.ok(!GONE.test(p.text), p.text);
    } finally { await agentSettings({ halted: false }); }
    const h = await say(chat, '/help');
    assert.match(h.text, /\/pause: pause agents’ changes \(resume in your account menu → Agents and Telegram, with your passkey\)/);
    assert.ok(!GONE.test(h.text), h.text);
  });
});

/* ───────── raw sockets: a WebSocket upgrade, and the app door's socket ───────── */
// A WebSocket upgrade: on the API's local port ('api') or the app door's socket ('door'); the answer's first line.
function upgrade(where, path, headers = {}) {
  return new Promise(resolve => {
    const s = where === 'door' ? netSocket.connect(state('door.sock')) : netSocket.connect(T.fleet.port, '127.0.0.1');
    let got = '';
    const timer = setTimeout(() => s.destroy(), 15000);
    s.on('connect', () => {
      const h = { host: where === 'door' ? DOOR_HOST : new URL(ORIGIN).host, origin: ORIGIN, connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', ...headers };
      s.write(`GET ${path} HTTP/1.1\r\n${Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
    });
    s.on('data', d => { got += d; if (got.includes('\r\n')) s.destroy(); });
    s.on('error', () => {});
    s.on('close', () => { clearTimeout(timer); resolve(got.split('\r\n')[0] || null); });
  });
}
// One request to the app door's socket, as Tailscale serve hands it over.
function door(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: state('door.sock'), path, method: 'GET', agent: false, headers: { host: DOOR_HOST, ...headers } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.setTimeout(60000 * SLOW, () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end();
  });
}
