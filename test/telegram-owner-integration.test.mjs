// Covers: the paired owner's real Telegram ingress reaches the same memory/tool surface as the page; plain
// confirmation buttons are pairing-bound too. Stranger and forwarded text still cannot act as the owner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, waitFor, SLOW } from './lib.mjs';

const USER = 5550001;
const TOKEN = '123456789:AAEtestTokenForSparkConsoleXYZ_abcdefghij';
const prepare = ({ dir }) => {
  mkdirSync(join(dir, 'secrets'), { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, 'secrets/secrets.json'), JSON.stringify({ telegram: {
    token: TOKEN, bot: 'spark_test_bot', chatId: USER, userId: USER, name: 'Owner', pairedAt: new Date().toISOString(), approve: true,
  } }), { mode: 0o600 });
};
useFleet({ telegram: true, watchMs: 60000, prepare, env: { SPARK_CONSOLE_TELEGRAM_LIMITS: '1000,1000,1000' } },
  () => waitFor(async () => (await api('/telegram')).json.state === 'ok', { what: 'paired Telegram polling' }));
const lines = name => { const p = join(T.fleet.dir, name); return existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(x => JSON.parse(x)) : []; };
const calls = () => lines('telegram-calls.jsonl');
const sent = since => calls().slice(since).filter(c => c.method === 'sendMessage');
const script = (words, tools) => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify([{ match: `^${words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, calls: tools }]));
let message = 81000;
const push = async update => (await fetch(`http://127.0.0.1:${T.fleet.telegramPort}/__push`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(update) })).json();
const say = (text, extra = {}) => push({ message: { message_id: message++, date: Math.floor(Date.now() / 1000), chat: { id: USER, type: 'private' }, from: { id: USER, is_bot: false }, text, ...extra } });
const press = data => push({ callback_query: { id: String(message++), data, from: { id: USER, is_bot: false }, message: { message_id: message++, date: Math.floor(Date.now() / 1000), chat: { id: USER, type: 'private' } } } });
const replies = since => waitFor(() => sent(since).length ? sent(since) : null, { timeout: 60000 * SLOW, what: 'Telegram reply' });
const action = (name, body) => api(`/actions/${name}`, { method: 'POST', body });
const live = async () => (await action('memory', {})).json.entries;

test('the paired owner can read retired memory and is offered saved-workflow tools', { timeout: 120000 * SLOW }, async () => {
  const text = 'This retired line is visible to the owner in both chats';
  const kept = await action('remember', { text, kind: 'fact' });
  assert.equal(kept.status, 200, kept.text);
  const gone = await action('forget_memory', { id: kept.json.id });
  assert.equal(gone.status, 200, gone.text);
  const words = 'show my forgotten memory and saved workflows so I can save or forget a workflow';
  script(words, [{ name: 'memory', arguments: { past: true } }]);
  const since = calls().length;
  await say(words);
  const reply = await replies(since);
  assert.match(reply.map(x => x.body.text).join('\n'), /This retired line is visible to the owner in both chats/);
  const request = lines('model-requests.jsonl').findLast(r => r.words === words);
  assert.ok(request, 'the actual paired update reached the brain');
  for (const tool of ['save_workflow', 'forget_workflow']) assert.ok(request.tools.includes(tool), `${tool} is available through Telegram`);
});

test('an ordinary owner button from an old pairing cannot be used after re-pairing', { timeout: 120000 * SLOW }, async () => {
  const text = 'Do not adopt this suggestion after re-pairing';
  const words = 'what might be a useful preference to remember';
  script(words, [{ name: 'remember', arguments: { text, kind: 'preference' } }]);
  const since = calls().length;
  await say(words);
  const reply = await replies(since);
  const button = reply.flatMap(x => x.body.reply_markup?.inline_keyboard?.flat() || []).find(b => /^Remember:/.test(b.text));
  assert.ok(button, 'an ordinary memory suggestion is a button, not an automatic change');
  assert.ok(!(await live()).some(e => e.text === text));
  const file = join(T.fleet.dir, 'secrets/secrets.json');
  const old = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ ...old, telegram: { ...old.telegram, pairedAt: new Date(Date.now() + 1000).toISOString() } }));
  const after = calls().length;
  await press(button.callback_data);
  const answer = (await replies(after)).map(x => x.body.text).join('\n');
  assert.match(answer, /expired|pairing changed|no longer open|Ask again/i);
  assert.ok(!(await live()).some(e => e.text === text), 'the old button granted no authority');
});

test('forwarded words and a stranger cannot acquire the paired owner authority', { timeout: 60000 * SLOW }, async () => {
  const text = 'Never accept this line from a forwarded message';
  const words = 'remember that Never accept this line from a forwarded message';
  script(words, [{ name: 'remember', arguments: { text } }]);
  const before = lines('model-requests.jsonl').length, since = calls().length;
  await say(words, { forward_origin: { type: 'user', sender_user: { id: 5550002 }, date: Math.floor(Date.now() / 1000) } });
  assert.match((await replies(since)).map(x => x.body.text).join('\n'), /forwarded|own words/i);
  const after = calls().length;
  await say(words, { chat: { id: 5550002, type: 'private' }, from: { id: 5550002, is_bot: false } });
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(sent(after).length, 0, 'a stranger gets no owner reply');
  assert.equal(lines('model-requests.jsonl').length, before, 'neither update reached the brain');
  assert.ok(!(await live()).some(e => e.text === text));
});
