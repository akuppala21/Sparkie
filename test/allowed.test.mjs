// Covers: "Always allow" (A9b, R65; 21-ahead.mjs): no such answer until a passkey is set up; then a change's button
// on the page offers it, never the paired Telegram chat; its press (with the passkey) runs the command and keeps the kind
// in agent-settings.json; in a later request in another chat a command of that kind runs at once (its record says
// always:<id>) when the words ask for a change, while another kind, words that ask for none, or what came from a read
// are asked; /allowed lists the kinds, /allowed off takes one away; after a state put-back they wait for "Keep these".
//
// The stand-in fleet, with the real root helper set up and proven for Spark 3 (test/rehearsal.mjs, run: true), Telegram
// paired with approvals on, and the stand-in brain told by a script which tools to call. Linux only: run it on a Spark
// with tools/test-on-spark.sh. The tests run in order: the second sets up a passkey, after which every press needs it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { T, useFleet, api, newChat, say, choose, waitFor, sleep, SLOW } from './lib.mjs';
import { rehearse } from './rehearsal.mjs';
import { serviceConfig } from './start-mock.mjs';
import { Authenticator, passkeyHeader } from './authenticator.mjs';

const TOKEN = '123456789:AAEtestTokenForSparkConsoleXYZ_abcdefghij', OWNER_TG = 5550001;
const MAIN_ORIGIN = serviceConfig().origin, TAILNET = new URL(MAIN_ORIGIN).hostname.split('.').slice(1).join('.');
const KEY = new Authenticator(TAILNET, MAIN_ORIGIN);
useFleet({ telegram: true, env: { SPARK_CONSOLE_RUN_SECONDS: '6', SPARK_CONSOLE_ROUTE_MS: '1000', SPARK_CONSOLE_WIDE_MS: '1', SPARK_CONSOLE_TELEGRAM_LIMITS: '1000,1000,1000' },
  prepare: ({ root, dir }) => {
    rehearse(root, 'spark3', { run: true });
    const put = (p, data) => { mkdirSync(dirname(join(root, 'spark3', p)), { recursive: true }); writeFileSync(join(root, 'spark3', p), data); };
    put('notes/plan.txt', 'next: touch ~/notes/from.txt\n');
    mkdirSync(join(dir, 'secrets'), { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, 'secrets', 'secrets.json'), JSON.stringify({ telegram: { token: TOKEN, bot: 'spark_test_bot', chatId: OWNER_TG, userId: OWNER_TG, name: 'Owner', pairedAt: '2026-11-10T00:00:00.000Z', approve: true } }), { mode: 0o600 });
  } }, async () => {
  // (as the ladder's tests wait: two looks at the tailnet after a request give the console the Sparks' addresses)
  const file = join(T.fleet.dir, 'tailscale-calls'), looks = () => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(l => l === 'status --json').length : 0);
  await api('/telegram');
  const n = looks();
  await waitFor(() => looks() >= n + 2, { what: 'two looks at the tailnet after a request' });
  await sleep(300);
});

const at3 = p => join(T.fleet.root, 'spark3', p);
const lines = file => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const startOf = command => readdirSync(T.fleet.journalDir).filter(f => f.endsWith('.jsonl')).sort().flatMap(f => lines(join(T.fleet.journalDir, f)))
  .filter(x => x.k === 'cmd' && x.start && x.args?.command === command).at(-1);
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const noScript = () => rmSync(join(T.fleet.dir, 'model-script.json'), { force: true });
const RUN = command => ({ name: 'run', arguments: { on: 'spark3', command, dir: '~' } });
async function turn(chat, words, rounds) {
  script([{ match: `^${words}$`, rounds }]);
  try { const r = await say(chat, words); return { choices: r.message.choices || [], text: r.text }; } finally { noScript(); }
}
const asks = choices => [...new Set(choices.map(c => c.group))].map(g => choices.filter(c => c.group === g).map(c => c.label));
const TOUCH = '“touch” in ~/notes on Spark 3';
const GA = `Run it, and don’t ask again for this task: ${TOUCH}`, ALWAYS = `Always allow ${TOUCH} (on this page, with your passkey)`;
const allowed = () => JSON.parse(readFileSync(join(T.fleet.stateDir, 'agent-settings.json'), 'utf8')).allowed || [];
async function confirmed(method, path, body) {
  const b = await api('/auth/passkey/begin', { method: 'POST', body: { purpose: 'confirm', method, path, body } });
  assert.equal(b.status, 200, b.text);
  return api(path, { method, body, headers: { 'x-spark-passkey': passkeyHeader(KEY.sign(b.json)) } });
}
const press = (chat, id) => confirmed('POST', `/chats/${chat}/choose`, { choice: id });
const tgCalls = () => lines(join(T.fleet.dir, 'telegram-calls.jsonl'));

test('with no passkey set up, a change\'s button offers no "Always allow"', { timeout: 120000 * SLOW }, async () => {
  const r = await turn(await newChat(), 'fix my notes', [[RUN('touch notes/n1.txt')]]);
  assert.deepEqual(asks(r.choices), [['Run it', GA, 'No']]);
});

test('"Always allow" is the page\'s, with the passkey: not in the paired chat; its press runs it and keeps the kind; a later request runs that kind at once (always:<id>) when its words ask for a change; another kind, words that ask for none and what came from a read are asked', { timeout: 240000 * SLOW }, async () => {
  const b = await api('/auth/passkey/begin', { method: 'POST', body: { purpose: 'register' } });
  assert.equal((await api('/auth/passkey/register', { method: 'POST', body: KEY.register(b.json) })).status, 201, 'a passkey');
  await waitFor(async () => (await api('/telegram')).json.state === 'ok', { what: 'Telegram polling' });
  const chat = await newChat(), from = tgCalls().length, r = await turn(chat, 'fix my notes', [[RUN('touch notes/a1.txt')]]);
  assert.deepEqual(asks(r.choices), [['Run it', GA, ALWAYS, 'No']]);
  const always = r.choices.find(c => c.label === ALWAYS);
  const sent = await waitFor(() => tgCalls().slice(from).find(c => c.method === 'sendMessage' && c.body?.reply_markup), { what: 'the ask in the paired chat' });
  assert.ok(!JSON.stringify(sent.body).includes(always.id) && !sent.body.text.includes('Always allow'), JSON.stringify(sent.body));
  // (pressed without the passkey: refused, nothing run, nothing kept)
  const bare = await choose(chat, always.id);
  assert.equal(bare.status, 428, bare.text);
  assert.ok(!existsSync(at3('notes/a1.txt')), 'a press without the passkey ran nothing');
  assert.deepEqual(existsSync(join(T.fleet.stateDir, 'agent-settings.json')) ? allowed() : [], [], 'and kept nothing');
  const p = await press(chat, always.id);
  assert.equal(p.status, 200, p.text);
  assert.ok(existsSync(at3('notes/a1.txt')), 'the press ran it');
  assert.match(p.json.message.content, /\nFrom now on, “touch” in ~\/notes on Spark 3 runs without asking in your chats when your words ask for a change\. \/allowed lists it and takes it away\.$/);
  const [e] = allowed();
  assert.deepEqual([allowed().length, e.spark, e.program, e.under], [1, 'spark3', 'touch', '~/notes']);
  const r2 = await turn(await newChat(), 'fix my notes', [[RUN('touch notes/a2.txt')], [RUN('mkdir notes/a3')]]);
  assert.ok(existsSync(at3('notes/a2.txt')), 'run at once');
  assert.equal(startOf('touch notes/a2.txt')?.gate, `always:${e.id}`);
  assert.deepEqual(asks(r2.choices).map(a => a[0]), ['Run it'], 'the other kind is asked');
  assert.ok(!existsSync(at3('notes/a3')));
  const r4 = await turn(await newChat(), 'how are my notes', [[RUN('touch notes/a4.txt')]]);
  assert.ok(!existsSync(at3('notes/a4.txt')), 'words that ask for no change: asked');
  assert.deepEqual(asks(r4.choices).map(a => a[0]), ['Run it'], `a button came: ${JSON.stringify(r4.choices)}`);
  await turn(await newChat(), 'fix my notes', [[RUN('cat notes/plan.txt')], [RUN('touch ~/notes/from.txt')]]);
  assert.ok(!existsSync(at3('notes/from.txt')), 'what came from a read: asked');
});

test('/allowed lists the kinds; /allowed off takes one away, and that kind is asked again', { timeout: 120000 * SLOW }, async () => {
  const chat = await newChat();
  assert.match((await say(chat, '/allowed')).text, /\nAlways allowed in your chats \(1\):\n1\. “touch” in ~\/notes on Spark 3\n/);
  assert.match((await say(chat, '/allowed off 1')).text, /\nTaken away: “touch” in ~\/notes on Spark 3\. It is asked again\.$/);
  assert.deepEqual(allowed(), []);
  await turn(await newChat(), 'fix my notes', [[RUN('touch notes/a5.txt')]]);
  assert.ok(!existsSync(at3('notes/a5.txt')), 'asked again');
  assert.match((await say(chat, '/allowed')).text, /\nNothing is always allowed\./);
});

test('after a state put-back the kinds wait for "Keep these": asked meanwhile, listed with what came back, then at once again', { timeout: 180000 * SLOW }, async () => {
  const chat = await newChat(), r = await turn(chat, 'fix my notes', [[RUN('touch notes/b1.txt')]]);
  assert.equal((await press(chat, r.choices.find(c => c.label === ALWAYS).id)).status, 200);
  assert.equal(allowed().length, 1);
  // A state put back from a copy: the hold, as the start's look leaves it in the secrets file (22-putback.mjs).
  const f = join(T.fleet.dir, 'secrets', 'secrets.json'), s = JSON.parse(readFileSync(f, 'utf8'));
  writeFileSync(f, JSON.stringify({ ...s, auth: { ...(s.auth || {}), hold: { since: new Date().toISOString() } } }), { mode: 0o600 });
  await waitFor(async () => (await api('/auth/putback')).json.held, { what: 'the hold' });
  assert.deepEqual((await api('/auth/putback')).json.allowed, [TOUCH]);
  await turn(await newChat(), 'fix my notes', [[RUN('touch notes/b2.txt')]]);
  assert.ok(!existsSync(at3('notes/b2.txt')), 'held: asked');
  assert.match((await say(chat, '/allowed')).text, /\nHeld: Spark Console’s state was put back from a copy/);
  const k = await confirmed('POST', '/auth/putback/keep', {});
  assert.equal(k.status, 200, k.text);
  assert.equal(k.json.kept, true, k.text);
  await turn(await newChat(), 'fix my notes', [[RUN('touch notes/b3.txt')]]);
  assert.ok(existsSync(at3('notes/b3.txt')), 'kept: at once again');
});
