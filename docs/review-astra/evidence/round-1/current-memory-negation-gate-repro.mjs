// Read the selected checkout's exact intent, authorization and memory-action code.
// This isolates the gate; it does not call a model, HTTP listener, Spark or disk-backed state.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { randomBytes, createHash } from 'node:crypto';
const repo = resolve(process.env.SPARK_REVIEW_ROOT || fileURLToPath(new URL('../../../../', import.meta.url)));
const sourcePaths = ['service/src/11-setups.mjs', 'service/src/16-actions.mjs', 'service/src/20-memory.mjs'];
const sources = Object.fromEntries(sourcePaths.map(path => [path, readFileSync(join(repo, path), 'utf8')]));
const sha256 = text => createHash('sha256').update(text).digest('hex');
const actions = sources['service/src/16-actions.mjs'];
const memory = sources['service/src/20-memory.mjs'];
const squash = sources['service/src/11-setups.mjs'].match(/^const squash = .*$/m)?.[0];
assert.ok(squash, 'Cannot locate squash in the selected checkout.');
function extract(text, first, next) {
  const a = text.indexOf(first), b = text.indexOf(next, a);
  assert.ok(a >= 0 && b > a, `Cannot locate source fragment ${first}`);
  return text.slice(a, b);
}
const declarations = extract(actions, 'const normQuotes =', '// A typed answer');
const check = extract(actions, 'async function sparkieCheck(', '// ctx says');
let state = { entries: [] };
const registry = new Map();
const context = vm.createContext({ console, Date, randomBytes, STATE_DIR: '/isolated',
  NODES: [1, 2, 3, 4].map(n => ({ id: `spark${n}` })),
  readKept: () => state,
  writePrivate: (_path, value) => { state = value; },
  action: action => registry.set(action.name, action),
  maskSecrets: text => text, // Fixture contains no secret; masking is outside this gate check.
  HttpError: class extends Error { constructor(status, message) { super(message); this.status = status; } },
});
vm.runInContext(`${squash}\n${declarations}\n${memory}\n${check}\n` +
  `globalThis.inspect = async (request, text) => {
    const intent = changeIntent(request);
    const ctx = { via: 'sparkie', request, said: request, intent, canChange: true, readOutside: false };
    return { ctx, intent, gate: await sparkieCheck('remember', { text, kind: 'fact' }, ctx) };
  };`, context);
const request = 'Do not remember that Spark 4 is on Wi-Fi only';
const proposed = 'Spark 4 is on Wi-Fi only';
const { ctx, intent, gate } = await context.inspect(request, proposed);
assert.ok(intent.negated.includes('remember'), 'The intent parser must recognize the explicit refusal.');
assert.equal(gate.clear, true, 'Current defect no longer reproduced: the gate rejected the write.');
const outcome = await registry.get('remember').run(gate.input, { role: 'owner' }, ctx);
assert.equal(outcome.outcome, 'remembered');
assert.equal(state.entries.length, 1);
assert.equal(state.entries[0].text, proposed);
assert.equal(state.entries[0].by, 'owner');
console.log(JSON.stringify({
  case: 'recognized-memory-refusal-is-overridden-by-statement-fallback',
  scope: 'Exact checkout functions; isolated in-memory persistence. No model, HTTP or Spark operation.',
  sourceSha256: Object.fromEntries(sourcePaths.map(path => [path, sha256(sources[path])])),
  request, proposed, intent: JSON.parse(JSON.stringify(intent)), gateClear: gate.clear,
  outcome: outcome.outcome, savedEntries: state.entries.map(({ text, by }) => ({ text, by })),
}, null, 2));
