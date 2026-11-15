// Covers: The owner's passkey (WebAuthn, at the console's one address), answered by a software authenticator in the
// test (P-256 or RSA, "none" attestation). Before one exists: new agent keys and remote-code deploys need none; the
// old relay routes are gone (404). Every change to an agent's rights is an audit line (`agent-added`,
// `agent-can-change`, `agent-settings`, …, via `page`). Setting one up: refused
// for another origin, domain, type or challenge, without UP, UV or a credential, from inside another site; challenges
// single use; RSA keys must be 2048–4096 bits with e = 65537. With one: every gated change without `X-Spark-Passkey`
// gets 428 `confirm`; a confirmation works once, only for its exact method, path and body; refused for a wrong origin
// or domain, a tampered or foreign signature, an unknown passkey, no UP/UV, after 3 minutes (the service's clock is
// moved with `mock/clock.mjs`); a counter going backwards is noted, not refused. Pausing, removing an agent, and
// resuming an automatic pause with exactly `{halted: false}` need none. One pool of 150
// challenges, the oldest making way. Each route's body limit applies when the check reads it. An unreadable
// `passkeys.json` lets nothing sensitive through but still lets a right be taken away.
//
// The owner's passkey (WebAuthn), at Spark Console's one address (the main address). A change that needs it carries its
// confirmation inline (X-Spark-Passkey: a one-time challenge for exactly that change, signed by one of the owner's
// passkeys on the page). Passkeys are set up there too. Until one exists, nothing asks for one. There's no relay.
// A software authenticator here (a P-256 or RSA key from node:crypto) answers like Touch ID would: "none" attestation,
// user present and verified. Also: resuming an automatic pause without a passkey, and
// every change to an agent's rights as an audit line.
// Run with the rest: node --test --test-concurrency=4 'test/*.test.mjs'   (SPARK_TEST_STRICT=1 makes known product bugs fail)
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign as signWith } from 'node:crypto';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, createKey, MEMBER, OWNER, sleep, auditLines, eventLines, bug, SLOW } from './lib.mjs';
import { serviceConfig, TEST_DIR } from './start-mock.mjs';

// Spark Console's address: service/config.json's origin.
const MAIN_ORIGIN = serviceConfig().origin;
const MAIN_HOST = new URL(MAIN_ORIGIN).hostname;
const TAILNET = MAIN_HOST.split('.').slice(1).join('.'); // e.g. tailab9aa9.ts.net: a passkey can be made for it too

useFleet({ env: { NODE_OPTIONS: `--import=${join(TEST_DIR, 'mock', 'clock.mjs')}` } });

/* ───────── a software authenticator ───────── */
const sha256 = d => createHash('sha256').update(d).digest();
const b64 = buf => Buffer.from(buf).toString('base64url');
const raw = s => Buffer.from(s, 'base64url');
const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
// The part of CBOR WebAuthn needs: integers, byte and text strings, arrays, maps.
function cbor(v) {
  const head = (major, n) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    if (n < 65536) return Buffer.concat([Buffer.from([(major << 5) | 25]), u16(n)]);
    return Buffer.concat([Buffer.from([(major << 5) | 26]), u32(n)]);
  };
  if (Number.isInteger(v)) return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === 'string') { const b = Buffer.from(v, 'utf8'); return Buffer.concat([head(3, b.length), b]); }
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cbor)]);
  const entries = v instanceof Map ? [...v] : Object.entries(v);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, x]) => [cbor(k), cbor(x)])]);
}
const UP = 0x01, UV = 0x04, AT = 0x40;
// An RS256 public key as COSE: modulus n and exponent e as big-endian bytes.
const rsaCose = (n, e) => new Map([[1, 3], [3, -257], [-1, n], [-2, e]]);
class Authenticator {
  // ES256 (P-256) by default; { rsa: true } for RS256 (2048 bits, e = 65537).
  constructor(rpId, { rsa = false } = {}) {
    Object.assign(this, rsa ? generateKeyPairSync('rsa', { modulusLength: 2048 }) : generateKeyPairSync('ec', { namedCurve: 'P-256' }));
    this.rsa = rsa;
    this.credId = randomBytes(32);
    this.rpId = rpId;
  }
  get id() { return b64(this.credId); }
  cose() {
    const jwk = this.publicKey.export({ format: 'jwk' });
    return this.rsa ? rsaCose(raw(jwk.n), raw(jwk.e)) : new Map([[1, 2], [3, -7], [-1, 1], [-2, raw(jwk.x)], [-3, raw(jwk.y)]]);
  }
  authData({ rpId = this.rpId, flags, signCount = 0, attested = false, cose }) {
    const parts = [sha256(rpId), Buffer.from([flags]), u32(signCount)];
    if (attested) parts.push(Buffer.alloc(16), u16(this.credId.length), this.credId, cbor(cose || this.cose()));
    return Buffer.concat(parts);
  }
  clientData({ type, challenge, origin, crossOrigin = false }) {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin }));
  }
  // navigator.credentials.create() → the body of POST /auth/passkey/register. `cose` replaces the public key sent.
  register(begin, { origin = MAIN_ORIGIN, rpId, flags = UP | UV | AT, type = 'webauthn.create', challenge = begin.challenge, crossOrigin, name = 'Test passkey', cose } = {}) {
    const cd = this.clientData({ type, challenge, origin, crossOrigin });
    const ao = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', this.authData({ rpId, flags, attested: true, cose })]]));
    return { challengeId: begin.challengeId, name, clientDataJSON: b64(cd), attestationObject: b64(ao) };
  }
  // navigator.credentials.get() → what X-Spark-Passkey carries.
  sign(begin, { origin = MAIN_ORIGIN, rpId, flags = UP | UV, type = 'webauthn.get', challenge = begin.challenge, crossOrigin, signCount = 0, id = this.id, tamper = false } = {}) {
    const cd = this.clientData({ type, challenge, origin, crossOrigin }), ad = this.authData({ rpId, flags, signCount });
    const signature = signWith('sha256', Buffer.concat([ad, sha256(cd)]), this.privateKey);
    if (tamper) signature[signature.length - 1] ^= 0x01;
    return { challengeId: begin.challengeId, id, clientDataJSON: b64(cd), authenticatorData: b64(ad), signature: b64(signature) };
  }
}
const header = assertion => b64(JSON.stringify(assertion));

/* ───────── the address ───────── */
const main = (path, opts = {}) => api(path, opts);
const is = (r, status, what = '') => assert.equal(r.status, status, `${what} → ${r.status} ${r.text}`);

async function beginRegister(via = main) {
  const r = await via('/auth/passkey/begin', { method: 'POST', body: { purpose: 'register' } });
  is(r, 200, 'begin register');
  return r.json;
}
async function beginConfirm(via, method, path, body) {
  const r = await via('/auth/passkey/begin', { method: 'POST', body: { purpose: 'confirm', method, path, ...(body === undefined ? {} : { body }) } });
  is(r, 200, `begin confirm ${method} ${path}`);
  return r.json;
}
// A change confirmed with a passkey, as the page does it: a challenge for exactly this change, signed on the page
// (unless `origin` says otherwise), sent with X-Spark-Passkey.
async function confirmed(via, method, path, body, { auth = KEY1, ...answer } = {}) {
  const b = await beginConfirm(via, method, path, body);
  const h = header(auth.sign(b, answer));
  const r = await via(path, { method, body, headers: { 'x-spark-passkey': h } });
  return Object.assign(r, { header: h, challengeId: b.challengeId, summary: b.summary });
}

const agentIds = async () => { const r = await main('/agents'); is(r, 200); return r.json.keys.map(k => k.id).sort(); };
const agentSettingsNow = async () => (await main('/agents')).json.settings;
const canAct = async id => (await main('/agents')).json.keys.find(k => k.id === id).scopes.includes('fleet:act');
const passkeyList = async () => { const r = await main('/auth/passkeys'); is(r, 200); return r.json.keys; };
const agentName = () => `pk-${randomBytes(4).toString('hex')}`;
// Moves the service's clock (mock/clock.mjs) ahead of the real time.
const setClock = async ms => { writeFileSync(join(T.fleet.dir, 'clock-offset'), String(ms)); await sleep(400); };
// Lets every pending challenge expire: the service drops expired ones when it makes the next one (which stays).
async function forgetChallenges() {
  await setClock(20 * 60000);
  try { await beginRegister(); } finally { await setClock(0); }
}
// The last audit line for an action (after `from`, a count of lines seen before).
const auditAfter = (from, action) => auditLines().slice(from).filter(l => l.action === action);

const KEY1 = new Authenticator(TAILNET); // the first passkey, made for the tailnet
const KEY2 = new Authenticator(MAIN_HOST); // a second one, for the main address only
const KEY3 = new Authenticator(TAILNET); // a third, never kept
const RSA_KEY = new Authenticator(MAIN_HOST, { rsa: true }); // a security key answering with RS256
const STRANGER = new Authenticator(TAILNET); // never set up
// An agent key made with a confirmation, at the main address (the fleet and its keys go away with the test file).
async function newAgent() {
  const r = await confirmed(main, 'POST', '/agents', { name: agentName() });
  is(r, 201, 'POST /agents (confirmed)');
  return r.json.id;
}
// What the old two-step relay flow used; all gone now.
const RELAY = id => [['GET', `/auth/passkey/challenge/${id}`], ['GET', `/auth/passkey/status/${id}`], ['POST', '/auth/passkey/approve']];

/* ───────── before any passkey ───────── */
describe('before any passkey is set up', () => {
  test('none listed; the domains offered are the main address and its tailnet', async () => {
    const r = await main('/auth/passkeys');
    is(r, 200);
    assert.deepEqual(r.json.keys, []);
    for (const id of [MAIN_HOST, TAILNET]) assert.ok(r.json.rpIds.includes(id), `rpIds ${JSON.stringify(r.json.rpIds)} lack ${id}`);
    assert.ok(!r.json.rpIds.includes('ts.net'), 'never the shared ts.net');
    assert.equal((await main('/bootstrap')).json.passkeys, 0);
  });

  test('nothing to confirm with yet: begin confirm → 409', async () => {
    is(await main('/auth/passkey/begin', { method: 'POST', body: { purpose: 'confirm', method: 'POST', path: '/agents', body: { name: 'x' } } }), 409);
  });

  test('new agent keys and remote-code deploys need no passkey yet (nothing can lock the owner out)', async () => {
    const made = await main('/agents', { method: 'POST', body: { name: agentName() } });
    is(made, 201, 'POST /agents');
    is(await main(`/agents/${made.json.id}`, { method: 'PUT', body: { act: true } }), 200, 'PUT /agents/<id>');
    assert.equal(await canAct(made.json.id), true);
    is(await main(`/agents/${made.json.id}`, { method: 'DELETE' }), 200, 'DELETE /agents/<id>');
    for (const body of [{ selfHeal: true }, { halted: false }, { halted: false, selfHeal: true }]) is(await main('/agents/settings', { method: 'PUT', body }), 200, `PUT /agents/settings ${JSON.stringify(body)}`);
    // Not asked for a passkey: on to the deploy itself, which wants a model and a Spark.
    for (const path of ['/deploy', '/deploy/cluster']) is(await main(path, { method: 'POST', body: { allowRemoteCode: true } }), 400, `POST ${path} {allowRemoteCode}`);
  });

  test('the two-step relay is gone: /auth/passkey/challenge/<id>, /status/<id> and /approve → 404', async () => {
    for (const [method, path] of RELAY('c'.repeat(18))) is(await main(path, { method, ...(method === 'POST' ? { body: { challengeId: 'c'.repeat(18) } } : {}) }), 404, `${method} ${path}`);
  });

  test('the passkey routes need the page\'s header and a matching Origin', async () => {
    const body = { purpose: 'register' };
    is(await main('/auth/passkey/begin', { method: 'POST', body, headers: { 'x-spark-console': null } }), 403, 'no X-Spark-Console');
    is(await main('/auth/passkey/begin', { method: 'POST', body, headers: { origin: 'https://evil.example' } }), 403, 'another Origin');
    is(await main('/auth/passkey/begin', { method: 'POST', body, headers: { origin: null } }), 403, 'no Origin');
    is(await main('/auth/passkey/register', { method: 'POST', body: {}, headers: { origin: 'https://evil.example' } }), 403, 'registering from another Origin');
  });
});

/* ───────── every change to who has access is on the record ───────── */
describe('audit lines for changes to who has access (actor owner, via page)', () => {
  test('each change is one line', async () => {
    const from = auditLines().length;
    const name = agentName(), made = await main('/agents', { method: 'POST', body: { name } });
    is(made, 201);
    is(await main(`/agents/${made.json.id}`, { method: 'DELETE' }), 200);
    const one = action => {
      const lines = auditAfter(from, action);
      assert.equal(lines.length, 1, `${action}: ${JSON.stringify(lines)}`);
      assert.equal(lines[0].actor, 'owner', action);
      assert.equal(lines[0].via, 'page', action);
      assert.equal(lines[0].ok, true, action);
      return lines[0].args;
    };
    assert.deepEqual(one('agent-added'), { agent: name });
    assert.deepEqual(one('agent-removed'), { agent: name });
  });
  test('letting an agent act, and the agents\' switches, are lines too',
    {}, async () => {
      const from = auditLines().length;
      const k = await createKey('pk-audit-switches');
      is(await main(`/agents/${k.id}`, { method: 'PUT', body: { act: false } }), 200);
      is(await main('/agents/settings', { method: 'PUT', body: { selfHeal: true } }), 200);
      assert.equal(auditAfter(from, 'agent-can-change')[0]?.via, 'page');
      assert.equal(auditAfter(from, 'agent-settings')[0]?.via, 'page');
    });
});

/* ───────── setting up the first passkey ───────── */
describe('setting up the first passkey (at the main address)', () => {
  test('begin gives a challenge, the domains, nothing to exclude and the owner as the user', async () => {
    for (const [where, via] of [['the main address', main]]) {
      const b = await beginRegister(via);
      assert.match(b.challengeId, /^[a-f0-9]{18}$/, where);
      assert.ok(Buffer.from(b.challenge, 'base64url').length >= 32, 'a 32-byte challenge');
      assert.deepEqual(b.exclude, []);
      assert.ok(b.rpIds.includes(TAILNET) && b.rpIds.includes(MAIN_HOST), JSON.stringify(b.rpIds));
      assert.equal(b.user.name, OWNER);
      assert.equal(Buffer.from(b.user.id, 'base64url').length, 16);
      assert.notEqual((await beginRegister(via)).challenge, b.challenge, 'a fresh challenge each time');
    }
  });

  const badRegistrations = [
    ['another site\'s origin', { origin: 'https://evil.example' }, /own addresses/],
    ['the main host without its port', { origin: `https://${MAIN_HOST}` }, /own addresses/],
    ['http, not https', { origin: MAIN_ORIGIN.replace('https:', 'http:') }, /own addresses/],
    ['another site\'s domain', { rpId: 'evil.example' }, /another site/],
    ['all of ts.net', { rpId: 'ts.net' }, /another site/],
    ['no user verification (UV)', { flags: UP | AT }, /check it’s you/],
    ['no user presence (UP)', { flags: UV | AT }, /check it’s you/],
    ['no credential (AT)', { flags: UP | UV }, /No credential/],
    ['a sign-in answer, not a registration', { type: 'webauthn.get' }, /Wrong kind/],
    ['another challenge', { challenge: b64(randomBytes(32)) }, /another request/],
    ['from inside another site (crossOrigin)', { crossOrigin: true }, /inside another site/],
  ];
  for (const [what, tweak, why] of badRegistrations) {
    test(`refused (400): ${what}; the challenge is spent`, async () => {
      const b = await beginRegister();
      const r = await main('/auth/passkey/register', { method: 'POST', body: KEY1.register(b, { rpId: TAILNET, ...tweak }) });
      is(r, 400, what);
      assert.match(r.json.error, why, 'refused for that reason');
      is(await main('/auth/passkey/register', { method: 'POST', body: KEY1.register(b, { rpId: TAILNET }) }), 409, 'the same challenge again');
      assert.deepEqual(await passkeyList(), []);
    });
  }

  test('refused: an unknown or missing challenge (409), garbage (400)', async () => {
    const b = await beginRegister();
    is(await main('/auth/passkey/register', { method: 'POST', body: KEY1.register({ ...b, challengeId: 'a'.repeat(18) }, { rpId: TAILNET }) }), 409, 'unknown challengeId');
    is(await main('/auth/passkey/register', { method: 'POST', body: { ...KEY1.register(b, { rpId: TAILNET }), challengeId: undefined } }), 409, 'no challengeId');
    const b2 = await beginRegister();
    is(await main('/auth/passkey/register', { method: 'POST', body: { challengeId: b2.challengeId, clientDataJSON: 'not base64!', attestationObject: '' } }), 400, 'garbage');
    assert.deepEqual(await passkeyList(), []);
  });

  test('a good one is kept: listed, counted, saved privately without secrets, audited', async () => {
    const b = await beginRegister();
    const r = await main('/auth/passkey/register', { method: 'POST', body: KEY1.register(b, { rpId: TAILNET, name: 'Touch ID on my Mac' }) });
    is(r, 201);
    assert.deepEqual(r.json, { id: KEY1.id, name: 'Touch ID on my Mac', domain: TAILNET });
    const list = await passkeyList();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, KEY1.id);
    assert.equal(list[0].domain, TAILNET);
    assert.equal((await main('/bootstrap')).json.passkeys, 1);
    const file = join(T.fleet.stateDir, 'passkeys.json');
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const saved = JSON.parse(readFileSync(file, 'utf8')).keys;
    assert.equal(saved.length, 1);
    assert.equal(saved[0].jwk.d, undefined, 'only the public key');
    assert.ok(auditLines().some(l => l.action === 'passkey-added' && l.via === 'page' && l.args?.domain === TAILNET), 'audit line');
    // Its challenge again (another key, confirmed by this one, since a passkey now exists): spent.
    is(await confirmed(main, 'POST', '/auth/passkey/register', STRANGER.register(b, { rpId: TAILNET })), 409, 'its challenge again');
    assert.equal((await passkeyList()).length, 1);
  });
});

/* ───────── changes need the passkey ───────── */
// [method, path, body] for the changes that need a passkey once one exists.
const gated = (agent, settings, reg) => [['POST', '/agents', { name: agentName() }], ['PUT', `/agents/${agent}`, { act: true }],
  ['PUT', '/agents/settings', { halted: false }], ['PUT', '/agents/settings', { selfHeal: !settings.selfHeal }],
  ['PUT', '/agents/settings', { halted: true, selfHeal: settings.selfHeal }], ['PUT', '/agents/settings', {}],
  ['POST', '/deploy', { allowRemoteCode: true }], ['POST', '/deploy/cluster', { allowRemoteCode: true }],
  ['DELETE', `/auth/passkeys/${KEY1.id}`], ['POST', '/auth/passkey/register', reg]];

describe('once a passkey is set up, changes to who has access need it', () => {
  let agent;
  before(async () => { agent = await newAgent(); });

  test('at the main address, without X-Spark-Passkey → 428 confirm, and nothing changes', async () => {
    const before = await agentIds(), settings = await agentSettingsNow();
    for (const [method, path, body] of gated(agent, settings, KEY2.register(await beginRegister(), { rpId: MAIN_HOST }))) {
      const r = await main(path, { method, body });
      is(r, 428, `${method} ${path} ${JSON.stringify(body ?? '').slice(0, 80)}`);
      assert.equal(r.json?.passkey, 'confirm', r.text);
    }
    assert.deepEqual(await agentIds(), before);
    assert.deepEqual(await agentSettingsNow(), settings);
    assert.equal((await passkeyList()).length, 1);
    assert.equal(await canAct(agent), false);
  });

  test('the old relay\'s X-Spark-Passkey-Approved counts for nothing (428), and its routes are gone (404)', async () => {
    const b = await beginConfirm(main, 'PUT', `/agents/${agent}`, { act: true });
    is(await main(`/agents/${agent}`, { method: 'PUT', body: { act: true }, headers: { 'x-spark-passkey-approved': b.challengeId } }), 428, 'X-Spark-Passkey-Approved');
    for (const [method, path] of RELAY(b.challengeId)) is(await main(path, { method, ...(method === 'POST' ? { body: KEY1.sign(b) } : {}) }), 404, `${method} ${path}`);
    assert.equal(await canAct(agent), false);
  });

  test('with a valid confirmation it goes through (audited, lastUsedAt)', async () => {
    const before = await agentIds();
    const r = await confirmed(main, 'POST', '/agents', { name: agentName() });
    is(r, 201);
    const line = auditLines().findLast(l => l.action === 'passkey-confirmed');
    assert.deepEqual([line.via, line.args?.path], ['page', '/agents']);
    assert.ok((await passkeyList())[0].lastUsedAt, 'lastUsedAt');
    assert.deepEqual(await agentIds(), [...before, r.json.id].sort());
  });

  test('the same confirmation replayed → 409, for the identical request or another', async () => {
    const body = { name: agentName() };
    const r = await confirmed(main, 'POST', '/agents', body);
    is(r, 201);
    // The duplicate name would be refused anyway, so remove it first: the replay has to fail on the passkey.
    is(await main(`/agents/${r.json.id}`, { method: 'DELETE' }), 200);
    const before = await agentIds();
    const replay = await main('/agents', { method: 'POST', body, headers: { 'x-spark-passkey': r.header } });
    is(replay, 409, 'identical');
    assert.match(replay.json.error, /passkey/i);
    is(await main('/agents', { method: 'POST', body: { name: agentName() }, headers: { 'x-spark-passkey': r.header } }), 409, 'another name');
    is(await main(`/agents/${agent}`, { method: 'PUT', body: { act: true }, headers: { 'x-spark-passkey': r.header } }), 409, 'another change');
    assert.deepEqual(await agentIds(), before);
  });

  test('a confirmation is for exactly one change (method, path and body); a mismatch spends it', async () => {
    const other = await newAgent(), before = await agentIds();
    const swaps = [
      ['another body', ['POST', '/agents', { name: 'asked-for' }], ['POST', '/agents', { name: 'sent-instead' }]],
      ['another method', ['POST', `/agents/${other}`, { act: true }], ['PUT', `/agents/${other}`, { act: true }]],
      ['another agent', ['PUT', `/agents/${agent}`, { act: true }], ['PUT', `/agents/${other}`, { act: true }]],
      ['act false → true', ['PUT', `/agents/${agent}`, { act: false }], ['PUT', `/agents/${agent}`, { act: true }]],
      ['pausing → resuming', ['PUT', '/agents/settings', { halted: true }], ['PUT', '/agents/settings', { halted: false }]],
      ['another model running its own code', ['POST', '/deploy', { model: 'a/one', node: 'spark3', allowRemoteCode: true }], ['POST', '/deploy', { model: 'a/two', node: 'spark3', allowRemoteCode: true }]],
      ['another pair of Sparks running its own code', ['POST', '/deploy/cluster', { model: 'a/one', nodes: ['spark3', 'spark4'], allowRemoteCode: true }], ['POST', '/deploy/cluster', { model: 'a/one', nodes: ['spark2', 'spark4'], allowRemoteCode: true }]],
    ];
    // Pausing and declining need no answer at all, so there's nothing to replay for them.
    const free = (p, b) => (p === '/agents/settings' && b?.halted === true) || b?.decision === 'decline';
    for (const [what, [m1, p1, b1], [m2, p2, b2]] of swaps) {
      const b = await beginConfirm(main, m1, p1, b1), h = header(KEY1.sign(b));
      const r = await main(p2, { method: m2, body: b2, headers: { 'x-spark-passkey': h } });
      is(r, 409, what);
      // The asked-for change, with the same answer, is refused now too: it was spent.
      // (POST /agents/<id> is no route, so its original isn't sent again)
      if (!free(p1, b1) && what !== 'another method') is(await main(p1, { method: m1, body: b1, headers: { 'x-spark-passkey': h } }), 409, `${what}: the original after the mismatch`);
    }
    assert.deepEqual(await agentIds(), before);
    assert.ok(!(await canAct(other)) && !(await canAct(agent)));
    assert.equal((await passkeyList()).length, 1);
  });

  test('the change can be named with or without /console/api', async () => {
    const b = await beginConfirm(main, 'PUT', `/console/api/agents/${agent}`, { act: true });
    const r = await main(`/agents/${agent}`, { method: 'PUT', body: { act: true }, headers: { 'x-spark-passkey': header(KEY1.sign(b)) } });
    is(r, 200);
    assert.ok(r.json.scopes.includes('fleet:act'));
    is(await confirmed(main, 'PUT', `/agents/${agent}`, { act: false }), 200);
  });

  const badAnswers = [
    ['another site\'s origin', { origin: 'https://evil.example' }, /own addresses/],
    ['the main host without its port', { origin: `https://${MAIN_HOST}` }, /own addresses/],
    ['another allowed domain than the passkey\'s', { rpId: MAIN_HOST }, /another site/],
    ['another site\'s domain', { rpId: 'evil.example' }, /another site/],
    ['a tampered signature', { tamper: true }, /signature/],
    ['a passkey that was never set up', { auth: STRANGER }, /isn’t one of/],
    ['another key claiming the passkey\'s id', { auth: STRANGER, id: KEY1.id }, /signature/],
    ['no user verification (UV)', { flags: UP }, /check it’s you/],
    ['no user presence (UP)', { flags: UV }, /check it’s you/],
    ['a registration answer, not a sign-in', { type: 'webauthn.create' }, /Wrong kind/],
    ['another challenge signed', { challenge: b64(randomBytes(32)) }, /another request/],
    ['from inside another site (crossOrigin)', { crossOrigin: true }, /inside another site/],
  ];
  for (const [what, { auth = KEY1, ...answer }, why] of badAnswers) {
    test(`refused (403): ${what}; nothing changes and the challenge is spent`, async () => {
      const before = await agentIds(), body = { name: agentName() };
      const b = await beginConfirm(main, 'POST', '/agents', body);
      const r = await main('/agents', { method: 'POST', body, headers: { 'x-spark-passkey': header(auth.sign(b, answer)) } });
      is(r, 403, what);
      assert.match(r.json.error, why, 'refused for that reason');
      assert.deepEqual(await agentIds(), before);
      is(await main('/agents', { method: 'POST', body, headers: { 'x-spark-passkey': header(KEY1.sign(b)) } }), 409, 'a good answer to the spent challenge');
      assert.deepEqual(await agentIds(), before);
    });
  }

  test('an unreadable header → 400; an unknown or missing challenge → 409; a set-up challenge can\'t confirm → 409', async () => {
    const before = await agentIds(), body = { name: agentName() };
    is(await main('/agents', { method: 'POST', body, headers: { 'x-spark-passkey': 'not json at all' } }), 400, 'garbage');
    is(await main('/agents', { method: 'POST', body, headers: { 'x-spark-passkey': header({}) } }), 409, 'no challengeId');
    is(await main('/agents', { method: 'POST', body, headers: { 'x-spark-passkey': header(KEY1.sign({ challengeId: 'b'.repeat(18), challenge: b64(randomBytes(32)) })) } }), 409, 'unknown challengeId');
    const reg = await beginRegister();
    is(await main('/agents', { method: 'POST', body, headers: { 'x-spark-passkey': header(KEY1.sign(reg)) } }), 409, 'a register challenge');
    assert.deepEqual(await agentIds(), before);
  });

  test('a challenge is good for 3 minutes, not longer', { timeout: 30000 * SLOW }, async () => {
    try {
      const body = { name: agentName() };
      let b = await beginConfirm(main, 'POST', '/agents', body);
      await setClock(170000);
      is(await main('/agents', { method: 'POST', body, headers: { 'x-spark-passkey': header(KEY1.sign(b)) } }), 201, 'after 2 min 50 s');
      await setClock(0);
      const before = await agentIds(), body2 = { name: agentName() };
      b = await beginConfirm(main, 'POST', '/agents', body2);
      await setClock(3 * 60000 + 2000);
      is(await main('/agents', { method: 'POST', body: body2, headers: { 'x-spark-passkey': header(KEY1.sign(b)) } }), 409, 'after 3 min 2 s');
      assert.deepEqual(await agentIds(), before);
      // A set-up challenge too.
      await setClock(0);
      const reg = await beginRegister();
      await setClock(3 * 60000 + 2000);
      is(await confirmed(main, 'POST', '/auth/passkey/register', KEY2.register(reg, { rpId: MAIN_HOST })), 409, 'registering after 3 min 2 s');
      assert.equal((await passkeyList()).length, 1);
    } finally { await setClock(0); }
  });

  test('pausing agents needs no passkey; resuming does', async () => {
    const p = await main('/agents/settings', { method: 'PUT', body: { halted: true } });
    is(p, 200, 'pause');
    assert.equal(p.json.settings.halted, true);
    const r = await main('/agents/settings', { method: 'PUT', body: { halted: false } });
    is(r, 428, 'resume without a passkey');
    assert.equal((await agentSettingsNow()).halted, true);
    const ok = await confirmed(main, 'PUT', '/agents/settings', { halted: false });
    is(ok, 200, 'resume confirmed');
    assert.equal(ok.summary, 'Resume agents’ changes');
    assert.equal(ok.json.settings.halted, false);
  });

  test('an automatic pause (agents paused themselves) is resumed with exactly {halted: false} and no passkey', async () => {
    const file = join(T.fleet.stateDir, 'agent-settings.json'), was = readFileSync(file, 'utf8');
    const autoPause = () => writeFileSync(file, JSON.stringify({ ...JSON.parse(was), halted: true, autoPaused: true }), { mode: 0o600 });
    try {
      autoPause();
      is(await main('/agents/settings', { method: 'PUT', body: { halted: false, selfHeal: true } }), 428, 'anything more than resuming');
      const r = await main('/agents/settings', { method: 'PUT', body: { halted: false } });
      is(r, 200, 'resuming');
      assert.equal(r.json.settings.halted, false);
      assert.equal(r.json.settings.autoPaused, false, 'no longer automatic');
      // The owner pausing makes it theirs: resuming needs the passkey again.
      autoPause();
      is(await main('/agents/settings', { method: 'PUT', body: { halted: true } }), 200, 'the owner pauses too');
      assert.equal((await agentSettingsNow()).autoPaused, false);
      is(await main('/agents/settings', { method: 'PUT', body: { halted: false } }), 428, 'resuming the owner\'s pause');
    } finally { is(await confirmed(main, 'PUT', '/agents/settings', { halted: false }), 200); }
  });

  test('removing an agent needs no passkey', async () => {
    const id = await newAgent();
    is(await main(`/agents/${id}`, { method: 'DELETE' }), 200, 'removing an agent');
    assert.ok(!(await agentIds()).includes(id));
  });

  test('a model running its own code needs the passkey (/deploy and /deploy/cluster with allowRemoteCode: true); nothing else about deploys does', async () => {
    for (const path of ['/deploy', '/deploy/cluster']) {
      const r = await main(path, { method: 'POST', body: { allowRemoteCode: true } });
      is(r, 428, `POST ${path} {allowRemoteCode: true}`);
      assert.equal(r.json.passkey, 'confirm');
      // Confirmed, it gets to the deploy itself (which wants a model and Sparks).
      is(await confirmed(main, 'POST', path, { allowRemoteCode: true }), 400, `POST ${path} confirmed`);
      for (const body of [{}, { allowRemoteCode: false }, { allowRemoteCode: 'true' }, { allowRemoteCode: 1 }, { model: 'a/one', nodes: ['spark3', 'spark4'] }]) {
        is(await main(path, { method: 'POST', body }), 400, `POST ${path} ${JSON.stringify(body)} (no passkey asked)`);
      }
    }
  });

  test('deleting a chat needs the passkey too, and the dialog names it', async () => {
    const chat = (await main('/chats', { method: 'POST', body: {} })).json.id;
    const asked = await main(`/chats/${chat}`, { method: 'DELETE' });
    is(asked, 428, 'DELETE /chats/<id>');
    const begin = await main('/auth/passkey/begin', { method: 'POST', body: { purpose: 'confirm', method: 'DELETE', path: `/chats/${chat}`, body: {} } });
    is(begin, 200, 'begin');
    assert.match(begin.json.summary, /^Delete the chat “/);
  });

  test('reads, Sparkie, stopping and ordinary deploys never ask for a passkey', async () => {
    for (const p of ['/agents', '/auth/passkeys', '/actions', '/connections', '/bootstrap']) is(await main(p), 200, `GET ${p}`);
    for (const [path, body] of [['/stop', {}], ['/deploy', {}], ['/deploy/cluster', {}]]) {
      const r = await main(path, { method: 'POST', body });
      assert.notEqual(r.status, 428, `POST ${path} → ${r.status} ${r.text}`);
      assert.ok(r.status >= 400 && r.status < 500, `POST ${path} with nothing in it → ${r.status} ${r.text}`);
    }
  });

  test('each change is described in plain words', async () => {
    const name = (await main('/agents')).json.keys.find(k => k.id === agent).name;
    const cases = [
      [['POST', '/agents', { name: 'Claude on my Mac' }], 'Create a key for a new agent, “Claude on my Mac”'],
      [['PUT', `/agents/${agent}`, { act: true }], `Let ${name} start, stop and restart models`],
      [['PUT', `/agents/${agent}`, { act: false }], `Make ${name} look-only`],
      [['PUT', '/agents/settings', { halted: false }], 'Resume agents’ changes'],
      [['PUT', '/agents/settings', { halted: false, selfHeal: true }], 'Resume agents’ changes, turn on automatic restarts'],
      [['PUT', '/agents/settings', { selfHeal: false }], 'turn off automatic restarts'],
      [['DELETE', `/auth/passkeys/${KEY1.id}`], 'Remove the passkey “Touch ID on my Mac”'],
      [['POST', '/auth/passkey/register', { name: 'Phone' }], 'Add a new passkey, “Phone”'],
    ];
    for (const [[method, path, body], want] of cases) assert.equal((await beginConfirm(main, method, path, body)).summary, want, `${method} ${path}`);
    // A name can't hide or reorder text in them (bidi, zero-width, newlines).
    assert.equal((await beginConfirm(main, 'POST', '/agents', { name: 'nice‮gnp.exe​\nagent' })).summary, 'Create a key for a new agent, “nice gnp.exe agent”');
  });

  test('a deploy names the model, the Spark(s), how it runs, what it stops, and that it runs its own code', async () => {
    const d = await beginConfirm(main, 'POST', '/deploy', { model: 'evil/remote-code-model', node: 'spark3', stop: [], allowRemoteCode: true });
    for (const want of [/evil\/remote-code-model/, /Spark 3/, /own code/]) assert.match(d.summary, want);
    assert.doesNotMatch(d.summary, /stopping/, 'nothing to stop');
    const c = await beginConfirm(main, 'POST', '/deploy/cluster', { model: 'big/two-spark-model', nodes: ['spark3', 'spark4'], setup: 'fast-tp2', stop: ['spark3/old-model', 'spark4/other'], allowRemoteCode: true });
    for (const want of [/big\/two-spark-model/, /Spark 3/, /Spark 4/, /fast-tp2/, /stopping spark3\/old-model, spark4\/other/, /own code/]) assert.match(c.summary, want);
    const v = await beginConfirm(main, 'POST', '/deploy', { model: 'm/again', node: 'spark4', verified: true, stop: [], allowRemoteCode: true });
    for (const want of [/m\/again/, /Spark 4/, /the way it ran before/, /own code/]) assert.match(v.summary, want);
  });
});

/* ───────── more passkeys, and removing them ───────── */
describe('more passkeys, and removing them', () => {
  test('adding a second passkey needs the first to confirm it', async () => {
    const b = await beginRegister();
    assert.deepEqual(b.exclude, [KEY1.id], 'the browser is told not to make a second for the same device');
    const body = KEY2.register(b, { rpId: MAIN_HOST, name: 'Phone' });
    const r = await main('/auth/passkey/register', { method: 'POST', body });
    is(r, 428, 'without confirming');
    assert.equal(r.json.passkey, 'confirm');
    assert.equal((await passkeyList()).length, 1);
    // The confirmation covers exactly this registration (the same set-up challenge, still unspent).
    const ok = await confirmed(main, 'POST', '/auth/passkey/register', body);
    is(ok, 201);
    assert.equal(ok.summary, 'Add a new passkey, “Phone”');
    assert.deepEqual(ok.json, { id: KEY2.id, name: 'Phone', domain: MAIN_HOST });
    assert.deepEqual((await passkeyList()).map(k => k.id).sort(), [KEY1.id, KEY2.id].sort());
  });

  test('a confirmation for one registration can\'t add another passkey', async () => {
    const b1 = await beginRegister(), b2 = await beginRegister();
    const wanted = KEY3.register(b1, { rpId: TAILNET }), sneaked = STRANGER.register(b2, { rpId: TAILNET });
    const c = await beginConfirm(main, 'POST', '/auth/passkey/register', wanted);
    is(await main('/auth/passkey/register', { method: 'POST', body: sneaked, headers: { 'x-spark-passkey': header(KEY1.sign(c)) } }), 409);
    assert.equal((await passkeyList()).length, 2);
  });

  test('the same passkey can\'t be set up twice', async () => {
    const r = await confirmed(main, 'POST', '/auth/passkey/register', KEY1.register(await beginRegister(), { rpId: TAILNET }));
    is(r, 409);
    assert.equal((await passkeyList()).length, 2);
  });

  test('either passkey confirms', async () => {
    is(await confirmed(main, 'POST', '/agents', { name: agentName() }, { auth: KEY2, rpId: MAIN_HOST }), 201, 'the second');
    is(await confirmed(main, 'POST', '/agents', { name: agentName() }), 201, 'the first');
  });

  // On the second passkey, so the first keeps answering with a counter of 0 (as most passkeys do).
  const k2 = signCount => ({ auth: KEY2, rpId: MAIN_HOST, signCount });
  // A counter going backwards can mean a copy, but refusing it could lock the owner out with their only passkey:
  // it's noted (audit log and Activity) and the change goes through.
  const wentBack = () => auditLines().filter(l => l.action === 'passkey-counter-went-back').length;
  test('a counter that goes backwards is noted, not refused', async () => {
    const id = await newAgent(), before = wentBack();
    is(await confirmed(main, 'PUT', `/agents/${id}`, { act: false }, k2(5)), 200, 'counter 5');
    assert.equal(wentBack(), before, 'counting up: nothing noted');
    is(await confirmed(main, 'PUT', `/agents/${id}`, { act: false }, k2(5)), 200, 'counter 5 again');
    is(await confirmed(main, 'PUT', `/agents/${id}`, { act: false }, k2(4)), 200, 'counter 4');
    assert.equal(wentBack(), before + 2, 'both noted');
    is(await confirmed(main, 'PUT', `/agents/${id}`, { act: false }, k2(6)), 200, 'counter 6');
    assert.equal(wentBack(), before + 2, 'counting up again: nothing new');
  });

  test('a counter that drops back to 0 after counting is noted', async () => {
    const id = await newAgent(), before = wentBack();
    is(await confirmed(main, 'PUT', `/agents/${id}`, { act: false }, k2(9)), 200, 'counter 9');
    is(await confirmed(main, 'PUT', `/agents/${id}`, { act: false }, k2(0)), 200, 'counter 0 after 9');
    is(await confirmed(main, 'PUT', `/agents/${id}`, { act: false }, k2(9)), 200, 'counter 9 after 0 counts up');
    assert.equal(wentBack(), before + 1);
    assert.ok(eventLines().some(e => e.type === 'notice' && /lower count than before/.test(e.text)), 'shown in Activity');
    // A passkey that never counted (KEY1, always 0) is fine, and isn't noted.
    is(await confirmed(main, 'PUT', `/agents/${id}`, { act: false }), 200, 'the first passkey at 0');
    assert.equal(wentBack(), before + 1);
  });

  test('an RSA passkey (RS256, 2048 bits, e = 65537) can be set up and confirms', async () => {
    const r = await confirmed(main, 'POST', '/auth/passkey/register', RSA_KEY.register(await beginRegister(), { rpId: MAIN_HOST, name: 'Security key' }));
    is(r, 201);
    is(await confirmed(main, 'POST', '/agents', { name: agentName() }, { auth: RSA_KEY, rpId: MAIN_HOST }), 201, 'it confirms');
    is(await confirmed(main, 'POST', '/agents', { name: agentName() }, { auth: RSA_KEY, rpId: MAIN_HOST, tamper: true }), 403, 'a tampered RSA signature');
    is(await confirmed(main, 'DELETE', `/auth/passkeys/${RSA_KEY.id}`), 200, 'removed again');
  });

  const rsaKey = (bits, e = 65537) => generateKeyPairSync('rsa', { modulusLength: bits, publicExponent: e }).publicKey.export({ format: 'jwk' });
  const badRsa = [
    ['exponent 3', () => { const k = rsaKey(2048, 3); return rsaCose(raw(k.n), raw(k.e)); }],
    ['1024 bits', () => { const k = rsaKey(1024); return rsaCose(raw(k.n), raw(k.e)); }],
    ['a 520-byte modulus', () => rsaCose(Buffer.concat([Buffer.from([0xc1]), randomBytes(519)]), Buffer.from([1, 0, 1]))],
    ['65537 written with a leading zero byte', () => { const k = rsaKey(2048); return rsaCose(raw(k.n), Buffer.from([0, 1, 0, 1])); }],
  ];
  for (const [what, cose] of badRsa) {
    test(`an RSA passkey with ${what} is refused (400)`, async () => {
      const auth = new Authenticator(MAIN_HOST);
      const r = await confirmed(main, 'POST', '/auth/passkey/register', auth.register(await beginRegister(), { rpId: MAIN_HOST, cose: cose() }));
      is(r, 400, what);
      assert.match(r.json.error, /Bad RSA key/);
      assert.ok(!(await passkeyList()).some(k => k.id === auth.id));
    });
  }

  test('an RSA passkey whose 1024-bit modulus is padded with zero bytes to 256 is refused (400)', async () => {
    const auth = new Authenticator(MAIN_HOST), k = rsaKey(1024);
    try {
      const cose = rsaCose(Buffer.concat([Buffer.alloc(128), raw(k.n)]), raw(k.e));
      is(await confirmed(main, 'POST', '/auth/passkey/register', auth.register(await beginRegister(), { rpId: MAIN_HOST, cose })), 400, 'a padded 1024-bit key');
    } finally {
      if ((await passkeyList()).some(x => x.id === auth.id)) await confirmed(main, 'DELETE', `/auth/passkeys/${auth.id}`);
    }
  });

  test('removing a passkey needs a confirmation; after that it confirms nothing, and pending set-ups are dropped', async () => {
    const pendingSetUp = await beginRegister();
    const r = await main(`/auth/passkeys/${KEY2.id}`, { method: 'DELETE' });
    is(r, 428);
    assert.equal(r.json.passkey, 'confirm');
    assert.equal((await passkeyList()).length, 2);
    const gone = await confirmed(main, 'DELETE', `/auth/passkeys/${KEY2.id}`);
    is(gone, 200);
    assert.equal(gone.summary, 'Remove the passkey “Phone”');
    assert.deepEqual((await passkeyList()).map(k => k.id), [KEY1.id]);
    assert.ok(auditLines().some(l => l.action === 'passkey-removed' && l.args?.name === 'Phone'), 'audit line');
    is(await confirmed(main, 'POST', '/agents', { name: agentName() }, { auth: KEY2, rpId: MAIN_HOST }), 403, 'the removed passkey');
    is(await confirmed(main, 'DELETE', `/auth/passkeys/${KEY2.id}`), 404, 'removing it again');
    // A set-up challenge from before the removal is gone (no setting up a key while one is being taken away).
    is(await confirmed(main, 'POST', '/auth/passkey/register', STRANGER.register(pendingSetUp, { rpId: TAILNET })), 409, 'a set-up begun before the removal');
    assert.deepEqual((await passkeyList()).map(k => k.id), [KEY1.id]);
  });
});

/* ───────── one pool of challenges ───────── */
describe('pending challenges', () => {
  test('one pool of 150: when it\'s full the oldest makes way, so a new one always gets through', { timeout: 60000 * SLOW }, async () => {
    const agent = await newAgent(), change = ['PUT', `/agents/${agent}`, { act: false }];
    const send = b => main(change[1], { method: change[0], body: change[2], headers: { 'x-spark-passkey': header(KEY1.sign(b)) } });
    try {
      await forgetChallenges(); // (leaves the one it made)
      const oldest = await beginConfirm(main, ...change);
      const rest = [];
      for (let i = 0; i < 150; i++) rest.push(i % 4 ? await beginConfirm(main, ...change) : await beginRegister());
      is(await send(oldest), 409, 'the oldest made way for the 150th after it');
      is(await send(rest[1]), 200, 'the next oldest is still there');
      is(await send(rest[149]), 200, 'and the newest');
      is(await send(rest[75]), 200, 'and one in the middle');
    } finally { await forgetChallenges(); }
  });
});

/* ───────── request sizes ───────── */
describe('request sizes: the passkey check reads each body with its route\'s limit', () => {
  const pad = n => 'x'.repeat(n);
  test('POST /agents: up to 4000 bytes, and nothing is made', async () => {
    const before = await agentIds();
    const r = await main('/agents', { method: 'POST', body: { name: agentName(), pad: pad(50000) } });
    is(r, 413, '50 KB');
    assert.match(r.json?.error || '', /too large/i);
    is(await main('/agents', { method: 'POST', body: { name: agentName(), pad: pad(4100) } }), 413, 'just over 4000 bytes');
    is(await main('/agents', { method: 'POST', body: { name: agentName(), pad: pad(3800) } }), 428, 'under 4000 bytes it gets to the passkey');
    assert.deepEqual(await agentIds(), before);
  });

  test('/auth: up to 50 000 bytes', async () => {
    is(await main('/auth/passkey/begin', { method: 'POST', body: { purpose: 'confirm', method: 'POST', path: '/access', body: { pad: pad(45000) } } }), 200, '45 KB');
    is(await main('/auth/passkey/begin', { method: 'POST', body: { purpose: 'confirm', method: 'POST', path: '/access', body: { pad: pad(55000) } } }), 413, '55 KB');
    is(await main('/auth/passkey/register', { method: 'POST', body: { pad: pad(55000) } }), 413, 'a 55 KB registration');
  });

  test('everything else that may need a passkey (/deploy): up to 100 000 bytes', async () => {
    is(await main('/deploy', { method: 'POST', body: { allowRemoteCode: false, pad: pad(90000) } }), 400, 'POST /deploy, 90 KB');
    is(await main('/deploy', { method: 'POST', body: { allowRemoteCode: true, pad: pad(110000) } }), 413, 'POST /deploy, 110 KB');
  });
});

/* ───────── an unreadable passkeys.json ───────── */
describe('an unreadable passkeys.json', () => {
  const file = () => join(T.fleet.stateDir, 'passkeys.json');
  let saved, agent, other, pending, settings;
  before(async () => {
    agent = await newAgent();
    other = await newAgent();
    // An answer made while the file was fine: it must not get through while it's broken.
    pending = { path: `/agents/${agent}`, body: { act: true } };
    pending.header = header(KEY1.sign(await beginConfirm(main, 'PUT', pending.path, pending.body)));
    settings = await agentSettingsNow();
    saved = readFileSync(file(), 'utf8');
    writeFileSync(file(), '{"keys": [ broken', { mode: 0o600 });
  });
  after(() => { if (saved) writeFileSync(file(), saved, { mode: 0o600 }); });

  test('changes that need a passkey are refused (500 naming the file; nothing goes through)', async () => {
    const before = await agentIds();
    const r = await main(pending.path, { method: 'PUT', body: pending.body, headers: { 'x-spark-passkey': pending.header } });
    is(r, 500, 'a valid answer');
    assert.match(r.json.error, /passkeys\.json/);
    for (const [method, path, body] of [['POST', '/agents', { name: agentName() }], ['PUT', `/agents/${agent}`, { act: true }],
      ['PUT', '/agents/settings', { halted: false }],
      ['POST', '/deploy', { allowRemoteCode: true }], ['POST', '/deploy/cluster', { allowRemoteCode: true }], ['DELETE', `/auth/passkeys/${KEY1.id}`], ['POST', '/auth/passkey/register', { challengeId: 'x' }]]) {
      const x = await main(path, { method, body });
      is(x, 500, `${method} ${path}`);
      assert.match(x.json.error, /passkeys\.json/);
    }
    is(await main('/auth/passkeys'), 500, 'GET /auth/passkeys');
    for (const purpose of ['confirm', 'register']) is(await main('/auth/passkey/begin', { method: 'POST', body: { purpose, method: 'POST', path: '/agents', body: {} } }), 500, `begin ${purpose}`);
    assert.deepEqual(await agentIds(), before);
    assert.deepEqual(await agentSettingsNow(), settings);
    assert.equal(await canAct(agent), false);
    assert.equal(readFileSync(file(), 'utf8'), '{"keys": [ broken', 'the file is left for the owner to fix');
  });

  test('/bootstrap still answers, with passkeys: -1', async () => {
    const r = await main('/bootstrap');
    is(r, 200);
    assert.equal(r.json.passkeys, -1);
  });

  test('taking a right away still works: pausing agents, removing an agent', async () => {
    const p = await main('/agents/settings', { method: 'PUT', body: { halted: true } });
    is(p, 200, 'pause');
    assert.equal(p.json.settings.halted, true);
    is(await main(`/agents/${other}`, { method: 'DELETE' }), 200, 'remove an agent');
    is(await main('/agents/settings', { method: 'PUT', body: { halted: false } }), 500, 'resuming still can\'t');
  });

  test('once the file is fixed, confirmed changes work again (an answer made before it broke, too)', async () => {
    writeFileSync(file(), saved, { mode: 0o600 });
    if ((await agentSettingsNow()).halted) is(await confirmed(main, 'PUT', '/agents/settings', { halted: false }), 200, 'resume');
    is(await confirmed(main, 'POST', '/agents', { name: agentName() }), 201);
    is(await main(pending.path, { method: 'PUT', body: pending.body, headers: { 'x-spark-passkey': pending.header } }), 200, 'the answer made before the file broke');
    assert.equal(await canAct(agent), true);
    assert.equal((await main('/bootstrap')).json.passkeys, 1);
  });
});
