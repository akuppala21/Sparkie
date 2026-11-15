// Covers: The change actions through the door. Who: a new key looks only (every read tool and `ask_sparkie`), `PUT
// /agents/<id> {act}` gives every tool; the owner's switches: paused refuses every change but not reads, an unreadable
// settings file counts as paused. Names: already running by any name; a name matching several models → a question whose
// choices are ids only, used once, alone, by whoever was asked; unknown, draft, remote-code and unsafe `spark.json`
// models refused. Rails: a pair whose cable isn't "full", 8 GB kept free / not enough / unknown memory, Spark 2 only
// when named, room only by stopping a container the console didn't start → a question only the owner answers (an
// agent's "yes" is refused); a model that answers Sparkie's chats or apps → the same. Deploys that complete (three
// Sparks at once): start → asked again while starting, the same operation (`already-starting`, no second job) →
// `wait_operation` → `running_models`; stop; restart (room checked first); a restart while another holds the port fails
// cleanly; put-back when the new model crashes, and when memory measured after the stops is short; a two-Spark start, a
// one-Spark start that would stop a part (refused), stopping both parts. What stop/restart won't touch. A model not on
// disk: downloaded (never onto Spark 2), and a pause stops the operation at its next step. A start over a running copy
// of the same model (F9): when it fails that copy runs again (set aside, not removed), when it works nothing set aside
// is left. A Hugging Face repo started or looked up by its full name joins Recipes (A9) with its model card's setup,
// one click after; `find_setups` adds one that isn't in Recipes instead of refusing. A GPU job on Spark 4 (A13 part E):
// `deploy_plan` shows it as a stop, `start_model` there is the owner's question naming it and stops nothing, with no
// Spark named the model goes to Spark 3, and `restart_model` there is refused. `audit.jsonl` lines.
//
// The actions that change things, through the agent door: start_model, stop_model, restart_model (and wait_operation to
// follow them). Who may call them (a key's scopes), the owner's pause, names and questions (choices kept on the server,
// single-use, bound to whoever asked), the rails on where a model goes (memory with 8 GB kept free, two-Spark links,
// containers Spark Console didn't start, never Spark 2 unless named), deploys that complete on the stand-in fleet,
// putting back what was stopped when a start fails, and the audit log. Self-healing is in heal.test.mjs, Sparkie's
// chat in sparkie.test.mjs.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, closeSync, openSync, truncateSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { T, useFleet, CHANGE_TOOLS, ASK, DOOR_READ, DOOR_ACT, rpc, call, api, createKey, createActKey, deleteKey, agentSettings, KeyPool, MEMBER, auditLines, SLOW } from './lib.mjs';

const pool = new KeyPool('chg', 90, { act: true });
const keys = {};
// The watcher (and so self-healing) looks only once a minute here, and the status every 20 s: these tests don't need
// them, and the deploys go faster without.
// Recipes' look for setups reads test/mock/dig-fixture.json here, not the web (SPARK_CONSOLE_DIG_FIXTURE).
useFleet({ watchMs: 60000, statusMs: 20000, env: { SPARK_CONSOLE_DIG_FIXTURE: join(dirname(fileURLToPath(import.meta.url)), 'mock', 'dig-fixture.json') } }, async () => {
  keys.look = await createKey('look');
  keys.act = await createActKey('act');
  keys.other = await createActKey('other');
});

/* ───────── helpers ───────── */
const mock = (spark, file) => join(T.fleet.root, spark, '.mock', file);
// The stand-in docker's state on one Spark: name → { state, status, ours, model, protect, role, cluster, rank }.
function containers(spark) {
  const out = {};
  for (const line of readFileSync(mock(spark, 'containers'), 'utf8').split('\n').filter(Boolean)) {
    const [name, state, status, ours, model, protect, role, cluster, rank] = line.split('|');
    out[name] = { state, status, ours, model, protect, role, cluster, rank };
  }
  return out;
}
const stateOf = (spark, name) => containers(spark)[name]?.state;
const addContainer = (spark, line) => writeFileSync(mock(spark, 'containers'), readFileSync(mock(spark, 'containers'), 'utf8') + `${line}\n`);
const removeContainer = (spark, name) => writeFileSync(mock(spark, 'containers'), readFileSync(mock(spark, 'containers'), 'utf8').split('\n').filter(l => !l.startsWith(`${name}|`)).join('\n'));
// Free memory as /proc/meminfo would say it (GiB).
function setFree(spark, gib) {
  const f = mock(spark, 'meminfo');
  writeFileSync(f, readFileSync(f, 'utf8').replace(/^MemAvailable:.*$/m, `MemAvailable:   ${Math.round(gib * 1048576)} kB`));
}
const MEM = { spark2: 22, spark3: 64, spark4: 46 };   // test/mock/root's meminfo, GiB

const tok = () => pool.token();
// A tool result that worked (its JSON), or the refusal's "[code] message".
async function ok(name, args, token) {
  const r = await call(token || await tok(), name, args);
  assert.equal(r.status, 200, r.raw);
  assert.equal(r.isError, false, `${name} ${JSON.stringify(args)} failed: ${r.text}`);
  return r.value;
}
async function refused(name, args, code, re, token) {
  const r = await call(token || await tok(), name, args);
  assert.equal(r.status, 200, r.raw);
  assert.equal(r.isError, true, `${name} ${JSON.stringify(args)} should be refused: ${r.text}`);
  assert.match(r.text, new RegExp(`^\\[${code}(, retry later)?\\] `), r.text);
  if (re) assert.match(r.text, re);
  assert.doesNotMatch(r.text, /TypeError|ReferenceError|Cannot read|is not a function|undefined/);
  return r.text;
}
// Follows an operation until it's no longer running.
async function finished(id, token = keys.look.token, { timeout = 120000 } = {}) {
  const until = Date.now() + timeout * SLOW;
  for (;;) {
    const w = await ok('wait_operation', { id, seconds: 20 }, token);
    assert.equal(w.id, id);
    if (w.status !== 'running') return w;
    if (Date.now() > until) throw new Error(`operation ${id} still running after ${timeout} ms: ${JSON.stringify(w)}`);
  }
}
// A key of its own that can act, for a test running alongside others (a key runs at most 3 tools at once; the owner
// can have 20 keys), removed afterwards.
async function withKey(prefix, fn) {
  const k = await createActKey(prefix);
  try { return await fn(k.token, k); } finally { await deleteKey(k.id).catch(() => {}); }
}
const operations = async () => (await ok('recent_operations', { limit: 50 }, keys.look.token)).operations;
const isChoiceId = s => typeof s === 'string' && /^[a-f0-9]{10}$/.test(s);
function assertQuestion(v, { min = 2 } = {}) {
  assert.equal(v.outcome, 'question', JSON.stringify(v));
  assert.equal(typeof v.question, 'string');
  assert.ok(Array.isArray(v.choices) && v.choices.length >= min && v.choices.length <= 4, JSON.stringify(v.choices));
  for (const c of v.choices) {
    assert.equal(typeof c.label, 'string');
    if (c.choice === null) { assert.equal(c.call ?? null, null, JSON.stringify(c)); continue; }
    // Only an id comes back; the arguments stay on the server.
    assert.ok(isChoiceId(c.choice), JSON.stringify(c));
    assert.deepEqual(c.call?.args, { choice: c.choice }, JSON.stringify(c));
    assert.ok(CHANGE_TOOLS.includes(c.call.action), JSON.stringify(c));
  }
  const ids = v.choices.map(c => c.choice).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length, 'choice ids are unique');
  // Ask the owner and send back the choice, or (stopping something outside Spark Console) only the owner answers.
  assert.match(v.note, /choice|Only the owner can answer this one/);
}

/* ───────── who may change things ───────── */
describe('who may change things', () => {
  test(`a new key only looks: ${DOOR_READ.length} tools (every action that reads, and ask_sparkie), and the change tools aren't there to call`, async () => {
    assert.deepEqual(keys.look.created.scopes, ['fleet:read']);
    const r = await rpc(keys.look.token, 'tools/list');
    const names = r.json.result.tools.map(t => t.name);
    assert.equal(names.length, DOOR_READ.length);
    assert.deepEqual(names.sort(), [...DOOR_READ].sort());
    const ask = r.json.result.tools.find(t => t.name === ASK);
    assert.equal(ask.annotations.readOnlyHint, false);
    assert.equal(ask.annotations.destructiveHint, false, 'it can\'t change anything for this key');
    for (const name of CHANGE_TOOLS) {
      const c = await rpc(keys.look.token, 'tools/call', { name, arguments: { model: 'gpt-oss-20b', spark: 'spark3', container: 'sc-gpt-oss-20b' } });
      assert.equal(c.json?.error?.code, -32602, c.text);
      assert.match(c.json.error.message, new RegExp(`No tool called ${name} for this agent`));
    }
    assert.deepEqual(await operations(), []);
  });
  test(`a key the owner lets act sees all ${DOOR_ACT.length} (ask_sparkie too); the change tools say they change things`, async () => {
    assert.deepEqual(keys.act.scopes, ['fleet:read', 'fleet:act']);
    const tools = (await rpc(keys.act.token, 'tools/list')).json.result.tools;
    assert.equal(tools.length, DOOR_ACT.length);
    assert.deepEqual(tools.map(t => t.name).sort(), [...DOOR_ACT].sort());
    assert.equal(tools.find(t => t.name === ASK).annotations.destructiveHint, true, 'through Sparkie it can change things now');
    for (const t of tools) {
      const change = CHANGE_TOOLS.includes(t.name) || t.name === ASK;
      assert.equal(t.annotations.readOnlyHint, !change, t.name);
      assert.equal(t.inputSchema.additionalProperties, false, t.name);
    }
    const byName = Object.fromEntries(tools.map(t => [t.name, t]));
    // v3.1: restart takes a choice too (its validation run, offered to an agent that may change things).
    for (const name of ['start_model', 'stop_model', 'restart_model']) assert.equal(byName[name].inputSchema.properties.choice?.pattern, '^[a-f0-9]{10}$', name);
    assert.deepEqual(byName.start_model.inputSchema.properties.sparks.items.enum, ['spark1', 'spark2', 'spark3', 'spark4']);
    assert.deepEqual(Object.keys(byName.restart_model.inputSchema.properties).sort(), ['choice', 'container', 'spark']);
    const listed = (await api('/agents')).json.keys.find(k => k.id === keys.act.id);
    assert.deepEqual(listed.scopes, ['fleet:read', 'fleet:act']);
  });
  test('turning act off takes the change tools away again', async () => {
    const k = await createActKey('toggle');
    try {
      const off = await api(`/agents/${k.id}`, { method: 'PUT', body: { act: false } });
      assert.equal(off.status, 200, off.text);
      assert.deepEqual(off.json.scopes, ['fleet:read']);
      assert.equal((await rpc(k.token, 'tools/list')).json.result.tools.length, DOOR_READ.length);
      assert.equal((await rpc(k.token, 'tools/call', { name: 'stop_model', arguments: { spark: 'spark3', container: 'x' } })).json?.error?.code, -32602);
    } finally { await deleteKey(k.id); }
  });
  test('PUT /agents/<id> checks the page headers, the owner, the id and the value', async () => {
    const id = keys.look.id;
    for (const [body, headers, status] of [[{ act: 'yes' }, {}, 400], [{}, {}, 400], [{ act: 1 }, {}, 400], [{ act: true }, { 'x-spark-console': null }, 403],
      [{ act: true }, { origin: 'https://evil.example' }, 403], [{ act: true }, { 'tailscale-user-login': MEMBER }, 403]]) {
      const r = await api(`/agents/${id}`, { method: 'PUT', body, headers });
      assert.equal(r.status, status, `${JSON.stringify(body)} ${JSON.stringify(headers)}: ${r.text}`);
    }
    assert.equal((await api('/agents/0123456789ab', { method: 'PUT', body: { act: true } })).status, 404);
    assert.deepEqual((await api('/agents')).json.keys.find(k => k.id === id).scopes, ['fleet:read'], 'refused requests changed nothing');
  });
  test('the owner\'s switches: GET /agents shows them; PUT /agents/settings checks its input', async () => {
    assert.deepEqual((await api('/agents')).json.settings, { halted: false, selfHeal: true });
    for (const [body, headers, status] of [[{ halted: 'true' }, {}, 400], [{ selfHeal: 1 }, {}, 400], [{ halted: true }, { 'x-spark-console': null }, 403],
      [{ halted: true }, { 'tailscale-user-login': MEMBER }, 403]]) {
      const r = await api('/agents/settings', { method: 'PUT', body, headers });
      assert.equal(r.status, status, `${JSON.stringify(body)}: ${r.text}`);
    }
    const r = await api('/agents/settings', { method: 'PUT', body: {} });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.settings.halted, false);
    assert.equal(r.json.settings.selfHeal, true);
  });
  test('the change tools don\'t claim to be harmless to MCP clients (stopping isn\'t an additive update)', async () => {
    const tools = (await rpc(keys.act.token, 'tools/list')).json.result.tools;
    for (const name of ['start_model', 'stop_model']) assert.equal(tools.find(t => t.name === name).annotations.destructiveHint, true, name);
  });
  test('initialize doesn\'t tell a key that can act that the tools only read', async () => {
    const r = await rpc(keys.act.token, 'initialize', { protocolVersion: '2025-06-18' });
    assert.doesNotMatch(r.json.result.instructions, /only read/);
  });
  test('deploy_plan doesn\'t tell a key that can act that agents can\'t start models', async () => {
    const x = await ok('deploy_plan', { model: 'gpt-oss-20b', spark: 'spark3' });
    assert.doesNotMatch(x.next, /can’t start models/);
  });
});

/* ───────── the owner's pause ───────── */
describe('when the owner pauses agents\' changes', () => {
  test('every change is refused; reads keep working; nothing runs', async () => {
    const since = new Date().toISOString();
    assert.equal((await agentSettings({ halted: true })).halted, true);
    try {
      assert.equal((await api('/agents')).json.settings.halted, true);
      for (const [name, args] of [['start_model', { model: 'gpt-oss-20b', spark: 'spark3' }], ['stop_model', { spark: 'spark2', container: 'sc-gpt-oss-20b' }],
        ['restart_model', { spark: 'spark3', container: 'sc-gpt-oss-20b' }], ['start_model', { choice: '0123456789' }]]) {
        await refused(name, args, 'not_allowed', /Agents’ changes are paused/);
      }
      await ok('fleet_status', {});
      await refused('wait_operation', { id: '0123456789ab', seconds: 1 }, 'not_found', /expired/);
      const ev = await ok('fleet_events', { since, type: 'operation' });
      assert.ok(ev.events.some(e => e.operation === 'agents paused'), JSON.stringify(ev.events));
    } finally { await agentSettings({ halted: false }); }
    assert.deepEqual(await operations(), []);
    assert.equal(stateOf('spark2', 'sc-gpt-oss-20b'), 'running');
    const doorLine = auditLines().find(l => l.agent && l.action === 'stop_model' && l.ok === false);
    assert.equal(doorLine?.error, 'not_allowed', JSON.stringify(doorLine));
  });
  test('an unreadable settings file counts as paused, not as "go ahead"', async () => {
    const f = join(T.fleet.stateDir, 'agent-settings.json');
    writeFileSync(f, '{"halted": fal', { mode: 0o600 });
    try {
      assert.equal((await api('/agents')).json.settings.halted, true);
      await refused('start_model', { model: 'gpt-oss-20b', spark: 'spark3' }, 'not_allowed', /paused/);
    } finally { await agentSettings({ halted: false }); }
    // Un-pausing writes a good file again (self-healing stays off until the owner turns it back on).
    let s = (await api('/agents')).json.settings;
    assert.equal(s.halted, false);
    assert.ok(!('unreadable' in s), JSON.stringify(s));
    s = await agentSettings({ selfHeal: true });
    assert.equal(s.selfHeal, true);
    assert.doesNotThrow(() => JSON.parse(readFileSync(f, 'utf8')));
    assert.equal((await ok('start_model', { model: 'gpt-oss-20b' })).outcome, 'already');
  });
});

/* ───────── names and questions ───────── */
// These only ask and get refused, so they run side by side.
describe('names and questions', { concurrency: true }, () => {
  test('already running, by any of its names: nothing changes', () => withKey('n-already', async t => {
    for (const model of ['gpt-oss-20b', 'openai/gpt-oss-20b']) {
      const x = await ok('start_model', { model }, t);
      assert.equal(x.outcome, 'already', `${model}: ${JSON.stringify(x)}`);
      assert.deepEqual(x.runningOn.map(r => r.spark), ['spark2']);
    }
  }));
  test('a name that fits several models → a question whose choices are ids only', () => withKey('n-question', async t => {
    const x = await ok('start_model', { model: 'qwen' }, t);
    assertQuestion(x);
    assert.match(x.question, /could be several models/);
    assert.ok(x.choices.some(c => /Qwen3-30B/.test(c.label)), JSON.stringify(x.choices));
    assert.ok(!JSON.stringify(x.choices).includes('"model"'), 'the stored arguments aren\'t sent');
  }));
  test('a choice is used once, alone, and only by whoever was asked', async () => {
    const x = await ok('start_model', { model: 'qwen', spark: 'spark4' }, keys.act.token);
    assertQuestion(x);
    const pick = x.choices.find(c => /Qwen3-30B/.test(c.label));
    assert.ok(pick, JSON.stringify(x.choices));
    // another agent can't answer it
    await refused('start_model', { choice: pick.choice }, 'conflict', /expired or belongs to someone else/, keys.other.token);
    // other arguments alongside → refused, and the choice is still there
    await refused('start_model', { choice: pick.choice, model: 'gpt-oss-20b' }, 'invalid', /Send the choice alone/, keys.act.token);
    // the one asked: its stored arguments (Qwen3-30B on spark4, which hasn't the memory) are what runs
    await refused('start_model', { choice: pick.choice }, 'conflict', /Qwen3-30B-A3B-Instruct-2507 right now: not enough memory on Spark 4/, keys.act.token);
    // used up
    await refused('start_model', { choice: pick.choice }, 'conflict', /expired or belongs to someone else/, keys.act.token);
    await refused('start_model', { choice: '0123456789' }, 'conflict', /expired/, keys.act.token);
    await refused('stop_model', { choice: x.choices[0].choice }, 'conflict', /expired or belongs to someone else/, keys.act.token);
  });
  test('names it can\'t use are refused with why', () => withKey('n-refused', async t => {
    await refused('start_model', { model: 'zzqx nothing like this' }, 'not_found', /No model on disk or in the recipes matches/, t);
    await refused('start_model', {}, 'invalid', /Missing argument: model/, t);
    await refused('start_model', { model: 'gpt-oss-20b', spark: 'spark3', sparks: ['spark3', 'spark4'] }, 'invalid', /spark or sparks, not both/, t);
    await refused('start_model', { model: 'gpt-oss-20b', allowStop: ['redis-cache'] }, 'invalid', /Unknown argument: allowStop/, t);
    await refused('start_model', { model: 'z-lab--Qwen3.8-27B-DFlash2' }, 'conflict', /draft model/, t);
    await refused('start_model', { model: 'NVIDIA-Nemotron-Nano-9B-v2', spark: 'spark3' }, 'not_allowed', /run its own code/, t);
    await refused('start_model', { model: 'gpt-oss-20b', spark: 'spark1' }, 'conflict', null, t);
  }));
  test('a model whose spark.json isn\'t as safe as a recipe isn\'t started by an agent', () => withKey('n-unsafe', async t => {
    const add = (name, manifest) => {
      const d = join(T.fleet.root, 'spark3', 'models', name);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'config.json'), '{"architectures":["Qwen3ForCausalLM"],"model_type":"qwen3","torch_dtype":"bfloat16"}');
      closeSync(openSync(join(d, 'model.safetensors'), 'w'));
      truncateSync(join(d, 'model.safetensors'), 1000000);
      writeFileSync(join(d, 'spark.json'), JSON.stringify(manifest));
      return d;
    };
    const dirs = [add('unsafe-image-test', { engine: 'vllm', image: 'evil.example/vllm:latest', args: [] }),
      add('unsafe-env-test', { engine: 'vllm', args: [], env: { LD_PRELOAD: '/tmp/x.so' } })];
    try {
      await refused('start_model', { model: 'unsafe-image-test', spark: 'spark3' }, 'not_allowed', /names its own image/, t);
      await refused('start_model', { model: 'unsafe-env-test', spark: 'spark3' }, 'not_allowed', /sets LD_PRELOAD/, t);
    } finally { for (const d of dirs) rmSync(d, { recursive: true, force: true }); }
  }));
});
test('none of those questions and refusals started or stopped anything', async () => assert.deepEqual(await operations(), []));

/* ───────── where a model goes ───────── */
// Each on its own Spark's memory, side by side.
describe('where a model goes (the rails)', { concurrency: true }, () => {
  test('two Sparks together: never with Spark 2 (Sparkie\'s), and only over a cable that passed at full size', () => withKey('r-link', async t => {
    // Spark 2 is the brain's, whatever its cable says (spark2–spark4's is "partial" on the stand-ins anyway).
    await refused('start_model', { model: 'gpt-oss-120b', sparks: ['spark2', 'spark4'] }, 'not_allowed', /Spark 2 is Sparkie’s \(the brain’s\), so no other workload starts there/, t);
    await refused('start_model', { model: 'gpt-oss-120b', sparks: ['spark2', 'spark3'] }, 'not_allowed', /Spark 2 is Sparkie’s/, t);
    // (Spark 3 + Spark 4's cable passes at full size on the stand-ins, like the real ones: "a model across two linked Sparks" below.)
  }));
  test('memory: 8 GB stays free; not enough is refused; unknown is refused', () => withKey('r-mem', async t => {
    // Qwen3-30B-A3B-Instruct-2507 needs 75 GiB (its spark.json).
    const meminfo = readFileSync(mock('spark4', 'meminfo'), 'utf8');
    try {
      setFree('spark4', 80);
      await refused('start_model', { model: 'Qwen3-30B-A3B-Instruct-2507', spark: 'spark4' }, 'conflict', /less than 8 GB free on Spark 4/, t);
      setFree('spark4', 40);
      await refused('start_model', { model: 'Qwen3-30B-A3B-Instruct-2507', spark: 'spark4' }, 'conflict', /not enough memory on Spark 4/, t);
      writeFileSync(mock('spark4', 'meminfo'), 'MemTotal:       127607420 kB\n');
      await refused('start_model', { model: 'Qwen3-30B-A3B-Instruct-2507', spark: 'spark4' }, 'conflict', /free memory on [sS]park ?4 is unknown/, t);
    } finally { writeFileSync(mock('spark4', 'meminfo'), meminfo); setFree('spark4', MEM.spark4); }
  }));
  test('Spark 2 (where Sparkie runs) is never used: not when it\'s the only one with room, not when named', () => withKey('r-spark2', async t => {
    // gpt-oss-120b (80 GiB) only fits on spark2 now: Spark 3's free memory is unknown, which also rules out the
    // Spark 3 + Spark 4 pair (Spark 4 alone is too small).
    const meminfo3 = readFileSync(mock('spark3', 'meminfo'), 'utf8');
    setFree('spark2', 110);
    writeFileSync(mock('spark3', 'meminfo'), 'MemTotal:       127607420 kB\n');
    try {
      await refused('start_model', { model: 'gpt-oss-120b' }, 'conflict', /spark2 is Sparkie’s, so nothing else starts there/, t);
      await refused('start_model', { model: 'gpt-oss-120b', spark: 'spark2' }, 'not_allowed', /Spark 2 is Sparkie’s \(the brain’s\)/, t);
    } finally { setFree('spark2', MEM.spark2); writeFileSync(mock('spark3', 'meminfo'), meminfo3); }
  }));
});
test('none of the rails above started or stopped anything', async () => assert.deepEqual(await operations(), []));

/* ───────── a model Sparkie's chats or apps use ───────── */
describe('a model that answers Sparkie\'s chats or apps', () => {
  const TESTORG = 'sc-testorg--Qwen3.8-27B-abliterated-GGUF';
  const route = async choice => {
    const r = await api('/main/route', { method: 'POST', body: { role: 'agents', choice } });
    assert.equal(r.status, 200, r.text);
  };
  test('stopping it, or starting something that would stop it, is the owner\'s call: a question', async () => {
    await route(`deploy:spark3:${TESTORG}`);
    try {
      const q = await ok('start_model', { model: 'gpt-oss-20b', spark: 'spark3' }, keys.act.token);
      assertQuestion(q);
      assert.match(q.question, /answers Sparkie’s chats or apps/);
      const s = await ok('stop_model', { spark: 'spark3', container: TESTORG }, keys.act.token);
      assertQuestion(s);
      assert.match(s.question, /answers Sparkie’s chats or apps\. Stop it anyway\?/);
      // (asked of a direct call, an owner-only question hands back no choice ids: nothing could answer them)
      assert.ok(s.choices.every(c => c.choice === null), JSON.stringify(s.choices));
      assert.match(s.note, /no choice to send back: the owner asks Sparkie for it in their own chat there \(“Yes, stop /);
    } finally { await route('same'); }
    assert.equal(stateOf('spark3', TESTORG), 'running');
    assert.deepEqual(await operations(), []);
  });
  test('a stop_model choice sent with other arguments is refused; an agent can\'t answer it at all (only the owner)', { timeout: 60000 * SLOW }, async () => {
    await route(`deploy:spark3:${TESTORG}`);
    try {
      const s = await ok('stop_model', { spark: 'spark3', container: TESTORG }, keys.act.token);
      assert.match(s.note, /Only the owner can answer this one/);
      // (no id to answer with comes back at all; one made up is refused)
      assert.ok(s.choices.every(c => c.choice === null), JSON.stringify(s.choices));
      await refused('stop_model', { choice: 'abcdef0123', spark: 'spark3' }, 'invalid', /Send the choice alone/, keys.act.token);
      await refused('stop_model', { choice: 'abcdef0123' }, 'conflict', /expired or belongs to someone else/, keys.act.token);
    } finally { await route('same'); }
    assert.equal(stateOf('spark3', TESTORG), 'running');
  });
});

/* ───────── deploys: one scenario per Spark, at the same time ───────── */
// Each scenario has its own key (a key runs at most 3 tools at once) and touches only its own Spark.
describe('deploys on three Sparks at once', { concurrency: true }, () => {
  test('spark4: room only by stopping something Spark Console didn\'t start → a question only the owner answers; once it\'s freed the start goes ahead; then less memory than planned → nothing starts, and what stopped runs again; a restart while another holds the port fails cleanly', { timeout: 180000 * SLOW }, async () => {
    const k = await createActKey('spark4');
    // comfy-box: started by hand on spark4, 60 GiB on the GPU.
    addContainer('spark4', 'comfy-box|running|Up 2 hours|0||');
    writeFileSync(mock('spark4', 'gpu'), '3039, 170, python3\n4100, 61440, python3, comfy-box\n');
    setFree('spark4', 28);
    const plan = await ok('deploy_plan', { model: 'Qwen3-30B-A3B-Instruct-2507', spark: 'spark4' }, k.token);
    assert.ok(plan.steps.some(s => s.do === 'stop' && s.container === 'comfy-box'), `the stand-in GPU → container lookup works: ${JSON.stringify(plan.steps)}`);
    const q = await ok('start_model', { model: 'Qwen3-30B-A3B-Instruct-2507', spark: 'spark4' }, k.token);
    assertQuestion(q);
    assert.match(q.question, /comfy-box/);
    assert.match(q.question, /not started by Spark Console/);
    const yes = q.choices.find(c => /^Yes/.test(c.label)), no = q.choices.find(c => /^No/.test(c.label));
    assert.ok(yes && no, JSON.stringify(q.choices));
    assert.equal(stateOf('spark4', 'comfy-box'), 'running', 'asking stops nothing');
    // Stopping something started outside Spark Console is the owner's call alone: the agent is told to ask them, and
    // gets no choice id to say yes with itself (docs/contract.md 8.4).
    assert.match(q.note, /Only the owner can answer this one/);
    assert.ok(q.choices.every(c => c.choice === null && !c.call), JSON.stringify(q.choices));
    assert.match(q.note, /no choice to send back/);
    assert.equal(stateOf('spark4', 'comfy-box'), 'running');
    // The owner stops comfy-box themselves; then the start goes ahead, stopping only Spark Console's own model there.
    removeContainer('spark4', 'comfy-box');
    writeFileSync(mock('spark4', 'gpu'), '3039, 170, python3\n');
    setFree('spark4', 88);
    const x = await ok('start_model', { model: 'Qwen3-30B-A3B-Instruct-2507', spark: 'spark4' }, k.token);
    assert.equal(x.outcome, 'started', JSON.stringify(x));
    assert.deepEqual(x.sparks, ['spark4']);
    assert.deepEqual([...x.stops].sort(), ['spark4/sc-RadixArk--Qwen3.8-27B-NVFP4']);
    const w = await finished(x.operation, k.token);
    assert.equal(w.status, 'completed', JSON.stringify(w));
    assert.equal(w.type, 'deploy');
    assert.match(w.endpoint, /\/v1$/);
    assert.equal(stateOf('spark4', 'sc-RadixArk--Qwen3.8-27B-NVFP4'), 'exited');
    assert.equal(stateOf('spark4', 'sc-Qwen3-30B-A3B-Instruct-2507'), 'running');

    // Next: gpt-oss-20b (copied to spark4 first) would stop sc-Qwen3-30B; then something else takes the memory before
    // the deploy measures it.
    setFree('spark4', 60);
    const y = await ok('start_model', { model: 'gpt-oss-20b', spark: 'spark4' }, k.token);
    assert.equal(y.outcome, 'started', JSON.stringify(y));
    assert.deepEqual(y.stops, ['spark4/sc-Qwen3-30B-A3B-Instruct-2507']);
    setFree('spark4', 10);
    const v = await finished(y.operation, k.token);
    setFree('spark4', MEM.spark4);
    assert.equal(v.status, 'failed', JSON.stringify(v));
    assert.match(v.error, /Not enough free memory on spark4.*Nothing was started/s);
    assert.ok(v.recentLog.some(l => /Started sc-Qwen3-30B-A3B-Instruct-2507 on spark4 again/.test(l)), v.recentLog.join('\n'));
    assert.equal(stateOf('spark4', 'sc-Qwen3-30B-A3B-Instruct-2507'), 'running');
    assert.notEqual(stateOf('spark4', 'sc-gpt-oss-20b'), 'running');

    // Restarting another stopped deploy while that one holds the port fails cleanly: never a false "completed".
    const c = await call(k.token, 'restart_model', { spark: 'spark4', container: 'sc-RadixArk--Qwen3.8-27B-NVFP4' });
    if (c.isError) assert.match(c.text, /^\[conflict/, c.text);
    else {
      const cw = await finished(c.value.operation, k.token);
      assert.equal(cw.status, 'failed', JSON.stringify(cw));
      assert.match(cw.error, /port is already allocated/);
    }
    assert.equal(stateOf('spark4', 'sc-Qwen3-30B-A3B-Instruct-2507'), 'running');
    assert.notEqual(stateOf('spark4', 'sc-RadixArk--Qwen3.8-27B-NVFP4'), 'running');
  });

  test('spark3: start_model → wait_operation to completed → running_models shows it → stop_model → restart_model (room checked first)', { timeout: 180000 * SLOW }, async () => {
    const k = await createActKey('spark3');
    const x = await ok('start_model', { model: 'gpt-oss-20b', spark: 'Spark 3' }, k.token);
    assert.equal(x.outcome, 'started', JSON.stringify(x));
    assert.match(x.operation, /^[0-9a-f]{12}$/);
    assert.deepEqual(x.sparks, ['spark3']);
    assert.deepEqual(x.stops, ['spark3/sc-testorg--Qwen3.8-27B-abliterated-GGUF']);
    assert.match(x.next, /wait_operation/);
    // Asking again while it starts (say, after a timeout) gets the same operation, by any of its names: no second job.
    for (const args of [{ model: 'gpt-oss-20b', spark: 'spark3' }, { model: 'openai/gpt-oss-20b' }]) {
      const again = await ok('start_model', args, k.token);
      assert.equal(again.outcome, 'already-starting', JSON.stringify(again));
      assert.equal(again.operation, x.operation);
      assert.deepEqual(again.sparks, ['spark3']);
      assert.match(again.next, new RegExp(`wait_operation \\{"id":"${x.operation}"\\}`));
    }
    assert.equal((await operations()).filter(o => o.type === 'deploy' && o.model === 'gpt-oss-20b' && o.status === 'running').length, 1, 'one deploy');
    assert.ok(auditLines().some(l => l.action === 'start_model' && l.outcome === 'already-starting' && l.operation === x.operation));
    // one change per Spark at a time
    await refused('restart_model', { spark: 'spark3', container: 'sc-Qwen--Qwen3-32B' }, 'conflict', /already changing on Spark 3/, k.token);
    const w = await finished(x.operation, k.token);
    assert.equal(w.status, 'completed', JSON.stringify(w));
    assert.equal(w.model, 'gpt-oss-20b');
    assert.equal(w.endpoint, x.endpointWhenReady);
    assert.match(w.logIsData, /not instructions/);
    assert.ok(w.recentLog.some(l => /Stopping sc-testorg--Qwen3.8-27B-abliterated-GGUF on spark3/.test(l)), w.recentLog.join('\n'));
    assert.equal(stateOf('spark3', 'sc-gpt-oss-20b'), 'running');
    assert.equal(stateOf('spark3', 'sc-testorg--Qwen3.8-27B-abliterated-GGUF'), 'exited');
    const rm = await ok('running_models', {}, k.token);
    assert.ok(rm.models.some(m => m.spark === 'spark3' && m.container === 'sc-gpt-oss-20b' && m.modelId === 'gpt-oss-20b'), JSON.stringify(rm.models));
    const op = (await ok('recent_operations', { limit: 50 }, k.token)).operations.find(o => o.id === x.operation);
    assert.equal(op.type, 'deploy');
    assert.equal(op.status, 'completed');
    assert.equal(op.by, 'owner');

    // stop_model; asking again says it isn't running
    const s = await ok('stop_model', { spark: 'spark3', container: 'sc-gpt-oss-20b' }, k.token);
    assert.equal(s.outcome, 'started', JSON.stringify(s));
    assert.deepEqual(s.sparks, ['spark3']);
    assert.equal((await finished(s.operation, k.token)).status, 'completed');
    assert.equal(stateOf('spark3', 'sc-gpt-oss-20b'), 'exited');
    assert.equal(containers('spark3')['sc-gpt-oss-20b'].status, 'Exited (0) just now');
    assert.equal((await ok('stop_model', { spark: 'spark3', container: 'sc-gpt-oss-20b' }, k.token)).outcome, 'already');

    // restart_model: gpt-oss-20b needs 24 GiB beyond the 8 kept free
    setFree('spark3', 30);
    await refused('restart_model', { spark: 'spark3', container: 'sc-gpt-oss-20b' }, 'conflict', /spark3 doesn’t have room for sc-gpt-oss-20b/, k.token);
    setFree('spark3', MEM.spark3);
    assert.equal(stateOf('spark3', 'sc-gpt-oss-20b'), 'exited');
    const r = await ok('restart_model', { spark: 'spark3', container: 'sc-gpt-oss-20b' }, k.token);
    assert.equal(r.outcome, 'started', JSON.stringify(r));
    assert.equal(r.restarting, 'sc-gpt-oss-20b');
    const rw = await finished(r.operation, k.token);
    assert.equal(rw.status, 'completed', JSON.stringify(rw));
    assert.equal(rw.type, 'restart');
    assert.equal(stateOf('spark3', 'sc-gpt-oss-20b'), 'running');
    assert.equal((await ok('restart_model', { spark: 'spark3', container: 'sc-gpt-oss-20b' }, k.token)).outcome, 'already');
  });

  test('spark2 (Sparkie\'s): a start there is refused even when named, and what runs there keeps running', { timeout: 60000 * SLOW }, async () => {
    const k = await createActKey('spark2');
    assert.equal(stateOf('spark2', 'sc-gpt-oss-20b'), 'running');
    await refused('start_model', { model: 'gemma-3-12b-it', spark: 'spark2' }, 'not_allowed', /Spark 2 is Sparkie’s/, k.token);
    assert.equal(stateOf('spark2', 'sc-gpt-oss-20b'), 'running');
    assert.notEqual(stateOf('spark2', 'sc-gemma-3-12b-it'), 'running');
  });
});

// F9: a one-Spark start over a running copy of the same model sets that copy aside (as a start across two Sparks does),
// so a start that fails gives it back running, and one that works leaves nothing set aside. Runs after the Spark 3
// scenario above, which leaves sc-gpt-oss-20b running there.
test('a start over a running copy of the same model that fails leaves that copy running; one that works leaves nothing set aside', { timeout: 420000 * SLOW }, async () => {
  assert.equal(stateOf('spark3', 'sc-gpt-oss-20b'), 'running', 'the copy from the test before');
  const p = (await api('/deploy/plan?model=gpt-oss-20b&node=spark3')).json;
  const stops = p.steps.filter(s => s.kind === 'stop');
  assert.ok(stops.some(s => s.container === 'sc-gpt-oss-20b' && s.required), JSON.stringify(p.steps));
  const body = { model: 'gpt-oss-20b', node: 'spark3', keep: stops.filter(s => !s.required).map(s => s.container), stop: stops.filter(s => s.required).map(s => `spark3/${s.container}`) };
  // Every attempt runs out of memory while loading: the known fix (a shorter context) never gets under 1,000 tokens.
  writeFileSync(mock('spark3', 'oom-ctx'), '1000');
  let id = null;
  try {
    const r = await api('/deploy', { method: 'POST', body });
    assert.equal(r.status, 202, r.text);
    id = r.json.id;
    const w = await finished(id, keys.look.token, { timeout: 300000 });
    assert.equal(w.status, 'failed', JSON.stringify(w));
    assert.match(w.error, /^It didn’t start: it ran out of memory while loading \(3 attempts\)/);
    assert.ok(w.recentLog.some(l => /Started sc-gpt-oss-20b on spark3 again/.test(l)), w.recentLog.join('\n'));
    assert.equal(stateOf('spark3', 'sc-gpt-oss-20b'), 'running', 'the copy that ran before runs again');
    assert.ok(!Object.keys(containers('spark3')).some(n => n.includes('-before-')), Object.keys(containers('spark3')).join(', '));
  } finally {
    if (id) await api(`/jobs/${id}/cancel`, { method: 'POST', body: {} }).catch(() => {});
    rmSync(mock('spark3', 'oom-ctx'), { force: true });
  }
  // A start that works replaces the copy, and what it set aside is gone.
  const r2 = await api('/deploy', { method: 'POST', body });
  assert.equal(r2.status, 202, r2.text);
  const w2 = await finished(r2.json.id, keys.look.token, { timeout: 300000 });
  assert.equal(w2.status, 'completed', JSON.stringify(w2));
  assert.equal(stateOf('spark3', 'sc-gpt-oss-20b'), 'running');
  assert.ok(!Object.keys(containers('spark3')).some(n => n.includes('-before-')), Object.keys(containers('spark3')).join(', '));
});

describe('what stop_model and restart_model won\'t touch, beside a model across two linked Sparks', { concurrency: true }, () => {
  test('restart_model: a part of a two-Spark model, containers Spark Console didn\'t start, Sparkie\'s model', () => withKey('w-restart', async t => {
    await refused('restart_model', { spark: 'spark2', container: 'sc-gpt-oss-120b' }, 'conflict', /runs across two Sparks; use start_model/, t);
    await refused('restart_model', { spark: 'spark2', container: 'redis-cache' }, 'not_found', /isn’t one of Spark Console’s models on spark2/, t);
    await refused('restart_model', { spark: 'spark2', container: 'sparkie-main' }, 'not_allowed', /Sparkie’s own model/, t);
    await refused('restart_model', { spark: 'spark2', container: 'sc-no-such-thing' }, 'not_found', null, t);
  }));

  // (one after the other: both change spark4's containers)
  describe('stop_model', () => {
    test('containers Spark Console didn\'t start, Sparkie\'s model, protected names', async () => {
      await refused('stop_model', { spark: 'spark2', container: 'redis-cache' }, 'not_found', /isn’t one of Spark Console’s models on spark2/);
      await refused('stop_model', { spark: 'spark2', container: 'qwen-recipe-alzeo' }, 'not_found');
      await refused('stop_model', { spark: 'spark2', container: 'sparkie-main' }, 'not_allowed', /Sparkie’s own model/);
      await refused('stop_model', { spark: 'spark2' }, 'invalid', /Missing argument/);
      await refused('stop_model', { container: 'sc-gpt-oss-20b' }, 'invalid', /Missing argument/);
      await refused('stop_model', { spark: 'spark2', container: 'sc-gpt-oss-20b', confirmRouted: true }, 'invalid', /Unknown argument: confirmRouted/);
      // A console deploy named like the owner's protected benchmarks.
      addContainer('spark4', 'qwen-recipe-console|running|Up 1 minute|1|Qwen--Qwen3-32B||||');
      try {
        await refused('stop_model', { spark: 'spark4', container: 'qwen-recipe-console' }, 'not_allowed', /protected/);
        assert.equal(stateOf('spark4', 'qwen-recipe-console'), 'running');
      } finally { removeContainer('spark4', 'qwen-recipe-console'); }
      for (const name of ['redis-cache', 'qwen-recipe-alzeo', 'sparkie-main']) assert.equal(stateOf('spark2', name), 'running', name);
    });
    test('a console container labelled spark.protect=true is protected too', async () => {
      addContainer('spark4', 'sc-pinned|running|Up 1 minute|1|Qwen--Qwen3-32B|1|||');
      try {
        const r = await call(await tok(), 'stop_model', { spark: 'spark4', container: 'sc-pinned' });
        if (!r.isError) await finished(r.value.operation);
        assert.equal(r.isError, true, r.text);
        assert.match(r.text, /^\[not_allowed\]/);
      } finally { removeContainer('spark4', 'sc-pinned'); }
    });
  });

  // (on spark3 and spark4; the refusals beside it change nothing there)
  describe('a model across two linked Sparks', () => {
    test('start_model across a "full" pair (Spark 3 + Spark 4); a one-Spark start that would stop a part is refused; stop_model stops both parts', { timeout: 180000 * SLOW }, async () => {
      setFree('spark3', 70);
      setFree('spark4', 70);
      try {
        const x = await ok('start_model', { model: 'gpt-oss-120b', sparks: ['spark3', 'spark4'] }, keys.act.token);
        assert.equal(x.outcome, 'started', JSON.stringify(x));
        assert.deepEqual(x.sparks, ['spark3', 'spark4']);
        // T54: the result carries its plan: the workflow, its version, and each input with where it came from.
        assert.equal(x.plan?.workflow, 'start_model_across', JSON.stringify(x.plan));
        assert.match(x.plan.version, /^[0-9a-f]{12}$/);
        assert.deepEqual(x.plan.inputs.map(i => [i.name, i.value, i.source]), [['model', 'gpt-oss-120b', 'agent'], ['sparks', 'spark3 + spark4', 'agent']]);
        assert.equal(x.plan.checks.length, 3);
        const w = await finished(x.operation);
        assert.equal(w.status, 'completed', JSON.stringify({ w, events: (await ok('fleet_events', { limit: 40 }, keys.look.token)).events.filter(e => e.spark === 'spark4' || e.type === 'operation').slice(-15) }));
        assert.equal(w.type, 'deploy-cluster');
        assert.ok(w.recentLog.some(l => /It answers a test prompt/.test(l)), w.recentLog.join('\n'));
      } finally { setFree('spark3', MEM.spark3); setFree('spark4', MEM.spark4); }
      assert.equal(stateOf('spark3', 'sc-gpt-oss-120b'), 'running');
      assert.equal(stateOf('spark4', 'sc-gpt-oss-120b-part2'), 'running');
      assert.equal(containers('spark3')['sc-gpt-oss-120b'].cluster, 'spark3+spark4');
      // A start on spark4 would have to stop the second part (it holds 40 GiB of GPU memory there): refused, not asked.
      setFree('spark4', 70);
      const gpu = mock('spark4', 'gpu'), gpuBefore = readFileSync(gpu, 'utf8');
      writeFileSync(gpu, `${gpuBefore.trimEnd()}\n4242, 40960, python3, sc-gpt-oss-120b-part2\n`);
      try {
        await refused('start_model', { model: 'Qwen3-30B-A3B-Instruct-2507', spark: 'spark4' }, 'conflict', /sc-gpt-oss-120b-part2 on Spark 4 runs across two Sparks; stop it first/);
      } finally { writeFileSync(gpu, gpuBefore); setFree('spark4', MEM.spark4); }
      const s = await ok('stop_model', { spark: 'spark3', container: 'sc-gpt-oss-120b' }, keys.act.token);
      assert.deepEqual(s.sparks, ['spark3', 'spark4']);
      assert.equal((await finished(s.operation)).status, 'completed');
      assert.equal(stateOf('spark3', 'sc-gpt-oss-120b'), 'exited');
      assert.equal(stateOf('spark4', 'sc-gpt-oss-120b-part2'), 'exited');
    });
  });
});

/* ───────── downloads, and a pause stopping a running job ───────── */
describe('a model that isn\'t on disk yet', () => {
  test('start_model downloads it (never onto Spark 2); a pause stops the operation at its next step', { timeout: 120000 * SLOW }, async () => {
    const x = await ok('start_model', { model: 'qwen3.5-4b' }, keys.act.token);
    assert.equal(x.outcome, 'started', JSON.stringify(x));
    assert.match(x.model, /Qwen3\.5-4B/);
    assert.ok(!x.sparks.includes('spark2'), JSON.stringify(x));
    assert.equal((await operations()).find(o => o.id === x.operation)?.type, 'start-model');
    await agentSettings({ halted: true });
    let w;
    try { w = await finished(x.operation); } finally { await agentSettings({ halted: false }); }
    assert.equal(w.status, 'failed', JSON.stringify(w));
    assert.match(w.error, /Stopped: agents’ changes are paused/);
    // nothing was started for it
    for (const sp of ['spark3', 'spark4']) assert.ok(!Object.keys(containers(sp)).some(n => /Qwen3\.5-4B/.test(n)), sp);
  });
});

describe('a Spark without the hf command', () => {
  // 2026-11-11: neither Spark 3 nor Spark 4 had it, and GLM-5.3-Flash couldn't download. The models already there had
  // come down inside containers; the download does the same, with the library in an engine image that Spark has.
  test('a download from Recipes uses the Hugging Face library inside an engine image there, into the same cache', { timeout: 120000 * SLOW }, async () => {
    writeFileSync(mock('spark3', 'no-hf'), '');
    try {
      const r = await api('/recipes/download', { method: 'POST', body: { repo: 'zai-org/GLM-OCR', node: 'spark3' } });
      assert.equal(r.status, 202, r.text);
      let j;
      for (const until = Date.now() + 90000 * SLOW; ; await new Promise(res => setTimeout(res, 1000))) {
        j = (await api(`/jobs/${r.json.id}`)).json;
        if (j.status !== 'running') break;
        assert.ok(Date.now() < until, 'still downloading');
      }
      assert.equal(j.status, 'completed', JSON.stringify(j));
      assert.ok(j.log.some(l => /Downloaded with the Hugging Face library inside (vllm\/vllm-openai|lmsysorg\/sglang) \(spark3 has no hf command\)/.test(l)), j.log.join('\n'));
      assert.ok(existsSync(join(T.fleet.root, 'spark3', '.cache', 'huggingface', 'hub', 'models--zai-org--GLM-OCR', 'snapshots', 'm0ck', 'model.safetensors')), 'in the Spark\'s cache');
      const args = readFileSync(mock('spark3', 'last-run-args'), 'utf8');
      assert.match(args, /^--rm$/m, 'the download container goes away');
      assert.match(args, /:\/hf\/hub$/m, 'the cache is mounted, not copied');
      // The library's own home (xet's logs and cache) is the container's /tmp: the first real try stopped on /hf.
      assert.match(args, /^HF_HOME=\/tmp\/hf$/m, args);
      // Fast: xet's high-performance mode and 16 files at once (the defaults gave 17 MB/s on a 500 Mbit/s line).
      assert.match(args, /^HF_XET_HIGH_PERFORMANCE=1$/m, args);
      assert.match(args, /max_workers=16/, 'many files at once');
    } finally { rmSync(mock('spark3', 'no-hf'), { force: true }); }
  });
  test('Spark 3 is the models\' default home: Recipes offers it first, and a download with no Spark named goes there (Spark 2 is the brain\'s)', { timeout: 120000 * SLOW }, async () => {
    const rec = await api('/recipes');
    assert.equal(rec.status, 200, rec.text);
    assert.equal(rec.json.modelsHost, 'spark3');
    assert.equal(rec.json.defaultTarget, 'spark3', JSON.stringify(rec.json.targets));
    const r = await api('/recipes/download', { method: 'POST', body: { repo: 'zai-org/GLM-OCR' } });
    assert.equal(r.status, 202, r.text);
    assert.equal(r.json.node, 'spark3', JSON.stringify(r.json));
    for (const until = Date.now() + 90000 * SLOW; (await api(`/jobs/${r.json.id}`)).json.status === 'running'; await new Promise(res => setTimeout(res, 1000))) {
      assert.ok(Date.now() < until, 'still downloading');
    }
  });
  test('the owner stopping a model on that Spark leaves its download running (2026-11-11: it cancelled GLM-5.3-Flash\'s)', { timeout: 120000 * SLOW }, async () => {
    const line = 'sc-stand-in|running|Up 1 hour|1|stand-in-model|||||';
    const list = mock('spark3', 'containers'), before = readFileSync(list, 'utf8');
    writeFileSync(list, `${before.trimEnd()}\n${line}\n`);
    for (const f of ['no-hf', 'hf-slow']) writeFileSync(mock('spark3', f), '');
    try {
      const r = await api('/recipes/download', { method: 'POST', body: { repo: 'zai-org/GLM-OCR', node: 'spark3' } });
      assert.equal(r.status, 202, r.text);
      await new Promise(res => setTimeout(res, 3000));
      const s = await api('/stop', { method: 'POST', body: { node: 'spark3', container: 'sc-stand-in' } });
      assert.equal(s.status, 202, s.text);
      let j;
      for (const until = Date.now() + 90000 * SLOW; ; await new Promise(res => setTimeout(res, 1000))) {
        j = (await api(`/jobs/${r.json.id}`)).json;
        if (j.status !== 'running') break;
        assert.ok(Date.now() < until, 'still downloading');
      }
      assert.equal(j.status, 'completed', JSON.stringify(j));
      assert.ok(!j.log.some(l => /Cancell/.test(l)), j.log.join('\n'));
    } finally {
      for (const f of ['no-hf', 'hf-slow']) rmSync(mock('spark3', f), { force: true });
      writeFileSync(list, readFileSync(list, 'utf8').split('\n').filter(l => !l.startsWith('sc-stand-in|')).join('\n'));
    }
  });
  test('a download that fails on a file it can\'t write says so, not that Hugging Face refused it (a traceback\'s "line 401")', { timeout: 120000 * SLOW }, async () => {
    for (const f of ['no-hf', 'hf-fails']) writeFileSync(mock('spark3', f), '');
    try {
      const r = await api('/recipes/download', { method: 'POST', body: { repo: 'zai-org/GLM-OCR', node: 'spark3' } });
      assert.equal(r.status, 202, r.text);
      let j;
      for (const until = Date.now() + 90000 * SLOW; ; await new Promise(res => setTimeout(res, 1000))) {
        j = (await api(`/jobs/${r.json.id}`)).json;
        if (j.status !== 'running') break;
        assert.ok(Date.now() < until, 'still downloading');
      }
      assert.equal(j.status, 'failed', JSON.stringify(j));
      assert.match(j.error, /Permission denied/, j.error);
      assert.ok(!/refused the download/.test(j.error), j.error);
    } finally { for (const f of ['no-hf', 'hf-fails']) rmSync(mock('spark3', f), { force: true }); }
  });
});

describe('Recipes knows each model\'s best setup', () => {
  const recipeModel = async id => (await api('/recipes')).json.models.find(m => m.id === id);
  test('an entry from NVIDIA\'s model list has no command, so it isn\'t one-click; once NVIDIA\'s recipe file is found, that replaces it', { timeout: 120000 * SLOW }, async () => {
    // 2026-11-11: 16 such entries were one-click (GLM-5.3-Flash, MiniMax M2.7…) and would have run the engine's defaults.
    const all = (await api('/recipes')).json.models.flatMap(m => m.setups);
    // Only setups that hold up are listed: none of the low-credibility ones (single unverified posts, experimental entries).
    assert.ok(!all.some(s => s.credibility === 'low'), JSON.stringify(all.filter(s => s.credibility === 'low').map(s => s.id)));
    const empty = all.filter(s => s.source?.kind === 'nvidia' && !(s.args || []).length);
    assert.ok(empty.every(s => s.deployable === false), JSON.stringify(empty.filter(s => s.deployable)));
    // (Some were never one-click, for another reason they keep; the rest now say why.)
    assert.ok(empty.filter(s => /NVIDIA’s model list gives its image, not its command/.test(s.why)).length >= 10, JSON.stringify(empty.map(s => s.why)));
    const r = await api('/recipes/dig', { method: 'POST', body: { model: 'glm-5.3-flash' } });
    assert.equal(r.status, 202, r.text);
    for (const until = Date.now() + 60000 * SLOW; (await api(`/jobs/${r.json.id}`)).json.status === 'running'; await new Promise(res => setTimeout(res, 500))) assert.ok(Date.now() < until);
    const glm = await recipeModel('glm-5.3-flash');
    const full = glm.setups.find(s => /NVIDIA\/local-ai-inference-recipes/.test(s.source?.url || '') && s.sparks === 2);
    assert.ok(full?.deployable && full.args.includes('--quantization'), JSON.stringify(full));
    // The list entry it replaces isn't listed any more (Recipes shows only setups that hold up).
    assert.ok(!glm.setups.some(s => s.id === '1df158e195'), 'replaced');
  });
  test('Sparkie (or an agent) can look a model\'s setups up itself: find_setups, then recipe_detail has them', { timeout: 120000 * SLOW }, async () => {
    const r = await call(keys.act.token, 'find_setups', { model: 'glm-5.3-flash' });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.value.outcome, 'started', r.text);
    const w = await finished(r.value.operation);
    assert.equal(w.status, 'completed', JSON.stringify(w));
    assert.match(r.value.next, /recipe_detail \{"id":"glm-5\.3-flash"\}/, 'its hint names recipe_detail\'s real argument');
    const d = await call(keys.look.token, 'recipe_detail', { id: 'glm-5.3-flash' });
    assert.equal(d.isError, false, d.text);
    assert.match(d.text, /NVIDIA\/local-ai-inference-recipes/, 'the setup from NVIDIA’s recipe file, with its source');
  });
  test('a download looks for the model\'s best setups by itself, so it\'s known before anyone starts it', { timeout: 120000 * SLOW }, async () => {
    assert.ok(!(await recipeModel('paddleocr-vl-1.6')).setups.some(s => s.found), 'not looked up yet');
    const r = await api('/recipes/download', { method: 'POST', body: { repo: 'PaddlePaddle/PaddleOCR-VL-1.6', node: 'spark3' } });
    assert.equal(r.status, 202, r.text);
    let j;
    for (const until = Date.now() + 90000 * SLOW; ; await new Promise(res => setTimeout(res, 1000))) {
      j = (await api(`/jobs/${r.json.id}`)).json;
      if (j.status !== 'running') break;
      assert.ok(Date.now() < until, 'still downloading');
    }
    assert.equal(j.status, 'completed', JSON.stringify(j));
    assert.ok(j.log.some(l => /Looking for PaddleOCR-VL 1\.6’s best setups/.test(l)), j.log.join('\n'));
    let found;
    for (const until = Date.now() + 60000 * SLOW; !(found = (await recipeModel('paddleocr-vl-1.6')).setups.find(s => s.found && s.deployable)); await new Promise(res => setTimeout(res, 1000))) {
      assert.ok(Date.now() < until, 'never looked');
    }
    assert.match(found.source.url, /NVIDIA\/local-ai-inference-recipes/);
    assert.ok(found.args.includes('--max-model-len'), JSON.stringify(found));
  });
  // A9: a Hugging Face repo started or looked up by its full name joins Recipes; its own card is a source (read last,
  // code blocks for that very repo only). The dig fixture stands in for Hugging Face for testorg/Nova-2B and Qwen/Qwen3-32B.
  test('a model started by its full name joins Recipes, starts with the setup from its model card, and is one click after', { timeout: 300000 * SLOW }, async () => {
    assert.ok(!(await recipeModel('nova-2b')), 'not in Recipes yet');
    const q = await ok('start_model', { model: 'testorg/Nova-2B' }, keys.act.token);
    assertQuestion(q);
    assert.match(q.question, /isn’t in your recipes\. Download it from Hugging Face, add it to your recipes/);
    assert.ok(!(await operations()).some(o => o.model === 'testorg/Nova-2B'), 'nothing started');
    const x = await ok('start_model', { choice: q.choices[0].choice }, keys.act.token);
    assert.equal(x.outcome, 'started', JSON.stringify(x));
    assert.ok(!x.sparks.includes('spark2'), JSON.stringify(x));
    assert.match(x.note, /added/);
    const w = await finished(x.operation, keys.look.token, { timeout: 240000 });
    assert.equal(w.status, 'completed', JSON.stringify(w));
    const log = (await api(`/jobs/${x.operation}`)).json.log.join('\n');
    assert.match(log, /Added Nova-2B to Recipes/, log);
    assert.match(log, /Looking for Nova-2B’s best setups/, log);
    assert.match(log, /Starting it with recipe setup [0-9a-f]{10}/, log);
    const spark = x.sparks[0], args = readFileSync(mock(spark, 'last-run-args'), 'utf8').split('\n');
    assert.ok(args.includes('--max-num-seqs') && args.includes('4'), args.join(' '));
    assert.ok(!args.includes('--trust-remote-code'), 'the card’s words are never read');
    const nova = await recipeModel('nova-2b');
    assert.equal(nova?.added, true, JSON.stringify(nova));
    const found = nova.setups.filter(s => s.found);
    assert.equal(found.length, 1, JSON.stringify(found));
    assert.deepEqual({ kind: found[0].source.kind, url: found[0].source.url, deployable: found[0].deployable }, { kind: 'model-card', url: 'https://huggingface.co/testorg/Nova-2B', deployable: true });
    assert.ok(JSON.parse(readFileSync(join(T.fleet.stateDir, 'added-models.json'), 'utf8')).models.some(m => m.id === 'nova-2b'));
    assert.match((await call(keys.look.token, 'recipe_detail', { id: 'nova-2b' })).text, /"source":"model-card"/);
    // Stopped, then started again by name: no question, and the setup it used.
    const s = await ok('stop_model', { spark, container: 'sc-testorg--Nova-2B' }, keys.act.token);
    assert.equal((await finished(s.operation)).status, 'completed');
    const again = await ok('start_model', { model: 'testorg/Nova-2B', spark }, keys.act.token);
    assert.equal(again.outcome, 'started', JSON.stringify(again));
    assert.equal(again.setup, found[0].id);
    assert.equal((await finished(again.operation, keys.look.token, { timeout: 240000 })).status, 'completed');
    const s2 = await ok('stop_model', { spark, container: 'sc-testorg--Nova-2B' }, keys.act.token);
    assert.equal((await finished(s2.operation)).status, 'completed');
  });
  test('find_setups adds a model that isn’t in Recipes instead of refusing', { timeout: 120000 * SLOW }, async () => {
    const q = await call(keys.act.token, 'find_setups', { model: 'Qwen/Qwen3-32B' });
    assert.equal(q.isError, false, q.text);
    assert.match(q.value.question || '', /Qwen\/Qwen3-32B isn’t in your recipes\. Add it and look up its setups\?/, q.text);
    assert.ok(!(await api('/recipes')).json.models.some(m => m.variants?.some(v => v.repo === 'Qwen/Qwen3-32B')), 'not added by the question');
    // The owner's own call names it in full: no question.
    const r = await api('/actions/find_setups', { method: 'POST', body: { model: 'Qwen/Qwen3-32B' } });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual({ outcome: r.json.outcome, added: r.json.addedToRecipes }, { outcome: 'started', added: true });
    for (const until = Date.now() + 90000 * SLOW; (await api(`/jobs/${r.json.operation}`)).json.status === 'running'; await new Promise(res => setTimeout(res, 500))) assert.ok(Date.now() < until);
    assert.equal((await api(`/jobs/${r.json.operation}`)).json.status, 'completed');
    const id = /recipe_detail \{"id":"([^"]+)"\}/.exec(r.json.next)?.[1];
    const d = await call(keys.look.token, 'recipe_detail', { id, all: true });
    assert.equal(d.isError, false, d.text);
    const card = d.value.setups.filter(s => s.source === 'model-card');
    assert.equal(card.length, 1, JSON.stringify(d.value.setups));
    assert.deepEqual({ engine: card[0].engine, deployable: card[0].deployable }, { engine: 'sglang', deployable: true });
    assert.ok(card[0].args.includes('--context-length'), JSON.stringify(card[0]));
    // The agent's earlier choice still works: it's in Recipes now, so it only looks.
    const again = await call(keys.act.token, 'find_setups', { choice: q.value.choices[0].choice });
    assert.equal(again.value?.outcome, 'started', again.text);
    assert.ok(!('addedToRecipes' in again.value));
    assert.equal((await finished(again.value.operation)).status, 'completed');
  });
});

describe('saved workflows', () => {
  // The owner tells Sparkie a routine and it becomes a workflow of its own, run by name (2026-11-11).
  test('saved from steps of existing actions, listed for agents in workflows, run by name with its inputs, then forgotten', { timeout: 180000 * SLOW }, async () => {
    const bad = await call(keys.act.token, 'save_workflow', { title: 'loops', steps: [{ action: 'run_workflow', args: { name: 'loops' } }] });
    assert.equal(bad.isError, true, 'a workflow can’t run workflows');
    const unknown = await call(keys.act.token, 'save_workflow', { title: 'oops', steps: [{ action: 'find_setups', args: { model: '{modle}' } }] });
    assert.match(unknown.text, /uses \{modle\}, which isn’t one of its inputs/, unknown.text);
    const s = await call(keys.act.token, 'save_workflow', { title: 'Refresh setups', when: 'when I want a model’s setups looked up again',
      inputs: { model: 'the model' }, steps: [{ action: 'find_setups', args: { model: '{model}' } }] });
    assert.equal(s.isError, false, s.text);
    assert.equal(s.value.outcome, 'saved');
    assert.match(s.value.next, /run_workflow \{"name":"refresh-setups", "inputs": \{"model": …\}\}/);
    const listed = (await call(keys.look.token, 'workflows', {})).value.saved;
    assert.deepEqual(listed.map(w => [w.name, w.title, Object.keys(w.inputs)]), [['refresh-setups', 'Refresh setups', ['model']]]);
    const missing = await call(keys.act.token, 'run_workflow', { name: 'refresh setups' });
    assert.match(missing.text, /needs model \(the model\)/, missing.text);
    const r = await call(keys.act.token, 'run_workflow', { name: 'Refresh setups', inputs: { model: 'glm-5.3-flash' } });
    assert.equal(r.isError, false, r.text);
    const w = await finished(r.value.operation);
    assert.equal(w.status, 'completed', JSON.stringify(w));
    const log = (await api(`/jobs/${r.value.operation}`)).json.log;
    assert.ok(log.some(l => /Step 1 of 1: find_setups \{"model":"glm-5\.3-flash"\}/.test(l)), log.join('\n'));
    assert.ok(log.some(l => /Step 1 done \(operation [0-9a-f]{12}\)/.test(l)), log.join('\n'));
    assert.equal((await call(keys.look.token, 'workflows', {})).value.saved[0].lastRun.ok, true);
    const f = await call(keys.act.token, 'forget_workflow', { name: 'refresh-setups' });
    assert.equal(f.value.outcome, 'forgotten', f.text);
    assert.deepEqual((await call(keys.look.token, 'workflows', {})).value.saved, []);
  });
});

/* ───────── audit ───────── */
describe('audit.jsonl', () => {
  test('every change an agent asked for is a line: who, what, the outcome and its operation', async () => {
    const lines = auditLines();
    const started = lines.filter(l => l.via === 'agent' && l.action === 'start_model' && l.ok === true && l.outcome === 'started');
    assert.ok(started.length >= 3, JSON.stringify(lines.slice(-5)));
    for (const l of started) {
      assert.match(l.operation, /^[0-9a-f]{12}$/);
      assert.ok(Number.isFinite(l.ms));
      assert.ok(!Number.isNaN(Date.parse(l.at)));
      assert.equal(typeof l.actor, 'string');
    }
    assert.ok(started.some(l => l.actor === keys.act.name), 'the key\'s name is the actor');
    assert.ok(lines.some(l => l.via === 'agent' && l.action === 'stop_model' && l.ok === true && l.outcome === 'started'));
    assert.ok(lines.some(l => l.via === 'agent' && l.action === 'restart_model' && l.ok === true));
    // refusals inside the action are lines too, with why
    const refusedStop = lines.find(l => l.via === 'agent' && l.action === 'stop_model' && l.ok === false && /Sparkie’s own model/.test(l.error || ''));
    assert.ok(refusedStop, 'a refused stop is recorded');
    assert.deepEqual(refusedStop.args, { spark: 'spark2', container: 'sparkie-main' });
    // a question is an outcome
    assert.ok(lines.some(l => l.action === 'start_model' && l.outcome === 'question'));
    // and keys never are
    const raw = readFileSync(join(T.fleet.stateDir, 'audit.jsonl'), 'utf8');
    for (const k of Object.values(keys)) assert.ok(!raw.includes(k.token), 'a key in the audit log');
  });
});

/* ───────── a GPU app or job holds its Spark's GPU (A13 part E) ───────── */
// One GPU thing per Spark: a model start sees a GPU app or job by its label (spark.gpu=1), also while it is idle and
// nvidia-smi lists nothing for it. Starting a model there is the owner's question naming it, and nothing stops; a start
// that names no Spark goes elsewhere; a restart there is refused. Independent of the tests above: it sets Spark 4 up itself.
describe('a GPU app or job holds its Spark’s GPU (A13 part E)', () => {
  test('deploy_plan shows it as a stop; start_model there asks the owner and stops nothing; with no Spark named the model goes elsewhere; restart_model there is refused', { timeout: 300000 * SLOW }, async () => {
    const k = await createActKey('gpu-hold');
    // Spark 4 with none of Spark Console's models running (a GPU job starts only where no model runs), and a stopped one
    // of them to restart.
    writeFileSync(mock('spark4', 'containers'), readFileSync(mock('spark4', 'containers'), 'utf8').split('\n').filter(l => !l.startsWith('sc-Qwen3-30B-A3B-Instruct-2507|'))
      .map(l => (/^sc-[^|]*\|running\|[^|]*\|1\|/.test(l) ? l.replace(/\|running\|[^|]*\|/, '|exited|Exited (0) just now|') : l)).join('\n').replace(/\n*$/, '\n')
      + 'sc-Qwen3-30B-A3B-Instruct-2507|exited|Exited (0) just now|1|Qwen3-30B-A3B-Instruct-2507||||\n');
    let job = null;
    try {
      // The owner keeps a GPU job running there (idle: the stand-in nvidia-smi lists nothing for it).
      const started = await api('/actions/keep_running', { method: 'POST', body: { spark: 'spark4', container: 'gpu-hold', image: 'nvcr.io/nvidia/pytorch:25.10-py3', command: ['sleep', 'infinity'], once: true, gpu: true, memoryGB: 8 } });
      assert.equal(started.status, 200, started.text);
      assert.equal(started.json.outcome, 'started', started.text);
      job = started.json.operation;
      for (const until = Date.now() + 90000 * SLOW; (await api(`/jobs/${job}`)).json.status === 'running'; await new Promise(res => setTimeout(res, 500))) assert.ok(Date.now() < until);
      assert.equal((await api(`/jobs/${job}`)).json.status, 'completed', JSON.stringify((await api(`/jobs/${job}`)).json));
      assert.equal(stateOf('spark4', 'gpu-hold'), 'running');
      assert.ok(!readFileSync(mock('spark4', 'gpu'), 'utf8').includes('gpu-hold'), 'nvidia-smi doesn’t list it');

      const plan = await ok('deploy_plan', { model: 'Qwen--Qwen3-32B', spark: 'spark4' }, k.token);
      assert.ok(plan.steps.some(s => s.do === 'stop' && s.container === 'gpu-hold' && /GPU app or job: it has this Spark’s GPU to itself/.test(s.why) && !s.mustStop), JSON.stringify(plan.steps));
      assert.ok(plan.wouldStop.some(x => x.container === 'gpu-hold'), JSON.stringify(plan.wouldStop));

      // Named: the owner's question, naming it; nothing stops.
      const q = await ok('start_model', { model: 'Qwen--Qwen3-32B', spark: 'spark4' }, k.token);
      assert.equal(q.outcome, 'question', JSON.stringify(q));
      assert.match(q.question, /^gpu-hold has Spark 4’s GPU to itself\. Stop gpu-hold so /, q.question);
      assert.match(q.note, /Only the owner can answer this one/);
      assert.equal(stateOf('spark4', 'gpu-hold'), 'running', 'asking stops nothing');

      // A restart of a model of Spark Console's that's stopped there: refused, nothing stops.
      await refused('restart_model', { spark: 'spark4', container: 'sc-Qwen3-30B-A3B-Instruct-2507' }, 'conflict', /gpu-hold has Spark 4’s GPU now\. start_model can ask to stop it/, k.token);
      assert.equal(stateOf('spark4', 'sc-Qwen3-30B-A3B-Instruct-2507'), 'exited');
      assert.equal(stateOf('spark4', 'gpu-hold'), 'running');

      // No Spark named: it goes to another Spark (never Spark 2), and the GPU job keeps running. (It isn't running anywhere
      // first, so the start isn't "already".)
      for (const sp of ['spark2', 'spark3']) if (stateOf(sp, 'sc-Qwen--Qwen3-32B') === 'running') writeFileSync(mock(sp, 'containers'), readFileSync(mock(sp, 'containers'), 'utf8').replace(/^sc-Qwen--Qwen3-32B\|running\|[^|]*\|/m, 'sc-Qwen--Qwen3-32B|exited|Exited (0) just now|'));
      const x = await ok('start_model', { model: 'Qwen--Qwen3-32B' }, k.token);
      assert.equal(x.outcome, 'started', JSON.stringify(x));
      assert.deepEqual(x.sparks, ['spark3'], JSON.stringify(x));
      assert.ok(!x.stops.some(s => s.startsWith('spark4/')), JSON.stringify(x.stops));
      const w = await finished(x.operation, k.token, { timeout: 240000 });
      assert.equal(w.status, 'completed', JSON.stringify(w));
      assert.equal(stateOf('spark4', 'gpu-hold'), 'running');
    } finally {
      await api('/actions/keep_running', { method: 'POST', body: { spark: 'spark4', container: 'gpu-hold', do: 'stop' } }).catch(() => {});
      await deleteKey(k.id).catch(() => {});
    }
  });
});
