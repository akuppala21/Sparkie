// Agent door (MCP): handshake, every read tool with valid and invalid arguments, auth, key lifecycle, masking, rate limit.
// What a key that can act sees and does (start_model, stop_model, restart_model) is in change.test.mjs.
// Run with the rest: node --test --test-concurrency=4 'test/*.test.mjs'   (SPARK_TEST_STRICT=1 makes known product bugs fail)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { T, useFleet, TOOLS, CHANGE_TOOLS, ALL_TOOLS, ASK, DOOR_READ, post, rpc, call, api, createKey, createActKey, deleteKey, KeyPool, OWNER, MEMBER, bug } from './lib.mjs';

const pool = new KeyPool('door');
// At most 6 web searches a minute per key, so the tools that reach the web (search_huggingface, search_web, read_page)
// get their own keys.
const OPEN_WORLD = ['search_huggingface', 'search_web', 'read_page'];
const hfPool = new KeyPool('door-hf', 5);
const tokenFor = tool => (OPEN_WORLD.includes(tool) ? hfPool : pool).token();
const ctx = {};

function assertNoKey(r) {
  assert.equal(r.status, 403, `status ${r.status}: ${r.text}`);
  assert.equal(r.json?.jsonrpc, '2.0', r.text);
  assert.equal(r.json.error?.code, -32600, r.text);
  assert.match(r.json.error.message, /needs its own key/);
}
// A raw request, for headers fetch won't let us leave out (no content-type at all).
function raw(method, path, headers, body) {
  const u = new URL(T.base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + path, method, headers }, res => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => { let json = null; try { json = JSON.parse(data); } catch {} resolve({ status: res.statusCode, headers: res.headers, text: data, json }); });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
function assertRpcOk(r, id) {
  assert.equal(r.status, 200, r.raw ?? r.text);
  assert.equal(r.json?.jsonrpc, '2.0');
  if (id !== undefined) assert.equal(r.json.id, id);
  assert.ok(r.json.result, `expected result: ${r.raw ?? r.text}`);
}
function assertRpcError(r, status, code) {
  assert.equal(r.status, status, r.text);
  assert.equal(r.json?.jsonrpc, '2.0', r.text);
  assert.equal(r.json.error?.code, code, r.text);
  assert.equal(typeof r.json.error.message, 'string');
}
// A tool result that worked: one text item holding valid JSON.
function assertToolOk(r) {
  assertRpcOk(r);
  const content = r.json.result.content;
  assert.ok(Array.isArray(content) && content.length >= 1, r.text);
  assert.equal(content[0].type, 'text');
  assert.equal(r.json.result.isError, false, `tool failed: ${r.raw}`);
  assert.doesNotThrow(() => JSON.parse(content[0].text), 'tool output is not valid JSON');
  return JSON.parse(content[0].text);
}
// A refused or failed tool call: isError, a "[code]" first, then the message; never an internal exception.
const CODES = ['invalid', 'not_allowed', 'not_found', 'conflict', 'too_large', 'busy', 'unreachable', 'failed'];
function assertToolError(r, re, code) {
  assertRpcOk(r);
  assert.equal(r.json.result.isError, true, `expected isError: ${String(r.raw).slice(0, 300)}`);
  const text = r.json.result.content[0].text;
  const m = /^\[([a-z_]+)(, retry later)?\] /.exec(text);
  assert.ok(m && CODES.includes(m[1]), `no error code first: ${text}`);
  if (code) assert.equal(m[1], code, text);
  if (re) assert.match(text, re);
  assert.doesNotMatch(text, /TypeError|ReferenceError|Cannot read|is not a function|undefined/);
}
const isTime = s => typeof s === 'string' && !Number.isNaN(Date.parse(s));

useFleet({}, async () => {
  // Live values from the stand-in fleet for the valid-argument calls.
  const fleet = assertToolOk(await call(await pool.token(), 'fleet_status', {}));
  ctx.online = fleet.sparks.filter(s => s.state === 'online').map(s => s.id);
  ctx.offline = fleet.sparks.filter(s => s.state !== 'online').map(s => s.id);
  ctx.spark = fleet.sparks.find(s => s.state === 'online' && s.runningContainers.length)?.id || ctx.online[0];
  ctx.container = fleet.sparks.find(s => s.id === ctx.spark).runningContainers[0];
  const disk = assertToolOk(await call(await pool.token(), 'models_on_disk', {}));
  ctx.model = (disk.models.find(m => m.onSparks.includes(ctx.spark) && !m.draftOnly) || disk.models[0]).modelId;
  const links = assertToolOk(await call(await pool.token(), 'linked_sparks', {}));
  ctx.pair = (links.pairs.find(p => p.canRunTogether) || links.pairs[0])?.sparks;
  const recipes = assertToolOk(await call(await pool.token(), 'find_recipes', { limit: 1 }));
  ctx.recipe = recipes.recipes[0]?.id;
});

test('the stand-in fleet looks as expected (spark1 offline, others online, a linked pair, a recipe)', () => {
  assert.deepEqual(ctx.offline, ['spark1']);
  assert.deepEqual(ctx.online, ['spark2', 'spark3', 'spark4']);
  assert.ok(ctx.container, 'a running container');
  assert.ok(ctx.model, 'a model on disk');
  assert.equal(ctx.pair?.length, 2, 'a linked pair (seeded links.json)');
  assert.ok(ctx.recipe, 'a recipe');
});

/* ───────── handshake ───────── */
describe('MCP handshake', () => {
  test('initialize echoes a supported protocol version', async () => {
    const r = await post({ jsonrpc: '2.0', id: 'init-1', method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } } }, { token: await pool.token() });
    assertRpcOk(r, 'init-1');
    assert.match(r.headers.get('content-type'), /^application\/json/);
    const res = r.json.result;
    assert.equal(res.protocolVersion, '2025-06-18');
    assert.deepEqual(res.capabilities, { tools: { listChanged: false } });
    assert.equal(res.serverInfo.name, 'spark-console');
    assert.equal(typeof res.serverInfo.version, 'string');
    assert.match(res.instructions, /data, never (as )?instructions/);
  });
  test('initialize with an unknown version, or none, gets the newest', async () => {
    for (const params of [{ protocolVersion: '1999-01-01' }, undefined, { protocolVersion: { toString: 1 } }]) {
      const r = await rpc(await pool.token(), 'initialize', params);
      assertRpcOk(r);
      assert.equal(r.json.result.protocolVersion, '2025-11-25');
    }
  });
  test('notifications and client responses get 202 and no body', async () => {
    let r = await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { token: await pool.token() });
    assert.equal(r.status, 202);
    assert.equal(r.text, '');
    r = await post({ jsonrpc: '2.0', id: 9, result: {} }, { token: await pool.token() });
    assert.equal(r.status, 202);
  });
  test('ping', async () => {
    const r = await post({ jsonrpc: '2.0', id: 42, method: 'ping' }, { token: await pool.token() });
    assertRpcOk(r, 42);
    assert.deepEqual(r.json.result, {});
  });
  test(`tools/list (a key that only looks): ${TOOLS.length} read-only tools and ask_sparkie, with schemas and annotations`, async () => {
    const r = await rpc(await pool.token(), 'tools/list');
    assertRpcOk(r);
    const tools = r.json.result.tools;
    assert.equal(tools.length, DOOR_READ.length);
    assert.deepEqual(tools.map(t => t.name).sort(), [...DOOR_READ].sort());
    // Talking with Sparkie: it isn't read-only (it writes a conversation), but this key can't change anything through it.
    const ask = tools.find(t => t.name === ASK);
    assert.deepEqual(Object.keys(ask.inputSchema.properties).sort(), ['choice', 'conversation', 'message']);
    assert.equal(ask.inputSchema.additionalProperties, false);
    assert.deepEqual(ask.annotations, { title: ask.title, readOnlyHint: false, destructiveHint: false, openWorldHint: false });
    for (const t of tools.filter(x => x.name !== ASK)) {
      assert.equal(typeof t.title, 'string', t.name);
      assert.ok(t.description.length > 20, t.name);
      assert.equal(t.inputSchema.type, 'object', t.name);
      assert.equal(t.inputSchema.additionalProperties, false, t.name);
      for (const k of t.inputSchema.required || []) assert.ok(t.inputSchema.properties[k], `${t.name} requires undeclared ${k}`);
      for (const [k, p] of Object.entries(t.inputSchema.properties)) {
        assert.ok(['string', 'integer', 'boolean', 'array'].includes(p.type), `${t.name}.${k}`);
        if (p.pattern) assert.doesNotThrow(() => new RegExp(p.pattern), `${t.name}.${k} pattern`);
        // Spark arguments list the real Spark ids.
        const sp = p.type === 'array' ? p.items : p;
        if (/spark/.test(k)) assert.deepEqual(sp.enum, ['spark1', 'spark2', 'spark3', 'spark4'], `${t.name}.${k}`);
      }
      assert.equal(t.annotations.readOnlyHint, true, t.name);
      assert.equal(t.annotations.destructiveHint, false, t.name);
      assert.equal(t.annotations.openWorldHint, OPEN_WORLD.includes(t.name), t.name);
    }
  });
  test('unknown method → -32601 with the id', async () => {
    const r = await post({ jsonrpc: '2.0', id: 'u1', method: 'resources/list' }, { token: await pool.token() });
    assertRpcError(r, 200, -32601);
    assert.equal(r.json.id, 'u1');
  });
  test('batch array → 400 -32600', async () => {
    const r = await post([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: 2, method: 'ping' }], { token: await pool.token() });
    assertRpcError(r, 400, -32600);
    assert.equal(r.json.id, null);
  });
  test('GET → 405 with Allow: POST; DELETE and PUT → 405', async () => {
    const r = await post(undefined, { token: await pool.token(), method: 'GET' });
    assert.equal(r.status, 405);
    assert.equal(r.headers.get('allow'), 'POST');
    for (const method of ['DELETE', 'PUT']) assert.equal((await post({}, { token: await pool.token(), method })).status, 405, method);
  });
  test('invalid JSON → 400 -32700; empty body → 400 -32600', async () => {
    assertRpcError(await post('{"jsonrpc":"2.0",', { token: await pool.token() }), 400, -32700);
    assertRpcError(await post('', { token: await pool.token() }), 400, -32600);
  });
  test('jsonrpc "1.0" / missing / not an object → 400 -32600', async () => {
    for (const body of [{ jsonrpc: '1.0', id: 1, method: 'ping' }, { id: 1, method: 'ping' }, 'null', '"ping"', '42']) {
      assertRpcError(await post(body, { token: await pool.token() }), 400, -32600);
    }
  });
  test('bad ids → 400 -32600; string and number ids are echoed', async () => {
    for (const id of [null, true, { a: 1 }, [1], 'x'.repeat(201)]) assertRpcError(await post({ jsonrpc: '2.0', id, method: 'ping' }, { token: await pool.token() }), 400, -32600);
    for (const id of [0, -7, 1.5, '', 'x'.repeat(200)]) assertRpcOk(await post({ jsonrpc: '2.0', id, method: 'ping' }, { token: await pool.token() }), id);
  });
  test('tools/call: unknown tool, missing or non-string name → -32602', async () => {
    for (const params of [{ name: 'deploy_model', arguments: {} }, undefined, { name: ['fleet_status'] }, { name: { toString: 'x' } }, { name: 7 }, { name: null }]) {
      assertRpcError(await rpc(await pool.token(), 'tools/call', params), 200, -32602);
    }
  });
  test('a method that isn\'t a string → 400 -32600, not a 500', async () => {
    for (const method of [{ toString: 1 }, ['ping'], 7, null]) {
      const r = await post({ jsonrpc: '2.0', id: 1, method }, { token: await pool.token() });
      assertRpcError(r, 400, -32600);
    }
  });
  test('tools/call: arguments must be an object; null or absent count as {}', async () => {
    for (const args of [[], 'spark2', 7, true]) assertToolError(await call(await pool.token(), 'fleet_status', args), /Arguments must be an object/, 'invalid');
    assertToolOk(await call(await pool.token(), 'sparkie_setup', null));
    assertToolOk(await call(await pool.token(), 'sparkie_setup', undefined));
  });
});

/* ───────── every tool with valid arguments ───────── */
describe(`${TOOLS.length} read tools, valid arguments`, () => {
  const v = (label, args, check) => test(label, async () => {
    const name = label.split(' ')[0];
    const value = assertToolOk(await call(await tokenFor(name), name, typeof args === 'function' ? args() : args));
    await check?.(value);
  });
  v('fleet_status', {}, x => {
    assert.ok(isTime(x.observedAt));
    assert.deepEqual(x.sparks.map(s => s.id), ['spark1', 'spark2', 'spark3', 'spark4']);
    const on = x.sparks.find(s => s.state === 'online');
    for (const k of ['gpuUtilizationPercent', 'memoryTotalGB', 'memoryFreeGB', 'diskFreeGB', 'temperatureC', 'runningContainers', 'issues']) assert.ok(k in on, k);
    const off = x.sparks.find(s => s.id === 'spark1');
    assert.notEqual(off.state, 'online');
    assert.equal(typeof off.problem, 'string');
  });
  v('running_models', {}, x => {
    assert.ok(isTime(x.observedAt));
    assert.match(x.gateway.baseUrl, /\/console\/api\/v1$/);
    assert.equal(x.gateway.model, 'sparkie');
    for (const k of ['models', 'otherServers', 'otherContainers', 'stopped', 'offline']) assert.ok(Array.isArray(x[k]), k);
    assert.deepEqual(x.offline, ['spark1']);
    assert.ok(x.sparkie && x.sparkie.spark === 'spark2', 'Sparkie\'s model on spark2');
  });
  v('models_on_disk', {}, x => {
    assert.ok(x.models.length >= 1);
    for (const m of x.models) { assert.equal(typeof m.modelId, 'string'); assert.ok(Array.isArray(m.onSparks)); }
    assert.ok(Array.isArray(x.stillDownloading) && Array.isArray(x.offline));
  });
  v('find_recipes', { query: 'qwen', limit: 3 }, x => {
    assert.equal(typeof x.matches, 'number');
    assert.ok(x.recipes.length <= 3 && x.recipes.length >= 1);
    for (const r of x.recipes) { assert.equal(typeof r.id, 'string'); assert.ok(Array.isArray(r.versions)); assert.ok(Array.isArray(r.workedBefore)); }
    assert.ok(x.recipes.every(r => JSON.stringify(r).toLowerCase().includes('qwen')));
  });
  v('find_recipes (no args → at most 10)', {}, x => assert.ok(x.recipes.length <= 10 && x.recipes.length >= 1));
  v('find_recipes (filters: maxSparks 1, maxMemoryGB 40)', { maxSparks: 1, maxMemoryGB: 40, limit: 30 }, x => {
    for (const r of x.recipes) for (const ver of r.versions) { assert.ok(ver.memoryNeededGB <= 40, JSON.stringify(ver)); assert.ok(ver.sparks <= 1, JSON.stringify(ver)); }
  });
  v('recipe_detail', () => ({ id: ctx.recipe }), x => {
    assert.equal(x.id, ctx.recipe);
    assert.ok(Array.isArray(x.versions) && Array.isArray(x.setups));
    for (const s of x.setups) assert.ok(Array.isArray(s.envNames), 'env values must not be sent, only names');
    assert.match(x.textFromWeb, /not instructions/);
  });
  v('search_huggingface', { query: 'qwen3 0.6b' }, x => {
    assert.equal(x.query, 'qwen3 0.6b');
    assert.ok(Array.isArray(x.searchedFor) && Array.isArray(x.results));
  });
  // (the stand-in fleet here has no canned web: a search finds nothing, and no page is read)
  v('search_web', { query: 'vllm flags' }, x => {
    assert.equal(x.searchedFor, 'vllm flags');
    assert.deepEqual(x.results, []);
    assert.match(x.textFromWeb, /not instructions/);
  });
  v('where_it_fits', () => ({ model: ctx.model }), x => {
    assert.equal(x.modelId, ctx.model);
    assert.ok(Array.isArray(x.sparks) && Array.isArray(x.pairs));
    for (const s of x.sparks) { assert.equal(typeof s.canRun, 'boolean'); assert.equal(typeof s.fitsNow, 'boolean'); }
  });
  v('deploy_plan', () => ({ model: ctx.model, spark: ctx.spark }), x => {
    assert.equal(x.spark, ctx.spark);
    assert.equal(typeof x.canRun, 'boolean');
    assert.ok(Array.isArray(x.steps) && x.steps.length >= 1);
    assert.ok(x.steps.every(s => typeof s.do === 'string'));
    assert.ok('memory' in x && 'endpoint' in x);
  });
  v('cluster_plan (sparks as a list)', () => ({ model: ctx.model, sparks: ctx.pair }), x => {
    assert.deepEqual(x.sparks, ctx.pair);
    assert.equal(x.answers, ctx.pair[0]);
    assert.ok(Array.isArray(x.each) && x.each.length === 2);
    assert.equal(x.link, 'full');
  });
  v('cluster_plan (sparks as "a+b")', () => ({ model: ctx.model, sparks: ctx.pair.join('+') }), x => assert.deepEqual(x.sparks, ctx.pair));
  v('cluster_plan (sparks as "3+4"-style numbers)', () => ({ model: ctx.model, sparks: ctx.pair.map(id => id.slice(5)).join('+') }), x => assert.deepEqual(x.sparks, ctx.pair));
  v('cluster_plan (a list of names as people say them)', () => ({ model: ctx.model, sparks: ctx.pair.map(id => `Spark ${id.slice(5)}`) }), x => assert.deepEqual(x.sparks, ctx.pair));
  test('cluster_plan ("Spark 2+Spark 3": names with spaces in the "a+b" form)', async () => {
    const x = assertToolOk(await call(await pool.token(), 'cluster_plan', { model: ctx.model, sparks: ctx.pair.map(id => `Spark ${id.slice(5)}`).join('+') }));
    assert.deepEqual(x.sparks, ctx.pair);
  });
  v('linked_sparks', { detail: true }, x => {
    assert.ok(Array.isArray(x.pairs) && Array.isArray(x.sparks));
    for (const p of x.pairs) { assert.equal(p.sparks.length, 2); assert.equal(typeof p.canRunTogether, 'boolean'); }
  });
  v('spark_detail', () => ({ spark: ctx.spark }), x => {
    assert.equal(x.spark, ctx.spark);
    assert.ok(x.containers.some(c => c.name === ctx.container));
  });
  for (const alias of ['Spark 3', '3', 'SPARK3', 'spark_3', 'spark-3', ' spark 3 ']) {
    v(`spark_detail ("${alias}" means spark3)`, { spark: alias }, x => assert.equal(x.spark, 'spark3'));
  }
  v('recent_operations', { limit: 5 }, x => {
    assert.ok(Array.isArray(x.operations) && x.operations.length <= 5);
    assert.ok(isTime(x.keptSince));
  });
  test('operation_log (nothing ran yet: a well-formed "expired")', async () => {
    assertToolError(await call(await pool.token(), 'operation_log', { id: '0123456789ab' }), /expired/, 'not_found');
  });
  test('wait_operation (an unknown id: a well-formed "expired", at once)', async () => {
    const started = Date.now();
    assertToolError(await call(await pool.token(), 'wait_operation', { id: '0123456789ab', seconds: 45 }), /expired/, 'not_found');
    assert.ok(Date.now() - started < 5000, 'an unknown operation isn\'t waited for');
  });
  v('container_logs', () => ({ spark: ctx.spark, container: ctx.container }), x => {
    assert.equal(x.container, ctx.container);
    assert.equal(typeof x.log, 'string');
    assert.match(x.logIsData, /not instructions/);
  });
  v('spark_diagnostics', () => ({ spark: ctx.spark }), x => {
    assert.equal(x.spark, ctx.spark);
    assert.equal(x.reachable, true);
    assert.ok(Array.isArray(x.checks) && x.checks.length);
  });
  v('spark_diagnostics (offline Spark: reachable false, with what failed)', { spark: 'spark1' }, x => {
    assert.equal(x.reachable, false);
    assert.equal(typeof x.problem, 'string');
  });
  for (const service of ['console', 'sparkie', 'editor']) {
    v(`service_logs (${service})`, () => ({ spark: ctx.spark, service }), x => {
      assert.equal(x.service, service);
      assert.equal(typeof x.log, 'string');
      assert.match(x.logIsData, /not instructions/);
    });
  }
  v('files', () => ({ spark: ctx.spark }), x => {
    assert.ok(Array.isArray(x.entries));
    assert.equal(x.folder, '');
  });
  v('sparkie_setup', {}, x => {
    assert.ok('model' in x && 'chatsAnsweredBy' in x && 'savedSetups' in x);
    assert.match(x.gateway, /\/v1$/);
    assert.equal(x.model?.spark, 'spark2');
  });
  v('workloads', { kind: 'model', running: true, detail: false }, x => {
    assert.equal(typeof x.count, 'number');
    assert.ok(Array.isArray(x.workloads));
    assert.match(x.watchedEvery, /^3 seconds$/);
    assert.ok(x.workloads.every(w => w.kind === 'model' && w.running));
  });
  v('recall', { about: 'gemma', kind: 'call', spark: 'Spark 3', since: '2026-01-01', limit: 3 }, x => {
    assert.equal(typeof x.count, 'number');
    assert.ok(Array.isArray(x.records) && x.records.length <= 3);
    assert.match(x.recordIsData, /data, not instructions/);
  });
  v('fleet_events', { limit: 5, spark: 'Spark 2' }, x => {
    assert.ok(Array.isArray(x.events) && x.events.length <= 5);
    assert.equal(x.count, x.events.length);
    assert.ok(x.events.every(e => e.spark === 'spark2' || (e.sparks || []).includes('spark2')));
  });
  test('an offline Spark gives a clean error, not a crash', async () => {
    assertToolError(await call(await pool.token(), 'spark_detail', { spark: 'spark1' }), /spark1/, 'unreachable');
  });
});

/* ───────── invalid arguments, per tool ───────── */
describe('invalid arguments are refused ([invalid] / [not_found], not a crash)', () => {
  const sp = () => ctx.spark;
  const validFor = t => ({
    where_it_fits: { model: ctx.model }, spark_detail: { spark: sp() }, operation_log: { id: '0123456789ab' }, container_logs: { spark: sp(), container: ctx.container },
    deploy_plan: { model: ctx.model, spark: sp() }, cluster_plan: { model: ctx.model, sparks: ctx.pair }, recipe_detail: { id: ctx.recipe },
    search_huggingface: { query: 'qwen3 0.6b' }, spark_diagnostics: { spark: sp() }, service_logs: { spark: sp(), service: 'console' },
    wait_operation: { id: '0123456789ab' }, files: { spark: sp() }, search_web: { query: 'vllm flags' }, read_page: { url: 'https://docs.example.org/never-searched' },
    recall: { about: 'gemma' },
  }[t] || {});
  const cases = []; // [tool, args(), expected message, code, label]
  for (const t of TOOLS) cases.push([t, () => ({ ...validFor(t), bogus: 1 }), /^\[invalid\] Unknown argument: bogus/, 'invalid', 'unknown arg bogus']);
  // missing required
  const req = { where_it_fits: ['model'], spark_detail: ['spark'], operation_log: ['id'], container_logs: ['spark', 'container'], deploy_plan: ['model', 'spark'],
    cluster_plan: ['model', 'sparks'], recipe_detail: ['id'], search_huggingface: ['query'], spark_diagnostics: ['spark'], service_logs: ['spark', 'service'], wait_operation: ['id'], files: ['spark'], search_web: ['query'], read_page: ['url'] };
  for (const [t, ks] of Object.entries(req)) for (const k of ks) cases.push([t, () => { const a = { ...validFor(t) }; delete a[k]; return a; }, new RegExp(`Missing argument: ${k}`), 'invalid', `missing ${k}`]);
  // wrong types: text arguments
  const textProps = { find_recipes: ['query', 'category'], where_it_fits: ['model'], operation_log: ['id'], container_logs: ['container'], deploy_plan: ['model'],
    cluster_plan: ['model'], recipe_detail: ['id', 'setup'], search_huggingface: ['query'], fleet_events: ['since'], wait_operation: ['id'], files: ['folder', 'file'], search_web: ['query'], read_page: ['url'],
    recall: ['about', 'id', 'since', 'next'] };
  for (const [t, ks] of Object.entries(textProps)) for (const k of ks) {
    cases.push([t, () => ({ ...validFor(t), [k]: 123 }), new RegExp(`${k} should be text`), 'invalid', `${k}=123`]);
    cases.push([t, () => ({ ...validFor(t), [k]: ['x'] }), new RegExp(`${k} should be text`), 'invalid', `${k}=[array]`]);
  }
  // wrong types: Spark arguments (a Spark name is looked up, so anything else is "no Spark called …")
  const sparkProps = { spark_detail: 'spark', container_logs: 'spark', deploy_plan: 'spark', spark_diagnostics: 'spark', service_logs: 'spark', workloads: 'spark', fleet_events: 'spark', files: 'spark', recall: 'spark' };
  for (const [t, k] of Object.entries(sparkProps)) {
    for (const val of [123, true, { id: 'spark2' }, 'spark99', '../spark2', 'spark2;id', '$(id)', '', 'x'.repeat(41)]) {
      cases.push([t, () => ({ ...validFor(t), [k]: val }), new RegExp(`${k}: no Spark called|${k} should be text`), 'invalid', `${k}=${JSON.stringify(val).slice(0, 20)}`]);
    }
  }
  // integers
  for (const [t, k, max] of [['find_recipes', 'limit', 30], ['recent_operations', 'limit', 50], ['fleet_events', 'limit', 200], ['find_recipes', 'maxSparks', 4], ['find_recipes', 'maxMemoryGB', 2000], ['wait_operation', 'seconds', 45], ['recall', 'limit', 20]]) {
    for (const n of ['5', true, null, 0, -1, max + 1, 1.5, 1e300]) {
      cases.push([t, () => ({ ...validFor(t), [k]: n }), new RegExp(`${k} should be a whole number from 1 to ${max}`), 'invalid', `${k}=${JSON.stringify(n)}`]);
    }
  }
  for (const n of ['5', true, null, -1, 2097153, 1.5, 1e300]) {
    cases.push(['read_page', () => ({ ...validFor('read_page'), from: n }), /from should be a whole number from 0 to 2097152/, 'invalid', `from=${JSON.stringify(n)}`]);
  }
  // booleans
  for (const [t, k] of [['linked_sparks', 'detail'], ['workloads', 'running'], ['workloads', 'detail'], ['recipe_detail', 'all']]) {
    for (const b of ['true', 1, null]) cases.push([t, () => ({ ...validFor(t), [k]: b }), new RegExp(`${k} should be true or false`), 'invalid', `${k}=${JSON.stringify(b)}`]);
  }
  // patterns
  const badPatterns = {
    where_it_fits: { model: ['../etc/passwd', '-rf', 'a b', '', '.x'] },
    operation_log: { id: ['0123456789AB', '0123456789a', 'zzzzzzzzzzzz', '0123456789abc'] },
    wait_operation: { id: ['0123456789AB', '0123456789a', '../012345678', '0123456789abc'] },
    container_logs: { container: ['-v', '.hidden', 'a/b', 'a b', 'x'.repeat(129)] },
    deploy_plan: { model: ['../x', '$HOME'] },
    cluster_plan: { model: ['$HOME'] },
    recipe_detail: { id: ['Qwen3', '-x', '.x', 'a/b'], setup: ['abc', 'ABCD', 'x'.repeat(33)] },
    search_huggingface: { query: ['a', ' a ', '   '] },
    fleet_events: { since: ['yesterday', '2026-1-1', '2026-11-04T10:00:00+01:00'] },
    files: { folder: ['.git', '../x', '/etc', 'a//b'], file: ['.env', 'notes/.envrc', '../../etc/passwd', 'a\\b'] },
    search_web: { query: ['a', ' a ', '   '] },
    read_page: { url: ['ftp://example.org/x', 'file:///etc/passwd', 'javascript:alert(1)', 'example.org/x', 'http://', 'https://a b'] },
    recall: { about: ['a', ' a ', '   '], id: ['0123456789ab', 'j_0123456789AB', 'j_0123456789a', 'j_../etc/passw'], since: ['yesterday', '2026-1-1'], next: ['-1', '1.5', 'x', '1234567890'] },
  };
  for (const [t, props] of Object.entries(badPatterns)) for (const [k, vals] of Object.entries(props)) for (const val of vals) {
    cases.push([t, () => ({ ...validFor(t), [k]: val }), new RegExp(`${k} isn’t in the right form`), 'invalid', `bad pattern ${k}=${JSON.stringify(val).slice(0, 30)}`]);
  }
  // two Sparks
  for (const [val, re] of [['spark2', /sparks should be a list of 2 items/], ['spark2+', /sparks should be a list of 2 items/], ['+spark3', /sparks should be a list of 2 items/],
    ['spark2+spark3+spark4', /sparks should be a list of 2 items/], [[], /sparks should be a list of 2 items/], [['spark2'], /sparks should be a list of 2 items/],
    ['spark2+spark99', /sparks\[1\]: no Spark called spark99/], [['spark2', 'Spark 2'], /sparks needs different Sparks/], [7, /sparks should be a list/]]) {
    cases.push(['cluster_plan', () => ({ model: ctx.model, sparks: val }), re, 'invalid', `sparks=${JSON.stringify(val)}`]);
  }
  // enums
  for (const s of ['model', 'ray', 'portal', 'CONSOLE', '']) cases.push(['service_logs', () => ({ spark: sp(), service: s }), /service should be one of: editor, console, sparkie/, 'invalid', `service=${JSON.stringify(s)}`]);
  cases.push(['workloads', () => ({ kind: 'models' }), /kind should be one of: model, service, sparkie, other/, 'invalid', 'kind=models']);
  cases.push(['fleet_events', () => ({ type: 'nope' }), /type should be one of: started/, 'invalid', 'type=nope']);
  cases.push(['recall', () => ({ kind: 'nope' }), /kind should be one of: said, tool, call/, 'invalid', 'kind=nope']);
  // length limits
  cases.push(['find_recipes', () => ({ query: 'q'.repeat(121) }), /query should be text of at most 120 characters/, 'invalid', 'query 121 chars']);
  cases.push(['find_recipes', () => ({ category: 'c'.repeat(41) }), /category should be text of at most 40 characters/, 'invalid', 'category 41 chars']);
  cases.push(['search_huggingface', () => ({ query: 'q'.repeat(201) }), /query should be text of at most 200 characters/, 'invalid', 'query 201 chars']);
  cases.push(['where_it_fits', () => ({ model: 'm'.repeat(201) }), /model should be text of at most 200 characters/, 'invalid', 'model 201 chars']);
  cases.push(['search_web', () => ({ query: 'q'.repeat(2001) }), /query should be text of at most 2000 characters/, 'invalid', 'query 2001 chars']);
  cases.push(['read_page', () => ({ url: `https://example.org/${'a'.repeat(1981)}` }), /url should be text of at most 2000 characters/, 'invalid', 'url 2001 chars']);
  cases.push(['recall', () => ({ about: 'q'.repeat(121) }), /about should be text of at most 120 characters/, 'invalid', 'about 121 chars']);
  // well-formed but nonexistent
  cases.push(['find_recipes', () => ({ category: 'no-such-category' }), /No recipes in category no-such-category/, 'invalid', 'unknown category']);
  cases.push(['where_it_fits', () => ({ model: 'no-such-model-test' }), /No model on disk or recipe called no-such-model-test/, 'not_found', 'unknown model']);
  cases.push(['deploy_plan', () => ({ model: 'no-such-model-test', spark: sp() }), /no-such-model-test isn’t on any online Spark/, 'not_found', 'unknown model']);
  cases.push(['cluster_plan', () => ({ model: 'no-such-model-test', sparks: ctx.pair }), /isn’t on any online Spark/, 'not_found', 'unknown model']);
  cases.push(['recipe_detail', () => ({ id: 'no-such-recipe-test' }), /No recipe called no-such-recipe-test/, 'not_found', 'unknown recipe']);
  cases.push(['recall', () => ({ id: 'j_000000000000' }), /There’s no record j_000000000000 in the journal/, 'not_found', 'unknown record']);
  cases.push(['recipe_detail', () => ({ id: ctx.recipe, setup: 'zzzz9999' }), /has no setup zzzz9999/, 'not_found', 'unknown setup']);
  cases.push(['container_logs', () => ({ spark: sp(), container: 'no-such-container-test' }), /No container called no-such-container-test/, 'not_found', 'unknown container']);
  // An agent reads only an address search_web returned in the last hour (R39).
  cases.push(['read_page', () => ({ url: 'https://docs.example.org/never-searched' }), /Only an address search_web returned in the last hour can be read/, 'not_allowed', 'an address no search returned']);

  for (const [t, args, re, code, label] of cases) {
    test(`${t}: ${label}`, async () => assertToolError(await call(await tokenFor(t), t, args()), re, code));
  }
  test('a Spark argument that is an object with an odd toString → [invalid], not an internal error', async () => {
    for (const val of [{ toString: 'x' }, { toString: 'x', valueOf: 'y' }]) {
      assertToolError(await call(await pool.token(), 'spark_detail', { spark: val }), /spark/, 'invalid');
    }
  });
  test('a Spark argument that isn\'t text says so (no "[object Object]", no "no Spark called spark2")', async () => {
    for (const val of [{}, ['spark2']]) {
      const r = await call(await pool.token(), 'spark_detail', { spark: val });
      assertToolError(r, /spark/, 'invalid');
      assert.doesNotMatch(r.text, /\[object Object\]|no Spark called spark2\b/, r.text);
    }
  });
  // Inherited names are not arguments either (sent as raw JSON so "__proto__" stays an own key).
  for (const k of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    test(`fleet_status refuses the inherited name "${k}" as an argument`, async () => {
      const r = await post(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"fleet_status","arguments":{"${k}":1}}}`, { token: await pool.token() });
      assertToolError(r, /Unknown argument/, 'invalid');
    });
  }
});

/* ───────── masking ───────── */
describe('secret masking', () => {
  test('container_logs hides the fake tokens and keeps valid JSON', async () => {
    const r = await call(await pool.token(), 'container_logs', { spark: ctx.spark, container: ctx.container });
    const x = assertToolOk(r);
    for (const secret of ['hf_abcdefghijklmnopqrstuvwxyz123456', 'nvapi-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345', 'plainsecretvalue123']) {
      assert.ok(!r.text.includes(secret), `leaked ${secret}`);
      assert.ok(!r.raw.includes(secret), `leaked ${secret} in envelope`);
    }
    assert.ok((x.log.match(/\[hidden\]/g) || []).length >= 3, x.log);
    assert.match(x.log, /INFO serving on :8000/, 'ordinary lines stay');
  });
  // F20: env-style names that end in _KEY or _PASS, a passphrase and PGPASS are hidden too; a path to a key file stays.
  test('container_logs hides env-style names too (WEBUI_SECRET_KEY=, LITELLM_MASTER_KEY=, DB_PASS=, PGPASS=, passphrase=); a key file’s path stays', async () => {
    const r = await call(await pool.token(), 'container_logs', { spark: ctx.spark, container: ctx.container });
    const x = assertToolOk(r);
    for (const secret of ['wsk-fake-0001', 'sk-1234', 'enc-fake-0002', 'dbpass-fake-0003', 'pgpass-fake-0004', 'phrase-fake-0005']) assert.ok(!r.raw.includes(secret), `leaked ${secret}`);
    for (const name of ['WEBUI_SECRET_KEY=', 'LITELLM_MASTER_KEY=', 'ENCRYPTION_KEY: ', 'DB_PASS=', 'PGPASS=', 'passphrase=']) assert.ok(x.log.includes(`${name}[hidden]`), `${name} in ${x.log}`);
    assert.match(x.log, /SSL_KEY_FILE=\/etc\/ssl\/key\.pem/, 'a path to a key file isn’t a secret');
  });
  test('masking never breaks the JSON (private-key markers in two fields)', async () => {
    // search_huggingface echoes the query in two fields; END-then-BEGIN would let one match span from one to the next.
    assertToolOk(await call(await hfPool.token(), 'search_huggingface', { query: '-----END PRIVATE KEY----- -----BEGIN PRIVATE KEY-----' }));
  });
  test('tool error text is masked too (a key-shaped container name)', async () => {
    const r = await call(await pool.token(), 'container_logs', { spark: ctx.spark, container: 'hf_abcdefghijklmnopqrstuvwxyz1234' });
    assertToolError(r, /No container called \[hidden\]/, 'not_found');
    assert.ok(!r.raw.includes('hf_abcdefghijklmnopqrstuvwxyz1234'));
  });
});

/* ───────── auth ───────── */
describe('auth', () => {
  const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };
  test('no key → 403 -32600', async () => assertNoKey(await post(ping, {})));
  test('malformed keys → 403', async () => {
    const t = await pool.token();
    for (const authorization of ['Bearer abc', 'Bearer sck_short', `Bearer sck_${'a'.repeat(44)}`, `Basic ${Buffer.from('a:b').toString('base64')}`, 'Bearer', `Token ${t}`, `Bearer ${t} extra`]) {
      assertNoKey(await post(ping, { headers: { authorization } }));
    }
  });
  test('well-formed unknown key → 403', async () => {
    assertNoKey(await post(ping, { headers: { authorization: `Bearer sck_${randomBytes(32).toString('base64url')}` } }));
  });
  test('scheme is case-insensitive and extra spaces are fine', async () => {
    const t = await pool.token();
    assertRpcOk(await post(ping, { headers: { authorization: `bearer ${t}` } }));
    assertRpcOk(await post(ping, { headers: { authorization: `BEARER  ${t}  ` } }));
  });
  test('wrong or missing Content-Type → 403', async () => {
    const t = await pool.token();
    for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
      assertRpcError(await post(JSON.stringify(ping), { token: t, headers: { 'content-type': ct } }), 403, -32600);
    }
    const r = await raw('POST', '/mcp', { authorization: `Bearer ${t}` }, JSON.stringify(ping));
    assert.equal(r.status, 403);
    assert.equal(r.json?.error?.code, -32600);
  });
  test('application/json with charset is accepted', async () => {
    assertRpcOk(await post(ping, { token: await pool.token(), headers: { 'content-type': 'application/json; charset=utf-8' } }));
  });
  test('foreign Origin → 403', async () => {
    const t = await pool.token();
    for (const origin of ['https://evil.example', 'null', `http://127.0.0.1:${T.fleet.port}`, `${T.origin}.evil.example`]) {
      assertRpcError(await post(ping, { token: t, headers: { origin } }), 403, -32600);
    }
  });
  test('the configured Origin, or one matching X-Forwarded-Host, is allowed', async () => {
    assertRpcOk(await post(ping, { token: await pool.token(), headers: { origin: T.origin } }));
    assertRpcOk(await post(ping, { token: await pool.token(), headers: { origin: 'https://console.example.ts.net', 'x-forwarded-host': 'console.example.ts.net' } }));
  });
  test('a member identity can\'t use the door, even with the owner\'s key → 403', async () => {
    const r = await post(ping, { token: await pool.token(), headers: { 'tailscale-user-login': MEMBER } });
    assertRpcError(r, 403, -32600);
    assert.match(r.json.error.message, /only for the owner/);
  });
  test('owner identity in other letter case still matches its key', async () => {
    assertRpcOk(await post(ping, { token: await pool.token(), headers: { 'tailscale-user-login': OWNER.toUpperCase() } }));
  });
  test('stranger identity → 401', async () => {
    const r = await post(ping, { token: await pool.token(), headers: { 'tailscale-user-login': 'stranger@test' } });
    assert.equal(r.status, 401);
    assert.match(r.json?.error, /doesn’t have access/);
  });
  // v3.1 (contract 4.10, the owner: agents from anywhere): from the internet an agent's own key is enough, once the owner
  // lets that key work from anywhere (a new key is tailnet-only, security audit 2026-11-11); no key, nothing.
  test('from the internet (Funnel): its own key works once let; a new key or none → 401', async () => {
    const funnel = { 'tailscale-funnel-request': '?1' };
    const k = await createKey('anywhere');
    assert.equal(k.created.internet, false);
    assert.equal((await post(ping, { token: k.token, headers: funnel })).status, 401, 'a new key, from the internet');
    assertRpcOk(await post(ping, { token: k.token }));
    const on = await api(`/agents/${k.id}`, { method: 'PUT', body: { internet: true } });
    assert.equal(on.status, 200, on.text);
    assert.equal(on.json.internet, true);
    assertRpcOk(await post(ping, { token: k.token, headers: funnel }));
    const r = await post(ping, { headers: funnel });
    assert.equal(r.status, 401);
    await deleteKey(k.id);
  });
  test('from a Spark\'s own address → 403', async () => {
    const r = await post(ping, { token: await pool.token(), headers: { 'x-forwarded-for': '100.64.0.2' } });
    assert.equal(r.status, 403);
    assert.match(r.json?.error, /Sparks themselves/);
  });
});

/* ───────── key lifecycle ───────── */
describe('agent key lifecycle', () => {
  test('page routes need X-Spark-Console, the page\'s Origin and a name', async () => {
    assert.equal((await api('/agents', { method: 'POST', body: { name: 'noheader' }, headers: { 'x-spark-console': null } })).status, 403);
    assert.equal((await api('/agents', { method: 'POST', body: { name: 'noorigin' }, headers: { origin: null } })).status, 403);
    assert.equal((await api('/agents', { method: 'POST', body: { name: 'foreign' }, headers: { origin: 'https://evil.example' } })).status, 403);
    assert.equal((await api('/agents', { method: 'POST', body: { name: '   ' } })).status, 400);
    assert.equal((await api('/agents', { method: 'POST', body: {} })).status, 400);
  });
  test('members cannot list actions or keys, or make keys', async () => {
    for (const p of ['/agents', '/actions']) assert.equal((await api(p, { headers: { 'tailscale-user-login': MEMBER } })).status, 403, p);
    assert.equal((await api('/agents', { method: 'POST', body: { name: 'member' }, headers: { 'tailscale-user-login': MEMBER } })).status, 403);
  });
  test(`GET /actions lists all ${ALL_TOOLS.length}: ${TOOLS.length} that read, ${CHANGE_TOOLS.length} that change things (not ask_sparkie, which isn't an action)`, async () => {
    const r = await api('/actions');
    assert.equal(r.status, 200);
    assert.equal(r.json.actions.length, ALL_TOOLS.length);
    assert.deepEqual(r.json.actions.map(a => a.name).sort(), [...ALL_TOOLS].sort());
    for (const a of r.json.actions) {
      const change = CHANGE_TOOLS.includes(a.name);
      assert.equal(a.kind, change ? 'change' : 'read', a.name);
      assert.equal(a.scope, change ? 'fleet:act' : 'fleet:read', a.name);
      assert.equal(a.input.type, 'object');
      assert.ok(!('run' in a));
    }
  });
  test('create → use → listed with lastAction → delete → refused', async () => {
    const k = await createKey('life');
    assert.match(k.token, /^sck_[A-Za-z0-9_-]{43}$/);
    assert.match(k.id, /^[a-f0-9]{12}$/);
    assert.deepEqual(k.created.scopes, ['fleet:read']);
    assert.match(k.created.url, /\/mcp$/);
    assert.equal(k.created.lastUsedAt, null);
    // duplicate name, any case
    assert.equal((await api('/agents', { method: 'POST', body: { name: k.name.toUpperCase() } })).status, 409);
    // the token is only shown once and only its hash is stored
    let list = await api('/agents');
    assert.equal(list.status, 200);
    const listed = list.json.keys.find(x => x.id === k.id);
    assert.ok(listed);
    assert.ok(!list.text.includes(k.token) && !('hash' in listed) && !('token' in listed));
    assert.ok(!readFileSync(join(T.fleet.stateDir, 'agents.json'), 'utf8').includes(k.token), 'token must not be stored');
    // use it
    const before = Date.now();
    assertToolOk(await call(k.token, 'linked_sparks', {}));
    list = await api('/agents');
    const used = list.json.keys.find(x => x.id === k.id);
    assert.equal(used.lastAction, 'linked_sparks');
    assert.ok(Date.parse(used.lastUsedAt) >= before - 2000 && Date.parse(used.lastUsedAt) <= Date.now() + 2000, used.lastUsedAt);
    // delete
    assert.equal((await deleteKey(k.id)).status, 200);
    assert.equal((await api(`/agents/${k.id}`, { method: 'DELETE' })).status, 404);
    assertNoKey(await rpc(k.token, 'ping'));
    list = await api('/agents');
    assert.ok(!list.json.keys.some(x => x.id === k.id));
  });
  test('DELETE needs the header; odd ids → 404', async () => {
    const k = await createKey('del');
    assert.equal((await api(`/agents/${k.id}`, { method: 'DELETE', headers: { 'x-spark-console': null } })).status, 403);
    assertRpcOk(await rpc(k.token, 'ping'));
    for (const id of ['nothex', '../agents', `${k.id}x`, ...(k.id.toUpperCase() !== k.id ? [k.id.toUpperCase()] : [])]) {
      assert.equal((await api(`/agents/${encodeURIComponent(id)}`, { method: 'DELETE' })).status, 404, id);
    }
    assert.equal((await deleteKey(k.id)).status, 200);
  });
  test('names are cleaned (control characters, length)', async () => {
    const r = await api('/agents', { method: 'POST', body: { name: `test-\u0000‮${'n'.repeat(100)}\n` } });
    assert.equal(r.status, 201, r.text);
    try {
      assert.ok(r.json.name.length <= 60);
      assert.doesNotMatch(r.json.name, /[\u0000-\u001f‮]/);
    } finally { await api(`/agents/${r.json.id}`, { method: 'DELETE' }); }
  });
  test('a key works with the identity that made it', async () => {
    const k = await createKey('login');
    try { assertRpcOk(await rpc(k.token, 'ping', undefined, { headers: { 'tailscale-user-login': OWNER } })); } finally { await deleteKey(k.id); }
  });
});

/* ───────── rate limit ───────── */
describe('rate limit (120 a minute per key)', () => {
  test('121st request in a minute → 429 -32000; other keys unaffected', async () => {
    const k = await createKey('rate');
    try {
      const statuses = [];
      for (let i = 0; i < 6; i++) statuses.push(...(await Promise.all(Array.from({ length: 20 }, () => rpc(k.token, 'ping')))).map(r => r.status));
      assert.equal(statuses.filter(s => s === 200).length, 120, JSON.stringify(statuses));
      assertRpcError(await rpc(k.token, 'ping'), 429, -32000);
      assertRpcOk(await rpc(await pool.token(), 'ping'));
      // notifications count too
      assert.equal((await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { token: k.token })).status, 429);
    } finally { await deleteKey(k.id); }
  });
  test('at most 3 tools at once per key; the 4th is refused with a coded "busy" error', async () => {
    const k = await createKey('busy');
    try {
      const sparks = ['spark2', 'spark3', 'spark4'];
      const rs = await Promise.all(Array.from({ length: 9 }, (_, i) => call(k.token, 'spark_diagnostics', { spark: sparks[i % 3] })));
      const refused = rs.filter(r => r.isError);
      assert.ok(refused.length >= 1, 'nine calls at once should hit the limit of 3');
      for (const r of refused) assertToolError(r, /3 tools running/, 'busy');
    } finally { await deleteKey(k.id); }
  });
  test('search_huggingface: at most 6 a minute per key; refused arguments don\'t count', async () => {
    const k = await createKey('hf-limit');
    try {
      for (let i = 0; i < 8; i++) assertToolError(await call(k.token, 'search_huggingface', { query: 'a' }), /isn’t in the right form/, 'invalid');
      // Six real searches would reach Hugging Face; the seventh must be refused without doing so. Use queries the
      // service can answer from its 10-minute cache after the first.
      for (let i = 0; i < 6; i++) assertToolOk(await call(k.token, 'search_huggingface', { query: 'qwen3 0.6b' }));
      assertToolError(await call(k.token, 'search_huggingface', { query: 'qwen3 0.6b' }), /At most 6 web searches a minute/, 'busy');
    } finally { await deleteKey(k.id); }
  });
});

describe('search_huggingface on the stand-in fleet', () => {
  // GitHub's machines would be rate-limited by Hugging Face, so the stand-in fleet never reaches it: start-mock.mjs sets
  // SPARK_CONSOLE_HF_FIXTURE to mock/hf-fixture.json, whose made-up repos exist nowhere else.
  test('answers from the fixture: sizes, memory and Sparks read from its files; a format no engine serves and a model too big for four Sparks left out', async () => {
    const k = await createKey('hf-fixture');
    try {
      const x = assertToolOk(await call(k.token, 'search_huggingface', { query: 'standin' }));
      assert.ok(x.searchedFor.includes('standin'), JSON.stringify(x.searchedFor));
      assert.deepEqual(x.results.map(r => [r.title, r.downloads, r.alreadyARecipe]), [['Tiny-1B', 800, null]]);
      assert.deepEqual(x.results[0].versions, [
        { repo: 'standin-org/Tiny-1B-FP8', quantization: 'FP8', downloadGB: 1.2, memoryNeededGB: 5, sparks: 1, gated: true, engine: null },
        { repo: 'standin-org/Tiny-1B', quantization: 'BF16', downloadGB: 2.2, memoryNeededGB: 7, sparks: 1, gated: false, engine: null },
      ]);
      // A repo the fixture doesn't hold is not found, as Hugging Face would say.
      assert.deepEqual(assertToolOk(await call(k.token, 'search_huggingface', { query: 'zzqx-not-in-the-fixture' })).results, []);
    } finally { await deleteKey(k.id); }
  });
});
