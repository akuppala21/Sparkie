// Covers: Who is handed which words of memory (R59, R43; the review of the memory steps, 2026-11-15). From the paired
// Telegram chat, recall gives back no words of a line the owner forgot and erased, and no words said on the page; and
// forget_memory with the id of a line no longer live (forgotten, replaced, past its day, or asked to erase) says none
// of its words there, to the brain, in the reply or on a button. An agent that may change things, through ask_sparkie,
// gets none of them either, nor does its own direct call. In a chat an agent started, the owner typing there gets no
// retired line from recall or memory {past}, and the agent reads none back. A value kept as a key is hidden in the
// memory block of the system prompt and in the picks. Memory, its history and a kept key are seeded before the console
// starts; Telegram is paired; the stand-in brain is scripted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, call, createKey, createActKey, newChat, say, waitFor, ASK, SLOW } from './lib.mjs';

const TOKEN = '123456789:AAEtestTokenForSparkConsoleXYZ_abcdefghij', OWNER_TG = 5550001;
const NAS = 'nas-Q7xv93Lp2mWd', DOOR = 'd00d0001', WIFI = 'a1f1a1f1', ETH = 'e7e7e7e7', ENDED = 'e0d0e0d0';
const at = n => new Date(Date.now() - n * 3600000).toISOString();
const dayAgo = n => { const t = new Date(Date.now() - n * 86400000); return new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
// (past the block's 4,000 characters, so the facts are picked, and the wish stays in the system prompt)
const filler = Array.from({ length: 60 }, (_, i) => ({ id: (0x30000000 + i).toString(16), kind: 'fact', by: 'owner', at: at(100 - i), src: { via: 'api' },
  text: `Rack note ${i}: the hall rack keeps its spare cables and labels in the top drawer, sorted by length` }));
const LINES = [
  { id: 'b0b0b0b0', kind: 'preference', text: `the NAS box answers to ${NAS}`, by: 'owner', at: at(200), src: { via: 'api' } },
  { id: 'b1b1b1b1', kind: 'fact', text: `Spark 4 mounts the NAS share from ${NAS}`, by: 'owner', at: at(199), src: { via: 'api' } },
  { id: ETH, kind: 'fact', text: 'Spark 4 is on Ethernet now (fixed)', by: 'owner', at: at(198), src: { via: 'api' }, replaces: WIFI },
  { id: ENDED, kind: 'fact', text: 'Spark 1 is lent to the lab for the zircon audit', by: 'owner', at: at(900), until: dayAgo(10), src: { via: 'api' } },
  ...filler,
];
const PAST = [
  { id: DOOR, kind: 'fact', text: 'my door code is 4471', by: 'owner', at: at(300), src: { via: 'api' }, gone: { at: at(250), why: 'forgotten', who: 'owner', src: { via: 'api' } } },
  { id: WIFI, kind: 'fact', text: 'Spark 4 is on the quartz Wi-Fi only', by: 'owner', at: at(400), src: { via: 'api' }, gone: { at: at(198), why: 'replaced', by: ETH, who: 'owner', src: { via: 'api' } } },
];
function seed({ dir, stateDir }) {
  writeFileSync(join(stateDir, 'memory.json'), JSON.stringify({ entries: LINES }), { mode: 0o600 });
  writeFileSync(join(stateDir, 'memory-past.json'), JSON.stringify({ past: PAST }), { mode: 0o600 });
  mkdirSync(join(dir, 'secrets'), { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, 'secrets', 'secrets.json'), JSON.stringify({ telegram: { token: TOKEN, bot: 'spark_test_bot', chatId: OWNER_TG, userId: OWNER_TG, name: 'Owner', pairedAt: new Date().toISOString() },
    keys: { NAS: { value: NAS, at: at(1) } } }), { mode: 0o600 });
}
useFleet({ telegram: true, watchMs: 60000, env: { SPARK_CONSOLE_TELEGRAM_LIMITS: '1000,1000,1000' }, prepare: seed },
  () => waitFor(async () => (await api('/telegram')).json.state === 'ok', { what: 'Telegram polling' }));

const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const requests = () => (existsSync(join(T.fleet.dir, 'model-requests.jsonl')) ? readFileSync(join(T.fleet.dir, 'model-requests.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []);
// What the brain was sent back from its tool calls for these words (round 1, after the first calls).
const resultsFor = words => waitFor(() => requests().find(x => x.words === words && x.round === 1)?.results.map(x => x.content).join('\n'), { what: `the tool results for “${words}”` });
const tgCalls = () => { const f = join(T.fleet.dir, 'telegram-calls.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []; };
let msgId = 900;
const tgSay = async text => (await fetch(`http://127.0.0.1:${T.fleet.telegramPort}/__push`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ message: { message_id: msgId++, date: Math.floor(Date.now() / 1000), chat: { id: OWNER_TG, type: 'private' }, from: { id: OWNER_TG, is_bot: false, first_name: 'Owner' }, text } }) })).json();
const owner = (name, body = {}) => api(`/actions/${name}`, { method: 'POST', body });
const asked = async (token, message, conversation = null) => {
  let v = (await call(token, ASK, { message, ...(conversation ? { conversation } : {}) })).value;
  if (v?.status === 'thinking') v = await waitFor(async () => { const x = (await call(token, ASK, { conversation: v.conversation })).value; return x?.status !== 'thinking' && x; }, { what: 'Sparkie’s answer' });
  assert.equal(v?.status, 'answered', JSON.stringify(v));
  return v;
};
// One message from the paired chat: what the brain was sent back, and every message that went out to Telegram for it,
// buttons and all.
const phone = async words => {
  const from = tgCalls().length;
  await tgSay(words);
  const sent = await resultsFor(words);
  const out = await waitFor(() => tgCalls().slice(from).filter(c => c.method === 'sendMessage').map(c => JSON.stringify(c.body)).join('\n') || null, { timeout: 60000, what: 'the reply on Telegram' });
  return { sent, out };
};

test('Telegram: recall there gives back no words of a line the owner forgot and erased, and no words said on the page; words said there it does', { timeout: 240000 * SLOW }, async () => {
  const kept = await owner('remember', { text: 'my garage code is 9182', kind: 'fact' });
  assert.equal(kept.json?.outcome, 'remembered', kept.text);
  assert.equal((await owner('forget_memory', { id: kept.json.id })).json?.outcome, 'forgotten');
  assert.equal((await owner('forget_memory', { id: kept.json.id, erase: true })).json?.outcome, 'erased');
  script([{ match: '^the side gate opens with 7731', calls: [] }]);
  await say(await newChat(), 'the side gate opens with 7731 and that is all for now');
  const words = 'reads phone asks about the garage and the gate';
  script([{ match: '^reads phone asks', calls: [{ name: 'recall', arguments: { about: 'garage code', kind: 'call' } }, { name: 'recall', arguments: { about: 'side gate', kind: 'said' } },
    { name: 'recall', arguments: { about: 'reads phone asks', kind: 'said' } }, { name: 'recall', arguments: { id: DOOR } }] }]);
  try {
    const { sent, out } = await phone(words);
    assert.match(sent, /There’s no line d00d0001 in memory \(the lines that were replaced or forgotten are shown to the owner only/);
    const around = n => { const i = sent.indexOf(n); return i < 0 ? null : sent.slice(Math.max(0, i - 260), i + 40); };
    assert.deepEqual({ erasedLine: around('9182'), saidOnThePage: around('7731') }, { erasedLine: null, saidOnThePage: null }, 'the brain answering on Telegram was sent these from the journal');
    assert.ok(!/9182|7731/.test(out), out.slice(0, 800));
    // (what the owner said in that chat itself stays readable there)
    assert.match(sent, /"kind":"said"[^}]*"via":"telegram"[^}]*"said":"reads phone asks about the garage and the gate"/);
  } finally { script([]); }
});

test('Telegram: forget_memory with the id of a line no longer live (forgotten, replaced, past its day, or asked to erase) says none of its words there', { timeout: 240000 * SLOW }, async () => {
  const got = {};
  try {
    for (const [name, id, word, erase] of [['forgotten', DOOR, '4471', false], ['replaced', WIFI, 'quartz', false], ['ended', ENDED, 'zircon', false], ['forgotten, asked to erase', DOOR, '4471', true]]) {
      const words = `reads phone says drop the ${name} line`;
      script([{ match: `^reads phone says drop the ${name} line$`, calls: [{ name: 'forget_memory', arguments: { id, ...(erase ? { erase: true } : {}) } }] }]);
      const { sent, out } = await phone(words);
      got[name] = { toTheBrain: sent.includes(word) ? sent.slice(0, 200) : null, toTelegram: out.includes(word) ? out.slice(0, 300) : null };
    }
  } finally { script([]); }
  const none = { toTheBrain: null, toTelegram: null };
  assert.deepEqual(got, { forgotten: none, replaced: none, ended: none, 'forgotten, asked to erase': none });
});

test('an agent that may change things, through ask_sparkie or its own call: forget_memory with the id of a forgotten or a replaced line gives it no word of it', { timeout: 240000 * SLOW }, async () => {
  const agent = await createActKey('reads-act'), got = {};
  try {
    for (const [name, id, word] of [['forgotten', DOOR, '4471'], ['replaced', WIFI, 'quartz']]) {
      script([{ match: `^reads agent says drop the ${name} line$`, calls: [{ name: 'forget_memory', arguments: { id } }] }]);
      const v = await asked(agent.token, `reads agent says drop the ${name} line`);
      got[name] = JSON.stringify(v).includes(word) ? { reply: String(v.reply).slice(0, 200), choices: v.choices ?? null } : null;
      const own = await call(agent.token, 'forget_memory', { id });
      assert.equal(own.value?.outcome, 'already', own.text);
      assert.ok(!own.text.includes(word), own.text);
    }
  } finally { script([]); }
  assert.deepEqual(got, { forgotten: null, replaced: null });
  const now = (await owner('memory', { past: true })).json;
  assert.ok([DOOR, WIFI].every(id => now.past.some(p => p.id === id)), 'nothing was changed');
});

test('a chat an agent started, the owner typing in it: recall and memory {past} give no retired line there, and the agent reads none back', { timeout: 240000 * SLOW }, async () => {
  const agent = await createKey('reads-agent');
  script([{ match: '^reads agent says hello', calls: [] }]);
  const v = await asked(agent.token, 'reads agent says hello');
  const words = 'reads owner asks what was forgotten';
  script([{ match: '^reads owner asks what was forgotten', calls: [{ name: 'recall', arguments: { id: DOOR } }, { name: 'recall', arguments: { about: 'door code', kind: 'line' } }, { name: 'memory', arguments: { past: true } }] }]);
  try {
    const r = await say(v.conversation, words);
    assert.deepEqual(r.message.tools.map(t => t.name), ['recall', 'recall', 'memory'], JSON.stringify(r.message.tools));
    const sent = await resultsFor(words);
    assert.match(sent, /The lines that were replaced or forgotten are shown to the owner only, in Spark Console/);
    assert.ok(!sent.includes('4471'), `in the chat the agent started, the brain was sent the forgotten line: ${sent.slice(0, 600)}`);
    const back = (await call(agent.token, ASK, { conversation: v.conversation })).value;
    assert.ok(!JSON.stringify(back).includes('4471'), JSON.stringify(back).slice(0, 600));
  } finally { script([]); }
  // (the owner's own page chat still reads the history)
  script([{ match: '^reads owner asks on the page what was forgotten$', calls: [{ name: 'memory', arguments: { past: true } }] }]);
  try {
    await say(await newChat(), 'reads owner asks on the page what was forgotten');
    assert.match(await resultsFor('reads owner asks on the page what was forgotten'), /my door code is 4471/);
  } finally { script([]); }
});

test('a kept key in a memory line is hidden in what the brain is sent: the system prompt and the picks', { timeout: 120000 * SLOW }, async () => {
  const words = 'reads asks what is mounted on spark 4';
  script([{ match: '^reads asks what is mounted', calls: [] }]);
  try {
    const from = requests().length;
    await say(await newChat(), words);
    const x = requests().slice(from).find(q => q.words === words);
    assert.ok(x.system.includes('the NAS box answers to [hidden]'), x.system.slice(-600));
    assert.ok(String(x.lastUser).includes('Spark 4 mounts the NAS share from [hidden]'), String(x.lastUser).slice(0, 2500));
    assert.ok(!x.system.includes(NAS) && !String(x.lastUser).includes(NAS), 'the kept key went to the brain');
  } finally { script([]); }
});
