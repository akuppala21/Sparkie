// Covers: The needs-me line on Telegram (H5, R32): off by default; switching on needs the owner, the page and the
// passkey, off needs none; one fixed line when something new is on the open-problems list, through `tell()`, with no
// brain turn; not repeated while it stays or when it goes and comes back; at most 3 a day; disconnecting removes the
// switch.
//
// The needs-me line on Telegram (H5; R32; the owner's decision 6, 2026-11-11). Off until the owner switches it on with
// the passkey; then one fixed line ("Spark Console: N things need you. Send /status to see them.") when something new
// joins the open-problems list (20-needs.mjs) and stays there (5 minutes for real, SETTLE here), not repeated while it
// stays or when it goes and comes back, at most 3 a day, through tell() only, with no brain turn. Off never needs the
// passkey, and disconnecting removes the switch. Open problems are made here with models on the should-run list whose
// containers aren't there (each one is held), and with Docker on Spark 3 missing a look of the watcher (3 s apart here).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { T, MEMBER, useFleet, api, sleep, waitFor, auditLines, createKey, call, SLOW } from './lib.mjs';
import { serviceConfig } from './start-mock.mjs';
import { Authenticator, passkeyHeader } from './authenticator.mjs';

const MAIN_ORIGIN = serviceConfig().origin, TAILNET = new URL(MAIN_ORIGIN).hostname.split('.').slice(1).join('.');
const KEY = new Authenticator(TAILNET, MAIN_ORIGIN);
const TOKEN = '123456789:AAEtestTokenForSparkConsoleXYZ_abcdefghij', OWNER_TG = 5550001;
let look;
// How long a problem stays open before it counts as new (more than a look of the watcher, so a missed look never does).
const SETTLE = 8000 * SLOW;
useFleet({ telegram: true, knowledge: true, watchMs: 3000, env: { SPARK_CONSOLE_NEEDS_MS: '400', SPARK_CONSOLE_DESIRED_MS: '800', SPARK_CONSOLE_NEEDS_SETTLE_MS: String(SETTLE) },
  prepare: ({ dir, stateDir }) => {
    // Already paired (as after the owner did it on the passkey page).
    mkdirSync(join(dir, 'secrets'), { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, 'secrets', 'secrets.json'), JSON.stringify({ telegram: { token: TOKEN, bot: 'spark_test_bot', chatId: OWNER_TG, userId: OWNER_TG, name: 'Owner' } }), { mode: 0o600 });
    // (an empty should-run list, so the service doesn't seed one from what runs)
    writeFileSync(join(stateDir, 'desired.json'), JSON.stringify({ revision: 1, running: [], revisions: [] }), { mode: 0o600 });
  } }, async () => { look = (await createKey('needs-me')).token; });

const is = (r, status, what = '') => assert.equal(r.status, status, `${what} → ${r.status} ${r.text}`);
async function confirmed(method, path, body) {
  const b = await api('/auth/passkey/begin', { method: 'POST', body: { purpose: 'confirm', method, path, body } });
  is(b, 200, `begin confirm ${method} ${path}`);
  return api(path, { method, body, headers: { 'x-spark-passkey': passkeyHeader(KEY.sign(b.json)) } });
}
const tgUrl = p => `http://127.0.0.1:${T.fleet.telegramPort}${p}`;
const tgPost = async (p, body) => (await fetch(tgUrl(p), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const tgCalls = () => { const f = join(T.fleet.dir, 'telegram-calls.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []; };
const tgSent = (from = 0) => tgCalls().slice(from).filter(c => c.method === 'sendMessage');
const needsSent = () => tgSent().filter(c => /^Spark Console: \d+ things? needs? you\./.test(c.body.text));
const needs = async () => (await api('/actions/fleet_status', { method: 'POST', body: {} })).json.needsOwner;
const mock = (spark, file) => join(T.fleet.root, spark, '.mock', file);
let msgId = 1;
const tgSay = text => tgPost('/__push', { message: { message_id: msgId++, date: Math.floor(Date.now() / 1000), chat: { id: OWNER_TG, type: 'private' }, from: { id: OWNER_TG, is_bot: false, first_name: 'Owner' }, text } });
const secrets = () => JSON.parse(readFileSync(T.fleet.secretsFile, 'utf8'));
// The should-run list holds these (models whose containers aren't on Spark 4): one open problem each.
function hold(names) {
  const at = '2026-11-10T00:00:00.000Z';
  writeFileSync(join(T.fleet.stateDir, 'desired.json'), JSON.stringify({ revision: 1, running: names.map(c => ({ spark: 'spark4', container: c, model: c.slice(3), since: at, by: 'test' })), revisions: [] }), { mode: 0o600 });
}
const listed = async () => (await api('/desired')).json.running;
// (held, and then past the settle time, so a line that was going to go has gone)
async function settled(names) {
  await waitFor(async () => { const r = await listed(); return r.length === names.length && r.every(x => x.state === 'held'); }, { timeout: 30000, what: `held: ${names}` });
  await sleep(3000 * SLOW + SETTLE);
}

describe('the needs-me line', { concurrency: 1 }, () => {
  test('switching it on needs the owner, the page and the passkey; it is off to begin with', { timeout: 60000 * SLOW }, async () => {
    await waitFor(async () => (await api('/telegram')).json.state === 'ok', { what: 'Telegram polling' });
    const b = await api('/auth/passkey/begin', { method: 'POST', body: { purpose: 'register' } });
    is(await api('/auth/passkey/register', { method: 'POST', body: KEY.register(b.json) }), 201, 'the owner sets up a passkey');
    assert.equal((await api('/telegram')).json.needsMe, false);
    const on = { on: true };
    is(await api('/telegram/needs', { method: 'PUT', body: on, headers: { 'tailscale-funnel-request': '?1' } }), 401, 'from the internet, not signed in');
    is(await api('/telegram/needs', { method: 'PUT', body: on, headers: { 'x-spark-console': null } }), 403, 'cross-site');
    is(await api('/telegram/needs', { method: 'PUT', body: on }), 428, 'without the passkey');
    is(await api('/telegram/needs', { method: 'PUT', body: { on: 'yes' } }), 400);
    assert.equal(secrets().telegram.needsMe, undefined, 'nothing stored');
  });

  test('off: something on the list sends nothing', { timeout: 60000 * SLOW }, async () => {
    hold(['sc-needs-a']);
    await settled(['sc-needs-a']);
    assert.deepEqual(tgSent(), [], 'nothing was sent');
  });

  test('on: one fixed line once the problem has stayed open the settle time, through tell(), no brain turn; not repeated while it stays; /status lists it', { timeout: 90000 * SLOW }, async () => {
    const chats = (await api('/chats')).json.chats.length, t0 = Date.now();
    const r = await confirmed('PUT', '/telegram/needs', { on: true });
    is(r, 200);
    assert.equal(r.json.needsMe, true);
    assert.equal(secrets().telegram.needsMe, true, 'kept with the binding, in the secrets file');
    // (the Fleet group's review, 2026-11-13: a problem counts as new only once it has stayed open, here since the switch)
    await sleep(SETTLE / 2);
    assert.equal(needsSent().length, 0, 'nothing before the problem has stayed open the settle time');
    const [m] = await waitFor(() => { const s = needsSent(); return s.length ? s : null; }, { timeout: 30000, what: 'the needs-me line' });
    assert.ok(Date.now() - t0 >= SETTLE, `sent after ${Date.now() - t0} ms, not before ${SETTLE}`);
    assert.equal(m.body.chat_id, OWNER_TG);
    assert.equal(m.body.text, 'Spark Console: 1 thing needs you. Send /status to see it.');
    assert.equal(m.body.reply_markup, undefined);
    assert.ok(auditLines().some(l => l.action === 'telegram-send' && l.args?.why === 'needs'));
    assert.ok(auditLines().some(l => l.action === 'telegram-needs-me' && l.args?.on === true));
    assert.equal((await call(look, 'fleet_status', {})).value.needsOwner.length, 1);
    assert.equal((await api('/chats')).json.chats.length, chats, 'no chat, no brain turn');
    await sleep(3000 * SLOW);
    assert.equal(needsSent().length, 1, 'not repeated while it stays');
    // Where the line points: /status on Telegram lists it.
    const from = tgCalls().length;
    await tgSay('/status');
    const [st] = await waitFor(() => { const s = tgSent(from); return s.length ? s : null; }, { timeout: 30000, what: 'the /status answer' });
    assert.match(st.body.text, /^Sparkie: [^\n]+\nNeeds you:\n- Should be running but isn’t: sc-needs-a on Spark 4\./);
  });

  // The Fleet group's review (2026-11-13): Docker on Spark 3 missing one look of the watcher (a Docker restart) sent a
  // line, and used one of the 3 a day, for something that had put itself right by the next look.
  test('a problem that puts itself right within the settle time sends nothing: Docker on Spark 3 missing one look', { timeout: 120000 * SLOW }, async t => {
    const before = needsSent().length;
    writeFileSync(mock('spark3', 'stall'), '0');
    t.after(() => rmSync(mock('spark3', 'stall'), { force: true }));
    await waitFor(async () => (await needs()).some(l => /Docker isn’t answering on Spark 3/.test(l)), { timeout: 30000, every: 200, what: 'the look Docker missed' });
    rmSync(mock('spark3', 'stall'));
    await waitFor(async () => !(await needs()).some(l => /Docker/.test(l)), { timeout: 30000, every: 200, what: 'Docker answering again' });
    await sleep(2000 * SLOW);
    assert.equal(needsSent().length, before, 'nothing was sent');
  });

  test('gone and back within 6 hours: not told again', { timeout: 90000 * SLOW }, async () => {
    hold([]);
    await waitFor(async () => (await listed()).length === 0, { what: 'the list empty' });
    await sleep(2000 * SLOW);
    hold(['sc-needs-a']);
    await settled(['sc-needs-a']);
    assert.equal(needsSent().length, 1);
  });

  test('each new problem is told, with the count; at most 3 lines a day', { timeout: 120000 * SLOW }, async () => {
    hold(['sc-needs-a', 'sc-needs-b']);
    await waitFor(() => needsSent().length === 2, { timeout: 30000, what: 'the second line' });
    assert.equal(needsSent()[1].body.text, 'Spark Console: 2 things need you. Send /status to see them.');
    hold(['sc-needs-a', 'sc-needs-b', 'sc-needs-c']);
    await waitFor(() => needsSent().length === 3, { timeout: 30000, what: 'the third line' });
    hold(['sc-needs-a', 'sc-needs-b', 'sc-needs-c', 'sc-needs-d']);
    await settled(['sc-needs-a', 'sc-needs-b', 'sc-needs-c', 'sc-needs-d']);
    assert.equal(needsSent().length, 3, 'no fourth line today');
    const kept = readFileSync(join(T.fleet.stateDir, 'telegram.json'), 'utf8');
    assert.equal(JSON.parse(kept).needs.sent.length, 3, 'what went out is kept, so a restart repeats nothing');
    assert.ok(!kept.includes('needsMe'), 'the switch is not in the state folder');
  });

  test('off needs no passkey; disconnecting removes the switch', { timeout: 60000 * SLOW }, async () => {
    const off = await api('/telegram/needs', { method: 'PUT', body: { on: false } });
    is(off, 200, 'off, without the passkey');
    assert.equal(off.json.needsMe, false);
    assert.equal(secrets().telegram.needsMe, false);
    is(await confirmed('PUT', '/telegram/needs', { on: true }), 200);
    is(await api('/telegram', { method: 'DELETE' }), 200);
    assert.equal(secrets().telegram, undefined, 'the switch went with the binding');
    is(await api('/telegram/needs', { method: 'PUT', body: { on: false } }), 200, 'off still answers');
  });
});
