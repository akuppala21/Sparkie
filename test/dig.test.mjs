// A model's own card on Hugging Face as a recipe source (A9, R27): dig.fromCard reads only the commands in a card's code
// blocks that serve that very repo, never its words, and each one still goes through dig.vetSetup like any other source.
// Pure: no fleet, no web.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as dig from '../service/dig.mjs';

const PINNED = 'vllm/vllm-openai@sha256:' + 'a'.repeat(64);
const rules = { engines: { vllm: { pairs: true }, sglang: { pairs: true }, 'llama.cpp': {} }, sources: ['vllm/vllm-openai', 'lmsysorg/sglang', 'ghcr.io/ggml-org/llama.cpp'],
  defaultImage: e => ({ vllm: PINNED, sglang: `lmsysorg/sglang@sha256:${'b'.repeat(64)}`, 'llama.cpp': `ghcr.io/ggml-org/llama.cpp@sha256:${'c'.repeat(64)}` })[e] || null };
const fence = cmd => `\`\`\`bash\n${cmd}\n\`\`\`\n`;

test('a fenced command for the repo itself is one setup: kind model-card, its own page, only its flags', () => {
  const [s, ...more] = dig.fromCard(`# Name\n\n${fence('vllm serve org/Name --max-model-len 32768 --max-num-seqs 4')}`, 'org/Name');
  assert.equal(more.length, 0);
  assert.equal(s.repo, 'org/Name');
  assert.equal(s.source.kind, 'model-card');
  assert.equal(s.source.url, 'https://huggingface.co/org/Name');
  assert.equal(s.notes, 'From the model’s own card on Hugging Face');
  const v = dig.vetSetup(s, rules);
  assert.equal(v.deployable, true, v.why);
  assert.equal(v.source.kind, 'model-card');
  assert.equal(v.source.url, 'https://huggingface.co/org/Name');
  assert.equal(v.repo, 'org/Name');
  assert.deepEqual(v.args, ['--max-model-len', '32768', '--max-num-seqs', '4']);
});

test('words outside a block, a block for another repo, and no card at all give nothing', () => {
  assert.deepEqual(dig.fromCard('Run it with: vllm serve org/Name --max-model-len 32768', 'org/Name'), []);
  assert.deepEqual(dig.fromCard(fence('vllm serve someone/Other --max-num-seqs 64'), 'org/Name'), []);
  assert.deepEqual(dig.fromCard(null, 'org/Name'), []);
  assert.deepEqual(dig.fromCard(fence('vllm serve org/Name'), ''), []);
});

test('the same checks as any setup: a chat template file isn’t one-click; eight GPUs isn’t a Spark setup', () => {
  const [t] = dig.fromCard(fence('vllm serve org/Name --chat-template ./x.jinja'), 'org/Name');
  assert.ok(t, 'returned');
  const v = dig.vetSetup(t, rules);
  assert.equal(v.deployable, false);
  assert.match(v.why, /uses --chat-template/);
  const [big] = dig.fromCard(fence('vllm serve org/Name --tensor-parallel-size 8'), 'org/Name');
  assert.equal(dig.vetSetup(big, rules), null);
});

test('llama.cpp: the repo and its file', () => {
  const [s] = dig.fromCard(fence('llama-server -hf org/Name:Q4_K_M -c 8192'), 'org/Name');
  assert.deepEqual({ engine: s.engine, repo: s.repo, file: s.file }, { engine: 'llama.cpp', repo: 'org/Name', file: 'Q4_K_M' });
});

test('at most six a card; a command with a word over 300 characters is skipped', () => {
  const seven = [1, 2, 3, 4, 5, 6, 7].map(n => fence(`vllm serve org/Name --max-num-seqs ${n}`)).join('\n');
  assert.equal(dig.fromCard(seven, 'org/Name').length, 6);
  assert.deepEqual(dig.fromCard(fence(`vllm serve org/Name --served-model-name ${'x'.repeat(301)}`), 'org/Name'), []);
});

// A card is outside text: a hostile one (the review's, 2026-11-13: 400,000 characters of unclosed fences or <pre> tags,
// or one block of 100,000 settings) is read in well under a second, never blocking the service; an honest one of the
// same size gives its setup as before. A card is Markdown: <pre><code> is never read from it.
test('hostile cards are read in under a second; a <pre> block isn’t a card’s code block', () => {
  const N = 400000;
  const cards = {
    'backticks only': '`'.repeat(N),
    'fences, no newline': '```x'.repeat(N / 4),
    '<pre, never closed': '<pre '.repeat(N / 5),
    '<pre><code>, never closed': '<pre><code>'.repeat(Math.floor(N / 11)),
    '<pre> then spaces': ('<pre>' + ' '.repeat(40)).repeat(Math.floor(N / 45)),
    '<pre><code> x </code> spaces, no </pre>': ('<pre><code>x</code>' + ' '.repeat(30)).repeat(Math.floor(N / 48)),
    'one block of settings': fence('a= '.repeat(Math.floor((N - 20) / 3))),
  };
  for (const [name, text] of Object.entries(cards)) {
    const t = Date.now();
    assert.deepEqual(dig.fromCard(text, 'org/Name'), [], name);
    assert.ok(Date.now() - t < 1000, `${name}: ${Date.now() - t} ms`);
  }
  const t = Date.now();
  const honest = dig.fromCard(`# Model\n\nwords\n\n${fence('vllm serve org/Name --max-model-len 32768')}`.repeat(Math.floor(N / 70)), 'org/Name');
  assert.ok(Date.now() - t < 1000, `honest card: ${Date.now() - t} ms`);
  assert.deepEqual(honest.map(s => s.args), [['--max-model-len', '32768']]);
  assert.deepEqual(dig.fromCard('<pre><code>vllm serve org/Name --max-num-seqs 4</code></pre>', 'org/Name'), []);
  // (fences indented in a list, and Windows line ends, read as before)
  assert.deepEqual(dig.fromCard('1. Run:\n   ```bash\r\n   vllm serve org/Name --max-num-seqs 2\r\n   ```\r\n', 'org/Name').map(s => s.args), [['--max-num-seqs', '2']]);
});
