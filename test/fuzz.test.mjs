// Covers: Hostile values, argument names and envelopes against every tool: no 5xx, no non-JSON, no broken JSON-RPC, no
// leaked exceptions, every error coded, the service stays up. The change tools are fuzzed with agents paused (their
// inputs are still checked; nothing may run).
//
// Fuzz pass: hostile argument values, argument names and envelopes against every tool. Looks for HTTP 500s, non-JSON
// answers, broken JSON-RPC envelopes, results that aren't JSON, leaked internal exceptions, and the service going down.
// The tools that change things are fuzzed with agents' changes paused, so nothing they're asked for runs (their inputs
// are still checked first); any of them answering without an error then is a finding too.
// SPARK_TEST_SEED picks the random strings (default 1). SPARK_TEST_FINDINGS=<file> saves every finding as JSON.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { T, useFleet, TOOLS, CHANGE_TOOLS, post, rpc, call, KeyPool, agentSettings, SLOW } from './lib.mjs';

const pool = new KeyPool('fuzz', 100), hfPool = new KeyPool('fuzz-hf', 5), actPool = new KeyPool('fuzz-act', 100, { act: true });
const findings = [];
let seed = Number(process.env.SPARK_TEST_SEED || 1);
const rand = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const randStr = n => Array.from({ length: n }, () => String.fromCodePoint(Math.floor(rand() * (rand() < 0.7 ? 0x7f : 0x2ffff)))).join('').replace(/[\ud800-\udfff]/g, 'x');
const nest = (d, leaf = 1) => { let v = leaf; for (let i = 0; i < d; i++) v = { a: v }; return v; };
const nestArr = d => JSON.parse('['.repeat(d) + ']'.repeat(d));

// Values that fail validation (and a few that pass it but are odd).
const HOSTILE = [
  '', ' ', 'x'.repeat(201), 'x'.repeat(10000), 'a'.repeat(100000),
  'spark2\u0000', '‮spark2', 'spark​2', 'ｓｐａｒｋ２', '🚀🚀', 'é'.repeat(50), 'é', '\ud83d', '\\u0000',
  '__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty',
  '$(id)', '`id`', 'a;id', "a' || 'b", '"; DROP TABLE x; --', '../../etc/passwd', '..', '.', '-rf', '--help', '%s%s%n', '{{7*7}}', '${7*7}', '<script>alert(1)</script>',
  'a\nb', 'a\r\nb', '\t', 'null', 'undefined', 'NaN', 'true', '[]', '{}',
  '5', '1e3', '0x10', ' 5', '-1', '05', '5.0', '1_000', 'spark2+spark3', 'Spark 2', ' 2 ',
  0, -0, -1, 1.5, 1e308, -1e308, 2 ** 53 + 1, Number.MAX_SAFE_INTEGER, true, false, null,
  [], ['spark2'], ['spark2', 'spark3'], ['spark2', 'spark2'], [['spark2'], 'spark3'], [[[]]], {}, { a: 1 }, { __proto__: { polluted: 1 } }, { toString: 'x' }, { toString: 'x', valueOf: 'y' }, { length: 1e9 },
  nest(50), nestArr(500),
  randStr(8), randStr(64), randStr(300),
];
// Hostile names for arguments.
const KEYS = ['__proto__', 'constructor', 'prototype', '', ' ', 'x'.repeat(5000), '🚀', 'spark ', 'SPARK', 'limit\u0000', '0', 'length'];
// What a leaked internal exception looks like (an isError text that isn't one of the actions' own messages).
const INTERNAL = /TypeError|ReferenceError|RangeError|SyntaxError|Cannot read|Cannot convert|is not a function|is not defined|is not iterable|Maximum call stack|of undefined|undefined is not|\[object Object\]|ENOENT|EACCES|spawn |Traceback|at file:|at async/;
// Every refusal starts with its code.
const CODED = /^\[(invalid|not_allowed|not_found|conflict|too_large|busy|unreachable|failed)(, retry later)?\] /;

const ctx = {};
const VALID = () => ({
  cluster_plan: { model: ctx.model, sparks: ctx.pair },
  container_logs: { spark: ctx.spark, container: ctx.container },
  deploy_plan: { model: ctx.model, spark: ctx.spark },
  files: { spark: ctx.spark },
  forget_memory: { id: '0123abcd' },
  keep_running: { spark: ctx.spark, container: ctx.container },
  operation_log: { id: '0123456789ab' },
  power_off: { spark: ctx.spark },
  power_on: { spark: ctx.spark },
  power_settings: { idleMinutes: 30 },
  read_page: { url: 'https://docs.example.org/never-searched' },
  recall: { about: 'gemma' },
  recipe_detail: { id: ctx.recipe },
  remember: { text: 'Spark 3 is where models go' },
  restart_model: { spark: ctx.spark, container: ctx.container },
  run: { on: ctx.spark, command: 'ls' },
  save_file: { spark: ctx.spark, path: 'fuzz.md', text: 'x' },
  search_huggingface: { query: 'qwen3 0.6b' },
  search_web: { query: 'vllm flags' },
  self_test: {},
  service_logs: { spark: ctx.spark, service: 'console' },
  spark_detail: { spark: ctx.spark },
  spark_diagnostics: { spark: ctx.spark },
  start_model: { model: ctx.model },
  stop_model: { spark: ctx.spark, container: ctx.container },
  wait_operation: { id: '0123456789ab' },
  where_it_fits: { model: ctx.model },
});
let schemas = {};

// Known product bugs would be tagged here (so they don't fail every tool's test unless SPARK_TEST_STRICT=1); none now.
const KNOWN = () => false;
function record(kind, request, r, note) {
  const f = { kind, note, key: request?.key, request: JSON.stringify(request).slice(0, 300), status: r?.status, response: (r?.raw ?? r?.text ?? String(r)).slice(0, 300) };
  f.known = KNOWN(f);
  findings.push(f);
}
const fresh = since => findings.slice(since).filter(f => process.env.SPARK_TEST_STRICT || !f.known);
function check(request, r) {
  if (r instanceof Error) return record('transport', request, r, `${r.message} ${r.cause?.code || ''}`);
  if (r.status >= 500) return record('http-5xx', request, r);
  if (r.status === 202) return;
  if (!r.json) return record('non-json', request, r);
  if (r.json.jsonrpc !== '2.0') return record('not-jsonrpc', request, r);
  if (r.status === 200 && r.json.result?.content) {
    const text = r.json.result.content.map(c => c.text).join('\n');
    if (CHANGE_TOOLS.includes(request?.tool) && r.json.result.isError === false) return record('change-ran-while-paused', request, r);
    if (r.json.result.isError === false) { try { JSON.parse(text); } catch { record('invalid-json-output', request, r); } }
    else if (INTERNAL.test(text)) record('internal-error-leak', request, r, text.slice(0, 160));
    else if (!CODED.test(text)) record('uncoded-error', request, r, text.slice(0, 160));
  }
}
// The tools that reach the web count 6 a minute per key, so they get keys that are used 5 times each. (search_web and
// read_page never leave this machine here: the stand-in fleet has no canned web, so a search finds nothing.)
const poolFor = tool => (['search_huggingface', 'search_web', 'read_page'].includes(tool) ? hfPool : CHANGE_TOOLS.includes(tool) ? actPool : pool);
async function send(tool, args, label) {
  const p = poolFor(tool);
  const req = { tool, args: label || args };
  try {
    const r = await call(await p.token(), tool, args, { timeout: 60000 * SLOW });
    check(req, r);
    return r;
  } catch (e) { check(req, e); return e; }
}
// search_huggingface reaches Hugging Face for anything that passes validation: only send values that will be refused,
// plus a few odd ones that pass.
const passesHf = v => typeof v === 'string' && v.length <= 200 && /\S\S/.test(v);
const HF_ODD_OK = ['🚀🚀', '$(id)', '__proto__'];
const healthy = () => fetch(`${T.base}/health`).then(r => r.status).catch(() => 0);

useFleet({}, async () => {
  const list = await rpc(await actPool.token(), 'tools/list');
  schemas = Object.fromEntries(list.json.result.tools.map(x => [x.name, x.inputSchema]));
  const fleet = (await call(await pool.token(), 'fleet_status', {})).value;
  const sp = fleet.sparks.find(s => s.state === 'online' && s.runningContainers.length);
  ctx.spark = sp.id; ctx.container = sp.runningContainers[0];
  const disk = (await call(await pool.token(), 'models_on_disk', {})).value;
  ctx.model = (disk.models.find(m => m.onSparks.includes(ctx.spark)) || disk.models[0]).modelId;
  ctx.pair = (await call(await pool.token(), 'linked_sparks', {})).value.pairs[0].sparks;
  ctx.recipe = (await call(await pool.token(), 'find_recipes', { limit: 1 })).value.recipes[0].id;
});
after(() => { if (process.env.SPARK_TEST_FINDINGS) writeFileSync(process.env.SPARK_TEST_FINDINGS, JSON.stringify(findings, null, 2)); });

// One tool: every hostile value in every argument, hostile argument names, and hostile whole arguments.
async function fuzzTool(tool) {
  const start = findings.length;
  const base = VALID()[tool] || {};
  const props = Object.keys(schemas[tool].properties);
  for (const k of props) {
    for (const v of HOSTILE) {
      if (tool === 'search_huggingface' && passesHf(v) && !HF_ODD_OK.includes(v)) continue;
      await send(tool, { ...base, [k]: v }, `${k}=${JSON.stringify(v)?.slice(0, 40)}`);
    }
  }
  // hostile argument names, sent as raw JSON so "__proto__" stays an own key
  for (const k of KEYS) {
    const raw = `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"${tool}","arguments":{${JSON.stringify(k)}:1${Object.entries(base).map(([a, b]) => `,${JSON.stringify(a)}:${JSON.stringify(b)}`).join('')}}}}`;
    const r = await post(raw, { token: await poolFor(tool).token() }).catch(e => e);
    check({ tool, key: k.slice(0, 20) }, r);
    if (!(r instanceof Error) && r.json?.result?.isError === false) record('unknown-key-accepted', { tool, key: k.slice(0, 20) }, r);
  }
  // whole arguments hostile
  for (const a of ['x', 7, true, [], [1], nest(200), { [props[0] || 'x']: nest(20) }]) await send(tool, a, `arguments=${JSON.stringify(a).slice(0, 30)}`);
  assert.equal(await healthy(), 200, 'service went down');
  const mine = fresh(start);
  assert.equal(mine.length, 0, JSON.stringify(mine, null, 1).slice(0, 3000));
}

describe('fuzz: hostile argument values', () => {
  for (const tool of TOOLS) test(tool, { timeout: 600000 * SLOW }, () => fuzzTool(tool));
});

describe('fuzz: the tools that change things, with agents\' changes paused', () => {
  before(async () => { assert.equal((await agentSettings({ halted: true })).halted, true); });
  after(async () => { await agentSettings({ halted: false }); });
  for (const tool of CHANGE_TOOLS) test(tool, { timeout: 600000 * SLOW }, () => fuzzTool(tool));
  test('nothing was started or stopped', async () => {
    const ops = (await call(await pool.token(), 'recent_operations', { limit: 50 })).value;
    assert.deepEqual(ops.operations, [], JSON.stringify(ops.operations).slice(0, 500));
  });
});

describe('fuzz: hostile envelopes', () => {
  test('params, names and methods of the wrong shape', { timeout: 300000 * SLOW }, async () => {
    const start = findings.length;
    const bodies = [
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: 'fleet_status' },
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: ['fleet_status'] },
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: null },
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: null } },
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 7 } },
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: ['fleet_status'] } },
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: { toString: 'x' } } },
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'x'.repeat(100000) } },
      { jsonrpc: '2.0', id: 1, method: { toString: 1 } },
      { jsonrpc: '2.0', id: 1, method: ['ping'] },
      { jsonrpc: '2.0', id: 1, method: 7 },
      { jsonrpc: '2.0', id: 1, method: null },
      { jsonrpc: '2.0', id: 1, method: 'x'.repeat(100000) },
      { jsonrpc: '2.0', id: 1, method: '__proto__' },
      { jsonrpc: '2.0', id: 1, method: 'constructor' },
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: { toString: 1 } } },
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: 'x' },
      { jsonrpc: '2.0', id: 1e308, method: 'ping' },
      { jsonrpc: '2.0', id: -0, method: 'ping' },
      { jsonrpc: '2.0', id: '🚀', method: 'ping' },
      { jsonrpc: { toString: 1 }, id: 1, method: 'ping' },
      { jsonrpc: '2.0', id: 1, method: 'ping', params: nest(1000) },
    ];
    for (const b of bodies) check({ body: b }, await post(b, { token: await pool.token() }).catch(e => e));
    for (const raw of ['{"jsonrpc":"2.0","id":1,"method":"ping","__proto__":{"x":1}}', '{"jsonrpc":"2.0","id":1,"id":2,"method":"ping"}', '﻿{"jsonrpc":"2.0","id":1,"method":"ping"}', '[]', '[[]]', '"\\ud800"', `{"a":${'['.repeat(100000)}${']'.repeat(100000)}}`]) {
      check({ raw: raw.slice(0, 80) }, await post(raw, { token: await pool.token() }).catch(e => e));
    }
    assert.equal(await healthy(), 200, 'service went down');
    const mine = fresh(start);
    assert.equal(mine.length, 0, JSON.stringify(mine, null, 1).slice(0, 3000));
  });
});
