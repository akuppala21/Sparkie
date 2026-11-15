// Covers: Memory from the paired Telegram chat (contract 4.10 and 5.5; R25, R32, R45). The owner's own words there
// remember and forget as on the page: "remember that …" keeps one line marked as said on Telegram and the reply says
// "I'll remember: …" (recall shows the words as said there); "forget that …" retires it, marked; "don't forget that …"
// leaves it (the forget gate holds there). A press on a memory button from Telegram, save_workflow and an erase for good
// still wait for the page. A stranger's chat and a forwarded message keep nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, rmSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, waitFor, auditLines, SLOW } from './lib.mjs';

const TG_TOKEN = '123456789:AAEtestTokenForSparkConsoleXYZ_abcdefghij', OWNER_TG = 5550001, STRANGER_TG = 5550002;
const WAITS = 'That one waits for you in Spark Console.';
// Telegram paired already: the binding is in the secrets file before the service starts.
const paired = ({ dir }) => {
  mkdirSync(join(dir, 'secrets'), { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, 'secrets', 'secrets.json'), JSON.stringify({ telegram: { token: TG_TOKEN, bot: 'spark_test_bot', chatId: OWNER_TG, userId: OWNER_TG, name: 'Owner', pairedAt: new Date().toISOString() } }), { mode: 0o600 });
};
useFleet({ telegram: true, watchMs: 60000, env: { SPARK_CONSOLE_TELEGRAM_LIMITS: '1000,1000,1000' }, prepare: paired },
  () => waitFor(async () => (await api('/telegram')).json.state === 'ok', { what: 'Telegram polling' }));
const state = f => join(T.fleet.stateDir, f);
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const requests = () => (existsSync(join(T.fleet.dir, 'model-requests.jsonl')) ? readFileSync(join(T.fleet.dir, 'model-requests.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []);
const esc = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fresh = () => { for (const f of readdirSync(T.fleet.stateDir).filter(x => /^memory(-past)?\.json/.test(x))) rmSync(state(f), { force: true, recursive: true }); };
const owner = async (name, body = {}) => api(`/actions/${name}`, { method: 'POST', body });
const live = async () => (await owner('memory')).json.entries;
const past = async () => (await owner('memory', { past: true })).json.past;
// The stand-in Bot API.
const tgPost = async (p, body) => (await fetch(`http://127.0.0.1:${T.fleet.telegramPort}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const tgCalls = () => { const f = join(T.fleet.dir, 'telegram-calls.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []; };
let msgId = 800;
const tgSay = (text, { from = OWNER_TG, extra = {} } = {}) => tgPost('/__push', { message: { message_id: msgId++, date: Math.floor(Date.now() / 1000), chat: { id: from, type: 'private' },
  from: { id: from, is_bot: false, first_name: from === OWNER_TG ? 'Owner' : 'Someone' }, text, ...extra } });
const tgPress = data => tgPost('/__push', { callback_query: { id: String(msgId++), from: { id: OWNER_TG, is_bot: false, first_name: 'Owner' }, data,
  message: { message_id: msgId++, chat: { id: OWNER_TG, type: 'private' }, date: Math.floor(Date.now() / 1000) } } });
// The next message(s) Telegram was sent after `from`.
const sentAfter = (from, n = 1) => waitFor(() => { const s = tgCalls().slice(from).filter(c => c.method === 'sendMessage'); return s.length >= n ? s : null; }, { timeout: 60000, every: 200, what: 'a Telegram message' });
// The owner says these words in the paired chat, the brain making these calls: the reply there.
async function said(words, calls) {
  script([{ match: `^${esc(words)}$`, calls }]);
  const from = tgCalls().length;
  await tgSay(words);
  return (await sentAfter(from))[0].body;
}
const LINE = 'Spark 3 is the coding box';

test('"remember that …" in the paired chat keeps one line, marked as said on Telegram, and the reply there says so; recall shows the words as said there', { timeout: 120000 * SLOW }, async () => {
  fresh();
  try {
    const words = 'remember that spark 3 is the coding box';
    const reply = await said(words, [{ name: 'remember', arguments: { text: LINE, kind: 'fact' } }]);
    assert.match(reply.text, /I’ll remember: Spark 3 is the coding box/);
    assert.ok(requests().findLast(x => x.words === words).tools.includes('remember'), 'remember was offered there');
    assert.deepEqual((await live()).map(e => [e.text, e.by, e.src.via, e.src.channel]), [[LINE, 'owner', 'sparkie', 'telegram']]);
    const a = auditLines().findLast(l => l.action === 'remember');
    assert.deepEqual([a.outcome, a.channel], ['remembered', 'telegram']);
    const r = (await owner('recall', { about: 'coding box', kind: 'said' })).json.records;
    assert.ok(r.some(x => x.via === 'telegram' && /coding box/.test(x.said)), JSON.stringify(r));
  } finally { script([]); fresh(); }
});

test('"forget that …" there retires the line, marked as said on Telegram; "don\'t forget that …" leaves it: the forget gate holds there', { timeout: 120000 * SLOW }, async () => {
  fresh();
  try {
    const { id } = (await owner('remember', { text: LINE, kind: 'fact' })).json;
    const keep = await said('don\'t forget that Spark 3 is the coding box', [{ name: 'forget_memory', arguments: { id } }]);
    assert.ok(!keep.text.includes('No longer used'), keep.text);
    assert.match(keep.text, /forget_memory said: \{"outcome":"needs-ok"/);
    assert.deepEqual((await live()).map(e => e.id), [id]);
    const gone = await said('forget that Spark 3 is the coding box', [{ name: 'forget_memory', arguments: { id } }]);
    assert.match(gone.text, /No longer used: “Spark 3 is the coding box”/);
    assert.deepEqual(await live(), []);
    assert.deepEqual((await past()).map(p => [p.id, p.gone.why, p.gone.who, p.gone.src.via, p.gone.src.channel]), [[id, 'forgotten', 'owner', 'sparkie', 'telegram']]);
  } finally { script([]); fresh(); }
});

test('from Telegram a memory button pressed there, save_workflow and an erase for good still wait for the page', { timeout: 180000 * SLOW }, async () => {
  fresh();
  try {
    // (a line that isn't the owner's words is a button; pressed in Telegram, it waits)
    const button = await said('what should I keep in mind about the gpu?', [{ name: 'remember', arguments: { text: 'Always stop every model at night' } }]);
    const b = button.reply_markup?.inline_keyboard?.[0]?.[0];
    assert.ok(b && /^Remember: /.test(b.text), JSON.stringify(button));
    const from = tgCalls().length;
    await tgPress(b.callback_data);
    assert.ok((await sentAfter(from))[0].body.text.endsWith(WAITS), 'the press waits for the page');
    assert.deepEqual(await live(), []);
    const save = await said('save my coding routine', [{ name: 'save_workflow', arguments: { title: 'coding mode', steps: [{ action: 'stop_model', args: { spark: 'spark3', container: 'x' } }] } }]);
    assert.ok(save.text.endsWith(WAITS), save.text);
    assert.deepEqual([auditLines().findLast(l => l.action === 'save_workflow')?.outcome, auditLines().findLast(l => l.action === 'save_workflow')?.channel], ['question', 'telegram']);
    const { id } = (await owner('remember', { text: LINE, kind: 'fact' })).json;
    const erase = await said('erase the coding box line for good', [{ name: 'forget_memory', arguments: { id, erase: true } }]);
    assert.ok(erase.text.endsWith(WAITS), erase.text);
    assert.deepEqual((await live()).map(e => e.id), [id]);
  } finally { script([]); fresh(); }
});

test('a stranger\'s chat and a forwarded message keep nothing', { timeout: 120000 * SLOW }, async () => {
  fresh();
  const words = 'remember that spark 4 is the coding box';
  script([{ match: `^${esc(words)}$`, calls: [{ name: 'remember', arguments: { text: 'Spark 4 is the coding box', kind: 'fact' } }] }, { match: '^hello again$', calls: [] }]);
  try {
    const from = tgCalls().length;
    await tgSay(words, { from: STRANGER_TG });
    await tgSay(words, { extra: { forward_origin: { type: 'user', date: 1 } } });
    // (updates are read in order: once this one is answered, the two before it were read)
    await tgSay('hello again');
    const sent = await waitFor(() => { const s = tgCalls().slice(from).filter(c => c.method === 'sendMessage'); return s.some(x => /hello again/.test(x.body.text)) ? s : null; }, { timeout: 60000, every: 200, what: 'the answer to hello again' });
    assert.ok(sent.every(s => s.body.chat_id === OWNER_TG), JSON.stringify(sent.map(s => s.body.chat_id)));
    assert.ok(!requests().some(x => x.words === words), 'the brain was asked');
    assert.deepEqual(await live(), []);
  } finally { script([]); fresh(); }
});
