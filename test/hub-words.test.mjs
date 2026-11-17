// Covers: the hub's words follow the hub (R1; the owner's move of 2026-11-16, Spark 1 the hub): no file under
// service/src/ or public/ (nor the service's other code files) says "Spark 2", "akspark2" or the id spark2, but a comment
// that carries a date (history), so a sentence that means the hub can't name the old one again; and service/config.json
// is the move's shape: Spark 1 the one Spark marked local, Spark 2 a compute Spark with its tailnet address, every brain
// setup on Spark 1, the console's one address akspark1's. Pure: no stand-in fleet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, shippedConfig } from './start-mock.mjs';

const FILES = [
  ...readdirSync(join(REPO, 'service', 'src')).filter(f => f.endsWith('.mjs')).map(f => join('service', 'src', f)),
  ...readdirSync(join(REPO, 'public')).filter(f => /\.(?:js|mjs|html|css|json|webmanifest)$/.test(f)).map(f => join('public', f)),
  'service/worker.py', 'service/dig.mjs', 'service/passkey.mjs',
];
const OLD_HUB = /\bSpark[\s-]*2\b|\bakspark2\b|\bspark2\b/i;
// A comment line (//, /*, * or # first) that carries a date: history, which may name what was so then.
const HISTORY = /^\s*(?:\/\/|\/\*|\*|#).*\b20\d\d-\d\d-\d\d\b/;

test('no file of the service or the page names the old hub, but a dated comment about history', () => {
  const found = [];
  for (const f of FILES) {
    readFileSync(join(REPO, f), 'utf8').split('\n').forEach((line, i) => {
      if (OLD_HUB.test(line) && !HISTORY.test(line)) found.push(`${f}:${i + 1}: ${line.trim().slice(0, 160)}`);
    });
  }
  assert.deepEqual(found, [], `say the hub (hubName(), hubId(); "the hub" in a comment):\n${found.join('\n')}`);
});

test('the check finds the words it is there for, and lets a dated comment be', () => {
  const caught = ['  throw new HttpError(403, \'Spark 2 runs Spark Console\');', 'const x = `on spark 2`;', "if (id === 'spark2') return;", '// Spark 2\'s plug', 'ssh akspark2 ls'];
  assert.deepEqual(caught.filter(l => !(OLD_HUB.test(l) && !HISTORY.test(l))), [], 'each is caught');
  for (const l of ['// The owner, 2026-11-13: "shut down sparks when not in use (not spark 2)"', 'Spark 1 and spark12', 'the hub']) assert.ok(!(OLD_HUB.test(l) && !HISTORY.test(l)), l);
});

test('service/config.json: Spark 1 is the hub, Spark 2 a compute Spark at its tailnet address, every brain setup on Spark 1, the one address akspark1’s', () => {
  const cfg = shippedConfig();
  assert.deepEqual(cfg.nodes.filter(n => n.host === 'local').map(n => n.id), ['spark1'], 'one Spark marked local: Spark 1');
  assert.deepEqual(Object.fromEntries(cfg.nodes.map(n => [n.id, n.host])), { spark1: 'local', spark2: '100.79.155.126', spark3: '100.122.49.9', spark4: '100.109.240.15' });
  assert.deepEqual([...new Set(Object.values(cfg.main.presets).map(p => p.node))], ['spark1'], 'every brain setup on the hub');
  assert.equal(cfg.origin, 'https://akspark1.tailab9aa9.ts.net:8443');
  // (the shared model store is a compute Spark's, untouched by the move)
  assert.equal(cfg.modelsHost, 'spark3');
});
