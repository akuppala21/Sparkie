// Covers: `/health` and its `build` (the first 12 hex of sha256 of `server.mjs` + `dig.mjs` + `passkey.mjs`), its new
// fields, also on the private socket; the watcher (`workloads` lists every container after a few seconds; a container
// stopping, starting or disappearing, and a Spark going offline and coming back, become `fleet_events`; `workloads
// detail` hides secrets); refusing requests whose `X-Forwarded-For` is a Spark's address; oversized bodies get 413
// JSON; `/v1`: `sparkie`, Sparkie's own model id and no model are answered, any other model → 404 naming `sparkie`;
// `/status` without the removed `model`/`cluster`/ray/codex fields; `internet` is null (not known) while Tailscale's
// answer doesn't name the main address (and `/status` says not known), true or false once it does.
//
// The service as a whole on the stand-in fleet: /health and its build id, the watcher (workloads, fleet_events, Sparks
// going offline and coming back), requests from the Sparks' own addresses, and oversized bodies.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { join, dirname } from 'node:path';
import { T, useFleet, SERVICE_FILE, post, rpc, call, api, createKey, waitFor, sleep, bug, SLOW, newChat, say } from './lib.mjs';
import { startMock, serviceConfig } from './start-mock.mjs';

let key;
useFleet({ watchMs: 3000 }, async () => { key = (await createKey('fleet')).token; });

const tool = async (name, args) => {
  const r = await call(key, name, args);
  assert.equal(r.isError, false, r.raw);
  return r.value;
};
const containersFile = spark => join(T.fleet.root, spark, '.mock', 'containers');
const editContainers = (spark, fn) => writeFileSync(containersFile(spark), fn(readFileSync(containersFile(spark), 'utf8')));

describe('/health', () => {
  test('answers with the build: the first 12 hex of sha256(server.mjs + dig.mjs + passkey.mjs)', async () => {
    const h0 = createHash('sha256');
    for (const f of ['server.mjs', 'dig.mjs', 'passkey.mjs']) h0.update(readFileSync(join(dirname(SERVICE_FILE), f)));
    const build = h0.digest('hex').slice(0, 12);
    const r = await fetch(`${T.base}/health`);
    assert.equal(r.status, 200);
    const h = await r.json();
    assert.equal(h.ok, true);
    assert.equal(h.build, build);
    assert.match(h.version, /^\d+\.\d+\.\d+$/);
    assert.ok(!Number.isNaN(Date.parse(h.startedAt)));
    assert.equal(h.apiLocked, false);
    // Whether agents are paused, the last copy of the state (none yet here) and how many Sparks answer.
    assert.equal(h.agentsPaused, false);
    assert.equal(h.lastBackup, null);
    assert.ok([3, 4].includes(h.sparksOnline), String(h.sparksOnline));
    // (spark1 counts as offline once two looks at it have failed)
    await waitFor(async () => (await (await fetch(`${T.base}/health`)).json()).sparksOnline === 3, { timeout: 20000, what: 'sparksOnline 3' });
  });
  test('also on the private socket, which only this account can open', async () => {
    assert.equal(statSync(T.fleet.socket).mode & 0o777, 0o600);
    const h = await new Promise((resolve, reject) => {
      http.get({ socketPath: T.fleet.socket, path: '/console/api/health' }, res => {
        let d = '';
        res.on('data', c => { d += c; });
        res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(d) }));
      }).on('error', reject);
    });
    assert.equal(h.status, 200);
    assert.equal(h.json.ok, true);
    assert.equal(typeof h.json.build, 'string');
  });
  test('works without any identity (it\'s what the installer checks)', async () => {
    const r = await fetch(`${T.base}/health`, { headers: { 'tailscale-funnel-request': '?1' } });
    assert.equal(r.status, 200);
  });
  // The owner's reboot drill (2026-11-11): right after a boot tailscaled answers `serve status` before its settings are
  // loaded, with nothing in it. That isn't "closed to the internet": internet stays null (not known) until an answer names
  // the main address. The stand-in tailscale answers {} here, and the test's serve.json in a second, short-lived start.
  test('internet: not known (null) while Tailscale\'s answer doesn\'t name the main address; /status says not known', async () => {
    await sleep(1500); // (past the first route check, which runs as the service starts)
    const h = await (await fetch(`${T.base}/health`)).json();
    assert.equal(h.internet, null);
    assert.equal(h.apiLocked, false);
    const r = await say(await newChat(), '/status');
    assert.match(r.text, /\nOpen to the internet: not known\.$/);
  });
  test('internet: true or false once Tailscale\'s answer names the main address', { timeout: 90000 * SLOW }, async () => {
    const host = new URL(serviceConfig().origin).host;
    for (const [funnel, want] of [[true, true], [false, false]]) {
      const fleet = await startMock({ watchMs: 600000, statusMs: 600000, prepare: ({ dir }) => writeFileSync(join(dir, 'serve.json'),
        JSON.stringify({ TCP: { 8443: { HTTPS: true } }, Web: { [host]: { Handlers: { '/': { Path: '/x' } } } }, ...(funnel ? { AllowFunnel: { [host]: true } } : {}) })) });
      try {
        assert.equal(await waitFor(async () => { const v = (await (await fetch(`${fleet.base}/health`)).json()).internet; return v === null ? null : { v }; },
          { timeout: 15000, what: 'the route check' }).then(x => x.v), want);
      } finally { await fleet.stop(); }
    }
  });
});

describe('the watcher', () => {
  test('after a few seconds, workloads lists the containers on every online Spark', { timeout: 60000 * SLOW }, async () => {
    const w = await waitFor(async () => {
      const x = await tool('workloads', {});
      return ['spark2', 'spark3', 'spark4'].every(s => x.workloads.some(y => y.spark === s)) && x;
    }, { what: 'the first look at every Spark' });
    assert.ok(!Number.isNaN(Date.parse(w.observedAt)));
    const by = name => w.workloads.find(x => x.name === name);
    // started outside Spark Console (a benchmark with an sglang image), protected by the qwen-recipe-* rule
    const bench = w.workloads.find(x => x.spark === 'spark4' && x.name === 'qwen-recipe-aphex3k');
    assert.ok(bench, JSON.stringify(w.workloads.map(x => `${x.spark}/${x.name}`)));
    assert.equal(bench.kind, 'model');
    assert.equal(bench.running, true);
    assert.equal(bench.startedBySparkConsole, false);
    assert.equal(bench.protected, true);
    // Sparkie's own model
    assert.equal(by('sparkie-main').kind, 'sparkie');
    assert.equal(by('sparkie-main').spark, 'spark2');
    // a service and a stopped console deploy
    assert.equal(by('redis-cache').kind, 'service');
    assert.ok(w.workloads.some(x => x.running === false && x.startedBySparkConsole), 'stopped console deploys are kept');
    // filters
    const four = await tool('workloads', { spark: 'Spark 4', running: true });
    assert.ok(four.workloads.length && four.workloads.every(x => x.spark === 'spark4' && x.running));
  });
  test('workloads detail: command with secrets hidden, environment names only', async () => {
    const r = await call(key, 'workloads', { spark: 'spark4', detail: true });
    assert.equal(r.isError, false, r.raw);
    // the stand-in docker inspect puts a FAKE --api-key value in the command and a FAKE HF_TOKEN in the environment
    for (const secret of ['sk-abcdefghijklmnopqrstuvwxyz123', 'hf_secretsecretsecretsecret12']) assert.ok(!r.raw.includes(secret), `leaked ${secret}`);
    const w = r.value.workloads.find(x => x.name === 'qwen-recipe-aphex3k');
    assert.ok(w.command.includes('--api-key'));
    assert.equal(w.command[w.command.indexOf('--api-key') + 1], '[hidden]');
    assert.ok(w.envNames.includes('HF_TOKEN'));
    assert.ok(w.envNames.every(e => !e.includes('=')));
  });
  test('a container that stops, one that starts and one removed become fleet_events', { timeout: 60000 * SLOW }, async () => {
    const since = new Date().toISOString();
    editContainers('spark4', s => s.replace(/^qwen-recipe-aphex3k\|running\|[^|]*\|/m, 'qwen-recipe-aphex3k|exited|Exited (1) just now|')
      .replace(/^sc-Qwen--Qwen3-32B\|.*\n/m, '') + 'test-new-box|running|Up 1 second|0||\n');
    const evs = await waitFor(async () => {
      const x = await tool('fleet_events', { since, spark: 'spark4' });
      const has = (c, types) => x.events.some(e => e.container === c && types.includes(e.type));
      return has('qwen-recipe-aphex3k', ['crashed', 'stopped']) && has('test-new-box', ['started']) && has('sc-Qwen--Qwen3-32B', ['removed']) && x;
    }, { what: 'the three events' });
    const stopped = evs.events.find(e => e.container === 'qwen-recipe-aphex3k');
    // the stand-in docker reports exit code 1 for exited containers, which counts as a crash
    assert.equal(stopped.type, 'crashed');
    assert.equal(stopped.exitCode, 1);
    assert.equal(stopped.outside, true);
    assert.ok(evs.events.every(e => e.at > since));
    // the type filter, and workloads agrees
    const crashed = await tool('fleet_events', { type: 'crashed', spark: '4' });
    assert.ok(crashed.events.length && crashed.events.every(e => e.type === 'crashed'));
    const w = await tool('workloads', { spark: 'spark4' });
    assert.equal(w.workloads.find(x => x.name === 'qwen-recipe-aphex3k').running, false);
    assert.equal(w.workloads.find(x => x.name === 'test-new-box').running, true);
    assert.equal(w.workloads.find(x => x.name === 'sc-Qwen--Qwen3-32B').state, 'removed');
  });
  test('a Spark coming back and going offline again become fleet_events', { timeout: 90000 * SLOW }, async () => {
    const since = new Date().toISOString();
    writeFileSync(T.fleet.offlineFile, '');
    await waitFor(async () => (await tool('fleet_events', { since, type: 'spark-online' })).events.some(e => e.spark === 'spark1'), { what: 'spark1 coming back', timeout: 40000 });
    const fleet = await tool('fleet_status', {});
    assert.equal(fleet.sparks.find(s => s.id === 'spark1').state, 'online');
    const back = new Date().toISOString();
    writeFileSync(T.fleet.offlineFile, 'spark1\n');
    await waitFor(async () => (await tool('fleet_events', { since: back, type: 'spark-offline' })).events.some(e => e.spark === 'spark1'), { what: 'spark1 going offline', timeout: 40000 });
  });
});

describe('requests from the Sparks themselves', () => {
  const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };
  for (const ip of ['100.64.0.1', '100.64.0.2', '100.64.0.3', '100.64.0.4']) {
    test(`the agent door refuses X-Forwarded-For ${ip} (a Spark), even with a good key`, async () => {
      const r = await post(ping, { token: key, headers: { 'x-forwarded-for': ip } });
      assert.equal(r.status, 403, r.text);
      assert.match(r.json?.error, /Requests from the Sparks themselves can’t act as a person/);
    });
  }
  test('the last address in X-Forwarded-For is the one that counts', async () => {
    assert.equal((await post(ping, { token: key, headers: { 'x-forwarded-for': '203.0.113.9, 100.64.0.3' } })).status, 403);
    assert.equal((await post(ping, { token: key, headers: { 'x-forwarded-for': '100.64.0.3, 100.64.0.77' } })).status, 200);
  });
  test('another tailnet address is fine', async () => {
    const r = await post(ping, { token: key, headers: { 'x-forwarded-for': '100.64.0.77' } });
    assert.equal(r.status, 200, r.text);
  });
  test('page routes refuse a Spark\'s address too', async () => {
    for (const [path, method] of [['/agents', 'GET'], ['/actions', 'GET'], ['/agents', 'POST']]) {
      const r = await api(path, { method, body: method === 'POST' ? { name: 'from-a-spark' } : undefined, headers: { 'x-forwarded-for': '100.64.0.4' } });
      assert.equal(r.status, 403, `${method} ${path}: ${r.text}`);
    }
  });
});

describe('oversized bodies get 413 JSON, not a dropped connection', () => {
  test('agent door: over 1 MB → 413 JSON-RPC error', { timeout: 60000 * SLOW }, async () => {
    const big = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { pad: 'x'.repeat(1_100_000) } });
    const r = await post(big, { token: key }).catch(e => e);
    assert.ok(!(r instanceof Error), `connection dropped: ${r?.cause?.code || r?.message}`);
    assert.equal(r.status, 413, r.text);
    assert.equal(r.json?.jsonrpc, '2.0', r.text);
    assert.match(r.json.error.message, /too large/i);
    assert.equal((await fetch(`${T.base}/health`)).status, 200);
    assert.equal((await rpc(key, 'ping')).status, 200, 'the key still works');
  });
  test('page route: over 100 KB → 413 {"error"}', { timeout: 60000 * SLOW }, async () => {
    const r = await api('/agents', { method: 'POST', rawBody: JSON.stringify({ name: 'big', pad: 'x'.repeat(200_000) }) }).catch(e => e);
    assert.ok(!(r instanceof Error), `connection dropped: ${r?.cause?.code || r?.message}`);
    assert.equal(r.status, 413, r.text);
    assert.match(r.json?.error, /too large/i);
  });
  test('the service is still fine afterwards', async () => {
    await sleep(200);
    assert.equal((await fetch(`${T.base}/health`)).status, 200);
    assert.equal((await call(key, 'fleet_status', {})).isError, false);
  });
});

describe('the OpenAI-compatible address (/v1)', () => {
  const ask = model => api('/v1/chat/completions', { method: 'POST', body: { ...(model === undefined ? {} : { model }), messages: [{ role: 'user', content: 'hi' }], stream: true },
    headers: { 'x-spark-console': null, origin: null } });
  test('GET /v1/models lists "sparkie" and Sparkie\'s own model first, then the models running on the Sparks', async () => {
    const r = await api('/v1/models');
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.data[0].id, 'sparkie');
    assert.equal(r.json.data.filter(m => !m.spark).length, 2, r.text);
    assert.ok(r.json.data.slice(2).every(m => m.spark), r.text);
  });
  test('"sparkie", Sparkie\'s own model id and no model at all are answered', { timeout: 30000 * SLOW }, async () => {
    const own = (await api('/v1/models')).json.data[1].id;
    for (const model of ['sparkie', own, undefined, null, '']) {
      const r = await ask(model);
      assert.equal(r.status, 200, `${JSON.stringify(model)}: ${r.text.slice(0, 200)}`);
      assert.match(r.text, /^data: /);
    }
  });
  test('every model Spark Console runs is at the same address (gpt-oss-20b, running on Spark 2), and listed', async () => {
    assert.ok((await api('/v1/models')).json.data.some(m => m.id === 'gpt-oss-20b' && m.spark === 'spark2'));
    const r = await ask('gpt-oss-20b');
    assert.equal(r.status, 200, r.text.slice(0, 200));
    assert.match(r.text, /^data: /);
  });
  test('a model this address doesn\'t serve and can\'t start → 404 that names "sparkie", not another model\'s answer', async () => {
    for (const model of ['gpt-4o', 'SPARKIE']) {
      const r = await ask(model);
      assert.equal(r.status, 404, `${model}: ${r.text}`);
      assert.match(r.json.error.message, new RegExp(`No model called “${model}” at this address`));
      assert.match(r.json.error.message, /Use "sparkie"/);
    }
  });
});

describe('what the Sparks report', () => {
  test('GET /status: no Sparkie model or cluster summary, and the workers\' old fields are gone', async () => {
    const r = await api('/status');
    assert.equal(r.status, 200, r.text);
    assert.ok(!('model' in r.json) && !('cluster' in r.json), Object.keys(r.json).join(', '));
    for (const n of r.json.nodes.filter(x => x.state === 'online')) for (const k of ['rayActive', 'rayInstalled', 'codexInstalled', 'codexAuthenticated', 'model']) assert.ok(!(k in n), `${n.id}.${k}`);
    assert.ok(r.json.nodes.some(n => n.state === 'online' && Array.isArray(n.runningContainers)));
  });
  test('an unreachable Spark\'s entry has no model field either', {}, async () => {
    const off = (await api('/status')).json.nodes.find(n => n.id === 'spark1');
    assert.notEqual(off.state, 'online');
    assert.ok(!('model' in off), JSON.stringify(off));
  });
});
