// Stand-in model servers, started by test/start-mock.mjs with free ports (without them, e.g. picked up by a bare
// `node --test`, it does nothing):
// - Sparkie's main model (SGLang-like) on 127.0.0.1:$MOCK_MODEL_PORT. It answers only while the stand-in docker says
//   sparkie-main is running on spark2 (and 4 s after it started, like loading); replies stream with a little reasoning
//   first and echo what they saw, so a test can check the system prompt and history.
//   Asked with `tools` (Sparkie's tool loop), it calls tools the way a model would, from simple patterns in the owner's
//   words (the last user message without the fleet record Spark Console puts in front of it; below), or from rules a
//   test writes to $MOCK_DIR/model-script.json, streamed as OpenAI tool_calls in pieces. A rule can take several rounds
//   (look something up, then act on it); once it has the results it answers with what each tool said.
//   "take N seconds" in the words makes it wait that long before answering (an answer that takes a while). A rule's
//   "answerWhen" (a file name) makes the answer after its tools' results wait until $MOCK_DIR/<that file> is there (it is
//   then removed; 5 minutes at most). $MOCK_DIR/model-fail holding "after-tools"
//   makes the next request carrying tool results answer 500 (the file is then removed): a reply that fails after its
//   tools ran. The other one-time failures are for the next request of any kind: "cut-off" answers 503 and closes the
//   connection before the body its Content-Length promised (an engine dying mid-answer); "cut-off-200" starts a 200
//   stream and closes it part-way; "held-open" answers 503 and part of its body, then holds the connection open until
//   Spark Console hangs up (5 minutes at most); "answer-500" on the first line answers a whole 500 whose body is the
//   rest of the file.
// - A benchmark-style server that's always up, on $MOCK_BENCH_PORT.
// - The port Spark Console's own deploys serve on ($MOCK_SERVE_PORT): the service measures a new deploy's speed there.
//   Whether a deploy is up is the stand-in curl's call (per Spark); this one always answers, quickly.
// Every request to Sparkie's model is logged to $MOCK_DIR/model-requests.jsonl: the tools offered, the system prompt, the
// last user message (whole, record included), which round it is, the tool results it was sent, and how it was asked
// (temperature, top_p, top_k, max_tokens, thinking). The first round of each turn with tools also leaves exactly what
// the brain was sent, the system prompt and every tool in full, in $MOCK_DIR/brain-sent.json (test/lock.mjs hashes it).
import http from 'node:http';
import { readFileSync, appendFileSync, existsSync, rmSync, writeFileSync, renameSync } from 'node:fs';

const MAIN_PORT = Number(process.env.MOCK_MODEL_PORT), BENCH_PORT = Number(process.env.MOCK_BENCH_PORT), SERVE_PORT = Number(process.env.MOCK_SERVE_PORT);
if (!process.env.MOCK_ROOT || !MAIN_PORT || !BENCH_PORT) process.exit(0);
const M = `${process.env.MOCK_ROOT}/spark2/.mock`, DIR = process.env.MOCK_DIR;
const up = () => {
  try {
    if (!/^sparkie-main\|running\|/m.test(readFileSync(`${M}/containers`, 'utf8'))) return false;
    // ~/.mock/brain-hung (on spark2): running, but not answering (the stand-in `docker restart` clears it).
    if (existsSync(`${M}/brain-hung`)) return false;
    return Date.now() / 1000 - Number(readFileSync(`${M}/up-sparkie-main`, 'utf8')) >= 4;
  } catch { return false; }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

// What the main model does with tools, by the owner's words. A test's own rules come first:
// $MOCK_DIR/model-script.json = [{ "match": "<regex>", "calls": [{ "name": "...", "arguments": { ... } }] }], or with
// "rounds": [[calls], [calls], …] for a model that looks something up and then acts on what it saw (round 2 comes after
// round 1's results).
const sparkOf = n => (n ? { spark: `spark${n}` } : {});
const RULES = [
  [/\bwhat(?:'|’)?s running\b|\bwhat is running\b/i, () => [[{ name: 'running_models', arguments: {} }]]],
  // Reads a container's log first, then restarts it: a change in a reply that read outside text.
  [/\brestart\s+([A-Za-z0-9][\w.-]*)\s+on\s+spark\s*(\d+)\s+once you(?:'|’)ve read its logs?\b/i, m => [[{ name: 'container_logs', arguments: { spark: `spark${m[2]}`, container: m[1] } }],
    [{ name: 'restart_model', arguments: { spark: `spark${m[2]}`, container: m[1] } }]]],
  [/\b(?:start|run|deploy|launch)\s+([A-Za-z0-9][\w./:-]*)(?:\s+on\s+spark\s*(\d+))?/i, m => [[{ name: 'start_model', arguments: { model: m[1], ...sparkOf(m[2]) } }]]],
  [/\bstop\s+([A-Za-z0-9][\w.-]*)\s+on\s+spark\s*(\d+)/i, m => [[{ name: 'stop_model', arguments: { spark: `spark${m[2]}`, container: m[1] } }]]],
  [/\brestart\s+([A-Za-z0-9][\w.-]*)\s+on\s+spark\s*(\d+)/i, m => [[{ name: 'restart_model', arguments: { spark: `spark${m[2]}`, container: m[1] } }]]],
  // A model acting on its own (say, misled by a log it read): the owner only asked a question.
  [/\bwhy did (?:it|that) fail\b/i, () => [[{ name: 'start_model', arguments: { model: 'gpt-oss-20b', spark: 'spark3' } }]]],
];
// The owner's own words: Spark Console puts its record of the fleet in front of them.
const wordsOf = text => String(text || '').replace(/^\[Spark Console(?:'|’)s record[\s\S]*?\[End of record\.\]\s*/, '');
// The test's own rule for these words, if one matches.
function ruleFor(text) {
  let script = [];
  try { script = JSON.parse(readFileSync(`${DIR}/model-script.json`, 'utf8')); } catch {}
  for (const r of Array.isArray(script) ? script : []) {
    try { if (new RegExp(r.match, 'i').test(text)) return r; } catch {}
  }
  return null;
}
function roundsFor(text) {
  const r = ruleFor(text);
  if (r) return r.rounds || [r.calls || []];
  for (const [re, rounds] of RULES) { const m = re.exec(text); if (m) return rounds(m); }
  return [];
}

function stream(res) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  return {
    send: (delta, finish = null) => res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`),
    end: () => res.end('data: [DONE]\n\n'),
    words: async (text, ms) => { for (const w of text.split(/(?<= )/)) { res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: w }, finish_reason: null }] })}\n\n`); if (ms) await sleep(ms); } },
  };
}

async function mainReply(b, port, res, log = true) {
  const msgs = Array.isArray(b.messages) ? b.messages : [], sys = msgs.find(m => m.role === 'system'), last = msgs.at(-1) || {};
  const tools = Array.isArray(b.tools) ? b.tools : [];
  const userAt = msgs.findLastIndex(m => m.role === 'user'), lastUser = String(msgs[userAt]?.content || ''), words = wordsOf(lastUser);
  // Which round of tool calls this is: how many times it called tools since the owner's message.
  const round = msgs.slice(userAt + 1).filter(m => m.role === 'assistant' && m.tool_calls?.length).length;
  if (DIR && log) {
    const results = [];
    for (let k = msgs.length - 1; k >= 0 && msgs[k].role === 'tool'; k--) results.unshift({ id: msgs[k].tool_call_id, content: String(msgs[k].content).slice(0, 4000) });
    const entry = { at: new Date().toISOString(), tools: tools.map(t => t.function?.name), toolChoice: b.tool_choice || null, lastRole: last.role || null, messages: msgs.length,
      system: String(sys?.content || ''), lastUser: lastUser.slice(0, 8000), words: words.slice(0, 2000), round, results,
      // how it was asked (the brain's setup decides these, contract 3.8)
      params: { temperature: b.temperature ?? null, top_p: b.top_p ?? null, top_k: b.top_k ?? null, max_tokens: b.max_tokens ?? null,
        thinking: b.chat_template_kwargs?.enable_thinking ?? null } };
    try { appendFileSync(`${DIR}/model-requests.jsonl`, `${JSON.stringify(entry)}\n`); } catch {}
    if (tools.length && round === 0) {
      try {
        writeFileSync(`${DIR}/brain-sent.json.tmp`, JSON.stringify({ at: entry.at, words: entry.words, system: entry.system, tools }));
        renameSync(`${DIR}/brain-sent.json.tmp`, `${DIR}/brain-sent.json`);
      } catch {}
    }
  }
  // The one-time failures for the next request (above), once.
  const fail = DIR && log && existsSync(`${DIR}/model-fail`) ? readFileSync(`${DIR}/model-fail`, 'utf8') : '', mode = fail.split('\n')[0].trim();
  if (['cut-off', 'cut-off-200', 'held-open', 'answer-500'].includes(mode)) {
    rmSync(`${DIR}/model-fail`, { force: true });
    if (mode === 'answer-500') { res.writeHead(500, { 'content-type': 'application/json' }); return res.end(fail.slice(fail.indexOf('\n') + 1)); }
    if (mode === 'cut-off-200') { stream(res).send({ content: 'Half an ans' }); setTimeout(() => res.destroy(), 50); return; }
    res.writeHead(503, { 'content-type': 'application/json', 'content-length': '10000' });
    res.write('{"error":{"message":"shutting down');
    const end = setTimeout(() => res.destroy(), mode === 'cut-off' ? 50 : 300000);
    res.on('close', () => clearTimeout(end));
    return;
  }
  const wait = /\btake (\d+) seconds\b/i.exec(words);
  if (wait && last.role === 'user') await sleep(Number(wait[1]) * 1000);
  const gate = last.role === 'tool' ? String(ruleFor(words)?.answerWhen || '').replace(/[^\w.-]/g, '') : '';
  if (gate && DIR) {
    for (const until = Date.now() + 300000; !existsSync(`${DIR}/${gate}`) && Date.now() < until;) await sleep(200);
    rmSync(`${DIR}/${gate}`, { force: true });
  }
  // A reply that fails after its tools ran (model-fail: after-tools), once.
  if (DIR && log && last.role === 'tool' && existsSync(`${DIR}/model-fail`) && readFileSync(`${DIR}/model-fail`, 'utf8').trim() === 'after-tools') {
    rmSync(`${DIR}/model-fail`, { force: true });
    res.writeHead(500, { 'content-type': 'application/json' });
    return res.end('{"error":{"message":"stand-in failure"}}');
  }
  const s = stream(res);
  s.send({ role: 'assistant', reasoning_content: 'Let me look at the snapshot.' });
  // The owner's words (or the results of the round before) call for tools: call them.
  const calls = tools.length && ['user', 'tool'].includes(last.role) ? (roundsFor(words)[round] || []).filter(c => tools.some(t => t.function?.name === c.name) || c.offered === false) : [];
  if (calls.length) {
    for (const [i, c] of calls.entries()) {
      const args = JSON.stringify(c.arguments || {}), cut = Math.ceil(args.length / 2);
      s.send({ tool_calls: [{ index: i, id: `call_mock_${i}_${Math.random().toString(36).slice(2, 8)}`, type: 'function', function: { name: c.name, arguments: '' } }] });
      await sleep(10);
      s.send({ tool_calls: [{ index: i, function: { arguments: args.slice(0, cut) } }] });
      s.send({ tool_calls: [{ index: i, function: { arguments: args.slice(cut) } }] });
    }
    s.send({}, 'tool_calls');
    return s.end();
  }
  // Back with the tools' results: say what each one said.
  if (last.role === 'tool') {
    let k = msgs.length - 1;
    while (k > 0 && msgs[k - 1].role === 'tool') k--;
    const asked = msgs[k - 1]?.tool_calls || [];
    const said = msgs.slice(k).map(t => `${asked.find(c => c.id === t.tool_call_id)?.function?.name || 'a tool'} said: ${String(t.content).slice(0, 300)}`);
    await s.words(`I checked. ${said.join(' | ')}`, 5);
    s.send({}, 'stop');
    return s.end();
  }
  const reply = `You asked: **${words}**. I saw ${(msgs.length || 2) - 2} earlier messages; ` +
    `snapshot ${/live snapshot from Spark Console/.test(sys?.content || '') ? 'attached' : 'missing'}; thinking ${b.chat_template_kwargs?.enable_thinking ? 'on' : 'off'}; model ${b.model} on port ${port}.`;
  await s.words(reply, 10);
  s.send({}, 'stop');
  s.end();
}

// A deploy checked with a test prompt (not streamed) or measured for speed (streamed): a short answer, quickly, with
// usage like vLLM's. With $MOCK_DIR/serve-silent, it loads but can't answer (500), like a model with no chat template.
async function deployReply(b, res) {
  if (existsSync(`${DIR}/serve-silent`)) { res.writeHead(500, { 'content-type': 'application/json' }); return res.end('{"error":{"message":"Cannot use chat template functions because tokenizer.chat_template is not set"}}'); }
  if (!b.stream) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: 'Hello from the stand-in model.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 } }));
  }
  const s = stream(res);
  await s.words('one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen', 2);
  s.send({}, 'stop');
  res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 20, completion_tokens: 16, total_tokens: 36 } })}\n\n`);
  s.end();
}

const serve = (port, isUp, served, reply) => http.createServer((req, res) => {
  // ~/.mock/brain-frozen (on spark2): Sparkie's model holds every request 10 s before failing, like an engine that froze.
  if (port === MAIN_PORT && existsSync(`${M}/brain-frozen`)) { setTimeout(() => { try { res.writeHead(503); res.end('frozen'); } catch {} }, 10000); return; }
  if (!isUp()) { res.writeHead(503); return res.end('loading'); }
  if (req.url === '/v1/models') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ object: 'list', data: [{ id: served }] })); }
  if (req.url === '/v1/responses' && req.method === 'POST') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ object: 'response', status: 'completed', model: served, output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'one two three' }] }] })); }
  if (req.url === '/v1/embeddings' && req.method === 'POST') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ object: 'list', model: served, data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2, 0.3] }] })); }
  if (req.url === '/v1/chat/completions' && req.method === 'POST') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', async () => {
      let b;
      try { b = JSON.parse(body); } catch { res.writeHead(400); return res.end('bad json'); }
      try { await reply(b, port, res); } catch (e) { if (!res.headersSent) res.writeHead(500); res.end(String(e)); }
    });
    return;
  }
  res.writeHead(404); res.end();
}).listen(port, '127.0.0.1', () => console.log(`mock model ${served} on 127.0.0.1:${port}`));
serve(MAIN_PORT, up, 'qwen-aphex', mainReply);
serve(BENCH_PORT, () => true, 'qwen-recipe-test', (b, port, res) => mainReply({ ...b, tools: undefined }, port, res, false));
if (SERVE_PORT) serve(SERVE_PORT, () => true, 'stand-in-deploy', (b, port, res) => deployReply(b, res));
