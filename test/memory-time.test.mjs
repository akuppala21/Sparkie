// Covers: Memory's lines in time (design G step 4, A3; R45). A line may carry `until`, its last day: past it the line is
// in no prompt or pick and in neither the owner's nor Sparkie's live lines; `memory {past: true}` shows it as past (expired) and
// the next save moves it to memory-past.json, never deleting it; a day already gone is refused at save, and Sparkie
// keeps a line with an end at once only when the owner's words name a time (else a button that shows the end). A fact
// said again (the same names and numbers, 0.8 of the old line's own words) leaves one live line and the result names
// the line it replaced; lines that share only common words, or differ in a number, both stay, and the result carries
// the other live lines about the same names. An agent saying an owner's line again never replaces or retires it. With
// the brain eval's switch `time` off (SPARK_CONSOLE_MEMORY_OFF), memory is as the build before this one kept it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, call, createKey, createActKey, newChat, say, request, SLOW } from './lib.mjs';
import { startMock } from './start-mock.mjs';
import { brainSent, brainReadsOf } from './lock.mjs';

let agent, look;
useFleet({ watchMs: 60000 }, async () => { agent = await createActKey('time-agent'); look = (await createKey('time-look')).token; });
const state = f => join(T.fleet.stateDir, f);
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const requestsOf = (dir = T.fleet.dir) => (existsSync(join(dir, 'model-requests.jsonl')) ? readFileSync(join(dir, 'model-requests.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []);
const esc = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fresh = () => { for (const f of readdirSync(T.fleet.stateDir).filter(x => /^memory(-past)?\.json/.test(x))) rmSync(state(f), { force: true, recursive: true }); };
const owner = async (name, body = {}) => api(`/actions/${name}`, { method: 'POST', body });
const remember = async (text, kind = 'fact') => { const r = await owner('remember', { text, kind }); assert.equal(r.json?.outcome, 'remembered', r.text); return r.json; };
const live = async () => (await owner('memory')).json.entries;
const past = async () => { const r = await owner('memory', { past: true }); assert.equal(r.status, 200, r.text); return r.json.past; };
const systemFor = async words => { const from = requestsOf().length; await say(await newChat(), words); return requestsOf().slice(from).find(x => x.words === words)?.system || ''; };
// A day counted from today, as Spark 2 counts its days (the service runs beside this test, in the same time zone).
const day = n => { const t = new Date(Date.now() + n * 86400000); return new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
// A day as the owner reads it at a glance, as the console says it (memoryDayWords): "Friday 20 November".
const dayWords = d => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', ...(d.slice(0, 4) === day(0).slice(0, 4) ? {} : { year: 'numeric' }) }).replace(',', '');
const dayAfter = d => { const t = new Date(`${d}T00:00:00`); t.setDate(t.getDate() + 1); return t.toISOString(); };
const ENDED = { id: 'e1d0e1d0', kind: 'fact', text: 'Spark 4 is busy with the GLM trial', by: 'owner', at: '2026-11-01T10:00:00.000Z', until: day(-3) };

test('until: a line past its last day is in no prompt and no live list; it is shown as past (expired), moved to memory-past.json at the next save, never deleted', { timeout: 120000 * SLOW }, async () => {
  fresh();
  const LIVE = { id: 'a1a1a1a1', kind: 'preference', text: 'Spark 3 is where models go', by: 'owner', at: '2026-11-02T10:00:00.000Z', until: day(3) };
  writeFileSync(state('memory.json'), JSON.stringify({ entries: [ENDED, LIVE] }, null, 2), { mode: 0o600 });
  try {
    const sys = await systemFor('anything new on the sparks today?');
    assert.ok(sys.endsWith(`\n- [${LIVE.id}] (preference, 2026-11-02, until ${LIVE.until}) ${LIVE.text}`), sys.slice(-400));
    assert.ok(!sys.includes(ENDED.text), 'the ended line is in the prompt');
    assert.deepEqual((await live()).map(e => e.id), [LIVE.id]);
    assert.deepEqual((await call(look, 'memory', {})).value.entries, [LIVE]);
    const was = await past();
    assert.deepEqual(was.map(p => [p.id, p.text, p.gone.why, p.gone.who, p.gone.at]), [[ENDED.id, ENDED.text, 'expired', 'Spark Console', dayAfter(ENDED.until)]]);
    // Not deleted: memory.json holds it until the next save, which moves it to memory-past.json.
    assert.ok(readFileSync(state('memory.json'), 'utf8').includes(ENDED.text));
    await remember('Spark 2 runs the brain');
    assert.ok(!readFileSync(state('memory.json'), 'utf8').includes(ENDED.text));
    const kept = JSON.parse(readFileSync(state('memory-past.json'), 'utf8')).past;
    assert.deepEqual(kept.map(p => [p.id, p.text, p.until, p.gone.why]), [[ENDED.id, ENDED.text, ENDED.until, 'expired']]);
    assert.deepEqual((await past()).map(p => [p.id, p.gone.why]), [[ENDED.id, 'expired']]);
    assert.deepEqual((await live()).map(e => e.text), [LIVE.text, 'Spark 2 runs the brain']);
  } finally { fresh(); }
});

test('until: past its day a line is in no pick either, while a live line about the same Spark is picked', { timeout: 120000 * SLOW }, async () => {
  fresh();
  // (past the block's 4,000 characters, so the two Spark 4 lines, the oldest, are left out of the system prompt)
  const filler = Array.from({ length: 60 }, (_, i) => ({ id: (0x10000000 + i).toString(16), kind: 'fact', by: 'owner', at: '2026-11-01T10:00:00.000Z',
    text: `Rack note ${i}: the hall rack keeps its spare cables and labels in the top drawer, sorted by length` }));
  const OLD = { id: 'e2e2e2e2', kind: 'fact', text: 'Spark 4 is busy with the GLM trial', by: 'owner', at: '2026-10-01T10:00:00.000Z', until: day(-3) };
  const NOW = { id: 'f3f3f3f3', kind: 'fact', text: 'Spark 4 is free again after the GLM trial', by: 'owner', at: '2026-10-01T11:00:00.000Z', until: day(3) };
  writeFileSync(state('memory.json'), JSON.stringify({ entries: [OLD, NOW, ...filler] }), { mode: 0o600 });
  try {
    const words = 'is Spark 4 free for a new model?', from = requestsOf().length;
    await say(await newChat(), words);
    const sent = requestsOf().slice(from).find(x => x.words === words);
    assert.ok(String(sent.lastUser).includes(`[${NOW.id}]`), String(sent.lastUser).slice(0, 1500));
    assert.ok(!String(sent.lastUser).includes(OLD.id) && !sent.system.includes(OLD.id), 'the ended line was sent');
  } finally { fresh(); }
});

test('until at save: a day already gone is refused and nothing is kept; a day that is no day is refused; a day to come is kept and said', { timeout: 60000 * SLOW }, async () => {
  fresh();
  try {
    const gone = await owner('remember', { text: 'Spark 4 is busy with the GLM trial', kind: 'fact', until: day(-1) });
    assert.equal(gone.status, 400, gone.text);
    assert.equal(gone.json.error, `That end (${day(-1)}) has already passed: today is ${day(0)}. Nothing was kept. Say it again with no end, or with a day from today on.`);
    const odd = await owner('remember', { text: 'Spark 4 is busy with the GLM trial', kind: 'fact', until: '2026-02-30' });
    assert.equal(odd.status, 400, odd.text);
    assert.match(odd.json.error, /^until isn’t a real day: 2026-02-30\./);
    assert.equal((await owner('remember', { text: 'Spark 4 is busy', until: 'Friday' })).status, 400);
    assert.deepEqual(await live(), []);
    const r = await owner('remember', { text: 'Spark 4 is busy with the GLM trial', kind: 'fact', until: day(5) });
    assert.equal(r.json?.outcome, 'remembered', r.text);
    assert.equal(r.json.note, `I’ll remember: Spark 4 is busy with the GLM trial (until ${dayWords(day(5))})`);
    assert.deepEqual((await live()).map(e => [e.text, e.until]), [['Spark 4 is busy with the GLM trial', day(5)]]);
  } finally { fresh(); }
});

test('a fact said again leaves one live line, and the result names the line it replaced', { timeout: 60000 * SLOW }, async () => {
  fresh();
  try {
    const first = await remember('Spark 3 is where models go', 'preference');
    const r = await owner('remember', { text: 'Spark 3 is where the models go now', kind: 'preference' });
    assert.equal(r.json?.outcome, 'remembered', r.text);
    assert.deepEqual(r.json.replaced, { id: first.id, text: 'Spark 3 is where models go' });
    assert.equal(r.json.note, 'I’ll remember: Spark 3 is where the models go now (instead of: Spark 3 is where models go)');
    assert.deepEqual((await live()).map(e => [e.id, e.text, e.replaces]), [[r.json.id, 'Spark 3 is where the models go now', first.id]]);
    assert.deepEqual((await past()).map(p => [p.id, p.gone.why, p.gone.by]), [[first.id, 'replaced', r.json.id]]);
    // A line saved before names were kept, said again: one live line too.
    fresh();
    const OLD = { id: 'b0b0b0b0', kind: 'fact', text: 'Spark 4 is on Wi-Fi only', by: 'owner', at: '2026-11-03T10:00:00.000Z' };
    writeFileSync(state('memory.json'), JSON.stringify({ entries: [OLD] }), { mode: 0o600 });
    const again = await owner('remember', { text: 'Spark 4 is on the Wi-Fi only now', kind: 'fact' });
    assert.deepEqual(again.json?.replaced, { id: OLD.id, text: OLD.text }, again.text);
    assert.deepEqual((await live()).map(e => e.text), ['Spark 4 is on the Wi-Fi only now']);
  } finally { fresh(); }
});

test('lines that share only common words, or differ in a number, both stay; the result carries the other live lines about the same names', { timeout: 60000 * SLOW }, async () => {
  fresh();
  try {
    const RACK = 'Spark 4 is the one in the rack, and it has been there for a while', WIFI = 'Spark 4 is the one on the Wi-Fi, and it has been there for a while';
    const rack = await remember(RACK);
    const wifi = await remember(WIFI);
    assert.equal(wifi.replaced, undefined, JSON.stringify(wifi));
    assert.deepEqual(wifi.also.map(a => [a.id, a.text, a.by]), [[rack.id, RACK, 'owner']]);
    assert.equal(wifi.note, `I’ll remember: ${WIFI}. I also have: “${RACK}” (${new Date().toISOString().slice(0, 10)}). Still true?`);
    const big = await remember('Spark 4 has 128 GB of memory for the models');
    const small = await remember('Spark 4 has 64 GB of memory for the models');
    assert.equal(small.replaced, undefined, JSON.stringify(small));
    // (two at most, newest first)
    assert.deepEqual(small.also.map(a => a.id), [big.id, wifi.id]);
    assert.deepEqual((await live()).map(e => e.text), [RACK, WIFI, 'Spark 4 has 128 GB of memory for the models', 'Spark 4 has 64 GB of memory for the models']);
    assert.deepEqual(await past(), []);
    // A line about other names carries none.
    assert.equal((await remember('Spark 3 is where models go')).also, undefined);
    // Numbers as written: two versions, two addresses, two dates are two facts (review of the memory steps, 2026-11-15).
    for (const [a, b] of [['vLLM 0.11.0 works with gemma on Spark 3', 'vLLM 0.11.1 works with gemma on Spark 3'], ['the agent build 2.0.1 runs on Spark 2', 'the agent build 2.1.0 runs on Spark 2'],
      ['the NAS sits at 10.0.0.5 on the house network', 'the NAS sits at 10.0.5.0 on the house network'], ['the lab borrows Spark 1 on 11/12', 'the lab borrows Spark 1 on 12/11']]) {
      await remember(a);
      const second = await remember(b);
      assert.equal(second.replaced, undefined, `${b}: ${second.note}`);
      assert.ok((await live()).some(e => e.text === a), a);
    }
  } finally { fresh(); }
});

test('an agent saying an owner\'s line again never replaces or retires it: it joins it, and nothing new is kept; its own line said again it replaces', { timeout: 60000 * SLOW }, async () => {
  fresh();
  try {
    const mine = await remember('Spark 3 is where models go', 'preference');
    const r = await call(agent.token, 'remember', { text: 'Spark 3 is where the models go now', kind: 'preference' });
    assert.equal(r.value?.outcome, 'already', r.text);
    assert.deepEqual(r.value.joined, { id: mine.id, text: 'Spark 3 is where models go' });
    assert.deepEqual((await live()).map(e => e.id), [mine.id]);
    assert.deepEqual(await past(), []);
    const theirs = await call(agent.token, 'remember', { text: 'The nightly eval runs at 2am on Spark 4', kind: 'fact' });
    assert.equal(theirs.value?.outcome, 'remembered', theirs.text);
    const again = await call(agent.token, 'remember', { text: 'The nightly eval runs at 2am on Spark 4 now', kind: 'fact' });
    assert.deepEqual(again.value?.replaced, { id: theirs.value.id, text: 'The nightly eval runs at 2am on Spark 4' }, again.text);
    assert.deepEqual((await live()).map(e => [e.text, e.by]), [['Spark 3 is where models go', 'owner'], ['The nightly eval runs at 2am on Spark 4 now', agent.name]]);
    assert.deepEqual((await past()).map(p => [p.id, p.gone.why, p.gone.who]), [[theirs.value.id, 'replaced', agent.name]]);
  } finally { fresh(); }
});

test('Sparkie keeps a line with an end at once only when the owner\'s words name a time; else it is a button that shows the end', { timeout: 120000 * SLOW }, async () => {
  fresh();
  const LINE = 'Spark 4 is busy with the nightly eval', TIMED = `${LINE} until Friday`;
  script([{ match: `^${esc(LINE)}$`, calls: [{ name: 'remember', arguments: { text: LINE, kind: 'fact', until: day(4) } }] },
    { match: `^${esc(TIMED)}$`, calls: [{ name: 'remember', arguments: { text: LINE, kind: 'fact', until: day(4) } }] }]);
  try {
    const q = (await say(await newChat(), LINE)).message;
    assert.deepEqual(q.tools.map(t => [t.name, t.outcome]), [['remember', 'needs-ok']], JSON.stringify(q.tools));
    assert.deepEqual(q.choices?.map(c => c.label), [`Remember: “${LINE}” (until ${day(4)})`]);
    assert.deepEqual(await live(), []);
    const y = (await say(await newChat(), TIMED)).message;
    assert.deepEqual(y.tools.map(t => [t.name, t.outcome]), [['remember', 'remembered']], JSON.stringify(y.tools));
    assert.deepEqual((await live()).map(e => [e.text, e.until]), [[LINE, day(4)]]);
  } finally { script([]); fresh(); }
});

test('with the eval\'s switch time off, memory is as the build before this one kept it: an end is not kept, a line past its day is used, a fact said again is a second line', { timeout: 180000 * SLOW }, async () => {
  const fleet = await startMock({ watchMs: 60000, statusMs: 60000, env: { SPARK_CONSOLE_MEMORY_OFF: 'time' },
    prepare: ({ stateDir }) => writeFileSync(join(stateDir, 'memory.json'), JSON.stringify({ entries: [ENDED] }), { mode: 0o600 }) });
  const headers = { 'content-type': 'application/json', 'x-spark-console': '1', origin: fleet.origin };
  const act = async (name, body = {}) => { const r = await request(`${fleet.base}/actions/${name}`, { method: 'POST', body: JSON.stringify(body), headers }); return { status: r.status, json: JSON.parse(r.text) }; };
  try {
    assert.deepEqual((await act('memory')).json.entries.map(e => e.id), [ENDED.id]);
    const a = await act('remember', { text: 'Spark 3 is where models go', kind: 'preference', until: day(-2) });
    assert.equal(a.json.outcome, 'remembered', JSON.stringify(a));
    assert.equal(a.json.note, 'I’ll remember: Spark 3 is where models go');
    const b = await act('remember', { text: 'Spark 3 is where the models go now', kind: 'preference' });
    assert.deepEqual([b.json.outcome, b.json.replaced, b.json.also], ['remembered', undefined, undefined], JSON.stringify(b));
    const lines = (await act('memory')).json.entries;
    assert.deepEqual(lines.map(e => [e.text, e.until ?? null]), [[ENDED.text, ENDED.until], ['Spark 3 is where models go', null], ['Spark 3 is where the models go now', null]]);
    assert.deepEqual((await act('memory', { past: true })).json.past, []);
    const chat = JSON.parse((await request(`${fleet.base}/chats`, { method: 'POST', body: '{}', headers })).text).id;
    await request(`${fleet.base}/chats/${chat}/messages`, { method: 'POST', body: JSON.stringify({ text: 'what do you remember?' }), headers });
    const sys = requestsOf(fleet.dir).find(x => x.words === 'what do you remember?')?.system || '';
    assert.ok(sys.endsWith(`\n- [${ENDED.id}] (fact, 2026-11-01) ${ENDED.text}\n- [${a.json.id}] (preference, ${new Date().toISOString().slice(0, 10)}) Spark 3 is where models go\n- [${b.json.id}] (preference, ${new Date().toISOString().slice(0, 10)}) Spark 3 is where the models go now`), sys.slice(-600));
  } finally { await fleet.stop(); }
});

// The review of the memory steps (2026-11-15), fix 7.
test('the same words said again with another end, or none, take the line\'s place; with the same end they are already kept', { timeout: 60000 * SLOW }, async () => {
  fresh();
  try {
    const first = (await owner('remember', { text: 'Spark 1 is lent to the lab', kind: 'fact', until: day(3) })).json;
    const same = (await owner('remember', { text: 'Spark 1 is lent to the lab', kind: 'fact', until: day(3) })).json;
    assert.equal(same.outcome, 'already', JSON.stringify(same));
    const none = (await owner('remember', { text: 'Spark 1 is lent to the lab', kind: 'fact' })).json;
    assert.deepEqual([none.outcome, none.replaced?.id], ['remembered', first.id], JSON.stringify(none));
    assert.deepEqual((await live()).map(e => [e.text, e.until ?? null]), [['Spark 1 is lent to the lab', null]]);
    const later = (await owner('remember', { text: 'Spark 1 is lent to the lab', kind: 'fact', until: day(6) })).json;
    assert.deepEqual([later.outcome, later.replaced?.id], ['remembered', none.id], JSON.stringify(later));
    assert.deepEqual((await live()).map(e => [e.text, e.until ?? null]), [['Spark 1 is lent to the lab', day(6)]]);
  } finally { fresh(); }
});

// Fix 5: the brain is told the day where it decides an end, in the turn's record, and the line said back names the end
// in words; what the brain reads (the lock's mark) is the same from one day to the next.
test('the turn\'s record tells the brain today\'s weekday and date, and remember says the end back as a day in words', { timeout: 120000 * SLOW }, async () => {
  fresh();
  const words = 'Spark 4 is busy with the nightly eval until Friday';
  script([{ match: `^${esc(words)}$`, calls: [{ name: 'remember', arguments: { text: 'Spark 4 is busy with the nightly eval', kind: 'fact', until: day(4) } }] }]);
  try {
    const from = requestsOf().length, m = (await say(await newChat(), words)).message;
    const first = requestsOf().slice(from).find(x => x.words === words && x.round === 0);
    const today = new Date(`${day(0)}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).replace(',', '');
    assert.ok(String(first.lastUser).includes(`\nToday on Spark 2: ${today} (${day(0)}).\n`), String(first.lastUser).slice(0, 1500));
    assert.ok(!first.system.includes(day(0)) && !JSON.stringify(first.tools).includes(day(0)), 'the day is in the system prompt or a tool');
    assert.deepEqual(m.tools.map(t => [t.name, t.outcome]), [['remember', 'remembered']]);
    assert.ok(m.content.includes(`(until ${dayWords(day(4))})`), m.content);
  } finally { script([]); fresh(); }
});

test('on a fixed clock, two turns a day apart: what the brain reads (the lock\'s mark) is the same, and only the record\'s day line differs', { timeout: 240000 * SLOW }, async () => {
  const marks = [], lines = [];
  for (const today of ['2026-11-20', '2026-11-21']) {
    const fleet = await startMock({ watchMs: 60000, statusMs: 60000, env: { SPARK_CONSOLE_TODAY: today } });
    try {
      marks.push(brainReadsOf(await brainSent(fleet)));
      lines.push(requestsOf(fleet.dir).map(x => String(x.lastUser).split('\n').find(l => l.startsWith('Today on Spark 2:'))).filter(Boolean).at(-1));
    } finally { await fleet.stop(); }
  }
  assert.equal(marks[0], marks[1]);
  assert.deepEqual(lines, ['Today on Spark 2: Friday 20 November 2026 (2026-11-20).', 'Today on Spark 2: Saturday 21 November 2026 (2026-11-21).']);
});
