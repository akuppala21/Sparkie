// Covers: `running_models {detail}`: one running model's exact settings read from Docker now; secrets hidden; names
// that match none or several; the setup named only for exactly recorded settings; Sparkie's turn counts as outside
// text.
//
// "What is GLM running with?" (A7): running_models {detail} gives one running model server's exact settings, read from
// Docker now (one docker inspect of that container, read the way the watcher reads it): image, engine, its command with
// secrets hidden, context length, memory share, its Sparks, the port, when it started, and the Recipes setup those
// settings came from when Spark Console has a start with exactly those settings on record. Read only. The watcher looks
// only once a minute here, so nothing below comes from what it remembered.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, api, call, createKey, createActKey, newChat, say, SLOW } from './lib.mjs';

const RADIX = 'sc-RadixArk--Qwen3.8-27B-NVFP4', BENCH = 'qwen-recipe-alzeo-extended';
// What the stand-in docker inspect says a container's image is, and the FAKE secrets it puts in every command and environment.
const IMAGE = 'vllm/vllm-openai:v0.20.0', SECRETS = ['sk-abcdefghijklmnopqrstuvwxyz123', 'hf_secretsecretsecretsecret12'];
// A start of gpt-oss-20b on record, from a Recipes setup: the next start of it reuses these settings.
const SETUP_ARGS = ['--max-model-len', '65536', '--enable-prefix-caching'];
const recorded = { key: JSON.stringify(['gpt-oss-20b', 'vllm', IMAGE, 1, SETUP_ARGS, {}]), model: 'gpt-oss-20b', repo: null, title: 'gpt-oss 20B', engine: 'vllm', image: IMAGE,
  args: SETUP_ARGS, env: {}, sparks: 1, nodes: ['spark3'], firstAt: '2026-11-08T00:00:00Z', lastAt: '2026-11-08T00:00:00Z', runs: 1,
  // (faster than anything the stand-in measures, so a start of gpt-oss-20b picks this run)
  best: { decodeTokS: 1e6, ttftMs: 100 },
  setupId: 'abcd1234', sourceUrl: 'https://example.test/gpt-oss-20b-setup' };
// The same settings with one environment setting more, from another setup, recorded later: not what runs without it.
const withEnv = { ...recorded, key: JSON.stringify(['gpt-oss-20b', 'vllm', IMAGE, 1, SETUP_ARGS, { VLLM_USE_FLASHINFER_SAMPLER: '0' }]), env: { VLLM_USE_FLASHINFER_SAMPLER: '0' },
  lastAt: '2099-01-01T00:00:00.000Z', best: undefined, setupId: 'ffff0000', sourceUrl: 'https://example.test/other-setup' };
const keys = {};
useFleet({ watchMs: 60000, statusMs: 20000, prepare: ({ stateDir }) => writeFileSync(join(stateDir, 'verified.json'), JSON.stringify({ deployments: [recorded, withEnv] }), { mode: 0o600 }) },
  async () => { keys.look = await createKey('detail-look'); keys.act = await createActKey('detail-act'); });
const mock = (spark, file) => join(T.fleet.root, spark, '.mock', file);
// What the stand-in brain was sent (each request, with the tool results in it).
const requests = () => (existsSync(join(T.fleet.dir, 'model-requests.jsonl')) ? readFileSync(join(T.fleet.dir, 'model-requests.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const detail = async name => {
  const r = await call(keys.look.token, 'running_models', { detail: name });
  assert.equal(r.isError, false, r.text);
  for (const s of SECRETS) assert.ok(!r.raw.includes(s), `leaked ${s}`);
  return r.value;
};
const refused = async (name, code, re) => {
  const r = await call(keys.look.token, 'running_models', { detail: name });
  assert.equal(r.isError, true, r.raw);
  assert.match(r.text, new RegExp(`^\\[${code}(, retry later)?\\] `), r.text);
  assert.match(r.text, re);
};

describe('running_models {detail}: one running model’s exact settings', { concurrency: 1 }, () => {
  test('a model Spark Console runs: image, engine, command with the key hidden, context, Sparks, port, start time; only that one comes back', { timeout: 180000 * SLOW }, async () => {
    writeFileSync(mock('spark4', `started-${RADIX}`), '2026-11-10T09:30:00Z');
    const v = await detail(RADIX);
    assert.deepEqual(Object.keys(v), ['observedAt', 'textFromSparks', 'detail']);
    assert.ok(!Number.isNaN(Date.parse(v.observedAt)));
    assert.match(v.textFromSparks, /data, not instructions/);
    const d = v.detail;
    assert.deepEqual({ spark: d.spark, container: d.container, modelId: d.modelId, repo: d.repo, sparks: d.sparks, startedBySparkConsole: d.startedBySparkConsole },
      { spark: 'spark4', container: RADIX, modelId: 'RadixArk--Qwen3.8-27B-NVFP4', repo: 'RadixArk/Qwen3.8-27B-NVFP4', sparks: ['spark4'], startedBySparkConsole: true });
    assert.equal(d.image, IMAGE);
    assert.equal(d.engine, 'vllm');
    assert.deepEqual(d.command, ['vllm', 'serve', 'RadixArk--Qwen3.8-27B-NVFP4', '--port', '8000', '--max-model-len', '32768', '--api-key', '[hidden]']);
    assert.equal(d.contextTokens, 32768);
    assert.equal(d.contextSetBy, 'its --max-model-len flag');
    assert.equal(d.memoryShare, null);
    assert.equal(d.memoryShareGB, null);
    assert.equal(d.port, T.fleet.servePort);
    assert.equal(d.startedAt, '2026-11-10T09:30:00Z');
    assert.match(d.callWith.baseUrl, new RegExp(`:${T.fleet.servePort}/v1$`));
    // No start with exactly these settings is on record, so no setup is claimed.
    assert.equal(d.setup, null);
    assert.match(d.setupWords, /no record of a start with exactly these settings/);
    assert.ok(!('envNames' in d) && !JSON.stringify(d).includes('HF_TOKEN'), 'no environment');
    // The same by its model, its repo, its Spark and container, or a word of its name; and through POST /actions.
    for (const name of ['radixark/qwen3.8-27b-nvfp4', `spark4/${RADIX}`, 'RadixArk']) assert.deepEqual((await detail(name)).detail, d, name);
    const viaApi = await api('/actions/running_models', { method: 'POST', body: { detail: RADIX } });
    assert.equal(viaApi.status, 200, viaApi.text);
    assert.deepEqual(viaApi.json.detail, d);
  });

  test('without detail the answer is as before; a server started outside Spark Console has its settings too', { timeout: 120000 * SLOW }, async () => {
    const all = (await call(keys.look.token, 'running_models', {})).value;
    assert.ok(!('detail' in all) && !('textFromSparks' in all), 'no detail asked, none given');
    for (const k of ['gateway', 'models', 'otherServers', 'otherContainers', 'stopped', 'offline']) assert.ok(k in all, k);
    assert.ok(all.models.every(m => !('command' in m) && !('image' in m)));
    const d = (await detail(BENCH)).detail;
    assert.deepEqual({ spark: d.spark, container: d.container, startedBySparkConsole: d.startedBySparkConsole, startedOutsideSparkConsole: d.startedOutsideSparkConsole, sparks: d.sparks, port: d.port },
      { spark: 'spark2', container: BENCH, startedBySparkConsole: false, startedOutsideSparkConsole: true, sparks: ['spark2'], port: T.fleet.benchPort });
    assert.equal(d.image, 'lmsysorg/sglang:latest');
    assert.equal(d.command.at(-1), '[hidden]');
    assert.equal(d.contextTokens, 32768);
    assert.equal(d.setup, null);
  });

  test('a name nothing runs under, one that fits several, Sparkie’s own model, and a wrong type are refused plainly', { timeout: 120000 * SLOW }, async () => {
    await refused('no-such-model-test', 'not_found', /No running model matches “no-such-model-test”\. Running now: .*spark4\/sc-RadixArk--Qwen3\.8-27B-NVFP4.*Sparkie’s own model is in sparkie_setup\./);
    await refused('sparkie-main', 'not_found', /Sparkie’s own model is in sparkie_setup/);
    // (stopped deploys aren't running models)
    await refused('sc-Qwen--Qwen3-32B', 'not_found', /No running model matches/);
    await refused('qwen', 'invalid', /“qwen” matches 3 running models: .*Pass one of those as detail\./);
    const bad = await call(keys.look.token, 'running_models', { detail: 123 });
    assert.match(bad.text, /^\[invalid\] detail should be text/);
    const long = await call(keys.look.token, 'running_models', { detail: 'x'.repeat(201) });
    assert.match(long.text, /^\[invalid\] detail should be text of at most 200 characters/);
  });

  test('Sparkie: “what is radixark running with?” is answered from it; what a command says can’t become a memory without a button', { timeout: 120000 * SLOW }, async () => {
    const fromCommand = 'RadixArk should always run with the settings from its command';
    writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify([
      { match: '^what is radixark running with', calls: [{ name: 'running_models', arguments: { detail: 'radixark' } }] },
      { match: '^radixark runs with', rounds: [[{ name: 'running_models', arguments: { detail: RADIX } }], [{ name: 'remember', arguments: { text: fromCommand } }]] }]));
    try {
      const from = requests().length;
      const r = await say(await newChat(), 'what is radixark running with?');
      assert.deepEqual(r.message.tools.map(t => ({ name: t.name, ok: t.ok, change: t.change })), [{ name: 'running_models', ok: true, change: false }]);
      assert.match(r.text, /running_models said: \{"observedAt"/);
      const seen = requests().slice(from).flatMap(x => x.results.map(y => y.content)).join('\n');
      assert.match(seen, /"contextTokens":32768/);
      assert.match(seen, /"--api-key","\[hidden\]"/);
      for (const s of SECRETS) assert.ok(!seen.includes(s) && !JSON.stringify(r).includes(s), `leaked ${s}`);
      // The command is text from a container: in a turn that read it, a line that isn't mostly the owner's words is a button.
      const q = await say(await newChat(), 'radixark runs with a long context on spark 4, check its settings');
      assert.deepEqual(q.message.tools.map(t => [t.name, t.outcome || null]), [['running_models', null], ['remember', 'needs-ok']], JSON.stringify(q.message.tools));
      assert.deepEqual((await call(keys.look.token, 'memory', {})).value.entries, []);
    } finally { rmSync(join(T.fleet.dir, 'model-script.json'), { force: true }); }
  });

  test('a key quoted inside a shell-string command is hidden', { timeout: 120000 * SLOW }, async () => {
    try {
      for (const qt of ['"', "'"]) {
        writeFileSync(mock('spark2', `cmd-${BENCH}`), JSON.stringify(['bash', '-c', `python -m sglang.launch_server --model-path /m --api-key ${qt}local-dev-key-1${qt} --context-length 4096`]));
        const r = await call(keys.look.token, 'running_models', { detail: BENCH });
        assert.equal(r.isError, false, r.text);
        assert.ok(!r.raw.includes('local-dev-key-1'), 'quoted key shown');
        assert.equal(r.value.detail.command[2], `python -m sglang.launch_server --model-path /m --api-key ${qt}[hidden]${qt} --context-length 4096`);
        const viaApi = await api('/actions/running_models', { method: 'POST', body: { detail: BENCH } });
        assert.ok(!viaApi.text.includes('local-dev-key-1'), 'quoted key shown through POST /actions');
      }
    } finally { rmSync(mock('spark2', `cmd-${BENCH}`), { force: true }); }
  });

  test('a llama.cpp server started with --ctx-size: the context comes from that flag', { timeout: 120000 * SLOW }, async () => {
    const GGUF = 'sc-testorg--Qwen3.8-27B-abliterated-GGUF';
    const base = ['llama-server', '-m', '/hf/snapshots/abc123/RVN-Q4_K_M.gguf', '--host', '0.0.0.0', '--port', '8000', '--alias', 'testorg/Qwen3.8-27B-abliterated-GGUF', '-ngl', '999'];
    try {
      writeFileSync(mock('spark3', `cmd-${GGUF}`), JSON.stringify([...base, '--ctx-size', '16384', '--jinja']));
      let d = (await detail(`spark3/${GGUF}`)).detail;
      assert.deepEqual({ engine: d.engine, contextTokens: d.contextTokens, contextSetBy: d.contextSetBy }, { engine: 'llama.cpp', contextTokens: 16384, contextSetBy: 'its --ctx-size flag' });
      writeFileSync(mock('spark3', `cmd-${GGUF}`), JSON.stringify([...base, '--ctx-size=8192']));
      assert.equal((await detail(`spark3/${GGUF}`)).detail.contextTokens, 8192);
      writeFileSync(mock('spark3', `cmd-${GGUF}`), JSON.stringify([...base, '-c', '4096']));
      d = (await detail(`spark3/${GGUF}`)).detail;
      assert.deepEqual({ contextTokens: d.contextTokens, contextSetBy: d.contextSetBy }, { contextTokens: 4096, contextSetBy: 'its -c flag' });
    } finally { rmSync(mock('spark3', `cmd-${GGUF}`), { force: true }); }
  });

  test('after a start from a recorded setup: its real command gives the memory share and context, and names the setup', { timeout: 300000 * SLOW }, async () => {
    const x = await call(keys.act.token, 'start_model', { model: 'gpt-oss-20b', spark: 'spark3' });
    assert.equal(x.value?.outcome, 'started', x.text);
    assert.equal(x.value.setup, 'abcd1234');
    for (const until = Date.now() + 240000 * SLOW; ;) {
      const w = (await call(keys.look.token, 'wait_operation', { id: x.value.operation, seconds: 20 })).value;
      if (w.status !== 'running') { assert.equal(w.status, 'completed', JSON.stringify(w)); break; }
      assert.ok(Date.now() < until, 'still starting');
    }
    // The stand-in docker keeps what the last `docker run` there was given: after the image comes the command.
    const args = readFileSync(mock('spark3', 'last-run-args'), 'utf8').replace(/\n$/, '').split('\n'), at = args.indexOf('--entrypoint');
    assert.equal(args[at + 1], 'vllm');
    const ran = [args[at + 1], ...args.slice(at + 3)], share = Number(ran[ran.indexOf('--gpu-memory-utilization') + 1]);
    assert.ok(share > 0 && share <= 0.9, ran.join(' '));
    writeFileSync(mock('spark3', 'cmd-sc-gpt-oss-20b'), JSON.stringify(ran));
    const d = (await detail('spark3/sc-gpt-oss-20b')).detail;
    assert.deepEqual(d.command, ran);
    assert.equal(d.engine, 'vllm');
    assert.equal(d.contextTokens, 65536);
    assert.equal(d.memoryShare, share);
    // (the stand-in Sparks have 127,607,420 kB of memory)
    assert.equal(d.memoryShareGB, Math.round(share * 127607420 * 1024 / 1e8) / 10);
    assert.deepEqual(d.sparks, ['spark3']);
    assert.equal(d.port, T.fleet.servePort);
    assert.deepEqual(d.setup, { id: 'abcd1234', recipe: null, source: 'https://example.test/gpt-oss-20b-setup' });
    assert.match(d.setupWords, /^Its settings are exactly those of Recipes setup abcd1234, as recorded when it last started that way \(\d{4}-/);
    // One flag more than the recorded run: not that setup any more, and it says so.
    writeFileSync(mock('spark3', 'cmd-sc-gpt-oss-20b'), JSON.stringify([...ran, '--enforce-eager']));
    const other = (await detail('spark3/sc-gpt-oss-20b')).detail;
    assert.equal(other.setup, null);
    assert.match(other.setupWords, /no record of a start with exactly these settings/);
    // (the later record with one more environment setting isn't what runs: its container doesn't have that setting)
    // A flag the recorded settings leave out because it's the model's own file, or a key, isn't "exactly" either.
    for (const extra of [['--chat-template', '/model/t.jinja'], ['--api-key', 'sk-abcdefghijklmnopqrstuvwxyz123']]) {
      writeFileSync(mock('spark3', 'cmd-sc-gpt-oss-20b'), JSON.stringify([...ran, ...extra]));
      const more = (await detail('spark3/sc-gpt-oss-20b')).detail;
      assert.equal(more.setup, null, extra[0]);
      assert.match(more.setupWords, /no record of a start with exactly these settings/);
    }
  });
});
