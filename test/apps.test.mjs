// Covers: Apps kept running (R38): `keep_running` adopts a running app (its link, whether it answers, no operation;
// again changes nothing; `should_be_running` checks the link); never on Spark 2 (any verb); refused for a console
// model, a protected container, a model server, a missing container, a restart or stop of one not kept; a port only on
// a LAN address has no link. Self-healing brings a kept app back after a crash and after its Spark is powered off and
// on, never after a clean stop with the Spark on (held, a notice; Bring back starts it). Restart, stop (off the list,
// stays stopped), keep again. A new app from an image: `spark.app=1`, a memory cap, its port on 127.0.0.1 and the
// Spark's tailnet address (`.mock/tsip`), named volumes and settings, no GPU or host network; refused for a secret
// setting (a whole word of its name: `DB_PASS` yes, `WEBUI_AUTH=False` no; the value never reaches `audit.jsonl`), a
// host folder, a low or model port, a model engine's image, a bad image, too little or unknown memory; an agent gets an
// owner-only question with no choice ids; one that never answers a web request stays running and listed, with no link.
// Ports: above 65535 refused, one Docker doesn't publish for a container that's there refused, a stopped app kept gets
// its port from `docker inspect`. The start of a container's id is never its name. A model server by what it is (a
// stopped one with an engine image is refused); a stopped app starts within its own memory limit, else the owner's
// figure. A database that doesn't speak HTTP is kept, healed and left running. Agents: keeping, restarting or stopping
// a container the console didn't start is the owner's call. An app the console started that answers `/v1/models` stays
// an app. A new image under a stopped container's name is refused, saying what differs; a `docker run` that failed on
// its port leaves no container. Sparkie runs it at once for clear words with the Spark named, else a button (a new
// image not typed out as whole words too; every image, volume and setting on the button); undo leaves an app change
// alone. A new app under a name still listed takes the new port and memory; Forget during a heal pass stays; a held
// app's reason is never an old skipped bring-back; undo of a start that stopped a kept app brings it back as an app;
// Docker that didn't answer is never a container that's gone; a stop while its Spark is off takes it off the list;
// "keep Open WebUI running" that `keep_running` answered isn't "don't stop anything" in the next message. Any workload
// (A13): a GPU app needs its memory figure, never starts on Spark 2, beside a model or another GPU app, or past the 8
// GB rule; its command follows the image, a key in it is refused; a dev box says who can use it; a kept GPU app that
// crashes while a model runs there isn't brought back; a job (`once`) mounts the shared folder at `/in` and its own
// `jobs/<name>` at `/out`, never joins the list, is told once when it ends (also in the chat it was started from), runs
// again and stops, and is refused by name, new or run again, when its folder or the jobs folder is a link; Sparkie's
// button for a GPU app or a dev box shows every setting, and typed in full it runs at once;
// a stack of `keep_running` steps runs as a saved workflow, and one with a new image needs an answer first. A stopped
// GPU app's start and a stopped model's restart look at the GPU and memory again inside their claim (A-2, A-2b).
//
// Apps kept running (A12, R38): keep_running puts an app that isn't a model (Open WebUI, a database) on the list of what
// should be running, with its link; restarts or stops one kept that way; and starts a new one from an image the owner
// names (no GPU, a memory cap, named volumes, opened on 127.0.0.1 and the Spark's tailnet address only). Self-healing
// brings a kept app back after a crash or a power cycle, never after a clean stop with its Spark on. Never on Spark 2,
// never a model or a protected container. The apps' own pages are tiny HTTP servers in this process (on the stand-in
// fleet every Spark's tailnet address is 127.0.0.1, unless a test writes ~/.mock/tsip), and a database is a TCP server
// that takes the connection and closes it without a word of HTTP.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { readFileSync, writeFileSync, appendFileSync, rmSync, existsSync, openSync, ftruncateSync, closeSync, statSync, symlinkSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, call, createKey, createActKey, waitFor, auditLines, eventLines, newChat, say, chatMessages, SLOW } from './lib.mjs';
import { startMock } from './start-mock.mjs';

// An app's page: answers anything, unless it's "down" (then it drops the connection without a reply).
const down = new Set();
const page = i => new Promise(res => {
  const s = http.createServer((req, r) => { if (down.has(i)) { req.socket.destroy(); return; } r.writeHead(200, { 'content-type': 'text/plain' }); r.end('an app'); });
  s.listen(0, '127.0.0.1', () => res(s));
});
const servers = await Promise.all([1, 2, 3, 4, 5].map(page));
const [P1, P2, P3, P4, P5] = servers.map(s => s.address().port);
// A database: takes the connection, reads the request, and closes it without a word (as Postgres does to GET /).
const db = await new Promise(res => { const s = net.createServer(c => { c.on('error', () => {}); c.once('data', () => c.destroy()); }); s.listen(0, '127.0.0.1', () => res(s)); });
const PDB = db.address().port;
// A port nothing listens on, one for the hand-started model server, and one only a LAN address publishes. The three are
// held (taking no connection) until this file's stand-in fleet has its own ports, then let go: let go at once, one could
// be handed to the fleet's model server, and lan-only then answered with its model list.
const free = async () => { const s = await page(0); const p = s.address().port; await new Promise(r => s.close(r)); return p; };
const held = await Promise.all([1, 2, 3].map(() => new Promise(res => { const s = net.createServer(c => c.destroy()); s.listen(0, '127.0.0.1', () => res(s)); s.unref(); })));
const [PDEAD, PVLLM, PLAN] = held.map(s => s.address().port);
// (closed at the end, or the test process would wait on them forever)
after(() => { for (const s of servers) { s.closeAllConnections?.(); s.close(); } db.close(); });

const keys = {};
const mock = (root, spark, file) => join(root, spark, '.mock', file);
useFleet({ watchMs: 2000, statusMs: 3000, knowledge: true,
  env: { SPARK_CONSOLE_DESIRED_MS: '1500', SPARK_CONSOLE_HEAL_MS: '2000', SPARK_CONSOLE_HEAL_SETTLE_MS: '3000', SPARK_CONSOLE_HEAL_OFFLINE_MS: '1000', SPARK_CONSOLE_APP_ANSWER_MS: '8000' },
  // Hand-started containers: Open WebUI and one published only on a LAN address on Spark 3; a notes app and a
  // hand-started model server on Spark 4. Later cases' own: a stopped app (late-app) and one with no memory limit
  // (bare-app) on Spark 3; a database (hand-db), a running job (hand-job) and a stopped app with a 16 GB limit (big-app)
  // on Spark 4; and a job of Spark Console's on Spark 4 that had ended before the service started (old-job).
  prepare: ({ root }) => {
    appendFileSync(mock(root, 'spark3', 'containers'), 'open-webui|running|Up 2 hours||||||\nlan-only|running|Up 1 hour||||||\nlate-app|exited|Exited (0) 2 hours ago||||||\nbare-app|exited|Exited (0) 2 hours ago||||||\n');
    writeFileSync(mock(root, 'spark3', 'ports'), `open-webui|${P1}\nlan-only|${PLAN}|192.168.1.5\nlate-app|${P5}\n`);
    appendFileSync(mock(root, 'spark4', 'containers'), 'notes-app|running|Up 3 hours||||||\nhand-vllm|running|Up 1 hour||||||\nhand-db|running|Up 1 hour||||||\nhand-job|running|Up 1 hour||||||\nbig-app|exited|Exited (0) 1 hour ago||||||\n');
    writeFileSync(mock(root, 'spark4', 'ports'), `notes-app|${P2}\nhand-vllm|${PVLLM}\nhand-db|${PDB}\n`);
    appendFileSync(mock(root, 'spark4', 'containers'), 'old-job|exited|Exited (0) 2 hours ago|app||||||\n');
    writeFileSync(mock(root, 'spark4', 'run-old-job'), ['-d', '--name', 'old-job', '--label', 'spark.app=1', '--label', 'spark.job=1', '--memory', '4g', 'python:3.12-slim', 'python3', '/in/old.py', ''].join('\n'));
    writeFileSync(mock(root, 'spark4', `serve-${PVLLM}`), '{"object":"list","data":[{"id":"hand-model","object":"model"}]}');
    // What docker inspect says they are: an app's image, and its own memory limit (hand-vllm keeps the stand-in's vLLM
    // image; bare-app and hand-job have no limit).
    for (const [spark, name, image, gib] of [['spark3', 'open-webui', null, 4], ['spark3', 'lan-only', 'nginx:1.27', 0], ['spark3', 'late-app', 'nginx:1.27', 1],
      ['spark3', 'bare-app', 'nginx:1.27', 0], ['spark4', 'notes-app', 'ghcr.io/example/notes:1', 2], ['spark4', 'hand-db', 'postgres:16', 1],
      ['spark4', 'hand-job', 'python:3.12', 0], ['spark4', 'big-app', 'nginx:1.27', 16]]) {
      if (image) writeFileSync(mock(root, spark, `image-${name}`), image);
      if (gib) writeFileSync(mock(root, spark, `memory-${name}`), String(gib * 2 ** 30));
    }
  },
}, async () => {
  await Promise.all(held.map(s => new Promise(r => s.close(r))));
  keys.look = await createKey('apps-look');
  keys.act = await createActKey('apps-act');
  // (the watcher's first look is 15 s in)
  await waitFor(async () => {
    const w = (await call(keys.look.token, 'workloads', {})).value?.workloads || [];
    return ['open-webui', 'lan-only', 'notes-app', 'hand-vllm', 'hand-db', 'nemotron-workshop-inference'].every(n => w.some(x => x.name === n));
  }, { timeout: 90000, what: 'the watcher seeing the hand-started apps' });
});

const m = (spark, file) => mock(T.fleet.root, spark, file);
const stateOf = (spark, name) => readFileSync(m(spark, 'containers'), 'utf8').split('\n').find(l => l.startsWith(`${name}|`))?.split('|')[1];
function setState(spark, name, state, status) {
  const f = m(spark, 'containers');
  writeFileSync(f, readFileSync(f, 'utf8').replace(new RegExp(`^${name}\\|[^|]*\\|[^|]*\\|`, 'm'), `${name}|${state}|${status}|`));
}
const keep = body => api('/actions/keep_running', { method: 'POST', body });
const listed = async (spark, container) => (await api('/desired')).json.running.find(x => x.spark === spark && x.container === container);
const eventsSince = async since => (await call(keys.look.token, 'fleet_events', { since, limit: 200 })).value.events;
const operations = async () => (await call(keys.look.token, 'recent_operations', { limit: 50 })).value.operations;
async function finished(id) {
  for (const until = Date.now() + 240000 * SLOW; ;) {
    const w = (await call(keys.look.token, 'wait_operation', { id, seconds: 30 })).value;
    if (w.status !== 'running') return w;
    assert.ok(Date.now() < until, 'still running');
  }
}
async function offline(ids) {
  const since = new Date().toISOString();
  writeFileSync(T.fleet.offlineFile, ['spark1', ...ids].join('\n') + '\n');
  await waitFor(async () => (await eventsSince(since)).filter(e => e.type === 'spark-offline' && ids.includes(e.spark)).length === ids.length, { timeout: 40000, what: `${ids} going offline` });
}
async function online(ids) {
  const since = new Date().toISOString();
  await new Promise(res => setTimeout(res, 1500));
  writeFileSync(T.fleet.offlineFile, 'spark1\n');
  await waitFor(async () => (await eventsSince(since)).filter(e => e.type === 'spark-online' && ids.includes(e.spark)).length === ids.length, { timeout: 40000, what: `${ids} coming back` });
}
// The operation Self-healing started for a container after `since`, to its end.
async function healed(container, since) {
  const op = await waitFor(async () => (await operations()).find(o => o.container === container && o.actor === 'Self-healing' && o.startedAt > since),
    { timeout: 90000, what: `Self-healing bringing ${container} back` });
  const w = await finished(op.id);
  assert.equal(w.status, 'completed', JSON.stringify(w));
  return op;
}
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const noScript = () => rmSync(join(T.fleet.dir, 'model-script.json'), { force: true });

describe('apps kept running', { concurrency: 1 }, () => {
  test('an app already running joins the list with its link, without an operation; again changes nothing', { timeout: 180000 * SLOW }, async () => {
    const before = (await operations()).length;
    const r = await keep({ spark: 'spark3', container: 'open-webui' });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual({ outcome: r.json.outcome, link: r.json.link, answers: r.json.answers }, { outcome: 'kept', link: `http://127.0.0.1:${P1}`, answers: true });
    assert.match(r.json.note, /now on the list of what should be running.* It answers at http:\/\/127\.0\.0\.1:\d+\.$/);
    const x = await listed('spark3', 'open-webui');
    assert.deepEqual({ app: x?.app, port: x?.port, kind: x?.kind, state: x?.state, model: x?.model }, { app: true, port: P1, kind: 'app', state: 'running', model: undefined });
    assert.equal((await operations()).length, before, 'no operation');
    const again = await keep({ spark: 'spark3', container: 'open-webui' });
    assert.equal(again.json.outcome, 'already', again.text);
    assert.match(again.json.note, /already kept running; nothing changed/);
    const sbr = async () => (await call(keys.look.token, 'should_be_running', {})).value.running.find(y => y.container === 'open-webui');
    assert.deepEqual({ link: (await sbr()).link, answers: (await sbr()).answers }, { link: `http://127.0.0.1:${P1}`, answers: true });
    down.add(1);
    try { assert.equal((await sbr()).answers, false); } finally { down.delete(1); }
  });

  test('never on Spark 2, whatever the verb', { timeout: 120000 * SLOW }, async () => {
    const before = readFileSync(m('spark2', 'containers'), 'utf8');
    for (const body of [{ spark: 'spark2', container: 'some-web-app' }, { spark: 'spark2', container: 'some-web-app', image: 'nginx:1.27', port: '8081:80' },
      { spark: 'spark2', container: 'some-web-app', do: 'stop' }]) {
      const r = await keep(body);
      assert.equal(r.status, 403, r.text);
      assert.match(r.json.error, /Sparkie’s/);
    }
    assert.equal(readFileSync(m('spark2', 'containers'), 'utf8'), before);
    assert.ok(!(await api('/desired')).json.running.some(x => x.spark === 'spark2' && x.app));
  });

  test('refused: a model of Spark Console’s, a protected container, a model server, one that isn’t there, a restart or stop of one not kept; a port only on the LAN has no link', { timeout: 300000 * SLOW }, async () => {
    const refused = async (body, status, re) => { const r = await keep(body); assert.equal(r.status, status, r.text); assert.match(r.json.error, re); };
    await refused({ spark: 'spark4', container: 'sc-RadixArk--Qwen3.8-27B-NVFP4' }, 409, /one of Spark Console’s models/);
    await refused({ spark: 'spark4', container: 'qwen-recipe-aphex3k' }, 403, /is protected/);
    await refused({ spark: 'spark4', container: 'hand-vllm' }, 409, /serves models/);
    await refused({ spark: 'spark3', container: 'nothing-here' }, 404, /There’s no container called nothing-here on Spark 3\. To start a new app there, say which image/);
    await refused({ spark: 'spark4', container: 'notes-app', do: 'restart' }, 409, /isn’t an app Spark Console keeps running, so there’s nothing to restart here/);
    await refused({ spark: 'spark4', container: 'notes-app', do: 'stop' }, 409, /nothing to stop here/);
    await refused({ spark: 'spark4', container: 'notes-app', do: 'stop', image: 'nginx:1.27' }, 400, /With do restart or stop, give only spark and container/);
    const lan = await keep({ spark: 'spark3', container: 'lan-only' });
    assert.equal(lan.status, 200, lan.text);
    assert.equal(lan.json.outcome, 'kept');
    assert.equal(lan.json.link, null);
    assert.match(lan.json.note, new RegExp(`Its port ${PLAN} isn’t opened on Spark 3’s tailnet address`));
    assert.equal(stateOf('spark4', 'notes-app'), 'running');
  });

  test('ports: one above 65535 is refused everywhere; one Docker doesn’t publish for a container that’s there is refused; a stopped app kept gets its port from Docker', { timeout: 240000 * SLOW }, async () => {
    const big = await keep({ spark: 'spark3', container: 'open-webui', port: '70000' });
    assert.equal(big.status, 400, big.text);
    assert.match(big.json.error, /1 to 65535/);
    const wrong = await keep({ spark: 'spark3', container: 'open-webui', port: `${PDEAD}:8080` });
    assert.equal(wrong.status, 409, wrong.text);
    assert.match(wrong.json.error, new RegExp(`its port is ${P1}:8000, not ${PDEAD}:8080`));
    assert.equal((await listed('spark3', 'open-webui'))?.port, P1);
    const sbr = (await call(keys.look.token, 'should_be_running', {})).value;
    assert.ok(sbr?.running.some(y => y.container === 'open-webui' && y.answers === true), JSON.stringify(sbr));
    // (Docker keeps a stopped container's ports in docker inspect; docker port shows nothing until it runs)
    const late = await keep({ spark: 'spark3', container: 'late-app' });
    assert.equal(late.json?.outcome, 'started', late.text);
    assert.equal(late.json.link, `http://127.0.0.1:${P5}`);
    const w = await finished(late.json.operation);
    assert.deepEqual({ status: w.status, endpoint: w.endpoint }, { status: 'completed', endpoint: `http://127.0.0.1:${P5}` });
    assert.equal((await listed('spark3', 'late-app'))?.port, P5);
  });

  test('the start of a container’s id is not its name: nothing is kept, stopped or restarted by it', { timeout: 120000 * SLOW }, async () => {
    const before = readFileSync(m('spark4', 'containers'), 'utf8');
    // (the stand-in docker, like Docker, takes the start of a container's id for it: qwen-recipe-aphex3k's starts
    // 7177656e, sc-RadixArk--Qwen3.8-27B-NVFP4's 73632d526164)
    for (const container of ['7177', '7177656e2d726563', '73632d526164']) {
      const k = await keep({ spark: 'spark4', container });
      assert.equal(k.status, 404, k.text);
      assert.match(k.json.error, new RegExp(`There’s no container called ${container} on Spark 4`));
      for (const verb of ['stop', 'restart']) {
        const r = await keep({ spark: 'spark4', container, do: verb });
        assert.equal(r.status, 409, r.text);
        assert.match(r.json.error, new RegExp(`nothing to ${verb} here`));
      }
      assert.equal(await listed('spark4', container), undefined);
    }
    assert.equal(readFileSync(m('spark4', 'containers'), 'utf8'), before);
  });

  test('a model server is known by what it is: a stopped one with an engine’s image is refused; a stopped app starts only within its own memory limit, or the owner’s figure when it has none', { timeout: 240000 * SLOW }, async () => {
    const ops = (await operations()).length;
    const model = await keep({ spark: 'spark3', container: 'nemotron-workshop-inference' });
    assert.equal(model.status, 409, model.text);
    assert.match(model.json.error, /serves models/);
    assert.equal(stateOf('spark3', 'nemotron-workshop-inference'), 'exited');
    assert.equal(await listed('spark3', 'nemotron-workshop-inference'), undefined);
    // big-app's own limit is 16 GB, and 10 GB is free beyond the 8 GB kept.
    const meminfo = readFileSync(m('spark4', 'meminfo'), 'utf8');
    try {
      writeFileSync(m('spark4', 'meminfo'), meminfo.replace(/^MemAvailable:.*$/m, `MemAvailable:   ${18 * 1024 * 1024} kB`));
      const big = await keep({ spark: 'spark4', container: 'big-app' });
      assert.equal(big.status, 409, big.text);
      assert.match(big.json.error, /doesn’t have room for big-app now: it may use up to 16 GB/);
    } finally { writeFileSync(m('spark4', 'meminfo'), meminfo); }
    assert.equal(stateOf('spark4', 'big-app'), 'exited');
    assert.equal((await operations()).length, ops, 'nothing started');
    // bare-app has no limit of its own: it starts only with the owner's figure.
    const bare = await keep({ spark: 'spark3', container: 'bare-app' });
    assert.equal(bare.status, 409, bare.text);
    assert.match(bare.json.error, /bare-app has no memory limit of its own.*Say the most memory it may use \(memoryGB\)/);
    assert.equal(stateOf('spark3', 'bare-app'), 'exited');
    const given = await keep({ spark: 'spark3', container: 'bare-app', memoryGB: 1 });
    assert.equal(given.json?.outcome, 'started', given.text);
    assert.equal((await finished(given.json.operation)).status, 'completed');
    assert.deepEqual({ state: stateOf('spark3', 'bare-app'), memoryGB: (await listed('spark3', 'bare-app'))?.memoryGB }, { state: 'running', memoryGB: 1 });
  });

  test('a database that doesn’t answer web requests is kept, brought back after a crash, and left running', { timeout: 240000 * SLOW }, async () => {
    const k = await keep({ spark: 'spark4', container: 'hand-db' });
    assert.deepEqual({ outcome: k.json?.outcome, link: k.json?.link, answers: k.json?.answers }, { outcome: 'kept', link: `http://127.0.0.1:${PDB}`, answers: false }, k.text);
    const since = new Date().toISOString();
    setState('spark4', 'hand-db', 'exited', 'Exited (1) just now');
    await healed('hand-db', since);
    await new Promise(r => setTimeout(r, 4000));
    assert.equal(stateOf('spark4', 'hand-db'), 'running');
    assert.equal((await listed('spark4', 'hand-db'))?.state, 'running');
  });

  test('agents: keeping, restarting or stopping a container Spark Console didn’t start is the owner’s call; the question hands back no choice ids', { timeout: 180000 * SLOW }, async () => {
    const ops = (await operations()).length;
    const asked = async body => {
      const r = await call(keys.act.token, 'keep_running', body);
      assert.equal(r.value?.outcome, 'question', r.text);
      assert.match(r.value.question, /wasn’t started by Spark Console, so that’s the owner’s call/);
      assert.ok(r.value.choices.every(c => c.choice === null && !c.call), r.text);
      assert.match(r.value.note, /no choice to send back/);
    };
    await asked({ spark: 'spark4', container: 'hand-job' });
    assert.equal(await listed('spark4', 'hand-job'), undefined);
    await asked({ spark: 'spark4', container: 'hand-db', do: 'stop' });
    await asked({ spark: 'spark4', container: 'hand-db', do: 'restart' });
    assert.equal(stateOf('spark4', 'hand-db'), 'running');
    assert.ok(await listed('spark4', 'hand-db'));
    assert.equal((await operations()).length, ops, 'nothing ran');
  });

  test('a kept app that crashes is brought back by self-healing', { timeout: 240000 * SLOW }, async () => {
    const since = new Date().toISOString();
    setState('spark3', 'open-webui', 'exited', 'Exited (1) just now');
    const op = await healed('open-webui', since);
    assert.equal(op.type, 'restart');
    const ev = (await eventsSince(since)).find(e => e.type === 'healing' && e.container === 'open-webui');
    assert.match(ev?.why || '', /stopped by itself \(exit 1\)/, JSON.stringify(ev));
    assert.equal(stateOf('spark3', 'open-webui'), 'running');
    assert.ok(auditLines().some(l => l.action === 'keep_running' && l.via === 'watcher' && l.actor === 'Self-healing' && l.outcome === 'started'));
  });

  test('a clean stop with its Spark on is held, not brought back; Bring back starts it', { timeout: 240000 * SLOW }, async () => {
    const k = await keep({ spark: 'spark4', container: 'notes-app' });
    assert.equal(k.json?.outcome, 'kept', k.text);
    const since = new Date().toISOString();
    setState('spark4', 'notes-app', 'exited', 'Exited (0) just now');
    await waitFor(async () => (await listed('spark4', 'notes-app'))?.state === 'held', { timeout: 60000, what: 'notes-app held' });
    await waitFor(async () => (await eventsSince(since)).some(e => e.type === 'notice' && /notes-app on Spark 4 should be running but isn’t/.test(e.text)), { timeout: 30000, what: 'the held notice' });
    // (a few self-healing passes)
    await new Promise(r => setTimeout(r, 8000));
    assert.ok(!(await eventsSince(since)).some(e => e.type === 'healing' && e.container === 'notes-app'));
    assert.equal(stateOf('spark4', 'notes-app'), 'exited');
    const b = await api('/desired/bring-back', { method: 'POST', body: { spark: 'spark4', container: 'notes-app' } });
    assert.equal(b.status, 202, b.text);
    assert.equal(b.json.outcome, 'started');
    assert.equal((await finished(b.json.operation)).status, 'completed');
    assert.equal(stateOf('spark4', 'notes-app'), 'running');
  });

  test('its Spark powered off and on: it comes back once the Spark has settled', { timeout: 240000 * SLOW }, async () => {
    await offline(['spark3']);
    setState('spark3', 'open-webui', 'exited', 'Exited (143) 1 minute ago');
    const since = new Date().toISOString();
    await online(['spark3']);
    await healed('open-webui', since);
    const ev = (await eventsSince(since)).find(e => e.type === 'healing' && e.container === 'open-webui');
    assert.match(ev?.why || '', /Spark 3 came back on/, JSON.stringify(ev));
    assert.equal(stateOf('spark3', 'open-webui'), 'running');
  });

  test('restart, then stop (off the list, and it stays stopped), then keep it again', { timeout: 300000 * SLOW }, async () => {
    const r = await keep({ spark: 'spark3', container: 'open-webui', do: 'restart' });
    assert.equal(r.json?.outcome, 'started', r.text);
    const w = await finished(r.json.operation);
    assert.deepEqual({ type: w.type, status: w.status, endpoint: w.endpoint }, { type: 'restart', status: 'completed', endpoint: `http://127.0.0.1:${P1}` });
    const s = await keep({ spark: 'spark3', container: 'open-webui', do: 'stop' });
    assert.equal(s.json?.outcome, 'started', s.text);
    assert.match(s.json.note, /comes off the list/);
    assert.equal((await finished(s.json.operation)).status, 'completed');
    assert.equal(stateOf('spark3', 'open-webui'), 'exited');
    assert.equal(await listed('spark3', 'open-webui'), undefined);
    const since = new Date().toISOString();
    await new Promise(res => setTimeout(res, 7000));
    assert.equal(stateOf('spark3', 'open-webui'), 'exited');
    assert.ok(!(await eventsSince(since)).some(e => e.type === 'healing' && e.container === 'open-webui'));
    const again = await keep({ spark: 'spark3', container: 'open-webui' });
    assert.equal(again.json?.outcome, 'started', again.text);
    assert.equal((await finished(again.json.operation)).status, 'completed');
    assert.equal((await listed('spark3', 'open-webui'))?.state, 'running');
    assert.equal(stateOf('spark3', 'open-webui'), 'running');
  });

  test('a new app from an image the owner names: no GPU, a memory cap, its port on 127.0.0.1, named volumes, settings', { timeout: 300000 * SLOW }, async () => {
    const r = await keep({ spark: 'spark4', container: 'whoami', image: 'traefik/whoami:v1.10', port: `${P3}:80`, volumes: ['whoami-data:/data'], env: ['WHOAMI_NAME=spark'] });
    assert.equal(r.json?.outcome, 'started', r.text);
    assert.equal(r.json.linkWhenReady, `http://127.0.0.1:${P3}`);
    const w = await finished(r.json.operation);
    assert.equal(w.status, 'completed', JSON.stringify(w));
    const args = readFileSync(m('spark4', 'last-run-args'), 'utf8').split('\n');
    for (const a of ['spark.app=1', '--memory', '4g', `127.0.0.1:${P3}:80`, 'whoami-data:/data', 'WHOAMI_NAME=spark', 'traefik/whoami:v1.10', '--restart', 'no']) assert.ok(args.includes(a), `${a} in ${args.join(' ')}`);
    for (const a of ['--gpus', '--privileged', '--network', 'spark.console=1', '--entrypoint']) assert.ok(!args.includes(a), `${a} not in ${args.join(' ')}`);
    assert.equal(args.filter(a => a === '-p').length, 1, 'only 127.0.0.1 (the stand-in tailnet address is 127.0.0.1 too)');
    assert.deepEqual({ app: (await listed('spark4', 'whoami'))?.app, port: (await listed('spark4', 'whoami'))?.port }, { app: true, port: P3 });
    const seen = await waitFor(async () => (await call(keys.look.token, 'workloads', { spark: 'spark4' })).value.workloads.find(x => x.name === 'whoami'), { timeout: 30000, what: 'the watcher seeing whoami' });
    assert.deepEqual({ by: seen.startedBySparkConsole, kind: seen.kind }, { by: true, kind: 'service' });
  });

  test('an app Spark Console started stays an app when it answers /v1/models; an agent may restart it', { timeout: 240000 * SLOW }, async () => {
    appendFileSync(m('spark4', 'ports'), `whoami|${P3}\n`);
    writeFileSync(m('spark4', `serve-${P3}`), '{"object":"list","data":[{"id":"proxy-model","object":"model"}]}');
    try {
      const k = await keep({ spark: 'spark4', container: 'whoami' });
      assert.equal(k.status, 200, k.text);
      assert.deepEqual({ outcome: k.json.outcome, link: k.json.link }, { outcome: 'already', link: `http://127.0.0.1:${P3}` });
      const all = (await call(keys.look.token, 'running_models', {})).value;
      assert.ok(!all.otherServers.some(x => x.container === 'whoami'), JSON.stringify(all.otherServers));
      const r = await call(keys.act.token, 'keep_running', { spark: 'spark4', container: 'whoami', do: 'restart' });
      assert.equal(r.value?.outcome, 'started', r.text);
      assert.equal((await finished(r.value.operation)).status, 'completed');
      assert.equal(stateOf('spark4', 'whoami'), 'running');
    } finally { rmSync(m('spark4', `serve-${P3}`), { force: true }); }
  });

  test('a new app is refused for a secret setting, a host folder, a low or model port, a bad image, too little memory or memory unknown; an agent gets an owner-only question; one that never answers web requests stays running', { timeout: 300000 * SLOW }, async () => {
    const base = { spark: 'spark4', container: 'newapp', image: 'nginx:1.27', port: `${P4}:80` };
    const refused = async (body, status, re) => { const r = await keep({ ...base, ...body }); assert.equal(r.status, status, r.text); assert.match(r.json.error, re); };
    await refused({ env: ['OPENAI_API_KEY=abc'] }, 400, /OPENAI_API_KEY looks like a key, token or password/);
    // Whole words of the name: a password by any of its names is refused; WEBUI_AUTH=False and other plain settings pass.
    for (const e of ['RABBITMQ_DEFAULT_PASS=hunter2hunter2', 'MYSQL_PWD=hunter2hunter2', 'PGPASSWORD=x', 'OPENAI_API_KEYS=a;b', 'apiKey=abc', 'AUTH_TOKEN=abc']) await refused({ env: [e] }, 400, new RegExp(`${e.split('=')[0]} looks like a key, token or password`));
    await refused({ env: ['WEBUI_SECRET_KEY=s3cretvalue-0123456789'] }, 400, /WEBUI_SECRET_KEY looks like a key/);
    const audit = readFileSync(join(T.fleet.stateDir, 'audit.jsonl'), 'utf8');
    for (const v of ['hunter2hunter2', 's3cretvalue-0123456789']) assert.ok(!audit.includes(v), `${v} in audit.jsonl`);
    await refused({ image: 'vllm/vllm-openai:v0.20.0' }, 400, /is a model engine’s image/);
    await refused({ volumes: ['/home/u:/data'] }, 400, /isn’t in the right form/);
    await refused({ port: '22:22' }, 400, /between 1024 and 65535/);
    await refused({ port: `${T.fleet.servePort}:80` }, 400, new RegExp(`not ${T.fleet.servePort}`));
    await refused({ image: '-v' }, 400, /isn’t in the right form/);
    const meminfo = readFileSync(m('spark4', 'meminfo'), 'utf8');
    try {
      writeFileSync(m('spark4', 'meminfo'), meminfo.replace(/^MemAvailable:.*$/m, `MemAvailable:   ${9 * 1024 * 1024} kB`));
      await refused({}, 409, /doesn’t have room for newapp now: it may use up to 4 GB, and 1 GB is free beyond the 8 GB kept for the system/);
      // (these pass the secret check, and stop at the memory rule)
      await refused({ env: ['WEBUI_AUTH=False', 'ENABLE_OAUTH_SIGNUP=false', 'MAX_TOKENS=4096', 'TOKENIZERS_PARALLELISM=false', 'POSTGRES_HOST_AUTH_METHOD=trust'] }, 409, /doesn’t have room for newapp now/);
      writeFileSync(m('spark4', 'meminfo'), meminfo.replace(/^MemAvailable:.*\n/m, ''));
      await refused({}, 409, /can’t be read right now/);
    } finally { writeFileSync(m('spark4', 'meminfo'), meminfo); }
    const agent = await call(keys.act.token, 'keep_running', base);
    assert.equal(agent.value?.outcome, 'question', agent.text);
    assert.match(agent.value.note, /Only the owner can answer/);
    // (a direct call has no conversation to show the button in: no choice id comes back, and it says how the owner says yes)
    assert.ok(agent.value.choices.every(c => c.choice === null && !c.call), agent.text);
    assert.match(agent.value.note, /no choice to send back: the owner asks Sparkie for it in their own chat there \(“Start newapp on Spark 4 from the image nginx:1\.27/);
    assert.equal(stateOf('spark4', 'newapp'), undefined, 'nothing started');
    // One that never answers a web request is up all the same: it stays running and on the list (R38), with no link. On
    // a Spark whose tailnet address isn't 127.0.0.1 its port is opened there too, and only there and on 127.0.0.1.
    writeFileSync(m('spark4', 'tsip'), '100.64.0.4\n');
    let quiet;
    try { quiet = await keep({ ...base, container: 'quiet-app', port: `${PDEAD}:80` }); } finally { rmSync(m('spark4', 'tsip'), { force: true }); }
    assert.equal(quiet.json?.outcome, 'started', quiet.text);
    assert.equal(quiet.json.linkWhenReady, `http://100.64.0.4:${PDEAD}`);
    const w = await finished(quiet.json.operation);
    assert.equal(w.status, 'completed', JSON.stringify(w));
    assert.equal(w.endpoint ?? null, null);
    assert.ok(w.recentLog.some(l => /quiet-app is running\. It doesn’t answer web requests at port \d+ \(yet\), so there’s no link/.test(l.text ?? l)), JSON.stringify(w.recentLog));
    const run = readFileSync(m('spark4', 'last-run-args'), 'utf8').split('\n');
    assert.deepEqual(run.flatMap((a, i) => (a === '-p' ? [run[i + 1]] : [])), [`127.0.0.1:${PDEAD}:80`, `100.64.0.4:${PDEAD}:80`]);
    assert.equal(stateOf('spark4', 'quiet-app'), 'running');
    assert.equal((await listed('spark4', 'quiet-app'))?.port, PDEAD);
  });

  test('a new image under a stopped container’s name is refused, saying what differs; a start that never ran leaves no container', { timeout: 300000 * SLOW }, async () => {
    setState('spark4', 'quiet-app', 'exited', 'Exited (0) just now');
    const args = readFileSync(m('spark4', 'last-run-args'), 'utf8'), ops = (await operations()).length;
    const r = await keep({ spark: 'spark4', container: 'quiet-app', image: 'nginx:1.28', port: `${P4}:80` });
    assert.equal(r.status, 409, r.text);
    assert.match(r.json.error, new RegExp(`already a container called quiet-app on Spark 4, and its image is nginx:1\\.27, not nginx:1\\.28; its port is ${PDEAD}:80, not ${P4}:80`));
    assert.equal(stateOf('spark4', 'quiet-app'), 'exited');
    assert.equal(readFileSync(m('spark4', 'last-run-args'), 'utf8'), args);
    assert.equal((await operations()).length, ops);
    // Without them it starts as it was.
    const same = await keep({ spark: 'spark4', container: 'quiet-app' });
    assert.equal(same.json?.outcome, 'started', same.text);
    assert.equal((await finished(same.json.operation)).status, 'completed');
    assert.equal(stateOf('spark4', 'quiet-app'), 'running');
    // Its port taken, Docker leaves the container it made "created": it's taken away, so the next try runs afresh.
    writeFileSync(m('spark4', 'app-port-taken'), '');
    try {
      const t = await keep({ spark: 'spark4', container: 'taken-app', image: 'nginx:1.27', port: `${P4}:80` });
      assert.equal(t.json?.outcome, 'started', t.text);
      const w = await finished(t.json.operation);
      assert.equal(w.status, 'failed');
      assert.match(w.error, /Docker couldn’t start it: .*port is already allocated/);
    } finally { rmSync(m('spark4', 'app-port-taken'), { force: true }); }
    assert.equal(stateOf('spark4', 'taken-app'), undefined);
    const again = await keep({ spark: 'spark4', container: 'taken-app', image: 'nginx:1.27', port: `${P4}:80` });
    assert.equal(again.json?.outcome, 'started', again.text);
    assert.equal((await finished(again.json.operation)).status, 'completed');
    assert.equal(stateOf('spark4', 'taken-app'), 'running');
  });

  let chat;
  test('Sparkie: “keep Open WebUI on Spark 3 running” runs at once; a question or a new image not typed out is a button; all of it typed runs', { timeout: 300000 * SLOW }, async () => {
    const webui = { spark: 'spark3', container: 'open-webui' }, image = 'ghcr.io/open-webui/open-webui:main';
    script([{ match: '^keep open webui on spark 3 running\\. give me its link\\.$', calls: [{ name: 'keep_running', arguments: webui }] },
      { match: '^what\'s the link to open webui\\?$', calls: [{ name: 'keep_running', arguments: webui }] },
      { match: '^keep open webui on spark 4 running$', calls: [{ name: 'keep_running', arguments: { spark: 'spark4', container: 'open-webui', image, port: '3000:8080' } }] },
      { match: '^start ghcr', calls: [{ name: 'keep_running', arguments: { spark: 'spark4', container: 'open-webui', image, port: `${P4}:8080` } }] }]);
    try {
      const r = await say(await newChat(), 'Keep Open WebUI on Spark 3 running. Give me its link.');
      assert.ok(!r.message.choices, JSON.stringify(r.message.choices));
      assert.deepEqual(r.message.tools.map(t => [t.name, t.ok]), [['keep_running', true]]);
      assert.ok(auditLines().some(l => l.action === 'keep_running' && l.via === 'sparkie' && ['kept', 'already'].includes(l.outcome)));
      const q = await say(await newChat(), 'what\'s the link to open webui?');
      assert.deepEqual(q.message.choices?.map(c => c.label), ['Keep open-webui running on Spark 3']);
      const n = await say(await newChat(), 'keep open webui on spark 4 running');
      assert.equal(n.message.choices?.length, 1, JSON.stringify(n.message));
      assert.match(n.message.choices[0].label, /^Start open-webui on Spark 4 from the image ghcr\.io\/open-webui\/open-webui:main, opened at port 3000 \(the app’s 8080\), and keep it running$/);
      assert.equal(stateOf('spark4', 'open-webui'), undefined, 'nothing started');
      chat = await newChat();
      const all = await say(chat, `Start ${image} as open-webui on Spark 4 at port ${P4}:8080.`);
      assert.ok(!all.message.choices, JSON.stringify(all.message.choices));
      const op = all.message.tools.find(t => t.name === 'keep_running');
      assert.equal(op?.ok, true, JSON.stringify(all.message.tools));
      const started = (await operations()).find(o => o.container === 'open-webui' && o.spark === 'spark4' && o.type === 'deploy');
      assert.equal((await finished(started.id)).status, 'completed');
      assert.equal(stateOf('spark4', 'open-webui'), 'running');
    } finally { noScript(); }
  });

  test('“undo that” after an app change in that chat is refused plainly; nothing stops', { timeout: 120000 * SLOW }, async () => {
    script([{ match: '^undo that$', calls: [{ name: 'undo_last_change', arguments: {} }] }]);
    try {
      const r = await say(chat, 'undo that');
      assert.match(r.text, /last change was to an app, and undo only reverses model changes/);
      assert.equal(stateOf('spark4', 'open-webui'), 'running');
    } finally { noScript(); }
  });

  test('Sparkie: a new image runs at once only as typed, and only with the Spark named; every word of a new app is on its button', { timeout: 300000 * SLOW }, async () => {
    const image = 'ghcr.io/open-webui/open-webui:main', vols = [1, 2, 3, 4].map(i => `data${i}:/app/${'backend-data-'.repeat(14)}${i}`);
    script([{ match: '^keep open webui running$', calls: [{ name: 'keep_running', arguments: { spark: 'spark3', container: 'open-webui' } }] },
      { match: '^start ghcr', calls: [{ name: 'keep_running', arguments: { spark: 'spark4', container: 'webui-a', image: 'open-webui/open-webui:main', port: `${P4}:8080` } }] },
      { match: '^keep notes-app on spark 4 running$', calls: [{ name: 'keep_running', arguments: { spark: 'spark4', container: 'notes-app', image: 'docker.io/someone/else:latest', port: '9000:80' } }] },
      { match: '^keep open webui on spark 4 running with its data$', calls: [{ name: 'keep_running', arguments: { spark: 'spark4', container: 'webui-b', image, port: '3000:8080', volumes: vols, env: ['OLLAMA_BASE_URL=http://203.0.113.9:11434'] } }] }]);
    try {
      for (const words of ['keep open webui running', `Start ${image} as webui-a on Spark 4 at port ${P4}:8080.`, 'keep notes-app on spark 4 running']) {
        const r = await say(await newChat(), words);
        assert.equal(r.message.choices?.length, 1, `${words}: ${JSON.stringify(r.message)}`);
      }
      assert.equal(stateOf('spark4', 'webui-a'), undefined);
      const long = await say(await newChat(), 'keep open webui on spark 4 running with its data');
      const label = long.message.choices?.[0]?.label || '';
      for (const part of [image, ...vols, 'OLLAMA_BASE_URL=http://203.0.113.9:11434']) assert.ok(label.includes(part), `${part} isn’t on the button: ${label}`);
      assert.equal(stateOf('spark4', 'webui-b'), undefined);
    } finally { noScript(); }
  });

  test('a new app under a name still on the list (its container gone) takes the new port and memory figure', { timeout: 240000 * SLOW }, async () => {
    const f = m('spark4', 'containers');
    writeFileSync(f, readFileSync(f, 'utf8').split('\n').filter(l => !l.startsWith('whoami|')).join('\n'));
    await waitFor(async () => (await listed('spark4', 'whoami'))?.why === 'its container is gone', { timeout: 60000, what: 'whoami held' });
    const r = await keep({ spark: 'spark4', container: 'whoami', image: 'traefik/whoami:v1.10', port: `${P4}:80`, memoryGB: 2 });
    assert.equal(r.json?.outcome, 'started', r.text);
    assert.equal((await finished(r.json.operation)).status, 'completed');
    const x = await listed('spark4', 'whoami');
    assert.deepEqual({ port: x?.port, memoryGB: x?.memoryGB, state: x?.state }, { port: P4, memoryGB: 2, state: 'running' });
  });

  test('Forget while self-healing is bringing an app back: it stays stopped and off the list', { timeout: 180000 * SLOW }, async () => {
    assert.ok(await listed('spark4', 'notes-app'));
    // (every docker inspect on Spark 4 takes 6 s: the bring-back's look at notes-app is still going when Forget lands)
    writeFileSync(m('spark4', 'slow-inspect'), '6');
    const since = new Date().toISOString();
    try {
      setState('spark4', 'notes-app', 'exited', 'Exited (1) just now');
      await waitFor(async () => (await eventsSince(since)).some(e => e.type === 'healing' && e.container === 'notes-app'), { timeout: 60000, what: 'self-healing starting on notes-app' });
      const f = await api('/desired/forget', { method: 'POST', body: { spark: 'spark4', container: 'notes-app' } });
      assert.equal(f.status, 200, f.text);
    } finally { rmSync(m('spark4', 'slow-inspect'), { force: true }); }
    // (the bring-back's answer, once its look is done; anything it started, to its end)
    const line = await waitFor(() => auditLines().find(l => l.action === 'keep_running' && l.actor === 'Self-healing' && l.at > since && l.args?.container === 'notes-app'), { timeout: 60000, what: 'the bring-back answering' });
    if (line.operation) await finished(line.operation);
    assert.equal(line.outcome, 'already', JSON.stringify(line));
    assert.equal(stateOf('spark4', 'notes-app'), 'exited');
    assert.equal(await listed('spark4', 'notes-app'), undefined);
    assert.ok(!(await operations()).some(o => o.container === 'notes-app' && o.actor === 'Self-healing' && o.startedAt > since));
  });

  test('a held app’s reason is never an old skipped bring-back from before it last ran', { timeout: 300000 * SLOW }, async () => {
    const meminfo = readFileSync(m('spark3', 'meminfo'), 'utf8'), since = new Date().toISOString();
    try {
      writeFileSync(m('spark3', 'meminfo'), meminfo.replace(/^MemAvailable:.*$/m, `MemAvailable:   ${Math.round(8.5 * 1024 * 1024)} kB`));
      setState('spark3', 'late-app', 'exited', 'Exited (1) just now');
      await waitFor(async () => (await eventsSince(since)).some(e => e.type === 'heal-skipped' && e.container === 'late-app' && /doesn’t have room/.test(e.why)), { timeout: 90000, what: 'a skipped bring-back of late-app' });
    } finally { writeFileSync(m('spark3', 'meminfo'), meminfo); }
    // (brought back by the next pass, or by the owner when both tries went)
    if (!await waitFor(async () => stateOf('spark3', 'late-app') === 'running', { timeout: 20000, what: 'late-app back' }).catch(() => false)) {
      const k = await keep({ spark: 'spark3', container: 'late-app' });
      assert.equal((await finished(k.json.operation)).status, 'completed', k.text);
    }
    await waitFor(async () => (await eventsSince(since)).some(e => e.type === 'started' && e.container === 'late-app'), { timeout: 60000, what: 'the watcher seeing late-app start' });
    setState('spark3', 'late-app', 'exited', 'Exited (0) just now');
    const x = await waitFor(async () => { const y = await listed('spark3', 'late-app'); return y?.state === 'held' && y; }, { timeout: 60000, what: 'late-app held' });
    assert.equal(x.why, 'it isn’t running');
  });

  test('undo of a start that had stopped a kept app brings the app back as an app', { timeout: 240000 * SLOW }, async () => {
    // (late-app, held on Spark 3, as a model start in this chat that stopped it to make room would have left the list)
    const chat = await newChat(), file = join(T.fleet.stateDir, 'desired.json'), d = JSON.parse(readFileSync(file, 'utf8'));
    const was = d.running.find(x => x.spark === 'spark3' && x.container === 'late-app');
    assert.ok(was?.app, JSON.stringify(d.running));
    const before = d.running.map(x => ({ ...x }));
    d.running = d.running.filter(x => x !== was);
    d.revision += 1;
    d.revisions.push({ revision: d.revision, at: new Date().toISOString(), operation: null, chat, by: 'owner', added: [], removed: ['spark3/late-app'], before });
    writeFileSync(file, JSON.stringify(d), { mode: 0o600 });
    script([{ match: '^undo that$', calls: [{ name: 'undo_last_change', arguments: {} }] }]);
    const since = new Date().toISOString();
    try {
      const r = await say(chat, 'undo that');
      assert.deepEqual(r.message.tools.map(t => [t.name, t.ok, t.outcome]), [['undo_last_change', true, 'started']], r.text);
    } finally { noScript(); }
    const op = await waitFor(async () => (await operations()).find(o => o.type === 'undo' && o.startedAt > since), { timeout: 30000, what: 'the undo' });
    const w = await finished(op.id);
    assert.equal(w.status, 'completed', JSON.stringify(w));
    assert.equal(stateOf('spark3', 'late-app'), 'running');
    const x = await listed('spark3', 'late-app');
    assert.deepEqual({ app: x?.app, kind: x?.kind, port: x?.port }, { app: true, kind: 'app', port: P5 });
  });

  test('Docker that didn’t answer is never taken for a container that’s gone', { timeout: 120000 * SLOW }, async () => {
    writeFileSync(m('spark3', 'stall'), '0');
    try {
      for (const body of [{ spark: 'spark3', container: 'open-webui' }, { spark: 'spark3', container: 'open-webui', do: 'restart' }]) {
        const r = await keep(body);
        assert.equal(r.status, 409, r.text);
        assert.match(r.json.error, /Docker on Spark 3 didn’t answer just now/);
      }
      const b = await api('/desired/bring-back', { method: 'POST', body: { spark: 'spark3', container: 'open-webui' } });
      assert.equal(b.status, 409, b.text);
    } finally { rmSync(m('spark3', 'stall'), { force: true }); }
    assert.equal((await listed('spark3', 'open-webui'))?.app, true);
    assert.equal(stateOf('spark3', 'open-webui'), 'running');
  });

  // A-23: a new app whose check fails while Docker on its Spark answers nothing: its stop isn't confirmed, so it is
  // never said to be stopped again; the operation says it may still be running (its log and its clean-up words).
  test('a new app that didn’t come up while Docker there answered nothing isn’t said to be stopped again: it may still be running, and the operation says so', { timeout: 180000 * SLOW }, async () => {
    const r = await keep({ spark: 'spark4', container: 'stuck-app', image: 'nginx:1.27', port: `${await free()}:80` });
    assert.equal(r.json?.outcome, 'started', r.text);
    const said = 'It didn’t come up, and it couldn’t be stopped: stuck-app may still be running on Spark 4. Stop it there, then look at its log.';
    try {
      // (it runs: from here every docker command on Spark 4 fails at once, as when Docker there doesn't answer)
      await waitFor(async () => { if (stateOf('spark4', 'stuck-app') === 'running') return true; const o = (await api(`/jobs/${r.json.operation}`)).json; assert.equal(o.status, 'running', JSON.stringify(o)); return false; },
        { timeout: 60000 * SLOW, what: 'stuck-app running', every: 100 });
      writeFileSync(m('spark4', 'stall'), '0');
      const w = await finished(r.json.operation);
      assert.equal(w.status, 'failed', JSON.stringify(w));
      const job = (await api(`/jobs/${r.json.operation}`)).json;
      assert.ok(job.log.some(l => l.endsWith(said)), job.log.join('\n'));
      assert.ok(!job.log.some(l => /so it was stopped again/.test(l)), job.log.join('\n'));
      assert.equal(job.cleanUp, said);
      assert.equal(stateOf('spark4', 'stuck-app'), 'running', 'Docker never answered the stop');
    } finally {
      rmSync(m('spark4', 'stall'), { force: true });
      setState('spark4', 'stuck-app', 'exited', 'Exited (0) just now');
    }
  });

  test('stop while its Spark is off takes the app off the list, and it isn’t started when the Spark comes back', { timeout: 240000 * SLOW }, async () => {
    assert.ok(await listed('spark4', 'hand-db'));
    await offline(['spark4']);
    let since;
    try {
      await new Promise(r => setTimeout(r, 1500));
      const s = await keep({ spark: 'spark4', container: 'hand-db', do: 'stop' });
      assert.equal(s.status, 200, s.text);
      assert.equal(s.json.outcome, 'forgotten');
      assert.match(s.json.note, /nothing was stopped there\. hand-db is off the list of what should be running, so it isn’t started again when Spark 4 comes back on/);
      assert.equal(await listed('spark4', 'hand-db'), undefined);
      setState('spark4', 'hand-db', 'exited', 'Exited (143) 1 minute ago');
    } finally { since = new Date().toISOString(); await online(['spark4']); }
    // (the Spark settles, then several self-healing passes)
    await new Promise(r => setTimeout(r, 10000));
    assert.ok(!(await eventsSince(since)).some(e => e.type === 'healing' && e.container === 'hand-db'));
    assert.equal(stateOf('spark4', 'hand-db'), 'exited');
  });

  test('“Keep Open WebUI running” answered by keep_running isn’t “don’t stop anything” in the next message', { timeout: 240000 * SLOW }, async () => {
    // ("don't stop anything" makes running a saved workflow a button: run_workflow shows the rule quickly)
    const saved = await api('/actions/save_workflow', { method: 'POST', body: { title: 'list check', steps: [{ action: 'should_be_running', args: {} }] } });
    assert.equal(saved.status, 200, saved.text);
    script([{ match: '^keep open webui on spark 3 running\\.$', calls: [{ name: 'keep_running', arguments: { spark: 'spark3', container: 'open-webui' } }] },
      { match: '^keep the gguf model on spark 3 running\\.$', calls: [] },
      { match: '^run list check$', calls: [{ name: 'run_workflow', arguments: { name: 'list check' } }] }]);
    try {
      // (a control: "keep" about a model, with no app kept, still means nothing stops in the next message)
      const control = await newChat();
      await say(control, 'Keep the GGUF model on Spark 3 running.');
      const no = await say(control, 'run list check');
      assert.deepEqual(no.message.tools.map(t => [t.name, t.ok, t.outcome]), [['run_workflow', true, 'needs-ok']], no.text);
      const chat = await newChat();
      const k = await say(chat, 'Keep Open WebUI on Spark 3 running.');
      assert.deepEqual(k.message.tools.map(t => [t.name, t.ok]), [['keep_running', true]]);
      // (the case needs the keep to have run, not been offered as a button; if not, say why)
      assert.ok(!['needs-ok', 'question'].includes(k.message.tools[0].outcome), `keep_running answered ${k.message.tools[0].outcome}: ${k.text}`);
      const r = await say(chat, 'run list check');
      assert.deepEqual(r.message.tools.map(t => [t.name, t.ok, t.outcome]), [['run_workflow', true, 'started']], r.text);
    } finally { noScript(); }
  });
});

// Any workload (A13): keep_running with gpu (the Spark's GPU to itself: one GPU thing per Spark), command (the words it
// runs) and once (a job: runs to its end, not kept, reads the shared folder at /in and writes jobs/<name> there at /out,
// its end told once in the chat it came from). Dev boxes run with no password, and say who can use them. Parts A–D;
// the model start's side (part E) is in change.test.mjs.
describe('any workload: GPU apps, commands, jobs (A13)', { concurrency: 1 }, () => {
  const MODEL3 = 'sc-testorg--Qwen3.8-27B-abliterated-GGUF';   // Spark Console's model on Spark 3 (stand-in fleet)
  const JUPYTER = 'quay.io/jupyter/pytorch-notebook:cuda12-latest', NOTEBOOK = ['start-notebook.py', '--IdentityProvider.token=', '--ServerApp.password='];
  const NO_PASSWORD = 'It has no password, so anyone on your tailnet, or you signed in anywhere through the app door, can use it';
  const args = spark => readFileSync(m(spark, 'last-run-args'), 'utf8').split('\n');
  let PJ;
  test('a GPU app: needs its memory figure; never on Spark 2; never beside a model or another GPU app; the 8 GB rule; its command after the image; no secret in it; a dev box says who can use it', { timeout: 300000 * SLOW }, async () => {
    PJ = await free();
    const box = { spark: 'spark3', container: 'gpu-box', image: JUPYTER, port: `${PJ}:8888`, gpu: true, command: NOTEBOOK };
    const refused = async (body, status, re) => { const r = await keep(body); assert.equal(r.status, status, r.text); assert.match(r.json.error, re); return r; };
    const ops = (await operations()).length;
    await refused(box, 400, /A GPU app or job needs its memory figure \(memoryGB\)/);
    await refused({ ...box, spark: 'spark2', memoryGB: 24 }, 403, /Sparkie’s/);
    // Spark Console's model runs on Spark 3: one GPU thing per Spark, and nothing is stopped for it.
    await refused({ ...box, memoryGB: 24 }, 409, new RegExp(`Spark 3 runs [^.]*${MODEL3.replace(/[.]/g, '\\.')}[^.]* now\\. A GPU app or job has a Spark’s GPU to itself\\. Stop that first, or pick another Spark\\.`));
    assert.equal(stateOf('spark3', MODEL3), 'running', 'the model still runs');
    // A key in the command, or the value after a secret-named flag: refused before anything runs.
    await refused({ ...box, memoryGB: 24, command: ['python3', 'train.py', 'hf_abcdefghijklmnopqrstuvwxyz123456'] }, 400, /command looks like it has a key, token or password/);
    await refused({ ...box, memoryGB: 24, command: ['serve', '--api-key', 'abc123def456'] }, 400, /command looks like it has a key, token or password/);
    assert.equal((await operations()).length, ops, 'nothing started');
    setState('spark3', MODEL3, 'exited', 'Exited (0) just now');
    const meminfo = readFileSync(m('spark3', 'meminfo'), 'utf8');
    try {
      writeFileSync(m('spark3', 'meminfo'), meminfo.replace(/^MemAvailable:.*$/m, `MemAvailable:   ${20 * 1024 * 1024} kB`));
      await refused({ ...box, memoryGB: 24 }, 409, /doesn’t have room for gpu-box now: it may use up to 24 GB, and 12 GB is free beyond the 8 GB kept for the system/);
    } finally { writeFileSync(m('spark3', 'meminfo'), meminfo); }
    const r = await keep({ ...box, memoryGB: 24 });
    assert.equal(r.json?.outcome, 'started', r.text);
    assert.deepEqual({ gpu: r.json.gpu, note: r.json.note }, { gpu: true, note: `${NO_PASSWORD}.` });
    const w = await finished(r.json.operation);
    assert.equal(w.status, 'completed', JSON.stringify(w));
    assert.ok(w.recentLog.some(l => String(l.text ?? l).includes(NO_PASSWORD)), JSON.stringify(w.recentLog));
    const a = args('spark3');
    for (const x of ['--gpus', 'all', 'spark.gpu=1', 'spark.app=1', '--shm-size', '2g', '--memory', '24g']) assert.ok(a.includes(x), `${x} in ${a.join(' ')}`);
    for (const x of ['--privileged', '--network', '--ipc', '--entrypoint', 'spark.console=1', 'spark.job=1']) assert.ok(!a.includes(x), `${x} not in ${a.join(' ')}`);
    assert.deepEqual(a.slice(a.indexOf(JUPYTER) + 1).filter(Boolean), NOTEBOOK, 'the command follows the image, word for word');
    assert.deepEqual({ app: (await listed('spark3', 'gpu-box'))?.app, memoryGB: (await listed('spark3', 'gpu-box'))?.memoryGB }, { app: true, memoryGB: 24 });
    // A second GPU app there: refused, naming the first. The same name with another command: refused, saying what differs.
    await refused({ spark: 'spark3', container: 'gpu-two', image: 'nvcr.io/nvidia/pytorch:25.01-py3', port: `${PDEAD}:8888`, gpu: true, memoryGB: 8 }, 409, /Spark 3 runs gpu-box now\. A GPU app or job has a Spark’s GPU to itself/);
    await refused({ ...box, memoryGB: 24, command: ['start-notebook.py'] }, 409, /already a container called gpu-box on Spark 3, and its command is start-notebook\.py --IdentityProvider\.token= --ServerApp\.password=, not start-notebook\.py\. /);
    assert.equal(stateOf('spark3', 'gpu-two'), undefined);
    assert.equal(stateOf('spark3', 'gpu-box'), 'running');
  });

  test('a kept GPU app that crashes while a model runs on its Spark isn’t brought back; nothing stops', { timeout: 180000 * SLOW }, async () => {
    setState('spark3', MODEL3, 'running', 'Up 1 second');
    const since = new Date().toISOString();
    setState('spark3', 'gpu-box', 'exited', 'Exited (1) just now');
    const skipped = await waitFor(async () => (await eventsSince(since)).find(e => e.type === 'heal-skipped' && e.container === 'gpu-box'), { timeout: 60000, what: 'the bring-back skipped' });
    assert.match(skipped.why, /Spark 3 runs [^.]*sc-testorg--Qwen3\.8-27B-abliterated-GGUF[^.]* now\. A GPU app or job has a Spark’s GPU to itself/, JSON.stringify(skipped));
    await new Promise(res => setTimeout(res, 5000));
    assert.deepEqual([stateOf('spark3', 'gpu-box'), stateOf('spark3', MODEL3)], ['exited', 'running']);
    assert.ok(!(await operations()).some(o => o.container === 'gpu-box' && o.actor === 'Self-healing' && o.startedAt > since));
    const f = await api('/desired/forget', { method: 'POST', body: { spark: 'spark3', container: 'gpu-box' } });
    assert.equal(f.status, 200, f.text);
  });

  test('a job (once): no port, the shared folder at /in, its own folder at /out, never on the list; its end is told once and it isn’t brought back; run again, already while it runs, stopped', { timeout: 300000 * SLOW }, async () => {
    const job = { spark: 'spark4', container: 'sums', image: 'python:3.12-slim', once: true, command: ['python3', '/in/sums.py'] };
    const r = await keep(job);
    assert.equal(r.json?.outcome, 'started', r.text);
    assert.deepEqual({ job: r.json.job, files: r.json.files, link: r.json.linkWhenReady }, { job: true, files: 'jobs/sums in the shared folder on Spark 4', link: undefined });
    const w = await finished(r.json.operation);
    assert.equal(w.status, 'completed', JSON.stringify(w));
    assert.ok(w.recentLog.some(l => /sums runs\. Its files go to jobs\/sums in the shared folder on Spark 4; Spark Console posts in this chat when it ends\./.test(String(l.text ?? l))), JSON.stringify(w.recentLog));
    const a = args('spark4');
    assert.ok(a.includes('spark.job=1') && a.includes('spark.app=1'), a.join(' '));
    const vols = a.flatMap((x, i) => (x === '-v' ? [a[i + 1]] : []));
    assert.ok(vols.some(v => v.endsWith('/.local/share/spark-portal/workspaces/shared:/in:ro')), vols.join(' '));
    assert.ok(vols.some(v => v.endsWith('/.local/share/spark-portal/workspaces/shared/jobs/sums:/out')), vols.join(' '));
    assert.equal(a[a.indexOf('-w') + 1], '/out');
    assert.ok(!a.includes('-p') && !a.includes('--gpus') && !a.some(x => x.startsWith('spark.chat=')), a.join(' '));
    assert.deepEqual(a.slice(a.indexOf('python:3.12-slim') + 1).filter(Boolean), job.command);
    assert.equal(await listed('spark4', 'sums'), undefined, 'a job is never on the list');
    const files = (await call(keys.look.token, 'files', { spark: 'spark4', folder: 'jobs' })).value;
    assert.ok(files?.entries?.some(e => e.name === 'sums' && e.kind === 'folder'), JSON.stringify(files));
    // It ends with an error: told once (over several watcher rounds), never brought back.
    const since = new Date().toISOString();
    setState('spark4', 'sums', 'exited', 'Exited (1) just now');
    const told = e => e.type === 'notice' && /^sums on Spark 4 ended with an error \(exit 1\)\. Its files are in jobs\/sums in the shared folder on Spark 4, and its log stays with its container \(container_logs\)\. It isn’t started again\.$/.test(e.text);
    await waitFor(async () => (await eventsSince(since)).some(told), { timeout: 30000, what: 'the end of sums told' });
    await new Promise(res => setTimeout(res, 7000));
    const after = await eventsSince(since);
    assert.equal(after.filter(told).length, 1, JSON.stringify(after.filter(e => e.container === 'sums')));
    assert.ok(!after.some(e => e.type === 'healing' && e.container === 'sums'));
    assert.ok(!(await operations()).some(o => o.container === 'sums' && o.actor === 'Self-healing'));
    assert.equal(stateOf('spark4', 'sums'), 'exited');
    // Run again: started as it was, still not on the list. Asked to keep it while it runs: already, not listed.
    const again = await keep({ spark: 'spark4', container: 'sums' });
    assert.deepEqual({ outcome: again.json?.outcome, job: again.json?.job }, { outcome: 'started', job: true }, again.text);
    assert.equal((await finished(again.json.operation)).status, 'completed');
    assert.equal(stateOf('spark4', 'sums'), 'running');
    assert.equal(await listed('spark4', 'sums'), undefined);
    const k = await keep({ spark: 'spark4', container: 'sums' });
    assert.equal(k.json?.outcome, 'already', k.text);
    assert.match(k.json.note, /It’s a job: it runs to its end and isn’t kept running/);
    assert.equal(await listed('spark4', 'sums'), undefined);
    // Stopped (it isn't on the list, but Spark Console started it): its end says it was stopped.
    const stopSince = new Date().toISOString();
    const s = await keep({ spark: 'spark4', container: 'sums', do: 'stop' });
    assert.equal(s.json?.outcome, 'started', s.text);
    assert.equal((await finished(s.json.operation)).status, 'completed');
    assert.equal(stateOf('spark4', 'sums'), 'exited');
    assert.equal(await listed('spark4', 'sums'), undefined);
    await waitFor(async () => (await eventsSince(stopSince)).some(e => e.type === 'notice' && /^sums on Spark 4 was stopped\./.test(e.text)), { timeout: 30000, what: 'the stop told' });
  });

  // The worker's 64 MiB and 1,000-entry limit on the shared folder counts jobs' outputs. A job's own folder is made
  // without it, so one sizeable job never stops the next; a save there is refused, saying the folder is full and why.
  test('a job whose output passes the shared folder’s limit: it runs again and a new job starts; save_file says the folder is full and how to clear it', { timeout: 240000 * SLOW }, async () => {
    const shared = join(T.fleet.root, 'spark4', '.local/share/spark-portal/workspaces/shared');
    const big = join(shared, 'jobs/sums/checkpoint.bin');
    const fd = openSync(big, 'w'); ftruncateSync(fd, 70 * 1024 * 1024); closeSync(fd);
    try {
      const again = await keep({ spark: 'spark4', container: 'sums' });
      assert.deepEqual({ outcome: again.json?.outcome, job: again.json?.job }, { outcome: 'started', job: true }, again.text);
      const w1 = await finished(again.json.operation);
      assert.equal(w1.status, 'completed', JSON.stringify(w1));
      assert.equal(stateOf('spark4', 'sums'), 'running');
      const nw = await keep({ spark: 'spark4', container: 'sums2', image: 'python:3.12-slim', once: true, command: ['python3', '/in/other.py'] });
      assert.equal(nw.json?.outcome, 'started', nw.text);
      const w2 = await finished(nw.json.operation);
      assert.equal(w2.status, 'completed', JSON.stringify(w2));
      assert.equal(stateOf('spark4', 'sums2'), 'running');
      assert.equal(statSync(join(shared, 'jobs/sums2')).mode & 0o777, 0o700, 'its folder is the owner’s only');
      const sv = await api('/actions/save_file', { method: 'POST', body: { spark: 'spark4', path: 'train.py', text: 'print(1)\n' } });
      assert.equal(sv.status, 400, sv.text);
      assert.match(sv.json.error, /^The shared folder on Spark 4 is full: it holds at most 64 MiB and 1,000 files and folders, and jobs’ outputs \(in jobs\/ there\) count too, so they are most likely what filled it\. Nothing was written\. To clear them, delete the job folders you no longer need on Spark 4 \(rm -rf ~\/\.local\/share\/spark-portal\/workspaces\/shared\/jobs\/<name>; files with folder jobs lists them\), then save again\.$/);
    } finally {
      rmSync(big, { force: true });
      for (const c of ['sums', 'sums2']) setState('spark4', c, 'exited', 'Exited (0) just now');
    }
  });

  test('agents: running a job again, or starting a stopped GPU app, is the owner’s question; it hands back no choice ids and nothing starts', { timeout: 180000 * SLOW }, async () => {
    const r = await keep({ spark: 'spark4', container: 'tally', image: 'python:3.12-slim', once: true, command: ['python3', '/in/tally.py'] });
    assert.equal(r.json?.outcome, 'started', r.text);
    assert.equal((await finished(r.json.operation)).status, 'completed');
    setState('spark4', 'tally', 'exited', 'Exited (1) just now');
    const ops = (await operations()).length;
    // (gpu-box, the GPU app of the first case here, is stopped and off the list)
    for (const [args, re] of [[{ spark: 'spark4', container: 'tally' }, /^Run tally on Spark 4 again\? Running a job again is the owner’s call\.$/],
      [{ spark: 'spark3', container: 'gpu-box' }, /^Keep gpu-box running on Spark 3\? Starting an app that uses the GPU is the owner’s call\.$/]]) {
      const a = await call(keys.act.token, 'keep_running', args);
      assert.equal(a.value?.outcome, 'question', a.text);
      assert.match(a.value.question, re);
      assert.ok(a.value.choices.every(c => c.choice === null && !c.call), a.text);
      assert.match(a.value.note, /^Only the owner can answer this one, from Spark Console, and nothing was done/);
    }
    assert.deepEqual([stateOf('spark4', 'tally'), stateOf('spark3', 'gpu-box')], ['exited', 'exited']);
    assert.equal((await operations()).length, ops, 'nothing started');
  });

  // The checks before the claim are made again inside it, just before docker start (A-2): another GPU thing that came,
  // or memory that went, between the first look and the claim is never started beside.
  test('a stopped GPU app is checked again inside its claim: another GPU app there, or less free memory, since the first look starts nothing', { timeout: 300000 * SLOW }, async () => {
    // (gpu-box, the GPU app of the first case here, is stopped and off the list; with the model on Spark 3 stopped, the
    // checks before the claim pass)
    assert.equal(stateOf('spark3', 'gpu-box'), 'exited');
    assert.equal(await listed('spark3', 'gpu-box'), undefined);
    setState('spark3', MODEL3, 'exited', 'Exited (0) just now');
    const meminfo = readFileSync(m('spark3', 'meminfo'), 'utf8');
    const other = () => {
      appendFileSync(m('spark3', 'containers'), 'gpu-other|running|Up 1 second|app||||||\n');
      writeFileSync(m('spark3', 'run-gpu-other'), ['-d', '--name', 'gpu-other', '--label', 'spark.app=1', '--label', 'spark.gpu=1', '--gpus', 'all', '--memory', '8g', 'nvcr.io/nvidia/pytorch:25.01-py3', ''].join('\n'));
    };
    const noOther = () => {
      const f = m('spark3', 'containers');
      writeFileSync(f, readFileSync(f, 'utf8').split('\n').filter(l => !l.startsWith('gpu-other|')).join('\n'));
      rmSync(m('spark3', 'run-gpu-other'), { force: true });
    };
    // (every docker inspect on Spark 3 takes 2 s more: when keep_running answers, its claim is taken and the job's own
    // look at gpu-box is still to come, so the change lands between the two)
    writeFileSync(m('spark3', 'slow-inspect'), '2');
    try {
      for (const [what, change, re] of [
        ['another GPU app', other, /^Spark 3 runs gpu-other now\. A GPU app or job has a Spark’s GPU to itself\./],
        ['less free memory', () => writeFileSync(m('spark3', 'meminfo'), meminfo.replace(/^MemAvailable:.*$/m, `MemAvailable:   ${20 * 1024 * 1024} kB`)),
          /^Spark 3 doesn’t have room for gpu-box now: it may use up to 24 GB, and 12 GB is free beyond the 8 GB kept for the system\./]]) {
        const r = await keep({ spark: 'spark3', container: 'gpu-box' });
        assert.equal(r.json?.outcome, 'started', `${what}: ${r.text}`);
        change();
        const w = await finished(r.json.operation);
        assert.equal(w.status, 'failed', `${what}: ${JSON.stringify(w)}`);
        assert.match(w.error, re, what);
        assert.equal(stateOf('spark3', 'gpu-box'), 'exited', `${what}: gpu-box wasn’t started`);
        assert.ok(!w.recentLog.some(l => /It didn’t come up/.test(String(l.text ?? l))), `${what}: nothing to put back: ${JSON.stringify(w.recentLog)}`);
        noOther();
        writeFileSync(m('spark3', 'meminfo'), meminfo);
      }
    } finally {
      rmSync(m('spark3', 'slow-inspect'), { force: true });
      noOther();
      writeFileSync(m('spark3', 'meminfo'), meminfo);
      setState('spark3', MODEL3, 'running', 'Up 1 second');
    }
  });

  // The same for restart_model (A-2b): its room and the GPU are looked at again inside its claim, from a fresh look,
  // just before docker start, so what came between the first look and the claim starts nothing.
  test('a stopped model’s restart is checked again inside its claim: a GPU app there, or less free memory, since the first look starts nothing', { timeout: 300000 * SLOW }, async () => {
    assert.equal(stateOf('spark3', 'gpu-box'), 'exited');
    setState('spark3', MODEL3, 'exited', 'Exited (0) just now');
    const meminfo = readFileSync(m('spark3', 'meminfo'), 'utf8');
    const other = () => {
      appendFileSync(m('spark3', 'containers'), 'gpu-other|running|Up 1 second|app||||||\n');
      writeFileSync(m('spark3', 'run-gpu-other'), ['-d', '--name', 'gpu-other', '--label', 'spark.app=1', '--label', 'spark.gpu=1', '--gpus', 'all', '--memory', '8g', 'nvcr.io/nvidia/pytorch:25.01-py3', ''].join('\n'));
    };
    const noOther = () => {
      const f = m('spark3', 'containers');
      writeFileSync(f, readFileSync(f, 'utf8').split('\n').filter(l => !l.startsWith('gpu-other|')).join('\n'));
      rmSync(m('spark3', 'run-gpu-other'), { force: true });
    };
    // (every docker inspect on Spark 3 takes 2 s more: when restart_model answers, its claim is taken and the job's own
    // look is still to come, so the change lands between the two)
    writeFileSync(m('spark3', 'slow-inspect'), '2');
    try {
      for (const [what, change, re] of [
        ['a GPU app', other, /^gpu-other has Spark 3’s GPU now\. start_model can ask to stop it\.$/],
        // (the stand-in model's files are a few MB: with 8 GB free, nothing is left beyond the 8 GB kept)
        ['less free memory', () => writeFileSync(m('spark3', 'meminfo'), meminfo.replace(/^MemAvailable:.*$/m, `MemAvailable:   ${8 * 1024 * 1024} kB`)),
          new RegExp(`^spark3 doesn’t have room for ${MODEL3.replace(/\./g, '\\.')} now \\(it takes about \\d+ GB beyond the 8 GB kept free\\)\\. start_model can make room\\.$`)]]) {
        const r = await api('/actions/restart_model', { method: 'POST', body: { spark: 'spark3', container: MODEL3 } });
        assert.equal(r.json?.outcome, 'started', `${what}: ${r.text}`);
        change();
        const w = await finished(r.json.operation);
        assert.equal(w.status, 'failed', `${what}: ${JSON.stringify(w)}`);
        assert.match(w.error, re, what);
        assert.equal(stateOf('spark3', MODEL3), 'exited', `${what}: ${MODEL3} wasn’t started`);
        noOther();
        writeFileSync(m('spark3', 'meminfo'), meminfo);
      }
    } finally {
      rmSync(m('spark3', 'slow-inspect'), { force: true });
      noOther();
      writeFileSync(m('spark3', 'meminfo'), meminfo);
      setState('spark3', MODEL3, 'running', 'Up 1 second');
    }
  });

  test('a job run again that ends before the watcher’s next look is told with its own end, not the run before’s', { timeout: 180000 * SLOW }, async () => {
    const r = await keep({ spark: 'spark4', container: 'rerun-job', image: 'python:3.12-slim', once: true, command: ['python3', '/in/rerun.py'] });
    assert.equal(r.json?.outcome, 'started', r.text);
    assert.equal((await finished(r.json.operation)).status, 'completed');
    let since = new Date().toISOString();
    const told = async () => (await eventsSince(since)).filter(e => e.type === 'notice' && e.container === 'rerun-job').map(e => e.text);
    setState('spark4', 'rerun-job', 'exited', 'Exited (1) just now');
    await waitFor(async () => (await told()).length, { timeout: 30000, what: 'the first end told' });
    assert.match((await told())[0], /^rerun-job on Spark 4 ended with an error \(exit 1\)/);
    // Run again: the stand-in's docker start of it ends at once with exit 0, so no look sees it running.
    writeFileSync(m('spark4', 'start-exits-rerun-job'), '0');
    try {
      since = new Date().toISOString();
      const again = await keep({ spark: 'spark4', container: 'rerun-job' });
      assert.deepEqual({ outcome: again.json?.outcome, job: again.json?.job }, { outcome: 'started', job: true }, again.text);
      assert.equal((await finished(again.json.operation)).status, 'completed');
      assert.equal(stateOf('spark4', 'rerun-job'), 'exited');
      await waitFor(async () => (await told()).length, { timeout: 30000, what: 'the re-run’s end told' });
      await new Promise(res => setTimeout(res, 5000));
      const ends = await told();
      assert.equal(ends.length, 1, JSON.stringify(ends));
      assert.match(ends[0], /^rerun-job on Spark 4 finished(?: after [^.]*)?\. Its files are in jobs\/rerun-job/);
    } finally { rmSync(m('spark4', 'start-exits-rerun-job'), { force: true }); }
  });

  // A walled change may write in the shared folder (R42): it could swap a job's own folder for a link to the home, which
  // Docker would follow (the home writable at /out). A new job and a run again check the job's mounts after the folder is
  // made and again in the same command as Docker, and are refused by name; Docker runs and starts nothing (the stand-in
  // keeps an app's run in run-<name>, and a start sets it running and writes up-<name>).
  test('a job’s folder that is a link, or inside one: a new job and a run again are refused by name, and Docker runs and starts nothing', { timeout: 300000 * SLOW }, async () => {
    const home = join(T.fleet.root, 'spark4'), jobs = join(home, '.local/share/spark-portal/workspaces/shared/jobs');
    const failed = async (body, re) => {
      const r = await keep(body);
      assert.equal(r.json?.outcome, 'started', r.text);
      const w = await finished(r.json.operation);
      assert.equal(w.status, 'failed', JSON.stringify(w));
      assert.match(w.error, re, JSON.stringify(w));
    };
    const upAt = () => statSync(m('spark4', 'up-swapped')).mtimeMs;
    const notStarted = (before, why) => { assert.equal(stateOf('spark4', 'swapped'), 'exited', why); assert.equal(upAt(), before, `${why}: no docker start`); };
    const made = await keep({ spark: 'spark4', container: 'swapped', image: 'python:3.12-slim', once: true, command: ['python3', '/in/swapped.py'] });
    assert.equal((await finished(made.json.operation)).status, 'completed');
    setState('spark4', 'swapped', 'exited', 'Exited (0) just now');
    mkdirSync(jobs, { recursive: true });
    try {
      // A new job whose folder is already there as a link to the home.
      symlinkSync(home, join(jobs, 'planted'));
      await failed({ spark: 'spark4', container: 'planted', image: 'python:3.12-slim', once: true, command: ['python3', '/in/planted.py'] },
        /^The job’s folder jobs\/planted in the shared folder on Spark 4 isn’t a real folder: it is a link, or inside one\. Docker would follow it, so planted wasn’t started\. Make it a real folder there, then ask again\.$/);
      assert.equal(stateOf('spark4', 'planted'), undefined, 'no container made');
      assert.ok(!existsSync(m('spark4', 'run-planted')), 'no docker run');
      // A job that ran, its folder moved aside and a link to the home put in its place: run again, refused.
      renameSync(join(jobs, 'swapped'), join(jobs, 'swapped-aside'));
      symlinkSync(home, join(jobs, 'swapped'));
      let before = upAt();
      await failed({ spark: 'spark4', container: 'swapped' }, /^The job’s folder jobs\/swapped in the shared folder on Spark 4 isn’t a real folder: it is a link, or inside one\./);
      notStarted(before, 'its folder a link');
      // The jobs folder itself a link (every job's folder then inside one): refused, naming it, before anything is made.
      rmSync(join(jobs, 'swapped')); renameSync(join(jobs, 'swapped-aside'), join(jobs, 'swapped'));
      renameSync(jobs, `${jobs}-real`); symlinkSync(`${jobs}-real`, jobs);
      before = upAt();
      await failed({ spark: 'spark4', container: 'swapped' }, /^The jobs folder in the shared folder on Spark 4 isn’t a real folder: it is a link, or inside one\./);
      notStarted(before, 'the jobs folder a link');
    } finally {
      if (existsSync(`${jobs}-real`)) { rmSync(jobs, { force: true }); renameSync(`${jobs}-real`, jobs); }
      rmSync(join(jobs, 'planted'), { force: true });
      if (existsSync(join(jobs, 'swapped-aside'))) { rmSync(join(jobs, 'swapped'), { force: true }); renameSync(join(jobs, 'swapped-aside'), join(jobs, 'swapped')); }
    }
    // Put right, it runs again.
    const again = await keep({ spark: 'spark4', container: 'swapped' });
    assert.equal((await finished(again.json.operation)).status, 'completed');
    assert.equal(stateOf('spark4', 'swapped'), 'running');
    setState('spark4', 'swapped', 'exited', 'Exited (0) just now');
  });

  // A Spark the watcher has only ever seen empty (A-8): the first look Docker answered there is its first look, even
  // with nothing there, so the first job that ends there before the next look is told, once. A job that had ended
  // before a Spark's first look is history: never told.
  test('a job on a Spark the watcher has only seen empty is told once when it ends, in its chat; one that ended before a Spark’s first look isn’t', { timeout: 240000 * SLOW }, async () => {
    // (old-job had ended on Spark 4 before the service started: the watcher's first look there knows it, and says nothing)
    assert.equal((await call(keys.look.token, 'workloads', { spark: 'spark4' })).value.workloads.find(w => w.name === 'old-job')?.state, 'exited');
    assert.ok(!eventLines().some(e => e.container === 'old-job' && e.type === 'notice'), 'no notice for old-job');
    // Spark 1 (always off here, nothing on it) comes on: one look Docker answered, with nothing there.
    const since = new Date().toISOString(), chat = await newChat();
    writeFileSync(T.fleet.offlineFile, '');
    try {
      await waitFor(async () => (await call(keys.look.token, 'workloads', { spark: 'spark1' })).value?.observedAt, { timeout: 60000, what: 'a look at Spark 1' });
      assert.deepEqual((await call(keys.look.token, 'workloads', { spark: 'spark1' })).value.workloads, [], 'nothing on Spark 1');
      // A job that ends before the watcher's next look, as start-exits-… leaves one: its first sight is its end.
      writeFileSync(m('spark1', 'run-first-job'), ['-d', '--name', 'first-job', '--label', 'spark.app=1', '--label', 'spark.job=1', '--label', `spark.chat=${chat}`,
        '--memory', '4g', 'python:3.12-slim', 'python3', '/in/first.py', ''].join('\n'));
      appendFileSync(m('spark1', 'containers'), 'first-job|exited|Exited (0) 1 second ago|app||||||\n');
      const told = e => e.type === 'notice' && e.container === 'first-job';
      const line = x => x.notice && /^first-job on Spark 1 finished\. Its files are in jobs\/first-job in the shared folder on Spark 1/.test(x.content);
      await waitFor(async () => (await eventsSince(since)).some(told), { timeout: 30000, what: 'the end of first-job told' });
      await waitFor(async () => (await chatMessages(chat)).some(line), { timeout: 30000, what: 'the end in its chat' });
      // (a few more looks: told once)
      await new Promise(res => setTimeout(res, 7000));
      assert.equal((await eventsSince(since)).filter(told).length, 1);
      assert.equal((await chatMessages(chat)).filter(line).length, 1);
    } finally {
      // (Spark 1 as it was: off, nothing on it)
      writeFileSync(m('spark1', 'containers'), '');
      rmSync(m('spark1', 'run-first-job'), { force: true });
      writeFileSync(T.fleet.offlineFile, 'spark1\n');
    }
    await waitFor(async () => (await eventsSince(since)).some(e => e.type === 'spark-offline' && e.spark === 'spark1'), { timeout: 40000, what: 'Spark 1 off again' });
  });

  // A dev box has no password only when its command says so: a known image kept with no command gets its no-sign-in
  // words; one with a command of its own keeps whatever sign-in that command leaves.
  const JUPYTER_PLAIN = 'quay.io/jupyter/base-notebook:2025-01-06';
  test('a Jupyter image with no command starts with its no-sign-in words, and says who can use it', { timeout: 180000 * SLOW }, async () => {
    const r = await keep({ spark: 'spark4', container: 'jup-box', image: JUPYTER_PLAIN, port: `${await free()}:8888` });
    assert.equal(r.json?.outcome, 'started', r.text);
    assert.equal(r.json.note, `${NO_PASSWORD}.`);
    const w = await finished(r.json.operation);
    assert.equal(w.status, 'completed', JSON.stringify(w));
    const a = args('spark4');
    assert.deepEqual(a.slice(a.indexOf(JUPYTER_PLAIN) + 1).filter(Boolean), NOTEBOOK, 'its no-sign-in words follow the image');
    assert.ok(w.recentLog.some(l => String(l.text ?? l).includes(NO_PASSWORD)), JSON.stringify(w.recentLog));
  });

  test('a Jupyter image with a command of its own that keeps its token isn’t said to have no password', { timeout: 180000 * SLOW }, async () => {
    const r = await keep({ spark: 'spark4', container: 'jup-token', image: JUPYTER_PLAIN, port: `${await free()}:8888`, command: ['start-notebook.py'] });
    assert.equal(r.json?.outcome, 'started', r.text);
    assert.equal(r.json.note, undefined, r.text);
    const w = await finished(r.json.operation);
    assert.equal(w.status, 'completed', JSON.stringify(w));
    const a = args('spark4');
    assert.deepEqual(a.slice(a.indexOf(JUPYTER_PLAIN) + 1).filter(Boolean), ['start-notebook.py']);
    assert.ok(!w.recentLog.some(l => String(l.text ?? l).includes(NO_PASSWORD)), JSON.stringify(w.recentLog));
  });

  test('a job started from a chat: its end is one notice in that chat, with no log text', { timeout: 240000 * SLOW }, async () => {
    const words = 'Run python:3.12-slim once as count-job on Spark 4: python3 -c print(42)';
    script([{ match: '^run python:3\\.12-slim once as count-job', calls: [{ name: 'keep_running', arguments: { spark: 'spark4', container: 'count-job', image: 'python:3.12-slim', once: true, command: ['python3', '-c', 'print(42)'] } }] }]);
    const chat = await newChat();
    try {
      const r = await say(chat, words);
      assert.ok(!r.message.choices, JSON.stringify(r.message.choices));
      assert.deepEqual(r.message.tools.map(t => [t.name, t.ok, t.outcome]), [['keep_running', true, 'started']], r.text);
    } finally { noScript(); }
    const op = await waitFor(async () => (await operations()).find(o => o.container === 'count-job' && o.type === 'deploy'), { timeout: 30000, what: 'the job’s start' });
    assert.equal((await finished(op.id)).status, 'completed');
    assert.ok(args('spark4').includes(`spark.chat=${chat}`), args('spark4').join(' '));
    setState('spark4', 'count-job', 'exited', 'Exited (0) just now');
    const end = m => m.notice && !m.operation && /count-job on Spark 4 finished/.test(m.content);
    const msg = await waitFor(async () => (await chatMessages(chat)).find(end), { timeout: 30000, what: 'the job’s end in its chat' });
    assert.match(msg.content, /^count-job on Spark 4 finished\. Its files are in jobs\/count-job in the shared folder on Spark 4, and its log stays with its container \(container_logs\)\. It isn’t started again\.$/);
    await new Promise(res => setTimeout(res, 5000));
    assert.equal((await chatMessages(chat)).filter(end).length, 1, 'told once');
  });

  test('Sparkie: a GPU app or a dev box the owner didn’t type out is one button with every setting; typed out in full it runs at once and says who can use it', { timeout: 300000 * SLOW }, async () => {
    const PC = await free();
    const comfy = { spark: 'spark3', container: 'comfyui', image: 'ghcr.io/ai-dock/comfyui:latest', port: '8188:8188', gpu: true, memoryGB: 24, command: ['--listen', '0.0.0.0', '--port', '8188'] };
    const code = { spark: 'spark4', container: 'code-box', image: 'codercom/code-server:4.96.4', port: `${PC}:8080`, command: ['--auth', 'none', '--bind-addr', '0.0.0.0:8080'] };
    script([{ match: '^run comfyui on spark 3$', calls: [{ name: 'keep_running', arguments: comfy }] },
      { match: '^give me a code-server on spark 4$', calls: [{ name: 'keep_running', arguments: code }] },
      { match: '^start codercom', calls: [{ name: 'keep_running', arguments: code }] }]);
    try {
      const c = await say(await newChat(), 'Run ComfyUI on Spark 3');
      assert.deepEqual(c.message.tools.map(t => [t.name, t.ok, t.outcome]), [['keep_running', true, 'needs-ok']], c.text);
      const label = c.message.choices?.[0]?.label || '';
      assert.equal(c.message.choices.length, 1);
      for (const part of [comfy.image, 'with the GPU', 'up to 24 GB', 'opened at port 8188', ...comfy.command]) assert.ok(label.includes(part), `${part} isn’t on the button: ${label}`);
      assert.equal(stateOf('spark3', 'comfyui'), undefined, 'nothing started');
      const d = await say(await newChat(), 'give me a code-server on spark 4');
      assert.equal(d.message.choices?.length, 1, JSON.stringify(d.message));
      assert.equal(d.message.choices[0].label, `Start code-box on Spark 4 from the image codercom/code-server:4.96.4, running --auth none --bind-addr 0.0.0.0:8080, opened at port ${PC} (the app’s 8080), and keep it running. ${NO_PASSWORD}`);
      assert.equal(stateOf('spark4', 'code-box'), undefined, 'nothing started');
      const all = await say(await newChat(), `Start codercom/code-server:4.96.4 as code-box on Spark 4 at port ${PC}:8080 with --auth none --bind-addr 0.0.0.0:8080`);
      assert.ok(!all.message.choices, JSON.stringify(all.message.choices));
      assert.deepEqual(all.message.tools.map(t => [t.name, t.ok, t.outcome]), [['keep_running', true, 'started']], all.text);
    } finally { noScript(); }
    const op = (await operations()).find(o => o.container === 'code-box' && o.type === 'deploy');
    const w = await finished(op.id);
    assert.equal(w.status, 'completed', JSON.stringify(w));
    assert.ok(w.recentLog.some(l => String(l.text ?? l).includes(NO_PASSWORD)), JSON.stringify(w.recentLog));
    const a = args('spark4');
    assert.deepEqual(a.slice(a.indexOf(code.image) + 1).filter(Boolean), code.command);
    assert.equal(stateOf('spark4', 'code-box'), 'running');
  });

  test('a stack is a saved workflow of keep_running steps: stopped apps Spark Console started come back; a step with a new image needs the owner’s answer and starts nothing', { timeout: 300000 * SLOW }, async () => {
    // (stopped through keep_running, so they're off the list and self-healing leaves them alone: Spark 4 came back on a
    // few minutes ago, when a stop still counts as its power cycle)
    for (const container of ['whoami', 'quiet-app']) {
      const s = await keep({ spark: 'spark4', container, do: 'stop' });
      assert.equal(s.json?.outcome, 'started', s.text);
      assert.equal((await finished(s.json.operation)).status, 'completed');
      assert.equal(await listed('spark4', container), undefined);
    }
    const save = body => api('/actions/save_workflow', { method: 'POST', body });
    const run = name => api('/actions/run_workflow', { method: 'POST', body: { name } });
    try {
      assert.equal((await save({ title: 'my stack', steps: [{ action: 'keep_running', args: { spark: 'spark4', container: 'whoami' } }, { action: 'keep_running', args: { spark: 'spark4', container: 'quiet-app' } }] })).status, 200);
      const r = await run('my stack');
      assert.equal(r.json?.outcome, 'started', r.text);
      const w = await finished(r.json.operation);
      assert.equal(w.status, 'completed', JSON.stringify(w));
      assert.deepEqual([stateOf('spark4', 'whoami'), stateOf('spark4', 'quiet-app')], ['running', 'running']);
      assert.equal((await save({ title: 'new image stack', steps: [{ action: 'keep_running', args: { spark: 'spark4', container: 'wf-new', image: 'nginx:1.27', port: `${PDEAD}:80` } }] })).status, 200);
      const n = await run('new image stack');
      assert.equal(n.json?.outcome, 'started', n.text);
      const nw = await finished(n.json.operation);
      assert.equal(nw.status, 'failed', JSON.stringify(nw));
      assert.match(nw.error, /Step 1 \(keep_running\) needs an answer first/);
      assert.equal(stateOf('spark4', 'wf-new'), undefined, 'nothing started');
    } finally {
      for (const name of ['my stack', 'new image stack']) await api('/actions/forget_workflow', { method: 'POST', body: { name } });
    }
  });
});

test('new apps and jobs resolve the console’s HTTPS name to its own tailnet address', { timeout: 180000 * SLOW }, async () => {
  const hostname = 'route-hub.test.ts.net', address = '100.64.9.2';
  const fleet = await startMock({ prepare: ({ dir }) => writeFileSync(join(dir, 'status.json'), JSON.stringify({
    BackendState: 'Running',
    Self: { DNSName: `${hostname}.`, TailscaleIPs: ['fd7a:115c:a1e0::2', '192.168.0.2', address] },
    Peer: { 'nodekey:peer': { DNSName: 'compute.test.ts.net.', TailscaleIPs: ['100.64.9.3'] } },
  })) });
  try {
    const origin = new URL(fleet.origin);
    origin.hostname = hostname;
    await waitFor(async () => (await (await fetch(`${fleet.base}/bootstrap`)).json()).main === origin.origin,
      { what: 'the hub’s own name from Tailscale' });
    const headers = { 'content-type': 'application/json', 'x-spark-console': '1', origin: origin.origin };
    for (const body of [
      { spark: 'spark3', container: 'model-client-app', image: 'nginx:1.27', port: `${P3}:80` },
      { spark: 'spark4', container: 'model-client-job', image: 'python:3.12-slim', once: true },
    ]) {
      const r = await fetch(`${fleet.base}/actions/keep_running`, { method: 'POST', headers, body: JSON.stringify(body) });
      const result = await r.json();
      assert.equal(result.outcome, 'started', JSON.stringify(result));
      const file = mock(fleet.root, body.spark, `run-${body.container}`);
      const args = await waitFor(() => {
        const words = existsSync(file) && readFileSync(file, 'utf8').trimEnd().split('\n');
        return words && words.at(-1) === body.image && words;
      }, { what: `the Docker options for ${body.container}` });
      assert.deepEqual(args.filter(a => a.startsWith('--add-host')), [`--add-host=${hostname}:${address}`]);
      assert.ok(args.indexOf(`--add-host=${hostname}:${address}`) < args.indexOf(body.image), 'Docker gets the mapping');
      assert.ok(!args.some(a => /^--network(?:=|$)/.test(a)), 'the container uses Docker’s default bridge');
    }
  } finally { await fleet.stop(); }
});
