// Covers: The box (21-box.mjs; R62; design A 2.4, step A2): run {on: "box"} opens the caller's box, one a chat (or
// caller), on a compute Spark that is on: the first use fetches the pinned image (config.json work.images.python) and
// opens nothing; then the one docker run line, pinned here whole, word for word (the name, the label, the owner's ids,
// no network or IPC, no capabilities, no new privileges, a read-only root, caps on memory, processes, CPU and file
// size, its own empty folder at /work and nothing else, sleep for its time, --rm); a command full of quotes and flags
// changes nothing in it, arguments other than on and command are refused, and on must be exactly "box". The answer
// says the box opened (or was open) and passed its check, and that nothing was run; it is a journal record. Its check
// from inside: each wall that gets through (all ten, one at a time) and a check that never answers removes the box and
// names what got through; the check itself, run on the test machine, reports each wall once, in order, then its end
// line, and says what is open there (its own folder missing, other places writable). Never on Spark 2: with no compute Spark on, nothing opens anywhere; with Sparkie's model on
// Spark 3 it opens on Spark 4, never on Spark 3. It ends at its time (a new one opens after) and at /stop in its chat
// (the container and its folder, the other box left). The watcher and workloads leave it out by its label (a container
// only named like one is listed). changeLabel names it, keys masked.
// The stand-in docker (test/mock/bin/docker) answers the check from the box's own run flags, and a switch file opens one
// wall; what a real Spark's Docker grants is that Spark's own first check. Starts stand-in fleets: run it on a Spark.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync, statSync, readdirSync, appendFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { T, useFleet, api, newChat, say, waitFor, sleep, REPO, SLOW } from './lib.mjs';
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
const boxRuns = (spark, F) => { try { return readdirSync(mock(spark, F)).filter(f => /^run-spark-console-box-/.test(f)); } catch { return []; } };
const args = (spark, name, F) => text(join(mock(spark, F), `run-${name}`)).split('\n').slice(0, -1);
const lines = f => text(f).split('\n').filter(Boolean).map(l => JSON.parse(l));
const journal = (F = T.fleet) => readdirSync(F.journalDir).filter(f => f.endsWith('.jsonl')).flatMap(f => lines(join(F.journalDir, f)));
// The one line, word for word as docker gets it (after "run").
const LINE = (name, at, seconds = 7200) => ['--detach', '--rm', '--pull', 'never', '--name', name, '--label', `spark-console.box=${name}`,
  '--user', `${process.getuid()}:${process.getgid()}`, '--network', 'none', '--ipc', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
  '--read-only', '--memory', '4g', '--memory-swap', '4g', '--pids-limit', '256', '--cpus', '4', '--ulimit', 'fsize=1073741824:1073741824',
  '--mount', `type=bind,src=${at}/.local/share/spark-console/work/${name},dst=/work`, '--workdir', '/work', '--env', 'HOME=/work', '--env', 'TMPDIR=/work',
  '--entrypoint', 'sleep', IMAGE, String(seconds)];
const act = (name, body, F = null) => (F ? fetch(`${F.base}/actions/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-spark-console': '1', origin: F.origin }, body: JSON.stringify(body) })
  .then(async r => { const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch {} return { status: r.status, json, text: t }; }) : api(`/actions/${name}`, { method: 'POST', body }));
// A box ended by itself, as its time does (the stand-in's container gone): the console's next call opens another.
const ended = (name, spark = 'spark3') => {
  const f = join(mock(spark), 'containers');
  writeFileSync(f, text(f).split('\n').filter(l => l && !l.startsWith(`${name}|`)).map(l => `${l}\n`).join(''));
  rmSync(join(mock(spark), `box-until-${name}`), { force: true });
};
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const noScript = () => rmSync(join(T.fleet.dir, 'model-script.json'), { force: true });
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
  assert.deepEqual([r.json.box, r.json.spark, r.json.ran], ['opened', 'spark3', false]);
  assert.match(r.json.why, /^The box opened on Spark 3 and passed its check from inside \(not root, no capabilities, no new privileges, nothing writable but its own folder, nothing of the Spark mounted but that folder, no socket, no key handed in, no network\)\. Nothing was run in it: commands in the box come with a later build\. It ends by itself at \d{4}-\d\d-\d\dT[\d:.]+Z\.$/);
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

test('in a chat: a command full of quotes and flags changes nothing in the line, and /stop removes that chat’s box and its folder, and no other', { timeout: 120000 * SLOW }, async () => {
  const chat = await newChat(), name = boxName(`chat ${chat}`);
  const hostile = 'x" --privileged -v /:/host --network host --user 0 "$(id) `whoami` --label spark-console.box=evil';
  script([{ match: '^open the box$', calls: [{ name: 'run', arguments: { on: 'box', command: hostile } }] }]);
  let d;
  try { d = await say(chat, 'open the box'); } finally { noScript(); }
  const sent = lines(join(T.fleet.dir, 'model-requests.jsonl')).filter(x => x.words === 'open the box' && x.lastRole === 'tool').at(-1)?.results?.[0]?.content;
  const value = JSON.parse(sent);
  assert.deepEqual([value.box, value.spark, value.ran], ['opened', 'spark3', false], sent);
  assert.match(value.why, /, or at \/stop in this chat\.$/);
  assert.match(d.tools[0].tail, /^The box opened on Spark 3 and passed its check from inside/);
  assert.deepEqual(args('spark3', name), LINE(name, home('spark3')));
  assert.ok(existsSync(folder(name)));
  const s = await say(chat, '/stop');
  assert.match(s.text, /^\/stop\n.* This chat’s box on Spark 3 is being removed, with its folder\. /);
  await waitFor(() => !boxLines('spark3').some(l => l.startsWith(`${name}|`)) && !existsSync(folder(name)), { what: 'the chat’s box removed' });
  assert.ok(boxLines('spark3').some(l => l.startsWith(`${API_BOX}|`)), 'the API’s box stays');
  await waitFor(() => journal().some(j => j.where === 'box' && j.outcome === 'removed' && j.unit === name && j.chat === chat && j.ok), { what: 'its removal in the journal' });
  assert.match((await say(chat, '/stop')).text, /^\/stop\nSparkie isn’t answering in this chat and has nothing to carry on with, so there was nothing to stop\./);
});

test('its check from inside: each wall that gets through, and a check that never answers, removes the box and names what got through; nothing opens', { timeout: 180000 * SLOW }, async () => {
  const WALLS = { root: 'it runs as root', caps: 'it holds capabilities', privileges: 'it may gain privileges', writes: 'it can write outside its folder',
    work: 'its own folder is not writable', mounts: 'more of the Spark is mounted than its folder', home: 'the owner’s home is visible',
    sockets: 'a socket is visible (Docker’s, Tailscale’s or another)', secrets: 'a key was handed in', network: 'it has a network' };
  ended(API_BOX);
  for (const [wall, words] of Object.entries(WALLS)) {
    writeFileSync(join(mock('spark3'), `box-open-${wall}`), '');
    try {
      const r = await act('run', { on: 'box', command: 'true' });
      assert.equal(r.status, 409, `${wall}: ${r.text}`);
      assert.equal(r.json.error, `The box on Spark 3 failed its check from inside and was removed: ${words}. Nothing ran.`);
      assert.deepEqual(boxLines('spark3'), [], wall);
      assert.ok(!existsSync(folder(API_BOX)), `${wall}: its folder went`);
    } finally { rmSync(join(mock('spark3'), `box-open-${wall}`), { force: true }); }
  }
  writeFileSync(join(mock('spark3'), 'box-check-dies'), '');
  try {
    const r = await act('run', { on: 'box', command: 'true' });
    assert.equal(r.status, 409, r.text);
    assert.equal(r.json.error, 'The box on Spark 3 failed its check from inside and was removed: its check didn’t finish (OCI runtime exec failed: exec failed: unable to start container process). Nothing ran.');
    assert.deepEqual(boxLines('spark3'), []);
  } finally { rmSync(join(mock('spark3'), 'box-check-dies'), { force: true }); }
  assert.equal(journal().filter(j => j.where === 'box' && j.outcome === 'walls' && !j.ok).length, 11);
});

test('never on Spark 2: with no compute Spark on, nothing opens anywhere', { timeout: 120000 * SLOW }, async () => {
  writeFileSync(T.fleet.offlineFile, 'spark1\nspark3\nspark4\n');
  try {
    const r = await act('run', { on: 'box', command: 'true' });
    assert.equal(r.status, 503, r.text);
    assert.equal(r.json.error, 'No compute Spark is on to hold a box: Spark 1, Spark 3 and Spark 4 are off or not answering (a box never opens on Spark 2 or on the brain’s Spark, and it wakes nothing). Nothing ran.');
    assert.deepEqual([boxLines('spark2'), boxRuns('spark2')], [[], []]);
  } finally { writeFileSync(T.fleet.offlineFile, 'spark1\n'); }
  await waitFor(async () => (await act('run', { on: 'box', command: 'true' })).json?.box === 'opened', { timeout: 60000 * SLOW, every: 2000, what: 'the box open again on Spark 3' });
});

test('the watcher and workloads leave the box out by its label; a container only named like one is listed', { timeout: 120000 * SLOW }, async () => {
  const DECOY = 'spark-console-box-0123456789ab', at = ['spark3', 'spark4'].find(s => boxLines(s).length);
  assert.ok(at, 'a box is open');
  appendFileSync(join(mock(at), 'containers'), `${DECOY}|running|Up 1 second|||||||\n`);
  try {
    let list;
    await waitFor(async () => { list = (await act('workloads', { spark: at })).json?.workloads || []; return list.some(w => w.name === DECOY); }, { what: 'the watcher’s next look' });
    assert.ok(!list.some(w => w.name === API_BOX), JSON.stringify(list.map(w => w.name)));
    const known = JSON.parse(text(join(T.fleet.stateDir, 'knowledge.json')) || '{}').workloads || {};
    assert.ok(!Object.keys(known).some(k => k.includes(API_BOX)), Object.keys(known).join(' '));
  } finally { const f = join(mock(at), 'containers'); writeFileSync(f, text(f).split('\n').filter(l => l && !l.startsWith(`${DECOY}|`)).map(l => `${l}\n`).join('')); }
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

test('the check itself, run on this machine (no walls here): each of the ten walls once, after the id, in order, then its end line; what is open here is said', { skip: process.getuid() === 0 && 'run as root, its write test would write in / and /etc', timeout: 60000 * SLOW }, async () => {
  const check = /const BOX_CHECK = String\.raw`([\s\S]*?)`;/.exec(readFileSync(join(REPO, 'service', 'src', '21-box.mjs'), 'utf8'))[1];
  // (a find that finds nothing: the real one would walk this machine's whole disk; in a box it walks only the image)
  const bin = mkdtempSync(join(tmpdir(), 'box-bin-'));
  writeFileSync(join(bin, 'find'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  try {
    const r = spawnSync('bash', ['-c', check, 'box-check', 'c0ffee', '/no/such/home', '127.0.0.1', '9'], { encoding: 'utf8', timeout: 30000 * SLOW, env: { PATH: `${bin}:${process.env.PATH}`, HOME: bin } });
    const out = r.stdout.trim().split('\n');
    assert.deepEqual(out.map(l => l.split(' ').slice(0, 3).join(' ')),
      [...['root', 'caps', 'privileges', 'writes', 'work', 'mounts', 'home', 'sockets', 'secrets', 'network'].map(w => `c0ffee wall ${w}`), 'c0ffee walls end'], r.stdout + r.stderr);
    assert.equal(out[0], 'c0ffee wall root ok');
    assert.match(out[3], /^c0ffee wall writes open .*\/tmp/);
    assert.equal(out[4], 'c0ffee wall work open');
    assert.match(out[5], /^c0ffee wall mounts open /);
    assert.equal(out[6], 'c0ffee wall home ok');
    assert.equal(out[8], 'c0ffee wall secrets ok');
    // (network: open on a machine with one; the test runner's own container may have none)
    assert.match(out[9], /^c0ffee wall network (?:ok|open .+)$/);
  } finally { rmSync(bin, { recursive: true, force: true }); }
});

test('changeLabel names the box, the command whole and keys masked', async () => {
  const src = readFileSync(join(REPO, 'service', 'src', '17-changes.mjs'), 'utf8');
  const fn = src.slice(src.indexOf('function changeLabel('), src.indexOf('\n}\n', src.indexOf('function changeLabel(')) + 2);
  const changeLabel = new Function('maskSecrets', `${fn}\nreturn changeLabel;`)(s => s.replace(/hf_[A-Za-z0-9]{20,}/g, '[hidden]'));
  assert.equal(changeLabel('run', { on: 'box', command: 'python3 fetch.py --token hf_abcdefghijklmnopqrstuvwxyz' }),
    'Open the box (a throw-away container on a compute Spark: no network, nothing of the Spark but its own folder) for: python3 fetch.py --token [hidden]');
});
