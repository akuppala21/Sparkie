// The brain's agent setup (docs/contract.md 3.8): Sparkie's model asked the way it was benchmarked for agent work. With
// the "aphex-agent" setup chosen, every request carries thinking on, the setup's own sampling (with tools too, not the
// older 0.3), long outputs, and a message may take more tool rounds and changes than the default 6 and 4. The default
// setups keep today's behaviour (sparkie.test.mjs covers them).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { T, useFleet, newChat, say, SLOW } from './lib.mjs';

const CONFIG = JSON.parse(readFileSync(new URL('../service/config.json', import.meta.url), 'utf8'));
const AGENT = CONFIG.main.presets['aphex-agent'];

useFleet({
  watchMs: 60000, knowledge: true,
  // The agent setup is the chosen one.
  prepare: ({ stateDir }) => {
    const f = join(stateDir, 'main.json'), m = JSON.parse(readFileSync(f, 'utf8'));
    assert.ok(m.presets['aphex-agent'], 'the stand-in fleet has the agent setup');
    writeFileSync(f, JSON.stringify({ ...m, current: 'aphex-agent' }), { mode: 0o600 });
  },
});

const requests = () => (existsSync(join(T.fleet.dir, 'model-requests.jsonl')) ? readFileSync(join(T.fleet.dir, 'model-requests.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []);
const script = rules => writeFileSync(join(T.fleet.dir, 'model-script.json'), JSON.stringify(rules));
const noScript = () => rmSync(join(T.fleet.dir, 'model-script.json'), { force: true });

describe('the agent setup of the brain', { concurrency: 1 }, () => {
  test('config.json: thinking on, native context (no stretching), the model card\'s sampling, long outputs, 4 at once', () => {
    assert.equal(AGENT.thinking, true);
    assert.equal(AGENT.ropeScaling, undefined, 'no YaRN: its native 262K context');
    assert.equal(AGENT.args[AGENT.args.indexOf('--context-length') + 1], '262144');
    assert.equal(AGENT.args[AGENT.args.indexOf('--max-running-requests') + 1], '4');
    assert.ok(AGENT.maxTokens >= 32768);
    assert.deepEqual(Object.keys(AGENT.sampling).sort(), ['temperature', 'top_k', 'top_p']);
    assert.ok(AGENT.toolRounds > 6 && AGENT.maxChanges > 4);
    // The tested aphex setups are unchanged.
    assert.equal(CONFIG.main.presets.aphex.thinking, false);
    assert.equal(CONFIG.main.presets.aphex.ropeScaling.factor, 4);
  });

  test('the fast-start Agent setup: the same brain, its weights read without mmap, and every compile cache kept', () => {
    // Measured 2026-11-08 on Spark 2: reading 26.6 GB of weights through mmap took 138 s of a 3 min 20 s start.
    const fast = CONFIG.main.presets['aphex-agent-fast'];
    assert.ok(fast, 'aphex-agent-fast exists');
    assert.ok(fast.args.includes('--weight-loader-disable-mmap'));
    assert.deepEqual(fast.args.filter(a => a !== '--weight-loader-disable-mmap'), AGENT.args, 'otherwise the agent setup\'s flags');
    for (const k of ['model', 'draft', 'served', 'thinking', 'maxTokens', 'toolRounds', 'maxChanges']) assert.deepEqual(fast[k], AGENT[k], k);
    assert.deepEqual(fast.sampling, AGENT.sampling);
    // (the container's home is in the kept cache folder, so FlashInfer's, TVM-FFI's, CuTe DSL's and CUDA's caches stay)
    assert.equal(fast.env.HOME, '/kernel-cache/home');
    assert.equal(fast.env.SGLANG_CACHE_DIR, '/kernel-cache/sglang');
  });

  test('every request carries thinking on and the setup\'s sampling, with tools too', { timeout: 60000 * SLOW }, async () => {
    const chat = await newChat(), from = requests().length;
    const r = await say(chat, 'what\'s running?');
    assert.ok(r.tools.length >= 1, JSON.stringify(r.tools));
    const asked = requests().slice(from).filter(x => x.words === 'what\'s running?');
    assert.ok(asked.length >= 2, 'a tool round and the answer');
    for (const x of asked) {
      assert.deepEqual(x.params, { ...AGENT.sampling, max_tokens: AGENT.maxTokens, thinking: true }, JSON.stringify(x.params));
    }
    assert.ok(asked.some(x => x.tools.length > 0), 'tools were offered');
  });

  test('a message may take more than the default 6 tool rounds', { timeout: 120000 * SLOW }, async () => {
    const chat = await newChat(), words = 'look around a lot please';
    const look = { name: 'running_models', arguments: {} };
    script([{ match: '^look around a lot', rounds: Array.from({ length: 8 }, () => [look]) }]);
    try {
      const r = await say(chat, words);
      assert.equal(r.tools.length, 8, JSON.stringify(r.tools.map(t => t.name)));
      assert.ok(r.tools.every(t => t.ok), JSON.stringify(r.tools));
    } finally { noScript(); }
  });
});
