// The brain's speed profile: for each number of requests at once, it sends that many streamed chats and measures each
// one's first words, tokens per second, and the total. Rule 3.5 (docs/contract.md) is judged by the hammer test below.
//
// On the hub, or from any machine on the tailnet through Spark Console's one model address (no tunnel needed):
//   node tools/brain-load.mjs                       (http://127.0.0.1:30100, the model it serves, 1, 3 and 4 at once)
//   node tools/brain-load.mjs --url https://akspark1.tailab9aa9.ts.net:8443/console/api
//   node tools/brain-load.mjs --url http://127.0.0.1:30100 --at 1,2,3,4,6 --tokens 256 --rounds 3
//
// The hammer test (contract 3.5): many sub-agents working flat out while the owner chats. Nothing may fail or time out,
// and the owner's first words must come within 3 seconds (p95):
//   node tools/brain-load.mjs --url … --hammer                   16 sub-agents for 10 minutes
//   node tools/brain-load.mjs --url … --hammer --agents 24 --minutes 30
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const URL_ = arg('url', 'http://127.0.0.1:30100').replace(/\/$/, '');
const AT = arg('at', '1,3,4').split(',').map(Number).filter(n => n > 0);
const TOKENS = Number(arg('tokens', 256));

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function one(model) {
  const t0 = Date.now();
  let first = null, pieces = 0, usage = null;
  const res = await fetch(`${URL_}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, stream: true, stream_options: { include_usage: true }, max_tokens: TOKENS, temperature: 0,
      chat_template_kwargs: { enable_thinking: false }, messages: [{ role: 'user', content: `(${Math.random().toString(36).slice(2)}) Write a detailed, 400-word story about a lighthouse keeper.` }] }) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  let buf = '';
  for await (const chunk of res.body) {
    buf += Buffer.from(chunk).toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:') || line.includes('[DONE]')) continue;
      try {
        const ev = JSON.parse(line.slice(5));
        if (ev.usage) usage = ev.usage;
        if (ev.choices?.[0]?.delta?.content) { pieces++; first ??= Date.now(); }
      } catch {}
    }
  }
  const end = Date.now(), tokens = usage?.completion_tokens || pieces;
  return { ttftMs: (first ?? end) - t0, tokS: first && end > first ? tokens / ((end - first) / 1000) : 0 };
}

const models = await fetch(`${URL_}/v1/models`, { signal: AbortSignal.timeout(15000) }).then(r => r.json()).catch(e => {
  console.error(`Nothing answers at ${URL_}/v1/models (${e.cause?.code || e.message}).`);
  console.error(URL_.includes('127.0.0.1')
    ? 'From another machine on the tailnet, no tunnel is needed: measure through Spark Console\'s one model address with\n'
      + '  node tools/brain-load.mjs --url https://akspark1.tailab9aa9.ts.net:8443/console/api\n'
      + '(or open the SSH tunnel: ssh -N -L 30100:127.0.0.1:30100 akuppala@100.119.233.101)'
    : 'Is the brain running? Check Models → Sparkie in Spark Console.');
  process.exit(1);
});
const model = arg('model', models.data?.[0]?.id);
if (process.argv.includes('--hammer')) { await hammer(model); process.exit(0); }
// Each level runs ROUNDS times and the median counts: a speculative-decoding model's speed swings with how well its
// guesses land on each prompt, so one sample per level is noise.
const ROUNDS = Math.max(1, Number(arg('rounds', 3)));
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
console.log(`Measuring ${model} at ${URL_}: ${TOKENS} tokens per request, ${ROUNDS} rounds per level (the median counts)\n`);
console.log('at once | slowest tokens/s | slowest first words | all together');
for (const n of AT) {
  await one(model); // warm-up
  const rounds = [];
  for (let r = 0; r < ROUNDS; r++) {
    const t0 = Date.now(), runs = await Promise.all(Array.from({ length: n }, () => one(model)));
    rounds.push({ slow: Math.min(...runs.map(x => x.tokS)), ttft: Math.max(...runs.map(x => x.ttftMs)), total: (n * TOKENS) / ((Date.now() - t0) / 1000) });
  }
  const slow = median(rounds.map(r => r.slow)), ttft = median(rounds.map(r => r.ttft)), total = median(rounds.map(r => r.total));
  console.log(`${String(n).padStart(7)} | ${slow.toFixed(1).padStart(16)} | ${(ttft / 1000).toFixed(1).padStart(17)} s | ${total.toFixed(0).padStart(8)} tok/s`);
}
console.log(`\nThis is the brain's speed profile. Rule 3.5 is judged by the hammer test, many sub-agents at once while the owner
chats: node tools/brain-load.mjs --url ${URL_} --hammer`);

// ---------- the hammer test ----------
async function hammer(model) {
  const AGENTS = Number(arg('agents', 16)), MINUTES = Number(arg('minutes', 10)), OWNER_EVERY = Number(arg('owner-every', 15));
  const THINKING = !process.argv.includes('--no-thinking'), CAP = Number(arg('max-context', 65536));
  // Text for prompts: a fixed shared part (every sub-agent's system prompt, so the cache can reuse it) and per-agent
  // parts from a seeded word stream. About 4 characters a token.
  const WORDS = 'spark model engine memory cache request token latency deploy container recipe context agent queue node cable link throughput kernel graph weights quantization tensor pipeline expert batch prefill decode log error retry status health'.split(' ');
  const textOf = (seed, chars) => { let x = seed >>> 0, out = ''; while (out.length < chars) { x = (x * 1103515245 + 12345) >>> 0; out += WORDS[x % WORDS.length] + ((x >> 8) % 11 ? ' ' : '.\n'); } return out; };
  const SYSTEM = `You are a sub-agent of Sparkie working on the owner's DGX Sparks. Follow the notes below.\n${textOf(7, 16000)}`;
  const TOOLS = [{ type: 'function', function: { name: 'read_file', description: 'Read a file in the workspace.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } }];
  const pct = (xs, q) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
  const end = Date.now() + MINUTES * 60000;
  const agentStats = [], ownerStats = [], failures = [];
  let maxContextChars = 0;

  async function call(messages, { maxTokens, thinking, tools, who }) {
    const t0 = Date.now();
    let first = null, text = '', usage = null, calls = 0, done = false;
    try {
      const res = await fetch(`${URL_}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(600000),
        body: JSON.stringify({ model, stream: true, stream_options: { include_usage: true }, max_tokens: maxTokens, messages,
          chat_template_kwargs: { enable_thinking: thinking }, ...(tools ? { tools, tool_choice: 'auto' } : {}), ...(thinking ? { temperature: 0.6, top_p: 0.95, top_k: 20 } : { temperature: 0.7 }) }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
      let buf = '';
      for await (const chunk of res.body) {
        buf += Buffer.from(chunk).toString('utf8');
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line.startsWith('data:')) continue;
          if (line.includes('[DONE]')) { done = true; continue; }
          try {
            const ev = JSON.parse(line.slice(5)), d = ev.choices?.[0]?.delta;
            if (ev.usage) usage = ev.usage;
            if (d?.content || d?.reasoning_content || d?.tool_calls) first ??= Date.now();
            if (d?.content) text += d.content;
            if (d?.tool_calls) calls++;
          } catch {}
        }
      }
      if (!done) throw new Error('the stream ended early');
      const tokens = usage?.completion_tokens || 0, secs = (Date.now() - (first ?? Date.now())) / 1000;
      return { ok: true, ttft: (first ?? Date.now()) - t0, tokens, tokS: secs > 0 ? tokens / secs : 0, text, calls };
    } catch (e) {
      failures.push(`${who}: ${e.message}`);
      return { ok: false, ttft: Date.now() - t0, tokens: 0, tokS: 0, text: '', calls: 0 };
    }
  }

  async function subAgent(k) {
    let task = 0;
    while (Date.now() < end) {
      task++;
      const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: `Task ${k}.${task}: study this excerpt, then say the next step, reading a file if you need one.\n${textOf(k * 1000 + task, 8000 + (k % 4) * 4000)}` }];
      // One task: rounds until the context reaches the cap (as compaction would), then a fresh task.
      while (Date.now() < end && JSON.stringify(messages).length < CAP * 4) {
        const r = await call(messages, { maxTokens: 512, thinking: THINKING, tools: TOOLS, who: `sub-agent ${k}` });
        agentStats.push(r);
        if (!r.ok) { await sleep(2000); continue; }
        messages.push({ role: 'assistant', content: r.text || '(looked at a file)' });
        messages.push({ role: 'user', content: `Tool result (read_file):\n${textOf(k * 7919 + messages.length, 6000)}\nContinue.` });
        maxContextChars = Math.max(maxContextChars, JSON.stringify(messages).length);
      }
    }
  }
  async function owner() {
    await sleep(5000);
    while (Date.now() < end) {
      ownerStats.push(await call([{ role: 'user', content: 'In one short sentence: what is the capital of France?' }], { maxTokens: 48, thinking: false, who: 'owner' }));
      await sleep(OWNER_EVERY * 1000);
    }
  }

  console.log(`Hammering ${model} at ${URL_}: ${AGENTS} sub-agents for ${MINUTES} minutes (thinking ${THINKING ? 'on' : 'off'}, contexts up to ~${CAP} tokens), the owner asking every ${OWNER_EVERY} s …`);
  const t0 = Date.now();
  const ticker = setInterval(() => console.log(`  ${Math.round((Date.now() - t0) / 60000)} min: ${agentStats.length} sub-agent calls, ${failures.length} failed; owner's first words p95 ${((pct(ownerStats.map(r => r.ttft), 0.95) || 0) / 1000).toFixed(1)} s`), 60000);
  await Promise.all([...Array.from({ length: AGENTS }, (_, k) => subAgent(k + 1)), owner()]);
  clearInterval(ticker);
  const secs = (Date.now() - t0) / 1000, ok = agentStats.filter(r => r.ok), oo = ownerStats.filter(r => r.ok);
  const total = agentStats.reduce((t, r) => t + r.tokens, 0) + ownerStats.reduce((t, r) => t + r.tokens, 0);
  const ownerP95 = pct(oo.map(r => r.ttft), 0.95) ?? Infinity;
  console.log(`
Sub-agents: ${agentStats.length} calls, ${agentStats.length - ok.length} failed. First words p50 ${((pct(ok.map(r => r.ttft), 0.5) || 0) / 1000).toFixed(1)} s, p95 ${((pct(ok.map(r => r.ttft), 0.95) || 0) / 1000).toFixed(1)} s. Each call's speed p50 ${(pct(ok.map(r => r.tokS), 0.5) || 0).toFixed(1)} tokens/s, slowest tenth ${(pct(ok.map(r => r.tokS), 0.1) || 0).toFixed(1)}.
Owner: ${ownerStats.length} questions, ${ownerStats.length - oo.length} failed. First words p50 ${((pct(oo.map(r => r.ttft), 0.5) || 0) / 1000).toFixed(1)} s, p95 ${(ownerP95 / 1000).toFixed(1)} s.
All together: ${(total / secs).toFixed(0)} tokens/s out. Longest context: ~${Math.round(maxContextChars / 4)} tokens.`);
  if (failures.length) console.log(`First failures:\n${[...new Set(failures)].slice(0, 5).map(f => `  ${f}`).join('\n')}`);
  const met = !failures.length && ownerP95 <= 3000;
  console.log(`\nRule 3.5 (zero failures, the owner's first words within 3 s at p95): ${met ? 'MET' : 'not met'}.${!met && ownerP95 > 3000 ? ' The owner waits behind the sub-agents: Spark Console\'s queue with the owner first (phase 4) is what fixes that.' : ''}`);
}
