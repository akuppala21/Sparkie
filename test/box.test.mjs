// Covers: The box (21-box.mjs; R62; design A 2.4, step A2): run {on: "box"} opens the caller's box, one a chat (or
// caller), on a compute Spark that is on: the first use fetches the pinned image (config.json work.images.python) and
// opens nothing; then the one docker run line, pinned here whole, word for word (the name, the label, the owner's ids,
// plain runc and NVIDIA_VISIBLE_DEVICES=void, no network or IPC, no capabilities, no new privileges, a read-only root,
// caps on memory, processes, CPU and file size, its own empty folder at /work and nothing else, sleep for its time,
// --rm); a command full of quotes and flags changes nothing in it, arguments other than on and command are refused,
// and on must be exactly "box". The answer says the box opened (or was open) and passed its check, and that nothing
// was run; it is a journal record. Its check from inside: each wall that gets through (all eleven, one at a time), a
// probe whose tool is missing ("can't tell") and a check that never answers remove the box and name why; the check
// itself, run on the test machine, reports each wall once, in order, then its end line, says what is open there, and
// says "can't tell" for each probe whose tool is gone. With Docker's daemon down nothing is swept and the answer says
// so; once it answers, the folders of boxes that are gone go. Opening a box is a change: Sparkie's and an agent's call
// are refused while changes are paused (the owner's own call is not), and with no eval on record Sparkie's call is one
// button whose press opens it. Never on Spark 2: with no compute Spark on, nothing opens anywhere; with Sparkie's model
// on Spark 3 it opens on Spark 4, never on Spark 3; a box whose Spark comes to hold the brain is removed there and
// opened elsewhere at its next use. It ends at its time (a new one opens after), at /stop in its chat (kept on record
// and said so while its Spark doesn't answer, removed once it does), at "/stop" from whoever opened it (the API, an
// agent key), and at "/stop <name>" from the owner's own call (not another agent's). The watcher and workloads leave
// out only a box the console knows (a container named and labelled like one, unknown to it, is listed); keep_running
// refuses a box's name. changeLabel names it, keys masked.
// The stand-in docker (test/mock/bin/docker) answers the check from the box's own run flags, and switch files open a
// wall, take a tool away or stop the daemon; what a real Spark's Docker grants is that Spark's own first check. Starts
// stand-in fleets: run it on a Spark.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync, statSync, readdirSync, appendFileSync, mkdtempSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { T, useFleet, api, call, createActKey, agentSettings, newChat, say, choose, waitFor, sleep, REPO, SLOW } from './lib.mjs';
import { startMock } from './start-mock.mjs';

useFleet({ watchMs: 2000 });
const IMAGE = JSON.parse(readFileSync(join(REPO, 'service', 'config.json'), 'utf8')).work?.images?.python;
const boxName = key => `spark-console-box-${createHash('sha256').update(key).digest('hex').slice(0, 12)}`;
const API_BOX = boxName('api owner');
const home = (spark, F = T.fleet) => join(F.root, spark);
const mock = (spark, F = T.fleet) => join(home(spark, F), '.mock');
const folder = (name, spark = 'spark3', F = T.fleet) => join(home(spark, F), '.local/share/spark-console/work', name);
const text = f => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
const boxLines = (spark, F) => text(join(mock(spark, F), 'containers')).split('\n').filter(l => l.split('|')[3] === 'box');
const hasBox = (spark, name, F) => boxLines(spark, F).some(l => l.startsWith(`${name}|`));
const boxRuns = (spark, F) => { try { return readdirSync(mock(spark, F)).filter(f => /^run-spark-console-box-/.test(f)); } catch { return []; } };
const args = (spark, name, F) => text(join(mock(spark, F), `run-${name}`)).split('\n').slice(0, -1);
const lines = f => text(f).split('\n').filter(Boolean).map(l => JSON.parse(l));
const journal = (F = T.fleet) => readdirSync(F.journalDir).filter(f => f.endsWith('.jsonl')).flatMap(f => lines(join(F.journalDir, f)));
// The one line, word for word as docker gets it (after "run").
const LINE = (name, at, seconds = 7200) => ['--detach', '--rm', '--pull', 'never', '--name', name, '--label', `spark-console.box=${name}`,
  '--user', `${process.getuid()}:${process.getgid()}`, '--runtime', 'runc', '--network', 'none', '--ipc', 'none', '--cap-drop', 'ALL',
  '--security-opt', 'no-new-privileges', '--read-only', '--memory', '4g', '--memory-swap', '4g', '--pids-limit', '256', '--cpus', '4',
  '--ulimit', 'fsize=1073741824:1073741824', '--mount', `type=bind,src=${at}/.local/share/spark-console/work/${name},dst=/work`, '--workdir', '/work',
  '--env', 'HOME=/work', '--env', 'TMPDIR=/work', '--env', 'NVIDIA_VISIBLE_DEVICES=void', '--entrypoint', 'sleep', IMAGE, String(seconds)];
const WORDS = 'not root, no capabilities, no new privileges, nothing writable but its own folder, nothing of the Spark mounted but that folder, no socket, no key handed in, no network, no device beyond Docker’s own and no GPU';
const asF = F => ({ 'content-type': 'application/json', 'x-spark-console': '1', origin: F.origin });
const act = (name, body, F = null) => (F ? fetch(`${F.base}/actions/${name}`, { method: 'POST', headers: asF(F), body: JSON.stringify(body) })
  .then(async r => { const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch {} return { status: r.status, json, text: t }; }) : api(`/actions/${name}`, { method: 'POST', body }));
// A box ended by itself, as its time does (the stand-in's container gone): the console's next call opens another.
const ended = (name, spark = 'spark3', F = T.fleet) => {
  const f = join(mock(spark, F), 'containers');
  writeFileSync(f, text(f).split('\n').filter(l => l && !l.startsWith(`${name}|`)).map(l => `${l}\n`).join(''));
  rmSync(join(mock(spark, F), `box-until-${name}`), { force: true });
};
const script = (rules, F = T.fleet) => writeFileSync(join(F.dir, 'model-script.json'), JSON.stringify(rules));
const noScript = (F = T.fleet) => rmSync(join(F.dir, 'model-script.json'), { force: true });
// Sparkie's call in a chat: what the brain was handed back for it, and the reply.
async function inChat(chat, words, args) {
  script([{ match: `^${words}$`, calls: [{ name: 'run', arguments: args }] }]);
  let d;
  try { d = await say(chat, words); } finally { noScript(); }
  const sent = lines(join(T.fleet.dir, 'model-requests.jsonl')).filter(x => x.words === words && x.lastRole === 'tool').at(-1)?.results?.[0]?.content;
  assert.equal(typeof sent, 'string', JSON.stringify(d.tools));
  return { d, sent, value: sent.startsWith('[error] ') ? null : JSON.parse(sent) };
}
const later = [];
after(async () => { for (const F of later) await F.stop().catch(() => {}); });

test('the first use fetches the pinned image and opens nothing; then the box opens on Spark 3 with exactly the one line, passes its check, and nothing runs', { timeout: 120000 * SLOW }, async () => {
  assert.match(IMAGE, /^python:3\.12-slim@sha256:[0-9a-f]{64}$/);
  const first = await act('run', { on: 'box', command: 'echo hi > /work/x' });
  assert.equal(first.status, 200, first.text);
  assert.deepEqual([first.json.box, first.json.spark, first.json.ran], ['not yet', 'spark3', false]);
  assert.equal(first.json.why, 'The box’s image is being fetched to Spark 3 (once; a minute or two). Ask again then. No box opened, and nothing ran.');
  assert.deepEqual(boxLines('spark3'), []);
  await waitFor(() => text(join(mock('spark3'), 'images')).split('\n').includes(IMAGE), { what: 'the image fetched' });
  const r = await act('run', { on: 'box', command: 'echo hi > /work/x' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.json.box, r.json.spark, r.json.name, r.json.ran], ['opened', 'spark3', API_BOX, false]);
  assert.match(r.json.why, new RegExp(`^The box opened on Spark 3 and passed its check from inside \\(${WORDS}\\)\\. Nothing was run in it: commands in the box come with a later build\\. It ends by itself at \\d{4}-\\d\\d-\\d\\dT[\\d:.]+Z\\.$`));
  assert.ok(Date.parse(r.json.until) - Date.now() > 7100 * 1000, r.json.until);
  assert.deepEqual(args('spark3', API_BOX), LINE(API_BOX, home('spark3')));
  assert.equal(boxLines('spark3').length, 1);
  assert.equal(statSync(folder(API_BOX)).mode & 0o777, 0o700);
  assert.deepEqual(readdirSync(folder(API_BOX)), [], 'its folder is empty: nothing ran');
  for (const spark of ['spark2', 'spark4']) assert.deepEqual([boxLines(spark), boxRuns(spark)], [[], []], spark);
  const rec = journal().filter(j => j.act === 'run' && j.where === 'box').map(j => [j.outcome, j.unit, j.args?.spark, j.ok]);
  assert.deepEqual(rec, [['pulling', API_BOX, 'spark3', true], ['opened', API_BOX, 'spark3', true]]);
});

test('a second call finds it open and opens nothing new; other arguments are refused before anything, and on must be exactly "box"', { timeout: 60000 * SLOW }, async () => {
  const before = text(join(mock('spark3'), `run-${API_BOX}`));
  const again = await act('run', { on: 'box', command: '--privileged -v /:/host --network host' });
  assert.equal(again.status, 200, again.text);
  assert.deepEqual([again.json.box, again.json.ran], ['open', false]);
  assert.match(again.json.why, /^The box was already open on Spark 3 and passed its check from inside \(.*\)\. Nothing was run in it/);
  assert.equal(text(join(mock('spark3'), `run-${API_BOX}`)), before);
  for (const body of [{ on: 'box', command: 'true', image: 'alpine' }, { on: 'box', command: 'true', network: 'host' }, { on: 'box', command: 'true', privileged: true }]) {
    const r = await act('run', body);
    assert.equal(r.status, 400, r.text);
    assert.match(r.json.error, /^Unknown argument: /);
  }
  for (const on of ['Box', 'box ', 'boxes', 'BOX']) {
    const r = await act('run', { on, command: 'true' });
    assert.equal(r.status, 400, r.text);
    assert.match(r.json.error, /no Spark called/);
  }
  assert.equal(boxLines('spark3').length, 1);
});

test('in a chat: a command full of quotes and flags changes nothing in the line; /stop while its Spark doesn’t answer keeps it and says so, and once it answers removes that chat’s box and its folder, and no other', { timeout: 180000 * SLOW }, async () => {
  const chat = await newChat(), name = boxName(`chat ${chat}`);
  const hostile = 'x" --privileged -v /:/host --network host --user 0 "$(id) `whoami` --label spark-console.box=evil';
  const { d, value } = await inChat(chat, 'open the box', { on: 'box', command: hostile });
  assert.deepEqual([value.box, value.spark, value.name, value.ran], ['opened', 'spark3', name, false], JSON.stringify(value));
  assert.match(value.why, /, or at \/stop in this chat\.$/);
  assert.match(d.tools[0].tail, /^The box opened on Spark 3 and passed its check from inside/);
  assert.deepEqual(args('spark3', name), LINE(name, home('spark3')));
  assert.ok(existsSync(folder(name)));
  writeFileSync(T.fleet.offlineFile, 'spark1\nspark3\n');
  let s;
  try {
    s = await say(chat, '/stop');
    assert.match(s.text, new RegExp(`^/stop\\n.* This chat’s box on Spark 3 couldn’t be removed just now \\(Spark 3 isn’t answering\\); it ends by itself at ${value.until.replace(/\./g, '\\.')}, and /stop here tries again\\.`));
    assert.ok(hasBox('spark3', name) && existsSync(folder(name)), 'still there');
  } finally { writeFileSync(T.fleet.offlineFile, 'spark1\n'); }
  await waitFor(async () => { s = await say(chat, '/stop'); return /was removed/.test(s.text); }, { timeout: 60000 * SLOW, every: 2000, what: 'the second /stop' });
  assert.match(s.text, /^\/stop\n.* This chat’s box on Spark 3 was removed, with its folder\. /);
  assert.ok(!hasBox('spark3', name) && !existsSync(folder(name)), 'the chat’s box and its folder went');
  assert.ok(hasBox('spark3', API_BOX), 'the API’s box stays');
  const recs = journal().filter(j => j.where === 'box' && j.unit === name && j.chat === chat).map(j => [j.outcome, j.ok]);
  assert.deepEqual([recs[0], recs.at(-1)], [['opened', true], ['removed', true]]);
  assert.ok(recs.some(([o, ok]) => o === 'not-removed' && !ok), JSON.stringify(recs));
  assert.match((await say(chat, '/stop')).text, /^\/stop\nSparkie isn’t answering in this chat and has nothing to carry on with, so there was nothing to stop\./);
});

test('its check from inside: each wall that gets through, a probe it can’t tell, and a check that never answers remove the box and say why; nothing opens', { timeout: 180000 * SLOW }, async () => {
  const WALLS = { root: 'it runs as root', caps: 'it holds capabilities', privileges: 'it may gain privileges', writes: 'it can write outside its folder',
    work: 'its own folder is not writable', mounts: 'more of the Spark is mounted than its folder', home: 'the owner’s home is visible',
    sockets: 'a socket is visible (Docker’s, Tailscale’s or another)', secrets: 'a key was handed in', network: 'it has a network',
    devices: 'a device beyond Docker’s own, or an NVIDIA library, is there' };
  ended(API_BOX);
  const refused = async (words, what) => {
    const r = await act('run', { on: 'box', command: 'true' });
    assert.equal(r.status, 409, `${what}: ${r.text}`);
    assert.equal(r.json.error, `The box on Spark 3 failed its check from inside and was removed: ${words}. Nothing ran.`);
    assert.deepEqual(boxLines('spark3'), [], what);
    assert.ok(!existsSync(folder(API_BOX)), `${what}: its folder went`);
  };
  for (const [wall, words] of Object.entries(WALLS)) {
    writeFileSync(join(mock('spark3'), `box-open-${wall}`), '');
    try { await refused(words, wall); } finally { rmSync(join(mock('spark3'), `box-open-${wall}`), { force: true }); }
  }
  writeFileSync(join(mock('spark3'), 'box-missing-root'), 'id');
  try { await refused('the check can’t tell for “root”: id is missing in the box', 'no id'); } finally { rmSync(join(mock('spark3'), 'box-missing-root'), { force: true }); }
  writeFileSync(join(mock('spark3'), 'box-check-dies'), '');
  try { await refused('its check didn’t finish (OCI runtime exec failed: exec failed: unable to start container process)', 'no answer'); } finally { rmSync(join(mock('spark3'), 'box-check-dies'), { force: true }); }
  assert.equal(journal().filter(j => j.where === 'box' && j.outcome === 'walls' && !j.ok).length, 13);
});

test('with Docker’s daemon down nothing is swept and the answer says so; once it answers, the folders of boxes that are gone go', { timeout: 120000 * SLOW }, async () => {
  const GONE = 'spark-console-box-aaaaaaaaaaaa';
  mkdirSync(folder(GONE), { recursive: true, mode: 0o700 });
  writeFileSync(join(mock('spark3'), 'daemon-down'), '');
  try {
    const r = await act('run', { on: 'box', command: 'true' });
    assert.equal(r.status, 503, r.text);
    assert.equal(r.json.error, 'Docker isn’t answering on Spark 3, so no box opened. Nothing ran.');
    assert.ok(existsSync(folder(GONE)), 'nothing was swept');
  } finally { rmSync(join(mock('spark3'), 'daemon-down'), { force: true }); }
  const r = await act('run', { on: 'box', command: 'true' });
  assert.deepEqual([r.status, r.json.box, r.json.spark], [200, 'opened', 'spark3'], r.text);
  assert.ok(!existsSync(folder(GONE)), 'the gone box’s folder went');
  assert.ok(existsSync(folder(API_BOX)));
});

test('the pause: Sparkie’s and an agent’s call open no box while changes are paused; the owner’s own call does, and /stop is never paused', { timeout: 120000 * SLOW }, async () => {
  const key = await createActKey('box-agent');
  const PAUSED = 'Agents’ changes are paused (your account menu → Agents and Telegram), and opening a box is a change, so no box opened. Nothing ran.';
  await agentSettings({ halted: true });
  try {
    const chat = await newChat();
    const { sent } = await inChat(chat, 'open the box while paused', { on: 'box', command: 'true' });
    assert.equal(sent, `[error] ${PAUSED}`);
    assert.ok(!hasBox('spark3', boxName(`chat ${chat}`)));
    const door = await call(key.token, 'run', { on: 'box', command: 'true' });
    assert.ok(door.isError, door.raw);
    assert.match(door.text, new RegExp(PAUSED.replace(/[()]/g, '\\$&')));
    assert.ok(!hasBox('spark3', boxName(`agent ${key.id}`)));
    const own = await act('run', { on: 'box', command: 'true' });
    assert.deepEqual([own.status, own.json.box], [200, 'open'], own.text);
    assert.ok(journal().filter(j => j.where === 'box' && j.outcome === 'refused' && /are paused/.test(j.err || '')).length >= 2);
  } finally { await agentSettings({ halted: false }); }
});

test('removal: "/stop" from whoever opened it (the API, an agent key), "/stop <name>" from the owner’s own call, never from another agent', { timeout: 120000 * SLOW }, async () => {
  const key = await createActKey('box-stop'), mine = boxName(`agent ${key.id}`);
  const opened = await call(key.token, 'run', { on: 'box', command: 'true' });
  assert.equal(opened.value?.box, 'opened', opened.raw);
  assert.equal(opened.value.name, mine);
  const other = await call(key.token, 'run', { on: 'box', command: `/stop ${API_BOX}` });
  assert.ok(other.isError, other.raw);
  assert.match(other.text, /Only the owner’s own call, or whoever opened it, removes a box\. Nothing was removed\./);
  assert.ok(hasBox('spark3', API_BOX));
  const self = await call(key.token, 'run', { on: 'box', command: '/stop' });
  assert.deepEqual([self.value?.box, self.value?.name], ['removed', mine], self.raw);
  assert.equal(self.value.why, 'The box on Spark 3 was removed, with its folder.');
  assert.ok(!hasBox('spark3', mine) && !existsSync(folder(mine)));
  assert.equal((await call(key.token, 'run', { on: 'box', command: 'true' })).value?.box, 'opened');
  const byOwner = await act('run', { on: 'box', command: `/stop ${mine}` });
  assert.deepEqual([byOwner.status, byOwner.json.box, byOwner.json.name], [200, 'removed', mine], byOwner.text);
  assert.ok(!hasBox('spark3', mine));
  const api1 = await act('run', { on: 'box', command: '/stop' });
  assert.deepEqual([api1.json.box, api1.json.name], ['removed', API_BOX], api1.text);
  assert.ok(!hasBox('spark3', API_BOX) && !existsSync(folder(API_BOX)));
  const none = await act('run', { on: 'box', command: '/stop' });
  assert.deepEqual([none.json.box, none.json.why], ['none', 'There’s no box of yours open now. Nothing was removed.']);
});

test('never on Spark 2: with no compute Spark on, nothing opens anywhere', { timeout: 120000 * SLOW }, async () => {
  writeFileSync(T.fleet.offlineFile, 'spark1\nspark3\nspark4\n');
  try {
    const r = await act('run', { on: 'box', command: 'true' });
    assert.equal(r.status, 503, r.text);
    assert.equal(r.json.error, 'No compute Spark is on to hold a box: Spark 1, Spark 3 and Spark 4 are off or not answering (a box never opens on Spark 2 or on the brain’s Spark, and it wakes nothing). Nothing ran.');
    assert.deepEqual([boxLines('spark2'), boxRuns('spark2')], [[], []]);
  } finally { writeFileSync(T.fleet.offlineFile, 'spark1\n'); }
  await waitFor(async () => (await act('run', { on: 'box', command: 'true' })).json?.box === 'opened', { timeout: 60000 * SLOW, every: 2000, what: 'the box open again' });
});

test('the watcher and workloads leave out only a box the console knows; one only named and labelled like a box is listed; keep_running refuses a box’s name', { timeout: 120000 * SLOW }, async () => {
  const DECOY = 'spark-console-box-0123456789ab', at = ['spark3', 'spark4'].find(s => hasBox(s, API_BOX));
  assert.ok(at, 'the API’s box is open');
  appendFileSync(join(mock(at), 'containers'), `${DECOY}|running|Up 1 second|box||||||\n`);
  try {
    let list;
    await waitFor(async () => { list = (await act('workloads', { spark: at })).json?.workloads || []; return list.some(w => w.name === DECOY); }, { what: 'the watcher’s next look' });
    assert.ok(!list.some(w => w.name === API_BOX), JSON.stringify(list.map(w => w.name)));
    const known = JSON.parse(text(join(T.fleet.stateDir, 'knowledge.json')) || '{}').workloads || {};
    assert.ok(!Object.keys(known).some(k => k.includes(API_BOX)), Object.keys(known).join(' '));
  } finally { ended(DECOY, at); }
  const kr = await act('keep_running', { spark: 'spark4', container: DECOY, image: 'nginx:1.27', port: '18080:80' });
  assert.equal(kr.status, 400, kr.text);
  assert.equal(kr.json.error, 'Names beginning spark-console-box- are the box’s (R62): choose another name. Nothing was started.');
  assert.ok(!text(join(mock('spark4'), 'containers')).includes(DECOY));
});

test('with Sparkie’s model on Spark 3, the box opens on Spark 4 and never on Spark 3; it ends at its time, and the next call opens another', { timeout: 180000 * SLOW }, async () => {
  const SECONDS = 4;
  const F = await startMock({ watchMs: 600000, statusMs: 600000, env: { SPARK_CONSOLE_BOX_SECONDS: String(SECONDS) }, prepare: ({ root, stateDir }) => {
    const f = join(stateDir, 'main.json'), m = JSON.parse(readFileSync(f, 'utf8'));
    m.presets[m.current].node = 'spark3';
    writeFileSync(f, JSON.stringify(m), { mode: 0o600 });
    for (const spark of ['spark3', 'spark4']) appendFileSync(join(root, spark, '.mock', 'images'), `\n${IMAGE}\n`);
  } });
  later.push(F);
  const r = await act('run', { on: 'box', command: 'true' }, F);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.json.box, r.json.spark], ['opened', 'spark4']);
  assert.deepEqual(args('spark4', API_BOX, F), LINE(API_BOX, home('spark4', F), SECONDS));
  assert.deepEqual([boxLines('spark3', F), boxRuns('spark3', F)], [[], []]);
  // (its sleep ends and --rm takes it: the stand-in finds it gone at its next docker command)
  await sleep((SECONDS + 1) * 1000);
  spawnSync(join(REPO, 'test', 'mock', 'bin', 'docker'), ['ps', '-a', '--format', 'ctr'], { env: { ...process.env, HOME: home('spark4', F) } });
  assert.deepEqual(boxLines('spark4', F), []);
  const next = await act('run', { on: 'box', command: 'true' }, F);
  assert.deepEqual([next.json.box, next.json.spark], ['opened', 'spark4'], next.text);
  writeFileSync(F.offlineFile, 'spark1\nspark4\n');
  const none = await act('run', { on: 'box', command: 'true' }, F);
  assert.equal(none.status, 503, none.text);
  assert.equal(none.json.error, 'No compute Spark is on to hold a box: Spark 1 and Spark 4 are off or not answering (a box never opens on Spark 2 or on the brain’s Spark, and it wakes nothing). Nothing ran.');
  for (const spark of ['spark2', 'spark3']) assert.deepEqual([boxLines(spark, F), boxRuns(spark, F)], [[], []], spark);
  await F.stop();
});

test('opening a box is a change: with no eval on record Sparkie’s call is one button and the owner’s press opens it, the owner’s own call opens at once, and a box whose Spark comes to hold the brain goes from there at its next use', { timeout: 420000 * SLOW }, async () => {
  const F = await startMock({ watchMs: 600000, evalOnRecord: false, prepare: ({ root, stateDir }) => {
    const f = join(stateDir, 'main.json'), m = JSON.parse(readFileSync(f, 'utf8'));
    m.presets['box-s3'] = { ...m.presets[m.current], node: 'spark3', title: 'Aphex on Spark 3' };
    writeFileSync(f, JSON.stringify(m), { mode: 0o600 });
    for (const spark of ['spark3', 'spark4']) appendFileSync(join(root, spark, '.mock', 'images'), `\n${IMAGE}\n`);
  } });
  later.push(F);
  const at = async path => { const r = await fetch(`${F.base}${path}`, { headers: asF(F) }); return r.json(); };
  const post = async (path, body) => { const r = await fetch(`${F.base}${path}`, { method: 'POST', headers: asF(F), body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => null) }; };
  const chat = (await post('/chats', {})).json.id, words = 'open a box for me';
  script([{ match: `^${words}$`, calls: [{ name: 'run', arguments: { on: 'box', command: 'true' } }] }], F);
  const r = await fetch(`${F.base}/chats/${chat}/messages`, { method: 'POST', headers: asF(F), body: JSON.stringify({ text: words }) });
  noScript(F);
  const done = (await r.text()).split('\n\n').map(b => b.trim()).filter(b => b.startsWith('data:')).map(b => JSON.parse(b.slice(5))).find(e => e.type === 'done');
  const choices = done.message.choices || [];
  assert.equal(choices.length, 1, JSON.stringify(done.message));
  assert.equal(choices[0].label, 'Open the box (a throw-away container on a compute Spark: no network, nothing of the Spark but its own folder) for: true');
  assert.deepEqual(boxLines('spark3', F), [], 'nothing opened before the press');
  const pressed = await post(`/chats/${chat}/choose`, { choice: choices[0].id });
  assert.equal(pressed.status, 200, JSON.stringify(pressed.json));
  assert.deepEqual([pressed.json.box, pressed.json.spark], ['opened', 'spark3'], JSON.stringify(pressed.json));
  assert.ok(hasBox('spark3', boxName(`chat ${chat}`), F));
  assert.ok(journal(F).some(j => j.where === 'box' && j.outcome === 'asked' && j.chat === chat));
  const own = await act('run', { on: 'box', command: 'true' }, F);
  assert.deepEqual([own.status, own.json.box, own.json.spark], [200, 'opened', 'spark3'], own.text);
  // Sparkie's model moves to Spark 3: the API's box there goes at its next use, and opens on Spark 4.
  const sw = await post('/main/use', { preset: 'box-s3' });
  assert.equal(sw.status, 202, JSON.stringify(sw.json));
  const job = await waitFor(async () => { const j = await at(`/jobs/${sw.json.id}`); return j.status !== 'running' && j; }, { timeout: 300000 * SLOW, every: 2000, what: 'the switch' });
  assert.equal(job.status, 'completed', JSON.stringify(job.log));
  const moved = await act('run', { on: 'box', command: 'true' }, F);
  assert.deepEqual([moved.status, moved.json.box, moved.json.spark], [200, 'opened', 'spark4'], moved.text);
  assert.ok(!hasBox('spark3', API_BOX, F) && !existsSync(folder(API_BOX, 'spark3', F)), 'gone from Spark 3');
  assert.ok(hasBox('spark4', API_BOX, F));
  await F.stop();
});

test('the check itself, run on this machine (no walls here): each of the eleven walls once, after the id, in order, then its end line; what is open here is said, and a probe whose tool is gone says it can’t tell', { skip: process.getuid() === 0 && 'run as root, its write test would write in / and /etc', timeout: 60000 * SLOW }, async () => {
  const check = /const BOX_CHECK = String\.raw`([\s\S]*?)`;/.exec(readFileSync(join(REPO, 'service', 'src', '21-box.mjs'), 'utf8'))[1];
  const NAMES = ['root', 'caps', 'privileges', 'writes', 'work', 'mounts', 'home', 'sockets', 'secrets', 'network', 'devices'];
  const where = t => spawnSync('sh', ['-c', `command -v ${t}`], { encoding: 'utf8' }).stdout.trim();
  // (two folders of tools: all it uses, with a find that finds nothing, since the real one would walk this machine's
  // whole disk; and the same without id, find and timeout)
  const all = mkdtempSync(join(tmpdir(), 'box-bin-')), some = mkdtempSync(join(tmpdir(), 'box-bin-'));
  for (const t of ['bash', 'id', 'awk', 'sort', 'grep', 'rm', 'tr', 'head', 'cut', 'env', 'ls', 'timeout']) symlinkSync(where(t), join(all, t));
  writeFileSync(join(all, 'find'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  for (const t of ['bash', 'awk', 'sort', 'grep', 'rm', 'tr', 'head', 'cut', 'env', 'ls']) symlinkSync(where(t), join(some, t));
  const runIt = bin => { const r = spawnSync(join(bin, 'bash'), ['-c', check, 'box-check', 'c0ffee', '/no/such/home', '127.0.0.1', '9'], { encoding: 'utf8', timeout: 30000 * SLOW, env: { PATH: bin, HOME: bin } }); return { out: r.stdout.trim().split('\n'), all: r.stdout + r.stderr }; };
  try {
    const a = runIt(all);
    assert.deepEqual(a.out.map(l => l.split(' ').slice(0, 3).join(' ')), [...NAMES.map(w => `c0ffee wall ${w}`), 'c0ffee walls end'], a.all);
    assert.equal(a.out[0], 'c0ffee wall root ok');
    assert.match(a.out[3], /^c0ffee wall writes open .*\/tmp/);
    assert.equal(a.out[4], 'c0ffee wall work open');
    assert.match(a.out[5], /^c0ffee wall mounts open /);
    assert.equal(a.out[6], 'c0ffee wall home ok');
    assert.equal(a.out[8], 'c0ffee wall secrets ok');
    // (network and devices: open on a machine with them; the test runner's own container may have neither)
    assert.match(a.out[9], /^c0ffee wall network (?:ok|open .+)$/);
    assert.match(a.out[10], /^c0ffee wall devices (?:ok|open .+)$/);
    const b = runIt(some);
    assert.deepEqual(b.out.map(l => l.split(' ').slice(0, 3).join(' ')), [...NAMES.map(w => `c0ffee wall ${w}`), 'c0ffee walls end'], b.all);
    assert.deepEqual([b.out[0], b.out[7], b.out[9]], ['c0ffee wall root open can\'t tell: id is missing', 'c0ffee wall sockets open can\'t tell: find is missing', 'c0ffee wall network open can\'t tell: timeout is missing']);
  } finally { rmSync(all, { recursive: true, force: true }); rmSync(some, { recursive: true, force: true }); }
});

test('changeLabel names the box, the command whole and keys masked', async () => {
  const src = readFileSync(join(REPO, 'service', 'src', '17-changes.mjs'), 'utf8');
  const fn = src.slice(src.indexOf('function changeLabel('), src.indexOf('\n}\n', src.indexOf('function changeLabel(')) + 2);
  const changeLabel = new Function('maskSecrets', `${fn}\nreturn changeLabel;`)(s => s.replace(/hf_[A-Za-z0-9]{20,}/g, '[hidden]'));
  assert.equal(changeLabel('run', { on: 'box', command: 'python3 fetch.py --token hf_abcdefghijklmnopqrstuvwxyz' }),
    'Open the box (a throw-away container on a compute Spark: no network, nothing of the Spark but its own folder) for: python3 fetch.py --token [hidden]');
});
