// Covers: The box's bounds when there is more than one (21-box.mjs; R62; R2): the memory free on a Spark beyond the
// 8 GB kept must hold 4 GB for every box on record or opening there, the caller's own included. Of two opens at once
// on a Spark with room for one box, one opens and the other is refused, saying why; with room for two, a third is
// refused while two are open; a command in an open box is refused once the free memory has dropped below what the
// boxes there may take, and runs again once it is back. While the box's image is fetched (a slow stand-in fetch, longer
// than an open's 20-second wait for the lock), the next call is told it is being fetched at once, not that another box
// is opening. While the state put back from a copy is held (R23), an agent's call opens, fills, reads back, runs and
// writes in no box, with the hold's own words; the owner's own call still runs, and once the hold ends the agent's
// opens. Starts a stand-in fleet: run it on a Spark.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { T, useFleet, api, call, createActKey, sleep, waitFor, REPO, SLOW } from './lib.mjs';

const IMAGE = JSON.parse(readFileSync(join(REPO, 'service', 'config.json'), 'utf8')).work.images.python;
const K = {};
useFleet({ env: { SPARK_CONSOLE_BOX_FILL_DOOR: '1' }, prepare: ({ root }) => { for (const sp of ['spark3', 'spark4']) appendFileSync(join(root, sp, '.mock', 'images'), `\n${IMAGE}\n`); } },
  async () => { K.a = await createActKey('box-more-a'); K.b = await createActKey('box-more-b'); K.c = await createActKey('box-more-c'); });

const boxName = key => `spark-console-box-${createHash('sha256').update(key).digest('hex').slice(0, 12)}`;
const mock = spark => join(T.fleet.root, spark, '.mock');
const text = f => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
const boxLines = spark => text(join(mock(spark), 'containers')).split('\n').filter(l => l.split('|')[3] === 'box');
const folder = (name, spark = 'spark3') => join(T.fleet.root, spark, '.local/share/spark-console/work', name);
const own = command => api('/actions/run', { method: 'POST', body: { on: 'box', command } });
// What one caller's call answered: { opened, said } (said: the refusal's words).
const asOwner = async command => { const r = await own(command); return { r, ok: r.status === 200, box: r.json?.box, said: r.json?.error || r.text }; };
const asAgent = async (k, command) => { const r = await call(k.token, 'run', { on: 'box', command }); return { r, ok: r.isError === false, box: r.value?.box, said: r.text || r.raw }; };
// Spark 3's free memory (MemAvailable, in kB), as its stand-in /proc/meminfo says it.
let MEM0 = null;
const available = kB => { MEM0 ??= text(join(mock('spark3'), 'meminfo')); writeFileSync(join(mock('spark3'), 'meminfo'), MEM0.replace(/^MemAvailable:.*$/m, `MemAvailable:   ${kB} kB`)); };
const ROOM_ONE = 13107200, ROOM_TWO = 17825792;   // 12.5 GB (4 beyond the 8 kept) and 17 GB (9 beyond)
const short = (need, n, room) => `Spark 3 doesn’t have room for the box now: it needs ${need} GB free beyond the 8 GB kept for the system (4 GB for each of the ${n} boxes there, this one included), and ${room} GB is. Nothing ran.`;
after(() => { if (MEM0 !== null) writeFileSync(join(mock('spark3'), 'meminfo'), MEM0); });
// (Spark 4 off, so every box here is asked for on Spark 3)
const spark4Off = async () => { writeFileSync(T.fleet.offlineFile, 'spark1\nspark4\n'); await sleep(3500); };

let first = null;
test('two opens at once on a Spark with room for one box: one opens, the other is refused and says why', { timeout: 120000 * SLOW }, async () => {
  await spark4Off();
  available(ROOM_ONE);
  const [o, a] = await Promise.all([asOwner('true'), asAgent(K.a, 'true')]);
  assert.equal([o, a].filter(x => x.ok && x.box === 'opened').length, 1, `${o.r.text}\n${a.r.raw}`);
  const refused = o.ok ? a : o;
  assert.ok(!refused.ok, refused.said);
  assert.ok(refused.said.includes(short(8, 2, 4)), refused.said);
  assert.equal(boxLines('spark3').length, 1, boxLines('spark3').join('\n'));
  first = o.ok ? 'owner' : 'agent';
});

test('with room for two boxes, a third is refused while two are open', { timeout: 120000 * SLOW }, async () => {
  assert.ok(first, 'the first test opened one box');
  available(ROOM_TWO);
  const second = first === 'owner' ? await asAgent(K.a, 'true') : await asOwner('true');
  assert.deepEqual([second.ok, second.box], [true, 'opened'], second.said);
  assert.equal(boxLines('spark3').length, 2);
  const third = await asAgent(K.b, 'true');
  assert.ok(!third.ok, third.said);
  assert.ok(third.said.includes(short(12, 3, 9)), third.said);
  assert.equal(boxLines('spark3').length, 2, 'no third box');
});

test('a command in an open box is refused once free memory has dropped below what the boxes there may take, and runs once it is back', { timeout: 120000 * SLOW }, async () => {
  const mine = folder(boxName('api owner'));
  assert.ok(existsSync(mine), 'the owner’s box is open');
  available(ROOM_ONE);
  const r = await asOwner('touch ran.txt');
  assert.equal(r.r.status, 409, r.r.text);
  assert.equal(r.said, short(8, 2, 4));
  assert.ok(!existsSync(join(mine, 'ran.txt')), 'nothing ran');
  available(ROOM_TWO);
  const again = await asOwner('touch ran.txt');
  assert.deepEqual([again.ok, again.box, again.r.json?.exit], [true, 'open', 0], again.r.text);
  assert.ok(existsSync(join(mine, 'ran.txt')));
});

test('while the box’s image is fetched, the next call is told so at once, not that another box is opening', { timeout: 240000 * SLOW }, async () => {
  const images = join(mock('spark3'), 'images'), slow = join(mock('spark3'), 'slow-pull');
  writeFileSync(images, text(images).split('\n').filter(l => l && l !== IMAGE).map(l => `${l}\n`).join(''));
  writeFileSync(slow, '30\n');
  available(67108864);
  const FETCHED = 'The box’s image is being fetched to Spark 3 (once; a minute or two). Ask again then. No box opened, and nothing ran.';
  try {
    const first = await asAgent(K.b, 'true');
    assert.deepEqual([first.ok, first.box, first.r.value?.why], [true, 'not yet', FETCHED], first.said);
    const t0 = Date.now(), next = await asAgent(K.b, 'true'), ms = Date.now() - t0;
    assert.deepEqual([next.ok, next.box, next.r.value?.why], [true, 'not yet', FETCHED], next.said);
    assert.ok(ms < 15000, `answered at once, not after the open's 20-second wait for the lock (${ms} ms)`);
  } finally {
    rmSync(slow, { force: true });
    // (the fetches started here end by themselves, about 32 seconds after they began)
    await waitFor(() => text(images).split('\n').includes(IMAGE), { timeout: 120000, what: 'the slow fetch to end' });
    await sleep(5000);
  }
});

test('while the state put back from a copy is held, an agent opens, fills, reads back, runs and writes in no box; the owner’s own call runs', { timeout: 180000 * SLOW }, async () => {
  const HELD = 'Spark Console’s state was put back from a copy, so agents can’t change anything until the owner has looked at what came back, on the tailnet, and kept it.';
  const f = T.fleet.secretsFile, read = () => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {});
  const hold = on => { const s = read(), auth = { ...(s.auth || {}) }; if (on) auth.hold = { since: new Date().toISOString(), state: 'box-more test', again: [], signedOut: 0, parked: 0 }; else delete auth.hold; mkdirSync(dirname(f), { recursive: true, mode: 0o700 }); writeFileSync(f, JSON.stringify({ ...s, auth }), { mode: 0o600 }); };
  const aBox = folder(boxName(`agent ${K.a.id}`)), cBox = boxName(`agent ${K.c.id}`);
  assert.ok(existsSync(aBox), 'the first agent’s box is open');
  hold(true);
  try {
    await sleep(1500);   // (the hold is read again at most every half second)
    for (const [k, tool, args] of [[K.a, 'run', { on: 'box', command: 'touch held.txt' }], [K.a, 'write_file', { on: 'box', path: 'held.txt', text: 'x\n' }],
      [K.c, 'run', { on: 'box', command: 'true' }], [K.c, 'run', { on: 'box', command: `/fill ${'a'.repeat(40)}` }], [K.c, 'run', { on: 'box', command: '/read-back' }]]) {
      const r = await call(k.token, tool, args);
      assert.ok(r.isError && (r.text || '').includes(HELD), `${tool} ${JSON.stringify(args)}: ${r.raw}`);
    }
    assert.ok(!existsSync(join(aBox, 'held.txt')), 'nothing ran or was written in the open box');
    assert.ok(!boxLines('spark3').some(l => l.startsWith(`${cBox}|`)) && !boxLines('spark4').some(l => l.startsWith(`${cBox}|`)), 'no box opened');
    const o = await asOwner('true');
    assert.deepEqual([o.ok, o.box], [true, 'open'], o.said);
  } finally { hold(false); }
  await sleep(1500);
  const c = await asAgent(K.c, 'true');
  assert.deepEqual([c.ok, c.box], [true, 'opened'], c.said);
});
