// Covers: recall as the one way to look back (design G 3.4, step 3; R43, R45): the owner's live lines, lessons, runs
// that worked here, the owner's retired lines (memory-past.json) and the journal, each piece with its source and date,
// in that order; one count line first (inAll); next reads on with nothing repeated and ends; when turns a word into
// dates. "What did I tell you about Spark 4 last month?" returns the retired line with its date and source. remember
// after recall in the same turn needs the owner's words for 0.6 of the line, not a quarter. What it never does: the
// owner's words (said) and other callers' arguments to anyone but the owner's own call; a command's output to a caller
// that may not run commands; a retired line to an agent, an agent's chat or Telegram; an erased line from memory; a
// kept key unhidden. SPARK_CONSOLE_MEMORY_OFF=past,count leaves out the retired lines and the count line. Memory,
// lessons, runs, the journal and a kept key are seeded before the console starts; Telegram is paired; the stand-in
// brain is scripted.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, call, createKey, createActKey, newChat, say, waitFor, ASK, SLOW } from './lib.mjs';
import { startMock } from './start-mock.mjs';

const NOW = Date.now(), at = ms => new Date(ms).toISOString();
const now = new Date(NOW), lastMonth = (d, h = 12, m = 0) => at(+new Date(now.getFullYear(), now.getMonth() - 1, d, h, m));
const RECENT = at(NOW - 60000);
// As the console says a date (20-recall.mjs recallDay), on the same machine.
const day = iso => { const t = new Date(iso); return t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(t.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) }); };
const TOKEN = '123456789:AAEtestTokenForSparkConsoleXYZ_abcdefghij', OWNER_TG = 5550001;
const NAS = 'nas-Q7xv93Lp2mWd';
const WIFI = 'a1f1a1f1', ETH = 'e7e7e7e7', KESTREL = 'c0de5e70', KESTREL_OLD = 'c0de5e71', KEPT = 'b0b0b0b0', LESSON = 'l_9a8b7c6d', CMD = 'j_c0de00000001';
const LINES = [
  { id: ETH, kind: 'fact', text: 'Spark 4 is on Ethernet now (fixed)', by: 'owner', at: RECENT, src: { via: 'sparkie', chat: 'c_g3' }, replaces: WIFI },
  { id: KESTREL, kind: 'preference', text: 'my coding setup is called kestrel', by: 'owner', at: RECENT, src: { via: 'api' } },
  { id: KEPT, kind: 'fact', text: `the NAS box answers to ${NAS}`, by: 'owner', at: RECENT, src: { via: 'api' } },
];
const PAST = [
  { id: WIFI, kind: 'fact', text: 'Spark 4 is on Wi-Fi only', by: 'owner', at: lastMonth(14), src: { via: 'sparkie', chat: 'c_g3old' },
    gone: { at: RECENT, why: 'replaced', by: ETH, who: 'owner', src: { via: 'sparkie', chat: 'c_g3' } } },
  { id: KESTREL_OLD, kind: 'fact', text: 'kestrel used to run on spark 3', by: 'owner', at: lastMonth(10), src: { via: 'api' }, gone: { at: RECENT, why: 'forgotten', who: 'owner', src: { via: 'api' } } },
];
const CMD_TEXT = '$ cat /etc/zircon-notes\nzircon secret plans\n';
// Twelve records about kestrel this month (eight of the owner's words, four calls by an agent, one failed), the owner's
// words about Spark 4 last month, a key said in a chat, and a command another agent ran.
const RECORDS = [
  ...Array.from({ length: 8 }, (_, i) => ({ id: `j_5a1d000000${String(i + 10)}`, at: at(NOW - (i + 2) * 60000), k: 'said', chat: 'c_g3', via: 'page', words: `kestrel note ${i}: it builds fine` })),
  ...Array.from({ length: 4 }, (_, i) => ({ id: `j_ca11000000${String(i + 10)}`, at: at(NOW - (i + 12) * 60000), k: 'call', act: 'find_recipes', via: 'agent', actor: 'kestrel-agent', key: 'k_other',
    args: { query: `kestrel build ${i}` }, ok: i !== 0, ...(i === 0 ? { err: 'kestrel search failed' } : {}) })),
  { id: 'j_5a1d00000001', at: lastMonth(14, 12, 5), k: 'said', chat: 'c_g3old', via: 'page', words: 'Spark 4 is on Wi-Fi only, remember that' },
  { id: 'j_5a1d00000002', at: at(NOW - 30 * 60000), k: 'said', chat: 'c_g3', via: 'page', words: `the NAS box answers to ${NAS}` },
  { id: CMD, at: at(NOW - 31 * 60000), k: 'cmd', act: 'run', via: 'agent', actor: 'cmd-agent', where: 'host', class: 'look', args: { spark: 'spark3', command: 'cat /etc/zircon-notes' },
    ok: false, err: 'zircon: permission denied', exit: 1, sub: ['spark3'], o: [0, Buffer.byteLength(CMD_TEXT)] },
];
function seed({ dir, stateDir }) {
  writeFileSync(join(stateDir, 'memory.json'), JSON.stringify({ entries: LINES }), { mode: 0o600 });
  writeFileSync(join(stateDir, 'memory-past.json'), JSON.stringify({ past: PAST }), { mode: 0o600 });
  writeFileSync(join(stateDir, 'lessons.json'), JSON.stringify({ lessons: [{ id: LESSON, kind: 'start', subject: { model: 'glm-4.7-flash', engine: 'vllm', sparks: 2 },
    tried: { how: 'own', flags: 'abcdef012345', image: 'vllm/vllm-openai:v0.11.0', on: 'spark3+spark4', code: '0123456789ab' }, failure: 'never-connected', state: 'proven', failed: 2,
    evidence: ['j_0123456789ab'], firstAt: at(NOW - 7200000), lastAt: RECENT }] }), { mode: 0o600 });
  writeFileSync(join(stateDir, 'verified.json'), JSON.stringify({ deployments: [{ key: '["g3"]', model: 'glm-4.7-flash', repo: 'zai-org/GLM-4.7-Flash', title: 'GLM 4.7 Flash',
    engine: 'vllm', image: 'vllm/vllm-openai:v0.11.0', args: [], env: {}, sparks: 1, nodes: ['spark3'], firstAt: RECENT, lastAt: RECENT, runs: 3, best: { decodeTokS: 41.5 } }] }), { mode: 0o600 });
  mkdirSync(join(dir, 'secrets'), { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, 'secrets', 'secrets.json'), JSON.stringify({ telegram: { token: TOKEN, bot: 'spark_test_bot', chatId: OWNER_TG, userId: OWNER_TG, name: 'Owner' },
    keys: { NAS: { value: NAS, at: RECENT } } }), { mode: 0o600 });
  const folder = join(dir, 'journal');
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  writeFileSync(join(folder, `journal-${RECORDS.at(-1).at.slice(0, 7)}.out`), CMD_TEXT, { mode: 0o600 });
  for (const r of RECORDS) appendFileSync(join(folder, `journal-${r.at.slice(0, 7)}.jsonl`), `${JSON.stringify(r)}\n`, { mode: 0o600 });
}

const keys = {};
useFleet({ telegram: true, watchMs: 60000, prepare: seed }, async () => { keys.look = await createKey('g3-look'); keys.act = await createActKey('g3-act'); });
const later = [];
after(async () => { for (const f of later) await f.stop().catch(() => {}); }, { timeout: 60000 });

// The owner's own call (POST /actions/recall), on this file's console or another.
const owner = async (body, fleet = T.fleet) => {
  const r = await fetch(`${fleet.base}/actions/recall`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-spark-console': '1', origin: fleet.origin }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const ok = async body => { const r = await owner(body); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json; };
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const requests = () => (existsSync(join(T.fleet.dir, 'model-requests.jsonl')) ? readFileSync(join(T.fleet.dir, 'model-requests.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []);
// What the brain was sent back from its tool calls for these words (round 1, after the first calls).
const resultsFor = words => waitFor(() => requests().find(x => x.words === words && x.round === 1)?.results.map(x => x.content).join('\n'), { what: `the tool results for “${words}”` });
const tgSay = async text => (await fetch(`http://127.0.0.1:${T.fleet.telegramPort}/__push`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ message: { message_id: Math.floor(Math.random() * 1e6), date: Math.floor(Date.now() / 1000), chat: { id: OWNER_TG, type: 'private' }, from: { id: OWNER_TG, is_bot: false, first_name: 'Owner' }, text } }) })).json();
const ids = r => r.records.map(x => x.id || `${x.kind}:${x.text}`);

// First, before anything here asks about kestrel (the owner's own calls are journaled, and their words would match).
test('a query over more than one page: the count line counts every source, next repeats nothing and ends', { timeout: 120000 * SLOW }, async () => {
  const pages = [];
  for (let next = undefined, n = 0; n < 5; n++) {
    const r = await ok({ about: 'kestrel', limit: 5, ...(next ? { next } : {}) });
    pages.push(r);
    if (!r.next) break;
    assert.match(r.next, /^\d{1,9}-\d{13}$/);
    next = r.next;
  }
  assert.deepEqual(pages.map(p => p.records.length), [5, 5, 4]);
  const all = pages.flatMap(ids);
  assert.equal(new Set(all).size, 14, `nothing repeated: ${all.join(' ')}`);
  for (const p of pages) assert.equal(p.count, 14);
  assert.equal(pages.at(-1).next, null);
  const line = `14 about “kestrel”: 2 lines (1 retired), 12 journal records (8 messages of the owner; 4 calls, 1 failed); ${day(lastMonth(10))} to ${day(RECENT)}.`;
  for (const p of pages) assert.equal(p.inAll, line);
  assert.equal(Object.keys(pages[0])[0], 'inAll', 'the count line comes first');
  // In order: the owner's live line, the retired one, then the journal, the owner's words first.
  const flat = pages.flatMap(p => p.records);
  assert.deepEqual(flat.slice(0, 2).map(x => [x.id, x.kind, Boolean(x.retired)]), [[KESTREL, 'line', false], [KESTREL_OLD, 'line', true]]);
  assert.deepEqual(flat.slice(2).map(x => x.kind), [...Array(8).fill('said'), ...Array(4).fill('call')]);
  assert.ok(flat.every(x => x.source && x.at), JSON.stringify(flat));
  assert.ok(flat.slice(2).every(x => x.source === 'the journal'));
});

// T137 (part): "what did I tell you about Spark 4 last month?" returns the retired line with its date and its source.
test('“What did I tell you about Spark 4 last month?”: the retired line with its date and source, then the owner\'s words then', { timeout: 120000 * SLOW }, async () => {
  const r = await ok({ about: 'Spark 4', when: 'last-month' });
  assert.deepEqual(r.records.map(x => [x.id, x.kind]), [[WIFI, 'line'], ['j_5a1d00000001', 'said']], JSON.stringify(r));
  const [wifi] = r.records;
  assert.deepEqual([wifi.at, wifi.text, wifi.source, wifi.retired.why, wifi.retired.by], [lastMonth(14), 'Spark 4 is on Wi-Fi only', 'said by the owner', 'replaced', ETH]);
  // (shown as the memory picker shows a line, and when and why it was retired)
  assert.equal(wifi.shown, `- [${WIFI}] (fact, ${lastMonth(14).slice(0, 10)}, said by the owner) Spark 4 is on Wi-Fi only (retired ${RECENT.slice(0, 10)}: replaced, by [${ETH}])`);
  assert.equal(r.inAll, `2 about “Spark 4” (last-month): 1 line (1 retired), 1 journal record (1 message of the owner); ${day(lastMonth(14))}.`);
  assert.equal(r.next, null);
  // Asked by id: the line whole, with where it came from and the line that replaced it.
  const one = await ok({ id: WIFI });
  assert.deepEqual([one.record.id, one.record.src, one.replacedBy?.id, one.replacedBy?.text], [WIFI, { via: 'sparkie', chat: 'c_g3old' }, ETH, 'Spark 4 is on Ethernet now (fixed)']);
  // Sparkie, in the owner's chat on the page, is given the same.
  const words = 'What did I tell you about Spark 4 last month?';
  script([{ match: '^What did I tell you about Spark 4 last month', calls: [{ name: 'recall', arguments: { about: 'Spark 4', when: 'last-month' } }] }]);
  await say(await newChat(), words);
  const sent = await resultsFor(words);
  assert.ok(sent.includes(`"id":"${WIFI}"`) && sent.includes(`"at":"${lastMonth(14)}"`) && sent.includes('"source":"said by the owner"'), sent);
});

test('a lesson and a run that worked, about a named model, come back with their source', { timeout: 60000 * SLOW }, async () => {
  const r = await ok({ about: 'glm-4.7-flash' });
  const lesson = r.records.find(x => x.kind === 'lesson'), proven = r.records.find(x => x.kind === 'proven');
  assert.deepEqual([lesson?.id, lesson?.source, lesson?.state, lesson?.failure], [LESSON, 'a lesson Spark Console wrote: seen 2 times, proven', 'proven', 'never-connected'], JSON.stringify(r));
  assert.match(lesson.text, /^Starting glm-4\.7-flash with vllm on 2 Sparks \(spark3, spark4\) failed: /);
  assert.deepEqual([proven?.source, proven?.text], ['a run that worked here: 3 times', 'GLM 4.7 Flash ran with vllm on spark3, 41.5 tokens/s at best (image vllm/vllm-openai:v0.11.0).']);
  assert.ok(r.records.indexOf(lesson) < r.records.indexOf(proven), 'lessons before runs');
  assert.match(r.inAll, /^\d+ about “glm-4\.7-flash”: 1 lesson, 1 run that worked/);
  const one = await ok({ id: LESSON });
  assert.deepEqual([one.record.id, one.record.tried.on, one.record.failed], [LESSON, 'spark3+spark4', 2]);
  // An agent reads them too (the console's own facts, as find_recipes shows proven runs).
  const seen = await call(keys.look.token, 'recall', { about: 'glm-4.7-flash', kind: 'lesson' });
  assert.deepEqual(seen.value.records.map(x => x.id), [LESSON], seen.text);
});

test('remember after recall in the same turn is stricter: the line needs 0.6 of its words from the owner, not a quarter', { timeout: 120000 * SLOW }, async () => {
  const words = 'look up what I said about spark 4 last month and remember it again', line = 'Spark 4 is on Wi-Fi only';
  // With recall first: a button (half of the line's own words are the owner's).
  script([{ match: '^look up what I said about spark 4', rounds: [[{ name: 'recall', arguments: { about: 'spark 4', when: 'last-month' } }], [{ name: 'remember', arguments: { text: line, kind: 'fact' } }]] }]);
  const a = await say(await newChat(), words);
  assert.deepEqual(a.message.tools.map(t => [t.name, t.ok, t.outcome || null]), [['recall', true, null], ['remember', true, 'needs-ok']], JSON.stringify(a.message.tools));
  assert.equal(a.message.choices?.[0]?.label, `Remember: “${line}”`);
  assert.ok(!(await api('/actions/memory', { method: 'POST', body: {} })).json.entries.some(e => e.text === line), 'nothing kept');
  // The same words and the same line with no recall in the turn: kept at once.
  script([{ match: '^look up what I said about spark 4', calls: [{ name: 'remember', arguments: { text: line, kind: 'fact' } }] }]);
  const b = await say(await newChat(), words);
  assert.deepEqual(b.message.tools.map(t => [t.name, t.outcome || null]), [['remember', 'remembered']], JSON.stringify(b.message.tools));
  const kept = (await api('/actions/memory', { method: 'POST', body: {} })).json.entries.find(e => e.text === line);
  assert.equal((await api('/actions/forget_memory', { method: 'POST', body: { id: kept.id, erase: true } })).json.outcome, 'erased');
});

test('never: the owner\'s words and other callers\' arguments go to the owner\'s own call only', { timeout: 120000 * SLOW }, async () => {
  for (const k of [keys.look, keys.act]) {
    for (const args of [{ about: 'kestrel', limit: 20 }, { kind: 'said', limit: 20 }, { kind: 'call', about: 'kestrel', limit: 20 }]) {
      const r = await call(k.token, 'recall', args);
      assert.equal(r.isError, false, r.text);
      const others = r.value.records.filter(x => x.actor !== k.name);
      assert.ok(!others.some(x => x.kind === 'said' || 'said' in x), r.text);
      assert.ok(!/kestrel note|kestrel build|search failed/.test(JSON.stringify(others)), r.text);
    }
    const said = await call(k.token, 'recall', { id: 'j_5a1d00000001' });
    assert.match(said.text, /^\[not_allowed\] Words said in a chat/);
  }
  // The owner's own call reads both.
  const own = await ok({ about: 'kestrel', kind: 'call', limit: 20 });
  assert.ok(own.records.some(x => x.actor === 'kestrel-agent' && /kestrel build/.test(x.args)) && own.records.some(x => x.error === 'kestrel search failed'), JSON.stringify(own));
});

test('never: a command\'s line, output and error to a caller that may not run commands there', { timeout: 60000 * SLOW }, async () => {
  const listed = (await call(keys.look.token, 'recall', { kind: 'cmd', limit: 20 })).value.records.find(x => x.id === CMD);
  assert.ok(listed && !('args' in listed) && !('error' in listed) && !('kept' in listed), JSON.stringify(listed));
  assert.equal((await call(keys.look.token, 'recall', { about: 'zircon' })).value.records.filter(x => x.id === CMD).length, 0, 'its words match nothing for it');
  const one = await call(keys.look.token, 'recall', { id: CMD });
  assert.deepEqual([one.value.text, /zircon/.test(one.text)], [null, false], one.text);
  assert.match(one.value.note, /read back only by the owner, or by an agent the owner lets change things/);
  // An agent the owner lets change things, and the owner, read it whole.
  assert.equal((await call(keys.act.token, 'recall', { id: CMD })).value.text, CMD_TEXT);
  assert.ok((await ok({ about: 'zircon' })).records.some(x => x.id === CMD && /zircon-notes/.test(x.args) && x.error === 'zircon: permission denied'));
});

test('never: a retired line to an agent\'s key, an agent\'s chat or Telegram; the live ones as memory gives them', { timeout: 180000 * SLOW }, async () => {
  const asks = [{ about: 'Spark 4' }, { kind: 'line', limit: 20 }, { id: WIFI }, { about: 'kestrel', kind: 'line' }];
  for (const k of [keys.look, keys.act]) {
    for (const args of asks) {
      const r = await call(k.token, 'recall', args);
      assert.ok(!r.text.includes(`"id":"${WIFI}"`), `${JSON.stringify(args)}: ${r.text}`);
      assert.ok(!/Wi-Fi only|used to run on spark 3|"retired"/.test(r.text), `${JSON.stringify(args)}: ${r.text}`);
      if (args.id) assert.match(r.text, /^\[not_found\] There’s no line a1f1a1f1 in memory \(the lines that were replaced or forgotten are shown to the owner only/);
      if (args.about === 'Spark 4') assert.ok(r.value.records.some(x => x.id === ETH && !('about' in x)), r.text);
    }
  }
  // Sparkie answering an agent, and the owner on Telegram: the same calls, and what the brain was sent back.
  const words = 'g3 asks what is remembered about spark 4';
  script([{ match: '^g3 asks what is remembered', calls: asks.map(a => ({ name: 'recall', arguments: a })) }]);
  assert.equal((await call((await createKey('g3-ask')).token, ASK, { message: words })).isError, false);
  const toAgent = await resultsFor(words);
  assert.ok(!toAgent.includes(`"id":"${WIFI}"`) && !/Wi-Fi only|used to run on spark 3|"retired"/.test(toAgent), toAgent);
  assert.ok(toAgent.includes(`"id":"${ETH}"`), toAgent);
  const phone = 'g3 asks what is remembered about spark 4 from the phone';
  script([{ match: '^g3 asks what is remembered', calls: asks.filter(a => a.kind === 'line' || a.id).map(a => ({ name: 'recall', arguments: a })) }]);
  await tgSay(phone);
  const toPhone = await resultsFor(phone);
  assert.ok(!toPhone.includes(`"id":"${WIFI}"`) && !toPhone.includes(KESTREL_OLD) && !toPhone.includes('"retired"'), toPhone);
  assert.match(toPhone, /There’s no line a1f1a1f1 in memory \(the lines that were replaced or forgotten are shown to the owner only/);
  assert.ok(toPhone.includes(`"id":"${ETH}"`), toPhone);
  // The owner, in Spark Console, sees them.
  const mine = await ok({ kind: 'line', limit: 20 });
  assert.ok(mine.records.some(x => x.id === WIFI && x.retired) && mine.records.some(x => x.id === KESTREL_OLD && x.retired.why === 'forgotten'), JSON.stringify(mine));
});

test('never: a line erased for good, from any source in memory, for anyone', { timeout: 120000 * SLOW }, async () => {
  const text = 'the quartz room key hangs by the green door', act = (name, body) => api(`/actions/${name}`, { method: 'POST', body });
  const id = (await act('remember', { text, kind: 'fact' })).json.id;
  assert.equal((await act('forget_memory', { id })).json.outcome, 'forgotten');
  assert.ok((await ok({ about: 'quartz' })).records.some(x => x.id === id && x.retired), 'retired, it is still found');
  assert.equal((await act('forget_memory', { id, erase: true })).json.outcome, 'erased');
  for (const args of [{ about: 'quartz', limit: 20 }, { kind: 'line', limit: 20 }, { about: 'green door', kind: 'line' }]) {
    const r = await ok(args);
    assert.ok(!r.records.some(x => x.kind === 'line' && (x.id === id || x.text === text)), JSON.stringify(r));
  }
  assert.equal((await owner({ id })).status, 404);
  for (const k of [keys.look, keys.act]) {
    const r = await call(k.token, 'recall', { about: 'quartz', limit: 20 });
    assert.ok(!/quartz room|green door/.test(JSON.stringify(r.value.records.filter(x => x.actor !== k.name))), r.text);
  }
  const words = 'g3 recalls the quartz key';
  script([{ match: '^g3 recalls the quartz key', calls: [{ name: 'recall', arguments: { about: 'quartz', kind: 'line' } }, { name: 'recall', arguments: { id } }] }]);
  await say(await newChat(), words);
  const sent = await resultsFor(words);
  assert.ok(!sent.includes(`"id":"${id}"`) && !sent.includes(text), sent);
});

test('never: a kept key comes back unhidden, in a line or a record written before it was kept', { timeout: 60000 * SLOW }, async () => {
  for (const args of [{ about: 'NAS box', limit: 20 }, { id: KEPT }, { kind: 'said', about: 'NAS', limit: 20 }]) {
    const r = await owner(args);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const text = JSON.stringify(r.json);
    assert.ok(!text.includes(NAS) && text.includes('the NAS box answers to [hidden]'), text);
  }
});

test('the switch: SPARK_CONSOLE_MEMORY_OFF=past,count leaves out the retired lines and the count line; on, both are there', { timeout: 120000 * SLOW }, async () => {
  const off = await startMock({ telegram: true, watchMs: 60000, prepare: seed, env: { SPARK_CONSOLE_MEMORY_OFF: 'past,count' } });
  later.push(off);
  const on = await ok({ about: 'Spark 4' });
  assert.ok(on.inAll && on.records.some(x => x.id === WIFI && x.retired), JSON.stringify(on));
  const r = await owner({ about: 'Spark 4' }, off);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(!('inAll' in r.json) && !r.json.records.some(x => x.id === WIFI || x.retired), JSON.stringify(r.json));
  assert.ok(r.json.records.some(x => x.id === ETH), 'the live line is still there');
  assert.equal((await owner({ id: WIFI }, off)).status, 404);
  assert.equal((await owner({ id: WIFI })).status, 200);
});
